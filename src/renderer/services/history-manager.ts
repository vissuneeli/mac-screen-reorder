import { RecordingEntry } from '../types';

export class HistoryManager {
  private static readonly KEY = 'recordingHistory';
  private static readonly MAX = 5;

  static load(): RecordingEntry[] {
    try {
      const stored = localStorage.getItem(this.KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  }

  static add(entry: RecordingEntry): void {
    const history = this.load();
    history.unshift(entry);
    history.splice(this.MAX);
    localStorage.setItem(this.KEY, JSON.stringify(history));
  }

  static remove(path: string): void {
    const history = this.load().filter(r => r.path !== path);
    localStorage.setItem(this.KEY, JSON.stringify(history));
  }
}
