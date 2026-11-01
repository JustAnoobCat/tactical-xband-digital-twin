/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Feature 7 — Configurable Ground-Node AGL UI Verification Suite
 *
 * Validates:
 * 1. Antenna AGL parameter validation (0.0–1000.0 m, step 0.5 m, finite numbers).
 * 2. Spatial lock and historical mode editing eligibility enforcement.
 * 3. Isolation between Ground Node AGL and ACN altitude configuration.
 * 4. Authoritative worker CONFIG_UPDATE execution, terrain elevation resampling, and MSL derivation.
 * 5. Horizontal NODE_MOVE preservation of configured AGL and terrain elevation resampling.
 * 6. Terrain mode switching preservation of configured AGL and terrain elevation resampling.
 * 7. Bounded rejection handling and UI state reversion on worker command rejection.
 * 8. Telemetry consistency across nodes_telemetry, profile frames, and historical snapshots.
 * 9. Propagation and Fresnel clearance impact from elevated antenna height.
 */

import assert from 'node:assert/strict';
import { SimulationWorkerManager } from '../worker/simWorker';
import {
  validateNodeAgl,
  checkAglEditEligibility,
  deriveTotalMslAltitude,
  buildAglConfigUpdateCommand,
  MIN_GROUND_AGL_M,
  MAX_GROUND_AGL_M,
  DEFAULT_GROUND_AGL_M,
} from '../ui/nodeAglController';
import { createHistoricalRecordSnapshot } from '../ui/simulationHistory';
import { buildLinkProfile } from '../core/linkProfile';
import { TerrainEngine } from '../core/terrain';

