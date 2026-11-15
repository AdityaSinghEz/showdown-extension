import { describe, expect, it } from 'vitest';
import type { EnginePokemon, EngineSide, EngineState } from '../lib/review/engine-state';
import { seededRandom, type SetsData } from '../lib/review/opponent-sets';
import { ITEM_PRIOR, sampleItem, viewFor } from '../lib/review/player-view';
import type { SeenPokemon } from '../lib/review/reveals';

function mon(id: string, moves: string[], extra: Partial<EnginePokemon> = {}): EnginePokemon {
  return {
    id,
    level: 80,
    types: ['water', 'typeless'],
    hp: 200,
    maxhp: 200,
    ability: 'realability',
    item: 'realitem',
    stats: { atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    status: 'none',
    weightKg: 50,
    terastallized: false,
    teraType: 'realtera',
    moves: moves.map((move) => ({ id: move, pp: 8, disabled: false })),
    ...extra,
  };
}

function side(pokemon: EnginePokemon[]): EngineSide {
  return { pokemon, activeIndex: 0, boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 }, sideConditions: {}, volatileStatuses: [], substituteHealth: 0, taunt: 0, yawn: 0 };
}

const state: EngineState = {
  sideOne: side([mon('hitmontop', ['closecombat', 'tripleaxel'])]),
  sideTwo: side([
    mon('swampert', ['stealthrock', 'earthquake', 'knockoff', 'yawn']),
    mon('noctowl', ['hypervoice', 'nastyplot', 'roost', 'defog']),
    mon('scrafty', ['closecombat', 'drainpunch', 'knockoff', 'bulkup']),
  ]),
  weather: 'none',
  weatherTurns: 0,
  terrain: 'none',
  terrainTurns: 0,
  trickRoom: false,
  trickRoomTurns: 0,
};

const data: SetsData = {
  swampert: {
    sets: [
      { role: 'Bulky Support', movepool: ['Earthquake', 'Stealth Rock', 'Yawn', 'Flip Turn', 'Ice Beam', 'Roar'], abilities: ['Damp'], teraTypes: ['Steel', 'Water'] },
    ],
  },
  noctowl: { sets: [{ role: 'Bulky Attacker', movepool: ['Hyper Voice', 'Nasty Plot', 'Roost', 'Defog'], abilities: ['Tinted Lens'], teraTypes: ['Normal'] }] },
};

const seen = new Map<string, SeenPokemon>([
  ['swampert', { moves: ['yawn'], ability: null, item: null, teraType: null }],
  ['noctowl', { moves: [], ability: null, item: 'leftovers', teraType: null }],
]);

const options = (seed = 1, extraMoves: string[] = []) => ({ data, random: seededRandom(seed), extraMoves });

describe('the view of one player', () => {
  it('leaves the viewer\'s own side as it is', () => {
    const view = viewFor(state, 'sideOne', seen, options());
    expect(view.sideOne).toEqual(state.sideOne);
  });

  it('does not change the input', () => {
    const copy = JSON.stringify(state);
    viewFor(state, 'sideOne', seen, options());
    expect(JSON.stringify(state)).toBe(copy);
  });

  it('removes Pokemon the opponent has not shown', () => {
    const view = viewFor(state, 'sideOne', seen, options());
    expect(view.sideTwo.pokemon[2]?.hp).toBe(0);
    expect(view.sideTwo.pokemon[0]?.hp).toBe(200);
  });

  it('keeps the moves that were seen and draws the rest from the data', () => {
    const view = viewFor(state, 'sideOne', seen, options());
    const moves = view.sideTwo.pokemon[0]?.moves.map((m) => m.id) ?? [];
    expect(moves).toContain('yawn');
    expect(moves).toHaveLength(4);
    for (const move of moves) expect(['earthquake', 'stealthrock', 'yawn', 'flipturn', 'icebeam', 'roar']).toContain(move);
  });

  it('keeps real power points for a move the Pokemon really has', () => {
    const view = viewFor(state, 'sideOne', seen, options());
    const yawn = view.sideTwo.pokemon[0]?.moves.find((m) => m.id === 'yawn');
    expect(yawn?.pp).toBe(8);
  });

  it('draws an ability and a Tera type the role allows, never the real ones', () => {
    const view = viewFor(state, 'sideOne', seen, options());
    expect(view.sideTwo.pokemon[0]?.ability).toBe('damp');
    expect(['steel', 'water']).toContain(view.sideTwo.pokemon[0]?.teraType);
  });

  it('keeps a shown item and replaces one that was not shown', () => {
    const view = viewFor(state, 'sideOne', seen, options());
    expect(view.sideTwo.pokemon[1]?.item).toBe('realitem'); // shown: the real current item
    expect(ITEM_PRIOR.map(([item]) => item)).toContain(view.sideTwo.pokemon[0]?.item);
  });

  it('counts extra moves as seen on the active Pokemon', () => {
    const view = viewFor(state, 'sideOne', seen, options(2, ['flipturn']));
    expect(view.sideTwo.pokemon[0]?.moves.map((m) => m.id)).toContain('flipturn');
    expect(view.sideTwo.pokemon[0]?.moves.map((m) => m.id)).toContain('yawn');
  });

  it('gives the same view for the same seed and different views across seeds', () => {
    expect(viewFor(state, 'sideOne', seen, options(5))).toEqual(viewFor(state, 'sideOne', seen, options(5)));
    const variants = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(viewFor(state, 'sideOne', seen, options(i + 1)).sideTwo.pokemon[0])));
    expect(variants.size).toBeGreaterThan(2);
  });

  it('keeps a Tera that was already used', () => {
    const used: EngineState = { ...state, sideTwo: side([mon('swampert', ['yawn'], { terastallized: true, teraType: 'water' }), ...state.sideTwo.pokemon.slice(1)]) };
    const view = viewFor(used, 'sideOne', seen, options());
    expect(view.sideTwo.pokemon[0]?.teraType).toBe('water');
  });

  it('works from side two\'s point of view too', () => {
    const view = viewFor(state, 'sideTwo', new Map([['hitmontop', { moves: ['tripleaxel'], ability: null, item: null, teraType: null }]]), options());
    expect(view.sideTwo).toEqual(state.sideTwo);
    expect(view.sideOne.pokemon[0]?.moves.map((m) => m.id)).toContain('tripleaxel');
  });

  it('keeps its real moves for a species missing from the data', () => {
    const odd: EngineState = { ...state, sideTwo: side([mon('missingmon', ['tackle', 'growl'])]) };
    const view = viewFor(odd, 'sideOne', new Map(), options());
    expect(view.sideTwo.pokemon[0]?.moves.map((m) => m.id)).toEqual(['tackle', 'growl']);
    expect(view.sideTwo.pokemon[0]?.ability).toBe('realability');
  });
});

describe('item prior', () => {
  it('draws items from the list', () => {
    const items = new Set(Array.from({ length: 200 }, (_, i) => sampleItem(seededRandom(i + 1))));
    for (const item of items) expect(ITEM_PRIOR.map(([name]) => name)).toContain(item);
    expect(items.size).toBeGreaterThan(5);
  });
});
