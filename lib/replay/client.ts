/**
 * HTTP client for the public replay service.
 *
 * The client is deliberately polite: it issues requests strictly one at a
 * time, waits a fixed delay between them, identifies itself with a
 * User-Agent, and retries transient failures with exponential backoff.
 *
 * Network access and sleeping are injectable so the logic can be unit-tested
 * without touching the network.
 */

import {
  parseReplayJson,
  parseSearchEntry,
  type ReplayJson,
  type SearchEntry,
} from './types';

/** The subset of a fetch `Response` the client relies on. */
export interface ResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** A minimal, injectable stand-in for the global `fetch`. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<ResponseLike>;

/** Options for {@link ReplayClient}. */
export interface ReplayClientOptions {
  /** Network function. Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Service origin. Defaults to `https://replay.pokemonshowdown.com`. */
  baseUrl?: string;
  /** Sent as the `User-Agent` header. */
  userAgent?: string;
  /** Pause between consecutive requests, in milliseconds. Defaults to 1000. */
  delayMs?: number;
  /** Retries after a transient failure. Defaults to 3. */
  maxRetries?: number;
  /** Base backoff in milliseconds, doubled on each retry. Defaults to 2000. */
  backoffMs?: number;
  /** Sleep function. Defaults to a timer-based implementation. */
  sleep?: (ms: number) => Promise<void>;
}

/** Error raised when a request fails permanently. */
export class ReplayRequestError extends Error {
  constructor(
    message: string,
    /** HTTP status, or `null` for network and parsing failures. */
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'ReplayRequestError';
  }
}

const DEFAULT_BASE_URL = 'https://replay.pokemonshowdown.com';
const DEFAULT_USER_AGENT = 'showdown-extension-research (personal, low-rate)';

function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Client for listing and downloading public replays. */
export class ReplayClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly delayMs: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private requestCount = 0;

  constructor(options: ReplayClientOptions = {}) {
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.delayMs = options.delayMs ?? 1000;
    this.maxRetries = options.maxRetries ?? 3;
    this.backoffMs = options.backoffMs ?? 2000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Lists one page of recent replays for a format.
   *
   * @param format - Format id, for example `gen9randombattle`.
   * @param page - 1-based page number.
   * @returns The valid entries on the page; malformed entries are dropped.
   */
  async searchPage(format: string, page: number): Promise<SearchEntry[]> {
    const query = `format=${encodeURIComponent(format)}&page=${page}`;
    const body = await this.getJson(`${this.baseUrl}/search.json?${query}`);
    if (!Array.isArray(body)) {
      throw new ReplayRequestError('Search response was not a JSON array', null);
    }
    const entries: SearchEntry[] = [];
    for (const item of body) {
      const entry = parseSearchEntry(item);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  /**
   * Downloads one replay including its battle log.
   *
   * @param id - Replay id, for example `gen9randombattle-2701531389`.
   */
  async getReplay(id: string): Promise<ReplayJson> {
    const body = await this.getJson(`${this.baseUrl}/${encodeURIComponent(id)}.json`);
    const replay = parseReplayJson(body);
    if (!replay) throw new ReplayRequestError(`Replay ${id} had an unexpected shape`, null);
    return replay;
  }

  private async getJson(url: string): Promise<unknown> {
    if (this.requestCount > 0) await this.sleep(this.delayMs);
    this.requestCount += 1;

    let lastError: ReplayRequestError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) await this.sleep(this.backoffMs * 2 ** (attempt - 1));

      try {
        const response = await this.fetchImpl(url, {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        });
        if (response.ok) {
          const text = await response.text();
          try {
            return JSON.parse(text);
          } catch {
            throw new ReplayRequestError(`Invalid JSON from ${url}`, response.status);
          }
        }
        lastError = new ReplayRequestError(`HTTP ${response.status} for ${url}`, response.status);
        if (!isTransient(response.status)) throw lastError;
      } catch (error) {
        if (error instanceof ReplayRequestError) {
          // Permanent failures (4xx, malformed JSON) are not retried.
          if (error.status !== null && !isTransient(error.status)) throw error;
          lastError = error;
        } else {
          lastError = new ReplayRequestError(`Network error for ${url}`, null);
        }
      }
    }
    throw lastError ?? new ReplayRequestError(`Request failed for ${url}`, null);
  }
}
