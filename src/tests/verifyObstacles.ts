import assert from 'node:assert/strict';
import { ACNFlightConfig, EnvironmentConfig, RFConfig } from '../core/config';
import { Obstacle, ObstacleField, obstacleHeightAboveGround, obstacleSurfaceHeight, footprintInterval, MAX_OBSTACLES } from '../core/obstacles';
import { LinkBudgetEngine } from '../core/linkBudget';
import { TerrainEngine } from '../core/terrain';
import { PredictiveLookAheadEngine } from '../core/trajectory';
import { SimulationWorkerManager } from '../worker/simWorker';

const cuboid: Obstacle = { id: 'box', shape: 'cuboid', xM: 0, yM: 0, widthM: 10, depthM: 8, heightM: 10, rotationDeg: 0 };
const cone: Obstacle = { id: 'cone', shape: 'cone', xM: 0, yM: 0, radiusM: 10, heightM: 20 };
const pyramid: Obstacle = { id: 'pyramid', shape: 'pyramid', xM: 0, yM: 0, widthM: 10, depthM: 8, heightM: 20, rotationDeg: 0 };
const flat = (_x: number, _y: number) => 0;
const field = new ObstacleField();

function hit(o: Obstacle, a: readonly [number, number, number], b: readonly [number, number, number], ground = flat): boolean {
  field.replace([o]);
  return field.intersectRay(a, b, ground).length > 0;
}

// Footprint intervals: interior, exterior, edge, vertex, tangent, vertical and stationary XY.
assert.deepEqual(footprintInterval(cuboid, [-20, 0], [20, 0]), [0.375, 0.625]);
assert.equal(footprintInterval(cuboid, [-20, 5], [20, 5]), null);
assert.ok(footprintInterval(cuboid, [-20, 4], [20, 4]), 'closed edge is included');
assert.ok(footprintInterval(cuboid, [-10, 10], [-4, 4]), 'corner entry remains included');
assert.deepEqual(footprintInterval(cone, [-10, 10], [10, 10]), [0.5, 0.5], 'circle tangency returns a point interval');
assert.deepEqual(footprintInterval(cuboid, [0, 0], [0, 0]), [0, 1], 'vertical ray remains within its footprint');
assert.equal(hit(cuboid, [-20, 0, 5], [20, 0, 5]), true, 'cuboid interior intersection');
assert.equal(hit(cuboid, [-20, 5, 5], [20, 5, 5]), false, 'cuboid exterior clear');
assert.equal(hit(cuboid, [-20, 4, 5], [20, 4, 5]), true, 'cuboid edge intersection');
assert.equal(hit(cuboid, [-20, 0, 10], [20, 0, 10]), true, 'cuboid roof grazing');
assert.equal(hit(cuboid, [0, 0, 5], [0, 0, 5]), true, 'ray beginning and ending inside obstacle');
assert.equal(hit(cuboid, [0, 0, 5], [0.001, 0, 5]), true, 'near-vertical ray is stable');
assert.equal(hit({ ...cuboid, rotationDeg: 45 }, [-10, 0, 5], [10, 0, 5]), true, 'rotated cuboid footprint');

// Cone and pyramid profiles, including apex/roof and edge/vertex grazing.
assert.equal(obstacleHeightAboveGround(cone, 0, 0), 20);
assert.equal(obstacleHeightAboveGround(cone, 5, 0), 10);
assert.equal(obstacleHeightAboveGround(cone, 10, 0), 0);
assert.equal(obstacleSurfaceHeight(cone, 0, 0, () => 100), 120, 'surface height is terrain MSL plus shape height');
assert.equal(hit(cone, [-20, 0, 10], [20, 0, 10]), true, 'cone side intersection');
assert.equal(hit(cone, [-20, 10, 0], [20, 10, 0]), true, 'cone tangent at ground boundary');
assert.equal(hit(cone, [-20, 0, 20], [20, 0, 20]), true, 'cone apex grazing');
assert.equal(hit(cone, [0, 0, 10], [0, 0, 30]), true, 'vertical ray intersects cone');
assert.equal(obstacleHeightAboveGround(pyramid, 0, 0), 20);
assert.equal(obstacleHeightAboveGround(pyramid, 2.5, 0), 10);
assert.equal(obstacleHeightAboveGround(pyramid, 5, 0), 0);
assert.equal(hit(pyramid, [-20, 0, 5], [20, 0, 5]), true, 'pyramid roof intersection');
assert.equal(hit(pyramid, [-20, 4, 0], [20, 4, 0]), true, 'pyramid boundary grazing');
assert.equal(hit({ ...pyramid, rotationDeg: 45 }, [-10, 0, 5], [10, 0, 5]), true, 'rotated pyramid footprint');
assert.equal(hit(pyramid, [0, 0, 20], [0, 0, 20]), true, 'ray at pyramid apex');
assert.equal(hit(pyramid, [-20, 0, 20], [20, 0, 20]), true, 'pyramid apex grazing');
assert.equal(hit(pyramid, [-20, 0, 25], [20, 0, 25]), false, 'ray above pyramid clears');

