/**
 * The programme guide, in the manner of the cable preview channels of the
 * early nineties: a grid of half-hour columns over a deep blue field, with
 * the line-up down the left. Original design; no broadcaster branding.
 */
import type { Catalog } from '../catalog.ts';
import { detailsUrl } from '../player/index.ts';
import { getSchedule } from '../scheduler/index.ts';
import type { ProgramBlock, SchedulerChannel } from '../scheduler/index.ts';
import type { ChannelSummary } from '../types.ts';
import { prefersReducedMotion } from '../ui/motion.ts';
import { SLOT_COUNT, WINDOW_MS, placeBlock, slotLabels, windowStart } from './window.ts';

/** How long the viewer must sit still before the grid starts scrolling. */
const IDLE_BEFORE_SCROLL_MS = 20_000;
const SCROLL_PIXELS_PER_SECOND = 14;
/** Pointer jitter below this many pixels does not count as activity. */
const POINTER_DEADZONE_PX = 8;
const REFRESH_MS = 30_000;

export interface GuideCallbacks {
  tuneTo(channelNumber: number): void;
  currentChannel(): number | null;
}

interface Cell {
  button: HTMLButtonElement;
  block: ProgramBlock;
  channelNumber: number;
  live: boolean;
}

export class Guide {
  private readonly dialog: HTMLDialogElement;
  private readonly catalog: Catalog;
  private readonly callbacks: GuideCallbacks;

  private rows: { summary: ChannelSummary; channel: SchedulerChannel }[] = [];
  private cells: Cell[][] = [];
  private focusRow = 0;
  private focusCol = 0;

  private from = 0;
  private idleTimer = 0;
  private refreshTimer = 0;
  private scrollFrame = 0;
  private scrollOffset = 0;
  private autoScrolling = false;
  /** Discards a listings load that finishes after the guide was closed. */
  private openToken = 0;
  private lastPointer: { x: number; y: number } | null = null;

  constructor(dialog: HTMLDialogElement, catalog: Catalog, callbacks: GuideCallbacks) {
    this.dialog = dialog;
    this.catalog = catalog;
    this.callbacks = callbacks;

    this.dialog.addEventListener('close', () => this.teardown());
    this.dialog.addEventListener('keydown', (e) => this.onKeyDown(e));
    for (const event of ['pointerdown', 'wheel'] as const) {
      this.dialog.addEventListener(event, () => this.noteActivity(), { passive: true });
    }
    // A resting mouse still emits the odd pointermove; only treat real
    // movement as activity, or the grid would never settle enough to scroll.
    this.dialog.addEventListener(
      'pointermove',
      (e) => {
        const last = this.lastPointer;
        if (last && Math.hypot(e.clientX - last.x, e.clientY - last.y) < POINTER_DEADZONE_PX) return;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.noteActivity();
      },
      { passive: true },
    );

    this.dialog.querySelector('[data-guide="close"]')?.addEventListener('click', () => {
      this.dialog.close();
    });

    // Clicking the darkened area outside the panel dismisses it, which is
    // what most people try first.
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  async toggle(): Promise<void> {
    if (this.dialog.open) this.dialog.close();
    else await this.open();
  }

  async open(): Promise<void> {
    if (this.dialog.open) return;
    const token = ++this.openToken;
    this.dialog.showModal();
    this.setStatus('Loading the listings…');

    const rows = await this.catalog.ensureAll();
    // Closed, or reopened, while the listings were in flight.
    if (token !== this.openToken || !this.dialog.open) return;

    this.rows = rows;
    if (this.rows.length === 0) {
      this.setStatus('No listings are available right now. Please try again.');
      return;
    }

    this.setStatus('');
    this.render();
    this.focusFirstLive();
    this.noteActivity();
    this.refreshTimer = window.setInterval(() => this.refreshIfStale(), REFRESH_MS);
  }

  private setStatus(message: string): void {
    const status = this.dialog.querySelector('.guide-status') as HTMLElement;
    status.textContent = message;
    status.hidden = message === '';
  }

  // ------------------------------------------------------------ rendering ---

  private render(): void {
    const now = Date.now();
    this.from = windowStart(now);
    const to = this.from + WINDOW_MS;

    const head = this.dialog.querySelector('.guide-times') as HTMLElement;
    head.replaceChildren(
      ...slotLabels(this.from).map((slot) => {
        const cell = document.createElement('div');
        cell.className = 'guide-time';
        cell.style.width = `${100 / SLOT_COUNT}%`;
        cell.textContent = slot.label;
        return cell;
      }),
    );

    const body = this.dialog.querySelector('.guide-rows') as HTMLElement;
    const current = this.callbacks.currentChannel();
    this.cells = [];
    body.replaceChildren();

    for (const { summary, channel } of this.rows) {
      const row = document.createElement('div');
      row.className = 'guide-row';
      if (summary.number === current) row.classList.add('is-tuned');

      const label = document.createElement('div');
      label.className = 'guide-channel';
      label.innerHTML =
        `<span class="guide-channel-number">${summary.number}</span>` +
        `<span class="guide-channel-name"></span>`;
      (label.querySelector('.guide-channel-name') as HTMLElement).textContent = summary.name;
      row.append(label);

      const track = document.createElement('div');
      track.className = 'guide-track';

      const rowCells: Cell[] = [];
      for (const block of getSchedule(channel, this.from, to)) {
        const place = placeBlock(block.airStartMs, block.airEndMs, this.from, to);
        if (!place || place.width <= 0) continue;

        const live = block.airStartMs <= now && now < block.airEndMs;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'guide-program';
        if (live) button.classList.add('is-live');
        button.style.left = `${place.left}%`;
        button.style.width = `${place.width}%`;
        button.tabIndex = -1;

        const title = document.createElement('span');
        title.className = 'guide-program-title';
        title.textContent = place.clippedStart ? `◀ ${block.title}` : block.title;
        button.append(title);

        const when = new Date(block.airStartMs).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        });
        button.setAttribute(
          'aria-label',
          `${block.title}${block.year ? `, ${block.year}` : ''}, ${when}, ` +
            `channel ${summary.number} ${summary.name}` +
            `${live ? ', on now, press Enter to watch' : ', press Enter for details'}`,
        );

        button.addEventListener('click', () => this.activate(summary.number, block, live));
        track.append(button);
        rowCells.push({ button, block, channelNumber: summary.number, live });
      }

      row.append(track);
      body.append(row);
      this.cells.push(rowCells);
    }

