/**
 * A position as one player could see it.
 *
 * The replay holds the whole battle. A player sees all of their own team, but of the opponent only
 * the Pokemon that have appeared, the moves those have used, an ability or item if it was shown,
 * and a Tera type once it is used. Everything else is a guess: this module fills it in with one
 * plausible draw from the random-battle set data, so the engine grades a move against a position
 * the player could really have believed in.
 *
 * Pokemon the opponent has not shown yet are not predicted; they are left out of the view.
 */

import type { EnginePokemon, EngineSide, EngineState } from './engine-state';
import { sampleSet, type SetsData } from './opponent-sets';
import type { SeenPokemon } from './reveals';

/** Items common in random battles, with rough weights. Used for an item that was never shown. */
export const ITEM_PRIOR: readonly (readonly [string, number])[] = [
  ['leftovers', 22],
  ['heavydutyboots', 20],
  ['lifeorb', 12],
  ['choicescarf', 7],
  ['choicespecs', 6],
  ['assaultvest', 6],
  ['choiceband', 5],
  ['focussash', 5],
  ['rockyhelmet', 4],
  ['blacksludge', 3],
  ['expertbelt', 2],
  ['airballoon', 2],
];

/** Power points given to a move the opponent may have but has not used. */
const GUESSED_PP = 16;

/** Draws an item from {@link ITEM_PRIOR}. */
export function sampleItem(random: () => number): string {
  const total = ITEM_PRIOR.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [item, weight] of ITEM_PRIOR) {
    roll -= weight;
    if (roll < 0) return item;
  }
  return ITEM_PRIOR[0]?.[0] ?? 'leftovers';
}

/** What to draw for the opponent, besides the data itself. */
export interface ViewOptions {
  data: SetsData;
  random: () => number;
  /**
   * Moves to count as seen on the opponent's active Pokemon, for example the move it actually
   * played this turn, so a comparison against that move is always possible.
   */
  extraMoves?: readonly string[];
}

function guessPokemon(mon: EnginePokemon, seen: SeenPokemon | undefined, extra: readonly string[], options: ViewOptions): EnginePokemon {
  const moves = [...(seen?.moves ?? [])];
  for (const move of extra) if (!moves.includes(move)) moves.push(move);
  const drawn = sampleSet(mon.id, { moves, ability: seen?.ability ?? null, teraType: seen?.teraType ?? null }, options.data, options.random);

  const result: EnginePokemon = { ...mon };
  if (drawn !== null) {
    const real = new Map(mon.moves.map((move) => [move.id, move]));
    result.moves = drawn.moves.map((id) => real.get(id) ?? { id, pp: GUESSED_PP, disabled: false });
    if (seen?.ability == null && drawn.ability !== null) result.ability = drawn.ability;
  }
  // A shown item is the Pokemon's real current one (which may be "none" after it was lost).
  if (seen?.item == null) result.item = sampleItem(options.random);
  if (!mon.terastallized) {
    result.teraType = seen?.teraType ?? drawn?.teraType ?? mon.types[0];
  }
  return result;
}

/**
 * The position from one side's point of view.
 *
 * @param state - The full-information state.
 * @param viewer - The side whose view this is; its own Pokemon are left as they are.
 * @param seen - What that side has seen of the other side, by species id.
 * @param options - The set data, a random source and any moves to count as seen.
 * @returns A copy of the state; the input is not changed.
 */
export function viewFor(state: EngineState, viewer: 'sideOne' | 'sideTwo', seen: ReadonlyMap<string, SeenPokemon>, options: ViewOptions): EngineState {
  const otherKey = viewer === 'sideOne' ? 'sideTwo' : 'sideOne';
  const other = state[otherKey];
  const pokemon = other.pokemon.map((mon, index) => {
    const shown = seen.get(mon.id);
    const active = index === other.activeIndex;
    if (shown === undefined && !active) return { ...mon, hp: 0, status: 'none' };
    return guessPokemon(mon, shown, active ? (options.extraMoves ?? []) : [], options);
  });
  const hidden: EngineSide = { ...other, pokemon };
  return { ...state, [otherKey]: hidden };
}
