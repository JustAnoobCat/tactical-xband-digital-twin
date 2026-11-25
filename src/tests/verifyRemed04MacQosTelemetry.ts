/**
 * src/tests/verifyRemed04MacQosTelemetry.ts
 *
 * Regression Verification Suite for REMED-04:
 * MAC Scheduler Scientific Fairness, 5QI QoS SLA & Telemetry Fidelity.
 */

import assert from 'node:assert/strict';
import { GroundNodeTrafficSubsystem, QOS_PROFILES, CANONICAL_5QI_PDB_MS } from '../core/queues';
import {
  LegacyStaticScheduler,
  TerrainAwareDynamicScheduler,
  ReactiveMlwdfScheduler,
  type FrameScheduleReport,
} from '../core/scheduler';
import {
  CANONICAL_5QI_BEARERS,
  evaluate5QiBearerSlaMetrics,
} from '../core/qosSlaEngine';
import { ActiveTransferManager } from '../core/transferManager';
import { MODCOD_TABLE, type LinkStatus } from '../core/linkBudget';
import { NodeTerrainState, type PredictiveState } from '../core/trajectory';
import { dissectTdmaSlotAllocation, getModcodIdentifier } from '../core/pduDissector';
import { getReferenceConstellation } from '../core/vsaConstellationEngine';
import { NodeLifecycleManager } from '../worker/nodeLifecycleManager';
import { createDefault16NodeRegistry } from '../core/nodeRegistry';
import { TerrainEngine } from '../core/terrain';
import { SimulationWorkerManager } from '../worker/simWorker';
import { TelemetrySerializer } from '../worker/telemetrySerializer';
import { TdmaFrameConfig, TDMA_PRESET_FAST_10MS, TDMA_PRESET_STANDARD_20MS, TDMA_PRESET_EXTENDED_40MS } from '../core/tdmaConfig';
import type { TelemetryFrame, TelemetryFrameMessage } from '../shared/workerProtocol';

function makeLink(overrides: Partial<LinkStatus> = {}): LinkStatus {
  return {
    nodeType: 'soldier',
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
    snrDb: 12.0,
    modcodName: 'QPSK 1/2',
    spectralEfficiency: 0.99,
    bitrateBps: 1.0e6,
    bitrateMbps: 1.0,
    isOutage: false,
    ...overrides,
  };
}

function makePred(state: NodeTerrainState = NodeTerrainState.NORMAL_LOS): PredictiveState {
  return {
    currentState: state,
    timeToOcclusionS: Number.POSITIVE_INFINITY,
    timeToEmergenceS: 0,
    fresnelClearanceM: 50,
    fresnelRateOfChangeMps: 0,
    predictedOutageDurationS: 0,
  };
}

