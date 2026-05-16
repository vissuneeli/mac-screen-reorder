export class AudioAnalyzer {
  private analyser: AnalyserNode;
  private dataArray: Uint8Array<ArrayBuffer>;
  private rafId: number | null = null;

  constructor(ctx: AudioContext, source: AudioNode) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);
    const buf = new ArrayBuffer(this.analyser.frequencyBinCount);
    this.dataArray = new Uint8Array(buf);
  }

  start(onUpdate: (level: number) => void) {
    const tick = () => {
      this.analyser.getByteFrequencyData(this.dataArray);
      const avg = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length;
      onUpdate(Math.round((avg / 255) * 100));
      this.rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
