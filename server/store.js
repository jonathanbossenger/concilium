const path = require('path');
const Database = require('better-sqlite3');
const { STATE_DIR } = require('./config');

const db = new Database(path.join(STATE_DIR, 'tasks.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    prompt TEXT,
    cwd TEXT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    exit_code INTEGER,
    signal TEXT
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    stream TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, id);
  CREATE TABLE IF NOT EXISTS layout (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Mark any tasks left "running" from a prior process as crashed.
db.prepare(`UPDATE tasks SET status = 'crashed', ended_at = ? WHERE status = 'running'`).run(Date.now());

const stmts = {
  insertTask: db.prepare(`INSERT INTO tasks (agent_id, prompt, cwd, status, started_at) VALUES (?, ?, ?, 'running', ?)`),
  finishTask: db.prepare(`UPDATE tasks SET status = ?, ended_at = ?, exit_code = ?, signal = ? WHERE id = ?`),
  insertEvent: db.prepare(`INSERT INTO events (task_id, ts, stream, data) VALUES (?, ?, ?, ?)`),
  listTasks: db.prepare(`SELECT * FROM tasks ORDER BY id DESC LIMIT ?`),
  getTask: db.prepare(`SELECT * FROM tasks WHERE id = ?`),
  listEvents: db.prepare(`SELECT * FROM events WHERE task_id = ? ORDER BY id ASC`),
  deleteEvents: db.prepare(`DELETE FROM events WHERE task_id = ?`),
  deleteOldEvents: db.prepare(`DELETE FROM events WHERE ts < ?`),
  deleteExcessEventsPerTask: db.prepare(`
    DELETE FROM events
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY id DESC) AS rn
        FROM events
      )
      WHERE rn > ?
    )
  `),
  deleteTaskRow: db.prepare(`DELETE FROM tasks WHERE id = ?`),
  hasTask: db.prepare(`SELECT 1 FROM tasks WHERE id = ?`),
  listTaskIds: db.prepare(`SELECT id FROM tasks`),
  getLayout: db.prepare(`SELECT value FROM layout WHERE key = 'cards'`),
  saveLayout: db.prepare(`INSERT INTO layout (key, value) VALUES ('cards', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
  countEvents: db.prepare(`SELECT COUNT(*) AS count FROM events`),
};

const deleteTaskTxn = db.transaction((id) => {
  stmts.deleteEvents.run(id);
  stmts.deleteTaskRow.run(id);
});

const insertBatch = db.transaction((task_id, evs) =>
  evs.map((ev) => stmts.insertEvent.run(task_id, ev.ts, ev.stream, ev.data).lastInsertRowid)
);

module.exports = {
  createTask: (agent_id, prompt, cwd) => stmts.insertTask.run(agent_id, prompt, cwd, Date.now()).lastInsertRowid,
  finishTask: (id, status, exitCode, signal) => stmts.finishTask.run(status, Date.now(), exitCode, signal, id),
  appendEvent: (task_id, ts, stream, data) => stmts.insertEvent.run(task_id, ts, stream, data),
  appendEvents: (task_id, evs) => insertBatch(task_id, evs),
  listTasks: (limit = 100) => stmts.listTasks.all(limit),
  getTask: (id) => stmts.getTask.get(id),
  listEvents: (task_id) => stmts.listEvents.all(task_id),
  deleteTask: (id) => deleteTaskTxn(id),
  hasTask: (id) => !!stmts.hasTask.get(id),
  listTaskIds: () => stmts.listTaskIds.all().map((row) => row.id),
  pruneEvents: ({ olderThanTs, maxPerTask, vacuumThreshold = 0 }) => {
    const hasAgeLimit = Number.isFinite(olderThanTs);
    const hasPerTaskLimit = Number.isFinite(maxPerTask) && maxPerTask > 0;
    if (!hasAgeLimit && !hasPerTaskLimit) return { deleted: 0, vacuumed: false };
    let deleted = 0;
    if (hasAgeLimit) deleted += stmts.deleteOldEvents.run(olderThanTs).changes;
    if (hasPerTaskLimit) deleted += stmts.deleteExcessEventsPerTask.run(maxPerTask).changes;
    let vacuumed = false;
    if (vacuumThreshold > 0 && deleted >= vacuumThreshold) {
      db.exec('VACUUM');
      vacuumed = true;
    }
    return { deleted, vacuumed };
  },
  getLayout: () => { const row = stmts.getLayout.get(); return row ? row.value : null; },
  saveLayout: (value) => stmts.saveLayout.run(value),
  countEvents: () => stmts.countEvents.get().count,
};
