const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { LOG_DIR } = require('./config');
const { startTask } = require('./runner');
const store = require('./store');
const { expandTilde } = require('./util/path');

const live = new Map();

function launch(agent, prompt, cwd) {
  const resolvedCwd = expandTilde((cwd || '').trim()) || os.homedir();
  const task_id = store.createTask(agent.id, prompt, resolvedCwd);
  const broadcast = new EventEmitter();
  broadcast.setMaxListeners(0);
  const logStream = fs.createWriteStream(path.join(LOG_DIR, `${task_id}.log`), { flags: 'a' });

  const runner = startTask(agent, prompt, resolvedCwd);

  runner.on('event', (ev) => {
    const result = store.appendEvent(task_id, ev.ts, ev.stream, ev.data);
    logStream.write(ev.data);
    broadcast.emit('event', { ...ev, id: result.lastInsertRowid });
  });

  runner.on('end', (info) => {
    const status = info.signal ? 'killed' : 'done';
    store.finishTask(task_id, status, info.exitCode, info.signal);
    logStream.end();
    broadcast.emit('end', { ...info, status });
    live.delete(task_id);
  });

  live.set(task_id, { broadcast, runner, logStream });
  return task_id;
}

function remove(task_id) {
  const e = live.get(task_id);
  if (e) {
    // Detach so the end handler doesn't write to a row we're about to delete.
    e.runner.removeAllListeners();
    try { e.runner.kill(); } catch (_) {}
    try { e.logStream.end(); } catch (_) {}
    live.delete(task_id);
  }
  try { fs.unlinkSync(path.join(LOG_DIR, `${task_id}.log`)); } catch (_) {}
  store.deleteTask(task_id);
}

function kill(task_id) {
  const e = live.get(task_id);
  if (!e) return false;
  e.runner.kill();
  return true;
}

function sendInput(task_id, data) {
  const e = live.get(task_id);
  if (!e || typeof e.runner.write !== 'function') return false;
  const ts = Date.now();
  store.appendEvent(task_id, ts, 'stdin', data);
  e.runner.write(data);
  e.broadcast.emit('event', { stream: 'stdin', data, ts });
  return true;
}

function resize(task_id, cols, rows) {
  const e = live.get(task_id);
  if (!e || typeof e.runner.resize !== 'function') return false;
  return e.runner.resize(cols, rows) !== false;
}

function getLive(task_id) {
  return live.get(task_id);
}

module.exports = { launch, kill, sendInput, resize, getLive, remove };
