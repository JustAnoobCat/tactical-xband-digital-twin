/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Verification Suite 130 (TAURI-01): Cross-Platform Offline Tauri v2 Desktop Shell
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MapController } from '../ui/mapController';
import { SimulationWorkerManager } from '../worker/simWorker';
import {
  WorldTileLayer,
  getAirGapOfflineOnly,
  isAirGapDefaultEnvironment,
} from '../ui/worldTileLayer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '../..');

let passedChecks = 0;

function check(label: string, fn: () => void): void {
  fn();
  passedChecks++;
  console.log(`  ✓ ${label}`);
}

console.log('='.repeat(92));
console.log('  TAURI-01 VERIFICATION SUITE 130: OFFLINE TAURI V2 DESKTOP SHELL');
console.log('='.repeat(92));

// -----------------------------------------------------------------------------
// 1. Tauri v2 Manifest, Strict Air-Gap CSP, Capabilities & Cargo Configuration
// -----------------------------------------------------------------------------
console.log('\n[1/4] Verifying Tauri v2 Configuration, Strict Air-Gap CSP & Capabilities...');

check('src-tauri/tauri.conf.json sets frontendDist="../dist" and strict air-gapped CSP', () => {
  const confPath = resolve(ROOT_DIR, 'src-tauri/tauri.conf.json');
  assert.equal(existsSync(confPath), true, 'src-tauri/tauri.conf.json must exist');
  const conf = JSON.parse(readFileSync(confPath, 'utf8'));

  assert.equal(conf.build?.frontendDist, '../dist', 'frontendDist must point to ../dist');
  assert.equal(conf.bundle?.active, true, 'bundle.active must be true');

  const mainWin = conf.app?.windows?.[0];
  assert.equal(mainWin?.width, 1280, 'Main Tauri window width must be 1280 for laptop screens');
  assert.equal(mainWin?.height, 760, 'Main Tauri window height must be 760 for laptop screens');
  assert.equal(mainWin?.minWidth, 960, 'Main Tauri window minWidth must be 960');
  assert.equal(mainWin?.minHeight, 600, 'Main Tauri window minHeight must be 600');
  assert.equal(mainWin?.center, true, 'Main Tauri window must open centered');

  const csp: string = conf.app?.security?.csp;
  assert.equal(typeof csp, 'string', 'app.security.csp must be configured');
  assert.ok(csp.length > 0, 'app.security.csp must be non-empty');

  const directives = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      directives.set(tokens[0].toLowerCase(), tokens.slice(1));
    }
  }

  const scriptSrc = directives.get('script-src') ?? [];
  assert.ok(scriptSrc.includes("'self'"), "script-src must include 'self'");
  assert.equal(
    scriptSrc.includes("'unsafe-inline'"),
    false,
    "script-src must NOT contain 'unsafe-inline'"
  );
  assert.equal(
    directives.get('object-src')?.includes("'none'"),
    true,
    "object-src must be 'none'"
  );
  assert.equal(
    directives.get('frame-ancestors')?.includes("'none'"),
    true,
    "frame-ancestors must be 'none'"
  );
  assert.equal(
    directives.get('base-uri')?.includes("'self'"),
    true,
    "base-uri must be 'self'"
  );
  assert.equal(
    directives.get('style-src-attr')?.includes("'unsafe-inline'"),
    true,
    "style-src-attr must include 'unsafe-inline' so Tauri style nonces do not block inline style attributes"
  );

  // Zero external http:// or https:// origins anywhere in CSP (only local Tauri scheme hosts allowed)
  const httpMatches = csp.match(/https?:\/\/[^\s;]+/gi) ?? [];
  for (const origin of httpMatches) {
    assert.ok(
      /^https?:\/\/(tauri\.localhost|xband-tile\.localhost)$/i.test(origin),
      `External HTTP/HTTPS origin forbidden in air-gapped CSP: ${origin}`
    );
  }

  const icons: string[] = conf.bundle?.icon ?? [];
  assert.ok(icons.length >= 1, 'bundle.icon must declare at least one icon');
  for (const relIcon of icons) {
    const iconPath = resolve(ROOT_DIR, 'src-tauri', relIcon);
    assert.equal(existsSync(iconPath), true, `Icon file must exist: ${relIcon}`);
    if (relIcon.endsWith('.png')) {
      const header = readFileSync(iconPath).subarray(0, 8);
      assert.deepEqual(
        Array.from(header),
        [137, 80, 78, 71, 13, 10, 26, 10],
        `Icon ${relIcon} must have valid PNG signature`
      );
    }
  }
});

