/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Verification Suite: Scientific RF & Topographic Analysis Toolbox (SPEC-TERRAIN-TOOLBOX-SCI-01-REV2)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeDemGridStats,
  REAL_LADAKH_DEM_METADATA,
  TerrainEngine,
  type DemGeographicMetadata,
} from '../core/terrain';
import { EnvironmentConfig, RFConfig, MAX_ACN_WAYPOINTS } from '../core/config';
import { LinkBudgetEngine } from '../core/linkBudget';
import { MAX_ACTIVE_GROUND_NODES } from '../shared/constants';
import {
  analyzeRegionZonal,
  canAddNodeFromToolbox,
  canApplyTransectAsAcnWaypoints,
  computeAltitudeSweep,
  computeOrbitPersistence,
  computeSiteProbeViewshed,
  computeSlopeAndRidgeGrid,
  evaluateTransect,
  exportRegionGeoJson,
  exportTransectCsv,
  findJointRelayBridge,
  getDemProvenanceSummary,
  type ToolboxSimulationContext,
} from '../ui/terrainToolboxAnalysis';
import {
  encodeBridgeHeatmapRgba,
  encodeSlopeRidgeRgba,
  encodeViewshedRgba,
  transectCanvasXToSampleIndex,
} from '../ui/terrainToolboxCharts';

function testAc1DemStatsAndNonClobber(): void {
  console.log('[AC-1] Testing computeDemGridStats, loadCustomDem metadata & M1 non-clobber...');

  const grid = new Float32Array([3100, Number.NaN, -32768, 4520, 5120, 2980]);
  const stats = computeDemGridStats(grid);
  assert.equal(stats.minElevationM, 2980, 'minElevationM ignores NaN and -32768 voids');
  assert.equal(stats.maxElevationM, 5120, 'maxElevationM ignores NaN and -32768 voids');
  assert.equal(stats.voidCount, 2, 'voidCount counts both NaN and -32768');

  const allVoidStats = computeDemGridStats(new Float32Array([Number.NaN, -32768]));
  assert.equal(allVoidStats.minElevationM, 0);
  assert.equal(allVoidStats.maxElevationM, 0);
  assert.equal(allVoidStats.voidCount, 2);

  // loadCustomDem fills omitted stats and freezes demMetadata
  const engine = new TerrainEngine();
  const custom1201 = new Float32Array(1201 * 1201);
  custom1201.fill(4000);
  custom1201[0] = 3210;
  custom1201[1] = 5890;
  custom1201[2] = Number.NaN;
  const partialMeta: DemGeographicMetadata = {
    ...REAL_LADAKH_DEM_METADATA,
    rasterWidth: 1201,
    rasterHeight: 1201,
    tileName: 'N34E076',
  };
  engine.loadCustomDem(custom1201, partialMeta);
  assert.equal(engine.demMetadata.tileName, 'N34E076');
  assert.equal(engine.demMetadata.minElevationM, 3210);
  assert.equal(engine.demMetadata.maxElevationM, 5890);
  assert.equal(engine.demMetadata.voidCount, 1);
  assert.ok(Object.isFrozen(engine.demMetadata), 'demMetadata must be frozen');

  // Verify index.html M1 non-clobber & upload direct loadCustomDem & preset rain rule
  const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  assert.ok(
    html.includes('mainTerrainEngine.loadCustomDem(parseResult.elevations, parseResult.metadata)'),
    'HGT upload handler calls mainTerrainEngine.loadCustomDem directly',
  );
  assert.ok(
    html.includes('mainTerrainEngine.loadCustomDem(mosaic.elevations, mosaic.metadata)'),
    'Mosaic upload handler calls mainTerrainEngine.loadCustomDem directly',
  );
  assert.ok(
    html.includes('!mainTerrainEngine.hasRealDem'),
    'handleTerrainMeshDataResponse guards against overwriting mainTerrainEngine.realDemGrid when hasRealDem is true',
  );
  assert.ok(
    html.includes("id === 'PRESET_MONSOON'") && html.includes("id === 'PRESET_AMBUSH'"),
    'loadPreset syncs #param-rain only on PRESET_MONSOON and PRESET_AMBUSH',
  );
  assert.ok(html.includes('id="terrain-toolbox-stack"'), 'Unified #terrain-toolbox-stack present');
  assert.ok(html.includes('id="terrain-toolbox-drawer"'), 'Scrollable #terrain-toolbox-drawer present');
  assert.ok(html.includes('maplibre-probe-viewshed') && html.includes('maplibre-bridge-heatmap'), 'M4 MapLibre image sources wired');
  assert.ok(html.includes('canAddNodeFromToolbox') && html.includes('MAX_ACTIVE_GROUND_NODES'), 'M2 capacity gate wired in index.html');
}

