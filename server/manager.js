const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { LOG_DIR } = require('./config');
const { startTask } = require('./runner');
const store = require('./store');
const { expandTilde } = require('./util/path');

const live = new Map();
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LOG_ROTATIONS = 3;
const EVENT_RETENTION_DAYS = 30;
const EVENT_ROWS_PER_TASK = 20000;
const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const VACUUM_THRESHOLD_ROWS = 50000;
const TASK_LOG_NAME_REGEX = new RegExp(`^(\\d+)\\.log(?:\\.([1-${LOG_ROTATIONS}]))?$`);
const FLUSH_INTERVAL_MS = 50;
const FLUSH_BYTES = 4 * 1024;

function rotateLogFiles(basePath) {
  for (let i = LOG_ROTATIONS; i >= 1; i -= 1) {
    const src = i === 1 ? basePath : `${basePath}.${i - 1}`;
    const dst = `${basePath}.${i}`;
    try {
      if (i === LOG_ROTATIONS && fs.existsSync(dst)) fs.unlinkSync(dst);
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    } catch (err) {
      console.warn(`failed to rotate log file ${src} -> ${dst}: ${err.message}`);
    }
  }
}

function createLogWriter(task_id) {
  const filePath = path.join(LOG_DIR, `${task_id}.log`);
  let fd = fs.openSync(filePath, 'a');
  let size = fs.fstatSync(fd).size;
  let closed = false;

  function rotate() {
    if (closed) return;
    try {
      fs.closeSync(fd);
      rotateLogFiles(filePath);
      fd = fs.openSync(filePath, 'w');
      size = 0;
      return true;
    } catch (err) {
      console.warn(`failed to rotate task log ${task_id}: ${err.message}`);
      closed = true;
      return false;
    }
  }

  return {
    write(data) {
      if (closed) return;
      const buf = Buffer.from(data, 'utf8');
      let offset = 0;
      while (offset < buf.length) {
        if (size >= MAX_LOG_BYTES && !rotate()) break;
        const room = MAX_LOG_BYTES - size;
        const bytes = Math.min(room, buf.length - offset);
        if (bytes <= 0) break;
        try {
          fs.writeSync(fd, buf, offset, bytes);
          size += bytes;
          offset += bytes;
        } catch (err) {
          console.warn(`failed to write task log ${task_id}: ${err.message}`);
          closed = true;
          break;
        }
      }
    },
    end() {
      if (closed) return;
      closed = true;
      fs.closeSync(fd);
    },
  };
}

function cleanupOrphanLogs() {
  let removed = 0;
  const taskIds = new Set(store.listTaskIds());
  const entries = fs.readdirSync(LOG_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(TASK_LOG_NAME_REGEX);
    if (!match) continue;
    const taskId = parseInt(match[1], 10);
    if (taskIds.has(taskId)) continue;
    try {
      fs.unlinkSync(path.join(LOG_DIR, entry.name));
      removed += 1;
    } catch (_) {}
  }
  return removed;
}

function deleteTaskLogs(task_id) {
  const prefix = `${task_id}.log`;
  const entries = fs.readdirSync(LOG_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(prefix) && TASK_LOG_NAME_REGEX.test(entry.name)) {
      try { fs.unlinkSync(path.join(LOG_DIR, entry.name)); } catch (_) {}
    }
  }
}

function runMaintenance() {
  const olderThanTs = Date.now() - (EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = store.pruneEvents({
    olderThanTs,
    maxPerTask: EVENT_ROWS_PER_TASK,
    vacuumThreshold: VACUUM_THRESHOLD_ROWS,
  });
  const removedLogs = cleanupOrphanLogs();
  if (result.deleted > 0 || removedLogs > 0 || result.vacuumed) {
    console.log(`maintenance: deleted ${result.deleted} events, removed ${removedLogs} orphan log files${result.vacuumed ? ', vacuumed db' : ''}`);
  }
}

runMaintenance();
setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS).unref();

// Creates a coalescing write batcher for a single task.  Events are queued
// and flushed to SQLite in a single transaction either when the accumulated
// payload reaches FLUSH_BYTES or after FLUSH_INTERVAL_MS, whichever comes
// first.  After the DB write the events are broadcast with their real row ids,
// preserving the "DB-write happens-before broadcast" invariant that SSE replay
// relies on.
function createBatcher(task_id, onFlush) {
  let pending = [];
  let pendingBytes = 0;
  let timer = null;

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    pendingBytes = 0;
    onFlush(batch);
  }

  function discard() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = [];
    pendingBytes = 0;
  }

  function push(ev) {
    pending.push(ev);
    pendingBytes += Buffer.byteLength(ev.data, 'utf8');
    if (pendingBytes >= FLUSH_BYTES) {
      flush();
      return;
    }
    if (timer === null) {
      timer = setTimeout(flush, FLUSH_INTERVAL_MS);
      timer.unref();
    }
  }

  return { push, flush, discard };
}

function launch(agent, prompt, cwd, cols, rows) {
  const resolvedCwd = expandTilde((cwd || '').trim()) || os.homedir();
  const task_id = store.createTask(agent.id, prompt, resolvedCwd);
  const broadcast = new EventEmitter();
  broadcast.setMaxListeners(0);
  const logWriter = createLogWriter(task_id);

  const runner = startTask(agent, prompt, resolvedCwd, cols, rows);

  const batcher = createBatcher(task_id, (batch) => {
    const ids = store.appendEvents(task_id, batch);
    for (let i = 0; i < batch.length; i += 1) {
      broadcast.emit('event', { ...batch[i], id: ids[i] });
    }
  });

  runner.on('event', (ev) => {
    logWriter.write(ev.data);
    batcher.push(ev);
  });

  runner.on('end', (info) => {
    batcher.flush();
    const status = info.signal ? 'killed' : 'done';
    store.finishTask(task_id, status, info.exitCode, info.signal);
    try { logWriter.end(); } catch (err) {
      console.warn(`failed to close task log ${task_id}: ${err.message}`);
    }
    broadcast.emit('end', { ...info, status });
    live.delete(task_id);
  });

  live.set(task_id, { broadcast, runner, logWriter, batcher });
  return task_id;
}

function remove(task_id) {
  const e = live.get(task_id);
  if (e) {
    // Detach so the end handler doesn't write to a row we're about to delete.
    e.runner.removeAllListeners();
    try { e.runner.kill(); } catch (_) {}
    try { e.logWriter.end(); } catch (err) {
      console.warn(`failed to close task log ${task_id}: ${err.message}`);
    }
    e.batcher.discard();
    live.delete(task_id);
  }
  try { deleteTaskLogs(task_id); } catch (_) {}
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
  // Flush any buffered stdout events before writing stdin so the DB row order
  // reflects the true sequence of events and SSE clients that replay from the
  // DB see a consistent picture (happens-before invariant).
  e.batcher.flush();
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

module.exports = { launch, kill, sendInput, resize, getLive, remove, liveCount: () => live.size };
