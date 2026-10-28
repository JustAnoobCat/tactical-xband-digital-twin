/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Scheduler & Trajectory Verification Suite (TypeScript Port)
 *
 * Verifies:
 * 1. ACN constant true airspeed along rotated ellipse: 60.0 m/s (+/- 1.0 m/s).
 * 2. Multi-class strict priority (69->65->67->70), C2 ceiling, and deadline pruning.
 * 3. Static TDMA slot sizing: exactly 988 us (accounting for 16 * 12 us TA guards).
 * 4. Tac-TAD dynamic outage reclamation: 0.0s assigned to severed node, slot reclaimed.
 * 5. 100-Frame comparative simulation: Tac-TAD gain >= 1.5x and 0.0% severed-link waste.
 *
 * Execution:
 *   npx ts-node src/tests/verifyScheduler.ts
 *   (or: npx tsx src/tests/verifyScheduler.ts)
 */

import { ACNFlightConfig, EnvironmentConfig, RFConfig } from '../core/config';
import { LinkBudgetEngine, LinkStatus } from '../core/linkBudget';

declare const process: {
  exit(code?: number): never;
};

import {
  FQCoDelQueue,
  GroundNodeTrafficSubsystem,
  Packet,
} from '../core/queues';
import {
  LegacyStaticScheduler,
  TerrainAwareDynamicScheduler,
  T_UL_NOMINAL_S,
  TAU_GUARD_S,
} from '../core/scheduler';
import { TerrainEngine } from '../core/terrain';
import {
  ACNTrajectoryEngine,
  NodeTerrainState,
  PredictiveState,
} from '../core/trajectory';

interface TestResult {
  readonly name: string;
  readonly measured: string;
  readonly criteria: string;
  readonly passed: boolean;
}

function testOrbitKinematics(): TestResult {
  const flightConfig = new ACNFlightConfig({
    loiterRadiusAM: 20000.0,
    loiterRadiusBM: 10000.0,
    loiterRotationDeg: 35.0,
    loiterSpeedMps: 60.0,
  });
  const trajectoryEngine = new ACNTrajectoryEngine(flightConfig);

  const testTimes = [0.0, 50.0, 150.0, 500.0, 1000.0];
  let maxDeviation = 0.0;

  for (const t of testTimes) {
    const [vx, vy] = trajectoryEngine.getAcnVelocity(t);
    const speed = Math.hypot(vx, vy);
    const dev = Math.abs(speed - 60.0);
    if (dev > maxDeviation) maxDeviation = dev;
  }

  const passed = maxDeviation <= 1.0;
  return {
    name: '1. ACN Rotated Ellipse Kinematics (60 m/s)',
    measured: `Max Speed Dev = ${maxDeviation.toFixed(3)} m/s`,
    criteria: '|v - 60.0| <= 1.0 m/s',
    passed,
  };
}

