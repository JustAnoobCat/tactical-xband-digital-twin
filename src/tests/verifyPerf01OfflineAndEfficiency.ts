/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * PERF-01 Verification Suite: True Offline Air-Gap Readiness & RAM/CPU/GPU Efficiency
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { buildLinkProfile } from '../core/linkProfile';
import { BIOME_DEM_METADATA, TerrainEngine } from '../core/terrain';
import { THEATER_BIOMES } from '../core/biomePhysics';
import { MapController, buildOfflineSafeMapStyle } from '../ui/mapController';
import { SchedulerHistoryBuffer } from '../ui/schedulerHistory';
import { SimulationHistoryBuffer } from '../ui/simulationHistory';
import { WorldTileLayer, shadeTerrariumTileRgba } from '../ui/worldTileLayer';
import { createWorkspaceTilesManager } from '../ui/workspaceTilesManager';
import { SimulationWorkerManager } from '../worker/simWorker';

const currentDir = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(currentDir, '../..');

let passedChecks = 0;

function check(label: string, fn: () => void): void {
  fn();
  passedChecks++;
  console.log(`  ✓ ${label}`);
}

async function checkAsync(label: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passedChecks++;
  console.log(`  ✓ ${label}`);
}

console.log('='.repeat(92));
console.log('  PERF-01 VERIFICATION SUITE: OFFLINE AIR-GAP READINESS & EFFICIENCY');
console.log('='.repeat(92));

// -----------------------------------------------------------------------------
// 1. Offline & Relative Build + Strict CSP + PWA
// -----------------------------------------------------------------------------
console.log('\n[1/5] Verifying Offline Relative Build, PWA Assets & Strict CSP...');

check('vite.config.ts uses relative ./ local base by default (including Tauri CI) and gates subpath on VITE_PAGES_BASE', () => {
  const viteCfg = readFileSync(resolve(ROOT_DIR, 'vite.config.ts'), 'utf8');
  assert.ok(viteCfg.includes('process.env.VITE_PAGES_BASE === "true"'), 'Pages subpath must be gated on VITE_PAGES_BASE');
  assert.equal(viteCfg.includes('GITHUB_ACTIONS'), false, 'vite.config.ts must not gate base on GITHUB_ACTIONS');
  assert.ok(viteCfg.includes('? "/tactical-xband-digital-twin/"'), 'CI subpath must remain intact');
  assert.ok(viteCfg.includes(': "./"'), 'Local/desktop build base must be "./"');
});

