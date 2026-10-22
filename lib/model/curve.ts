/**
 * The win-probability curve of a game: the model's estimate of each player's
 * chances after every turn, like the evaluation bar in a chess review.
 */

import type { GameRecord } from '../dataset/record';
import { snapshotFeatures } from './features';
import { predictProbability, type LogisticModel } from './logistic';

/** The estimate after one turn. */
export interface CurvePoint {
  /** Turn number; `0` is the starting position. */
  turn: number;
  /**
   * Probability that player 1 wins, or `null` if the position could not be
   * evaluated (for example the team size was never announced).
   */
  p1WinProb: number | null;
}

/**
 * Evaluates every position of a game.
 *
 * The starting position is 50% by symmetry. A position where one side has no
 * Pokemon left is already decided and reported as exactly 0 or 1.
 *
 * @param model - A fitted model.
 * @param record - The game to evaluate.
 * @returns One point per recorded turn, in order.
 */
export function winCurve(model: LogisticModel, record: GameRecord): CurvePoint[] {
  return record.turns.map((turn) => {
    if (turn.turn === 0) return { turn: 0, p1WinProb: 0.5 };

    const end = turn.endState;
    if (end === null) return { turn: turn.turn, p1WinProb: null };
    if (end.p1.remaining === 0) return { turn: turn.turn, p1WinProb: 0 };
    if (end.p2.remaining === 0) return { turn: turn.turn, p1WinProb: 1 };

    const features = snapshotFeatures(end.p1, end.p2);
    return {
      turn: turn.turn,
      p1WinProb: features === null ? null : predictProbability(model, features),
    };
  });
}
