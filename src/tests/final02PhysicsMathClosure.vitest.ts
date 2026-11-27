import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { RFConfig, EnvironmentConfig, TdmaFrameConfig } from '../core/config';
import { QuadSectorAntennaEngine } from '../core/antennaArray';
import { LinkBudgetEngine, type LinkStatus } from '../core/linkBudget';
import {
  THEATER_BIOMES,
  computeGoldhirshDustAttenuationDb,
  computeItuR833VegetationLossDb,
} from '../core/biomePhysics';
import { TerrainEngine } from '../core/terrain';
import { PolarViewshedEngine } from '../core/viewshedEngine';
import {
  evaluateAllJammersBySector,
  TacticalEquipmentRegistry,
} from '../core/tacticalEquipment';
import { computeJammerInterference } from '../worker/workerKpiHelpers';
import {
  FQCoDelQueue,
  StrictPriority5qiQueue,
  GroundNodeTrafficSubsystem,
  Packet,
} from '../core/queues';
import {
  LegacyStaticScheduler,
  TerrainAwareDynamicScheduler,
  ReactiveMlwdfScheduler,
  type PredictiveState,
} from '../core/scheduler';
import { NodeTerrainState } from '../core/trajectory';
import { evaluate5QiBearerSlaMetrics } from '../core/qosSlaEngine';
import {
  EdgeAiQTable,
  globalEdgeAiQTable,
  evaluateGroundPathWalkability,
  computeAiSkyShepherdUavOffset,
} from '../core/tacticalAiPathfinder';
import {
  smoothWaypointsKinematically,
  type FixedWingKinematicConstraints,
} from '../core/kinematicPathSmoother';
import { parseGeoTiffDem } from '../core/militaryGisEngine';
import { computeSiteProbeViewshed, computeAltitudeSweep } from '../ui/terrainToolboxAnalysis';
import { SimulationWorkerManager } from '../worker/simWorker';
import {
  initWasmPhysicsSync,
  wasmComputePolarViewshed,
} from '../core/wasmPhysicsBridge';

/**
 * Helper to construct a minimal valid uncompressed stripped TIFF / GeoTIFF buffer.
 */