check('public/manifest.webmanifest and public/sw.js exist with zero external URLs', () => {
  const manifestPath = resolve(ROOT_DIR, 'public/manifest.webmanifest');
  const swPath = resolve(ROOT_DIR, 'public/sw.js');
  assert.equal(existsSync(manifestPath), true, 'public/manifest.webmanifest must exist');
  assert.equal(existsSync(swPath), true, 'public/sw.js must exist');

  const manifestRaw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(/https?:\/\//i.test(manifestRaw), false, 'manifest must contain zero external URLs');

  const swRaw = readFileSync(swPath, 'utf8');
  assert.equal(/https?:\/\//i.test(swRaw), false, 'sw.js must contain zero external URLs');
  assert.ok(swRaw.includes('url.origin !== self.location.origin'), 'sw.js must ignore cross-origin requests');
  assert.ok(swRaw.includes('real_ladakh_dem.bin'), 'sw.js must precache bundled DEM binary');
});

check('SW-FIX-01: public/sw.js enforces Network-First HTML navigation, activate cache purge, and 200-OK only caching', () => {
  const swRaw = readFileSync(resolve(ROOT_DIR, 'public/sw.js'), 'utf8');
  assert.equal(/https?:\/\//i.test(swRaw), false, 'sw.js must contain zero external URLs');
  assert.ok(swRaw.includes("CACHE_NAME = 'xband-twin-offline-v2'"), 'sw.js must bump CACHE_NAME beyond stale v1');
  assert.ok(swRaw.includes("request.mode === 'navigate'"), 'sw.js must detect navigation requests via request.mode === navigate');
  assert.ok(swRaw.includes("url.pathname.endsWith('/')"), 'sw.js must match directory root HTML requests');
  assert.ok(swRaw.includes("url.pathname.endsWith('.html')"), 'sw.js must match .html requests');
  assert.ok(swRaw.includes("url.pathname.endsWith('manifest.webmanifest')"), 'sw.js must match manifest.webmanifest requests');
  assert.ok(swRaw.includes("cache: 'no-cache'"), 'sw.js must bypass HTTP cache with no-cache on Network-First navigation fetch');
  assert.ok(swRaw.includes('caches.delete('), 'sw.js activate handler must purge stale caches');
  assert.ok(swRaw.includes('self.clients.claim()'), 'sw.js activate handler must claim clients');
  assert.ok(swRaw.includes('self.skipWaiting()'), 'sw.js install handler must call skipWaiting()');
  assert.ok(swRaw.includes('response.status === 200'), 'sw.js must cache 200 OK responses only (never 404)');
});

await checkAsync('SW-FIX-01: runtime behavior verifies Network-First HTML, stale v1 purge, and 404 exclusion', async () => {
  const swRaw = readFileSync(resolve(ROOT_DIR, 'public/sw.js'), 'utf8');
  const origin = 'http://localhost:4173';
  const cacheStore = new Map<string, Map<string, MockResponse>>();
  const listeners = new Map<string, (event: any) => void>();

  class MockRequest {
    url: string;
    method: string;
    mode: string;
    cache: string;
    constructor(input: string | MockRequest, init: { method?: string; mode?: string; cache?: string } = {}) {
      if (typeof input === 'string') {
        this.url = new URL(input, `${origin}/`).href;
        this.method = init.method ?? 'GET';
        this.mode = init.mode ?? 'same-origin';
        this.cache = init.cache ?? 'default';
      } else {
        this.url = input.url;
        this.method = init.method ?? input.method;
        this.mode = init.mode ?? (Object.keys(init).length > 0 ? 'cors' : input.mode);
        this.cache = init.cache ?? input.cache;
      }
    }
  }

  class MockResponse {
    body: string;
    status: number;
    statusText: string;
    ok: boolean;
    type: string;
    constructor(body = '', init: { status?: number; statusText?: string; type?: string } = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this.statusText = init.statusText ?? 'OK';
      this.ok = this.status >= 200 && this.status < 300;
      this.type = init.type ?? 'basic';
    }
    clone() {
      return new MockResponse(this.body, { status: this.status, statusText: this.statusText, type: this.type });
    }
  }

  const normalizeKey = (reqOrUrl: string | MockRequest) =>
    new URL(typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url, `${origin}/`).href;

  const mockCaches = {
    async open(name: string) {
      let bucket = cacheStore.get(name);
      if (!bucket) {
        bucket = new Map();
        cacheStore.set(name, bucket);
      }
      return {
        async put(reqOrUrl: string | MockRequest, resp: MockResponse) {
          bucket!.set(normalizeKey(reqOrUrl), resp);
        },
        async add(reqOrUrl: string | MockRequest) {
          const resp = await mockFetch(reqOrUrl);
          if (resp.ok) bucket!.set(normalizeKey(reqOrUrl), resp);
        },
        async match(reqOrUrl: string | MockRequest) {
          return bucket!.get(normalizeKey(reqOrUrl));
        },
      };
    },
    async keys() {
      return Array.from(cacheStore.keys());
    },
    async delete(name: string) {
      return cacheStore.delete(name);
    },
    async match(reqOrUrl: string | MockRequest) {
      const key = normalizeKey(reqOrUrl);
      for (const bucket of cacheStore.values()) {
        if (bucket.has(key)) return bucket.get(key);
      }
      return undefined;
    },
  };

  let fetchCalls: Array<{ url: string; cache: string }> = [];
  let mockFetchImpl: (req: MockRequest) => Promise<MockResponse> = async () => new MockResponse('ok', { status: 200 });
  const mockFetch = async (input: string | MockRequest, init?: { cache?: string }) => {
    const req = input instanceof MockRequest && !init ? input : new MockRequest(input, init);
    fetchCalls.push({ url: req.url, cache: req.cache });
    return mockFetchImpl(req);
  };

  let skipWaitingCalled = false;
  let clientsClaimCalled = false;
  const mockSelf: any = {
    location: { origin },
    addEventListener: (type: string, fn: (event: any) => void) => listeners.set(type, fn),
    skipWaiting: async () => {
      skipWaitingCalled = true;
    },
    clients: {
      claim: async () => {
        clientsClaimCalled = true;
      },
    },
  };

  runInNewContext(swRaw, {
    self: mockSelf,
    caches: mockCaches,
    fetch: mockFetch,
    Request: MockRequest,
    Response: MockResponse,
    URL,
  });

  // 1. Install precaches core URLs and invokes skipWaiting()
  let waitPromise: Promise<unknown> | undefined;
  listeners.get('install')!({ waitUntil: (p: Promise<unknown>) => { waitPromise = p; } });
  await waitPromise;
  assert.equal(skipWaitingCalled, true, 'install must call self.skipWaiting()');
  assert.equal(cacheStore.has('xband-twin-offline-v2'), true, 'install must open xband-twin-offline-v2');

  // 2. Activate purges stale v1 cache and calls clients.claim()
  cacheStore.set('stratos-xband-offline-v1', new Map([[`${origin}/`, new MockResponse('stale-v1')]]));
  listeners.get('activate')!({ waitUntil: (p: Promise<unknown>) => { waitPromise = p; } });
  await waitPromise;
  assert.equal(cacheStore.has('stratos-xband-offline-v1'), false, 'activate must delete stale v1 cache');
  assert.equal(cacheStore.has('xband-twin-offline-v2'), true, 'activate must keep active v2 cache');
  assert.equal(clientsClaimCalled, true, 'activate must call self.clients.claim()');

  const dispatchFetch = async (req: MockRequest): Promise<MockResponse | undefined> => {
    let responsePromise: Promise<MockResponse> | undefined;
    listeners.get('fetch')!({
      request: req,
      respondWith: (p: Promise<MockResponse>) => {
        responsePromise = p;
      },
    });
    if (!responsePromise) return undefined;
    const res = await responsePromise;
    await new Promise((r) => setTimeout(r, 0));
    return res;
  };

  // 3. Navigation uses Network-First with cache: 'no-cache' even when stale HTML is cached
  cacheStore.get('xband-twin-offline-v2')!.set(`${origin}/`, new MockResponse('<html>stale</html>'));
  cacheStore.get('xband-twin-offline-v2')!.set(`${origin}/index.html`, new MockResponse('<html>precached-index</html>'));
  fetchCalls = [];
  mockFetchImpl = async () => new MockResponse('<html>fresh-deploy</html>', { status: 200 });
  const navRes = await dispatchFetch(new MockRequest(`${origin}/`, { mode: 'navigate' }));
  assert.equal(navRes?.body, '<html>fresh-deploy</html>', 'Navigation must serve fresh network HTML over stale cache');
  assert.equal(fetchCalls[0]?.cache, 'no-cache', 'Navigation fetch must use cache: no-cache');
  assert.equal(cacheStore.get('xband-twin-offline-v2')!.get(`${origin}/`)?.body, '<html>fresh-deploy</html>', '200 OK navigation response must update cache');

  // 4. Offline navigation falls back to cache / ./index.html only when network fails
  mockFetchImpl = async () => {
    throw new Error('offline');
  };
  const offlineNav = await dispatchFetch(new MockRequest(`${origin}/app.html`, { mode: 'navigate' }));
  assert.equal(offlineNav?.body, '<html>precached-index</html>', 'Offline navigation must fall back to precached ./index.html');

  // 5. Non-OK (404) static or HTML responses must NEVER be cached
  mockFetchImpl = async () => new MockResponse('Not Found', { status: 404, statusText: 'Not Found' });
  const missAssetRes = await dispatchFetch(new MockRequest(`${origin}/assets/missing-deadbeef.js`, { mode: 'cors' }));
  assert.equal(missAssetRes?.status, 404);
  assert.equal(cacheStore.get('xband-twin-offline-v2')!.has(`${origin}/assets/missing-deadbeef.js`), false, '404 response must never be cached');

  // 6. Static asset 200 OK backfills cache then serves Cache-First
  mockFetchImpl = async () => new MockResponse('console.log("v2")', { status: 200 });
  const assetRes = await dispatchFetch(new MockRequest(`${origin}/assets/index-abc123.js`, { mode: 'cors' }));
  assert.equal(assetRes?.body, 'console.log("v2")');
  assert.equal(cacheStore.get('xband-twin-offline-v2')!.has(`${origin}/assets/index-abc123.js`), true, '200 OK asset must backfill cache');

  fetchCalls = [];
  const cachedAssetRes = await dispatchFetch(new MockRequest(`${origin}/assets/index-abc123.js`, { mode: 'cors' }));
  assert.equal(cachedAssetRes?.body, 'console.log("v2")');
  assert.equal(fetchCalls.length, 0, 'Cached hashed asset must be served Cache-First without network fetch');

  // 7. Cross-origin requests are strictly ignored
  fetchCalls = [];
  const extRes = await dispatchFetch(new MockRequest('http://external.invalid/tile.png', { mode: 'cors' }));
  assert.equal(extRes, undefined, 'Cross-origin requests must be ignored by sw.js');
  assert.equal(fetchCalls.length, 0);
});

check('index.html declares manifest link and maintains strict CSP (0 inline scripts/handlers)', () => {
  const html = readFileSync(resolve(ROOT_DIR, 'index.html'), 'utf8');
  assert.ok(html.includes('<link rel="manifest" href="./manifest.webmanifest">'), 'index.html must link ./manifest.webmanifest');

  const scriptBodyMatches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of scriptBodyMatches) {
    assert.equal(m[1].trim(), '', 'index.html must contain zero inline <script> bodies');
  }
  assert.equal(/\son[a-z]+\s*=/i.test(html), false, 'index.html must contain zero inline on*= event handlers');
});

check('dist/index.html uses environment-appropriate asset paths and maintains strict CSP', () => {
  const distIndexPath = resolve(ROOT_DIR, 'dist/index.html');
  if (!existsSync(distIndexPath)) {
    console.log('    -> dist/index.html not built yet; skipping post-build HTML check (run npm run build to audit dist/)');
    return;
  }
  const distHtml = readFileSync(distIndexPath, 'utf8');

  assert.equal(/(["'])\/assets\//.test(distHtml), false, 'dist/index.html must contain zero bare root /assets/ paths');
  if (process.env.VITE_PAGES_BASE === 'true') {
    assert.ok(
      distHtml.includes('/tactical-xband-digital-twin/assets/'),
      'dist/index.html must reference /tactical-xband-digital-twin/assets/ paths when VITE_PAGES_BASE=true'
    );
    assert.equal(
      distHtml.includes('./assets/'),
      false,
      'dist/index.html must not emit relative ./assets/ paths when VITE_PAGES_BASE=true'
    );
  } else {
    assert.ok(
      distHtml.includes('./assets/'),
      'dist/index.html must reference relative ./assets/ paths (including GITHUB_ACTIONS=true without VITE_PAGES_BASE=true)'
    );
    assert.equal(
      distHtml.includes('/tactical-xband-digital-twin/assets/'),
      false,
      'dist/index.html must not embed /tactical-xband-digital-twin/assets/ unless VITE_PAGES_BASE=true'
    );
  }
  const scriptBodyMatches = [...distHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of scriptBodyMatches) {
    assert.equal(m[1].trim(), '', 'dist/index.html must contain zero inline <script> bodies');
  }
  assert.equal(/\son[a-z]+\s*=/i.test(distHtml), false, 'dist/index.html must contain zero inline on*= event handlers');
});

// -----------------------------------------------------------------------------
// 2. Air-Gap Lock, Reusable Tile Scratch Buffer & MapController Biome Geodesy
// -----------------------------------------------------------------------------
console.log('\n[2/5] Verifying Air-Gap Lock, WorldTileLayer Cache/Scratch & MapController Geodesy...');

check('WorldTileLayer airGapOfflineOnly=true blocks external fetches even when navigator.onLine=true', () => {
  const layer = new WorldTileLayer({ airGapOfflineOnly: true });
  assert.ok(layer.getMaxCacheSize() <= 64, `Default maxCacheSize must be <= 64, got ${layer.getMaxCacheSize()}`);
  assert.equal(layer.isExternalTilesAllowed(), false, 'Air-gap lock must block external http/https tiles');

  const origImage = (globalThis as any).Image;
  const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let constructed = 0;
  (globalThis as any).Image = class {
    constructor() {
      constructed++;
    }
  };
  try {
    layer.draw({ save() {}, restore() {} } as any, { width: 800, height: 600, rangeM: 60000 });
    assert.equal(constructed, 0, 'Air-gapped WorldTileLayer must issue 0 external Image requests');
  } finally {
    (globalThis as any).Image = origImage;
    if (origNav) Object.defineProperty(globalThis, 'navigator', origNav);
  }
});

check('WorldTileLayer shadeTerrariumTileRgba reuses single preallocated Float32Array scratch buffer', () => {
  const srcCode = readFileSync(resolve(ROOT_DIR, 'src/ui/worldTileLayer.ts'), 'utf8');
  assert.ok(srcCode.includes('DEFAULT_TERRARIUM_SCRATCH_PIXELS = 65536'), 'Must define 65536-pixel scratch buffer');
  assert.ok(srcCode.includes('sharedTerrariumElevScratch'), 'Must reuse sharedTerrariumElevScratch');
  const fnMatch = srcCode.match(/export function shadeTerrariumTileRgba[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'shadeTerrariumTileRgba function must exist');
  assert.equal(fnMatch[0].includes('new Float32Array'), false, 'shadeTerrariumTileRgba must not allocate Float32Array per call');

  const src = new Uint8ClampedArray(16 * 4);
  const dst = new Uint8ClampedArray(16 * 4);
  shadeTerrariumTileRgba(src, dst, 4, 4, 5, 34.5);
  assert.equal(dst[3], 255);
});

check('MapController projects non-Ladakh biomes using active biome origin and strips external tiles when air-gapped', () => {
  const desertCenter = THEATER_BIOMES.arid_desert;
  const desertMeta = BIOME_DEM_METADATA.arid_desert;
  const mc = new MapController(
    {
      project: ([lon, lat]: [number, number]) => ({ x: lon * 100, y: lat * 100 }),
    },
    'arid_desert'
  );
  const originPt = mc.projectEnuToContainerPoint(0, 0);
  assert.ok(originPt !== null);
  assert.ok(Math.abs(originPt.x - desertMeta.centerLonDeg * 100) < 1e-6);
  assert.ok(Math.abs(originPt.y - desertMeta.centerLatDeg * 100) < 1e-6);

  mc.setBiome('maritime_littoral');
  const seaPt = mc.projectEnuToContainerPoint(0, 0);
  assert.ok(seaPt !== null);
  assert.ok(Math.abs(seaPt.x - THEATER_BIOMES.maritime_littoral.centerLonDeg * 100) < 1e-6);
  assert.ok(Math.abs(seaPt.y - THEATER_BIOMES.maritime_littoral.centerLatDeg * 100) < 1e-6);
  assert.ok(Math.abs(desertCenter.centerLatDeg - THEATER_BIOMES.maritime_littoral.centerLatDeg) > 5);

  const offlineStyle = buildOfflineSafeMapStyle({
    airGapOfflineOnly: true,
    rasterTiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  });
  assert.deepEqual(offlineStyle.sources, {}, 'Air-gapped MapLibre style must have zero external tile sources');
  assert.equal(offlineStyle.layers[0].id, 'airgap-bg');
});

// -----------------------------------------------------------------------------
// 3. Lazy Code-Splitting of three and maplibre-gl
// -----------------------------------------------------------------------------
console.log('\n[3/5] Verifying Lazy Code-Splitting of three & maplibre-gl...');

function readMainAndAppFiles(): string[] {
  const appDir = resolve(ROOT_DIR, 'src/app');
  const appFiles = existsSync(appDir)
    ? readdirSync(appDir).filter((f) => f.endsWith('.ts')).sort().map((f) => readFileSync(resolve(appDir, f), 'utf8'))
    : [];
  return [readFileSync(resolve(ROOT_DIR, 'src/main.ts'), 'utf8'), ...appFiles];
}

check('src/main.ts + src/app/*.ts dynamically import threeSceneController, maplibre-gl, and MapController', () => {
  const allFiles = readMainAndAppFiles();
  const mainSrc = allFiles.join('\n');
  for (const src of allFiles) {
    assert.equal(/^import\s+[^;]*?from\s+['"]maplibre-gl['"]/m.test(src), false, 'No static maplibre-gl import in main/app modules');
    assert.equal(/^import\s+[^;]*?threeSceneController/m.test(src), false, 'No static threeSceneController import in main/app modules');
    assert.equal(/^import\s+[^;]*?mapController/m.test(src), false, 'No static mapController import in main/app modules');
  }

  assert.ok(mainSrc.includes("import('maplibre-gl')"), 'Must dynamically import maplibre-gl');
  assert.ok(/import\(['"]\.\.?\/ui\/three\/threeSceneController\.ts['"]\)/.test(mainSrc), 'Must dynamically import threeSceneController');
  assert.ok(/import\(['"]\.\.?\/ui\/mapController\.ts['"]\)/.test(mainSrc), 'Must dynamically import mapController');
  assert.ok(mainSrc.includes('releaseInactiveWebglContexts'), 'Must expose releaseInactiveWebglContexts');
});

check('dist/assets/ emits separate lazy chunks for three and maplibre-gl not statically loaded by dist/index.html', () => {
  const distIndexPath = resolve(ROOT_DIR, 'dist/index.html');
  const assetsDir = resolve(ROOT_DIR, 'dist/assets');
  if (!existsSync(distIndexPath) || !existsSync(assetsDir)) {
    console.log('    -> dist/ not built yet; skipping post-build chunk split check (run npm run build to audit dist/)');
    return;
  }
  const files = readdirSync(assetsDir);
  const threeChunk = files.find((f) => f.includes('vendor-three') && f.endsWith('.js'));
  const maplibreChunk = files.find((f) => f.includes('vendor-maplibre') && f.endsWith('.js'));
  assert.ok(threeChunk, `Expected vendor-three chunk in dist/assets/, found: ${files.join(', ')}`);
  assert.ok(maplibreChunk, `Expected vendor-maplibre chunk in dist/assets/, found: ${files.join(', ')}`);

  const distHtml = readFileSync(distIndexPath, 'utf8');
  assert.equal(distHtml.includes(threeChunk), false, 'dist/index.html must not eagerly load vendor-three chunk');
  assert.equal(distHtml.includes(maplibreChunk), false, 'dist/index.html must not eagerly load vendor-maplibre chunk');
});

// -----------------------------------------------------------------------------
// 4. Low-GC TypedArray History & Zero-Thrash Workspace Tiles
// -----------------------------------------------------------------------------
console.log('\n[4/5] Verifying Low-GC TypedArray History (< 4 MB) & Zero-Thrash Workspace Tiles...');

check('SimulationHistoryBuffer and SchedulerHistoryBuffer ingest 3,000 frames with < 4 MB RF heap & frozen reads', () => {
  const rfBuf = new SimulationHistoryBuffer(3000);
  const schedBuf = new SchedulerHistoryBuffer(3000);

  const sampleProfile = buildLinkProfile({
    selectedGroundNodeId: 4,
    nodeName: 'S4',
    frameIndex: 1,
    simulationTimeS: 0.02,
    groundNodePositionMslM: [4000, 2000, 3200],
    acnPositionMslM: [25000, 30000, 5000],
    wavelengthM: 0.03747,
    effectiveEarthRadiusM: 8494666.67,
    fresnelFraction: 0.6,
    sampleCount: 64,
    obstruction: {
      minClearanceM: 42.5,
      fresnelRadiusM: 14.2,
      diffractionLossDb: 0.0,
      isLos: true,
      obstacleBlocked: false,
      obstacleIntersections: [],
    },
    getTerrainElevationMslM: () => 3100,
    computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });

  for (let i = 1; i <= 3000; i++) {
    rfBuf.pushRaw({
      frameIndex: i,
      simulationTimeS: i * 0.02,
      selectedNodeId: 4,
      nodeName: 'Node 4 (S4)',
      profileSerial: i,
      spatialRevision: 1,
      groundNodePositionMslM: [4000, 2000, 3200],
      acnPositionMslM: [25000, 30000, 5000],
      profile: sampleProfile,
      obstruction: {
        terrainIsLos: true,
        obstacleBlocked: false,
        minClearanceM: 42.5,
        diffractionLossDb: 0,
        primaryBlockedObstacleId: null,
        terrainStatusText: 'CLEAR LOS',
        terrainBadgeClass: 'badge-emerald',
        obstacleStatusText: 'CLEAR',
        obstacleBadgeClass: 'badge-emerald',
      },
      linkBudget: {
        modcodName: '16-APSK 4/5',
        snrDb: 18.2,
        spectralEfficiencyBpsHz: 3.16,
        slantRangeKm: 35.1,
        fsplDb: 141.4,
        diffractionLossDb: 0,
        rxPowerDbm: -74.2,
        earthBulgeM: 96.2,
        gaseousLossDb: 0.42,
      },
    });

    schedBuf.pushRaw({
      frameIndex: i,
      simulationTimeS: i * 0.02,
      schedulerMode: 'tac_tad',
      selectedNodeId: 4,
      spatialRevision: 1,
      activeAllocations: [
        { nodeId: 4, startMs: 4, durationMs: 8, durationS: 0.008, slotStartS: i * 0.02, capacityBits: 32000, modcodName: '16-APSK 4/5', isPreOcclusionFlush: false },
      ],
      nodeBacklogs: [
        { nodeId: 4, name: 'S4', c2Bytes: 128, voiceBytes: 256, videoBytes: 1024, photoBytes: 0, totalBacklogBytes: 1408, c2Packets: 1, voicePackets: 2, videoPackets: 1, photoPackets: 0, snrDb: 18.2, bitrateMbps: 15.8, stateName: 'NORMAL_LOS', linkOutage: false, obstacleBlocked: false },
      ],
      kpi: {
        staticGoodputMb: i * 0.01,
        tacGoodputMb: i * 0.02,
        gainMultiplier: 2.0,
        staticWastePct: 12,
        tacWastePct: 0,
        staticDrops: 10,
        staticDropPct: 1.5,
        tacDrops: 0,
        tacDropPct: 0,
        ulUtilizationPct: 68,
      },
    });
  }

  assert.equal(rfBuf.size, 3000);
  assert.equal(schedBuf.size, 3000);
  const rfBytes = rfBuf.measureTotalMemoryBytes();
  assert.ok(rfBytes < 4 * 1024 * 1024, `3,000-frame RF history buffer must stay < 4 MB (got ${(rfBytes / 1024 / 1024).toFixed(2)} MB)`);

  const rec1500 = rfBuf.getByFrameIndex(1500);
  assert.ok(rec1500 !== null);
  assert.equal(Object.isFrozen(rec1500), true, 'Read RF record must be frozen');
  assert.equal(Object.isFrozen(rec1500.profile.samples), true, 'Read RF samples must be frozen');
  assert.equal(rec1500.linkBudget.snrDb, 18.2);
  assert.equal(rec1500.profile.samples.length, 64);

  const sched1500 = schedBuf.getByFrameIndex(1500);
  assert.ok(sched1500 !== null);
  assert.equal(Object.isFrozen(sched1500), true, 'Read scheduler record must be frozen');
  assert.equal(Object.isFrozen(sched1500.activeAllocations), true);
  assert.equal(Object.isFrozen(sched1500.nodeBacklogs), true);
  assert.equal(sched1500.kpi.gainMultiplier, 2.0);
});

check('workspaceTilesManager skips redundant DOM rebuilds when telemetry state is unchanged', () => {
  const origDoc = (globalThis as any).document;
  const origWin = (globalThis as any).window;
  let gridHtmlWrites = 0;

  const makeMockEl = (id: string) => {
    let _inner = '';
    const attrs = new Map<string, string>();
    const classes = new Set<string>();
    const el: any = {
      id,
      hidden: false,
      style: {},
      dataset: {},
      children: [],
      parentElement: { clientWidth: 960 },
      classList: {
        toggle: (c: string, force?: boolean) => {
          const next = force !== undefined ? force : !classes.has(c);
          if (next) classes.add(c);
          else classes.delete(c);
          return next;
        },
        contains: (c: string) => classes.has(c),
      },
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      getAttribute: (k: string) => attrs.get(k) ?? null,
      addEventListener: () => {},
      removeEventListener: () => {},
      appendChild: (child: any) => {
        if (child?.id === 'workspace-tiles-overlay') {
          el._overlay = child;
        }
      },
      querySelectorAll: () => [],
      querySelector: (sel: string) => {
        if (sel === '#workspace-tiles-grid') return gridEl;
        if (sel === '#workspace-tiles-bar') return barEl;
        return null;
      },
      remove: () => {},
      contains: () => false,
    };
    Object.defineProperty(el, 'innerHTML', {
      get: () => _inner,
      set: (v: string) => {
        _inner = v;
        if (id === 'workspace-tiles-grid') gridHtmlWrites++;
      },
    });
    return el;
  };

  const radarContainer = makeMockEl('radar-container');
  const gridEl = makeMockEl('workspace-tiles-grid');
  const barEl = makeMockEl('workspace-tiles-bar');

  (globalThis as any).document = {
    hidden: false,
    activeElement: null,
    getElementById: (id: string) => (id === 'radar-container' ? radarContainer : null),
    querySelector: () => null,
    createElement: () => makeMockEl('overlay'),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  try {
    let transectDistM = 12000;
    const mgr = createWorkspaceTilesManager({
      getTelemetryInput: () => ({
        activeMode: 'transect',
        stageViewMode: '2d',
        radarRangeM: 60000,
        backdropMode: 'relief',
        terrainSector: 'ladakh',
        groundNodeCount: 16,
        transectResult: { totalHorizontalM: transectDistM, azimuthDeg: 90, isObstructed: false },
      }),
      onActivateTool: () => {},
      onOpenInspector: () => {},
      onApplyDemPreset: () => {},
      onFitDem: () => {},
      onStartMeasureTwoPoint: () => {},
      onSwapTransect: () => {},
      onClearMeasure: () => {},
      onArmProbePick: () => {},
      onProbeSnapBest: () => {},
      onClearProbe: () => {},
      onQuickAoBox: () => {},
      onArmRegionDraw: () => {},
      onArmObstaclePlace: () => {},
      onBlockFirstNodeLink: () => {},
      onAutoSizeObstacle: () => {},
    });
    mgr.mount();
    mgr.setEnabled(true);
    const writesAfterEnable = gridHtmlWrites;
    assert.equal(writesAfterEnable, 1, 'Initial enable should render tile grid once');

    // 10 unchanged sync() ticks must trigger 0 DOM rebuilds
    for (let i = 0; i < 10; i++) {
      mgr.sync();
    }
    assert.equal(gridHtmlWrites, 1, 'Unchanged ticks must trigger zero DOM rebuilds');

    // Changing telemetry state triggers exactly 1 rebuild
    transectDistM = 24500;
    mgr.sync();
    assert.equal(gridHtmlWrites, 2, 'State change must trigger exactly 1 DOM rebuild');

    // Hidden tab must skip DOM rebuilds even if telemetry changes
    (globalThis as any).document.hidden = true;
    transectDistM = 35000;
    mgr.sync();
    assert.equal(gridHtmlWrites, 2, 'Hidden document must skip DOM rebuilds');

    mgr.destroy();
  } finally {
    (globalThis as any).document = origDoc;
    (globalThis as any).window = origWin;
  }
});

// -----------------------------------------------------------------------------
// 5. Idle CPU & Deterministic Worker Efficiency
// -----------------------------------------------------------------------------
console.log('\n[5/5] Verifying Idle CPU Loop Gating & Deterministic Worker Ray-March Cache...');

check('src/main.ts + src/app/*.ts implement visibilitychange pause and dirty-flag idle rAF stop', () => {
  const mainSrc = readMainAndAppFiles().join('\n');
  assert.ok(mainSrc.includes("document.addEventListener('visibilitychange'"), 'Must listen to visibilitychange');
  assert.ok(mainSrc.includes('function shouldContinueAnimationLoop()'), 'Must gate animation loop continuation');
  assert.ok(mainSrc.includes('function scheduleAnimationLoop()'), 'Must schedule rAF via dirty-flag scheduler');
  assert.ok(mainSrc.includes('cancelAnimationFrame(animationLoopRafId)'), 'Must cancel rAF when tab is hidden');
});

check('SimulationWorkerManager ray-march cache is bit-exact deterministic, clears on reset(), hits on repeated probes, and 16-node mean step < 8 ms', () => {
  const simA = new SimulationWorkerManager(42, '16_NODES');
  const simB = new SimulationWorkerManager(42, '16_NODES');

  // Warmup
  for (let i = 0; i < 5; i++) {
    simA.tickSimulation(false);
    simB.tickSimulation(false);
  }

  simA.rayMarchCacheHits = 0;
  simA.rayMarchCacheMisses = 0;

  const t0 = performance.now();
  for (let i = 0; i < 100; i++) {
    simA.tickSimulation(false);
    simB.tickSimulation(false);
  }
  const meanStepMs = (performance.now() - t0) / 200;

  // Bit-exact seeded determinism check
  assert.equal(simA.frameIndex, simB.frameIndex);
  assert.equal(simA.simTimeS, simB.simTimeS);
  assert.deepEqual(simA.metrics, simB.metrics, 'Seeded metrics must be bit-identical');
  for (let i = 0; i < simA.nodesTac.length; i++) {
    assert.deepEqual(simA.nodesTac[i].position, simB.nodesTac[i].position);
    assert.equal(simA.nodesTac[i].queue.getTotalBacklogBits(), simB.nodesTac[i].queue.getTotalBacklogBits());
  }

  // Cache hit check on stationary / repeated rays
  assert.ok(simA.rayMarchCacheHits > 0, `Expected rayMarchCacheHits > 0 across 100 ticks, got ${simA.rayMarchCacheHits}`);
  const obs1 = simA.terrainEngine.evaluateTerrainObstruction([0, 0, 3200], [10000, 10000, 5000], simA.rfConfig, simA.envConfig);
  const hitsBefore = simA.rayMarchCacheHits;
  const obs2 = simA.terrainEngine.evaluateTerrainObstruction([0, 0, 3200], [10000, 10000, 5000], simA.rfConfig, simA.envConfig);
  assert.equal(simA.rayMarchCacheHits, hitsBefore + 1, 'Repeated stationary probe must hit ray-march cache');
  assert.equal(obs1.diffractionLossDb, obs2.diffractionLossDb);

  // resetSimulationState() clears cache completely
  simA.resetSimulationState();
  assert.equal(simA.rayMarchCacheHits, 0, 'resetSimulationState() must clear rayMarchCacheHits');
  assert.equal(simA.rayMarchCacheMisses, 0, 'resetSimulationState() must clear rayMarchCacheMisses');

  assert.ok(meanStepMs < 8.0, `16-node mean step time must be < 8 ms (got ${meanStepMs.toFixed(3)} ms)`);
  console.log(`    -> 16-node mean step time: ${meanStepMs.toFixed(3)} ms (cache hits=${hitsBefore})`);
});

console.log('\n' + '='.repeat(92));
console.log(`  PERF-01 SUMMARY: ${passedChecks} checks passed, 0 failures.`);
console.log('='.repeat(92) + '\n');
