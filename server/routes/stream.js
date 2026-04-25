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

  const sse = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const entry = manager.getLive(id);

  if (entry) {
    // Subscribe BEFORE reading DB. Because store.appendEvent runs synchronously
    // before broadcast.emit in the runner handler, every event committed to the
    // DB at this moment is exactly the set of events that have been broadcast
    // before our subscription — no duplicates and no gaps.
    const onEvent = (ev) => sse('output', ev);
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
      sse('output', { stream: ev.stream, data: ev.data, ts: ev.ts });
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
    sse('output', { stream: ev.stream, data: ev.data, ts: ev.ts });
  }
  sse('end', { exitCode: task.exit_code, signal: task.signal, status: task.status });
  res.end();
});

module.exports = router;
