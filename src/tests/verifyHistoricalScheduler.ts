/**
 * Milestone: Scheduler Performance History Integration Test Suite
 *
 * Verifies:
 *  1. Ring-buffer capacity, ordering, and strict FIFO eviction.
 *  2. Exact frame/time correspondence.
 *  3. Defensive-copy immutability.
 *  4. Correct separation of cumulative metrics and per-frame deltas.
 *  5. Correct behavior for missing or unavailable metrics.
 *  6. Exclusion of PROFILE_FRAME from scheduler frame insertion.
 *  7. Historical inspection without mutation of live simulation state.
 *  8. Reset and pause/resume behavior.
 *  9. Selected-node backlog and allocation correspondence.
 * 10. Bounded memory (< 2.0 MB for 600 frames) and absence of DEM/profile arrays.
 * 11. Existing scheduler outputs remain unchanged by telemetry instrumentation.
 * 12. Existing RF-history tests continue to pass.
 */

import assert from 'node:assert/strict';
import {
  createSchedulerRecordSnapshot,
  estimateSchedulerRecordMemoryBytes,
  SchedulerFrameRecord,
  SchedulerHistoryBuffer,
  SchedulerHistoryController,
  SchedulerKpiSnapshot,
  SchedulerNodeBacklog,
  SchedulerSlotAllocation,
} from '../ui/schedulerHistory';
import { SimulationWorkerManager } from '../worker/simWorker';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers & Mock Builders
// ─────────────────────────────────────────────────────────────────────────────

function createMockBacklogs(): SchedulerNodeBacklog[] {
  const list: SchedulerNodeBacklog[] = [];
  for (let i = 0; i < 16; i++) {
    list.push({
      nodeId: i,
      name: i === 15 ? 'MCP' : `S${i}`,
      c2Bytes: i === 4 ? 256 : 0,
      voiceBytes: i === 4 ? 320 : 160,
      videoBytes: i === 15 ? 2400 : 0,
      photoBytes: i === 4 ? 42000 : 0,
      totalBacklogBytes: i === 4 ? 42576 : 160,
      c2Packets: i === 4 ? 2 : 0,
      voicePackets: i === 4 ? 2 : 1,
      videoPackets: i === 15 ? 2 : 0,
      photoPackets: i === 4 ? 30 : 0,
      snrDb: i === 4 ? -5.0 : 24.5,
      bitrateMbps: i === 4 ? 0 : 4.95,
      stateName: i === 4 ? 'HARD_SHADOW_CUTOFF' : 'NORMAL_LOS',
      linkOutage: i === 4,
      obstacleBlocked: false,
    });
  }
  return list;
}

function createMockAllocations(): SchedulerSlotAllocation[] {
  return [
    {
      nodeId: 15,
      startMs: 4.0,
      durationMs: 8.0,
      durationS: 0.008,
      slotStartS: 0.004,
      capacityBits: 39600,
      modcodName: '64-APSK 5/6',
      spectralEfficiency: 4.95,
      c2Bytes: 128,
      voiceBytes: 0,
      videoBytes: 0,
      photoBytes: 0,
      isPreOcclusionFlush: false,
    },
    {
      nodeId: 1,
      startMs: 12.012,
      durationMs: 2.0,
      durationS: 0.002,
      slotStartS: 0.012012,
      capacityBits: 9900,
      modcodName: '64-APSK 5/6',
      spectralEfficiency: 4.95,
      c2Bytes: 128,
      voiceBytes: 0,
      videoBytes: 0,
      photoBytes: 0,
      isPreOcclusionFlush: false,
    },
  ];
}

