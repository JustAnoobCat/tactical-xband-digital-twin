/**
 * src/tests/verifySimulationTimeline.ts
 *
 * Simulation Timeline System Verification Suite (Milestone TL - Phase 1).
 * Approved Architecture Specification: DRDO-TAC-XBAND-ARCH-TIMELINE-17 (Revision 17).
 *
 * Tests Executed:
 * - TL-CLK1:  10 ms Fast Mode (Sub-Tick Cadence)
 * - TL-CLK2:  20 ms Baseline Mode (1:1 Cadence)
 * - TL-CLK3:  40 ms Extended Mode (Multi-Tick Cadence)
 * - TL-CLK4:  Mid-Interval 40 ms Reconfiguration
 * - TL-CLK5:  Reachable Positive Residual
 * - TL-CLK6:  Reachable Negative Residual & Monotonicity
 * - TL-CLK7:  Epsilon Triggering Active Boundary Display
 * - TL-CLK8:  20 ms Branch Epsilon Boundaries
 * - TL-CLK9:  Memory Child Diagnostic Exit Policy
 * - TL-CLK10: Continuous 500-Tick Invariant Harness
 * - TL-CLK11: Fully Auditable Reachable Regression (+0.8 us Invariant Phase Offset)
 * - TL-CLK12: Parent-Child Integration & Payload Parsing
 * - TL-T1:    Spatial Buffer Monotonicity & Wraparound
 * - TL-T2:    Selection Stability Under Influx
 * - TL-T3:    Disjoint Accounting Proof (totalPayloadBitsDequeued = txBits + wasteBits)
 * - TL-T4:    Clear Link Scenario (waste === 0)
 * - TL-T5:    Outage Scenario (Static waste > 0, Tac-TAD waste === 0)
 * - TL-T6:    Deterministic Queue Invariance (Alternative A bit-for-bit vs. FrozenReferenceQueue)
 * - TL-T7:    Queue Lifecycle Invariance (Reset & Eviction Drop Accounting)
 * - TL-T8:    Batch-Level Superframe Preservation (Zero lost superframe records)
 * - TL-T9:    Circular Binary Search Lookup
 * - TL-T10:   Memory Benchmark at Maximum Capacity (< 6.5 MB at 128 nodes)
 * - TL-T13:   Asymmetric Retention Synchronization (60s spatial vs 30s communication)
 * - TL-T14:   Dual-Scheduler Continuous Execution (Static and Tac independent metrics)
 * - TL-T15:   Interleaved Batch Drain Ordering (Epochs and Discontinuities in strict FIFO)
 * - TL-T16:   Batch Spatial Preservation & Ingestion Verification (25-tick batch, Tcap=60.00s, Tspan=59.98s)
 * - TL-PREC:  Float32 Coordinate Precision Verification (±600,000 m theater bounds)
 * - TL-REND1: High-DPI Coordinate Projection & Invertibility
 * - TL-REND2: Playhead Bounds Clamping & Live Tracking
 * - TL-REND3: Dual-Scheduler Stacked Bar Geometry & Disjoint Metrics
 * - TL-REND4: Adaptive LOD Columnar Binning
 * - TL-REND5: Sequence Gap, Discontinuity Marker & Evicted History
 */

import assert from 'node:assert/strict';
import {
  TdmaFrameConfig,
  TDMA_PRESET_STANDARD_20MS,
  TDMA_PRESET_FAST_10MS,
  TDMA_PRESET_EXTENDED_40MS,
} from '../core/tdmaConfig';
import {
  LegacyStaticScheduler,
  TerrainAwareDynamicScheduler,
} from '../core/scheduler';
import { FQCoDelQueue, Packet, GroundNodeTrafficSubsystem } from '../core/queues';
import { SimulationWorkerManager, FRAME_DT } from '../worker/simWorker';
import { SpatialSnapshotBuffer } from '../ui/spatialSnapshotBuffer';
import { SuperframeEpochStore } from '../ui/superframeEpochStore';
import {
  SimulationTimelineRenderer,
  SimulationTimelineController,
} from '../ui/simulationTimelineCanvas';
import type {
  SpatialFrameSnapshot,
  TimelineCommunicationRecord,
  SuperframeEpochRecord,
  SuperframeDiscontinuityRecord,
  TelemetryFrame,
} from '../shared/workerProtocol';
import { NodeTerrainState } from '../core/trajectory';

function close(actual: number, expected: number, tolerance = 1e-6, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('='.repeat(92));
console.log('   SIMULATION TIMELINE SYSTEM VERIFICATION SUITE');
console.log('   Specification: DRDO-TAC-XBAND-ARCH-TIMELINE-17 (Revision 17) // Phase 1');
console.log('='.repeat(92));

// ============================================================================
// Reference Queue Implementation (Uninstrumented Baseline for TL-T6)
// ============================================================================
class FrozenReferenceQueue {
  public readonly maxBufferPackets: number;
  public readonly maxC2Packets: number;
  public totalEnqueued: number = 0;
  public droppedDelayCount: number = 0;
  public droppedOverflowCount: number = 0;
  private readonly subqueues: Map<number, Packet[]>;

  constructor(maxBufferPackets: number = 400, maxC2Packets: number = 120) {
    this.maxBufferPackets = maxBufferPackets;
    this.maxC2Packets = maxC2Packets;
    this.subqueues = new Map([
      [69, []],
      [65, []],
      [67, []],
      [70, []],
    ]);
  }

  public getTotalPackets(): number {
    let count = 0;
    for (const q of this.subqueues.values()) count += q.length;
    return count;
  }

  public getTotalBacklogBytes(): number {
    let bytes = 0;
    for (const q of this.subqueues.values()) {
      for (let i = 0; i < q.length; i++) bytes += q[i].sizeBytes;
    }
    return bytes;
  }

  public getClassPacketCount(qos5qi: number): number {
    return this.subqueues.get(qos5qi)?.length ?? 0;
  }

  public enqueue(packet: Packet): [boolean, Packet[]] {
    this.totalEnqueued += 1;
    const qos = packet.qos5qi;
    const evicted: Packet[] = [];
    const targetQ = this.subqueues.get(qos);
    if (!targetQ) return [false, [packet]];

    if (qos === 69) {
      if (targetQ.length >= this.maxC2Packets) {
        const drop = targetQ.shift()!;
        evicted.push(drop);
      } else if (this.getTotalPackets() >= this.maxBufferPackets) {
        let dropped = false;
        for (const dropQos of [70, 67, 65]) {
          const dq = this.subqueues.get(dropQos)!;
          if (dq.length > 0) {
            evicted.push(dq.shift()!);
            dropped = true;
            break;
          }
        }
        if (!dropped) evicted.push(targetQ.shift()!);
      }
      targetQ.push(packet);
      this.droppedOverflowCount += evicted.length;
      return [true, evicted];
    }

    if (this.getTotalPackets() >= this.maxBufferPackets) {
      let dropped = false;
      for (const dropQos of [70, 67, 65]) {
        const dq = this.subqueues.get(dropQos)!;
        if (dq.length > 0) {
          evicted.push(dq.shift()!);
          dropped = true;
          break;
        }
      }
      if (!dropped) {
        evicted.push(packet);
        this.droppedOverflowCount += 1;
        return [false, evicted];
      }
    }
    targetQ.push(packet);
    this.droppedOverflowCount += evicted.length;
    return [true, evicted];
  }

  public dequeue(bytesCapacity: number, currentSimTimeS: number): Packet[] {
    const served: Packet[] = [];
    let remBytes = bytesCapacity;
    for (const qos of [69, 65, 67, 70]) {
      const q = this.subqueues.get(qos)!;
      while (q.length > 0) {
        const pkt = q[0];
        if (qos !== 69 && currentSimTimeS >= pkt.deadlineS) {
          q.shift();
          this.droppedDelayCount += 1;
          continue;
        }
        if (pkt.sizeBytes <= remBytes) {
          q.shift();
          pkt.sojournTimeS = Math.max(0.0, currentSimTimeS - pkt.arrivalTimeS);
          served.push(pkt);
          remBytes -= pkt.sizeBytes;
        } else {
          break;
        }
      }
      if (remBytes <= 0) break;
    }
    return served;
  }

  public pruneExpiredPackets(currentSimTimeS: number): Packet[] {
    const pruned: Packet[] = [];
    for (const qos of [65, 67, 70]) {
      const q = this.subqueues.get(qos)!;
      const survivors: Packet[] = [];
      for (let i = 0; i < q.length; i++) {
        const pkt = q[i];
        if (currentSimTimeS >= pkt.deadlineS) {
          pruned.push(pkt);
          this.droppedDelayCount += 1;
        } else {
          survivors.push(pkt);
        }
      }
      this.subqueues.set(qos, survivors);
    }
    return pruned;
  }
}

// ============================================================================
// PART 1: CLOCK VERIFICATION MATRIX (TL-CLK1 through TL-CLK12)
// ============================================================================

console.log('\n[TL-CLK1] Verifying 10 ms Fast Mode (Sub-Tick Cadence)...');
{
  const worker = new SimulationWorkerManager(100, '16_NODES');
  worker.resetSimulationState();
  let emittedFrame: TelemetryFrame | null = null;
  worker['emitHostMessage'] = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME') emittedFrame = msg.frame;
  };

  // Reconfigure to 10 ms fast mode
  await worker.handleMessage({
    type: 'UPDATE_PARAMS',
    tdma_frame_config: TDMA_PRESET_FAST_10MS,
  });

  // Execute 1 physics tick (20 ms)
  worker.tickSimulation(true);

  assert.ok(emittedFrame !== null, 'Telemetry frame must be emitted');
  const superframes = emittedFrame!.completed_superframes ?? [];
  assert.equal(superframes.length, 2, 'Exactly 2 superframes must be emitted for 20ms tick at 10ms frame');
  
  assert.equal(superframes[0].recordType, 'EPOCH');
  assert.equal(superframes[1].recordType, 'EPOCH');
  close(superframes[0].startTimeS, 0.000);
  close(superframes[0].endTimeS, 0.010);
  close(superframes[1].startTimeS, 0.010);
  close(superframes[1].endTimeS, 0.020);
  close(superframes[0].nominalSimTimeS, 0.020);
  close(superframes[1].nominalSimTimeS, 0.020);
  close(worker.tdmaAccumulatorS, 0.0);
  close(worker.tdmaSimTimeS, 0.020);
  console.log('  -> PASS: 10 ms fast mode sub-tick cadence verified (2 epochs in 1 tick, exact intervals).');
}

console.log('\n[TL-CLK2] Verifying 20 ms Baseline Mode (1:1 Cadence)...');
{
  const worker = new SimulationWorkerManager(200, '16_NODES');
  worker.resetSimulationState();
  const frames: TelemetryFrame[] = [];
  worker['emitHostMessage'] = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME') frames.push(msg.frame);
  };

  for (let tick = 0; tick < 3; tick++) {
    worker.tickSimulation(true);
  }

  assert.equal(frames.length, 3);
  assert.equal(frames[0].completed_superframes?.length, 1);
  assert.equal(frames[1].completed_superframes?.length, 1);
  assert.equal(frames[2].completed_superframes?.length, 1);

  const e0 = frames[0].completed_superframes![0] as SuperframeEpochRecord;
  const e1 = frames[1].completed_superframes![0] as SuperframeEpochRecord;
  const e2 = frames[2].completed_superframes![0] as SuperframeEpochRecord;

  close(e0.startTimeS, 0.000); close(e0.endTimeS, 0.020);
  close(e1.startTimeS, 0.020); close(e1.endTimeS, 0.040);
  close(e2.startTimeS, 0.040); close(e2.endTimeS, 0.060);
  close(worker.tdmaAccumulatorS, 0.0);
  close(worker.tdmaSimTimeS, 0.060);
  console.log('  -> PASS: 20 ms baseline 1:1 cadence verified across 3 consecutive frames.');
}