// Independent slab oracle for a thin cuboid. The crossing is deliberately placed
// halfway between the old 256 uniform samples inside the footprint interval.
function flatCuboidOracle(rayA: readonly [number, number, number], rayB: readonly [number, number, number], box: Extract<Obstacle, { shape: 'cuboid' }>): boolean {
  let lo = 0, hi = 1;
  for (const [origin, delta, half] of [
    [rayA[0] - box.xM, rayB[0] - rayA[0], box.widthM / 2],
    [rayA[1] - box.yM, rayB[1] - rayA[1], box.depthM / 2],
    [rayA[2], rayB[2] - rayA[2], box.heightM],
  ] as const) {
    if (Math.abs(delta) < 1e-15) { if (origin < 0 || origin > half) return false; continue; }
    const a = -origin / delta, b = (half - origin) / delta;
    lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
  }
  return lo <= hi;
}
const thinBox: Extract<Obstacle, { shape: 'cuboid' }> = { id: 'thin', shape: 'cuboid', xM: 0, yM: 0, widthM: 5000, depthM: 2, heightM: 0.1, rotationDeg: 0 };
const crossingTargetT = 0.5 + (0.5 * (5000 / 6000) / 256);
const thinRayA: [number, number, number] = [-3000, 0, -2000 * crossingTargetT];
const thinRayB: [number, number, number] = [3000, 0, 2000 * (1 - crossingTargetT)];
assert.equal(flatCuboidOracle(thinRayA, thinRayB, thinBox), true, 'independent slab oracle confirms the sub-sample crossing');
assert.equal(hit(thinBox, thinRayA, thinRayB), true, 'bounded interval maximum finds a narrow intersection between old samples');
assert.equal(hit({ ...thinBox, rotationDeg: 31 }, [-3000, 0, 0.05], [3000, 0, 0.05]), true, 'long rotated cuboid crossing');
assert.equal(hit({ ...cone, radiusM: 0.2, heightM: 100 }, [-10, 0.2, 0], [10, 0.2, 0]), true, 'near-tangent cone edge is included');
assert.equal(hit({ ...pyramid, widthM: 0.2, depthM: 0.2 }, [-100, 0, 0.01], [100, 0, 0.01]), true, 'long path through a narrow pyramid');
assert.equal(hit(thinBox, [-3000, 0, -2], [3000, 0, 2], x => x * 0.0004), true, 'terrain variation is sampled across the footprint');

// Pointwise terrain anchoring: the object base follows ground(x,y), height remains AGL.
assert.equal(hit(cuboid, [-20, 0, 5], [20, 0, 5], () => 0), true);
assert.equal(hit(cuboid, [-20, 0, 5], [20, 0, 5], () => 10), false, 'raised terrain raises the obstacle base and roof');
assert.equal(hit(cuboid, [-20, 0, 5], [20, 0, 5], x => x * 0.1), true, 'varying ground elevation is sampled along the ray');

