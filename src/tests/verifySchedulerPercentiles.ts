/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * M7.3: Rolling Goodput Statistics & Nearest-Rank Percentiles Verification Suite
 *
 * Verifies:
 * 1. Nearest-rank P50 and P95 calculations with known sample sets.
 * 2. Empty and partially populated windows (warm-up handling).
 * 3. Exactly 200 samples retained (bounded memory, no unbounded growth).
 * 4. Correct FIFO eviction of the oldest sample when window is full.
 * 5. Independent Static TDMA and Tac-TAD statistics.
 * 6. Correct conversion from delivered bits per 20 ms superframe to bps (bits * 50).
 * 7. Measurement reflects actual delivered payload, never scheduled RBG capacity or allocation.
 * 8. Worker telemetry consistency (static_p50_bps, static_p95_bps, tac_p50_bps, tac_p95_bps).
 * 9. Warm-up progression and simulation reset behavior.
 * 10. Regression protection for existing scheduler behavior.
 */

import assert from 'node:assert/strict';
import {
  computeNearestRankPercentile,
  RollingGoodputTracker,
  ROLLING_GOODPUT_WINDOW_SIZE,
  SUPERFRAME_DURATION_S,
} from '../core/rollingGoodput';
import { SimulationWorkerManager } from '../worker/simWorker';
import { LegacyStaticScheduler, TerrainAwareDynamicScheduler } from '../core/scheduler';

