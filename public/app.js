const $ = (selector, root = document) => root.querySelector(selector);

let agentsById = new Map();
const cards = new Set();
const termCards = new Set();
let draggingCardEl = null;
let activeCardEl = null;

let layoutReady = false;
let homeDir = '';
const IS_MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
const COPILOT_ISSUE_ASSIGNEE_LOGINS = new Set(['copilot', 'copilot-swe-agent[bot]']);
const NEW_GITHUB_REPO_URL = 'https://github.com/new';
const GITHUB_BTN_LABEL_BROWSE = 'Browse GitHub issues and pull requests';
const GITHUB_BTN_LABEL_CREATE = 'Create GitHub repository';
const RESTORE_RESUME_RETRY_DELAY_MS = 500;
const COPILOT_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z"/><path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z"/></svg>';
const COPILOT_ASSIGNED_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z"/></svg>';
const MERGE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.27a2.751 2.751 0 1 1-1.5 0V5.607a2.751 2.751 0 1 1 1.95-.453ZM4.25 13.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM4.25 5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/></svg>';
const READY_FOR_REVIEW_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>';
const CLOSE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>';

function currentTermTheme() {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: styles.getPropertyValue('--term-bg').trim() || '#111111',
    foreground: styles.getPropertyValue('--term-fg').trim() || '#dddddd',
    cursor: styles.getPropertyValue('--term-cursor').trim() || '#dddddd',
    selectionBackground: styles.getPropertyValue('--term-selection').trim() || 'rgba(120,180,255,0.30)',
  };
}

function formatUptime(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const units = [
    ['month', 30 * 24 * 60 * 60],
    ['week', 7 * 24 * 60 * 60],
    ['day', 24 * 60 * 60],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [label, size] of units) {
    if (totalSeconds >= size) {
      const value = Math.floor(totalSeconds / size);
      return `${value} ${label}${value === 1 ? '' : 's'}`;
    }
  }
  return '0 seconds';
}

async function loadHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    $('#health').textContent = `pid ${data.pid} · up ${formatUptime(data.uptime)}`;
    if (data.homeDir) homeDir = data.homeDir;
  } catch (_) {
    $('#health').textContent = 'offline';
  }
}

function toTildePath(path) {
  if (homeDir && (path === homeDir || path.startsWith(homeDir + '/'))) {
    return '~' + path.slice(homeDir.length);
  }
  return path;
}

function issueHasCopilotAssigned(item) {
  if (!item || !Array.isArray(item.assignees)) return false;
  return item.assignees.some((assignee) => typeof assignee === 'string'
    && COPILOT_ISSUE_ASSIGNEE_LOGINS.has(assignee.toLowerCase()));
}

async function loadAgents() {
  const response = await fetch('/api/agents');
  const agents = await response.json();
  agentsById = new Map(agents.map((agent) => [agent.id, agent]));
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
  for (const agent of agentsById.values()) {
    const option = document.createElement('option');
    option.value = agent.id;
    option.textContent = agent.name + (agent.interactive ? ' · interactive' : '');
    if (currentValue === agent.id) option.selected = true;
    select.appendChild(option);
  }
}

function cardInsertTarget(main, clientX, clientY) {
  const siblings = [...main.querySelectorAll('.card:not(.dragging)')];
  if (siblings.length === 0) return null;
  let closestCard = null;
  let closestRect = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const sibling of siblings) {
    const rect = sibling.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const offsetX = clientX - centerX;
    const offsetY = clientY - centerY;
    const distance = offsetX * offsetX + offsetY * offsetY;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestCard = sibling;
      closestRect = rect;
    }
  }
  if (!closestCard || !closestRect) return null;
  const offsetX = clientX - (closestRect.left + closestRect.width / 2);
  const offsetY = clientY - (closestRect.top + closestRect.height / 2);
  const insertBefore = Math.abs(offsetX) > Math.abs(offsetY) ? offsetX < 0 : offsetY < 0;
  return insertBefore ? closestCard : closestCard.nextElementSibling;
}

function focusCardFromNode(node) {
  if (!(node instanceof Element)) return;
  const cardEl = node.closest('.card');
  if (cardEl) activeCardEl = cardEl;
}

function clearActiveCardIfMatch(cardEl) {
  if (activeCardEl === cardEl) activeCardEl = null;
}

function activeSessionCard() {
  if (activeCardEl && activeCardEl.isConnected) {
    for (const card of cards) {
      if (card.el === activeCardEl) return card;
    }
  }
  return cards.values().next().value || null;
}

function activeAnyCard() {
  if (activeCardEl && activeCardEl.isConnected) {
    for (const card of cards) {
      if (card.el === activeCardEl) return card;
    }
    for (const card of termCards) {
      if (card.el === activeCardEl) return card;
    }
  }
  return cards.values().next().value || termCards.values().next().value || null;
}

function isOpenCard(card) {
  return !!(card && card.el && card.el.isConnected);
}

function isTypingContext(node) {
  if (!(node instanceof Element)) return false;
  return !!node.closest('input, textarea, select, [contenteditable], [role="textbox"], .xterm-helper-textarea');
}

function isPrimaryModifierPressed(keyboardEvent) {
  // AltGr presents as Ctrl+Alt on many international layouts; ignore it so
  // typing special characters does not accidentally trigger global shortcuts.
  if (keyboardEvent.getModifierState && keyboardEvent.getModifierState('AltGraph')) return false;
  const hasPrimary = keyboardEvent.metaKey || keyboardEvent.ctrlKey;
  if (!hasPrimary) return false;
  // Reject "both held" combinations and require a single primary modifier.
  if (keyboardEvent.metaKey && keyboardEvent.ctrlKey) return false;
  return true;
}

function triggerHeaderAction(keyboardEvent, selector) {
  const button = $(selector);
  if (!button) return false;
  keyboardEvent.preventDefault();
  button.click();
  return true;
}

function openShortcutsDialog() {
  const shortcutsDialog = $('#shortcuts-dialog');
  if (!shortcutsDialog) return;
  if (shortcutsDialog.open) return;
  try {
    shortcutsDialog.showModal();
  } catch (_) {}
}

function handleKeyboardShortcut(keyboardEvent) {
  if (keyboardEvent.defaultPrevented || keyboardEvent.repeat || keyboardEvent.isComposing) return;
  if (!isPrimaryModifierPressed(keyboardEvent)) return;
  if (!keyboardEvent.altKey || keyboardEvent.shiftKey) return;
  if (isTypingContext(keyboardEvent.target) || isTypingContext(document.activeElement)) return;

  const keyCode = keyboardEvent.code;
  if (keyCode === 'KeyN') {
    keyboardEvent.preventDefault();
    addCard();
    return;
  }
  if (keyCode === 'KeyR') {
    const card = activeSessionCard();
    if (!card) return;
    keyboardEvent.preventDefault();
    if (card.currentTaskId) card.kill();
    else card.run();
    return;
  }
  if (keyCode === 'Backquote') {
    const card = activeSessionCard();
    if (!card) return;
    keyboardEvent.preventDefault();
    card.openTerminalCard();
    return;
  }
  if (keyCode === 'KeyE') {
    const card = activeAnyCard();
    if (!card) return;
    keyboardEvent.preventDefault();
    card.toggleExpand();
    return;
  }
  if (keyCode === 'KeyP') {
    triggerHeaderAction(keyboardEvent, '#new-project-btn');
    return;
  }
  if (keyCode === 'KeyS') {
    triggerHeaderAction(keyboardEvent, '#open-settings');
    return;
  }
  if (keyCode === 'KeyT') {
    triggerHeaderAction(keyboardEvent, '#theme-toggle');
    return;
  }
  if (keyCode === 'Slash') {
    keyboardEvent.preventDefault();
    openShortcutsDialog();
  }
}

