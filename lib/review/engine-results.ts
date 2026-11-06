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
  /** Win probability gained by Terastallizing now, as a fraction (negative if it hurt). */
  gain: number;
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
 */
/**
 * Moves poke-engine only approximates: Revival Blessing does nothing in its
 * model, and Population Bomb / Triple Axel use a fixed hit count with a single
 * accuracy roll. A grade for these would reflect the engine's gap, not the play.
 */
export const UNMODELLED_MOVES: ReadonlySet<string> = new Set(['revivalblessing', 'populationbomb', 'tripleaxel']);

export function judgeWithEngine(side: readonly EngineChoiceResult[], played: string | null): EngineJudgement {
  const groups = groupByMove(side);
  const visits = groups.reduce((sum, group) => sum + group.visits, 0);
  const best = [...groups]
    .sort((a, b) => b.visits - a.visits)
    .filter((group) => visits > 0 && group.visits / visits >= 0.05)
    .map((group) => ({ engine: group.engine, share: group.visits / visits }));
  const unknown: EngineJudgement = { loss: null, grade: 'unknown', best, teraGain: null, share: null, tera: null };
  if (played === null || visits === 0) return unknown;
  if (UNMODELLED_MOVES.has(baseMove(played))) return unknown;
  const mine = groups.find((group) => group.engine === baseMove(played));
  const mineValue = mine !== undefined && mine.visits > 0 ? mine.score / mine.visits : null;
  if (mineValue === null || mine === undefined) return unknown;
  const share = mine.visits / visits;
  const tera = judgeTera(side, played, visits);
  if (groups.length === 1) return { loss: 0, grade: 'forced', best, teraGain: null, share, tera };
  let top = mineValue;
  for (const group of groups) {
    if (group.visits / visits >= MIN_SHARE) top = Math.max(top, group.score / group.visits);
  }
  const loss = top - mineValue;
  return { loss, grade: gradeWithPriority(loss, share), best, teraGain: teraGainFor(side, played, visits), share, tera };
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
  if (!plain || !tera || plain.visits === 0 || tera.visits === 0) return null;
  if (plain.visits / visits < MIN_SHARE || tera.visits / visits < MIN_SHARE) return null;
  const gain = tera.score / tera.visits - plain.score / plain.visits;
  const used = played.endsWith(TERA_SUFFIX);
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
  if (plain.visits / visits < MIN_SHARE || tera.visits / visits < MIN_SHARE) return null;
  return tera.score / tera.visits - plain.score / plain.visits;
}
