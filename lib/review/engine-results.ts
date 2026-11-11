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
import { solveMatrixGame } from './matrix';
import type { PayoffMatrix } from './reply';

/** One choice's result from the search. */
export interface EngineChoiceResult {
  engine: string;
  visits: number;
  score: number;
}

/**
 * Every choice of one side valued against the opponent's likely replies, with equal
 * search effort per choice (see `q_table` in `tools/engine/search.py`).
 */
export interface QTable {
  rows: string[];
  cols: string[];
  /** How often the opponent's search played each reply; 0 for a reply included only because it was played. */
  weights: number[];
  /** `values[i][j]` is the side's own win probability for `rows[i]` against `cols[j]`, or `null` when it could not be simulated. */
  values: (number | null)[][];
}

/** The search result for one position. */
export interface EnginePositionResult {
  id: string;
  turn: number;
  total?: number;
  p1?: EngineChoiceResult[];
  p2?: EngineChoiceResult[];
  /** Payoff table from the optional expectiminimax pass (`search.py --matrix-ms`). */
  matrix?: PayoffMatrix;
  /** Equal-effort values of every choice, per side. */
  q?: { p1?: QTable; p2?: QTable };
  error?: string;
}

/** Smallest share of the search a choice needs before it can count as "best". */
export const MIN_SHARE = 0.02;

/** Smallest share of the search both the plain and the Tera version of a move need before Tera can be graded. */
export const MIN_TERA_SHARE = 0.05;

/** A move the engine itself plays at least this often is graded "best", whatever its measured gap. */
export const BEST_SHARE = 0.3;

/** A move the engine itself plays at least this often is never graded worse than "good". */
export const GOOD_SHARE = 0.1;

/**
 * What saving Terastallization is worth, as a fraction of win probability.
 *
 * Tera can be used once per battle, so using it now gives up using it later,
 * and the search cannot see that. Using Tera is graded as worthwhile only if it
 * gains more than this, and not using it is a miss only if the gain was larger.
 * This is an assumption and is meant to be tuned against real games.
 */
export const TERA_COST = 0.08;

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
  /** True when the engine's number for this move is rough (see {@link APPROXIMATE_MOVES}) or the move was barely searched. */
  approximate: boolean;
  /** The most-tried moves, best first, with their share of the search. Tera variants are combined. */
  best: { engine: string; share: number }[];
  /**
   * How much better the engine thinks the played move would have been with
   * Terastallization (as a fraction of win probability), or `null` when that
   * does not apply. It is not part of the move's grade; the Tera decision is
   * graded separately in `tera`.
   */
  teraGain: number | null;
  /** How often the engine itself played the move that was played, as a share of its search. */
  share: number | null;
  /** Win probability after the played move, 0 to 1, or `null` when the move was not judged. */
  value: number | null;
  /** Win probability after the engine's best move, 0 to 1, or `null` when the move was not judged. */
  top: number | null;
  /** The engine's best move by win probability, or `null` when the move was not judged. */
  topMove: string | null;
  /**
   * How the move did against the reply the opponent actually played, from the equal-effort
   * values: `value` is the move's win probability against that reply, `best` the best
   * move's, or `null` when those values were not computed.
   */
  vsReply: { reply: string; value: number; best: number; bestMove: string } | null;
  /**
   * Grade of the Terastallization decision, separate from the move's grade:
   * whether using Tera here was worth its cost, or whether not using it was a
   * miss. `null` when Tera was not in question this turn.
   */
  tera: TeraJudgement | null;
}

/** The grade of one Terastallization decision. */
export interface TeraJudgement {
  /** `used` if the move was played with Tera, `held` if Tera was available and not used. */
  action: 'used' | 'held';
  /** Win probability gained by Terastallizing now, as a fraction (negative if it hurt), or `null` when the search never tried the move without Tera. */
  gain: number | null;
  grade: Grade;
  /** Plain-language reading of the grade. */
  note: string;
}

const TERA_SUFFIX = '-tera';

