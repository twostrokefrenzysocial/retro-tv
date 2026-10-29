import { describe, expect, it } from 'vitest';
import {
  EPOCH_MS,
  SECONDS_PER_DAY,
  buildDay,
  dayAirStartMs,
  getNowPlaying,
  getSchedule,
  partCount,
} from '../src/scheduler/index.ts';
import type { Segment } from '../src/scheduler/index.ts';
import { makeChannel, makeItems } from './fixtures.ts';

const DAY_MS = SECONDS_PER_DAY * 1000;
/** Somewhere well past the epoch, so carries have had time to accumulate. */
const SAMPLE_T = EPOCH_MS + 97 * DAY_MS + 13 * 3600_000 + 421_000;

describe('determinism', () => {
  it('produces identical output for identical inputs', () => {
    const a = makeChannel('rerun-central');
    const b = makeChannel('rerun-central');
    expect(JSON.stringify(buildDay(a, 40).segments)).toBe(JSON.stringify(buildDay(b, 40).segments));

    const nowA = getNowPlaying(a, SAMPLE_T);
    const nowB = getNowPlaying(b, SAMPLE_T);
    expect(nowA).toEqual(nowB);
  });

  it('gives different channels different orders', () => {
    const a = buildDay(makeChannel('channel-a'), 5).segments.map((s) => s.identifier);
    const b = buildDay(makeChannel('channel-b'), 5).segments.map((s) => s.identifier);
    expect(a.slice(0, 10)).not.toEqual(b.slice(0, 10));
  });

  it('gives the same channel different orders on different days', () => {
    const channel = makeChannel('rerun-central');
    const d1 = buildDay(channel, 11).segments.map((s) => s.identifier).slice(0, 10);
    const d2 = buildDay(channel, 12).segments.map((s) => s.identifier).slice(0, 10);
    expect(d1).not.toEqual(d2);
  });
});

describe('getNowPlaying', () => {
  it('returns a segment containing the timestamp, with an in-bounds seek', () => {
    const channel = makeChannel('rerun-central');
    const rngSteps = 400;

    for (let i = 0; i < rngSteps; i += 1) {
      const t = EPOCH_MS + Math.floor((i / rngSteps) * 30 * DAY_MS) + i * 997;
      const now = getNowPlaying(channel, t);
      expect(now).not.toBeNull();
      if (!now) continue;

      const { segment, seekSeconds } = now;
      expect(segment.airStartMs).toBeLessThanOrEqual(t);
      expect(t).toBeLessThan(segment.airEndMs);

      expect(seekSeconds).toBeGreaterThanOrEqual(0);
      expect(seekSeconds).toBeLessThan(segment.fileEnd - segment.fileStart);

      const filePos = segment.fileStart + seekSeconds;
      expect(filePos).toBeGreaterThanOrEqual(segment.fileStart);
      expect(filePos).toBeLessThanOrEqual(segment.fileEnd);
      expect(now.endsAtMs).toBe(segment.airEndMs);
    }
  });

  it('reports a next segment that starts exactly when the current one ends', () => {
    const channel = makeChannel('rerun-central');
    const now = getNowPlaying(channel, SAMPLE_T);
    expect(now?.nextSegment).not.toBeNull();
    expect(now?.nextSegment?.airStartMs).toBe(now?.segment.airEndMs);
  });

  it('clamps timestamps before the epoch to the first segment', () => {
    const channel = makeChannel('rerun-central');
    const now = getNowPlaying(channel, EPOCH_MS - 5 * DAY_MS);
    expect(now?.segment.airStartMs).toBe(EPOCH_MS);
  });

  it('returns null for a channel with no items', () => {
    const empty = makeChannel('empty', { items: [] });
    expect(getNowPlaying(empty, SAMPLE_T)).toBeNull();
  });
});

