import { $ } from './utils.js';

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

export function openGitCheatsheet(card) {
  gitCheatsheetTargetCard = card;
  buildGitCheatsheet();
  const dlg = $('#git-cheatsheet-dialog');
  if (!dlg.open) dlg.showModal();
}

export function getGitCheatsheetTargetCard() {
  return gitCheatsheetTargetCard;
}

export function clearGitCheatsheetTargetCard() {
  gitCheatsheetTargetCard = null;
}
