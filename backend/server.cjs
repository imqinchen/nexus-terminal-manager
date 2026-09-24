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
// Bump this when the PTY wire behavior changes. Electron uses it to avoid
// silently reusing an older manually-started backend that still renders the
// legacy connection banner.
const BACKEND_RUNTIME_VERSION = 16;
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
const TMUX_HISTORY_LIMIT = 10000;
// Renderer tabs are recreated when the user switches sessions. Restore a
// useful amount of tmux history into the new xterm buffer so the scrollbar
// does not collapse to the visible pane after every switch.
const TMUX_RESTORE_HISTORY_LINES = Math.max(
  100,
  Number(process.env.NEXUS_RESTORE_HISTORY_LINES) || 1000,
);
// Keep managed sessions in the normal terminal buffer so xterm can expose
// tmux history through mouse-wheel and scrollbar navigation.
const TMUX_ALTERNATE_SCREEN = 'off';
// Nexus renders its own connection/session chrome. Keeping tmux's status bar
// disabled avoids a second repaint of the bottom row after a screen restore.
const TMUX_STATUS = 'off';
// These bounds remain as a guard for an in-flight renderer rebind. Fresh
// attachments use the already-buffered tmux repaint immediately and do not
// wait for this synchronization window.
const TMUX_SCREEN_SYNC_MAX_DELAY = Math.max(500, Number(process.env.NEXUS_SCREEN_SYNC_MAX_DELAY) || 1000);
const TMUX_SCREEN_SYNC_MIN_DELAY = Math.min(
  TMUX_SCREEN_SYNC_MAX_DELAY,
  Math.max(300, Number(process.env.NEXUS_SCREEN_SYNC_MIN_DELAY) || 500),
);
const TMUX_SCREEN_SYNC_QUIET_DELAY = Math.max(120, Number(process.env.NEXUS_SCREEN_SYNC_QUIET_DELAY) || 180);
const TMUX_INITIAL_DISPLAY_TIME = 100;
const TMUX_INITIAL_BUFFER_LIMIT = 2 * 1024 * 1024;
const TMUX_INITIAL_INPUT_LIMIT = 256 * 1024;
const CAPABILITY_CACHE_TTL = 30000;
const capabilityCache = { tmux: null, tmuxCheckedAt: 0, wsl: null, wslCheckedAt: 0 };
let capabilityRefreshPromise = null;
let shutdownRequested = false;
let schedulerTimer;

