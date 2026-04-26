const path = require('path');
const express = require('express');
const { ensureState, getConfig } = require('./config');

ensureState();
const cfg = getConfig();

// Routes are required AFTER ensureState() so store.js can open the DB.
const { router: authRoute, requireAuth } = require('./auth');
const agentsRoute = require('./routes/agents');
const tasksRoute = require('./routes/tasks');
const streamRoute = require('./routes/stream');
const systemRoute = require('./routes/system');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Public auth routes and pages — no authentication required.
app.use('/auth', authRoute);
app.get('/login', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html')),
);
app.get('/setup', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'setup.html')),
);

// All routes below this point require authentication.
app.use(requireAuth);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, pid: process.pid, uptime: process.uptime() });
});

app.use('/api/agents', agentsRoute);
app.use('/api/tasks', tasksRoute);
app.use('/api/stream', streamRoute);
app.use('/api/system', systemRoute);

app.use('/vendor/xterm', express.static(path.join(__dirname, '..', 'node_modules', '@xterm', 'xterm')));
app.use('/vendor/xterm-addon-fit', express.static(path.join(__dirname, '..', 'node_modules', '@xterm', 'addon-fit')));
app.use(express.static(path.join(__dirname, '..', 'public')));

const bindAddress = cfg.bind || '127.0.0.1';
const server = app.listen(cfg.port, bindAddress, () => {
  console.log(`agent-dashboard listening on http://${bindAddress}:${cfg.port}`);
});

function shutdown(signal) {
  console.log(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
