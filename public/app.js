const $ = (sel) => document.querySelector(sel);

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const stripAnsi = (s) => s.replace(ANSI_RE, '');

let agentsById = new Map();
let currentTaskId = null;
let currentAgentId = null;
let currentSource = null;

async function loadHealth() {
  try {
    const r = await fetch('/api/health');
    const data = await r.json();
    $('#health').textContent = `pid ${data.pid} · up ${Math.round(data.uptime)}s`;
  } catch (_) {
    $('#health').textContent = 'offline';
  }
}

async function loadAgents() {
  const r = await fetch('/api/agents');
  const agents = await r.json();
  agentsById = new Map(agents.map((a) => [a.id, a]));

  const list = $('#agent-list');
  const select = $('#agent-select');
  list.replaceChildren();
  select.replaceChildren();

  for (const a of agents) {
    const li = document.createElement('li');
    li.textContent = a.name;
    if (a.interactive) li.classList.add('interactive');
    const sub = document.createElement('small');
    sub.textContent = `${a.command}${a.interactive ? ' · interactive' : ''}`;
    li.appendChild(sub);
    list.appendChild(li);

    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name + (a.interactive ? ' · interactive' : '');
    select.appendChild(opt);
  }
}

function fmtTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString();
}

async function loadHistory() {
  const r = await fetch('/api/tasks');
  const tasks = await r.json();
  const list = $('#history-list');
  list.replaceChildren();

  for (const t of tasks) {
    const li = document.createElement('li');
    if (t.id === currentTaskId) li.classList.add('active');

    const left = document.createElement('span');
    left.innerHTML = `#${t.id} <span class="task-meta">${t.agent_id}</span>`;
    const right = document.createElement('span');
    right.className = `status-${t.status}`;
    right.textContent = t.status;

    li.appendChild(left);
    li.appendChild(right);
    li.title = `${fmtTime(t.started_at)} → ${fmtTime(t.ended_at) || '…'}`;
    li.addEventListener('click', () => attachTask(t.id, t.agent_id));
    list.appendChild(li);
  }
}

function appendOutput(ev) {
  const out = $('#output');
  const span = document.createElement('span');
  if (ev.stream === 'stderr') span.className = 'stderr';
  else if (ev.stream === 'stdin') span.className = 'stdin';
  span.textContent = stripAnsi(ev.data);
  out.appendChild(span);
  out.scrollTop = out.scrollHeight;
}

function setRunning(running, agentId) {
  $('#kill-btn').hidden = !running;
  $('#task-status').textContent = running ? 'running…' : '';
  const agent = agentsById.get(agentId);
  const showInput = running && agent && agent.interactive;
  $('#input-form').hidden = !showInput;
  if (showInput) $('#input-line').focus();
}

function attachTask(taskId, agentId) {
  if (currentSource) {
    currentSource.close();
    currentSource = null;
  }
  currentTaskId = taskId;
  currentAgentId = agentId;
  $('#output-title').textContent = `Output — Task #${taskId}`;
  $('#output').replaceChildren();
  setRunning(true, agentId);
  loadHistory();

  const src = new EventSource(`/api/stream/${taskId}`);
  currentSource = src;

  src.addEventListener('output', (e) => {
    try { appendOutput(JSON.parse(e.data)); } catch (_) {}
  });
  src.addEventListener('end', (e) => {
    let info = {};
    try { info = JSON.parse(e.data); } catch (_) {}
    const tag = document.createElement('span');
    tag.className = 'stderr';
    tag.textContent = `\n[exit ${info.exitCode ?? '?'}${info.signal ? ' ' + info.signal : ''}]\n`;
    $('#output').appendChild(tag);
    setRunning(false, agentId);
    src.close();
    if (currentSource === src) currentSource = null;
    loadHistory();
  });
  src.onerror = () => {
    setRunning(false, agentId);
    src.close();
    if (currentSource === src) currentSource = null;
  };
}

$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const agentId = $('#agent-select').value;
  const body = { agent_id: agentId, prompt: $('#prompt').value };
  const cwd = $('#cwd').value.trim();
  if (cwd) body.cwd = cwd;

  const r = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    alert(data.error || 'failed to start task');
    return;
  }
  attachTask(data.task_id, agentId);
});

$('#kill-btn').addEventListener('click', async () => {
  if (!currentTaskId) return;
  await fetch(`/api/tasks/${currentTaskId}/kill`, { method: 'POST' });
});

$('#refresh-btn').addEventListener('click', loadHistory);

