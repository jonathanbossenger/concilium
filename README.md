# agent-dashboard

A simple, locally-installed multi-agent orchestration dashboard. Configure CLI
AI agents you have on your machine (Claude Code, Codex, Aider, Gemini, Copilot,
Ollama, …), fire off tasks, watch live output, and keep a history — from a
loopback web UI. Easy to start, stop, and restart, like Apache.

## Features

- **Card-based session UI** — each card is an independent agent session with
  its own selector, working directory, prompt, output, and (for interactive
  agents) input line. Add cards with **+ New session**, close them when done.
  Each card has a **Browse…** button that opens the OS folder picker for the
  working directory, plus an expand/collapse toggle (**⤢**) that zooms a
  single card to fill the main area, with a smooth View Transitions
  animation between states.
- **Two execution modes** — piped stdin for one-shot tools, PTY (via `node-pty`)
  for interactive REPL-style agents
- **Real terminal in the browser** — each card embeds an
  [xterm.js](https://xtermjs.org/) terminal. ANSI/colors/cursor moves render
  natively, keystrokes go straight to the agent's stdin, and a
  `ResizeObserver` + the fit addon drive a resize handshake to the PTY so
  TUIs reflow correctly when you expand a card or resize the window.
- **Live streaming** of stdout/stderr to the browser via Server-Sent Events
- **Persistent history** in SQLite, plus per-task plain-text logs under
  `~/.agent-dashboard/logs/`. Closing a card kills any running task and
  deletes that session's tasks + logs.
- **Light / dark / auto theme** — defaults to your OS preference
  (`prefers-color-scheme`); the **Auto** button in the header cycles to
  Light or Dark and persists in `localStorage`.
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

Open <http://127.0.0.1:7878> after starting. The page boots with one empty
session card; click **+ New session** to add more, or the **×** on a card
to close it (kills any running task in that card and deletes its history).

Header controls:

- **+ New session** — adds another card.
- **Auto / Light / Dark** — cycles theme; defaults to your OS preference.
- **Gear (⚙)** — opens a settings dialog where you can:
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
| `DELETE` | `/api/tasks/:id` | remove task (kills first if live), drops events + log file |
| `POST`   | `/api/tasks/:id/kill` | SIGTERM the running task |
| `POST`   | `/api/tasks/:id/input` | send stdin to interactive task `{data}` |
| `POST`   | `/api/tasks/:id/resize` | resize the PTY `{cols, rows}` (PTY mode only) |
| `GET`    | `/api/stream/:id` | SSE: replays past events then streams live |
| `POST`   | `/api/system/pick-directory` | open the OS folder picker, returns `{path}` |

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
        ├── stream.js
        └── system.js           # native OS folder picker
```

Runtime dependencies: `express`, `better-sqlite3`, `js-yaml`, `node-pty`,
`@xterm/xterm`, `@xterm/addon-fit` (the latter two are served straight from
`node_modules` via static mounts at `/vendor/xterm` and
`/vendor/xterm-addon-fit` — no bundler).

## License

MIT
