import { describe, expect, it } from 'vitest';
import { applyCalibration, fitCalibration } from '../lib/review/calibrate';
import { baseMove, bestExpectedValue, choiceValue, gradeWithPriority, judgeWithEngine, judgeWithQ, rootValue, type QTable } from '../lib/review/engine-results';

const side = [
  { engine: 'flamethrower', visits: 810, score: 486 }, // 0.60
  { engine: 'roost', visits: 90, score: 31.5 }, // 0.35
  { engine: 'switch blastoise', visits: 99, score: 20 }, // about 0.20
  { engine: 'earthquake', visits: 1, score: 1 }, // too few tries to trust
];

describe('engine results', () => {
  it('averages a choice and the whole side', () => {
    expect(choiceValue(side[0]!)).toBeCloseTo(0.6, 5);
    expect(choiceValue({ engine: 'x', visits: 0, score: 0 })).toBeNull();
    expect(rootValue(side)).toBeCloseTo(538.5 / 1000, 5);
    expect(rootValue([])).toBeNull();
  });

  it('grades by the gap to the best well-tried choice', () => {
    expect(judgeWithEngine(side, 'flamethrower').grade).toBe('best');
    const roost = judgeWithEngine(side, 'roost');
    expect(roost.loss).toBeCloseTo(0.25, 5);
    expect(roost.grade).toBe('blunder');
    expect(judgeWithEngine(side, 'switch blastoise').grade).toBe('blunder');
  });

  it('ignores a choice tried too rarely when finding the best', () => {
    // earthquake averages 1.0 but was tried once, so flamethrower still counts as best.
    expect(judgeWithEngine(side, 'flamethrower').loss).toBe(0);
  });

  it('reports unknown only when the played choice is not known or nothing was searched', () => {
    expect(judgeWithEngine(side, null).grade).toBe('unknown');
    expect(judgeWithEngine([{ engine: 'a', visits: 0, score: 0 }], 'a').grade).toBe('unknown');
  });

  it('grades a legal move the search never tried by its distance from the best move', () => {
    const judged = judgeWithEngine(side, 'surf');
    expect(judged.grade).not.toBe('unknown');
    expect(judged.approximate).toBe(true);
    expect(judged.share).toBe(0);
    expect(judged.loss).toBeGreaterThan(0);
  });

  it('lists the most-tried choices first', () => {
    const judged = judgeWithEngine(side, 'roost');
    expect(judged.best.map((entry) => entry.engine)).toEqual(['flamethrower', 'switch blastoise', 'roost']);
    expect(judged.best[0]!.share).toBeCloseTo(0.81, 5);
  });

  it('calls a single option forced', () => {
    expect(judgeWithEngine([{ engine: 'a', visits: 10, score: 5 }], 'a').grade).toBe('forced');
  });
});

describe('calibration', () => {
  it('learns to shrink an overconfident score', () => {
    const scores: number[] = [];
    const outcomes: number[] = [];
    for (let i = 0; i < 400; i++) {
      scores.push(i % 2 === 0 ? 0.9 : 0.1);
      // The 0.9 scores win only 70% of the time and the 0.1 scores win 30%.
      const win = i % 2 === 0 ? (i % 20 < 14 ? 1 : 0) : i % 20 < 7 ? 1 : 0;
      outcomes.push(win);
    }
    const fit = fitCalibration(scores, outcomes);
    expect(applyCalibration(fit, 0.9)).toBeCloseTo(0.7, 1);
    expect(applyCalibration(fit, 0.1)).toBeCloseTo(0.3, 1);
  });
});

describe('Terastallization', () => {
  // The same move is valued 0.40 plain and 0.70 with Tera; a different move is valued 0.45.
  const withTera = [
    { engine: 'bugbuzz', visits: 100, score: 40 },
    { engine: 'bugbuzz-tera', visits: 700, score: 490 },
    { engine: 'psychic', visits: 80, score: 36 },
  ];

  it('strips the Tera suffix and leaves switches alone', () => {
    expect(baseMove('bugbuzz-tera')).toBe('bugbuzz');
    expect(baseMove('bugbuzz')).toBe('bugbuzz');
    expect(baseMove('switch rabsca')).toBe('switch rabsca');
  });

  it('does not penalise playing a move without Tera when it is the engine\'s favourite move', () => {
    const judged = judgeWithEngine(withTera, 'bugbuzz');
    expect(judged.grade).toBe('best');
    expect(judged.loss).toBe(0);
  });

  it('reports what Tera would have added, separately from the grade', () => {
    expect(judgeWithEngine(withTera, 'bugbuzz').teraGain).toBeCloseTo(0.3, 5);
    expect(judgeWithEngine(withTera, 'bugbuzz-tera').teraGain).toBeNull();
  });

  it('combines the plain and Tera versions when listing the most-tried moves', () => {
    const judged = judgeWithEngine(withTera, 'psychic');
    expect(judged.best[0]?.engine).toBe('bugbuzz');
    expect(judged.best[0]?.share).toBeCloseTo(800 / 880, 5);
  });

  it('still grades a genuinely worse move', () => {
    expect(judgeWithEngine(withTera, 'psychic').grade).toBe('blunder');
  });

  it('gives no Tera note when the search did not try both versions', () => {
    expect(judgeWithEngine(side, 'flamethrower').teraGain).toBeNull();
  });
});

