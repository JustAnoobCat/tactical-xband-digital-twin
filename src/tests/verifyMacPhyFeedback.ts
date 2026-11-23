/**
 * src/tests/verifyMacPhyFeedback.ts
 *
 * Automated Verification Suite for MAC/PHY Feedback Dynamics (Suite 90).
 * Specification: docs/specs/wp06-mac-phy-feedback-dynamics.md
 *
 * Verifies:
 * 1. Delayed CQI Overshoot vs. Genie-Aided AMC & OLLA Convergence
 * 2. Pure Long-RTT HARQ Turnaround Gating Barrier
 * 3. Chase Combining Exact Energy Conservation & Incremental Redundancy Gain
 * 4. Slant-Range & Timing Advance-Coupled Dynamic TDMA Guard Overhead
 * 5. Determinism, Robustness, NaN-Safety & Integration Hooks
 * 6. 50 Hz Discrete Sim Loop Performance Micro-Benchmark (< 5 µs/call)
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  computeCqiLagFrames,
  stepOllaOffsetDb,
  evaluateDelayedCqiAmc,
  computeHarqCombinedSnrDb,
  hashUnitInterval,
  createHarqProcessSlot,
  stepHarqProcess,
  computeMinimumHarqProcesses,
  computeDynamicTdmaOverhead,
  SPEED_OF_LIGHT_M_S,
} from '../core/macPhyFeedback';
import {
  TdmaFrameConfig,
  DEFAULT_TDMA_FRAME_CONFIG,
  evaluateRangeAwareTdmaEfficiency,
} from '../core/tdmaConfig';
import {
  LegacyStaticScheduler,
  TerrainAwareDynamicScheduler,
  computeRangeConstrainedSlotCapacity,
} from '../core/scheduler';
import { GroundNodeTrafficSubsystem } from '../core/queues';
import { LinkStatus } from '../core/linkBudget';
import { NodeTerrainState, PredictiveState } from '../core/trajectory';

function close(actual: number, expected: number, tolerance = 1e-4, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('='.repeat(96));
console.log('   WP-06: MAC/PHY FEEDBACK DYNAMICS & DYNAMIC TDMA OVERHEAD (SUITE 90)');
console.log('   Specification: docs/specs/wp06-mac-phy-feedback-dynamics.md');
console.log('='.repeat(96));

// =============================================================================
// [TEST 1] Delayed CQI Overshoot vs. Genie-Aided AMC & OLLA Convergence
// =============================================================================
console.log('\n[TEST 1] Verifying Delayed CQI Overshoot vs. Genie-Aided AMC & OLLA Convergence...');
{
  // 1.1 Compute CQI lag frames across slant ranges
  const lagGenie = computeCqiLagFrames(100000, 20.0, 4.0, true);
  assert.strictEqual(lagGenie, 0, 'Genie-aided mode must return exactly 0 lag frames');

  // Slant range 150 km: prop RTT = (300000 / 299792458) * 1000 = 1.00069 ms.
  // With T_proc = 4.0 ms, total feedback = 5.00069 ms.
  // On a 20 ms frame: ceil(5.00069 / 20) = 1 frame.
  const lag150km = computeCqiLagFrames(150000, 20.0, 4.0);
  assert.strictEqual(lag150km, 1, '150 km slant range with 20 ms frame must yield 1 frame lag');

  // Slant range 200 km: prop RTT = 1.334 ms.
  // On a 2.0 ms fast frame: total feedback = 1.334 + 4.0 = 5.334 ms -> ceil(5.334 / 2.0) = 3 frames.
  const lagFastFrame = computeCqiLagFrames(200000, 2.0, 4.0);
  assert.strictEqual(lagFastFrame, 3, '200 km slant range with 2 ms frame must yield 3 frames lag');

  // 1.2 Sudden -8 dB Shadow Fade Scenario
  // Channel drops from nominal 15.0 dB to 7.0 dB
  const nominalSnrDb = 15.0;
  const fadedSnrDb = 7.0;

  // Stale CQI evaluation (delay L = 2 frames): scheduler still sees 15.0 dB
  const delayedRes = evaluateDelayedCqiAmc({
    reportedSnrDb: nominalSnrDb,
    actualSnrDb: fadedSnrDb,
    ollaOffsetDb: 0.0,
  });

  assert.ok(delayedRes.selectedModcod !== null, 'Delayed AMC should select a valid MODCOD based on 15 dB');
  assert.strictEqual(delayedRes.selectedModcod!.name, '16-APSK 4/5', '15 dB should select 16-APSK 4/5 (req: 14.0 dB)');
  assert.ok(
    delayedRes.mcsOvershootDb > 0.0,
    `Delayed CQI under -8 dB fade must exhibit MCS overshoot (got ${delayedRes.mcsOvershootDb} dB)`
  );
  close(delayedRes.mcsOvershootDb, 7.0, 1e-3, 'Overshoot should be 14.0 - 7.0 = 7.0 dB');
  assert.ok(
    delayedRes.bler > 0.5,
    `Delayed CQI under fade must experience high BLER spike > 0.5 (got ${delayedRes.bler.toFixed(4)})`
  );
  console.log(`  • Delayed CQI: MCS=${delayedRes.selectedModcod!.name}, Overshoot=${delayedRes.mcsOvershootDb.toFixed(1)} dB, BLER=${(delayedRes.bler * 100).toFixed(1)}%`);

  // Genie-aided instantaneous AMC (delay L = 0 frames): scheduler sees true 7.0 dB immediately
  const genieRes = evaluateDelayedCqiAmc({
    reportedSnrDb: fadedSnrDb,
    actualSnrDb: fadedSnrDb,
    ollaOffsetDb: 0.0,
  });

  assert.ok(genieRes.selectedModcod !== null, 'Genie AMC should select a valid MODCOD based on 7 dB');
  assert.strictEqual(genieRes.selectedModcod!.name, 'QPSK 3/4', '7 dB should select QPSK 3/4 (req: 5.5 dB)');
  assert.strictEqual(genieRes.mcsOvershootDb, 0.0, 'Genie AMC must have zero MCS overshoot');
  assert.ok(
    genieRes.bler < 0.1,
    `Genie AMC should maintain safe low BLER < 0.1 (got ${genieRes.bler.toFixed(4)})`
  );
  console.log(`  • Genie-Aided AMC: MCS=${genieRes.selectedModcod!.name}, Overshoot=${genieRes.mcsOvershootDb.toFixed(1)} dB, BLER=${(genieRes.bler * 100).toFixed(1)}%`);

  // 1.3 OLLA Convergence Test under Persistent +3.0 dB CQI Bias
  // Actual SNR is 10.0 dB, but reported SNR is persistently biased at 13.0 dB (+3 dB error)
  const actualChannelSnrDb = 10.0;
  const biasedReportedSnrDb = 13.0;
  const targetBler = 0.10;
  let ollaOffsetDb = 0.0;
  const totalFrames = 500;
  let last200Errors = 0;

  for (let f = 0; f < totalFrames; f++) {
    const amcRes = evaluateDelayedCqiAmc({
      reportedSnrDb: biasedReportedSnrDb,
      actualSnrDb: actualChannelSnrDb,
      ollaOffsetDb,
    });

    const u = hashUnitInterval(42, f, 0, 1);
    const acked = u >= amcRes.bler;
    ollaOffsetDb = stepOllaOffsetDb(ollaOffsetDb, acked, targetBler, 0.25);

    if (f >= 300) {
      if (!acked) {
        last200Errors++;
      }
    }
  }

  const empiricalBler = last200Errors / 200.0;
  console.log(`  • OLLA Convergence: Final offset=${ollaOffsetDb.toFixed(2)} dB, Steady-state BLER over 200 frames=${(empiricalBler * 100).toFixed(1)}% (Target: 10%)`);
  assert.ok(
    ollaOffsetDb >= 1.5 && ollaOffsetDb <= 4.5,
    `OLLA offset must converge near +3.0 dB bias (got ${ollaOffsetDb.toFixed(2)} dB)`
  );
  assert.ok(
    empiricalBler >= 0.04 && empiricalBler <= 0.20,
    `OLLA steady-state BLER must track target 0.10 ± 0.08 (got ${empiricalBler})`
  );

  console.log('  -> PASS: Delayed CQI overshoot and OLLA convergence verified.');
}

// =============================================================================
// [TEST 2] Pure Long-RTT HARQ Turnaround Gating Barrier
// =============================================================================
console.log('\n[TEST 2] Verifying Long-RTT HARQ Turnaround Gating Barrier...');
{
  const slantRangeM = 200000; // 200 km
  const rttMs = ((2.0 * slantRangeM) / SPEED_OF_LIGHT_M_S) * 1000.0; // ~1.334256 ms
  const procTurnaroundMs = 2.0; // 2.0 ms
  const totalWaitMs = rttMs + procTurnaroundMs; // ~3.334256 ms

  close(rttMs, 1.334256, 1e-4, '200 km RTT analytical match');
  console.log(`  • Slant range 200 km: RTT = ${rttMs.toFixed(5)} ms, Processing = ${procTurnaroundMs.toFixed(1)} ms, Total Turnaround = ${totalWaitMs.toFixed(5)} ms`);

  // Step 1: Initial transmission at t = 0 ms fails (high required SNR forces NACK)
  const initialSlot = createHarqProcessSlot(1);
  const tx0 = stepHarqProcess(initialSlot, {
    currentTimeMs: 0.0,
    slantRangeM,
    actualSnrDb: 0.0,
    requiredSnrDb: 50.0, // Impossible SNR threshold ensures NACK
    processingTurnaroundMs: procTurnaroundMs,
  });

  assert.strictEqual(tx0.event, 'NACK_RETRY_SCHEDULED', 'Initial failed tx must schedule NACK retry');
  assert.strictEqual(tx0.nextSlot.state, 'WAITING_RTT', 'Slot must enter WAITING_RTT state');
  assert.strictEqual(tx0.nextSlot.txCount, 1, 'Transmission count must be 1');
  assert.strictEqual(tx0.nextSlot.lastTxTimeMs, 0.0, 'lastTxTimeMs must record 0.0 ms');
  close(tx0.rttWaitMs, totalWaitMs, 1e-4, 'rttWaitMs must equal total turnaround time');

  // Step 2: Attempt retransmission at t = 2.0 ms (< 3.334 ms)
  const txAt2ms = stepHarqProcess(tx0.nextSlot, {
    currentTimeMs: 2.0,
    slantRangeM,
    actualSnrDb: 0.0,
    requiredSnrDb: 50.0,
    processingTurnaroundMs: procTurnaroundMs,
  });

  assert.strictEqual(txAt2ms.event, 'TX_PENDING_RTT', 't = 2.0 ms must be blocked by RTT barrier');
  assert.strictEqual(txAt2ms.nextSlot.txCount, 1, 'txCount must not advance while pending RTT');
  close(txAt2ms.rttWaitMs, totalWaitMs - 2.0, 1e-4, 'rttWaitMs must equal remaining wait');

  // Step 3: Attempt retransmission at t = 3.30 ms (< 3.334 ms)
  const txAt330ms = stepHarqProcess(tx0.nextSlot, {
    currentTimeMs: 3.30,
    slantRangeM,
    actualSnrDb: 0.0,
    requiredSnrDb: 50.0,
    processingTurnaroundMs: procTurnaroundMs,
  });

  assert.strictEqual(txAt330ms.event, 'TX_PENDING_RTT', 't = 3.30 ms must be blocked by RTT barrier');

  // Step 4: Retransmit at t = 3.35 ms (>= 3.334 ms)
  const txAt335ms = stepHarqProcess(tx0.nextSlot, {
    currentTimeMs: 3.35,
    slantRangeM,
    actualSnrDb: 0.0,
    requiredSnrDb: 50.0,
    processingTurnaroundMs: procTurnaroundMs,
  });

  assert.notStrictEqual(txAt335ms.event, 'TX_PENDING_RTT', 't = 3.35 ms must cross RTT barrier');
  assert.strictEqual(txAt335ms.nextSlot.txCount, 2, 'txCount must increment to 2 on retransmission');
  assert.strictEqual(txAt335ms.nextSlot.lastTxTimeMs, 3.35, 'lastTxTimeMs must update to 3.35 ms');

  // Verify computeMinimumHarqProcesses helper
  const minProcesses = computeMinimumHarqProcesses(200000, 1.0, 2.0);
  // (1.334 + 4.0) / 1.0 = 5.334 -> ceil = 6 processes
  assert.strictEqual(minProcesses, 6, '200 km on 1 ms slot requires 6 parallel HARQ processes');

  console.log('  -> PASS: Long-RTT HARQ turnaround gating strictly enforced.');
}

// =============================================================================
// [TEST 3] Chase Combining Exact Energy Conservation & IR Coding Gain
// =============================================================================
console.log('\n[TEST 3] Verifying Chase Combining Energy Conservation & IR Coding Gain...');
{
  const baseSnr = 4.0; // 4.0 dB

  // Analytical CC Gain: gamma_CC = 10 * log10(N * 10^(base / 10)) = base + 10 * log10(N)
  const cc1 = computeHarqCombinedSnrDb([baseSnr], 'chase');
  const cc2 = computeHarqCombinedSnrDb([baseSnr, baseSnr], 'chase');
  const cc3 = computeHarqCombinedSnrDb([baseSnr, baseSnr, baseSnr], 'chase');
  const cc4 = computeHarqCombinedSnrDb([baseSnr, baseSnr, baseSnr, baseSnr], 'chase');

  close(cc1, baseSnr, 1e-5, '1 tx CC must equal base SNR');
  close(cc2 - baseSnr, 3.0102999566, 1e-4, '2 tx CC gain must be +3.0103 dB');
  close(cc3 - baseSnr, 4.771212547, 1e-4, '3 tx CC gain must be +4.7712 dB');
  close(cc4 - baseSnr, 6.020599913, 1e-4, '4 tx CC gain must be +6.0206 dB');

  console.log(`  • Chase Combining Gains: 1-tx: +0.00 dB, 2-tx: +${(cc2 - baseSnr).toFixed(4)} dB, 3-tx: +${(cc3 - baseSnr).toFixed(4)} dB, 4-tx: +${(cc4 - baseSnr).toFixed(4)} dB`);

  // Incremental Redundancy (IR) Coding Gain:
  const ir1 = computeHarqCombinedSnrDb([baseSnr], 'ir');
  const ir2 = computeHarqCombinedSnrDb([baseSnr, baseSnr], 'ir');
  const ir3 = computeHarqCombinedSnrDb([baseSnr, baseSnr, baseSnr], 'ir');

  close(ir1, cc1, 1e-5, '1 tx IR must have 0 dB additional gain over CC');
  close(ir2 - cc2, 1.0, 1e-4, '2 tx IR must provide +1.0 dB coding gain over CC');
  close(ir3 - cc3, 1.5, 1e-4, '3 tx IR must provide +1.5 dB coding gain over CC');
  assert.ok(ir2 > cc2 && ir3 > cc3, 'IR must provide strictly higher effective SNR than CC for retransmissions');

  console.log(`  • Incremental Redundancy Gains over CC: 1-tx: +0.0 dB, 2-tx: +${(ir2 - cc2).toFixed(2)} dB, 3-tx: +${(ir3 - cc3).toFixed(2)} dB`);

  // Exhausting maxRetransmissions yields HARQ_FAILURE and releases slot
  let slot = createHarqProcessSlot(7);
  const maxRetries = 2; // initial tx + 2 retransmissions = 3 total attempts

  // Attempt 1 (t = 0 ms)
  const step1 = stepHarqProcess(slot, {
    currentTimeMs: 0.0,
    slantRangeM: 10000,
    actualSnrDb: -50.0,
    requiredSnrDb: 50.0,
    maxRetransmissions: maxRetries,
    processingTurnaroundMs: 1.0,
  });
  assert.strictEqual(step1.event, 'NACK_RETRY_SCHEDULED');

  // Attempt 2 (t = 5 ms)
  const step2 = stepHarqProcess(step1.nextSlot, {
    currentTimeMs: 5.0,
    slantRangeM: 10000,
    actualSnrDb: -50.0,
    requiredSnrDb: 50.0,
    maxRetransmissions: maxRetries,
    processingTurnaroundMs: 1.0,
  });
  assert.strictEqual(step2.event, 'NACK_RETRY_SCHEDULED');

  // Attempt 3 (t = 10 ms) -> exhausts maxRetransmissions (retransmissions = 3 - 1 = 2)
  const step3 = stepHarqProcess(step2.nextSlot, {
    currentTimeMs: 10.0,
    slantRangeM: 10000,
    actualSnrDb: -50.0,
    requiredSnrDb: 50.0,
    maxRetransmissions: maxRetries,
    processingTurnaroundMs: 1.0,
  });

  assert.strictEqual(step3.event, 'HARQ_FAILURE', 'Exhausting maxRetransmissions must yield HARQ_FAILURE');
  assert.strictEqual(step3.nextSlot.state, 'IDLE', 'HARQ_FAILURE must release slot to IDLE');
  assert.strictEqual(step3.nextSlot.txCount, 0, 'txCount must reset to 0');
  assert.strictEqual(step3.nextSlot.snrHistoryDb.length, 0, 'snrHistory must be cleared on release');

  console.log('  -> PASS: Chase combining energy conservation, IR gain, and failure release verified.');
}

// =============================================================================
// [TEST 4] Dynamic TDMA Guard Period & TA Loss Collapse
// =============================================================================
console.log('\n[TEST 4] Verifying Dynamic TDMA Guard Period & TA Loss Collapse...');
{
  const slantRangeM = 200000; // 200 km
  const slotDurationMs = 1.0; // 1.0 ms slot = 1000 us

  // Case A: Closed-Loop Timing Advance Active (locked)
  const resTaActive = computeDynamicTdmaOverhead({
    slotDurationMs,
    slotsPerFrame: 10,
    slantRangeM,
    timingAdvanceActive: true,
    taResidualErrorM: 50.0,
    rfSwitchGuardUs: 20.0,
    rachControlSlotsPerFrame: 0,
  });

  // taResidualRtt = (100 / 299792458) * 1e6 = 0.33356 us -> guard = max(20, 20.33356) = 20.33356 us
  assert.strictEqual(resTaActive.slotCollisionOutage, false, 'TA active must avoid slot collision outage');
  assert.ok(
    resTaActive.slotEfficiency > 0.85,
    `TA active slot efficiency must exceed 0.85 (got ${resTaActive.slotEfficiency.toFixed(4)})`
  );
  close(resTaActive.slotEfficiency, (1000.0 - 20.33356) / 1000.0, 1e-4, 'TA active slot efficiency match');
  console.log(`  • TA Active (200 km, 1 ms slot): Guard=${resTaActive.requiredGuardUs.toFixed(2)} us, Usable=${resTaActive.usableSlotUs.toFixed(1)} us, Slot Eff=${(resTaActive.slotEfficiency * 100).toFixed(2)}%`);

  // Case B: Timing Advance Lost (open-loop / RACH acquisition)
  const resTaLost = computeDynamicTdmaOverhead({
    slotDurationMs,
    slotsPerFrame: 10,
    slantRangeM,
    timingAdvanceActive: false,
    rfSwitchGuardUs: 20.0,
    rachControlSlotsPerFrame: 0,
  });

  // propagationRttUs = (400000 / 299792458) * 1e6 = 1334.256 us.
  // requiredGuardUs = 1334.256 + 20.0 = 1354.256 us > 1000 us slot!
  close(resTaLost.propagationRttUs, 1334.256, 1e-2, 'Propagation RTT match');
  assert.ok(
    resTaLost.propagationRttUs > 1000.0,
    'Two-way RTT at 200 km must exceed 1.0 ms slot duration'
  );
  assert.strictEqual(resTaLost.slotCollisionOutage, true, 'TA lost at 200 km must trigger slot collision outage');
  assert.strictEqual(resTaLost.usableSlotUs, 0.0, 'Usable slot duration must collapse to 0 us');
  assert.strictEqual(resTaLost.slotEfficiency, 0.0, 'Slot efficiency must collapse to 0.0');
  assert.strictEqual(resTaLost.frameDataEfficiency, 0.0, 'Frame data efficiency must collapse to 0.0');
  console.log(`  • TA Lost (200 km, 1 ms slot): Guard=${resTaLost.requiredGuardUs.toFixed(1)} us > 1000 us -> Outage=${resTaLost.slotCollisionOutage}, Frame Eff=${resTaLost.frameDataEfficiency}`);

  // Case C: Dedicated RACH Control Slots Overhead
  const resNoRach = computeDynamicTdmaOverhead({
    slotDurationMs,
    slotsPerFrame: 10,
    slantRangeM,
    timingAdvanceActive: true,
    rachControlSlotsPerFrame: 0,
  });

  const res2Rach = computeDynamicTdmaOverhead({
    slotDurationMs,
    slotsPerFrame: 10,
    slantRangeM,
    timingAdvanceActive: true,
    rachControlSlotsPerFrame: 2,
  });

  assert.strictEqual(resNoRach.dataSlotsPerFrame, 10, 'No RACH reservation must yield 10 data slots');
  assert.strictEqual(res2Rach.dataSlotsPerFrame, 8, '2 RACH reservation must yield 8 data slots');
  assert.strictEqual(res2Rach.controlSlotsPerFrame, 2, 'controlSlotsPerFrame must equal 2');

  // Allocation of 2 out of 10 slots to RACH reduces data capacity by exactly 20%
  const relativeEfficiency = res2Rach.frameDataEfficiency / resNoRach.frameDataEfficiency;
  close(relativeEfficiency, 0.80, 1e-6, '2/10 RACH reservation must reduce frame data efficiency by exactly 20%');
  console.log(`  • RACH Overhead: 0 RACH slots -> Eff=${resNoRach.frameDataEfficiency.toFixed(4)} | 2 RACH slots -> Eff=${res2Rach.frameDataEfficiency.toFixed(4)} (Ratio: ${(relativeEfficiency * 100).toFixed(1)}%)`);

  console.log('  -> PASS: Dynamic TDMA guard overhead, TA loss collapse, and RACH capacity reduction verified.');
}

// =============================================================================
// [TEST 5] Determinism, Robustness, NaN-Safety & Integration Hooks
// =============================================================================
console.log('\n[TEST 5] Verifying Determinism, NaN/Bounds Safety & Integration Hooks...');
{
  // 5.1 Bit-Exact PRNG Determinism
  const h1 = hashUnitInterval(9999, 12, 3, 2);
  const h2 = hashUnitInterval(9999, 12, 3, 2);
  assert.strictEqual(h1, h2, 'hashUnitInterval must produce bit-exact identical values for identical seeds');
  assert.ok(h1 >= 0.0 && h1 < 1.0, `hashUnitInterval output must strictly reside in [0, 1) (got ${h1})`);

  const hDifferent = hashUnitInterval(9999, 13, 3, 2);
  assert.notStrictEqual(h1, hDifferent, 'Different frame index must produce distinct hash values');

  // 5.2 NaN & Bounds Safety
  const lagNaN = computeCqiLagFrames(NaN, NaN, NaN);
  assert.strictEqual(Number.isFinite(lagNaN), true, 'computeCqiLagFrames must never return NaN');
  assert.ok(lagNaN >= 1, 'computeCqiLagFrames fallback must be at least 1');

  const ollaNaN = stepOllaOffsetDb(NaN, false, NaN, NaN, NaN, NaN);
  assert.strictEqual(Number.isFinite(ollaNaN), true, 'stepOllaOffsetDb must never return NaN');

  const amcNaN = evaluateDelayedCqiAmc({ reportedSnrDb: NaN, actualSnrDb: NaN, ollaOffsetDb: NaN });
  assert.strictEqual(Number.isFinite(amcNaN.bler), true, 'evaluateDelayedCqiAmc bler must never be NaN');
  assert.strictEqual(amcNaN.isLinkOutage, true, 'NaN SNR must declare link outage');

  const emptyCc = computeHarqCombinedSnrDb([]);
  assert.strictEqual(emptyCc, -Infinity, 'Empty SNR array must return -Infinity');

  const tdmaNaN = computeDynamicTdmaOverhead({
    slotDurationMs: NaN,
    slotsPerFrame: NaN,
    slantRangeM: NaN,
    timingAdvanceActive: true,
  });
  assert.strictEqual(Number.isFinite(tdmaNaN.requiredGuardUs), true, 'tdma guard must be finite');
  assert.strictEqual(Number.isFinite(tdmaNaN.frameDataEfficiency), true, 'tdma efficiency must be finite');

  // 5.3 tdmaConfig.ts Wrapper Delegation
  const cfg = new TdmaFrameConfig();
  const wrapperRes = evaluateRangeAwareTdmaEfficiency(cfg, 50000, true);
  assert.ok(wrapperRes.slotEfficiency > 0.9, 'Wrapper on standard config must yield > 90% slot efficiency at 50 km');
  assert.strictEqual(wrapperRes.slotCollisionOutage, false);

  // 5.4 Scheduler Integration Hook
  const node = new GroundNodeTrafficSubsystem(0, 'soldier', 100);
  node.queue.enqueue(100, 1, 0.0);
  const nodes = [node];
  const linkStatuses: Record<number, LinkStatus> = {
    0: {
      nodeType: 'soldier',
      slantRangeM: 50000,
      fsplDb: 140,
      diffractionLossDb: 0,
      gasLossDb: 0,
      rainLossDb: 0,
      cableLossDb: 0,
      implementationMarginDb: 0,
      totalLossDb: 140,
      pTxDbm: 30,
      txGainDbi: 0,
      rxGainDbi: 0,
      prxDbm: -110,
      pNoiseDbm: -120,
      snrDb: 10.0,
      modcodName: '8-PSK 3/5',
      spectralEfficiency: 1.78,
      bitrateBps: 8.9e6,
      bitrateMbps: 8.9,
      isOutage: false,
    },
  };
  const predictiveStates: Record<number, PredictiveState> = {
    0: {
      currentState: NodeTerrainState.LINE_OF_SIGHT,
      timeToOcclusionS: Infinity,
      timeToReemergenceS: 0,
      urgencyWeight: 1.0,
      imminentOcclusion: false,
    },
  };

  const staticSched = new LegacyStaticScheduler();
  const reportBaseline = staticSched.scheduleFrame(0, 0.0, nodes, linkStatuses, predictiveStates);
  const baselineCap = reportBaseline.allocations[0].capacityBits;

  // Run with macFeedbackOptions specifying 50% guard scale on Node 0
  const reportConstrained = staticSched.scheduleFrame(
    1,
    0.02,
    nodes,
    linkStatuses,
    predictiveStates,
    0,
    {
      nodeGuardScale: new Map([[0, 0.5]]),
      nodeDelayedCqiSnrDb: new Map([[0, 9.0]]),
      nodeOllaOffsetDb: new Map([[0, 1.0]]),
    }
  );

  const constrainedAlloc = reportConstrained.allocations[0];
  assert.strictEqual(constrainedAlloc.dynamicGuardOverheadScale, 0.5, 'Alloc must capture dynamicGuardOverheadScale');
  assert.strictEqual(constrainedAlloc.delayedCqiSnrDb, 9.0, 'Alloc must capture delayedCqiSnrDb');
  assert.strictEqual(constrainedAlloc.effectiveSnrDb, 8.0, 'Alloc must compute effectiveSnrDb = 9 - 1 = 8.0 dB');
  close(constrainedAlloc.capacityBits, Math.floor(baselineCap * 0.5), 1.0, 'Constrained capacity must be 50% of baseline');

  // Verify standalone capacity helper
  const helperCap = computeRangeConstrainedSlotCapacity(10000, 0.85);
  assert.strictEqual(helperCap, 8500, 'computeRangeConstrainedSlotCapacity helper must scale capacity');

  console.log('  -> PASS: Determinism, NaN/bounds safety, and scheduler integration hooks verified.');
}

// =============================================================================
// [TEST 6] 50 Hz Performance Micro-Benchmark (< 5 µs/call)
// =============================================================================
console.log('\n[TEST 6] Verifying 50 Hz sim loop performance micro-benchmark (< 5 µs/call)...');
{
  const iterations = 10000;
  let slot = createHarqProcessSlot(0);
  let olla = 0.5;

  const tStart = performance.now();

  for (let i = 0; i < iterations; i++) {
    // 1. Lag frames
    const lag = computeCqiLagFrames(120000, 20.0, 4.0);

    // 2. AMC evaluation
    const amc = evaluateDelayedCqiAmc({
      reportedSnrDb: 12.0,
      actualSnrDb: 10.5,
      ollaOffsetDb: olla,
    });

    // 3. Step OLLA
    olla = stepOllaOffsetDb(olla, amc.bler < 0.1, 0.1, 0.25);

    // 4. Step HARQ
    const harq = stepHarqProcess(slot, {
      currentTimeMs: i * 0.5,
      slantRangeM: 120000,
      actualSnrDb: 10.5,
      requiredSnrDb: 8.0,
      combiningMode: 'chase',
      frameIndex: i,
    });
    slot = harq.nextSlot;

    // 5. Dynamic TDMA overhead
    computeDynamicTdmaOverhead({
      slotDurationMs: 1.0,
      slotsPerFrame: 16,
      slantRangeM: 120000,
      timingAdvanceActive: true,
      rachControlSlotsPerFrame: 1,
    });
  }

  const tElapsedMs = performance.now() - tStart;
  const usPerCall = (tElapsedMs / iterations) * 1000.0;

  console.log(`  • Executed ${iterations} combined feedback evaluations in ${tElapsedMs.toFixed(2)} ms (${usPerCall.toFixed(3)} µs/call)`);
  assert.ok(
    tElapsedMs < 50.0,
    `10,000 evaluations must complete in < 50 ms (got ${tElapsedMs.toFixed(2)} ms)`
  );
  assert.ok(
    usPerCall < 5.0,
    `Per-call execution must be < 5.0 µs (got ${usPerCall.toFixed(3)} µs/call)`
  );

  console.log('  -> PASS: 50 Hz sim loop budget (< 5 µs/call) strictly preserved.');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL 6 MAC/PHY FEEDBACK DYNAMICS VERIFICATION TESTS PASSED SUCCESSFULLY (SUITE 90)');
console.log('='.repeat(96));
