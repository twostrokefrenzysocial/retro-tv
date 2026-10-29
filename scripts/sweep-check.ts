/** One-off pre-release sweep: every channel tunes, schedules and matches era. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getNowPlaying, getSchedule } from '../src/scheduler/schedule.ts';
import { commercialsForEra } from '../src/commercial-pool.ts';
import type { CatalogItem } from '../src/types.ts';
import type { SchedulerChannel } from '../src/scheduler/types.ts';

const dir = join(process.cwd(), 'public', 'catalog');
const read = (f: string): any => JSON.parse(readFileSync(join(dir, f), 'utf8'));

const index = read('index.json');
const channels = index.channels ?? index;
const allCommercials: CatalogItem[] = read('commercials.json').items;
const now = Date.now();

let failures = 0;
const rows: string[] = [];

for (const meta of channels) {
  const slug = meta.slug ?? meta.id;
  const data = read(`${slug}.json`);
  const items: CatalogItem[] = data.items;
  const pool = commercialsForEra(allCommercials, { minYear: meta.minYear, maxYear: meta.maxYear });

  const channel: SchedulerChannel = {
    slug,
    commercialBreaks: meta.commercialBreaks ?? true,
    items,
    commercials: pool.items,
  };

  const np = getNowPlaying(channel, now);
  const sched = getSchedule(channel, now, now + 24 * 3600 * 1000);

  const problems: string[] = [];
  if (!np) problems.push('NO NOW-PLAYING');
  if (!sched || sched.length === 0) problems.push('EMPTY SCHEDULE');

  // Era check on the ads this channel will actually run.
  if (channel.commercialBreaks && meta.maxYear !== undefined) {
    const ceiling = meta.maxYear + 10;
    const over = pool.items.filter((c) => c.year !== null && c.year > ceiling);
    if (over.length) problems.push(`${over.length} ads past ${ceiling}`);
    if (pool.items.length === 0) problems.push('NO ADS');
  }

  // Every programme must point at a real file.
  const broken = items.filter((i) => !i.identifier || !i.filename || !(i.duration > 0));
  if (broken.length) problems.push(`${broken.length} malformed items`);

  if (problems.length) failures += 1;
  rows.push(
    `${String(meta.number).padStart(2)} ${String(meta.name).padEnd(21)} ` +
      `${String(items.length).padStart(4)} items  ads:${String(pool.items.length).padStart(3)}` +
      `${pool.padding ? ` +${pool.padding}y` : '    '}  ` +
      `${problems.length ? 'FAIL ' + problems.join('; ') : 'ok — ' + (np ? np.segment.title.slice(0, 34) : '')}`,
  );
}

console.log(rows.join('\n'));
console.log(failures === 0 ? `\nAll ${channels.length} channels OK.` : `\n${failures} CHANNEL(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