function buildSyntheticTiff(opts: {
  width: number;
  height: number;
  bitsPerSample: number;
  sampleFormat?: number;
  samplesPerPixel?: number;
  compression?: number;
  pixelBytes: Uint8Array;
  nodataAscii?: string;
  projectedEpsg?: number;
}): ArrayBuffer {
  const entries: Array<{ tag: number; type: number; count: number; valueOrOffset: number; extra?: Uint8Array }> = [
    { tag: 256, type: 4, count: 1, valueOrOffset: opts.width },
    { tag: 257, type: 4, count: 1, valueOrOffset: opts.height },
    { tag: 258, type: 3, count: 1, valueOrOffset: opts.bitsPerSample },
    { tag: 259, type: 3, count: 1, valueOrOffset: opts.compression ?? 1 },
    { tag: 273, type: 4, count: 1, valueOrOffset: 0 }, // StripOffsets patched later
    { tag: 277, type: 3, count: 1, valueOrOffset: opts.samplesPerPixel ?? 1 },
    { tag: 278, type: 4, count: 1, valueOrOffset: opts.height },
    { tag: 279, type: 4, count: 1, valueOrOffset: opts.pixelBytes.byteLength },
  ];
  if (opts.sampleFormat !== undefined) {
    entries.push({ tag: 339, type: 3, count: 1, valueOrOffset: opts.sampleFormat });
  }
  if (opts.projectedEpsg !== undefined) {
    // GeoKeyDirectoryTag (34735): header(1,1,0,2) + GTModelTypeGeoKey(1024=1 Projected) + ProjectedCSTypeGeoKey(3072=epsg)
    const gk = new Uint16Array([1, 1, 0, 2, 1024, 0, 1, 1, 3072, 0, 1, opts.projectedEpsg]);
    entries.push({
      tag: 34735,
      type: 3,
      count: gk.length,
      valueOrOffset: 0,
      extra: new Uint8Array(gk.buffer),
    });
  }
  if (opts.nodataAscii !== undefined) {
    const raw = new TextEncoder().encode(opts.nodataAscii + '\0');
    entries.push({
      tag: 42113,
      type: 2,
      count: raw.length,
      valueOrOffset: 0,
      extra: raw,
    });
  }
  entries.sort((a, b) => a.tag - b.tag);

  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let extraOffset = ifdOffset + ifdSize;
  const extraChunks: Array<{ offset: number; data: Uint8Array }> = [];

  for (const e of entries) {
    if (e.extra) {
      if (e.extra.byteLength <= 4) {
        let packed = 0;
        for (let i = 0; i < e.extra.byteLength; i++) {
          packed |= e.extra[i] << (i * 8);
        }
        e.valueOrOffset = packed >>> 0;
      } else {
        e.valueOrOffset = extraOffset;
        extraChunks.push({ offset: extraOffset, data: e.extra });
        extraOffset += e.extra.byteLength;
      }
    }
  }
  const pixelOffset = extraOffset;
  const totalBytes = pixelOffset + opts.pixelBytes.byteLength;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Header: little-endian 'II', magic 42, first IFD = 8
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  view.setUint16(ifdOffset, entries.length, true);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const base = ifdOffset + 2 + i * 12;
    const val = e.tag === 273 ? pixelOffset : e.valueOrOffset;
    view.setUint16(base, e.tag, true);
    view.setUint16(base + 2, e.type, true);
    view.setUint32(base + 4, e.count, true);
    view.setUint32(base + 8, val, true);
  }
  view.setUint32(ifdOffset + 2 + entries.length * 12, 0, true);
  for (const chunk of extraChunks) {
    bytes.set(chunk.data, chunk.offset);
  }
  bytes.set(opts.pixelBytes, pixelOffset);
  return buf;
}

