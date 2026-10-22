/**
 * Metrics for probability forecasts.
 *
 * A win-probability model is judged on two things: whether its probabilities
 * are sharp (log loss, Brier score) and whether they are honest (calibration:
 * when it says 70%, the side should win about 70% of the time).
 */

/** One forecast and what actually happened. */
export interface Prediction {
  /** Forecast probability that player 1 wins. */
  probability: number;
  /** 1 if player 1 won, otherwise 0. */
  label: 0 | 1;
}

/** Log loss of always forecasting 50%: `ln 2`. A useful model beats it. */
export const BASELINE_LOG_LOSS = Math.LN2;

/** Brier score of always forecasting 50%. A useful model beats it. */
export const BASELINE_BRIER = 0.25;

const EPSILON = 1e-15;

function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Mean negative log-likelihood. Lower is better; probabilities are clipped
 * away from 0 and 1 so a single confident miss stays finite.
 *
 * @param predictions - Forecasts and outcomes. Empty input gives `NaN`.
 */
export function logLoss(predictions: readonly Prediction[]): number {
  return mean(
    predictions.map(({ probability, label }) => {
      const p = Math.min(Math.max(probability, EPSILON), 1 - EPSILON);
      return -(label === 1 ? Math.log(p) : Math.log(1 - p));
    }),
  );
}

/**
 * Mean squared error of the forecasts. Lower is better.
 *
 * @param predictions - Forecasts and outcomes. Empty input gives `NaN`.
 */
export function brierScore(predictions: readonly Prediction[]): number {
  return mean(predictions.map(({ probability, label }) => (probability - label) ** 2));
}

/**
 * Share of forecasts that picked the right winner, calling anything at or
 * above 50% a player 1 win.
 *
 * @param predictions - Forecasts and outcomes. Empty input gives `NaN`.
 */
export function accuracy(predictions: readonly Prediction[]): number {
  return mean(
    predictions.map(({ probability, label }) => ((probability >= 0.5 ? 1 : 0) === label ? 1 : 0)),
  );
}

/** One bucket of forecasts with similar probabilities. */
export interface CalibrationBin {
  /** Inclusive lower edge of the bucket. */
  lower: number;
  /** Exclusive upper edge (inclusive for the last bucket). */
  upper: number;
  count: number;
  /** Average forecast in the bucket. */
  meanPredicted: number;
  /** Share of forecasts in the bucket where player 1 actually won. */
  observedRate: number;
}

/**
 * Groups forecasts into equal-width probability buckets and compares the
 * average forecast with the observed win rate in each.
 *
 * @param predictions - Forecasts and outcomes.
 * @param bins - Number of buckets. Defaults to 10.
 * @returns Only the non-empty buckets, lowest first.
 */
export function calibration(predictions: readonly Prediction[], bins = 10): CalibrationBin[] {
  const groups: Prediction[][] = Array.from({ length: bins }, () => []);
  for (const prediction of predictions) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor(prediction.probability * bins)));
    groups[index]!.push(prediction);
  }

  const result: CalibrationBin[] = [];
  groups.forEach((group, index) => {
    if (group.length === 0) return;
    result.push({
      lower: index / bins,
      upper: (index + 1) / bins,
      count: group.length,
      meanPredicted: mean(group.map((p) => p.probability)),
      observedRate: mean(group.map((p) => p.label)),
    });
  });
  return result;
}
