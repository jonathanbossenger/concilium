# Using Concilium

## Quick start

1. Click **+ New session**.
2. Select an agent.
3. Set the working directory (📂 or type/paste a path).
4. Enter your prompt and click **▶** to start.

Use **>_** to open a side terminal in the same working directory.

## Running Concilium

### Standalone

```bash
conciliumctl start         # daemonizes node, writes PID file
conciliumctl status
conciliumctl restart
conciliumctl stop
conciliumctl logs          # follow the server log
```

### As a user service (auto-start on login)

```bash
conciliumctl install       # writes launchd plist or systemd --user unit
conciliumctl status        # mode: service
conciliumctl uninstall
```

The install step bakes the absolute path to `node`, the project root, and your
current `$PATH` into the service definition, so the dashboard can find agents
installed via Homebrew, nvm, etc.

On Windows, `conciliumctl start|stop|restart|status|logs` work in standalone
mode from PowerShell, but `install`/`uninstall` are not supported yet.

## Web UI

Open <http://127.0.0.1:7878> after starting. The page boots with one empty
session card; click **+ New session** to add more, or **×** on a card to close
it (kills any running task in that card and deletes its history).

Header controls:

- **+ New session** — adds another card.
- **⧉** — opens a **New Project** dialog. Concilium validates the project name
  against GitHub using your saved token, then creates a new repository (public
  by default, with an optional private toggle) with an initialized README,
  clones it into your selected target location, and opens a new session card
  with that directory pre-filled.
- **🖥 / ☀ / ☾** — cycles theme (auto/light/dark); defaults to your OS preference.
- **Gear (⚙)** — opens settings to manage agents and your optional GitHub token.
- **⌨** — opens the keyboard shortcuts help dialog.

![Concilium settings dialog screenshot](../screenshots/settings.png)

## Keyboard shortcuts

Global shortcuts use **Cmd/Ctrl + Alt + key**. They are ignored while typing in
inputs, textareas, selects, contenteditable fields, or terminal input.

- **Cmd/Ctrl + Alt + N** — New session
- **Cmd/Ctrl + Alt + R** — Start/Kill active session
- **Cmd/Ctrl + Alt + `** — Open terminal for active session
- **Cmd/Ctrl + Alt + E** — Expand/collapse active card
- **Cmd/Ctrl + Alt + P** — New project
- **Cmd/Ctrl + Alt + S** — Open settings
- **Cmd/Ctrl + Alt + T** — Cycle theme
- **Cmd/Ctrl + Alt + /** — Show keyboard shortcuts
