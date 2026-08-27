const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFile } = require('child_process');
const { detectWslDistro } = require('../backend/wsl-config.cjs');

const BACKEND_PORT = Number(process.env.NEXUS_PTY_PORT || 4317);
const BACKEND_HOST = process.env.NEXUS_PTY_HOST || '127.0.0.1';
let mainWindow;
let backendProcess;
let backendManaged = false;
let quitting = false;

if (app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'Nexus Control'));

process.on('uncaughtException', (error) => console.error('[main] uncaught exception', error));
process.on('unhandledRejection', (error) => console.error('[main] unhandled rejection', error));

function runtimeDataPaths() {
  const sourceBackendDir = path.join(__dirname, '..', 'backend');
  const dataDir = app.isPackaged ? path.join(path.dirname(process.execPath), 'data') : sourceBackendDir;
  return {
    sourceBackendDir,
    dataDir,
    configPath: path.join(dataDir, 'servers.json'),
    logDir: path.join(dataDir, 'logs'),
  };
}

function ensureRuntimeData() {
  const paths = runtimeDataPaths();
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(paths.logDir, { recursive: true });
  if (!fs.existsSync(paths.configPath)) {
    fs.copyFileSync(path.join(paths.sourceBackendDir, 'servers.example.json'), paths.configPath);
  }
  return paths;
}

function requestBackend(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : undefined;
    const request = http.request({
      host: BACKEND_HOST,
      port: BACKEND_PORT,
      path: endpoint,
      method: options.method || 'GET',
      timeout: options.timeout || 2500,
      headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : undefined,
    }, (response) => {
      let output = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { output += chunk; });
      response.on('end', () => {
        let value = output;
        try { value = output ? JSON.parse(output) : {}; } catch { /* preserve text response */ }
        if ((response.statusCode || 500) >= 400 && response.statusCode !== 207) {
          reject(Object.assign(new Error(value?.error || `backend HTTP ${response.statusCode}`), { statusCode: response.statusCode, payload: value }));
          return;
        }
        resolve(value);
      });
    });
    request.on('timeout', () => request.destroy(new Error('backend request timed out')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function toWslPath(windowsPath) {
  const normalized = path.resolve(windowsPath).replace(/\\/g, '/');
  const drive = normalized.slice(0, 1).toLowerCase();
  return `/mnt/${drive}${normalized.slice(2)}`;
}

function legacyToWslGuestPath(selectedPath, distro) {
  const value = String(selectedPath || '');
  const uncPattern = new RegExp(`^\\\\\\\\wsl(?:\\$|\\.localhost)\\\\${String(distro || 'Ubuntu').replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?:\\\\(.*))?$`, 'i');
  const uncMatch = value.match(uncPattern);
  if (uncMatch) return `/${(uncMatch[1] || '').replace(/\\/g, '/')}`.replace(/\/+/g, '/');
  return /^[A-Za-z]:[\\/]/.test(value) ? toWslPath(value) : value;
}

function toWslGuestPath(selectedPath, distro) {
  const value = String(selectedPath || '');
  const normalized = value.replace(/\\/g, '/');
  const distroName = String(distro || 'Ubuntu').toLowerCase();
  for (const prefix of [`//wsl$/${distroName}`, `//wsl.localhost/${distroName}`]) {
    if (normalized.toLowerCase() === prefix) return '/';
    if (normalized.toLowerCase().startsWith(`${prefix}/`)) return normalized.slice(prefix.length) || '/';
  }
  return /^[A-Za-z]:[\\/]/.test(value) ? toWslPath(value) : value;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function waitForBackend(timeout = 10000) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      requestBackend('/health', { timeout: 1000 }).then((health) => resolve(health)).catch(() => {
        if (Date.now() - startedAt >= timeout) {
          resolve(null);
          return;
        }
        setTimeout(check, 250);
      });
    };
    check();
  });
}

function attachBackendOutput(child) {
  child.stdout?.on('data', (data) => console.log(`[wsl] ${String(data).trimEnd()}`));
  child.stderr?.on('data', (data) => console.error(`[wsl] ${String(data).trimEnd()}`));
  child.on('error', (error) => console.error('[wsl] backend process error', error.message));
  child.on('exit', (code, signal) => {
    console.log(`[wsl] backend exited code=${code} signal=${signal || 'none'}`);
    if (child === backendProcess) backendProcess = undefined;
  });
}

