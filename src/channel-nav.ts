/**
 * Pure channel-dial arithmetic, kept apart from the fetching so it can be
 * tested without a network. `list` is always sorted, lowest number first.
 */
export interface DialEntry {
  number: number;
}

/** The nearest existing channel at or after `number`, wrapping to the start. */
export function resolveNumber<T extends DialEntry>(list: T[], number: number): number | null {
  if (list.length === 0) return null;
  const exact = list.find((c) => c.number === number);
  if (exact) return exact.number;
  const next = list.find((c) => c.number > number);
  return (next ?? (list[0] as T)).number;
}

/** One click up or down the dial, wrapping at either end. */
export function stepNumber<T extends DialEntry>(
  list: T[],
  from: number,
  direction: 1 | -1,
): number | null {
  if (list.length === 0) return null;
  const i = list.findIndex((c) => c.number === from);
  if (i === -1) return resolveNumber(list, from);
  const target = (i + direction + list.length) % list.length;
  return (list[target] as T).number;
}
