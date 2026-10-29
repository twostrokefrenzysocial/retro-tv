/**
 * Pure parsing helpers for the catalogue builder. Kept out of
 * build-catalog.ts so tests can import them without running the builder.
 */

export interface MetadataFile {
  name?: string;
  format?: string;
  length?: string;
}

/** The earliest plausible release year for a moving picture. */
const EARLIEST_YEAR = 1878;

/** "1523.45" | "HH:MM:SS" | "MM:SS" -> whole seconds, or null. */
export function parseLength(raw: string | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  if (text.includes(':')) {
    const parts = text.split(':').map((p) => Number(p));
    if (parts.length > 3) return null;
    if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
    let seconds = 0;
    for (const part of parts) seconds = seconds * 60 + part;
    return seconds > 0 ? Math.floor(seconds) : null;
  }

  const num = Number(text);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : null;
}

/** Lower rank wins. Archive labels these "h.264 IA", "MPEG4", "512Kb MPEG4". */
export function formatRank(format: string | undefined): number | null {
  if (!format) return null;
  const f = format.toLowerCase();
  if (f.startsWith('h.264')) return 0;
  if (f.includes('512kb mpeg4')) return 2;
  if (f.includes('mpeg4')) return 1;
  return null;
}

export function pickPlayableFile(files: MetadataFile[]): MetadataFile | null {
  let best: MetadataFile | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const file of files) {
    if (!file.name?.toLowerCase().endsWith('.mp4')) continue;
    const rank = formatRank(file.format);
    if (rank === null || rank >= bestRank) continue;
    best = file;
    bestRank = rank;
  }

  return best;
}

export function isOpenLicense(licenseurl: string | null): boolean {
  if (!licenseurl) return false;
  const url = licenseurl.toLowerCase();
  return (
    url.includes('creativecommons.org/publicdomain') ||
    url.includes('creativecommons.org/licenses/') ||
    url.includes('creativecommons.org/mark/') ||
    url.includes('rightsstatements.org/vocab/noc') ||
    url.includes('publicdomain')
  );
}

function plausibleYear(text: string, maxYear: number): number | null {
  const matches = text.match(/\b(1[89]\d{2}|20\d{2})\b/g);
  if (!matches) return null;
  for (const match of matches) {
    const value = Number(match);
    if (value >= EARLIEST_YEAR && value <= maxYear) return value;
  }
  return null;
}

/**
 * The year the programme was made.
 *
 * Deliberately does NOT consider `publicdate` or `addeddate`: those record
 * when the file reached archive.org, so a 1940 picture uploaded in 2011
 * would otherwise be labelled 2011. When the item carries no date at all, a
 * year in the title ("The Ape (1940)") is a far better guess than none.
 */
export function parseYear(
  meta: Record<string, unknown>,
  title?: string,
  now: Date = new Date(),
): number | null {
  const maxYear = now.getUTCFullYear();

  for (const key of ['year', 'date']) {
    const raw = meta[key];
    if (raw === undefined || raw === null) continue;
    const text = Array.isArray(raw) ? String(raw[0]) : String(raw);
    const found = plausibleYear(text, maxYear);
    if (found !== null) return found;
  }

  return title ? plausibleYear(title, maxYear) : null;
}

/**
 * Collapses an item's text fields into one lowercase haystack for the
 * content filter: title, filename, subject tags and description.
 *
 * The filename matters as much as the title. Bulk cartoon uploads carry a
 * metadata title that is only the year -- "1932" -- while the name of the
 * picture sits in the file beside it, so a filter reading the title alone is
 * blind to exactly the items whose titles tell a viewer nothing either.
 */
export function searchableText(
  meta: Record<string, unknown>,
  title: string,
  filename?: string,
): string {
  const parts: string[] = [title];
  if (filename) parts.push(filename.replace(/[_\-.]+/g, ' '));
  for (const key of ['subject', 'description']) {
    const raw = meta[key];
    if (Array.isArray(raw)) parts.push(...raw.map(String));
    else if (raw != null) parts.push(String(raw));
  }
  // Strip tags so HTML in descriptions cannot hide a blocked word.
  return parts.join(' ').replace(/<[^>]*>/g, ' ').toLowerCase();
}

/**
 * True when any blocked term appears as a whole word, so "birth" does not
 * catch "birthday". A trailing asterisk makes the term a stem instead:
 * "sexual*" also catches "sexually" and "sexuality", which plain whole-word
 * matching would miss.
 */
export function isBlocked(haystack: string, terms: string[]): string | null {
  for (const term of terms) {
    const stem = term.endsWith('*');
    const body = (stem ? term.slice(0, -1) : term).toLowerCase();
    const escaped = body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tail = stem ? '[a-z]*' : '';
    const pattern = new RegExp(`(^|[^a-z0-9])${escaped}${tail}([^a-z0-9]|$)`, 'i');
    if (pattern.test(haystack)) return term;
  }
  return null;
}

/** Within the channel's era. An unknown year fails a bounded channel. */
export function withinYears(
  year: number | null,
  minYear: number | undefined,
  maxYear: number | undefined,
): boolean {
  if (minYear === undefined && maxYear === undefined) return true;
  // If a channel declares an era, an item must be datable to belong to it.
  if (year === null) return false;
  if (minYear !== undefined && year < minYear) return false;
  if (maxYear !== undefined && year > maxYear) return false;
  return true;
}

