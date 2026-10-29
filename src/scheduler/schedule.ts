/**
 * Deterministic broadcast scheduler.
 *
 * Design: the schedule is generated per UTC day. Day N's programme order comes
 * from a PRNG seeded with hash(slug + dayIndex), so every viewer everywhere
 * derives the identical line-up without talking to a server.
 *
 * Continuity across midnight: a programme is never cut off at 00:00 UTC. Day N
 * stops emitting once it has covered `86400 - carryIn` seconds, where `carryIn`
 * is how far day N-1 overran. The overrun of day N then becomes day N+1's
 * carry-in, so consecutive days abut exactly -- no gap, no overlap -- while
 * each day still re-anchors to UTC midnight rather than drifting away from the
 * clock forever.
 *
 * Carries chain back to the epoch, so they are computed once per channel and
 * memoised; everything after the first call is a lookup. The first call costs
 * roughly 1.5us per elapsed day per channel -- about 12ms for all eight
 * channels a year past the epoch, growing linearly after that. If that ever
 * starts to bite, the fix is to persist `carries` per catalogue revision
 * rather than to change the model; the scheduler itself stays pure.
 */
import type { CatalogItem } from '../types.ts';
import { hashString, mulberry32, randomInt, shuffledIndices } from './prng.ts';
import type { NowPlaying, ProgramBlock, Segment, SchedulerChannel } from './types.ts';

export const EPOCH_MS = Date.UTC(2026, 0, 1);
export const SECONDS_PER_DAY = 86_400;

/** Programmes longer than this get an internal commercial break. */
const SEGMENT_TARGET_SECONDS = 25 * 60;
const MAX_PARTS = 6;
const MIN_BREAK_ADS = 2;
const MAX_BREAK_ADS = 4;
/** Stops a malformed catalogue (zero-length items) from spinning forever. */
const MAX_ENTRIES_PER_DAY = 5_000;

const PROGRAM = 0;
const COMMERCIAL = 1;

type EntryKind = typeof PROGRAM | typeof COMMERCIAL;

/**
 * Receives each entry as primitives so the measuring pass allocates nothing.
 */
type EntryVisitor = (
  kind: EntryKind,
  item: CatalogItem,
  fileStart: number,
  fileEnd: number,
  programIndex: number,
) => void;

// ------------------------------------------------------------ deck logic ---

/** Draws from a shuffled deck, reshuffling with a new seed on each wrap. */
class Deck {
  private order: Uint32Array;
  private cursor = 0;
  private pass = 0;

  constructor(
    private readonly items: CatalogItem[],
    private readonly seed: number,
  ) {
    this.order = shuffledIndices(items.length, mulberry32(seed));
  }

  next(): CatalogItem {
    if (this.cursor >= this.order.length) {
      this.pass += 1;
      this.order = shuffledIndices(this.items.length, mulberry32((this.seed + this.pass) >>> 0));
      this.cursor = 0;
    }
    const index = this.order[this.cursor] as number;
    this.cursor += 1;
    return this.items[index] as CatalogItem;
  }
}

/** How many pieces a programme is broken into by its internal breaks. */
export function partCount(duration: number, allowBreaks: boolean): number {
  if (!allowBreaks || duration <= SEGMENT_TARGET_SECONDS) return 1;
  return Math.min(MAX_PARTS, Math.max(2, Math.round(duration / SEGMENT_TARGET_SECONDS)));
}

// ----------------------------------------------------------- day walking ---

/**
 * Emits one broadcast day's entries in order, stopping once `targetSeconds`
 * is covered. Returns the total seconds emitted, which may exceed the target
 * because the final programme is always allowed to finish.
 */
