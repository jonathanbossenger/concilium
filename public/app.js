const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => root.querySelectorAll(sel);

let agentsById = new Map();
const cards = new Set();
const termCards = new Set();
let draggingCardEl = null;

let layoutReady = false;
let homeDir = '';

function currentTermTheme() {
  const s = getComputedStyle(document.documentElement);
  return {
    background: s.getPropertyValue('--term-bg').trim() || '#111111',
    foreground: s.getPropertyValue('--term-fg').trim() || '#dddddd',
    cursor: s.getPropertyValue('--term-cursor').trim() || '#dddddd',
    selectionBackground: s.getPropertyValue('--term-selection').trim() || 'rgba(120,180,255,0.30)',
  };
}

async function loadHealth() {
  try {
    const r = await fetch('/api/health');
    const data = await r.json();
    $('#health').textContent = `pid ${data.pid} · up ${Math.round(data.uptime)}s`;
    if (data.homeDir) homeDir = data.homeDir;
  } catch (_) {
    $('#health').textContent = 'offline';
  }
}

function toTildePath(p) {
  if (homeDir && (p === homeDir || p.startsWith(homeDir + '/'))) {
    return '~' + p.slice(homeDir.length);
  }
  return p;
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

function cardInsertTarget(main, clientX, clientY) {
  const siblings = [...main.querySelectorAll('.card:not(.dragging)')];
  if (siblings.length === 0) return null;
  let closestCard = null;
  let closestRect = null;
  let closestDist = Number.POSITIVE_INFINITY;
  for (const el of siblings) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = dx * dx + dy * dy;
    if (dist < closestDist) {
      closestDist = dist;
      closestCard = el;
      closestRect = rect;
    }
  }
  if (!closestCard || !closestRect) return null;
  const dx = clientX - (closestRect.left + closestRect.width / 2);
  const dy = clientY - (closestRect.top + closestRect.height / 2);
  const before = Math.abs(dx) > Math.abs(dy) ? dx < 0 : dy < 0;
  return before ? closestCard : closestCard.nextElementSibling;
}

function enableCardDragging(cardEl, handleEl) {
  handleEl.draggable = true;

  handleEl.addEventListener('dragstart', (e) => {
    const target = e.target;
    if (target && target.closest('button, select, input, a, .card-actions, .card-status')) {
      e.preventDefault();
      return;
    }
    if (cardEl.classList.contains('expanded')) {
      e.preventDefault();
      return;
    }
    draggingCardEl = cardEl;
    cardEl.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'card');
    }
  });

  handleEl.addEventListener('dragend', () => {
    cardEl.classList.remove('dragging');
    if (draggingCardEl === cardEl) draggingCardEl = null;
    saveLayout();
  });
}

class Card {
  constructor() {
    const tpl = $('#card-template');
    this.el = tpl.content.firstElementChild.cloneNode(true);
    this.agentSelect = $('.card-agent', this.el);
    this.cwd = $('.card-cwd', this.el);
    this.cwdBrowse = $('.card-cwd-browse', this.el);
    this.githubBtn = $('.card-github', this.el);
    this.runBtn = $('.card-run', this.el);
    this.openTermBtn = $('.card-open-term', this.el);
    this.cloneBtn = $('.card-clone', this.el);
    this.closeBtn = $('.card-close', this.el);
    this.expandBtn = $('.card-expand', this.el);
    this.statusEl = $('.card-status', this.el);
    this.termEl = $('.card-term', this.el);
    this.taskForm = $('.card-form', this.el);
    this.headerEl = $('.card-header', this.el);

    this.taskIds = new Set();
    this.currentTaskId = null;
    this.lastTaskId = null;
    this.currentSource = null;
    this.lastEventId = null;
    this._reconnecting = false;
    this._errorCheckPending = false;
    this.term = null;
    this.fitAddon = null;
    this.resizeObserver = null;
    this.lastSentSize = null;
    this._checkGitHubTimer = null;
    this._githubAbortCtrl = null;
    this.githubUrl = '';

    this.refreshAgentSelect();

    this.taskForm.addEventListener('submit', (e) => { e.preventDefault(); if (!this.currentTaskId) this.run(); });
    this.runBtn.addEventListener('click', (e) => { if (this.currentTaskId) { e.preventDefault(); this.kill(); } });
    this.cwdBrowse.addEventListener('click', () => this.browseCwd());
    this.closeBtn.addEventListener('click', () => this.close());
    this.expandBtn.addEventListener('click', () => this.toggleExpand());
    this.openTermBtn.addEventListener('click', () => addTerminalCard(this.cwd.value.trim(), this.el));
    this.cloneBtn.addEventListener('click', () => cloneCard(this));
    this.githubBtn.addEventListener('click', () => this.openGitHubCard());
    this.agentSelect.addEventListener('change', () => saveLayout());
    this.cwd.addEventListener('input', () => { saveLayout(); this.scheduleCheckGitHub(); });
    enableCardDragging(this.el, this.headerEl);

    cards.add(this);
  }