describe('engine priority', () => {
  it('calls a move the engine plays often best, and never worse than good above a lower share', () => {
    expect(gradeWithPriority(0.025, 0.35)).toBe('best');
    expect(gradeWithPriority(0.06, 0.12)).toBe('good');
    expect(gradeWithPriority(0.4, 0.05)).toBe('blunder');
    expect(gradeWithPriority(0.01, 0.01)).toBe('best');
  });

  it('does not let how often the engine plays a move hide a large measured cost', () => {
    expect(gradeWithPriority(0.18, 0.4)).toBe('mistake');
    expect(gradeWithPriority(0.4, 0.35)).toBe('blunder');
    expect(gradeWithPriority(0.12, 0.2)).toBe('mistake');
    expect(gradeWithPriority(0.04, 0.35)).toBe('good');
  });

  it('keeps a good grade as good when the share is high enough', () => {
    expect(gradeWithPriority(0.03, 0.12)).toBe('good');
  });

  it('reports the played move\'s share of the search', () => {
    expect(judgeWithEngine(side, 'flamethrower').share).toBeCloseTo(0.81, 5);
    expect(judgeWithEngine(side, 'roost').share).toBeCloseTo(0.09, 5);
  });
});

describe('grading the Tera decision', () => {
  const make = (plainScore: number, teraScore: number) => [
    { engine: 'bugbuzz', visits: 400, score: 400 * plainScore },
    { engine: 'bugbuzz-tera', visits: 400, score: 400 * teraScore },
    { engine: 'psychic', visits: 200, score: 200 * 0.4 },
  ];

  it('says Tera was needed when it gained a lot and was used', () => {
    const tera = judgeWithEngine(make(0.4, 0.7), 'bugbuzz-tera').tera;
    expect(tera?.action).toBe('used');
    expect(tera?.grade).toBe('best');
    expect(tera?.note).toBe('Tera was needed here');
  });

  it('calls Tera worth it when it gained more than its cost', () => {
    expect(judgeWithEngine(make(0.5, 0.6), 'bugbuzz-tera').tera?.note).toBe('Tera was worth it');
  });

  it('marks Tera used for little gain as worse than saving it', () => {
    const tera = judgeWithEngine(make(0.5, 0.52), 'bugbuzz-tera').tera;
    expect(tera?.note).toBe('Tera gained little; saving it was better');
    expect(tera?.grade).toBe('inaccuracy');
  });

  it('marks Tera that made the move worse as a mistake', () => {
    const tera = judgeWithEngine(make(0.6, 0.4), 'bugbuzz-tera').tera;
    expect(tera?.note).toBe('Tera made this move worse');
    expect(tera?.grade).toBe('blunder');
  });

  it('does not penalise holding Tera when the gain is small', () => {
    const tera = judgeWithEngine(make(0.5, 0.55), 'bugbuzz').tera;
    expect(tera?.action).toBe('held');
    expect(tera?.grade).toBe('best');
    expect(tera?.note).toBe('Tera was not needed');
  });

  it('flags a missed Tera when holding it cost a lot', () => {
    const tera = judgeWithEngine(make(0.3, 0.8), 'bugbuzz').tera;
    expect(tera?.note).toBe('Tera was needed here and was not used');
    expect(tera?.grade).toBe('blunder');
  });

  it('ignores a Tera version the search barely tried, since its score is mostly luck', () => {
    const rows = [
      { engine: 'bugbuzz', visits: 950, score: 950 * 0.5 },
      { engine: 'bugbuzz-tera', visits: 30, score: 30 * 0.9 },
      { engine: 'psychic', visits: 20, score: 20 * 0.4 },
    ];
    expect(judgeWithEngine(rows, 'bugbuzz').tera).toBeNull();
  });

  it('calls Tera needed when the engine only ever played the Tera version', () => {
    const rows = [
      { engine: 'bugbuzz-tera', visits: 950, score: 950 * 0.7 },
      { engine: 'bugbuzz', visits: 10, score: 10 * 0.2 },
      { engine: 'psychic', visits: 40, score: 40 * 0.3 },
    ];
    const tera = judgeWithEngine(rows, 'bugbuzz-tera').tera;
    expect(tera?.note).toBe('Tera was needed here');
    expect(tera?.gain).toBeNull();
  });

  it('has no Tera judgement for a switch or when only one version was searched', () => {
    expect(judgeWithEngine([{ engine: 'switch a', visits: 5, score: 2 }, { engine: 'x', visits: 5, score: 2 }], 'switch a').tera).toBeNull();
    expect(judgeWithEngine(side, 'flamethrower').tera).toBeNull();
  });
});

