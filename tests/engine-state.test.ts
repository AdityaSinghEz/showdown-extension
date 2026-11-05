import { describe, expect, it } from 'vitest';
import { engineId, engineOptions, toEngineState } from '../lib/review/engine-state';
import type { SimBattle, SimPokemon, SimSide } from '../lib/review/sim';

function mon(id: string, extra: Record<string, unknown> = {}): SimPokemon {
  return {
    hp: 200,
    maxhp: 300,
    fainted: false,
    status: '',
    boosts: { atk: 1, spe: -2 },
    species: { id },
    speciesName: id,
    level: 88,
    types: ['Fire', 'Flying'],
    ability: 'Blaze',
    item: 'Heavy-Duty Boots',
    teraType: 'Ground',
    weighthg: 905,
    storedStats: { atk: 200, def: 180, spa: 250, spd: 190, spe: 220 },
    moveSlots: [
      { id: 'flamethrower', pp: 24, disabled: false },
      { id: 'roost', pp: 8, disabled: true },
    ],
    ...extra,
  } as unknown as SimPokemon;
}

function side(first: SimPokemon, extra: Record<string, unknown> = {}): SimSide {
  return { pokemon: [first, mon('blastoise', { types: ['Water'] })], active: [first], ...extra } as unknown as SimSide;
}

function battle(one: SimSide, two: SimSide, field: Record<string, unknown> = {}): SimBattle {
  return { turn: 3, ended: false, sides: [one, two], field } as unknown as SimBattle;
}

describe('toEngineState', () => {
  it('describes a Pokemon with the engine names and real stats', () => {
    const state = toEngineState(battle(side(mon('charizard', { status: 'brn' })), side(mon('venusaur'))));
    const first = state?.sideOne.pokemon[0];
    expect(first?.id).toBe('charizard');
    expect(first?.types).toEqual(['fire', 'flying']);
    expect(first?.status).toBe('burn');
    expect(first?.ability).toBe('blaze');
    expect(first?.item).toBe('heavydutyboots');
    expect(first?.teraType).toBe('ground');
    expect(first?.weightKg).toBeCloseTo(90.5, 5);
    expect(first?.stats.spe).toBe(220);
    expect(first?.moves[1]).toEqual({ id: 'roost', pp: 8, disabled: true });
    expect(state?.sideOne.boosts.atk).toBe(1);
    expect(state?.sideOne.boosts.spe).toBe(-2);
    expect(state?.sideOne.activeIndex).toBe(0);
  });

  it('gives a single-typed Pokemon the typeless second type the engine expects', () => {
    const state = toEngineState(battle(side(mon('charizard', { types: ['Water'] })), side(mon('venusaur'))));
    expect(state?.sideOne.pokemon[0]?.types).toEqual(['water', 'typeless']);
  });

  it('maps hazards, screens, weather and terrain', () => {
    const one = side(mon('charizard'), {
      sideConditions: { stealthrock: {}, spikes: { layers: 2 }, reflect: { duration: 4 } },
    });
    const state = toEngineState(
      battle(one, side(mon('venusaur')), {
        weather: 'raindance',
        weatherState: { duration: 3 },
        terrain: 'grassyterrain',
        terrainState: { duration: 2 },
        pseudoWeather: { trickroom: { duration: 4 } },
      }),
    );
    expect(state?.sideOne.sideConditions).toEqual({ spikes: 2, stealth_rock: 1, reflect: 4 });
    expect(state?.weather).toBe('rain');
    expect(state?.weatherTurns).toBe(3);
    expect(state?.terrain).toBe('grassyterrain');
    expect(state?.trickRoom).toBe(true);
    expect(state?.trickRoomTurns).toBe(4);
  });

  it('keeps known volatiles and substitute health, and drops ones the engine does not model', () => {
    const active = mon('charizard', { volatiles: { substitute: { hp: 70 }, leechseed: {}, mysteryeffect: {} } });
    const state = toEngineState(battle(side(active), side(mon('venusaur'))));
    expect(state?.sideOne.volatileStatuses.sort()).toEqual(['leechseed', 'substitute']);
    expect(state?.sideOne.substituteHealth).toBe(70);
  });

  it('records a fainted Pokemon with zero HP and no status', () => {
    const fainted = mon('blastoise', { fainted: true, status: 'psn' });
    const one = { pokemon: [mon('charizard'), fainted], active: [undefined] } as unknown as SimSide;
    one.active = [one.pokemon[0]];
    const state = toEngineState(battle(one, side(mon('venusaur'))));
    expect(state?.sideOne.pokemon[1]).toMatchObject({ hp: 0, status: 'none' });
  });

  it('returns null when a side has no active Pokemon', () => {
    const one = { pokemon: [mon('charizard')], active: [undefined] } as unknown as SimSide;
    expect(toEngineState(battle(one, side(mon('venusaur'))))).toBeNull();
  });
});

describe('engineOptions', () => {
  it('names moves, Tera moves and switches the way the engine does', () => {
    const s = side(mon('charizard'));
    const names = engineOptions(s, [
      { choice: 'move 1', kind: 'move', id: 'flamethrower', slot: 1, tera: false },
      { choice: 'move 1 terastallize', kind: 'move', id: 'flamethrower', slot: 1, tera: true },
      { choice: 'switch 2', kind: 'switch', id: '', slot: 2, tera: false },
    ]);
    expect(names.map((n) => n.engine)).toEqual(['flamethrower', 'flamethrower-tera', 'switch blastoise']);
    expect(engineId(s.pokemon[1] as SimPokemon)).toBe('blastoise');
  });
});
