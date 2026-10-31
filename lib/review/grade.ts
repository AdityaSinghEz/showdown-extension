/**
 * Labels for a decision, in the spirit of a chess game review.
 *
 * A decision's loss is how much win probability the player gave up compared
 * with the best option, as a fraction between 0 and 1 (0.05 = 5 percentage
 * points). The thresholds are a first guess and should be tuned on real games.
 */

/** A grade, from best to worst. */
export type Grade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** Upper bounds (exclusive) of each grade, as a loss in win probability. */
export const GRADE_LIMITS: readonly { grade: Grade; below: number }[] = [
  { grade: 'best', below: 0.02 },
  { grade: 'good', below: 0.05 },
  { grade: 'inaccuracy', below: 0.1 },
  { grade: 'mistake', below: 0.2 },
  { grade: 'blunder', below: Infinity },
];

/**
 * Grades a decision by the win probability it gave up.
 *
 * @param loss - Probability lost against the best option; negative values (noise) count as 0.
 */
export function gradeLoss(loss: number): Grade {
  const clamped = Math.max(0, loss);
  for (const { grade, below } of GRADE_LIMITS) {
    if (clamped < below) return grade;
  }
  return 'blunder';
}
