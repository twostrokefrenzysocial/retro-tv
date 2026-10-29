/** Pure time arithmetic for the guide grid, kept separate so it is testable. */

export const SLOT_MINUTES = 30;
export const SLOT_MS = SLOT_MINUTES * 60_000;
export const SLOT_COUNT = 6; // three hours
export const WINDOW_MS = SLOT_MS * SLOT_COUNT;

/** The half hour `timestamp` falls in, rounded down. */
export function windowStart(timestamp: number): number {
  return Math.floor(timestamp / SLOT_MS) * SLOT_MS;
}

export interface Placement {
  /** Percentage from the left edge of the grid. */
  left: number;
  /** Percentage of the grid's width. */
  width: number;
  /** True when the block is cut off by the start or end of the window. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * Where a block sits in a window, clamped to it. Returns null when the block
 * lies entirely outside.
 */
export function placeBlock(
  blockStart: number,
  blockEnd: number,
  from: number,
  to: number,
): Placement | null {
  if (blockEnd <= from || blockStart >= to) return null;

  const span = to - from;
  const visibleStart = Math.max(blockStart, from);
  const visibleEnd = Math.min(blockEnd, to);

  return {
    left: ((visibleStart - from) / span) * 100,
    width: ((visibleEnd - visibleStart) / span) * 100,
    clippedStart: blockStart < from,
    clippedEnd: blockEnd > to,
  };
}

/** Column headings: "7:00", "7:30", ... */
export function slotLabels(from: number, count = SLOT_COUNT): { ms: number; label: string }[] {
  return Array.from({ length: count }, (_, i) => {
    const ms = from + i * SLOT_MS;
    return {
      ms,
      label: new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    };
  });
}