/** The move behind an option, with any Tera suffix removed. Switches are returned unchanged. */
export function baseMove(engine: string): string {
  return engine.endsWith(TERA_SUFFIX) ? engine.slice(0, -TERA_SUFFIX.length) : engine;
}

interface Group {
  engine: string;
  visits: number;
  score: number;
}

/** Merges each move's plain and Tera options into one entry, so grading compares moves, not Tera timing. */
function groupByMove(side: readonly EngineChoiceResult[]): Group[] {
  const groups = new Map<string, Group>();
  for (const choice of side) {
    const key = baseMove(choice.engine);
    const group = groups.get(key) ?? { engine: key, visits: 0, score: 0 };
    group.visits += choice.visits;
    group.score += choice.score;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Moves poke-engine only approximates: Revival Blessing does nothing in its
 * model, and Triple Axel and Population Bomb use a fixed hit count with a single
 * accuracy roll. They are still graded, but the engine's number is rougher, so
 * the grade is flagged `approximate` and never worse than a mistake.
 */
export const APPROXIMATE_MOVES: ReadonlySet<string> = new Set(['revivalblessing', 'tripleaxel', 'populationbomb']);


/**
 * Grades the played move against the search result.
 *
 * A move and its Terastallized version count as the same move, valued by the
 * search's average over both. Terastallizing is once per battle, so a grade
 * that demanded it on every turn would be meaningless; the possible gain from
 * it is reported separately as `teraGain`.
 *
 * Moves tried in less than {@link MIN_SHARE} of the search are ignored when
 * looking for the best one, because a handful of tries is too noisy to trust.
 *
 * @param side - The search result for one side.
 * @param played - The engine name of the choice that was played, or null if unknown.
 * @param q - Equal-effort values for every choice. When given they replace the search's own averages,
 *   which undervalue moves the search tried rarely.
 * @param reply - The opponent's actual reply, used to check how the move did against it.
 */
export function judgeWithEngine(
  side: readonly EngineChoiceResult[],
  played: string | null,
  q?: QTable,
  reply: string | null = null,
): EngineJudgement {
  const groups = groupByMove(side);
  const visits = groups.reduce((sum, group) => sum + group.visits, 0);
  const best = [...groups]
    .sort((a, b) => b.visits - a.visits)
    .filter((group) => visits > 0 && group.visits / visits >= 0.05)
    .map((group) => ({ engine: group.engine, share: group.visits / visits }));
  const unknown: EngineJudgement = { loss: null, grade: 'unknown', approximate: false, best, teraGain: null, share: null, value: null, top: null, topMove: null, vsReply: null, tera: null };
  if (played === null || visits === 0) return unknown;
  const mine = groups.find((group) => group.engine === baseMove(played));
  const searched = mine !== undefined && mine.visits > 0;
  if (!searched && groups.length < 2) return unknown;
  const fair = q ? judgeWithQ(q, played, reply) : null;
  const tera = fair ? fair.tera : judgeTera(side, played, visits);
  if (groups.length === 1 && mine !== undefined) {
    const only = mine.score / mine.visits;
    return { loss: 0, grade: 'forced', approximate: false, best, teraGain: null, share: 1, value: only, top: only, topMove: mine.engine, vsReply: null, tera };
  }
  // A legal move the search never chose is one it found clearly bad. Its value is then
  // taken as the worst of the moves it did try, which grades it by its full distance
  // from the best move without inventing a number for it.
  const tried = groups.filter((group) => group.visits > 0);
  const share = searched ? mine.visits / visits : 0;
  let mineValue = searched ? mine.score / mine.visits : Math.min(...tried.map((group) => group.score / group.visits));
  let top = mineValue;
  let topMove = searched ? mine.engine : baseMove(played);
  if (fair) {
    mineValue = fair.mine;
    top = fair.top;
    topMove = fair.topMove;
  } else {
    for (const group of tried) {
      if (group.visits / visits >= MIN_SHARE && group.score / group.visits > top) {
        top = group.score / group.visits;
        topMove = group.engine;
      }
    }
  }
  const loss = top - mineValue;
  const approximate = !searched || APPROXIMATE_MOVES.has(baseMove(played));
  let grade = gradeWithPriority(loss, share);
  if (approximate && grade === 'blunder') grade = 'mistake';
  return { loss, grade, approximate, best, teraGain: fair ? fair.tera?.gain ?? null : teraGainFor(side, played, visits), share, value: mineValue, top, topMove, vsReply: fair ? fair.vsReply : null, tera };
}

/**
 * The move's grade: by the win-probability gap, adjusted by how often the
 * engine itself plays the move. A move the engine favours is not a mistake.
 */
export function gradeWithPriority(loss: number, share: number): Grade {
  if (share >= BEST_SHARE) return 'best';
  const grade = gradeLoss(loss);
  if (share >= GOOD_SHARE && (grade === 'inaccuracy' || grade === 'mistake' || grade === 'blunder')) return 'good';
  return grade;
}

/**
 * Grades the Terastallization decision for the played move.
 *
 * Compares the engine's value for the move with Tera and without it, and sets
 * the gain against {@link TERA_COST}.
 * - Used Tera: the shortfall is how far the gain fell below the cost.
 * - Held Tera: the shortfall is how far the gain rose above the cost.
 *
 * @returns `null` for switches, or when the search did not try both versions.
 */
function judgeTera(side: readonly EngineChoiceResult[], played: string, visits: number): TeraJudgement | null {
  if (played.startsWith('switch ')) return null;
  const base = baseMove(played);
  const plain = side.find((choice) => choice.engine === base);
  const tera = side.find((choice) => choice.engine === `${base}${TERA_SUFFIX}`);
  // The engine played Tera nearly every time and never found the plain move worth trying:
  // Tera was what the position needed.
  if (played.endsWith(TERA_SUFFIX) && tera && tera.visits / visits >= BEST_SHARE && (!plain || plain.visits / visits < MIN_TERA_SHARE)) {
    return { action: 'used', gain: null, grade: 'best', note: 'Tera was needed here' };
  }
  if (!plain || !tera || plain.visits === 0 || tera.visits === 0) return null;
  // The search spends its tries on promising lines, so a version it barely tried is usually a
  // lucky few simulations, not a real gain. Both versions need a fair share of the search.
  if (plain.visits / visits < MIN_TERA_SHARE || tera.visits / visits < MIN_TERA_SHARE) return null;
  return teraVerdict(tera.score / tera.visits - plain.score / plain.visits, played.endsWith(TERA_SUFFIX));
}

/** Grades a Tera decision from how much Terastallizing gained, set against {@link TERA_COST}. */
function teraVerdict(gain: number, used: boolean): TeraJudgement {
  const shortfall = used ? Math.max(0, TERA_COST - gain) : Math.max(0, gain - TERA_COST);
  const grade = gradeLoss(shortfall);
  let note: string;
  if (used) {
    note = gain >= 0.15 ? 'Tera was needed here' : gain >= TERA_COST ? 'Tera was worth it' : gain >= 0 ? 'Tera gained little; saving it was better' : 'Tera made this move worse';
  } else {
    note = gain >= 0.15 + TERA_COST ? 'Tera was needed here and was not used' : gain > TERA_COST ? 'Tera would have helped' : 'Tera was not needed';
  }
  return { action: used ? 'used' : 'held', gain, grade, note };
}

/** The extra value Terastallizing would have added to the played move, when the search tried both ways. */
function teraGainFor(side: readonly EngineChoiceResult[], played: string, visits: number): number | null {
  if (played.endsWith(TERA_SUFFIX) || played.startsWith('switch ')) return null;
  const plain = side.find((choice) => choice.engine === played);
  const tera = side.find((choice) => choice.engine === `${played}${TERA_SUFFIX}`);
  if (!plain || !tera || plain.visits === 0 || tera.visits === 0) return null;
  // The search spends its tries on promising lines, so a version it barely tried is usually a
  // lucky few simulations, not a real gain. Both versions need a fair share of the search.
  if (plain.visits / visits < MIN_TERA_SHARE || tera.visits / visits < MIN_TERA_SHARE) return null;
  return tera.score / tera.visits - plain.score / plain.visits;
}

/** Result of valuing the played move from the equal-effort table. */
interface QJudgement {
  mine: number;
  top: number;
  topMove: string;
  vsReply: EngineJudgement['vsReply'];
  tera: TeraJudgement | null;
}

/**
 * The opponent's best mix of replies for a table: the mix that holds this side's best move
 * to the least, found by solving the table as a zero-sum matrix game.
 *
 * The search's own count of how often it played each reply is not used, because when a
 * side is losing every reply looks about equally bad and that count is close to arbitrary
 * (the same position gave Sticky Web 12% in one run and 54% in another). Only rows with a
 * value against every reply take part. Returns `null` if no row is complete.
 */
function opponentMix(table: QTable): number[] | null {
  const complete = table.values.filter((line) => line.length === table.cols.length && line.every((value) => value !== null));
  if (complete.length === 0 || table.cols.length === 0) return null;
  try {
    return solveMatrixGame(complete as number[][]).columnStrategy;
  } catch {
    return null;
  }
}

/**
 * Values the played move from a {@link QTable}.
 *
 * A move's value is its average over the opponent's best mix of replies (see
 * {@link opponentMix}). A move and its Terastallized version count as one move,
 * valued by the better of the two, so the move's grade does not depend on the Tera
 * decision, which is graded on its own from the difference between the two.
 *
 * @returns `null` when the table does not contain the played move.
 */
export function judgeWithQ(table: QTable, played: string, reply: string | null): QJudgement | null {
  const cells = table.values;
  const mix = opponentMix(table);
  const expected = (row: number): number | null => {
    if (!mix) return null;
    let total = 0;
    for (let col = 0; col < table.cols.length; col++) {
      const value = cells[row]?.[col];
      if (value === null || value === undefined) return null;
      total += (mix[col] ?? 0) * value;
    }
    return total;
  };
  const replyCol = reply === null ? -1 : table.cols.indexOf(reply);

  const byMove = new Map<string, { mix: number; vs: number | null }>();
  table.rows.forEach((choice, row) => {
    const mix = expected(row);
    if (mix === null) return;
    const vs = replyCol >= 0 ? cells[row]?.[replyCol] ?? null : null;
    const key = baseMove(choice);
    const entry = byMove.get(key);
    if (!entry) byMove.set(key, { mix, vs });
    else byMove.set(key, { mix: Math.max(entry.mix, mix), vs: vs === null ? entry.vs : Math.max(entry.vs ?? vs, vs) });
  });

  const mine = byMove.get(baseMove(played));
  if (!mine || byMove.size < 2) return null;
  let topMove = baseMove(played);
  let top = mine.mix;
  let bestVs: { move: string; value: number } | null = null;
  for (const [move, entry] of byMove) {
    if (entry.mix > top) {
      top = entry.mix;
      topMove = move;
    }
    if (entry.vs !== null && (bestVs === null || entry.vs > bestVs.value)) bestVs = { move, value: entry.vs };
  }
  const vsReply = reply !== null && mine.vs !== null && bestVs !== null ? { reply, value: mine.vs, best: bestVs.value, bestMove: bestVs.move } : null;

  let tera: TeraJudgement | null = null;
  if (!played.startsWith('switch ')) {
    const base = baseMove(played);
    const plainRow = table.rows.indexOf(base);
    const teraRow = table.rows.indexOf(`${base}${TERA_SUFFIX}`);
    const plain = plainRow >= 0 ? expected(plainRow) : null;
    const withTera = teraRow >= 0 ? expected(teraRow) : null;
    if (plain !== null && withTera !== null) tera = teraVerdict(withTera - plain, played.endsWith(TERA_SUFFIX));
  }
  return { mine: mine.mix, top, topMove, vsReply, tera };
}

/**
 * A side's overall win probability from its equal-effort table: the value of its best move
 * against the opponent's likely replies.
 */
export function bestExpectedValue(table: QTable | undefined): number | null {
  if (!table) return null;
  let best: number | null = null;
  for (const choice of table.rows) {
    const judged = judgeWithQ(table, choice, null);
    if (judged && (best === null || judged.top > best)) best = judged.top;
  }
  return best;
}