check('src-tauri/capabilities/default.json uses least-privilege permissions & Cargo.toml targets Tauri v2', () => {
  const capPath = resolve(ROOT_DIR, 'src-tauri/capabilities/default.json');
  assert.equal(existsSync(capPath), true, 'capabilities/default.json must exist');
  const cap = JSON.parse(readFileSync(capPath, 'utf8'));
  assert.deepEqual(cap.permissions, ['core:default'], 'Capabilities must only grant core:default');

  const cargoPath = resolve(ROOT_DIR, 'src-tauri/Cargo.toml');
  assert.equal(existsSync(cargoPath), true, 'src-tauri/Cargo.toml must exist');
  const cargoToml = readFileSync(cargoPath, 'utf8');
  assert.match(cargoToml, /edition\s*=\s*"2021"/, 'Cargo.toml must use edition 2021');
  assert.match(cargoToml, /tauri\s*=.*version\s*=\s*"2"|tauri\s*=\s*"2"/, 'Cargo.toml must target Tauri v2');
  assert.match(cargoToml, /tauri-build\s*=.*version\s*=\s*"2"|tauri-build\s*=\s*"2"/, 'Cargo.toml must target tauri-build v2');

  const libRs = readFileSync(resolve(ROOT_DIR, 'src-tauri/src/lib.rs'), 'utf8');
  assert.ok(libRs.includes('register_uri_scheme_protocol("xband-tile"'), 'lib.rs must register xband-tile scheme');
  assert.ok(libRs.includes('get_runtime_diagnostics'), 'lib.rs must expose get_runtime_diagnostics');
  assert.ok(libRs.includes('get_tiles_directory'), 'lib.rs must expose get_tiles_directory');

  const tileRs = readFileSync(resolve(ROOT_DIR, 'src-tauri/src/tile_protocol.rs'), 'utf8');
  assert.ok(tileRs.includes('canonicalize'), 'tile_protocol.rs must verify canonicalize symlink containment');
  assert.ok(tileRs.includes('PARTIAL_CONTENT'), 'tile_protocol.rs must return 206 Partial Content for ranges');
});

// -----------------------------------------------------------------------------
// 2. Frontend Tauri Runtime Air-Gap Detection
// -----------------------------------------------------------------------------
console.log('\n[2/4] Verifying WorldTileLayer Tauri v2 Air-Gap Lock...');

check('WorldTileLayer auto-enables Air-Gap offline mode when window.__TAURI_INTERNALS__ is present', () => {
  const origWinDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: { userAgent: 'Mozilla/5.0', onLine: true },
    });

    assert.equal(isAirGapDefaultEnvironment(), true, '__TAURI_INTERNALS__ must trigger default Air-Gap');
    assert.equal(getAirGapOfflineOnly(), true, 'getAirGapOfflineOnly() must return true under Tauri');

    const layer = new WorldTileLayer();
    assert.equal(layer.isAirGapOfflineOnly(), true, 'WorldTileLayer must default to airGapOfflineOnly=true');
    assert.equal(layer.isExternalTilesAllowed(), false, 'External HTTP tiles must be blocked under Tauri');
  } finally {
    if (origWinDesc) {
      Object.defineProperty(globalThis, 'window', origWinDesc);
    } else {
      delete (globalThis as Record<string, unknown>).window;
    }
    if (origNavDesc) {
      Object.defineProperty(globalThis, 'navigator', origNavDesc);
    } else {
      delete (globalThis as Record<string, unknown>).navigator;
    }
  }
});

