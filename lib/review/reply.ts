/**
 * Judging a move against the reply the opponent actually made.
 *
 * The main grade compares the played move with the engine's alternatives
 * across the opponent's whole mix of replies. That says whether the decision
 * was sound, but a player who correctly predicted an unlikely reply (for
 * example a switch) looks wrong. This module reads poke-engine's payoff table,
 * one row per choice of side one and one column per choice of side two, and
 * asks a second question: against the reply that was really played, how did
 * the chosen move rank?
 *
 * The table holds the engine's evaluation scores, not win probabilities, so
 * moves are compared by rank and by their gap relative to the spread of the
 * line, never by absolute value. Cells the search skipped are `null`.
 */

/** Payoff table of one position. `values` is row-major: rows are `p1`, columns are `p2`. */
export interface PayoffMatrix {
  p1: string[];
  p2: string[];
  /** Evaluation scores from side one's point of view, higher is better for side one. `null` where the search skipped. */
  values: (number | null)[];
  depth: number;
}

/** How a move did against the reply that was actually played. */
export interface ReplyJudgement {
  /** 1 is the best choice against that reply. */
  rank: number;
  outOf: number;
  /** The best choice against that reply. */
  best: string;
  /** Gap to the best choice as a share of the line's spread, 0 to 1. */
  gap: number;
  label: 'best' | 'good' | 'poor';
}

/** Gap (share of the line's spread) under which a move counts as "best" against the reply. */
export const REPLY_BEST_GAP = 0.05;

/** Gap under which a move counts as "good" against the reply. */
export const REPLY_GOOD_GAP = 0.2;

/** Finds a played choice in the table's labels, falling back to the same move without Tera. */
function indexOfChoice(labels: readonly string[], played: string): number {
  const exact = labels.indexOf(played);
  if (exact >= 0) return exact;
  return labels.indexOf(played.replace(/-tera$/, ''));
}

/**
 * Ranks one side's played choice against the other side's played choice.
 *
 * @param matrix - The payoff table for the position.
 * @param side - Which side is being judged.
 * @param mine - The engine name of the move that side played.
 * @param theirs - The engine name of the move the other side played.
 * @returns The judgement, or `null` if either move is missing or the line is too thin to compare.
 */
export function judgeAgainstReply(
  matrix: PayoffMatrix,
  side: 'p1' | 'p2',
  mine: string | null,
  theirs: string | null,
): ReplyJudgement | null {
  if (mine === null || theirs === null) return null;
  const rowLabels = matrix.p1;
  const colLabels = matrix.p2;
  const row = indexOfChoice(rowLabels, side === 'p1' ? mine : theirs);
  const col = indexOfChoice(colLabels, side === 'p1' ? theirs : mine);
  if (row < 0 || col < 0) return null;

  // Orient the table so higher is better for the side being judged. Side one
  // reads down a column, side two reads along a row with the sign flipped.
  const line: { label: string; score: number | null }[] = [];
  if (side === 'p1') {
    for (let r = 0; r < rowLabels.length; r++) {
      line.push({ label: rowLabels[r]!, score: matrix.values[r * colLabels.length + col] ?? null });
    }
  } else {
    for (let c = 0; c < colLabels.length; c++) {
      const value = matrix.values[row * colLabels.length + c] ?? null;
      line.push({ label: colLabels[c]!, score: value === null ? null : -value });
    }
  }
  const own = side === 'p1' ? line[row] : line[col];
  const scored = line.filter((cell): cell is { label: string; score: number } => cell.score !== null && Number.isFinite(cell.score));
  const ownScore = own?.score ?? null;
  if (ownScore === null || !Number.isFinite(ownScore) || scored.length < 2) return null;

  const top = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const low = Math.min(...scored.map((cell) => cell.score));
  const spread = top.score - low;
  const gap = spread <= 1e-9 ? 0 : Math.max(0, (top.score - ownScore) / spread);
  const rank = 1 + scored.filter((cell) => cell.score > ownScore + 1e-9).length;
  const label = gap < REPLY_BEST_GAP ? 'best' : gap < REPLY_GOOD_GAP ? 'good' : 'poor';
  return { rank, outOf: scored.length, best: top.label, gap, label };
}
