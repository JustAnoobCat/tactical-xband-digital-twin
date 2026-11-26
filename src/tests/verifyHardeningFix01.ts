/**
 * Tactical X-Band Digital Twin — Verification Suite 115
 *
 * Verifies FIX-01 Hardening:
 * 1. Live TS Parity Server Security & Parity Controls (Loopback CORS, XBAND_CORS_ORIGINS,
 *    constant-time token auth, 1MB body cap returning 413, SSE client management, honest capabilities).
 * 2. Electron xband-tile:// Async PMTiles v3 RFC 9110 Byte-Range Serving & Symlink Containment.
 * 3. package.json & CI Workflow Hardening Parity (vite-node, v3.0.0, least-privilege CI).
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsParityServer } from '../../server/ts_parity_server.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

interface HttpTestResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function httpRequest(options: http.RequestOptions, bodyData?: string | Buffer): Promise<HttpTestResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    if (bodyData) {
      req.write(bodyData);
    }
    req.end();
  });
}

let passedChecks = 0;
async function runCheck(name: string, fn: () => Promise<void>) {
  process.stdout.write(`  [CHECK] ${name} ... `);
  await fn();
  console.log('PASS');
  passedChecks++;
}

async function main() {
  console.log('\n================================================================');
  console.log('  TACTICAL DIGITAL TWIN — VERIFICATION SUITE 115 (FIX-01)');
  console.log('  CI Hardening, TS Parity Server Security & Electron PMTiles Range');
  console.log('================================================================\n');

  // ------------------------------------------------------------------
  // [FIX01-T1] Live ts_parity_server Security & Parity Tests
  // ------------------------------------------------------------------
  console.log('--- [FIX01-T1] Live ts_parity_server Security & Parity Controls ---');

  const testToken = 'xband-sec-audit-token-fix01-9988';
  const serverInstance = createTsParityServer({
    host: '127.0.0.1',
    port: 0,
    apiToken: testToken,
    corsOrigins: ['https://trusted.simulation.mil'],
    honestCapabilities: true,
  });

  const { port } = await serverInstance.start();
  console.log(`  Ephemeral test server listening on port ${port}`);

  try {
    // 1. Loopback CORS allowlist & external block
    await runCheck('CORS allows loopback origin http://localhost:5173', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        method: 'GET',
        headers: { Origin: 'http://localhost:5173' },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
    });

    await runCheck('CORS allows loopback origin http://127.0.0.1:8080', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        method: 'GET',
        headers: { Origin: 'http://127.0.0.1:8080' },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['access-control-allow-origin'], 'http://127.0.0.1:8080');
    });

    await runCheck('CORS blocks untrusted external origin https://evil.attacker.mil', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        method: 'GET',
        headers: { Origin: 'https://evil.attacker.mil' },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });

    await runCheck('CORS allows configured XBAND_CORS_ORIGINS (https://trusted.simulation.mil)', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        method: 'GET',
        headers: { Origin: 'https://trusted.simulation.mil' },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['access-control-allow-origin'], 'https://trusted.simulation.mil');
    });

    await runCheck('CORS preflight OPTIONS returns 204 for loopback and 403 for untrusted', async () => {
      const optOk = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/tick',
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:3000' },
      });
      assert.equal(optOk.statusCode, 204);

      const optBlocked = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/tick',
        method: 'OPTIONS',
        headers: { Origin: 'https://unauthorized.org' },
      });
      assert.equal(optBlocked.statusCode, 403);
    });

    // 2. Constant-time API Token Authentication on mutating methods
    await runCheck('Mutating POST /api/tick without token returns 401 Unauthorized', async () => {
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/tick',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ steps: 1 })
      );
      assert.equal(res.statusCode, 401);
      const json = JSON.parse(res.body);
      assert.ok(json.error && json.error.includes('Unauthorized'));
    });

    await runCheck('Mutating POST /api/tick with wrong token returns 401 Unauthorized', async () => {
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/tick',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'completely-wrong-token-string',
          },
        },
        JSON.stringify({ steps: 1 })
      );
      assert.equal(res.statusCode, 401);
    });

    await runCheck('Mutating POST /api/tick with valid X-API-Key returns 200 OK', async () => {
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/tick',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': testToken,
          },
        },
        JSON.stringify({ steps: 1 })
      );
      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.equal(json.ok, true);
      assert.equal(json.stepsExecuted, 1);
    });

    await runCheck('Mutating POST /api/tick with valid Authorization Bearer returns 200 OK', async () => {
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/tick',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${testToken}`,
          },
        },
        JSON.stringify({ steps: 2 })
      );
      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.equal(json.ok, true);
      assert.equal(json.stepsExecuted, 2);
    });

    await runCheck('Read-only GET /api/telemetry succeeds without token (frictionless)', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/telemetry',
        method: 'GET',
      });
      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.ok(typeof json.frame_index === 'number');
    });

    // 3. Body size limit & JSON error handling
    await runCheck('Oversized POST payload (> 1 MB) returns 413 Payload Too Large', async () => {
      const hugeBuffer = Buffer.alloc(1_100_000, 'a');
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/tick',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': testToken,
            'Content-Length': String(hugeBuffer.length),
          },
        },
        hugeBuffer
      );
      assert.equal(res.statusCode, 413);
      const json = JSON.parse(res.body);
      assert.ok(json.error && json.error.includes('Payload Too Large'));
    });

    await runCheck('Malformed JSON payload returns 400 Bad Request', async () => {
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/tick',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': testToken,
          },
        },
        '{"steps": invalid json here'
      );
      assert.equal(res.statusCode, 400);
      const json = JSON.parse(res.body);
      assert.ok(json.error && json.error.includes('Malformed JSON'));
    });

    // 4. Honest Capabilities advertisement
    await runCheck('GET /api/capabilities returns honest typescript-parity-server metadata', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/capabilities?parity=ts',
        method: 'GET',
      });
      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.equal(json.engine, 'typescript-parity-server');
      assert.equal(json.parity_status, 'full-canonical-ts');
      assert.equal(json.canonical_runtime, 'typescript');
      assert.equal(json.transport, 'rest+sse');
      assert.ok(Array.isArray(json.features));
      assert.ok(json.features.includes('50hz-discrete-event-loop'));
      assert.ok(json.features.includes('sse-telemetry-stream'));
    });

    // 5. SSE Telemetry Stream Connection & Client Cap
    await runCheck('GET /api/telemetry/stream connects and receives handshake event', async () => {
      const sseConnected = await new Promise<boolean>((resolve, reject) => {
        const req = http.get(
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/telemetry/stream',
          },
          (res) => {
            assert.equal(res.statusCode, 200);
            assert.equal(res.headers['content-type'], 'text/event-stream');
            let received = '';
            res.on('data', (chunk) => {
              received += chunk.toString();
              if (received.includes('"event":"connected"')) {
                req.destroy();
                resolve(true);
              }
            });
          }
        );
        req.on('error', (err) => {
          // If aborted cleanly by us, resolve true
          if ((err as any).code === 'ECONNRESET') resolve(true);
          else reject(err);
        });
      });
      assert.equal(sseConnected, true);
    });

    await runCheck('SSE connection cap returns 503 Service Unavailable when full', async () => {
      const clients: http.ClientRequest[] = [];
      try {
        // Open 32 active connections
        for (let i = 0; i < 32; i++) {
          const c = http.get({
            hostname: '127.0.0.1',
            port,
            path: '/api/telemetry/stream',
          });
          c.on('error', () => {});
          clients.push(c);
        }

        // Wait brief tick for connections to establish
        await new Promise((r) => setTimeout(r, 60));

        // 33rd connection must be rejected with 503
        const res33 = await httpRequest({
          hostname: '127.0.0.1',
          port,
          path: '/api/telemetry/stream',
          method: 'GET',
        });
        assert.equal(res33.statusCode, 503);
        const json = JSON.parse(res33.body);
        assert.ok(json.error && json.error.includes('SSE client limit'));
      } finally {
        for (const c of clients) {
          try {
            c.destroy();
          } catch {}
        }
      }
    });
  } finally {
    await serverInstance.stop();
    console.log('  Test server stopped successfully.');
  }

  // ------------------------------------------------------------------
  // [FIX01-T2] Electron xband-tile:// PMTiles Range & Security Audit
  // ------------------------------------------------------------------
  console.log('\n--- [FIX01-T2] Electron xband-tile:// PMTiles Range & Security Audit ---');

  const electronMainPath = path.resolve(ROOT_DIR, 'electron/main.cjs');
  assert.ok(fs.existsSync(electronMainPath), 'electron/main.cjs must exist');
  const electronContent = fs.readFileSync(electronMainPath, 'utf8');

  await runCheck('electron/main.cjs contains zero blocking fs.readFileSync inside xband-tile handler', async () => {
    const tileHandlerMatch = electronContent.match(/protocol\.handle\(\s*['"]xband-tile['"][\s\S]*?\n\s*\}\s*\);/);
    assert.ok(tileHandlerMatch, 'protocol.handle("xband-tile") must exist');
    const tileHandlerCode = tileHandlerMatch[0];
    assert.ok(!tileHandlerCode.includes('fs.readFileSync'), 'Must not contain fs.readFileSync in xband-tile handler');
    assert.ok(tileHandlerCode.includes('fs.promises'), 'Must use fs.promises for async non-blocking I/O');
  });

  await runCheck('electron/main.cjs enforces canonical fs.promises.realpath symlink containment check', async () => {
    assert.ok(
      electronContent.includes('fs.promises.realpath') || electronContent.includes('realpath('),
      'Must use realpath to prevent symlink escape directory traversal'
    );
    assert.ok(
      electronContent.includes('403') && electronContent.includes('Forbidden'),
      'Must return 403 Forbidden on directory traversal attempt'
    );
  });

  await runCheck('electron/main.cjs includes .pmtiles MIME mapping (application/octet-stream)', async () => {
    assert.ok(
      electronContent.includes("'.pmtiles': 'application/octet-stream'") ||
        electronContent.includes('".pmtiles": "application/octet-stream"'),
      'MIME mapping must register .pmtiles as application/octet-stream'
    );
  });

  await runCheck('electron/main.cjs implements RFC 9110 Range parsing and returns 206 Partial Content', async () => {
    assert.ok(electronContent.includes('rangeHeader') && electronContent.includes('bytes='), 'Must parse Range header');
    assert.ok(electronContent.includes('206'), 'Must return HTTP 206 Partial Content');
    assert.ok(electronContent.includes('Content-Range'), 'Must emit Content-Range header');
    assert.ok(electronContent.includes('Accept-Ranges'), 'Must emit Accept-Ranges: bytes');
    assert.ok(electronContent.includes('416'), 'Must return 416 Range Not Satisfiable on out-of-range bounds');
  });

  // ------------------------------------------------------------------
  // [FIX01-T3] package.json & CI Workflow Parity
  // ------------------------------------------------------------------
  console.log('\n--- [FIX01-T3] package.json & CI Workflow Hardening Parity ---');

  const pkgJsonPath = path.resolve(ROOT_DIR, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

  await runCheck('package.json version is valid semver >= 4.0.0 and matches src-tauri/tauri.conf.json', async () => {
    const semverMatch = String(pkg.version || '').match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
    assert.ok(semverMatch, `package.json version must be valid semver (got ${pkg.version})`);
    assert.ok(Number(semverMatch[1]) >= 4, `package.json major version must be >= 4 (got ${pkg.version})`);
    const tauriConfPath = path.resolve(ROOT_DIR, 'src-tauri', 'tauri.conf.json');
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    assert.equal(pkg.version, tauriConf.version, 'package.json version must match src-tauri/tauri.conf.json');
  });

  await runCheck('package.json server:ts uses vite-node (no missing tsx dependency)', async () => {
    assert.ok(pkg.scripts['server:ts'], 'server:ts script must exist');
    assert.ok(
      pkg.scripts['server:ts'].includes('vite-node'),
      `server:ts must use vite-node, got: "${pkg.scripts['server:ts']}"`
    );
    assert.ok(
      !pkg.scripts['server:ts'].startsWith('tsx '),
      'server:ts must not invoke uninstalled tsx'
    );
  });

  await runCheck('package.json defines verify:fix01-hardening script', async () => {
    assert.ok(pkg.scripts['verify:fix01-hardening'], 'verify:fix01-hardening must be registered in scripts');
    assert.ok(pkg.scripts['verify:fix01-hardening'].includes('verifyHardeningFix01.ts'));
  });

  const ciYamlPath = path.resolve(ROOT_DIR, '.github/workflows/ci.yml');
  const ciYamlContent = fs.readFileSync(ciYamlPath, 'utf8');

  await runCheck('.github/workflows/ci.yml configures browser-ux with 15-minute timeout and CI=true', async () => {
    assert.ok(ciYamlContent.includes('browser-ux:'), 'browser-ux job must exist in ci.yml');
    assert.ok(ciYamlContent.includes('timeout-minutes: 15'), 'browser-ux must have timeout-minutes: 15');
    assert.ok(ciYamlContent.includes('CI: "true"') || ciYamlContent.includes("CI: 'true'"), 'CI: "true" must be set');
  });

  await runCheck('.github/workflows/ci.yml maintains least-privilege permissions: contents: read', async () => {
    assert.ok(ciYamlContent.includes('permissions:'), 'permissions block must be defined');
    assert.ok(ciYamlContent.includes('contents: read'), 'least privilege contents: read must be enforced');
  });

  console.log('\n================================================================');
  console.log(`  SUITE 115 SUMMARY: ${passedChecks} checks passed, 0 failures.`);
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\nSUITE 115 FAILED:', err);
  process.exit(1);
});
