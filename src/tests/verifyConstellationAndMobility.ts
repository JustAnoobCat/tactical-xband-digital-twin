/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Verification Suite 106: Multi-ACN Constellation & Handover, Multi-Hop MANET Routing,
 * Ground Convoy Mobility & Wind-Coupled High-Altitude Aerodynamics (SPEC-V3-04)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateConstellationAcnPositions,
  evaluateA2aCrosslink,
  stepEventA3Handover,
  computeMultiHopManetRoute,
  stepGroundConvoyNode,
  evaluateHighAltAerodynamics,
  stepEnduranceState,
  computeCfitPullUpCommand,
  createDefaultGroundConvoyStates,
  stepConstellationWorkerSystem,
  type NodeHandoverState,
  type GroundConvoyState,
  type PeerLink,
} from '../core/constellationAndMobilityEngine';
import { SimulationWorkerManager } from '../worker/simWorker';

console.log('='.repeat(80));
console.log('[SUITE 106] Multi-ACN Constellation, MANET Routing & Aerodynamics (V3-04)');
console.log('='.repeat(80));

// ============================================================================
// Gate 1: [CM-T1] Event A3 Make-Before-Break Handover & A2A Backhaul
// ============================================================================
console.log('\n[1/5] Verifying [CM-T1] Event A3 Handover & A2A Backhaul Cross-Link...');

// 1a. 5-frame Time-to-Trigger (TTT) hold requirement
let hoState: NodeHandoverState = {
  servingAcnId: 'ACN-1',
  timeToTriggerCount: 0,
  candidateAcnId: null,
};

const snrMapCandidates = { 'ACN-1': 8.0, 'ACN-2': 12.0 }; // 4 dB advantage > 2 dB hysteresis

for (let frame = 1; frame <= 4; frame++) {
  const stepRes = stepEventA3Handover(hoState, snrMapCandidates, {}, { hysteresisDb: 2.0, timeToTriggerFrames: 5 });
  hoState = stepRes.state;
  assert.strictEqual(stepRes.handoverTriggered, false, `Handover should NOT trigger on frame ${frame} (TTT requirement)`);
  assert.strictEqual(stepRes.servingAcnId, 'ACN-1', `Serving ACN must remain ACN-1 on frame ${frame}`);
  assert.strictEqual(stepRes.candidateAcnId, 'ACN-2');
  assert.strictEqual(stepRes.timeToTriggerCount, frame);
}

// Frame 5: handover commits!
const frame5Res = stepEventA3Handover(hoState, snrMapCandidates, {}, { hysteresisDb: 2.0, timeToTriggerFrames: 5 });
assert.strictEqual(frame5Res.handoverTriggered, true, 'Handover must commit on frame 5');
assert.strictEqual(frame5Res.reason, 'EVENT_A3');
assert.strictEqual(frame5Res.servingAcnId, 'ACN-2');
assert.strictEqual(frame5Res.timeToTriggerCount, 0);
hoState = frame5Res.state;

// 1b. Zero ping-pong within hysteresis
// Now serving is ACN-2 (12 dB). ACN-1 rises to 13.0 dB (only 1 dB advantage < 2 dB hysteresis)
const pingPongMap = { 'ACN-1': 13.0, 'ACN-2': 12.0 };
for (let frame = 1; frame <= 10; frame++) {
  const ppRes = stepEventA3Handover(hoState, pingPongMap, {}, { hysteresisDb: 2.0, timeToTriggerFrames: 5 });
  hoState = ppRes.state;
  assert.strictEqual(ppRes.handoverTriggered, false, 'No handover should trigger within hysteresis margin');
  assert.strictEqual(ppRes.servingAcnId, 'ACN-2', 'Serving ACN must remain ACN-2 (hysteresis protected)');
}

// 1c. Immediate Outage Fallback Rescue (zero-frame commit when serving link fails)
const outageMap = { 'ACN-1': 8.0, 'ACN-2': -3.0 }; // Serving ACN-2 drops into deep outage (-3.0 dB < -1.5 dB)
const rescueRes = stepEventA3Handover(hoState, outageMap, {}, { hysteresisDb: 2.0, timeToTriggerFrames: 5, outageFallbackSnrDb: -1.5 });
assert.strictEqual(rescueRes.handoverTriggered, true, 'Immediate fallback rescue must trigger without TTT delay');
assert.strictEqual(rescueRes.reason, 'OUTAGE_FALLBACK');
assert.strictEqual(rescueRes.servingAcnId, 'ACN-1', 'Immediately rescued back to ACN-1');

