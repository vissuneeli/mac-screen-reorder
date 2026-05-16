import { QualityLevel, QUALITY_PRESETS, RecordingEntry } from '../types';
import { AudioMixer } from '../audio/audio-mixer';
import { DisplayManager } from './display-manager';

interface RecordingAPI {
  streamChunk(data: { sessionId: string; chunk: ArrayBuffer; folder?: string }): Promise<{ success: boolean }>;
  finalizeRecording(data: { sessionId: string; filename: string; folder?: string }): Promise<{ success: boolean; path: string; size: number; error?: string }>;
  cleanupSession(sessionId: string): Promise<void>;
}

export interface RecordingStartOpts {
  quality: QualityLevel;
  systemAudio: boolean;
  micEnabled: boolean;
  micGain: number;
  micDeviceId?: string | null;
  outputFolder?: string;
}

export class RecordingService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioMixer: AudioMixer | null = null;
  private activeStreams: MediaStream[] = [];
  private currentSessionId: string | null = null;
  private chunkWriteQueue: Promise<void> = Promise.resolve();
  private _isPaused = false;
  private recordingStartTime = 0;
  private pausedMs = 0;
  private pauseStart = 0;
  private currentOutputFolder?: string;

  // Callbacks — set by UIController
  onSaved?: (entry: RecordingEntry) => void;
  onError?: (message: string) => void;
  onStatusMessage?: (message: string) => void;
  onStopping?: () => void;
  onSystemLevel?: (level: number) => void;
  onMicLevel?: (level: number) => void;
  onAudioActive?: (active: boolean) => void;

  constructor(
    private api: RecordingAPI,
    private displayManager: DisplayManager,
  ) {}

  get isActive(): boolean {
    return this.mediaRecorder !== null;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  async start(opts: RecordingStartOpts): Promise<void> {
    const preset = QUALITY_PRESETS[opts.quality];
    this.currentOutputFolder = opts.outputFolder;
    this.recordingStartTime = 0;
    this.pausedMs = 0;
    this._isPaused = false;

    try {
      this.audioMixer = new AudioMixer();
      this.onAudioActive?.(true);

      const screenStream = await this.captureScreen(opts.systemAudio, preset.framerate);
      this.activeStreams.push(screenStream);

      if (opts.systemAudio && screenStream.getAudioTracks().length > 0) {
        this.audioMixer.addSource('system', screenStream, 1.0, (level) => this.onSystemLevel?.(level));
      }

      if (opts.micEnabled) {
        try {
          const micStream = await this.captureMicrophone(opts.micDeviceId ?? undefined);
          this.activeStreams.push(micStream);
          this.audioMixer.addSource('microphone', micStream, opts.micGain / 100, (level) => this.onMicLevel?.(level));
        } catch {
          // Microphone access denied — continue without it
        }
      }

      const combined = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...this.audioMixer.getOutputStream().getAudioTracks(),
      ]);

      this.currentSessionId = `session-${Date.now()}`;
      this.chunkWriteQueue = Promise.resolve();

      this.mediaRecorder = new MediaRecorder(combined, {
        mimeType: 'video/webm;codecs=vp9,opus',
        videoBitsPerSecond: preset.bitrate,
      });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && this.currentSessionId) {
          const sessionId = this.currentSessionId;
          const folder = this.currentOutputFolder;
          this.chunkWriteQueue = this.chunkWriteQueue.then(async () => {
            const buffer = await e.data.arrayBuffer();
            await this.api.streamChunk({ sessionId, chunk: buffer, folder });
          });
        }
      };

      this.mediaRecorder.onstop = () => this.handleStop();

      const videoTrack = screenStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          if (this.isActive) this.stop();
        });
      }

      this.recordingStartTime = Date.now();
      this.mediaRecorder.start(1000);
    } catch (err) {
      this.cleanup();
      throw err;
    }
  }

  setMicGain(value: number): void {
    this.audioMixer?.setGain('microphone', value);
  }

  pause(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;
    this.mediaRecorder.pause();
    this._isPaused = true;
    this.pauseStart = Date.now();
  }

  resume(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'paused') return;
    this.mediaRecorder.resume();
    this._isPaused = false;
    this.pausedMs += Date.now() - this.pauseStart;
  }

  stop(): void {
    if (!this.mediaRecorder) return;
    if (this._isPaused) {
      this.mediaRecorder.resume();
      this.pausedMs += Date.now() - this.pauseStart;
      this._isPaused = false;
    }
    this.onStopping?.();
    this.mediaRecorder.stop();
  }

  cleanup(): void {
    this.activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
    this.activeStreams = [];
    this.audioMixer?.close();
    this.audioMixer = null;
    this.onAudioActive?.(false);
  }

  private getDuration(): string {
    if (this.recordingStartTime === 0) return '00:00:00';
    const ms = Date.now() - this.recordingStartTime - this.pausedMs;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  private async captureScreen(withAudio: boolean, framerate: number): Promise<MediaStream> {
    // Prefer desktop-capturer path to enforce the selected display
    const selected = this.displayManager.getSelected();
    if (selected) {
      try {
        const sourceId = await this.displayManager.getDesktopSourceId(selected.id);
        if (sourceId) {
          return await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxFrameRate: framerate } as any,
            } as MediaTrackConstraints,
          });
        }
      } catch { /* fall through */ }
    }

    // Fallback: system picker via getDisplayMedia
    try {
      return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: framerate }, audio: withAudio });
    } catch (err) {
      if (withAudio && err instanceof DOMException && err.name === 'NotSupportedError') {
        this.onStatusMessage?.('System audio not supported on this setup.');
        return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: framerate }, audio: false });
      }
      throw err;
    }
  }

  private captureMicrophone(deviceId?: string): Promise<MediaStream> {
    const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 };
    if (deviceId) audio.deviceId = { exact: deviceId };
    return navigator.mediaDevices.getUserMedia({ audio });
  }

  private async handleStop(): Promise<void> {
    const filename = `recording-${Date.now()}.webm`;
    const duration = this.getDuration();
    const sessionId = this.currentSessionId;
    this.mediaRecorder = null;
    this.currentSessionId = null;

    try {
      await this.chunkWriteQueue;
      if (!sessionId) throw new Error('No active session');

      const result = await this.api.finalizeRecording({
        sessionId,
        filename,
        folder: this.currentOutputFolder,
      });
      if (!result.success) throw new Error(result.error ?? 'Failed to save');

      this.onSaved?.({ filename, path: result.path, timestamp: Date.now(), size: result.size, duration });
    } catch (err) {
      this.onError?.((err as Error).message);
      if (sessionId) await this.api.cleanupSession(sessionId);
    }

    this.cleanup();
  }
}
