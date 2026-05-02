class Settings {
  private static readonly STORAGE_KEY = 'screenRecorderSettings';

  private static getDefaults() {
    return {
      systemAudioEnabled: true,
      microphoneEnabled: true,
      micGain: 80,
      lastSelectedDisplay: null as string | null,
      qualityLevel: 'medium' as 'low' | 'medium' | 'high',
      outputFolder: null as string | null,
    };
  }

  static load() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) return { ...this.getDefaults(), ...JSON.parse(stored) };
    } catch { /* ignore corrupt data */ }
    return this.getDefaults();
  }

  private static save(settings: ReturnType<typeof Settings.getDefaults>) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
  }

  static updateSystemAudio(enabled: boolean) {
    const s = this.load(); s.systemAudioEnabled = enabled; this.save(s);
  }
  static updateMicrophone(enabled: boolean) {
    const s = this.load(); s.microphoneEnabled = enabled; this.save(s);
  }
  static updateMicGain(gain: number) {
    const s = this.load(); s.micGain = gain; this.save(s);
  }
  static updateLastDisplay(displayId: string | null) {
    const s = this.load(); s.lastSelectedDisplay = displayId; this.save(s);
  }
  static updateQuality(level: 'low' | 'medium' | 'high') {
    const s = this.load(); s.qualityLevel = level; this.save(s);
  }
  static updateOutputFolder(folder: string | null) {
    const s = this.load(); s.outputFolder = folder; this.save(s);
  }
}

interface RecordingEntry {
  filename: string;
  path: string;
  timestamp: number;
  size: number;
  duration: string;
}

class RecordingHistory {
  private static readonly KEY = 'recordingHistory';
  private static readonly MAX = 5;

  static load(): RecordingEntry[] {
    try {
      const stored = localStorage.getItem(this.KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  }

  static add(entry: RecordingEntry) {
    const history = this.load();
    history.unshift(entry);
    history.splice(this.MAX);
    localStorage.setItem(this.KEY, JSON.stringify(history));
  }

  static remove(path: string) {
    const history = this.load().filter(r => r.path !== path);
    localStorage.setItem(this.KEY, JSON.stringify(history));
  }
}

type QualityLevel = 'low' | 'medium' | 'high';
const QUALITY_PRESETS: Record<QualityLevel, { bitrate: number; framerate: number }> = {
  low:    { bitrate: 1_500_000, framerate: 24 },
  medium: { bitrate: 2_500_000, framerate: 30 },
  high:   { bitrate: 5_000_000, framerate: 60 },
};

interface DisplayInfo {
  id: string;
  name: string;
  displayId: string;
  isPrimary: boolean;
  bounds: { width: number; height: number; x: number; y: number };
}

class AudioAnalyzer {
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

class AudioMixer {
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

class RecorderApp {
  private displays: DisplayInfo[] = [];
  private selectedDisplayId: string | null = null;
  private selectedQuality: QualityLevel = 'medium';
  private outputFolder: string | null = null;
  private defaultOutputPath = '';
  private isRecording = false;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private audioMixer: AudioMixer | null = null;
  private activeStreams: MediaStream[] = [];
  private timerInterval: number | null = null;
  private startTime = 0;

  async init() {
    document.getElementById('start-btn')!.addEventListener('click', () => this.startRecording());
    document.getElementById('stop-btn')!.addEventListener('click', () => this.stopRecording());

    const systemAudioCb = document.getElementById('capture-system-audio') as HTMLInputElement;
    const micCb = document.getElementById('capture-microphone') as HTMLInputElement;
    const micGainSlider = document.getElementById('mic-gain') as HTMLInputElement;

    // Live mic gain adjustment during recording
    micGainSlider.addEventListener('input', () => {
      this.audioMixer?.setGain('microphone', parseInt(micGainSlider.value) / 100);
    });

    // Persist settings on change
    systemAudioCb.addEventListener('change', () => Settings.updateSystemAudio(systemAudioCb.checked));
    micCb.addEventListener('change', () => Settings.updateMicrophone(micCb.checked));
    micGainSlider.addEventListener('change', () => Settings.updateMicGain(parseInt(micGainSlider.value)));

    document.querySelectorAll<HTMLInputElement>('input[name="quality"]').forEach(radio => {
      radio.addEventListener('change', () => {
        this.selectedQuality = radio.value as QualityLevel;
        Settings.updateQuality(this.selectedQuality);
      });
    });

    document.getElementById('output-btn')!.addEventListener('click', () => this.pickOutputFolder());

    // Load displays, then restore saved settings
    this.defaultOutputPath = await window.electronAPI.getDefaultOutput();
    await this.loadDisplays();
    this.applySettings();
    this.refreshRecentList();
  }

  private applySettings() {
    const settings = Settings.load();

    (document.getElementById('capture-system-audio') as HTMLInputElement).checked = settings.systemAudioEnabled;
    (document.getElementById('capture-microphone') as HTMLInputElement).checked = settings.microphoneEnabled;
    (document.getElementById('mic-gain') as HTMLInputElement).value = String(settings.micGain);

    this.selectedQuality = settings.qualityLevel;
    const qualityRadio = document.querySelector<HTMLInputElement>(`input[name="quality"][value="${settings.qualityLevel}"]`);
    if (qualityRadio) qualityRadio.checked = true;

    this.outputFolder = settings.outputFolder;
    this.updateOutputDisplay();

    if (settings.lastSelectedDisplay) {
      const radio = document.querySelector(
        `input[name="display"][value="${settings.lastSelectedDisplay}"]`
      ) as HTMLInputElement | null;
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
        this.selectedDisplayId = settings.lastSelectedDisplay;
      }
    }
  }

  async loadDisplays() {
    const list = document.getElementById('display-list')!;
    list.innerHTML = '<p class="loading">Loading displays...</p>';
    try {
      this.displays = await window.electronAPI.getDisplays();
      this.renderDisplayList();
    } catch (err) {
      list.innerHTML = `<p class="loading">Error: ${(err as Error).message}</p>`;
    }
  }

  private renderDisplayList() {
    const list = document.getElementById('display-list')!;
    list.innerHTML = '';

    this.displays.forEach((display, i) => {
      if (i === 0) this.selectedDisplayId = display.id;

      const item = document.createElement('label');
      item.className = 'display-item' + (i === 0 ? ' selected' : '');
      item.innerHTML = `
        <input type="radio" name="display" value="${display.id}" ${i === 0 ? 'checked' : ''}>
        <div class="display-info">
          <span class="display-name">${display.name}${display.isPrimary ? ' ★' : ''}</span>
          <span class="display-res">${display.bounds.width}×${display.bounds.height}</span>
        </div>
      `;

      item.querySelector('input')!.addEventListener('change', () => {
        document.querySelectorAll('.display-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        this.selectedDisplayId = display.id;
        Settings.updateLastDisplay(display.id);
      });

      list.appendChild(item);
    });
  }

  private async captureScreen(withAudio: boolean): Promise<MediaStream> {
    const preset = QUALITY_PRESETS[this.selectedQuality];
    const constraints: DisplayMediaStreamOptions = {
      video: { frameRate: preset.framerate },
      audio: withAudio,
    };
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      return stream;
    } catch (err) {
      if (
        withAudio &&
        err instanceof DOMException &&
        err.name === 'NotSupportedError'
      ) {
        try {
          return await this.captureScreenViaDesktopSource();
        } catch (fallbackErr) {
          throw fallbackErr;
        }
      }
      throw err;
    }
  }

  private async captureScreenViaDesktopSource(): Promise<MediaStream> {
    const desktopSources = await window.electronAPI.getDesktopSources();

    const selectedDisplayNum = this.selectedDisplayId?.split(':')[1] ?? null;
    const matchingSource =
      desktopSources.find((s) => selectedDisplayNum !== null && s.display_id === selectedDisplayNum) ??
      desktopSources[0];

    if (!matchingSource) {
      throw new Error('No desktop source available for screen capture');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // Electron desktop capture constraints
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: matchingSource.id,
        } as any,
      } as MediaTrackConstraints,
    });

    this.setStatus('System audio not supported on this setup. Continuing with selected screen capture.', '');
    return stream;
  }