async function startWslBackend() {
  const distroConfig = detectWslDistro();
  const existing = await waitForBackend(500);
  if (existing?.ok && existing.capabilities?.platform === 'win32') {
    backendManaged = false;
    return { started: false, reused: true, available: true, distro: existing.distro || distroConfig.distro, health: existing };
  }
  if (existing?.ok) {
    try { await requestBackend('/api/shutdown', { method: 'POST', timeout: 1500 }); } catch { /* stale backend may exit first */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  const paths = ensureRuntimeData();
  const child = spawn(process.execPath, [path.join(paths.sourceBackendDir, 'server.cjs')], {
    cwd: paths.dataDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NEXUS_CONFIG_PATH: paths.configPath,
      NEXUS_LOG_DIR: paths.logDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  backendProcess = child;
  backendManaged = true;
  attachBackendOutput(child);
  const health = await waitForBackend(10000);
  if (!health?.ok) {
    console.error('[backend] local terminal backend did not become healthy');
    try { child.kill(); } catch { /* already exited */ }
    backendProcess = undefined;
    backendManaged = false;
    return { started: false, available: false, distro: distroConfig.distro, reason: 'health-timeout' };
  }
  return { started: true, available: true, distro: health.distro || distroConfig.distro, health };
}

async function stopWslBackend() {
  if (!backendManaged && !backendProcess) return;
  try { await requestBackend('/api/shutdown', { method: 'POST', timeout: 1500 }); } catch { /* backend may already be down */ }
  if (backendProcess) {
    try { backendProcess.kill(); } catch { /* already exited */ }
    backendProcess = undefined;
  }
  backendManaged = false;
}

function createWindow() {
  console.log('[main] creating window');
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#0b1117',
    show: false,
    title: 'Nexus Control',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  console.log('[main] loading', devUrl || 'dist/index.html');
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => console.error('[renderer] failed to load', code, description));
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('wsl-status', async () => {
  const distroConfig = detectWslDistro();
  const health = await requestBackend('/health', { timeout: 1500 }).catch(() => null);
  if (process.platform !== 'win32' || !distroConfig.distro) return { available: false, backend: health?.ok === true, distro: distroConfig.distro, source: distroConfig.source, health };
  return await new Promise((resolve) => {
    execFile('wsl.exe', ['-d', distroConfig.distro, '--', 'true'], { timeout: 2500, windowsHide: true }, (error) => {
      resolve({ available: !error, backend: health?.ok === true, distro: distroConfig.distro, source: distroConfig.source, health, error: error?.message });
    });
  });
});

ipcMain.handle('start-wsl-backend', () => startWslBackend());
ipcMain.handle('install-tmux', async (_event, language = 'zh-CN') => {
  if (process.platform !== 'win32') return { ok: false, error: 'tmux installation is only supported from Windows WSL.' };
  const distro = detectWslDistro().distro;
  if (!distro) return { ok: false, error: 'No WSL distribution was detected.' };
  const isZh = language === 'zh-CN';
  const run = (args, timeout = 900000) => new Promise((resolve) => {
    execFile('wsl.exe', ['-d', distro, '--user', 'root', '--', ...args], {
      timeout,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
  const existing = await run(['tmux', '-V'], 10000);
  if (!existing.error) {
    const health = await requestBackend('/api/capabilities/reload', { method: 'POST', timeout: 10000 }).catch(() => null);
    return { ok: true, alreadyInstalled: true, distro, output: existing.stdout.trim(), health };
  }
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: [isZh ? '安装 tmux' : 'Install tmux', isZh ? '取消' : 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: isZh ? '安装 WSL 依赖' : 'Install WSL dependency',
    message: isZh ? `将在 ${distro} 中安装 tmux` : `Install tmux in ${distro}`,
    detail: isZh
      ? `Nexus 将以 WSL root 用户执行：\napt-get update\napt-get install -y tmux\n\n此操作会修改 ${distro} 的软件包。`
      : `Nexus will run as the WSL root user:\napt-get update\napt-get install -y tmux\n\nThis changes packages inside ${distro}.`,
  });
  if (confirmation.response !== 0) return { ok: false, canceled: true, distro };
  const update = await run(['apt-get', 'update']);
  if (update.error) {
    const output = `${update.stdout}\n${update.stderr}`.trim();
    return { ok: false, distro, stage: 'update', error: output.slice(-1600) || update.error.message, output };
  }
  const install = await run(['apt-get', 'install', '-y', 'tmux']);
  if (install.error) {
    const output = `${install.stdout}\n${install.stderr}`.trim();
    return { ok: false, distro, stage: 'install', error: output.slice(-1600) || install.error.message, output };
  }
  const health = await requestBackend('/api/capabilities/reload', { method: 'POST', timeout: 10000 }).catch(() => null);
  return { ok: true, distro, output: `${update.stdout}\n${install.stdout}`.trim(), health };
});
ipcMain.handle('backend-request', (_event, request) => requestBackend(request.path, request));
ipcMain.handle('terminal-profiles', () => {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const pathEntries = String(process.env.Path || '').split(path.delimiter).filter(Boolean);
  const findOnPath = (name) => pathEntries.map((entry) => path.join(entry, name)).find((candidate) => fs.existsSync(candidate)) || '';
  return {
    powershell: fs.existsSync(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')),
    pwsh: Boolean(findOnPath('pwsh.exe') || fs.existsSync(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'))),
    cmd: fs.existsSync(path.join(systemRoot, 'System32', 'cmd.exe')),
  };
});
ipcMain.handle('copy-text', (_event, value) => {
  clipboard.writeText(String(value || ''));
  return { ok: true };
});
ipcMain.handle('export-command-library', async (_event, commands) => {
  const allowedTones = new Set(['mint', 'blue', 'amber', 'violet']);
  const exportedCommands = (Array.isArray(commands) ? commands : []).slice(0, 5000).map((command) => ({
    name: String(command?.name || '').slice(0, 160),
    command: String(command?.command || '').slice(0, 20000),
    description: String(command?.description || '').slice(0, 2000),
    executionMode: command?.executionMode === 'paste' ? 'paste' : 'execute',
    scope: String(command?.scope || 'Current selection').slice(0, 200),
    tone: allowedTones.has(command?.tone) ? command.tone : 'mint',
  })).filter((command) => command.name.trim() && command.command.trim());
  const date = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog({
    title: 'Export command library',
    defaultPath: `nexus-command-library-${date}.json`,
    filters: [{ name: 'Nexus command library', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const payload = { format: 'nexus-command-library', version: 1, exportedAt: new Date().toISOString(), commands: exportedCommands };
  fs.writeFileSync(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { canceled: false, path: result.filePath, count: exportedCommands.length };
});
ipcMain.handle('import-command-library', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Import command library',
    properties: ['openFile'],
    filters: [{ name: 'Nexus command library', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const stat = fs.statSync(filePath);
  if (stat.size > 5 * 1024 * 1024) throw new Error('command library file is larger than 5 MB');
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const commands = Array.isArray(parsed) ? parsed : parsed?.commands;
  if (!Array.isArray(commands)) throw new Error('invalid command library: commands must be an array');
  return { canceled: false, path: filePath, format: parsed?.format || 'legacy', version: Number(parsed?.version) || 1, commands: commands.slice(0, 5000) };
});
ipcMain.handle('select-directory', async (_event, shellType = 'wsl') => {
  const isWsl = shellType === 'wsl';
  const distro = detectWslDistro().distro || 'Ubuntu';
  const result = await dialog.showOpenDialog({
    title: isWsl ? 'Select WSL working directory' : 'Select Windows working directory',
    defaultPath: isWsl ? `\\\\wsl$\\${distro}\\root` : (process.env.USERPROFILE || process.cwd()),
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return { path: isWsl ? toWslGuestPath(result.filePaths[0], distro) : result.filePaths[0], nativePath: result.filePaths[0] };
});

ipcMain.handle('open-log-directory', async () => {
  const logDirectory = ensureRuntimeData().logDir;
  fs.mkdirSync(logDirectory, { recursive: true });
  const error = await shell.openPath(logDirectory);
  return { ok: !error, path: logDirectory, error: error || undefined };
});

ipcMain.handle('open-log-file', async (_event, serverId) => {
  const safeServerId = String(serverId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'shell';
  const logDirectory = ensureRuntimeData().logDir;
  const filePath = path.join(logDirectory, `${safeServerId}.log`);
  fs.mkdirSync(logDirectory, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '', 'utf8');
  const error = await shell.openPath(filePath);
  return { ok: !error, path: filePath, error: error || undefined };
});

ipcMain.handle('open-help-document', async () => {
  const sourcePath = path.join(__dirname, '..', 'docs', '帮助与文档.md');
  if (!fs.existsSync(sourcePath)) return { ok: false, error: 'help document is missing' };
  const outputDirectory = path.join(app.getPath('userData'), 'docs');
  const outputPath = path.join(outputDirectory, 'Nexus Control 帮助与文档.md');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(outputPath, fs.readFileSync(sourcePath));
  const sourceAssets = path.join(__dirname, '..', 'docs', 'assets');
  const outputAssets = path.join(outputDirectory, 'assets');
  if (fs.existsSync(sourceAssets)) {
    fs.cpSync(sourceAssets, outputAssets, { recursive: true });
  }
  const error = await shell.openPath(outputPath);
  return { ok: !error, path: outputPath, error: error || undefined };
});

app.whenReady().then(async () => {
  await startWslBackend();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  stopWslBackend().finally(() => app.exit(0));
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  // before-quit handles backend shutdown; this is intentionally not a tray app.
  if (!quitting) app.quit();
});