  // Must be called AFTER the card element is attached to the DOM, so the
  // FitAddon can measure the container.
  initTerminal() {
    this.term = new Terminal({
      theme: currentTermTheme(),
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

  applyTermTheme() {
    if (this.term) this.term.options.theme = currentTermTheme();
  }

  setStatus(text, cls) {
    this.statusEl.textContent = text;
    this.statusEl.className = 'card-status' + (cls ? ' ' + cls : '');
  }

  setRunning(running) {
    const label = running ? 'Kill' : 'Start';
    this.runBtn.innerHTML = `<span aria-hidden="true">${running ? '⏹' : '▶'}</span>`;
    this.runBtn.title = label;
    this.runBtn.setAttribute('aria-label', label);
    this.runBtn.classList.toggle('card-kill', running);
    if (running) this.term.focus();
  }

  async run() {
    const agentId = this.agentSelect.value;
    if (!agentId) { this.setStatus('select an agent', 'err'); return; }

    if (this.currentSource) { this.currentSource.close(); this.currentSource = null; }
    this.term.reset();
    this.lastEventId = null;
    this._reconnecting = false;
    this._errorCheckPending = false;
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
    this.lastTaskId = data.task_id;
    saveLayout();
    this.attach(data.task_id);
    // Push our current dimensions to the freshly spawned PTY.
    this.fitAndResize();
  }

  attach(taskId, taskHint = null) {
    this.currentTaskId = taskId;
    // A new source supersedes any previous recovery state — onopen for the new
    // source must not overwrite the status that attach() is about to set.
    this._reconnecting = false;
    // When restoring a finished task, don't pretend it is still running.
    // taskHint is the task row passed in by restoreLayout (already fetched);
    // null means a freshly-launched task, which is always live.
    const isLive = !taskHint || taskHint.status === 'running';
    this.setStatus(isLive ? 'task running…' : 'task restoring…', isLive ? 'running' : undefined);
    this.setRunning(isLive);

    // Include ?since= when we already have a lastEventId (SQLite row id) so
    // the server skips events the terminal has already rendered (avoids
    // duplicate output on manual reconnect after the EventSource was recreated).
    const streamUrl = this.lastEventId !== null
      ? `/api/stream/${taskId}?since=${this.lastEventId}`
      : `/api/stream/${taskId}`;
    const src = new EventSource(streamUrl);
    this.currentSource = src;

    // Restore running status when the EventSource (re)opens successfully.
    // Only do this when recovering from an onerror — on the initial connect
    // attach() has already set the correct status above.
    src.onopen = () => {
      if (this.currentTaskId === taskId && this._reconnecting) {
        this._reconnecting = false;
        this.setStatus('task running…', 'running');
      }
    };

    src.addEventListener('output', (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch (_) { return; }
      // Skip stdin events: the PTY echoes user input back as stdout, so
      // rendering stdin would double-print every keystroke.
      if (ev.stream === 'stdin') return;
      // Track the latest row id so we can resume from here if the stream is
      // interrupted and the EventSource needs to be recreated (?since=).
      if (ev.id) this.lastEventId = ev.id;
      this.term.write(ev.data);
    });
    src.addEventListener('end', (e) => {
      let info = {};
      try { info = JSON.parse(e.data); } catch (_) {}
      const tail = `\r\n\x1b[2m[exit ${info.exitCode ?? '?'}${info.signal ? ' ' + info.signal : ''}]\x1b[0m\r\n`;
      this.term.write(tail);
      this.setStatus(`task ${info.status || 'ended'}`, info.status === 'done' ? 'ok' : 'err');
      this.setRunning(false);
      src.close();
      if (this.currentSource === src) this.currentSource = null;
      this.currentTaskId = null;
    });
    src.onerror = () => {
      const capturedTaskId = this.currentTaskId;
      if (!capturedTaskId) { this.setRunning(false); return; }
      // Show reconnecting status but do NOT close the EventSource — the browser
      // will automatically retry (sending Last-Event-ID so the server skips
      // already-delivered events). This handles the common case of a laptop
      // sleeping/locking which causes ERR_NETWORK_IO_SUSPENDED.
      this._reconnecting = true;
      this.setStatus('task reconnecting…', 'warn');
      // Guard against multiple in-flight checks during extended backoff retries.
      if (this._errorCheckPending) return;
      this._errorCheckPending = true;
      // Re-fetch to check whether the task still exists. Close only on 404.
      fetch(`/api/tasks/${capturedTaskId}`).then((check) => {
        this._errorCheckPending = false;
        if (this.currentTaskId !== capturedTaskId) return; // superseded
        if (!check.ok) {
          // Task is gone — nothing to reconnect to.
          src.close();
          if (this.currentSource === src) this.currentSource = null;
          this.setStatus('task lost connection', 'err');
          this.currentTaskId = null;
          this.setRunning(false);
        }
        // Task still alive — EventSource will reconnect on its own.
      }).catch(() => {
        this._errorCheckPending = false;
        // fetch also failed — network is down; EventSource will keep retrying.
        if (this.currentTaskId !== capturedTaskId) return; // superseded
        this.setStatus('task reconnecting…', 'warn');
      });
    };
  }

  // Force-reconnect the stream for the current task. Called when the page
  // becomes visible again or the network comes back online after a device
  // sleep/lock, in case the EventSource ended up in a permanently closed state
  // rather than auto-reconnecting.
  async reconnectStream() {
    if (!this.currentTaskId) return;
    if (this.currentSource && this.currentSource.readyState !== EventSource.CLOSED) return;
    if (this.currentSource) {
      this.currentSource.close();
      this.currentSource = null;
    }
    const taskId = this.currentTaskId;
    let taskData;
    try {
      const r = await fetch(`/api/tasks/${taskId}`);
      if (this.currentTaskId !== taskId) return; // superseded
      if (!r.ok) {
        this.setStatus('task lost connection', 'err');
        this.currentTaskId = null;
        this.setRunning(false);
        return;
      }
      taskData = await r.json();
    } catch (_) {
      if (this.currentTaskId !== taskId) return; // superseded
      // Network still down — attach optimistically; onerror will keep retrying.
      taskData = { status: 'running' };
    }
    if (this.currentTaskId !== taskId) return; // superseded
    // Re-attach using the real task status. lastEventId is preserved so the new
    // EventSource URL includes ?since= and avoids duplicate terminal output.
    this.attach(taskId, taskData);
  }

  toggleExpand() {
    const main = $('#cards');
    const willExpand = !this.el.classList.contains('expanded');
    const apply = () => {
      for (const c of cards) c.el.classList.remove('expanded');
      for (const c of termCards) c.el.classList.remove('expanded');
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
      if (data.path) { this.cwd.value = toTildePath(data.path); saveLayout(); this.checkGitHub(); }
    } finally {
      this.cwdBrowse.disabled = false;
    }
  }

  scheduleCheckGitHub() {
    clearTimeout(this._checkGitHubTimer);
    this._checkGitHubTimer = setTimeout(() => this.checkGitHub(), 150);
  }

  async checkGitHub() {
    const dir = this.cwd.value.trim();
    if (!dir) { this.githubUrl = ''; this.githubBtn.hidden = true; return; }
    // Cancel any in-flight request so stale responses don't overwrite newer results.
    if (this._githubAbortCtrl) this._githubAbortCtrl.abort();
    this._githubAbortCtrl = new AbortController();
    const { signal } = this._githubAbortCtrl;
    try {
      const r = await fetch('/api/system/github-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: dir }),
        signal,
      });
      if (!r.ok) { this.githubUrl = ''; this.githubBtn.hidden = true; return; }
      const data = await r.json().catch(() => ({}));
      if (data.url) {
        this.githubUrl = data.url;
        this.githubBtn.hidden = false;
      } else {
        this.githubUrl = '';
        this.githubBtn.hidden = true;
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[concilium] checkGitHub failed:', err);
      this.githubUrl = '';
      this.githubBtn.hidden = true;
    }
  }

  openGitHubCard() {
    if (!this.githubUrl) return;
    addGitHubCard({ afterEl: this.el, repoUrl: this.githubUrl });
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
    clearTimeout(this._checkGitHubTimer);
    if (this._githubAbortCtrl) this._githubAbortCtrl.abort();
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
    saveLayout();
    // Fire-and-forget deletes; server will kill any still-running tasks first.
    await Promise.all(ids.map((id) =>
      fetch(`/api/tasks/${id}`, { method: 'DELETE' }).catch(() => {})
    ));
  }
}

class GitHubCard {
  constructor() {
    const tpl = $('#github-card-template');
    this.el = tpl.content.firstElementChild.cloneNode(true);
    this.titleEl = $('.card-term-label', this.el);
    this.statusEl = $('.card-status', this.el);
    this.closeBtn = $('.card-close', this.el);
    this.newIssueBtn = $('.card-new-issue', this.el);
    this.refreshBtn = $('.card-refresh', this.el);
    this.issuesEl = $('.github-issues', this.el);
    this.pullsEl = $('.github-prs', this.el);
    this.issuesLinkEl = $('.github-issues-link', this.el);
    this.pullsLinkEl = $('.github-prs-link', this.el);
    this.headerEl = $('.card-header', this.el);
    this._loadAbortCtrl = null;
    this.currentUrl = '';

    this.closeBtn.addEventListener('click', () => this.close());
    this.newIssueBtn.addEventListener('click', () => this.openNewIssueDialog());
    this.refreshBtn.addEventListener('click', () => this.load(this.currentUrl));
    enableCardDragging(this.el, this.headerEl);
  }

  setStatus(text, cls) {
    this.statusEl.textContent = text;
    this.statusEl.className = 'card-status' + (cls ? ' ' + cls : '');
  }

  renderList(el, items, emptyText) {
    el.replaceChildren();
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = emptyText;
      el.appendChild(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = `#${item.number} ${item.title}`;
      a.className = 'github-list-link';
      li.appendChild(a);
      if (item.branch) {
        const branchWrap = document.createElement('span');
        branchWrap.className = 'github-branch';
        const code = document.createElement('code');
        code.className = 'github-branch-name';
        code.textContent = item.branch;
        code.title = item.branch;
        branchWrap.appendChild(code);
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'github-branch-copy';
        copyBtn.setAttribute('aria-label', `Copy branch name ${item.branch}`);
        copyBtn.title = 'Copy branch name';
        copyBtn.innerHTML = '<svg height="14" width="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/></svg>';
        copyBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.copyBranch(item.branch, copyBtn);
        });
        branchWrap.appendChild(copyBtn);
        li.appendChild(branchWrap);
      }
      el.appendChild(li);
    }
  }

  async copyBranch(branch, btn) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(branch);
      } else {
        const ta = document.createElement('textarea');
        ta.value = branch;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      btn.classList.add('copied');
      btn.title = 'Copied!';
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(() => {
        btn.classList.remove('copied');
        btn.title = 'Copy branch name';
      }, 1200);
    } catch (err) {
      console.error('[concilium] branch copy failed:', err);
    }
  }

  setTitle(url) {
    if (!url) return;
    const short = url.replace(/^https:\/\/github\.com\//, '');
    this.titleEl.textContent = `GitHub — ${short}`;
    const base = url.replace(/\/+$/, '');
    this.currentUrl = base;
    this.newIssueBtn.hidden = false;
    this.pullsLinkEl.href = base + '/pulls';
    this.issuesLinkEl.href = base + '/issues';
  }

  openNewIssueDialog() {
    if (!this.currentUrl) return;
    openNewIssueDialog(this.currentUrl, async () => {
      await this.load(this.currentUrl);
      this.setStatus('issue created', 'ok');
    });
  }

  async load(repoUrlHint = '') {
    if (this._loadAbortCtrl) this._loadAbortCtrl.abort();
    this._loadAbortCtrl = new AbortController();
    const { signal } = this._loadAbortCtrl;
    this.setTitle(repoUrlHint);
    this.setStatus('loading…', 'running');
    this.renderList(this.issuesEl, [], 'loading…');
    this.renderList(this.pullsEl, [], 'loading…');
    this.refreshBtn.classList.add('spinning');
    this.refreshBtn.disabled = true;
    try {
      const r = await fetch('/api/system/github-items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: repoUrlHint }),
        signal,
      });
      let data = {};
      try {
        data = await r.json();
      } catch (_) {}
      if (!r.ok) {
        this.setStatus(data.error || 'failed', 'err');
        this.renderList(this.issuesEl, [], 'unable to load');
        this.renderList(this.pullsEl, [], 'unable to load');
        return;
      }
      const url = data.url || repoUrlHint;
      this.setTitle(url);
      this.renderList(this.issuesEl, Array.isArray(data.issues) ? data.issues : [], 'no open issues');
      this.renderList(this.pullsEl, Array.isArray(data.pulls) ? data.pulls : [], 'no open pull requests');
      this.setStatus(data.error || 'loaded', data.error ? 'warn' : 'ok');
    } catch (err) {
      if (err.name === 'AbortError') return;
      this.setStatus('failed', 'err');
      this.renderList(this.issuesEl, [], 'unable to load');
      this.renderList(this.pullsEl, [], 'unable to load');
    } finally {
      if (!signal.aborted) {
        this.refreshBtn.classList.remove('spinning');
        this.refreshBtn.disabled = false;
      }
    }
  }

  close() {
    if (this._loadAbortCtrl) this._loadAbortCtrl.abort();
    if (this.el.parentNode) this.el.remove();
  }
}

