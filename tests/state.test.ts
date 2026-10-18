import { describe, expect, it, vi } from 'vitest';
import { BattleTracker, parseRatingUpdate } from '../lib/battle/state';

const ROOM = 'battle-gen9randombattle-111';

function message(...lines: string[]): string {
  return [`>${ROOM}`, ...lines].join('\n');
}

describe('BattleTracker', () => {
  it('tracks players, turns and the winner', () => {
    const tracker = new BattleTracker();
    tracker.ingest(message('|player|p1|Alice|1|1500', '|player|p2|Bob|2|1480'));
    tracker.ingest(message('|turn|1'));
    tracker.ingest(message('|turn|2'));
    tracker.ingest(message('|win|Alice'));

    const state = tracker.get(ROOM);
    expect(state?.format).toBe('gen9randombattle');
    expect(state?.players.p1).toEqual({ slot: 'p1', name: 'Alice', rating: 1500 });
    expect(state?.players.p2).toEqual({ slot: 'p2', name: 'Bob', rating: 1480 });
    expect(state?.turn).toBe(2);
    expect(state?.winner).toBe('Alice');
    expect(state?.ended).toBe(true);
  });

  it('stores a null rating when the server omits it', () => {
    const tracker = new BattleTracker();
    tracker.ingest(message('|player|p1|Alice|1|'));
    expect(tracker.get(ROOM)?.players.p1?.rating).toBeNull();
  });

  it('fires the end listener exactly once', () => {
    const tracker = new BattleTracker();
    const listener = vi.fn();
    tracker.onBattleEnd(listener);
    tracker.ingest(message('|win|Alice'));
    tracker.ingest(message('|win|Alice'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats a tie as ended with no winner', () => {
    const tracker = new BattleTracker();
    tracker.ingest(message('|tie'));
    const state = tracker.get(ROOM);
    expect(state?.ended).toBe(true);
    expect(state?.winner).toBeNull();
  });

  it('ignores messages for non-battle rooms', () => {
    const tracker = new BattleTracker();
    tracker.ingest('>lobby\n|turn|1');
    expect(tracker.all()).toHaveLength(0);
  });

  it('keeps battles in different rooms separate', () => {
    const tracker = new BattleTracker();
    tracker.ingest('>battle-gen9randombattle-1\n|turn|3');
    tracker.ingest('>battle-gen9randombattle-2\n|turn|7');
    expect(tracker.get('battle-gen9randombattle-1')?.turn).toBe(3);
    expect(tracker.get('battle-gen9randombattle-2')?.turn).toBe(7);
  });

  it('records rating updates from raw events', () => {
    const tracker = new BattleTracker();
    tracker.ingest(
      message("|raw|Alice's rating: 1500 &rarr; <strong>1520</strong><br />(+20 for winning)"),
    );
    expect(tracker.get(ROOM)?.ratingUpdates).toEqual([
      { name: 'Alice', before: 1500, after: 1520 },
    ]);
  });
});

describe('parseRatingUpdate', () => {
  it('parses HTML-escaped and unicode arrows', () => {
    expect(parseRatingUpdate("Bob's rating: 1480 &rarr; <strong>1460</strong>")).toEqual({
      name: 'Bob',
      before: 1480,
      after: 1460,
    });
    expect(parseRatingUpdate("Bob's rating: 1480 → 1460")).toEqual({
      name: 'Bob',
      before: 1480,
      after: 1460,
    });
  });

  it('returns null for unrelated text', () => {
    expect(parseRatingUpdate('Alice joined')).toBeNull();
  });
});
