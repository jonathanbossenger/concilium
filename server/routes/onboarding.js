const express = require('express');
const { getConfig, getConfigForUpdate, saveConfig } = require('../config');

const router = express.Router();
const GITHUB_TOKEN_RE = /^[A-Za-z0-9_-]+$/;

function getGitHubToken(cfg) {
  if (cfg && typeof cfg.githubToken === 'string') return cfg.githubToken.trim();
  if (cfg && typeof cfg.GITHUB_TOKEN === 'string') return cfg.GITHUB_TOKEN.trim();
  return '';
}

function hasConfiguredAgent(cfg) {
  return !!(cfg && Array.isArray(cfg.agents) && cfg.agents.length > 0);
}

function isOnboardingCompleted(cfg) {
  return cfg && cfg.onboardingCompleted === true;
}

router.get('/github-token', (req, res) => {
  const cfg = getConfig();
  const token = getGitHubToken(cfg);
  res.json({ hasToken: !!token });
});

router.get('/onboarding', (req, res) => {
  const cfg = getConfig();
  const hasAgent = hasConfiguredAgent(cfg);
  const hasToken = !!getGitHubToken(cfg);
  res.json({
    needsOnboarding: !isOnboardingCompleted(cfg) && !hasAgent,
    hasAgent,
    hasToken,
  });
});

router.post('/onboarding/complete', (req, res) => {
  const cfg = getConfigForUpdate();
  if (!hasConfiguredAgent(cfg)) {
    return res.status(400).json({ error: 'Configure at least one agent before finishing onboarding.' });
  }
  cfg.onboardingCompleted = true;
  saveConfig(cfg);
  res.json({ ok: true });
});

router.post('/github-token', (req, res) => {
  const token = req.body && req.body.GITHUB_TOKEN;
  if (token !== undefined && typeof token !== 'string') {
    return res.status(400).json({ error: 'GITHUB_TOKEN must be a string' });
  }
  const cfg = getConfigForUpdate();
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

module.exports = router;
