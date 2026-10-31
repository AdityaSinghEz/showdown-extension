/**
 * Reviews one recorded game turn by turn.
 *
 * Usage:
 *
 * ```
 * npm run review:game -- --id gen9randombattle-2701773375
 * npm run review:game -- --id gen9randombattle-2701773375 --turns 3-8 --samples 4
 * ```
 *
 * For each turn this tries every legal choice for both players from the
 * saved position, scores the results with the win-probability model, and
 * grades what each player actually did against the best play. Needs the
 * replay in `data/raw`, the model from `npm run model:train`, and the matching
 * Showdown build from `npm run sim:setup`.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { LogisticModel } from '../lib/model/logistic';
import { collectTurnStarts, reviewTurn, type Judgement, type TurnReview } from '../lib/review/engine';
import { loadBuiltSim } from '../lib/review/sim';
import { simFolderName, versionFromInputLog } from '../lib/replay/version';

function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function describe(judgement: Judgement): string {
  if (judgement.played === null) return '(choice not matched)';
  const played = judgement.played.label;
  if (judgement.grade === 'forced') return `${played}  [only option]`;
  const loss = judgement.loss === null ? '' : ` -${(Math.max(0, judgement.loss) * 100).toFixed(1)}`;
  return `${played}  [${judgement.grade}${loss}]`;
}

function bestText(judgement: Judgement): string {
  return judgement.best.map((b) => `${b.option.label} ${pct(b.share)}`).join(', ');
}

function parseRange(text: string | undefined): [number, number] {
  if (text === undefined) return [1, Infinity];
  const match = /^(\d+)(?:-(\d+))?$/.exec(text);
  if (!match) throw new Error('--turns must look like 5 or 3-8');
  const from = Number(match[1]);
  return [from, match[2] === undefined ? from : Number(match[2])];
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      id: { type: 'string' },
      data: { type: 'string', default: 'data' },
      model: { type: 'string', default: 'data/model.json' },
      'sim-root': { type: 'string', default: '..' },
      samples: { type: 'string', default: '4' },
      turns: { type: 'string' },
      'no-tera': { type: 'boolean', default: false },
    },
  });
  if (values.id === undefined) throw new Error('Give a game with --id, for example --id gen9randombattle-2701773375');
  const samples = Number(values.samples);
  if (!Number.isInteger(samples) || samples < 1) throw new Error('--samples must be a whole number of 1 or more');
  const [fromTurn, toTurn] = parseRange(values.turns);

  const replay = JSON.parse(await readFile(join(values.data ?? 'data', 'raw', `${values.id}.json`), 'utf8')) as {
    inputlog?: string;
    players: [string, string];
  };
  if (!replay.inputlog) throw new Error('This replay has no input log. Run: npm run replays:download -- --backfill');
  const model = JSON.parse(await readFile(values.model ?? 'data/model.json', 'utf8')) as LogisticModel;

  const version = versionFromInputLog(replay.inputlog);
  if (!version) throw new Error('The replay names no Showdown version');
  const folder = join(resolve(values['sim-root'] ?? '..'), simFolderName(version));
  const sim = loadBuiltSim(folder);

  const [p1Name, p2Name] = replay.players;
  console.log(`${values.id}: ${p1Name} (p1) vs ${p2Name} (p2), Showdown build ${version.short}`);
  console.log('Grades compare each choice with best play from the same position; the loss is in win-probability points.\n');

  const starts = (await collectTurnStarts(sim, replay.inputlog)).filter((s) => s.turn >= fromTurn && s.turn <= toTurn);
  const reviews: TurnReview[] = [];
  for (const start of starts) {
    const began = Date.now();
    const review = reviewTurn(sim, model, start, { samples, includeTera: values['no-tera'] !== true });
    if (review === null) {
      console.log(`Turn ${String(start.turn).padStart(2)}: skipped (a side was not making a normal choice)`);
      continue;
    }
    reviews.push(review);
    console.log(
      `Turn ${String(start.turn).padStart(2)}  best-play value for ${p1Name}: ${pct(review.value)}   (${((Date.now() - began) / 1000).toFixed(1)}s)`,
    );
    console.log(`   ${p1Name}: ${describe(review.p1)}`);
    if (review.p1.grade !== 'best' && review.p1.grade !== 'forced') console.log(`      best play: ${bestText(review.p1)}`);
    console.log(`   ${p2Name}: ${describe(review.p2)}`);
    if (review.p2.grade !== 'best' && review.p2.grade !== 'forced') console.log(`      best play: ${bestText(review.p2)}`);
    if (review.failures > 0) console.log(`   note: ${review.failures} option pairs could not be simulated`);
  }

  console.log('\nSummary (graded decisions only):');
  for (const [name, side] of [[p1Name, 'p1'], [p2Name, 'p2']] as const) {
    const judged = reviews.map((r) => r[side]).filter((j) => j.loss !== null && j.grade !== 'forced');
    const counts = new Map<string, number>();
    for (const j of judged) counts.set(j.grade, (counts.get(j.grade) ?? 0) + 1);
    const average = judged.length === 0 ? 0 : judged.reduce((sum, j) => sum + Math.max(0, j.loss ?? 0), 0) / judged.length;
    const text = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'].map((g) => `${g} ${counts.get(g) ?? 0}`).join(', ');
    console.log(`  ${name}: ${judged.length} decisions, average loss ${(average * 100).toFixed(1)} points. ${text}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
