/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Verification Suite 130 (TAURI-01): Cross-Platform Offline Tauri v2 Desktop Shell
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MapController } from '../ui/mapController';
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

console.log('\n' + '='.repeat(92));
console.log(`  TAURI-01 SUMMARY: ${passedChecks}/5 checks passed, 0 failures.`);
console.log('='.repeat(92) + '\n');