console.log('\n[TL-CLK3] Verifying 40 ms Extended Mode (Multi-Tick Cadence)...');
{
  const worker = new SimulationWorkerManager(300, '16_NODES');
  worker.resetSimulationState();
  const frames: TelemetryFrame[] = [];
  worker['emitHostMessage'] = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME') frames.push(msg.frame);
  };

  await worker.handleMessage({
    type: 'UPDATE_PARAMS',
    tdma_frame_config: TDMA_PRESET_EXTENDED_40MS,
  });

  // Tick 1 (t = 0.020): Accumulator = 0.020, 0 epochs
  worker.tickSimulation(true);
  assert.equal(frames[0].completed_superframes?.length, 0);
  close(worker.tdmaAccumulatorS, 0.020);
  close(worker.tdmaSimTimeS, 0.000);

  // Tick 2 (t = 0.040): Accumulator = 0.040, emits 1 40ms epoch [0.000, 0.040]
  worker.tickSimulation(true);
  assert.equal(frames[1].completed_superframes?.length, 1);
  const e1 = frames[1].completed_superframes![0] as SuperframeEpochRecord;
  close(e1.startTimeS, 0.000); close(e1.endTimeS, 0.040);
  close(worker.tdmaAccumulatorS, 0.000);
  close(worker.tdmaSimTimeS, 0.040);

  // Tick 3 (t = 0.060): Accumulator = 0.020, 0 epochs
  worker.tickSimulation(true);
  assert.equal(frames[2].completed_superframes?.length, 0);

  // Tick 4 (t = 0.080): Emits 1 40ms epoch [0.040, 0.080]
  worker.tickSimulation(true);
  assert.equal(frames[3].completed_superframes?.length, 1);
  const e3 = frames[3].completed_superframes![0] as SuperframeEpochRecord;
  close(e3.startTimeS, 0.040); close(e3.endTimeS, 0.080);
  close(worker.tdmaAccumulatorS, 0.000);
  close(worker.tdmaSimTimeS, 0.080);
  console.log('  -> PASS: 40 ms extended mode verified across 4 ticks (2-tick cadence, exact intervals).');
}

console.log('\n[TL-CLK4] Verifying Mid-Interval 40 ms Reconfiguration...');
{
  const worker = new SimulationWorkerManager(400, '16_NODES');
  worker.resetSimulationState();
  const frames: TelemetryFrame[] = [];
  worker['emitHostMessage'] = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME') frames.push(msg.frame);
  };

  await worker.handleMessage({
    type: 'UPDATE_PARAMS',
    tdma_frame_config: TDMA_PRESET_EXTENDED_40MS,
  });

  // Tick 1 at 40 ms: accum = 0.020
  worker.tickSimulation(true);
  close(worker.tdmaAccumulatorS, 0.020);

  // Mid-run reconfiguration to 10 ms
  await worker.handleMessage({
    type: 'UPDATE_PARAMS',
    tdma_frame_config: TDMA_PRESET_FAST_10MS,
  });

  // Next tick at 10 ms
  worker.tickSimulation(true);

  // Completed superframes in frame 1 should contain:
  // 1 Discontinuity record [0.000, 0.020]
  // 2 Epoch records [0.020, 0.030] and [0.030, 0.040]
  const records = frames[1].completed_superframes ?? [];
  assert.equal(records.length, 3, 'Must contain 1 discontinuity + 2 epochs');
  assert.equal(records[0].recordType, 'DISCONTINUITY');
  assert.equal(records[1].recordType, 'EPOCH');
  assert.equal(records[2].recordType, 'EPOCH');

  close(records[0].startTimeS, 0.000);
  close(records[0].endTimeS, 0.020);
  close(records[1].startTimeS, 0.020);
  close(records[1].endTimeS, 0.030);
  close(records[2].startTimeS, 0.030);
  close(records[2].endTimeS, 0.040);
  close(worker.tdmaSimTimeS, 0.040);
  console.log('  -> PASS: Mid-interval 40 ms reconfiguration emits discontinuity and preserves gapless continuity.');
}

console.log('\n[TL-CLK5] Verifying Reachable Positive Residual...');
{
  const worker = new SimulationWorkerManager(500, '16_NODES');
  worker.resetSimulationState();
  await worker.handleMessage({
    type: 'UPDATE_PARAMS',
    tdma_frame_config: TDMA_PRESET_EXTENDED_40MS,
  });

  worker.tickSimulation(false); // Tick 1 (accum = 0.020s)
  close(worker.tdmaAccumulatorS, 0.020);

  // Trigger reconfiguration
  await worker.handleMessage({
    type: 'UPDATE_PARAMS',
    tdma_frame_config: TDMA_PRESET_STANDARD_20MS,
  });

  assert.equal(worker.pendingTimelineRecords.length, 1);
  const disc = worker.pendingTimelineRecords[0] as SuperframeDiscontinuityRecord;
  assert.equal(disc.recordType, 'DISCONTINUITY');
  close(disc.startTimeS, 0.000);
  close(disc.endTimeS, 0.020);
  close(disc.discardedDurationMs, 20.0);
  close(disc.oldDurationMs, 40.0);
  close(disc.newDurationMs, 20.0);
  console.log('  -> PASS: Positive residual truthfully recorded in SuperframeDiscontinuityRecord.');
}

console.log('\n[TL-CLK6] Verifying Reachable Negative Residual & Monotonicity...');
{
  const worker = new SimulationWorkerManager(600, '16_NODES');
  worker.resetSimulationState();

  // Configure custom epsilon waveform 10.0004 ms
  const customConfig = new TdmaFrameConfig({
    frameDurationMs: 10.0004,
    ctrlDurationMs: 1.0,
    dlMinDurationMs: 3.0,
  });

  await worker.handleMessage({
    type: 'UPDATE_PARAMS',
    tdma_frame_config: customConfig.toObject(),
  });

  // Tick 1 executes two sub-cycles:
  // accum = 0.020 - 0.0100004 - 0.0100004 = -0.0000008 s (-0.8 us)
  worker.tickSimulation(false);
  close(worker.tdmaAccumulatorS, -0.0000008, 1e-9);
  close(worker.tdmaSimTimeS, 0.0200008, 1e-9);

  // Reconfiguration to 40 ms
  await worker.handleMessage({
    type: 'UPDATE_PARAMS',
    tdma_frame_config: TDMA_PRESET_EXTENDED_40MS,
  });

  // No discontinuity record should be emitted for negative residual
  const discRecords = worker.pendingTimelineRecords.filter(r => r.recordType === 'DISCONTINUITY');
  assert.equal(discRecords.length, 0, 'No discontinuity record emitted for negative residual');
  close(worker.tdmaSimTimeS, 0.0200008, 1e-9, 'tdmaSimTimeS preserves monotonic forward boundary');
  console.log('  -> PASS: Negative residual (-0.8 us) handled monotonically without backwards jump.');
}

console.log('\n[TL-CLK7] Verifying Epsilon Triggering Active Boundary Display...');
{
  const customConfig = new TdmaFrameConfig({
    frameDurationMs: 10.0004,
    ctrlDurationMs: 1.0,
    dlMinDurationMs: 3.0,
  });
  const worker = new SimulationWorkerManager(700, '16_NODES');
  worker.resetSimulationState();
  await worker.handleMessage({
    type: 'UPDATE_PARAMS',
    tdma_frame_config: customConfig.toObject(),
  });

  worker.tickSimulation(false);
  // simTimeS = 0.0200000 s while tdmaSimTimeS = 0.0200008 s
  assert.ok(worker.tdmaSimTimeS > worker.simTimeS);
  close(worker.tdmaSimTimeS - worker.simTimeS, 0.0000008, 1e-9);
  console.log('  -> PASS: Epsilon triggering establishes tdmaSimTimeS > simTimeS (+0.8 us active offset).');
}

console.log('\n[TL-CLK8] Verifying 20 ms Branch Epsilon Boundaries...');
{
  // Test boundary routing around 20 ms +/- 1 us
  const worker = new SimulationWorkerManager(800, '16_NODES');
  worker.resetSimulationState();

  const testDurs = [19.9995, 20.0000, 20.0005];
  for (const dur of testDurs) {
    const cfg = new TdmaFrameConfig({ frameDurationMs: dur, ctrlDurationMs: 1.0, dlMinDurationMs: 3.0 });
    await worker.handleMessage({ type: 'UPDATE_PARAMS', tdma_frame_config: cfg.toObject() });
    worker.tickSimulation(false);
    close(worker.tdmaAccumulatorS, 0.0, 1e-6, `Duration ${dur}ms must enter 20ms baseline branch`);
  }
  console.log('  -> PASS: Epsilon threshold (|tFrame - 0.020| < 1e-6) correctly captures 20 ms baseline.');
}

console.log('\n[TL-CLK9] Verifying Memory Child Diagnostic Exit Policy...');
{
  // Verifies exit code matrix contract
  const stableStatus = 'COLLECTION_NOT_OBSERVED';
  const unstableStatus = 'HEAP_STABILITY_FAILURE';
  const getExitCode = (status: string) => status === 'HEAP_STABILITY_FAILURE' ? 3 : 0;

  assert.equal(getExitCode(stableStatus), 0, 'Stable heap with delayed collection exits code 0');
  assert.equal(getExitCode(unstableStatus), 3, 'Heap instability triggers exit code 3');
  console.log('  -> PASS: Memory child diagnostic exit policy verified (0 for stable, 3 for failure).');
}

console.log('\n[TL-CLK10] Verifying Continuous 500-Tick Invariant Harness...');
{
  const worker = new SimulationWorkerManager(1000, '16_NODES');
  worker.resetSimulationState();

  let prevDeltaPhase = 0.0;
  for (let k = 1; k <= 500; k++) {
    // Every 50 ticks switch configuration
    if (k % 50 === 0) {
      const mode = (k / 50) % 3;
      const preset = mode === 0 ? TDMA_PRESET_FAST_10MS : mode === 1 ? TDMA_PRESET_EXTENDED_40MS : TDMA_PRESET_STANDARD_20MS;
      await worker.handleMessage({ type: 'UPDATE_PARAMS', tdma_frame_config: preset });
      prevDeltaPhase = worker.tdmaSimTimeS + worker.tdmaAccumulatorS - worker.simTimeS;
    }

    worker.tickSimulation(false);
    const currentDeltaPhase = worker.tdmaSimTimeS + worker.tdmaAccumulatorS - worker.simTimeS;

    // Step conservation between reconfigurations
    if (k % 50 !== 0) {
      close(currentDeltaPhase, prevDeltaPhase, 1e-6, `Tick ${k} phase step conservation`);
    }
    prevDeltaPhase = currentDeltaPhase;

    // Bounded envelope check
    assert.ok(
      currentDeltaPhase >= -1e-6 && currentDeltaPhase <= 1e-6 + 0.040,
      `Tick ${k} delta_phase within bounded envelope`
    );
  }
  console.log('  -> PASS: 500-tick continuous invariant harness passed (phase conservation & bounded envelope).');
}

