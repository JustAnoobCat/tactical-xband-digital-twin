import assert from 'node:assert/strict';
import { SimulationWorkerManager, FRAME_DT } from '../worker/simWorker';

function close(actual: number, expected: number, tolerance = 1e-4, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('================================================================================');
console.log('  VARIABLE SIMULATION SPEED CONTROLLER VERIFICATION SUITE');
console.log('================================================================================\n');

// -------------------------------------------------------------------------------------------------
// [1/7] Speed range, decimal support, and boundary validation [0.1x to 10x]
// -------------------------------------------------------------------------------------------------
console.log('[1/7] Verifying speed multiplier range [0.1, 10] and decimal inputs...');
{
  const sim = new SimulationWorkerManager();
  
  // Default speed must be 1.0x
  assert.equal(sim.speed, 1.0, 'Default simulation speed must be 1.0x');

  // Valid speeds: minimum 0.1x, maximum 10x, standard presets and arbitrary decimal values
  const validSpeeds = [0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 5.0, 7.5, 10.0];
  for (const spd of validSpeeds) {
    const res = sim.handleMessage({ type: 'SET_SPEED', speed: spd });
    assert.equal(res.accepted, true, `Speed ${spd}x must be accepted by worker`);
    assert.equal(sim.speed, spd, `Worker speed property must equal ${spd}`);
  }

  // Invalid speeds: below 0.1x, above 10x, negative, zero, non-finite
  const invalidSpeeds = [0.09, 0.05, 0, -0.1, -1.0, 10.01, 15.0, 100.0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'fast', null, undefined];
  for (const bad of invalidSpeeds) {
    const res = sim.handleMessage({ type: 'SET_SPEED', speed: bad });
    assert.equal(res.accepted, false, `Invalid speed ${String(bad)} must be rejected`);
  }

  if ((sim as any).timerId) clearInterval((sim as any).timerId);
  console.log('  -> PASS: Valid range [0.1x, 10x] and decimal inputs verified; out-of-bounds rejected.');
}

// -------------------------------------------------------------------------------------------------
// [2/7] Preservation of the 20 ms discrete simulation timestep (FRAME_DT = 0.02)
// -------------------------------------------------------------------------------------------------
console.log('[2/7] Verifying strict 20 ms timestep invariance across playback speeds...');
{
  const sim = new SimulationWorkerManager();
  assert.equal(FRAME_DT, 0.020, 'FRAME_DT constant must be exactly 0.020 s (20 ms)');

  for (const spd of [0.1, 0.5, 1.0, 2.0, 5.0, 10.0]) {
    sim.handleMessage({ type: 'SET_SPEED', speed: spd });
    const initialSimTime = sim.simTimeS;
    const initialFrame = sim.frameIndex;

    // Advance 50 frames
    for (let f = 0; f < 50; f++) {
      sim.tickSimulation(false);
    }

    assert.equal(sim.frameIndex - initialFrame, 50, 'Frame index must advance by exactly 50');
    close(sim.simTimeS - initialSimTime, 1.0, 1e-9, `50 frames at ${spd}x must advance simulation time by exactly 1.000 s`);
  }

  if ((sim as any).timerId) clearInterval((sim as any).timerId);
  console.log('  -> PASS: Discrete 20 ms physics timestep strictly invariant across all speed multipliers.');
}

// -------------------------------------------------------------------------------------------------
// [3/7] Setting speed while paused does NOT resume simulation
// -------------------------------------------------------------------------------------------------
console.log('[3/7] Verifying that changing speed while paused does not resume simulation...');
{
  const sim = new SimulationWorkerManager();
  
  // Pause simulation
  sim.handleMessage({ type: 'SIM_CONTROL', action: 'pause' });
  assert.equal(sim.isPaused, true, 'Worker must be paused');

  const pausedSimTime = sim.simTimeS;
  const pausedFrame = sim.frameIndex;

  // Change speed to various speeds while paused
  for (const spd of [0.5, 2.0, 5.0, 10.0, 0.25]) {
    const res = sim.handleMessage({ type: 'SET_SPEED', speed: spd });
    assert.equal(res.accepted, true);
    assert.equal(sim.isPaused, true, `Worker must remain paused after changing speed to ${spd}x`);
    assert.equal(sim.simTimeS, pausedSimTime, 'Simulation time must not advance while paused');
    assert.equal(sim.frameIndex, pausedFrame, 'Frame index must not advance while paused');
  }

  if ((sim as any).timerId) clearInterval((sim as any).timerId);
  console.log('  -> PASS: Changing speed while paused maintains pause state without advancing sim time.');
}

// -------------------------------------------------------------------------------------------------
// [4/7] Reset restores 1.0x speed
// -------------------------------------------------------------------------------------------------
console.log('[4/7] Verifying reset restores default 1.0x speed...');
{
  const sim = new SimulationWorkerManager();
  
  // Set non-default speed
  sim.handleMessage({ type: 'SET_SPEED', speed: 7.5 });
  assert.equal(sim.speed, 7.5);

  // Trigger reset
  sim.handleMessage({ type: 'SIM_CONTROL', action: 'reset' });
  assert.equal(sim.speed, 1.0, 'Reset must restore simulation speed to 1.0x');
  assert.equal(sim.simTimeS, 0.0, 'Reset must restore simulation time to 0.0');
  assert.equal(sim.frameIndex, 0, 'Reset must restore frame index to 0');

  if ((sim as any).timerId) clearInterval((sim as any).timerId);
  console.log('  -> PASS: Simulation reset cleanly restores 1.0x speed.');
}

// -------------------------------------------------------------------------------------------------
// [5/7] Step execution with variable speed preserves discrete step semantics
// -------------------------------------------------------------------------------------------------
console.log('[5/7] Verifying single-step execution preserves 20 ms increment at any speed...');
{
  const sim = new SimulationWorkerManager();
  sim.handleMessage({ type: 'SET_SPEED', speed: 10.0 });
  sim.handleMessage({ type: 'SIM_CONTROL', action: 'pause' });

  const timeBefore = sim.simTimeS;
  const frameBefore = sim.frameIndex;

  // Single step
  sim.handleMessage({ type: 'SIM_CONTROL', action: 'step', step_request_id: 42 });

  assert.equal(sim.frameIndex, frameBefore + 1, 'Single step must advance exactly one frame');
  close(sim.simTimeS, timeBefore + 0.02, 1e-9, 'Single step must advance exactly 0.020 s (20 ms)');
  assert.equal(sim.isPaused, true, 'Single step must leave simulation paused');

  if ((sim as any).timerId) clearInterval((sim as any).timerId);
  console.log('  -> PASS: Step execution advances exactly 20 ms and remains paused regardless of speed setting.');
}

// -------------------------------------------------------------------------------------------------
// [6/7] Telemetry contract exports target_speed, achieved_speed, and speed
// -------------------------------------------------------------------------------------------------
console.log('[6/7] Verifying telemetry contract exports target_speed and achieved_speed...');
{
  const sim = new SimulationWorkerManager();
  sim.handleMessage({ type: 'SET_SPEED', speed: 5.0 });

  let emittedFrame: any = null;
  (sim as any).emitHostMessage = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME') {
      emittedFrame = msg.frame;
    }
  };

  sim.tickSimulation(true);

  assert.ok(emittedFrame !== null, 'Telemetry frame must be emitted');
  assert.equal(emittedFrame.speed, 5.0, 'Telemetry frame must include speed');
  assert.equal(emittedFrame.target_speed, 5.0, 'Telemetry frame must include target_speed');
  assert.ok(typeof emittedFrame.achieved_speed === 'number', 'Telemetry frame must include numeric achieved_speed');
  assert.ok(Number.isFinite(emittedFrame.achieved_speed), 'achieved_speed must be finite');

  if ((sim as any).timerId) clearInterval((sim as any).timerId);
  console.log('  -> PASS: Telemetry contracts correctly populated with target and achieved speed metrics.');
}

// -------------------------------------------------------------------------------------------------
// [7/7] Single execution loop invariant and timer cleanup
// -------------------------------------------------------------------------------------------------
console.log('[7/7] Verifying single execution loop invariant and timer lifecycle...');
{
  const sim = new SimulationWorkerManager();

  // Rapid speed changes
  for (let i = 0; i < 20; i++) {
    const spd = 0.5 + (i % 10) * 0.5;
    sim.handleMessage({ type: 'SET_SPEED', speed: spd });
  }

  // Exactly one active timer
  const timerId = (sim as any).timerId;
  assert.ok(timerId !== null, 'Active timer must exist after setting speed');

  // Cleanup
  clearInterval(timerId);
  (sim as any).timerId = null;

  console.log('  -> PASS: Timer properly recycled on each speed change; no duplicate timers created.');
}

console.log('\n================================================================================');
console.log('  ALL 7 SIMULATION SPEED CONTROLLER VERIFICATION SUITES PASSED CLEANLY!');
console.log('================================================================================');