function enableCardDragging(cardEl, handleEl) {
  handleEl.draggable = true;

  handleEl.addEventListener('dragstart', (dragEvent) => {
    const target = dragEvent.target;
    if (target && target.closest('button, select, input, a, .card-actions, .card-status')) {
      dragEvent.preventDefault();
      return;
    }
    if (cardEl.classList.contains('expanded')) {
      dragEvent.preventDefault();
      return;
    }
    draggingCardEl = cardEl;
    cardEl.classList.add('dragging');
    if (dragEvent.dataTransfer) {
      dragEvent.dataTransfer.effectAllowed = 'move';
      dragEvent.dataTransfer.setData('text/plain', 'card');
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
    const template = $('#card-template');
    this.el = template.content.firstElementChild.cloneNode(true);
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
    this.dragHandleEl = $('.card-drag-handle', this.el);

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
    this.linkedTerminalCard = null;
    this.linkedGitHubCard = null;

    this.refreshAgentSelect();

    this.taskForm.addEventListener('submit', (submitEvent) => { submitEvent.preventDefault(); if (!this.currentTaskId) this.run(); });
    this.runBtn.addEventListener('click', (clickEvent) => { if (this.currentTaskId) { clickEvent.preventDefault(); this.kill(); } });
    this.cwdBrowse.addEventListener('click', () => this.browseCwd());
    this.closeBtn.addEventListener('click', () => this.close());
    this.expandBtn.addEventListener('click', () => this.toggleExpand());
    this.openTermBtn.addEventListener('click', () => this.openTerminalCard());
    this.cloneBtn.addEventListener('click', () => cloneCard(this));
    this.githubBtn.addEventListener('click', () => this.openGitHubCard());
    this.agentSelect.addEventListener('change', () => saveLayout());
    this.cwd.addEventListener('input', () => { saveLayout(); this.scheduleCheckGitHub(); });
    this.cwd.addEventListener('keydown', (keyboardEvent) => {
      if (keyboardEvent.key === 'Enter' && !this.currentTaskId) {
        keyboardEvent.preventDefault();
        this.run();
      }
    });
    enableCardDragging(this.el, this.dragHandleEl || this.headerEl);

    cards.add(this);
    this.syncLinkedCardButtons();
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
    const sizeSignature = `${cols}x${rows}`;
    if (sizeSignature === this.lastSentSize) return;
    this.lastSentSize = sizeSignature;
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

  setGitHubBtnMode(mode) {
    if (mode === 'hidden') {
      this.githubBtn.hidden = true;
      this.githubBtn.disabled = false;
      return;
    }
    const label = mode === 'browse' ? GITHUB_BTN_LABEL_BROWSE : GITHUB_BTN_LABEL_CREATE;
    this.githubBtn.title = label;
    this.githubBtn.setAttribute('aria-label', label);
    this.githubBtn.hidden = false;
    this.syncLinkedCardButtons();
  }

  syncLinkedCardButtons() {
    this.openTermBtn.disabled = isOpenCard(this.linkedTerminalCard);
    this.githubBtn.disabled = !this.githubBtn.hidden && isOpenCard(this.linkedGitHubCard);
  }

  focusLinkedCard(card) {
    if (!isOpenCard(card)) return;
    activeCardEl = card.el;
    card.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (typeof card.term?.focus === 'function') card.term.focus();
  }

  releaseLinkedTerminalCard(card) {
    if (this.linkedTerminalCard !== card) return;
    this.linkedTerminalCard = null;
    this.syncLinkedCardButtons();
  }

  releaseLinkedGitHubCard(card) {
    if (this.linkedGitHubCard !== card) return;
    this.linkedGitHubCard = null;
    this.syncLinkedCardButtons();
  }

  openTerminalCard() {
    if (isOpenCard(this.linkedTerminalCard)) {
      this.focusLinkedCard(this.linkedTerminalCard);
      return this.linkedTerminalCard;
    }
    const card = addTerminalCard({ cwd: this.cwd.value.trim(), afterEl: this.el, parentCard: this });
    this.linkedTerminalCard = card;
    this.syncLinkedCardButtons();
    return card;
  }

  async run() {
    const agentId = this.agentSelect.value;
    if (!agentId) { this.setStatus('select an agent', 'err'); return { ok: false, error: 'select an agent' }; }

    if (this.currentSource) { this.currentSource.close(); this.currentSource = null; }
    this.term.reset();
    this.lastEventId = null;
    this._reconnecting = false;
    this._errorCheckPending = false;
    this.lastSentSize = null;

    const body = { agent_id: agentId };
    const cwd = this.cwd.value.trim();
    if (cwd) body.cwd = cwd;

    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = data.error || 'failed';
      this.setStatus(error, 'err');
      return { ok: false, error };
    }

    this.taskIds.add(data.task_id);
    this.lastTaskId = data.task_id;
    saveLayout();
    this.attach(data.task_id);
    // Push our current dimensions to the freshly spawned PTY.
    this.fitAndResize();
    return { ok: true };
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
    const eventSource = new EventSource(streamUrl);
    this.currentSource = eventSource;

    // Restore running status when the EventSource (re)opens successfully.
    // Only do this when recovering from an onerror — on the initial connect
    // attach() has already set the correct status above.
    eventSource.onopen = () => {
      if (this.currentTaskId === taskId && this._reconnecting) {
        this._reconnecting = false;
        this.setStatus('task running…', 'running');
      }
    };

    eventSource.addEventListener('output', (messageEvent) => {
      let outputEvent;
      try { outputEvent = JSON.parse(messageEvent.data); } catch (_) { return; }
      // Skip stdin events: the PTY echoes user input back as stdout, so
      // rendering stdin would double-print every keystroke.
      if (outputEvent.stream === 'stdin') return;
      // Track the latest row id so we can resume from here if the stream is
      // interrupted and the EventSource needs to be recreated (?since=).
      if (outputEvent.id) this.lastEventId = outputEvent.id;
      this.term.write(outputEvent.data);
    });
    eventSource.addEventListener('end', (messageEvent) => {
      let exitInfo = {};
      try { exitInfo = JSON.parse(messageEvent.data); } catch (_) {}
      const exitLine = `\r\n\x1b[2m[exit ${exitInfo.exitCode ?? '?'}${exitInfo.signal ? ' ' + exitInfo.signal : ''}]\x1b[0m\r\n`;
      this.term.write(exitLine);
      this.setStatus(`task ${exitInfo.status || 'ended'}`, exitInfo.status === 'done' ? 'ok' : 'err');
      this.setRunning(false);
      eventSource.close();
      if (this.currentSource === eventSource) this.currentSource = null;
      this.currentTaskId = null;
    });
    eventSource.onerror = () => {
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
      fetch(`/api/tasks/${capturedTaskId}`).then((checkResponse) => {
        this._errorCheckPending = false;
        if (this.currentTaskId !== capturedTaskId) return; // superseded
        if (!checkResponse.ok) {
          // Task is gone — nothing to reconnect to.
          eventSource.close();
          if (this.currentSource === eventSource) this.currentSource = null;
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
      const response = await fetch(`/api/tasks/${taskId}`);
      if (this.currentTaskId !== taskId) return; // superseded
      if (!response.ok) {
        this.setStatus('task lost connection', 'err');
        this.currentTaskId = null;
        this.setRunning(false);
        return;
      }
      taskData = await response.json();
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
    const applyExpand = () => {
      for (const card of cards) card.el.classList.remove('expanded');
      for (const card of termCards) card.el.classList.remove('expanded');
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
    if (!document.startViewTransition) { applyExpand(); return; }
    this.el.style.viewTransitionName = 'card-active';
    const transition = document.startViewTransition(applyExpand);
    transition.finished.finally(() => { this.el.style.viewTransitionName = ''; });
  }

  async browseCwd() {
    this.cwdBrowse.disabled = true;
    try {
      const response = await fetch('/api/system/pick-directory', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { this.setStatus(data.error || 'browse failed', 'err'); return; }
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
    const directoryPath = this.cwd.value.trim();
    if (!directoryPath) { this.githubUrl = ''; this.setGitHubBtnMode('hidden'); return; }
    // Cancel any in-flight request so stale responses don't overwrite newer results.
    if (this._githubAbortCtrl) this._githubAbortCtrl.abort();
    this._githubAbortCtrl = new AbortController();
    const { signal } = this._githubAbortCtrl;
    try {
      const response = await fetch('/api/system/github-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: directoryPath }),
        signal,
      });
      if (!response.ok) { this.githubUrl = ''; this.setGitHubBtnMode('create'); return; }
      const data = await response.json().catch(() => ({}));
      if (data.url) {
        this.githubUrl = data.url;
        this.setGitHubBtnMode('browse');
      } else {
        this.githubUrl = '';
        this.setGitHubBtnMode('create');
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[concilium] checkGitHub failed:', err);
      this.githubUrl = '';
      this.setGitHubBtnMode('create');
    }
  }

  openGitHubCard() {
    if (!this.githubUrl) {
      window.open(NEW_GITHUB_REPO_URL, '_blank', 'noopener,noreferrer');
      return null;
    }
    if (isOpenCard(this.linkedGitHubCard)) {
      this.focusLinkedCard(this.linkedGitHubCard);
      return this.linkedGitHubCard;
    }
    const card = addGitHubCard({ afterEl: this.el, repoUrl: this.githubUrl, parentCard: this });
    this.linkedGitHubCard = card;
    this.syncLinkedCardButtons();
    return card;
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
    const linkedTerminalCard = this.linkedTerminalCard;
    const linkedGitHubCard = this.linkedGitHubCard;
    this.linkedTerminalCard = null;
    this.linkedGitHubCard = null;
    if (this.currentSource) { this.currentSource.close(); this.currentSource = null; }
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.term) { try { this.term.dispose(); } catch (_) {} this.term = null; }
    if (this.el.classList.contains('expanded')) {
      $('#cards').classList.remove('has-expanded');
    }
    const ids = [...this.taskIds];
    this.taskIds.clear();
    cards.delete(this);
    clearActiveCardIfMatch(this.el);
    this.el.remove();
    saveLayout();
    await Promise.all([
      isOpenCard(linkedTerminalCard) ? linkedTerminalCard.close() : Promise.resolve(),
      isOpenCard(linkedGitHubCard) ? Promise.resolve(linkedGitHubCard.close()) : Promise.resolve(),
    ]);
    // Fire-and-forget deletes; server will kill any still-running tasks first.
    await Promise.all(ids.map((id) =>
      fetch(`/api/tasks/${id}`, { method: 'DELETE' }).catch(() => {})
    ));
  }
}

class GitHubCard {
  constructor(parentCard = null) {
    const template = $('#github-card-template');
    this.el = template.content.firstElementChild.cloneNode(true);
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
    this.parentCard = parentCard;

    this.closeBtn.addEventListener('click', () => this.close());
    this.newIssueBtn.addEventListener('click', () => this.openNewIssueDialog());
    this.refreshBtn.addEventListener('click', () => this.load(this.currentUrl));
    enableCardDragging(this.el, this.headerEl);
  }

  setStatus(text, cls) {
    this.statusEl.textContent = text;
    this.statusEl.className = 'card-status' + (cls ? ' ' + cls : '');
  }

  renderList(el, items, emptyText, { withPullActions = false, withIssueActions = false } = {}) {
    el.replaceChildren();
    if (!items.length) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'muted';
      emptyItem.textContent = emptyText;
      el.appendChild(emptyItem);
      return;
    }
    for (const item of items) {
      const listItem = document.createElement('li');
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `#${item.number} ${item.title}`;
      link.className = 'github-list-link';
      listItem.appendChild(link);
      // Show linked issue/PR numbers (e.g. "(#11)" or "(#11, #12)") after the title.
      const linkedRefs = [
        ...(Array.isArray(item.linkedIssues) ? item.linkedIssues.map((n) => ({ n, path: 'issues' })) : []),
        ...(Array.isArray(item.linkedPulls)  ? item.linkedPulls.map((n) => ({ n, path: 'pull' }))   : []),
      ];
      if (linkedRefs.length && this.currentUrl) {
        const refsEl = document.createElement('span');
        refsEl.className = 'github-linked-refs';
        refsEl.appendChild(document.createTextNode('('));
        for (const [i, { n, path }] of linkedRefs.entries()) {
          if (i > 0) refsEl.appendChild(document.createTextNode(', '));
          const refLink = document.createElement('a');
          refLink.href = `${this.currentUrl}/${path}/${n}`;
          refLink.target = '_blank';
          refLink.rel = 'noopener noreferrer';
          refLink.textContent = `#${n}`;
          refsEl.appendChild(refLink);
        }
        refsEl.appendChild(document.createTextNode(')'));
        listItem.appendChild(refsEl);
      }
      if (Array.isArray(item.assignees) && item.assignees.length) {
        const assigneesWrap = document.createElement('span');
        assigneesWrap.className = 'github-assignees';
        for (const login of item.assignees) {
          const assigneeEl = document.createElement('span');
          assigneeEl.className = 'github-assignee';
          assigneeEl.textContent = `@${login}`;
          assigneeEl.title = `Assigned to ${login}`;
          assigneesWrap.appendChild(assigneeEl);
        }
        listItem.appendChild(assigneesWrap);
      }
      if (item.branch) {
        const branchWrap = document.createElement('span');
        branchWrap.className = 'github-branch';
        const branchCode = document.createElement('code');
        branchCode.className = 'github-branch-name';
        branchCode.textContent = item.branch;
        branchCode.title = item.branch;
        branchWrap.appendChild(branchCode);
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'github-branch-copy';
        copyBtn.setAttribute('aria-label', `Copy branch name ${item.branch}`);
        copyBtn.title = 'Copy branch name';
        copyBtn.innerHTML = '<svg height="14" width="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/></svg>';
        copyBtn.addEventListener('click', (clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          this.copyBranch(item.branch, copyBtn);
        });
        branchWrap.appendChild(copyBtn);
        listItem.appendChild(branchWrap);
      }
      if (withPullActions) {
        const actions = document.createElement('span');
        actions.className = 'github-pr-actions';
        if (item.draft) {
          const readyBtn = document.createElement('button');
          readyBtn.type = 'button';
          readyBtn.className = 'github-pr-action github-pr-action-ready github-pr-action-control';
          readyBtn.innerHTML = READY_FOR_REVIEW_ICON_SVG;
          readyBtn.title = 'Mark pull request ready for review';
          readyBtn.setAttribute('aria-label', 'Mark pull request ready for review');
          readyBtn.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            this.runMarkReadyAction(item, readyBtn);
          });
          actions.appendChild(readyBtn);
        } else {
          const methodSelect = document.createElement('select');
          methodSelect.className = 'github-pr-merge-method github-pr-action-control';
          methodSelect.title = 'Select merge method';
          const methods = [
            { value: 'merge', label: 'Merge commit' },
            { value: 'squash', label: 'Squash' },
            { value: 'rebase', label: 'Rebase' },
          ];
          for (const method of methods) {
            const option = document.createElement('option');
            option.value = method.value;
            option.textContent = method.label;
            methodSelect.appendChild(option);
          }
          actions.appendChild(methodSelect);
          const mergeBtn = document.createElement('button');
          mergeBtn.type = 'button';
          mergeBtn.className = 'github-pr-action github-pr-action-merge github-pr-action-control';
          mergeBtn.innerHTML = MERGE_ICON_SVG;
          mergeBtn.title = 'Merge pull request';
          mergeBtn.setAttribute('aria-label', 'Merge pull request');
          mergeBtn.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            this.runPullAction(item, mergeBtn, { action: 'merge', methodSelect });
          });
          actions.appendChild(mergeBtn);
        }
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'github-pr-action github-pr-action-close github-pr-action-control';
        closeBtn.innerHTML = CLOSE_ICON_SVG;
        closeBtn.title = 'Close pull request';
        closeBtn.setAttribute('aria-label', 'Close pull request');
        closeBtn.addEventListener('click', (clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          this.runPullAction(item, closeBtn, { action: 'close' });
        });
        actions.appendChild(closeBtn);
        listItem.appendChild(actions);
      }
      if (withIssueActions) {
        const actions = document.createElement('span');
        actions.className = 'github-issue-actions';
        if (issueHasCopilotAssigned(item)) {
          const assigned = document.createElement('span');
          assigned.className = 'github-issue-assigned';
          assigned.innerHTML = COPILOT_ASSIGNED_ICON_SVG;
          assigned.title = 'Assigned to Copilot';
          assigned.setAttribute('aria-label', 'Assigned to Copilot');
          actions.appendChild(assigned);
        } else {
          const assignBtn = document.createElement('button');
          assignBtn.type = 'button';
          assignBtn.className = 'github-issue-action github-issue-action-assign';
          assignBtn.innerHTML = COPILOT_ICON_SVG;
          assignBtn.title = 'Assign to Copilot agent';
          assignBtn.setAttribute('aria-label', 'Assign to Copilot agent');
          assignBtn.addEventListener('click', (clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            this.runIssueAction(item, assignBtn, 'assign_copilot');
          });
          actions.appendChild(assignBtn);
        }
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'github-issue-action github-issue-action-close';
        closeBtn.innerHTML = CLOSE_ICON_SVG;
        closeBtn.title = 'Close issue';
        closeBtn.setAttribute('aria-label', 'Close issue');
        closeBtn.addEventListener('click', (clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          this.runIssueAction(item, closeBtn, 'close');
        });
        actions.appendChild(closeBtn);
        listItem.appendChild(actions);
      }
      el.appendChild(listItem);
    }
  }

  async copyBranch(branch, copyButton) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(branch);
      } else {
        const fallbackTextarea = document.createElement('textarea');
        fallbackTextarea.value = branch;
        fallbackTextarea.setAttribute('readonly', '');
        fallbackTextarea.style.position = 'absolute';
        fallbackTextarea.style.left = '-9999px';
        document.body.appendChild(fallbackTextarea);
        fallbackTextarea.select();
        document.execCommand('copy');
        fallbackTextarea.remove();
      }
      copyButton.classList.add('copied');
      copyButton.title = 'Copied!';
      clearTimeout(copyButton._copyTimer);
      copyButton._copyTimer = setTimeout(() => {
        copyButton.classList.remove('copied');
        copyButton.title = 'Copy branch name';
      }, 1200);
    } catch (err) {
      console.error('[concilium] branch copy failed:', err);
    }
  }

  async runPullAction(item, actionButton, { action = 'merge', methodSelect = null } = {}) {
    const isMerge = action === 'merge';
    const actionLabel = isMerge ? 'merge' : 'close';
    const statusVerb = isMerge ? 'merging' : 'closing';
    const successVerb = isMerge ? 'merged' : 'closed';
    const mergeMethod = isMerge ? ((methodSelect && methodSelect.value) || 'merge') : undefined;
    const confirmMessage = isMerge
      ? `Merge #${item.number} using ${mergeMethod}?`
      : `Close #${item.number}?`;
    if (!confirm(confirmMessage)) return;
    const actionsContainer = actionButton.parentElement;
    const controls = actionsContainer ? [...actionsContainer.querySelectorAll('.github-pr-action-control')] : [actionButton];
    for (const control of controls) control.disabled = true;
    this.setStatus(`${statusVerb} #${item.number}…`, 'running');
    try {
      const response = await fetch('/api/system/github-pulls/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: this.currentUrl,
          pullNumber: item.number,
          action,
          sha: isMerge ? (item.headSha || undefined) : undefined,
          mergeMethod: isMerge ? mergeMethod : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.setStatus(data.error || `failed to ${actionLabel} #${item.number}`, 'err');
        return;
      }
      const successFallback = `pull request #${item.number} ${successVerb}`;
      this.setStatus(data.message || successFallback, 'ok');
      await this.load(this.currentUrl, { excludePullNumbers: new Set([item.number]) });
    } catch (err) {
      console.error('[concilium] pull request action failed:', err);
      this.setStatus(`failed to ${actionLabel} #${item.number}`, 'err');
    } finally {
      for (const control of controls) control.disabled = false;
    }
  }

  async runMarkReadyAction(item, readyButton) {
    if (!item.nodeId) {
      this.setStatus(`cannot mark #${item.number} ready (missing GraphQL id)`, 'err');
      return;
    }
    if (!confirm(`Mark draft #${item.number} ready for review?`)) return;
    readyButton.disabled = true;
    this.setStatus(`marking #${item.number} ready…`, 'running');
    try {
      const response = await fetch('/api/system/github-pulls/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: this.currentUrl,
          pullNumber: item.number,
          action: 'mark_ready',
          nodeId: item.nodeId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.setStatus(data.error || `failed to mark #${item.number} ready`, 'err');
        return;
      }
      const successFallback = `pull request #${item.number} ready for review`;
      this.setStatus(data.message || successFallback, 'ok');
      await this.load(this.currentUrl);
    } catch (err) {
      console.error('[concilium] mark-ready action failed:', err);
      this.setStatus(`failed to mark #${item.number} ready`, 'err');
    } finally {
      readyButton.disabled = false;
    }
  }

  async runIssueAction(item, issueButton, action = 'assign_copilot') {
    const issueActionConfig = {
      assign_copilot: {
        confirm: `Assign issue #${item.number} to Copilot?`,
        progress: 'assigning',
        failureVerb: 'assign',
        successFallback: `issue #${item.number} assigned`,
      },
      close: {
        confirm: `Close issue #${item.number}?`,
        progress: 'closing',
        failureVerb: 'close',
        successFallback: `issue #${item.number} closed`,
      },
    };
    const actionConfig = issueActionConfig[action];
    if (!actionConfig) return;
    if (!confirm(actionConfig.confirm)) return;
    issueButton.disabled = true;
    this.setStatus(`${actionConfig.progress} #${item.number}…`, 'running');
    try {
      const response = await fetch('/api/system/github-issues/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: this.currentUrl,
          issueNumber: item.number,
          action,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.setStatus(data.error || `failed to ${actionConfig.failureVerb} #${item.number}`, 'err');
        return;
      }
      this.setStatus(data.message || actionConfig.successFallback, 'ok');
      const loadOpts = action === 'close' ? { excludeIssueNumbers: new Set([item.number]) } : {};
      await this.load(this.currentUrl, loadOpts);
    } catch (err) {
      console.error('[concilium] issue action failed:', err);
      this.setStatus(`failed to ${actionConfig.failureVerb} #${item.number}`, 'err');
    } finally {
      issueButton.disabled = false;
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
    openNewIssueDialog(this.currentUrl, async (issue) => {
      await this.load(this.currentUrl);
      if (issue && issue.copilotAssignmentRequested && issue.copilotAssigned === false) {
        this.setStatus('issue created (copilot assignment failed)', 'warn');
      } else {
        this.setStatus('issue created', 'ok');
      }
    });
  }

  async load(repoUrlHint = '', { excludeIssueNumbers = null, excludePullNumbers = null } = {}) {
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
      const response = await fetch('/api/system/github-items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: repoUrlHint }),
        signal,
      });
      let data = {};
      try {
        data = await response.json();
      } catch (_) {}
      if (!response.ok) {
        this.setStatus(data.error || 'failed', 'err');
        this.renderList(this.issuesEl, [], 'unable to load');
        this.renderList(this.pullsEl, [], 'unable to load');
        return;
      }
      const url = data.url || repoUrlHint;
      this.setTitle(url);
      // GitHub's /issues?state=open and /pulls?state=open endpoints can briefly
      // include an item we just transitioned out of `open` (PATCH/PUT propagation
      // lag). When the caller knows an item should no longer appear, filter it
      // from the freshly fetched list so the UI doesn't show it as still open.
      let issues = Array.isArray(data.issues) ? data.issues : [];
      let pulls = Array.isArray(data.pulls) ? data.pulls : [];
      if (excludeIssueNumbers && excludeIssueNumbers.size) {
        issues = issues.filter((issue) => !excludeIssueNumbers.has(issue.number));
      }
      if (excludePullNumbers && excludePullNumbers.size) {
        pulls = pulls.filter((pull) => !excludePullNumbers.has(pull.number));
      }
      this.renderList(this.issuesEl, issues, 'no open issues', { withIssueActions: true });
      this.renderList(this.pullsEl, pulls, 'no open pull requests', { withPullActions: true });
      this.setStatus(data.error || data.warning || 'loaded', data.error ? 'warn' : data.warning ? 'warn' : 'ok');
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
    if (this.parentCard) this.parentCard.releaseLinkedGitHubCard(this);
    clearActiveCardIfMatch(this.el);
    if (this.el.parentNode) this.el.remove();
  }
}