const terrain = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 0 });
const rf = new RFConfig(), env = new EnvironmentConfig();
const linkEngine = new LinkBudgetEngine();
const a: [number, number, number] = [-1000, 0, 3500], b: [number, number, number] = [1000, 0, 3500];
const noObs = terrain.evaluateTerrainObstruction(a, b, rf, env);
const noObsLink = linkEngine.evaluateLink('soldier', 2000, noObs.diffractionLossDb, rf, env, noObs.obstacleBlocked);
terrain.obstacleField.replace([{ ...cuboid, xM: 0, yM: 0, widthM: 100, depthM: 100, heightM: 4000 }]);
const withObs = terrain.evaluateTerrainObstruction(a, b, rf, env);
const withObsLink = linkEngine.evaluateLink('soldier', 2000, withObs.diffractionLossDb, rf, env, withObs.obstacleBlocked);
assert.equal(noObs.obstacleBlocked, false);
assert.equal(withObs.isLos, noObs.isLos, 'terrain LOS remains a distinct result');
assert.equal(withObs.obstacleBlocked, true);
assert.deepEqual(withObs.obstacleIntersections.map(x => x.obstacleId), ['box']);
assert.equal(withObs.diffractionLossDb, noObs.diffractionLossDb, 'obstacle does not fabricate terrain diffraction');
assert.equal(withObsLink.totalLossDb, noObsLink.totalLossDb, 'no arbitrary dB loss is introduced');
assert.equal(withObsLink.isOutage, true, 'screening blockage disables link availability');
assert.equal(withObsLink.bitrateBps, 0);
assert.equal(withObsLink.obstacleBlocked, true);

// Worker replacement is canonical, atomic, reflected in live/predictive evaluation, and lock protected.
const sim = new SimulationWorkerManager(9);
const workerObs = { id: 'screen', shape: 'cuboid', x_m: 0, y_m: 0, width_m: 10, depth_m: 10, height_m: 20, rotation_deg: 0 };
const accepted = sim.handleMessage({ type: 'OBSTACLES_REPLACE', request_id: 'obstacles-1', obstacles: [workerObs] });
assert.equal(accepted.accepted, true);
assert.equal(accepted.obstacle_set?.[0].id, 'screen');
assert.equal(sim.terrainEngine.obstacleField.all.length, 1);
const nodePos = sim.nodesTac[4].position;
const acnPos = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
const midpoint = [(nodePos[0] + acnPos[0]) / 2, (nodePos[1] + acnPos[1]) / 2];
const linkBlocker = { ...workerObs, x_m: midpoint[0], y_m: midpoint[1], width_m: 2000, depth_m: 2000, height_m: 5000 };
assert.equal(sim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [linkBlocker] }).accepted, true);
sim.tickSimulation();
assert.equal(sim.linkStatuses.get(4)?.obstacleBlocked, true, 'live link calculation sees the committed obstacle');
assert.equal(sim.linkStatuses.get(4)?.isOutage, true);
assert.equal(sim.predStates.get(4)?.obstacleBlocked, true, 'look-ahead shares the same obstacle evaluator');
assert.equal(sim.predStates.get(4)?.currentState, 'HARD_SHADOW_CUTOFF');
const telemetry = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
assert.equal(telemetry.nodes_telemetry.find((n: any) => n.node_id === 4)?.obstacle_blocked, true);
assert.equal(telemetry.nodes_telemetry.find((n: any) => n.node_id === 4)?.link_outage, true);
assert.equal(telemetry.selected_node_fresnel.obstacle_blocked, true);
assert.ok(telemetry.selected_node_fresnel.obstacle_intersections.some((x: any) => x.obstacleId === 'screen'));
assert.equal(telemetry.selected_node_fresnel.profile.obstacleBlocked, true);
assert.equal(telemetry.selected_node_fresnel.profile.terrainIsLos, sim.obstructionResults.get(sim.selectedNodeId)?.isLos,
  'profile keeps terrain LOS independent from the obstacle hit');
const profileHit = telemetry.selected_node_fresnel.profile.obstacleIntervals.find((x: any) => x.obstacleId === 'screen');
const physicsHit = telemetry.selected_node_fresnel.obstacle_intersections.find((x: any) => x.obstacleId === 'screen');
assert.ok(profileHit, 'typed profile preserves the stable obstacle ID');
assert.equal(profileHit.entryFraction, physicsHit.entryFraction, 'profile interval is projected from the physics intersection fraction');
assert.equal(profileHit.exitFraction, physicsHit.exitFraction);
assert.equal(profileHit.entrySlantDistanceM, physicsHit.entryFraction * telemetry.selected_node_fresnel.profile.slantDistanceM);
sim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [workerObs] });
sim.tickSimulation();
const saved = sim.terrainEngine.obstacleField.all;
const savedLinks = new Map(sim.linkStatuses), savedPredictions = new Map(sim.predStates);
for (const bad of [
  [workerObs, workerObs],
  [{ ...workerObs, x_m: Number.NaN }],
  [{ ...workerObs, x_m: 600000, width_m: 10 }],
  [{ ...workerObs, shape: 'sphere' }],
  [{ ...workerObs, width_m: 0 }],
  [{ ...workerObs, width_m: 0.01 }],
  Array.from({ length: MAX_OBSTACLES + 1 }, (_, i) => ({ ...workerObs, id: `b${i}` })),
]) {
  assert.equal(sim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: bad }).accepted, false);
  assert.deepEqual(sim.terrainEngine.obstacleField.all, saved, 'invalid batch preserves the full committed set');
  assert.deepEqual(sim.linkStatuses, savedLinks, 'invalid batch preserves live link results');
  assert.deepEqual(sim.predStates, savedPredictions, 'invalid batch preserves prediction results');
}
sim.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: true });
const lockedResult = sim.handleMessage({ type: 'OBSTACLES_REPLACE', request_id: 'locked', obstacles: [] });
assert.equal(lockedResult.accepted, false);
assert.deepEqual(lockedResult.obstacle_set, saved, 'rejection returns authoritative prior state');
assert.deepEqual(sim.terrainEngine.obstacleField.all, saved);
sim.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: false });

