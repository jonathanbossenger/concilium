const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const store = require('../store');
const { getConfig, saveConfig } = require('../config');
const { expandTilde } = require('../util/path');

const router = express.Router();
const GITHUB_TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const GITHUB_REPO_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const GIT_CLONE_TIMEOUT_MS = 120000;
const AGENT_TASK_CACHE_TTL_MS = 5000;
let activeAgentPRsCache = { value: null, expiresAt: 0 };

function getGitHubToken(cfg) {
  if (cfg && typeof cfg.githubToken === 'string') return cfg.githubToken.trim();
  if (cfg && typeof cfg.GITHUB_TOKEN === 'string') return cfg.GITHUB_TOKEN.trim();
  return '';
}

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
  const githubToken = getGitHubToken(cfg);
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

function githubHeaders(githubToken) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'concilium',
  };
  if (githubToken) headers.authorization = `Bearer ${githubToken}`;
  return headers;
}

function sanitizeProjectName(input) {
  const name = typeof input === 'string' ? input.trim() : '';
  if (!name) return { name: '', error: 'project name is required' };
  if (!GITHUB_REPO_NAME_RE.test(name)) {
    return {
      name,
      error: 'project name must start/end with a letter or number, contain only letters, numbers, dots, underscores, or dashes, and be between 1 and 100 characters long',
    };
  }
  return { name, error: null };
}

async function fetchGitHubUser(githubToken) {
  const r = await fetch('https://api.github.com/user', { headers: githubHeaders(githubToken) });
  if (!r.ok) {
    const err = new Error(`failed to fetch GitHub user (HTTP ${r.status}); verify your GitHub token and scopes`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json().catch(() => ({}));
  const login = data && typeof data.login === 'string' ? data.login.trim() : '';
  if (!login) {
    const err = new Error('GitHub user login missing');
    err.status = 502;
    throw err;
  }
  return { login };
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

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.toString().trim());
    });
  });
}

function execFileWithOutput(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout ? stdout.toString() : '';
        err.stderr = stderr ? stderr.toString() : '';
        return reject(err);
      }
      resolve({
        stdout: stdout ? stdout.toString() : '',
        stderr: stderr ? stderr.toString() : '',
      });
    });
  });
}

async function getActiveAgentPRsByRepo() {
  const now = Date.now();
  if (activeAgentPRsCache.value !== null && now < activeAgentPRsCache.expiresAt) {
    return activeAgentPRsCache.value;
  }

  let stdout = '';
  try {
    // gh agent-task is currently a preview command and may evolve over time.
    // We key activity by completedAt because null/empty means "still active".
    stdout = await execFileText('gh', [
      'agent-task',
      'list',
      '--json',
      'state,completedAt,pullRequestNumber,repository',
      '--limit',
      '50',
    ], { timeout: 5000 });
  } catch (_err) {
    const empty = new Map();
    // Cache empty results on errors to avoid spawning `gh` repeatedly while
    // the CLI is unavailable, unauthenticated, or timing out.
    activeAgentPRsCache = { value: empty, expiresAt: now + AGENT_TASK_CACHE_TTL_MS };
    return empty;
  }

  let rows = [];
  try {
    rows = JSON.parse(stdout);
  } catch (_err) {
    const empty = new Map();
    activeAgentPRsCache = { value: empty, expiresAt: now + AGENT_TASK_CACHE_TTL_MS };
    return empty;
  }

  const byRepo = new Map();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!row || row.completedAt) continue;
      const repo = typeof row.repository === 'string' ? row.repository.trim().toLowerCase() : '';
      const prNumber = Number(row.pullRequestNumber);
      if (!repo || !Number.isInteger(prNumber) || prNumber <= 0) continue;
      if (!byRepo.has(repo)) byRepo.set(repo, new Set());
      byRepo.get(repo).add(prNumber);
    }
  }

  activeAgentPRsCache = { value: byRepo, expiresAt: now + AGENT_TASK_CACHE_TTL_MS };
  return byRepo;
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
    const repoKey = `${repoData.owner}/${repoData.repo}`.toLowerCase();
    try {
      const [rawIssues, rawPulls, activePRsByRepo] = await Promise.all([
        fetchGitHubJson(`${apiBase}/issues?state=open&per_page=20&sort=updated&direction=desc`),
        fetchGitHubJson(`${apiBase}/pulls?state=open&per_page=20&sort=updated&direction=desc`),
        getActiveAgentPRsByRepo(),
      ]);
      const issues = Array.isArray(rawIssues)
        ? rawIssues.filter((item) => !item.pull_request).map(toGitHubItem)
        : [];
      const activePRs = activePRsByRepo.get(repoKey) || new Set();
      const pulls = Array.isArray(rawPulls)
        ? rawPulls.map((item) => {
          const pull = toGitHubPull(item);
          return { ...pull, agentActive: activePRs.has(pull.number) };
        })
        : [];
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
  const token = getGitHubToken(cfg);
  res.json({ hasToken: !!token });
});

