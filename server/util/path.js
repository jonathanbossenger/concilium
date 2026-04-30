const os = require('os');

/**
 * Expand a leading `~` to the current user's home directory.
 * Handles `~`, `~/`, and `~/foo/bar`; does NOT expand `~user/` (other-user
 * home lookup is intentionally unsupported).
 *
 * @param {string} p - Path that may start with `~`
 * @returns {string} Absolute path with `~` replaced by `os.homedir()`
 */
function expandTilde(p) {
  return (p || '').replace(/^~(?=\/|$)/, os.homedir());
}

module.exports = { expandTilde };
