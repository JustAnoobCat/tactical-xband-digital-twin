/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * M6.1 Task 4: Worker Hillshade and Genuine DEM Bounds Verification Suite
 *
 * Verifies:
 * 1. Real DEM hillshade grid dimensions and row structure (512x512).
 * 2. Genuine DEM geographic bounds telemetry matching REAL_LADAKH_DEM_METADATA (+/-91.8 km E-W, +/-110.9 km N-S).
 * 3. Metric ground resolution and ellipsoidal aspect ratio (~1.2079).
 * 4. Raster orientation and coordinate registration (Row 0 is North, Col 0 is West).
 * 5. Synthetic mode full-theater extent (+/-600 km, square 1:1 aspect ratio).
 * 6. Hillshade caching and performance (avoids repeated 512x512 matrix recomputation).
 * 7. Out-of-coverage and NaN elevation handling (emits 0 / transparent/invalid indicator).
 * 8. Host telemetry contract compatibility (HILLSHADE_READY, TERRAIN_BOUNDS_READY, frame telemetry).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REAL_LADAKH_DEM_METADATA,
  TerrainBoundsTelemetry,
} from '../core/terrain';
import { SimulationWorkerManager } from '../worker/simWorker';

function runHillshadeBoundsVerification(): void {
  console.log('================================================================================');
  console.log('  M6.1 TASK 4: WORKER HILLSHADE & GENUINE DEM BOUNDS VERIFICATION');
  console.log('================================================================================');

  const meta = REAL_LADAKH_DEM_METADATA;
  const manager = new SimulationWorkerManager();

  // Load real Ladakh DEM
  const demPath = path.resolve(process.cwd(), 'public/terrain/real_ladakh_dem.bin');
  assert.ok(fs.existsSync(demPath), `Real Ladakh DEM binary must exist at ${demPath}`);
  const demBuf = fs.readFileSync(demPath);
  const demArray = new Float32Array(demBuf.buffer, demBuf.byteOffset, 512 * 512);
  manager.terrainEngine.loadCustomDem(demArray);

  // Intercept worker emitted messages for telemetry verification
  const emittedMessages: any[] = [];
  (manager as any).emitHostMessage = (msg: any) => {
    emittedMessages.push(msg);
  };

  // Generate hillshade in real DEM mode
  manager.initHillshade(512);

  // --------------------------------------------------------------------------
  // Test 1: Real DEM Hillshade Grid Dimensions & Structure
  // --------------------------------------------------------------------------
  console.log('\n[1/8] Verifying real DEM hillshade grid dimensions and structure...');
  const realGrid = manager.hillshadeGrid;
  assert.ok(Array.isArray(realGrid), 'hillshadeGrid must be an array');
  assert.equal(realGrid.length, 512, 'Hillshade grid height must be exactly 512 rows');
  for (let r = 0; r < 512; r++) {
    assert.equal(realGrid[r].length, 512, `Row ${r} must have exactly 512 columns`);
  }
  // Check that interior samples contain non-zero packed RGB values
  const centerPixel = realGrid[256][256];
  assert.ok(typeof centerPixel === 'number' && centerPixel > 0, 'Center pixel must have valid packed color');
  const red = (centerPixel >> 16) & 255;
  const green = (centerPixel >> 8) & 255;
  const blue = centerPixel & 255;
  assert.ok(red >= 10 && red <= 255, `Red channel ${red} must be in [10, 255]`);
  assert.ok(green >= 14 && green <= 255, `Green channel ${green} must be in [14, 255]`);
  assert.ok(blue >= 20 && blue <= 255, `Blue channel ${blue} must be in [20, 255]`);
  console.log(`  Real DEM hillshade: 512x512 matrix, center pixel packed RGB: 0x${centerPixel.toString(16)} (R:${red}, G:${green}, B:${blue})`);

  // --------------------------------------------------------------------------
  // Test 2: Genuine DEM Geographic Bounds Telemetry
  // --------------------------------------------------------------------------
  console.log('\n[2/8] Verifying genuine DEM geographic bounds telemetry...');
  const realBounds = manager.getTerrainBounds();
  assert.equal(realBounds.terrainMode, 'real', 'terrainMode must be "real"');
  assert.equal(realBounds.isValidCoverage, true, 'isValidCoverage must be true for loaded DEM');
  assert.equal(realBounds.rasterWidth, 512, 'rasterWidth must be 512');
  assert.equal(realBounds.rasterHeight, 512, 'rasterHeight must be 512');
  assert.equal(realBounds.minX, -meta.halfWidthM, `minX must match -halfWidthM (-${meta.halfWidthM} m)`);
  assert.equal(realBounds.maxX, meta.halfWidthM, `maxX must match +halfWidthM (+${meta.halfWidthM} m)`);
  assert.equal(realBounds.minY, -meta.halfHeightM, `minY must match -halfHeightM (-${meta.halfHeightM} m)`);
  assert.equal(realBounds.maxY, meta.halfHeightM, `maxY must match +halfHeightM (+${meta.halfHeightM} m)`);
  assert.equal(realBounds.halfWidthM, meta.halfWidthM, `halfWidthM must match ${meta.halfWidthM}`);
  assert.equal(realBounds.halfHeightM, meta.halfHeightM, `halfHeightM must match ${meta.halfHeightM}`);
  console.log(`  Real DEM bounds: X [${realBounds.minX.toFixed(2)}, ${realBounds.maxX.toFixed(2)}] m, Y [${realBounds.minY.toFixed(2)}, ${realBounds.maxY.toFixed(2)}] m`);

  // --------------------------------------------------------------------------
  // Test 3: Metric Ground Resolution and Ellipsoidal Aspect Ratio
  // --------------------------------------------------------------------------
  console.log('\n[3/8] Verifying metric ground resolution and aspect ratio...');
  const expectedResX = (2.0 * meta.halfWidthM) / 511.0;
  const expectedResY = (2.0 * meta.halfHeightM) / 511.0;
  assert.ok(Math.abs(realBounds.groundResolutionXM - expectedResX) < 1e-6, `groundResolutionXM (${realBounds.groundResolutionXM}) must match ${expectedResX}`);
  assert.ok(Math.abs(realBounds.groundResolutionYM - expectedResY) < 1e-6, `groundResolutionYM (${realBounds.groundResolutionYM}) must match ${expectedResY}`);
  const aspectRatio = realBounds.halfHeightM / realBounds.halfWidthM;
  assert.ok(Math.abs(aspectRatio - (110931.4506 / 91839.9774)) < 1e-6, `Aspect ratio (${aspectRatio.toFixed(6)}) must match ~1.207878`);
  assert.ok(aspectRatio > 1.20 && aspectRatio < 1.21, 'Aspect ratio must reflect non-square ellipsoidal geometry');
  console.log(`  Ground resolution: dX = ${realBounds.groundResolutionXM.toFixed(3)} m/px, dY = ${realBounds.groundResolutionYM.toFixed(3)} m/px (ratio = ${aspectRatio.toFixed(4)})`);

  // --------------------------------------------------------------------------
  // Test 4: Raster Orientation & Coordinate Registration
  // --------------------------------------------------------------------------
  console.log('\n[4/8] Verifying raster orientation and point registration...');
  // Row 0 must be North (+halfHeightM), Row 511 must be South (-halfHeightM)
  // Col 0 must be West (-halfWidthM), Col 511 must be East (+halfWidthM)
  const nwWorld = manager.terrainEngine.demPixelToWorld(0, 0);
  assert.ok(Math.abs(nwWorld.xM - (-meta.halfWidthM)) < 1e-3, 'Pixel (0,0) must map to West boundary');
  assert.ok(Math.abs(nwWorld.yM - meta.halfHeightM) < 1e-3, 'Pixel (0,0) must map to North boundary');

  const seWorld = manager.terrainEngine.demPixelToWorld(511, 511);
  assert.ok(Math.abs(seWorld.xM - meta.halfWidthM) < 1e-3, 'Pixel (511,511) must map to East boundary');
  assert.ok(Math.abs(seWorld.yM - (-meta.halfHeightM)) < 1e-3, 'Pixel (511,511) must map to South boundary');

  const nwLatLon = manager.terrainEngine.worldToLatLon(nwWorld.xM, nwWorld.yM);
  assert.ok(Math.abs(nwLatLon.latDeg - meta.maxLatDeg) < 1e-4, 'NW corner latitude must be 35.5° N');
  assert.ok(Math.abs(nwLatLon.lonDeg - meta.minLonDeg) < 1e-4, 'NW corner longitude must be 75.5° E');
  console.log(`  Raster corners: NW (${nwLatLon.latDeg.toFixed(2)}°N, ${nwLatLon.lonDeg.toFixed(2)}°E), SE (${manager.terrainEngine.worldToLatLon(seWorld.xM, seWorld.yM).latDeg.toFixed(2)}°N, ${manager.terrainEngine.worldToLatLon(seWorld.xM, seWorld.yM).lonDeg.toFixed(2)}°E)`);

  // --------------------------------------------------------------------------
  // Test 5: Synthetic Mode Full Theater Extent
  // --------------------------------------------------------------------------
  console.log('\n[5/8] Verifying synthetic mode full-theater extent...');
  manager.handleMessage({ type: 'SET_TERRAIN_MODE', mode: 'synthetic' });
  const synthBounds = manager.getTerrainBounds();
  assert.equal(synthBounds.terrainMode, 'synthetic', 'terrainMode must be "synthetic"');
  assert.equal(synthBounds.minX, -600000.0, 'Synthetic minX must be -600,000 m');
  assert.equal(synthBounds.maxX, 600000.0, 'Synthetic maxX must be +600,000 m');
  assert.equal(synthBounds.minY, -600000.0, 'Synthetic minY must be -600,000 m');
  assert.equal(synthBounds.maxY, 600000.0, 'Synthetic maxY must be +600,000 m');
  assert.equal(synthBounds.halfWidthM, 600000.0, 'Synthetic halfWidthM must be 600,000 m');
  assert.equal(synthBounds.halfHeightM, 600000.0, 'Synthetic halfHeightM must be 600,000 m');
  assert.equal(synthBounds.groundResolutionXM, synthBounds.groundResolutionYM, 'Synthetic resolution must be square');
  assert.equal(manager.hillshadeGrid.length, 512, 'Synthetic hillshade height must be 512');
  assert.equal(manager.hillshadeGrid[0].length, 512, 'Synthetic hillshade width must be 512');
  console.log(`  Synthetic mode bounds: +/-600 km, square resolution = ${synthBounds.groundResolutionXM.toFixed(2)} m/px`);

  // --------------------------------------------------------------------------
  // Test 6: Hillshade Caching and Performance
  // --------------------------------------------------------------------------
  console.log('\n[6/8] Verifying hillshade caching and performance...');
  const synthGridRef1 = manager.hillshadeGrid;
  manager.initHillshade(512);
  const synthGridRef2 = manager.hillshadeGrid;
  assert.equal(synthGridRef1, synthGridRef2, 'Repeated initHillshade in synthetic mode must return identical cached reference');

  // Switch back to real mode
  manager.handleMessage({ type: 'SET_TERRAIN_MODE', mode: 'real' });
  const realGridRef1 = manager.hillshadeGrid;
  assert.notEqual(realGridRef1, synthGridRef1, 'Real mode grid must differ from synthetic grid');
  // Re-invoking in real mode must return cached real grid
  manager.initHillshade(512);
  const realGridRef2 = manager.hillshadeGrid;
  assert.equal(realGridRef1, realGridRef2, 'Repeated initHillshade in real mode must return identical cached reference');
  console.log('  Caching verified: cached grids reused without recomputation across mode switches.');

  // --------------------------------------------------------------------------
  // Test 7: Out-of-Coverage & NaN Elevation Handling
  // --------------------------------------------------------------------------
  console.log('\n[7/8] Verifying NaN elevation and out-of-coverage handling...');
  const customGridWithNaN = new Float32Array(512 * 512);
  customGridWithNaN.fill(3500.0);
  // Inject NaNs in a small test region
  customGridWithNaN[100 * 512 + 100] = Number.NaN;
  customGridWithNaN[100 * 512 + 101] = Number.NaN;
  manager.terrainEngine.loadCustomDem(customGridWithNaN);
  manager.initHillshade(512);

  const testGrid = manager.hillshadeGrid;
  // NaN pixel must be 0 (transparent / invalid pixel indicator)
  assert.equal(testGrid[100][100], 0, 'NaN elevation sample must yield packed pixel 0');
  assert.equal(testGrid[100][101], 0, 'NaN elevation sample must yield packed pixel 0');

  // Neighboring pixels must compute valid non-NaN finite packed colors using one-sided differences
  const neighborPixel = testGrid[100][99];
  assert.ok(typeof neighborPixel === 'number' && neighborPixel > 0, 'Neighbor of NaN sample must produce valid non-zero packed color');
  console.log(`  NaN sample handled: testGrid[100][100] = ${testGrid[100][100]}, neighbor = 0x${neighborPixel.toString(16)}`);

  // Restore authentic real Ladakh DEM
  manager.terrainEngine.loadCustomDem(demArray);
  manager.initHillshade(512);

  // --------------------------------------------------------------------------
  // Test 8: Host Telemetry Contract Compatibility
  // --------------------------------------------------------------------------
  console.log('\n[8/8] Verifying host telemetry emitted contracts...');
  emittedMessages.length = 0;

  // Test GET_HILLSHADE
  manager.handleMessage({ type: 'GET_HILLSHADE' });
  const hillshadeMsg = emittedMessages.find(m => m.type === 'HILLSHADE_READY');
  assert.ok(hillshadeMsg, 'Must emit HILLSHADE_READY message');
  assert.equal(hillshadeMsg.grid_size, 512, 'grid_size must be 512');
  assert.ok(Math.abs(hillshadeMsg.bounds_km - 91.8399774) < 1e-4, 'bounds_km must match 91.8399774 km');
  assert.equal(hillshadeMsg.terrain_mode, 'real', 'terrain_mode must be "real"');
  assert.ok(Array.isArray(hillshadeMsg.data) && hillshadeMsg.data.length === 512, 'data must be 512x512 array');
  assert.ok(hillshadeMsg.bounds && typeof hillshadeMsg.bounds === 'object', 'bounds telemetry object must be present');
  assert.equal(hillshadeMsg.bounds.minX, -meta.halfWidthM, 'bounds.minX must match -halfWidthM');

  // Test GET_TERRAIN_BOUNDS
  emittedMessages.length = 0;
  manager.handleMessage({ type: 'GET_TERRAIN_BOUNDS', request_id: 123 });
  const boundsMsg = emittedMessages.find(m => m.type === 'TERRAIN_BOUNDS_READY');
  assert.ok(boundsMsg, 'Must emit TERRAIN_BOUNDS_READY message');
  assert.equal(boundsMsg.request_id, 123, 'request_id must be preserved');
  assert.ok(boundsMsg.bounds, 'bounds object must be present');
  assert.equal(boundsMsg.bounds.terrainMode, 'real', 'bounds.terrainMode must be "real"');

  // Test frame telemetry from buildTelemetryFrame()
  const acnPos = manager.trajectoryEngine.getAcnPosition(manager.simTimeS);
  const frameTel = (manager as any).buildTelemetryFrame(acnPos);
  assert.equal(frameTel.terrain_mode, 'real', 'frame telemetry terrain_mode must be "real"');
  assert.ok(Math.abs(frameTel.terrain_bounds_km - 91.8399774) < 1e-4, 'frame telemetry terrain_bounds_km must be 91.8399774');
  assert.ok(frameTel.terrain_bounds, 'frame telemetry terrain_bounds must be present');
  assert.equal(frameTel.terrain_bounds.minX, -meta.halfWidthM, 'frame telemetry terrain_bounds.minX must match');

  console.log('  Telemetry contract verified: HILLSHADE_READY, TERRAIN_BOUNDS_READY, and frame telemetry verified.');

  console.log('\n================================================================================');
  console.log('  ALL 8 M6.1 TASK 4 VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================================');
}

runHillshadeBoundsVerification();

