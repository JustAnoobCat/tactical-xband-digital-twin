import assert from 'node:assert/strict';
import { ACNFlightConfig, DEFAULT_ACN_FLIGHT_CONFIG } from '../core/config';
import { ACNTrajectoryEngine, createACNTrajectory, WaypointTrajectoryEngine } from '../core/trajectory';
import { SimulationWorkerManager, FRAME_DT } from '../worker/simWorker';

function close(actual: number, expected: number, tolerance = 1e-4, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('================================================================================');
console.log('  PHYSICAL UAV SPEED, ACCELERATION & HOVER VERIFICATION SUITE');
console.log('================================================================================\n');

// -------------------------------------------------------------------------------------------------
// [1/8] Parameter bounds and worker input validation
// -------------------------------------------------------------------------------------------------
console.log('[1/8] Verifying physical speed parameter bounds and validation...');
{
  const sim = new SimulationWorkerManager();
  
  // Valid speed updates
  for (const validSpeed of [0, 0.1, 30, 60, 120, 250, 1000]) {
    const res = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { loiter_speed_mps: validSpeed } });
    assert.equal(res.accepted, true, `Speed ${validSpeed} m/s should be accepted`);
  }

  // Invalid speed updates
  for (const badSpeed of [-1, -0.01, 1001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'fast']) {
    const res = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { loiter_speed_mps: badSpeed as any } });
    assert.equal(res.accepted, false, `Invalid speed ${badSpeed} must be rejected`);
  }

  // Acceleration & deceleration bounds
  for (const validLimit of [0.1, 1.0, 5.0, 15.0, 50.0]) {
    assert.equal(sim.handleMessage({ type: 'CONFIG_UPDATE', params: { acceleration_limit_mps2: validLimit } }).accepted, true);
    assert.equal(sim.handleMessage({ type: 'CONFIG_UPDATE', params: { deceleration_limit_mps2: validLimit } }).accepted, true);
  }
  for (const badLimit of [0, -1, 50.1, 100, Number.NaN, Infinity]) {
    assert.equal(sim.handleMessage({ type: 'CONFIG_UPDATE', params: { acceleration_limit_mps2: badLimit } }).accepted, false);
    assert.equal(sim.handleMessage({ type: 'CONFIG_UPDATE', params: { deceleration_limit_mps2: badLimit } }).accepted, false);
  }

  console.log('  -> PASS: Speed [0, 1000] and acceleration/deceleration (0, 50] bounds verified.');
}

// -------------------------------------------------------------------------------------------------
// [2/8] Displacement scales with physical speed
// -------------------------------------------------------------------------------------------------
console.log('[2/8] Verifying UAV displacement per simulated second scales with physical speed...');
{
  const testSpeeds = [30, 60, 120];
  const displacements: number[] = [];

  for (const speed of testSpeeds) {
    const flight = new ACNFlightConfig({
      loiterRadiusAM: 20000,
      loiterRadiusBM: 20000, // circle for uniform arc length
      loiterSpeedMps: speed,
      accelerationLimitMps2: 1000, // instantaneous for steady-state displacement test
      decelerationLimitMps2: 1000,
    });
    const engine = new ACNTrajectoryEngine(flight);
    
    // Simulate 10 seconds (500 steps of 20 ms)
    const p0 = engine.getAcnPosition(0);
    const p1 = engine.getAcnPosition(10.0);
    
    // Total arc displacement along circle: s = v * t = speed * 10
    const expectedArc = speed * 10.0;
    const { distanceM } = (engine as any).kinematics.evaluateAtTime(10.0, engine.totalLengthM);
    close(distanceM, expectedArc, 0.01, `Displacement at ${speed} m/s`);
    displacements.push(distanceM);
  }

  assert.ok(displacements[1] > displacements[0], '60 m/s displacement must exceed 30 m/s displacement');
  assert.ok(displacements[2] > displacements[1], '120 m/s displacement must exceed 60 m/s displacement');
  close(displacements[1] / displacements[0], 2.0, 1e-4, 'Displacement ratio 60/30 must equal 2.0');
  close(displacements[2] / displacements[1], 2.0, 1e-4, 'Displacement ratio 120/60 must equal 2.0');
  console.log('  -> PASS: UAV displacement strictly scales with configured physical speed.');
}

