/**
 * A simple rule-based player, used to generate practice games.
 *
 * It is deliberately modest: it prefers moves that hit hard against the
 * opponent's current Pokemon, heals when low, sometimes sets up, and switches
 * when badly out-matched. Choices are sampled from a softmax with some pure
 * randomness mixed in, so games vary. It looks at the real battle state, which
 * is fine for producing practice games and would not be for a live assistant.
 */

import { offense } from './features';
import { legalOptions, type ChoiceOption } from './engine';
import type { SimBattle, SimPokemon, SimRequest, SimSide } from './sim';

/** A source of numbers in [0, 1). */
export type Random = () => number;

/** A small seeded generator (mulberry32), so a run can be repeated exactly. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tuning for the rule-based player. */
export interface PolicyOptions {
  /** Chance of ignoring the scores and picking any legal option. */
  epsilon: number;
  /** Softmax temperature; lower means more deterministic. */
  temperature: number;
}

export const DEFAULT_POLICY: PolicyOptions = { epsilon: 0.1, temperature: 0.4 };

function hpFraction(mon: SimPokemon): number {
  return mon.maxhp > 0 ? mon.hp / mon.maxhp : 0;
}

/** How good a Pokemon's position is against another: its damage minus the damage it takes. */
function matchup(battle: SimBattle, mine: SimPokemon, theirs: SimPokemon | null): number {
  if (!theirs) return 0;
  return offense(battle, mine, theirs) - offense(battle, theirs, mine);
}

function sample(scores: readonly number[], temperature: number, random: Random): number {
  const max = Math.max(...scores);
  const weights = scores.map((s) => Math.exp((s - max) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let draw = random() * total;
  for (let i = 0; i < weights.length; i++) {
    draw -= weights[i] as number;
    if (draw <= 0) return i;
  }
  return weights.length - 1;
}

function benchOptions(request: SimRequest): ChoiceOption[] {
  return request.side.pokemon.flatMap((mon, index) =>
    mon.active || mon.condition.endsWith(' fnt')
      ? []
      : [{ choice: `switch ${index + 1}`, kind: 'switch' as const, label: mon.details, id: '', slot: index + 1, tera: false }],
  );
}

/**
 * Rough quality score for each legal option, higher is better.
 *
 * The practice player samples from these scores, and the review uses them to
 * decide which options are worth simulating.
 *
 * @param random - Adds the practice player's random Tera appetite; omit for a fixed ranking.
 */
export function scoreOptions(
  battle: SimBattle,
  sideIndex: 0 | 1,
  legal: readonly ChoiceOption[],
  random: Random | null = null,
): number[] {
  const side = battle.sides[sideIndex] as SimSide;
  const foe = battle.sides[1 - sideIndex] as SimSide;
  const foeActive = foe.active[0] && !foe.active[0].fainted ? foe.active[0] : null;
  const mine = side.active[0];
  const currentMatchup = mine ? matchup(battle, mine, foeActive) : 0;
  const lowHp = mine ? hpFraction(mine) < 0.5 : false;
  return legal.map((option) => {
    if (option.kind === 'switch') {
      const target = side.pokemon[option.slot - 1] as SimPokemon;
      return matchup(battle, target, foeActive) - currentMatchup - 0.4;
    }
    const move = battle.dex?.moves.get(option.id);
    if (!move || !mine) return 0;
    let score = 0;
    if (move.category !== 'Status') {
      score = offense(battle, { ...mine, moveSlots: [{ id: option.id }] } as SimPokemon, foeActive);
    } else {
      score = 0.25;
      if (move.heal) score += lowHp ? 1.2 : -0.2;
      if (move.boosts && move.target === 'self') score += hpFraction(mine) > 0.7 && battle.turn < 12 ? 0.6 : -0.1;
      if (move.sideCondition) score += battle.turn < 8 ? 0.5 : 0;
    }
    // Terastallizing is allowed but only favoured for a strong attack.
    if (option.tera) score = score * 1.1 - 0.3 + (random !== null && random() < 0.3 ? 0.5 : 0);
    return score;
  });
}

/**
 * Picks a choice for one side.
 *
 * @param battle - The battle in progress.
 * @param sideIndex - 0 for player 1, 1 for player 2.
 * @param random - Source of randomness.
 * @param options - Tuning.
 * @returns The choice text, or `null` if the side has nothing to decide right now.
 */
export function chooseAction(
  battle: SimBattle,
  sideIndex: 0 | 1,
  random: Random,
  options: PolicyOptions = DEFAULT_POLICY,
): string | null {
  const side = battle.sides[sideIndex] as SimSide;
  const foe = battle.sides[1 - sideIndex] as SimSide;
  const request = side.activeRequest;
  if (!request || request.wait) return null;

  const foeActive = foe.active[0] && !foe.active[0].fainted ? foe.active[0] : null;
  const mine = side.active[0];

  // A forced replacement after a faint: send in the best match-up.
  if (request.forceSwitch) {
    const candidates = benchOptions(request);
    if (candidates.length === 0) return null;
    const scores = candidates.map((c) => matchup(battle, side.pokemon[c.slot - 1] as SimPokemon, foeActive) + hpFraction(side.pokemon[c.slot - 1] as SimPokemon));
    if (random() < options.epsilon) return (candidates[Math.floor(random() * candidates.length)] as ChoiceOption).choice;
    return (candidates[sample(scores, options.temperature, random)] as ChoiceOption).choice;
  }

  const legal = legalOptions(request, true);
  if (legal.length === 0) return null;
  if (random() < options.epsilon) return (legal[Math.floor(random() * legal.length)] as ChoiceOption).choice;

  const scores = scoreOptions(battle, sideIndex, legal, random);
  return (legal[sample(scores, options.temperature, random)] as ChoiceOption).choice;
}
