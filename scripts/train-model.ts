/**
 * Trains and evaluates the win-probability baseline.
 *
 * Usage:
 *
 * ```
 * npm run model:train
 * npm run model:train -- --show 2701866020
 * npm run model:train -- --include-forfeits --test-percent 25
 * ```
 *
 * Reads `data/games.jsonl`, holds out a share of games for testing (split by
 * game, never by turn), fits a logistic regression on the rest, prints how it
 * scores, and writes the fitted weights to `data/model.json`.
 *
 * With `--show <game id>` it also prints the model's win-probability curve for
 * one game, turn by turn, with the moves played and any luck events.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { describeAction } from '../lib/battle/summary';
import { parseGames } from '../lib/dataset/load';
import type { GameRecord } from '../lib/dataset/record';
import { winCurve } from '../lib/model/curve';
import {
  accuracy,
  BASELINE_BRIER,
  BASELINE_LOG_LOSS,
  brierScore,
  calibration,
  logLoss,
  type Prediction,
} from '../lib/model/evaluate';
import { extractSamples, FEATURE_NAMES, hasTeamHp, type TurnSample } from '../lib/model/features';
import { predictProbability, trainLogistic, type LogisticModel } from '../lib/model/logistic';
import { isTestGame } from '../lib/model/split';

/** What a change of +1 in each feature means, for the weights table. */
const FEATURE_UNITS: Record<(typeof FEATURE_NAMES)[number], string> = {
  remaining: 'per extra Pokemon left',
  teamHp: 'per extra full Pokemon worth of team HP',
  activeHp: 'per +100% HP on the Pokemon in play',
  status: 'per opposing Pokemon crippled (vs. yours)',
  tera: 'for having used Tera when the opponent has not',
};

/** A swing in win probability at least this large is flagged in `--show`. */
const BIG_SWING = 0.15;

function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function predictAll(model: LogisticModel, samples: readonly TurnSample[]): Prediction[] {
  return samples.map((sample) => ({
    probability: predictProbability(model, sample.features),
    label: sample.label,
  }));
}

function describeSet(
  name: string,
  model: LogisticModel,
  games: number,
  samples: readonly TurnSample[],
): void {
  if (samples.length === 0) {
    console.log(`${name}: no data`);
    return;
  }
  const predictions = predictAll(model, samples);
  console.log(
    `${name}: ${games} games, ${samples.length} positions | ` +
      `log loss ${logLoss(predictions).toFixed(3)} | ` +
      `Brier ${brierScore(predictions).toFixed(3)} | ` +
      `accuracy ${pct(accuracy(predictions))}`,
  );
}

function playedActions(record: GameRecord, turnIndex: number, side: 'p1' | 'p2'): string {
  const turn = record.turns[turnIndex];
  if (!turn) return '-';
  const parts = turn.actions
    .filter((a) => a.side === side && a.viaEffect === null && a.kind !== 'drag')
    .map((a) => `${a.pokemon}: ${describeAction(a)}`);
  return parts.length > 0 ? parts.join('; ') : '-';
}

function luckNotes(record: GameRecord, turnIndex: number): string {
  const turn = record.turns[turnIndex];
  if (!turn || turn.luck.length === 0) return '';
  return turn.luck
    .map((l) => (l.kind === 'cant' ? `can't move: ${l.pokemon} (${l.detail ?? '?'})` : `${l.kind}: ${l.pokemon}`))
    .join(', ');
}

