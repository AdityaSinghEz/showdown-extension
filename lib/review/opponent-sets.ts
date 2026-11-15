/**
 * Fills in what a player cannot see about the opponent's Pokemon.
 *
 * In random battles a Pokemon's set comes from Showdown's published role data
 * (`data/random-battles/gen9/sets.json`): each role has a movepool, a list of abilities and
 * one to three Tera types. Whatever the opponent has shown so far (moves used, an ability, a
 * Tera) must fit, and the rest is drawn from the roles that still can.
 *
 * Grading from the player's point of view uses a few such draws and averages them, instead of
 * the opponent's real set, which the player could not know.
 */

/** One role of one species in `sets.json`. */
export interface RoleData {
  role: string;
  movepool: string[];
  abilities: string[];
  teraTypes: string[];
}

/** The part of `sets.json` this module reads, keyed by species id. */
export type SetsData = Record<string, { level?: number; sets: RoleData[] }>;

/** What the player has seen of one opposing Pokemon, as lower-case ids. */
export interface Revealed {
  moves: string[];
  ability: string | null;
  /** Set once the Pokemon has Terastallized. */
  teraType: string | null;
}

/** One possible set for an opposing Pokemon, as lower-case ids. */
export interface SampledSet {
  role: string | null;
  moves: string[];
  ability: string | null;
  teraType: string | null;
}

/** Moves per set in random battles. */
export const MOVES_PER_SET = 4;

/** Showdown's id form: lower case, letters and digits only. */
export function toId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A small seeded random generator, so the same position always gets the same draws. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: readonly T[], random: () => number): T | null {
  return list.length === 0 ? null : (list[Math.floor(random() * list.length)] as T);
}

/**
 * Roles of a species that fit everything the player has seen. When none fit (the data and the
 * game come from different versions) every role counts, so a draw is still possible.
 */
export function compatibleRoles(species: string, revealed: Revealed, data: SetsData): RoleData[] {
  const roles = data[species]?.sets ?? [];
  const seen = revealed.moves.map(toId);
  const fits = roles.filter((role) => {
    const pool = new Set(role.movepool.map(toId));
    if (!seen.every((move) => pool.has(move))) return false;
    if (revealed.ability !== null && role.abilities.length > 0 && !role.abilities.map(toId).includes(revealed.ability)) return false;
    if (revealed.teraType !== null && role.teraTypes.length > 0 && !role.teraTypes.map(toId).includes(revealed.teraType)) return false;
    return true;
  });
  return fits.length > 0 ? fits : roles;
}

/**
 * Draws one possible set: a role that fits what was seen, the seen moves plus others from that
 * role's movepool up to four, the seen ability (or one the role allows) and the seen Tera type
 * (or one the role allows).
 *
 * @returns `null` when the species is not in the data; the caller then keeps what it has.
 */
export function sampleSet(species: string, revealed: Revealed, data: SetsData, random: () => number): SampledSet | null {
  const roles = compatibleRoles(species, revealed, data);
  const role = pick(roles, random);
  if (role === null) return null;
  const pool = role.movepool.map(toId);
  const moves = [...new Set(revealed.moves.map(toId))].slice(0, MOVES_PER_SET);
  const rest = pool.filter((move) => !moves.includes(move));
  while (moves.length < MOVES_PER_SET && rest.length > 0) {
    const [move] = rest.splice(Math.floor(random() * rest.length), 1);
    if (move !== undefined) moves.push(move);
  }
  return {
    role: role.role,
    moves,
    ability: revealed.ability ?? toIdOrNull(pick(role.abilities, random)),
    teraType: revealed.teraType ?? toIdOrNull(pick(role.teraTypes, random)),
  };
}

function toIdOrNull(text: string | null): string | null {
  return text === null ? null : toId(text);
}
