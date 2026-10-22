/**
 * Per-turn recorder.
 *
 * Folds protocol events into the {@link TurnRecord} list on a
 * {@link BattleState}: which actions each player took, how HP changed, who
 * fainted, and which chance events occurred.
 *
 * Scope: singles battles. Events addressed to any position other than `a`
 * (for example `p1b` in doubles) are ignored.
 */

import type { ProtocolEvent } from '../protocol/parser';
import type {
  BattleState,
  PlayerSlot,
  SideSnapshot,
  SideState,
  TurnRecord,
} from './types';

/** A parsed Pokemon identifier such as `p1a: Zoroark`. */
export interface PokemonId {
  side: PlayerSlot;
  /** Position letter (`a` in singles), or `null` for bench references. */
  position: string | null;
  /** Nickname as shown by the protocol. */
  name: string;
}

/** A parsed HP field such as `65/100 par` or `0 fnt`. */
export interface HpInfo {
  /** HP as a fraction from 0 to 1, or `null` if it cannot be derived. */
  fraction: number | null;
  /** Major status condition, or `null`. */
  status: string | null;
  fainted: boolean;
}

const POKEMON_ID_PATTERN = /^(p[12])([a-z])?:\s*(.+)$/;
const HP_PATTERN = /^(\d+)(?:\/(\d+))?(?:\s+(\S+))?$/;
const FROM_PATTERN = /^\[from\]\s*(.+)$/;

/**
 * Parses a protocol Pokemon identifier.
 *
 * @param text - For example `p2a: Hydrapple`.
 * @returns The parsed identifier, or `null` if the text is not one.
 */
export function parsePokemonId(text: string | undefined): PokemonId | null {
  if (text === undefined) return null;
  const match = POKEMON_ID_PATTERN.exec(text);
  if (!match) return null;
  const [, side, position, name] = match;
  if ((side !== 'p1' && side !== 'p2') || name === undefined) return null;
  return { side, position: position ?? null, name };
}

/**
 * Parses a protocol HP field.
 *
 * The opponent's HP is reported as a percentage (`65/100`); your own is
 * reported in real points (`240/310`). Both yield the same fraction.
 *
 * @param text - For example `100/100`, `65/100 par` or `0 fnt`.
 * @returns The parsed value, or `null` if the text is not an HP field.
 */
export function parseHp(text: string | undefined): HpInfo | null {
  if (text === undefined) return null;
  const match = HP_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, currentText, maxText, flag] = match;
  if (currentText === undefined) return null;

  const current = Number(currentText);
  const max = maxText === undefined ? null : Number(maxText);
  const fainted = flag === 'fnt' || current === 0;
  const fraction = max !== null && max > 0 ? current / max : fainted ? 0 : null;
  const status = flag !== undefined && flag !== 'fnt' ? flag : null;
  return { fraction, status, fainted };
}

/**
 * Extracts the species from a protocol details string.
 *
 * @param details - For example `Zoroark-Hisui, L82, M`.
 * @returns The species name, or `null` if absent.
 */
export function speciesFromDetails(details: string | undefined): string | null {
  const species = details?.split(',')[0]?.trim();
  return species ? species : null;
}