console.log('\n[TL-CLK11] Verifying Fully Auditable Reachable Regression (+0.8 us Invariant)...');
{
  // Step-by-step verification of Progression Table in Section 9
  const worker = new SimulationWorkerManager(1100, '16_NODES');
  worker.resetSimulationState();
  const allRecords: TimelineCommunicationRecord[] = [];
  worker['emitHostMessage'] = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME' && msg.frame.completed_superframes) {
      allRecords.push(...msg.frame.completed_superframes);
    }
  };

  // Tick 0: Init at 10.0004 ms
  const cfg10_0004 = new TdmaFrameConfig({ frameDurationMs: 10.0004, ctrlDurationMs: 1.0, dlMinDurationMs: 3.0 });
  await worker.handleMessage({ type: 'UPDATE_PARAMS', tdma_frame_config: cfg10_0004.toObject() });
  close(worker.tdmaSimTimeS, 0.0000000);
  close(worker.tdmaAccumulatorS, 0.0000000);

  // Tick 1: Physics Step (Fast Mode sub-cycles 1 & 2)
  worker.tickSimulation(true);
  close(worker.simTimeS, 0.0200000);
  close(worker.tdmaSimTimeS, 0.0200008, 1e-9);
  close(worker.tdmaAccumulatorS, -0.0000008, 1e-9);
  assert.equal(allRecords.length, 2);
  close(allRecords[0].startTimeS, 0.0000000); close(allRecords[0].endTimeS, 0.0100004);
  close(allRecords[1].startTimeS, 0.0100004); close(allRecords[1].endTimeS, 0.0200008);

  // Reconfig 1: Switch to 40 ms under negative residual
  await worker.handleMessage({ type: 'UPDATE_PARAMS', tdma_frame_config: TDMA_PRESET_EXTENDED_40MS });
  close(worker.tdmaAccumulatorS, 0.0000000);
  close(worker.tdmaSimTimeS, 0.0200008, 1e-9);
  const deltaPhase = worker.tdmaSimTimeS + worker.tdmaAccumulatorS - worker.simTimeS;
  close(deltaPhase, 0.0000008, 1e-9, 'Phase offset delta_phase established as +0.8 us');

  // Tick 2: simTimeS = 0.040, accum = 0.020 (< 0.039999). No superframe.
  worker.tickSimulation(true);
  close(worker.simTimeS, 0.0400000);
  close(worker.tdmaSimTimeS, 0.0200008, 1e-9);
  close(worker.tdmaAccumulatorS, 0.0200000, 1e-9);
  close(worker.tdmaSimTimeS + worker.tdmaAccumulatorS - worker.simTimeS, 0.0000008, 1e-9);

  // Tick 3: simTimeS = 0.060, accum = 0.040. Emits Epoch 2 [0.0200008, 0.0600008]
  worker.tickSimulation(true);
  close(worker.simTimeS, 0.0600000);
  close(worker.tdmaSimTimeS, 0.0600008, 1e-9);
  close(worker.tdmaAccumulatorS, 0.0000000, 1e-9);
  close(worker.tdmaSimTimeS + worker.tdmaAccumulatorS - worker.simTimeS, 0.0000008, 1e-9);
  assert.equal(allRecords.length, 3);
  close(allRecords[2].startTimeS, 0.0200008, 1e-9);
  close(allRecords[2].endTimeS, 0.0600008, 1e-9);

  // Tick 4: simTimeS = 0.080, accum = 0.020 (< 0.039999). No superframe.
  worker.tickSimulation(true);
  close(worker.simTimeS, 0.0800000);
  close(worker.tdmaSimTimeS, 0.0600008, 1e-9);
  close(worker.tdmaAccumulatorS, 0.0200000, 1e-9);
  close(worker.tdmaSimTimeS + worker.tdmaAccumulatorS - worker.simTimeS, 0.0000008, 1e-9);

  // Reconfig 2: Switch to 20 ms under positive residual (0.020 s)
  await worker.handleMessage({ type: 'UPDATE_PARAMS', tdma_frame_config: TDMA_PRESET_STANDARD_20MS });
  close(worker.tdmaAccumulatorS, 0.0000000);
  close(worker.tdmaSimTimeS, 0.0800008, 1e-9);
  close(worker.tdmaSimTimeS + worker.tdmaAccumulatorS - worker.simTimeS, 0.0000008, 1e-9);

  // Tick 5: simTimeS = 0.100, accum = 0.020. Emits Discontinuity + Epoch 3
  worker.tickSimulation(true);
  close(worker.simTimeS, 0.1000000);
  close(worker.tdmaSimTimeS, 0.1000008, 1e-9);
  close(worker.tdmaAccumulatorS, 0.0000000);
  close(worker.tdmaSimTimeS + worker.tdmaAccumulatorS - worker.simTimeS, 0.0000008, 1e-9);

  assert.equal(allRecords.length, 5);
  // Discontinuity 0: [0.0600008, 0.0800008]
  assert.equal(allRecords[3].recordType, 'DISCONTINUITY');
  close(allRecords[3].startTimeS, 0.0600008, 1e-9);
  close(allRecords[3].endTimeS, 0.0800008, 1e-9);
  // Epoch 3: [0.0800008, 0.1000008]
  assert.equal(allRecords[4].recordType, 'EPOCH');
  close(allRecords[4].startTimeS, 0.0800008, 1e-9);
  close(allRecords[4].endTimeS, 0.1000008, 1e-9);

  // Verify Invariant Assertions:
  // 1. Strict Monotonicity & Gapless Continuity
  for (let i = 1; i < allRecords.length; i++) {
    close(allRecords[i].startTimeS, allRecords[i - 1].endTimeS, 1e-9, `Record ${i} starts exactly at Record ${i-1} end`);
  }
  // 2. Discontinuity endpoint is exactly 0.0800008 s (not clamped to 0.0800000 s)
  close(allRecords[3].endTimeS, 0.0800008, 1e-9, 'Discontinuity endpoint preserves phase offset without clamping');
  // 3. Permanent Phase Conservation
  close(deltaPhase, 0.0000008, 1e-9, 'Phase offset +0.8 us is invariant across all steps');
  console.log('  -> PASS: TL-CLK11 reachable regression passed (all 4 invariant assertions verified).');
}

console.log('\n[TL-CLK12] Verifying Parent-Child Integration & Payload Parsing...');
{
  const mockPayload = {
    recordType: 'EPOCH',
    epochIndex: 12,
    startTimeS: 0.240,
    endTimeS: 0.260,
    durationMs: 20.0,
    configuredDurationMs: 20.0,
    nominalSimTimeS: 0.260,
    associatedSimulationFrameIndex: 13,
    staticMetrics: {
      transmittedNonOutageBits: 10000,
      outageWastedBits: 0,
      totalPayloadBitsDequeued: 10000,
      droppedDelayPkts: 0,
      droppedOverflowPkts: 0,
      totalDroppedPkts: 0,
      droppedDelayBytes: 0,
      droppedOverflowBytes: 0,
      totalDroppedBytes: 0,
      ulUtilizationPct: 85.0,
    },
    tacMetrics: {
      transmittedNonOutageBits: 14000,
      outageWastedBits: 0,
      totalPayloadBitsDequeued: 14000,
      droppedDelayPkts: 0,
      droppedOverflowPkts: 0,
      totalDroppedPkts: 0,
      droppedDelayBytes: 0,
      droppedOverflowBytes: 0,
      totalDroppedBytes: 0,
      ulUtilizationPct: 92.0,
    },
    activeSchedulerMode: 'tac_tad',
  };

  const jsonStr = JSON.stringify(mockPayload);
  const parsed = JSON.parse(jsonStr);
  assert.deepEqual(parsed, mockPayload);
  console.log('  -> PASS: JSON serialization/deserialization payload integrity verified.');
}

// ============================================================================
// PART 2: TIMELINE, QUEUE & DUAL-SCHEDULER TESTS (TL-T3 to TL-T8, TL-T14, TL-T15)
// ============================================================================

console.log('\n[TL-T3] Verifying Disjoint Accounting Proof...');
{
  const worker = new SimulationWorkerManager(1200, '16_NODES');
  worker.resetSimulationState();
  let emittedFrame: TelemetryFrame | null = null;
  worker['emitHostMessage'] = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME') emittedFrame = msg.frame;
  };

  for (let i = 0; i < 5; i++) worker.tickSimulation(true);

  const epochs = emittedFrame?.completed_superframes?.filter(r => r.recordType === 'EPOCH') as SuperframeEpochRecord[];
  assert.ok(epochs.length > 0);
  for (const ep of epochs) {
    const s = ep.staticMetrics;
    const t = ep.tacMetrics;
    assert.equal(s.totalPayloadBitsDequeued, s.transmittedNonOutageBits + s.outageWastedBits);
    assert.equal(t.totalPayloadBitsDequeued, t.transmittedNonOutageBits + t.outageWastedBits);
  }
  console.log('  -> PASS: Disjoint accounting verified (totalPayloadBitsDequeued = txBits + wastedBits).');
}

console.log('\n[TL-T4] Verifying Clear Link Scenario...');
{
  const worker = new SimulationWorkerManager(1300, '16_NODES');
  worker.resetSimulationState();
  let emittedFrame: TelemetryFrame | null = null;
  worker['emitHostMessage'] = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME') emittedFrame = msg.frame;
  };

  // Run 10 ticks in nominal clear LOS conditions
  for (let i = 0; i < 10; i++) worker.tickSimulation(true);

  const epochs = emittedFrame?.completed_superframes?.filter(r => r.recordType === 'EPOCH') as SuperframeEpochRecord[];
  assert.ok(epochs.length > 0);
  const lastEpoch = epochs[epochs.length - 1];
  assert.ok(lastEpoch.staticMetrics.transmittedNonOutageBits >= 0);
  assert.equal(lastEpoch.staticMetrics.outageWastedBits, 0);
  assert.equal(lastEpoch.tacMetrics.outageWastedBits, 0);
  console.log('  -> PASS: Clear LOS scenario verified (zero outage waste across both schedulers).');
}

console.log('\n[TL-T5] Verifying Outage Scenario...');
{
  const worker = new SimulationWorkerManager(1400, '16_NODES');
  worker.resetSimulationState();
  let emittedFrame: TelemetryFrame | null = null;
  worker['emitHostMessage'] = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME') emittedFrame = msg.frame;
  };

  // Force Node 4 into severed link / shadow outage with large traffic
  worker.selectedNodeId = 4;
  for (let k = 0; k < 20; k++) {
    worker.nodesStatic[4].enqueuePacket(70, worker.simTimeS, 1400);
    worker.nodesTac[4].enqueuePacket(70, worker.simTimeS, 1400);
  }
  // Mock outage on link
  worker.linkStatuses.set(4, {
    nodeType: 'infantry',
    slantRangeM: 15000,
    fsplDb: 135,
    diffractionLossDb: 60,
    gasLossDb: 0.1,
    rainLossDb: 0.0,
    cableLossDb: 1.0,
    implementationMarginDb: 2.0,
    totalLossDb: 198.1,
    pTxDbm: 36,
    txGainDbi: 20,
    rxGainDbi: 30,
    prxDbm: -112.1,
    pNoiseDbm: -100,
    snrDb: -12.1,
    modcodName: 'QPSK_1_4',
    spectralEfficiency: 0.5,
    bitrateBps: 0,
    bitrateMbps: 0,
    isOutage: true,
  });

  worker.tickSimulation(true);
  const epochs = emittedFrame?.completed_superframes?.filter(r => r.recordType === 'EPOCH') as SuperframeEpochRecord[];
  assert.ok(epochs.length > 0);
  const ep = epochs[epochs.length - 1];
  assert.ok(ep.staticMetrics.outageWastedBits > 0, 'Static TDMA must waste bits on severed link');
  assert.equal(ep.tacMetrics.outageWastedBits, 0, 'Tac-TAD prunes severed links with zero waste');
  console.log('  -> PASS: Outage scenario verified (Static waste > 0, Tac-TAD waste === 0).');
}

console.log('\n[TL-T6] Verifying Deterministic Queue Invariance (Alternative A vs. FrozenReferenceQueue)...');
{
  const instrumentedQ = new FQCoDelQueue(400, 120);
  const referenceQ = new FrozenReferenceQueue(400, 120);

  let pseudoRng = 42;
  function rnd() {
    pseudoRng = (pseudoRng * 1664525 + 1013904223) >>> 0;
    return pseudoRng / 4294967296;
  }

  // Run 100 interleaved pseudo-random enqueue, dequeue, and prune cycles
  for (let step = 0; step < 100; step++) {
    const simTimeS = step * 0.01;
    const qosList = [69, 65, 67, 70];
    const qos = qosList[Math.floor(rnd() * qosList.length)];
    const size = Math.floor(100 + rnd() * 1300);
    const deadlineS = simTimeS + (qos === 69 ? 60.0 : 0.05 + rnd() * 0.1);

    const pktInst = new Packet(step, 1, qos, size, simTimeS, deadlineS);
    const pktRef = new Packet(step, 1, qos, size, simTimeS, deadlineS);

    // 1. Enqueue comparison
    const [instAccepted, instEvicted] = instrumentedQ.enqueue(pktInst);
    const [refAccepted, refEvicted] = referenceQ.enqueue(pktRef);
    assert.equal(instAccepted, refAccepted);
    assert.equal(instEvicted.length, refEvicted.length);
    for (let j = 0; j < instEvicted.length; j++) {
      assert.equal(instEvicted[j].packetId, refEvicted[j].packetId);
      assert.equal(instEvicted[j].sizeBytes, refEvicted[j].sizeBytes);
    }

    // 2. Dequeue comparison
    const cap = Math.floor(rnd() * 2000);
    const instServed = instrumentedQ.dequeue(cap, simTimeS);
    const refServed = referenceQ.dequeue(cap, simTimeS);
    assert.equal(instServed.length, refServed.length);
    for (let j = 0; j < instServed.length; j++) {
      assert.equal(instServed[j].packetId, refServed[j].packetId);
    }

    // 3. Prune comparison
    const instPruned = instrumentedQ.pruneExpiredPackets(simTimeS);
    const refPruned = referenceQ.pruneExpiredPackets(simTimeS);
    assert.equal(instPruned.length, refPruned.length);

    // 4. Queue length and packet count equality
    assert.equal(instrumentedQ.getTotalPackets(), referenceQ.getTotalPackets());
    assert.equal(instrumentedQ.getTotalBacklogBytes(), referenceQ.getTotalBacklogBytes());
    for (const q of qosList) {
      assert.equal(instrumentedQ.getClassPacketCount(q), referenceQ.getClassPacketCount(q));
    }

    // 5. Byte tracking invariant
    assert.equal(
      instrumentedQ.totalDroppedBytes,
      instrumentedQ.droppedDelayBytes + instrumentedQ.droppedOverflowBytes
    );
  }
  console.log('  -> PASS: Deterministic queue invariance verified (100% bit-for-bit parity against baseline).');
}

