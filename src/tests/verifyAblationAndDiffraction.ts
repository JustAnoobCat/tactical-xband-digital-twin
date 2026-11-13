/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Diffraction Scheduling & Ablation Baseline Verification Suite
 *
 * Verifies:
 * - ABL-T1: Diffracted link scheduling & hard shadow reconciliation (reconciling RF outage vs optical occlusion)
 * - ABL-T2: Paired 1000-frame benchmark check (tacDelayDrops < staticDelayDrops and tacGoodput > staticGoodput)
 * - ABL-T3: 3-way ablation comparison (Tac-TAD vs Reactive M-LWDF vs Static TDMA, isolating Phi_evac)
 * - ABL-T4: First-principles SRTM DEM lookahead vertical uncertainty (sigma_DEM deterministic harmonic perturbation)
 *
 * Execution:
 *   npx vite-node src/tests/verifyAblationAndDiffraction.ts
 */

import { fileURLToPath } from 'node:url';
import {
  EnvironmentConfig,
  RFConfig,
  ACNFlightConfig,
} from '../core/config';
import { LinkBudgetEngine, LinkStatus } from '../core/linkBudget';
import { TerrainEngine, TerrainObstruction } from '../core/terrain';
import {
  NodeTerrainState,
  PredictiveLookAheadEngine,
  PredictiveState,
} from '../core/trajectory';
import {
  LegacyStaticScheduler,
  ReactiveMlwdfScheduler,
  TerrainAwareDynamicScheduler,
} from '../core/scheduler';
import { GroundNodeTrafficSubsystem } from '../core/queues';
import { SimulationWorkerManager } from '../worker/simWorker';

interface DiagnosticResult {
  readonly testId: string;
  readonly testName: string;
  readonly measured: string;
  readonly expected: string;
  readonly passed: boolean;
}

