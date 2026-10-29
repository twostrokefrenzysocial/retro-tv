/**
 * Applies the current block lists and title rules to the catalogue on disk.
 *
 * The builder enforces both on every new item, but a full rebuild costs a
 * couple of hours of archive.org requests, and material that should never
 * have reached the dial should not have to wait that long to leave it. This
 * brings the shipped files into line straight away. Idempotent: running it
 * twice drops nothing the first run kept.
 *
 * Pass --dry-run to see what would go without writing anything.
 *
 * One difference from the builder worth knowing: the shipped files keep only
 * the title and the filename, not the Archive's subject tags or description,
 * so this sees less text than the builder does. It can therefore drop a
 * subset of what a rebuild would drop, never a superset.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { displayTitle, isBlocked } from './catalog-parse.ts';

interface Item {
  identifier: string;
  title: string;
  filename: string;
  duration: number;
}

interface Channel {
  slug: string;
  items: Item[];
}

const dryRun = process.argv.includes('--dry-run');
const root = process.cwd();
const config = JSON.parse(
  readFileSync(join(root, 'config', 'channels.config.json'), 'utf8'),
) as { blockTerms?: string[]; blockIdentifiers?: string[] };

const blockTerms = config.blockTerms ?? [];
const blockIdentifiers = new Set(config.blockIdentifiers ?? []);

const dir = join(root, 'public', 'catalog');
const counts = new Map<string, number>();
let dropped = 0;
let retitled = 0;

for (const file of readdirSync(dir).sort()) {
  if (!file.endsWith('.json') || file === 'index.json') continue;

  const path = join(dir, file);
  const data = JSON.parse(readFileSync(path, 'utf8')) as Channel;
  const kept: Item[] = [];

  for (const item of data.items) {
    const tidied = displayTitle(item.title, item.filename);
    if (tidied !== item.title) {
      console.log(`  ~ ${data.slug}: "${item.title}" -> "${tidied}"`);
      item.title = tidied;
      retitled += 1;
    }

    if (blockIdentifiers.has(item.identifier)) {
      console.log(`  - ${data.slug}: ${item.title} [listed by identifier]`);
      dropped += 1;
      continue;
    }

    // The filename carries the real name of the picture whenever the
    // uploader's title does not, so both go into the haystack.
    const haystack = `${item.title} ${item.filename.replace(/[_\-.]+/g, ' ')}`.toLowerCase();
    const term = isBlocked(haystack, blockTerms);
    if (term !== null) {
      console.log(`  - ${data.slug}: ${item.title} [${term}]`);
      dropped += 1;
      continue;
    }

    kept.push(item);
  }

  data.items = kept;
  counts.set(data.slug, kept.length);

  if (!dryRun) {
    // Written minified, exactly as build-catalog.ts writes them: these files
    // go to the browser, and pretty-printing adds about a third to each one.
    writeFileSync(path, `${JSON.stringify(data)}\n`);
  }
}

// The index advertises a per-channel count and runtime that the guide shows,
// so it has to be recounted or it will promise programmes that are gone.
const indexPath = join(dir, 'index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
  channels: { slug: string; itemCount: number; totalRuntime: number }[];
};

for (const channel of index.channels) {
  const path = join(dir, `${channel.slug}.json`);
  const data = JSON.parse(readFileSync(path, 'utf8')) as Channel;
  channel.itemCount = data.items.length;
  channel.totalRuntime = data.items.reduce((sum, item) => sum + item.duration, 0);
}

if (!dryRun) writeFileSync(indexPath, `${JSON.stringify(index)}\n`);

console.log(
  `\n${dropped} item(s) dropped, ${retitled} retitled${dryRun ? ' (dry run, nothing written)' : ''}.`,
);

const empty = [...counts].filter(([, n]) => n === 0);
if (empty.length > 0) {
  console.error(`\nEMPTY CHANNELS: ${empty.map(([s]) => s).join(', ')}`);
  process.exitCode = 1;
}
