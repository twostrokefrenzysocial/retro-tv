import { describe, expect, it } from 'vitest';
import { commercialsForEra } from '../src/commercial-pool.ts';
import type { CatalogItem } from '../src/types.ts';

function ads(spec: [number | null, number][]): CatalogItem[] {
  const out: CatalogItem[] = [];
  for (const [year, count] of spec) {
    for (let i = 0; i < count; i += 1) {
      out.push({
        identifier: `ad-${year ?? 'x'}-${i}`,
        title: `Advert ${year ?? 'undated'} #${i}`,
        year,
        filename: 'a.mp4',
        duration: 30,
        licenseurl: null,
        collection: 'classic_tv_commercials',
      });
    }
  }
  return out;
}

// Roughly the real shape: thin in the forties, thick in the sixties.
const POOL = ads([[1948, 2], [1955, 30], [1962, 40], [1975, 30], [1988, 30], [2001, 30], [null, 40]]);

describe('commercialsForEra', () => {
  it('returns everything when the channel declares no era', () => {
    expect(commercialsForEra(POOL, {}).items).toHaveLength(POOL.length);
  });

  it('keeps a fifties channel in the fifties', () => {
    const { items, relaxed } = commercialsForEra(POOL, { minYear: 1945, maxYear: 1969 });
    expect(relaxed).toBe(false);
    expect(items.every((i) => (i.year as number) >= 1945 && (i.year as number) <= 1969)).toBe(true);
    expect(items.length).toBe(72); // 1948 + 1955 + 1962
  });

  it('never lets a modern advert into a vintage channel', () => {
    const { items } = commercialsForEra(POOL, { minYear: 1945, maxYear: 1969 });
    expect(items.some((i) => (i.year as number) > 1969)).toBe(false);
    expect(items.some((i) => i.title.includes('2001'))).toBe(false);
  });

  it('widens the window when the exact era is too thin', () => {
    // 1930-1949 has only two adverts; it must reach further to fill breaks.
    const { items, padding, relaxed } = commercialsForEra(POOL, { minYear: 1930, maxYear: 1949 });
    expect(relaxed).toBe(false);
    expect(padding).toBeGreaterThan(0);
    expect(items.length).toBeGreaterThanOrEqual(24);
  });

  it('widens backwards much further than forwards', () => {
    // Reaching back for an older advert is harmless; reaching forward for a
    // newer one is the thing that breaks the illusion.
    const { items, padding } = commercialsForEra(POOL, { minYear: 1930, maxYear: 1949 });
    expect(padding).toBeGreaterThanOrEqual(15);
    // However far it widened, it must not have crept past 1949 + 10.
    expect(Math.max(...items.map((i) => i.year as number))).toBeLessThanOrEqual(1959);
  });

  it('never reaches forward into a later decade, however thin the era', () => {
    const thin = ads([[1935, 3], [1990, 200], [2001, 200]]);
    const { items } = commercialsForEra(thin, { minYear: 1930, maxYear: 1939 });
    // 1990 is more than ten years past 1939, so it must stay out even
    // though taking it would have filled the pool easily.
    expect(items.some((i) => (i.year as number) >= 1990)).toBe(false);
  });

  it('widens only as far as it needs to', () => {
    const narrow = commercialsForEra(POOL, { minYear: 1955, maxYear: 1962 });
    expect(narrow.padding).toBe(0);
  });

  it('prefers undated adverts over wrong-era ones as a last resort', () => {
    const thin = ads([[1800, 1], [null, 30], [2001, 50]]);
    const { items, relaxed } = commercialsForEra(thin, { minYear: 1890, maxYear: 1900 });
    expect(relaxed).toBe(true);
    expect(items.every((i) => i.year === null)).toBe(true);
  });

  it('returns a small correct pool rather than a large wrong one', () => {
    const thin = ads([[1935, 3], [2001, 200]]);
    const { items, relaxed } = commercialsForEra(thin, { minYear: 1930, maxYear: 1939 });
    expect(relaxed).toBe(true);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.year === 1935)).toBe(true);
  });

  it('returns nothing at all rather than a wrong-era advert', () => {
    // The channel then simply runs without commercial breaks.
    const wrongOnly = ads([[2001, 200]]);
    const { items } = commercialsForEra(wrongOnly, { minYear: 1950, maxYear: 1959 });
    expect(items).toHaveLength(0);
  });

  it('handles an open-ended era', () => {
    const { items } = commercialsForEra(POOL, { maxYear: 1969 });
    expect(items.every((i) => (i.year as number) <= 1969)).toBe(true);
  });
});
