import { describe, expect, it } from 'vitest';
import { richFeatures, RICH_FEATURE_NAMES } from '../lib/review/features';
import { winProbability } from '../lib/review/position';
import type { SimBattle, SimPokemon, SimSide } from '../lib/review/sim';

const MOVES: Record<string, { basePower: number; type: string; category: string; accuracy: number | true }> = {
  earthquake: { basePower: 100, type: 'Ground', category: 'Physical', accuracy: 100 },
  surf: { basePower: 90, type: 'Water', category: 'Special', accuracy: 100 },
  toxic: { basePower: 0, type: 'Poison', category: 'Status', accuracy: 90 },
};

function mon(overrides: Partial<SimPokemon> & { types?: string[]; moves?: string[]; speed?: number } = {}): SimPokemon {
  const { types = ['Normal'], moves = [], speed = 100, ...rest } = overrides;
  return {
    hp: 100,
    maxhp: 100,
    fainted: false,
    status: '',
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    species: { baseStats: { atk: 100, spa: 50 } },
    moveSlots: moves.map((id) => ({ id })),
    getTypes: () => types,
    getStat: () => speed,
    ...rest,
  };
}

function side(pokemon: SimPokemon[], extra: Partial<SimSide> = {}): SimSide {
  return { pokemon, active: [pokemon[0]], ...extra };
}

function battle(p1: SimSide, p2: SimSide): SimBattle {
  return {
    turn: 3,
    ended: false,
    sides: [p1, p2],
    prng: null,
    choose: () => true,
    toJSON: () => ({}),
    dex: {
      moves: { get: (id: string) => MOVES[id] ?? { basePower: 0, type: 'Normal', category: 'Status', accuracy: true } },
      getEffectiveness: (source: string, target: string[]) => (source === 'Water' && target.includes('Fire') ? 1 : 0),
      getImmunity: (source: string, target: string[]) => !(source === 'Ground' && target.includes('Flying')),
    },
  };
}

const index = (name: (typeof RICH_FEATURE_NAMES)[number]) => RICH_FEATURE_NAMES.indexOf(name);

describe('richFeatures', () => {
  it('is all zeros for identical sides', () => {
    const features = richFeatures(battle(side([mon(), mon()]), side([mon(), mon()])));
    expect(features).toEqual(new Array(RICH_FEATURE_NAMES.length).fill(0));
  });

  it('negates when the sides are swapped', () => {
    const a = side([mon({ hp: 40, boosts: { atk: 2, def: 0, spa: 0, spd: 0, spe: 0 }, speed: 120 }), mon()]);
    const b = side([mon({ status: 'brn' }), mon({ fainted: true, hp: 0 })], { sideConditions: { stealthrock: {} } });
    const forward = richFeatures(battle(a, b)) as number[];
    const swapped = richFeatures(battle(b, a)) as number[];
    forward.forEach((value, i) => expect(swapped[i]).toBeCloseTo(-value, 10));
  });

  it('counts boosts, status, speed and fainted Pokemon', () => {
    const p1 = side([mon({ boosts: { atk: 2, def: 0, spa: 0, spd: 0, spe: 1 }, speed: 150 }), mon()]);
    const p2 = side([mon({ status: 'par', speed: 100 }), mon({ fainted: true, hp: 0 })]);
    const f = richFeatures(battle(p1, p2)) as number[];
    expect(f[index('remaining')]).toBe(1);
    expect(f[index('status')]).toBe(1);
    expect(f[index('attackBoost')]).toBe(2);
    expect(f[index('speedBoost')]).toBe(1);
    expect(f[index('speed')]).toBe(1);
  });

  it('weights hazards by how many Pokemon can still switch in', () => {
    const p1 = side([mon(), mon(), mon()]);
    const p2 = side([mon(), mon(), mon()], { sideConditions: { stealthrock: {}, spikes: { layers: 2 } } });
    // Hazards on player 2's side help player 1: (1 + 2 * 0.5) * 2 benched Pokemon.
    expect((richFeatures(battle(p1, p2)) as number[])[index('hazards')]).toBe(4);
  });

  it('scores offense by type effectiveness and immunity', () => {
    const attacker = side([mon({ types: ['Water'], moves: ['surf', 'toxic'] }), mon()]);
    const fireTarget = side([mon({ types: ['Fire'], moves: [] }), mon()]);
    const flyer = side([mon({ types: ['Flying'], moves: [] }), mon()]);
    // Surf: 0.9 power * 1.5 same-type bonus * 2 effectiveness = 2.7.
    expect((richFeatures(battle(attacker, fireTarget)) as number[])[index('offense')]).toBeCloseTo(2.7, 10);
    const ground = side([mon({ types: ['Ground'], moves: ['earthquake'] }), mon()]);
    expect((richFeatures(battle(ground, flyer)) as number[])[index('offense')]).toBe(0);
  });

  it('returns null once a side is out of Pokemon', () => {
    const out = side([mon({ fainted: true, hp: 0 })]);
    expect(richFeatures(battle(side([mon()]), out))).toBeNull();
  });
});

describe('winProbability with the full-information model', () => {
  const model = { featureNames: [...RICH_FEATURE_NAMES], weights: RICH_FEATURE_NAMES.map((n) => (n === 'teamHp' ? 1 : 0)) };

  it('is 50% for equal sides and favours the side with more HP', () => {
    expect(winProbability(battle(side([mon(), mon()]), side([mon(), mon()])), model)).toBeCloseTo(0.5, 10);
    const ahead = side([mon(), mon()]);
    const behind = side([mon({ hp: 20 }), mon()]);
    expect(winProbability(battle(ahead, behind), model)).toBeGreaterThan(0.5);
  });

  it('accepts a model that uses only some of the features, picked by name', () => {
    const subset = { featureNames: ['hazards', 'teamHp'], weights: [0, 1] };
    const behind = side([mon({ hp: 20 }), mon()]);
    const ahead = side([mon(), mon()]);
    const reference = winProbability(battle(ahead, behind), model);
    expect(winProbability(battle(ahead, behind), subset)).toBeCloseTo(reference, 10);
    expect(winProbability(battle(behind, ahead), subset)).toBeCloseTo(1 - reference, 10);
  });

  it('reports decided positions as 0, 1 or a draw', () => {
    const out = side([mon({ fainted: true, hp: 0 })]);
    expect(winProbability(battle(side([mon()]), out), model)).toBe(1);
    expect(winProbability(battle(out, side([mon()])), model)).toBe(0);
    expect(winProbability(battle(out, out), model)).toBe(0.5);
  });
});