function makeCtx(terrainEngine: TerrainEngine, overrides: Partial<ToolboxSimulationContext> = {}): ToolboxSimulationContext {
  return {
    terrainEngine,
    rfConfig: new RFConfig(),
    envConfig: new EnvironmentConfig({ rainRateMmH: 0 }),
    acnPositionMslM: [0, 0, 5500],
    trajectoryConfig: null,
    groundNodes: [],
    spatialRevision: 1,
    isHistoricalInspecting: false,
    spatialLocked: false,
    ...overrides,
  };
}

function testAc2PhysicsParityAndCoverage(): void {
  console.log('[AC-2] Testing Mode 2 physics parity & out-of-coverage guards...');
  const engine = new TerrainEngine({ terrainMode: 'synthetic' });
  const ctx = makeCtx(engine, { envConfig: new EnvironmentConfig({ rainRateMmH: 12 }) });

  const ptA = { xM: -4000, yM: 0, aglM: 2, heightMode: 'ground_agl' as const };
  const ptB = { xM: 12000, yM: 3000, aglM: 0, heightMode: 'acn_alt' as const };

  const res = evaluateTransect(ctx, [ptA, ptB], { includeObstacles: true, nodeType: 'soldier' });
  assert.equal(res.segments.length, 1);
  const seg = res.segments[0];
  assert.equal(seg.isCoverageComplete, true);
  assert.ok(seg.linkStatus !== null);

  const zA = engine.getElevation(ptA.xM, ptA.yM) + ptA.aglM;
  const zB = ctx.acnPositionMslM![2];
  const obs = engine.evaluateTerrainObstruction([ptA.xM, ptA.yM, zA], [ptB.xM, ptB.yM, zB], ctx.rfConfig, ctx.envConfig);
  const d3D = Math.hypot(ptB.xM - ptA.xM, ptB.yM - ptA.yM, zB - zA);
  const lb = new LinkBudgetEngine().evaluateLink('soldier', d3D, obs.diffractionLossDb, ctx.rfConfig, ctx.envConfig, obs.obstacleBlocked);

  assert.ok(Math.abs(seg.diffractionLossDb - obs.diffractionLossDb) < 1e-6, 'diffractionLossDb matches TerrainEngine');
  assert.ok(Math.abs(seg.minClearanceM - obs.minClearanceM) < 1e-6, 'minClearanceM matches TerrainEngine');
  assert.ok(Math.abs(seg.linkStatus!.snrDb - lb.snrDb) < 1e-6, 'snrDb matches LinkBudgetEngine');
  assert.equal(seg.linkStatus!.modcodName, lb.modcodName);
  assert.ok(Math.abs(seg.linkStatus!.rainLossDb - lb.rainLossDb) < 1e-6, 'rainLossDb matches LinkBudgetEngine');
  assert.equal(seg.obstacleBlocked, obs.obstacleBlocked);

  // Out-of-coverage guard in real DEM mode
  const realEngine = new TerrainEngine();
  const smallGrid = new Float32Array(64 * 64).fill(3500);
  realEngine.loadCustomDem(smallGrid, { ...REAL_LADAKH_DEM_METADATA, rasterWidth: 64, rasterHeight: 64 });
  const outCtx = makeCtx(realEngine);
  const outRes = evaluateTransect(outCtx, [
    { xM: 0, yM: 0, aglM: 2, heightMode: 'ground_agl' },
    { xM: 150000, yM: 0, aglM: 2, heightMode: 'ground_agl' },
  ], { includeObstacles: false, nodeType: 'soldier' });
  assert.equal(outRes.isCoverageComplete, false);
  assert.equal(outRes.segments[0].criticalRainRateMmH, null, 'M3: out-of-coverage R_crit must be null');

  const prov = getDemProvenanceSummary(realEngine, !outRes.isCoverageComplete);
  assert.equal(prov.outsideCoverageWarning, true);
}

