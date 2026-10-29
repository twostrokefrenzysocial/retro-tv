import type { CatalogItem } from '../src/types.ts';
import type { SchedulerChannel } from '../src/scheduler/types.ts';
import { mulberry32 } from '../src/scheduler/prng.ts';

/** Builds a reproducible pretend catalogue so tests never touch the network. */
export function makeItems(prefix: string, count: number, min: number, max: number): CatalogItem[] {
  const rng = mulberry32(0xc0ffee);
  return Array.from({ length: count }, (_, i) => ({
    identifier: `${prefix}-${i}`,
    title: `${prefix} programme ${i}`,
    year: 1950 + (i % 40),
    filename: `${prefix}-${i}.mp4`,
    duration: Math.floor(min + rng() * (max - min)),
    licenseurl: null,
    collection: prefix,
  }));
}

export function makeChannel(slug: string, overrides: Partial<SchedulerChannel> = {}): SchedulerChannel {
  return {
    slug,
    commercialBreaks: true,
    items: makeItems(`${slug}-prog`, 60, 600, 3600),
    commercials: makeItems(`${slug}-ad`, 40, 15, 60),
    ...overrides,
  };
}