class TerminalCard {
  constructor() {
    const tpl = $('#terminal-card-template');
    this.el = tpl.content.firstElementChild.cloneNode(true);
    this.closeBtn = $('.card-close', this.el);
    this.expandBtn = $('.card-expand', this.el);
    this.statusEl = $('.card-status', this.el);
    this.termEl = $('.card-term', this.el);
    this.headerEl = $('.card-header', this.el);

    this.taskId = null;
    this.currentSource = null;
    this.term = null;
    this.fitAddon = null;
    this.resizeObserver = null;
    this.lastSentSize = null;

    this.closeBtn.addEventListener('click', () => this.close());
    this.expandBtn.addEventListener('click', () => this.toggleExpand());
    enableCardDragging(this.el, this.headerEl);

    termCards.add(this);
  }

  toggleExpand() {
    const main = $('#cards');
    const willExpand = !this.el.classList.contains('expanded');
    const apply = () => {
      for (const c of cards) c.el.classList.remove('expanded');
      for (const c of termCards) c.el.classList.remove('expanded');
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

  // Must be called AFTER the card element is attached to the DOM.
  initTerminal() {
    this.term = new Terminal({
      theme: currentTermTheme(),
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      fontSize: 12,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
    });
    this.fitAddon = new FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.termEl);

    this.term.onData((data) => {
      if (this.taskId) this.sendRaw(data);
    });

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
    if (!this.taskId) return;
    fetch(`/api/tasks/${this.taskId}/resize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    }).catch(() => {});
  }

  applyTermTheme() {
    if (this.term) this.term.options.theme = currentTermTheme();
  }

  setStatus(text, cls) {
    this.statusEl.textContent = text;
    this.statusEl.className = 'card-status' + (cls ? ' ' + cls : '');
  }

  sendRaw(data) {
    if (!this.taskId) return;
    fetch(`/api/tasks/${this.taskId}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    }).catch(() => {});
  }

