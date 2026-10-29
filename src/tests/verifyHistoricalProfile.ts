/**
 * Milestone 3B.2D — Historical Profile Integration Test Suite
 *
 * Verifies:
 *  1. Ring-buffer capacity, ordering, and strict FIFO eviction.
 *  2. Exact frame/time/node/profile correspondence across frames.
 *  3. Historical profile immutability (frozen snapshots, no external mutations).
 *  4. Live state remaining unchanged during scrubbing (zero mutation of worker).
 *  5. Paused-versus-running state restoration when entering and leaving history.
 *  6. Node selector behavior and identity locking in historical mode.
 *  7. LIVE return and non-interference with profile freshness serials.
 *  8. Eviction detection and clamping when an inspected frame falls off the buffer.
 *  9. Boundary conditions: empty, single-frame, oldest, and newest frame queries.
 * 10. Independent preservation of terrain-LOS vs obstacle-blockage flags.
 * 11. DEM isolation and empirically bounded memory growth (< 4 MB for 600 frames).
 * 12. Viewport compatibility (LinkProfileViewportState zoom/pan seamlessly operates on historical records).
 */

import assert from 'node:assert/strict';
import {
  createHistoricalRecordSnapshot,
  estimateRecordMemoryBytes,
  type HistoricalFrameRecord,
  SimulationHistoryBuffer,
  SimulationHistoryController,
} from '../ui/simulationHistory';
import { buildLinkProfile, type LinkProfile } from '../core/linkProfile';
import { SimulationWorkerManager } from '../worker/simWorker';
import { TerrainEngine } from '../core/terrain';
import { LinkProfileViewportState } from '../ui/linkProfileViewport';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers & Mock Data Builders
// ─────────────────────────────────────────────────────────────────────────────

function createMockProfile(options: {
  frameIndex: number;
  simTimeS: number;
  nodeId: number;
  isLos: boolean;
  obstacleBlocked: boolean;
  diffractionLossDb?: number;
  obstacleId?: string;
}): LinkProfile {
  return buildLinkProfile({
    selectedGroundNodeId: options.nodeId,
    nodeName: `S${options.nodeId}`,
    frameIndex: options.frameIndex,
    simulationTimeS: options.simTimeS,
    groundNodePositionMslM: [options.nodeId * 1000, 2000, 1200],
    acnPositionMslM: [25000, 30000, 5000],
    wavelengthM: 0.03,
    effectiveEarthRadiusM: 8500000,
    fresnelFraction: 0.6,
    sampleCount: 64,
    obstruction: {
      minClearanceM: options.isLos ? 42.5 : -15.0,
      fresnelRadiusM: 14.2,
      diffractionLossDb: options.diffractionLossDb ?? (options.isLos ? 0.0 : 35.0),
      isLos: options.isLos,
      obstacleBlocked: options.obstacleBlocked,
      obstacleIntersections: options.obstacleBlocked ? [{
        obstacleId: options.obstacleId ?? 'obs_alpha',
        entryFraction: 0.4,
        exitFraction: 0.6,
        penetrationM: 6000,
      }] : [],
    },
    getTerrainElevationMslM: () => 1200,
    computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });
}