// 1d. A2A Cross-link link budget & radio horizon
const acn1Pos: [number, number, number] = [0, 0, 5000.0];
const acn2Pos: [number, number, number] = [18000.0, 0, 5150.0]; // 18 km formation separation
const xLink = evaluateA2aCrosslink(acn1Pos, acn2Pos);

assert.strictEqual(xLink.isLineOfSightClear, true, 'A2A crosslink must be within radio horizon');
assert.ok(xLink.distanceM >= 18000.0 && xLink.distanceM <= 18005.0, `Slant range should be ~18000.6 m, got ${xLink.distanceM}`);
assert.ok(xLink.snrDb >= 20.0, `A2A cross-link SNR should be high (>20 dB), got ${xLink.snrDb}`);
assert.ok(xLink.capacityMbps >= 50.0, `A2A cross-link capacity should be >= 50 Mbps, got ${xLink.capacityMbps}`);

// Extreme distance exceeding smooth Earth horizon (~600 km)
const distantAcnPos: [number, number, number] = [700000.0, 0, 5000.0];
const blockedXLink = evaluateA2aCrosslink(acn1Pos, distantAcnPos);
assert.strictEqual(blockedXLink.isLineOfSightClear, false, 'Beyond radio horizon crosslink must be occluded');
assert.strictEqual(blockedXLink.capacityMbps, 0.0);

console.log('✓ [CM-T1] Event A3 make-before-break handover and A2A cross-link verified.');

// ============================================================================
// Gate 2: [CM-T2] Multi-Hop Dijkstra MANET Routing & Half-Duplex Penalty
// ============================================================================
console.log('\n[2/5] Verifying [CM-T2] Multi-Hop Dijkstra MANET Routing & Half-Duplex Penalty...');

// 2a. 2 equal hops of 10 Mbps -> exact 5.000 Mbps half-duplex throughput
const peerLinks2Hop: PeerLink[] = [
  { fromId: 4, toId: 3, capacityMbps: 10.0, distanceM: 3000.0 },
  { fromId: 3, toId: 1, capacityMbps: 10.0, distanceM: 4000.0 },
];

const manet2Hop = computeMultiHopManetRoute({
  sourceNodeId: 4,
  gatewayNodeIds: [1], // Node 1 is gateway
  peerLinks: peerLinks2Hop,
  maxHops: 3,
});

assert.strictEqual(manet2Hop.isRelayed, true);
assert.strictEqual(manet2Hop.hopCount, 2);
assert.deepStrictEqual(manet2Hop.route, [4, 3, 1]);
// 1 / (1/10 + 1/10) = 5.000 Mbps
assert.ok(
  Math.abs(manet2Hop.e2eCapacityMbps - 5.000) <= 0.001,
  `Expected exact 5.000 Mbps half-duplex throughput, got ${manet2Hop.e2eCapacityMbps}`
);
// Propagation latency: 7000 m / 3e8 m/s = 0.0233 ms + 1 * 2.5 ms = 2.523 ms
assert.ok(manet2Hop.e2eLatencyMs >= 2.5 && manet2Hop.e2eLatencyMs <= 2.6, `Latency should be ~2.52 ms, got ${manet2Hop.e2eLatencyMs}`);

// 2b. 3 equal hops of 12 Mbps -> exact 4.000 Mbps half-duplex throughput
const peerLinks3Hop: PeerLink[] = [
  { fromId: 5, toId: 4, capacityMbps: 12.0, distanceM: 2000.0 },
  { fromId: 4, toId: 3, capacityMbps: 12.0, distanceM: 2000.0 },
  { fromId: 3, toId: 1, capacityMbps: 12.0, distanceM: 2000.0 },
];

const manet3Hop = computeMultiHopManetRoute({
  sourceNodeId: 5,
  gatewayNodeIds: [1],
  peerLinks: peerLinks3Hop,
  maxHops: 3,
});

assert.strictEqual(manet3Hop.hopCount, 3);
assert.deepStrictEqual(manet3Hop.route, [5, 4, 3, 1]);
// 1 / (3 * (1/12)) = 4.000 Mbps
assert.ok(
  Math.abs(manet3Hop.e2eCapacityMbps - 4.000) <= 0.001,
  `Expected exact 4.000 Mbps half-duplex throughput, got ${manet3Hop.e2eCapacityMbps}`
);

