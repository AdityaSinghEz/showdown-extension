/**
 * Rollout evaluation: judging a position by playing it forward.
 *
 * The win-probability model only sees a snapshot, so it cannot tell that a
 * healthy sweeper with boosts is about to win, or that a setup move is risky.
 * A rollout plays the position forward for a few turns with the practice
 * player (`policy.ts`) on both sides, then asks the model about the position
 * it reaches. Positions that are about to be won or lost are scored by what
 * actually happens, and the model only has to judge the quiet ones.
 */

import type { LogisticModel } from '../model/logistic';
import { chooseAction, seededRandom, type PolicyOptions } from './policy';
import { winProbability } from './position';
import type { SimBattle, SimModule } from './sim';

/** Settings for {@link rolloutValue}. */
export interface RolloutOptions {
  /** How many forward games to average. */
  rollouts: number;
  /** Turns to play forward before handing the position to the model. */
  depth: number;
  /** Seed so a review can be repeated exactly. */
  seed: number;
  /**
   * Share of the answer that comes from the rollouts; the rest is the model's
   * reading of the starting position. 1 trusts rollouts fully, 0 ignores them.
   * Blending guards against the practice player misplaying a position.
   */
  weight?: number;
  /** How the practice player chooses; defaults to a fairly sharp one. */
  policy?: PolicyOptions;
}

/** A sharper practice player than the one used for training data, so rollouts follow sensible play. */
export const ROLLOUT_POLICY: PolicyOptions = { epsilon: 0.03, temperature: 0.25 };

/** Largest number of simulator steps in one rollout, as a safety cap. */
const MAX_STEPS = 40;

/**
 * Win probability for player 1, averaged over several forward games.
 *
 * @param sim - The simulator build, used to restore copies of the position.
 * @param battle - The position to judge, after both players have chosen.
 * @param model - The win-probability model used at the end of each rollout.
 * @param options - Rollout settings.
 */
export function rolloutValue(
  sim: SimModule,
  battle: SimBattle,
  model: LogisticModel,
  options: RolloutOptions,
): number {
  if (battle.ended || options.depth <= 0 || options.rollouts <= 0) return winProbability(battle, model);
  const snapshot = JSON.stringify(battle.toJSON());
  const policy = options.policy ?? ROLLOUT_POLICY;
  let total = 0;
  let done = 0;
  for (let r = 0; r < options.rollouts; r++) {
    try {
      const copy = sim.Battle.fromJSON(JSON.parse(snapshot));
      copy.prng = new sim.PRNG([options.seed + r, 5, 11, 23]);
      const random = seededRandom(options.seed * 1000 + r);
      let turns = 0;
      for (let step = 0; step < MAX_STEPS && !copy.ended && turns < options.depth; step++) {
        const c1 = chooseAction(copy, 0, random, policy);
        const c2 = chooseAction(copy, 1, random, policy);
        if (c1 === null && c2 === null) break;
        const before = copy.turn;
        if (c1 !== null) copy.choose('p1', c1);
        if (c2 !== null) copy.choose('p2', c2);
        if (copy.turn !== before) turns += 1;
      }
      total += winProbability(copy, model);
      done += 1;
    } catch {
      // A rollout the simulator rejects is dropped rather than guessed at.
    }
  }
  const start = winProbability(battle, model);
  if (done === 0) return start;
  const weight = options.weight ?? 1;
  return weight * (total / done) + (1 - weight) * start;
}

