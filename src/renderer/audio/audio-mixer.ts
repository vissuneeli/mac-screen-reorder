import { AudioAnalyzer } from './audio-analyzer';

export class AudioMixer {
  private ctx: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private gains: Map<string, GainNode> = new Map();
  private analyzers: AudioAnalyzer[] = [];

  constructor() {
    this.ctx = new AudioContext();
    this.destination = this.ctx.createMediaStreamDestination();
  }

  addSource(label: string, stream: MediaStream, gain = 1.0, onLevel?: (level: number) => void) {
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return;
    const source = this.ctx.createMediaStreamSource(new MediaStream(tracks));
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = gain;
    source.connect(gainNode);
    gainNode.connect(this.destination);
    this.gains.set(label, gainNode);

    if (onLevel) {
      const analyzer = new AudioAnalyzer(this.ctx, gainNode);
      analyzer.start(onLevel);
      this.analyzers.push(analyzer);
    }
  }

  setGain(label: string, value: number) {
    const node = this.gains.get(label);
    if (node) node.gain.setValueAtTime(value, this.ctx.currentTime);
  }

  getOutputStream() { return this.destination.stream; }

  close() {
    this.analyzers.forEach(a => a.stop());
    this.analyzers = [];
    this.ctx.close();
  }
}