  async launch(cwd) {
    const r = await fetch('/api/tasks/terminal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { this.setStatus(data.error || `failed to start terminal (${r.status})`, 'err'); return; }
    // Update label with cwd basename so multiple terminals are distinguishable.
    if (cwd) {
      const label = $('.card-term-label', this.el);
      if (label) label.textContent = `Terminal — ${cwd.split('/').filter(Boolean).pop() || cwd}`;
    }
    this.taskId = data.task_id;
    this.setStatus('running…', 'running');
    this.attach(data.task_id);
    this.lastSentSize = null; // force resize to be sent after taskId is set
    this.fitAndResize();
  }

  attach(taskId) {
    const src = new EventSource(`/api/stream/${taskId}`);
    this.currentSource = src;

    src.addEventListener('output', (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch (_) { return; }
      if (ev.stream === 'stdin') return;
      this.term.write(ev.data);
    });

    src.addEventListener('end', () => {
      src.close();
      if (this.currentSource === src) this.currentSource = null;
      this.close();
    });

    src.onerror = () => {
      if (!this.taskId) return;
      this.setStatus('reconnecting…', 'warn');
    };
  }

  async close() {
    termCards.delete(this);
    if (this.currentSource) { this.currentSource.close(); this.currentSource = null; }
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.term) { try { this.term.dispose(); } catch (_) {} this.term = null; }
    if (this.el.classList.contains('expanded')) {
      $('#cards').classList.remove('has-expanded');
    }
    const id = this.taskId;
    this.taskId = null;
    if (this.el.parentNode) this.el.remove();
    if (id) {
      await fetch(`/api/tasks/${id}`, { method: 'DELETE' }).catch(() => {});
    }
  }
}

