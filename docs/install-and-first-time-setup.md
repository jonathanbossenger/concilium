# Install and first-time setup

## Install

```bash
git clone git@github.com:jonathanbossenger/concilium.git
cd concilium
npm install
```

PowerShell works too:

```powershell
git clone https://github.com/jonathanbossenger/concilium.git
Set-Location concilium
npm install
```

The `postinstall` step restores the executable bit on `node-pty`'s
`spawn-helper` (npm strips it during install — without this, PTY spawns fail
with `posix_spawnp failed.`).

To get `conciliumctl` available in your terminal (`npm link` generates
cross-platform command shims, including PowerShell):

```bash
npm link
```

## First-time setup checklist

1. Start Concilium:
   ```bash
   conciliumctl start
   ```
2. Confirm it's running:
   ```bash
   conciliumctl status
   ```
3. Open <http://127.0.0.1:7878>.
4. In **Settings (⚙)**, [configure at least one agent](configuring-agents.md).
5. If you want GitHub features (New Project, higher API limits), [add a GitHub token](github-token.md).
