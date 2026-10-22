/**
 * Turns recorded board snapshots into model inputs.
 *
 * Each feature is the advantage of player 1 over player 2: positive favours
 * player 1, negative favours player 2, and zero means the sides are equal.
 * Because every feature is a difference, a position and its mirror image
 * (sides swapped) produce exactly opposite vectors, which lets the model
 * treat the two players symmetrically.
 */

import type { ActivePokemon, SideSnapshot } from '../battle/types';
import type { GameRecord } from '../dataset/record';

/** Names of the features, in vector order. */
export const FEATURE_NAMES = ['remaining', 'teamHp', 'activeHp', 'status', 'tera'] as const;

/** One training or evaluation row: a position and the eventual result. */
export interface TurnSample {
  gameId: string;
  /** The turn whose end this position describes. */
  turn: number;
  /** Feature vector, in {@link FEATURE_NAMES} order. */
  features: number[];
  /** 1 if player 1 won the game, otherwise 0. */
  label: 0 | 1;
}

/** Options for {@link extractSamples}. */
export interface ExtractOptions {
  /**
   * Include games that ended by forfeit or timeout. Off by default: such a
   * result can be decided by a disconnect rather than by the position.
   */
  includeForfeits?: boolean;
}

/** Major status conditions that cripple the afflicted Pokemon. */
const MAJOR_STATUSES: ReadonlySet<string> = new Set(['brn', 'par', 'psn', 'tox', 'slp', 'frz']);

function hasMajorStatus(active: ActivePokemon | null): boolean {
  return active?.status != null && MAJOR_STATUSES.has(active.status);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Computes the feature vector for one position.
 *
 * - `remaining`: Pokemon left, player 1 minus player 2.
 * - `teamHp`: total team HP as a sum of fractions, player 1 minus player 2.
 *   Pokemon not yet revealed count as full health.
 * - `activeHp`: HP fraction of the Pokemon on the field, player 1 minus
 *   player 2 (a fainted active Pokemon counts as 0).
 * - `status`: +1 if only player 2's active Pokemon has a major status, -1 if
 *   only player 1's does, 0 if both or neither.
 * - `tera`: +1 if only player 1 has used Terastallization, -1 if only
 *   player 2 has, else 0. Its sign is left for the model to learn.
 *
 * @param p1 - Player 1's side at the end of a turn.
 * @param p2 - Player 2's side at the end of a turn.
 * @returns The vector, or `null` when the position is unusable: the team
 *   size was never announced (or the record predates team HP tracking), or a
 *   side has no Pokemon left, which means the game is already decided.
 */
export function snapshotFeatures(p1: SideSnapshot, p2: SideSnapshot): number[] | null {
  if (!isNumber(p1.remaining) || !isNumber(p2.remaining)) return null;
  if (!isNumber(p1.teamHp) || !isNumber(p2.teamHp)) return null;
  if (p1.remaining <= 0 || p2.remaining <= 0) return null;

  const statusAdvantage = (hasMajorStatus(p2.active) ? 1 : 0) - (hasMajorStatus(p1.active) ? 1 : 0);
  const teraAdvantage = (p1.teraUsed ? 1 : 0) - (p2.teraUsed ? 1 : 0);

  return [
    p1.remaining - p2.remaining,
    p1.teamHp - p2.teamHp,
    (p1.active?.hp ?? 0) - (p2.active?.hp ?? 0),
    statusAdvantage,
    teraAdvantage,
  ];
}

/**
 * Whether a game record carries the team HP data the model needs.
 *
 * Records built before team HP tracking was added lack it and must be rebuilt
 * from the raw replays.
 *
 * @param record - The game to check.
 */
export function hasTeamHp(record: GameRecord): boolean {
  return record.turns.some((turn) => turn.endState !== null && isNumber(turn.endState.p1.teamHp));
}

/**
 * Extracts one sample per turn of a game.
 *
 * Turn 0 (the leads) is skipped because the sides are always equal there.
 * Positions where the game is already decided are skipped too, so the model
 * does not learn "zero Pokemon left means loss", which is true but useless.
 *
 * @param record - The game to read.
 * @param options - Which games to include.
 */
export function extractSamples(record: GameRecord, options: ExtractOptions = {}): TurnSample[] {
  if (record.forfeited && !options.includeForfeits) return [];

  const label: 0 | 1 = record.winner === 'p1' ? 1 : 0;
  const samples: TurnSample[] = [];
  for (const turn of record.turns) {
    if (turn.turn < 1 || turn.endState === null) continue;
    const features = snapshotFeatures(turn.endState.p1, turn.endState.p2);
    if (features === null) continue;
    samples.push({ gameId: record.id, turn: turn.turn, features, label });
  }
  return samples;
}
