import { describe, expect, it } from 'vitest';
import { applyCalibration, fitCalibration } from '../lib/review/calibrate';
import { choiceValue, judgeWithEngine, rootValue } from '../lib/review/engine-results';

const side = [
  { engine: 'flamethrower', visits: 600, score: 360 }, // 0.60
  { engine: 'roost', visits: 300, score: 105 }, // 0.35
  { engine: 'switch blastoise', visits: 99, score: 20 }, // about 0.20
  { engine: 'earthquake', visits: 1, score: 1 }, // too few tries to trust
];

describe('engine results', () => {
  it('averages a choice and the whole side', () => {
    expect(choiceValue(side[0]!)).toBeCloseTo(0.6, 5);
    expect(choiceValue({ engine: 'x', visits: 0, score: 0 })).toBeNull();
    expect(rootValue(side)).toBeCloseTo(486 / 1000, 5);
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
    expect(judged.best.map((entry) => entry.engine)).toEqual(['flamethrower', 'roost', 'switch blastoise']);
    expect(judged.best[0]!.share).toBeCloseTo(0.6, 5);
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
