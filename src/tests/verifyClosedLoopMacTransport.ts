/**
 * Suite 104: True Closed-Loop MAC/PHY Scheduler Coupling, Transport AIMD Congestion Control & Adaptive Video Bitrate (ABR)
 * Specification: docs/specs/v3-02-closed-loop-mac-transport.md (SPEC-V3-02)
 *
 * Verifies:
 * 1. [CLT-T1] AIMD Slow-Start, Congestion Avoidance & Multiplicative Backoff:
 *    Exponential slow-start growth, linear CA growth above ssthresh, exact 50% backoff on loss,
 *    clamping to [minCwnd, maxCwnd], and NaN/negative parameter safety.
 * 2. [CLT-T2] ABR Fast Step-Down & Anti-Oscillation Hysteresis:
 *    Immediate step-down on severe fade, link outage, BLER overshoot, or 85% queue congestion;
 *    zero premature step-up for < 15 healthy frames; clean single-tier step-up at frame 15.
 * 3. [CLT-T3] True Closed-Loop Scheduler Impact Proof (Live Worker):
 *    Identical traffic across 3 arms (Baseline, Closed-Loop MAC/PHY, Closed-Loop + ABR) over 120 frames.
 *    Asserts primary Tac-TAD delivered goodput genuinely differs under closed-loop scaling, and
 *    transport_abr_telemetry populates finite, valid metrics.
 * 4. [CLT-T4] Determinism, RESET_SIM Cleanup, UI Labels & < 3 µs/call Micro-Benchmark:
 *    Bit-exact determinism across independent runs, clean reset on RESET_SIM, index.html DOM/accessibility
 *    integrity, and 10,000 evaluations executing in < 30 ms (< 3 µs/call).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ISR_VIDEO_ABR_TIERS,
  type VideoAbrTier,
  type AbrState,
  type AimdState,
  createInitialAbrState,
  createInitialAimdState,
  stepAdaptiveVideoBitrate,
  stepAimdCongestionControl,
  computeClosedLoopEffectiveCapacityScale,
} from '../core/transportAbrEngine';
import { SimulationWorkerManager } from '../worker/simWorker';
import type { TelemetryFrameMessage } from '../shared/workerProtocol';

const ANSI = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

async function runSuite(): Promise<void> {
  console.log('='.repeat(80));
  console.log(`${ANSI.bold}${ANSI.cyan}[SUITE 104] Closed-Loop MAC/PHY Coupling, Transport AIMD & Video ABR${ANSI.reset}`);
  console.log('='.repeat(80));

  // ===========================================================================
  // [CLT-T1] AIMD Slow-Start, Congestion Avoidance & Multiplicative Backoff
  // ===========================================================================
  console.log('\n[1/4] Verifying [CLT-T1] AIMD Slow-Start, Congestion Avoidance & Multiplicative Backoff...');

  // 1.1 Initial state instantiation
  const initAimd = createInitialAimdState(4, 32);
  assert.equal(initAimd.cwnd, 4, 'Initial cwnd must be 4');
  assert.equal(initAimd.ssthresh, 32, 'Initial ssthresh must be 32');
  assert.equal(initAimd.phase, 'slow_start', 'Initial phase must be slow_start');
  assert.ok(initAimd.pacingRateMbps > 0, 'Initial pacing rate must be positive');
  assert.ok(initAimd.throttleScale >= 0.1 && initAimd.throttleScale <= 1.0, 'Throttle scale must be bounded');

  // 1.2 Exponential Slow-Start growth
  let s1 = stepAimdCongestionControl(initAimd, { ackedPackets: 4, lostPackets: 0, rttMs: 20 });
  assert.equal(s1.cwnd, 8, 'cwnd must grow from 4 to 8 after 4 ACKs');
  assert.equal(s1.phase, 'slow_start');

  let s2 = stepAimdCongestionControl(s1, { ackedPackets: 8, lostPackets: 0, rttMs: 20 });
  assert.equal(s2.cwnd, 16, 'cwnd must grow from 8 to 16 after 8 ACKs');
  assert.equal(s2.phase, 'slow_start');

  let s3 = stepAimdCongestionControl(s2, { ackedPackets: 16, lostPackets: 0, rttMs: 20 });
  assert.equal(s3.cwnd, 32, 'cwnd must reach ssthresh (32)');
  assert.equal(s3.phase, 'slow_start');

  // 1.3 Congestion Avoidance linear growth
  let s4 = stepAimdCongestionControl(s3, { ackedPackets: 32, lostPackets: 0, rttMs: 20 });
  assert.equal(s4.cwnd, 33, 'cwnd must grow by 1 packet in Congestion Avoidance (32 -> 33)');
  assert.equal(s4.phase, 'congestion_avoidance');

  let s5 = stepAimdCongestionControl(s4, { ackedPackets: 33, lostPackets: 0, rttMs: 20 });
  assert.equal(s5.cwnd, 34, 'cwnd must grow by 1 packet in Congestion Avoidance (33 -> 34)');
  assert.equal(s5.phase, 'congestion_avoidance');

  // 1.4 Multiplicative Decrease on Loss
  let s6 = stepAimdCongestionControl(s5, { ackedPackets: 0, lostPackets: 1, rttMs: 20 });
  assert.equal(s6.ssthresh, 17, 'ssthresh must back off by 50% (34 * 0.5 = 17)');
  assert.equal(s6.cwnd, 17, 'cwnd must drop to new ssthresh on loss');
  assert.equal(s6.phase, 'recovery');

  // 1.5 Clamping to [minCwnd, maxCwnd]
  let sMax = stepAimdCongestionControl(s5, { ackedPackets: 5000, lostPackets: 0, rttMs: 20, maxCwnd: 64 });
  assert.equal(sMax.cwnd, 64, 'cwnd must not exceed maxCwnd');

  let sMin = s6;
  for (let i = 0; i < 10; i++) {
    sMin = stepAimdCongestionControl(sMin, { ackedPackets: 0, lostPackets: 2, rttMs: 20, minCwnd: 2 });
  }
  assert.equal(sMin.cwnd, 2, 'cwnd must not drop below minCwnd');
  assert.equal(sMin.ssthresh, 2, 'ssthresh must not drop below minCwnd');

  // 1.6 NaN & Negative Input Safety
  const nanResult = stepAimdCongestionControl(
    { cwnd: NaN, ssthresh: NaN, phase: 'slow_start', pacingRateMbps: NaN, throttleScale: NaN },
    { ackedPackets: NaN, lostPackets: -5, rttMs: -100 }
  );
  assert.ok(Number.isFinite(nanResult.cwnd), 'cwnd must be finite given NaN inputs');
  assert.ok(Number.isFinite(nanResult.ssthresh), 'ssthresh must be finite given NaN inputs');
  assert.ok(Number.isFinite(nanResult.pacingRateMbps), 'pacingRateMbps must be finite given NaN inputs');
  assert.ok(Number.isFinite(nanResult.throttleScale), 'throttleScale must be finite given NaN inputs');

  console.log(`${ANSI.green}✓ [CLT-T1] AIMD slow-start, congestion avoidance, backoff and safety verified.${ANSI.reset}`);

  // ===========================================================================
  // [CLT-T2] ABR Fast Step-Down & Anti-Oscillation Hysteresis
  // ===========================================================================
  console.log('\n[2/4] Verifying [CLT-T2] ABR Fast Step-Down & Anti-Oscillation Hysteresis...');

  // 2.1 Initial ABR state
  const initAbr = createInitialAbrState(2);
  assert.equal(initAbr.currentTierIndex, 2, 'Initial tier must be Tier 2 (1080P_HD)');
  assert.equal(initAbr.healthyStreak, 0, 'Initial healthy streak must be 0');
  assert.equal(ISR_VIDEO_ABR_TIERS[2].targetBitrateMbps, 2.50);

  // 2.2 Immediate fast step-down on severe fade (-10 dB)
  const fadeRes = stepAdaptiveVideoBitrate(initAbr, {
    snrDb: -10.0,
    bler: 0.0,
    queueFillRatio: 0.1,
    isOutage: false,
  });
  assert.equal(fadeRes.action, 'down', 'Must trigger down action on severe fade');
  assert.equal(fadeRes.tierIndex, 0, 'Must step down immediately to Tier 0 (360P_LOW_BW)');
  assert.equal(fadeRes.tierName, '360P_LOW_BW');
  assert.equal(fadeRes.nextState.healthyStreak, 0, 'Healthy streak must reset to 0');
  assert.equal(fadeRes.targetBitrateMbps, 0.30);
  assert.equal(fadeRes.bitrateScaleFactor, 0.30 / 2.50);

  // 2.3 Immediate step-down on link outage
  const outageRes = stepAdaptiveVideoBitrate(initAbr, {
    snrDb: 25.0,
    bler: 0.0,
    queueFillRatio: 0.0,
    isOutage: true,
  });
  assert.equal(outageRes.action, 'down', 'Must trigger down action on outage');
  assert.equal(outageRes.tierIndex, 0, 'Must floor immediately to Tier 0 on outage');

  // 2.4 Immediate step-down on 85% queue congestion
  const congRes = stepAdaptiveVideoBitrate(initAbr, {
    snrDb: 18.0,
    bler: 0.01,
    queueFillRatio: 0.85,
    isOutage: false,
  });
  assert.equal(congRes.action, 'down', 'Must trigger down action on 85% queue fill');
  assert.equal(congRes.tierIndex, 0, 'Queue fill 0.85 exceeds Tier 1 max 0.75, must drop to Tier 0');

  // 2.5 Immediate step-down on BLER overshoot
  const blerRes = stepAdaptiveVideoBitrate(initAbr, {
    snrDb: 18.0,
    bler: 0.15, // exceeds Tier 2 maxBler (0.10), but sustainable in Tier 1 (0.18)
    queueFillRatio: 0.20,
    isOutage: false,
  });
  assert.equal(blerRes.action, 'down');
  assert.equal(blerRes.tierIndex, 1, 'Must step down to Tier 1 on BLER 0.15');

  // 2.6 Conservative Hysteretic Step-Up: zero premature step-up for < 15 healthy frames
  let curAbrState = createInitialAbrState(1); // Start at Tier 1 (720P_TAC)
  // Channel suitable for Tier 2: minSnr=9.0 + 2.0 = 11.0 dB, maxBler=0.10*0.7=0.07, maxQueue=0.55*0.8=0.44
  const stepUpParams = {
    snrDb: 15.0,
    bler: 0.02,
    queueFillRatio: 0.10,
    isOutage: false,
    upSwitchHoldFrames: 15,
  };

  for (let frame = 1; frame <= 14; frame++) {
    const res = stepAdaptiveVideoBitrate(curAbrState, stepUpParams);
    assert.equal(res.action, 'hold', `Frame ${frame} must hold, not step up prematurely`);
    assert.equal(res.tierIndex, 1, `Frame ${frame} must remain at Tier 1`);
    assert.equal(res.nextState.healthyStreak, frame, `Frame ${frame} healthyStreak must be ${frame}`);
    curAbrState = res.nextState;
  }

  // At frame 15, step-up fires cleanly
  const frame15Res = stepAdaptiveVideoBitrate(curAbrState, stepUpParams);
  assert.equal(frame15Res.action, 'up', 'Frame 15 must execute step-up');
  assert.equal(frame15Res.tierIndex, 2, 'Frame 15 must advance to Tier 2 (1080P_HD)');
  assert.equal(frame15Res.nextState.healthyStreak, 0, 'Healthy streak must reset to 0 upon step-up');

  console.log(`${ANSI.green}✓ [CLT-T2] ABR fast step-down, congestion mitigation and anti-oscillation hysteresis verified.${ANSI.reset}`);

  // ===========================================================================
  // [CLT-T3] True Closed-Loop Scheduler Impact Proof (Live Worker)
  // ===========================================================================
  console.log('\n[3/4] Verifying [CLT-T3] True Closed-Loop Scheduler Impact Proof (Live 50 Hz Worker)...');

  let capturedFrames: TelemetryFrameMessage[] = [];
  (globalThis as any).self = {
    postMessage: (msg: any) => {
      if (msg && msg.type === 'TELEMETRY_FRAME') {
        capturedFrames.push(msg);
      }
    },
  };

  // Arm A: Baseline (enableMacPhyFeedback: false, enableTransportAbr: false)
  const simA = new SimulationWorkerManager(104_001, '16_NODES');
  simA.terrainEngine.setTerrainMode('synthetic');
  simA.isPaused = true;
  simA.enableMacPhyFeedback = false;
  simA.enableTransportAbr = false;
  for (const n of simA.nodesTac) {
    n.hasVideo = true;
    n.videoMeanPktsPerFrame = 50;
  }

  for (let i = 0; i < 120; i++) {
    simA.tickSimulation(true);
  }
  const goodputBitsA = simA.metrics.tacGoodputBits;
  const lastBitsTxA = simA.lastReportTac?.totalBitsTransmitted ?? 0;

  // Arm B: Closed-Loop MAC/PHY (enableMacPhyFeedback: true, enableTransportAbr: false)
  const simB = new SimulationWorkerManager(104_001, '16_NODES');
  simB.terrainEngine.setTerrainMode('synthetic');
  simB.isPaused = true;
  simB.enableMacPhyFeedback = true;
  simB.enableTransportAbr = false;
  for (const n of simB.nodesTac) {
    n.hasVideo = true;
    n.videoMeanPktsPerFrame = 50;
  }

  for (let i = 0; i < 120; i++) {
    simB.tickSimulation(true);
  }
  const goodputBitsB = simB.metrics.tacGoodputBits;
  const lastBitsTxB = simB.lastReportTac?.totalBitsTransmitted ?? 0;

  assert.ok(simB.closedLoopCapacityScaleByNode.size > 0, 'Arm B must populate closedLoopCapacityScaleByNode');
  let hasReducedScale = false;
  for (const [, scale] of simB.closedLoopCapacityScaleByNode) {
    assert.ok(scale >= 0.0 && scale <= 1.0, `Scale ${scale} must be in [0, 1]`);
    if (scale < 1.0) {
      hasReducedScale = true;
    }
  }
  assert.ok(hasReducedScale, 'Arm B must experience closedLoopCapacityScale < 1.0 due to range/guard overhead');

  // CRITICAL AUDIT PROOF: Tac-TAD goodput in Arm B genuinely differs from baseline Arm A!
  assert.notEqual(
    goodputBitsB,
    goodputBitsA,
    `Arm B delivered goodput (${goodputBitsB} bits) must genuinely differ from Arm A (${goodputBitsA} bits)`
  );
  console.log(`    Arm A (Baseline Goodput):    ${goodputBitsA} bits`);
  console.log(`    Arm B (Closed-Loop Goodput): ${goodputBitsB} bits (genuinely coupled to MAC/PHY!)`);

  // Arm C: Closed-Loop + ABR (enableMacPhyFeedback: true, enableTransportAbr: true)
  const simC = new SimulationWorkerManager(104_001, '16_NODES');
  simC.terrainEngine.setTerrainMode('synthetic');
  simC.isPaused = true;
  simC.enableMacPhyFeedback = true;
  simC.enableTransportAbr = true;
  for (const n of simC.nodesTac) {
    n.hasVideo = true;
    n.videoMeanPktsPerFrame = 50;
  }

  capturedFrames = [];
  for (let i = 0; i < 120; i++) {
    simC.tickSimulation(true);
  }

  assert.ok(capturedFrames.length > 0, 'Arm C must emit telemetry frames');
  const latestFrame = capturedFrames[capturedFrames.length - 1].frame;
  const abrTelem = latestFrame.transport_abr_telemetry;

  assert.ok(abrTelem, 'Arm C must emit transport_abr_telemetry block');
  assert.equal(abrTelem.enabled, true, 'transport_abr_telemetry.enabled must be true');
  assert.ok(Number.isFinite(abrTelem.mean_cwnd_packets), 'mean_cwnd_packets must be finite');
  assert.ok(abrTelem.mean_cwnd_packets > 0, 'mean_cwnd_packets must be positive');
  assert.ok(Number.isFinite(abrTelem.mean_video_bitrate_mbps), 'mean_video_bitrate_mbps must be finite');
  assert.ok(abrTelem.mean_video_bitrate_mbps > 0, 'mean_video_bitrate_mbps must be positive');
  assert.ok(Number.isFinite(abrTelem.mean_closed_loop_capacity_scale), 'mean_closed_loop_capacity_scale must be finite');
  assert.ok(
    ['360P_LOW_BW', '720P_TAC', '1080P_HD', '4K_EO_IR'].includes(abrTelem.active_video_tier_label),
    `active_video_tier_label (${abrTelem.active_video_tier_label}) must be a valid tier label`
  );

  console.log(`    Arm C Telemetry: Cwnd=${abrTelem.mean_cwnd_packets.toFixed(1)} pkts | Bitrate=${abrTelem.mean_video_bitrate_mbps.toFixed(2)} Mbps | Tier=${abrTelem.active_video_tier_label} | Scale=${abrTelem.mean_closed_loop_capacity_scale.toFixed(2)}`);
  console.log(`${ANSI.green}✓ [CLT-T3] Live worker closed-loop scheduler coupling and ABR telemetry verified.${ANSI.reset}`);

  // ===========================================================================
  // [CLT-T4] Determinism, RESET_SIM Cleanup, UI Labels & Micro-Benchmark
  // ===========================================================================
  console.log('\n[4/4] Verifying [CLT-T4] Determinism, RESET_SIM Cleanup, UI Labels & Micro-Benchmark...');

  // 4.1 Determinism: Two independent runs produce bit-for-bit identical results
  capturedFrames = [];
  const run1 = new SimulationWorkerManager(104_005, '16_NODES');
  run1.terrainEngine.setTerrainMode('synthetic');
  run1.isPaused = true;
  run1.enableMacPhyFeedback = true;
  run1.enableTransportAbr = true;
  for (let i = 0; i < 60; i++) run1.tickSimulation(true);
  const frameRun1 = capturedFrames[capturedFrames.length - 1];

  capturedFrames = [];
  const run2 = new SimulationWorkerManager(104_005, '16_NODES');
  run2.terrainEngine.setTerrainMode('synthetic');
  run2.isPaused = true;
  run2.enableMacPhyFeedback = true;
  run2.enableTransportAbr = true;
  for (let i = 0; i < 60; i++) run2.tickSimulation(true);
  const frameRun2 = capturedFrames[capturedFrames.length - 1];

  assert.equal(
    run1.metrics.tacGoodputBits,
    run2.metrics.tacGoodputBits,
    'tacGoodputBits must be bit-exact across independent runs'
  );
  assert.deepEqual(
    frameRun1.frame.transport_abr_telemetry,
    frameRun2.frame.transport_abr_telemetry,
    'transport_abr_telemetry must be bit-exact across independent runs'
  );

  // 4.2 RESET_SIM Cleanup
  run1.resetSimulationState();
  assert.equal(run1.aimdStateByNode.size, 0, 'aimdStateByNode must be cleared on RESET_SIM');
  assert.equal(run1.abrStateByNode.size, 0, 'abrStateByNode must be cleared on RESET_SIM');
  assert.equal(run1.closedLoopCapacityScaleByNode.size, 0, 'closedLoopCapacityScaleByNode must be cleared on RESET_SIM');
  assert.equal(run1.abrStepDownsTotal, 0, 'abrStepDownsTotal must reset to 0');
  assert.equal(run1.abrStepUpsTotal, 0, 'abrStepUpsTotal must reset to 0');

  // 4.3 UI DOM Inspection (index.html)
  const indexHtmlPath = path.resolve(process.cwd(), 'index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  assert.ok(indexHtml.includes('id="toggle-hifi-abr"'), 'index.html must contain #toggle-hifi-abr');
  assert.ok(indexHtml.includes('for="toggle-hifi-abr"'), 'index.html must contain <label for="toggle-hifi-abr">');
  assert.ok(indexHtml.includes('id="hifi-abr-readout"'), 'index.html must contain #hifi-abr-readout');
  assert.ok(indexHtml.includes('aria-label="Enable Transport AIMD and Adaptive Video Bitrate"'), 'Proper aria-label required');

  // Verify zero duplicate IDs for new elements
  const toggleAbrMatches = indexHtml.match(/id="toggle-hifi-abr"/g);
  assert.equal(toggleAbrMatches?.length, 1, 'id="toggle-hifi-abr" must be unique in index.html');
  const readoutMatches = indexHtml.match(/id="hifi-abr-readout"/g);
  assert.equal(readoutMatches?.length, 1, 'id="hifi-abr-readout" must be unique in index.html');

  // Zero emojis in the new DOM block
  const abrBlockMatch = indexHtml.match(/<div class="inspector-metric"[\s\S]*?id="toggle-hifi-abr"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(abrBlockMatch, 'Must match #toggle-hifi-abr inspector-metric block');
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.ok(!emojiRegex.test(abrBlockMatch[0]), 'New ABR DOM block must contain zero emojis');

  // 4.4 Micro-benchmark: 10,000 evaluations in < 30 ms (< 3 µs/call)
  let benchAimd = createInitialAimdState(4, 32);
  let benchAbr = createInitialAbrState(2);
  const benchParams = {
    ackedPackets: 2,
    lostPackets: 0,
    rttMs: 25.0,
  };
  const benchAbrParams = {
    snrDb: 12.0,
    bler: 0.02,
    queueFillRatio: 0.20,
    isOutage: false,
  };
  const benchCouplerParams = {
    dynamicGuardEfficiency: 0.98,
    slotCollisionOutage: false,
    delayedCqiBler: 0.02,
    harqActiveRetx: false,
    harqCombinedSnrMarginDb: 3.5,
  };

  const tStart = performance.now();
  for (let i = 0; i < 10000; i++) {
    benchAimd = stepAimdCongestionControl(benchAimd, benchParams);
    const abrRes = stepAdaptiveVideoBitrate(benchAbr, benchAbrParams);
    benchAbr = abrRes.nextState;
    computeClosedLoopEffectiveCapacityScale(benchCouplerParams);
  }
  const tElapsed = performance.now() - tStart;
  const usPerCall = (tElapsed * 1000) / 10000;

  console.log(`    Micro-benchmark: 10,000 evaluations in ${tElapsed.toFixed(2)} ms (${usPerCall.toFixed(3)} µs/eval)`);
  assert.ok(
    tElapsed < 30.0,
    `Micro-benchmark must complete in < 30 ms (took ${tElapsed.toFixed(2)} ms, ${usPerCall.toFixed(3)} µs/eval)`
  );

  console.log(`${ANSI.green}✓ [CLT-T4] Determinism, clean reset, UI labels and < 3 µs/call budget verified.${ANSI.reset}`);

  console.log('\n' + '='.repeat(80));
  console.log(`${ANSI.bold}${ANSI.green}[ALL SUITE 104 VERIFICATIONS PASSED CLEANLY]${ANSI.reset}`);
  console.log('='.repeat(80));
}

runSuite().catch(err => {
  console.error(`\n${ANSI.bold}${ANSI.red}[SUITE 104 FAILED]${ANSI.reset}`);
  console.error(err);
  process.exit(1);
});
