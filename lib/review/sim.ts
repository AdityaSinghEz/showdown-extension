/**
 * Minimal typing and loading for a built copy of the Showdown simulator.
 *
 * The simulator is built from source into a folder (see `npm run sim:setup`)
 * and ships no type declarations, so only the parts this project touches are
 * described here.
 */

import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

/** One Pokemon as the simulator stores it. */
export interface SimPokemon {
  hp: number;
  maxhp: number;
  fainted: boolean;
  status: string;
  terastallized?: string | false;
  speciesName?: string;
  name?: string;
  boosts?: Record<string, number>;
  /** Base stats of the species. */
  species?: { baseStats: Record<string, number> };
  moveSlots?: { id: string }[];
  getTypes?(): string[];
  getStat?(stat: string, unboosted?: boolean, unmodified?: boolean): number;
}

/** One side of a simulated battle. */
export interface SimSide {
  pokemon: SimPokemon[];
  active: (SimPokemon | undefined)[];
  /** The pending choice request, or null/undefined when none is waiting. */
  activeRequest?: SimRequest | null;
  /** Hazards and screens on this side, keyed by condition id. */
  sideConditions?: Record<string, { layers?: number } | undefined>;
  name?: string;
}

/** Move data from the simulator's dex. */
export interface SimMoveData {
  basePower: number;
  type: string;
  category: string;
  accuracy: number | true;
  /** Fraction of max HP healed, as [numerator, denominator]. */
  heal?: [number, number];
  /** Stat changes the move causes. */
  boosts?: Record<string, number>;
  /** Who the move targets, for example `self` or `normal`. */
  target?: string;
  /** Entry hazard or screen the move sets up. */
  sideCondition?: string;
}

/** A pending request for one side's choice. */
export interface SimRequest {
  wait?: boolean;
  forceSwitch?: boolean[];
  active?: {
    moves: { move: string; id: string; disabled?: boolean | string }[];
    canTerastallize?: string;
    trapped?: boolean;
    maybeTrapped?: boolean;
  }[];
  side: { pokemon: { ident: string; details: string; condition: string; active: boolean }[] };
}

/** A simulated battle. */
export interface SimBattle {
  turn: number;
  ended: boolean;
  sides: SimSide[];
  prng: unknown;
  winner?: string;
  dex?: {
    moves: { get(id: string): SimMoveData };
    getEffectiveness(source: string, target: string[]): number;
    getImmunity(source: string, target: string[]): boolean;
  };
  choose(side: 'p1' | 'p2', choice: string): boolean;
  toJSON(): unknown;
}

/** The parts of the simulator module this project uses. */
export interface SimModule {
  Battle: {
    new (options: { formatid: string; seed: number[]; p1: { name: string }; p2: { name: string } }): SimBattle;
    fromJSON(serialized: unknown): SimBattle;
  };
  PRNG: new (seed: number[]) => unknown;
  BattleStream: new () => { battle: SimBattle | null };
  getPlayerStreams(stream: never): {
    omniscient: { write(data: string): Promise<void>; [Symbol.asyncIterator](): AsyncIterator<string> };
  };
}

/**
 * Loads a built simulator.
 *
 * @param folder - A folder holding a built Showdown checkout (its `dist/sim`).
 */
export function loadBuiltSim(folder: string): SimModule {
  const require = createRequire(import.meta.url);
  return require(join(resolve(folder), 'dist', 'sim')) as SimModule;
}
