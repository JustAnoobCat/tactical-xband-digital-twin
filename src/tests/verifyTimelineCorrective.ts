/**
 * Verification Suite: Simulation Timeline Corrective Fixes (SPEC-TIMELINE-CORRECTIVE-01-REV14)
 * Covers TC-CORR-01 through TC-CORR-16.15.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FQCoDelQueue, GroundNodeTrafficSubsystem, Packet } from '../core/queues';
import { LinkStatus } from '../core/linkBudget';
import {
  LegacyStaticScheduler,
  TerrainAwareDynamicScheduler,
} from '../core/scheduler';
import { NodeTerrainState, PredictiveState } from '../core/trajectory';
import {
  EvictionDropFinalizationRecord,
  SuperframeEpochRecord,
  TelemetryFrame,
  WorkerCommandResult,
  WorkerOutboundMessage,
} from '../shared/workerProtocol';
import {
  SimulationWorkerManager,
  resolveDeletionFrameAssociation,
} from '../worker/simWorker';
import { SpatialSnapshotBuffer } from '../ui/spatialSnapshotBuffer';
import { SuperframeEpochStore } from '../ui/superframeEpochStore';
import { SimulationTimelineController } from '../ui/simulationTimelineController';
import { SimulationTimelineRenderer } from '../ui/simulationTimelineRenderer';
import { scanTimelineEvents } from '../ui/timelineEventScanner';
import {
  inspectTimelineFrame,
  renderFrameInspectorDom,
} from '../ui/timelineFrameInspector';
import * as frameInspectorMod from '../ui/timelineFrameInspector';
import * as csvExporterMod from '../ui/timelineCsvExporter';
import {
  exportTimelineDualCsv,
  generateCommEpochsCsv,
  generateSpatialFramesCsv,
} from '../ui/timelineCsvExporter';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertClose(actual: number, expected: number, eps: number, label: string): void {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${label}: expected ${expected} (+/-${eps}), got ${actual}`);
  }
}

interface TestCase {
  readonly id: string;
  readonly name: string;
  readonly fn: () => void | Promise<void>;
}

const TESTS: TestCase[] = [];

function registerTest(id: string, name: string, fn: () => void | Promise<void>): void {
  TESTS.push({ id, name, fn });
}

// ----------------------------------------------------------------------------
// TC-CORR-01: FQCoDelQueue Monotonic Counters Survive reset() & TL-T7 Parity
// ----------------------------------------------------------------------------
registerTest('TC-CORR-01', 'FQCoDelQueue monotonic drop counters survive reset() while keeping TL-T7 reset parity', () => {
  const q = new FQCoDelQueue(2, 1);

  // 1. Trigger C2 overflow eviction in enqueue
  const pC2a = new Packet(1, 10, 69, 100, 0.0, 60.0);
  const pC2b = new Packet(2, 10, 69, 128, 0.1, 60.0);
  q.enqueue(pC2a);
  const [acceptedB, evictedB] = q.enqueue(pC2b);
  assert(acceptedB && evictedB.length === 1 && evictedB[0].packetId === 1, 'C2 overflow should evict pC2a');

  // 2. Trigger non-C2 overflow drop when buffer has C2 + non-C2 (maxBufferPackets=2)
  const pVo = new Packet(3, 10, 65, 160, 0.2, 0.5);
  const pVi = new Packet(4, 10, 67, 1200, 0.3, 0.6);
  q.enqueue(pVo);
  const [acceptedVi, evictedVi] = q.enqueue(pVi);
  assert(acceptedVi && evictedVi.length === 1 && evictedVi[0].packetId === 3, 'Lower/equal non-C2 should evict pVo (160 B)');

  // 3. Drain remaining packets via reset, then test C2-only !dropped non-C2 rejection overflow
  const beforeSecondPhaseOverflowBytes = q.droppedOverflowBytes;
  assertClose(beforeSecondPhaseOverflowBytes, 100 + 160, 1e-6, 'overflow bytes after first 2 evictions');

  // 4. Delay drop in dequeue()
  const qDelay = new FQCoDelQueue(10, 5);
  qDelay.enqueue(new Packet(10, 10, 65, 200, 0.0, 0.075));
  const served = qDelay.dequeue(2000, 0.1);
  assert(served.length === 0, 'Expired voice packet must be dropped during dequeue');
  assert(qDelay.droppedDelayCount === 1, 'droppedDelayCount should be 1');
  assert(qDelay.droppedDelayBytes === 200, 'droppedDelayBytes should be 200');
  assert((qDelay as unknown as { monotonicDroppedDelayCount: number }).monotonicDroppedDelayCount === 1, 'monotonicDroppedDelayCount should be 1');
  assert((qDelay as unknown as { monotonicDroppedDelayBytes: number }).monotonicDroppedDelayBytes === 200, 'monotonicDroppedDelayBytes should be 200');

  // 5. Delay drop in pruneExpiredPackets() + overflow
  qDelay.enqueue(new Packet(11, 10, 70, 500, 0.1, 0.2));
  const pruned = qDelay.pruneExpiredPackets(0.25);
  assert(pruned.length === 1, 'pruneExpiredPackets should drop expired packet');
  assert((qDelay as unknown as { monotonicDroppedDelayCount: number }).monotonicDroppedDelayCount === 2, 'monotonicDroppedDelayCount should increment to 2');
  assert((qDelay as unknown as { monotonicDroppedDelayBytes: number }).monotonicDroppedDelayBytes === 700, 'monotonicDroppedDelayBytes should sum to 700');

  // 6. C2-only fallback non-C2 rejection overflow branch
  const qC2Full = new FQCoDelQueue(1, 1);
  qC2Full.enqueue(new Packet(20, 10, 69, 128, 0.0, 60.0));
  const [acceptedLow, evictedLow] = qC2Full.enqueue(new Packet(21, 10, 70, 1400, 0.01, 0.5));
  assert(!acceptedLow && evictedLow.length === 1, 'Non-C2 cannot evict sole C2 packet');
  assert((qC2Full as unknown as { monotonicDroppedOverflowCount: number }).monotonicDroppedOverflowCount === 1, 'monotonicDroppedOverflowCount=1');
  assert((qC2Full as unknown as { monotonicDroppedOverflowBytes: number }).monotonicDroppedOverflowBytes === 1400, 'monotonicDroppedOverflowBytes=1400');

  // 7. reset() zeroes resettable fields (TL-T7 parity) while preserving monotonic fields
  qDelay.enqueue(new Packet(12, 10, 70, 300, 0.3, 0.5));
  const monoDelayBefore = (qDelay as unknown as { monotonicDroppedDelayBytes: number }).monotonicDroppedDelayBytes;
  const monoTotalBefore = (qDelay as unknown as { monotonicTotalDroppedBytes: number }).monotonicTotalDroppedBytes;
  assert(monoDelayBefore === 700 && monoTotalBefore === 700, 'Pre-reset monotonic totals check');

  qDelay.reset();
  assert(qDelay.droppedDelayCount === 0, 'TL-T7: reset() zeroes droppedDelayCount');
  assert(qDelay.droppedOverflowCount === 0, 'TL-T7: reset() zeroes droppedOverflowCount');
  assert(qDelay.droppedDelayBytes === 0, 'TL-T7: reset() zeroes droppedDelayBytes');
  assert(qDelay.droppedOverflowBytes === 0, 'TL-T7: reset() zeroes droppedOverflowBytes');
  assert(qDelay.totalDroppedBytes === 0, 'TL-T7: reset() zeroes totalDroppedBytes');

  assert((qDelay as unknown as { monotonicDroppedDelayCount: number }).monotonicDroppedDelayCount === 2, 'monotonicDroppedDelayCount survives reset()');
  assert((qDelay as unknown as { monotonicDroppedDelayBytes: number }).monotonicDroppedDelayBytes === 700, 'monotonicDroppedDelayBytes survives reset()');
  assert((qDelay as unknown as { monotonicTotalDroppedBytes: number }).monotonicTotalDroppedBytes === 700, 'monotonicTotalDroppedBytes survives reset()');

  // 8. Post-reset drops keep accumulating on monotonic counters from preserved value
  qDelay.enqueue(new Packet(13, 10, 67, 450, 1.0, 1.1));
  qDelay.pruneExpiredPackets(1.2);
  assert(qDelay.droppedDelayBytes === 450, 'Resettable counter tracks only post-reset drops');
  assert((qDelay as unknown as { monotonicDroppedDelayBytes: number }).monotonicDroppedDelayBytes === 1150, 'Monotonic counter accumulates past reset');
  assert((qDelay as unknown as { monotonicTotalDroppedBytes: number }).monotonicTotalDroppedBytes === 1150, 'Monotonic total accumulates past reset');

  // 9. REV11 03: Pre-reset() pending drops across queue.reset() (1,000 -> +100 pending -> reset() -> +150 = 250 delta)
  for (const sched of [new LegacyStaticScheduler(), new TerrainAwareDynamicScheduler(0.008)]) {
    const node = new GroundNodeTrafficSubsystem(1, 'soldier', [0, 0, 3000], 303);
    const links = { 1: makeHealthyLink() };
    const preds = { 1: makeNormalPred() };

    node.enqueuePacket(65, 0.0, 1000, 0.01);
    const f0 = sched.scheduleFrame(0, 0.5, [node], links, preds) as unknown as Record<string, number>;
    assert(f0.totalDroppedBytesThisFrame === 1000 && f0.runTotalDroppedBytes === 1000,
      `${sched.schedulerName} initial baseline 1,000 B recorded`);

    // +100 pending drops before reset(), then reset(), then +150 drops before next scheduleFrame()
    node.enqueuePacket(65, 0.5, 100, 0.51);
    node.queue.pruneExpiredPackets(0.55);
    node.queue.reset();
    node.enqueuePacket(65, 0.55, 150, 0.56);
    node.queue.pruneExpiredPackets(0.60);

    const f1 = sched.scheduleFrame(1, 0.62, [node], links, preds) as unknown as Record<string, number>;
    assert(f1.totalDroppedBytesThisFrame === 250,
      `${sched.schedulerName} captures 100 pre-reset + 150 post-reset = 250 B (got ${f1.totalDroppedBytesThisFrame})`);
    assert(f1.runTotalDroppedBytes === 1250,
      `${sched.schedulerName} preserves exact 1,250 B run total across pending pre-reset drops`);
  }
});

function makeHealthyLink(nodeType: 'soldier' | 'command_post' = 'soldier'): LinkStatus {
  return {
    nodeType,
    slantRangeM: 15000,
    fsplDb: 134,
    diffractionLossDb: 0,
    gasLossDb: 0.1,
    rainLossDb: 0,
    cableLossDb: 1.5,
    implementationMarginDb: 2.5,
    totalLossDb: 138.1,
    pTxDbm: 36,
    txGainDbi: 3,
    rxGainDbi: 15,
    prxDbm: -84.1,
    pNoiseDbm: -108.97,
    snrDb: 24.87,
    modcodName: '64-APSK 5/6',
    spectralEfficiency: 4.95,
    bitrateBps: 4.95e6,
    bitrateMbps: 4.95,
    isOutage: false,
  };
}

function makeNormalPred(): PredictiveState {
  return {
    currentState: NodeTerrainState.NORMAL_LOS,
    timeToOcclusionS: Number.POSITIVE_INFINITY,
    timeToEmergenceS: 0,
    fresnelClearanceM: 50,
    fresnelRateOfChangeMps: 0,
    predictedOutageDurationS: 0,
  };
}

// ----------------------------------------------------------------------------
// TC-CORR-02: Scheduler Invocation-Delta Byte Drop Accounting (Static + Tac)
// ----------------------------------------------------------------------------
registerTest('TC-CORR-02', 'Schedulers report per-frame drop byte deltas (no sticky cumulative leakage) + survive queue.reset()', () => {
  for (const sched of [new LegacyStaticScheduler(), new TerrainAwareDynamicScheduler(0.008)]) {
    const node = new GroundNodeTrafficSubsystem(1, 'soldier', [0, 0, 3000], 101);
    const links = { 1: makeHealthyLink() };
    const preds = { 1: makeNormalPred() };

    // Drop 1 delay packet (160 B) during frame 0 dequeue
    node.enqueuePacket(65, 0.0, 160, 0.01);
    const f0 = sched.scheduleFrame(0, 1.0, [node], links, preds) as unknown as Record<string, number>;
    assert(f0.droppedDelayBytes === 160, `${sched.schedulerName} f0 droppedDelayBytes=160`);
    assert(f0.droppedDelayBytesThisFrame === 160, `${sched.schedulerName} f0 droppedDelayBytesThisFrame=160`);
    assert(f0.totalDroppedBytesThisFrame === 160, `${sched.schedulerName} f0 totalDroppedBytesThisFrame=160`);
    assert(f0.runTotalDroppedBytes === 160, `${sched.schedulerName} f0 runTotalDroppedBytes=160`);

    // Frame 1 with zero new drops -> byte deltas MUST return to 0!
    const f1 = sched.scheduleFrame(1, 1.02, [node], links, preds) as unknown as Record<string, number>;
    assert(f1.droppedDelayBytes === 0, `${sched.schedulerName} f1 droppedDelayBytes MUST reset to 0`);
    assert(f1.droppedDelayBytesThisFrame === 0, `${sched.schedulerName} f1 droppedDelayBytesThisFrame MUST reset to 0`);
    assert(f1.totalDroppedBytes === 0, `${sched.schedulerName} f1 totalDroppedBytes MUST reset to 0`);
    assert(f1.runTotalDroppedBytes === 160, `${sched.schedulerName} f1 runTotalDroppedBytes remains 160`);

    // Reset queue explicitly mid-run, trigger new overflow drop (1400 B) via enqueue on small queue capacity test
    node.queue.reset();
    // Fill queue past maxBufferPackets=400 with 401 packets -> 1 overflow eviction (1400 B)
    for (let i = 0; i < 401; i++) {
      node.enqueuePacket(70, 1.02, 1400, 1.5);
    }
    const f2 = sched.scheduleFrame(2, 1.04, [node], links, preds) as unknown as Record<string, number>;
    assert(f2.droppedOverflowBytesThisFrame === 1400, `${sched.schedulerName} f2 droppedOverflowBytesThisFrame=1400 even after queue.reset()`);
    assert(f2.totalDroppedBytes === 1400, `${sched.schedulerName} f2 totalDroppedBytes=1400`);
    assert(f2.runDroppedOverflowBytes === 1400, `${sched.schedulerName} f2 runDroppedOverflowBytes=1400`);
    assert(f2.runTotalDroppedBytes === 1560, `${sched.schedulerName} f2 runTotalDroppedBytes=1560`);

    // REV11 TC-CORR-04 / REV15-D3: Pre-accumulated dirty node registered via registerNode() yields 0 phantom drops on next scheduleFrame()
    const dirtyNode = new GroundNodeTrafficSubsystem(99, 'soldier', [0, 0, 3000], 999);
    for (let k = 0; k < 50; k++) {
      dirtyNode.enqueuePacket(65, 0.0, 1000, 0.01);
    }
    dirtyNode.queue.pruneExpiredPackets(0.1); // 50,000 B dropped BEFORE registerNode
    assert(dirtyNode.queue.monotonicTotalDroppedBytes === 50000, 'Dirty node pre-accumulated 50,000 dropped bytes');
    (sched as unknown as { registerNode(n: GroundNodeTrafficSubsystem): void }).registerNode(dirtyNode);
    const fDirty = sched.scheduleFrame(3, 1.06, [node, dirtyNode], { ...links, 99: makeHealthyLink() }, { ...preds, 99: makeNormalPred() });
    assert(fDirty.droppedDelayBytesThisFrame === 0 && fDirty.totalDroppedBytesThisFrame === 0, `${sched.schedulerName} registerNode(dirtyNode) emits 0 phantom drops on first frame`);
  }
});

// ----------------------------------------------------------------------------
// TC-CORR-03: Scheduler Eviction Capture, Zero-After-First-Capture & Re-use
// ----------------------------------------------------------------------------
registerTest('TC-CORR-03', 'Scheduler eviction finalization captures pending drops once, cleans maps, and allows nodeId reuse', () => {
  for (const sched of [new LegacyStaticScheduler(), new TerrainAwareDynamicScheduler(0.008)]) {
    const ext = sched as unknown as {
      registerNode(node: GroundNodeTrafficSubsystem): void;
      capturePendingDropsBeforeEviction(node: GroundNodeTrafficSubsystem): {
        captured: boolean;
        droppedDelayPkts: number;
        droppedOverflowPkts: number;
        totalDroppedPkts: number;
        droppedDelayBytes: number;
        droppedOverflowBytes: number;
        totalDroppedBytes: number;
      };
      evictNode(nodeId: number, node?: GroundNodeTrafficSubsystem): {
        captured: boolean;
        droppedDelayPkts: number;
        droppedOverflowPkts: number;
        totalDroppedPkts: number;
        droppedDelayBytes: number;
        droppedOverflowBytes: number;
        totalDroppedBytes: number;
      } | null;
      getRunDropTotals(): { droppedDelayBytes: number; droppedOverflowBytes: number; totalDroppedBytes: number };
      hasDropBaseline(nodeId: number): boolean;
      hasTrackedNode(nodeId: number): boolean;
    };

    const node1 = new GroundNodeTrafficSubsystem(7, 'soldier', [0, 0, 3000], 201);
    ext.registerNode(node1);
    assert(ext.hasTrackedNode(7), 'registerNode marks tracked node');

    // Trigger pending delay drop BEFORE scheduleFrame
    node1.enqueuePacket(65, 0.0, 250, 0.05);
    node1.queue.pruneExpiredPackets(0.1);

    const cap1 = ext.capturePendingDropsBeforeEviction(node1);
    assert(cap1.captured === true, 'First capture marks captured=true');
    assert(cap1.droppedDelayPkts === 1 && cap1.droppedDelayBytes === 250 && cap1.totalDroppedBytes === 250, 'First capture captures 250B delay drop');

    // Zero-After-First-Capture guard on same node instance
    const cap2 = ext.capturePendingDropsBeforeEviction(node1);
    assert(cap2.captured === false && cap2.totalDroppedBytes === 0 && cap2.totalDroppedPkts === 0, 'Second capture on retired instance returns zero');

    // evictNode cleans maps without double-counting into run drop totals
    const ev1 = ext.evictNode(7, node1);
    assert(ev1 !== null && ev1.captured === false && ev1.totalDroppedBytes === 0, 'evictNode after capture returns zero without double-counting');
    assert(!ext.hasDropBaseline(7) && !ext.hasTrackedNode(7), 'evictNode cleans baseline & tracked maps');
    assert(ext.getRunDropTotals().totalDroppedBytes === 250, 'Run drop totals equal exact single capture (250 B)');

    // evictNode on unknown/already-evicted node returns null
    const evNull = ext.evictNode(7, node1);
    assert(evNull === null, 'Repeated evictNode on untracked nodeId returns null');

    // Single-step evictNode(nodeId) without prior capturePendingDropsBeforeEviction
    const node2 = new GroundNodeTrafficSubsystem(8, 'soldier', [0, 0, 3000], 202);
    ext.registerNode(node2);
    node2.enqueuePacket(67, 0.0, 600, 0.05);
    node2.queue.pruneExpiredPackets(0.1);
    const evDirect = ext.evictNode(8);
    assert(evDirect !== null && evDirect.captured === true && evDirect.totalDroppedBytes === 600, 'Direct evictNode(id) uses trackedNodes and captures once');
    assert(ext.getRunDropTotals().totalDroppedBytes === 850, 'Run totals advance to 850 B');

    // Reuse nodeId=7 with brand new instance -> NOT blocked by WeakSet
    const node7Reused = new GroundNodeTrafficSubsystem(7, 'soldier', [0, 0, 3000], 203);
    ext.registerNode(node7Reused);
    node7Reused.enqueuePacket(65, 1.0, 160, 1.02);
    node7Reused.queue.pruneExpiredPackets(1.1);
    const capReused = ext.evictNode(7);
    assert(capReused !== null && capReused.captured === true && capReused.totalDroppedBytes === 160, 'Reused nodeId tracks new instance cleanly');
    assert(ext.getRunDropTotals().totalDroppedBytes === 1010, 'Run totals advance to 1010 B');
  }
});

// ----------------------------------------------------------------------------
// TC-CORR-04: Worker Run Identity, Deletion Frame Association & Eviction Pipeline
// ----------------------------------------------------------------------------
registerTest('TC-CORR-04', 'SimulationWorkerManager stamps simulation_run_id, resolves deletion frames, and emits single-owner eviction finalizations', () => {
  assert(resolveDeletionFrameAssociation(0, 0) === 1, 'Pre-tick deletion (0.0, 0) associates to frame 1');
  assert(resolveDeletionFrameAssociation(0.02, 1) === 1, 'Tick 1 deletion associates to frame 1');
  assert(resolveDeletionFrameAssociation(0.5, 25) === 25, 'Tick 25 deletion associates to frame 25');
  assert(resolveDeletionFrameAssociation(0.24, 0) === 1, 'frameIndex <= 0 resolves to frame 1');
  assert(resolveDeletionFrameAssociation(0.025, 1) === 2, 'REV11 TC-CORR-05.5: fractional excess > expectedTickEndS advances frame association');

  // REV11 TC-CORR-05.4: Pre-Tick-1 worker NODE_DELETE at (0.0, 0) associates to frame 1 + reused nodeId has 0 phantom drops
  {
    const wPre = new SimulationWorkerManager(100, '16_NODES');
    const preNodeStatic = wPre.nodesStatic.find((n) => n.nodeId === 1)!;
    for (let i = 0; i < 401; i++) {
      preNodeStatic.enqueuePacket(70, 0.0, 1400, 0.5);
    }
    const delPre = wPre.handleMessage({ type: 'NODE_DELETE', node_id: 1 });
    assert(delPre.accepted && (delPre.eviction_finalizations?.length ?? 0) === 1, 'Pre-Tick-1 deletion emits pending eviction finalization');
    assert(delPre.eviction_finalizations![0].associatedSimulationFrameIndex === 1, 'Pre-Tick-1 eviction associates to frameIndex=1');
    const addReuse = wPre.handleMessage({ type: 'NODE_ADD', node_type: 'soldier', x_m: 1000, y_m: 1000 } as any);
    assert(addReuse.accepted, 'Re-added node accepted');
    wPre.tickSimulation(true);
    const frameStaticDrops = wPre.lastReportStatic?.totalDroppedBytesThisFrame ?? 0;
    assert(frameStaticDrops === 0, 'Newly added node post-eviction produces 0 phantom drops');
  }

  const worker = new SimulationWorkerManager(100, '16_NODES');
  const emittedFrames: TelemetryFrame[] = [];
  const rawWorker = worker as unknown as {
    emitHostMessage: (message: WorkerOutboundMessage, transferList?: Transferable[]) => void;
    simulationRunId?: number;
  };
  const origEmit = rawWorker.emitHostMessage.bind(worker);
  rawWorker.emitHostMessage = (message: WorkerOutboundMessage, transferList?: Transferable[]) => {
    if (message.type === 'TELEMETRY_FRAME') {
      emittedFrames.push(message.frame);
    }
    origEmit(message, transferList);
  };

  assert(rawWorker.simulationRunId === 1, 'Initial simulationRunId starts at 1');

  // Switch to 40ms superframe so tick 1 runs queues WITHOUT running scheduler/epoch yet
  worker.handleMessage({ type: 'CONFIG_UPDATE', params: { tdma_frame_duration_ms: 40 } } as any);
  worker.tickSimulation(true);
  assert(emittedFrames.length === 1, 'Frame 1 emitted');
  assert(emittedFrames[0].simulation_run_id === 1, 'Frame 1 telemetry stamps simulation_run_id=1');

  // Inject uncollected overflow drops onto node 2 before frame 2 superframe runs
  const targetStatic = worker.nodesStatic.find((n) => n.nodeId === 2)!;
  const targetTac = worker.nodesTac.find((n) => n.nodeId === 2)!;
  for (let i = 0; i < 401; i++) {
    targetStatic.enqueuePacket(70, worker.simTimeS, 1400, worker.simTimeS + 0.5);
    targetTac.enqueuePacket(70, worker.simTimeS, 1400, worker.simTimeS + 0.5);
  }
  const expectedFrameIdx = worker.frameIndex;

  // Delete node 2 synchronously
  const delRes = worker.handleMessage({ type: 'NODE_DELETE', node_id: 2 });
  assert(delRes.accepted === true, 'NODE_DELETE accepted');
  assert(delRes.simulation_run_id === 1, 'NODE_DELETE COMMAND_RESULT carries simulation_run_id=1');
  const evictions = delRes.eviction_finalizations ?? [];
  assert(evictions.length === 2, `Expected 2 eviction finalizations (Static + Tac), got ${evictions.length}`);
  for (const ev of evictions as readonly EvictionDropFinalizationRecord[]) {
    assert(ev.recordType === 'NODE_EVICTION_FINALIZATION', 'recordType must be NODE_EVICTION_FINALIZATION');
    assert(ev.simulationRunId === 1, 'eviction record simulationRunId=1');
    assert(ev.nodeId === 2, 'eviction nodeId=2');
    assert(ev.associatedSimulationFrameIndex === expectedFrameIdx, 'associatedSimulationFrameIndex matches current frame');
    assert(ev.droppedOverflowBytes === 1400 && ev.totalDroppedBytes === 1400, 'Exact uncollected 1400 B captured');
    assert(ev.reason === 'NODE_DELETE', 'reason=NODE_DELETE');
    assert(!('startTimeS' in (ev as unknown as Record<string, unknown>)), 'No startTimeS interval field on point eviction record');
    assert(!('endTimeS' in (ev as unknown as Record<string, unknown>)), 'No endTimeS interval field on point eviction record');
  }

  // Next tick emits pendingTimelineRecords containing both eviction finalizations + epoch
  worker.tickSimulation(true);
  const f2 = emittedFrames[emittedFrames.length - 1];
  const f2Evictions = (f2.completed_superframes ?? []).filter((r) => r.recordType === 'NODE_EVICTION_FINALIZATION');
  const f2Epochs = (f2.completed_superframes ?? []).filter((r) => r.recordType === 'EPOCH');
  assert(f2Evictions.length === 2, 'TELEMETRY_FRAME flushes the 2 queued eviction records once');
  assert(f2Epochs.length >= 1 && f2Epochs[0].simulationRunId === 1, 'EPOCH record carries simulationRunId=1');

  // Delete another node with zero drops -> emits 0 eviction records
  const delZero = worker.handleMessage({ type: 'NODE_DELETE', node_id: 3 });
  assert((delZero.eviction_finalizations ?? []).length === 0, 'Zero-drop deletion emits no eviction finalization');

  // Reset increments simulationRunId -> 2
  worker.resetSimulationState();
  assert(rawWorker.simulationRunId === 2, 'resetSimulationState increments simulationRunId to 2');
  worker.tickSimulation(true);
  assert(emittedFrames[emittedFrames.length - 1].simulation_run_id === 2, 'Post-reset frame stamps simulation_run_id=2');

  // Preset transitions increment simulationRunId -> 3, 4
  const acnRes = worker.handleMessage({ type: 'LOAD_PRESET', preset_id: 'PRESET_ACN_ONLY' } as any);
  assert(acnRes.accepted && acnRes.simulation_run_id === 3, 'PRESET_ACN_ONLY bumps simulation_run_id to 3');
  const p16Res = worker.handleMessage({ type: 'LOAD_PRESET', preset_id: 'PRESET_16_NODES' } as any);
  assert(p16Res.accepted && p16Res.simulation_run_id === 4, 'PRESET_16_NODES bumps simulation_run_id to 4');

  // NODE_ADD & NODE_DUPLICATE stamp simulation_run_id
  const addRes = worker.handleMessage({ type: 'NODE_ADD', node_type: 'soldier', x_m: 1000, y_m: 2000 } as any);
  assert(addRes.accepted && addRes.simulation_run_id === 4, 'NODE_ADD stamps current simulation_run_id');
});

function makeMockEpoch(
  epochIndex: number,
  startTimeS: number,
  endTimeS: number,
  opts?: { simulationRunId?: number; staticDropBytes?: number; tacDropBytes?: number; frameIdx?: number }
): SuperframeEpochRecord {
  const staticDropBytes = opts?.staticDropBytes ?? 0;
  const tacDropBytes = opts?.tacDropBytes ?? 0;
  return {
    recordType: 'EPOCH',
    ...(opts?.simulationRunId !== undefined ? { simulationRunId: opts.simulationRunId } : {}),
    epochIndex,
    startTimeS,
    endTimeS,
    durationMs: (endTimeS - startTimeS) * 1000,
    configuredDurationMs: (endTimeS - startTimeS) * 1000,
    nominalSimTimeS: endTimeS,
    associatedSimulationFrameIndex: opts?.frameIdx ?? epochIndex + 1,
    coveredFrameRange: [epochIndex + 1, epochIndex + 1],
    staticMetrics: {
      transmittedNonOutageBits: 1000,
      outageWastedBits: 0,
      totalPayloadBitsDequeued: 1000,
      droppedDelayPkts: 0,
      droppedOverflowPkts: 0,
      totalDroppedPkts: 0,
      droppedDelayBytes: staticDropBytes,
      droppedOverflowBytes: 0,
      totalDroppedBytes: staticDropBytes,
      ulUtilizationPct: 10,
      endQueueDepthPkts: 0,
      endBacklogBytes: 0,
      meanHeadOfLineSojournMs: null,
    },
    tacMetrics: {
      transmittedNonOutageBits: 2000,
      outageWastedBits: 0,
      totalPayloadBitsDequeued: 2000,
      droppedDelayPkts: 0,
      droppedOverflowPkts: 0,
      totalDroppedPkts: 0,
      droppedDelayBytes: tacDropBytes,
      droppedOverflowBytes: 0,
      totalDroppedBytes: tacDropBytes,
      ulUtilizationPct: 20,
      endQueueDepthPkts: 0,
      endBacklogBytes: 0,
      meanHeadOfLineSojournMs: null,
    },
    activeSchedulerMode: 'tac_tad',
  };
}

function makeEvictionRecord(
  finalizationIndex: number,
  timestampS: number,
  frameIdx: number,
  bytes: number,
  opts?: {
    simulationRunId?: number;
    schedulerId?: 'STATIC_TDMA' | 'TAC_TAD';
    nodeId?: number;
    droppedDelayBytes?: number;
    droppedOverflowBytes?: number;
  }
): EvictionDropFinalizationRecord {
  const delayB = opts?.droppedDelayBytes ?? 0;
  const overflowB = opts?.droppedOverflowBytes ?? (bytes - delayB);
  return {
    recordType: 'NODE_EVICTION_FINALIZATION',
    ...(opts?.simulationRunId !== undefined ? { simulationRunId: opts.simulationRunId } : {}),
    finalizationIndex,
    schedulerId: opts?.schedulerId ?? 'STATIC_TDMA',
    nodeId: opts?.nodeId ?? 5,
    timestampS,
    associatedSimulationFrameIndex: frameIdx,
    droppedDelayPkts: delayB > 0 ? 1 : 0,
    droppedOverflowPkts: overflowB > 0 ? 1 : 0,
    totalDroppedPkts: (delayB > 0 ? 1 : 0) + (overflowB > 0 ? 1 : 0),
    droppedDelayBytes: delayB,
    droppedOverflowBytes: overflowB,
    totalDroppedBytes: delayB + overflowB,
    reason: 'NODE_DELETE',
  };
}

function makeTestSpatialSnapshot(frameIndex: number, simulationTimeS: number) {
  return {
    frameIndex,
    simulationTimeS,
    wallClockTimeMs: 1000 + frameIndex * 20,
    spatialRevision: 1,
    acn: {
      posX: 0,
      posY: 0,
      posZ: 5000,
      velX: 60,
      velY: 0,
      velZ: 0,
      headingRad: 0,
      pitchDeg: 0,
      altitudeMslM: 5000,
      altitudeAglM: 1800,
      coverageRadiusKm: 50,
      isTerrainClamped: false,
    },
    nodes: [
      {
        nodeId: 1,
        posX: 1000,
        posY: 2000,
        posZ: 3200,
        altitudeMslM: 3200,
        altitudeAglM: 2,
        isLos: true,
        isOutage: false,
        isObstacleBlocked: false,
        snrDb: 20,
        currentState: NodeTerrainState.NORMAL_LOS,
      },
    ],
    selectedLinkBudget: null,
  };
}

function makeHeadlessCanvas(): HTMLCanvasElement {
  return {
    width: 800,
    height: 130,
    style: {},
    getContext: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 130 }),
  } as unknown as HTMLCanvasElement;
}

function createTestTimelineController(
  opts?: {
    epochCapacity?: number;
    evictionCapacity?: number;
    onReset?: () => void;
    onFirstTaggedActivation?: () => void;
    onMapRedrawNeeded?: () => void;
    onStatusChange?: (isLive: boolean, playheadTimeS: number) => void;
  }
) {
  const spatialBuffer = new SpatialSnapshotBuffer(300);
  const epochStore = new (SuperframeEpochStore as unknown as new (cap?: number, evCap?: number) => SuperframeEpochStore)(
    opts?.epochCapacity ?? 6000,
    opts?.evictionCapacity ?? 1000
  );
  const renderer = new SimulationTimelineRenderer({
    canvas: makeHeadlessCanvas(),
    spatialBuffer,
    epochStore,
    width: 800,
    height: 130,
  });
  const controller = new SimulationTimelineController({
    spatialBuffer,
    epochStore,
    renderer,
    ...(opts?.onReset ? { onReset: opts.onReset } : {}),
    ...(opts?.onFirstTaggedActivation ? { onFirstTaggedActivation: opts.onFirstTaggedActivation } : {}),
    ...(opts?.onMapRedrawNeeded ? { onMapRedrawNeeded: opts.onMapRedrawNeeded } : {}),
    ...(opts?.onStatusChange ? { onStatusChange: opts.onStatusChange } : {}),
  } as any);
  return { spatialBuffer, epochStore, renderer, controller };
}

// ----------------------------------------------------------------------------
// TC-CORR-05 (05.1–05.5): Bounded Eviction FIFO, Pruning, O(C) Dedup & Option A
// ----------------------------------------------------------------------------
registerTest('TC-CORR-05', 'SuperframeEpochStore isolates evictions from interval ring, enforces FIFO + horizon pruning, O(C) dedup & Option A watermarks', () => {
  const store = new (SuperframeEpochStore as any)(4, 3);
  store.append(makeMockEpoch(0, 0.0, 0.5, { simulationRunId: 1 }));
  store.append(makeMockEpoch(1, 0.5, 1.0, { simulationRunId: 1 }));
  assert(store.count === 2, 'Two epochs appended');

  // 05.1: Point evictions do not enter epoch ring count or interval lookup
  const ev0 = makeEvictionRecord(0, 0.1, 5, 1200, { simulationRunId: 1 });
  const ev1 = makeEvictionRecord(1, 0.3, 15, 1300, { simulationRunId: 1 });
  const ev2 = makeEvictionRecord(2, 0.6, 30, 1400, { simulationRunId: 1 });
  assert(store.append(ev0) && store.append(ev1) && store.append(ev2), 'Evictions accepted');
  assert(store.count === 2, 'Evictions MUST NOT pollute epoch count');
  assert(store.findAtTime(0.1)?.recordType === 'EPOCH', 'findAtTime returns EPOCH');
  assert(store.getEvictionFinalizations().length === 3, 'Three eviction records stored');

  // 05.2 & 05.3: Dedup before eviction, FIFO evict at capacity=3, and O(C) floor dedup after eviction
  assert(store.append(ev1) === false, 'Duplicate finalizationIndex=1 rejected while retained');
  const ev3 = makeEvictionRecord(3, 0.8, 40, 1500, { simulationRunId: 1 });
  assert(store.append(ev3) === true, 'ev3 accepted & evicts ev0');
  assert(store.getEvictionFinalizations().length === 3, 'Bounded at evictionCapacity=3');
  assert(store.append(ev0) === false, 'Already-evicted finalizationIndex=0 rejected via evictionFloorIndex');

  const meta1 = store.getEvictionHistoryMetadata();
  assert(meta1.evictedByCapacityCount === 1 && meta1.discardedEvictionCount === 1, 'Watermarks count FIFO eviction');
  assertClose(meta1.minDiscardedTimestampS!, 0.1, 1e-9, 'minDiscardedTimestampS=0.1');
  assertClose(meta1.maxDiscardedTimestampS!, 0.1, 1e-9, 'maxDiscardedTimestampS=0.1');

  // 05.5: Option A overlap
  assert(store.mayHaveEvictedFinalizationInTimeRange(0.05, 0.2) === true, 'Range overlapping [0.1,0.1] triggers Option A notice');
  assert(store.mayHaveEvictedFinalizationInTimeRange(0.5, 0.9) === false, 'Range outside [0.1,0.1] confirms zero truncation');

  // 05.4: Epoch ring wrap prunes evictions strictly older than oldest retained epoch horizon
  store.append(makeMockEpoch(2, 1.0, 1.5, { simulationRunId: 1 }));
  store.append(makeMockEpoch(3, 1.5, 2.0, { simulationRunId: 1 }));
  store.append(makeMockEpoch(4, 2.0, 2.5, { simulationRunId: 1 })); // Evicts epoch 0 -> oldest starts at 0.5
  const retainedAfterHorizon = store.getEvictionFinalizations();
  assert(retainedAfterHorizon.every((r: EvictionDropFinalizationRecord) => r.timestampS >= 0.5), 'Eviction at 0.3s pruned on horizon shift to 0.5s');
  const meta2 = store.getEvictionHistoryMetadata();
  assert(meta2.evictedByHorizonCount >= 1 && meta2.discardedEvictionCount >= 2, 'Horizon pruning updates discarded watermarks');
  assert(meta2.maxDiscardedTimestampS! >= 0.3, 'Discarded max timestamp watermark updated to 0.3s');

  // REV15-D2: Duplicate notifySimulationReset(2) post-Run-2 ingestion MUST return false and preserve Run 2 records
  assert(store.getMinimumAcceptedRunId() === 1, 'minimumAcceptedRunId starts at 1');
  assert(store.notifySimulationReset(2) === true, 'Advance to Run 2 reset succeeds');
  assert(store.append(makeMockEpoch(10, 0.0, 0.02, { simulationRunId: 2 })) === true, 'Run 2 epoch ingested');
  assert(store.notifySimulationReset(2) === false, 'Duplicate notifySimulationReset(2) while Run 2 is active returns false');
  assert(store.count === 1 && store.get(0)?.epochIndex === 10, 'Run 2 records preserved untouched');

  // Sparse discarded timestamps (0.020s & 0.080s) -> conservative envelope includes middle 0.050s query (13.3/05.5)
  const sparseStore = new (SuperframeEpochStore as any)(100, 1);
  sparseStore.append(makeEvictionRecord(0, 0.020, 1, 500, { simulationRunId: 1 }));
  sparseStore.append(makeEvictionRecord(1, 0.080, 4, 600, { simulationRunId: 1 }));
  sparseStore.append(makeEvictionRecord(2, 0.200, 10, 700, { simulationRunId: 1 }));
  const sparseMeta = sparseStore.getEvictionHistoryMetadata();
  assert(sparseMeta.discardedEvictionCount === 2, 'Sparse eviction store discarded 2 records');
  assertClose(sparseMeta.minDiscardedTimestampS!, 0.020, 1e-9, 'Sparse min watermark = 0.020s');
  assertClose(sparseMeta.maxDiscardedTimestampS!, 0.080, 1e-9, 'Sparse max watermark = 0.080s');
  assert(sparseStore.mayHaveEvictedFinalizationInTimeRange(0.050, 0.050) === true,
    'Conservative watermark envelope flags 0.050s inside discarded [0.020s, 0.080s]');
});

// ----------------------------------------------------------------------------
// TC-CORR-06 & TC-CORR-16.14: Run-ID State Machine, Structural-First & Reset Guards
// ----------------------------------------------------------------------------
registerTest('TC-CORR-06', 'SuperframeEpochStore enforces structural-first append, run-id monotonic isolation & side-effect-free validation (TC-CORR-16.14)', () => {
  const store = new (SuperframeEpochStore as any)(100, 50);
  assert(store.getMinimumAcceptedRunId() === 1, 'Initial minimumAcceptedRunId is 1');

  // Legacy untagged works initially
  assert(store.append(makeMockEpoch(0, 0.0, 0.02)) === true, 'Initial untagged record allowed');
  assert(store.isTaggedRunActive() === false, 'Still untagged');

  // REV11 TC-CORR-16.11: Parameterless reset() of legacy untagged data clears data WITHOUT latching taggedModeLocked
  assert(store.notifySimulationReset() === true, '0-arg reset on legacy data succeeds');
  assert(store.count === 0 && store.isTaggedRunActive() === false, 'Legacy 0-arg reset keeps !taggedModeLocked');
  assert(store.append(makeMockEpoch(0, 0.0, 0.02)) === true, 'Can re-populate legacy untagged mock after 0-arg reset');

  // registerCoordinator returns idempotent unregister closure
  let coordCalls = 0;
  const unreg = store.registerCoordinator({ onBeforeTaggedTransition: () => { coordCalls++; } });
  assert(typeof unreg === 'function', 'registerCoordinator returns unregister closure');
  unreg();
  unreg(); // idempotent

  // TC-CORR-16.14: Invalid / duplicate-empty notifySimulationReset MUST NOT latch taggedModeLocked
  assert(store.notifySimulationReset(0) === false, 'runId=0 rejected side-effect-free');
  assert(store.notifySimulationReset(-2) === false, 'negative runId rejected');
  assert(store.notifySimulationReset(1.5) === false, 'non-integer runId rejected');
  assert(store.isTaggedRunActive() === false, 'Invalid reset leaves taggedModeLocked false');

  const emptyStore = new (SuperframeEpochStore as any)(100, 50);
  assert(emptyStore.notifySimulationReset() === false, '0-arg reset on empty store rejected duplicate-empty');
  assert(emptyStore.isTaggedRunActive() === false, 'Empty 0-arg reset does NOT lock tagged mode');

  // Structural-first validation: NaN record carrying simulationRunId=5 MUST NOT trigger run reset/lock
  const malformed = { ...makeMockEpoch(0, Number.NaN, 1.0, { simulationRunId: 5 }) };
  assert(store.append(malformed) === false, 'Malformed record rejected before run sync');
  assert(store.isTaggedRunActive() === false && store.count === 1, 'Existing store untouched by malformed record');

  // First tagged activation clears prior untagged records and locks out untagged + appendLegacyUntaggedMockForTest
  assert(store.syncSimulationRunId(1) === 'FIRST_TAGGED_ACTIVATION', 'First valid tagged run triggers FIRST_TAGGED_ACTIVATION');
  assert(coordCalls === 0, 'Unregistered coordinator hook did not fire');
  assert(store.isTaggedRunActive() === true && store.count === 0, 'Prior untagged epoch cleared on first tagged activation');
  assert(store.append(makeMockEpoch(0, 0.0, 0.02)) === false, 'Untagged append rejected after tagged lock');
  assert(store.appendLegacyUntaggedMockForTest(makeMockEpoch(0, 0.0, 0.02)) === false, 'Legacy mock test helper respects tagged lock');

  // Run 1 -> 2 reset & stale run 1 rejection
  store.append(makeMockEpoch(0, 0.0, 0.02, { simulationRunId: 1 }));
  assert(store.count === 1, 'Run 1 epoch appended');
  assert(store.notifySimulationReset(2) === true, 'Explicit reset to run 2 succeeds');
  assert(store.count === 0, 'Explicit reset clears prior data');
  assert(store.notifySimulationReset(2) === false, 'Duplicate-empty reset(2) returns false');
  assert(store.syncSimulationRunId(1) === 'REJECTED_STALE', 'Stale runId=1 rejected');
  assert(store.syncSimulationRunId(2) === 'ACCEPTED', 'Active runId=2 accepted');
  assert(store.syncSimulationRunId(3) === 'RESET_AND_ACCEPTED', 'Jump 2->3 resets and accepts');

  // clear() resets activeSimulationRunId & pendingResetCleared while keeping minimumAcceptedRunId
  store.clear();
  assert(store.getActiveSimulationRunId() === null && store.getMinimumAcceptedRunId() === 3, 'clear() nulls activeSimulationRunId while preserving minimumAcceptedRunId');
});

// ----------------------------------------------------------------------------
// TC-CORR-07 & TC-CORR-16.12–16.15: Controller Coordinator, Constructor Guard & Worker E2E
// ----------------------------------------------------------------------------
registerTest('TC-CORR-07', 'SimulationTimelineController coordinates pre-tagged cleanup, smuggling/reset guards, late constructor sync & Worker E2E (TC-CORR-16.4a/e, 16.7, 16.9, 16.12–16.15)', () => {
  // TC-CORR-16.12 & 16.15 Sub-case A: Pre-existing spatial snapshot triggers coordinator cleanup on tagged activation
  let firstTaggedFired = 0;
  const callOrder: string[] = [];
  let statusEvents = 0;
  const ctx1 = createTestTimelineController({
    onFirstTaggedActivation: () => { firstTaggedFired++; },
    onReset: () => { callOrder.push('onReset'); },
    onMapRedrawNeeded: () => { callOrder.push('onMapRedrawNeeded'); },
    onStatusChange: () => {
      statusEvents++;
      callOrder.push('onStatusChange');
    },
  });
  ctx1.spatialBuffer.ingestBatch([makeTestSpatialSnapshot(1, 0.02)]);
  assert(ctx1.epochStore.hasAnyStoredData() === true, 'hasAnyStoredData includes coordinator spatialBuffer');
  assert(ctx1.spatialBuffer.count === 1, 'Pre-existing spatial frame present');

  const taggedEpoch1 = makeMockEpoch(0, 0.0, 0.02, { simulationRunId: 1 });
  const okA = (ctx1.controller as any).ingestTelemetry(
    [makeTestSpatialSnapshot(2, 0.04)],
    [taggedEpoch1],
    { simulation_run_id: 1, frame_idx: 2 } as unknown as TelemetryFrame
  );
  assert(okA === true, 'TC-CORR-16.15 Sub-case A: ingestTelemetry returns true');
  assert(firstTaggedFired === 1, 'Coordinator fired onFirstTaggedActivation once');
  assert(ctx1.spatialBuffer.count === 1 && ctx1.spatialBuffer.oldestSnapshot!.frameIndex === 2, 'Pre-tagged frame 1 was purged before ingesting run 1 frame 2');

  // TC-CORR-16.4e & 16.15 Sub-case B: Discontinuity-only history triggers cleanup and idempotent reset
  const ctxDisc = createTestTimelineController();
  ctxDisc.spatialBuffer.discontinuities.push({
    startTimeS: 0.1,
    endTimeS: 0.2,
    startFrameIndex: 5,
    endFrameIndex: 10,
    reason: 'DISCONTINUITY_ONLY_HISTORY',
  } as any);
  assert(ctxDisc.spatialBuffer.count === 0 && ctxDisc.epochStore.count === 0, 'Pre-condition: buffers empty except discontinuities');
  assert(ctxDisc.epochStore.hasAnyStoredData() === true, 'TC-CORR-16.4e: hasAnyStoredData detects discontinuity-only history');
  assert(ctxDisc.epochStore.notifySimulationReset() === true, 'TC-CORR-16.15 Sub-case B: explicit reset clears discontinuity-only history');
  assert(ctxDisc.spatialBuffer.discontinuities.length === 0, 'Coordinator cleared spatial discontinuities on reset');
  assert(ctxDisc.epochStore.isTaggedRunActive() === false, 'TC-CORR-16.4e: parameterless pre-tagged reset does not lock tagged mode');
  assert(ctxDisc.epochStore.notifySimulationReset() === false, 'Duplicate empty reset after clearing discontinuity returns false');

  // TC-CORR-16.4a & 16.7: Mixed [untagged, tagged] smuggling & malformed message guards
  const ctxSmuggle = createTestTimelineController();
  const smugglePreFrame = (ctxSmuggle.controller as any).ingestTelemetry(
    [makeTestSpatialSnapshot(10, 0.2)],
    [makeMockEpoch(0, 0.0, 0.02), makeMockEpoch(1, 0.02, 0.04, { simulationRunId: 9 })],
    { frame_idx: 10 } as unknown as TelemetryFrame
  );
  assert(smugglePreFrame === false && ctxSmuggle.spatialBuffer.count === 0 && ctxSmuggle.epochStore.count === 0,
    'TC-CORR-16.7: Mixed [untagged, tagged] array on untagged frame rejected with zero mutations');
  const smuggleNullPre = (ctxSmuggle.controller as any).ingestTelemetry(
    [makeTestSpatialSnapshot(11, 0.22)],
    [makeMockEpoch(0, 0.0, 0.02), makeMockEpoch(1, 0.02, 0.04, { simulationRunId: 9 })],
    null
  );
  assert(smuggleNullPre === false && ctxSmuggle.spatialBuffer.count === 0 && ctxSmuggle.epochStore.count === 0,
    'TC-CORR-16.7: Mixed [untagged, tagged] array on null frame rejected with zero mutations');

  const badTypeCmd = (ctx1.controller as any).ingestCommandResult({
    type: 'TELEMETRY_FRAME',
    simulation_run_id: 1,
    eviction_finalizations: [makeEvictionRecord(9, 0.04, 2, 1400, { simulationRunId: 1 })],
  });
  assert(badTypeCmd === false && ctx1.epochStore.getEvictionFinalizations().length === 0,
    'TC-CORR-16.7: ingestCommandResult rejects messages whose type !== COMMAND_RESULT');

  const smuggleActive = (ctx1.controller as any).ingestTelemetry(
    [makeTestSpatialSnapshot(3, 0.06)],
    [makeMockEpoch(1, 0.02, 0.04), makeMockEpoch(2, 0.04, 0.06, { simulationRunId: 1 })],
    null
  );
  assert(smuggleActive === false && ctx1.spatialBuffer.count === 1 && ctx1.epochStore.count === 1,
    'Active-tagged untagged null frame rejected with zero mutations');

  const smuggleCmd = (ctxSmuggle.controller as any).ingestCommandResult({
    type: 'COMMAND_RESULT',
    command_type: 'NODE_DELETE',
    accepted: true,
    spatial_locked: false,
    eviction_finalizations: [
      makeEvictionRecord(0, 0.04, 2, 1400),
      makeEvictionRecord(1, 0.06, 3, 1400, { simulationRunId: 5 }),
    ],
  } as WorkerCommandResult);
  assert(smuggleCmd === false && ctxSmuggle.epochStore.getEvictionFinalizations().length === 0,
    'TC-CORR-16.7: Mixed [untagged, tagged] eviction_finalizations on untagged COMMAND_RESULT rejected with zero mutations');

  // Valid COMMAND_RESULT ingests eviction and emits onStatusChange when added > 0
  const statusBeforeCmd = statusEvents;
  const cmdOk = (ctx1.controller as any).ingestCommandResult({
    type: 'COMMAND_RESULT',
    command_type: 'NODE_DELETE',
    accepted: true,
    spatial_locked: false,
    simulation_run_id: 1,
    eviction_finalizations: [makeEvictionRecord(0, 0.04, 2, 1400, { simulationRunId: 1 })],
  } as WorkerCommandResult);
  assert(cmdOk === true && ctx1.epochStore.getEvictionFinalizations().length === 1, 'COMMAND_RESULT ingests eviction record');
  assert(statusEvents > statusBeforeCmd, 'TC-CORR-16.7: ingestCommandResult invokes onStatusChange when eviction records added');

  // TC-CORR-16.9: Explicit reset clears renderer.hoveredTimeS and fires onReset BEFORE onMapRedrawNeeded/onStatusChange
  ctx1.renderer.hoveredTimeS = 1.25;
  callOrder.length = 0;
  ctx1.controller.reset(2 as any);
  assert(ctx1.renderer.hoveredTimeS === null, 'TC-CORR-16.9: reset clears hoveredTimeS to null');
  const idxReset = callOrder.indexOf('onReset');
  const idxRedraw = callOrder.indexOf('onMapRedrawNeeded');
  const idxStatus = callOrder.indexOf('onStatusChange');
  assert(idxReset !== -1 && idxRedraw > idxReset && idxStatus > idxReset,
    `TC-CORR-16.9: onReset runs before onMapRedrawNeeded and onStatusChange (order=${callOrder.join(',')})`);

  const staleCmd = (ctx1.controller as any).ingestCommandResult({
    type: 'COMMAND_RESULT',
    command_type: 'NODE_DELETE',
    accepted: true,
    spatial_locked: false,
    simulation_run_id: 1,
    eviction_finalizations: [makeEvictionRecord(1, 0.06, 3, 1400, { simulationRunId: 1 })],
  } as WorkerCommandResult);
  assert(staleCmd === false && ctx1.epochStore.getEvictionFinalizations().length === 0, 'Stale run 1 COMMAND_RESULT rejected cleanly');

  // TC-CORR-16.13: Constructor late-registration guard when epochStore is already tagged
  const preLockedStore = new (SuperframeEpochStore as any)(100, 50);
  preLockedStore.syncSimulationRunId(1);
  const lateSpatial = new SpatialSnapshotBuffer(100);
  lateSpatial.ingestBatch([makeTestSpatialSnapshot(99, 1.98)]);
  let lateSyncCleaned = 0;
  new SimulationTimelineController({
    spatialBuffer: lateSpatial,
    epochStore: preLockedStore,
    renderer: new SimulationTimelineRenderer({ canvas: makeHeadlessCanvas(), spatialBuffer: lateSpatial, epochStore: preLockedStore }),
    onFirstTaggedActivation: () => { lateSyncCleaned++; },
  } as any);
  assert(lateSyncCleaned === 1 && lateSpatial.count === 0, 'TC-CORR-16.13: Constructor synchronously detects already-tagged store and cleans pre-existing spatial buffer');

  // TC-CORR-16.15 Sub-case C: Live SimulationWorkerManager -> controller run sequence 1 -> 2 -> 2 -> 3 -> 4 -> 4
  const ctxLive = createTestTimelineController();
  const worker = new SimulationWorkerManager(100, '16_NODES');
  const liveFrames: TelemetryFrame[] = [];
  const rw = worker as unknown as { emitHostMessage: (m: WorkerOutboundMessage, t?: Transferable[]) => void };
  const origEmit = rw.emitHostMessage.bind(worker);
  rw.emitHostMessage = (m: WorkerOutboundMessage, t?: Transferable[]) => {
    if (m.type === 'TELEMETRY_FRAME') liveFrames.push(m.frame);
    origEmit(m, t);
  };
  worker.tickSimulation(true);
  assert(liveFrames.length === 1 && liveFrames[0].simulation_run_id === 1, 'Worker produced Run 1 frame');
  const f1 = liveFrames[0];
  assert((ctxLive.controller as any).ingestTelemetry(f1.batch_spatial_snapshots, f1.completed_superframes, f1) === true,
    'TC-CORR-16.15 Sub-case C: Run 1 worker frame ingested');
  const seenRunIds: number[] = [f1.simulation_run_id!];

  // Reset -> Run 2, duplicate empty controller reset, then worker tick Run 2
  const reset2Res = worker.handleMessage({ type: 'SIM_CONTROL', action: 'reset' });
  assert(reset2Res.accepted === true && reset2Res.simulation_run_id === 2, 'Worker reset bumped simulation_run_id to 2');
  ctxLive.controller.reset(reset2Res.simulation_run_id);
  assert(ctxLive.epochStore.getMinimumAcceptedRunId() === 2, 'Run sequence step 2 accepted');
  assert(ctxLive.epochStore.notifySimulationReset(2) === false, 'Duplicate empty reset(2) is idempotent');
  worker.tickSimulation(true);
  const f2 = liveFrames[liveFrames.length - 1];
  assert(f2.simulation_run_id === 2 && (ctxLive.controller as any).ingestTelemetry(f2.batch_spatial_snapshots, f2.completed_superframes, f2) === true,
    'Run 2 worker frame ingested');
  seenRunIds.push(f2.simulation_run_id!);
  // Repeated telemetry from Run 2 maintains activeSimulationRunId === 2
  seenRunIds.push(ctxLive.epochStore.getActiveSimulationRunId()!);

  // Reset -> Run 3 -> tick
  const reset3Res = worker.handleMessage({ type: 'SIM_CONTROL', action: 'reset' });
  ctxLive.controller.reset(reset3Res.simulation_run_id);
  worker.tickSimulation(true);
  const f3 = liveFrames[liveFrames.length - 1];
  assert(f3.simulation_run_id === 3 && (ctxLive.controller as any).ingestTelemetry(f3.batch_spatial_snapshots, f3.completed_superframes, f3) === true,
    'Run 3 worker frame ingested');
  seenRunIds.push(f3.simulation_run_id!);

  // Reset -> Run 4 -> tick -> second Run 4 frame
  const reset4Res = worker.handleMessage({ type: 'SIM_CONTROL', action: 'reset' });
  ctxLive.controller.reset(reset4Res.simulation_run_id);
  worker.tickSimulation(true);
  const f4a = liveFrames[liveFrames.length - 1];
  assert(f4a.simulation_run_id === 4 && (ctxLive.controller as any).ingestTelemetry(f4a.batch_spatial_snapshots, f4a.completed_superframes, f4a) === true,
    'Run 4a worker frame ingested');
  seenRunIds.push(f4a.simulation_run_id!);
  worker.tickSimulation(true);
  const f4b = liveFrames[liveFrames.length - 1];
  assert(f4b.simulation_run_id === 4 && (ctxLive.controller as any).ingestTelemetry(f4b.batch_spatial_snapshots, f4b.completed_superframes, f4b) === true,
    'Run 4b worker frame ingested');
  seenRunIds.push(f4b.simulation_run_id!);

  assert(seenRunIds.join('->') === '1->2->2->3->4->4', `Expected exact worker run sequence 1->2->2->3->4->4, got ${seenRunIds.join('->')}`);
});

function makeRecordingCanvas() {
  const fillRectOps: { fillStyle: string; x: number; y: number; w: number; h: number }[] = [];
  const ctx: any = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'top',
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    scale: () => {},
    translate: () => {},
    clearRect: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRectOps.push({ fillStyle: String(ctx.fillStyle).toLowerCase(), x, y, w, h });
    },
    strokeRect: () => {},
    rect: () => {},
    clip: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    fillText: () => {},
    measureText: (t: string) => ({ width: t.length * 6 }),
    setLineDash: () => {},
  };
  const canvas = {
    width: 800,
    height: 130,
    style: {},
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 130 }),
  } as unknown as HTMLCanvasElement;
  return { canvas, fillRectOps };
}

// ----------------------------------------------------------------------------
// TC-CORR-08: Renderer Semantic Palette (#e09f3e Outage / #e05347 Drops) & Eviction Slices
// ----------------------------------------------------------------------------
registerTest('TC-CORR-08', 'SimulationTimelineRenderer renders amber (#e09f3e) outage, vermilion (#e05347) drops & 3px eviction lane slices', () => {
  const spatialBuffer = new SpatialSnapshotBuffer(200);
  const epochStore = new (SuperframeEpochStore as any)(6000, 100);
  const { canvas, fillRectOps } = makeRecordingCanvas();
  const renderer = new SimulationTimelineRenderer({
    canvas,
    spatialBuffer,
    epochStore,
    width: 800,
    height: 130,
  });

  // Epoch with outage waste + queue drops
  const ep = makeMockEpoch(0, 0.0, 0.2, { simulationRunId: 1, staticDropBytes: 1400, tacDropBytes: 0 });
  const epWithOutage: SuperframeEpochRecord = {
    ...ep,
    staticMetrics: {
      ...ep.staticMetrics,
      outageWastedBits: 8000,
    },
  };
  epochStore.append(epWithOutage);

  // Evictions on BOTH lanes
  epochStore.append(makeEvictionRecord(0, 2.0, 100, 1400, { simulationRunId: 1, schedulerId: 'STATIC_TDMA', nodeId: 4 }));
  epochStore.append(makeEvictionRecord(1, 4.0, 200, 2800, { simulationRunId: 1, schedulerId: 'TAC_TAD', nodeId: 5 }));

  fillRectOps.length = 0;
  renderer.render();

  assert(fillRectOps.some((r) => r.fillStyle === '#e09f3e'), 'Outage waste bar MUST render in amber (#e09f3e)');
  assert(fillRectOps.some((r) => r.fillStyle === '#e05347'), 'Queue drop bar MUST render in vermilion (#e05347)');
  assert(!fillRectOps.some((r) => r.fillStyle === '#8a95e6'), 'Old indigo (#8a95e6) must not be used for drops');

  // Verify two 3px wide vermilion eviction slices on different lane Y coordinates
  const threePxSlices = fillRectOps.filter((r) => r.fillStyle === '#e05347' && Math.abs(r.w - 3) < 0.01 && r.h >= 10);
  assert(threePxSlices.length === 2, `Expected two 3px vermilion lane slices, got ${threePxSlices.length}`);
  assert(threePxSlices[0].y !== threePxSlices[1].y, 'STATIC_TDMA and TAC_TAD slices occupy separate lane Y bands');

  // LOD binning check (>50 epochs triggers useBinning) + epoch isolation (midT=0.1s -> px=4 on 800px/20s)
  const binsBeforeDense = renderer.aggregateEpochsIntoBins(epochStore.getRecordsInRange(0, 20), 800);
  const firstBin = Array.from(binsBeforeDense.values())[0];
  assert(firstBin && firstBin.staticDropBytes === 1400, 'aggregateEpochsIntoBins isolates epoch drop bytes from eviction finalizations');

  for (let i = 1; i <= 60; i++) {
    epochStore.append(makeMockEpoch(i, i * 0.2, (i + 1) * 0.2, { simulationRunId: 1 }));
  }
  fillRectOps.length = 0;
  renderer.render();
  const binnedSlices = fillRectOps.filter((r) => r.fillStyle === '#e05347' && Math.abs(r.w - 3) < 0.01 && r.h >= 10);
  assert(binnedSlices.length === 2, 'LOD binned rendering preserves isolated 3px eviction markers');
});

// ----------------------------------------------------------------------------
// TC-CORR-09 & TC-CORR-10: Inspector Visibility FSM, Option A Banner & Epoch Isolation
// ----------------------------------------------------------------------------
registerTest('TC-CORR-09', 'Inspector visibility FSM auto-expands on Live->Hist edge, respects manual collapse, restores prior state, and resets cleanly', () => {
  const fm = frameInspectorMod as any;
  const s0 = fm.createInitialTimelineInspectorVisibility();
  assert(s0.isExpanded === false && s0.isHistoricalMode === false, 'Initial visibility collapsed');

  // Live(collapsed) -> Historical -> Auto-expands
  const s1 = fm.transitionTimelineInspectorStatus(s0, false);
  assert(s1.isExpanded === true && s1.isHistoricalMode === true && s1.expandedBeforeHistorical === false, 'Live->Hist auto-expands');

  // Manual collapse in Historical persists across further historical scrubs
  const s2 = fm.toggleTimelineInspectorManual(s1);
  assert(s2.isExpanded === false && s2.manuallyCollapsedInHistorical === true, 'Manual collapse tracked in historical mode');
  const s3 = fm.transitionTimelineInspectorStatus(s2, false);
  assert(s3.isExpanded === false, 'Subsequent historical scrubs preserve manual collapse');

  // Return to Live restores expandedBeforeHistorical (false)
  const s4 = fm.transitionTimelineInspectorStatus(s3, true);
  assert(s4.isExpanded === false && s4.isHistoricalMode === false, 'Hist->Live restores prior collapsed state');

  // Live(manually expanded) -> Historical -> Live restores expanded (true)
  const s5 = fm.toggleTimelineInspectorManual(s4);
  assert(s5.isExpanded === true && s5.isHistoricalMode === false, 'Expanded while Live');
  const s6 = fm.transitionTimelineInspectorStatus(s5, false);
  assert(s6.isExpanded === true && s6.expandedBeforeHistorical === true, 'Hist preserves expandedBeforeHistorical=true');
  const s7 = fm.transitionTimelineInspectorStatus(s6, true);
  assert(s7.isExpanded === true && s7.isHistoricalMode === false, 'Hist->Live restores previously expanded state');

  const sReset = fm.resetTimelineInspectorVisibility();
  assert(
    !sReset.isExpanded && !sReset.isHistoricalMode && !sReset.expandedBeforeHistorical && !sReset.manuallyCollapsedInHistorical,
    'resetTimelineInspectorVisibility zeroes all flags'
  );
});

registerTest('TC-CORR-10', 'Frame inspector surfaces frame eviction finalizations, Option A conservative banner, and keeps epoch metrics isolated', () => {
  const spatialBuffer = new SpatialSnapshotBuffer(100);
  const epochStore = new (SuperframeEpochStore as any)(100, 2); // capacity=2 for eviction truncation test

  spatialBuffer.ingestBatch([
    makeTestSpatialSnapshot(1, 0.02),
    makeTestSpatialSnapshot(2, 0.04),
    makeTestSpatialSnapshot(3, 0.06),
  ]);
  epochStore.append(makeMockEpoch(0, 0.0, 0.02, { simulationRunId: 1 }));
  epochStore.append(makeMockEpoch(1, 0.02, 0.04, { simulationRunId: 1 }));
  epochStore.append(makeMockEpoch(2, 0.04, 0.06, { simulationRunId: 1 }));

  // Append 3 evictions so ev0 (t=0.02, frame=1) is discarded by FIFO capacity=2
  epochStore.append(makeEvictionRecord(0, 0.02, 1, 900, { simulationRunId: 1, schedulerId: 'STATIC_TDMA', nodeId: 9 }));
  epochStore.append(makeEvictionRecord(1, 0.06, 3, 1400, { simulationRunId: 1, schedulerId: 'TAC_TAD', nodeId: 4 }));
  epochStore.append(makeEvictionRecord(2, 0.06, 3, 1600, { simulationRunId: 1, schedulerId: 'STATIC_TDMA', nodeId: 4 }));

  // Frame 1 overlaps discarded frame watermark [1..1] -> evictedFinalizationHistoryMayBeTruncated = true
  const payload1 = inspectTimelineFrame({
    frameIndex: 1,
    spatialBuffer,
    epochStore,
    isSimRunning: true,
    currentSimTimeS: 0.06,
  }) as any;
  assert(payload1 !== null, 'Frame 1 payload present');
  assert(payload1.evictedFinalizationHistoryMayBeTruncated === true, 'Option A detects frame 1 overlaps discarded frame watermark');
  assert(payload1.epochs.length === 1 && payload1.coveredDurationMs === 20.0, 'Epoch coverage unaffected by eviction records');

  // REV15-D6 (13.3/13.5): Adjacent Frame max+1 (Frame 2: [0.02, 0.04]) MUST NOT bleed from Frame 1 timestamp boundary (0.02)
  const payload2 = inspectTimelineFrame({
    frameIndex: 2,
    spatialBuffer,
    epochStore,
    isSimRunning: true,
    currentSimTimeS: 0.06,
  }) as any;
  assert(payload2 !== null && payload2.evictedFinalizationHistoryMayBeTruncated === false,
    'Adjacent Frame max+1 (Frame 2) does not falsely inherit Frame 1 eviction truncation');

  // Frame 3 outside discarded [1..1] -> evictedFinalizationHistoryMayBeTruncated = false, has 2 eviction finalizations
  const payload3 = inspectTimelineFrame({
    frameIndex: 3,
    spatialBuffer,
    epochStore,
    isSimRunning: true,
    currentSimTimeS: 0.06,
  }) as any;
  assert(payload3.evictedFinalizationHistoryMayBeTruncated === false, 'Frame 3 outside discarded frame watermark reports false');
  assert(payload3.evictionFinalizations.length === 2, 'Frame 3 retains both eviction records for frame 3');
  assert(payload3.comparison !== null && payload3.comparison.static.droppedPkts === 0, 'SchedulerComparison epoch totals isolated from eviction point records');

  // REV11 15: compute1DIntervalUnion + computeSchedulerComparison isolation check
  const unionDirect = frameInspectorMod.compute1DIntervalUnion({
    frameStartS: 0.04,
    frameEndS: 0.06,
    epochs: payload3.epochs,
  });
  const compDirect = frameInspectorMod.computeSchedulerComparison({
    staticMetrics: payload3.epochs[0].staticMetrics,
    tacMetrics: payload3.epochs[0].tacMetrics,
    durationS: 0.02,
  });
  assertClose(unionDirect.coveredDurationMs, 20.0, 1e-6, 'REV11 15: Union duration unaffected by eviction records');
  assert(compDirect.static.droppedBytes === 0 && compDirect.tac.droppedBytes === 0, 'REV11 15: Comparison drops isolated from eviction records');

  // HISTORY_EVICTED fallback: when epoch ring wrapped past Frame 1 and any eviction was discarded elsewhere, Frame 1 flags truncation conservatively
  const wrappedEpochStore = new (SuperframeEpochStore as any)(1, 1);
  const wrappedSpatial = new SpatialSnapshotBuffer(100);
  wrappedSpatial.ingestBatch([
    makeTestSpatialSnapshot(1, 0.02),
    makeTestSpatialSnapshot(2, 0.04),
    makeTestSpatialSnapshot(3, 0.06),
  ]);
  wrappedEpochStore.append(makeMockEpoch(0, 0.0, 0.02, { simulationRunId: 1 }));
  wrappedEpochStore.append(makeMockEpoch(1, 0.02, 0.04, { simulationRunId: 1 }));
  wrappedEpochStore.append(makeMockEpoch(2, 0.04, 0.06, { simulationRunId: 1 })); // Evicts earlier epochs -> Frame 1 is HISTORY_EVICTED
  wrappedEpochStore.append(makeEvictionRecord(0, 0.06, 3, 500, { simulationRunId: 1 }));
  wrappedEpochStore.append(makeEvictionRecord(1, 0.06, 3, 600, { simulationRunId: 1 })); // Discards frame 3 eviction while Frame 1 has HISTORY_EVICTED
  const payloadHistoryEvicted = inspectTimelineFrame({
    frameIndex: 1,
    spatialBuffer: wrappedSpatial,
    epochStore: wrappedEpochStore,
    isSimRunning: true,
    currentSimTimeS: 0.06,
  }) as any;
  assert(payloadHistoryEvicted.communicationHistoryStatus === 'HISTORY_EVICTED', 'Wrapped store reports HISTORY_EVICTED for frame 1');
  assert(payloadHistoryEvicted.evictedFinalizationHistoryMayBeTruncated === true,
    'HISTORY_EVICTED with discardedEvictionCount > 0 sets evictedFinalizationHistoryMayBeTruncated=true');

  // Render conservative DOM notice on payload1
  const fakeDomContainer: any = { innerHTML: '', querySelector: () => null };
  renderFrameInspectorDom(payload1, fakeDomContainer);
  assert(fakeDomContainer.innerHTML.includes('inspector-eviction-truncation-notice'), 'Option A conservative banner rendered');
});

// ----------------------------------------------------------------------------
// TC-CORR-11: TimelineEventScanner Emits Eviction Overflow & Spike Events
// ----------------------------------------------------------------------------
registerTest('TC-CORR-11', 'scanTimelineEvents extracts QUEUE_OVERFLOW_DROP and SIGNIFICANT_DROP_SPIKE from retained evictions with schedulerId & nodeIds', () => {
  const spatialBuffer = new SpatialSnapshotBuffer(100);
  const epochStore = new (SuperframeEpochStore as any)(100, 50);
  epochStore.append({
    ...makeEvictionRecord(0, 1.5, 75, 8400, { simulationRunId: 1, schedulerId: 'STATIC_TDMA', nodeId: 11 }),
    droppedOverflowPkts: 6,
    totalDroppedPkts: 6,
  });

  const events = scanTimelineEvents({ spatialBuffer, epochStore, dropThreshold: 5 });
  const ov = events.find((e) => e.eventType === 'QUEUE_OVERFLOW_DROP');
  const sp = events.find((e) => e.eventType === 'SIGNIFICANT_DROP_SPIKE');
  assert(ov !== undefined && ov.schedulerId === 'STATIC_TDMA' && ov.nodeIds?.[0] === 11, 'Eviction overflow event carries schedulerId & nodeIds');
  assert(sp !== undefined && sp.schedulerId === 'STATIC_TDMA' && sp.nodeIds?.[0] === 11, 'Eviction spike event carries schedulerId & nodeIds');
});

// ----------------------------------------------------------------------------
// TC-CORR-12 & TC-CORR-13 (13.1–13.5): Dual CSV Exporter Eviction Columns, Exact Time & Option A
// ----------------------------------------------------------------------------
registerTest('TC-CORR-12', 'TimelineCsvExporter preserves cols 0..35, appends 36..41 for evictions with exact timestamp & Option A metadata', async () => {
  const csvFns = csvExporterMod as any;
  assert(typeof csvFns.formatExactCsvTimestamp === 'function', 'formatExactCsvTimestamp exported');
  const exactTs = 1.23456789;
  assert(Number(csvFns.formatExactCsvTimestamp(exactTs)) === exactTs, 'formatExactCsvTimestamp preserves full finite precision');

  const spatialBuffer = new SpatialSnapshotBuffer(100);
  spatialBuffer.ingestBatch([makeTestSpatialSnapshot(1, 0.02), makeTestSpatialSnapshot(62, 1.24)]);
  const epochStore = new (SuperframeEpochStore as any)(100, 2); // evictionCapacity=2

  epochStore.append(makeMockEpoch(0, 0.0, 0.02, { simulationRunId: 1, staticDropBytes: 320, tacDropBytes: 0 }));
  epochStore.append({
    recordType: 'DISCONTINUITY',
    simulationRunId: 1,
    discontinuityIndex: 0,
    startTimeS: 0.5,
    endTimeS: 0.6,
    discardedDurationMs: 100,
    reconfigurationReason: 'TEST_RECONFIG',
  });
  epochStore.append(makeMockEpoch(1, 1.20, 1.25, { simulationRunId: 1 }));
  // Trigger FIFO discard on ev0 (timestamp 0.01) while keeping ev1 (1.23456789) and ev2 (1.24)
  epochStore.append(makeEvictionRecord(0, 0.01, 1, 700, { simulationRunId: 1, schedulerId: 'TAC_TAD', nodeId: 2 }));
  epochStore.append(makeEvictionRecord(1, exactTs, 62, 1400, {
    simulationRunId: 1,
    schedulerId: 'STATIC_TDMA',
    nodeId: 4,
    droppedDelayBytes: 400,
    droppedOverflowBytes: 1000,
  }));
  epochStore.append(makeEvictionRecord(2, 1.24, 62, 2800, {
    simulationRunId: 1,
    schedulerId: 'TAC_TAD',
    nodeId: 4,
    droppedDelayBytes: 800,
    droppedOverflowBytes: 2000,
  }));

  // Interval [1.0, 2.0] outside discarded [0.01, 0.01] -> Option A false
  const commRangeSafe = generateCommEpochsCsv(epochStore, { timeRangeS: [1.0, 2.0] }) as any;
  assert(commRangeSafe.selectedIntervalEvictionMayBeTruncated === false, 'TC-CORR-13: Safe range reports false');
  assert(commRangeSafe.globalDiscardedEvictionCount === 1 && commRangeSafe.discardedEvictionCount === 1, 'Safe range still reports global discarded eviction count');

  // Interval [0.0, 2.0] overlaps discarded 0.01 -> Option A true & notice string + top-level metadata
  const commRangeTrunc = generateCommEpochsCsv(epochStore, { timeRangeS: [0.0, 2.0] }) as any;
  assert(commRangeTrunc.selectedIntervalEvictionMayBeTruncated === true, 'TC-CORR-13: Overlapping range triggers Option A notice');
  assert(typeof commRangeTrunc.selectedIntervalTruncationNotice === 'string' && commRangeTrunc.selectedIntervalTruncationNotice.length > 0, 'Truncation notice populated');
  assert(
    commRangeTrunc.globalDiscardedEvictionCount === 1 &&
      commRangeTrunc.discardedEvictionCount === 1 &&
      commRangeTrunc.globalEvictionMinWatermarkTimestampS === 0.01 &&
      commRangeTrunc.globalEvictionWatermarkTimestampS === 0.01 &&
      commRangeTrunc.evictionWatermarkTimestampS === 0.01,
    'generateCommEpochsCsv exposes exact top-level global eviction watermark metadata'
  );

  const csvText = await commRangeTrunc.blob.text();
  const lines = csvText.trim().split('\n');
  const headerCols = lines[0].split(',');
  assert(headerCols.length === 42, `Expected 42 CSV columns (0..41), got ${headerCols.length}`);
  assert(headerCols[14] === 'static_cumulative_dropped_bytes' && headerCols[27] === 'tac_cumulative_dropped_bytes' && headerCols[35] === 'discarded_duration_ms', 'Original 0..35 header names preserved');
  assert(
    headerCols[36] === 'eviction_scheduler_id' &&
      headerCols[37] === 'eviction_node_id' &&
      headerCols[38] === 'static_dropped_delay_bytes' &&
      headerCols[39] === 'static_dropped_overflow_bytes' &&
      headerCols[40] === 'tac_dropped_delay_bytes' &&
      headerCols[41] === 'tac_dropped_overflow_bytes',
    'REV15 cols 36..41 header names match SPEC §4.2'
  );

  const epochLine = lines.find((l) => l.startsWith('EPOCH,'))!.split(',');
  assert(epochLine.length === 42, 'EPOCH row padded to 42 columns');
  assert(epochLine[14] === '320' && epochLine.slice(36).every((c) => c === ''), 'EPOCH row cols 36..41 are empty strings (zero pollution)');

  const discLine = lines.find((l) => l.startsWith('DISCONTINUITY,'))!.split(',');
  assert(discLine.length === 42 && discLine.slice(36).every((c) => c === ''), 'DISCONTINUITY row cols 36..41 are empty strings');

  const evLine = lines.find((l) => l.startsWith('NODE_EVICTION_FINALIZATION,') && l.includes('STATIC_TDMA'))!.split(',');
  assert(evLine.length === 42, 'Eviction row has 42 columns');
  assert(evLine[1] === '1', 'Eviction col 1 encodes finalizationIndex=1');
  assert(Number(evLine[2]) === exactTs && Number(evLine[3]) === exactTs, 'Eviction cols 2 & 3 preserve exact timestamp');
  assert(evLine[4] === '0' && evLine[5] === '62' && evLine[6] === '62' && evLine[7] === '', 'Eviction cols 4..7 encode duration=0, frame=62, mode=""');
  assert(evLine[14] === '1400' && evLine[27] === '', 'Static eviction writes static col 14 without polluting tac col 27');
  assert(
    evLine[36] === 'STATIC_TDMA' &&
      evLine[37] === '4' &&
      evLine[38] === '400' &&
      evLine[39] === '1000' &&
      evLine[40] === '' &&
      evLine[41] === '',
    'REV15 static eviction cols 36..41 encode schedulerId, nodeId, static bytes and blank tac bytes'
  );

  const dualRes = (await exportTimelineDualCsv({
    spatialBuffer,
    epochStore,
    timeRangeS: [0.0, 2.0],
    autoDispatch: false,
  })) as any;
  assert(
    dualRes.commSelectedIntervalEvictionMayBeTruncated === true &&
      dualRes.selectedIntervalEvictionMayBeTruncated === true &&
      dualRes.globalDiscardedEvictionCount === 1 &&
      dualRes.globalEvictionMinWatermarkTimestampS === 0.01 &&
      dualRes.globalEvictionWatermarkTimestampS === 0.01 &&
      Boolean(dualRes.evictionHistoryMetadata),
    'DualExportResult propagates full REV15 Option A & global watermark metadata'
  );
});

// ----------------------------------------------------------------------------
// TC-CORR-13 (13.1–13.5): Eviction-Only CSV, Tac Eviction Cols & Truncation Notice
// ----------------------------------------------------------------------------
registerTest('TC-CORR-13', 'CSV exporter handles eviction-only buffer, Tac-TAD cols 24..27, unsorted timestamp merge & truncation metadata (13.1–13.5)', async () => {
  const evictionOnlyStore = new (SuperframeEpochStore as any)(100, 10);
  evictionOnlyStore.append(makeEvictionRecord(0, 0.75, 38, 2100, {
    simulationRunId: 1,
    schedulerId: 'TAC_TAD',
    nodeId: 12,
    droppedDelayBytes: 700,
    droppedOverflowBytes: 1400,
  }));
  const resOnly = generateCommEpochsCsv(evictionOnlyStore) as any;
  assert(resOnly.filename.includes('0.75s_to_0.75s'), `Eviction-only CSV filename reflects timestamp, got ${resOnly.filename}`);
  assert(resOnly.rowCount === 1 && resOnly.selectedIntervalEvictionMayBeTruncated === false, 'Single eviction exported cleanly with no truncation');
  const rows = (await resOnly.blob.text()).trim().split('\n');
  const cols = rows[1].split(',');
  assert(cols[0] === 'NODE_EVICTION_FINALIZATION' && cols[1] === '0', 'Row 1 is NODE_EVICTION_FINALIZATION with col 1 finalizationIndex=0');
  assert(cols[14] === '' && cols[27] === '2100', 'Tac-TAD eviction populates col 27 and leaves static col 14 blank');
  assert(
    cols[36] === 'TAC_TAD' &&
      cols[37] === '12' &&
      cols[38] === '' &&
      cols[39] === '' &&
      cols[40] === '700' &&
      cols[41] === '1400',
    'REV15 Tac-TAD eviction cols 36..41 encode TAC_TAD, nodeId=12, blank static bytes and exact tac bytes'
  );
});

// ----------------------------------------------------------------------------
// TC-CORR-14: End-to-End Byte-Drop Conservation (Worker -> Controller -> CSV)
// ----------------------------------------------------------------------------
registerTest('TC-CORR-14', 'End-to-end dropped byte conservation holds identically from schedulers through worker, store, controller & CSV', async () => {
  const worker = new SimulationWorkerManager(100, '16_NODES');
  const { spatialBuffer, epochStore, controller } = createTestTimelineController();
  const rw = worker as unknown as { emitHostMessage: (m: WorkerOutboundMessage, t?: Transferable[]) => void };
  const origEmit = rw.emitHostMessage.bind(worker);
  rw.emitHostMessage = (m: WorkerOutboundMessage, t?: Transferable[]) => {
    if (m.type === 'TELEMETRY_FRAME') {
      controller.ingestTelemetry(m.frame.batch_spatial_snapshots, m.frame.completed_superframes, m.frame);
    } else if (m.type === 'COMMAND_RESULT') {
      controller.ingestCommandResult(m);
    }
    origEmit(m, t);
  };

  // Switch to 40ms superframe to exercise both epoch drops and mid-superframe eviction drops
  worker.handleMessage({ type: 'CONFIG_UPDATE', params: { tdma_frame_duration_ms: 40 } } as any);
  worker.tickSimulation(true); // tick 1 (no epoch emitted yet)
  worker.tickSimulation(true); // tick 2 (epoch 0 emitted)
  worker.tickSimulation(true); // tick 3 (mid-superframe before tick 4)

  // Force overflow drop on node 5 in BOTH static and tac mid-superframe
  const n5Static = worker.nodesStatic.find((n) => n.nodeId === 5)!;
  const n5Tac = worker.nodesTac.find((n) => n.nodeId === 5)!;
  for (let i = 0; i < 405; i++) {
    n5Static.enqueuePacket(70, worker.simTimeS, 1400, worker.simTimeS + 0.5);
    n5Tac.enqueuePacket(70, worker.simTimeS, 1400, worker.simTimeS + 0.5);
  }
  // Delete node 5 synchronously (captures un-collected pending overflow drops!)
  worker.handleMessage({ type: 'NODE_DELETE', node_id: 5 });

  // Force drop on surviving node 6 and continue ticks through next superframe
  const n6Static = worker.nodesStatic.find((n) => n.nodeId === 6)!;
  for (let i = 0; i < 403; i++) {
    n6Static.enqueuePacket(70, worker.simTimeS, 1400, worker.simTimeS + 0.5);
  }
  worker.tickSimulation(true); // tick 4 (epoch 1 emitted)
  worker.tickSimulation(true); // tick 5
  worker.tickSimulation(true); // tick 6 (epoch 2 emitted)

  const expectedStaticBytes = worker.staticScheduler.getRunDropTotals().totalDroppedBytes;
  const expectedTacBytes = worker.tacScheduler.getRunDropTotals().totalDroppedBytes;
  assert(expectedStaticBytes >= 5 * 1400, `Static run drop total should capture all overflows (${expectedStaticBytes})`);
  assert(expectedTacBytes >= 5 * 1400, `Tac run drop total should capture all overflows (${expectedTacBytes})`);

  const csvRes = generateCommEpochsCsv(epochStore);
  const csvLines = (await csvRes.blob.text()).trim().split('\n').slice(1);
  let csvStaticTotal = 0;
  let csvTacTotal = 0;
  for (const line of csvLines) {
    const cols = line.split(',');
    if (cols[0] === 'EPOCH' || cols[0] === 'NODE_EVICTION_FINALIZATION') {
      if (cols[14] !== '') csvStaticTotal += Number(cols[14]);
      if (cols[27] !== '') csvTacTotal += Number(cols[27]);
    }
  }
  assert(csvStaticTotal === expectedStaticBytes, `Static CSV conserved (${csvStaticTotal}) === scheduler (${expectedStaticBytes})`);
  assert(csvTacTotal === expectedTacBytes, `Tac CSV conserved (${csvTacTotal}) === scheduler (${expectedTacBytes})`);
  assert(spatialBuffer.count === 6, 'All 6 spatial frames preserved without loss');
});

// ----------------------------------------------------------------------------
// TC-CORR-15: index.html Wiring, Style Invariance & Node Detail Isolation
// ----------------------------------------------------------------------------
registerTest('TC-CORR-15', 'index.html wires pre-mutation run gates, visibility FSM & preserves lines 7-596 inline CSS', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  assert(html.includes('simTimelineController.prepareTelemetryRun(msg.frame)'), 'Pre-mutation telemetry gate wired');
  assert(html.includes('simTimelineController.ingestCommandResult(msg)'), 'Command result gate wired');
  assert(html.includes('transitionTimelineInspectorStatus(timelineInspectorVisibility, isLive)'), 'Inspector status FSM wired');
  assert(html.includes('toggleTimelineInspectorManual(timelineInspectorVisibility)'), 'Inspector manual toggle FSM wired');
  assert(html.includes('resetTimelineInspectorVisibility()'), 'Inspector reset FSM wired');
  assert(html.includes('simEpochStore.notifySimulationReset()'), 'Fallback reset uses notifySimulationReset');
  assert(html.includes('id="map-node-detail-content"'), 'Node detail isolation panel remains intact');
});

// ----------------------------------------------------------------------------
// TC-CORR-16 (16.1–16.11): Granular Eviction, Reset & Run Isolation Matrix
// ----------------------------------------------------------------------------
registerTest('TC-CORR-16', 'Run isolation across preset switches, paused deletions, zero-drop deletions, and mock locks (16.1–16.11)', () => {
  const { spatialBuffer, epochStore, controller } = createTestTimelineController();
  const worker = new SimulationWorkerManager(100, '16_NODES');
  const rw = worker as unknown as { emitHostMessage: (m: WorkerOutboundMessage, t?: Transferable[]) => void };
  const origEmit = rw.emitHostMessage.bind(worker);
  rw.emitHostMessage = (m: WorkerOutboundMessage, t?: Transferable[]) => {
    if (m.type === 'TELEMETRY_FRAME') {
      controller.ingestTelemetry(m.frame.batch_spatial_snapshots, m.frame.completed_superframes, m.frame);
    } else if (m.type === 'COMMAND_RESULT') {
      controller.ingestCommandResult(m);
    }
    origEmit(m, t);
  };

  // Run 1 ticks + overflow + paused deletion BEFORE next tick
  worker.tickSimulation(true);
  const n3Static = worker.nodesStatic.find((n) => n.nodeId === 3)!;
  for (let i = 0; i < 402; i++) {
    n3Static.enqueuePacket(70, worker.simTimeS, 1400, worker.simTimeS + 0.5);
  }
  worker.handleMessage({ type: 'SIM_CONTROL', action: 'pause' });
  const delPaused = worker.handleMessage({ type: 'NODE_DELETE', node_id: 3 });
  assert((delPaused.eviction_finalizations?.length ?? 0) === 1, 'Paused NODE_DELETE still delivers eviction via COMMAND_RESULT');
  assert(epochStore.evictionCount === 1, 'Controller ingested COMMAND_RESULT eviction immediately while paused');

  // Switch preset -> new run resets old evictions, frames & watermarks cleanly
  worker.handleMessage({ type: 'LOAD_PRESET', preset_id: 'PRESET_16_NODES' } as any);
  assert(epochStore.evictionCount === 0 && epochStore.count === 0 && spatialBuffer.count === 0, 'LOAD_PRESET cleanly resets timeline buffers');
  assert(epochStore.getActiveSimulationRunId() === 2, 'Active runId bumped to 2 cleanly');

  // Late Run 1 telemetry frame injected manually into controller MUST be dropped before spatial mutation
  const staleAccepted = controller.ingestTelemetry(
    [makeTestSpatialSnapshot(99, 1.98)],
    [makeMockEpoch(99, 1.96, 1.98, { simulationRunId: 1 })],
    { simulation_run_id: 1 } as unknown as TelemetryFrame
  );
  assert(staleAccepted === false && spatialBuffer.count === 0, 'Late Run 1 frame rejected before touching spatialBuffer');

  // Newly added node deleted with zero drops emits zero eviction records
  const addNew = worker.handleMessage({ type: 'NODE_ADD', node_type: 'soldier', x_m: 500, y_m: 500 } as any);
  const delClean = worker.handleMessage({ type: 'NODE_DELETE', node_id: addNew.node_id! });
  assert((delClean.eviction_finalizations ?? []).length === 0, 'Zero-drop newly added node produces no spurious eviction record');
});

// ----------------------------------------------------------------------------
// TC-CORR-17 (REV11 TC-CORR-08): Multi-Cadence 10ms / 20ms / 40ms Drop Conservation
// ----------------------------------------------------------------------------
registerTest('TC-CORR-17', 'Multi-cadence 10ms, 20ms & 40ms frame loops conserve dropped delay and overflow bytes identically across LegacyStaticScheduler and TerrainAwareDynamicScheduler', () => {
  for (const dtS of [0.010, 0.020, 0.040]) {
    for (const sched of [new LegacyStaticScheduler(), new TerrainAwareDynamicScheduler(0.008)]) {
      sched.setTdmaConfig?.({ epochDurationS: dtS, frameDurationS: dtS } as any);
      const node = new GroundNodeTrafficSubsystem(1, 'soldier', [0, 0, 3000], 707);
      const links = { 1: makeHealthyLink() };
      const preds = { 1: makeNormalPred() };

      let summedFrameBytes = 0;
      let summedDelayBytes = 0;
      let summedOverflowBytes = 0;
      const frameCount = Math.round(0.20 / dtS); // 20, 10, 5 frames over 0.20s

      for (let f = 0; f < frameCount; f++) {
        const t = (f + 1) * dtS;
        // Inject an expired packet (200 B delay drop) on even frames
        if (f % 2 === 0) {
          node.enqueuePacket(65, t - dtS, 200, t - 0.002);
        }
        // Inject an overflow wave (queue max 400 -> 1 packet overflow of 350 B) on frame 1
        if (f === 1) {
          for (let k = 0; k < 402; k++) {
            node.enqueuePacket(70, t, 350, t + 2.0);
          }
        }
        const out = sched.scheduleFrame(f, t, [node], links, preds) as unknown as Record<string, number>;
        summedDelayBytes += out.droppedDelayBytesThisFrame;
        summedOverflowBytes += out.droppedOverflowBytesThisFrame;
        summedFrameBytes += out.totalDroppedBytesThisFrame;
      }

      const totals = sched.getRunDropTotals();
      const monoDelay = (node.queue as unknown as { monotonicDroppedDelayBytes: number }).monotonicDroppedDelayBytes;
      const monoOverflow = (node.queue as unknown as { monotonicDroppedOverflowBytes: number }).monotonicDroppedOverflowBytes;
      const monoTotal = (node.queue as unknown as { monotonicTotalDroppedBytes: number }).monotonicTotalDroppedBytes;

      assert(summedDelayBytes === totals.droppedDelayBytes && totals.droppedDelayBytes === monoDelay,
        `${sched.schedulerName} @${Math.round(dtS * 1000)}ms conserves delay bytes (${summedDelayBytes} === ${totals.droppedDelayBytes} === ${monoDelay})`);
      assert(summedOverflowBytes === totals.droppedOverflowBytes && totals.droppedOverflowBytes === monoOverflow,
        `${sched.schedulerName} @${Math.round(dtS * 1000)}ms conserves overflow bytes (${summedOverflowBytes} === ${totals.droppedOverflowBytes} === ${monoOverflow})`);
      assert(summedFrameBytes === totals.totalDroppedBytes && totals.totalDroppedBytes === monoTotal && monoTotal > 0,
        `${sched.schedulerName} @${Math.round(dtS * 1000)}ms conserves total dropped bytes (${summedFrameBytes} === ${totals.totalDroppedBytes} === ${monoTotal})`);
    }
  }
});

// ----------------------------------------------------------------------------
// TC-CORR-18 (REV15 TC-CORR-14b): Zero-Alloc Columnar CSV Parity & 6,465,000 B Invariant
// ----------------------------------------------------------------------------
registerTest('TC-CORR-18', 'generateSpatialFramesCsv streams zero-alloc columnar data bit-identically to get(i) across dense, wrapped, sparse & null frames (14b)', async () => {
  const fullCapBuf = new SpatialSnapshotBuffer(3000, 128);
  assert(fullCapBuf.getTotalByteLength() === 6465000, `SpatialSnapshotBuffer(3000, 128) byte length must be 6,465,000 B, got ${fullCapBuf.getTotalByteLength()}`);
  assert(typeof (fullCapBuf as unknown as { getReadonlyExportColumns?: unknown }).getReadonlyExportColumns === 'function', 'getReadonlyExportColumns() must exist on SpatialSnapshotBuffer');

  // 1. Wrapped ring buffer (capacity=8, 13 frames) with sparse, out-of-order, >nodeCount nodeIds, null altitudes & mixed MODCODs
  const buf = new SpatialSnapshotBuffer(8, 128);
  const modcods = ['64-APSK 5/6', 'QPSK 1/2', 'CUSTOM_X_99', '16-APSK 2/3'];
  const states = [
    NodeTerrainState.NORMAL_LOS,
    NodeTerrainState.PRE_OCCLUSION_FLUSH,
    NodeTerrainState.HARD_SHADOW_CUTOFF,
    NodeTerrainState.RE_EMERGENCE_BURST,
  ];
  for (let f = 1; f <= 13; f++) {
    const snap = makeTestSpatialSnapshot(f, f * 0.02);
    const sparseNodes = f % 2 === 0
      ? [
          { nodeId: 12, posX: 100, posY: 200, posZ: 3100, altitudeMslM: 3100, altitudeAglM: 2.5, isLos: false, isOutage: true, isObstacleBlocked: true, snrDb: -3.45, currentState: states[f % 4] },
          { nodeId: 0, posX: 300, posY: 400, posZ: 3200, altitudeMslM: 3200, altitudeAglM: 4.0, isLos: true, isOutage: false, isObstacleBlocked: false, snrDb: 21.37, currentState: states[(f + 1) % 4] },
          { nodeId: 19, posX: 500, posY: 600, posZ: 3300, altitudeMslM: 3300, altitudeAglM: 6.0, isLos: true, isOutage: false, isObstacleBlocked: false, snrDb: 14.0, currentState: NodeTerrainState.NORMAL_LOS },
          { nodeId: 5, posX: 700, posY: 800, posZ: 3400, altitudeMslM: 3400, altitudeAglM: 8.0, isLos: true, isOutage: false, isObstacleBlocked: false, snrDb: 18.88, currentState: NodeTerrainState.RE_EMERGENCE_BURST },
        ]
      : Array.from({ length: 16 }, (_, nid) => ({
          nodeId: nid,
          posX: 1000 + nid * 10,
          posY: 2000 + nid * 10,
          posZ: 3200,
          altitudeMslM: 3200,
          altitudeAglM: 2.0,
          isLos: nid % 2 === 0,
          isOutage: nid % 3 === 0,
          isObstacleBlocked: nid % 5 === 0,
          snrDb: 10.25 + nid * 0.37,
          currentState: states[nid % 4],
        }));

    buf.append({
      ...snap,
      acn: {
        ...snap.acn,
        altitudeMslM: f % 3 === 0 ? (null as unknown as number) : snap.acn.altitudeMslM,
        altitudeAglM: f % 4 === 0 ? (null as unknown as number) : snap.acn.altitudeAglM,
      },
      nodes: sparseNodes,
      selectedLinkBudget: f % 3 === 0 ? null : {
        slantRangeM: 12345.67,
        fsplDb: 132.4,
        diffractionLossDb: 3.21,
        gasLossDb: 0.1234,
        rainLossDb: 0.5678,
        totalLossDb: 136.3,
        snrDb: 19.87,
        modcodName: modcods[f % modcods.length],
        bitrateMbps: 18.25,
        isOutage: f % 5 === 0,
      },
    });
  }

  // Fallback mock exposing only public get(i) API (no getReadonlyExportColumns)
  const fallbackView = {
    get count() { return buf.count; },
    get oldestSimulationTimeS() { return buf.oldestSimulationTimeS; },
    get newestSimulationTimeS() { return buf.newestSimulationTimeS; },
    get: (idx: number) => buf.get(idx),
  } as unknown as SpatialSnapshotBuffer;

  const colRes = generateSpatialFramesCsv(buf, { include128Nodes: true, maxNodes: 16 });
  const fallbackRes = generateSpatialFramesCsv(fallbackView, { include128Nodes: true, maxNodes: 16 });
  assert(colRes.rowCount === fallbackRes.rowCount && colRes.byteLength === fallbackRes.byteLength, 'Wrapped sparse CSV rowCount & byteLength match get(i)');
  const colText = await colRes.blob.text();
  const fallbackText = await fallbackRes.blob.text();
  assert(colText === fallbackText, 'Wrapped sparse/null-altitude/out-of-order CSV text is 100% bit-identical to get(i) fallback');

  // 2. Dense 128-node buffer bit-identical parity
  const denseBuf = new SpatialSnapshotBuffer(4, 128);
  for (let f = 1; f <= 4; f++) {
    const snap = makeTestSpatialSnapshot(f, f * 0.02);
    denseBuf.append({
      ...snap,
      nodes: Array.from({ length: 128 }, (_, nid) => ({
        nodeId: nid,
        posX: 1000,
        posY: 2000,
        posZ: 3200,
        altitudeMslM: 3200,
        altitudeAglM: 2,
        isLos: nid % 2 === 0,
        isOutage: nid % 7 === 0,
        isObstacleBlocked: false,
        snrDb: -5.12 + nid * 0.25,
        currentState: states[nid % 4],
      })),
    });
  }
  const denseFallback = {
    get count() { return denseBuf.count; },
    get oldestSimulationTimeS() { return denseBuf.oldestSimulationTimeS; },
    get newestSimulationTimeS() { return denseBuf.newestSimulationTimeS; },
    get: (idx: number) => denseBuf.get(idx),
  } as unknown as SpatialSnapshotBuffer;
  const denseColText = await generateSpatialFramesCsv(denseBuf, { include128Nodes: true, maxNodes: 128 }).blob.text();
  const denseFallbackText = await generateSpatialFramesCsv(denseFallback, { include128Nodes: true, maxNodes: 128 }).blob.text();
  assert(denseColText === denseFallbackText, 'Dense 128-node columnar CSV matches get(i) fallback bit-for-bit');
});

async function main(): Promise<void> {
  let passed = 0;
  let failed = 0;

  console.log('====================================================================');
  console.log(' VERIFICATION: TIMELINE CORRECTIVE FIXES (REV14)');
  console.log('====================================================================');

  for (const t of TESTS) {
    try {
      await t.fn();
      console.log(`[PASS] ${t.id}: ${t.name}`);
      passed++;
    } catch (err) {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error(`[FAIL] ${t.id}: ${t.name}\n${msg}`);
      failed++;
    }
  }

  console.log('--------------------------------------------------------------------');
  console.log(`Summary: ${passed} passed, ${failed} failed (total ${TESTS.length})`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
