/**
 * Position features read directly from a simulated battle.
 *
 * The recorded-game features (`lib/model/features.ts`) see only what a
 * spectator log shows. A simulated battle exposes everything, so this set
 * adds what an experienced player weighs: stat boosts, entry hazards, who
 * moves first, and how hard each active Pokemon can hit the other.
 *
 * Every feature is player 1's advantage over player 2 (positive favours
 * player 1), so swapping the sides negates the whole vector and the model can
 * stay free of an intercept.
 */

import type { SimBattle, SimPokemon, SimSide } from './sim';

/** Names of the features, in vector order. The first five match the spectator-log model. */
export const RICH_FEATURE_NAMES = [
  'remaining',
  'teamHp',
  'activeHp',
  'status',
  'tera',
  'attackBoost',
  'defenseBoost',
  'speedBoost',
  'hazards',
  'speed',
  'offense',
] as const;

const MAJOR_STATUSES: ReadonlySet<string> = new Set(['brn', 'par', 'psn', 'tox', 'slp', 'frz']);

function fraction(hp: number, maxhp: number): number {
  return maxhp > 0 ? Math.max(0, Math.min(1, hp / maxhp)) : 0;
}

function activeOf(side: SimSide): SimPokemon | null {
  const mon = side.active[0];
  return mon && !mon.fainted && mon.hp > 0 ? mon : null;
}

function boost(mon: SimPokemon | null, stat: string): number {
  return mon?.boosts?.[stat] ?? 0;
}

/** Boost on whichever attacking stat the Pokemon is built around. */
function attackBoost(mon: SimPokemon | null): number {
  if (!mon) return 0;
  const base = mon.species?.baseStats;
  const physical = (base?.atk ?? 0) >= (base?.spa ?? 0);
  return boost(mon, physical ? 'atk' : 'spa');
}

function defenseBoost(mon: SimPokemon | null): number {
  return (boost(mon, 'def') + boost(mon, 'spd')) / 2;
}

/**
 * How much entry-hazard damage the side will take as Pokemon switch in:
 * hazards on the field times the number of Pokemon that could still come in.
 */
function hazardLoad(side: SimSide): number {
  const conditions = side.sideConditions ?? {};
  const layers = (id: string): number => {
    const condition = conditions[id];
    return condition === undefined ? 0 : (condition.layers ?? 1);
  };
  const strength = layers('stealthrock') * 1 + layers('spikes') * 0.5 + layers('toxicspikes') * 0.5 + layers('stickyweb') * 0.5;
  const bench = side.pokemon.filter((p) => !p.fainted && p.hp > 0).length - (activeOf(side) ? 1 : 0);
  return strength * Math.max(0, bench);
}

function speedOf(mon: SimPokemon | null): number {
  if (!mon?.getStat) return 0;
  try {
    return mon.getStat('spe', false, false);
  } catch {
    return 0;
  }
}

/**
 * Rough damage potential of one active Pokemon against another: the best move's
 * base power times accuracy, same-type bonus and type effectiveness, in units of
 * 100 base power. Status moves score zero, so a Pokemon with no attacks scores zero.
 */
export function offense(battle: SimBattle, attacker: SimPokemon | null, defender: SimPokemon | null): number {
  if (!attacker || !defender || !battle.dex || !attacker.moveSlots) return 0;
  const attackerTypes = attacker.getTypes?.() ?? [];
  const defenderTypes = defender.getTypes?.() ?? [];
  let best = 0;
  for (const slot of attacker.moveSlots) {
    const move = battle.dex.moves.get(slot.id);
    if (!move || move.category === 'Status' || move.basePower <= 0) continue;
    if (!battle.dex.getImmunity(move.type, defenderTypes)) continue;
    const accuracy = move.accuracy === true ? 1 : move.accuracy / 100;
    const stab = attackerTypes.includes(move.type) ? 1.5 : 1;
    const effectiveness = 2 ** battle.dex.getEffectiveness(move.type, defenderTypes);
    best = Math.max(best, (move.basePower / 100) * accuracy * stab * effectiveness);
  }
  return Math.min(best, 8);
}

/**
 * Computes the feature vector for the current position of a simulated battle.
 *
 * @param battle - The simulated battle.
 * @returns The vector in {@link RICH_FEATURE_NAMES} order, or `null` when a
 *   side has no Pokemon left (the game is decided).
 */
export function richFeatures(battle: SimBattle): number[] | null {
  const p1 = battle.sides[0] as SimSide;
  const p2 = battle.sides[1] as SimSide;
  const alive = (side: SimSide): number => side.pokemon.filter((p) => !p.fainted && p.hp > 0).length;
  if (alive(p1) <= 0 || alive(p2) <= 0) return null;

  const a1 = activeOf(p1);
  const a2 = activeOf(p2);
  const teamHp = (side: SimSide): number =>
    side.pokemon.reduce((sum, p) => sum + (p.fainted ? 0 : fraction(p.hp, p.maxhp)), 0);
  const crippled = (mon: SimPokemon | null): number => (mon && MAJOR_STATUSES.has(mon.status) ? 1 : 0);
  const teraUsed = (side: SimSide): number => (side.pokemon.some((p) => Boolean(p.terastallized)) ? 1 : 0);
  const s1 = speedOf(a1);
  const s2 = speedOf(a2);

  return [
    alive(p1) - alive(p2),
    teamHp(p1) - teamHp(p2),
    (a1 ? fraction(a1.hp, a1.maxhp) : 0) - (a2 ? fraction(a2.hp, a2.maxhp) : 0),
    crippled(a2) - crippled(a1),
    teraUsed(p1) - teraUsed(p2),
    attackBoost(a1) - attackBoost(a2),
    defenseBoost(a1) - defenseBoost(a2),
    boost(a1, 'spe') - boost(a2, 'spe'),
    hazardLoad(p2) - hazardLoad(p1),
    s1 === s2 || s1 === 0 || s2 === 0 ? 0 : s1 > s2 ? 1 : -1,
    offense(battle, a1, a2) - offense(battle, a2, a1),
  ];
}
