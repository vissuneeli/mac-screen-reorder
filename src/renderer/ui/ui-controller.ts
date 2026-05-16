import { RecordingService } from '../services/recording-service';
import { DisplayManager } from '../services/display-manager';
import { SettingsStore } from '../services/settings-store';
import { HistoryManager } from '../services/history-manager';
import { StatusView } from './status-view';
import { DisplayInfo, RecordingEntry } from '../types';

interface FileAPI {
  pickOutputFolder(): Promise<string | null>;
  getDefaultOutput(): Promise<string>;
  revealFile(path: string): Promise<{ exists: boolean }>;
  deleteFile(path: string): Promise<{ success: boolean }>;
}

export class UIController {
  private outputFolder: string | null = null;
  private defaultOutputPath = '';
  private elapsedAtPause = 0;

  constructor(
    private recording: RecordingService,
    private display: DisplayManager,
    private status: StatusView,
    private api: FileAPI,
  ) {}

  async init(): Promise<void> {
    this.defaultOutputPath = await this.api.getDefaultOutput();

    this.wireRecordingCallbacks();

    const displayListEl = document.getElementById('display-list')!;
    displayListEl.innerHTML = '<p class="loading">Loading displays...</p>';
    try {
      const displays = await this.display.load();
      this.renderDisplayList(displays);
    } catch (err) {
      displayListEl.innerHTML = `<p class="loading">Error: ${(err as Error).message}</p>`;
    }

    this.applySettings();
    this.wireControls();
    this.refreshRecentList();
  }

  // ── Recording callbacks ──────────────────────────────────────────────────

  private wireRecordingCallbacks(): void {
    this.recording.onStopping = () => {
      this.setBusy();
      this.status.stopTimer();
      this.status.setStatus('Saving...', '');
    };

    this.recording.onSaved = (entry: RecordingEntry) => {
      HistoryManager.add(entry);
      this.refreshRecentList();
      this.status.setStatus(`Saved → ${entry.path}`, 'saved');
      this.setIdle();
    };

    this.recording.onError = (message: string) => {
      this.status.setStatus(message, '');
      this.setIdle();
    };

    this.recording.onStatusMessage = (message: string) => {
      this.status.setStatus(message, '');
    };

    this.recording.onSystemLevel = (level: number) => {
      (document.getElementById('system-meter') as HTMLElement).style.width = level + '%';
    };

    this.recording.onMicLevel = (level: number) => {
      (document.getElementById('mic-meter') as HTMLElement).style.width = level + '%';
    };

    this.recording.onAudioActive = (active: boolean) => {
      document.getElementById('audio-meters')!.style.display = active ? 'flex' : 'none';
      if (!active) {
        (document.getElementById('system-meter') as HTMLElement).style.width = '0%';
        (document.getElementById('mic-meter') as HTMLElement).style.width = '0%';
      }
    };
  }

  // ── Event wiring ─────────────────────────────────────────────────────────

  private wireControls(): void {
    document.getElementById('start-btn')!.addEventListener('click', () => this.handleStart());
    document.getElementById('pause-btn')!.addEventListener('click', () => this.handlePause());
    document.getElementById('stop-btn')!.addEventListener('click', () => this.handleStop());
    document.getElementById('output-btn')!.addEventListener('click', () => this.pickOutputFolder());

    const micGainSlider = document.getElementById('mic-gain') as HTMLInputElement;
    micGainSlider.addEventListener('input', () => {
      this.recording.setMicGain(parseInt(micGainSlider.value) / 100);
    });
    micGainSlider.addEventListener('change', () => {
      SettingsStore.update('micGain', parseInt(micGainSlider.value));
    });

    (document.getElementById('capture-system-audio') as HTMLInputElement).addEventListener('change', (e) => {
      SettingsStore.update('systemAudioEnabled', (e.target as HTMLInputElement).checked);
    });
    (document.getElementById('capture-microphone') as HTMLInputElement).addEventListener('change', (e) => {
      SettingsStore.update('microphoneEnabled', (e.target as HTMLInputElement).checked);
    });

    document.querySelectorAll<HTMLInputElement>('input[name="quality"]').forEach(radio => {
      radio.addEventListener('change', () => {
        SettingsStore.update('qualityLevel', radio.value as 'low' | 'medium' | 'high');
      });
    });
  }

  // ── Button handlers ──────────────────────────────────────────────────────