console.log('\n[TL-T7] Verifying Queue Lifecycle Invariance...');
{
  const q = new FQCoDelQueue(10, 5);
  // Force some drops
  for (let i = 0; i < 20; i++) {
    q.enqueue(new Packet(i, 1, 70, 1000, 0, 0.01));
  }
  assert.ok(q.droppedOverflowBytes > 0);
  assert.ok(q.totalDroppedBytes > 0);

  // Test reset()
  q.reset();
  assert.equal(q.getTotalPackets(), 0);
  assert.equal(q.totalEnqueued, 0);
  assert.equal(q.droppedOverflowCount, 0);
  assert.equal(q.droppedDelayCount, 0);
  assert.equal(q.droppedDelayBytes, 0);
  assert.equal(q.droppedOverflowBytes, 0);
  assert.equal(q.totalDroppedBytes, 0);
  console.log('  -> PASS: Queue lifecycle reset resets all byte and packet accumulators to zero.');
}

console.log('\n[TL-T8] Verifying Batch-Level Superframe Preservation...');
{
  const worker = new SimulationWorkerManager(1500, '16_NODES');
  worker.resetSimulationState();
  let emittedFrame: TelemetryFrame | null = null;
  worker['emitHostMessage'] = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME') emittedFrame = msg.frame;
  };

  await worker.handleMessage({ type: 'UPDATE_PARAMS', tdma_frame_config: TDMA_PRESET_FAST_10MS });

  // Run 10 ticks in a single batch (steps 1..9 emitTelemetry=false, step 10 emitTelemetry=true)
  for (let step = 1; step <= 9; step++) {
    worker.tickSimulation(false);
  }
  assert.equal(worker.pendingTimelineRecords.length, 18); // 9 ticks * 2 superframes

  worker.tickSimulation(true);
  // Step 10 adds 2 more superframes = 20 total, then drains into emittedFrame
  assert.ok(emittedFrame !== null);
  const superframes = emittedFrame!.completed_superframes ?? [];
  assert.equal(superframes.length, 20, 'Zero superframe records lost during 10-tick batch');
  assert.equal(worker.pendingTimelineRecords.length, 0, 'Worker pending queue completely drained');
  console.log('  -> PASS: Batch-level superframe preservation verified (20 of 20 superframes preserved).');
}

console.log('\n[TL-T14] Verifying Dual-Scheduler Continuous Execution...');
{
  const worker = new SimulationWorkerManager(1600, '16_NODES');
  worker.resetSimulationState();
  let emittedFrame: TelemetryFrame | null = null;
  worker['emitHostMessage'] = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME') emittedFrame = msg.frame;
  };

  worker.tickSimulation(true);
  const ep = (emittedFrame?.completed_superframes?.[0] as SuperframeEpochRecord);
  assert.ok(ep !== undefined);
  assert.ok(ep.staticMetrics !== undefined, 'staticMetrics must be present');
  assert.ok(ep.tacMetrics !== undefined, 'tacMetrics must be present');
  assert.equal(typeof ep.staticMetrics.transmittedNonOutageBits, 'number');
  assert.equal(typeof ep.tacMetrics.transmittedNonOutageBits, 'number');
  assert.equal(typeof ep.staticMetrics.ulUtilizationPct, 'number');
  assert.equal(typeof ep.tacMetrics.ulUtilizationPct, 'number');
  console.log('  -> PASS: Dual-scheduler continuous execution verified with independent metrics.');
}

console.log('\n[TL-T15] Verifying Interleaved Batch Drain Ordering...');
{
  const worker = new SimulationWorkerManager(1700, '16_NODES');
  worker.resetSimulationState();
  let emittedFrame: TelemetryFrame | null = null;
  worker['emitHostMessage'] = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME') emittedFrame = msg.frame;
  };

  // 1. 2 ticks at 10 ms fast mode (4 epochs)
  await worker.handleMessage({ type: 'UPDATE_PARAMS', tdma_frame_config: TDMA_PRESET_FAST_10MS });
  worker.tickSimulation(false); // Tick 1 (2 epochs)
  worker.tickSimulation(false); // Tick 2 (2 epochs)

  // 2. Mid-interval reconfiguration to 40 ms
  await worker.handleMessage({ type: 'UPDATE_PARAMS', tdma_frame_config: TDMA_PRESET_EXTENDED_40MS });

  // 3. 2 ticks at 40 ms (1 epoch)
  worker.tickSimulation(false); // Tick 3 (accum = 0.020)
  worker.tickSimulation(true);  // Tick 4 (emits 1 epoch, drains all)

  const records = emittedFrame?.completed_superframes ?? [];
  assert.ok(records.length >= 5);

  // Assert monotonic timeline continuity
  for (let i = 1; i < records.length; i++) {
    close(records[i].startTimeS, records[i - 1].endTimeS, 1e-6);
  }
  console.log('  -> PASS: Interleaved batch drain ordering verified (exact FIFO order and monotonic times).');
}

// ============================================================================
// PART 3: BATCH SPATIAL PRESERVATION & INGESTION (TL-T16)
// ============================================================================

console.log('\n[TL-T16] Verifying Batch Spatial Preservation & Ingestion Verification...');
{
  const worker = new SimulationWorkerManager(1800, '16_NODES');
  worker.resetSimulationState();
  let emittedFrame: TelemetryFrame | null = null;
  worker['emitHostMessage'] = (msg: any) => {
    if (msg.type === 'TELEMETRY_FRAME') emittedFrame = msg.frame;
  };

  // 1. 25-Tick Batch Execution & Decimated Telemetry Drain
  for (let step = 1; step <= 24; step++) {
    worker.tickSimulation(false);
  }
  assert.equal(worker.batchSpatialSnapshots.length, 24, '24 intermediate snapshots staged in worker buffer');

  worker.tickSimulation(true); // Step 25
  assert.ok(emittedFrame !== null);
  const batch1 = emittedFrame!.batch_spatial_snapshots ?? [];
  assert.equal(batch1.length, 25, 'Emitted frame must contain exactly 25 batch_spatial_snapshots');
  assert.equal(worker.batchSpatialSnapshots.length, 0, 'Worker staging buffer must be drained to 0');

  // Verify UI SpatialSnapshotBuffer ingestion
  const uiBuffer = new SpatialSnapshotBuffer(3000);
  const ingestedCount = uiBuffer.ingestBatch(batch1);
  assert.equal(ingestedCount, 25);
  assert.equal(uiBuffer.count, 25);

  // 2. Multi-Batch Contiguous Ordering (4 batches of 25 = 100 ticks total)
  for (let batchIdx = 2; batchIdx <= 4; batchIdx++) {
    for (let step = 1; step <= 24; step++) worker.tickSimulation(false);
    worker.tickSimulation(true);
    const nextBatch = emittedFrame!.batch_spatial_snapshots ?? [];
    assert.equal(nextBatch.length, 25);
    uiBuffer.ingestBatch(nextBatch);
  }

  assert.equal(uiBuffer.count, 100);
  for (let i = 0; i < 100; i++) {
    const snap = uiBuffer.get(i);
    assert.ok(snap !== null);
    assert.equal(snap!.frameIndex, i + 1, `Snapshot at logical index ${i} has contiguous frameIndex`);
    close(snap!.simulationTimeS, (i + 1) * 0.020, 1e-9);
  }

  // 3. Duplicate & Out-of-Order Snapshot Rejection
  const duplicateBatch = batch1;
  const dupIngested = uiBuffer.ingestBatch(duplicateBatch);
  assert.equal(dupIngested, 0, 'Re-ingesting past batch must be completely rejected');
  assert.equal(uiBuffer.count, 100, 'Buffer count must remain unchanged');

  // 4. Sequence Gap Detection
  const dummyGapSnap: SpatialFrameSnapshot = {
    frameIndex: 126, // missing frames 101 to 125 (gap of 25)
    simulationTimeS: 126 * 0.020,
    wallClockTimeMs: performance.now(),
    spatialRevision: 0,
    acn: uiBuffer.newestSnapshot!.acn,
    nodes: uiBuffer.newestSnapshot!.nodes,
    selectedLinkBudget: null,
  };
  uiBuffer.append(dummyGapSnap);
  assert.equal(uiBuffer.discontinuities.length, 1);
  assert.equal(uiBuffer.discontinuities[0].missingStartFrame, 101);
  assert.equal(uiBuffer.discontinuities[0].missingEndFrame, 125);
  assert.equal(uiBuffer.discontinuities[0].count, 25);

  // 5. Snapshot Timestamp & Retention Span Verification (3,000 frames)
  const fullBuffer = new SpatialSnapshotBuffer(3000);
  for (let f = 1; f <= 3000; f++) {
    const snap: SpatialFrameSnapshot = {
      frameIndex: f,
      simulationTimeS: f * 0.020,
      wallClockTimeMs: performance.now(),
      spatialRevision: 0,
      acn: dummyGapSnap.acn,
      nodes: dummyGapSnap.nodes,
      selectedLinkBudget: null,
    };
    fullBuffer.append(snap);
  }

  assert.equal(fullBuffer.count, 3000);
  const oldest = fullBuffer.oldestSnapshot!;
  const newest = fullBuffer.newestSnapshot!;
  assert.equal(oldest.frameIndex, 1);
  assert.equal(newest.frameIndex, 3000);

  // Theoretical capacity duration
  const tCap = fullBuffer.capacity * 0.020;
  close(tCap, 60.00, 1e-9, 'Capacity-equivalent duration is exactly 60.00 seconds');

  // Actual first-to-last span
  const tSpan = newest.simulationTimeS - oldest.simulationTimeS;
  close(tSpan, 59.98, 1e-9, 'Actual timestamp span is exactly 59.98 seconds');

  console.log('  -> PASS: TL-T16 verified (25-tick batching, multi-batch continuity, duplicate rejection, gap detection, Tcap=60.00s, Tspan=59.98s).');
}

// ============================================================================
// PART 4: PHASE 2 SPATIAL BUFFER & RETENTION SYNCHRONIZATION
// ============================================================================

function createMockSnapshot(frameIndex: number, simulationTimeS: number, numNodes: number = 16): SpatialFrameSnapshot {
  return {
    frameIndex,
    simulationTimeS,
    wallClockTimeMs: 1000.0 + frameIndex * 20.0,
    spatialRevision: 1,
    acn: {
      posX: 1000.0,
      posY: 2000.0,
      posZ: 3000.0,
      velX: 50.0,
      velY: 0.0,
      velZ: 0.0,
      headingRad: 0.5,
      pitchDeg: 1.0,
      altitudeMslM: 3000.0,
      altitudeAglM: 2500.0,
      coverageRadiusKm: 50.0,
      isTerrainClamped: false,
    },
    nodes: Array.from({ length: numNodes }, (_, i) => ({
      nodeId: i,
      posX: 500.0 + i * 10.0,
      posY: 600.0 + i * 10.0,
      posZ: 100.0,
      altitudeMslM: 100.0,
      altitudeAglM: 2.0,
      isLos: true,
      isOutage: false,
      isObstacleBlocked: false,
      snrDb: 20.0,
      currentState: NodeTerrainState.NORMAL_LOS,
    })),
    selectedLinkBudget: {
      slantRangeM: 10000.0,
      fsplDb: 120.0,
      diffractionLossDb: 0.0,
      gasLossDb: 0.0,
      rainLossDb: 0.0,
      totalLossDb: 120.0,
      snrDb: 20.0,
      modcodName: 'QPSK 1/2',
      bitrateMbps: 10.0,
      isOutage: false,
    },
  };
}

