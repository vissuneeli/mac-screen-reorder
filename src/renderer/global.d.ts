interface ElectronAPI {
  getDisplays: () => Promise<DisplayInfo[]>;
  getDesktopSources: () => Promise<Array<{ id: string; name: string; display_id: string }>>;
  openScreenPrivacySettings: () => Promise<void>;
  saveRecording: (data: { buffer: ArrayBuffer; filename: string; folder?: string }) => Promise<{ success: boolean; path: string }>;
  pickOutputFolder: () => Promise<string | null>;
  getDefaultOutput: () => Promise<string>;
  revealFile: (path: string) => Promise<void>;
  deleteFile: (path: string) => Promise<{ success: boolean }>;
  streamChunk: (data: { sessionId: string; chunk: ArrayBuffer; folder?: string }) => Promise<{ success: boolean }>;
  finalizeRecording: (data: { sessionId: string; filename: string; folder?: string }) => Promise<{ success: boolean; path: string; size: number; error?: string }>;
  cleanupSession: (sessionId: string) => Promise<void>;
}

interface Window {
  electronAPI: ElectronAPI;
}
