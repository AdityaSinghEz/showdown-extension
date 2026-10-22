/**
 * Dataset records and summaries.
 *
 * A {@link GameRecord} is the compact, JSON-serializable form of one battle
 * that later modelling stages read. It keeps the structured turn data and
 * drops the raw protocol lines, which remain available in the downloaded
 * replay file.
 */

import type { PlayerSlot, RatingUpdate, TurnRecord } from '../battle/types';
import { replayToState } from '../replay/load';
import type { ReplayJson } from '../replay/types';

/** One player's identity and pre-battle rating. */
export interface RecordPlayer {
  name: string;
  /** Rating before the battle, from the `|player|` line. */
  rating: number;
}

/** One battle, ready for analysis. */
export interface GameRecord {
  id: string;
  format: string;
  /** Upload time as a Unix timestamp in seconds. */
  uploadTime: number;
  players: Record<PlayerSlot, RecordPlayer>;
  /** Winning slot. Ties are excluded from the dataset. */
  winner: PlayerSlot;
  /** True if the game ended by forfeit or inactivity. */
  forfeited: boolean;
  /**
   * The slot that forfeited or timed out, or `null` if nobody did (or the
   * name in the message matched neither player).
   */
  forfeitedBy: PlayerSlot | null;
  /** Number of turns played. */
  turnCount: number;
  ratingUpdates: RatingUpdate[];
  /** Structured per-turn data; turn `0` holds the leads. */
  turns: TurnRecord[];
}

/** Reasons a replay is left out of the dataset. */
export type SkipReason = 'unrated' | 'unfinished' | 'no-winner' | 'early-forfeit';

/** Outcome of converting one replay. */
export type BuildResult =
  | { ok: true; record: GameRecord }
  | { ok: false; reason: SkipReason };

/** Options for {@link buildGameRecord}. */
export interface BuildOptions {
  /** Forfeits ending before this many turns are skipped. Defaults to 5. */
  minTurnsForForfeit?: number;
  /** Keep the raw protocol lines on each turn. Defaults to false. */
  includeLog?: boolean;
}

const FORFEIT_PATTERN = /^\|-message\|(.+?) (?:forfeited|lost due to inactivity)\.$/;

/** Result of scanning a game's log for a forfeit. */
export interface ForfeitInfo {
  /** True if the log contains a forfeit or inactivity message. */
  forfeited: boolean;
  /** The slot named in the message, when it matches a player. */
  by: PlayerSlot | null;
}

/**
 * Detects a forfeit or inactivity loss in a game's log and who caused it.
 *
 * The server writes `<name> forfeited.` or `<name> lost due to inactivity.`
 * as a `-message` line. Disconnecting and reconnecting writes neither, so it
 * is not a forfeit.
 *
 * @param turns - The game's turn records (with their raw log lines).
 * @param names - Player names by slot.
 */
export function findForfeit(
  turns: readonly TurnRecord[],
  names: Readonly<Record<PlayerSlot, string>>,
): ForfeitInfo {
  for (const turn of turns) {
    for (const line of turn.log) {
      const match = FORFEIT_PATTERN.exec(line);
      if (!match) continue;
      const name = match[1];
      const by: PlayerSlot | null =
        name === names.p1 ? 'p1' : name === names.p2 ? 'p2' : null;
      return { forfeited: true, by };
    }
  }
  return { forfeited: false, by: null };
}

/**
 * Converts a downloaded replay into a dataset record.
 *
 * Replays are skipped when they lack ratings for both players, never reached
 * a result, ended in a tie, or ended in a forfeit too early to say anything
 * about play quality.
 *
 * @param replay - The downloaded replay.
 * @param options - Filtering and size options.
 */
export function buildGameRecord(replay: ReplayJson, options: BuildOptions = {}): BuildResult {
  const { minTurnsForForfeit = 5, includeLog = false } = options;
  const state = replayToState(replay);

  const p1 = state.players.p1;
  const p2 = state.players.p2;
  if (!p1 || !p2 || p1.rating === null || p2.rating === null) {
    return { ok: false, reason: 'unrated' };
  }
  if (!state.ended) return { ok: false, reason: 'unfinished' };

  const winner: PlayerSlot | null =
    state.winner === p1.name ? 'p1' : state.winner === p2.name ? 'p2' : null;
  if (winner === null) return { ok: false, reason: 'no-winner' };

  const forfeit = findForfeit(state.turns, { p1: p1.name, p2: p2.name });
  const forfeited = forfeit.forfeited;
  if (forfeited && state.turn < minTurnsForForfeit) {
    return { ok: false, reason: 'early-forfeit' };
  }

  return {
    ok: true,
    record: {
      id: replay.id,
      format: replay.formatid,
      uploadTime: replay.uploadtime,
      players: {
        p1: { name: p1.name, rating: p1.rating },
        p2: { name: p2.name, rating: p2.rating },
      },
      winner,
      forfeited,
      forfeitedBy: forfeit.by,
      turnCount: state.turn,
      ratingUpdates: state.ratingUpdates,
      turns: includeLog ? state.turns : state.turns.map((turn) => ({ ...turn, log: [] })),
    },
  };
}

/**
 * Groups a rating into a band.
 *
 * @param rating - A rating.
 * @param width - Band width. Defaults to 100.
 * @returns The lower edge of the band, for example `1700` for 1749.
 */
export function ratingBand(rating: number, width = 100): number {
  return Math.floor(rating / width) * width;
}

/**
 * The band of a game, from the mean of both players' ratings.
 *
 * @param record - The game.
 * @param width - Band width. Defaults to 100.
 */
export function gameBand(record: GameRecord, width = 100): number {
  return ratingBand((record.players.p1.rating + record.players.p2.rating) / 2, width);
}

/** Aggregate figures describing a set of games. */
export interface DatasetSummary {
  games: number;
  forfeits: number;
  averageTurns: number;
  /** Share of games won by `p1`; far from 0.5 would suggest a bias. */
  p1WinRate: number;
  /** Share of games won by the higher-rated player. */
  higherRatedWinRate: number;
  /** Game counts keyed by band lower edge, in ascending order. */
  byBand: Array<{ band: number; games: number }>;
}

/**
 * Summarizes a set of games.
 *
 * @param records - The games to summarize.
 */
export function summarize(records: readonly GameRecord[]): DatasetSummary {
  const bands = new Map<number, number>();
  let turns = 0;
  let forfeits = 0;
  let p1Wins = 0;
  let favoriteWins = 0;
  let decided = 0;

  for (const record of records) {
    turns += record.turnCount;
    if (record.forfeited) forfeits += 1;
    if (record.winner === 'p1') p1Wins += 1;
    const band = gameBand(record);
    bands.set(band, (bands.get(band) ?? 0) + 1);

    const { p1, p2 } = record.players;
    if (p1.rating !== p2.rating) {
      decided += 1;
      const favorite: PlayerSlot = p1.rating > p2.rating ? 'p1' : 'p2';
      if (record.winner === favorite) favoriteWins += 1;
    }
  }

  const games = records.length;
  return {
    games,
    forfeits,
    averageTurns: games === 0 ? 0 : turns / games,
    p1WinRate: games === 0 ? 0 : p1Wins / games,
    higherRatedWinRate: decided === 0 ? 0 : favoriteWins / decided,
    byBand: [...bands.entries()]
      .sort(([a], [b]) => a - b)
      .map(([band, count]) => ({ band, games: count })),
  };
}
