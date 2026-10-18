import { describe, expect, it } from 'vitest';
import { parseBattleRoomId, parseMessage } from '../lib/protocol/parser';

describe('parseMessage', () => {
  it('extracts the room id and events from a room-addressed block', () => {
    const result = parseMessage(
      '>battle-gen9randombattle-123456\n|player|p1|Alice|1|1500\n|turn|1',
    );
    expect(result.roomId).toBe('battle-gen9randombattle-123456');
    expect(result.events.map((e) => e.command)).toEqual(['player', 'turn']);
    expect(result.events[0]?.args).toEqual(['p1', 'Alice', '1', '1500']);
  });

  it('defaults to the lobby when there is no room header', () => {
    const result = parseMessage('|updateuser| Alice|1|1');
    expect(result.roomId).toBe('lobby');
    expect(result.events).toHaveLength(1);
  });

  it('ignores lines that are not protocol lines', () => {
    const result = parseMessage('>room\nplain text\n|turn|2\n\n');
    expect(result.events).toHaveLength(1);
  });

  it('preserves empty arguments', () => {
    const result = parseMessage('>room\n|player|p2|Bob||');
    expect(result.events[0]?.args).toEqual(['p2', 'Bob', '', '']);
  });
});

describe('parseBattleRoomId', () => {
  it('parses format and battle id', () => {
    expect(parseBattleRoomId('battle-gen9randombattle-123456')).toEqual({
      format: 'gen9randombattle',
      battleId: '123456',
    });
  });

  it('accepts private-battle suffixes', () => {
    expect(parseBattleRoomId('battle-gen9randombattle-123456-abcdef')).toEqual({
      format: 'gen9randombattle',
      battleId: '123456',
    });
  });

  it('returns null for non-battle rooms', () => {
    expect(parseBattleRoomId('lobby')).toBeNull();
    expect(parseBattleRoomId('battle-nonumber')).toBeNull();
  });
});
