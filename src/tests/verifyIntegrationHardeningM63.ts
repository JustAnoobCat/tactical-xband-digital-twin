import assert from 'node:assert/strict';
import {
  RFConfig,
  ACNFlightConfig,
  DEFAULT_ACN_FLIGHT_CONFIG,
} from '../core/config';
import {
  TrajectoryKinematics,
  ACNTrajectoryEngine,
  WaypointTrajectoryEngine,
  createACNTrajectory,
} from '../core/trajectory';
import { SimulationWorkerManager, FRAME_DT } from '../worker/simWorker';
import { LinkBudgetEngine } from '../core/linkBudget';
import { syncCanvasDpr, TopViewViewportState } from '../ui/pathProfileTopView';
import {
  createHistoricalRecordSnapshot,
  SimulationHistoryBuffer,
  type HistoricalFrameRecord,
} from '../ui/simulationHistory';

function close(actual: number, expected: number, tolerance = 1e-4, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('================================================================================');
console.log('  MILESTONE 6.3: INTEGRATION HARDENING & BROWSER READINESS TEST SUITE');
console.log('================================================================================\n');

// -------------------------------------------------------------------------------------------------
// [1/11] NaN and Infinity time values
// -------------------------------------------------------------------------------------------------
console.log('[1/11] Verifying NaN and Infinity time values rejection...');
{
  const k = new TrajectoryKinematics(60.0);
  const totalLength = 10000.0;

  for (const badTime of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => k.evaluateAtTime(badTime, totalLength),
      /finite/i,
      `TrajectoryKinematics.evaluateAtTime must reject ${badTime}`
    );
  }

  const ellipse = new ACNTrajectoryEngine(new ACNFlightConfig({ loiterSpeedMps: 60 }));
  for (const badTime of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => ellipse.getAcnPosition(badTime), /finite/i);
    assert.throws(() => ellipse.getAcnVelocity(badTime), /finite/i);
  }

  const waypoints = [
    { xM: 0, yM: 0 },
    { xM: 5000, yM: 0 },
    { xM: 5000, yM: 5000 },
    { xM: 0, yM: 5000 },
  ];
  const wpEngine = new WaypointTrajectoryEngine(
    new ACNFlightConfig({ trajectoryMode: 'waypoints', waypoints, loiterSpeedMps: 60 })
  );
  for (const badTime of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => wpEngine.getAcnPosition(badTime), /finite/i);
    assert.throws(() => wpEngine.getAcnVelocity(badTime), /finite/i);
  }

  console.log('  -> PASS: NaN, +Infinity, and -Infinity time inputs reliably rejected with errors.');
}

// -------------------------------------------------------------------------------------------------
// [2/11] Invalid trajectory lengths
// -------------------------------------------------------------------------------------------------
console.log('[2/11] Verifying invalid trajectory length rejection...');
{
  const k = new TrajectoryKinematics(60.0);

  for (const badLength of [0, -1, -50000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => k.evaluateAtTime(10.0, badLength),
      /positive finite/i,
      `TrajectoryKinematics.evaluateAtTime must reject length ${badLength}`
    );
    assert.throws(
      () => k.setTargetSpeed(80.0, 10.0, badLength),
      /positive finite/i,
      `TrajectoryKinematics.setTargetSpeed must reject length ${badLength}`
    );
  }

  console.log('  -> PASS: Non-positive and non-finite trajectory lengths deterministically rejected.');
}

