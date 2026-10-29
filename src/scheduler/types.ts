import type { CatalogItem } from '../types.ts';

export type SegmentType = 'program' | 'commercial';

/** One uninterrupted stretch of one file, pinned to wall-clock air times. */
export interface Segment {
  type: SegmentType;
  identifier: string;
  title: string;
  year: number | null;
  filename: string;
  /** Seconds into the source file where this segment begins. */
  fileStart: number;
  /** Seconds into the source file where this segment ends. */
  fileEnd: number;
  airStartMs: number;
  airEndMs: number;
  /** Index of the programme this segment belongs to within its broadcast day. */
  programIndex: number;
}

export interface NowPlaying {
  segment: Segment;
  /** Seconds to add to `segment.fileStart` to land at the live position. */
  seekSeconds: number;
  endsAtMs: number;
  nextSegment: Segment | null;
}

/** A programme as the guide shows it: its own breaks folded in. */
export interface ProgramBlock {
  identifier: string;
  title: string;
  year: number | null;
  airStartMs: number;
  airEndMs: number;
}

/** Everything the scheduler needs about a channel. No DOM, no network. */
export interface SchedulerChannel {
  slug: string;
  commercialBreaks: boolean;
  items: CatalogItem[];
  commercials: CatalogItem[];
}
