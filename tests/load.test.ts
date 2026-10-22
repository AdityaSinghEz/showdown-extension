import { describe, expect, it } from 'vitest';
import { parseGameRecord, parseGames } from '../lib/dataset/load';
import { buildGameRecord, type GameRecord } from '../lib/dataset/record';
import { playedReplay } from './replay-fixtures';

function record(): GameRecord {
  const result = buildGameRecord(playedReplay());
  if (!result.ok) throw new Error('fixture should build');
  return result.record;
}

describe('parseGames', () => {
  it('reads one record per line and ignores blank lines', () => {
    const line = JSON.stringify(record());
    const loaded = parseGames(`${line}\n\n${line}\n`);
    expect(loaded.records).toHaveLength(2);
    expect(loaded.invalid).toBe(0);
  });

  it('round-trips a record unchanged', () => {
    const original = record();
    expect(parseGames(JSON.stringify(original)).records[0]).toEqual(original);
  });

  it('counts broken JSON and records with the wrong shape instead of failing', () => {
    const text = [JSON.stringify(record()), '{not json', '{"id": 5}', '[]', 'null'].join('\n');
    const loaded = parseGames(text);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.invalid).toBe(4);
  });
});

describe('parseGameRecord', () => {
  it('fills in fields that older records lack', () => {
    const old = JSON.parse(JSON.stringify(record())) as Record<string, unknown>;
    delete old.forfeitedBy;
    const parsed = parseGameRecord(old);
    expect(parsed?.forfeitedBy).toBeNull();
  });

  it('treats a missing end-of-turn snapshot as not yet closed', () => {
    const value = JSON.parse(JSON.stringify(record())) as { turns: Array<Record<string, unknown>> };
    delete value.turns[1]?.endState;
    expect(parseGameRecord(value)?.turns[1]?.endState).toBeNull();
  });

  it.each([
    ['an unknown winner', { winner: 'p3' }],
    ['a missing id', { id: undefined }],
    ['turns that are not a list', { turns: 'none' }],
    ['a player without a rating', { players: { p1: { name: 'a' }, p2: { name: 'b', rating: 1 } } }],
    ['a snapshot missing a side', { turns: [{ turn: 1, endState: { p1: {} } }] }],
  ])('rejects %s', (_label, override) => {
    const value = { ...JSON.parse(JSON.stringify(record())), ...override };
    expect(parseGameRecord(value)).toBeNull();
  });
});
