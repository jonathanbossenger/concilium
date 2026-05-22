'use strict';

// Centralised numeric / string constants used across the server.
// Import from here instead of scattering magic numbers in individual modules.

const DEFAULT_PTY_COLS = 120;
const DEFAULT_PTY_ROWS = 30;

const GITHUB_ITEMS_PER_PAGE = 20;

const TASK_LIST_CAP = 500;

const REQUEST_BODY_LIMIT = '1mb';

const SHUTDOWN_TIMEOUT_MS = 5000;

module.exports = {
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
  GITHUB_ITEMS_PER_PAGE,
  TASK_LIST_CAP,
  REQUEST_BODY_LIMIT,
  SHUTDOWN_TIMEOUT_MS,
};
