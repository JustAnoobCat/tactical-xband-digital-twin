/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Phase 2E: TerrainMeshGenerator Verification Suite
 *
 * Verifies:
 * 1. Synthetic terrain grid dimensions (512x512) and bounding box telemetry.
 * 2. North/South (Row 0 = North, Row 511 = South) and West/East (Col 0 = West, Col 511 = East) grid orientation.
 * 3. Min/Max elevation consistency with actual sampled matrix extrema.
 * 4. Real DEM direct-copy sample preservation with zero loss across all 262,144 values.
 * 5. Non-finite (NaN / Infinity) elevation handling.
 * 6. Transfer-list buffer identity: transferList[0] strictly matches elevations.buffer.
 * 7. Repeated generation without unintended mutation or detachment of TerrainEngine state.
 * 8. SimulationWorkerManager integration preserving existing GET_TERRAIN_MESH_DATA command handling.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TerrainEngine, REAL_LADAKH_DEM_METADATA } from '../core/terrain';
import { TerrainMeshGenerator } from '../worker/terrainMeshGenerator';
import { SimulationWorkerManager } from '../worker/simWorker';
import { THEATER_HALF_M } from '../shared/constants';

function runTerrainMeshGeneratorVerification(): void {
  console.log('================================================================================');
  console.log('  PHASE 2E: TERRAIN MESH GENERATOR VERIFICATION SUITE');
  console.log('================================================================================');

  // --------------------------------------------------------------------------
  // Test 1: Synthetic Terrain Grid Dimensions and Bounds
  // --------------------------------------------------------------------------
  console.log('\n[1/8] Verifying synthetic terrain grid dimensions and bounds...');
  const synthEngine = new TerrainEngine({
    theaterExtentM: THEATER_HALF_M,
    terrainMode: 'synthetic',
  });
  const synthResult = TerrainMeshGenerator.generate(synthEngine, 'req-synth-001');

  assert.equal(synthResult.message.type, 'TERRAIN_MESH_DATA_READY');
  assert.equal(synthResult.message.request_id, 'req-synth-001');
  assert.equal(synthResult.message.terrain_mode, 'synthetic');
  assert.equal(synthResult.message.grid_size, 512);
  assert.equal(synthResult.message.elevations.length, 512 * 512);
  assert.equal(synthResult.message.elevations.byteLength, 512 * 512 * 4);

  const synthBounds = synthResult.message.bounds;
  assert.equal(synthBounds.minX, -THEATER_HALF_M);
  assert.equal(synthBounds.maxX, THEATER_HALF_M);
  assert.equal(synthBounds.minY, -THEATER_HALF_M);
  assert.equal(synthBounds.maxY, THEATER_HALF_M);
  console.log('  -> PASS: Synthetic 512x512 matrix and theater bounds verified.');

  // --------------------------------------------------------------------------
  // Test 2: North/South and East/West Grid Orientation
  // --------------------------------------------------------------------------
  console.log('\n[2/8] Verifying grid orientation (Row 0=North, Col 0=West)...');
  const stepX = (synthBounds.maxX - synthBounds.minX) / 511.0;
  const stepY = (synthBounds.maxY - synthBounds.minY) / 511.0;

  // Check 4 corners
  const nwExpected = Math.fround(synthEngine.getElevation(synthBounds.minX, synthBounds.maxY));
  const neExpected = Math.fround(synthEngine.getElevation(synthBounds.maxX, synthBounds.maxY));
  const swExpected = Math.fround(synthEngine.getElevation(synthBounds.minX, synthBounds.minY));
  const seExpected = Math.fround(synthEngine.getElevation(synthBounds.maxX, synthBounds.minY));

  const nwActual = synthResult.message.elevations[0 * 512 + 0];
  const neActual = synthResult.message.elevations[0 * 512 + 511];
  const swActual = synthResult.message.elevations[511 * 512 + 0];
  const seActual = synthResult.message.elevations[511 * 512 + 511];

  assert.equal(nwActual, nwExpected, 'Northwest corner (r=0, c=0) elevation mismatch');
  assert.equal(neActual, neExpected, 'Northeast corner (r=0, c=511) elevation mismatch');
  assert.equal(swActual, swExpected, 'Southwest corner (r=511, c=0) elevation mismatch');
  assert.equal(seActual, seExpected, 'Southeast corner (r=511, c=511) elevation mismatch');

  // Check intermediate sample points
  const samplePoints = [
    { r: 128, c: 128 },
    { r: 256, c: 256 },
    { r: 384, c: 300 },
  ];
  for (const pt of samplePoints) {
    const xM = synthBounds.minX + pt.c * stepX;
    const yM = synthBounds.maxY - pt.r * stepY;
    const expected = Math.fround(synthEngine.getElevation(xM, yM));
    const actual = synthResult.message.elevations[pt.r * 512 + pt.c];
    assert.equal(actual, expected, `Intermediate point (r=${pt.r}, c=${pt.c}) elevation mismatch`);
  }
  console.log('  -> PASS: Grid coordinate registration and corner orientations strictly verified.');

  // --------------------------------------------------------------------------
  // Test 3: Min/Max Elevation Consistency
  // --------------------------------------------------------------------------
  console.log('\n[3/8] Verifying min/max elevation consistency...');
  let scannedMin = Number.POSITIVE_INFINITY;
  let scannedMax = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < synthResult.message.elevations.length; i++) {
    const val = synthResult.message.elevations[i];
    if (Number.isFinite(val)) {
      if (val < scannedMin) scannedMin = val;
      if (val > scannedMax) scannedMax = val;
    }
  }

  assert.ok(Math.abs(synthResult.message.min_elevation_m - scannedMin) < 1e-3, 'Reported min elevation mismatch');
  assert.ok(Math.abs(synthResult.message.max_elevation_m - scannedMax) < 1e-3, 'Reported max elevation mismatch');
  assert.ok(synthResult.message.min_elevation_m <= synthResult.message.max_elevation_m, 'min must be <= max');
  assert.ok(Number.isFinite(synthResult.message.min_elevation_m), 'min must be finite');
  assert.ok(Number.isFinite(synthResult.message.max_elevation_m), 'max must be finite');
  console.log(`  -> PASS: Elevation range [${scannedMin.toFixed(2)} m, ${scannedMax.toFixed(2)} m] matches grid samples.`);

  // --------------------------------------------------------------------------
  // Test 4: Real DEM Direct-Copy Value Preservation
  // --------------------------------------------------------------------------
  console.log('\n[4/8] Verifying real DEM direct-copy value preservation...');
  const realEngine = new TerrainEngine({
    theaterExtentM: THEATER_HALF_M,
    terrainMode: 'real',
  });
  const demPath = path.resolve(process.cwd(), 'public/terrain/real_ladakh_dem.bin');
  assert.ok(fs.existsSync(demPath), `Real Ladakh DEM binary must exist at ${demPath}`);
  const demBuf = fs.readFileSync(demPath);
  const demArray = new Float32Array(demBuf.buffer, demBuf.byteOffset, 512 * 512);
  const loadedOk = realEngine.loadCustomDem(demArray);
  assert.ok(loadedOk, 'Failed to load real Ladakh DEM array');

  const realResult = TerrainMeshGenerator.generate(realEngine, 'req-real-001');
  assert.equal(realResult.message.terrain_mode, 'real');
  assert.equal(realResult.message.grid_size, 512);
  assert.equal(realResult.message.elevations.length, 512 * 512);

  // Exact 1:1 float matching across all 262,144 values
  let differences = 0;
  for (let i = 0; i < demArray.length; i++) {
    if (realResult.message.elevations[i] !== demArray[i]) {
      differences++;
    }
  }
  assert.equal(differences, 0, 'Direct-copy must preserve 100% of DEM elevation values with zero delta');

  // Verify known Ladakh elevation bounds
  assert.ok(
    realResult.message.min_elevation_m >= 1900 && realResult.message.min_elevation_m <= 2100,
    `Ladakh min elevation ${realResult.message.min_elevation_m} outside expected range`
  );
  assert.ok(
    realResult.message.max_elevation_m >= 7300 && realResult.message.max_elevation_m <= 7500,
    `Ladakh max elevation ${realResult.message.max_elevation_m} outside expected range`
  );
  console.log(`  -> PASS: Real Ladakh DEM direct copy verified (262,144 floats match exactly; [${realResult.message.min_elevation_m.toFixed(2)}, ${realResult.message.max_elevation_m.toFixed(2)}]).`);

  // --------------------------------------------------------------------------
  // Test 5: Non-Finite Elevation Handling
  // --------------------------------------------------------------------------
  console.log('\n[5/8] Verifying non-finite elevation handling...');
  const customGrid = new Float32Array(512 * 512);
  customGrid.fill(3000.0);
  // Inject NaNs and Infinities
  customGrid[0] = Number.NaN;
  customGrid[1] = Number.POSITIVE_INFINITY;
  customGrid[2] = Number.NEGATIVE_INFINITY;
  customGrid[100] = 1234.5;
  customGrid[200] = 5432.1;

  const nonFiniteEngine = new TerrainEngine({
    theaterExtentM: THEATER_HALF_M,
    terrainMode: 'real',
  });
  nonFiniteEngine.loadCustomDem(customGrid);

  const nonFiniteResult = TerrainMeshGenerator.generate(nonFiniteEngine, 'req-non-finite');
  assert.equal(nonFiniteResult.message.min_elevation_m, Math.fround(1234.5), 'min_elevation_m should ignore NaN and -Infinity');
  assert.equal(nonFiniteResult.message.max_elevation_m, Math.fround(5432.1), 'max_elevation_m should ignore NaN and +Infinity');

  // All-NaN fallback check
  const allNanGrid = new Float32Array(512 * 512);
  allNanGrid.fill(Number.NaN);
  const allNanEngine = new TerrainEngine({
    theaterExtentM: THEATER_HALF_M,
    terrainMode: 'real',
  });
  allNanEngine.loadCustomDem(allNanGrid);
  const allNanResult = TerrainMeshGenerator.generate(allNanEngine, 'req-all-nan');
  assert.equal(allNanResult.message.min_elevation_m, 0, 'All-NaN grid should fall back to min 0');
  assert.equal(allNanResult.message.max_elevation_m, 5000, 'All-NaN grid should fall back to max 5000');
  console.log('  -> PASS: Non-finite elevations handled safely with valid numeric fallbacks.');

  // --------------------------------------------------------------------------
  // Test 6: Transfer-List Buffer Identity
  // --------------------------------------------------------------------------
  console.log('\n[6/8] Verifying transfer-list buffer identity...');
  assert.ok(Array.isArray(synthResult.transferList), 'transferList must be an array');
  assert.equal(synthResult.transferList.length, 1, 'transferList must contain exactly 1 buffer');
  assert.equal(
    synthResult.transferList[0],
    synthResult.message.elevations.buffer,
    'transferList[0] must be exactly the Float32Array underlying buffer'
  );

  assert.ok(Array.isArray(realResult.transferList), 'transferList must be an array');
  assert.equal(realResult.transferList.length, 1, 'transferList must contain exactly 1 buffer');
  assert.equal(
    realResult.transferList[0],
    realResult.message.elevations.buffer,
    'transferList[0] must be exactly the Float32Array underlying buffer'
  );
  console.log('  -> PASS: Zero-copy ArrayBuffer transfer list identity confirmed.');

  // --------------------------------------------------------------------------
  // Test 7: Repeated Generation Without Unintended Mutation
  // --------------------------------------------------------------------------
  console.log('\n[7/8] Verifying repeated generation does not mutate TerrainEngine...');
  const originalDemRef = realEngine.realDemGrid;
  assert.ok(originalDemRef !== null, 'realDemGrid must be present');
  const sampleBefore = realEngine.getElevation(0, 0);

  for (let iter = 0; iter < 5; iter++) {
    const res = TerrainMeshGenerator.generate(realEngine, `req-iter-${iter}`);
    assert.equal(res.message.grid_size, 512);
    // Note: each call generates a new copy in transferGrid, leaving realDemGrid untouched
    assert.equal(realEngine.realDemGrid, originalDemRef, 'realEngine.realDemGrid reference must not change');
    assert.equal(realEngine.realDemGrid!.byteLength, 512 * 512 * 4, 'realEngine.realDemGrid buffer must not be detached');
  }

  const sampleAfter = realEngine.getElevation(0, 0);
  assert.equal(sampleBefore, sampleAfter, 'Elevation query at origin must remain identical');
  console.log('  -> PASS: TerrainEngine internal state and buffers remain unmutated across repeated calls.');

  // --------------------------------------------------------------------------
  // Test 8: SimulationWorkerManager GET_TERRAIN_MESH_DATA Integration
  // --------------------------------------------------------------------------
  console.log('\n[8/8] Verifying SimulationWorkerManager GET_TERRAIN_MESH_DATA integration...');
  const manager = new SimulationWorkerManager();
  manager.terrainEngine.loadCustomDem(demArray);

  const emittedMessages: any[] = [];
  const emittedTransfers: any[] = [];
  (manager as any).emitHostMessage = (msg: any, transfers?: any[]) => {
    emittedMessages.push(msg);
    if (transfers) emittedTransfers.push(transfers);
  };

  const commandResult = manager.handleMessage({
    type: 'GET_TERRAIN_MESH_DATA',
    request_id: 'worker-mesh-req-042',
  });

  assert.equal(commandResult.accepted, true, 'Command must be accepted');
  assert.equal(commandResult.command_type, 'GET_TERRAIN_MESH_DATA');

  // Find the TERRAIN_MESH_DATA_READY message emitted to host
  const meshMsg = emittedMessages.find((m) => m.type === 'TERRAIN_MESH_DATA_READY');
  assert.ok(meshMsg, 'TERRAIN_MESH_DATA_READY message must be emitted to host');
  assert.equal(meshMsg.request_id, 'worker-mesh-req-042');
  assert.equal(meshMsg.grid_size, 512);
  assert.equal(meshMsg.elevations.length, 512 * 512);

  // Verify transfer list was passed to emitHostMessage
  assert.ok(emittedTransfers.length >= 1, 'Transfer list must be emitted');
  const lastTransfer = emittedTransfers[emittedTransfers.length - 1];
  assert.equal(lastTransfer[0], meshMsg.elevations.buffer, 'Emitted transfer must match elevations buffer');

  // Verify simulation tick still operates flawlessly after mesh generation
  const simTimeBefore = manager.simTimeS;
  manager.tickSimulation(false);
  assert.equal(manager.simTimeS, simTimeBefore + 0.02, 'tickSimulation must advance by 0.02s');
  console.log('  -> PASS: Worker dispatch, host message emission, and subsequent tick executed seamlessly.');

  console.log('================================================================================');
  console.log('  ALL 8 TERRAIN MESH GENERATOR VERIFICATION TESTS PASSED CLEANLY!');
  console.log('================================================================================');
}

runTerrainMeshGeneratorVerification();