/** Returns the `[from]` effect named in an event's arguments, if any. */
function fromEffect(args: readonly string[]): string | null {
  for (const arg of args) {
    const match = FROM_PATTERN.exec(arg);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Creates an empty record for one turn. */
export function createTurnRecord(turn: number): TurnRecord {
  return { turn, actions: [], damage: [], faints: [], luck: [], endState: null, log: [] };
}

/** Creates the initial tracking state for one side. */
export function createSideState(): SideState {
  return {
    teamSize: null,
    fainted: 0,
    active: null,
    pendingReplacement: false,
    pendingTera: null,
    roster: {},
    teraUsed: false,
  };
}

function currentTurn(state: BattleState): TurnRecord {
  let turn = state.turns[state.turns.length - 1];
  if (!turn) {
    turn = createTurnRecord(0);
    state.turns.push(turn);
  }
  return turn;
}

/**
 * Sums team HP as fractions: revealed Pokemon at their last known HP, and
 * every unrevealed Pokemon at full health.
 */
function teamHp(side: SideState): number | null {
  if (side.teamSize === null) return null;
  const revealed = Object.values(side.roster);
  const known = revealed.reduce((sum, hp) => sum + hp, 0);
  return known + Math.max(0, side.teamSize - revealed.length);
}

function snapshot(side: SideState): SideSnapshot {
  return {
    active: side.active ? { ...side.active } : null,
    remaining: side.teamSize === null ? null : side.teamSize - side.fainted,
    teamHp: teamHp(side),
    teraUsed: side.teraUsed,
  };
}

function closeTurn(state: BattleState): void {
  currentTurn(state).endState = {
    p1: snapshot(state.sides.p1),
    p2: snapshot(state.sides.p2),
  };
}

/** True when the identifier refers to the single active slot. */
function isActiveSlot(id: PokemonId | null): id is PokemonId {
  return id !== null && id.position === 'a';
}

/** Resolves a nickname to a species using the side's active Pokemon. */
function speciesOf(state: BattleState, id: PokemonId): string {
  const active = state.sides[id.side].active;
  return active && active.nickname === id.name ? active.species : id.name;
}

function applyHp(state: BattleState, id: PokemonId, hp: ReturnType<typeof parseHp>): void {
  const side = state.sides[id.side];
  const active = side.active;
  if (!active || !hp) return;
  active.hp = hp.fraction;
  active.status = hp.status;
  if (hp.fraction !== null) side.roster[active.nickname] = hp.fraction;
}

/**
 * Applies one protocol event to the battle's turn records and side state.
 *
 * Every event is appended to the open turn's raw log. A `turn` event closes
 * the previous turn (capturing its end state) and opens the next; `win` and
 * `tie` close the final turn.
 *
 * @param state - The battle being updated; mutated in place.
 * @param event - The parsed protocol event.
 */
export function recordEvent(state: BattleState, event: ProtocolEvent): void {
  if (event.command === 'turn') {
    closeTurn(state);
    const parsed = Number(event.args[0]);
    const previous = currentTurn(state).turn;
    state.turns.push(createTurnRecord(Number.isInteger(parsed) ? parsed : previous + 1));
  }

  const turn = currentTurn(state);
  turn.log.push(event.raw);

  switch (event.command) {
    case 'teamsize': {
      const [slot, size] = event.args;
      if (slot === 'p1' || slot === 'p2') {
        const parsed = Number(size);
        if (Number.isInteger(parsed)) state.sides[slot].teamSize = parsed;
      }
      break;
    }

    case 'switch':
    case 'drag': {
      const id = parsePokemonId(event.args[0]);
      if (!isActiveSlot(id)) break;
      const side = state.sides[id.side];
      const species = speciesFromDetails(event.args[1]) ?? id.name;
      const hp = parseHp(event.args[2]);
      const previous = side.active?.species ?? null;

      const kind =
        event.command === 'drag' ? 'drag' : side.pendingReplacement ? 'replacement' : 'switch';
      side.pendingReplacement = false;
      side.active = {
        nickname: id.name,
        species,
        hp: hp?.fraction ?? null,
        status: hp?.status ?? null,
        tera: null,
      };
      // A Pokemon returning from the bench keeps its HP unless the event says otherwise.
      side.roster[id.name] = hp?.fraction ?? side.roster[id.name] ?? 1;

      turn.actions.push({
        kind,
        side: id.side,
        pokemon: species,
        move: null,
        target: null,
        tera: null,
        switchedFrom: kind === 'switch' ? previous : null,
        viaEffect: fromEffect(event.args),
      });
      break;
    }

    case 'replace':
    case 'detailschange': {
      // Illusion reveals and permanent forme changes update the species.
      const id = parsePokemonId(event.args[0]);
      if (!isActiveSlot(id)) break;
      const active = state.sides[id.side].active;
      const species = speciesFromDetails(event.args[1]);
      if (active && species) {
        active.species = species;
        if (event.command === 'replace') {
          // An Illusion reveal renames the Pokemon; carry its HP entry across.
          const side = state.sides[id.side];
          const previousName = active.nickname;
          if (previousName !== id.name && previousName in side.roster) {
            side.roster[id.name] = side.roster[previousName] ?? 1;
            delete side.roster[previousName];
          }
          active.nickname = id.name;
        }
      }
      break;
    }

    case 'move': {
      const id = parsePokemonId(event.args[0]);
      if (!isActiveSlot(id)) break;
      const side = state.sides[id.side];
      const targetId = parsePokemonId(event.args[2]);
      const viaEffect = fromEffect(event.args);

      let tera: string | null = null;
      if (viaEffect === null) {
        tera = side.pendingTera;
        side.pendingTera = null;
      }

      turn.actions.push({
        kind: 'move',
        side: id.side,
        pokemon: speciesOf(state, id),
        move: event.args[1] ?? null,
        target: targetId ? speciesOf(state, targetId) : null,
        tera,
        switchedFrom: null,
        viaEffect,
      });
      break;
    }

    case '-terastallize': {
      const id = parsePokemonId(event.args[0]);
      if (!isActiveSlot(id)) break;
      const type = event.args[1] ?? null;
      const side = state.sides[id.side];
      side.pendingTera = type;
      side.teraUsed = true;
      if (side.active) side.active.tera = type;
      break;
    }

    case '-damage': {
      const id = parsePokemonId(event.args[0]);
      if (!isActiveSlot(id)) break;
      const hp = parseHp(event.args[1]);
      const before = state.sides[id.side].active?.hp ?? null;
      turn.damage.push({
        side: id.side,
        pokemon: speciesOf(state, id),
        before,
        after: hp?.fraction ?? null,
        source: fromEffect(event.args),
      });
      applyHp(state, id, hp);
      break;
    }

    case '-heal':
    case '-sethp': {
      const id = parsePokemonId(event.args[0]);
      if (!isActiveSlot(id)) break;
      applyHp(state, id, parseHp(event.args[1]));
      break;
    }

    case '-status': {
      const id = parsePokemonId(event.args[0]);
      if (!isActiveSlot(id)) break;
      const active = state.sides[id.side].active;
      if (active) active.status = event.args[1] ?? null;
      break;
    }

    case '-curestatus': {
      const id = parsePokemonId(event.args[0]);
      if (!isActiveSlot(id)) break;
      const active = state.sides[id.side].active;
      if (active) active.status = null;
      break;
    }

    case 'faint': {
      const id = parsePokemonId(event.args[0]);
      if (!isActiveSlot(id)) break;
      const side = state.sides[id.side];
      turn.faints.push({ side: id.side, pokemon: speciesOf(state, id) });
      side.fainted += 1;
      side.pendingReplacement = true;
      if (side.active) {
        side.active.hp = 0;
        side.roster[side.active.nickname] = 0;
      }
      break;
    }

    case '-crit': {
      const id = parsePokemonId(event.args[0]);
      if (!isActiveSlot(id)) break;
      turn.luck.push({ kind: 'crit', side: id.side, pokemon: speciesOf(state, id), detail: null });
      break;
    }

    case '-miss': {
      const id = parsePokemonId(event.args[0]);
      if (!isActiveSlot(id)) break;
      const targetId = parsePokemonId(event.args[1]);
      turn.luck.push({
        kind: 'miss',
        side: id.side,
        pokemon: speciesOf(state, id),
        detail: targetId ? speciesOf(state, targetId) : null,
      });
      break;
    }

    case 'cant': {
      const id = parsePokemonId(event.args[0]);
      if (!isActiveSlot(id)) break;
      turn.luck.push({
        kind: 'cant',
        side: id.side,
        pokemon: speciesOf(state, id),
        detail: event.args[1] ?? null,
      });
      break;
    }

    case 'win':
    case 'tie':
      closeTurn(state);
      break;

    default:
      break;
  }
}