describe('moves the engine only approximates', () => {
  const rows = [
    { engine: 'psychic', visits: 900, score: 540 },
    { engine: 'revivalblessing', visits: 10, score: 3 },
  ];

  it('still grades them, flags them approximate, and never calls them worse than a mistake', () => {
    const judged = judgeWithEngine(rows, 'revivalblessing');
    expect(judged.grade).toBe('mistake');
    expect(judged.approximate).toBe(true);
    expect(judgeWithEngine(rows, 'psychic').approximate).toBe(false);
  });
});

describe('equal-effort values', () => {
  // Turn 14 of a real game: the search favoured gunkshot almost every time, so sucker
  // punch was valued from few tries and looked terrible; played out evenly it is fine.
  const table: QTable = {
    rows: ['gunkshot', 'gunkshot-tera', 'suckerpunch', 'suckerpunch-tera', 'coil'],
    cols: ['bulletseed', 'tripleaxel', 'stickyweb'],
    weights: [0.45, 0.4, 0.15],
    values: [
      [0.8, 0.82, 1.0],
      [0.84, 0.86, 1.0],
      [0.91, 0.91, 0.6],
      [0.94, 0.94, 0.67],
      [0.79, 0.81, 0.87],
    ],
  };
  const lopsided = [
    { engine: 'gunkshot', visits: 600, score: 600 * 0.39 },
    { engine: 'gunkshot-tera', visits: 98000, score: 98000 * 0.93 },
    { engine: 'suckerpunch', visits: 1200, score: 1200 * 0.38 },
    { engine: 'coil', visits: 200, score: 200 * 0.16 },
  ];

  it('values a move by its average over the opponent\'s mix of replies', () => {
    const fair = judgeWithQ(table, 'suckerpunch', null);
    expect(fair?.mine).toBeGreaterThan(0.67);
    expect(fair?.mine).toBeLessThan(0.95);
    expect(fair?.top).toBeGreaterThanOrEqual(fair?.mine ?? 1);
  });

  it('does not call a fairly valued move a blunder just because the search rarely tried it', () => {
    const old = judgeWithEngine(lopsided, 'suckerpunch');
    const fair = judgeWithEngine(lopsided, 'suckerpunch', table, 'stickyweb');
    expect(old.loss).toBeGreaterThan(0.4);
    expect(fair.loss).toBeLessThan(0.08);
    expect(['best', 'good']).toContain(fair.grade);
  });

  it('reports how the move did against the reply that was actually played', () => {
    const fair = judgeWithEngine(lopsided, 'suckerpunch', table, 'stickyweb');
    expect(fair.vsReply?.reply).toBe('stickyweb');
    expect(fair.vsReply?.value).toBeCloseTo(0.67, 5);
    expect(fair.vsReply?.best).toBeCloseTo(1.0, 5);
    expect(fair.vsReply?.bestMove).toBe('gunkshot');
  });

  it('grades Tera from the difference between its own rows', () => {
    const fair = judgeWithEngine(lopsided, 'suckerpunch', table, 'stickyweb');
    expect(fair.tera?.action).toBe('held');
    expect(fair.tera?.note).toBe('Tera was not needed');
    expect(judgeWithEngine(lopsided, 'gunkshot-tera', table, 'stickyweb').tera?.action).toBe('used');
  });

  it('gives each side an overall win probability from its best move', () => {
    const value = bestExpectedValue(table);
    expect(value).toBeGreaterThan(0.8);
    expect(value).toBeLessThan(0.95);
    expect(bestExpectedValue(undefined)).toBeNull();
  });

  it('returns nothing when the played move is not in the table', () => {
    expect(judgeWithQ(table, 'surf', null)).toBeNull();
  });
});