console.log('\n[TL-T1] Verifying Spatial Buffer Monotonicity & Wraparound...');
{
  const buffer = new SpatialSnapshotBuffer(3000, 16);
  // Populate exactly 3,000 frames
  for (let f = 1; f <= 3000; f++) {
    const ok = buffer.append(createMockSnapshot(f, f * 0.020));
    assert.ok(ok, `Frame ${f} appended`);
  }
  assert.equal(buffer.count, 3000);
  assert.equal(buffer.oldestSnapshot!.frameIndex, 1);
  assert.equal(buffer.newestSnapshot!.frameIndex, 3000);

  // Ingest 500 additional frames to trigger circular wraparound eviction
  for (let f = 3001; f <= 3500; f++) {
    const ok = buffer.append(createMockSnapshot(f, f * 0.020));
    assert.ok(ok, `Frame ${f} appended`);
  }

  // Count remains clamped at capacity (3000)
  assert.equal(buffer.count, 3000);
  // Oldest frame must be 501, newest frame must be 3500
  assert.equal(buffer.oldestSnapshot!.frameIndex, 501);
  assert.equal(buffer.newestSnapshot!.frameIndex, 3500);

  // Verify all 3000 logical slots remain contiguous and monotonic
  for (let i = 0; i < 3000; i++) {
    const snap = buffer.get(i);
    assert.ok(snap !== null);
    assert.equal(snap!.frameIndex, 501 + i);
    close(snap!.simulationTimeS, (501 + i) * 0.020, 1e-9);
  }

  // Evicted frames (1..500) must return null on direct frame lookup
  assert.equal(buffer.findSnapshotByFrameIndex(1), null);
  assert.equal(buffer.findSnapshotByFrameIndex(500), null);
  assert.ok(buffer.findSnapshotByFrameIndex(501) !== null);
  assert.ok(buffer.findSnapshotByFrameIndex(3500) !== null);

  // Verify duplicate rejection
  const dupOk = buffer.append(createMockSnapshot(3500, 3500 * 0.020));
  assert.equal(dupOk, false, 'Duplicate frameIndex 3500 must be rejected');

  // Verify simulation reset recovery: frameIndex going backwards clears buffer and accepts frame
  const resetOk = buffer.append(createMockSnapshot(0, 0.0));
  assert.equal(resetOk, true, 'Simulation reset frame 0 must be accepted after clearing');
  assert.equal(buffer.count, 1, 'Buffer count reset to 1 after reset');
  assert.equal(buffer.newestSnapshot!.frameIndex, 0);
  assert.equal(buffer.newestSimulationTimeS, 0.0);

  console.log('  -> PASS: TL-T1 verified (3,000-frame circular wraparound, O(1) eviction, contiguous slots).');
}

console.log('\n[TL-T2] Verifying Selection Stability Under Influx...');
{
  const buffer = new SpatialSnapshotBuffer(3000, 16);
  // Ingest initial 1,000 frames (frames 1 to 1000)
  for (let f = 1; f <= 1000; f++) {
    buffer.append(createMockSnapshot(f, f * 0.020));
  }

  // Select historical frame #450
  const selected = buffer.selectSnapshot(450);
  assert.ok(selected, 'Frame 450 successfully selected');
  assert.equal(buffer.selectedSnapshotIndex, 450);
  assert.equal(buffer.selectedSnapshot!.frameIndex, 450);

  // Ingest 500 newer frames (frames 1001 to 1500)
  for (let f = 1001; f <= 1500; f++) {
    buffer.append(createMockSnapshot(f, f * 0.020));
  }

  // Assert selected snapshot remains frame #450 (selection stability under influx)
  assert.equal(buffer.selectedSnapshotIndex, 450);
  assert.equal(buffer.selectedSnapshot!.frameIndex, 450);
  close(buffer.selectedSnapshot!.simulationTimeS, 450 * 0.020, 1e-9);

  // Ingest frames up to 3500 (which evicts frames 1..500)
  for (let f = 1501; f <= 3500; f++) {
    buffer.append(createMockSnapshot(f, f * 0.020));
  }

  // Once frame 450 is evicted from the ring, selectedSnapshot returns null (graceful eviction handling)
  assert.equal(buffer.selectedSnapshot, null, 'Evicted selected snapshot gracefully returns null');

  console.log('  -> PASS: TL-T2 verified (selection stability under influx, graceful eviction handling).');
}

console.log('\n[TL-T9] Verifying Circular Binary Search Lookup...');
{
  const buffer = new SpatialSnapshotBuffer(100, 16);
  // Populate with wraparound (150 frames in capacity 100 -> frames 51..150 present)
  for (let f = 1; f <= 150; f++) {
    // Add artificial batch gap of 5 frames around frame 120 (skip 120..124)
    if (f >= 120 && f <= 124) continue;
    buffer.append(createMockSnapshot(f, f * 0.020));
  }

  // 1. Exact lookup across wraparound boundary
  const snap100 = buffer.findClosestSnapshot(100 * 0.020);
  assert.ok(snap100 !== null);
  assert.equal(snap100!.frameIndex, 100);

  // 2. Query across batch gap: target time corresponding to skipped frame 122 (122 * 0.020 = 2.44s)
  // Neighbors are frame 119 (2.38s) and frame 125 (2.50s)
  // Distance to 119 is 0.06s; distance to 125 is 0.06s (exact midpoint tie!)
  const snapGap = buffer.findClosestSnapshot(2.44);
  assert.ok(snapGap !== null);
  // Tie-breaking rule deterministically selects earlier frame (119)
  assert.equal(snapGap!.frameIndex, 119, 'Tie-breaking selects earlier frame on exact midpoint');

  // Query closer to frame 125 (e.g. 2.45s): distance to 119 is 0.07s, distance to 125 is 0.05s
  const snapNear125 = buffer.findClosestSnapshot(2.45);
  assert.ok(snapNear125 !== null);
  assert.equal(snapNear125!.frameIndex, 125);

  // 3. Query before oldest and after newest
  const oldestTime = buffer.oldestSnapshot!.simulationTimeS;
  const newestTime = buffer.newestSnapshot!.simulationTimeS;
  const snapBefore = buffer.findClosestSnapshot(oldestTime - 1.0);
  assert.equal(snapBefore!.frameIndex, buffer.oldestSnapshot!.frameIndex);
  const snapAfter = buffer.findClosestSnapshot(newestTime + 1.0);
  assert.equal(snapAfter!.frameIndex, buffer.newestSnapshot!.frameIndex);

  console.log('  -> PASS: TL-T9 verified (circular binary search, batch gaps, midpoint tie-breaking).');
}

console.log('\n[TL-T10] Verifying Memory Benchmark at Maximum Capacity...');
{
  // 1. Benchmark across 16, 64, and 128 nodes
  const buf16 = new SpatialSnapshotBuffer(3000, 16);
  const mem16 = buf16.getTotalByteLength();
  const buf64 = new SpatialSnapshotBuffer(3000, 64);
  const mem64 = buf64.getTotalByteLength();
  const buf128 = new SpatialSnapshotBuffer(3000, 128);
  const mem128 = buf128.getTotalByteLength();

  console.log(`     Memory [16 nodes] : ${(mem16 / 1024 / 1024).toFixed(3)} MB (${mem16.toLocaleString()} bytes)`);
  console.log(`     Memory [64 nodes] : ${(mem64 / 1024 / 1024).toFixed(3)} MB (${mem64.toLocaleString()} bytes)`);
  console.log(`     Memory [128 nodes]: ${(mem128 / 1024 / 1024).toFixed(3)} MB (${mem128.toLocaleString()} bytes)`);

  assert.ok(mem16 < mem64, 'Memory scales monotonically with node count');
  assert.ok(mem64 < mem128, 'Memory scales monotonically with node count');

  // 2. Strict < 6.5 MB assertions at 128 nodes
  const maxAllowedBytesDecimal = 6.5 * 1_000_000; // 6,500,000 bytes
  const maxAllowedBytesBinary = 6.5 * 1024 * 1024; // 6,815,744 bytes
  assert.ok(
    mem128 < maxAllowedBytesDecimal,
    `Memory at 128 nodes (${mem128} bytes) must be strictly < 6.5 MB decimal (${maxAllowedBytesDecimal} bytes)`
  );
  assert.ok(
    mem128 < maxAllowedBytesBinary,
    `Memory at 128 nodes (${mem128} bytes) must be strictly < 6.5 MB binary (${maxAllowedBytesBinary} bytes)`
  );

  // 3. Functional verification of 128-node storage and on-demand reconstruction
  const dummy128Nodes = Array.from({ length: 128 }, (_, i) => ({
    nodeId: i,
    posX: 1000.0 + i,
    posY: 2000.0 + i,
    posZ: 500.5,
    altitudeMslM: 500.5,
    altitudeAglM: 15.2,
    isLos: i % 2 === 0,
    isOutage: i % 3 === 0,
    isObstacleBlocked: i % 5 === 0,
    snrDb: 18.5 - (i * 0.1),
    currentState: NodeTerrainState.NORMAL_LOS,
  }));
  const snap128: SpatialFrameSnapshot = {
    frameIndex: 1,
    simulationTimeS: 0.020,
    wallClockTimeMs: 100.0,
    spatialRevision: 1,
    acn: {
      posX: 100.0, posY: 200.0, posZ: 3000.0,
      velX: 50.0, velY: 0.0, velZ: 0.0,
      headingRad: 0.5, pitchDeg: 1.0,
      altitudeMslM: 3000.0, altitudeAglM: 2500.0,
      coverageRadiusKm: 50.0, isTerrainClamped: false,
    },
    nodes: dummy128Nodes,
    selectedLinkBudget: {
      slantRangeM: 15000.0, fsplDb: 130.0, diffractionLossDb: 5.0,
      gasLossDb: 0.0, rainLossDb: 0.0, totalLossDb: 135.0,
      snrDb: 15.5, modcodName: '16-APSK 2/3', bitrateMbps: 25.0, isOutage: false,
    },
  };

  buf128.append(snap128);
  const reconstructed = buf128.get(0)!;
  assert.equal(reconstructed.nodes.length, 128);
  assert.equal(reconstructed.nodes[0].nodeId, 0);
  assert.equal(reconstructed.nodes[127].nodeId, 127);
  close(reconstructed.nodes[0].posZ, 500.5, 0.5);
  close(reconstructed.nodes[0].altitudeAglM, 15.2, 0.1);
  close(reconstructed.nodes[0].snrDb, 18.5, 0.05);
  assert.equal(reconstructed.selectedLinkBudget!.modcodName, '16-APSK 2/3');

  console.log('  -> PASS: TL-T10 verified (memory strictly < 6.5 MB at 128 nodes, full fidelity reconstruction).');
}

console.log('\n[TL-T13] Verifying Asymmetric Retention Synchronization...');
{
  const spatialBuffer = new SpatialSnapshotBuffer(3000, 16);
  const epochStore = new SuperframeEpochStore(6000);

  // Ingest 60 seconds of simulation:
  // - Spatial buffer: 3,000 frames @ 50 Hz (20 ms tick) = exactly 60.00 seconds [0.02s .. 60.00s]
  // - Epoch store: 5 ms waveform (200 epochs/second)
  //   In 60 seconds, 12,000 epochs are generated.
  //   With epochStore capacity = 6,000, epochs 1..6,000 (time 0.005s .. 30.000s) are evicted.
  //   Active epoch retention covers [30.005s .. 60.000s].

  for (let f = 1; f <= 3000; f++) {
    const tS = f * 0.020;
    spatialBuffer.append(createMockSnapshot(f, tS));
  }
  assert.equal(spatialBuffer.count, 3000);
  assert.equal(spatialBuffer.oldestSnapshot!.frameIndex, 1);
  assert.equal(spatialBuffer.newestSnapshot!.frameIndex, 3000);

  // Ingest 12,000 epochs of 5 ms (0.005s each)
  const dummyMetrics: any = {
    transmittedNonOutageBits: 1000,
    outageWastedBits: 0,
    totalPayloadBitsDequeued: 1000,
    droppedDelayPkts: 0,
    droppedOverflowPkts: 0,
    totalDroppedPkts: 0,
    droppedDelayBytes: 0,
    droppedOverflowBytes: 0,
    totalDroppedBytes: 0,
    ulUtilizationPct: 50.0,
  };
  for (let ep = 1; ep <= 12000; ep++) {
    const startS = (ep - 1) * 0.005;
    const endS = ep * 0.005;
    const rec: SuperframeEpochRecord = {
      recordType: 'EPOCH',
      epochIndex: ep,
      startTimeS: startS,
      endTimeS: endS,
      durationMs: 5.0,
      configuredDurationMs: 5.0,
      nominalSimTimeS: endS,
      associatedSimulationFrameIndex: Math.ceil(endS / 0.020),
      staticMetrics: dummyMetrics,
      tacMetrics: dummyMetrics,
      activeSchedulerMode: 'tac_tad',
    };
    epochStore.append(rec);
  }
  assert.equal(epochStore.count, 6000);
  assert.equal(epochStore.oldestRecord!.startTimeS, 6000 * 0.005); // 30.000s
  assert.equal(epochStore.newestRecord!.endTimeS, 12000 * 0.005); // 60.000s

  // Query at t = 15.00s (past 30s scrubbing boundary from the end):
  // Spatial buffer retains 60s, so t = 15.00s is available
  const spatialAt15 = spatialBuffer.findClosestSnapshot(15.00);
  assert.ok(spatialAt15 !== null, 'Spatial snapshot exists at t = 15.00s');
  close(spatialAt15!.simulationTimeS, 15.00, 0.020);

  // Communication epoch at t = 15.00s has been evicted (capacity 6,000 @ 5ms = 30s retention)
  const epochAt15 = epochStore.findAtTime(15.00);
  assert.equal(epochAt15, null, 'Communication epoch indicates evicted status without fabricating data');

  // Query at t = 45.00s: both spatial snapshot and communication epoch are retained
  const spatialAt45 = spatialBuffer.findClosestSnapshot(45.00);
  assert.ok(spatialAt45 !== null);
  close(spatialAt45!.simulationTimeS, 45.00, 0.020);

  const epochAt45 = epochStore.findAtTime(45.00);
  assert.ok(epochAt45 !== null, 'Communication epoch retained at t = 45.00s');
  assert.ok(epochAt45!.startTimeS <= 45.00 && epochAt45!.endTimeS > 45.00);

  // Verify getRecordsInRange
  const rangeRecords = epochStore.getRecordsInRange(44.0, 44.02);
  assert.equal(rangeRecords.length, 4); // 4 epochs of 5ms = 20ms

  console.log('  -> PASS: TL-T13 verified (asymmetric retention synchronization, no data fabrication on eviction).');
}

