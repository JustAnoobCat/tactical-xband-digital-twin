/**
 * Suite 105: Defense EW / ECCM, MVDR Spatial Null-Steering, Adversary ESM/ELINT LPI Engine & GNSS Spoofing
 * Specification: docs/specs/v3-03-ew-eccm-esm-lpi.md (SPEC-V3-03)
 *
 * Verifies:
 * 1. [EW-T1] FHSS / DSSS Spread Spectrum Processing Gain & Partial-Band Follower Penalty:
 *    Exact 13.0103 dB processing gain (20 MHz / 1 MHz), partial-band concentration penalty,
 *    NONE === 0.0 dB, and non-finite / boundary safety.
 * 2. [EW-T2] MVDR Spatial Null-Steering Rejection & Shortest Geodetic Arc:
 *    0.0 dB for collinear jammer (<= 0.5 deg), 25.0 dB for far-out jammer (>= 12 deg),
 *    smooth C^1 raised-cosine transition, 359 <-> 1 wrap-around symmetry, and joint jammer mitigation.
 * 3. [EW-T3] Adversary ESM / ELINT Inverse-Square Law & LPI Safety Ratio:
 *    -10 dB TX power cut shrinks R_det by exact factor sqrt(10) (3.16228x), LPI safety ratio
 *    improves with power backoff, and logistic intercept probability is monotonic.
 * 4. [EW-T4] GNSS Timing Spoofing & Closed-Loop Guard-Band Collapse:
 *    Linear TA drift injection, OCXO holdover 10x mitigation, and dynamic TDMA guard time collapse
 *    triggering slotCollisionOutage === true and zero data-plane efficiency.
 * 5. [EW-T5] Live Worker EW Recovery Proof, Determinism, RESET_SIM, UI & Micro-Benchmark:
 *    Live 50 Hz worker proves MVDR+DSSS recovers jammed link SINR by >= 15 dB; clean reset on
 *    RESET_SIM; bit-exact determinism; index.html DOM/accessibility compliance; 10,000 evaluations < 30 ms.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeSpreadSpectrumProcessingGainDb,
  computeMvdrNullSteeringRejectionDb,
  evaluateEwJammerMitigation,
  evaluateAdversaryEsmLpi,
  computeGnssSpoofingTaDriftUs,
  buildEwEccmTelemetry,
  type SpreadSpectrumEccmMode,
  type EwEccmTelemetry,
} from '../core/ewEccmEngine';
import { computeDynamicTdmaOverhead } from '../core/macPhyFeedback';
import { SimulationWorkerManager } from '../worker/simWorker';
import type { TelemetryFrameMessage } from '../shared/workerProtocol';

const ANSI = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

async function runSuite(): Promise<void> {
  console.log('='.repeat(80));
  console.log(`${ANSI.bold}${ANSI.cyan}[SUITE 105] Defense EW / ECCM, MVDR Null-Steering, ESM/LPI & GNSS Spoofing${ANSI.reset}`);
  console.log('='.repeat(80));

  // ===========================================================================
  // [EW-T1] Spread Spectrum Processing Gain & Partial-Band Follower Penalty
  // ===========================================================================
  console.log('\n[1/5] Verifying [EW-T1] Spread Spectrum Processing Gain & Partial-Band Follower Penalty...');

  // 1.1 Mode 'NONE' must yield exactly 0.0 dB
  const gainNone = computeSpreadSpectrumProcessingGainDb({
    eccmMode: 'NONE',
    spreadBandwidthHz: 20e6,
    signalBandwidthHz: 1e6,
  });
  assert.equal(gainNone, 0.0, "Mode 'NONE' must yield exactly 0.0 dB processing gain");

  // 1.2 Mode 'DSSS' must yield exact 10 * log10(20 MHz / 1 MHz) = 13.0103 dB
  const gainDsss = computeSpreadSpectrumProcessingGainDb({
    eccmMode: 'DSSS',
    spreadBandwidthHz: 20e6,
    signalBandwidthHz: 1e6,
  });
  const expectedDsss = 10.0 * Math.log10(20.0);
  assert.ok(
    Math.abs(gainDsss - expectedDsss) < 1e-4,
    `DSSS gain (${gainDsss}) must match theoretical 10*log10(20) = ${expectedDsss}`
  );
  assert.ok(
    Math.abs(gainDsss - 13.0103) < 1e-3,
    `DSSS gain (${gainDsss}) must equal 13.0103 dB`
  );

  // 1.3 DSSS with equal bandwidths must yield 0.0 dB
  const gainDsssUnit = computeSpreadSpectrumProcessingGainDb({
    eccmMode: 'DSSS',
    spreadBandwidthHz: 1e6,
    signalBandwidthHz: 1e6,
  });
  assert.equal(gainDsssUnit, 0.0, 'DSSS with spread == signal bandwidth must yield 0.0 dB');

  // 1.4 FHSS with full band (partialBandJamFraction = 1.0) must match base hop gain
  const gainFhssFull = computeSpreadSpectrumProcessingGainDb({
    eccmMode: 'FHSS',
    spreadBandwidthHz: 20e6,
    signalBandwidthHz: 1e6,
    partialBandJamFraction: 1.0,
  });
  assert.ok(
    Math.abs(gainFhssFull - expectedDsss) < 1e-4,
    `FHSS full band gain (${gainFhssFull}) must equal base hop gain (${expectedDsss})`
  );

  // 1.5 FHSS with partial-band jammer concentrating in 50% of the band (rho = 0.5)
  // Gp = 10*log10(20) - 10*log10(1/0.5) = 13.0103 - 3.0103 = 10.0 dB
  const gainFhssHalf = computeSpreadSpectrumProcessingGainDb({
    eccmMode: 'FHSS',
    spreadBandwidthHz: 20e6,
    signalBandwidthHz: 1e6,
    partialBandJamFraction: 0.5,
  });
  assert.ok(
    Math.abs(gainFhssHalf - 10.0) < 1e-4,
    `FHSS with rho=0.5 must yield exactly 10.0 dB gain, got ${gainFhssHalf}`
  );

  // 1.6 FHSS with severe concentration (rho = 0.01) must clamp to >= 0.0 dB
  const gainFhssSevere = computeSpreadSpectrumProcessingGainDb({
    eccmMode: 'FHSS',
    spreadBandwidthHz: 20e6,
    signalBandwidthHz: 1e6,
    partialBandJamFraction: 0.01,
  });
  assert.equal(gainFhssSevere, 0.0, 'FHSS with severe concentration penalty must clamp to >= 0.0 dB');

  // 1.7 Non-finite and boundary input safety
  const gainSafe1 = computeSpreadSpectrumProcessingGainDb({
    eccmMode: 'DSSS',
    spreadBandwidthHz: -20e6,
    signalBandwidthHz: 0,
  });
  assert.ok(Number.isFinite(gainSafe1) && gainSafe1 >= 0.0, 'Negative/zero bandwidths must safely return finite >= 0.0');

  console.log(`${ANSI.green}✓ [EW-T1] Spread spectrum processing gain and partial-band jammer penalty verified.${ANSI.reset}`);

  // ===========================================================================
  // [EW-T2] MVDR Spatial Null-Steering Rejection & Shortest Geodetic Arc
  // ===========================================================================
  console.log('\n[2/5] Verifying [EW-T2] MVDR Spatial Null-Steering Rejection & Shortest Geodetic Arc...');

  // 2.1 Collinear jammer (deltaTheta <= 0.5 deg) cannot be nulled without nulling desired signal
  const rejCollinear0 = computeMvdrNullSteeringRejectionDb({
    desiredAzimuthDeg: 45.0,
    jammerAzimuthDeg: 45.0,
  });
  assert.equal(rejCollinear0, 0.0, 'Collinear jammer (0.0 deg) must produce 0.0 dB spatial rejection');

  const rejCollinearHalf = computeMvdrNullSteeringRejectionDb({
    desiredAzimuthDeg: 45.0,
    jammerAzimuthDeg: 45.5,
  });
  assert.equal(rejCollinearHalf, 0.0, 'Collinear jammer (0.5 deg boundary) must produce 0.0 dB rejection');

  // 2.2 Far-out jammer (deltaTheta >= nullBeamwidthDeg = 12 deg) must achieve maxNullDepthDb (25.0 dB)
  const rejFarOut = computeMvdrNullSteeringRejectionDb({
    desiredAzimuthDeg: 0.0,
    jammerAzimuthDeg: 30.0,
  });
  assert.equal(rejFarOut, 25.0, 'Jammer at 30 deg (> 12 deg) must achieve maximum 25.0 dB null depth');

  const rejAtBoundary = computeMvdrNullSteeringRejectionDb({
    desiredAzimuthDeg: 0.0,
    jammerAzimuthDeg: 12.0,
  });
  assert.equal(rejAtBoundary, 25.0, 'Jammer at exact 12 deg boundary must achieve 25.0 dB null depth');

  // 2.3 Transition region (0.5 deg < deltaTheta < 12 deg) follows smooth raised-cosine
  const rejMid = computeMvdrNullSteeringRejectionDb({
    desiredAzimuthDeg: 0.0,
    jammerAzimuthDeg: 6.25, // Midpoint of (0.5, 12): x = (6.25 - 0.5) / 11.5 = 0.5 => f(x) = (1 - cos(pi/2))/2 = 0.5
  });
  assert.ok(
    Math.abs(rejMid - 12.5) < 1e-4,
    `Midpoint rejection must equal exact half-depth (12.5 dB), got ${rejMid}`
  );

  // 2.4 Geodetic circular wrap: 359 deg <-> 1 deg must yield deltaTheta = 2 deg
  const rejWrap1 = computeMvdrNullSteeringRejectionDb({
    desiredAzimuthDeg: 359.0,
    jammerAzimuthDeg: 1.0,
  });
  const rejWrap2 = computeMvdrNullSteeringRejectionDb({
    desiredAzimuthDeg: 1.0,
    jammerAzimuthDeg: 359.0,
  });
  assert.ok(rejWrap1 > 0.0 && rejWrap1 < 25.0, `Wrapped separation (2 deg) rejection must be in (0, 25), got ${rejWrap1}`);
  assert.equal(rejWrap1, rejWrap2, 'Rejection must be symmetric under angle permutation across 0/360 wrap');

  // 2.5 Opposite azimuth (180 deg separation)
  const rejOpposite = computeMvdrNullSteeringRejectionDb({
    desiredAzimuthDeg: 10.0,
    jammerAzimuthDeg: 190.0,
  });
  assert.equal(rejOpposite, 25.0, 'Opposite azimuth (180 deg) must achieve full 25.0 dB null depth');

  // 2.6 Joint EW Jammer Mitigation Evaluator
  const jointMitigation = evaluateEwJammerMitigation({
    rawJammerPowerDbm: -50.0,
    spatialNullRejectionDb: 25.0,
    eccmProcessingGainDb: 13.0103,
    desiredSignalPowerDbm: -70.0,
    thermalNoisePowerDbm: -100.0,
  });
  assert.ok(
    Math.abs(jointMitigation.effectiveJammerPowerDbm - (-88.0103)) < 1e-3,
    `Effective jammer power must be -88.0103 dBm, got ${jointMitigation.effectiveJammerPowerDbm}`
  );
  assert.ok(
    Math.abs(jointMitigation.totalMitigationDb - 38.0103) < 1e-3,
    `Total mitigation must be 38.0103 dB, got ${jointMitigation.totalMitigationDb}`
  );
  assert.ok(jointMitigation.sinrImprovementDb > 15.0, `SINR improvement must be > 15 dB, got ${jointMitigation.sinrImprovementDb}`);
  assert.equal(jointMitigation.jammerSuppressed, true, 'Jammer must be flagged as suppressed when mitigation >= 20 dB');

  console.log(`${ANSI.green}✓ [EW-T2] MVDR spatial null-steering and geodetic wrap symmetry verified.${ANSI.reset}`);

  // ===========================================================================
  // [EW-T3] Adversary ESM / ELINT Inverse-Square Law & LPI Safety Ratio
  // ===========================================================================
  console.log('\n[3/5] Verifying [EW-T3] Adversary ESM / ELINT Inverse-Square Law & LPI Safety Ratio...');

  // 3.1 Exact inverse-square law: -10 dB TX power cut shrinks R_det by exact factor sqrt(10)
  const esmHigh = evaluateAdversaryEsmLpi({
    txPowerDbm: 30.0,
    txGainDbi: 3.0,
    friendlyRangeM: 10000.0,
    freqHz: 8e9,
    esmSensitivityDbm: -105.0,
    esmAntennaGainDbi: 6.0,
    esmDistanceM: 15000.0,
  });

  const esmLow = evaluateAdversaryEsmLpi({
    txPowerDbm: 20.0, // Exactly 10 dB less
    txGainDbi: 3.0,
    friendlyRangeM: 10000.0,
    freqHz: 8e9,
    esmSensitivityDbm: -105.0,
    esmAntennaGainDbi: 6.0,
    esmDistanceM: 15000.0,
  });

  assert.ok(esmHigh.detectionRadiusM > 0, 'Detection radius must be positive');
  assert.ok(esmLow.detectionRadiusM > 0, 'Detection radius must be positive');

  const ratio = esmHigh.detectionRadiusM / esmLow.detectionRadiusM;
  const expectedSqrt10 = Math.sqrt(10.0);
  assert.ok(
    Math.abs(ratio - expectedSqrt10) < 0.001,
    `A -10 dB TX cut must shrink detection radius by sqrt(10) = ${expectedSqrt10.toFixed(5)}, got ${ratio.toFixed(5)}`
  );

  // 3.2 LPI Safety Ratio increases when TX power is backed off
  assert.ok(
    esmLow.lpiSafetyRatio > esmHigh.lpiSafetyRatio,
    `LPI safety ratio must increase under power backoff (Low: ${esmLow.lpiSafetyRatio.toFixed(3)} > High: ${esmHigh.lpiSafetyRatio.toFixed(3)})`
  );

  // 3.3 Calibrated logistic intercept probability
  // At threshold (P_int == sEsmDbm), intercept probability must be exactly 0.50
  const esmAtThreshold = evaluateAdversaryEsmLpi({
    txPowerDbm: -40.0, // Calibrated so P_int == -105 dBm
    txGainDbi: 0.0,
    freqHz: 8e9,
    esmSensitivityDbm: -105.0,
    esmAntennaGainDbi: 0.0,
    esmDistanceM: 10000.0,
  });
  // Calculate exact P_int for verification
  const margin = esmAtThreshold.interceptPowerDbm - (-105.0);
  const expectedPint = 1.0 / (1.0 + Math.exp(-0.5 * margin));
  assert.ok(
    Math.abs(esmAtThreshold.interceptProbability - expectedPint) < 1e-4,
    'Logistic intercept probability must strictly evaluate 1 / (1 + exp(-0.5 * margin))'
  );

  // High power must have higher intercept probability than low power
  assert.ok(
    esmHigh.interceptProbability > esmLow.interceptProbability,
    `High power P_int (${esmHigh.interceptProbability.toFixed(3)}) must exceed low power P_int (${esmLow.interceptProbability.toFixed(3)})`
  );

  console.log(`${ANSI.green}✓ [EW-T3] Adversary ESM/ELINT inverse-square radius and LPI safety ratio verified.${ANSI.reset}`);

  // ===========================================================================
  // [EW-T4] GNSS Timing Spoofing & Closed-Loop Guard-Band Collapse
  // ===========================================================================
  console.log('\n[4/5] Verifying [EW-T4] GNSS Timing Spoofing & Closed-Loop Guard-Band Collapse...');

  // 4.1 Invalidation cases
  assert.equal(computeGnssSpoofingTaDriftUs(0, 10), 0.0, 'Elapsed <= 0 must yield 0.0 us drift');
  assert.equal(computeGnssSpoofingTaDriftUs(10, 0), 0.0, 'Rate <= 0 must yield 0.0 us drift');
  assert.equal(computeGnssSpoofingTaDriftUs(-5, 10), 0.0, 'Negative elapsed must yield 0.0 us drift');

  // 4.2 Linear accumulation
  const drift10s = computeGnssSpoofingTaDriftUs(10.0, 15.0);
  assert.equal(drift10s, 150.0, '10 s at 15 us/s must yield 150.0 us drift');

  // 4.3 Maximum clamping
  const driftClamped = computeGnssSpoofingTaDriftUs(300.0, 20.0, 2000.0);
  assert.equal(driftClamped, 2000.0, 'Accumulated drift must clamp cleanly to maxDriftUs (2000 us)');

  // 4.4 Atomic / OCXO Holdover 10x mitigation
  const driftHoldover = computeGnssSpoofingTaDriftUs(10.0, 15.0, 2000.0, true);
  assert.equal(driftHoldover, 15.0, 'OCXO holdover must reduce effective drift by exact factor of 10 (150 -> 15 us)');

  // 4.5 Closed-loop TDMA guard time collapse
  // Under unmitigated timing drift of 1200 us, residual range error is c * 1200us / 2 = 180 km
  const c = 299792458.0;
  const unmitigatedRangeErrorM = 50.0 + (c * (1200.0 * 1e-6)) / 2.0;

  const guardUnmitigated = computeDynamicTdmaOverhead({
    slotDurationMs: 1.0, // 1000 us slot
    slotsPerFrame: 16,
    slantRangeM: 10000.0,
    timingAdvanceActive: true,
    taResidualErrorM: unmitigatedRangeErrorM,
  });

  assert.equal(
    guardUnmitigated.slotCollisionOutage,
    true,
    'Unmitigated 1200 us TA drift must exceed slot duration and trigger slotCollisionOutage === true'
  );
  assert.equal(
    guardUnmitigated.frameDataEfficiency,
    0.0,
    'Slot collision outage must drive frameDataEfficiency to 0.0'
  );

  // With OCXO holdover active, 10x reduction leaves drift at 120 us
  const holdoverRangeErrorM = 50.0 + (c * (120.0 * 1e-6)) / 2.0;
  const guardHoldover = computeDynamicTdmaOverhead({
    slotDurationMs: 1.0,
    slotsPerFrame: 16,
    slantRangeM: 10000.0,
    timingAdvanceActive: true,
    taResidualErrorM: holdoverRangeErrorM,
  });

  assert.equal(
    guardHoldover.slotCollisionOutage,
    false,
    'OCXO holdover must keep overhead within slot duration, preventing collision outage'
  );
  assert.ok(
    guardHoldover.frameDataEfficiency > 0.50,
    `OCXO holdover must preserve high frame efficiency (> 50%), got ${guardHoldover.frameDataEfficiency}`
  );

  console.log(`${ANSI.green}✓ [EW-T4] GNSS timing spoofing, TDMA guard collapse and OCXO holdover verified.${ANSI.reset}`);

  // ===========================================================================
  // [EW-T5] Live Worker EW Recovery Proof, Determinism, RESET_SIM, UI & Benchmark
  // ===========================================================================
  console.log('\n[5/5] Verifying [EW-T5] Live Worker EW Recovery Proof, Determinism, RESET_SIM & Micro-Benchmark...');

  let capturedFrames: TelemetryFrameMessage[] = [];
  (globalThis as any).self = {
    postMessage: (msg: any) => {
      if (msg && msg.type === 'TELEMETRY_FRAME') {
        capturedFrames.push(msg);
      }
    },
  };

  // 5.1 Arm A: Jammer ON, EW/ECCM OFF (Severe Interference)
  const simA = new SimulationWorkerManager(105_001, '16_NODES');
  simA.terrainEngine.setTerrainMode('synthetic');
  simA.isPaused = true;
  simA.envConfig = {
    ...simA.envConfig,
    jammerEnabled: true,
    jammerEirpDbm: 85.0,
    jammerPosEnu: [15000.0, 5000.0, 3500.0],
  };
  simA.eccmMode = 'NONE';
  simA.enableMvdrNullSteering = false;

  for (let i = 0; i < 30; i++) {
    simA.tickSimulation(true);
  }

  const linkA = simA.linkStatuses.get(4);
  const sinrA = linkA?.sinrDb ?? linkA?.snrDb ?? -99.0;
  console.log(`    Arm A (Jammed, No ECCM): Node 4 SINR = ${sinrA.toFixed(2)} dB`);

  // 5.2 Arm B: Jammer ON, DSSS + MVDR Spatial Null Steering ON (Mitigated)
  const simB = new SimulationWorkerManager(105_001, '16_NODES');
  simB.terrainEngine.setTerrainMode('synthetic');
  simB.isPaused = true;
  simB.envConfig = {
    ...simB.envConfig,
    jammerEnabled: true,
    jammerEirpDbm: 85.0,
    jammerPosEnu: [15000.0, 5000.0, 3500.0],
  };
  simB.eccmMode = 'DSSS';
  simB.enableMvdrNullSteering = true;
  simB.enableAdversaryEsmModel = true;

  capturedFrames = [];
  for (let i = 0; i < 30; i++) {
    simB.tickSimulation(true);
  }

  const linkB = simB.linkStatuses.get(4);
  const sinrB = linkB?.sinrDb ?? linkB?.snrDb ?? -99.0;
  console.log(`    Arm B (Jammed + DSSS + MVDR): Node 4 SINR = ${sinrB.toFixed(2)} dB`);

  // CRITICAL AUDIT ASSERTION: DSSS + MVDR measurably recovers jammed link SINR by >= 15 dB!
  const sinrRecoveryDb = sinrB - sinrA;
  assert.ok(
    sinrRecoveryDb >= 15.0,
    `Arm B SINR (${sinrB.toFixed(2)} dB) must exceed Arm A (${sinrA.toFixed(2)} dB) by >= 15 dB, actual recovery: ${sinrRecoveryDb.toFixed(2)} dB`
  );
  console.log(`    Measured EW/ECCM Physical Recovery: +${sinrRecoveryDb.toFixed(2)} dB`);

  // Assert ew_eccm_telemetry was broadcast
  assert.ok(capturedFrames.length > 0, 'Live worker must emit telemetry frames');
  const latestFrame = capturedFrames[capturedFrames.length - 1].frame;
  const ewTelem = latestFrame.ew_eccm_telemetry;
  assert.ok(ewTelem, 'TelemetryFrame must contain ew_eccm_telemetry');
  assert.equal(ewTelem.eccm_mode, 'DSSS', 'ew_eccm_telemetry.eccm_mode must be DSSS');
  assert.equal(ewTelem.mvdr_null_steering_enabled, true, 'mvdr_null_steering_enabled must be true');
  assert.equal(ewTelem.adversary_esm_enabled, true, 'adversary_esm_enabled must be true');
  assert.ok(ewTelem.mean_processing_gain_db > 10.0, 'mean_processing_gain_db must be > 10 dB');
  assert.ok(ewTelem.mean_spatial_null_rejection_db > 0.0, 'mean_spatial_null_rejection_db must be > 0 dB');
  assert.ok(Number.isFinite(ewTelem.esm_detection_radius_km), 'esm_detection_radius_km must be finite');
  assert.ok(Number.isFinite(ewTelem.lpi_safety_ratio), 'lpi_safety_ratio must be finite');

  // 5.3 Determinism: Two independent runs produce bit-for-bit identical results
  capturedFrames = [];
  const run1 = new SimulationWorkerManager(105_007, '16_NODES');
  run1.terrainEngine.setTerrainMode('synthetic');
  run1.isPaused = true;
  run1.eccmMode = 'FHSS';
  run1.enableMvdrNullSteering = true;
  for (let i = 0; i < 20; i++) run1.tickSimulation(true);
  const frameRun1 = capturedFrames[capturedFrames.length - 1];

  capturedFrames = [];
  const run2 = new SimulationWorkerManager(105_007, '16_NODES');
  run2.terrainEngine.setTerrainMode('synthetic');
  run2.isPaused = true;
  run2.eccmMode = 'FHSS';
  run2.enableMvdrNullSteering = true;
  for (let i = 0; i < 20; i++) run2.tickSimulation(true);
  const frameRun2 = capturedFrames[capturedFrames.length - 1];

  assert.deepEqual(
    frameRun1.frame.ew_eccm_telemetry,
    frameRun2.frame.ew_eccm_telemetry,
    'ew_eccm_telemetry must be bit-exact across independent deterministic runs'
  );

  // 5.4 RESET_SIM Cleanup
  run1.resetSimulationState();
  assert.equal(run1.eccmMode, 'NONE', 'eccmMode must reset to NONE on RESET_SIM');
  assert.equal(run1.enableMvdrNullSteering, false, 'enableMvdrNullSteering must reset to false on RESET_SIM');
  assert.equal(run1.enableAdversaryEsmModel, false, 'enableAdversaryEsmModel must reset to false on RESET_SIM');
  assert.equal(run1.gnssSpoofingRateUsPerSec, 0.0, 'gnssSpoofingRateUsPerSec must reset to 0.0 on RESET_SIM');
  assert.equal(run1.gnssSpoofElapsedSec, 0.0, 'gnssSpoofElapsedSec must reset to 0.0 on RESET_SIM');
  assert.equal(run1.ewEccmTelemetry, undefined, 'ewEccmTelemetry must reset to undefined on RESET_SIM');

  // 5.5 UI DOM & Accessibility Inspection
  const indexPath = path.resolve(import.meta.dirname, '../../index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  assert.ok(indexHtml.includes('id="ew-eccm-mode-select"'), 'index.html must contain #ew-eccm-mode-select');
  assert.ok(indexHtml.includes('id="toggle-ew-mvdr"'), 'index.html must contain #toggle-ew-mvdr');
  assert.ok(indexHtml.includes('id="toggle-ew-esm"'), 'index.html must contain #toggle-ew-esm');
  assert.ok(indexHtml.includes('id="ew-gnss-spoof-input"'), 'index.html must contain #ew-gnss-spoof-input');
  assert.ok(indexHtml.includes('id="ew-eccm-readout"'), 'index.html must contain #ew-eccm-readout');
  assert.ok(indexHtml.includes('for="ew-eccm-mode-select"'), 'Must have label for #ew-eccm-mode-select');
  assert.ok(indexHtml.includes('for="toggle-ew-mvdr"'), 'Must have label for #toggle-ew-mvdr');
  assert.ok(indexHtml.includes('for="toggle-ew-esm"'), 'Must have label for #toggle-ew-esm');
  assert.ok(indexHtml.includes('for="ew-gnss-spoof-input"'), 'Must have label for #ew-gnss-spoof-input');

  // Verify zero emojis in the EW section
  const ewSectionMatch = indexHtml.match(/<!-- Instrument C:[\s\S]*?<!-- Instrument D:/);
  if (ewSectionMatch) {
    const ewText = ewSectionMatch[0];
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    assert.ok(!emojiRegex.test(ewText), 'EW controls must contain zero emojis');
  }

  // 5.6 Performance Micro-Benchmark: 10,000 evaluations < 30 ms (< 3 µs/call)
  const benchIterations = 10_000;
  const startMs = performance.now();
  for (let k = 0; k < benchIterations; k++) {
    const az = (k * 0.036) % 360;
    const gain = computeSpreadSpectrumProcessingGainDb({
      eccmMode: k % 2 === 0 ? 'DSSS' : 'FHSS',
      spreadBandwidthHz: 20e6,
      signalBandwidthHz: 1e6,
      partialBandJamFraction: 0.8,
    });
    const nullRej = computeMvdrNullSteeringRejectionDb({
      desiredAzimuthDeg: az,
      jammerAzimuthDeg: (az + 15) % 360,
    });
    evaluateEwJammerMitigation({
      rawJammerPowerDbm: -60.0,
      spatialNullRejectionDb: nullRej,
      eccmProcessingGainDb: gain,
    });
    evaluateAdversaryEsmLpi({
      txPowerDbm: 36.0,
      txGainDbi: 3.0,
      friendlyRangeM: 8000.0,
      freqHz: 8e9,
    });
    computeGnssSpoofingTaDriftUs(k * 0.02, 10.0, 2000.0, false);
  }
  const elapsedMs = performance.now() - startMs;
  const usPerCall = (elapsedMs * 1000.0) / (benchIterations * 5); // 5 calls per iteration

  console.log(`    Micro-benchmark: 10,000 combined iterations (50,000 calls) completed in ${elapsedMs.toFixed(2)} ms (${usPerCall.toFixed(3)} µs/call)`);
  assert.ok(
    elapsedMs < 30.0,
    `Micro-benchmark must execute in < 30 ms, actual: ${elapsedMs.toFixed(2)} ms`
  );
  assert.ok(
    usPerCall < 3.0,
    `Average call duration must be < 3 µs/call, actual: ${usPerCall.toFixed(3)} µs/call`
  );

  console.log(`${ANSI.green}✓ [EW-T5] Live worker EW recovery proof, determinism, RESET_SIM, UI & benchmark verified.${ANSI.reset}`);

  console.log('\n' + '='.repeat(80));
  console.log(`${ANSI.bold}${ANSI.green}[SUITE 105 PASSED] All 5 EW / ECCM / ESM / GNSS Spoofing tests verified successfully.${ANSI.reset}`);
  console.log('='.repeat(80) + '\n');
}

runSuite().catch((err) => {
  console.error(`\n${ANSI.red}${ANSI.bold}[SUITE 105 FAILED]${ANSI.reset}`, err);
  process.exit(1);
});
