import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
  'base64',
);

function findEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Failed to bind ephemeral TCP port')));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttpReady(url, child, getLogs, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Vite server exited prematurely (code=${child.exitCode}):\n${getLogs()}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (_) {
      // Server not listening yet
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for Vite server at ${url}\n${getLogs()}`);
}

function hasNewerFileInDir(dir, targetMtime) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasNewerFileInDir(fullPath, targetMtime)) return true;
    } else if (entry.isFile()) {
      if (statSync(fullPath).mtimeMs > targetMtime) return true;
    }
  }
  return false;
}

async function ensureProductionBuild(viteBin) {
  const distHtml = path.join(ROOT_DIR, 'dist', 'index.html');
  let needsBuild = !existsSync(distHtml);
  if (!needsBuild) {
    const distMtime = statSync(distHtml).mtimeMs;
    const candidates = [
      path.join(ROOT_DIR, 'index.html'),
      path.join(ROOT_DIR, 'frontend', 'c2-console-theme.css'),
      path.join(ROOT_DIR, 'vite.config.ts'),
    ];
    for (const file of candidates) {
      if (existsSync(file) && statSync(file).mtimeMs > distMtime) {
        needsBuild = true;
        break;
      }
    }
    if (!needsBuild && hasNewerFileInDir(path.join(ROOT_DIR, 'src'), distMtime)) {
      needsBuild = true;
    }
  }
  if (needsBuild) {
    console.log('[verify:browser] Building production bundle for preview server...');
    await execFileAsync(process.execPath, [viteBin, 'build'], { cwd: ROOT_DIR });
  }
}

async function startViteServer() {
  const port = await findEphemeralPort();
  const viteBin = path.join(ROOT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  assert.ok(existsSync(viteBin), `Vite CLI binary missing at ${viteBin}`);

  const useDev = process.env.VITE_DEV === 'true' || process.env.VITE_DEV === '1';
  let commandArgs;
  if (useDev) {
    commandArgs = [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--no-open'];
  } else {
    await ensureProductionBuild(viteBin);
    commandArgs = [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--no-open'];
  }

  let logs = '';
  const child = spawn(process.execPath, commandArgs, {
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });
  child.stdout?.on('data', chunk => { logs += chunk.toString(); });
  child.stderr?.on('data', chunk => { logs += chunk.toString(); });

  const url = `http://127.0.0.1:${port}/`;
  try {
    await waitForHttpReady(url, child, () => logs);
  } catch (err) {
    await stopChild(child);
    throw err;
  }

  return {
    url,
    stop: () => stopChild(child),
  };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function bboxOverlapArea(a, b) {
  if (!a || !b) return 0;
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function assertInside(inner, outer, label, tolerancePx = 2) {
  assert.ok(inner && outer, `Missing bounding box for ${label}`);
  assert.ok(
    inner.x >= outer.x - tolerancePx &&
    inner.y >= outer.y - tolerancePx &&
    inner.x + inner.width <= outer.x + outer.width + tolerancePx &&
    inner.y + inner.height <= outer.y + outer.height + tolerancePx,
    `${label} (${JSON.stringify(inner)}) exceeds outer container (${JSON.stringify(outer)})`,
  );
}

async function waitForTelemetryReady(page, runtimeErrors) {
  await page.waitForSelector('#radar-canvas', { state: 'visible', timeout: 15000 });
  try {
    await page.waitForFunction(
      () => {
        const rows = document.querySelectorAll('#terminal-inventory-tbody tr');
        const t = document.getElementById('timeline-time-display')?.textContent || '00.00s';
        return rows.length > 0 && t !== '00.00s';
      },
      null,
      { timeout: 15000 },
    );
  } catch (err) {
    const diag = await page.evaluate(() => ({
      time: document.getElementById('timeline-time-display')?.textContent,
      pill: document.getElementById('inventory-selected-pill')?.textContent,
      rows: document.querySelectorAll('#terminal-inventory-tbody tr').length,
      tbody: document.getElementById('terminal-inventory-tbody')?.innerHTML?.slice(0, 200),
    })).catch(() => ({}));
    throw new Error(`${err.message}\nTelemetry diag: ${JSON.stringify(diag)}\nRuntime errors:\n${runtimeErrors.join('\n')}`);
  }
  await page.waitForTimeout(200);
}

async function ensureKargilScenarioLoaded(page) {
  const rowCount = await page.locator('#terminal-inventory-tbody tr td[colspan]').count();
  if (rowCount > 0 || (await page.locator('#terminal-inventory-tbody tr').count()) < 2) {
    await page.click('button[onclick="runKargilScenario()"]');
    await page.waitForFunction(
      () => {
        const placeholder = document.querySelector('#terminal-inventory-tbody tr td[colspan]');
        const rows = document.querySelectorAll('#terminal-inventory-tbody tr');
        return !placeholder && rows.length >= 2;
      },
      null,
      { timeout: 15000 },
    );
    await page.waitForTimeout(250);
  }
}

async function selectFirstTerminalFromInventory(page) {
  await page.click('#tab-btn-terminal');
  await page.waitForFunction(() => {
    const tr = document.querySelector('#terminal-inventory-tbody tr');
    if (!tr) return false;
    const r = tr.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const pt = await page.evaluate(() => {
    const tr = document.querySelector('#terminal-inventory-tbody tr');
    if (!tr) return null;
    tr.scrollIntoView({ block: 'center' });
    const r = tr.getBoundingClientRect();
    return { x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 };
  });
  assert.ok(pt && pt.x > 0 && pt.y > 0, 'First terminal inventory row must be positioned in viewport');
  await page.mouse.click(pt.x, pt.y);
  await page.click('#tab-btn-overview');
  await page.waitForFunction(() => {
    const el = document.getElementById('map-node-details');
    return el && !el.classList.contains('is-closed') && !el.classList.contains('is-empty');
  });
}

async function verifyViewport(browser, baseUrl, viewport, label) {
  console.log(`\n[verify:browser] Running UX verification on ${label} (${viewport.width}x${viewport.height})...`);
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  const runtimeErrors = [];
  page.on('pageerror', err => runtimeErrors.push(`pageerror: ${err?.stack || err}`));
  page.on('console', msg => {
    if (msg.type() === 'error') {
      runtimeErrors.push(`console.error: ${msg.text()}`);
    }
  });

  // Keep MapLibre raster requests local and deterministic offline.
  await page.route('https://server.arcgisonline.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: ONE_BY_ONE_PNG }),
  );

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForTelemetryReady(page, runtimeErrors);

    // Dismiss welcome box if visible so overview space behaves consistently.
    const welcomeDismiss = page.locator('#welcome-dismiss');
    if (await welcomeDismiss.isVisible()) {
      await welcomeDismiss.click();
    }

    // Load Kargil corridor transit scenario so active ground nodes populate cleanly,
    // verify runKargilScenario() keeps #map-node-details closed (Milestone 5),
    // and pause telemetry during deterministic UI/layout checks so 50 Hz DOM refreshes
    // do not contend with headless pointer checks.
    await ensureKargilScenarioLoaded(page);
    await page.waitForFunction(() => document.getElementById('map-node-details')?.classList.contains('is-closed'));
    await page.click('#btn-pause');
    await page.waitForFunction(() => document.getElementById('btn-pause')?.textContent?.trim() === 'RESUME');

    // Milestone 2 & Mobile Chrome Budget checks per viewport
    const chromeMetrics = await page.evaluate(() => {
      const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
      const stageToolbar = document.querySelector('.stage-toolbar')?.getBoundingClientRect();
      const rail = document.querySelector('.rail');
      const railRect = rail?.getBoundingClientRect();
      const railItems = Array.from(document.querySelectorAll('.rail .nav-tab, .rail .rail-utility'));
      const maxRailRight = railItems.reduce((mx, el) => Math.max(mx, el.getBoundingClientRect().right), 0);
      const radarRect = document.getElementById('radar-container')?.getBoundingClientRect();
      const speedReadout = document.getElementById('sim-speed-readout');
      const speedReadoutStyle = speedReadout ? getComputedStyle(speedReadout) : null;

      // Verify zero visible DOM elements with direct text compute < 10px fontSize
      const sub10Els = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const hasDirectText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent?.trim());
        if (!hasDirectText) continue;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const fs = parseFloat(st.fontSize);
        if (Number.isFinite(fs) && fs < 10) {
          sub10Els.push(`${el.tagName}#${el.id}.${el.className}:${fs}px`);
        }
      }

      // Verify #node-editor-form label[for] bindings and toolbox accessible names
      const unlabeledControls = [];
      for (const ctrl of Array.from(document.querySelectorAll('#node-editor-form input, #node-editor-form select'))) {
        if (!ctrl.id || !document.querySelector(`#node-editor-form label[for="${ctrl.id}"]`)) {
          unlabeledControls.push(`#node-editor-form:${ctrl.id || ctrl.tagName}`);
        }
      }
      for (const id of ['tb-transect-node-type', 'tb-transect-k', 'tb-probe-target', 'tb-backdrop-mode', 'tb-transect-height-a', 'tb-transect-height-b', 'tb-sweep-target', 'terrainFileInput', 'terrainFolderInput']) {
        const el = document.getElementById(id);
        if (!el) continue;
        const hasAria = Boolean(el.getAttribute('aria-label')?.trim() || el.getAttribute('aria-labelledby')?.trim());
        const hasLabel = Boolean(document.querySelector(`label[for="${id}"]`));
        if (!hasAria && !hasLabel) unlabeledControls.push(`#${id}`);
      }

      return {
        topbarH: topbar?.height ?? 0,
        stageToolbarH: stageToolbar?.height ?? 0,
        railScrollW: rail?.scrollWidth ?? 0,
        railClientW: rail?.clientWidth ?? 0,
        railRectH: railRect?.height ?? 0,
        maxRailRight,
        radarH: radarRect?.height ?? 0,
        speedReadoutHidden: speedReadoutStyle ? speedReadoutStyle.width === '1px' && speedReadoutStyle.height === '1px' : false,
        sub10Els,
        unlabeledControls,
      };
    });
    assert.equal(chromeMetrics.speedReadoutHidden, true, 'Duplicate #sim-speed-readout must be visually hidden (.sr-only)');
    assert.deepEqual(chromeMetrics.sub10Els, [], `Found visible DOM text < 10px: ${chromeMetrics.sub10Els.join(', ')}`);
    assert.deepEqual(chromeMetrics.unlabeledControls, [], `Unlabeled form/toolbox controls: ${chromeMetrics.unlabeledControls.join(', ')}`);
    if (viewport.width <= 1120 && viewport.width > 860) {
      assert.ok(chromeMetrics.topbarH <= 50, `Expected compact topbar <= 50px at ${viewport.width}px, got ${chromeMetrics.topbarH}`);
      assert.ok(chromeMetrics.stageToolbarH <= 76, `Expected <= 2-row stage-toolbar <= 76px at ${viewport.width}px, got ${chromeMetrics.stageToolbarH}`);
      assert.ok(chromeMetrics.radarH >= viewport.height * 0.48, `Laptop #radar-container height (${chromeMetrics.radarH}) must be >= 48% of ${viewport.height}`);
    }
    if (viewport.width <= 860) {
      assert.ok(chromeMetrics.topbarH <= 84, `Expected mobile topbar <= 84px at ${viewport.width}px, got ${chromeMetrics.topbarH}`);
      assert.ok(chromeMetrics.railScrollW <= chromeMetrics.railClientW + 1, `Mobile .rail must wrap without horizontal overflow (${chromeMetrics.railScrollW} > ${chromeMetrics.railClientW})`);
      assert.ok(chromeMetrics.maxRailRight <= viewport.width + 1, `All 8 rail tabs + Expert/Help must fit inside ${viewport.width}px (got right=${chromeMetrics.maxRailRight})`);
      assert.ok(chromeMetrics.radarH >= viewport.height * 0.48, `Mobile #radar-container height (${chromeMetrics.radarH}) must be >= 48% of ${viewport.height}`);
    }

    // Milestone 4: Narrative strip expand/collapse toggle
    const narExpBtn = page.locator('#btn-narrative-expand');
    assert.equal(await narExpBtn.isVisible(), true, '#btn-narrative-expand must be visible');
    assert.equal(await narExpBtn.getAttribute('aria-expanded'), 'false');
    await narExpBtn.click();
    assert.equal(await narExpBtn.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#overview-narrative').evaluate(el => el.classList.contains('is-expanded')), true);
    await narExpBtn.click();
    assert.equal(await narExpBtn.getAttribute('aria-expanded'), 'false');

    // Milestone 4: Destructive confirmation guards (Reset & Reset theater + Escape/outside disarm)
    await page.click('#btn-sim-reset');
    assert.equal(await page.getAttribute('#btn-sim-reset', 'data-confirm-armed'), 'true', '1st click on RESET must arm confirmation');
    await page.keyboard.press('Escape');
    assert.equal(await page.getAttribute('#btn-sim-reset', 'data-confirm-armed'), null, 'Escape must disarm #btn-sim-reset');

    await page.click('.preset-drawer summary');
    await page.click('#btn-reset-theater');
    assert.equal(await page.getAttribute('#btn-reset-theater', 'data-confirm-armed'), 'true', '1st click on Reset theater must arm confirmation');
    await page.click('#tab-overview', { position: { x: 8, y: 8 } });
    assert.equal(await page.getAttribute('#btn-reset-theater', 'data-confirm-armed'), null, 'Outside click must disarm #btn-reset-theater');
    await page.click('.preset-drawer summary');

    // ------------------------------------------------------------------
    // 1. Zero canvas resize on selection + pinned inspector + dismissal
    // ------------------------------------------------------------------
    await page.locator('#radar-container').scrollIntoViewIfNeeded();
    const beforeContainer = await page.locator('#radar-container').boundingBox();
    assert.ok(beforeContainer && beforeContainer.width > 200 && beforeContainer.height > 200, 'Radar container must have valid dimensions');

    await selectFirstTerminalFromInventory(page);
    await page.locator('#radar-container').scrollIntoViewIfNeeded();

    const afterContainer = await page.locator('#radar-container').boundingBox();
    assert.ok(afterContainer, 'Radar container missing after node selection');
    assert.equal(Math.round(afterContainer.width), Math.round(beforeContainer.width), 'Canvas container width must not resize on selection');
    assert.equal(Math.round(afterContainer.height), Math.round(beforeContainer.height), 'Canvas container height must not resize on selection');

    const inspBox = await page.locator('#map-node-details').boundingBox();
    const closeBtnBox = await page.locator('#btn-close-node-details').boundingBox();
    const losBtnBox = await page.locator('#btn-node-quick-los').boundingBox();
    const fresnelBtnBox = await page.locator('#btn-node-quick-fresnel').boundingBox();
    assertInside(inspBox, afterContainer, 'Node inspector');
    assertInside(closeBtnBox, inspBox, 'Inspector pinned [x] close button');
    assertInside(losBtnBox, inspBox, 'Inspector pinned [LOS] button');
    assertInside(fresnelBtnBox, inspBox, 'Inspector pinned [Fresnel] button');

    const contentOverflow = await page.locator('#map-node-detail-content').evaluate(el => getComputedStyle(el).overflowY);
    assert.equal(contentOverflow, 'auto', '#map-node-detail-content must own inner vertical scroll');
    const detailContentBox = await page.locator('#map-node-detail-content').boundingBox();
    assert.ok(detailContentBox && detailContentBox.height > 0, `#map-node-detail-content height must be > 0px, got ${detailContentBox?.height}`);

    // Milestone 4: Floating inspector Delete guard (Spatial Lock blocked status + 1st-click arm / canvas disarm)
    await page.click('#btn-spatial-lock');
    await page.waitForFunction(() => document.getElementById('btn-spatial-lock')?.getAttribute('aria-pressed') === 'true');
    const inspDelSel = '#map-node-details [data-map-action="delete"]';
    await page.click(inspDelSel);
    assert.equal(await page.getAttribute(inspDelSel, 'data-confirm-armed'), null, 'Locked inspector delete must not arm');
    const blockedStatus = (await page.locator('#map-node-action-status').textContent()) || '';
    assert.match(blockedStatus, /Spatial Lock/i, 'Blocked inspector delete must show visible status in #map-node-action-status');
    await page.click('#btn-spatial-lock');
    await page.waitForFunction(() => document.getElementById('btn-spatial-lock')?.getAttribute('aria-pressed') === 'false');

    await page.click(inspDelSel);
    assert.equal(await page.getAttribute(inspDelSel, 'data-confirm-armed'), 'true', '1st click on unlocked inspector delete must arm');
    await page.locator('#radar-canvas').click({ position: { x: 240, y: 140 } });
    assert.equal(await page.getAttribute(inspDelSel, 'data-confirm-armed'), null, 'Canvas click must disarm inspector delete');

    // Re-open inspector if canvas click dismissed it, and test #btn-node-delete in Terminals tab
    await selectFirstTerminalFromInventory(page);
    await page.click('#tab-btn-terminal');
    await page.click('#btn-node-delete');
    assert.equal(await page.getAttribute('#btn-node-delete', 'data-confirm-armed'), 'true', '1st click on #btn-node-delete must arm');
    await page.locator('#radar-canvas').click({ position: { x: 240, y: 140 } });
    assert.equal(await page.getAttribute('#btn-node-delete', 'data-confirm-armed'), null, 'Canvas click must disarm #btn-node-delete');
    await page.click('#tab-btn-overview');
    await selectFirstTerminalFromInventory(page);
    await page.locator('#radar-container').scrollIntoViewIfNeeded();

    await page.click('#btn-node-quick-los');
    assert.equal(await page.getAttribute('#btn-node-quick-los', 'aria-pressed'), 'true', '[LOS] toggle must activate cleanly');
    await page.click('#btn-node-quick-los');

    // Escape dismissal must hide only inspector while preserving selected node across tabs
    await page.locator('#map-node-details .map-node-header').click({ position: { x: 20, y: 10 } });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('map-node-details')?.classList.contains('is-closed'));
    const pillAfterEsc = await page.locator('#inventory-selected-pill').textContent();
    assert.match(pillAfterEsc || '', /^Selected: Node \d+/, 'Escape dismissal must preserve terminal selection');

    // Re-open inspector and verify empty-terrain neutral click dismissal
    await selectFirstTerminalFromInventory(page);
    await page.locator('#radar-container').scrollIntoViewIfNeeded();
    const canvasBox = await page.locator('#radar-canvas').boundingBox();
    assert.ok(canvasBox, 'Radar canvas missing');
    const candidateOffsets = [
      [0.88, 0.25],
      [0.18, 0.22],
      [0.85, 0.72],
      [0.50, 0.88],
      [0.25, 0.82],
    ];
    let dismissedByNeutralClick = false;
    for (const [fx, fy] of candidateOffsets) {
      await page.mouse.click(canvasBox.x + canvasBox.width * fx, canvasBox.y + canvasBox.height * fy);
      const isClosed = await page.locator('#map-node-details').evaluate(el => el.classList.contains('is-closed'));
      if (isClosed) {
        dismissedByNeutralClick = true;
        break;
      }
    }
    assert.ok(dismissedByNeutralClick, 'Clicking empty neutral terrain must close node inspector');
    const pillAfterClick = await page.locator('#inventory-selected-pill').textContent();
    assert.match(pillAfterClick || '', /^Selected: Node \d+/, 'Neutral click dismissal must preserve terminal selection');

    // ------------------------------------------------------------------
    // 2. Toolbar non-wrapping & floating overlay de-confliction
    // ------------------------------------------------------------------
    const toolbarAudit = await page.evaluate(() => {
      const groups = Array.from(document.querySelectorAll('.stage-toolbar .tool-group'));
      const failures = [];
      for (const grp of groups) {
        const style = getComputedStyle(grp);
        if (style.display === 'none') continue;
        const rect = grp.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (style.flexWrap !== 'nowrap') {
          failures.push(`tool-group flexWrap=${style.flexWrap} expected nowrap (${grp.textContent?.trim()})`);
        }
        const labelEl = grp.querySelector('.tool-label');
        const ctrlEl = grp.querySelector('.seg, button');
        if (labelEl && ctrlEl && getComputedStyle(labelEl).display !== 'none' && getComputedStyle(ctrlEl).display !== 'none') {
          const lr = labelEl.getBoundingClientRect();
          const cr = ctrlEl.getBoundingClientRect();
          const lCy = lr.top + lr.height / 2;
          const cCy = cr.top + cr.height / 2;
          if (Math.abs(lCy - cCy) > 14) {
            failures.push(`Label "${labelEl.textContent?.trim()}" wrapped vertically away from controls (dy=${Math.abs(lCy - cCy).toFixed(1)}px)`);
          }
        }
      }
      return failures;
    });
    assert.deepEqual(toolbarAudit, [], `Toolbar tool-group wrapping detected: ${toolbarAudit.join('; ')}`);

    // Open Node Inspector, Legend, and Map Layers simultaneously and verify zero bbox overlap
    await selectFirstTerminalFromInventory(page);
    await page.locator('#radar-container').scrollIntoViewIfNeeded();
    await page.click('#btn-legend-toggle');
    await page.waitForFunction(() => !document.querySelector('.map-legend')?.classList.contains('is-collapsed'));
    await page.click('#map-layers-btn');
    await page.waitForFunction(() => !document.getElementById('map-layers-popover')?.classList.contains('is-closed'));

    const legendBox = await page.locator('.map-legend').boundingBox();
    const layersBox = await page.locator('#map-layers-popover').boundingBox();
    const inspectorWithLayersBox = await page.locator('#map-node-details').boundingBox();
    const containerNow = await page.locator('#radar-container').boundingBox();

    assertInside(legendBox, containerNow, 'Map legend');
    assertInside(layersBox, containerNow, 'Map layers popover');
    assertInside(inspectorWithLayersBox, containerNow, 'Node inspector with layers open');

    assert.equal(bboxOverlapArea(legendBox, layersBox), 0, 'Legend and Map Layers popover must not overlap');
    assert.equal(bboxOverlapArea(legendBox, inspectorWithLayersBox), 0, 'Legend and Node Inspector must not overlap');
    assert.equal(bboxOverlapArea(layersBox, inspectorWithLayersBox), 0, 'Map Layers popover and Node Inspector must not overlap');

    // Milestone 1: Mutual exclusion — opening Terrain Toolbox auto-closes Map Layers (and inspector when cw < 1100)
    await page.click('#terrain-toolbox-toggle-btn');
    await page.waitForFunction(() => document.getElementById('terrain-toolbox-stack')?.getAttribute('data-tb-expanded') === 'true');
    assert.equal(await page.locator('#map-layers-popover').isVisible(), false, 'Expanding toolbox must close Map Layers popover');
    if (containerNow.width < 1100) {
      assert.equal(
        await page.locator('#map-node-details').evaluate(el => el.classList.contains('is-closed')),
        true,
        'Expanding toolbox on cw < 1100 must dismiss Node Inspector',
      );
    }
    await page.click('#terrain-toolbox-close-btn');
    await page.click('#btn-legend-toggle');
    if (await page.locator('#btn-close-node-details').isVisible()) {
      await page.click('#btn-close-node-details');
    }

    // Verify bottom-left cursor HUD & spatial lock pill clear the 36px left icon rail
    const railBox = await page.locator('.tb-icon-rail').boundingBox();
    assert.ok(railBox && railBox.width >= 34 && railBox.width <= 40, `Expected ~36px left icon rail, got ${railBox?.width}`);
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.52, canvasBox.y + canvasBox.height * 0.52);
    await page.waitForTimeout(80);
    const cursorHudBox = await page.locator('#radar-cursor-hud').boundingBox();
    assert.ok(cursorHudBox, 'Cursor HUD bounding box missing');
    assert.ok(
      cursorHudBox.x >= railBox.x + railBox.width,
      `Cursor HUD (${cursorHudBox.x}) overlaps left icon rail right edge (${railBox.x + railBox.width})`,
    );

    await page.click('#btn-spatial-lock');
    const lockPillBox = await page.locator('#radar-hud-locked-pill').boundingBox();
    assert.ok(lockPillBox, 'Spatial lock pill must be visible when spatial lock is ON');
    assert.ok(
      lockPillBox.x >= railBox.x + railBox.width,
      `Locked HUD pill (${lockPillBox.x}) overlaps left icon rail right edge (${railBox.x + railBox.width})`,
    );
    await page.click('#btn-spatial-lock');

    // ------------------------------------------------------------------
    // 3. Terrain Toolbox auto-minimize during picking & workflow
    // ------------------------------------------------------------------
    await page.locator('#radar-container').scrollIntoViewIfNeeded();
    const tbCanvasBox = await page.locator('#radar-canvas').boundingBox();
    assert.ok(tbCanvasBox, 'Radar canvas box missing before toolbox workflow');
    await page.click('#terrain-toolbox-toggle-btn');
    await page.waitForFunction(() => document.getElementById('terrain-toolbox-stack')?.getAttribute('data-tb-expanded') === 'true');
    await page.click('.tb-mode-tab[data-tb-mode="transect"]');
    await page.click('#terrain-measure-btn');

    assert.equal(
      await page.getAttribute('#terrain-toolbox-stack', 'data-tb-picking'),
      'true',
      'Transect 2-Pt picking must set data-tb-picking="true"',
    );
    assert.equal(await page.locator('#tb-picking-bar').isVisible(), true, '#tb-picking-bar must be visible while picking');
    assert.equal(await page.locator('#terrain-toolbox-panel').isVisible(), false, '.terrain-toolbox-panel must auto-hide while picking');
    assert.equal(await page.locator('#terrain-toolbox-drawer').isVisible(), false, '.terrain-toolbox-drawer must auto-hide while picking');

    await page.mouse.click(tbCanvasBox.x + tbCanvasBox.width * 0.42, tbCanvasBox.y + tbCanvasBox.height * 0.46);
    await page.mouse.click(tbCanvasBox.x + tbCanvasBox.width * 0.62, tbCanvasBox.y + tbCanvasBox.height * 0.56);

    await page.waitForSelector('#tb-transect-canvas', { state: 'visible', timeout: 10000 });
    const drawerBox = await page.locator('#terrain-toolbox-drawer').boundingBox();
    assert.ok(drawerBox && drawerBox.height >= 100, `#terrain-toolbox-drawer height must be >= 100px when open, got ${drawerBox?.height}`);
    assert.equal(await page.getAttribute('#terrain-toolbox-stack', 'data-tb-picking'), 'false', 'Picking flag must reset after 2nd point');
    assert.equal(await page.locator('#tb-export-csv-btn').isVisible(), true, '#tb-export-csv-btn must appear in transect drawer');
    assert.equal(await page.locator('#tb-apply-acn-waypoints-btn').isVisible(), true, '#tb-apply-acn-waypoints-btn must appear in transect drawer');
    await page.click('#terrain-measure-clear-btn');

    // Mode 3: Site Probe smoke test
    await page.click('.tb-rail-btn[data-tb-rail-mode="probe"]');
    await page.click('#tb-probe-pick-btn');
    assert.equal(await page.getAttribute('#terrain-toolbox-stack', 'data-tb-picking'), 'true', 'Probe picking must set data-tb-picking="true"');
    assert.equal(await page.locator('#terrain-toolbox-panel').isVisible(), false, 'Panel must hide during probe picking');
    await page.mouse.click(tbCanvasBox.x + tbCanvasBox.width * 0.5, tbCanvasBox.y + tbCanvasBox.height * 0.48);
    await page.waitForSelector('#tb-polar-canvas', { state: 'visible', timeout: 10000 });
    await page.waitForSelector('#tb-sweep-canvas', { state: 'visible', timeout: 10000 });
    await page.click('#tb-probe-clear-btn');

    // Mode 4: Region polygon smoke test
    await page.click('.tb-rail-btn[data-tb-rail-mode="region"]');
    await page.click('#terrain-region-btn');
    assert.equal(await page.getAttribute('#terrain-toolbox-stack', 'data-tb-picking'), 'true', 'Region drawing must set data-tb-picking="true"');
    assert.equal(await page.locator('#terrain-toolbox-panel').isVisible(), false, 'Panel must hide while drawing region');
    await page.mouse.click(tbCanvasBox.x + tbCanvasBox.width * 0.44, tbCanvasBox.y + tbCanvasBox.height * 0.44);
    await page.mouse.click(tbCanvasBox.x + tbCanvasBox.width * 0.58, tbCanvasBox.y + tbCanvasBox.height * 0.44);
    await page.mouse.click(tbCanvasBox.x + tbCanvasBox.width * 0.51, tbCanvasBox.y + tbCanvasBox.height * 0.58);
    await page.click('#tb-picking-finish-btn');
    await page.waitForSelector('#tb-export-geojson-btn', { state: 'visible', timeout: 10000 });
    await page.click('#terrain-toolbox-close-btn');

    // ------------------------------------------------------------------
    // 4. Authoring Tab (#tab-authoring / hotkey 8) + Edit-Mode Banner
    // ------------------------------------------------------------------
    await page.click('#tab-btn-authoring');
    assert.equal(
      await page.locator('#tab-authoring').evaluate(el => el.classList.contains('active')),
      true,
      '#tab-btn-authoring must activate #tab-authoring',
    );
    await page.click('#btn-author-tab-tdma');
    assert.equal(await page.locator('#authoring-pane-tdma').evaluate(el => el.classList.contains('active')), true, 'TDMA pane must activate');
    await page.click('#btn-author-tab-obs');
    assert.equal(await page.locator('#authoring-pane-obs').evaluate(el => el.classList.contains('active')), true, '3D Obstacles pane must activate');

    // Milestone 4: Two-step confirmation on #obstacle-delete (canvas click disarm + 2nd-click execute)
    const obsCountBefore = await page.locator('#obstacle-list button').count();
    await page.click('#obstacle-add');
    const obsCountAdded = await page.locator('#obstacle-list button').count();
    assert.equal(obsCountAdded, obsCountBefore + 1, 'Adding draft obstacle must increase list count by 1');
    await page.click('#obstacle-delete');
    assert.equal(await page.getAttribute('#obstacle-delete', 'data-confirm-armed'), 'true', '1st click on #obstacle-delete must arm');
    await page.locator('#radar-canvas').click({ position: { x: 240, y: 140 } });
    assert.equal(await page.getAttribute('#obstacle-delete', 'data-confirm-armed'), null, 'Canvas click must disarm #obstacle-delete');
    assert.equal(await page.locator('#obstacle-list button').count(), obsCountAdded, 'Disarmed #obstacle-delete must not remove obstacle');
    await page.click('#obstacle-delete');
    assert.equal(await page.getAttribute('#obstacle-delete', 'data-confirm-armed'), 'true');
    await page.click('#obstacle-delete');
    assert.equal(await page.locator('#obstacle-list button').count(), obsCountBefore, '2nd click on #obstacle-delete must remove selected draft obstacle');
    await page.click('#obstacle-cancel');
    assert.equal(await page.getAttribute('#radar-stage', 'data-edit-mode'), 'idle', 'Obstacle cancel must return data-edit-mode to idle');

    await page.click('#btn-author-tab-traj');
    assert.equal(await page.locator('#authoring-pane-traj').evaluate(el => el.classList.contains('active')), true, 'Flight Trajectory pane must activate');

    await page.selectOption('#trajectory-mode', 'waypoints');
    await page.waitForSelector('#trajectory-place-point', { state: 'visible' });
    await page.click('#trajectory-place-point');
    assert.equal(await page.getAttribute('#radar-stage', 'data-edit-mode'), 'active', 'Trajectory place point must set data-edit-mode="active"');
    assert.equal(await page.locator('#edit-mode-banner').isVisible(), true, '#edit-mode-banner must be visible in edit mode');
    await page.click('#trajectory-cancel');
    assert.equal(await page.getAttribute('#radar-stage', 'data-edit-mode'), 'idle', 'Cancel draft must clear data-edit-mode back to idle');
    assert.equal(await page.locator('#edit-mode-banner').isVisible(), false, '#edit-mode-banner must hide on cancelTrajectoryDraft');

    // Sequential Rail Hotkeys 6 (Authoring), 7 (Diag & Ref), 8 (Registration)
    await page.click('#tab-btn-overview');
    await page.locator('#tab-overview').click({ position: { x: 10, y: 10 } }).catch(() => {});
    await page.keyboard.press('6');
    assert.equal(
      await page.locator('#tab-authoring').evaluate(el => el.classList.contains('active')),
      true,
      'Keyboard hotkey 6 must switch to #tab-authoring',
    );
    await page.keyboard.press('7');
    assert.equal(
      await page.locator('#tab-doc').evaluate(el => el.classList.contains('active')),
      true,
      'Keyboard hotkey 7 must switch to #tab-doc',
    );
    await page.keyboard.press('8');
    assert.equal(
      await page.locator('#tab-registration').evaluate(el => el.classList.contains('active')),
      true,
      'Keyboard hotkey 8 must switch to #tab-registration',
    );
    await page.click('#tab-btn-overview');

    // ------------------------------------------------------------------
    // 5. Timeline resize & collapse persistence across reload
    // ------------------------------------------------------------------
    const timelineBefore = await page.locator('#sim-timeline-panel').boundingBox();
    const handleBox = await page.locator('#sim-timeline-resize-handle').boundingBox();
    assert.ok(timelineBefore && handleBox, 'Timeline panel and resize handle must be visible');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 64, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const timelineResized = await page.locator('#sim-timeline-panel').boundingBox();
    assert.ok(timelineResized && timelineResized.height > timelineBefore.height + 20, `Expected timeline height to increase from ${timelineBefore.height}, got ${timelineResized?.height}`);
    const savedHeight = await page.evaluate(() => localStorage.getItem('xband-timeline-height-v1'));
    assert.ok(Number(savedHeight) > 160 && Number(savedHeight) <= 320, `Expected persisted timeline height in (160, 320], got ${savedHeight}`);

    await page.click('#timeline-btn-collapse');
    await page.waitForTimeout(260);
    const collapsedBox = await page.locator('#sim-timeline-panel').boundingBox();
    assert.equal(await page.locator('#sim-timeline-panel').evaluate(el => el.classList.contains('is-collapsed')), true);
    assert.ok(collapsedBox && collapsedBox.height <= 40, `Expected ~34px collapsed timeline height, got ${collapsedBox?.height}`);
    assert.equal(await page.evaluate(() => localStorage.getItem('xband-timeline-collapsed-v1')), '1');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForTelemetryReady(page, runtimeErrors);
    const persistedCollapsed = await page.locator('#sim-timeline-panel').evaluate(el => el.classList.contains('is-collapsed'));
    const persistedHeightAfterReload = await page.evaluate(() => localStorage.getItem('xband-timeline-height-v1'));
    assert.equal(persistedCollapsed, true, 'Collapsed timeline state must persist across reload');
    assert.equal(persistedHeightAfterReload, savedHeight, 'Saved timeline height must persist across reload');

    // Expand back so state ends tidy, then pause before WebGL renderer transitions
    await page.click('#timeline-btn-collapse');
    await page.waitForTimeout(250);
    await page.click('#btn-pause');
    await page.waitForFunction(() => document.getElementById('btn-pause')?.textContent?.trim() === 'RESUME');

    // ------------------------------------------------------------------
    // 6. Renderer parity (MapLibre & 3D Terrain)
    // ------------------------------------------------------------------
    await page.click('#btnMapLibre');
    await page.waitForFunction(() => document.getElementById('radar-stage')?.getAttribute('data-map-renderer') === 'maplibre');
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#tb-backdrop-mode').isDisabled(), true, 'Backdrop selector must be disabled in MapLibre mode');
    await page.click('#btnMapRadar');
    await page.waitForFunction(() => document.getElementById('radar-stage')?.getAttribute('data-map-renderer') === 'radar');

    await page.locator('#radar-container').scrollIntoViewIfNeeded();
    await page.locator('#btnView3D').click({ force: true, noWaitAfter: true });
    await page.waitForFunction(() => {
      const stage = document.getElementById('radar-stage');
      const hud = document.querySelector('.three-hud-overlay');
      if (!stage || !hud || stage.getAttribute('data-map-renderer') !== '3d') return false;
      const r = hud.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(hud).visibility === 'visible';
    }, null, { timeout: 30000 });
    const stageRect = await page.locator('#radar-container').boundingBox();
    const threeHudRect = await page.locator('.three-hud-overlay').boundingBox();
    assert.ok(
      threeHudRect && stageRect && threeHudRect.x >= stageRect.x + 48,
      `.three-hud-overlay (${threeHudRect?.x}) must clear 36px left rail inside #radar-container (${stageRect?.x})`,
    );

    // Resume briefly in 2D Radar to confirm live loop continues cleanly with zero errors
    await page.locator('#btnView2D').click({ force: true, noWaitAfter: true });
    await page.waitForFunction(() => document.getElementById('radar-stage')?.getAttribute('data-map-renderer') === 'radar', null, { timeout: 15000 });
    await page.click('#btn-pause');
    await page.waitForTimeout(300);

    assert.deepEqual(runtimeErrors, [], `Uncaught runtime/console errors on ${label}:\n${runtimeErrors.join('\n')}`);
    console.log(`[verify:browser] PASS ${label} (${viewport.width}x${viewport.height})`);
  } finally {
    await context.close();
  }
}

async function main() {
  const server = await startViteServer();
  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--disable-dev-shm-usage',
      ],
    });
    await verifyViewport(browser, server.url, { width: 1440, height: 900 }, 'Desktop');
    await verifyViewport(browser, server.url, { width: 1366, height: 768 }, 'Standard Laptop');
    await verifyViewport(browser, server.url, { width: 1024, height: 768 }, 'Constrained Laptop');
    await verifyViewport(browser, server.url, { width: 780, height: 840 }, 'Mobile Split');
    console.log('\n[verify:browser] ALL BROWSER UX CHECKS PASSED (1440x900 + 1366x768 + 1024x768 + 780x840).');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await server.stop();
  }
}

main().catch(err => {
  console.error('\n[verify:browser] FAIL:', err);
  process.exit(1);
});