// Direct gateway connection requires 0 relay hops
const directGateway = computeMultiHopManetRoute({
  sourceNodeId: 1,
  gatewayNodeIds: [1],
  peerLinks: peerLinks3Hop,
});
assert.strictEqual(directGateway.isRelayed, false);
assert.strictEqual(directGateway.hopCount, 0);

console.log('✓ [CM-T2] Multi-hop Dijkstra MANET routing and half-duplex capacity bottleneck verified.');

// ============================================================================
// Gate 3: [CM-T3] Continuous Ground Convoy / Patrol Mobility
// ============================================================================
console.log('\n[3/5] Verifying [CM-T3] Ground Convoy Mobility...');

const convoyCorridor: Array<[number, number]> = [
  [-5000, 3000],
  [-1000, 4500],
  [3000, 2000],
  [-1000, 1000],
];

let convoy: GroundConvoyState = {
  nodeId: 2,
  corridor: convoyCorridor,
  currentPos: [-5000, 3000],
  waypointIndex: 1,
  speedMs: 12.0, // 12 m/s mechanized convoy
  headingDeg: 0.0,
  vx: 0.0,
  vy: 0.0,
};

// Advance 50 ticks of 20 ms = 1.0 second -> exactly 12.0 meters
const dt = 0.02;
for (let t = 0; t < 50; t++) {
  convoy = stepGroundConvoyNode(convoy, dt);
}

const dx = convoy.currentPos[0] - (-5000);
const dy = convoy.currentPos[1] - 3000;
const distMoved = Math.sqrt(dx * dx + dy * dy);

assert.ok(
  Math.abs(distMoved - 12.0) <= 0.05,
  `Convoy should have moved 12.0 m in 1.0s, got ${distMoved}`
);
const speedMag = Math.sqrt(convoy.vx * convoy.vx + convoy.vy * convoy.vy);
assert.ok(
  Math.abs(speedMag - 12.0) <= 0.05,
  `Velocity vector magnitude should be 12.0 m/s, got ${speedMag}`
);

// Fast forward through all waypoints to verify seamless looping
for (let t = 0; t < 2000; t++) {
  convoy = stepGroundConvoyNode(convoy, 1.0); // 1.0 s steps
}
assert.ok(convoy.waypointIndex >= 0 && convoy.waypointIndex < convoyCorridor.length);

console.log('✓ [CM-T3] Ground convoy deterministic mobility and corridor wrap verified.');

// ============================================================================
// Gate 4: [CM-T4] ISA High-Altitude Aerodynamics & CFIT Safety Floor
// ============================================================================
console.log('\n[4/5] Verifying [CM-T4] ISA Aerodynamics, Crab Angle, Endurance & Auto-CFIT...');

// 4a. ISA air density ratio at 5,500 m
const aero5500 = evaluateHighAltAerodynamics({
  altitudeMslM: 5500.0,
  trueAirspeedMps: 60.0,
  trackHeadingDeg: 90.0, // Eastbound
  windSpeedMs: 20.0,     // 20 m/s crosswind
  windDirectionDeg: 0.0, // Wind from North -> crosswind from North
  seaLevelStallSpeedMps: 24.0,
});

// sigma(5500) = (1 - 2.25577e-5 * 5500)^4.25588 = 0.569 +- 0.005
assert.ok(
  Math.abs(aero5500.densityRatio - 0.569) <= 0.005,
  `ISA density ratio at 5,500 m should be 0.569 +- 0.005, got ${aero5500.densityRatio}`
);

// Stall speed ratio: V_stall,TAS / 24 = 1 / sqrt(0.569) = 1.326x
const stallRatio = aero5500.stallSpeedTasMps / 24.0;
assert.ok(
  Math.abs(stallRatio - 1.326) <= 0.01,
  `Stall speed TAS should scale by 1.326x at 5,500 m, got ${stallRatio.toFixed(3)}`
);

// Crab angle: asin(20 / 60) = asin(1/3) = 19.47 deg
assert.ok(
  Math.abs(Math.abs(aero5500.crabAngleDeg) - 19.47) <= 0.05,
  `Crab angle for 20 m/s crosswind at 60 m/s TAS should be 19.47 +- 0.05 deg, got ${aero5500.crabAngleDeg}`
);