function showGame(model: LogisticModel, records: readonly GameRecord[], query: string): void {
  const record = records.find((r) => r.id === query || r.id.endsWith(`-${query}`));
  if (!record) {
    console.log(`\nNo game matching "${query}" in the dataset.`);
    return;
  }

  const { p1, p2 } = record.players;
  const winner = record.players[record.winner].name;
  console.log(`\n${record.id}: ${p1.name} (${p1.rating}) vs ${p2.name} (${p2.rating})`);
  const forfeit =
    record.forfeitedBy !== null ? `, ${record.players[record.forfeitedBy].name} forfeited` : record.forfeited ? ', ended by forfeit' : '';
  console.log(`Winner: ${winner}, ${record.turnCount} turns${forfeit}`);
  console.log(`P = chance that ${p1.name} wins after each turn. ">>" marks a swing of ${pct(BIG_SWING, 0)} or more.\n`);

  let previous = 0.5;
  winCurve(model, record).forEach((point, index) => {
    if (index === 0) return;
    const probability = point.p1WinProb;
    const change = probability === null ? null : probability - previous;
    const flag = change !== null && Math.abs(change) >= BIG_SWING ? '>>' : '  ';
    const probabilityText = probability === null ? '  n/a' : pct(probability, 0).padStart(5);
    const points = change === null ? null : Math.round(change * 100);
    const changeText =
      points === null ? '      ' : `${points >= 0 ? '+' : '-'}${Math.abs(points)}`.padStart(6);
    const luck = luckNotes(record, index);
    console.log(
      `${String(point.turn).padStart(3)}  P=${probabilityText} ${changeText} ${flag} ` +
        `${p1.name}: ${playedActions(record, index, 'p1')}  |  ${p2.name}: ${playedActions(record, index, 'p2')}` +
        (luck ? `   [${luck}]` : ''),
    );
    if (probability !== null) previous = probability;
  });
}

/** Adds the swapped-sides twin of every prediction (probability flipped, label flipped). */
function mirror(predictions: readonly Prediction[]): Prediction[] {
  return predictions.flatMap((p) => [
    p,
    { probability: 1 - p.probability, label: (1 - p.label) as 0 | 1 },
  ]);
}

function printCalibration(name: string, predictions: readonly Prediction[]): void {
  console.log(`\nCalibration, ${name} (predicted should match actual):`);
  for (const bin of calibration(predictions)) {
    console.log(
      `  ${pct(bin.lower, 0).padStart(4)}-${pct(bin.upper, 0).padEnd(4)} n=${String(bin.count).padStart(5)}  ` +
        `predicted ${pct(bin.meanPredicted)}  actual ${pct(bin.observedRate)}`,
    );
  }
}

/**
 * Refits the model with features removed and reports the test log loss, to show
 * which features earn their place. Lower is better; a feature whose removal
 * leaves the score unchanged or better adds nothing.
 */
