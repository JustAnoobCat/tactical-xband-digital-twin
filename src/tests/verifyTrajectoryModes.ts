import assert from 'node:assert/strict';
import { ACNFlightConfig, EnvironmentConfig, RFConfig } from '../core/config';
import { ACNTrajectoryEngine, PredictiveLookAheadEngine, WaypointTrajectoryEngine } from '../core/trajectory';
import { LinkBudgetEngine } from '../core/linkBudget';
import { TerrainEngine } from '../core/terrain';
import { SimulationWorkerManager } from '../worker/simWorker';

function close(actual: number, expected: number, tolerance: number, message: string): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
}

function makeWaypointTrajectory(): WaypointTrajectoryEngine {
  return new WaypointTrajectoryEngine(new ACNFlightConfig({
    trajectoryMode: 'waypoints', altitudeMslM: 4000, loiterSpeedMps: 60,
    waypoints: [{ xM: 0, yM: 0 }, { xM: 1000, yM: 0 }, { xM: 800, yM: 900 }, { xM: -100, yM: 700 }],
  }));
}

function verifyEllipseCompatibility(): void {
  const config = new ACNFlightConfig({ loiterRadiusAM: 1000, loiterRadiusBM: 500, loiterRotationDeg: 0, loiterSpeedMps: 60 });
  assert.equal(config.trajectoryMode, 'ellipse', 'existing configuration defaults to ellipse mode');
  const ellipse = new ACNTrajectoryEngine(config);
  assert.deepEqual(ellipse.getAcnPosition(0), [1000, 0, 5000]);
  const velocity = ellipse.getAcnVelocity(0);
  close(Math.hypot(velocity[0], velocity[1]), 60, 1e-9, 'ellipse preserves configured speed');
  close(velocity[0], 0, 1e-9, 'ellipse starts tangent to positive y');
  close(velocity[1], 60, 1e-9, 'ellipse starts tangent to positive y');
  const afterPeriod = ellipse.getAcnPosition(ellipse.orbitPeriodS);
  close(afterPeriod[0], 1000, 0.1, 'ellipse position repeats');
  close(afterPeriod[1], 0, 0.1, 'ellipse position repeats');
}

