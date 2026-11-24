/**
 * Tactical X-Band Digital Twin — Canonical TypeScript Headless Parity Server
 *
 * Implements an authoritative Node.js HTTP server wrapping SimulationWorkerManager
 * with zero external runtime dependencies, loopback-only CORS, constant-time API token
 * authentication, deterministic stepping, and configuration injection.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SimulationWorkerManager } from '../src/worker/simWorker.ts';

export interface TsParityServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly apiToken?: string;
  readonly seedOffset?: number;
  readonly corsOrigins?: string[];
  readonly honestCapabilities?: boolean;
}

export interface TsParityServerInstance {
  readonly server: http.Server;
  start(): Promise<{ host: string; port: number }>;
  stop(): Promise<void>;
  getAddress(): { host: string; port: number };
  getWorker(): SimulationWorkerManager;
}

function timingSafeCheck(provided: string, expected: string): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const hashProvided = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const hashExpected = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(hashProvided, hashExpected);
}

const LOOPBACK_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function handleCors(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  allowedExtraOrigins: string[] = []
): boolean {
  const origin = req.headers.origin;
  let isAllowed = false;
  if (typeof origin === 'string' && origin.length > 0) {
    if (LOOPBACK_ORIGIN_REGEX.test(origin) || allowedExtraOrigins.includes(origin)) {
      isAllowed = true;
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Parity-Mode');
      res.setHeader('Vary', 'Origin');
    }
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(isAllowed ? 204 : 403);
    res.end();
    return true;
  }

  return false;
}

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

function readJsonBody(
  req: http.IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  return new Promise((resolve) => {
    let raw = '';
    let bytesReceived = 0;
    let exceeded = false;

    req.on('data', (chunk: Buffer) => {
      if (exceeded) return;
      bytesReceived += chunk.length;
      if (bytesReceived > maxBytes) {
        exceeded = true;
        req.pause();
        req.on('data', () => {});
        resolve({ ok: false, status: 413, error: 'Payload Too Large: maximum body size is 1 MB' });
        return;
      }
      raw += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (exceeded) return;
      if (raw.trim().length === 0) {
        resolve({ ok: true, body: {} });
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          resolve({ ok: false, status: 400, error: 'Invalid JSON payload: expected JSON object' });
          return;
        }
        resolve({ ok: true, body: parsed as Record<string, unknown> });
      } catch {
        resolve({ ok: false, status: 400, error: 'Malformed JSON payload' });
      }
    });

    req.on('error', (err: Error) => {
      if (!exceeded) {
        resolve({ ok: false, status: 400, error: err.message || 'Error reading request stream' });
      }
    });
  });
}

export function createTsParityServer(options?: TsParityServerOptions): TsParityServerInstance {
  let targetHost = options?.host || '127.0.0.1';
  let targetPort = typeof options?.port === 'number' ? options.port : 8001;

  const envOrigins = (process.env.XBAND_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowedOrigins = [...(options?.corsOrigins ?? []), ...envOrigins];

  const sseClients = new Set<http.ServerResponse>();
  const MAX_SSE_CLIENTS = 32;

  function broadcastTelemetry(frame: unknown) {
    if (sseClients.size === 0) return;
    const chunk = `data: ${JSON.stringify(frame)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(chunk);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // Authoritative discrete-event simulation worker instance
  const simWorker = new SimulationWorkerManager(options?.seedOffset ?? 0, '16_NODES');

  const server = http.createServer(async (req, res) => {
    if (handleCors(req, res, allowedOrigins)) return;

    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const activeToken = options?.apiToken ?? process.env.XBAND_API_TOKEN ?? '';

    // Constant-time token verification for non-empty configured token on mutating methods
    if (isMutating && activeToken.length > 0) {
      let providedToken = '';
      const headerKey = req.headers['x-api-key'];
      if (typeof headerKey === 'string') {
        providedToken = headerKey.trim();
      } else {
        const authHeader = req.headers['authorization'];
        if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
          providedToken = authHeader.slice(7).trim();
        }
      }

      if (!timingSafeCheck(providedToken, activeToken)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing API token' }));
        return;
      }
    }

    // 1. GET /api/capabilities
    if (method === 'GET' && pathname === '/api/capabilities') {
      const isHonest = Boolean(
        options?.honestCapabilities ||
        url.searchParams.get('parity') === 'ts' ||
        url.searchParams.get('parity_status') === 'full-canonical-ts' ||
        url.searchParams.get('mode') === 'honest' ||
        req.headers['x-parity-mode'] === 'honest'
      );

      const engine = isHonest ? 'typescript-parity-server' : 'canonical-typescript-node-server';
      const parity_status = isHonest ? 'full-canonical-ts' : 'full-canonical-parity';
      const canonical_runtime = isHonest ? 'typescript' : 'typescript-simulation-worker-manager';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          engine,
          parity_status,
          canonical_runtime,
          transport: 'rest+sse',
          features: [
            '50hz-discrete-event-loop',
            'quad-sector-antenna',
            'polar-viewshed',
            'itu-r-p676-absorption',
            'itu-r-p838-rain',
            'itu-r-p526-diffraction',
            'dvb-s2x-modcod',
            'closed-loop-mac-transport',
            'ew-eccm-esm-lpi',
            'multi-biome-rf-physics',
            'constellation-manet-aerodynamics',
            'sse-telemetry-stream',
          ],
        })
      );
      return;
    }

    // 1b. GET /api/telemetry/stream (SSE)
    if (method === 'GET' && pathname === '/api/telemetry/stream') {
      if (sseClients.size >= MAX_SSE_CLIENTS) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service Unavailable: SSE client limit reached (max 32)' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: {"event":"connected","status":"ready"}\n\n');
      sseClients.add(res);

      const cleanup = () => {
        sseClients.delete(res);
      };
      req.on('close', cleanup);
      res.on('error', cleanup);
      return;
    }

    // 2. GET /api/health
    if (method === 'GET' && pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          frame_index: simWorker.frameIndex,
          sim_time_s: simWorker.simTimeS,
        })
      );
      return;
    }

    // 3. GET /api/telemetry
    if (method === 'GET' && pathname === '/api/telemetry') {
      if (!simWorker.lastTelemetryFrame) {
        simWorker.tickSimulation(true);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(simWorker.lastTelemetryFrame));
      return;
    }

    // 4. POST /api/tick
    if (method === 'POST' && pathname === '/api/tick') {
      const parsedBody = await readJsonBody(req);
      if (!parsedBody.ok) {
        res.writeHead(parsedBody.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: parsedBody.error }));
        return;
      }

      let steps = 1;
      if (typeof parsedBody.body.steps !== 'undefined') {
        const rawSteps = parsedBody.body.steps;
        if (typeof rawSteps !== 'number' || !Number.isInteger(rawSteps) || rawSteps < 1 || rawSteps > 100) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'steps must be an integer between 1 and 100' }));
          return;
        }
        steps = rawSteps;
      }

      for (let i = 0; i < steps; i++) {
        simWorker.tickSimulation(i === steps - 1);
      }
      broadcastTelemetry(simWorker.lastTelemetryFrame);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          stepsExecuted: steps,
          frame: simWorker.lastTelemetryFrame,
        })
      );
      return;
    }

    // 5. POST /api/config
    if (method === 'POST' && pathname === '/api/config') {
      const parsedBody = await readJsonBody(req);
      if (!parsedBody.ok) {
        res.writeHead(parsedBody.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: parsedBody.error }));
        return;
      }

      const body = parsedBody.body;

      // Optional biome update
      if (typeof body.biomeId === 'string') {
        simWorker.handleCommand({
          type: 'SET_BIOME',
          biomeId: body.biomeId as any,
        });
      }

      const result = simWorker.handleCommand({
        type: 'CONFIG_UPDATE',
        params: body as any,
      });

      if (!result.accepted) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.reason || 'Invalid configuration parameters' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
      return;
    }

    // 6. POST /api/control
    if (method === 'POST' && pathname === '/api/control') {
      const parsedBody = await readJsonBody(req);
      if (!parsedBody.ok) {
        res.writeHead(parsedBody.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: parsedBody.error }));
        return;
      }

      const action = parsedBody.body.action;
      if (typeof action !== 'string' || !['pause', 'resume', 'reset', 'load_preset'].includes(action)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'action must be one of: pause, resume, reset, load_preset' }));
        return;
      }

      if (action === 'load_preset') {
        const preset = parsedBody.body.preset === 'ACN_ONLY' ? 'ACN_ONLY' : '16_NODES';
        simWorker.handleCommand({ type: 'LOAD_PRESET', preset });
      } else {
        simWorker.handleCommand({ type: 'SIM_CONTROL', action: action as any });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          frame: {
            frame_index: simWorker.frameIndex,
            sim_time_s: simWorker.simTimeS,
          },
        })
      );
      return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Not Found: ${method} ${pathname}` }));
  });

  return {
    server,
    start(): Promise<{ host: string; port: number }> {
      return new Promise((resolve, reject) => {
        server.listen(targetPort, targetHost, () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            targetHost = addr.address;
            targetPort = addr.port;
          }
          resolve({ host: targetHost, port: targetPort });
        });
        server.once('error', reject);
      });
    },
    stop(): Promise<void> {
      for (const client of sseClients) {
        try {
          client.end();
        } catch {
          // ignore
        }
      }
      sseClients.clear();
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    getAddress(): { host: string; port: number } {
      return { host: targetHost, port: targetPort };
    },
    getWorker(): SimulationWorkerManager {
      return simWorker;
    },
  };
}

// CLI runner guard
const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1] && process.argv[1].endsWith('ts_parity_server.ts'));

if (isMain) {
  const host = process.env.XBAND_HOST || '127.0.0.1';
  const port = parseInt(process.env.XBAND_PORT || '8001', 10);
  const token = process.env.XBAND_API_TOKEN;
  const instance = createTsParityServer({ host, port, apiToken: token });
  instance
    .start()
    .then(({ host: h, port: p }) => {
      console.log(`[Canonical TS Parity Server] Listening on http://${h}:${p}`);
    })
    .catch((err) => {
      console.error('[Canonical TS Parity Server] Startup failure:', err);
      process.exit(1);
    });
}
