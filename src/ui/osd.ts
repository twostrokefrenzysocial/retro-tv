/**
 * The on-screen display: channel number, info bar and volume, in the style
 * of a set-top box from about 1994.
 */
import { detailsUrl } from '../player/index.ts';
import type { NowPlaying, ProgramBlock } from '../scheduler/index.ts';
import type { ChannelSummary } from '../types.ts';

const CHANNEL_MS = 3_000;
const INFO_MS = 5_000;
const VOLUME_MS = 1_800;

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export class Osd {
  private readonly channelEl: HTMLElement;
  private readonly infoEl: HTMLElement;
  private readonly volumeEl: HTMLElement;
  private readonly digitsEl: HTMLElement;
  private readonly progressEl: HTMLElement;

  private channelTimer = 0;
  private infoTimer = 0;
  private volumeTimer = 0;
  private progressRaf = 0;
  private activeInfo: { now: NowPlaying } | null = null;

  constructor(root: HTMLElement) {
    this.channelEl = root.querySelector('.osd-channel') as HTMLElement;
    this.infoEl = root.querySelector('.osd-info') as HTMLElement;
    this.volumeEl = root.querySelector('.osd-volume') as HTMLElement;
    this.digitsEl = root.querySelector('.osd-digits') as HTMLElement;
    this.progressEl = this.infoEl.querySelector('.osd-progress-fill') as HTMLElement;
  }

  showChannel(summary: ChannelSummary): void {
    this.channelEl.textContent = String(summary.number);
    this.channelEl.setAttribute('aria-label', `Channel ${summary.number}, ${summary.name}`);
    this.flash(this.channelEl, 'channelTimer', CHANNEL_MS);
  }

  /** The bottom bar: what this is, how far in, and what follows. */
  showInfo(summary: ChannelSummary, now: NowPlaying, upNext: ProgramBlock | null): void {
    const segment = now.segment;
    const isAd = segment.type === 'commercial';

    const title = this.infoEl.querySelector('.osd-title') as HTMLElement;
    const channelName = this.infoEl.querySelector('.osd-channel-name') as HTMLElement;
    const next = this.infoEl.querySelector('.osd-next') as HTMLElement;
    const link = this.infoEl.querySelector('.osd-source') as HTMLAnchorElement;

    channelName.textContent = `${summary.number}  ${summary.name}`;
    title.textContent = isAd
      ? 'Commercial break'
      : `${segment.title}${segment.year ? `  (${segment.year})` : ''}`;

    link.href = detailsUrl(segment.identifier);
    link.hidden = isAd;
    link.textContent = 'View on archive.org';

    next.textContent = upNext
      ? `Up next  ${clockTime(upNext.airStartMs)}  ${upNext.title}`
      : '';

    this.activeInfo = { now };
    this.flash(this.infoEl, 'infoTimer', INFO_MS);
    this.tickProgress();
  }

  showVolume(level: number, muted: boolean): void {
    const bars = this.volumeEl.querySelector('.osd-bars') as HTMLElement;
    const label = this.volumeEl.querySelector('.osd-volume-label') as HTMLElement;
    const filled = muted ? 0 : Math.round(level * 10);

    label.textContent = muted ? 'MUTE' : 'VOL';
    bars.replaceChildren(
      ...Array.from({ length: 10 }, (_, i) => {
        const bar = document.createElement('span');
        bar.className = i < filled ? 'osd-bar is-on' : 'osd-bar';
        return bar;
      }),
    );
    this.volumeEl.setAttribute(
      'aria-label',
      muted ? 'Muted' : `Volume ${Math.round(level * 100)} percent`,
    );
    this.flash(this.volumeEl, 'volumeTimer', VOLUME_MS);
  }

  showDigits(digits: string): void {
    this.digitsEl.textContent = digits;
    this.digitsEl.classList.toggle('is-visible', digits.length > 0);
  }

  hideInfo(): void {
    this.infoEl.classList.remove('is-visible');
    this.activeInfo = null;
  }

  private tickProgress(): void {
    cancelAnimationFrame(this.progressRaf);
    const step = (): void => {
      const active = this.activeInfo;
      if (!active || !this.infoEl.classList.contains('is-visible')) return;
      const { segment } = active.now;
      const span = segment.airEndMs - segment.airStartMs;
      const done = span > 0 ? (Date.now() - segment.airStartMs) / span : 0;
      this.progressEl.style.width = `${Math.min(100, Math.max(0, done * 100))}%`;
      this.progressRaf = requestAnimationFrame(step);
    };
    this.progressRaf = requestAnimationFrame(step);
  }

  private flash(el: HTMLElement, key: 'channelTimer' | 'infoTimer' | 'volumeTimer', ms: number): void {
    el.classList.add('is-visible');
    window.clearTimeout(this[key]);
    this[key] = window.setTimeout(() => {
      el.classList.remove('is-visible');
      if (key === 'infoTimer') this.activeInfo = null;
    }, ms);
  }
}
