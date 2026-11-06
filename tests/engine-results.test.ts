import { describe, expect, it } from 'vitest';
import { applyCalibration, fitCalibration } from '../lib/review/calibrate';
import { baseMove, choiceValue, gradeWithPriority, judgeWithEngine, rootValue } from '../lib/review/engine-results';

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

  it('reports unknown for a choice that is missing or was never tried', () => {
    expect(judgeWithEngine(side, 'surf').grade).toBe('unknown');
    expect(judgeWithEngine(side, null).grade).toBe('unknown');
    expect(judgeWithEngine([{ engine: 'a', visits: 0, score: 0 }], 'a').grade).toBe('unknown');
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
    expect(gradeWithPriority(0.4, 0.35)).toBe('best');
    expect(gradeWithPriority(0.4, 0.12)).toBe('good');
    expect(gradeWithPriority(0.4, 0.05)).toBe('blunder');
    expect(gradeWithPriority(0.01, 0.01)).toBe('best');
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

  it('has no Tera judgement for a switch or when only one version was searched', () => {
    expect(judgeWithEngine([{ engine: 'switch a', visits: 5, score: 2 }, { engine: 'x', visits: 5, score: 2 }], 'switch a').tera).toBeNull();
    expect(judgeWithEngine(side, 'flamethrower').tera).toBeNull();
  });
});

describe('moves the engine cannot model', () => {
  it('leaves them ungraded instead of calling them blunders', () => {
    const rows = [
      { engine: 'psychic', visits: 900, score: 540 },
      { engine: 'revivalblessing', visits: 10, score: 3 },
    ];
    expect(judgeWithEngine(rows, 'revivalblessing').grade).toBe('unknown');
    expect(judgeWithEngine(rows, 'psychic').grade).not.toBe('unknown');
  });
});
