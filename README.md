# agent-dashboard

A simple, locally-installed multi-agent orchestration dashboard. Configure CLI
AI agents you have on your machine (Claude Code, Codex, Aider, Gemini, Copilot,
Ollama, …), fire off tasks, watch live output, and keep a history — from a
loopback web UI. Easy to start, stop, and restart, like Apache.

## Features

- **Two execution modes** — piped stdin for one-shot tools, PTY (via `node-pty`)
  for interactive REPL-style agents
- **Live streaming** of stdout/stderr to the browser via Server-Sent Events
- **Persistent history** in SQLite, plus per-task plain-text logs under
  `~/.agent-dashboard/logs/`
- **Apache-style lifecycle** — `agentctl start | stop | restart | status`,
  with optional install as a launchd or systemd `--user` service
- **PATH-based agent discovery** — scans `$PATH` for known CLIs and lets you
  add them with one click
- **Vanilla web UI** — no framework, no build step, just HTML/CSS/JS
- **Loopback only** (`127.0.0.1`) — single-user, no auth

## Requirements

- Node.js 18+ (tested on 24)
- macOS or Linux
- A C toolchain only if `node-pty`'s prebuilt binaries aren't available for
  your platform; on macOS arm64/x64 and Linux x64/arm64 the prebuilds are used

## Install

```bash
git clone git@github.com:jonathanbossenger/agent-dashboard.git
cd agent-dashboard
npm install
```

The `postinstall` step restores the executable bit on
`node-pty`'s `spawn-helper` (npm strips it during install — without this,
PTY spawns fail with `posix_spawnp failed.`).

To get `agentctl` on your `$PATH`:

```bash
npm link
```

## Usage

### Standalone

```bash
./bin/agentctl start         # daemonizes node, writes PID file
./bin/agentctl status
./bin/agentctl restart
./bin/agentctl stop
./bin/agentctl logs          # tail -f the server log
```

### As a user service (auto-start on login)

```bash
./bin/agentctl install       # writes launchd plist or systemd --user unit
./bin/agentctl status        # mode: service
./bin/agentctl uninstall
```

The install step bakes the absolute path to `node`, the project root, and
your current `$PATH` into the service definition, so the dashboard can find
agents installed via Homebrew, nvm, etc.

### Web UI

Open <http://127.0.0.1:7878> after starting. The gear icon (top-right) opens
a settings dialog where you can:

- Add, edit, or delete agents
- Scan `$PATH` for known CLI agents and add the ones found

## Configuration

State lives entirely under `~/.agent-dashboard/`:

```
~/.agent-dashboard/
├── config.yaml      # port + agent list (editable by hand or via the UI)
├── tasks.db         # SQLite history
├── logs/<id>.log    # per-task plain-text output log
├── server.log       # the server's own stdout/stderr
└── run.pid          # standalone-mode PID file
```

A minimal `config.yaml`:

```yaml
port: 7878
agents:
  - id: claude
    name: Claude Code
    command: claude
    interactive: false
  - id: aider
    name: Aider
    command: aider
    interactive: true
    args: ["--no-pretty"]
```

`interactive: false` → stdin is piped in, then closed (one-shot).
`interactive: true` → spawned under a PTY; stays alive for follow-up input.

Edits via the UI take effect immediately. Editing the YAML by hand requires
a restart (`agentctl restart`).

## API

All endpoints are JSON; loopback only.

| Method | Path | Description |
|---|---|---|
| `GET`    | `/api/health` | server pid, uptime |
| `GET`    | `/api/agents` | list configured agents |
| `POST`   | `/api/agents` | create agent `{id, name, command, args?, interactive}` |
| `PATCH`  | `/api/agents/:id` | update fields |
| `DELETE` | `/api/agents/:id` | remove |
| `GET`    | `/api/agents/discover` | scan `$PATH` for known CLIs |
| `GET`    | `/api/tasks` | task history (newest first) |
| `POST`   | `/api/tasks` | start task `{agent_id, prompt?, cwd?}` → `{task_id}` |
| `GET`    | `/api/tasks/:id` | task + all events |
| `POST`   | `/api/tasks/:id/kill` | SIGTERM the running task |
| `POST`   | `/api/tasks/:id/input` | send stdin to interactive task `{data}` |
| `GET`    | `/api/stream/:id` | SSE: replays past events then streams live |

## Project layout

```
agent-dashboard/
├── bin/agentctl                # lifecycle CLI
├── install/                    # launchd & systemd templates
├── public/                     # vanilla HTML/CSS/JS UI
├── scripts/fix-pty-perms.js    # postinstall fixup
└── server/
    ├── index.js                # Express entry
    ├── config.js               # YAML load/save (atomic)
    ├── discover.js             # PATH scan
    ├── runner.js               # spawn vs. PTY
    ├── manager.js              # live task registry, broadcast
    ├── store.js                # SQLite (tasks + events)
    └── routes/
        ├── agents.js
        ├── tasks.js
        └── stream.js
```

Four runtime dependencies: `express`, `better-sqlite3`, `js-yaml`, `node-pty`.

## License

MIT
