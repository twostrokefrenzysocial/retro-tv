# Retro TV

A television set that behaves the way broadcast television used to. There is no
library to browse and nothing to queue up: you turn it on, and whatever is
scheduled is already halfway through.

Every channel runs to a fixed schedule derived from the date and the channel's
name, so two people opening the site anywhere in the world see the same frame at
the same moment. All video streams directly from the
[Internet Archive](https://archive.org). There is no backend.

---

## Contents

- [Running it locally](#running-it-locally)
- [How it fits together](#how-it-fits-together)
- [The channels](#the-channels)
- [Adding or editing a channel](#adding-or-editing-a-channel)
- [Keeping unwanted material off the air](#keeping-unwanted-material-off-the-air)
- [The catalogue builder](#the-catalogue-builder)
- [Rights and strict licence mode](#rights-and-strict-licence-mode)
- [Keyboard controls](#keyboard-controls)
- [Deployment](#deployment)
- [Tests](#tests)

---

## Running it locally

Node 20 or newer.

```bash
npm install
npm run catalog   # fetches listings from archive.org; see the note below
npm run dev
```

Then open <http://localhost:5173>.

The first `npm run catalog` is slow — it makes one request per candidate item
at a polite two per second, and it verifies each file's codec on top of that,
so a cold build of the full dial takes a couple of hours. Every response is cached under `scripts/cache/`, so later runs take a
couple of minutes. The repository ships with a prebuilt `public/catalog/`, so
you can skip the catalogue step entirely and go straight to `npm run dev`.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, then build all three pages to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest, once |
| `npm run test:watch` | Vitest, watching |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run catalog` | Rebuild the catalogue, reusing the cache |
| `npm run catalog:refresh` | Rebuild, ignoring the cache |
| `npm run catalog:strict` | Rebuild, keeping only clearly open-licensed items |

## How it fits together

```
config/
  channels.config.json   the dial, plus the contact sent to archive.org
  site.config.json       project name, tagline and repository URL
scripts/
  build-catalog.ts       queries archive.org, writes public/catalog/
  catalog-parse.ts       pure parsing helpers (runtimes, formats, years)
  archive-client.ts      cache, rate limit and retries
  cache/                 cached API responses (gitignored)
public/catalog/          generated JSON, committed to the repository
src/
  scheduler/             deterministic schedule. No DOM, no network.
  player/                two <video> elements and the logic that swaps them
  guide/                 the programme grid
  ui/                    overlays, CRT effects, remote, settings, help
  pages/                 What's On and About
  styles/
tests/                   Vitest
```

Three things are worth knowing about the design.

**The schedule is a pure function of the clock.** `src/scheduler/` has no DOM or
network access at all. Given a channel and a timestamp it returns the segment
that should be on screen and how far into the file to seek. That is what keeps
every viewer in sync without a server, and it is why the scheduler is the most
heavily tested part of the project.

**A programme is never cut off at midnight.** Each UTC day stops emitting once
it has covered `86400 − carry` seconds, where `carry` is how far the previous
day overran. The overrun then becomes the next day's carry, so days abut exactly
— no gap, no overlap — while each day still re-anchors to the clock instead of
drifting away from it. Those carries chain back to the epoch, so they are
computed once per channel and memoised.

**The picture uses two video elements.** One plays while the other buffers
whatever is next, so programmes and commercials butt up against each other with
no black frame in between. Every thirty seconds the player compares where the
video is against where the scheduler says it should be, and resyncs if they have
drifted more than five seconds apart.

## The channels

Twenty-two channels, grouped by **type and era**, so the same source can feed
two channels at different periods:

| Ch | Channel | Era | |  Ch | Channel | Era |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | Silent Screen | 1890–1929 | | 13 | Mission Control | 1958–2005 |
| 3 | Picture Palace | 1930–1949 | | 14 | Saddle Up | 1920–1979 |
| 4 | Saturday Morning | 1920–1969 | | 15 | Bits and Bytes | 1980–2005 |
| 5 | Noir After Dark | 1940–1959 | | 16 | Case Files | 1930–1969 |
| 6 | Atomic Age | 1945–1969 | | 17 | Coming Attractions | 1920–1989 |
| 7 | Rerun Central | 1945–1969 | | 18 | Showtime | 1930–1969 |
| 8 | Prime Time | 1970–1989 | | 19 | Laugh Track | 1900–1989 |
| 9 | Feature Presentation | 1950–1979 | | 20 | High Adventure | 1930–1969 |
| 10 | Drive-In | 1970–1989 | | 21 | Short Reel | 1900–1989 |
| 11 | Ephemera | –1979 | | 22 | The Front | 1939–1969 |
| 12 | Chalkboard | 1930–1989 | | 23 | Newsreel | 1929–1969 |

Gaps in the numbering are deliberate; a dial with no gaps does not feel like a
television.

Commercials are matched to each channel's era in the browser, from one shared
pool. The matching is lopsided on purpose: it will reach back decades for an
older advert but barely ten years forward, because an old advert on a newer
channel passes unnoticed while a new one on an old channel ruins the effect.
A channel with no era-appropriate adverts runs without breaks rather than
showing a wrong one.

## Adding or editing a channel

Everything lives in `config/channels.config.json`. A channel looks like this:

```json
{
  "number": 5,
  "slug": "midnight-movie",
  "name": "Midnight Movie",
  "description": "Science fiction and horror features",
  "sources": [{ "collection": "SciFi_Horror" }],
  "minDuration": 1200,
  "maxDuration": 9000,
  "commercialBreaks": true
}
```

| Field | Meaning |
| --- | --- |
| `number` | Position on the dial. Any integer; gaps are fine and feel right. |
| `slug` | Filename and PRNG seed. **Changing it reshuffles the channel.** |
| `name`, `description` | Shown in the guide, the info bar and What's On. |
| `sources` | One or more places to draw from (see below). |
| `minDuration`, `maxDuration` | Runtime bounds in seconds. Anything outside is skipped. |
| `minYear`, `maxYear` | The channel's era. Setting either one also excludes anything the builder cannot date. |
| `commercialBreaks` | Whether to insert ad breaks and split long programmes. |
| `maxItems` | Optional per-channel cap. Defaults to the top-level `maxItems` (400). |

Set `maxItems` by runtime, not by habit. A broadcast day is 24 hours, so a
channel of ninety-minute features fills it with a handful of items while a
channel of two-minute trailers needs hundreds. Coming Attractions carries
1,200 for exactly this reason: at 400 it looped twice a day.

Channels are grouped by **type and era**, so the same collection can feed two
channels at different periods: `classic_tv` becomes both Rerun Central
(1945–1969) and Prime Time (1970–1989). Put the year range in the search query
as well as in `minYear`/`maxYear` — the query makes the Archive do the
filtering, which saves thousands of wasted requests:

```json
{ "query": "collection:\"classic_tv\" AND mediatype:movies AND year:[1950 TO 1969]" }
```

A source can be any of three things:

```jsonc
{ "collection": "classic_tv" }                      // an Archive collection
{ "query": "subject:(comedy) AND mediatype:movies" } // a raw Advanced Search query
{ "identifiers": ["item-one", "item-two"] }          // specific items
```

After editing, run `npm run catalog`. New channels need fresh metadata, so
budget a few minutes per channel on the first run.

**Finding collections.** Browse <https://archive.org/details/movies> and take
the identifier from the URL. Check it is not empty before adding it — several
plausible-sounding names return nothing:

```bash
curl -s 'https://archive.org/advancedsearch.php?q=collection%3A%22YOUR_ID%22+AND+mediatype%3Amovies&rows=0&output=json' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["response"]["numFound"])'
```

A channel needs at least twenty-four hours of material to fill a broadcast day
without repeating itself. The builder's summary table prints the total hours per
channel, so check there after a build.

## Keeping unwanted material off the air

Three filters run during the build, configured at the top of
`config/channels.config.json`.

**`maxYear`** is a ceiling for the whole dial (2005 by default). A channel may
set a tighter one. Nothing newer ever reaches the catalogue.

**`requireEnglish`** drops anything whose declared language is not English, and
anything whose title is written in another script. Both are needed: only about
a third of Archive items declare a language at all, so the script check is what
catches, say, an untagged Japanese advert. Items with no declared language are
kept, since rejecting them would discard most of the archive. `silent` and
`zxx` count as English-compatible, which is what keeps Silent Screen working.

**`blockTerms`** is a list matched against each item's title, subject and
description. A trailing asterisk makes a term a stem, so `sexual*` also catches
"sexually" and "sexuality". Matching is otherwise whole-word, so `vd` does not
fire on "advanced". The default list covers childbirth and medical-procedure
films, sex-education and hygiene films, adult material and graphic violence.

```jsonc
"requireEnglish": true,
"maxYear": 2005,
"blockTerms": ["playboy", "nudist", "sexual*", "human birth", "xxx"]
```

Two things to keep in mind when editing it. Terms are matched against
*metadata*, not the video, so something mislabelled or blandly titled can still
slip through — if you spot one, add a term. And broad words cause collateral
damage: `breast*` was in the list until it blocked "Chicken Breast
Preparation". Prefer specific terms over general ones, and run `npm test`,
which pins the known cases both ways.

## The catalogue builder

`scripts/build-catalog.ts` queries the Archive's Advanced Search API, fetches
metadata for each result, picks the best playable file, and writes the JSON the
site loads.

It prefers `h.264`, then `MPEG4`, then `512Kb MPEG4`, and takes only `.mp4`.
Items with no playable file or no parseable runtime are skipped and counted.

**It also verifies the codec.** The Archive's format label is not dependable:
an item tagged `MPEG4` may hold MPEG-4 Part 2, which no browser can decode,
while a `512Kb MPEG4` may be perfectly good H.264. Such a file loads, reports
itself ready, plays its audio and shows a black screen, with no error of any
kind. So for any file the Archive has not labelled as its own `h.264`
derivative, the builder reads the first 256 KB and checks the codec in the
file, skipping anything that is not H.264. This is why a cold build is slow,
and why the cache is worth keeping.

The player carries the same check as a safety net: if a video reports no
dimensions once its metadata has loaded, it is treated as a fault and skipped.

```
--refresh           ignore the cache and refetch everything
--strict-license    keep only clearly open-licensed items
--max-items <n>     override the per-channel cap (default 400)
```

It is deliberately polite: two requests per second, a descriptive `User-Agent`
built from the `contact` field in `config/channels.config.json` so the Archive
can see who is calling — a repository URL does that job without putting a
personal address in a public repo — three retries with backoff, and every
response cached to `scripts/cache/` keyed by URL. **Keep the cache.** Without it
a full rebuild hammers archive.org for a couple of hours; with it, the same
rebuild makes zero network calls.

Each run prints a summary table — items kept, items skipped and why, and total
hours per channel.

### Titles

Archive.org titles are whatever the uploader typed, and bulk institutional
collections tend to upload the filename off the tape: `CMP306_Reflections.wmv`,
`JSC-500 Apollo 8-Go For TLI.wmv`. The guide shows the stored title verbatim,
so `displayTitle` in `scripts/catalog-parse.ts` tidies them as they are built —
it drops a trailing container extension, strips a leading shelf mark such as
`JSC-500` or `HQ220`, and reads underscores as spaces. It is deliberately
conservative: `Rikki-Tikki-Tavi` and `Re-Animator` pass through untouched.

`scripts/retitle-catalog.ts` applies the same function to the catalogue already
on disk, so a change to the rules does not cost a full rebuild. It is
idempotent, and it writes the files minified exactly as the builder does.

## Rights and strict licence mode

The programmes come from Internet Archive collections that generally hold public
domain and openly licensed material, but **this project makes no determination
about the copyright status of anything it links to**. Every programme links back
to its archive.org page from the info bar, the guide and the What's On page;
check there for rights information on anything you care about.

`npm run catalog:strict` keeps only items whose `licenseurl` indicates public
domain or Creative Commons, plus anything from a collection listed in
`alwaysAllow` in the channel config. Even with strict mode off, every build
prints how many items *would* be dropped, so the cost of turning it on is always
visible.

Strict mode is less useful than it sounds, and it is worth understanding why
before relying on it. Uploaders can and do apply a Creative Commons licence to
films they have no right to license, so strict mode waves through some of the
riskiest material while stripping legitimately safe items whose metadata simply
lacks the field. Choosing well-curated collections and capping the year does
more for the rights position than this flag does. Collections known to be full
of uploaded commercial film — `vhsvault` is the clearest example — are better
left off the dial entirely.

That cost is real: on the default line-up strict mode removes roughly 40% of the
catalogue, and some channels lose most of their material. Note also that a
missing `licenseurl` means the metadata field was never filled in — it is not
evidence that an item is restricted, any more than it is evidence that it is
free. Decide deliberately, especially before putting a site somewhere public.

## Keyboard controls

| Key | Action |
| --- | --- |
| <kbd>↑</kbd> <kbd>↓</kbd> | Channel up and down (mouse wheel and swipe also work) |
| <kbd>0</kbd>–<kbd>9</kbd> | Tune directly; waits 1.5s, or press <kbd>Enter</kbd> |
| <kbd>Backspace</kbd> / <kbd>L</kbd> | Previous channel |
| <kbd>I</kbd> | Show the info bar |
| <kbd>←</kbd> <kbd>→</kbd> or <kbd>+</kbd> <kbd>−</kbd> | Volume |
| <kbd>M</kbd> | Mute |
| <kbd>G</kbd> | Programme guide |
| <kbd>S</kbd> | Picture settings |
| <kbd>?</kbd> | Keyboard help |
| <kbd>Esc</kbd> | Close any overlay |

`/?ch=7` tunes straight to channel 7 once the set is switched on.

In television-cabinet mode (Picture settings, or <kbd>S</kbd>) the four dials
on the cabinet are working controls, not decoration: channel, volume, power
and guide. Click a dial, or scroll over it to turn it. Clicking the volume
dial mutes. Each is a real button with a label, and the arrow keys adjust
whichever dial has focus rather than falling through to the channel shortcut.

## Deployment

Hosted on **Vercel**, which serves the site from the domain root. `vercel.json`
sets the build command, enables clean URLs and sets cache headers: hashed assets
are immutable, catalogue JSON is revalidated hourly at the edge.

**First-time setup**

1. Push this repository to GitHub.
2. In Vercel, *Add New Project* and import the repository. The framework preset
   is detected as Vite; the defaults in `vercel.json` cover the rest.
3. Deploy. Pushes to `main` redeploy automatically, and pull requests get
   preview URLs.
4. Edit `repoUrl` in `config/site.config.json` so the *Suggest a channel* links
   point at your repository rather than the placeholder.

No environment variables are needed. `BASE_PATH` exists for hosts that serve
from a subdirectory (GitHub Pages, say) and should be left unset on Vercel.

**Workflows**

`.github/workflows/ci.yml` runs typecheck, tests and a build on every push and
pull request.

`.github/workflows/update-catalog.yml` rebuilds the catalogue every Monday at
04:17 UTC, and on demand via *Run workflow* (where `--refresh` and
`--strict-license` are exposed as checkboxes). It restores `scripts/cache`
between runs, refuses to commit a catalogue with missing or empty channels, and
commits only when something actually changed. That commit is what triggers the
Vercel redeploy — there is no deploy step in the workflow itself.

The workflow needs `contents: write`, which is declared in the file. If pushes
fail, check *Settings → Actions → General → Workflow permissions*.

## Tests

```bash
npm test
```

The scheduler carries the bulk of the coverage, because it is the part that has
to be right: determinism across identical inputs, no gaps or overlaps across a
simulated week, day-boundary continuity checked from both sides, commercial
break structure, and a performance bound on resolving every channel at once.
The guide's time arithmetic and the builder's parsers are tested as pure
functions.

## Credits and licence

All video is served by the [Internet Archive](https://archive.org), a non-profit
library that makes this sort of project possible. If you enjoy this, consider
[donating to them](https://archive.org/donate).

The code is MIT licensed. The visual design is original: no broadcaster names,
logos or character art are used anywhere, and the project is not affiliated with
the Internet Archive or with any television network.
