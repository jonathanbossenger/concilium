import { BaseCard } from './base-card.js';
import { $ } from './utils.js';
import { termCards, clearActiveCardIfMatch } from './state.js';
import { enableCardDragging } from './drag.js';

export class TerminalCard extends BaseCard {
  constructor(parentCard = null) {
    super();
    const template = $('#terminal-card-template');
    this.el = template.content.firstElementChild.cloneNode(true);
    this.closeBtn = $('.card-close', this.el);
    this.expandBtn = $('.card-expand', this.el);
    this.gitRefBtn = $('.card-git-ref', this.el);
    this.statusEl = $('.card-status', this.el);
    this.termEl = $('.card-term', this.el);
    this.headerEl = $('.card-header', this.el);
    this.dragHandleEl = $('.card-drag-handle', this.el);

    this.taskId = null;
    this.currentSource = null;
    this.term = null;
    this.fitAddon = null;
    this.resizeObserver = null;
    this.lastSentSize = null;
    this.parentCard = parentCard;

    this.closeBtn.addEventListener('click', () => this.close());
    this.expandBtn.addEventListener('click', () => this.toggleExpand());
    this.gitRefBtn.addEventListener('click', () => this._openGitCheatsheet());
    enableCardDragging(this.el, this.dragHandleEl || this.headerEl);

    termCards.add(this);
  }

  // Alias used by BaseCard methods (fitAndResize, sendRaw, initTerminal).
  get currentTaskId() {
    return this.taskId;
  }

  // Slot for git cheatsheet opener — filled by app.js.
  _openGitCheatsheet() {}

  async launch(cwd) {
    if (this.fitAddon && this.termEl.isConnected) {
      try { this.fitAddon.fit(); } catch (_) {}
    }
    const body = { cwd };
    if (this.term?.cols > 0 && this.term?.rows > 0) {
      body.cols = this.term.cols;
      body.rows = this.term.rows;
    }
    const response = await fetch('/api/tasks/terminal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
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
      document.querySelector('#cards').classList.remove('has-expanded');
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
