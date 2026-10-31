/**
 * Scoring a simulated position with the win-probability model.
 */

import type { ActivePokemon, SideSnapshot } from '../battle/types';
import { snapshotFeatures } from '../model/features';
import { predictProbability, type LogisticModel } from '../model/logistic';
import type { SimBattle, SimSide } from './sim';

function fraction(hp: number, maxhp: number): number {
  return maxhp > 0 ? Math.max(0, Math.min(1, hp / maxhp)) : 0;
}

/**
 * Summarizes one simulated side the way the recorder summarizes a real one.
 *
 * Unlike a spectator log, the simulator knows every Pokemon's real HP, so
 * nothing is assumed about unrevealed team members.
 */
export function sideSnapshot(side: SimSide): SideSnapshot {
  const alive = side.pokemon.filter((p) => !p.fainted && p.hp > 0);
  const act = side.active[0];
  const active: ActivePokemon | null = act
    ? {
        nickname: act.name ?? '',
        species: act.speciesName ?? act.name ?? '',
        hp: act.fainted ? 0 : fraction(act.hp, act.maxhp),
        status: act.status ? act.status : null,
        tera: act.terastallized ? act.terastallized : null,
      }
    : null;
  return {
    active,
    remaining: alive.length,
    teamHp: side.pokemon.reduce((sum, p) => sum + (p.fainted ? 0 : fraction(p.hp, p.maxhp)), 0),
    teraUsed: side.pokemon.some((p) => Boolean(p.terastallized)),
  };
}

/**
 * Probability that player 1 wins from the current position of a simulated battle.
 *
 * A side with no Pokemon left has lost; if both are out it is a draw.
 *
 * @param battle - The simulated battle.
 * @param model - The fitted win-probability model.
 */
export function winProbability(battle: SimBattle, model: LogisticModel): number {
  const p1 = sideSnapshot(battle.sides[0] as SimSide);
  const p2 = sideSnapshot(battle.sides[1] as SimSide);
  if ((p1.remaining ?? 0) <= 0 && (p2.remaining ?? 0) <= 0) return 0.5;
  if ((p1.remaining ?? 0) <= 0) return 0;
  if ((p2.remaining ?? 0) <= 0) return 1;
  const features = snapshotFeatures(p1, p2);
  return features === null ? 0.5 : predictProbability(model, features);
}