describe('continuity', () => {
  const collect = (slug: string, days: number): Segment[] => {
    const channel = makeChannel(slug);
    const all: Segment[] = [];
    for (let d = 0; d < days; d += 1) all.push(...buildDay(channel, d).segments);
    return all;
  };

  it('has no gaps or overlaps across a full simulated week', () => {
    for (const slug of ['rerun-central', 'midnight-movie', 'ephemera']) {
      const segments = collect(slug, 7);
      expect(segments.length).toBeGreaterThan(50);

      for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i] as Segment;
        expect(seg.airEndMs).toBeGreaterThan(seg.airStartMs);
        expect(seg.airEndMs - seg.airStartMs).toBe((seg.fileEnd - seg.fileStart) * 1000);
        if (i > 0) {
          expect(seg.airStartMs).toBe((segments[i - 1] as Segment).airEndMs);
        }
      }
    }
  });

  it('covers every second of a week with exactly one segment', () => {
    const channel = makeChannel('rerun-central');
    for (let s = 0; s < 7 * SECONDS_PER_DAY; s += 137) {
      const t = EPOCH_MS + s * 1000;
      const now = getNowPlaying(channel, t);
      expect(now, `no segment at +${s}s`).not.toBeNull();
    }
  });

  it('reports a midnight-crossing programme consistently from both sides', () => {
    const channel = makeChannel('midnight-movie');

    for (let day = 1; day < 20; day += 1) {
      const boundary = dayAirStartMs(channel, day);
      // The boundary is where day `day` begins; one ms earlier still belongs
      // to the tail of the previous day's final programme.
      const before = getNowPlaying(channel, boundary - 1);
      const after = getNowPlaying(channel, boundary);
      expect(before).not.toBeNull();
      expect(after).not.toBeNull();
      if (!before || !after) continue;

      expect(before.segment.airEndMs).toBe(boundary);
      expect(after.segment.airStartMs).toBe(boundary);
      expect(before.nextSegment?.identifier).toBe(after.segment.identifier);
      expect(before.nextSegment?.airStartMs).toBe(after.segment.airStartMs);
    }
  });

  it('lets an overrunning programme finish instead of cutting it at midnight', () => {
    const channel = makeChannel('midnight-movie');
    let sawOverrun = false;

    for (let day = 0; day < 20; day += 1) {
      const utcMidnight = EPOCH_MS + (day + 1) * DAY_MS;
      const now = getNowPlaying(channel, utcMidnight - 1000);
      if (now && now.segment.airEndMs > utcMidnight) {
        sawOverrun = true;
        // The same segment is still on air a moment after midnight.
        const after = getNowPlaying(channel, utcMidnight + 500);
        expect(after?.segment.identifier).toBe(now.segment.identifier);
        expect(after?.segment.airStartMs).toBe(now.segment.airStartMs);
      }
    }

    expect(sawOverrun, 'expected at least one programme to run past midnight').toBe(true);
  });

  it('keeps each day anchored near UTC midnight rather than drifting away', () => {
    const channel = makeChannel('rerun-central');
    for (const day of [1, 50, 200, 400]) {
      const carry = dayAirStartMs(channel, day) - (EPOCH_MS + day * DAY_MS);
      expect(carry).toBeGreaterThanOrEqual(0);
      expect(carry).toBeLessThan(4 * 3600_000);
    }
  });
});

