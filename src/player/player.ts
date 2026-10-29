/**
 * Drives the picture. Two <video> elements alternate: one plays while the
 * other buffers whatever is on next, so programmes and commercials butt up
 * against each other without a black frame in between.
 */
import { getNowPlaying } from '../scheduler/index.ts';
import type { NowPlaying, SchedulerChannel, Segment } from '../scheduler/index.ts';
import { streamUrl } from './stream-url.ts';

/** How long a frozen picture is tolerated before we call it a fault. */
const STALL_TIMEOUT_MS = 8_000;
const DRIFT_CHECK_MS = 30_000;
const DRIFT_TOLERANCE_S = 5;
/**
 * Start buffering the next segment this far before the current one ends.
 *
 * Generous because of what is actually being buffered. The cartoon channels
 * stream 25 MB files that are ready in a second, but archive.org's h.264
 * derivative of a feature runs 400 MB to 1.4 GB, and a good few of those are
 * written with the index at the end of the file, so the browser fetches the
 * tail before it can play a frame. Twenty seconds of lead was not enough to
 * swallow that, and the join between programmes was where it showed.
 */
const PRELOAD_LEAD_MS = 60_000;
/** Give up skipping after this many bad segments in a row. */
const MAX_CONSECUTIVE_SKIPS = 5;
/**
 * How long the deck sits on the test card before trying the channel again.
 *
 * Most faults heal by themselves: `afterSegmentStart` always leaves a swap
 * timer pending, so the next programme starts on time whatever happened to
 * this one. A few paths set no timer at all — giving up on skipping, and a
 * `getNowPlaying` that comes back empty — and those used to leave the set
 * dark with nothing scheduled to wake it. This is the way back from those.
 */
const RECOVERY_DELAY_MS = 30_000;

export interface PlayerEvents {
  /** A new segment is on screen. */
  onSegment(now: NowPlaying, channel: SchedulerChannel): void;
  /** Playback is broken; show the test card. */
  onFault(reason: string): void;
  /** Picture is back. */
  onRecover(): void;
  /**
   * The set is waiting on the network rather than showing a programme.
   *
   * A fault this is not: the picture is coming. But a feature can take some
   * seconds to arrive, and a screen that sits black with no explanation
   * reads as broken, so the set says what it is doing.
   */
  onTuning(waiting: boolean): void;
}

interface Loaded {
  identifier: string;
  fileStart: number;
}

export class TvPlayer {
  private readonly videos: [HTMLVideoElement, HTMLVideoElement];
  private readonly events: PlayerEvents;
  private activeIndex: 0 | 1 = 0;
  private loadedOn: [Loaded | null, Loaded | null] = [null, null];

  private channel: SchedulerChannel | null = null;
  private current: NowPlaying | null = null;

  private swapTimer: number | null = null;
  private preloadTimer: number | null = null;
  private driftTimer: number | null = null;
  private watchdog: number | null = null;
  private recoveryTimer: number | null = null;

  private lastPosition = -1;
  private lastProgressAt = 0;
  /** Set once the viewer has started watching, so we know to resume. */
  private shouldBePlaying = false;
  private resumeAttempts = 0;
  private faulted = false;
  /** Consecutive failed segments, to stop a dead channel spinning. */
  private failures = 0;
  private lastFailureAt = 0;
  private volume = 0.8;
  private muted = false;

  constructor(videos: [HTMLVideoElement, HTMLVideoElement], events: PlayerEvents) {
    this.videos = videos;
    this.events = events;
    for (const video of videos) {
      video.playsInline = true;
      video.preload = 'auto';
      // No crossOrigin: archive.org's storage nodes send no CORS headers, and
      // plain playback does not need them. Setting it blocks every request.
      video.addEventListener('error', () => this.handleError(video));
      // Only the element on screen is worth reporting: the standby buffers
      // out of sight for a minute before every swap, and saying so would
      // leave the caption up almost permanently.
      video.addEventListener('waiting', () => {
        if (video === this.active) this.setTuning(true);
      });
      for (const settled of ['playing', 'canplay'] as const) {
        video.addEventListener(settled, () => {
          if (video === this.active) this.setTuning(false);
        });
      }
    }
  }

  private tuning = false;

  private setTuning(waiting: boolean): void {
    if (this.tuning === waiting) return;
    this.tuning = waiting;
    this.events.onTuning(waiting);
  }

  private get active(): HTMLVideoElement {
    return this.videos[this.activeIndex];
  }

  private get standby(): HTMLVideoElement {
    return this.videos[this.activeIndex === 0 ? 1 : 0];
  }

  get nowPlaying(): NowPlaying | null {
    return this.current;
  }

