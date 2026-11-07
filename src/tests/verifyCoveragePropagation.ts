/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * M6.1 Task 3: Safe Terrain Coverage Propagation & RF Telemetry Verification Suite
 *
 * Verifies:
 * 1. Fully covered unobstructed path preserves existing LOS behavior.
 * 2. Fully covered terrain-blocked path remains blocked.
 * 3. A ray beginning outside coverage is invalid.
 * 4. A ray ending outside coverage is invalid.
 * 5. A ray crossing the DEM boundary is invalid.
 * 6. NaN terrain samples cannot produce isLos = true.
 * 7. NaN terrain samples cannot produce zero diffraction loss as a valid result.
 * 8. Unknown coverage is classified as UNKNOWN.
 * 9. Verified obstacle blockage remains distinguishable from unknown terrain.
 * 10. Valid link profiles remain unchanged.
 * 11. Invalid link profiles display the appropriate unavailable state.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  Position3D,
  TerrainEngine,
  REAL_LADAKH_DEM_METADATA,
} from '../core/terrain';
import { RFConfig, EnvironmentConfig } from '../core/config';
import { classifyLinkCommunicationStatus } from '../core/linkStatusClassifier';
import { buildLinkProfile } from '../core/linkProfile';

function runCoveragePropagationVerification(): void {
  console.log('================================================================================');
  console.log('  M6.1 TASK 3: SAFE TERRAIN COVERAGE PROPAGATION & RF TELEMETRY VERIFICATION');
  console.log('================================================================================');

  const rf = new RFConfig();
  const env = new EnvironmentConfig();
  const meta = REAL_LADAKH_DEM_METADATA;

  // Initialize terrain engine and load real Ladakh satellite DEM
  const realTerrain = new TerrainEngine({ terrainMode: 'real' });
  const demPath = path.resolve(process.cwd(), 'public/terrain/real_ladakh_dem.bin');
  assert.ok(fs.existsSync(demPath), `DEM binary must exist at ${demPath}`);
  const demBuf = fs.readFileSync(demPath);
  const demArray = new Float32Array(demBuf.buffer, demBuf.byteOffset, 512 * 512);
  realTerrain.loadCustomDem(demArray);

  // --------------------------------------------------------------------------
  // Test 1: Fully covered unobstructed path preserves existing LOS behavior
  // --------------------------------------------------------------------------
  console.log('\n[1/11] Checking fully covered unobstructed path preserves existing LOS behavior...');
  // Terminal at valley floor (0, 0, 3400m MSL); ACN directly overhead at (0, 0, 5000m MSL)
  const valleyNode: Position3D = [0.0, 0.0, 3400.0];
  const acnOverhead: Position3D = [0.0, 0.0, 5000.0];
  const obsUnobstructed = realTerrain.evaluateTerrainObstruction(valleyNode, acnOverhead, rf, env);

  assert.equal(obsUnobstructed.isCoverageComplete, true, 'isCoverageComplete must be true for covered path');
  assert.equal(obsUnobstructed.isLos, true, 'isLos must be true for clear vertical LOS');
  assert.equal(obsUnobstructed.diffractionLossDb, 0.0, 'diffractionLossDb must be 0 dB for clear LOS');
  assert.ok(obsUnobstructed.minClearanceM > 0, 'minClearanceM must be positive');
  assert.equal(obsUnobstructed.coverageNote, undefined, 'coverageNote must be undefined for complete coverage');
  console.log(`  -> PASS: Pristine LOS clearance = ${obsUnobstructed.minClearanceM.toFixed(1)} m, diffraction = 0.0 dB.`);

  // --------------------------------------------------------------------------
  // Test 2: Fully covered terrain-blocked path remains blocked
  // --------------------------------------------------------------------------
  console.log('\n[2/11] Checking fully covered terrain-blocked path remains blocked...');
  // Tactical Node 4 at (12000, 8000, 3513m) to ACN across ridge at (-16383, -11471, 5000m)
  const node4Pos: Position3D = [12000.0, 8000.0, 3513.1];
  const acnBlockedPos: Position3D = [-16383.0, -11471.0, 5000.0];
  const obsBlocked = realTerrain.evaluateTerrainObstruction(node4Pos, acnBlockedPos, rf, env);

  assert.equal(obsBlocked.isCoverageComplete, true, 'Coverage must be complete for intra-theater path');
  assert.equal(obsBlocked.isLos, false, 'isLos must be false for terrain-occluded link');
  assert.ok(obsBlocked.diffractionLossDb >= 20.0, `diffractionLossDb (${obsBlocked.diffractionLossDb.toFixed(1)} dB) must be >= 20 dB`);
  assert.ok(obsBlocked.minClearanceM < 0, 'minClearanceM must be negative (penetrating terrain)');
  assert.equal(obsBlocked.coverageNote, undefined, 'coverageNote must be undefined for complete coverage');
  console.log(`  -> PASS: Real mountain occlusion: clearance = ${obsBlocked.minClearanceM.toFixed(1)} m, diff loss = ${obsBlocked.diffractionLossDb.toFixed(1)} dB.`);

  // --------------------------------------------------------------------------
  // Test 3: A ray beginning outside coverage is invalid
  // --------------------------------------------------------------------------
  console.log('\n[3/11] Checking ray beginning outside coverage is marked invalid...');
  // Start terminal placed outside DEM East bound (+150 km)
  const outStartPos: Position3D = [150000.0, 0.0, 3000.0];
  const validTargetPos: Position3D = [0.0, 0.0, 5000.0];
  const obsOutStart = realTerrain.evaluateTerrainObstruction(outStartPos, validTargetPos, rf, env);

  assert.equal(obsOutStart.isCoverageComplete, false, 'isCoverageComplete must be false');
  assert.ok(Number.isNaN(obsOutStart.minClearanceM), 'minClearanceM must be Number.NaN');
  assert.ok(Number.isNaN(obsOutStart.diffractionLossDb), 'diffractionLossDb must be Number.NaN');
  assert.equal(obsOutStart.isLos, false, 'isLos must be false (fail-safe)');
  assert.ok(obsOutStart.coverageNote?.includes('Ground terminal is outside mapped DEM coverage'), 'coverageNote must state start terminal is outside');
  console.log(`  -> PASS: Start outside DEM (+150 km): isCoverageComplete=false, clearance=NaN, isLos=false.`);

  // --------------------------------------------------------------------------
  // Test 4: A ray ending outside coverage is invalid
  // --------------------------------------------------------------------------
  console.log('\n[4/11] Checking ray ending outside coverage is marked invalid...');
  // Target terminal placed outside DEM North bound (+150 km)
  const validStartPos: Position3D = [0.0, 0.0, 3400.0];
  const outTargetPos: Position3D = [0.0, 150000.0, 5000.0];
  const obsOutTarget = realTerrain.evaluateTerrainObstruction(validStartPos, outTargetPos, rf, env);

  assert.equal(obsOutTarget.isCoverageComplete, false, 'isCoverageComplete must be false');
  assert.ok(Number.isNaN(obsOutTarget.minClearanceM), 'minClearanceM must be Number.NaN');
  assert.ok(Number.isNaN(obsOutTarget.diffractionLossDb), 'diffractionLossDb must be Number.NaN');
  assert.equal(obsOutTarget.isLos, false, 'isLos must be false (fail-safe)');
  assert.ok(obsOutTarget.coverageNote?.includes('Aircraft (ACN) is outside mapped DEM coverage'), 'coverageNote must state target terminal is outside');
  console.log(`  -> PASS: Target outside DEM (+150 km N): isCoverageComplete=false, clearance=NaN, isLos=false.`);

  // --------------------------------------------------------------------------
  // Test 5: A ray crossing the DEM boundary is invalid
  // --------------------------------------------------------------------------
  console.log('\n[5/11] Checking ray crossing the DEM boundary is marked invalid...');
  // Ray starts inside (+80 km, +105 km) and aims toward (+100 km, +120 km) which cuts across the corner
  const rayCrossingStart: Position3D = [80000.0, 105000.0, 4000.0];
  const rayCrossingEnd: Position3D = [100000.0, 120000.0, 5000.0];
  const obsCrossing = realTerrain.evaluateTerrainObstruction(rayCrossingStart, rayCrossingEnd, rf, env);

  assert.equal(obsCrossing.isCoverageComplete, false, 'isCoverageComplete must be false for crossing ray');
  assert.ok(Number.isNaN(obsCrossing.minClearanceM), 'minClearanceM must be Number.NaN');
  assert.ok(Number.isNaN(obsCrossing.diffractionLossDb), 'diffractionLossDb must be Number.NaN');
  assert.equal(obsCrossing.isLos, false, 'isLos must be false (fail-safe)');
  assert.ok(obsCrossing.coverageNote?.includes('outside mapped DEM coverage'), 'coverageNote must explain ray crosses unmapped terrain');
  console.log(`  -> PASS: Ray crossing boundary: isCoverageComplete=false, clearance=NaN, note="${obsCrossing.coverageNote}".`);

  // --------------------------------------------------------------------------
  // Test 6: NaN terrain samples cannot produce isLos = true
  // --------------------------------------------------------------------------
  console.log('\n[6/11] Checking NaN terrain samples cannot produce isLos = true...');
  // Engine with custom function injecting NaN midway along a high-clearance path
  const nanTerrain = new TerrainEngine({
    customElevationFn: (x, _y) => (x > 1000.0 ? Number.NaN : 3000.0),
  });
  const obsNan = nanTerrain.evaluateTerrainObstruction([0, 0, 4000], [2000, 0, 5000], rf, env);

  assert.equal(obsNan.isCoverageComplete, false, 'Path with NaN samples must have isCoverageComplete = false');
  assert.equal(obsNan.isLos, false, 'NaN terrain samples MUST NOT produce isLos = true');
  console.log('  -> PASS: NaN terrain sample rejected: isLos is strictly false.');

  // --------------------------------------------------------------------------
  // Test 7: NaN terrain samples cannot produce zero diffraction loss
  // --------------------------------------------------------------------------
  console.log('\n[7/11] Checking NaN terrain samples cannot produce zero diffraction loss...');
  assert.ok(Number.isNaN(obsNan.diffractionLossDb), 'diffractionLossDb must be Number.NaN, not 0.0 dB');
  assert.ok(Number.isNaN(obsNan.minClearanceM), 'minClearanceM must be Number.NaN');
  console.log('  -> PASS: NaN terrain sample rejected: diffraction loss is Number.NaN, never falsely 0.0 dB.');

  // --------------------------------------------------------------------------
  // Test 8: Unknown coverage is classified as UNKNOWN
  // --------------------------------------------------------------------------
  console.log('\n[8/11] Checking link status classifier classifies incomplete coverage as UNKNOWN...');
  const unknownCoverageTelemetry = {
    node_id: 1,
    terrain_is_los: false,
    obstacle_blocked: false,
    link_outage: true,
    is_coverage_complete: false,
    diffraction_loss_db: Number.NaN,
    coverage_note: 'Propagation path extends outside mapped DEM coverage',
    snr_db: -99.0,
    modcod_name: 'LINK_OUTAGE',
  };
  const classification = classifyLinkCommunicationStatus(unknownCoverageTelemetry);

  assert.equal(classification.status, 'UNKNOWN', 'Status must be UNKNOWN');
  assert.notEqual(classification.status, 'CONNECTED', 'Must NOT be CONNECTED');
  assert.notEqual(classification.status, 'DEGRADED', 'Must NOT be DEGRADED');
  assert.notEqual(classification.status, 'BLOCKED_TERRAIN', 'Must NOT be BLOCKED_TERRAIN (terrain is unmapped, not blocked)');
  assert.notEqual(classification.status, 'OUTAGE_DISCONNECTED', 'Must NOT be OUTAGE_DISCONNECTED (not a verified physical outage)');
  assert.equal(classification.isOperational, false);
  assert.equal(classification.isBlocked, false);
  assert.equal(classification.isOutage, false, 'isOutage must be false (not a verified communication outage)');
  assert.match(classification.reason, /Terrain coverage incomplete/i);
  assert.ok(classification.details.degradationFactors.includes('INCOMPLETE_TERRAIN_COVERAGE'));
  console.log(`  -> PASS: Classified as ${classification.status} (reason: "${classification.reason}").`);

  // --------------------------------------------------------------------------
  // Test 9: Verified obstacle blockage remains distinguishable from unknown terrain
  // --------------------------------------------------------------------------
  console.log('\n[9/11] Checking verified obstacle blockage remains distinguishable from unknown terrain...');
  const obstacleBlockedUnknownCoverage = {
    node_id: 1,
    terrain_is_los: false,
    obstacle_blocked: true,
    link_outage: true,
    is_coverage_complete: false,
    diffraction_loss_db: Number.NaN,
    coverage_note: 'Unmapped DEM terrain',
    snr_db: -99.0,
    modcod_name: 'LINK_OUTAGE',
  };
  const classObstacle = classifyLinkCommunicationStatus(obstacleBlockedUnknownCoverage);

  assert.equal(classObstacle.status, 'BLOCKED_OBSTACLE', 'Obstacle blockage must take precedence as local physical screening');
  assert.equal(classObstacle.isBlocked, true);
  assert.equal(classObstacle.isOutage, true);
  assert.notEqual(classObstacle.status, classification.status, 'Obstacle blockage is distinguishable from unknown terrain');
  console.log(`  -> PASS: Obstacle blockage on unmapped terrain classifies cleanly as ${classObstacle.status}.`);

  // --------------------------------------------------------------------------
  // Test 10: Valid link profiles remain unchanged
  // --------------------------------------------------------------------------
  console.log('\n[10/11] Checking valid link profiles remain unchanged...');
  const validProfile = buildLinkProfile({
    selectedGroundNodeId: 0,
    nodeName: 'S0',
    frameIndex: 10,
    simulationTimeS: 0.2,
    groundNodePositionMslM: [0, 0, 3400],
    acnPositionMslM: [0, 0, 5000],
    wavelengthM: rf.wavelengthM,
    effectiveEarthRadiusM: env.effectiveEarthRadiusM,
    fresnelFraction: 0.6,
    sampleCount: 5,
    obstruction: obsUnobstructed,
    getTerrainElevationMslM: (x, y) => realTerrain.getElevation(x, y),
    computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });

  assert.equal(validProfile.valid, true, 'valid must be true for covered path');
  assert.equal(validProfile.isCoverageComplete, true, 'isCoverageComplete must be true');
  assert.equal(validProfile.samples.length, 5, 'Must contain 5 samples');
  assert.equal(validProfile.invalidReason, undefined, 'invalidReason must be undefined');
  assert.ok(validProfile.samples.every(s => Number.isFinite(s.terrainElevationMslM)), 'All samples must have finite elevation');
  console.log(`  -> PASS: Valid profile generated: ${validProfile.samples.length} samples, valid=true.`);

  // --------------------------------------------------------------------------
  // 11. Invalid link profiles display appropriate unavailable state
  // --------------------------------------------------------------------------
  console.log('\n[11/11] Checking invalid link profiles display appropriate unavailable state...');
  const invalidProfile = buildLinkProfile({
    selectedGroundNodeId: 99,
    nodeName: 'S_OUT',
    frameIndex: 10,
    simulationTimeS: 0.2,
    groundNodePositionMslM: outStartPos,
    acnPositionMslM: validTargetPos,
    wavelengthM: rf.wavelengthM,
    effectiveEarthRadiusM: env.effectiveEarthRadiusM,
    fresnelFraction: 0.6,
    sampleCount: 5,
    obstruction: obsOutStart,
    getTerrainElevationMslM: (x, y) => realTerrain.getElevation(x, y),
    computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });

  assert.equal(invalidProfile.valid, false, 'valid must be false for out-of-coverage path');
  assert.equal(invalidProfile.isCoverageComplete, false, 'isCoverageComplete must be false');
  assert.equal(invalidProfile.samples.length, 0, 'samples must be empty (no fabricated elevations emitted)');
  assert.ok(invalidProfile.invalidReason?.includes('outside mapped DEM coverage'), 'invalidReason must explain unmapped coverage');
  console.log(`  -> PASS: Invalid profile: valid=false, samples=0, reason="${invalidProfile.invalidReason}".`);

  console.log('\n================================================================================');
  console.log('  [SUCCESS] ALL 11 M6.1 TASK 3 VERIFICATION TESTS PASSED WITH 100% SUCCESS.');
  console.log('================================================================================\n');
}

runCoveragePropagationVerification();

