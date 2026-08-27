import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  ClipboardPaste,
  Clock3,
  Command,
  Copy,
  Cpu,
  Download,
  FileText,
  FolderOpen,
  Gauge,
  GitBranch,
  HardDrive,
  History,
  LayoutDashboard,
  Layers3,
  ListChecks,
  Maximize2,
  Menu,
  MessageSquare,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings2,
  SlidersHorizontal,
  Square,
  Sun,
  Terminal,
  Timer,
  Upload,
  Wifi,
  WifiOff,
  X,
  Trash2,
} from 'lucide-react';

const initialGroups = [
  {
    id: 'survival',
    name: '生存服群',
    note: '主世界与联机服务',
    accent: 'mint',
    servers: [
      {
        id: 'survival-main',
        name: 'Survival · Main',
        label: '主世界',
        port: '25565',
        status: 'running',
        uptime: '03:42:18',
        players: '8 / 20',
        cpu: '14%',
        memory: '5.2 GB',
        dir: '/srv/minecraft/survival-main',
      },
      {
        id: 'survival-nether',
        name: 'Survival · Nether',
        label: '下界副本',
        port: '25566',
        status: 'running',
        uptime: '03:41:54',
        players: '3 / 12',
        cpu: '9%',
        memory: '2.8 GB',
        dir: '/srv/minecraft/survival-nether',
      },
      {
        id: 'survival-map',
        name: 'World Map',
        label: '地图服务',
        port: '8123',
        status: 'stopped',
        uptime: '—',
        players: '—',
        cpu: '—',
        memory: '—',
        dir: '/srv/minecraft/world-map',
      },
    ],
  },
  {
    id: 'creative',
    name: '创造服群',
    note: '测试与建筑环境',
    accent: 'blue',
    servers: [
      {
        id: 'creative-main',
        name: 'Creative · Main',
        label: '建筑服',
        port: '25570',
        status: 'running',
        uptime: '01:18:06',
        players: '2 / 10',
        cpu: '6%',
        memory: '2.1 GB',
        dir: '/srv/minecraft/creative-main',
      },
      {
        id: 'creative-test',
        name: 'Snapshot Lab',
        label: '快照测试',
        port: '25571',
        status: 'starting',
        uptime: '00:00:22',
        players: '—',
        cpu: '18%',
        memory: '1.4 GB',
        dir: '/srv/minecraft/snapshot-lab',
      },
    ],
  },
  {
    id: 'tools',
    name: '工具服务',
    note: '反向代理与监控组件',
    accent: 'amber',
    servers: [
      {
        id: 'proxy',
        name: 'Velocity Proxy',
        label: '入口代理',
        port: '25560',
        status: 'running',
        uptime: '08:10:42',
        players: '10 / ∞',
        cpu: '3%',
        memory: '624 MB',
        dir: '/srv/minecraft/velocity',
      },
      {
        id: 'metrics',
        name: 'Metrics Dashboard',
        label: '监控面板',
        port: '3000',
        status: 'warning',
        uptime: '06:29:10',
        players: '—',
        cpu: '2%',
        memory: '412 MB',
        dir: '/srv/tools/metrics',
      },
    ],
  },
];

const commandLibrary = [
  { id: 'save', name: '安全保存', command: 'save-all', description: '立即保存世界数据', scope: '全部游戏服', tone: 'mint', runs: 46 },
  { id: 'list', name: '在线玩家', command: 'list', description: '查看当前在线玩家', scope: '全部游戏服', tone: 'blue', runs: 32 },
  { id: 'announce', name: '公告广播', command: 'say 服务器将在 10 分钟后维护', description: '向玩家发送维护通知', scope: '生存服群', tone: 'amber', runs: 12 },
  { id: 'reload', name: '重载配置', command: 'reload confirm', description: '重新载入服务配置', scope: '单个服务', tone: 'violet', runs: 8 },
  { id: 'whitelist', name: '白名单刷新', command: 'whitelist reload', description: '重新载入白名单文件', scope: '全部游戏服', tone: 'blue', runs: 19 },
];

const initialLines = {
  'survival-main': [
    '[14:32:01] [Server thread/INFO]: Preparing spawn area: 100%',
    '[14:32:02] [Server thread/INFO]: Done (4.821s)! For help, type "help"',
    '[14:32:08] [Server thread/INFO]: <Mira> 今天有人开荒吗？',
    '[14:32:12] [Server thread/INFO]: There are 8 of a max of 20 players online',
    '[14:32:17] [Server thread/INFO]: Saving the game (this may take a moment!)',
    '[14:32:18] [Server thread/INFO]: Saved the game',
  ],
  'survival-nether': [
    '[14:31:48] [Server thread/INFO]: Done (3.216s)! For help, type "help"',
    '[14:32:04] [Server thread/INFO]: <Argo> nether hub is almost ready',
    '[14:32:17] [Server thread/INFO]: Saving the game (this may take a moment!)',
  ],
  'creative-main': [
    '[14:30:15] [Server thread/INFO]: Done (2.907s)! For help, type "help"',
    '[14:31:03] [Server thread/INFO]: <Lumen> pasted a new blueprint',
    '[14:32:16] [Server thread/INFO]: Saving the game (this may take a moment!)',
  ],
  'creative-test': [
    '[14:32:00] [Server thread/INFO]: Loading snapshot 25w33a',
    '[14:32:11] [Server thread/INFO]: Starting minecraft server version 1.21.9',
  ],
  proxy: [
    '[14:31:54] [main/INFO]: Listening on /0.0.0.0:25560',
    '[14:32:05] [main/INFO]: [connected] Mira joined server survival-main',
  ],
  metrics: [
    '[14:29:42] INFO: metrics endpoint listening on :3000',
    '[14:30:08] WARN: scrape latency above 200ms (243ms)',
  ],
  'survival-map': ['[13:12:09] INFO: service is stopped'],
};

const navItems = [
  { id: 'orchestration', label: { zh: '服务编排', en: 'Orchestration' }, icon: GitBranch },
  { id: 'overview', label: { zh: '总览', en: 'Overview' }, icon: LayoutDashboard },
  { id: 'fleet', label: { zh: '服务管理', en: 'Services' }, icon: Layers3 },
  { id: 'terminal', label: { zh: '终端', en: 'Terminal' }, icon: Terminal },
  { id: 'logs', label: { zh: '日志检索', en: 'Logs' }, icon: FileText },
  { id: 'commands', label: { zh: '指令库', en: 'Commands' }, icon: Command },
];

const languageOptions = [
  { id: 'zh-CN', label: '中文', nativeLabel: '中文' },
  { id: 'en-US', label: 'English', nativeLabel: 'English' },
];

function navigationLabel(item, language) {
  if (!item) return '';
  return typeof item.label === 'string' ? item.label : item.label?.[language === 'zh-CN' ? 'zh' : 'en'] || item.id;
}

const statusMeta = {
  running: { label: '运行中', className: 'status-running', dot: '●' },
  stopped: { label: '已停止', className: 'status-stopped', dot: '○' },
  starting: { label: '启动中', className: 'status-starting', dot: '◌' },
  warning: { label: '有告警', className: 'status-warning', dot: '●' },
};

function flattenGroups(groups) {
  return groups.flatMap((group) => group.servers.map((server) => ({ ...server, groupId: group.id, groupName: group.name, accent: group.accent })));
}

function normalizeShellType(shell) {
  return ['wsl', 'powershell', 'pwsh', 'cmd'].includes(shell) ? shell : 'wsl';
}

function shellLabel(shell, language = 'zh-CN') {
  const labels = {
    wsl: language === 'zh-CN' ? 'WSL Ubuntu' : 'WSL Ubuntu',
    powershell: 'Windows PowerShell',
    pwsh: 'PowerShell 7',
    cmd: language === 'zh-CN' ? '命令提示符' : 'Command Prompt',
  };
  return labels[normalizeShellType(shell)];
}

function defaultShellDirectory(shell) {
  return normalizeShellType(shell) === 'wsl' ? '/root' : '';
}

function formatTime() {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
}

function splitIntervalMilliseconds(value) {
  const totalMs = Math.max(0, Number(value) || 0);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Number(((totalMs % 60000) / 1000).toFixed(3));
  return { hours, minutes, seconds };
}

function joinIntervalMilliseconds({ hours = 0, minutes = 0, seconds = 0 }) {
  return Math.round((Math.max(0, Number(hours) || 0) * 3600
    + Math.max(0, Number(minutes) || 0) * 60
    + Math.max(0, Number(seconds) || 0)) * 1000);
}

function formatIntervalMilliseconds(value, language = 'zh-CN') {
  const { hours, minutes, seconds } = splitIntervalMilliseconds(value);
  const isZh = language === 'zh-CN';
  const parts = [];
  if (hours) parts.push(`${hours}${isZh ? ' 时' : 'h'}`);
  if (minutes) parts.push(`${minutes}${isZh ? ' 分' : 'm'}`);
  if (seconds || !parts.length) parts.push(`${seconds}${isZh ? ' 秒' : 's'}`);
  return parts.join(isZh ? ' ' : ' ');
}