// 4b. UAV Endurance & Bingo fuel alert
let enduranceMin = 48.0;
let endRes = stepEnduranceState(enduranceMin, 5500.0, 0.0, 120.0, 45.0); // 2 minutes burn
assert.ok(endRes.remainingMin < 48.0, 'Fuel must decrease monotonically');
assert.strictEqual(endRes.bingoAlert, false, 'Fuel > 45 min should not trigger bingo alert');

// Cross below 45 min bingo reserve
endRes = stepEnduranceState(45.1, 5500.0, 0.0, 30.0, 45.0);
assert.strictEqual(endRes.bingoAlert, true, 'Fuel <= 45 min must trigger bingo alert');

// 4c. Automatic CFIT Pull-Up Safety Floor (300 m AGL floor)
const terrainAheadViolated = 3450.0;
const currentAltBreached = 3600.0; // Clearance = 150 m < 300 m floor!

const cfitPullUp = computeCfitPullUpCommand({
  currentAltitudeMslM: currentAltBreached,
  vzMps: 0.0,
  maxTerrainAheadM: terrainAheadViolated,
  minAglFloorM: 300.0,
  maxClimbRateMps: 10.0,
});

assert.strictEqual(cfitPullUp.cfitPullUpActive, true, 'CFIT breach must activate pull-up command');
assert.strictEqual(cfitPullUp.commandedVzMps, 10.0, 'Pull-up must command maximum climb rate (10 m/s)');
assert.ok(
  cfitPullUp.commandedAltitudeMslM >= terrainAheadViolated + 300.0,
  'Commanded altitude must clear terrain + 300 m floor'
);

// Safe clearance (clear terrain by 1,000 m)
const cfitSafe = computeCfitPullUpCommand({
  currentAltitudeMslM: 5000.0,
  vzMps: 0.0,
  maxTerrainAheadM: 3500.0,
  minAglFloorM: 300.0,
});
assert.strictEqual(cfitSafe.cfitPullUpActive, false, 'Adequate terrain clearance must not trigger CFIT');

console.log('✓ [CM-T4] ISA aerodynamics, crab angle, bingo alert and CFIT pull-up floor verified.');

// ============================================================================
// Gate 5: [CM-T5] Live Worker Multi-ACN Run, Determinism, RESET_SIM & Micro-Benchmark
// ============================================================================
console.log('\n[5/5] Verifying [CM-T5] Live Worker Multi-ACN Integration, Determinism & Benchmark...');

// 5a. Live SimulationWorkerManager multi-ACN constellation run
let capturedFrames: any[] = [];
(globalThis as any).self = {
  postMessage: (msg: any) => {
    if (msg && msg.type === 'TELEMETRY_FRAME') {
      capturedFrames.push(msg);
    }
  },
};

const worker = new SimulationWorkerManager(106_001, '16_NODES');
worker.terrainEngine.setTerrainMode('synthetic');
worker.isPaused = true;
worker.acnConstellationCount = 3; // 3 ACNs
worker.enableMultiHopManet = true;
worker.enableGroundConvoyMobility = true;
worker.windSpeedMs = 20.0;
worker.windDirectionDeg = 0.0;
worker.enableAutoCfitPullUp = true;

// Step 50 ticks = 1.0s
for (let t = 0; t < 50; t++) {
  worker.tickSimulation(true);
}

assert.ok(capturedFrames.length > 0, 'Live worker must emit telemetry frames');
const latestMsg = capturedFrames[capturedFrames.length - 1];
const telem = latestMsg.frame.constellation_mobility_telemetry;
assert.ok(telem, 'Constellation mobility telemetry must be generated');
assert.strictEqual(telem.acn_count, 3, 'Must report 3 ACNs');
assert.strictEqual(telem.secondary_acns.length, 2, 'Must report 2 secondary ACNs (ACN-2, ACN-3)');
assert.strictEqual(telem.secondary_acns[0].id, 'ACN-2');
assert.strictEqual(telem.secondary_acns[1].id, 'ACN-3');
assert.ok(telem.secondary_acns[0].backhaul_capacity_mbps > 50.0, 'A2A backhaul capacity must be > 50 Mbps');
assert.ok(telem.aerodynamics.crosswind_mps !== 0.0, 'Aerodynamics must reflect 20 m/s wind');
assert.ok(Math.abs(telem.aerodynamics.crab_angle_deg) > 0.0, 'Crab angle must be non-zero');