function testAc3AnisotropicSlopeAndSpecular(): void {
  console.log('[AC-3] Testing anisotropic slope (dx != dy) & O(N) dual-pass specular...');
  // Planar ramp z = a*x + b*y with anisotropic dx != dy
  const w = 32;
  const h = 32;
  const halfW = 15500; // dx = 1000 m
  const halfH = 31000; // dy = 2000 m
  const a = 0.25;
  const b = 0.15;
  const ramp = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    const y = halfH - (r / (h - 1)) * (2 * halfH);
    for (let c = 0; c < w; c++) {
      const x = -halfW + (c / (w - 1)) * (2 * halfW);
      ramp[r * w + c] = 3500 + a * x + b * y;
    }
  }
  const realEngine = new TerrainEngine();
  realEngine.loadCustomDem(ramp, {
    rasterWidth: w,
    rasterHeight: h,
    centerLatDeg: 34.5,
    centerLonDeg: 76.5,
    minLatDeg: 34.2,
    maxLatDeg: 34.8,
    minLonDeg: 76.3,
    maxLonDeg: 76.7,
    halfWidthM: halfW,
    halfHeightM: halfH,
    groundResolutionXM: (2 * halfW) / (w - 1),
    groundResolutionYM: (2 * halfH) / (h - 1),
    minX: -halfW,
    maxX: halfW,
    minY: -halfH,
    maxY: halfH,
  });

  const expectedSlopeDeg = Math.atan(Math.hypot(a, b)) * (180 / Math.PI);
  const realSlope = computeSlopeAndRidgeGrid(realEngine);
  assert.ok(Math.abs(realSlope.slopeDeg[5 * w + 5] - expectedSlopeDeg) < 0.01, 'Interior real slope matches exact analytical gradient');
  assert.ok(Math.abs(realSlope.slopeDeg[0] - expectedSlopeDeg) < 0.01, 'Border (0,0) one-sided slope matches exact analytical gradient');

  // Synthetic mode slope check
  const synthRampEngine = new TerrainEngine({
    terrainMode: 'synthetic',
    customElevationFn: (xM, yM) => 3500 + a * xM + b * yM,
  });
  const synthSlope = computeSlopeAndRidgeGrid(synthRampEngine);
  assert.ok(Math.abs(synthSlope.slopeDeg[100 * 512 + 100] - expectedSlopeDeg) < 0.01, 'Synthetic mode slope samples getElevation()');

  // Specular flat valley fixture
  const valleyEngine = new TerrainEngine({
    terrainMode: 'synthetic',
    customElevationFn: () => 3000,
  });
  const valleyCtx = makeCtx(valleyEngine, { envConfig: new EnvironmentConfig({ effectiveEarthRadiusFactor: 1e9, rainRateMmH: 0 }) });
  const valleyRes = evaluateTransect(valleyCtx, [
    { xM: -5000, yM: 0, aglM: 100, heightMode: 'ground_agl' },
    { xM: 5000, yM: 0, aglM: 100, heightMode: 'ground_agl' },
  ], { includeObstacles: false, nodeType: 'soldier', kFactor: 1e9, sampleCount: 101 });
  const spec = valleyRes.segments[0].specular;
  assert.ok(spec !== null, 'Specular reflection point found on flat valley');
  assert.ok(Math.abs(spec!.xM) < 150, `Symmetric specular reflection occurs near midpoint, got xM=${spec!.xM}`);
}