// Paused commit/step regression: derived state updates immediately and is consumed before traffic generation.
const pausedSim = new SimulationWorkerManager(17);
pausedSim.terrainEngine = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 0 });
pausedSim.lookaheadEngine = new PredictiveLookAheadEngine(
  pausedSim.terrainEngine, pausedSim.linkEngine, pausedSim.rfConfig, pausedSim.envConfig, pausedSim.flightConfig, pausedSim.trajectoryEngine,
);
// Keep a known-clear, ground-level target for the transition test.
pausedSim.nodesTac[4].position = [12000, 8000, 2];
pausedSim.nodesStatic[4].position = [12000, 8000, 2];
pausedSim.nodesTac[4].hasVideo = true;
pausedSim.nodesStatic[4].hasVideo = true;
pausedSim.nodesTac[4].videoMeanPktsPerFrame = 100;
pausedSim.nodesStatic[4].videoMeanPktsPerFrame = 100;
(pausedSim.nodesTac[4] as any).poissonDraw = () => 1;
(pausedSim.nodesStatic[4] as any).poissonDraw = () => 1;
pausedSim.tickSimulation();
pausedSim.handleMessage({ type: 'SIM_CONTROL', action: 'pause' });
const clearNow = pausedSim.terrainEngine.evaluateTerrainObstruction(
  pausedSim.nodesTac[4].position, pausedSim.trajectoryEngine.getAcnPosition(pausedSim.simTimeS), pausedSim.rfConfig, pausedSim.envConfig,
);
assert.equal(clearNow.isLos, true);
assert.equal(clearNow.obstacleBlocked, false);
assert.equal(pausedSim.nodesTac[4].isShadowed, false);

const currentAc = pausedSim.trajectoryEngine.getAcnPosition(pausedSim.simTimeS);
const currentNode = pausedSim.nodesTac[4].position;
const currentMid = [(currentAc[0] + currentNode[0]) / 2, (currentAc[1] + currentNode[1]) / 2];
const pausedBlocker = { ...workerObs, id: 'paused-blocker', x_m: currentMid[0], y_m: currentMid[1], width_m: 2000, depth_m: 2000, height_m: 5000 };
const beforeRefresh = {
  time: pausedSim.simTimeS, frame: pausedSim.frameIndex, queued: pausedSim.nodesTac[4].queue.getTotalBacklogBits(),
  enqueued: pausedSim.metrics.tacEnqueuedPkts,
};
const blockedResult = pausedSim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [pausedBlocker] });
assert.equal(blockedResult.accepted, true);
assert.equal(pausedSim.simTimeS, beforeRefresh.time, 'refresh does not advance simulation time');
assert.equal(pausedSim.frameIndex, beforeRefresh.frame, 'refresh does not advance frame index');
assert.equal(pausedSim.nodesTac[4].queue.getTotalBacklogBits(), beforeRefresh.queued, 'refresh does not generate traffic');
assert.equal(pausedSim.metrics.tacEnqueuedPkts, beforeRefresh.enqueued, 'refresh does not update traffic metrics');
assert.equal(pausedSim.obstructionResults.get(4)?.obstacleBlocked, true, 'paused commit refreshes obstruction immediately');
assert.equal(pausedSim.linkStatuses.get(4)?.isOutage, true);
assert.equal(pausedSim.predStates.get(4)?.currentState, 'HARD_SHADOW_CUTOFF');
assert.equal(pausedSim.nodesTac[4].isShadowed, true);
assert.equal(pausedSim.nodesStatic[4].isShadowed, true, 'static traffic state refreshes with Tac-TAD state');
assert.equal(blockedResult.obstruction_state?.find(s => s.node_id === 4)?.is_shadowed, true, 'command response carries authoritative refreshed state');
assert.equal(blockedResult.obstruction_state?.find(s => s.node_id === 4)?.obstacle_blocked, true);
assert.equal(blockedResult.obstruction_state?.find(s => s.node_id === 4)?.link_outage, true);