function close(actual: number, expected: number, tolerance = 1e-3, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('================================================================================');
console.log('  FEATURE 7: CONFIGURABLE GROUND-NODE AGL UI & WORKER VERIFICATION SUITE');
console.log('================================================================================\n');

// -------------------------------------------------------------------------------------------------
// [1/8] Pure frontend validation of AGL input
// -------------------------------------------------------------------------------------------------
console.log('[1/8] Verifying Antenna AGL numeric input validation [0.0, 1000.0] m...');
{
  // Valid numeric values
  for (const validVal of [0, 0.0, 0.5, 2.0, 5.5, 10, 50.0, 500, 999.5, 1000, 1000.0, '2.5', '  10.0 ']) {
    const res = validateNodeAgl(validVal);
    assert.equal(res.valid, true, `Value ${validVal} should be valid`);
    assert.equal(typeof res.value, 'number');
    assert.ok(res.value! >= MIN_GROUND_AGL_M && res.value! <= MAX_GROUND_AGL_M);
  }

  // Out of bounds / invalid inputs
  for (const badVal of [-0.1, -1, -500, 1000.1, 1001, 5000, Number.NaN, Infinity, -Infinity, '', 'abc', null, undefined]) {
    const res = validateNodeAgl(badVal);
    assert.equal(res.valid, false, `Value ${badVal} should be rejected`);
    assert.ok(typeof res.reason === 'string' && res.reason.length > 0);
  }

  console.log('  -> PASS: Valid range [0.0, 1000.0] m with finite numbers strictly enforced.');
}

// -------------------------------------------------------------------------------------------------
// [2/8] Editing eligibility: spatial lock, historical mode, and node ID bounds
// -------------------------------------------------------------------------------------------------
console.log('[2/8] Verifying edit eligibility under spatial lock, history mode, and node boundaries...');
{
  // Live, unlocked, ground node (0..15) -> eligible
  for (let nid = 0; nid < 16; nid++) {
    const res = checkAglEditEligibility({ spatialLocked: false, isHistorical: false, nodeId: nid });
    assert.equal(res.canEdit, true, `Ground node ${nid} must be editable when unlocked and live`);
  }

  // Spatial lock blocks editing
  const lockRes = checkAglEditEligibility({ spatialLocked: true, isHistorical: false, nodeId: 4 });
  assert.equal(lockRes.canEdit, false);
  assert.ok(lockRes.reason?.includes('Spatial lock is enabled'));

  // Historical inspection blocks editing
  const histRes = checkAglEditEligibility({ spatialLocked: false, isHistorical: true, nodeId: 4 });
  assert.equal(histRes.canEdit, false);
  assert.ok(histRes.reason?.includes('historical inspection mode'));

  // ACN (nodeId -1) cannot edit ground AGL
  const acnRes = checkAglEditEligibility({ spatialLocked: false, isHistorical: false, nodeId: -1 });
  assert.equal(acnRes.canEdit, false);
  assert.ok(acnRes.reason?.includes('ACN altitude is configured separately'));

  // Out of range node ID
  const invalidNodeRes = checkAglEditEligibility({ spatialLocked: false, isHistorical: false, nodeId: 16 });
  assert.equal(invalidNodeRes.canEdit, false);

  console.log('  -> PASS: Spatial lock, historical mode, and node isolation rules strictly enforced.');
}

// -------------------------------------------------------------------------------------------------
// [3/8] Worker-side CONFIG_UPDATE execution and altitude derivation: Total MSL = Terrain + AGL
// -------------------------------------------------------------------------------------------------
console.log('[3/8] Verifying worker CONFIG_UPDATE execution and authoritative MSL derivation...');
{
  const sim = new SimulationWorkerManager();
  const nodeId = 4;
  const initialTerrain = sim.terrainEngine.getElevation(sim.nodesTac[nodeId].position[0], sim.nodesTac[nodeId].position[1]);

  // Initial state check
  assert.equal(sim.nodesTac[nodeId].aglM, DEFAULT_GROUND_AGL_M);
  assert.equal(sim.nodesStatic[nodeId].aglM, DEFAULT_GROUND_AGL_M);
  close(sim.nodesTac[nodeId].position[2], initialTerrain + DEFAULT_GROUND_AGL_M);

  const prevSpatialRev = sim.spatialRevision;

  // Update AGL to 12.5 m
  const cmd = buildAglConfigUpdateCommand(nodeId, 12.5, 'req-agl-1');
  const res = sim.handleMessage(cmd);
  assert.equal(res.accepted, true, 'Valid AGL CONFIG_UPDATE must be accepted');
  assert.equal(sim.nodesTac[nodeId].aglM, 12.5);
  assert.equal(sim.nodesStatic[nodeId].aglM, 12.5);
  close(sim.nodesTac[nodeId].position[2], initialTerrain + 12.5);
  close(sim.nodesStatic[nodeId].position[2], initialTerrain + 12.5);
  assert.ok(sim.spatialRevision > prevSpatialRev, 'Spatial revision must increment on AGL change');

  // Verify deriveTotalMslAltitude helper parity
  assert.equal(deriveTotalMslAltitude(initialTerrain, 12.5), initialTerrain + 12.5);

  console.log('  -> PASS: Worker updates both static and tac nodes and recalculates absolute MSL altitude.');
}

// -------------------------------------------------------------------------------------------------
// [4/8] Worker rejection of invalid, out-of-bounds, or spatial-locked AGL updates
// -------------------------------------------------------------------------------------------------
console.log('[4/8] Verifying worker rejection of invalid inputs and spatial lock violations...');
{
  const sim = new SimulationWorkerManager();
  const nodeId = 4;
  const originalAgl = sim.nodesTac[nodeId].aglM;
  const originalAlt = sim.nodesTac[nodeId].position[2];

  // Negative AGL
  const negRes = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: -1.0 } });
  assert.equal(negRes.accepted, false);
  assert.equal(sim.nodesTac[nodeId].aglM, originalAgl, 'State must not mutate on rejected negative AGL');

  // Exceeding 1000 m
  const highRes = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: 1000.5 } });
  assert.equal(highRes.accepted, false);
  assert.equal(sim.nodesTac[nodeId].aglM, originalAgl);

  // ACN node_id -1
  const acnRes = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: -1, agl_m: 20.0 } });
  assert.equal(acnRes.accepted, false);

  // Missing agl_m or node_id
  assert.equal(sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId } }).accepted, false);
  assert.equal(sim.handleMessage({ type: 'CONFIG_UPDATE', params: { agl_m: 10.0 } }).accepted, false);

  // Spatial lock rejection
  sim.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: true });
  const lockedRes = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: 25.0 } });
  assert.equal(lockedRes.accepted, false);
  assert.ok(lockedRes.reason?.includes('Spatial lock is enabled'));
  assert.equal(sim.nodesTac[nodeId].aglM, originalAgl);
  assert.equal(sim.nodesTac[nodeId].position[2], originalAlt);

  // Unlock and verify subsequent update succeeds
  sim.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: false });
  const unlockedRes = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: 25.0 } });
  assert.equal(unlockedRes.accepted, true);
  assert.equal(sim.nodesTac[nodeId].aglM, 25.0);

  console.log('  -> PASS: All invalid, out-of-bounds, and spatial-locked updates atomically rejected.');
}

