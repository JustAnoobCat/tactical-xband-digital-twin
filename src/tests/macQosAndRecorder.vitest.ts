import { describe, expect, it } from 'vitest';
import { GroundNodeTrafficSubsystem, QOS_PROFILES, CANONICAL_5QI_PDB_MS } from '../core/queues';
import { LegacyStaticScheduler } from '../core/scheduler';
import { CANONICAL_5QI_BEARERS, evaluate5QiBearerSlaMetrics } from '../core/qosSlaEngine';
import { MODCOD_TABLE, type LinkStatus } from '../core/linkBudget';
import { NodeTerrainState, type PredictiveState } from '../core/trajectory';
import { dissectTdmaSlotAllocation, getModcodIdentifier } from '../core/pduDissector';
import { getReferenceConstellation } from '../core/vsaConstellationEngine';
import {
  EventSourcedFlightRecorder,
  parseFlightRecordingJson,
  replayFlightRecordingHeadless,
} from '../core/flightRecorder';
import { runSingleHeadlessTrial } from '../core/batchSimulationRunner';
import { SimulationWorkerManager } from '../worker/simWorker';
import type { TelemetryFrame, TelemetryFrameMessage, WorkerInboundCommand } from '../shared/workerProtocol';

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

describe('MAC Schedulers, 3GPP 5QI SLA, ETSI 64-APSK, PDU Dissector & Flight Recorder', () => {
  it('enforces LegacyStaticScheduler last-known LOS outage fairness across single/multi-sector and reset', () => {
    for (const multiSector of [false, true]) {
      const sched = new LegacyStaticScheduler();
      sched.enableMultiSector = multiSector;
      const node = new GroundNodeTrafficSubsystem(1, 'soldier', [1000, 0, 3000], 11);
      for (let i = 0; i < 40; i++) {
        node.enqueuePacket(70, 0.0, 1400, 10.0);
      }

      const losLinks = new Map<number, LinkStatus>([
        [1, makeLink({ bitrateBps: 1.0e6, bitrateMbps: 1.0, modcodName: 'QPSK 1/2', activeSectorId: 0 })],
      ]);
      const preds = new Map<number, PredictiveState>([[1, makePred()]]);

      const rLos = sched.scheduleFrame(0, 0.0, [node], losLinks, preds);
      expect(rLos.totalBitsTransmitted).toBeGreaterThan(0);

      const outageLinks = new Map<number, LinkStatus>([
        [1, makeLink({ bitrateBps: 0, bitrateMbps: 0, modcodName: 'LINK_OUTAGE', isOutage: true, activeSectorId: 0 })],
      ]);
      const rOutage = sched.scheduleFrame(1, 0.02, [node], outageLinks, preds);
      expect(rOutage.totalBitsWastedOnOutage).toBeGreaterThan(0);
      expect(rOutage.totalBitsWastedOnOutage).toBeLessThanOrEqual(16500);
      expect(rOutage.allocations[0].capacityBits).toBeLessThanOrEqual(16500);

      sched.reset();
      const coldNode = new GroundNodeTrafficSubsystem(2, 'soldier', [1000, 0, 3000], 12);
      for (let i = 0; i < 40; i++) {
        coldNode.enqueuePacket(70, 0.0, 1400, 10.0);
      }
      const coldOutageLinks = new Map<number, LinkStatus>([
        [2, makeLink({ bitrateBps: 0, bitrateMbps: 0, modcodName: 'LINK_OUTAGE', isOutage: true, activeSectorId: 0 })],
      ]);
      const rCold = sched.scheduleFrame(2, 0.04, [coldNode], coldOutageLinks, new Map([[2, makePred()]]));
      expect(rCold.totalBitsWastedOnOutage).toBeGreaterThan(0);
      expect(rCold.totalBitsWastedOnOutage).toBeLessThanOrEqual(16500);
    }
  });

  it('maintains variable TDMA (10/20/40 ms) offered-load invariance and 20 ms determinism', () => {
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
        node.queue.dequeue(100_000, t);
      }
      return perStepBytes;
    };

    const trace10 = simulateOfferedBytes(0.010, 77);
    const trace20A = simulateOfferedBytes(0.020, 77);
    const trace20B = simulateOfferedBytes(0.020, 77);
    const trace40 = simulateOfferedBytes(0.040, 77);

    expect(trace20A).toEqual(trace20B);
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    const total10 = sum(trace10);
    const total20 = sum(trace20A);
    const total40 = sum(trace40);
    expect(Math.abs(total10 - total20) / total20).toBeLessThan(0.1);
    expect(Math.abs(total40 - total20) / total20).toBeLessThan(0.1);
  });

  it('shares canonical 3GPP 5QI PDBs and detects live HoL sojourn SLA violations', () => {
    const expectedPdbMs: Record<number, number> = { 69: 60.0, 65: 75.0, 67: 150.0, 70: 300.0 };
    for (const bearer of CANONICAL_5QI_BEARERS) {
      expect(bearer.pdbMs).toBe(expectedPdbMs[bearer.qos5qi]);
      expect(CANONICAL_5QI_PDB_MS[bearer.qos5qi as 69 | 65 | 67 | 70]).toBe(expectedPdbMs[bearer.qos5qi]);
      expect(QOS_PROFILES[bearer.qos5qi].pdbS * 1000.0).toBe(bearer.pdbMs);
    }
    expect(QOS_PROFILES[69].hardDropTtlS).toBe(60.0);

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
      sim.handleMessage({ type: 'INJECT_TRAFFIC', node_id: 4, traffic_type: 'SOS' });
      sim.handleMessage({ type: 'INJECT_TRAFFIC', node_id: 4, traffic_type: 'VOICE' });
      sim.handleMessage({ type: 'NODE_UPDATE', node_id: 4, x_m: 120000, y_m: 120000, agl_m: 1.0 });
      for (let f = 0; f < 10; f++) {
        sim.tickSimulation(f === 9);
      }

      const frame = capturedFrames[capturedFrames.length - 1];
      const n4 = frame.nodes_telemetry.find((n) => n.node_id === 4);
      expect(n4?.bearer_hol_delay_ms).toBeDefined();
      expect((n4!.bearer_hol_delay_ms!.c2_ms > 60.0) || (n4!.bearer_hol_delay_ms!.voice_ms > 0)).toBe(true);

      const sla = evaluate5QiBearerSlaMetrics(frame.nodes_telemetry, frame.active_gantt_allocations);
      const c2Bearer = sla.bearers.find((b) => b.qos5qi === 69)!;
      expect(c2Bearer.estimatedMaxSojournMs).toBeGreaterThanOrEqual(n4!.bearer_hol_delay_ms!.c2_ms - 1e-6);
      if (n4!.bearer_hol_delay_ms!.c2_ms > 60.0) {
        expect(c2Bearer.slaVerdict).toBe('SLA_BREACHED');
        expect(sla.overallSlaCompliancePct).toBeLessThan(100.0);
      }
    } finally {
      if (prevSelf === undefined) delete (globalThis as { self?: unknown }).self;
      else (globalThis as { self?: unknown }).self = prevSelf;
    }
  });

  it('validates ETSI EN 302 307-2 4-ring 64-APSK (4+12+20+28, unit power) and pduDissector hyphenated MODCOD mapping', () => {
    const pts64Apsk = getReferenceConstellation('64-APSK 5/6');
    expect(pts64Apsk).toHaveLength(64);
    let sumEnergy = 0;
    const ringCounts = new Map<string, number>();
    for (const pt of pts64Apsk) {
      const r2 = pt.i * pt.i + pt.q * pt.q;
      sumEnergy += r2;
      const rKey = Math.sqrt(r2).toFixed(5);
      ringCounts.set(rKey, (ringCounts.get(rKey) ?? 0) + 1);
    }
    expect(Math.abs(sumEnergy / pts64Apsk.length - 1.0)).toBeLessThanOrEqual(1e-6);
    const sortedCounts = Array.from(ringCounts.entries())
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
      .map(([, count]) => count);
    expect(sortedCounts).toEqual([4, 12, 20, 28]);

    const tiers = [...MODCOD_TABLE.map((m) => m.name), 'π/2-BPSK 1/3', '8-PSK 3/4'];
    for (const name of tiers) {
      const idZero = getModcodIdentifier(name, 0.0);
      const idHigh = getModcodIdentifier(name, 99.0);
      expect(idZero).toBe(idHigh);
      const pdu = dissectTdmaSlotAllocation({ nodeId: 1, capacityBits: 4096, modcodName: name, spectralEfficiency: 0.0 });
      const hexBytes = pdu.hexHeaderDump.split(' ');
      expect(parseInt(hexBytes[4], 16)).toBe(idZero);
    }
    const tableIds = new Set(MODCOD_TABLE.map((m) => getModcodIdentifier(m.name, 0.0)));
    expect(tableIds.size).toBe(MODCOD_TABLE.length);
  });

  it('records EventSourcedFlightRecorder commands and replays bit-exactly headless', () => {
    const recorder = new EventSourcedFlightRecorder({
      seed: 42,
      initialBiomeId: 'alpine_mountain',
      createdUtcIso: '2026-11-26T00:00:00.000Z',
    });
    const liveMgr = new SimulationWorkerManager(42, '16_NODES');
    const dispatch = (cmd: WorkerInboundCommand, tick: number, simTimeS: number): void => {
      recorder.recordCommand(cmd, tick, simTimeS);
      liveMgr.handleMessage(cmd);
    };

    dispatch({ type: 'SET_TELEMETRY_PROFILE', subscriptions: { linkProfile: true }, uiPublishIntervalTicks: 1 }, 0, 0);
    expect(recorder.getEventCount()).toBe(0);

    for (let tick = 1; tick <= 60; tick++) {
      liveMgr.tickSimulation(true);
      if (liveMgr.lastTelemetryFrame) recorder.observeFrame(liveMgr.lastTelemetryFrame);
      if (tick === 20) {
        dispatch({ type: 'SET_BIOME', biomeId: 'arid_desert', dustVisibilityKm: 6.5, enableBiomeEmPhysics: true }, tick, liveMgr.simTimeS);
      } else if (tick === 40) {
        dispatch({ type: 'CONFIG_UPDATE', rain_rate_mmh: 18.0, traffic_load_multiplier: 1.5 }, tick, liveMgr.simTimeS);
      }
    }

    const recJson = recorder.toJson(false);
    const parsedRec = parseFlightRecordingJson(recJson);
    expect(parsedRec.events).toHaveLength(2);
    expect(() => parseFlightRecordingJson(recJson.slice(0, -1) + ',"__proto__":{"polluted":true}}')).toThrow(/prototype pollution/i);

    const replay = replayFlightRecordingHeadless(parsedRec, (rec) => new SimulationWorkerManager(rec.seed, '16_NODES'));
    expect(replay.ok).toBe(true);
    expect(replay.actualDigest).toBe(parsedRec.finalStateDigestHex);
  });

  it('produces bit-identical runSingleHeadlessTrial determinism and measurable RF sensitivity', () => {
    const runA = runSingleHeadlessTrial({ seed: 42, durationS: 0.4 });
    const runB = runSingleHeadlessTrial({ seed: 42, durationS: 0.4 });
    expect(runA.ticks).toBe(20);
    expect(runA.finalStateDigestHex).toBe(runB.finalStateDigestHex);
    expect(runA.staticGoodputMbps).toBe(runB.staticGoodputMbps);
    expect(runA.tacGoodputMbps).toBe(runB.tacGoodputMbps);
    expect(runA.meanSnrDb).toBe(runB.meanSnrDb);

    const jammed = runSingleHeadlessTrial({ seed: 42, durationS: 0.4, jammerEnabled: true });
    expect(jammed.meanSnrDb).toBeLessThan(runA.meanSnrDb);
    expect(jammed.finalStateDigestHex).not.toBe(runA.finalStateDigestHex);
  });
});
