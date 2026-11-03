import { describe, expect, it } from 'vitest';
import { rolloutValue } from '../lib/review/rollout';
import type { LogisticModel } from '../lib/model/logistic';
import type { SimBattle, SimModule } from '../lib/review/sim';

const model: LogisticModel = {
  featureNames: ['remaining'],
  weights: [1],
  means: [0],
  scales: [1],
} as unknown as LogisticModel;

describe('rolloutValue', () => {
  it('returns the model reading when the battle has already ended', () => {
    const ended = {
      ended: true,
      toJSON: () => ({}),
      sides: [
        { pokemon: [{ fainted: true, hp: 0, maxhp: 100 }], active: [] },
        { pokemon: [{ fainted: false, hp: 100, maxhp: 100 }], active: [] },
      ],
    } as unknown as SimBattle;
    const sim = {} as SimModule;
    expect(rolloutValue(sim, ended, model, { rollouts: 3, depth: 4, seed: 1 })).toBe(0);
  });

  it('falls back to the starting reading when no rollout can be played', () => {
    const live = {
      ended: false,
      turn: 1,
      toJSON: () => ({}),
      sides: [
        { pokemon: [{ fainted: false, hp: 100, maxhp: 100 }], active: [] },
        { pokemon: [{ fainted: true, hp: 0, maxhp: 100 }], active: [] },
      ],
    } as unknown as SimBattle;
    const broken = {
      Battle: {
        fromJSON: () => {
          throw new Error('cannot restore');
        },
      },
    } as unknown as SimModule;
    expect(rolloutValue(broken, live, model, { rollouts: 2, depth: 3, seed: 1 })).toBe(1);
  });

  it('does nothing when asked for zero rollouts', () => {
    const live = {
      ended: false,
      toJSON: () => ({}),
      sides: [
        { pokemon: [{ fainted: true, hp: 0, maxhp: 100 }], active: [] },
        { pokemon: [{ fainted: false, hp: 100, maxhp: 100 }], active: [] },
      ],
    } as unknown as SimBattle;
    expect(rolloutValue({} as SimModule, live, model, { rollouts: 0, depth: 3, seed: 1 })).toBe(0);
  });
});