describe('FINAL-02: 14 P1 Physics/Math/MAC/Edge-AI/GeoTIFF Closure + Carryovers', () => {
  it('P1-1: applies ITU-R P.618-14 cosmic background 2.73 K and non-double-counted T_sys across LinkBudgetEngine', () => {
    const rf = new RFConfig({ acnNoiseFigureDb: 3.5 });
    const dryEnv = new EnvironmentConfig({ rainRateMmH: 0.0, atmosphericTemperatureK: 290.0 });
    const wetEnv = new EnvironmentConfig({ rainRateMmH: 35.0, atmosphericTemperatureK: 290.0 });
    const lb = new LinkBudgetEngine();

    const dry = lb.evaluateLink({ nodeType: 'soldier', slantRangeM: 12000, rf, env: dryEnv, nodeAltM: 3200, acnAltM: 5200 });
    const wet = lb.evaluateLink({ nodeType: 'soldier', slantRangeM: 12000, rf, env: wetEnv, nodeAltM: 3200, acnAltM: 5200 });

    // Clear sky zenith-like atmospheric loss includes 2.73 K cosmic floor, whereas heavy rain raises sky temperature appreciably
    expect(dry.skyTemperatureK ?? 0).toBeGreaterThanOrEqual(2.73);
    expect(dry.skyNoiseIncreaseDb ?? 0).toBeGreaterThanOrEqual(0.0);
    expect(dry.skyNoiseIncreaseDb ?? 0).toBeLessThan(0.2);
    expect(wet.skyNoiseIncreaseDb ?? 0).toBeGreaterThan(0.5);

    const tRxK = 290.0 * (Math.pow(10, 3.5 / 10) - 1.0);
    const expectedWetNoiseDbm = 10.0 * Math.log10(rf.boltzmannConstant * ((wet.skyTemperatureK ?? 0) + tRxK) * rf.channelBandwidthHz * 1000.0);
    expect(wet.pNoiseDbm).toBeCloseTo(expectedWetNoiseDbm, 6);
  });

  it('P1-2: frequency-parameterizes ITU-R P.676 gas & P.838 rain coefficients and anchors index.html 6.0 km dry O2 height', () => {
    const dryEnv = new EnvironmentConfig({ rainRateMmH: 25.0 });
    const g4 = LinkBudgetEngine.computeGaseousAttenuationDb(20000, 1000, 4000, 4.0e9);
    const g8 = LinkBudgetEngine.computeGaseousAttenuationDb(20000, 1000, 4000, 8.0e9);
    const g15 = LinkBudgetEngine.computeGaseousAttenuationDb(20000, 1000, 4000, 15.0e9);
    expect(g8).toBeGreaterThan(g4);
    expect(g15).toBeGreaterThan(g8);

    const r4 = LinkBudgetEngine.computeRainAttenuationDb(10000, dryEnv, 500, 2500, 5500, 4.0e9);
    const r8 = LinkBudgetEngine.computeRainAttenuationDb(10000, dryEnv, 500, 2500, 5500, 8.0e9);
    const r14 = LinkBudgetEngine.computeRainAttenuationDb(10000, dryEnv, 500, 2500, 5500, 14.0e9);
    expect(r8).toBeGreaterThan(r4 * 2.0);
    expect(r14).toBeGreaterThan(r8 * 2.0);

    const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');
    expect(indexHtml).toContain('6.0 km for dry air');
    expect(indexHtml).not.toContain('8.0 km for dry air');
  });

  it('P1-3: standardizes Ladakh alpine_mountain freezing isotherm at 4800.0 m across jammer & ingress rain attenuation', () => {
    expect(THEATER_BIOMES.alpine_mountain.freezingIsothermM).toBe(4800.0);

    const rf = new RFConfig();
    const env = new EnvironmentConfig({ rainRateMmH: 30.0, biomeId: 'alpine_mountain' });
    const reg = new TacticalEquipmentRegistry();
    reg.add({
      id: 'jam-high',
      type: 'barrage_jammer',
      xM: 40000,
      yM: 0,
      heightAglM: 10,
      zM: 4900,
      eirpDbm: 70,
      enabled: true,
    });
    const alpineTerrain = new TerrainEngine({ terrainMode: 'real' });
    alpineTerrain.loadCustomDem(new Float32Array(512 * 512).fill(4890));
    const maritimeTerrain = new TerrainEngine({ terrainMode: 'real' });
    maritimeTerrain.setBiome('maritime_littoral');
    maritimeTerrain.loadCustomDem(new Float32Array(512 * 512).fill(4890));
    const ant = new QuadSectorAntennaEngine();
    const ladakhRes = evaluateAllJammersBySector({
      equipment: reg.list(),
      acnPos: [0, 0, 5500],
      acnVel: [50, 0, 0],
      acnAttitude: { headingDeg: 0, pitchDeg: 0, bankDeg: 0 },
      rfConfig: rf,
      envConfig: env,
      terrainEngine: alpineTerrain,
      antennaEngine: ant,
    });
    const maritimeRes = evaluateAllJammersBySector({
      equipment: reg.list(),
      acnPos: [0, 0, 5500],
      acnVel: [50, 0, 0],
      acnAttitude: { headingDeg: 0, pitchDeg: 0, bankDeg: 0 },
      rfConfig: rf,
      envConfig: env,
      terrainEngine: maritimeTerrain,
      antennaEngine: ant,
    });
    expect(Math.max(...ladakhRes.jammerSectorInterferenceDbm)).toBeGreaterThan(
      Math.max(...maritimeRes.jammerSectorInterferenceDbm) + 0.5
    );

    const ingressAlpine = computeJammerInterference({
      jammerEnabled: true,
      jammerPosEnu: [40000, 0, 4890],
      jammerEirpDbm: 70,
      envConfig: env,
      rfConfig: rf,
      acnPos: [0, 0, 5500],
      acnVel: [50, 0, 0],
      acnAttitude: { headingDeg: 0, pitchDeg: 0, bankDeg: 0 },
      terrainEngine: alpineTerrain,
      antennaEngine: ant,
    });
    const ingressMaritime = computeJammerInterference({
      jammerEnabled: true,
      jammerPosEnu: [40000, 0, 4890],
      jammerEirpDbm: 70,
      envConfig: env,
      rfConfig: rf,
      acnPos: [0, 0, 5500],
      acnVel: [50, 0, 0],
      acnAttitude: { headingDeg: 0, pitchDeg: 0, bankDeg: 0 },
      terrainEngine: maritimeTerrain,
      antennaEngine: ant,
    });
    expect(Math.max(...ingressAlpine.jammerSectorInterferenceDbm)).toBeGreaterThan(
      Math.max(...ingressMaritime.jammerSectorInterferenceDbm) + 0.5
    );
  });

  it('P1-4: bounds Goldhirsh dust storm to 1500 m AGL ceiling and applies oblique 1/max(sinEl,0.15) to P.833 foliage', () => {
    const lowPathDust = computeGoldhirshDustAttenuationDb(8.0, 20.0, 0.2, 2.0, 200.0);
    const airGroundDust = computeGoldhirshDustAttenuationDb(8.0, 20.0, 0.2, 2.0, 5000.0);
    const highAltDust = computeGoldhirshDustAttenuationDb(8.0, 20.0, 0.2, 2000.0, 5000.0);
    expect(lowPathDust).toBeGreaterThan(airGroundDust * 1.8);
    expect(highAltDust).toBe(0.0);

    const zenVeg = computeItuR833VegetationLossDb(8.0, 15.0, 'tropical-dense', 1.0);
    const obliqueVeg = computeItuR833VegetationLossDb(8.0, 15.0, 'tropical-dense', 0.25);
    const clampedVeg = computeItuR833VegetationLossDb(8.0, 15.0, 'tropical-dense', 0.02);
    const clampedEdgeVeg = computeItuR833VegetationLossDb(8.0, 15.0, 'tropical-dense', 0.15);
    expect(obliqueVeg).toBeGreaterThan(zenVeg * 1.1);
    expect(clampedVeg).toBeCloseTo(clampedEdgeVeg, 6);
  });

  it('P1-5: removes grazing rho=0 curvature discontinuity and bypasses WASM batch ray-march when CAD obstacles exist', () => {
    const terrain = new TerrainEngine({ terrainMode: 'real' });
    terrain.loadCustomDem(new Float32Array(512 * 512).fill(3000));
    const rf = new RFConfig();
    const env = new EnvironmentConfig();
    terrain.obstacleField.replace([
      {
        id: 'obs-1',
        shape: 'cuboid',
        xM: 5000,
        yM: 0,
        widthM: 80,
        depthM: 400,
        heightM: 4500,
        rotationDeg: 0,
      },
    ]);
    const batchWithObs = terrain.evaluateTerrainObstructionBatch(
      [{ nodePos: [0, 0, 3500], acnPos: [10000, 0, 3500] }],
      rf,
      env
    );
    expect(batchWithObs[0].isLos).toBe(true);
    expect(batchWithObs[0].obstacleBlocked).toBe(true);

    // Curvature continuity: sweep a knife-edge terrain crest height gently through grazing clearance (minClearanceM = 0)
    const losses: number[] = [];
    for (const h of [992, 998, 1000, 1002, 1008]) {
      const customTerr = new TerrainEngine({ terrainMode: 'real' });
      const dem = new Float32Array(512 * 512).fill(0);
      for (let r = 0; r < 512; r++) {
        dem[r * 512 + 256] = h;
      }
      customTerr.loadCustomDem(dem);
      const res = customTerr.evaluateTerrainObstruction([-2000, 0, 1000], [2000, 0, 1000], rf, env, 80);
      losses.push(res.diffractionLossDb);
    }
    for (let i = 1; i < losses.length; i++) {
      expect(losses[i] - losses[i - 1]).toBeLessThan(8.0);
    }
  });

  it('P1-6: freezes OLLA & skips HARQ during manual_lock in closed-loop SimulationWorkerManager', () => {
    const mgr = new SimulationWorkerManager(0);
    mgr.handleCommand({
      type: 'SET_SCIENTIFIC_PARAMS',
      enable_mac_phy_feedback: true,
      enable_correlated_rician_fading: true,
    });
    mgr.handleCommand({
      type: 'CONFIG_UPDATE',
      params: {
        mcs_mode: 'manual_lock',
        manual_modcod_index: 12,
        cqi_feedback_delay_ms: 60,
      },
    });
    for (let i = 0; i < 10; i++) mgr.stepSimulation();
    const internal = mgr as unknown as {
      linkStatuses: Map<number, LinkStatus & { ollaMarginDb?: number; harqRetxCount?: number }>;
    };
    expect(internal.linkStatuses.size).toBeGreaterThan(0);
    for (const ls of internal.linkStatuses.values()) {
      expect(ls.ollaMarginDb ?? 0).toBe(0);
      expect(ls.harqRetxCount ?? 0).toBe(0);
    }
  });

  it('P1-7: propagates NaN for out-of-coverage DEM cells in TS & WASM PolarViewshed', () => {
    const wasmPath = resolve(process.cwd(), 'src/wasm/xband_physics/xband_physics_bg.wasm');
    initWasmPhysicsSync(readFileSync(wasmPath));

    const engine = new PolarViewshedEngine();
    const rf = new RFConfig();
    const env = new EnvironmentConfig({ rainRateMmH: 0.0, jammerEnabled: false });
    const demGrid = new Float32Array(64 * 64).fill(3200.0);
    const outCell = engine.computeCellSinr(
      120000.0,
      0.0,
      [0, 0, 4800],
      [50, 0, 0],
      {
        terrainMode: 'real',
        isWithinDemCoverage: () => false,
        getElevation: () => Number.NaN,
        evaluateTerrainObstruction: () => ({
          isLos: false,
          diffractionLossDb: Number.NaN,
          minClearanceM: Number.NaN,
          isCoverageComplete: false,
          isObstacleBlocked: false,
          fresnelRadiusM: 0,
          horizonElevDeg: 0,
          minClearanceRatio: 0,
          obstacleLossDb: 0,
          earthBulgeM: 0,
          bullingtonApex: null,
        }),
      } as unknown as TerrainEngine,
      rf,
      env
    );
    expect(Number.isNaN(outCell)).toBe(true);

    const wasmOut = wasmComputePolarViewshed(demGrid, 64, 64, -5000, 5000, -5000, 5000, {
      numBearings: 8,
      numRanges: 4,
      rMinM: 2000,
      rStepM: 3000,
      acnPos: [0, 0, 4800],
      headingDeg: 0,
      pitchDeg: 0,
      bankDeg: 0,
      carrierFreqHz: rf.carrierFrequencyHz,
      speedOfLight: rf.speedOfLight,
      channelBandwidthHz: rf.channelBandwidthHz,
      acnAntennaGainDbi: rf.acnAntennaGainDbi,
      acnNoiseFigureDb: rf.acnNoiseFigureDb,
      soldierTxPowerDbm: 30,
      soldierAntennaGainDbi: 0,
      cableLossDb: rf.cableLossDb,
      implementationMarginDb: rf.implementationMarginDb,
      boltzmannConstant: rf.boltzmannConstant,
      hpbwAzDeg: 90,
      hpbwElDeg: 65,
      downtiltDeg: -15,
      rEffM: env.effectiveEarthRadiusM,
      atmosphericTempK: env.atmosphericTemperatureK,
      rainRateMmH: 0,
      rainCellLengthKm: 10,
      freezingIsothermM: 4800,
      jammerEnabled: false,
      jammerBySector: [-200, -200, -200, -200],
    });
    expect(wasmOut).not.toBeNull();
    // Range index 3 is at 2000 + 3*3000 = 11000 m (> 5000 m grid half-width) -> NaN
    expect(Number.isNaN(wasmOut![3])).toBe(true);
  });

  it('P1-8: gates acnGainDbi to acn_alt mode, subtracts implementationMarginDb, and removes altitude-sweep +12 dB discontinuity', () => {
    const terrain = new TerrainEngine({ terrainMode: 'synthetic' });
    const rf = new RFConfig({ acnAntennaGainDbi: 14.0, implementationMarginDb: 3.0 });
    const env = new EnvironmentConfig();
    const ctx = {
      terrainEngine: terrain,
      rfConfig: rf,
      envConfig: env,
      acnPositionMslM: [0, 0, 5000] as [number, number, number],
      groundNodes: [],
    };
    const acnMode = computeSiteProbeViewshed(ctx, {
      xM: 0,
      yM: 0,
      observerAglM: 10,
      radiusM: 6000,
      targetMode: 'acn_alt',
      includeObstacles: false,
      txPowerDbm: 33,
    });
    const groundMode = computeSiteProbeViewshed(ctx, {
      xM: 0,
      yM: 0,
      observerAglM: 10,
      radiusM: 6000,
      targetMode: 'ground_agl',
      targetAglM: 5000,
      includeObstacles: false,
      txPowerDbm: 33,
    });
    expect(acnMode.signalSummary.meanSinrDb!).toBeGreaterThan(groundMode.signalSummary.meanSinrDb! + 5.0);

    const dem = new Float32Array(128 * 128).fill(0);
    for (let r = 0; r < 128; r++) dem[r * 128 + 64] = 800;
    const ridgeTerr = new TerrainEngine({ terrainMode: 'real' });
    ridgeTerr.loadCustomDem(dem);
    const sweep = computeAltitudeSweep(
      { terrainEngine: ridgeTerr, rfConfig: rf, envConfig: env, acnPositionMslM: [2500, 0, 2000], groundNodes: [] },
      { kind: 'probe', xM: -2500, yM: 0, aglM: 2 },
      { minAltM: 1500, maxAltM: 1700, stepM: 50, includeObstacles: false, nodeType: 'soldier' }
    );
    for (let i = 1; i < sweep.meanSnrDb.length; i++) {
      const a = sweep.meanSnrDb[i - 1];
      const b = sweep.meanSnrDb[i];
      if (a !== null && b !== null) {
        expect(Math.abs(b - a)).toBeLessThan(8.0);
      }
    }
  });

  it('P1-9: exposes StrictPriority5qiQueue alias, counts requeueForHarq drops & class drops, aligns HTML 5QI PDBs', () => {
    expect(StrictPriority5qiQueue).toBe(FQCoDelQueue);
    const q = new StrictPriority5qiQueue(2, 50); // tight 2-packet buffer
    const mkPkt = (id: number, qos: 69 | 70) =>
      new Packet(id, 0, qos, 1000, 0.0, qos === 69 ? 0.06 : 0.3);
    expect(q.enqueue(mkPkt(1, 69))[0]).toBe(true);
    expect(q.enqueue(mkPkt(2, 70))[0]).toBe(true);
    const [accepted3, evicted3] = q.enqueue(mkPkt(3, 70));
    expect(accepted3).toBe(true);
    expect(evicted3.length).toBe(1);
    expect(q.getClassDropCount(70)).toBe(1);
    expect(q.getClassDropCount(69)).toBe(0);

    const dq = q.dequeue(1000, 0.0)[0];
    expect(q.enqueue(mkPkt(4, 69))[0]).toBe(true);
    q.requeueForHarq([dq]);
    expect(q.droppedOverflowCount).toBeGreaterThanOrEqual(2);

    const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');
    const docsHtml = readFileSync(resolve(process.cwd(), 'docs.html'), 'utf-8');
    expect(indexHtml).toContain('75 ms Voice, 150 ms Video, 300 ms ISR Photo');
    expect(indexHtml).toContain('5QI 67 (Mission-Critical Real-Time Video)');
    expect(indexHtml).toContain('150 ms');
    expect(docsHtml).toContain('75 ms');
  });

  it('P1-10: reaches dlMaxDurationS symmetrically across Static/Dynamic schedulers and enforces Reactive maxReactiveSlot cap', () => {
    const tdmaCfg = new TdmaFrameConfig({ dlMinDurationMs: 3.0, dlMaxDurationMs: 7.0 });
    const staticSched = new LegacyStaticScheduler(0.003);
    staticSched.setTdmaConfig(tdmaCfg);
    const dynSched = new TerrainAwareDynamicScheduler(0.003);
    dynSched.setTdmaConfig(tdmaCfg);
    const reactSched = new ReactiveMlwdfScheduler(0.003);
    expect(reactSched.enablePredictiveLookahead).toBe(false);

    const node = new GroundNodeTrafficSubsystem(0, 'soldier', [1000, 0, 3200], 0);
    const link: LinkStatus = {
      nodeId: 0,
      slantRangeM: 3000,
      fsplDb: 120,
      diffractionLossDb: 0,
      gasLossDb: 0.1,
      rainLossDb: 0,
      cableLossDb: 2,
      implMarginDb: 2,
      totalLossDb: 124.1,
      rxPowerDbm: -70,
      noiseFloorDbm: -100,
      snrDb: 20,
      modcodName: '16APSK-3/4',
      spectralEfficiencyBpsHz: 3.0,
      bitrateBps: 4_000_000,
      isLos: true,
      isOutage: false,
    };
    const pred: PredictiveState = {
      nodeId: 0,
      currentState: NodeTerrainState.NORMAL_LOS,
      predictedState: NodeTerrainState.NORMAL_LOS,
      isHardShadow: false,
      isPreOcclusionFlush: false,
      timeToOcclusionS: 10.0,
      evacuationPressure: 1.0,
    };

    const rStatic = staticSched.scheduleFrame(0, 0.0, [node], new Map([[0, link]]), new Map([[0, pred]]), 20000);
    const rDyn = dynSched.scheduleFrame(0, 0.0, [node], new Map([[0, link]]), new Map([[0, pred]]), 20000);
    expect(rStatic.dlDurationS).toBeCloseTo(0.007, 4);
    expect(rDyn.dlDurationS).toBeCloseTo(0.007, 4);
  });

  it('P1-11: ensures starved 0-slot LoS nodes lower Jain fairness when ganttAllocations is provided', () => {
    const mkNode = (id: number) => ({
      node_id: id,
      qos: 65,
      bitrate_bps: 4_000_000,
      queue_drops: 0,
      hol_sojourn_ms: 5,
      link_outage: false,
      packets_queued: 4,
      queue_bytes: 4000,
    });
    const res = evaluate5QiBearerSlaMetrics(
      [mkNode(0), mkNode(1)],
      [{ node_id: 0, capacity_bits: 10000 }]
    );
    expect(res.jainsFairnessIndex).toBeCloseTo(0.5, 4);

    const noGanttRes = evaluate5QiBearerSlaMetrics([mkNode(0), mkNode(1)]);
    expect(noGanttRes.jainsFairnessIndex).toBeCloseTo(1.0, 4);
  });

  it('P1-12: rejects NaN terrain/Q-updates in Edge-AI pathfinder and resets globalEdgeAiQTable on worker RESET', () => {
    const walk = evaluateGroundPathWalkability([[0, 0, 3200], [100, 0, 3200]], 'soldier', () => Number.NaN);
    expect(walk.isWalkable).toBe(false);

    const shepherd = computeAiSkyShepherdUavOffset([0, 0, 3200], [0, 0, 4000], () => Number.NaN);
    expect(shepherd.isShepherdFeasible).toBe(false);
    expect(shepherd.deltaXM).toBe(0);
    expect(shepherd.deltaYM).toBe(0);
    expect(shepherd.deltaAltM).toBe(0);

    const qt = new EdgeAiQTable();
    qt.updateQValue(1, 0, Number.NaN);
    expect(Number.isFinite(qt.getQValue(1, 0))).toBe(true);

    globalEdgeAiQTable.updateQValue(0, 2, 18.0, 0.5);
    const mgr = new SimulationWorkerManager(0, 'ACN_ONLY');
    mgr.handleCommand({ type: 'SIM_CONTROL', action: 'reset' });
    expect(globalEdgeAiQTable.getQValue(0, 2)).toBe(0);
  });

  it('P1-13: verifies Dubins smoother straight-leg isPointSafe checks & monotonic fillet shrinking respecting R_min', () => {
    const constraints: FixedWingKinematicConstraints = {
      speedMs: 60.0,
      maxBankDeg: 35.0,
      maxClimbRateMs: 12.0,
      maxDescentRateMs: 15.0,
      sampleStepM: 100.0,
    };
    const obsRes = smoothWaypointsKinematically(
      [
        { x: 0, y: 0, altM: 4000 },
        { x: 1000, y: 0, altM: 4000 },
      ],
      constraints,
      (x) => Math.abs(x - 500) > 120
    );
    expect(obsRes.obstacleFallbackCount).toBeGreaterThan(0);

    const filletRes = smoothWaypointsKinematically(
      [
        { x: -1200, y: 0, altM: 4000 },
        { x: 0, y: 0, altM: 4000 },
        { x: 0, y: 1200, altM: 4000 },
      ],
      constraints,
      (x, y) => Math.hypot(x + 250, y - 250) > 120
    );
    expect(filletRes.isKinematicallyFeasible || filletRes.minEffectiveTurnRadiusM >= 520).toBe(true);
  });

  it('P1-14: enforces SPP=1, supports Int8 & GDAL_NODATA tag 42113, and rejects UTM GeoTIFFs in parseGeoTiffDem', () => {
    // 1. Valid Int8 2x2 GeoTIFF with GDAL_NODATA = "-99" (pixel 0 masked from -99 via neighbor void-fill)
    const int8Data = new Int8Array([-99, 25, 50, 120]);
    const validBuf = buildSyntheticTiff({
      width: 2,
      height: 2,
      bitsPerSample: 8,
      sampleFormat: 2,
      pixelBytes: new Uint8Array(int8Data.buffer),
      nodataAscii: '-99',
    });
    const decoded = parseGeoTiffDem(validBuf);
    expect(decoded.ok).toBe(true);
    expect(decoded.minElevationM).toBe(25);
    expect(decoded.elevationsM![0]).toBeGreaterThan(0);
    expect(decoded.elevationsM![1]).toBe(25);
    expect(decoded.elevationsM![3]).toBe(120);

    // 2. Reject SamplesPerPixel = 3 (RGB imagery)
    const rgbBuf = buildSyntheticTiff({
      width: 2,
      height: 2,
      bitsPerSample: 8,
      samplesPerPixel: 3,
      pixelBytes: new Uint8Array(12),
    });
    const rgbRes = parseGeoTiffDem(rgbBuf);
    expect(rgbRes.ok).toBe(false);
    expect(rgbRes.error).toMatch(/SamplesPerPixel/i);

    // 3. Reject projected UTM GeoTIFF (EPSG:32643)
    const utmBuf = buildSyntheticTiff({
      width: 2,
      height: 2,
      bitsPerSample: 16,
      sampleFormat: 2,
      pixelBytes: new Uint8Array(8),
      projectedEpsg: 32643,
    });
    const utmRes = parseGeoTiffDem(utmBuf);
    expect(utmRes.ok).toBe(false);
    expect(utmRes.error).toMatch(/projected.*GeoTIFF/i);
  });

  it('Carryover-1 & Carryover-2: serial verify:attitude-channel flag & tactical_equipment_json empty-array export', () => {
    const runnerSrc = readFileSync(resolve(process.cwd(), 'scripts/run_all_verifications.mjs'), 'utf-8');
    expect(runnerSrc).toMatch(/verify:attitude-channel[\s\S]{0,240}serial:\s*true/);

    const ioSrc = readFileSync(resolve(process.cwd(), 'src/ui/controllers/missionIoController.ts'), 'utf-8');
    expect(ioSrc).toMatch(/tactical_equipment_json:\s*JSON\.stringify\(\s*tacticalEq\.map/);
  });
});
