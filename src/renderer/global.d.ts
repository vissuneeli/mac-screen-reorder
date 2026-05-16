// Ambient declarations — no imports allowed here (would turn this into a module)

interface DisplayInfo {
  id: string;
  name: string;
  displayId: string;
  isPrimary: boolean;
  bounds: { width: number; height: number; x: number; y: number };
}

interface DisplayAPI {
  getDisplays(): Promise<DisplayInfo[]>;
  getDesktopSources(): Promise<Array<{ id: string; name: string; display_id: string; thumbnail: string | null }>>;
}

interface RecordingAPI {
  streamChunk(data: { sessionId: string; chunk: ArrayBuffer; folder?: string }): Promise<{ success: boolean }>;
  finalizeRecording(data: { sessionId: string; filename: string; folder?: string }): Promise<{ success: boolean; path: string; size: number; error?: string }>;
  cleanupSession(sessionId: string): Promise<void>;
  saveRecording(data: { buffer: ArrayBuffer; filename: string; folder?: string }): Promise<{ success: boolean; path: string }>;
}

interface FileAPI {
  checkFile(path: string): Promise<{ exists: boolean }>;
  revealFile(path: string): Promise<{ exists: boolean }>;
  deleteFile(path: string): Promise<{ success: boolean }>;
}

interface PermissionAPI {
  openScreenPrivacySettings(): Promise<void>;
  pickOutputFolder(): Promise<string | null>;
  getDefaultOutput(): Promise<string>;
}

interface TrayAPI {
  updateTray(state: { isRecording: boolean; isPaused: boolean }): Promise<void>;
  onTrayCommand(callback: (command: string) => void): void;
}

interface ElectronAPI extends DisplayAPI, RecordingAPI, FileAPI, PermissionAPI, TrayAPI {}

interface Window {
  electronAPI: ElectronAPI;
}
