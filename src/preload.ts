import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  openScreenPrivacySettings: () => ipcRenderer.invoke('open-screen-privacy-settings'),
  saveRecording: (data: { buffer: ArrayBuffer; filename: string; folder?: string }) =>
    ipcRenderer.invoke('save-recording', data),
  pickOutputFolder: () => ipcRenderer.invoke('pick-output-folder'),
  getDefaultOutput: () => ipcRenderer.invoke('get-default-output'),
  checkFile: (path: string) => ipcRenderer.invoke('check-file', path),
  revealFile: (path: string) => ipcRenderer.invoke('reveal-file', path),
  deleteFile: (path: string) => ipcRenderer.invoke('delete-file', path),
  streamChunk: (data: { sessionId: string; chunk: ArrayBuffer; folder?: string }) =>
    ipcRenderer.invoke('stream-chunk', data),
  finalizeRecording: (data: { sessionId: string; filename: string; folder?: string }) =>
    ipcRenderer.invoke('finalize-recording', data),
  cleanupSession: (sessionId: string) => ipcRenderer.invoke('cleanup-session', sessionId),
  updateTray: (state: { isRecording: boolean; isPaused: boolean }) =>
    ipcRenderer.invoke('tray-update', state),
  onTrayCommand: (callback: (command: string) => void) =>
    ipcRenderer.on('tray-command', (_event, command) => callback(command)),
});