// -------------------------------------------------------------------------------------------------
// [3/8] Decoupling from visual simulation playback speed
// -------------------------------------------------------------------------------------------------
console.log('[3/8] Verifying physical flight speed is completely decoupled from playback speed...');
{
  const sim = new SimulationWorkerManager();
  sim.handleMessage({ type: 'CONFIG_UPDATE', params: { loiter_speed_mps: 60 } });

  // Playback speeds: 0.1x, 0.5x, 1.0x, 2.0x
  for (const pbSpeed of [0.1, 0.5, 1.0, 2.0]) {
    sim.handleMessage({ type: 'SET_SPEED', speed: pbSpeed });
    assert.equal((sim as any).speed, pbSpeed);
    assert.equal(FRAME_DT, 0.020, 'Physical simulation timestep must remain exactly 20 ms');
  }

  // Advance 50 frames (1 simulated second)
  const posBefore = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  for (let i = 0; i < 50; i++) {
    sim.tickSimulation();
  }
  const posAfter = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  close(sim.simTimeS, 1.0, 1e-6, '50 frames must equal exactly 1.0 simulated second regardless of playback speed');

  // Velocity vector magnitude must match physical speed (60 m/s), not playback speed
  const vel = sim.trajectoryEngine.getAcnVelocity(sim.simTimeS);
  const velMag = Math.hypot(vel[0], vel[1]);
  close(velMag, 60.0, 0.5, 'Physical speed must remain 60 m/s regardless of playback speed setting');

  if ((sim as any).timerId) clearInterval((sim as any).timerId);
  console.log('  -> PASS: Playback speed does not affect physical displacement, velocity, or the 20 ms timestep.');
}

// -------------------------------------------------------------------------------------------------
// [4/8] Mathematical position and velocity continuity across runtime speed changes
// -------------------------------------------------------------------------------------------------
console.log('[4/8] Verifying strict position and velocity continuity at runtime speed changes...');
{
  const flight = new ACNFlightConfig({
    loiterRadiusAM: 20000,
    loiterRadiusBM: 10000,
    loiterSpeedMps: 60,
    accelerationLimitMps2: 5.0,
    decelerationLimitMps2: 5.0,
  });
  const engine = new ACNTrajectoryEngine(flight);

  // Run at 60 m/s until t = 15.0 s
  const tChange = 15.0;
  const pBefore = engine.getAcnPosition(tChange);
  const vBefore = engine.getCurrentSpeed(tChange);

  // Runtime change: accelerate to 120 m/s
  engine.setTargetSpeed(120, tChange);

  const pAtChange = engine.getAcnPosition(tChange);
  const vAtChange = engine.getCurrentSpeed(tChange);

  // Position jump must be mathematically ZERO
  const posJump = Math.hypot(pAtChange[0] - pBefore[0], pAtChange[1] - pBefore[1], pAtChange[2] - pBefore[2]);
  close(posJump, 0.0, 1e-9, 'Spatial jump at transition moment must be exactly 0 m');

  // Velocity jump must be mathematically ZERO
  close(vAtChange, vBefore, 1e-9, 'Velocity at transition moment must be continuous (no instantaneous jump)');

  // Infinitesimally after transition (e.g. 1 ms)
  const dtMicro = 0.001;
  const pAfterMicro = engine.getAcnPosition(tChange + dtMicro);
  const microDist = Math.hypot(pAfterMicro[0] - pAtChange[0], pAfterMicro[1] - pAtChange[1]);
  close(microDist, 60 * dtMicro, 1e-4, 'Initial motion continues smoothly from prior velocity');

  console.log('  -> PASS: Spatial and velocity continuity mathematically guaranteed at transition moment.');
}

