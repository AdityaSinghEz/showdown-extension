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
  /** 0 to 100, higher is better; `null` when the move could not be judged. */
  score: number | null;
}

/** Win probability lost at which the score reaches 0. */
export const SCORE_ZERO_LOSS = 0.25;

/** A move within this share of the line's spread of the best reply counts as a good prediction. */
export const PREDICTION_GAP = 0.1;

/** Lowest score a move with each tag can show, so the number never contradicts the tag. */
const SCORE_FLOOR: Partial<Record<VerdictTag, number>> = { best: 90, good: 75, 'good prediction': 70 };

/**
 * Score out of 100: 100 for no win probability lost, falling in a straight line to 0 at a
 * loss of {@link SCORE_ZERO_LOSS}.
 */
export function moveScore(loss: number): number {
  return Math.round(100 * (1 - Math.min(1, Math.max(0, loss) / SCORE_ZERO_LOSS)));
}

/**
 * Combines the engine's grade with the reply check.
 *
 * @param judgement - The engine's judgement of the move.
 * @param reply - How the move did against the opponent's actual reply, or `null` when not available.
 */
export function verdictFor(judgement: EngineJudgement, reply: ReplyJudgement | null): Verdict {
  if (judgement.grade === 'unknown') return { tag: 'unknown', score: null };
  if (judgement.grade === 'forced') return { tag: 'forced', score: null };
  const base = moveScore(judgement.loss ?? 0);
  const notGood = judgement.grade === 'inaccuracy' || judgement.grade === 'mistake' || judgement.grade === 'blunder';
  const tag: VerdictTag = notGood && reply !== null && reply.gap < PREDICTION_GAP ? 'good prediction' : judgement.grade;
  return { tag, score: Math.max(base, SCORE_FLOOR[tag] ?? 0) };
}

/** Both sides' chances of winning at the start of a turn, as whole percentages that add to 100. */
export function winChances(p1Value: number | null, p2Value: number | null): { p1: number; p2: number } {
  if (p1Value === null && p2Value === null) return { p1: 50, p2: 50 };
  const a = p1Value ?? 1 - (p2Value ?? 0.5);
  const b = p2Value ?? 1 - a;
  const total = a + b;
  const p1 = total <= 0 ? 50 : Math.round((100 * a) / total);
  return { p1, p2: 100 - p1 };
}

/** A text bar: `width` blocks, filled in proportion to side one's chance. */
export function evalBar(p1Chance: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round((p1Chance / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Average score and tag counts over a side's moves. Moves that were not judged are counted but not averaged. */
export function summarize(verdicts: readonly Verdict[]): { average: number | null; judged: number; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  const scores: number[] = [];
  for (const verdict of verdicts) {
    counts[verdict.tag] = (counts[verdict.tag] ?? 0) + 1;
    if (verdict.score !== null) scores.push(verdict.score);
  }
  const average = scores.length === 0 ? null : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { average, judged: scores.length, counts };
}