describe('commercial breaks', () => {
  it('splits long programmes and inserts 2-4 ads per break', () => {
    const channel = makeChannel('long', {
      items: makeItems('film', 20, 5400, 5400),
      commercials: makeItems('ad', 20, 30, 30),
    });
    const segments = buildDay(channel, 3).segments;

    const first = segments.filter((s) => s.type === 'program' && s.programIndex === 0);
    expect(first.length).toBe(partCount(5400, true));
    expect(first[0]?.fileStart).toBe(0);
    expect(first[first.length - 1]?.fileEnd).toBe(5400);

    // Parts tile the file with no overlap.
    for (let i = 1; i < first.length; i += 1) {
      expect(first[i]?.fileStart).toBe(first[i - 1]?.fileEnd);
    }

    let run = 0;
    const runs: number[] = [];
    for (const seg of segments) {
      if (seg.type === 'commercial') run += 1;
      else if (run > 0) {
        runs.push(run);
        run = 0;
      }
    }
    expect(runs.length).toBeGreaterThan(3);
    for (const r of runs) {
      expect(r).toBeGreaterThanOrEqual(2);
      expect(r).toBeLessThanOrEqual(4);
    }
  });

  it('emits no commercials when the channel has breaks turned off', () => {
    const channel = makeChannel('ephemera', { commercialBreaks: false });
    const segments = buildDay(channel, 2).segments;
    expect(segments.every((s) => s.type === 'program')).toBe(true);
    // Breaks off also means long programmes play unsplit.
    expect(segments.every((s) => s.fileStart === 0)).toBe(true);
  });
});

describe('getSchedule', () => {
  it('returns gapless programme blocks covering the window', () => {
    const channel = makeChannel('rerun-central');
    const from = SAMPLE_T;
    const to = from + 3 * 3600_000;
    const blocks = getSchedule(channel, from, to);

    expect(blocks.length).toBeGreaterThan(1);
    for (let i = 1; i < blocks.length; i += 1) {
      expect(blocks[i]?.airStartMs).toBe(blocks[i - 1]?.airEndMs);
    }
    expect(blocks[0]?.airStartMs).toBeLessThanOrEqual(from);
    expect(blocks[blocks.length - 1]?.airEndMs).toBeGreaterThanOrEqual(to);
  });

  it('collapses commercials into programmes', () => {
    const channel = makeChannel('rerun-central');
    const blocks = getSchedule(channel, SAMPLE_T, SAMPLE_T + 6 * 3600_000);
    const segments = buildDay(channel, 97).segments;
    const adIds = new Set(segments.filter((s) => s.type === 'commercial').map((s) => s.identifier));
    expect(blocks.some((b) => adIds.has(b.identifier))).toBe(false);
  });

  it('agrees with getNowPlaying about what is on', () => {
    const channel = makeChannel('rerun-central');
    const blocks = getSchedule(channel, SAMPLE_T, SAMPLE_T + 3 * 3600_000);
    const live = blocks.find((b) => b.airStartMs <= SAMPLE_T && SAMPLE_T < b.airEndMs);
    const now = getNowPlaying(channel, SAMPLE_T);
    expect(live).toBeDefined();
    if (now?.segment.type === 'program') {
      expect(live?.identifier).toBe(now.segment.identifier);
    }
  });

  it('returns nothing for an empty window or an empty channel', () => {
    const channel = makeChannel('rerun-central');
    expect(getSchedule(channel, SAMPLE_T, SAMPLE_T)).toEqual([]);
    expect(getSchedule(makeChannel('none', { items: [] }), SAMPLE_T, SAMPLE_T + 1000)).toEqual([]);
  });
});

describe('performance', () => {
  it('resolves getNowPlaying for every channel in under 50 ms', () => {
    const slugs = [
      'rerun-central',
      'saturday-morning',
      'midnight-movie',
      'noir-after-dark',
      'feature-presentation',
      'ephemera',
      'silent-screen',
      'laugh-track',
    ];
    // Cold: fresh channel objects, so no memoised carries anywhere.
    const channels = slugs.map((slug) => makeChannel(slug));
    const t = Date.now();

    const started = performance.now();
    for (const channel of channels) getNowPlaying(channel, t);
    const cold = performance.now() - started;

    const warmStart = performance.now();
    for (let i = 0; i < 100; i += 1) {
      for (const channel of channels) getNowPlaying(channel, t + i * 1000);
    }
    const warm = (performance.now() - warmStart) / 100;

    expect(cold, `cold pass took ${cold.toFixed(1)}ms`).toBeLessThan(50);
    expect(warm, `warm pass took ${warm.toFixed(3)}ms`).toBeLessThan(5);
  });
});