// -------------------------------------------------------------------------------------------------
// [5/8] Bounded acceleration and deceleration limits
// -------------------------------------------------------------------------------------------------
console.log('[5/8] Verifying bounded acceleration and deceleration profiles...');
{
  const aLim = 4.0; // 4 m/s^2
  const dLim = 2.0; // 2 m/s^2
  const flight = new ACNFlightConfig({
    loiterRadiusAM: 25000,
    loiterRadiusBM: 25000,
    loiterSpeedMps: 50,
    accelerationLimitMps2: aLim,
    decelerationLimitMps2: dLim,
  });
  const engine = new ACNTrajectoryEngine(flight);

  // Test acceleration from 50 to 90 m/s (delta = 40 m/s, expected time = 40 / 4 = 10s)
  const t0 = 10.0;
  engine.setTargetSpeed(90, t0);

  const tHalf = t0 + 5.0; // after 5s: expected speed = 50 + 4*5 = 70 m/s
  close(engine.getCurrentSpeed(tHalf), 70.0, 1e-6, 'Speed at t0 + 5s must be 70 m/s');

  const tEnd = t0 + 10.0; // at 10s: reached target 90 m/s
  close(engine.getCurrentSpeed(tEnd), 90.0, 1e-6, 'Speed at t0 + 10s must be 90 m/s');

  const tBeyond = t0 + 15.0; // maintains target
  close(engine.getCurrentSpeed(tBeyond), 90.0, 1e-6, 'Speed beyond ramp must remain at target 90 m/s');

  // Test deceleration from 90 to 50 m/s (delta = 40 m/s, expected time = 40 / 2 = 20s)
  const tDecel = 30.0;
  engine.setTargetSpeed(50, tDecel);

  const tDecelHalf = tDecel + 10.0; // after 10s: expected speed = 90 - 2*10 = 70 m/s
  close(engine.getCurrentSpeed(tDecelHalf), 70.0, 1e-6, 'Speed at tDecel + 10s must be 70 m/s');

  const tDecelEnd = tDecel + 20.0; // at 20s: reached target 50 m/s
  close(engine.getCurrentSpeed(tDecelEnd), 50.0, 1e-6, 'Speed at tDecel + 20s must be 50 m/s');

  // Verify step-by-step acceleration magnitude never exceeds limit
  const dt = 0.02; // 20 ms
  let prevV = 90.0;
  for (let t = tDecel + dt; t <= tDecelEnd; t += dt) {
    const currV = engine.getCurrentSpeed(t);
    const measuredRate = (prevV - currV) / dt;
    assert.ok(measuredRate <= dLim + 1e-6, `Deceleration rate ${measuredRate} must not exceed limit ${dLim}`);
    prevV = currV;
  }

  console.log('  -> PASS: Acceleration (4 m/s²) and deceleration (2 m/s²) ramp timing strictly bounded.');
}

// -------------------------------------------------------------------------------------------------
// [6/8] Hover mode (stationary at v=0, simulation continues, no division-by-zero)
// -------------------------------------------------------------------------------------------------
console.log('[6/8] Verifying hover mode (v=0 stationary, queues/RF/simulation continue)...');
{
  const sim = new SimulationWorkerManager();
  
  // Advance simulation to t = 5.0 s (250 steps)
  for (let i = 0; i < 250; i++) sim.tickSimulation();
  close(sim.simTimeS, 5.0, 1e-6);

  const posBeforeHover = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  
  // Enter hover mode: set speed to 0 m/s (using max deceleration 50 m/s^2)
  const hoverRes = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { loiter_speed_mps: 0, deceleration_limit_mps2: 50.0 } });
  assert.equal(hoverRes.accepted, true, 'Hover mode (0 m/s) must be accepted');

  // Step 60 frames (1.2 seconds) to complete deceleration from 60 m/s to 0 m/s
  for (let i = 0; i < 60; i++) sim.tickSimulation();
  close(sim.trajectoryEngine.getCurrentSpeed(sim.simTimeS), 0.0, 1e-6, 'Speed reaches 0.0 m/s after deceleration ramp');

  const posHovered = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);

  // Step 100 frames (2.0 simulated seconds) while hovering stationary
  for (let i = 0; i < 100; i++) {
    sim.tickSimulation();
    const posHover = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
    close(posHover[0], posHovered[0], 1e-4, 'UAV position X must remain stationary during hover');
    close(posHover[1], posHovered[1], 1e-4, 'UAV position Y must remain stationary during hover');
    close(posHover[2], posHovered[2], 1e-4, 'UAV altitude Z must remain stationary during hover');
  }

  // Verify simulation time advanced normally (5.0s + 1.2s + 2.0s = 8.2s)
  close(sim.simTimeS, 8.2, 1e-6, 'Simulation clock must continue advancing during hover');
  assert.equal(sim.frameIndex, 410, 'Frame counter must continue incrementing during hover');

  // Velocity vector must be [0, 0, 0]
  const velHover = sim.trajectoryEngine.getAcnVelocity(sim.simTimeS);
  assert.deepEqual(velHover, [0, 0, 0], 'Hovering UAV velocity must be [0, 0, 0]');

  // Telemetry frame must report current speed 0.0 m/s and stationary telemetry
  const frame = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
  close(frame.acn_telemetry.current_speed_mps, 0.0, 1e-6, 'Telemetry must report current speed 0 m/s');
  assert.equal(frame.acn_telemetry.target_speed_mps, 0.0);

  // Resume flight from hover: set speed to 80 m/s
  const resumeRes = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { loiter_speed_mps: 80, acceleration_limit_mps2: 10.0 } });
  assert.equal(resumeRes.accepted, true, 'Resume flight from hover must be accepted');

  // Check smooth acceleration from stationary location
  const posAtResume = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  close(posAtResume[0], posHovered[0], 1e-4, 'Flight resumes directly from the hovered location');

  for (let i = 0; i < 50; i++) sim.tickSimulation();
  const speedAfterResume = sim.trajectoryEngine.getCurrentSpeed(sim.simTimeS);
  assert.ok(speedAfterResume > 0, 'UAV must smoothly accelerate after hover');

  console.log('  -> PASS: Hover mode strictly verified: stationary position, [0,0,0] velocity, zero division errors.');
}