function addTerminalCard(cwd, afterEl = null) {
  const card = new TerminalCard();
  const main = $('#cards');
  // Insert directly after the triggering card so the new terminal lands in
  // the next grid slot (same row if there's room, next row otherwise).
  // insertBefore(node, null) is equivalent to appendChild, so a missing or
  // detached afterEl falls back to end-of-grid cleanly.
  if (afterEl && afterEl.parentNode === main) {
    main.insertBefore(card.el, afterEl.nextSibling);
  } else {
    main.appendChild(card.el);
  }
  card.initTerminal();
  card.launch(cwd);
  return card;
}

function addGitHubCard({ afterEl = null, repoUrl = '' } = {}) {
  const card = new GitHubCard();
  const main = $('#cards');
  if (afterEl && afterEl.parentNode === main) {
    main.insertBefore(card.el, afterEl.nextSibling);
  } else {
    main.appendChild(card.el);
  }
  card.load(repoUrl);
  return card;
}

function cloneCard(sourceCard) {
  addCard({
    afterEl: sourceCard.el,
    agentId: sourceCard.agentSelect.value,
    cwd: sourceCard.cwd.value,
    autoRun: true,
  });
}

function addCard({ afterEl = null, agentId = '', cwd = '', autoRun = false } = {}) {
  const card = new Card();
  const main = $('#cards');
  if (afterEl && afterEl.parentNode === main) {
    main.insertBefore(card.el, afterEl.nextSibling);
  } else {
    main.appendChild(card.el);
  }
  card.initTerminal();
  if (agentId) card.agentSelect.value = agentId;
  if (cwd) { card.cwd.value = cwd; card.checkGitHub(); }
  saveLayout();
  if (autoRun && agentId) card.run();
  return card;
}

// --- session persistence ---------------------------------------------------

function currentLayoutState() {
  const order = [...$('#cards').querySelectorAll('.card')];
  const byEl = new Map([...cards].map((c) => [c.el, c]));
  return order
    .map((el) => byEl.get(el))
    .filter(Boolean)
    .map((c) => ({
      agentId: c.agentSelect.value,
      cwd: c.cwd.value,
      lastTaskId: c.lastTaskId || null,
    }));
}

