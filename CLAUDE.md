# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no build step, no linter, and no test suite. The frontend is hand-written HTML/CSS/JS served as static files.

- `npm install` — installs the four runtime deps. Triggers `scripts/fix-pty-perms.js`, which restores the executable bit on `node-pty`'s `spawn-helper` (npm strips it; without this, PTY spawns fail with `posix_spawnp failed.`).
- `npm start` — runs `node server/index.js` in the foreground (useful when iterating; no daemonization).
- `./bin/agentctl start | stop | restart | status | logs` — Apache-style lifecycle. `start` writes a PID file to `~/.agent-dashboard/run.pid` and logs to `~/.agent-dashboard/server.log`. After `agentctl install`, the same commands drive a launchd agent (macOS) or `systemd --user` unit (Linux) instead of the standalone PID-file path; `agentctl status` reports which mode is active.
- Restart after editing `~/.agent-dashboard/config.yaml` by hand — `getConfig()` is process-cached. Edits made through the web UI bypass the cache via `saveConfig()` and take effect immediately.

The server only listens on `127.0.0.1`. Port comes from `config.yaml` (default 7878).

## Architecture

### Module load order matters

`server/index.js` calls `ensureState()` from `config.js` *before* requiring any route module. This is load-bearing: `store.js` opens the SQLite database at module-load time using `STATE_DIR` from `config.js`, so the state directory must exist first. If you add a new route module that pulls in `store.js` (directly or transitively), require it after `ensureState()` like the existing routes do.

### Two execution modes per agent

`runner.js` dispatches on `agent.interactive`:

- `false` → `child_process.spawn`, prompt is written to stdin, stdin is then closed. One-shot.
- `true` → `node-pty` spawn, prompt is written but the PTY stays open for follow-up `write()` calls. Used for REPL-style agents.

`runner.js` exposes a uniform `EventEmitter` interface (`event`, `end`, `kill()`, `write()`) so `manager.js` doesn't branch on mode. In PTY mode, stdout and stderr are merged by the kernel — everything is reported as `stream: 'stdout'`.

### Live tasks vs. historical tasks

`manager.js` keeps a `Map<task_id, { broadcast, runner, logStream }>` of currently-running tasks. Every event from the runner is fanned out to three places **synchronously in this order**: (1) SQLite via `store.appendEvent`, (2) the per-task plain-text log file under `~/.agent-dashboard/logs/<id>.log`, (3) the in-process `broadcast` EventEmitter that SSE subscribers listen on.

This ordering is the invariant that makes the SSE replay work without gaps or duplicates. See `server/routes/stream.js`: a new SSE client first attaches its listener to `broadcast`, *then* reads past events from the DB. Because step (1) (DB write) completes before step (3) (broadcast) for every event, the DB snapshot at subscribe-time covers exactly the events that fired before the subscription — no overlap with the live stream that follows. Don't reorder these emits.

When a task ends, `manager.js` deletes the entry from `live`. SSE subscribers that connect after that fall through to the "task already finished — replay from DB and close" path in `stream.js`.

### Boot-time crash recovery

`store.js` runs `UPDATE tasks SET status = 'crashed' WHERE status = 'running'` on every module load. This cleans up any tasks the previous server process left mid-run. If you add new terminal statuses, treat `running` as the only "still alive" sentinel.

### Card-based frontend

`public/app.js` has one `Card` class; each card owns its own task lifecycle (agent select, cwd, prompt, run/kill, output pre, optional input line). `cards` is a `Set<Card>` so events like agent-list refreshes can iterate. Closing a card calls `DELETE /api/tasks/:id` for every task it ever launched, which kills any still-running task and drops its events + log file. There is no React, no bundler, no transpilation — edit the files in `public/` and reload.

ANSI escape codes are stripped client-side (`stripAnsi` in `app.js`). The PTY runs at fixed 120×30; there is no resize handshake, so wide output relies on terminal-side wrapping.

### Configuration & discovery

`config.js` owns `~/.agent-dashboard/` (state dir, config path, log dir constants). `discover.js` has a hardcoded `KNOWN` list of CLI agents and `which()`-style scans `$PATH` for them — used by the settings UI's "Discover" panel. The same list seeds defaults in `config.js`. When adding a known agent, update both `KNOWN` in `discover.js` and the default in `config.js` so the bundled defaults and discovery suggestions stay in sync.

### Service install flow

`agentctl install` reads `install/com.user.agent-dashboard.plist.tmpl` (macOS) or `install/agent-dashboard.service.tmpl` (Linux) and substitutes `@NODE_BIN@`, `@PROJECT_ROOT@`, `@LOG_FILE@`, `@USER_PATH@`. Baking the user's current `$PATH` into the service definition is intentional — it lets the daemon find agents installed via Homebrew, nvm, etc. when launched by launchd/systemd outside an interactive shell.
