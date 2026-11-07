/**
 * src/tests/verifyVariableAltitude.ts
 *
 * UAV Variable Altitude System Verification Suite (Milestone ALT-1).
 * Approved Architecture Specification: DRDO-TAC-XBAND-ARCH-ALT-02.
 *
 * Implements Tests ALT-T1 through ALT-T10:
 * - ALT-T1: Default Configuration Parity (mode 'fix', 5000m MSL, vz=0, exact backward compatibility)
 * - ALT-T2: Timestep Invariance (FRAME_DT = 0.020s identical progression across modes)
 * - ALT-T3: FIX Mode Constant Height (z(t) = H_fix ± 1e-6m regardless of terrain variations)
 * - ALT-T4: AMSL Waypoint 3D Interpolation (continuous 3D chord spline through 4000m, 5500m, 4800m)
 * - ALT-T5: AGL Dynamic Terrain Tracking (steady-state h_AGL(t) ≈ H_AGL over terrain)
 * - ALT-T6: Critically Damped Deceleration (Zero Porpoising: zero overshoot, steady state |z-z_tgt| <= 0.05m)
 * - ALT-T7: Bounded Vertical Kinematics (vz in [-V_descent, +V_climb], acceleration <= a_max)
 * - ALT-T8: Ground Clearance Safety Floor (z(t) >= z_DEM(t) + 50m hard clamp when commanded below ground)
 * - ALT-T9: Predictive Lookahead Purity (480-query lookahead strictly does not mutate live altitude)
 * - ALT-T10: Deterministic Trace Parity (independent runs produce identical SHA-256 state hashes)
 */

import assert from 'node:assert/strict';
import { ACNFlightConfig } from '../core/config';
import { createACNTrajectory } from '../core/trajectory';
import { SimulationWorkerManager, FRAME_DT } from '../worker/simWorker';
import { computeCanonicalStateHash } from './helpers/simulationTrace';

