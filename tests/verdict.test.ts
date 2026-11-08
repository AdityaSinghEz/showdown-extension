import { describe, expect, it } from 'vitest';
import type { EngineJudgement } from '../lib/review/engine-results';
import type { ReplyJudgement } from '../lib/review/reply';
import { evalBar, moveScore, summarize, verdictFor, winChances } from '../lib/review/verdict';

const judged = (grade: EngineJudgement['grade'], loss: number | null): EngineJudgement => ({
  loss,
  grade,
  best: [],
  teraGain: null,
  share: 0.05,
  value: 0.5,
  top: 0.6,
  topMove: 'psychic',
  tera: null,
});
const reply = (gap: number): ReplyJudgement => ({ rank: gap === 0 ? 1 : 3, outOf: 4, best: 'x', gap, label: gap < 0.05 ? 'best' : 'poor' });

describe('move score', () => {
  it('falls in a straight line from 100 to 0', () => {
    expect(moveScore(0)).toBe(100);
    expect(moveScore(0.05)).toBe(80);
    expect(moveScore(0.125)).toBe(50);
    expect(moveScore(0.25)).toBe(0);
    expect(moveScore(0.6)).toBe(0);
  });
});

describe('verdict', () => {
  it('keeps the engine grade for a good move and never scores it below its band', () => {
    expect(verdictFor(judged('best', 0.03), null)).toEqual({ tag: 'best', score: 90 });
    expect(verdictFor(judged('good', 0.2), null)).toEqual({ tag: 'good', score: 75 });
  });

  it('calls a move the engine disliked a good prediction when it fit the real reply', () => {
    expect(verdictFor(judged('mistake', 0.12), reply(0)).tag).toBe('good prediction');
    expect(verdictFor(judged('blunder', 0.3), reply(0.02)).score).toBe(70);
  });

  it('keeps the bad grade when the move also failed against the real reply', () => {
    expect(verdictFor(judged('blunder', 0.3), reply(0.8))).toEqual({ tag: 'blunder', score: 0 });
    expect(verdictFor(judged('mistake', 0.12), null).tag).toBe('mistake');
  });

  it('does not touch moves that were not judged or were forced', () => {
    expect(verdictFor(judged('unknown', null), reply(0))).toEqual({ tag: 'unknown', score: null });
    expect(verdictFor(judged('forced', 0), reply(0))).toEqual({ tag: 'forced', score: null });
  });
});

describe('eval bar', () => {
  it('turns both sides search values into percentages that add to 100', () => {
    expect(winChances(0.6, 0.4)).toEqual({ p1: 60, p2: 40 });
    expect(winChances(0.5, 0.7)).toEqual({ p1: 42, p2: 58 });
    expect(winChances(0.7, null)).toEqual({ p1: 70, p2: 30 });
    expect(winChances(null, null)).toEqual({ p1: 50, p2: 50 });
  });

  it('draws a bar filled by side one', () => {
    expect(evalBar(50, 10)).toBe('█████░░░░░');
    expect(evalBar(100, 4)).toBe('████');
    expect(evalBar(0, 4)).toBe('░░░░');
  });
});

describe('summary', () => {
  it('averages the judged moves and counts every tag', () => {
    const sum = summarize([
      { tag: 'best', score: 100 },
      { tag: 'good', score: 80 },
      { tag: 'unknown', score: null },
      { tag: 'best', score: 90 },
    ]);
    expect(sum).toEqual({ average: 90, judged: 3, counts: { best: 2, good: 1, unknown: 1 } });
    expect(summarize([]).average).toBeNull();
  });
});
