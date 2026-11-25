/**
 * src/tests/verifyAttitudeAndChannelDynamics.ts
 *
 * Automated Verification Suite for Airframe Attitude Kinematics, 3D Tait-Bryan World->Body Transforms,
 * Wing/Fuselage Shadowing, Quad-Sector Hysteresis, and Time-Correlated Zheng-Xiao Rician-Jakes Fading.
 *
 * Specification: docs/specs/wp05-airframe-attitude-and-channel-dynamics.md
 *
 * Test Suites:
 * - AAD-T1: 3D Coordinated-Turn Attitude Kinematics (Yaw, Pitch, Bank Angle & Limits)
 * - AAD-T2: Exact 3D World->Body Orthogonal Tait-Bryan Transformation & Sign Physics
 * - AAD-T3: Airframe Fuselage & Wing Shadowing with End-to-End LinkBudget Integration
 * - AAD-T4: Quad-Sector Angular Handover Hysteresis & Anti-Ping-Pong Verification
 * - AAD-T5: Time-Correlated 8.0 GHz Zheng-Xiao Rician-Jakes Fading & Doppler Coherence
 * - AAD-T6: 50 Hz Discrete Loop Execution Micro-Benchmark (< 5 µs/call)
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { computeAirframeAttitude } from '../core/trajectory';
import {
  worldLosToBodyFrame,
  computeAirframeShadowLossDb,
  selectQuadSectorWithHysteresis,
} from '../core/antennaArray';
import {
  computeCorrelatedRicianJakesFading,
} from '../core/rfPropagationMath';
import { RFConfig, EnvironmentConfig } from '../core/config';
import { LinkBudgetEngine } from '../core/linkBudget';

function close(actual: number, expected: number, tolerance = 1e-4, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('='.repeat(94));
console.log('   AIRFRAME ATTITUDE & TIME-CORRELATED CHANNEL DYNAMICS VERIFICATION (SUITE 89)');
console.log('   Specification: docs/specs/wp05-airframe-attitude-and-channel-dynamics.md');
console.log('='.repeat(94));

// =================================================================================================
// [AAD-T1] 3D Coordinated-Turn Attitude Kinematics
// =================================================================================================
console.log('\n[AAD-T1] Verifying 3D Coordinated-Turn Attitude Kinematics...');
{
  // 1. Level flight turn: v = 50 m/s, R = 500 m => omega = 50/500 = 0.1 rad/s
  // tan(phi) = (v * omega) / g = (50 * 0.1) / 9.80665 = 5.0 / 9.80665 => phi ≈ 26.99°
  const attTurn = computeAirframeAttitude(0.0, 50.0, 0.0, 0.1, 45.0);
  close(attTurn.yawDeg, 0.0, 1e-4, 'North heading must be 0°');
  close(attTurn.pitchDeg, 0.0, 1e-4, 'Level flight pitch must be 0°');
  close(attTurn.rollDeg, 26.9937, 0.05, 'Coordinated bank at v=50, R=500 must match 26.99° ± 0.05°');

  // 2. Maximum bank angle clamping at ±45°
  const attClampPos = computeAirframeAttitude(0.0, 50.0, 0.0, 1.0, 45.0);
  close(attClampPos.rollDeg, 45.0, 1e-6, 'Roll must be clamped at +45°');

  const attClampNeg = computeAirframeAttitude(0.0, 50.0, 0.0, -1.0, 45.0);
  close(attClampNeg.rollDeg, -45.0, 1e-6, 'Roll must be clamped at -45°');

  // 3. Heading mapping in ENU:
  // East velocity [50, 0, 0] -> 90°
  const attEast = computeAirframeAttitude(50.0, 0.0, 0.0);
  close(attEast.yawDeg, 90.0, 1e-4, 'East velocity must map to 90° heading');

  // South velocity [0, -50, 0] -> 180°
  const attSouth = computeAirframeAttitude(0.0, -50.0, 0.0);
  close(attSouth.yawDeg, 180.0, 1e-4, 'South velocity must map to 180° heading');

  // West velocity [-50, 0, 0] -> 270°
  const attWest = computeAirframeAttitude(-50.0, 0.0, 0.0);
  close(attWest.yawDeg, 270.0, 1e-4, 'West velocity must map to 270° heading');

  // 4. Climb and descent pitch:
  // Climbing: v_h = 50 m/s, v_z = +25 m/s => pitch = atan2(25, 50) = 26.565°
  const attClimb = computeAirframeAttitude(0.0, 50.0, 25.0);
  close(attClimb.pitchDeg, (Math.atan2(25, 50) * 180.0) / Math.PI, 1e-4, 'Climb pitch angle match');
  assert.ok(attClimb.pitchDeg > 0, 'Climbing must yield positive pitch');

  // Descending: v_h = 50 m/s, v_z = -25 m/s => pitch = -26.565°
  const attDescent = computeAirframeAttitude(0.0, 50.0, -25.0);
  close(attDescent.pitchDeg, -(Math.atan2(25, 50) * 180.0) / Math.PI, 1e-4, 'Descent pitch angle match');
  assert.ok(attDescent.pitchDeg < 0, 'Descending must yield negative pitch');

  // 5. Stationary & NaN Safety:
  const attStat = computeAirframeAttitude(0.0, 0.0, 0.0, 0.0);
  assert.equal(attStat.yawDeg, 0.0);
  assert.equal(attStat.pitchDeg, 0.0);
  assert.equal(attStat.rollDeg, 0.0);

  const attNan = computeAirframeAttitude(NaN, 50.0, 0.0, Infinity);
  assert.equal(attNan.yawDeg, 0.0);
  assert.equal(attNan.pitchDeg, 0.0);
  assert.equal(attNan.rollDeg, 0.0);

  console.log('  PASS: Coordinated-turn attitude kinematics, limits, and NaN safety verified');
}

// =================================================================================================
// [AAD-T2] Exact 3D World->Body Orthogonal Tait-Bryan Transformation & Sign Physics
// =================================================================================================
console.log('\n[AAD-T2] Verifying 3D World->Body Orthogonal Tait-Bryan Transform & Sign Physics...');
{
  // 1. Orthogonality test across a 3D grid of attitude triples:
  const yawGrid = [0, 45, 90, 135, 180, 225, 270, 315];
  const pitchGrid = [-30, -15, 0, 15, 30];
  const rollGrid = [-45, -20, 0, 20, 45];
  const testVectorEnu: [number, number, number] = [300.0, -400.0, 1200.0];
  const worldMag = Math.hypot(...testVectorEnu);

  for (const yaw of yawGrid) {
    for (const pitch of pitchGrid) {
      for (const roll of rollGrid) {
        const bodyRes = worldLosToBodyFrame(testVectorEnu[0], testVectorEnu[1], testVectorEnu[2], {
          yawDeg: yaw,
          pitchDeg: pitch,
          rollDeg: roll,
        });
        const bodyMag = Math.hypot(bodyRes.bodyForward, bodyRes.bodyRight, bodyRes.bodyDown);
        close(bodyMag, worldMag, 1e-9, `Orthogonality preserved for yaw=${yaw}, pitch=${pitch}, roll=${roll}`);
      }
    }
  }

  // 2. Physical Sign Physics:
  // Aircraft at (0, 0, 1000) heading North (yaw=0, pitch=0, roll=0).
  // Ground station directly below: losEast = 0, losNorth = 0, losUp = -1000.
  const resBelow = worldLosToBodyFrame(0, 0, -1000, { yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
  assert.ok(resBelow.bodyDown > 0, 'Target directly below must have bodyDown > 0');
  close(resBelow.bodyElevationDeg, -90.0, 1e-4, 'Target directly below must have bodyElevationDeg = -90°');

  // Ground station to the West (-1000, 0, 0 relative to UAV at (0, 0, 1000)):
  // losEast = -1000, losNorth = 0, losUp = -1000.
  // Level flight:
  const resWestLevel = worldLosToBodyFrame(-1000, 0, -1000, { yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
  close(resWestLevel.bodyElevationDeg, -45.0, 1e-4, 'West GCS at equal range must have elevation = -45° in level flight');

  // Now execute a RIGHT BANK (+30° roll, starboard wing drops, port wing rises):
  // Canopy (+up) tilts starboard/East; belly (+down) tilts port/West.
  // Port/West GCS sits deeper below the belly (-45° -> -75°), while Starboard/East GCS rises toward wing plane (-45° -> -15°):
  const resWestBank = worldLosToBodyFrame(-1000, 0, -1000, { yawDeg: 0, pitchDeg: 0, rollDeg: 30.0 });
  close(resWestBank.bodyElevationDeg, -75.0, 1e-4, 'West GCS elevation drops from -45° to -75° under +30° right bank');
  assert.ok(
    resWestBank.bodyElevationDeg < -45.0,
    'West GCS sits deeper below belly (completely unobstructed)'
  );

  // Starboard/East GCS (+1000, 0, 0 relative to UAV):
  // Under right bank (+30° roll), starboard wing dips toward ground, bringing East GCS closer to wing plane (-15°):
  const resEastBank = worldLosToBodyFrame(1000, 0, -1000, { yawDeg: 0, pitchDeg: 0, rollDeg: 30.0 });
  close(resEastBank.bodyElevationDeg, -15.0, 1e-4, 'East GCS elevation rises from -45° to -15° under +30° right bank');
  assert.ok(
    resEastBank.bodyElevationDeg > resWestLevel.bodyElevationDeg,
    'Right bank must tilt starboard wing toward East GCS, increasing body elevation toward positive values'
  );

  // Steep right bank (+50° roll):
  // East/starboard GCS crosses wing plane into positive body elevation (fuselage masked!):
  const resEastMasked = worldLosToBodyFrame(1000, 0, -1000, { yawDeg: 0, pitchDeg: 0, rollDeg: 50.0 });
  assert.ok(
    resEastMasked.bodyElevationDeg > 0.0,
    `East GCS under steep +50° bank must enter positive body elevation (got ${resEastMasked.bodyElevationDeg.toFixed(2)}°)`
  );

  // 3. Zero-length or non-finite inputs:
  const resZero = worldLosToBodyFrame(0, 0, 0, { yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
  assert.equal(resZero.bodyForward, 0.0);
  assert.equal(resZero.bodyRight, 0.0);
  assert.equal(resZero.bodyDown, 0.0);
  assert.equal(resZero.bodyAzimuthDeg, 0.0);
  assert.equal(resZero.bodyElevationDeg, 0.0);

  console.log('  PASS: 3D Tait-Bryan world->body rotation orthogonality & sign physics validated');
}

// =================================================================================================
// [AAD-T3] Airframe Fuselage & Wing Shadowing with End-to-End LinkBudget Integration
// =================================================================================================
console.log('\n[AAD-T3] Verifying Airframe Shadowing & End-to-End LinkBudget Integration...');
{
  // 1. Belly mount characteristics:
  // Deep below belly (<= -5°): loss must be strictly 0 dB
  close(computeAirframeShadowLossDb(0.0, -10.0, 'belly'), 0.0, 1e-6, 'Elevation -10° must have 0 dB loss');
  close(computeAirframeShadowLossDb(0.0, -90.0, 'belly'), 0.0, 1e-6, 'Elevation -90° (nadir) must have 0 dB loss');

  // Smooth C1 cosine transition across [-5°, +15°]:
  // Midpoint at elevation +5° (u = 0.5): loss = 15.0 * 0.5 * (1 - cos(pi/2)) = 7.5 dB
  close(computeAirframeShadowLossDb(0.0, 5.0, 'belly'), 7.5, 0.01, 'Fuselage loss at midpoint +5° must be 7.5 dB');

  // Complete fuselage blockage (>= +15°): loss must clamp at 15.0 dB
  close(computeAirframeShadowLossDb(0.0, 15.0, 'belly'), 15.0, 1e-6, 'Elevation +15° must reach max 15.0 dB');
  close(computeAirframeShadowLossDb(0.0, 45.0, 'belly'), 15.0, 1e-6, 'Elevation +45° must remain clamped at 15.0 dB');

  // Wing-chord shadowing bump at azimuth 90° (Starboard) and elevation 0°:
  // Fuselage loss at 0° (u = 5/20 = 0.25): 15 * 0.5 * (1 - cos(pi/4)) = 7.5 * (1 - 0.7071) ≈ 2.197 dB
  // Plus 4.0 dB wing chord bump => ≈ 6.197 dB
  const lossWingStarboard = computeAirframeShadowLossDb(90.0, 0.0, 'belly');
  const lossNoseAtZero = computeAirframeShadowLossDb(0.0, 0.0, 'belly');
  assert.ok(
    lossWingStarboard > lossNoseAtZero + 3.9,
    `Wing chord bump must add ~4.0 dB at 90° azimuth (nose: ${lossNoseAtZero.toFixed(2)} dB, wing: ${lossWingStarboard.toFixed(2)} dB)`
  );

  // Symmetry: Port (270°) matches Starboard (90°)
  const lossWingPort = computeAirframeShadowLossDb(270.0, 0.0, 'belly');
  close(lossWingPort, lossWingStarboard, 1e-6, 'Wing bump must be symmetric between starboard (90°) and port (270°)');

  // 2. Dorsal mount mirrors belly mount:
  const lossDorsal = computeAirframeShadowLossDb(0.0, -15.0, 'dorsal');
  close(lossDorsal, 15.0, 1e-6, 'Dorsal mount at -15° must experience 15.0 dB blockage');

  // 3. End-to-end LinkBudgetEngine integration:
  const rf = new RFConfig();
  const env = new EnvironmentConfig();
  const engine = new LinkBudgetEngine();

  // Test Case A: Level flight, ACN directly above GCS:
  const slantM = 10000.0;
  const lsLevel = engine.evaluateLink({
    nodeType: 'soldier',
    slantRangeM: slantM,
    diffractionLossDb: 0.0,
    rf,
    env,
    obstacleBlocked: false,
    nodeAltM: 3000.0,
    acnAltM: 5000.0,
    airframeOptions: {
      enableAirframeShadowing: true,
      uavAttitude: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
      losVectorEnu: [0, 0, -2000.0],
      antennaMount: 'belly',
    },
  });
  close(lsLevel.airframeShadowLossDb ?? 0.0, 0.0, 1e-6, 'Level flight above GCS must yield 0 dB airframe shadow loss');

  // Test Case B: Steep 40° right bank with GCS on inside (starboard/East) side:
  const lsBank = engine.evaluateLink({
    nodeType: 'soldier',
    slantRangeM: slantM,
    diffractionLossDb: 0.0,
    rf,
    env,
    obstacleBlocked: false,
    nodeAltM: 3000.0,
    acnAltM: 5000.0,
    airframeOptions: {
      enableAirframeShadowing: true,
      uavAttitude: { yawDeg: 0, pitchDeg: 0, rollDeg: 40.0 },
      losVectorEnu: [4000.0, 0, -2000.0],
      antennaMount: 'belly',
    },
  });
  assert.ok(
    (lsBank.airframeShadowLossDb ?? 0.0) > 8.0,
    `Steep 40° bank away from GCS must induce > 8.0 dB airframe shadowing (got ${lsBank.airframeShadowLossDb} dB)`
  );
  // Verify SNR is reduced by the exact shadow loss:
  const snrDelta = lsLevel.snrDb - lsBank.snrDb;
  close(snrDelta, lsBank.airframeShadowLossDb!, 1e-4, 'SNR reduction in link budget must exactly equal airframeShadowLossDb');

  console.log('  PASS: Fuselage/wing shadowing and end-to-end LinkBudgetEngine integration verified');
}

// =================================================================================================
// [AAD-T4] Quad-Sector Handover Hysteresis & Anti-Ping-Pong Verification
// =================================================================================================
console.log('\n[AAD-T4] Verifying Quad-Sector Handover Hysteresis & Anti-Ping-Pong...');
{
  // Sector seams: 45°, 135°, 225°, 315°
  // Starting with Sector 0 (0° FWD) active:
  let state = selectQuadSectorWithHysteresis(0.0, null, 3.0);
  assert.equal(state.sectorIndex, 0);
  assert.equal(state.switched, false);

  // 1. Jitter within ±2.5° across the 45° boundary (between 42.5° and 47.5°):
  const jitterAnglesS0toS1 = [43.0, 46.0, 44.0, 47.0, 44.5, 47.5, 43.5];
  for (const az of jitterAnglesS0toS1) {
    state = selectQuadSectorWithHysteresis(az, 0, 3.0);
    assert.equal(
      state.sectorIndex,
      0,
      `Angle ${az}° with hysteresisMargin=3.0° must stay in Sector 0 (anti-ping-pong)`
    );
    assert.equal(state.switched, false);
  }

  // 2. Exceeding 45° + 3.0° = 48.0° threshold cleanly triggers handover to Sector 1:
  state = selectQuadSectorWithHysteresis(49.0, 0, 3.0);
  assert.equal(state.sectorIndex, 1, 'Crossing 49.0° must trigger switch to Sector 1');
  assert.equal(state.switched, true, 'Switch flag must be true');

  // 3. Jittering back across 45° boundary (e.g. 46.0°, 43.5°):
  // For Sector 1 (boresight 90°), distance to 43.5° is |43.5 - 90| = 46.5° <= 48.0°
  // Thus Sector 1 is retained!
  state = selectQuadSectorWithHysteresis(43.5, 1, 3.0);
  assert.equal(state.sectorIndex, 1, 'Sector 1 must be retained under hysteresis at 43.5°');
  assert.equal(state.switched, false);

  // 4. Test all 4 sector seams:
  // Seam 135° (S1 -> S2):
  assert.equal(selectQuadSectorWithHysteresis(137.0, 1, 3.0).sectorIndex, 1, '137° stays in S1');
  assert.equal(selectQuadSectorWithHysteresis(139.0, 1, 3.0).sectorIndex, 2, '139° switches to S2');

  // Seam 225° (S2 -> S3):
  assert.equal(selectQuadSectorWithHysteresis(227.0, 2, 3.0).sectorIndex, 2, '227° stays in S2');
  assert.equal(selectQuadSectorWithHysteresis(229.0, 2, 3.0).sectorIndex, 3, '229° switches to S3');

  // Seam 315° (S3 -> S0):
  assert.equal(selectQuadSectorWithHysteresis(317.0, 3, 3.0).sectorIndex, 3, '317° stays in S3');
  assert.equal(selectQuadSectorWithHysteresis(319.0, 3, 3.0).sectorIndex, 0, '319° switches to S0');

  // 5. Wrap-around 359° <-> 1°, negative angles, and > 360° angles:
  assert.equal(selectQuadSectorWithHysteresis(359.0, 0, 3.0).sectorIndex, 0);
  assert.equal(selectQuadSectorWithHysteresis(1.0, 0, 3.0).sectorIndex, 0);
  assert.equal(selectQuadSectorWithHysteresis(-15.0, null, 3.0).sectorIndex, 0);
  assert.equal(selectQuadSectorWithHysteresis(375.0, null, 3.0).sectorIndex, 0);

  console.log('  PASS: Quad-sector hysteresis, anti-ping-pong, and angle wrapping validated');
}

// =================================================================================================
// [AAD-T5] Time-Correlated 8.0 GHz Zheng-Xiao Rician-Jakes Fading & Doppler Coherence
// =================================================================================================
console.log('\n[AAD-T5] Verifying Time-Correlated Zheng-Xiao Rician-Jakes Fading...');
{
  const fc = 8.0e9; // 8.0 GHz
  const vRad = 50.0; // 50 m/s closing
  const seed = 42;

  // 1. Exact 8.0 GHz Doppler kinematics:
  // f_D = (8e9 * 50) / 299792458 ≈ 1334.256 Hz
  // T_c = 0.423 / 1334.256 ≈ 0.3170 ms
  const fadeInitial = computeCorrelatedRicianJakesFading({
    simTimeS: 0.0,
    seed,
    carrierFreqHz: fc,
    radialVelocityMs: vRad,
    relativeSpeedMps: vRad,
    ricianKFactorDb: 12.0,
  });

  close(fadeInitial.dopplerShiftHz, 1334.256, 0.05, '8.0 GHz Doppler shift at 50 m/s must be ~1334.26 Hz');
  close(fadeInitial.coherenceTimeMs, 0.317, 0.005, 'Clarke coherence time must be ~0.317 ms');

  // 2. Strict Determinism: identical (t, seed) produces identical envelope linear and dB
  const fadeRepeat = computeCorrelatedRicianJakesFading({
    simTimeS: 0.0,
    seed,
    carrierFreqHz: fc,
    radialVelocityMs: vRad,
    relativeSpeedMps: vRad,
    ricianKFactorDb: 12.0,
  });
  assert.equal(fadeInitial.fadingGainDb, fadeRepeat.fadingGainDb, 'Identical seed and time must be bit-exact deterministic');
  assert.equal(fadeInitial.envelopeLinear, fadeRepeat.envelopeLinear, 'Envelope linear must be bit-exact deterministic');

  // 3. Unit-Mean Power Conservation (E[r(t)^2] = 1.0 ± 0.12):
  // Test A: High Rician factor K = 12.0 dB
  const N_SAMPLES = 2000;
  let sumPowerRician = 0.0;
  for (let i = 0; i < N_SAMPLES; i++) {
    const t = i * 0.001; // 1 ms steps
    const res = computeCorrelatedRicianJakesFading({
      simTimeS: t,
      seed,
      carrierFreqHz: fc,
      radialVelocityMs: vRad,
      relativeSpeedMps: vRad,
      ricianKFactorDb: 12.0,
    });
    sumPowerRician += res.envelopeLinear * res.envelopeLinear;
  }
  const meanPowerRician = sumPowerRician / N_SAMPLES;
  console.log(`  Rician K=12 dB ensemble mean power: ${meanPowerRician.toFixed(4)} (expected 1.0 ± 0.12)`);
  assert.ok(
    Math.abs(meanPowerRician - 1.0) < 0.12,
    `Rician K=12 dB mean power must equal 1.0 ± 0.12 (got ${meanPowerRician})`
  );

  // Test B: Pure Rayleigh (K = -Infinity dB)
  let sumPowerRayleigh = 0.0;
  for (let i = 0; i < N_SAMPLES; i++) {
    const t = i * 0.001;
    const res = computeCorrelatedRicianJakesFading({
      simTimeS: t,
      seed,
      carrierFreqHz: fc,
      radialVelocityMs: vRad,
      relativeSpeedMps: vRad,
      ricianKFactorDb: -Infinity,
    });
    sumPowerRayleigh += res.envelopeLinear * res.envelopeLinear;
  }
  const meanPowerRayleigh = sumPowerRayleigh / N_SAMPLES;
  console.log(`  Pure Rayleigh ensemble mean power : ${meanPowerRayleigh.toFixed(4)} (expected 1.0 ± 0.12)`);
  assert.ok(
    Math.abs(meanPowerRayleigh - 1.0) < 0.12,
    `Rayleigh mean power must equal 1.0 ± 0.12 (got ${meanPowerRayleigh})`
  );

  // 4. Temporal Autocorrelation:
  // Short lag: dt = 0.05 * T_c => high correlation rho > 0.85
  // Long lag: dt = 5.0 * T_c => low correlation
  const Tc_s = fadeInitial.coherenceTimeMs / 1000.0;
  const dtShort = 0.05 * Tc_s;
  const dtLong = 5.0 * Tc_s;

  const N_CORR = 1000;
  const r0: number[] = [];
  const rShort: number[] = [];
  const rLong: number[] = [];

  for (let i = 0; i < N_CORR; i++) {
    const t = i * 0.005;
    const p0 = computeCorrelatedRicianJakesFading({ simTimeS: t, seed, carrierFreqHz: fc, radialVelocityMs: vRad, ricianKFactorDb: 0.0 }).envelopeLinear;
    const pShort = computeCorrelatedRicianJakesFading({ simTimeS: t + dtShort, seed, carrierFreqHz: fc, radialVelocityMs: vRad, ricianKFactorDb: 0.0 }).envelopeLinear;
    const pLong = computeCorrelatedRicianJakesFading({ simTimeS: t + dtLong, seed, carrierFreqHz: fc, radialVelocityMs: vRad, ricianKFactorDb: 0.0 }).envelopeLinear;
    r0.push(p0);
    rShort.push(pShort);
    rLong.push(pLong);
  }

  const mean0 = r0.reduce((a, b) => a + b, 0) / N_CORR;
  const meanShort = rShort.reduce((a, b) => a + b, 0) / N_CORR;
  const meanLong = rLong.reduce((a, b) => a + b, 0) / N_CORR;

  let var0 = 0.0, covShort = 0.0, covLong = 0.0;
  for (let i = 0; i < N_CORR; i++) {
    const d0 = r0[i] - mean0;
    var0 += d0 * d0;
    covShort += d0 * (rShort[i] - meanShort);
    covLong += d0 * (rLong[i] - meanLong);
  }
  const rhoShort = covShort / var0;
  const rhoLong = covLong / var0;

  console.log(`  Autocorrelation at dt = 0.05*Tc: rho = ${rhoShort.toFixed(4)} (expected > 0.85)`);
  console.log(`  Autocorrelation at dt = 5.00*Tc: rho = ${rhoLong.toFixed(4)}`);
  assert.ok(rhoShort > 0.85, `Short-lag autocorrelation must exceed 0.85 (got ${rhoShort})`);
  assert.ok(Math.abs(rhoLong) < Math.abs(rhoShort), 'Long-lag correlation must decay substantially below short-lag correlation');

  // 5. Stationary (v = 0) and NaN Safety:
  const fadeStat = computeCorrelatedRicianJakesFading({ simTimeS: 1.0, seed: 1, relativeSpeedMps: 0.0 });
  assert.equal(fadeStat.dopplerShiftHz, 0.0);
  assert.equal(fadeStat.fadingGainDb, 0.0);
  assert.equal(fadeStat.coherenceTimeMs, Number.POSITIVE_INFINITY);

  const fadeNan = computeCorrelatedRicianJakesFading({ simTimeS: NaN, seed: NaN });
  assert.equal(fadeNan.fadingGainDb, 0.0);

  console.log('  PASS: Zheng-Xiao time-correlated fading, Doppler coherence, and power conservation validated');
}

// =================================================================================================
// [AAD-T6] 50 Hz Discrete Loop Execution Micro-Benchmark (< 5 µs/call)
// =================================================================================================
console.log('\n[AAD-T6] Running 50 Hz Loop Micro-Benchmark (10,000 evaluations)...');
{
  const N_ITER = 10000;
  const tStart = performance.now();

  let dummySum = 0.0;
  for (let k = 0; k < N_ITER; k++) {
    const t = k * 0.02;
    const att = computeAirframeAttitude(25.0, 43.3, 2.0, 0.08, 45.0);
    const body = worldLosToBodyFrame(5000.0, -3000.0, -1500.0, att);
    const shadowDb = computeAirframeShadowLossDb(body.bodyAzimuthDeg, body.bodyElevationDeg, 'belly');
    const sec = selectQuadSectorWithHysteresis(body.bodyAzimuthDeg, (k % 4), 3.0);
    const fade = computeCorrelatedRicianJakesFading({
      simTimeS: t,
      seed: 1234,
      carrierFreqHz: 8.0e9,
      radialVelocityMs: 35.0,
      relativeSpeedMps: 50.0,
      ricianKFactorDb: 9.0,
    });
    dummySum += att.rollDeg + body.bodyElevationDeg + shadowDb + sec.sectorIndex + fade.fadingGainDb;
  }

  const tElapsed = performance.now() - tStart;
  const timePerCallUs = (tElapsed / N_ITER) * 1000.0;

  console.log(`  Processed ${N_ITER} combined evaluations in ${tElapsed.toFixed(2)} ms (${timePerCallUs.toFixed(3)} µs/call)`);
  assert.ok(
    tElapsed < 50.0,
    `10,000 combined evaluations must complete in < 50 ms (< 5 µs/call budget), took ${tElapsed.toFixed(2)} ms`
  );
  assert.ok(Number.isFinite(dummySum), 'Micro-benchmark accumulator must be finite');

  console.log('  PASS: Combined attitude, shadowing, and correlated fading comfortably satisfies 50 Hz budget (< 5 µs/call)');
}

console.log('\n' + '='.repeat(94));
console.log('   ALL AIRFRAME ATTITUDE & TIME-CORRELATED CHANNEL DYNAMICS TESTS PASSED (6/6 SUITES)');
console.log('='.repeat(94));
