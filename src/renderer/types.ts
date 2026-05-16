export type QualityLevel = 'low' | 'medium' | 'high';

export const QUALITY_PRESETS: Record<QualityLevel, { bitrate: number; framerate: number }> = {
  low:    { bitrate: 1_500_000, framerate: 24 },
  medium: { bitrate: 2_500_000, framerate: 30 },
  high:   { bitrate: 5_000_000, framerate: 60 },
};

export interface DisplayInfo {
  id: string;
  name: string;
  displayId: string;
  isPrimary: boolean;
  bounds: { width: number; height: number; x: number; y: number };
  thumbnail?: string; // data URI from desktopCapturer, if available
}

export interface RecordingEntry {
  filename: string;
  path: string;
  timestamp: number;
  size: number;
  duration: string;
}

export interface AppSettings {
  systemAudioEnabled: boolean;
  microphoneEnabled: boolean;
  micGain: number;
  micDeviceId: string | null;
  lastSelectedDisplay: string | null;
  qualityLevel: QualityLevel;
  outputFolder: string | null;
}

export interface RecorderState {
  isRecording: boolean;
  isPaused: boolean;
}
