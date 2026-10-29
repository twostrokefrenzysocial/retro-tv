/**
 * Guards the catalogue that actually ships.
 *
 * The filters live in the builder, but the builder only runs when someone
 * rebuilds; what reaches a viewer is the JSON in public/catalog. These read
 * those files directly, so a rebuild that loses a filter — or a hand edit —
 * fails here rather than on the dial.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBlocked, titleFromFilename } from '../scripts/catalog-parse.ts';
import type { CatalogItem } from '../src/types.ts';

const CATALOG = join(process.cwd(), 'public', 'catalog');
const config = JSON.parse(
  readFileSync(join(process.cwd(), 'config', 'channels.config.json'), 'utf8'),
) as {
  blockTerms: string[];
  blockCollections: string[];
  blockIdentifiers: string[];
  maxYear: number;
};

function everyItem(): { file: string; item: CatalogItem }[] {
  const out: { file: string; item: CatalogItem }[] = [];
  for (const file of readdirSync(CATALOG)) {
    if (!file.endsWith('.json') || file === 'index.json') continue;
    const data = JSON.parse(readFileSync(join(CATALOG, file), 'utf8')) as { items: CatalogItem[] };
    for (const item of data.items) out.push({ file, item });
  }
  return out;
}

describe('the catalogue as shipped', () => {
  const all = everyItem();

  it('has something on every channel', () => {
    const index = JSON.parse(readFileSync(join(CATALOG, 'index.json'), 'utf8')) as {
      channels: { slug: string }[];
    };
    expect(index.channels.length).toBeGreaterThan(0);

    for (const channel of index.channels) {
      const data = JSON.parse(
        readFileSync(join(CATALOG, `${channel.slug}.json`), 'utf8'),
      ) as { items: CatalogItem[] };
      expect(data.items.length, `${channel.slug} is empty`).toBeGreaterThan(0);
    }
  });

  it('ships no file the index does not list', () => {
    const index = JSON.parse(readFileSync(join(CATALOG, 'index.json'), 'utf8')) as {
      channels: { slug: string }[];
    };
    const listed = new Set(index.channels.map((c) => c.slug));
    const orphans = readdirSync(CATALOG).filter(
      (f) =>
        f.endsWith('.json') &&
        f !== 'index.json' &&
        f !== 'commercials.json' &&
        !listed.has(f.replace('.json', '')),
    );
    expect(orphans).toEqual([]);
  });

  it('carries nothing from a blocked collection', () => {
    const blocked = all.filter(({ item }) => config.blockCollections.includes(item.collection));
    expect(blocked.map((b) => `${b.file}: ${b.item.title}`)).toEqual([]);
  });

  it('carries no title matching a block term', () => {
    const hits = all
      .map(({ file, item }) => ({ file, item, term: isBlocked(item.title, config.blockTerms) }))
      .filter((h) => h.term !== null);
    expect(hits.map((h) => `${h.file}: ${h.item.title} [${h.term}]`)).toEqual([]);
  });

  it('carries no filename matching a block term', () => {
    // Whole cartoon collections arrive titled only with the year, so a clean
    // title is no evidence at all about what the programme is. The name of
    // the picture is in the file, and that is where the caricature shorts
    // were hiding when one of them reached the dial.
    const hits = all
      .map(({ file, item }) => ({
        file,
        item,
        term: isBlocked(item.filename.replace(/[_\-.]+/g, ' '), config.blockTerms),
      }))
      .filter((h) => h.term !== null);
    expect(hits.map((h) => `${h.file}: ${h.item.filename} [${h.term}]`)).toEqual([]);
  });

  it('carries no item listed by identifier', () => {
    const listed = new Set(config.blockIdentifiers);
    const hits = all.filter(({ item }) => listed.has(item.identifier));
    expect(hits.map((h) => `${h.file}: ${h.item.identifier}`)).toEqual([]);
  });

  it('shows no date where the filename knows the real title', () => {
    // "1958" tells a viewer nothing, and a viewer who cannot tell what a
    // programme is cannot decide to skip it. A bare number is only allowed
    // to stand when the file has no name to recover -- "1776" is a picture.
    const dates = all.filter(
      ({ item }) =>
        /^[\d\s./-]+$/.test(item.title) && titleFromFilename(item.filename) !== null,
    );
    expect(dates.map((d) => `${d.file}: ${d.item.title} (${d.item.filename})`)).toEqual([]);
  });

  it('respects the year ceiling', () => {
    const late = all.filter(({ item }) => item.year !== null && item.year > config.maxYear);
    expect(late.map((l) => `${l.file}: ${l.item.title} (${l.item.year})`)).toEqual([]);
  });

  it('has a playable-looking file and a runtime for every item', () => {
    const broken = all.filter(
      ({ item }) => !item.identifier || !item.filename || !(item.duration > 0),
    );
    expect(broken.map((b) => `${b.file}: ${b.item.title}`)).toEqual([]);
  });

  it('leaves no raw filename showing as a title', () => {
    const ugly = all.filter(
      ({ item }) => /\.(wmv|mp4|avi|mpg|mpeg|mov)$/i.test(item.title) || item.title.includes('_'),
    );
    expect(ugly.map((u) => `${u.file}: ${u.item.title}`)).toEqual([]);
  });
});
