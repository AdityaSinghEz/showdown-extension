/**
 * Converting a simulated battle into the state format of poke-engine.
 *
 * poke-engine is the Rust search engine behind Foul Play, a bot that ranks
 * near the top of the Gen 9 Random Battle ladder. This file builds the
 * description of a position that the engine searches; the search itself runs
 * in `tools/engine/search.py`.
 *
 * Because the replay is re-simulated, every Pokemon's real stats, moves,
 * ability and item are known, so nothing has to be guessed the way a live bot
 * must. The output is plain JSON, one object per position.
 */

import { toId } from './engine';
import type { SimBattle, SimPokemon, SimSide } from './sim';

/** One Pokemon in the engine's terms. */
export interface EnginePokemon {
  id: string;
  level: number;
  types: [string, string];
  hp: number;
  maxhp: number;
  ability: string;
  item: string;
  stats: { atk: number; def: number; spa: number; spd: number; spe: number };
  status: string;
  weightKg: number;
  terastallized: boolean;
  teraType: string;
  moves: { id: string; pp: number; disabled: boolean }[];
}

/** One side in the engine's terms. */
export interface EngineSide {
  pokemon: EnginePokemon[];
  activeIndex: number;
  boosts: { atk: number; def: number; spa: number; spd: number; spe: number; accuracy: number; evasion: number };
  sideConditions: Record<string, number>;
  volatileStatuses: string[];
  substituteHealth: number;
  taunt: number;
  yawn: number;
}

/** A whole position. */
export interface EngineState {
  sideOne: EngineSide;
  sideTwo: EngineSide;
  weather: string;
  weatherTurns: number;
  terrain: string;
  terrainTurns: number;
  trickRoom: boolean;
  trickRoomTurns: number;
}

/** The simulator's status codes mapped to the names the engine accepts. */
const STATUS: Record<string, string> = {
  brn: 'burn',
  par: 'paralyze',
  psn: 'poison',
  tox: 'toxic',
  slp: 'sleep',
  frz: 'freeze',
};

/** The simulator's weather ids mapped to the engine's. */
const WEATHER: Record<string, string> = {
  sunnyday: 'sun',
  raindance: 'rain',
  sandstorm: 'sand',
  hail: 'hail',
  snow: 'snow',
  snowscape: 'snow',
  desolateland: 'harshsun',
  primordialsea: 'heavyrain',
};

/** Terrains the engine knows, by the simulator's id. */
const TERRAIN = new Set(['grassyterrain', 'electricterrain', 'mistyterrain', 'psychicterrain']);

/** Volatile conditions passed through to the engine; others are not modelled. */
const VOLATILES = ['leechseed', 'substitute', 'confusion', 'taunt', 'yawn', 'focusenergy', 'partiallytrapped'];

/** Side conditions whose value is a layer count (hazards). */
const LAYERED: Record<string, string> = { spikes: 'spikes', toxicspikes: 'toxic_spikes' };

/** Side conditions that are simply present or absent. */
const FLAGS: Record<string, string> = { stealthrock: 'stealth_rock', stickyweb: 'sticky_web' };

/** Side conditions that last a number of turns. */
const TIMED: Record<string, string> = {
  reflect: 'reflect',
  lightscreen: 'light_screen',
  auroraveil: 'aurora_veil',
  tailwind: 'tailwind',
  safeguard: 'safeguard',
  mist: 'mist',
  luckychant: 'lucky_chant',
};

type Loose = Record<string, unknown> | undefined;

function lower(text: unknown): string {
  return typeof text === 'string' ? text.toLowerCase() : '';
}

/**
 * The id the engine uses for a Pokemon, also used in its `switch <id>` options.
 *
 * @param mon - A simulated Pokemon.
 */
export function engineId(mon: SimPokemon): string {
  const species = (mon as unknown as { species?: { id?: string } }).species;
  return species?.id ?? toId(mon.speciesName ?? mon.name ?? '');
}

function pokemonState(mon: SimPokemon): EnginePokemon {
  const raw = mon as unknown as Record<string, unknown>;
  const stats = (raw.storedStats ?? {}) as Record<string, number>;
  const types = ((raw.types as string[] | undefined) ?? ['Normal']).map(lower);
  const slots = (raw.moveSlots as { id: string; pp: number; disabled?: boolean }[] | undefined) ?? [];
  return {
    id: engineId(mon),
    level: (raw.level as number | undefined) ?? 100,
    types: [types[0] ?? 'normal', types[1] ?? 'typeless'],
    hp: mon.fainted ? 0 : mon.hp,
    maxhp: mon.maxhp,
    ability: toId(String(raw.ability ?? '')) || 'none',
    item: toId(String(raw.item ?? '')) || 'none',
    stats: { atk: stats.atk ?? 100, def: stats.def ?? 100, spa: stats.spa ?? 100, spd: stats.spd ?? 100, spe: stats.spe ?? 100 },
    status: mon.fainted ? 'none' : (STATUS[mon.status] ?? 'none'),
    weightKg: ((raw.weighthg as number | undefined) ?? 0) / 10,
    terastallized: Boolean(mon.terastallized),
    teraType: lower(raw.teraType) || 'typeless',
    moves: slots.slice(0, 4).map((slot) => ({ id: slot.id, pp: slot.pp, disabled: Boolean(slot.disabled) })),
  };
}