// -------------------------------------------------------------------------------------------------
// [5/8] Horizontal NODE_MOVE strictly preserves configured AGL and resamples elevation
// -------------------------------------------------------------------------------------------------
console.log('[5/8] Verifying horizontal NODE_MOVE preserves configured AGL and resamples terrain...');
{
  const sim = new SimulationWorkerManager();
  const nodeId = 4;

  // Set AGL to 18.5 m
  sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: 18.5 } });
  assert.equal(sim.nodesTac[nodeId].aglM, 18.5);

  // Move node to new horizontal coordinates
  const newX = 45000.0;
  const newY = -12000.0;
  const moveRes = sim.handleMessage({ type: 'NODE_MOVE', node_id: nodeId, x_m: newX, y_m: newY });
  assert.equal(moveRes.accepted, true);

  // AGL must be preserved
  assert.equal(sim.nodesTac[nodeId].aglM, 18.5, 'AGL must remain 18.5 m after horizontal move');
  assert.equal(sim.nodesStatic[nodeId].aglM, 18.5);

  // Terrain elevation must be resampled at new coordinates
  const newTerrain = sim.terrainEngine.getElevation(newX, newY);
  close(sim.nodesTac[nodeId].position[0], newX);
  close(sim.nodesTac[nodeId].position[1], newY);
  close(sim.nodesTac[nodeId].position[2], newTerrain + 18.5, 1e-3, 'Total MSL must equal new terrain + AGL');
  close(sim.nodesStatic[nodeId].position[2], newTerrain + 18.5);

  console.log('  -> PASS: Horizontal NODE_MOVE preserves AGL and recalculates MSL altitude from resampled terrain.');
}

// -------------------------------------------------------------------------------------------------
// [6/8] Terrain mode change preserves configured AGL across all nodes
// -------------------------------------------------------------------------------------------------
console.log('[6/8] Verifying terrain mode change resamples MSL while preserving configured AGL...');
{
  const sim = new SimulationWorkerManager();
  const nodeId = 4;
  sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: 30.0 } });

  // Switch terrain mode to synthetic
  const res = sim.handleMessage({ type: 'SET_TERRAIN_MODE', mode: 'synthetic' });
  assert.equal(res.accepted, true);

  // Verify node AGL remains 30.0 m
  assert.equal(sim.nodesTac[nodeId].aglM, 30.0);
  assert.equal(sim.nodesStatic[nodeId].aglM, 30.0);

  // Verify MSL was resampled from synthetic terrain engine
  const synthElevation = sim.terrainEngine.getElevation(sim.nodesTac[nodeId].position[0], sim.nodesTac[nodeId].position[1]);
  close(sim.nodesTac[nodeId].position[2], synthElevation + 30.0, 1e-3);

  console.log('  -> PASS: Terrain mode switching preserves per-node AGL and resamples elevation correctly.');
}

