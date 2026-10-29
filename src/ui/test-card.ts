/**
 * "Please Stand By" card: SMPTE-style colour bars drawn to canvas, shown
 * whenever the picture is lost. Original rendering, no broadcaster marks.
 */
const TOP_BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
const MID_BARS = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
const BOTTOM = [
  { color: '#00214c', width: 5 / 28 },
  { color: '#ffffff', width: 5 / 28 },
  { color: '#32006a', width: 5 / 28 },
  { color: '#131313', width: 5 / 28 },
  { color: '#090909', width: 1 / 28 },
  { color: '#131313', width: 1 / 28 },
  { color: '#1d1d1d', width: 1 / 28 },
  { color: '#131313', width: 5 / 28 },
];

export function drawTestCard(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = 640;
  const height = 480;
  canvas.width = width;
  canvas.height = height;

  const topHeight = height * 0.67;
  const midHeight = height * 0.08;
  const barWidth = width / TOP_BARS.length;

  TOP_BARS.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(i * barWidth, 0, barWidth + 1, topHeight);
  });

  MID_BARS.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(i * barWidth, topHeight, barWidth + 1, midHeight);
  });

  let x = 0;
  for (const band of BOTTOM) {
    ctx.fillStyle = band.color;
    const w = band.width * width;
    ctx.fillRect(x, topHeight + midHeight, w + 1, height - topHeight - midHeight);
    x += w;
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, height * 0.4, width, height * 0.16);
  ctx.fillStyle = '#eaeaea';
  ctx.font = '600 44px "VT323", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PLEASE STAND BY', width / 2, height * 0.48);
}