function testQueuePriorityAndEviction(): TestResult {
  const q = new FQCoDelQueue(400, 120);
  const now = 10.0;

  // Enqueue in reverse priority order
  q.enqueue(new Packet(1, 1, 70, 1400, now, now + 0.5));
  q.enqueue(new Packet(2, 1, 67, 1200, now, now + 0.15));
  q.enqueue(new Packet(3, 1, 65, 160, now, now + 0.075));
  q.enqueue(new Packet(4, 1, 69, 128, now, now + 60.0));

  // Dequeue with capacity for 2 packets
  const dequeued = q.dequeue(128 + 160, now);
  const strictPriorityOk =
    dequeued.length === 2 && dequeued[0].qos5qi === 69 && dequeued[1].qos5qi === 65;

  // Bounded C2 capacity check (max 120 packets)
  const c2Queue = new FQCoDelQueue(400, 120);
  for (let i = 0; i < 150; i++) {
    c2Queue.enqueue(new Packet(100 + i, 1, 69, 128, now, now + 60.0));
  }
  const c2CeilingOk =
    c2Queue.getClassPacketCount(69) === 120 && c2Queue.droppedOverflowCount === 30;

  // Deadline pruning check (69 must be exempt)
  const pruneQueue = new FQCoDelQueue(400, 120);
  pruneQueue.enqueue(new Packet(201, 1, 65, 160, now, now + 0.075));
  pruneQueue.enqueue(new Packet(202, 1, 69, 128, now, now + 60.0));
  const pruned = pruneQueue.pruneExpiredPackets(now + 1.0); // 1.0s elapsed
  const pruneOk =
    pruned.length === 1 &&
    pruned[0].qos5qi === 65 &&
    pruneQueue.getClassPacketCount(69) === 1;

  const passed = strictPriorityOk && c2CeilingOk && pruneOk;
  return {
    name: '2. Multi-Class Strict Priority & C2 Ceiling',
    measured: `Priority=${strictPriorityOk}, C2Cap=${c2CeilingOk}, Prune=${pruneOk}`,
    criteria: '69->65->67->70 order, C2 ceiling=120, C2 prune exempt',
    passed,
  };
}

function testStaticSlotArithmetic(): TestResult {
  const staticSched = new LegacyStaticScheduler();
  const nodes = Array.from(
    { length: 16 },
    (_, i) => new GroundNodeTrafficSubsystem(i, i === 15 ? 'mcp' : 'soldier', [0, 0, 3000])
  );

  const links: Record<number, LinkStatus> = {};
  const preds: Record<number, PredictiveState> = {};
  for (let i = 0; i < 16; i++) {
    links[i] = {
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
      snrDb: 24.87,
      modcodName: '64-APSK 5/6',
      spectralEfficiency: 4.95,
      bitrateBps: 4.95e6,
      bitrateMbps: 4.95,
      isOutage: false,
    };
    preds[i] = {
      currentState: NodeTerrainState.NORMAL_LOS,
      timeToOcclusionS: Number.POSITIVE_INFINITY,
      timeToEmergenceS: 0,
      fresnelClearanceM: 50,
      fresnelRateOfChangeMps: 0,
      predictedOutageDurationS: 0,
    };
  }

  const report = staticSched.scheduleFrame(0, 0.0, nodes, links, preds);
  const expectedSlotS = (T_UL_NOMINAL_S - 16 * TAU_GUARD_S) / 16; // 0.000988 s
  const allocSlotS = report.allocations[0].durationS;
  const dev = Math.abs(allocSlotS - expectedSlotS);

  const passed = dev < 1e-6 && Math.abs(allocSlotS - 0.000988) < 1e-6;
  return {
    name: '3. Static TDMA Slot Sizing (16 Terminals)',
    measured: `tau_slot = ${(allocSlotS * 1e6).toFixed(1)} us`,
    criteria: 'Exactly 988.0 us (+/- 1 us) accounting for 16*12us guard',
    passed,
  };
}

