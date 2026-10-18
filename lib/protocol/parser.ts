/**
 * Parser for the Pokemon Showdown client/server text protocol.
 *
 * A server message is a block of newline-separated lines. When the block is
 * addressed to a specific room, the first line is `>ROOMID`. Every following
 * protocol line has the shape `|COMMAND|ARG1|ARG2|...`.
 *
 * Example:
 *
 * ```
 * >battle-gen9randombattle-123456
 * |player|p1|Alice|1|1500
 * |turn|1
 * ```
 *
 * Reference: PROTOCOL.md in the smogon/pokemon-showdown repository.
 */

/** A single parsed protocol line. */
export interface ProtocolEvent {
  /** The command name, e.g. `player`, `turn`, `win`. */
  command: string;
  /** Pipe-separated arguments following the command. */
  args: string[];
  /** The original, unparsed line. */
  raw: string;
}

/** A block of events addressed to one room. */
export interface RoomMessage {
  /** Room identifier; `lobby` when the block carries no room header. */
  roomId: string;
  events: ProtocolEvent[];
}

/** Metadata encoded in a battle room identifier. */
export interface BattleRoomInfo {
  /** Battle format id, e.g. `gen9randombattle`. */
  format: string;
  /** Numeric battle id. */
  battleId: string;
}

const BATTLE_ROOM_PATTERN = /^battle-(.+?)-(\d+)(?:-.*)?$/;

/**
 * Parses a raw server message into room-addressed protocol events.
 *
 * Lines that are not protocol lines (those not starting with `|`) are ignored.
 *
 * @param raw - The raw message string as received from the server.
 */
export function parseMessage(raw: string): RoomMessage {
  const lines = raw.split('\n');
  let roomId = 'lobby';

  const first = lines[0];
  if (first !== undefined && first.startsWith('>')) {
    roomId = first.slice(1).trim();
    lines.shift();
  }

  const events: ProtocolEvent[] = [];
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|');
    const command = parts[1];
    if (command === undefined || command === '') continue;
    events.push({ command, args: parts.slice(2), raw: line });
  }

  return { roomId, events };
}

/**
 * Extracts the format and battle id from a battle room identifier.
 *
 * @param roomId - A room id such as `battle-gen9randombattle-123456`.
 * @returns The parsed info, or `null` if the id is not a battle room.
 */
export function parseBattleRoomId(roomId: string): BattleRoomInfo | null {
  const match = BATTLE_ROOM_PATTERN.exec(roomId);
  if (!match) return null;
  const [, format, battleId] = match;
  if (format === undefined || battleId === undefined) return null;
  return { format, battleId };
}
