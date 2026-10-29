/**
 * Minimal, polite archive.org client: on-disk response cache, global rate
 * limit, and bounded retries. Everything the builder fetches goes through here.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CACHE_DIR = join(process.cwd(), 'scripts', 'cache');
const MIN_INTERVAL_MS = 500; // 2 requests per second
const MAX_ATTEMPTS = 3;
/** Enough of a file's head to reach the moov atom and read the codec. */
const PROBE_BYTES = 262_144;

export interface ClientOptions {
  refresh: boolean;
  contact: string;
}

let chain: Promise<void> = Promise.resolve();
let lastStart = 0;

/** Serialises all requests so no two starts are closer than MIN_INTERVAL_MS. */
function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastStart + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run.then(task);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cachePath(url: string): string {
  return join(CACHE_DIR, `${createHash('sha256').update(url).digest('hex')}.json`);
}

export class ArchiveClient {
  private readonly opts: ClientOptions;
  cacheHits = 0;
  networkCalls = 0;

  constructor(opts: ClientOptions) {
    this.opts = opts;
  }

  /**
   * Reads the head of a media file and reports its video codec.
   *
   * The Archive's `format` label is not reliable: an item tagged "MPEG4"
   * may hold MPEG-4 Part 2, which no browser can decode, while a
   * "512Kb MPEG4" may be perfectly good H.264. The only trustworthy answer
   * is in the file itself. The verdict is cached like any other response.
   */
  async getVideoCodec(url: string): Promise<'avc1' | 'hev1' | 'mp4v' | 'unknown'> {
    const key = `codec:${url}`;
    const path = cachePath(key);

    if (!this.opts.refresh) {
      try {
        const cached = JSON.parse(await readFile(path, 'utf8')) as { codec: string };
        this.cacheHits += 1;
        return cached.codec as 'avc1' | 'hev1' | 'mp4v' | 'unknown';
      } catch {
        // not probed yet
      }
    }

    let codec: 'avc1' | 'hev1' | 'mp4v' | 'unknown' = 'unknown';
    try {
      const head = await schedule(async () => {
        this.networkCalls += 1;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': `RetroTV catalog builder; contact: ${this.opts.contact}`,
              Range: `bytes=0-${PROBE_BYTES - 1}`,
            },
            signal: controller.signal,
          });
          if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);

          // A 200 means the server ignored Range. Reading the body whole
          // would pull down a multi-hundred-megabyte film to look at its
          // header, so the stream is read only as far as needed.
          const chunks: Buffer[] = [];
          let total = 0;
          const reader = res.body?.getReader();
          if (!reader) return Buffer.alloc(0);
          try {
            while (total < PROBE_BYTES) {
              const { done, value } = await reader.read();
              if (done || !value) break;
              chunks.push(Buffer.from(value));
              total += value.byteLength;
            }
          } finally {
            await reader.cancel().catch(() => undefined);
          }
          return Buffer.concat(chunks);
        } finally {
          clearTimeout(timer);
        }
      });

      if (head.includes('avc1')) codec = 'avc1';
      else if (head.includes('hev1') || head.includes('hvc1')) codec = 'hev1';
      else if (head.includes('mp4v')) codec = 'mp4v';
    } catch {
      codec = 'unknown';
    }

    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path, JSON.stringify({ codec }));
    return codec;
  }

  async getJson<T>(url: string): Promise<T> {
    const path = cachePath(url);

    if (!this.opts.refresh) {
      try {
        const cached = await readFile(path, 'utf8');
        this.cacheHits += 1;
        return JSON.parse(cached) as T;
      } catch {
        // cache miss, fall through to the network
      }
    }

    const body = await this.fetchWithRetry(url);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path, JSON.stringify(body));
    return body as T;
  }

  private async fetchWithRetry(url: string): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await schedule(async () => {
          this.networkCalls += 1;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 30_000);
          try {
            const res = await fetch(url, {
              headers: {
                'User-Agent': `RetroTV catalog builder; contact: ${this.opts.contact}`,
                Accept: 'application/json',
              },
              signal: controller.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
            return (await res.json()) as unknown;
          } finally {
            clearTimeout(timer);
          }
        });
      } catch (err) {
        lastError = err;
        if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
