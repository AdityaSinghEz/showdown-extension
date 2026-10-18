/**
 * Protocol fixtures shared by the turn-recording tests.
 *
 * The message shapes follow the Showdown protocol (PROTOCOL.md in the
 * smogon/pokemon-showdown repository).
 */

export const ROOM = 'battle-gen9randombattle-777';

/** Builds a room-addressed server message from protocol lines. */
export function message(...lines: string[]): string {
  return [`>${ROOM}`, ...lines].join('\n');
}

/** A short battle: leads, three turns, a faint, a replacement, and a win. */
export const SAMPLE_BATTLE: string = message(
  '|player|p1|Alice|1|1500',
  '|player|p2|Bob|2|1480',
  '|teamsize|p1|6',
  '|teamsize|p2|6',
  '|start',
  '|switch|p1a: Zoroark|Zoroark, L82, M|100/100',
  '|switch|p2a: Hydrapple|Hydrapple, L84, F|100/100',
  '|turn|1',
  '|move|p1a: Zoroark|Dark Pulse|p2a: Hydrapple',
  '|-damage|p2a: Hydrapple|65/100',
  '|move|p2a: Hydrapple|Earth Power|p1a: Zoroark',
  '|-supereffective|p1a: Zoroark',
  '|-crit|p1a: Zoroark',
  '|-damage|p1a: Zoroark|150/310',
  '|upkeep',
  '|turn|2',
  '|switch|p1a: Gengar|Gengar, L85, M|100/100',
  '|-terastallize|p2a: Hydrapple|Dragon',
  '|move|p2a: Hydrapple|Draco Meteor|p1a: Gengar',
  '|-miss|p2a: Hydrapple|p1a: Gengar',
  '|upkeep',
  '|turn|3',
  '|move|p1a: Gengar|Shadow Ball|p2a: Hydrapple',
  '|-damage|p2a: Hydrapple|0 fnt',
  '|faint|p2a: Hydrapple',
  '|upkeep',
  '|switch|p2a: Kingambit|Kingambit, L80, M|100/100',
  '|turn|4',
  '|cant|p2a: Kingambit|par',
  '|move|p1a: Gengar|Shadow Ball|p2a: Kingambit',
  '|-damage|p2a: Kingambit|40/100',
  '|upkeep',
  '|win|Alice',
);
