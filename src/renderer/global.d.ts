interface ElectronAPI {
  getDisplays: () => Promise<DisplayInfo[]>;
  getDesktopSources: () => Promise<Array<{ id: string; name: string; display_id: string }>>;
  openScreenPrivacySettings: () => Promise<void>;
  saveRecording: (data: { buffer: ArrayBuffer; filename: string; folder?: string }) => Promise<{ success: boolean; path: string }>;
  pickOutputFolder: () => Promise<string | null>;
  getDefaultOutput: () => Promise<string>;
}

interface Window {
  electronAPI: ElectronAPI;
}
