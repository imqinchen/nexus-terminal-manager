const fs = require('fs');
const os = require('os');
const path = require('path');

function normalizeGuid(value) {
  return String(value || '').replace(/[{}]/g, '').toLowerCase();
}

function settingsCandidates() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return [
    path.join(localAppData, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    path.join(localAppData, 'Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
  ];
}

function readTerminalSettings() {
  for (const settingsPath of settingsCandidates()) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, ''));
      return { settings, settingsPath };
    } catch {
      // Try the next installed Terminal channel.
    }
  }
  return { settings: null, settingsPath: null };
}

function detectWslDistro() {
  if (process.env.NEXUS_WSL_DISTRO) {
    return { distro: process.env.NEXUS_WSL_DISTRO, source: 'environment', settingsPath: null };
  }
  if (process.platform !== 'win32') {
    return { distro: null, source: 'linux-host', settingsPath: null };
  }
  const { settings, settingsPath } = readTerminalSettings();
  const profiles = settings?.profiles?.list || [];
  const defaultProfile = profiles.find((profile) => normalizeGuid(profile.guid) === normalizeGuid(settings.defaultProfile));
  const wslProfile = defaultProfile?.source === 'Windows.Terminal.Wsl'
    ? defaultProfile
    : profiles.find((profile) => profile.source === 'Windows.Terminal.Wsl');
  return { distro: wslProfile?.name || 'Ubuntu', source: wslProfile ? 'windows-terminal' : 'fallback', settingsPath };
}

module.exports = { detectWslDistro, readTerminalSettings };