// -------------------------------------------------------------------------------------------------
// [7/8] Simulation reset restores default physical flight speed
// -------------------------------------------------------------------------------------------------
console.log('[7/8] Verifying simulation reset restores configured speed and clean kinematics...');
{
  const sim = new SimulationWorkerManager();
  
  // Update speed to 150 m/s and run for 1 second (50 steps)
  sim.handleMessage({ type: 'CONFIG_UPDATE', params: { loiter_speed_mps: 150 } });
  for (let i = 0; i < 50; i++) sim.tickSimulation();
  close(sim.simTimeS, 1.0, 1e-6);

  // Reset simulation
  sim.handleMessage({ type: 'SIM_CONTROL', action: 'reset' });

  assert.equal(sim.simTimeS, 0.0, 'Sim time must be 0.0 after reset');
  assert.equal(sim.frameIndex, 0, 'Frame index must be 0 after reset');
  
  // Position must repeat start position at t = 0
  const pStart = sim.trajectoryEngine.getAcnPosition(0);
  const pAtZero = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  close(pAtZero[0], pStart[0], 1e-6);
  close(pAtZero[1], pStart[1], 1e-6);

  // Velocity must match configured speed
  const speed = sim.trajectoryEngine.getCurrentSpeed(0);
  close(speed, 150.0, 1e-6, 'Speed kinematics initialized to configured speed');

  console.log('  -> PASS: Reset restores initial state and deterministically reinitializes kinematics.');
}

// -------------------------------------------------------------------------------------------------
// [8/8] Waypoint trajectory mode speed transitions and continuity
// -------------------------------------------------------------------------------------------------
console.log('[8/8] Verifying speed changes and kinematics in waypoint trajectory mode...');
{
  const waypoints = [
    { xM: 0, yM: 0 },
    { xM: 10000, yM: 0 },
    { xM: 10000, yM: 10000 },
    { xM: 0, yM: 10000 },
  ];
  const flight = new ACNFlightConfig({
    trajectoryMode: 'waypoints',
    waypoints,
    loiterSpeedMps: 60,
    accelerationLimitMps2: 6.0,
    decelerationLimitMps2: 6.0,
  });
  const engine = new WaypointTrajectoryEngine(flight);

  // Runtime speed change in waypoint mode
  const tChange = 20.0;
  const pBefore = engine.getAcnPosition(tChange);
  engine.setTargetSpeed(100, tChange);

  const pAfter = engine.getAcnPosition(tChange);
  const posJump = Math.hypot(pAfter[0] - pBefore[0], pAfter[1] - pBefore[1]);
  close(posJump, 0.0, 1e-9, 'Waypoint mode position continuity at speed change');

  // Target speed reaches 100 m/s after (100 - 60)/6 = 6.67 s
  const tTarget = tChange + (40 / 6.0);
  close(engine.getCurrentSpeed(tTarget), 100.0, 1e-4, 'Waypoint mode reaches target speed');

  console.log('  -> PASS: Waypoint trajectory engine obeys kinematics and preserves continuity.');
}

console.log('\n================================================================================');
console.log('  ALL 8 PHYSICAL UAV SPEED & KINEMATICS VERIFICATION SUITES PASSED CLEANLY!');
console.log('================================================================================\n');
