/**
 * Shared data model for tracked battles.
 *
 * These types describe both the battle-level summary (players, winner,
 * rating updates) and the per-turn record that later analysis stages consume.
 * They contain no logic, so any module may import them without cycles.
 */

/** Player slot identifier used by the protocol. */
export type PlayerSlot = 'p1' | 'p2';

/** Information about one participant. */
export interface PlayerInfo {
  slot: PlayerSlot;
  name: string;
  /** Rating shown in the `|player|` event, when the server provides one. */
  rating: number | null;
}

/** A rating change announced by the server at the end of a ladder battle. */
export interface RatingUpdate {
  name: string;
  before: number;
  after: number;
}

/**
 * Classification of a recorded action.
 *
 * - `move`: a move was used.
 * - `switch`: a voluntary switch (or an initial lead).
 * - `replacement`: a forced switch-in after the previous Pokemon fainted.
 * - `drag`: a switch caused by the opponent (for example Roar).
 */
export type ActionKind = 'move' | 'switch' | 'replacement' | 'drag';

/** One action taken during a turn. */
export interface ActionRecord {
  kind: ActionKind;
  side: PlayerSlot;
  /** Species performing the action; for switches, the species switched in. */
  pokemon: string;
  /** Move name for `move` actions, otherwise `null`. */
  move: string | null;
  /** Species targeted by the move, when the protocol names one. */
  target: string | null;
  /** Tera type if the Pokemon terastallized immediately before this move. */
  tera: string | null;
  /** Species that was switched out, for voluntary switches. */
  switchedFrom: string | null;
  /**
   * The effect that caused this action (the protocol's `[from]` tag), or
   * `null` when the player chose it. Actions with a non-null value, such as
   * a locked-in move or a Dancer copy, are not decisions.
   */
  viaEffect: string | null;
}

/** A change in a Pokemon's HP during a turn. */
export interface DamageRecord {
  side: PlayerSlot;
  pokemon: string;
  /** HP fraction (0 to 1) before the damage, when known. */
  before: number | null;
  /** HP fraction (0 to 1) after the damage, when known. */
  after: number | null;
  /** Damage source from the `[from]` tag, or `null` for direct move damage. */
  source: string | null;
}

/** A Pokemon fainting. */
export interface FaintRecord {
  side: PlayerSlot;
  pokemon: string;
}

/**
 * Kinds of chance events recorded so that luck can later be separated from
 * decision quality.
 *
 * - `crit`: a critical hit landed on `side`.
 * - `miss`: `side`'s move missed.
 * - `cant`: `side`'s Pokemon was unable to move (paralysis, sleep, flinch...).
 */
export type LuckKind = 'crit' | 'miss' | 'cant';

/** A chance event observed during a turn. */
export interface LuckRecord {
  kind: LuckKind;
  side: PlayerSlot;
  pokemon: string;
  /** Extra context: the target for a miss, or the reason for `cant`. */
  detail: string | null;
}

/** The Pokemon currently on the field for one side (singles). */
export interface ActivePokemon {
  nickname: string;
  species: string;
  /** HP fraction from 0 to 1, or `null` if not yet reported. */
  hp: number | null;
  status: string | null;
  /** Tera type once terastallized. */
  tera: string | null;
}

/** Live tracking state for one side of the field. */
export interface SideState {
  /** Team size announced by `|teamsize|`, or `null` if not seen. */
  teamSize: number | null;
  fainted: number;
  active: ActivePokemon | null;
  /** True between a faint and the replacement switch-in. */
  pendingReplacement: boolean;
  /** Tera type announced but not yet attached to a move. */
  pendingTera: string | null;
}

/** Frozen view of one side at the end of a turn. */
export interface SideSnapshot {
  active: ActivePokemon | null;
  /** Pokemon not yet fainted, or `null` if the team size is unknown. */
  remaining: number | null;
}

/**
 * Everything that happened between one `|turn|` marker and the next.
 *
 * Turn `0` holds the events before the first turn marker, i.e. the leads.
 */
export interface TurnRecord {
  turn: number;
  actions: ActionRecord[];
  damage: DamageRecord[];
  faints: FaintRecord[];
  luck: LuckRecord[];
  /** Board state when the turn closed; `null` while the turn is open. */
  endState: Record<PlayerSlot, SideSnapshot> | null;
  /** Raw protocol lines for this turn, kept for replay and later analysis. */
  log: string[];
}

/** Snapshot of everything currently known about one battle. */
export interface BattleState {
  roomId: string;
  format: string;
  players: Partial<Record<PlayerSlot, PlayerInfo>>;
  turn: number;
  /** Winning player's name, or `null` while in progress or after a tie. */
  winner: string | null;
  ended: boolean;
  ratingUpdates: RatingUpdate[];
  sides: Record<PlayerSlot, SideState>;
  turns: TurnRecord[];
}