export function runAblationAndDiffractionVerification(): boolean {
  const rf = new RFConfig();
  const env = new EnvironmentConfig();
  const terrain = new TerrainEngine();
  const linkEngine = new LinkBudgetEngine();
  const flight = new ACNFlightConfig();

  const results: DiagnosticResult[] = [];

  // ========================================================================
  // ABL-T1: Diffracted Link Scheduling & Hard Shadow Reconciliation
  // ========================================================================
  const lookahead = new PredictiveLookAheadEngine(terrain, linkEngine, rf, env, flight);
  const diffractedObs: TerrainObstruction = {
    isLos: false,
    diffractionLossDb: 18.5,
    minClearanceM: -15.0,
    minClearanceRatio: -0.8,
    obstacleBlocked: false,
    crestRadiusM: 100.0,
    curvatureLossDb: 6.2,
    isHardShadow: true,
  };

  const cachedPred: PredictiveState = {
    currentState: NodeTerrainState.HARD_SHADOW_CUTOFF,
    timeToOcclusionS: 0.0,
    timeToEmergenceS: 10.0,
    fresnelClearanceM: -15.0,
    fresnelRateOfChangeMps: 0.0,
    predictedOutageDurationS: 10.0,
  };

  // Mock a working diffracted link status (e.g. QPSK 1/4 closes above SNR threshold)
  const workingLinkStatus: LinkStatus = {
    distanceKm: 25.0,
    slantRangeM: 25000.0,
    rxPowerDbm: -92.0,
    pNoiseDbm: -101.5,
    snrDb: 9.5,
    requiredSnrDb: 6.4,
    snrMarginDb: 3.1,
    modcodName: 'QPSK_3/4',
    spectralEfficiency: 1.49,
    bitrateBps: 1.49e6,
    bitrateMbps: 1.49,
    isOutage: false,
    fsplDb: 139.8,
    diffractionLossDb: 18.5,
    gasLossDb: 0.3,
    rainLossDb: 0.0,
    totalLossDb: 158.6,
    obstacleBlocked: false,
  };

  // Mock an outage link status (e.g. severe blockage, SNR below threshold)
  const outageLinkStatus: LinkStatus = {
    ...workingLinkStatus,
    rxPowerDbm: -115.0,
    snrDb: -13.5,
    isOutage: true,
    bitrateBps: 0,
    bitrateMbps: 0,
    modcodName: 'LINK_OUTAGE',
  };

  // 1. When workingLinkStatus is passed, isHardShadow must reconcile to false
  const reconciledWorking = lookahead.reconcilePredictiveState(
    cachedPred,
    0.020,
    diffractedObs,
    workingLinkStatus
  );

  // 2. When outageLinkStatus is passed, isHardShadow must reconcile to true
  const reconciledOutage = lookahead.reconcilePredictiveState(
    cachedPred,
    0.020,
    diffractedObs,
    outageLinkStatus
  );

  // 3. Test that Tac-TAD schedules the working diffracted node
  const testNode = new GroundNodeTrafficSubsystem(15, 'soldier', [5000, 5000, 3600], 42);
  testNode.enqueuePacket(69, 0.0, 128);
  testNode.enqueuePacket(65, 0.0, 256);

  const scheduler = new TerrainAwareDynamicScheduler(0.008);
  const singleSectorReport = scheduler.scheduleFrame(
    0,
    0.0,
    [testNode],
    new Map([[15, workingLinkStatus]]),
    new Map([[15, reconciledWorking]])
  );

  const t1Passed =
    reconciledWorking.isHardShadow === false &&
    reconciledOutage.isHardShadow === true &&
    singleSectorReport.allocations.length === 1 &&
    singleSectorReport.allocations[0].nodeId === 15 &&
    singleSectorReport.allocations[0].durationS > 0;

  results.push({
    testId: 'ABL-T1',
    testName: 'Diffracted Link Scheduling & Hard Shadow Reconciliation',
    measured: `working isHardShadow=${reconciledWorking.isHardShadow}, outage isHardShadow=${reconciledOutage.isHardShadow}, allocs=${singleSectorReport.allocations.length}`,
    expected: 'working isHardShadow=false, outage isHardShadow=true, allocs=1',
    passed: t1Passed,
  });

  // ========================================================================
  // ABL-T2: Paired 1000-Frame Benchmark Verification (Tac vs Static)
  // ========================================================================
  const benchmarkManager = new SimulationWorkerManager(1300 * 100_000);
  benchmarkManager.terrainEngine.setTerrainMode('synthetic');
  benchmarkManager.isPaused = true;

  const benchmarkFrames = 1000;
  for (let i = 0; i < benchmarkFrames; i++) {
    benchmarkManager.tickSimulation();
  }

  const bmMetrics = benchmarkManager.metrics;
  const tacDelayDrops = bmMetrics.tacDelayDropsThisRun;
  const staticDelayDrops = bmMetrics.staticDelayDropsThisRun;
  const tacGoodput = bmMetrics.tacGoodputBits;
  const staticGoodput = bmMetrics.staticGoodputBits;

  const t2Passed = tacDelayDrops < staticDelayDrops && tacGoodput > staticGoodput;
  results.push({
    testId: 'ABL-T2',
    testName: '1000-Frame Paired Benchmark (Tac-TAD vs Static)',
    measured: `Tac delay drops=${tacDelayDrops}, Static delay drops=${staticDelayDrops} | Tac goodput=${(tacGoodput / 1e6).toFixed(2)}Mb, Static goodput=${(staticGoodput / 1e6).toFixed(2)}Mb`,
    expected: 'tacDelayDrops < staticDelayDrops AND tacGoodput > staticGoodput',
    passed: t2Passed,
  });

  // ========================================================================
  // ABL-T3: 3-Way Ablation Comparison (Tac vs Reactive M-LWDF vs Static)
  // ========================================================================
  const reactiveScheduler = new ReactiveMlwdfScheduler(0.008);
  const tacScheduler = new TerrainAwareDynamicScheduler(0.008);
  const staticScheduler = new LegacyStaticScheduler();

  const isReactiveLookaheadDisabled = !reactiveScheduler.enablePredictiveLookahead;
  const isTacLookaheadEnabled = tacScheduler.enablePredictiveLookahead;
  const reactiveSchedulerNameCorrect = reactiveScheduler.schedulerName === 'Reactive_M_LWDF';

  // Construct a pre-occlusion flush state for a test node
  const preFlushPred: PredictiveState = {
    currentState: NodeTerrainState.PRE_OCCLUSION_FLUSH,
    timeToOcclusionS: 1.0,
    timeToEmergenceS: 0.0,
    fresnelClearanceM: 5.0,
    fresnelRateOfChangeMps: -2.0,
    predictedOutageDurationS: 8.0,
    isHardShadow: false,
  };

  const nodeFlush = new GroundNodeTrafficSubsystem(2, 'soldier', [2000, 2000, 3600], 101);
  nodeFlush.enqueuePacket(70, 0.0, 1400);

  const reportTacFlush = tacScheduler.scheduleFrame(
    0,
    0.0,
    [nodeFlush],
    new Map([[2, workingLinkStatus]]),
    new Map([[2, preFlushPred]])
  );

  const nodeReactive = new GroundNodeTrafficSubsystem(2, 'soldier', [2000, 2000, 3600], 101);
  nodeReactive.enqueuePacket(70, 0.0, 1400);

  const reportReactiveFlush = reactiveScheduler.scheduleFrame(
    0,
    0.0,
    [nodeReactive],
    new Map([[2, workingLinkStatus]]),
    new Map([[2, preFlushPred]])
  );

  const tacFlushFlag = reportTacFlush.allocations[0]?.isPreOcclusionFlush ?? false;
  const reactiveFlushFlag = reportReactiveFlush.allocations[0]?.isPreOcclusionFlush ?? false;

  const t3Passed =
    isReactiveLookaheadDisabled &&
    isTacLookaheadEnabled &&
    reactiveSchedulerNameCorrect &&
    tacFlushFlag === true &&
    reactiveFlushFlag === false;

  results.push({
    testId: 'ABL-T3',
    testName: '3-Way Ablation Comparison (Tac-TAD vs Reactive M-LWDF vs Static)',
    measured: `reactiveLookaheadDisabled=${isReactiveLookaheadDisabled}, name=${reactiveScheduler.schedulerName}, tacFlush=${tacFlushFlag}, reactiveFlush=${reactiveFlushFlag}`,
    expected: 'reactiveLookaheadDisabled=true, name=Reactive_M_LWDF, tacFlush=true, reactiveFlush=false',
    passed: t3Passed,
  });

  // ========================================================================
  // ABL-T4: SRTM DEM Vertical Lookahead Uncertainty (sigma_DEM)
  // ========================================================================
  const txPos: [number, number, number] = [0.0, 0.0, 3600.0];
  const rxPos: [number, number, number] = [20000.0, 15000.0, 5000.0];

  const obsUnperturbed1 = terrain.evaluateTerrainObstruction(txPos, rxPos, rf, env, 100.0, 0.0);
  const obsUnperturbed2 = terrain.evaluateTerrainObstruction(txPos, rxPos, rf, env, 100.0, 0.0);
  const obsPerturbed1 = terrain.evaluateTerrainObstruction(txPos, rxPos, rf, env, 100.0, 8.0);
  const obsPerturbed2 = terrain.evaluateTerrainObstruction(txPos, rxPos, rf, env, 100.0, 8.0);

  // 1. Zero error std should be bit-for-bit identical across runs
  const isUnperturbedDeterministic = obsUnperturbed1.minClearanceM === obsUnperturbed2.minClearanceM;

  // 2. Perturbed run should be deterministic (same formula, zero random seeds)
  const isPerturbedDeterministic = obsPerturbed1.minClearanceM === obsPerturbed2.minClearanceM;

  // 3. Perturbed elevation profile must differ from unperturbed profile
  const isPerturbationEffective = Math.abs(obsPerturbed1.minClearanceM - obsUnperturbed1.minClearanceM) > 0.01;

  const t4Passed = isUnperturbedDeterministic && isPerturbedDeterministic && isPerturbationEffective;
  results.push({
    testId: 'ABL-T4',
    testName: 'SRTM DEM Lookahead Uncertainty (Deterministic Spatial Harmonic)',
    measured: `unperturbed=${obsUnperturbed1.minClearanceM.toFixed(3)}m, perturbed=${obsPerturbed1.minClearanceM.toFixed(3)}m (diff=${Math.abs(obsPerturbed1.minClearanceM - obsUnperturbed1.minClearanceM).toFixed(3)}m, deterministic=${isPerturbedDeterministic})`,
    expected: 'deterministic=true, perturbation diff > 0.01m',
    passed: t4Passed,
  });

  // ========================================================================
  // Summary & Diagnostics Output
  // ========================================================================
  console.log('\n================================================================================');
  console.log(' Tactical X-Band Digital Twin: Diffraction & Ablation Verification Suite');
  console.log('================================================================================');

  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    if (!r.passed) allPassed = false;
    console.log(`[${r.testId}] ${r.testName.padEnd(55)} [${status}]`);
    console.log(`       Measured: ${r.measured}`);
    console.log(`       Expected: ${r.expected}`);
  }

  console.log('================================================================================');
  console.log(`Overall Verdict: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  console.log('================================================================================\n');

  if (!allPassed) {
    throw new Error('Diffraction & ablation baseline verification failed.');
  }

  return allPassed;
}

// Execute diagnostics when invoked directly
runAblationAndDiffractionVerification();