function verifyWaypointLoop(): void {
  const trajectory = makeWaypointTrajectory();
  const period = trajectory.orbitPeriodS;
  assert.ok(period > 0 && Number.isFinite(period));
  const start = trajectory.getAcnPosition(0);
  const end = trajectory.getAcnPosition(period);
  close(Math.hypot(start[0] - end[0], start[1] - end[1]), 0, 1e-8, 'position is continuous across loop boundary');
  const negative = trajectory.getAcnPosition(-0.25);
  const wrapped = trajectory.getAcnPosition(period - 0.25);
  close(Math.hypot(negative[0] - wrapped[0], negative[1] - wrapped[1]), 0, 1e-7, 'negative time wraps deterministically');
  assert.equal(start[2], 4000);
  assert.equal(trajectory.getPathPoints(20).length, 20);

  const segmentTimes = trajectory.getSegmentBoundaryTimesS();
  assert.equal(segmentTimes.length, trajectory.flightConfig.waypoints.length,
    'boundary diagnostics expose every segment start from the timing table');
  for (const time of segmentTimes) {
    const v = trajectory.getAcnVelocity(time);
    close(Math.hypot(v[0], v[1]), 60, 0.4, 'waypoint velocity matches the centered 20 ms position derivative within 1%');
    assert.ok(Number.isFinite(Math.atan2(v[1], v[0])), 'heading is finite');
    const before = trajectory.getAcnVelocity(time - 1e-4), after = trajectory.getAcnVelocity(time + 1e-4);
    close(Math.hypot(before[0], before[1]), 60, 0.6, 'speed remains bounded immediately before a segment boundary');
    close(Math.hypot(after[0], after[1]), 60, 0.6, 'speed remains bounded immediately after a segment boundary');
    const headingDelta = Math.atan2(Math.sin(Math.atan2(after[1], after[0]) - Math.atan2(before[1], before[0])),
      Math.cos(Math.atan2(after[1], after[0]) - Math.atan2(before[1], before[0])));
    assert.ok(Math.abs(headingDelta) < 0.02, `spline heading remains continuous near actual segment boundary t=${time}`);
    const beforePosition = trajectory.getAcnPosition(time - 1e-4);
    const afterPosition = trajectory.getAcnPosition(time + 1e-4);
    assert.ok(Math.hypot(afterPosition[0] - beforePosition[0], afterPosition[1] - beforePosition[1]) > 0,
      'position advances through every segment boundary');
  }
  const seamBefore = trajectory.getAcnVelocity(period - 1e-4);
  const seamAfter = trajectory.getAcnVelocity(period + 1e-4);
  close(Math.hypot(seamBefore[0], seamBefore[1]), 60, 0.6, 'loop seam speed before wrap');
  close(Math.hypot(seamAfter[0], seamAfter[1]), 60, 0.6, 'loop seam speed after wrap');
  const seamHeadingDelta = Math.atan2(Math.sin(Math.atan2(seamAfter[1], seamAfter[0]) - Math.atan2(seamBefore[1], seamBefore[0])),
    Math.cos(Math.atan2(seamAfter[1], seamAfter[0]) - Math.atan2(seamBefore[1], seamBefore[0])));
  assert.ok(Math.abs(seamHeadingDelta) < 0.02, 'loop seam heading is continuous');

  for (const bad of [
    [{ xM: 0, yM: 0 }, { xM: 1, yM: 0 }],
    [{ xM: 0, yM: 0 }, { xM: 1, yM: 0 }, { xM: 0, yM: 0 }],
    [{ xM: 0, yM: 0 }, { xM: 1, yM: 0 }, { xM: Number.NaN, yM: 1 }],
    [{ xM: 0, yM: 0 }, { xM: 0, yM: 0 }, { xM: 1, yM: 1 }],
    [{ xM: 0, yM: 0 }, { xM: 1, yM: 0 }, { xM: 2, yM: 0 }],
  ]) {
    assert.throws(() => new WaypointTrajectoryEngine(new ACNFlightConfig({ trajectoryMode: 'waypoints', waypoints: bad })));
  }
  assert.throws(() => new WaypointTrajectoryEngine(new ACNFlightConfig({ trajectoryMode: 'waypoints', loiterSpeedMps: -1, waypoints: [
    { xM: 0, yM: 0 }, { xM: 1, yM: 0 }, { xM: 0, yM: 1 },
  ] })));
  const stationary = new WaypointTrajectoryEngine(new ACNFlightConfig({ trajectoryMode: 'waypoints', loiterSpeedMps: 0, waypoints: [
    { xM: 0, yM: 0 }, { xM: 1, yM: 0 }, { xM: 0, yM: 1 },
  ] }));
  assert.equal(stationary.currentSpeedMps, 0, 'Stationary hold at 0 m/s supported in waypoints');
}