class TerminalCard {
  constructor(parentCard = null) {
    const template = $('#terminal-card-template');
    this.el = template.content.firstElementChild.cloneNode(true);
    this.closeBtn = $('.card-close', this.el);
    this.expandBtn = $('.card-expand', this.el);
    this.gitRefBtn = $('.card-git-ref', this.el);
    this.statusEl = $('.card-status', this.el);
    this.termEl = $('.card-term', this.el);
    this.headerEl = $('.card-header', this.el);

    this.taskId = null;
    this.currentSource = null;
    this.term = null;
    this.fitAddon = null;
    this.resizeObserver = null;
    this.lastSentSize = null;
    this.parentCard = parentCard;

    this.closeBtn.addEventListener('click', () => this.close());
    this.expandBtn.addEventListener('click', () => this.toggleExpand());
    this.gitRefBtn.addEventListener('click', () => openGitCheatsheet(this));
    enableCardDragging(this.el, this.headerEl);

    termCards.add(this);
  }

  toggleExpand() {
    const main = $('#cards');
    const willExpand = !this.el.classList.contains('expanded');
    const applyExpand = () => {
      for (const card of cards) card.el.classList.remove('expanded');
      for (const card of termCards) card.el.classList.remove('expanded');
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
    if (!document.startViewTransition) { applyExpand(); return; }
    this.el.style.viewTransitionName = 'card-active';
    const transition = document.startViewTransition(applyExpand);
    transition.finished.finally(() => { this.el.style.viewTransitionName = ''; });
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
    const sizeSignature = `${cols}x${rows}`;
    if (sizeSignature === this.lastSentSize) return;
    this.lastSentSize = sizeSignature;
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
    const response = await fetch('/api/tasks/terminal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { this.setStatus(data.error || `failed to start terminal (${response.status})`, 'err'); return; }
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
    const eventSource = new EventSource(`/api/stream/${taskId}`);
    this.currentSource = eventSource;

    eventSource.addEventListener('output', (messageEvent) => {
      let outputEvent;
      try { outputEvent = JSON.parse(messageEvent.data); } catch (_) { return; }
      if (outputEvent.stream === 'stdin') return;
      this.term.write(outputEvent.data);
    });

    eventSource.addEventListener('end', () => {
      eventSource.close();
      if (this.currentSource === eventSource) this.currentSource = null;
      this.close();
    });

    eventSource.onerror = () => {
      if (!this.taskId) return;
      this.setStatus('reconnecting…', 'warn');
    };
  }

  async close() {
    termCards.delete(this);
    if (this.parentCard) this.parentCard.releaseLinkedTerminalCard(this);
    if (this.currentSource) { this.currentSource.close(); this.currentSource = null; }
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.term) { try { this.term.dispose(); } catch (_) {} this.term = null; }
    if (this.el.classList.contains('expanded')) {
      $('#cards').classList.remove('has-expanded');
    }
    const taskIdToDelete = this.taskId;
    this.taskId = null;
    clearActiveCardIfMatch(this.el);
    if (this.el.parentNode) this.el.remove();
    if (taskIdToDelete) {
      await fetch(`/api/tasks/${taskIdToDelete}`, { method: 'DELETE' }).catch(() => {});
    }
  }
}

// --- git cheat sheet -------------------------------------------------------

const GIT_COMMANDS = [
  {
    category: 'Status & History',
    commands: [
      { cmd: 'git status', desc: 'Show working tree status' },
      { cmd: 'git log', desc: 'Show commit history' },
      { cmd: 'git log --oneline', desc: 'Compact commit history' },
      { cmd: 'git diff', desc: 'Show unstaged changes' },
      { cmd: 'git diff --staged', desc: 'Show staged changes' },
    ],
  },
  {
    category: 'Staging & Committing',
    commands: [
      { cmd: 'git add .', desc: 'Stage all changes' },
      { cmd: 'git add -p', desc: 'Interactively stage hunks' },
      { cmd: 'git commit -m "<message>"', desc: 'Commit with message' },
      { cmd: 'git commit --amend', desc: 'Amend the last commit' },
    ],
  },
  {
    category: 'Branching',
    commands: [
      { cmd: 'git branch', desc: 'List local branches' },
      { cmd: 'git checkout -b <branch>', desc: 'Create and switch to new branch' },
      { cmd: 'git checkout <branch>', desc: 'Switch to existing branch' },
      { cmd: 'git merge <branch>', desc: 'Merge branch into current' },
      { cmd: 'git rebase <branch>', desc: 'Rebase current branch onto branch' },
      { cmd: 'git branch -d <branch>', desc: 'Delete a merged branch' },
    ],
  },
  {
    category: 'Remote',
    commands: [
      { cmd: 'git remote -v', desc: 'List configured remotes' },
      { cmd: 'git fetch', desc: 'Fetch from remote' },
      { cmd: 'git pull', desc: 'Fetch and merge from remote' },
      { cmd: 'git push', desc: 'Push to remote' },
      { cmd: 'git push -u origin <branch>', desc: 'Push and set upstream' },
      { cmd: 'git clone <url>', desc: 'Clone a repository' },
    ],
  },
  {
    category: 'Stashing',
    commands: [
      { cmd: 'git stash', desc: 'Stash current changes' },
      { cmd: 'git stash pop', desc: 'Apply and remove last stash' },
      { cmd: 'git stash list', desc: 'List all stashes' },
    ],
  },
  {
    category: 'Undoing',
    commands: [
      { cmd: 'git reset HEAD~1', desc: 'Undo last commit, keep changes unstaged' },
      { cmd: 'git reset --hard HEAD', desc: 'Discard all uncommitted changes' },
      { cmd: 'git revert <hash>', desc: 'Create a new revert commit' },
      { cmd: 'git restore <file>', desc: 'Discard changes in a working-tree file' },
    ],
  },
];

let gitCheatsheetTargetCard = null;
let gitCheatsheetBuilt = false;

function buildGitCheatsheet() {
  if (gitCheatsheetBuilt) return;
  gitCheatsheetBuilt = true;
  const content = $('#git-cheatsheet-content');

  // Render cmd string with <placeholder> tokens highlighted as styled <em> elements.
  function renderCmdCode(cmd) {
    const el = document.createElement('code');
    const parts = cmd.split(/(<[^>]+>)/);
    for (const part of parts) {
      if (/^<[^>]+>$/.test(part)) {
        const em = document.createElement('em');
        em.className = 'git-cmd-placeholder';
        em.textContent = part;
        el.appendChild(em);
      } else if (part) {
        el.appendChild(document.createTextNode(part));
      }
    }
    return el;
  }

  for (const { category, commands } of GIT_COMMANDS) {
    const section = document.createElement('div');
    section.className = 'git-cmd-section';
    const heading = document.createElement('h3');
    heading.textContent = category;
    section.appendChild(heading);
    const list = document.createElement('ul');
    list.className = 'git-cmd-list';
    for (const { cmd, desc } of commands) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'git-cmd-btn';
      btn.dataset.cmd = cmd;
      const hasPlaceholder = /<[^>]+>/.test(cmd);
      if (hasPlaceholder) {
        btn.title = 'Contains placeholder — replace <…> with actual value before running';
      }
      const codeEl = renderCmdCode(cmd);
      const descEl = document.createElement('span');
      descEl.textContent = desc;
      btn.appendChild(codeEl);
      btn.appendChild(descEl);
      li.appendChild(btn);
      list.appendChild(li);
    }
    section.appendChild(list);
    content.appendChild(section);
  }
}