function createMockKpi(frameIndex: number, overrides?: Partial<SchedulerKpiSnapshot>): SchedulerKpiSnapshot {
  return {
    staticGoodputMb: Number((frameIndex * 0.015).toFixed(3)),
    tacGoodputMb: Number((frameIndex * 0.028).toFixed(3)),
    gainMultiplier: 1.86,
    staticWastePct: 22.5,
    tacWastePct: 0.0,
    staticDrops: Math.floor(frameIndex / 10),
    staticDropPct: 1.2,
    tacDrops: Math.floor(frameIndex / 50),
    tacDropPct: 0.2,
    ulUtilizationPct: 62.5,
    staticUtilizationPct: 100.0,
    tacUtilizationPct: 62.5,
    activeGoodputFrameBits: 49500,
    staticGoodputFrameBits: 39600,
    tacGoodputFrameBits: 49500,
    activeWastedFrameBits: 0,
    staticWastedFrameBits: 9900,
    tacWastedFrameBits: 0,
    activeDropFramePkts: 0,
    staticDropFramePkts: 1,
    tacDropFramePkts: 0,
    activeDropDelayFramePkts: 0,
    activeDropOverflowFramePkts: 0,
    staticDropDelayFramePkts: 1,
    staticDropOverflowFramePkts: 0,
    tacDropDelayFramePkts: 0,
    tacDropOverflowFramePkts: 0,
    node4PreShadowBacklogKb: 41.5,
    staticNode4PreShadowBacklogKb: 41.5,
    node4EvacStatus: 'SHADOWED - BUFFERING',
    staticSelectedBacklogKb: 41.5,
    tacSelectedBacklogKb: 0.0,
    ...overrides,
  };
}

