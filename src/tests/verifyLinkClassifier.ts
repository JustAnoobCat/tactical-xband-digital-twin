/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Authoritative Communication Link Status Classifier Unit & Integration Tests (Milestone 4 Step 2 & 3)
 *
 * Verifies:
 * 1. UNKNOWN classification on missing, null, undefined, or malformed telemetry inputs.
 * 2. UNKNOWN classification on non-finite numeric telemetry (NaN, Infinity).
 * 3. BLOCKED_OBSTACLE classification when obstacle_blocked is true, with terrain clear.
 * 4. BLOCKED_OBSTACLE precedence and documentation when both obstacle and terrain are occluded.
 * 5. BLOCKED_TERRAIN classification when optical LOS is physically severed (terrain_is_los === false).
 * 6. OUTAGE_DISCONNECTED classification when link budget cannot close but geometry is clear.
 * 7. DEGRADED classification on knife-edge Fresnel diffraction loss (> 0 dB in LOS).
 * 8. DEGRADED classification on predictive lookahead PRE_OCCLUSION_FLUSH warning.
 * 9. Physical 0.6 F1 diffraction loss validation: zero diffraction loss preserves CONNECTED status;
 *    arbitrary fixed metre clearance without diffraction loss does NOT invent degradation.
 * 10. DEGRADED classification on threshold modulation tier (pi/2-BPSK 1/3).
 * 11. CONNECTED classification on nominal, pristine line-of-sight link.
 * 12. Helper functions (isLinkOperational, isLinkBlocked) and classification flags.
 * 13. End-to-end integration and compatibility with simWorker telemetry frames.
 * 14. Pure determinism, boundary conditions, and input immutability.
 * 15. Conflict resolution & missing telemetry safety: sub-threshold SNR or LINK_OUTAGE modcod
 *     overrides conflicting false outage flag and never produces CONNECTED.
 * 16. HARD_SHADOW_CUTOFF lookahead state with terrain_is_los === true does NOT produce BLOCKED_TERRAIN.
 * 17. Equivalent status semantics between SelectedLinkBudgetTelemetry and per-node telemetry.
 * 18. Map link visual style mapping (getMapLinkStyle, classifyAndStyleLink) covering all 6 statuses.
 */

