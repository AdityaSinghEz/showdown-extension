/**
 * Calibrating a score into a probability.
 *
 * The search's win score is not guaranteed to be a calibrated probability. A
 * one-number logistic fit, `p = sigmoid(a * logit(score))`, stretches or
 * shrinks it onto real outcomes, which makes its log loss comparable with the
 * other estimates. There is deliberately no offset: the offset would let the
 * fit learn "player 1 wins more often" instead of how good the score is, and a
 * position reading must be symmetric between the two sides.
 */

import { sigmoid } from '../model/logistic';

/** The fitted mapping. */
export interface Calibration {
  /** Slope on the log-odds: above 1 stretches the score, below 1 shrinks it toward 50%. */
  a: number;
}

const EPS = 1e-4;

function logit(p: number): number {
  const q = Math.min(1 - EPS, Math.max(EPS, p));
  return Math.log(q / (1 - q));
}

/**
 * Fits the mapping by gradient descent on log loss.
 *
 * @param scores - Raw scores between 0 and 1.
 * @param outcomes - 1 if the side won, else 0.
 */
export function fitCalibration(scores: readonly number[], outcomes: readonly number[]): Calibration {
  let a = 1;
  const n = scores.length;
  if (n === 0) return { a };
  const xs = scores.map(logit);
  for (let iteration = 0; iteration < 500; iteration++) {
    let ga = 0;
    for (let i = 0; i < n; i++) {
      const error = sigmoid(a * (xs[i] as number)) - (outcomes[i] as number);
      ga += error * (xs[i] as number);
    }
    a -= (0.5 * ga) / n;
  }
  return { a };
}

/** Applies a fitted mapping to a raw score. */
export function applyCalibration(calibration: Calibration, score: number): number {
  return sigmoid(calibration.a * logit(score));
}
