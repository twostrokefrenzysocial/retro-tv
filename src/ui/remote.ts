/**
 * Everything that counts as "pressing a button": the keyboard, the on-screen
 * remote, the mouse wheel and swipes. Direct channel entry behaves like a
 * real remote -- digits accumulate, then tune on a pause or on Enter.
 */
const DIGIT_TIMEOUT_MS = 1_500;
const SWIPE_THRESHOLD_PX = 50;

export interface RemoteHandlers {
  channelStep(direction: 1 | -1): void;
  channelDirect(number: number): void;
  digitsChanged(digits: string): void;
  lastChannel(): void;
  toggleInfo(): void;
  volumeStep(direction: 1 | -1): void;
  toggleMute(): void;
  toggleGuide(): void;
  toggleHelp(): void;
  toggleSettings(): void;
  /** Dismiss whatever overlay is up. */
  closeOverlays(): void;
}

export class Remote {
  private digits = '';
  private digitTimer = 0;
  private touchStartY: number | null = null;
  private enabled = false;

  constructor(private readonly handlers: RemoteHandlers) {}

  /** Listens from the start; `enabled` gates everything but Escape and "?". */
  listen(): void {
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Wired up fully once the set is on. */
  attach(screen: HTMLElement): void {
    this.enabled = true;
    screen.addEventListener('wheel', this.onWheel, { passive: true });
    screen.addEventListener('touchstart', this.onTouchStart, { passive: true });
    screen.addEventListener('touchend', this.onTouchEnd, { passive: true });
  }

  detach(): void {
    this.enabled = false;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // These two work whether or not the set is on.
    const alwaysLive = event.key === 'Escape' || event.key === '?';
    if (!this.enabled && !alwaysLive) return;

    const { key } = event;
    const h = this.handlers;

    // Escape is handled here rather than left to <dialog>, because the
    // native close watcher only fires while focus is inside the dialog --
    // one stray click on the page and Escape would stop working. It is
    // checked before the form-control guard below, since focus sits on a
    // checkbox whenever the settings panel is open.
    if (key === 'Escape') {
      h.closeOverlays();
      return;
    }

    const target = event.target as HTMLElement | null;
    // Never swallow typing in a real control.
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    if (key >= '0' && key <= '9') {
      event.preventDefault();
      this.pushDigit(key);
      return;
    }

    switch (key) {
      case 'ArrowUp':
        event.preventDefault();
        h.channelStep(1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        h.channelStep(-1);
        break;
      case 'Enter':
        if (this.digits) {
          event.preventDefault();
          this.commitDigits();
        }
        break;
      case 'Backspace':
      case 'l':
      case 'L':
        event.preventDefault();
        h.lastChannel();
        break;
      case 'i':
      case 'I':
        event.preventDefault();
        h.toggleInfo();
        break;
      case 'ArrowRight':
      case '+':
      case '=':
        event.preventDefault();
        h.volumeStep(1);
        break;
      case 'ArrowLeft':
      case '-':
      case '_':
        event.preventDefault();
        h.volumeStep(-1);
        break;
      case 'm':
      case 'M':
        event.preventDefault();
        h.toggleMute();
        break;
      case 'g':
      case 'G':
        event.preventDefault();
        h.toggleGuide();
        break;
      case 's':
      case 'S':
        event.preventDefault();
        h.toggleSettings();
        break;
      case '?':
        event.preventDefault();
        h.toggleHelp();
        break;
      default:
        break;
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    this.handlers.channelStep(event.deltaY < 0 ? 1 : -1);
  };

  private readonly onTouchStart = (event: TouchEvent): void => {
    this.touchStartY = event.touches[0]?.clientY ?? null;
  };

  private readonly onTouchEnd = (event: TouchEvent): void => {
    const start = this.touchStartY;
    const end = event.changedTouches[0]?.clientY;
    this.touchStartY = null;
    if (start === null || end === undefined) return;
    const delta = start - end;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    this.handlers.channelStep(delta > 0 ? 1 : -1);
  };

  private pushDigit(digit: string): void {
    this.digits = (this.digits + digit).slice(-3);
    this.handlers.digitsChanged(this.digits);
    window.clearTimeout(this.digitTimer);
    this.digitTimer = window.setTimeout(() => this.commitDigits(), DIGIT_TIMEOUT_MS);
  }

  private commitDigits(): void {
    window.clearTimeout(this.digitTimer);
    const value = Number.parseInt(this.digits, 10);
    this.digits = '';
    this.handlers.digitsChanged('');
    if (Number.isFinite(value)) this.handlers.channelDirect(value);
  }
}