  /** Only the active element is visible; the other buffers out of sight. */
  private markLive(): void {
    this.videos[this.activeIndex].classList.add('is-live');
    this.videos[this.activeIndex === 0 ? 1 : 0].classList.remove('is-live');
  }

  // ------------------------------------------------------------- tuning ---

  tune(channel: SchedulerChannel): void {
    this.shouldBePlaying = true;
    this.resumeAttempts = 0;
    this.channel = channel;
    this.clearTimers();
    this.standby.removeAttribute('src');
    this.loadedOn = [null, null];
    this.start(true);
  }

  stop(): void {
    this.shouldBePlaying = false;
    this.clearTimers();
    this.channel = null;
    this.current = null;
    for (const video of this.videos) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    this.loadedOn = [null, null];
    // A set that is off is not waiting for anything.
    this.setTuning(false);
  }

  /** Loads whatever is live right now into the active element. */
  private start(hard: boolean): void {
    const channel = this.channel;
    if (!channel) return;

    const now = getNowPlaying(channel, Date.now());
    if (!now) {
      this.fault('No schedule for this channel');
      return;
    }

    this.current = now;
    if (hard) this.loadSegment(this.active, now.segment, now.seekSeconds);
    this.afterSegmentStart(now, channel);
  }

  private loadSegment(video: HTMLVideoElement, segment: Segment, seekSeconds: number): void {
    const url = streamUrl(segment.identifier, segment.filename);
    const target = segment.fileStart + seekSeconds;
    const index = video === this.videos[0] ? 0 : 1;
    this.loadedOn[index] = { identifier: segment.identifier, fileStart: segment.fileStart };

    if (video === this.active) this.setTuning(true);

    video.src = url;
    video.volume = this.volume;
    video.muted = this.muted;

    const seek = (): void => {
      // Some archive.org files are MPEG-4 Part 2, which browsers cannot
      // decode. They load, report readyState 4 and play their audio, but
      // have no picture at all -- videoWidth stays 0 and no error fires.
      // Nothing else detects this, so it is checked here.
      if (video.videoWidth === 0 && video.videoHeight === 0) {
        if (video === this.active) {
          this.fault('This programme has no picture the browser can show');
          this.skip();
        }
        return;
      }

      // Seeking before metadata exists is ignored by the browser.
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.min(target, Math.max(0, video.duration - 0.25));
      } else {
        video.currentTime = target;
      }
      if (video === this.active) void video.play().catch(() => undefined);
    };

