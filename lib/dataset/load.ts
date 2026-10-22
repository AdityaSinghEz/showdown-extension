/**
 * Reads game records back from the `games.jsonl` file the dataset builder
 * writes (one JSON object per line).
 *
 * The file is read from disk and may be hand-edited or produced by an older
 * version of the builder, so every record is validated before use and records
 * that do not have the expected shape are counted and skipped.
 */

import type { GameRecord } from './record';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlayer(value: unknown): boolean {
  return isObject(value) && typeof value.name === 'string' && typeof value.rating === 'number';
}

function isSnapshotPair(value: unknown): boolean {
  return isObject(value) && isObject(value.p1) && isObject(value.p2);
}

function isTurn(value: unknown): boolean {
  if (!isObject(value) || typeof value.turn !== 'number') return false;
  return value.endState === null || value.endState === undefined || isSnapshotPair(value.endState);
}

/**
 * Validates one parsed JSON value as a game record.
 *
 * Fields added in later versions are filled with safe defaults, so records
 * written by an older builder still load.
 *
 * @param value - A parsed JSON value.
 * @returns The record, or `null` if it is malformed.
 */
export function parseGameRecord(value: unknown): GameRecord | null {
  if (!isObject(value)) return null;
  const { id, format, players, winner, forfeited, turnCount, turns } = value;
  if (typeof id !== 'string' || typeof format !== 'string') return null;
  if (!isObject(players) || !isPlayer(players.p1) || !isPlayer(players.p2)) return null;
  if (winner !== 'p1' && winner !== 'p2') return null;
  if (typeof forfeited !== 'boolean' || typeof turnCount !== 'number') return null;
  if (!Array.isArray(turns) || !turns.every(isTurn)) return null;

  const normalizedTurns = turns.map((turn) => ({ ...turn, endState: turn.endState ?? null }));
  const forfeitedBy = value.forfeitedBy === 'p1' || value.forfeitedBy === 'p2' ? value.forfeitedBy : null;
  return { ...value, turns: normalizedTurns, forfeitedBy } as unknown as GameRecord;
}

/** Result of reading a `games.jsonl` file. */
export interface LoadedGames {
  records: GameRecord[];
  /** Number of non-empty lines that were not valid records. */
  invalid: number;
}

/**
 * Parses the text of a `games.jsonl` file.
 *
 * @param text - The file contents. Blank lines are ignored.
 */
export function parseGames(text: string): LoadedGames {
  const records: GameRecord[] = [];
  let invalid = 0;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const record = parseGameRecord(JSON.parse(line));
      if (record) records.push(record);
      else invalid += 1;
    } catch {
      invalid += 1;
    }
  }
  return { records, invalid };
}
