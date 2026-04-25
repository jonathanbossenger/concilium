// node-pty's prebuilt `spawn-helper` binary loses its executable bit during npm
// install (npm strips it). Restore it on POSIX so PTY spawns don't fail with
// `posix_spawnp failed.` This is a no-op on Windows (no spawn-helper) and on
// platforms where the binary isn't present.

const fs = require('fs');
const path = require('path');

if (process.platform === 'win32') process.exit(0);

const arches = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];
const base = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');

for (const arch of arches) {
  const helper = path.join(base, arch, 'spawn-helper');
  try {
    fs.chmodSync(helper, 0o755);
  } catch (_) { /* not present for this platform */ }
}
