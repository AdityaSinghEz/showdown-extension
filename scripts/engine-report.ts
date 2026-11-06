/**
 * Reports what the poke-engine search says about exported positions.
 *
 * Usage:
 *   npm run engine:report
 *   npm run engine:report -- --id gen9randombattle-2701773375
 *
 * Without `--id` it prints how well each estimate predicts the winner (log
 * loss, lower is better), how often players chose what the engine tried most,
 * the grade mix, and whether the winner made fewer errors. With `--id` it
 * prints the engine's grade for each side on every exported turn of one game.
 */

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { hashString } from '../lib/model/split';
import { applyCalibration, fitCalibration } from '../lib/review/calibrate';
import { judgeWithEngine, rootValue, type EngineJudgement, type EnginePositionResult } from '../lib/review/engine-results';

interface Exported {
  id: string;
  turn: number;
  y: number | null;
  played: { p1: string | null; p2: string | null };
  model: number;
  rollout: number | null;
}

function logLoss(p: number, y: number): number {
  const clipped = Math.min(1 - 1e-4, Math.max(1e-4, p));
  return -(y * Math.log(clipped) + (1 - y) * Math.log(1 - clipped));
}

async function readLines<T>(path: string): Promise<T[]> {
  return (await readFile(path, 'utf8')).split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as T);
}

const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;

