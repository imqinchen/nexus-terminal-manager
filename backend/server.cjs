const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const { WebSocket, WebSocketServer } = require('ws');
function loadPty() {
  if (process.platform !== 'win32') return require('node-pty');
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'node-pty'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty') : '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch { /* try the next packaged/source path */ }
  }
  return require('node-pty');
}
const pty = loadPty();
const { detectWslDistro } = require('./wsl-config.cjs');

const PORT = Number(process.env.NEXUS_PTY_PORT || 4317);
const HOST = process.env.NEXUS_PTY_HOST || '127.0.0.1';
// The project configuration is intentionally fixed. WSL/Ubuntu discovery is
// handled separately by wsl-config.cjs and is never stored in server.json.
const CONFIG_PATH = process.env.NEXUS_CONFIG_PATH || path.join(__dirname, 'servers.json');
const LOG_DIR = process.env.NEXUS_LOG_DIR || path.join(__dirname, 'logs');
const WSL_CONFIG = detectWslDistro();
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const runs = new Map();
const ptyConnections = new Set();
const activeTerminalConnections = new Map();
const nativeTerminals = new Map();
// Keep the WSL PTY alive while the user switches between terminal tabs. The
// browser WebSocket is only a view onto this process and can be rebound quickly.
const wslTerminals = new Map();
const NATIVE_REPLAY_LIMIT = 512 * 1024;
const CAPABILITY_CACHE_TTL = 30000;
const capabilityCache = { tmux: null, tmuxCheckedAt: 0, wsl: null, wslCheckedAt: 0 };
let capabilityRefreshPromise = null;
let shutdownRequested = false;
let schedulerTimer;

const EMPTY_CONFIG = {
  version: 1,
  groups: [],
  commands: [],
  workflows: [],
  schedules: [],
  settings: { logRetention: 'last-start' },
};

function safeId(value) {
  return String(value || 'shell').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultGroup() {
  return { id: 'local', name: 'Local services', note: 'Imported local WSL services', accent: 'mint', servers: [] };
}

function normalizeServer(server, fallbackId) {
  const id = safeId(server?.id || fallbackId || `server-${Date.now()}`);
  const shell = ['wsl', 'powershell', 'pwsh', 'cmd'].includes(server?.shell) ? server.shell : 'wsl';
  const defaultCwd = shell === 'wsl' ? '/root' : '';
  return {
    id,
    name: String(server?.name || id),
    label: String(server?.label || 'Local service'),
    port: String(server?.port || ''),
    shell,
    cwd: String(server?.cwd ?? server?.dir ?? defaultCwd),
    dir: String(server?.dir ?? server?.cwd ?? defaultCwd),
    tmux: shell === 'wsl' && server?.tmux !== false,
    session: safeId(server?.session || `nexus-${id}`),
    startCommand: String(server?.startCommand || server?.start || ''),
    stopCommand: String(server?.stopCommand || server?.stop || ''),
    restartCommand: String(server?.restartCommand || ''),
    ready: server?.ready && typeof server.ready === 'object' ? {
      type: server.ready.type === 'log' ? 'log' : 'delay',
      value: String(server.ready.value || ''),
      timeoutMs: Math.max(1000, Number(server.ready.timeoutMs) || 30000),
    } : { type: 'delay', value: '0', timeoutMs: 30000 },
  };
}

function normalizeSchedule(task, fallbackId) {
  const runType = task?.runType === 'command' ? 'command' : 'workflow';
  const serverIds = Array.isArray(task?.serverIds)
    ? task.serverIds
    : Array.isArray(task?.targets)
      ? task.targets
      : task?.serverId
        ? [task.serverId]
        : [];
  return {
    ...task,
    id: safeId(task?.id || fallbackId || `schedule-${Date.now()}`),
    name: String(task?.name || (runType === 'command' ? 'Scheduled command' : 'Scheduled flow')),
    runType,
    workflowId: String(task?.workflowId || ''),
    commandId: String(task?.commandId || ''),
    command: String(task?.command || ''),
    serverIds: serverIds.map(String).filter(Boolean),
    type: ['once', 'interval', 'cron'].includes(task?.type) ? task.type : 'interval',
    enabled: task?.enabled !== false,
    createdAt: String(task?.createdAt || new Date().toISOString()),
    at: String(task?.at || ''),
    intervalMs: Math.max(1000, Number(task?.intervalMs) || 3600000),
    intervalMode: task?.intervalMode === 'once' ? 'once' : 'repeat',
    cron: String(task?.cron || '0 * * * *'),
  };
}

function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return clone(EMPTY_CONFIG);
  if (Array.isArray(raw.groups)) {
    const config = {
      ...clone(EMPTY_CONFIG),
      ...raw,
      version: 1,
      groups: raw.groups.map((group, index) => ({
        id: safeId(group?.id || `group-${index + 1}`),
        name: String(group?.name || `Group ${index + 1}`),
        note: String(group?.note || ''),
        accent: String(group?.accent || 'mint'),
        servers: Array.isArray(group?.servers) ? group.servers.map((server, serverIndex) => normalizeServer(server, `server-${index + 1}-${serverIndex + 1}`)) : [],
      })),
      commands: Array.isArray(raw.commands) ? raw.commands : [],
      workflows: Array.isArray(raw.workflows) ? raw.workflows : [],
      schedules: Array.isArray(raw.schedules) ? raw.schedules.map((schedule, index) => normalizeSchedule(schedule, `schedule-${index + 1}`)) : [],
      settings: { ...EMPTY_CONFIG.settings, ...(raw.settings || {}) },
    };
    return config;
  }

  // The original prototype stored a flat object keyed by server id. Import it
  // without changing the user's file until the first explicit save.
  const group = defaultGroup();
  group.servers = Object.entries(raw).map(([id, server]) => normalizeServer({ ...server, id }, id));
  return { ...clone(EMPTY_CONFIG), groups: group.servers.length ? [group] : [] };
}

function loadConfig() {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch {
    try {
      return normalizeConfig(JSON.parse(fs.readFileSync(path.join(__dirname, 'servers.example.json'), 'utf8')));
    } catch {
      return clone(EMPTY_CONFIG);
    }
  }
}

let config = loadConfig();
let configFileStamp = getConfigFileStamp();

