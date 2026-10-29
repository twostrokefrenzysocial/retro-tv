/**
 * The television itself: holds the power state, decides what is tuned, and
 * keeps the player, the overlays and the remote in step with each other.
 */
import { Catalog } from './catalog.ts';
import { suggestChannelUrl } from './config.ts';
import { Guide } from './guide/index.ts';
import { TvPlayer } from './player/index.ts';
import { getSchedule } from './scheduler/index.ts';
import type { NowPlaying, SchedulerChannel } from './scheduler/index.ts';
import { loadPrefs, savePrefs } from './state.ts';
import type { Effects, Prefs } from './state.ts';
import type { ChannelSummary } from './types.ts';
import { ToneGenerator } from './ui/audio.ts';
import { Osd } from './ui/osd.ts';
import { Remote } from './ui/remote.ts';
import { HelpOverlay } from './ui/help.ts';
import { SettingsPanel, applyEffects } from './ui/settings.ts';
import { SHELL_HTML } from './ui/shell.ts';
import { StaticScreen } from './ui/static-fx.ts';
import { drawTestCard } from './ui/test-card.ts';

export class RetroTv {
  private readonly root: HTMLElement;
  private readonly catalog: Catalog;
  private readonly prefs: Prefs;

  private tv!: HTMLElement;
  private screen!: HTMLElement;
  private osd!: Osd;
  private player!: TvPlayer;
  private staticScreen!: StaticScreen;
  private remote!: Remote;
  private settings!: SettingsPanel;
  private guide!: Guide;
  private help!: HelpOverlay;
  private readonly tone = new ToneGenerator();

  private currentNumber: number | null = null;
  private previousNumber: number | null = null;
  private powered = false;
  /** Guards against an older tune finishing after a newer one started. */
  private tuneToken = 0;

  private constructor(root: HTMLElement, catalog: Catalog) {
    this.root = root;
    this.catalog = catalog;
    this.prefs = loadPrefs();
  }

  static async mount(root: HTMLElement): Promise<RetroTv> {
    const catalog = await Catalog.load();
    const tv = new RetroTv(root, catalog);
    tv.build();
    return tv;
  }

