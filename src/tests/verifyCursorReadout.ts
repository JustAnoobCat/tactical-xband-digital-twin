/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * M7.2: Geographic Cursor Readout Verification Suite
 *
 * Verifies:
 * 1. Radar origin displays exactly 34.50000°N, 76.50000°E and 34°30'00.0"N, 76°30'00.0"E.
 * 2. Cardinal direction movements (+North, -South, +East, -West) produce correct coordinate deltas.
 * 3. Terrain elevation matches TerrainEngine.getElevation() / getDemElevation().
 * 4. Out-of-coverage handling strictly displays 'N/A' and never fabricates synthetic elevation in real DEM mode.
 * 5. Complete coordinate and elevation consistency with Ground Node inventory (all 16 nodes).
 * 6. Neutral / inactive state when cursor is outside radar canvas interaction area.
 * 7. HTML HUD overlay generation and hover tooltip formatting.
 */

import assert from 'node:assert/strict';
import {
  computeRadarCursorReadout,
  renderCursorHudHtml,
} from '../ui/radarCursorReadout';
import {
  cartesianToGeodetic,
  DEM_COVERAGE_HALF_HEIGHT_M,
  DEM_COVERAGE_HALF_WIDTH_M,
  GEODESY_ORIGIN_LAT_DEG,
  GEODESY_ORIGIN_LON_DEG,
  METERS_PER_DEG_LAT,
  METERS_PER_DEG_LON,
} from '../core/geodesy';
import {
  REAL_LADAKH_DEM_METADATA,
  TerrainEngine,
} from '../core/terrain';
import { SimulationWorkerManager } from '../worker/simWorker';