function testAc5RainPhaseAAndAc6GatesAndAc7PhaseA(): void {
  console.log('[AC-5/6/7 Phase A] Testing R_crit M3 guards, capacity/lock gates, Zonal & exports...');
  const flatEngine = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 3000 });
  const ctx = makeCtx(flatEngine, { acnPositionMslM: [0, 0, 5000] });

  // M3: obstacle blocked -> criticalRainRateMmH === null
  flatEngine.obstacleField.replace([{ id: 'obs-1', shape: 'cuboid', xM: 0, yM: 0, widthM: 200, depthM: 200, heightM: 3000, rotationDeg: 0 }]);
  const blockedRes = evaluateTransect(ctx, [
    { xM: -5000, yM: 0, aglM: 2, heightMode: 'ground_agl' },
    { xM: 5000, yM: 0, aglM: 2, heightMode: 'ground_agl' },
  ], { includeObstacles: true, nodeType: 'soldier' });
  assert.equal(blockedRes.segments[0].obstacleBlocked, true);
  assert.equal(blockedRes.segments[0].criticalRainRateMmH, null, 'M3: obstacle-blocked R_crit must be null');

  // M3: zeroRainSnrDb < -1.5 -> criticalRainRateMmH === 0
  flatEngine.obstacleField.replace([]);
  const deepOutageRes = evaluateTransect(ctx, [
    { xM: -250000, yM: 0, aglM: 2, heightMode: 'ground_agl' },
    { xM: 250000, yM: 0, aglM: 2, heightMode: 'ground_agl' },
  ], { includeObstacles: false, nodeType: 'soldier' });
  assert.ok(deepOutageRes.segments[0].linkStatus!.snrDb < -1.5);
  assert.equal(deepOutageRes.segments[0].criticalRainRateMmH, 0, 'M3: zeroRainSnrDb < -1.5 gives R_crit === 0');

  // M3: coincident terminals (d3D <= 0) -> null, no NaN
  const coinRes = evaluateTransect(ctx, [
    { xM: 1000, yM: 1000, aglM: 2, heightMode: 'ground_agl' },
    { xM: 1000, yM: 1000, aglM: 2, heightMode: 'ground_agl' },
  ], { includeObstacles: false, nodeType: 'soldier' });
  assert.equal(coinRes.segments[0].criticalRainRateMmH, null, 'M3: coincident d3D <= 0 gives R_crit === null');
  assert.ok(!Number.isNaN(coinRes.totalHorizontalM));

  // M3: exact analytical R_crit root verification on clear 15 km link
  const okRes = evaluateTransect(ctx, [
    { xM: -7500, yM: 0, aglM: 2, heightMode: 'ground_agl' },
    { xM: 7500, yM: 0, aglM: 2, heightMode: 'ground_agl' },
  ], { includeObstacles: false, nodeType: 'soldier' });
  const rCrit = okRes.segments[0].criticalRainRateMmH;
  assert.ok(rCrit !== null && rCrit > 0, `Expected positive R_crit, got ${rCrit}`);
  const lbCheck = new LinkBudgetEngine().evaluateLink(
    'soldier',
    okRes.segments[0].slantDistanceM,
    okRes.segments[0].diffractionLossDb,
    ctx.rfConfig,
    new EnvironmentConfig({ ...ctx.envConfig, rainRateMmH: rCrit! }),
    false,
  );
  assert.ok(Math.abs(lbCheck.snrDb - (-1.5)) < 1e-6, `SNR at R_crit equals -1.5 dB outage floor, got ${lbCheck.snrDb}`);

  // Empty transect check -> zero NaN
  const emptyRes = evaluateTransect(ctx, [{ xM: 0, yM: 0, aglM: 2, heightMode: 'ground_agl' }]);
  assert.equal(emptyRes.valid, false);
  assert.ok(!Number.isNaN(emptyRes.totalHorizontalM));

  // AC-6: Gate & Capacity parity (MAX_ACTIVE_GROUND_NODES = 128)
  assert.equal(MAX_ACTIVE_GROUND_NODES, 128);
  assert.equal(canAddNodeFromToolbox(16, false, false), true, 'M2: Add Node allowed at 16 nodes');
  assert.equal(canAddNodeFromToolbox(127, false, false), true, 'M2: Add Node allowed at 127 nodes');
  assert.equal(canAddNodeFromToolbox(128, false, false), false, 'M2: Add Node blocked at 128 nodes');
  assert.equal(canAddNodeFromToolbox(4, true, false), false, 'Blocked when spatialLocked');
  assert.equal(canAddNodeFromToolbox(4, false, true), false, 'Blocked when historical inspecting');

  assert.equal(canApplyTransectAsAcnWaypoints(2, false, false), false, 'Waypoints < 3 rejected');
  assert.equal(canApplyTransectAsAcnWaypoints(3, false, false), true, 'Waypoints == 3 allowed');
  assert.equal(canApplyTransectAsAcnWaypoints(MAX_ACN_WAYPOINTS, false, false), true, 'Waypoints == 64 allowed');
  assert.equal(canApplyTransectAsAcnWaypoints(MAX_ACN_WAYPOINTS + 1, false, false), false, 'Waypoints > 64 rejected');
  assert.equal(canApplyTransectAsAcnWaypoints(4, true, false), false, 'Waypoints rejected when spatialLocked');
  assert.equal(canApplyTransectAsAcnWaypoints(4, false, true), false, 'Waypoints rejected when historical inspecting');

  // Zonal stats & CSV/GeoJSON exports + Mode 2 latency
  const t0 = performance.now();
  const clearRes = evaluateTransect(ctx, [
    { xM: -5000, yM: 0, aglM: 2, heightMode: 'ground_agl' },
    { xM: 5000, yM: 0, aglM: 15, heightMode: 'ground_agl' },
  ], { includeObstacles: true, nodeType: 'soldier' });
  const dtMode2 = performance.now() - t0;
  assert.ok(dtMode2 <= 25, `Mode 2 latency bounded (${dtMode2.toFixed(2)} ms)`);

  const csv = exportTransectCsv(clearRes);
  assert.ok(csv.includes('segment,dist_km,lat_deg,lon_deg,terrain_msl_m,eff_terrain_msl_m,los_msl_m,fresnel_06_lower_msl_m,clearance_m,nu,status'));

  const region = {
    id: 1,
    color: '#f59e0b',
    visible: true,
    points: [
      { x: -2000, y: -2000 },
      { x: 2000, y: -2000 },
      { x: 2000, y: 2000 },
      { x: -2000, y: 2000 },
    ],
  };
  const zonal = analyzeRegionZonal(ctx, region, { includeObstacles: false, nodeType: 'soldier' });
  assert.ok(Math.abs(zonal.areaKm2 - 16.0) < 1e-3, `Square 4km x 4km area = 16 km², got ${zonal.areaKm2}`);
  assert.equal(zonal.losCoveragePct, 100);
  const geojson = JSON.parse(exportRegionGeoJson(region, zonal));
  assert.equal(geojson.type, 'FeatureCollection');
  assert.equal(geojson.features[0].geometry.type, 'Polygon');
}