let shadowAtGeneration: boolean | null = null;
let videoGenerated = -1;
const tacTarget = pausedSim.nodesTac[4];
const generateOriginal = tacTarget.generateTraffic.bind(tacTarget);
tacTarget.generateTraffic = (time, dt) => {
  shadowAtGeneration = tacTarget.isShadowed;
  const packets = generateOriginal(time, dt);
  videoGenerated = packets.filter(packet => packet.qos5qi === 67).length;
  return packets;
};
pausedSim.handleMessage({ type: 'SIM_CONTROL', action: 'step' });
assert.equal(shadowAtGeneration, true, 'step traffic generator observes newly blocked state on entry');
assert.equal(videoGenerated, 0, 'blocked step does not enqueue video');

const beforeClearRefresh = { time: pausedSim.simTimeS, frame: pausedSim.frameIndex, queued: pausedSim.nodesTac[4].queue.getTotalBacklogBits() };
const clearResult = pausedSim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [] });
assert.equal(clearResult.accepted, true);
assert.equal(pausedSim.simTimeS, beforeClearRefresh.time, 'clear refresh does not advance time');
assert.equal(pausedSim.frameIndex, beforeClearRefresh.frame);
assert.equal(pausedSim.nodesTac[4].queue.getTotalBacklogBits(), beforeClearRefresh.queued, 'clear refresh does not generate traffic');
assert.equal(pausedSim.obstructionResults.get(4)?.obstacleBlocked, false, 'reverse transition refreshes immediately');
assert.equal(pausedSim.linkStatuses.get(4)?.obstacleBlocked, false);
assert.equal(pausedSim.nodesTac[4].isShadowed, false);
assert.equal(clearResult.obstruction_state?.find(s => s.node_id === 4)?.is_shadowed, false);
shadowAtGeneration = null; videoGenerated = -1;
pausedSim.handleMessage({ type: 'SIM_CONTROL', action: 'step' });
assert.equal(shadowAtGeneration, false, 'clear step traffic generator observes refreshed clear state');
assert.equal(videoGenerated, 1, 'clear step resumes video generation');

pausedSim.isPaused = false;
const runningRefreshTime = pausedSim.simTimeS;
const runningAc = pausedSim.trajectoryEngine.getAcnPosition(runningRefreshTime);
const runningNode = pausedSim.nodesTac[4].position;
const runningMid = [(runningAc[0] + runningNode[0]) / 2, (runningAc[1] + runningNode[1]) / 2];
const runningResult = pausedSim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [
  { ...pausedBlocker, x_m: runningMid[0], y_m: runningMid[1] },
] });
assert.equal(runningResult.accepted, true);
assert.equal(pausedSim.simTimeS, runningRefreshTime, 'running commit refresh does not advance simulation time');
assert.equal(pausedSim.obstructionResults.get(4)?.obstacleBlocked, true, 'running commit also refreshes immediately');
assert.equal(pausedSim.nodesTac[4].isShadowed, true);
pausedSim.isPaused = true;

const snapshotPaused = () => ({
  obstacles: pausedSim.terrainEngine.obstacleField.all,
  links: [...pausedSim.linkStatuses], predictions: [...pausedSim.predStates], obstructions: [...pausedSim.obstructionResults],
  shadowedTac: pausedSim.nodesTac.map(n => n.isShadowed), shadowedStatic: pausedSim.nodesStatic.map(n => n.isShadowed),
  time: pausedSim.simTimeS, frame: pausedSim.frameIndex,
  queuesTac: pausedSim.nodesTac.map(n => n.queue.getTotalBacklogBits()),
  queuesStatic: pausedSim.nodesStatic.map(n => n.queue.getTotalBacklogBits()),
  enqueuedTac: pausedSim.metrics.tacEnqueuedPkts, enqueuedStatic: pausedSim.metrics.staticEnqueuedPkts,
});
const beforeRejected = snapshotPaused();
assert.equal(pausedSim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [{ ...pausedBlocker, height_m: Number.NaN }] }).accepted, false);
assert.deepEqual(snapshotPaused(), beforeRejected, 'invalid replacement preserves geometry, derived state, and traffic');
pausedSim.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: true });
const beforeLocked = snapshotPaused();
const lockRejected = pausedSim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [pausedBlocker] });
assert.equal(lockRejected.accepted, false);
assert.deepEqual(snapshotPaused(), beforeLocked, 'locked replacement preserves geometry, derived state, and traffic');

