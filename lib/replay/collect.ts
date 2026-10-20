/**
 * Selection of replays to download.
 *
 * Walks the search pages for a format and returns the entries worth
 * downloading: rated, public, not already on disk, within the requested
 * rating range, and not seen on an earlier page.
 */

import type { ReplayClient } from './client';
import type { SearchEntry } from './types';

/** Options for {@link collectEntries}. */
export interface CollectOptions {
  /** Format id, for example `gen9randombattle`. */
  format: string;
  /** Stop once this many entries are selected. */
  limit: number;
  /** Never request more than this many search pages. */
  maxPages: number;
  /** Keep only entries rated at least this high. */
  minRating?: number;
  /** Keep only entries rated at most this high. */
  maxRating?: number;
  /** Replay ids to skip, typically those already downloaded. */
  exclude?: ReadonlySet<string>;
  /** Called after each page with the page number and entries it contained. */
  onPage?: (page: number, found: number, selected: number) => void;
}

/**
 * Decides whether a search entry should be downloaded.
 *
 * Unrated and private replays are never selected, because rating is the
 * label the analysis needs and private replays are not meant for sharing.
 *
 * @param entry - The search entry to test.
 * @param options - Rating bounds.
 */
export function isWanted(
  entry: SearchEntry,
  options: Pick<CollectOptions, 'minRating' | 'maxRating'>,
): boolean {
  if (entry.private !== 0 || entry.rating === null) return false;
  if (options.minRating !== undefined && entry.rating < options.minRating) return false;
  if (options.maxRating !== undefined && entry.rating > options.maxRating) return false;
  return true;
}

/**
 * Collects entries to download by paging through search results.
 *
 * Stops at the first empty page, at `maxPages`, or when `limit` entries have
 * been selected, whichever comes first.
 *
 * @param client - Source of search pages.
 * @param options - Selection rules and limits.
 * @returns The selected entries in the order they were found.
 */
export async function collectEntries(
  client: Pick<ReplayClient, 'searchPage'>,
  options: CollectOptions,
): Promise<SearchEntry[]> {
  const seen = new Set<string>(options.exclude);
  const selected: SearchEntry[] = [];

  for (let page = 1; page <= options.maxPages && selected.length < options.limit; page += 1) {
    const entries = await client.searchPage(options.format, page);
    if (entries.length === 0) break;

    let added = 0;
    for (const entry of entries) {
      if (selected.length >= options.limit) break;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      if (!isWanted(entry, options)) continue;
      selected.push(entry);
      added += 1;
    }
    options.onPage?.(page, entries.length, added);
  }
  return selected;
}