function measureRoute(waypoints: Array<{ xM: number; yM: number }>, label: string, samplesPerSegment = 512): { maxSpeedError: number; maxVelocityError: number; maxRouteDeviation: number; routeLength: number } {
  const speed = 60;
  const trajectory = new WaypointTrajectoryEngine(new ACNFlightConfig({
    trajectoryMode: 'waypoints', loiterSpeedMps: speed, waypoints,
  }), samplesPerSegment);
  const dt = 0.02; // Worker simulation time step is 20 ms (50 Hz).
  let maxSpeedError = 0;
  let maxVelocityError = 0;
  const steps = Math.ceil(trajectory.orbitPeriodS / dt);
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    const before = trajectory.getAcnPosition(t - dt / 2);
    const after = trajectory.getAcnPosition(t + dt / 2);
    const measuredVx = (after[0] - before[0]) / dt;
    const measuredVy = (after[1] - before[1]) / dt;
    const measuredSpeed = Math.hypot(measuredVx, measuredVy);
    maxSpeedError = Math.max(maxSpeedError, Math.abs(measuredSpeed - speed) / speed);
    const reported = trajectory.getAcnVelocity(t);
    maxVelocityError = Math.max(maxVelocityError,
      Math.hypot(measuredVx - reported[0], measuredVy - reported[1]) / speed);
  }

  const distanceToSegment = (x: number, y: number, a: { xM: number; yM: number }, b: { xM: number; yM: number }) => {
    const dx = b.xM - a.xM, dy = b.yM - a.yM;
    const denom = dx * dx + dy * dy;
    const u = Math.max(0, Math.min(1, ((x - a.xM) * dx + (y - a.yM) * dy) / denom));
    return Math.hypot(x - (a.xM + u * dx), y - (a.yM + u * dy));
  };
  let maxRouteDeviation = 0;
  for (const [x, y] of trajectory.getPathPoints(waypoints.length * 256)) {
    let nearest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < waypoints.length; i++) {
      nearest = Math.min(nearest, distanceToSegment(x, y, waypoints[i], waypoints[(i + 1) % waypoints.length]));
    }
    maxRouteDeviation = Math.max(maxRouteDeviation, nearest);
  }
  console.log(`Waypoint accuracy ${label} (${samplesPerSegment} samples/segment): max 20ms speed error ${(maxSpeedError * 100).toFixed(3)}%, max velocity/derivative error ${(maxVelocityError * 100).toFixed(3)}%, max deviation ${maxRouteDeviation.toFixed(3)} m (${(100 * maxRouteDeviation / trajectory.totalLengthM).toFixed(3)}% of path length)`);
  return { maxSpeedError, maxVelocityError, maxRouteDeviation, routeLength: trajectory.totalLengthM };
}

function verifyWaypointAccuracyAndGeometry(): void {
  const routes = [
    { label: 'close spacing', points: [{ xM: 0, yM: 0 }, { xM: 30, yM: 0 }, { xM: 35, yM: 12 }, { xM: 30, yM: 30 }, { xM: 0, yM: 20 }] },
    { label: 'irregular spacing', points: [{ xM: 0, yM: 0 }, { xM: 1800, yM: 0 }, { xM: 1900, yM: 80 }, { xM: 250, yM: 900 }, { xM: -100, yM: 200 }] },
    { label: 'sharp turns', points: [{ xM: 0, yM: 0 }, { xM: 1000, yM: 0 }, { xM: 1005, yM: 5 }, { xM: 1000, yM: 1000 }, { xM: 0, yM: 1000 }] },
    { label: 'nearly collinear', points: [{ xM: 0, yM: 0 }, { xM: 1000, yM: 1e-4 }, { xM: 2000, yM: 0 }, { xM: 2000, yM: 1000 }, { xM: 0, yM: 1000 }] },
    { label: 'self crossing', points: [{ xM: 0, yM: 0 }, { xM: 1000, yM: 1000 }, { xM: 0, yM: 1000 }, { xM: 1000, yM: 0 }, { xM: 500, yM: -300 }] },
  ];
  for (const route of routes) {
    const metrics = measureRoute(route.points, route.label);
    assert.ok(metrics.maxSpeedError < 0.01, `${route.label}: 20ms sampled speed error under 1%`);
    assert.ok(metrics.maxVelocityError < 0.01, `${route.label}: reported velocity matches the 20ms position derivative within 1%`);
    assert.ok(metrics.maxRouteDeviation < metrics.routeLength * 0.05,
      `${route.label}: spline excursion remains below 5% of route length`);
  }
  const irregular = routes.find(route => route.label === 'irregular spacing')!;
  const baseline64 = measureRoute(irregular.points, 'irregular baseline', 64);
  const dense512 = measureRoute(irregular.points, 'irregular dense', 512);
  assert.ok(baseline64.maxSpeedError > 0.01, '64 samples per segment demonstrate error above the 1% target');
  assert.ok(dense512.maxSpeedError < 0.01, '512 samples per segment meet the 1% speed target');
}

