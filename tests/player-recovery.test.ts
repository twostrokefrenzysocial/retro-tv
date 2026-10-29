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
  let recovered = 0;

  const player = new TvPlayer(videos as never, {
    onSegment: (now) => segments.push(now.segment.identifier),
    onFault: (reason) => faults.push(reason),
    onRecover: () => {
      recovered += 1;
    },
  });

  return { player, videos, segments, faults, recoveredCount: () => recovered };
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
