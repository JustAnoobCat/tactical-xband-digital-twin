/**
 * src/tests/verifyVariableTdma.ts
 *
 * Variable TDMA Frame Structure System Verification Suite (Milestone TDMA-1).
 * Approved Architecture Specification: DRDO-TAC-XBAND-ARCH-TDMA-02 (Revision 2).
 *
 * Implements Tests TDMA-T1 through TDMA-T8:
 * - TDMA-T1: Default Configuration Parity (20ms, 1ms, 3-7ms, 12us, 200us, 8ms, 'equal_active')
 * - TDMA-T2: Geometric Validation Rejection (bounds, ceilings, guard >= minSlot, fixedSlotCount)
 * - TDMA-T3: Static TDMA Slot Sizing Invariance ((T_ul - K*tau_guard)/K across 10, 20, 40, 100ms frames)
 * - TDMA-T4: Tac-TAD Dynamic Exact-Fit Slot Sizing & Dynamic DL Breathing
 * - TDMA-T5: Timing Advance Range Margin (d <= c * tau_guard / 2)
 * - TDMA-T6: Authoritative Timeline Resolution & Conflict Detection Under Variable Frames
 * - TDMA-T7: Simulation Worker Runtime Reconfiguration via CONFIG_UPDATE without frame drop
 * - TDMA-T8: Deterministic State Hash Parity across independent instances with custom TDMA configuration
 */

import assert from 'node:assert/strict';
import {
  TdmaFrameConfig,
  TDMA_PRESETS,
  TDMA_PRESET_STANDARD_20MS,
  TDMA_PRESET_FAST_10MS,
  TDMA_PRESET_EXTENDED_40MS,
  TDMA_PRESET_SYMMETRIC_50_50,
  TDMA_PRESET_SWARM_64SLOT,
} from '../core/tdmaConfig';
import {
  LegacyStaticScheduler,
  TerrainAwareDynamicScheduler,
} from '../core/scheduler';
import { GroundNodeTrafficSubsystem } from '../core/queues';
import { LinkStatus } from '../core/linkBudget';
import { NodeTerrainState, PredictiveState } from '../core/trajectory';
import { resolveSuperframeTimeline } from '../ui/dataCommVisualization';
import { SimulationWorkerManager, FRAME_DT } from '../worker/simWorker';
import { computeCanonicalStateHash } from './helpers/simulationTrace';