  private async captureMicrophone(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
    });
  }

  private async startRecording() {
    if (!this.selectedDisplayId && this.displays.length === 0) {
      this.setStatus('No display selected', '');
      return;
    }

    const systemAudioEnabled = (document.getElementById('capture-system-audio') as HTMLInputElement).checked;
    const micEnabled = (document.getElementById('capture-microphone') as HTMLInputElement).checked;
    const micGainValue = parseInt((document.getElementById('mic-gain') as HTMLInputElement).value) / 100;

    try {
      this.setStatus('Select the screen to record in the picker...', '');
      this.audioMixer = new AudioMixer();

      const systemMeterEl = document.getElementById('system-meter')!;
      const micMeterEl = document.getElementById('mic-meter')!;
      document.getElementById('audio-meters')!.style.display = 'flex';

      const screenStream = await this.captureScreen(systemAudioEnabled);
      this.activeStreams.push(screenStream);

      if (systemAudioEnabled && screenStream.getAudioTracks().length > 0) {
        this.audioMixer.addSource('system', screenStream, 1.0, (level) => {
          systemMeterEl.style.width = level + '%';
        });
      }

      if (micEnabled) {
        try {
          const micStream = await this.captureMicrophone();
          this.activeStreams.push(micStream);
          this.audioMixer.addSource('microphone', micStream, micGainValue, (level) => {
            micMeterEl.style.width = level + '%';
          });
        } catch {
          console.warn('Microphone access denied');
        }
      }

      const mixedAudio = this.audioMixer.getOutputStream();
      const combined = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...mixedAudio.getAudioTracks(),
      ]);

      // Countdown before recording starts
      await this.showCountdown();

      this.recordedChunks = [];
      const preset = QUALITY_PRESETS[this.selectedQuality];
      this.mediaRecorder = new MediaRecorder(combined, {
        mimeType: 'video/webm;codecs=vp9,opus',
        videoBitsPerSecond: preset.bitrate,
      });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };
      this.mediaRecorder.onstop = () => this.handleStop();

      // Stop recording if user clicks "Stop sharing" in the browser bar
      screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        if (this.isRecording) this.stopRecording();
      });

      this.mediaRecorder.start(1000);
      this.isRecording = true;
      this.startTimer();
      document.getElementById('start-btn')!.setAttribute('disabled', '');
      document.getElementById('stop-btn')!.removeAttribute('disabled');
      this.setStatus('Recording...', 'recording');

    } catch (err) {
      console.error(err);
      this.setStatus(`${(err as Error).message}`, '');
      this.cleanup();
    }
  }

  private async stopRecording() {
    if (!this.mediaRecorder || !this.isRecording) return;
    this.setStatus('Saving...', '');
    this.mediaRecorder.stop();
    this.isRecording = false;
    this.stopTimer();
    document.getElementById('start-btn')!.removeAttribute('disabled');
    document.getElementById('stop-btn')!.setAttribute('disabled', '');
  }

  private async handleStop() {
    const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
    const buffer = await blob.arrayBuffer();
    const filename = `recording-${Date.now()}.webm`;
    const duration = document.getElementById('timer')!.textContent || '00:00:00';
    try {
      const result = await window.electronAPI.saveRecording({
        buffer,
        filename,
        folder: this.outputFolder || undefined,
      });

      RecordingHistory.add({
        filename,
        path: result.path,
        timestamp: Date.now(),
        size: buffer.byteLength,
        duration,
      });
      this.refreshRecentList();

      this.setStatus(`Saved → ${result.path}`, 'saved');
    } catch {
      this.setStatus('Failed to save recording', '');
    }
    this.cleanup();
  }

  private async pickOutputFolder() {
    const folder = await window.electronAPI.pickOutputFolder();
    if (folder) {
      this.outputFolder = folder;
      Settings.updateOutputFolder(folder);
      this.updateOutputDisplay();
    }
  }

  private updateOutputDisplay() {
    const el = document.getElementById('output-path')!;
    const fullPath = this.outputFolder || this.defaultOutputPath;
    const homeParts = this.defaultOutputPath.split('/').slice(0, -1).join('/');
    el.textContent = fullPath.replace(homeParts, '~');
  }

  private async showCountdown(): Promise<void> {
    const el = document.getElementById('countdown')!;
    el.style.display = 'block';
    this.setStatus('Starting in...', '');

    for (let i = 3; i > 0; i--) {
      el.textContent = String(i);
      el.classList.remove('active');
      void el.offsetWidth;
      el.classList.add('active');
      await new Promise(r => setTimeout(r, 1000));
    }

    el.style.display = 'none';
    el.classList.remove('active');
  }

  private refreshRecentList() {
    const history = RecordingHistory.load();
    const section = document.getElementById('recent-section')!;
    const list = document.getElementById('recent-list')!;

    if (history.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    list.innerHTML = '';

    history.forEach(rec => {
      const item = document.createElement('div');
      item.className = 'recording-item';

      const date = new Date(rec.timestamp);
      const dateStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

      item.innerHTML = `
        <div class="recording-info">
          <span class="recording-filename">${rec.filename}</span>
          <span class="recording-meta">${dateStr} · ${this.formatSize(rec.size)} · ${rec.duration}</span>
        </div>
        <div class="recording-actions">
          <button class="rec-action-btn reveal-btn">Show</button>
          <button class="rec-action-btn delete-btn">Del</button>
        </div>
      `;

      item.querySelector('.reveal-btn')!.addEventListener('click', () => {
        window.electronAPI.revealFile(rec.path);
      });

      item.querySelector('.delete-btn')!.addEventListener('click', async () => {
        await window.electronAPI.deleteFile(rec.path);
        RecordingHistory.remove(rec.path);
        this.refreshRecentList();
      });

      list.appendChild(item);
    });
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  private cleanup() {
    this.activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
    this.activeStreams = [];
    this.audioMixer?.close();
    this.audioMixer = null;
    document.getElementById('audio-meters')!.style.display = 'none';
    document.getElementById('system-meter')!.style.width = '0%';
    document.getElementById('mic-meter')!.style.width = '0%';
  }

  private setStatus(text: string, cls: string) {
    const el = document.getElementById('status-text')!;
    el.textContent = text;
    el.className = cls;
  }

  private startTimer() {
    this.startTime = Date.now();
    const el = document.getElementById('timer')!;
    el.style.display = 'block';
    this.timerInterval = window.setInterval(() => {
      const ms = Date.now() - this.startTime;
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }, 1000);
  }

  private stopTimer() {
    if (this.timerInterval !== null) { clearInterval(this.timerInterval); this.timerInterval = null; }
    document.getElementById('timer')!.style.display = 'none';
  }
}

window.addEventListener('DOMContentLoaded', () => new RecorderApp().init());