function testChartsPhaseAHelpers(): void {
  console.log('[Task A3] Testing slope/ridge RGBA void alpha & transect canvas sample mapping...');
  const gridWithVoid = new Float32Array(16);
  gridWithVoid.fill(3500);
  gridWithVoid[5] = Number.NaN;
  const eng = new TerrainEngine();
  eng.loadCustomDem(gridWithVoid, { ...REAL_LADAKH_DEM_METADATA, rasterWidth: 4, rasterHeight: 4 });
  const slopeGrid = computeSlopeAndRidgeGrid(eng);
  const rgba = encodeSlopeRidgeRgba(slopeGrid, 'slope', 4, 4);
  assert.equal(rgba.length, 4 * 4 * 4);
  assert.equal(rgba[5 * 4 + 3], 0, 'Void cell must have alpha === 0');
  assert.ok(rgba[0 * 4 + 3] > 0, 'Valid cell must have alpha > 0');

  const flatEng = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 3000 });
  const res = evaluateTransect(makeCtx(flatEng), [
    { xM: -2000, yM: 0, aglM: 2, heightMode: 'ground_agl' },
    { xM: 2000, yM: 0, aglM: 2, heightMode: 'ground_agl' },
  ], { sampleCount: 41 });
  assert.equal(transectCanvasXToSampleIndex(0, 280, res), null, 'Left pad returns null');
  const midIdx = transectCanvasXToSampleIndex(140, 280, res);
  assert.ok(midIdx !== null && midIdx >= 15 && midIdx <= 25, `Mid canvas maps near midpoint sample, got ${midIdx}`);
}