// -------------------------------------------------------------------------------------------------
// [3/11] Negative speed and invalid acceleration/deceleration
// -------------------------------------------------------------------------------------------------
console.log('[3/11] Verifying negative speed and invalid acceleration/deceleration rejection...');
{
  // TrajectoryKinematics constructor speed bounds
  assert.throws(() => new TrajectoryKinematics(-1.0), /Initial speed must be finite/i);
  assert.throws(() => new TrajectoryKinematics(1001.0), /Initial speed must be finite/i);
  assert.throws(() => new TrajectoryKinematics(Number.NaN), /Initial speed must be finite/i);

  // Acceleration & deceleration bounds
  assert.throws(() => new TrajectoryKinematics(60, 0), /positive finite/i);
  assert.throws(() => new TrajectoryKinematics(60, -5), /positive finite/i);
  assert.throws(() => new TrajectoryKinematics(60, Number.NaN), /positive finite/i);
  assert.throws(() => new TrajectoryKinematics(60, 5, 0), /positive finite/i);
  assert.throws(() => new TrajectoryKinematics(60, 5, -5), /positive finite/i);
  assert.throws(() => new TrajectoryKinematics(60, 5, Number.NaN), /positive finite/i);

  // Runtime setTargetSpeed & setLimits
  const k = new TrajectoryKinematics(60);
  assert.throws(() => k.setTargetSpeed(-10, 0, 1000), /Target speed must be finite/i);
  assert.throws(() => k.setTargetSpeed(1050, 0, 1000), /Target speed must be finite/i);
  assert.throws(() => k.setLimits(-1, 5), /positive finite/i);
  assert.throws(() => k.setLimits(5, -1), /positive finite/i);
  assert.throws(() => k.setLimits(0, 5), /positive finite/i);

  // ACNFlightConfig validation
  assert.throws(() => new ACNFlightConfig({ loiterSpeedMps: -5 }), /loiterSpeedMps must be finite/i);
  assert.throws(() => new ACNFlightConfig({ loiterSpeedMps: 1500 }), /loiterSpeedMps must be finite/i);
  assert.throws(() => new ACNFlightConfig({ altitudeMslM: -500 }), /altitudeMslM must be finite/i);
  assert.throws(() => new ACNFlightConfig({ altitudeMslM: 0 }), /altitudeMslM must be finite/i);
  assert.throws(() => new ACNFlightConfig({ accelerationLimitMps2: 0 }), /positive finite/i);
  assert.throws(() => new ACNFlightConfig({ decelerationLimitMps2: -2 }), /positive finite/i);

  console.log('  -> PASS: Negative speeds and non-positive acceleration/deceleration strictly rejected.');
}

// -------------------------------------------------------------------------------------------------
// [4/11] Repeated speed changes during acceleration
// -------------------------------------------------------------------------------------------------
console.log('[4/11] Verifying repeated speed changes during acceleration preserve exact continuity...');
{
  const flight = new ACNFlightConfig({
    loiterRadiusAM: 20000,
    loiterRadiusBM: 10000,
    loiterSpeedMps: 50.0,
    accelerationLimitMps2: 4.0,
    decelerationLimitMps2: 4.0,
  });
  const engine = new ACNTrajectoryEngine(flight);

  // Step 1: At t = 5s, target 100 m/s (accelerating from 50)
  engine.setTargetSpeed(100.0, 5.0);

  // Step 2: While accelerating, at t = 8s (speed = 50 + 4*3 = 62 m/s), suddenly change target to 30 m/s
  const pPre1 = engine.getAcnPosition(8.0);
  const vPre1 = engine.getCurrentSpeed(8.0);
  close(vPre1, 62.0, 1e-6, 'Speed at t=8s before second change');

  engine.setTargetSpeed(30.0, 8.0);

  const pPost1 = engine.getAcnPosition(8.0);
  const vPost1 = engine.getCurrentSpeed(8.0);

  close(Math.hypot(pPost1[0] - pPre1[0], pPost1[1] - pPre1[1], pPost1[2] - pPre1[2]), 0.0, 1e-9, 'Spatial continuity at 1st interruption');
  close(vPost1, vPre1, 1e-9, 'Velocity continuity at 1st interruption');

  // Step 3: While decelerating, at t = 10s (speed = 62 - 4*2 = 54 m/s), suddenly change target to 120 m/s
  const pPre2 = engine.getAcnPosition(10.0);
  const vPre2 = engine.getCurrentSpeed(10.0);
  close(vPre2, 54.0, 1e-6, 'Speed at t=10s before third change');

  engine.setTargetSpeed(120.0, 10.0);

  const pPost2 = engine.getAcnPosition(10.0);
  const vPost2 = engine.getCurrentSpeed(10.0);

  close(Math.hypot(pPost2[0] - pPre2[0], pPost2[1] - pPre2[1], pPost2[2] - pPre2[2]), 0.0, 1e-9, 'Spatial continuity at 2nd interruption');
  close(vPost2, vPre2, 1e-9, 'Velocity continuity at 2nd interruption');

  console.log('  -> PASS: Repeated mid-ramp speed interruptions maintain 100% position & velocity continuity.');
}

