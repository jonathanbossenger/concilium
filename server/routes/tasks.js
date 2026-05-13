const express = require('express');
const { spawnSync } = require('child_process');
const { getConfig } = require('../config');
const manager = require('../manager');
const store = require('../store');

const router = express.Router();
const commandExistsCache = new Map();
let windowsTerminalAgentCache = null;
let windowsTerminalAgentError = null;

function commandExists(command) {
  if (!command) return false;
  if (commandExistsCache.has(command)) return commandExistsCache.get(command);
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore', windowsHide: true });
  const exists = result.status === 0;
  commandExistsCache.set(command, exists);
  return exists;
}

function createTerminalConfigError(message) {
  const err = new Error(message);
  err.statusCode = 422;
  return err;
}

// Cache Windows shell discovery for the lifetime of the server process. PATH
// and ComSpec are inherited at process start, so shell configuration changes
// should be picked up by restarting Concilium.
function getWindowsTerminalAgent() {
  if (windowsTerminalAgentCache !== null) return windowsTerminalAgentCache;
  if (windowsTerminalAgentError !== null) throw windowsTerminalAgentError;

  const powerShell = ['pwsh.exe', 'powershell.exe'].find(commandExists);
  if (powerShell) {
    windowsTerminalAgentCache = { id: '_terminal', name: 'Terminal', command: powerShell, args: ['-NoLogo'], interactive: true };
    return windowsTerminalAgentCache;
  }

  const comSpec = typeof process.env.ComSpec === 'string' ? process.env.ComSpec.trim() : '';
  if (comSpec && commandExists(comSpec)) {
    windowsTerminalAgentCache = { id: '_terminal', name: 'Terminal', command: comSpec, args: [], interactive: true };
    return windowsTerminalAgentCache;
  }

  windowsTerminalAgentError = createTerminalConfigError('No interactive shell found on Windows. Please install PowerShell or ensure the ComSpec environment variable points to a valid shell executable.');
  throw windowsTerminalAgentError;
}

function getTerminalAgent() {
  if (process.platform === 'win32') {
    return getWindowsTerminalAgent();
  }

  const command = process.env.SHELL || '/bin/sh';
  return { id: '_terminal', name: 'Terminal', command, args: [], interactive: true };
}

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json(store.listTasks(limit));
});

router.post('/', (req, res) => {
  const { agent_id, prompt, cwd } = req.body || {};
  if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

  const cfg = getConfig();
  const agent = cfg.agents.find((a) => a.id === agent_id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });

  try {
    const task_id = manager.launch(agent, prompt || '', cwd);
    res.json({ task_id });
  } catch (err) {
    res.status(500).json({ error: err.message, code: err.code });
  }
});

router.post('/terminal', (req, res) => {
  try {
    const { cwd } = req.body || {};
    const shellAgent = getTerminalAgent();
    const task_id = manager.launch(shellAgent, '', cwd);
    res.json({ task_id });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  }
});

router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const task = store.getTask(id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  res.json({ ...task, events: store.listEvents(id) });
});

router.post('/:id/kill', (req, res) => {
  const id = parseInt(req.params.id);
  const ok = manager.kill(id);
  res.json({ killed: ok });
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!store.getTask(id)) return res.status(404).json({ error: 'task not found' });
  manager.remove(id);
  res.json({ ok: true });
});

router.post('/:id/input', (req, res) => {
  const id = parseInt(req.params.id);
  const { data } = req.body || {};
  if (typeof data !== 'string') return res.status(400).json({ error: 'data (string) required' });
  const ok = manager.sendInput(id, data);
  if (!ok) return res.status(409).json({ error: 'task not active or does not accept input' });
  res.json({ ok: true });
});

router.post('/:id/resize', (req, res) => {
  const id = parseInt(req.params.id);
  const cols = parseInt(req.body?.cols);
  const rows = parseInt(req.body?.rows);
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) {
    return res.status(400).json({ error: 'cols and rows (positive integers) required' });
  }
  const ok = manager.resize(id, cols, rows);
  if (!ok) return res.status(409).json({ error: 'task not active or not a PTY' });
  res.json({ ok: true });
});

module.exports = router;
