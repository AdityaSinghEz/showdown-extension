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
import { judgeAgainstReply } from '../lib/review/reply';
import { chanceAfterMoves, evalBar, luckSwing, summarize, verdictFor, winChances, type Verdict } from '../lib/review/verdict';
import { bestExpectedValue, judgeWithEngine, rootValue, type EngineJudgement, type EnginePositionResult } from '../lib/review/engine-results';

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
    const names = { p1: 'You (p1)', p2: 'Opponent (p2)' };
    const tally = { p1: [] as Verdict[], p2: [] as Verdict[] };
    const misses = { p1: [] as { turn: number; move: string; cost: number }[], p2: [] as { turn: number; move: string; cost: number }[] };
    let afterPrevious: number | null = null;
    for (const { state, result } of game) {
      // With the equal-effort tables the bar comes from your table alone, so it is one consistent
      // evaluation; combining the two sides' tables made them disagree (each tests only some replies).
      const yours = bestExpectedValue(result.q?.p1);
      const chances = yours !== null ? winChances(yours, null) : winChances(rootValue(result.p1 ?? []), rootValue(result.p2 ?? []));
      const swing = luckSwing(afterPrevious, chances.p1);
      const luck =
        swing !== null && Math.abs(swing) >= 15
          ? `   (moved ${swing > 0 ? '+' : ''}${swing} points ${swing > 0 ? 'your way' : "the opponent's way"} beyond the two moves played: luck, like a crit, a miss or a damage roll, or something revealed, like a Tera or an item)`
          : '';
      console.log(
        `\nTurn ${String(state.turn).padStart(2)}   p1 ${String(chances.p1).padStart(3)}% ${evalBar(chances.p1)} ${String(chances.p2).padStart(3)}% p2${luck}`,
      );
      const values = { p1: null as number | null, p2: null as number | null };
      for (const name of ['p1', 'p2'] as const) {
        const played = state.played[name] ?? null;
        const other = state.played[name === 'p1' ? 'p2' : 'p1'] ?? null;
        const judgement = judgeWithEngine(result[name] ?? [], played, result.q?.[name], other);
        const reply = result.matrix ? judgeAgainstReply(result.matrix, name, played, other) : null;
        const verdict = verdictFor(judgement, reply);
        tally[name].push(verdict);
        // After both real moves, not the average over the replies the opponent might have made.
        values[name] = name === 'p1' && judgement.vsReply ? judgement.vsReply.value : judgement.value;
        if (judgement.value !== null && judgement.top !== null && judgement.top - judgement.value > 0) {
          misses[name].push({ turn: state.turn, move: played ?? '?', cost: Math.round((judgement.top - judgement.value) * 100) });
        }
        const score = verdict.score === null ? '' : `  ${verdict.score}/100`;
        console.log(`  ${names[name]}: ${played ?? '?'}  ->  ${verdict.tag.toUpperCase()}${score}${verdict.approximate ? '  (approximate: the engine rates this move roughly)' : ''}`);
        if (judgement.value !== null && judgement.top !== null && judgement.grade !== 'forced') {
          const bestMove = judgement.topMove;
          const gap = Math.round((judgement.top - judgement.value) * 100);
          console.log(
            `      win chance after this move ${Math.round(judgement.value * 100)}%, after the engine's best${bestMove ? ` (${bestMove})` : ''} ${Math.round(judgement.top * 100)}%${gap > 0 ? `  (cost ${gap} ${gap === 1 ? 'point' : 'points'})` : ''}`,
          );
        } else if (judgement.grade === 'unknown') {
          console.log('      not judged: the choice that was played could not be matched to the options');
        }
        if (judgement.vsReply && (verdict.tag === 'good prediction' || judgement.vsReply.best - judgement.vsReply.value > 0.05)) {
          const v = judgement.vsReply;
          console.log(
            `      against their actual ${v.reply}: this move ${Math.round(v.value * 100)}%, the best was ${v.bestMove} ${Math.round(v.best * 100)}%`,
          );
        }
        if (verdict.tag === 'good prediction' && other !== null) {
          console.log(`      the engine disliked it overall, but against their actual ${other} it was the right move`);
        }
        if (judgement.tera) {
          const t = judgement.tera;
          const worthShowing = t.action === 'used' || t.grade !== 'best' || (t.gain ?? 0) >= 0.05;
          if (worthShowing) console.log(`      Tera: ${t.grade.toUpperCase()} - ${t.note} ${t.gain === null ? '' : ` (${t.gain >= 0 ? '+' : ''}${(t.gain * 100).toFixed(0)} points)`}`);
        }
      }
      afterPrevious = chanceAfterMoves(values.p1, result.q?.p1 ? null : values.p2);
    }
    console.log('\nSummary');
    for (const name of ['p1', 'p2'] as const) {
      const sum = summarize(tally[name]);
      const mix = Object.entries(sum.counts).map(([tag, n]) => `${n} ${tag}`).join(', ');
      const worst = [...misses[name]].sort((a, b) => b.cost - a.cost).slice(0, 3).filter((m) => m.cost >= 5);
      console.log(`  ${names[name]}: average score ${sum.average === null ? 'n/a' : `${sum.average}/100`} over ${sum.judged} moves${sum.approximate > 0 ? ` (${sum.approximate} rough-engine ${sum.approximate === 1 ? 'move' : 'moves'} graded but not counted)` : ''}  (${mix})`);
      if (worst.length > 0) console.log(`      biggest misses: ${worst.map((m) => `turn ${m.turn} ${m.move} (-${m.cost})`).join(', ')}`);
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
