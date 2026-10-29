/** The keyboard reference, shown on "?". */

interface Shortcut {
  keys: string[];
  what: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['↑', '↓'], what: 'Channel up and down (mouse wheel and swipe work too)' },
  { keys: ['0–9'], what: 'Tune directly; waits a moment, or press Enter' },
  { keys: ['Enter'], what: 'Tune to the digits you have typed' },
  { keys: ['Backspace', 'L'], what: 'Back to the previous channel' },
  { keys: ['I'], what: 'Show what is on' },
  { keys: ['←', '→'], what: 'Volume down and up' },
  { keys: ['+', '−'], what: 'Volume down and up' },
  { keys: ['M'], what: 'Mute' },
  { keys: ['G'], what: 'Open the programme guide' },
  { keys: ['S'], what: 'Picture settings' },
  { keys: ['?'], what: 'This list' },
  { keys: ['Esc'], what: 'Close the guide, settings or this list' },
];

export class HelpOverlay {
  private readonly dialog: HTMLDialogElement;

  constructor(dialog: HTMLDialogElement) {
    this.dialog = dialog;
    this.render();
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
    this.dialog.querySelector('[data-help="close"]')?.addEventListener('click', () => {
      this.dialog.close();
    });
  }

  private render(): void {
    const list = this.dialog.querySelector('.help-list') as HTMLElement;
    list.replaceChildren(
      ...SHORTCUTS.flatMap((shortcut) => {
        const dt = document.createElement('dt');
        for (const key of shortcut.keys) {
          const kbd = document.createElement('kbd');
          kbd.textContent = key;
          dt.append(kbd);
        }
        const dd = document.createElement('dd');
        dd.textContent = shortcut.what;
        return [dt, dd];
      }),
    );
  }

  toggle(): void {
    if (this.dialog.open) this.dialog.close();
    else this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }
}
