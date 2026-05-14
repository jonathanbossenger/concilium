# Configuring your agents

Open **Settings (⚙)** to configure agents.

## Add an agent manually

For each agent, provide:

- `id` — a unique machine-safe ID
- `name` — the label shown in the UI
- `command` — the executable on your `$PATH`
- `args` (optional) — array of additional CLI args
- `interactive` — whether the process should stay open for follow-up input

## Discover agents automatically

Use **Discover** in settings to scan `$PATH` for known CLIs and add them with
one click.

## Edit or remove agents

You can update any field for an existing agent, or remove agents you no longer
need.

## Interactive vs one-shot behavior

- `interactive: false` → stdin is piped in and then closed (one-shot mode).
- `interactive: true` → process is spawned under a PTY and stays alive for
  follow-up input.