    this.drawNowMarker();
  }

  /** The vertical line showing the present moment. */
  private drawNowMarker(): void {
    const marker = this.dialog.querySelector('.guide-now') as HTMLElement;
    const progress = (Date.now() - this.from) / WINDOW_MS;
    if (progress < 0 || progress > 1) {
      marker.hidden = true;
      return;
    }
    marker.hidden = false;
    marker.style.left = `${progress * 100}%`;
  }

  /** Rebuilds when the clock rolls into a new half hour. */
  private refreshIfStale(): void {
    if (!this.dialog.open) return;
    if (windowStart(Date.now()) !== this.from) {
      const row = this.focusRow;
      const col = this.focusCol;
      this.render();
      this.focusCell(Math.min(row, this.cells.length - 1), col);
    } else {
      this.drawNowMarker();
      this.markLiveCells();
    }
  }

  private markLiveCells(): void {
    const now = Date.now();
    for (const row of this.cells) {
      for (const cell of row) {
        const live = cell.block.airStartMs <= now && now < cell.block.airEndMs;
        cell.live = live;
        cell.button.classList.toggle('is-live', live);
      }
    }
  }

  // --------------------------------------------------------- interaction ---

  private activate(channelNumber: number, block: ProgramBlock, live: boolean): void {
    this.noteActivity();
    if (live) {
      this.dialog.close();
      this.callbacks.tuneTo(channelNumber);
      return;
    }
    this.showDetails(channelNumber, block);
  }

  /** Future programmes get a detail panel rather than tuning the set. */
  private showDetails(channelNumber: number, block: ProgramBlock): void {
    const panel = this.dialog.querySelector('.guide-details') as HTMLElement;
    const summary = this.rows.find((r) => r.summary.number === channelNumber)?.summary;
    const when = new Date(block.airStartMs).toLocaleString([], {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });

    panel.hidden = false;
    (panel.querySelector('.guide-details-title') as HTMLElement).textContent =
      `${block.title}${block.year ? ` (${block.year})` : ''}`;
    (panel.querySelector('.guide-details-meta') as HTMLElement).textContent =
      `${when} · Channel ${channelNumber}${summary ? ` ${summary.name}` : ''}`;
    const link = panel.querySelector('.guide-details-link') as HTMLAnchorElement;
    link.href = detailsUrl(block.identifier);
    link.textContent = 'View this programme on archive.org';
  }

  private onKeyDown(event: KeyboardEvent): void {
    this.noteActivity();
    const key = event.key;

    if (key === 'Escape') return; // <dialog> closes itself

    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };

    const move = moves[key];
    if (move) {
      event.preventDefault();
      event.stopPropagation();
      this.focusCell(this.focusRow + move[0], this.focusCol + move[1]);
      return;
    }

    if (key === 'Home' || key === 'End') {
      event.preventDefault();
      const row = this.cells[this.focusRow] ?? [];
      this.focusCell(this.focusRow, key === 'Home' ? 0 : row.length - 1);
    }
  }

  private focusCell(rowIndex: number, colIndex: number): void {
    if (this.cells.length === 0) return;
    const row = Math.max(0, Math.min(rowIndex, this.cells.length - 1));
    const cells = this.cells[row] ?? [];
    if (cells.length === 0) return;
    const col = Math.max(0, Math.min(colIndex, cells.length - 1));

    for (const r of this.cells) for (const c of r) c.button.tabIndex = -1;
    const cell = cells[col] as Cell;
    cell.button.tabIndex = 0;
    cell.button.focus({ preventScroll: true });
    cell.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    this.focusRow = row;
    this.focusCol = col;
  }

  private focusFirstLive(): void {
    const current = this.callbacks.currentChannel();
    const rowIndex = Math.max(
      0,
      this.cells.findIndex((_, i) => this.rows[i]?.summary.number === current),
    );
    const col = Math.max(0, (this.cells[rowIndex] ?? []).findIndex((c) => c.live));
    this.focusCell(rowIndex, col);
  }

  // ---------------------------------------------------------- auto-scroll ---

  private noteActivity(): void {
    this.stopAutoScroll();
    window.clearTimeout(this.idleTimer);
    if (prefersReducedMotion()) return; // no unattended motion
    this.idleTimer = window.setTimeout(() => this.startAutoScroll(), IDLE_BEFORE_SCROLL_MS);
  }

  /**
   * After a while the grid creeps upward on its own and the panel shrinks so
   * the channel you are actually watching reappears above it.
   */
  private startAutoScroll(): void {
    if (!this.dialog.open || this.autoScrolling) return;
    this.autoScrolling = true;
    this.dialog.classList.add('is-autoscrolling');

    const body = this.dialog.querySelector('.guide-rows') as HTMLElement;
    // Shrinking the panel is what gives the grid somewhere to scroll to;
    // with every channel already on screen there would be nothing to show.
    const rowHeight = (body.querySelector('.guide-row') as HTMLElement | null)?.offsetHeight ?? 56;
    const visibleRows = Math.max(3, Math.min(5, this.rows.length - 1));
    body.style.maxHeight = `${rowHeight * visibleRows}px`;

    let last = performance.now();

    const step = (nowTs: number): void => {
      if (!this.autoScrolling) return;
      const dt = (nowTs - last) / 1000;
      last = nowTs;

      const limit = body.scrollHeight - body.clientHeight;
      if (limit <= 0) {
        this.scrollFrame = requestAnimationFrame(step);
        return;
      }

      this.scrollOffset += SCROLL_PIXELS_PER_SECOND * dt;
      if (this.scrollOffset > limit) this.scrollOffset = 0; // round and round
      body.scrollTop = this.scrollOffset;
      this.scrollFrame = requestAnimationFrame(step);
    };

    this.scrollFrame = requestAnimationFrame(step);
  }

  private stopAutoScroll(): void {
    if (!this.autoScrolling) return;
    this.autoScrolling = false;
    cancelAnimationFrame(this.scrollFrame);
    this.dialog.classList.remove('is-autoscrolling');
    const body = this.dialog.querySelector('.guide-rows') as HTMLElement;
    body.style.maxHeight = '';
    body.scrollTop = 0;
    this.scrollOffset = 0;
  }

  private teardown(): void {
    this.openToken += 1;
    this.stopAutoScroll();
    window.clearTimeout(this.idleTimer);
    window.clearInterval(this.refreshTimer);
    this.scrollOffset = 0;
    const details = this.dialog.querySelector('.guide-details') as HTMLElement;
    details.hidden = true;
  }
}