function walkDay(
  channel: SchedulerChannel,
  dayIndex: number,
  targetSeconds: number,
  visit: EntryVisitor | null,
): number {
  if (channel.items.length === 0) return targetSeconds;

  const seed = hashString(`${channel.slug}:${dayIndex}`);
  const programs = new Deck(channel.items, seed);
  const useBreaks = channel.commercialBreaks && channel.commercials.length > 0;
  const ads = useBreaks ? new Deck(channel.commercials, hashString(`${channel.slug}:ads:${dayIndex}`)) : null;
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);

  let elapsed = 0;
  let programIndex = 0;
  let entries = 0;
  let needsBreakFirst = false;

  const emitBreak = (): void => {
    if (!ads) return;
    const count = randomInt(rng, MIN_BREAK_ADS, MAX_BREAK_ADS);
    for (let i = 0; i < count && entries < MAX_ENTRIES_PER_DAY; i += 1) {
      const ad = ads.next();
      if (ad.duration <= 0) continue;
      visit?.(COMMERCIAL, ad, 0, ad.duration, programIndex);
      elapsed += ad.duration;
      entries += 1;
    }
  };

  while (elapsed < targetSeconds && entries < MAX_ENTRIES_PER_DAY) {
    if (needsBreakFirst) emitBreak();

    const item = programs.next();
    if (item.duration <= 0) {
      entries += 1;
      continue;
    }

    const parts = partCount(item.duration, useBreaks);
    for (let p = 0; p < parts; p += 1) {
      const fileStart = Math.floor((item.duration * p) / parts);
      const fileEnd = p === parts - 1 ? item.duration : Math.floor((item.duration * (p + 1)) / parts);
      if (fileEnd <= fileStart) continue;

      visit?.(PROGRAM, item, fileStart, fileEnd, programIndex);
      elapsed += fileEnd - fileStart;
      entries += 1;

      if (p < parts - 1) emitBreak();
    }

    programIndex += 1;
    needsBreakFirst = true;
  }

  return elapsed;
}

// ----------------------------------------------------- carry memoisation ---

interface BuiltDay {
  segments: Segment[];
  airStartMs: number;
  airEndMs: number;
}

interface ChannelState {
  /** carries[n] = seconds day n overran past its share of the clock. */
  carries: number[];
  days: Map<number, BuiltDay>;
}

const stateByChannel = new WeakMap<SchedulerChannel, ChannelState>();

function stateFor(channel: SchedulerChannel): ChannelState {
  let state = stateByChannel.get(channel);
  if (!state) {
    state = { carries: [], days: new Map() };
    stateByChannel.set(channel, state);
  }
  return state;
}

/** Seconds day `dayIndex` runs past midnight, carried into the next day. */
function carryOut(channel: SchedulerChannel, dayIndex: number): number {
  const state = stateFor(channel);
  const { carries } = state;

  for (let n = carries.length; n <= dayIndex; n += 1) {
    const carryIn = n === 0 ? 0 : (carries[n - 1] as number);
    const target = SECONDS_PER_DAY - carryIn;
    const emitted = walkDay(channel, n, target, null);
    carries[n] = emitted - target;
  }

  return carries[dayIndex] as number;
}

function carryIn(channel: SchedulerChannel, dayIndex: number): number {
  return dayIndex <= 0 ? 0 : carryOut(channel, dayIndex - 1);
}

/** Wall-clock moment day `dayIndex` goes on air. */
export function dayAirStartMs(channel: SchedulerChannel, dayIndex: number): number {
  return EPOCH_MS + (dayIndex * SECONDS_PER_DAY + carryIn(channel, dayIndex)) * 1000;
}

// ------------------------------------------------------------- day build ---

