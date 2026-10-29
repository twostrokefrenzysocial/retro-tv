/**
 * Picks the commercials that belong on a given channel.
 *
 * An advert from 2004 in the middle of a 1958 sitcom breaks the illusion
 * completely, so each channel draws from its own era. Television advertising
 * barely existed before about 1948, though, and the archive's coverage is
 * patchy, so the window widens in steps until there is enough material to
 * make a varied break rather than the same four adverts all day.
 */
import type { CatalogItem } from './types.ts';

/** Below this, breaks become repetitive enough to notice. */
const MIN_POOL = 24;
/** Years of slack to add on each attempt. */
const WIDENING_STEPS = [0, 15, 30, 60];
/**
 * Widening is deliberately lopsided. An advert older than the programme
 * passes without comment; a newer one is exactly the jarring note we are
 * trying to avoid, so the window barely reaches forwards at all.
 */
const MAX_FORWARD_SLACK = 10;

export interface Era {
  minYear?: number | undefined;
  maxYear?: number | undefined;
}

export interface PoolResult {
  items: CatalogItem[];
  /** Years of slack that were needed, for logging. */
  padding: number;
  /** True when era matching had to be abandoned. */
  relaxed: boolean;
}

export function commercialsForEra(all: CatalogItem[], era: Era): PoolResult {
  const { minYear, maxYear } = era;

  if (minYear === undefined && maxYear === undefined) {
    return { items: all, padding: 0, relaxed: false };
  }

  const dated = all.filter((item) => item.year !== null);
  let widest: CatalogItem[] = [];

  for (const padding of WIDENING_STEPS) {
    const low = minYear === undefined ? -Infinity : minYear - padding;
    const high =
      maxYear === undefined ? Infinity : maxYear + Math.min(padding, MAX_FORWARD_SLACK);
    const matched = dated.filter(
      (item) => (item.year as number) >= low && (item.year as number) <= high,
    );
    if (matched.length >= MIN_POOL) {
      return { items: matched, padding, relaxed: false };
    }
    widest = matched;
  }

  // Era matching could not fill a varied pool. Everything below is a
  // compromise, but never a wrong-era advert: dropping the illusion is the
  // one outcome worse than a short break or no break at all.
  const undated = all.filter((item) => item.year === null);
  if (undated.length >= MIN_POOL) {
    return { items: undated, padding: 0, relaxed: true };
  }

  // A handful of correct adverts, repeated, still beats a modern one.
  if (widest.length > 0) {
    return { items: widest, padding: 0, relaxed: true };
  }

  // Nothing suitable exists. The channel simply runs without breaks.
  return { items: undated, padding: 0, relaxed: true };
}
