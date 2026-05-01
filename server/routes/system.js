const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const store = require('../store');
const { getConfig, saveConfig } = require('../config');
const { expandTilde } = require('../util/path');

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

function parseGitHubRepo(url) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(url || '');
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  const ownerRepoPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
  if (!ownerRepoPattern.test(owner) || !ownerRepoPattern.test(repo)) return null;
  return { owner, repo };
}

async function fetchGitHubJson(url) {
  const cfg = getConfig();
  const githubToken = typeof cfg.GITHUB_TOKEN === 'string' ? cfg.GITHUB_TOKEN.trim() : '';
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'concilium',
  };
  if (githubToken) headers.authorization = `Bearer ${githubToken}`;
  const r = await fetch(url, {
    headers,
  });
  if (!r.ok) {
    const err = new Error(`GitHub API request failed with status ${r.status}`);
    err.status = r.status;
    const remainingHeader = r.headers.get('x-ratelimit-remaining');
    const remaining = remainingHeader === null ? null : Number.parseInt(remainingHeader, 10);
    err.rateLimited = Number.isFinite(remaining) && remaining === 0;
    throw err;
  }
  return r.json();
}

function classifyGitHubError(err) {
  if (err && err.status === 403 && err.rateLimited) {
    return { code: 'rate_limited', message: 'github rate limited (http 403)' };
  }
  if (err && err.status === 403) {
    return { code: 'forbidden', message: 'github access forbidden (http 403)' };
  }
  if (err && err.status === 404) {
    return { code: 'not_found', message: 'github repository not found (http 404)' };
  }
  if (err && typeof err.status === 'number' && err.status > 0) {
    return { code: 'http_error', message: `github request failed (http ${err.status})` };
  }
  return { code: 'fetch_failed', message: 'failed to fetch from github' };
}

function toGitHubItem(item) {
  return {
    number: item.number,
    title: item.title,
    url: item.html_url,
    state: item.state,
  };
}

function toGitHubPull(item) {
  return {
    ...toGitHubItem(item),
    branch: item.head && typeof item.head.ref === 'string' ? item.head.ref : '',
  };
}

router.post('/github-url', (req, res) => {
  const rawDir = req.body && req.body.path;
  if (!rawDir || typeof rawDir !== 'string') {
    return res.status(400).json({ error: 'path required' });
  }
  const dir = expandTilde(rawDir);
  // Resolve to an absolute path and verify it is an existing directory before
  // running git, so we do not reveal information about arbitrary filesystem paths.
  const resolved = path.resolve(dir);
  fs.stat(resolved, (statErr, stats) => {
    if (statErr) {
      if (statErr.code !== 'ENOENT' && statErr.code !== 'ENOTDIR') {
        console.error('[concilium] github-url stat error:', statErr.message);
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

router.post('/github-items', async (req, res) => {
  try {
    const url = req.body && req.body.url;
    if (url && typeof url !== 'string') {
      return res.status(400).json({ error: 'url must be a string' });
    }
    if (!url) return res.json({ url: null, issues: [], pulls: [] });
    const repoData = parseGitHubRepo(url);
    if (!repoData) return res.json({ url: null, issues: [], pulls: [] });
    const apiBase = `https://api.github.com/repos/${encodeURIComponent(repoData.owner)}/${encodeURIComponent(repoData.repo)}`;
    try {
      const [rawIssues, rawPulls] = await Promise.all([
        fetchGitHubJson(`${apiBase}/issues?state=open&per_page=20&sort=updated&direction=desc`),
        fetchGitHubJson(`${apiBase}/pulls?state=open&per_page=20&sort=updated&direction=desc`),
      ]);
      const issues = Array.isArray(rawIssues)
        ? rawIssues.filter((item) => !item.pull_request).map(toGitHubItem)
        : [];
      const pulls = Array.isArray(rawPulls) ? rawPulls.map(toGitHubPull) : [];
      res.json({ url, issues, pulls });
    } catch (err) {
      const detail = classifyGitHubError(err);
      console.error('[concilium] github-items fetch failed:', err.message);
      res.json({
        url,
        issues: [],
        pulls: [],
        error: detail.message,
        errorCode: detail.code,
      });
    }
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || String(err) });
  }
});

router.get('/layout', (req, res) => {
  const raw = store.getLayout();
  if (!raw) return res.json([]);
  try {
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error('[concilium] failed to parse stored layout:', err);
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

router.get('/github-token', (req, res) => {
  const cfg = getConfig();
  const token = typeof cfg.GITHUB_TOKEN === 'string' ? cfg.GITHUB_TOKEN : '';
  res.json({ GITHUB_TOKEN: token });
});

router.post('/github-token', (req, res) => {
  const token = req.body && req.body.GITHUB_TOKEN;
  if (token !== undefined && typeof token !== 'string') {
    return res.status(400).json({ error: 'GITHUB_TOKEN must be a string' });
  }
  const cfg = getConfig();
  const normalized = typeof token === 'string' ? token.trim() : '';
  if (normalized) cfg.GITHUB_TOKEN = normalized;
  else delete cfg.GITHUB_TOKEN;
  saveConfig(cfg);
  res.json({ ok: true });
});

module.exports = router;
