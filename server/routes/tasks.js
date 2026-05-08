const express = require('express');
const { spawnSync } = require('child_process');
const { getConfig } = require('../config');
const manager = require('../manager');
const store = require('../store');

const router = express.Router();

function commandExists(command) {
  if (!command) return false;
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore', windowsHide: true });
  return result.status === 0;
}

function getTerminalAgent() {
  if (process.platform === 'win32') {
    const powerShell = ['pwsh.exe', 'powershell.exe'].find(commandExists);
    if (powerShell) {
      return { id: '_terminal', name: 'Terminal', command: powerShell, args: ['-NoLogo'], interactive: true };
    }

    const rawComSpec = process.env.COMSPEC || process.env.ComSpec;
    const comSpecPath = typeof rawComSpec === 'string' ? rawComSpec.trim() : '';
    if (comSpecPath && commandExists(comSpecPath)) {
      return { id: '_terminal', name: 'Terminal', command: comSpecPath, args: [], interactive: true };
    }

    throw new Error('No interactive shell found on Windows. Please install PowerShell or ensure cmd.exe is available via the ComSpec environment variable.');
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
  const { cwd } = req.body || {};
  const shellAgent = getTerminalAgent();
  try {
    const task_id = manager.launch(shellAgent, '', cwd);
    res.json({ task_id });
  } catch (err) {
    res.status(500).json({ error: err.message, code: err.code });
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
