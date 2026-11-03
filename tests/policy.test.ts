import { describe, expect, it } from 'vitest';
import { chooseAction, seededRandom } from '../lib/review/policy';
import type { SimBattle, SimPokemon, SimRequest, SimSide } from '../lib/review/sim';

describe('seededRandom', () => {
  it('repeats exactly for the same seed and stays in [0, 1)', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(seededRandom(43)()).not.toBe(first[0]);
  });
});

function mon(): SimPokemon {
  return {
    hp: 100,
    maxhp: 100,
    fainted: false,
    status: '',
    boosts: {},
    species: { baseStats: { atk: 100, spa: 50 } },
    moveSlots: [{ id: 'tackle' }],
    getTypes: () => ['Normal'],
    getStat: () => 100,
  };
}

function battleWith(request: SimRequest | null): SimBattle {
  const a = mon();
  const b = mon();
  const sideOne: SimSide = { pokemon: [a, mon()], active: [a], activeRequest: request };
  const sideTwo: SimSide = { pokemon: [b], active: [b], activeRequest: null };
  return {
    turn: 1,
    ended: false,
    sides: [sideOne, sideTwo],
    prng: null,
    choose: () => true,
    toJSON: () => ({}),
    dex: {
      moves: { get: () => ({ basePower: 40, type: 'Normal', category: 'Physical', accuracy: 100 }) },
      getEffectiveness: () => 0,
      getImmunity: () => true,
    },
  };
}

const request: SimRequest = {
  active: [{ moves: [{ move: 'Tackle', id: 'tackle' }, { move: 'Growl', id: 'growl' }] }],
  side: {
    pokemon: [
      { ident: 'p1: A', details: 'A, L80', condition: '100/100', active: true },
      { ident: 'p1: B', details: 'B, L80', condition: '100/100', active: false },
    ],
  },
};

describe('chooseAction', () => {
  it('returns a legal choice for a normal turn', () => {
    const random = seededRandom(1);
    for (let i = 0; i < 20; i++) {
      expect(chooseAction(battleWith(request), 0, random)).toMatch(/^(move [12]|switch 2)$/);
    }
  });

  it('is repeatable with the same seed', () => {
    const run = (seed: number) => {
      const random = seededRandom(seed);
      return Array.from({ length: 10 }, () => chooseAction(battleWith(request), 0, random));
    };
    expect(run(9)).toEqual(run(9));
  });

  it('returns null when nothing is waiting or the side must wait', () => {
    expect(chooseAction(battleWith(null), 0, seededRandom(1))).toBeNull();
    expect(chooseAction(battleWith({ ...request, wait: true }), 0, seededRandom(1))).toBeNull();
  });

  it('sends in a benched Pokemon after a faint', () => {
    expect(chooseAction(battleWith({ ...request, forceSwitch: [true] }), 0, seededRandom(1))).toBe('switch 2');
  });
});