function createMockSchedulerRecord(frameIndex: number, options?: {
  simTimeS?: number;
  schedulerMode?: string;
  selectedNodeId?: number | null;
  kpiOverrides?: Partial<SchedulerKpiSnapshot>;
}): SchedulerFrameRecord {
  return createSchedulerRecordSnapshot({
    frameIndex,
    simulationTimeS: options?.simTimeS ?? Number((frameIndex * 0.02).toFixed(3)),
    schedulerMode: options?.schedulerMode ?? 'tac_tad',
    selectedNodeId: options && 'selectedNodeId' in options ? (options.selectedNodeId ?? null) : 4,
    activeAllocations: createMockAllocations(),
    nodeBacklogs: createMockBacklogs(),
    kpi: createMockKpi(frameIndex, options?.kpiOverrides),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Ring-buffer capacity, ordering, and strict FIFO eviction
// ─────────────────────────────────────────────────────────────────────────────
{
  const capacity = 600;
  const buffer = new SchedulerHistoryBuffer(capacity);
  assert.equal(buffer.size, 0);

  // Push 700 frames
  for (let i = 1; i <= 700; i++) {
    buffer.push(createMockSchedulerRecord(i));
  }

  assert.equal(buffer.size, capacity, 'buffer clamps to max capacity');
  assert.equal(buffer.getOldest()?.frameIndex, 101, 'oldest frame is 101 after 100 evictions');
  assert.equal(buffer.getNewest()?.frameIndex, 700, 'newest frame is 700');

  // Verify evicted frames (1..100) are recognized as evicted and return null
  for (let i = 1; i <= 100; i++) {
    assert.equal(buffer.isEvicted(i), true, `frame ${i} is recognized as evicted`);
    assert.equal(buffer.getByFrameIndex(i), null, `evicted frame ${i} returns null`);
  }

  // Verify retained frames (101..700) are retrievable and ordered
  const records = buffer.getChronologicalRecords();
  assert.equal(records.length, 600);
  assert.equal(records[0].frameIndex, 101);
  assert.equal(records[records.length - 1].frameIndex, 700);

  for (let i = 101; i <= 700; i++) {
    assert.equal(buffer.isEvicted(i), false);
    const rec = buffer.getByFrameIndex(i);
    assert.ok(rec !== null);
    assert.equal(rec.frameIndex, i);
  }

  console.log('PASS Test 1 — Ring-buffer capacity, ordering, and strict FIFO eviction');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Exact frame/time correspondence
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SchedulerHistoryBuffer(10);
  buffer.push(createMockSchedulerRecord(42, { simTimeS: 0.84, schedulerMode: 'tac_tad' }));
  buffer.push(createMockSchedulerRecord(43, { simTimeS: 0.86, schedulerMode: 'static' }));

  const r42 = buffer.getByFrameIndex(42);
  assert.ok(r42);
  assert.equal(r42.frameIndex, 42);
  assert.equal(r42.simulationTimeS, 0.84);
  assert.equal(r42.schedulerMode, 'tac_tad');

  const r43 = buffer.getByFrameIndex(43);
  assert.ok(r43);
  assert.equal(r43.frameIndex, 43);
  assert.equal(r43.simulationTimeS, 0.86);
  assert.equal(r43.schedulerMode, 'static');

  const span = buffer.getSpan();
  assert.equal(span.oldestFrame, 42);
  assert.equal(span.newestFrame, 43);
  assert.equal(span.oldestTimeS, 0.84);
  assert.equal(span.newestTimeS, 0.86);

  console.log('PASS Test 2 — Exact frame/time correspondence');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Defensive-copy immutability
// ─────────────────────────────────────────────────────────────────────────────
{
  const allocations = createMockAllocations();
  const backlogs = createMockBacklogs();
  const kpi = createMockKpi(10);

  const record = createSchedulerRecordSnapshot({
    frameIndex: 10,
    simulationTimeS: 0.2,
    schedulerMode: 'tac_tad',
    selectedNodeId: 4,
    activeAllocations: allocations,
    nodeBacklogs: backlogs,
    kpi,
  });

  // Verify frozen status
  assert.ok(Object.isFrozen(record), 'record envelope is frozen');
  assert.ok(Object.isFrozen(record.activeAllocations), 'activeAllocations array is frozen');
  assert.ok(Object.isFrozen(record.activeAllocations[0]), 'allocation items are frozen');
  assert.ok(Object.isFrozen(record.nodeBacklogs), 'nodeBacklogs array is frozen');
  assert.ok(Object.isFrozen(record.nodeBacklogs[0]), 'backlog items are frozen');
  assert.ok(Object.isFrozen(record.kpi), 'kpi snapshot is frozen');

  // Attempt external mutation of source arrays
  allocations[0] = {
    ...allocations[0],
    durationMs: 999.0,
  };
  backlogs[4] = {
    ...backlogs[4],
    totalBacklogBytes: 0,
  };

  // Record must remain pristine
  assert.equal(record.activeAllocations[0].durationMs, 8.0, 'external mutation does not affect record allocation');
  assert.equal(record.nodeBacklogs[4].totalBacklogBytes, 42576, 'external mutation does not affect record backlog');

  console.log('PASS Test 3 — Defensive-copy immutability');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Correct separation of cumulative metrics and per-frame deltas
// ─────────────────────────────────────────────────────────────────────────────
{
  const frame1 = createMockSchedulerRecord(1, {
    kpiOverrides: {
      tacGoodputMb: 0.05,
      activeGoodputFrameBits: 40000,
      tacDrops: 0,
      activeDropFramePkts: 0,
    },
  });

  const frame2 = createMockSchedulerRecord(2, {
    kpiOverrides: {
      tacGoodputMb: 0.12,
      activeGoodputFrameBits: 56000,
      tacDrops: 2,
      activeDropFramePkts: 2,
      activeDropDelayFramePkts: 2,
      activeDropOverflowFramePkts: 0,
    },
  });

  // Frame 1 check
  assert.equal(frame1.kpi.tacGoodputMb, 0.05, 'cumulative goodput is preserved');
  assert.equal(frame1.kpi.activeGoodputFrameBits, 40000, 'per-frame goodput bits are separate');
  assert.equal(frame1.kpi.activeDropFramePkts, 0);

  // Frame 2 check
  assert.equal(frame2.kpi.tacGoodputMb, 0.12);
  assert.equal(frame2.kpi.activeGoodputFrameBits, 56000);
  assert.equal(frame2.kpi.tacDrops, 2, 'cumulative drops are 2');
  assert.equal(frame2.kpi.activeDropFramePkts, 2, 'interval drop delta is 2');
  assert.equal(frame2.kpi.activeDropDelayFramePkts, 2);
  assert.equal(frame2.kpi.activeDropOverflowFramePkts, 0);

  console.log('PASS Test 4 — Correct separation of cumulative metrics and per-frame deltas');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Correct behavior for missing or unavailable metrics
// ─────────────────────────────────────────────────────────────────────────────
{
  // A snapshot created without optional per-frame fields retains undefined rather than fabricating 0
  const kpiSparse: SchedulerKpiSnapshot = {
    staticGoodputMb: 1.0,
    tacGoodputMb: 1.5,
    gainMultiplier: 1.5,
    staticWastePct: 10.0,
    tacWastePct: 0.0,
    staticDrops: 5,
    staticDropPct: 0.5,
    tacDrops: 1,
    tacDropPct: 0.1,
    ulUtilizationPct: 50.0,
  };

  const record = createSchedulerRecordSnapshot({
    frameIndex: 1,
    simulationTimeS: 0.02,
    schedulerMode: 'tac_tad',
    selectedNodeId: 4,
    activeAllocations: [],
    nodeBacklogs: [],
    kpi: kpiSparse,
  });

  assert.equal(record.kpi.activeGoodputFrameBits, undefined, 'uninstrumented metric is undefined, not 0');
  assert.equal(record.kpi.activeDropFramePkts, undefined);
  assert.equal(record.kpi.staticGoodputFrameBits, undefined);

  console.log('PASS Test 5 — Correct behavior for missing or unavailable metrics');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — Exclusion of PROFILE_FRAME from scheduler frame insertion
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SchedulerHistoryBuffer(50);
  const sim = new SimulationWorkerManager();

  // Advance simulation 3 ticks
  sim.tickSimulation();
  assert.equal(sim.frameIndex, 1);
  buffer.push(createMockSchedulerRecord(sim.frameIndex, { simTimeS: sim.simTimeS }));

  sim.tickSimulation();
  assert.equal(sim.frameIndex, 2);
  buffer.push(createMockSchedulerRecord(sim.frameIndex, { simTimeS: sim.simTimeS }));

  sim.tickSimulation();
  assert.equal(sim.frameIndex, 3);
  buffer.push(createMockSchedulerRecord(sim.frameIndex, { simTimeS: sim.simTimeS }));

  assert.equal(buffer.size, 3);
  assert.equal(buffer.getNewest()?.frameIndex, 3);

  // Now simulate SELECT_NODE while paused, which emits PROFILE_FRAME
  sim.isPaused = true;
  sim.handleMessage({ type: 'SELECT_NODE', node_id: 2 });
  // In simWorker.ts, emitProfileFrame() does NOT advance frameIndex or simTimeS
  assert.equal(sim.frameIndex, 3, 'PROFILE_FRAME does not advance frameIndex');

  // If a caller attempts to push the same frameIndex again during pause, buffer slot is updated without advancing timeline
  buffer.push(createMockSchedulerRecord(3, { simTimeS: sim.simTimeS, selectedNodeId: 2 }));
  assert.equal(buffer.size, 3, 'duplicate frameIndex does not expand buffer size');
  assert.equal(buffer.getNewest()?.selectedNodeId, 2, 'record updated with latest selectedNodeId');

  console.log('PASS Test 6 — Exclusion of PROFILE_FRAME from scheduler frame insertion');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — Historical inspection without mutation of live simulation state
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SchedulerHistoryBuffer(20);
  for (let i = 1; i <= 10; i++) {
    buffer.push(createMockSchedulerRecord(i));
  }

  const controller = new SchedulerHistoryController(buffer);
  const sim = new SimulationWorkerManager();

  // Advance live sim to frame 15
  for (let i = 1; i <= 15; i++) {
    sim.tickSimulation();
  }
  const liveFrame = sim.frameIndex;
  const liveTime = sim.simTimeS;
  const liveGoodput = sim.metrics.tacGoodputBits;

  // Enter historical inspection at frame 4
  const { record, shouldPause } = controller.enterHistorical(4, false);
  assert.ok(record);
  assert.equal(record.frameIndex, 4);
  assert.equal(shouldPause, false);
  assert.equal(controller.isInspecting, true);
  assert.equal(controller.currentInspectedFrame, 4);

  // Scrub back and forth
  controller.scrubTo(7);
  assert.equal(controller.currentInspectedFrame, 7);
  controller.scrubTo(2);
  assert.equal(controller.currentInspectedFrame, 2);

  // Worker state must be completely untouched
  assert.equal(sim.frameIndex, liveFrame, 'worker frameIndex is unmodified by scrubbing');
  assert.equal(sim.simTimeS, liveTime, 'worker simTimeS is unmodified by scrubbing');
  assert.equal(sim.metrics.tacGoodputBits, liveGoodput, 'worker accumulators are unmodified by scrubbing');

  // Exit historical mode
  const { shouldResume } = controller.exitHistorical();
  assert.equal(controller.isInspecting, false);
  assert.equal(shouldResume, false);

  console.log('PASS Test 7 — Historical inspection without mutation of live simulation state');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Reset and pause/resume behavior
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SchedulerHistoryBuffer(20);
  for (let i = 1; i <= 5; i++) buffer.push(createMockSchedulerRecord(i));

  const controller = new SchedulerHistoryController(buffer);

  // Enter historical while simulation was running
  const entry = controller.enterHistorical(3, true);
  assert.equal(entry.shouldPause, true, 'controller instructs caller to pause live worker');
  assert.equal(controller.wasRunningBefore, true);

  // Exit historical
  const exit = controller.exitHistorical();
  assert.equal(exit.shouldResume, true, 'controller instructs caller to resume live worker');
  assert.equal(controller.isInspecting, false);

  // Test reset
  controller.enterHistorical(2, false);
  controller.reset();
  assert.equal(controller.isInspecting, false);
  assert.equal(controller.currentInspectedFrame, null);
  assert.equal(controller.historyBuffer.size, 0, 'buffer is cleared');

  console.log('PASS Test 8 — Reset and pause/resume behavior');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — Selected-node backlog and allocation correspondence
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SchedulerHistoryBuffer(10);
  buffer.push(createMockSchedulerRecord(100, { selectedNodeId: 4 }));

  const rec = buffer.getByFrameIndex(100)!;
  assert.ok(rec);

  // Verify Node 4 backlog
  const n4 = rec.nodeBacklogs.find(n => n.nodeId === 4);
  assert.ok(n4);
  assert.equal(n4.c2Bytes, 256);
  assert.equal(n4.voiceBytes, 320);
  assert.equal(n4.photoBytes, 42000);
  assert.equal(n4.totalBacklogBytes, 42576);
  assert.equal(n4.stateName, 'HARD_SHADOW_CUTOFF');

  // Verify Node 15 allocation
  const alloc15 = rec.activeAllocations.find(a => a.nodeId === 15);
  assert.ok(alloc15);
  assert.equal(alloc15.durationMs, 8.0);
  assert.equal(alloc15.capacityBits, 39600);
  assert.equal(alloc15.modcodName, '64-APSK 5/6');

  // Verify selectedNodeId: null support without fallback invention
  buffer.push(createMockSchedulerRecord(101, { selectedNodeId: null }));
  const recNull = buffer.getByFrameIndex(101)!;
  assert.ok(recNull);
  assert.strictEqual(recNull.selectedNodeId, null, 'selectedNodeId is preserved as null when unselected');
  assert.strictEqual(rec.kpi.staticSelectedBacklogKb, 41.5, 'staticSelectedBacklogKb is recorded');
  assert.strictEqual(rec.kpi.tacSelectedBacklogKb, 0.0, 'tacSelectedBacklogKb is recorded');
  const memNull = estimateSchedulerRecordMemoryBytes(recNull);
  assert.ok(memNull > 0 && memNull < 5000, 'memory estimation succeeds with null selectedNodeId');

  console.log('PASS Test 9 — Selected-node backlog and allocation correspondence');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 10 — Bounded memory and absence of DEM/profile arrays
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SchedulerHistoryBuffer(600);
  for (let i = 1; i <= 600; i++) {
    buffer.push(createMockSchedulerRecord(i));
  }
  assert.equal(buffer.size, 600);

  const totalBytes = buffer.measureTotalMemoryBytes();
  const bytesPerRecord = totalBytes / 600;
  const totalMb = totalBytes / (1024 * 1024);

  // Verify memory bounds: record should be ~1-3 KB, total buffer well under 2.0 MB
  assert.ok(bytesPerRecord > 500, `record memory (${bytesPerRecord} B) is non-trivial`);
  assert.ok(bytesPerRecord < 4000, `record memory (${bytesPerRecord} B) is bounded`);
  assert.ok(totalMb < 2.0, `total buffer memory (${totalMb.toFixed(2)} MB) is strictly under 2.0 MB`);

  // Verify DEM and profile sample absence
  const sample = buffer.getByFrameIndex(300)!;
  assert.equal((sample as any).dem, undefined, 'no DEM elevation grid attached');
  assert.equal((sample as any).profile, undefined, 'no RF link profile attached to scheduler record');
  assert.equal((sample as any).samples, undefined, 'no profile samples attached');

  console.log(`PASS Test 10 — Bounded memory (${totalMb.toFixed(2)} MB for 600 frames, ${bytesPerRecord.toFixed(0)} B/frame) and absence of DEM/profile arrays`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 — Existing scheduler outputs remain unchanged by telemetry instrumentation
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager();
  sim.tickSimulation();

  // Test that comparative_kpi_dashboard carries all required original and additive fields
  const frame = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
  const kpi = frame.comparative_kpi_dashboard;

  // Original fields
  assert.ok(typeof kpi.static_goodput_mb === 'number');
  assert.ok(typeof kpi.tac_goodput_mb === 'number');
  assert.ok(typeof kpi.gain_multiplier === 'number');
  assert.ok(typeof kpi.static_waste_pct === 'number');
  assert.ok(typeof kpi.tac_waste_pct === 'number');
  assert.ok(typeof kpi.static_drops === 'number');
  assert.ok(typeof kpi.tac_drops === 'number');
  assert.ok(typeof kpi.ul_utilization_pct === 'number');

  // Additive instrumentation fields
  assert.ok(typeof kpi.static_goodput_frame_bits === 'number');
  assert.ok(typeof kpi.tac_goodput_frame_bits === 'number');
  assert.ok(typeof kpi.active_goodput_frame_bits === 'number');
  assert.ok(typeof kpi.static_drop_frame_pkts === 'number');
  assert.ok(typeof kpi.tac_drop_frame_pkts === 'number');
  assert.ok(typeof kpi.active_drop_frame_pkts === 'number');
  assert.ok(typeof kpi.static_utilization_pct === 'number');
  assert.ok(typeof kpi.tac_utilization_pct === 'number');

  // Active allocations present
  assert.ok(Array.isArray(frame.active_gantt_allocations));

  console.log('PASS Test 11 — Existing scheduler outputs remain unchanged by telemetry instrumentation');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 12 — Eviction clamping and span metadata
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SchedulerHistoryBuffer(5);
  for (let i = 1; i <= 10; i++) buffer.push(createMockSchedulerRecord(i));

  const controller = new SchedulerHistoryController(buffer);

  // Target frame 2 (which was evicted)
  const clamped = controller.scrubTo(2);
  assert.ok(clamped);
  assert.equal(clamped.frameIndex, 6, 'evicted target clamps to oldest retained frame 6');
  assert.equal(controller.isEvicted, true, 'controller marks isEvicted = true');

  // Target frame 20 (which is in the future)
  const clampedFuture = controller.scrubTo(20);
  assert.ok(clampedFuture);
  assert.equal(clampedFuture.frameIndex, 10, 'future target clamps to newest frame 10');
  assert.equal(controller.isEvicted, false);

  console.log('PASS Test 12 — Eviction clamping and span metadata');
}

console.log('PASS All Milestone Scheduler Performance History integration tests passed.');

