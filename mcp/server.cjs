const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const PROJECT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = process.env.NEXUS_CONFIG_PATH || path.join(PROJECT_DIR, 'backend', 'servers.json');
const LOG_DIR = process.env.NEXUS_LOG_DIR || path.join(PROJECT_DIR, 'backend', 'logs');
const BACKEND_HOST = process.env.NEXUS_PTY_HOST || '127.0.0.1';
const BACKEND_PORT = Number(process.env.NEXUS_PTY_PORT || 4317);
const ALLOW_COMMANDS = process.env.NEXUS_MCP_ALLOW_COMMANDS === '1';
const MAX_LOG_CHARS = 2 * 1024 * 1024;
const MAX_CURSOR = Number.MAX_SAFE_INTEGER;
const MAX_TAIL_LINES = 20000;
const MAX_SEARCH_MATCHES = 500;

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
}

function textResult(text, structuredContent) {
  const result = { content: [{ type: 'text', text: String(text) }] };
  if (structuredContent !== undefined) result.structuredContent = structuredContent;
  return result;
}

function toolError(message, structuredContent) {
  const result = textResult(message, structuredContent);
  result.isError = true;
  return result;
}

function readJsonConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${CONFIG_PATH}: ${error.message}`);
  }
}

function listServers() {
  const config = readJsonConfig();
  const groups = Array.isArray(config.groups) ? config.groups : [];
  return groups.flatMap((group) => (Array.isArray(group.servers) ? group.servers : []).map((server) => ({
    id: String(server.id || ''),
    name: String(server.name || server.id || ''),
    groupId: String(group.id || ''),
    groupName: String(group.name || group.id || ''),
    cwd: String(server.cwd || server.dir || '/root'),
    session: String(server.session || `nexus-${safeId(server.id)}`),
    port: server.port ? String(server.port) : '',
    logFile: path.join(LOG_DIR, `${safeId(server.id)}.log`),
  })));
}

function findServer(serverId) {
  const server = listServers().find((item) => item.id === String(serverId));
  if (!server) throw new Error(`unknown server: ${serverId}`);
  return server;
}

function logPath(serverId) {
  return path.join(LOG_DIR, `${safeId(serverId)}.log`);
}

function readLog(serverId) {
  try {
    const value = fs.readFileSync(logPath(serverId), 'utf8');
    return value.length > MAX_LOG_CHARS ? value.slice(-MAX_LOG_CHARS) : value;
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function stripTerminalControls(value) {
  return String(value || '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function logLines(value) {
  return stripTerminalControls(value).split('\n');
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function requestBackend(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const request = http.request({
      host: BACKEND_HOST,
      port: BACKEND_PORT,
      path: endpoint,
      method: options.method || 'GET',
      timeout: options.timeout || 5000,
      headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : undefined,
    }, (response) => {
      let output = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { output += chunk; });
      response.on('end', () => {
        let value = output;
        try { value = output ? JSON.parse(output) : {}; } catch { /* preserve text response */ }
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(value?.error || `backend HTTP ${response.statusCode}`));
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

const toolDefinitions = [
  {
    name: 'list_terminals',
    description: 'List configured local WSL terminals, tmux sessions, ports, and log file paths.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'read_terminal_log',
    description: 'Read recent output saved for one local terminal. Output is cleaned of ANSI control sequences and includes line numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'Terminal id from list_terminals.' },
        tailLines: { type: 'integer', minimum: 1, maximum: MAX_TAIL_LINES, default: 200, description: 'Number of lines from the end to return.' },
      },
      required: ['serverId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'search_terminal_log',
    description: 'Search saved output across all terminals or one terminal, with surrounding context lines.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive text to find.' },
        serverId: { type: 'string', description: 'Optional terminal id.' },
        contextLines: { type: 'integer', minimum: 0, maximum: 20, default: 3 },
        maxMatches: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_MATCHES, default: 100 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'watch_terminal_log',
    description: 'Wait for new saved output from a terminal. Pass the returned cursor on the next call for incremental reads.',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' },
        cursor: { type: 'integer', minimum: 0, maximum: MAX_CURSOR, default: 0, description: 'Log file byte offset returned by a previous call.' },
        waitMs: { type: 'integer', minimum: 0, maximum: 30000, default: 0 },
        maxChars: { type: 'integer', minimum: 1, maximum: MAX_LOG_CHARS, default: 12000 },
      },
      required: ['serverId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'send_terminal_command',
    description: 'Send a command to a local WSL terminal through Nexus. The MCP server must be started with NEXUS_MCP_ALLOW_COMMANDS=1 and confirm=true; otherwise it only returns a preview.',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' },
        command: { type: 'string', description: 'Command to send to the terminal.' },
        confirm: { type: 'boolean', description: 'Must be true to execute the command.' },
      },
      required: ['serverId', 'command', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
];

function logSize(serverId) {
  try {
    return fs.statSync(logPath(serverId)).size;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

function readLogFromOffset(serverId, requestedCursor, maxBytes) {
  const file = logPath(serverId);
  const size = logSize(serverId);
  let cursor = requestedCursor > size ? 0 : requestedCursor;
  if (cursor === 0 && size > maxBytes) cursor = size - maxBytes;
  const length = Math.min(maxBytes, Math.max(0, size - cursor));
  if (!length) return { output: '', cursor: size, reset: requestedCursor > size };
  const descriptor = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(descriptor, buffer, 0, length, cursor);
    return { output: buffer.subarray(0, bytesRead).toString('utf8'), cursor: cursor + bytesRead, reset: requestedCursor > size };
  } finally {
    fs.closeSync(descriptor);
  }
}

async function waitForNewLog(serverId, cursor, waitMs) {
  const deadline = Date.now() + waitMs;
  while (true) {
    const size = logSize(serverId);
    if (size !== cursor || Date.now() >= deadline) return size;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))));
  }
}

async function callTool(name, args = {}) {
  if (name === 'list_terminals') {
    let health = null;
    try { health = await requestBackend('/health'); } catch { /* backend status is optional for listing */ }
    const terminals = listServers().map((server) => ({ ...server, backend: health?.ok === true ? 'connected' : 'offline' }));
    return textResult(JSON.stringify({ terminals, backend: health }, null, 2), { terminals, backend: health });
  }

  if (name === 'read_terminal_log') {
    const server = findServer(args.serverId);
    const lines = logLines(readLog(server.id));
    const tailLines = clampInteger(args.tailLines, 200, 1, MAX_TAIL_LINES);
    const start = Math.max(0, lines.length - tailLines);
    const output = lines.slice(start).map((line, index) => `${start + index + 1}: ${line}`).join('\n');
    const result = { serverId: server.id, serverName: server.name, logFile: server.logFile, startLine: start + 1, endLine: lines.length, lines: lines.slice(start) };
    return textResult(output || '(no saved output)', result);
  }

  if (name === 'search_terminal_log') {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('query cannot be empty');
    const requested = args.serverId ? [findServer(args.serverId)] : listServers();
    const contextLines = clampInteger(args.contextLines, 3, 0, 20);
    const maxMatches = clampInteger(args.maxMatches, 100, 1, MAX_SEARCH_MATCHES);
    const needle = query.toLocaleLowerCase();
    const matches = [];
    for (const server of requested) {
      const lines = logLines(readLog(server.id));
      lines.forEach((line, index) => {
        if (!line.toLocaleLowerCase().includes(needle) || matches.length >= maxMatches) return;
        const start = Math.max(0, index - contextLines);
        const end = Math.min(lines.length, index + contextLines + 1);
        matches.push({ serverId: server.id, serverName: server.name, groupName: server.groupName, lineNumber: index + 1, match: line, context: lines.slice(start, end).map((value, offset) => ({ lineNumber: start + offset + 1, line: value })) });
      });
      if (matches.length >= maxMatches) break;
    }
    const output = matches.map((item) => [`[${item.serverName} · line ${item.lineNumber}] ${item.match}`, ...item.context.map((line) => `  ${line.lineNumber}: ${line.line}`)].join('\n')).join('\n\n');
    return textResult(output || '(no matches)', { query, matches, truncated: matches.length >= maxMatches });
  }

  if (name === 'watch_terminal_log') {
    const server = findServer(args.serverId);
    const cursor = clampInteger(args.cursor, 0, 0, MAX_CURSOR);
    const waitMs = clampInteger(args.waitMs, 0, 0, 30000);
    const maxChars = clampInteger(args.maxChars, 12000, 1, MAX_LOG_CHARS);
    await waitForNewLog(server.id, cursor, waitMs);
    const next = readLogFromOffset(server.id, cursor, maxChars);
    const output = stripTerminalControls(next.output);
    return textResult(output || '(no new output)', { serverId: server.id, cursor: next.cursor, changed: Boolean(output) || next.reset, reset: next.reset, output });
  }

  if (name === 'send_terminal_command') {
    const server = findServer(args.serverId);
    const command = String(args.command || '').trim();
    if (!command) throw new Error('command cannot be empty');
    if (!ALLOW_COMMANDS || args.confirm !== true) {
      const preview = { serverId: server.id, serverName: server.name, command, executed: false, confirmationRequired: true, commandAccessEnabled: ALLOW_COMMANDS };
      return textResult(JSON.stringify(preview, null, 2), preview);
    }
    const result = await requestBackend('/api/commands/dispatch', { method: 'POST', body: { serverIds: [server.id], command }, timeout: 10000 });
    return textResult(JSON.stringify(result, null, 2), result);
  }

  throw new Error(`unknown tool: ${name}`);
}

const mcpServer = new Server(
  { name: 'nexus-local', version: '0.1.0' },
  {
    capabilities: { tools: { listChanged: false } },
    instructions: 'Use read-only log tools to inspect local WSL terminals. Command execution is disabled unless the user enables it and confirm=true.',
  },
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return await callTool(String(request.params?.name || ''), request.params?.arguments || {});
  } catch (error) {
    return toolError(error.message);
  }
});

const transport = new StdioServerTransport();
mcpServer.connect(transport).catch((error) => {
  process.stderr.write(`[mcp] failed to start: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