// 5b. Bit-exact Determinism
capturedFrames = [];
const worker2 = new SimulationWorkerManager(106_001, '16_NODES');
worker2.terrainEngine.setTerrainMode('synthetic');
worker2.isPaused = true;
worker2.acnConstellationCount = 3;
worker2.enableMultiHopManet = true;
worker2.enableGroundConvoyMobility = true;
worker2.windSpeedMs = 20.0;
worker2.windDirectionDeg = 0.0;
worker2.enableAutoCfitPullUp = true;

for (let t = 0; t < 50; t++) {
  worker2.tickSimulation(true);
}

const telem2 = capturedFrames[capturedFrames.length - 1].frame.constellation_mobility_telemetry;
assert.strictEqual(telem.secondary_acns[0].pos_x, telem2.secondary_acns[0].pos_x, 'Multi-ACN run must be bit-exact deterministic');
assert.strictEqual(telem.aerodynamics.density_ratio, telem2.aerodynamics.density_ratio);

// 5c. Clean RESET_SIM Cleanup
worker.resetSimulationState();
assert.strictEqual(worker.acnConstellationCount, 1, 'RESET_SIM must reset ACN constellation to 1');
assert.strictEqual(worker.enableMultiHopManet, false, 'RESET_SIM must reset MANET to false');
assert.strictEqual(worker.enableGroundConvoyMobility, false, 'RESET_SIM must reset Convoy to false');
assert.strictEqual(worker.windSpeedMs, 0.0, 'RESET_SIM must reset wind to 0');
assert.strictEqual(worker.enableAutoCfitPullUp, false, 'RESET_SIM must reset CFIT to false');
assert.strictEqual(worker.uavEnduranceRemainingMin, 480.0, 'RESET_SIM must reset endurance to 480 min');

// 5d. UI Labels, Font >= 10px and Zero Emoji Gate in index.html
const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
const requiredIds = [
  'constellation-mobility-panel',
  'constellation-acn-count',
  'wind-speed-input',
  'toggle-manet-routing',
  'toggle-ground-convoy',
  'toggle-auto-cfit',
  'constellation-mobility-readout',
];

for (const id of requiredIds) {
  assert.ok(indexHtml.includes(`id="${id}"`), `index.html must include element with id="${id}"`);
}

// Zero emoji check in constellation-mobility-panel
const startPanel = indexHtml.indexOf('id="constellation-mobility-panel"');
assert.ok(startPanel !== -1, 'constellation-mobility-panel must exist');
const panelSlice = indexHtml.slice(startPanel, startPanel + 3500);
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
assert.strictEqual(emojiRegex.test(panelSlice), false, 'constellation-mobility-panel must contain zero emojis');

// 5e. Performance micro-benchmark (< 5 µs/call)
const startBench = performance.now();
const iters = 10000;
for (let i = 0; i < iters; i++) {
  generateConstellationAcnPositions([0, 0, 5000], 4, 18000, i * 0.02);
  evaluateA2aCrosslink([0, 0, 5000], [18000, 0, 5150]);
  stepEventA3Handover({ servingAcnId: 'ACN-1', timeToTriggerCount: 2, candidateAcnId: 'ACN-2' }, { 'ACN-1': 8.0, 'ACN-2': 12.0 });
  evaluateHighAltAerodynamics({ altitudeMslM: 5500, trueAirspeedMps: 60, trackHeadingDeg: 90, windSpeedMs: 20, windDirectionDeg: 0 });
  computeCfitPullUpCommand({ currentAltitudeMslM: 3600, vzMps: 0, maxTerrainAheadM: 3450 });
}
const elapsedMs = performance.now() - startBench;
const totalCalls = iters * 5;
const usPerCall = (elapsedMs / totalCalls) * 1000.0;
console.log(`    Micro-benchmark: ${iters.toLocaleString()} combined iterations (${totalCalls.toLocaleString()} calls) completed in ${elapsedMs.toFixed(2)} ms (${usPerCall.toFixed(3)} µs/call)`);
assert.ok(usPerCall < 5.0, `Engine calls must execute in < 5 µs/call, achieved ${usPerCall.toFixed(3)} µs/call`);

console.log('✓ [CM-T5] Live worker multi-ACN run, determinism, RESET_SIM, UI & benchmark verified.');

console.log('\n' + '='.repeat(80));
console.log('[SUITE 106 PASSED] All 5 Constellation, MANET & Aerodynamics tests verified successfully.');
console.log('='.repeat(80) + '\n');
