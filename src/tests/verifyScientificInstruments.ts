/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Scientific Instruments & 3-Way Ablation Verification Suite (SPEC-SCIENTIFIC-RF-AND-PROTOCOL-INSTRUMENTS)
 *
 * Verifies:
 * - SCI-T1: Full ITU-R Node Telemetry Serialization (crest_radius_m, curvature_loss_db, sky_temp_k, sky_noise_db, timing_advance_us, body_azimuth_deg, pattern_rolloff_db)
 * - SCI-T2: 3-Way Ablation Frame Telemetry (reactive_goodput_mbps, reactive_delay_drops, reactive_util_pct, reactive_sector_util_pct, static_*, tac_*)
 * - SCI-T3: Runtime SET_SCIENTIFIC_PARAMS & Congested Regime Separation (trafficLoadMultiplier >= 3.0: Tac-TAD achieves fewer drops or higher pre-occlusion delivery than Reactive M-LWDF)
 * - SCI-T4: DOM Instrument Presence (#polar-antenna-canvas, #link-waterfall-canvas, #sci-dem-error-slider, #sci-traffic-scale-select, ablation matrix IDs)
 *
 * Execution:
 *   npx vite-node src/tests/verifyScientificInstruments.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SimulationWorkerManager } from '../worker/simWorker';
import type { TelemetryFrameMessage, NodeTelemetryItem } from '../shared/workerProtocol';

interface DiagnosticResult {
  readonly testId: string;
  readonly testName: string;
  readonly measured: string;
  readonly expected: string;
  readonly passed: boolean;
}