function testDynamicOutageReclamation(): TestResult {
  const dynamicSched = new TerrainAwareDynamicScheduler(0.008);
  const nodes = Array.from(
    { length: 16 },
    (_, i) => new GroundNodeTrafficSubsystem(i, i === 15 ? 'mcp' : 'soldier', [0, 0, 3000])
  );

  // Terminal 4 has data, but is severed behind mountain rock
  nodes[4].enqueuePacket(70, 0.0, 5000);
  // Terminal 15 has data and has clear line-of-sight
  nodes[15].enqueuePacket(67, 0.0, 10000);

  const links: Record<number, LinkStatus> = {};
  const preds: Record<number, PredictiveState> = {};
  for (let i = 0; i < 16; i++) {
    links[i] = {
      nodeType: i === 15 ? 'mcp' : 'soldier',
      slantRangeM: 15000,
      fsplDb: 134,
      diffractionLossDb: i === 4 ? 45.0 : 0.0,
      gasLossDb: 0.1,
      rainLossDb: 0,
      cableLossDb: 1.5,
      implementationMarginDb: 2.5,
      totalLossDb: 138.1,
      pTxDbm: 36,
      txGainDbi: 3,
      rxGainDbi: 15,
      prxDbm: i === 4 ? -129 : -84.1,
      pNoiseDbm: -108.97,
      snrDb: i === 4 ? -20.0 : 24.87,
      modcodName: i === 4 ? 'LINK_OUTAGE' : '64-APSK 5/6',
      spectralEfficiency: i === 4 ? 0.0 : 4.95,
      bitrateBps: i === 4 ? 0.0 : 4.95e6,
      bitrateMbps: i === 4 ? 0.0 : 4.95,
      isOutage: i === 4,
    };
    preds[i] = {
      currentState: i === 4 ? NodeTerrainState.HARD_SHADOW_CUTOFF : NodeTerrainState.NORMAL_LOS,
      timeToOcclusionS: i === 4 ? 0 : Number.POSITIVE_INFINITY,
      timeToEmergenceS: i === 4 ? 10.0 : 0,
      fresnelClearanceM: i === 4 ? -50 : 50,
      fresnelRateOfChangeMps: 0,
      predictedOutageDurationS: i === 4 ? 10.0 : 0,
    };
  }

  const report = dynamicSched.scheduleFrame(0, 0.0, nodes, links, preds);
  const node4Alloc = report.allocations.find((a) => a.nodeId === 4);
  const node15Alloc = report.allocations.find((a) => a.nodeId === 15);

  const outageQueuePreserved = nodes[4].queue.getTotalBacklogBits() === 5000 * 8;
  const payloadAccountingOk = report.totalPayloadBitsDequeued === report.totalBitsTransmitted;
  const airtimeAccountingOk =
    Math.abs(report.totalUlScheduledS + report.totalUlUnusedS - report.totalUlAvailableS) < 1e-9;
  const reclaimedOk =
    node4Alloc === undefined &&
    node15Alloc !== undefined &&
    node15Alloc.durationS > 0.005 &&
    report.totalBitsWastedOnOutage === 0 &&
    outageQueuePreserved &&
    payloadAccountingOk &&
    airtimeAccountingOk;

  return {
    name: '4. Tac-TAD Outage Reclamation & Metric Accounting',
    measured: `Node4QueuePreserved=${outageQueuePreserved}, Node15Alloc=${(node15Alloc?.durationS ?? 0) * 1000}ms, Unused=${(report.totalUlUnusedS * 1000).toFixed(3)}ms`,
    criteria: 'No outage dequeue, payload totals reconcile, scheduled + unused = available airtime',
    passed: reclaimedOk,
  };
}

function testPerFrameDropDeltas(): TestResult {
  const scheduler = new TerrainAwareDynamicScheduler(0.008);
  const nodes = Array.from(
    { length: 1 },
    (_, i) => new GroundNodeTrafficSubsystem(i, 'soldier', [0, 0, 3000], 100 + i)
  );
  nodes[0].enqueuePacket(65, 0.0, 160, 0.01);
  const link: LinkStatus = {
    nodeType: 'soldier', slantRangeM: 15000, fsplDb: 134, diffractionLossDb: 0,
    gasLossDb: 0.1, rainLossDb: 0, cableLossDb: 1.5, implementationMarginDb: 2.5,
    totalLossDb: 138.1, pTxDbm: 36, txGainDbi: 3, rxGainDbi: 15, prxDbm: -84.1,
    pNoiseDbm: -108.97, snrDb: 24.87, modcodName: '64-APSK 5/6', spectralEfficiency: 4.95,
    bitrateBps: 4.95e6, bitrateMbps: 4.95, isOutage: false,
  };
  const pred: PredictiveState = {
    currentState: NodeTerrainState.NORMAL_LOS, timeToOcclusionS: Number.POSITIVE_INFINITY,
    timeToEmergenceS: 0, fresnelClearanceM: 50, fresnelRateOfChangeMps: 0,
    predictedOutageDurationS: 0,
  };
  const first = scheduler.scheduleFrame(0, 1.0, nodes, { 0: link }, { 0: pred });
  const second = scheduler.scheduleFrame(1, 1.02, nodes, { 0: link }, { 0: pred });
  const passed = first.packetsDroppedDelay === 1 &&
    first.packetsDroppedDelayThisFrame === 1 &&
    second.packetsDroppedDelay === 1 &&
    second.packetsDroppedDelayThisFrame === 0;
  return {
    name: '5. Cumulative Drops vs Per-Frame Drop Deltas',
    measured: `frame0=${first.packetsDroppedDelayThisFrame}, frame1=${second.packetsDroppedDelayThisFrame}, cumulative=${second.packetsDroppedDelay}`,
    criteria: 'First frame delta=1, next frame delta=0, cumulative remains 1',
    passed,
  };
}