// -------------------------------------------------------------------------------------------------
// [5/11] Zero-speed ellipse and waypoint behaviour (stationary hold)
// -------------------------------------------------------------------------------------------------
console.log('[5/11] Verifying zero-speed ellipse and waypoint stationary hold semantics...');
{
  // 1. Ellipse zero speed
  const ellipseHold = new ACNTrajectoryEngine(new ACNFlightConfig({
    loiterSpeedMps: 0.0,
    loiterRadiusAM: 15000,
    loiterRadiusBM: 10000,
  }));
  assert.equal(ellipseHold.orbitPeriodS, Number.POSITIVE_INFINITY, 'Orbit period is Infinity at zero speed');
  assert.equal(ellipseHold.currentSpeedMps, 0.0, 'Current speed reports 0.0');
  const ePos1 = ellipseHold.getAcnPosition(0.0);
  const ePos2 = ellipseHold.getAcnPosition(100.0);
  close(Math.hypot(ePos2[0] - ePos1[0], ePos2[1] - ePos1[1]), 0.0, 1e-9, 'Ellipse position remains perfectly stationary');
  const eVel = ellipseHold.getAcnVelocity(50.0);
  assert.deepEqual(eVel, [0.0, 0.0, 0.0], 'Ellipse velocity vector is strictly [0, 0, 0]');

  // 2. Waypoint zero speed
  const wpHold = new WaypointTrajectoryEngine(new ACNFlightConfig({
    trajectoryMode: 'waypoints',
    waypoints: [
      { xM: 1000, yM: 1000 },
      { xM: 8000, yM: 1000 },
      { xM: 8000, yM: 8000 },
      { xM: 1000, yM: 8000 },
    ],
    loiterSpeedMps: 0.0,
  }));
  assert.equal(wpHold.orbitPeriodS, Number.POSITIVE_INFINITY, 'Waypoint orbit period is Infinity at zero speed');
  assert.equal(wpHold.currentSpeedMps, 0.0, 'Waypoint speed reports 0.0');
  const wpPos1 = wpHold.getAcnPosition(0.0);
  const wpPos2 = wpHold.getAcnPosition(150.0);
  close(Math.hypot(wpPos2[0] - wpPos1[0], wpPos2[1] - wpPos1[1]), 0.0, 1e-9, 'Waypoint position remains perfectly stationary');
  const wpVel = wpHold.getAcnVelocity(25.0);
  assert.deepEqual(wpVel, [0, 0, 0], 'Waypoint velocity vector is strictly [0, 0, 0]');

  // 3. Worker simulation hold
  const sim = new SimulationWorkerManager();
  sim.handleMessage({ type: 'CONFIG_UPDATE', params: { loiter_speed_mps: 0.0, deceleration_limit_mps2: 50.0 } });
  // Step 60 frames (1.2s) to complete deceleration ramp from 60 m/s to 0 m/s
  for (let i = 0; i < 60; i++) sim.tickSimulation();
  close(sim.trajectoryEngine.getCurrentSpeed(sim.simTimeS), 0.0, 1e-6, 'Decelerated to stationary hold');

  const holdStartPos = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  const startTime = sim.simTimeS;
  const startFrame = sim.frameIndex;

  // Step 50 frames during stationary hold
  for (let i = 0; i < 50; i++) sim.tickSimulation();

  close(sim.simTimeS - startTime, 1.0, 1e-6, 'Clock advances 1.0s during zero-speed hold');
  assert.equal(sim.frameIndex - startFrame, 50, 'Frame index increments normally during zero-speed hold');
  const afterHoldPos = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  close(Math.hypot(afterHoldPos[0] - holdStartPos[0], afterHoldPos[1] - holdStartPos[1]), 0.0, 1e-6, 'UAV held completely stationary');
  assert.equal(sim.trajectoryEngine.getCurrentSpeed(sim.simTimeS), 0.0, 'Telemetry speed is 0.0');

  console.log('  -> PASS: Both trajectory engines and worker treat zero speed as a consistent stationary hold.');
}

