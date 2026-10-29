/** Single source of truth for whether we are allowed to animate. */
const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Queried fresh each time rather than cached, so a preference changed
 * mid-session takes effect on the next transition instead of the next reload.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : false;
}

export function onMotionPreferenceChange(handler: () => void): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  window.matchMedia(QUERY).addEventListener('change', handler);
}
