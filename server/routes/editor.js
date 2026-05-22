const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isLoopbackRequest } = require('../loopback');
const { getConfig, getConfigForUpdate, saveConfig } = require('../config');
const { expandTilde } = require('../util/path');

const router = express.Router();

function getPreferredEditor(cfg) {
  const raw = cfg && cfg.preferredEditor && typeof cfg.preferredEditor === 'object'
    ? cfg.preferredEditor
    : {};
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  const args = Array.isArray(raw.args)
    ? raw.args.map((arg) => String(arg).trim()).filter(Boolean)
    : [];
  return { command, args };
}

function launchPreferredEditor(editor, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(editor.command, [...editor.args, cwd], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      ...(process.platform === 'win32' ? { shell: true } : {}),
    });
    let settled = false;
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    });
  });
}

router.get('/preferred-editor', (req, res) => {
  if (!isLoopbackRequest(req)) {
    return res.json({
      available: false,
      configured: false,
      preferredEditor: { command: '', args: [] },
    });
  }
  const editor = getPreferredEditor(getConfig());
  res.json({
    available: true,
    configured: !!editor.command,
    preferredEditor: editor,
  });
});

router.post('/preferred-editor', (req, res) => {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: 'preferred editor is only available on the local loopback UI' });
  }
  const { command, args } = req.body || {};
  if (command !== undefined && typeof command !== 'string') {
    return res.status(400).json({ error: 'command must be a string' });
  }
  if (args !== undefined && !Array.isArray(args)) {
    return res.status(400).json({ error: 'args must be an array of strings' });
  }
  if (Array.isArray(args) && args.some((arg) => typeof arg !== 'string')) {
    return res.status(400).json({ error: 'args must be an array of strings' });
  }
  const editor = {
    command: typeof command === 'string' ? command.trim() : '',
    args: Array.isArray(args) ? args.map((arg) => arg.trim()).filter(Boolean) : [],
  };
  const cfg = getConfigForUpdate();
  if (editor.command) cfg.preferredEditor = editor;
  else delete cfg.preferredEditor;
  saveConfig(cfg);
  res.json({ ok: true, configured: !!editor.command });
});

router.post('/open-editor', async (req, res) => {
  try {
    if (!isLoopbackRequest(req)) {
      return res.status(403).json({ error: 'opening the preferred editor is only available on the local loopback UI' });
    }
    const rawDir = req.body && req.body.path;
    if (!rawDir || typeof rawDir !== 'string') {
      return res.status(400).json({ error: 'path required' });
    }
    const editor = getPreferredEditor(getConfig());
    if (!editor.command) {
      return res.status(400).json({ error: 'set a preferred code editor in Settings first' });
    }
    const resolved = path.resolve(expandTilde(rawDir));
    let stats;
    try {
      stats = await fs.promises.stat(resolved);
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        return res.status(400).json({ error: 'working directory does not exist' });
      }
      throw err;
    }
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'working directory must be a directory' });
    }
    await launchPreferredEditor(editor, resolved);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

module.exports = router;