function formatScheduleDateTime(value, language = 'zh-CN') {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return String(value || '');
  return new Intl.DateTimeFormat(language, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

function loadLocalState(key, fallback) {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function makeId(value, prefix) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${prefix}-${normalized || Date.now()}`;
}

const commandLibraryFormat = 'nexus-command-library';
const commandTones = new Set(['mint', 'blue', 'amber', 'violet']);

function shareableCommand(command) {
  return {
    name: String(command?.name || '').slice(0, 160),
    command: String(command?.command || '').slice(0, 20000),
    description: String(command?.description || '').slice(0, 2000),
    executionMode: command?.executionMode === 'paste' ? 'paste' : 'execute',
    scope: String(command?.scope || 'Current selection').slice(0, 200),
    tone: commandTones.has(command?.tone) ? command.tone : 'mint',
  };
}

function normalizeImportedCommand(value) {
  if (!value || typeof value !== 'object') return null;
  const executionMode = value.executionMode === 'paste' ? 'paste' : 'execute';
  const rawCommand = String(value.command || '').slice(0, 20000);
  const command = executionMode === 'paste' ? rawCommand.replace(/^\s+/, '') : rawCommand.trim();
  if (!command.trim()) return null;
  const name = String(value.name || command.slice(0, 60)).trim().slice(0, 160);
  if (!name) return null;
  return {
    name,
    command,
    description: String(value.description ?? '').trim().slice(0, 2000),
    executionMode,
    scope: String(value.scope || '当前选择').trim().slice(0, 200),
    tone: commandTones.has(value.tone) ? value.tone : 'mint',
    runs: 0,
  };
}

function commandFingerprint(command) {
  const item = shareableCommand(command);
  return JSON.stringify([item.name, item.command, item.description, item.executionMode, item.scope, item.tone]);
}

function browserExportCommandLibrary(commands) {
  const payload = { format: commandLibraryFormat, version: 1, exportedAt: new Date().toISOString(), commands: commands.map(shareableCommand) };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `nexus-command-library-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return { canceled: false, count: payload.commands.length };
}

function browserImportCommandLibrary() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('cancel', () => resolve({ canceled: true }), { once: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve({ canceled: true });
      if (file.size > 5 * 1024 * 1024) return reject(new Error('command library file is larger than 5 MB'));
      try {
        const parsed = JSON.parse(await file.text());
        const commands = Array.isArray(parsed) ? parsed : parsed?.commands;
        if (!Array.isArray(commands)) throw new Error('invalid command library: commands must be an array');
        resolve({ canceled: false, path: file.name, commands: commands.slice(0, 5000) });
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    input.click();
  });
}

const BACKEND_BASE = window.desktop?.backendUrl || 'http://127.0.0.1:4317';

async function backendRequest(endpoint, options = {}) {
  if (window.desktop?.backendRequest) {
    return window.desktop.backendRequest({ path: endpoint, method: options.method || 'GET', body: options.body, timeout: options.timeout });
  }
  const response = await fetch(`${BACKEND_BASE}${endpoint}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  // 207 is used for batch operations that completed partially; callers can
  // inspect the per-service results instead of losing them as an exception.
  if (!response.ok && response.status !== 207) throw new Error(payload.error || `Backend request failed (${response.status})`);
  return payload;
}

function hydrateGroups(rawGroups) {
  return (Array.isArray(rawGroups) ? rawGroups : []).map((group) => ({
    ...group,
    servers: (Array.isArray(group.servers) ? group.servers : []).map((server) => {
      const shell = normalizeShellType(server.shell);
      return {
        ...server,
        shell,
        dir: server.dir || server.cwd || defaultShellDirectory(shell),
        status: server.status || 'stopped',
        uptime: server.uptime || '—',
        players: server.players || '—',
        cpu: server.cpu || '—',
        memory: server.memory || '—',
      };
    }),
  }));
}

function socketUrlFor(serverId) {
  const base = new URL(BACKEND_BASE);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = `/terminal/${encodeURIComponent(serverId)}`;
  base.search = '';
  return base.toString();
}

function terminalPalette(theme) {
  if (theme === 'light') {
    return {
      background: '#fbfcfd',
      foreground: '#172a32',
      cursor: '#1674d1',
      selectionBackground: '#b9dcff',
      scrollbarSliderBackground: '#819198aa',
      scrollbarSliderHoverBackground: '#60737bcc',
      scrollbarSliderActiveBackground: '#344950dd',
      black: '#344a53',
      red: '#ad2636',
      // Keep mounted-drive directory backgrounds light while preserving a
      // dark, readable foreground after xterm's contrast adjustment.
      green: '#c7efdc',
      yellow: '#81560a',
      blue: '#07549c',
      magenta: '#7043a5',
      cyan: '#0b7184',
      white: '#5c7079',
      brightBlack: '#213943',
      brightRed: '#8e1728',
      brightGreen: '#075f4c',
      brightYellow: '#624005',
      brightBlue: '#084d9b',
      brightMagenta: '#542a83',
      brightCyan: '#075b6b',
      brightWhite: '#172a32',
    };
  }
  return {
    background: '#0b1218',
    foreground: '#e7f2f1',
    cursor: '#75d8bd',
    selectionBackground: '#2d5e55',
    scrollbarSliderBackground: '#81939d99',
    scrollbarSliderHoverBackground: '#a9bcc2cc',
    scrollbarSliderActiveBackground: '#d5e2e4dd',
    black: '#7f949b',
    red: '#ff9c9c',
    // WSL mounted drives commonly emit 34;42 (blue on green). Keep the
    // background subdued; xterm lifts the foreground to a readable value.
    green: '#195642',
    yellow: '#ffd37a',
    // Keep blue/cyan readable when Linux emits a colored background (for
    // example dircolors' 34;42 writable-directory style).
    blue: '#8fc3ff',
    magenta: '#d3b8ff',
    cyan: '#a4eef0',
    white: '#e7f2f1',
    brightBlack: '#9aadb2',
    brightRed: '#ffb3b3',
    brightGreen: '#9cf2d8',
    brightYellow: '#ffe39a',
    brightBlue: '#d2deff',
    brightMagenta: '#e4d1ff',
    brightCyan: '#d2fbfc',
    brightWhite: '#ffffff',
  };
}

function App() {
  const [groups, setGroupsState] = useState(() => loadLocalState('nexus.groups.v2', []));
  const [commands, setCommandsState] = useState(() => loadLocalState('nexus.commands', commandLibrary));
  const [language, setLanguage] = useState(() => loadLocalState('nexus.language', 'zh-CN'));
  const [theme, setTheme] = useState(() => loadLocalState('nexus.theme', 'dark'));
  const [activeNav, setActiveNav] = useState('terminal');
  const [activeServerId, setActiveServerId] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [linesByServer, setLinesByServer] = useState(initialLines);
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalQuery, setTerminalQuery] = useState('');
  const [logQuery, setLogQuery] = useState('');
  const [commandQuery, setCommandQuery] = useState('');
  const [terminalPaste, setTerminalPaste] = useState(null);
  const [toast, setToast] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [wsl, setWsl] = useState({ available: false, backend: false, distro: 'WSL' });
  const [terminalProfiles, setTerminalProfiles] = useState({ powershell: null, pwsh: null, cmd: null });
  const [modal, setModal] = useState(null);
  const [workflows, setWorkflowsState] = useState(() => loadLocalState('nexus.workflows', []));
  const [schedules, setSchedulesState] = useState(() => loadLocalState('nexus.schedules', []));
  const [backendReady, setBackendReady] = useState(false);
  const [backendHealth, setBackendHealth] = useState(null);
  const [serverBusy, setServerBusy] = useState(new Set());
  const [configReloading, setConfigReloading] = useState(false);
  const configStampRef = useRef(null);
  const configEditRevisionRef = useRef(0);
  const configDirtyRef = useRef(false);

  const updateLocalConfig = (setter, value) => {
    configEditRevisionRef.current += 1;
    configDirtyRef.current = true;
    setter(value);
  };
  const setGroups = (value) => updateLocalConfig(setGroupsState, value);
  const setCommands = (value) => updateLocalConfig(setCommandsState, value);
  const setWorkflows = (value) => updateLocalConfig(setWorkflowsState, value);
  const setSchedules = (value) => updateLocalConfig(setSchedulesState, value);

  const servers = useMemo(() => flattenGroups(groups), [groups]);
  const activeServer = servers.find((server) => server.id === activeServerId) || servers[0];
  const selectedServers = servers.filter((server) => selectedIds.has(server.id));
  const activeLines = linesByServer[activeServer?.id] || [];
  const filteredCommands = commands.filter((item) => `${item.name} ${item.command} ${item.description}`.toLowerCase().includes(commandQuery.toLowerCase()));

  useEffect(() => {
    if (!activeServer && servers[0]) setActiveServerId(servers[0].id);
    setSelectedIds((current) => new Set([...current].filter((id) => servers.some((server) => server.id === id))));
  }, [activeServer, servers]);

  useEffect(() => {
    window.localStorage.setItem('nexus.groups.v2', JSON.stringify(groups));
  }, [groups]);

  useEffect(() => {
    window.localStorage.setItem('nexus.commands', JSON.stringify(commands));
  }, [commands]);

  useEffect(() => {
    window.localStorage.setItem('nexus.language', language);
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    window.localStorage.setItem('nexus.theme', JSON.stringify(nextTheme));
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem('nexus.workflows', JSON.stringify(workflows));
    window.localStorage.setItem('nexus.schedules', JSON.stringify(schedules));
  }, [workflows, schedules]);

  useEffect(() => {
    let alive = true;
    if (window.desktop?.getWslStatus) {
      window.desktop.getWslStatus().then((result) => {
        if (alive && result) setWsl({ available: result.available === true, backend: result.backend !== false, distro: result.distro || 'Ubuntu' });
      }).catch(() => undefined);
    }
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    if (window.desktop?.getTerminalProfiles) {
      window.desktop.getTerminalProfiles().then((profiles) => {
        if (alive && profiles) setTerminalProfiles(profiles);
      }).catch(() => undefined);
    }
    return () => { alive = false; };
  }, []);

  const applyBackendConfig = (payload, force = false) => {
    if (!payload?.config) return;
    if (!force && configDirtyRef.current) return;
    if (force) {
      configEditRevisionRef.current += 1;
      configDirtyRef.current = false;
    }
    const stamp = payload.health?.configStamp;
    if (!force && stamp && stamp === configStampRef.current) return;
    if (stamp) configStampRef.current = stamp;
    const nextGroups = hydrateGroups(payload.config.groups);
    if (Array.isArray(payload.config.groups)) setGroupsState(nextGroups);
    if (Array.isArray(payload.config.commands)) setCommandsState(payload.config.commands.map((command) => ({ ...command, runs: command.runs || 0, tone: command.tone || 'mint' })));
    if (Array.isArray(payload.config.workflows)) setWorkflowsState(payload.config.workflows);
    if (Array.isArray(payload.config.schedules)) setSchedulesState(payload.config.schedules);
    setBackendHealth(payload.health || null);
    if (payload.health?.capabilities) {
      setTerminalProfiles((current) => ({
        powershell: payload.health.capabilities.powershell ?? current.powershell,
        pwsh: payload.health.capabilities.pwsh ?? current.pwsh,
        cmd: payload.health.capabilities.cmd ?? current.cmd,
      }));
    }
    setBackendReady(true);
    setWsl((current) => ({ ...current, available: payload.health?.capabilities?.wsl ?? current.available, backend: true, distro: payload.health?.distro || current.distro }));
  };

  const reloadBackendConfig = async (notify = true) => {
    if (configReloading) return;
    setConfigReloading(true);
    try {
      const payload = await backendRequest('/api/config/reload', { method: 'POST' });
      applyBackendConfig(payload, true);
      if (notify) showToast('已从 servers.json 重新加载配置');
    } catch (error) {
      if (notify) showToast(`配置重新加载失败: ${error.message}`, 'warning');
    } finally {
      setConfigReloading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const load = () => {
      const requestedAtRevision = configEditRevisionRef.current;
      return backendRequest('/api/config').then((payload) => {
        if (!alive) return;
        if (configDirtyRef.current) {
          setBackendReady(true);
          return;
        }
        if (requestedAtRevision === configEditRevisionRef.current) applyBackendConfig(payload);
      });
    };
    const guardedLoad = () => load().catch(() => {
      if (alive) setBackendReady(false);
    });
    guardedLoad();
    const timer = window.setInterval(guardedLoad, 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!backendReady) return undefined;
    const payload = { version: 1, groups, commands, workflows, schedules, settings: { logRetention: 'last-start' } };
    const savingRevision = configEditRevisionRef.current;
    const timer = window.setTimeout(() => backendRequest('/api/config', { method: 'PUT', body: payload }).then((response) => {
      if (savingRevision !== configEditRevisionRef.current) return;
      if (response.health?.configStamp) configStampRef.current = response.health.configStamp;
      configDirtyRef.current = false;
    }).catch(() => {
      if (savingRevision === configEditRevisionRef.current) setBackendReady(false);
    }), 250);
    return () => window.clearTimeout(timer);
  }, [backendReady, groups, commands, workflows, schedules]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timeout);
  }, [toast]);

  const showToast = (message, tone = 'success') => setToast({ message, tone });

  const openHelpDocument = async () => {
    try {
      if (!window.desktop?.openHelpDocument) throw new Error('请在 Electron 应用中打开帮助文档');
      const result = await window.desktop.openHelpDocument();
      if (!result?.ok) throw new Error(result?.error || '无法打开帮助文档');
    } catch (error) {
      showToast(`打开帮助文档失败: ${error.message}`, 'warning');
    }
  };

  const updateServer = (serverId, updater) => {
    setGroups((current) => current.map((group) => ({
      ...group,
      servers: group.servers.map((server) => server.id === serverId ? updater(server) : server),
    })));
  };

  const toggleServer = (serverId) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(serverId)) next.delete(serverId); else next.add(serverId);
      return next;
    });
  };

  const toggleGroup = (group) => {
    const groupIds = group.servers.map((server) => server.id);
    const allSelected = groupIds.every((id) => selectedIds.has(id));
    setSelectedIds((current) => {
      const next = new Set(current);
      groupIds.forEach((id) => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const toggleCollapsed = (groupId) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  const runAction = (action, targetIds = [...selectedIds]) => {
    if (action === 'start' || action === 'restart') {
      showToast('启动流程请在服务编排中配置并执行', 'warning');
      return;
    }
    if (!targetIds.length) {
      showToast('请先勾选至少一个服务', 'warning');
      return;
    }
    const actionLabel = { start: '启动', stop: '停止', restart: '重启' }[action];
    targetIds.forEach((serverId) => {
      if (action === 'start' || action === 'restart') updateServer(serverId, (server) => ({ ...server, status: 'starting' }));
      if (action === 'stop') updateServer(serverId, (server) => ({ ...server, status: 'stopped', uptime: '—', players: '—' }));
    });
    showToast(`已下发${actionLabel}任务 · ${targetIds.length} 个服务`);
    if (action === 'start' || action === 'restart') {
      window.setTimeout(() => targetIds.forEach((serverId) => updateServer(serverId, (server) => ({ ...server, status: 'running', uptime: server.uptime === '—' ? '00:00:01' : server.uptime })) ), 1200);
    }
  };

  const appendLine = (serverId, line) => {
    setLinesByServer((current) => ({ ...current, [serverId]: [...(current[serverId] || []), line] }));
  };

  const recordCommandRun = (rawCommand) => {
    const command = String(rawCommand || '').trim();
    if (!command) return;
    setCommands((current) => current.map((item) => item.command === command ? { ...item, runs: (Number(item.runs) || 0) + 1 } : item));
  };

  const sendCommand = (serverId, rawCommand, recordRun = true) => {
    const command = rawCommand.trim();
    if (!command) return;
    if (backendReady) {
      backendRequest('/api/commands/dispatch', { method: 'POST', body: { serverIds: [serverId], command }, timeout: 10000 }).then((response) => {
        if (!response.ok) throw new Error('command dispatch failed');
        if (recordRun) recordCommandRun(command);
      }).catch((error) => showToast(`Command dispatch failed: ${error.message}`, 'warning'));
      setTerminalInput('');
      return;
    }
    appendLine(serverId, `[${formatTime()}] [panel/INFO]: > ${command}`);
    if (command === 'list') appendLine(serverId, '[panel/INFO]: There are 8 of a max of 20 players online');
    if (command === 'save-all') appendLine(serverId, '[panel/INFO]: Saved the game');
    if (command.startsWith('say ')) appendLine(serverId, `[Server thread/INFO]: [公告] ${command.slice(4)}`);
    if (recordRun) recordCommandRun(command);
    setTerminalInput('');
  };

  const sendToSelected = (command) => {
    if (!selectedServers.length) {
      showToast('请先勾选目标服务', 'warning');
      return;
    }
    selectedServers.forEach((server) => sendCommand(server.id, command, false));
    recordCommandRun(command);
    showToast(`命令已发送到 ${selectedServers.length} 个服务`);
  };

  const markBusy = (targetIds, value) => setServerBusy((current) => {
    const next = new Set(current);
    targetIds.forEach((id) => value ? next.add(id) : next.delete(id));
    return next;
  });

  const runActionRemote = async (action, targetIds = [...selectedIds]) => {
    if (action === 'start' || action === 'restart') {
      showToast('启动流程请在服务编排中配置并执行', 'warning');
      return;
    }
    if (backendReady) {
      if (!targetIds.length) { showToast('No target services selected', 'warning'); return; }
      markBusy(targetIds, true);
      targetIds.forEach((serverId) => updateServer(serverId, (server) => ({ ...server, status: action === 'stop' ? 'stopped' : 'starting' })));
      try {
        const response = await backendRequest(`/api/servers/${encodeURIComponent(targetIds[0])}/action`, { method: 'POST', body: { action, serverIds: targetIds }, timeout: 130000 });
        response.results?.forEach((result) => updateServer(result.serverId, (server) => ({ ...server, status: result.ok ? (result.status || 'running') : 'warning' })));
        showToast(response.ok ? `Action ${action} sent to ${targetIds.length} services` : '部分服务操作失败，请查看日志', response.ok ? 'success' : 'warning');
      } catch (error) {
        targetIds.forEach((serverId) => updateServer(serverId, (server) => ({ ...server, status: 'warning' })));
        showToast(`后端操作失败: ${error.message}`, 'warning');
      } finally {
        markBusy(targetIds, false);
      }
      return;
    }
    runAction(action, targetIds);
  };

  /*
  const sendToSelectedRemoteLegacy = async (command) => {
    if (!selectedServers.length) {
      showToast('请先勾选目标服务', 'warning');
      return;
    }
    if (!backendReady) {
      sendToSelected(command);
      return;
    }
    try {
      const response = await backendRequest('/api/commands/dispatch', { method: 'POST', body: { serverIds: selectedServers.map((server) => server.id), command }, timeout: 10000 });
      if (!response.ok) throw new Error(response.results?.filter((result) => !result.ok).map((result) => result.error).join('; ') || 'dispatch failed');
      showToast(`命令已发送到 ${selectedServers.length} 个服务`);
    } catch (error) {
      showToast(`鍛戒护鍙戦€佸け璐? ${error.message}`, 'warning');
    }
  };

  */
  /*
  const sendToSelectedRemoteBroken = async (command) => {
    if (!selectedServers.length) {
      showToast('请先勾选目标服务', 'warning');
      return;
    }
    if (!backendReady) {
      sendToSelected(command);
      return;
    }
    try {
      const response = await backendRequest('/api/commands/dispatch', { method: 'POST', body: { serverIds: selectedServers.map((server) => server.id), command } });
      if (!response.ok) throw new Error(response.results?.filter((result) => !result.ok).map((result) => result.error).join('; ') || 'dispatch failed');
      showToast(`命令已发送到 ${selectedServers.length} 个服务`);
    } catch (error) {
      showToast(`命令发送失败: ${error.message}`, 'warning');
    }
  };

  */
  const sendToSelectedRemote = async (command) => {
    if (!selectedServers.length) {
      showToast('No target services selected', 'warning');
      return;
    }
    if (!backendReady) {
      sendToSelected(command);
      return;
    }
    try {
      const response = await backendRequest('/api/commands/dispatch', { method: 'POST', body: { serverIds: selectedServers.map((server) => server.id), command } });
      const results = Array.isArray(response.results) ? response.results : [];
      const succeeded = results.filter((result) => result.ok).length;
      const failed = results.filter((result) => !result.ok);
      if (!succeeded) throw new Error(failed.map((result) => result.error).filter(Boolean).join('; ') || 'dispatch failed');
      recordCommandRun(command);
      if (failed.length) showToast(`Command sent to ${succeeded}/${selectedServers.length} services; ${failed.length} failed`, 'warning');
      else showToast(`Command sent to ${succeeded} services`);
    } catch (error) {
      showToast(`Command dispatch failed: ${error.message}`, 'warning');
    }
  };

  const queueTerminalPaste = (serverId, command) => {
    const target = servers.find((server) => server.id === serverId);
    if (!target) {
      showToast(language === 'zh-CN' ? '请选择一个目标终端' : 'Select one target terminal', 'warning');
      return;
    }
    setActiveServerId(target.id);
    setActiveNav('terminal');
    setTerminalPaste({ id: `paste-${Date.now()}`, serverId: target.id, command: String(command || '') });
  };

  const pasteCommandFromLibrary = (item) => {
    if (selectedServers.length !== 1) {
      showToast(language === 'zh-CN' ? '粘贴指令时请只勾选一个终端' : 'Select exactly one terminal for paste commands', 'warning');
      return;
    }
    queueTerminalPaste(selectedServers[0].id, item.command);
  };

  const createGroup = ({ name, note, accent }) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const group = { id: makeId(trimmedName, 'group'), name: trimmedName, note: note.trim() || '自定义服务分组', accent, servers: [] };
    setGroups((current) => [...current, group]);
    setModal(null);
    showToast(`已创建分组 · ${trimmedName}`);
  };

  const createServer = ({ name, label, groupId, port, dir, shell = 'wsl' }) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const targetGroupId = groupId || 'local';
    const normalizedShell = normalizeShellType(shell);
    const terminalId = makeId(trimmedName, 'server');
    const workingDirectory = dir.trim() || defaultShellDirectory(normalizedShell);
    const server = {
      id: terminalId,
      name: trimmedName,
      label: label.trim() || shellLabel(normalizedShell, language),
      port: port.trim(),
      shell: normalizedShell,
      status: 'stopped',
      uptime: '—',
      players: '—',
      cpu: '—',
      memory: '—',
      dir: workingDirectory,
      cwd: workingDirectory,
      tmux: normalizedShell === 'wsl',
      session: `nexus-${terminalId}`,
      startCommand: '',
      stopCommand: '',
      ready: { type: 'delay', value: '0', timeoutMs: 30000 },
    };
    setGroups((current) => {
      const hasTarget = current.some((group) => group.id === targetGroupId);
      const groupsWithDefault = hasTarget ? current : [...current, { id: targetGroupId, name: 'Local services', note: 'Local terminals', accent: 'mint', servers: [] }];
      return groupsWithDefault.map((group) => group.id === targetGroupId ? { ...group, servers: [...group.servers, server] } : group);
    });
    setModal(null);
    showToast(`已添加终端 · ${trimmedName} · ${shellLabel(normalizedShell, language)}`);
  };

  const saveCommand = ({ name, command, description, scope, tone, executionMode = 'execute' }, existingCommand = null) => {
    const trimmedName = name.trim();
    const storedCommand = executionMode === 'paste' ? command.replace(/^\s+/, '') : command.trim();
    if (!trimmedName || !storedCommand.trim()) return;
    const nextCommand = {
      id: existingCommand?.id || makeId(trimmedName, 'command'),
      name: trimmedName,
      command: storedCommand,
      executionMode: executionMode === 'paste' ? 'paste' : 'execute',
      description: description.trim() || '自定义控制台指令',
      scope: scope.trim() || '当前选择',
      tone,
      runs: Number(existingCommand?.runs) || 0,
    };
    setCommands((current) => existingCommand
      ? current.map((item) => item.id === existingCommand.id ? nextCommand : item)
      : [nextCommand, ...current]);
    setModal(null);
    showToast(existingCommand ? `已更新指令 · ${trimmedName}` : `已保存指令 · ${trimmedName}`);
  };

  const createCommand = (form) => saveCommand(form);

  const copyCommand = async (command) => {
    try {
      await navigator.clipboard?.writeText(command);
      showToast('Command copied');
    } catch (error) {
      showToast(`Copy failed: ${error.message}`, 'warning');
    }
  };

  const exportCommandLibrary = async () => {
    try {
      const result = window.desktop?.exportCommandLibrary
        ? await window.desktop.exportCommandLibrary(commands)
        : browserExportCommandLibrary(commands);
      if (result?.canceled) return;
      showToast(language === 'zh-CN' ? `已导出 ${result?.count ?? commands.length} 条指令` : `Exported ${result?.count ?? commands.length} commands`);
    } catch (error) {
      showToast(`${language === 'zh-CN' ? '命令库导出失败' : 'Command library export failed'}: ${error.message}`, 'warning');
    }
  };

  const importCommandLibrary = async () => {
    try {
      const result = window.desktop?.importCommandLibrary
        ? await window.desktop.importCommandLibrary()
        : await browserImportCommandLibrary();
      if (result?.canceled) return;
      const values = Array.isArray(result?.commands) ? result.commands : [];
      const fingerprints = new Set(commands.map(commandFingerprint));
      const usedIds = new Set(commands.map((command) => command.id));
      const imported = [];
      let duplicates = 0;
      let invalid = 0;
      values.forEach((value) => {
        const command = normalizeImportedCommand(value);
        if (!command) { invalid += 1; return; }
        const fingerprint = commandFingerprint(command);
        if (fingerprints.has(fingerprint)) { duplicates += 1; return; }
        fingerprints.add(fingerprint);
        const baseId = makeId(command.name, 'command');
        let id = baseId;
        let suffix = 2;
        while (usedIds.has(id)) { id = `${baseId}-${suffix}`; suffix += 1; }
        usedIds.add(id);
        imported.push({ ...command, id });
      });
      if (imported.length) setCommands((current) => [...imported, ...current]);
      const skipped = duplicates + invalid;
      showToast(language === 'zh-CN'
        ? `已导入 ${imported.length} 条指令${skipped ? `，跳过 ${duplicates} 条重复、${invalid} 条无效项` : ''}`
        : `Imported ${imported.length} commands${skipped ? `; skipped ${duplicates} duplicates and ${invalid} invalid entries` : ''}`,
      imported.length ? 'success' : 'warning');
    } catch (error) {
      showToast(`${language === 'zh-CN' ? '命令库导入失败' : 'Command library import failed'}: ${error.message}`, 'warning');
    }
  };

  const deleteCommand = (commandId) => {
    const nextCommands = commands.filter((command) => command.id !== commandId);
    setCommands(nextCommands);
    if (backendReady) {
      backendRequest('/api/config', {
        method: 'PUT',
        body: { version: 1, groups, commands: nextCommands, workflows, schedules, settings: { logRetention: 'last-start' } },
      }).then((response) => {
        if (response.health?.configStamp) configStampRef.current = response.health.configStamp;
      }).catch((error) => showToast(`Command delete failed: ${error.message}`, 'warning'));
    }
    showToast(language === 'zh-CN' ? '指令已删除' : 'Command deleted');
  };

  const removeServerRemote = async (server) => {
    if (!server || serverBusy.has(server.id)) return;
    const portText = server.port ? `\n端口：${server.port}` : '';
    const sessionText = server.session ? `\ntmux 会话：${server.session}` : '';
    const confirmed = window.confirm(`删除终端“${server.name}”将先停止服务、关闭 tmux 会话并释放配置端口。\n不会删除 WSL 工作目录或服务文件。${portText}${sessionText}\n\n确定继续吗？`);
    if (!confirmed) return;
    setServerBusy((current) => new Set(current).add(server.id));
    try {
      const response = await backendRequest(`/api/servers/${encodeURIComponent(server.id)}`, { method: 'DELETE', timeout: 30000 });
      applyBackendConfig(response, true);

      // Re-read the persisted configuration so the list cannot be repopulated
      // by a concurrent config poll or a stale in-memory snapshot.
      const refreshed = await backendRequest('/api/config', { timeout: 10000 }).catch(() => response);
      applyBackendConfig(refreshed, true);
      setSelectedIds((current) => { const next = new Set(current); next.delete(server.id); return next; });
      if (activeServerId === server.id) {
        const nextServer = flattenGroups(refreshed.config?.groups || []).find((item) => item.id !== server.id);
        setActiveServerId(nextServer?.id || '');
      }
      showToast(`已停止并删除终端 · ${server.name}`);
    } catch (error) {
      showToast(`删除失败，终端配置已保留: ${error.message}`, 'warning');
    } finally {
      setServerBusy((current) => { const next = new Set(current); next.delete(server.id); return next; });
    }
  };

  const updateCommandMode = (commandId, executionMode) => {
    setCommands((current) => current.map((command) => command.id === commandId ? { ...command, executionMode: executionMode === 'paste' ? 'paste' : 'execute' } : command));
    showToast(language === 'zh-CN' ? '指令发送方式已更新' : 'Command send mode updated');
  };

  const statusCounts = servers.reduce((count, server) => {
    count[server.status] = (count[server.status] || 0) + 1;
    return count;
  }, {});

  const renderPage = () => {
    if (!activeServer && activeNav === 'terminal') return <div className="empty-state panel"><Server size={28} /><strong>暂无服务配置</strong><span>创建一个终端后，可选择 WSL 工作目录或使用 /root。</span><button className="button primary" onClick={() => setModal({ type: 'server' })}><Plus size={15} />新建终端</button></div>;
    if (activeNav === 'terminal') return <RealTerminalPage theme={theme} servers={servers} activeServer={activeServer} activeServerId={activeServerId} setActiveServerId={setActiveServerId} lines={activeLines} query={terminalQuery} setQuery={setTerminalQuery} onSend={sendCommand} commands={commands} onUseCommand={(item) => item.executionMode === 'paste' ? queueTerminalPaste(activeServer.id, item.command) : sendCommand(activeServer.id, item.command)} pendingPaste={terminalPaste?.serverId === activeServer.id ? terminalPaste : null} onPasteComplete={(requestId) => { setTerminalPaste((current) => current?.id === requestId ? null : current); showToast(language === 'zh-CN' ? '指令已粘贴到终端，请补充参数' : 'Command pasted; complete its parameters'); }} onAddService={() => setModal({ type: 'server' })} />;
    if (activeNav === 'logs') return <LogsPage servers={servers} linesByServer={linesByServer} query={logQuery} setQuery={setLogQuery} onOpen={(id) => { setActiveServerId(id); setActiveNav('terminal'); }} onOpenDirectory={() => { if (window.desktop?.openLogDirectory) window.desktop.openLogDirectory(); else showToast('请在 Electron 应用中打开日志目录', 'warning'); }} onOpenLogFile={(id) => { if (window.desktop?.openLogFile) window.desktop.openLogFile(id); else showToast('请在 Electron 应用中打开日志文件', 'warning'); }} backendReady={backendReady} />;
    if (activeNav === 'commands') return <CommandsPage language={language} commands={filteredCommands} query={commandQuery} setQuery={setCommandQuery} groups={groups} selectedIds={selectedIds} onToggleGroup={toggleGroup} onToggleServer={toggleServer} onClearSelection={() => setSelectedIds(new Set())} onRun={sendToSelectedRemote} onPaste={pasteCommandFromLibrary} onModeChange={updateCommandMode} onNew={() => setModal({ type: 'command' })} onImport={importCommandLibrary} onExport={exportCommandLibrary} onCopy={copyCommand} onEdit={(item) => setModal({ type: 'command', command: item })} onDelete={deleteCommand} />;
    if (activeNav === 'orchestration') return <OrchestrationPage language={language} workflows={workflows} schedules={schedules} servers={servers} commands={commands.filter((command) => command.executionMode !== 'paste')} backendReady={backendReady} onWorkflowsChange={setWorkflows} onSchedulesChange={setSchedules} onRun={(id) => backendRequest(`/api/workflows/${encodeURIComponent(id)}/run`, { method: 'POST' }).then((run) => { showToast(language === 'zh-CN' ? '编排已开始' : 'Workflow started'); return run; }).catch((error) => { showToast(`${language === 'zh-CN' ? '编排启动失败' : 'Workflow failed to start'}: ${error.message}`, 'warning'); throw error; })} />;
    if (activeNav === 'overview') return <OverviewPage groups={groups} servers={servers} statusCounts={statusCounts} wsl={wsl} backendHealth={backendHealth} onOpenServiceManagement={() => setActiveNav('fleet')} onSelectServer={(id) => { setActiveServerId(id); setActiveNav('terminal'); }} />;
    if (activeNav === 'fleet') return <ServiceManagementPage groups={groups} servers={servers} selectedIds={selectedIds} collapsedGroups={collapsedGroups} onToggleGroup={toggleGroup} onToggleServer={toggleServer} onCollapse={toggleCollapsed} onSelectServer={(id) => { setActiveServerId(id); setActiveNav('terminal'); }} onAction={runActionRemote} onRemove={removeServerRemote} selectedServers={selectedServers} statusCounts={statusCounts} onSend={sendToSelectedRemote} onClearSelection={() => setSelectedIds(new Set())} onAddGroup={() => setModal({ type: 'group' })} onAddService={() => setModal({ type: 'server' })} onOpenOrchestration={() => setActiveNav('orchestration')} />;
    if (activeNav === 'settings') return <SettingsPage language={language} theme={theme} backendReady={backendReady} backendHealth={backendHealth} wsl={wsl} onLanguageChange={setLanguage} onThemeChange={setTheme} onReloadConfig={() => reloadBackendConfig()} onRuntimeHealth={(health) => { if (!health) return; setBackendHealth(health); setWsl((current) => ({ ...current, available: health.capabilities?.wsl ?? current.available, backend: true, distro: health.distro || current.distro })); }} onNotify={showToast} />;
    return <OverviewPage groups={groups} servers={servers} statusCounts={statusCounts} wsl={wsl} backendHealth={backendHealth} onOpenServiceManagement={() => setActiveNav('fleet')} onSelectServer={(id) => { setActiveServerId(id); setActiveNav('terminal'); }} />;
  };

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span>NX</span></div>
          <div className="brand-copy"><strong>NEXUS</strong><span>LOCAL CONTROL</span></div>
        </div>

        <div className="workspace-select">
          <div className="workspace-avatar">W</div>
          <div className="workspace-text"><strong>Nexus · Local</strong><span>本机终端工作区</span></div>
          <ChevronDown size={14} />
        </div>

        <nav className="nav-section">
          <span className="nav-label">WORKSPACE</span>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${activeNav === id ? 'active' : ''}`} onClick={() => setActiveNav(id)} title={sidebarCollapsed ? navigationLabel({ id, label }, language) : undefined}>
              <Icon size={17} strokeWidth={1.8} />
              <span>{navigationLabel({ id, label }, language)}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-divider" />
        <nav className="nav-section">
          <span className="nav-label">QUICK ACCESS</span>
          {servers.slice(0, 3).map((server) => <button key={server.id} className="nav-item" onClick={() => { setActiveNav('terminal'); setActiveServerId(server.id); }}><Radio size={17} strokeWidth={1.8} /><span>{server.name}</span><span className={`mini-dot ${server.status === 'running' ? 'online' : ''}`} /></button>)}
        </nav>

        <div className="sidebar-bottom">
            <button className={`nav-item ${activeNav === 'settings' ? 'active' : ''}`} onClick={() => setActiveNav('settings')}><Settings2 size={17} strokeWidth={1.8} /><span>{language === 'zh-CN' ? '设置' : 'Settings'}</span></button>
          <button className="nav-item" onClick={openHelpDocument}><CircleHelp size={17} strokeWidth={1.8} /><span>帮助与文档</span></button>
          <div className="profile-chip"><div className="profile-avatar">A</div><div><strong>admin</strong><span>本地管理员</span></div><MoreHorizontal size={16} /></div>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setSidebarCollapsed((value) => !value)} title="收起侧栏"><Menu size={18} /></button>
            <button className="icon-button collapse-button" onClick={() => setSidebarCollapsed((value) => !value)} title="切换侧栏"><PanelLeft size={17} /></button>
            <div className="breadcrumbs"><span>{language === 'zh-CN' ? '工作区' : 'Workspace'}</span><ChevronRight size={14} /><strong>{navigationLabel(navItems.find((item) => item.id === activeNav), language) || (language === 'zh-CN' ? '设置' : 'Settings')}</strong></div>
          </div>
          <div className="topbar-right">
            <div className={`connection-pill ${wsl.backend ? '' : 'offline'}`}><span className="connection-dot" />{wsl.backend ? `本地后端 · 已连接${wsl.available ? ` · ${wsl.distro}` : ''}` : '本地后端离线'}</div>
            <button className="icon-button" onClick={() => reloadBackendConfig()} disabled={!backendReady || configReloading} title="从 servers.json 重新加载配置" aria-label="从 servers.json 重新加载配置"><RefreshCw size={16} className={configReloading ? 'spin' : ''} /></button>
            <div className="topbar-divider" />
            <button className="icon-button" title="打开帮助" onClick={openHelpDocument}><CircleHelp size={17} /></button>
            <button className="avatar-button" title="账户设置">A</button>
          </div>
        </header>
        <div className={`content-scroll ${activeNav === 'terminal' ? 'content-scroll-terminal' : ''}`}>{renderPage()}</div>
      </main>
      {toast && <div className={`toast toast-${toast.tone}`}><CheckCircle2 size={17} />{toast.message}<button onClick={() => setToast(null)}><X size={14} /></button></div>}
      {modal && <CreationModal key={`${modal.type}-${modal.command?.id || 'new'}`} language={language} type={modal.type} groups={groups} wsl={wsl} terminalProfiles={terminalProfiles} initialCommand={modal.command} onClose={() => setModal(null)} onCreate={modal.type === 'group' ? createGroup : modal.type === 'server' ? createServer : (form) => saveCommand(form, modal.command)} />}
    </div>
  );
}