function testComparative100Frames(): TestResult {
  const staticSched = new LegacyStaticScheduler();
  const dynamicSched = new TerrainAwareDynamicScheduler(0.008);

  const nodesStatic = Array.from(
    { length: 16 },
    (_, i) => new GroundNodeTrafficSubsystem(i, i === 15 ? 'mcp' : 'soldier', [0, 0, 3000], 100 + i)
  );
  const nodesDynamic = Array.from(
    { length: 16 },
    (_, i) => new GroundNodeTrafficSubsystem(i, i === 15 ? 'mcp' : 'soldier', [0, 0, 3000], 100 + i)
  );

  // Tactical traffic loads
  nodesStatic[15].hasVideo = true;
  nodesStatic[15].videoMeanPktsPerFrame = 2.5;
  nodesDynamic[15].hasVideo = true;
  nodesDynamic[15].videoMeanPktsPerFrame = 2.5;

  nodesStatic[4].hasPhoto = true;
  nodesStatic[4].photoTriggerTimeS = 0.2;
  nodesStatic[4].photoSizeBytes = 240000;
  nodesDynamic[4].hasPhoto = true;
  nodesDynamic[4].photoTriggerTimeS = 0.2;
  nodesDynamic[4].photoSizeBytes = 240000;

  let staticGoodputBits = 0;
  let staticWastedBits = 0;
  let dynamicGoodputBits = 0;
  let dynamicWastedBits = 0;

  for (let frame = 0; frame < 100; frame++) {
    const t = frame * 0.02;

    for (let i = 0; i < 16; i++) {
      nodesStatic[i].generateTraffic(t, 0.02);
      nodesDynamic[i].generateTraffic(t, 0.02);
      nodesStatic[i].queue.pruneExpiredPackets(t);
      nodesDynamic[i].queue.pruneExpiredPackets(t);
    }

    const isNode4Occluded = frame >= 30 && frame <= 70;
    const isNode4Flushing = frame >= 20 && frame < 30;

    const links: Record<number, LinkStatus> = {};
    const preds: Record<number, PredictiveState> = {};

    for (let i = 0; i < 16; i++) {
      const occluded = i === 4 && isNode4Occluded;
      const rate = occluded ? 0.0 : i === 15 ? 4.95e6 : 1.49e6;

      links[i] = {
        nodeType: i === 15 ? 'mcp' : 'soldier',
        slantRangeM: 15000,
        fsplDb: 134,
        diffractionLossDb: occluded ? 45.0 : 0.0,
        gasLossDb: 0.1,
        rainLossDb: 0,
        cableLossDb: 1.5,
        implementationMarginDb: 2.5,
        totalLossDb: occluded ? 183.1 : 138.1,
        pTxDbm: i === 15 ? 43 : 36,
        txGainDbi: i === 15 ? 20 : 3,
        rxGainDbi: 15,
        prxDbm: occluded ? -129 : -77.1,
        pNoiseDbm: -108.97,
        snrDb: occluded ? -20 : 31.8,
        modcodName: occluded ? 'LINK_OUTAGE' : '64-APSK 5/6',
        spectralEfficiency: occluded ? 0.0 : 4.95,
        bitrateBps: rate,
        bitrateMbps: rate / 1e6,
        isOutage: occluded,
      };

      let state = NodeTerrainState.NORMAL_LOS;
      if (i === 4) {
        if (isNode4Occluded) state = NodeTerrainState.HARD_SHADOW_CUTOFF;
        else if (isNode4Flushing) state = NodeTerrainState.PRE_OCCLUSION_FLUSH;
      }

      preds[i] = {
        currentState: state,
        timeToOcclusionS: isNode4Flushing ? Math.max(0, (30 - frame) * 0.02) : Number.POSITIVE_INFINITY,
        timeToEmergenceS: isNode4Occluded ? Math.max(0, (70 - frame) * 0.02) : 0,
        fresnelClearanceM: occluded ? -50 : 50,
        fresnelRateOfChangeMps: 0,
        predictedOutageDurationS: isNode4Flushing ? 0.8 : 0,
      };

      nodesStatic[i].isShadowed = occluded;
      nodesDynamic[i].isShadowed = occluded;
    }

    const rStat = staticSched.scheduleFrame(frame, t, nodesStatic, links, preds);
    const rDyn = dynamicSched.scheduleFrame(frame, t, nodesDynamic, links, preds);

    staticGoodputBits += rStat.totalBitsTransmitted;
    staticWastedBits += rStat.totalBitsWastedOnOutage;
    dynamicGoodputBits += rDyn.totalBitsTransmitted;
    dynamicWastedBits += rDyn.totalBitsWastedOnOutage;
  }

  const gain = dynamicGoodputBits / Math.max(1, staticGoodputBits);
  const passed = gain >= 1.5 && dynamicWastedBits === 0 && staticWastedBits > 0;

  return {
    name: '6. 100-Frame Comparative Multi-Node Simulation',
    measured: `Gain = ${gain.toFixed(2)}x (Static=${(staticGoodputBits / 1e6).toFixed(2)}Mb, Dyn=${(dynamicGoodputBits / 1e6).toFixed(2)}Mb, StaticWaste=${(staticWastedBits / 1e6).toFixed(2)}Mb, DynWaste=${dynamicWastedBits}b)`,
    criteria: 'Gain >= 1.5x, DynWaste == 0.0b, StaticWaste > 0',
    passed,
  };
}