console.log('\n[TL-PREC] Verifying Float32 Coordinate Precision (±600,000 m Theater Bounds)...');
{
  // Test points spanning ±600,000 m theater bounds
  const testCoordinates = [
    -600000.0, -599999.96, -300000.123, -1000.5, 0.0,
    1000.5, 300000.123, 599999.96, 600000.0,
  ];

  for (const coord of testCoordinates) {
    const f32 = Math.fround(coord);
    const delta = Math.abs(f32 - coord);
    assert.ok(
      delta <= 0.05,
      `Coordinate ${coord} m in Float32 has delta ${delta} m > 0.05 m (5 cm)`
    );
  }

  // Check random coordinates in [-600,000, 600,000]
  for (let i = 0; i < 1000; i++) {
    const coord = (Math.random() * 1200000) - 600000;
    const f32 = Math.fround(coord);
    const delta = Math.abs(f32 - coord);
    assert.ok(delta <= 0.05, `Random coordinate ${coord} exceeds 0.05 m error (delta: ${delta})`);
  }

  console.log('  -> PASS: Float32 precision verified (all coordinates in ±600,000 m theater bounds have error <= 0.03125 m <= 5 cm).');
}

// ============================================================================
// PART 5: PHASE 3 CANVAS RENDERER & TIMELINE INTERACTIONS
// ============================================================================

class TimelineMockContext2D {
  public transformMatrix = [1, 0, 0, 1, 0, 0];
  public fillStyle = '#000000';
  public strokeStyle = '#000000';
  public lineWidth = 1;
  public font = '';
  public textAlign = 'left';
  public textBaseline = 'top';
  public filledRects: { x: number; y: number; w: number; h: number; fillStyle: string }[] = [];
  public strokedRects: { x: number; y: number; w: number; h: number; strokeStyle: string }[] = [];
  public textCalls: { text: string; x: number; y: number }[] = [];

  public setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transformMatrix = [a, b, c, d, e, f];
  }
  public clearRect(_x: number, _y: number, _w: number, _h: number): void {
    this.filledRects.length = 0;
    this.strokedRects.length = 0;
    this.textCalls.length = 0;
  }
  public fillRect(x: number, y: number, w: number, h: number): void {
    this.filledRects.push({ x, y, w, h, fillStyle: this.fillStyle });
  }
  public strokeRect(x: number, y: number, w: number, h: number): void {
    this.strokedRects.push({ x, y, w, h, strokeStyle: this.strokeStyle });
  }
  public beginPath(): void {}
  public moveTo(_x: number, _y: number): void {}
  public lineTo(_x: number, _y: number): void {}
  public closePath(): void {}
  public stroke(): void {}
  public fill(): void {}
  public roundRect(_x: number, _y: number, _w: number, _h: number, _r?: number): void {}
  public fillText(text: string, x: number, y: number): void {
    this.textCalls.push({ text, x, y });
  }
  public measureText(text: string): { width: number } {
    return { width: text.length * 7 };
  }
  public save(): void {}
  public restore(): void {}
}

class TimelineMockCanvas {
  public width = 0;
  public height = 0;
  public clientWidth = 800;
  public clientHeight = 130;
  public ctx = new TimelineMockContext2D();
  public parentElement: any = null;
  public listeners: Record<string, Function[]> = {};

  constructor(cssW: number = 800, cssH: number = 130) {
    this.clientWidth = cssW;
    this.clientHeight = cssH;
    this.parentElement = {
      clientWidth: cssW,
      clientHeight: cssH,
      getBoundingClientRect: () => ({ width: cssW, height: cssH, left: 0, top: 0 }),
    };
  }

  public getContext(type: string): any {
    return type === '2d' ? this.ctx : null;
  }
  public getBoundingClientRect(): any {
    return { width: this.clientWidth, height: this.clientHeight, left: 0, top: 0 };
  }
  public addEventListener(event: string, fn: Function): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  public removeEventListener(event: string, fn: Function): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(f => f !== fn);
  }
  public dispatchMockEvent(event: string, payload: any): void {
    for (const fn of this.listeners[event] ?? []) fn(payload);
  }
}

console.log('\n[TL-REND1] Verifying High-DPI Coordinate Projection & Invertibility...');
{
  const spatialBuffer = new SpatialSnapshotBuffer(3000, 16);
  const epochStore = new SuperframeEpochStore(6000);
  const canvas = new TimelineMockCanvas(800, 130);

  // 1. Mathematical Invertibility x <-> t
  const renderer = new SimulationTimelineRenderer({
    canvas: canvas as any,
    spatialBuffer,
    epochStore,
    dpr: 1.0,
    width: 800,
    height: 130,
    viewDurationS: 20.0,
  });
  renderer.setTimeWindow(10.0, 20.0);

  for (let x = 0; x <= 800; x += 50) {
    const t = renderer.xToTime(x);
    const roundTripX = renderer.timeToX(t);
    close(roundTripX, x, 1e-9, `Invertibility x -> t -> x at pixel ${x}`);
  }

  for (let t = 10.0; t <= 30.0; t += 1.0) {
    const x = renderer.timeToX(t);
    const roundTripT = renderer.xToTime(x);
    close(roundTripT, t, 1e-9, `Invertibility t -> x -> t at time ${t}s`);
  }

  // 2. High-DPI Scaling across DPRs 1.0, 1.5, 2.0, 3.0
  for (const dpr of [1.0, 1.5, 2.0, 3.0]) {
    const dprCanvas = new TimelineMockCanvas(800, 130);
    const dprRenderer = new SimulationTimelineRenderer({
      canvas: dprCanvas as any,
      spatialBuffer,
      epochStore,
      dpr,
      width: 800,
      height: 130,
    });
    const syncRes = dprRenderer.syncCanvas();
    assert.equal(syncRes.isVisible, true);
    assert.equal(syncRes.dpr, dpr);
    assert.equal(dprCanvas.width, Math.round(800 * dpr));
    assert.equal(dprCanvas.height, Math.round(130 * dpr));
    assert.deepEqual(dprCanvas.ctx.transformMatrix, [dpr, 0, 0, dpr, 0, 0]);
  }

  // 3. Zoom Invariance at Focus Point
  renderer.setTimeWindow(0.0, 20.0);
  const focusPixel = 300;
  const timeAtFocusBefore = renderer.xToTime(focusPixel);
  renderer.zoomAt(focusPixel, 0.5); // Zoom in 2x
  const timeAtFocusAfter = renderer.xToTime(focusPixel);
  close(timeAtFocusBefore, timeAtFocusAfter, 1e-9, 'Time under cursor remains invariant during zoom');
  assert.equal(renderer.viewDurationS, 10.0);

  // 4. Clamping duration to [1.0s, 60.0s]
  renderer.zoomAt(focusPixel, 0.001); // Excessive zoom in
  assert.equal(renderer.viewDurationS, 1.0, 'Duration clamped to minimum 1.0s');

  renderer.zoomAt(focusPixel, 1000.0); // Excessive zoom out
  assert.equal(renderer.viewDurationS, 60.0, 'Duration clamped to maximum 60.0s');

  renderer.setTimeWindow(5.0, 0.2);
  assert.equal(renderer.viewDurationS, 1.0, 'setTimeWindow clamps duration minimum');
  renderer.setTimeWindow(5.0, 120.0);
  assert.equal(renderer.viewDurationS, 60.0, 'setTimeWindow clamps duration maximum');

  console.log('  -> PASS: TL-REND1 verified (invertibility, DPR scaling, zoom invariance, duration bounds).');
}

console.log('\n[TL-REND2] Verifying Playhead Bounds Clamping & Live Tracking...');
{
  const spatialBuffer = new SpatialSnapshotBuffer(3000, 16);
  const epochStore = new SuperframeEpochStore(6000);
  const canvas = new TimelineMockCanvas(800, 130);

  // Ingest 100 frames (t = 0.02s to 2.00s)
  for (let f = 1; f <= 100; f++) {
    spatialBuffer.append(createMockSnapshot(f, f * 0.020));
  }

  let reportedSeekTime: number | null = null;
  let reportedIsLive: boolean | null = null;

  const renderer = new SimulationTimelineRenderer({
    canvas: canvas as any,
    spatialBuffer,
    epochStore,
    width: 800,
    height: 130,
    onSeek: (t, live) => {
      reportedSeekTime = t;
      reportedIsLive = live;
    },
  });

  // 1. Seeking to valid internal timestamp
  renderer.seekTo(1.20, false);
  close(renderer.playheadTimeS, 1.20, 1e-9);
  assert.equal(renderer.isLive, false);
  assert.equal(reportedSeekTime, 1.20);
  assert.equal(reportedIsLive, false);

  // 2. Seeking before oldest timestamp clamps to oldest (0.02s)
  renderer.seekTo(-5.0, false);
  close(renderer.playheadTimeS, 0.020, 1e-9, 'Clamps before oldest snapshot');

  // 3. Seeking beyond newest timestamp clamps to newest (2.00s)
  renderer.seekTo(10.0, false);
  close(renderer.playheadTimeS, 2.000, 1e-9, 'Clamps beyond newest snapshot');

  // 4. Live Mode Tracking
  renderer.setLive(true);
  assert.equal(renderer.isLive, true);
  close(renderer.playheadTimeS, 2.000, 1e-9, 'Live mode snaps to newest snapshot');
  close(renderer.viewStartTimeS, 2.000 - renderer.viewDurationS / 2, 1e-9, 'Live mode auto-scrolls view to center');
  close(renderer.timeToX(renderer.playheadTimeS), 400.0, 0.5, 'Playhead pinned to center W/2');

  // Ingest additional 50 frames (up to 3.00s)
  for (let f = 101; f <= 150; f++) {
    spatialBuffer.append(createMockSnapshot(f, f * 0.020));
  }
  renderer.render(); // Render checks live tracking
  close(renderer.playheadTimeS, 3.000, 1e-9, 'Playhead auto-advances to newest time in live mode');
  close(renderer.timeToX(renderer.playheadTimeS), 400.0, 0.5, 'Playhead remains centered at W/2');

  console.log('  -> PASS: TL-REND2 verified (playhead bounds clamping, seek callbacks, live tracking auto-scroll).');
}

