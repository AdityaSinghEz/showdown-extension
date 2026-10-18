/**
 * Human-readable summaries of recorded battles.
 *
 * Used for console output during development and for verifying that the turn
 * recorder matches what actually happened in a game.
 */

import type { ActionRecord, BattleState, PlayerSlot } from './types';

/** One row of the decision table. */
export interface DecisionRow {
  /** Turn number; `0` lists the leads. */
  turn: number;
  p1: string;
  p2: string;
}

/**
 * Describes a single action as short text.
 *
 * @param action - The action to describe.
 */
export function describeAction(action: ActionRecord): string {
  switch (action.kind) {
    case 'move':
      return action.tera
        ? `${action.move ?? '?'} (Tera ${action.tera})`
        : (action.move ?? '?');
    case 'switch':
      return `switch to ${action.pokemon}`;
    case 'replacement':
      return `send out ${action.pokemon}`;
    case 'drag':
      return `dragged in ${action.pokemon}`;
  }
}

function describeSide(state: Readonly<BattleState>, turnIndex: number, side: PlayerSlot): string {
  const turn = state.turns[turnIndex];
  if (!turn) return '-';
  const parts = turn.actions
    .filter((action) => action.side === side && action.viaEffect === null)
    .filter((action) => action.kind !== 'drag')
    .map((action) => `${action.pokemon}: ${describeAction(action)}`);
  return parts.length > 0 ? parts.join('; ') : '-';
}

/**
 * Builds a turn-by-turn table of the decisions each player made.
 *
 * Only player-chosen actions appear: moves forced by an effect (a locked-in
 * move, a Dancer copy) and drags are excluded.
 *
 * @param state - The battle to summarize.
 */
export function decisionTable(state: Readonly<BattleState>): DecisionRow[] {
  return state.turns.map((turn, index) => ({
    turn: turn.turn,
    p1: describeSide(state, index, 'p1'),
    p2: describeSide(state, index, 'p2'),
  }));
}
