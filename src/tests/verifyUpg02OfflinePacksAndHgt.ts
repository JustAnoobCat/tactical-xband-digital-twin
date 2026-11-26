/**
 * Verification Suite 133 (UPG-02):
 * Fast 500+ HGT Manager (Cancel / Unload / Free RAM), Persistent Offline
 * Mission Packs (OPFS/IndexedDB + Tauri) & 9 Mentor Edge-Case Fixes
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildTileCatalog,
  clusterNeighbouringTiles,
  selectActivePatch,
  stitchHgtTiles,
  decodeAndStitchPatchAsync,
  DecodedTileCache,
  type DecodedTile,
} from '../core/hgtMosaic';
import {
  parseHgtBuffer,
  SRTM3_BYTE_LENGTH,
  SRTM1_SAMPLE_COUNT,
  HGT_METERS_PER_DEG_LON,
  THEATER_ORIGIN_LAT_DEG,
} from '../core/hgtParser';
import { OfflineMissionPackStore } from '../core/offlineMissionPackStore';
import { parseOfflineTileRequestUrl } from '../core/offlineTileProtocol';
import { WorldTileLayer } from '../ui/worldTileLayer';
import {
  parseGeoTiffDem,
  exportMissionToAtakCotXml,
  MAX_GEOTIFF_PIXELS,
} from '../core/militaryGisEngine';
import { initMissionIoController } from '../ui/controllers/missionIoController';
import { buildOptimizedTerrainGeometrySet } from '../ui/three/terrainRenderer';
import { NodeLifecycleManager } from '../worker/nodeLifecycleManager';
import { SimulationWorkerManager } from '../worker/simWorker';
import { createDefault16NodeRegistry } from '../core/nodeRegistry';
import { TerrainEngine } from '../core/terrain';

const ROOT_DIR = process.cwd();
let passed = 0;

async function runCheck(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${label}`);
    throw err;
  }
}

function buildSyntheticGeoTiff(options: {
  width: number;
  height: number;
  format: 'float32' | 'int16';
  elevationAt: (r: number, c: number) => number;
}): ArrayBuffer {
  const { width, height, format, elevationAt } = options;
  const isFloat = format === 'float32';
  const bps = isFloat ? 32 : 16;
  const bpp = bps / 8;
  const sampleFormat = isFloat ? 3 : 2;
  const numEntries = 8;
  const headerSize = 8;
  const ifdSize = 2 + numEntries * 12 + 4;
  const pixelOffset = headerSize + ifdSize + ((4 - ((headerSize + ifdSize) % 4)) % 4);
  const pixelBytes = width * height * bpp;
  const buf = new ArrayBuffer(pixelOffset + pixelBytes);
  const view = new DataView(buf);

  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, headerSize, true);

  let cur = headerSize;
  view.setUint16(cur, numEntries, true);
  cur += 2;
  const writeTag = (tag: number, type: number, count: number, val: number) => {
    view.setUint16(cur, tag, true);
    view.setUint16(cur + 2, type, true);
    view.setUint32(cur + 4, count, true);
    if (type === 3) {
      view.setUint16(cur + 8, val, true);
      view.setUint16(cur + 10, 0, true);
    } else {
      view.setUint32(cur + 8, val, true);
    }
    cur += 12;
  };
  writeTag(256, 4, 1, width);
  writeTag(257, 4, 1, height);
  writeTag(258, 3, 1, bps);
  writeTag(259, 3, 1, 1);
  writeTag(273, 4, 1, pixelOffset);
  writeTag(278, 4, 1, height);
  writeTag(279, 4, 1, pixelBytes);
  writeTag(339, 3, 1, sampleFormat);
  view.setUint32(cur, 0, true);

  let idx = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const val = elevationAt(r, c);
      if (isFloat) {
        view.setFloat32(pixelOffset + idx * 4, val, true);
      } else {
        view.setInt16(pixelOffset + idx * 2, Math.round(val), true);
      }
      idx++;
    }
  }
  return buf;
}

function buildOversizedHeaderGeoTiff(width: number, height: number): ArrayBuffer {
  const buf = new ArrayBuffer(128);
  const view = new DataView(buf);
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 6, true);
  let cur = 10;
  const writeTag = (tag: number, type: number, count: number, val: number) => {
    view.setUint16(cur, tag, true);
    view.setUint16(cur + 2, type, true);
    view.setUint32(cur + 4, count, true);
    view.setUint32(cur + 8, val, true);
    cur += 12;
  };
  writeTag(256, 4, 1, width);
  writeTag(257, 4, 1, height);
  writeTag(258, 3, 1, 16);
  writeTag(259, 3, 1, 1);
  writeTag(273, 4, 1, 100);
  writeTag(339, 3, 1, 2);
  view.setUint32(cur, 0, true);
  return buf;
}

async function main(): Promise<void> {
  console.log('================================================================================');
  console.log('  SUITE 133 (UPG-02): 500+ HGT, OFFLINE PACKS & 9 MENTOR EDGE-CASE FIXES');
  console.log('================================================================================');

  // 1. 520-tile HGT catalog, O(N) BFS clustering, bounded SRTM1, AbortSignal, Unload & non-Ladakh centering
  await runCheck('1a. 520-tile HGT folder catalog + O(N) clustering completes in < 50 ms', () => {
    const files: Array<{ name: string; size: number }> = [];
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < 26; c++) {
        const lat = 15 + r;
        const lon = 65 + c;
        files.push({
          name: `N${String(lat).padStart(2, '0')}E${String(lon).padStart(3, '0')}.hgt`,
          size: SRTM3_BYTE_LENGTH,
        });
      }
    }
    assert.equal(files.length, 520);
    const t0 = performance.now();
    const catalog = buildTileCatalog(files);
    const clusters = clusterNeighbouringTiles(catalog);
    const elapsedMs = performance.now() - t0;
    assert.equal(catalog.length, 520);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].tiles.length, 520);
    assert.ok(elapsedMs < 50, `Expected 520-tile catalog+cluster < 50 ms, took ${elapsedMs.toFixed(2)} ms`);
  });

  await runCheck('1b. Multi-tile SRTM1 mosaic bounds output grid <= 1024 (memory < 16 MB)', () => {
    const makeSrtm1Tile = (name: string, minLat: number, minLon: number): DecodedTile => ({
      tileName: name,
      minLatDeg: minLat,
      maxLatDeg: minLat + 1,
      minLonDeg: minLon,
      maxLonDeg: minLon + 1,
      sampleCount: SRTM1_SAMPLE_COUNT,
      elevations: new Float32Array(SRTM1_SAMPLE_COUNT * SRTM1_SAMPLE_COUNT).fill(3800),
      minElevationM: 3800,
      maxElevationM: 3800,
      voidCount: 0,
    });
    const t1 = makeSrtm1Tile('N34E076', 34, 76);
    const t2 = makeSrtm1Tile('N34E077', 34, 77);
    const t3 = makeSrtm1Tile('N35E076', 35, 76);
    const t4 = makeSrtm1Tile('N35E077', 35, 77);
    const mosaic = stitchHgtTiles([t1, t2, t3, t4]);
    assert.ok(mosaic.rasterWidth <= 1024 && mosaic.rasterHeight <= 1024, `Expected <= 1024, got ${mosaic.rasterWidth}x${mosaic.rasterHeight}`);
    assert.ok(mosaic.elevations.byteLength < 16 * 1024 * 1024, `Expected < 16 MB, got ${mosaic.elevations.byteLength}`);
    assert.ok(Math.abs(mosaic.elevations[0] - 3800) < 1e-3);
  });

  await runCheck('1c. AbortSignal cancels async HGT patch decode cleanly', async () => {
    const mockBuf = new ArrayBuffer(SRTM3_BYTE_LENGTH);
    let reads = 0;
    const files = ['N34E076.hgt', 'N34E077.hgt', 'N35E076.hgt', 'N35E077.hgt'].map((name) => ({
      name,
      size: SRTM3_BYTE_LENGTH,
      arrayBuffer: async () => {
        reads++;
        return mockBuf;
      },
    }));
    const catalog = buildTileCatalog(files as unknown as File[]);
    const patch = selectActivePatch({ catalog, targetLatDeg: 34.5, targetLonDeg: 76.5, maxTiles: 4 })!;
    const ac = new AbortController();
    const cache = new DecodedTileCache(12);
    let abortedErr: unknown = null;
    try {
      await decodeAndStitchPatchAsync(patch, {
        signal: ac.signal,
        cache,
        onProgress: (loaded) => {
          if (loaded >= 1) ac.abort();
        },
      });
    } catch (err) {
      abortedErr = err;
    }
    assert.ok(abortedErr instanceof Error && abortedErr.name === 'AbortError', 'Expected AbortError on cancel');
    assert.ok(reads < 4, `Expected early cancel before reading all 4 tiles, reads=${reads}`);
  });

  await runCheck('1d. UNLOAD_CUSTOM_TERRAIN on SimulationWorkerManager frees custom DEM & restores biome DEM', () => {
    const worker = new SimulationWorkerManager(2026, '16_NODES');
    worker.handleMessage({ type: 'SET_BIOME', biomeId: 'arid_desert' });
    const customElev = new Float32Array(512 * 512).fill(4999);
    const loadRes = worker.handleMessage({
      type: 'LOAD_CUSTOM_DEM',
      elevations: customElev,
      metadata: {
        rasterWidth: 512,
        rasterHeight: 512,
        centerLatDeg: 27.5,
        centerLonDeg: 71.5,
        minLatDeg: 27,
        maxLatDeg: 28,
        minLonDeg: 71,
        maxLonDeg: 72,
        halfWidthM: 49400,
        halfHeightM: 55465,
        groundResolutionXM: 193,
        groundResolutionYM: 217,
        minX: -49400,
        maxX: 49400,
        minY: -55465,
        maxY: 55465,
        tileName: 'CUSTOM_TEST',
        minElevationM: 4999,
        maxElevationM: 4999,
        voidCount: 0,
      },
    });
    assert.equal(loadRes.accepted, true);
    assert.equal(worker.getTerrainBounds().tileName, 'CUSTOM_TEST');
    assert.ok(Math.abs(worker.terrainEngine.getElevation(0, 0) - 4999) < 1);

    const unloadRes = worker.handleMessage({ type: 'UNLOAD_CUSTOM_TERRAIN' });
    assert.equal(unloadRes.accepted, true);
    assert.equal(worker.getTerrainBounds().tileName, 'THAR_DESERT');
    assert.notEqual(worker.terrainEngine.realDemGrid, customElev);
    assert.ok(worker.terrainEngine.getElevation(0, 0) < 500, 'Restored Thar Desert elevation < 500 m');
  });

  await runCheck('1e. Single non-Ladakh HGT (N27E071.hgt) centers at (0, 0) with cos(27.5 deg) scaling', () => {
    const buf = new ArrayBuffer(SRTM3_BYTE_LENGTH);
    const dv = new DataView(buf);
    for (let i = 0; i < 1201 * 1201; i++) dv.setInt16(i * 2, 240, false);
    const parsed = parseHgtBuffer('N27E071.hgt', buf);
    assert.equal(parsed.success, true);
    const meta = parsed.metadata!;
    const cx = (meta.minX! + meta.maxX!) * 0.5;
    const cy = (meta.minY! + meta.maxY!) * 0.5;
    assert.ok(Math.abs(cx) < 1e-6, `Expected center X === 0, got ${cx}`);
    assert.ok(Math.abs(cy) < 1e-6, `Expected center Y === 0, got ${cy}`);
    const expectedSpanX =
      (HGT_METERS_PER_DEG_LON / Math.cos((THEATER_ORIGIN_LAT_DEG * Math.PI) / 180)) *
      Math.cos((27.5 * Math.PI) / 180);
    assert.ok(Math.abs((meta.maxX! - meta.minX!) - expectedSpanX) < 0.01);
  });

  // 2. OfflineMissionPackStore + offlineTileProtocol.ts
  await runCheck('2a. OfflineMissionPackStore save/list/load/delete/clear lifecycle & extension allowlist', async () => {
    const store = new OfflineMissionPackStore({ backend: 'memory' });
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    await store.savePack('N27E071.hgt', 'hgt', payload);
    await store.savePack('mission.json', 'scenario', new TextEncoder().encode('{"ok":true}'));
    let packs = await store.listPacks();
    assert.equal(packs.length, 2);
    const loaded = await store.loadPack('N27E071.hgt');
    assert.ok(loaded && loaded.bytes.length === 5 && loaded.bytes[4] === 5);

    await assert.rejects(() => store.savePack('../evil.hgt', 'hgt', payload));
    await assert.rejects(() => store.savePack('bad.exe', 'hgt', payload));

    assert.equal(await store.deletePack('N27E071.hgt'), true);
    assert.equal((await store.listPacks()).length, 1);
    await store.clearAll();
    assert.equal((await store.listPacks()).length, 0);
  });

  await runCheck('2b. offlineTileProtocol.ts accepts .pmtiles archive URLs while rejecting ../', () => {
    const okArchive = parseOfflineTileRequestUrl('xband-tile://ladakh.pmtiles');
    assert.equal(okArchive.ok, true);
    if (okArchive.ok) {
      assert.equal(okArchive.ext, 'pmtiles');
      assert.equal(okArchive.relativePath, 'ladakh.pmtiles');
    }
    const okSubdir = parseOfflineTileRequestUrl('xband-tile://packs/N27E071.hgt');
    assert.equal(okSubdir.ok, true);
    assert.equal(parseOfflineTileRequestUrl('xband-tile://packs/../secret.pmtiles').ok, false);
    assert.equal(parseOfflineTileRequestUrl('xband-tile://terrain/10/732.png').ok, false);
  });

  // 3. WorldTileLayer canvas collapse & stale loadGeneration guard
  await runCheck('3. WorldTileLayer collapses evicted canvases & ignores stale loadGeneration callbacks', () => {
    const origImage = (globalThis as Record<string, unknown>).Image;
    const createdImages: Array<{
      onload: (() => void) | null;
      onerror: (() => void) | null;
      src: string;
      naturalWidth: number;
      naturalHeight: number;
    }> = [];
    (globalThis as Record<string, unknown>).Image = class {
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public src = '';
      public naturalWidth = 256;
      public naturalHeight = 256;
      public crossOrigin = '';
      constructor() {
        createdImages.push(this);
      }
    };

    try {
      const layer = new WorldTileLayer({
        allowExternalTiles: true,
        airGapOfflineOnly: false,
        renderMode: 'raster',
        maxCacheSize: 5,
      });
      let notifications = 0;
      const ctx = {
        save() {},
        restore() {},
        drawImage() {},
        imageSmoothingEnabled: true,
        globalAlpha: 1,
      } as unknown as CanvasRenderingContext2D;
      layer.draw(ctx, { width: 800, height: 600, rangeM: 60000 }, () => {
        notifications++;
      });
      assert.ok(createdImages.length > 0, 'Expected in-flight tile Image objects');

      // Change origin -> increments loadGeneration; old onload must be ignored
      layer.setOrigin(27.0, 71.5);
      const staleImg = createdImages[0];
      staleImg.onload?.();
      assert.equal(notifications, 0, 'Stale loadGeneration callback must be discarded');

      // Verify clear() collapses canvas backing dimensions
      const mockCanvas = { width: 256, height: 256, getContext: () => ({}) };
      (layer as unknown as { cache: Map<string, unknown> }).cache.set('8/182/102', {
        status: 'loaded',
        source: mockCanvas,
        width: 256,
        height: 256,
        lastUsed: 1,
      });
      layer.clear();
      assert.equal(mockCanvas.width, 0, 'Evicted/cleared canvas width must collapse to 0');
      assert.equal(mockCanvas.height, 0, 'Evicted/cleared canvas height must collapse to 0');
    } finally {
      (globalThis as Record<string, unknown>).Image = origImage;
    }
  });

  // 4. GeoTIFF OOM + void-fill, CoT stale, Scenario JSON lossless round-trip
  await runCheck('4a. parseGeoTiffDem rejects > 16M pixels and interpolates -32768 NoData without 0m cliffs', () => {
    const huge = buildOversizedHeaderGeoTiff(5000, 5000);
    assert.ok(5000 * 5000 > MAX_GEOTIFF_PIXELS);
    const hugeRes = parseGeoTiffDem(huge);
    assert.equal(hugeRes.ok, false);
    assert.ok(hugeRes.error?.includes('MAX_GEOTIFF_PIXELS'));

    const alpineVoid = buildSyntheticGeoTiff({
      width: 3,
      height: 3,
      format: 'int16',
      elevationAt: (r, c) => (r === 1 && c === 1 ? -32768 : 4200),
    });
    const parsed = parseGeoTiffDem(alpineVoid);
    assert.equal(parsed.ok, true);
    assert.ok(Math.abs(parsed.elevationsM![4] - 4200) < 1e-3, `Expected interpolated 4200m, got ${parsed.elevationsM![4]}`);
    assert.equal(parsed.minElevationM, 4200);
  });

  await runCheck('4b. exportMissionToAtakCotXml computes stale = timestampIso + 5 min', () => {
    const xml = exportMissionToAtakCotXml({
      timestampIso: '2026-11-26T10:00:00.000Z',
      missionTitle: 'Test Op',
      entities: [{ id: 'ACN-1', callsign: 'VIPER-01', role: 'ACN', latDeg: 27.0, lonDeg: 71.5, altMslM: 5000 }],
    });
    assert.ok(xml.includes('time="2026-11-26T10:00:00.000Z"'));
    assert.ok(xml.includes('stale="2026-11-26T10:05:00.000Z"'));
  });

  await runCheck('4c. exportScenarioJson + applyScenarioJson round-trips Thar Desert, jammer, rain, hover 0 m/s & convoy', () => {
    const dispatched: Array<{ type: string; [k: string]: unknown }> = [];
    const frameSnapshot = {
      biome_id: 'arid_desert' as const,
      jammer_enabled: true,
      jammer_eirp_dbm: 70.0,
      rain_rate_mmh: 12.5,
      rician_fading_enabled: true,
      active_relay_enabled: true,
      traffic_load_multiplier: 2.0,
      selected_link_budget: { channel_bandwidth_hz: 5.0e6 },
      trajectory_config: {
        trajectory_mode: 'ellipse' as const,
        loiter_speed_mps: 0,
      },
      acn_telemetry: { altitude_msl_m: 4500, target_speed_mps: 0, current_speed_mps: 0 },
      nodes_telemetry: [
        { node_id: 0, name: 'CONVOY-1', node_type: 'convoy', x_m: 1200, y_m: -800, agl_m: 3.5, tactical_priority: 2, tx_power_dbm: 41 },
        { node_id: 15, name: 'MCP', node_type: 'mcp', x_m: 0, y_m: 0, agl_m: 6.0, tactical_priority: 1, tx_power_dbm: 43 },
      ],
    };

    const ctrl = initMissionIoController({
      getActiveBiomeId: () => 'arid_desert',
      getLatestTelemetry: () => frameSnapshot,
      postWorkerCommand: (cmd) => dispatched.push(cmd as unknown as { type: string; [k: string]: unknown }),
    });

    const jsonStr = ctrl.exportScenarioJson();
    const parsed = JSON.parse(jsonStr);
    assert.ok(
      parsed.title.includes('Thar') && parsed.title.includes('Desert') && !parsed.title.includes('Ladakh'),
      `Expected Thar Desert title, got "${parsed.title}"`
    );
    assert.equal(parsed.acn.cruiseAirspeedMs, 0);
    assert.equal(parsed.rfConfig.jammer_enabled, true);
    assert.equal(parsed.rfConfig.rain_rate_mmh, 12.5);
    assert.equal(parsed.nodes[0].role, 'convoy');
    assert.equal(parsed.nodes[0].tx_power_dbm, 41);

    const applyRes = ctrl.applyScenarioJson(jsonStr);
    assert.equal(applyRes.ok, true);
    const cfgCmd = dispatched.find((c) => c.type === 'CONFIG_UPDATE');
    assert.ok(cfgCmd && (cfgCmd.params as Record<string, unknown>).loiter_speed_mps === 0);
    assert.equal((cfgCmd!.params as Record<string, unknown>).rain_rate_mmh, 12.5);
    assert.equal((cfgCmd!.params as Record<string, unknown>).channel_bandwidth_mhz, 5.0);
    const sciCmd = dispatched.find((c) => c.type === 'SET_SCIENTIFIC_PARAMS');
    assert.ok(sciCmd && sciCmd.jammerEnabled === true && sciCmd.ricianFadingEnabled === true && sciCmd.activeRelayEnabled === true);
    const updateConvoy = dispatched.find((c) => c.type === 'NODE_UPDATE' && c.node_id === 0);
    assert.ok(updateConvoy && updateConvoy.role === 'convoy' && updateConvoy.tx_power_dbm === 41);
  });

  // 5. Dynamic 3D skirt, NodeLifecycleManager convoy + biome fallback, CSP & simWorker line cap
  await runCheck('5a. terrainRenderer places Thar Desert skirt base strictly below minElevationM', () => {
    const minElev = 180;
    const elevations = new Float32Array(512 * 512).fill(minElev);
    const geomSet = buildOptimizedTerrainGeometrySet(
      {
        terrainMode: 'real',
        bounds: {
          rasterWidth: 512,
          rasterHeight: 512,
          minX: -50000,
          maxX: 50000,
          minY: -50000,
          maxY: 50000,
          halfWidthM: 50000,
          halfHeightM: 50000,
          centerLatDeg: 27.0,
          centerLonDeg: 71.5,
          minLatDeg: 26.5,
          maxLatDeg: 27.5,
          minLonDeg: 71.0,
          maxLonDeg: 72.0,
          groundResolutionXM: 200,
          groundResolutionYM: 200,
          tileName: 'THAR_DESERT',
        },
        gridSize: 512,
        minElevationM: minElev,
        maxElevationM: 310,
        elevations,
      },
      'fast128'
    );
    const posAttr = geomSet.skirtGeometry.getAttribute('position');
    let minYThree = Infinity;
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      if (y < minYThree) minYThree = y;
    }
    assert.ok(minYThree < minElev, `Expected skirt base (${minYThree}) < minElevationM (${minElev})`);
    geomSet.meshGeometry.dispose();
    geomSet.skirtGeometry.dispose();
  });

  await runCheck('5b. NodeLifecycleManager accepts convoy role and uses biome fallback instead of 3500m', () => {
    const terrain = new TerrainEngine({ terrainMode: 'real', activeBiomeId: 'arid_desert' });
    const registry = createDefault16NodeRegistry();
    const { nodesStatic, nodesTac, nodesReactive } = NodeLifecycleManager.initNodes(registry, terrain);
    const outcome = NodeLifecycleManager.updateNode({
      msg: { type: 'NODE_UPDATE', node_id: 0, role: 'convoy', x_m: 100, y_m: 100 },
      nodesStatic,
      nodesTac,
      nodesReactive,
      nodeRegistry: registry,
      terrainEngine: terrain,
      spatialLocked: false,
    });
    assert.equal(outcome.accepted, true);
    assert.equal(nodesStatic[0].nodeType as string, 'convoy');

    // Out-of-coverage NaN coordinate fallback on Thar Desert must stay near ~245m, NOT 3500m
    nodesStatic[0].position = [999999, 999999, Number.NaN];
    NodeLifecycleManager.resampleGroundNodeAltitudes(nodesStatic, nodesTac, registry, terrain, nodesReactive);
    assert.ok(nodesStatic[0].position[2] < 500, `Expected Thar fallback < 500m, got ${nodesStatic[0].position[2]}`);
  });

  await runCheck('5c. index.html maintains strict CSP & simWorker.ts < 3,250 lines', () => {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    const inlineHandlers = [...html.matchAll(/\son[a-z]+\s*=/gi)];
    assert.equal(inlineHandlers.length, 0, 'index.html must have zero inline on*= handlers');
    const inlineScriptMatch = html.match(/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi);
    assert.equal(inlineScriptMatch, null, 'index.html must have zero inline <script> bodies');

    const simWorkerLines = fs.readFileSync(path.join(ROOT_DIR, 'src/worker/simWorker.ts'), 'utf8').split('\n').length;
    assert.ok(simWorkerLines < 3250, `simWorker.ts (${simWorkerLines} lines) must remain < 3,250 lines`);
  });

  console.log(`\nUPG-02 SUITE 133 SUMMARY: ${passed} checks passed, 0 failures.`);
}

main().catch((err) => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});