function testAc4ViewshedOrbitAndAltitudeSweep(): void {
  console.log('[AC-4] Testing slant-corrected viewshed, orbit persistence & altitude sweep...');
  // Steep knife-edge ridge fixture at x = 4000 m, peak = 4200 m over 3000 m valley
  const ridgeEngine = new TerrainEngine({
    terrainMode: 'synthetic',
    customElevationFn: (xM) => 3000 + 1200 * Math.exp(-Math.pow((xM - 4000) / 350, 2)),
  });
  const ctx = makeCtx(ridgeEngine, {
    acnPositionMslM: [8000, 0, 5000],
    trajectoryConfig: {
      trajectory_mode: 'ellipse',
      center_x_m: 0,
      center_y_m: 0,
      orbit_a_m: 12000,
      orbit_b_m: 8000,
      orbit_rotation_deg: 0,
      loiter_speed_mps: 60,
      acn_altitude_m: 5000,
      altitude_mode: 'fix',
      waypoints: [],
    },
  });

  const t0 = performance.now();
  const vs = computeSiteProbeViewshed(ctx, {
    xM: 0,
    yM: 0,
    observerAglM: 2,
    radiusM: 12000,
    targetMode: 'ground_agl',
    targetAglM: 2,
    includeObstacles: false,
  });
  const dtViewshed = performance.now() - t0;
  assert.equal(vs.nAzimuths, 180);
  assert.equal(vs.horizonMask.length, 180);
  assert.ok(dtViewshed <= 40, `Mode 3 viewshed bounded (${dtViewshed.toFixed(2)} ms)`);

  // Compare East ray (az = 90 deg -> index 45) cells against direct TerrainEngine.evaluateTerrainObstruction
  const azIdxEast = 45;
  const obsPos: [number, number, number] = [0, 0, ridgeEngine.getElevation(0, 0) + 2];
  let agree = 0;
  let compared = 0;
  for (let rIdx = 2; rIdx < vs.nRings; rIdx++) {
    const dist = (rIdx + 1) * vs.stepM;
    if (Math.abs(dist - 4000) < 400) continue; // skip exact ridge crest transition zone
    const tgtZ = ridgeEngine.getElevation(dist, 0) + 2;
    const direct = ridgeEngine.evaluateTerrainObstruction(obsPos, [dist, 0, tgtZ], ctx.rfConfig, ctx.envConfig, 100);
    const cellStatus = vs.statusGrid[azIdxEast * vs.nRings + rIdx];
    const directBlocked = !direct.isLos;
    const vsBlocked = cellStatus === 3;
    if (directBlocked === vsBlocked) agree++;
    compared++;
  }
  assert.ok(agree / compared >= 0.99, `Viewshed East ray agrees with TerrainEngine >= 99% (${agree}/${compared})`);

  // Orbit persistence
  const orbit = computeOrbitPersistence(ctx, 0, 0, 2, false, 'soldier');
  assert.equal(orbit.sampleCount, 72);
  assert.ok(orbit.orbitLosPct >= 0 && orbit.orbitLosPct <= 100);
  assert.ok(orbit.longestShadowWindowS !== null && orbit.longestShadowWindowS >= 0);

  // Altitude sweep: verify minClearAltitudeM achieves 0.6 F1 clearance when re-tested directly
  const sweep = computeAltitudeSweep(ctx, { kind: 'probe', xM: 0, yM: 0, aglM: 2 }, {
    minAltM: 3500,
    maxAltM: 8500,
    stepM: 500,
    includeObstacles: false,
    nodeType: 'soldier',
  });
  assert.ok(sweep.minClearAltitudeM !== null, 'minClearAltitudeM found on ridge fixture');
  const directAtMinClear = ridgeEngine.evaluateTerrainObstruction(
    obsPos,
    [8000, 0, sweep.minClearAltitudeM!],
    ctx.rfConfig,
    ctx.envConfig,
    100,
  );
  assert.ok(directAtMinClear.isLos && directAtMinClear.diffractionLossDb === 0, 'Direct check at minClearAltitudeM achieves 0.6 F1 clear LOS');
}

