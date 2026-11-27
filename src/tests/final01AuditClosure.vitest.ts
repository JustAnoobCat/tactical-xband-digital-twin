import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { resolve } from 'node:path';

import {
  TerrainAwareDynamicScheduler,
  type PredictiveState,
} from '../core/scheduler';
import { GroundNodeTrafficSubsystem, Packet } from '../core/queues';
import type { LinkStatus } from '../core/linkBudget';
import { BIOME_DEM_METADATA, TerrainEngine } from '../core/terrain';
import { NodeTerrainState } from '../core/trajectory';
import { SimulationWorkerManager } from '../worker/simWorker';
import { stitchHgtTiles, type DecodedTile } from '../core/hgtMosaic';
import { computeRadarCursorReadout } from '../ui/radarCursorReadout';
import {
  exportRegionGeoJson,
  sampleDemSafe,
  type RegionZonalStats,
  type ToolboxRegionInput,
} from '../ui/terrainToolboxAnalysis';
import { SpatialSnapshotBuffer, type SpatialFrameSnapshot } from '../ui/spatialSnapshotBuffer';
import { MAX_VISIBLE_TILES_PER_FRAME } from '../ui/worldTileLayer';
import { resolveSoldierAiNotificationBanner } from '../ui/soldierEudRenderer';
import { createTsParityServer } from '../../server/ts_parity_server';

function makeSyntheticTile(tileName: string, minLatDeg: number, minLonDeg: number, elev = 100): DecodedTile {
  const sampleCount = 9;
  const elevations = new Float32Array(sampleCount * sampleCount);
  elevations.fill(elev);
  return {
    tileName,
    minLatDeg,
    maxLatDeg: minLatDeg + 1,
    minLonDeg,
    maxLonDeg: minLonDeg + 1,
    centerLatDeg: minLatDeg + 0.5,
    centerLonDeg: minLonDeg + 0.5,
    sampleCount,
    resolution: 'SRTM3',
    elevations,
    minElevationM: elev,
    maxElevationM: elev,
    voidCount: 0,
  };
}