function getConfigFileStamp() {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

function readConfigFromDisk() {
  return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
}

function reloadConfigFromDisk() {
  const nextStamp = getConfigFileStamp();
  if (!nextStamp) throw new Error(`config file not found: ${CONFIG_PATH}`);
  const nextConfig = readConfigFromDisk();
  config = nextConfig;
  configFileStamp = nextStamp;
  return clone(config);
}

function reloadConfigIfChanged() {
  const nextStamp = getConfigFileStamp();
  if (!nextStamp || nextStamp === configFileStamp) return false;
  try {
    reloadConfigFromDisk();
    console.log(`[config] reloaded ${CONFIG_PATH}`);
    return true;
  } catch (error) {
    // Keep the last valid in-memory config while an editor is writing a file.
    console.error(`[config] reload skipped: ${error.message}`);
    return false;
  }
}

function saveConfig(nextConfig) {
  const normalized = normalizeConfig(nextConfig);
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const tempPath = `${CONFIG_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(tempPath, CONFIG_PATH);
  } catch (error) {
    if (process.platform !== 'win32' || !['EEXIST', 'EPERM'].includes(error.code)) throw error;
    const backupPath = `${CONFIG_PATH}.${process.pid}.bak`;
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    if (fs.existsSync(CONFIG_PATH)) fs.renameSync(CONFIG_PATH, backupPath);
    try {
      fs.renameSync(tempPath, CONFIG_PATH);
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    } catch (replaceError) {
      if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(backupPath)) fs.renameSync(backupPath, CONFIG_PATH);
      throw replaceError;
    }
  }
  config = normalized;
  configFileStamp = getConfigFileStamp();
  return clone(config);
}

function allServers() {
  return config.groups.flatMap((group) => group.servers.map((server) => ({ ...server, groupId: group.id, groupName: group.name, accent: group.accent })));
}

function findServer(serverId) {
  return allServers().find((server) => server.id === serverId);
}

function logPath(serverId) {
  return path.join(LOG_DIR, `${safeId(serverId)}.log`);
}

function resetLog(serverId) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(logPath(serverId), '', 'utf8');
}

function appendLog(serverId, data) {
  if (!data) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(logPath(serverId), String(data), 'utf8');
}

function readLog(serverId) {
  try {
    return fs.readFileSync(logPath(serverId), 'utf8');
  } catch {
    return '';
  }
}

function readableLogLines(value) {
  return String(value || '')
    // Remove terminal title sequences and ANSI/VT control sequences while
    // preserving the underlying output in the per-server .log file.
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trimEnd())
    .filter((line) => line.trim().length > 0);
}

function logFileInfo(server, lines) {
  const filePath = logPath(server.id);
  try {
    const stat = fs.statSync(filePath);
    return {
      serverId: server.id,
      serverName: server.name,
      groupName: server.groupName,
      fileName: path.basename(filePath),
      path: filePath,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      lineCount: lines.length,
    };
  } catch {
    return {
      serverId: server.id,
      serverName: server.name,
      groupName: server.groupName,
      fileName: path.basename(filePath),
      path: filePath,
      size: 0,
      updatedAt: null,
      lineCount: 0,
    };
  }
}

function hasTmux() {
  if (capabilityCache.tmux !== null) return capabilityCache.tmux;
  try {
    if (process.platform === 'win32') {
      const distro = WSL_CONFIG.distro || 'Ubuntu';
      execFileSync('wsl.exe', ['-d', distro, '--', 'bash', '-lc', 'command -v tmux'], { stdio: 'ignore' });
    } else {
      execFileSync('bash', ['-lc', 'command -v tmux'], { stdio: 'ignore' });
    }
    capabilityCache.tmux = true;
  } catch {
    capabilityCache.tmux = false;
  }
  capabilityCache.tmuxCheckedAt = Date.now();
  return capabilityCache.tmux;
}

function hasWsl() {
  if (process.platform !== 'win32') return true;
  if (capabilityCache.wsl !== null) return capabilityCache.wsl;
  try {
    execFileSync('wsl.exe', ['-d', WSL_CONFIG.distro || 'Ubuntu', '--', 'true'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
    capabilityCache.wsl = true;
  } catch {
    capabilityCache.wsl = false;
  }
  capabilityCache.wslCheckedAt = Date.now();
  return capabilityCache.wsl;
}

function refreshCapabilitiesInBackground(force = false) {
  const lastCheckedAt = Math.min(capabilityCache.tmuxCheckedAt || 0, capabilityCache.wslCheckedAt || 0);
  if (capabilityRefreshPromise) return capabilityRefreshPromise;
  if (!force && lastCheckedAt && Date.now() - lastCheckedAt < CAPABILITY_CACHE_TTL) return Promise.resolve();
  const tmuxProbe = runGuest('bash', ['-lc', 'command -v tmux'], { timeout: 4000 });
  const wslProbe = process.platform === 'win32'
    ? runHost('wsl.exe', ['-d', WSL_CONFIG.distro || 'Ubuntu', '--', 'true'], { timeout: 3000 })
    : Promise.resolve();
  capabilityRefreshPromise = Promise.allSettled([tmuxProbe, wslProbe]).then(([tmuxResult, wslResult]) => {
    const checkedAt = Date.now();
    capabilityCache.tmux = tmuxResult.status === 'fulfilled';
    capabilityCache.tmuxCheckedAt = checkedAt;
    capabilityCache.wsl = wslResult.status === 'fulfilled';
    capabilityCache.wslCheckedAt = checkedAt;
  }).finally(() => { capabilityRefreshPromise = null; });
  return capabilityRefreshPromise;
}

function guestCwd(server) {
  const cwd = server.cwd || server.dir || '/root';
  if (cwd === '~') return '/root';
  if (process.platform !== 'win32') return cwd;
  return cwd || '~';
}

function guestFilePath(filePath) {
  if (process.platform !== 'win32') return filePath;
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return `/mnt/${normalized.slice(0, 1).toLowerCase()}${normalized.slice(2)}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runGuest(program, args, options = {}) {
  const command = process.platform === 'win32' ? 'wsl.exe' : program;
  const commandArgs = process.platform === 'win32'
    ? ['-d', WSL_CONFIG.distro || 'Ubuntu', '--', program, ...args]
    : args;
  return new Promise((resolve, reject) => {
    execFile(command, commandArgs, { timeout: options.timeout || 10000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function runHost(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(program, args, { timeout: options.timeout || 10000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function tmuxSessionExists(session) {
  if (!hasTmux()) return false;
  try {
    await runGuest('tmux', ['has-session', '-t', session], { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

async function enableTmuxLogging(server) {
  const session = server.session || `nexus-${safeId(server.id)}`;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const pipeCommand = `cat >> ${shellQuote(guestFilePath(logPath(server.id)))}`;
  await runGuest('tmux', ['pipe-pane', '-o', '-t', session, pipeCommand], { timeout: 8000 });
}

async function backfillTmuxHistory(server) {
  const session = server.session || `nexus-${safeId(server.id)}`;
  const { stdout } = await runGuest('tmux', ['capture-pane', '-p', '-S', '-', '-t', session], { timeout: 8000 });
  const capturedLines = readableLogLines(stdout);
  if (!capturedLines.length) return;
  const existing = readableLogLines(readLog(server.id));
  const signature = capturedLines.slice(-Math.min(5, capturedLines.length)).join('\n');
  if (signature && existing.join('\n').includes(signature)) return;
  appendLog(server.id, `${existing.length ? '\n' : ''}[Nexus recovered tmux history at ${new Date().toISOString()}]\n${stdout}${stdout.endsWith('\n') ? '' : '\n'}`);
}

async function ensureTmuxSession(server) {
  if (!server.tmux || !hasTmux()) return false;
  const session = server.session || `nexus-${safeId(server.id)}`;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!(await tmuxSessionExists(session))) await runGuest('tmux', ['new-session', '-d', '-s', session, '-c', guestCwd(server)], { timeout: 8000 });
  await runGuest('tmux', ['set-window-option', '-t', session, 'aggressive-resize', 'on'], { timeout: 4000 });
  await enableTmuxLogging(server);
  return true;
}

async function enableLoggingForExistingSessions() {
  if (!hasTmux()) return;
  const results = await Promise.allSettled(allServers().filter((server) => server.shell === 'wsl' && server.tmux !== false).map(async (server) => {
    const session = server.session || `nexus-${safeId(server.id)}`;
    if (!(await tmuxSessionExists(session))) return;
    await backfillTmuxHistory(server);
    await enableTmuxLogging(server);
  }));
  results.forEach((result) => {
    if (result.status === 'rejected') console.error(`[logs] unable to attach tmux logger: ${result.reason?.message || result.reason}`);
  });
}

async function sendTmux(server, data) {
  const ready = await ensureTmuxSession(server);
  if (!ready) throw new Error('tmux is unavailable in the configured WSL distribution');
  await runGuest('tmux', ['send-keys', '-t', server.session, data, 'Enter'], { timeout: 8000 });
}

function isNativeShell(server) {
  return ['powershell', 'pwsh', 'cmd'].includes(server?.shell);
}

function writeToOpenSocket(webSocket, payload) {
  if (webSocket?.readyState === WebSocket.OPEN) webSocket.send(JSON.stringify(payload));
}

function createNativeTerminal(serverId) {
  const terminal = spawnTerminal(serverId);
  const state = {
    terminal,
    replay: '',
    webSocket: null,
    disposed: false,
  };
  nativeTerminals.set(serverId, state);
  ptyConnections.add(terminal);
  terminal.child.onData((data) => {
    if (state.disposed) return;
    appendLog(serverId, data);
    state.replay = `${state.replay}${data}`.slice(-NATIVE_REPLAY_LIMIT);
    writeToOpenSocket(state.webSocket, { type: 'output', data });
  });
  terminal.child.onExit(({ exitCode }) => {
    if (state.disposed) return;
    state.disposed = true;
    nativeTerminals.delete(serverId);
    ptyConnections.delete(terminal);
    writeToOpenSocket(state.webSocket, { type: 'status', value: 'exited', exitCode });
    if (state.webSocket?.readyState === WebSocket.OPEN) state.webSocket.close();
    if (activeTerminalConnections.get(serverId)?.terminal === terminal) activeTerminalConnections.delete(serverId);
  });
  return state;
}

function ensureNativeTerminal(server) {
  const existing = nativeTerminals.get(server.id);
  if (existing && !existing.disposed) return existing;
  return createNativeTerminal(server.id);
}

function createWslTerminal(serverId) {
  const terminal = spawnTerminal(serverId);
  const state = {
    terminal,
    replay: '',
    webSocket: null,
    disposed: false,
  };
  wslTerminals.set(serverId, state);
  ptyConnections.add(terminal);
  terminal.child.onData((data) => {
    if (state.disposed) return;
    // tmux sessions already write through pipe-pane. Non-tmux WSL shells need
    // the same log/replay handling as native shells.
    if (!terminal.useTmux) appendLog(serverId, data);
    state.replay = `${state.replay}${data}`.slice(-NATIVE_REPLAY_LIMIT);
    writeToOpenSocket(state.webSocket, { type: 'output', data });
  });
  terminal.child.onExit(({ exitCode }) => {
    if (state.disposed) return;
    state.disposed = true;
    wslTerminals.delete(serverId);
    ptyConnections.delete(terminal);
    writeToOpenSocket(state.webSocket, { type: 'status', value: 'exited', exitCode });
    if (state.webSocket?.readyState === WebSocket.OPEN) state.webSocket.close();
    if (activeTerminalConnections.get(serverId)?.terminal === terminal) activeTerminalConnections.delete(serverId);
  });
  return state;
}

function ensureWslTerminal(server) {
  const existing = wslTerminals.get(server.id);
  if (existing && !existing.disposed) return existing;
  return createWslTerminal(server.id);
}

function killPtyTerminal(terminal) {
  const pid = Number(terminal?.child?.pid);
  if (process.platform === 'win32' && Number.isInteger(pid) && pid > 0) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    } catch { /* process may already have exited */ }
    return;
  }
  try { terminal?.child?.kill(); } catch { /* already exited */ }
}

function terminateNativeTerminal(serverId) {
  const state = nativeTerminals.get(serverId);
  if (!state) return false;
  state.disposed = true;
  nativeTerminals.delete(serverId);
  ptyConnections.delete(state.terminal);
  if (activeTerminalConnections.get(serverId)?.terminal === state.terminal) activeTerminalConnections.delete(serverId);
  killPtyTerminal(state.terminal);
  if (state.webSocket?.readyState === WebSocket.OPEN) state.webSocket.close(1000, 'terminal stopped');
  return true;
}

function terminateWslTerminal(serverId) {
  const state = wslTerminals.get(serverId);
  if (!state) return false;
  state.disposed = true;
  wslTerminals.delete(serverId);
  ptyConnections.delete(state.terminal);
  if (activeTerminalConnections.get(serverId)?.terminal === state.terminal) activeTerminalConnections.delete(serverId);
  killPtyTerminal(state.terminal);
  if (state.webSocket?.readyState === WebSocket.OPEN) state.webSocket.close(1000, 'terminal stopped');
  return true;
}

function sendNativeShell(server, data, enter = true) {
  const state = ensureNativeTerminal(server);
  state.terminal.child.write(`${String(data || '')}${enter ? '\r' : ''}`);
}

async function sendCtrlC(server) {
  const ready = await ensureTmuxSession(server);
  if (!ready) throw new Error('tmux is unavailable in the configured WSL distribution');
  await runGuest('tmux', ['send-keys', '-t', server.session, 'C-c'], { timeout: 8000 });
}

function configuredPort(server) {
  const port = Number(server?.port);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

async function isPortListening(port) {
  return (await portListeners(port)).length > 0;
}

async function linuxPortListeners(port) {
  if (!port) return [];
  try {
    const { stdout } = await runGuest('bash', ['-lc', `lsof -t -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true`], { timeout: 5000 });
    return [...new Set(String(stdout || '').split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))].map((pid) => ({ pid, source: 'linux' }));
  } catch {
    return [];
  }
}

async function wsl1PortListeners(port) {
  if (!port || process.platform !== 'linux') return [];
  const release = os.release().toLowerCase();
  const isWsl1 = release.includes('microsoft') && !release.includes('wsl2') && !release.includes('standard');
  if (!isWsl1) return [];
  try {
    const netstat = '/mnt/c/Windows/System32/netstat.exe';
    const { stdout } = await runGuest(netstat, ['-ano', '-p', 'tcp'], { timeout: 8000 });
    const listeners = [];
    for (const line of String(stdout || '').split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || String(columns[0]).toUpperCase() !== 'TCP') continue;
      const localPort = Number(String(columns[1]).match(/:(\d+)$/)?.[1]);
      if (localPort !== port || String(columns[3]).toUpperCase() !== 'LISTENING') continue;
      const pid = Number(columns[4]);
      if (Number.isInteger(pid) && pid > 0) listeners.push({ pid, source: 'windows-wsl1' });
    }
    return [...new Map(listeners.map((item) => [`${item.source}:${item.pid}`, item])).values()];
  } catch {
    return [];
  }
}

async function windowsPortListeners(port) {
  if (!port || process.platform !== 'win32') return [];
  try {
    const { stdout } = await runHost('netstat.exe', ['-ano', '-p', 'tcp'], { timeout: 8000 });
    const listeners = [];
    for (const line of String(stdout || '').split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || String(columns[0]).toUpperCase() !== 'TCP') continue;
      const localPort = Number(String(columns[1]).match(/:(\d+)$/)?.[1]);
      if (localPort !== port || String(columns[3]).toUpperCase() !== 'LISTENING') continue;
      const pid = Number(columns[4]);
      if (Number.isInteger(pid) && pid > 0) listeners.push({ pid, source: 'windows' });
    }
    return [...new Map(listeners.map((item) => [`${item.source}:${item.pid}`, item])).values()];
  } catch {
    return [];
  }
}

async function portListeners(port) {
  const linux = await linuxPortListeners(port);
  if (linux.length) return linux;
  return process.platform === 'win32' ? windowsPortListeners(port) : wsl1PortListeners(port);
}

async function signalPortListeners(port, signal) {
  const listeners = await portListeners(port);
  const results = await Promise.allSettled(listeners.map((listener) => {
    if (listener.source === 'windows') {
      const args = ['/PID', String(listener.pid), '/T'];
      if (signal === 'KILL') args.push('/F');
      return runHost('taskkill.exe', args, { timeout: 10000 });
    }
    if (listener.source === 'windows-wsl1') {
      const taskkill = '/mnt/c/Windows/System32/taskkill.exe';
      const args = ['/PID', String(listener.pid), '/T'];
      if (signal === 'KILL') args.push('/F');
      return runGuest(taskkill, args, { timeout: 10000 });
    }
    return runGuest('kill', [`-${signal}`, String(listener.pid)], { timeout: 6000 });
  }));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed && await isPortListening(port)) {
    throw failed.reason;
  }
}

async function stopAndRemoveServer(serverId) {
  const server = findServer(serverId);
  if (!server) throw new Error(`unknown server: ${serverId}`);
  const session = server.session || `nexus-${safeId(server.id)}`;
  const port = configuredPort(server);
  if (port === PORT) throw new Error(`configured port ${port} belongs to the Nexus backend; correct the terminal port before deleting`);
  const connection = activeTerminalConnections.get(serverId);
  const nativeState = nativeTerminals.get(serverId);
  if (nativeState && isNativeShell(server)) {
    try {
      nativeState.terminal.child.write(server.stopCommand ? `${server.stopCommand}\r` : '\u0003');
      await delay(750);
    } catch (error) {
      console.error(`[delete] native shell stop failed for ${serverId}: ${error.message}`);
    }
  }
  if (isNativeShell(server)) terminateNativeTerminal(serverId);
  else if (wslTerminals.has(serverId)) terminateWslTerminal(serverId);
  else if (connection) connection.dispose(true);

  const sessionExisted = !isNativeShell(server) && await tmuxSessionExists(session);
  if (sessionExisted) {
    try {
      if (server.stopCommand) await runGuest('tmux', ['send-keys', '-t', session, server.stopCommand, 'Enter'], { timeout: 8000 });
      else await runGuest('tmux', ['send-keys', '-t', session, 'C-c'], { timeout: 8000 });
      await delay(1500);
    } catch (error) {
      console.error(`[delete] graceful stop failed for ${serverId}: ${error.message}`);
    }
    if (await tmuxSessionExists(session)) await runGuest('tmux', ['kill-session', '-t', session], { timeout: 8000 });
  }

  let portWasListening = await isPortListening(port);
  if (portWasListening) {
    await signalPortListeners(port, 'TERM');
    await delay(1000);
    if (await isPortListening(port)) {
      await signalPortListeners(port, 'KILL');
      await delay(500);
    }
  }
  if (await isPortListening(port)) throw new Error(`port ${port} is still listening; terminal configuration was not deleted`);

  const nextGroups = config.groups.map((group) => ({
    ...group,
    servers: group.servers.filter((item) => item.id !== serverId),
  }));
  const nextSchedules = config.schedules.map((schedule) => {
    if (!Array.isArray(schedule.serverIds) || !schedule.serverIds.includes(serverId)) return schedule;
    const serverIds = schedule.serverIds.filter((id) => id !== serverId);
    return { ...schedule, serverIds, enabled: serverIds.length ? schedule.enabled : false, lastError: serverIds.length ? schedule.lastError : `target terminal deleted: ${serverId}` };
  });
  const saved = saveConfig({ ...config, groups: nextGroups, schedules: nextSchedules });
  return {
    ok: true,
    serverId,
    serverName: server.name,
    session,
    sessionRemoved: sessionExisted,
    port,
    portWasListening,
    portReleased: port ? true : null,
    config: saved,
    health: healthPayload(),
  };
}

function spawnTerminal(serverId) {
  const server = findServer(serverId) || normalizeServer({ id: serverId, name: serverId }, serverId);
  const session = server.session || `nexus-${safeId(serverId)}`;
  const useTmux = server.shell === 'wsl' && server.tmux !== false && hasTmux();
  // One Nexus terminal owns the tmux client for a service. Detaching stale
  // clients and enabling aggressive resize prevents tmux 2.x from filling a
  // wider client with dot cells outside the narrower session window.
  const pipeCommand = `cat >> ${shellQuote(guestFilePath(logPath(server.id)))}`;
  const command = useTmux
    ? `tmux has-session -t ${session} 2>/dev/null || tmux new-session -d -s ${session} -c ${shellQuote(guestCwd(server))}; tmux set-window-option -t ${session} aggressive-resize on; tmux pipe-pane -o -t ${session} ${shellQuote(pipeCommand)}; exec tmux attach-session -d -t ${session}`
    : 'exec bash -il';
  let shell;
  let args;
  let ptyCwd = process.platform === 'win32' ? process.cwd() : guestCwd(server);
  if (server.shell === 'powershell' || server.shell === 'pwsh' || server.shell === 'cmd') {
    if (process.platform !== 'win32') throw new Error(`${server.shell} terminals require the Windows Nexus backend`);
    shell = server.shell === 'powershell'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : server.shell === 'pwsh'
        ? (fs.existsSync(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'))
          ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')
          : 'pwsh.exe')
        : path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
    args = server.shell === 'cmd' ? [] : ['-NoLogo'];
    ptyCwd = server.cwd && fs.existsSync(server.cwd) ? server.cwd : os.homedir();
  } else {
    shell = process.platform === 'win32' ? 'wsl.exe' : (process.env.SHELL || '/bin/bash');
    args = process.platform === 'win32'
      ? ['-d', WSL_CONFIG.distro || 'Ubuntu', '--cd', guestCwd(server), '--', 'bash', '-ilc', command]
      : (useTmux ? ['-ilc', command] : ['-il']);
  }
  const child = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 32,
    cwd: ptyCwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });
  return { child, server, session, cwd: server.cwd || (server.shell === 'wsl' ? guestCwd(server) : ''), useTmux, shell: server.shell };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function withTimeout(promise, timeoutMs, label) {
  const timeout = Number(timeoutMs) || 0;
  if (timeout <= 0) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label || 'step'} timed out after ${timeout}ms`)), timeout); }),
  ]).finally(() => clearTimeout(timer));
}

function parseDelay(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return Math.max(0, number);
  const match = String(value || '').match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  return match[2]?.toLowerCase() === 'm' ? amount * 60000 : match[2]?.toLowerCase() === 's' ? amount * 1000 : amount;
}

async function waitForReady(server) {
  const ready = server.ready || { type: 'delay', value: '0', timeoutMs: 30000 };
  if (ready.type !== 'log' || !ready.value) {
    await delay(parseDelay(ready.value));
    return { ready: true, mode: 'delay' };
  }
  const deadline = Date.now() + Math.max(1000, Number(ready.timeoutMs) || 30000);
  while (Date.now() < deadline) {
    if (readLog(server.id).includes(ready.value)) return { ready: true, mode: 'log' };
    await delay(250);
  }
  throw new Error(`readiness log keyword not found before timeout: ${ready.value}`);
}

async function runServerAction(serverId, action) {
  const server = findServer(serverId);
  if (!server) throw new Error(`unknown server: ${serverId}`);
  if (isNativeShell(server)) {
    if (!['start', 'stop', 'restart'].includes(action)) throw new Error(`unsupported action: ${action}`);
    const existing = nativeTerminals.get(server.id);
    if (action === 'stop' && !existing) return { serverId, action, status: 'stopped', shell: server.shell };
    ensureNativeTerminal(server);
    if (action === 'stop' || action === 'restart') {
      sendNativeShell(server, server.stopCommand || '\u0003', Boolean(server.stopCommand));
      if (action === 'restart') await delay(750);
    }
    if (action === 'start' || action === 'restart') {
      resetLog(server.id);
      const nativeState = nativeTerminals.get(server.id);
      if (nativeState) nativeState.replay = '';
      const startCommand = action === 'restart' && server.restartCommand ? server.restartCommand : server.startCommand;
      if (startCommand) sendNativeShell(server, startCommand);
      await waitForReady(server);
    }
    return { serverId, action, status: action === 'stop' ? 'stopped' : 'running', shell: server.shell };
  }
  if (action === 'start' || action === 'restart') {
    if (action === 'restart') await runServerAction(serverId, 'stop');
    resetLog(server.id);
    if (!(await ensureTmuxSession(server))) throw new Error('tmux is unavailable in the configured WSL distribution');
    if (server.startCommand) await sendTmux(server, server.startCommand);
    await waitForReady(server);
    return { serverId, action, status: 'running' };
  }
  if (action === 'stop') {
    if (server.stopCommand) await sendTmux(server, server.stopCommand);
    else await sendCtrlC(server);
    return { serverId, action, status: 'stopped' };
  }
  throw new Error(`unsupported action: ${action}`);
}

function resolveCommand(commandId, directCommand) {
  if (directCommand) return String(directCommand);
  const item = config.commands.find((command) => command.id === commandId);
  if (!item) throw new Error(`unknown command: ${commandId}`);
  if (item.executionMode === 'paste') throw new Error(`command requires interactive terminal input: ${commandId}`);
  return String(item.command || '');
}

async function dispatchCommand(serverId, command) {
  const server = findServer(serverId);
  if (!server) throw new Error(`unknown server: ${serverId}`);
  if (!String(command || '').trim()) throw new Error('command cannot be empty');
  if (isNativeShell(server)) sendNativeShell(server, command);
  else await sendTmux(server, command);
  appendLog(serverId, `[panel] > ${command}\n`);
  return { serverId, status: 'sent', command, shell: server.shell };
}

async function dispatchToServers(serverIds, command) {
  if (!Array.isArray(serverIds) || !serverIds.length) throw new Error('at least one target server is required');
  const results = await Promise.all((serverIds || []).map(async (serverId) => {
    try {
      return { ...(await dispatchCommand(serverId, command)), ok: true };
    } catch (error) {
      return { serverId, ok: false, status: 'error', error: error.message };
    }
  }));
  return { command, results, ok: results.every((result) => result.ok) };
}

function targetIdsForStep(step) {
  if (Array.isArray(step.serverIds)) return step.serverIds;
  if (step.serverId) return [step.serverId];
  if (Array.isArray(step.targets)) return step.targets;
  if (step.target) return [step.target];
  return [];
}

function stepPathFor(value) {
  if (Array.isArray(value)) return value.map((part) => Number(part));
  return String(value).split('.').map((part) => Number(part)).filter((part) => Number.isInteger(part));
}

function setRunStepState(run, value, state) {
  const path = stepPathFor(value);
  if (!path.length) return;
  let steps = run.steps;
  for (let index = 0; index < path.length - 1; index += 1) {
    const parent = steps[path[index]];
    if (!parent) return;
    if (!Array.isArray(parent.children)) parent.children = [];
    steps = parent.children;
  }
  steps[path[path.length - 1]] = state;
}

function requireStepTargets(step, label) {
  const targets = targetIdsForStep(step).filter(Boolean);
  if (!targets.length) throw new Error(`${label || 'step'} requires a target terminal`);
  return targets;
}

function collectStepTargets(step) {
  if (step?.type === 'parallel') {
    return (Array.isArray(step.steps) ? step.steps : []).flatMap((child) => collectStepTargets(child));
  }
  return targetIdsForStep(step).filter(Boolean);
}

function validateParallelTargets(step) {
  const children = Array.isArray(step.steps) ? step.steps : [];
  if (!children.length) throw new Error('parallel group requires at least one child step');
  const seen = new Map();
  children.forEach((child, childIndex) => {
    const targets = collectStepTargets(child);
    if (!targets.length) throw new Error(`parallel branch ${childIndex + 1} requires a target terminal`);
    if (child.type !== 'parallel' && targets.length !== 1) {
      throw new Error(`parallel branch ${childIndex + 1} must target exactly one terminal`);
    }
    targets.forEach((serverId) => {
      const previous = seen.get(serverId);
      if (previous !== undefined) {
        throw new Error(`parallel branches ${previous + 1} and ${childIndex + 1} target the same terminal: ${serverId}`);
      }
      seen.set(serverId, childIndex);
    });
  });
}

async function executeStep(step, run, index) {
  const stepPath = stepPathFor(index);
  const attempts = Math.max(0, Number(step.retries) || 0) + 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const declaredType = step.type || 'command';
    const type = declaredType === 'command' && ['start', 'stop', 'restart'].includes(step.action)
      ? 'action'
      : declaredType;
    const state = { index: stepPath.join('.'), stepId: step.id, type, label: step.name || step.label || type || `Step ${stepPath[stepPath.length - 1] + 1}`, targets: targetIdsForStep(step).filter(Boolean), status: 'running', attempt, startedAt: new Date().toISOString() };
    setRunStepState(run, stepPath, state);
    try {
      let result;
      if (type === 'parallel') {
        const childSteps = Array.isArray(step.steps) ? step.steps : [];
        state.targets = collectStepTargets(step);
        validateParallelTargets(step);
        state.children = [];
        setRunStepState(run, stepPath, state);
        // Start one branch per target terminal and collect every branch result.
        // A timed-out PTY command cannot be cancelled safely, so its branch may
        // finish in the background even though the group has already failed.
        const childResults = await withTimeout(Promise.all(childSteps.map(async (child, childIndex) => {
          try {
            return { status: 'fulfilled', value: await executeStep(child, run, [...stepPath, childIndex]) };
          } catch (error) {
            return { status: 'rejected', reason: error };
          }
        })), step.timeoutMs, 'parallel group');
        const failures = childResults.filter((childResult) => childResult.status === 'rejected');
        if (failures.length) {
          const error = new Error(`parallel group failed: ${failures.map((item) => item.reason?.message || 'branch failed').join('; ')}`);
          error.failures = failures.map((item) => item.reason?.message || 'branch failed');
          throw error;
        }
        result = childResults.map((childResult) => childResult.value);
      } else if (type === 'wait' || type === 'delay') {
        await withTimeout(delay(parseDelay(step.durationMs ?? step.value ?? step.ms)), step.timeoutMs, 'wait step');
        result = { waitedMs: parseDelay(step.durationMs ?? step.value ?? step.ms) };
      } else if (type === 'wait-log') {
        const targets = requireStepTargets(step, 'wait-log step');
        const match = String(step.match || step.value || '').trim();
        if (!match) throw new Error('wait-log step requires a log keyword');
        const deadline = Date.now() + Math.max(1000, Number(step.timeoutMs) || 30000);
        while (Date.now() < deadline && !targets.some((serverId) => readLog(serverId).includes(match))) await delay(250);
        if (!targets.some((serverId) => readLog(serverId).includes(match))) throw new Error(`log keyword not found: ${match}`);
        result = { matched: true };
      } else if (type === 'action' || ['start', 'stop', 'restart'].includes(type)) {
        const action = type === 'action' ? step.action : type;
        const targets = requireStepTargets(step, 'service action');
        result = await withTimeout(Promise.all(targets.map((serverId) => runServerAction(serverId, action))), step.timeoutMs, 'service action');
      } else {
        const command = resolveCommand(step.commandId, step.command);
        const targets = requireStepTargets(step, 'command step');
        result = await withTimeout(dispatchToServers(targets, command), step.timeoutMs, 'command step');
      }
      state.status = 'completed';
      state.result = result;
      state.completedAt = new Date().toISOString();
      return result;
    } catch (error) {
      lastError = error;
      state.status = attempt < attempts ? 'retrying' : 'failed';
      state.error = error.message;
      state.completedAt = new Date().toISOString();
      if (attempt < attempts) await delay(Number(step.retryDelayMs) || 250);
    }
  }
  if (step.onError === 'continue') return { continued: true, error: lastError?.message };
  throw lastError || new Error('workflow step failed');
}

async function executeWorkflow(workflow, run) {
  try {
    run.status = 'running';
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    for (let index = 0; index < steps.length; index += 1) await executeStep(steps[index], run, index);
    run.status = 'completed';
  } catch (error) {
    run.status = 'failed';
    run.error = error.message;
  }
  run.completedAt = new Date().toISOString();
  return run;
}

function startWorkflow(workflowId) {
  const workflow = config.workflows.find((item) => item.id === workflowId);
  if (!workflow) throw new Error(`unknown workflow: ${workflowId}`);
  const run = { id: randomUUID(), runType: 'workflow', workflowId, status: 'queued', startedAt: new Date().toISOString(), steps: [] };
  runs.set(run.id, run);
  executeWorkflow(workflow, run).catch((error) => { run.status = 'failed'; run.error = error.message; });
  return run;
}

function startCommandRun(commandId, directCommand, serverIds) {
  const command = resolveCommand(commandId, directCommand);
  const targets = Array.isArray(serverIds) ? serverIds.filter(Boolean) : [];
  if (!targets.length) throw new Error('at least one target server is required');
  const run = {
    id: randomUUID(),
    runType: 'command',
    commandId: commandId || '',
    command,
    serverIds: targets,
    status: 'queued',
    startedAt: new Date().toISOString(),
    steps: [],
  };
  runs.set(run.id, run);
  Promise.resolve().then(async () => {
    run.status = 'running';
    run.result = await dispatchToServers(targets, command);
    run.status = run.result.ok ? 'completed' : 'failed';
    if (!run.result.ok) run.error = run.result.results.filter((result) => !result.ok).map((result) => result.error).filter(Boolean).join('; ');
    run.completedAt = new Date().toISOString();
    return run;
  }).catch((error) => {
    run.status = 'failed';
    run.error = error.message;
    run.completedAt = new Date().toISOString();
  });
  return run;
}

function cronPartMatches(value, expression, min, max) {
  return String(expression).split(',').some((part) => {
    const [base, stepValue] = part.split('/');
    const step = Math.max(1, Number(stepValue) || 1);
    let start = min;
    let end = max;
    if (base !== '*') {
      if (base.includes('-')) [start, end] = base.split('-').map(Number);
      else start = end = Number(base);
    }
    return Number.isFinite(start) && Number.isFinite(end) && value >= start && value <= end && (value - start) % step === 0;
  });
}

function cronMatches(expression, date) {
  const parts = String(expression || '').trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return cronPartMatches(date.getMinutes(), parts[0], 0, 59)
    && cronPartMatches(date.getHours(), parts[1], 0, 23)
    && cronPartMatches(date.getDate(), parts[2], 1, 31)
    && cronPartMatches(date.getMonth() + 1, parts[3], 1, 12)
    && cronPartMatches(date.getDay(), parts[4], 0, 6);
}

function schedulerTick() {
  if (shutdownRequested) return;
  reloadConfigIfChanged();
  const now = new Date();
  let changed = false;
  for (const task of config.schedules) {
    const runType = task.runType === 'command' ? 'command' : 'workflow';
    if (task.enabled === false) continue;
    if (runType === 'workflow' && !task.workflowId) continue;
    if (runType === 'command' && !task.commandId && !String(task.command || '').trim()) continue;
    const last = task.lastRunAt ? new Date(task.lastRunAt).getTime() : 0;
    const created = task.createdAt ? new Date(task.createdAt).getTime() : now.getTime();
    let due = false;
    if (task.type === 'once' && task.at && !last) due = new Date(task.at).getTime() <= now.getTime();
    if (task.type === 'interval' && Number(task.intervalMs) > 0) due = now.getTime() - (last || created) >= Number(task.intervalMs);
    if (task.type === 'cron') {
      const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
      due = cronMatches(task.cron, now) && task.lastTriggerKey !== minuteKey;
      if (due) task.lastTriggerKey = minuteKey;
    }
    if (!due) continue;
    task.lastRunAt = now.toISOString();
    if (task.type === 'interval' && task.intervalMode === 'once') task.enabled = false;
    changed = true;
    try {
      if (runType === 'command') startCommandRun(task.commandId, task.command, task.serverIds || task.targets || []);
      else startWorkflow(task.workflowId);
      task.lastError = '';
    } catch (error) {
      task.lastError = error.message;
    }
  }
  if (changed) {
    try { saveConfig(config); } catch (error) { console.error('[scheduler] failed to persist state', error.message); }
  }
}

function startScheduler() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(schedulerTick, 1000);
  schedulerTimer.unref?.();
}

function stopScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = undefined;
}

function json(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,PUT,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(new Error('invalid JSON body')); }
    });
    request.on('error', reject);
  });
}

function healthPayload() {
  reloadConfigIfChanged();
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershellPath = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const cmdPath = path.join(systemRoot, 'System32', 'cmd.exe');
  const pathEntries = String(process.env.Path || '').split(path.delimiter).filter(Boolean);
  const pwsh = process.platform === 'win32' && pathEntries.some((entry) => fs.existsSync(path.join(entry, 'pwsh.exe')));
  const tmux = hasTmux();
  const wsl = hasWsl();
  refreshCapabilitiesInBackground();
  return {
    ok: true,
    service: 'nexus-pty',
    port: PORT,
    distro: WSL_CONFIG.distro,
    distroSource: WSL_CONFIG.source,
    configPath: CONFIG_PATH,
    configStamp: configFileStamp,
    logDir: LOG_DIR,
    capabilities: {
      tmux,
      node: process.version,
      platform: process.platform,
      wsl,
      powershell: process.platform === 'win32' && fs.existsSync(powershellPath),
      pwsh,
      cmd: process.platform === 'win32' && fs.existsSync(cmdPath),
    },
    groups: config.groups.length,
    servers: allServers().length,
  };
}

async function handleApi(request, response, url) {
  try {
    if (request.method === 'POST' && url.pathname === '/api/capabilities/reload') {
      await refreshCapabilitiesInBackground(true);
      return json(response, 200, healthPayload());
    }
    if (request.method === 'GET' && url.pathname === '/api/config') {
      reloadConfigIfChanged();
      return json(response, 200, { config: clone(config), health: healthPayload() });
    }
    if (request.method === 'POST' && url.pathname === '/api/config/reload') return json(response, 200, { config: reloadConfigFromDisk(), health: healthPayload() });
    if (request.method === 'PUT' && url.pathname === '/api/config') {
      const savedConfig = saveConfig(await parseBody(request));
      return json(response, 200, { config: savedConfig, health: healthPayload() });
    }
    if (request.method === 'GET' && url.pathname === '/api/logs') {
      const query = String(url.searchParams.get('q') || '').toLowerCase();
      const requestedServer = url.searchParams.get('serverId');
      const limit = Math.min(20000, Math.max(1, Number(url.searchParams.get('limit')) || 5000));
      const servers = allServers().filter((server) => !requestedServer || server.id === requestedServer);
      const rows = [];
      const files = [];
      for (const server of servers) {
        const lines = readableLogLines(readLog(server.id));
        files.push(logFileInfo(server, lines));
        lines.forEach((line, index) => {
          if (!query || `${server.name} ${server.groupName} ${line}`.toLowerCase().includes(query)) {
            rows.push({ serverId: server.id, serverName: server.name, groupName: server.groupName, line, index, lineNumber: index + 1 });
          }
        });
      }
      return json(response, 200, { rows: rows.slice(-limit), total: rows.length, files, limit });
    }
    const serverDeleteMatch = url.pathname.match(/^\/api\/servers\/([^/]+)$/);
    if (request.method === 'DELETE' && serverDeleteMatch) {
      return json(response, 200, await stopAndRemoveServer(decodeURIComponent(serverDeleteMatch[1])));
    }
    const actionMatch = url.pathname.match(/^\/api\/servers\/([^/]+)\/action$/);
    if (request.method === 'POST' && actionMatch) {
      const body = await parseBody(request);
      const action = body.action;
      const ids = Array.isArray(body.serverIds) ? body.serverIds : [decodeURIComponent(actionMatch[1])];
      const results = await Promise.all(ids.map(async (serverId) => {
        try { return { ...(await runServerAction(serverId, action)), ok: true }; } catch (error) { return { serverId, ok: false, error: error.message }; }
      }));
      return json(response, results.every((result) => result.ok) ? 200 : 207, { action, results, ok: results.every((result) => result.ok) });
    }
    if (request.method === 'POST' && url.pathname === '/api/commands/dispatch') {
      const body = await parseBody(request);
      const command = resolveCommand(body.commandId, body.command);
      return json(response, 200, await dispatchToServers(body.serverIds || [], command));
    }
    const workflowMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)\/run$/);
    if (request.method === 'POST' && workflowMatch) return json(response, 202, startWorkflow(decodeURIComponent(workflowMatch[1])));
    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (request.method === 'GET' && runMatch) {
      const run = runs.get(decodeURIComponent(runMatch[1]));
      return run ? json(response, 200, run) : json(response, 404, { error: 'run not found' });
    }
    if (request.method === 'GET' && url.pathname === '/api/schedules') return json(response, 200, { schedules: config.schedules });
    if (request.method === 'POST' && url.pathname === '/api/schedules') {
      const body = await parseBody(request);
      const runType = body.runType === 'command' ? 'command' : 'workflow';
      const schedule = normalizeSchedule({
        id: safeId(body.id || `schedule-${Date.now()}`),
        name: String(body.name || (runType === 'command' ? 'Scheduled command' : 'Scheduled flow')),
        runType,
        workflowId: String(body.workflowId || ''),
        commandId: String(body.commandId || ''),
        command: String(body.command || ''),
        serverIds: Array.isArray(body.serverIds) ? body.serverIds.map(String).filter(Boolean) : [],
        type: ['once', 'interval', 'cron'].includes(body.type) ? body.type : 'interval',
        enabled: body.enabled !== false,
        at: body.at || '',
        intervalMs: Math.max(1000, Number(body.intervalMs) || 3600000),
        intervalMode: body.intervalMode === 'once' ? 'once' : 'repeat',
        cron: String(body.cron || '0 * * * *'),
      });
      if (runType === 'workflow') {
        if (!schedule.workflowId) throw new Error('workflowId is required');
        if (!config.workflows.some((workflow) => workflow.id === schedule.workflowId)) throw new Error(`unknown workflow: ${schedule.workflowId}`);
      } else {
        resolveCommand(schedule.commandId, schedule.command);
        if (!schedule.serverIds.length) throw new Error('serverIds is required for command schedules');
      }
      const schedules = [...config.schedules.filter((item) => item.id !== schedule.id), schedule];
      return json(response, 201, { schedule, schedules: saveConfig({ ...config, schedules }).schedules });
    }
    if (request.method === 'PUT' && url.pathname === '/api/schedules') {
      const body = await parseBody(request);
      config.schedules = Array.isArray(body.schedules) ? body.schedules.map((schedule, index) => normalizeSchedule(schedule, `schedule-${index + 1}`)) : [];
      return json(response, 200, { schedules: saveConfig(config).schedules });
    }
    const scheduleMatch = url.pathname.match(/^\/api\/schedules\/([^/]+)$/);
    if (scheduleMatch && ['PATCH', 'DELETE'].includes(request.method)) {
      const scheduleId = decodeURIComponent(scheduleMatch[1]);
      const index = config.schedules.findIndex((item) => item.id === scheduleId);
      if (index < 0) return json(response, 404, { error: 'schedule not found' });
      if (request.method === 'DELETE') {
        const schedules = config.schedules.filter((item) => item.id !== scheduleId);
        return json(response, 200, { schedules: saveConfig({ ...config, schedules }).schedules });
      }
      const body = await parseBody(request);
      const next = normalizeSchedule({ ...config.schedules[index], ...body, id: scheduleId }, scheduleId);
      if (next.type && !['once', 'interval', 'cron'].includes(next.type)) throw new Error('unsupported schedule type');
      if (next.runType === 'command') {
        resolveCommand(next.commandId, next.command);
        if (!Array.isArray(next.serverIds) || !next.serverIds.length) throw new Error('serverIds is required for command schedules');
      } else if (next.workflowId && !config.workflows.some((workflow) => workflow.id === next.workflowId)) throw new Error(`unknown workflow: ${next.workflowId}`);
      const schedules = config.schedules.map((item, itemIndex) => itemIndex === index ? next : item);
      return json(response, 200, { schedule: next, schedules: saveConfig({ ...config, schedules }).schedules });
    }
    if (request.method === 'POST' && url.pathname === '/api/shutdown') {
      json(response, 200, { ok: true });
      setImmediate(shutdown);
      return;
    }
    return json(response, 404, { error: 'not found' });
  } catch (error) {
    return json(response, 400, { error: error.message });
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || HOST}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,PUT,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    response.end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, healthPayload());
  if (url.pathname.startsWith('/api/')) return handleApi(request, response, url);
  response.writeHead(404);
  response.end();
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const match = new URL(request.url, `http://${request.headers.host || HOST}`).pathname.match(/^\/terminal\/([^/]+)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit('connection', webSocket, decodeURIComponent(match[1])));
});

wss.on('connection', (webSocket, serverId) => {
  const configuredServer = findServer(serverId) || normalizeServer({ id: serverId, name: serverId }, serverId);
  const previous = activeTerminalConnections.get(serverId);
  if (previous) previous.dispose(true);

  if (isNativeShell(configuredServer)) {
    let state;
    try {
      state = ensureNativeTerminal(configuredServer);
    } catch (error) {
      console.error(`[pty] failed to create ${serverId}`, error);
      writeToOpenSocket(webSocket, { type: 'status', value: 'error', message: error.message });
      webSocket.close();
      return;
    }
    let detached = false;
    const detach = (closeSocket = false) => {
      if (detached) return;
      detached = true;
      if (state.webSocket === webSocket) state.webSocket = null;
      if (activeTerminalConnections.get(serverId)?.webSocket === webSocket) activeTerminalConnections.delete(serverId);
      if (closeSocket && webSocket.readyState === WebSocket.OPEN) webSocket.close(4001, 'replaced by a newer terminal connection');
    };
    state.webSocket = webSocket;
    activeTerminalConnections.set(serverId, { webSocket, terminal: state.terminal, dispose: detach });
    writeToOpenSocket(webSocket, { type: 'status', value: 'connected', serverId, cwd: state.terminal.cwd, session: '', tmux: false, shell: configuredServer.shell });
    if (state.replay) writeToOpenSocket(webSocket, { type: 'output', data: state.replay, replay: true });
    webSocket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'input') state.terminal.child.write(String(message.data || ''));
        if (message.type === 'resize') state.terminal.child.resize(Math.max(20, Number(message.cols) || 120), Math.max(5, Number(message.rows) || 32));
      } catch (error) {
        writeToOpenSocket(webSocket, { type: 'status', value: 'error', message: error.message });
      }
    });
    webSocket.on('close', detach);
    webSocket.on('error', detach);
    return;
  }

  if (configuredServer.shell === 'wsl') {
    let state;
    try {
      state = ensureWslTerminal(configuredServer);
    } catch (error) {
      console.error(`[pty] failed to create ${serverId}`, error);
      writeToOpenSocket(webSocket, { type: 'status', value: 'error', message: error.message });
      webSocket.close();
      return;
    }
    let detached = false;
    const detach = (closeSocket = false) => {
      if (detached) return;
      detached = true;
      if (state.webSocket === webSocket) state.webSocket = null;
      if (activeTerminalConnections.get(serverId)?.webSocket === webSocket) activeTerminalConnections.delete(serverId);
      if (closeSocket && webSocket.readyState === WebSocket.OPEN) webSocket.close(4001, 'replaced by a newer terminal connection');
    };
    state.webSocket = webSocket;
    activeTerminalConnections.set(serverId, { webSocket, terminal: state.terminal, dispose: detach });
    writeToOpenSocket(webSocket, { type: 'status', value: 'connected', serverId, cwd: state.terminal.cwd, session: state.terminal.session, tmux: state.terminal.useTmux, shell: state.terminal.shell });
    if (state.replay) writeToOpenSocket(webSocket, { type: 'output', data: state.replay, replay: true });
    webSocket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'input') state.terminal.child.write(String(message.data || ''));
        if (message.type === 'resize') state.terminal.child.resize(Math.max(20, Number(message.cols) || 120), Math.max(5, Number(message.rows) || 32));
      } catch (error) {
        writeToOpenSocket(webSocket, { type: 'status', value: 'error', message: error.message });
      }
    });
    webSocket.on('close', detach);
    webSocket.on('error', detach);
    return;
  }

  let terminal;
  let disposed = false;
  try {
    terminal = spawnTerminal(serverId);
    ptyConnections.add(terminal);
  } catch (error) {
    console.error(`[pty] failed to create ${serverId}`, error);
    webSocket.send(JSON.stringify({ type: 'status', value: 'error', message: error.message }));
    webSocket.close();
    return;
  }
  const closeTerminal = (closeSocket = false) => {
    if (disposed) return;
    disposed = true;
    if (activeTerminalConnections.get(serverId)?.webSocket === webSocket) activeTerminalConnections.delete(serverId);
    ptyConnections.delete(terminal);
    killPtyTerminal(terminal);
    if (closeSocket && webSocket.readyState === WebSocket.OPEN) webSocket.close(4001, 'replaced by a newer terminal connection');
  };
  activeTerminalConnections.set(serverId, { webSocket, terminal, dispose: closeTerminal });
  webSocket.send(JSON.stringify({ type: 'status', value: 'connected', serverId, cwd: terminal.cwd, session: terminal.session, tmux: terminal.useTmux, shell: terminal.shell }));
  terminal.child.onData((data) => {
    if (disposed) return;
    if (!terminal.useTmux) appendLog(serverId, data);
    if (webSocket.readyState === WebSocket.OPEN) webSocket.send(JSON.stringify({ type: 'output', data }));
  });
  terminal.child.onExit(({ exitCode }) => {
    closeTerminal();
    if (webSocket.readyState === WebSocket.OPEN) webSocket.send(JSON.stringify({ type: 'status', value: 'exited', exitCode }));
    webSocket.close();
  });
  webSocket.on('message', (raw) => {
    if (disposed) return;
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'input') terminal.child.write(String(message.data || ''));
      if (message.type === 'resize') terminal.child.resize(Math.max(20, Number(message.cols) || 120), Math.max(5, Number(message.rows) || 32));
    } catch (error) {
      if (webSocket.readyState === WebSocket.OPEN) webSocket.send(JSON.stringify({ type: 'status', value: 'error', message: error.message }));
    }
  });
  webSocket.on('close', closeTerminal);
  webSocket.on('error', closeTerminal);
});

function shutdown() {
  if (shutdownRequested) return;
  shutdownRequested = true;
  stopScheduler();
  for (const terminal of ptyConnections) {
    killPtyTerminal(terminal);
  }
  nativeTerminals.clear();
  wslTerminals.clear();
  activeTerminalConnections.clear();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref?.();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
startScheduler();
server.listen(PORT, HOST, () => {
  console.log(`Nexus PTY listening on ws://${HOST}:${PORT}`);
  console.log(`Config: ${CONFIG_PATH}`);
  console.log(`Logs: ${LOG_DIR}`);
  if (WSL_CONFIG.distro) console.log(`WSL distro: ${WSL_CONFIG.distro} (${WSL_CONFIG.source})`);
  void enableLoggingForExistingSessions();
});
