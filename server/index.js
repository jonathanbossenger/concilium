const path = require('path');
const express = require('express');
const { ensureState, getConfig } = require('./config');

ensureState();
const cfg = getConfig();

// Routes are required AFTER ensureState() so store.js can open the DB.
const agentsRoute = require('./routes/agents');
const tasksRoute = require('./routes/tasks');
const streamRoute = require('./routes/stream');
const systemRoute = require('./routes/system');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, pid: process.pid, uptime: process.uptime() });
});

app.use('/api/agents', agentsRoute);
app.use('/api/tasks', tasksRoute);
app.use('/api/stream', streamRoute);
app.use('/api/system', systemRoute);

app.use(express.static(path.join(__dirname, '..', 'public')));

const server = app.listen(cfg.port, '127.0.0.1', () => {
  console.log(`agent-dashboard listening on http://127.0.0.1:${cfg.port}`);
});

function shutdown(signal) {
  console.log(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
