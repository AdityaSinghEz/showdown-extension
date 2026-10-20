import { describe, expect, it, vi } from 'vitest';
import { ReplayClient, ReplayRequestError, type FetchLike, type ResponseLike } from '../lib/replay/client';
import { collectEntries, isWanted } from '../lib/replay/collect';
import { parseReplayJson, parseSearchEntry, type SearchEntry } from '../lib/replay/types';
import { playedReplay } from './replay-fixtures';

function reply(status: number, body: unknown): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function entry(id: string, rating: number | null, extra: Partial<SearchEntry> = {}): SearchEntry {
  return {
    id,
    format: '[Gen 9] Random Battle',
    players: ['a', 'b'],
    uploadtime: 1,
    rating,
    private: 0,
    ...extra,
  };
}

function clientWith(fetchImpl: FetchLike, sleep = vi.fn(async () => {})) {
  return { client: new ReplayClient({ fetch: fetchImpl, sleep, delayMs: 10, backoffMs: 100, maxRetries: 2 }), sleep };
}

describe('ReplayClient', () => {
  it('builds the search URL and sends a User-Agent', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => reply(200, []));
    await clientWith(fetchImpl).client.searchPage('gen9randombattle', 3);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://replay.pokemonshowdown.com/search.json?format=gen9randombattle&page=3');
    expect(init?.headers?.['User-Agent']).toContain('showdown-extension');
  });

  it('drops malformed search entries', async () => {
    const good = entry('gen9randombattle-1', 1600);
    const fetchImpl: FetchLike = async () => reply(200, [good, { id: 5 }, null, 'x']);
    const entries = await clientWith(fetchImpl).client.searchPage('gen9randombattle', 1);
    expect(entries).toEqual([good]);
  });

  it('rejects a search response that is not an array', async () => {
    const fetchImpl: FetchLike = async () => reply(200, { error: true });
    await expect(clientWith(fetchImpl).client.searchPage('gen9randombattle', 1)).rejects.toThrow(ReplayRequestError);
  });

  it('downloads and validates a replay', async () => {
    const replay = playedReplay();
    const fetchImpl = vi.fn<FetchLike>(async () => reply(200, replay));
    const result = await clientWith(fetchImpl).client.getReplay(replay.id);
    expect(result.id).toBe(replay.id);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`https://replay.pokemonshowdown.com/${replay.id}.json`);
  });

  it('waits between consecutive requests but not before the first', async () => {
    const fetchImpl: FetchLike = async () => reply(200, []);
    const { client, sleep } = clientWith(fetchImpl);
    await client.searchPage('f', 1);
    expect(sleep).not.toHaveBeenCalled();
    await client.searchPage('f', 2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('retries transient failures with exponential backoff', async () => {
    const responses = [reply(429, ''), reply(503, ''), reply(200, [])];
    const fetchImpl = vi.fn<FetchLike>(async () => responses.shift() ?? reply(500, ''));
    const { client, sleep } = clientWith(fetchImpl);
    await expect(client.searchPage('f', 1)).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });

  it('retries network errors, then gives up after maxRetries', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error('offline');
    });
    await expect(clientWith(fetchImpl).client.searchPage('f', 1)).rejects.toThrow(ReplayRequestError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry permanent failures', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => reply(404, ''));
    await expect(clientWith(fetchImpl).client.getReplay('x-1')).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry malformed JSON', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => reply(200, '<html>'));
    await expect(clientWith(fetchImpl).client.getReplay('x-1')).rejects.toThrow('Invalid JSON');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('validation', () => {
  it('normalizes missing optional fields', () => {
    expect(
      parseSearchEntry({ id: 'a-1', format: 'f', players: ['x', 'y'], uploadtime: 5 }),
    ).toEqual({ id: 'a-1', format: 'f', players: ['x', 'y'], uploadtime: 5, rating: null, private: 0 });
  });

  it('requires a log string for full replays', () => {
    const base = { id: 'a-1', format: 'f', players: ['x', 'y'], uploadtime: 5 };
    expect(parseReplayJson(base)).toBeNull();
    expect(parseReplayJson({ ...base, log: '|turn|1' })?.formatid).toBe('a');
  });
});

describe('isWanted', () => {
  it('rejects unrated and private entries', () => {
    expect(isWanted(entry('a-1', null), {})).toBe(false);
    expect(isWanted(entry('a-2', 1500, { private: 1 }), {})).toBe(false);
    expect(isWanted(entry('a-3', 1500), {})).toBe(true);
  });

  it('applies inclusive rating bounds', () => {
    const options = { minRating: 1500, maxRating: 1700 };
    expect(isWanted(entry('a-1', 1499), options)).toBe(false);
    expect(isWanted(entry('a-2', 1500), options)).toBe(true);
    expect(isWanted(entry('a-3', 1700), options)).toBe(true);
    expect(isWanted(entry('a-4', 1701), options)).toBe(false);
  });
});

describe('collectEntries', () => {
  function pagedClient(pages: SearchEntry[][]) {
    return { searchPage: vi.fn(async (_format: string, page: number) => pages[page - 1] ?? []) };
  }

  it('de-duplicates the entry repeated across page boundaries', async () => {
    const client = pagedClient([
      [entry('a-1', 1500), entry('a-2', 1500)],
      [entry('a-2', 1500), entry('a-3', 1500)],
    ]);
    const result = await collectEntries(client, { format: 'f', limit: 10, maxPages: 5 });
    expect(result.map((e) => e.id)).toEqual(['a-1', 'a-2', 'a-3']);
  });

  it('stops at the limit without requesting further pages', async () => {
    const client = pagedClient([
      [entry('a-1', 1500), entry('a-2', 1500)],
      [entry('a-3', 1500)],
    ]);
    const result = await collectEntries(client, { format: 'f', limit: 2, maxPages: 5 });
    expect(result).toHaveLength(2);
    expect(client.searchPage).toHaveBeenCalledTimes(1);
  });

  it('stops at an empty page', async () => {
    const client = pagedClient([[entry('a-1', 1500)]]);
    await collectEntries(client, { format: 'f', limit: 10, maxPages: 5 });
    expect(client.searchPage).toHaveBeenCalledTimes(2);
  });

  it('respects maxPages', async () => {
    const client = pagedClient([[entry('a-1', 1500)], [entry('a-2', 1500)], [entry('a-3', 1500)]]);
    const result = await collectEntries(client, { format: 'f', limit: 10, maxPages: 2 });
    expect(result).toHaveLength(2);
  });

  it('skips excluded ids and applies rating filters', async () => {
    const client = pagedClient([
      [entry('a-1', 1500), entry('a-2', 1900), entry('a-3', null), entry('a-4', 1550)],
    ]);
    const result = await collectEntries(client, {
      format: 'f',
      limit: 10,
      maxPages: 1,
      minRating: 1400,
      maxRating: 1600,
      exclude: new Set(['a-1']),
    });
    expect(result.map((e) => e.id)).toEqual(['a-4']);
  });

  it('reports progress per page', async () => {
    const client = pagedClient([[entry('a-1', 1500), entry('a-2', null)]]);
    const onPage = vi.fn();
    await collectEntries(client, { format: 'f', limit: 10, maxPages: 1, onPage });
    expect(onPage).toHaveBeenCalledWith(1, 2, 1);
  });
});
