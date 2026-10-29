/**
 * Builds public/catalog/* from config/channels.config.json by querying the
 * Internet Archive. Run with `npm run catalog`.
 *
 * Flags:
 *   --refresh           ignore the on-disk cache
 *   --strict-license    keep only public-domain / CC items (plus alwaysAllow)
 *   --max-items <n>     override the per-channel cap
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArchiveClient } from './archive-client.ts';
import { streamUrl } from '../src/player/stream-url.ts';
import {
  displayTitle,
  formatRank,
  hasNonLatinScript,
  isBlocked,
  isEnglishLanguage,
  isOpenLicense,
  parseLength,
  parseYear,
  pickPlayableFile,
  searchableText,
  withinYears,
} from './catalog-parse.ts';
import type { MetadataFile } from './catalog-parse.ts';
import type { CatalogIndex, CatalogItem, ChannelCatalog, ChannelSummary } from '../src/types.ts';

// ---------------------------------------------------------------- config ---

interface SourceSpec {
  collection?: string;
  query?: string;
  identifiers?: string[];
}

interface ChannelSpec {
  number: number;
  slug: string;
  name: string;
  description: string;
  sources: SourceSpec[];
  minDuration: number;
  maxDuration: number;
  commercialBreaks: boolean;
  maxItems?: number;
  /** Era bounds. Setting either one excludes items with no known year. */
  minYear?: number;
  maxYear?: number;
}

interface CommercialSpec {
  sources: SourceSpec[];
  minDuration: number;
  maxDuration: number;
  maxItems?: number;
}

interface Config {
  contact: string;
  maxItems: number;
  alwaysAllow: string[];
  /** Archive collections never to take anything from, at any year. */
  blockCollections?: string[];
  /** Applied to every channel that does not set its own ceiling. */
  maxYear?: number;
  /** Titles, subjects or descriptions containing these are never included. */
  blockTerms?: string[];
  /** Drop anything declared non-English or titled in another script. */
  requireEnglish?: boolean;
  channels: ChannelSpec[];
  commercials: CommercialSpec;
}

export const EPOCH_ISO = '2026-01-01T00:00:00Z';

// ------------------------------------------------------------- arguments ---

function parseArgs(argv: string[]) {
  const maxIdx = argv.indexOf('--max-items');
  const raw = maxIdx >= 0 ? Number(argv[maxIdx + 1]) : NaN;
  return {
    refresh: argv.includes('--refresh'),
    strictLicense: argv.includes('--strict-license'),
    maxItemsOverride: Number.isFinite(raw) && raw > 0 ? raw : null,
  };
}

// ------------------------------------------------------- archive helpers ---

interface SearchDoc {
  identifier: string;
  title?: string | string[];
  year?: string | number;
  licenseurl?: string | string[];
  collection?: string | string[];
}

interface SearchResponse {
  response?: { numFound: number; docs: SearchDoc[] };
}

interface MetadataResponse {
  metadata?: Record<string, unknown>;
  files?: MetadataFile[];
}

const SEARCH_URL = 'https://archive.org/advancedsearch.php';

function queryForSource(source: SourceSpec): string | null {
  if (source.query) return source.query;
  if (source.collection) return `collection:"${source.collection}" AND mediatype:movies`;
  return null;
}

function searchUrl(query: string, page: number, rows: number): string {
  const params = new URLSearchParams();
  params.set('q', query);
  for (const field of ['identifier', 'title', 'year', 'licenseurl', 'collection']) {
    params.append('fl[]', field);
  }
  params.append('sort[]', 'downloads desc');
  params.set('rows', String(rows));
  params.set('page', String(page));
  params.set('output', 'json');
  return `${SEARCH_URL}?${params.toString()}`;
}

