/**
 * Loads catalogue JSON on demand. Only index.json is fetched up front; a
 * channel's items arrive the first time it is tuned, and neighbours are
 * prefetched quietly in the background.
 */
import { resolveNumber, stepNumber } from './channel-nav.ts';
import { commercialsForEra } from './commercial-pool.ts';
import type { CatalogIndex, CatalogItem, ChannelCatalog, ChannelSummary } from './types.ts';
import type { SchedulerChannel } from './scheduler/index.ts';

const BASE = import.meta.env.BASE_URL;

/** Thrown for a status that may well succeed on a later attempt. */
class TransientError extends Error {}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}catalog/${path}`, { cache: 'no-cache' });
  if (!res.ok) {
    const message = `${res.status} fetching ${path}`;
    throw res.status >= 500 ? new TransientError(message) : new Error(message);
  }
  return (await res.json()) as T;
}

export class Catalog {
  readonly index: CatalogIndex;
  private readonly commercials: CatalogItem[];
  private readonly loaded = new Map<string, SchedulerChannel>();
  private readonly pending = new Map<string, Promise<SchedulerChannel | null>>();
  private readonly broken = new Set<string>();

  private constructor(index: CatalogIndex, commercials: CatalogItem[]) {
    this.index = index;
    this.commercials = commercials;
  }

  static async load(): Promise<Catalog> {
    const index = await fetchJson<CatalogIndex>('index.json');
    // Missing ads are survivable: channels simply run without breaks.
    let commercials: CatalogItem[] = [];
    try {
      commercials = (await fetchJson<{ items: CatalogItem[] }>('commercials.json')).items ?? [];
    } catch (err) {
      console.warn('Retro TV: commercials unavailable, running without breaks.', err);
    }
    return new Catalog(index, commercials);
  }

  /** Channels still believed to be playable, lowest number first. */
  get channels(): ChannelSummary[] {
    return this.index.channels
      .filter((c) => !this.broken.has(c.slug))
      .sort((a, b) => a.number - b.number);
  }

  summaryFor(number: number): ChannelSummary | null {
    return this.channels.find((c) => c.number === number) ?? null;
  }

  /** Nearest valid channel at or after `number`, wrapping around. */
  resolveNumber(number: number): number | null {
    return resolveNumber(this.channels, number);
  }

  step(from: number, direction: 1 | -1): number | null {
    return stepNumber(this.channels, from, direction);
  }

  /**
   * Resolves to the scheduler-ready channel, or null if its file is missing
   * or empty -- in which case the channel is dropped from the line-up.
   */
  ensure(number: number): Promise<SchedulerChannel | null> {
    const summary = this.summaryFor(number);
    if (!summary) return Promise.resolve(null);

    const cached = this.loaded.get(summary.slug);
    if (cached) return Promise.resolve(cached);

    const inFlight = this.pending.get(summary.slug);
    if (inFlight) return inFlight;

    const request = this.fetchChannel(summary).finally(() => {
      this.pending.delete(summary.slug);
    });
    this.pending.set(summary.slug, request);
    return request;
  }

  private async fetchChannel(summary: ChannelSummary): Promise<SchedulerChannel | null> {
    try {
      const data = await fetchJson<ChannelCatalog>(`${summary.slug}.json`);
      const items = (data.items ?? []).filter((item) => item.duration > 0 && item.filename);
      if (items.length === 0) throw new Error('no playable items');

      // Adverts are matched to the channel's era, so a 1958 sitcom never
      // breaks for something from 2004.
      const pool = commercialsForEra(this.commercials, {
        minYear: data.minYear ?? summary.minYear,
        maxYear: data.maxYear ?? summary.maxYear,
      });
      if (pool.relaxed) {
        console.info(
          `Retro TV: no era-matched adverts for ${summary.slug}; using an unmatched pool.`,
        );
      }

      const channel: SchedulerChannel = {
        slug: summary.slug,
        commercialBreaks: summary.commercialBreaks && pool.items.length > 0,
        items,
        commercials: pool.items,
      };
      this.loaded.set(summary.slug, channel);
      return channel;
    } catch (err) {
      // A server hiccup or a dropped connection may clear up; only a missing
      // or empty catalogue takes the channel off the dial for good.
      const transient = err instanceof TransientError || err instanceof TypeError;
      console.warn(
        `Retro TV: channel ${summary.number} (${summary.slug}) unavailable` +
          `${transient ? ', will retry' : ''}.`,
        err,
      );
      if (!transient) this.broken.add(summary.slug);
      return null;
    }
  }

  /**
   * Loads every channel at once, for the guide. Channels whose files are
   * missing resolve to null and are simply left out of the grid.
   */
  async ensureAll(): Promise<{ summary: ChannelSummary; channel: SchedulerChannel }[]> {
    const summaries = this.channels;
    const loaded = await Promise.all(summaries.map((s) => this.ensure(s.number)));
    const rows: { summary: ChannelSummary; channel: SchedulerChannel }[] = [];
    summaries.forEach((summary, i) => {
      const channel = loaded[i];
      if (channel) rows.push({ summary, channel });
    });
    return rows;
  }

  /** Warms the neighbours of `number` without blocking anything. */
  prefetchNeighbours(number: number): void {
    for (const direction of [1, -1] as const) {
      const neighbour = this.step(number, direction);
      if (neighbour !== null && neighbour !== number) void this.ensure(neighbour);
    }
  }
}
