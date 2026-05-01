import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  openScreenPrivacySettings: () => ipcRenderer.invoke('open-screen-privacy-settings'),
  saveRecording: (data: { buffer: ArrayBuffer; filename: string }) =>
    ipcRenderer.invoke('save-recording', data),
});