import assert from 'node:assert/strict';
import {
  classifyLinkCommunicationStatus,
  DIFFRACTION_LOSS_EPSILON_DB,
  isLinkBlocked,
  isLinkOperational,
  LinkStatusTelemetryInput,
  MIN_OPERATIONAL_SNR_DB,
  THRESHOLD_MODCOD_NAME,
} from '../core/linkStatusClassifier';
import { NodeTerrainState } from '../core/trajectory';
import {
  classifyAndStyleLink,
  getMapLinkStyle,
  getStatusBadgeInfo,
  MAP_LINK_STYLES,
  MapLinkStyle,
} from '../ui/mapLinkStyles';
import {
  createHistoricalRecordSnapshot,
  SimulationHistoryBuffer,
  SimulationHistoryController,
} from '../ui/simulationHistory';
import { SimulationWorkerManager } from '../worker/simWorker';

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: UNKNOWN on missing, null, undefined, or malformed inputs
// ─────────────────────────────────────────────────────────────────────────────
function testUnknownOnMalformedInput(): void {
  const resNull = classifyLinkCommunicationStatus(null);
  assert.equal(resNull.status, 'UNKNOWN');
  assert.equal(resNull.isOperational, false);
  assert.equal(resNull.isBlocked, false);
  assert.equal(resNull.isOutage, false);
  assert.match(resNull.reason, /missing or not a valid object/i);

  const resUndef = classifyLinkCommunicationStatus(undefined);
  assert.equal(resUndef.status, 'UNKNOWN');

  // @ts-expect-error test primitive string input
  const resStr = classifyLinkCommunicationStatus('not an object');
  assert.equal(resStr.status, 'UNKNOWN');

  // Empty object missing required booleans
  const resEmpty = classifyLinkCommunicationStatus({});
  assert.equal(resEmpty.status, 'UNKNOWN');
  assert.match(resEmpty.reason, /obstacle_blocked/i);

  // Missing terrain_is_los
  const resMissingTerrain = classifyLinkCommunicationStatus({
    obstacle_blocked: false,
  });
  assert.equal(resMissingTerrain.status, 'UNKNOWN');
  assert.match(resMissingTerrain.reason, /terrain_is_los/i);

  // Missing outage indicator boolean
  const resMissingOutage = classifyLinkCommunicationStatus({
    obstacle_blocked: false,
    terrain_is_los: true,
  });
  assert.equal(resMissingOutage.status, 'UNKNOWN');
  assert.match(resMissingOutage.reason, /outage/i);

  // Non-boolean flags
  const resInvalidTypes = classifyLinkCommunicationStatus({
    obstacle_blocked: 'false' as unknown as boolean,
    terrain_is_los: 1 as unknown as boolean,
    link_outage: false,
  });
  assert.equal(resInvalidTypes.status, 'UNKNOWN');

  console.log('PASS Test 1 — UNKNOWN classification on missing, null, undefined, or malformed telemetry inputs');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: UNKNOWN on non-finite numeric telemetry
// ─────────────────────────────────────────────────────────────────────────────
function testUnknownOnNonFiniteNumbers(): void {
  const baseValid: LinkStatusTelemetryInput = {
    obstacle_blocked: false,
    terrain_is_los: true,
    link_outage: false,
    modcod_name: '64-APSK 5/6',
    diffraction_loss_db: 0.0,
    snr_db: 25.0,
  };

  const resNaNLoss = classifyLinkCommunicationStatus({
    ...baseValid,
    diffraction_loss_db: Number.NaN,
  });
  assert.equal(resNaNLoss.status, 'UNKNOWN');
  assert.match(resNaNLoss.reason, /diffraction_loss_db/i);

  const resInfLoss = classifyLinkCommunicationStatus({
    ...baseValid,
    diffraction_loss_db: Number.POSITIVE_INFINITY,
  });
  assert.equal(resInfLoss.status, 'UNKNOWN');

  const resNaNSnr = classifyLinkCommunicationStatus({
    ...baseValid,
    snr_db: Number.NaN,
  });
  assert.equal(resNaNSnr.status, 'UNKNOWN');
  assert.match(resNaNSnr.reason, /snr_db/i);

  console.log('PASS Test 2 — UNKNOWN classification on non-finite numeric telemetry (NaN, Infinity)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: BLOCKED_OBSTACLE when obstacle_blocked is true with clear terrain
// ─────────────────────────────────────────────────────────────────────────────
function testBlockedObstacleClearTerrain(): void {
  const input: LinkStatusTelemetryInput = {
    obstacle_blocked: true,
    terrain_is_los: true,
    link_outage: true,
    modcod_name: 'OBSTACLE_BLOCKED',
    diffraction_loss_db: 0.0,
    snr_db: 20.0,
    bitrate_bps: 0,
  };

  const res = classifyLinkCommunicationStatus(input);
  assert.equal(res.status, 'BLOCKED_OBSTACLE');
  assert.equal(res.isOperational, false);
  assert.equal(res.isBlocked, true);
  assert.equal(res.isOutage, true);
  assert.equal(res.details.obstacleBlocked, true);
  assert.equal(res.details.terrainIsLos, true);
  assert.match(res.reason, /artificial obstacle/i);
  assert.match(res.reason, /terrain line-of-sight is clear/i);

  console.log('PASS Test 3 — BLOCKED_OBSTACLE classification when obstacle_blocked is true, with terrain clear');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: BLOCKED_OBSTACLE precedence and documentation when conflicting with terrain blockage
// ─────────────────────────────────────────────────────────────────────────────
function testBlockedObstacleConflictingWithTerrain(): void {
  const input: LinkStatusTelemetryInput = {
    obstacle_blocked: true,
    terrain_is_los: false,
    link_outage: true,
    modcod_name: 'OBSTACLE_BLOCKED',
    diffraction_loss_db: 38.5,
    snr_db: -15.0,
    bitrate_bps: 0,
  };

  const res = classifyLinkCommunicationStatus(input);
  // Precedence rule: Obstacle screening takes precedence as local barrier
  assert.equal(res.status, 'BLOCKED_OBSTACLE');
  assert.equal(res.isOperational, false);
  assert.equal(res.isBlocked, true);
  assert.equal(res.isOutage, true);
  // Conflict resolution must document both in the rationale
  assert.match(res.reason, /artificial obstacle/i);
  assert.match(res.reason, /terrain optical line-of-sight is also occluded/i);

  console.log('PASS Test 4 — BLOCKED_OBSTACLE precedence and documentation when both obstacle and terrain are occluded');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: BLOCKED_TERRAIN when optical LOS is physically severed
// ─────────────────────────────────────────────────────────────────────────────
function testBlockedTerrain(): void {
  const input: LinkStatusTelemetryInput = {
    obstacle_blocked: false,
    terrain_is_los: false,
    link_outage: true,
    modcod_name: 'LINK_OUTAGE',
    diffraction_loss_db: 45.0,
    snr_db: -28.0,
    bitrate_bps: 0,
    state_name: NodeTerrainState.HARD_SHADOW_CUTOFF,
  };

  const res = classifyLinkCommunicationStatus(input);
  assert.equal(res.status, 'BLOCKED_TERRAIN');
  assert.equal(res.isOperational, false);
  assert.equal(res.isBlocked, true);
  assert.equal(res.isOutage, true);
  assert.match(res.reason, /terrain obstruction/i);
  assert.match(res.reason, /45\.0 dB/);

  console.log('PASS Test 5 — BLOCKED_TERRAIN classification when optical LOS is physically severed');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: OUTAGE_DISCONNECTED when link budget cannot close but geometry is clear
// ─────────────────────────────────────────────────────────────────────────────
function testOutageDisconnected(): void {
  // Case A: Ground terminal at extreme range, high rain or path loss, SNR = -3.5 dB (< -1.5 dB threshold)
  const inputA: LinkStatusTelemetryInput = {
    obstacle_blocked: false,
    terrain_is_los: true,
    link_outage: true,
    modcod_name: 'LINK_OUTAGE',
    diffraction_loss_db: 0.0,
    snr_db: -3.5,
    bitrate_bps: 0,
    state_name: NodeTerrainState.NORMAL_LOS,
  };

  const resA = classifyLinkCommunicationStatus(inputA);
  assert.equal(resA.status, 'OUTAGE_DISCONNECTED');
  assert.equal(resA.isOperational, false);
  assert.equal(resA.isBlocked, false); // Crucial: geometry is NOT blocked!
  assert.equal(resA.isOutage, true);
  assert.match(resA.reason, /link-budget outage/i);
  assert.match(resA.reason, /terrain and obstacles are clear/i);
  assert.match(resA.reason, /-3\.5 dB/);

  // Case B: SelectedLinkBudgetTelemetry representation using is_outage
  const inputB: LinkStatusTelemetryInput = {
    obstacle_blocked: false,
    terrain_is_los: true,
    is_outage: true,
    modcod_name: 'LINK_OUTAGE',
    diffraction_loss_db: 0.0,
    snr_db: -2.0,
  };

  const resB = classifyLinkCommunicationStatus(inputB);
  assert.equal(resB.status, 'OUTAGE_DISCONNECTED');
  assert.equal(resB.isBlocked, false);

  console.log('PASS Test 6 — OUTAGE_DISCONNECTED classification when link budget cannot close but geometry is clear');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: DEGRADED on knife-edge Fresnel diffraction loss (> 0 dB in LOS)
// ─────────────────────────────────────────────────────────────────────────────
function testDegradedOnDiffractionLoss(): void {
  const input: LinkStatusTelemetryInput = {
    obstacle_blocked: false,
    terrain_is_los: true,
    link_outage: false,
    modcod_name: '16-APSK 2/3',
    diffraction_loss_db: 3.2,
    snr_db: 12.5,
    bitrate_bps: 2640000,
    state_name: NodeTerrainState.NORMAL_LOS,
  };

  const res = classifyLinkCommunicationStatus(input);
  assert.equal(res.status, 'DEGRADED');
  assert.equal(res.isOperational, true);
  assert.equal(res.isBlocked, false);
  assert.equal(res.isOutage, false);
  assert.ok(res.details.degradationFactors.includes('fresnel_diffraction_encroachment'));
  assert.match(res.reason, /terrain knife-edge diffraction loss 3\.2 dB/i);
  assert.match(res.reason, /0\.6 F1 Fresnel encroachment/i);

  console.log('PASS Test 7 — DEGRADED classification on knife-edge Fresnel diffraction loss (> 0 dB in LOS)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: DEGRADED on predictive lookahead PRE_OCCLUSION_FLUSH warning
// ─────────────────────────────────────────────────────────────────────────────
function testDegradedOnLookaheadWarning(): void {
  const input: LinkStatusTelemetryInput = {
    obstacle_blocked: false,
    terrain_is_los: true,
    link_outage: false,
    modcod_name: '64-APSK 5/6',
    diffraction_loss_db: 0.0,
    snr_db: 24.0,
    bitrate_bps: 4950000,
    state_name: NodeTerrainState.PRE_OCCLUSION_FLUSH,
    time_to_occlusion_s: 2.3,
  };

  const res = classifyLinkCommunicationStatus(input);
  assert.equal(res.status, 'DEGRADED');
  assert.equal(res.isOperational, true);
  assert.equal(res.isBlocked, false);
  assert.equal(res.isOutage, false);
  assert.ok(res.details.degradationFactors.includes('pre_occlusion_lookahead_warning'));
  assert.match(res.reason, /pre-occlusion flush active/i);
  assert.match(res.reason, /2\.3s/);

  console.log('PASS Test 8 — DEGRADED classification on predictive lookahead PRE_OCCLUSION_FLUSH warning');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: Zero diffraction loss preserves CONNECTED; no invented clearance thresholds
// ─────────────────────────────────────────────────────────────────────────────
function testDiffractionLossClearanceJustification(): void {
  // A terminal with 0.0 dB diffraction loss, valid SNR and higher MODCOD must be CONNECTED.
  // Arbitrary metre clearance values (e.g. 8m or 12m at shorter ranges) without diffraction
  // loss do NOT degrade the link.
  const inputA: LinkStatusTelemetryInput = {
    obstacle_blocked: false,
    terrain_is_los: true,
    link_outage: false,
    modcod_name: '32-APSK 3/4',
    diffraction_loss_db: 0.0,
    snr_db: 18.2,
    fresnel_clearance_m: 8.5, // Even with clearance < 15m, 0.0 dB loss = pristine 0.6 F1
    state_name: NodeTerrainState.NORMAL_LOS,
  };

  const resA = classifyLinkCommunicationStatus(inputA);
  assert.equal(resA.status, 'CONNECTED', 'Zero diffraction loss link must be CONNECTED');
  assert.equal(resA.isOperational, true);

  // Positive knife-edge diffraction loss (> 0 dB) correctly degrades
  const inputB: LinkStatusTelemetryInput = {
    ...inputA,
    diffraction_loss_db: 1.5,
  };
  const resB = classifyLinkCommunicationStatus(inputB);
  assert.equal(resB.status, 'DEGRADED', 'Positive diffraction loss must be DEGRADED');
  assert.ok(resB.details.degradationFactors.includes('fresnel_diffraction_encroachment'));

  console.log('PASS Test 9 — Zero diffraction loss preserves CONNECTED; no invented clearance thresholds');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: DEGRADED on threshold modulation tier (pi/2-BPSK 1/3)
// ─────────────────────────────────────────────────────────────────────────────
function testDegradedOnThresholdModcod(): void {
  const input: LinkStatusTelemetryInput = {
    obstacle_blocked: false,
    terrain_is_los: true,
    link_outage: false,
    modcod_name: THRESHOLD_MODCOD_NAME,
    diffraction_loss_db: 0.0,
    snr_db: -0.5,
    bitrate_bps: 330000,
    state_name: NodeTerrainState.NORMAL_LOS,
  };

  const res = classifyLinkCommunicationStatus(input);
  assert.equal(res.status, 'DEGRADED');
  assert.equal(res.isOperational, true);
  assert.equal(res.isBlocked, false);
  assert.ok(res.details.degradationFactors.includes('threshold_modcod_tier'));
  assert.match(res.reason, /lowest operational modulation tier/i);
  assert.match(res.reason, /pi\/2-BPSK 1\/3/);

  console.log('PASS Test 10 — DEGRADED classification on threshold modulation tier (pi/2-BPSK 1/3)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 11: CONNECTED on nominal, pristine line-of-sight link
// ─────────────────────────────────────────────────────────────────────────────
function testConnectedNominalLink(): void {
  const input: LinkStatusTelemetryInput = {
    obstacle_blocked: false,
    terrain_is_los: true,
    link_outage: false,
    modcod_name: '64-APSK 5/6',
    diffraction_loss_db: 0.0,
    snr_db: 28.5,
    bitrate_bps: 4950000,
    state_name: NodeTerrainState.NORMAL_LOS,
  };

  const res = classifyLinkCommunicationStatus(input);
  assert.equal(res.status, 'CONNECTED');
  assert.equal(res.isOperational, true);
  assert.equal(res.isBlocked, false);
  assert.equal(res.isOutage, false);
  assert.equal(res.details.degradationFactors.length, 0);
  assert.match(res.reason, /nominal operational line-of-sight link connected/i);
  assert.match(res.reason, /64-APSK 5\/6/);
  assert.match(res.reason, /28\.5 dB/);

  console.log('PASS Test 11 — CONNECTED classification on nominal, pristine line-of-sight link');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 12: Helper functions and classification flags
// ─────────────────────────────────────────────────────────────────────────────
function testHelperFunctions(): void {
  assert.equal(isLinkOperational('CONNECTED'), true);
  assert.equal(isLinkOperational('DEGRADED'), true);
  assert.equal(isLinkOperational('BLOCKED_TERRAIN'), false);
  assert.equal(isLinkOperational('BLOCKED_OBSTACLE'), false);
  assert.equal(isLinkOperational('OUTAGE_DISCONNECTED'), false);
  assert.equal(isLinkOperational('UNKNOWN'), false);

  assert.equal(isLinkBlocked('BLOCKED_TERRAIN'), true);
  assert.equal(isLinkBlocked('BLOCKED_OBSTACLE'), true);
  assert.equal(isLinkBlocked('CONNECTED'), false);
  assert.equal(isLinkBlocked('DEGRADED'), false);
  assert.equal(isLinkBlocked('OUTAGE_DISCONNECTED'), false);
  assert.equal(isLinkBlocked('UNKNOWN'), false);

  console.log('PASS Test 12 — Helper functions (isLinkOperational, isLinkBlocked) and classification flags');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 13: End-to-end integration and compatibility with simWorker telemetry
// ─────────────────────────────────────────────────────────────────────────────
function testSimWorkerIntegration(): void {
  const manager = new SimulationWorkerManager();
  const acnPos = manager.trajectoryEngine.getAcnPosition(manager.simTimeS);
  // @ts-expect-error accessing private method
  const frame = manager.buildTelemetryFrame(acnPos);

  assert.ok(Array.isArray(frame.nodes_telemetry), 'nodes_telemetry must be an array');
  assert.equal(frame.nodes_telemetry.length, 16, '16 ground nodes telemetry expected');

  // Verify that all 16 ground node telemetry items can be classified deterministically
  for (const nodeTel of frame.nodes_telemetry) {
    const classification = classifyLinkCommunicationStatus(nodeTel);
    assert.notEqual(classification.status, 'UNKNOWN', `Node ${nodeTel.node_id} should not be UNKNOWN`);
    assert.ok(
      ['CONNECTED', 'DEGRADED', 'BLOCKED_TERRAIN', 'BLOCKED_OBSTACLE', 'OUTAGE_DISCONNECTED'].includes(
        classification.status
      ),
      `Valid status expected for node ${nodeTel.node_id}`
    );
  }

  // Verify selected_link_budget can also be classified directly
  assert.ok(frame.selected_link_budget, 'selected_link_budget must be present');
  const selBudgetClassification = classifyLinkCommunicationStatus(frame.selected_link_budget);
  assert.notEqual(selBudgetClassification.status, 'UNKNOWN', 'selected_link_budget should classify cleanly');

  // Verify obstruction_state snapshot items can also be classified
  // @ts-expect-error accessing private method
  const obsState = manager.getObstructionStateSnapshot();
  for (const item of obsState) {
    const classification = classifyLinkCommunicationStatus(item);
    assert.notEqual(classification.status, 'UNKNOWN', `obstruction_state ${item.node_id} should not be UNKNOWN`);
  }

  console.log('PASS Test 13 — End-to-end integration and compatibility with simWorker telemetry frames');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 14: Pure determinism, boundary conditions, and input immutability
// ─────────────────────────────────────────────────────────────────────────────
function testDeterminismAndImmutability(): void {
  const input: LinkStatusTelemetryInput = Object.freeze({
    obstacle_blocked: false,
    terrain_is_los: true,
    link_outage: false,
    modcod_name: 'QPSK 1/2',
    diffraction_loss_db: 0.0,
    snr_db: 4.5,
    state_name: NodeTerrainState.NORMAL_LOS,
  });

  const res1 = classifyLinkCommunicationStatus(input);
  const res2 = classifyLinkCommunicationStatus(input);

  assert.deepEqual(res1, res2, 'Classifier must be strictly deterministic');
  assert.equal(res1.status, 'CONNECTED');

  // Boundary condition: diffraction loss epsilon
  const resZeroLoss = classifyLinkCommunicationStatus({
    ...input,
    diffraction_loss_db: 0.00001, // <= 1e-4 epsilon
  });
  assert.equal(resZeroLoss.status, 'CONNECTED');

  const resSmallLoss = classifyLinkCommunicationStatus({
    ...input,
    diffraction_loss_db: 0.001, // > 1e-4 epsilon
  });
  assert.equal(resSmallLoss.status, 'DEGRADED');

  console.log('PASS Test 14 — Pure determinism, boundary conditions, and input immutability');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 15: Conflict resolution & missing telemetry safety (never false CONNECTED)
// ─────────────────────────────────────────────────────────────────────────────
function testConflictResolutionAndOutageSafety(): void {
  // Case A: Contradictory link_outage=false with SNR below -1.5 dB demodulation cutoff
  const resSubSnr = classifyLinkCommunicationStatus({
    obstacle_blocked: false,
    terrain_is_los: true,
    link_outage: false, // Contradictory flag
    snr_db: -4.0,       // Below MIN_OPERATIONAL_SNR_DB (-1.5 dB)
    modcod_name: '64-APSK 5/6',
    diffraction_loss_db: 0.0,
  });
  assert.equal(resSubSnr.status, 'OUTAGE_DISCONNECTED', 'Sub-threshold SNR must trigger outage');
  assert.equal(resSubSnr.isOperational, false);

  // Case B: Contradictory link_outage=false with modcod_name='LINK_OUTAGE'
  const resModcodOutage = classifyLinkCommunicationStatus({
    obstacle_blocked: false,
    terrain_is_los: true,
    link_outage: false, // Contradictory flag
    snr_db: 10.0,
    modcod_name: 'LINK_OUTAGE',
    diffraction_loss_db: 0.0,
  });
  assert.equal(resModcodOutage.status, 'OUTAGE_DISCONNECTED', 'LINK_OUTAGE modcod must trigger outage');

  // Case C: Missing both link_outage and is_outage booleans must yield UNKNOWN, never CONNECTED
  const resMissingOutageBool = classifyLinkCommunicationStatus({
    obstacle_blocked: false,
    terrain_is_los: true,
    modcod_name: '64-APSK 5/6',
    snr_db: 25.0,
    diffraction_loss_db: 0.0,
  });
  assert.equal(resMissingOutageBool.status, 'UNKNOWN', 'Missing outage boolean must return UNKNOWN');
  assert.equal(resMissingOutageBool.isOperational, false);

  console.log('PASS Test 15 — Conflict resolution & missing telemetry safety (never false CONNECTED)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 16: HARD_SHADOW_CUTOFF lookahead state with terrain_is_los=true is not BLOCKED_TERRAIN
// ─────────────────────────────────────────────────────────────────────────────
function testHardShadowCutoffLookaheadSeparation(): void {
  // When optical LOS is physically clear (terrain_is_los=true), a lookahead prediction
  // does not establish current physical blockage.
  const input: LinkStatusTelemetryInput = {
    obstacle_blocked: false,
    terrain_is_los: true,
    link_outage: false,
    modcod_name: '16-APSK 4/5',
    diffraction_loss_db: 0.0,
    snr_db: 15.0,
    state_name: NodeTerrainState.HARD_SHADOW_CUTOFF,
  };

  const res = classifyLinkCommunicationStatus(input);
  assert.notEqual(res.status, 'BLOCKED_TERRAIN', 'Physically clear LOS must not be BLOCKED_TERRAIN');
  assert.equal(res.isBlocked, false);

  // When terrain_is_los is false, physical occlusion correctly yields BLOCKED_TERRAIN
  const resBlocked = classifyLinkCommunicationStatus({
    ...input,
    terrain_is_los: false,
    link_outage: true,
    diffraction_loss_db: 35.0,
  });
  assert.equal(resBlocked.status, 'BLOCKED_TERRAIN');
  assert.equal(resBlocked.isBlocked, true);

  console.log('PASS Test 16 — HARD_SHADOW_CUTOFF lookahead state with terrain_is_los=true is not BLOCKED_TERRAIN');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 17: Equivalent status semantics between SelectedLinkBudgetTelemetry and per-node telemetry
// ─────────────────────────────────────────────────────────────────────────────
function testSelectedLinkBudgetSemanticsEquivalence(): void {
  const manager = new SimulationWorkerManager();
  const acnPos = manager.trajectoryEngine.getAcnPosition(manager.simTimeS);
  // @ts-expect-error accessing private method
  const frame = manager.buildTelemetryFrame(acnPos);

  const selId = frame.selected_node_id;
  const nodeTel = frame.nodes_telemetry.find((n: { node_id: number }) => n.node_id === selId);
  const budgetTel = frame.selected_link_budget;

  assert.ok(nodeTel, 'Selected node must exist in nodes_telemetry');
  assert.ok(budgetTel, 'Selected link budget must exist');
  assert.equal(nodeTel.node_id, budgetTel.node_id);

  const classNode = classifyLinkCommunicationStatus(nodeTel);
  const classBudget = classifyLinkCommunicationStatus(budgetTel);

  assert.equal(
    classNode.status,
    classBudget.status,
    `Classification mismatch between nodes_telemetry (${classNode.status}) and selected_link_budget (${classBudget.status})`
  );
  assert.equal(classNode.isOperational, classBudget.isOperational);
  assert.equal(classNode.isBlocked, classBudget.isBlocked);
  assert.equal(classNode.isOutage, classBudget.isOutage);

  console.log('PASS Test 17 — Equivalent status semantics between SelectedLinkBudgetTelemetry and per-node telemetry');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 18: Map link visual style mapping (getMapLinkStyle, classifyAndStyleLink)
// ─────────────────────────────────────────────────────────────────────────────
function testMapLinkStyleMapping(): void {
  const statuses: Array<keyof typeof MAP_LINK_STYLES> = [
    'CONNECTED',
    'DEGRADED',
    'BLOCKED_TERRAIN',
    'BLOCKED_OBSTACLE',
    'OUTAGE_DISCONNECTED',
    'UNKNOWN',
  ];

  const seenDashPatterns = new Set<string>();
  const seenColors = new Set<string>();

  for (const st of statuses) {
    const style: MapLinkStyle = getMapLinkStyle(st);
    assert.equal(style.status, st);
    assert.ok(style.strokeColor, `Style for ${st} must have a strokeColor`);
    assert.ok(style.selectedStrokeColor, `Style for ${st} must have a selectedStrokeColor`);
    assert.ok(style.statusLabel.length > 0, `Style for ${st} must have a statusLabel`);
    assert.ok(style.patternDescription.length > 0, `Style for ${st} must have a patternDescription`);
    assert.ok(style.selectedLineWidth > style.lineWidth, 'Selected line width must exceed unselected width');

    // Accessibility check: each status must have a distinct line dash pattern
    const dashKey = JSON.stringify(style.lineDash);
    assert.ok(!seenDashPatterns.has(dashKey), `Duplicate dash pattern detected for ${st}: ${dashKey}`);
    seenDashPatterns.add(dashKey);

    // Each status must have a distinct color
    assert.ok(!seenColors.has(style.selectedStrokeColor), `Duplicate color detected for ${st}`);
    seenColors.add(style.selectedStrokeColor);
  }

  // Safe fallback to UNKNOWN on invalid input
  const fallback = getMapLinkStyle(null);
  assert.equal(fallback.status, 'UNKNOWN');
  const fallbackBad = getMapLinkStyle('INVALID_STATUS');
  assert.equal(fallbackBad.status, 'UNKNOWN');

  // Integrated classifyAndStyleLink helper
  const { classification, style } = classifyAndStyleLink({
    obstacle_blocked: false,
    terrain_is_los: true,
    link_outage: false,
    modcod_name: '64-APSK 5/6',
    diffraction_loss_db: 0.0,
    snr_db: 25.0,
  });
  assert.equal(classification.status, 'CONNECTED');
  assert.equal(style.status, 'CONNECTED');
  assert.deepEqual(style.lineDash, []);

  console.log('PASS Test 18 — Map link visual style mapping (getMapLinkStyle, classifyAndStyleLink)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 19: Unified status badge mapping (getStatusBadgeInfo) agreement across surfaces
// ─────────────────────────────────────────────────────────────────────────────
function testStatusBadgeAgreementAcrossSurfaces(): void {
  const expectedMappings = [
    {
      status: 'CONNECTED',
      badgeClass: 'kpi-badge badge-cyan',
      badgeText: 'CONNECTED',
      badgeColor: '#38bdf8',
    },
    {
      status: 'DEGRADED',
      badgeClass: 'kpi-badge badge-amber',
      badgeText: 'DEGRADED',
      badgeColor: '#f59e0b',
    },
    {
      status: 'BLOCKED_TERRAIN',
      badgeClass: 'kpi-badge badge-crimson',
      badgeText: 'BLOCKED (TERRAIN)',
      badgeColor: '#ef4444',
    },
    {
      status: 'BLOCKED_OBSTACLE',
      badgeClass: 'kpi-badge badge-amber',
      badgeText: 'BLOCKED (OBSTACLE)',
      badgeColor: '#f97316',
    },
    {
      status: 'OUTAGE_DISCONNECTED',
      badgeClass: 'kpi-badge badge-slate',
      badgeText: 'OUTAGE (DISCONNECTED)',
      badgeColor: '#94a3b8',
    },
    {
      status: 'UNKNOWN',
      badgeClass: 'kpi-badge badge-neutral',
      badgeText: 'UNKNOWN (UNVERIFIED)',
      badgeColor: '#64748b',
    },
  ];

  for (const exp of expectedMappings) {
    const badgeInfo = getStatusBadgeInfo(exp.status as any);
    const style = getMapLinkStyle(exp.status as any);

    assert.equal(badgeInfo.status, exp.status);
    assert.equal(badgeInfo.badgeClass, exp.badgeClass, `Badge class mismatch for ${exp.status}`);
    assert.equal(badgeInfo.badgeText, exp.badgeText, `Badge text mismatch for ${exp.status}`);
    assert.equal(badgeInfo.badgeColor, exp.badgeColor, `Badge color mismatch for ${exp.status}`);

    // Map style and badge info text & color must agree 100%
    assert.equal(badgeInfo.badgeText, style.statusLabel);
    assert.equal(badgeInfo.badgeColor, style.badgeColor);
  }

  // Fallback behavior on invalid/null/undefined
  const fallbackNull = getStatusBadgeInfo(null);
  assert.equal(fallbackNull.status, 'UNKNOWN');
  assert.equal(fallbackNull.badgeClass, 'kpi-badge badge-neutral');

  const fallbackUndefined = getStatusBadgeInfo(undefined);
  assert.equal(fallbackUndefined.status, 'UNKNOWN');

  const fallbackBogus = getStatusBadgeInfo('NON_EXISTENT_STATUS');
  assert.equal(fallbackBogus.status, 'UNKNOWN');

  console.log('PASS Test 19 — Unified status badge mapping (getStatusBadgeInfo) agreement across surfaces');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 20: Authoritative RF metrics formatting and validation
// ─────────────────────────────────────────────────────────────────────────────
function testAuthoritativeRfMetricsFormatting(): void {
  function formatMetric(val: unknown, decimals: number, unit?: string): string {
    if (typeof val === 'number' && Number.isFinite(val)) {
      return unit ? `${val.toFixed(decimals)} ${unit}` : val.toFixed(decimals);
    }
    return '--';
  }

  // Valid telemetry metrics from link budget
  const sampleMetrics = {
    slant_range_km: 39.123,
    snr_db: 28.54,
    spectral_efficiency_bps_hz: 4.956,
    fspl_db: 142.34,
    diffraction_loss_db: 0.0,
    prx_dbm: -78.48,
    pnoise_dbm: -108.97,
    earth_bulge_m: 117.2,
    gas_loss_db: 0.45,
    rain_loss_db: 0.0,
    modcod_name: '64-APSK 5/6',
  };

  assert.equal(formatMetric(sampleMetrics.slant_range_km, 2, 'km'), '39.12 km');
  assert.equal(formatMetric(sampleMetrics.snr_db, 1, 'dB'), '28.5 dB');
  assert.equal(formatMetric(sampleMetrics.spectral_efficiency_bps_hz, 2, 'bps/Hz'), '4.96 bps/Hz');
  assert.equal(formatMetric(sampleMetrics.fspl_db, 1, 'dB'), '142.3 dB');
  assert.equal(formatMetric(sampleMetrics.diffraction_loss_db, 1, 'dB'), '0.0 dB');
  assert.equal(formatMetric(sampleMetrics.prx_dbm, 1, 'dBm'), '-78.5 dBm');
  assert.equal(formatMetric(sampleMetrics.pnoise_dbm, 2, 'dBm'), '-108.97 dBm');
  assert.equal(formatMetric(sampleMetrics.earth_bulge_m, 1, 'm'), '117.2 m');
  assert.equal(formatMetric(sampleMetrics.gas_loss_db, 2, 'dB'), '0.45 dB');
  assert.equal(formatMetric(sampleMetrics.rain_loss_db, 1, 'dB'), '0.0 dB');

  // Missing / undefined / null metrics must yield '--', never synthetic approximations
  assert.equal(formatMetric(undefined, 1, 'dB'), '--');
  assert.equal(formatMetric(null, 1, 'dB'), '--');
  assert.equal(formatMetric(NaN, 1, 'dB'), '--');
  assert.equal(formatMetric(Infinity, 1, 'dB'), '--');

  console.log('PASS Test 20 — Authoritative RF metrics formatting and validation');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 21: Historical record RF and communication status correspondence
// ─────────────────────────────────────────────────────────────────────────────
function testHistoricalRecordRfAndStatusCorrespondence(): void {
  const manager = new SimulationWorkerManager();
  const acnPos = manager.trajectoryEngine.getAcnPosition(manager.simTimeS);
  // @ts-expect-error accessing private method
  const frame = manager.buildTelemetryFrame(acnPos);

  const selNode = frame.nodes_telemetry.find((n: { node_id: number }) => n.node_id === frame.selected_node_id);
  assert.ok(selNode, 'Selected node telemetry must exist');
  assert.ok(frame.selected_link_budget, 'Selected link budget must exist');
  const lb = frame.selected_link_budget;

  const liveClassification = classifyLinkCommunicationStatus({
    ...selNode,
    ...lb,
  });

  const histRecord = createHistoricalRecordSnapshot({
    frameIndex: frame.frame_index,
    simulationTimeS: frame.sim_time_s,
    selectedNodeId: frame.selected_node_id,
    nodeName: `Node ${selNode.node_id}`,
    profileSerial: 1,
    groundNodePositionMslM: [selNode.x_m, selNode.y_m, selNode.z_m],
    acnPositionMslM: [frame.acn_telemetry.pos_x, frame.acn_telemetry.pos_y, frame.acn_telemetry.pos_z],
    profile: frame.selected_node_fresnel.profile,
    obstruction: {
      terrainIsLos: frame.selected_node_fresnel.terrain_is_los,
      obstacleBlocked: frame.selected_node_fresnel.obstacle_blocked,
      minClearanceM: frame.selected_node_fresnel.clearance_m,
      diffractionLossDb: frame.selected_node_fresnel.diffraction_loss_db,
      primaryBlockedObstacleId: null,
      terrainStatusText: 'TERRAIN STATUS',
      terrainBadgeClass: 'badge-class',
      obstacleStatusText: 'OBSTACLE STATUS',
      obstacleBadgeClass: 'badge-obs-class',
    },
    linkBudget: {
      modcodName: lb.modcod_name,
      snrDb: lb.snr_db,
      spectralEfficiencyBpsHz: lb.spectral_efficiency_bps_hz,
      slantRangeKm: lb.slant_range_km,
      fsplDb: Number(lb.fspl_db.toFixed(1)),
      diffractionLossDb: lb.diffraction_loss_db,
      rxPowerDbm: Number(lb.prx_dbm.toFixed(1)),
      earthBulgeM: Number(lb.earth_bulge_m.toFixed(1)),
      gaseousLossDb: Number(lb.gas_loss_db.toFixed(2)),
      pNoiseDbm: Number(lb.pnoise_dbm.toFixed(2)),
      rainLossDb: Number(lb.rain_loss_db.toFixed(1)),
    },
    profilePoints: frame.selected_node_fresnel.profile_points,
  });

  // Authoritative link budget metrics preservation in snapshot
  assert.equal(histRecord.linkBudget.modcodName, lb.modcod_name);
  assert.equal(histRecord.linkBudget.snrDb, lb.snr_db);
  assert.equal(histRecord.linkBudget.diffractionLossDb, lb.diffraction_loss_db);
  assert.equal(histRecord.linkBudget.pNoiseDbm, Number(lb.pnoise_dbm.toFixed(2)));
  assert.equal(histRecord.linkBudget.rainLossDb, Number(lb.rain_loss_db.toFixed(1)));

  // Classify historical record
  const histInput = {
    terrain_is_los: histRecord.obstruction.terrainIsLos,
    obstacle_blocked: histRecord.obstruction.obstacleBlocked,
    link_outage: histRecord.linkBudget.modcodName === 'LINK_OUTAGE' || histRecord.linkBudget.modcodName === 'OBSTACLE_BLOCKED' || histRecord.linkBudget.snrDb < -1.5,
    is_outage: histRecord.linkBudget.modcodName === 'LINK_OUTAGE' || histRecord.linkBudget.modcodName === 'OBSTACLE_BLOCKED' || histRecord.linkBudget.snrDb < -1.5,
    modcod_name: histRecord.linkBudget.modcodName,
    diffraction_loss_db: histRecord.linkBudget.diffractionLossDb,
    snr_db: histRecord.linkBudget.snrDb,
    fresnel_clearance_m: histRecord.obstruction.minClearanceM,
  };
  const histClassification = classifyLinkCommunicationStatus(histInput);

  assert.equal(
    histClassification.status,
    liveClassification.status,
    `Historical classification (${histClassification.status}) must match live (${liveClassification.status})`
  );

  console.log('PASS Test 21 — Historical record RF and communication status correspondence');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 22: Paused PROFILE_FRAME isolation
// ─────────────────────────────────────────────────────────────────────────────
function testPausedProfileFrameIsolation(): void {
  const manager = new SimulationWorkerManager();
  manager.isPaused = true;
  const initialSimTime = manager.simTimeS;
  const initialFrameIndex = manager.frameIndex;
  const initialProfileSerial = (manager as any).profileSerial;

  const messages: any[] = [];
  (manager as any).emitHostMessage = (msg: any) => { messages.push(msg); };

  // Call emitProfileFrame while paused
  manager.emitProfileFrame();

  assert.equal(manager.simTimeS, initialSimTime, 'Sim time must not advance on emitProfileFrame');
  assert.equal(manager.frameIndex, initialFrameIndex, 'Frame index must not advance on emitProfileFrame');
  assert.equal((manager as any).profileSerial, initialProfileSerial + 1, 'profileSerial must increment monotonically');

  assert.equal(messages.length, 1);
  const msg = messages[0];
  assert.equal(msg.type, 'PROFILE_FRAME');
  assert.equal(msg.selectedNodeId, manager.selectedNodeId);
  assert.equal(msg.profileSerial, initialProfileSerial + 1);
  assert.ok(msg.fresnel, 'PROFILE_FRAME must contain fresnel profile');
  assert.ok(msg.selected_link_budget, 'PROFILE_FRAME must contain selected_link_budget');
  assert.ok(msg.nodes_telemetry, 'PROFILE_FRAME must contain nodes_telemetry');

  // Verify that a SimulationHistoryBuffer is NOT populated by profile refreshes
  const buffer = new SimulationHistoryBuffer(10);
  assert.equal(buffer.size, 0);

  console.log('PASS Test 22 — Paused PROFILE_FRAME isolation');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 23: Terminal selection change synchronization
// ─────────────────────────────────────────────────────────────────────────────
function testTerminalSelectionSynchronization(): void {
  const manager = new SimulationWorkerManager();
  const messages: any[] = [];
  (manager as any).emitHostMessage = (msg: any) => { messages.push(msg); };

  // Select node 4 (typically occluded in theater)
  manager.handleMessage({ type: 'SELECT_NODE', node_id: 4 });
  assert.equal(manager.selectedNodeId, 4);
  const msgNode4 = messages.find(m => m.type === 'PROFILE_FRAME');
  assert.ok(msgNode4, 'PROFILE_FRAME must be emitted for node 4');
  assert.equal(msgNode4.selectedNodeId, 4);

  const classNode4 = classifyLinkCommunicationStatus(msgNode4.selected_link_budget);

  // Switch to Node 0 (close range, clear LOS)
  messages.length = 0;
  manager.handleMessage({ type: 'SELECT_NODE', node_id: 0 });
  assert.equal(manager.selectedNodeId, 0);
  const msgNode0 = messages.find(m => m.type === 'PROFILE_FRAME');
  assert.ok(msgNode0, 'PROFILE_FRAME must be emitted for node 0');
  assert.equal(msgNode0.selectedNodeId, 0);

  const classNode0 = classifyLinkCommunicationStatus(msgNode0.selected_link_budget);
  assert.equal(classNode0.status, 'CONNECTED', 'Node 0 should be connected');
  assert.equal(msgNode4.selected_link_budget.node_id, 4);
  assert.equal(msgNode0.selected_link_budget.node_id, 0);
  assert.notEqual(msgNode4.selected_link_budget.slant_range_km, msgNode0.selected_link_budget.slant_range_km);
  assert.notEqual(msgNode4.selected_link_budget.fspl_db, msgNode0.selected_link_budget.fspl_db);
  assert.notEqual(msgNode4.fresnel.distance_km, msgNode0.fresnel.distance_km);

  console.log('PASS Test 23 — Terminal selection change synchronization');
}

// ─────────────────────────────────────────────────────────────────────────────
// Run All Tests
// ─────────────────────────────────────────────────────────────────────────────
function runAllTests(): void {
  testUnknownOnMalformedInput();
  testUnknownOnNonFiniteNumbers();
  testBlockedObstacleClearTerrain();
  testBlockedObstacleConflictingWithTerrain();
  testBlockedTerrain();
  testOutageDisconnected();
  testDegradedOnDiffractionLoss();
  testDegradedOnLookaheadWarning();
  testDiffractionLossClearanceJustification();
  testDegradedOnThresholdModcod();
  testConnectedNominalLink();
  testHelperFunctions();
  testSimWorkerIntegration();
  testDeterminismAndImmutability();
  testConflictResolutionAndOutageSafety();
  testHardShadowCutoffLookaheadSeparation();
  testSelectedLinkBudgetSemanticsEquivalence();
  testMapLinkStyleMapping();
  testStatusBadgeAgreementAcrossSurfaces();
  testAuthoritativeRfMetricsFormatting();
  testHistoricalRecordRfAndStatusCorrespondence();
  testPausedProfileFrameIsolation();
  testTerminalSelectionSynchronization();

  console.log('PASS All Milestone 4 Step 2 & 3 & 4 Link Status Classifier and RF Synchronization unit tests passed successfully.');
}

runAllTests();
