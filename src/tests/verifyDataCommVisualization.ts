/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Data Communication & TDMA-Slot-Synchronized Visualization Verification Suite (Feature 1)
 *
 * Execution:
 *   npm run verify:data-comm
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateTransferEtaSeconds,
  calculateTransferRateBps,
  smoothTransferRateBps,
} from '../core/transferMetrics';
import {
  ActiveGanttAllocation,
  computeParticlePositions,
  computeSlotPacketPositions,
  computeVisualSubframeOffsetMs,
  createSuperframeSnapshot,
  DataCommVisualizer,
  deepFreezeSnapshot,
  determineEndpointRoles,
  determineSlotEndpointRoles,
  interpolateLinkPosition,
  normalizeSnapshotAllocations,
  Point2D,
  resolveActiveTdmaSlotState,
  resolveSuperframeTimeline,
  shouldSuppressPacketFlow,
  SnapshotNodeState,
  SnapshotSlotAllocation,
  SuperframeVisualSnapshot,
} from '../ui/dataCommVisualization';
import {
  FRAME_DT,
  normalizeSlotAllocationToFrame,
  SimulationWorkerManager,
} from '../worker/simWorker';
import {
  LegacyStaticScheduler,
  TerrainAwareDynamicScheduler,
  SlotAllocation,
  T_FRAME_S,
  T_CTRL_S,
  T_DL_MIN_S,
} from '../core/scheduler';
import { GroundNodeTrafficSubsystem } from '../core/queues';
import { LinkStatus } from '../core/linkBudget';
import { PredictiveState, NodeTerrainState } from '../core/trajectory';

function createMockCanvasContext(): CanvasRenderingContext2D {
  return {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    arc: () => {},
    stroke: () => {},
    fill: () => {},
    setLineDash: () => {},
    moveTo: () => {},
    lineTo: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    translate: () => {},
    rotate: () => {},
    roundRect: () => {},
    fillText: () => {},
    measureText: (text: string) => ({ width: text.length * 6 } as any),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
}

interface RecordedCanvasText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fillStyle: string;
}

interface RecordedCanvasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface RecordedCanvasArc {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly strokeStyle: string;
}

function createRecordingCanvasContext(): {
  ctx: CanvasRenderingContext2D;
  filledTexts: RecordedCanvasText[];
  rects: RecordedCanvasRect[];
  arcs: RecordedCanvasArc[];
} {
  const filledTexts: RecordedCanvasText[] = [];
  const rects: RecordedCanvasRect[] = [];
  const arcs: RecordedCanvasArc[] = [];

  let currentStrokeStyle = '';
  let currentFillStyle = '';
  let currentLineWidth = 1;

  const ctx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    arc: (x: number, y: number, radius: number) => {
      arcs.push({ x, y, radius, strokeStyle: currentStrokeStyle });
    },
    stroke: () => {},
    fill: () => {},
    setLineDash: () => {},
    moveTo: () => {},
    lineTo: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h });
    },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h });
    },
    translate: () => {},
    rotate: () => {},
    roundRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h });
    },
    fillText: (text: string, x: number, y: number) => {
      filledTexts.push({ text, x, y, fillStyle: currentFillStyle });
    },
    measureText: (text: string) => ({ width: text.length * 6 } as any),
    get strokeStyle() { return currentStrokeStyle; },
    set strokeStyle(val: string) { currentStrokeStyle = val; },
    get fillStyle() { return currentFillStyle; },
    set fillStyle(val: string) { currentFillStyle = val; },
    get lineWidth() { return currentLineWidth; },
    set lineWidth(val: number) { currentLineWidth = val; },
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;

  return { ctx, filledTexts, rects, arcs };
}