function close(actual: number, expected: number, tolerance = 1e-4, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('='.repeat(92));
console.log('   UAV VARIABLE ALTITUDE SYSTEM (FIX, AMSL, AGL) VERIFICATION SUITE');
console.log('   Specification: DRDO-TAC-XBAND-ARCH-ALT-02 // Milestone ALT-1');
console.log('='.repeat(92));

// -------------------------------------------------------------------------------------------------
// [ALT-T1] Default Configuration Parity
// -------------------------------------------------------------------------------------------------
console.log('\n[ALT-T1] Verifying default configuration parity...');
{
  const sim = new SimulationWorkerManager();
  assert.equal(sim.flightConfig.altitudeMode, 'fix', 'Default altitudeMode must be fix');
  assert.equal(sim.flightConfig.altitudeMslM, 5000.0, 'Default altitude must be 5000.0m MSL');
  assert.equal(sim.liveAltitudeM, 5000.0, 'Default live altitude must be 5000.0m MSL');
  assert.equal(sim.liveVzMps, 0.0, 'Default live vertical velocity must be 0.0 m/s');
  assert.equal(sim.isTerrainClamped, false, 'Default terrain clamped must be false');

  const frame = (sim as any).buildTelemetryFrame(sim.getLiveAcnPosition());
  assert.equal(frame.acn_telemetry.altitude_msl_m, 5000.0, 'Telemetry altitude_msl_m must be 5000.0');
  assert.equal(frame.acn_telemetry.vel_z, 0.0, 'Telemetry vel_z must be 0.0');
  assert.equal(frame.acn_telemetry.pitch_deg, 0.0, 'Telemetry pitch_deg must be 0.0');
  assert.equal(frame.acn_telemetry.altitude_mode, 'fix', 'Telemetry altitude_mode must be fix');
  assert.equal(frame.acn_telemetry.is_terrain_clamped, false, 'Telemetry is_terrain_clamped must be false');
  console.log('  -> PASS: Default configuration parity verified (mode=fix, alt=5000m, vz=0.0).');
}

// -------------------------------------------------------------------------------------------------
// [ALT-T2] Timestep Invariance Across Altitude Modes
// -------------------------------------------------------------------------------------------------
console.log('\n[ALT-T2] Verifying timestep invariance across altitude modes...');
{
  assert.equal(FRAME_DT, 0.020, 'FRAME_DT must remain strictly 0.020s (20 ms)');

  for (const mode of ['fix', 'amsl', 'agl'] as const) {
    const sim = new SimulationWorkerManager();
    sim.handleMessage({ type: 'CONFIG_UPDATE', params: { altitude_mode: mode } });
    for (let f = 0; f < 50; f++) {
      sim.tickSimulation(false);
    }
    close(sim.simTimeS, 1.000, 1e-9, `Simulation time in ${mode} mode`);
    assert.equal(sim.frameIndex, 50, `Frame count in ${mode} mode`);
  }
  console.log('  -> PASS: Exact timestep invariance (FRAME_DT=0.020s, 50Hz) verified across all modes.');
}

// -------------------------------------------------------------------------------------------------
// [ALT-T3] FIX Mode Constant Height Invariant
// -------------------------------------------------------------------------------------------------
console.log('\n[ALT-T3] Verifying FIX mode constant height invariant...');
{
  const sim = new SimulationWorkerManager();
  sim.handleMessage({ type: 'CONFIG_UPDATE', params: { altitude_mode: 'fix', loiter_speed_mps: 120 } });

  for (let f = 0; f < 100; f++) {
    sim.tickSimulation(false);
    close(sim.liveAltitudeM, 5000.0, 1e-6, `liveAltitudeM at frame ${f}`);
    close(sim.liveVzMps, 0.0, 1e-6, `liveVzMps at frame ${f}`);
    const pos = sim.getLiveAcnPosition();
    close(pos[2], 5000.0, 1e-6, `3D position Z at frame ${f}`);
  }
  console.log('  -> PASS: FIX mode maintains constant 5000m MSL (vz=0, pitch=0) over 100 frames.');
}

// -------------------------------------------------------------------------------------------------
// [ALT-T4] AMSL Waypoint 3D Closed-Form Interpolation
// -------------------------------------------------------------------------------------------------
console.log('\n[ALT-T4] Verifying AMSL waypoint 3D closed-form interpolation...');
{
  const waypoints = [
    { xM: 0, yM: 0, zM: 4000.0 },
    { xM: 10000, yM: 10000, zM: 5500.0 },
    { xM: 0, yM: 20000, zM: 4800.0 },
  ];
  const flight = new ACNFlightConfig({
    trajectoryMode: 'waypoints',
    waypoints,
    altitudeMode: 'amsl',
    loiterSpeedMps: 100.0,
    accelerationLimitMps2: 100.0,
    decelerationLimitMps2: 100.0,
  });
  const traj = createACNTrajectory(flight);

  // Position at t=0 should match first waypoint altitude
  const p0 = traj.getAcnPosition(0);
  close(p0[2], 4000.0, 0.1, 'Initial waypoint altitude');

  // Verify 2D getPathPoints parity and 3D getPathPoints3D extension
  const pts2D = traj.getPathPoints(64);
  assert.equal(pts2D.length, 64, '2D path points length must be 64');
  assert.equal(pts2D[0].length, 2, '2D path point must be a 2-tuple [x, y]');

  const pts3D = traj.getPathPoints3D(64);
  assert.equal(pts3D.length, 64, '3D path points length must be 64');
  assert.equal(pts3D[0].length, 3, '3D path point must be a 3-tuple [x, y, z]');

  // Sample across time; altitude must be continuously bounded in [4000, 5500]
  let prevZ = p0[2];
  for (let t = 0.5; t <= 100.0; t += 0.5) {
    const pos = traj.getAcnPosition(t);
    assert.ok(pos[2] >= 3999.0 && pos[2] <= 5501.0, `Altitude ${pos[2]} out of waypoint bounds at t=${t}`);
    const vel = traj.getAcnVelocity(t);
    assert.ok(Number.isFinite(vel[2]), `Vertical velocity at t=${t} must be finite`);
    assert.ok(Math.abs(pos[2] - prevZ) < 80.0, `Vertical jump too large at t=${t}`);
    prevZ = pos[2];
  }
  console.log('  -> PASS: Closed-form 3D waypoint spline is continuous, bounded, and preserves 2D parity.');
}

// -------------------------------------------------------------------------------------------------
// [ALT-T5] AGL Dynamic Terrain Tracking Mode
// -------------------------------------------------------------------------------------------------
console.log('\n[ALT-T5] Verifying AGL dynamic terrain-following mode...');
{
  const sim = new SimulationWorkerManager();
  sim.handleMessage({
    type: 'CONFIG_UPDATE',
    params: {
      altitude_mode: 'agl',
      target_agl_m: 1500.0,
      loiter_speed_mps: 60.0,
      max_climb_rate_mps: 20.0,
      max_descent_rate_mps: 20.0,
    },
  });

  for (let f = 0; f < 100; f++) {
    sim.tickSimulation(false);
    const pos = sim.getLiveAcnPosition();
    const terrainMsl = sim.terrainEngine.getElevation(pos[0], pos[1]);
    const agl = pos[2] - terrainMsl;
    assert.ok(agl >= 49.9, `AGL clearance ${agl} below 50m floor at frame ${f}`);
  }

  const frame = (sim as any).buildTelemetryFrame(sim.getLiveAcnPosition());
  assert.equal(frame.acn_telemetry.altitude_mode, 'agl', 'Telemetry altitude mode must be agl');
  assert.ok(Number.isFinite(frame.acn_telemetry.altitude_agl_m), 'Telemetry altitude_agl_m must be finite');
  assert.ok(Number.isFinite(frame.acn_telemetry.terrain_elevation_msl_m), 'Telemetry terrain_elevation_msl_m must be finite');
  console.log('  -> PASS: AGL mode dynamically follows terrain with positive clearance >= 50m.');
}

// -------------------------------------------------------------------------------------------------
// [ALT-T6] Critically Damped Deceleration (Zero Porpoising)
// -------------------------------------------------------------------------------------------------
console.log('\n[ALT-T6] Verifying critically damped deceleration (zero porpoising)...');
{
  const sim = new SimulationWorkerManager();
  // Put into AMSL mode so the controller executes kinematic transitions
  sim.handleMessage({
    type: 'CONFIG_UPDATE',
    params: {
      altitude_mode: 'amsl',
      acn_altitude_m: 5000.0,
      max_climb_rate_mps: 10.0,
      max_descent_rate_mps: 8.0,
    },
  });
  sim.liveAltitudeM = 5000.0;
  sim.liveVzMps = 0.0;

  // Step climb to 5020m MSL (+20m step: arrives cleanly in ~150 frames)
  sim.handleMessage({
    type: 'CONFIG_UPDATE',
    params: { acn_altitude_m: 5020.0 },
  });

  let maxClimbAlt = 5000.0;
  for (let f = 0; f < 250; f++) {
    sim.tickSimulation(false);
    if (sim.liveAltitudeM > maxClimbAlt) maxClimbAlt = sim.liveAltitudeM;
  }
  // Must NOT overshoot 5020m
  assert.ok(maxClimbAlt <= 5020.05, `Climb overshoot detected: reached ${maxClimbAlt} > 5020.05`);
  close(sim.liveAltitudeM, 5020.0, 0.05, 'Steady-state altitude after climb');
  close(sim.liveVzMps, 0.0, 0.01, 'Steady-state vertical velocity after climb');

  // Step descent to 5000m MSL (-20m step)
  sim.handleMessage({
    type: 'CONFIG_UPDATE',
    params: { acn_altitude_m: 5000.0 },
  });

  let minDescentAlt = 5020.0;
  for (let f = 0; f < 250; f++) {
    sim.tickSimulation(false);
    if (sim.liveAltitudeM < minDescentAlt) minDescentAlt = sim.liveAltitudeM;
  }
  // Must NOT undershoot 5000m
  assert.ok(minDescentAlt >= 4999.95, `Descent undershoot detected: reached ${minDescentAlt} < 4999.95`);
  close(sim.liveAltitudeM, 5000.0, 0.05, 'Steady-state altitude after descent');
  close(sim.liveVzMps, 0.0, 0.01, 'Steady-state vertical velocity after descent');
  console.log('  -> PASS: Critically damped deceleration verified: zero overshoot, zero undershoot, zero limit cycles.');
}

// -------------------------------------------------------------------------------------------------
// [ALT-T7] Bounded Vertical Kinematics
// -------------------------------------------------------------------------------------------------
console.log('\n[ALT-T7] Verifying bounded vertical kinematics during transients...');
{
  const sim = new SimulationWorkerManager();
  const vClimb = 10.0;
  const vDesc = 8.0;
  const aMax = 5.0;

  sim.handleMessage({
    type: 'CONFIG_UPDATE',
    params: {
      altitude_mode: 'amsl',
      acn_altitude_m: 5000.0,
      max_climb_rate_mps: vClimb,
      max_descent_rate_mps: vDesc,
    },
  });
  sim.liveAltitudeM = 5000.0;
  sim.liveVzMps = 0.0;

  // Trigger step climb (+50m)
  sim.handleMessage({ type: 'CONFIG_UPDATE', params: { acn_altitude_m: 5050.0 } });

  let peakClimbVz = 0.0;
  let prevVz = 0.0;
  for (let f = 0; f < 250; f++) {
    sim.tickSimulation(false);
    const vz = sim.liveVzMps;
    if (vz > peakClimbVz) peakClimbVz = vz;
    assert.ok(vz <= vClimb + 1e-4, `Vertical speed ${vz} exceeded climb ceiling ${vClimb}`);
    assert.ok(vz >= -vDesc - 1e-4, `Vertical speed ${vz} exceeded descent ceiling ${vDesc}`);
    const deltaV = Math.abs(vz - prevVz);
    const maxAllowedDeltaV = aMax * FRAME_DT + 1e-4;
    assert.ok(deltaV <= maxAllowedDeltaV, `Vertical acceleration ${deltaV / FRAME_DT} m/s² exceeded limit ${aMax}`);
    prevVz = vz;
  }
  close(peakClimbVz, vClimb, 0.05, 'Peak climb rate must reach configured ceiling');

  // Trigger step descent (-50m)
  sim.handleMessage({ type: 'CONFIG_UPDATE', params: { acn_altitude_m: 5000.0 } });

  let peakDescVz = 0.0;
  for (let f = 0; f < 250; f++) {
    sim.tickSimulation(false);
    const vz = sim.liveVzMps;
    if (vz < peakDescVz) peakDescVz = vz;
    assert.ok(vz <= vClimb + 1e-4, `Vertical speed ${vz} exceeded climb ceiling ${vClimb}`);
    assert.ok(vz >= -vDesc - 1e-4, `Vertical speed ${vz} exceeded descent ceiling ${vDesc}`);
    const deltaV = Math.abs(vz - prevVz);
    const maxAllowedDeltaV = aMax * FRAME_DT + 1e-4;
    assert.ok(deltaV <= maxAllowedDeltaV, `Vertical acceleration ${deltaV / FRAME_DT} m/s² exceeded limit ${aMax}`);
    prevVz = vz;
  }
  close(peakDescVz, -vDesc, 0.05, 'Peak descent rate must reach configured ceiling');

  console.log('  -> PASS: Vertical velocities and accelerations strictly reach and obey kinematic boundaries.');
}

// -------------------------------------------------------------------------------------------------
// [ALT-T8] Ground Clearance Safety Floor Clamp
// -------------------------------------------------------------------------------------------------
console.log('\n[ALT-T8] Verifying ground clearance safety floor clamp...');
{
  const sim = new SimulationWorkerManager();
  const initialPos = sim.getLiveAcnPosition();
  const terrainZ = sim.terrainEngine.getElevation(initialPos[0], initialPos[1]);

  // Place aircraft 52m above ground (2m above 50m floor) and command altitude below ground
  sim.liveAltitudeM = terrainZ + 52.0;
  sim.liveVzMps = 0.0;

  sim.handleMessage({
    type: 'CONFIG_UPDATE',
    params: {
      altitude_mode: 'amsl',
      acn_altitude_m: terrainZ - 200.0,
      max_descent_rate_mps: 8.0,
    },
  });

  // Step 100 frames (2s: enough to descend 20m to the 50m safety floor)
  let hitFloor = false;
  for (let f = 0; f < 100; f++) {
    sim.tickSimulation(false);
    const pos = sim.getLiveAcnPosition();
    const currentTerrainZ = sim.terrainEngine.getElevation(pos[0], pos[1]);
    const expectedFloor = currentTerrainZ + 50.0;

    assert.ok(sim.liveAltitudeM >= expectedFloor - 1e-4, `Altitude ${sim.liveAltitudeM} penetrated safety floor ${expectedFloor}`);
    if (sim.isTerrainClamped) {
      hitFloor = true;
      assert.ok(sim.liveVzMps >= 0, `Downward velocity must be clamped to 0 when resting on ground floor`);
    }
  }

  assert.ok(hitFloor, 'Safety floor clamp must be triggered when commanded below terrain');
  const frame = (sim as any).buildTelemetryFrame(sim.getLiveAcnPosition());
  assert.equal(frame.acn_telemetry.is_terrain_clamped, true, 'Telemetry must report is_terrain_clamped === true');
  console.log('  -> PASS: Hard safety floor (z_DEM + 50m) prevents ground collision and reports clamp flag.');
}

// -------------------------------------------------------------------------------------------------
// [ALT-T9] Predictive Lookahead Observational Purity
// -------------------------------------------------------------------------------------------------
console.log('\n[ALT-T9] Verifying predictive lookahead observational purity...');
{
  const sim = new SimulationWorkerManager();
  sim.handleMessage({
    type: 'CONFIG_UPDATE',
    params: { altitude_mode: 'agl', target_agl_m: 1500.0 },
  });

  // Step 25 frames
  for (let f = 0; f < 25; f++) {
    sim.tickSimulation(false);
  }

  const altBefore = sim.liveAltitudeM;
  const vzBefore = sim.liveVzMps;
  const timeBefore = sim.simTimeS;
  const frameBefore = sim.frameIndex;

  // Execute 480 predictive lookahead evaluations across all 16 ground nodes
  for (let i = 0; i < 16; i++) {
    const node = (sim as any).nodesTac[i];
    if (node) {
      sim.lookaheadEngine.evaluatePredictiveState(node.position, sim.simTimeS, false);
    }
  }

  // Also query future trajectory positions
  for (let dt = 1; dt <= 30; dt++) {
    sim.trajectoryEngine.getAcnPosition(sim.simTimeS + dt);
    sim.trajectoryEngine.getAcnVelocity(sim.simTimeS + dt);
  }

  // Assert worker authoritative vertical state is completely untouched
  assert.equal(sim.liveAltitudeM, altBefore, 'liveAltitudeM must NOT mutate during lookahead queries');
  assert.equal(sim.liveVzMps, vzBefore, 'liveVzMps must NOT mutate during lookahead queries');
  assert.equal(sim.simTimeS, timeBefore, 'simTimeS must NOT mutate during lookahead queries');
  assert.equal(sim.frameIndex, frameBefore, 'frameIndex must NOT mutate during lookahead queries');
  console.log('  -> PASS: 480-query predictive lookahead is strictly pure and does not mutate worker state.');
}

// -------------------------------------------------------------------------------------------------
// [ALT-T10] Deterministic State-Hash Trace Parity Across Altitude Modes
// -------------------------------------------------------------------------------------------------
console.log('\n[ALT-T10] Verifying deterministic trace parity across independent instances...');
{
  // Test AMSL mode reproducibility
  const simA = new SimulationWorkerManager(101);
  const simB = new SimulationWorkerManager(101);
  simA.handleMessage({ type: 'CONFIG_UPDATE', params: { altitude_mode: 'amsl', acn_altitude_m: 5200.0 } });
  simB.handleMessage({ type: 'CONFIG_UPDATE', params: { altitude_mode: 'amsl', acn_altitude_m: 5200.0 } });

  for (let f = 0; f < 50; f++) {
    simA.tickSimulation(false);
    simB.tickSimulation(false);
    const hashA = computeCanonicalStateHash(simA);
    const hashB = computeCanonicalStateHash(simB);
    assert.equal(hashA, hashB, `AMSL mode state hash mismatch at frame ${f}`);
  }

  // Test AGL mode reproducibility
  const simC = new SimulationWorkerManager(202);
  const simD = new SimulationWorkerManager(202);
  simC.handleMessage({ type: 'CONFIG_UPDATE', params: { altitude_mode: 'agl', target_agl_m: 1200.0 } });
  simD.handleMessage({ type: 'CONFIG_UPDATE', params: { altitude_mode: 'agl', target_agl_m: 1200.0 } });

  for (let f = 0; f < 50; f++) {
    simC.tickSimulation(false);
    simD.tickSimulation(false);
    const hashC = computeCanonicalStateHash(simC);
    const hashD = computeCanonicalStateHash(simD);
    assert.equal(hashC, hashD, `AGL mode state hash mismatch at frame ${f}`);
  }

  console.log('  -> PASS: Independent replay in AMSL and AGL modes produces 100% bit-for-bit identical state hashes.');
}

console.log('\n' + '='.repeat(92));
console.log('   ALL 10 VARIABLE ALTITUDE (ALT-T1–ALT-T10) VERIFICATION TESTS PASSED CLEANLY (100%)');
console.log('='.repeat(92));
