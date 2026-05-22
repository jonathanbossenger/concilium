const os = require('os');
const path = require('path');
const express = require('express');
const { ensureState } = require('./config');
const { requireLoopbackRequest } = require('./loopback');

function createApp() {
  ensureState();

  // Routes are required AFTER ensureState() so store.js can open the DB.
  const agentsRoute = require('./routes/agents');
  const tasksRoute = require('./routes/tasks');
  const streamRoute = require('./routes/stream');
  const githubRoute = require('./routes/github');
  const layoutRoute = require('./routes/layout');
  const onboardingRoute = require('./routes/onboarding');
  const editorRoute = require('./routes/editor');
  const pickerRoute = require('./routes/picker');

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', requireLoopbackRequest);

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, pid: process.pid, uptime: process.uptime(), homeDir: os.homedir() });
  });

  app.use('/api/agents', agentsRoute);
  app.use('/api/tasks', tasksRoute);
  app.use('/api/stream', streamRoute);
  app.use('/api/system', githubRoute);
  app.use('/api/system', layoutRoute);
  app.use('/api/system', onboardingRoute);
  app.use('/api/system', editorRoute);
  app.use('/api/system', pickerRoute);

  app.use('/vendor/xterm', express.static(path.join(__dirname, '..', 'node_modules', '@xterm', 'xterm')));
  app.use('/vendor/xterm-addon-fit', express.static(path.join(__dirname, '..', 'node_modules', '@xterm', 'addon-fit')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

module.exports = { createApp };