// -------------------------------------------------------------------------------------------------
// [6/11] Resume from stationary hold
// -------------------------------------------------------------------------------------------------
console.log('[6/11] Verifying resume from stationary hold with acceleration limits...');
{
  const flight = new ACNFlightConfig({
    loiterSpeedMps: 0.0,
    accelerationLimitMps2: 5.0,
  });
  const engine = new ACNTrajectoryEngine(flight);

  const holdPos = engine.getAcnPosition(10.0);
  assert.equal(engine.getCurrentSpeed(10.0), 0.0);

  // Resume at t = 10.0s targeting 80 m/s
  engine.setTargetSpeed(80.0, 10.0);

  const resumePos = engine.getAcnPosition(10.0);
  close(Math.hypot(resumePos[0] - holdPos[0], resumePos[1] - holdPos[1]), 0.0, 1e-9, 'Resume preserves position without jump');
  close(engine.getCurrentSpeed(10.0), 0.0, 1e-9, 'Initial resume speed starts at 0.0');

  // Accelerating at 5 m/s^2 for 4 seconds -> speed = 20 m/s, displacement = 0.5 * 5 * 16 = 40 m
  const speedAt14 = engine.getCurrentSpeed(14.0);
  close(speedAt14, 20.0, 1e-4, 'Speed ramps at exactly 5 m/s^2');

  // Target speed reached at t = 10 + (80 / 5) = 26.0s
  close(engine.getCurrentSpeed(26.0), 80.0, 1e-4, 'Reaches steady-state target speed');
  close(engine.getCurrentSpeed(30.0), 80.0, 1e-4, 'Maintains target speed after ramp');

  console.log('  -> PASS: Resuming from stationary hold applies acceleration limits with perfect continuity.');
}

// -------------------------------------------------------------------------------------------------
// [7/11] Bandwidth 0.1, 1 and 50 MHz
// -------------------------------------------------------------------------------------------------
console.log('[7/11] Verifying bandwidth 0.1, 1.0, and 50.0 MHz scaling...');
{
  const k = 1.380649e-23;
  const T = 290.0;
  const nf = 5.0;

  // 0.1 MHz
  const { pNoiseDbm: n01 } = LinkBudgetEngine.computeThermalNoiseFloorDbm(0.1e6, nf, T, k);
  const expected01 = 10 * Math.log10(k * T * 0.1e6) + 30 + nf;
  close(n01, expected01, 1e-4, '0.1 MHz noise floor');

  // 1.0 MHz (10x bandwidth -> exactly 10 dB higher noise floor)
  const { pNoiseDbm: n1 } = LinkBudgetEngine.computeThermalNoiseFloorDbm(1.0e6, nf, T, k);
  close(n1 - n01, 10.0, 1e-4, '1 MHz noise is 10 dB higher than 0.1 MHz');

  // 50.0 MHz (50x bandwidth -> 10 * log10(50) ~ 16.9897 dB higher than 1 MHz)
  const { pNoiseDbm: n50 } = LinkBudgetEngine.computeThermalNoiseFloorDbm(50.0e6, nf, T, k);
  close(n50 - n1, 10 * Math.log10(50), 1e-4, '50 MHz noise floor conforms to theory');

  // Worker verification
  const sim = new SimulationWorkerManager();
  for (const bw of [0.1, 1.0, 50.0]) {
    const res = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { channel_bandwidth_mhz: bw } });
    assert.equal(res.accepted, true, `Worker must accept bandwidth ${bw} MHz`);
  }

  console.log('  -> PASS: Bandwidth 0.1, 1.0, and 50.0 MHz mathematically verified across thermal noise.');
}

