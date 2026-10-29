import { describe, expect, it } from 'vitest';
import { resolveNumber, stepNumber } from '../src/channel-nav.ts';

const LINEUP = [2, 4, 5, 7, 9, 11, 13, 21].map((number) => ({ number }));

describe('resolveNumber', () => {
  it('returns a channel that exists unchanged', () => {
    for (const { number } of LINEUP) {
      expect(resolveNumber(LINEUP, number)).toBe(number);
    }
  });

  it('rounds a gap up to the next real channel', () => {
    expect(resolveNumber(LINEUP, 3)).toBe(4);
    expect(resolveNumber(LINEUP, 6)).toBe(7);
    expect(resolveNumber(LINEUP, 12)).toBe(13);
    expect(resolveNumber(LINEUP, 1)).toBe(2);
  });

  it('wraps past the top of the dial back to the bottom', () => {
    expect(resolveNumber(LINEUP, 22)).toBe(2);
    expect(resolveNumber(LINEUP, 999)).toBe(2);
  });

  it('copes with an empty or single-entry line-up', () => {
    expect(resolveNumber([], 5)).toBeNull();
    expect(resolveNumber([{ number: 9 }], 2)).toBe(9);
  });
});

describe('stepNumber', () => {
  it('moves one place along the dial', () => {
    expect(stepNumber(LINEUP, 2, 1)).toBe(4);
    expect(stepNumber(LINEUP, 7, -1)).toBe(5);
  });

  it('wraps at both ends', () => {
    expect(stepNumber(LINEUP, 21, 1)).toBe(2);
    expect(stepNumber(LINEUP, 2, -1)).toBe(21);
  });

  it('visits every channel exactly once per full lap', () => {
    const seen: number[] = [];
    let at = 2;
    for (let i = 0; i < LINEUP.length; i += 1) {
      seen.push(at);
      at = stepNumber(LINEUP, at, 1) as number;
    }
    expect(seen).toEqual(LINEUP.map((c) => c.number));
    expect(at).toBe(2);
  });

  it('recovers when the current channel has dropped out of the line-up', () => {
    expect(stepNumber(LINEUP, 6, 1)).toBe(7);
    expect(stepNumber([], 5, 1)).toBeNull();
  });
});