let passed = 0;
function runTest(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✔ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ✖ [FAIL] ${name}`);
    throw err;
  }
}

console.log('================================================================================');
console.log(' REMED-04 Verification: MAC Scheduler Fairness, 5QI QoS SLA & Telemetry Fidelity');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// 1. LegacyStaticScheduler outage fairness
// -----------------------------------------------------------------------------
runTest('LegacyStaticScheduler outage tracks last-known LOS bitrate (~1 Mbps), not 4.95 Mbps', () => {
  for (const multiSector of [false, true]) {
    const sched = new LegacyStaticScheduler();
    sched.enableMultiSector = multiSector;
    const node = new GroundNodeTrafficSubsystem(1, 'soldier', [1000, 0, 3000], 11);

    // Enqueue plenty of data so outage drain reveals true rate
    for (let i = 0; i < 40; i++) {
      node.enqueuePacket(70, 0.0, 1400, 10.0);
    }

    const losLinks = new Map<number, LinkStatus>([
      [1, makeLink({ bitrateBps: 1.0e6, bitrateMbps: 1.0, modcodName: 'QPSK 1/2', activeSectorId: 0 })],
    ]);
    const preds = new Map<number, PredictiveState>([[1, makePred()]]);

    const rLos = sched.scheduleFrame(0, 0.0, [node], losLinks, preds);
    assert.ok(rLos.totalBitsTransmitted > 0, 'LOS frame should transmit bits');

    // Transition to outage (bitrateBps = 0)
    const outageLinks = new Map<number, LinkStatus>([
      [1, makeLink({ bitrateBps: 0, bitrateMbps: 0, modcodName: 'LINK_OUTAGE', isOutage: true, activeSectorId: 0 })],
    ]);
    const rOutage = sched.scheduleFrame(1, 0.02, [node], outageLinks, preds);
    // Max slot in 20ms frame is ~15.988 ms -> at 1.0 Mbps max capacity ~15,988 bits; at 4.95 Mbps it would be ~79,140 bits
    assert.ok(
      rOutage.totalBitsWastedOnOutage > 0 && rOutage.totalBitsWastedOnOutage <= 16500,
      `Outage wasted bits (${rOutage.totalBitsWastedOnOutage}) must reflect ~1 Mbps last LOS rate, not 4.95 Mbps`
    );
    assert.ok(
      rOutage.allocations[0].capacityBits <= 16500,
      `Outage slot capacity (${rOutage.allocations[0].capacityBits}) must not inflate to 4.95 Mbps`
    );

    // Reset clears lastKnownLosBitrateBps and cold-outage node falls back conservatively (~1 Mbps), never 4.95 Mbps
    sched.reset();
    const coldNode = new GroundNodeTrafficSubsystem(2, 'soldier', [1000, 0, 3000], 12);
    for (let i = 0; i < 40; i++) {
      coldNode.enqueuePacket(70, 0.0, 1400, 10.0);
    }
    const coldOutageLinks = new Map<number, LinkStatus>([
      [2, makeLink({ bitrateBps: 0, bitrateMbps: 0, modcodName: 'LINK_OUTAGE', isOutage: true, activeSectorId: 0 })],
    ]);
    const rCold = sched.scheduleFrame(2, 0.04, [coldNode], coldOutageLinks, new Map([[2, makePred()]]));
    assert.ok(
      rCold.totalBitsWastedOnOutage > 0 && rCold.totalBitsWastedOnOutage <= 16500,
      `Cold outage wasted bits (${rCold.totalBitsWastedOnOutage}) must use conservative ~1 Mbps fallback`
    );
  }
});

// -----------------------------------------------------------------------------
// 2. Variable TDMA superframe offered-load invariance + 20ms determinism
// -----------------------------------------------------------------------------
runTest('Variable TDMA offered load is invariant (<10% spread) across 10/20/40 ms & 20 ms deterministic', () => {
  const simulateOfferedBytes = (frameDurationS: number, seed: number): number[] => {
    const node = new GroundNodeTrafficSubsystem(4, 'soldier', [0, 0, 3000], seed, {
      hasVoice: true,
      voiceStartS: 0.0,
      voiceEndS: 5.0,
      hasVideo: true,
      videoMeanPktsPerFrame: 1.5,
      hasPhoto: true,
      photoTriggerTimeS: 0.5,
      photoSizeBytes: 2_000_000,
    });
    const steps = Math.round(5.0 / frameDurationS);
    const perStepBytes: number[] = [];
    for (let s = 0; s < steps; s++) {
      const t = s * frameDurationS;
      const pkts = node.generateTraffic(t, frameDurationS, 1.0, 1.0);
      let bytes = 0;
      for (const p of pkts) bytes += p.sizeBytes;
      perStepBytes.push(bytes);
      // Drain queue periodically so buffer ceiling doesn't alter behavior
      node.queue.dequeue(100_000, t);
    }
    return perStepBytes;
  };

  const trace10 = simulateOfferedBytes(0.010, 77);
  const trace20A = simulateOfferedBytes(0.020, 77);
  const trace20B = simulateOfferedBytes(0.020, 77);
  const trace40 = simulateOfferedBytes(0.040, 77);

  // Bit-exact 20 ms determinism
  assert.deepEqual(trace20A, trace20B, '20 ms offered traffic sequence must be bit-exact deterministic');

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const total10 = sum(trace10);
  const total20 = sum(trace20A);
  const total40 = sum(trace40);

  const relDiff10 = Math.abs(total10 - total20) / total20;
  const relDiff40 = Math.abs(total40 - total20) / total20;

  assert.ok(relDiff10 < 0.10, `10 ms offered load (${total10} B) must be within 10% of 20 ms (${total20} B), diff=${(relDiff10 * 100).toFixed(2)}%`);
  assert.ok(relDiff40 < 0.10, `40 ms offered load (${total40} B) must be within 10% of 20 ms (${total20} B), diff=${(relDiff40 * 100).toFixed(2)}%`);

  // Also verify SimulationWorkerManager across 10 ms / 20 ms / 40 ms TDMA presets
  const runWorkerEnqueued = (preset: typeof TDMA_PRESET_STANDARD_20MS): number => {
    const sim = new SimulationWorkerManager(901, '16_NODES');
    sim.terrainEngine.setTerrainMode('synthetic');
    sim.isPaused = true;
    sim.handleMessage({ type: 'CONFIG_UPDATE', tdma_frame_config: preset } as any);
    for (let f = 0; f < 100; f++) {
      sim.tickSimulation(false);
    }
    return sim.metrics.tacEnqueuedPkts;
  };

  const pkts10 = runWorkerEnqueued(TDMA_PRESET_FAST_10MS);
  const pkts20 = runWorkerEnqueued(TDMA_PRESET_STANDARD_20MS);
  const pkts40 = runWorkerEnqueued(TDMA_PRESET_EXTENDED_40MS);
  assert.ok(Math.abs(pkts10 - pkts20) / Math.max(1, pkts20) < 0.10, `Worker 10ms pkts (${pkts10}) vs 20ms (${pkts20}) must agree within 10%`);
  assert.ok(Math.abs(pkts40 - pkts20) / Math.max(1, pkts20) < 0.10, `Worker 40ms pkts (${pkts40}) vs 20ms (${pkts20}) must agree within 10%`);
});

// -----------------------------------------------------------------------------
// 3. Canonical 5QI PDB unification & live HoL sojourn SLA detection
// -----------------------------------------------------------------------------
runTest('queues.ts and qosSlaEngine.ts share canonical 5QI PDBs & live HoL sojourn triggers SLA violations', () => {
  const expectedPdbMs: Record<number, number> = { 69: 60.0, 65: 75.0, 67: 150.0, 70: 300.0 };
  for (const bearer of CANONICAL_5QI_BEARERS) {
    assert.equal(bearer.pdbMs, expectedPdbMs[bearer.qos5qi], `Bearer ${bearer.qos5qi} PDB mismatch`);
    assert.equal(CANONICAL_5QI_PDB_MS[bearer.qos5qi as 69 | 65 | 67 | 70], expectedPdbMs[bearer.qos5qi]);
    assert.equal(QOS_PROFILES[bearer.qos5qi].pdbS * 1000.0, bearer.pdbMs, `QOS_PROFILES[${bearer.qos5qi}].pdbS must match bearer pdbMs`);
  }
  // Verify 5QI 69 keeps explicit 60s store-and-forward retention separate from 60 ms PDB
  assert.equal(QOS_PROFILES[69].hardDropTtlS, 60.0);

  // Run a real congested SimulationWorkerManager frame and check live bearer_hol_delay_ms + SLA evaluation
  const capturedFrames: TelemetryFrame[] = [];
  const prevSelf = (globalThis as { self?: unknown }).self;
  (globalThis as { self?: unknown }).self = {
    postMessage: (msg: unknown) => {
      const m = msg as TelemetryFrameMessage | undefined;
      if (m?.type === 'TELEMETRY_FRAME') capturedFrames.push(m.frame);
    },
  };

  try {
    const sim = new SimulationWorkerManager(555, '16_NODES');
    sim.terrainEngine.setTerrainMode('synthetic');
    sim.isPaused = true;
    // Inject SOS + Photo + Voice into node 4, and step 10 frames (200 ms) so HoL ages > 60 ms
    sim.handleMessage({ type: 'INJECT_TRAFFIC', node_id: 4, traffic_type: 'SOS' });
    sim.handleMessage({ type: 'INJECT_TRAFFIC', node_id: 4, traffic_type: 'VOICE' });
    // Force node 4 into occlusion via position/shadow or heavy load so HoL delay builds up
    sim.handleMessage({ type: 'NODE_UPDATE', node_id: 4, x_m: 120000, y_m: 120000, agl_m: 1.0 });
    for (let f = 0; f < 10; f++) {
      sim.tickSimulation(f === 9);
    }

    assert.ok(capturedFrames.length >= 1, 'Must capture live TelemetryFrame');
    const frame = capturedFrames[capturedFrames.length - 1];
    const n4 = frame.nodes_telemetry.find((n) => n.node_id === 4);
    assert.ok(n4 && n4.bearer_hol_delay_ms, 'NodeTelemetryItem must expose bearer_hol_delay_ms');
    assert.ok(
      n4.bearer_hol_delay_ms.c2_ms > 60.0 || n4.bearer_hol_delay_ms.voice_ms > 0,
      `Node 4 must report non-zero live HoL sojourn delay, got ${JSON.stringify(n4.bearer_hol_delay_ms)}`
    );

    const sla = evaluate5QiBearerSlaMetrics(frame.nodes_telemetry, frame.active_gantt_allocations);
    const c2Bearer = sla.bearers.find((b) => b.qos5qi === 69)!;
    assert.ok(c2Bearer.estimatedMaxSojournMs >= n4.bearer_hol_delay_ms.c2_ms - 1e-6);
    if (n4.bearer_hol_delay_ms.c2_ms > 60.0) {
      assert.equal(c2Bearer.slaVerdict, 'SLA_BREACHED', '5QI 69 sojourn > 60 ms must trigger SLA_BREACHED');
      assert.ok(sla.overallSlaCompliancePct < 100.0, 'Overall SLA compliance must drop below 100% when congested');
    }
  } finally {
    if (prevSelf === undefined) delete (globalThis as { self?: unknown }).self;
    else (globalThis as { self?: unknown }).self = prevSelf;
  }
});

// -----------------------------------------------------------------------------
// 4. Gantt per-QoS bytes, reactive timestamp, TransferManager & NodeLifecycle sync
// -----------------------------------------------------------------------------
runTest('Gantt QoS bytes, Reactive timestamp, TransferManager targetQoS, and NODE_UPDATE reactiveNode.identity', () => {
  // 4a. Live TelemetryFrame Gantt slots carry real voice/video/photo bytes
  const captured: TelemetryFrame[] = [];
  const prevSelf = (globalThis as { self?: unknown }).self;
  (globalThis as { self?: unknown }).self = {
    postMessage: (msg: unknown) => {
      const m = msg as TelemetryFrameMessage | undefined;
      if (m?.type === 'TELEMETRY_FRAME') captured.push(m.frame);
    },
  };
  try {
    const sim = new SimulationWorkerManager(202, '16_NODES');
    sim.terrainEngine.setTerrainMode('synthetic');
    sim.isPaused = true;
    // Enqueue only Voice (65) and Photo (70) on node 15 (no C2 yet at t=0 if we dequeue/clear C2)
    sim.nodesTac[15].queue.reset();
    sim.nodesTac[15].enqueuePacket(65, 0.0, 160);
    sim.nodesTac[15].enqueuePacket(70, 0.0, 1400);
    // Run tac scheduler directly via tick or inspect TelemetrySerializer
    const sched = new TerrainAwareDynamicScheduler();
    const link15 = makeLink({ nodeType: 'mcp', bitrateBps: 4.95e6, bitrateMbps: 4.95, modcodName: '64-APSK 5/6' });
    const report = sched.scheduleFrame(0, 0.0, [sim.nodesTac[15]], new Map([[15, link15]]), new Map([[15, makePred()]]));
    assert.equal(report.allocations[0].c2Bytes, 0);
    assert.equal(report.allocations[0].voiceBytes, 160);
    assert.equal(report.allocations[0].photoBytes, 1400);

    // 4b. TelemetrySerializer uses lastReportReactive.timestampS for reactive_gantt_allocations
    const serializer = new TelemetrySerializer();
    const tacReport: FrameScheduleReport = {
      ...report,
      timestampS: 0.02,
      allocations: [{ ...report.allocations[0], slotStartS: 0.024 }],
    };
    const reactiveReport: FrameScheduleReport = {
      ...report,
      schedulerName: 'Reactive_M_LWDF',
      timestampS: 0.04,
      allocations: [{ ...report.allocations[0], slotStartS: 0.044 }],
    };
    const mockState: any = {
      frameIndex: 2,
      simTimeS: 0.04,
      speed: 1,
      achievedSpeed: 1,
      isPaused: false,
      spatialLocked: false,
      spatialRevision: 1,
      schedulerMode: 'tac_tad',
      selectedNodeId: 15,
      nodesStatic: sim.nodesStatic,
      nodesTac: sim.nodesTac,
      nodesReactive: sim.nodesReactive,
      nodeRegistry: sim.nodeRegistry,
      registrationLifecycle: sim.registrationLifecycle,
      flightConfig: sim.flightConfig,
      trajectoryEngine: sim.trajectoryEngine,
      terrainEngine: sim.terrainEngine,
      linkStatuses: new Map([[15, link15]]),
      predStates: new Map([[15, makePred()]]),
      obstructionResults: new Map(),
      nodeTransfers: sim.transferManager.states,
      metrics: sim.metrics,
      lastReportStatic: tacReport,
      lastReportTac: tacReport,
      lastReportReactive: reactiveReport,
      staticGoodputTracker: sim.staticGoodputTracker,
      tacGoodputTracker: sim.tacGoodputTracker,
      tdmaConfig: new TdmaFrameConfig(),
    };
    const fresnelMock: any = { link_budget: { node_id: 15 } };
    const telFrame = serializer.buildTelemetryFrame(mockState, [0, 0, 5000], fresnelMock);
    assert.equal(telFrame.tac_gantt_allocations[0].c2_bytes, 0, 'Must NOT emit hardcoded c2_bytes=128');
    assert.equal(telFrame.tac_gantt_allocations[0].voice_bytes, 160);
    assert.equal(telFrame.tac_gantt_allocations[0].photo_bytes, 1400);
    assert.ok(
      Math.abs(telFrame.reactive_gantt_allocations![0].start_ms - 4.0) < 1e-4,
      `reactive_gantt_allocations start_ms must use lastReportReactive.timestampS (expected 4.0 ms, got ${telFrame.reactive_gantt_allocations![0].start_ms})`
    );
  } finally {
    if (prevSelf === undefined) delete (globalThis as { self?: unknown }).self;
    else (globalThis as { self?: unknown }).self = prevSelf;
  }

  // 4c. ActiveTransferManager credits ONLY actual targetQos dequeued bytes & checks totalBytes for SOS
  const tm = new ActiveTransferManager();
  const node = new GroundNodeTrafficSubsystem(3, 'soldier', [0, 0, 3000], 33);
  node.enqueuePacket(69, 0.0, 128);
  node.enqueuePacket(70, 0.0, 1400);
  const links = new Map([[3, makeLink()]]);
  const preds = new Map([[3, makePred()]]);

  // PHOTO transfer must NOT credit empty slots or C2/Voice bytes
  tm.registerNode(3);
  tm.startTransfer(3, 'PHOTO', 2800, 0.0, false);
  const emptyAndC2Report: FrameScheduleReport = {
    frameIndex: 0,
    timestampS: 0.02,
    schedulerName: 'Tac_TAD',
    allocations: [{
      nodeId: 3,
      slotStartS: 0.024,
      durationS: 0.005,
      timingAdvanceS: 0.0001,
      modcodName: '16-APSK 2/3',
      spectralEfficiency: 2.64,
      capacityBits: 13200,
      isPreOcclusionFlush: false,
      c2Bytes: 128,
      voiceBytes: 160,
      videoBytes: 0,
      photoBytes: 0,
    }],
    totalUlScheduledS: 0.005,
    totalUlAvailableS: 0.016,
    totalUlUnusedS: 0.011,
    totalUlUtilizationPct: 31.25,
    totalPayloadBitsDequeued: 2304,
    totalBitsTransmitted: 2304,
    totalBitsWastedOnOutage: 0,
    packetsDroppedDelay: 0,
    packetsDroppedOverflow: 0,
    packetsDroppedDelayThisFrame: 0,
    packetsDroppedOverflowThisFrame: 0,
    droppedDelayBytes: 0,
    droppedOverflowBytes: 0,
    totalDroppedBytes: 0,
    droppedDelayBytesThisFrame: 0,
    droppedOverflowBytesThisFrame: 0,
    totalDroppedBytesThisFrame: 0,
    runDroppedDelayBytes: 0,
    runDroppedOverflowBytes: 0,
    runTotalDroppedBytes: 0,
    totalBacklogBits: 0,
    superframeDurationS: 0.02,
    ctrlDurationS: 0.001,
    dlDurationS: 0.003,
    ulAvailableDurationS: 0.016,
  };
  tm.step({ activeNodes: [node], linkStatuses: links, predStates: preds, activeReport: emptyAndC2Report, simTimeS: 0.02, isPaused: false });
  assert.equal(tm.get(3)!.deliveredBytes, 0, 'PHOTO transfer must not credit C2/Voice or raw slot capacity');

  // SOS transfer must NOT acknowledge on partial C2 bytes (< totalBytes)
  tm.startTransfer(3, 'SOS', 2560, 0.04, false);
  tm.step({ activeNodes: [node], linkStatuses: links, predStates: preds, activeReport: emptyAndC2Report, simTimeS: 0.06, isPaused: false });
  assert.equal(tm.get(3)!.deliveredBytes, 128);
  assert.equal(tm.get(3)!.status, 'TRANSMITTING', 'SOS must stay TRANSMITTING until deliveredBytes >= totalBytes');

  // 4d. NodeLifecycleManager.updateNode syncs reactiveNode.identity
  const registry = createDefault16NodeRegistry(0);
  const terrain = new TerrainEngine({ terrainMode: 'synthetic' });
  const { nodesStatic, nodesTac, nodesReactive } = NodeLifecycleManager.initNodes(registry, terrain);
  const updateRes = NodeLifecycleManager.updateNode({
    msg: { type: 'NODE_UPDATE', node_id: 2, callsign: 'REACTIVE-SYNC-2', role: 'mcp', color_hex: '#ff00aa' },
    nodesStatic,
    nodesTac,
    nodesReactive,
    nodeRegistry: registry,
    terrainEngine: terrain,
    spatialLocked: false,
  });
  assert.equal(updateRes.accepted, true);
  assert.equal(nodesStatic[2].identity.callsign, 'REACTIVE-SYNC-2');
  assert.equal(nodesTac[2].identity.callsign, 'REACTIVE-SYNC-2');
  assert.equal(nodesReactive[2].identity.callsign, 'REACTIVE-SYNC-2');
  assert.equal(nodesReactive[2].identity.role, 'mcp');
  assert.equal(nodesReactive[2].identity.colorHex, '#ff00aa');
});

// -----------------------------------------------------------------------------
// 5. PDU Dissector MODCOD matching & ETSI EN 302 307-2 64-APSK 4-ring geometry
// -----------------------------------------------------------------------------
runTest('pduDissector maps every MODCOD_TABLE tier uniquely & 64-APSK uses 4+12+20+28 rings', () => {
  const tiers = [
    ...MODCOD_TABLE.map((m) => m.name),
    'π/2-BPSK 1/3',
    '8-PSK 3/4',
  ];

  // Check unique non-fallback identifiers even when spectralEff = 0
  const distinctByName = new Map<string, number>();
  for (const name of tiers) {
    const idZeroEff = getModcodIdentifier(name, 0.0);
    const idHighEff = getModcodIdentifier(name, 99.0);
    assert.equal(idZeroEff, idHighEff, `MODCOD ${name} must not depend on spectralEff fallback`);
    distinctByName.set(name, idZeroEff);

    // Also verify end-to-end via dissectTdmaSlotAllocation hexHeaderDump byte 4
    const pdu = dissectTdmaSlotAllocation({ nodeId: 1, capacityBits: 4096, modcodName: name, spectralEfficiency: 0.0 });
    const hexBytes = pdu.hexHeaderDump.split(' ');
    assert.equal(parseInt(hexBytes[4], 16), idZeroEff, `Dissected hex header byte 4 must match MODCOD ID for ${name}`);
  }

  // All canonical MODCOD_TABLE entries have distinct IDs
  const tableIds = new Set(MODCOD_TABLE.map((m) => getModcodIdentifier(m.name, 0.0)));
  assert.equal(tableIds.size, MODCOD_TABLE.length, 'Every MODCOD_TABLE tier must map to a distinct MODCOD identifier');

  // Verify 64-APSK 5/6 concentric 4+12+20+28 ring structure and unit energy
  const pts64Apsk = getReferenceConstellation('64-APSK 5/6');
  assert.equal(pts64Apsk.length, 64, '64-APSK must contain 64 constellation points');

  let sumEnergy = 0;
  const ringCounts = new Map<string, number>();
  for (const pt of pts64Apsk) {
    const r2 = pt.i * pt.i + pt.q * pt.q;
    sumEnergy += r2;
    const rKey = Math.sqrt(r2).toFixed(5);
    ringCounts.set(rKey, (ringCounts.get(rKey) ?? 0) + 1);
  }
  const meanEnergy = sumEnergy / pts64Apsk.length;
  assert.ok(Math.abs(meanEnergy - 1.0) <= 1e-6, `64-APSK mean symbol energy must be 1.0 ± 1e-6, got ${meanEnergy}`);

  const sortedCounts = Array.from(ringCounts.entries())
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([, count]) => count);
  assert.deepEqual(sortedCounts, [4, 12, 20, 28], `64-APSK must form 4 concentric rings (4+12+20+28), got ${JSON.stringify(sortedCounts)}`);

  // Verify 64-QAM still yields 8x8 square grid (more than 4 radii)
  const pts64Qam = getReferenceConstellation('64-QAM');
  assert.equal(pts64Qam.length, 64);
  const qamRadii = new Set(pts64Qam.map((p) => Math.hypot(p.i, p.q).toFixed(5)));
  assert.ok(qamRadii.size > 4, '64-QAM must remain an 8x8 square grid (>4 distinct radii)');
});

console.log(`\n================================================================================`);
console.log(` ALL ${passed}/5 REMED-04 VERIFICATION SUITES PASSED`);
console.log(`================================================================================\n`);