let saveLayoutTimer = null;

function saveLayout() {
  if (!layoutReady) return;
  clearTimeout(saveLayoutTimer);
  saveLayoutTimer = setTimeout(() => {
    fetch('/api/system/layout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(currentLayoutState()),
    }).then((r) => {
      if (!r.ok) console.error('[concilium] failed to save layout: HTTP', r.status);
    }).catch((err) => console.error('[concilium] failed to save layout:', err));
  }, 150);
}

async function restoreLayout() {
  let states;
  try {
    const r = await fetch('/api/system/layout');
    if (r.ok) states = await r.json();
  } catch (err) {
    console.error('[concilium] failed to load saved layout:', err);
  }
  if (!Array.isArray(states) || states.length === 0) {
    addCard();
  } else {
    // Create all cards synchronously so the DOM is populated in order.
    const entries = states.map((s) => {
      const card = addCard({ agentId: s.agentId, cwd: s.cwd });
      return { card, s };
    });
    // Fan out task-existence checks in parallel to avoid serial RTTs.
    await Promise.all(entries.map(async ({ card, s }) => {
      const agentMissing = s.agentId && !agentsById.has(s.agentId);
      if (!s.lastTaskId) {
        if (agentMissing) card.setStatus(`agent "${s.agentId}" no longer exists`, 'err');
        return;
      }
      try {
        const taskCheck = await fetch(`/api/tasks/${s.lastTaskId}`);
        if (taskCheck.ok) {
          const taskData = await taskCheck.json();
          card.taskIds.add(s.lastTaskId);
          card.lastTaskId = s.lastTaskId;
          card.term.reset();
          // If the agent was deleted, write the warning to the terminal so it
          // doesn't conflict with the running/ended status set by attach().
          if (agentMissing) {
            card.term.writeln(`\x1b[33m[agent "${s.agentId}" no longer exists — select a new agent to run again]\x1b[0m`);
          }
          card.attach(s.lastTaskId, taskData);
        } else {
          card.setStatus(
            agentMissing ? `agent "${s.agentId}" no longer exists` : 'previous task no longer available',
            'err',
          );
        }
      } catch (err) {
        console.error(`[concilium] failed to restore task #${s.lastTaskId}:`, err);
      }
    }));
  }
  layoutReady = true;
}

// Safety-net save on page unload using sendBeacon so the request is queued
// even as the document is being torn down.
window.addEventListener('beforeunload', () => {
  if (!layoutReady) return;
  navigator.sendBeacon(
    '/api/system/layout',
    new Blob([JSON.stringify(currentLayoutState())], { type: 'application/json' }),
  );
});

$('#cards').addEventListener('dragover', (e) => {
  if (!draggingCardEl) return;
  e.preventDefault();
  const main = $('#cards');
  const target = cardInsertTarget(main, e.clientX, e.clientY);
  main.insertBefore(draggingCardEl, target);
});

// --- settings dialog -------------------------------------------------------

const dlg = $('#settings-dialog');
const agentForm = $('#agent-form');
const githubTokenForm = $('#github-token-form');
const githubTokenInput = $('#github-token');
const githubTokenClearBtn = $('#github-token-clear');
const newProjectDlg = $('#new-project-dialog');
const newProjectForm = $('#new-project-form');
const newProjectNameInput = $('#new-project-name');
const newProjectTargetInput = $('#new-project-target');
const newProjectPrivateInput = $('#new-project-private');
const newProjectBrowseBtn = $('#new-project-target-browse');
const newProjectCreateBtn = $('#new-project-create');
const newProjectStatusEl = $('#new-project-status');
const newIssueDlg = $('#new-issue-dialog');
const newIssueForm = $('#new-issue-form');
const newIssueRepoInput = $('#new-issue-repo');
const newIssueTitleInput = $('#new-issue-title');
const newIssueBodyInput = $('#new-issue-body');
const newIssueCreateBtn = $('#new-issue-create');
const newIssueStatusEl = $('#new-issue-status');
let editingId = null;
let newProjectCheckAbortCtrl = null;
let newIssueRepoUrl = '';
let newIssueCreatedHook = null;

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

async function loadGitHubToken() {
  const r = await fetch('/api/system/github-token');
  githubTokenInput.value = '';
  githubTokenInput.placeholder = 'ghp_...';
  if (!r.ok) {
    return;
  }
  const data = await r.json().catch((err) => {
    console.error('[concilium] failed to parse github-token response:', err);
    return {};
  });
  if (data.hasToken === true) githubTokenInput.placeholder = 'token already saved';
}

function setNewProjectStatus(text, cls = '') {
  newProjectStatusEl.textContent = text;
  newProjectStatusEl.classList.remove('ok', 'warn', 'err');
  if (cls) newProjectStatusEl.classList.add(cls);
}

