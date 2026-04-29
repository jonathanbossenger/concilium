const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
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
  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  // HTTPS: https://github.com/owner/repo.git or https://github.com/owner/repo
  const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
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
    execFile('git', ['-C', resolved, 'remote', 'get-url', 'origin'], (err, stdout) => {
      if (err) return res.json({ url: null });
      const remoteUrl = stdout.toString().trim();
      const url = parseGitHubUrl(remoteUrl);
      res.json({ url });
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
