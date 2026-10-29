/**
 * The two noises a television makes that the video itself cannot provide:
 * inter-channel hiss, and the 1 kHz tone that rides on a test card.
 */
export class ToneGenerator {
  private context: AudioContext | null = null;
  private hissBuffer: AudioBuffer | null = null;
  private toneNodes: { osc: OscillatorNode; gain: GainNode } | null = null;
  private volume = 0.8;

  /** Must be called from a user gesture, or the context stays suspended. */
  resume(): void {
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
  }

  private noise(): AudioBuffer | null {
    const ctx = this.context;
    if (!ctx) return null;
    if (this.hissBuffer) return this.hissBuffer;

    const length = Math.floor(ctx.sampleRate * 1.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    this.hissBuffer = buffer;
    return buffer;
  }

  /** A burst of tuning hiss, shaped so it does not stab the ears. */
  hiss(durationMs: number): void {
    const ctx = this.context;
    const buffer = this.noise();
    if (!ctx || !buffer || ctx.state !== 'running') return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1_000;

    const gain = ctx.createGain();
    const peak = 0.05 * this.volume;
    const now = ctx.currentTime;
    const seconds = durationMs / 1000;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.02);
    gain.gain.setValueAtTime(peak, now + seconds - 0.05);
    gain.gain.linearRampToValueAtTime(0, now + seconds);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(now);
    source.stop(now + seconds + 0.02);
  }

  /** The steady test-card tone. Off unless the viewer asks for it. */
  startTone(): void {
    const ctx = this.context;
    if (!ctx || this.toneNodes || ctx.state !== 'running') return;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1_000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.03 * this.volume, ctx.currentTime + 0.1);

    osc.connect(gain).connect(ctx.destination);
    osc.start();
    this.toneNodes = { osc, gain };
  }

  stopTone(): void {
    const nodes = this.toneNodes;
    const ctx = this.context;
    if (!nodes || !ctx) return;
    this.toneNodes = null;
    nodes.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.08);
    nodes.osc.stop(ctx.currentTime + 0.1);
  }
}
