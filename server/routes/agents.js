const express = require('express');
const { getConfig, saveConfig } = require('../config');
const { discover } = require('../discover');

const router = express.Router();

const ID_RE = /^[a-z0-9_-]+$/i;

function normalize(input) {
  const a = {
    id: String(input.id || '').trim(),
    name: String(input.name || input.id || '').trim(),
    command: String(input.command || '').trim(),
    interactive: !!input.interactive,
  };
  if (Array.isArray(input.args) && input.args.length) {
    a.args = input.args.map(String);
  }
  return a;
}

router.get('/', (req, res) => {
  res.json(getConfig().agents);
});

// /discover must come before /:id to avoid the param matching it.
router.get('/discover', (req, res) => {
  res.json(discover());
});

router.get('/:id', (req, res) => {
  const agent = getConfig().agents.find((a) => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  res.json(agent);
});

router.post('/', (req, res) => {
  const body = req.body || {};
  if (!body.id || !body.command) {
    return res.status(400).json({ error: 'id and command required' });
  }
  if (!ID_RE.test(body.id)) {
    return res.status(400).json({ error: 'id must match [a-z0-9_-]+' });
  }
  const cfg = getConfig();
  if (cfg.agents.some((a) => a.id === body.id)) {
    return res.status(409).json({ error: 'id already exists' });
  }
  const agent = normalize(body);
  cfg.agents.push(agent);
  saveConfig(cfg);
  res.status(201).json(agent);
});

router.patch('/:id', (req, res) => {
  const cfg = getConfig();
  const idx = cfg.agents.findIndex((a) => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'agent not found' });

  const body = req.body || {};
  const a = cfg.agents[idx];
  if (body.name !== undefined) a.name = String(body.name);
  if (body.command !== undefined) a.command = String(body.command);
  if (body.interactive !== undefined) a.interactive = !!body.interactive;
  if (body.args !== undefined) {
    if (Array.isArray(body.args) && body.args.length) {
      a.args = body.args.map(String);
    } else {
      delete a.args;
    }
  }

  saveConfig(cfg);
  res.json(a);
});

router.delete('/:id', (req, res) => {
  const cfg = getConfig();
  const idx = cfg.agents.findIndex((a) => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'agent not found' });
  cfg.agents.splice(idx, 1);
  saveConfig(cfg);
  res.json({ deleted: true });
});

module.exports = router;
