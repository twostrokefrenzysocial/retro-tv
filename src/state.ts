/** Viewer preferences that survive a reload. Storage may be unavailable. */

/** Picture effects, each switchable from the settings panel. */
export interface Effects {
  scanlines: boolean;
  curvature: boolean;
  fringing: boolean;
  flicker: boolean;
  glow: boolean;
  /** Wrap the screen in a television cabinet. */
  cabinet: boolean;
  /** The 1 kHz tone that rides on the test card. */
  testTone: boolean;
}

export interface Prefs {
  lastChannel: number | null;
  volume: number;
  muted: boolean;
  effects: Effects;
}

const KEY = 'retro-tv:prefs';

/** Everything on but subtle, except the cabinet and the tone. */
export const DEFAULT_EFFECTS: Effects = {
  scanlines: true,
  curvature: true,
  fringing: true,
  flicker: true,
  glow: true,
  cabinet: false,
  testTone: false,
};

const DEFAULTS: Prefs = {
  lastChannel: null,
  volume: 0.8,
  muted: false,
  effects: { ...DEFAULT_EFFECTS },
};

function readEffects(raw: unknown): Effects {
  const source = (raw ?? {}) as Partial<Record<keyof Effects, unknown>>;
  const out = { ...DEFAULT_EFFECTS };
  for (const key of Object.keys(DEFAULT_EFFECTS) as (keyof Effects)[]) {
    if (typeof source[key] === 'boolean') out[key] = source[key];
  }
  return out;
}

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, effects: { ...DEFAULT_EFFECTS } };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      lastChannel: typeof parsed.lastChannel === 'number' ? parsed.lastChannel : null,
      volume:
        typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULTS.volume,
      muted: parsed.muted === true,
      effects: readEffects(parsed.effects),
    };
  } catch {
    return { ...DEFAULTS, effects: { ...DEFAULT_EFFECTS } };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing, quota, blocked storage: preferences just don't stick.
  }
}
