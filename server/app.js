const os = require('os');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { ensureState } = require('./config');
const { requireLoopbackRequest } = require('./loopback');
const { REQUEST_BODY_LIMIT } = require('./constants');

async function logsDirSize(logDir) {
  try {
    const entries = await fs.promises.readdir(logDir, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.promises.stat(path.join(logDir, entry.name));
        total += stat.size;
      } catch (_) {}
    }
    return total;
  } catch (_) {
    return 0;
  }
}

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
  const manager = require('./manager');
  const store = require('./store');
  const { LOG_DIR } = require('./config');

  const app = express();
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
  app.use('/api', requireLoopbackRequest);

  app.get('/api/health', async (req, res) => {
    res.json({
      ok: true,
      pid: process.pid,
      uptime: process.uptime(),
      homeDir: os.homedir(),
      liveTasks: manager.liveCount(),
      totalEvents: store.countEvents(),
      logsDirBytes: await logsDirSize(LOG_DIR),
    });
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