function runAllTests(): void {
  const tests: TestResult[] = [
    testOrbitKinematics(),
    testQueuePriorityAndEviction(),
    testStaticSlotArithmetic(),
    testDynamicOutageReclamation(),
    testPerFrameDropDeltas(),
    testComparative100Frames(),
  ];

  const bar = '='.repeat(105);
  const subBar = '-'.repeat(105);

  console.log('\n' + bar);
  console.log('       TACTICAL X-BAND DIGITAL TWIN // SCHEDULER & TRAJECTORY TYPESCRIPT VERIFICATION');
  console.log(bar);
  console.log(
    ` ${'Test Description'.padEnd(42)} | ${'Measured Value'.padEnd(32)} | ${'Target Criteria'.padEnd(16)} | Status`
  );
  console.log(subBar);

  let allPassed = true;
  for (const t of tests) {
    if (!t.passed) allPassed = false;
    const status = t.passed ? 'PASSED' : 'FAILED';
    console.log(
      ` ${t.name.padEnd(42)} | ${t.measured.padEnd(32)} | ${t.criteria.padEnd(16)} | ${status}`
    );
  }

  console.log(bar);

  if (allPassed) {
    console.log(' [SUCCESS] All scheduler, queue, and trajectory verification tests passed with 100% parity.\n');
    process.exit(0);
  } else {
    console.error(' [FAILURE] One or more scheduler tests failed.\n');
    process.exit(1);
  }
}

runAllTests();