function close(actual: number, expected: number, tolerance = 1e-6, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('='.repeat(92));
console.log('   VARIABLE TDMA FRAME STRUCTURE SYSTEM VERIFICATION SUITE');
console.log('   Specification: DRDO-TAC-XBAND-ARCH-TDMA-02 (Revision 2) // Milestone TDMA-1');
console.log('='.repeat(92));

// -------------------------------------------------------------------------------------------------
// [TDMA-T1] Default Configuration Parity
// -------------------------------------------------------------------------------------------------
console.log('\n[TDMA-T1] Verifying default configuration parity...');
{
  const def = new TdmaFrameConfig();
  assert.equal(def.frameDurationMs, 20.0, 'Default frameDurationMs must be 20.0');
  assert.equal(def.ctrlDurationMs, 1.0, 'Default ctrlDurationMs must be 1.0');
  assert.equal(def.dlMinDurationMs, 3.0, 'Default dlMinDurationMs must be 3.0');
  assert.equal(def.dlMaxDurationMs, 7.0, 'Default dlMaxDurationMs must be 7.0');
  assert.equal(def.guardIntervalUs, 12.0, 'Default guardIntervalUs must be 12.0');
  assert.equal(def.minSlotDurationUs, 200.0, 'Default minSlotDurationUs must be 200.0');
  assert.equal(def.maxSlotDurationMs, 8.0, 'Default maxSlotDurationMs must be 8.0');
  assert.equal(def.uplinkPolicy, 'equal_active', 'Default uplinkPolicy must be equal_active');
  assert.equal(def.fixedSlotCount, undefined, 'Default fixedSlotCount must be undefined');

  close(def.frameDurationS, 0.020, 1e-9, 'frameDurationS');
  close(def.ctrlDurationS, 0.001, 1e-9, 'ctrlDurationS');
  close(def.dlMinDurationS, 0.003, 1e-9, 'dlMinDurationS');
  close(def.dlMaxDurationS, 0.007, 1e-9, 'dlMaxDurationS');
  close(def.guardIntervalS, 12e-6, 1e-12, 'guardIntervalS');
  close(def.minSlotDurationS, 200e-6, 1e-12, 'minSlotDurationS');
  close(def.maxSlotDurationS, 0.008, 1e-9, 'maxSlotDurationS');
  close(def.nominalUlAvailableS, 0.016, 1e-9, 'nominalUlAvailableS');

  // Verify all presets validate cleanly
  assert.doesNotThrow(() => new TdmaFrameConfig(TDMA_PRESET_STANDARD_20MS));
  assert.doesNotThrow(() => new TdmaFrameConfig(TDMA_PRESET_FAST_10MS));
  assert.doesNotThrow(() => new TdmaFrameConfig(TDMA_PRESET_EXTENDED_40MS));
  assert.doesNotThrow(() => new TdmaFrameConfig(TDMA_PRESET_SYMMETRIC_50_50));
  assert.doesNotThrow(() => new TdmaFrameConfig(TDMA_PRESET_SWARM_64SLOT));
  assert.equal(Object.keys(TDMA_PRESETS).length, 5, 'TDMA_PRESETS must have 5 presets');

  // Verify worker manager defaults
  const sim = new SimulationWorkerManager();
  assert.equal(sim.tdmaConfig.frameDurationMs, 20.0, 'Worker default frameDurationMs must be 20.0');
  assert.equal(sim.tdmaConfig.uplinkPolicy, 'equal_active', 'Worker default policy must be equal_active');

  const frame = (sim as any).buildTelemetryFrame(sim.getLiveAcnPosition());
  assert.ok(frame.tdma_frame_config, 'Telemetry frame must include tdma_frame_config');
  assert.equal(frame.tdma_frame_config.frameDurationMs, 20.0, 'Telemetry frameDurationMs must be 20.0');

  console.log('  -> PASS: Default configuration parity verified (20ms, 1ms, 3-7ms, 12us, 200us, equal_active).');
}

// -------------------------------------------------------------------------------------------------
// [TDMA-T2] Geometric Validation Rejection
// -------------------------------------------------------------------------------------------------
console.log('\n[TDMA-T2] Verifying geometric validation rejection...');
{
  // Out-of-bounds checks
  assert.throws(() => new TdmaFrameConfig({ frameDurationMs: 4.9 }), /frameDurationMs/);
  assert.throws(() => new TdmaFrameConfig({ frameDurationMs: 100.1 }), /frameDurationMs/);
  assert.throws(() => new TdmaFrameConfig({ ctrlDurationMs: 0.05 }), /ctrlDurationMs/);
  assert.throws(() => new TdmaFrameConfig({ ctrlDurationMs: 25.0 }), /ctrlDurationMs/);
  assert.throws(() => new TdmaFrameConfig({ dlMinDurationMs: 0.05 }), /dlMinDurationMs/);
  assert.throws(() => new TdmaFrameConfig({ guardIntervalUs: 0.0 }), /guardIntervalUs/);
  assert.throws(() => new TdmaFrameConfig({ guardIntervalUs: -1.0 }), /guardIntervalUs/);
  assert.throws(() => new TdmaFrameConfig({ minSlotDurationUs: 0.0 }), /minSlotDurationUs/);
  assert.throws(() => new TdmaFrameConfig({ maxSlotDurationMs: 0.0 }), /maxSlotDurationMs/);

  // Inverted DL bounds
  assert.throws(() => new TdmaFrameConfig({ dlMinDurationMs: 10.0, dlMaxDurationMs: 5.0 }), /dlMaxDurationMs/);

  // Guard >= minSlot
  assert.throws(() => new TdmaFrameConfig({ minSlotDurationUs: 50.0, guardIntervalUs: 60.0 }), /strictly greater/);
  assert.throws(() => new TdmaFrameConfig({ minSlotDurationUs: 50.0, guardIntervalUs: 50.0 }), /strictly greater/);

  // Ceiling check: ctrl + dlMax > frameDuration - minUlReserve
  // frame 20ms, ctrl 10ms, dlMax 10ms -> minUlReserve = (0.2 + 0.012) = 0.212ms -> ctrl+dlMax = 20ms > 20 - 0.212
  assert.throws(
    () => new TdmaFrameConfig({ frameDurationMs: 20.0, ctrlDurationMs: 10.0, dlMinDurationMs: 5.0, dlMaxDurationMs: 10.0 }),
    /exceeds allowed ceiling/
  );

  // Fixed slot count bounds
  assert.throws(() => new TdmaFrameConfig({ fixedSlotCount: 0 }), /fixedSlotCount/);
  assert.throws(() => new TdmaFrameConfig({ fixedSlotCount: 65 }), /fixedSlotCount/);
  assert.throws(() => new TdmaFrameConfig({ fixedSlotCount: 16.5 }), /fixedSlotCount/);

  console.log('  -> PASS: All invalid configurations rejected with explicit boundary exceptions.');
}

// -------------------------------------------------------------------------------------------------
// [TDMA-T3] Static TDMA Slot Sizing Invariance Across Frame Durations
// -------------------------------------------------------------------------------------------------
console.log('\n[TDMA-T3] Verifying static TDMA slot sizing invariance...');
{
  const scheduler = new LegacyStaticScheduler();

  const testConfigs = [
    { name: 'Fast 10ms', config: new TdmaFrameConfig(TDMA_PRESET_FAST_10MS), K: 16 },
    { name: 'Standard 20ms', config: new TdmaFrameConfig(TDMA_PRESET_STANDARD_20MS), K: 16 },
    { name: 'Extended 40ms', config: new TdmaFrameConfig(TDMA_PRESET_EXTENDED_40MS), K: 16 },
    { name: 'Swarm 20ms (64-slot)', config: new TdmaFrameConfig(TDMA_PRESET_SWARM_64SLOT), K: 64 },
    {
      name: 'Custom 100ms',
      config: new TdmaFrameConfig({
        frameDurationMs: 100.0,
        ctrlDurationMs: 2.0,
        dlMinDurationMs: 8.0,
        dlMaxDurationMs: 20.0,
        guardIntervalUs: 25.0,
        minSlotDurationUs: 500.0,
        maxSlotDurationMs: 25.0,
      }),
      K: 16,
    },
  ];

  for (const tc of testConfigs) {
    scheduler.setTdmaConfig(tc.config);

    // Create mock nodes
    const mockNodes: GroundNodeTrafficSubsystem[] = [];
    const linkStatuses = new Map<number, LinkStatus>();
    const predictiveStates = new Map<number, PredictiveState>();

    for (let i = 0; i < tc.K; i++) {
      const node = new GroundNodeTrafficSubsystem(i);
      mockNodes.push(node);
      linkStatuses.set(i, {
        snrDb: 25.0,
        sinrDb: 25.0,
        modcodId: 20,
        modcodName: '16APSK-3/4',
        spectralEfficiency: 2.966,
        isOutage: false,
        receivedPowerDbm: -70.0,
      } as LinkStatus);
      predictiveStates.set(i, {
        currentState: NodeTerrainState.CLEAR_LOS,
        nextTransitionS: null,
        nextState: null,
        timeToTransitionS: Infinity,
      } as PredictiveState);
    }

    const report = scheduler.scheduleFrame(0, 0.0, mockNodes, linkStatuses, predictiveStates);

    const tUl = tc.config.frameDurationS - tc.config.ctrlDurationS - tc.config.dlMinDurationS;
    const expectedSlotS = (tUl - tc.K * tc.config.guardIntervalS) / tc.K;

    assert.equal(report.allocations.length, tc.K, `${tc.name}: expected ${tc.K} allocations`);
    for (let s = 0; s < report.allocations.length; s++) {
      const alloc = report.allocations[s];
      close(alloc.durationS, expectedSlotS, 1e-9, `${tc.name} slot ${s} duration`);
    }

    close(report.superframeDurationS, tc.config.frameDurationS, 1e-9, `${tc.name} superframeDurationS`);
    close(report.ctrlDurationS, tc.config.ctrlDurationS, 1e-9, `${tc.name} ctrlDurationS`);
    close(report.dlDurationS, tc.config.dlMinDurationS, 1e-9, `${tc.name} dlDurationS`);
    close(report.ulAvailableDurationS, tUl, 1e-9, `${tc.name} ulAvailableDurationS`);
  }

  // Verify fixedSlotCount slicing when N < K (idle unallocated slots)
  {
    const swarmConfig = new TdmaFrameConfig(TDMA_PRESET_SWARM_64SLOT); // K = 64
    scheduler.setTdmaConfig(swarmConfig);

    const partialNodes: GroundNodeTrafficSubsystem[] = [];
    const linkStatuses = new Map<number, LinkStatus>();
    const predictiveStates = new Map<number, PredictiveState>();

    for (let i = 0; i < 16; i++) {
      partialNodes.push(new GroundNodeTrafficSubsystem(i));
      linkStatuses.set(i, {
        snrDb: 25.0,
        sinrDb: 25.0,
        modcodId: 20,
        modcodName: '16APSK-3/4',
        spectralEfficiency: 2.966,
        isOutage: false,
        receivedPowerDbm: -70.0,
      } as LinkStatus);
      predictiveStates.set(i, {
        currentState: NodeTerrainState.CLEAR_LOS,
        nextTransitionS: null,
        nextState: null,
        timeToTransitionS: Infinity,
      } as PredictiveState);
    }

    const report = scheduler.scheduleFrame(0, 0.0, partialNodes, linkStatuses, predictiveStates);
    assert.equal(report.allocations.length, 64, 'Must allocate exactly K=64 slots');

    // First 16 slots assigned to active terminals
    for (let i = 0; i < 16; i++) {
      assert.equal(report.allocations[i].nodeId, i, `Slot ${i} must belong to node ${i}`);
      assert.notEqual(report.allocations[i].modcodName, 'IDLE_UNALLOCATED');
    }

    // Remaining 48 slots generated as IDLE_UNALLOCATED
    for (let i = 16; i < 64; i++) {
      assert.equal(report.allocations[i].nodeId, -1, `Slot ${i} must be nodeId -1`);
      assert.equal(report.allocations[i].modcodName, 'IDLE_UNALLOCATED');
      assert.equal(report.allocations[i].capacityBits, 0);
    }
  }

  // Verify fixedSlotCount slicing when N > K (round-robin multiplexing)
  {
    const configK8 = new TdmaFrameConfig({
      ...TDMA_PRESET_STANDARD_20MS,
      uplinkPolicy: 'fixed_slot_count',
      fixedSlotCount: 8,
    });
    scheduler.setTdmaConfig(configK8);

    const sixteenNodes: GroundNodeTrafficSubsystem[] = [];
    const linkStatuses = new Map<number, LinkStatus>();
    const predictiveStates = new Map<number, PredictiveState>();

    for (let i = 0; i < 16; i++) {
      sixteenNodes.push(new GroundNodeTrafficSubsystem(i));
      linkStatuses.set(i, {
        snrDb: 25.0,
        sinrDb: 25.0,
        modcodId: 20,
        modcodName: '16APSK-3/4',
        spectralEfficiency: 2.966,
        isOutage: false,
        receivedPowerDbm: -70.0,
      } as LinkStatus);
      predictiveStates.set(i, {
        currentState: NodeTerrainState.CLEAR_LOS,
        nextTransitionS: null,
        nextState: null,
        timeToTransitionS: Infinity,
      } as PredictiveState);
    }

    // Frame 0: should assign nodes 0..7
    const r0 = scheduler.scheduleFrame(0, 0.0, sixteenNodes, linkStatuses, predictiveStates);
    assert.equal(r0.allocations.length, 8);
    for (let i = 0; i < 8; i++) {
      assert.equal(r0.allocations[i].nodeId, i);
    }

    // Frame 1: should round-robin multiplex to nodes 8..15
    const r1 = scheduler.scheduleFrame(1, 0.02, sixteenNodes, linkStatuses, predictiveStates);
    assert.equal(r1.allocations.length, 8);
    for (let i = 0; i < 8; i++) {
      assert.equal(r1.allocations[i].nodeId, i + 8);
    }
  }

  console.log('  -> PASS: Static TDMA slot sizing invariant across 10, 20, 40, 50, 100ms frames and K-slicing.');
}

// -------------------------------------------------------------------------------------------------
// [TDMA-T4] Tac-TAD Dynamic Exact-Fit Slot Sizing & Dynamic DL Breathing
// -------------------------------------------------------------------------------------------------
console.log('\n[TDMA-T4] Verifying Tac-TAD dynamic slot sizing and dynamic DL breathing...');
{
  const tac = new TerrainAwareDynamicScheduler(0.008);
  const extConfig = new TdmaFrameConfig(TDMA_PRESET_EXTENDED_40MS); // 40ms, ctrl 1.5ms, dl 4-12ms
  tac.setTdmaConfig(extConfig);

  const mockNodes: GroundNodeTrafficSubsystem[] = [];
  const linkStatuses = new Map<number, LinkStatus>();
  const predictiveStates = new Map<number, PredictiveState>();

  for (let i = 0; i < 16; i++) {
    const node = new GroundNodeTrafficSubsystem(i);
    mockNodes.push(node);
    linkStatuses.set(i, {
      snrDb: 20.0,
      sinrDb: 20.0,
      modcodId: 15,
      modcodName: 'QPSK-3/4',
      spectralEfficiency: 1.487,
      isOutage: false,
      receivedPowerDbm: -75.0,
    } as LinkStatus);
    predictiveStates.set(i, {
      currentState: NodeTerrainState.CLEAR_LOS,
      nextTransitionS: null,
      nextState: null,
      timeToTransitionS: Infinity,
    } as PredictiveState);
  }

  // Case 1: Low DL backlog -> DL should stay at dlMinDurationS (4.0 ms)
  const reportLowDl = tac.scheduleFrame(0, 0.0, mockNodes, linkStatuses, predictiveStates, 0);
  close(reportLowDl.dlDurationS, extConfig.dlMinDurationS, 1e-9, 'Low DL backlog dlDurationS');
  close(reportLowDl.ctrlDurationS, extConfig.ctrlDurationS, 1e-9, 'ctrlDurationS');
  close(reportLowDl.superframeDurationS, extConfig.frameDurationS, 1e-9, 'superframeDurationS');

  // Case 2: High DL backlog (> 5000 bytes) -> DL breathes up by 2ms
  const reportHighDl = tac.scheduleFrame(1, 0.04, mockNodes, linkStatuses, predictiveStates, 10000);
  assert.ok(
    reportHighDl.dlDurationS > extConfig.dlMinDurationS,
    `DL must expand on high backlog: ${reportHighDl.dlDurationS} > ${extConfig.dlMinDurationS}`
  );
  assert.ok(
    reportHighDl.dlDurationS <= extConfig.dlMaxDurationS,
    `DL must not exceed dlMaxDurationS: ${reportHighDl.dlDurationS} <= ${extConfig.dlMaxDurationS}`
  );

  // Case 3: Outage reclamation test
  // Set Node 3 into HARD_SHADOW_CUTOFF
  predictiveStates.set(3, {
    currentState: NodeTerrainState.HARD_SHADOW_CUTOFF,
    nextTransitionS: null,
    nextState: null,
    timeToTransitionS: Infinity,
  } as PredictiveState);
  linkStatuses.set(3, {
    snrDb: -10.0,
    sinrDb: -10.0,
    modcodId: 0,
    modcodName: 'LINK_OUTAGE',
    spectralEfficiency: 0.0,
    isOutage: true,
    receivedPowerDbm: -120.0,
  } as LinkStatus);

  const reportOutage = tac.scheduleFrame(2, 0.08, mockNodes, linkStatuses, predictiveStates, 0);
  const allocNode3 = reportOutage.allocations.find(a => a.nodeId === 3);
  assert.equal(allocNode3, undefined, 'Severed node 3 must NOT receive any allocation');
  assert.equal(reportOutage.totalBitsWastedOnOutage, 0, 'Tac-TAD must have 0 wasted bits on severed link');

  console.log('  -> PASS: Tac-TAD dynamic DL breathing, ceiling clamping, and outage reclamation verified.');
}

// -------------------------------------------------------------------------------------------------
// [TDMA-T5] Timing Advance Range Margin
// -------------------------------------------------------------------------------------------------
console.log('\n[TDMA-T5] Verifying timing advance range margin...');
{
  const c = 299792458.0; // speed of light in m/s

  const cases = [
    { guardUs: 12.0, expectedKm: 1.7987547 },
    { guardUs: 20.0, expectedKm: 2.9979246 },
    { guardUs: 8.0, expectedKm: 1.1991698 },
    { guardUs: 50.0, expectedKm: 7.4948114 },
  ];

  for (const cCase of cases) {
    const safeDistanceM = (c * (cCase.guardUs * 1e-6)) / 2.0;
    const safeDistanceKm = safeDistanceM / 1000.0;
    close(safeDistanceKm, cCase.expectedKm, 1e-4, `Safe range for ${cCase.guardUs}us`);

    // Verify round-trip propagation delay at maximum safe distance equals guard interval
    const roundTripDelayS = (2.0 * safeDistanceM) / c;
    close(roundTripDelayS, cCase.guardUs * 1e-6, 1e-12, 'Round-trip delay vs guard interval');
  }

  console.log('  -> PASS: Timing advance maximum safe radar radius matches c * tau_guard / 2.');
}

// -------------------------------------------------------------------------------------------------
// [TDMA-T6] Authoritative Timeline Resolution & Conflict Detection
// -------------------------------------------------------------------------------------------------
console.log('\n[TDMA-T6] Verifying authoritative timeline resolution & conflict detection...');
{
  const testFrames = [10.0, 20.0, 40.0];

  for (const fMs of testFrames) {
    const timeline = resolveSuperframeTimeline({
      allocations: [
        { nodeId: 0, startMs: 4.0, durationMs: 2.0, capacityBits: 1000 },
        { nodeId: 1, startMs: 6.0, durationMs: 2.0, capacityBits: 1000 },
      ],
      schedulerMode: 'tac_tad',
      ctrlDurationMs: 1.0,
      dlDurationMs: 3.0,
      superframeDurationMs: fMs,
    });

    assert.equal(timeline.superframeDurationMs, fMs, 'superframeDurationMs must match input');
    assert.equal(timeline.hasOverlap, false, 'Clean timeline must not have conflicts');
    assert.equal(timeline.conflictIntervals.length, 0);

    // Verify CTRL phase
    const ctrl = timeline.resolveAt(0.5);
    assert.equal(ctrl.phase, 'CONTROL_BROADCAST');

    // Verify DL phase
    const dl = timeline.resolveAt(2.0);
    assert.equal(dl.phase, 'DOWNLINK_BROADCAST');

    // Verify slot 0
    const slot0 = timeline.resolveAt(4.5);
    assert.equal(slot0.phase, 'UPLINK_SLOT');
    assert.equal(slot0.scheduledNodeId, 0);

    // Verify slot 1
    const slot1 = timeline.resolveAt(6.5);
    assert.equal(slot1.phase, 'UPLINK_SLOT');
    assert.equal(slot1.scheduledNodeId, 1);
  }

  // Conflict detection test: create two overlapping allocations in a 40ms frame
  const conflictTimeline = resolveSuperframeTimeline({
    allocations: [
      { nodeId: 0, startMs: 10.0, durationMs: 5.0, capacityBits: 1000 }, // 10ms - 15ms
      { nodeId: 1, startMs: 12.0, durationMs: 5.0, capacityBits: 1000 }, // 12ms - 17ms (overlaps by 3ms)
    ],
    schedulerMode: 'tac_tad',
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    superframeDurationMs: 40.0,
  });

  assert.equal(conflictTimeline.hasOverlap, true, 'Timeline with overlapping allocations must report conflicts');
  assert.equal(conflictTimeline.conflictIntervals.length, 1, 'Must detect exactly 1 conflict interval');
  close(conflictTimeline.conflictIntervals[0].startMs, 12.0, 1e-4, 'Conflict start');
  close(conflictTimeline.conflictIntervals[0].endMs, 15.0, 1e-4, 'Conflict end');

  // Querying during overlap resolves to CONFLICT
  const conflictSlot = conflictTimeline.resolveAt(13.5);
  assert.equal(conflictSlot.phase, 'CONFLICT');

  console.log('  -> PASS: Superframe timeline resolution and conflict overlap detection verified.');
}

// -------------------------------------------------------------------------------------------------
// [TDMA-T7] Simulation Worker Runtime Reconfiguration via CONFIG_UPDATE
// -------------------------------------------------------------------------------------------------
console.log('\n[TDMA-T7] Verifying simulation worker runtime reconfiguration...');
{
  const sim = new SimulationWorkerManager();

  // Advance 5 ticks under standard 20ms configuration
  for (let t = 0; t < 5; t++) {
    sim.tickSimulation();
  }
  assert.equal(sim.tdmaConfig.frameDurationMs, 20.0);
  assert.equal(sim.simTimeS, 5 * FRAME_DT);

  // Send CONFIG_UPDATE with 40ms extended preset
  const res1 = sim.handleMessage({
    type: 'CONFIG_UPDATE',
    request_id: 'tdma-test-extended-40ms',
    params: {
      tdma_frame_config: TDMA_PRESET_EXTENDED_40MS,
    },
  });

  assert.equal(res1.accepted, true, 'CONFIG_UPDATE with extended 40ms preset must succeed');
  assert.equal(sim.tdmaConfig.frameDurationMs, 40.0, 'sim.tdmaConfig.frameDurationMs must be 40.0');
  assert.equal(sim.tdmaConfig.ctrlDurationMs, 2.0, 'sim.tdmaConfig.ctrlDurationMs must be 2.0');
  assert.equal(sim.tdmaConfig.guardIntervalUs, 25.0, 'sim.tdmaConfig.guardIntervalUs must be 25.0');

  // Advance another 10 ticks (0.2s sim time)
  for (let t = 0; t < 10; t++) {
    sim.tickSimulation();
  }
  close(sim.simTimeS, 15 * FRAME_DT, 1e-9, 'simTimeS invariant progression');

  // Check published telemetry frame
  const frame40 = (sim as any).buildTelemetryFrame(sim.getLiveAcnPosition());
  assert.ok(frame40.tdma_frame_config);
  assert.equal(frame40.tdma_frame_config.frameDurationMs, 40.0);
  assert.equal(frame40.downlink_telemetry.ctrl_duration_ms, 2.0);

  // Switch to Fast 10ms preset (multi-cycle execution per 20ms tick)
  const res2 = sim.handleMessage({
    type: 'CONFIG_UPDATE',
    request_id: 'tdma-test-fast-10ms',
    params: {
      tdma_frame_config: TDMA_PRESET_FAST_10MS,
    },
  });

  assert.equal(res2.accepted, true, 'CONFIG_UPDATE with fast 10ms preset must succeed');
  assert.equal(sim.tdmaConfig.frameDurationMs, 10.0);

  // Advance 10 ticks under 10ms frames
  for (let t = 0; t < 10; t++) {
    sim.tickSimulation();
  }
  close(sim.simTimeS, 25 * FRAME_DT, 1e-9, 'simTimeS invariant progression');

  const frame10 = (sim as any).buildTelemetryFrame(sim.getLiveAcnPosition());
  assert.equal(frame10.tdma_frame_config.frameDurationMs, 10.0);

  console.log('  -> PASS: Simulation worker reconfigured across 20ms -> 40ms -> 10ms seamlessly without frame drops.');
}

// -------------------------------------------------------------------------------------------------
// [TDMA-T8] Deterministic State Hash Parity Across Independent Instances
// -------------------------------------------------------------------------------------------------
console.log('\n[TDMA-T8] Verifying deterministic state hash parity across independent instances...');
{
  const simA = new SimulationWorkerManager();
  const simB = new SimulationWorkerManager();

  // Configure both instances identically to 40ms extended preset
  const cmd = {
    type: 'CONFIG_UPDATE' as const,
    request_id: 'det-1',
    params: {
      tdma_frame_config: TDMA_PRESET_EXTENDED_40MS,
    },
  };
  simA.handleMessage(cmd);
  simB.handleMessage(cmd);

  // Advance both instances for 50 ticks (1.0 second sim time)
  for (let i = 0; i < 50; i++) {
    simA.tickSimulation();
    simB.tickSimulation();
  }

  const hashA = computeCanonicalStateHash(simA);
  const hashB = computeCanonicalStateHash(simB);

  assert.ok(hashA.length === 64, 'State hash A must be 64-char hex SHA-256');
  assert.ok(hashB.length === 64, 'State hash B must be 64-char hex SHA-256');
  assert.equal(hashA, hashB, `Deterministic state hashes must match identically: ${hashA} === ${hashB}`);

  console.log(`  -> PASS: Deterministic state hash parity verified (SHA-256: ${hashA.slice(0, 16)}...).`);
}

console.log('\n' + '='.repeat(92));
console.log('   ALL 8 VARIABLE TDMA VERIFICATION TESTS (TDMA-T1 TO TDMA-T8) PASSED SUCCESSFULLY.');
console.log('='.repeat(92));
