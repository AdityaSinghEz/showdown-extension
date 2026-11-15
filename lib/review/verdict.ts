/**
 * The final verdict shown for a move.
 *
 * Two things feed it. The engine's grade says whether the move was good for
 * the position as a whole. The reply check (see `reply.ts`) says how the move
 * did against the reply the opponent really played. A move the engine did not
 * like can still be a "good prediction" when it was right against that real
 * reply; otherwise it keeps its engine grade (inaccuracy, mistake or blunder).
 *
 * Every verdict also carries a score out of 100, so a move reads like a test
 * mark instead of a probability.
 */

import type { EngineJudgement } from './engine-results';
import type { Grade } from './grade';
import type { ReplyJudgement } from './reply';

export type VerdictTag = Grade | 'good prediction' | 'forced' | 'unknown';

export interface Verdict {
  tag: VerdictTag;
  /** True when the engine's number for this move is rough, so the grade is less certain. */
  approximate: boolean;
  /** 0 to 100, higher is better; `null` when the move could not be judged. */
  score: number | null;
}

/**
 * Score anchors as [win probability lost, score]. They follow the grade bands (best under 2 points,
 * good under 5, inaccuracy under 10, mistake under 20), so the score tells a 3-point loss from a
 * 10-point one. Between anchors the score falls in a straight line; at the last it reaches 0.
 */
export const SCORE_ANCHORS: readonly (readonly [number, number])[] = [
  [0, 100],
  [0.02, 90],
  [0.05, 75],
  [0.1, 50],
  [0.2, 20],
  [0.3, 0],
];

/** A move within this share of the line's spread of the best reply counts as a good prediction. */
export const PREDICTION_GAP = 0.1;

/** Win probability a move may trail the best move against the opponent's actual reply and still be a good prediction. */
export const PREDICTION_LOSS = 0.03;

/** Lowest score a move with each tag can show, so the number never contradicts the tag. */
const SCORE_FLOOR: Partial<Record<VerdictTag, number>> = { best: 85, good: 60, 'good prediction': 70 };

/** Score out of 100 for a move that lost `loss` win probability, by {@link SCORE_ANCHORS}. */
export function moveScore(loss: number): number {
  const lost = Math.max(0, loss);
  for (let i = 1; i < SCORE_ANCHORS.length; i++) {
    const [x1, y1] = SCORE_ANCHORS[i] as readonly [number, number];
    if (lost <= x1) {
      const [x0, y0] = SCORE_ANCHORS[i - 1] as readonly [number, number];
      return Math.round(y0 + ((y1 - y0) * (lost - x0)) / (x1 - x0));
    }
  }
  return 0;
}

/**
 * Combines the engine's grade with the reply check.
 *
 * @param judgement - The engine's judgement of the move.
 * @param reply - How the move did against the opponent's actual reply, or `null` when not available.
 */
export function verdictFor(judgement: EngineJudgement, reply: ReplyJudgement | null): Verdict {
  if (judgement.grade === 'unknown') return { tag: 'unknown', approximate: false, score: null };
  // Only one legal choice: it cannot be played better or worse.
  if (judgement.grade === 'forced') return { tag: 'forced', approximate: false, score: 100 };
  const base = moveScore(judgement.loss ?? 0);
  const notGood = judgement.grade === 'inaccuracy' || judgement.grade === 'mistake' || judgement.grade === 'blunder';
  // Prefer the equal-effort comparison against the actual reply; fall back to the payoff table.
  const fitted =
    judgement.vsReply !== null
      ? judgement.vsReply.best - judgement.vsReply.value <= PREDICTION_LOSS
      : reply !== null && reply.gap < PREDICTION_GAP;
  const tag: VerdictTag = notGood && fitted ? 'good prediction' : judgement.grade;
  return { tag, approximate: judgement.approximate, score: Math.max(base, SCORE_FLOOR[tag] ?? 0) };
}

/**
 * Both sides' chances of winning at the start of a turn, as whole percentages that add to 100.
 *
 * Each side's search gives that side's own estimate, and the two come from slightly
 * different views (each side hides what the other could not see), so they do not add up
 * to exactly 1. Averaging side one's estimate with the complement of side two's lets
 * neither view dominate, which keeps the bar steadier from turn to turn.
 */
export function winChances(p1Value: number | null, p2Value: number | null): { p1: number; p2: number } {
  if (p1Value === null && p2Value === null) return { p1: 50, p2: 50 };
  const a = p1Value ?? 1 - (p2Value ?? 0.5);
  const b = 1 - (p2Value ?? 1 - a);
  const p1 = Math.max(0, Math.min(100, Math.round((100 * (a + b)) / 2)));
  return { p1, p2: 100 - p1 };
}

/**
 * How far the position moved beyond what the two moves explain.
 *
 * The search's value for each played move is the average over everything that could
 * happen next. The next turn's chance is what actually happened. A large gap is
 * usually luck (a crit, a miss, a damage roll, a multi-hit) and not a mistake.
 *
 * @param expectedAfter - Side one's chance after both moves, as a percentage, or `null`.
 * @param actualNext - Side one's chance at the start of the next turn, as a percentage.
 * @returns Percentage points in side one's favour (negative for side two), or `null` if unknown.
 */
export function luckSwing(expectedAfter: number | null, actualNext: number | null): number | null {
  if (expectedAfter === null || actualNext === null) return null;
  return Math.round(actualNext - expectedAfter);
}

/** Side one's chance after both sides played, from each side's own value for its move, as a percentage. */
export function chanceAfterMoves(p1Value: number | null, p2Value: number | null): number | null {
  if (p1Value === null && p2Value === null) return null;
  const a = p1Value ?? 1 - (p2Value ?? 0.5);
  const b = 1 - (p2Value ?? 1 - a);
  return (100 * (a + b)) / 2;
}

/** A text bar: `width` blocks, filled in proportion to side one's chance. */
export function evalBar(p1Chance: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round((p1Chance / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * Average score and tag counts over a side's moves.
 *
 * Moves that were not judged are counted but not averaged. Moves the engine rates
 * only roughly (flagged `approximate`) keep their grade and appear in the counts, but
 * are left out of the average, so one rough number cannot swing a game's score.
 */
export function summarize(verdicts: readonly Verdict[]): {
  average: number | null;
  judged: number;
  approximate: number;
  counts: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  const scores: number[] = [];
  let approximate = 0;
  for (const verdict of verdicts) {
    counts[verdict.tag] = (counts[verdict.tag] ?? 0) + 1;
    if (verdict.score === null) continue;
    if (verdict.approximate) approximate += 1;
    else scores.push(verdict.score);
  }
  const average = scores.length === 0 ? null : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { average, judged: scores.length, approximate, counts };
}