function updateNewProjectCreateState() {
  const hasName = !!newProjectNameInput.value.trim();
  const hasTarget = !!newProjectTargetInput.value.trim();
  newProjectCreateBtn.disabled = !(hasName && hasTarget);
}

function setNewIssueStatus(text, cls = '') {
  newIssueStatusEl.textContent = text;
  newIssueStatusEl.classList.remove('ok', 'warn', 'err');
  if (cls) newIssueStatusEl.classList.add(cls);
}

function updateNewIssueCreateState() {
  newIssueCreateBtn.disabled = !newIssueTitleInput.value.trim();
}

function openNewIssueDialog(repoUrl, onCreated = null) {
  const base = (repoUrl || '').replace(/\/+$/, '');
  if (!base) return;
  newIssueRepoUrl = base;
  newIssueCreatedHook = typeof onCreated === 'function' ? onCreated : null;
  newIssueForm.reset();
  newIssueRepoInput.value = base.replace(/^https:\/\/github\.com\//, '');
  setNewIssueStatus('Enter a title to create an issue.');
  updateNewIssueCreateState();
  newIssueDlg.showModal();
  newIssueTitleInput.focus();
}

async function checkNewProjectName(name) {
  if (newProjectCheckAbortCtrl) newProjectCheckAbortCtrl.abort();
  newProjectCheckAbortCtrl = new AbortController();
  const { signal } = newProjectCheckAbortCtrl;
  try {
    const r = await fetch('/api/system/new-project/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
      signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      setNewProjectStatus(data.error || 'Unable to validate project name.', 'err');
      return false;
    }
    if (data.canCreate) {
      const ownerPrefix = data.owner ? `${data.owner}/` : '';
      setNewProjectStatus(`Repository ${ownerPrefix}${name} is available.`, 'ok');
      return true;
    } else {
      setNewProjectStatus(data.reason || 'This project name is unavailable.', 'warn');
      return false;
    }
  } catch (err) {
    if (err.name === 'AbortError') return false;
    setNewProjectStatus('Unable to validate project name.', 'err');
    return false;
  }
}

async function browseNewProjectTarget() {
  newProjectBrowseBtn.disabled = true;
  try {
    const r = await fetch('/api/system/pick-directory', { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      setNewProjectStatus(data.error || 'browse failed', 'err');
      return;
    }
    if (data.path) {
      newProjectTargetInput.value = toTildePath(data.path);
      updateNewProjectCreateState();
    }
  } finally {
    newProjectBrowseBtn.disabled = false;
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
githubTokenForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = githubTokenForm.querySelector('button[type="submit"]');
  const submitLabel = submitBtn ? submitBtn.dataset.label || submitBtn.textContent : '';
  if (submitBtn && !submitBtn.dataset.label) submitBtn.dataset.label = submitLabel;
  const r = await fetch('/api/system/github-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ GITHUB_TOKEN: githubTokenInput.value }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    alert(err.error || 'save failed');
    return;
  }
  await loadGitHubToken();
  if (submitBtn) {
    submitBtn.textContent = 'Saved';
    setTimeout(() => { submitBtn.textContent = submitBtn.dataset.label || submitLabel; }, 1200);
  }
});
githubTokenClearBtn.addEventListener('click', () => {
  githubTokenInput.value = '';
  githubTokenInput.focus();
});
$('#close-settings').addEventListener('click', () => dlg.close());
$('#open-settings').addEventListener('click', async () => {
  setFormMode('add');
  $('#discover-table tbody').replaceChildren();
  await Promise.all([refreshAgentsTable(), loadGitHubToken()]);
  dlg.showModal();
});

$('#new-card-btn').addEventListener('click', () => addCard());
$('#new-project-btn').addEventListener('click', () => {
  newProjectForm.reset();
  if (homeDir) newProjectTargetInput.value = toTildePath(homeDir);
  if (newProjectCheckAbortCtrl) newProjectCheckAbortCtrl.abort();
  setNewProjectStatus('Enter a project name and target location.');
  updateNewProjectCreateState();
  newProjectDlg.showModal();
  newProjectNameInput.focus();
});
$('#close-new-project').addEventListener('click', () => newProjectDlg.close());
newProjectDlg.addEventListener('close', () => {
  if (newProjectCheckAbortCtrl) newProjectCheckAbortCtrl.abort();
});
newProjectNameInput.addEventListener('input', updateNewProjectCreateState);
newProjectTargetInput.addEventListener('input', updateNewProjectCreateState);
newProjectBrowseBtn.addEventListener('click', browseNewProjectTarget);
newProjectForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (newProjectCreateBtn.disabled) return;

  const originalButtonText = newProjectCreateBtn.textContent;
  newProjectCreateBtn.disabled = true;
  newProjectCreateBtn.textContent = 'Checking…';
  setNewProjectStatus('Checking repository availability…');
  try {
    const name = newProjectNameInput.value.trim();
    const canCreate = await checkNewProjectName(name);
    if (!canCreate) {
      updateNewProjectCreateState();
      return;
    }

    newProjectCreateBtn.textContent = 'Creating…';
    setNewProjectStatus('Creating repository and cloning locally…');
    const r = await fetch('/api/system/new-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        targetPath: newProjectTargetInput.value.trim(),
        private: newProjectPrivateInput.checked,
      }),
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const base = data.error || 'Project creation failed.';
      const withRepoUrl = data.repoUrl ? `${base} ${data.repoUrl}` : base;
      setNewProjectStatus(withRepoUrl, 'err');
      return;
    }

    const cwd = typeof data.cwd === 'string' ? toTildePath(data.cwd) : '';
    const card = addCard({ cwd });
    if (typeof data.private === 'boolean') {
      card.setStatus(`repo created (${data.private ? 'private' : 'public'})`, 'ok');
    }
    newProjectDlg.close();
  } catch (err) {
    console.error('[concilium] new project creation failed:', err);
    setNewProjectStatus('Project creation failed.', 'err');
  } finally {
    newProjectCreateBtn.textContent = originalButtonText;
    updateNewProjectCreateState();
  }
});

