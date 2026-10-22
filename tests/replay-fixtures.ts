/**
 * Replay fixtures in the shape served by `replay.pokemonshowdown.com`.
 *
 * The header lines and rating lines follow a real Gen 9 Random Battle replay;
 * the battle body is a short hand-written game.
 */

import type { ReplayJson } from '../lib/replay/types';

/** Builds a replay log from a body of battle lines. */
export function makeLog(options: {
  p1: string;
  p2: string;
  r1: number | null;
  r2: number | null;
  body: string[];
}): string {
  const { p1, p2, r1, r2, body } = options;
  return [
    `|j|☆${p1}`,
    `|j|☆${p2}`,
    '|t:|1792491223',
    '|gametype|singles',
    `|player|p1|${p1}|102|${r1 ?? ''}`,
    `|player|p2|${p2}|lance-gen1rb|${r2 ?? ''}`,
    '|gen|9',
    '|tier|[Gen 9] Random Battle',
    '|rated|',
    '|teamsize|p1|6',
    '|teamsize|p2|6',
    '|start',
    ...body,
  ].join('\n');
}

const PLAYED_BODY = [
  '|switch|p1a: Zoroark|Zoroark, L82, M|100/100',
  '|switch|p2a: Hydrapple|Hydrapple, L84, F|100/100',
  '|turn|1',
  '|move|p1a: Zoroark|Dark Pulse|p2a: Hydrapple',
  '|-damage|p2a: Hydrapple|60/100',
  '|move|p2a: Hydrapple|Earth Power|p1a: Zoroark',
  '|-damage|p1a: Zoroark|120/310',
  '|turn|2',
  '|move|p1a: Zoroark|Dark Pulse|p2a: Hydrapple',
  '|-damage|p2a: Hydrapple|20/100',
  '|move|p2a: Hydrapple|Earth Power|p1a: Zoroark',
  '|-damage|p1a: Zoroark|0 fnt',
  '|faint|p1a: Zoroark',
  '|turn|3',
  '|switch|p1a: Gengar|Gengar, L85, M|100/100',
  '|move|p2a: Hydrapple|Earth Power|p1a: Gengar',
  '|-immune|p1a: Gengar',
  '|turn|4',
  '|move|p1a: Gengar|Shadow Ball|p2a: Hydrapple',
  '|-damage|p2a: Hydrapple|0 fnt',
  '|faint|p2a: Hydrapple',
  '|switch|p2a: Kingambit|Kingambit, L80, M|100/100',
  '|turn|5',
  '|move|p1a: Gengar|Shadow Ball|p2a: Kingambit',
  '|-damage|p2a: Kingambit|10/100',
  '|move|p2a: Kingambit|Sucker Punch|p1a: Gengar',
  '|-damage|p1a: Gengar|0 fnt',
  '|faint|p1a: Gengar',
];

/** A finished, rated game won by p2. */
export function playedReplay(overrides: Partial<ReplayJson> = {}): ReplayJson {
  const log = makeLog({
    p1: 'Alice',
    p2: 'Bob',
    r1: 1500,
    r2: 1520,
    body: [
      ...PLAYED_BODY,
      '|win|Bob',
      "|raw|Alice's rating: 1500 &rarr; <strong>1481</strong><br />(-19 for losing)",
      "|raw|Bob's rating: 1520 &rarr; <strong>1539</strong><br />(+19 for winning)",
    ],
  });
  return {
    id: 'gen9randombattle-100',
    format: '[Gen 9] Random Battle',
    formatid: 'gen9randombattle',
    players: ['Alice', 'Bob'],
    log,
    uploadtime: 1792491350,
    rating: 1500,
    private: 0,
    ...overrides,
  };
}

/** A game that ends on turn 1 because a player forfeits. */
export function earlyForfeitReplay(): ReplayJson {
  const log = makeLog({
    p1: 'Alice',
    p2: 'Bob',
    r1: 1500,
    r2: 1520,
    body: [
      '|switch|p1a: Zoroark|Zoroark, L82, M|100/100',
      '|switch|p2a: Hydrapple|Hydrapple, L84, F|100/100',
      '|turn|1',
      '|',
      '|-message|Alice forfeited.',
      '|',
      '|win|Bob',
    ],
  });
  return playedReplay({ id: 'gen9randombattle-101', log });
}

/**
 * A rated game in which both players disconnect and rejoin. The server
 * re-announces them without ratings, as seen in real replays.
 */
export function reconnectReplay(): ReplayJson {
  const log = makeLog({
    p1: 'Alice',
    p2: 'Bob',
    r1: 1500,
    r2: 1520,
    body: [
      ...PLAYED_BODY.slice(0, 8),
      '|player|p2|',
      '|player|p1|',
      '|player|p1|Alice|102|',
      '|player|p2|Bob|lance-gen1rb|',
      ...PLAYED_BODY.slice(8),
      '|win|Bob',
    ],
  });
  return playedReplay({ id: 'gen9randombattle-106', log });
}

/** A game with no ratings for either player. */
export function unratedReplay(): ReplayJson {
  const log = makeLog({
    p1: 'Alice',
    p2: 'Bob',
    r1: null,
    r2: null,
    body: [...PLAYED_BODY, '|win|Bob'],
  });
  return playedReplay({ id: 'gen9randombattle-102', log, rating: null });
}

/** A game whose log stops before any result. */
export function unfinishedReplay(): ReplayJson {
  const log = makeLog({ p1: 'Alice', p2: 'Bob', r1: 1500, r2: 1520, body: PLAYED_BODY.slice(0, 8) });
  return playedReplay({ id: 'gen9randombattle-103', log });
}

/** A game that ends in a tie. */
export function tiedReplay(): ReplayJson {
  const log = makeLog({
    p1: 'Alice',
    p2: 'Bob',
    r1: 1500,
    r2: 1520,
    body: [...PLAYED_BODY, '|tie'],
  });
  return playedReplay({ id: 'gen9randombattle-104', log });
}

/** A long game (more than five turns) that ends in a forfeit. */
export function lateForfeitReplay(): ReplayJson {
  const log = makeLog({
    p1: 'Alice',
    p2: 'Bob',
    r1: 1500,
    r2: 1520,
    body: [...PLAYED_BODY, '|-message|Alice forfeited.', '|win|Bob'],
  });
  return playedReplay({ id: 'gen9randombattle-105', log });
}

/** A game where a player whose name contains a space times out. */
export function spacedNameTimeoutReplay(): ReplayJson {
  const log = makeLog({
    p1: 'sasha thumper',
    p2: 'Bob',
    r1: 1500,
    r2: 1520,
    body: [...PLAYED_BODY, '|-message|sasha thumper lost due to inactivity.', '|win|Bob'],
  });
  return playedReplay({ id: 'gen9randombattle-107', log });
}

/** A forfeit message that names someone who is not a player in the game. */
export function strangerForfeitReplay(): ReplayJson {
  const log = makeLog({
    p1: 'Alice',
    p2: 'Bob',
    r1: 1500,
    r2: 1520,
    body: [...PLAYED_BODY, '|-message|Carol forfeited.', '|win|Bob'],
  });
  return playedReplay({ id: 'gen9randombattle-108', log });
}
