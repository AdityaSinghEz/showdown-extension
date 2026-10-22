import { describe, expect, it } from 'vitest';
import { buildGameRecord, type GameRecord } from '../lib/dataset/record';
import { winCurve } from '../lib/model/curve';
import {
  accuracy,
  BASELINE_BRIER,
  BASELINE_LOG_LOSS,
  brierScore,
  calibration,
  logLoss,
  type Prediction,
} from '../lib/model/evaluate';
import { FEATURE_NAMES } from '../lib/model/features';
import {
  predictProbability,
  sigmoid,
  trainLogistic,
  type LogisticModel,
  type TrainingExample,
} from '../lib/model/logistic';
import { hashString, isTestGame } from '../lib/model/split';
import { playedReplay } from './replay-fixtures';

/** Small deterministic random number generator (mulberry32). */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('sigmoid', () => {
  it('maps 0 to one half and is symmetric', () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(2) + sigmoid(-2)).toBeCloseTo(1);
  });

  it('does not overflow for extreme inputs', () => {
    expect(sigmoid(1000)).toBe(1);
    expect(sigmoid(-1000)).toBe(0);
    expect(Number.isNaN(sigmoid(-1e6))).toBe(false);
  });
});

describe('trainLogistic', () => {
  const names = ['a', 'b', 'c'];

  it('recovers known weights from generated data', () => {
    const trueWeights = [1.2, -0.8, 0.5];
    const random = seededRandom(42);
    const examples: TrainingExample[] = [];
    for (let i = 0; i < 20000; i += 1) {
      const features = trueWeights.map(() => (random() * 2 - 1) * 2);
      const z = features.reduce((sum, x, k) => sum + x * trueWeights[k]!, 0);
      examples.push({ features, label: random() < sigmoid(z) ? 1 : 0 });
    }
    const model = trainLogistic(names, examples);
    trueWeights.forEach((weight, k) => expect(model.weights[k]).toBeCloseTo(weight, 1));
    expect(model.featureNames).toEqual(names);
  });

  it('keeps weights finite when the classes are perfectly separable', () => {
    const examples: TrainingExample[] = [];
    for (let i = 1; i <= 50; i += 1) {
      examples.push({ features: [i, 0, 0], label: 1 });
      examples.push({ features: [-i, 0, 0], label: 0 });
    }
    const model = trainLogistic(names, examples);
    expect(Number.isFinite(model.weights[0])).toBe(true);
    expect(predictProbability(model, [3, 0, 0])).toBeGreaterThan(0.9);
    expect(predictProbability(model, [-3, 0, 0])).toBeLessThan(0.1);
  });

  it('handles a feature that never varies without failing', () => {
    const random = seededRandom(7);
    const examples: TrainingExample[] = Array.from({ length: 500 }, () => {
      const x = random() * 2 - 1;
      return { features: [x, 0, 0], label: random() < sigmoid(2 * x) ? 1 : 0 };
    });
    const model = trainLogistic(names, examples);
    expect(model.weights[1]).toBeCloseTo(0);
    expect(model.weights[2]).toBeCloseTo(0);
    expect(model.weights[0]).toBeGreaterThan(1);
  });

  it('is deterministic', () => {
    const random = seededRandom(3);
    const examples: TrainingExample[] = Array.from({ length: 300 }, () => {
      const features = [random() - 0.5, random() - 0.5, random() - 0.5];
      return { features, label: random() < 0.5 ? 1 : 0 };
    });
    expect(trainLogistic(names, examples)).toEqual(trainLogistic(names, examples));
  });

  it('rejects empty data and mismatched vectors', () => {
    expect(() => trainLogistic(names, [])).toThrow('zero examples');
    expect(() => trainLogistic(names, [{ features: [1, 2], label: 1 }])).toThrow('Expected 3 features');
  });
});

describe('predictProbability', () => {
  const model: LogisticModel = { featureNames: ['a', 'b'], weights: [0.7, -0.3] };

  it('is exactly 50% for equal sides', () => {
    expect(predictProbability(model, [0, 0])).toBe(0.5);
  });

  it('flips to the complement when the sides are swapped', () => {
    const p = predictProbability(model, [1.5, 0.4]);
    expect(p + predictProbability(model, [-1.5, -0.4])).toBeCloseTo(1);
  });
});