const EMPTY_CONFIG = {
  version: 1,
  groups: [],
  terminalWorkspaces: [],
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

function normalizeTerminalWorkspaces(items, validServerIds) {
  if (!Array.isArray(items)) return [];
  const usedWorkspaceIds = new Set();
  const normalizeThreePaneLayout = (value) => {
    const firstRatio = Number(value?.firstRatio);
    const secondRatio = Number(value?.secondRatio);
    const thirdRatio = 1 - firstRatio - secondRatio;
    return Number.isFinite(firstRatio) && Number.isFinite(secondRatio)
      && firstRatio >= 0.2 && secondRatio >= 0.2 && thirdRatio >= 0.2
      ? { firstRatio, secondRatio }
      : { firstRatio: 1 / 3, secondRatio: 1 / 3 };
  };
  const normalizeRatio = (value) => {
    const ratio = Number(value);
    // Values from hand-edited JSON are configuration, not an in-progress
    // drag.  Treat a missing or out-of-range value as the safe 50/50 layout
    // instead of silently turning a bad value into an unexpected edge split.
    return Number.isFinite(ratio) && ratio >= 0.3 && ratio <= 0.7 ? ratio : 0.5;
  };
  return items.map((workspace, index) => {
    const baseId = safeId(workspace?.id || `workspace-${index + 1}`);
    let id = baseId;
    let suffix = 2;
    while (usedWorkspaceIds.has(id)) {
      id = safeId(`${baseId}-${suffix}`);
      suffix += 1;
    }
    usedWorkspaceIds.add(id);
    const seenServerIds = new Set();
    const serverIds = [];
    for (const rawServerId of Array.isArray(workspace?.serverIds) ? workspace.serverIds : []) {
      const serverId = String(rawServerId || '');
      if (!validServerIds.has(serverId) || seenServerIds.has(serverId)) continue;
      seenServerIds.add(serverId);
      serverIds.push(serverId);
      if (serverIds.length === 4) break;
    }
    return {
      id,
      name: String(workspace?.name || `Terminal workspace ${index + 1}`).trim().slice(0, 120) || `Terminal workspace ${index + 1}`,
      serverIds,
      threePaneLayout: normalizeThreePaneLayout(workspace?.threePaneLayout),
      fourPaneLayout: {
        columnRatio: normalizeRatio(workspace?.fourPaneLayout?.columnRatio),
        rowRatio: normalizeRatio(workspace?.fourPaneLayout?.rowRatio),
      },
    };
  });
}

function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return clone(EMPTY_CONFIG);
  if (Array.isArray(raw.groups)) {
    const groups = raw.groups.map((group, index) => ({
      id: safeId(group?.id || `group-${index + 1}`),
      name: String(group?.name || `Group ${index + 1}`),
      note: String(group?.note || ''),
      accent: String(group?.accent || 'mint'),
      servers: Array.isArray(group?.servers) ? group.servers.map((server, serverIndex) => normalizeServer(server, `server-${index + 1}-${serverIndex + 1}`)) : [],
    }));
    const validServerIds = new Set(groups.flatMap((group) => group.servers.map((server) => server.id)));
    const config = {
      ...clone(EMPTY_CONFIG),
      ...raw,
      version: 1,
      groups,
      terminalWorkspaces: normalizeTerminalWorkspaces(raw.terminalWorkspaces, validServerIds),
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
// `mtime:size` is useful for noticing an external edit, but it is not an
// ordering guarantee: two rapid writes can share a timestamp on some file
// systems.  Keep an in-process monotonic revision as well so renderer polls
// can reliably reject a response that was made before a newer save/delete.
let configRevision = 1;

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
  configRevision += 1;
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
  configRevision += 1;
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
    execFile(command, commandArgs, {
      timeout: options.timeout || 10000,
      windowsHide: true,
      maxBuffer: options.maxBuffer || 1024 * 1024,
    }, (error, stdout, stderr) => {
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

function decodeWindowsOutput(value) {
  if (!Buffer.isBuffer(value)) return String(value || '');
  if (!value.length) return '';
  const utf8 = value.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  try { return new TextDecoder('gb18030').decode(value); } catch { return utf8; }
}

function commandErrorDetail(error) {
  const output = [error?.stdout, error?.stderr]
    .map(decodeWindowsOutput)
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n');
  return output || error?.message || 'unknown process error';
}

function runHost(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(program, args, {
      timeout: options.timeout || 10000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      encoding: 'buffer',
    }, (error, stdout, stderr) => {
      const decodedStdout = decodeWindowsOutput(stdout);
      const decodedStderr = decodeWindowsOutput(stderr);
      if (error) {
        error.stdout = decodedStdout;
        error.stderr = decodedStderr;
        reject(error);
        return;
      }
      resolve({ stdout: decodedStdout, stderr: decodedStderr });
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
  await runGuest('tmux', ['set-option', '-t', session, 'history-limit', String(TMUX_HISTORY_LIMIT)], { timeout: 4000 });
  await runGuest('tmux', ['set-option', '-t', session, 'display-time', String(TMUX_INITIAL_DISPLAY_TIME)], { timeout: 4000 });
  await runGuest('tmux', ['set-option', '-t', session, 'status', TMUX_STATUS], { timeout: 4000 });
  await runGuest('tmux', ['set-window-option', '-t', session, 'alternate-screen', TMUX_ALTERNATE_SCREEN], { timeout: 4000 });
  await runGuest('tmux', ['set-window-option', '-t', session, 'aggressive-resize', 'on'], { timeout: 4000 });
  await enableTmuxLogging(server);
  return true;
}

async function enableLoggingForExistingSessions() {
  if (!hasTmux()) return;
  const results = await Promise.allSettled(allServers().filter((server) => server.shell === 'wsl' && server.tmux !== false).map(async (server) => {
    const session = server.session || `nexus-${safeId(server.id)}`;
    if (!(await tmuxSessionExists(session))) return;
    await runGuest('tmux', ['set-option', '-t', session, 'history-limit', String(TMUX_HISTORY_LIMIT)], { timeout: 4000 });
    await runGuest('tmux', ['set-option', '-t', session, 'display-time', String(TMUX_INITIAL_DISPLAY_TIME)], { timeout: 4000 });
    await runGuest('tmux', ['set-option', '-t', session, 'status', TMUX_STATUS], { timeout: 4000 });
    await runGuest('tmux', ['set-window-option', '-t', session, 'alternate-screen', TMUX_ALTERNATE_SCREEN], { timeout: 4000 });
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

function sendInitialTmuxReset(state, webSocket, reason = 'fresh-attachment') {
  if (!state || !webSocket || state.initialResetSocket === webSocket) return;
  writeToOpenSocket(webSocket, { type: 'reset', reason });
  state.initialResetSocket = webSocket;
}

function clearInitialTmuxTimers(state) {
  if (!state) return;
  if (state.initialResetTimer) clearTimeout(state.initialResetTimer);
  if (state.initialMarkerTimer) clearTimeout(state.initialMarkerTimer);
  if (state.initialFallbackTimer) clearTimeout(state.initialFallbackTimer);
  state.initialResetTimer = null;
  state.initialMarkerTimer = null;
  state.initialFallbackTimer = null;
}

async function captureTmuxSnapshot(state, timeout = 4000, includeScrollback = false) {
  const session = state?.terminal?.session;
  if (!session) return '';
  try {
    // Fresh attachments use the visible pane only. A renderer rebind (tab
    // switch/reconnect) asks for recent history as well, because its previous
    // xterm instance and local scrollback were disposed by React.
    const captureArgs = ['capture-pane', '-e', '-p'];
    if (includeScrollback) captureArgs.push('-S', `-${TMUX_RESTORE_HISTORY_LINES}`);
    captureArgs.push('-t', session);
    const cursorFormat = process.platform === 'win32'
      ? '\\#{cursor_x}:\\#{cursor_y}'
      : '#{cursor_x}:#{cursor_y}';
    const [paneResult, cursorResult] = await Promise.all([
      runGuest('tmux', captureArgs, { timeout, maxBuffer: 8 * 1024 * 1024 }),
      runGuest('tmux', ['display-message', '-p', '-t', session, cursorFormat], { timeout }),
    ]);
    const pane = String(paneResult.stdout || '');
    if (!pane) return '';
    const cursor = String(cursorResult.stdout || '').trim().match(/^(\d+):(\d+)$/);
    if (!cursor) return pane;
    const column = Math.max(1, Number(cursor[1]) + 1);
    const row = Math.max(1, Number(cursor[2]) + 1);
    return `\x1b[?25l\x1b[H${pane}\x1b[${row};${column}H\x1b[?25h`;
  } catch (error) {
    if (process.env.NEXUS_DEBUG_PTY) console.warn(`[pty] unable to capture tmux snapshot ${state.serverId || ''}: ${error.message}`);
    return '';
  }
}

async function refreshTmuxSnapshotCache(state) {
  if (!state?.terminal?.useTmux || state.disposed || !state.initialResetDone) return;
  const captureGeneration = (state.snapshotCaptureGeneration || 0) + 1;
  const outputRevision = state.outputRevision || 0;
  state.snapshotCaptureGeneration = captureGeneration;
  const snapshot = await captureTmuxSnapshot(state, 1500, true);
  if (
    !snapshot
    || state.disposed
    || state.snapshotCaptureGeneration !== captureGeneration
    || state.outputRevision !== outputRevision
  ) return;
  state.snapshotCache = snapshot;
  state.snapshotRevision = outputRevision;
}

function completeTmuxRendererRebind(state, webSocket, syncGeneration, snapshot) {
  if (
    !state
    || state.disposed
    || state.initialSyncGeneration !== syncGeneration
    || state.webSocket !== webSocket
  ) return false;
  clearInitialTmuxTimers(state);
  const bufferedOutput = String(state.initialTmuxBuffer || '');
  state.initialTmuxBuffer = '';
  state.initialResetDone = true;
  state.initialResetStartedAt = 0;
  state.initialResetFinishing = false;
  sendInitialTmuxReset(state, webSocket, 'renderer-rebind');
  if (snapshot) writeToOpenSocket(webSocket, { type: 'output', data: snapshot, snapshot: true });
  // Output produced while capture-pane was in flight must not be lost. It can
  // overlap the very end of a busy snapshot, but preserving live output is
  // preferable to silently dropping a service message.
  if (bufferedOutput) writeToOpenSocket(webSocket, { type: 'output', data: bufferedOutput });
  const pendingInput = state.initialInputBuffer || '';
  state.initialInputBuffer = '';
  if (pendingInput && state.terminal?.child) {
    setImmediate(() => {
      if (!state.disposed && state.webSocket === webSocket) {
        try { state.terminal.child.write(pendingInput); } catch { /* PTY exited */ }
      }
    });
  }
  if (snapshot && !bufferedOutput) {
    state.snapshotCache = snapshot;
    state.snapshotRevision = state.outputRevision || 0;
  }
  return true;
}

async function restoreTmuxRendererFromSnapshot(state, webSocket, syncGeneration, cachedSnapshot = '') {
  let snapshot = cachedSnapshot;
  if (!snapshot) snapshot = await captureTmuxSnapshot(state, 1200, true);
  completeTmuxRendererRebind(state, webSocket, syncGeneration, snapshot);
}

async function finishInitialTmuxAttachment(state) {
  if (!state || state.initialResetDone || state.initialResetFinishing) return;
  const syncGeneration = state.initialSyncGeneration;
  const reason = state.initialResetReason || 'fresh-attachment';
  const restoreSnapshot = reason !== 'fresh-attachment';
  state.initialResetFinishing = true;
  if (process.env.NEXUS_DEBUG_PTY) console.log(`[pty] initial attachment finished ${state.serverId || state.terminal?.serverId || ''}`);
  clearInitialTmuxTimers(state);
  // Fresh attachments now stream their first PTY repaint immediately. This
  // delayed path is retained only for a renderer rebind that needs a
  // capture-pane replacement while the shared PTY is still attached.
  let snapshot = restoreSnapshot ? String(state.initialTmuxBuffer || '') : '';
  if (!restoreSnapshot) state.initialTmuxBuffer = '';
  // Some tmux/ConPTY combinations do not emit the repaint through node-pty.
  // Read the visible pane directly in that case so a tab switch still has a
  // useful screen instead of only the renderer's local prompt.
  if (restoreSnapshot && !snapshot) snapshot = await captureTmuxSnapshot(state, 4000, true);
  // A new rebind can start while the fallback capture is in flight. Do not let
  // the old capture reset or paint over the newer renderer connection.
  if (state.initialSyncGeneration !== syncGeneration || state.disposed) {
    if (state.initialSyncGeneration === syncGeneration) state.initialResetFinishing = false;
    return;
  }
  // Prefer any PTY repaint that arrived while the fallback command was being
  // queried; it includes cursor placement and terminal control sequences.
  if (restoreSnapshot && state.initialTmuxBuffer) snapshot = String(state.initialTmuxBuffer);
  state.initialTmuxBuffer = '';
  state.initialResetDone = true;
  state.initialResetStartedAt = 0;
  if (state.disposed) {
    state.initialResetFinishing = false;
    return;
  }
  // node-pty uses ConPTY on Windows.  Clearing xterm in the renderer without
  // clearing ConPTY's own screen cache lets Windows replay the attach paint a
  // moment later (usually after the reset packet), which looks like a delayed
  // "PTY ready"/tmux snapshot.  Keep the PTY process and tmux session alive;
  // this only drops the stale renderer-side screen state.
  try { state.terminal.child.clear?.(); } catch { /* PTY may have exited */ }
  // Reset only after every quarantined repaint has drained. The renderer
  // already shows a local prompt while this short synchronization completes.
  sendInitialTmuxReset(state, state.webSocket, reason);
  if (restoreSnapshot && snapshot) {
    // The renderer resets once more before writing a same-process snapshot, so
    // the local prompt drawn during the handshake is replaced by the real pane.
    writeToOpenSocket(state.webSocket, { type: 'output', data: snapshot, snapshot: true });
  }
  const pendingInput = state.initialInputBuffer || '';
  state.initialInputBuffer = '';
  if (pendingInput && state.terminal?.child) {
    // The reset packet is queued before the command bytes, so the renderer is
    // clean and ready by the time the real shell echo/output arrives.
    setImmediate(() => {
      if (!state.disposed) {
        try { state.terminal.child.write(pendingInput); } catch { /* PTY exited */ }
      }
    });
  }
  state.initialResetFinishing = false;
}

function triggerInitialTmuxProbe(state) {
  if (!state || state.initialProbeSent || !state.terminal?.child) return false;
  state.initialProbeSent = true;
  // Resizing to the current dimensions is harmless to the attached shell, but
  // makes tmux 2.x flush any screen repaint it kept pending behind ConPTY.
  try {
    state.terminal.child.resize(Math.max(20, state.cols || 120), Math.max(5, state.rows || 32));
    return true;
  } catch {
    return false;
  }
}

function scheduleInitialTmuxQuiet(state) {
  if (!state || state.initialResetDone) return;
  if (state.initialMarkerTimer) clearTimeout(state.initialMarkerTimer);
  state.initialMarkerTimer = setTimeout(() => {
    state.initialMarkerTimer = null;
    advanceInitialTmuxSync(state);
  }, TMUX_SCREEN_SYNC_QUIET_DELAY);
  state.initialMarkerTimer.unref?.();
}

function advanceInitialTmuxSync(state) {
  if (!state || state.initialResetDone || state.initialResetFinishing || state.disposed) return;
  // Trigger one controlled repaint before declaring the renderer ready.
  // Keystrokes received during the sync remain queued until after reset, so
  // their real shell echo and command output remain visible to the user.
  const probed = triggerInitialTmuxProbe(state);
  if (probed) {
    scheduleInitialTmuxQuiet(state);
    return;
  }
  const elapsed = Date.now() - (state.initialResetStartedAt || Date.now());
  const minimumDelay = Math.min(
    Math.max(300, Number(state.initialResetMaxDelay) || TMUX_SCREEN_SYNC_MAX_DELAY),
    Math.max(300, Number(state.initialResetMinDelay) || TMUX_SCREEN_SYNC_MIN_DELAY),
  );
  if (elapsed < minimumDelay) {
    if (state.initialMarkerTimer) clearTimeout(state.initialMarkerTimer);
    state.initialMarkerTimer = setTimeout(() => {
      state.initialMarkerTimer = null;
      advanceInitialTmuxSync(state);
    }, minimumDelay - elapsed);
    state.initialMarkerTimer.unref?.();
    return;
  }
  const syncGeneration = state.initialSyncGeneration;
  void finishInitialTmuxAttachment(state).catch((error) => {
    if (process.env.NEXUS_DEBUG_PTY) console.warn(`[pty] initial tmux sync failed ${state.serverId || ''}: ${error.message}`);
    if (state.initialSyncGeneration === syncGeneration) state.initialResetFinishing = false;
  });
}

function scheduleInitialTmuxReset(state, webSocket) {
  if (!state?.terminal?.useTmux || state.initialResetDone || !webSocket) return;
  if (!state.initialResetStartedAt) state.initialResetStartedAt = Date.now();
  // The PTY is shared by reconnecting renderer sockets. Do not restart the
  // hard deadline every time a tab is rebound, otherwise a slow/unstable
  // client can keep the initial screen quarantined indefinitely.
  if (state.initialResetTimer) return;
  const elapsed = Date.now() - state.initialResetStartedAt;
  const maxDelay = Math.max(500, Number(state.initialResetMaxDelay) || TMUX_SCREEN_SYNC_MAX_DELAY);
  const remaining = Math.max(0, maxDelay - elapsed);
  state.initialResetTimer = setTimeout(() => {
    state.initialResetTimer = null;
    // A tmux build without a recognizable marker still gets a bounded
    // fallback. Give the pending probe/input one final quiet cycle before
    // releasing the renderer; this prevents a late repaint from leaking out
    // immediately after the hard deadline.
    advanceInitialTmuxSync(state);
  }, remaining);
  state.initialResetTimer.unref?.();
}

function beginInitialTmuxAttachment(state, webSocket) {
  if (!state?.terminal?.useTmux || state.initialResetDone || !webSocket) return;
  if (process.env.NEXUS_DEBUG_PTY) console.log(`[pty] restoring tmux screen ${state.serverId || ''}`);
  // A newly-created PTY already contains tmux's repaint in initialTmuxBuffer.
  // Release it immediately instead of quarantining it behind a quiet-period
  // timer. This keeps reconnects as quick as the old direct-stream behavior.
  clearInitialTmuxTimers(state);
  state.initialSyncGeneration += 1;
  state.initialResetFinishing = false;
  state.initialResetStartedAt = 0;
  state.initialResetDone = true;
  const syncGeneration = state.initialSyncGeneration;
  const bufferedOutput = String(state.initialTmuxBuffer || '');
  state.initialTmuxBuffer = '';
  if (bufferedOutput) {
    // This is the actual PTY stream. Keep it as ordinary output so the
    // renderer never clears a retained canvas merely because the first chunk
    // happened to arrive before the WebSocket callback.
    writeToOpenSocket(webSocket, { type: 'output', data: bufferedOutput });
  } else {
    // The PTY can win the race and attach before node-pty emits its first
    // repaint. Read the pane directly, but never overwrite live output that
    // arrived while capture-pane was running.
    const revision = state.outputRevision || 0;
    // Only show the compatibility prompt when tmux produced no repaint at
    // all. Any PTY byte cancels this path, so a retained screen is never
    // cleared just because capture-pane is slow.
    state.initialFallbackTimer = setTimeout(() => {
      state.initialFallbackTimer = null;
      if (
        !state.disposed
        && state.webSocket === webSocket
        && state.initialSyncGeneration === syncGeneration
        && state.outputRevision === revision
      ) writeToOpenSocket(webSocket, { type: 'reset', reason: 'fresh-attachment' });
    }, 900);
    state.initialFallbackTimer.unref?.();
    void captureTmuxSnapshot(state, 1200).then((snapshot) => {
      if (
        !snapshot
        || state.disposed
        || state.webSocket !== webSocket
        || state.initialSyncGeneration !== syncGeneration
        || state.outputRevision !== revision
      ) return;
      if (state.initialFallbackTimer) clearTimeout(state.initialFallbackTimer);
      state.initialFallbackTimer = null;
      writeToOpenSocket(webSocket, { type: 'output', data: snapshot, snapshot: true });
      state.snapshotCache = snapshot;
      state.snapshotRevision = state.outputRevision || 0;
    }).catch(() => { /* the live PTY remains usable without a snapshot */ });
  }
  const pendingInput = state.initialInputBuffer || '';
  state.initialInputBuffer = '';
  if (pendingInput && state.terminal?.child) {
    setImmediate(() => {
      if (!state.disposed && state.webSocket === webSocket) {
        try { state.terminal.child.write(pendingInput); } catch { /* PTY exited */ }
      }
    });
  }
}

function beginTmuxRendererRebind(state, webSocket, resizeRenderer = false) {
  if (!state?.terminal?.useTmux || !webSocket || state.disposed) return;
  clearInitialTmuxTimers(state);
  state.initialTmuxBuffer = '';
  state.initialResetSocket = null;
  state.initialInputBuffer = '';
  state.initialProbeSent = false;
  state.initialResetReason = resizeRenderer ? 'renderer-resize' : 'renderer-rebind';
  const cachedSnapshot = !resizeRenderer && state.snapshotRevision === state.outputRevision ? state.snapshotCache : '';
  state.initialResetDone = false;
  state.initialResetStartedAt = Date.now();
  state.initialResetFinishing = true;
  state.initialSyncGeneration += 1;
  const syncGeneration = state.initialSyncGeneration;
  if (resizeRenderer) {
    // Put the retained tmux client at its new size before capture-pane runs.
    // The resulting ConPTY repaint is buffered while the direct snapshot is
    // prepared, so a resized inactive tab no longer falls back to the old
    // half-second synchronization window.
    try { state.terminal.child.resize(state.cols, state.rows); } catch { /* PTY exited */ }
  }
  void restoreTmuxRendererFromSnapshot(state, webSocket, syncGeneration, cachedSnapshot).catch((error) => {
    if (process.env.NEXUS_DEBUG_PTY) console.warn(`[pty] unable to restore tmux renderer ${state.serverId || ''}: ${error.message}`);
    completeTmuxRendererRebind(state, webSocket, syncGeneration, '');
  });
}

function consumeInitialTmuxData(state, data) {
  if (!state || state.initialResetDone) return '';
  const chunk = String(data || '');
  if (chunk) state.initialTmuxBuffer = `${state.initialTmuxBuffer || ''}${chunk}`.slice(-TMUX_INITIAL_BUFFER_LIMIT);
  if (!chunk) return '';
  // Fresh attachments are released by beginInitialTmuxAttachment as soon as
  // the WebSocket owns the PTY. Only a renderer rebind needs the quiet-period
  // guard while its direct capture-pane snapshot is being prepared.
  if (state.initialResetReason !== 'fresh-attachment') scheduleInitialTmuxQuiet(state);
  return '';
}

function writeWslInput(state, data) {
  if (!state || !data || state.disposed || !state.terminal?.child) return;
  // Keep all typing in order with the pane repaint. The queue is flushed as
  // soon as the final cursor sequence arrives. Ctrl+C is the one exception:
  // it must always reach the foreground process immediately, even while a
  // slow tmux repaint is being quarantined.
  if (state.terminal.useTmux && !state.initialResetDone) {
    if (String(data).includes('\u0003')) {
      try { state.terminal.child.write(String(data)); } catch { /* PTY exited */ }
      return;
    }
    state.initialInputBuffer = `${state.initialInputBuffer || ''}${String(data)}`.slice(-TMUX_INITIAL_INPUT_LIMIT);
    return;
  }
  try { state.terminal.child.write(String(data)); } catch { /* PTY exited */ }
}

function createNativeTerminal(serverId, requestedSize = {}) {
  const terminal = spawnTerminal(serverId, requestedSize);
  const state = {
    terminal,
    webSocket: null,
    cols: terminal.cols,
    rows: terminal.rows,
    disposed: false,
  };
  nativeTerminals.set(serverId, state);
  ptyConnections.add(terminal);
  terminal.child.onData((data) => {
    if (state.disposed) return;
    appendLog(serverId, data);
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

function ensureNativeTerminal(server, requestedSize = {}) {
  const existing = nativeTerminals.get(server.id);
  if (existing && !existing.disposed) return existing;
  return createNativeTerminal(server.id, requestedSize);
}

function createWslTerminal(serverId, requestedSize = {}) {
  const terminal = spawnTerminal(serverId, requestedSize);
  const state = {
    terminal,
    serverId,
    webSocket: null,
    cols: terminal.cols,
    rows: terminal.rows,
    initialResetDone: false,
    initialResetTimer: null,
    initialFallbackTimer: null,
    initialResetStartedAt: 0,
    initialTmuxBuffer: '',
    initialResetSocket: null,
    initialMarkerTimer: null,
    initialInputBuffer: '',
    initialResetReason: 'fresh-attachment',
    initialResetMaxDelay: TMUX_SCREEN_SYNC_MAX_DELAY,
    initialResetMinDelay: TMUX_SCREEN_SYNC_MIN_DELAY,
    initialProbeSent: false,
    initialSyncGeneration: 0,
    initialResetFinishing: false,
    outputRevision: 0,
    snapshotCache: '',
    snapshotRevision: -1,
    snapshotCaptureGeneration: 0,
    disposed: false,
  };
  wslTerminals.set(serverId, state);
  ptyConnections.add(terminal);
  terminal.child.onData((data) => {
    if (state.disposed) return;
    state.outputRevision += 1;
    if (state.initialFallbackTimer) {
      clearTimeout(state.initialFallbackTimer);
      state.initialFallbackTimer = null;
    }
    if (terminal.useTmux && !state.initialResetDone) {
      // Keep the first repaint buffered only while a renderer rebind is
      // preparing its capture-pane replacement. Fresh attachments release the
      // buffer immediately after the WebSocket is assigned.
      consumeInitialTmuxData(state, data);
      return;
    }
    // tmux sessions already write through pipe-pane. Non-tmux WSL shells need
    // the same log handling as native shells.
    if (!terminal.useTmux) appendLog(serverId, data);
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

function ensureWslTerminal(server, requestedSize = {}) {
  const existing = wslTerminals.get(server.id);
  if (existing && !existing.disposed) return existing;
  return createWslTerminal(server.id, requestedSize);
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
  if (state.initialResetTimer) clearTimeout(state.initialResetTimer);
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
  if (state.initialResetTimer) clearTimeout(state.initialResetTimer);
  if (state.initialMarkerTimer) clearTimeout(state.initialMarkerTimer);
  state.initialResetTimer = null;
  state.initialMarkerTimer = null;
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

async function guestProcessSnapshot() {
  try {
    // Reading every /proc cwd/cmdline entry is surprisingly slow on WSL1.
    // ps gives us the complete process tree in one call; service identities
    // in the command line are enough to identify the configured service.
    const { stdout } = await runGuest('ps', ['-eo', 'pid=,ppid=,comm=,args='], { timeout: 5000 });
    return String(stdout || '').split(/\r?\n/).map((line) => {
      const columns = line.split('\t');
      if (columns.length >= 4) {
        const pid = Number(columns[0]);
        const ppid = Number(columns[1]);
        if (!Number.isInteger(pid) || pid <= 1) return null;
        return { pid, ppid: Number.isInteger(ppid) ? ppid : 0, cwd: columns[2] || '', args: columns.slice(3).join('\t') || '' };
      }
      const fields = line.trim().split(/\s+/);
      const pid = Number(fields[0]);
      const ppid = Number(fields[1]);
      if (!Number.isInteger(pid) || pid <= 1 || !Number.isInteger(ppid)) return null;
      return { pid, ppid, cwd: '', args: fields.slice(2).join(' ') };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function compactGuestIdentity(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function guestIdentityCompounds(value) {
  const parts = String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const compounds = new Set(parts);
  for (let start = 0; start < parts.length; start += 1) {
    let compound = '';
    for (let end = start; end < Math.min(parts.length, start + 4); end += 1) {
      compound += parts[end];
      compounds.add(compound);
    }
  }
  return compounds;
}

function guestPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalized || normalized === '/') return '/';
  return normalized.replace(/\/$/, '');
}

function processIsUnderGuestPath(processInfo, root) {
  const cwd = guestPath(processInfo.cwd);
  const base = guestPath(root);
  return cwd === base || cwd.startsWith(`${base}/`);
}

function serverProcessIdentities(server) {
  // Prefer human-readable service names/session names. The short id alone
  // is too weak when `ps` cannot expose a process cwd on WSL1.
  return [server.name, server.label, server.session]
    .map(compactGuestIdentity)
    .filter((value) => value.length >= 4);
}

function processArgumentsMatchServer(processInfo, server) {
  const identities = serverProcessIdentities(server);
  if (!identities.length) return false;
  const compounds = guestIdentityCompounds(processInfo.args);
  return identities.some((identity) => [...compounds].some((compound) => compound === identity || compound.endsWith(identity)));
}

function processMatchesServer(processInfo, server) {
  if (/(?:^|\s)tmux(?::\s*server)?(?:\s|$)/i.test(String(processInfo.args || ''))) return false;
  if (processInfo.cwd) {
    if (!processIsUnderGuestPath(processInfo, guestCwd(server))) return false;
  } else if (!/(?:^|\s)(?:screen|SCREEN|beam\.smp|erl|start\.sh)(?:\s|$)/i.test(String(processInfo.args || ''))) {
    // WSL1's ps output has no cwd column. Without a runtime marker, a short
    // configured name could accidentally match an unrelated process.
    return false;
  }
  const identities = serverProcessIdentities(server);
  const compounds = new Set([...guestIdentityCompounds(processInfo.args), ...guestIdentityCompounds(processInfo.cwd)]);
  return identities.some((identity) => [...compounds].some((compound) => compound === identity || compound.endsWith(identity)));
}

async function tmuxPanePids(session) {
  if (!session || !hasTmux()) return [];
  try {
    // wsl.exe treats an unescaped `#` as the start of a shell comment while
    // reconstructing direct command arguments. The leading backslash is
    // removed by that outer parser before tmux receives its format string.
    const { stdout } = await runGuest('tmux', ['list-panes', '-t', `${session}:`, '-F', '\\#{pane_pid}'], { timeout: 5000 });
    return [...new Set(String(stdout || '').match(/\d+/g)?.map(Number).filter((pid) => Number.isInteger(pid) && pid > 1) || [])];
  } catch {
    return [];
  }
}

function processTreeIds(processes, roots) {
  const children = new Map();
  processes.forEach((processInfo) => {
    if (!children.has(processInfo.ppid)) children.set(processInfo.ppid, []);
    children.get(processInfo.ppid).push(processInfo.pid);
  });
  const ids = new Set();
  const visit = (pid) => {
    if (ids.has(pid)) return;
    ids.add(pid);
    (children.get(pid) || []).forEach(visit);
  };
  roots.forEach(visit);
  return [...ids];
}

function screenSessionName(processInfo) {
  const match = String(processInfo.args || '').match(/\s-dmSL\s+(\S+)/i);
  return match?.[1] || '';
}

async function sendScreenStopCommand(server, processes) {
  const stopCommand = String(server.stopCommand || '').trim();
  if (!stopCommand) return;
  const sessions = [...new Set(processes
    .filter((processInfo) => /(?:^|\s)(?:screen|SCREEN)(?:\s|$)/.test(processInfo.args))
    .filter((processInfo) => processMatchesServer(processInfo, server) || processArgumentsMatchServer(processInfo, server))
    .map(screenSessionName)
    .filter(Boolean))];
  await Promise.allSettled(sessions.map((session) => runGuest('screen', ['-S', session, '-X', 'stuff', `${stopCommand}\r`], { timeout: 8000 })));
}

async function matchingWslProcessIds(server, options = {}) {
  if (process.platform !== 'win32' || server?.shell !== 'wsl') return { processes: [], ids: [] };
  const processes = await guestProcessSnapshot();
  const matching = processes.filter((processInfo) => processMatchesServer(processInfo, server));
  const panePids = options.includePanePids === false
    ? []
    : await tmuxPanePids(server.session || `nexus-${safeId(server.id)}`);
  const treeRoots = [...new Set([...panePids, ...matching.map((processInfo) => processInfo.pid)])];
  const ids = processTreeIds(processes, treeRoots).filter((pid) => pid > 1);
  return { processes, ids };
}

async function signalMatchingWslProcesses(server, signal, options = {}) {
  const found = await matchingWslProcessIds(server, options);
  return signalGuestProcessIds(server, found.ids, signal);
}

async function signalGuestProcessIds(server, ids, signal) {
  if (!Array.isArray(ids) || !ids.length) return { ids: [], failed: [] };
  const results = await Promise.allSettled(ids.map((pid) => runGuest('kill', [`-${signal}`, String(pid)], { timeout: 6000 })));
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length) {
    console.warn(`[delete] ${signal} failed for WSL ${server.id}: ${failed.map((result) => commandErrorDetail(result.reason)).join(' | ')}`);
  }
  return { ids, failed };
}

async function signalPortListeners(port, signal, server) {
  const listeners = await portListeners(port);
  if (!listeners.length) return { listeners: [], failed: [], remaining: false };
  const results = await Promise.allSettled(listeners.map((listener) => {
    // WSL1 exposes Linux listeners to Windows netstat with a Windows PID,
    // but taskkill cannot terminate that process. The WSL process tree is
    // handled separately by signalMatchingWslProcesses.
    if (server?.shell === 'wsl' && listener.source === 'windows') return Promise.resolve();
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
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length) {
    const details = failed.map((result) => commandErrorDetail(result.reason)).join(' | ');
    console.warn(`[ports] ${signal} failed for ${port}: ${details}`);
  }
  return { listeners, failed, remaining: await isPortListening(port) };
}

/**
 * Stop the runtime owned by one configured terminal.
 *
 * Deleting a terminal is intentionally stronger than closing the client: the
 * former removes the tmux session and makes a best effort to release a
 * configured port, while the latter keeps the tmux session so it can be
 * re-attached after the next launch.  Keeping that distinction here prevents
 * the close-client action from destroying a user's persistent session.
 */
async function stopServerRuntime(server, options = {}) {
  if (!server) throw new Error('server is required');
  const serverId = server.id;
  const session = server.session || `nexus-${safeId(server.id)}`;
  const preserveSession = options.preserveSession === true;
  const forceKill = options.forceKill !== false;
  const operation = options.operation || (preserveSession ? 'shutdown' : 'delete');
  const configured = configuredPort(server);
  // Never inspect or signal the Nexus API port itself.  A malformed service
  // configuration should not make closing the application kill its backend.
  const port = configured === PORT ? null : configured;
  if (configured === PORT && !preserveSession) {
    throw new Error(`configured port ${configured} belongs to the Nexus backend; correct the terminal port before deleting`);
  }
  // Capture the initial state so a service that is already stopped does not
  // incur the graceful-stop delays below. The value is also returned to the
  // UI as an accurate account of what the delete operation found.
  const portWasListening = port ? await isPortListening(port) : false;
  const waitForConfiguredPort = (timeoutMs) => portWasListening
    ? waitForPortRelease(port, timeoutMs)
    : Promise.resolve(true);
  const connection = activeTerminalConnections.get(serverId);
  const nativeState = nativeTerminals.get(serverId);
  // Capture WSL process roots before killing the tmux session. A service can
  // outlive its tmux pane, especially on WSL1 where Windows cannot taskkill
  // the Linux PID reported by netstat.
  // Capture service identities before sending the stop command.  Shutdown
  // excludes the tmux pane shell itself so the persistent session survives;
  // deletion includes it because the session is about to be removed.
  const shouldInspectWslProcesses = server.shell === 'wsl'
    && forceKill
    && (!preserveSession || Boolean(port) || Boolean(String(server.stopCommand || '').trim()));
  const wslStopContext = shouldInspectWslProcesses
    ? await matchingWslProcessIds(server, { includePanePids: !preserveSession })
    : null;
  if (wslStopContext?.processes?.length) await sendScreenStopCommand(server, wslStopContext.processes);
  let sessionExisted = false;
  if (nativeState && isNativeShell(server)) {
    try {
      nativeState.terminal.child.write(server.stopCommand ? `${server.stopCommand}\r` : '\u0003');
      if (portWasListening) await waitForConfiguredPort(750);
      else await delay(150);
    } catch (error) {
      console.error(`[${operation}] native shell stop failed for ${serverId}: ${error.message}`);
    }
  }
  if (isNativeShell(server)) {
    // A native PTY is the shell itself, so there is no persistent session to
    // retain.  The configured stop command/Ctrl+C above gets a chance to run
    // before the PTY is closed.
    terminateNativeTerminal(serverId);
  } else if (server.shell === 'wsl') {
    sessionExisted = await tmuxSessionExists(session);
    try {
      if (sessionExisted) {
        if (server.stopCommand) await runGuest('tmux', ['send-keys', '-t', session, server.stopCommand, 'Enter'], { timeout: 8000 });
        else await runGuest('tmux', ['send-keys', '-t', session, 'C-c'], { timeout: 8000 });
      } else {
        // Non-tmux WSL terminals still need a graceful input before their PTY
        // is disposed.  This path is also used when tmux is unavailable.
        const state = wslTerminals.get(serverId);
        if (state?.terminal?.child) state.terminal.child.write(server.stopCommand ? `${server.stopCommand}\r` : '\u0003');
      }
      if (portWasListening) await waitForConfiguredPort(1500);
      else await delay(150);
    } catch (error) {
      console.error(`[${operation}] graceful stop failed for ${serverId}: ${error.message}`);
    }
    // Closing the client detaches its PTY but deliberately leaves the service
    // session alive.  Deleting a terminal removes the session permanently.
    if (!preserveSession && sessionExisted && await tmuxSessionExists(session)) {
      await runGuest('tmux', ['kill-session', '-t', session], { timeout: 8000 });
    }
    if (wslTerminals.has(serverId)) terminateWslTerminal(serverId);
  } else if (connection) {
    connection.dispose(true);
  }

  // Deleting a terminal keeps its historical strong cleanup even when no port
  // was configured.  Client shutdown is narrower: only a still-occupied,
  // explicitly configured port justifies process-tree signalling, which avoids
  // touching unrelated background WSL processes.
  const shouldCleanupWslProcesses = server.shell === 'wsl'
    && forceKill
    && (!preserveSession || (port && await isPortListening(port)));
  if (shouldCleanupWslProcesses) {
    if (wslStopContext?.ids?.length) await signalGuestProcessIds(server, wslStopContext.ids, 'TERM');
    if (portWasListening) await waitForConfiguredPort(750);
    // Re-scan after the graceful stop so children spawned by a wrapper are
    // included before the force-kill pass.  The matcher is constrained by the
    // configured service identity and working directory.
    await signalMatchingWslProcesses(server, 'TERM', { includePanePids: !preserveSession });
    if (port) {
      await waitForConfiguredPort(1000);
      if (await isPortListening(port)) await signalMatchingWslProcesses(server, 'KILL', { includePanePids: !preserveSession });
    } else if (!preserveSession) {
      await delay(250);
      await signalMatchingWslProcesses(server, 'KILL', { includePanePids: false });
    }
  }

  // Port-wide taskkill is intentionally limited to terminal deletion.  During
  // client shutdown an occupied Windows port may belong to another process;
  // the WSL branch above already uses the configured service identity for its
  // narrower fallback.
  if (forceKill && !preserveSession && portWasListening) {
    // A service can outlive its wrapper. Always continue to the force-kill
    // pass when the configured port is still occupied.
    await signalPortListeners(port, 'TERM', server);
    await waitForConfiguredPort(1000);
    if (await isPortListening(port)) {
      await signalPortListeners(port, 'KILL', server);
      await waitForConfiguredPort(500);
    }
  }
  if (port && await isPortListening(port)) {
    const remaining = await portListeners(port);
    const owners = remaining.map((listener) => `${listener.source}:${listener.pid}`).join(', ');
    throw new Error(`端口 ${port} 仍被进程占用${owners ? `（${owners}）` : ''}。`);
  }

  return {
    ok: true,
    serverId,
    serverName: server.name,
    session,
    sessionRemoved: !preserveSession && sessionExisted,
    sessionPreserved: preserveSession && sessionExisted,
    port: configured,
    portWasListening,
    portReleased: configured ? (port ? true : null) : null,
  };
}

async function stopAllConfiguredServers() {
  // Prevent a due schedule from starting a service again while shutdown is in
  // progress. Each configured terminal is independent, so stop them in parallel.
  stopScheduler();
  const results = await Promise.all(allServers().map(async (server) => {
    try {
      return await stopServerRuntime(server, {
        preserveSession: true,
        forceKill: true,
        operation: 'shutdown',
      });
    } catch (error) {
      return { ok: false, serverId: server.id, serverName: server.name, error: error.message };
    }
  }));
  return { ok: results.every((result) => result.ok), results };
}

async function stopAndRemoveServer(serverId) {
  const server = findServer(serverId);
  if (!server) throw new Error(`unknown server: ${serverId}`);
  const stopped = await stopServerRuntime(server);

  const nextGroups = config.groups.map((group) => ({
    ...group,
    servers: group.servers.filter((item) => item.id !== serverId),
  }));
  const nextSchedules = config.schedules.map((schedule) => {
    if (!Array.isArray(schedule.serverIds) || !schedule.serverIds.includes(serverId)) return schedule;
    const serverIds = schedule.serverIds.filter((id) => id !== serverId);
    return { ...schedule, serverIds, enabled: serverIds.length ? schedule.enabled : false, lastError: serverIds.length ? schedule.lastError : `target terminal deleted: ${serverId}` };
  });
  const nextTerminalWorkspaces = config.terminalWorkspaces.map((workspace) => ({
    ...workspace,
    serverIds: workspace.serverIds.filter((id) => id !== serverId),
  }));
  const saved = saveConfig({ ...config, groups: nextGroups, schedules: nextSchedules, terminalWorkspaces: nextTerminalWorkspaces });
  return {
    ...stopped,
    config: saved,
    health: healthPayload(),
  };
}

function spawnTerminal(serverId, options = {}) {
  const server = findServer(serverId) || normalizeServer({ id: serverId, name: serverId }, serverId);
  const session = server.session || `nexus-${safeId(serverId)}`;
  const useTmux = server.shell === 'wsl' && server.tmux !== false && hasTmux();
  // One Nexus terminal owns the tmux client for a service. Detaching stale
  // clients and enabling aggressive resize prevents tmux 2.x from filling a
  // wider client with dot cells outside the narrower session window.
  const pipeCommand = `cat >> ${shellQuote(guestFilePath(logPath(server.id)))}`;
  const command = useTmux
    ? `tmux has-session -t ${session} 2>/dev/null || tmux new-session -d -s ${session} -c ${shellQuote(guestCwd(server))}; tmux set-option -t ${session} history-limit ${TMUX_HISTORY_LIMIT}; tmux set-option -t ${session} display-time ${TMUX_INITIAL_DISPLAY_TIME}; tmux set-option -t ${session} status ${TMUX_STATUS}; tmux set-window-option -t ${session} alternate-screen ${TMUX_ALTERNATE_SCREEN}; tmux set-window-option -t ${session} aggressive-resize on; tmux pipe-pane -o -t ${session} ${shellQuote(pipeCommand)}; exec tmux attach-session -d -t ${session}`
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
  const cols = Math.max(20, Number(options.cols) || 120);
  const rows = Math.max(5, Number(options.rows) || 32);
  const child = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: ptyCwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });
  return { child, server, session, cwd: server.cwd || (server.shell === 'wsl' ? guestCwd(server) : ''), useTmux, shell: server.shell, cols, rows };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function waitForPortRelease(port, timeoutMs = 1800, intervalMs = 120) {
  if (!port) return true;
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  do {
    if (!(await isPortListening(port))) return true;
    if (Date.now() >= deadline) return false;
    await delay(intervalMs);
  } while (Date.now() < deadline);
  return !(await isPortListening(port));
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
    runtimeVersion: BACKEND_RUNTIME_VERSION,
    port: PORT,
    distro: WSL_CONFIG.distro,
    distroSource: WSL_CONFIG.source,
    configPath: CONFIG_PATH,
    configStamp: configFileStamp,
    configRevision,
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
    if (request.method === 'POST' && url.pathname === '/api/servers/stop-all') {
      const result = await stopAllConfiguredServers();
      return json(response, result.ok ? 200 : 207, result);
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
      const body = await parseBody(request);
      const services = body.stopServices === true ? await stopAllConfiguredServers() : null;
      json(response, services?.ok === false ? 207 : 200, { ok: services ? services.ok : true, services });
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
  const requestUrl = new URL(request.url, `http://${request.headers.host || HOST}`);
  const match = requestUrl.pathname.match(/^\/terminal\/([^/]+)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const requestedCols = Number(requestUrl.searchParams.get('cols'));
  const requestedRows = Number(requestUrl.searchParams.get('rows'));
  const requestedSize = {
    cols: Number.isFinite(requestedCols) && requestedCols > 0 ? Math.max(20, requestedCols) : undefined,
    rows: Number.isFinite(requestedRows) && requestedRows > 0 ? Math.max(5, requestedRows) : undefined,
  };
  wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit('connection', webSocket, decodeURIComponent(match[1]), requestedSize));
});

wss.on('connection', (webSocket, serverId, requestedSize = {}) => {
  const configuredServer = findServer(serverId) || normalizeServer({ id: serverId, name: serverId }, serverId);
  const previous = activeTerminalConnections.get(serverId);
  if (previous) previous.dispose(true);

  if (isNativeShell(configuredServer)) {
    let state;
    try {
      state = ensureNativeTerminal(configuredServer, requestedSize);
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
    writeToOpenSocket(webSocket, { type: 'status', value: 'connected', serverId, cwd: state.terminal.cwd, session: '', tmux: false, shell: configuredServer.shell, cols: state.cols, rows: state.rows });
    webSocket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'input') state.terminal.child.write(String(message.data || ''));
        if (message.type === 'resize') {
          state.cols = Math.max(20, Number(message.cols) || 120);
          state.rows = Math.max(5, Number(message.rows) || 32);
          state.terminal.child.resize(state.cols, state.rows);
        }
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
    const existingState = wslTerminals.get(serverId);
    const creatingTerminal = !existingState || existingState.disposed;
    try {
      state = ensureWslTerminal(configuredServer, requestedSize);
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
      if (state.terminal.useTmux && state.initialResetDone) void refreshTmuxSnapshotCache(state);
    };
    const freshAttachment = state.terminal.useTmux && creatingTerminal;
    const reboundAttachment = state.terminal.useTmux && !creatingTerminal;
    const requestedCols = Math.max(20, Number(requestedSize.cols) || state.cols || 120);
    const requestedRows = Math.max(5, Number(requestedSize.rows) || state.rows || 32);
    const dimensionsChanged = requestedCols !== state.cols || requestedRows !== state.rows;
    state.webSocket = webSocket;
    activeTerminalConnections.set(serverId, { webSocket, terminal: state.terminal, dispose: detach });
    if (dimensionsChanged) {
      state.cols = requestedCols;
      state.rows = requestedRows;
    }
    if (freshAttachment && !state.initialResetDone) {
      state.initialResetSocket = null;
      state.initialResetReason = 'fresh-attachment';
      beginInitialTmuxAttachment(state, webSocket);
    } else if (reboundAttachment) {
      // The common case restores a capture made when this renderer detached.
      // If the layout changed while the tab was inactive, resize first and
      // capture the newly laid-out pane instead of waiting for a PTY repaint.
      beginTmuxRendererRebind(state, webSocket, dimensionsChanged);
    }
    if (!state.terminal.useTmux && dimensionsChanged) {
      state.terminal.child.resize(state.cols, state.rows);
    }
    writeToOpenSocket(webSocket, { type: 'status', value: 'connected', serverId, cwd: state.terminal.cwd, session: state.terminal.session, tmux: state.terminal.useTmux, shell: state.terminal.shell, fresh: freshAttachment, rebound: reboundAttachment, syncing: state.terminal.useTmux && !state.initialResetDone, cols: state.cols, rows: state.rows });
    webSocket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'input') {
          const data = String(message.data || '');
          writeWslInput(state, data);
        }
        if (message.type === 'resize') {
          const cols = Math.max(20, Number(message.cols) || 120);
          const rows = Math.max(5, Number(message.rows) || 32);
          if (cols !== state.cols || rows !== state.rows) {
            state.cols = cols;
            state.rows = rows;
            state.terminal.child.resize(state.cols, state.rows);
          }
        }
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