    video.addEventListener('loadedmetadata', seek, { once: true });
    video.load();
  }

  private afterSegmentStart(now: NowPlaying, channel: SchedulerChannel): void {
    this.markLive();
    this.events.onSegment(now, channel);
    this.resetWatchdog();

    const msUntilEnd = Math.max(0, now.endsAtMs - Date.now());
    this.swapTimer = window.setTimeout(() => this.advance(), msUntilEnd);

    // Buffer the next segment ahead of time so the swap is instant.
    if (now.nextSegment) {
      const lead = Math.max(0, msUntilEnd - PRELOAD_LEAD_MS);
      const next = now.nextSegment;
      this.preloadTimer = window.setTimeout(() => this.preload(next), lead);
    }

    if (this.driftTimer === null) {
      this.driftTimer = window.setInterval(() => this.correctDrift(), DRIFT_CHECK_MS);
    }
    if (this.watchdog === null) {
      this.watchdog = window.setInterval(() => this.checkStall(), 1_000);
    }
  }

  private preload(segment: Segment): void {
    const video = this.standby;
    video.muted = true;
    this.loadSegment(video, segment, 0);
  }

  /** Called when the current segment's air time runs out. */
  private advance(): void {
    const channel = this.channel;
    if (!channel) return;

    const now = getNowPlaying(channel, Date.now());
    if (!now) {
      this.fault('Schedule ended');
      this.scheduleRecovery();
      return;
    }

    this.clearSegmentTimers();
    const standbyIndex = this.activeIndex === 0 ? 1 : 0;
    const ready = this.loadedOn[standbyIndex];
    const standbyElement = this.videos[standbyIndex];
    const standbyMatches =
      ready?.identifier === now.segment.identifier &&
      ready.fileStart === now.segment.fileStart &&
      // A buffered element with no dimensions has no picture; reload instead.
      !(standbyElement.readyState >= 1 && standbyElement.videoWidth === 0);

    if (standbyMatches && now.seekSeconds < 2) {
      // The buffered element is already holding exactly this segment.
      const outgoing = this.active;
      this.activeIndex = standbyIndex;
      const incoming = this.active;
      incoming.muted = this.muted;
      incoming.volume = this.volume;
      void incoming.play().catch(() => undefined);
      outgoing.pause();
      this.current = now;
      this.clearFault();
      this.afterSegmentStart(now, channel);
    } else {
      this.current = now;
      this.loadSegment(this.active, now.segment, now.seekSeconds);
      this.clearFault();
      this.afterSegmentStart(now, channel);
    }
  }

  /** Skips to whatever should be on next, used after a fault. */
  private skip(): void {
    const channel = this.channel;
    if (!channel || !this.current) return;

    // Several failures in quick succession means the channel itself is in
    // trouble, not one bad file. Sit on the test card rather than racing
    // through the whole day's schedule.
    const at = Date.now();
    this.failures = at - this.lastFailureAt < 20_000 ? this.failures + 1 : 1;
    this.lastFailureAt = at;
    if (this.failures > MAX_CONSECUTIVE_SKIPS) {
      this.scheduleRecovery();
      return;
    }

    const after = this.current.endsAtMs;
    const now = getNowPlaying(channel, Math.max(Date.now(), after + 1));
    if (!now) {
      this.scheduleRecovery();
      return;
    }
    this.clearSegmentTimers();
    this.current = now;
    this.loadSegment(this.active, now.segment, now.seekSeconds);
    this.afterSegmentStart(now, channel);
  }

  // ------------------------------------------------- drift and watchdog ---

  private correctDrift(): void {
    const channel = this.channel;
    const current = this.current;
    if (!channel || !current || this.active.paused) return;

    const now = getNowPlaying(channel, Date.now());
    if (!now) return;

    // A different segment should be on: let the normal path handle it.
    if (
      now.segment.identifier !== current.segment.identifier ||
      now.segment.airStartMs !== current.segment.airStartMs
    ) {
      this.advance();
      return;
    }

    const expected = now.segment.fileStart + now.seekSeconds;
    if (Math.abs(this.active.currentTime - expected) > DRIFT_TOLERANCE_S) {
      this.active.currentTime = expected;
    }
  }

  private resetWatchdog(): void {
    this.lastPosition = -1;
    this.lastProgressAt = Date.now();
  }

  private checkStall(): void {
    const video = this.active;
    if (!this.channel) return;

    // The browser can pause us without being asked: power saving, an OS
    // media interruption, the tab being backgrounded. Nothing in here calls
    // pause() on the live element, so if it is paused while the set is on,
    // put it back.
    if (video.paused && this.shouldBePlaying && !video.ended) {
      if (this.resumeAttempts < 5) {
        this.resumeAttempts += 1;
        void video.play().catch(() => undefined);
      }
      return;
    }
    this.resumeAttempts = 0;

    if (video.ended) return;

    if (video.currentTime !== this.lastPosition) {
      this.lastPosition = video.currentTime;
      this.lastProgressAt = Date.now();
      this.failures = 0;
      if (this.faulted) this.clearFault();
      return;
    }

    if (Date.now() - this.lastProgressAt > STALL_TIMEOUT_MS) {
      this.fault('Playback stalled');
      this.skip();
    }
  }

  private handleError(video: HTMLVideoElement): void {
    if (video !== this.active || !this.channel) return;
    this.fault('This programme could not be loaded');
    this.skip();
  }

  /**
   * Comes back to a channel that has been written off down a path that left no
   * timer running. The failure counter is reset first, so the retry gets a
   * full set of skips rather than giving up again on the first bad file.
   */
  private scheduleRecovery(): void {
    if (this.recoveryTimer !== null) return;

    this.recoveryTimer = window.setTimeout(() => {
      this.recoveryTimer = null;
      this.failures = 0;
      this.lastFailureAt = 0;
      if (this.shouldBePlaying && this.channel) this.start(true);
    }, RECOVERY_DELAY_MS);
  }

  private clearRecovery(): void {
    if (this.recoveryTimer !== null) window.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  private fault(reason: string): void {
    // The test card replaces the caption; showing both says the set is
    // loading and broken at the same time.
    this.setTuning(false);
    if (this.faulted) return;
    this.faulted = true;
    this.events.onFault(reason);
  }

  private clearFault(): void {
    if (!this.faulted) return;
    this.faulted = false;
    this.events.onRecover();
  }

  // ------------------------------------------------------------- volume ---

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    for (const video of this.videos) video.volume = this.volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.active.muted = muted;
    this.standby.muted = true;
  }

  // ------------------------------------------------------------- timers ---

  private clearSegmentTimers(): void {
    if (this.swapTimer !== null) window.clearTimeout(this.swapTimer);
    if (this.preloadTimer !== null) window.clearTimeout(this.preloadTimer);
    this.swapTimer = null;
    this.preloadTimer = null;
  }

  private clearTimers(): void {
    this.clearSegmentTimers();
    this.clearRecovery();
    if (this.driftTimer !== null) window.clearInterval(this.driftTimer);
    if (this.watchdog !== null) window.clearInterval(this.watchdog);
    this.driftTimer = null;
    this.watchdog = null;
  }
}
