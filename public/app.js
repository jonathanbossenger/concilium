const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => root.querySelectorAll(sel);

let agentsById = new Map();
const cards = new Set();

const TERM_THEME = {
  background: '#000000',
  foreground: '#dddddd',
  cursor: '#dddddd',
  selectionBackground: '#264f78',
};

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
    this.cwdBrowse = $('.card-cwd-browse', this.el);
    this.runBtn = $('.card-run', this.el);
    this.killBtn = $('.card-kill', this.el);
    this.closeBtn = $('.card-close', this.el);
    this.expandBtn = $('.card-expand', this.el);
    this.statusEl = $('.card-status', this.el);
    this.termEl = $('.card-term', this.el);
    this.taskForm = $('.card-form', this.el);

    this.taskIds = new Set();
    this.currentTaskId = null;
    this.currentSource = null;
    this.term = null;
    this.fitAddon = null;
    this.resizeObserver = null;
    this.lastSentSize = null;

    this.refreshAgentSelect();

    this.taskForm.addEventListener('submit', (e) => { e.preventDefault(); this.run(); });
    this.cwdBrowse.addEventListener('click', () => this.browseCwd());
    this.killBtn.addEventListener('click', () => this.kill());
    this.closeBtn.addEventListener('click', () => this.close());
    this.expandBtn.addEventListener('click', () => this.toggleExpand());

    cards.add(this);
  }

  // Must be called AFTER the card element is attached to the DOM, so the
  // FitAddon can measure the container.
  initTerminal() {
    this.term = new Terminal({
      theme: TERM_THEME,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      fontSize: 12,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
    });
    this.fitAddon = new FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.termEl);
    this.term.writeln('\x1b[2m(select an agent and click Start)\x1b[0m');

    // User keystrokes → server stdin (only when a task is live).
    this.term.onData((data) => {
      if (this.currentTaskId) this.sendRaw(data);
    });

    // Refit + push new size to the PTY when the container changes.
    this.resizeObserver = new ResizeObserver(() => this.fitAndResize());
    this.resizeObserver.observe(this.termEl);
    requestAnimationFrame(() => this.fitAndResize());
  }

  fitAndResize() {
    if (!this.fitAddon || !this.termEl.isConnected) return;
    if (this.termEl.clientWidth === 0 || this.termEl.clientHeight === 0) return;
    try { this.fitAddon.fit(); } catch (_) { return; }
    const cols = this.term.cols;
    const rows = this.term.rows;
    const sig = `${cols}x${rows}`;
    if (sig === this.lastSentSize) return;
    this.lastSentSize = sig;
    if (!this.currentTaskId) return;
    fetch(`/api/tasks/${this.currentTaskId}/resize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    }).catch(() => {});
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
    if (running) this.term.focus();
  }

  async run() {
    const agentId = this.agentSelect.value;
    if (!agentId) { this.setStatus('select an agent', 'err'); return; }

    if (this.currentSource) { this.currentSource.close(); this.currentSource = null; }
    this.term.reset();
    this.lastSentSize = null;

    const body = { agent_id: agentId };
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
    // Push our current dimensions to the freshly spawned PTY.
    this.fitAndResize();
  }

  attach(taskId) {
    this.currentTaskId = taskId;
    this.setStatus(`task #${taskId} running…`, 'running');
    this.setRunning(true);

    const src = new EventSource(`/api/stream/${taskId}`);
    this.currentSource = src;

    src.addEventListener('output', (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch (_) { return; }
      // Skip stdin events: the PTY echoes user input back as stdout, so
      // rendering stdin would double-print every keystroke.
      if (ev.stream === 'stdin') return;
      this.term.write(ev.data);
    });
    src.addEventListener('end', (e) => {
      let info = {};
      try { info = JSON.parse(e.data); } catch (_) {}
      const tail = `\r\n\x1b[2m[exit ${info.exitCode ?? '?'}${info.signal ? ' ' + info.signal : ''}]\x1b[0m\r\n`;
      this.term.write(tail);
      this.setStatus(`task #${taskId} ${info.status || 'ended'}`, info.status === 'done' ? 'ok' : 'err');
      this.setRunning(false);
      src.close();
      if (this.currentSource === src) this.currentSource = null;
      this.currentTaskId = null;
    });
    src.onerror = () => {
      this.setRunning(false);
      src.close();
      if (this.currentSource === src) this.currentSource = null;
    };
  }

  toggleExpand() {
    const main = $('#cards');
    const willExpand = !this.el.classList.contains('expanded');
    const apply = () => {
      for (const c of cards) c.el.classList.remove('expanded');
      if (willExpand) {
        this.el.classList.add('expanded');
        main.classList.add('has-expanded');
        this.expandBtn.innerHTML = '&#x2921;';
        this.expandBtn.title = 'Collapse';
      } else {
        main.classList.remove('has-expanded');
        this.expandBtn.innerHTML = '&#x2922;';
        this.expandBtn.title = 'Expand';
      }
    };
    if (!document.startViewTransition) { apply(); return; }
    this.el.style.viewTransitionName = 'card-active';
    const t = document.startViewTransition(apply);
    t.finished.finally(() => { this.el.style.viewTransitionName = ''; });
  }

  async browseCwd() {
    this.cwdBrowse.disabled = true;
    try {
      const r = await fetch('/api/system/pick-directory', { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { this.setStatus(data.error || 'browse failed', 'err'); return; }
      if (data.path) this.cwd.value = data.path;
    } finally {
      this.cwdBrowse.disabled = false;
    }
  }

  async kill() {
    if (!this.currentTaskId) return;
    await fetch(`/api/tasks/${this.currentTaskId}/kill`, { method: 'POST' });
  }

  sendRaw(data) {
    if (!this.currentTaskId) return;
    fetch(`/api/tasks/${this.currentTaskId}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    }).catch(() => {});
  }

  async close() {
    if (this.currentSource) { this.currentSource.close(); this.currentSource = null; }
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.term) { try { this.term.dispose(); } catch (_) {} this.term = null; }
    if (this.el.classList.contains('expanded')) {
      $('#cards').classList.remove('has-expanded');
    }
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
  card.initTerminal();
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