  private build(): void {
    this.root.innerHTML = SHELL_HTML;
    this.tv = this.root.querySelector('.tv') as HTMLElement;
    this.screen = this.root.querySelector('#screen') as HTMLElement;
    this.osd = new Osd(this.root.querySelector('.osd') as HTMLElement);

    const videos = Array.from(
      this.root.querySelectorAll<HTMLVideoElement>('.picture-video'),
    ) as HTMLVideoElement[];
    this.player = new TvPlayer([videos[0] as HTMLVideoElement, videos[1] as HTMLVideoElement], {
      onSegment: (now, channel) => this.handleSegment(now, channel),
      onFault: (reason) => this.showTestCard(reason),
      onRecover: () => this.hideTestCard(),
      onTuning: (waiting) => this.showTuning(waiting),
    });
    this.player.setVolume(this.prefs.volume);
    this.player.setMuted(this.prefs.muted);

    this.staticScreen = new StaticScreen(this.root.querySelector('.picture-static') as HTMLCanvasElement);
    drawTestCard(this.root.querySelector('.picture-testcard') as HTMLCanvasElement);

    applyEffects(this.tv, this.prefs.effects);
    this.guide = new Guide(
      this.root.querySelector('#guide') as HTMLDialogElement,
      this.catalog,
      {
        tuneTo: (number) => void this.tuneTo(number),
        currentChannel: () => this.currentNumber,
      },
    );

    this.settings = new SettingsPanel(
      this.root.querySelector('#settings') as HTMLDialogElement,
      this.prefs.effects,
      (effects) => this.applySettings(effects),
    );

    this.help = new HelpOverlay(this.root.querySelector('#help') as HTMLDialogElement);

    const suggest = this.root.querySelector<HTMLAnchorElement>('#suggest-channel');
    if (suggest) {
      suggest.href = suggestChannelUrl();
      suggest.target = '_blank';
      suggest.rel = 'noopener noreferrer';
    }

    this.remote = new Remote({
      channelStep: (direction) => this.step(direction),
      channelDirect: (number) => this.tuneTo(number),
      digitsChanged: (digits) => this.osd.showDigits(digits),
      lastChannel: () => this.goBack(),
      toggleInfo: () => this.showInfoNow(),
      volumeStep: (direction) => this.adjustVolume(direction * 0.1),
      toggleMute: () => this.toggleMute(),
      toggleGuide: () => void this.guide.toggle(),
      toggleHelp: () => this.help.toggle(),
      toggleSettings: () => this.settings.toggle(),
      closeOverlays: () => {
        this.guide.close();
        this.settings.close();
        this.help.close();
      },
    });

    (this.root.querySelector('#power-on') as HTMLButtonElement).addEventListener('click', () => {
      void this.powerOn();
    });

    this.remote.listen();

    this.root.querySelector('.tv')?.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('[data-action]');
      if (!(button instanceof HTMLElement)) return;
      this.handleAction(button.dataset['action'] ?? '');
    });

    this.wireKnobs();
  }

  // -------------------------------------------------------------- power ---

  async powerOn(): Promise<void> {
    if (this.powered) return;
    this.powered = true;
    this.tone.resume();
    this.tv.dataset['state'] = 'warming';

    // The CRT line-expand runs while the first channel resolves.
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    this.tv.dataset['state'] = 'on';
    this.remote.attach(this.screen);
    this.updateKnobs();

    const requested = this.requestedChannel();
    const start = this.catalog.resolveNumber(requested ?? this.prefs.lastChannel ?? 0);
    if (start === null) {
      this.showTestCard('No channels available');
      return;
    }
    await this.tuneTo(start, { silent: true });
  }

  powerOff(): void {
    if (!this.powered) return;
    this.powered = false;
    this.remote.detach();
    this.player.stop();
    this.tone.stopTone();
    this.osd.hideInfo();
    this.tv.dataset['state'] = 'off';
    this.updateKnobs();
  }

  /** `?ch=7` tunes straight there once the set is on. */
  private requestedChannel(): number | null {
    const raw = new URLSearchParams(window.location.search).get('ch');
    const value = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  }

  // ------------------------------------------------------------- tuning ---

  async tuneTo(number: number, opts: { silent?: boolean } = {}): Promise<void> {
    if (!this.powered) return;
    const resolved = this.catalog.resolveNumber(number);
    if (resolved === null) {
      this.showTestCard('No channels available');
      return;
    }

    const token = ++this.tuneToken;
    if (!opts.silent) {
      this.tone.hiss(450);
      await this.staticScreen.burst();
      if (token !== this.tuneToken) return;
    }

    let channel: SchedulerChannel | null = await this.catalog.ensure(resolved);
    if (token !== this.tuneToken) return;

    // A channel whose file is missing drops out of the line-up entirely;
    // move along to the next one that works.
    let attempt = resolved;
    let guard = 0;
    while (channel === null && guard < this.catalog.index.channels.length) {
      guard += 1;
      const next = this.catalog.resolveNumber(attempt + 1);
      if (next === null) break;
      attempt = next;
      channel = await this.catalog.ensure(attempt);
      if (token !== this.tuneToken) return;
    }

    if (!channel) {
      this.showTestCard('No channels available');
      return;
    }

    if (this.currentNumber !== null && this.currentNumber !== attempt) {
      this.previousNumber = this.currentNumber;
    }
    this.currentNumber = attempt;
    this.prefs.lastChannel = attempt;
    savePrefs(this.prefs);

    this.hideTestCard();
    this.player.tune(channel);

    const summary = this.catalog.summaryFor(attempt);
    if (summary) this.osd.showChannel(summary);
    this.updateKnobs();
    this.catalog.prefetchNeighbours(attempt);
  }

  private step(direction: 1 | -1): void {
    const from = this.currentNumber;
    if (from === null) return;
    const next = this.catalog.step(from, direction);
    if (next !== null && next !== from) void this.tuneTo(next);
  }

  private goBack(): void {
    if (this.previousNumber !== null) void this.tuneTo(this.previousNumber);
  }

  // ------------------------------------------------------------ display ---

  private handleSegment(now: NowPlaying, channel: SchedulerChannel): void {
    const summary = this.currentNumber === null ? null : this.catalog.summaryFor(this.currentNumber);
    if (!summary) return;

    // Commercials get no overlay; that is the whole joke.
    if (now.segment.type === 'commercial') {
      this.osd.hideInfo();
      return;
    }
    this.osd.showInfo(summary, now, this.upNext(channel, now));
  }

  private upNext(channel: SchedulerChannel, now: NowPlaying): ReturnType<typeof getSchedule>[number] | null {
    const blocks = getSchedule(channel, now.segment.airEndMs, now.segment.airEndMs + 6 * 3600_000);
    return blocks.find((block) => block.airStartMs >= now.segment.airEndMs) ?? null;
  }

  private showInfoNow(): void {
    const now = this.player.nowPlaying;
    const summary = this.currentNumber === null ? null : this.catalog.summaryFor(this.currentNumber);
    if (!now || !summary || now.segment.type === 'commercial') return;
    const channel = this.catalog.summaryFor(summary.number);
    if (!channel) return;
    void this.catalog.ensure(summary.number).then((ch) => {
      if (ch) this.osd.showInfo(summary, now, this.upNext(ch, now));
    });
  }

  private showTestCard(reason: string): void {
    this.tv.dataset['fault'] = 'true';
    this.tv.setAttribute('data-fault-reason', reason);
    if (this.prefs.effects.testTone) this.tone.startTone();
  }

  /** A caption while the set waits on the network, not a fault. */
  private showTuning(waiting: boolean): void {
    if (waiting) this.tv.dataset['tuning'] = 'true';
    else delete this.tv.dataset['tuning'];
  }

  private hideTestCard(): void {
    delete this.tv.dataset['fault'];
    this.tv.removeAttribute('data-fault-reason');
    this.tone.stopTone();
  }

  /** Called whenever a switch in the settings panel moves. */
  private applySettings(effects: Effects): void {
    this.prefs.effects = effects;
    savePrefs(this.prefs);
    applyEffects(this.tv, effects);

    // The tone follows the switch immediately if a fault is on screen.
    const faulted = this.tv.dataset['fault'] === 'true';
    if (faulted && effects.testTone) this.tone.startTone();
    else this.tone.stopTone();
  }

  // ------------------------------------------------------------- volume ---

  private adjustVolume(delta: number): void {
    this.prefs.volume = Math.min(1, Math.max(0, Math.round((this.prefs.volume + delta) * 100) / 100));
    if (this.prefs.volume > 0) this.prefs.muted = false;
    this.player.setVolume(this.prefs.volume);
    this.player.setMuted(this.prefs.muted);
    this.tone.setVolume(this.prefs.volume);
    savePrefs(this.prefs);
    this.osd.showVolume(this.prefs.volume, this.prefs.muted);
    this.updateKnobs();
  }

  private toggleMute(): void {
    this.prefs.muted = !this.prefs.muted;
    this.player.setMuted(this.prefs.muted);
    savePrefs(this.prefs);
    this.osd.showVolume(this.prefs.volume, this.prefs.muted);
  }

  /**
   * The cabinet dials. They were decoration; now they are the controls.
   * Each is a real button, so it is reachable by keyboard and announces
   * itself, and each also responds to the mouse wheel the way a dial
   * responds to being turned.
   */
  private wireKnobs(): void {
    for (const knob of this.root.querySelectorAll<HTMLElement>('[data-knob]')) {
      const kind = knob.dataset['knob'];

      knob.addEventListener('click', () => {
        switch (kind) {
          case 'power':
            if (this.powered) this.powerOff();
            else void this.powerOn();
            break;
          case 'channel':
            this.step(1);
            break;
          case 'volume':
            this.toggleMute();
            break;
          case 'guide':
            void this.guide.toggle();
            break;
          default:
            break;
        }
      });

      knob.addEventListener(
        'wheel',
        (event) => {
          if (kind !== 'channel' && kind !== 'volume') return;
          event.preventDefault();
          const up = event.deltaY < 0;
          if (kind === 'channel') this.step(up ? 1 : -1);
          else this.adjustVolume(up ? 0.1 : -0.1);
        },
        { passive: false },
      );

      // Arrow keys on a focused dial adjust that dial, not the channel.
      knob.addEventListener('keydown', (event) => {
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowUp';
        const back = event.key === 'ArrowLeft' || event.key === 'ArrowDown';
        if (!forward && !back) return;
        event.preventDefault();
        event.stopPropagation();
        if (kind === 'channel') this.step(forward ? 1 : -1);
        else if (kind === 'volume') this.adjustVolume(forward ? 0.1 : -0.1);
      });
    }

    this.updateKnobs();
  }

  /** Turns each dial to match the state it reports. */
  private updateKnobs(): void {
    const setAngle = (kind: string, fraction: number): void => {
      const knob = this.root.querySelector<HTMLElement>(`[data-knob="${kind}"]`);
      // Dials sweep about 270 degrees, like the real thing.
      knob?.style.setProperty('--knob-angle', `${-135 + fraction * 270}deg`);
    };

    const volume = this.prefs.muted ? 0 : this.prefs.volume;
    setAngle('volume', volume);
    const volumeKnob = this.root.querySelector<HTMLElement>('[data-knob="volume"]');
    volumeKnob?.setAttribute('aria-valuenow', String(Math.round(volume * 100)));
    volumeKnob?.setAttribute(
      'aria-valuetext',
      this.prefs.muted ? 'Muted' : `${Math.round(volume * 100)} per cent`,
    );

    const list = this.catalog.channels;
    const index = list.findIndex((c) => c.number === this.currentNumber);
    setAngle('channel', list.length > 1 && index >= 0 ? index / (list.length - 1) : 0);

    const power = this.root.querySelector<HTMLElement>('[data-knob="power"]');
    power?.setAttribute('aria-label', this.powered ? 'Power off' : 'Power on');
    power?.classList.toggle('is-on', this.powered);
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'power':
        this.powerOff();
        break;
      case 'ch-up':
        this.step(1);
        break;
      case 'ch-down':
        this.step(-1);
        break;
      case 'vol-up':
        this.adjustVolume(0.1);
        break;
      case 'vol-down':
        this.adjustVolume(-0.1);
        break;
      case 'mute':
        this.toggleMute();
        break;
      case 'info':
        this.showInfoNow();
        break;
      case 'last':
        this.goBack();
        break;
      case 'guide':
        void this.guide.toggle();
        break;
      case 'settings':
        this.settings.toggle();
        break;
      case 'help':
        this.help.toggle();
        break;
      default:
        break;
    }
  }

  /** Exposed so later phases (guide, what's on) can reuse the loaded data. */
  get channels(): ChannelSummary[] {
    return this.catalog.channels;
  }
}
