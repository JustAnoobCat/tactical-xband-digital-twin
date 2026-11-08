/**
 * src/tests/verifyLookaheadDecoupling.ts
 *
 * DRDO Tactical X-Band Air-to-Ground Digital Twin
 * Milestone M1: Predictive Lookahead Decoupling Verification Suite (Phase D1 Production Binding)
 *
 * Implements Tests DECOUPLE-T1 through DECOUPLE-T8 exercising actual production engines:
 * - DECOUPLE-T1: Stable Node Phase Assignment & Interleaved Round-Robin Budget (Production getNodeLookaheadPhase)
 * - DECOUPLE-T2: Lookahead Evaluation Rate Decoupling (10 Hz Interleaved vs 50 Hz Reference Engine)
 * - DECOUPLE-T3: Monotonic Elapsed-Time Propagation & FSM Transitions (Production reconcilePredictiveState)
 * - DECOUPLE-T4: Ground-Truth Reconciliation & Transmission Prevention Invariants (ActiveTransferManager + Schedulers)
 * - DECOUPLE-T5: Real Cache Invalidation Hierarchy & Multi-Node Safety (SimWorker live cache invalidation)
 * - DECOUPLE-T6: Emergency Discrepancy Refreshes & Bounded Execution Budget (Production quota dispatcher across 16, 32, 64, 128 nodes)
 * - DECOUPLE-T7: Comparative Tactical Equivalence (Independent 50 Hz Reference vs 10 Hz Candidate on Ladakh DEM)
 * - DECOUPLE-T8: Independent Replay Determinism Within Both 10 Hz Decoupled and 50 Hz Reference Modes
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACNFlightConfig, EnvironmentConfig, NodeType, RFConfig } from '../core/config';
import {
  ACNTrajectoryEngine,
  createACNTrajectory,
  NodeTerrainState,
  PredictiveLookAheadEngine,
  PredictiveState,
} from '../core/trajectory';
import { TerrainEngine, TerrainObstruction } from '../core/terrain';
import { LinkBudgetEngine } from '../core/linkBudget';
import { SimulationWorkerManager, FRAME_DT } from '../worker/simWorker';
import { computeCanonicalStateHash } from './helpers/simulationTrace';
import { TerrainAwareDynamicScheduler } from '../core/scheduler';
import { GroundNodeTrafficSubsystem } from '../core/queues';
import { ActiveTransferManager } from '../core/transferManager';
import type { Position3D } from '../shared/types';

const realDemPath = resolve(process.cwd(), 'public/terrain/real_ladakh_dem.bin');
assert.ok(existsSync(realDemPath), `Real Ladakh DEM binary must exist at ${realDemPath}`);
const realDemBuffer = readFileSync(realDemPath);

console.log('='.repeat(92));
console.log('   DRDO X-BAND DIGITAL TWIN // M1 PREDICTIVE LOOKAHEAD DECOUPLING VERIFICATION');
console.log('   Authoritative Production Binding Suite // Milestone M1 Phase D1');
console.log('='.repeat(92));

interface TestRecord {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL';
  detail?: string;
}

const testResults: TestRecord[] = [];

function runTest(id: string, name: string, fn: () => void): void {
  console.log(`\n[${id}] ${name}...`);
  try {
    fn();
    testResults.push({ id, name, status: 'PASS' });
    console.log(`  -> PASS: [${id}] ${name}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    testResults.push({ id, name, status: 'FAIL', detail: msg });
    console.log(`  -> FAIL: [${id}] ${name}`);
    console.log(`     Reason: ${msg}`);
  }
}

// -------------------------------------------------------------------------------------------------
// [DECOUPLE-T1] Stable Node Phase Assignment & Interleaved Round-Robin Budget
// -------------------------------------------------------------------------------------------------
runTest('DECOUPLE-T1', 'Stable Node Phase Assignment & Interleaved Round-Robin Budget (Production Method)', () => {
  const tiers = [16, 32, 64, 128];
  const lookaheadIntervalFrames = 5; // 10 Hz at 50 Hz physics

  for (const nodeCount of tiers) {
    const phaseHistogram = new Array(lookaheadIntervalFrames).fill(0);
    const nodeIds = Array.from({ length: nodeCount }, (_, i) => i);

    // Call production method directly: PredictiveLookAheadEngine.getNodeLookaheadPhase
    const assignedPhases = new Map<number, number>();
    for (const nid of nodeIds) {
      const phase = PredictiveLookAheadEngine.getNodeLookaheadPhase(nid, lookaheadIntervalFrames);
      assignedPhases.set(nid, phase);
      phaseHistogram[phase]++;
    }

    // Ceiling quota: no phase can exceed ceil(N / 5)
    const maxQuota = Math.ceil(nodeCount / lookaheadIntervalFrames);
    for (let phase = 0; phase < lookaheadIntervalFrames; phase++) {
      assert.ok(
        phaseHistogram[phase] <= maxQuota,
        `Tier ${nodeCount}: phase ${phase} assigned ${phaseHistogram[phase]} nodes, exceeding ceiling quota ${maxQuota}`
      );
      assert.ok(
        phaseHistogram[phase] >= Math.floor(nodeCount / lookaheadIntervalFrames),
        `Tier ${nodeCount}: phase ${phase} assigned ${phaseHistogram[phase]} nodes, below floor quota`
      );
    }

    // Mutation Invariance Check:
    // Shuffle the node list, insert non-contiguous IDs, and reverse array order.
    // The phase of each node MUST remain invariant because it is computed from stable nodeId.
    const nonContiguousIds = [0, 4, 15, 99, 1024];
    for (const nid of nonContiguousIds) {
      const p1 = PredictiveLookAheadEngine.getNodeLookaheadPhase(nid, lookaheadIntervalFrames);
      const p2 = PredictiveLookAheadEngine.getNodeLookaheadPhase(nid, lookaheadIntervalFrames);
      assert.equal(p1, p2, `Node ${nid} phase must be purely deterministic`);
      assert.ok(p1 >= 0 && p1 < lookaheadIntervalFrames, `Node ${nid} phase ${p1} must be in [0, ${lookaheadIntervalFrames - 1}]`);
    }

    const shuffled = [...nodeIds].reverse();
    for (const nid of shuffled) {
      const stablePhase = PredictiveLookAheadEngine.getNodeLookaheadPhase(nid, lookaheadIntervalFrames);
      assert.equal(
        assignedPhases.get(nid),
        stablePhase,
        `Node ${nid} phase must remain invariant to array mutation/reordering`
      );
    }
  }
});

// -------------------------------------------------------------------------------------------------
// [DECOUPLE-T2] Lookahead Evaluation Rate Decoupling (10 Hz Interleaved vs 50 Hz Reference)
// -------------------------------------------------------------------------------------------------
runTest('DECOUPLE-T2', 'Lookahead Evaluation Rate Decoupling (10 Hz Interleaved vs 50 Hz Reference)', () => {
  // Test Candidate 10 Hz Decoupled Engine
  const simCandidate = new SimulationWorkerManager(101);
  assert.equal(simCandidate.lookaheadCadenceHz, 10, 'Default lookahead cadence must be 10 Hz');
  assert.equal(simCandidate.lookaheadIntervalFrames, 5, 'Default lookahead interval must be 5 frames');

  let candidateCallCount = 0;
  const origCandidateEval = simCandidate.lookaheadEngine.evaluatePredictiveState.bind(simCandidate.lookaheadEngine);
  simCandidate.lookaheadEngine.evaluatePredictiveState = (nodePos, t, obs) => {
    candidateCallCount++;
    return origCandidateEval(nodePos, t, obs);
  };

  const testFrames = 50;
  for (let f = 0; f < testFrames; f++) {
    simCandidate.tickSimulation(false);
  }

  console.log(`     Measured 10 Hz candidate lookahead calls over ${testFrames} frames: ${candidateCallCount}`);
  // In 10 Hz interleaved mode: ceil(16/5) = 4 nodes per frame * 50 frames = 160-170 calls (allowing cold cache on f=0)
  assert.ok(
    candidateCallCount <= 200,
    `Candidate engine evaluated ${candidateCallCount} lookaheads, expected <= 200 (10 Hz decoupled target)`
  );

  // Test Independent 50 Hz Reference Engine
  const simRef = new SimulationWorkerManager(101);
  simRef.setLookaheadCadence(50);
  assert.equal(simRef.lookaheadCadenceHz, 50, 'Reference cadence must be 50 Hz');
  assert.equal(simRef.lookaheadIntervalFrames, 1, 'Reference interval must be 1 frame');

  let refCallCount = 0;
  const origRefEval = simRef.lookaheadEngine.evaluatePredictiveState.bind(simRef.lookaheadEngine);
  simRef.lookaheadEngine.evaluatePredictiveState = (nodePos, t, obs) => {
    refCallCount++;
    return origRefEval(nodePos, t, obs);
  };

  for (let f = 0; f < testFrames; f++) {
    simRef.tickSimulation(false);
  }

  console.log(`     Measured 50 Hz reference lookahead calls over ${testFrames} frames: ${refCallCount}`);
  assert.equal(
    refCallCount,
    800,
    `Reference engine must evaluate exactly 800 lookaheads over 50 frames (16 nodes * 50 frames)`
  );

  const speedupFactor = refCallCount / Math.max(1, candidateCallCount);
  console.log(`     Decoupling Workload Reduction: ${speedupFactor.toFixed(2)}x fewer raycasts`);
  assert.ok(speedupFactor >= 4.0, `Expected at least 4.0x lookahead raycast reduction, achieved ${speedupFactor.toFixed(2)}x`);
});

// -------------------------------------------------------------------------------------------------
// [DECOUPLE-T3] Monotonic Elapsed-Time Propagation & FSM Transitions (Production Method)
// -------------------------------------------------------------------------------------------------
runTest('DECOUPLE-T3', 'Monotonic Elapsed-Time Propagation & FSM Transitions (Production Method)', () => {
  const sim = new SimulationWorkerManager(202);
  const lookaheadEngine = sim.lookaheadEngine;

  // Test case A: Pre-occlusion threshold crossing on an intervening frame using production reconcilePredictiveState
  const initialLosState: PredictiveState = {
    currentState: NodeTerrainState.NORMAL_LOS,
    timeToOcclusionS: 3.05,
    timeToEmergenceS: 0.0,
    fresnelClearanceM: 14.5,
    fresnelRateOfChangeMps: -1.0,
    predictedOutageDurationS: 5.0,
  };

  const clearObs: TerrainObstruction = {
    minClearanceM: 14.2,
    fresnelRadiusM: 8.0,
    diffractionLossDb: 0.0,
    isLos: true,
    isCoverageComplete: true,
    obstacleBlocked: false,
    obstacleIntersections: [],
  };

  // Frame 1 (dt = 0.02s): T_occ = 3.03s (> 3.0s => NORMAL_LOS)
  const f1 = lookaheadEngine.reconcilePredictiveState(initialLosState, 0.02, clearObs);
  assert.equal(f1.currentState, NodeTerrainState.NORMAL_LOS);
  assert.ok(Math.abs(f1.timeToOcclusionS - 3.03) < 1e-6);

  // Frame 2 (dt = 0.04s): T_occ = 3.01s (> 3.0s => NORMAL_LOS)
  const f2 = lookaheadEngine.reconcilePredictiveState(initialLosState, 0.04, clearObs);
  assert.equal(f2.currentState, NodeTerrainState.NORMAL_LOS);
  assert.ok(Math.abs(f2.timeToOcclusionS - 3.01) < 1e-6);

  // Frame 3 (dt = 0.06s): T_occ = 2.99s (<= 3.0s => Transitions to PRE_OCCLUSION_FLUSH on intervening frame!)
  const f3 = lookaheadEngine.reconcilePredictiveState(initialLosState, 0.06, clearObs);
  assert.equal(
    f3.currentState,
    NodeTerrainState.PRE_OCCLUSION_FLUSH,
    'Intervening frame at dt=0.06s must transition to PRE_OCCLUSION_FLUSH'
  );
  assert.ok(Math.abs(f3.timeToOcclusionS - 2.99) < 1e-6);

  // Test case B: Re-emergence threshold crossing on an intervening frame
  const initialShadowState: PredictiveState = {
    currentState: NodeTerrainState.HARD_SHADOW_CUTOFF,
    timeToOcclusionS: 0.0,
    timeToEmergenceS: 1.05,
    fresnelClearanceM: -25.0,
    fresnelRateOfChangeMps: 2.0,
    predictedOutageDurationS: 1.05,
  };

  const blockedObs: TerrainObstruction = {
    minClearanceM: -24.0,
    fresnelRadiusM: 8.0,
    diffractionLossDb: 35.0,
    isLos: false,
    isCoverageComplete: true,
    obstacleBlocked: false,
    obstacleIntersections: [],
  };

  // Frame 1 (dt = 0.02s): T_em = 1.03s (> 1.0s => HARD_SHADOW_CUTOFF)
  const sf1 = lookaheadEngine.reconcilePredictiveState(initialShadowState, 0.02, blockedObs);
  assert.equal(sf1.currentState, NodeTerrainState.HARD_SHADOW_CUTOFF);

  // Frame 3 (dt = 0.06s): T_em = 0.99s (<= 1.0s => Transitions to RE_EMERGENCE_BURST on intervening frame!)
  const sf3 = lookaheadEngine.reconcilePredictiveState(initialShadowState, 0.06, blockedObs);
  assert.equal(
    sf3.currentState,
    NodeTerrainState.RE_EMERGENCE_BURST,
    'Intervening frame at dt=0.06s must transition to RE_EMERGENCE_BURST'
  );
  assert.ok(Math.abs(sf3.timeToEmergenceS - 0.99) < 1e-6);
});

// -------------------------------------------------------------------------------------------------
// [DECOUPLE-T4] Ground-Truth Reconciliation & Transmission Prevention (ActiveTransferManager + Scheduler)
// -------------------------------------------------------------------------------------------------
runTest('DECOUPLE-T4', 'Ground-Truth Reconciliation & Transmission Prevention Invariants', () => {
  const sim = new SimulationWorkerManager(303);
  const node = sim.nodesTac[0];
  const scheduler = sim.tacScheduler;
  const transferManager = sim.transferManager;

  // 1. Physically blocked obstruction setup
  const blockedObstruction: TerrainObstruction = {
    minClearanceM: -50.0,
    fresnelRadiusM: 10.0,
    diffractionLossDb: 60.0,
    isLos: false,
    isCoverageComplete: true,
    obstacleBlocked: false,
    obstacleIntersections: [],
  };

  const blockedLink = sim.linkEngine.evaluateLink(node.nodeType, 20000, 60.0, sim.rfConfig, sim.envConfig, false);
  assert.equal(blockedLink.isOutage, true, 'Physically blocked link must have isOutage=true');

  // Inject traffic into node 0
  node.injectTraffic('SOS', 0.0);
  assert.ok(node.queue.getTotalBacklogBytes() > 0, 'Node must have backlogged packets');

  // Register and start an active transfer on node 0
  transferManager.registerNode(node.nodeId);
  transferManager.startTransfer(node.nodeId, 'SOS', 2560, 0.0, false);
  let trans = transferManager.getNodeTransferState(node.nodeId)!;
  assert.equal(trans.status, 'TRANSMITTING', 'Transfer should be in TRANSMITTING status initially');

  // Predictive state indicates imminent re-emergence (RE_EMERGENCE_BURST, T_em = 0.5s)
  const burstPredState: PredictiveState = {
    currentState: NodeTerrainState.RE_EMERGENCE_BURST,
    timeToOcclusionS: 0.0,
    timeToEmergenceS: 0.5,
    fresnelClearanceM: -5.0,
    fresnelRateOfChangeMps: 10.0,
    predictedOutageDurationS: 0.5,
  };

  const linkMap = new Map([[node.nodeId, blockedLink]]);
  const predMap = new Map([[node.nodeId, burstPredState]]);

  // Execute ActiveTransferManager step
  transferManager.step({
    activeNodes: [node],
    linkStatuses: linkMap,
    predStates: predMap,
    activeReport: null,
    simTimeS: 0.02,
    isPaused: false,
  });

  trans = transferManager.getNodeTransferState(node.nodeId)!;
  // CRITICAL REQUIREMENT 6: Physical link is in outage; transfer MUST pause into BLOCKED_NLOS
  // and must NOT resume merely because predictive state is RE_EMERGENCE_BURST!
  assert.equal(
    trans.status,
    'BLOCKED_NLOS',
    'ActiveTransferManager MUST pause to BLOCKED_NLOS when physical link is in outage, even during RE_EMERGENCE_BURST'
  );

  // Now execute scheduler step
  const report = scheduler.scheduleFrame(0, 0.0, [node], linkMap, predMap);

  // Assert ZERO airtime was scheduled and ZERO bits were transmitted
  const alloc = report.allocations.find(a => a.nodeId === node.nodeId);
  assert.equal(alloc, undefined, 'Physically blocked node MUST NOT receive any slot allocation during RE_EMERGENCE_BURST');
  assert.equal(report.totalBitsTransmitted, 0, 'Zero bits must be transmitted on physically blocked link');
  assert.equal(report.totalBitsWastedOnOutage, 0, 'Zero bits wasted on outage by Tac-TAD');

  // Verify Safe Resumption once link physically clears
  const clearLink = sim.linkEngine.evaluateLink(node.nodeType, 20000, 0.0, sim.rfConfig, sim.envConfig, false);
  assert.equal(clearLink.isOutage, false, 'Clear link must not be in outage');
  const clearPredState: PredictiveState = {
    currentState: NodeTerrainState.NORMAL_LOS,
    timeToOcclusionS: 10.0,
    timeToEmergenceS: 0.0,
    fresnelClearanceM: 20.0,
    fresnelRateOfChangeMps: 0.0,
    predictedOutageDurationS: 0.0,
  };
  const clearLinkMap = new Map([[node.nodeId, clearLink]]);
  const clearPredMap = new Map([[node.nodeId, clearPredState]]);

  transferManager.step({
    activeNodes: [node],
    linkStatuses: clearLinkMap,
    predStates: clearPredMap,
    activeReport: null,
    simTimeS: 0.04,
    isPaused: false,
  });

  trans = transferManager.getNodeTransferState(node.nodeId)!;
  assert.equal(trans.status, 'TRANSMITTING', 'Transfer should safely resume once physical link is clear');
});

// -------------------------------------------------------------------------------------------------
// [DECOUPLE-T5] Real Cache Invalidation Hierarchy & Multi-Node Safety
// -------------------------------------------------------------------------------------------------
runTest('DECOUPLE-T5', 'Real Cache Invalidation Hierarchy & Multi-Node Safety', () => {
  const sim = new SimulationWorkerManager(404);

  // Tick simulation once to populate the lookahead cache
  sim.tickSimulation(false);
  assert.ok(sim.lookaheadEngine.getCacheSize() > 0, 'Cache must be populated after simulation tick');

  // Invalidation Trigger 1: NODE_UPDATE (per-node eviction & live re-evaluation)
  assert.ok(sim.lookaheadEngine.getCachedEntry(2) !== undefined, 'Node 2 must be present in cache');
  const entryBefore = sim.lookaheadEngine.getCachedEntry(2)!;
  const revBefore = entryBefore.spatialRevision;

  // Direct invalidation test
  sim.lookaheadEngine.invalidateNode(2);
  assert.equal(
    sim.lookaheadEngine.getCachedEntry(2),
    undefined,
    'Direct invalidateNode must evict node from lookahead cache'
  );

  // Message invalidation test: NODE_UPDATE updates position, evicts previous cache, and refreshes cache with new revision and coords
  sim.handleMessage({ type: 'NODE_UPDATE', node_id: 2, x_m: 1500, y_m: 2500 });
  const entryAfter = sim.lookaheadEngine.getCachedEntry(2)!;
  assert.ok(entryAfter !== undefined, 'Node 2 must be refreshed in cache after NODE_UPDATE');
  assert.ok(entryAfter.spatialRevision > revBefore, 'Spatial revision must advance after NODE_UPDATE');
  assert.equal(entryAfter.nodePosition[0], 1500, 'Cache must reflect updated X coordinate');
  assert.equal(entryAfter.nodePosition[1], 2500, 'Cache must reflect updated Y coordinate');

  // Invalidation Trigger 2: CONFIG_UPDATE affecting flight kinematics (global cache flush)
  sim.tickSimulation(false);
  assert.ok(sim.lookaheadEngine.getCacheSize() > 0, 'Cache must repopulate on next tick');
  const oldEngine = sim.lookaheadEngine;
  sim.handleMessage({ type: 'CONFIG_UPDATE', params: { loiter_speed_mps: 85.0 } });
  assert.notEqual(
    sim.lookaheadEngine,
    oldEngine,
    'Trajectory CONFIG_UPDATE must replace the lookahead engine instance'
  );
  assert.equal(sim.flightConfig.loiterSpeedMps, 85.0);

  // Invalidation Trigger 3: OBSTACLES_REPLACE (topological invalidation)
  sim.tickSimulation(false);
  const revBeforeObs = sim.spatialRevision;
  sim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [] });
  assert.ok(sim.spatialRevision > revBeforeObs, 'OBSTACLES_REPLACE must advance spatialRevision');

  // Invalidation Trigger 4: Simulation Reset
  sim.tickSimulation(false);
  sim.resetSimulationState();
  assert.equal(sim.lookaheadEngine.getCacheSize(), 0, 'Simulation reset must completely clear cache');
  assert.equal(sim.frameIndex, 0, 'Simulation reset must restore frameIndex to 0');
});

// -------------------------------------------------------------------------------------------------
// [DECOUPLE-T6] Emergency Discrepancy Refreshes & Bounded Execution Budget (Production Dispatcher)
// -------------------------------------------------------------------------------------------------
runTest('DECOUPLE-T6', 'Emergency Discrepancy Refreshes & Bounded Execution Budget (16, 32, 64, 128 nodes)', () => {
  const tiers = [16, 32, 64, 128];

  for (const nodeCount of tiers) {
    const sim = new SimulationWorkerManager(606);
    // Expand nodes to tier size using production NODE_ADD
    for (let i = 16; i < nodeCount; i++) {
      const res = sim.handleMessage({
        type: 'NODE_ADD',
        x_m: (i % 10) * 1000 - 5000,
        y_m: Math.floor(i / 10) * 1000 - 5000,
        agl_m: 2.0,
      });
      assert.ok(res.accepted, `NODE_ADD must succeed for node ${i}`);
    }

    assert.equal(sim.nodesTac.length, nodeCount, `Must instantiate exact tier count ${nodeCount}`);

    // Track lookahead calls during an intentional simultaneous emergency across ALL nodes
    let singleFrameLookaheadCalls = 0;
    const origEval = sim.lookaheadEngine.evaluatePredictiveState.bind(sim.lookaheadEngine);
    sim.lookaheadEngine.evaluatePredictiveState = (nodePos, t, obs) => {
      singleFrameLookaheadCalls++;
      return origEval(nodePos, t, obs);
    };

    // Cold tick: simulate unexpected invalidation of all nodes
    sim.lookaheadEngine.invalidateAll();
    sim.tickSimulation(false);

    const normalQuota = Math.ceil(nodeCount / 5);
    const emergencyBudgetMax = normalQuota;
    const maxAllowedCeiling = normalQuota + emergencyBudgetMax;

    console.log(`     Tier ${nodeCount}: Single-frame lookaheads = ${singleFrameLookaheadCalls} (Allowed Ceiling = ${maxAllowedCeiling})`);

    // Strict Budget Invariant: Total lookaheads executed in a single frame MUST NOT exceed maxAllowedCeiling
    assert.ok(
      singleFrameLookaheadCalls <= maxAllowedCeiling,
      `Tier ${nodeCount}: Single-frame execution (${singleFrameLookaheadCalls}) exceeded strict budget ceiling (${maxAllowedCeiling})`
    );
  }
});

// -------------------------------------------------------------------------------------------------
// [DECOUPLE-T7] Comparative Tactical Equivalence (Independent 50 Hz Reference vs 10 Hz Candidate)
// -------------------------------------------------------------------------------------------------
runTest('DECOUPLE-T7', 'Comparative Tactical Equivalence Against Independent 50 Hz Reference', () => {
  const demArray = new Float32Array(realDemBuffer.buffer, realDemBuffer.byteOffset, 512 * 512);

  // 1. Independent 50 Hz Reference Instance
  const simRef = new SimulationWorkerManager(505);
  simRef.terrainEngine.loadCustomDem(demArray);
  simRef.setLookaheadCadence(50);
  assert.equal(simRef.lookaheadCadenceHz, 50);

  // 2. Independent 10 Hz Decoupled Candidate Instance
  const simOpt = new SimulationWorkerManager(505);
  simOpt.terrainEngine.loadCustomDem(demArray);
  simOpt.setLookaheadCadence(10);
  assert.equal(simOpt.lookaheadCadenceHz, 10);

  // Inject identical tactical traffic into node 4 (traverses Mt. Kargil shadow)
  for (const sim of [simRef, simOpt]) {
    const n4 = sim.nodesTac.find(n => n.nodeId === 4);
    if (n4) {
      n4.injectTraffic('VIDEO', 0.0);
      n4.injectTraffic('PHOTO', 0.0);
    }
  }

  const runFrames = 100;
  for (let f = 0; f < runFrames; f++) {
    simRef.tickSimulation(false);
    simOpt.tickSimulation(false);
  }

  const mRef = simRef.metrics;
  const mOpt = simOpt.metrics;

  console.log(`     Reference (50 Hz): Tac Goodput = ${Math.round(mRef.tacGoodputBits)} bits, Drops = ${mRef.tacDroppedPkts}`);
  console.log(`     Candidate (10 Hz): Tac Goodput = ${Math.round(mOpt.tacGoodputBits)} bits, Drops = ${mOpt.tacDroppedPkts}`);

  const goodputDeltaRel = Math.abs(mRef.tacGoodputBits - mOpt.tacGoodputBits) / Math.max(1, mRef.tacGoodputBits);
  console.log(`     Goodput Relative Delta: ${(goodputDeltaRel * 100).toFixed(4)}% (Acceptance Tolerance: <= 1.0%)`);
  assert.ok(goodputDeltaRel <= 0.01, `Goodput delta exceeds 1.0% acceptance tolerance`);

  const dropDeltaAbs = Math.abs(mRef.tacDroppedPkts - mOpt.tacDroppedPkts);
  console.log(`     Packet Drop Delta: ${dropDeltaAbs} packets`);
  assert.ok(dropDeltaAbs <= 5, `Packet drop delta exceeds tolerance`);

  assert.equal(mRef.tacWastedBits, 0, 'Reference mode must waste 0 bits in Tac-TAD');
  assert.equal(mOpt.tacWastedBits, 0, 'Candidate mode must waste 0 bits in Tac-TAD');
});

// -------------------------------------------------------------------------------------------------
// [DECOUPLE-T8] Independent Replay Determinism Within Both Modes
// -------------------------------------------------------------------------------------------------
runTest('DECOUPLE-T8', 'Independent Replay Determinism Within Both Modes', () => {
  // Mode 1: 10 Hz Decoupled Replay Determinism
  const sim10A = new SimulationWorkerManager(777);
  sim10A.setLookaheadCadence(10);
  const sim10B = new SimulationWorkerManager(777);
  sim10B.setLookaheadCadence(10);

  const testFrames = 50;
  for (let f = 0; f < testFrames; f++) {
    sim10A.tickSimulation(false);
    sim10B.tickSimulation(false);

    const hashA = computeCanonicalStateHash(sim10A);
    const hashB = computeCanonicalStateHash(sim10B);
    assert.equal(hashA, hashB, `10 Hz Replay: State hash mismatch at frame ${f}: ${hashA} !== ${hashB}`);
  }
  console.log('     10 Hz Decoupled Mode: 50/50 frames produced bit-identical SHA-256 state hashes.');

  // Mode 2: 50 Hz Reference Replay Determinism
  const sim50A = new SimulationWorkerManager(777);
  sim50A.setLookaheadCadence(50);
  const sim50B = new SimulationWorkerManager(777);
  sim50B.setLookaheadCadence(50);

  for (let f = 0; f < testFrames; f++) {
    sim50A.tickSimulation(false);
    sim50B.tickSimulation(false);

    const hashC = computeCanonicalStateHash(sim50A);
    const hashD = computeCanonicalStateHash(sim50B);
    assert.equal(hashC, hashD, `50 Hz Replay: State hash mismatch at frame ${f}: ${hashC} !== ${hashD}`);
  }
  console.log('     50 Hz Reference Mode: 50/50 frames produced bit-identical SHA-256 state hashes.');
});

// -------------------------------------------------------------------------------------------------
// Summary Report
// -------------------------------------------------------------------------------------------------
console.log('\n' + '='.repeat(92));
console.log('   M1 VERIFICATION SUITE EXECUTION SUMMARY');
console.log('='.repeat(92));

let passedCount = 0;
let failedCount = 0;

for (const t of testResults) {
  const statusStr = t.status === 'PASS' ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${statusStr.padEnd(8)} [${t.id}] ${t.name}`);
  if (t.detail) {
    console.log(`           ${t.detail}`);
  }
  if (t.status === 'PASS') passedCount++;
  else failedCount++;
}

console.log('='.repeat(92));
console.log(`Total Suites: ${testResults.length} | Passed: ${passedCount} | Failed: ${failedCount}`);
console.log('='.repeat(92));

if (failedCount > 0) {
  process.exitCode = 1;
}
