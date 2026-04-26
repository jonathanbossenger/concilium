const { spawn } = require('child_process');
const { EventEmitter } = require('events');

let pty;
function loadPty() {
  if (!pty) pty = require('node-pty');
  return pty;
}

function startTask(agent, prompt, cwd) {
  return agent.interactive ? startPty(agent, prompt, cwd) : startPiped(agent, prompt, cwd);
}

function startPiped(agent, prompt, cwd) {
  const emitter = new EventEmitter();
  const child = spawn(agent.command, agent.args || [], {
    cwd,
    env: process.env,
  });

  emitter.pid = child.pid;
  emitter.kill = (sig = 'SIGTERM') => {
    try { child.kill(sig); } catch (_) { /* gone */ }
  };
  emitter.write = null; // not supported in piped mode
  emitter.resize = null; // not a PTY

  child.stdout.on('data', (d) => {
    emitter.emit('event', { stream: 'stdout', data: d.toString(), ts: Date.now() });
  });
  child.stderr.on('data', (d) => {
    emitter.emit('event', { stream: 'stderr', data: d.toString(), ts: Date.now() });
  });
  child.on('error', (err) => {
    emitter.emit('event', { stream: 'stderr', data: `[spawn error] ${err.message}\n`, ts: Date.now() });
  });
  child.on('close', (code, signal) => {
    emitter.emit('end', { exitCode: code, signal, ts: Date.now() });
  });

  if (prompt) {
    try { child.stdin.write(prompt); } catch (_) {}
  }
  try { child.stdin.end(); } catch (_) {}

  return emitter;
}

function startPty(agent, prompt, cwd) {
  const ptyMod = loadPty();
  const emitter = new EventEmitter();

  let term;
  try {
    term = ptyMod.spawn(agent.command, agent.args || [], {
      cwd,
      env: process.env,
      cols: 120,
      rows: 30,
      name: 'xterm-256color',
    });
  } catch (err) {
    setImmediate(() => {
      emitter.emit('event', { stream: 'stderr', data: `[spawn error] ${err.message}\n`, ts: Date.now() });
      emitter.emit('end', { exitCode: -1, signal: null, ts: Date.now() });
    });
    emitter.kill = () => {};
    emitter.write = () => false;
    emitter.resize = () => false;
    return emitter;
  }

  emitter.pid = term.pid;
  emitter.kill = (sig = 'SIGTERM') => {
    try { term.kill(sig); } catch (_) { /* gone */ }
  };
  emitter.write = (data) => {
    try { term.write(data); return true; } catch (_) { return false; }
  };
  emitter.resize = (cols, rows) => {
    try { term.resize(cols, rows); return true; } catch (_) { return false; }
  };

  term.onData((data) => {
    // PTY merges stdout+stderr.
    emitter.emit('event', { stream: 'stdout', data, ts: Date.now() });
  });
  term.onExit(({ exitCode, signal }) => {
    // node-pty reports `signal: 0` when there was no signal — normalize to null.
    const sig = (signal == null || signal === 0) ? null : String(signal);
    emitter.emit('end', { exitCode, signal: sig, ts: Date.now() });
  });

  if (prompt) {
    try { term.write(prompt); } catch (_) {}
  }

  return emitter;
}

module.exports = { startTask };
