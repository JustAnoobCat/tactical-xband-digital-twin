import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EnvironmentConfig, RFConfig } from '../core/config';
import { computeKnifeEdgeDiffractionLossDb } from '../core/rfPropagationMath';
import { REAL_LADAKH_DEM_METADATA, TerrainEngine } from '../core/terrain';
import { NUM_AZIMUTHS, NUM_RANGES, PolarViewshedEngine, TOTAL_VIEWSHED_CELLS } from '../core/viewshedEngine';
import {
  initWasmPhysicsSync,
  isWasmPhysicsReady,
  wasmComputePolarViewshed,
  wasmComputePolarViewshedSlice,
  wasmEvaluateBatchRays,
  wasmGenerateHillshadeRgba,
  wasmKnifeEdgeLossDb,
} from '../core/wasmPhysicsBridge';
import { HillshadeGenerator } from '../worker/hillshadeGenerator';
import { buildTileCatalog, clusterNeighbouringTiles } from '../core/hgtMosaic';
import { SRTM3_BYTE_LENGTH } from '../core/hgtParser';
import { OfflineMissionPackStore } from '../core/offlineMissionPackStore';
import { MAX_GEOTIFF_PIXELS, parseGeoTiffDem } from '../core/militaryGisEngine';
import { SpatialSnapshotBuffer } from '../ui/spatialSnapshotBuffer';
import { evaluateWorkerRealTimeProfile } from '../core/workerJitterProfiler';
import { NodeTerrainState } from '../core/trajectory';
import type { Position3D } from '../shared/types';
import type { SpatialFrameSnapshot } from '../shared/workerProtocol';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(currentDir, '../..');

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
      if (isFloat) view.setFloat32(pixelOffset + idx * 4, val, true);
      else view.setInt16(pixelOffset + idx * 2, Math.round(val), true);
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

