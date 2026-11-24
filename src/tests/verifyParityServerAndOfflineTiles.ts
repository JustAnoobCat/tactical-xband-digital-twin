/**
 * Verification Suite 113: Canonical Node/TS Parity Server & Offline Air-Gap Tile Protocol (SPEC-V3-11)
 *
 * Verifies:
 * - [PSO-T1] Offline Tile URL Traversal Defense & PMTiles v3 Binary Parser
 * - [PSO-T2] Live Canonical Node/TS Parity Server End-to-End HTTP Tests
 * - [PSO-T3] Electron Hardening & Final Extraction Gate
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';
import {
  parseOfflineTileRequestUrl,
  parsePmTilesV3Header,
  PMTILES_V3_CONSTANTS,
  PMTILES_V3_COMPRESSION_MAP,
  PMTILES_V3_TILE_TYPE_MAP,
} from '../core/offlineTileProtocol';
import { createTsParityServer } from '../../server/ts_parity_server';

console.log('='.repeat(96));
console.log('  TACTICAL DIGITAL TWIN — VERIFICATION SUITE 113 (SPEC-V3-11)');
console.log('  Canonical Node/TS Parity Server & Offline Air-Gap Tile Protocol');
console.log('='.repeat(96));

let passedChecks = 0;
async function runCheck(label: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    passedChecks++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${label}`);
    throw err;
  }
}

// Helper to make HTTP requests in tests
function httpRequest(options: http.RequestOptions, body?: string | Buffer): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((res, rej) => {
    const req = http.request(options, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        res({
          statusCode: response.statusCode || 0,
          headers: response.headers,
          body: data,
        });
      });
    });
    req.on('error', rej);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function runAllTests() {
  // ============================================================================
  // [PSO-T1] Offline Tile URL Traversal Defense & PMTiles v3 Binary Parser
  // ============================================================================
  console.log('\n[PSO-T1] Offline Tile URL Traversal Defense & PMTiles v3 Binary Parser...');

  await runCheck('parseOfflineTileRequestUrl accepts valid tile URLs with allowed extensions', () => {
    const validRaster = parseOfflineTileRequestUrl('xband-tile://terrain/10/732/412.png');
    assert.equal(validRaster.ok, true);
    if (validRaster.ok) {
      assert.equal(validRaster.tileset, 'terrain');
      assert.equal(validRaster.z, 10);
      assert.equal(validRaster.x, 732);
      assert.equal(validRaster.y, 412);
      assert.equal(validRaster.ext, 'png');
      assert.equal(validRaster.relativePath, 'terrain/10/732/412.png');
    }

    const validVector = parseOfflineTileRequestUrl('xband-tile://topo/14/11712/6592.pbf');
    assert.equal(validVector.ok, true);
    if (validVector.ok) {
      assert.equal(validVector.tileset, 'topo');
      assert.equal(validVector.z, 14);
      assert.equal(validVector.x, 11712);
      assert.equal(validVector.y, 6592);
      assert.equal(validVector.ext, 'pbf');
    }

    const validMvt = parseOfflineTileRequestUrl('xband-tile:///satellite/0/0/0.mvt');
    assert.equal(validMvt.ok, true);
    if (validMvt.ok) {
      assert.equal(validMvt.tileset, 'satellite');
      assert.equal(validMvt.z, 0);
      assert.equal(validMvt.x, 0);
      assert.equal(validMvt.y, 0);
      assert.equal(validMvt.ext, 'mvt');
    }

    const validWebp = parseOfflineTileRequestUrl('xband-tile://ladakh-ortho/12/2928/1648.webp');
    assert.equal(validWebp.ok, true);
    if (validWebp.ok) {
      assert.equal(validWebp.ext, 'webp');
    }
  });

  await runCheck('parseOfflineTileRequestUrl strictly rejects traversal attempts and backslashes', () => {
    // Parent traversal with ..
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/../../etc/passwd').ok, false);
    // URL encoded traversal
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/%2e%2e/etc/passwd').ok, false);
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/..%2f..%2fetc/passwd').ok, false);
    // Dot segment
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10/%2e/412.png').ok, false);
    // Backslash
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10\\732\\412.png').ok, false);
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10%5c732/412.png').ok, false);
    // Null byte
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10/%00732/412.png').ok, false);
    // Invalid scheme
    assert.equal(parseOfflineTileRequestUrl('http://terrain/10/732/412.png').ok, false);
    assert.equal(parseOfflineTileRequestUrl('file:///terrain/10/732/412.png').ok, false);
    assert.equal(parseOfflineTileRequestUrl('https://terrain/10/732/412.png').ok, false);
  });

  await runCheck('parseOfflineTileRequestUrl validates tile coordinates and extensions strictly', () => {
    // Zoom > 22
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/23/0/0.png').ok, false);
    // Negative coordinates
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/-1/0/0.png').ok, false);
    // Out-of-bounds coordinates (for zoom 2, max coordinate is 3)
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/2/4/0.png').ok, false);
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/2/0/4.png').ok, false);
    // Valid boundary coordinate (for zoom 2, coordinate 3 is valid)
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/2/3/3.png').ok, true);
    // Non-integer coordinates
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10.5/732/412.png').ok, false);
    // Disallowed extensions
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10/732/412.exe').ok, false);
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10/732/412.html').ok, false);
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10/732/412.js').ok, false);
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10/732/412.sh').ok, false);
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10/732/412').ok, false);
    // Extra or missing path segments
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10/732/412/extra.png').ok, false);
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10/732.png').ok, false);
    // Query parameters and URL hashes are forbidden
    assert.equal(parseOfflineTileRequestUrl('xband-tile://map/10/1/1.png?x=1').ok, false);
    assert.equal(parseOfflineTileRequestUrl('xband-tile://map/10/1/1.png#frag').ok, false);
  });

  await runCheck('parsePmTilesV3Header parses valid 127-byte PMTiles v3 binary header', () => {
    const buffer = new ArrayBuffer(PMTILES_V3_CONSTANTS.HEADER_SIZE_BYTES);
    const view = new DataView(buffer);

    // Magic: "PMTiles"
    const magic = 'PMTiles';
    for (let i = 0; i < magic.length; i++) {
      view.setUint8(i, magic.charCodeAt(i));
    }
    // Spec version: 3
    view.setUint8(7, 3);
    // Offsets and lengths (BigUint64 Little-Endian)
    view.setBigUint64(8, 127n, true);    // root_dir_offset
    view.setBigUint64(16, 512n, true);   // root_dir_length
    view.setBigUint64(24, 639n, true);   // json_metadata_offset
    view.setBigUint64(32, 1024n, true);  // json_metadata_length
    view.setBigUint64(40, 0n, true);     // leaf_dirs_offset
    view.setBigUint64(48, 0n, true);     // leaf_dirs_length
    view.setBigUint64(56, 1663n, true);  // tile_data_offset
    view.setBigUint64(64, 32768n, true); // tile_data_length
    view.setBigUint64(72, 200n, true);   // num_addressed_tiles
    view.setBigUint64(80, 150n, true);   // num_tile_entries
    view.setBigUint64(88, 150n, true);   // num_tile_contents

    // Flags and enums
    view.setUint8(96, 1); // clustered
    view.setUint8(97, 2); // internal_compression (gzip)
    view.setUint8(98, 4); // tile_compression (zstd)
    view.setUint8(99, 1); // tile_type (mvt)
    view.setUint8(100, 4); // min_zoom
    view.setUint8(101, 16); // max_zoom

    // Bounds scaled by 1e7
    view.setInt32(102, 765000000, true); // min_lon = 76.5
    view.setInt32(106, 345000000, true); // min_lat = 34.5
    view.setInt32(110, 775000000, true); // max_lon = 77.5
    view.setInt32(114, 355000000, true); // max_lat = 35.5

    // Center
    view.setUint8(118, 12); // center_zoom
    view.setInt32(119, 770000000, true); // center_lon = 77.0
    view.setInt32(123, 350000000, true); // center_lat = 35.0

    const parsed = parsePmTilesV3Header(buffer);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      const h = parsed.header;
      assert.equal(h.specVersion, 3);
      assert.equal(h.rootDirectoryOffset, 127);
      assert.equal(h.rootDirectoryLength, 512);
      assert.equal(h.jsonMetadataOffset, 639);
      assert.equal(h.jsonMetadataLength, 1024);
      assert.equal(h.tileDataOffset, 1663);
      assert.equal(h.tileDataLength, 32768);
      assert.equal(h.addressedTilesCount, 200);
      assert.equal(h.tileEntriesCount, 150);
      assert.equal(h.tileContentsCount, 150);
      assert.equal(h.clustered, true);
      assert.equal(h.internalCompression, 'gzip');
      assert.equal(h.tileCompression, 'zstd');
      assert.equal(h.tileType, 'mvt');
      assert.equal(h.minZoom, 4);
      assert.equal(h.maxZoom, 16);
      assert.ok(Math.abs(h.minLonDeg - 76.5) < 1e-6);
      assert.ok(Math.abs(h.minLatDeg - 34.5) < 1e-6);
      assert.ok(Math.abs(h.maxLonDeg - 77.5) < 1e-6);
      assert.ok(Math.abs(h.maxLatDeg - 35.5) < 1e-6);
      assert.equal(h.centerZoom, 12);
      assert.ok(Math.abs(h.centerLonDeg - 77.0) < 1e-6);
      assert.ok(Math.abs(h.centerLatDeg - 35.0) < 1e-6);
    }
  });

  await runCheck('parsePmTilesV3Header returns error on truncated or corrupted headers without throwing', () => {
    // Truncated buffer (< 127 bytes)
    const truncated = new ArrayBuffer(64);
    const resTruncated = parsePmTilesV3Header(truncated);
    assert.equal(resTruncated.ok, false);

    // Corrupted magic bytes
    const corruptMagic = new ArrayBuffer(127);
    new Uint8Array(corruptMagic).set([0, 1, 2, 3, 4, 5, 6, 7]);
    const resMagic = parsePmTilesV3Header(corruptMagic);
    assert.equal(resMagic.ok, false);

    // Bad spec version (e.g. version 2)
    const badVersion = new ArrayBuffer(127);
    const magic = 'PMTiles';
    for (let i = 0; i < magic.length; i++) {
      new DataView(badVersion).setUint8(i, magic.charCodeAt(i));
    }
    new DataView(badVersion).setUint8(7, 2);
    const resVersion = parsePmTilesV3Header(badVersion);
    assert.equal(resVersion.ok, false);
  });

  // ============================================================================
  // [PSO-T2] Live Canonical Node/TS Parity Server End-to-End HTTP Tests
  // ============================================================================
  console.log('\n[PSO-T2] Live Canonical Node/TS Parity Server End-to-End HTTP Tests...');

  const TEST_TOKEN = 'drdo-xband-verification-token';
  const serverInstance = createTsParityServer({
    host: '127.0.0.1',
    port: 0,
    apiToken: TEST_TOKEN,
  });

  await serverInstance.start();
  const address = serverInstance.getAddress();
  const serverPort = typeof address === 'object' && address ? address.port : 8001;

  try {
    await runCheck('GET /api/capabilities returns full canonical parity metadata', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/capabilities',
        method: 'GET',
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-type'], 'application/json');
      const data = JSON.parse(res.body);
      assert.equal(data.engine, 'canonical-typescript-node-server');
      assert.equal(data.parity_status, 'full-canonical-parity');
      assert.equal(data.canonical_runtime, 'typescript-simulation-worker-manager');
      assert.ok(Array.isArray(data.features));
      assert.ok(data.features.includes('dvb-s2x-modcod'));
      assert.ok(data.features.includes('50hz-discrete-event-loop'));
      assert.ok(data.features.includes('multi-biome-rf-physics'));
    });

    await runCheck('GET /api/health returns valid health and initial frame status', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/health',
        method: 'GET',
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.status, 'ok');
      assert.equal(typeof data.frame_index, 'number');
      assert.equal(typeof data.sim_time_s, 'number');
      assert.equal(data.frame_index, 0);
    });

    await runCheck('Parity server enforces loopback-only CORS policies', async () => {
      // Loopback origin allowed
      const resAllowed = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/capabilities',
        method: 'GET',
        headers: { Origin: 'http://localhost:5173' },
      });
      assert.equal(resAllowed.statusCode, 200);
      assert.equal(resAllowed.headers['access-control-allow-origin'], 'http://localhost:5173');

      // Preflight OPTIONS on loopback origin
      const resOptions = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/telemetry',
        method: 'OPTIONS',
        headers: { Origin: 'http://127.0.0.1:3000' },
      });
      assert.equal(resOptions.statusCode, 204);
      assert.equal(resOptions.headers['access-control-allow-origin'], 'http://127.0.0.1:3000');

      // External / untrusted origin rejected
      const resBlocked = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/capabilities',
        method: 'GET',
        headers: { Origin: 'https://evil.attacker.example.com' },
      });
      assert.equal(resBlocked.statusCode, 200);
      // Must NOT reflect the evil origin
      assert.notEqual(resBlocked.headers['access-control-allow-origin'], 'https://evil.attacker.example.com');
    });

    await runCheck('POST endpoints require valid constant-time API token authentication', async () => {
      // Missing token
      const resMissing = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/tick',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, JSON.stringify({ steps: 1 }));
      assert.equal(resMissing.statusCode, 401);

      // Wrong token
      const resWrong = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/tick',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'wrong-token-value',
        },
      }, JSON.stringify({ steps: 1 }));
      assert.equal(resWrong.statusCode, 401);

      // Valid token via X-API-Key
      const resApiKey = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/tick',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_TOKEN,
        },
      }, JSON.stringify({ steps: 5 }));
      assert.equal(resApiKey.statusCode, 200);
      const dataApiKey = JSON.parse(resApiKey.body);
      assert.equal(dataApiKey.ok, true);
      assert.equal(dataApiKey.stepsExecuted, 5);
      assert.equal(dataApiKey.frame.frame_index, 5);

      // Valid token via Authorization: Bearer
      const resBearer = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/tick',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_TOKEN}`,
        },
      }, JSON.stringify({ steps: 3 }));
      assert.equal(resBearer.statusCode, 200);
      const dataBearer = JSON.parse(resBearer.body);
      assert.equal(dataBearer.ok, true);
      assert.equal(dataBearer.stepsExecuted, 3);
      assert.equal(dataBearer.frame.frame_index, 8);
    });

    await runCheck('GET /api/telemetry returns latest authoritative TelemetryFrame', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/telemetry',
        method: 'GET',
      });
      assert.equal(res.statusCode, 200);
      const frame = JSON.parse(res.body);
      assert.equal(frame.frame_index, 8);
      assert.ok(Array.isArray(frame.nodes_telemetry));
      assert.ok(frame.nodes_telemetry.length >= 3);
      assert.ok(frame.acn_telemetry !== null && typeof frame.acn_telemetry === 'object');
    });

    await runCheck('POST /api/tick validates payload steps and rejects out-of-range inputs', async () => {
      // Out of range (max is 100)
      const resMax = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/tick',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_TOKEN,
        },
      }, JSON.stringify({ steps: 101 }));
      assert.equal(resMax.statusCode, 400);

      // Negative or zero steps
      const resZero = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/tick',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_TOKEN,
        },
      }, JSON.stringify({ steps: 0 }));
      assert.equal(resZero.statusCode, 400);

      // Malformed JSON
      const resBadJson = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/tick',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_TOKEN,
        },
      }, '{not-json}');
      assert.equal(resBadJson.statusCode, 400);
    });

    await runCheck('POST /api/config applies configuration updates cleanly', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/config',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_TOKEN,
        },
      }, JSON.stringify({ params: { rain_rate_mm_hr: 15.0 } }));
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
    });

    await runCheck('POST /api/control executes simulation controls and resets deterministically', async () => {
      // Pause
      const resPause = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/control',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_TOKEN,
        },
      }, JSON.stringify({ action: 'pause' }));
      assert.equal(resPause.statusCode, 200);

      // Resume
      const resResume = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/control',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_TOKEN,
        },
      }, JSON.stringify({ action: 'resume' }));
      assert.equal(resResume.statusCode, 200);

      // Reset
      const resReset = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/control',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_TOKEN,
        },
      }, JSON.stringify({ action: 'reset' }));
      assert.equal(resReset.statusCode, 200);
      const dataReset = JSON.parse(resReset.body);
      assert.equal(dataReset.ok, true);
      assert.equal(dataReset.frame.frame_index, 0);

      // Unknown action
      const resUnknown = await httpRequest({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/control',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TEST_TOKEN,
        },
      }, JSON.stringify({ action: 'invalid_action_name' }));
      assert.equal(resUnknown.statusCode, 400);
    });
  } finally {
    await serverInstance.stop();
  }

  // ============================================================================
  // [PSO-T3] Electron Hardening & Final Extraction Gate
  // ============================================================================
  console.log('\n[PSO-T3] Electron Hardening & Final Extraction Gate...');

  await runCheck('electron/main.cjs maintains air-gap isolation and xband-tile protocol containment', () => {
    const electronMain = readFileSync(resolve('electron/main.cjs'), 'utf8');

    // WP-02 Zero-trust security invariants
    assert.ok(electronMain.includes('sandbox: true'), 'sandbox must be true');
    assert.ok(electronMain.includes('contextIsolation: true'), 'contextIsolation must be true');
    assert.ok(electronMain.includes('nodeIntegration: false'), 'nodeIntegration must be false');
    assert.ok(electronMain.includes('webSecurity: true'), 'webSecurity must be true');

    // Protocol registration and handling
    assert.ok(electronMain.includes("protocol.registerSchemesAsPrivileged"), 'Must register privileged schemes');
    assert.ok(
      electronMain.includes("protocol.handle('xband-tile'") ||
      electronMain.includes('protocol.handle("xband-tile"'),
      'Must handle xband-tile protocol'
    );
    assert.ok(
      electronMain.includes("normalizedTarget.startsWith(normalizedRoot)") ||
      electronMain.includes("resolved.startsWith(tilesRoot + path.sep)"),
      'Must enforce strict containment within tilesRoot'
    );

    // CSP policy includes xband-tile:
    assert.ok(electronMain.includes("xband-tile:"), 'CSP must include xband-tile:');
  });

  await runCheck('dashboardAndAuthoringController.ts is pure, stateless, and free of Math.random()', () => {
    const controllerSource = readFileSync(resolve('src/ui/controllers/dashboardAndAuthoringController.ts'), 'utf8');

    assert.ok(!/\bMath\.random\s*\(/.test(controllerSource), 'Controller must not call Math.random()');
    assert.ok(controllerSource.includes('export function createDashboardAndAuthoringController'), 'Must export factory function');
    assert.ok(controllerSource.includes('export const TDMA_PRESETS_UI'), 'Must export TDMA_PRESETS_UI');
  });

  await runCheck('index.html monolith extraction achieves >= 1,500 net line reduction with 0 duplicates and 0 emojis', () => {
    const html = readFileSync(resolve('index.html'), 'utf8');
    const lines = html.split('\n');

    // Line count reduction: Original was 19,752 lines. Net reduction must be >= 1,500 lines
    const originalMonolithLines = 19752;
    const currentLines = lines.length;
    const netLinesRemoved = originalMonolithLines - currentLines;
    console.log(`    Net lines removed from index.html: ${netLinesRemoved} (current: ${currentLines}, original: ${originalMonolithLines})`);
    assert.ok(
      netLinesRemoved >= 1500,
      `Expected >= 1500 net lines removed from index.html, but got ${netLinesRemoved}`
    );

    // Zero duplicate DOM IDs
    const idMatches = [...html.matchAll(/id=["']([^"']+)["']/g)].map(m => m[1]);
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of idMatches) {
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
    }
    assert.equal(duplicates.length, 0, `Found duplicate DOM IDs in index.html: ${duplicates.join(', ')}`);

    // Zero emojis
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    const emojiLines: number[] = [];
    lines.forEach((line, index) => {
      if (emojiRegex.test(line)) {
        emojiLines.push(index + 1);
      }
    });
    assert.equal(emojiLines.length, 0, `Found emoji characters at index.html lines: ${emojiLines.join(', ')}`);
  });

  console.log('\n' + '='.repeat(96));
  console.log(`  SUITE 113 SUMMARY: ${passedChecks} checks passed, 0 failures.`);
  console.log('='.repeat(96));
}

runAllTests().catch((err) => {
  console.error('\nSUITE 113 FAILED:', err);
  process.exit(1);
});