function PageIntro({ eyebrow, title, description, actions }) {
  return <div className="page-intro"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="intro-actions">{actions}</div>}</div>;
}

function OverviewPage({ groups, servers, statusCounts, wsl, backendHealth, onOpenServiceManagement, onSelectServer }) {
  const running = statusCounts.running || 0;
  const issues = (statusCounts.warning || 0) + (statusCounts.starting || 0);
  const stopped = statusCounts.stopped || 0;
  const healthPercent = servers.length ? Math.round((running / servers.length) * 100) : 0;
  const tmuxReady = Boolean(backendHealth?.capabilities?.tmux);
  const nodeReady = Boolean(backendHealth?.capabilities?.node);

  return <>
    <PageIntro
      eyebrow="LOCAL OPERATIONS"
      title="总览"
      description="查看本地 WSL 工作区的服务健康状态与最近活动。"
      actions={<button className="button primary" onClick={onOpenServiceManagement}><Layers3 size={16} />进入服务管理</button>}
    />

    <div className="metric-grid">
      <MetricCard label="服务总数" value={servers.length} detail={`${running} 个运行中 · ${stopped} 个已停止`} icon={<Server size={18} />} tone="mint" />
      <MetricCard label="运行健康度" value={`${healthPercent}%`} detail={`${running} / ${servers.length || 0} 个服务在线`} icon={<Activity size={18} />} tone="blue" />
      <MetricCard label="需要关注" value={issues} detail={`${statusCounts.warning || 0} 个告警 · ${statusCounts.starting || 0} 个启动中`} icon={<AlertTriangle size={18} />} tone="amber" />
      <MetricCard label="WSL 后端" value={wsl?.available && wsl?.backend ? '已就绪' : '离线'} detail={`${wsl?.distro || 'WSL'} · ${tmuxReady ? 'tmux 可用' : 'tmux 缺失'}`} icon={wsl?.available && wsl?.backend ? <Wifi size={18} /> : <WifiOff size={18} />} tone="violet" />
    </div>

    <div className="overview-grid">
      <section className="overview-health panel">
        <div className="panel-heading"><div><h3>分组健康</h3><span>按服务分组查看当前状态</span></div><button className="text-button" onClick={onOpenServiceManagement}>管理 <ArrowUpRight size={14} /></button></div>
        <div className="overview-group-list">
          {groups.map((group) => {
            const groupRunning = group.servers.filter((server) => server.status === 'running').length;
            const groupIssues = group.servers.filter((server) => server.status === 'warning' || server.status === 'starting').length;
            const percentage = group.servers.length ? Math.round((groupRunning / group.servers.length) * 100) : 0;
            return <button className="overview-group-row" key={group.id} onClick={onOpenServiceManagement}>
              <span className={`group-accent accent-${group.accent}`} />
              <span className="overview-group-copy"><strong>{group.name}</strong><span>{group.note || '暂无描述'}</span></span>
              <span className="overview-progress"><span><i style={{ width: `${percentage}%` }} /></span><small>{groupRunning}/{group.servers.length}</small></span>
              <span className={`overview-health-state ${groupIssues ? 'attention' : groupRunning === group.servers.length && group.servers.length ? 'healthy' : 'idle'}`}>{groupIssues ? `${groupIssues} 个需关注` : groupRunning === group.servers.length && group.servers.length ? '健康' : '空闲'}</span>
              <ArrowUpRight size={14} />
            </button>;
          })}
          {!groups.length && <div className="overview-empty">请先在服务管理中创建分组。</div>}
        </div>
      </section>

      <section className="overview-runtime panel">
        <div className="panel-heading"><div><h3>运行环境</h3><span>由 WSL 后端在本地管理</span></div><Cpu size={18} className="panel-heading-icon" /></div>
        <div className="runtime-list">
          <div className="runtime-row"><span className={`runtime-state ${wsl?.available ? 'ok' : 'off'}`} /><div><strong>WSL 发行版</strong><small>{wsl?.distro || '未检测到'}</small></div><b>{wsl?.available ? '已连接' : '离线'}</b></div>
          <div className="runtime-row"><span className={`runtime-state ${wsl?.backend ? 'ok' : 'off'}`} /><div><strong>Nexus 后端</strong><small>HTTP 与 WebSocket 控制</small></div><b>{wsl?.backend ? '运行中' : '离线'}</b></div>
          <div className="runtime-row"><span className={`runtime-state ${tmuxReady ? 'ok' : 'off'}`} /><div><strong>tmux 会话</strong><small>持久化终端会话</small></div><b>{tmuxReady ? '可用' : '缺失'}</b></div>
          <div className="runtime-row"><span className={`runtime-state ${nodeReady ? 'ok' : 'off'}`} /><div><strong>Node 运行时</strong><small>WSL 后端依赖</small></div><b>{nodeReady ? '可用' : '缺失'}</b></div>
        </div>
      </section>
    </div>

    <div className="section-heading overview-services-heading"><div><h2>服务快照</h2><span>点击服务打开终端，启停等操作请前往服务管理。</span></div><button className="text-button" onClick={onOpenServiceManagement}>查看全部 <ArrowUpRight size={14} /></button></div>
    <div className="overview-service-list panel">
      {servers.slice(0, 8).map((server) => {
        const status = statusMeta[server.status] || statusMeta.stopped;
        return <button className="overview-service-row" key={server.id} onClick={() => onSelectServer(server.id)}><span className={`session-dot ${server.status}`} /><span className="overview-service-name"><strong>{server.name}</strong><small>{server.groupName} · {server.dir}</small></span><span className={`status-badge ${status.className}`}><span>{status.dot}</span>{status.label}</span><span className="overview-service-stat"><small>端口</small><strong>{server.port || '—'}</strong></span><ArrowUpRight size={14} /></button>;
      })}
      {!servers.length && <div className="overview-empty">还没有配置服务。</div>}
    </div>

    <div className="lower-grid"><RecentActivity servers={servers} /><section className="overview-note panel"><div className="panel-heading"><div><h3>页面职责</h3><span>监控与操作分开更容易快速定位。</span></div><CircleHelp size={18} className="panel-heading-icon" /></div><div className="overview-note-copy"><p><strong>总览</strong> 用于查看健康状态、运行环境和打开终端。</p><p><strong>服务管理</strong> 用于勾选分组、控制服务以及批量发送命令。</p><button className="button secondary" onClick={onOpenServiceManagement}><Layers3 size={15} />进入服务管理</button></div></section></div>
  </>;
}

function ServiceManagementPage({ groups, servers, selectedIds, collapsedGroups, onToggleGroup, onToggleServer, onCollapse, onSelectServer, onAction, onRemove, selectedServers, statusCounts, onSend, onClearSelection, onAddGroup, onAddService, onOpenOrchestration }) {
  const running = statusCounts.running || 0;
  const issues = (statusCounts.warning || 0) + (statusCounts.starting || 0);
  return <>
    <PageIntro
      eyebrow="SERVICE MANAGEMENT"
      title="服务管理"
      description="勾选分组或终端，执行停止或批量命令；启动流程请在服务编排中配置。"
      actions={<><button className="button secondary" onClick={onAddGroup}><Plus size={16} />新建分组</button><button className="button secondary" onClick={onAddService}><Plus size={16} />新建终端</button><button className="button primary" onClick={onOpenOrchestration}><GitBranch size={16} />服务编排</button></>}
    />

    <div className="metric-grid service-management-metrics">
      <MetricCard label="服务总数" value={servers.length} detail={`${groups.length} 个分组`} icon={<Server size={18} />} tone="mint" />
      <MetricCard label="已选择" value={selectedIds.size} detail="批量操作目标" icon={<ListChecks size={18} />} tone="blue" />
      <MetricCard label="运行中" value={running} detail={`${servers.length ? Math.round((running / servers.length) * 100) : 0}% 的服务`} icon={<Activity size={18} />} tone="violet" />
      <MetricCard label="需要关注" value={issues} detail={`${statusCounts.stopped || 0} 个停止 · ${statusCounts.starting || 0} 个启动中`} icon={<AlertTriangle size={18} />} tone="amber" />
    </div>

    <div className="selection-toolbar panel"><div><strong>已选择 {selectedIds.size} 个终端</strong><span>可按分组或单个终端进行选择；开服请使用服务编排。</span></div><div className="selection-actions"><button className="text-button" onClick={onClearSelection} disabled={!selectedIds.size}><Square size={14} />清空选择</button><button className="text-button" onClick={() => onAction('stop')} disabled={!selectedIds.size}><Square size={14} />停止已选</button></div></div>

    <div className="section-heading"><div><h2>服务分组</h2><span>这里的选择状态会与指令库共享。</span></div><div className="section-actions"><button className="text-button" onClick={onAddGroup}><Plus size={15} />新建分组</button><button className="text-button" onClick={onAddService}><Plus size={15} />新建终端</button></div></div>
    <div className="fleet-stack">{groups.map((group) => <GroupPanel key={group.id} group={group} selectedIds={selectedIds} collapsed={collapsedGroups.has(group.id)} onToggleGroup={() => onToggleGroup(group)} onToggleServer={onToggleServer} onCollapse={() => onCollapse(group.id)} onSelectServer={onSelectServer} onAction={onAction} onRemove={onRemove} />)}{!groups.length && <div className="empty-state panel"><Layers3 size={28} /><strong>还没有服务分组</strong><span>创建分组或添加终端开始使用。</span><div><button className="button secondary" onClick={onAddGroup}><Plus size={15} />新建分组</button><button className="button primary" onClick={onAddService}><Plus size={15} />新建终端</button></div></div>}</div>

    <div className="lower-grid"><QuickCommand onSend={onSend} selectedServers={selectedServers} /><section className="selection-help panel"><div className="panel-heading"><div><h3>批量操作流程</h3><span>本页所有操作都基于当前选择。</span></div><ListChecks size={18} className="panel-heading-icon" /></div><div className="selection-help-list"><div><Check size={15} /><span>选择分组即可选中其中的全部终端。</span></div><div><Terminal size={15} /><span>点击服务名称可以打开真实 PTY 终端。</span></div><div><Command size={15} /><span>指令库适合保存并重复广播常用命令。</span></div><div><GitBranch size={15} /><span>启动命令和执行顺序请在服务编排中配置。</span></div></div></section></div>
  </>;
}

function SettingsPage({ language, theme, backendReady, backendHealth, wsl, onLanguageChange, onThemeChange, onReloadConfig, onRuntimeHealth, onNotify }) {
  const isZh = language === 'zh-CN';
  const fixedPath = 'backend/servers.json';
  const [installingTmux, setInstallingTmux] = useState(false);
  const [tmuxInstallError, setTmuxInstallError] = useState('');
  const tmuxAvailable = backendHealth?.capabilities?.tmux === true;
  const installTmux = async () => {
    if (!window.desktop?.installTmux || installingTmux) return;
    setInstallingTmux(true);
    setTmuxInstallError('');
    try {
      const result = await window.desktop.installTmux(language);
      if (result?.canceled) return;
      if (!result?.ok) throw new Error(result?.error || (isZh ? '安装失败' : 'Installation failed'));
      onRuntimeHealth?.(result.health);
      onNotify?.(isZh ? `tmux 已安装到 ${result.distro}` : `tmux installed in ${result.distro}`);
    } catch (error) {
      setTmuxInstallError(error.message);
      onNotify?.(`${isZh ? 'tmux 安装失败' : 'tmux installation failed'}: ${error.message}`, 'warning');
    } finally {
      setInstallingTmux(false);
    }
  };

  return <>
    <PageIntro
      eyebrow="APPLICATION SETTINGS"
      title={isZh ? '设置' : 'Settings'}
      description={isZh ? '配置应用语言并查看本地后端运行状态。' : 'Configure the application language and inspect the local backend status.'}
      actions={<button className="button secondary" onClick={onReloadConfig} disabled={!backendReady}><RefreshCw size={16} />{isZh ? '重新加载配置' : 'Reload config'}</button>}
    />
    <div className="settings-layout">
      <section className="settings-section panel">
        <div className="panel-heading"><div><h3>{isZh ? '界面语言' : 'Interface language'}</h3><span>{isZh ? '选择应用显示语言，修改会立即生效。' : 'Choose the display language. Changes apply immediately.'}</span></div><MessageSquare size={18} className="panel-heading-icon" /></div>
        <div className="settings-fields">
          <div className="language-options" role="group" aria-label={isZh ? '界面语言' : 'Interface language'}>
            {languageOptions.map((option) => <button type="button" key={option.id} className={`language-option ${language === option.id ? 'selected' : ''}`} onClick={() => onLanguageChange(option.id)}><span className="language-radio">{language === option.id && <Check size={12} />}</span><span><strong>{option.label}</strong><small>{option.id === 'zh-CN' ? '简体中文' : 'English'}</small></span></button>)}
          </div>
        </div>
      </section>

      <section className="settings-section panel">
        <div className="panel-heading"><div><h3>{isZh ? '界面主题' : 'Interface theme'}</h3><span>{isZh ? '切换整个应用和终端画布的明暗外观。' : 'Switch the appearance of the app and terminal canvas.'}</span></div>{theme === 'light' ? <Sun size={18} className="panel-heading-icon" /> : <Moon size={18} className="panel-heading-icon" />}</div>
        <div className="settings-fields">
          <div className="theme-setting-row">
            <div className={`theme-mode-preview ${theme === 'light' ? 'light' : ''}`}>{theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}</div>
            <div className="theme-setting-copy"><strong>{theme === 'light' ? (isZh ? '浅色模式' : 'Light mode') : (isZh ? '深色模式' : 'Dark mode')}</strong><span>{isZh ? '主题设置仅保存在当前电脑。' : 'The theme preference is stored on this computer.'}</span></div>
            <button type="button" className={`theme-switch ${theme === 'light' ? 'on' : ''}`} role="switch" aria-checked={theme === 'light'} aria-label={isZh ? '开启浅色模式' : 'Enable light mode'} onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}><span /></button>
          </div>
        </div>
      </section>

      <section className="settings-section settings-wide panel">
        <div className="panel-heading"><div><h3>{isZh ? 'WSL 依赖' : 'WSL dependencies'}</h3><span>{isZh ? '仅在使用 Ubuntu 终端和持久会话时需要，不会自动安装。' : 'Only required for Ubuntu terminals and persistent sessions. Nothing is installed automatically.'}</span></div><Terminal size={18} className="panel-heading-icon" /></div>
        <div className="settings-fields">
          <div className="dependency-list">
            <div className="dependency-row"><div className={`dependency-icon ${wsl?.available ? 'ready' : 'offline'}`}><Terminal size={17} /></div><div className="dependency-copy"><strong>WSL Ubuntu</strong><span>{wsl?.available ? `${wsl.distro || 'Ubuntu'} ${isZh ? '已连接' : 'connected'}` : (isZh ? '未检测到可用的 WSL 发行版' : 'No available WSL distribution detected')}</span></div><span className={`dependency-badge ${wsl?.available ? 'ready' : 'offline'}`}>{wsl?.available ? (isZh ? '可用' : 'Available') : (isZh ? '不可用' : 'Unavailable')}</span></div>
            <div className="dependency-row"><div className={`dependency-icon ${tmuxAvailable ? 'ready' : 'offline'}`}><Layers3 size={17} /></div><div className="dependency-copy"><strong>tmux</strong><span>{tmuxAvailable ? (isZh ? '已安装，可保持并重新接入终端会话' : 'Installed; terminal sessions can persist and reconnect') : (isZh ? '未安装时仍可使用普通终端，但无法保持 tmux 会话' : 'Regular terminals still work, but tmux sessions cannot persist')}</span></div><button type="button" className={`button ${tmuxAvailable ? 'secondary' : 'primary'}`} disabled={installingTmux || !wsl?.available || tmuxAvailable} onClick={installTmux}>{installingTmux ? <RefreshCw size={15} className="spin" /> : tmuxAvailable ? <Check size={15} /> : <Download size={15} />}{installingTmux ? (isZh ? '安装中...' : 'Installing...') : tmuxAvailable ? (isZh ? '已安装' : 'Installed') : (isZh ? '一键安装 tmux' : 'Install tmux')}</button></div>
          </div>
          <span className="field-hint">{isZh ? `点击安装后会再次确认，并在 ${wsl?.distro || 'Ubuntu'} 内以 root 执行 apt-get；不会修改 Windows Terminal、注册表或其他 WSL 发行版。` : `Installation requires confirmation and runs apt-get as root inside ${wsl?.distro || 'Ubuntu'}; it does not change Windows Terminal, the registry, or other WSL distributions.`}</span>
          {tmuxInstallError && <div className="dependency-error"><AlertTriangle size={14} /><span>{tmuxInstallError}</span></div>}
        </div>
      </section>

      <section className="settings-section settings-wide panel">
        <div className="panel-heading"><div><h3>{isZh ? '本地配置' : 'Local configuration'}</h3><span>{isZh ? '分组、终端、指令和编排统一从项目配置文件读取。' : 'Groups, terminals, commands, and workflows are loaded from the project configuration.'}</span></div><FileText size={18} className="panel-heading-icon" /></div>
        <div className="settings-fields">
          <div className="field"><label>{isZh ? '配置文件' : 'Configuration file'}</label><div className="fixed-path"><code>{fixedPath}</code><span className={`settings-status ${backendReady ? 'ready' : 'offline'}`}><span className="connection-dot" />{backendReady ? (isZh ? '后端已连接' : 'Backend connected') : (isZh ? '后端离线' : 'Backend offline')}</span></div><span className="field-hint">{isZh ? '路径固定为项目目录下的 backend/servers.json，不能在应用内切换。' : 'The path is fixed to backend/servers.json in the project and cannot be changed in the app.'}</span></div>
        </div>
      </section>

      <section className="settings-section panel settings-safety">
        <div className="panel-heading"><div><h3>{isZh ? '运行说明' : 'Runtime notes'}</h3><span>{isZh ? 'Nexus 不会在未经确认时修改 WSL 或 Windows 配置。' : 'Nexus does not change WSL or Windows configuration without confirmation.'}</span></div><CircleHelp size={18} className="panel-heading-icon" /></div>
        <div className="settings-notes"><p>{isZh ? '语言和主题设置保存在浏览器本地，不写入 server.json。' : 'Language and theme preferences are stored locally in the UI and are not written to server.json.'}</p><p>{isZh ? '只有主动确认“一键安装 tmux”时，应用才会修改选中的 Ubuntu 软件包。' : 'Ubuntu packages are changed only after you explicitly confirm the tmux installation.'}</p><p>{isZh ? '后端不可用时，界面会保留离线预览终端。' : 'When the backend is unavailable, the offline preview terminal remains available.'}</p><p>{isZh ? '应用退出会停止后端调度器，但不会删除 tmux 服务会话。' : 'Exiting the app stops the backend scheduler but keeps tmux service sessions intact.'}</p></div>
      </section>
    </div>
  </>;
}