function sideState(side: SimSide): EngineSide | null {
  const mons = side.pokemon;
  if (mons.length === 0 || mons.length > 6) return null;
  const activeIndex = mons.findIndex((mon) => mon === side.active[0]);
  if (activeIndex < 0) return null;
  const active = mons[activeIndex] as SimPokemon;
  const boosts = (active.boosts ?? {}) as Record<string, number>;
  const volatiles = ((active as unknown as { volatiles?: Record<string, Loose> }).volatiles ?? {}) as Record<string, Loose>;
  const conditions = (side.sideConditions ?? {}) as Record<string, Loose>;

  const out: Record<string, number> = {};
  for (const [key, name] of Object.entries(LAYERED)) {
    if (conditions[key]) out[name] = (conditions[key]?.layers as number | undefined) ?? 1;
  }
  for (const [key, name] of Object.entries(FLAGS)) if (conditions[key]) out[name] = 1;
  for (const [key, name] of Object.entries(TIMED)) {
    if (conditions[key]) out[name] = (conditions[key]?.duration as number | undefined) ?? 1;
  }

  return {
    pokemon: mons.map(pokemonState),
    activeIndex,
    boosts: {
      atk: boosts.atk ?? 0,
      def: boosts.def ?? 0,
      spa: boosts.spa ?? 0,
      spd: boosts.spd ?? 0,
      spe: boosts.spe ?? 0,
      accuracy: boosts.accuracy ?? 0,
      evasion: boosts.evasion ?? 0,
    },
    sideConditions: out,
    volatileStatuses: VOLATILES.filter((name) => volatiles[name] !== undefined),
    substituteHealth: (volatiles.substitute?.hp as number | undefined) ?? 0,
    taunt: (volatiles.taunt?.duration as number | undefined) ?? 0,
    yawn: (volatiles.yawn?.duration as number | undefined) ?? 0,
  };
}

/**
 * Describes a simulated battle for the engine.
 *
 * @param battle - A battle at the start of a turn.
 * @returns The position, or `null` if a side cannot be described (for example no active Pokemon).
 */
export function toEngineState(battle: SimBattle): EngineState | null {
  const one = sideState(battle.sides[0] as SimSide);
  const two = sideState(battle.sides[1] as SimSide);
  if (one === null || two === null) return null;
  const field = (battle as unknown as { field?: Record<string, unknown> }).field ?? {};
  const weather = WEATHER[String(field.weather ?? '')] ?? 'none';
  const weatherState = (field.weatherState ?? {}) as Record<string, number>;
  const terrainId = String(field.terrain ?? '');
  const terrainState = (field.terrainState ?? {}) as Record<string, number>;
  const pseudo = (field.pseudoWeather ?? {}) as Record<string, Loose>;
  const trick = pseudo.trickroom;
  return {
    sideOne: one,
    sideTwo: two,
    weather,
    weatherTurns: weather === 'none' ? 0 : (weatherState.duration ?? 0),
    terrain: TERRAIN.has(terrainId) ? terrainId : 'none',
    terrainTurns: TERRAIN.has(terrainId) ? (terrainState.duration ?? 0) : 0,
    trickRoom: trick !== undefined,
    trickRoomTurns: (trick?.duration as number | undefined) ?? 0,
  };
}

/** One choice a side may make, with the name the engine gives it. */
export interface EngineOption {
  /** The simulator choice text, for example `move 2 terastallize` or `switch 3`. */
  choice: string;
  /** The engine's name for it, for example `flamethrower-tera` or `switch blastoise`. */
  engine: string;
}

/**
 * Names for a side's legal options in the engine's vocabulary.
 *
 * @param side - The simulated side.
 * @param options - The legal options from {@link legalOptions}.
 */
export function engineOptions(
  side: SimSide,
  options: readonly { choice: string; kind: string; id: string; slot: number; tera: boolean }[],
): EngineOption[] {
  return options.map((option) =>
    option.kind === 'switch'
      ? { choice: option.choice, engine: `switch ${engineId(side.pokemon[option.slot - 1] as SimPokemon)}` }
      : { choice: option.choice, engine: option.tera ? `${option.id}-tera` : option.id },
  );
}
