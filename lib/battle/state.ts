/**
 * In-memory battle state derived from protocol events.
 *
 * {@link BattleTracker} is a pure reducer over parsed protocol events. It has
 * no dependency on the browser, which keeps it unit-testable and reusable for
 * offline replay analysis. Turn-level recording lives in `./turns`.
 */

import { parseBattleRoomId, parseMessage, type ProtocolEvent } from '../protocol/parser';
import { createSideState, createTurnRecord, recordEvent } from './turns';
import type { BattleState, PlayerSlot, RatingUpdate } from './types';

export type {
  ActionKind,
  ActionRecord,
  ActivePokemon,
  BattleState,
  DamageRecord,
  FaintRecord,
  LuckKind,
  LuckRecord,
  PlayerInfo,
  PlayerSlot,
  RatingUpdate,
  SideSnapshot,
  SideState,
  TurnRecord,
} from './types';

/** Callback invoked once when a battle ends. */
export type BattleEndListener = (state: Readonly<BattleState>) => void;

const RATING_LINE_PATTERN =
  /^(.+?)'s rating:\s*(\d+)\s*(?:&rarr;|→|->)\s*(?:<strong>)?(\d+)/;

function isPlayerSlot(value: string | undefined): value is PlayerSlot {
  return value === 'p1' || value === 'p2';
}

function parseRating(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Creates a fresh state for a battle room. */
function createBattleState(roomId: string, format: string): BattleState {
  return {
    roomId,
    format,
    players: {},
    turn: 0,
    winner: null,
    ended: false,
    ratingUpdates: [],
    sides: { p1: createSideState(), p2: createSideState() },
    turns: [createTurnRecord(0)],
  };
}

/**
 * Tracks the state of every battle room the client receives messages for.
 */
export class BattleTracker {
  private readonly battles = new Map<string, BattleState>();
  private readonly endListeners: BattleEndListener[] = [];

  /**
   * Registers a listener fired the first time each battle ends.
   *
   * @param listener - Called with a read-only snapshot of the final state.
   */
  onBattleEnd(listener: BattleEndListener): void {
    this.endListeners.push(listener);
  }

  /**
   * Feeds a raw server message into the tracker.
   *
   * Messages addressed to non-battle rooms are ignored. An `init` event means
   * the server is replaying the room's full log (for example after rejoining),
   * so the room's state is reset to avoid recording the same turns twice.
   *
   * @param raw - The raw message string as received from the server.
   */
  ingest(raw: string): void {
    const { roomId, events } = parseMessage(raw);
    const info = parseBattleRoomId(roomId);
    if (!info) return;

    let state = this.getOrCreate(roomId, info.format);
    for (const event of events) {
      if (event.command === 'init') {
        state = createBattleState(roomId, info.format);
        this.battles.set(roomId, state);
        continue;
      }
      recordEvent(state, event);
      this.apply(state, event);
    }
  }

  /** Returns the current state of a battle, if it has been seen. */
  get(roomId: string): Readonly<BattleState> | undefined {
    return this.battles.get(roomId);
  }

  /** Returns all tracked battles. */
  all(): ReadonlyArray<Readonly<BattleState>> {
    return [...this.battles.values()];
  }

  private getOrCreate(roomId: string, format: string): BattleState {
    let state = this.battles.get(roomId);
    if (!state) {
      state = createBattleState(roomId, format);
      this.battles.set(roomId, state);
    }
    return state;
  }

  private apply(state: BattleState, event: ProtocolEvent): void {
    switch (event.command) {
      case 'player': {
        const [slot, name, , rating] = event.args;
        // An empty name means the player left the slot; nothing to record.
        if (isPlayerSlot(slot) && name) {
          const previous = state.players[slot];
          const announced = parseRating(rating);
          // The server re-announces a player on reconnect, usually without a
          // rating. Keep the rating already known for that same player.
          const known = previous?.name === name ? previous.rating : null;
          state.players[slot] = { slot, name, rating: announced ?? known };
        }
        break;
      }
      case 'turn': {
        const turn = Number(event.args[0]);
        if (Number.isInteger(turn)) state.turn = turn;
        break;
      }
      case 'win': {
        state.winner = event.args[0] ?? null;
        this.finish(state);
        break;
      }
      case 'tie': {
        state.winner = null;
        this.finish(state);
        break;
      }
      case 'raw': {
        const update = parseRatingUpdate(event.args.join('|'));
        if (update) state.ratingUpdates.push(update);
        break;
      }
      default:
        break;
    }
  }

  private finish(state: BattleState): void {
    if (state.ended) return;
    state.ended = true;
    for (const listener of this.endListeners) listener(state);
  }
}

/**
 * Parses the end-of-battle rating line the server emits as a `|raw|` event.
 *
 * Expected shape (HTML-escaped arrow, bold new rating):
 * `Name's rating: 1500 &rarr; <strong>1520</strong><br />(+20 for winning)`
 *
 * @param text - The joined arguments of a `raw` event.
 * @returns The parsed update, or `null` if the text is not a rating line.
 */
export function parseRatingUpdate(text: string): RatingUpdate | null {
  const match = RATING_LINE_PATTERN.exec(text);
  if (!match) return null;
  const [, name, before, after] = match;
  if (name === undefined || before === undefined || after === undefined) return null;
  return { name, before: Number(before), after: Number(after) };
}