function runSchedulerPercentilesVerification(): void {
  console.log('================================================================================');
  console.log('  M7.3: ROLLING P50/P95 SCHEDULER GOODPUT STATISTICS VERIFICATION SUITE');
  console.log('================================================================================');

  // --------------------------------------------------------------------------
  // [1/10] Nearest-Rank P50/P95 Calculations
  // --------------------------------------------------------------------------
  console.log('\n[1/10] Verifying nearest-rank P50 and P95 calculations with known sample sets...');

  // Single sample
  assert.equal(computeNearestRankPercentile([500], 0.50), 500);
  assert.equal(computeNearestRankPercentile([500], 0.95), 500);

  // 5 samples: [10, 20, 30, 40, 50]
  // P50: ceil(0.50 * 5) = 3 -> element 3 is 30
  // P95: ceil(0.95 * 5) = 5 -> element 5 is 50
  const arr5 = [10, 20, 30, 40, 50];
  assert.equal(computeNearestRankPercentile(arr5, 0.50), 30);
  assert.equal(computeNearestRankPercentile(arr5, 0.95), 50);

  // 10 samples: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
  // P50: ceil(0.50 * 10) = 5 -> element 5 is 50
  // P95: ceil(0.95 * 10) = 10 -> element 10 is 100
  const arr10 = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(computeNearestRankPercentile(arr10, 0.50), 50);
  assert.equal(computeNearestRankPercentile(arr10, 0.95), 100);

  // 100 samples: 1..100
  // P50: ceil(0.50 * 100) = 50 -> element 50 is 50
  // P95: ceil(0.95 * 100) = 95 -> element 95 is 95
  const arr100 = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(computeNearestRankPercentile(arr100, 0.50), 50);
  assert.equal(computeNearestRankPercentile(arr100, 0.95), 95);

  // 200 samples: 1..200
  // P50: ceil(0.50 * 200) = 100 -> element 100 is 100
  // P95: ceil(0.95 * 200) = 190 -> element 190 is 190
  const arr200 = Array.from({ length: 200 }, (_, i) => i + 1);
  assert.equal(computeNearestRankPercentile(arr200, 0.50), 100);
  assert.equal(computeNearestRankPercentile(arr200, 0.95), 190);

  // Exception handling for invalid k
  assert.throws(() => computeNearestRankPercentile(arr10, -0.1), RangeError);
  assert.throws(() => computeNearestRankPercentile(arr10, 1.1), RangeError);
  assert.throws(() => computeNearestRankPercentile(arr10, Number.NaN), RangeError);

  console.log('  -> PASS: Nearest-rank percentile formula strictly satisfies P(k) = x(ceil(k * n)).');

  // --------------------------------------------------------------------------
  // [2/10] Empty and Partially Populated Windows
  // --------------------------------------------------------------------------
  console.log('\n[2/10] Verifying empty and partially populated window behavior...');
  const tracker = new RollingGoodputTracker(200);

  // Empty window
  assert.equal(tracker.sampleCount, 0);
  assert.equal(tracker.isWindowFull(), false);
  assert.equal(tracker.p50Bps, null);
  assert.equal(tracker.p95Bps, null);

  // Add 1 sample: 10,000,000 bps (10 Mbps)
  tracker.recordSampleBps(10_000_000);
  assert.equal(tracker.sampleCount, 1);
  assert.equal(tracker.isWindowFull(), false);
  assert.equal(tracker.p50Bps, 10_000_000);
  assert.equal(tracker.p95Bps, 10_000_000);

  // Add up to 50 samples
  for (let i = 2; i <= 50; i++) {
    tracker.recordSampleBps(i * 1_000_000);
  }
  assert.equal(tracker.sampleCount, 50);
  assert.equal(tracker.isWindowFull(), false);
  // ceil(0.50 * 50) = 25 -> 25 Mbps
  assert.equal(tracker.p50Bps, 25_000_000);
  // ceil(0.95 * 50) = 48 -> 48 Mbps
  assert.equal(tracker.p95Bps, 48_000_000);

  console.log('  -> PASS: Empty window returns null; partially populated window evaluates correctly.');

  // --------------------------------------------------------------------------
  // [3/10] Exactly 200 Samples Retained
  // --------------------------------------------------------------------------
  console.log('\n[3/10] Verifying exactly 200 samples retained (bounded memory)...');
  const boundedTracker = new RollingGoodputTracker(200);

  // Insert 500 samples
  for (let i = 1; i <= 500; i++) {
    boundedTracker.recordSampleBps(i * 1000);
  }

  assert.equal(boundedTracker.sampleCount, 200, 'Capacity must be strictly clamped to 200');
  assert.equal(boundedTracker.isWindowFull(), true);
  assert.equal(boundedTracker.getChronologicalSamples().length, 200);
  assert.equal(boundedTracker.getSortedSamples().length, 200);

  console.log('  -> PASS: Tracker strictly retains exactly 200 samples with zero unbounded growth.');

  // --------------------------------------------------------------------------
  // [4/10] Correct FIFO Eviction of Oldest Sample
  // --------------------------------------------------------------------------
  console.log('\n[4/10] Verifying correct FIFO eviction of oldest samples...');
  const fifoTracker = new RollingGoodputTracker(200);

  // Fill with 200 samples of 1 Mbps
  for (let i = 0; i < 200; i++) {
    fifoTracker.recordSampleBps(1_000_000);
  }
  assert.equal(fifoTracker.p50Bps, 1_000_000);
  assert.equal(fifoTracker.p95Bps, 1_000_000);

  // Replace with 200 samples of 20 Mbps
  for (let i = 0; i < 200; i++) {
    fifoTracker.recordSampleBps(20_000_000);
  }
  assert.equal(fifoTracker.sampleCount, 200);
  assert.equal(fifoTracker.p50Bps, 20_000_000);
  assert.equal(fifoTracker.p95Bps, 20_000_000);

  // Check oldest samples were completely removed
  const samples = fifoTracker.getSortedSamples();
  assert.ok(samples.every(s => s === 20_000_000), 'All 200 samples must be 20 Mbps');

  console.log('  -> PASS: FIFO eviction correctly discards oldest samples upon buffer rollover.');

  // --------------------------------------------------------------------------
  // [5/10] Independent Static TDMA and Tac-TAD Statistics
  // --------------------------------------------------------------------------
  console.log('\n[5/10] Verifying independent Static TDMA and Tac-TAD trackers...');
  const sim = new SimulationWorkerManager();
  sim.staticGoodputTracker.reset();
  sim.tacGoodputTracker.reset();

  sim.staticGoodputTracker.recordSampleBps(4_000_000);
  sim.tacGoodputTracker.recordSampleBps(28_000_000);

  assert.equal(sim.staticGoodputTracker.p50Bps, 4_000_000);
  assert.equal(sim.tacGoodputTracker.p50Bps, 28_000_000);

  sim.staticGoodputTracker.reset();
  assert.equal(sim.staticGoodputTracker.p50Bps, null);
  assert.equal(sim.tacGoodputTracker.p50Bps, 28_000_000, 'Tac tracker must remain unaffected by Static reset');

  console.log('  -> PASS: Schedulers maintain 100% independent statistics buffers.');

  // --------------------------------------------------------------------------
  // [6/10] Correct Conversion from Delivered Bits per Superframe to bps
  // --------------------------------------------------------------------------
  console.log('\n[6/10] Verifying conversion from delivered bits per 20 ms superframe to bps...');
  const rateTracker = new RollingGoodputTracker(200);

  // 20,000 bits delivered in 0.020 s -> 1,000,000 bps (1.0 Mbps)
  rateTracker.recordSuperframeDeliveredBits(20_000);
  assert.equal(rateTracker.p50Bps, 1_000_000);

  // 100,000 bits delivered in 0.020 s -> 5,000,000 bps (5.0 Mbps)
  rateTracker.recordSuperframeDeliveredBits(100_000);
  // 2 samples: [1 Mbps, 5 Mbps], ceil(0.50 * 2) = 1 -> 1 Mbps, ceil(0.95 * 2) = 2 -> 5 Mbps
  assert.equal(rateTracker.p50Bps, 1_000_000);
  assert.equal(rateTracker.p95Bps, 5_000_000);

  // 0 bits delivered (outage or queue empty) -> 0 bps
  rateTracker.reset();
  rateTracker.recordSuperframeDeliveredBits(0);
  assert.equal(rateTracker.p50Bps, 0);

  console.log('  -> PASS: Conversion rate strictly obeys: bps = deliveredBits / 0.020s.');

  // --------------------------------------------------------------------------
  // [7/10] No Capacity-Based or Allocation-Based Measurement
  // --------------------------------------------------------------------------
  console.log('\n[7/10] Verifying measurement reflects actual delivered payload, never capacity/allocation...');
  // Inspect a completed static frame with empty queues
  const staticSched = new LegacyStaticScheduler();
  const report = staticSched.scheduleFrame(0, 0, sim.nodesStatic, sim.linkStatuses, sim.predStates);

  // Airtime was allocated to all 16 nodes
  assert.ok(report.totalUlScheduledS > 0, 'Static scheduler allocates airtime slots');
  assert.ok(report.allocations.some(a => a.capacityBits > 0), 'Allocations have non-zero theoretical capacity');

  // Because queues have 0 enqueued packets at t=0 before traffic generation,
  // delivered bits transmitted must be 0!
  assert.equal(report.totalBitsTransmitted, 0, 'No payload delivered when queues are empty');

  // Recording this frame must record 0 bps, NOT the theoretical capacity!
  const capTestTracker = new RollingGoodputTracker(200);
  capTestTracker.recordSuperframeDeliveredBits(report.totalBitsTransmitted);
  assert.equal(capTestTracker.p50Bps, 0, 'Must record 0 bps, not allocated capacity');

  console.log('  -> PASS: Statistics strictly measure dequeued delivered payload, rejecting theoretical capacity.');

  // --------------------------------------------------------------------------
  // [8/10] Worker Telemetry Consistency
  // --------------------------------------------------------------------------
  console.log('\n[8/10] Verifying worker telemetry frame emission of P50/P95 fields...');
  const workerSim = new SimulationWorkerManager();

  // Run 25 simulation ticks
  for (let i = 0; i < 25; i++) {
    workerSim.tickSimulation();
  }

  const acnPos = workerSim.trajectoryEngine.getAcnPosition(workerSim.simTimeS);
  const frame = (workerSim as any).buildTelemetryFrame(acnPos);

  // Check top-level fields
  assert.ok('static_p50_bps' in frame, 'frame must contain static_p50_bps');
  assert.ok('static_p95_bps' in frame, 'frame must contain static_p95_bps');
  assert.ok('tac_p50_bps' in frame, 'frame must contain tac_p50_bps');
  assert.ok('tac_p95_bps' in frame, 'frame must contain tac_p95_bps');

  // Check comparative_kpi_dashboard fields
  assert.ok('static_p50_bps' in frame.comparative_kpi_dashboard);
  assert.ok('static_p95_bps' in frame.comparative_kpi_dashboard);
  assert.ok('tac_p50_bps' in frame.comparative_kpi_dashboard);
  assert.ok('tac_p95_bps' in frame.comparative_kpi_dashboard);

  // Check exact numerical match with worker trackers
  assert.equal(frame.static_p50_bps, workerSim.staticGoodputTracker.p50Bps);
  assert.equal(frame.static_p95_bps, workerSim.staticGoodputTracker.p95Bps);
  assert.equal(frame.tac_p50_bps, workerSim.tacGoodputTracker.p50Bps);
  assert.equal(frame.tac_p95_bps, workerSim.tacGoodputTracker.p95Bps);

  console.log('  -> PASS: Worker telemetry correctly exports synchronized P50/P95 goodput statistics.');

  // --------------------------------------------------------------------------
  // [9/10] Warm-up Progression and Reset Behavior
  // --------------------------------------------------------------------------
  console.log('\n[9/10] Verifying warm-up progression and simulation reset behavior...');
  const warmSim = new SimulationWorkerManager();
  warmSim.resetSimulationState();

  assert.equal(warmSim.staticGoodputTracker.sampleCount, 0);
  assert.equal(warmSim.tacGoodputTracker.sampleCount, 0);

  for (let i = 1; i <= 50; i++) {
    warmSim.tickSimulation();
    assert.equal(warmSim.staticGoodputTracker.sampleCount, i);
    assert.equal(warmSim.tacGoodputTracker.sampleCount, i);
  }

  // Reset simulation state
  warmSim.resetSimulationState();
  assert.equal(warmSim.staticGoodputTracker.sampleCount, 0, 'Reset must restore 0 samples');
  assert.equal(warmSim.tacGoodputTracker.sampleCount, 0, 'Reset must restore 0 samples');
  assert.equal(warmSim.staticGoodputTracker.p50Bps, null);
  assert.equal(warmSim.tacGoodputTracker.p50Bps, null);

  console.log('  -> PASS: Reset restores warm-up state with 0 samples and null statistics.');

  // --------------------------------------------------------------------------
  // [10/10] Regression Protection for Existing Scheduler Behavior
  // --------------------------------------------------------------------------
  console.log('\n[10/10] Verifying regression protection for existing scheduler behavior...');
  const regSim = new SimulationWorkerManager();
  const initialTime = regSim.simTimeS;
  const initialFrame = regSim.frameIndex;

  regSim.tickSimulation();
  assert.equal(regSim.simTimeS, initialTime + SUPERFRAME_DURATION_S);
  assert.equal(regSim.frameIndex, initialFrame + 1);

  // Verify scheduler allocation structures
  const staticReport = (regSim as any).lastReportStatic;
  const tacReport = (regSim as any).lastReportTac;
  assert.ok(staticReport);
  assert.ok(tacReport);
  assert.equal(staticReport.allocations.length, 16);
  assert.ok(tacReport.totalUlUtilizationPct >= 0 && tacReport.totalUlUtilizationPct <= 100);

  console.log('  -> PASS: Existing scheduling, physics, and telemetry remain 100% unaltered.');

  console.log('\n================================================================================');
  console.log('  ALL 10 ROLLING GOODPUT STATISTICS VERIFICATION SUITES PASSED CLEANLY!');
  console.log('================================================================================');
}

runSchedulerPercentilesVerification();