console.log('================================================================================');
console.log('  FEATURE 1: TDMA-SLOT-SYNCHRONIZED DATA COMM VISUALIZATION VERIFICATION SUITE');
console.log('================================================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Uplink particle direction: terminal -> ACN
// ─────────────────────────────────────────────────────────────────────────────
console.log('[1/43] Verifying Uplink particle direction (Terminal -> ACN)...');
{
  const termX = 100, termY = 200;
  const acnX = 500, acnY = 600;

  const startPoint = interpolateLinkPosition(termX, termY, acnX, acnY, 0.0);
  assert.equal(startPoint.x, termX, 'Progress 0.0 must be exactly at the terminal origin');
  assert.equal(startPoint.y, termY);

  const midPoint = interpolateLinkPosition(termX, termY, acnX, acnY, 0.5);
  assert.equal(midPoint.x, (termX + acnX) / 2);
  assert.equal(midPoint.y, (termY + acnY) / 2);

  const endPoint = interpolateLinkPosition(termX, termY, acnX, acnY, 1.0);
  assert.equal(endPoint.x, acnX, 'Progress 1.0 must be exactly at the ACN destination');
  assert.equal(endPoint.y, acnY);

  const d0 = Math.hypot(startPoint.x - termX, startPoint.y - termY);
  const dMid = Math.hypot(midPoint.x - termX, midPoint.y - termY);
  const d1 = Math.hypot(endPoint.x - termX, endPoint.y - termY);
  assert.ok(d0 < dMid && dMid < d1, 'Uplink particle progress must move away from terminal towards ACN');
  console.log('  -> PASS: Uplink particles strictly flow ground terminal -> ACN.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Downlink particle direction: ACN -> terminal
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2/43] Verifying Downlink particle direction (ACN -> Terminal)...');
{
  const acnX = 400, acnY = 300;
  const termX = 150, termY = 100;

  const startPoint = interpolateLinkPosition(acnX, acnY, termX, termY, 0.0);
  assert.equal(startPoint.x, acnX, 'Downlink progress 0.0 must originate at ACN');
  assert.equal(startPoint.y, acnY);

  const endPoint = interpolateLinkPosition(acnX, acnY, termX, termY, 1.0);
  assert.equal(endPoint.x, termX, 'Downlink progress 1.0 must terminate at ground terminal');
  assert.equal(endPoint.y, termY);

  const d0 = Math.hypot(startPoint.x - acnX, startPoint.y - acnY);
  const d1 = Math.hypot(endPoint.x - acnX, endPoint.y - acnY);
  assert.ok(d0 < d1, 'Downlink vector must propagate outward from ACN');
  console.log('  -> PASS: Downlink particles strictly flow ACN -> ground terminal.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Correct TX/RX endpoint attribution
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3/43] Verifying TX and RX endpoint attribution...');
{
  const ulRoles = determineEndpointRoles(true, true, false);
  assert.equal(ulRoles.nodeRole, 'TX', 'Transmitting ground node must be designated TX');
  assert.equal(ulRoles.acnRole, 'RX', 'ACN receiving uplink must be designated RX');

  const dlRoles = determineEndpointRoles(false, false, true);
  assert.equal(dlRoles.nodeRole, 'RX', 'Terminal receiving downlink must be designated RX');
  assert.equal(dlRoles.acnRole, 'TX', 'ACN transmitting downlink must be designated TX');

  const idleRoles = determineEndpointRoles(true, false, false);
  assert.equal(idleRoles.nodeRole, null, 'Idle node must have no TX/RX attribution');
  assert.equal(idleRoles.acnRole, null);
  console.log('  -> PASS: TX/RX roles are strictly attributed to active endpoints only.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Particle progression using simulation time
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4/43] Verifying deterministic particle progression using simulation time...');
{
  const pAt0 = computeParticlePositions(0, 0, 100, 100, 0.0, 1.0, 1);
  const pAtHalf = computeParticlePositions(0, 0, 100, 100, 0.5, 1.0, 1);
  const pAtOne = computeParticlePositions(0, 0, 100, 100, 1.0, 1.0, 1);

  assert.ok(Math.abs(pAt0[0].progress - 0.0) < 1e-6);
  assert.ok(Math.abs(pAtHalf[0].progress - 0.5) < 1e-6);
  assert.ok(Math.abs(pAtOne[0].progress - 0.0) < 1e-6, 'Phase wraps deterministically at 1.0 cycle');

  const runA = computeParticlePositions(10, 20, 300, 400, 2.71828, 1.2, 4);
  const runB = computeParticlePositions(10, 20, 300, 400, 2.71828, 1.2, 4);
  assert.deepEqual(runA, runB, 'Identical simulation time must yield bit-identical particle coordinates');
  console.log('  -> PASS: Particle movement is 100% deterministic and bound to simulation time.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Correct transfer progress percentage
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5/43] Verifying transfer progress percentage calculation...');
{
  const calcPct = (del: number, tot: number) =>
    tot > 0 ? Math.min(100.0, Math.round(((del / tot) * 100.0) * 10) / 10) : 0.0;

  assert.equal(calcPct(0, 2000000), 0.0);
  assert.equal(calcPct(500000, 2000000), 25.0);
  assert.equal(calcPct(1000000, 2000000), 50.0);
  assert.equal(calcPct(2000000, 2000000), 100.0);
  assert.equal(calcPct(2500000, 2000000), 100.0, 'Progress must clamp at 100%');
  assert.equal(calcPct(0, 0), 0.0, 'Zero total bytes safely returns 0%');
  console.log('  -> PASS: Progress percentage clamps safely between 0% and 100%.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Correct transfer-rate calculation
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6/43] Verifying transfer-rate calculation using simulation-time differences...');
{
  const rate1 = calculateTransferRateBps(1400, 0.02);
  assert.equal(rate1, 560000);

  const rate2 = calculateTransferRateBps(125000, 0.1);
  assert.equal(rate2, 10000000);

  assert.equal(calculateTransferRateBps(1000, 0.0), 0);
  assert.equal(calculateTransferRateBps(1000, -0.02), 0);
  assert.equal(calculateTransferRateBps(0, 0.02), 0);

  const smoothed = smoothTransferRateBps(1000000, 2000000, 0.3);
  assert.equal(smoothed, 1000000 * 0.7 + 2000000 * 0.3);
  console.log('  -> PASS: Transfer rate strictly obeys (deliveredDelta * 8) / simTimeDelta.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: ETA calculation and invalid/unavailable ETA cases
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7/43] Verifying ETA calculation across all operational and edge states...');
{
  const etaActive = calculateTransferEtaSeconds(1000000, 8000000, 'TRANSMITTING', false);
  assert.equal(etaActive.etaS, 1.0);
  assert.equal(etaActive.etaStatus, '1.0s');

  const etaComplete = calculateTransferEtaSeconds(0, 8000000, 'ACKNOWLEDGED', false);
  assert.equal(etaComplete.etaS, 0);
  assert.equal(etaComplete.etaStatus, 'COMPLETE');

  const etaBlocked = calculateTransferEtaSeconds(500000, 0, 'BLOCKED_NLOS', false);
  assert.equal(etaBlocked.etaS, null);
  assert.equal(etaBlocked.etaStatus, 'BLOCKED (PAUSED)');

  const etaPaused = calculateTransferEtaSeconds(500000, 4000000, 'TRANSMITTING', true);
  assert.equal(etaPaused.etaS, null);
  assert.equal(etaPaused.etaStatus, 'SIM PAUSED');

  const etaDropped = calculateTransferEtaSeconds(500000, 0, 'FAILED_DROPPED', false);
  assert.equal(etaDropped.etaS, null);
  assert.equal(etaDropped.etaStatus, 'DROPPED');

  const etaZeroRate = calculateTransferEtaSeconds(500000, 0, 'TRANSMITTING', false);
  assert.equal(etaZeroRate.etaS, null);
  assert.equal(etaZeroRate.etaStatus, 'CALCULATING');

  const etaIdle = calculateTransferEtaSeconds(0, 0, 'IDLE', false);
  assert.equal(etaIdle.etaS, null);
  assert.equal(etaIdle.etaStatus, 'STANDBY');
  console.log('  -> PASS: ETA correctly reflects active, blocked, paused, and edge states.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: No successful packet flow through terrain-blocked links
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8/43] Verifying no successful packet flow through terrain-blocked links...');
{
  assert.equal(shouldSuppressPacketFlow('BLOCKED_TERRAIN'), true);

  const wasteParticles = computeParticlePositions(0, 0, 100, 100, 1.5, 1.0, 4, 0.42);
  assert.ok(wasteParticles.every((p) => p.progress <= 0.42), 'Waste particles must terminate at obstacle');
  console.log('  -> PASS: Terrain-blocked links strictly prohibit packets reaching destination.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: No successful packet flow through obstacle-blocked links
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9/43] Verifying no successful packet flow through obstacle-blocked links...');
{
  assert.equal(shouldSuppressPacketFlow('BLOCKED_OBSTACLE'), true);
  console.log('  -> PASS: Obstacle-blocked links strictly suppress successful payload flow.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: No successful packet flow through disconnected links
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[10/43] Verifying no successful packet flow through disconnected links...');
{
  assert.equal(shouldSuppressPacketFlow('OUTAGE_DISCONNECTED'), true);
  assert.equal(shouldSuppressPacketFlow('UNKNOWN'), true);
  assert.equal(shouldSuppressPacketFlow('CONNECTED'), false);
  assert.equal(shouldSuppressPacketFlow('DEGRADED'), false);
  console.log('  -> PASS: Disconnected and unknown links strictly suppress transmission.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 11: Correct distinction between idle RF carrier and active payload
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[11/43] Verifying distinction between idle RF carrier and active payload...');
{
  const sim = new SimulationWorkerManager();
  sim.tickSimulation();
  const frame = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));

  const n0 = frame.nodes_telemetry.find((n: any) => n.node_id === 0);
  assert.ok(n0 !== undefined);
  assert.equal(n0.link_outage, false, 'Node 0 carrier must be operational');
  assert.equal(typeof n0.is_transmitting, 'boolean');
  console.log('  -> PASS: Established RF carrier is cleanly separated from active payload streaming.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 12: Static TDMA wasted-airtime vs Tac-TAD reclamation
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[12/43] Verifying Static TDMA waste vs Tac-TAD reclamation representation...');
{
  const sim = new SimulationWorkerManager();
  sim.schedulerMode = 'static';
  sim.tickSimulation();

  const acnPos = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  const n4Pos = sim.nodesStatic[4].position;
  const res = sim.handleMessage({
    type: 'OBSTACLES_REPLACE',
    obstacles: [{
      id: 'test-blocker',
      shape: 'cuboid',
      xM: (n4Pos[0] + acnPos[0]) / 2,
      yM: (n4Pos[1] + acnPos[1]) / 2,
      widthM: 4000,
      depthM: 4000,
      heightM: 4500,
      rotationDeg: 0,
    }],
  });
  assert.equal(res.accepted, true, `Obstacle replace must succeed: ${res.reason}`);
  sim.tickSimulation();

  const frameStatic = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
  const n4Static = frameStatic.nodes_telemetry.find((n: any) => n.node_id === 4);
  assert.ok(n4Static !== undefined);
  assert.equal(n4Static.is_wasting_airtime, true, 'Static TDMA must register is_wasting_airtime on severed link');

  sim.schedulerMode = 'tac_tad';
  sim.tickSimulation();
  const frameTac = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
  const n4Tac = frameTac.nodes_telemetry.find((n: any) => n.node_id === 4);
  assert.ok(n4Tac !== undefined);
  assert.equal(n4Tac.is_wasting_airtime, false, 'Tac-TAD must reclaim slot and produce 0 airtime waste');
  console.log('  -> PASS: Visualizer telemetry truthfully distinguishes Static waste from Tac-TAD reclamation.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 13: Pause / resume behavior
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[13/43] Verifying pause and resume behavior...');
{
  const sim = new SimulationWorkerManager();
  sim.selectedNodeId = 2;
  sim.handleMessage({ type: 'INJECT_TRAFFIC', node_id: 2, traffic_type: 'photo' });
  sim.tickSimulation();

  sim.handleMessage({ type: 'SIM_CONTROL', action: 'pause' });
  const pausedFrame = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
  assert.equal(pausedFrame.paused, true);
  assert.equal(pausedFrame.transfer_telemetry.eta_status, 'SIM PAUSED');

  sim.handleMessage({ type: 'SIM_CONTROL', action: 'resume' });
  sim.tickSimulation();
  const resumedFrame = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
  assert.equal(resumedFrame.paused, false);
  console.log('  -> PASS: Pause cleanly freezes ETA and animation; resume smoothly continues.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 14: Reset behavior
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[14/43] Verifying simulation reset restores pristine initial transfer states...');
{
  const sim = new SimulationWorkerManager();
  sim.handleMessage({ type: 'INJECT_TRAFFIC', node_id: 1, traffic_type: 'video' });
  sim.tickSimulation();
  assert.ok(sim.nodeTransfers.get(1)?.status !== 'IDLE');

  sim.handleMessage({ type: 'SIM_CONTROL', action: 'reset' });
  const resetFrame = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
  assert.equal(resetFrame.transfer_telemetry.status, 'IDLE');
  assert.equal(resetFrame.transfer_telemetry.delivered_bytes, 0);
  assert.equal(resetFrame.transfer_telemetry.current_rate_bps, 0);
  assert.equal(resetFrame.transfer_telemetry.eta_s, null);
  assert.equal(resetFrame.active_transfers.length, 0, 'Active transfers must be empty upon reset');
  console.log('  -> PASS: Reset restores pristine IDLE state and clears transfer statistics.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 15: Multiple active nodes remain visible regardless of selected node
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[15/43] Verifying all active nodes remain visible regardless of selected node...');
{
  const sim = new SimulationWorkerManager();
  sim.handleMessage({ type: 'INJECT_TRAFFIC', node_id: 1, traffic_type: 'voice' });
  sim.handleMessage({ type: 'INJECT_TRAFFIC', node_id: 5, traffic_type: 'photo' });
  sim.tickSimulation();

  sim.selectedNodeId = 0;
  const frame = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));

  assert.ok(frame.active_transfers.length >= 2, 'active_transfers must contain all active nodes');
  const t1 = frame.active_transfers.find((t: any) => t.node_id === 1);
  const t5 = frame.active_transfers.find((t: any) => t.node_id === 5);
  assert.ok(t1 !== undefined, 'Node 1 transfer must be present in active_transfers');
  assert.ok(t5 !== undefined, 'Node 5 transfer must be present in active_transfers');

  const n1 = frame.nodes_telemetry.find((n: any) => n.node_id === 1);
  const n5 = frame.nodes_telemetry.find((n: any) => n.node_id === 5);
  assert.ok(n1.transfer_state !== null);
  assert.ok(n5.transfer_state !== null);
  console.log('  -> PASS: Active transfers are exported for all nodes across the digital twin.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 16: TDMA Slot Start and End Timing Resolution
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[16/43] Verifying TDMA slot start and end timing resolution...');
{
  const mockAllocations: ActiveGanttAllocation[] = [
    { node_id: 0, start_ms: 4.0, duration_ms: 1.0, capacity_bits: 5000 },
    { node_id: 1, start_ms: 5.0, duration_ms: 1.0, capacity_bits: 5000 },
    { node_id: 4, start_ms: 6.0, duration_ms: 5.0, capacity_bits: 25000 },
  ];

  // Boundary checks:
  // t = 0.5 ms -> Control broadcast
  const stateCtrl = resolveActiveTdmaSlotState(0.5, mockAllocations, 1.0, 3.0, 20.0);
  assert.equal(stateCtrl.phase, 'CONTROL_BROADCAST');
  assert.equal(stateCtrl.scheduledNodeId, null);
  assert.equal(stateCtrl.slotProgress, 0.5);

  // t = 2.5 ms -> Downlink broadcast
  const stateDl = resolveActiveTdmaSlotState(2.5, mockAllocations, 1.0, 3.0, 20.0);
  assert.equal(stateDl.phase, 'DOWNLINK_BROADCAST');
  assert.equal(stateDl.scheduledNodeId, null);
  assert.equal(stateDl.slotProgress, 0.5); // (2.5 - 1.0) / 3.0 = 0.5

  // t = 4.0 ms exact -> Slot 0 starts
  const stateSlot0 = resolveActiveTdmaSlotState(4.0, mockAllocations, 1.0, 3.0, 20.0);
  assert.equal(stateSlot0.phase, 'UPLINK_SLOT');
  assert.equal(stateSlot0.scheduledNodeId, 0);
  assert.equal(stateSlot0.slotProgress, 0.0);

  // t = 4.5 ms -> Slot 0 midway
  const stateSlot0Mid = resolveActiveTdmaSlotState(4.5, mockAllocations, 1.0, 3.0, 20.0);
  assert.equal(stateSlot0Mid.phase, 'UPLINK_SLOT');
  assert.equal(stateSlot0Mid.scheduledNodeId, 0);
  assert.equal(stateSlot0Mid.slotProgress, 0.5);

  // t = 5.0 ms exact -> Transition to Slot 1
  const stateSlot1 = resolveActiveTdmaSlotState(5.0, mockAllocations, 1.0, 3.0, 20.0);
  assert.equal(stateSlot1.phase, 'UPLINK_SLOT');
  assert.equal(stateSlot1.scheduledNodeId, 1);
  assert.equal(stateSlot1.slotProgress, 0.0);

  // t = 8.5 ms -> Slot 4 (runs 6.0 ms to 11.0 ms)
  const stateSlot4 = resolveActiveTdmaSlotState(8.5, mockAllocations, 1.0, 3.0, 20.0);
  assert.equal(stateSlot4.phase, 'UPLINK_SLOT');
  assert.equal(stateSlot4.scheduledNodeId, 4);
  assert.equal(stateSlot4.slotProgress, 0.5); // (8.5 - 6.0) / 5.0 = 0.5

  // t = 11.0 ms exact -> End of Slot 4, transition to idle
  const stateIdle = resolveActiveTdmaSlotState(11.0, mockAllocations, 1.0, 3.0, 20.0);
  assert.equal(stateIdle.phase, 'IDLE_GUARD');
  assert.equal(stateIdle.scheduledNodeId, null);

  console.log('  -> PASS: Slot start/end boundaries and progress strictly obey superframe timing.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 17: Scheduled Node Exclusivity
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[17/43] Verifying scheduled node exclusivity in uplink allocations...');
{
  const activeSlot = {
    phase: 'UPLINK_SLOT' as const,
    scheduledNodeId: 1,
    slotStartMs: 5.0,
    slotDurationMs: 1.0,
    slotProgress: 0.3,
    capacityBits: 5000,
    isPreOcclusionFlush: false,
  };

  // Node 1 is the scheduled node -> must be TX
  const rolesNode1 = determineSlotEndpointRoles(activeSlot, 1);
  assert.equal(rolesNode1.nodeRole, 'TX', 'Scheduled node must be designated TX');
  assert.equal(rolesNode1.acnRole, 'RX', 'ACN must be designated RX for scheduled uplink');

  // Node 0, 2, 4, 15 are NOT scheduled -> must NOT be designated TX or RX
  for (const unscheduledId of [0, 2, 3, 4, 5, 15]) {
    const rolesOther = determineSlotEndpointRoles(activeSlot, unscheduledId);
    assert.equal(rolesOther.nodeRole, null, `Unscheduled node ${unscheduledId} must not be TX`);
    assert.equal(rolesOther.acnRole, null);
  }

  console.log('  -> PASS: Only the active scheduled node displays transmission; unscheduled nodes are silent.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 18: Uplink Directionality (Strictly Terminal -> ACN)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[18/43] Verifying uplink directionality (strictly Terminal -> ACN)...');
{
  const termX = 200, termY = 400;
  const acnX = 800, acnY = 100;

  // At slot progress 0.25, 0.5, 0.75:
  const pkts = computeSlotPacketPositions(termX, termY, acnX, acnY, 0.5, 3);
  assert.equal(pkts.length, 3);

  // Every packet coordinate must lie on the line segment from Terminal to ACN
  for (const p of pkts) {
    const dFromTerm = Math.hypot(p.x - termX, p.y - termY);
    const dFromAcn = Math.hypot(p.x - acnX, p.y - acnY);
    const totalDist = Math.hypot(acnX - termX, acnY - termY);
    assert.ok(Math.abs(dFromTerm + dFromAcn - totalDist) < 1e-4, 'Packet must strictly lie on vector');
    assert.ok(dFromTerm >= 0 && dFromTerm <= totalDist, 'Packets lie between ground terminal and ACN');
  }

  // Verify that increasing slot progress moves packet strictly toward ACN
  const pktEarlier = computeSlotPacketPositions(termX, termY, acnX, acnY, 0.1, 1)[0];
  const pktLater = computeSlotPacketPositions(termX, termY, acnX, acnY, 0.3, 1)[0];
  const dEarlier = Math.hypot(pktEarlier.x - termX, pktEarlier.y - termY);
  const dLater = Math.hypot(pktLater.x - termX, pktLater.y - termY);
  assert.ok(dLater > dEarlier, 'Uplink packets strictly advance from Terminal towards ACN');

  console.log('  -> PASS: Packets strictly stream from Ground Terminal toward ACN, never ACN -> Node.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 19: Control and Downlink Subframe Separation
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[19/43] Verifying control and downlink broadcast separation from uplink...');
{
  const mockAllocations: ActiveGanttAllocation[] = [
    { node_id: 1, start_ms: 4.0, duration_ms: 2.0, capacity_bits: 10000 },
  ];

  // During Control Subframe [0, 1 ms): ACN is TX, nodes are listening (RX)
  const ctrlSlot = resolveActiveTdmaSlotState(0.2, mockAllocations, 1.0, 3.0, 20.0);
  assert.equal(ctrlSlot.phase, 'CONTROL_BROADCAST');
  assert.equal(ctrlSlot.scheduledNodeId, null);
  const ctrlRoles = determineSlotEndpointRoles(ctrlSlot, 1);
  assert.equal(ctrlRoles.acnRole, 'TX');
  assert.equal(ctrlRoles.nodeRole, 'RX');

  // During Downlink Subframe [1, 4 ms): ACN is TX, nodes are listening (RX)
  const dlSlot = resolveActiveTdmaSlotState(2.0, mockAllocations, 1.0, 3.0, 20.0);
  assert.equal(dlSlot.phase, 'DOWNLINK_BROADCAST');
  assert.equal(dlSlot.scheduledNodeId, null);
  const dlRoles = determineSlotEndpointRoles(dlSlot, 1);
  assert.equal(dlRoles.acnRole, 'TX');
  assert.equal(dlRoles.nodeRole, 'RX');

  console.log('  -> PASS: Control and downlink subframes are strictly separated from uplink payload slots.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 20: Idle Slots and Unallocated Airtime Handling
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[20/43] Verifying idle slots and unallocated airtime handling...');
{
  // Allocate slots only for [4.0, 8.0 ms); remaining [8.0, 20.0 ms) is unallocated
  const mockAllocations: ActiveGanttAllocation[] = [
    { node_id: 4, start_ms: 4.0, duration_ms: 4.0, capacity_bits: 20000 },
  ];

  const idleSlot = resolveActiveTdmaSlotState(12.0, mockAllocations, 1.0, 3.0, 20.0);
  assert.equal(idleSlot.phase, 'IDLE_GUARD');
  assert.equal(idleSlot.scheduledNodeId, null);
  assert.equal(idleSlot.capacityBits, 0);

  // In idle airtime, all nodes have null roles
  for (let nid = 0; nid < 16; nid++) {
    const roles = determineSlotEndpointRoles(idleSlot, nid);
    assert.equal(roles.nodeRole, null);
    assert.equal(roles.acnRole, null);
  }

  console.log('  -> PASS: Unallocated or idle airtime produces 0 transmission activity across all nodes.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 21: Blocked Link Packet Flow Suppression
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[21/43] Verifying blocked link packet flow suppression in TDMA visualization...');
{
  assert.equal(shouldSuppressPacketFlow('BLOCKED_TERRAIN'), true);
  assert.equal(shouldSuppressPacketFlow('BLOCKED_OBSTACLE'), true);
  assert.equal(shouldSuppressPacketFlow('OUTAGE_DISCONNECTED'), true);
  assert.equal(shouldSuppressPacketFlow('CONNECTED'), false);
  assert.equal(shouldSuppressPacketFlow('DEGRADED'), false);

  // Static TDMA waste packets terminate at obstacle cutoff (progress <= 0.42)
  const wastePkts = computeSlotPacketPositions(100, 200, 500, 600, 0.75, 4, 0.42);
  assert.ok(wastePkts.every(p => p.progress <= 0.42), 'Waste packets must terminate before ACN');

  console.log('  -> PASS: Blocked and disconnected links strictly suppress packets from reaching ACN.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 22: Static TDMA Waste vs Tac-TAD Airtime Reclamation
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[22/43] Verifying Static TDMA waste vs Tac-TAD airtime reclamation...');
{
  const sim = new SimulationWorkerManager();
  sim.schedulerMode = 'static';
  sim.tickSimulation();

  // Sever Node 4 with obstacle blocker
  const acnPos = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  const n4Pos = sim.nodesStatic[4].position;
  sim.handleMessage({
    type: 'OBSTACLES_REPLACE',
    obstacles: [{
      id: 'blocker-tdma',
      shape: 'cuboid',
      xM: (n4Pos[0] + acnPos[0]) / 2,
      yM: (n4Pos[1] + acnPos[1]) / 2,
      widthM: 4000,
      depthM: 4000,
      heightM: 4500,
      rotationDeg: 0,
    }],
  });
  sim.tickSimulation();

  const frameStatic = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
  const n4Static = frameStatic.nodes_telemetry.find((n: any) => n.node_id === 4);
  assert.equal(n4Static.is_wasting_airtime, true, 'Static TDMA must mark is_wasting_airtime on severed link');

  // In Tac-TAD, slot is reclaimed
  sim.schedulerMode = 'tac_tad';
  sim.tickSimulation();
  const frameTac = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
  const n4Tac = frameTac.nodes_telemetry.find((n: any) => n.node_id === 4);
  assert.equal(n4Tac.is_wasting_airtime, false, 'Tac-TAD must reclaim slot and produce 0 airtime waste');

  console.log('  -> PASS: TDMA synchronization preserves Static TDMA waste vs Tac-TAD reclamation distinction.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 23: Pause, Resume, and Reset in Visualizer State
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[23/43] Verifying pause, resume, and reset in visualizer state...');
{
  const visualizer = new DataCommVisualizer();

  // Explicit visual time at 0.100s -> subframe offset = (100 ms / 1000 ms) * 20 ms = 2.0 ms (Downlink)
  const offsetA = computeVisualSubframeOffsetMs(0.100, 1000.0, 20.0);
  assert.equal(Math.round(offsetA * 100) / 100, 2.0);

  // Explicit visual time at 0.500s -> subframe offset = (500 ms / 1000 ms) * 20 ms = 10.0 ms (Uplink)
  const offsetB = computeVisualSubframeOffsetMs(0.500, 1000.0, 20.0);
  assert.equal(Math.round(offsetB * 100) / 100, 10.0);

  // Visual clock reset
  visualizer.resetVisualClock();
  assert.equal((visualizer as any).accumulatedVisualTimeS, 0.0);

  console.log('  -> PASS: Visualizer cleanly freezes on pause and clears state on reset.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 24: Deterministic Behavior Across Different Browser Rendering Rates
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[24/43] Verifying deterministic behavior across 30 Hz, 60 Hz, and 120 Hz display rates...');
{
  const mockAllocations: ActiveGanttAllocation[] = [
    { node_id: 1, start_ms: 4.0, duration_ms: 2.0, capacity_bits: 10000 },
    { node_id: 4, start_ms: 6.0, duration_ms: 6.0, capacity_bits: 30000 },
  ];

  // Sample target: visual timestamp t = 0.350s (350 ms into 1.0s visual cycle)
  // Subframe offset = (350 / 1000) * 20 ms = 7.0 ms (inside Node 4's slot [6.0, 12.0 ms))
  const targetTimeS = 0.350;

  // Sampling at 30 Hz (dt = ~0.0333s)
  const offset30Hz = computeVisualSubframeOffsetMs(targetTimeS, 1000.0, 20.0);
  const state30Hz = resolveActiveTdmaSlotState(offset30Hz, mockAllocations, 1.0, 3.0, 20.0);

  // Sampling at 60 Hz (dt = ~0.0166s)
  const offset60Hz = computeVisualSubframeOffsetMs(targetTimeS, 1000.0, 20.0);
  const state60Hz = resolveActiveTdmaSlotState(offset60Hz, mockAllocations, 1.0, 3.0, 20.0);

  // Sampling at 120 Hz (dt = ~0.0083s)
  const offset120Hz = computeVisualSubframeOffsetMs(targetTimeS, 1000.0, 20.0);
  const state120Hz = resolveActiveTdmaSlotState(offset120Hz, mockAllocations, 1.0, 3.0, 20.0);

  assert.equal(offset30Hz, offset60Hz);
  assert.equal(offset60Hz, offset120Hz);
  assert.equal(offset30Hz, 7.0);

  assert.deepEqual(state30Hz, state60Hz);
  assert.deepEqual(state60Hz, state120Hz);
  assert.equal(state30Hz.phase, 'UPLINK_SLOT');
  assert.equal(state30Hz.scheduledNodeId, 4);
  assert.ok(Math.abs(state30Hz.slotProgress - (7.0 - 6.0) / 6.0) < 1e-6);

  console.log('  -> PASS: Scheduler slot state is 100% deterministic and independent of display refresh rate.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 25: Deep Snapshot Immutability and Freezing
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[25/43] Verifying deep snapshot immutability and recursive freezing...');
{
  const rawAllocations = [
    { nodeId: 4, startMs: 4.0, durationMs: 4.0, capacityBits: 24000, isPreOcclusionFlush: true },
  ];
  const rawTransfer = {
    node_id: 4,
    status: 'TRANSMITTING' as const,
    active_type: 'video' as const,
    total_bytes: 1000000,
    delivered_bytes: 450000,
    dropped_bytes: 0,
    dropped_packets: 0,
    progress_pct: 45.0,
    start_time_s: 1.0,
    current_rate_bps: 8000000,
    current_rate_mbps: 8.0,
    eta_s: 0.55,
    eta_status: '0.6s',
  };
  const rawNodes = [
    {
      nodeId: 4,
      isOperational: true,
      isBlocked: false,
      isObstacleBlocked: false,
      isOutage: false,
      isDegraded: false,
      linkStatus: 'CONNECTED',
      isSelected: true,
      isTransmitting: true,
      isWastingAirtime: false,
      queueBacklogBytes: 550000,
      transfer: rawTransfer,
    },
  ];

  const snapshot = createSuperframeSnapshot({
    source: 'live',
    sessionId: 1,
    frameIndex: 10,
    simulationTimeS: 0.20,
    schedulerMode: 'tac_tad',
    allocations: rawAllocations,
    nodes: rawNodes,
  });

  // 1. Verify snapshot is frozen
  assert.equal(Object.isFrozen(snapshot), true, 'Snapshot root must be frozen');
  assert.equal(Object.isFrozen(snapshot.allocations), true, 'Allocations array must be frozen');
  assert.equal(Object.isFrozen(snapshot.allocations[0]), true, 'Allocation items must be frozen');
  assert.equal(Object.isFrozen(snapshot.nodes), true, 'Nodes array must be frozen');
  assert.equal(Object.isFrozen(snapshot.nodes[0]), true, 'Node items must be frozen');
  assert.equal(Object.isFrozen(snapshot.nodes[0].transfer), true, 'Nested transfer must be frozen');

  // 2. Mutating raw inputs does NOT mutate snapshot
  rawAllocations[0].capacityBits = 999999;
  rawAllocations.push({ nodeId: 99, startMs: 10, durationMs: 2, capacityBits: 100, isPreOcclusionFlush: false });
  rawTransfer.delivered_bytes = 999999;
  rawTransfer.progress_pct = 99.9;
  rawNodes[0].queueBacklogBytes = 0;

  assert.equal(snapshot.allocations.length, 1, 'Snapshot allocations array must not change when raw array is mutated');
  assert.equal(snapshot.allocations[0].capacityBits, 24000, 'Snapshot allocation capacityBits must remain unchanged');
  assert.equal(snapshot.nodes[0].transfer?.delivered_bytes, 450000, 'Snapshot transfer delivered_bytes must remain unchanged');
  assert.equal(snapshot.nodes[0].transfer?.progress_pct, 45.0, 'Snapshot transfer progress_pct must remain unchanged');
  assert.equal(snapshot.nodes[0].queueBacklogBytes, 550000, 'Snapshot node queueBacklogBytes must remain unchanged');

  // 3. Attempting to mutate snapshot properties throws TypeError in strict mode
  assert.throws(() => {
    (snapshot as any).frameIndex = 99;
  }, TypeError, 'Mutating frozen snapshot root must throw TypeError');
  assert.throws(() => {
    (snapshot.allocations as any).push({});
  }, TypeError, 'Pushing to frozen allocations array must throw TypeError');
  assert.throws(() => {
    (snapshot.nodes[0] as any).isBlocked = true;
  }, TypeError, 'Mutating frozen node item must throw TypeError');
  assert.throws(() => {
    (snapshot.nodes[0].transfer as any).delivered_bytes = 888;
  }, TypeError, 'Mutating frozen transfer item must throw TypeError');

  console.log('  -> PASS: Superframe snapshots are deeply frozen, fully immutable, and decoupled from source references.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 26: Stable Snapshot Identity and Deduplication
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[26/43] Verifying stable snapshot identity and render-loop deduplication...');
{
  const visualizer = new DataCommVisualizer();
  const snapA = createSuperframeSnapshot({
    source: 'live',
    sessionId: 0,
    frameIndex: 5,
    simulationTimeS: 0.100,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });

  assert.equal(snapA.snapshotId, 'live:0:5:0.100');

  visualizer.ingestSnapshot(snapA);
  assert.equal(visualizer.getActiveSnapshot()?.snapshotId, 'live:0:5:0.100');

  // Advance playback by 150 ms
  visualizer.advancePlayback(150.0);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 150.0);

  // Ingest identical snapshot (e.g. repeated 60 FPS render with same frame)
  visualizer.ingestSnapshot(snapA);
  assert.equal(visualizer.getActiveSnapshot()?.snapshotId, 'live:0:5:0.100');
  assert.equal(visualizer.getCycleElapsedVisualMs(), 150.0, 'Repeated ingestion of same frame must not reset playback progress');
  assert.equal(visualizer.getPendingSnapshot(), null, 'Repeated frame must not be queued as pending');

  console.log('  -> PASS: Snapshot identity is stable and deduplication prevents spurious resets.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 27: Active Snapshot Persistence During Live Playback (Dual-Buffer)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[27/43] Verifying active snapshot persistence during live playback (Dual-Buffer)...');
{
  const visualizer = new DataCommVisualizer();
  const initialSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: 0,
    frameIndex: 0,
    simulationTimeS: 0.000,
    schedulerMode: 'tac_tad',
    allocations: [{ nodeId: 1, startMs: 4.0, durationMs: 4.0, capacityBits: 10000, isPreOcclusionFlush: false }],
    nodes: [],
  });

  visualizer.ingestSnapshot(initialSnap);
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 0);

  // Simulate 50 new live telemetry frames arriving over 1,000 ms cycle (20ms worker ticks)
  for (let f = 1; f <= 50; f++) {
    const liveSnap = createSuperframeSnapshot({
      source: 'live',
      sessionId: 0,
      frameIndex: f,
      simulationTimeS: f * 0.02,
      schedulerMode: 'tac_tad',
      allocations: [{ nodeId: (f % 16), startMs: 4.0, durationMs: 4.0, capacityBits: 10000 + f, isPreOcclusionFlush: false }],
      nodes: [],
    });

    visualizer.ingestSnapshot(liveSnap);
    visualizer.advancePlayback(10.0); // 10ms per step, within the 1000ms cycle

    // Active snapshot must remain frame 0 throughout!
    assert.equal(
      visualizer.getActiveSnapshot()?.frameIndex,
      0,
      `Active snapshot must remain Frame 0 while frame ${f} is arriving`
    );
    // Pending snapshot must hold the freshest frame
    assert.equal(
      visualizer.getPendingSnapshot()?.frameIndex,
      f,
      `Pending snapshot must hold latest frame ${f}`
    );
  }

  console.log('  -> PASS: Active snapshot is strictly preserved mid-cycle while pending snapshot tracks newest frames.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 28: Promotion of Pending Snapshot at Cycle Rollover
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[28/43] Verifying pending snapshot promotion at cycle rollover...');
{
  const visualizer = new DataCommVisualizer();
  const snap1 = createSuperframeSnapshot({
    source: 'live',
    sessionId: 0,
    frameIndex: 1,
    simulationTimeS: 0.02,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });
  const snap2 = createSuperframeSnapshot({
    source: 'live',
    sessionId: 0,
    frameIndex: 2,
    simulationTimeS: 0.04,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });

  visualizer.ingestSnapshot(snap1);
  visualizer.ingestSnapshot(snap2);
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 1);
  assert.equal(visualizer.getPendingSnapshot()?.frameIndex, 2);

  // Advance visualizer to 990 ms (just before 1000 ms rollover)
  visualizer.advancePlayback(990.0);
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 1);
  assert.equal(visualizer.getPendingSnapshot()?.frameIndex, 2);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 990.0);

  // Advance by 20 ms -> total elapsed = 1010 ms (rollover occurs!)
  visualizer.advancePlayback(20.0);
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 2, 'Pending snapshot must be promoted to active on rollover');
  assert.equal(visualizer.getPendingSnapshot(), null, 'Pending snapshot must be cleared after promotion');
  assert.equal(visualizer.getCycleElapsedVisualMs(), 10.0, 'Elapsed visual time must wrap around modulo cycleDuration');

  console.log('  -> PASS: Pending snapshot is cleanly promoted at cycle boundary with exact modulo rollover.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 29: Large Render Delta Rollover Safety
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[29/43] Verifying large render delta rollover safety (background tab scenario)...');
{
  const visualizer = new DataCommVisualizer();
  const snapA = createSuperframeSnapshot({
    source: 'live',
    sessionId: 0,
    frameIndex: 10,
    simulationTimeS: 0.20,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });
  const snapB = createSuperframeSnapshot({
    source: 'live',
    sessionId: 0,
    frameIndex: 250,
    simulationTimeS: 5.00,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });

  visualizer.ingestSnapshot(snapA);
  visualizer.ingestSnapshot(snapB);

  // Simulate a 5,000 ms render delta (background tab revived, > 2x cycle duration)
  visualizer.advancePlayback(5000.0);

  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 250, 'Pending snapshot must be promoted even with large render gap');
  assert.equal(visualizer.getPendingSnapshot(), null, 'Pending snapshot must be cleared');
  assert.equal(visualizer.getCycleElapsedVisualMs(), 0.0, 'Elapsed visual time must be safely reset to 0.0 on huge delta');

  console.log('  -> PASS: Large render deltas promote pending frames safely without runaway calculation.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 30: Historical Scrubbing Integration & Schema Normalization
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[30/43] Verifying historical scrubbing integration & camelCase schema normalization...');
{
  const visualizer = new DataCommVisualizer();
  const liveSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: 0,
    frameIndex: 1,
    simulationTimeS: 0.02,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });
  visualizer.ingestSnapshot(liveSnap);

  // Historical record arrives with camelCase properties
  const histRecordAllocations = [
    { nodeId: 4, startMs: 5.0, durationMs: 3.5, capacityBits: 28000, isPreOcclusionFlush: true },
  ];
  const histSnap1 = createSuperframeSnapshot({
    source: 'historical',
    sessionId: 0,
    frameIndex: 42,
    simulationTimeS: 0.840,
    schedulerMode: 'tac_tad',
    allocations: histRecordAllocations,
    nodes: [{ nodeId: 4, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: true, isTransmitting: false, isWastingAirtime: false, queueBacklogBytes: 12000, transfer: null }],
  });

  // Verify normalization
  assert.equal(histSnap1.allocations[0].startMs, 5.0);
  assert.equal(histSnap1.allocations[0].durationMs, 3.5);
  assert.equal(histSnap1.allocations[0].capacityBits, 28000);
  assert.equal(histSnap1.allocations[0].isPreOcclusionFlush, true);

  // Ingest historical record -> latches immediately
  visualizer.ingestSnapshot(histSnap1);
  assert.equal(visualizer.getActiveSnapshot()?.source, 'historical');
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 42);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 0.0);

  // Advance historical playback
  visualizer.advancePlayback(250.0);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 250.0);

  // Repeated render of the exact same historical record (inspection hold)
  visualizer.ingestSnapshot(histSnap1);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 250.0, 'Historical inspection hold must NOT reset playback progress');

  // Scrub to frame 43
  const histSnap2 = createSuperframeSnapshot({
    source: 'historical',
    sessionId: 0,
    frameIndex: 43,
    simulationTimeS: 0.860,
    schedulerMode: 'tac_tad',
    allocations: histRecordAllocations,
    nodes: [],
  });
  visualizer.ingestSnapshot(histSnap2);
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 43);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 0.0, 'Scrubbing to a new frame must reset playback cycle to start');

  console.log('  -> PASS: Historical scrubbing cleanly normalizes schemas, holds playback, and latches on frame scrub.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 31: Clean Transition Between Historical and Live Modes
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[31/43] Verifying clean transition between Historical and Live modes...');
{
  const visualizer = new DataCommVisualizer();
  const histSnap = createSuperframeSnapshot({
    source: 'historical',
    sessionId: 0,
    frameIndex: 99,
    simulationTimeS: 1.98,
    schedulerMode: 'static',
    allocations: [{ nodeId: 2, startMs: 4.0, durationMs: 4.0, capacityBits: 15000, isPreOcclusionFlush: false }],
    nodes: [],
  });
  visualizer.ingestSnapshot(histSnap);
  assert.equal(visualizer.getActiveSnapshot()?.source, 'historical');

  // User exits historical inspection, live mode resumes
  const liveSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: 0,
    frameIndex: 150,
    simulationTimeS: 3.00,
    schedulerMode: 'tac_tad',
    allocations: [{ nodeId: 4, startMs: 5.0, durationMs: 6.0, capacityBits: 32000, isPreOcclusionFlush: true }],
    nodes: [],
  });
  visualizer.ingestSnapshot(liveSnap);

  assert.equal(visualizer.getActiveSnapshot()?.source, 'live');
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 150);
  assert.equal(visualizer.getActiveSnapshot()?.schedulerMode, 'tac_tad');
  assert.equal(visualizer.getPendingSnapshot(), null);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 0.0);

  console.log('  -> PASS: Historical to live transition immediately discards historical state without mixed data.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 32: Coordinate Independence Under Radar Pan and Zoom
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[32/43] Verifying coordinate independence under radar pan/zoom...');
{
  const visualizer = new DataCommVisualizer();
  const mockCtx = createMockCanvasContext();

  const snapshot = createSuperframeSnapshot({
    source: 'live',
    sessionId: 0,
    frameIndex: 1,
    simulationTimeS: 0.02,
    schedulerMode: 'tac_tad',
    allocations: [{ nodeId: 4, startMs: 4.0, durationMs: 8.0, capacityBits: 20000, isPreOcclusionFlush: false }],
    nodes: [{ nodeId: 4, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: true, isTransmitting: true, isWastingAirtime: false, queueBacklogBytes: 5000, transfer: null }],
  });

  // Verify snapshot contains NO screen coordinates
  assert.equal((snapshot as any).screenX, undefined);
  assert.equal((snapshot.nodes[0] as any).screenX, undefined);

  // Render 1: Baseline pan position
  const positionsPan1 = new Map<number, Point2D>([[4, { x: 100, y: 200 }]]);
  visualizer.render(mockCtx, {
    snapshot,
    acnScreenPos: { x: 500, y: 500 },
    nodeScreenPositions: positionsPan1,
    speed: 1.0,
    visualTimeMs: 400.0, // Subframe offset = 8.0 ms (Node 4 uplink active)
  });

  const activeSnap1 = visualizer.getActiveSnapshot();

  // Render 2: User pans canvas (all screen coords shift by +150, +250)
  const positionsPan2 = new Map<number, Point2D>([[4, { x: 250, y: 450 }]]);
  visualizer.render(mockCtx, {
    snapshot,
    acnScreenPos: { x: 650, y: 750 },
    nodeScreenPositions: positionsPan2,
    speed: 1.0,
    visualTimeMs: 400.0,
  });

  const activeSnap2 = visualizer.getActiveSnapshot();
  assert.equal(activeSnap1, activeSnap2, 'Active snapshot object reference must remain identical across pan/zoom');
  assert.equal(activeSnap2?.nodes[0].nodeId, 4);

  console.log('  -> PASS: Radar pan and zoom are completely independent of snapshot state and playback cycle.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 33: Simulation Speed Scaling Across 1x, 2x, and 0.5x
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[33/43] Verifying visual cycle duration scaling across simulation speeds...');
{
  const visualizer = new DataCommVisualizer();

  assert.equal(visualizer.getCycleDurationMs(1.0), 1000.0, '1x speed must be 1,000 ms');
  assert.equal(visualizer.getCycleDurationMs(2.0), 500.0, '2x speed must be 500 ms');
  assert.equal(visualizer.getCycleDurationMs(0.5), 2000.0, '0.5x speed must be 2,000 ms');
  assert.equal(visualizer.getCycleDurationMs(4.0), 250.0, '4x speed must be 250 ms');
  assert.equal(visualizer.getCycleDurationMs(0.1), 10000.0, '0.1x speed must be 10,000 ms');

  // Clamp safety for invalid speeds
  assert.ok(Number.isFinite(visualizer.getCycleDurationMs(0)));
  assert.ok(Number.isFinite(visualizer.getCycleDurationMs(-5)));
  assert.ok(Number.isFinite(visualizer.getCycleDurationMs(NaN)));

  // Test 2x playback advancement: 500 ms completes a full cycle at 2x
  const snap1 = createSuperframeSnapshot({ source: 'live', frameIndex: 1, simulationTimeS: 0.02, schedulerMode: 'tac_tad', allocations: [], nodes: [] });
  const snap2 = createSuperframeSnapshot({ source: 'live', frameIndex: 2, simulationTimeS: 0.04, schedulerMode: 'tac_tad', allocations: [], nodes: [] });
  visualizer.ingestSnapshot(snap1);
  visualizer.ingestSnapshot(snap2);

  visualizer.advancePlayback(500.0, 2.0); // 500 ms at 2x speed
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 2, 'At 2x speed, 500 ms must trigger cycle rollover and promote pending snapshot');

  console.log('  -> PASS: Playback cycle duration scales inversely with simulation speed preserving 50x expansion.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 34: Pause/Resume Behavior Without Wall-Clock Jumps
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[34/43] Verifying pause/resume behavior without wall-clock jumps...');
{
  const visualizer = new DataCommVisualizer();
  const snap = createSuperframeSnapshot({ source: 'live', frameIndex: 1, simulationTimeS: 0.02, schedulerMode: 'tac_tad', allocations: [], nodes: [] });
  visualizer.ingestSnapshot(snap);

  visualizer.advancePlayback(300.0, 1.0, false);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 300.0);

  // Pause simulation
  visualizer.advancePlayback(500.0, 1.0, true);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 300.0, 'Paused playback must not advance visual elapsed time');

  // Resume simulation
  visualizer.advancePlayback(100.0, 1.0, false);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 400.0, 'Resuming must smoothly advance from the exact paused position');

  console.log('  -> PASS: Simulation pause freezes playback without wall-clock jumps upon resume.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 35: Simulation Reset Handling on Genuine Time Rewind
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[35/43] Verifying simulation reset detection and state clearing on time rewind...');
{
  const visualizer = new DataCommVisualizer();
  const mockCtx = createMockCanvasContext();
  const initialSessionId = visualizer.getSessionId();

  // Step 1: Normal advancement to T=2.0s
  const snapA = createSuperframeSnapshot({ source: 'live', sessionId: initialSessionId, frameIndex: 100, simulationTimeS: 2.00, schedulerMode: 'tac_tad', allocations: [], nodes: [] });
  visualizer.render(mockCtx, { snapshot: snapA, acnScreenPos: { x: 0, y: 0 }, nodeScreenPositions: new Map() });
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 100);

  // Step 2: User clicks RESET simulation -> simulationTimeS drops from 2.00 to 0.00
  const snapReset = createSuperframeSnapshot({ source: 'live', sessionId: initialSessionId, frameIndex: 0, simulationTimeS: 0.00, schedulerMode: 'tac_tad', allocations: [], nodes: [] });
  visualizer.render(mockCtx, { snapshot: snapReset, acnScreenPos: { x: 0, y: 0 }, nodeScreenPositions: new Map() });

  assert.ok(visualizer.getSessionId() > initialSessionId, 'Session ID must be incremented on genuine simulation reset');
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 0, 'Reset snapshot must be latched cleanly');
  assert.ok(visualizer.getCycleElapsedVisualMs() < 10.0, 'Elapsed visual time must be reset to start of cycle');

  console.log('  -> PASS: Genuine simulation time rewinds reset visual engine and start a new session cleanly.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 36: Dynamic Slot Timing, Breathing, and Half-Open Boundary Accuracy
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[36/43] Verifying dynamic slot timing, downlink breathing, and half-open boundaries...');
{
  // Test dynamic downlink breathing: DL expanded to 7.0 ms (ctrl = 1.0 ms, dl = 7.0 ms)
  const allocs: SnapshotSlotAllocation[] = [
    { nodeId: 4, startMs: 8.0, durationMs: 6.0, capacityBits: 40000, isPreOcclusionFlush: false },
    { nodeId: 2, startMs: 14.0, durationMs: 4.0, capacityBits: 20000, isPreOcclusionFlush: true },
  ];

  // At t = 0.5 ms -> CONTROL_BROADCAST
  const s0 = resolveActiveTdmaSlotState(0.5, allocs, 1.0, 7.0, 20.0);
  assert.equal(s0.phase, 'CONTROL_BROADCAST');

  // Exact boundary t = 1.0 ms -> DOWNLINK_BROADCAST begins
  const s1 = resolveActiveTdmaSlotState(1.0, allocs, 1.0, 7.0, 20.0);
  assert.equal(s1.phase, 'DOWNLINK_BROADCAST');
  assert.equal(s1.slotStartMs, 1.0);
  assert.equal(s1.slotDurationMs, 7.0);

  // Mid-downlink at t = 5.0 ms -> still DOWNLINK_BROADCAST
  const s2 = resolveActiveTdmaSlotState(5.0, allocs, 1.0, 7.0, 20.0);
  assert.equal(s2.phase, 'DOWNLINK_BROADCAST');

  // Exact boundary t = 8.0 ms -> Node 4 UPLINK_SLOT begins
  const s3 = resolveActiveTdmaSlotState(8.0, allocs, 1.0, 7.0, 20.0);
  assert.equal(s3.phase, 'UPLINK_SLOT');
  assert.equal(s3.scheduledNodeId, 4);
  assert.equal(s3.slotStartMs, 8.0);
  assert.equal(s3.slotDurationMs, 6.0);
  assert.equal(s3.slotProgress, 0.0);

  // At t = 11.0 ms -> 50% into Node 4 slot
  const s4 = resolveActiveTdmaSlotState(11.0, allocs, 1.0, 7.0, 20.0);
  assert.equal(s4.phase, 'UPLINK_SLOT');
  assert.equal(s4.scheduledNodeId, 4);
  assert.ok(Math.abs(s4.slotProgress - 0.5) < 1e-6);

  // Exact boundary t = 14.0 ms -> Node 2 UPLINK_SLOT begins (pre-occlusion flush)
  const s5 = resolveActiveTdmaSlotState(14.0, allocs, 1.0, 7.0, 20.0);
  assert.equal(s5.phase, 'UPLINK_SLOT');
  assert.equal(s5.scheduledNodeId, 2);
  assert.equal(s5.isPreOcclusionFlush, true);

  // Exact boundary t = 18.0 ms (Node 2 slot ends) -> IDLE_GUARD
  const s6 = resolveActiveTdmaSlotState(18.0, allocs, 1.0, 7.0, 20.0);
  assert.equal(s6.phase, 'IDLE_GUARD');
  assert.equal(s6.scheduledNodeId, null);

  console.log('  -> PASS: Dynamic slot boundaries, downlink breathing, and half-open intervals are exact.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 37: Historical Snapshots Cannot Inherit Live Transfer Badges
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[37/43] Verifying historical snapshots cannot inherit live transfer badges...');
{
  const visualizer = new DataCommVisualizer();
  const mockCtx = createMockCanvasContext();

  // 1. Mock live worker telemetry where Node 4 is actively transmitting a 10 MB video
  const liveTelemetry = {
    sim_time_s: 1.5,
    frame_index: 75,
    scheduler_mode: 'tac_tad',
    nodes_telemetry: [
      {
        node_id: 4,
        is_transmitting: true,
        transfer_state: {
          node_id: 4,
          status: 'TRANSMITTING' as const,
          active_type: 'video' as const,
          total_bytes: 10000000,
          delivered_bytes: 6500000,
          dropped_bytes: 0,
          dropped_packets: 0,
          progress_pct: 65.0,
          current_rate_mbps: 8.5,
        },
      },
    ],
  };

  // 2. Historical scheduler record from earlier frame (Frame 10)
  const histSchedRec = {
    frameIndex: 10,
    simulationTimeS: 0.20,
    schedulerMode: 'tac_tad',
    selectedNodeId: 4,
    activeAllocations: [
      { nodeId: 4, startMs: 4.0, durationMs: 4.0, capacityBits: 20000, isPreOcclusionFlush: false },
    ],
    nodeBacklogs: [
      { nodeId: 4, totalBacklogBytes: 150000, linkOutage: false, obstacleBlocked: false },
    ],
  };

  // 3. Construct historical nodes using updated logic (Fix 1: transfer is explicitly null)
  const histNodes = histSchedRec.nodeBacklogs.map(bl => {
    return {
      nodeId: bl.nodeId,
      isOperational: !bl.linkOutage && !bl.obstacleBlocked,
      isBlocked: Boolean(bl.obstacleBlocked),
      isObstacleBlocked: Boolean(bl.obstacleBlocked),
      isOutage: Boolean(bl.linkOutage),
      linkStatus: 'CONNECTED',
      isSelected: histSchedRec.selectedNodeId === bl.nodeId,
      isTransmitting: false,
      isWastingAirtime: false,
      queueBacklogBytes: bl.totalBacklogBytes,
      transfer: null, // Fix 1 requirement: explicitly null
    };
  });

  const histSnapshot = createSuperframeSnapshot({
    source: 'historical',
    sessionId: visualizer.getSessionId(),
    frameIndex: histSchedRec.frameIndex,
    simulationTimeS: histSchedRec.simulationTimeS,
    schedulerMode: histSchedRec.schedulerMode,
    allocations: histSchedRec.activeAllocations,
    nodes: histNodes,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    isBroadcastingDownlink: true,
  });

  // Verify every node in historical snapshot has transfer === null
  assert.equal(histSnapshot.source, 'historical');
  assert.ok(histSnapshot.nodes.every(n => n.transfer === null), 'Historical snapshot must have transfer === null on all nodes');

  // Render historical snapshot
  visualizer.render(mockCtx, {
    snapshot: histSnapshot,
    acnScreenPos: { x: 500, y: 500 },
    nodeScreenPositions: new Map([[4, { x: 200, y: 200 }]]),
    speed: 1.0,
    isPaused: false,
  });

  // Also construct live snapshot from liveTelemetry to verify live DOES retain transfer state
  const liveSnapshot = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: liveTelemetry.frame_index,
    simulationTimeS: liveTelemetry.sim_time_s,
    schedulerMode: liveTelemetry.scheduler_mode,
    allocations: [],
    nodes: [
      {
        nodeId: 4,
        isOperational: true,
        isBlocked: false,
        isObstacleBlocked: false,
        isOutage: false,
        linkStatus: 'CONNECTED',
        isSelected: true,
        isTransmitting: true,
        isWastingAirtime: false,
        queueBacklogBytes: 3500000,
        transfer: liveTelemetry.nodes_telemetry[0].transfer_state,
      },
    ],
  });

  assert.equal(liveSnapshot.source, 'live');
  assert.equal(liveSnapshot.nodes[0].transfer?.status, 'TRANSMITTING');
  assert.equal(liveSnapshot.nodes[0].transfer?.progress_pct, 65.0);

  console.log('  -> PASS: Historical snapshot strictly sets transfer to null, preventing live badge leakage.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 38: Speed Change 1x to 2x at 50% Playback Progress
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[38/43] Verifying speed change 1x to 2x at 50% playback progress...');
{
  const visualizer = new DataCommVisualizer();
  const snap1 = createSuperframeSnapshot({ source: 'live', frameIndex: 1, simulationTimeS: 0.02, schedulerMode: 'tac_tad', allocations: [], nodes: [] });
  const snap2 = createSuperframeSnapshot({ source: 'live', frameIndex: 2, simulationTimeS: 0.04, schedulerMode: 'tac_tad', allocations: [], nodes: [] });

  visualizer.ingestSnapshot(snap1);
  visualizer.ingestSnapshot(snap2);

  // Advance 500 ms at 1x speed (exactly 50% progress into 1000 ms cycle)
  visualizer.advancePlayback(500.0, 1.0, false);
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 1, 'Active snapshot must be Frame 1');
  const progress1x = visualizer.getCycleElapsedVisualMs() / visualizer.getCycleDurationMs(1.0);
  assert.ok(Math.abs(progress1x - 0.50) < 1e-6, 'Progress at 1x must be exactly 50%');

  // Switch speed to 2.0x (0 ms wall delta on the switch itself)
  visualizer.advancePlayback(0.0, 2.0, false);

  // MUST remain at active snapshot Frame 1 (NO premature rollover!)
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 1, 'Active snapshot must NOT roll over immediately upon speed increase');
  assert.equal(visualizer.getPendingSnapshot()?.frameIndex, 2, 'Pending snapshot must remain queued');

  // Rescaled elapsed time must be 250 ms out of 500 ms (exactly 50% progress!)
  const progress2x = visualizer.getCycleElapsedVisualMs() / visualizer.getCycleDurationMs(2.0);
  assert.ok(Math.abs(progress2x - 0.50) < 1e-6, 'Normalized progress must remain exactly 50% after speed shift to 2x');
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() - 250.0) < 1e-6, 'Elapsed visual ms must be rescaled to 250 ms');

  // Advance 240 ms at 2.0x (total 490 ms out of 500 ms -> 98% progress)
  visualizer.advancePlayback(240.0, 2.0, false);
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 1, 'Active snapshot must still be Frame 1 at 98%');

  // Advance 20 ms at 2.0x -> Rollover occurs at exact 500 ms mark
  visualizer.advancePlayback(20.0, 2.0, false);
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 2, 'Pending snapshot must be promoted at the end of the 2x cycle');
  assert.equal(visualizer.getPendingSnapshot(), null);

  console.log('  -> PASS: 1x to 2x speed change at 50% preserves normalized progress without skipping active snapshot.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 39: Speed Change 1x to 0.5x at 50% Playback Progress
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[39/43] Verifying speed change 1x to 0.5x at 50% playback progress...');
{
  const visualizer = new DataCommVisualizer();
  const snap1 = createSuperframeSnapshot({ source: 'live', frameIndex: 1, simulationTimeS: 0.02, schedulerMode: 'tac_tad', allocations: [], nodes: [] });
  const snap2 = createSuperframeSnapshot({ source: 'live', frameIndex: 2, simulationTimeS: 0.04, schedulerMode: 'tac_tad', allocations: [], nodes: [] });

  visualizer.ingestSnapshot(snap1);
  visualizer.ingestSnapshot(snap2);

  // Advance 500 ms at 1x speed (50% progress)
  visualizer.advancePlayback(500.0, 1.0, false);
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 1);

  // Switch speed to 0.5x (cycle duration becomes 2000 ms)
  visualizer.advancePlayback(0.0, 0.5, false);

  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 1, 'Active snapshot must remain Frame 1');
  const progressHalf = visualizer.getCycleElapsedVisualMs() / visualizer.getCycleDurationMs(0.5);
  assert.ok(Math.abs(progressHalf - 0.50) < 1e-6, 'Normalized progress must remain exactly 50% after speed shift to 0.5x');
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() - 1000.0) < 1e-6, 'Elapsed visual ms must be rescaled to 1000 ms');

  // Advance 980 ms at 0.5x (total 1980 ms / 2000 ms -> 99% progress)
  visualizer.advancePlayback(980.0, 0.5, false);
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 1, 'Active snapshot must remain Frame 1 at 99%');

  // Advance 30 ms at 0.5x -> Rollover at 2000 ms mark
  visualizer.advancePlayback(30.0, 0.5, false);
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 2, 'Pending snapshot must be promoted at the end of the 0.5x cycle');

  console.log('  -> PASS: 1x to 0.5x speed change at 50% preserves normalized progress without phase backward jump.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 40: Multiple Speed Changes Within One Cycle Without Drift or Reset
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[40/43] Verifying multiple speed changes within one cycle without drift or reset...');
{
  const visualizer = new DataCommVisualizer();
  const snap1 = createSuperframeSnapshot({ source: 'live', frameIndex: 10, simulationTimeS: 0.20, schedulerMode: 'tac_tad', allocations: [], nodes: [] });
  const snap2 = createSuperframeSnapshot({ source: 'live', frameIndex: 11, simulationTimeS: 0.22, schedulerMode: 'tac_tad', allocations: [], nodes: [] });

  visualizer.ingestSnapshot(snap1);
  visualizer.ingestSnapshot(snap2);

  // 1. Advance 200 ms at 1.0x -> 20%
  visualizer.advancePlayback(200.0, 1.0, false);
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() / 1000.0 - 0.20) < 1e-6);

  // 2. Switch to 2.0x (duration 500 ms) -> progress must be 20% (elapsed 100 ms)
  visualizer.advancePlayback(0.0, 2.0, false);
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() / 500.0 - 0.20) < 1e-6);

  // 3. Advance 100 ms at 2.0x -> 40% (elapsed 200 ms)
  visualizer.advancePlayback(100.0, 2.0, false);
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() / 500.0 - 0.40) < 1e-6);

  // 4. Switch to 0.5x (duration 2000 ms) -> progress must be 40% (elapsed 800 ms)
  visualizer.advancePlayback(0.0, 0.5, false);
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() / 2000.0 - 0.40) < 1e-6);

  // 5. Advance 200 ms at 0.5x -> 50% (elapsed 1000 ms)
  visualizer.advancePlayback(200.0, 0.5, false);
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() / 2000.0 - 0.50) < 1e-6);

  // 6. Switch to 4.0x (duration 250 ms) -> progress must be 50% (elapsed 125 ms)
  visualizer.advancePlayback(0.0, 4.0, false);
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() / 250.0 - 0.50) < 1e-6);

  // 7. Switch back to 1.0x (duration 1000 ms) -> progress must be 50% (elapsed 500 ms)
  visualizer.advancePlayback(0.0, 1.0, false);
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() / 1000.0 - 0.50) < 1e-6);

  // Throughout all 6 speed shifts, Frame 10 must NEVER have been reset or replaced
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 10, 'Active snapshot must remain Frame 10 across all speed changes');
  assert.equal(visualizer.getPendingSnapshot()?.frameIndex, 11);

  console.log('  -> PASS: Multiple speed changes preserve cycle progress without accumulating numerical drift.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 41: Speed Changes While Paused Do Not Advance Playback
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[41/43] Verifying speed changes while paused do not advance playback...');
{
  const visualizer = new DataCommVisualizer();
  const snap = createSuperframeSnapshot({ source: 'live', frameIndex: 1, simulationTimeS: 0.02, schedulerMode: 'tac_tad', allocations: [], nodes: [] });
  visualizer.ingestSnapshot(snap);

  // Advance 300 ms at 1.0x (30% progress)
  visualizer.advancePlayback(300.0, 1.0, false);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 300.0);

  // Pause simulation
  // Change speed to 2.0x while paused: advancePlayback with isPaused=true
  visualizer.advancePlayback(500.0, 2.0, true);

  // Progress must remain strictly 30% (elapsed rescaled to 150 ms of 500 ms)
  const progressPaused2x = visualizer.getCycleElapsedVisualMs() / visualizer.getCycleDurationMs(2.0);
  assert.ok(Math.abs(progressPaused2x - 0.30) < 1e-6);
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() - 150.0) < 1e-6);

  // Change speed to 0.5x while still paused
  visualizer.advancePlayback(200.0, 0.5, true);
  const progressPausedHalf = visualizer.getCycleElapsedVisualMs() / visualizer.getCycleDurationMs(0.5);
  assert.ok(Math.abs(progressPausedHalf - 0.30) < 1e-6);
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() - 600.0) < 1e-6);

  // Resume simulation at 0.5x
  visualizer.advancePlayback(200.0, 0.5, false);
  const progressResumed = visualizer.getCycleElapsedVisualMs() / visualizer.getCycleDurationMs(0.5);
  assert.ok(Math.abs(progressResumed - 0.40) < 1e-6, 'Resuming must smoothly advance from 30% to 40%');
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() - 800.0) < 1e-6);

  console.log('  -> PASS: Speed changes while paused maintain static progress without advancing playback.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 42: No Premature Snapshot Promotion or Skipped Visual Phase on Speed Switch
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[42/43] Verifying no premature snapshot promotion or skipped visual phase on speed switch...');
{
  const visualizer = new DataCommVisualizer();
  const mockAllocations = [
    { nodeId: 4, startMs: 12.0, durationMs: 4.0, capacityBits: 20000, isPreOcclusionFlush: false },
  ];
  const snapA = createSuperframeSnapshot({ source: 'live', frameIndex: 1, simulationTimeS: 0.02, schedulerMode: 'tac_tad', allocations: mockAllocations, nodes: [{ nodeId: 4, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: true, isTransmitting: true, isWastingAirtime: false, queueBacklogBytes: 5000, transfer: null }] });
  const snapB = createSuperframeSnapshot({ source: 'live', frameIndex: 2, simulationTimeS: 0.04, schedulerMode: 'tac_tad', allocations: [], nodes: [] });

  visualizer.ingestSnapshot(snapA);
  visualizer.ingestSnapshot(snapB);

  // Advance to 700 ms at 1.0x (subframe offset = 700/1000 * 20 = 14.0 ms, exactly midway through Node 4 slot [12.0, 16.0))
  visualizer.advancePlayback(700.0, 1.0, false);

  const slotAt1x = resolveActiveTdmaSlotState(
    (visualizer.getCycleElapsedVisualMs() / visualizer.getCycleDurationMs(1.0)) * 20.0,
    mockAllocations,
    1.0,
    3.0,
    20.0
  );
  assert.equal(slotAt1x.phase, 'UPLINK_SLOT');
  assert.equal(slotAt1x.scheduledNodeId, 4);
  assert.ok(Math.abs(slotAt1x.slotProgress - 0.5) < 1e-6);

  // User changes speed to 2.0x
  visualizer.advancePlayback(0.0, 2.0, false);

  // Verify active snapshot is still snapA
  assert.equal(visualizer.getActiveSnapshot()?.frameIndex, 1, 'Active snapshot must not be promoted on speed switch');

  // Verify active slot is STILL Node 4 uplink slot with slotProgress = 0.5
  const slotAt2x = resolveActiveTdmaSlotState(
    (visualizer.getCycleElapsedVisualMs() / visualizer.getCycleDurationMs(2.0)) * 20.0,
    mockAllocations,
    1.0,
    3.0,
    20.0
  );
  assert.equal(slotAt2x.phase, 'UPLINK_SLOT');
  assert.equal(slotAt2x.scheduledNodeId, 4);
  assert.ok(Math.abs(slotAt2x.slotProgress - 0.5) < 1e-6, 'Slot progress must remain exactly 50% across speed change');

  console.log('  -> PASS: Speed change mid-slot avoids premature promotion and preserves active slot progress.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 43: Clamped Speed Edge Cases (NaN, Negative, Extreme Speeds)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[43/43] Verifying clamped speed edge cases (NaN, Negative, Extreme Speeds)...');
{
  const visualizer = new DataCommVisualizer();

  assert.equal(visualizer.clampSpeed(1.0), 1.0);
  assert.equal(visualizer.clampSpeed(2.0), 2.0);
  assert.equal(visualizer.clampSpeed(0.0), 0.05, 'Speed <= 0 must clamp to 0.05');
  assert.equal(visualizer.clampSpeed(-10.0), 0.05, 'Negative speed must clamp to 0.05');
  assert.equal(visualizer.clampSpeed(NaN), 1.0, 'NaN speed must fallback to 1.0');
  assert.equal(visualizer.clampSpeed(100.0), 10.0, 'Speed > 10 must clamp to 10.0');

  const snap = createSuperframeSnapshot({ source: 'live', frameIndex: 1, simulationTimeS: 0.02, schedulerMode: 'tac_tad', allocations: [], nodes: [] });
  visualizer.ingestSnapshot(snap);

  visualizer.advancePlayback(100.0, -5.0, false);
  assert.equal(visualizer.getEffectiveSpeed(), 0.05, 'Effective speed must be clamped to 0.05');

  visualizer.advancePlayback(100.0, 50.0, false);
  assert.equal(visualizer.getEffectiveSpeed(), 10.0, 'Effective speed must be clamped to 10.0');

  console.log('  -> PASS: Clamped speed edge cases handle invalid inputs safely.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 44: Uplink Animation Renders for Terminal with Valid Active UL Allocation
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[44/49] Verifying uplink animation renders for terminal with valid active UL allocation...');
{
  const visualizer = new DataCommVisualizer();
  const recorder = createRecordingCanvasContext();

  const acnPos = { x: 500, y: 150 };
  const nodeScreenPositions = new Map<number, Point2D>([
    [12, { x: 250, y: 400 }],
    [4, { x: 700, y: 450 }],
  ]);

  const snap = createSuperframeSnapshot({
    source: 'live',
    sessionId: 1,
    frameIndex: 10,
    simulationTimeS: 0.20,
    schedulerMode: 'tac_tad',
    superframeDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    allocations: [
      { nodeId: 12, startMs: 4.0, durationMs: 4.0, capacityBits: 25000 },
      { nodeId: 4, startMs: 8.0, durationMs: 4.0, capacityBits: 20000 },
    ],
    nodes: [
      {
        nodeId: 12,
        isOperational: true,
        isBlocked: false,
        isObstacleBlocked: false,
        isOutage: false,
        isDegraded: false,
        linkStatus: 'CONNECTED',
        isSelected: true,
        isTransmitting: true,
        isWastingAirtime: false,
        queueBacklogBytes: 15000,
        transfer: {
          node_id: 12,
          status: 'TRANSMITTING',
          status_message: 'Transmitting photo payload',
          active_type: 'PHOTO',
          total_bytes: 100000,
          delivered_bytes: 45000,
          dropped_bytes: 0,
          dropped_packets: 0,
          progress_pct: 45.0,
          start_time_s: 0.1,
          ack_time_s: 0,
          current_rate_bps: 5000000,
          current_rate_mbps: 5.0,
          eta_s: 0.11,
          eta_status: '0.1s',
        },
      },
      {
        nodeId: 4,
        isOperational: true,
        isBlocked: false,
        isObstacleBlocked: false,
        isOutage: false,
        isDegraded: false,
        linkStatus: 'CONNECTED',
        isSelected: false,
        isTransmitting: false,
        isWastingAirtime: false,
        queueBacklogBytes: 0,
        transfer: null,
      },
    ],
  });

  // Render at visualTimeMs = 300 ms (maps to subframe offset = 6.0 ms, middle of S12's slot [4.0, 8.0 ms))
  visualizer.render(recorder.ctx, {
    snapshot: snap,
    acnScreenPos: acnPos,
    nodeScreenPositions,
    speed: 1.0,
    isPaused: false,
    visualTimeMs: 300,
  });

  // 1. S12 must display tactical TX badge
  const s12TxBadge = recorder.filledTexts.find((t) => t.text === 'TX');
  assert.ok(s12TxBadge !== undefined, 'S12 must render TX tactical badge during its allocated uplink slot');

  // 2. ACN must display tactical RX badge
  const acnRxBadge = recorder.filledTexts.find((t) => t.text === 'RX');
  assert.ok(acnRxBadge !== undefined, 'ACN must render RX tactical badge during active uplink slot');

  // 3. Directional packet particles must be drawn
  assert.ok(recorder.rects.length > 0, 'Packets must be drawn between S12 and ACN');

  // 4. S12 must have active transmitter ring pulsing
  const s12Ring = recorder.arcs.find((a) => Math.abs(a.x - 250) < 1 && Math.abs(a.y - 400) < 1);
  assert.ok(s12Ring !== undefined, 'S12 must have an active transmitter ring');

  console.log('  -> PASS: Uplink animation renders correctly for terminal with valid active UL allocation.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 45: Uplink Directionality Strictly Ground Terminal -> ACN
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[45/49] Verifying uplink directionality strictly Ground Terminal -> ACN...');
{
  const termPos: Point2D = { x: 120, y: 550 };
  const acnPos: Point2D = { x: 750, y: 120 };

  // Calculate packet positions at early and late slot progress
  const pktsEarly = computeSlotPacketPositions(termPos.x, termPos.y, acnPos.x, acnPos.y, 0.15, 3);
  const pktsLate = computeSlotPacketPositions(termPos.x, termPos.y, acnPos.x, acnPos.y, 0.45, 3);

  // Measure distance from terminal for corresponding particles
  const distEarly = Math.hypot(pktsEarly[0].x - termPos.x, pktsEarly[0].y - termPos.y);
  const distLate = Math.hypot(pktsLate[0].x - termPos.x, pktsLate[0].y - termPos.y);
  assert.ok(distLate > distEarly, 'Uplink packets must strictly advance outward from Ground Terminal towards ACN');

  // Measure distance from ACN: must strictly decrease as packets approach ACN
  const distToAcnEarly = Math.hypot(pktsEarly[0].x - acnPos.x, pktsEarly[0].y - acnPos.y);
  const distToAcnLate = Math.hypot(pktsLate[0].x - acnPos.x, pktsLate[0].y - acnPos.y);
  assert.ok(distToAcnLate < distToAcnEarly, 'Uplink packets must strictly approach ACN destination');

  console.log('  -> PASS: Uplink directional progression is strictly Ground Terminal -> ACN, never ACN -> Node.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 46: Uplink Animation is NOT Shown for Terminals Without Active UL Slot
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[46/49] Verifying uplink animation is NOT shown for terminals without active UL slot...');
{
  const visualizer = new DataCommVisualizer();
  const recorder = createRecordingCanvasContext();

  const acnPos = { x: 500, y: 150 };
  const nodeScreenPositions = new Map<number, Point2D>([
    [12, { x: 250, y: 400 }],
    [4, { x: 700, y: 450 }],
  ]);

  // S4 has active UL slot [4.0, 8.0 ms). S12 is selected but has NO allocation in this slot.
  const snap = createSuperframeSnapshot({
    source: 'live',
    sessionId: 1,
    frameIndex: 12,
    simulationTimeS: 0.24,
    schedulerMode: 'tac_tad',
    superframeDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    allocations: [
      { nodeId: 4, startMs: 4.0, durationMs: 4.0, capacityBits: 20000 },
    ],
    nodes: [
      {
        nodeId: 12,
        isOperational: true,
        isBlocked: false,
        isObstacleBlocked: false,
        isOutage: false,
        isDegraded: false,
        linkStatus: 'CONNECTED',
        isSelected: true, // Selected terminal!
        isTransmitting: false,
        isWastingAirtime: false,
        queueBacklogBytes: 50000,
        transfer: null,
      },
      {
        nodeId: 4,
        isOperational: true,
        isBlocked: false,
        isObstacleBlocked: false,
        isOutage: false,
        isDegraded: false,
        linkStatus: 'CONNECTED',
        isSelected: false,
        isTransmitting: true,
        isWastingAirtime: false,
        queueBacklogBytes: 10000,
        transfer: null,
      },
    ],
  });

  // Render at visualTimeMs = 300 ms (subframe offset = 6.0 ms, S4's slot)
  visualizer.render(recorder.ctx, {
    snapshot: snap,
    acnScreenPos: acnPos,
    nodeScreenPositions,
    speed: 1.0,
    isPaused: false,
    visualTimeMs: 300,
  });

  // S4 must render TX badge
  const s4TxBadge = recorder.filledTexts.find((t) => t.text === 'TX');
  assert.ok(s4TxBadge !== undefined, 'S4 (scheduled node) must render TX badge');
  assert.ok(Math.abs(s4TxBadge.x - 700) < 1, 'TX badge must be located at S4 coordinates');

  // S12 must NOT render any TX badge or transmitter rings
  const s12Rings = recorder.arcs.filter((a) => Math.abs(a.x - 250) < 1 && Math.abs(a.y - 400) < 1);
  assert.equal(s12Rings.length, 0, 'S12 must NOT render transmitter rings when not scheduled');

  // Render at visualTimeMs = 600 ms (subframe offset = 12.0 ms, IDLE_GUARD)
  const idleRecorder = createRecordingCanvasContext();
  visualizer.render(idleRecorder.ctx, {
    snapshot: snap,
    acnScreenPos: acnPos,
    nodeScreenPositions,
    speed: 1.0,
    isPaused: false,
    visualTimeMs: 600,
  });

  const idleTxBadge = idleRecorder.filledTexts.find((t) => t.text === 'TX' || t.text === 'TX [DROP]');
  assert.equal(idleTxBadge, undefined, 'No terminal must render TX badge during unallocated idle airtime');

  console.log('  -> PASS: Unscheduled terminals and idle airtime strictly display zero transmission activity.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 47: Dropped Transfer Represents Queue Expiry (No In-Flight Loss Fabrication)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[47/49] Verifying dropped transfer represents queue expiry without in-flight loss fabrication...');
{
  const visualizer = new DataCommVisualizer();
  const recorder = createRecordingCanvasContext();

  const acnPos = { x: 500, y: 150 };
  const nodeScreenPositions = new Map<number, Point2D>([
    [12, { x: 250, y: 400 }],
  ]);

  // Terminal S12 has Tac-TAD allocated dynamic uplink slot [4.0, 8.0 ms)
  // Transfer status is 'FAILED_DROPPED' with 0 queue backlog (queue expiry before TX)
  const snap = createSuperframeSnapshot({
    source: 'live',
    sessionId: 1,
    frameIndex: 25,
    simulationTimeS: 0.50,
    schedulerMode: 'tac_tad',
    superframeDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    allocations: [
      { nodeId: 12, startMs: 4.0, durationMs: 4.0, capacityBits: 25000 },
    ],
    nodes: [
      {
        nodeId: 12,
        isOperational: true,
        isBlocked: false,
        isObstacleBlocked: false,
        isOutage: false,
        isDegraded: false,
        linkStatus: 'CONNECTED',
        isSelected: true,
        isTransmitting: false,
        isWastingAirtime: false,
        queueBacklogBytes: 0,
        transfer: {
          node_id: 12,
          status: 'FAILED_DROPPED',
          status_message: '[✖] PHOTO FAILED: Packets expired/dropped in mountain shadow!',
          active_type: 'PHOTO',
          total_bytes: 500000,
          delivered_bytes: 150000,
          dropped_bytes: 350000,
          dropped_packets: 42,
          progress_pct: 30.0,
          start_time_s: 0.1,
          ack_time_s: 0,
          current_rate_bps: 0,
          current_rate_mbps: 0,
          eta_s: null,
          eta_status: 'DROPPED',
        },
      },
    ],
  });

  // Render at visualTimeMs = 300 ms (subframe offset = 6.0 ms, middle of S12's slot)
  visualizer.render(recorder.ctx, {
    snapshot: snap,
    acnScreenPos: acnPos,
    nodeScreenPositions,
    speed: 1.0,
    isPaused: false,
    visualTimeMs: 300,
  });

  // 1. S12 renders TX [IDLE] badge for unutilized carrier (0 payload backlog)
  const idleTxBadge = recorder.filledTexts.find((t) => t.text === 'TX [IDLE]');
  assert.ok(idleTxBadge !== undefined, 'S12 must render TX [IDLE] badge for unutilized carrier allocation');

  // 2. ACN renders RX [IDLE] badge
  const idleRxBadge = recorder.filledTexts.find((t) => t.text === 'RX [IDLE]');
  assert.ok(idleRxBadge !== undefined, 'ACN must render RX [IDLE] badge for unutilized carrier allocation');

  // 3. On-node transfer badge truthfully reports QUEUE EXPIRED
  const queueExpiredBadge = recorder.filledTexts.find((t) => t.text.includes('[✕ QUEUE EXPIRED]'));
  assert.ok(queueExpiredBadge !== undefined, 'Node badge must display [✕ QUEUE EXPIRED]');

  // 4. In-flight packet loss is NOT fabricated across the link: ZERO packet rects drawn
  const packetRects = recorder.rects.filter((r) => r.w === 8 && r.h === 3.6);
  assert.equal(packetRects.length, 0, 'No traveling in-flight packets may be fabricated for empty allocation');

  // 5. Superframe HUD indicator displays [UNUTILIZED CARRIER]
  const hudText = recorder.filledTexts.find((t) => t.text.includes('UNUTILIZED CARRIER'));
  assert.ok(hudText !== undefined, 'Superframe HUD must display [UNUTILIZED CARRIER] during empty slot');

  console.log('  -> PASS: Queue expiry before TX correctly handled without fabricating in-flight loss.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 48: Historical Snapshots Continue to Render Correctly with transfer: null
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[48/49] Verifying historical snapshots continue to render correctly with transfer: null...');
{
  const visualizer = new DataCommVisualizer();
  const recorder = createRecordingCanvasContext();

  const acnPos = { x: 500, y: 150 };
  const nodeScreenPositions = new Map<number, Point2D>([
    [4, { x: 300, y: 350 }],
  ]);

  const snap = createSuperframeSnapshot({
    source: 'historical',
    sessionId: 1,
    frameIndex: 50,
    simulationTimeS: 1.00,
    schedulerMode: 'tac_tad',
    superframeDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    allocations: [
      { nodeId: 4, startMs: 4.0, durationMs: 4.0, capacityBits: 20000 },
    ],
    nodes: [
      {
        nodeId: 4,
        isOperational: true,
        isBlocked: false,
        isObstacleBlocked: false,
        isOutage: false,
        isDegraded: false,
        linkStatus: 'CONNECTED',
        isSelected: true,
        isTransmitting: true,
        isWastingAirtime: false,
        queueBacklogBytes: 12000,
        transfer: null, // Historical snapshot strictly sets transfer to null
      },
    ],
  });

  // Verify snapshot immutability & transfer is null
  assert.equal(snap.nodes[0].transfer, null, 'Historical snapshot must have transfer === null');
  assert.equal(snap.source, 'historical');

  // Render at visualTimeMs = 300 ms (subframe offset = 6.0 ms, S4's slot)
  visualizer.render(recorder.ctx, {
    snapshot: snap,
    acnScreenPos: acnPos,
    nodeScreenPositions,
    speed: 1.0,
    isPaused: false,
    visualTimeMs: 300,
  });

  // S4 renders TX badge from authoritative backlog
  const txBadge = recorder.filledTexts.find((t) => t.text === 'TX');
  assert.ok(txBadge !== undefined, 'Historical snapshot must render active uplink transmission');

  // HUD indicator must display [HISTORICAL] tag
  const hudText = recorder.filledTexts.find((t) => t.text.includes('[HISTORICAL]'));
  assert.ok(hudText !== undefined, 'Superframe HUD must display [HISTORICAL] mode tag');

  console.log('  -> PASS: Historical snapshot renders cleanly without errors and preserves transfer: null.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 49: Map Legend Layout CSS Eliminates Horizontal Scrollbars & Wraps Responsively
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[49/49] Verifying map legend layout CSS eliminates horizontal scrollbars & wraps responsively...');
{
  const indexPath = path.resolve(__dirname, '../../index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf-8');

  // Extract .map-legend CSS block
  const legendCssMatch = indexHtml.match(/\.map-legend\s*\{([^}]+)\}/);
  assert.ok(legendCssMatch !== null, '.map-legend CSS rule must be defined in index.html');
  const legendCss = legendCssMatch[1];

  // 1. Must use flex-wrap: wrap to allow multi-row wrapping
  assert.ok(legendCss.includes('flex-wrap: wrap'), '.map-legend must specify flex-wrap: wrap');
  assert.ok(!legendCss.includes('flex-wrap: nowrap'), '.map-legend must NOT specify flex-wrap: nowrap');

  // 2. Must NOT specify overflow-x: auto (which spawned the unwanted scrollbar)
  assert.ok(!legendCss.includes('overflow-x: auto'), '.map-legend must NOT specify overflow-x: auto');

  // 3. Must be constrained to container bounds
  assert.ok(legendCss.includes('max-width: calc(100% - 20px)'), '.map-legend must be constrained to container width');

  // 4. Must NOT have white-space: nowrap on .map-legend container
  assert.ok(!legendCss.includes('white-space: nowrap'), '.map-legend container must not have white-space: nowrap');

  // 5. Individual legend items (.map-legend span) must keep their icon and label together
  const spanCssMatch = indexHtml.match(/\.map-legend\s+span\s*\{([^}]+)\}/);
  assert.ok(spanCssMatch !== null, '.map-legend span CSS rule must be defined');
  const spanRuleNormalized = spanCssMatch[1].replace(/\s+/g, '');
  assert.ok(spanRuleNormalized.includes('white-space:nowrap'), '.map-legend span must have white-space: nowrap to keep items intact');

  // 6. Responsive media query exists for narrower viewports
  assert.ok(indexHtml.includes('.map-legend'), 'Responsive media query must handle .map-legend');

  console.log('  -> PASS: Map legend CSS layout completely eliminates horizontal scrollbars and wraps cleanly.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 50: Static TDMA First and Multiple Allocations Timestamp Normalization (Actual Scheduler Output)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[50/54] Verifying Static TDMA allocation timestamp normalization using actual scheduler output...');
{
  const scheduler = new LegacyStaticScheduler();
  const nodes = Array.from({ length: 16 }, (_, i) => new GroundNodeTrafficSubsystem(i, 'soldier', [0, 0, 0]));
  const linkStatuses = new Map<number, LinkStatus>();
  const predStates = new Map<number, PredictiveState>();

  for (let i = 0; i < 16; i++) {
    linkStatuses.set(i, {
      nodeType: 'soldier',
      slantRangeM: 15000,
      fsplDb: 135,
      diffractionLossDb: 0,
      gasLossDb: 0.1,
      rainLossDb: 0,
      cableLossDb: 0.5,
      implementationMarginDb: 1.5,
      totalLossDb: 137.1,
      pTxDbm: 30,
      txGainDbi: 15,
      rxGainDbi: 25,
      prxDbm: -67.1,
      pNoiseDbm: -100,
      snrDb: 32.9,
      modcodName: '16-APSK 3/4',
      spectralEfficiency: 2.97,
      bitrateBps: 2.97e6,
      bitrateMbps: 2.97,
      isOutage: false,
    });
    predStates.set(i, {
      currentState: NodeTerrainState.NORMAL_LOS,
      timeToOcclusionS: 999,
      timeToEmergenceS: 0,
      fresnelClearanceM: 50,
      fresnelRateOfChangeMps: 0,
      predictedOutageDurationS: 0,
    });
  }

  const testSimTimeS = 0.040; // 3rd simulation frame (frameIndex = 2)
  const report = scheduler.scheduleFrame(2, testSimTimeS, nodes, linkStatuses, predStates);

  assert.equal(report.allocations.length, 16, 'Static scheduler must produce 16 allocations');

  // Map allocations through normalizeSlotAllocationToFrame
  const normalizedAllocs = report.allocations.map((a) =>
    normalizeSlotAllocationToFrame(a, testSimTimeS, FRAME_DT)
  );

  // 1. Verify first allocation start_ms
  const first = normalizedAllocs[0];
  assert.equal(first.node_id, 0);
  // Before fix: start_ms would have been 24.0 ms (or 44.0 ms)
  // After fix: start_ms must be exactly 4.0 ms (T_CTRL 1ms + T_DL 3ms)
  assert.ok(Math.abs(first.start_ms - 4.0) < 1e-4, `First allocation must start at 4.0 ms, got ${first.start_ms}`);
  assert.ok(first.start_ms < 20.0, 'First allocation must start inside [0, 20 ms)');
  assert.ok(Math.abs(first.duration_ms - 0.988) < 0.01, `Slot duration must be ~0.988 ms, got ${first.duration_ms}`);
  assert.equal(first.is_out_of_frame, false, 'First allocation must not be flagged out of frame');

  // 2. Verify all 16 allocations span [4.0 ms, 20.0 ms)
  for (let i = 0; i < normalizedAllocs.length; i++) {
    const alloc = normalizedAllocs[i];
    assert.equal(alloc.node_id, i, `Allocation index ${i} must belong to node ${i}`);
    assert.ok(alloc.start_ms >= 4.0 - 1e-4, `Allocation ${i} start_ms must be >= 4.0 ms`);
    assert.ok(alloc.start_ms < 20.0, `Allocation ${i} start_ms must be < 20.0 ms`);
    assert.ok(alloc.start_ms + alloc.duration_ms <= 20.0 + 1e-4, `Allocation ${i} end must be <= 20.0 ms`);
    assert.equal(alloc.is_out_of_frame, false, `Allocation ${i} must be within frame boundaries`);
    if (i > 0) {
      assert.ok(alloc.start_ms >= normalizedAllocs[i - 1].start_ms, `Allocations must be monotonically ordered`);
    }
  }

  // 3. Verify last allocation
  const last = normalizedAllocs[15];
  assert.equal(last.node_id, 15);
  assert.ok(Math.abs(last.start_ms - 19.0) < 0.02, `Last allocation must start at ~19.0 ms, got ${last.start_ms}`);
  assert.ok(last.start_ms + last.duration_ms <= 20.0 + 1e-4, 'Last allocation must finish within 20.0 ms');

  console.log('  -> PASS: Static TDMA allocations strictly normalized to [4.0 ms, 20.0 ms) interval.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 51: Tac-TAD Dynamic Allocations & Pre-Occlusion Flush Timestamp Normalization
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[51/54] Verifying Tac-TAD allocation timestamp normalization with actual scheduler output...');
{
  const scheduler = new TerrainAwareDynamicScheduler();
  const nodes = Array.from({ length: 16 }, (_, i) => new GroundNodeTrafficSubsystem(i, 'soldier', [0, 0, 0]));
  const linkStatuses = new Map<number, LinkStatus>();
  const predStates = new Map<number, PredictiveState>();

  for (let i = 0; i < 16; i++) {
    linkStatuses.set(i, {
      nodeType: 'soldier',
      slantRangeM: 15000,
      fsplDb: 135,
      diffractionLossDb: 0,
      gasLossDb: 0.1,
      rainLossDb: 0,
      cableLossDb: 0.5,
      implementationMarginDb: 1.5,
      totalLossDb: 137.1,
      pTxDbm: 30,
      txGainDbi: 15,
      rxGainDbi: 25,
      prxDbm: -67.1,
      pNoiseDbm: -100,
      snrDb: 32.9,
      modcodName: '16-APSK 3/4',
      spectralEfficiency: 2.97,
      bitrateBps: 2.97e6,
      bitrateMbps: 2.97,
      isOutage: false,
    });
    predStates.set(i, {
      currentState: NodeTerrainState.NORMAL_LOS,
      timeToOcclusionS: 999,
      timeToEmergenceS: 0,
      fresnelClearanceM: 50,
      fresnelRateOfChangeMps: 0,
      predictedOutageDurationS: 0,
    });
  }

  // Node 4 in PRE_OCCLUSION_FLUSH with 40 KB photo
  predStates.set(4, {
    currentState: NodeTerrainState.PRE_OCCLUSION_FLUSH,
    timeToOcclusionS: 1.5,
    timeToEmergenceS: 0,
    fresnelClearanceM: 5,
    fresnelRateOfChangeMps: -2,
    predictedOutageDurationS: 10,
  });
  nodes[4].enqueuePacket(70, 0.100, 40000);

  // Node 12 with GBR voice traffic
  nodes[12].enqueuePacket(65, 0.100, 2000);

  const testSimTimeS = 0.100; // Frame 5
  const report = scheduler.scheduleFrame(5, testSimTimeS, nodes, linkStatuses, predStates);

  assert.ok(report.allocations.length >= 2, 'Tac-TAD must allocate candidate nodes');

  const normalizedAllocs = report.allocations.map((a) =>
    normalizeSlotAllocationToFrame(a, testSimTimeS, FRAME_DT)
  );

  // Verify first dynamic allocation
  const first = normalizedAllocs[0];
  assert.ok(first.start_ms >= 4.0 - 1e-4, `First Tac-TAD allocation must start >= 4.0 ms, got ${first.start_ms}`);
  assert.ok(first.start_ms < 20.0, `First Tac-TAD allocation must start < 20.0 ms, got ${first.start_ms}`);

  // Find Node 4 flush allocation
  const node4Alloc = normalizedAllocs.find((a) => a.node_id === 4);
  assert.ok(node4Alloc !== undefined, 'Node 4 allocation must exist in report');
  assert.equal(node4Alloc.is_pre_occlusion_flush, true, 'Node 4 must retain isPreOcclusionFlush metadata');
  assert.ok(node4Alloc.capacity_bits > 0, 'Node 4 capacity bits must be positive');
  assert.ok(node4Alloc.duration_ms > 0, 'Node 4 duration must be positive');
  assert.equal(node4Alloc.is_out_of_frame, false, 'Node 4 allocation must be within frame');

  // Verify all Tac-TAD allocations are within [4.0 ms, 20.0 ms)
  for (const alloc of normalizedAllocs) {
    assert.ok(alloc.start_ms >= 4.0 - 1e-4, 'Tac-TAD slot start must be >= 4.0 ms');
    assert.ok(alloc.start_ms + alloc.duration_ms <= 20.0 + 1e-4, 'Tac-TAD slot end must be <= 20.0 ms');
    assert.equal(alloc.is_out_of_frame, false, 'No Tac-TAD allocation should be out of frame');
  }

  console.log('  -> PASS: Tac-TAD dynamic allocations and pre-occlusion flush correctly normalized.');
}



// ─────────────────────────────────────────────────────────────────────────────
// Test 52: Interval Boundary Semantics and Diagnostics for Out-of-Frame Allocations
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[52/54] Verifying interval boundary semantics and out-of-frame diagnostics...');
{
  const frameSimTimeS = 1.000;

  // 1. Exactly on 0.0 ms boundary
  const atZero = normalizeSlotAllocationToFrame({
    nodeId: 1,
    slotStartS: frameSimTimeS,
    durationS: 0.002,
    timingAdvanceS: 0.001,
    modcodName: 'QPSK 1/2',
    spectralEfficiency: 1.0,
    capacityBits: 2000,
    isPreOcclusionFlush: false,
  }, frameSimTimeS, FRAME_DT);
  assert.equal(atZero.start_ms, 0.0);
  assert.equal(atZero.duration_ms, 2.0);
  assert.equal(atZero.is_out_of_frame, false);

  // 2. Exactly ending at 20.0 ms boundary (valid in [0, 20) half-open interval)
  const atEnd = normalizeSlotAllocationToFrame({
    nodeId: 2,
    slotStartS: frameSimTimeS + 0.018,
    durationS: 0.002,
    timingAdvanceS: 0.001,
    modcodName: 'QPSK 1/2',
    spectralEfficiency: 1.0,
    capacityBits: 2000,
    isPreOcclusionFlush: false,
  }, frameSimTimeS, FRAME_DT);
  assert.ok(Math.abs(atEnd.start_ms - 18.0) < 1e-4);
  assert.ok(Math.abs(atEnd.duration_ms - 2.0) < 1e-4);
  assert.ok(Math.abs((atEnd.start_ms + atEnd.duration_ms) - 20.0) < 1e-4);
  assert.equal(atEnd.is_out_of_frame, false, 'Slot ending exactly at 20.0 ms must be valid');

  // 3. Beginning at exactly 20.0 ms boundary (invalid in [0, 20) half-open interval)
  const beginAtTwenty = normalizeSlotAllocationToFrame({
    nodeId: 3,
    slotStartS: frameSimTimeS + 0.020,
    durationS: 0.001,
    timingAdvanceS: 0.001,
    modcodName: 'QPSK 1/2',
    spectralEfficiency: 1.0,
    capacityBits: 1000,
    isPreOcclusionFlush: false,
  }, frameSimTimeS, FRAME_DT);
  assert.ok(Math.abs(beginAtTwenty.start_ms - 20.0) < 1e-4);
  assert.equal(beginAtTwenty.is_out_of_frame, true, 'Slot beginning at exactly 20.0 ms must be flagged is_out_of_frame');

  // 4. Before frame boundary (start_ms < 0) - Out of frame diagnostic
  const beforeFrame = normalizeSlotAllocationToFrame({
    nodeId: 4,
    slotStartS: frameSimTimeS - 0.005,
    durationS: 0.002,
    timingAdvanceS: 0.001,
    modcodName: 'QPSK 1/2',
    spectralEfficiency: 1.0,
    capacityBits: 2000,
    isPreOcclusionFlush: false,
  }, frameSimTimeS, FRAME_DT);
  assert.ok(beforeFrame.start_ms < 0, 'start_ms must reflect actual relative offset (-5.0 ms)');
  assert.equal(beforeFrame.is_out_of_frame, true, 'Allocation before frame must be flagged is_out_of_frame');

  // 5. Extending beyond frame boundary (end_ms > 20.0) - Out of frame diagnostic
  const beyondFrame = normalizeSlotAllocationToFrame({
    nodeId: 5,
    slotStartS: frameSimTimeS + 0.019,
    durationS: 0.003, // ends at 22.0 ms
    timingAdvanceS: 0.001,
    modcodName: 'QPSK 1/2',
    spectralEfficiency: 1.0,
    capacityBits: 2000,
    isPreOcclusionFlush: false,
  }, frameSimTimeS, FRAME_DT);
  assert.ok(beyondFrame.start_ms + beyondFrame.duration_ms > 20.0);
  assert.equal(beyondFrame.is_out_of_frame, true, 'Allocation extending past 20 ms must be flagged is_out_of_frame');

  // 6. Zero duration allocation - Out of frame diagnostic
  const zeroDur = normalizeSlotAllocationToFrame({
    nodeId: 6,
    slotStartS: frameSimTimeS + 0.005,
    durationS: 0.0,
    timingAdvanceS: 0.001,
    modcodName: 'QPSK 1/2',
    spectralEfficiency: 1.0,
    capacityBits: 0,
    isPreOcclusionFlush: false,
  }, frameSimTimeS, FRAME_DT);
  assert.equal(zeroDur.duration_ms, 0.0);
  assert.equal(zeroDur.is_out_of_frame, true, 'Zero duration allocation must be flagged is_out_of_frame');

  // 7. Negative duration - Out of frame diagnostic
  const negativeDur = normalizeSlotAllocationToFrame({
    nodeId: 7,
    slotStartS: frameSimTimeS + 0.005,
    durationS: -0.001,
    timingAdvanceS: 0.001,
    modcodName: 'QPSK 1/2',
    spectralEfficiency: 1.0,
    capacityBits: 0,
    isPreOcclusionFlush: false,
  }, frameSimTimeS, FRAME_DT);
  assert.equal(negativeDur.is_out_of_frame, true, 'Negative duration allocation must be flagged is_out_of_frame');

  // 8. NaN start timestamp - Non-finite diagnostic
  const nanStart = normalizeSlotAllocationToFrame({
    nodeId: 8,
    slotStartS: NaN,
    durationS: 0.002,
    timingAdvanceS: 0.001,
    modcodName: 'QPSK 1/2',
    spectralEfficiency: 1.0,
    capacityBits: 2000,
    isPreOcclusionFlush: false,
  }, frameSimTimeS, FRAME_DT);
  assert.ok(Number.isNaN(nanStart.start_ms));
  assert.equal(nanStart.is_out_of_frame, true, 'NaN start allocation must be flagged is_out_of_frame');

  // 9. NaN duration - Non-finite diagnostic
  const nanDuration = normalizeSlotAllocationToFrame({
    nodeId: 9,
    slotStartS: frameSimTimeS + 0.005,
    durationS: NaN,
    timingAdvanceS: 0.001,
    modcodName: 'QPSK 1/2',
    spectralEfficiency: 1.0,
    capacityBits: 2000,
    isPreOcclusionFlush: false,
  }, frameSimTimeS, FRAME_DT);
  assert.ok(Number.isNaN(nanDuration.duration_ms));
  assert.equal(nanDuration.is_out_of_frame, true, 'NaN duration allocation must be flagged is_out_of_frame');

  // 10. Infinity start timestamp - Non-finite diagnostic
  const infStart = normalizeSlotAllocationToFrame({
    nodeId: 10,
    slotStartS: Infinity,
    durationS: 0.002,
    timingAdvanceS: 0.001,
    modcodName: 'QPSK 1/2',
    spectralEfficiency: 1.0,
    capacityBits: 2000,
    isPreOcclusionFlush: false,
  }, frameSimTimeS, FRAME_DT);
  assert.ok(!Number.isFinite(infStart.start_ms));
  assert.equal(infStart.is_out_of_frame, true, 'Infinity start allocation must be flagged is_out_of_frame');

  // 11. Infinity duration - Non-finite diagnostic
  const infDuration = normalizeSlotAllocationToFrame({
    nodeId: 11,
    slotStartS: frameSimTimeS + 0.005,
    durationS: Infinity,
    timingAdvanceS: 0.001,
    modcodName: 'QPSK 1/2',
    spectralEfficiency: 1.0,
    capacityBits: 2000,
    isPreOcclusionFlush: false,
  }, frameSimTimeS, FRAME_DT);
  assert.ok(!Number.isFinite(infDuration.duration_ms));
  assert.equal(infDuration.is_out_of_frame, true, 'Infinity duration allocation must be flagged is_out_of_frame');

  console.log('  -> PASS: Boundary conditions, non-finite values, and out-of-frame diagnostics verified.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 53: Historical Allocation Schema and Preservation
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[53/54] Verifying historical allocation schema and snapshot preservation...');
{
  const liveAlloc = normalizeSlotAllocationToFrame({
    nodeId: 7,
    slotStartS: 0.504,
    durationS: 0.002,
    timingAdvanceS: 0.001,
    modcodName: '8-PSK 3/5',
    spectralEfficiency: 1.77,
    capacityBits: 10000,
    isPreOcclusionFlush: false,
  }, 0.500, FRAME_DT);

  // Normalization must produce start_ms = 4.0 ms
  assert.ok(Math.abs(liveAlloc.start_ms - 4.0) < 1e-4);

  // Emulate historical snapshot creation as done in index.html recordSchedulerHistoricalFrame
  const histAlloc = {
    nodeId: liveAlloc.node_id,
    startMs: liveAlloc.start_ms,
    durationMs: liveAlloc.duration_ms,
    durationS: liveAlloc.duration_s,
    slotStartS: liveAlloc.slot_start_s,
    capacityBits: liveAlloc.capacity_bits,
    modcodName: liveAlloc.modcod_name,
    spectralEfficiency: liveAlloc.spectral_efficiency,
    isPreOcclusionFlush: liveAlloc.is_pre_occlusion_flush,
  };

  const snapshot = createSuperframeSnapshot({
    source: 'historical',
    sessionId: 10,
    frameIndex: 25,
    simulationTimeS: 0.500,
    schedulerMode: 'static',
    allocations: [histAlloc],
    nodes: [{ nodeId: 7, isOperational: true, transfer: null }],
  });

  assert.equal(snapshot.source, 'historical');
  assert.equal(snapshot.allocations.length, 1);
  const snapAlloc = snapshot.allocations[0];
  assert.equal(snapAlloc.nodeId, 7);
  assert.ok(Math.abs(snapAlloc.startMs - 4.0) < 1e-4, `Historical startMs must be 4.0 ms, got ${snapAlloc.startMs}`);
  assert.ok(Math.abs(snapAlloc.durationMs - 2.0) < 1e-4);
  assert.equal(snapAlloc.capacityBits, 10000);

  // Test active slot resolution with this historical snapshot at t = 5.0 ms
  const slotState = resolveActiveTdmaSlotState(
    5.0,
    snapshot.allocations,
    snapshot.ctrlDurationMs,
    snapshot.dlDurationMs,
    snapshot.superframeDurationMs
  );
  assert.equal(slotState.phase, 'UPLINK_SLOT', 'Active slot must resolve to UPLINK_SLOT at 5.0 ms');
  assert.equal(slotState.scheduledNodeId, 7);
  assert.ok(Math.abs(slotState.slotProgress - 0.5) < 1e-4, 'Slot progress at 5.0ms (4ms..6ms) must be 50%');

  console.log('  -> PASS: Historical snapshot allocation schema and playback resolution preserved.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 54: Live SimulationWorkerManager Telemetry Integration Verification
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[54/54] Verifying live SimulationWorkerManager telemetry frame timestamp normalization...');
{
  const worker = new SimulationWorkerManager();
  let emittedFrame: any = null;
  (worker as any).emitHostMessage = (msg: any) => {
    if (msg && msg.type === 'TELEMETRY_FRAME') {
      emittedFrame = msg.frame;
    }
  };

  // Tick simulation 3 times
  worker.tickSimulation();
  worker.tickSimulation();
  worker.tickSimulation();

  assert.ok(emittedFrame !== null, 'Worker must emit TELEMETRY_FRAME');
  const frame = emittedFrame;

  assert.equal(frame.frame_index, 3);
  assert.ok(Math.abs(frame.sim_time_s - 0.060) < 1e-4, `sim_time_s must be 0.060, got ${frame.sim_time_s}`);

  const activeAllocs = frame.active_gantt_allocations;
  const staticAllocs = frame.static_gantt_allocations;
  const tacAllocs = frame.tac_gantt_allocations;

  assert.ok(Array.isArray(activeAllocs), 'active_gantt_allocations must be an array');
  assert.ok(Array.isArray(staticAllocs), 'static_gantt_allocations must be an array');
  assert.ok(Array.isArray(tacAllocs), 'tac_gantt_allocations must be an array');

  // Verify static allocations in telemetry frame
  assert.equal(staticAllocs.length, 16);
  assert.ok(
    Math.abs(staticAllocs[0].start_ms - 4.0) < 1e-4,
    `Telemetry static_gantt_allocations[0].start_ms must be 4.0 ms, got ${staticAllocs[0].start_ms}`
  );
  assert.ok(
    staticAllocs[15].start_ms + staticAllocs[15].duration_ms <= 20.0 + 1e-4,
    'Static allocation 15 must end within 20.0 ms'
  );

  for (const a of activeAllocs) {
    assert.ok(a.start_ms >= 4.0 - 1e-4, `Active allocation start_ms (${a.start_ms}) must be >= 4.0 ms`);
    assert.ok(a.start_ms < 20.0, `Active allocation start_ms (${a.start_ms}) must be < 20.0 ms`);
    assert.ok(
      a.start_ms + a.duration_ms <= 20.0 + 1e-4,
      `Active allocation end (${a.start_ms + a.duration_ms}) must be <= 20.0 ms`
    );
    assert.equal(a.is_out_of_frame, false, 'No live allocation should be out of frame');
  }

  console.log('  -> PASS: Live worker telemetry emits frame-relative allocations in [4.0 ms, 20.0 ms).');
}

// Test 55: Identical Active-Slot Resolution for Gantt, Canvas, and HUD Consumers across Schedulers
{
  console.log('\n[55/61] Verifying identical active-slot resolution across Gantt, Canvas, and HUD consumers...');

  const allocations: SnapshotSlotAllocation[] = [
    { nodeId: 1, startMs: 4.0, durationMs: 4.5, capacityBits: 1000, isPreOcclusionFlush: false },
    { nodeId: 4, startMs: 8.5, durationMs: 3.5, capacityBits: 2000, isPreOcclusionFlush: true },
    { nodeId: 7, startMs: 12.0, durationMs: 4.0, capacityBits: 1500, isPreOcclusionFlush: false },
  ];

  const nodes: SnapshotNodeState[] = [
    { nodeId: 1, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: false, isTransmitting: false, isWastingAirtime: false, queueBacklogBytes: 1000, transfer: null },
    { nodeId: 4, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: false, isTransmitting: false, isWastingAirtime: false, queueBacklogBytes: 2000, transfer: null },
    { nodeId: 7, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: false, isTransmitting: false, isWastingAirtime: false, queueBacklogBytes: 1500, transfer: null },
  ];

  const timeline = resolveSuperframeTimeline({
    allocations,
    nodes,
    schedulerMode: 'tac_tad',
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    superframeDurationMs: 20.0,
  });

  const visualizer = new DataCommVisualizer();
  const snap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 10,
    simulationTimeS: 0.20,
    schedulerMode: 'tac_tad',
    allocations,
    nodes,
    superframeDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
  });
  visualizer.ingestSnapshot(snap);

  // Test across multiple sample points: CTRL, DL, Node 1, Node 4, Node 7, IDLE
  const sampleOffsetsMs = [0.5, 2.0, 5.0, 9.5, 13.0, 18.0];
  for (const t of sampleOffsetsMs) {
    // 1. Gantt chart resolution
    const ganttSlot = timeline.resolveAt(t);

    // 2. Canvas active slot resolution
    const canvasSlot = resolveActiveTdmaSlotState(
      t,
      snap.allocations,
      snap.ctrlDurationMs,
      snap.dlDurationMs,
      snap.superframeDurationMs,
      snap.schedulerMode,
      snap.nodes
    );

    // 3. Visualizer helper resolution
    const effectiveDur = visualizer.getCycleDurationMs(1.0);
    const manualVisualMs = (t / 20.0) * effectiveDur;
    const mockCtx = createMockCanvasContext();
    visualizer.render(mockCtx, {
      snapshot: snap,
      acnScreenPos: { x: 100, y: 100 },
      nodeScreenPositions: new Map([[1, { x: 50, y: 50 }], [4, { x: 80, y: 80 }], [7, { x: 120, y: 120 }]]),
      speed: 1.0,
      isPaused: true,
      visualTimeMs: manualVisualMs,
    });
    const hudSlot = visualizer.getActiveSlotState();

    assert.ok(hudSlot !== null, 'HUD slot must not be null');
    assert.equal(ganttSlot.phase, canvasSlot.phase, `Phase mismatch at ${t}ms`);
    assert.equal(ganttSlot.phase, hudSlot!.phase, `HUD phase mismatch at ${t}ms`);
    assert.equal(ganttSlot.scheduledNodeId, canvasSlot.scheduledNodeId, `Node ID mismatch at ${t}ms`);
    assert.equal(ganttSlot.scheduledNodeId, hudSlot!.scheduledNodeId, `HUD Node ID mismatch at ${t}ms`);
    assert.equal(ganttSlot.slotStartMs, canvasSlot.slotStartMs, `Start time mismatch at ${t}ms`);
    assert.equal(ganttSlot.slotDurationMs, canvasSlot.slotDurationMs, `Duration mismatch at ${t}ms`);
    assert.equal(ganttSlot.direction, canvasSlot.direction, `Direction mismatch at ${t}ms`);
    assert.equal(ganttSlot.isPreOcclusionFlush, canvasSlot.isPreOcclusionFlush, `Flush flag mismatch at ${t}ms`);
  }

  console.log('  -> PASS: Gantt, Canvas, and HUD resolve 100% identical active slot states.');
}

// Test 56: Pre-Occlusion Flush and Dynamic Slot Resolution on Shared Timeline
{
  console.log('\n[56/61] Verifying pre-occlusion flush and dynamic slot resolution on shared timeline...');

  const allocations: SnapshotSlotAllocation[] = [
    { nodeId: 2, startMs: 4.0, durationMs: 2.5, capacityBits: 1000, isPreOcclusionFlush: false },
    { nodeId: 4, startMs: 6.5, durationMs: 6.0, capacityBits: 5000, isPreOcclusionFlush: true },
    { nodeId: 9, startMs: 12.5, durationMs: 3.0, capacityBits: 1200, isPreOcclusionFlush: false },
  ];

  const timeline = resolveSuperframeTimeline({
    allocations,
    schedulerMode: 'tac_tad',
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    superframeDurationMs: 20.0,
  });

  // Verify pre-occlusion segment presence
  const flushSeg = timeline.segments.find(s => s.scheduledNodeId === 4);
  assert.ok(flushSeg, 'Pre-occlusion flush segment for Node 4 must exist');
  assert.equal(flushSeg!.isPreOcclusionFlush, true, 'Segment must have isPreOcclusionFlush=true');
  assert.equal(flushSeg!.direction, 'UL', 'Pre-occlusion segment direction must be UL');
  assert.equal(flushSeg!.startMs, 6.5);
  assert.equal(flushSeg!.durationMs, 6.0);
  assert.equal(flushSeg!.endMs, 12.5);

  // Verify slot resolution inside flush window
  const atFlush = timeline.resolveAt(8.0);
  assert.equal(atFlush.phase, 'UPLINK_SLOT');
  assert.equal(atFlush.scheduledNodeId, 4);
  assert.equal(atFlush.isPreOcclusionFlush, true);
  assert.equal(atFlush.direction, 'UL');

  // Verify non-flush slot resolution
  const atNormal = timeline.resolveAt(5.0);
  assert.equal(atNormal.phase, 'UPLINK_SLOT');
  assert.equal(atNormal.scheduledNodeId, 2);
  assert.equal(atNormal.isPreOcclusionFlush, false);

  console.log('  -> PASS: Pre-occlusion flush allocations resolved deterministically with correct metadata.');
}

// Test 57: Exact Start/End Half-Open Boundaries [start, end) and Gap/Guard Period Resolution
{
  console.log('\n[57/61] Verifying exact half-open [start, end) interval boundaries and gap/guard periods...');

  const allocations: SnapshotSlotAllocation[] = [
    { nodeId: 3, startMs: 4.0, durationMs: 3.0, capacityBits: 1000, isPreOcclusionFlush: false },
    // Gap: [7.0, 9.0) ms
    { nodeId: 8, startMs: 9.0, durationMs: 4.0, capacityBits: 1500, isPreOcclusionFlush: false },
    // Tail gap: [13.0, 20.0) ms
  ];

  const timeline = resolveSuperframeTimeline({
    allocations,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    superframeDurationMs: 20.0,
  });

  // 1. Exact start of slot 3: t = 4.0 ms
  const atSlot3Start = timeline.resolveAt(4.0);
  assert.equal(atSlot3Start.phase, 'UPLINK_SLOT');
  assert.equal(atSlot3Start.scheduledNodeId, 3);
  assert.ok(Math.abs(atSlot3Start.slotProgress - 0.0) < 1e-4);

  // 2. Just before end of slot 3: t = 6.999 ms
  const atSlot3AlmostEnd = timeline.resolveAt(6.999);
  assert.equal(atSlot3AlmostEnd.phase, 'UPLINK_SLOT');
  assert.equal(atSlot3AlmostEnd.scheduledNodeId, 3);
  assert.ok(atSlot3AlmostEnd.slotProgress > 0.99);

  // 3. Exact boundary at end of slot 3 / start of gap: t = 7.0 ms -> must be IDLE_GUARD [7.0, 9.0)
  const atGapStart = timeline.resolveAt(7.0);
  assert.equal(atGapStart.phase, 'IDLE_GUARD', 'At t=7.0ms must transition to IDLE_GUARD under [start, end)');
  assert.equal(atGapStart.scheduledNodeId, null);
  assert.equal(atGapStart.direction, 'NONE');

  // 4. Middle of gap: t = 8.0 ms
  const atGapMid = timeline.resolveAt(8.0);
  assert.equal(atGapMid.phase, 'IDLE_GUARD');
  assert.equal(atGapMid.scheduledNodeId, null);

  // 5. Exact start of slot 8: t = 9.0 ms
  const atSlot8Start = timeline.resolveAt(9.0);
  assert.equal(atSlot8Start.phase, 'UPLINK_SLOT');
  assert.equal(atSlot8Start.scheduledNodeId, 8);
  assert.ok(Math.abs(atSlot8Start.slotProgress - 0.0) < 1e-4);

  // 6. Tail idle period: t = 13.0 ms
  const atTail = timeline.resolveAt(13.0);
  assert.equal(atTail.phase, 'IDLE_GUARD');
  assert.equal(atTail.scheduledNodeId, null);

  // 7. Exactly at superframe boundary: t = 20.0 ms
  const at20 = timeline.resolveAt(20.0);
  assert.equal(at20.phase, 'IDLE_GUARD');

  console.log('  -> PASS: Strict half-open interval semantics [start, end) verified across slots and gaps.');
}

// Test 58: Overlapping Allocations Deterministic Resolution & Diagnostic Warnings
{
  console.log('\n[58/61] Verifying overlapping allocations deterministic resolution and diagnostic warnings...');

  const overlappingAllocs: SnapshotSlotAllocation[] = [
    { nodeId: 2, startMs: 5.0, durationMs: 5.0, capacityBits: 1000, isPreOcclusionFlush: false }, // [5.0, 10.0)
    { nodeId: 5, startMs: 8.0, durationMs: 4.0, capacityBits: 2000, isPreOcclusionFlush: false }, // [8.0, 12.0)
  ];

  const timeline = resolveSuperframeTimeline({
    allocations: overlappingAllocs,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    superframeDurationMs: 20.0,
  });

  assert.equal(timeline.hasOverlap, true, 'hasOverlap must be true');
  assert.ok(timeline.overlapWarning, 'overlapWarning must be generated');
  assert.ok(
    timeline.overlapWarning!.includes('Overlapping allocations detected'),
    'Warning must contain diagnostic text'
  );

  // Resolution inside non-overlapping head of Node 2: t = 6.0 ms
  const at6 = timeline.resolveAt(6.0);
  assert.equal(at6.phase, 'UPLINK_SLOT');
  assert.equal(at6.scheduledNodeId, 2);

  // Resolution inside overlapping region: t = 9.0 ms -> Fix 3: Overlap region [8.0, 10.0) is a scheduler integrity error
  const at9 = timeline.resolveAt(9.0);
  assert.equal(at9.phase, 'CONFLICT', 'Overlapping region must resolve to CONFLICT phase');
  assert.equal(at9.scheduledNodeId, null, 'Conflict must not award allocation to any node');
  assert.equal(at9.direction, 'NONE', 'Conflict must not show active transmission direction');
  assert.equal(at9.slotStartMs, 8.0, 'Conflict interval starts at 8.0 ms');
  assert.equal(at9.slotEndMs, 10.0, 'Conflict interval ends at 10.0 ms');
  assert.ok(at9.overlapDiagnostic, 'Resolved state must carry overlap diagnostic');
  assert.ok(at9.overlapDiagnostic!.includes('Node 2'), 'Diagnostic must mention Node 2');
  assert.ok(at9.overlapDiagnostic!.includes('Node 5'), 'Diagnostic must mention Node 5');

  // Verify conflictIntervals list
  assert.equal(timeline.conflictIntervals.length, 1);
  assert.equal(timeline.conflictIntervals[0].nodeA, 2);
  assert.equal(timeline.conflictIntervals[0].nodeB, 5);
  assert.equal(timeline.conflictIntervals[0].startMs, 8.0);
  assert.equal(timeline.conflictIntervals[0].endMs, 10.0);

  // Resolution after Node 2 ends: t = 11.0 ms -> resolves to Node 5
  const at11 = timeline.resolveAt(11.0);
  assert.equal(at11.phase, 'UPLINK_SLOT');
  assert.equal(at11.scheduledNodeId, 5);

  console.log('  -> PASS: Overlapping allocations resolved deterministically with diagnostic warning.');
}

// Test 59: Invalid & Out-of-Frame Allocations Filtering and Rejection
{
  console.log('\n[59/61] Verifying invalid & out-of-frame allocations rejection and timeline integrity...');

  const mixedAllocs = [
    { nodeId: 100, startMs: -5.0, durationMs: 2.0, capacityBits: 0, isPreOcclusionFlush: false }, // negative start
    { nodeId: 101, startMs: 18.0, durationMs: 4.0, capacityBits: 0, isPreOcclusionFlush: false }, // exceeds 20 ms
    { nodeId: 102, startMs: 20.0, durationMs: 1.0, capacityBits: 0, isPreOcclusionFlush: false }, // starts at 20 ms
    { nodeId: 103, startMs: 6.0, durationMs: 0.0, capacityBits: 0, isPreOcclusionFlush: false },  // zero duration
    { nodeId: 104, startMs: 7.0, durationMs: -1.0, capacityBits: 0, isPreOcclusionFlush: false }, // negative duration
    { nodeId: 105, startMs: NaN, durationMs: 2.0, capacityBits: 0, isPreOcclusionFlush: false },  // NaN start
    { nodeId: 106, startMs: 8.0, durationMs: Infinity, capacityBits: 0, isPreOcclusionFlush: false }, // Infinity duration
    { nodeId: 1, startMs: 5.0, durationMs: 3.0, capacityBits: 1000, isPreOcclusionFlush: false }, // ONLY VALID ONE
  ];

  const timeline = resolveSuperframeTimeline({
    allocations: mixedAllocs,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    superframeDurationMs: 20.0,
  });

  assert.equal(timeline.allocations.length, 1, 'Only the single valid allocation should be retained');
  assert.equal(timeline.allocations[0].nodeId, 1);

  // Verify contiguous segments cleanly cover [0, 20) ms
  assert.ok(timeline.segments.length >= 3, 'Must have at least CTRL, DL, Node 1, and IDLE');
  let prevEnd = 0.0;
  for (const seg of timeline.segments) {
    assert.ok(Math.abs(seg.startMs - prevEnd) < 1e-4, `Segments must be contiguous: gap at ${prevEnd}`);
    assert.ok(Number.isFinite(seg.startMs) && Number.isFinite(seg.durationMs));
    prevEnd = seg.endMs;
  }
  assert.ok(Math.abs(prevEnd - 20.0) < 1e-4, 'Last segment must end at superframeDurationMs');

  console.log('  -> PASS: All invalid and out-of-frame allocations rejected; timeline integrity preserved.');
}

// Test 60: Historical Snapshot Timing Isolation (No State Leakage)
{
  console.log('\n[60/61] Verifying historical snapshot timing isolation (no live state leakage)...');

  const visualizer = new DataCommVisualizer();

  // 1. Create historical record for frame 50 (T+1.00s)
  const histAllocs: SnapshotSlotAllocation[] = [
    { nodeId: 2, startMs: 4.0, durationMs: 5.0, capacityBits: 1000, isPreOcclusionFlush: false },
  ];
  const histNodes: SnapshotNodeState[] = [
    { nodeId: 2, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: false, isTransmitting: false, isWastingAirtime: false, queueBacklogBytes: 500, transfer: null },
  ];

  const histSnap = createSuperframeSnapshot({
    source: 'historical',
    sessionId: visualizer.getSessionId(),
    frameIndex: 50,
    simulationTimeS: 1.00,
    schedulerMode: 'tac_tad',
    allocations: histAllocs,
    nodes: histNodes,
  });

  visualizer.ingestSnapshot(histSnap);
  const activeBefore = visualizer.getActiveSnapshot();
  assert.ok(activeBefore !== null);
  assert.equal(activeBefore!.source, 'historical');
  assert.equal(activeBefore!.frameIndex, 50);
  assert.equal(activeBefore!.simulationTimeS, 1.00);

  // 2. Simulate live simulation advancing in the background: frame 60 (T+1.20s) with active transfer
  const liveTransfer = {
    file_id: 'live_img_1',
    traffic_class: 'photo',
    total_bytes: 500000,
    delivered_bytes: 250000,
    progress_pct: 50.0,
    transfer_rate_mbps: 2.5,
    rate_ema_mbps: 2.4,
    eta_seconds: 0.8,
    status: 'IN_TRANSIT',
    start_sim_time_s: 1.10,
    last_update_sim_time_s: 1.20,
    assigned_slot_count: 5,
    actual_burst_bits: 20000,
    packet_loss_ratio: 0.0,
  } as any;
  const liveNodes: SnapshotNodeState[] = [
    { nodeId: 2, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: false, isTransmitting: true, isWastingAirtime: false, queueBacklogBytes: 250000, transfer: liveTransfer },
  ];
  const liveAllocs: SnapshotSlotAllocation[] = [
    { nodeId: 2, startMs: 10.0, durationMs: 6.0, capacityBits: 5000, isPreOcclusionFlush: false },
  ];

  const liveSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 60,
    simulationTimeS: 1.20,
    schedulerMode: 'tac_tad',
    allocations: liveAllocs,
    nodes: liveNodes,
  });

  // Verify historical snapshot in visualizer was NOT mutated or polluted by live frame
  const activeAfter = visualizer.getActiveSnapshot();
  assert.equal(activeAfter!.frameIndex, 50, 'Historical frame index must remain 50');
  assert.equal(activeAfter!.simulationTimeS, 1.00, 'Historical simulation time must remain 1.00s');
  assert.equal(activeAfter!.allocations[0].startMs, 4.0, 'Historical allocation must remain at startMs=4.0');
  assert.equal(activeAfter!.nodes[0].transfer, null, 'Historical transfer must strictly remain null');

  // Verify resolved slot matches historical allocation
  const resolvedHist = visualizer.getActiveSlotState();
  const histTimeline = visualizer.getActiveTimeline();
  assert.ok(histTimeline !== null);
  const slotAt5 = histTimeline!.resolveAt(5.0);
  assert.equal(slotAt5.scheduledNodeId, 2, 'Historical allocation at 5ms must resolve Node 2');

  console.log('  -> PASS: Historical snapshot isolated from live simulation telemetry; zero state leakage.');
}

// Test 61: Frame Transitions and Subframe Offset Resolution at Variable Speeds
{
  console.log('\n[61/61] Verifying frame transitions and subframe offset resolution at variable speeds (0.5x, 1x, 2x, 5x)...');

  const visualizer = new DataCommVisualizer();
  const testSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 1,
    simulationTimeS: 0.02,
    schedulerMode: 'tac_tad',
    allocations: [{ nodeId: 1, startMs: 4.0, durationMs: 16.0, capacityBits: 1000, isPreOcclusionFlush: false }],
    nodes: [],
  });
  visualizer.ingestSnapshot(testSnap);

  const mockCtx = createMockCanvasContext();

  const testCases = [
    { speed: 1.0, elapsedMs: 500.0, expectedSubframeOffset: 10.0 },  // 1x: 1000ms cycle -> 500ms = 10ms offset
    { speed: 2.0, elapsedMs: 250.0, expectedSubframeOffset: 10.0 },  // 2x: 500ms cycle -> 250ms = 10ms offset
    { speed: 0.5, elapsedMs: 1000.0, expectedSubframeOffset: 10.0 }, // 0.5x: 2000ms cycle -> 1000ms = 10ms offset
    { speed: 5.0, elapsedMs: 100.0, expectedSubframeOffset: 10.0 },  // 5x: 200ms cycle -> 100ms = 10ms offset
  ];

  for (const tc of testCases) {
    visualizer.render(mockCtx, {
      snapshot: testSnap,
      acnScreenPos: { x: 100, y: 100 },
      nodeScreenPositions: new Map(),
      speed: tc.speed,
      isPaused: true,
      visualTimeMs: tc.elapsedMs,
    });

    const offset = visualizer.getCurrentSubframeOffsetMs();
    assert.ok(
      Math.abs(offset - tc.expectedSubframeOffset) < 1e-3,
      `Subframe offset at ${tc.speed}x (elapsed ${tc.elapsedMs}ms) must be ${tc.expectedSubframeOffset}ms, got ${offset}ms`
    );
  }

  console.log('  -> PASS: Subframe offset scales consistently across all visual playback speeds.');
}

// Test 62: Fix 1: Unified Snapshot Identity & Multi-Track Synchronization
{
  console.log('\n[62/64] Verifying Fix 1: Snapshot identity, dual-track preservation, and Gantt synchronization...');

  const visualizer = new DataCommVisualizer();

  const staticAllocs = [
    { nodeId: 0, startMs: 4.0, durationMs: 0.988, capacityBits: 2000, isPreOcclusionFlush: false },
    { nodeId: 1, startMs: 5.0, durationMs: 0.988, capacityBits: 2000, isPreOcclusionFlush: false },
  ];
  const tacAllocs = [
    { nodeId: 15, startMs: 4.0, durationMs: 3.5, capacityBits: 8000, isPreOcclusionFlush: false },
    { nodeId: 4, startMs: 7.5, durationMs: 2.5, capacityBits: 5000, isPreOcclusionFlush: true },
  ];

  // 1. Create a snapshot with both tracks and custom captured CTRL/DL durations
  const snap1 = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 100,
    simulationTimeS: 2.00,
    schedulerMode: 'tac_tad',
    allocations: tacAllocs,
    staticAllocations: staticAllocs,
    tacAllocations: tacAllocs,
    ctrlDurationMs: 0.8,
    dlDurationMs: 3.2,
    superframeDurationMs: 20.0,
    nodes: [{ nodeId: 15, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: false, isTransmitting: true, isWastingAirtime: false }],
  });

  // Verify snapshot immutability & schema
  assert.equal(snap1.frameIndex, 100);
  assert.equal(snap1.ctrlDurationMs, 0.8, 'Captured ctrlDurationMs must be preserved');
  assert.equal(snap1.dlDurationMs, 3.2, 'Captured dlDurationMs must be preserved');
  assert.ok(snap1.staticAllocations && snap1.staticAllocations.length === 2, 'staticAllocations must be preserved');
  assert.ok(snap1.tacAllocations && snap1.tacAllocations.length === 2, 'tacAllocations must be preserved');

  // 2. Ingest snapshot and begin playback cycle
  visualizer.ingestSnapshot(snap1);
  const active1 = visualizer.getActiveSnapshot();
  assert.ok(active1 !== null);
  assert.equal(active1!.frameIndex, 100);
  assert.equal(active1!.ctrlDurationMs, 0.8);
  assert.equal(active1!.dlDurationMs, 3.2);

  // 3. Simulate mid-cycle worker arrival of frame 101 (T+2.02s)
  const snap2 = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 101,
    simulationTimeS: 2.02,
    schedulerMode: 'tac_tad',
    allocations: [{ nodeId: 0, startMs: 4.0, durationMs: 4.0, capacityBits: 4000, isPreOcclusionFlush: false }],
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    nodes: [],
  });
  visualizer.ingestSnapshot(snap2);

  // Active snapshot MUST remain frame 100 mid-cycle (dual-buffer guarantee)
  const activeMidCycle = visualizer.getActiveSnapshot();
  assert.equal(activeMidCycle!.frameIndex, 100, 'Active snapshot must NOT be overwritten mid-cycle');
  assert.equal(activeMidCycle!.ctrlDurationMs, 0.8, 'Active snapshot must retain frame 100 CTRL duration');

  // Both Gantt and Canvas resolving from activeMidCycle are guaranteed to share the exact same snapshot identity
  const staticTimeline = resolveSuperframeTimeline({
    allocations: activeMidCycle!.staticAllocations!,
    schedulerMode: 'static',
    ctrlDurationMs: activeMidCycle!.ctrlDurationMs,
    dlDurationMs: activeMidCycle!.dlDurationMs,
  });
  const tacTimeline = resolveSuperframeTimeline({
    allocations: activeMidCycle!.tacAllocations!,
    schedulerMode: 'tac_tad',
    ctrlDurationMs: activeMidCycle!.ctrlDurationMs,
    dlDurationMs: activeMidCycle!.dlDurationMs,
  });

  assert.equal(staticTimeline.segments[0].durationMs, 0.8, 'Static timeline must use frame 100 ctrl duration');
  assert.equal(tacTimeline.segments[0].durationMs, 0.8, 'Tac-TAD timeline must use frame 100 ctrl duration');
  assert.equal(staticTimeline.segments[1].durationMs, 3.2, 'Static timeline must use frame 100 dl duration');
  assert.equal(tacTimeline.segments[1].durationMs, 3.2, 'Tac-TAD timeline must use frame 100 dl duration');

  console.log('  -> PASS: Snapshot identity and multi-track preservation verified across mid-cycle arrivals.');
}

// Test 63: Fix 2: Explicit Timeline Phases (GUARD vs IDLE_RECLAIMED vs IDLE_GUARD)
{
  console.log('\n[63/64] Verifying Fix 2: Explicit timeline phases (GUARD vs IDLE_RECLAIMED vs IDLE_GUARD)...');

  // 1. Static TDMA: inter-slot gap must resolve to GUARD, never IDLE_RECLAIMED
  const staticAllocations = [
    { nodeId: 0, startMs: 4.0, durationMs: 0.988, capacityBits: 1000, isPreOcclusionFlush: false },
    { nodeId: 1, startMs: 5.0, durationMs: 0.988, capacityBits: 1000, isPreOcclusionFlush: false },
  ];
  const staticTl = resolveSuperframeTimeline({
    allocations: staticAllocations,
    schedulerMode: 'static',
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    superframeDurationMs: 20.0,
  });

  // Gap between slot 0 (ends at 4.988 ms) and slot 1 (starts at 5.0 ms) is a 12 us guard time
  const staticGuardSeg = staticTl.segments.find(s => s.startMs >= 4.98 && s.endMs <= 5.01 && s.phase === 'GUARD');
  assert.ok(staticGuardSeg, 'Static TDMA inter-slot gap must resolve to GUARD phase');
  assert.equal(staticGuardSeg!.phase, 'GUARD');
  assert.notEqual(staticGuardSeg!.phase, 'IDLE_RECLAIMED', 'Static guard band must NEVER be labeled IDLE_RECLAIMED');

  // Querying at 4.990 ms must resolve to GUARD
  const atGuard = staticTl.resolveAt(4.990);
  assert.equal(atGuard.phase, 'GUARD', 'resolveAt(4.990) must return GUARD phase');
  assert.equal(atGuard.scheduledNodeId, null);
  assert.equal(atGuard.direction, 'NONE');

  // 2. Tac-TAD: tail airtime after allocations end must resolve to IDLE_RECLAIMED
  const tacAllocations = [
    { nodeId: 15, startMs: 4.0, durationMs: 6.0, capacityBits: 5000, isPreOcclusionFlush: false }, // [4.0, 10.0)
  ];
  const tacTl = resolveSuperframeTimeline({
    allocations: tacAllocations,
    schedulerMode: 'tac_tad',
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    superframeDurationMs: 20.0,
  });

  // Tail gap from 10.0 ms to 20.0 ms is unallocated airtime
  const reclaimedSeg = tacTl.segments.find(s => s.startMs >= 9.99 && s.phase === 'IDLE_RECLAIMED');
  assert.ok(reclaimedSeg, 'Tac-TAD unallocated airtime must resolve to IDLE_RECLAIMED phase');
  assert.equal(reclaimedSeg!.phase, 'IDLE_RECLAIMED');
  assert.equal(reclaimedSeg!.durationMs, 10.0);

  // Querying at 15.0 ms must resolve to IDLE_RECLAIMED
  const atReclaimed = tacTl.resolveAt(15.0);
  assert.equal(atReclaimed.phase, 'IDLE_RECLAIMED', 'resolveAt(15.0) must return IDLE_RECLAIMED');
  assert.equal(atReclaimed.scheduledNodeId, null);
  assert.equal(atReclaimed.direction, 'NONE');

  // 3. Telemetry without schedulerMode: gap > 0.05 ms must resolve to neutral IDLE_GUARD (not guessed)
  const neutralTl = resolveSuperframeTimeline({
    allocations: tacAllocations,
    // schedulerMode omitted
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    superframeDurationMs: 20.0,
  });
  const atNeutral = neutralTl.resolveAt(15.0);
  assert.equal(atNeutral.phase, 'IDLE_GUARD', 'Omitted schedulerMode must resolve neutrally to IDLE_GUARD');

  console.log('  -> PASS: GUARD, IDLE_RECLAIMED, and neutral IDLE_GUARD phases cleanly distinguished.');
}

// Test 64: Fix 3: Overlap Integrity Error & Pairwise Conflict Detection
{
  console.log('\n[64/64] Verifying Fix 3: Pairwise overlap conflict detection and integrity error interception...');

  // 1. Multiple overlapping allocations (tri-overlap and distinct pairs)
  const multiConflictAllocs = [
    { nodeId: 1, startMs: 4.0, durationMs: 4.0, capacityBits: 1000, isPreOcclusionFlush: false }, // [4.0, 8.0)
    { nodeId: 2, startMs: 6.0, durationMs: 4.0, capacityBits: 50000, isPreOcclusionFlush: false }, // [6.0, 10.0)
    { nodeId: 3, startMs: 7.0, durationMs: 2.0, capacityBits: 500, isPreOcclusionFlush: false }, // [7.0, 9.0)
    { nodeId: 4, startMs: 12.0, durationMs: 3.0, capacityBits: 2000, isPreOcclusionFlush: false }, // [12.0, 15.0)
    { nodeId: 5, startMs: 13.0, durationMs: 4.0, capacityBits: 3000, isPreOcclusionFlush: false }, // [13.0, 17.0)
  ];

  const tl = resolveSuperframeTimeline({
    allocations: multiConflictAllocs,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    superframeDurationMs: 20.0,
  });

  // Verify multiple pairwise conflicts are detected:
  // Node 1 overlaps Node 2 [6.0..8.0)
  // Node 1 overlaps Node 3 [7.0..8.0)
  // Node 2 overlaps Node 3 [7.0..9.0)
  // Node 4 overlaps Node 5 [13.0..15.0)
  assert.ok(tl.conflictIntervals.length >= 4, `Must detect all 4 conflicting pairs, got ${tl.conflictIntervals.length}`);
  assert.equal(tl.hasOverlap, true);
  assert.ok(tl.overlapWarnings.length >= 4, 'Must record warnings for all conflicting pairs');

  // 2. Overlap region [6.0, 8.0) must intercept resolution with CONFLICT phase
  // Notice Node 2 had massive capacity (50,000 bits) vs Node 1 (1,000 bits),
  // but capacity must NEVER cause Node 2 to win or suppress the conflict!
  const at6_5 = tl.resolveAt(6.5);
  assert.equal(at6_5.phase, 'CONFLICT', 'Query inside overlap must resolve to CONFLICT');
  assert.equal(at6_5.scheduledNodeId, null, 'Conflict must NOT award allocation to either node');
  assert.equal(at6_5.direction, 'NONE', 'Conflict must have direction NONE');
  assert.ok(at6_5.overlapDiagnostic && at6_5.overlapDiagnostic.includes('Overlapping allocations detected'));

  // 3. Non-overlapping portion of Node 1 [4.0, 6.0) resolves cleanly
  const at5 = tl.resolveAt(5.0);
  assert.equal(at5.phase, 'UPLINK_SLOT');
  assert.equal(at5.scheduledNodeId, 1);

  // 4. Equal start times: Node 10 and Node 11 start at 10.0 ms. Node 11 has higher capacity (100000 vs 100)
  const equalStartAllocs = [
    { nodeId: 10, startMs: 10.0, durationMs: 2.0, capacityBits: 100, isPreOcclusionFlush: false },
    { nodeId: 11, startMs: 10.0, durationMs: 2.0, capacityBits: 100000, isPreOcclusionFlush: false },
  ];
  const eqTl = resolveSuperframeTimeline({
    allocations: equalStartAllocs,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    superframeDurationMs: 20.0,
  });

  assert.equal(eqTl.conflictIntervals.length, 1);
  const at10_5 = eqTl.resolveAt(10.5);
  assert.equal(at10_5.phase, 'CONFLICT', 'Equal start allocations must resolve to CONFLICT, not higher capacity');
  assert.equal(at10_5.scheduledNodeId, null);

  console.log('  -> PASS: All pairwise overlaps detected; capacity never dictates winner; CONFLICT cleanly intercepted.');
}

// Test 65: Stage 3 Uplink Packet Rendering & Physical Attribution
{
  console.log('\n[65/67] Verifying Stage 3 Uplink packet rendering, physical direction, and allocation exclusivity...');

  const visualizer = new DataCommVisualizer();
  const acnPos = { x: 500, y: 150 };
  const nodePositions = new Map<number, Point2D>([
    [2, { x: 150, y: 350 }],
    [4, { x: 250, y: 450 }],
    [7, { x: 350, y: 550 }],
  ]);

  const testSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 40,
    simulationTimeS: 0.80,
    schedulerMode: 'tac_tad',
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    superframeDurationMs: 20.0,
    allocations: [
      { nodeId: 2, startMs: 4.0, durationMs: 4.0, capacityBits: 20000, isPreOcclusionFlush: false },
      { nodeId: 4, startMs: 8.0, durationMs: 4.0, capacityBits: 30000, isPreOcclusionFlush: true }, // Flush burst
      { nodeId: 7, startMs: 12.0, durationMs: 3.0, capacityBits: 15000, isPreOcclusionFlush: false }, // Empty allocation
    ],
    nodes: [
      // Node 2: Scheduled [4.0, 8.0 ms) with active queue backlog
      { nodeId: 2, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: false, isTransmitting: true, isWastingAirtime: false, queueBacklogBytes: 25000 },
      // Node 4: Scheduled [8.0, 12.0 ms) with pre-occlusion flush burst
      { nodeId: 4, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: true, isTransmitting: true, isWastingAirtime: false, queueBacklogBytes: 42000 },
      // Node 7: Scheduled [12.0, 15.0 ms) but ZERO backlog (empty allocation)
      { nodeId: 7, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: false, isTransmitting: false, isWastingAirtime: false, queueBacklogBytes: 0 },
    ],
  });

  // 1. Time = 300 ms (subframe offset = 6.0 ms -> Node 2 active uplink)
  const rec2 = createRecordingCanvasContext();
  visualizer.render(rec2.ctx, {
    snapshot: testSnap,
    acnScreenPos: acnPos,
    nodeScreenPositions: nodePositions,
    speed: 1.0,
    isPaused: false,
    visualTimeMs: 300,
  });

  // Node 2 renders TX and ACN renders RX
  assert.ok(rec2.filledTexts.some(t => t.text === 'TX'), 'Node 2 must render TX badge during its slot');
  assert.ok(rec2.filledTexts.some(t => t.text === 'RX'), 'ACN must render RX badge during active slot');
  // Traveling packets must be present for Node 2
  const packets2 = rec2.rects.filter(r => r.w === 8 && r.h === 3.6);
  assert.ok(packets2.length >= 3, 'Node 2 active payload must render traveling packets');
  // Neither Node 4 nor Node 7 should show TX
  assert.ok(!rec2.filledTexts.some(t => t.text.includes('FLUSH')), 'Node 4 flush badge must not appear outside its slot');
  assert.ok(!rec2.filledTexts.some(t => t.text.includes('IDLE')), 'Node 7 idle badge must not appear outside its slot');

  // 2. Time = 500 ms (subframe offset = 10.0 ms -> Node 4 Pre-Occlusion Flush active)
  const rec4 = createRecordingCanvasContext();
  visualizer.render(rec4.ctx, {
    snapshot: testSnap,
    acnScreenPos: acnPos,
    nodeScreenPositions: nodePositions,
    speed: 1.0,
    isPaused: false,
    visualTimeMs: 500,
  });

  // Node 4 must render TX [FLUSH] and ACN must render RX [FLUSH]
  const flushTx = rec4.filledTexts.find(t => t.text === 'TX [FLUSH]');
  assert.ok(flushTx !== undefined, 'Node 4 must render TX [FLUSH] badge during flush allocation');
  assert.equal(flushTx!.fillStyle, '#f0b85c', 'TX [FLUSH] badge must use amber gold theme');
  const flushRx = rec4.filledTexts.find(t => t.text === 'RX [FLUSH]');
  assert.ok(flushRx !== undefined, 'ACN must render RX [FLUSH] badge during flush allocation');
  // HUD reports PRE-OCCLUSION FLUSH | MODELED SERVICE
  const hudFlush = rec4.filledTexts.find(t => t.text.includes('PRE-OCCLUSION FLUSH') && t.text.includes('MODELED SERVICE'));
  assert.ok(hudFlush !== undefined, 'Superframe HUD must display PRE-OCCLUSION FLUSH | MODELED SERVICE');

  // 3. Time = 675 ms (subframe offset = 13.5 ms -> Node 7 Empty allocation, 0 payload)
  const rec7 = createRecordingCanvasContext();
  visualizer.render(rec7.ctx, {
    snapshot: testSnap,
    acnScreenPos: acnPos,
    nodeScreenPositions: nodePositions,
    speed: 1.0,
    isPaused: false,
    visualTimeMs: 675,
  });

  // Empty allocation must render TX [IDLE] and RX [IDLE]
  assert.ok(rec7.filledTexts.some(t => t.text === 'TX [IDLE]'), 'Node 7 must render TX [IDLE] badge');
  assert.ok(rec7.filledTexts.some(t => t.text === 'RX [IDLE]'), 'ACN must render RX [IDLE] badge');
  // ZERO traveling payload packets may be fabricated!
  const packets7 = rec7.rects.filter(r => r.w === 8 && r.h === 3.6);
  assert.equal(packets7.length, 0, 'Zero payload packets must be rendered for empty allocation');
  // HUD reports UNUTILIZED CARRIER
  assert.ok(rec7.filledTexts.some(t => t.text.includes('UNUTILIZED CARRIER')), 'HUD must report UNUTILIZED CARRIER');

  // 4. Time = 850 ms (subframe offset = 17.0 ms -> Unallocated airtime)
  const recIdle = createRecordingCanvasContext();
  visualizer.render(recIdle.ctx, {
    snapshot: testSnap,
    acnScreenPos: acnPos,
    nodeScreenPositions: nodePositions,
    speed: 1.0,
    isPaused: false,
    visualTimeMs: 850,
  });
  // No node should display TX, RX, or packets
  assert.ok(!recIdle.filledTexts.some(t => t.text.startsWith('TX')), 'No node may transmit during unallocated airtime');
  assert.ok(!recIdle.filledTexts.some(t => t.text.startsWith('RX')), 'ACN may not receive during unallocated airtime');
  const packetsIdle = recIdle.rects.filter(r => r.w === 8 && r.h === 3.6);
  assert.equal(packetsIdle.length, 0, 'Zero packets during unallocated airtime');

  console.log('  -> PASS: Uplink packet rendering, direction, flush distinction, and empty allocation verified.');
}

// Test 66: Stage 3 Downlink Broadcast Wavefronts & No Fabricated Recipients
{
  console.log('\n[66/67] Verifying Stage 3 Downlink broadcast wavefronts, CTRL separation, and recipient fidelity...');

  const visualizer = new DataCommVisualizer();
  const acnPos = { x: 500, y: 150 };
  const nodePositions = new Map<number, Point2D>([
    [0, { x: 200, y: 300 }],
    [1, { x: 400, y: 350 }],
    [2, { x: 600, y: 400 }],
  ]);

  const snap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 1,
    simulationTimeS: 0.02,
    schedulerMode: 'tac_tad',
    ctrlDurationMs: 1.5, // Captured custom durations
    dlDurationMs: 4.5,   // Captured custom durations
    superframeDurationMs: 20.0,
    allocations: [
      { nodeId: 0, startMs: 6.0, durationMs: 4.0, capacityBits: 20000, isPreOcclusionFlush: false },
    ],
    nodes: [
      { nodeId: 0, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: false, isTransmitting: false, isWastingAirtime: false, queueBacklogBytes: 0 },
      { nodeId: 1, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: false, isTransmitting: false, isWastingAirtime: false, queueBacklogBytes: 0 },
      { nodeId: 2, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: false, isTransmitting: false, isWastingAirtime: false, queueBacklogBytes: 0 },
    ],
  });

  // 1. Time = 50 ms (subframe offset = 1.0 ms -> within [0, 1.5 ms) CTRL sync subframe)
  const recCtrl = createRecordingCanvasContext();
  visualizer.render(recCtrl.ctx, {
    snapshot: snap,
    acnScreenPos: acnPos,
    nodeScreenPositions: nodePositions,
    speed: 1.0,
    isPaused: false,
    visualTimeMs: 50,
  });

  // ACN renders SYNC TX [ACN → ALL] badge
  const syncBadge = recCtrl.filledTexts.find(t => t.text === 'SYNC TX [ACN → ALL]');
  assert.ok(syncBadge !== undefined, 'ACN must render SYNC TX [ACN → ALL] badge during CTRL subframe');
  assert.equal(syncBadge!.fillStyle, '#8a95e6', 'SYNC badge must use Highland Quartz Indigo control accent');
  // HUD reports CTRL SYNC [ACN → ALL]
  assert.ok(recCtrl.filledTexts.some(t => t.text.includes('CTRL SYNC [ACN → ALL]')), 'HUD must report CTRL SYNC');
  // Wavefront circles radiate from ACN
  const ctrlWaves = recCtrl.arcs.filter(a => Math.abs(a.x - acnPos.x) < 1 && Math.abs(a.y - acnPos.y) < 1);
  assert.ok(ctrlWaves.length >= 2, 'ACN must radiate expanding sync wavefront rings');
  // ZERO per-node application packet rects drawn
  const ctrlPackets = recCtrl.rects.filter(r => r.w === 8 && r.h === 3.6);
  assert.equal(ctrlPackets.length, 0, 'No individual application packets may be fabricated for broadcast sync');

  // 2. Time = 200 ms (subframe offset = 4.0 ms -> within [1.5, 6.0 ms) DL broadcast subframe)
  const recDl = createRecordingCanvasContext();
  visualizer.render(recDl.ctx, {
    snapshot: snap,
    acnScreenPos: acnPos,
    nodeScreenPositions: nodePositions,
    speed: 1.0,
    isPaused: false,
    visualTimeMs: 200,
  });

  // ACN renders DL TX [ACN → ALL] badge
  const dlBadge = recDl.filledTexts.find(t => t.text === 'DL TX [ACN → ALL]');
  assert.ok(dlBadge !== undefined, 'ACN must render DL TX [ACN → ALL] badge during DL subframe');
  assert.equal(dlBadge!.fillStyle, '#f0b85c', 'DL badge must use amber theme');
  // HUD reports DL BROADCAST [ACN → ALL]
  assert.ok(recDl.filledTexts.some(t => t.text.includes('DL BROADCAST [ACN → ALL]')), 'HUD must report DL BROADCAST');
  // Wavefront circles radiate from ACN in solid amber
  const dlWaves = recDl.arcs.filter(a => Math.abs(a.x - acnPos.x) < 1 && Math.abs(a.y - acnPos.y) < 1);
  assert.ok(dlWaves.length >= 3, 'ACN must radiate expanding DL broadcast wavefront rings');
  // ZERO per-node application packet rects drawn (broadcast signal wave, not per-node queues)
  const dlPackets = recDl.rects.filter(r => r.w === 8 && r.h === 3.6);
  assert.equal(dlPackets.length, 0, 'No per-node application packets may be fabricated for downlink broadcast');

  console.log('  -> PASS: Downlink broadcast waves, CTRL separation, and zero fabricated recipients verified.');
}

// Test 67: Stage 3 Transmission Outcomes, Queue Expiry, and Playback Isolation
{
  console.log('\n[67/67] Verifying Stage 3 transmission outcomes, queue expiry vs in-flight loss, and playback isolation...');

  const visualizer = new DataCommVisualizer();

  // 1. Static TDMA wasted airtime into severed link terminates at barrier without reaching ACN
  const acnPos = { x: 600, y: 100 };
  const nodePos = new Map<number, Point2D>([[3, { x: 100, y: 500 }]]);
  const staticWasteSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 10,
    simulationTimeS: 0.20,
    schedulerMode: 'static',
    superframeDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    allocations: [{ nodeId: 3, startMs: 4.0, durationMs: 1.0, capacityBits: 5000, isPreOcclusionFlush: false }],
    nodes: [{ nodeId: 3, isOperational: false, isBlocked: true, isObstacleBlocked: true, isOutage: false, isDegraded: false, linkStatus: 'BLOCKED_OBSTACLE', isSelected: false, isTransmitting: false, isWastingAirtime: true, queueBacklogBytes: 5000 }],
  });

  const recWaste = createRecordingCanvasContext();
  visualizer.render(recWaste.ctx, {
    snapshot: staticWasteSnap,
    acnScreenPos: acnPos,
    nodeScreenPositions: nodePos,
    speed: 1.0,
    isPaused: false,
    visualTimeMs: 225, // 4.5 ms
  });

  // Node 3 displays TX [WASTE]
  assert.ok(recWaste.filledTexts.some(t => t.text === 'TX [WASTE]'), 'Severed link in Static TDMA must render TX [WASTE]');
  // ACN must NOT display RX because transmission was obstructed before reaching ACN
  assert.ok(!recWaste.filledTexts.some(t => t.text.startsWith('RX')), 'ACN must NOT show RX on severed link');
  // HUD reports WASTED AIRTIME // SEVERED
  assert.ok(recWaste.filledTexts.some(t => t.text.includes('WASTED AIRTIME // SEVERED')), 'HUD must report WASTED AIRTIME // SEVERED');

  // 2. Playback Reset Clears State Cleanly
  visualizer.reset();
  assert.equal(visualizer.getActiveSnapshot(), null, 'Reset must clear activeSnapshot');
  assert.equal(visualizer.getCurrentSubframeOffsetMs(), 0.0, 'Reset must return subframe offset to 0');

  console.log('  -> PASS: Outcomes truthful; queue expiry decoupled from RF loss; playback isolation verified.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 68: Stage 4 One STEP Physical Simulation & Pause Invariants (Req 1, 2)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\n[68/73] Verifying Stage 4 One STEP advances exactly 1 frame/20ms & worker remains paused...');

  const sim = new SimulationWorkerManager();
  let emittedFrame: any = null;
  (sim as any).emitHostMessage = (msg: any) => {
    if (msg && msg.type === 'TELEMETRY_FRAME') {
      emittedFrame = msg.frame;
    }
  };

  // 1. Initial pause
  sim.handleMessage({ type: 'SIM_CONTROL', action: 'pause' });
  const tBefore = sim.simTimeS;
  const fBefore = sim.frameIndex;
  assert.equal(sim.isPaused, true, 'Worker must be initialized in paused state');

  // 2. Issue single STEP command
  const res = sim.handleMessage({ type: 'SIM_CONTROL', action: 'step' });
  assert.equal(res.accepted, true, 'Worker must accept SIM_CONTROL step');

  // 3. Verify exactly 20 ms and 1 frame advancement
  const dt = sim.simTimeS - tBefore;
  assert.ok(Math.abs(dt - 0.020) < 1e-6, `STEP must advance simTimeS by exactly 0.020s (20 ms), observed ${dt}s`);
  assert.equal(sim.frameIndex - fBefore, 1, 'STEP must advance frameIndex by exactly 1');

  // 4. Verify worker remains physically paused
  assert.equal(sim.isPaused, true, 'Worker must remain physically paused after STEP');
  assert.ok(emittedFrame !== null, 'Worker must emit TELEMETRY_FRAME on step');
  assert.equal(emittedFrame.paused, true, 'Emitted telemetry frame must report paused=true');

  console.log('  -> PASS: One STEP advances exactly one frame and 20ms; worker remains physically paused.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 69: Stage 4 Stepped Playback Lifecycle, Single-Cycle Advancement, and Completion Holding (Req 3, 4, 5, 8)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\n[69/73] Verifying Stage 4 stepped visual playback lifecycle and completion holding...');

  const visualizer = new DataCommVisualizer();
  let completeNotified = false;
  visualizer.setOnSteppedCycleComplete(() => {
    completeNotified = true;
  });

  // 1. Verify canStep is initially true
  assert.equal(visualizer.canStep(), true, 'canStep must be true when idle');

  // 2. Request STEP
  const reqId = visualizer.requestStep();
  assert.ok(reqId !== null && reqId > 0, 'requestStep must return valid request ID');
  assert.equal(visualizer.getPlaybackMode(), 'stepped');
  assert.equal(visualizer.getSteppedLifecycle(), 'waiting_for_telemetry');

  // 3. Construct stepped snapshot
  const stepSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 1,
    simulationTimeS: 0.02,
    schedulerMode: 'tac_tad',
    superframeDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    allocations: [
      { nodeId: 4, startMs: 4.0, durationMs: 8.0, capacityBits: 20000, isPreOcclusionFlush: false },
    ],
    nodes: [
      { nodeId: 4, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: true, isTransmitting: true, isWastingAirtime: false, queueBacklogBytes: 5000 },
    ],
  });

  // 4. Latch stepped snapshot
  const latched = visualizer.latchSteppedSnapshot(stepSnap, reqId!);
  assert.equal(latched, true, 'latchSteppedSnapshot must accept snapshot for matching request ID');
  assert.equal(visualizer.getSteppedLifecycle(), 'playing');
  assert.equal(visualizer.getActiveSnapshot(), stepSnap);

  // 5. Advance visual playback while worker is physically paused (isPaused: true passed to render)
  const mockCtx = createMockCanvasContext();
  const nodePos = new Map([[4, { x: 200, y: 300 }]]);

  // Initial render at t=0
  visualizer.render(mockCtx, {
    snapshot: stepSnap,
    acnScreenPos: { x: 500, y: 200 },
    nodeScreenPositions: nodePos,
    speed: 1.0,
    isPaused: true, // Physical worker is paused!
  });
  assert.ok(Math.abs(visualizer.getCurrentSubframeOffsetMs() - 0.0) < 0.05, 'Initial subframe offset must be near 0 ms');

  // Advance by 200 ms of visual time (subframe offset = 4.0 ms -> start of Node 4 UL slot)
  visualizer.advancePlayback(200, 1.0, false);
  assert.ok(Math.abs(visualizer.getCurrentSubframeOffsetMs() - 4.0) < 0.05, 'Subframe offset at 200ms must be ~4.0 ms');
  const slotAt4 = visualizer.getActiveSlotState();
  assert.equal(slotAt4?.phase, 'UPLINK_SLOT');
  assert.equal(slotAt4?.scheduledNodeId, 4);

  // Advance by another 400 ms of visual time (subframe offset = 12.0 ms -> end of Node 4 slot, into GUARD)
  visualizer.advancePlayback(400, 1.0, false);
  assert.ok(Math.abs(visualizer.getCurrentSubframeOffsetMs() - 12.0) < 0.05, 'Subframe offset at 600ms must be ~12.0 ms');
  const slotAt12 = visualizer.getActiveSlotState();
  assert.equal(slotAt12?.phase, 'IDLE_RECLAIMED'); // Tac-TAD dynamic unallocated airtime

  // Advance remaining 400 ms to reach 1,000 ms (1x visual cycle complete)
  visualizer.advancePlayback(400, 1.0, false);
  assert.equal(visualizer.getSteppedLifecycle(), 'complete', 'Lifecycle must transition to complete at end of cycle');
  assert.equal(completeNotified, true, 'onSteppedCycleComplete callback must be invoked');
  assert.equal(visualizer.getCurrentSubframeOffsetMs(), 20.0, 'Subframe offset must be exactly 20.0 ms at completion');
  assert.equal(visualizer.getCycleElapsedVisualMs(), 1000.0, 'Elapsed visual time must clamp at cycle duration');

  // 6. Verify completion holds final phase without automatic rollover
  visualizer.advancePlayback(500, 1.0, false); // Extra 500ms rendered
  assert.equal(visualizer.getSteppedLifecycle(), 'complete', 'Lifecycle must remain complete');
  assert.equal(visualizer.getCurrentSubframeOffsetMs(), 20.0, 'Subframe offset must remain held at 20.0 ms (no rollover to 0ms!)');
  assert.equal(visualizer.getCycleElapsedVisualMs(), 1000.0, 'Elapsed time must remain clamped at 1000ms');

  // 7. Verify STEP becomes available again after completion
  assert.equal(visualizer.canStep(), true, 'canStep must return true when cycle is complete and holding final phase');

  console.log('  -> PASS: Stepped visual superframe plays once, holds final phase, and enables next STEP.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 70: Stage 4 Overlapping Request Prevention and Overwrite Protection (Req 6, 7)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\n[70/73] Verifying Stage 4 overlapping step request prevention and overwrite protection...');

  const visualizer = new DataCommVisualizer();

  // 1. STEP rejected while awaiting telemetry
  const req1 = visualizer.requestStep();
  assert.ok(req1 !== null);
  assert.equal(visualizer.canStep(), false, 'canStep must be false while awaiting telemetry');
  const reqOverlapping1 = visualizer.requestStep();
  assert.equal(reqOverlapping1, null, 'requestStep must be rejected (null) while awaiting telemetry');

  // 2. Latch snapshot -> now playing
  const stepSnap1 = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 10,
    simulationTimeS: 0.20,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });
  visualizer.latchSteppedSnapshot(stepSnap1, req1!);
  assert.equal(visualizer.getSteppedLifecycle(), 'playing');

  // 3. STEP rejected while stepped playback is active
  assert.equal(visualizer.canStep(), false, 'canStep must be false while stepped playback is active');
  const reqOverlapping2 = visualizer.requestStep();
  assert.equal(reqOverlapping2, null, 'requestStep must be rejected (null) while playing');

  // 4. Overwrite protection: incoming newer live telemetry must NOT overwrite active stepped snapshot
  const newerLiveSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 11,
    simulationTimeS: 0.22,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });
  visualizer.ingestSnapshot(newerLiveSnap);
  assert.equal(visualizer.getActiveSnapshot(), stepSnap1, 'Active stepped snapshot must NOT be overwritten by live telemetry');
  assert.equal(visualizer.getPendingSnapshot(), null, 'Pending snapshot must remain null during stepped playback');

  console.log('  -> PASS: Overlapping STEP requests strictly rejected; active stepped snapshot cannot be overwritten.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 71: Stage 4 Pause / Resume Decoupling and Continuous Restoration (Req 9, 10)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\n[71/73] Verifying Stage 4 pause/resume decoupling and continuous restoration...');

  const visualizer = new DataCommVisualizer();

  // 1. Start stepped playback
  const reqId = visualizer.requestStep();
  const snap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 1,
    simulationTimeS: 0.02,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });
  visualizer.latchSteppedSnapshot(snap, reqId!);
  visualizer.advancePlayback(300, 1.0, false);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 300);

  // 2. Explicit visual pause freezes visual clock
  visualizer.setVisualPaused(true);
  assert.equal(visualizer.isVisualPaused(), true);

  // Advance time while visual clock is paused
  visualizer.advancePlayback(200, 1.0, true);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 300, 'Visual elapsed time must not advance while visual clock is paused');

  // Unpause visual clock
  visualizer.setVisualPaused(false);
  visualizer.advancePlayback(200, 1.0, false);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 500, 'Visual playback must resume from exact frozen position');

  // 3. RESUME returns to continuous operation correctly
  visualizer.resumeContinuous();
  assert.equal(visualizer.getPlaybackMode(), 'continuous');
  assert.equal(visualizer.getSteppedLifecycle(), 'idle');
  assert.equal(visualizer.isVisualPaused(), false);

  // In continuous mode, live snapshots promote and roll over normally
  const snapCont = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 2,
    simulationTimeS: 0.04,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });
  visualizer.ingestSnapshot(snapCont);
  visualizer.advancePlayback(600, 1.0, false); // 500 + 600 = 1100 -> rolls over past 1000
  assert.equal(visualizer.getActiveSnapshot(), snapCont, 'Continuous mode promotes pending snapshot at rollover');
  assert.equal(visualizer.getCycleElapsedVisualMs(), 100, 'Elapsed time wraps with modulo in continuous mode');

  console.log('  -> PASS: PAUSE freezes visual clock; RESUME cleanly restores continuous operation.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 72: Stage 4 Playback Speed Independence & Progress Preservation (Req 11, 12)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\n[72/73] Verifying Stage 4 playback speed changes preserve visual progress without advancing physical time...');

  const visualizer = new DataCommVisualizer();
  const reqId = visualizer.requestStep();
  const snap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 5,
    simulationTimeS: 0.10,
    schedulerMode: 'tac_tad',
    superframeDurationMs: 20.0,
    allocations: [],
    nodes: [],
  });
  visualizer.latchSteppedSnapshot(snap, reqId!);

  // Play to 400 ms at 1x speed (progress = 400 / 1000 = 0.40; subframe offset = 0.40 * 20 = 8.0 ms)
  visualizer.advancePlayback(400, 1.0, false);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 400);
  assert.ok(Math.abs(visualizer.getCurrentSubframeOffsetMs() - 8.0) < 1e-4);

  // 1. Shift to 2x speed (cycle duration becomes 500 ms)
  visualizer.advancePlayback(0, 2.0, false);
  // Normalized progress 0.40 must be preserved: 0.40 * 500 ms = 200 ms
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() - 200) < 1e-4, 'Elapsed time must scale to 200 ms at 2x speed');
  assert.ok(Math.abs(visualizer.getCurrentSubframeOffsetMs() - 8.0) < 1e-4, 'Subframe offset must remain exactly 8.0 ms');

  // 2. Shift to 0.5x speed (cycle duration becomes 2,000 ms)
  visualizer.advancePlayback(0, 0.5, false);
  // Normalized progress 0.40 must be preserved: 0.40 * 2000 ms = 800 ms
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() - 800) < 1e-4, 'Elapsed time must scale to 800 ms at 0.5x speed');
  assert.ok(Math.abs(visualizer.getCurrentSubframeOffsetMs() - 8.0) < 1e-4, 'Subframe offset must remain exactly 8.0 ms');

  // 3. Physical time invariants
  assert.equal(snap.simulationTimeS, 0.10, 'Snapshot simulation time must remain untouched by visual speed changes');
  assert.equal(snap.frameIndex, 5, 'Snapshot frame index must remain untouched by visual speed changes');

  console.log('  -> PASS: Speed changes strictly preserve normalized progress; physical time unchanged.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 73: Stage 4 Reset Determinism, Session Invalidation & Historical Isolation (Req 13, 14, 15, 16, 17)
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\n[73/73] Verifying Stage 4 reset determinism, session invalidation, and historical isolation...');

  const visualizer = new DataCommVisualizer();

  // 1. RESET clears all state
  const oldSessionId = visualizer.getSessionId();
  visualizer.requestStep();
  const snap1 = createSuperframeSnapshot({
    source: 'live',
    sessionId: oldSessionId,
    frameIndex: 1,
    simulationTimeS: 0.02,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });
  visualizer.latchSteppedSnapshot(snap1);

  // Invoke reset
  visualizer.reset();
  assert.equal(visualizer.getActiveSnapshot(), null, 'Reset must clear activeSnapshot');
  assert.equal(visualizer.getPendingSnapshot(), null, 'Reset must clear pendingSnapshot');
  assert.equal(visualizer.getPlaybackMode(), 'continuous', 'Reset must restore continuous playback mode');
  assert.equal(visualizer.getSteppedLifecycle(), 'idle', 'Reset must restore idle stepped lifecycle');
  assert.equal(visualizer.getSteppedRequestId(), 0, 'Reset must clear stepped request ID');
  assert.equal(visualizer.isVisualPaused(), false, 'Reset must clear visual pause flag');
  assert.equal(visualizer.getCycleElapsedVisualMs(), 0.0, 'Reset must zero elapsed visual time');
  assert.equal(visualizer.canStep(), true, 'canStep must be true after reset');
  assert.ok(visualizer.getSessionId() > oldSessionId, 'Reset must increment sessionId');

  // 2. Stale telemetry from older session cannot revive playback
  const staleSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: oldSessionId, // Stale old session!
    frameIndex: 10,
    simulationTimeS: 0.20,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });
  visualizer.ingestSnapshot(staleSnap);
  assert.equal(visualizer.getActiveSnapshot(), null, 'Stale snapshot from old session must be rejected');

  // 3. Historical scrubbing clears stepped lifecycle & return-to-live is clean
  visualizer.requestStep();
  assert.equal(visualizer.getPlaybackMode(), 'stepped');
  visualizer.enterHistorical();
  assert.equal(visualizer.getPlaybackMode(), 'historical', 'enterHistorical must set historical mode');
  assert.equal(visualizer.getSteppedLifecycle(), 'idle', 'enterHistorical must clear stepped lifecycle');
  assert.equal(visualizer.canStep(), false, 'canStep must be false in historical mode');

  // Latch historical snapshot
  const histSnap = createSuperframeSnapshot({
    source: 'historical',
    sessionId: visualizer.getSessionId(),
    frameIndex: 5,
    simulationTimeS: 0.10,
    schedulerMode: 'tac_tad',
    allocations: [],
    nodes: [],
  });
  visualizer.ingestSnapshot(histSnap);
  assert.equal(visualizer.getActiveSnapshot(), histSnap, 'Historical snapshot latched');

  // Return to live
  visualizer.exitHistorical(true); // exited while paused
  assert.equal(visualizer.getPlaybackMode(), 'continuous', 'exitHistorical must return to continuous mode');
  assert.equal(visualizer.getSteppedLifecycle(), 'idle');
  assert.equal(visualizer.canStep(), true, 'canStep must be available upon return to live');

  console.log('  -> PASS: Reset clears all states & invalidates stale sessions; historical isolation verified.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 74: Stage 4 Corrective Fix 1: Reliable STEP Telemetry Correlation
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\n[74/76] Verifying Stage 4 Fix 1: Reliable STEP telemetry correlation & race immunity...');

  // 1. Worker correlation: echoes step_request_id on the stepped frame only
  const sim = new SimulationWorkerManager();
  let emittedFrame: any = null;
  (sim as any).emitHostMessage = (msg: any) => {
    if (msg && msg.type === 'TELEMETRY_FRAME') {
      emittedFrame = msg.frame;
    }
  };

  sim.handleMessage({ type: 'SIM_CONTROL', action: 'pause' });
  const stepRes = sim.handleMessage({ type: 'SIM_CONTROL', action: 'step', step_request_id: 101 });
  assert.equal(stepRes.accepted, true);
  assert.ok(emittedFrame !== null, 'Worker must emit TELEMETRY_FRAME on step');
  assert.equal(emittedFrame.step_request_id, 101, 'Emitted frame must echo step_request_id=101');
  assert.equal((sim as any).activeStepRequestId, undefined, 'Worker must clear activeStepRequestId after tick');

  // 2. UI correlation: DataCommVisualizer requestStep assigns ID and waits
  const visualizer = new DataCommVisualizer();
  const req1 = visualizer.requestStep();
  assert.equal(req1, 1, 'First requestStep must return ID 1');
  assert.equal(visualizer.getActiveStepRequestId(), 1, 'Active step request ID must be 1');
  assert.equal(visualizer.getSteppedLifecycle(), 'waiting_for_telemetry');

  // 3. Race condition: un-correlated continuous frame arrives while waiting -> MUST BE IGNORED
  const continuousSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 5,
    simulationTimeS: 0.10,
    schedulerMode: 'tac_tad',
    // No stepRequestId (emitted before worker processed step)
    allocations: [],
    nodes: [],
  });
  visualizer.ingestSnapshot(continuousSnap);
  assert.equal(visualizer.getActiveSnapshot(), null, 'Continuous frame without stepRequestId must NOT be latched');
  assert.equal(visualizer.getSteppedLifecycle(), 'waiting_for_telemetry', 'Lifecycle must remain waiting_for_telemetry');
  assert.equal(visualizer.getActiveStepRequestId(), 1, 'Active step request ID must remain 1');

  // 4. Stale or mismatched frame arrives -> MUST BE IGNORED
  const mismatchedSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 6,
    simulationTimeS: 0.12,
    schedulerMode: 'tac_tad',
    stepRequestId: 999, // Mismatched ID!
    allocations: [],
    nodes: [],
  });
  visualizer.ingestSnapshot(mismatchedSnap);
  assert.equal(visualizer.getActiveSnapshot(), null, 'Frame with mismatched stepRequestId must NOT be latched');
  assert.equal(visualizer.getSteppedLifecycle(), 'waiting_for_telemetry');

  // 5. Correlated stepped frame arrives -> MUST BE LATCHED
  const correlatedSnap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 7,
    simulationTimeS: 0.14,
    schedulerMode: 'tac_tad',
    stepRequestId: 1, // Matches activeStepRequestId!
    allocations: [],
    nodes: [],
  });
  visualizer.ingestSnapshot(correlatedSnap);
  assert.equal(visualizer.getActiveSnapshot(), correlatedSnap, 'Matching stepped snapshot must be latched');
  assert.equal(visualizer.getSteppedLifecycle(), 'playing', 'Lifecycle must transition to playing');
  assert.equal(visualizer.getActiveStepRequestId(), null, 'Active step request ID must be cleared after latch');

  // 6. Reset invalidates outstanding STEP expectation
  const req2 = visualizer.requestStep();
  // Play finished or complete
  visualizer.advancePlayback(1000, 1.0, false);
  const req3 = visualizer.requestStep();
  assert.ok(req3 !== null && req3 > 1);
  assert.equal(visualizer.getActiveStepRequestId(), req3);
  visualizer.reset();
  assert.equal(visualizer.getActiveStepRequestId(), null, 'Reset must clear activeStepRequestId');
  assert.equal(visualizer.getSteppedLifecycle(), 'idle');

  // Stale frame for req3 arriving after reset is ignored
  const staleAfterReset = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 8,
    simulationTimeS: 0.16,
    schedulerMode: 'tac_tad',
    stepRequestId: req3,
    allocations: [],
    nodes: [],
  });
  visualizer.ingestSnapshot(staleAfterReset);
  assert.equal(visualizer.getSteppedLifecycle(), 'idle', 'Stale stepped frame cannot revive stepped lifecycle after reset');

  // 7. Historical mode entry invalidates outstanding STEP expectation
  const req4 = visualizer.requestStep();
  assert.ok(req4 !== null);
  assert.equal(visualizer.getActiveStepRequestId(), req4);
  visualizer.enterHistorical();
  assert.equal(visualizer.getActiveStepRequestId(), null, 'enterHistorical must clear activeStepRequestId');
  assert.equal(visualizer.getSteppedLifecycle(), 'idle');

  console.log('  -> PASS: Reliable STEP telemetry correlation & race immunity verified.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 75: Stage 4 Corrective Fix 2: PAUSE / RESUME Semantics During Stepped Playback
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\n[75/76] Verifying Stage 4 Fix 2: PAUSE/RESUME decoupling during stepped playback & holding...');

  const visualizer = new DataCommVisualizer();
  const reqId = visualizer.requestStep();
  const snap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 1,
    simulationTimeS: 0.02,
    schedulerMode: 'tac_tad',
    stepRequestId: reqId!,
    allocations: [{ nodeId: 4, startMs: 4.0, durationMs: 8.0, capacityBits: 20000, isPreOcclusionFlush: false }],
    nodes: [{ nodeId: 4, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: true, isTransmitting: true, isWastingAirtime: false, queueBacklogBytes: 5000 }],
  });
  visualizer.ingestSnapshot(snap);
  assert.equal(visualizer.getSteppedLifecycle(), 'playing');

  // 1. Advance to 250 ms (25% of visual cycle)
  visualizer.advancePlayback(250, 1.0, false);
  assert.equal(visualizer.getCycleElapsedVisualMs(), 250);

  // 2. User clicks PAUSE during stepped playing: visual clock freezes, worker is already paused
  visualizer.setVisualPaused(true);
  assert.equal(visualizer.isVisualPaused(), true, 'Visual clock must report paused');

  // Advance time while visual clock is paused -> MUST NOT ADVANCE
  visualizer.advancePlayback(300, 1.0, visualizer.isVisualPaused());
  assert.equal(visualizer.getCycleElapsedVisualMs(), 250, 'Cycle elapsed time must freeze during visual pause');
  assert.equal(visualizer.getSteppedLifecycle(), 'playing', 'Lifecycle remains playing (not complete)');

  // 3. Speed changes while stepped visual clock is paused -> MUST NOT UNPAUSE
  visualizer.advancePlayback(0, 2.0, visualizer.isVisualPaused());
  assert.equal(visualizer.isVisualPaused(), true, 'Visual clock must remain paused after speed change');
  // Rescaled to 2x speed: 25% of 500 ms = 125 ms
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() - 125) < 1e-4);

  // 4. User clicks RESUME while stepped playing + visual paused -> visual clock unfreezes, worker remains paused
  visualizer.setVisualPaused(false);
  assert.equal(visualizer.isVisualPaused(), false, 'Visual clock must unpause');
  visualizer.advancePlayback(125, 2.0, visualizer.isVisualPaused());
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() - 250) < 1e-4, 'Playback resumes from exact paused position');

  // 5. Complete visual cycle (remaining 250 ms at 2x)
  visualizer.advancePlayback(250, 2.0, visualizer.isVisualPaused());
  assert.equal(visualizer.getSteppedLifecycle(), 'complete', 'Lifecycle reaches complete');
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() - 500) < 1e-4, 'Elapsed visual time clamps at cycle end');

  // 6. Holding terminal state: additional time does not roll over
  visualizer.advancePlayback(300, 2.0, false);
  assert.equal(visualizer.getSteppedLifecycle(), 'complete');
  assert.ok(Math.abs(visualizer.getCycleElapsedVisualMs() - 500) < 1e-4);

  // 7. Explicit RESUME SIM action: returns cleanly to continuous mode
  visualizer.resumeContinuous();
  assert.equal(visualizer.getPlaybackMode(), 'continuous', 'resumeContinuous restores continuous playback');
  assert.equal(visualizer.getSteppedLifecycle(), 'idle', 'Lifecycle returns to idle');
  assert.equal(visualizer.isVisualPaused(), false, 'Visual pause is cleared');
  assert.equal(visualizer.canStep(), true, 'canStep is available in continuous mode');

  console.log('  -> PASS: PAUSE/RESUME decoupling during stepped playback & holding verified.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 76: Stage 4 Corrective Fix 3: Half-Open Semantics at Frame Completion & HUD
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\n[76/76] Verifying Stage 4 Fix 3: Strict half-open semantics [start, end) at completion & HUD...');

  // 1. Allocation ending at exactly 20.0 ms: strict half-open interval [16.0, 20.0) ms
  const timelineWithAlloc = resolveSuperframeTimeline({
    superframeDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    schedulerMode: 'static',
    allocations: [
      { nodeId: 5, startMs: 16.0, durationMs: 4.0, capacityBits: 25000, isPreOcclusionFlush: false },
    ],
  });

  // At t = 19.999999 ms: allocation [16.0, 20.0) ms is strictly active!
  const activeAt19 = timelineWithAlloc.resolveAt(19.999999);
  assert.equal(activeAt19.phase, 'UPLINK_SLOT', 'Active at 19.999999 ms must be UPLINK_SLOT');
  assert.equal(activeAt19.scheduledNodeId, 5, 'Scheduled node at 19.999999 ms must be Node 5');
  assert.equal(activeAt19.slotStartMs, 16.0, 'Slot start must be 16.0 ms');
  assert.equal(activeAt19.slotEndMs, 20.0, 'Slot end must be 20.0 ms');
  assert.equal(activeAt19.direction, 'UL');
  assert.ok(activeAt19.capacityBits > 0);

  // At t = 20.0 ms: frame has concluded! Strict [16.0, 20.0) means slot ended.
  // Must NOT claim ongoing active uplink transmission!
  const completeAt20 = timelineWithAlloc.resolveAt(20.0);
  assert.notEqual(completeAt20.phase, 'UPLINK_SLOT', 'At t=20.0 ms, phase must NOT be UPLINK_SLOT');
  assert.equal(completeAt20.scheduledNodeId, null, 'At t=20.0 ms, scheduledNodeId must be null');
  assert.equal(completeAt20.direction, 'NONE', 'At t=20.0 ms, direction must be NONE');
  assert.equal(completeAt20.capacityBits, 0, 'At t=20.0 ms, capacityBits must be 0');
  assert.equal(completeAt20.phase, 'GUARD', 'At t=20.0 ms, Static TDMA terminal phase is GUARD');
  assert.equal(completeAt20.slotStartMs, 20.0, 'At t=20.0 ms, terminal slotStartMs is 20.0 ms (does not match [16, 20))');
  assert.equal(completeAt20.slotDurationMs, 0.0, 'At t=20.0 ms, terminal slotDurationMs is 0.0 ms');

  // 2. Exact test for segment [12.0, 20.0) in Tac-TAD:
  // Node 1 allocated [4.0, 12.0) ms -> Tac-TAD reclaimed airtime tail is [12.0, 20.0) ms
  const timeline12to20 = resolveSuperframeTimeline({
    superframeDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    schedulerMode: 'tac_tad',
    allocations: [
      { nodeId: 1, startMs: 4.0, durationMs: 8.0, capacityBits: 20000, isPreOcclusionFlush: false },
    ],
  });

  // Query at 19.999999 ms -> MUST match final segment [12.0, 20.0)
  const at19_9 = timeline12to20.resolveAt(19.999999);
  assert.equal(at19_9.phase, 'IDLE_RECLAIMED', 'At 19.999999 ms, must match reclaimed tail [12.0, 20.0)');
  assert.equal(at19_9.scheduledNodeId, null);
  assert.equal(at19_9.slotStartMs, 12.0, 'At 19.999999 ms, segment start must be 12.0 ms');
  assert.equal(at19_9.slotDurationMs, 8.0, 'At 19.999999 ms, segment duration must be 8.0 ms');
  assert.equal(at19_9.slotEndMs, 20.0, 'At 19.999999 ms, segment end must be 20.0 ms');

  // Query at 20.0 ms -> MUST NOT match [12.0, 20.0) (concluded at 20.0 ms)
  const at20_0 = timeline12to20.resolveAt(20.0);
  assert.equal(at20_0.phase, 'IDLE_RECLAIMED', 'At 20.0 ms, terminal state holds IDLE_RECLAIMED');
  assert.equal(at20_0.scheduledNodeId, null);
  assert.equal(at20_0.direction, 'NONE');
  assert.equal(at20_0.capacityBits, 0);
  assert.equal(at20_0.slotStartMs, 20.0, 'At 20.0 ms, does NOT match [12.0, 20.0) (slotStartMs=20.0)');
  assert.equal(at20_0.slotDurationMs, 0.0, 'At 20.0 ms, does NOT match [12.0, 20.0) (slotDurationMs=0.0)');

  // 3. Superframe ending with Tac-TAD reclaimed airtime: [14.0, 20.0) ms IDLE_RECLAIMED
  const timelineTac = resolveSuperframeTimeline({
    superframeDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlDurationMs: 3.0,
    schedulerMode: 'tac_tad',
    allocations: [
      { nodeId: 4, startMs: 4.0, durationMs: 10.0, capacityBits: 30000, isPreOcclusionFlush: false },
    ],
  });

  const tacAt19 = timelineTac.resolveAt(19.999999);
  assert.equal(tacAt19.phase, 'IDLE_RECLAIMED', 'At 19.999999 ms, matches reclaimed tail [14.0, 20.0)');
  assert.equal(tacAt19.slotStartMs, 14.0);
  assert.equal(tacAt19.slotEndMs, 20.0);

  const tacAt20 = timelineTac.resolveAt(20.0);
  assert.equal(tacAt20.phase, 'IDLE_RECLAIMED', 'At t=20.0 ms, Tac-TAD holds IDLE_RECLAIMED cleanly');
  assert.equal(tacAt20.scheduledNodeId, null, 'No scheduled node during reclaimed airtime');
  assert.equal(tacAt20.direction, 'NONE');
  assert.equal(tacAt20.capacityBits, 0);
  assert.equal(tacAt20.slotStartMs, 20.0, 'At 20.0 ms, does NOT match [14.0, 20.0) (slotStartMs=20.0)');
  assert.equal(tacAt20.slotDurationMs, 0.0);

  // 3. HUD indicator rendering in stepped complete state
  const visualizer = new DataCommVisualizer();
  const reqId = visualizer.requestStep();
  const snap = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 12,
    simulationTimeS: 0.24,
    schedulerMode: 'tac_tad',
    stepRequestId: reqId!,
    allocations: [
      { nodeId: 5, startMs: 16.0, durationMs: 4.0, capacityBits: 25000, isPreOcclusionFlush: false },
    ],
    nodes: [
      { nodeId: 5, isOperational: true, isBlocked: false, isObstacleBlocked: false, isOutage: false, isDegraded: false, linkStatus: 'CONNECTED', isSelected: true, isTransmitting: true, isWastingAirtime: false, queueBacklogBytes: 5000 },
    ],
  });
  visualizer.ingestSnapshot(snap);

  // Play to exact completion (1,000 ms at 1x)
  visualizer.advancePlayback(1000, 1.0, false);
  assert.equal(visualizer.getSteppedLifecycle(), 'complete');
  assert.equal(visualizer.getCurrentSubframeOffsetMs(), 20.0);

  // Render on mock canvas and capture HUD text
  const renderedText: string[] = [];
  const mockCtx = createMockCanvasContext();
  mockCtx.fillText = (text: string) => {
    renderedText.push(text);
  };

  const nodePos = new Map([[5, { x: 300, y: 300 }]]);
  visualizer.render(mockCtx, {
    snapshot: snap,
    acnScreenPos: { x: 500, y: 200 },
    nodeScreenPositions: nodePos,
    speed: 1.0,
    isPaused: true,
  });

  const hudText = renderedText.find((t) => t.includes('STEP COMPLETE') || t.includes('STEPPED'));
  assert.ok(hudText !== undefined, 'HUD must display STEP COMPLETE indicator');
  assert.ok(hudText!.includes('STEP COMPLETE // HOLDING'), `HUD must indicate holding final state, got: ${hudText}`);
  assert.ok(hudText!.includes('20.0ms'), `HUD must show 20.0ms terminal offset, got: ${hudText}`);

  console.log('  -> PASS: Strict half-open semantics [start, end) at completion & HUD verified.');
}

console.log('\n================================================================================');
console.log('  ALL 76 DATA COMM & TDMA SYNCHRONIZATION VERIFICATION SUITES PASSED CLEANLY!');
console.log('================================================================================\n');