// -----------------------------------------------------------------------------
// 3. MapController.setOrigin() Arbitrary-Latitude Longitude Scaling (PERF-01 Cleanup)
// -----------------------------------------------------------------------------
console.log('\n[3/4] Verifying MapController.setOrigin() Exact cos(lat) Longitude Scaling...');

check('MapController.setOrigin(0, 0) vs setOrigin(60, 0) yields exact ~2x cos(lat) longitude scaling', () => {
  const mc = new MapController(undefined, 'alpine_mountain');
  const testMetersEast = 111320.0;

  mc.setOrigin(0, 0);
  const eq = mc.projectEnuToGeodetic(testMetersEast, 0);
  assert.ok(
    Math.abs(eq.latDeg - 0) < 1e-9,
    `Equator origin latDeg expected 0, got ${eq.latDeg}`
  );
  assert.ok(
    Math.abs(eq.lonDeg - 1.0) < 1e-6,
    `At equator (0 deg lat), 111320 m east must equal 1.0 deg lon (got ${eq.lonDeg})`
  );

  mc.setOrigin(60, 0);
  const highLat = mc.projectEnuToGeodetic(testMetersEast, 0);
  assert.ok(
    Math.abs(highLat.latDeg - 60) < 1e-9,
    `60N origin latDeg expected 60, got ${highLat.latDeg}`
  );
  assert.ok(
    Math.abs(highLat.lonDeg - 2.0) < 1e-6,
    `At 60 deg lat, 111320 m east must equal 2.0 deg lon (got ${highLat.lonDeg})`
  );

  const ratio = highLat.lonDeg / eq.lonDeg;
  assert.ok(
    Math.abs(ratio - 2.0) < 1e-6,
    `Longitude deg/m ratio between 60N and 0N must be ~2.0 (no leaked Ladakh halfWidthM), got ${ratio}`
  );
});

// -----------------------------------------------------------------------------
// 4. Service Worker Registration Skip Under Tauri Origins
// -----------------------------------------------------------------------------
console.log('\n[4/4] Verifying src/main.ts Skips Service Worker Registration Under Tauri...');

check('src/main.ts guards serviceWorker.register against __TAURI_INTERNALS__, tauri: protocol, and tauri.localhost', () => {
  const mainTs = readFileSync(resolve(ROOT_DIR, 'src/main.ts'), 'utf8');
  const swBlockMatch = mainTs.match(/const isTauriRuntime\s*=[\s\S]{0,1200}serviceWorker\.register/);
  assert.ok(swBlockMatch, 'src/main.ts must guard serviceWorker.register with isTauriRuntime');
  const block = swBlockMatch[0];
  assert.ok(block.includes('__TAURI_INTERNALS__'), 'Guard must check __TAURI_INTERNALS__');
  assert.ok(block.includes("protocol === 'tauri:'"), "Guard must check protocol === 'tauri:'");
  assert.ok(block.includes('tauri.localhost'), 'Guard must check tauri.localhost hostname');
});

// -----------------------------------------------------------------------------
// 5. Desktop Boot Regression: Ground Terminals > 0, Dark Theme, Hidden Overlays, No Clip
// -----------------------------------------------------------------------------
console.log('\n[5/5] Verifying Tauri Desktop Boot Invariants (Terminals, CSP Hidden Overlays, Dark Select, Laptop Layout)...');

check('SimulationWorkerManager defaults to 16_NODES (>0 ground terminals) while preserving explicit ACN_ONLY', () => {
  const defaultMgr = new SimulationWorkerManager(0);
  assert.equal(defaultMgr.currentScenarioPreset, '16_NODES');
  assert.ok(defaultMgr.nodeRegistry.size > 0, 'Default worker boot must populate >0 ground terminals');

  const acnOnlyMgr = new SimulationWorkerManager(0, 'ACN_ONLY');
  assert.equal(acnOnlyMgr.currentScenarioPreset, 'ACN_ONLY');
  assert.equal(acnOnlyMgr.nodeRegistry.size, 0, 'Explicit ACN_ONLY mode must still start with 0 ground terminals');
});

