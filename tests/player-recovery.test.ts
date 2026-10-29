/**
 * What the deck does when a channel starts failing.
 *
 * Most of the time it heals itself: a pending swap timer starts the next
 * programme on schedule whatever happened to this one. These cover the rest —
 * that a run of bad files does not burn through the day's schedule, that the
 * recovery net fires once rather than piling up, and that switching the set
 * off really does stop it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TvPlayer } from '../src/player/player.ts';
import { makeChannel } from './fixtures.ts';

/** Just enough of an HTMLVideoElement for the deck to drive. */
function fakeVideo(): HTMLVideoElement & { fire(type: string): void } {
  const listeners = new Map<string, Set<() => void>>();

  const video = {
    playsInline: false,
    preload: '',
    src: '',
    currentTime: 0,
    duration: 3600,
    ended: false,
    muted: false,
    volume: 1,
    paused: true,
    readyState: 0,
    videoWidth: 640,
    videoHeight: 480,
    classList: { add(): void {}, remove(): void {} },
    addEventListener(type: string, fn: () => void): void {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener(type: string, fn: () => void): void {
      listeners.get(type)?.delete(fn);
    },
    removeAttribute(name: string): void {
      if (name === 'src') video.src = '';
    },
    load(): void {},
    pause(): void {
      video.paused = true;
    },
    play(): Promise<void> {
      video.paused = false;
      return Promise.resolve();
    },
    fire(type: string): void {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };

  return video as unknown as HTMLVideoElement & { fire(type: string): void };
}

function makeDeck() {
  const videos: [ReturnType<typeof fakeVideo>, ReturnType<typeof fakeVideo>] = [
    fakeVideo(),
    fakeVideo(),
  ];
  const segments: string[] = [];
  const faults: string[] = [];
  const tuning: boolean[] = [];
  let recovered = 0;

  const player = new TvPlayer(videos as never, {
    onSegment: (now) => segments.push(now.segment.identifier),
    onFault: (reason) => faults.push(reason),
    onRecover: () => {
      recovered += 1;
    },
    onTuning: (waiting) => tuning.push(waiting),
  });

  return { player, videos, segments, faults, tuning, recoveredCount: () => recovered };
}

describe('player recovery after a dead channel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The deck reaches for window.*; in node the test globals are the timers.
    (globalThis as { window?: unknown }).window = globalThis;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { window?: unknown }).window;
  });

  it('stops racing through the schedule after a run of failures', () => {
    const { player, videos, segments } = makeDeck();
    player.tune(makeChannel('dead'));
    const startedWith = segments.length;

    // Every file fails the moment it is asked for.
    for (let i = 0; i < 20; i += 1) videos[0].fire('error');

    // Five skips are allowed, not twenty; the day is not burned through.
    expect(segments.length - startedWith).toBeLessThanOrEqual(6);
  });

  it('reports a fault so the viewer sees a test card rather than nothing', () => {
    const { player, videos, faults } = makeDeck();
    player.tune(makeChannel('flaky'));

    for (let i = 0; i < 20; i += 1) videos[0].fire('error');

    expect(faults.length).toBeGreaterThan(0);
  });

  it('keeps the next programme on schedule through a run of failures', () => {
    const { player, videos, segments } = makeDeck();
    player.tune(makeChannel('rough'));

    for (let i = 0; i < 20; i += 1) videos[0].fire('error');
    const whenWrittenOff = segments.length;

    // The swap timer left by the last good start is what carries the channel
    // over; an hour of air time must still produce new programmes.
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(segments.length).toBeGreaterThan(whenWrittenOff);
  });

  it('does not come back after the viewer switches the set off', () => {
    const { player, videos, segments } = makeDeck();
    player.tune(makeChannel('off'));

    for (let i = 0; i < 20; i += 1) videos[0].fire('error');
    player.stop();
    const whenStopped = segments.length;

    vi.advanceTimersByTime(120_000);
    expect(segments.length).toBe(whenStopped);
  });

  it('queues one recovery however many files fail', () => {
    const { player, videos } = makeDeck();
    player.tune(makeChannel('noisy'));

    const before = vi.getTimerCount();
    for (let i = 0; i < 60; i += 1) videos[0].fire('error');

    // Sixty failures must not leave sixty retries pending. The deck runs a
    // handful of timers of its own, so allow for those and no more.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(before + 2);
  });
});

/**
 * The caption that admits the set is waiting on archive.org rather than
 * broken. It only ever reports the element on screen: the standby buffers
 * the next programme for a minute before every swap, and reporting that
 * would leave the caption up almost permanently.
 */
describe('tuning caption', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The deck reaches for window.*; in node the test globals are the timers.
    (globalThis as { window?: unknown }).window = globalThis;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { window?: unknown }).window;
  });

  /**
   * Tuning already raises the caption, because asking archive.org for a file
   * is the wait it exists to describe. Each of these settles the deck into
   * playing first, so what it then asserts is the response to the event and
   * not the leftover state of the tune.
   */
  function playingDeck() {
    const deck = makeDeck();
    deck.player.tune(makeChannel('tuning'));
    deck.videos[0].fire('playing');
    deck.tuning.length = 0;
    return deck;
  }

  it('goes up on the first request for a file', () => {
    const deck = makeDeck();
    deck.player.tune(makeChannel('tuning'));
    expect(deck.tuning).toEqual([true]);
  });

  it('goes up when the active element waits and down when it plays', () => {
    const deck = playingDeck();

    deck.videos[0].fire('waiting');
    expect(deck.tuning).toEqual([true]);

    deck.videos[0].fire('playing');
    expect(deck.tuning).toEqual([true, false]);
  });

  it('does not repeat itself while the wait goes on', () => {
    const deck = playingDeck();

    deck.videos[0].fire('waiting');
    deck.videos[0].fire('waiting');
    deck.videos[0].fire('waiting');
    expect(deck.tuning).toEqual([true]);
  });

  it('ignores the standby element buffering out of sight', () => {
    const deck = playingDeck();

    deck.videos[1].fire('waiting');
    expect(deck.tuning).toEqual([]);
  });

  it('comes down when the set is switched off', () => {
    const deck = playingDeck();

    deck.videos[0].fire('waiting');
    deck.player.stop();
    expect(deck.tuning).toEqual([true, false]);
  });
});