$('#close-new-issue').addEventListener('click', () => newIssueDlg.close());
newIssueDlg.addEventListener('close', () => {
  newIssueRepoUrl = '';
  newIssueCreatedHook = null;
});
newIssueTitleInput.addEventListener('input', updateNewIssueCreateState);
newIssueForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (newIssueCreateBtn.disabled) return;

  const originalButtonText = newIssueCreateBtn.textContent;
  newIssueCreateBtn.disabled = true;
  newIssueCreateBtn.textContent = 'Creating…';
  setNewIssueStatus('Creating issue…');
  try {
    const r = await fetch('/api/system/new-issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: newIssueRepoUrl,
        title: newIssueTitleInput.value.trim(),
        body: newIssueBodyInput.value.trim(),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      setNewIssueStatus(data.error || 'Failed to create issue. Please try again.', 'err');
      return;
    }
    setNewIssueStatus(`Created issue #${data.number}.`, 'ok');
    if (newIssueCreatedHook) await newIssueCreatedHook(data);
    newIssueDlg.close();
  } catch (err) {
    console.error('[concilium] new issue creation failed:', err);
    setNewIssueStatus('Issue creation failed.', 'err');
  } finally {
    newIssueCreateBtn.textContent = originalButtonText;
    updateNewIssueCreateState();
  }
});

// --- theme ----------------------------------------------------------------

const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const THEME_ICON = {
  auto: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2.5A1.5 1.5 0 0 0 .5 4v7A1.5 1.5 0 0 0 2 12.5h4.9l-.8 1.5H5a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H9.9l-.8-1.5H14A1.5 1.5 0 0 0 15.5 11V4A1.5 1.5 0 0 0 14 2.5H2Zm0 1h12a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"/></svg>',
  light: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/></svg>',
  dark: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M10.02 1.1a.6.6 0 0 1 .68.78A5.5 5.5 0 1 0 14.12 8a.6.6 0 0 1 .78.69A6.7 6.7 0 1 1 9.3 1.1a.6.6 0 0 1 .72 0Z"/></svg>',
};

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
  for (const card of cards) card.applyTermTheme();
  for (const card of termCards) card.applyTermTheme();
}
function updateThemeButton() {
  const t = currentTheme();
  const btn = $('#theme-toggle');
  // THEME_ICON values are static code-defined SVG strings, not user input.
  btn.innerHTML = THEME_ICON[t];
  btn.setAttribute('aria-label', `Theme: ${THEME_LABEL[t]} (click to cycle)`);
  btn.title = `Theme: ${THEME_LABEL[t]} (click to cycle)`;
}
$('#theme-toggle').addEventListener('click', () => {
  const i = THEME_ORDER.indexOf(currentTheme());
  applyTheme(THEME_ORDER[(i + 1) % THEME_ORDER.length]);
});
updateThemeButton();

// Re-theme terminals when the OS flips light/dark while we're on Auto.
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (currentTheme() === 'auto') {
    for (const card of cards) card.applyTermTheme();
    for (const card of termCards) card.applyTermTheme();
  }
});

// Reconnect any interrupted streams when the device wakes from sleep or the
// network comes back. This is a safety net for cases where the EventSource
// ends up permanently closed instead of auto-reconnecting (e.g. when the
// browser aggressively kills connections while the page is hidden).
function reconnectAllStreams() {
  for (const card of cards) card.reconnectStream();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reconnectAllStreams();
});
window.addEventListener('online', reconnectAllStreams);

// --- bootstrap -------------------------------------------------------------

(async () => {
  await loadHealth();
  await loadAgents();
  await restoreLayout();
  setInterval(loadHealth, 10000);
})();
