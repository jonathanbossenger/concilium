const os = require('os');
const path = require('path');
const express = require('express');
const { ensureState, getConfig, saveConfig } = require('./config');
const { isLocalRequest, hasAdminCredentials, getSessionUser } = require('./auth');

ensureState();
const cfg = getConfig();

// Routes are required AFTER ensureState() so store.js can open the DB.
const agentsRoute = require('./routes/agents');
const tasksRoute = require('./routes/tasks');
const streamRoute = require('./routes/stream');
const systemRoute = require('./routes/system');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  const cfg = getConfig();
  if (!cfg.publicServer && !isLocalRequest(req)) {
    cfg.publicServer = true;
    saveConfig(cfg);
  }
  next();
});

app.use('/api', (req, res, next) => {
  const cfg = getConfig();
  if (!cfg.publicServer) return next();

  const isSetupEndpoint = req.path === '/system/auth/state'
    || req.path === '/system/auth/setup'
    || req.path === '/system/auth/login'
    || req.path === '/system/auth/logout';
  if (isSetupEndpoint) return next();

  if (!hasAdminCredentials(cfg)) {
    return res.status(403).json({ error: 'admin setup required' });
  }
  const sessionUser = getSessionUser(req, cfg);
  if (!sessionUser || sessionUser !== cfg.adminUser) {
    return res.status(401).json({ error: 'authentication required' });
  }
  return next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, pid: process.pid, uptime: process.uptime(), homeDir: os.homedir() });
});

app.use('/api/agents', agentsRoute);
app.use('/api/tasks', tasksRoute);
app.use('/api/stream', streamRoute);
app.use('/api/system', systemRoute);

app.use('/vendor/xterm', express.static(path.join(__dirname, '..', 'node_modules', '@xterm', 'xterm')));
app.use('/vendor/xterm-addon-fit', express.static(path.join(__dirname, '..', 'node_modules', '@xterm', 'addon-fit')));
app.use(express.static(path.join(__dirname, '..', 'public')));

const host = typeof cfg.host === 'string' && cfg.host.trim() ? cfg.host.trim() : '127.0.0.1';
const server = app.listen(cfg.port, host, () => {
  const url = `http://${host}:${cfg.port}`;
  // OSC 8 hyperlink — clickable in supporting terminals (iTerm2, Terminal.app,
  // VS Code, modern gnome-terminal); falls back to the visible URL elsewhere.
  const link = `\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`;
  console.log(`concilium listening — open ${link}`);
});

function shutdown(signal) {
  console.log(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
