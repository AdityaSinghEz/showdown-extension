/**
 * What each player has seen of the other side, read from the battle's public log.
 *
 * Showdown shows a player the opponent's Pokemon as they appear, the moves they use, and an
 * ability or item only when it does something visible (Intimidate, Leftovers healing, a
 * knocked-off item). A Tera type is shown when it is used. This module collects exactly that, so
 * grading can be done from the player's point of view.
 */

import { toId } from './opponent-sets';

/** What one side has seen of one opposing Pokemon. */
export interface SeenPokemon {
  /** Moves the Pokemon has used, as lower-case ids, in order. */
  moves: string[];
  /** The ability if it was shown, else `null`. */
  ability: string | null;
  /** The item if it was shown, else `null`. */
  item: string | null;
  /** The Tera type once it has Terastallized, else `null`. */
  teraType: string | null;
}

/** For each side, the Pokemon that have appeared so far, by species id. */
export type Reveals = { p1: Map<string, SeenPokemon>; p2: Map<string, SeenPokemon> };

/** Moves that do not say anything about the set. */
const IGNORED_MOVES = new Set(['struggle', 'recharge']);

function blank(): SeenPokemon {
  return { moves: [], ability: null, item: null, teraType: null };
}

/** `p2a: Nickname` to `["p2", "Nickname"]`. */
function parseIdent(text: string | undefined): { side: 'p1' | 'p2'; name: string } | null {
  const match = /^(p[12])[a-c]?: (.+)$/.exec(text ?? '');
  return match ? { side: match[1] as 'p1' | 'p2', name: match[2] as string } : null;
}

/** The part of a `Species, L82, M` details field that names the species. */
function speciesFromDetails(details: string | undefined): string | null {
  const name = (details ?? '').split(',')[0]?.trim();
  return name ? toId(name) : null;
}

/** Tag values like `[from] item: Leftovers` and `[of] p2a: Name`, keyed by tag. */
function tags(parts: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of parts) {
    const match = /^\[(\w+)\]\s*(.*)$/.exec(part);
    if (match) out.set(match[1] as string, (match[2] as string).trim());
  }
  return out;
}

/**
 * Reads the log and returns what each side has seen of the other.
 *
 * Lines that Showdown writes only for one player (marked by a `|split|` line) are skipped, so
 * only public information is used.
 */
export function collectReveals(log: readonly string[]): Reveals {
  const reveals: Reveals = { p1: new Map(), p2: new Map() };
  /** Nickname to species id, per side. */
  const names: Record<'p1' | 'p2', Map<string, string>> = { p1: new Map(), p2: new Map() };

  const seen = (side: 'p1' | 'p2', name: string): SeenPokemon | null => {
    const species = names[side].get(name);
    if (species === undefined) return null;
    const entry = reveals[side].get(species) ?? blank();
    reveals[side].set(species, entry);
    return entry;
  };

  for (let i = 0; i < log.length; i++) {
    let line = log[i] ?? '';
    if (line.startsWith('|split|')) {
      // The next line is the secret version and the one after it the public version.
      line = log[i + 2] ?? '';
      i += 2;
    }
    const parts = line.split('|');
    const kind = parts[1];
    if (kind === 'switch' || kind === 'drag') {
      const who = parseIdent(parts[2]);
      const species = speciesFromDetails(parts[3]);
      if (who && species) {
        names[who.side].set(who.name, species);
        if (!reveals[who.side].has(species)) reveals[who.side].set(species, blank());
      }
      continue;
    }
    if (kind === 'detailschange' || kind === '-formechange') continue;
    const who = parseIdent(parts[2]);
    if (!who) continue;
    const mon = seen(who.side, who.name);
    if (!mon) continue;
    const extra = tags(parts.slice(3));

    if (kind === 'move') {
      const move = toId(parts[3] ?? '');
      const from = extra.get('from');
      // A move called by another move (Sleep Talk, Copycat) says nothing about the set.
      if (move && !IGNORED_MOVES.has(move) && (from === undefined || toId(from) === 'lockedmove') && !mon.moves.includes(move)) mon.moves.push(move);
    } else if (kind === '-terastallize') {
      mon.teraType = toId(parts[3] ?? '') || null;
    } else if (kind === '-ability') {
      const ability = toId(parts[3] ?? '');
      if (ability) mon.ability = ability;
    } else if (kind === '-item' || kind === '-enditem') {
      // An item given by Trick or knocked off is shown on the Pokemon that holds it.
      const item = toId(parts[3] ?? '');
      if (item) mon.item = item;
    }

    // An ability or item shown as the cause of another line, for example healing from Leftovers.
    const from = extra.get('from');
    if (from !== undefined) {
      const holder = extra.get('of') !== undefined ? parseIdent(extra.get('of')) : who;
      const target = holder ? seen(holder.side, holder.name) : null;
      const itemMatch = /^item:\s*(.+)$/.exec(from);
      const abilityMatch = /^ability:\s*(.+)$/.exec(from);
      if (target && itemMatch) target.item = toId(itemMatch[1] as string);
      if (target && abilityMatch) target.ability = toId(abilityMatch[1] as string);
    }
  }
  return reveals;
}