  private async handleStart(): Promise<void> {
    this.setBusy();
    this.status.setStatus('Preparing...', '');
    try {
      await this.status.showCountdown();
      const settings = SettingsStore.load();
      await this.recording.start({
        quality: settings.qualityLevel,
        systemAudio: (document.getElementById('capture-system-audio') as HTMLInputElement).checked,
        micEnabled: (document.getElementById('capture-microphone') as HTMLInputElement).checked,
        micGain: parseInt((document.getElementById('mic-gain') as HTMLInputElement).value),
        outputFolder: this.outputFolder ?? undefined,
      });
      this.status.startTimer();
      this.setRecording();
      this.status.setStatus('Recording...', 'recording');
    } catch (err) {
      this.status.setStatus((err as Error).message, '');
      this.setIdle();
    }
  }

  private handlePause(): void {
    if (this.recording.isPaused) {
      this.recording.resume();
      this.status.resumeTimer(this.elapsedAtPause);
      (document.getElementById('pause-btn') as HTMLButtonElement).textContent = 'Pause';
      this.status.setStatus('Recording...', 'recording');
    } else {
      this.elapsedAtPause = this.status.getElapsedMs();
      this.recording.pause();
      this.status.pauseTimer();
      (document.getElementById('pause-btn') as HTMLButtonElement).textContent = 'Resume';
      this.status.setStatus('Paused', 'paused');
    }
  }

  private handleStop(): void {
    this.recording.stop();
  }

  // ── UI state helpers ─────────────────────────────────────────────────────

  private setIdle(): void {
    document.getElementById('start-btn')!.removeAttribute('disabled');
    document.getElementById('pause-btn')!.setAttribute('disabled', '');
    (document.getElementById('pause-btn') as HTMLButtonElement).textContent = 'Pause';
    document.getElementById('stop-btn')!.setAttribute('disabled', '');
  }

  private setRecording(): void {
    document.getElementById('start-btn')!.setAttribute('disabled', '');
    document.getElementById('pause-btn')!.removeAttribute('disabled');
    document.getElementById('stop-btn')!.removeAttribute('disabled');
  }

  private setBusy(): void {
    document.getElementById('start-btn')!.setAttribute('disabled', '');
    document.getElementById('pause-btn')!.setAttribute('disabled', '');
    document.getElementById('stop-btn')!.setAttribute('disabled', '');
  }

  // ── Display rendering ────────────────────────────────────────────────────

  private renderDisplayList(displays: DisplayInfo[]): void {
    const list = document.getElementById('display-list')!;
    list.innerHTML = '';
    displays.forEach((display, i) => {
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
        this.display.select(display.id);
        SettingsStore.update('lastSelectedDisplay', display.id);
      });
      list.appendChild(item);
    });
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  private applySettings(): void {
    const settings = SettingsStore.load();
    (document.getElementById('capture-system-audio') as HTMLInputElement).checked = settings.systemAudioEnabled;
    (document.getElementById('capture-microphone') as HTMLInputElement).checked = settings.microphoneEnabled;
    (document.getElementById('mic-gain') as HTMLInputElement).value = String(settings.micGain);

    const qualityRadio = document.querySelector<HTMLInputElement>(`input[name="quality"][value="${settings.qualityLevel}"]`);
    if (qualityRadio) qualityRadio.checked = true;

    this.outputFolder = settings.outputFolder;
    this.updateOutputDisplay();

    if (settings.lastSelectedDisplay) {
      const radio = document.querySelector<HTMLInputElement>(`input[name="display"][value="${settings.lastSelectedDisplay}"]`);
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
      }
    }
  }

  private async pickOutputFolder(): Promise<void> {
    const folder = await this.api.pickOutputFolder();
    if (folder) {
      this.outputFolder = folder;
      SettingsStore.update('outputFolder', folder);
      this.updateOutputDisplay();
    }
  }

  private updateOutputDisplay(): void {
    const el = document.getElementById('output-path')!;
    const fullPath = this.outputFolder || this.defaultOutputPath;
    const homePrefix = this.defaultOutputPath.split('/').slice(0, -1).join('/');
    el.textContent = fullPath.replace(homePrefix, '~');
  }

  // ── Recent recordings list ───────────────────────────────────────────────

  private refreshRecentList(): void {
    const history = HistoryManager.load();
    const section = document.getElementById('recent-section')!;
    const list = document.getElementById('recent-list')!;

    if (history.length === 0) { section.style.display = 'none'; return; }
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
      item.querySelector('.reveal-btn')!.addEventListener('click', async () => {
        const result = await this.api.revealFile(rec.path);
        if (!result.exists) { HistoryManager.remove(rec.path); this.refreshRecentList(); }
      });
      item.querySelector('.delete-btn')!.addEventListener('click', async () => {
        await this.api.deleteFile(rec.path);
        HistoryManager.remove(rec.path);
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
}
