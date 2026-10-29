/** Animated analogue snow, drawn straight onto a canvas. */
import { prefersReducedMotion } from './motion.ts';

const MIN_BURST_MS = 300;
const MAX_BURST_MS = 600;

export class StaticScreen {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private frame = 0;
  private until = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
  }

  /** Runs a burst and resolves when the picture should come back. */
  burst(): Promise<void> {
    const duration = MIN_BURST_MS + Math.random() * (MAX_BURST_MS - MIN_BURST_MS);
    this.canvas.classList.add('is-visible');

    if (prefersReducedMotion()) {
      // A still grey field and a plain fade, rather than flashing noise.
      this.paintFlat();
      return new Promise((resolve) => {
        window.setTimeout(() => {
          this.canvas.classList.remove('is-visible');
          resolve();
        }, 180);
      });
    }

    this.until = performance.now() + duration;
    if (this.frame === 0) this.frame = requestAnimationFrame(() => this.tick());

    return new Promise((resolve) => {
      window.setTimeout(() => resolve(), duration * 0.6);
    });
  }

  private tick(): void {
    if (performance.now() >= this.until) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.canvas.classList.remove('is-visible');
      return;
    }
    this.paintNoise();
    this.frame = requestAnimationFrame(() => this.tick());
  }

  /** Low-resolution noise, stretched by CSS, so the grain reads as chunky. */
  private paintNoise(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width, height } = this.sizeToElement();
    const image = ctx.createImageData(width, height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const value = Math.random() * 255;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  private paintFlat(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width, height } = this.sizeToElement();
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, width, height);
  }

  private sizeToElement(): { width: number; height: number } {
    const width = 160;
    const height = 120;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    return { width, height };
  }
}