check('c2-console-theme.css enforces color-scheme: dark, explicit [hidden] rules without !important, and @media (max-width: 1380px)', () => {
  const css = readFileSync(resolve(ROOT_DIR, 'frontend/c2-console-theme.css'), 'utf8');
  const rulesOnly = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/!important/.test(rulesOnly), false, 'c2-console-theme.css must contain zero !important');
  assert.ok(rulesOnly.includes('color-scheme: dark;'), 'c2-console-theme.css must set color-scheme: dark');
  assert.ok(rulesOnly.includes('#terrain-toolbox[hidden]') && rulesOnly.includes('.map-active-tool-bar[hidden]'), 'CSS must explicitly hide [hidden] toolbox & tool-bar elements');
  assert.ok(rulesOnly.includes('@media (max-width: 1380px)'), 'CSS must include responsive @media (max-width: 1380px) layout rules');
});

async function runBrowserTauriBootCheck(): Promise<void> {
  const distDir = resolve(ROOT_DIR, 'dist');
  const distIndex = resolve(distDir, 'index.html');
  if (!existsSync(distIndex)) {
    console.log('  - Skipping live Chromium Tauri CSP boot check (dist/index.html not built yet)');
    return;
  }

  const { chromium } = await import('playwright');
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.wasm': 'application/wasm',
    '.bin': 'application/octet-stream',
    '.woff2': 'font/woff2',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };

  const tauriConf = JSON.parse(readFileSync(resolve(ROOT_DIR, 'src-tauri/tauri.conf.json'), 'utf8'));
  const rawCsp: string = tauriConf.app.security.csp;
  const nonce = 'verify123456';
  const tauriCsp = rawCsp.replace(/style-src\s+([^;]+)/, `style-src $1 'nonce-${nonce}'`);

  const server = http.createServer((req, res) => {
    const reqPath = (req.url || '/').split('?')[0];
    const relPath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
    const filePath = resolve(distDir, relPath);
    if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = extname(filePath);
    if (relPath === 'index.html') {
      const html = readFileSync(filePath, 'utf8').replace(/<style>/g, `<style nonce="${nonce}">`);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': tauriCsp,
      });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(readFileSync(filePath));
  });

  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', () => resolveListen()));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string', 'Ephemeral server must bind');
  const baseUrl = `http://127.0.0.1:${addr.port}/`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await page.addInitScript(
      'window.__TAURI_INTERNALS__ = { invoke: function() { return Promise.resolve(null); } };'
    );

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      () => {
        const placeholder = document.querySelector('#terminal-inventory-tbody tr td[colspan]');
        const rows = document.querySelectorAll('#terminal-inventory-tbody tr');
        const t = document.getElementById('timeline-time-display')?.textContent || '00.00s';
        return !placeholder && rows.length > 0 && t !== '00.00s';
      },
      null,
      { timeout: 15000 }
    );

    const bootState = await page.evaluate(() => {
      const elTb = document.getElementById('terrain-toolbox');
      const elBar = document.getElementById('map-active-tool-bar');
      const el3d = document.getElementById('three-stage-container');
      const elMesh = document.getElementById('mesh-res-toggle');
      const elPick = document.getElementById('tb-picking-bar');
      const topbar = document.querySelector('.topbar');
      const dv = document.querySelector('.detail-viewport')?.getBoundingClientRect();
      const cmd = document.getElementById('btn-command-palette')?.getBoundingClientRect();
      const outage = document.getElementById('tally-outage')?.closest('.health-chip')?.getBoundingClientRect();
      const modeBtn = document.getElementById('scheduler-quick-toggle')?.getBoundingClientRect();
      const demSel = document.getElementById('dem-sector-select');
      const totalTallies =
        Number(document.getElementById('tally-connected')?.textContent || 0) +
        Number(document.getElementById('tally-degraded')?.textContent || 0) +
        Number(document.getElementById('tally-blocked')?.textContent || 0) +
        Number(document.getElementById('tally-outage')?.textContent || 0);

      return {
        rowCount: document.querySelectorAll('#terminal-inventory-tbody tr').length,
        totalTallies,
        rootColorScheme: getComputedStyle(document.documentElement).colorScheme,
        demColorScheme: demSel ? getComputedStyle(demSel).colorScheme : null,
        terrainToolbox: elTb ? { display: getComputedStyle(elTb).display, hidden: elTb.hidden } : null,
        mapActiveToolBar: elBar ? { display: getComputedStyle(elBar).display, hidden: elBar.hidden } : null,
        threeStage: el3d ? { display: getComputedStyle(el3d).display, hidden: el3d.hidden } : null,
        meshResToggle: elMesh ? { display: getComputedStyle(elMesh).display, hidden: elMesh.hidden } : null,
        tbPickingBar: elPick ? { display: getComputedStyle(elPick).display, hidden: elPick.hidden } : null,
        topbarOverflow: (topbar?.scrollWidth ?? 0) > (topbar?.clientWidth ?? 0),
        cmdRightOk: (cmd?.right ?? 9999) <= (topbar?.getBoundingClientRect().right ?? 0) + 1,
        outageRightOk: (outage?.right ?? 9999) <= (dv?.right ?? 0) + 1,
        modeRightOk: (modeBtn?.right ?? 9999) <= (dv?.right ?? 0) + 1,
      };
    });

    assert.deepEqual(errors, [], `Expected 0 uncaught/CSP errors under Tauri boot, got: ${errors.join('; ')}`);
    assert.ok(bootState.rowCount > 0, `Expected >0 ground terminals on boot, got ${bootState.rowCount}`);
    assert.ok(bootState.totalTallies > 0, `Expected >0 total terminal tallies on boot, got ${bootState.totalTallies}`);
    assert.equal(bootState.rootColorScheme, 'dark', ':root color-scheme must be dark');
    assert.equal(bootState.demColorScheme, 'dark', '#dem-sector-select color-scheme must be dark');
    assert.equal(bootState.terrainToolbox?.display, 'none', '#terrain-toolbox must be hidden on 2D boot');
    assert.equal(bootState.mapActiveToolBar?.display, 'none', '#map-active-tool-bar must be hidden on 2D boot');
    assert.equal(bootState.threeStage?.display, 'none', '#three-stage-container (Fresnel/Lobes/Volumes) must be hidden on 2D boot');
    assert.equal(bootState.meshResToggle?.display, 'none', '#mesh-res-toggle (Mesh 512|256) must be hidden on 2D boot');
    assert.equal(bootState.tbPickingBar?.display, 'none', '#tb-picking-bar must be hidden on 2D boot');
    assert.equal(bootState.topbarOverflow, false, '.topbar must not overflow horizontally at 1280x760');
    assert.equal(bootState.cmdRightOk, true, 'Search Ctrl+K must not clip at 1280x760');
    assert.equal(bootState.outageRightOk, true, 'Outage chip must not clip at 1280x760');
    assert.equal(bootState.modeRightOk, true, 'Mode: Tac-TAD must not clip at 1280x760');

    passedChecks++;
    console.log('  ✓ Live Chromium Tauri CSP boot verified (>0 terminals, 0 errors, hidden 3D/toolbox overlays, dark theme, zero clipping)');
  } finally {
    await browser.close();
    server.close();
  }
}

runBrowserTauriBootCheck()
  .then(() => {
    console.log('\n' + '='.repeat(92));
    console.log(`  TAURI-01 SUMMARY: ${passedChecks}/${passedChecks} checks passed, 0 failures.`);
    console.log('='.repeat(92) + '\n');
  })
  .catch((err) => {
    console.error('TAURI-01 verification failed:', err);
    process.exit(1);
  });