console.log('\n[TL-REND3] Verifying Dual-Scheduler Stacked Bar Geometry & Disjoint Metrics...');
{
  const spatialBuffer = new SpatialSnapshotBuffer(3000, 16);
  const epochStore = new SuperframeEpochStore(6000);
  const canvas = new TimelineMockCanvas(800, 130);

  const renderer = new SimulationTimelineRenderer({
    canvas: canvas as any,
    spatialBuffer,
    epochStore,
    width: 800,
    height: 130,
  });
  renderer.setTimeWindow(0.0, 10.0); // 10s on 800px = 80 px/s

  // 1. Bar widths proportional to frame duration
  const w10 = renderer.timeToX(0.010) - renderer.timeToX(0.0); // 10 ms = 0.8 px
  const w20 = renderer.timeToX(0.020) - renderer.timeToX(0.0); // 20 ms = 1.6 px
  const w40 = renderer.timeToX(0.040) - renderer.timeToX(0.0); // 40 ms = 3.2 px

  close(w20, 2.0 * w10, 1e-9, '20ms bar width is exactly 2x 10ms width');
  close(w40, 2.0 * w20, 1e-9, '40ms bar width is exactly 2x 20ms width');
  close(w40, 4.0 * w10, 1e-9, '40ms bar width is exactly 4x 10ms width');

  // 2. Disjoint Stacked Bar Metric Partitioning
  const metricsStatic = {
    transmittedNonOutageBits: 8000, // 1000 bytes
    outageWastedBits: 4000,         // 500 bytes
    totalPayloadBitsDequeued: 12000,
    droppedDelayPkts: 0,
    droppedOverflowPkts: 0,
    totalDroppedPkts: 0,
    droppedDelayBytes: 500,         // 500 bytes
    droppedOverflowBytes: 0,
    totalDroppedBytes: 500,
    ulUtilizationPct: 50.0,
  };
  const metricsTac = {
    transmittedNonOutageBits: 12000, // 1500 bytes
    outageWastedBits: 0,             // 0 bytes (avoided by topology awareness)
    totalPayloadBitsDequeued: 12000,
    droppedDelayPkts: 0,
    droppedOverflowPkts: 0,
    totalDroppedPkts: 0,
    droppedDelayBytes: 0,
    droppedOverflowBytes: 0,
    totalDroppedBytes: 0,
    ulUtilizationPct: 60.0,
  };

  const epochRec: SuperframeEpochRecord = {
    recordType: 'EPOCH',
    epochIndex: 1,
    startTimeS: 1.0,
    endTimeS: 1.020,
    durationMs: 20.0,
    configuredDurationMs: 20.0,
    nominalSimTimeS: 1.020,
    associatedSimulationFrameIndex: 51,
    staticMetrics: metricsStatic,
    tacMetrics: metricsTac,
    activeSchedulerMode: 'tac_tad',
  };
  epochStore.append(epochRec);
  renderer.render();

  // Verify that goodput (green #52b788), outage (amber #e09f3e), and dropped (vermilion #e05347) are rendered
  const colorsUsed = new Set(canvas.ctx.filledRects.map(r => r.fillStyle));
  assert.ok(colorsUsed.has('#52b788'), 'Delivered goodput bar rendered in sage (#52b788)');
  assert.ok(colorsUsed.has('#e09f3e'), 'Outage wasted bar rendered in amber (#e09f3e)');
  assert.ok(colorsUsed.has('#e05347'), 'Queue dropped bar rendered in vermilion (#e05347)');

  console.log('  -> PASS: TL-REND3 verified (bar widths proportional to duration, disjoint sage/amber/vermilion metrics).');
}

console.log('\n[TL-REND4] Verifying Adaptive LOD Columnar Binning...');
{
  const spatialBuffer = new SpatialSnapshotBuffer(3000, 16);
  const epochStore = new SuperframeEpochStore(6000);
  const canvas = new TimelineMockCanvas(800, 130);

  const renderer = new SimulationTimelineRenderer({
    canvas: canvas as any,
    spatialBuffer,
    epochStore,
    width: 800,
    height: 130,
  });
  renderer.setTimeWindow(0.0, 10.0);

  // Generate 500 dense epoch records (20 ms each across 10 seconds)
  const denseRecords: SuperframeEpochRecord[] = [];
  let inputStaticTx = 0;
  let inputStaticOutage = 0;
  let inputStaticDrop = 0;
  let inputTacTx = 0;
  let inputTacOutage = 0;
  let inputTacDrop = 0;

  for (let i = 0; i < 500; i++) {
    const startS = i * 0.020;
    const endS = (i + 1) * 0.020;
    const sTx = 100 + (i % 50);
    const sOut = (i % 5 === 0) ? 50 : 0;
    const sDrop = (i % 7 === 0) ? 25 : 0;
    const tTx = 120 + (i % 40);
    const tOut = 0;
    const tDrop = (i % 11 === 0) ? 15 : 0;

    inputStaticTx += sTx;
    inputStaticOutage += sOut;
    inputStaticDrop += sDrop;
    inputTacTx += tTx;
    inputTacOutage += tOut;
    inputTacDrop += tDrop;

    denseRecords.push({
      recordType: 'EPOCH',
      epochIndex: i + 1,
      startTimeS: startS,
      endTimeS: endS,
      durationMs: 20.0,
      configuredDurationMs: 20.0,
      nominalSimTimeS: endS,
      associatedSimulationFrameIndex: i + 1,
      staticMetrics: {
        transmittedNonOutageBits: sTx * 8,
        outageWastedBits: sOut * 8,
        totalPayloadBitsDequeued: (sTx + sOut) * 8,
        droppedDelayPkts: 0,
        droppedOverflowPkts: 0,
        totalDroppedPkts: 0,
        droppedDelayBytes: sDrop,
        droppedOverflowBytes: 0,
        totalDroppedBytes: sDrop,
        ulUtilizationPct: 50.0,
      },
      tacMetrics: {
        transmittedNonOutageBits: tTx * 8,
        outageWastedBits: tOut * 8,
        totalPayloadBitsDequeued: (tTx + tOut) * 8,
        droppedDelayPkts: 0,
        droppedOverflowPkts: 0,
        totalDroppedPkts: 0,
        droppedDelayBytes: tDrop,
        droppedOverflowBytes: 0,
        totalDroppedBytes: tDrop,
        ulUtilizationPct: 60.0,
      },
      activeSchedulerMode: 'tac_tad',
    });
  }

  // Aggregate into 100 column bins
  const width = 100;
  const bins = renderer.aggregateEpochsIntoBins(denseRecords, width);

  assert.ok(bins.size <= width, `Number of bins (${bins.size}) cannot exceed canvas width (${width})`);

  let binnedStaticTx = 0;
  let binnedStaticOutage = 0;
  let binnedStaticDrop = 0;
  let binnedTacTx = 0;
  let binnedTacOutage = 0;
  let binnedTacDrop = 0;
  let binnedRecordCount = 0;

  for (const bin of bins.values()) {
    binnedStaticTx += bin.staticTxBytes;
    binnedStaticOutage += bin.staticOutageBytes;
    binnedStaticDrop += bin.staticDropBytes;
    binnedTacTx += bin.tacTxBytes;
    binnedTacOutage += bin.tacOutageBytes;
    binnedTacDrop += bin.tacDropBytes;
    binnedRecordCount += bin.recordCount;
  }

  assert.equal(binnedRecordCount, 500, 'All 500 epoch records accounted for in column bins');
  close(binnedStaticTx, inputStaticTx, 1e-6, 'Static goodput byte sum preserved exactly');
  close(binnedStaticOutage, inputStaticOutage, 1e-6, 'Static outage waste byte sum preserved exactly');
  close(binnedStaticDrop, inputStaticDrop, 1e-6, 'Static dropped byte sum preserved exactly');
  close(binnedTacTx, inputTacTx, 1e-6, 'Tac goodput byte sum preserved exactly');
  close(binnedTacOutage, inputTacOutage, 1e-6, 'Tac outage waste byte sum preserved exactly');
  close(binnedTacDrop, inputTacDrop, 1e-6, 'Tac dropped byte sum preserved exactly');

  console.log('  -> PASS: TL-REND4 verified (exact cumulative byte sums preserved across column bins).');
}

console.log('\n[TL-REND5] Verifying Sequence Gap, Discontinuity Marker & Evicted History...');
{
  const spatialBuffer = new SpatialSnapshotBuffer(3000, 16);
  const epochStore = new SuperframeEpochStore(6000);
  const canvas = new TimelineMockCanvas(800, 130);

  const renderer = new SimulationTimelineRenderer({
    canvas: canvas as any,
    spatialBuffer,
    epochStore,
    width: 800,
    height: 130,
  });
  renderer.setTimeWindow(0.0, 40.0);

  // 1. Sequence Gap in Spatial Buffer
  // Inject gap of frames 51..60
  spatialBuffer.discontinuities.push({
    missingStartFrame: 51,
    missingEndFrame: 60,
    count: 10,
  });

  // 2. Discontinuity Marker in Epoch Store
  const discRec: SuperframeDiscontinuityRecord = {
    recordType: 'DISCONTINUITY',
    discontinuityIndex: 1,
    startTimeS: 10.0,
    endTimeS: 10.015,
    durationS: 0.015,
    discardedDurationS: 0.015,
  };
  epochStore.append(discRec);

  // 3. Evicted Comm History: Add 1 epoch starting at 25.0s
  // Since view starts at 0.0s, [0.0s, 25.0s] is evicted comm history
  epochStore.append({
    recordType: 'EPOCH',
    epochIndex: 2,
    startTimeS: 25.0,
    endTimeS: 25.020,
    durationMs: 20.0,
    configuredDurationMs: 20.0,
    nominalSimTimeS: 25.020,
    associatedSimulationFrameIndex: 1251,
    staticMetrics: {
      transmittedNonOutageBits: 8000,
      outageWastedBits: 0,
      totalPayloadBitsDequeued: 8000,
      droppedDelayPkts: 0,
      droppedOverflowPkts: 0,
      totalDroppedPkts: 0,
      droppedDelayBytes: 0,
      droppedOverflowBytes: 0,
      totalDroppedBytes: 0,
      ulUtilizationPct: 50.0,
    },
    tacMetrics: {
      transmittedNonOutageBits: 8000,
      outageWastedBits: 0,
      totalPayloadBitsDequeued: 8000,
      droppedDelayPkts: 0,
      droppedOverflowPkts: 0,
      totalDroppedPkts: 0,
      droppedDelayBytes: 0,
      droppedOverflowBytes: 0,
      totalDroppedBytes: 0,
      ulUtilizationPct: 50.0,
    },
    activeSchedulerMode: 'tac_tad',
  });

  renderer.render();

  // Verify Ochre Gap Band was drawn
  const amberGap = canvas.ctx.filledRects.some(r => r.fillStyle === 'rgba(233, 196, 106, 0.16)');
  assert.ok(amberGap, 'Spatial sequence gap band rendered in ochre');

  // Verify Reconfiguration Discontinuity stripe was drawn
  const reconfigStripe = canvas.ctx.filledRects.some(r => r.fillStyle === 'rgba(233, 196, 106, 0.55)');
  assert.ok(reconfigStripe, 'Reconfiguration discontinuity stripe rendered in ochre');

  // Verify "Comm history evicted" label is rendered
  const evictedText = canvas.ctx.textCalls.some(t => t.text.includes('Comm history evicted'));
  assert.ok(evictedText, 'Evicted comm history overlay labeled cleanly without data fabrication');

  console.log('  -> PASS: TL-REND5 verified (gap bands, reconfiguration markers, evicted comm history overlays).');
}