function makeHttpRequest(options: http.RequestOptions, body?: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolveReq, rejectReq) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolveReq({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

describe('FINAL-01 Master Ledger Audit Closure', () => {
  it('P0-3: single-sector TerrainAwareDynamicScheduler requeues undecoded packets on cqiDecodeFailure', () => {
    const sched = new TerrainAwareDynamicScheduler();
    sched.enableMultiSector = false;

    const node = new GroundNodeTrafficSubsystem(1, 'soldier', [1000, 1000, 3500], 42);
    node.queue.enqueue(new Packet(1, 1, 65, 160, 0.0, 0.5));

    const link: LinkStatus = {
      nodeId: 1,
      slantRangeM: 12000,
      fsplDb: 132,
      diffractionLossDb: 0,
      gasLossDb: 0.2,
      rainLossDb: 0,
      cableLossDb: 2,
      implMarginDb: 2,
      totalLossDb: 136.2,
      rxPowerDbm: -80,
      noiseFloorDbm: -102,
      snrDb: 12.0,
      modcodName: '16APSK-2/3',
      spectralEfficiencyBpsHz: 2.6,
      bitrateBps: 2.6e6,
      isLos: true,
      isOutage: false,
      cqiDecodeFailure: true,
    };
    const pred: PredictiveState = {
      nodeId: 1,
      currentState: NodeTerrainState.NORMAL_LOS,
      predictedState: NodeTerrainState.NORMAL_LOS,
      isHardShadow: false,
      isPreOcclusionFlush: false,
      timeToOcclusionS: 10.0,
      evacuationPressure: 1.0,
    };

    const res = sched.scheduleFrame(
      1,
      0.02,
      [node],
      new Map([[1, link]]),
      new Map([[1, pred]]),
      0
    );

    expect(res.totalBitsWastedOnOutage).toBeGreaterThan(0);
    expect(res.totalBitsTransmitted).toBe(0);
    expect(node.queue.getTotalBacklogBytes()).toBe(160);
    expect(node.queue.totalEnqueued).toBe(1);
  });

  it('P0-4: reactiveScheduler stays synced with tdmaConfig and rejected CONFIG_UPDATE is atomic', () => {
    const sim = new SimulationWorkerManager(0, 'ACN_ONLY');
    const prevFreq = sim.rfConfig.carrierFrequencyHz;
    const prevTerrainMode = sim.terrainEngine.terrainMode;

    const rejected = sim.handleCommand({
      type: 'CONFIG_UPDATE',
      params: {
        carrier_freq_ghz: 9.5,
        terrain_mode: 'synthetic',
        mcs_mode: 'invalid_mcs_mode' as any,
      },
    });
    expect(rejected.accepted).toBe(false);
    expect(sim.rfConfig.carrierFrequencyHz).toBe(prevFreq);
    expect(sim.terrainEngine.terrainMode).toBe(prevTerrainMode);

    const tdmaUpdate = sim.handleCommand({
      type: 'CONFIG_UPDATE',
      params: {
        tdma_frame_config: {
          frameDurationMs: 40,
          ctrlDurationMs: 2,
          dlDurationMs: 6,
          guardIntervalUs: 20,
        },
      },
    });
    expect(tdmaUpdate.accepted).toBe(true);
    const getFrameMs = (s: unknown) => (s as { config: { frameDurationMs: number } }).config.frameDurationMs;
    expect(getFrameMs(sim.reactiveScheduler)).toBe(40);
    expect(getFrameMs(sim.tacScheduler)).toBe(40);
    expect(getFrameMs(sim.staticScheduler)).toBe(40);
  });

  it('P0-7: non-Ladakh multi-tile HGT mosaic centers symmetrically around (0, 0)', () => {
    const tiles = [
      makeSyntheticTile('N18E072', 18, 72, 10),
      makeSyntheticTile('N18E073', 18, 73, 20),
    ];
    const mosaic = stitchHgtTiles(tiles);
    const meta = mosaic.metadata;

    expect(meta.centerLatDeg).toBeCloseTo(18.5, 6);
    expect(meta.centerLonDeg).toBeCloseTo(73.0, 6);
    expect(meta.minX! + meta.maxX!).toBeCloseTo(0, 4);
    expect(meta.minY! + meta.maxY!).toBeCloseTo(0, 4);
    expect(meta.minX!).toBeLessThan(0);
    expect(meta.maxX!).toBeGreaterThan(0);
  });

  it('P0-6: cursor readout and toolbox geodesy normalize halfHeightM/halfWidthM by half-span and skip biomeMeta on custom origin', () => {
    const te = new TerrainEngine('synthetic', 'arid_desert');
    te.setBiome('arid_desert');
    const desertMeta = BIOME_DEM_METADATA.arid_desert;
    const sampleY = 55450; // half of desertMeta.halfHeightM (110900m for 1.0 deg half-span)
    const sampleX = 49500; // half of desertMeta.halfWidthM (99000m for 1.0 deg half-span)

    const engineGeo = te.worldToLatLon(sampleX, sampleY);
    const cursorGeo = computeRadarCursorReadout({
      xM: sampleX,
      yM: sampleY,
      isInsideRadar: true,
      biomeId: 'arid_desert',
      originLatDeg: desertMeta.centerLatDeg,
      originLonDeg: desertMeta.centerLonDeg,
      halfWidthM: desertMeta.halfWidthM,
      halfHeightM: desertMeta.halfHeightM,
      halfSpanLatDeg: (desertMeta.maxLatDeg - desertMeta.minLatDeg) * 0.5,
      halfSpanLonDeg: (desertMeta.maxLonDeg - desertMeta.minLonDeg) * 0.5,
    });
    expect(cursorGeo.latDeg).toBeCloseTo(engineGeo.latDeg, 6);
    expect(cursorGeo.lonDeg).toBeCloseTo(engineGeo.lonDeg, 6);

    // Explicit custom origin with 0.5 deg half-span tile (halfHeightM ~ 55465.7 m)
    const customHalfSpanGeo = computeRadarCursorReadout({
      xM: 0,
      yM: 55465.7,
      isInsideRadar: true,
      biomeId: 'alpine_mountain',
      originLatDeg: 10.0,
      originLonDeg: 20.0,
      halfWidthM: 54600,
      halfHeightM: 55465.7,
      halfSpanLatDeg: 0.5,
      halfSpanLonDeg: 0.5,
    });
    expect(customHalfSpanGeo.latDeg).toBeCloseTo(10.5, 4);

    // Explicit custom origin without halfWidthM/halfHeightM must not leak biomeMeta scaling
    const customOriginOnly = computeRadarCursorReadout({
      xM: 0,
      yM: 110931.4506,
      isInsideRadar: true,
      biomeId: 'arid_desert',
      originLatDeg: 10.0,
      originLonDeg: 20.0,
    });
    expect(customOriginOnly.latDeg).toBeCloseTo(11.0, 4);

    // Export GeoJSON with BiomeId string matches TerrainEngine.worldToLatLon
    const region: ToolboxRegionInput = {
      id: 1,
      name: 'Test',
      color: '#38bdf8',
      points: [
        { x: sampleX, y: sampleY },
        { x: -sampleX, y: sampleY },
        { x: 0, y: -sampleY },
      ],
    };
    const dummyStats: RegionZonalStats = {
      regionId: 1,
      areaKm2: 1.0,
      totalInteriorSamples: 10,
      validDemSamples: 10,
      coverageCompletenessPct: 100,
      minElevationM: 180,
      meanElevationM: 220,
      maxElevationM: 310,
      stdElevationM: 20,
      meanSlopeDeg: 2,
      p95SlopeDeg: 5,
      losCoveragePct: 100,
      medianDiffractionLossDb: 0,
      enclosedNodeCount: 0,
      enclosedNodeIds: [],
      enclosedMeanSnrDb: null,
      bestRelayCoord: null,
    };
    const geojsonFromStr = JSON.parse(exportRegionGeoJson(region, dummyStats, 'arid_desert'));
    const geojsonFromTe = JSON.parse(exportRegionGeoJson(region, dummyStats, te));
    const coordsStr = geojsonFromStr.features[0].geometry.coordinates[0][0];
    const coordsTe = geojsonFromTe.features[0].geometry.coordinates[0][0];
    expect(coordsStr[0]).toBeCloseTo(coordsTe[0], 6);
    expect(coordsStr[1]).toBeCloseTo(coordsTe[1], 6);
  });

  it('P0-9: sea-level 0.0 m MSL is preserved without falsy 3500 fallback', () => {
    const te = new TerrainEngine('real', 'maritime_littoral');
    const seaGrid = new Float32Array(512 * 512);
    seaGrid.fill(0.0);
    te.loadCustomDem(seaGrid, BIOME_DEM_METADATA.maritime_littoral);

    const sample = sampleDemSafe(te, 0, 0);
    expect(sample.isWithinCoverage).toBe(true);
    expect(sample.elevationM).toBe(0.0);

    const outOfBounds = sampleDemSafe(te, 9_999_999, 9_999_999);
    expect(outOfBounds.isWithinCoverage).toBe(false);
    expect(Number.isNaN(outOfBounds.elevationM)).toBe(true);
  });

  it('P2-5: SpatialSnapshotBuffer round-trips NaN via -32768 and preserves 0.0 m sea level and 6,849,000 B size', () => {
    const buf = new SpatialSnapshotBuffer();
    expect(buf.getTotalByteLength()).toBe(6_849_000);

    const snap: SpatialFrameSnapshot = {
      frameIndex: 1,
      simulationTimeS: 0.02,
      wallClockTimeMs: 1000,
      spatialRevision: 1,
      acn: {
        posX: 0,
        posY: 0,
        posZ: 5000,
        velX: 50,
        velY: 0,
        velZ: 0,
        headingRad: 0,
        pitchDeg: 0,
        altitudeMslM: 5000,
        altitudeAglM: 5000,
        coverageRadiusKm: 40,
        isTerrainClamped: false,
      },
      nodes: [
        {
          nodeId: 1,
          posX: 100,
          posY: 200,
          posZ: 0.0,
          altitudeMslM: 0.0,
          altitudeAglM: 0.0,
          isLos: true,
          isOutage: false,
          isObstacleBlocked: false,
          snrDb: 12.34,
          currentState: NodeTerrainState.NORMAL_LOS,
        },
        {
          nodeId: 2,
          posX: 300,
          posY: 400,
          posZ: Number.NaN,
          altitudeMslM: Number.NaN,
          altitudeAglM: Number.NaN,
          isLos: false,
          isOutage: true,
          isObstacleBlocked: false,
          snrDb: Number.NaN,
          currentState: NodeTerrainState.HARD_SHADOW_CUTOFF,
        },
      ],
      selectedLinkBudget: null,
    };

    expect(buf.append(snap, 1)).toBe(true);
    const out = buf.newestSnapshot!;
    expect(out.nodes[0].posZ).toBe(0.0);
    expect(out.nodes[0].altitudeAglM).toBe(0.0);
    expect(out.nodes[0].snrDb).toBeCloseTo(12.34, 2);

    expect(Number.isNaN(out.nodes[1].posZ)).toBe(true);
    expect(Number.isNaN(out.nodes[1].altitudeAglM)).toBe(true);
    expect(Number.isNaN(out.nodes[1].snrDb)).toBe(true);
  });

  it('P2-6: WorldTileLayer MAX_VISIBLE_TILES_PER_FRAME is strictly < 64 cache capacity', () => {
    expect(MAX_VISIBLE_TILES_PER_FRAME).toBeLessThan(64);
  });

  it('P2-8: soldierEudRenderer formats negative SINR cleanly without +- double sign', () => {
    const banner = resolveSoldierAiNotificationBanner(
      { ai_is_pinned: true, sinr_db: -3.5 },
      true,
      true,
      'Repositioning'
    );
    expect(banner.title).toContain('-3.5 dB');
    expect(banner.title).not.toContain('+-');
  });

  it('P2-2: public/sw.js precaches ./docs.html for offline support', () => {
    const swContent = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');
    expect(swContent).toContain("'./docs.html'");
  });

  it('P2-3: ts_parity_server rejects locked SET_BIOME and strips biomeId before CONFIG_UPDATE', async () => {
    const server = createTsParityServer({ host: '127.0.0.1', port: 0, apiToken: 'final01-test-token' });
    const { port } = await server.start();
    try {
      server.getWorker().handleCommand({ type: 'SET_SPATIAL_LOCK', locked: true });
      const lockedRes = await makeHttpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/config',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer final01-test-token',
          },
        },
        JSON.stringify({ biomeId: 'arid_desert', rain_rate_mmh: 5 })
      );
      expect(lockedRes.statusCode).toBe(409);

      server.getWorker().handleCommand({ type: 'SET_SPATIAL_LOCK', locked: false });
      const unlockedRes = await makeHttpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/config',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer final01-test-token',
          },
        },
        JSON.stringify({ biomeId: 'arid_desert', rain_rate_mmh: 5 })
      );
      expect(unlockedRes.statusCode).toBe(200);
      expect(server.getWorker().biomeId).toBe('arid_desert');
    } finally {
      await server.stop();
    }
  });
});
