const os = require('os');
const express = require('express');
const { getConfig } = require('../config');
const manager = require('../manager');
const store = require('../store');

const router = express.Router();

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json(store.listTasks(limit));
});

router.post('/', (req, res) => {
  const { agent_id, prompt, cwd } = req.body || {};
  if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

  const cfg = getConfig();
  const agent = cfg.agents.find((a) => a.id === agent_id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });

  try {
    const task_id = manager.launch(agent, prompt || '', cwd || os.homedir());
    res.json({ task_id });
  } catch (err) {
    res.status(500).json({ error: err.message, code: err.code });
  }
});

router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const task = store.getTask(id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  res.json({ ...task, events: store.listEvents(id) });
});

router.post('/:id/kill', (req, res) => {
  const id = parseInt(req.params.id);
  const ok = manager.kill(id);
  res.json({ killed: ok });
});

router.post('/:id/input', (req, res) => {
  const id = parseInt(req.params.id);
  const { data } = req.body || {};
  if (typeof data !== 'string') return res.status(400).json({ error: 'data (string) required' });
  const ok = manager.sendInput(id, data);
  if (!ok) return res.status(409).json({ error: 'task not active or does not accept input' });
  res.json({ ok: true });
});

module.exports = router;