router.post('/github-token', (req, res) => {
  const token = req.body && req.body.GITHUB_TOKEN;
  if (token !== undefined && typeof token !== 'string') {
    return res.status(400).json({ error: 'GITHUB_TOKEN must be a string' });
  }
  const cfg = getConfig();
  const normalized = typeof token === 'string' ? token.trim() : '';
  if (normalized && !GITHUB_TOKEN_RE.test(normalized)) {
    return res.status(400).json({ error: 'GitHub token contains invalid characters' });
  }
  if (normalized) cfg.githubToken = normalized;
  else delete cfg.githubToken;
  delete cfg.GITHUB_TOKEN;
  saveConfig(cfg);
  res.json({ ok: true });
});

router.post('/new-project/check', async (req, res) => {
  try {
    const parsed = sanitizeProjectName(req.body && req.body.name);
    if (parsed.error) return res.json({ canCreate: false, reason: parsed.error });

    const cfg = getConfig();
    const githubToken = getGitHubToken(cfg);
    if (!githubToken) return res.json({ canCreate: false, reason: 'set a GitHub token in Settings first' });

    const { login } = await fetchGitHubUser(githubToken);
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(login)}/${encodeURIComponent(parsed.name)}`;
    const repoResp = await fetch(repoUrl, { headers: githubHeaders(githubToken) });
    if (repoResp.status === 404) return res.json({ canCreate: true, owner: login });
    if (repoResp.ok) return res.json({ canCreate: false, owner: login, reason: `repository ${login}/${parsed.name} already exists` });
    if (repoResp.status === 401) return res.json({ canCreate: false, reason: 'GitHub token is not authorized (HTTP 401)' });
    if (repoResp.status === 403) return res.json({ canCreate: false, reason: 'GitHub token cannot access repository checks (HTTP 403)' });
    return res.json({ canCreate: false, reason: `GitHub check failed (HTTP ${repoResp.status})` });
  } catch (err) {
    const detail = classifyGitHubError(err);
    res.json({ canCreate: false, reason: detail.message });
  }
});

router.post('/new-project', async (req, res) => {
  try {
    const parsed = sanitizeProjectName(req.body && req.body.name);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const rawTarget = req.body && req.body.targetPath;
    if (!rawTarget || typeof rawTarget !== 'string') {
      return res.status(400).json({ error: 'targetPath is required' });
    }

    const cfg = getConfig();
    const githubToken = getGitHubToken(cfg);
    if (!githubToken) return res.status(400).json({ error: 'set a GitHub token in Settings first' });

    const targetPath = path.resolve(expandTilde(rawTarget.trim()));
    if (!targetPath) return res.status(400).json({ error: 'targetPath is required' });

    let stats;
    try {
      stats = await fs.promises.stat(targetPath);
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        return res.status(400).json({ error: 'target location does not exist' });
      }
      throw err;
    }
    if (!stats.isDirectory()) return res.status(400).json({ error: 'target location must be a directory' });
    try {
      await fs.promises.access(targetPath, fs.constants.W_OK);
    } catch (err) {
      if (err && err.code === 'EACCES') {
        return res.status(403).json({ error: 'target location is not writable' });
      }
      throw err;
    }

    const destination = path.join(targetPath, parsed.name);
    try {
      await fs.promises.stat(destination);
      return res.status(409).json({ error: 'target project directory already exists' });
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }

    const { login } = await fetchGitHubUser(githubToken);
    const createResp = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        ...githubHeaders(githubToken),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: parsed.name,
        auto_init: true,
      }),
    });
    const createData = await createResp.json().catch(() => ({}));
    if (!createResp.ok) {
      const msg = typeof createData.message === 'string' ? createData.message : `GitHub repo creation failed (HTTP ${createResp.status})`;
      return res.status(createResp.status).json({ error: msg });
    }

    const cloneUrl = typeof createData.clone_url === 'string' ? createData.clone_url : '';
    const htmlUrl = typeof createData.html_url === 'string' ? createData.html_url : `https://github.com/${login}/${parsed.name}`;
    if (!cloneUrl) return res.status(502).json({ error: 'GitHub did not return a clone URL' });

    try {
      await execFileWithOutput('git', ['clone', '--', cloneUrl, destination], { timeout: GIT_CLONE_TIMEOUT_MS });
    } catch (err) {
      const stderr = err && typeof err.stderr === 'string' ? err.stderr.trim() : '';
      const message = stderr || err.message || 'git clone failed';
      return res.status(502).json({ error: `repository created but clone failed: ${message}` });
    }

    res.json({
      ok: true,
      cwd: destination,
      repoUrl: htmlUrl,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || String(err) });
  }
});

module.exports = router;
