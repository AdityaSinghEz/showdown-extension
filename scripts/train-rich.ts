/**
 * Trains the full-information position scorer and compares it with the
 * spectator-log feature set on the same games.
 *
 * Usage:
 *
 * ```
 * npm run model:train-rich
 * ```
 *
 * Reads `data/states.jsonl` (from `npm run states:build`), holds out a share of
 * games for testing (split by game, never by position), fits one model on the
 * original five features and one on all of them, and prints how each scores.
 * Writes the full model to `data/model-rich.json`, which `npm run review:game`
 * accepts with `--model data/model-rich.json`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { accuracy, BASELINE_BRIER, BASELINE_LOG_LOSS, brierScore, calibration, logLoss, type Prediction } from '../lib/model/evaluate';
import { predictProbability, trainLogistic } from '../lib/model/logistic';
import { hashString, isTestGame } from '../lib/model/split';
import { RICH_FEATURE_NAMES } from '../lib/review/features';

interface Row {
  id: string;
  f: number[];
  y: 0 | 1;
}

function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function parseRows(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line) as Row;
      if (Array.isArray(row.f) && row.f.length === RICH_FEATURE_NAMES.length && (row.y === 0 || row.y === 1)) rows.push(row);
    } catch {
      // Skip unreadable lines.
    }
  }
  return rows;
}

/** Fits on the chosen feature columns and scores on the test rows. */
function fit(train: readonly Row[], test: readonly Row[], keep: readonly number[], l2: number) {
  const names = keep.map((i) => RICH_FEATURE_NAMES[i] ?? '');
  const pick = (rows: readonly Row[]) => rows.map((r) => ({ features: keep.map((i) => r.f[i] ?? 0), label: r.y }));
  const model = trainLogistic(names, pick(train), { l2 });
  const predict = (rows: readonly Row[]): Prediction[] =>
    pick(rows).map((r) => ({ probability: predictProbability(model, r.features), label: r.label }));
  return { model, trainPredictions: predict(train), testPredictions: predict(test) };
}

function score(name: string, predictions: readonly Prediction[]): void {
  console.log(
    `  ${name.padEnd(28)} log loss ${logLoss(predictions).toFixed(4)} | Brier ${brierScore(predictions).toFixed(4)} | accuracy ${pct(accuracy(predictions))}`,
  );
}

/** Mean and standard error of a list of numbers. */
function meanAndError(values: readonly number[]): { mean: number; error: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1) : 0;
  return { mean, error: Math.sqrt(variance / values.length) };
}

/** Held-out log loss of one feature set in each cross-validation fold. */
function cvLosses(rows: readonly Row[], folds: number, keep: readonly number[], l2: number, extra: readonly Row[]): number[] {
  const foldOf = (id: string): number => hashString(id) % folds;
  return Array.from({ length: folds }, (_, fold) => {
    const train = [...rows.filter((r) => foldOf(r.id) !== fold), ...extra];
    const test = rows.filter((r) => foldOf(r.id) === fold);
    return test.length === 0 ? NaN : logLoss(fit(train, test, keep, l2).testPredictions);
  });
}

function verdictOf(diff: { mean: number; error: number }): string {
  return diff.mean + 2 * diff.error < 0 ? 'helps' : diff.mean - 2 * diff.error > 0 ? 'hurts' : 'no clear effect';
}

/**
 * Cross-validation by game: every game is held out exactly once, so the result
 * does not depend on one lucky or unlucky test split. Compares the original
 * five features with the original plus each extra feature alone, and with all
 * of them. The comparison is paired: each fold scores every set on the same
 * held-out games, so the difference is far steadier than the raw scores.
 */
