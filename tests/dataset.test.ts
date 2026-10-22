import { describe, expect, it } from 'vitest';
import {
  buildGameRecord,
  gameBand,
  ratingBand,
  summarize,
  type GameRecord,
} from '../lib/dataset/record';
import { replayToState } from '../lib/replay/load';
import {
  earlyForfeitReplay,
  lateForfeitReplay,
  playedReplay,
  reconnectReplay,
  spacedNameTimeoutReplay,
  strangerForfeitReplay,
  tiedReplay,
  unfinishedReplay,
  unratedReplay,
} from './replay-fixtures';

function record(overrides: Partial<GameRecord> = {}): GameRecord {
  const result = buildGameRecord(playedReplay());
  if (!result.ok) throw new Error('fixture should build');
  return { ...result.record, ...overrides };
}

describe('replayToState', () => {
  it('feeds a headerless replay log through the battle tracker', () => {
    const state = replayToState(playedReplay());
    expect(state.format).toBe('gen9randombattle');
    expect(state.players.p1).toEqual({ slot: 'p1', name: 'Alice', rating: 1500 });
    expect(state.players.p2).toEqual({ slot: 'p2', name: 'Bob', rating: 1520 });
    expect(state.turns.map((t) => t.turn)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(state.winner).toBe('Bob');
    expect(state.ratingUpdates).toEqual([
      { name: 'Alice', before: 1500, after: 1481 },
      { name: 'Bob', before: 1520, after: 1539 },
    ]);
  });

  it('ignores join lines and timestamps in the header', () => {
    const state = replayToState(playedReplay());
    expect(state.turns[0]?.actions).toHaveLength(2);
  });
});

describe('buildGameRecord', () => {
  it('builds a record for a finished rated game', () => {
    const result = buildGameRecord(playedReplay());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toMatchObject({
      id: 'gen9randombattle-100',
      format: 'gen9randombattle',
      winner: 'p2',
      forfeited: false,
      turnCount: 5,
      players: { p1: { name: 'Alice', rating: 1500 }, p2: { name: 'Bob', rating: 1520 } },
    });
    expect(result.record.ratingUpdates).toHaveLength(2);
  });

  it('drops raw log lines by default and keeps them on request', () => {
    const lean = buildGameRecord(playedReplay());
    const full = buildGameRecord(playedReplay(), { includeLog: true });
    if (!lean.ok || !full.ok) throw new Error('should build');
    expect(lean.record.turns.every((t) => t.log.length === 0)).toBe(true);
    expect(full.record.turns.some((t) => t.log.length > 0)).toBe(true);
  });

  it('keeps structured turn data', () => {
    const result = buildGameRecord(playedReplay());
    if (!result.ok) throw new Error('should build');
    expect(result.record.turns[1]?.actions[0]).toMatchObject({ move: 'Dark Pulse', side: 'p1' });
    expect(result.record.turns[4]?.faints).toEqual([{ side: 'p2', pokemon: 'Hydrapple' }]);
  });

  it.each([
    ['unrated', unratedReplay()],
    ['unfinished', unfinishedReplay()],
    ['no-winner', tiedReplay()],
    ['early-forfeit', earlyForfeitReplay()],
  ] as const)('skips %s games', (reason, replay) => {
    expect(buildGameRecord(replay)).toEqual({ ok: false, reason });
  });

  it('keeps ratings for players who disconnect and rejoin', () => {
    const result = buildGameRecord(reconnectReplay());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.players.p1.rating).toBe(1500);
    expect(result.record.players.p2.rating).toBe(1520);
  });

  it('keeps late forfeits and flags them', () => {
    const result = buildGameRecord(lateForfeitReplay());
    expect(result.ok && result.record.forfeited).toBe(true);
  });

  it('can be configured to keep early forfeits', () => {
    const result = buildGameRecord(earlyForfeitReplay(), { minTurnsForForfeit: 0 });
    expect(result.ok).toBe(true);
  });
});

describe('forfeit detection', () => {
  it('names the slot that forfeited', () => {
    const early = buildGameRecord(earlyForfeitReplay(), { minTurnsForForfeit: 0 });
    expect(early.ok && early.record.forfeitedBy).toBe('p1');
    const late = buildGameRecord(lateForfeitReplay());
    expect(late.ok && late.record.forfeitedBy).toBe('p1');
    expect(late.ok && late.record.winner).toBe('p2');
  });

  it('handles inactivity losses and names containing spaces', () => {
    const result = buildGameRecord(spacedNameTimeoutReplay());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toMatchObject({ forfeited: true, forfeitedBy: 'p1', winner: 'p2' });
  });

  it('leaves forfeitedBy empty when nobody forfeited', () => {
    const result = buildGameRecord(playedReplay());
    expect(result.ok && result.record.forfeitedBy).toBeNull();
  });

  it('flags the forfeit but not the slot when the name matches no player', () => {
    const result = buildGameRecord(strangerForfeitReplay());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toMatchObject({ forfeited: true, forfeitedBy: null });
  });

  it('does not count a disconnect and reconnect as a forfeit', () => {
    const result = buildGameRecord(reconnectReplay());
    expect(result.ok && result.record.forfeited).toBe(false);
  });
});

describe('rating bands', () => {
  it('groups ratings by width', () => {
    expect(ratingBand(1749)).toBe(1700);
    expect(ratingBand(1700)).toBe(1700);
    expect(ratingBand(1749, 50)).toBe(1700);
    expect(ratingBand(1750, 50)).toBe(1750);
  });

  it('bands a game by the mean of both ratings', () => {
    expect(gameBand(record())).toBe(1500);
    expect(
      gameBand(record({ players: { p1: { name: 'a', rating: 1790 }, p2: { name: 'b', rating: 1830 } } })),
    ).toBe(1800);
  });
});

describe('summarize', () => {
  it('reports zeros for an empty set', () => {
    expect(summarize([])).toEqual({
      games: 0,
      forfeits: 0,
      averageTurns: 0,
      p1WinRate: 0,
      higherRatedWinRate: 0,
      byBand: [],
    });
  });

  it('aggregates counts, bands and win rates', () => {
    const upset = record({ winner: 'p1' });
    const favorite = record({ winner: 'p2' });
    const high = record({
      winner: 'p1',
      forfeited: true,
      turnCount: 15,
      players: { p1: { name: 'a', rating: 1800 }, p2: { name: 'b', rating: 1700 } },
    });
    const summary = summarize([upset, favorite, high]);

    expect(summary.games).toBe(3);
    expect(summary.forfeits).toBe(1);
    expect(summary.averageTurns).toBeCloseTo((5 + 5 + 15) / 3);
    expect(summary.p1WinRate).toBeCloseTo(2 / 3);
    expect(summary.higherRatedWinRate).toBeCloseTo(2 / 3);
    expect(summary.byBand).toEqual([
      { band: 1500, games: 2 },
      { band: 1700, games: 1 },
    ]);
  });
});
