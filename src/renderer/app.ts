interface DisplayInfo {
  id: string;
  name: string;
  displayId: string;
  isPrimary: boolean;
  bounds: { width: number; height: number; x: number; y: number };
}

class AudioMixer {
  private ctx: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private gains: Map<string, GainNode> = new Map();

  constructor() {
    this.ctx = new AudioContext();
    this.destination = this.ctx.createMediaStreamDestination();
  }

  addSource(label: string, stream: MediaStream, gain = 1.0) {
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return;
    const source = this.ctx.createMediaStreamSource(new MediaStream(tracks));
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = gain;
    source.connect(gainNode);
    gainNode.connect(this.destination);
    this.gains.set(label, gainNode);
  }

  setGain(label: string, value: number) {
    const node = this.gains.get(label);
    if (node) node.gain.setValueAtTime(value, this.ctx.currentTime);
  }

  getOutputStream() { return this.destination.stream; }
  close() { this.ctx.close(); }
}

class RecorderApp {
  private displays: DisplayInfo[] = [];
  private selectedDisplayId: string | null = null;
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
    const micGain = document.getElementById('mic-gain') as HTMLInputElement;
    micGain.addEventListener('input', () => {
      this.audioMixer?.setGain('microphone', parseInt(micGain.value) / 100);
    });
    await this.loadDisplays();
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
      });

      list.appendChild(item);
    });
  }

  private async captureScreen(withAudio: boolean): Promise<MediaStream> {
    // Use getDisplayMedia — this properly triggers the macOS screen picker & permission dialog
    const constraints: DisplayMediaStreamOptions = {
      video: { frameRate: 30 },
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
        } catch {
          throw err;
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

    this.setStatus('System audio not supported on this setup. Recording selected screen + mic.', '');
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

      const screenStream = await this.captureScreen(systemAudioEnabled);
      this.activeStreams.push(screenStream);

      if (systemAudioEnabled && screenStream.getAudioTracks().length > 0) {
        this.audioMixer.addSource('system', screenStream);
      }

      if (micEnabled) {
        try {
          const micStream = await this.captureMicrophone();
          this.activeStreams.push(micStream);
          this.audioMixer.addSource('microphone', micStream, micGainValue);
        } catch {
          console.warn('Microphone access denied');
        }
      }

      const mixedAudio = this.audioMixer.getOutputStream();
      const combined = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...mixedAudio.getAudioTracks(),
      ]);

      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(combined, {
        mimeType: 'video/webm;codecs=vp9,opus',
        videoBitsPerSecond: 2_500_000,
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
    try {
      const result = await window.electronAPI.saveRecording({ buffer, filename });
      this.setStatus(`Saved → ${result.path}`, 'saved');
    } catch {
      this.setStatus('Failed to save recording', '');
    }
    this.cleanup();
  }

  private cleanup() {
    this.activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
    this.activeStreams = [];
    this.audioMixer?.close();
    this.audioMixer = null;
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