export function buildDay(channel: SchedulerChannel, dayIndex: number): BuiltDay {
  const state = stateFor(channel);
  const cached = state.days.get(dayIndex);
  if (cached) return cached;

  const start = dayAirStartMs(channel, dayIndex);
  const segments: Segment[] = [];
  let cursorMs = start;

  walkDay(
    channel,
    dayIndex,
    SECONDS_PER_DAY - carryIn(channel, dayIndex),
    (kind, item, fileStart, fileEnd, programIndex) => {
      const airStartMs = cursorMs;
      const airEndMs = airStartMs + (fileEnd - fileStart) * 1000;
      cursorMs = airEndMs;
      segments.push({
        type: kind === PROGRAM ? 'program' : 'commercial',
        identifier: item.identifier,
        title: item.title,
        year: item.year,
        filename: item.filename,
        fileStart,
        fileEnd,
        airStartMs,
        airEndMs,
        programIndex,
      });
    },
  );

  const day: BuiltDay = { segments, airStartMs: start, airEndMs: cursorMs };

  // Keep only a short window of days; the guide never looks far from "now".
  if (state.days.size > 8) {
    const oldest = Math.min(...state.days.keys());
    state.days.delete(oldest);
  }
  state.days.set(dayIndex, day);
  return day;
}

/** Which broadcast day is on air at `timestampMs`. */
export function dayIndexAt(channel: SchedulerChannel, timestampMs: number): number {
  const elapsed = Math.max(0, timestampMs - EPOCH_MS);
  const guess = Math.floor(elapsed / (SECONDS_PER_DAY * 1000));
  // Days start at midnight plus a non-negative carry, so `guess` is either
  // right or one day too far ahead.
  return guess > 0 && timestampMs < dayAirStartMs(channel, guess) ? guess - 1 : guess;
}

// ------------------------------------------------------------ public API ---

export function getNowPlaying(channel: SchedulerChannel, timestampMs: number): NowPlaying | null {
  if (channel.items.length === 0) return null;

  const t = Math.max(timestampMs, EPOCH_MS);
  const dayIndex = dayIndexAt(channel, t);
  const day = buildDay(channel, dayIndex);

  const index = findSegmentIndex(day.segments, t);
  if (index === -1) return null;

  const segment = day.segments[index] as Segment;
  const next = day.segments[index + 1] ?? buildDay(channel, dayIndex + 1).segments[0] ?? null;

  const span = segment.fileEnd - segment.fileStart;
  const seekSeconds = Math.min(Math.max(0, (t - segment.airStartMs) / 1000), Math.max(0, span - 0.001));

  return { segment, seekSeconds, endsAtMs: segment.airEndMs, nextSegment: next };
}

function findSegmentIndex(segments: Segment[], t: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = segments[mid] as Segment;
    if (t < seg.airStartMs) hi = mid - 1;
    else if (t >= seg.airEndMs) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Programme blocks overlapping [fromMs, toMs), with commercials folded into
 * the programme they follow so the guide grid has no holes in it.
 */
export function getSchedule(
  channel: SchedulerChannel,
  fromMs: number,
  toMs: number,
): ProgramBlock[] {
  if (channel.items.length === 0 || toMs <= fromMs) return [];

  const firstDay = dayIndexAt(channel, Math.max(fromMs, EPOCH_MS));
  const lastDay = dayIndexAt(channel, Math.max(toMs, EPOCH_MS));
  const blocks: ProgramBlock[] = [];

  // Walk day by day so `programIndex`, which restarts each day, stays unambiguous.
  for (let d = firstDay; d <= lastDay + 1; d += 1) {
    let current: ProgramBlock | null = null;
    let currentProgram = -1;

    for (const segment of buildDay(channel, d).segments) {
      if (segment.type === 'program' && segment.programIndex !== currentProgram) {
        current = {
          identifier: segment.identifier,
          title: segment.title,
          year: segment.year,
          airStartMs: segment.airStartMs,
          airEndMs: segment.airEndMs,
        };
        currentProgram = segment.programIndex;
        blocks.push(current);
      } else if (current) {
        // Later parts of the same programme, and the ads between them,
        // extend the block rather than starting a new one.
        current.airEndMs = segment.airEndMs;
      }
    }
  }

  return blocks.filter((block) => block.airEndMs > fromMs && block.airStartMs < toMs);
}

/** Drops memoised state, e.g. after the catalogue is reloaded. */
export function resetScheduler(channel: SchedulerChannel): void {
  stateByChannel.delete(channel);
}