function runCursorReadoutVerification(): void {
  console.log('================================================================================');
  console.log('  M7.2: GEOGRAPHIC CURSOR READOUT VERIFICATION SUITE');
  console.log('================================================================================');

  // Initialize TerrainEngine with authentic synthetic test DEM
  const terrain = new TerrainEngine({ terrainMode: 'real' });
  const dem = new Float32Array(512 * 512);
  for (let r = 0; r < 512; r++) {
    for (let c = 0; c < 512; c++) {
      // Deterministic elevation pattern: 2500m to 5500m
      dem[r * 512 + c] = 2500.0 + r * 5.0 + c * 1.0;
    }
  }
  terrain.loadCustomDem(dem);

  // --------------------------------------------------------------------------
  // [1/7] Radar Origin Readout
  // --------------------------------------------------------------------------
  console.log('\n[1/7] Verifying radar origin readout: (0, 0) <-> 34.50000°N, 76.50000°E...');
  const originReadout = computeRadarCursorReadout({
    xM: 0,
    yM: 0,
    isInsideRadar: true,
    terrainMode: 'real',
    getElevation: (x, y) => terrain.getDemElevation(x, y),
    isWithinCoverage: (x, y) => terrain.isWithinDemCoverage(x, y),
  });

  assert.equal(originReadout.isInsideRadar, true);
  assert.equal(originReadout.xM, 0);
  assert.equal(originReadout.yM, 0);
  assert.equal(originReadout.latDeg, GEODESY_ORIGIN_LAT_DEG);
  assert.equal(originReadout.lonDeg, GEODESY_ORIGIN_LON_DEG);
  assert.equal(originReadout.latDecimal, '34.50000°N');
  assert.equal(originReadout.lonDecimal, '76.50000°E');
  assert.equal(originReadout.latDms, '34°30\'00.0"N');
  assert.equal(originReadout.lonDms, '76°30\'00.0"E');
  assert.equal(originReadout.dmsFull, '34°30\'00.0"N, 76°30\'00.0"E');
  assert.equal(originReadout.isWithinCoverage, true);
  assert.ok(originReadout.terrainElevationMslM !== null);
  assert.ok(Math.abs(originReadout.terrainElevationMslM - terrain.getElevation(0, 0)) < 1e-6);
  assert.ok(originReadout.tooltipText.includes('34.50000°N, 76.50000°E'));
  assert.ok(originReadout.tooltipText.includes('34°30\'00.0"N, 76°30\'00.0"E'));
  console.log('  -> PASS: Radar origin strictly displays 34.50000°N, 76.50000°E with exact DMS.');

  // --------------------------------------------------------------------------
  // [2/7] Cardinal Directions
  // --------------------------------------------------------------------------
  console.log('\n[2/7] Verifying cardinal direction movements (+North, -South, +East, -West)...');
  const dM = 40000.0; // 40 km

  // North: +Y
  const north = computeRadarCursorReadout({
    xM: 0,
    yM: dM,
    isInsideRadar: true,
    terrainMode: 'real',
    getElevation: (x, y) => terrain.getDemElevation(x, y),
    isWithinCoverage: (x, y) => terrain.isWithinDemCoverage(x, y),
  });
  assert.ok(north.latDeg > GEODESY_ORIGIN_LAT_DEG, 'North movement must increase latitude');
  assert.equal(north.lonDeg, GEODESY_ORIGIN_LON_DEG, 'North movement must leave longitude unchanged');
  assert.equal(north.lonDecimal, '76.50000°E');
  const expectedNorthLat = 34.5 + dM / METERS_PER_DEG_LAT;
  assert.equal(north.latDecimal, `${expectedNorthLat.toFixed(5)}°N`);

  // South: -Y
  const south = computeRadarCursorReadout({
    xM: 0,
    yM: -dM,
    isInsideRadar: true,
    terrainMode: 'real',
    getElevation: (x, y) => terrain.getDemElevation(x, y),
    isWithinCoverage: (x, y) => terrain.isWithinDemCoverage(x, y),
  });
  assert.ok(south.latDeg < GEODESY_ORIGIN_LAT_DEG, 'South movement must decrease latitude');
  assert.equal(south.lonDeg, GEODESY_ORIGIN_LON_DEG, 'South movement must leave longitude unchanged');
  assert.equal(south.lonDecimal, '76.50000°E');
  const expectedSouthLat = 34.5 - dM / METERS_PER_DEG_LAT;
  assert.equal(south.latDecimal, `${expectedSouthLat.toFixed(5)}°N`);

  // East: +X
  const east = computeRadarCursorReadout({
    xM: dM,
    yM: 0,
    isInsideRadar: true,
    terrainMode: 'real',
    getElevation: (x, y) => terrain.getDemElevation(x, y),
    isWithinCoverage: (x, y) => terrain.isWithinDemCoverage(x, y),
  });
  assert.equal(east.latDeg, GEODESY_ORIGIN_LAT_DEG, 'East movement must leave latitude unchanged');
  assert.equal(east.latDecimal, '34.50000°N');
  assert.ok(east.lonDeg > GEODESY_ORIGIN_LON_DEG, 'East movement must increase longitude');
  const expectedEastLon = 76.5 + dM / METERS_PER_DEG_LON;
  assert.equal(east.lonDecimal, `${expectedEastLon.toFixed(5)}°E`);

  // West: -X
  const west = computeRadarCursorReadout({
    xM: -dM,
    yM: 0,
    isInsideRadar: true,
    terrainMode: 'real',
    getElevation: (x, y) => terrain.getDemElevation(x, y),
    isWithinCoverage: (x, y) => terrain.isWithinDemCoverage(x, y),
  });
  assert.equal(west.latDeg, GEODESY_ORIGIN_LAT_DEG, 'West movement must leave latitude unchanged');
  assert.equal(west.latDecimal, '34.50000°N');
  assert.ok(west.lonDeg < GEODESY_ORIGIN_LON_DEG, 'West movement must decrease longitude');
  const expectedWestLon = 76.5 - dM / METERS_PER_DEG_LON;
  assert.equal(west.lonDecimal, `${expectedWestLon.toFixed(5)}°E`);

  console.log('  -> PASS: All cardinal directions produce verified coordinate changes.');

  // --------------------------------------------------------------------------
  // [3/7] Terrain Elevation Matching TerrainEngine.getElevation()
  // --------------------------------------------------------------------------
  console.log('\n[3/7] Verifying terrain elevation fidelity against TerrainEngine.getElevation()...');
  const samplePoints = [
    [0, 0],
    [15000, 22000],
    [-30000, -45000],
    [60000, -25000],
    [-70000, 50000],
    [85000, 100000],
  ];

  for (const [x, y] of samplePoints) {
    const readout = computeRadarCursorReadout({
      xM: x,
      yM: y,
      isInsideRadar: true,
      terrainMode: 'real',
      getElevation: (px, py) => terrain.getDemElevation(px, py),
      isWithinCoverage: (px, py) => terrain.isWithinDemCoverage(px, py),
    });

    const authoritativeElev = terrain.getElevation(x, y);
    assert.equal(readout.isWithinCoverage, true);
    assert.ok(readout.terrainElevationMslM !== null);
    assert.ok(
      Math.abs(readout.terrainElevationMslM - authoritativeElev) < 1e-6,
      `Elevation mismatch at (${x}, ${y}): ${readout.terrainElevationMslM} vs ${authoritativeElev}`
    );
    assert.equal(
      readout.terrainElevationFormatted,
      `${Math.round(authoritativeElev).toLocaleString('en-US')} m`
    );
  }
  console.log(`  -> PASS: All ${samplePoints.length} test points match TerrainEngine.getElevation() with zero discrepancy.`);

  // --------------------------------------------------------------------------
  // [4/7] Out-of-Coverage Handling (Strict 'N/A', Zero Fabrication)
  // --------------------------------------------------------------------------
  console.log('\n[4/7] Verifying out-of-coverage handling (strict N/A, zero synthetic fabrication)...');
  const outPoints = [
    [DEM_COVERAGE_HALF_WIDTH_M + 100, 0],       // East boundary exceeded
    [-DEM_COVERAGE_HALF_WIDTH_M - 100, 0],      // West boundary exceeded
    [0, DEM_COVERAGE_HALF_HEIGHT_M + 100],      // North boundary exceeded
    [0, -DEM_COVERAGE_HALF_HEIGHT_M - 100],     // South boundary exceeded
    [150000, 200000],                           // Far out
    [-300000, -400000],                         // Far out
  ];

  for (const [x, y] of outPoints) {
    const readout = computeRadarCursorReadout({
      xM: x,
      yM: y,
      isInsideRadar: true,
      terrainMode: 'real',
      getElevation: (px, py) => terrain.getDemElevation(px, py),
      isWithinCoverage: (px, py) => terrain.isWithinDemCoverage(px, py),
    });

    assert.equal(readout.isWithinCoverage, false, `Point (${x}, ${y}) must be outside coverage`);
    assert.equal(readout.terrainElevationMslM, null, `Point (${x}, ${y}) elevation must be null`);
    assert.equal(readout.terrainElevationFormatted, 'N/A', `Point (${x}, ${y}) elevation string must be 'N/A'`);
    assert.ok(readout.hudLabel.includes('TERRAIN MSL N/A (Outside DEM)'));
    assert.ok(readout.tooltipText.includes('N/A (Outside DEM Coverage)'));

    // Check that coordinates still unproject faithfully without clamping
    const geo = cartesianToGeodetic(x, y);
    assert.equal(readout.latDeg, geo.latDeg);
    assert.equal(readout.lonDeg, geo.lonDeg);
  }

  // Exact boundary border check: +/- 1m
  const justInsideX = computeRadarCursorReadout({
    xM: DEM_COVERAGE_HALF_WIDTH_M - 1,
    yM: 0,
    isInsideRadar: true,
    terrainMode: 'real',
    getElevation: (px, py) => terrain.getDemElevation(px, py),
    isWithinCoverage: (px, py) => terrain.isWithinDemCoverage(px, py),
  });
  assert.equal(justInsideX.isWithinCoverage, true);
  assert.notEqual(justInsideX.terrainElevationFormatted, 'N/A');

  const justOutsideX = computeRadarCursorReadout({
    xM: DEM_COVERAGE_HALF_WIDTH_M + 1,
    yM: 0,
    isInsideRadar: true,
    terrainMode: 'real',
    getElevation: (px, py) => terrain.getDemElevation(px, py),
    isWithinCoverage: (px, py) => terrain.isWithinDemCoverage(px, py),
  });
  assert.equal(justOutsideX.isWithinCoverage, false);
  assert.equal(justOutsideX.terrainElevationFormatted, 'N/A');

  console.log('  -> PASS: Out-of-coverage coordinates reliably report N/A with zero synthetic fabrication.');

  // --------------------------------------------------------------------------
  // [5/7] Consistency with Ground Node Inventory Entries
  // --------------------------------------------------------------------------
  console.log('\n[5/7] Verifying 100% consistency with ground terminal inventory entries...');
  const sim = new SimulationWorkerManager();
  sim.terrainEngine.loadCustomDem(dem);
  (sim as any).resampleGroundNodeAltitudes();
  const nodes = sim.buildNodesTelemetry();
  assert.equal(nodes.length, 16, 'Expected 16 ground nodes in telemetry');

  for (const node of nodes) {
    const readout = computeRadarCursorReadout({
      xM: node.x_m,
      yM: node.y_m,
      isInsideRadar: true,
      terrainMode: 'real',
      getElevation: (px, py) => terrain.getDemElevation(px, py),
      isWithinCoverage: (px, py) => terrain.isWithinDemCoverage(px, py),
    });

    // Check decimal coordinates match inventory
    const expectedLatStr = `${Math.abs(node.lat_deg).toFixed(5)}°${node.lat_deg >= 0 ? 'N' : 'S'}`;
    const expectedLonStr = `${Math.abs(node.lon_deg).toFixed(5)}°${node.lon_deg >= 0 ? 'E' : 'W'}`;
    assert.equal(
      readout.latDecimal,
      expectedLatStr,
      `Node ${node.node_id} latDecimal ${readout.latDecimal} != inventory ${expectedLatStr}`
    );
    assert.equal(
      readout.lonDecimal,
      expectedLonStr,
      `Node ${node.node_id} lonDecimal ${readout.lonDecimal} != inventory ${expectedLonStr}`
    );

    // Check terrain elevation matches inventory
    assert.ok(readout.terrainElevationMslM !== null);
    assert.ok(
      Math.abs(readout.terrainElevationMslM - node.terrain_elevation_msl_m) < 1e-4,
      `Node ${node.node_id} terrain elevation mismatch: ${readout.terrainElevationMslM} vs ${node.terrain_elevation_msl_m}`
    );

    // Verify terrain elevation is separate from node total altitude (MSL) and AGL
    assert.equal(node.altitude_msl_m, node.terrain_elevation_msl_m + node.agl_m);
    assert.ok(
      readout.terrainElevationMslM < node.altitude_msl_m,
      `Node ${node.node_id} ground terrain must be lower than terminal altitude MSL (AGL offset)`
    );
  }
  console.log('  -> PASS: Cursor readout at all 16 ground node locations matches inventory coordinates and elevations.');

  // --------------------------------------------------------------------------
  // [6/7] Neutral / Inactive State Outside Radar Canvas
  // --------------------------------------------------------------------------
  console.log('\n[6/7] Verifying neutral / inactive state when cursor is outside radar canvas...');
  const outsideReadout = computeRadarCursorReadout({
    xM: 10000,
    yM: 20000,
    isInsideRadar: false, // pointer outside radar
    terrainMode: 'real',
    getElevation: (px, py) => terrain.getDemElevation(px, py),
  });

  assert.equal(outsideReadout.isInsideRadar, false);
  assert.equal(outsideReadout.latDecimal, '--');
  assert.equal(outsideReadout.lonDecimal, '--');
  assert.equal(outsideReadout.latDms, '--');
  assert.equal(outsideReadout.lonDms, '--');
  assert.equal(outsideReadout.dmsFull, '--');
  assert.equal(outsideReadout.terrainElevationMslM, null);
  assert.equal(outsideReadout.terrainElevationFormatted, '--');
  assert.equal(outsideReadout.hudLabel, 'CURSOR: OUTSIDE RADAR MAP');
  assert.ok(outsideReadout.tooltipText.includes('outside'));

  // Test with NaN coordinates
  const nanReadout = computeRadarCursorReadout({
    xM: Number.NaN,
    yM: 0,
    isInsideRadar: true,
  });
  assert.equal(nanReadout.isInsideRadar, false);
  assert.equal(nanReadout.latDecimal, '--');

  console.log('  -> PASS: Neutral state reliably suppresses coordinates and elevations when cursor is inactive.');

  // --------------------------------------------------------------------------
  // [7/7] HTML HUD Overlay Rendering & Tooltip Generation
  // --------------------------------------------------------------------------
  console.log('\n[7/7] Verifying HTML HUD overlay markup generation and tooltips...');
  const activeHtml = renderCursorHudHtml(originReadout);
  assert.ok(activeHtml.includes('34.50000°N, 76.50000°E'), 'HTML must include decimal coordinates');
  assert.ok(activeHtml.includes('34°30\'00.0"N, 76°30\'00.0"E'), 'HTML must include supplementary DMS');
  assert.ok(activeHtml.includes('Terrain MSL:'), 'HTML must clearly label Terrain MSL');
  assert.ok(activeHtml.includes('X: +0 m  Y: +0 m'), 'HTML must include local Cartesian coordinates');

  const inactiveHtml = renderCursorHudHtml(outsideReadout);
  assert.ok(inactiveHtml.includes('CURSOR: OUTSIDE RADAR MAP'), 'HTML must display neutral state when inactive');

  const outOfCoverageReadout = computeRadarCursorReadout({
    xM: 150000,
    yM: 150000,
    isInsideRadar: true,
    terrainMode: 'real',
    getElevation: (px, py) => terrain.getDemElevation(px, py),
    isWithinCoverage: (px, py) => terrain.isWithinDemCoverage(px, py),
  });
  const outOfCoverageHtml = renderCursorHudHtml(outOfCoverageReadout);
  assert.ok(outOfCoverageHtml.includes('N/A (Outside DEM)'), 'HTML must highlight out-of-coverage DEM state');
  console.log('  -> PASS: HTML overlay markup and hover tooltips format cleanly across all states.');

  console.log('\n================================================================================');
  console.log('  ALL 7 GEOGRAPHIC CURSOR READOUT VERIFICATION SUITES PASSED CLEANLY!');
  console.log('================================================================================');
}

runCursorReadoutVerification();
