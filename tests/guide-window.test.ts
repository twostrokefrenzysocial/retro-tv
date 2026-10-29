import { describe, expect, it } from 'vitest';
import { SLOT_MS, WINDOW_MS, placeBlock, slotLabels, windowStart } from '../src/guide/window.ts';

describe('windowStart', () => {
  it('rounds down to the containing half hour', () => {
    const at = Date.UTC(2026, 4, 3, 21, 14, 37, 500);
    expect(new Date(windowStart(at)).toISOString()).toBe('2026-05-03T21:00:00.000Z');
    const later = Date.UTC(2026, 4, 3, 21, 44, 0);
    expect(new Date(windowStart(later)).toISOString()).toBe('2026-05-03T21:30:00.000Z');
  });

  it('is idempotent on an exact boundary', () => {
    const exact = Date.UTC(2026, 4, 3, 21, 30);
    expect(windowStart(exact)).toBe(exact);
  });
});

describe('placeBlock', () => {
  const from = Date.UTC(2026, 4, 3, 21, 0);
  const to = from + WINDOW_MS;

  it('places a block that fits entirely inside', () => {
    const p = placeBlock(from + SLOT_MS, from + 2 * SLOT_MS, from, to);
    expect(p).not.toBeNull();
    expect(p?.left).toBeCloseTo(100 / 6, 6);
    expect(p?.width).toBeCloseTo(100 / 6, 6);
    expect(p?.clippedStart).toBe(false);
    expect(p?.clippedEnd).toBe(false);
  });

  it('clamps a block that starts before the window', () => {
    const p = placeBlock(from - SLOT_MS, from + SLOT_MS, from, to);
    expect(p?.left).toBe(0);
    expect(p?.width).toBeCloseTo(100 / 6, 6);
    expect(p?.clippedStart).toBe(true);
  });

  it('clamps a block that runs past the window', () => {
    const p = placeBlock(to - SLOT_MS, to + 3 * SLOT_MS, from, to);
    expect(p?.width).toBeCloseTo(100 / 6, 6);
    expect((p as { left: number }).left + (p as { width: number }).width).toBeCloseTo(100, 6);
    expect(p?.clippedEnd).toBe(true);
  });

  it('returns null for blocks outside the window', () => {
    expect(placeBlock(from - 2 * SLOT_MS, from - SLOT_MS, from, to)).toBeNull();
    expect(placeBlock(to, to + SLOT_MS, from, to)).toBeNull();
    // Touching the edge exactly is still outside.
    expect(placeBlock(from - SLOT_MS, from, from, to)).toBeNull();
  });

  it('never produces a placement outside 0..100', () => {
    for (let i = -10; i < 20; i += 1) {
      const p = placeBlock(from + i * SLOT_MS, from + (i + 3) * SLOT_MS, from, to);
      if (!p) continue;
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.width).toBeGreaterThan(0);
      expect(p.left + p.width).toBeLessThanOrEqual(100.0001);
    }
  });

  it('tiles a gapless schedule with no gaps or overlaps', () => {
    const edges = [0, 0.7, 1.9, 3.2, 4.1, 6].map((n) => from + n * SLOT_MS);
    let previousRight = 0;
    for (let i = 1; i < edges.length; i += 1) {
      const p = placeBlock(edges[i - 1] as number, edges[i] as number, from, to);
      expect(p).not.toBeNull();
      if (!p) continue;
      expect(p.left).toBeCloseTo(previousRight, 6);
      previousRight = p.left + p.width;
    }
    expect(previousRight).toBeCloseTo(100, 6);
  });
});

describe('slotLabels', () => {
  it('returns one label per half hour, half an hour apart', () => {
    const from = Date.UTC(2026, 4, 3, 21, 0);
    const labels = slotLabels(from);
    expect(labels).toHaveLength(6);
    for (let i = 1; i < labels.length; i += 1) {
      expect((labels[i]?.ms ?? 0) - (labels[i - 1]?.ms ?? 0)).toBe(SLOT_MS);
    }
    expect(labels.every((l) => l.label.length > 0)).toBe(true);
  });
});