function crossValidate(rows: readonly Row[], folds: number, l2: number, extra: readonly Row[], allowed: readonly number[]): void {
  if (!Number.isInteger(folds) || folds < 2) throw new Error('--folds must be a whole number of 2 or more');
  const original = [0, 1, 2, 3, 4].filter((i) => allowed.includes(i));
  const extras = allowed.filter((i) => i >= 5);
  const sets: { name: string; keep: number[] }[] = [
    { name: `original ${original.length} features`, keep: original },
    ...extras.map((i) => ({ name: `original + ${RICH_FEATURE_NAMES[i]}`, keep: [...original, i] })),
    { name: 'all allowed features', keep: [...allowed] },
  ];
  const losses = sets.map((set) => cvLosses(rows, folds, set.keep, l2, extra));

  console.log(`\nCross-validation, ${folds} folds by game (every game is held out once). Lower log loss is better.`);
  console.log('The difference is against the original features on the same held-out games; "+/-" is its standard error.');
  const reference = losses[0] as number[];
  sets.forEach((set, index) => {
    const own = losses[index] as number[];
    const { mean } = meanAndError(own);
    if (index === 0) {
      console.log(`  ${set.name.padEnd(30)} ${mean.toFixed(4)}`);
      return;
    }
    const diff = meanAndError(own.map((value, fold) => value - (reference[fold] as number)));
    console.log(
      `  ${set.name.padEnd(30)} ${mean.toFixed(4)}  difference ${diff.mean >= 0 ? '+' : ''}${diff.mean.toFixed(4)} +/- ${diff.error.toFixed(4)}  ${verdictOf(diff)}`,
    );
  });
}

/**
 * Forward selection: starting from the original features, repeatedly adds the
 * extra feature that lowers the cross-validated loss the most, as long as the
 * improvement is clear (more than two standard errors). Stops when nothing
 * helps. Returns the indexes of the chosen features.
 *
 * A feature can help only in combination with others, which this one-at-a-time
 * search cannot see, so {@link chooseFeatures} also considers using all of them.
 */
function selectFeatures(rows: readonly Row[], folds: number, l2: number, extra: readonly Row[], allowed: readonly number[]): number[] {
  let keep = [0, 1, 2, 3, 4].filter((i) => allowed.includes(i));
  let current = cvLosses(rows, folds, keep, l2, extra);
  console.log('\nFeature selection: adding the most useful extra feature one at a time while the gain is clear');
  for (;;) {
    let best: { index: number; losses: number[]; diff: { mean: number; error: number } } | null = null;
    for (const i of allowed) {
      if (keep.includes(i)) continue;
      const losses = cvLosses(rows, folds, [...keep, i], l2, extra);
      const diff = meanAndError(losses.map((value, fold) => value - (current[fold] as number)));
      if (best === null || diff.mean < best.diff.mean) best = { index: i, losses, diff };
    }
    if (best === null || verdictOf(best.diff) !== 'helps') {
      console.log('  nothing else helps clearly on its own; stopping');
      break;
    }
    keep = [...keep, best.index];
    current = best.losses;
    console.log(
      `  + ${(RICH_FEATURE_NAMES[best.index] ?? '').padEnd(13)} difference ${best.diff.mean.toFixed(4)} +/- ${best.diff.error.toFixed(4)}  (cross-validated log loss now ${meanAndError(current).mean.toFixed(4)})`,
    );
  }
  return keep;
}

/**
 * Picks the final feature set: the original features, the forward-selected set,
 * or all allowed features, whichever has the lowest cross-validated loss. When
 * two are within a hair of each other the smaller set wins.
 */
