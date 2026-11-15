import { describe, expect, it } from 'vitest';
import type { EngineJudgement } from '../lib/review/engine-results';
import type { ReplyJudgement } from '../lib/review/reply';
import { chanceAfterMoves, evalBar, luckSwing, moveScore, summarize, verdictFor, winChances } from '../lib/review/verdict';

const judged = (grade: EngineJudgement['grade'], loss: number | null): EngineJudgement => ({
  loss,
  grade,
  approximate: false,
  best: [],
  teraGain: null,
  share: 0.05,
  value: 0.5,
  top: 0.6,
  topMove: 'psychic',
  vsReply: null,
  tera: null,
});
const reply = (gap: number): ReplyJudgement => ({ rank: gap === 0 ? 1 : 3, outOf: 4, best: 'x', gap, label: gap < 0.05 ? 'best' : 'poor' });

describe('move score', () => {
  it('falls in a straight line from 100 to 0', () => {
    expect(moveScore(0)).toBe(100);
    expect(moveScore(0.02)).toBe(90);
    expect(moveScore(0.05)).toBe(75);
    expect(moveScore(0.1)).toBe(50);
    expect(moveScore(0.15)).toBe(35);
    expect(moveScore(0.3)).toBe(0);
    expect(moveScore(0.6)).toBe(0);
  });
});

describe('verdict', () => {
  it('keeps the engine grade for a good move and never scores it below its band', () => {
    expect(verdictFor(judged('best', 0.03), null)).toEqual({ tag: 'best', approximate: false, score: 85 });
    expect(verdictFor(judged('good', 0.2), null)).toEqual({ tag: 'good', approximate: false, score: 60 });
  });

  it('calls a move the engine disliked a good prediction when it fit the real reply', () => {
    expect(verdictFor(judged('mistake', 0.12), reply(0)).tag).toBe('good prediction');
    expect(verdictFor(judged('blunder', 0.3), reply(0.02)).score).toBe(70);
  });

  it('keeps the bad grade when the move also failed against the real reply', () => {
    expect(verdictFor(judged('blunder', 0.3), reply(0.8))).toEqual({ tag: 'blunder', approximate: false, score: 0 });
    expect(verdictFor(judged('mistake', 0.12), null).tag).toBe('mistake');
  });

  it('does not touch moves that were not judged or were forced', () => {
    expect(verdictFor(judged('unknown', null), reply(0))).toEqual({ tag: 'unknown', approximate: false, score: null });
    expect(verdictFor(judged('forced', 0), reply(0))).toEqual({ tag: 'forced', approximate: false, score: 100 });
  });
});

describe('eval bar', () => {
  it('turns both sides search values into percentages that add to 100', () => {
    expect(winChances(0.6, 0.4)).toEqual({ p1: 60, p2: 40 });
    expect(winChances(0.5, 0.7)).toEqual({ p1: 40, p2: 60 });
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
      { tag: 'best', approximate: false, score: 100 },
      { tag: 'good', approximate: false, score: 80 },
      { tag: 'unknown', approximate: false, score: null },
      { tag: 'best', approximate: false, score: 90 },
    ]);
    expect(sum).toEqual({ average: 90, judged: 3, approximate: 0, counts: { best: 2, good: 1, unknown: 1 } });
    expect(summarize([]).average).toBeNull();
  });
});

describe('luck swing', () => {
  it('measures the move from the expected chance after both moves to the actual next chance', () => {
    expect(luckSwing(17, 92)).toBe(75);
    expect(luckSwing(60, 52)).toBe(-8);
    expect(luckSwing(null, 50)).toBeNull();
  });

  it('combines both sides values for their played moves', () => {
    expect(chanceAfterMoves(0.17, 0.74)).toBeCloseTo(21.5, 5);
    expect(chanceAfterMoves(null, null)).toBeNull();
    expect(chanceAfterMoves(0.6, null)).toBeCloseTo(60, 5);
  });
});

describe('good prediction from the equal-effort comparison', () => {
  const withReply = (value: number, best: number): EngineJudgement => ({
    ...judged('mistake', 0.12),
    vsReply: { reply: 'switch lokix', value, best, bestMove: 'trickroom' },
  });

  it('applies when the move was within 3 points of the best against the actual reply', () => {
    expect(verdictFor(withReply(0.58, 0.6), null).tag).toBe('good prediction');
  });

  it('does not apply when it trailed the best move against the actual reply', () => {
    expect(verdictFor(withReply(0.4, 0.9), null).tag).toBe('mistake');
  });

  it('takes priority over the older table-based check', () => {
    expect(verdictFor(withReply(0.4, 0.9), reply(0)).tag).toBe('mistake');
  });
});

describe('summary and rough moves', () => {
  it('grades rough-engine moves but leaves them out of the average', () => {
    const sum = summarize([
      { tag: 'best', approximate: false, score: 100 },
      { tag: 'best', approximate: false, score: 90 },
      { tag: 'mistake', approximate: true, score: 4 },
    ]);
    expect(sum.average).toBe(95);
    expect(sum.judged).toBe(2);
    expect(sum.approximate).toBe(1);
    expect(sum.counts).toEqual({ best: 2, mistake: 1 });
  });
});