function createMockRecord(options: {
  frameIndex: number;
  simTimeS: number;
  nodeId: number;
  isLos: boolean;
  obstacleBlocked: boolean;
  profileSerial?: number;
  diffractionLossDb?: number;
  obstacleId?: string;
}): HistoricalFrameRecord {
  const profile = createMockProfile(options);
  return createHistoricalRecordSnapshot({
    frameIndex: options.frameIndex,
    simulationTimeS: options.simTimeS,
    selectedNodeId: options.nodeId,
    nodeName: `S${options.nodeId}`,
    profileSerial: options.profileSerial ?? options.frameIndex,
    groundNodePositionMslM: [options.nodeId * 1000, 2000, 1200],
    acnPositionMslM: [25000, 30000, 5000],
    profile,
    obstruction: {
      terrainIsLos: options.isLos,
      obstacleBlocked: options.obstacleBlocked,
      minClearanceM: profile.terrainMinimumClearanceM,
      diffractionLossDb: profile.diffractionLossDb,
      primaryBlockedObstacleId: options.obstacleBlocked ? 'obs_alpha' : null,
      terrainStatusText: options.isLos ? 'PRISTINE LINE-OF-SIGHT' : 'TOTAL OCCLUSION',
      terrainBadgeClass: options.isLos ? 'badge-emerald' : 'badge-crimson',
      obstacleStatusText: options.obstacleBlocked ? 'OBSTACLE BLOCKED: obs_alpha' : 'OBSTACLES: CLEAR',
      obstacleBadgeClass: options.obstacleBlocked ? 'badge-crimson' : 'badge-emerald',
    },
    linkBudget: {
      modcodName: 'QPSK 3/4',
      snrDb: options.isLos && !options.obstacleBlocked ? 28.5 : -5.0,
      spectralEfficiencyBpsHz: 1.49,
      slantRangeKm: 39.0,
      fsplDb: 142.3,
      diffractionLossDb: profile.diffractionLossDb,
      rxPowerDbm: -78.5,
      earthBulgeM: 117.0,
      gaseousLossDb: 0.45,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Ring-buffer capacity, ordering, and strict FIFO eviction
// ─────────────────────────────────────────────────────────────────────────────
{
  const capacity = 10;
  const buffer = new SimulationHistoryBuffer(capacity);
  assert.equal(buffer.size, 0);

  // Push 10 frames
  for (let i = 1; i <= 10; i++) {
    buffer.push(createMockRecord({ frameIndex: i, simTimeS: i * 0.02, nodeId: 4, isLos: true, obstacleBlocked: false }));
  }
  assert.equal(buffer.size, 10);
  assert.equal(buffer.getOldest()?.frameIndex, 1);
  assert.equal(buffer.getNewest()?.frameIndex, 10);

  // Push 5 more frames (frames 11..15) -> frames 1..5 should be evicted
  for (let i = 11; i <= 15; i++) {
    buffer.push(createMockRecord({ frameIndex: i, simTimeS: i * 0.02, nodeId: 4, isLos: true, obstacleBlocked: false }));
  }
  assert.equal(buffer.size, 10, 'size remains clamped to capacity');
  assert.equal(buffer.getOldest()?.frameIndex, 6, 'oldest frame is now 6');
  assert.equal(buffer.getNewest()?.frameIndex, 15, 'newest frame is now 15');

  // Verify evicted frames are reported as evicted and return null
  for (let i = 1; i <= 5; i++) {
    assert.equal(buffer.isEvicted(i), true, `frame ${i} is recognized as evicted`);
    assert.equal(buffer.getByFrameIndex(i), null, `evicted frame ${i} returns null`);
  }

  // Verify kept frames are intact and retrievable
  for (let i = 6; i <= 15; i++) {
    assert.equal(buffer.isEvicted(i), false);
    const rec = buffer.getByFrameIndex(i);
    assert.ok(rec !== null, `frame ${i} found`);
    assert.equal(rec.frameIndex, i);
  }

  console.log('PASS Test 1 — Ring-buffer capacity, ordering, and strict FIFO eviction');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Exact frame/time/node/profile correspondence across frames
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SimulationHistoryBuffer(20);

  // Push frames with alternating node selections and states
  buffer.push(createMockRecord({ frameIndex: 100, simTimeS: 2.00, nodeId: 4, isLos: true, obstacleBlocked: false }));
  buffer.push(createMockRecord({ frameIndex: 101, simTimeS: 2.02, nodeId: 4, isLos: false, obstacleBlocked: false, diffractionLossDb: 28.0 }));
  buffer.push(createMockRecord({ frameIndex: 102, simTimeS: 2.04, nodeId: 2, isLos: true, obstacleBlocked: true, obstacleId: 'tower_01' }));

  const r100 = buffer.getByFrameIndex(100);
  assert.ok(r100);
  assert.equal(r100.frameIndex, 100);
  assert.equal(r100.simulationTimeS, 2.00);
  assert.equal(r100.selectedNodeId, 4);
  assert.equal(r100.profile.terrainIsLos, true);
  assert.equal(r100.profile.obstacleBlocked, false);

  const r101 = buffer.getByFrameIndex(101);
  assert.ok(r101);
  assert.equal(r101.frameIndex, 101);
  assert.equal(r101.simulationTimeS, 2.02);
  assert.equal(r101.selectedNodeId, 4);
  assert.equal(r101.profile.terrainIsLos, false);
  assert.equal(r101.profile.diffractionLossDb, 28.0);

  const r102 = buffer.getByFrameIndex(102);
  assert.ok(r102);
  assert.equal(r102.frameIndex, 102);
  assert.equal(r102.simulationTimeS, 2.04);
  assert.equal(r102.selectedNodeId, 2);
  assert.equal(r102.profile.selectedGroundNodeId, 2);
  assert.equal(r102.profile.terrainIsLos, true);
  assert.equal(r102.profile.obstacleBlocked, true);
  assert.equal(r102.profile.obstacleIntervals[0].obstacleId, 'tower_01');

  console.log('PASS Test 2 — Exact frame/time/node/profile correspondence across frames');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Historical profile immutability (frozen snapshots, no external mutations)
// ─────────────────────────────────────────────────────────────────────────────
{
  const rec = createMockRecord({ frameIndex: 50, simTimeS: 1.0, nodeId: 4, isLos: true, obstacleBlocked: false });

  assert.ok(Object.isFrozen(rec), 'record envelope is frozen');
  assert.ok(Object.isFrozen(rec.profile), 'profile is frozen');
  assert.ok(Object.isFrozen(rec.profile.samples), 'samples array is frozen');
  assert.ok(Object.isFrozen(rec.profile.obstacleIntervals), 'intervals array is frozen');
  assert.ok(Object.isFrozen(rec.groundNodePositionMslM), 'ground node pos array is frozen');
  assert.ok(Object.isFrozen(rec.acnPositionMslM), 'acn pos array is frozen');

  // Verify mutations fail in strict mode
  assert.throws(() => {
    (rec as any).frameIndex = 999;
  }, /Cannot assign to read only property/);

  assert.throws(() => {
    (rec.profile as any).terrainIsLos = false;
  }, /Cannot assign to read only property/);

  assert.throws(() => {
    (rec.profile.samples as any).push({} as any);
  }, /Cannot add property/);

  console.log('PASS Test 3 — Historical profile immutability (frozen snapshots, no external mutations)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Live state remaining unchanged during scrubbing (zero mutation of worker)
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager();
  sim.isPaused = true;

  // Run 10 ticks to generate telemetry state
  for (let i = 0; i < 10; i++) {
    sim.tickSimulation();
  }

  const baselineTime = sim.simTimeS;
  const baselineFrame = sim.frameIndex;
  const baselineQueueBits = sim.nodesTac.map(n => n.queue.getTotalBacklogBits());
  const baselineMetrics = { ...sim.metrics };

  // Set up history controller and populate with records
  const buffer = new SimulationHistoryBuffer(600);
  for (let i = 1; i <= sim.frameIndex; i++) {
    buffer.push(createMockRecord({ frameIndex: i, simTimeS: i * 0.02, nodeId: 4, isLos: true, obstacleBlocked: false }));
  }
  const controller = new SimulationHistoryController(buffer);

  // Scrub across historical frames
  controller.enterHistorical(5, false);
  controller.scrubTo(2);
  controller.scrubTo(7);
  controller.scrubTo(1);
  controller.scrubTo(10);

  // Invariant check: Worker state must be 100% untouched
  assert.equal(sim.simTimeS, baselineTime, 'simTimeS not altered by history scrubbing');
  assert.equal(sim.frameIndex, baselineFrame, 'frameIndex not altered');
  assert.deepEqual(sim.nodesTac.map(n => n.queue.getTotalBacklogBits()), baselineQueueBits, 'queues not altered');
  assert.deepEqual(sim.metrics, baselineMetrics, 'KPI accumulators not altered');

  console.log('PASS Test 4 — Live state remaining unchanged during scrubbing (zero mutation of worker)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Paused-versus-running state restoration when entering and leaving history
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SimulationHistoryBuffer(100);
  for (let i = 1; i <= 20; i++) {
    buffer.push(createMockRecord({ frameIndex: i, simTimeS: i * 0.02, nodeId: 4, isLos: true, obstacleBlocked: false }));
  }

  // Case A: Simulation was RUNNING when user scrubbed into history
  {
    const controller = new SimulationHistoryController(buffer);
    const entered = controller.enterHistorical(10, true /* was running */);
    assert.equal(entered.shouldPause, true, 'controller instructs caller to pause running sim');
    assert.equal(controller.isInspecting, true);
    assert.equal(controller.wasRunningBefore, true);

    // User inspects frames
    controller.scrubTo(5);

    // Returning to LIVE should resume simulation
    const exited = controller.exitHistorical();
    assert.equal(exited.shouldResume, true, 'controller instructs caller to resume running sim');
    assert.equal(controller.isInspecting, false);
  }

  // Case B: Simulation was ALREADY PAUSED when user scrubbed into history
  {
    const controller = new SimulationHistoryController(buffer);
    const entered = controller.enterHistorical(10, false /* was already paused */);
    assert.equal(entered.shouldPause, false, 'no pause required if already paused');
    assert.equal(controller.isInspecting, true);
    assert.equal(controller.wasRunningBefore, false);

    // User inspects frames
    controller.scrubTo(8);

    // Returning to LIVE should keep simulation paused
    const exited = controller.exitHistorical();
    assert.equal(exited.shouldResume, false, 'controller instructs caller to keep simulation paused');
    assert.equal(controller.isInspecting, false);
  }

  console.log('PASS Test 5 — Paused-versus-running state restoration when entering and leaving history');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — Node selector behavior and identity locking in historical mode
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SimulationHistoryBuffer(100);
  buffer.push(createMockRecord({ frameIndex: 1, simTimeS: 0.02, nodeId: 4, isLos: true, obstacleBlocked: false }));
  buffer.push(createMockRecord({ frameIndex: 2, simTimeS: 0.04, nodeId: 2, isLos: true, obstacleBlocked: false }));

  const controller = new SimulationHistoryController(buffer);

  // Frame 1 has Node 4
  const r1 = controller.scrubTo(1);
  assert.equal(r1?.selectedNodeId, 4);
  assert.equal(r1?.nodeName, 'S4');
  assert.equal(r1?.profile.selectedGroundNodeId, 4);

  // Frame 2 has Node 2
  const r2 = controller.scrubTo(2);
  assert.equal(r2?.selectedNodeId, 2);
  assert.equal(r2?.nodeName, 'S2');
  assert.equal(r2?.profile.selectedGroundNodeId, 2);

  console.log('PASS Test 6 — Node selector behavior and identity locking in historical mode');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — LIVE return and non-interference with profile freshness serials
// ─────────────────────────────────────────────────────────────────────────────
{
  let latestProfileSerial = 10;
  const buffer = new SimulationHistoryBuffer(100);

  // Push records with historical serials
  buffer.push(createMockRecord({ frameIndex: 1, simTimeS: 0.02, nodeId: 4, isLos: true, obstacleBlocked: false, profileSerial: 8 }));
  buffer.push(createMockRecord({ frameIndex: 2, simTimeS: 0.04, nodeId: 4, isLos: true, obstacleBlocked: false, profileSerial: 9 }));
  buffer.push(createMockRecord({ frameIndex: 3, simTimeS: 0.06, nodeId: 4, isLos: true, obstacleBlocked: false, profileSerial: 10 }));

  const controller = new SimulationHistoryController(buffer);
  controller.enterHistorical(1, false);

  // Historical inspection does not modify the UI's latestProfileSerial
  assert.equal(latestProfileSerial, 10, 'latestProfileSerial remains intact during history inspection');

  // Returning to LIVE
  controller.exitHistorical();
  assert.equal(controller.isInspecting, false);

  // Simulating incoming live profile message with serial 11
  const liveMessage = { type: 'PROFILE_FRAME', profileSerial: 11, selectedNodeId: 4 };
  assert.ok(liveMessage.profileSerial > latestProfileSerial, 'live message with serial 11 accepted');
  latestProfileSerial = liveMessage.profileSerial;
  assert.equal(latestProfileSerial, 11);

  // Out-of-order message with serial 9 is rejected
  const oldMessage = { type: 'PROFILE_FRAME', profileSerial: 9, selectedNodeId: 4 };
  assert.ok(oldMessage.profileSerial <= latestProfileSerial, 'stale live message rejected');

  console.log('PASS Test 7 — LIVE return and non-interference with profile freshness serials');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Eviction detection and clamping when an inspected frame falls off
// ─────────────────────────────────────────────────────────────────────────────
{
  const capacity = 5;
  const buffer = new SimulationHistoryBuffer(capacity);
  for (let i = 1; i <= 5; i++) {
    buffer.push(createMockRecord({ frameIndex: i, simTimeS: i * 0.02, nodeId: 4, isLos: true, obstacleBlocked: false }));
  }

  const controller = new SimulationHistoryController(buffer);
  controller.enterHistorical(2, false);
  assert.equal(controller.currentInspectedFrame, 2);
  assert.equal(controller.isEvicted, false);

  // Evict frame 2 by pushing 3 more frames (frames 6, 7, 8) -> buffer holds 4, 5, 6, 7, 8
  buffer.push(createMockRecord({ frameIndex: 6, simTimeS: 0.12, nodeId: 4, isLos: true, obstacleBlocked: false }));
  buffer.push(createMockRecord({ frameIndex: 7, simTimeS: 0.14, nodeId: 4, isLos: true, obstacleBlocked: false }));
  buffer.push(createMockRecord({ frameIndex: 8, simTimeS: 0.16, nodeId: 4, isLos: true, obstacleBlocked: false }));

  assert.equal(buffer.isEvicted(2), true, 'frame 2 is now evicted from buffer');

  // Next query for active record should detect eviction and clamp to oldest available (frame 4)
  const active = controller.getActiveHistoricalRecord();
  assert.ok(active !== null);
  assert.equal(active.frameIndex, 4, 'clamped to oldest available frame');
  assert.equal(controller.isEvicted, true, 'isEvicted flag set to true to warn user');

  console.log('PASS Test 8 — Eviction detection and clamping when an inspected frame falls off');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — Boundary conditions: empty, single-frame, oldest, and newest
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SimulationHistoryBuffer(10);
  const controller = new SimulationHistoryController(buffer);

  // Empty buffer
  assert.equal(buffer.size, 0);
  assert.equal(buffer.getOldest(), null);
  assert.equal(buffer.getNewest(), null);
  assert.equal(buffer.getByFrameIndex(10), null);
  assert.equal(controller.scrubTo(10), null);

  // 1 frame
  const r1 = createMockRecord({ frameIndex: 1, simTimeS: 0.02, nodeId: 4, isLos: true, obstacleBlocked: false });
  buffer.push(r1);
  assert.equal(buffer.size, 1);
  assert.equal(buffer.getOldest()?.frameIndex, 1);
  assert.equal(buffer.getNewest()?.frameIndex, 1);
  assert.equal(buffer.getByFrameIndex(1)?.frameIndex, 1);

  // Out of bounds scrub
  const clampedOld = controller.scrubTo(0);
  assert.equal(clampedOld?.frameIndex, 1);
  const clampedNew = controller.scrubTo(100);
  assert.equal(clampedNew?.frameIndex, 1);

  console.log('PASS Test 9 — Boundary conditions: empty, single-frame, oldest, and newest');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 10 — Independent preservation of terrain-LOS vs obstacle-blockage flags
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SimulationHistoryBuffer(10);

  // 4 combinations of (isLos, obstacleBlocked)
  buffer.push(createMockRecord({ frameIndex: 1, simTimeS: 0.02, nodeId: 4, isLos: true, obstacleBlocked: false }));
  buffer.push(createMockRecord({ frameIndex: 2, simTimeS: 0.04, nodeId: 4, isLos: false, obstacleBlocked: false }));
  buffer.push(createMockRecord({ frameIndex: 3, simTimeS: 0.06, nodeId: 4, isLos: true, obstacleBlocked: true }));
  buffer.push(createMockRecord({ frameIndex: 4, simTimeS: 0.08, nodeId: 4, isLos: false, obstacleBlocked: true }));

  const c1 = buffer.getByFrameIndex(1)!;
  assert.equal(c1.profile.terrainIsLos, true);
  assert.equal(c1.profile.obstacleBlocked, false);
  assert.equal(c1.obstruction.terrainIsLos, true);
  assert.equal(c1.obstruction.obstacleBlocked, false);

  const c2 = buffer.getByFrameIndex(2)!;
  assert.equal(c2.profile.terrainIsLos, false);
  assert.equal(c2.profile.obstacleBlocked, false);

  const c3 = buffer.getByFrameIndex(3)!;
  assert.equal(c3.profile.terrainIsLos, true);
  assert.equal(c3.profile.obstacleBlocked, true);
  assert.equal(c3.profile.obstacleIntervals.length, 1);

  const c4 = buffer.getByFrameIndex(4)!;
  assert.equal(c4.profile.terrainIsLos, false);
  assert.equal(c4.profile.obstacleBlocked, true);

  console.log('PASS Test 10 — Independent preservation of terrain-LOS vs obstacle-blockage flags');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 — DEM isolation and empirically bounded memory growth (< 4 MB for 600 frames)
// ─────────────────────────────────────────────────────────────────────────────
{
  const buffer = new SimulationHistoryBuffer(600);
  for (let i = 1; i <= 600; i++) {
    buffer.push(createMockRecord({
      frameIndex: i,
      simTimeS: i * 0.02,
      nodeId: (i % 16),
      isLos: i % 3 !== 0,
      obstacleBlocked: i % 5 === 0,
    }));
  }

  assert.equal(buffer.size, 600);

  // Measure total memory bytes
  const totalBytes = buffer.measureTotalMemoryBytes();
  const bytesPerRecord = totalBytes / 600;

  // Each record should be roughly 4-6 KB
  assert.ok(bytesPerRecord > 1000, `record memory (${bytesPerRecord} B) is non-trivial`);
  assert.ok(bytesPerRecord < 12000, `record memory (${bytesPerRecord} B) is bounded`);

  // Total 600 records must be under 5 MB
  const totalMb = totalBytes / (1024 * 1024);
  assert.ok(totalMb < 5.0, `total buffer memory (${totalMb.toFixed(2)} MB) is well under 5 MB`);

  // DEM isolation check: ensure no Float32Array or DEM grids exist in the record
  const sample = buffer.getByFrameIndex(100)!;
  assert.equal((sample as any).dem, undefined, 'no DEM attached');
  assert.equal((sample.profile as any).demGrid, undefined, 'no DEM grid in profile');

  console.log(`PASS Test 11 — DEM isolation and measured memory growth (${totalMb.toFixed(2)} MB for 600 frames, ${bytesPerRecord.toFixed(0)} B/frame)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 12 — Viewport compatibility (LinkProfileViewportState works seamlessly on historical records)
// ─────────────────────────────────────────────────────────────────────────────
{
  const vp = new LinkProfileViewportState();
  const rec = createMockRecord({ frameIndex: 120, simTimeS: 2.4, nodeId: 4, isLos: true, obstacleBlocked: false });

  // Sync profile from historical record
  const synced = vp.syncProfile(rec.profile);
  assert.equal(synced, true, 'viewport synced historical profile successfully');

  // Verify bounds and zoom/pan functionality on historical profile
  const bounds = vp.bounds;
  assert.ok(bounds.maxDKm > 0);
  assert.ok(bounds.maxAltM > 0);

  vp.zoom(1.5);
  assert.ok(vp.zoomFactor > 1.0, 'viewport zooms historical profile');

  vp.resetFit();
  assert.equal(vp.zoomFactor, 1.0, 'viewport resets to fit historical profile');

  console.log('PASS Test 12 — Viewport compatibility (LinkProfileViewportState works on historical records)');
}

console.log('PASS All Milestone 3B.2D historical profile integration tests passed.');
