const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');

const STATE_DIR = path.join(os.homedir(), '.concilium');
const CONFIG_PATH = path.join(STATE_DIR, 'config.yaml');
const LOG_DIR = path.join(STATE_DIR, 'logs');

const DEFAULT_CONFIG = {
  port: 7878,
  GITHUB_TOKEN: '',
  agents: [
    { id: 'echo', name: 'Echo (test)', command: 'cat', interactive: false },
    { id: 'claude', name: 'Claude Code', command: 'claude', interactive: true },
    { id: 'codex', name: 'Codex CLI', command: 'codex', interactive: true },
    { id: 'aider', name: 'Aider', command: 'aider', interactive: true },
    { id: 'gemini', name: 'Gemini CLI', command: 'gemini', interactive: true },
  ],
};

function ensureState() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, yaml.dump(DEFAULT_CONFIG));
  }
}

let cached = null;
function getConfig() {
  if (cached) return cached;
  cached = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return cached;
}

function reloadConfig() {
  cached = null;
  return getConfig();
}

function saveConfig(newCfg) {
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, yaml.dump(newCfg, { sortKeys: false }));
  fs.renameSync(tmp, CONFIG_PATH);
  cached = newCfg;
  return cached;
}

module.exports = {
  ensureState,
  getConfig,
  reloadConfig,
  saveConfig,
  STATE_DIR,
  CONFIG_PATH,
  LOG_DIR,
};
