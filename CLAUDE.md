# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no build step, no linter, and no test suite. The frontend is hand-written HTML/CSS/JS served as static files.

- `npm install` — installs the runtime deps (`express`, `better-sqlite3`, `js-yaml`, `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`). Triggers `scripts/fix-pty-perms.js`, which restores the executable bit on `node-pty`'s `spawn-helper` (npm strips it; without this, PTY spawns fail with `posix_spawnp failed.`). The xterm packages are served straight from `node_modules` via two static mounts in `server/index.js` (`/vendor/xterm`, `/vendor/xterm-addon-fit`) — no bundler.
- `npm start` — runs `node server/index.js` in the foreground (useful when iterating; no daemonization).
- `./bin/agentctl start | stop | restart | status | logs` — Apache-style lifecycle. `start` writes a PID file to `~/.concilium/run.pid` and logs to `~/.concilium/server.log`. After `agentctl install`, the same commands drive a launchd agent (macOS) or `systemd --user` unit (Linux) instead of the standalone PID-file path; `agentctl status` reports which mode is active.
- Restart after editing `~/.concilium/config.yaml` by hand — `getConfig()` is process-cached. Edits made through the web UI bypass the cache via `saveConfig()` and take effect immediately.

The server only listens on `127.0.0.1`. Port comes from `config.yaml` (default 7878).

## Architecture

### Module load order matters

`server/index.js` calls `ensureState()` from `config.js` *before* requiring any route module. This is load-bearing: `store.js` opens the SQLite database at module-load time using `STATE_DIR` from `config.js`, so the state directory must exist first. If you add a new route module that pulls in `store.js` (directly or transitively), require it after `ensureState()` like the existing routes do.

### Two execution modes per agent

`runner.js` dispatches on `agent.interactive`:

- `false` → `child_process.spawn`, prompt is written to stdin, stdin is then closed. One-shot.
- `true` → `node-pty` spawn, prompt is written but the PTY stays open for follow-up `write()` calls. Used for REPL-style agents.

`runner.js` exposes a uniform `EventEmitter` interface (`event`, `end`, `kill()`, `write()`, `resize(cols, rows)`) so `manager.js` doesn't branch on mode. `write` and `resize` are no-ops (return `false`) in piped mode — only the PTY emitter actually drives them. In PTY mode, stdout and stderr are merged by the kernel — everything is reported as `stream: 'stdout'`.

### Live tasks vs. historical tasks

`manager.js` keeps a `Map<task_id, { broadcast, runner, logStream }>` of currently-running tasks. Every event from the runner is fanned out to three places **synchronously in this order**: (1) SQLite via `store.appendEvent`, (2) the per-task plain-text log file under `~/.concilium/logs/<id>.log`, (3) the in-process `broadcast` EventEmitter that SSE subscribers listen on.

This ordering is the invariant that makes the SSE replay work without gaps or duplicates. See `server/routes/stream.js`: a new SSE client first attaches its listener to `broadcast`, *then* reads past events from the DB. Because step (1) (DB write) completes before step (3) (broadcast) for every event, the DB snapshot at subscribe-time covers exactly the events that fired before the subscription — no overlap with the live stream that follows. Don't reorder these emits.

When a task ends, `manager.js` deletes the entry from `live`. SSE subscribers that connect after that fall through to the "task already finished — replay from DB and close" path in `stream.js`.

### Boot-time crash recovery

`store.js` runs `UPDATE tasks SET status = 'crashed' WHERE status = 'running'` on every module load. This cleans up any tasks the previous server process left mid-run. If you add new terminal statuses, treat `running` as the only "still alive" sentinel.

### Card-based frontend

`public/app.js` has one `Card` class; each card owns its own task lifecycle (agent select, cwd, Start/Kill, and an embedded xterm.js terminal that is both the output surface and the input surface). `cards` is a `Set<Card>` so events like agent-list refreshes and theme changes can iterate. Closing a card calls `DELETE /api/tasks/:id` for every task it ever launched, which kills any still-running task and drops its events + log file. This delete cascade applies to tasks restored from a saved layout as well — closing a card permanently removes all history for those tasks. There is no React, no bundler, no transpilation — edit the files in `public/` and reload.

`Card.initTerminal()` must run **after** the card element is appended to the DOM so `FitAddon` can measure the container; `addCard()` enforces this ordering. A `ResizeObserver` on the terminal container drives `fitAddon.fit()` and `POST /api/tasks/:id/resize` whenever the rendered cols/rows change (e.g. on expand/collapse or window resize).

The SSE handler in `attach()` deliberately **skips events with `stream === 'stdin'`** — the PTY echoes user input back as stdout, so rendering stdin would double-print every keystroke. The DB still records stdin events (for history fidelity); we just don't render them.

The terminal theme is sourced from CSS custom properties (`--term-bg`, `--term-fg`, `--term-cursor`, `--term-selection`) so it tracks the existing Auto/Light/Dark cycler and OS `prefers-color-scheme` flips. xterm.css hardcodes `#000` on `.xterm-viewport`; `style.css` overrides it to `var(--term-bg)` so light mode doesn't bleed black.

### Configuration & discovery

`config.js` owns `~/.concilium/` (state dir, config path, log dir constants). `discover.js` has a hardcoded `KNOWN` list of CLI agents and `which()`-style scans `$PATH` for them — used by the settings UI's "Discover" panel. The same list seeds defaults in `config.js`. When adding a known agent, update both `KNOWN` in `discover.js` and the default in `config.js` so the bundled defaults and discovery suggestions stay in sync.

### Service install flow

`agentctl install` reads `install/com.user.concilium.plist.tmpl` (macOS) or `install/concilium.service.tmpl` (Linux) and substitutes `@NODE_BIN@`, `@PROJECT_ROOT@`, `@LOG_FILE@`, `@USER_PATH@`. Baking the user's current `$PATH` into the service definition is intentional — it lets the daemon find agents installed via Homebrew, nvm, etc. when launched by launchd/systemd outside an interactive shell.
