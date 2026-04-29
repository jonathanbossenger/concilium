const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getConfig, saveConfig } = require('../config');
const { isValidBind } = require('../auth');
const store = require('../store');

const router = express.Router();

function pickDirectoryMac() {
  return new Promise((resolve, reject) => {
    const script =
      'try\n' +
      '  set f to choose folder with prompt "Select working directory"\n' +
      '  POSIX path of f\n' +
      'on error number -128\n' +
      '  return ""\n' +
      'end try';
    execFile('osascript', ['-e', script], (err, stdout) => {
      if (err) return reject(err);
      const picked = stdout.toString().trim();
      resolve(picked || null);
    });
  });
}

function pickDirectoryLinux() {
  return new Promise((resolve, reject) => {
    execFile(
      'zenity',
      ['--file-selection', '--directory', '--title=Select working directory'],
      (err, stdout) => {
        if (err) {
          // zenity exits 1 on cancel — treat as "no selection".
          if (err.code === 1) return resolve(null);
          return reject(err);
        }
        const picked = stdout.toString().trim();
        resolve(picked || null);
      },
    );
  });
}

function pickDirectoryWindows() {
  return new Promise((resolve, reject) => {
    const script =
      'Add-Type -AssemblyName System.Windows.Forms | Out-Null;' +
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog;' +
      '$d.Description = "Select working directory";' +
      'if ($d.ShowDialog() -eq "OK") { Write-Output $d.SelectedPath }';
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      (err, stdout) => {
        if (err) return reject(err);
        const picked = stdout.toString().trim();
        resolve(picked || null);
      },
    );
  });
}

router.post('/pick-directory', async (req, res) => {
  try {
    let picked = null;
    if (process.platform === 'darwin') picked = await pickDirectoryMac();
    else if (process.platform === 'linux') picked = await pickDirectoryLinux();
    else if (process.platform === 'win32') picked = await pickDirectoryWindows();
    else return res.status(501).json({ error: `picker not supported on ${process.platform}` });

    res.json({ path: picked });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

function parseGitHubUrl(remoteUrl) {
  // SSH scp-style: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+\/[^/]+?)\/?(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  // SSH url-style: ssh://git@github.com[:port]/owner/repo.git
  const sshUrlMatch = remoteUrl.match(/^ssh:\/\/git@github\.com(?::\d+)?\/([^/]+\/[^/]+?)\/?(?:\.git)?$/);
  if (sshUrlMatch) return `https://github.com/${sshUrlMatch[1]}`;
  // HTTPS: https://github.com/owner/repo.git  (optional user@, trailing slash, .git)
  const httpsMatch = remoteUrl.match(/^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+\/[^/]+?)\/?(?:\.git)?$/);
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;
  return null;
}

router.post('/github-url', (req, res) => {
  const dir = req.body && req.body.path;
  if (!dir || typeof dir !== 'string') {
    return res.status(400).json({ error: 'path required' });
  }
  // Resolve to an absolute path and verify it is an existing directory before
  // running git, so we do not reveal information about arbitrary filesystem paths.
  const resolved = path.resolve(dir);
  fs.stat(resolved, (statErr, stats) => {
    if (statErr) {
      if (statErr.code !== 'ENOENT' && statErr.code !== 'ENOTDIR') {
        console.error('[agent-dashboard] github-url stat error:', statErr.message);
      }
      return res.json({ url: null });
    }
    if (!stats.isDirectory()) return res.json({ url: null });
    // Try 'origin' first, then fall back to 'upstream' (common in fork workflows).
    execFile('git', ['-C', resolved, 'remote', 'get-url', 'origin'], (err, stdout) => {
      const originUrl = err ? null : parseGitHubUrl(stdout.toString().trim());
      if (originUrl) return res.json({ url: originUrl });
      execFile('git', ['-C', resolved, 'remote', 'get-url', 'upstream'], (err2, stdout2) => {
        if (err2) return res.json({ url: null });
        const url = parseGitHubUrl(stdout2.toString().trim());
        res.json({ url });
      });
    });
  });
});

/** GET /api/system/network — return current bind address. */
router.get('/network', (req, res) => {
  const cfg = getConfig();
  res.json({ bind: cfg.bind || '127.0.0.1' });
});

/** PATCH /api/system/network — update bind address (requires restart to take effect). */
router.patch('/network', (req, res) => {
  const { bind } = req.body || {};
  if (!bind || typeof bind !== 'string') {
    return res.status(400).json({ error: 'bind is required' });
  }
  const trimmed = bind.trim();
  if (!isValidBind(trimmed)) {
    return res.status(400).json({ error: 'bind must be a valid IP address or "localhost"' });
  }
  const cfg = getConfig();
  cfg.bind = trimmed;
  saveConfig(cfg);
  res.json({ ok: true, bind: trimmed });
});

/**
 * GET /api/system/browse?path=<dir>
 * Returns the immediate subdirectories of the given path (defaults to $HOME).
 * Used by the web-based directory picker (issue #12) when the server is remote
 * and OS-specific GUI pickers are unavailable.
 */
router.get('/browse', (req, res) => {
  const requested = req.query.path;
  const base = requested && typeof requested === 'string' && requested.trim()
    ? path.resolve(requested.trim())
    : os.homedir();

  fs.readdir(base, { withFileTypes: true }, (err, entries) => {
    if (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        return res.status(404).json({ error: 'Directory not found', path: base });
      }
      if (err.code === 'EACCES') {
        return res.status(403).json({ error: 'Permission denied', path: base });
      }
      return res.status(500).json({ error: err.message });
    }
    const dirs = entries
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    const parent = path.dirname(base);
    res.json({
      path: base,
      parent: base !== parent ? parent : null,
      dirs,
    });
  });
});

router.get('/layout', (req, res) => {
  const raw = store.getLayout();
  if (!raw) return res.json([]);
  try {
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error('[agent-dashboard] failed to parse stored layout:', err);
    res.json([]);
  }
});

router.post('/layout', (req, res) => {
  const body = req.body;
  if (!Array.isArray(body)) return res.status(400).json({ error: 'array expected' });
  const valid = body.every(
    (e) => e !== null && typeof e === 'object' && !Array.isArray(e) &&
      (e.agentId === undefined || typeof e.agentId === 'string') &&
      (e.cwd === undefined || typeof e.cwd === 'string') &&
      (e.lastTaskId === undefined || e.lastTaskId === null || typeof e.lastTaskId === 'number'),
  );
  if (!valid) return res.status(400).json({ error: 'invalid entry shape' });
  store.saveLayout(JSON.stringify(body));
  res.json({ ok: true });
});

module.exports = router;
