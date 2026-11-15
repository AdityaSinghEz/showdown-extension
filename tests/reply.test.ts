import { describe, expect, it } from 'vitest';
import { judgeAgainstReply, type PayoffMatrix } from '../lib/review/reply';

// Rows: p1 plays psychic, trickroom, switch. Columns: p2 plays fireblast, switch lokix.
const matrix: PayoffMatrix = {
  p1: ['psychic', 'trickroom', 'switch arbok'],
  p2: ['fireblast', 'switch lokix'],
  values: [50, -20, 10, 80, 5, 0],
  depth: 4,
};

describe('judging against the actual reply', () => {
  it('ranks the move against the reply that was played', () => {
    const vsFire = judgeAgainstReply(matrix, 'p1', 'psychic', 'fireblast');
    expect(vsFire?.label).toBe('best');
    expect(vsFire?.rank).toBe(1);
    const vsSwitch = judgeAgainstReply(matrix, 'p1', 'trickroom', 'switch lokix');
    expect(vsSwitch?.label).toBe('best');
    expect(judgeAgainstReply(matrix, 'p1', 'psychic', 'switch lokix')?.label).toBe('poor');
  });

  it('reads the opponent side with the sign flipped', () => {
    // After p1 plays psychic, p2 does better with the lower number: the switch.
    expect(judgeAgainstReply(matrix, 'p2', 'fireblast', 'psychic')?.best).toBe('switch lokix');
    expect(judgeAgainstReply(matrix, 'p2', 'fireblast', 'psychic')?.label).toBe('poor');
    expect(judgeAgainstReply(matrix, 'p2', 'switch lokix', 'psychic')?.label).toBe('best');
  });

  it('falls back to the plain move when the Tera version is missing and skips pruned cells', () => {
    expect(judgeAgainstReply(matrix, 'p1', 'psychic-tera', 'fireblast')?.rank).toBe(1);
    const pruned: PayoffMatrix = { ...matrix, values: [50, null, null, 80, null, 0] };
    expect(judgeAgainstReply(pruned, 'p1', 'trickroom', 'switch lokix')?.outOf).toBe(2);
    expect(judgeAgainstReply(pruned, 'p1', 'trickroom', 'fireblast')).toBeNull();
    expect(judgeAgainstReply(matrix, 'p1', 'nothing', 'fireblast')).toBeNull();
  });
});