/** Pulls identifiers from a source, stopping once `limit` candidates are in hand. */
async function searchSource(
  client: ArchiveClient,
  source: SourceSpec,
  limit: number,
): Promise<SearchDoc[]> {
  if (source.identifiers?.length) {
    return source.identifiers.map((identifier) => ({ identifier }));
  }

  const query = queryForSource(source);
  if (!query) return [];

  const rows = 500;
  const docs: SearchDoc[] = [];

  for (let page = 1; docs.length < limit; page += 1) {
    const res = await client.getJson<SearchResponse>(searchUrl(query, page, rows));
    const batch = res.response?.docs ?? [];
    docs.push(...batch);
    if (batch.length < rows) break;
    if (page > 40) break; // deep paging guard
  }

  return docs.slice(0, limit);
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// ------------------------------------------------------------- the build ---

interface SkipCounts {
  notEnglish: number;
  unplayableCodec: number;
  noFile: number;
  noDuration: number;
  tooShort: number;
  tooLong: number;
  error: number;
  license: number;
  outOfEra: number;
  blocked: number;
  blockedCollection: number;
}

interface BuildResult {
  items: CatalogItem[];
  skips: SkipCounts;
  candidates: number;
  wouldExcludeStrict: number;
}

function emptySkips(): SkipCounts {
  return {
    notEnglish: 0, unplayableCodec: 0, noFile: 0, noDuration: 0, tooShort: 0, tooLong: 0,
    error: 0, license: 0, outOfEra: 0, blocked: 0, blockedCollection: 0,
  };
}

async function collectItems(
  client: ArchiveClient,
  sources: SourceSpec[],
  opts: {
    minDuration: number;
    maxDuration: number;
    maxItems: number;
    strictLicense: boolean;
    alwaysAllow: string[];
    label: string;
    minYear?: number;
    maxYear?: number;
    /** Keep items we cannot date, instead of excluding them from the era. */
    allowUnknownYear?: boolean;
    requireEnglish: boolean;
    blockTerms: string[];
    blockCollections: string[];
  },
): Promise<BuildResult> {
  const skips = emptySkips();
  const items: CatalogItem[] = [];
  const seen = new Set<string>();
  let wouldExcludeStrict = 0;
  let candidates = 0;

  // Over-fetch candidates: many items have no usable mp4 or runtime, and an
  // era-bounded channel discards everything it cannot date.
  const bounded = opts.minYear !== undefined || opts.maxYear !== undefined;
  const oversample = bounded ? 6 : 3;
  const perSource = Math.ceil((opts.maxItems * oversample) / Math.max(sources.length, 1));

  const docs: SearchDoc[] = [];
  for (const source of sources) {
    docs.push(...(await searchSource(client, source, perSource)));
  }

  for (const doc of docs) {
    if (items.length >= opts.maxItems) break;
    if (!doc.identifier || seen.has(doc.identifier)) continue;
    seen.add(doc.identifier);
    candidates += 1;

    let meta: MetadataResponse;
    try {
      meta = await client.getJson<MetadataResponse>(
        `https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`,
      );
    } catch (err) {
      skips.error += 1;
      console.warn(`  ! ${opts.label}: metadata failed for ${doc.identifier}: ${String(err)}`);
      continue;
    }

    const metadata = meta.metadata ?? {};
    const file = pickPlayableFile(meta.files ?? []);
    if (!file?.name) {
      skips.noFile += 1;
      continue;
    }

    const duration = parseLength(file.length);
    if (duration === null) {
      skips.noDuration += 1;
      continue;
    }
    if (duration < opts.minDuration) {
      skips.tooShort += 1;
      continue;
    }
    if (duration > opts.maxDuration) {
      skips.tooLong += 1;
      continue;
    }

    const collections = metadata['collection'];
    const collectionList = Array.isArray(collections)
      ? collections.map(String)
      : collections
        ? [String(collections)]
        : [];
    // An Archive item belongs to several collections at once, and a query
    // naming one well-behaved collection still returns items that also sit in
    // a disreputable one -- `collection:"movie_trailers"` brings back the
    // whole of `sinema-trailers` with it. Checking every collection the item
    // claims is the only reliable way to keep those off the dial.
    const blockedCollection = collectionList.find((c) =>
      opts.blockCollections.includes(c),
    );
    if (blockedCollection !== undefined) {
      skips.blockedCollection += 1;
      continue;
    }

    const licenseurl = first(metadata['licenseurl'] as string | string[] | undefined);
    const allowed =
      isOpenLicense(licenseurl) || collectionList.some((c) => opts.alwaysAllow.includes(c));

    if (!allowed && opts.strictLicense) {
      skips.license += 1;
      continue;
    }

    const title =
      first(metadata['title'] as string | string[] | undefined) ??
      first(doc.title) ??
      doc.identifier;

    const titleForChecks = String(
      first(metadata['title'] as string | string[] | undefined) ?? first(doc.title) ?? doc.identifier,
    ).trim();

    if (
      opts.requireEnglish &&
      (!isEnglishLanguage(metadata) ||
        hasNonLatinScript(`${titleForChecks} ${String(metadata['creator'] ?? '')}`))
    ) {
      skips.notEnglish += 1;
      continue;
    }

    // "h.264" derivatives are produced by the Archive and are dependable.
    // Everything else gets its codec read from the file itself.
    if (formatRank(file.format) !== 0) {
      const codec = await client.getVideoCodec(
        streamUrl(doc.identifier, file.name),
      );
      if (codec === 'mp4v' || codec === 'unknown') {
        skips.unplayableCodec += 1;
        continue;
      }
    }

    const cleanTitle = displayTitle(String(title));
    const year = parseYear(metadata, cleanTitle);

    const datable = year !== null || opts.allowUnknownYear === true;
    if (!datable || !withinYears(year ?? opts.minYear ?? 0, opts.minYear, opts.maxYear)) {
      skips.outOfEra += 1;
      continue;
    }

    const blockedBy = isBlocked(searchableText(metadata, cleanTitle), opts.blockTerms);
    if (blockedBy !== null) {
      skips.blocked += 1;
      continue;
    }

    // Counted here rather than at the licence check above, so the tally covers
    // items that actually made the catalogue. Counting earlier included
    // candidates that a later filter dropped, which reported more exclusions
    // than there were kept items.
    if (!allowed) wouldExcludeStrict += 1;

    items.push({
      identifier: doc.identifier,
      title: cleanTitle,
      year,
      filename: file.name,
      duration,
      licenseurl,
      collection: collectionList[0] ?? first(doc.collection) ?? 'unknown',
    });
  }

  return { items, skips, candidates, wouldExcludeStrict };
}

function describeSkips(s: SkipCounts): string {
  const parts: string[] = [];
  if (s.noFile) parts.push(`${s.noFile} no mp4`);
  if (s.unplayableCodec) parts.push(`${s.unplayableCodec} no browser codec`);
  if (s.notEnglish) parts.push(`${s.notEnglish} not English`);
  if (s.noDuration) parts.push(`${s.noDuration} no runtime`);
  if (s.tooShort) parts.push(`${s.tooShort} too short`);
  if (s.tooLong) parts.push(`${s.tooLong} too long`);
  if (s.outOfEra) parts.push(`${s.outOfEra} wrong era`);
  if (s.blocked) parts.push(`${s.blocked} filtered`);
  if (s.blockedCollection) parts.push(`${s.blockedCollection} blocked collection`);
  if (s.license) parts.push(`${s.license} license`);
  if (s.error) parts.push(`${s.error} errors`);
  return parts.length ? parts.join(', ') : '-';
}

function pad(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}

function padLeft(text: string, width: number): string {
  return text.padStart(width);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configPath = join(process.cwd(), 'config', 'channels.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Config;
  const client = new ArchiveClient({ refresh: args.refresh, contact: config.contact });
  const outDir = join(process.cwd(), 'public', 'catalog');
  await mkdir(outDir, { recursive: true });

  console.log(
    `RetroTV catalog builder — ${config.channels.length} channels` +
      `${args.strictLicense ? ', strict license mode' : ''}` +
      `${args.refresh ? ', cache bypassed' : ''}`,
  );

  const summaries: ChannelSummary[] = [];
  const rows: string[][] = [];
  const strictNotes: string[] = [];

  for (const channel of config.channels) {
    const maxItems = args.maxItemsOverride ?? channel.maxItems ?? config.maxItems;
    const effectiveMaxYear = channel.maxYear ?? config.maxYear;
    console.log(`\n[ch ${channel.number}] ${channel.name} …`);

    const result = await collectItems(client, channel.sources, {
      minDuration: channel.minDuration,
      maxDuration: channel.maxDuration,
      maxItems,
      strictLicense: args.strictLicense,
      alwaysAllow: config.alwaysAllow,
      label: channel.slug,
      minYear: channel.minYear,
      maxYear: effectiveMaxYear,
      requireEnglish: config.requireEnglish !== false,
      blockTerms: config.blockTerms ?? [],
      blockCollections: config.blockCollections ?? [],
    });

    const totalRuntime = result.items.reduce((sum, item) => sum + item.duration, 0);
    const era = {
      ...(channel.minYear === undefined ? {} : { minYear: channel.minYear }),
      ...(effectiveMaxYear === undefined ? {} : { maxYear: effectiveMaxYear }),
    };
    const catalog: ChannelCatalog = {
      slug: channel.slug,
      number: channel.number,
      name: channel.name,
      description: channel.description,
      commercialBreaks: channel.commercialBreaks,
      ...era,
      items: result.items,
    };
    await writeFile(join(outDir, `${channel.slug}.json`), `${JSON.stringify(catalog)}\n`);

    summaries.push({
      number: channel.number,
      slug: channel.slug,
      name: channel.name,
      description: channel.description,
      itemCount: result.items.length,
      totalRuntime,
      commercialBreaks: channel.commercialBreaks,
      ...era,
    });

    rows.push([
      String(channel.number),
      channel.name,
      String(result.items.length),
      describeSkips(result.skips),
      (totalRuntime / 3600).toFixed(1),
    ]);

    if (!args.strictLicense) {
      strictNotes.push(
        `  ch ${channel.number} ${channel.name}: ${result.wouldExcludeStrict} of ` +
          `${result.items.length} kept items would be dropped under --strict-license`,
      );
    }

    if (result.items.length === 0) {
      console.warn(`  !! ${channel.name} produced no items`);
    }
  }

  console.log('\n[commercials] …');
  const commercials = await collectItems(client, config.commercials.sources, {
    minDuration: config.commercials.minDuration,
    maxDuration: config.commercials.maxDuration,
    maxItems: args.maxItemsOverride ?? config.commercials.maxItems ?? config.maxItems,
    strictLicense: args.strictLicense,
    alwaysAllow: config.alwaysAllow,
    label: 'commercials',
    // Not bounded to any one channel's era: this is the shared pool the
    // browser narrows per channel. The global ceiling still applies, but
    // leniently, so undated adverts survive to be used as a last resort.
    maxYear: config.maxYear,
    allowUnknownYear: true,
    requireEnglish: config.requireEnglish !== false,
    blockTerms: config.blockTerms ?? [],
    blockCollections: config.blockCollections ?? [],
  });
  await writeFile(
    join(outDir, 'commercials.json'),
    `${JSON.stringify({ items: commercials.items })}\n`,
  );
  rows.push([
    '--',
    'Commercials',
    String(commercials.items.length),
    describeSkips(commercials.skips),
    (commercials.items.reduce((s, i) => s + i.duration, 0) / 3600).toFixed(1),
  ]);

  const index: CatalogIndex = {
    generatedAt: new Date().toISOString(),
    epoch: EPOCH_ISO,
    channels: summaries.filter((c) => c.itemCount > 0),
    commercialCount: commercials.items.length,
  };
  await writeFile(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

  // ----- summary table -----
  const header = ['Ch', 'Channel', 'Kept', 'Skipped (why)', 'Hours'];
  const widths = [4, 22, 6, 46, 7];
  const line = widths.map((w) => '-'.repeat(w)).join('-+-');
  console.log(`\n${header.map((h, i) => pad(h, widths[i] ?? 10)).join(' | ')}`);
  console.log(line);
  for (const row of rows) {
    console.log(
      [
        padLeft(row[0] ?? '', widths[0] ?? 4),
        pad(row[1] ?? '', widths[1] ?? 22),
        padLeft(row[2] ?? '', widths[2] ?? 6),
        pad(row[3] ?? '', widths[3] ?? 46),
        padLeft(row[4] ?? '', widths[4] ?? 7),
      ].join(' | '),
    );
  }
  console.log(line);

  if (strictNotes.length) {
    console.log('\nStrict-license preview (currently off):');
    for (const note of strictNotes) console.log(note);
  }

  console.log(
    `\nCache hits: ${client.cacheHits}, network calls: ${client.networkCalls}. ` +
      `Wrote ${index.channels.length} channel files to public/catalog/.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
