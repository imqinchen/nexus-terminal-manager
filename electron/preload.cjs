const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  isElectron: true,
  backendUrl: 'http://127.0.0.1:4317',
  getWslStatus: () => ipcRenderer.invoke('wsl-status'),
  getTerminalProfiles: () => ipcRenderer.invoke('terminal-profiles'),
  startWslBackend: () => ipcRenderer.invoke('start-wsl-backend'),
  focusMainWindow: () => ipcRenderer.invoke('focus-main-window'),
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  setAppSettings: (settings) => ipcRenderer.invoke('set-app-settings', settings),
  onAppSettingsChanged: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('app-settings-changed', listener);
    return () => ipcRenderer.removeListener('app-settings-changed', listener);
  },
  installTmux: (language) => ipcRenderer.invoke('install-tmux', language),
  backendRequest: (request) => ipcRenderer.invoke('backend-request', request),
  copyText: (value) => ipcRenderer.invoke('copy-text', value),
  readClipboardText: () => ipcRenderer.invoke('read-clipboard-text'),
  exportCommandLibrary: (commands) => ipcRenderer.invoke('export-command-library', commands),
  importCommandLibrary: () => ipcRenderer.invoke('import-command-library'),
  selectDirectory: (shellType) => ipcRenderer.invoke('select-directory', shellType),
  openLogDirectory: () => ipcRenderer.invoke('open-log-directory'),
  openLogFile: (serverId) => ipcRenderer.invoke('open-log-file', serverId),
  openHelpDocument: () => ipcRenderer.invoke('open-help-document'),
});
