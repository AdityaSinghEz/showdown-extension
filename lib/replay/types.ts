/**
 * Types for the public Pokemon Showdown replay service.
 *
 * Two endpoints are used:
 *
 * - `GET /search.json?format=<id>&page=<n>` lists recent replays, newest
 *   first, roughly 50 per page. The last entry of one page repeats as the
 *   first entry of the next, so callers must de-duplicate by id.
 * - `GET /<id>.json` returns one replay including its full battle log.
 */

/** One entry of a replay search result. */
export interface SearchEntry {
  /** Replay id, for example `gen9randombattle-2701531389`. */
  id: string;
  /** Display name of the format, for example `[Gen 9] Random Battle`. */
  format: string;
  /** Player names in slot order (`p1`, `p2`). */
  players: [string, string];
  /** Upload time as a Unix timestamp in seconds. */
  uploadtime: number;
  /** Rating shown by the service, or `null` for unrated battles. */
  rating: number | null;
  /** Non-zero for private replays. */
  private: number;
}

/** A full replay as returned by `/<id>.json`. */
export interface ReplayJson {
  id: string;
  format: string;
  /** Format id, for example `gen9randombattle`. */
  formatid: string;
  players: [string, string];
  /** The battle log as newline-separated protocol lines. */
  log: string;
  uploadtime: number;
  rating: number | null;
  private: number;
}

function isPlayerPair(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'string'
  );
}

/**
 * Validates and normalizes one search result entry.
 *
 * Network data is untrusted, so every field is checked before use.
 *
 * @param value - A parsed JSON value.
 * @returns The normalized entry, or `null` if the value is malformed.
 */
export function parseSearchEntry(value: unknown): SearchEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;
  const { id, format, players, uploadtime } = entry;
  if (typeof id !== 'string' || typeof format !== 'string') return null;
  if (!isPlayerPair(players) || typeof uploadtime !== 'number') return null;

  return {
    id,
    format,
    players,
    uploadtime,
    rating: typeof entry.rating === 'number' ? entry.rating : null,
    private: typeof entry.private === 'number' ? entry.private : 0,
  };
}

/**
 * Validates and normalizes a full replay.
 *
 * @param value - A parsed JSON value.
 * @returns The normalized replay, or `null` if the value is malformed.
 */
export function parseReplayJson(value: unknown): ReplayJson | null {
  const entry = parseSearchEntry(value);
  if (!entry) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.log !== 'string') return null;

  return {
    id: entry.id,
    format: entry.format,
    formatid: typeof raw.formatid === 'string' ? raw.formatid : entry.id.replace(/-\d.*$/, ''),
    players: entry.players,
    log: raw.log,
    uploadtime: entry.uploadtime,
    rating: entry.rating,
    private: entry.private,
  };
}
