#!/usr/bin/env node
/* eslint-disable no-console */
/*
 * Capture marketing/docs media for Concilium.
 *
 * Outputs to ./screenshots/:
 *   - dashboard.png       1920x1080
 *   - hero.png            1920x1080
 *   - settings.png        1920x1080
 *   - walkthrough.webm    1920x1080  (Playwright VP8 recording)
 *   - walkthrough.mp4     1920x1080  (H.264, written if ffmpeg is on PATH)
 *
 * Layout: 3 columns × 2 rows showcasing two real projects, each with
 * an agent card + a terminal card + a GitHub card. The grid is forced
 * via injected CSS so the shoot is identical regardless of viewport.
 *
 * Prerequisites:
 *   - Concilium server reachable at CONCILIUM_URL (default
 *     http://127.0.0.1:7878). Start it with `npm start` or
 *     `./bin/conciliumctl start`.
 *   - Playwright browsers installed: `npx playwright install chromium`.
 *   - ffmpeg on PATH for the .mp4 conversion (optional).
 *
 * To swap in different projects, edit the PROJECTS array below.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = Number(process.env.CONCILIUM_PORT || 7878);
const HOST = process.env.CONCILIUM_HOST || '127.0.0.1';
const URL = process.env.CONCILIUM_URL || `http://${HOST}:${PORT}/`;
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'screenshots');
const VIDEO_DIR = path.join(OUT_DIR, '_video');

// Two real projects to populate the council layout. Each entry produces
// an agent card + terminal card + GitHub card (3 cards), and we render
// them in two rows to demonstrate parallel multi-project work.
const PROJECTS = [
  {
    label: 'wp-docs-health-monitor',
    cwd: '~/development/agentic/wp-docs-health-monitor/',
    agentId: 'claude',
    termCommands: ['git log --oneline -4', 'ls -la'],
  },
  {
    label: 'woocommerce',
    cwd: '~/development/agentic/woocommerce/',
    agentId: 'copilot',
    termCommands: ['git status -s', 'git log --oneline -4'],
  },
];

// 3 columns × 2 rows, both rows sized to fit the 1080px viewport so no
// page scroll is needed. Cards' inner regions (GitHub list, terminal
// viewport) handle their own overflow.
const GRID_CSS = `
  html, body { height: 100% !important; overflow: hidden !important; }
  main#cards {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    grid-template-rows: repeat(2, minmax(0, 1fr)) !important;
    grid-auto-rows: minmax(0, 1fr) !important;
    height: calc(100vh - 56px) !important;
    overflow: hidden !important;
    align-items: stretch !important;
  }
  main#cards > .card {
    min-height: 0 !important;
    max-height: 100% !important;
    overflow: hidden !important;
  }
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function api(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: urlPath,
        method,
        headers: data
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try {
            resolve(chunks ? JSON.parse(chunks) : null);
          } catch (_) {
            resolve(chunks);
          }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function stageLayout() {
  const original = await api('GET', '/api/system/layout');
  console.log('original layout:', JSON.stringify(original));
  const staged = PROJECTS.map((p) => ({
    agentId: p.agentId,
    cwd: p.cwd,
    lastTaskId: null,
  }));
  await api('POST', '/api/system/layout', staged);
  return original;
}

async function restoreLayout(original) {
  await sleep(1200);
  await api('POST', '/api/system/layout', original || []);
  console.log('restored original layout');
}

async function buildSixCardLayout(page) {
  await page.waitForSelector('main#cards .card', { timeout: 10000 });
  await sleep(900);

  // Force 3×2 grid regardless of viewport / card count.
  await page.addStyleTag({ content: GRID_CSS });
  await sleep(200);

  // Agent cards already exist from the staged layout. For each, add github
  // then terminal so the final order per project is [agent, term, github].
  for (let i = 0; i < PROJECTS.length; i++) {
    // Re-query each iteration: DOM order shifts as we insert new cards.
    const agents = page.locator(
      'main#cards > .card:not(.card-terminal):not(.card-github-list)',
    );
    const agentCard = agents.nth(i);
    await agentCard.scrollIntoViewIfNeeded();

    // Wait until the cwd has been auto-checked for a GitHub remote — the
    // .card-github button is hidden until then.
    const ghBtn = agentCard.locator('.card-github');
    try {
      await ghBtn.waitFor({ state: 'visible', timeout: 8000 });
      await ghBtn.click();
    } catch {
      console.warn(`[${PROJECTS[i].label}] github button never appeared; skipping`);
    }
    await sleep(2200); // let GitHub card fetch + render

    // Re-query agents — order may have shifted.
    const agents2 = page.locator(
      'main#cards > .card:not(.card-terminal):not(.card-github-list)',
    );
    await agents2.nth(i).locator('.card-open-term').click();
    await sleep(1200);
  }

  // Wait for all 6 cards to be present.
  await page
    .waitForFunction(
      () => document.querySelectorAll('main#cards > .card').length >= 6,
      { timeout: 8000 },
    )
    .catch(() => {
      console.warn('did not reach 6 cards within timeout — proceeding with what is rendered');
    });
  await sleep(800);
}

async function focusTerminal(page, termLocator) {
  // The xterm-scrollable-element intercepts pointer events on its children,
  // so a direct Playwright click on .xterm-screen never lands. Focus the
  // hidden helper textarea — that's the element xterm uses for keystrokes.
  await termLocator.scrollIntoViewIfNeeded();
  await termLocator.waitFor({ state: 'visible' });
  await termLocator
    .locator('.xterm-helper-textarea')
    .first()
    .waitFor({ state: 'attached', timeout: 5000 });
  await termLocator.evaluate((card) => {
    const helper = card.querySelector('.xterm-helper-textarea');
    if (helper) helper.focus();
  });
  await sleep(350);
}

async function populateTerminals(page) {
  const terms = page.locator('.card.card-terminal');
  const count = await terms.count();
  for (let i = 0; i < Math.min(count, PROJECTS.length); i++) {
    await focusTerminal(page, terms.nth(i));
    for (const cmd of PROJECTS[i].termCommands) {
      await page.keyboard.type(cmd + '\n');
      await sleep(950);
    }
  }
  await sleep(1500);
}

async function takeScreenshots(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(URL);
  await buildSixCardLayout(page);
  await populateTerminals(page);
  await sleep(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);

  // ---- dashboard.png ----
  await page.screenshot({ path: path.join(OUT_DIR, 'dashboard.png') });
  console.log('saved dashboard.png');

  // ---- hero.png — same layout, cursor parked off-canvas ----
  await page.mouse.move(0, 0);
  await page.addStyleTag({ content: GRID_CSS });
  await sleep(700);
  await page.screenshot({ path: path.join(OUT_DIR, 'hero.png') });
  console.log('saved hero.png');

  // ---- settings.png — settings dialog over the council layout ----
  await sleep(400);
  await page.click('#open-settings');
  await page
    .waitForSelector('#settings-dialog[open], #settings-dialog.open, dialog#settings-dialog', {
      timeout: 4000,
    })
    .catch(() => {});
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT_DIR, 'settings.png') });
  console.log('saved settings.png');
  await page.click('#close-settings').catch(() => {});
  await sleep(600);

  await ctx.close();
}

async function recordWalkthrough(browser) {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();
  await page.goto(URL);
  await sleep(2500);

  // Terminal/github cards don't persist across sessions — rebuild every time.
  const hasTerminal = (await page.locator('.card.card-terminal').count()) > 0;
  const hasGithub = (await page.locator('.card.card-github-list').count()) > 0;
  if (!hasTerminal || !hasGithub) {
    await buildSixCardLayout(page);
  } else {
    await page.addStyleTag({ content: GRID_CSS });
  }
  await sleep(1500);

  // ---- WALKTHROUGH (~63s) ----

  // Beat 1: pan over the council layout (3 cols × 2 rows).
  await page.mouse.move(960, 100);
  await sleep(2200);
  await page.mouse.move(320, 320);
  await sleep(1200);
  await page.mouse.move(1600, 320);
  await sleep(1200);
  await page.mouse.move(960, 800);
  await sleep(1500);

  // Beat 2: open the agent dropdown on project 1.
  const agentCards = page.locator(
    'main#cards > .card:not(.card-terminal):not(.card-github-list)',
  );
  const agent1 = agentCards.nth(0);
  await agent1.scrollIntoViewIfNeeded();
  await agent1.locator('.card-agent').hover();
  await sleep(1000);
  await agent1.locator('.card-agent').click();
  await sleep(1800);
  await page.keyboard.press('Escape');
  await sleep(900);

  // Beat 3: type into project 1's terminal.
  const terms = page.locator('.card.card-terminal');
  const term1 = terms.nth(0);
  await focusTerminal(page, term1);
  await page.keyboard.type('echo "wp-docs-health-monitor: ready"\n');
  await sleep(1300);
  await page.keyboard.type('git log --oneline -3\n');
  await sleep(1800);

  // Beat 4: focus project 1's GitHub card and refresh.
  const githubCards = page.locator('.card.card-github-list');
  const gh1 = githubCards.nth(0);
  await gh1.scrollIntoViewIfNeeded();
  await gh1.click();
  await sleep(1200);
  await gh1
    .locator('.card-refresh')
    .click()
    .catch(() => {});
  await sleep(2200);
  const firstPr1 = gh1.locator('.github-prs li').first();
  if ((await firstPr1.count()) > 0) {
    await firstPr1.hover();
    await sleep(2000);
  }

  // Beat 5: jump to project 2's agent card.
  const agent2 = agentCards.nth(1);
  await agent2.scrollIntoViewIfNeeded();
  await agent2.click();
  await sleep(1500);
  await agent2.locator('.card-agent').click();
  await sleep(1500);
  await page.keyboard.press('Escape');
  await sleep(900);

  // Beat 6: type into project 2's terminal.
  const term2 = terms.nth(1);
  await focusTerminal(page, term2);
  await page.keyboard.type('echo "woocommerce: ready"\n');
  await sleep(1300);
  await page.keyboard.type('git status -s\n');
  await sleep(1800);

  // Beat 7: project 2's GitHub card.
  const gh2 = githubCards.nth(1);
  await gh2.scrollIntoViewIfNeeded();
  await gh2.click();
  await sleep(1200);
  await gh2
    .locator('.card-refresh')
    .click()
    .catch(() => {});
  await sleep(2200);
  const firstPr2 = gh2.locator('.github-prs li').first();
  if ((await firstPr2.count()) > 0) {
    await firstPr2.hover();
    await sleep(2000);
  }

  // Beat 8: expand/collapse project 2's terminal. Re-apply grid CSS after
  // fullscreen toggle since the DOM may re-render.
  await term2
    .locator('.card-expand')
    .click()
    .catch(() => {});
  await sleep(2800);
  await term2
    .locator('.card-expand')
    .click()
    .catch(() => {});
  await sleep(1200);
  await page.addStyleTag({ content: GRID_CSS });
  await sleep(400);

  // Beat 9: open and close settings dialog.
  await page.click('#open-settings');
  await sleep(2500);
  await page.click('#close-settings');
  await sleep(1200);

  // Beat 10: cycle theme toggles.
  await page.locator('#theme-toggle').hover();
  await sleep(700);
  await page.click('#theme-toggle');
  await sleep(1700);
  await page.click('#theme-toggle');
  await sleep(1700);
  await page.click('#theme-toggle');
  await sleep(1700);

  // Beat 11: final pan across the layout.
  await page.mouse.move(320, 320);
  await sleep(1100);
  await page.mouse.move(960, 320);
  await sleep(1100);
  await page.mouse.move(1600, 320);
  await sleep(1100);
  await page.mouse.move(960, 800);
  await sleep(1500);

  const video = page.video();
  const tmpVideoPath = await video.path();
  await ctx.close();

  const finalWebm = path.join(OUT_DIR, 'walkthrough.webm');
  fs.copyFileSync(tmpVideoPath, finalWebm);
  console.log('saved walkthrough.webm at', finalWebm);

  try {
    fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
  } catch (_) {}
}

function convertToMp4() {
  return new Promise((resolve) => {
    const webm = path.join(OUT_DIR, 'walkthrough.webm');
    const mp4 = path.join(OUT_DIR, 'walkthrough.mp4');
    if (!fs.existsSync(webm)) {
      console.warn('walkthrough.webm not found — skipping mp4 conversion');
      return resolve();
    }
    const ff = spawn(
      'ffmpeg',
      [
        '-y',
        '-i', webm,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-crf', '23',
        '-preset', 'medium',
        mp4,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    ff.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('ffmpeg not found on PATH — skipping .mp4 conversion');
      } else {
        console.warn('ffmpeg failed:', err.message);
      }
      resolve();
    });
    ff.on('close', (code) => {
      if (code === 0) {
        console.log('saved walkthrough.mp4');
      } else {
        console.warn(`ffmpeg exited with code ${code} — .mp4 may be incomplete`);
      }
      resolve();
    });
  });
}

async function checkServerReachable() {
  try {
    await api('GET', '/api/agents');
  } catch (err) {
    throw new Error(
      `Concilium server unreachable at ${URL} — start it with \`npm start\` or \`./bin/conciliumctl start\` first (${err.message})`,
    );
  }
}

(async () => {
  await checkServerReachable();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('staging council layout...');
  const original = await stageLayout();

  let browser;
  try {
    browser = await chromium.launch();

    console.log('taking screenshots...');
    await takeScreenshots(browser);

    console.log('recording walkthrough...');
    await recordWalkthrough(browser);
  } finally {
    if (browser) await browser.close();
    await restoreLayout(original);
  }

  await convertToMp4();
  console.log('done.');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
