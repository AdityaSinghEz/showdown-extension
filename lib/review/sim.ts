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
}

/** One side of a simulated battle. */
export interface SimSide {
  pokemon: SimPokemon[];
  active: (SimPokemon | undefined)[];
  /** The pending choice request, or null/undefined when none is waiting. */
  activeRequest?: SimRequest | null;
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
  choose(side: 'p1' | 'p2', choice: string): boolean;
  toJSON(): unknown;
}

/** The parts of the simulator module this project uses. */
export interface SimModule {
  Battle: { fromJSON(serialized: unknown): SimBattle };
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