describe('opponent mix is smoothed, not counted or picked arbitrarily', () => {
  it('gives the same values whatever visit weights the table carries', () => {
    const base: QTable = {
      rows: ['a', 'b'],
      cols: ['x', 'y'],
      weights: [0.9, 0.1],
      values: [
        [0.8, 0.3],
        [0.4, 0.7],
      ],
    };
    const flipped: QTable = { ...base, weights: [0.1, 0.9] };
    expect(judgeWithQ(base, 'a', null)?.mine).toBeCloseTo(judgeWithQ(flipped, 'a', null)?.mine ?? -1, 8);
    // Matching-pennies style game: each move is worth about the game value (0.55) against the mix.
    expect(judgeWithQ(base, 'a', null)?.mine).toBeGreaterThan(0.5);
    expect(judgeWithQ(base, 'a', null)?.mine).toBeLessThan(0.6);
  });

  it('skips rows the engine could not play out', () => {
    const t: QTable = {
      rows: ['a', 'b', 'switch c'],
      cols: ['x'],
      weights: [1],
      values: [[0.6], [0.4], [null]],
    };
    expect(judgeWithQ(t, 'switch c', null)).toBeNull();
    expect(judgeWithQ(t, 'a', null)?.mine).toBeCloseTo(0.6, 5);
  });
});

describe('ties between moves', () => {
  it('gives a move outside a group of equal best moves a middling value, not an extreme one', () => {
    // a is safe everywhere. b is as good as a against x and poor against y. Any opponent mix is
    // optimal against a, so an exact solver returns an arbitrary one and b swings from 0.6 to 0.2.
    const t: QTable = {
      rows: ['a', 'b'],
      cols: ['x', 'y'],
      weights: [0.5, 0.5],
      values: [
        [0.6, 0.6],
        [0.6, 0.2],
      ],
    };
    const b = judgeWithQ(t, 'b', null);
    expect(b?.mine).toBeGreaterThan(0.25);
    expect(b?.mine).toBeLessThan(0.55);
    expect(b?.top).toBeCloseTo(0.6, 3);
  });

  it('gives the same answer every time', () => {
    const t: QTable = { rows: ['a', 'b'], cols: ['x', 'y'], weights: [1, 0], values: [[0.7, 0.4], [0.3, 0.8]] };
    expect(judgeWithQ(t, 'a', null)?.mine).toBe(judgeWithQ(t, 'a', null)?.mine);
  });
});

describe('a reply that was played but never searched', () => {
  it('is compared against without changing the other values', () => {
    const base: QTable = {
      rows: ['surf', 'roost'],
      cols: ['flamethrower', 'protect'],
      weights: [0.6, 0.4],
      values: [
        [0.7, 0.4],
        [0.5, 0.5],
      ],
    };
    const withExtra: QTable = {
      rows: base.rows,
      cols: [...base.cols, 'switch blastoise'],
      weights: [...base.weights, 0],
      values: [
        [0.7, 0.4, 0.2],
        [0.5, 0.5, 0.6],
      ],
    };
    const before = judgeWithQ(base, 'surf', null);
    const after = judgeWithQ(withExtra, 'surf', 'switch blastoise');
    expect(after?.mine).toBeCloseTo(before?.mine ?? -1, 6);
    expect(after?.vsReply?.value).toBeCloseTo(0.2, 6);
    expect(after?.vsReply?.best).toBeCloseTo(0.6, 6);
  });

  it('is skipped when the engine could not simulate it', () => {
    const table: QTable = {
      rows: ['surf', 'roost'],
      cols: ['flamethrower', 'oddity'],
      weights: [1, 0],
      values: [
        [0.7, null],
        [0.5, null],
      ],
    };
    expect(judgeWithQ(table, 'surf', 'oddity')?.vsReply ?? null).toBeNull();
    expect(judgeWithQ(table, 'surf', null)?.mine).toBeCloseTo(0.7, 6);
  });
});

describe('a reply the engine could not play out', () => {
  it('does not blank the other values', () => {
    const table: QTable = {
      rows: ['surf', 'roost', 'switch blastoise'],
      cols: ['flamethrower', 'switch scrafty', 'protect'],
      weights: [0.6, 0.1, 0.3],
      values: [
        [0.7, null, 0.4],
        [0.5, null, 0.5],
        [null, null, null],
      ],
    };
    const judged = judgeWithQ(table, 'surf', 'flamethrower');
    expect(judged).not.toBeNull();
    expect(judged?.vsReply?.value).toBeCloseTo(0.7, 6);
    expect(bestExpectedValue(table)).not.toBeNull();
  });
});