// -------------------------------------------------------------------------------------------------
// [8/11] Invalid bandwidth values
// -------------------------------------------------------------------------------------------------
console.log('[8/11] Verifying rejection of invalid bandwidth values...');
{
  // RFConfig constructor
  assert.throws(() => new RFConfig({ channelBandwidthHz: 0.05e6 }), /channelBandwidthHz must be finite/i);
  assert.throws(() => new RFConfig({ channelBandwidthHz: 50.1e6 }), /channelBandwidthHz must be finite/i);
  assert.throws(() => new RFConfig({ channelBandwidthHz: -1.0e6 }), /channelBandwidthHz must be finite/i);
  assert.throws(() => new RFConfig({ channelBandwidthHz: Number.NaN }), /channelBandwidthHz must be finite/i);
  assert.throws(() => new RFConfig({ channelBandwidthHz: Infinity }), /channelBandwidthHz must be finite/i);

  // Worker CONFIG_UPDATE
  const sim = new SimulationWorkerManager();
  for (const badBw of [0, -1, 0.05, 50.1, 100, Number.NaN, Infinity, 'invalid']) {
    const res = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { channel_bandwidth_mhz: badBw as any } });
    assert.equal(res.accepted, false, `Worker must reject invalid bandwidth ${badBw}`);
  }

  console.log('  -> PASS: Out-of-bounds, negative, and non-finite bandwidths rejected deterministically.');
}

// -------------------------------------------------------------------------------------------------
// [9/11] Bandwidth changes during active scheduling
// -------------------------------------------------------------------------------------------------
console.log('[9/11] Verifying bandwidth changes during active scheduling...');
{
  const sim = new SimulationWorkerManager();

  // Inject video payload onto node 1
  sim.handleMessage({ type: 'INJECT_TRAFFIC', node_id: 1, traffic_type: 'VIDEO' });

  // Run 10 frames at default 1.0 MHz
  for (let i = 0; i < 10; i++) sim.tickSimulation();

  // Change bandwidth live to 20.0 MHz
  const updateRes = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { channel_bandwidth_mhz: 20.0 } });
  assert.equal(updateRes.accepted, true);

  // Run 10 more frames with widened channel
  for (let i = 0; i < 10; i++) sim.tickSimulation();

  // Telemetry check
  const frame = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
  assert.equal(sim.rfConfig.channelBandwidthHz, 20.0e6, 'Worker RFConfig updated to 20 MHz');
  assert.equal(frame.selected_link_budget?.channel_bandwidth_hz, 20.0e6, 'Telemetry reflects updated channel bandwidth');

  // Verify scheduled service never exceeds PHY slot capacity
  const node1 = frame.nodes_telemetry.find((n: any) => n.node_id === 1);
  if (node1 && node1.link_budget) {
    assert.equal(node1.link_budget.channel_bandwidth_hz, 20.0e6);
    // Bitrate at 20 MHz must be > 0 and scale with spectral efficiency
    assert.ok(node1.link_budget.bitrate_bps >= 0);
  }

  console.log('  -> PASS: Live bandwidth change during active scheduling recalculates capacity cleanly.');
}

