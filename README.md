# Nexus Control

本地 WSL 服务管理器，使用 Electron + React + xterm.js 管理 Ubuntu 中的 tmux 服务会话。

## 当前能力

- 左侧服务会话列表，右侧真实 xterm.js PTY。
- Tab 补全、方向键历史、Ctrl+C、ANSI 输出、窗口尺寸同步。
- 每个服务绑定一个持久 tmux 会话，终端断线后自动重连。
- 分组勾选和同步广播命令。
- 指令库页面，以及终端页的当前服务指令工具栏。
- 可视化顺序编排：服务动作、命令、等待、日志关键字、重试和超时。
- 一次性、间隔和 Cron 定时任务。窗口最小化时继续运行，退出应用后停止调度。
- 每个服务只保留最近一次启动日志，日志页支持跨服务搜索。
- WSL 后端不可用时保留本地预览终端。
- 本地 MCP Server，可供 Agent 读取终端列表、历史日志、日志搜索和增量输出；发送命令需要显式确认。
- 指令库支持版本化 JSON 导入导出，可与其他 Nexus 用户分享；导入采用合并模式并跳过完全重复项。

## 首次准备

应用不会修改系统 Node、apt、WSL、Windows Terminal 或注册表。WSL 后端使用项目的 `backend/.runtime` Node 运行时和 `backend/node_modules` 依赖；这些目录都属于项目本身。本开发环境已经准备好它们。

如果需要手动准备 WSL 后端，可以执行：

```bash
cd /mnt/e/airtest/terminal_maneger/backend
export PATH="$PWD/.runtime/node-v16.20.2-linux-x64/bin:$PATH"
npm install --omit=dev
cp servers.example.json servers.json
```

`servers.json` 是正式配置文件。没有该文件时，后端只读加载 `servers.example.json` 作为演示配置；应用首次连接后会将当前配置写入项目内的正式文件。

服务配置使用 WSL 路径，例如 `/srv/minecraft/survival-main`。`startCommand`、`stopCommand` 和 `ready` 条件按服务实际脚本填写。

## 启动

开发网页：

```powershell
npm.cmd run web
```

开发 Electron：

```powershell
npm.cmd run dev
```

Electron 会读取 Windows Terminal 的默认 WSL profile，并自动启动项目内的 WSL 后端，不需要手动打开 PowerShell 或 Windows Terminal。

构建检查：

```powershell
npm.cmd run build
```

后端只监听 `127.0.0.1:4317`，主要接口包括：

- `GET /health`
- `GET/PUT /api/config`
- `POST /api/servers/:id/action`
- `POST /api/commands/dispatch`
- `POST /api/workflows/:id/run`
- `GET /api/runs/:runId`
- `GET /api/logs`
- `GET/POST/PUT /api/schedules` and `PATCH/DELETE /api/schedules/:id`
- `WS /terminal/:serverId`

## Agent / MCP 接入

完整的源码版、正式安装版接入步骤和常见问题见 [帮助与文档](docs/帮助与文档.md)。

项目内置只使用标准输入输出通信的本地 MCP Server，不监听额外网络端口，也不会修改系统配置。先启动 Electron 应用，再在支持 MCP 的 Agent 配置中添加：

```powershell
codex.cmd mcp add nexus-local -- node E:/airtest/terminal_maneger/mcp/server.cjs
```

对应的手动配置为：

```toml
[mcp_servers.nexus-local]
command = "node"
args = ["E:/airtest/terminal_maneger/mcp/server.cjs"]
```

也可以手动运行 `npm.cmd run mcp` 验证进程。提供的工具包括：

- `list_terminals`：列出本地 WSL 终端和日志路径。
- `read_terminal_log`：读取指定终端最近输出。
- `search_terminal_log`：跨终端搜索日志并返回上下文。
- `watch_terminal_log`：按 cursor 等待增量日志。
- `send_terminal_command`：向终端发送命令；默认只返回预览。

MCP 默认是只读模式。确实需要 Agent 发送命令时，由用户在 MCP 配置中显式加入环境变量，并且每次工具调用仍需传入 `confirm: true`：

```toml
[mcp_servers.nexus-local.env]
NEXUS_MCP_ALLOW_COMMANDS = "1"
```

日志读取默认使用 `backend/logs/<serverId>.log`。云端 Agent 使用这些工具时，日志内容会发送到对应的模型服务，请按日志敏感性决定是否启用。

## 指令库分享

在“指令库”页面使用“导入命令库”和“导出命令库”。导出文件只包含指令名称、命令内容、说明、发送方式、作用范围和色调，不包含终端、分组、服务目录、执行次数或其他本地配置。导入时会合并到现有指令库，完全重复的指令自动跳过，导入指令的执行次数从零开始。

## Terminal configuration

The example configuration starts with no services. Create a terminal from the UI, choose a WSL directory, or leave the directory blank to use `/root`.

`npm.cmd run web` starts only the Vite preview and intentionally keeps the local preview mode. Use Electron (`npm.cmd run dev`) for the managed WSL backend, or run `npm.cmd run dev:full` when you need the browser plus a manually managed backend.

If a Vite server is already listening on port 5173, keep using that page and start the backend separately with `npm.cmd run backend`.

When `servers.json` is edited outside the app, the running backend detects the file change. Use the refresh icon in the top bar or reload the page to apply it.