function verifyPredictionUsesSelectedMode(): void {
  const flight = new ACNFlightConfig({ trajectoryMode: 'waypoints', altitudeMslM: 50000, loiterSpeedMps: 60,
    waypoints: [{ xM: -1000, yM: -1000 }, { xM: 1000, yM: -1000 }, { xM: 1000, yM: 1000 }, { xM: -1000, yM: 1000 }] });
  const trajectory = new WaypointTrajectoryEngine(flight);
  const terrain = new TerrainEngine({ terrainMode: 'synthetic' });
  const observed: Array<[number, number]> = [];
  const evaluate = terrain.evaluateTerrainObstruction.bind(terrain);
  terrain.evaluateTerrainObstruction = (node, acn, rf, env, stepIntervalM) => {
    observed.push([acn[0], acn[1]]);
    return evaluate(node, acn, rf, env, stepIntervalM);
  };
  const lookahead = new PredictiveLookAheadEngine(terrain, new LinkBudgetEngine(), new RFConfig(),
    new EnvironmentConfig(), flight, trajectory, { horizonS: 2, dtStepS: 1 });
  lookahead.evaluatePredictiveState([0, 0, 2], 0);
  assert.ok(observed.length >= 2, 'look-ahead samples future trajectory positions');
  const expected = trajectory.getAcnPosition(1);
  assert.ok(observed.some(point => Math.hypot(point[0] - expected[0], point[1] - expected[1]) < 1e-6),
    'prediction obstruction sampling uses waypoint mode');
}

function verifyWorkerTrajectoryUpdates(): void {
  const sim = new SimulationWorkerManager();
  const path = [{ x_m: -30000, y_m: -20000 }, { x_m: 25000, y_m: -22000 }, { x_m: 18000, y_m: 30000 }, { x_m: -25000, y_m: 20000 }];
  const accepted = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { trajectory_mode: 'waypoints', waypoints: path, loiter_speed_mps: 72 } });
  assert.equal(accepted.accepted, true, accepted.reason ?? 'trajectory update accepted');
  assert.ok(sim.trajectoryEngine instanceof WaypointTrajectoryEngine);
  const currentConfig = sim.flightConfig;
  const currentTrajectory = sim.trajectoryEngine;
  const frequency = sim.rfConfig.carrierFrequencyHz;
  const rejected = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { carrier_freq_ghz: 9, waypoints: [{ x_m: 0, y_m: 0 }] } });
  assert.equal(rejected.accepted, false);
  assert.equal(sim.flightConfig, currentConfig, 'invalid waypoint edit preserves prior configuration');
  assert.equal(sim.trajectoryEngine, currentTrajectory, 'invalid waypoint edit preserves live trajectory');
  assert.equal(sim.rfConfig.carrierFrequencyHz, frequency, 'invalid combined update has no partial RF mutation');
  sim.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: true });
  assert.equal(sim.handleMessage({ type: 'CONFIG_UPDATE', params: { waypoints: path } }).accepted, false,
    'trajectory edit is rejected while spatially locked');
  assert.equal(sim.trajectoryEngine, currentTrajectory);
  sim.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: false });
  sim.tickSimulation();
  const frame = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
  assert.equal(frame.acn_telemetry.flight_path.length, 64);
  assert.deepEqual(frame.acn_telemetry.flight_path, sim.trajectoryEngine.getPathPoints(64),
    'telemetry path follows the selected trajectory mode');
}

verifyEllipseCompatibility();
verifyWaypointLoop();
verifyWaypointAccuracyAndGeometry();
verifyPredictionUsesSelectedMode();
verifyWorkerTrajectoryUpdates();
console.log('PASS ellipse and waypoint trajectory modes, validation, prediction, worker updates, and telemetry');
