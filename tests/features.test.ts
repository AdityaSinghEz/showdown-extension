import { describe, expect, it } from 'vitest';
import type { ActivePokemon, SideSnapshot } from '../lib/battle/types';
import { buildGameRecord, type GameRecord } from '../lib/dataset/record';
import { extractSamples, FEATURE_NAMES, hasTeamHp, snapshotFeatures } from '../lib/model/features';
import { lateForfeitReplay, playedReplay } from './replay-fixtures';

function active(overrides: Partial<ActivePokemon> = {}): ActivePokemon {
  return { nickname: 'A', species: 'A', hp: 1, status: null, tera: null, ...overrides };
}

function side(overrides: Partial<SideSnapshot> = {}): SideSnapshot {
  return { active: active(), remaining: 6, teamHp: 6, teraUsed: false, ...overrides };
}

function record(replay = playedReplay()): GameRecord {
  const result = buildGameRecord(replay);
  if (!result.ok) throw new Error('fixture should build');
  return result.record;
}

function expectVector(actual: number[] | null, expected: number[]): void {
  expect(actual).not.toBeNull();
  expected.forEach((value, i) => expect(actual?.[i]).toBeCloseTo(value));
  expect(actual).toHaveLength(expected.length);
}

describe('snapshotFeatures', () => {
  it('returns one value per feature name', () => {
    expect(snapshotFeatures(side(), side())).toHaveLength(FEATURE_NAMES.length);
  });

  it('is all zeros for equal sides', () => {
    expectVector(snapshotFeatures(side(), side()), [0, 0, 0, 0, 0]);
  });

  it('measures player 1 minus player 2 for counts and HP', () => {
    const behind = side({ remaining: 5, teamHp: 4.5, active: active({ hp: 0.4 }) });
    expectVector(snapshotFeatures(behind, side()), [-1, -1.5, -0.6, 0, 0]);
  });

  it('counts a fainted active Pokemon as zero HP', () => {
    const fainted = side({ active: active({ hp: 0 }) });
    const noActive = side({ active: null });
    expect(snapshotFeatures(fainted, side())?.[2]).toBeCloseTo(-1);
    expect(snapshotFeatures(noActive, side())?.[2]).toBeCloseTo(-1);
  });

  it('rewards a status on the opponent and penalizes one on yourself', () => {
    expect(snapshotFeatures(side(), side({ active: active({ status: 'par' }) }))?.[3]).toBe(1);
    expect(snapshotFeatures(side({ active: active({ status: 'slp' }) }), side())?.[3]).toBe(-1);
    const both = snapshotFeatures(
      side({ active: active({ status: 'brn' }) }),
      side({ active: active({ status: 'tox' }) }),
    );
    expect(both?.[3]).toBe(0);
  });

  it('ignores minor or unknown status values', () => {
    expect(snapshotFeatures(side(), side({ active: active({ status: 'confusion' }) }))?.[3]).toBe(0);
  });

  it('records which side has used Terastallization', () => {
    expect(snapshotFeatures(side({ teraUsed: true }), side())?.[4]).toBe(1);
    expect(snapshotFeatures(side(), side({ teraUsed: true }))?.[4]).toBe(-1);
    expect(snapshotFeatures(side({ teraUsed: true }), side({ teraUsed: true }))?.[4]).toBe(0);
  });

  it('gives exactly opposite vectors when the sides are swapped', () => {
    const a = side({ remaining: 4, teamHp: 3.2, teraUsed: true, active: active({ hp: 0.3, status: 'par' }) });
    const b = side({ remaining: 5, teamHp: 4.1, active: active({ hp: 0.8 }) });
    const forward = snapshotFeatures(a, b);
    const mirrored = snapshotFeatures(b, a);
    expect(forward).not.toBeNull();
    forward?.forEach((value, i) => expect(value).toBeCloseTo(-(mirrored?.[i] ?? NaN)));
  });

  it('returns null when the position cannot be used', () => {
    expect(snapshotFeatures(side({ remaining: null }), side())).toBeNull();
    expect(snapshotFeatures(side(), side({ teamHp: null }))).toBeNull();
    // A record from before team HP tracking has no teamHp at all.
    expect(snapshotFeatures(side({ teamHp: undefined as unknown as null }), side())).toBeNull();
  });

  it('returns null once a side has no Pokemon left', () => {
    expect(snapshotFeatures(side({ remaining: 0 }), side())).toBeNull();
    expect(snapshotFeatures(side(), side({ remaining: 0 }))).toBeNull();
  });
});

describe('extractSamples', () => {
  it('creates one sample per turn, skipping the leads', () => {
    const samples = extractSamples(record());
    expect(samples.map((s) => s.turn)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(samples.map((s) => s.gameId))).toEqual(new Set(['gen9randombattle-100']));
  });

  it('labels every position with the game result from player 1 point of view', () => {
    // Bob (p2) won, so player 1 lost.
    expect(extractSamples(record()).every((s) => s.label === 0)).toBe(true);
  });

  it('computes the expected features after turn 1 and turn 2', () => {
    const samples = extractSamples(record());
    // Turn 1: Zoroark at 120/310 vs Hydrapple at 60%, nobody fainted.
    expectVector(samples[0]?.features ?? null, [0, 120 / 310 - 0.6, 120 / 310 - 0.6, 0, 0]);
    // Turn 2: Zoroark fainted (5 left, HP 0), Hydrapple at 20%.
    expectVector(samples[1]?.features ?? null, [-1, -0.2, -0.2, 0, 0]);
  });

  it('skips forfeited games unless asked to include them', () => {
    const forfeited = record(lateForfeitReplay());
    expect(forfeited.forfeited).toBe(true);
    expect(extractSamples(forfeited)).toEqual([]);
    expect(extractSamples(forfeited, { includeForfeits: true })).toHaveLength(5);
  });

  it('skips positions that are already decided', () => {
    const decided = JSON.parse(JSON.stringify(record())) as GameRecord;
    const last = decided.turns[decided.turns.length - 1];
    if (!last?.endState) throw new Error('fixture should have a final snapshot');
    last.endState.p2.remaining = 0;
    expect(extractSamples(decided).map((s) => s.turn)).toEqual([1, 2, 3, 4]);
  });
});

describe('hasTeamHp', () => {
  it('is true for current records and false for ones built before team HP existed', () => {
    const current = record();
    expect(hasTeamHp(current)).toBe(true);
    const old = JSON.parse(
      JSON.stringify(current, (key, value: unknown) => (key === 'teamHp' ? undefined : value)),
    ) as GameRecord;
    expect(hasTeamHp(old)).toBe(false);
  });
});