export function runScientificInstrumentsVerification(): boolean {
  const results: DiagnosticResult[] = [];

  // ========================================================================
  // SCI-T1: Full ITU-R Node Telemetry Serialization
  // ========================================================================
  const sim = new SimulationWorkerManager(100_000);
  sim.terrainEngine.setTerrainMode('synthetic');
  sim.isPaused = true;

  // Step simulation for a few frames to populate RF links and antenna evaluations
  for (let i = 0; i < 10; i++) {
    sim.tickSimulation();
  }

  const framePayload = sim.buildTelemetryFrame([0, 0, 5000]);
  const nodes = framePayload.nodes_telemetry;

  let allNodesHaveItuParams = nodes.length > 0;
  let firstNodeSummary = '';

  for (const n of nodes) {
    const hasCrestRadius = typeof n.crest_radius_m === 'number' && Number.isFinite(n.crest_radius_m);
    const hasCurvatureLoss = typeof n.curvature_loss_db === 'number' && Number.isFinite(n.curvature_loss_db);
    const hasSkyTemp = typeof n.sky_temp_k === 'number' && Number.isFinite(n.sky_temp_k);
    const hasSkyNoise = typeof n.sky_noise_db === 'number' && Number.isFinite(n.sky_noise_db);
    const hasTimingAdvance = typeof n.timing_advance_us === 'number' && Number.isFinite(n.timing_advance_us);
    const hasBodyAzimuth = typeof n.body_azimuth_deg === 'number' && Number.isFinite(n.body_azimuth_deg);
    const hasPatternRolloff = typeof n.pattern_rolloff_db === 'number' && Number.isFinite(n.pattern_rolloff_db);

    if (!hasCrestRadius || !hasCurvatureLoss || !hasSkyTemp || !hasSkyNoise || !hasTimingAdvance || !hasBodyAzimuth || !hasPatternRolloff) {
      allNodesHaveItuParams = false;
      break;
    }
  }

  if (nodes.length > 0) {
    const n0 = nodes[0];
    firstNodeSummary = `N${n0.node_id}: R_crest=${n0.crest_radius_m}m, T_crest=${n0.curvature_loss_db}dB, T_sky=${n0.sky_temp_k}K, dN_sky=${n0.sky_noise_db}dB, tau_TA=${n0.timing_advance_us}us, az=${n0.body_azimuth_deg}deg, rolloff=${n0.pattern_rolloff_db}dB`;
  }

  results.push({
    testId: 'SCI-T1',
    testName: 'Full ITU-R Node Telemetry Serialization',
    measured: `allNodesHaveItuParams=${allNodesHaveItuParams} (count=${nodes.length}) | ${firstNodeSummary}`,
    expected: 'allNodesHaveItuParams=true across all ground nodes with finite numbers',
    passed: allNodesHaveItuParams,
  });

  // ========================================================================
  // SCI-T2: 3-Way Ablation Frame Telemetry
  // ========================================================================
  // Intercept emitted host message from worker
  let lastEmittedMsg: TelemetryFrameMessage | null = null;
  (sim as any).emitHostMessage = (msg: any) => {
    if (msg && msg.type === 'TELEMETRY_FRAME') {
      lastEmittedMsg = msg;
    }
  };

  sim.tickSimulation(true);

  const msg = lastEmittedMsg as TelemetryFrameMessage | null;
  const frame = msg?.frame;

  const hasReactiveGoodput = typeof (msg?.reactive_goodput_mbps ?? frame?.reactive_goodput_mbps) === 'number' &&
    Number.isFinite(msg?.reactive_goodput_mbps ?? frame?.reactive_goodput_mbps);
  const hasReactiveDelayDrops = typeof (msg?.reactive_delay_drops ?? frame?.reactive_delay_drops) === 'number' &&
    Number.isFinite(msg?.reactive_delay_drops ?? frame?.reactive_delay_drops);
  const hasReactiveUtil = typeof (msg?.reactive_util_pct ?? frame?.reactive_util_pct) === 'number' &&
    Number.isFinite(msg?.reactive_util_pct ?? frame?.reactive_util_pct);
  const hasReactiveSectorUtil = Array.isArray(msg?.reactive_sector_util_pct ?? frame?.reactive_sector_util_pct) &&
    (msg?.reactive_sector_util_pct ?? frame?.reactive_sector_util_pct)!.length === 4;

  const hasStaticGoodput = typeof (msg?.static_goodput_mbps ?? frame?.static_goodput_mbps) === 'number' &&
    Number.isFinite(msg?.static_goodput_mbps ?? frame?.static_goodput_mbps);
  const hasTacGoodput = typeof (msg?.tac_goodput_mbps ?? frame?.tac_goodput_mbps) === 'number' &&
    Number.isFinite(msg?.tac_goodput_mbps ?? frame?.tac_goodput_mbps);

  const t2Passed = Boolean(
    hasReactiveGoodput &&
    hasReactiveDelayDrops &&
    hasReactiveUtil &&
    hasReactiveSectorUtil &&
    hasStaticGoodput &&
    hasTacGoodput
  );

  results.push({
    testId: 'SCI-T2',
    testName: '3-Way Ablation Frame Telemetry',
    measured: `reactive_goodput=${msg?.reactive_goodput_mbps ?? frame?.reactive_goodput_mbps}, reactive_delay_drops=${msg?.reactive_delay_drops ?? frame?.reactive_delay_drops}, reactive_util=${msg?.reactive_util_pct ?? frame?.reactive_util_pct}, static_goodput=${msg?.static_goodput_mbps ?? frame?.static_goodput_mbps}, tac_goodput=${msg?.tac_goodput_mbps ?? frame?.tac_goodput_mbps}`,
    expected: 'all reactive_* alongside static_* and tac_* are finite and present on TelemetryFrameMessage',
    passed: t2Passed,
  });

  // ========================================================================
  // SCI-T3: Runtime SET_SCIENTIFIC_PARAMS & Congested Regime Separation
  // ========================================================================
  const simCongested = new SimulationWorkerManager(1300 * 100_000);
  simCongested.terrainEngine.setTerrainMode('synthetic');
  simCongested.isPaused = true;

  // Apply SET_SCIENTIFIC_PARAMS via handleMessage
  simCongested.handleMessage({
    type: 'SET_SCIENTIFIC_PARAMS',
    demLookaheadErrorStdM: 5.0,
    trafficLoadMultiplier: 3.5,
  });

  const demErrorUpdated = simCongested.envConfig.demLookaheadErrorStdM === 5.0;
  const trafficLoadUpdated = simCongested.envConfig.trafficLoadMultiplier === 3.5;

  // Run 1000 frames under elevated traffic load to observe occlusion behavior and drops
  for (let i = 0; i < 1000; i++) {
    simCongested.tickSimulation();
  }

  const mCongested = simCongested.metrics;
  const tacDrops = mCongested.tacDelayDropsThisRun + mCongested.tacOverflowDropsThisRun;
  const reactiveDrops = (mCongested.reactiveDelayDropsThisRun ?? 0) + (mCongested.reactiveOverflowDropsThisRun ?? 0);
  const staticDrops = mCongested.staticDelayDropsThisRun + mCongested.staticOverflowDropsThisRun;

  const tacGoodput = mCongested.tacGoodputBits;
  const reactiveGoodput = mCongested.reactiveGoodputBits ?? 0;
  const staticGoodput = mCongested.staticGoodputBits;

  // Under congested traffic with lookahead, Tac-TAD pre-evacuates and achieves fewer drops or higher delivery than reactive
  const deliveryAdvantage = (tacDrops <= reactiveDrops) || (tacGoodput >= reactiveGoodput);
  const staticAdvantage = tacDrops < staticDrops && tacGoodput > staticGoodput;
  const t3Passed = demErrorUpdated && trafficLoadUpdated && deliveryAdvantage && staticAdvantage;

  results.push({
    testId: 'SCI-T3',
    testName: 'Runtime SET_SCIENTIFIC_PARAMS & Congested Regime Separation',
    measured: `demErrorUpdated=${demErrorUpdated}, trafficLoadUpdated=${trafficLoadUpdated}, TacGoodput=${(tacGoodput / 1e6).toFixed(2)}Mb, ReactiveGoodput=${(reactiveGoodput / 1e6).toFixed(2)}Mb, StaticGoodput=${(staticGoodput / 1e6).toFixed(2)}Mb, TacDrops=${tacDrops}, ReactiveDrops=${reactiveDrops}, StaticDrops=${staticDrops}`,
    expected: 'demError=5.0, trafficMult=3.5, (tacDrops <= reactiveDrops OR tacGoodput >= reactiveGoodput) AND (tacDrops < staticDrops AND tacGoodput > staticGoodput)',
    passed: t3Passed,
  });

  // ========================================================================
  // SCI-T4: DOM Instrument Presence
  // ========================================================================
  const htmlPath = resolve(process.cwd(), 'index.html');
  const htmlContent = readFileSync(htmlPath, 'utf-8');

  const hasPolarCanvas = htmlContent.includes('id="polar-antenna-canvas"');
  const hasLinkWaterfall = htmlContent.includes('id="link-waterfall-canvas"');
  const hasDemSlider = htmlContent.includes('id="sci-dem-error-slider"');
  const hasTrafficSelect = htmlContent.includes('id="sci-traffic-scale-select"');
  const hasAblationTable = htmlContent.includes('id="sci-ablation-table"');

  const t4Passed = hasPolarCanvas && hasLinkWaterfall && hasDemSlider && hasTrafficSelect && hasAblationTable;

  results.push({
    testId: 'SCI-T4',
    testName: 'DOM Instrument Presence in index.html',
    measured: `polarCanvas=${hasPolarCanvas}, linkWaterfall=${hasLinkWaterfall}, demSlider=${hasDemSlider}, trafficSelect=${hasTrafficSelect}, ablationTable=${hasAblationTable}`,
    expected: 'all IDs exist in index.html',
    passed: t4Passed,
  });

  // ========================================================================
  // Summary & Diagnostics Output
  // ========================================================================
  console.log('\n================================================================================');
  console.log(' Tactical X-Band Digital Twin: Scientific Instruments Verification Suite');
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
    throw new Error('Scientific instruments verification failed.');
  }

  return allPassed;
}

// Execute diagnostics when invoked directly
runScientificInstrumentsVerification();
