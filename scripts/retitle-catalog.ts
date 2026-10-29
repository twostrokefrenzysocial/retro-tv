/**
 * One-off: re-runs `displayTitle` over the catalogue already on disk.
 *
 * The builder applies it to every new item, but a full rebuild costs a couple
 * of hours of archive.org requests. This brings the current files up to date
 * without one. Safe to run again; it is idempotent.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { displayTitle } from './catalog-parse.ts';

const dir = join(process.cwd(), 'public', 'catalog');
let changed = 0;

for (const file of readdirSync(dir).sort()) {
  if (!file.endsWith('.json') || file === 'index.json') continue;

  const path = join(dir, file);
  const data = JSON.parse(readFileSync(path, 'utf8')) as { items: { title: string }[] };
  let touched = 0;

  for (const item of data.items) {
    const tidied = displayTitle(item.title);
    if (tidied !== item.title) {
      console.log(`  ${file.replace('.json', '')}: ${item.title}  ->  ${tidied}`);
      item.title = tidied;
      touched += 1;
    }
  }

  // Channel files ship to the browser, so they are written minified, exactly
  // as build-catalog.ts writes them. Pretty-printing here would add roughly a
  // third to every catalogue the visitor downloads.
  writeFileSync(path, `${JSON.stringify(data)}\n`);
  changed += touched;
}

console.log(`\n${changed} title(s) rewritten.`);