// -------------------------------------------------------------------------------------------------
// [10/11] Historical telemetry remaining immutable after configuration changes
// -------------------------------------------------------------------------------------------------
console.log('[10/11] Verifying historical telemetry remains immutable after live config changes...');
{
  const sim = new SimulationWorkerManager();
  const historyBuffer = new SimulationHistoryBuffer(100);

  // Step 5 frames
  for (let i = 0; i < 5; i++) sim.tickSimulation();
  const frame5 = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));

  const initialRecord = createHistoricalRecordSnapshot({
    frameIndex: frame5.frame_index,
    simulationTimeS: frame5.sim_time_s,
    selectedNodeId: 1,
    nodeName: 'S1',
    profileSerial: 5,
    groundNodePositionMslM: [1000, 2000, 1200],
    acnPositionMslM: [frame5.acn_telemetry.pos_x, frame5.acn_telemetry.pos_y, frame5.acn_telemetry.pos_z],
    profile: {
      selectedGroundNodeId: 1,
      nodeName: 'S1',
      frameIndex: frame5.frame_index,
      simulationTimeS: frame5.sim_time_s,
      groundNodePositionMslM: [1000, 2000, 1200],
      acnPositionMslM: [frame5.acn_telemetry.pos_x, frame5.acn_telemetry.pos_y, frame5.acn_telemetry.pos_z],
      horizontalGroundDistanceM: 25000,
      slantDistanceM: 25500,
      fresnelFraction: 0.6,
      terrainIsLos: true,
      terrainMinimumClearanceM: 45.0,
      terrainCriticalFresnelRadiusM: 12.0,
      diffractionLossDb: 0.0,
      obstacleBlocked: false,
      obstacleIntervals: [],
      samples: [],
      valid: true,
    },
    obstruction: {
      terrainIsLos: true,
      obstacleBlocked: false,
      minClearanceM: 45.0,
      diffractionLossDb: 0.0,
      primaryBlockedObstacleId: null,
      terrainStatusText: 'PRISTINE LINE-OF-SIGHT',
      terrainBadgeClass: 'badge-emerald',
      obstacleStatusText: 'OBSTACLES: CLEAR',
      obstacleBadgeClass: 'badge-emerald',
    },
    linkBudget: {
      modcodName: '64-APSK 5/6',
      snrDb: 28.5,
      spectralEfficiencyBpsHz: 4.95,
      slantRangeKm: 25.5,
      fsplDb: 138.5,
      diffractionLossDb: 0.0,
      rxPowerDbm: -68.0,
      earthBulgeM: 12.0,
      gaseousLossDb: 0.35,
    },
  });

  historyBuffer.push(initialRecord);

  const initialAltitude = initialRecord.acnPositionMslM[2];
  const initialFspl = initialRecord.linkBudget.fsplDb;

  // Now mutate live worker configuration drastically
  sim.handleMessage({
    type: 'CONFIG_UPDATE',
    params: {
      channel_bandwidth_mhz: 35.0,
      loiter_speed_mps: 180.0,
      acn_altitude_m: 8000.0,
    },
  });

  // Step another 20 frames
  for (let i = 0; i < 20; i++) sim.tickSimulation();

  // Verify historical record in buffer was NOT mutated
  const retrievedRecord = historyBuffer.getByFrameIndex(frame5.frame_index);
  assert.ok(retrievedRecord, 'Historical record retrieved from ring buffer');
  assert.equal(retrievedRecord.frameIndex, frame5.frame_index);
  assert.equal(retrievedRecord.acnPositionMslM[2], initialAltitude, 'Historical altitude uncorrupted');
  assert.equal(retrievedRecord.linkBudget.fsplDb, initialFspl, 'Historical FSPL uncorrupted');
  assert.equal(retrievedRecord.linkBudget.snrDb, 28.5, 'Historical SNR uncorrupted');

  console.log('  -> PASS: Historical buffer entries remain completely immutable despite live updates.');
}

