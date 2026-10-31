import { describe, expect, it } from 'vitest';
import { gradeLoss } from '../lib/review/grade';
import { legalOptions, matchChoice, toId } from '../lib/review/engine';
import { columnPayoffs, rowPayoffs, solveMatrixGame } from '../lib/review/matrix';
import type { SimRequest } from '../lib/review/sim';

describe('solveMatrixGame', () => {
  it('solves matching pennies: value 0.5, both mix evenly', () => {
    const solution = solveMatrixGame([
      [1, 0],
      [0, 1],
    ]);
    expect(solution.value).toBeCloseTo(0.5, 8);
    expect(solution.rowStrategy[0]).toBeCloseTo(0.5, 8);
    expect(solution.columnStrategy[1]).toBeCloseTo(0.5, 8);
  });

  it('finds a saddle point', () => {
    // Row 1 is always at least as good; the column player then picks column 0.
    const solution = solveMatrixGame([
      [0.4, 0.6],
      [0.7, 0.9],
    ]);
    expect(solution.value).toBeCloseTo(0.7, 8);
    expect(solution.rowStrategy[1]).toBeCloseTo(1, 8);
    expect(solution.columnStrategy[0]).toBeCloseTo(1, 8);
  });

  it('solves rock-paper-scissors: value 0.5, uniform mix', () => {
    const solution = solveMatrixGame([
      [0.5, 0, 1],
      [1, 0.5, 0],
      [0, 1, 0.5],
    ]);
    expect(solution.value).toBeCloseTo(0.5, 8);
    for (const p of solution.rowStrategy) expect(p).toBeCloseTo(1 / 3, 8);
    for (const p of solution.columnStrategy) expect(p).toBeCloseTo(1 / 3, 8);
  });

  it('solves an asymmetric 2x2 mixed game', () => {
    // Known solution: value = (ad - bc) / (a + d - b - c) = (0.8*0.6 - 0.2*0.1) / (0.8 + 0.6 - 0.2 - 0.1)
    const solution = solveMatrixGame([
      [0.8, 0.2],
      [0.1, 0.6],
    ]);
    expect(solution.value).toBeCloseTo((0.8 * 0.6 - 0.2 * 0.1) / (0.8 + 0.6 - 0.2 - 0.1), 8);
    expect(solution.rowStrategy.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
  });

  it('handles a single cell and rejects bad input', () => {
    expect(solveMatrixGame([[0.3]]).value).toBeCloseTo(0.3, 8);
    expect(() => solveMatrixGame([])).toThrow();
    expect(() => solveMatrixGame([[1, 2], [3]])).toThrow();
  });

  it('gives best responses equal to the value against the equilibrium mix', () => {
    const matrix = [
      [0.8, 0.2],
      [0.1, 0.6],
    ];
    const solution = solveMatrixGame(matrix);
    for (const payoff of rowPayoffs(matrix, solution.columnStrategy)) {
      expect(payoff).toBeLessThanOrEqual(solution.value + 1e-8);
    }
    for (const payoff of columnPayoffs(matrix, solution.rowStrategy)) {
      expect(payoff).toBeGreaterThanOrEqual(solution.value - 1e-8);
    }
  });
});

describe('gradeLoss', () => {
  it('maps loss to chess-style grades', () => {
    expect(gradeLoss(0)).toBe('best');
    expect(gradeLoss(-0.01)).toBe('best');
    expect(gradeLoss(0.03)).toBe('good');
    expect(gradeLoss(0.07)).toBe('inaccuracy');
    expect(gradeLoss(0.15)).toBe('mistake');
    expect(gradeLoss(0.4)).toBe('blunder');
  });
});

const request: SimRequest = {
  active: [
    {
      moves: [
        { move: 'Swords Dance', id: 'swordsdance' },
        { move: 'Facade', id: 'facade' },
        { move: 'Blocked', id: 'blocked', disabled: true },
      ],
      canTerastallize: 'Fire',
    },
  ],
  side: {
    pokemon: [
      { ident: 'p1: A', details: 'Snorlax, L80, M', condition: '300/300', active: true },
      { ident: 'p1: B', details: 'Gastrodon-East, L86, M', condition: '200/300', active: false },
      { ident: 'p1: C', details: 'Pikachu, L90, F', condition: '0 fnt', active: false },
    ],
  },
};

describe('legalOptions', () => {
  it('lists moves, tera variants and living benched Pokemon, skipping disabled moves', () => {
    const labels = legalOptions(request).map((o) => o.choice);
    expect(labels).toEqual(['move 1', 'move 1 terastallize', 'move 2', 'move 2 terastallize', 'switch 2']);
  });

  it('can leave out tera variants', () => {
    expect(legalOptions(request, false).map((o) => o.choice)).toEqual(['move 1', 'move 2', 'switch 2']);
  });

  it('returns nothing for waiting or forced-switch requests', () => {
    expect(legalOptions({ ...request, wait: true })).toEqual([]);
    expect(legalOptions({ ...request, forceSwitch: [true] })).toEqual([]);
    expect(legalOptions(null)).toEqual([]);
  });

  it('gives no switches when trapped', () => {
    const trapped = { ...request, active: [{ ...(request.active?.[0] as object), moves: [], trapped: true }] } as SimRequest;
    expect(legalOptions(trapped).every((o) => o.kind === 'move')).toBe(true);
  });
});

describe('matchChoice', () => {
  const options = legalOptions(request);

  it('matches moves by name, with and without tera', () => {
    expect(options[matchChoice('move facade', options)]?.choice).toBe('move 2');
    expect(options[matchChoice('move facade terastallize', options)]?.choice).toBe('move 2 terastallize');
    expect(options[matchChoice('move swordsdance', options)]?.choice).toBe('move 1');
  });

  it('matches moves and switches by number', () => {
    expect(options[matchChoice('move 1', options)]?.choice).toBe('move 1');
    expect(options[matchChoice('switch 2', options)]?.choice).toBe('switch 2');
  });

  it('returns -1 when nothing matches', () => {
    expect(matchChoice('move surf', options)).toBe(-1);
    expect(matchChoice('switch 3', options)).toBe(-1);
  });
});

describe('toId', () => {
  it('lower-cases and strips punctuation', () => {
    expect(toId('Swords Dance')).toBe('swordsdance');
    expect(toId("King's Rock")).toBe('kingsrock');
  });
});