function openGitCheatsheet(card) {
  gitCheatsheetTargetCard = card;
  buildGitCheatsheet();
  const dlg = $('#git-cheatsheet-dialog');
  if (!dlg.open) dlg.showModal();
}

function addTerminalCard({ cwd = '', afterEl = null, parentCard = null } = {}) {
  const card = new TerminalCard(parentCard);
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

function addGitHubCard({ afterEl = null, repoUrl = '', parentCard = null } = {}) {
  const card = new GitHubCard(parentCard);
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
  const cardByElement = new Map([...cards].map((card) => [card.el, card]));
  return order
    .map((el) => cardByElement.get(el))
    .filter(Boolean)
    .map((card) => ({
      agentId: card.agentSelect.value,
      cwd: card.cwd.value,
      lastTaskId: card.lastTaskId || null,
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
    }).then((response) => {
      if (!response.ok) console.error('[concilium] failed to save layout: HTTP', response.status);
    }).catch((err) => console.error('[concilium] failed to save layout:', err));
  }, 150);
}

async function restoreLayout() {
  let savedStates;
  try {
    const response = await fetch('/api/system/layout');
    if (response.ok) savedStates = await response.json();
  } catch (err) {
    console.error('[concilium] failed to load saved layout:', err);
  }
  if (!Array.isArray(savedStates) || savedStates.length === 0) {
    addCard();
  } else {
    // Create all cards synchronously so the DOM is populated in order.
    const entries = savedStates.map((savedState) => {
      const card = addCard({ agentId: savedState.agentId, cwd: savedState.cwd });
      return { card, savedState };
    });
    // Fan out session resumes in parallel to avoid serial RTTs.
    await Promise.all(entries.map(async ({ card, savedState }) => {
      if (savedState.lastTaskId) {
        card.taskIds.add(savedState.lastTaskId);
      }
      const agentMissing = savedState.agentId && !agentsById.has(savedState.agentId);
      if (!savedState.agentId) {
        card.setStatus('select an agent', 'warn');
        return;
      }
      if (agentMissing) {
        card.setStatus(`agent "${savedState.agentId}" no longer exists`, 'err');
        return;
      }
      const tryResume = async () => {
        try {
          const result = await card.run();
          if (result && result.ok) return null;
          const message = result && result.error ? result.error : 'resume failed — check agent configuration and retry';
          return new Error(message);
        } catch (err) {
          return err;
        }
      };

      let resumeErr = await tryResume();
      if (resumeErr) {
        await new Promise((resolve) => setTimeout(resolve, RESTORE_RESUME_RETRY_DELAY_MS));
        resumeErr = await tryResume();
      }
      if (resumeErr) {
        console.error('[concilium] failed to resume saved card session:', resumeErr);
        const detail = resumeErr.message ? `: ${resumeErr.message}` : '';
        card.setStatus(`failed to resume saved session${detail}`, 'err');
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

$('#cards').addEventListener('dragover', (dragEvent) => {
  if (!draggingCardEl) return;
  dragEvent.preventDefault();
  const main = $('#cards');
  const target = cardInsertTarget(main, dragEvent.clientX, dragEvent.clientY);
  main.insertBefore(draggingCardEl, target);
});

// --- settings dialog -------------------------------------------------------

const settingsDialog = $('#settings-dialog');
const onboardingDialog = $('#onboarding-dialog');
const onboardingFirstAgentForm = $('#onboarding-first-agent-form');
const onboardingAddAgentForm = $('#onboarding-add-agent-form');
const onboardingAgentsTableBody = $('#onboarding-agents-table tbody');
const onboardingGitHubTokenForm = $('#onboarding-github-token-form');
const onboardingGitHubTokenInput = $('#onboarding-github-token');
const onboardingGitHubTokenClearBtn = $('#onboarding-github-token-clear');
const onboardingBackBtn = $('#onboarding-back');
const onboardingNextBtn = $('#onboarding-next');
const onboardingFinishBtn = $('#onboarding-finish');
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
const newIssueAssignCopilotInput = $('#new-issue-assign-copilot');
const newIssueCreateBtn = $('#new-issue-create');
const newIssueStatusEl = $('#new-issue-status');
const shortcutsDialog = $('#shortcuts-dialog');
let editingId = null;
let onboardingStep = 1;
let onboardingHasAgent = false;
let onboardingHasToken = false;
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

function agentPayloadFromForm(form, includeId = false) {
  const fields = form.elements;
  const payload = {
    name: fields.name.value.trim() || fields.id.value.trim(),
    command: fields.command.value.trim(),
    interactive: fields.interactive.checked,
    args: fields.args.value.trim() ? fields.args.value.trim().split(/\s+/) : [],
  };
  if (includeId) payload.id = fields.id.value.trim();
  return payload;
}

async function refreshAgentsTable() {
  const response = await fetch('/api/agents');
  const agents = await response.json();
  const tbody = $('#agents-table tbody');
  tbody.replaceChildren();
  for (const agent of agents) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${agent.id}</td>
      <td>${agent.name || ''}</td>
      <td><code>${agent.command}${agent.args ? ' ' + agent.args.join(' ') : ''}</code></td>
      <td>${agent.interactive ? 'PTY' : 'piped'}</td>
      <td class="actions"></td>`;
    const actions = row.querySelector('.actions');
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'row-btn';
    editBtn.textContent = 'edit';
    editBtn.addEventListener('click', () => setFormMode('edit', agent));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'row-btn danger';
    delBtn.textContent = 'delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete agent "${agent.id}"?`)) return;
      const deleteResponse = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, { method: 'DELETE' });
      if (!deleteResponse.ok) { alert('delete failed'); return; }
      await refreshAgentsTable();
      await loadAgents();
    });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    tbody.appendChild(row);
  }
}