function testAc5AndAc7BridgeFinder(): void {
  console.log('[AC-5/7 Bridge] Testing Mode 4 Joint Relay Bridge Finder...');
  // Valley at 3000 m with central peak at (0, 0) blocking direct A(-8000,0) <-> B(+8000,0),
  // while open flanking passes around y = ±3200 have clear LOS to both A and B.
  const saddleEngine = new TerrainEngine({
    terrainMode: 'synthetic',
    customElevationFn: (xM, yM) => {
      const centralPeak = 2200 * Math.exp(-(xM * xM) / (2 * 800 * 800)) * Math.exp(-(yM * yM) / (2 * 900 * 900));
      return 3000 + centralPeak;
    },
  });
  const ctx = makeCtx(saddleEngine);
  const t0 = performance.now();
  const bridge = findJointRelayBridge(
    ctx,
    { xM: -8000, yM: 0, aglM: 2 },
    { xM: 8000, yM: 0, aglM: 2 },
    null,
    { relayAglM: 15, includeObstacles: false, nodeType: 'soldier' },
  );
  const dtBridge = performance.now() - t0;
  assert.ok(dtBridge <= 50, `Mode 4 Bridge Finder latency bounded (${dtBridge.toFixed(2)} ms)`);
  assert.ok(bridge.optimalBridge !== null, 'Bridge Finder locates valid relay cell');
  assert.equal(bridge.optimalBridge!.bothLos, true);
  assert.ok(bridge.optimalBridge!.bottleneckSnrDb > 0, `Positive bottleneck SNR, got ${bridge.optimalBridge!.bottleneckSnrDb}`);

  // Task B2 M4: Viewshed & Bridge canvas RGBA encoders (no GeoJSON polygons!)
  const vsFlat = computeSiteProbeViewshed(makeCtx(new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 3000 })), {
    xM: 0, yM: 0, observerAglM: 2, radiusM: 12000, targetMode: 'ground_agl', targetAglM: 2, includeObstacles: false,
  });
  const vsRgba = encodeViewshedRgba(vsFlat, 64);
  assert.equal(vsRgba.length, 64 * 64 * 4);
  assert.equal(vsRgba[3], 0, 'Corner outside viewshed circle must have alpha === 0');
  const centerPixelIdx = (32 * 64 + 32) * 4;
  assert.ok(vsRgba[centerPixelIdx + 3] > 0, 'Center inside viewshed has alpha > 0');

  const brRgba = encodeBridgeHeatmapRgba(bridge);
  assert.equal(brRgba.length, bridge.gridWidth * bridge.gridHeight * 4);
}

testAc1DemStatsAndNonClobber();
testAc2PhysicsParityAndCoverage();
testAc3AnisotropicSlopeAndSpecular();
testAc5RainPhaseAAndAc6GatesAndAc7PhaseA();
testChartsPhaseAHelpers();
testAc4ViewshedOrbitAndAltitudeSweep();
testAc5AndAc7BridgeFinder();
console.log('ALL CURRENT TESTS PASSED');