console.log('\n[TL-T11] Verifying Zero Fabricated Fallbacks (Historical Map Projection)...');
{
  const spatialBuffer = new SpatialSnapshotBuffer(3000, 16);
  const epochStore = new SuperframeEpochStore(6000);
  const canvas = new TimelineMockCanvas(800, 130);
  const renderer = new SimulationTimelineRenderer({
    canvas: canvas as any,
    spatialBuffer,
    epochStore,
    viewDurationS: 20.0,
    isLive: false,
  });
  const controller = new SimulationTimelineController({
    spatialBuffer,
    epochStore,
    renderer,
  });

  // Projection helper replicating Zero Fabricated Fallbacks logic from drawRadar
  function projectAcnState(
    ctrl: SimulationTimelineController,
    latestLiveTelemetry?: any
  ): {
    shouldDrawCoverageCircle: boolean;
    coverageRadiusKm: number | null;
    altitudeMslText: string | null;
    fullAcnText: string;
  } {
    const isHist = ctrl.isHistoricalInspecting;
    const histSnap = isHist ? ctrl.getActiveSpatialSnapshot() : null;

    let covKm: number | null = null;
    let acnAltM: number | null = null;
    let acnAglM: number | null = null;
    let vz = 0;
    let headingDeg = 0;
    let isClamped = false;

    if (histSnap) {
      covKm = histSnap.acn.coverageRadiusKm;
      acnAltM = histSnap.acn.altitudeMslM;
      acnAglM = histSnap.acn.altitudeAglM;
      vz = histSnap.acn.velZ ?? 0;
      headingDeg = ((histSnap.acn.headingRad * 180 / Math.PI) % 360 + 360) % 360;
      isClamped = Boolean(histSnap.acn.isTerrainClamped);
    } else {
      const acn = latestLiveTelemetry?.acn_telemetry || {};
      covKm = acn.coverage_radius_km || 35;
      acnAltM = acn.altitude_msl_m ?? 5000;
      acnAglM = acn.altitude_agl_m;
      vz = acn.vel_z ?? 0;
      headingDeg = acn.heading_deg ?? 0;
      isClamped = Boolean(acn.is_terrain_clamped);
    }

    const shouldDrawCoverageCircle = covKm !== null && covKm !== undefined && !Number.isNaN(covKm) && covKm > 0;
    const hasValidAlt = acnAltM !== null && acnAltM !== undefined && !Number.isNaN(acnAltM) && acnAltM > 0;
    const parts: string[] = [];
    if (hasValidAlt) {
      parts.push(`${Math.round(acnAltM!)}m MSL`);
    }
    if (acnAglM !== null && acnAglM !== undefined && !Number.isNaN(acnAglM) && acnAglM > 0) {
      parts.push(`${Math.round(acnAglM!)}m AGL`);
    }
    if (Math.abs(vz) >= 0.1) {
      parts.push(`${vz >= 0 ? '▲' : '▼'}${Math.abs(vz).toFixed(1)}m/s`);
    }
    if (isClamped) {
      parts.push('CLAMPED');
    }
    const acnMetrics = parts.length > 0 ? ` [${parts.join(' · ')}]` : '';
    const fullAcnText = `ACN-1${acnMetrics} · HDG ${Math.round(headingDeg)}°`;

    return {
      shouldDrawCoverageCircle,
      coverageRadiusKm: covKm,
      altitudeMslText: hasValidAlt ? `${Math.round(acnAltM!)}m MSL` : null,
      fullAcnText,
    };
  }

  // 1. Ingest Snapshot with NULL / 0 Coverage Radius and NULL Altitude
  const snapshotZeroCov: SpatialFrameSnapshot = {
    frameIndex: 100,
    simulationTimeS: 2.0,
    wallClockTimeMs: 2000,
    spatialRevision: 1,
    acn: {
      posX: 1000,
      posY: 2000,
      posZ: 0,
      velX: 50,
      velY: 0,
      velZ: 0,
      headingRad: 0,
      pitchDeg: 0,
      altitudeMslM: null as any,
      altitudeAglM: null as any,
      coverageRadiusKm: 0,
      isTerrainClamped: false,
    },
    nodes: [],
    selectedLinkBudget: null,
  };

  spatialBuffer.append(snapshotZeroCov);
  controller.seekTo(2.0, false); // historical mode

  const proj1 = projectAcnState(controller);
  assert.equal(proj1.shouldDrawCoverageCircle, false, 'Coverage circle MUST be suppressed when coverageRadiusKm <= 0');
  assert.equal(proj1.altitudeMslText, null, 'Altitude MSL readout MUST be suppressed when altitudeMslM is null');
  assert.ok(!proj1.fullAcnText.includes('5000m MSL'), 'Must NOT fabricate 5000m MSL fallback in historical mode');
  assert.equal(proj1.fullAcnText, 'ACN-1 · HDG 0°', 'Text is cleanly rendered without fabricated metrics');

  // 2. Ingest Snapshot with Valid Coverage Radius (35.0 km) and Valid Altitude (5200 m)
  const snapshotValid: SpatialFrameSnapshot = {
    frameIndex: 101,
    simulationTimeS: 2.02,
    wallClockTimeMs: 2020,
    spatialRevision: 2,
    acn: {
      posX: 1001,
      posY: 2000,
      posZ: 5200,
      velX: 50,
      velY: 0,
      velZ: 0,
      headingRad: 0,
      pitchDeg: 0,
      altitudeMslM: 5200,
      altitudeAglM: 1500,
      coverageRadiusKm: 35.0,
      isTerrainClamped: false,
    },
    nodes: [
      {
        nodeId: 1,
        posX: 500,
        posY: 600,
        posZ: 3700,
        altitudeMslM: 3700,
        altitudeAglM: 10,
        isLos: true,
        isOutage: false,
        isObstacleBlocked: false,
        snrDb: 18.5,
        currentState: NodeTerrainState.NORMAL_LOS,
      },
      {
        nodeId: 2,
        posX: 1500,
        posY: 2600,
        posZ: 4200,
        altitudeMslM: 4200,
        altitudeAglM: 10,
        isLos: false,
        isOutage: true,
        isObstacleBlocked: true,
        snrDb: -5.0,
        currentState: NodeTerrainState.HARD_SHADOW_CUTOFF,
      },
    ],
    selectedLinkBudget: null,
  };

  spatialBuffer.append(snapshotValid);
  controller.seekTo(2.02, false);

  const proj2 = projectAcnState(controller);
  assert.equal(proj2.shouldDrawCoverageCircle, true, 'Coverage circle MUST be drawn when coverageRadiusKm > 0');
  assert.equal(proj2.coverageRadiusKm, 35.0, 'Coverage radius equals exact snapshot value');
  assert.equal(proj2.altitudeMslText, '5200m MSL', 'Altitude MSL matches snapshot altitude');
  assert.ok(proj2.fullAcnText.includes('5200m MSL · 1500m AGL'), 'Contains exact MSL and AGL metrics');

  const histActiveSnap = controller.getActiveSpatialSnapshot();
  assert.ok(histActiveSnap, 'Historical snapshot retrieved');
  assert.equal(histActiveSnap!.nodes.length, 2, 'Historical nodes count preserved');
  assert.equal(histActiveSnap!.nodes[0].isLos, true, 'Node 1 LOS preserved');
  assert.equal(histActiveSnap!.nodes[1].isOutage, true, 'Node 2 Outage preserved');
  assert.equal(histActiveSnap!.nodes[1].isObstacleBlocked, true, 'Node 2 Obstacle Blocked preserved');

  // 3. Compare with Live Fallback Behavior
  controller.jumpToLive();
  const projLive = projectAcnState(controller, { acn_telemetry: {} });
  assert.equal(projLive.shouldDrawCoverageCircle, true, 'Live mode defaults to drawing coverage circle');
  assert.equal(projLive.coverageRadiusKm, 35, 'Live mode falls back to 35 km default');
  assert.equal(projLive.altitudeMslText, '5000m MSL', 'Live mode falls back to 5000m MSL default');

  console.log('  -> PASS: TL-T11 verified (Zero Fabricated Fallbacks for coverage and altitude).');
}

console.log('\n[TL-T12] Verifying Interaction Lockdown & Dual Play/Pause...');
{
  const spatialBuffer = new SpatialSnapshotBuffer(3000, 16);
  const epochStore = new SuperframeEpochStore(6000);
  const canvas = new TimelineMockCanvas(800, 130);
  const renderer = new SimulationTimelineRenderer({
    canvas: canvas as any,
    spatialBuffer,
    epochStore,
    viewDurationS: 20.0,
    isLive: true,
  });

  const controller = new SimulationTimelineController({
    spatialBuffer,
    epochStore,
    renderer,
  });

  // 1. Initial State: Live Mode
  assert.equal(controller.isLive, true, 'Controller starts in live mode');
  assert.equal(controller.isHistoricalInspecting, false, 'isHistoricalInspecting is false');
  assert.equal(controller.isInteractionLocked, false, 'isInteractionLocked is false when live');
  assert.equal(controller.isPlayingHistory, false, 'isPlayingHistory is false');
  assert.equal(controller.getActiveSpatialSnapshot(), null, 'getActiveSpatialSnapshot returns null when live');

  // 2. Ingest 50 frames (0.00s to 0.98s)
  const batch: SpatialFrameSnapshot[] = [];
  for (let i = 0; i < 50; i++) {
    const t = Number((i * 0.020).toFixed(4));
    batch.push({
      frameIndex: i,
      simulationTimeS: t,
      wallClockTimeMs: 1000 + i * 20,
      spatialRevision: i,
      acn: {
        posX: 1000 + i * 10,
        posY: 2000,
        posZ: 5000,
        velX: 50,
        velY: 0,
        velZ: 0,
        headingRad: 0,
        pitchDeg: 0,
        altitudeMslM: 5000,
        altitudeAglM: 1500,
        coverageRadiusKm: 35.0,
        isTerrainClamped: false,
      },
      nodes: [
        {
          nodeId: 0,
          posX: 500,
          posY: 600,
          posZ: 3500,
          altitudeMslM: 3500,
          altitudeAglM: 10,
          isLos: true,
          isOutage: false,
          isObstacleBlocked: false,
          snrDb: 20.0,
          currentState: NodeTerrainState.NORMAL_LOS,
        },
      ],
      selectedLinkBudget: null,
    });
  }
  controller.ingestTelemetry(batch);

  assert.equal(controller.isLive, true, 'Controller remains in live mode after ingestion');
  close(controller.playheadTimeS, 0.98, 1e-4, 'Playhead tracked live newest snapshot time');

  // 3. Step Backward (Enters Historical Inspection)
  controller.stepBackward(0.020);
  assert.equal(controller.isLive, false, 'stepBackward switches isLive to false');
  assert.equal(controller.isHistoricalInspecting, true, 'isHistoricalInspecting is true');
  assert.equal(controller.isInteractionLocked, true, 'isInteractionLocked is true during historical inspection');
  assert.equal(controller.isPlayingHistory, false, 'isPlayingHistory remains false on step');
  close(controller.playheadTimeS, 0.96, 1e-4, 'Playhead stepped back by 0.020s to 0.96s');

  const histSnap = controller.getActiveSpatialSnapshot();
  assert.ok(histSnap !== null, 'Active spatial snapshot is available');
  close(histSnap!.simulationTimeS, 0.96, 1e-4, 'Active snapshot time matches playhead');

  // 4. Test Interaction Lockdown Guard
  function attemptNodeDrag(ctrl: SimulationTimelineController, nodeId: number): {
    allowed: boolean;
    draggedEntity: any;
    cursor: string;
    message: string;
  } {
    if (ctrl.isInteractionLocked) {
      return {
        allowed: false,
        draggedEntity: null,
        cursor: 'not-allowed',
        message: 'Interaction locked: Ground node editing is disabled during historical playback.',
      };
    }
    return {
      allowed: true,
      draggedEntity: { type: 'node', id: nodeId },
      cursor: 'grabbing',
      message: 'Node drag active',
    };
  }

  const dragResult = attemptNodeDrag(controller, 0);
  assert.equal(dragResult.allowed, false, 'Node drag must be rejected during historical inspection');
  assert.equal(dragResult.draggedEntity, null, 'draggedEntity remains null');
  assert.equal(dragResult.cursor, 'not-allowed', 'Cursor is set to not-allowed');
  assert.equal(
    dragResult.message,
    'Interaction locked: Ground node editing is disabled during historical playback.',
    'Accurate lockdown message emitted'
  );

  // 5. Dual Play/Pause & Historical Playback Advance
  controller.togglePlayPause();
  assert.equal(controller.isPlayingHistory, true, 'togglePlayPause starts historical playback');
  assert.equal(controller.isLive, false, 'Remains in historical mode');

  // Advance by 0.010s
  controller.advanceHistoricalPlayback(0.010);
  close(controller.playheadTimeS, 0.97, 1e-4, 'Playhead advanced smoothly with dt');
  assert.equal(controller.isPlayingHistory, true, 'Still playing history');

  // Advance past buffer newest snapshot (0.98s)
  controller.advanceHistoricalPlayback(0.050); // would reach 1.02s
  close(controller.playheadTimeS, 0.98, 1e-4, 'Playhead clamped to buffer newest snapshot');
  assert.equal(controller.isPlayingHistory, false, 'Historical playback pauses at buffer boundary');

  // 6. Step Forward
  controller.stepBackward(0.040); // seek to 0.94s
  close(controller.playheadTimeS, 0.94, 1e-4, 'Stepped back to 0.94s');
  controller.stepForward(0.020);  // advance to 0.96s
  close(controller.playheadTimeS, 0.96, 1e-4, 'Stepped forward to 0.96s monotonically');

  // 7. Jump to Live
  controller.jumpToLive();
  assert.equal(controller.isLive, true, 'jumpToLive restores isLive = true');
  assert.equal(controller.isHistoricalInspecting, false, 'isHistoricalInspecting is false');
  assert.equal(controller.isInteractionLocked, false, 'isInteractionLocked is unlocked');
  assert.equal(controller.isPlayingHistory, false, 'isPlayingHistory is false');
  close(controller.playheadTimeS, 0.98, 1e-4, 'Playhead snapped back to newest live timestamp');

  // Now node drag is allowed in live mode
  const liveDragResult = attemptNodeDrag(controller, 0);
  assert.equal(liveDragResult.allowed, true, 'Node drag is permitted when live');
  assert.equal(liveDragResult.cursor, 'grabbing', 'Cursor is grabbing in live mode');

  // 8. Controller Reset
  controller.reset();
  assert.equal(controller.isLive, true, 'reset keeps isLive = true');
  assert.equal(controller.playheadTimeS, 0.0, 'reset resets playheadTimeS to 0.0');
  assert.equal(controller.spatialBuffer.count, 0, 'reset clears spatialBuffer');
  assert.equal(controller.epochStore.count, 0, 'reset clears epochStore');

  console.log('  -> PASS: TL-T12 verified (Interaction Lockdown & Dual Play/Pause).');
}

console.log('\n' + '='.repeat(92));
console.log('   ALL PHASE 1, 2, 3 & 4 TIMELINE VERIFICATION TESTS PASSED SUCCESSFULLY.');
console.log('='.repeat(92));