describe('forecast metrics', () => {
  const coinFlips: Prediction[] = [
    { probability: 0.5, label: 1 },
    { probability: 0.5, label: 0 },
  ];

  it('scores a constant 50% forecast at the baselines', () => {
    expect(logLoss(coinFlips)).toBeCloseTo(BASELINE_LOG_LOSS);
    expect(brierScore(coinFlips)).toBeCloseTo(BASELINE_BRIER);
    expect(BASELINE_LOG_LOSS).toBeCloseTo(0.6931, 4);
  });

  it('rewards confident correct forecasts and punishes confident wrong ones', () => {
    const right: Prediction[] = [{ probability: 0.99, label: 1 }];
    const wrong: Prediction[] = [{ probability: 0.99, label: 0 }];
    expect(logLoss(right)).toBeLessThan(0.02);
    expect(logLoss(wrong)).toBeGreaterThan(4);
    expect(brierScore(right)).toBeLessThan(brierScore(wrong));
  });

  it('stays finite for forecasts of exactly 0 or 1', () => {
    expect(Number.isFinite(logLoss([{ probability: 1, label: 0 }]))).toBe(true);
    expect(Number.isFinite(logLoss([{ probability: 0, label: 1 }]))).toBe(true);
  });

  it('computes accuracy using 50% as the cut-off', () => {
    expect(
      accuracy([
        { probability: 0.8, label: 1 },
        { probability: 0.3, label: 0 },
        { probability: 0.6, label: 0 },
        { probability: 0.4, label: 1 },
      ]),
    ).toBe(0.5);
  });

  it('returns NaN for empty input', () => {
    expect(logLoss([])).toBeNaN();
    expect(brierScore([])).toBeNaN();
    expect(accuracy([])).toBeNaN();
  });
});

describe('calibration', () => {
  it('compares average forecasts with observed rates per bucket', () => {
    const bins = calibration([
      { probability: 0.05, label: 0 },
      { probability: 0.05, label: 0 },
      { probability: 0.95, label: 1 },
      { probability: 0.95, label: 0 },
    ]);
    expect(bins).toHaveLength(2);
    expect(bins[0]).toMatchObject({ lower: 0, upper: 0.1, count: 2, observedRate: 0 });
    expect(bins[0]?.meanPredicted).toBeCloseTo(0.05);
    expect(bins[1]).toMatchObject({ count: 2, observedRate: 0.5 });
  });

  it('puts a forecast of exactly 1 in the top bucket', () => {
    const bins = calibration([{ probability: 1, label: 1 }]);
    expect(bins).toEqual([{ lower: 0.9, upper: 1, count: 1, meanPredicted: 1, observedRate: 1 }]);
  });

  it('omits empty buckets', () => {
    expect(calibration([])).toEqual([]);
  });
});

describe('train/test split', () => {
  it('matches the published FNV-1a reference values', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
  });

  it('always puts the same game on the same side', () => {
    const id = 'gen9randombattle-2701866020';
    expect(isTestGame(id, 20)).toBe(isTestGame(id, 20));
  });

  it('holds out roughly the requested share', () => {
    let held = 0;
    for (let i = 0; i < 5000; i += 1) if (isTestGame(`gen9randombattle-${2701000000 + i}`, 20)) held += 1;
    expect(held / 5000).toBeGreaterThan(0.17);
    expect(held / 5000).toBeLessThan(0.23);
  });

  it('handles the extremes', () => {
    expect(isTestGame('x-1', 0)).toBe(false);
    expect(isTestGame('x-1', 100)).toBe(true);
  });

  it('never moves an existing game when more games are added', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `g-${i}`);
    const before = ids.map((id) => isTestGame(id, 25));
    const after = [...ids, 'g-new-1', 'g-new-2'].slice(0, 200).map((id) => isTestGame(id, 25));
    expect(after).toEqual(before);
  });
});

describe('winCurve', () => {
  const model: LogisticModel = { featureNames: [...FEATURE_NAMES], weights: [0.5, 0, 0, 0, 0] };

  function record(): GameRecord {
    const result = buildGameRecord(playedReplay());
    if (!result.ok) throw new Error('fixture should build');
    return result.record;
  }

  it('starts at 50% and follows the model after each turn', () => {
    const curve = winCurve(model, record());
    expect(curve.map((p) => p.turn)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(curve[0]?.p1WinProb).toBe(0.5);
    // Turn 1: equal Pokemon counts. Turn 2: player 1 is one Pokemon down.
    expect(curve[1]?.p1WinProb).toBeCloseTo(0.5);
    expect(curve[2]?.p1WinProb).toBeCloseTo(sigmoid(-0.5));
  });

  it('reports a decided position as exactly 0 or 1', () => {
    const decided = JSON.parse(JSON.stringify(record())) as GameRecord;
    const last = decided.turns[decided.turns.length - 1];
    if (!last?.endState) throw new Error('fixture should have a final snapshot');
    last.endState.p2.remaining = 0;
    expect(winCurve(model, decided).at(-1)?.p1WinProb).toBe(1);
    last.endState.p2.remaining = 3;
    last.endState.p1.remaining = 0;
    expect(winCurve(model, decided).at(-1)?.p1WinProb).toBe(0);
  });

  it('reports null for a turn that never closed', () => {
    const open = JSON.parse(JSON.stringify(record())) as GameRecord;
    const last = open.turns[open.turns.length - 1];
    if (last) last.endState = null;
    expect(winCurve(model, open).at(-1)?.p1WinProb).toBeNull();
  });
});