// Retained for backwards compatibility with older prototype imports; routing uses the split pages above.
function LegacyDashboardPage({ activeNav, groups, servers, selectedIds, collapsedGroups, onToggleGroup, onToggleServer, onCollapse, onSelectServer, onAction, selectedServers, statusCounts, onSend, onAddGroup, onAddService }) {
  const isFleet = activeNav === 'fleet';
  return <>
    <PageIntro eyebrow={isFleet ? 'SERVICE MANAGEMENT' : 'LOCAL OPERATIONS'} title={isFleet ? '服务管理' : '控制中心'} description={isFleet ? '选择服务分组，停止服务或连接到任意实例；启动流程请在服务编排中配置。' : '你的本地服务都在这里。保持状态清晰，操作一步到位。'} actions={<button className="button secondary" onClick={onAddService}><Plus size={16} />添加服务</button>} />
    <div className="metric-grid">
      <MetricCard label="服务总数" value={servers.length} detail={`${statusCounts.running || 0} 个正在运行`} icon={<Server size={18} />} tone="mint" />
       <MetricCard label="运行状态" value={`${servers.length ? Math.round(((statusCounts.running || 0) / servers.length) * 100) : 0}%`} detail={`${statusCounts.running || 0} running · ${statusCounts.stopped || 0} stopped`} icon={<Activity size={18} />} tone="blue" />
      <MetricCard label="内存占用" value="12.6 GB" detail="峰值 16.0 GB · 78%" icon={<Gauge size={18} />} tone="amber" />
      <MetricCard label="今日操作" value="38" detail="最近一次 · 14:32:18" icon={<History size={18} />} tone="violet" />
    </div>

    <div className="section-heading"><div><h2>服务分组</h2><span>{selectedIds.size} 个已选择 · {servers.filter((server) => server.status === 'running').length} 个运行中</span></div><div className="section-actions"><button className="text-button" onClick={onAddGroup}><Plus size={15} />新建分组</button><button className="text-button" onClick={() => onAction('stop')}><Square size={14} />停止已选</button><button className="icon-button"><SlidersHorizontal size={17} /></button></div></div>
    <div className="fleet-stack">
      {groups.map((group) => <GroupPanel key={group.id} group={group} selectedIds={selectedIds} collapsed={collapsedGroups.has(group.id)} onToggleGroup={() => onToggleGroup(group)} onToggleServer={onToggleServer} onCollapse={() => onCollapse(group.id)} onSelectServer={onSelectServer} onAction={onAction} />)}
    </div>

    <div className="lower-grid">
      <RecentActivity servers={servers} />
      <QuickCommand onSend={onSend} selectedServers={selectedServers} />
    </div>
  </>;
}

function MetricCard({ label, value, detail, icon, tone }) {
  return <div className={`metric-card metric-${tone}`}><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></div>;
}

function GroupPanel({ group, selectedIds, collapsed, onToggleGroup, onToggleServer, onCollapse, onSelectServer, onAction, onRemove }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const allSelected = group.servers.length > 0 && group.servers.every((server) => selectedIds.has(server.id));
  const someSelected = group.servers.some((server) => selectedIds.has(server.id));
  const running = group.servers.filter((server) => server.status === 'running').length;
  return <section className="group-panel"><div className="group-header"><button className="collapse-toggle" onClick={onCollapse}>{collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}</button><button className={`group-check ${allSelected ? 'checked' : someSelected ? 'partial' : ''}`} onClick={onToggleGroup}>{allSelected ? <Check size={14} /> : someSelected ? <MinusIcon /> : null}</button><div className={`group-accent accent-${group.accent}`} /><div className="group-title"><strong>{group.name}</strong><span>{group.note}</span></div><div className="group-health"><span className="health-live" />{running}/{group.servers.length} running</div><button className="icon-button compact" title="更多分组操作" aria-label="更多分组操作" onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={16} /></button>{menuOpen && <div className="row-menu group-row-menu"><button onClick={() => { onToggleGroup(); setMenuOpen(false); }}>{allSelected ? <Square size={14} /> : <Check size={14} />}{allSelected ? '清空分组选择' : '选择整个分组'}</button><button onClick={() => { onCollapse(); setMenuOpen(false); }}>{collapsed ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{collapsed ? '展开分组' : '折叠分组'}</button></div>}</div>{!collapsed && <div className="server-list">{group.servers.map((server) => <ServerRow key={server.id} server={server} selected={selectedIds.has(server.id)} onToggle={() => onToggleServer(server.id)} onSelect={() => onSelectServer(server.id)} onAction={onAction} onRemove={onRemove} />)}</div>}</section>;
}

function MinusIcon() { return <span className="minus-icon" />; }

function ServerRow({ server, selected, onToggle, onSelect, onAction, onRemove }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = statusMeta[server.status];
  const isRunning = server.status === 'running';
  return <div className={`server-row ${selected ? 'selected' : ''}`}><button className={`row-check ${selected ? 'checked' : ''}`} onClick={onToggle}>{selected && <Check size={13} />}</button><div className="server-identity" onClick={onSelect}><div className={`server-icon server-icon-${server.status}`}><Server size={16} /></div><div><strong>{server.name}</strong><span>{server.label} <i /> :{server.port || '—'}</span></div></div><div className={`status-badge ${status.className}`}><span>{status.dot}</span>{status.label}</div><div className="row-stat"><span>UPTIME</span><strong>{server.uptime}</strong></div><div className="row-stat"><span>PLAYERS</span><strong>{server.players}</strong></div><div className="row-stat"><span>MEMORY</span><strong>{server.memory}</strong></div><div className="row-actions"><button className="icon-button compact" onClick={() => onSelect()} title="打开终端"><Terminal size={15} /></button>{isRunning && <button className="icon-button compact" onClick={() => onAction('stop', [server.id])} title="停止服务"><Square size={14} /></button>}<button className="icon-button compact" title="更多操作" aria-label="更多操作" onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={15} /></button>{menuOpen && <div className="row-menu server-row-menu"><button onClick={() => { onSelect(); setMenuOpen(false); }}><Terminal size={14} />打开终端</button>{isRunning && <button onClick={() => { onAction('stop', [server.id]); setMenuOpen(false); }}><Square size={14} />停止服务</button>}<button className="danger" onClick={() => { onRemove?.(server); setMenuOpen(false); }}><Trash2 size={14} />删除终端</button></div>}</div></div>;
}

function RecentActivity({ servers }) {
  const items = [
    { type: 'success', title: '批量保存完成', detail: 'Survival · Main, Survival · Nether', time: '刚刚' },
    { type: 'warning', title: 'Metrics Dashboard 响应变慢', detail: 'scrape latency above 200ms', time: '2 分钟前' },
    { type: 'info', title: 'Creative · Main 已重连', detail: 'tmux session restored', time: '18 分钟前' },
  ];
  return <div className="activity-panel panel"><div className="panel-heading"><div><h3>最近活动</h3><span>操作与系统事件</span></div><button className="text-button">查看全部<ArrowUpRight size={14} /></button></div><div className="activity-list">{items.map((item) => <div className="activity-item" key={item.title}><div className={`activity-icon ${item.type}`}>{item.type === 'success' ? <CheckCircle2 size={16} /> : item.type === 'warning' ? <AlertTriangle size={16} /> : <RefreshCw size={16} />}</div><div className="activity-copy"><strong>{item.title}</strong><span>{item.detail}</span></div><time>{item.time}</time></div>)}</div></div>;
}

function QuickCommand({ onSend, selectedServers }) {
  const [value, setValue] = useState('save-all');
  return <div className="quick-command panel"><div className="panel-heading"><div><h3>快速指令</h3><span>发送至 {selectedServers.length || 0} 个已选服务</span></div><Command size={18} className="panel-heading-icon" /></div><div className="command-input-wrap"><span className="prompt">$</span><input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSend(value); }} placeholder="输入要发送的控制台指令" /><button className="send-button" onClick={() => onSend(value)}><Send size={15} /></button></div><div className="quick-chips"><button onClick={() => setValue('save-all')}>save-all</button><button onClick={() => setValue('list')}>list</button><button onClick={() => setValue('say ') }>say ...</button><button onClick={() => setValue('whitelist reload')}>whitelist reload</button></div></div>;
}

function TerminalPage({ servers, activeServer, activeServerId, setActiveServerId, lines, query, setQuery, input, setInput, onSend }) {
  const matchingLines = query ? lines.filter((line) => line.toLowerCase().includes(query.toLowerCase())) : lines;
  return <>
    <PageIntro eyebrow="INTERACTIVE SHELL" title="终端" description="连接到 tmux 会话，实时查看输出并发送控制台指令。" actions={<><button className="button secondary"><Copy size={16} />复制会话地址</button><button className="button primary"><Maximize2 size={16} />全屏终端</button></>} />
    <div className="terminal-layout"><div className="terminal-sidebar panel"><div className="terminal-sidebar-heading"><span>ACTIVE SESSIONS</span><button className="icon-button compact"><Plus size={15} /></button></div>{servers.map((server) => <button key={server.id} className={`terminal-session ${activeServerId === server.id ? 'active' : ''}`} onClick={() => setActiveServerId(server.id)}><span className={`session-dot ${server.status}`} /><span className="session-name"><strong>{server.name}</strong><small>{server.groupName}</small></span><span className="session-state">{server.status === 'running' ? 'live' : statusMeta[server.status].label}</span></button>)}</div><div className="terminal-main panel"><div className="terminal-toolbar"><div className="terminal-target"><span className="terminal-live-dot" /><strong>{activeServer.name}</strong><span>{activeServer.dir}</span></div><div className="terminal-tools"><label className="terminal-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前输出" />{query && <button onClick={() => setQuery('')}><X size={13} /></button>}</label><button className="icon-button compact" title="清空当前输出"><TrashIcon /></button><button className="icon-button compact" title="更多"><MoreHorizontal size={16} /></button></div></div><div className="terminal-screen"><div className="terminal-banner"><span>nexus://local/{activeServer.id}</span><span>PTY 120 × 32</span></div><div className="terminal-lines">{matchingLines.length ? matchingLines.map((line, index) => <div className={`terminal-line ${line.includes('WARN') ? 'line-warn' : line.includes('> ') ? 'line-command' : ''}`} key={`${line}-${index}`}><span className="line-no">{index + 1}</span><span>{highlight(line, query)}</span></div>) : <div className="empty-terminal">没有匹配的输出</div>}</div></div><div className="terminal-input-row"><span className="terminal-prompt">&gt;</span><input autoFocus value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSend(activeServer.id, input); }} placeholder="输入控制台指令，按 Enter 发送" /><button onClick={() => onSend(activeServer.id, input)}><Send size={16} /></button></div><div className="terminal-footer"><span><Wifi size={13} /> WebSocket connected</span><span>UTF-8</span><span>Ln {lines.length}, Col 1</span></div></div></div>
  </>;
}

function RealTerminalPage({ theme, servers, activeServer, activeServerId, setActiveServerId, lines, query, setQuery, onSend, commands, onUseCommand, pendingPaste, onPasteComplete, onAddService }) {
  return <>
    <div className="terminal-new-service"><button className="button secondary" onClick={onAddService}><Plus size={15} />New terminal</button></div>
    <PageIntro eyebrow="INTERACTIVE SHELL" title="终端" description={`连接到 ${shellLabel(activeServer.shell)} 的真实 PTY 会话，实时查看输出并输入命令。`} actions={<><button className="button secondary" onClick={() => navigator.clipboard?.writeText(`nexus://local/${activeServer.id}`)}><Copy size={16} />复制会话地址</button><button className="button primary" onClick={() => document.querySelector('.xterm-helper-textarea')?.focus()}><Terminal size={16} />激活终端输入</button></>} />
    <div className="terminal-layout"><div className="terminal-sidebar panel"><div className="terminal-sidebar-heading"><span>ACTIVE SESSIONS</span><button className="icon-button compact" onClick={onAddService} title="New terminal" aria-label="New terminal"><Plus size={15} /></button></div><div className="terminal-session-list">{servers.map((server) => <button key={server.id} className={`terminal-session ${activeServerId === server.id ? 'active' : ''}`} onClick={() => setActiveServerId(server.id)}><span className={`session-dot ${server.status}`} /><span className="session-name"><strong>{server.name}</strong><small>{server.groupName} · {shellLabel(server.shell)}</small></span><span className="session-state">{server.status === 'running' ? 'live' : statusMeta[server.status].label}</span></button>)}</div><TerminalCommandBar commands={commands} onUse={onUseCommand} /></div><XTermPanel key={activeServer.id} theme={theme} server={activeServer} lines={lines} query={query} setQuery={setQuery} onSend={onSend} pendingPaste={pendingPaste} onPasteComplete={onPasteComplete} /></div>
  </>;
}

