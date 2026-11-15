/**
 * Compares ways of summarising a game's move grades into one number, by how often the number
 * is better for the player who won. Uses saved search results; it does not search again.
 *
 * Usage:
 *   npm run engine:tune
 *
 * Each statistic is computed per player per game. A statistic "agrees" in a game when the
 * winner's value is the better one. The games are split into two halves by a hash of the game id,
 * so a statistic that looks good on one half and not the other is probably noise. With about 120
 * games the uncertainty is roughly plus or minus 9 points, so only large, steady gaps mean much.
 */

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { hashString } from '../lib/model/split';
import { bestExpectedValue, judgeWithEngine, type EnginePositionResult } from '../lib/review/engine-results';
import { verdictFor } from '../lib/review/verdict';

interface StateRow {
  id: string;
  turn: number;
  y: number | null;
  played: { p1: string | null; p2: string | null };
}

interface Move {
  loss: number;
  score: number | null;
  approximate: boolean;
  bad: boolean;
  good: boolean;
  readCost: number | null;
  decided: boolean;
}

/** A position counts as decided when the bar is this far from even; moves there change little. */
const DECIDED = 0.1;

async function readLines<T>(path: string): Promise<T[]> {
  return (await readFile(path, 'utf8')).split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as T);
}

const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;

interface Statistic {
  name: string;
  /** `null` when the game has too few moves for this statistic. */
  value: (moves: Move[]) => number | null;
  higherIsBetter: boolean;
}

const MIN_MOVES = 3;

const statistics: Statistic[] = [
  {
    name: 'average score (as the review shows it)',
    value: (m) => {
      const s = m.filter((x) => x.score !== null && !x.approximate).map((x) => x.score as number);
      return s.length >= MIN_MOVES ? mean(s) : null;
    },
    higherIsBetter: true,
  },
  { name: 'average loss', value: (m) => (m.length >= MIN_MOVES ? mean(m.map((x) => x.loss)) : null), higherIsBetter: false },
  {
    name: 'average loss, undecided positions only',
    value: (m) => {
      const u = m.filter((x) => !x.decided);
      return u.length >= MIN_MOVES ? mean(u.map((x) => x.loss)) : null;
    },
    higherIsBetter: false,
  },
  { name: 'total loss', value: (m) => (m.length >= MIN_MOVES ? m.reduce((s, x) => s + x.loss, 0) : null), higherIsBetter: false },
  { name: 'average squared loss (punishes big misses)', value: (m) => (m.length >= MIN_MOVES ? mean(m.map((x) => x.loss * x.loss)) : null), higherIsBetter: false },
  { name: 'share of mistakes and blunders', value: (m) => (m.length >= MIN_MOVES ? m.filter((x) => x.bad).length / m.length : null), higherIsBetter: false },
  { name: 'share of best and good moves', value: (m) => (m.length >= MIN_MOVES ? m.filter((x) => x.good).length / m.length : null), higherIsBetter: true },
  {
    name: 'average cost against the actual reply',
    value: (m) => {
      const r = m.filter((x) => x.readCost !== null).map((x) => x.readCost as number);
      return r.length >= MIN_MOVES ? mean(r) : null;
    },
    higherIsBetter: false,
  },
];

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      states: { type: 'string', default: 'data/engine-states.jsonl' },
      results: { type: 'string', default: 'data/engine-results.jsonl' },
    },
  });
  const states = await readLines<StateRow>(values.states ?? 'data/engine-states.jsonl');
  const results = await readLines<EnginePositionResult>(values.results ?? 'data/engine-results.jsonl');
  const byKey = new Map(results.map((r) => [`${r.id}:${r.turn}`, r]));

  const games = new Map<string, { y: number | null; p1: Move[]; p2: Move[] }>();
  for (const state of states) {
    const result = byKey.get(`${state.id}:${state.turn}`);
    if (!result || result.error !== undefined || !result.p1 || !result.p2) continue;
    const bar = bestExpectedValue(result.bar?.p1);
    const decided = bar !== null && (bar < DECIDED || bar > 1 - DECIDED);
    const game = games.get(state.id) ?? { y: state.y, p1: [], p2: [] };
    for (const side of ['p1', 'p2'] as const) {
      const other = state.played[side === 'p1' ? 'p2' : 'p1'] ?? null;
      const judgement = judgeWithEngine(result[side] ?? [], state.played[side], result.q?.[side], other);
      if (judgement.grade === 'unknown' || judgement.grade === 'forced') continue;
      const verdict = verdictFor(judgement, null);
      game[side].push({
        loss: Math.max(0, judgement.loss ?? 0),
        score: verdict.score,
        approximate: verdict.approximate,
        bad: judgement.grade === 'mistake' || judgement.grade === 'blunder',
        good: judgement.grade === 'best' || judgement.grade === 'good',
        readCost: judgement.vsReply ? Math.max(0, judgement.vsReply.best - judgement.vsReply.value) : null,
        decided,
      });
    }
    games.set(state.id, game);
  }

  const labelled = [...games.entries()].filter(([, g]) => g.y !== null);
  console.log(`${labelled.length} games with a known winner.\n`);
  console.log('How often the winner has the better value (50% = no information):');
  console.log(`${'statistic'.padEnd(46)} ${'all games'.padStart(14)} ${'half A'.padStart(8)} ${'half B'.padStart(8)}`);

  const rowsOut: { name: string; line: string; all: number }[] = [];
  for (const stat of statistics) {
    const tally = { all: [0, 0], a: [0, 0], b: [0, 0] };
    for (const [id, game] of labelled) {
      const v1 = stat.value(game.p1);
      const v2 = stat.value(game.p2);
      if (v1 === null || v2 === null || v1 === v2) continue;
      const p1Better = stat.higherIsBetter ? v1 > v2 : v1 < v2;
      const agree = p1Better === (game.y === 1) ? 1 : 0;
      const half = hashString(id) % 2 === 0 ? tally.a : tally.b;
      for (const t of [tally.all, half]) {
        t[0] = (t[0] ?? 0) + agree;
        t[1] = (t[1] ?? 0) + 1;
      }
    }
    const show = (t: number[]): string => ((t[1] ?? 0) === 0 ? 'n/a' : `${Math.round((100 * (t[0] ?? 0)) / (t[1] ?? 1))}%`);
    const allShare = (tally.all[1] ?? 0) === 0 ? 0 : (tally.all[0] ?? 0) / (tally.all[1] ?? 1);
    rowsOut.push({
      name: stat.name,
      all: allShare,
      line: `${stat.name.padEnd(46)} ${`${show(tally.all)} (${tally.all[0]}/${tally.all[1]})`.padStart(14)} ${show(tally.a).padStart(8)} ${show(tally.b).padStart(8)}`,
    });
  }
  for (const row of rowsOut.sort((x, y) => y.all - x.all)) console.log(row.line);
  console.log('\nA gap between half A and half B of more than about 10 points means the result is not steady.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
