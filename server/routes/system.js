const express = require('express');
const { execFile } = require('child_process');
const store = require('../store');

const router = express.Router();

function pickDirectoryMac() {
  return new Promise((resolve, reject) => {
    const script =
      'try\n' +
      '  set f to choose folder with prompt "Select working directory"\n' +
      '  POSIX path of f\n' +
      'on error number -128\n' +
      '  return ""\n' +
      'end try';
    execFile('osascript', ['-e', script], (err, stdout) => {
      if (err) return reject(err);
      const path = stdout.toString().trim();
      resolve(path || null);
    });
  });
}

function pickDirectoryLinux() {
  return new Promise((resolve, reject) => {
    execFile(
      'zenity',
      ['--file-selection', '--directory', '--title=Select working directory'],
      (err, stdout) => {
        if (err) {
          // zenity exits 1 on cancel — treat as "no selection".
          if (err.code === 1) return resolve(null);
          return reject(err);
        }
        const path = stdout.toString().trim();
        resolve(path || null);
      },
    );
  });
}

function pickDirectoryWindows() {
  return new Promise((resolve, reject) => {
    const script =
      'Add-Type -AssemblyName System.Windows.Forms | Out-Null;' +
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog;' +
      '$d.Description = "Select working directory";' +
      'if ($d.ShowDialog() -eq "OK") { Write-Output $d.SelectedPath }';
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      (err, stdout) => {
        if (err) return reject(err);
        const path = stdout.toString().trim();
        resolve(path || null);
      },
    );
  });
}

router.post('/pick-directory', async (req, res) => {
  try {
    let path = null;
    if (process.platform === 'darwin') path = await pickDirectoryMac();
    else if (process.platform === 'linux') path = await pickDirectoryLinux();
    else if (process.platform === 'win32') path = await pickDirectoryWindows();
    else return res.status(501).json({ error: `picker not supported on ${process.platform}` });

    res.json({ path });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.get('/layout', (req, res) => {
  const raw = store.getLayout();
  if (!raw) return res.json([]);
  try {
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error('[agent-dashboard] failed to parse stored layout:', err);
    res.json([]);
  }
});

router.post('/layout', (req, res) => {
  const body = req.body;
  if (!Array.isArray(body)) return res.status(400).json({ error: 'array expected' });
  store.saveLayout(JSON.stringify(body));
  res.json({ ok: true });
});

module.exports = router;
