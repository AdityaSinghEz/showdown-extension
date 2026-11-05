/**
 * Reading the output of the poke-engine search.
 *
 * For each side the search reports, per legal choice, how often it was picked
 * (`visits`) and the total of the results it led to (`score`, a win score from
 * that side's point of view between 0 and 1). The average, score divided by
 * visits, is how well the choice did against the opponent's play in the search.
 * Grading compares the played choice with the best of these averages, the same
 * idea as the matrix-game grading in `engine.ts` but with a far stronger
 * evaluation behind the numbers.
 */

import { gradeLoss, type Grade } from './grade';

/** One choice's result from the search. */
export interface EngineChoiceResult {
  engine: string;
  visits: number;
  score: number;
}

/** The search result for one position. */
export interface EnginePositionResult {
  id: string;
  turn: number;
  total?: number;
  p1?: EngineChoiceResult[];
  p2?: EngineChoiceResult[];
  error?: string;
}

/** Smallest share of the search a choice needs before it can count as "best". */
export const MIN_SHARE = 0.02;

/**
 * The side's overall result: the visit-weighted average over its choices.
 *
 * @returns A win score for that side between 0 and 1, or `null` with no visits.
 */
export function rootValue(side: readonly EngineChoiceResult[]): number | null {
  const visits = side.reduce((sum, choice) => sum + choice.visits, 0);
  if (visits === 0) return null;
  return side.reduce((sum, choice) => sum + choice.score, 0) / visits;
}

/** Average result of one choice, or `null` if it was never tried. */
export function choiceValue(choice: EngineChoiceResult): number | null {
  return choice.visits > 0 ? choice.score / choice.visits : null;
}

/** A graded decision. */
export interface EngineJudgement {
  /** Win probability given up against the best choice, as a fraction. */
  loss: number | null;
  grade: Grade | 'unknown' | 'forced';
  /** The most-tried choices, best first, with their share of the search. */
  best: { engine: string; share: number }[];
}

/**
 * Grades the played choice against the search result.
 *
 * Choices tried in less than {@link MIN_SHARE} of the search are ignored when
 * looking for the best one, because a handful of tries is too noisy to trust.
 *
 * @param side - The search result for one side.
 * @param played - The engine name of the choice that was played, or null if unknown.
 */
export function judgeWithEngine(side: readonly EngineChoiceResult[], played: string | null): EngineJudgement {
  const visits = side.reduce((sum, choice) => sum + choice.visits, 0);
  const best = [...side]
    .sort((a, b) => b.visits - a.visits)
    .filter((choice) => visits > 0 && choice.visits / visits >= 0.05)
    .map((choice) => ({ engine: choice.engine, share: choice.visits / visits }));
  if (played === null || visits === 0) return { loss: null, grade: 'unknown', best };
  const mine = side.find((choice) => choice.engine === played);
  const mineValue = mine === undefined ? null : choiceValue(mine);
  if (mineValue === null) return { loss: null, grade: 'unknown', best };
  if (side.length === 1) return { loss: 0, grade: 'forced', best };
  let top = mineValue;
  for (const choice of side) {
    const value = choiceValue(choice);
    if (value !== null && choice.visits / visits >= MIN_SHARE && value > top) top = value;
  }
  const loss = top - mineValue;
  return { loss, grade: gradeLoss(loss), best };
}
