import { RecordingService } from '../services/recording-service';
import { DisplayManager } from '../services/display-manager';
import { SettingsStore } from '../services/settings-store';
import { HistoryManager } from '../services/history-manager';
import { StatusView } from './status-view';
import { DisplayInfo, RecordingEntry } from '../types';

const ICON = {
  pause:  `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="currentColor"><rect x="1.5" y="0.5" width="2.5" height="9" rx="0.8"/><rect x="6" y="0.5" width="2.5" height="9" rx="0.8"/></svg>`,
  resume: `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="currentColor"><polygon points="1.5,0.5 9.5,5 1.5,9.5"/></svg>`,
  reveal: `<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V8"/><path d="M8 1h4v4M12 1L6 7"/></svg>`,
  trash:  `<svg width="12" height="13" viewBox="0 0 12 13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3.5h10M4.5 3.5v-1a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M2.5 3.5l.75 7.5h5.5l.75-7.5"/></svg>`,
};

interface FileAPI {
  checkFile(path: string): Promise<{ exists: boolean }>;
  pickOutputFolder(): Promise<string | null>;
  getDefaultOutput(): Promise<string>;
  revealFile(path: string): Promise<{ exists: boolean }>;
  deleteFile(path: string): Promise<{ success: boolean }>;
  updateTray(state: { isRecording: boolean; isPaused: boolean }): Promise<void>;
  onTrayCommand(callback: (command: string) => void): void;
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

    this.api.onTrayCommand((command) => {
      if (command === 'stop') this.handleStop();
      else if (command === 'toggle-pause') this.handlePause();
    });

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
      this.api.updateTray({ isRecording: false, isPaused: false });
    };

    this.recording.onSaved = (entry: RecordingEntry) => {
      HistoryManager.add(entry);
      this.refreshRecentList();
      this.status.setStatus(`Saved → ${entry.path}`, 'saved');
      this.setIdle();
    };

    this.recording.onError = (message: string) => {
      this.status.setStatus(message, '');
      this.api.updateTray({ isRecording: false, isPaused: false });
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
      this.api.updateTray({ isRecording: true, isPaused: false });
    } catch (err) {
      this.status.setStatus((err as Error).message, '');
      this.setIdle();
    }
  }

  private handlePause(): void {
    if (this.recording.isPaused) {
      this.recording.resume();
      this.status.resumeTimer(this.elapsedAtPause);
      (document.getElementById('pause-btn') as HTMLButtonElement).innerHTML = `${ICON.pause} Pause`;
      this.status.setStatus('Recording...', 'recording');
      this.api.updateTray({ isRecording: true, isPaused: false });
    } else {
      this.elapsedAtPause = this.status.getElapsedMs();
      this.recording.pause();
      this.status.pauseTimer();
      (document.getElementById('pause-btn') as HTMLButtonElement).innerHTML = `${ICON.resume} Resume`;
      this.status.setStatus('Paused', 'paused');
      this.api.updateTray({ isRecording: true, isPaused: true });
    }
  }

  private handleStop(): void {
    this.recording.stop();
  }

  // ── UI state helpers ─────────────────────────────────────────────────────

  private setIdle(): void {
    document.getElementById('start-btn')!.removeAttribute('disabled');
    document.getElementById('pause-btn')!.setAttribute('disabled', '');
    (document.getElementById('pause-btn') as HTMLButtonElement).innerHTML = `${ICON.pause} Pause`;
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
    const savedId = SettingsStore.load().lastSelectedDisplay;
    displays.forEach((display, i) => {
      const isSelected = savedId ? display.id === savedId : i === 0;
      const item = document.createElement('label');
      item.className = 'display-item' + (isSelected ? ' selected' : '');
      const preview = display.thumbnail
        ? `<img src="${display.thumbnail}" alt="">`
        : `<div class="display-thumb-placeholder">No preview</div>`;
      item.innerHTML = `
        <input type="radio" name="display" value="${display.id}" ${isSelected ? 'checked' : ''}>
        ${preview}
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

  private async refreshRecentList(): Promise<void> {
    const history = HistoryManager.load();
    const section = document.getElementById('recent-section')!;
    const list = document.getElementById('recent-list')!;

    if (history.length === 0) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    list.innerHTML = '';

    // Batch-check all file paths in parallel
    const existenceResults = await Promise.all(history.map(rec => this.api.checkFile(rec.path)));

    history.forEach((rec, i) => {
      const exists = existenceResults[i].exists;
      const item = document.createElement('div');
      item.className = 'recording-item' + (exists ? '' : ' recording-missing');
      const date = new Date(rec.timestamp);
      const dateStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

      if (exists) {
        item.innerHTML = `
          <div class="recording-info">
            <span class="recording-filename">${rec.filename}</span>
            <span class="recording-meta">${dateStr} · ${this.formatSize(rec.size)} · ${rec.duration}</span>
          </div>
          <div class="recording-actions">
            <button class="rec-action-btn reveal-btn" title="Reveal in Finder">${ICON.reveal}</button>
            <button class="rec-action-btn delete-btn" title="Move to Trash">${ICON.trash}</button>
          </div>
        `;
        item.querySelector('.reveal-btn')!.addEventListener('click', async () => {
          const result = await this.api.revealFile(rec.path);
          if (!result.exists) { HistoryManager.remove(rec.path); this.refreshRecentList(); }
        });
        item.querySelector('.delete-btn')!.addEventListener('click', async () => {
          if (!confirm(`Move "${rec.filename}" to Trash?`)) return;
          await this.api.deleteFile(rec.path);
          HistoryManager.remove(rec.path);
          this.refreshRecentList();
        });
      } else {
        item.innerHTML = `
          <div class="recording-info">
            <span class="recording-filename">${rec.filename} <span class="badge-missing">File missing</span></span>
            <span class="recording-meta">${dateStr} · ${this.formatSize(rec.size)} · ${rec.duration}</span>
          </div>
          <div class="recording-actions">
            <button class="rec-action-btn remove-btn" title="Remove from list">${ICON.trash}</button>
          </div>
        `;
        item.querySelector('.remove-btn')!.addEventListener('click', () => {
          HistoryManager.remove(rec.path);
          this.refreshRecentList();
        });
      }

      list.appendChild(item);
    });
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