async function listAgents() {
  const response = await fetch('/api/agents');
  return response.json();
}

async function addAgent(payload) {
  const response = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'save failed');
  }
}

function setOnboardingStep(step) {
  onboardingStep = Math.max(1, Math.min(4, step));
  for (const section of onboardingDialog.querySelectorAll('.onboarding-step')) {
    section.hidden = Number(section.dataset.step) !== onboardingStep;
  }
  onboardingBackBtn.disabled = onboardingStep === 1;
  onboardingNextBtn.hidden = onboardingStep === 4;
  onboardingNextBtn.disabled = (onboardingStep === 1 || onboardingStep === 2) && !onboardingHasAgent;
  onboardingFinishBtn.hidden = onboardingStep !== 4;
  onboardingFinishBtn.disabled = !onboardingHasAgent;
}

async function refreshOnboardingAgentsTable() {
  const agents = await listAgents();
  onboardingAgentsTableBody.replaceChildren();
  for (const agent of agents) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${agent.id}</td>
      <td>${agent.name || ''}</td>
      <td><code>${agent.command}${agent.args ? ' ' + agent.args.join(' ') : ''}</code></td>
      <td>${agent.interactive ? 'PTY' : 'piped'}</td>
      <td class="actions"></td>`;
    const actions = row.querySelector('.actions');
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'row-btn danger';
    delBtn.textContent = 'delete';
    delBtn.addEventListener('click', async () => {
      const deleteResponse = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, { method: 'DELETE' });
      if (!deleteResponse.ok) { alert('delete failed'); return; }
      await Promise.all([refreshOnboardingAgentsTable(), refreshAgentsTable(), loadAgents()]);
    });
    actions.appendChild(delBtn);
    onboardingAgentsTableBody.appendChild(row);
  }
  onboardingHasAgent = agents.length > 0;
  setOnboardingStep(onboardingStep);
}

async function refreshOnboardingTokenState() {
  const response = await fetch('/api/system/github-token');
  if (!response.ok) {
    console.error('[concilium] failed to fetch onboarding token state: HTTP', response.status);
    onboardingHasToken = false;
    onboardingGitHubTokenInput.placeholder = 'ghp_...';
    return;
  }
  const data = await response.json().catch(() => ({}));
  onboardingHasToken = data.hasToken === true;
  onboardingGitHubTokenInput.placeholder = onboardingHasToken ? 'token already saved' : 'ghp_...';
}

async function maybeStartOnboarding() {
  const response = await fetch('/api/system/onboarding');
  if (!response.ok) return;
  const data = await response.json().catch(() => ({}));
  if (!data.needsOnboarding) return;
  onboardingFirstAgentForm.reset();
  onboardingAddAgentForm.reset();
  onboardingGitHubTokenInput.value = '';
  onboardingHasToken = data.hasToken === true;
  onboardingGitHubTokenInput.placeholder = onboardingHasToken ? 'token already saved' : 'ghp_...';
  setOnboardingStep(1);
  await refreshOnboardingAgentsTable();
  onboardingDialog.showModal();
  onboardingFirstAgentForm.elements.id.focus();
}

async function refreshDiscoverTable() {
  const discoverResponse = await fetch('/api/agents/discover');
  const discoveredAgents = await discoverResponse.json();
  const existingAgentsResponse = await fetch('/api/agents');
  const existingIds = new Set((await existingAgentsResponse.json()).map((agent) => agent.id));
  const tbody = $('#discover-table tbody');
  tbody.replaceChildren();
  for (const discovered of discoveredAgents) {
    const row = document.createElement('tr');
    const pathCell = discovered.found
      ? `<span class="found">${discovered.found}</span>`
      : `<span class="muted">not found</span>`;
    row.innerHTML = `
      <td>${discovered.id}</td>
      <td><code>${discovered.command}</code></td>
      <td>${pathCell}</td>
      <td class="actions"></td>`;
    const actions = row.querySelector('.actions');
    if (discovered.found && !existingIds.has(discovered.id)) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'row-btn';
      addBtn.textContent = 'add';
      addBtn.addEventListener('click', async () => {
        const addResponse = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: discovered.id,
            name: discovered.name,
            command: discovered.found,
            interactive: discovered.interactive,
          }),
        });
        if (!addResponse.ok) { alert('add failed'); return; }
        await refreshAgentsTable();
        await refreshDiscoverTable();
        await loadAgents();
      });
      actions.appendChild(addBtn);
    } else if (existingIds.has(discovered.id)) {
      actions.innerHTML = '<span class="muted">already added</span>';
    }
    tbody.appendChild(row);
  }
}

async function loadGitHubToken() {
  const response = await fetch('/api/system/github-token');
  githubTokenInput.value = '';
  githubTokenInput.placeholder = 'ghp_...';
  if (!response.ok) {
    return;
  }
  const data = await response.json().catch((err) => {
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
    const response = await fetch('/api/system/new-project/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
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
    const response = await fetch('/api/system/pick-directory', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
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

agentForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  const payload = agentPayloadFromForm(agentForm);
  let response;
  if (editingId) {
    response = await fetch(`/api/agents/${encodeURIComponent(editingId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } else {
    payload.id = agentForm.id.value.trim();
    response = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    alert(err.error || 'save failed');
    return;
  }
  setFormMode('add');
  await refreshAgentsTable();
  await loadAgents();
});

