/**
 * The picture-settings dialog. Uses a native <dialog> so focus trapping,
 * Escape-to-close and the backdrop come from the platform rather than from
 * hand-rolled keyboard handling.
 */
import { DEFAULT_EFFECTS } from '../state.ts';
import type { Effects } from '../state.ts';
import { prefersReducedMotion } from './motion.ts';

interface ToggleSpec {
  key: keyof Effects;
  label: string;
  hint: string;
}

const TOGGLES: ToggleSpec[] = [
  { key: 'scanlines', label: 'Scanlines', hint: 'Fine horizontal lines across the picture.' },
  { key: 'curvature', label: 'Screen curve and vignette', hint: 'Rounded corners and darkened edges, like a real tube.' },
  { key: 'fringing', label: 'Colour fringing', hint: 'Slight red and blue misalignment at the edges of the screen.' },
  { key: 'flicker', label: 'Flicker', hint: 'An occasional dip in brightness. Disabled automatically if you prefer reduced motion.' },
  { key: 'glow', label: 'Phosphor glow', hint: 'A soft halo of light around the picture.' },
  { key: 'cabinet', label: 'Television cabinet', hint: 'Set the screen into a wooden console with knobs and a speaker grille.' },
  { key: 'testTone', label: 'Test card tone', hint: 'Play a 1 kHz tone whenever the Please Stand By card is showing.' },
];

export class SettingsPanel {
  private readonly dialog: HTMLDialogElement;
  private readonly inputs = new Map<keyof Effects, HTMLInputElement>();
  private readonly onChange: (effects: Effects) => void;
  private effects: Effects;

  constructor(
    dialog: HTMLDialogElement,
    effects: Effects,
    onChange: (effects: Effects) => void,
  ) {
    this.dialog = dialog;
    this.effects = { ...effects };
    this.onChange = onChange;
    this.render();

    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
  }

  private render(): void {
    const list = this.dialog.querySelector('#settings-list') as HTMLElement;
    const reduced = prefersReducedMotion();

    for (const spec of TOGGLES) {
      const row = document.createElement('label');
      row.className = 'settings-row';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = this.effects[spec.key];
      input.addEventListener('change', () => this.set(spec.key, input.checked));

      const text = document.createElement('span');
      text.className = 'settings-text';

      const label = document.createElement('span');
      label.className = 'settings-label';
      label.textContent = spec.label;

      const hint = document.createElement('span');
      hint.className = 'settings-hint';
      hint.textContent =
        spec.key === 'flicker' && reduced
          ? 'Held steady because your system asks for reduced motion.'
          : spec.hint;

      text.append(label, hint);
      row.append(input, text);
      list.append(row);
      this.inputs.set(spec.key, input);
    }

    this.dialog.querySelector('[data-settings="reset"]')?.addEventListener('click', () => {
      this.effects = { ...DEFAULT_EFFECTS };
      for (const [key, input] of this.inputs) input.checked = this.effects[key];
      this.onChange({ ...this.effects });
    });
  }

  private set(key: keyof Effects, value: boolean): void {
    this.effects = { ...this.effects, [key]: value };
    this.onChange({ ...this.effects });
  }

  toggle(): void {
    if (this.dialog.open) this.dialog.close();
    else this.dialog.showModal();
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }
}

/** Mirrors the effect flags onto the TV element for the stylesheet to read. */
export function applyEffects(tv: HTMLElement, effects: Effects): void {
  for (const key of Object.keys(DEFAULT_EFFECTS) as (keyof Effects)[]) {
    if (key === 'testTone') continue; // audio, not a picture effect
    tv.dataset[key] = effects[key] ? 'on' : 'off';
  }
}
