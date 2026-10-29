/**
 * The Retro TV wordmark: a set with rabbit ears, drawn inline so it inherits
 * colour and needs no network request. Entirely original artwork.
 */
export function logoSvg(options: { title?: string; compact?: boolean } = {}): string {
  const label = options.title ?? 'Retro TV';
  const wordmark = options.compact
    ? ''
    : `
    <text x="78" y="33" class="logo-word-retro">RETRO</text>
    <text x="78" y="52" class="logo-word-tv">TV</text>`;
  const width = options.compact ? 68 : 170;

  return `
<svg class="logo" viewBox="0 0 ${width} 62" role="img" aria-label="${label}"
     xmlns="http://www.w3.org/2000/svg" focusable="false">
  <!-- rabbit ears -->
  <path class="logo-ears" d="M30 15 L14 2 M38 15 L56 3" />
  <circle class="logo-ear-tip" cx="13" cy="2" r="2.2" />
  <circle class="logo-ear-tip" cx="57" cy="3" r="2.2" />

  <!-- cabinet -->
  <rect class="logo-cabinet" x="4" y="14" width="60" height="44" rx="7" />
  <!-- screen -->
  <rect class="logo-screen" x="10" y="20" width="38" height="30" rx="5" />
  <!-- scanlines -->
  <g class="logo-scan">
    <path d="M12 26h34 M12 31h34 M12 36h34 M12 41h34" />
  </g>
  <!-- speaker and dials -->
  <circle class="logo-knob" cx="56" cy="27" r="3.4" />
  <circle class="logo-knob" cx="56" cy="38" r="3.4" />
  <path class="logo-feet" d="M14 58v3 M54 58v3" />
  ${wordmark}
</svg>`.trim();
}