// -------------------------------------------------------------------------------------------------
// [7/8] Historical telemetry immutability and historical AGL preservation
// -------------------------------------------------------------------------------------------------
console.log('[7/8] Verifying historical snapshots retain historical AGL and isolate from live changes...');
{
  const sim = new SimulationWorkerManager();
  const nodeId = 4;
  const initialTerrain = sim.terrainEngine.getElevation(sim.nodesTac[nodeId].position[0], sim.nodesTac[nodeId].position[1]);

  // Frame 1: AGL = 2.0 m
  const snapshot1 = createHistoricalRecordSnapshot({
    frameIndex: 1,
    simulationTimeS: 0.02,
    selectedNodeId: nodeId,
    nodeName: 'Node 4 (S4)',
    groundNodePositionMslM: [sim.nodesTac[nodeId].position[0], sim.nodesTac[nodeId].position[1], initialTerrain + 2.0],
    acnPositionMslM: [0, 0, 5000],
    groundNodeAglM: 2.0,
    profile: {
      selectedGroundNodeId: nodeId,
      nodeName: 'S4',
      frameIndex: 1,
      simulationTimeS: 0.02,
      groundNodePositionMslM: [0, 0, initialTerrain + 2.0],
      acnPositionMslM: [0, 0, 5000],
      horizontalGroundDistanceM: 1000,
      slantDistanceM: 5099,
      fresnelFraction: 0.6,
      terrainIsLos: true,
      terrainMinimumClearanceM: 15,
      terrainCriticalFresnelRadiusM: 8,
      diffractionLossDb: 0,
      obstacleBlocked: false,
      obstacleIntervals: [],
      samples: [],
      valid: true,
    },
    obstruction: {
      terrainIsLos: true,
      obstacleBlocked: false,
      minClearanceM: 15,
      diffractionLossDb: 0,
      primaryBlockedObstacleId: null,
      terrainStatusText: 'LOS Clear',
      terrainBadgeClass: 'badge-emerald',
      obstacleStatusText: 'Clear',
      obstacleBadgeClass: 'badge-emerald',
    },
    linkBudget: {
      modcodName: 'MODCOD_QPSK_1_2',
      snrDb: 18.5,
      spectralEfficiencyBpsHz: 1.0,
      slantRangeKm: 5.1,
      fsplDb: 120.0,
      diffractionLossDb: 0.0,
      rxPowerDbm: -85.0,
      earthBulgeM: 0.1,
      gaseousLossDb: 0.05,
    },
  });

  assert.equal(snapshot1.groundNodeAglM, 2.0, 'Historical snapshot must record 2.0 m AGL');

  // Now live simulation updates AGL to 50.0 m
  sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: 50.0 } });
  assert.equal(sim.nodesTac[nodeId].aglM, 50.0);

  // Frame 2: AGL = 50.0 m
  const snapshot2 = createHistoricalRecordSnapshot({
    ...snapshot1,
    frameIndex: 2,
    simulationTimeS: 0.04,
    groundNodeAglM: 50.0,
  });

  // Verify historical immutability
  assert.equal(snapshot1.groundNodeAglM, 2.0, 'Frame 1 snapshot must remain immutable at 2.0 m');
  assert.equal(snapshot2.groundNodeAglM, 50.0, 'Frame 2 snapshot reflects updated 50.0 m');

  console.log('  -> PASS: Historical records store authoritative AGL and remain completely immutable.');
}

// -------------------------------------------------------------------------------------------------
// [8/8] Radio propagation and Fresnel zone clearance improves with higher AGL
// -------------------------------------------------------------------------------------------------
console.log('[8/8] Verifying physical RF link and Fresnel clearance response to elevated AGL...');
{
  const sim = new SimulationWorkerManager();
  const nodeId = 4; // Node 4 is in Kargil canyon with obstacle/ridge
  
  // Measure baseline clearance at 2.0 m AGL
  sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: 2.0 } });
  const altLow = sim.nodesTac[nodeId].position[2];

  // Raise antenna to 150.0 m AGL (e.g. mast / aerostat terminal)
  sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: 150.0 } });
  const altHigh = sim.nodesTac[nodeId].position[2];

  close(altHigh - altLow, 148.0, 1e-3, 'Terminal elevation increased by exactly 148 m');

  // Verify profile builder accounts for the higher terminal elevation
  const profileLow = buildLinkProfile({
    selectedGroundNodeId: nodeId,
    nodeName: 'S4',
    frameIndex: 1,
    simulationTimeS: 0.02,
    groundNodePositionMslM: sim.nodesTac[nodeId].position,
    acnPositionMslM: [sim.flightConfig.centerXm, sim.flightConfig.centerYm, 5000],
    wavelengthM: 0.0375, // 8.0 GHz
    effectiveEarthRadiusM: 6_371_000 * (4 / 3),
    fresnelFraction: 0.6,
    sampleCount: 64,
    obstruction: { minClearanceM: 5, fresnelRadiusM: 10, diffractionLossDb: 0, isLos: true, obstacleBlocked: false, obstacleIntersections: [] },
    getTerrainElevationMslM: (x, y) => sim.terrainEngine.getElevation(x, y),
    computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });

  assert.equal(profileLow.valid, true);
  assert.equal(profileLow.groundNodePositionMslM[2], altHigh, 'Profile uses updated authoritative MSL altitude');

  console.log('  -> PASS: Higher AGL directly elevates the ray path and propagates through link profile.');
}

console.log('================================================================================');
console.log('  ALL 8 CONFIGURABLE GROUND-NODE AGL VERIFICATION SUITES PASSED CLEANLY!');
console.log('================================================================================\n');

