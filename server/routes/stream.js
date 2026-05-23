const express = require('express');
const manager = require('../manager');
const store = require('../store');

const router = express.Router();

router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const task = store.getTask(id);
  if (!task) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Support reconnection without duplicate output.
  // EventSource automatically sends Last-Event-ID on reconnect when the server
  // includes id: fields. A ?since= query param is used when the client manually
  // recreates the EventSource (e.g. after visibilitychange / online events).
  // Both values are the SQLite event row id — monotonic, unique, no same-ms
  // collision — so resumption is exact even when multiple events share a ts.
  const rawLastId = req.headers['last-event-id'];
  const rawSince = req.query.since;
  const resumeAfter = rawLastId ? parseInt(rawLastId, 10)
    : rawSince ? parseInt(rawSince, 10)
    : null;

  // Include an id: field on output events so the browser tracks Last-Event-ID
  // and sends it automatically when EventSource auto-reconnects.
  const sse = (event, data, id = null) => {
    let msg = '';
    if (id !== null) msg += `id: ${id}\n`;
    msg += `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(msg);
  };

  const entry = manager.getLive(id);

  if (entry) {
    // Subscribe BEFORE reading DB. Because store.appendEvents (the batch flush)
    // runs synchronously before broadcast.emit for every batch, every event
    // committed to the DB at this moment is exactly the set of events that have
    // been broadcast before our subscription — no duplicates and no gaps.
    const onEvent = (ev) => sse('output', ev, ev.id);
    const onEnd = (info) => {
      sse('end', info);
      entry.broadcast.off('event', onEvent);
      entry.broadcast.off('end', onEnd);
      res.end();
    };
    entry.broadcast.on('event', onEvent);
    entry.broadcast.on('end', onEnd);

    const events = store.listEvents(id);
    for (const ev of events) {
      // Skip events already delivered to this client (reconnect resumption).
      // Compare by row id (not ts) — row ids are unique and monotonic.
      if (resumeAfter !== null && ev.id <= resumeAfter) continue;
      sse('output', { stream: ev.stream, data: ev.data, ts: ev.ts, id: ev.id }, ev.id);
    }

    req.on('close', () => {
      entry.broadcast.off('event', onEvent);
      entry.broadcast.off('end', onEnd);
    });
    return;
  }

  // Task already finished — replay from DB and close.
  const events = store.listEvents(id);
  for (const ev of events) {
    // Skip events already delivered to this client (reconnect resumption).
    if (resumeAfter !== null && ev.id <= resumeAfter) continue;
    sse('output', { stream: ev.stream, data: ev.data, ts: ev.ts, id: ev.id }, ev.id);
  }
  sse('end', { exitCode: task.exit_code, signal: task.signal, status: task.status });
  res.end();
});

module.exports = router;