function chooseFeatures(rows: readonly Row[], folds: number, l2: number, extra: readonly Row[], allowed: readonly number[], selected: readonly number[]): number[] {
  const original = [0, 1, 2, 3, 4].filter((i) => allowed.includes(i));
  const candidates = [
    { name: 'original', keep: original },
    { name: 'forward-selected', keep: [...selected] },
    { name: 'all allowed', keep: [...allowed] },
  ];
  console.log('\nFinal choice by cross-validated log loss:');
  let best: { keep: number[]; mean: number } | null = null;
  for (const candidate of candidates) {
    const mean = meanAndError(cvLosses(rows, folds, candidate.keep, l2, extra)).mean;
    console.log(`  ${candidate.name.padEnd(17)} ${mean.toFixed(4)}  (${candidate.keep.length} features)`);
    if (best === null || mean < best.mean - 0.0005 || (Math.abs(mean - best.mean) <= 0.0005 && candidate.keep.length < best.keep.length)) {
      best = { keep: candidate.keep, mean };
    }
  }
  return (best as { keep: number[] }).keep;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      data: { type: 'string', default: 'data/states.jsonl' },
      out: { type: 'string', default: 'data/model-rich.json' },
      'test-percent': { type: 'string', default: '20' },
      l2: { type: 'string', default: '1' },
      folds: { type: 'string', default: '5' },
      extra: { type: 'string' },
      exclude: { type: 'string', default: '' },
    },
  });
  const testPercent = Number(values['test-percent']);
  const l2 = Number(values.l2);
  const rows = parseRows(await readFile(values.data ?? 'data/states.jsonl', 'utf8'));
  if (rows.length === 0) throw new Error('No positions found. Run: npm run states:build');

  // Extra positions (for example from self-play) are only ever used for training; the
  // scores are always measured on recorded human games.
  const extra = values.extra === undefined ? [] : parseRows(await readFile(values.extra, 'utf8'));
  if (values.extra !== undefined) console.log(`Adding ${extra.length} extra training positions from ${values.extra}`);
  const train = [...rows.filter((r) => !isTestGame(r.id, testPercent)), ...extra];
  const test = rows.filter((r) => isTestGame(r.id, testPercent));
  const gameCount = (list: readonly Row[]) => new Set(list.map((r) => r.id)).size;
  console.log(`${rows.length} human positions; training uses ${train.length} (${gameCount(train)} games), test ${test.length} (${gameCount(test)} human games)`);
  if (gameCount(test) < 30) console.warn('Warning: the test set is small, so treat the scores as a rough guide.');

  const all = RICH_FEATURE_NAMES.map((_, i) => i);
  const original = [0, 1, 2, 3, 4];
  const baseline = fit(train, test, original, l2);
  const rich = fit(train, test, all, l2);

  console.log(`\nTest scores (lower is better). Guessing 50%: log loss ${BASELINE_LOG_LOSS.toFixed(4)}, Brier ${BASELINE_BRIER.toFixed(4)}`);
  score('original 5 features', baseline.testPredictions);
  score('all features', rich.testPredictions);
  console.log('\nTrain scores, to check for overfitting:');
  score('original 5 features', baseline.trainPredictions);
  score('all features', rich.trainPredictions);

  console.log('\nWeights of the full model (positive = being ahead raises your win chance):');
  RICH_FEATURE_NAMES.forEach((name, i) => {
    const weight = rich.model.weights[i] ?? 0;
    console.log(`  ${name.padEnd(13)} ${(weight >= 0 ? '+' : '') + weight.toFixed(3)}`);
  });

  console.log('\nFeature check: test log loss of the full model with one feature removed');
  const reference = logLoss(rich.testPredictions);
  all.forEach((i, position) => {
    const without = fit(train, test, all.filter((j) => j !== i), l2);
    const delta = logLoss(without.testPredictions) - reference;
    console.log(`  without ${(RICH_FEATURE_NAMES[position] ?? '').padEnd(13)} ${logLoss(without.testPredictions).toFixed(4)}  (${delta >= 0 ? '+' : ''}${delta.toFixed(4)})`);
  });

  const mirrored = rich.testPredictions.flatMap((p) => [p, { probability: 1 - p.probability, label: (1 - p.label) as 0 | 1 }]);
  console.log('\nCalibration of the full model on the test set, mirrored so player 1 skew cannot matter:');
  for (const bin of calibration(mirrored)) {
    console.log(
      `  ${pct(bin.lower, 0).padStart(4)}-${pct(bin.upper, 0).padEnd(4)} n=${String(bin.count).padStart(5)}  predicted ${pct(bin.meanPredicted)}  actual ${pct(bin.observedRate)}`,
    );
  }

  const folds = Number(values.folds);
  const excluded = (values.exclude ?? '').split(',').map((n) => n.trim()).filter((n) => n !== '');
  for (const name of excluded) {
    if (!(RICH_FEATURE_NAMES as readonly string[]).includes(name)) throw new Error(`--exclude: unknown feature "${name}"`);
  }
  const allowed = RICH_FEATURE_NAMES.map((_, i) => i).filter((i) => !excluded.includes(RICH_FEATURE_NAMES[i] ?? ''));
  if (excluded.length > 0) console.log(`\nExcluding from the final model: ${excluded.join(', ')}`);
  crossValidate(rows, folds, l2, extra, allowed);
  const selected = selectFeatures(rows, folds, l2, extra, allowed);
  const finalKeep = chooseFeatures(rows, folds, l2, extra, allowed, selected);
  const chosen = fit(train, test, finalKeep, l2);
  console.log(`\nSelected features: ${finalKeep.map((i) => RICH_FEATURE_NAMES[i]).join(', ')}`);
  score('selected, held-out split', chosen.testPredictions);

  const out = values.out ?? 'data/model-rich.json';
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ ...chosen.model, meta: { l2, testPercent, trainPositions: train.length, testPositions: test.length } }, null, 2));
  console.log(`\nSaved the model with the selected features to ${out}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
