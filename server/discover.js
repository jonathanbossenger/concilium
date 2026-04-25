const fs = require('fs');
const path = require('path');

// Known CLI agents we can suggest. `interactive: true` means we should default
// to PTY mode (the tool runs a long-lived REPL); `interactive: false` means
// piped stdin (one-shot prompt → output).
const KNOWN = [
  { id: 'claude',  name: 'Claude Code',        command: 'claude',       interactive: false },
  { id: 'codex',   name: 'Codex CLI',          command: 'codex',        interactive: true  },
  { id: 'aider',   name: 'Aider',              command: 'aider',        interactive: true  },
  { id: 'gemini',  name: 'Gemini CLI',         command: 'gemini',       interactive: false },
  { id: 'copilot', name: 'GitHub Copilot CLI', command: 'copilot',      interactive: true  },
  { id: 'ollama',  name: 'Ollama',             command: 'ollama',       interactive: false },
  { id: 'cursor',  name: 'Cursor CLI',         command: 'cursor-agent', interactive: true  },
];

function which(cmd) {
  const paths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const p of paths) {
    const candidate = path.join(p, cmd);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111)) return candidate;
    } catch (_) { /* missing — try next */ }
  }
  return null;
}

function discover() {
  return KNOWN.map((a) => ({ ...a, found: which(a.command) }));
}

module.exports = { discover, which, KNOWN };
