/**
 * src/tests/verifyQuadSectorAntenna.ts
 *
 * Automated Verification Suite for Body-Fixed 4-Sector ACN Antenna Array & Parallel Per-Sector TDMA.
 * Specification: SPEC-QUAD-SECTOR-ANTENNA-UPGRADE
 *
 * Implements Tests QSA-T1 through QSA-T5:
 * - QSA-T1: ENU Heading & Body Frame Coordinate Transform
 * - QSA-T2: Exact -3.0 dB Crossover Geometry & Attenuation Roll-off
 * - QSA-T3: Stateful Sector Handover Hysteresis (1.5 dB Anti-Ping-Pong)
 * - QSA-T4: Parallel Per-Sector TDMA Scheduling & Airtime Conservation
 * - QSA-T5: End-to-End Worker Integration & Sector Telemetry Serializer
 */

import assert from 'node:assert/strict';
import {
  QuadSectorAntennaEngine,
  DEFAULT_QUAD_ANTENNA_CONFIG,
  ACN_SECTOR_BORESIGHTS_DEG,
  type AcnSectorId,
} from '../core/antennaArray';
import { RFConfig, EnvironmentConfig } from '../core/config';
import { LinkBudgetEngine, type LinkStatus } from '../core/linkBudget';
import {
  LegacyStaticScheduler,
  TerrainAwareDynamicScheduler,
} from '../core/scheduler';
import { GroundNodeTrafficSubsystem, QOS_PROFILES } from '../core/queues';
import { NodeTerrainState, type PredictiveState } from '../core/trajectory';
import { SimulationWorkerManager, FRAME_DT } from '../worker/simWorker';
import type { Position3D } from '../shared/types';

