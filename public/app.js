const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => root.querySelectorAll(sel);

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const stripAnsi = (s) => s.replace(ANSI_RE, '');

let agentsById = new Map();
const cards = new Set();

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
  for (const card of cards) card.refreshAgentSelect();
}

function fillAgentSelect(select, currentValue) {
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— select agent —';
  placeholder.disabled = true;
  placeholder.selected = !currentValue;
  select.appendChild(placeholder);
  for (const a of agentsById.values()) {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name + (a.interactive ? ' · interactive' : '');
    if (currentValue === a.id) opt.selected = true;
    select.appendChild(opt);
  }
}

class Card {
  constructor() {
    const tpl = $('#card-template');
    this.el = tpl.content.firstElementChild.cloneNode(true);
    this.agentSelect = $('.card-agent', this.el);
    this.cwd = $('.card-cwd', this.el);
    this.prompt = $('.card-prompt', this.el);
    this.runBtn = $('.card-run', this.el);
    this.killBtn = $('.card-kill', this.el);
    this.clearBtn = $('.card-clear', this.el);
    this.closeBtn = $('.card-close', this.el);
    this.statusEl = $('.card-status', this.el);
    this.output = $('.card-output', this.el);
    this.inputForm = $('.card-input-form', this.el);
    this.inputLine = $('.card-input-line', this.el);
    this.taskForm = $('.card-form', this.el);

    this.taskIds = new Set();
    this.currentTaskId = null;
    this.currentSource = null;

    this.refreshAgentSelect();

    this.taskForm.addEventListener('submit', (e) => { e.preventDefault(); this.run(); });
    this.killBtn.addEventListener('click', () => this.kill());
    this.clearBtn.addEventListener('click', () => { this.output.replaceChildren(); });
    this.closeBtn.addEventListener('click', () => this.close());
    this.inputForm.addEventListener('submit', (e) => { e.preventDefault(); this.sendInput(); });
    this.inputLine.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'c' && this.currentTaskId) {
        e.preventDefault();
        this.sendRaw('\x03');
      }
    });

    cards.add(this);
  }

  refreshAgentSelect() {
    fillAgentSelect(this.agentSelect, this.agentSelect.value);
  }

  setStatus(text, cls) {
    this.statusEl.textContent = text;
    this.statusEl.className = 'card-status' + (cls ? ' ' + cls : '');
  }

  setRunning(running) {
    this.killBtn.hidden = !running;
    this.runBtn.disabled = running;
    const agent = agentsById.get(this.agentSelect.value);
    const showInput = running && agent && agent.interactive;
    this.inputForm.hidden = !showInput;
    if (showInput) this.inputLine.focus();
  }

  appendOutput(ev) {
    const span = document.createElement('span');
    if (ev.stream === 'stderr') span.className = 'stderr';
    else if (ev.stream === 'stdin') span.className = 'stdin';
    span.textContent = stripAnsi(ev.data);
    this.output.appendChild(span);
    this.output.scrollTop = this.output.scrollHeight;
  }

  async run() {
    const agentId = this.agentSelect.value;
    if (!agentId) { this.setStatus('select an agent', 'err'); return; }

    if (this.currentSource) { this.currentSource.close(); this.currentSource = null; }
    this.output.replaceChildren();

    const body = { agent_id: agentId, prompt: this.prompt.value };
    const cwd = this.cwd.value.trim();
    if (cwd) body.cwd = cwd;

    const r = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) { this.setStatus(data.error || 'failed', 'err'); return; }

    this.taskIds.add(data.task_id);
    this.attach(data.task_id);
  }

  attach(taskId) {
    this.currentTaskId = taskId;
    this.setStatus(`task #${taskId} running…`, 'running');
    this.setRunning(true);

    const src = new EventSource(`/api/stream/${taskId}`);
    this.currentSource = src;

    src.addEventListener('output', (e) => {
      try { this.appendOutput(JSON.parse(e.data)); } catch (_) {}
    });
    src.addEventListener('end', (e) => {
      let info = {};
      try { info = JSON.parse(e.data); } catch (_) {}
      const tag = document.createElement('span');
      tag.className = 'stderr';
      tag.textContent = `\n[exit ${info.exitCode ?? '?'}${info.signal ? ' ' + info.signal : ''}]\n`;
      this.output.appendChild(tag);
      this.setStatus(`task #${taskId} ${info.status || 'ended'}`, info.status === 'done' ? 'ok' : 'err');
      this.setRunning(false);
      src.close();
      if (this.currentSource === src) this.currentSource = null;
    });
    src.onerror = () => {
      this.setRunning(false);
      src.close();
      if (this.currentSource === src) this.currentSource = null;
    };
  }

  async kill() {
    if (!this.currentTaskId) return;
    await fetch(`/api/tasks/${this.currentTaskId}/kill`, { method: 'POST' });
  }

  async sendInput() {
    const line = this.inputLine.value;
    this.inputLine.value = '';
    await this.sendRaw(line + '\r');
  }

  async sendRaw(data) {
    if (!this.currentTaskId) return;
    await fetch(`/api/tasks/${this.currentTaskId}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    });
  }

  async close() {
    if (this.currentSource) { this.currentSource.close(); this.currentSource = null; }
    const ids = [...this.taskIds];
    this.taskIds.clear();
    cards.delete(this);
    this.el.remove();
    // Fire-and-forget deletes; server will kill any still-running tasks first.
    await Promise.all(ids.map((id) =>
      fetch(`/api/tasks/${id}`, { method: 'DELETE' }).catch(() => {})
    ));
  }
}

function addCard() {
  const card = new Card();
  $('#cards').appendChild(card.el);
  return card;
}

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

$('#new-card-btn').addEventListener('click', () => addCard());

// --- theme ----------------------------------------------------------------

const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };

function currentTheme() {
  return document.documentElement.dataset.theme || 'auto';
}
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  } else {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem('theme');
  }
  updateThemeButton();
}
function updateThemeButton() {
  const t = currentTheme();
  const btn = $('#theme-toggle');
  btn.textContent = THEME_LABEL[t];
  btn.title = `Theme: ${THEME_LABEL[t]} (click to cycle)`;
}
$('#theme-toggle').addEventListener('click', () => {
  const i = THEME_ORDER.indexOf(currentTheme());
  applyTheme(THEME_ORDER[(i + 1) % THEME_ORDER.length]);
});
updateThemeButton();

// --- bootstrap -------------------------------------------------------------

(async () => {
  await loadHealth();
  await loadAgents();
  addCard();
  setInterval(loadHealth, 10000);
})();