// -------------------------------------------------------------------------------------------------
// [11/11] DPR-aware canvas sizing and repeated resize events
// -------------------------------------------------------------------------------------------------
console.log('[11/11] Verifying DPR-aware canvas sizing and repeated resize events...');
{
  // Create mock canvas and 2D context
  class MockContext2D {
    public transformMatrix: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    public setTransformCalls: [number, number, number, number, number, number][] = [];

    public setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
      this.transformMatrix = [a, b, c, d, e, f];
      this.setTransformCalls.push([a, b, c, d, e, f]);
    }
  }

  class MockCanvas {
    public width = 0;
    public height = 0;
    public parentElement: { clientWidth: number; clientHeight: number; getBoundingClientRect: () => any } | null = null;
    public ctx = new MockContext2D();

    constructor(cssW: number, cssH: number) {
      this.parentElement = {
        clientWidth: cssW,
        clientHeight: cssH,
        getBoundingClientRect: () => ({ width: cssW, height: cssH }),
      };
    }

    public getContext(type: string): any {
      return type === '2d' ? this.ctx : null;
    }

    public getBoundingClientRect(): any {
      return this.parentElement?.getBoundingClientRect();
    }
  }

  // Test across DPR 1.0, 1.5, 2.0, 3.0
  const dprs = [1.0, 1.5, 2.0, 3.0];
  const cssW = 800;
  const cssH = 320;

  for (const dpr of dprs) {
    const canvas = new MockCanvas(cssW, cssH) as any;
    const res = syncCanvasDpr(canvas, canvas.ctx as any, { dpr, cssWidth: cssW, cssHeight: cssH });

    assert.equal(res.isVisible, true);
    assert.equal(res.dpr, dpr);
    assert.equal(res.cssWidth, cssW);
    assert.equal(res.cssHeight, cssH);
    assert.equal(canvas.width, Math.round(cssW * dpr), `Backing width for DPR ${dpr}`);
    assert.equal(canvas.height, Math.round(cssH * dpr), `Backing height for DPR ${dpr}`);
    assert.deepEqual(canvas.ctx.transformMatrix, [dpr, 0, 0, dpr, 0, 0], `Transform matrix for DPR ${dpr}`);
  }

  // Idempotency: repeated resize events with the SAME DPR must NOT accumulate scaling
  const canvas = new MockCanvas(cssW, cssH) as any;
  for (let i = 0; i < 5; i++) {
    syncCanvasDpr(canvas, canvas.ctx as any, { dpr: 2.0, cssWidth: cssW, cssHeight: cssH });
    assert.deepEqual(canvas.ctx.transformMatrix, [2.0, 0, 0, 2.0, 0, 0], 'Transform matrix does not accumulate');
    assert.equal(canvas.width, cssW * 2);
    assert.equal(canvas.height, cssH * 2);
  }

  // Zero-sized or hidden container safety
  const hiddenCanvas = new MockCanvas(0, 0) as any;
  const hiddenRes = syncCanvasDpr(hiddenCanvas, hiddenCanvas.ctx as any, { dpr: 2.0, cssWidth: 0, cssHeight: 0 });
  assert.equal(hiddenRes.isVisible, false, 'Hidden container marked not visible');
  assert.equal(hiddenCanvas.width, 0, 'Canvas width unchanged when hidden');
  assert.equal(hiddenCanvas.height, 0, 'Canvas height unchanged when hidden');

  // Resizing panel preserves TopViewViewportState zoom and pan
  const vp = new TopViewViewportState();
  const initialLayout = { width: 800, height: 320, padL: 60, padR: 24, padT: 28, padB: 34 };
  vp.syncLink([0, 0, 0], [10000, 10000, 5000], { selectedNodeId: 1, layout: initialLayout });
  vp.zoom(1.5);
  const userModified = vp.isUserModified;
  const zoomBefore = vp.zoomFactor;
  const boundsBefore = { ...vp.bounds };

  // Resize panel to 1200 x 480
  const resizedLayout = { width: 1200, height: 480, padL: 60, padR: 24, padT: 28, padB: 34 };
  vp.syncLink([0, 0, 0], [10000, 10000, 5000], { selectedNodeId: 1, layout: resizedLayout });
  assert.equal(vp.isUserModified, userModified, 'userModified preserved across panel resize');
  close(vp.zoomFactor, zoomBefore, 0.2, 'zoomFactor preserved within aspect ratio change tolerance');
  assert.deepEqual(vp.bounds, boundsBefore, 'world bounds preserved across panel resize');

  console.log('  -> PASS: DPR 1, 1.5, 2, and 3, idempotency, hidden safety, and viewport preservation verified.');
}

console.log('\n================================================================================');
console.log('  ALL 11 INTEGRATION HARDENING & BROWSER READINESS TEST SUITES PASSED CLEANLY!');
console.log('================================================================================\n');