function describe(judgement: EngineJudgement): string {
  if (judgement.grade === 'unknown') return 'unknown';
  if (judgement.grade === 'forced') return 'forced';
  const share = judgement.share === null ? '' : `, engine plays it ${pct(judgement.share)}`;
  return `${judgement.grade} -${((judgement.loss ?? 0) * 100).toFixed(1)}${share}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      states: { type: 'string', default: 'data/engine-states.jsonl' },
      results: { type: 'string', default: 'data/engine-results.jsonl' },
      id: { type: 'string' },
    },
  });
  const states = await readLines<Exported & { p1: unknown }>(values.states ?? 'data/engine-states.jsonl');
  const results = await readLines<EnginePositionResult>(values.results ?? 'data/engine-results.jsonl');
  const byKey = new Map(results.map((r) => [`${r.id}:${r.turn}`, r]));
  const rows = states.flatMap((state) => {
    const result = byKey.get(`${state.id}:${state.turn}`);
    return result && result.error === undefined && result.p1 && result.p2 ? [{ state, result }] : [];
  });
  const failed = states.length - rows.length;

  if (values.id !== undefined) {
    const game = rows.filter((r) => r.state.id === values.id).sort((a, b) => a.state.turn - b.state.turn);
    if (game.length === 0) throw new Error(`No searched positions for ${values.id}`);
    for (const { state, result } of game) {
      const p1 = judgeWithEngine(result.p1 ?? [], state.played.p1);
      const p2 = judgeWithEngine(result.p2 ?? [], state.played.p2);
      console.log(`Turn ${String(state.turn).padStart(2)}  engine value for p1: ${pct(rootValue(result.p1 ?? []) ?? 0.5)}`);
      for (const [name, judgement] of [['p1', p1], ['p2', p2]] as const) {
        console.log(`   ${name}: ${state.played[name] ?? '?'}  [${describe(judgement)}]`);
        if (judgement.grade !== 'best' && judgement.grade !== 'forced' && judgement.grade !== 'unknown') {
          console.log(`      engine tried most: ${judgement.best.slice(0, 3).map((b) => `${b.engine} ${pct(b.share)}`).join(', ')}`);
        }
        if (judgement.tera) {
          const t = judgement.tera;
          const worthShowing = t.action === 'used' || t.grade !== 'best' || t.gain >= 0.05;
          if (worthShowing) console.log(`      Tera: ${t.grade} (${t.note}; ${t.gain >= 0 ? '+' : ''}${(t.gain * 100).toFixed(0)} points)`);
        }
      }
    }
    return;
  }

  const labelled = rows.filter((r) => r.state.y !== null);
  console.log(`${rows.length} positions searched (${failed} failed), ${labelled.length} with a known winner.\n`);

  // 1. How well does each estimate predict the winner?
  const engineRaw = labelled.map((r) => rootValue(r.result.p1 ?? []) ?? 0.5);
  const y = labelled.map((r) => r.state.y as number);
  const folds = labelled.map((r) => hashString(r.state.id) % 2);
  const engineCal = engineRaw.map((score, i) => {
    const train = engineRaw.map((_, j) => j).filter((j) => folds[j] !== folds[i]);
    const fit = fitCalibration(train.map((j) => engineRaw[j] as number), train.map((j) => y[j] as number));
    return applyCalibration(fit, score);
  });
  const model = labelled.map((r) => r.state.model);
  const hasRollout = labelled.every((r) => r.state.rollout !== null);
  const rollout = labelled.map((r) => r.state.rollout ?? r.state.model);
  const blend = (a: readonly number[], b: readonly number[]): number[] => a.map((v, i) => 0.5 * v + 0.5 * (b[i] as number));
  const candidates: [string, number[]][] = [
    ['model alone', model],
    ...(hasRollout ? ([['model + rollouts (50/50)', blend(model, rollout)]] as [string, number[]][]) : []),
    ['engine raw', engineRaw],
    ['engine calibrated', engineCal],
    ['engine calibrated + model (50/50)', blend(engineCal, model)],
  ];
  console.log('Log loss against the real winner (lower is better; 0.693 = coin flip):');
  const n = Math.max(1, labelled.length);
  for (const [name, p] of candidates) {
    const loss = p.reduce((sum, v, i) => sum + logLoss(v, y[i] as number), 0) / n;
    const right = p.filter((v, i) => v > 0.5 === (y[i] === 1)).length / n;
    console.log(`  ${name.padEnd(36)} ${loss.toFixed(4)}   accuracy ${(right * 100).toFixed(1)}%`);
  }

  // 2. Do players choose what the engine likes, and how do the grades fall?
  let judged = 0;
  let sameTop = 0;
  const counts = new Map<string, number>();
  const perGame = new Map<string, { p1: number[]; p2: number[]; y: number | null }>();
  for (const { state, result } of rows) {
    for (const side of ['p1', 'p2'] as const) {
      const list = result[side] ?? [];
      const judgement = judgeWithEngine(list, state.played[side]);
      if (judgement.grade === 'unknown' || judgement.grade === 'forced') continue;
      judged += 1;
      counts.set(judgement.grade, (counts.get(judgement.grade) ?? 0) + 1);
      const top = [...list].sort((a, b) => b.visits - a.visits)[0];
      if (top && top.engine === state.played[side]) sameTop += 1;
      const entry = perGame.get(state.id) ?? { p1: [], p2: [], y: state.y };
      entry[side].push(Math.max(0, judgement.loss ?? 0));
      perGame.set(state.id, entry);
    }
  }
  console.log(`\nDecisions graded by the engine: ${judged}`);
  console.log(`  played the engine's most-tried choice: ${((sameTop / Math.max(1, judged)) * 100).toFixed(1)}%`);
  console.log('  ' + ['best', 'good', 'inaccuracy', 'mistake', 'blunder'].map((g) => `${g} ${(((counts.get(g) ?? 0) / Math.max(1, judged)) * 100).toFixed(0)}%`).join(', '));

  // 3. Does the winner make fewer errors? A useful grade should say yes most of the time.
  let compared = 0;
  let winnerBetter = 0;
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
  for (const game of perGame.values()) {
    if (game.y === null || game.p1.length === 0 || game.p2.length === 0) continue;
    const a = mean(game.p1);
    const b = mean(game.p2);
    if (a === b) continue;
    compared += 1;
    if ((a < b) === (game.y === 1)) winnerBetter += 1;
  }
  console.log(`\nGames where the winner had the smaller average loss: ${winnerBetter} of ${compared} (${((winnerBetter / Math.max(1, compared)) * 100).toFixed(0)}%)`);
  console.log('A coin flip would give 50%.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