/** Values the Archive uses for English, in its various spellings. */
const ENGLISH = new Set([
  'eng', 'en', 'english', 'eng.', 'en-us', 'en_us', 'en-gb', 'american english',
  'english-handwritten', 'silent', 'no linguistic content', 'zxx',
]);

/**
 * Whether an item's declared language is English.
 *
 * Only about a third of items declare one at all, so this is deliberately
 * lenient: an item with no language is accepted, and only an explicit
 * declaration of something other than English rejects it. Untagged foreign
 * material is caught by {@link hasNonLatinScript} instead.
 */
export function isEnglishLanguage(meta: Record<string, unknown>): boolean {
  const raw = meta['language'];
  if (raw === undefined || raw === null) return true;

  const values = (Array.isArray(raw) ? raw : [raw])
    .map((v) => String(v).trim().toLowerCase())
    .filter((v) => v.length > 0 && v !== 'none' && v !== 'und' && v !== 'unknown');

  if (values.length === 0) return true;
  // A dual-language item still has an English track to play.
  return values.some((v) => ENGLISH.has(v));
}

/**
 * True when the text carries a writing system English does not use.
 *
 * This is what catches the Japanese commercials and Chinese features that
 * declare no language at all: their titles are written in their own script.
 */
export function hasNonLatinScript(text: string): boolean {
  return /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿऀ-ॿ฀-๿⺀-鿿ꥠ-꥿가-퟿豈-﫿ｦ-ﾟ]/.test(
    text,
  );
}

/** Video containers that turn up on the end of an un-retitled upload. */
const FILE_EXTENSION = /\.(wmv|mp4|avi|mpg|mpeg|mov|flv|m4v|ogv|mkv|rm)$/i;

/**
 * A shelf mark on the front of an institutional upload: the NASA centre reels
 * arrive as "JSC-500 Apollo 8", "CMP304_Apollo11_1969-1989", "HQ220_Universe".
 * Only stripped when real words follow, so an item whose whole title is its
 * catalogue number keeps something to show.
 */
const ARCHIVE_CODE = /^(?:JSC|CMP|HQ|VJSC|GSFC|KSC|MSFC|LRC|ARC)[-_ ]?\d+[-_ ]+(?=\S)/i;

/**
 * Tidies an uploader's filename into something fit for the guide grid.
 *
 * Archive.org titles are whatever the uploader typed, which for bulk
 * institutional collections is the filename off the tape: underscores for
 * spaces, a container extension on the end, a shelf mark on the front. The
 * guide shows these verbatim, so they get cleaned here rather than in the UI —
 * the scheduler, the player and the guide all read the same stored title.
 *
 * Deliberately conservative. A hyphenated title ("Rikki-Tikki-Tavi") and a
 * title that merely contains digits are left exactly as they are.
 */
export function displayTitle(raw: string, filename?: string): string {
  let text = String(raw).trim();

  text = text.replace(FILE_EXTENSION, '');
  text = text.replace(ARCHIVE_CODE, '');

  // Only treat underscores as spaces; a filename rarely uses both, and
  // rewriting hyphens would break legitimately hyphenated titles.
  if (text.includes('_')) text = text.replace(/_/g, ' ');

  text = text.replace(/\s+/g, ' ').trim();

  if (isDateOnly(text) && filename) {
    const fromFile = titleFromFilename(filename);
    if (fromFile !== null) return fromFile;
  }

  return text.length > 0 ? text : String(raw).trim();
}

/** Nothing but digits and the punctuation a date is written with. */
function isDateOnly(text: string): boolean {
  return text.length > 0 && /^[\d\s./\-]+$/.test(text);
}

/** A date stamp an uploader put on the front of a filename. */
const FILENAME_DATE_PREFIX =
  /^(?:\d[\d./\-]*\s*[-\u2013\u2014]\s*|\d[\d./]*\.\s+|\d{4}[A-Z]{2,}\d*\.\s*)/;

/** A format or source tag an encoder left on: "[Blu-Ray]", "[512kb]". */
const FILENAME_TAG = /\[[^\]]*\]/g;

/** The Archive's own marker on a derived file, left before the extension. */
const IA_SUFFIX = /\.ia$/i;

/**
 * Recovers a programme's name from the file it is stored in.
 *
 * Only reached when the uploader's title is a bare date, which is how whole
 * cartoon collections arrive: the item is called "1958" and the picture is
 * called "1958 - Harlem Wednesday.ia.mp4". Showing the date in the guide
 * tells a viewer nothing about what they are about to watch, and a viewer who
 * cannot tell what a programme is cannot decide to skip it.
 *
 * Returns null rather than a guess when the filename has no words in it, so
 * the caller keeps whatever the uploader gave.
 */
export function titleFromFilename(filename: string): string | null {
  let text = String(filename).trim();

  text = text.replace(FILE_EXTENSION, '');
  text = text.replace(IA_SUFFIX, '');
  text = text.replace(FILENAME_TAG, ' ');
  text = text.replace(FILENAME_DATE_PREFIX, '');
  if (text.includes('_')) text = text.replace(/_/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  // A filename that is itself only a date or a serial number is no better
  // than the title it would replace.
  return /[a-z]{2}/i.test(text) ? text : null;
}