function close(actual: number, expected: number, tolerance = 1e-6, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('='.repeat(92));
console.log('   BODY-FIXED 4-SECTOR ACN ANTENNA ARRAY & PARALLEL PER-SECTOR TDMA VERIFICATION SUITE');
console.log('   Specification: SPEC-QUAD-SECTOR-ANTENNA-UPGRADE // QSA-T1 - QSA-T5');
console.log('='.repeat(92));

const engine = new QuadSectorAntennaEngine();

// -------------------------------------------------------------------------------------------------
// [QSA-T1] ENU Heading & Body Frame Coordinate Transform
// -------------------------------------------------------------------------------------------------
console.log('\n[QSA-T1] Verifying ENU Heading & Body Frame Coordinate Transform...');
{
  // 1. Compass Heading from ENU velocity
  // North [0, 50, 0] -> 0 deg
  const attNorth = engine.computeAcnAttitude([0, 50, 0]);
  close(attNorth.headingDeg, 0.0, 1e-4, 'North velocity [0, 50, 0] must map to 0°');

  // East [50, 0, 0] -> 90 deg
  const attEast = engine.computeAcnAttitude([50, 0, 0]);
  close(attEast.headingDeg, 90.0, 1e-4, 'East velocity [50, 0, 0] must map to 90°');

  // South [0, -50, 0] -> 180 deg
  const attSouth = engine.computeAcnAttitude([0, -50, 0]);
  close(attSouth.headingDeg, 180.0, 1e-4, 'South velocity [0, -50, 0] must map to 180°');

  // West [-50, 0, 0] -> 270 deg
  const attWest = engine.computeAcnAttitude([-50, 0, 0]);
  close(attWest.headingDeg, 270.0, 1e-4, 'West velocity [-50, 0, 0] must map to 270°');

  // 2. Body-frame azimuth transform under heading
  // Aircraft at (0, 0, 5000), heading East (90 deg)
  const acnPos: Position3D = [0, 0, 5000];
  const acnVelEast: Position3D = [50, 0, 0];

  // Node due North (0, 10000, 0): world bearing = 0°, body azimuth = (0 - 90 + 360) = 270° (Port/S3)
  const evalNorth = engine.evaluateNodeSector(1, acnPos, acnVelEast, [0, 10000, 0], 25.0, false);
  close(evalNorth.worldBearingDeg, 0.0, 1e-4, 'North node world bearing');
  close(evalNorth.bodyAzimuthDeg, 270.0, 1e-4, 'North node body azimuth under 90° heading must be 270° (Port)');
  assert.equal(evalNorth.activeSectorId, 3, 'North node under 90° heading must select Sector 3 (Port/270°)');

  // Node due East (10000, 0, 0): world bearing = 90°, body azimuth = (90 - 90) = 0° (FWD/S0)
  const evalEast = engine.evaluateNodeSector(2, acnPos, acnVelEast, [10000, 0, 0], 25.0, false);
  close(evalEast.worldBearingDeg, 90.0, 1e-4, 'East node world bearing');
  close(evalEast.bodyAzimuthDeg, 0.0, 1e-4, 'East node body azimuth under 90° heading must be 0° (FWD)');
  assert.equal(evalEast.activeSectorId, 0, 'East node under 90° heading must select Sector 0 (FWD/0°)');

  // Node due South (0, -10000, 0): world bearing = 180°, body azimuth = (180 - 90) = 90° (STBD/S1)
  const evalSouth = engine.evaluateNodeSector(3, acnPos, acnVelEast, [0, -10000, 0], 25.0, false);
  close(evalSouth.worldBearingDeg, 180.0, 1e-4, 'South node world bearing');
  close(evalSouth.bodyAzimuthDeg, 90.0, 1e-4, 'South node body azimuth under 90° heading must be 90° (STBD)');
  assert.equal(evalSouth.activeSectorId, 1, 'South node under 90° heading must select Sector 1 (STBD/90°)');

  // Node due West (-10000, 0, 0): world bearing = 270°, body azimuth = (270 - 90) = 180° (AFT/S2)
  const evalWest = engine.evaluateNodeSector(4, acnPos, acnVelEast, [-10000, 0, 0], 25.0, false);
  close(evalWest.worldBearingDeg, 270.0, 1e-4, 'West node world bearing');
  close(evalWest.bodyAzimuthDeg, 180.0, 1e-4, 'West node body azimuth under 90° heading must be 180° (AFT)');
  assert.equal(evalWest.activeSectorId, 2, 'West node under 90° heading must select Sector 2 (AFT/180°)');

  console.log('  PASS: QSA-T1 ENU heading mapping and body frame azimuth transforms verified');
}

// -------------------------------------------------------------------------------------------------
// [QSA-T2] Exact -3.0 dB Crossover Geometry & Attenuation Roll-off
// -------------------------------------------------------------------------------------------------
console.log('\n[QSA-T2] Verifying Exact -3.0 dB Crossover Geometry & Attenuation Roll-off...');
{
  // 1. Exact 3.0 dB attenuation at off-boresight ±45° when elevationBodyDeg = -15° (on mechanical downtilt)
  const lossPlus45 = engine.computeSectorAttenuationDb(45.0, -15.0);
  close(lossPlus45, 3.0, 1e-9, 'Loss at +45° azimuth and -15° elevation must equal exactly 3.0 dB');

  const lossMinus45 = engine.computeSectorAttenuationDb(-45.0, -15.0);
  close(lossMinus45, 3.0, 1e-9, 'Loss at -45° azimuth and -15° elevation must equal exactly 3.0 dB');

  // 2. Exact 0.0 dB attenuation at boresight
  const lossBoresight = engine.computeSectorAttenuationDb(0.0, -15.0);
  close(lossBoresight, 0.0, 1e-9, 'Loss at boresight (0° off-az, -15° el) must equal 0.0 dB');

  // 3. Max attenuation ceiling (25 dB front-to-back ratio)
  const lossBack = engine.computeSectorAttenuationDb(180.0, -15.0);
  close(lossBack, 25.0, 1e-9, 'Loss at 180° backlobe must cap at max attenuation (25 dB)');

  // 4. Equal adjacent sector gain at all 4 crossover boundaries: 45°, 135°, 225°, 315°
  const acnPos: Position3D = [0, 0, 5000];
  const acnVelNorth: Position3D = [0, 50, 0]; // Heading 0° North
  const R = 20000;

  const crossovers = [45, 135, 225, 315];
  for (const crossAngle of crossovers) {
    const rad = (crossAngle * Math.PI) / 180.0;
    const nx = R * Math.sin(rad);
    const ny = R * Math.cos(rad);
    // Set altitude such that elevationBodyDeg is close to -15°
    // tan(-15°) = dz / R -> dz = -R * tan(15°) = -20000 * 0.2679 = -5358m -> node at 5000 - 5358 = -358m
    const nz = 5000 - R * Math.tan((15.0 * Math.PI) / 180.0);

    const evalCross = engine.evaluateNodeSector(10, acnPos, acnVelNorth, [nx, ny, nz], 25.0, false);
    const gains = evalCross.allSectorGainsDbi;

    if (crossAngle === 45) {
      close(gains[0], gains[1], 1e-4, 'Gains of S0 and S1 at 45° crossover must be identical');
    } else if (crossAngle === 135) {
      close(gains[1], gains[2], 1e-4, 'Gains of S1 and S2 at 135° crossover must be identical');
    } else if (crossAngle === 225) {
      close(gains[2], gains[3], 1e-4, 'Gains of S2 and S3 at 225° crossover must be identical');
    } else if (crossAngle === 315) {
      close(gains[3], gains[0], 1e-4, 'Gains of S3 and S0 at 315° crossover must be identical');
    }

    assert.ok(evalCross.isCrossoverZone, `Angle ${crossAngle}° must be flagged as isCrossoverZone`);
  }

  console.log('  PASS: QSA-T2 -3.0 dB half-power beam intersection & symmetry verified');
}

// -------------------------------------------------------------------------------------------------
// [QSA-T3] Stateful Sector Handover Hysteresis (1.5 dB Anti-Ping-Pong)
// -------------------------------------------------------------------------------------------------
console.log('\n[QSA-T3] Verifying Stateful Sector Handover Hysteresis (1.5 dB Anti-Ping-Pong)...');
{
  const hysEngine = new QuadSectorAntennaEngine();
  const acnPos: Position3D = [0, 0, 5000];
  const acnVelNorth: Position3D = [0, 50, 0]; // Heading 0°
  const R = 20000;
  const nz = 5000 - R * Math.tan((15.0 * Math.PI) / 180.0);

  // Position node at 44° (Inside Sector 0, past boresight)
  const rad44 = (44.0 * Math.PI) / 180.0;
  const eval44 = hysEngine.evaluateNodeSector(101, acnPos, acnVelNorth, [R * Math.sin(rad44), R * Math.cos(rad44), nz], 25.0, true);
  assert.equal(eval44.activeSectorId, 0, 'Node at 44° must initialize on Sector S0');
  assert.equal(eval44.handoverCount, 0, 'Initial association must have handoverCount = 0');

  // Move node slightly across boundary to 46°:
  // S1 gain is slightly higher than S0, but difference is ~0.27 dB (< 1.5 dB hysteresis)
  const rad46 = (46.0 * Math.PI) / 180.0;
  const eval46 = hysEngine.evaluateNodeSector(101, acnPos, acnVelNorth, [R * Math.sin(rad46), R * Math.cos(rad46), nz], 25.0, true);
  assert.equal(eval46.activeSectorId, 0, 'Node at 46° must RETAIN Sector S0 due to 1.5 dB hysteresis');
  assert.equal(eval46.handoverOccurred, false, 'No handover should occur at 46° within hysteresis window');
  assert.equal(eval46.handoverCount, 0, 'Handover count must remain 0');

  // Move node further into Sector 1, to 55° (difference is ~2.7 dB > 1.5 dB):
  const rad55 = (55.0 * Math.PI) / 180.0;
  const eval55 = hysEngine.evaluateNodeSector(101, acnPos, acnVelNorth, [R * Math.sin(rad55), R * Math.cos(rad55), nz], 25.0, true);
  assert.equal(eval55.activeSectorId, 1, 'Node at 55° must handover to Sector S1');
  assert.equal(eval55.handoverOccurred, true, 'Handover must be flagged as occurred at 55°');
  assert.equal(eval55.handoverCount, 1, 'Handover count must increment to 1');

  // Now swing node back to 46°:
  // Now S1 is the previous sector. S0 is slightly better, but by only ~0.27 dB (< 1.5 dB).
  // Node must RETAIN Sector S1!
  const eval46Return = hysEngine.evaluateNodeSector(101, acnPos, acnVelNorth, [R * Math.sin(rad46), R * Math.cos(rad46), nz], 25.0, true);
  assert.equal(eval46Return.activeSectorId, 1, 'Node returning to 46° must RETAIN Sector S1 due to reverse hysteresis');
  assert.equal(eval46Return.handoverOccurred, false, 'No ping-pong handover on return to 46°');
  assert.equal(eval46Return.handoverCount, 1, 'Handover count must remain 1');

  console.log('  PASS: QSA-T3 1.5 dB handover hysteresis and ping-pong suppression verified');
}

// -------------------------------------------------------------------------------------------------
// [QSA-T4] Parallel Per-Sector TDMA Scheduling & Airtime Conservation
// -------------------------------------------------------------------------------------------------
console.log('\n[QSA-T4] Verifying Parallel Per-Sector TDMA Scheduling & Airtime Conservation...');
{
  const staticSched = new LegacyStaticScheduler();
  staticSched.enableMultiSector = true;
  const tacSched = new TerrainAwareDynamicScheduler(0.008);

  // Create mock ground nodes in different sectors
  const n0 = new GroundNodeTrafficSubsystem(0, 'mcp', [10000, 0, 0]);
  const n1 = new GroundNodeTrafficSubsystem(1, 'infantry', [0, 10000, 0]);
  const nodes = [n0, n1];

  // Enqueue realistic packet payloads (2 KB each = 16,000 bits > minSlotDuration)
  n0.enqueuePacket(69, 0.0, 2000);
  n1.enqueuePacket(69, 0.0, 2000);

  // Link statuses assigning n0 to Sector 0 and n1 to Sector 1
  const linkStatuses: Record<number, LinkStatus> = {
    0: {
      nodeType: 'mcp',
      slantRangeM: 10000,
      fsplDb: 130,
      diffractionLossDb: 0,
      gasLossDb: 0.1,
      rainLossDb: 0.0,
      totalLossDb: 130.1,
      rxPowerDbm: -65,
      noisePowerDbm: -100,
      snrDb: 35,
      modcodName: 'QPSK_3_4',
      spectralEfficiency: 1.5,
      bitrateBps: 15e6,
      bitrateMbps: 15.0,
      isOutage: false,
      obstacleBlocked: false,
      activeSectorId: 0,
      sectorBoresightDeg: 0,
      isCrossoverZone: false,
    },
    1: {
      nodeType: 'infantry',
      slantRangeM: 10000,
      fsplDb: 130,
      diffractionLossDb: 0,
      gasLossDb: 0.1,
      rainLossDb: 0.0,
      totalLossDb: 130.1,
      rxPowerDbm: -65,
      noisePowerDbm: -100,
      snrDb: 35,
      modcodName: 'QPSK_3_4',
      spectralEfficiency: 1.5,
      bitrateBps: 15e6,
      bitrateMbps: 15.0,
      isOutage: false,
      obstacleBlocked: false,
      activeSectorId: 1,
      sectorBoresightDeg: 90,
      isCrossoverZone: true,
    },
  };

  const predStates: Record<number, PredictiveState> = {
    0: { currentState: NodeTerrainState.NORMAL_LOS, timeToOcclusionS: 99, timeToEmergenceS: 0, fresnelClearanceM: 50 },
    1: { currentState: NodeTerrainState.NORMAL_LOS, timeToOcclusionS: 99, timeToEmergenceS: 0, fresnelClearanceM: 50 },
  };

  // 1. Verify LegacyStaticScheduler in 4-sector mode
  const repStatic = staticSched.scheduleFrame(1, 0.0, nodes, linkStatuses, predStates);
  assert.equal(repStatic.allocations.length, 2, 'Static scheduler must produce 2 allocations for 2 nodes in separate sectors');
  const alloc0 = repStatic.allocations.find(a => a.nodeId === 0)!;
  const alloc1 = repStatic.allocations.find(a => a.nodeId === 1)!;

  assert.equal(alloc0.sectorId, 0, 'Alloc 0 must be in Sector 0');
  assert.equal(alloc1.sectorId, 1, 'Alloc 1 must be in Sector 1');

  // Both sectors run simultaneously in parallel, so both start at the same time:
  close(alloc0.slotStartS, alloc1.slotStartS, 1e-6, 'Parallel sectors must start simultaneously at dlControlDuration');
  close(repStatic.totalUlScheduledS + repStatic.totalUlUnusedS, repStatic.totalUlAvailableS, 1e-9, 'Static airtime conservation: sched + unused === available');
  assert.equal(repStatic.sectorNodeCounts?.[0], 1);
  assert.equal(repStatic.sectorNodeCounts?.[1], 1);
  assert.equal(repStatic.sectorNodeCounts?.[2], 0);
  assert.equal(repStatic.sectorNodeCounts?.[3], 0);

  // 2. Verify TerrainAwareDynamicScheduler in 4-sector mode
  // Create fresh ground nodes with backlogs for Tac-TAD
  const tacN0 = new GroundNodeTrafficSubsystem(0, 'mcp', [10000, 0, 0]);
  const tacN1 = new GroundNodeTrafficSubsystem(1, 'infantry', [0, 10000, 0]);
  tacN0.enqueuePacket(69, 0.0, 2000);
  tacN1.enqueuePacket(69, 0.0, 2000);
  const tacNodes = [tacN0, tacN1];

  const repTac = tacSched.scheduleFrame(1, 0.0, tacNodes, linkStatuses, predStates);
  const tacAlloc0 = repTac.allocations.find(a => a.nodeId === 0)!;
  const tacAlloc1 = repTac.allocations.find(a => a.nodeId === 1)!;

  assert.ok(tacAlloc0 && tacAlloc1, 'Tac-TAD must allocate slots in both active sectors');
  assert.equal(tacAlloc0.sectorId, 0, 'Tac alloc 0 must carry sectorId 0');
  assert.equal(tacAlloc1.sectorId, 1, 'Tac alloc 1 must carry sectorId 1');

  close(tacAlloc0.slotStartS, tacAlloc1.slotStartS, 1e-6, 'Tac-TAD parallel sectors must start simultaneously');
  close(repTac.totalUlScheduledS + repTac.totalUlUnusedS, repTac.totalUlAvailableS, 1e-9, 'Tac-TAD airtime conservation: sched + unused === available');

  console.log('  PASS: QSA-T4 Parallel per-sector TDMA scheduling and airtime conservation verified');
}

// -------------------------------------------------------------------------------------------------
// [QSA-T5] End-to-End Worker Integration & Sector Telemetry Serializer
// -------------------------------------------------------------------------------------------------
console.log('\n[QSA-T5] Verifying End-to-End Worker Integration & Sector Telemetry Serializer...');
{
  const sim = new SimulationWorkerManager();
  sim.currentScenarioPreset = '16_NODES';
  sim.resetSimulationState();

  // Run 50 frames to advance kinematics and antenna attitude
  for (let f = 0; f < 50; f++) {
    sim.tickSimulation(false);
  }

  // Obtain authoritative telemetry frame
  const frame = (sim as any).buildTelemetryFrame(sim.getLiveAcnPosition());

  assert.ok(Number.isFinite(frame.acn_heading_deg), `acn_heading_deg must be finite, received ${frame.acn_heading_deg}`);
  assert.ok(frame.acn_heading_deg! >= 0 && frame.acn_heading_deg! < 360, `acn_heading_deg must be in [0, 360), received ${frame.acn_heading_deg}`);
  assert.ok(Number.isFinite(frame.acn_bank_deg), `acn_bank_deg must be finite, received ${frame.acn_bank_deg}`);

  assert.ok(Array.isArray(frame.sector_node_counts), 'sector_node_counts must be an array');
  assert.equal(frame.sector_node_counts!.length, 4, 'sector_node_counts must have 4 entries');
  const sumCount = frame.sector_node_counts!.reduce((a: number, b: number) => a + b, 0);
  assert.equal(sumCount, 16, `Sum of sector_node_counts must equal 16 registered nodes, received ${sumCount}`);

  // Assert node telemetry contains sector fields
  assert.ok(frame.nodes_telemetry.length > 0, 'nodes_telemetry must be populated');
  for (const node of frame.nodes_telemetry) {
    assert.ok(node.active_sector_id !== undefined, `Node ${node.node_id} must have active_sector_id`);
    assert.ok([0, 1, 2, 3].includes(node.active_sector_id!), `Node ${node.node_id} sector must be 0, 1, 2, or 3`);
    assert.ok(Number.isFinite(node.body_azimuth_deg), `Node ${node.node_id} body_azimuth_deg must be finite`);
    assert.ok(Number.isFinite(node.off_boresight_deg), `Node ${node.node_id} off_boresight_deg must be finite`);
    assert.ok(Number.isFinite(node.pattern_rolloff_db), `Node ${node.node_id} pattern_rolloff_db must be finite`);
    assert.ok(typeof node.handover_count === 'number', `Node ${node.node_id} handover_count must be number`);
  }

  console.log('  PASS: QSA-T5 End-to-end worker telemetry serialization verified');
}

console.log('\n' + '='.repeat(92));
console.log('   ALL 5 QUAD-SECTOR ANTENNA VERIFICATION TESTS PASSED (100%)');
console.log('='.repeat(92));
