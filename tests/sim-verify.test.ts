import { describe, expect, it } from 'vitest';
import { comparableLines, firstDifference } from '../scripts/verify-sim';

describe('comparableLines', () => {
  it('keeps events that can be compared and drops the rest', () => {
    const log = ['|t:|123', '|chat|x|hi', '|move|p1a: A|Tackle|p2a: B', '|-damage|p2a: B|50/100', '|turn|2'].join('\n');
    expect(comparableLines(log)).toEqual(['|move|p1a: A|Tackle|p2a: B', '|turn|2']);
  });

  it('drops the HP field from switch lines so percentages and exact HP agree', () => {
    expect(comparableLines('|switch|p1a: A|A, L80, M|100/100')).toEqual(comparableLines('|switch|p1a: A|A, L80, M|250/250'));
    expect(comparableLines('|switch|p1a: A|A, L80, M|100/100')).toEqual(['|switch|p1a: A|A, L80, M']);
  });
});

describe('firstDifference', () => {
  it('returns null for identical logs', () => {
    expect(firstDifference(['a', 'b'], ['a', 'b'])).toBeNull();
  });

  it('reports the first differing position', () => {
    expect(firstDifference(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual({ index: 1, expected: 'b', actual: 'x' });
  });

  it('reports a shorter log as ending early', () => {
    expect(firstDifference(['a', 'b'], ['a'])).toEqual({ index: 1, expected: 'b', actual: '(end of log)' });
  });
});
