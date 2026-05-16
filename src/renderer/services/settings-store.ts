import { AppSettings, QualityLevel } from '../types';

export class SettingsStore {
  private static readonly KEY = 'screenRecorderSettings';

  private static getDefaults(): AppSettings {
    return {
      systemAudioEnabled: true,
      microphoneEnabled: true,
      micGain: 80,
      lastSelectedDisplay: null,
      qualityLevel: 'medium' as QualityLevel,
      outputFolder: null,
    };
  }

  static load(): AppSettings {
    try {
      const stored = localStorage.getItem(this.KEY);
      if (stored) return { ...this.getDefaults(), ...JSON.parse(stored) };
    } catch { /* ignore corrupt data */ }
    return this.getDefaults();
  }

  static update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    const s = this.load();
    s[key] = value;
    localStorage.setItem(this.KEY, JSON.stringify(s));
  }
}