function printFeatureAblation(train: readonly TurnSample[], test: readonly TurnSample[], l2: number): void {
  const fit = (keep: readonly number[]): number => {
    const names = keep.map((i) => FEATURE_NAMES[i] ?? '');
    const subset = (rows: readonly TurnSample[]) =>
      rows.map((s) => ({ features: keep.map((i) => s.features[i] ?? 0), label: s.label }));
    const model = trainLogistic(names, subset(train), { l2 });
    return logLoss(subset(test).map((r) => ({ probability: predictProbability(model, r.features), label: r.label })));
  };
  const all = FEATURE_NAMES.map((_, i) => i);
  console.log('\nFeature check (test log loss; lower is better):');
  console.log(`  all features              ${fit(all).toFixed(4)}`);
  FEATURE_NAMES.forEach((name, i) => {
    console.log(`  without ${name.padEnd(17)} ${fit(all.filter((j) => j !== i)).toFixed(4)}`);
  });
  console.log(`  teamHp only               ${fit([FEATURE_NAMES.indexOf('teamHp')]).toFixed(4)}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      data: { type: 'string', default: 'data/games.jsonl' },
      out: { type: 'string', default: 'data/model.json' },
      'include-forfeits': { type: 'boolean', default: false },
      'test-percent': { type: 'string', default: '20' },
      l2: { type: 'string', default: '1' },
      show: { type: 'string' },
    },
  });

  const testPercent = Number(values['test-percent']);
  const l2 = Number(values.l2);
  if (!Number.isFinite(testPercent) || testPercent < 0 || testPercent > 100) {
    throw new Error('--test-percent must be a number from 0 to 100');
  }
  if (!Number.isFinite(l2) || l2 < 0) throw new Error('--l2 must be a number of 0 or more');
  const includeForfeits = values['include-forfeits'] === true;

  const dataPath = values.data ?? 'data/games.jsonl';
  const { records, invalid } = parseGames(await readFile(dataPath, 'utf8'));
  console.log(`Loaded ${records.length} games from ${dataPath}${invalid > 0 ? ` (${invalid} unreadable lines skipped)` : ''}`);
  if (records.length === 0) {
    console.error('No games found. Run: npm run replays:download, then npm run dataset:build');
    process.exitCode = 1;
    return;
  }
  if (!records.some(hasTeamHp)) {
    console.error('These records were built before team HP was tracked. Rebuild them with: npm run dataset:build');
    process.exitCode = 1;
    return;
  }

  const train: TurnSample[] = [];
  const test: TurnSample[] = [];
  let trainGames = 0;
  let testGames = 0;
  let excludedForfeits = 0;
  let trainP1Wins = 0;
  let testP1Wins = 0;
  for (const record of records) {
    if (record.forfeited && !includeForfeits) excludedForfeits += 1;
    const samples = extractSamples(record, { includeForfeits });
    if (samples.length === 0) continue;
    if (isTestGame(record.id, testPercent)) {
      test.push(...samples);
      testGames += 1;
      if (record.winner === 'p1') testP1Wins += 1;
    } else {
      train.push(...samples);
      trainGames += 1;
      if (record.winner === 'p1') trainP1Wins += 1;
    }
  }
  console.log(
    `Using ${trainGames + testGames} games` +
      (excludedForfeits > 0 ? ` (${excludedForfeits} forfeits left out; use --include-forfeits to keep them)` : ''),
  );
  if (train.length === 0) {
    console.error('No training positions. Download more games and rebuild the dataset.');
    process.exitCode = 1;
    return;
  }
  if (trainGames < 30) console.warn('Warning: very few training games, so the weights will be noisy.');
  if (testGames < 30) console.warn('Warning: the test set is small, so treat the test score as a rough guide.');

  const model = trainLogistic(
    FEATURE_NAMES,
    train.map((s) => ({ features: s.features, label: s.label })),
    { l2 },
  );

  console.log('\nScores (lower log loss and Brier is better):');
  describeSet('train', model, trainGames, train);
  describeSet('test ', model, testGames, test);
  console.log(
    `guessing 50% every time: log loss ${BASELINE_LOG_LOSS.toFixed(3)} | Brier ${BASELINE_BRIER.toFixed(3)} | accuracy 50.0%`,
  );

  console.log(
    `\nPlayer 1 won ${pct(trainP1Wins / Math.max(trainGames, 1))} of train games and ` +
      `${pct(testP1Wins / Math.max(testGames, 1))} of test games (a large gap from 50% in the test split skews the plain calibration table).`,
  );

  console.log('\nWeights (positive = being ahead on that feature raises your win chance):');
  FEATURE_NAMES.forEach((name, i) => {
    const weight = model.weights[i] ?? 0;
    console.log(
      `  ${name.padEnd(10)} ${(weight >= 0 ? '+' : '') + weight.toFixed(3)}   x${Math.exp(weight).toFixed(2)} odds ${FEATURE_UNITS[name]}`,
    );
  });

  printCalibration('train', predictAll(model, train));
  if (test.length > 0) {
    printCalibration('test', predictAll(model, test));
    printCalibration('test, mirrored (each position also seen from the other side; removes any player 1 skew)', mirror(predictAll(model, test)));
  }

  if (test.length > 0) printFeatureAblation(train, test, l2);

  const outPath = values.out ?? 'data/model.json';
  await mkdir(dirname(outPath), { recursive: true });
  const testPredictions = predictAll(model, test);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        ...model,
        meta: {
          trainedGames: trainGames,
          trainedPositions: train.length,
          testGames,
          includeForfeits,
          l2,
          testPercent,
          testLogLoss: test.length > 0 ? logLoss(testPredictions) : null,
          testAccuracy: test.length > 0 ? accuracy(testPredictions) : null,
        },
      },
      null,
      2,
    ),
  );
  console.log(`\nSaved model to ${outPath}`);

  if (values.show !== undefined) showGame(model, records, values.show);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
