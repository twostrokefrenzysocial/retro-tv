/**
 * "What's On": a plain list of what is airing on every channel this minute,
 * refreshed on a timer. Shares the scheduler with the television itself, so
 * the two always agree.
 */
import '../styles/base.css';
import '../styles/page.css';
import '../styles/logo.css';
import { logoSvg } from '../ui/logo.ts';
import { Catalog } from '../catalog.ts';
import { detailsUrl } from '../player/index.ts';
import { getNowPlaying, getSchedule } from '../scheduler/index.ts';
import type { SchedulerChannel } from '../scheduler/index.ts';
import type { ChannelSummary } from '../types.ts';

const REFRESH_MS = 30_000;

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function card(summary: ChannelSummary, channel: SchedulerChannel, now: number): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'now-card';

  const heading = document.createElement('div');
  heading.className = 'now-channel';
  const number = document.createElement('span');
  number.className = 'now-number';
  number.textContent = String(summary.number);
  const name = document.createElement('span');
  name.className = 'now-name';
  name.textContent = summary.name;
  heading.append(number, name);
  item.append(heading);

  const playing = getNowPlaying(channel, now);
  const title = document.createElement('h2');

  if (!playing) {
    title.textContent = 'Off air';
    item.append(title);
    return item;
  }

  const segment = playing.segment;
  const isAd = segment.type === 'commercial';

  if (isAd) {
    title.className = 'now-ad';
    title.textContent = 'Commercial break';
  } else {
    title.textContent = `${segment.title}${segment.year ? ` (${segment.year})` : ''}`;
  }
  item.append(title);

  // Progress through the programme, not the individual segment.
  const [block] = getSchedule(channel, now, now + 1);
  if (block) {
    const span = block.airEndMs - block.airStartMs;
    const done = span > 0 ? Math.min(1, Math.max(0, (now - block.airStartMs) / span)) : 0;

    const meta = document.createElement('p');
    meta.className = 'now-meta';
    meta.textContent = `${clockTime(block.airStartMs)} – ${clockTime(block.airEndMs)}`;
    item.append(meta);

    const bar = document.createElement('div');
    bar.className = 'now-progress';
    const fill = document.createElement('div');
    fill.className = 'now-progress-fill';
    fill.style.width = `${done * 100}%`;
    bar.append(fill);
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${Math.round(done * 100)} per cent through`);
    item.append(bar);
  }

  const next = getSchedule(channel, now, now + 4 * 3600_000).find(
    (b) => b.airStartMs > (block?.airStartMs ?? now),
  );
  if (next) {
    const upNext = document.createElement('p');
    upNext.className = 'now-meta';
    upNext.textContent = `Next at ${clockTime(next.airStartMs)}: ${next.title}`;
    item.append(upNext);
  }

  const links = document.createElement('div');
  links.className = 'now-links';

  const watch = document.createElement('a');
  watch.href = `/?ch=${summary.number}`;
  watch.textContent = 'Watch this channel';
  links.append(watch);

  if (!isAd) {
    const source = document.createElement('a');
    source.href = detailsUrl(segment.identifier);
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.textContent = 'Source on archive.org';
    source.setAttribute('aria-label', `${segment.title} on archive.org, opens in a new tab`);
    links.append(source);
  }

  item.append(links);
  return item;
}

async function main(): Promise<void> {
  const list = document.querySelector('#now-list') as HTMLUListElement;
  const updated = document.querySelector('#updated') as HTMLElement;

  let catalog: Catalog;
  try {
    catalog = await Catalog.load();
  } catch (err) {
    console.error('Retro TV: could not load the catalogue.', err);
    updated.textContent = 'The listings could not be loaded. Please try again later.';
    return;
  }

  const rows = await catalog.ensureAll();
  if (rows.length === 0) {
    updated.textContent = 'No channels are available right now.';
    return;
  }

  const draw = (): void => {
    const now = Date.now();
    list.replaceChildren(...rows.map(({ summary, channel }) => card(summary, channel, now)));
    updated.textContent = `Updated ${clockTime(now)}. This page refreshes every 30 seconds.`;
  };

  draw();
  window.setInterval(draw, REFRESH_MS);
}

void main();

// The wordmark in the page heading.
const slot = document.querySelector('[data-logo]');
if (slot) slot.innerHTML = logoSvg({ title: 'Retro TV', compact: true });