$('#agent-cancel').addEventListener('click', (clickEvent) => { clickEvent.preventDefault(); setFormMode('add'); });
$('#discover-btn').addEventListener('click', refreshDiscoverTable);
githubTokenForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  const submitBtn = githubTokenForm.querySelector('button[type="submit"]');
  const submitLabel = submitBtn ? submitBtn.dataset.label || submitBtn.textContent : '';
  if (submitBtn && !submitBtn.dataset.label) submitBtn.dataset.label = submitLabel;
  const response = await fetch('/api/system/github-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ GITHUB_TOKEN: githubTokenInput.value }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
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
$('#close-settings').addEventListener('click', () => settingsDialog.close());
$('#open-settings').addEventListener('click', async () => {
  setFormMode('add');
  $('#discover-table tbody').replaceChildren();
  await Promise.all([refreshAgentsTable(), loadGitHubToken()]);
  settingsDialog.showModal();
});
onboardingDialog.addEventListener('cancel', (cancelEvent) => cancelEvent.preventDefault());
onboardingBackBtn.addEventListener('click', () => setOnboardingStep(onboardingStep - 1));
onboardingNextBtn.addEventListener('click', async () => {
  if (onboardingStep === 1 || onboardingStep === 2) {
    await refreshOnboardingAgentsTable();
    if (!onboardingHasAgent) return;
  }
  setOnboardingStep(onboardingStep + 1);
});
onboardingFinishBtn.addEventListener('click', async () => {
  const response = await fetch('/api/system/onboarding/complete', { method: 'POST' });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    alert(err.error || 'finish failed');
    return;
  }
  onboardingDialog.close();
  await Promise.all([refreshAgentsTable(), loadAgents()]);
});
onboardingFirstAgentForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  try {
    const shouldAdvance = onboardingStep === 1;
    await addAgent(agentPayloadFromForm(onboardingFirstAgentForm, true));
    onboardingFirstAgentForm.reset();
    await Promise.all([refreshOnboardingAgentsTable(), refreshAgentsTable(), loadAgents()]);
    if (shouldAdvance) setOnboardingStep(2);
  } catch (err) {
    alert(err.message || 'add failed');
  }
});
onboardingAddAgentForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  try {
    await addAgent(agentPayloadFromForm(onboardingAddAgentForm, true));
    onboardingAddAgentForm.reset();
    await Promise.all([refreshOnboardingAgentsTable(), refreshAgentsTable(), loadAgents()]);
  } catch (err) {
    alert(err.message || 'add failed');
  }
});
onboardingGitHubTokenForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  const token = onboardingGitHubTokenInput.value.trim();
  if (!token) {
    if (!onboardingHasToken) {
      await refreshOnboardingTokenState();
    }
    onboardingGitHubTokenInput.value = '';
    return;
  }
  const response = await fetch('/api/system/github-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ GITHUB_TOKEN: token }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    alert(err.error || 'save failed');
    return;
  }
  await refreshOnboardingTokenState();
  onboardingGitHubTokenInput.value = '';
  if (onboardingStep === 3) setOnboardingStep(4);
});
onboardingGitHubTokenClearBtn.addEventListener('click', () => {
  onboardingGitHubTokenInput.value = '';
  onboardingGitHubTokenInput.focus();
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
newProjectForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
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
    const response = await fetch('/api/system/new-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        targetPath: newProjectTargetInput.value.trim(),
        private: newProjectPrivateInput.checked,
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const baseError = data.error || 'Project creation failed.';
      const withRepoUrl = data.repoUrl ? `${baseError} ${data.repoUrl}` : baseError;
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
newIssueForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  if (newIssueCreateBtn.disabled) return;

  const originalButtonText = newIssueCreateBtn.textContent;
  newIssueCreateBtn.disabled = true;
  newIssueCreateBtn.textContent = 'Creating…';
  setNewIssueStatus('Creating issue…');
  try {
    const trimmedBody = newIssueBodyInput.value.trim();
    const assignCopilot = newIssueAssignCopilotInput.checked;
    const response = await fetch('/api/system/new-issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: newIssueRepoUrl,
        title: newIssueTitleInput.value.trim(),
        assignCopilot,
        ...(trimmedBody ? { body: trimmedBody } : {}),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNewIssueStatus(data.error || 'Failed to create issue. Please try again.', 'err');
      return;
    }
    if (newIssueCreatedHook) await newIssueCreatedHook(data);
    if (assignCopilot && data && data.copilotAssigned === false) {
      newIssueForm.reset();
      setNewIssueStatus('Issue created, but Copilot assignment failed. Verify that the Copilot coding agent is enabled in your GitHub repository settings.', 'warn');
      updateNewIssueCreateState();
      return;
    }
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
  const theme = currentTheme();
  const themeButton = $('#theme-toggle');
  // THEME_ICON values are static code-defined SVG strings, not user input.
  themeButton.innerHTML = THEME_ICON[theme];
  themeButton.setAttribute('aria-label', `Theme: ${THEME_LABEL[theme]} (click to cycle)`);
  themeButton.title = `Theme: ${THEME_LABEL[theme]} (click to cycle)`;
}
$('#theme-toggle').addEventListener('click', () => {
  const currentIndex = THEME_ORDER.indexOf(currentTheme());
  applyTheme(THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length]);
});
updateThemeButton();

const shortcutsButton = $('#open-shortcuts');
const primaryLabel = IS_MAC ? 'Cmd' : 'Ctrl';
shortcutsButton.title = `Keyboard shortcuts (${primaryLabel}+Alt+/)`;
shortcutsButton.setAttribute('aria-label', `Keyboard shortcuts (${primaryLabel}+Alt+/)`);
shortcutsButton.addEventListener('click', openShortcutsDialog);
$('#close-shortcuts').addEventListener('click', () => shortcutsDialog.close());
for (const shortcutCodeEl of shortcutsDialog.querySelectorAll('code')) {
  shortcutCodeEl.textContent = shortcutCodeEl.textContent.replace('Cmd/Ctrl', primaryLabel);
}

// --- git cheat sheet dialog ------------------------------------------------

const gitCheatsheetDialog = $('#git-cheatsheet-dialog');
$('#close-git-cheatsheet').addEventListener('click', () => gitCheatsheetDialog.close());
gitCheatsheetDialog.addEventListener('close', () => { gitCheatsheetTargetCard = null; });
$('#git-cheatsheet-content').addEventListener('click', (clickEvent) => {
  const btn = clickEvent.target.closest('.git-cmd-btn');
  if (!btn || !gitCheatsheetTargetCard || !gitCheatsheetTargetCard.el.isConnected) return;
  gitCheatsheetTargetCard.sendRaw(btn.dataset.cmd);
  gitCheatsheetDialog.close();
});

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
document.addEventListener('focusin', (focusEvent) => focusCardFromNode(focusEvent.target), true);
document.addEventListener('pointerdown', (pointerEvent) => focusCardFromNode(pointerEvent.target), true);
window.addEventListener('keydown', handleKeyboardShortcut, true);

// --- bootstrap -------------------------------------------------------------

(async () => {
  await loadHealth();
  await loadAgents();
  await restoreLayout();
  await maybeStartOnboarding();
  setInterval(loadHealth, 10000);
})();