$('#input-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentTaskId) return;
  const line = $('#input-line').value;
  $('#input-line').value = '';
  await fetch(`/api/tasks/${currentTaskId}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: line + '\r' }),
  });
});

// ⌃C support: when input box is focused, Ctrl-C sends \x03 instead of copying.
$('#input-line').addEventListener('keydown', async (e) => {
  if (e.ctrlKey && e.key === 'c' && currentTaskId) {
    e.preventDefault();
    await fetch(`/api/tasks/${currentTaskId}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: '\x03' }),
    });
  }
});

// --- settings dialog -------------------------------------------------------

const dlg = $('#settings-dialog');
const agentForm = $('#agent-form');
let editingId = null;

function setFormMode(mode, agent) {
  editingId = mode === 'edit' ? agent.id : null;
  $('#agent-form-title').textContent = mode === 'edit' ? `Edit agent: ${agent.id}` : 'Add agent';
  $('#agent-submit').textContent = mode === 'edit' ? 'Save' : 'Add';
  $('#agent-cancel').hidden = mode !== 'edit';
  agentForm.id.value = agent?.id || '';
  agentForm.id.disabled = mode === 'edit';
  agentForm.name.value = agent?.name || '';
  agentForm.command.value = agent?.command || '';
  agentForm.args.value = (agent?.args || []).join(' ');
  agentForm.interactive.checked = !!agent?.interactive;
}

async function refreshAgentsTable() {
  const r = await fetch('/api/agents');
  const agents = await r.json();
  const tbody = $('#agents-table tbody');
  tbody.replaceChildren();
  for (const a of agents) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${a.id}</td>
      <td>${a.name || ''}</td>
      <td><code>${a.command}${a.args ? ' ' + a.args.join(' ') : ''}</code></td>
      <td>${a.interactive ? 'PTY' : 'piped'}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector('.actions');
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'row-btn';
    editBtn.textContent = 'edit';
    editBtn.addEventListener('click', () => setFormMode('edit', a));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'row-btn danger';
    delBtn.textContent = 'delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete agent "${a.id}"?`)) return;
      const r = await fetch(`/api/agents/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
      if (!r.ok) { alert('delete failed'); return; }
      await refreshAgentsTable();
      await loadAgents();
    });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    tbody.appendChild(tr);
  }
}

async function refreshDiscoverTable() {
  const r = await fetch('/api/agents/discover');
  const items = await r.json();
  const existing = new Set((await (await fetch('/api/agents')).json()).map((a) => a.id));
  const tbody = $('#discover-table tbody');
  tbody.replaceChildren();
  for (const it of items) {
    const tr = document.createElement('tr');
    const pathCell = it.found
      ? `<span class="found">${it.found}</span>`
      : `<span class="muted">not found</span>`;
    tr.innerHTML = `
      <td>${it.id}</td>
      <td><code>${it.command}</code></td>
      <td>${pathCell}</td>
      <td class="actions"></td>`;
    const actions = tr.querySelector('.actions');
    if (it.found && !existing.has(it.id)) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'row-btn';
      addBtn.textContent = 'add';
      addBtn.addEventListener('click', async () => {
        const r = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: it.id,
            name: it.name,
            command: it.found,
            interactive: it.interactive,
          }),
        });
        if (!r.ok) { alert('add failed'); return; }
        await refreshAgentsTable();
        await refreshDiscoverTable();
        await loadAgents();
      });
      actions.appendChild(addBtn);
    } else if (existing.has(it.id)) {
      actions.innerHTML = '<span class="muted">already added</span>';
    }
    tbody.appendChild(tr);
  }
}

agentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const args = agentForm.args.value.trim() ? agentForm.args.value.trim().split(/\s+/) : [];
  const payload = {
    name: agentForm.name.value.trim() || agentForm.id.value.trim(),
    command: agentForm.command.value.trim(),
    interactive: agentForm.interactive.checked,
    args,
  };
  let r;
  if (editingId) {
    r = await fetch(`/api/agents/${encodeURIComponent(editingId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } else {
    payload.id = agentForm.id.value.trim();
    r = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    alert(err.error || 'save failed');
    return;
  }
  setFormMode('add');
  await refreshAgentsTable();
  await loadAgents();
});

$('#agent-cancel').addEventListener('click', (e) => { e.preventDefault(); setFormMode('add'); });
$('#discover-btn').addEventListener('click', refreshDiscoverTable);
$('#close-settings').addEventListener('click', () => dlg.close());
$('#open-settings').addEventListener('click', async () => {
  setFormMode('add');
  $('#discover-table tbody').replaceChildren();
  await refreshAgentsTable();
  dlg.showModal();
});

loadHealth();
loadAgents();
loadHistory();
setInterval(loadHealth, 10000);