// Representative obstacle-query workload: 16 ground links x 31 prediction samples, maximum set size.
const benchField = new ObstacleField();
const benchmarkTerrain = new TerrainEngine({ terrainMode: 'synthetic' });
benchField.replace(Array.from({ length: MAX_OBSTACLES }, (_, i) => ({
  id: `bench-${i}`, shape: 'cuboid', x_m: (i % 16) * 1500 - 11000, y_m: Math.floor(i / 16) * 1800 - 6000,
  width_m: 80, depth_m: 60, height_m: 30, rotation_deg: (i * 7) % 360,
})));
let hitCount = 0;
let terrainSampleCount = 0;
const runBenchmark = () => {
  for (let node = 0; node < 16; node++) for (let future = 0; future < 31; future++) {
    const from: [number, number, number] = [node * 1100 - 8000, -10000 + node * 500, 8000];
    const to: [number, number, number] = [Math.cos(future / 8) * 20000, Math.sin(future / 8) * 12000, 12000];
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    hitCount += benchField.intersectRay(from, to, (x, y, fraction) => {
      terrainSampleCount++;
      const d1 = distance * fraction;
      return benchmarkTerrain.getElevation(x, y) + d1 * (distance - d1) / (2 * env.effectiveEarthRadiusM);
    }).length;
  }
};
for (let warmup = 0; warmup < 3; warmup++) runBenchmark(); // JIT warm-up
const durations: number[] = [];
for (let repeat = 0; repeat < 9; repeat++) {
  const startBench = performance.now(); runBenchmark(); durations.push(performance.now() - startBench);
}
durations.sort((x, y) => x - y);
console.log(`Obstacle-query benchmark: ${MAX_OBSTACLES} obstacles, 496 16-node × 31-look-ahead rays, 3 warm-ups/9 measured runs, median ${durations[4].toFixed(2)} ms, worst ${durations[8].toFixed(2)} ms; terrain samples=${terrainSampleCount}, hits=${hitCount}.`);

const adversarialField = new ObstacleField();
adversarialField.replace(Array.from({ length: MAX_OBSTACLES }, (_, i) => ({
  id: `adversarial-${i}`, shape: i % 3 === 0 ? 'cone' : i % 3 === 1 ? 'pyramid' : 'cuboid',
  x_m: (i - MAX_OBSTACLES / 2) * 40, y_m: 0,
  ...(i % 3 === 0 ? { radius_m: 0.2, height_m: 20 } : { width_m: 0.2, depth_m: 0.2, height_m: 20, rotation_deg: 37 }),
})));
const adversarialTimes: number[] = [];
let adversarialTerrainSamples = 0;
const runAdversarial = () => {
  for (let i = 0; i < 496; i++) {
    const x = (i % MAX_OBSTACLES - MAX_OBSTACLES / 2) * 40;
    adversarialField.intersectRay([x - 100, 0, 10], [x + 100, 0, 10], () => { adversarialTerrainSamples++; return 0; });
  }
};
for (let warmup = 0; warmup < 3; warmup++) runAdversarial();
for (let repeat = 0; repeat < 9; repeat++) {
  const startBench = performance.now(); runAdversarial(); adversarialTimes.push(performance.now() - startBench);
}
adversarialTimes.sort((x, y) => x - y);
console.log(`Adversarial benchmark: ${MAX_OBSTACLES} narrow mixed-shape obstacles, 496 long grazing/crossing rays, 3 warm-ups/9 measured runs, median ${adversarialTimes[4].toFixed(2)} ms, worst ${adversarialTimes[8].toFixed(2)} ms; terrain samples=${adversarialTerrainSamples}, includes candidate filtering and terrain evaluations.`);
console.log('PASS obstacle geometry, atomic worker replacement, separate blockage/outage semantics, and screening policy');