describe('Compiled WASM Parity, 520-Tile HGT, Offline Packs, GeoTIFF, SpatialBuffer & Jitter', () => {
  it('loads compiled xband_physics_bg.wasm and verifies exact parity on J(v), Ladakh ray-march, Hillshade & full/slice Viewshed', () => {
    const wasmPath = path.resolve(ROOT_DIR, 'src/wasm/xband_physics/xband_physics_bg.wasm');
    const demPath = path.resolve(ROOT_DIR, 'public/terrain/real_ladakh_dem.bin');
    expect(fs.existsSync(wasmPath)).toBe(true);
    expect(fs.existsSync(demPath)).toBe(true);

    const wasmBytes = fs.readFileSync(wasmPath);
    const demBuf = fs.readFileSync(demPath);
    const demGrid = new Float32Array(demBuf.buffer, demBuf.byteOffset, 512 * 512);
    const meta = REAL_LADAKH_DEM_METADATA;
    const minX = meta.minX ?? -meta.halfWidthM;
    const maxX = meta.maxX ?? meta.halfWidthM;
    const minY = meta.minY ?? -meta.halfHeightM;
    const maxY = meta.maxY ?? meta.halfHeightM;

    const terrain = new TerrainEngine({ terrainMode: 'real' });
    terrain.loadCustomDem(demGrid);
    const rf = new RFConfig();
    const env = new EnvironmentConfig({ rainRateMmH: 15.0, jammerEnabled: true });
    const acnPos: Position3D = [200.0, -350.0, 5200.0];
    const acnVel: Position3D = [45.0, 40.0, 0.0];
    const jammerBySector: readonly [number, number, number, number] = [-96.0, -104.0, -110.0, -94.0];

    // Capture pure-TS baselines before WASM initialization
    const tsHillshade = new HillshadeGenerator(terrain).generate(terrain, 512);
    const tsViewshed = new PolarViewshedEngine().computeFullViewshed(
      acnPos,
      acnVel,
      terrain,
      rf,
      env,
      undefined,
      jammerBySector,
      'fast'
    );
    const rays: number[] = [];
    const tsObs: ReturnType<TerrainEngine['evaluateTerrainObstruction']>[] = [];
    for (let i = 0; i < 32; i++) {
      const angle = (i * 2.0 * Math.PI) / 32.0;
      const rGround = 2500.0 + ((i * 7919) % 28000);
      const nx = rGround * Math.cos(angle);
      const ny = rGround * Math.sin(angle);
      const gz = terrain.getElevation(nx, ny);
      const nz = (Number.isFinite(gz) ? gz : 3500.0) + 2.0;
      const acnAngle = angle + (i % 3 === 0 ? 0.4 : 2.6);
      const rAcn = 4000.0 + (i % 5) * 3500.0;
      const ax = rAcn * Math.cos(acnAngle);
      const ay = rAcn * Math.sin(acnAngle);
      const az = 4200.0 + (i % 8) * 350.0;
      rays.push(nx, ny, nz, ax, ay, az);
      tsObs.push(terrain.evaluateTerrainObstruction([nx, ny, nz], [ax, ay, az], rf, env, 100.0, 0.0));
    }

    expect(initWasmPhysicsSync(wasmBytes)).toBe(true);
    expect(isWasmPhysicsReady()).toBe(true);

    // 1. J(v) parity
    for (let i = 0; i < 50; i++) {
      const v = -2.0 + (i / 49.0) * 7.0;
      const wVal = wasmKnifeEdgeLossDb(v);
      expect(wVal).not.toBeNull();
      expect(Math.abs(wVal! - computeKnifeEdgeDiffractionLossDb(v))).toBeLessThan(1e-6);
    }

    // 2. Ladakh DEM ray-march parity
    const wasmRays = wasmEvaluateBatchRays(
      demGrid,
      512,
      512,
      minX,
      maxX,
      minY,
      maxY,
      new Float64Array(rays),
      rf.wavelengthM,
      env.effectiveEarthRadiusM,
      100.0,
      0.0
    );
    expect(wasmRays).not.toBeNull();
    expect(wasmRays!.length).toBe(32 * 4);
    for (let i = 0; i < 32; i++) {
      const base = i * 4;
      expect(wasmRays![base] > 0.5).toBe(tsObs[i].isLos);
      expect(Math.abs(wasmRays![base + 1] - tsObs[i].diffractionLossDb)).toBeLessThan(0.05);
      expect(Math.abs(wasmRays![base + 2] - tsObs[i].minClearanceM)).toBeLessThan(0.5);
    }

    // 3. 512x512 Hillshade parity
    const wasmHs = wasmGenerateHillshadeRgba(demGrid, 512, 512, 512, minX, maxX, minY, maxY, meta.minElevationM ?? 0);
    expect(wasmHs).not.toBeNull();
    let rgbAbsErrSum = 0;
    for (let r = 0; r < 512; r++) {
      for (let c = 0; c < 512; c++) {
        const packed = tsHillshade.grid[r][c];
        const p = (r * 512 + c) * 4;
        rgbAbsErrSum +=
          Math.abs(wasmHs![p] - ((packed >> 16) & 255)) +
          Math.abs(wasmHs![p + 1] - ((packed >> 8) & 255)) +
          Math.abs(wasmHs![p + 2] - (packed & 255));
      }
    }
    expect(rgbAbsErrSum / (512 * 512 * 3)).toBeLessThan(1.5);

    // 4. Full + Slice Polar Viewshed parity
    const { txPowerDbm: sTx, antennaGainDbi: sGain } = rf.getTransmitterParams('soldier');
    const wasmParams = {
      numBearings: NUM_AZIMUTHS,
      numRanges: NUM_RANGES,
      rMinM: 1500.0,
      rStepM: 1500.0,
      acnPos,
      headingDeg: (Math.atan2(acnVel[0], acnVel[1]) * 180) / Math.PI,
      pitchDeg: 0.0,
      bankDeg: 0.0,
      carrierFreqHz: rf.carrierFrequencyHz,
      speedOfLight: rf.speedOfLight,
      channelBandwidthHz: rf.channelBandwidthHz,
      acnAntennaGainDbi: rf.acnAntennaGainDbi,
      acnNoiseFigureDb: rf.acnNoiseFigureDb,
      soldierTxPowerDbm: sTx,
      soldierAntennaGainDbi: sGain,
      cableLossDb: rf.cableLossDb,
      implementationMarginDb: rf.implementationMarginDb,
      boltzmannConstant: rf.boltzmannConstant,
      hpbwAzDeg: rf.acnSectorHpbwAzDeg ?? 90.0,
      hpbwElDeg: rf.acnSectorHpbwElDeg ?? 65.0,
      downtiltDeg: rf.acnSectorDowntiltDeg ?? -15.0,
      rEffM: env.effectiveEarthRadiusM,
      atmosphericTempK: env.atmosphericTemperatureK,
      rainRateMmH: env.rainRateMmH ?? 0.0,
      rainCellLengthKm: env.rainCellLengthKm ?? 10.0,
      freezingIsothermM: 4200.0,
      jammerEnabled: Boolean(env.jammerEnabled),
      jammerBySector,
    };

    const fullWasm = wasmComputePolarViewshed(demGrid, 512, 512, minX, maxX, minY, maxY, wasmParams);
    expect(fullWasm).not.toBeNull();
    let vsErrSum = 0;
    for (let i = 0; i < TOTAL_VIEWSHED_CELLS; i++) {
      vsErrSum += Math.abs(fullWasm![i] - tsViewshed[i]);
    }
    expect(vsErrSum / TOTAL_VIEWSHED_CELLS).toBeLessThan(0.25);

    const reconstructed = new Float32Array(TOTAL_VIEWSHED_CELLS);
    for (let start = 0; start < NUM_AZIMUTHS; start += 9) {
      const sliceOut = wasmComputePolarViewshedSlice(demGrid, 512, 512, minX, maxX, minY, maxY, start, 9, wasmParams);
      expect(sliceOut).not.toBeNull();
      reconstructed.set(sliceOut!.subarray(0, 9 * NUM_RANGES), start * NUM_RANGES);
    }
    for (let i = 0; i < TOTAL_VIEWSHED_CELLS; i++) {
      expect(reconstructed[i]).toBe(fullWasm![i]);
    }
  });

  it('catalogs and clusters 520 HGT tiles in O(N) time (< 50 ms)', () => {
    const files: Array<{ name: string; size: number }> = [];
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < 26; c++) {
        files.push({
          name: `N${String(15 + r).padStart(2, '0')}E${String(65 + c).padStart(3, '0')}.hgt`,
          size: SRTM3_BYTE_LENGTH,
        });
      }
    }
    const t0 = performance.now();
    const catalog = buildTileCatalog(files);
    const clusters = clusterNeighbouringTiles(catalog);
    const elapsedMs = performance.now() - t0;
    expect(catalog).toHaveLength(520);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].tiles).toHaveLength(520);
    expect(elapsedMs).toBeLessThan(50);
  });

  it('supports OfflineMissionPackStore CRUD and rejects traversal / invalid extensions', async () => {
    const store = new OfflineMissionPackStore({ backend: 'memory' });
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    await store.savePack('N27E071.hgt', 'hgt', payload);
    await store.savePack('mission.json', 'scenario', new TextEncoder().encode('{"ok":true}'));
    expect(await store.listPacks()).toHaveLength(2);
    const loaded = await store.loadPack('N27E071.hgt');
    expect(loaded?.bytes[4]).toBe(5);

    await expect(store.savePack('../evil.hgt', 'hgt', payload)).rejects.toThrow();
    await expect(store.savePack('bad.exe', 'hgt', payload)).rejects.toThrow();

    expect(await store.deletePack('N27E071.hgt')).toBe(true);
    expect(await store.listPacks()).toHaveLength(1);
    await store.clearAll();
    expect(await store.listPacks()).toHaveLength(0);
  });

  it('enforces parseGeoTiffDem OOM pixel cap and interpolates -32768 NoData voids', () => {
    const huge = buildOversizedHeaderGeoTiff(5000, 5000);
    expect(5000 * 5000).toBeGreaterThan(MAX_GEOTIFF_PIXELS);
    const hugeRes = parseGeoTiffDem(huge);
    expect(hugeRes.ok).toBe(false);
    expect(hugeRes.error).toContain('MAX_GEOTIFF_PIXELS');

    const alpineVoid = buildSyntheticGeoTiff({
      width: 3,
      height: 3,
      format: 'int16',
      elevationAt: (r, c) => (r === 1 && c === 1 ? -32768 : 4200),
    });
    const parsed = parseGeoTiffDem(alpineVoid);
    expect(parsed.ok).toBe(true);
    expect(Math.abs(parsed.elevationsM![4] - 4200)).toBeLessThan(1e-3);
    expect(parsed.minElevationM).toBe(4200);
  });

  it('preserves Uint16 nodeId=300 in SpatialSnapshotBuffer and extracts time series cleanly', () => {
    const buf = new SpatialSnapshotBuffer(8, 8);
    const frame: SpatialFrameSnapshot = {
      frameIndex: 1,
      simulationTimeS: 0.02,
      wallClockTimeMs: 1020,
      spatialRevision: 1,
      acn: {
        posX: 1.2,
        posY: 0,
        posZ: 5200,
        velX: 60,
        velY: 0,
        velZ: 0,
        headingRad: 0,
        pitchDeg: 0,
        altitudeMslM: 5200,
        altitudeAglM: 1700,
        coverageRadiusKm: 35,
        isTerrainClamped: false,
      },
      nodes: [
        {
          nodeId: 300,
          posX: 1000,
          posY: 500,
          posZ: 3100,
          altitudeMslM: 3100,
          altitudeAglM: 2.0,
          isLos: true,
          isOutage: false,
          isObstacleBlocked: false,
          snrDb: 16.5,
          currentState: NodeTerrainState.NORMAL_LOS,
        },
      ],
    };
    expect(buf.append(frame)).toBe(true);
    const cols = buf.getReadonlyExportColumns();
    expect(cols.nodeIds).toBeInstanceOf(Uint16Array);
    expect(cols.nodeIds[0]).toBe(300);
    expect(buf.get(0)?.nodes[0].nodeId).toBe(300);
    const ts300 = buf.extractNodeTimeSeries(300);
    expect(ts300.snrDb).toHaveLength(1);
    expect(Math.abs(ts300.snrDb[0] - 16.5)).toBeLessThan(1e-4);
  });

  it('computes workerJitterProfiler RFC 3550 fallback accurately', () => {
    expect(evaluateWorkerRealTimeProfile([2.0, 2.0, 2.0, 2.0, 2.0]).rfc3550JitterMs).toBe(0.0);
    expect(evaluateWorkerRealTimeProfile([2.0]).rfc3550JitterMs).toBe(0.0);
    expect(evaluateWorkerRealTimeProfile([2.0, 2.0, 2.0], [20.0, 24.0, 16.0]).rfc3550JitterMs).toBeGreaterThan(0.0);
  });
});