function TerminalCommandBar({ commands, onUse }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const filtered = commands.filter((item) => `${item.name} ${item.command}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="terminal-command-bar panel"><div><strong>当前终端指令库</strong><span>执行型附加回车，粘贴型等待补充参数</span></div><div className="terminal-command-picker"><button className="button secondary" onClick={() => setOpen((value) => !value)}><Command size={15} />选择指令<ChevronDown size={14} /></button>{open && <div className="terminal-command-menu"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索指令" />{filtered.map((item) => { const paste = item.executionMode === 'paste'; return <button key={item.id} onClick={() => { onUse?.(item); setOpen(false); setQuery(''); }}><span><strong>{item.name}</strong><code>{item.command}</code><small>{paste ? '粘贴后补参数' : '直接执行'}</small></span>{paste ? <ClipboardPaste size={13} /> : <Play size={13} />}</button>; })}{!filtered.length && <span className="terminal-command-empty">没有匹配的指令</span>}</div>}</div></div>;
}

function XTermPanel({ theme, server, lines, query, setQuery, onSend, pendingPaste, onPasteComplete }) {
  const hostRef = useRef(null);
  const terminalRef = useRef(null);
  const searchRef = useRef(null);
  const socketRef = useRef(null);
  const onSendRef = useRef(onSend);
  const fallbackRef = useRef({ buffer: '', history: [], historyIndex: -1, connected: false });
  const lastPastedIdRef = useRef('');
  const [connection, setConnection] = useState('connecting');
  const [terminalReady, setTerminalReady] = useState(false);
  const [selectionAvailable, setSelectionAvailable] = useState(false);
  const [copyState, setCopyState] = useState('');

  useEffect(() => { onSendRef.current = onSend; }, [onSend]);

  useEffect(() => {
    const terminal = new XTerm({
      convertEol: true,
      cursorBlink: false,
      cursorStyle: 'bar',
      fontFamily: 'Cascadia Mono, Cascadia Code, DM Mono, Consolas, monospace',
      fontSize: 13,
      fontWeight: 500,
      lineHeight: 1.35,
       // WSL `dircolors` uses background styles such as 34;42 for writable
       // directories. Use a strong ratio so those labels remain readable.
       minimumContrastRatio: 7,
      scrollback: 5000,
      theme: terminalPalette(theme),
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    searchRef.current = search;

    const copySelection = async () => {
      const value = terminal.getSelection();
      if (!value) return;
      try {
        if (window.desktop?.copyText) await window.desktop.copyText(value);
        else await navigator.clipboard.writeText(value);
        setCopyState('copied');
        window.setTimeout(() => setCopyState(''), 1200);
      } catch {
        setCopyState('failed');
      }
    };
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.shiftKey && (event.ctrlKey || event.metaKey) && event.code === 'KeyC') {
        void copySelection();
        return false;
      }
      return true;
    });
    const selectionChange = terminal.onSelectionChange(() => setSelectionAvailable(terminal.hasSelection()));
    const onContextMenu = (event) => {
      if (!terminal.hasSelection()) return;
      event.preventDefault();
      void copySelection();
    };
    hostRef.current.addEventListener('contextmenu', onContextMenu);

    const fallback = fallbackRef.current;
    const writePrompt = () => {
      const shell = normalizeShellType(server.shell);
      if (shell === 'powershell' || shell === 'pwsh') terminal.write(`\x1b[38;2;128;173;255mPS\x1b[0m ${server.dir || '~'}> `);
      else if (shell === 'cmd') terminal.write(`${server.dir || 'C:\\'}> `);
      else terminal.write('\x1b[38;2;117;216;189mnexus\x1b[0m@\x1b[38;2;128;173;255mubuntu\x1b[0m:\x1b[38;2;243;199;120m~\x1b[0m$ ');
    };
    terminal.writeln(`\x1b[38;2;94;115;126mNexus PTY preview · ${server.name} · ${shellLabel(server.shell)}\x1b[0m`);
    terminal.writeln('\x1b[38;2;94;115;126mPTY backend offline; preview shell active.\x1b[0m');
    lines.slice(-80).forEach((line) => terminal.writeln(line));
    writePrompt();

    const redrawPrompt = () => { terminal.write('\r\x1b[2K'); writePrompt(); terminal.write(fallback.buffer); };
    const complete = () => {
      const tokenMatch = fallback.buffer.match(/(?:^|\s)([^\s]*)$/);
      const token = tokenMatch ? tokenMatch[1] : fallback.buffer;
      const candidates = ['help', 'clear', 'pwd', 'ls', 'cd', 'echo', 'save-all', 'list', 'say', 'whitelist', 'reload', 'tmux', 'exit'].filter((item) => item.startsWith(token));
      if (candidates.length === 1) {
        const suffix = candidates[0].slice(token.length);
        terminal.write(suffix);
        fallback.buffer += suffix;
      } else if (candidates.length > 1) {
        terminal.write(`\r\n${candidates.join('  ')}\r\n`);
        writePrompt();
        terminal.write(fallback.buffer);
      }
    };
    const executeFallback = (raw) => {
      const command = raw.trim();
      if (!command) { terminal.write('\r\n'); writePrompt(); return; }
      fallback.history = [command, ...fallback.history.filter((item) => item !== command)].slice(0, 100);
      fallback.historyIndex = -1;
      terminal.write('\r\n');
      if (command === 'clear') terminal.clear();
      else if (command === 'pwd') terminal.writeln('/home/server');
      else if (command === 'ls') terminal.writeln('backups  config  logs  server.jar  start.sh  world');
      else if (command === 'help') terminal.writeln('Tab complete · Ctrl+C interrupt · ↑/↓ history\r\nCommands: ls  cd  pwd  save-all  list  say  clear');
      else if (command === 'save-all') terminal.writeln('[Server thread/INFO]: Saved the game');
      else if (command === 'list') terminal.writeln('[Server thread/INFO]: There are 8 of a max of 20 players online');
      else if (command.startsWith('echo ')) terminal.writeln(command.slice(5));
      else if (command.startsWith('say ')) terminal.writeln(`[Server thread/INFO]: [公告] ${command.slice(4)}`);
      else terminal.writeln(`bash: ${command.split(/\s+/)[0]}: command sent to preview shell`);
      onSendRef.current(server.id, command);
      fallback.buffer = '';
      writePrompt();
    };
    const onData = terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN && fallback.connected) {
        socket.send(JSON.stringify({ type: 'input', data }));
        return;
      }
      if (data === '\t') { complete(); return; }
      if (data === '\r') { executeFallback(fallback.buffer); return; }
      if (data === '\u0003') { terminal.write('^C\r\n'); fallback.buffer = ''; writePrompt(); return; }
      if (data === '\u007f') { if (fallback.buffer.length) { fallback.buffer = fallback.buffer.slice(0, -1); terminal.write('\b \b'); } return; }
      if (data === '\u001b[A') { if (fallback.history.length) { fallback.historyIndex = Math.min(fallback.historyIndex + 1, fallback.history.length - 1); fallback.buffer = fallback.history[fallback.historyIndex] || ''; redrawPrompt(); } return; }
      if (data === '\u001b[B') { fallback.historyIndex = Math.max(fallback.historyIndex - 1, -1); fallback.buffer = fallback.historyIndex < 0 ? '' : fallback.history[fallback.historyIndex]; redrawPrompt(); return; }
      if (data >= ' ' && data !== '\u007f') { fallback.buffer += data; terminal.write(data); }
    });

    const socketUrl = socketUrlFor(server.id);
    let disposed = false;
    let reconnectTimer = 0;
    let reconnectAttempt = 0;
    let resizeFrame = 0;
    let initialResizeTimer = 0;
    let lastSentSize = '';
    /* legacy one-shot connection kept below for reference
    try {
      const socket = new WebSocket(socketUrl);
      socketRef.current = socket;
      socket.onopen = () => {
        fallback.connected = true;
        setConnection('connected');
        terminal.write('\r\n\x1b[38;2;117;216;189m✓ PTY connected · WSL Ubuntu\x1b[0m\r\n');
        socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'output') terminal.write(message.data);
          if (message.type === 'status') setConnection(message.value);
        } catch { terminal.write(event.data); }
      };
      socket.onclose = () => { fallback.connected = false; setConnection('preview'); };
      socket.onerror = () => { fallback.connected = false; setConnection('preview'); };
    } catch { setConnection('preview'); }
    */
    const sendResize = (force = false) => {
      if (disposed) return;
      fit.fit();
      const size = `${terminal.cols}x${terminal.rows}`;
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN || (!force && size === lastSentSize)) return;
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      lastSentSize = size;
    };
    const openSocket = () => {
      if (disposed) return;
      setConnection('connecting');
      let socket;
      try { socket = new WebSocket(socketUrl); } catch { setConnection('preview'); return; }
      socketRef.current = socket;
      socket.onopen = () => {
        if (disposed || socketRef.current !== socket) {
          socket.close();
          return;
        }
        reconnectAttempt = 0;
        lastSentSize = '';
        fallback.connected = true;
        setTerminalReady(false);
        setConnection('connected');
        terminal.write(`\r\n\x1b[38;2;117;216;189mPTY connected - ${shellLabel(server.shell)}\x1b[0m\r\n`);
        sendResize(true);
      };
      socket.onmessage = (event) => {
        if (disposed || socketRef.current !== socket) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'output') {
            if (message.replay) terminal.reset();
            terminal.write(message.data);
            setTerminalReady(true);
          }
          if (message.type === 'status' && message.value !== 'connected') setConnection(message.value);
        } catch { terminal.write(event.data); }
      };
      socket.onclose = (event) => {
        if (disposed || socketRef.current !== socket) return;
        socketRef.current = null;
        fallback.connected = false;
        setTerminalReady(false);
        setConnection('preview');
        // A newer Nexus terminal intentionally took ownership of this service.
        // Retrying here would make both renderers continuously detach each other.
        if (event.code === 4001) return;
        const retryDelay = Math.min(5000, 500 * (2 ** reconnectAttempt));
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(openSocket, retryDelay);
      };
      socket.onerror = () => {
        if (disposed || socketRef.current !== socket) return;
        fallback.connected = false;
      };
    };
    openSocket();

    const resize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => sendResize());
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(hostRef.current);
    window.addEventListener('resize', resize);
    initialResizeTimer = window.setTimeout(resize, 0);
    return () => {
      disposed = true;
      fallback.connected = false;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(initialResizeTimer);
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', resize);
      hostRef.current?.removeEventListener('contextmenu', onContextMenu);
      selectionChange.dispose();
      onData.dispose();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
      terminal.dispose();
    };
  }, [server.id]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalPalette(theme);
  }, [theme]);

  useEffect(() => {
    if (!pendingPaste?.id || connection !== 'connected' || !terminalReady) return;
    if (lastPastedIdRef.current === pendingPaste.id) return;
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    lastPastedIdRef.current = pendingPaste.id;
    socket.send(JSON.stringify({ type: 'input', data: pendingPaste.command }));
    terminalRef.current?.focus();
    onPasteComplete?.(pendingPaste.id);
  }, [pendingPaste?.id, connection, terminalReady]);

  useEffect(() => { if (query && searchRef.current) searchRef.current.findNext(query); }, [query]);

  const copyTerminalSelection = async () => {
    const value = terminalRef.current?.getSelection();
    if (!value) return;
    try {
      if (window.desktop?.copyText) await window.desktop.copyText(value);
      else await navigator.clipboard.writeText(value);
      setCopyState('copied');
      window.setTimeout(() => setCopyState(''), 1200);
    } catch {
      setCopyState('failed');
    }
  };

  return <div className="terminal-main panel"><div className="terminal-toolbar"><div className="terminal-target"><span className={`terminal-live-dot ${connection === 'connected' ? '' : 'preview'}`} /><strong>{server.name}</strong><span>{shellLabel(server.shell)} · {server.dir || '默认用户目录'}</span></div><div className="terminal-tools"><label className="terminal-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索终端输出" />{query && <button onClick={() => setQuery('')}><X size={13} /></button>}</label><button className="icon-button compact" onClick={() => searchRef.current?.findPrevious(query)} title="上一个匹配"><ChevronDown size={15} className="rotate-180" /></button><button className="icon-button compact" onClick={() => searchRef.current?.findNext(query)} title="下一个匹配"><ChevronDown size={15} /></button><button className="icon-button compact" onClick={copyTerminalSelection} disabled={!selectionAvailable} title="复制选中内容 (Ctrl+Shift+C)"><Copy size={14} /></button><button className="icon-button compact" onClick={() => terminalRef.current?.clear()} title="清空终端"><TrashIcon /></button></div></div><div className="xterm-host" ref={hostRef} /><div className="terminal-footer"><span className={connection === 'connected' ? 'pty-connected' : 'pty-preview'}>{connection === 'connected' ? <><Wifi size={13} /> WebSocket · {shellLabel(server.shell)}</> : <><WifiOff size={13} /> 本地预览 · 等待终端后端</>}</span><span>{copyState === 'copied' ? '已复制选中内容' : copyState === 'failed' ? '复制失败' : '拖选文本后右键或按 Ctrl+Shift+C 复制'}</span><span>UTF-8</span><span>{terminalRef.current ? `PTY ${terminalRef.current.cols} × ${terminalRef.current.rows}` : 'PTY'}</span></div></div>;
}

function TrashIcon() { return <span className="trash-icon" />; }

function highlight(text, query) {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'ig'));
  return parts.map((part, index) => part.toLowerCase() === query.toLowerCase() ? <mark key={index}>{part}</mark> : part);
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function newWorkflow(servers, commands) {
  return {
    id: `workflow-${Date.now()}`,
    name: 'New startup flow',
    description: '按步骤启动本地服务',
    steps: [{ id: `step-${Date.now()}`, type: 'action', action: 'start', serverId: servers[0]?.id || '', timeoutMs: 30000, retries: 0 }],
  };
}

function newWorkflowStep(servers, commands) {
  return { id: `step-${Date.now()}-${Math.random().toString(16).slice(2)}`, type: 'command', serverId: servers[0]?.id || '', commandId: commands[0]?.id || '', command: '', timeoutMs: 30000, retries: 0, onError: 'stop' };
}

function LegacyOrchestrationPage({ workflows, schedules, servers, commands, backendReady, onWorkflowsChange, onSchedulesChange, onRun }) {
  const [selectedId, setSelectedId] = useState(workflows[0]?.id || '');
  const [scheduleDraft, setScheduleDraft] = useState({ runType: 'workflow', workflowId: workflows[0]?.id || '', commandId: commands[0]?.id || '', command: '', serverIds: servers[0]?.id ? [servers[0].id] : [], type: 'interval', intervalMs: 3600000, cron: '0 * * * *', at: '' });
  const selected = workflows.find((workflow) => workflow.id === selectedId) || workflows[0];

  useEffect(() => {
    if (!selected && workflows[0]) setSelectedId(workflows[0].id);
    if (!scheduleDraft.workflowId && workflows[0]) setScheduleDraft((current) => ({ ...current, workflowId: workflows[0].id }));
  }, [selected, workflows, scheduleDraft.workflowId]);

  const updateSelected = (updater) => {
    if (!selected) return;
    onWorkflowsChange(workflows.map((workflow) => workflow.id === selected.id ? updater({ ...workflow, steps: [...(workflow.steps || [])] }) : workflow));
  };

  const addWorkflow = () => {
    const workflow = newWorkflow(servers, commands);
    onWorkflowsChange([...workflows, workflow]);
    setSelectedId(workflow.id);
  };

  const addStep = () => updateSelected((workflow) => ({ ...workflow, steps: [...workflow.steps, newWorkflowStep(servers, commands)] }));
  const removeStep = (stepId) => updateSelected((workflow) => ({ ...workflow, steps: workflow.steps.filter((step) => step.id !== stepId) }));
  const updateStep = (stepId, patch) => updateSelected((workflow) => ({ ...workflow, steps: workflow.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step) }));

  const addSchedule = () => {
    if (!scheduleDraft.workflowId) return;
    onSchedulesChange([...schedules, { id: `schedule-${Date.now()}`, name: selected?.name || 'Scheduled flow', enabled: true, ...scheduleDraft }]);
  };

  return <>
    <PageIntro eyebrow="SERVICE ORCHESTRATION" title="服务编排" description="用步骤流编写一键开服、等待条件和定时执行。" actions={<><button className="button secondary" onClick={addWorkflow}><Plus size={16} />新建编排</button>{selected && <button className="button primary" onClick={() => onRun(selected.id)} disabled={!backendReady}><Play size={16} />立即运行</button>}</>} />
    <div className="orchestration-layout"><aside className="workflow-list panel"><div className="panel-heading"><div><h3>编排流程</h3><span>{workflows.length} 个流程</span></div><button className="icon-button compact" onClick={addWorkflow} title="新建编排"><Plus size={15} /></button></div>{workflows.map((workflow) => <button key={workflow.id} className={`workflow-list-item ${selected?.id === workflow.id ? 'active' : ''}`} onClick={() => setSelectedId(workflow.id)}><GitBranch size={15} /><span><strong>{workflow.name}</strong><small>{workflow.steps?.length || 0} steps</small></span><ChevronRight size={14} /></button>)}{!workflows.length && <div className="empty-state"><GitBranch size={23} /><strong>还没有编排</strong><span>新建一个启动流程</span></div>}</aside><section className="workflow-editor panel">{selected ? <><div className="workflow-editor-header"><div><input className="workflow-name-input" value={selected.name} onChange={(event) => updateSelected((workflow) => ({ ...workflow, name: event.target.value }))} /><p>步骤按顺序执行；parallel 步骤可同时运行子步骤。</p></div><button className="icon-button" onClick={() => onWorkflowsChange(workflows.filter((workflow) => workflow.id !== selected.id))} title="删除编排"><X size={16} /></button></div><div className="workflow-steps">{(selected.steps || []).map((step, index) => <div className="workflow-step" key={step.id}><div className="workflow-step-index">{index + 1}</div><div className="workflow-step-fields"><div className="workflow-step-head"><select value={step.type || 'command'} onChange={(event) => updateStep(step.id, { type: event.target.value })}><option value="command">发送命令</option><option value="action">服务动作</option><option value="delay">固定等待</option><option value="wait-log">等待日志</option></select><input value={step.name || ''} onChange={(event) => updateStep(step.id, { name: event.target.value })} placeholder="步骤名称" /><button className="icon-button compact" onClick={() => removeStep(step.id)} title="删除步骤"><X size={14} /></button></div>{(step.type === 'command' || !step.type) && <div className="workflow-field-row"><select value={step.serverId || ''} onChange={(event) => updateStep(step.id, { serverId: event.target.value })}><option value="">选择服务</option>{servers.map((server) => <option value={server.id} key={server.id}>{server.name}</option>)}</select><select value={step.commandId || ''} onChange={(event) => updateStep(step.id, { commandId: event.target.value })}><option value="">临时命令</option>{commands.map((command) => <option value={command.id} key={command.id}>{command.name}</option>)}</select><input className="mono-field" value={step.command || ''} onChange={(event) => updateStep(step.id, { command: event.target.value })} placeholder="可选：直接输入命令" /></div>}{step.type === 'action' && <div className="workflow-field-row"><select value={step.action || 'start'} onChange={(event) => updateStep(step.id, { action: event.target.value })}><option value="start">启动</option><option value="stop">停止</option><option value="restart">重启</option></select><select value={step.serverId || ''} onChange={(event) => updateStep(step.id, { serverId: event.target.value })}><option value="">选择服务</option>{servers.map((server) => <option value={server.id} key={server.id}>{server.name}</option>)}</select></div>}{step.type === 'delay' && <div className="workflow-field-row"><input value={step.durationMs || step.value || ''} onChange={(event) => updateStep(step.id, { durationMs: event.target.value })} placeholder="等待毫秒数，例如 5000" /></div>}{step.type === 'wait-log' && <div className="workflow-field-row"><select value={step.serverId || ''} onChange={(event) => updateStep(step.id, { serverId: event.target.value })}><option value="">选择服务</option>{servers.map((server) => <option value={server.id} key={server.id}>{server.name}</option>)}</select><input value={step.match || ''} onChange={(event) => updateStep(step.id, { match: event.target.value })} placeholder="日志关键字" /></div>}<div className="workflow-step-meta"><label>超时 <input type="number" min="1000" value={step.timeoutMs || 30000} onChange={(event) => updateStep(step.id, { timeoutMs: Number(event.target.value) })} /></label><label>重试 <input type="number" min="0" value={step.retries || 0} onChange={(event) => updateStep(step.id, { retries: Number(event.target.value) })} /></label><label>失败后 <select value={step.onError || 'stop'} onChange={(event) => updateStep(step.id, { onError: event.target.value })}><option value="stop">停止</option><option value="continue">继续</option></select></label></div></div></div>)}{selected.steps?.length === 0 && <div className="empty-state"><Plus size={23} /><strong>还没有步骤</strong><span>添加第一步命令或服务动作</span></div>}</div><button className="text-button workflow-add-step" onClick={addStep}><Plus size={15} />添加步骤</button></> : <div className="empty-state"><GitBranch size={30} /><strong>选择或新建一个编排</strong><span>编排配置会自动保存到 WSL JSON</span></div>}</section></div>
     <section className="schedule-panel panel"><div className="panel-heading"><div><h3>定时任务</h3><span>窗口最小化时继续运行，退出应用后停止</span></div><Timer size={18} className="panel-heading-icon" /></div><div className="schedule-editor"><select value={scheduleDraft.workflowId} onChange={(event) => setScheduleDraft((current) => ({ ...current, workflowId: event.target.value }))}><option value="">选择编排</option>{workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}</select><select value={scheduleDraft.type} onChange={(event) => setScheduleDraft((current) => ({ ...current, type: event.target.value }))}><option value="once">一次性</option><option value="interval">间隔</option><option value="cron">Cron</option></select>{scheduleDraft.type === 'once' && <input type="datetime-local" value={scheduleDraft.at} onChange={(event) => setScheduleDraft((current) => ({ ...current, at: event.target.value }))} />}{scheduleDraft.type === 'interval' && <input type="number" min="1000" value={scheduleDraft.intervalMs} onChange={(event) => setScheduleDraft((current) => ({ ...current, intervalMs: Number(event.target.value) }))} placeholder="间隔毫秒" />}{scheduleDraft.type === 'cron' && <input className="mono-field" value={scheduleDraft.cron} onChange={(event) => setScheduleDraft((current) => ({ ...current, cron: event.target.value }))} placeholder="0 * * * *" />}<button className="button primary" onClick={addSchedule}><Plus size={15} />添加</button></div>{schedules.map((schedule) => <div className="schedule-row" key={schedule.id}><button className={`schedule-toggle ${schedule.enabled === false ? 'off' : ''}`} onClick={() => onSchedulesChange(schedules.map((item) => item.id === schedule.id ? { ...item, enabled: item.enabled === false } : item))} title={schedule.enabled === false ? '启用任务' : '暂停任务'}><span className={`schedule-dot ${schedule.enabled === false ? 'off' : ''}`} /></button><strong>{schedule.name || schedule.workflowId}</strong><code>{schedule.type === 'cron' ? schedule.cron : schedule.type === 'once' ? schedule.at : `every ${schedule.intervalMs}ms`}</code><button className="icon-button compact" onClick={() => onSchedulesChange(schedules.filter((item) => item.id !== schedule.id))} title="删除定时任务"><X size={14} /></button></div>)}</section>
  </>;
}

function workflowStepIdV2(prefix = 'step') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newWorkflowStepV2(servers, commands, overrides = {}) {
  return {
    id: workflowStepIdV2(),
    type: 'command',
    name: '',
    serverId: servers[0]?.id || '',
    commandId: commands[0]?.id || '',
    command: '',
    timeoutMs: 30000,
    retries: 0,
    onError: 'stop',
    ...overrides,
  };
}

function newParallelStepV2(servers, commands) {
  return {
    id: workflowStepIdV2('parallel'),
    type: 'parallel',
    name: 'Parallel group',
    steps: [
      newWorkflowStepV2(servers, commands, { name: 'Parallel branch 1' }),
      newWorkflowStepV2(servers, commands, { name: 'Parallel branch 2', serverId: servers[1]?.id || '' }),
    ],
    timeoutMs: 30000,
    retries: 0,
    onError: 'stop',
  };
}

function newWorkflowV2(servers, commands) {
  return {
    id: `workflow-${Date.now()}`,
    name: 'New startup flow',
    description: 'Run selected terminals in sequence and parallel groups',
    steps: [newWorkflowStepV2(servers, commands, { type: 'action', action: 'start', name: 'Start terminal' })],
  };
}

function updateWorkflowStepsV2(steps, path, updater) {
  const [head, ...rest] = path;
  return steps.map((step, index) => {
    if (index !== head) return step;
    if (!rest.length) return updater(step);
    return { ...step, steps: updateWorkflowStepsV2(Array.isArray(step.steps) ? step.steps : [], rest, updater) };
  });
}

function workflowStepAtV2(steps, path) {
  const [head, ...rest] = path;
  const step = steps?.[head];
  if (!step || !rest.length) return step;
  return workflowStepAtV2(step.steps || [], rest);
}

function appendWorkflowStepV2(steps, parentPath, step) {
  if (!parentPath.length) return [...steps, step];
  const [head, ...rest] = parentPath;
  return steps.map((item, index) => index !== head ? item : { ...item, steps: appendWorkflowStepV2(Array.isArray(item.steps) ? item.steps : [], rest, step) });
}

function removeWorkflowStepV2(steps, path) {
  const [head, ...rest] = path;
  if (!rest.length) return steps.filter((_step, index) => index !== head);
  return steps.map((step, index) => index !== head ? step : { ...step, steps: removeWorkflowStepV2(Array.isArray(step.steps) ? step.steps : [], rest) });
}

function workflowStepCountV2(steps = []) {
  return steps.reduce((count, step) => count + 1 + (step.type === 'parallel' ? workflowStepCountV2(step.steps || []) : 0), 0);
}

function workflowTargetsV2(step) {
  if (step?.type === 'parallel') return (step.steps || []).flatMap((child) => workflowTargetsV2(child));
  return [step?.serverId].filter(Boolean);
}

function WorkflowRunSteps({ steps = [] }) {
  return <>{steps.map((step) => <div className="workflow-run-step" key={step.index}><span className={`run-step-${step.status}`}>{step.index} · {step.label || step.type} · {step.status}</span>{step.error && <small>{step.error}</small>}{step.children?.length > 0 && <div className="workflow-run-children"><WorkflowRunSteps steps={step.children} /></div>}</div>)}</>;
}

function duplicateWorkflowTargetsV2(steps = []) {
  const seen = new Set();
  const duplicates = new Set();
  steps.forEach((step) => workflowTargetsV2(step).forEach((serverId) => {
    if (seen.has(serverId)) duplicates.add(serverId);
    seen.add(serverId);
  }));
  return [...duplicates];
}

function WorkflowTargetSelectV2({ value, servers, onChange, blockedValues = [] }) {
  return <select className="workflow-target-select" value={value || ''} onChange={(event) => onChange(event.target.value)} aria-label="Target terminal">
    <option value="">Target terminal</option>
    {servers.map((server) => <option value={server.id} key={server.id} disabled={blockedValues.includes(server.id) && server.id !== value}>{server.name} · {server.groupName}</option>)}
  </select>;
}

function WorkflowStepEditorV2({ step, indexLabel, path, servers, commands, onUpdate, onRemove, onAddChild, reservedTargets = [] }) {
  const legacyAction = step.type === 'command' && ['start', 'stop', 'restart'].includes(step.action);
  const type = legacyAction ? 'action' : ['command', 'action', 'delay', 'wait-log', 'parallel'].includes(step.type) ? step.type : 'command';
  const isParallel = type === 'parallel';
  const update = (patch) => onUpdate(path, patch);
  const changeType = (nextType) => {
    const next = {
      type: nextType,
      steps: nextType === 'parallel' ? (step.steps?.length ? step.steps : [newWorkflowStepV2(servers, commands)]) : [],
      action: nextType === 'action' ? (step.action || 'start') : undefined,
      commandId: nextType === 'command' ? (step.commandId || commands[0]?.id || '') : undefined,
      command: nextType === 'command' ? (step.command || '') : undefined,
      durationMs: nextType === 'delay' ? (step.durationMs || step.value || '') : undefined,
      match: nextType === 'wait-log' ? (step.match || '') : undefined,
    };
    next.serverId = step.serverId || servers[0]?.id || '';
    update(next);
  };
  const renderLeafFields = () => {
    const targetProps = { blockedValues: reservedTargets };
    if (type === 'action') return <div className="workflow-field-row"><select value={step.action || 'start'} onChange={(event) => update({ action: event.target.value })}><option value="start">Start</option><option value="stop">Stop</option><option value="restart">Restart</option></select><WorkflowTargetSelectV2 value={step.serverId} servers={servers} onChange={(value) => update({ serverId: value })} {...targetProps} /></div>;
    if (type === 'delay') return <div className="workflow-field-row"><WorkflowTargetSelectV2 value={step.serverId} servers={servers} onChange={(value) => update({ serverId: value })} {...targetProps} /><input value={step.durationMs || step.value || ''} onChange={(event) => update({ durationMs: event.target.value })} placeholder="Wait milliseconds, e.g. 5000" /></div>;
    if (type === 'wait-log') return <div className="workflow-field-row"><WorkflowTargetSelectV2 value={step.serverId} servers={servers} onChange={(value) => update({ serverId: value })} {...targetProps} /><input value={step.match || ''} onChange={(event) => update({ match: event.target.value })} placeholder="Log keyword" /></div>;
    return <div className="workflow-field-row"><WorkflowTargetSelectV2 value={step.serverId} servers={servers} onChange={(value) => update({ serverId: value })} {...targetProps} /><select value={step.commandId || ''} onChange={(event) => update({ commandId: event.target.value })}><option value="">Temporary command</option>{commands.map((command) => <option value={command.id} key={command.id}>{command.name}</option>)}</select><input className="mono-field" value={step.command || ''} onChange={(event) => update({ command: event.target.value })} placeholder="Optional direct command" /></div>;
  };
  return <div className={`workflow-step ${isParallel ? 'workflow-step-parallel' : ''}`}>
    <div className="workflow-step-index">{indexLabel}</div>
    <div className="workflow-step-fields">
      <div className="workflow-step-head"><select value={type} onChange={(event) => changeType(event.target.value)}><option value="command">Send command</option><option value="action">Service action</option><option value="delay">Fixed wait</option><option value="wait-log">Wait for log</option><option value="parallel">Parallel group</option></select><input value={step.name || ''} onChange={(event) => update({ name: event.target.value })} placeholder={isParallel ? 'Parallel group name' : 'Step name'} /><button className="icon-button compact" onClick={() => onRemove(path)} title="Remove step"><X size={14} /></button></div>
      {isParallel ? <><div className={`workflow-parallel-banner ${duplicateWorkflowTargetsV2(step.steps || []).length ? 'warning' : ''}`}><GitBranch size={14} /><span>{duplicateWorkflowTargetsV2(step.steps || []).length ? 'Parallel branches must target different terminals.' : 'All child steps start together; each branch selects its own terminal.'}</span></div><div className="workflow-parallel-children">{(step.steps || []).map((child, childIndex) => { const siblingTargets = (step.steps || []).filter((_sibling, siblingIndex) => siblingIndex !== childIndex).flatMap((sibling) => workflowTargetsV2(sibling)); const childReservedTargets = [...new Set([...reservedTargets, ...siblingTargets])]; return <WorkflowStepEditorV2 key={child.id} step={child} indexLabel={`${indexLabel}.${childIndex + 1}`} path={[...path, childIndex]} servers={servers} commands={commands} onUpdate={onUpdate} onRemove={onRemove} onAddChild={onAddChild} reservedTargets={childReservedTargets} />; })}{!step.steps?.length && <div className="workflow-parallel-empty">Add at least one parallel branch.</div>}</div><button className="text-button workflow-add-child" onClick={() => onAddChild(path)}><Plus size={14} />Add parallel branch</button><div className="workflow-step-meta"><label>Timeout <input type="number" min="1000" value={step.timeoutMs || 30000} onChange={(event) => update({ timeoutMs: Number(event.target.value) })} /></label><label>Retries <input type="number" min="0" value={step.retries || 0} onChange={(event) => update({ retries: Number(event.target.value) })} /></label><label>On failure <select value={step.onError || 'stop'} onChange={(event) => update({ onError: event.target.value })}><option value="stop">Stop</option><option value="continue">Continue</option></select></label></div></> : <>{renderLeafFields()}<div className="workflow-step-meta"><label>Timeout <input type="number" min="1000" value={step.timeoutMs || 30000} onChange={(event) => update({ timeoutMs: Number(event.target.value) })} /></label><label>Retries <input type="number" min="0" value={step.retries || 0} onChange={(event) => update({ retries: Number(event.target.value) })} /></label><label>On failure <select value={step.onError || 'stop'} onChange={(event) => update({ onError: event.target.value })}><option value="stop">Stop</option><option value="continue">Continue</option></select></label></div></>}
    </div>
  </div>;
}

function OrchestrationPageV2({ workflows, schedules, servers, commands, backendReady, onWorkflowsChange, onSchedulesChange, onRun }) {
  const [selectedId, setSelectedId] = useState(workflows[0]?.id || '');
  const [scheduleDraft, setScheduleDraft] = useState({ workflowId: workflows[0]?.id || '', type: 'interval', intervalMs: 3600000, cron: '0 * * * *', at: '' });
  const [runState, setRunState] = useState(null);
  const [runLoading, setRunLoading] = useState(false);
  const selected = workflows.find((workflow) => workflow.id === selectedId) || workflows[0];

  useEffect(() => {
    if (!selected && workflows[0]) setSelectedId(workflows[0].id);
    if (!scheduleDraft.workflowId && workflows[0]) setScheduleDraft((current) => ({ ...current, workflowId: workflows[0].id }));
  }, [selected, workflows, scheduleDraft.workflowId]);

  useEffect(() => {
    if (!runState?.id || !['queued', 'running'].includes(runState.status)) return undefined;
    let alive = true;
    const timer = window.setTimeout(() => {
      backendRequest(`/api/runs/${encodeURIComponent(runState.id)}`).then((next) => {
        if (alive) setRunState(next);
      }).catch(() => undefined);
    }, 500);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [runState]);

  const updateSelected = (updater) => {
    if (!selected) return;
    onWorkflowsChange(workflows.map((workflow) => workflow.id === selected.id ? updater({ ...workflow, steps: [...(workflow.steps || [])] }) : workflow));
  };
  const addWorkflow = () => {
    const workflow = { id: `workflow-${Date.now()}`, name: 'New startup flow', description: 'Run selected terminals in sequence and parallel groups', steps: [newWorkflowStepV2(servers, commands, { type: 'action', action: 'start', name: 'Start terminal' })] };
    onWorkflowsChange([...workflows, workflow]);
    setSelectedId(workflow.id);
  };
  const addStep = (parentPath = [], parallel = false) => updateSelected((workflow) => ({ ...workflow, steps: appendWorkflowStepV2(workflow.steps || [], parentPath, parallel ? newParallelStepV2(servers, commands) : newWorkflowStepV2(servers, commands)) }));
  const addChildStep = (parentPath) => updateSelected((workflow) => {
    const parent = workflowStepAtV2(workflow.steps || [], parentPath);
    if (parent?.type !== 'parallel') return workflow;
    const usedTargets = new Set((parent?.steps || []).flatMap((child) => workflowTargetsV2(child)));
    const nextTarget = servers.find((server) => !usedTargets.has(server.id))?.id || '';
    const child = newWorkflowStepV2(servers, commands, { serverId: nextTarget });
    return { ...workflow, steps: appendWorkflowStepV2(workflow.steps || [], parentPath, child) };
  });
  const removeStep = (path) => updateSelected((workflow) => ({ ...workflow, steps: removeWorkflowStepV2(workflow.steps || [], path) }));
  const updateStep = (path, patch) => updateSelected((workflow) => ({ ...workflow, steps: updateWorkflowStepsV2(workflow.steps || [], path, (step) => ({ ...step, ...patch })) }));
  const addSchedule = () => {
    if (!scheduleDraft.workflowId) return;
    onSchedulesChange([...schedules, { id: `schedule-${Date.now()}`, name: selected?.name || 'Scheduled flow', enabled: true, ...scheduleDraft }]);
  };
  const runSelected = async () => {
    if (!selected || !onRun) return;
    setRunLoading(true);
    try {
      const started = await onRun(selected.id);
      if (started?.id) setRunState(started);
    } catch {
      // The parent reports the request error; keep the editor usable.
    } finally {
      setRunLoading(false);
    }
  };

  return <>
     <PageIntro eyebrow="SERVICE ORCHESTRATION" title="服务编排" description="按顺序或并行组编排多个终端，配置等待条件、失败策略和定时执行。" actions={<><button className="button secondary" onClick={addWorkflow}><Plus size={16} />新建编排</button>{selected && <button className="button primary" onClick={runSelected} disabled={!backendReady || runLoading || ['queued', 'running'].includes(runState?.status)}><Play size={16} />{runLoading ? '启动中...' : '立即运行'}</button>}</>} />
     <div className="orchestration-layout"><aside className="workflow-list panel"><div className="panel-heading"><div><h3>编排流程</h3><span>{workflows.length} 个流程</span></div><button className="icon-button compact" onClick={addWorkflow} title="新建编排"><Plus size={15} /></button></div>{workflows.map((workflow) => <button key={workflow.id} className={`workflow-list-item ${selected?.id === workflow.id ? 'active' : ''}`} onClick={() => { setSelectedId(workflow.id); setRunState(null); }}><GitBranch size={15} /><span><strong>{workflow.name}</strong><small>{workflowStepCountV2(workflow.steps || [])} steps</small></span><ChevronRight size={14} /></button>)}{!workflows.length && <div className="empty-state"><GitBranch size={23} /><strong>还没有编排</strong><span>新建一个启动流程</span></div>}</aside><section className="workflow-editor panel">{selected ? <><div className="workflow-editor-header"><div><input className="workflow-name-input" value={selected.name} onChange={(event) => updateSelected((workflow) => ({ ...workflow, name: event.target.value }))} /><p>根步骤按顺序执行；并行组中的每个分支同时执行，并分别选择目标终端。</p>{runState && <div className={`workflow-run-status status-${runState.status}`}><span>Run {runState.status}</span>{runState.error && <small>{runState.error}</small>}{runState.steps?.length > 0 && <div className="workflow-run-steps"><WorkflowRunSteps steps={runState.steps} /></div>}</div>}</div><button className="icon-button" onClick={() => onWorkflowsChange(workflows.filter((workflow) => workflow.id !== selected.id))} title="删除编排"><X size={16} /></button></div><div className="workflow-steps">{(selected.steps || []).map((step, index) => <WorkflowStepEditorV2 key={step.id} step={step} indexLabel={String(index + 1)} path={[index]} servers={servers} commands={commands} onUpdate={updateStep} onRemove={removeStep} onAddChild={addChildStep} />)}{selected.steps?.length === 0 && <div className="empty-state"><Plus size={23} /><strong>还没有步骤</strong><span>添加一个顺序步骤或并行组</span></div>}</div><div className="workflow-add-actions"><button className="text-button workflow-add-step" onClick={() => addStep()}><Plus size={15} />添加顺序步骤</button><button className="text-button workflow-add-step" onClick={() => addStep([], true)}><GitBranch size={15} />添加并行组</button></div></> : <div className="empty-state"><GitBranch size={30} /><strong>选择或新建一个编排</strong><span>编排配置会自动保存到 WSL JSON</span></div>}</section></div>
    <section className="schedule-panel panel"><div className="panel-heading"><div><h3>定时任务</h3><span>窗口最小化时继续运行，退出应用后停止</span></div><Timer size={18} className="panel-heading-icon" /></div><div className="schedule-editor"><select value={scheduleDraft.workflowId} onChange={(event) => setScheduleDraft((current) => ({ ...current, workflowId: event.target.value }))}><option value="">选择编排</option>{workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}</select><select value={scheduleDraft.type} onChange={(event) => setScheduleDraft((current) => ({ ...current, type: event.target.value }))}><option value="once">一次性</option><option value="interval">间隔</option><option value="cron">Cron</option></select>{scheduleDraft.type === 'once' && <input type="datetime-local" value={scheduleDraft.at} onChange={(event) => setScheduleDraft((current) => ({ ...current, at: event.target.value }))} />}{scheduleDraft.type === 'interval' && <input type="number" min="1000" value={scheduleDraft.intervalMs} onChange={(event) => setScheduleDraft((current) => ({ ...current, intervalMs: Number(event.target.value) }))} placeholder="间隔毫秒" />}{scheduleDraft.type === 'cron' && <input className="mono-field" value={scheduleDraft.cron} onChange={(event) => setScheduleDraft((current) => ({ ...current, cron: event.target.value }))} placeholder="0 * * * *" />}<button className="button primary" onClick={addSchedule}><Plus size={15} />添加</button></div>{schedules.map((schedule) => <div className="schedule-row" key={schedule.id}><span className={`schedule-dot ${schedule.enabled === false ? 'off' : ''}`} /><strong>{schedule.name || schedule.workflowId}</strong><code>{schedule.type === 'cron' ? schedule.cron : schedule.type === 'once' ? schedule.at : `every ${schedule.intervalMs}ms`}</code><button className="icon-button compact" onClick={() => onSchedulesChange(schedules.filter((item) => item.id !== schedule.id))} title="删除定时任务"><X size={14} /></button></div>)}</section>
  </>;
}

function LocalizedWorkflowRunSteps({ steps = [], language = 'zh-CN' }) {
  const isZh = language === 'zh-CN';
  const statusText = { queued: isZh ? '排队中' : 'queued', running: isZh ? '运行中' : 'running', completed: isZh ? '已完成' : 'completed', failed: isZh ? '失败' : 'failed', retrying: isZh ? '重试中' : 'retrying' };
  return <>{steps.map((step) => <div className="workflow-run-step" key={step.index}><span className={`run-step-${step.status}`}>{step.index} · {step.label || step.type} · {statusText[step.status] || step.status}</span>{step.error && <small>{step.error}</small>}{step.children?.length > 0 && <div className="workflow-run-children"><LocalizedWorkflowRunSteps steps={step.children} language={language} /></div>}</div>)}</>;
}

function LocalizedWorkflowTargetSelect({ value, servers, onChange, blockedValues = [], language = 'zh-CN' }) {
  const isZh = language === 'zh-CN';
  return <select className="workflow-target-select" value={value || ''} onChange={(event) => onChange(event.target.value)} aria-label={isZh ? '目标终端' : 'Target terminal'}><option value="">{isZh ? '选择目标终端' : 'Target terminal'}</option>{servers.map((server) => <option value={server.id} key={server.id} disabled={blockedValues.includes(server.id) && server.id !== value}>{server.name} · {server.groupName}</option>)}</select>;
}

function LocalizedWorkflowStepEditor({ step, indexLabel, path, servers, commands, onUpdate, onRemove, onAddChild, reservedTargets = [], language = 'zh-CN' }) {
  const isZh = language === 'zh-CN';
  const legacyAction = step.type === 'command' && ['start', 'stop', 'restart'].includes(step.action);
  const type = legacyAction ? 'action' : ['command', 'action', 'delay', 'wait-log', 'parallel'].includes(step.type) ? step.type : 'command';
  const isParallel = type === 'parallel';
  const update = (patch) => onUpdate(path, patch);
  const changeType = (nextType) => {
    const next = {
      type: nextType,
      steps: nextType === 'parallel' ? (step.steps?.length ? step.steps : [newWorkflowStepV2(servers, commands)]) : [],
      action: nextType === 'action' ? (step.action || 'start') : undefined,
      commandId: nextType === 'command' ? (step.commandId || commands[0]?.id || '') : undefined,
      command: nextType === 'command' ? (step.command || '') : undefined,
      durationMs: nextType === 'delay' ? (step.durationMs || step.value || '') : undefined,
      match: nextType === 'wait-log' ? (step.match || '') : undefined,
    };
    next.serverId = step.serverId || servers[0]?.id || '';
    update(next);
  };
  const target = (blockedValues = reservedTargets) => <LocalizedWorkflowTargetSelect value={step.serverId} servers={servers} blockedValues={blockedValues} language={language} onChange={(value) => update({ serverId: value })} />;
  const leafFields = () => {
    if (type === 'action') return <div className="workflow-field-row"><select value={step.action || 'start'} onChange={(event) => update({ action: event.target.value })}><option value="start">{isZh ? '启动' : 'Start'}</option><option value="stop">{isZh ? '停止' : 'Stop'}</option><option value="restart">{isZh ? '重启' : 'Restart'}</option></select>{target()}</div>;
    if (type === 'delay') return <div className="workflow-field-row">{target()}<input value={step.durationMs || step.value || ''} onChange={(event) => update({ durationMs: event.target.value })} placeholder={isZh ? '等待毫秒数，例如 5000' : 'Wait milliseconds, e.g. 5000'} /></div>;
    if (type === 'wait-log') return <div className="workflow-field-row">{target()}<input value={step.match || ''} onChange={(event) => update({ match: event.target.value })} placeholder={isZh ? '日志关键字' : 'Log keyword'} /></div>;
    return <div className="workflow-field-row">{target()}<select value={step.commandId || ''} onChange={(event) => update({ commandId: event.target.value })}><option value="">{isZh ? '临时命令' : 'Temporary command'}</option>{commands.map((command) => <option value={command.id} key={command.id}>{command.name}</option>)}</select><input className="mono-field" value={step.command || ''} onChange={(event) => update({ command: event.target.value })} placeholder={isZh ? '可选：直接输入命令' : 'Optional direct command'} /></div>;
  };
  const meta = <div className="workflow-step-meta"><label>{isZh ? '超时' : 'Timeout'} <input type="number" min="1000" value={step.timeoutMs || 30000} onChange={(event) => update({ timeoutMs: Number(event.target.value) })} /></label><label>{isZh ? '重试' : 'Retries'} <input type="number" min="0" value={step.retries || 0} onChange={(event) => update({ retries: Number(event.target.value) })} /></label><label>{isZh ? '失败后' : 'On failure'} <select value={step.onError || 'stop'} onChange={(event) => update({ onError: event.target.value })}><option value="stop">{isZh ? '停止' : 'Stop'}</option><option value="continue">{isZh ? '继续' : 'Continue'}</option></select></label></div>;
  return <div className={`workflow-step ${isParallel ? 'workflow-step-parallel' : ''}`}><div className="workflow-step-index">{indexLabel}</div><div className="workflow-step-fields"><div className="workflow-step-head"><select value={type} onChange={(event) => changeType(event.target.value)}><option value="command">{isZh ? '发送命令' : 'Send command'}</option><option value="action">{isZh ? '服务动作' : 'Service action'}</option><option value="delay">{isZh ? '固定等待' : 'Fixed wait'}</option><option value="wait-log">{isZh ? '等待日志' : 'Wait for log'}</option><option value="parallel">{isZh ? '并行任务组' : 'Parallel group'}</option></select><input value={step.name || ''} onChange={(event) => update({ name: event.target.value })} placeholder={isParallel ? (isZh ? '并行任务组名称' : 'Parallel group name') : (isZh ? '步骤名称' : 'Step name')} /><button type="button" className="icon-button compact" onClick={() => onRemove(path)} title={isZh ? '删除步骤' : 'Remove step'}><X size={14} /></button></div>{isParallel ? <><div className={`workflow-parallel-banner ${duplicateWorkflowTargetsV2(step.steps || []).length ? 'warning' : ''}`}><GitBranch size={14} /><span>{duplicateWorkflowTargetsV2(step.steps || []).length ? (isZh ? '并行分支必须选择不同的终端。' : 'Parallel branches must target different terminals.') : (isZh ? '所有子步骤会同时开始，每个分支分别选择自己的终端。' : 'All child steps start together; each branch selects its own terminal.')}</span></div><div className="workflow-parallel-children">{(step.steps || []).map((child, childIndex) => { const siblingTargets = (step.steps || []).filter((_sibling, siblingIndex) => siblingIndex !== childIndex).flatMap((sibling) => workflowTargetsV2(sibling)); const childReservedTargets = [...new Set([...reservedTargets, ...siblingTargets])]; return <LocalizedWorkflowStepEditor key={child.id} step={child} indexLabel={`${indexLabel}.${childIndex + 1}`} path={[...path, childIndex]} servers={servers} commands={commands} onUpdate={onUpdate} onRemove={onRemove} onAddChild={onAddChild} reservedTargets={childReservedTargets} language={language} />; })}{!step.steps?.length && <div className="workflow-parallel-empty">{isZh ? '请至少添加一个并行分支。' : 'Add at least one parallel branch.'}</div>}</div><button type="button" className="text-button workflow-add-child" onClick={() => onAddChild(path)}><Plus size={14} />{isZh ? '添加并行分支' : 'Add parallel branch'}</button>{meta}</> : <>{leafFields()}{meta}</>}</div></div>;
}

function LocalizedOrchestrationPage({ language, workflows, schedules, servers, commands, backendReady, onWorkflowsChange, onSchedulesChange, onRun }) {
  const isZh = language === 'zh-CN';
  const [selectedId, setSelectedId] = useState(workflows[0]?.id || '');
  const [scheduleDraft, setScheduleDraft] = useState({ runType: 'workflow', workflowId: workflows[0]?.id || '', commandId: commands[0]?.id || '', command: '', serverIds: servers[0]?.id ? [servers[0].id] : [], type: 'interval', intervalMs: 3600000, intervalMode: 'repeat', at: '' });
  const [runState, setRunState] = useState(null);
  const [runLoading, setRunLoading] = useState(false);
  const selected = workflows.find((workflow) => workflow.id === selectedId) || workflows[0];
  useEffect(() => { if (!selected && workflows[0]) setSelectedId(workflows[0].id); if (!scheduleDraft.workflowId && workflows[0]) setScheduleDraft((current) => ({ ...current, workflowId: workflows[0].id })); if (!(scheduleDraft.serverIds || []).length && servers[0]) setScheduleDraft((current) => ({ ...current, serverIds: [servers[0].id] })); }, [selected, workflows, scheduleDraft.workflowId, (scheduleDraft.serverIds || []).length, servers]);
  useEffect(() => { if (!runState?.id || !['queued', 'running'].includes(runState.status)) return undefined; let alive = true; const timer = window.setTimeout(() => { backendRequest(`/api/runs/${encodeURIComponent(runState.id)}`).then((next) => { if (alive) setRunState(next); }).catch(() => undefined); }, 500); return () => { alive = false; window.clearTimeout(timer); }; }, [runState]);
  const updateSelected = (updater) => { if (!selected) return; onWorkflowsChange(workflows.map((workflow) => workflow.id === selected.id ? updater({ ...workflow, steps: [...(workflow.steps || [])] }) : workflow)); };
  const addWorkflow = () => { const workflow = newWorkflowV2(servers, commands); workflow.name = isZh ? '新建编排' : 'New workflow'; workflow.description = isZh ? '按顺序和并行分支执行服务任务' : 'Run service tasks in sequence and parallel branches'; workflow.steps = [newWorkflowStepV2(servers, commands, { type: 'action', action: 'start', name: isZh ? '启动终端' : 'Start terminal' })]; onWorkflowsChange([...workflows, workflow]); setSelectedId(workflow.id); };
  const addStep = (parentPath = [], parallel = false) => updateSelected((workflow) => ({ ...workflow, steps: appendWorkflowStepV2(workflow.steps || [], parentPath, parallel ? newParallelStepV2(servers, commands) : newWorkflowStepV2(servers, commands)) }));
  const addChildStep = (parentPath) => updateSelected((workflow) => { const parent = workflowStepAtV2(workflow.steps || [], parentPath); if (parent?.type !== 'parallel') return workflow; const usedTargets = new Set((parent.steps || []).flatMap((child) => workflowTargetsV2(child))); const nextTarget = servers.find((server) => !usedTargets.has(server.id))?.id || ''; return { ...workflow, steps: appendWorkflowStepV2(workflow.steps || [], parentPath, newWorkflowStepV2(servers, commands, { serverId: nextTarget, name: isZh ? '并行分支' : 'Parallel branch' })) }; });
  const removeStep = (path) => updateSelected((workflow) => ({ ...workflow, steps: removeWorkflowStepV2(workflow.steps || [], path) }));
  const updateStep = (path, patch) => updateSelected((workflow) => ({ ...workflow, steps: updateWorkflowStepsV2(workflow.steps || [], path, (step) => ({ ...step, ...patch })) }));
  const addSchedule = () => {
    const isCommand = scheduleDraft.runType === 'command';
    if (isCommand ? ((!scheduleDraft.commandId && !scheduleDraft.command.trim()) || !(scheduleDraft.serverIds || []).length) : !scheduleDraft.workflowId) return;
    const createdAt = new Date().toISOString();
    const at = scheduleDraft.type === 'once' ? new Date(scheduleDraft.at).toISOString() : scheduleDraft.at;
    onSchedulesChange([...schedules, { id: `schedule-${Date.now()}`, name: isCommand ? (isZh ? '定时指令' : 'Scheduled command') : (selected?.name || (isZh ? '定时编排' : 'Scheduled workflow')), enabled: true, ...scheduleDraft, at, createdAt }]);
  };
  const intervalParts = splitIntervalMilliseconds(scheduleDraft.intervalMs);
  const updateIntervalMilliseconds = (value) => setScheduleDraft((current) => ({ ...current, intervalMs: Math.max(0, Number(value) || 0) }));
  const updateIntervalPart = (part, value) => {
    const nextParts = {
      ...intervalParts,
      [part]: part === 'hours' ? Math.max(0, Number(value) || 0) : Math.min(59.999, Math.max(0, Number(value) || 0)),
    };
    setScheduleDraft((current) => ({ ...current, intervalMs: joinIntervalMilliseconds(nextParts) }));
  };
  const toggleScheduleServer = (serverId) => setScheduleDraft((current) => ({ ...current, serverIds: (current.serverIds || []).includes(serverId) ? current.serverIds.filter((id) => id !== serverId) : [...(current.serverIds || []), serverId] }));
  const scheduleTargetReady = scheduleDraft.runType === 'command'
    ? Boolean((scheduleDraft.commandId || scheduleDraft.command.trim()) && (scheduleDraft.serverIds || []).length)
    : Boolean(scheduleDraft.workflowId);
  const scheduleTimingReady = scheduleDraft.type === 'interval' ? Number(scheduleDraft.intervalMs) >= 1000 : Boolean(scheduleDraft.at);
  const scheduleReady = scheduleTargetReady && scheduleTimingReady;
  const runSelected = async () => { if (!selected || !onRun) return; setRunLoading(true); try { const started = await onRun(selected.id); if (started?.id) setRunState(started); } catch { /* parent reports the error */ } finally { setRunLoading(false); } };
  const scheduleValue = (schedule) => {
    const target = schedule.runType === 'command' ? (isZh ? '指令' : 'command') : (isZh ? '编排' : 'workflow');
    if (schedule.type === 'cron') return `${target} · ${isZh ? '旧版 Cron' : 'Legacy Cron'} · ${schedule.cron}`;
    if (schedule.type === 'once') return `${target} · ${isZh ? '指定时间' : 'at'} ${formatScheduleDateTime(schedule.at, language)}`;
    const intervalMode = schedule.intervalMode === 'once' ? (isZh ? '执行一次' : 'run once') : (isZh ? '循环执行' : 'repeat');
    return `${target} · ${isZh ? '每隔' : 'every'} ${formatIntervalMilliseconds(schedule.intervalMs, language)} · ${intervalMode} · ${schedule.intervalMs} ms`;
  };
  return <>
    <PageIntro eyebrow="SERVICE ORCHESTRATION" title={isZh ? '服务编排' : 'Service orchestration'} description={isZh ? '按顺序或并行编排多个终端，配置等待条件、失败策略和定时执行。' : 'Orchestrate terminals in sequence or parallel with waits, retries, and schedules.'} actions={<><button className="button secondary" onClick={addWorkflow}><Plus size={16} />{isZh ? '新建编排' : 'New workflow'}</button>{selected && <button className="button primary" onClick={runSelected} disabled={!backendReady || runLoading || ['queued', 'running'].includes(runState?.status)}><Play size={16} />{runLoading ? (isZh ? '启动中…' : 'Starting…') : (isZh ? '立即运行' : 'Run now')}</button>}</>} />
    <div className="orchestration-layout"><aside className="workflow-list panel"><div className="panel-heading"><div><h3>{isZh ? '编排流程' : 'Workflows'}</h3><span>{workflows.length} {isZh ? '个流程' : 'workflows'}</span></div><button className="icon-button compact" onClick={addWorkflow} title={isZh ? '新建编排' : 'New workflow'}><Plus size={15} /></button></div>{workflows.map((workflow) => <button key={workflow.id} className={`workflow-list-item ${selected?.id === workflow.id ? 'active' : ''}`} onClick={() => { setSelectedId(workflow.id); setRunState(null); }}><GitBranch size={15} /><span><strong>{workflow.name}</strong><small>{workflowStepCountV2(workflow.steps || [])} {isZh ? '个步骤' : 'steps'}</small></span><ChevronRight size={14} /></button>)}{!workflows.length && <div className="empty-state"><GitBranch size={23} /><strong>{isZh ? '还没有编排' : 'No workflows yet'}</strong><span>{isZh ? '新建一个启动流程开始。' : 'Create a startup flow to begin.'}</span></div>}</aside><section className="workflow-editor panel">{selected ? <><div className="workflow-editor-header"><div><input className="workflow-name-input" value={selected.name} onChange={(event) => updateSelected((workflow) => ({ ...workflow, name: event.target.value }))} /><p>{isZh ? '根步骤按顺序执行；并行组中的分支会同时执行，并分别选择目标终端。' : 'Root steps run in order; branches in a parallel group run together on their selected terminals.'}</p>{runState && <div className={`workflow-run-status status-${runState.status}`}><span>{isZh ? '运行状态' : 'Run status'}：{runState.status}</span>{runState.error && <small>{runState.error}</small>}{runState.steps?.length > 0 && <div className="workflow-run-steps"><LocalizedWorkflowRunSteps steps={runState.steps} language={language} /></div>}</div>}</div><button className="icon-button" onClick={() => onWorkflowsChange(workflows.filter((workflow) => workflow.id !== selected.id))} title={isZh ? '删除编排' : 'Delete workflow'}><X size={16} /></button></div><div className="workflow-steps">{(selected.steps || []).map((step, index) => <LocalizedWorkflowStepEditor key={step.id} step={step} indexLabel={String(index + 1)} path={[index]} servers={servers} commands={commands} onUpdate={updateStep} onRemove={removeStep} onAddChild={addChildStep} language={language} />)}{selected.steps?.length === 0 && <div className="empty-state"><Plus size={23} /><strong>{isZh ? '还没有步骤' : 'No steps yet'}</strong><span>{isZh ? '添加顺序步骤或并行任务组。' : 'Add a sequential step or parallel group.'}</span></div>}</div><div className="workflow-add-actions"><button type="button" className="text-button workflow-add-step" onClick={() => addStep()}><Plus size={15} />{isZh ? '添加顺序步骤' : 'Add sequential step'}</button><button type="button" className="text-button workflow-add-step" onClick={() => addStep([], true)}><GitBranch size={15} />{isZh ? '添加并行组' : 'Add parallel group'}</button></div></> : <div className="empty-state"><GitBranch size={30} /><strong>{isZh ? '选择或新建一个编排' : 'Select or create a workflow'}</strong><span>{isZh ? '编排配置会自动保存到 JSON。' : 'Workflow configuration is saved to JSON automatically.'}</span></div>}</section></div>
     <section className="schedule-panel panel">
       <div className="panel-heading"><div><h3>{isZh ? '定时任务' : 'Schedules'}</h3><span>{isZh ? '窗口最小化时继续运行，退出应用后停止。' : 'Schedules continue while minimized and stop when the app exits.'}</span></div><div className="schedule-heading-meta"><strong>{schedules.length}</strong><Timer size={17} /></div></div>
       <div className="schedule-builder">
         <div className="schedule-builder-grid">
           <div className="schedule-field"><label>{isZh ? '执行内容' : 'Run'}</label><div className="schedule-segments"><button className={scheduleDraft.runType === 'workflow' ? 'active' : ''} onClick={() => setScheduleDraft((current) => ({ ...current, runType: 'workflow' }))}><GitBranch size={14} />{isZh ? '编排' : 'Workflow'}</button><button className={scheduleDraft.runType === 'command' ? 'active' : ''} onClick={() => setScheduleDraft((current) => ({ ...current, runType: 'command' }))}><Command size={14} />{isZh ? '指令' : 'Command'}</button></div></div>
           <div className="schedule-field schedule-field-main"><label>{scheduleDraft.runType === 'workflow' ? (isZh ? '选择编排' : 'Workflow') : (isZh ? '选择指令' : 'Command')}</label>{scheduleDraft.runType === 'workflow' ? <select value={scheduleDraft.workflowId} onChange={(event) => setScheduleDraft((current) => ({ ...current, workflowId: event.target.value }))}><option value="">{isZh ? '请选择编排' : 'Select workflow'}</option>{workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}</select> : <select value={scheduleDraft.commandId} onChange={(event) => setScheduleDraft((current) => ({ ...current, commandId: event.target.value, command: '' }))}><option value="">{isZh ? '临时直接输入' : 'Direct command'}</option>{commands.map((command) => <option value={command.id} key={command.id}>{command.name}</option>)}</select>}</div>
            <div className="schedule-field"><label>{isZh ? '执行周期' : 'Timing'}</label><div className="schedule-segments timing"><button className={scheduleDraft.type === 'once' ? 'active' : ''} onClick={() => setScheduleDraft((current) => ({ ...current, type: 'once' }))}><CalendarDays size={14} />{isZh ? '指定日期时间' : 'Date & time'}</button><button className={scheduleDraft.type === 'interval' ? 'active' : ''} onClick={() => setScheduleDraft((current) => ({ ...current, type: 'interval' }))}><Timer size={14} />{isZh ? '固定间隔' : 'Interval'}</button></div></div>
            <div className={`schedule-field schedule-field-value ${scheduleDraft.type === 'interval' ? 'schedule-field-interval' : ''}`}><label>{scheduleDraft.type === 'once' ? (isZh ? '执行日期和时间' : 'Run date and time') : (isZh ? '执行间隔' : 'Run interval')}</label>{scheduleDraft.type === 'once' && <input type="datetime-local" step="1" value={scheduleDraft.at} onChange={(event) => setScheduleDraft((current) => ({ ...current, at: event.target.value }))} />}{scheduleDraft.type === 'interval' && <div className="schedule-interval-editor"><div className="schedule-segments schedule-interval-mode"><button type="button" className={scheduleDraft.intervalMode === 'once' ? 'active' : ''} onClick={() => setScheduleDraft((current) => ({ ...current, intervalMode: 'once' }))}>{isZh ? '执行一次' : 'Run once'}</button><button type="button" className={scheduleDraft.intervalMode !== 'once' ? 'active' : ''} onClick={() => setScheduleDraft((current) => ({ ...current, intervalMode: 'repeat' }))}>{isZh ? '循环执行' : 'Repeat'}</button></div><div className="schedule-millisecond-input"><input type="number" min="1000" step="1000" value={scheduleDraft.intervalMs} onChange={(event) => updateIntervalMilliseconds(event.target.value)} aria-label={isZh ? '间隔毫秒' : 'Interval milliseconds'} /><span>ms</span></div><div className="schedule-hms-inputs"><label><input type="number" min="0" step="1" value={intervalParts.hours} onChange={(event) => updateIntervalPart('hours', event.target.value)} /><span>{isZh ? '时' : 'h'}</span></label><label><input type="number" min="0" max="59" step="1" value={intervalParts.minutes} onChange={(event) => updateIntervalPart('minutes', event.target.value)} /><span>{isZh ? '分' : 'm'}</span></label><label><input type="number" min="0" max="59.999" step="0.001" value={intervalParts.seconds} onChange={(event) => updateIntervalPart('seconds', event.target.value)} /><span>{isZh ? '秒' : 's'}</span></label></div></div>}</div>
         </div>
         {scheduleDraft.runType === 'command' && <><div className="schedule-direct-command"><label>{isZh ? '临时指令' : 'Direct command'}</label><input className="mono-field" value={scheduleDraft.command} onChange={(event) => setScheduleDraft((current) => ({ ...current, command: event.target.value, commandId: '' }))} placeholder={isZh ? '选择“临时直接输入”后在这里输入指令' : 'Choose Direct command, then enter it here'} /></div><div className="schedule-target-picker"><strong>{isZh ? '目标终端' : 'Target terminals'}</strong><div>{servers.map((server) => { const checked = (scheduleDraft.serverIds || []).includes(server.id); return <button key={server.id} className={checked ? 'selected' : ''} onClick={() => toggleScheduleServer(server.id)}><span className="schedule-target-check">{checked && <Check size={11} />}</span>{server.name}</button>; })}</div></div></>}
         <div className="schedule-builder-footer"><span>{scheduleReady ? (isZh ? '配置完整，可以添加任务。' : 'Ready to add.') : (isZh ? '请补全执行内容和目标。' : 'Complete the run target and timing.')}</span><button className="button primary" onClick={addSchedule} disabled={!scheduleReady}><Plus size={15} />{isZh ? '添加定时任务' : 'Add schedule'}</button></div>
       </div>
       <div className="schedule-list">{schedules.map((schedule) => <div className="schedule-row" key={schedule.id}><button className={`schedule-toggle ${schedule.enabled === false ? 'off' : ''}`} onClick={() => onSchedulesChange(schedules.map((item) => item.id === schedule.id ? { ...item, enabled: item.enabled === false } : item))} title={schedule.enabled === false ? (isZh ? '启用任务' : 'Enable schedule') : (isZh ? '暂停任务' : 'Pause schedule')}><span /></button><div className="schedule-row-icon">{schedule.runType === 'command' ? <Command size={15} /> : <GitBranch size={15} />}</div><div className="schedule-row-copy"><strong>{schedule.name || schedule.workflowId || schedule.commandId || schedule.command}</strong><code>{scheduleValue(schedule)}</code></div><span className={`schedule-state ${schedule.enabled === false ? 'off' : ''}`}>{schedule.enabled === false ? (isZh ? '已暂停' : 'Paused') : (isZh ? '已启用' : 'Active')}</span><button className="icon-button compact" onClick={() => onSchedulesChange(schedules.filter((item) => item.id !== schedule.id))} title={isZh ? '删除定时任务' : 'Delete schedule'}><X size={14} /></button></div>)}{!schedules.length && <div className="schedule-empty"><Timer size={20} /><span>{isZh ? '还没有定时任务' : 'No schedules yet'}</span></div>}</div>
     </section>
  </>;
}

const OrchestrationPage = LocalizedOrchestrationPage;

function LogsPage({ servers, linesByServer, query, setQuery, onOpen, backendReady, onOpenDirectory, onOpenLogFile }) {
  const [remoteRows, setRemoteRows] = useState(null);
  const [logFiles, setLogFiles] = useState([]);
  const [serverFilter, setServerFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [searchView, setSearchView] = useState('matches');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  useEffect(() => {
    if (!backendReady) return undefined;
    let alive = true;
    let timer = 0;
    const loadLogs = (showLoading = false) => {
      if (showLoading) setLoading(true);
      const suffix = serverFilter ? `&serverId=${encodeURIComponent(serverFilter)}` : '';
      const apiQuery = searchView === 'matches' ? query : '';
      const limit = searchView === 'matches' ? 5000 : 20000;
      backendRequest(`/api/logs?limit=${limit}&q=${encodeURIComponent(apiQuery)}${suffix}`, { timeout: 5000 }).then((payload) => {
        if (!alive) return;
        setRemoteRows(payload.rows || []);
        setLogFiles(payload.files || []);
        setLastUpdated(new Date());
      }).catch(() => { if (alive) setRemoteRows(null); }).finally(() => { if (alive) setLoading(false); });
    };
    loadLogs(true);
    timer = window.setInterval(() => loadLogs(false), 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [backendReady, query, serverFilter, searchView, refreshKey]);
  const allRows = servers.flatMap((server) => (linesByServer[server.id] || []).map((line, index) => ({ server, line, index })));
  const remote = (remoteRows || []).map((row) => ({ server: servers.find((item) => item.id === row.serverId) || { id: row.serverId, name: row.serverName, groupName: row.groupName, accent: 'mint' }, line: row.line, index: row.index }));
  const levelMatches = (line) => levelFilter === 'all'
    || (levelFilter === 'error' && /\b(error|exception|fatal)\b/i.test(line))
    || (levelFilter === 'warn' && /\b(warn|warning)\b/i.test(line))
    || (levelFilter === 'info' && !/\b(error|exception|fatal|warn|warning)\b/i.test(line));
  const filtered = (remoteRows ? remote : allRows.filter(({ server, line }) => (!serverFilter || server.id === serverFilter) && (searchView === 'all' || `${server.name} ${server.groupName} ${line}`.toLowerCase().includes(query.toLowerCase()))))
    .filter(({ line }) => levelMatches(line));
  const matchCount = query ? filtered.filter(({ server, line }) => `${server.name} ${server.groupName} ${line}`.toLowerCase().includes(query.toLowerCase())).length : filtered.length;
  const selectedFile = serverFilter ? logFiles.find((file) => file.serverId === serverFilter) : null;
  const formatSize = (size) => size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size || 0} B`;
  const visibleServers = serverFilter ? servers.filter((server) => server.id === serverFilter) : servers;
  const logGroups = visibleServers.map((server) => ({
    server,
    file: logFiles.find((file) => file.serverId === server.id),
    rows: filtered.filter((row) => row.server.id === server.id),
  })).filter((group) => group.rows.length || ((searchView === 'all' || !query) && levelFilter === 'all'));
  return <>
    <PageIntro eyebrow="OBSERVABILITY" title="日志检索" description="查看每个终端已经输出过的持久化记录，关闭终端页面后日志仍会继续保存。" actions={<><button className="button secondary" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} />刷新</button><button className="button primary" onClick={onOpenDirectory}><FolderOpen size={16} />打开日志目录</button></>} />
    <div className="log-file-strip panel"><div className="log-file-selector"><Layers3 size={15} /><label>查看终端<select value={serverFilter} onChange={(event) => setServerFilter(event.target.value)}><option value="">全部终端</option>{servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</select></label></div><div className="log-file-actions">{selectedFile && <><span><FileText size={14} />{selectedFile.fileName} · {formatSize(selectedFile.size)}</span><button className="button secondary" onClick={() => onOpenLogFile(serverFilter)}><FileText size={15} />打开日志文件</button><button className="button secondary" onClick={() => onOpen(serverFilter)}><ArrowUpRight size={15} />打开终端</button></>}</div></div>
    <div className="log-toolbar panel"><div className="log-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索以前输出过的内容，例如命令、报错或玩家名称" /></div><div className="log-filters"><button className={`filter-button log-context-toggle ${searchView === 'all' ? 'active' : ''}`} onClick={() => setSearchView((current) => current === 'matches' ? 'all' : 'matches')} aria-pressed={searchView === 'all'} title={searchView === 'matches' ? '显示完整日志并高亮搜索词' : '只显示包含搜索词的输出'}>{searchView === 'matches' ? <FileText size={15} /> : <ListChecks size={15} />}{searchView === 'matches' ? '显示完整日志' : '仅显示结果'}</button><label className="filter-select"><AlertTriangle size={15} /><select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}><option value="all">所有级别</option><option value="info">Info</option><option value="warn">Warning</option><option value="error">Error</option></select></label><button className="icon-button" onClick={() => { setQuery(''); setServerFilter(''); setLevelFilter('all'); }} title="清除日志筛选"><SlidersHorizontal size={16} /></button></div></div>
    <div className="log-summary"><span><strong>{logGroups.length}</strong> 个终端</span><span><strong>{filtered.length}</strong> 条输出</span>{query && searchView === 'all' && <span><strong>{matchCount}</strong> 条匹配，当前显示完整上下文</span>}<span className="summary-live"><span className="connection-dot" />{lastUpdated ? `${lastUpdated.toLocaleTimeString()} 已更新` : '正在读取'}</span></div>
    <div className="log-terminal-list">{logGroups.map(({ server, file, rows }) => <section className="log-terminal panel" key={server.id}><header className="log-terminal-header"><div className="log-terminal-identity"><span className={`result-dot ${server.accent}`} /><div><strong>{server.name}</strong><span>{server.groupName} · {file?.fileName || `${server.id}.log`}</span></div></div><div className="log-terminal-meta"><span>{rows.length} 条输出</span><span>{formatSize(file?.size)}</span><button className="icon-button compact" onClick={() => onOpenLogFile(server.id)} title="打开日志文件" aria-label={`打开 ${server.name} 日志文件`}><FileText size={14} /></button><button className="icon-button compact" onClick={() => onOpen(server.id)} title="打开终端" aria-label={`打开 ${server.name} 终端`}><ArrowUpRight size={14} /></button></div></header><pre className="log-terminal-output">{rows.length ? rows.map(({ line, index }, rowIndex) => <span key={`${server.id}-${index}`}>{highlight(line, query || '___never_match___')}{rowIndex < rows.length - 1 ? '\n' : ''}</span>) : <span className="log-terminal-empty">该终端还没有日志输出。</span>}</pre></section>)}{!logGroups.length && <div className="empty-state panel"><Search size={26} /><strong>{loading ? '正在读取日志' : '没有找到日志记录'}</strong><span>{backendReady ? '当前关键词或级别筛选没有匹配任何终端。' : '后端离线时只能查看当前页面内存中的输出。'}</span></div>}</div>
  </>;
}

function LegacyCommandsPageV2({ language, commands, query, setQuery, groups, selectedIds, onToggleGroup, onToggleServer, onClearSelection, onRun, onNew, onCopy, onDelete }) {
  const [openId, setOpenId] = useState(null);
  const selectedCount = selectedIds.size;
  return <>
    <PageIntro eyebrow="COMMAND PALETTE" title="Command library" description="Save common commands and run them on the selected services." actions={<><button className="button secondary"><History size={16} />History</button><button className="button primary" onClick={onNew}><Plus size={16} />New command</button></>} />
    <CommandTargetPicker groups={groups} selectedIds={selectedIds} onToggleGroup={onToggleGroup} onToggleServer={onToggleServer} onClearSelection={onClearSelection} />
    <div className="command-toolbar"><label className="log-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, command or description" /></label><div className="command-scope"><ListChecks size={16} /><strong>{selectedCount}</strong> selected services</div></div>
    <div className="command-grid">{commands.map((item) => <div className="command-card panel" key={item.id}><div className={`command-card-icon tone-${item.tone}`}><Command size={17} /></div><div className="command-card-main"><div className="command-card-title"><strong>{item.name}</strong><div className="command-card-menu-wrap"><button className="icon-button compact" onClick={() => setOpenId((current) => current === item.id ? null : item.id)} aria-expanded={openId === item.id} aria-label={`Actions for ${item.name}`} title="Command actions"><MoreHorizontal size={15} /></button>{openId === item.id && <div className="command-card-menu"><button onClick={() => { onCopy?.(item.command); setOpenId(null); }}><Copy size={14} />Copy command</button><button className="danger" onClick={() => { onDelete?.(item.id); setOpenId(null); }}><X size={14} />Delete command</button></div>}</div></div><code>{item.command}</code><p>{item.description}</p><div className="command-card-meta"><span>{item.scope}</span><span><History size={13} />{item.runs || 0} runs</span></div></div><button className="run-command" disabled={!selectedCount} onClick={() => onRun(item.command)}><Play size={14} />Run</button></div>)}{!commands.length && <div className="empty-state command-empty"><Search size={26} /><strong>No commands found</strong><span>Create a command or change the search.</span></div>}</div>
  </>;
}

function CommandsPage({ language, commands, query, setQuery, groups, selectedIds, onToggleGroup, onToggleServer, onClearSelection, onRun, onPaste, onModeChange, onNew, onImport, onExport, onCopy, onEdit, onDelete }) {
  const isZh = language === 'zh-CN';
  const [openId, setOpenId] = useState(null);
  const [fileAction, setFileAction] = useState('');
  const runFileAction = async (type, action) => {
    if (fileAction || !action) return;
    setFileAction(type);
    try { await action(); } finally { setFileAction(''); }
  };
  const text = isZh ? {
    title: '指令库', description: '保存可直接执行或粘贴后补参数的常用指令。', importLibrary: '导入命令库', exportLibrary: '导出命令库', newCommand: '新建指令', search: '搜索名称、指令或说明', selected: '个服务已选择', targets: '指令目标', targetHint: '直接执行支持多个终端；粘贴指令时只选择一个终端。', clear: '清空', copy: '复制指令', edit: '编辑指令', remove: '删除指令', run: '执行', paste: '粘贴', setExecute: '改为直接执行', setPaste: '改为粘贴到终端', executeMode: '直接执行', pasteMode: '粘贴后补参数', empty: '没有找到指令', emptyHint: '请新建指令或修改搜索条件。', noGroups: '还没有配置终端分组', runs: '次执行', current: '当前目标',
  } : {
    title: 'Command library', description: 'Save commands to execute or paste before adding parameters.', importLibrary: 'Import library', exportLibrary: 'Export library', newCommand: 'New command', search: 'Search name, command or description', selected: 'services selected', targets: 'Command targets', targetHint: 'Execute supports multiple terminals; select one terminal for paste commands.', clear: 'Clear', copy: 'Copy command', edit: 'Edit command', remove: 'Delete command', run: 'Run', paste: 'Paste', setExecute: 'Change to execute', setPaste: 'Change to paste', executeMode: 'Execute', pasteMode: 'Paste then edit', empty: 'No commands found', emptyHint: 'Create a command or change the search.', noGroups: 'No terminal groups configured', runs: 'runs', current: 'Current targets',
  };
  return <>
    <PageIntro eyebrow="COMMAND PALETTE" title={text.title} description={text.description} actions={<><button className="button secondary" onClick={() => runFileAction('import', onImport)} disabled={Boolean(fileAction)}><Upload size={16} />{text.importLibrary}</button><button className="button secondary" onClick={() => runFileAction('export', onExport)} disabled={Boolean(fileAction)}><Download size={16} />{text.exportLibrary}</button><button className="button primary" onClick={onNew}><Plus size={16} />{text.newCommand}</button></>} />
    <section className="command-targets panel"><div className="command-targets-header"><div><strong>{text.targets}</strong><span>{text.targetHint}</span></div><div className="command-targets-summary"><strong>{selectedIds.size}</strong> {text.selected}<button className="text-button" onClick={onClearSelection} disabled={!selectedIds.size}>{text.clear}</button></div></div><div className="command-target-groups">{groups.map((group) => { const ids = group.servers.map((server) => server.id); const count = ids.filter((id) => selectedIds.has(id)).length; const allSelected = ids.length > 0 && count === ids.length; const someSelected = count > 0 && !allSelected; return <div className="command-target-group" key={group.id}><div className="command-target-group-header"><button className={`group-check ${allSelected ? 'checked' : someSelected ? 'partial' : ''}`} onClick={() => onToggleGroup(group)} aria-label={`${text.selected} ${group.name}`}>{allSelected ? <Check size={14} /> : someSelected ? <MinusIcon /> : null}</button><span className={`group-accent accent-${group.accent}`} /><strong>{group.name}</strong><span>{count}/{ids.length}</span></div><div className="command-target-servers">{group.servers.map((server) => { const checked = selectedIds.has(server.id); return <button key={server.id} className={`command-target-server ${checked ? 'selected' : ''}`} onClick={() => onToggleServer(server.id)}><span className={`row-check ${checked ? 'checked' : ''}`}>{checked && <Check size={11} />}</span><span>{server.name}</span></button>; })}</div></div>; })}{!groups.length && <span className="command-target-empty">{text.noGroups}</span>}</div></section>
    <div className="command-toolbar"><label className="log-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} /></label><div className="command-scope"><ListChecks size={16} /><strong>{selectedIds.size}</strong> {text.selected}</div></div>
    <div className="command-grid">{commands.map((item) => { const paste = item.executionMode === 'paste'; return <div className="command-card panel" key={item.id}><div className={`command-card-icon tone-${item.tone}`}>{paste ? <ClipboardPaste size={17} /> : <Command size={17} />}</div><div className="command-card-main"><div className="command-card-title"><strong>{item.name}</strong><div className="command-card-menu-wrap"><button className="icon-button compact" onClick={() => setOpenId((current) => current === item.id ? null : item.id)} aria-expanded={openId === item.id} aria-label={isZh ? `操作 ${item.name}` : `Actions for ${item.name}`} title={isZh ? '指令操作' : 'Command actions'}><MoreHorizontal size={15} /></button>{openId === item.id && <div className="command-card-menu"><button onClick={() => { onEdit?.(item); setOpenId(null); }}><Pencil size={14} />{text.edit}</button><button onClick={() => { onCopy?.(item.command); setOpenId(null); }}><Copy size={14} />{text.copy}</button><button onClick={() => { onModeChange?.(item.id, paste ? 'execute' : 'paste'); setOpenId(null); }}>{paste ? <Play size={14} /> : <ClipboardPaste size={14} />}{paste ? text.setExecute : text.setPaste}</button><button className="danger" onClick={() => { onDelete?.(item.id); setOpenId(null); }}><X size={14} />{text.remove}</button></div>}</div></div><code>{item.command}</code><p>{item.description}</p><div className="command-card-meta"><span className={`command-mode-badge ${paste ? 'paste' : ''}`}>{paste ? text.pasteMode : text.executeMode}</span><span>{item.scope}</span><span><History size={13} />{item.runs || 0} {text.runs}</span></div></div><button className={`run-command ${paste ? 'paste-command' : ''}`} disabled={paste ? selectedIds.size !== 1 : !selectedIds.size} onClick={() => paste ? onPaste(item) : onRun(item.command)}>{paste ? <ClipboardPaste size={14} /> : <Play size={14} />}{paste ? text.paste : text.run}</button></div>; })}{!commands.length && <div className="empty-state command-empty"><Search size={26} /><strong>{text.empty}</strong><span>{text.emptyHint}</span></div>}</div>
  </>;
}

function CommandTargetPicker({ groups, selectedIds, onToggleGroup, onToggleServer, onClearSelection }) {
  return <section className="command-targets panel">
    <div className="command-targets-header">
      <div><strong>Batch execution targets</strong><span>Select groups or individual terminals before running a command.</span></div>
      <div className="command-targets-summary"><strong>{selectedIds.size}</strong> selected<button className="text-button" onClick={onClearSelection} disabled={!selectedIds.size}>Clear</button></div>
    </div>
    <div className="command-target-groups">
      {groups.map((group) => {
        const ids = group.servers.map((server) => server.id);
        const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
        const allSelected = ids.length > 0 && selectedCount === ids.length;
        const someSelected = selectedCount > 0 && !allSelected;
        return <div className="command-target-group" key={group.id}>
          <div className="command-target-group-header">
            <button className={`group-check ${allSelected ? 'checked' : someSelected ? 'partial' : ''}`} onClick={() => onToggleGroup(group)} aria-label={`Select ${group.name}`}>{allSelected ? <Check size={14} /> : someSelected ? <MinusIcon /> : null}</button>
            <span className={`group-accent accent-${group.accent}`} />
            <strong>{group.name}</strong>
            <span>{selectedCount}/{ids.length}</span>
          </div>
          <div className="command-target-servers">
            {group.servers.map((server) => {
              const checked = selectedIds.has(server.id);
              return <button key={server.id} className={`command-target-server ${checked ? 'selected' : ''}`} onClick={() => onToggleServer(server.id)}><span className={`row-check ${checked ? 'checked' : ''}`}>{checked && <Check size={11} />}</span><span>{server.name}</span></button>;
            })}
          </div>
        </div>;
      })}
      {!groups.length && <span className="command-target-empty">No terminal groups configured.</span>}
    </div>
  </section>;
}

function LegacyCommandsPage({ commands, query, setQuery, onRun, onNew }) {
  return <>
    <PageIntro eyebrow="COMMAND PALETTE" title="指令库" description="把重复操作保存下来，一次选择，多处执行。" actions={<><button className="button secondary"><History size={16} />执行历史</button><button className="button primary" onClick={onNew}><Plus size={16} />新建指令</button></>} />
    <div className="command-toolbar"><label className="log-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、指令或说明" /></label><div className="command-scope"><ListChecks size={16} />当前目标：<strong>已选 {onRun ? '服务' : '—'}</strong></div></div>
    <div className="command-grid">{commands.map((item) => <div className="command-card panel" key={item.id}><div className={`command-card-icon tone-${item.tone}`}><Command size={17} /></div><div className="command-card-main"><div className="command-card-title"><strong>{item.name}</strong><button className="icon-button compact"><MoreHorizontal size={15} /></button></div><code>{item.command}</code><p>{item.description}</p><div className="command-card-meta"><span>{item.scope}</span><span><History size={13} />{item.runs} 次执行</span></div></div><button className="run-command" onClick={() => onRun(item.command)}><Play size={14} />执行</button></div>)}{!commands.length && <div className="empty-state command-empty"><Search size={26} /><strong>没有找到指令</strong><span>试试命令名或关键词。</span></div>}</div>
  </>;
}

function LegacyCreationModal({ type, groups, wsl, onClose, onCreate }) {
  const isGroup = type === 'group';
  const isServer = type === 'server';
  const groupOptions = groups.length ? groups.map((group) => ({ value: group.id, label: group.name })) : [{ value: 'local', label: 'Local services' }];
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const [form, setForm] = useState(isGroup ? { name: '', note: '', accent: 'mint' } : isServer ? { name: '', label: '', groupId: groupOptions[0].value, port: '', dir: '' } : { name: '', command: '', description: '', scope: 'Current selection', tone: 'mint' });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (isServer && !form.groupId) setForm((current) => ({ ...current, groupId: groupOptions[0].value }));
  }, [isServer, form.groupId, groupOptions[0].value]);
  const submit = (event) => {
    event.preventDefault();
    onCreate(form);
  };
  const pickDirectory = async () => {
    if (!window.desktop?.selectDirectory) {
      update('dir', '/root');
      return;
    }
    setPickingDirectory(true);
    try {
      const result = await window.desktop.selectDirectory();
      if (result?.path) update('dir', result.path);
    } finally {
      setPickingDirectory(false);
    }
  };
  const title = isGroup ? '新建服务分组' : isServer ? '添加本地服务' : '保存控制台指令';
  const subtitle = isGroup ? '先建立一个编排容器，再向其中添加服务。' : isServer ? '填写服务的基本信息，后续可接入 WSL 启动脚本。' : '将常用命令保存到指令库，之后可批量执行。';
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="creation-modal" onSubmit={submit}><div className="modal-header"><div><div className="eyebrow">CONFIGURATION</div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div><div className="modal-fields">{isGroup && <><Field label="分组名称" required value={form.name} onChange={(value) => update('name', value)} placeholder="例如：生存服群" /><Field label="描述" value={form.note} onChange={(value) => update('note', value)} placeholder="这个分组负责什么" /><div className="field"><label>标识色</label><div className="swatch-row">{['mint', 'blue', 'amber', 'violet'].map((tone) => <button type="button" key={tone} className={`swatch swatch-${tone} ${form.accent === tone ? 'selected' : ''}`} onClick={() => update('accent', tone)} aria-label={tone} />)}</div></div></>}{isServer && <><Field label="服务名称" required value={form.name} onChange={(value) => update('name', value)} placeholder="例如：Survival · Event" /><Field label="服务标签" value={form.label} onChange={(value) => update('label', value)} placeholder="例如：活动服" /><div className="field-row"><Field label="所属分组" required type="select" options={groups.map((group) => ({ value: group.id, label: group.name }))} value={form.groupId} onChange={(value) => update('groupId', value)} /><Field label="端口" value={form.port} onChange={(value) => update('port', value)} placeholder="25565" /></div><Field label="WSL 工作目录" value={form.dir} onChange={(value) => update('dir', value)} placeholder="/srv/servers/event" /></>}{!isGroup && !isServer && <><Field label="指令名称" required value={form.name} onChange={(value) => update('name', value)} placeholder="例如：安全保存" /><Field label="控制台指令" required mono value={form.command} onChange={(value) => update('command', value)} placeholder="save-all" /><Field label="说明" value={form.description} onChange={(value) => update('description', value)} placeholder="简短描述这个指令的作用" /><div className="field"><label>适用范围</label><div className="scope-options">{['当前选择', '全部游戏服', '生存服群', '单个服务'].map((scope) => <button type="button" key={scope} className={form.scope === scope ? 'selected' : ''} onClick={() => update('scope', scope)}>{scope}</button>)}</div></div></>}</div><div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" type="submit"><Check size={15} />保存</button></div></form></div>;
}

function CreationModal({ language = 'zh-CN', type, groups, wsl, terminalProfiles = {}, initialCommand, onClose, onCreate }) {
  const isGroup = type === 'group';
  const isServer = type === 'server';
  const isEditingCommand = !isGroup && !isServer && Boolean(initialCommand);
  const isZh = language === 'zh-CN';
  const groupOptions = groups.length ? groups.map((group) => ({ value: group.id, label: group.name })) : [{ value: 'local', label: 'Local services' }];
  const initialShell = 'wsl';
  const [form, setForm] = useState(isGroup
    ? { name: '', note: '', accent: 'mint' }
    : isServer
      ? { name: '', label: '', groupId: groupOptions[0].value, port: '', dir: '', shell: initialShell }
      : {
        name: String(initialCommand?.name || ''),
        command: String(initialCommand?.command || ''),
        description: String(initialCommand?.description || ''),
        scope: String(initialCommand?.scope || 'Current selection'),
        tone: commandTones.has(initialCommand?.tone) ? initialCommand.tone : 'mint',
        executionMode: initialCommand?.executionMode === 'paste' ? 'paste' : 'execute',
      });
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const pickDirectory = async () => {
    if (!window.desktop?.selectDirectory) {
      update('dir', defaultShellDirectory(form.shell));
      return;
    }
    setPickingDirectory(true);
    try {
      const result = await window.desktop.selectDirectory(form.shell);
      if (result?.path) update('dir', result.path);
    } finally {
      setPickingDirectory(false);
    }
  };
  const submit = (event) => {
    event.preventDefault();
    onCreate(form);
  };
  const shellOptions = [
    { value: 'wsl', label: 'WSL Ubuntu', disabled: false },
    { value: 'powershell', label: 'Windows PowerShell', disabled: terminalProfiles.powershell === false },
    { value: 'pwsh', label: 'PowerShell 7', disabled: terminalProfiles.pwsh === false },
    { value: 'cmd', label: isZh ? '命令提示符 (CMD)' : 'Command Prompt (CMD)', disabled: terminalProfiles.cmd === false },
  ].map((option) => ({ ...option, label: option.disabled ? `${option.label} (${isZh ? '不可用' : 'Unavailable'})` : option.label }));
  const isWslShell = form.shell === 'wsl';
  const changeShell = (value) => setForm((current) => ({
    ...current,
    shell: value,
    dir: '',
  }));
  const title = isGroup ? (isZh ? '新建服务分组' : 'New service group') : isServer ? (isZh ? '新建终端' : 'New terminal') : isEditingCommand ? (isZh ? '编辑指令' : 'Edit command') : (isZh ? '保存指令' : 'Save command');
  const subtitle = isGroup ? (isZh ? '创建一个用于归类本地终端的分组。' : 'Create a group for related local terminals.') : isServer ? (isZh ? '选择终端类型和工作目录；目录留空时使用该终端的默认目录。' : 'Choose a terminal type and working directory, or leave it blank for the default.') : (isEditingCommand ? (isZh ? '修改指令内容、说明和发送方式。' : 'Update the command, description, and send mode.') : (isZh ? '保存可直接执行或粘贴后补充参数的指令。' : 'Save a command to execute or paste before adding parameters.'));
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="creation-modal" onSubmit={submit}>
      <div className="modal-header"><div><div className="eyebrow">CONFIGURATION</div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div>
      <div className="modal-fields">
        {isGroup && <><Field label="Group name" required value={form.name} onChange={(value) => update('name', value)} placeholder="Example: Survival" /><Field label="Description" value={form.note} onChange={(value) => update('note', value)} placeholder="What belongs in this group?" /><div className="field"><label>Accent</label><div className="swatch-row">{['mint', 'blue', 'amber', 'violet'].map((tone) => <button type="button" key={tone} className={`swatch swatch-${tone} ${form.accent === tone ? 'selected' : ''}`} onClick={() => update('accent', tone)} aria-label={tone} />)}</div></div></>}
        {isServer && <><Field label={isZh ? '终端名称' : 'Terminal name'} required value={form.name} onChange={(value) => update('name', value)} placeholder={isZh ? '例如：开发终端' : 'Example: Development'} /><Field label={isZh ? '终端类型' : 'Terminal type'} required type="select" options={shellOptions} value={form.shell} onChange={changeShell} /><Field label={isZh ? '标签' : 'Label'} value={form.label} onChange={(value) => update('label', value)} placeholder={shellLabel(form.shell, language)} /><div className="field-row"><Field label={isZh ? '分组' : 'Group'} required type="select" options={groupOptions} value={form.groupId} onChange={(value) => update('groupId', value)} /><Field label={isZh ? '服务端口' : 'Service port'} value={form.port} onChange={(value) => update('port', value)} placeholder={isZh ? '可选' : 'Optional'} /></div><div className="field"><label>{isZh ? '工作目录' : 'Working directory'}</label><div className="directory-input"><input value={form.dir} onChange={(event) => update('dir', event.target.value)} placeholder={isWslShell ? (isZh ? '留空使用 /root' : 'Leave blank for /root') : (isZh ? '留空使用 Windows 用户目录' : 'Leave blank for the Windows user directory')} /><button type="button" className="icon-button compact" onClick={pickDirectory} disabled={pickingDirectory} title={isZh ? '选择工作目录' : 'Choose working directory'} aria-label={isZh ? '选择工作目录' : 'Choose working directory'}><FolderOpen size={15} /></button></div><span className="field-hint">{isWslShell ? (wsl?.available ? `${wsl.distro || 'Ubuntu'} ${isZh ? '已连接，默认目录为 /root' : 'connected; default directory is /root'}` : (isZh ? 'WSL 当前不可用，也可以手动输入目录' : 'WSL is unavailable; you can still enter a path manually')) : (isZh ? 'Windows Shell 直接在本机运行，不经过 Ubuntu' : 'Windows shells run locally without Ubuntu')}</span></div></>}
        {!isGroup && !isServer && <><Field label={isZh ? '指令名称' : 'Command name'} required value={form.name} onChange={(value) => update('name', value)} placeholder={isZh ? '例如：提升角色等级' : 'Example: Level up role'} /><Field label={isZh ? '终端指令' : 'Console command'} required mono value={form.command} onChange={(value) => update('command', value)} placeholder="gm level " /><div className="field"><label>{isZh ? '发送方式' : 'Send mode'}</label><div className="scope-options command-mode-options"><button type="button" className={form.executionMode === 'execute' ? 'selected' : ''} onClick={() => update('executionMode', 'execute')}><Play size={14} />{isZh ? '直接执行' : 'Execute'}</button><button type="button" className={form.executionMode === 'paste' ? 'selected' : ''} onClick={() => update('executionMode', 'paste')}><ClipboardPaste size={14} />{isZh ? '粘贴到终端' : 'Paste to terminal'}</button></div><span className="field-hint">{form.executionMode === 'paste' ? (isZh ? '不会发送回车，光标停在指令末尾。' : 'No Enter is sent; the cursor stays at the end.') : (isZh ? '发送后立即回车执行。' : 'Sends Enter and runs immediately.')}</span></div><Field label={isZh ? '说明' : 'Description'} value={form.description} onChange={(value) => update('description', value)} placeholder={isZh ? '这条指令的用途' : 'What does this command do?'} /><div className="field"><label>{isZh ? '适用范围' : 'Scope'}</label><div className="scope-options">{['Current selection', 'All services', 'Single service'].map((scope) => <button type="button" key={scope} className={form.scope === scope ? 'selected' : ''} onClick={() => update('scope', scope)}>{scope}</button>)}</div></div></>}
      </div>
      <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>{isZh ? '取消' : 'Cancel'}</button><button className="button primary" type="submit"><Check size={15} />{isEditingCommand ? (isZh ? '保存修改' : 'Save changes') : (isZh ? '保存' : 'Save')}</button></div>
    </form>
  </div>;
}

function Field({ label, required, value, onChange, placeholder, type = 'text', options = [], mono = false }) {
  return <div className="field"><label>{label}{required && <span>*</span>}</label>{type === 'select' ? <select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option value={option.value} key={option.value} disabled={option.disabled}>{option.label}</option>)}</select> : <input className={mono ? 'mono-field' : ''} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}</div>;
}

export default App;
