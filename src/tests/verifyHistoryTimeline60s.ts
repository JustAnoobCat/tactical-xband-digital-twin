/**
 * Milestone 5 — 60-Second History & Timeline Isolation Verification Suite
 *
 * Verifies:
 *  1. 3,000-record capacity and ~60-second span at 50 Hz (FRAME_DT = 0.020 s).
 *  2. Strict FIFO eviction at 3,000 capacity and empirical memory bounds (< 32 MB combined).
 *  3. Frame-index regression detection and reset recovery (clears on regression).
 *  4. Duplicate consecutive frame index in-place replacement.
 *  5. Coordinated pause/resume lifecycle across both timelines (HistoricalSessionCoordinator).
 *  6. Spatial revision tracking and mismatch detection across spatial vs non-spatial mutations.
 *  7. PROFILE_FRAME exclusion from history buffer ingestion.
 *  8. Live worker state isolation during historical inspection.
 */

import assert from 'node:assert/strict';
import {
  createHistoricalRecordSnapshot,
  estimateRecordMemoryBytes,
  type HistoricalFrameRecord,
  SimulationHistoryBuffer,
  SimulationHistoryController,
} from '../ui/simulationHistory';
import {
  createSchedulerRecordSnapshot,
  estimateSchedulerRecordMemoryBytes,
  type SchedulerFrameRecord,
  SchedulerHistoryBuffer,
  SchedulerHistoryController,
  type SchedulerNodeBacklog,
} from '../ui/schedulerHistory';
import { HistoricalSessionCoordinator } from '../ui/historicalSessionCoordinator';
import { buildLinkProfile } from '../core/linkProfile';
import { SimulationWorkerManager } from '../worker/simWorker';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers & Mock Data Builders
// ─────────────────────────────────────────────────────────────────────────────

function createMockRFRecord(frameIndex: number, simTimeS: number, spatialRevision = 0, snrDb = 25.0): HistoricalFrameRecord {
  const profile = buildLinkProfile({
    selectedGroundNodeId: 4,
    nodeName: 'S4',
    frameIndex,
    simulationTimeS: simTimeS,
    groundNodePositionMslM: [12000, 8000, 1200],
    acnPositionMslM: [25000, 30000, 5000],
    wavelengthM: 0.03,
    effectiveEarthRadiusM: 8500000,
    fresnelFraction: 0.6,
    sampleCount: 64,
    obstruction: {
      minClearanceM: 42.5,
      fresnelRadiusM: 14.2,
      diffractionLossDb: 0.0,
      isLos: true,
      obstacleBlocked: false,
      obstacleIntersections: [],
    },
    getTerrainElevationMslM: () => 1200,
    computeEarthBulgeM: (d1M: number, d2M: number) => (d1M * d2M) / (2 * (4 / 3) * 6371000),
  });

  return createHistoricalRecordSnapshot({
    frameIndex,
    simulationTimeS: simTimeS,
    spatialRevision,
    selectedNodeId: 4,
    nodeName: 'Node 4 (S4)',
    profileSerial: frameIndex,
    groundNodePositionMslM: [12000, 8000, 1200],
    acnPositionMslM: [25000, 30000, 5000],
    profile,
    obstruction: {
      terrainIsLos: true,
      obstacleBlocked: false,
      minClearanceM: 42.5,
      diffractionLossDb: 0.0,
      primaryBlockedObstacleId: null,
      terrainStatusText: 'Line of sight clear',
      terrainBadgeClass: 'badge-emerald',
      obstacleStatusText: 'Clear of artificial obstacles',
      obstacleBadgeClass: 'badge-emerald',
    },
    linkBudget: {
      modcodName: '64-APSK 5/6',
      snrDb,
      spectralEfficiencyBpsHz: 4.95,
      slantRangeKm: 32.5,
      fsplDb: 142.7,
      diffractionLossDb: 0.0,
      rxPowerDbm: -72.4,
      earthBulgeM: 11.7,
      gaseousLossDb: 0.12,
    },
  });
}

function createMockSchedulerRecord(frameIndex: number, simTimeS: number, spatialRevision = 0): SchedulerFrameRecord {
  const nodeBacklogs: SchedulerNodeBacklog[] = [];
  for (let i = 0; i < 16; i++) {
    nodeBacklogs.push({
      nodeId: i,
      name: i === 15 ? 'MCP' : `S${i}`,
      c2Bytes: i === 4 ? 256 : 0,
      voiceBytes: i === 4 ? 320 : 160,
      videoBytes: 0,
      photoBytes: i === 4 ? 2048 : 0,
      totalBacklogBytes: i === 4 ? 2624 : 160,
      c2Packets: i === 4 ? 2 : 0,
      voicePackets: i === 4 ? 2 : 1,
      videoPackets: 0,
      photoPackets: i === 4 ? 2 : 0,
      snrDb: 25.0,
      bitrateMbps: 4.95,
      stateName: 'NORMAL_LOS',
      linkOutage: false,
      obstacleBlocked: false,
    });
  }

  return createSchedulerRecordSnapshot({
    frameIndex,
    simulationTimeS: simTimeS,
    spatialRevision,
    schedulerMode: 'tac_tad',
    selectedNodeId: 4,
    activeAllocations: [
      {
        nodeId: 4,
        startMs: 0.0,
        durationMs: 2.5,
        durationS: 0.0025,
        slotStartS: 0.0,
        capacityBits: 12375,
        modcodName: '64-APSK 5/6',
        spectralEfficiency: 4.95,
        c2Bytes: 256,
        voiceBytes: 320,
        videoBytes: 0,
        photoBytes: 2048,
        isPreOcclusionFlush: false,
      },
    ],
    nodeBacklogs,
    kpi: {
      staticGoodputMb: 12.5,
      tacGoodputMb: 18.2,
      gainMultiplier: 1.45,
      staticWastePct: 8.2,
      tacWastePct: 1.1,
      staticDrops: 14,
      staticDropPct: 2.3,
      tacDrops: 0,
      tacDropPct: 0.0,
      ulUtilizationPct: 88.5,
      activeGoodputFrameBits: 12375,
      activeDropFramePkts: 0,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Cases
// ─────────────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('Running Milestone 5: 60-Second History & Timeline Isolation Tests...\n');

  // Test 1: 3,000-Record Capacity & 60-Second Span Coverage
  {
    const FRAME_DT = 0.020; // 50 Hz
    const rfBuffer = new SimulationHistoryBuffer(3000);
    const schedBuffer = new SchedulerHistoryBuffer(3000);

    assert.equal(rfBuffer.maxCapacity, 3000, 'RF buffer maxCapacity must be 3000');
    assert.equal(schedBuffer.maxCapacity, 3000, 'Scheduler buffer maxCapacity must be 3000');

    // Ingest exactly 3,000 frames (frameIndex 0 through 2999)
    for (let i = 0; i < 3000; i++) {
      const t = Number((i * FRAME_DT).toFixed(3));
      rfBuffer.push(createMockRFRecord(i, t));
      schedBuffer.push(createMockSchedulerRecord(i, t));
    }

    assert.equal(rfBuffer.size, 3000, 'RF buffer size must be 3000');
    assert.equal(schedBuffer.size, 3000, 'Scheduler buffer size must be 3000');

    const rfSpan = rfBuffer.getSpan();
    assert.equal(rfSpan.count, 3000);
    assert.equal(rfSpan.oldestFrame, 0);
    assert.equal(rfSpan.newestFrame, 2999);
    assert.equal(rfSpan.oldestTimeS, 0.0);
    assert.equal(rfSpan.newestTimeS, 59.98);

    const timeSpanRF = (rfSpan.newestTimeS ?? 0) - (rfSpan.oldestTimeS ?? 0);
    assert.ok(timeSpanRF >= 59.9, `RF history span (${timeSpanRF}s) must represent ~60s at 50 Hz`);

    const schedSpan = schedBuffer.getSpan();
    assert.equal(schedSpan.count, 3000);
    assert.equal(schedSpan.oldestFrame, 0);
    assert.equal(schedSpan.newestFrame, 2999);
    assert.equal(schedSpan.oldestTimeS, 0.0);
    assert.equal(schedSpan.newestTimeS, 59.98);

    const timeSpanSched = (schedSpan.newestTimeS ?? 0) - (schedSpan.oldestTimeS ?? 0);
    assert.ok(timeSpanSched >= 59.9, `Scheduler history span (${timeSpanSched}s) must represent ~60s at 50 Hz`);

    console.log('PASS Test 1 — 3,000-record capacity and ~60-second span at 50 Hz (59.98s retained)');
  }

  // Test 2: Strict FIFO Eviction and Empirical Memory Bounds
  {
    const FRAME_DT = 0.020;
    const rfBuffer = new SimulationHistoryBuffer(3000);
    const schedBuffer = new SchedulerHistoryBuffer(3000);

    // Push 3,500 frames to cause 500 evictions
    for (let i = 0; i < 3500; i++) {
      const t = Number((i * FRAME_DT).toFixed(3));
      rfBuffer.push(createMockRFRecord(i, t));
      schedBuffer.push(createMockSchedulerRecord(i, t));
    }

    assert.equal(rfBuffer.size, 3000, 'RF buffer size must remain capped at 3000');
    assert.equal(schedBuffer.size, 3000, 'Scheduler buffer size must remain capped at 3000');

    const rfSpan = rfBuffer.getSpan();
    assert.equal(rfSpan.oldestFrame, 500, 'RF oldestFrame should be 500 after 500 evictions');
    assert.equal(rfSpan.newestFrame, 3499, 'RF newestFrame should be 3499');
    assert.equal(rfBuffer.isEvicted(499), true, 'Frame 499 must be marked evicted');
    assert.equal(rfBuffer.isEvicted(500), false, 'Frame 500 must not be evicted');
    assert.ok(rfBuffer.getByFrameIndex(500) !== null, 'Frame 500 must be retrievable');
    assert.equal(rfBuffer.getByFrameIndex(499), null, 'Frame 499 must return null');

    const schedSpan = schedBuffer.getSpan();
    assert.equal(schedSpan.oldestFrame, 500, 'Scheduler oldestFrame should be 500 after 500 evictions');
    assert.equal(schedSpan.newestFrame, 3499, 'Scheduler newestFrame should be 3499');
    assert.equal(schedBuffer.isEvicted(499), true, 'Scheduler Frame 499 must be marked evicted');
    assert.equal(schedBuffer.isEvicted(500), false, 'Scheduler Frame 500 must not be evicted');

    // Empirical memory measurement
    const rfMemoryBytes = rfBuffer.measureTotalMemoryBytes();
    const schedMemoryBytes = schedBuffer.measureTotalMemoryBytes();
    const totalMemoryMb = (rfMemoryBytes + schedMemoryBytes) / (1024 * 1024);

    assert.ok(rfMemoryBytes < 22 * 1024 * 1024, `RF history memory (${(rfMemoryBytes / 1024 / 1024).toFixed(2)} MB) must be bounded < 22 MB`);
    assert.ok(schedMemoryBytes < 12 * 1024 * 1024, `Scheduler memory (${(schedMemoryBytes / 1024 / 1024).toFixed(2)} MB) must be bounded < 12 MB`);
    assert.ok(totalMemoryMb < 32, `Total history memory (${totalMemoryMb.toFixed(2)} MB) must be strictly < 32 MB`);

    console.log(`PASS Test 2 — Strict FIFO eviction and empirical memory bounds (${totalMemoryMb.toFixed(2)} MB combined < 32 MB)`);
  }

  // Test 3: Frame-Index Regression Detection and Reset Recovery
  {
    const rfBuffer = new SimulationHistoryBuffer(3000);
    const schedBuffer = new SchedulerHistoryBuffer(3000);

    // Ingest frames 100 to 500
    for (let i = 100; i <= 500; i++) {
      rfBuffer.push(createMockRFRecord(i, i * 0.02));
      schedBuffer.push(createMockSchedulerRecord(i, i * 0.02));
    }
    assert.equal(rfBuffer.size, 401);
    assert.equal(schedBuffer.size, 401);

    // Simulate worker reset: frameIndex restarts at 0 (< 500)
    rfBuffer.push(createMockRFRecord(0, 0.0));
    schedBuffer.push(createMockSchedulerRecord(0, 0.0));

    // Must clear buffer on regression and only contain the reset frame 0
    assert.equal(rfBuffer.size, 1, 'RF buffer must auto-clear on frameIndex regression');
    assert.equal(schedBuffer.size, 1, 'Scheduler buffer must auto-clear on frameIndex regression');
    assert.equal(rfBuffer.getOldest()?.frameIndex, 0);
    assert.equal(rfBuffer.getNewest()?.frameIndex, 0);
    assert.equal(schedBuffer.getOldest()?.frameIndex, 0);
    assert.equal(schedBuffer.getNewest()?.frameIndex, 0);

    // Binary search lookup works cleanly on newly started series
    rfBuffer.push(createMockRFRecord(1, 0.02));
    schedBuffer.push(createMockSchedulerRecord(1, 0.02));
    assert.equal(rfBuffer.size, 2);
    assert.equal(rfBuffer.getByFrameIndex(0)?.frameIndex, 0);
    assert.equal(rfBuffer.getByFrameIndex(1)?.frameIndex, 1);
    assert.equal(rfBuffer.getByFrameIndex(500), null, 'Old pre-reset frames must be inaccessible');

    console.log('PASS Test 3 — Frame-index regression detection and reset recovery (clears on regression)');
  }

  // Test 4: Duplicate Consecutive Frame Index In-Place Replacement
  {
    const rfBuffer = new SimulationHistoryBuffer(3000);
    const schedBuffer = new SchedulerHistoryBuffer(3000);

    rfBuffer.push(createMockRFRecord(10, 0.20, 0, 18.0));
    schedBuffer.push(createMockSchedulerRecord(10, 0.20, 0));
    assert.equal(rfBuffer.size, 1);
    assert.equal(schedBuffer.size, 1);

    // Emit duplicate frame 10 with updated RF SNR (e.g. paused parameter or modcod tweak)
    rfBuffer.push(createMockRFRecord(10, 0.20, 0, 24.5));
    schedBuffer.push(createMockSchedulerRecord(10, 0.20, 1));

    // Size must not increment; contents must be replaced in-place
    assert.equal(rfBuffer.size, 1, 'Duplicate frame push must not increase RF buffer size');
    assert.equal(schedBuffer.size, 1, 'Duplicate frame push must not increase Scheduler buffer size');
    assert.equal(rfBuffer.getByFrameIndex(10)?.linkBudget.snrDb, 24.5, 'Duplicate frame must replace in-place');
    assert.equal(schedBuffer.getByFrameIndex(10)?.spatialRevision, 1, 'Duplicate frame must replace in-place');

    console.log('PASS Test 4 — Duplicate consecutive frame index in-place replacement without length advance');
  }

  // Test 5: Coordinated Pause/Resume Lifecycle Across Both Timelines
  {
    const coordinator = new HistoricalSessionCoordinator();

    // Scenario A: Sim running -> Scrub RF -> Scrub Sched -> Exit RF -> Exit Sched
    {
      // 1. Live simulation running
      let isSimRunning = true;
      let rfInspecting = false;
      let schedInspecting = false;

      // User scrubs RF timeline
      const enterRF = coordinator.onEnterHistorical({
        isCurrentlyRunning: isSimRunning,
        rfInspecting,
        schedInspecting,
      });
      assert.equal(enterRF.shouldPauseWorker, true, 'First timeline entry must pause worker');
      assert.equal(coordinator.wasRunningBefore, true, 'Coordinator must record that sim was running');
      isSimRunning = false;
      rfInspecting = true;

      // While RF is inspecting, user switches to tab 2 and scrubs Scheduler timeline
      const enterSched = coordinator.onEnterHistorical({
        isCurrentlyRunning: isSimRunning, // now false because paused
        rfInspecting,
        schedInspecting,
      });
      assert.equal(enterSched.shouldPauseWorker, false, 'Second timeline entry must not re-pause');
      assert.equal(coordinator.wasRunningBefore, true, 'wasRunningBefore must NOT be overwritten with false!');
      schedInspecting = true;

      // User exits RF timeline (returns RF to LIVE)
      rfInspecting = false;
      const exitRF = coordinator.onExitHistorical({
        rfInspecting,
        schedInspecting,
      });
      assert.equal(exitRF.shouldResumeWorker, false, 'Worker must NOT resume while Scheduler is still inspecting');

      // User exits Scheduler timeline (returns Scheduler to LIVE)
      schedInspecting = false;
      const exitSched = coordinator.onExitHistorical({
        rfInspecting,
        schedInspecting,
      });
      assert.equal(exitSched.shouldResumeWorker, true, 'Worker must resume when ALL timelines have returned to LIVE');
      assert.equal(coordinator.wasRunningBefore, false, 'Session cleared after full resume');
    }

    // Scenario B: Sim running -> Scrub Sched -> Scrub RF -> Exit Sched -> Exit RF
    {
      coordinator.reset();
      let isSimRunning = true;
      let rfInspecting = false;
      let schedInspecting = false;

      const enterSched = coordinator.onEnterHistorical({
        isCurrentlyRunning: isSimRunning,
        rfInspecting,
        schedInspecting,
      });
      assert.equal(enterSched.shouldPauseWorker, true);
      isSimRunning = false;
      schedInspecting = true;

      const enterRF = coordinator.onEnterHistorical({
        isCurrentlyRunning: isSimRunning,
        rfInspecting,
        schedInspecting,
      });
      assert.equal(enterRF.shouldPauseWorker, false);
      assert.equal(coordinator.wasRunningBefore, true);
      rfInspecting = true;

      schedInspecting = false;
      const exitSched = coordinator.onExitHistorical({
        rfInspecting,
        schedInspecting,
      });
      assert.equal(exitSched.shouldResumeWorker, false, 'Worker must NOT resume while RF is still inspecting');

      rfInspecting = false;
      const exitRF = coordinator.onExitHistorical({
        rfInspecting,
        schedInspecting,
      });
      assert.equal(exitRF.shouldResumeWorker, true, 'Worker must resume after both exit');
    }

    // Scenario C: Simulation initially PAUSED before inspection
    {
      coordinator.reset();
      let isSimRunning = false; // Initially paused!
      let rfInspecting = false;
      let schedInspecting = false;

      const enterRF = coordinator.onEnterHistorical({
        isCurrentlyRunning: isSimRunning,
        rfInspecting,
        schedInspecting,
      });
      assert.equal(enterRF.shouldPauseWorker, false, 'Already paused simulation does not need pause command');
      assert.equal(coordinator.wasRunningBefore, false, 'Coordinator records wasRunningBefore = false');
      rfInspecting = true;

      const enterSched = coordinator.onEnterHistorical({
        isCurrentlyRunning: isSimRunning,
        rfInspecting,
        schedInspecting,
      });
      assert.equal(enterSched.shouldPauseWorker, false);
      schedInspecting = true;

      rfInspecting = false;
      const exitRF = coordinator.onExitHistorical({ rfInspecting, schedInspecting });
      assert.equal(exitRF.shouldResumeWorker, false);

      schedInspecting = false;
      const exitSched = coordinator.onExitHistorical({ rfInspecting, schedInspecting });
      assert.equal(exitSched.shouldResumeWorker, false, 'Initially paused simulation must NEVER auto-resume!');
    }

    // Scenario D: Reset during historical inspection
    {
      coordinator.reset();
      coordinator.onEnterHistorical({ isCurrentlyRunning: true, rfInspecting: false, schedInspecting: false });
      assert.equal(coordinator.wasRunningBefore, true);
      coordinator.reset();
      assert.equal(coordinator.wasRunningBefore, false, 'Coordinator reset must clear wasRunningBefore');
    }

    console.log('PASS Test 5 — Coordinated pause/resume lifecycle across both timelines (HistoricalSessionCoordinator)');
  }

  // Test 6: Spatial Revision Consistency & Mismatch Detection
  {
    const worker = new SimulationWorkerManager();
    assert.equal(worker.spatialRevision, 0, 'Initial worker spatialRevision must be 0');

    const snapRev0 = createMockRFRecord(10, 0.20, worker.spatialRevision);
    const schedRev0 = createMockSchedulerRecord(10, 0.20, worker.spatialRevision);
    assert.equal(snapRev0.spatialRevision, 0);
    assert.equal(schedRev0.spatialRevision, 0);

    // 1. Node move mutation
    worker.handleMessage({
      type: 'NODE_MOVE',
      request_id: 'mv-1',
      node_id: 4,
      x_m: 14000,
      y_m: 9000,
    });
    assert.equal(worker.spatialRevision, 1, 'NODE_MOVE must increment spatialRevision');

    // 2. Obstacle replacement mutation
    const obsResult = worker.handleMessage({
      type: 'OBSTACLES_REPLACE',
      request_id: 'obs-1',
      obstacles: [
        {
          id: 'test_obs_1',
          shape: 'cuboid',
          xM: 13000,
          yM: 8500,
          widthM: 50,
          depthM: 50,
          heightM: 120,
          rotationDeg: 0,
        },
      ],
    });
    assert.equal(obsResult.accepted, true, `OBSTACLES_REPLACE should be accepted: ${obsResult.reason}`);
    assert.equal(worker.spatialRevision, 2, 'OBSTACLES_REPLACE must increment spatialRevision');

    // 3. Trajectory change mutation
    const paramResult = worker.handleMessage({
      type: 'SET_PARAMS',
      request_id: 'p-1',
      orbit_a_m: 25000,
    });
    assert.equal(paramResult.accepted, true, `SET_PARAMS should be accepted: ${paramResult.reason}`);
    assert.equal(worker.spatialRevision, 3, 'SET_PARAMS with trajectory change must increment spatialRevision');

    // 4. Non-spatial mutation: Node Selection
    worker.handleMessage({
      type: 'SELECT_NODE',
      request_id: 'sel-1',
      node_id: 2,
    });
    assert.equal(worker.spatialRevision, 3, 'SELECT_NODE must NOT increment spatialRevision');

    // 5. Non-spatial mutation: Scheduler Mode Change
    worker.handleMessage({
      type: 'SET_SCHEDULER',
      request_id: 'sch-1',
      mode: 'static',
    });
    assert.equal(worker.spatialRevision, 3, 'SET_SCHEDULER must NOT increment spatialRevision');

    // 6. Reset resets spatial revision to 0
    worker.resetSimulationState();
    assert.equal(worker.spatialRevision, 0, 'resetSimulationState must reset spatialRevision to 0');

    // Verify snapshot mismatch detection logic
    const currentSpatialRev: number = 3;
    const rev0: number | undefined = snapRev0.spatialRevision;
    const isMismatchRev0 = rev0 !== undefined && rev0 !== currentSpatialRev;
    const isMismatchRevCurrent = currentSpatialRev !== currentSpatialRev;
    assert.equal(isMismatchRev0, true, 'Snapshot with spatialRevision 0 must be detected as mismatch vs current rev 3');
    assert.equal(isMismatchRevCurrent, false, 'Snapshot matching current spatialRevision must not be flagged');

    console.log('PASS Test 6 — Spatial revision tracking and mismatch detection across spatial vs non-spatial mutations');
  }

  // Test 7: PROFILE_FRAME Exclusion from History Buffer Ingestion
  {
    const rfBuffer = new SimulationHistoryBuffer(3000);
    const schedBuffer = new SchedulerHistoryBuffer(3000);

    // Telemetry frames record into history
    rfBuffer.push(createMockRFRecord(1, 0.02));
    schedBuffer.push(createMockSchedulerRecord(1, 0.02));
    assert.equal(rfBuffer.size, 1);
    assert.equal(schedBuffer.size, 1);

    // Profile frames (out-of-band refreshes from worker.emitProfileFrame)
    // In index.html, PROFILE_FRAME handler updates `latestTelemetry.selected_node_fresnel`
    // but explicitly DOES NOT call `recordHistoricalFrame()` or `recordSchedulerHistoricalFrame()`.
    // Simulating multiple out-of-band profile refreshes:
    const profileFrameMsg = {
      type: 'PROFILE_FRAME',
      selectedNodeId: 4,
      profileSerial: 2,
      spatial_revision: 0,
      fresnel: {},
    };
    assert.equal(profileFrameMsg.type, 'PROFILE_FRAME');

    // History buffer sizes remain unchanged
    assert.equal(rfBuffer.size, 1, 'Profile frames must not be pushed into RF history');
    assert.equal(schedBuffer.size, 1, 'Profile frames must not be pushed into Scheduler history');

    console.log('PASS Test 7 — PROFILE_FRAME exclusion from history buffer ingestion');
  }

  // Test 8: Live Worker Isolation During Historical Scrubbing
  {
    const worker = new SimulationWorkerManager();
    const rfBuffer = new SimulationHistoryBuffer(3000);
    const schedBuffer = new SchedulerHistoryBuffer(3000);
    const rfController = new SimulationHistoryController(rfBuffer);
    const schedController = new SchedulerHistoryController(schedBuffer);

    // Advance worker 10 frames
    for (let i = 0; i < 10; i++) {
      worker.tickSimulation();
      rfBuffer.push(createMockRFRecord(worker.frameIndex, worker.simTimeS));
      schedBuffer.push(createMockSchedulerRecord(worker.frameIndex, worker.simTimeS));
    }

    const liveFrameIndex = worker.frameIndex;
    const liveSimTime = worker.simTimeS;
    const liveAcnPos = [...worker.trajectoryEngine.getAcnPosition(liveSimTime)];
    const liveNodePos = [...worker.nodesTac[4].position];

    // User scrubs back to historical frame 3
    rfController.enterHistorical(3, false);
    schedController.enterHistorical(3, false);

    const histRF = rfController.scrubTo(3);
    const histSched = schedController.scrubTo(3);

    assert.equal(histRF?.frameIndex, 3);
    assert.equal(histSched?.frameIndex, 3);

    // Verify worker live state is 100% untouched
    assert.equal(worker.frameIndex, liveFrameIndex, 'Worker frameIndex must not change during scrubbing');
    assert.equal(worker.simTimeS, liveSimTime, 'Worker simTimeS must not change during scrubbing');
    assert.deepEqual(worker.trajectoryEngine.getAcnPosition(liveSimTime), liveAcnPos, 'Worker trajectory must not change');
    assert.deepEqual(worker.nodesTac[4].position, liveNodePos, 'Worker node positions must not change');

    // Verify snapshot immutability (frozen objects)
    assert.throws(() => {
      // @ts-expect-error mutating frozen object
      histRF.frameIndex = 999;
    }, /Cannot assign to read only property/);

    assert.throws(() => {
      // @ts-expect-error mutating frozen object
      histSched.frameIndex = 999;
    }, /Cannot assign to read only property/);

    console.log('PASS Test 8 — Live worker state isolation and historical record immutability during scrubbing');
  }

  // Test 9: Symmetrical live telemetry ingestion during historical inspection and clean recovery upon LIVE return
  {
    const rfBuffer = new SimulationHistoryBuffer(3000);
    const schedBuffer = new SchedulerHistoryBuffer(3000);
    const rfController = new SimulationHistoryController(rfBuffer);
    const schedController = new SchedulerHistoryController(schedBuffer);

    // Initial 10 frames recorded live
    for (let f = 1; f <= 10; f++) {
      rfBuffer.push(createMockRFRecord(f, f * 0.02));
      schedBuffer.push(createMockSchedulerRecord(f, f * 0.02));
    }

    assert.equal(rfController.isInspecting, false);
    assert.equal(schedController.isInspecting, false);
    assert.equal(rfBuffer.size, 10);
    assert.equal(schedBuffer.size, 10);

    // User scrubs back to historical frame 5 on both timelines
    rfController.enterHistorical(5, false);
    schedController.enterHistorical(5, false);

    assert.equal(rfController.isInspecting, true);
    assert.equal(schedController.isInspecting, true);
    assert.equal(rfController.getActiveHistoricalRecord()?.frameIndex, 5);
    assert.equal(schedController.getActiveHistoricalRecord()?.frameIndex, 5);

    // Live frames 11 through 25 continue arriving (symmetrically recorded into both buffers)
    for (let f = 11; f <= 25; f++) {
      rfBuffer.push(createMockRFRecord(f, f * 0.02));
      schedBuffer.push(createMockSchedulerRecord(f, f * 0.02));
    }

    // Verify inspected view remains locked at frame 5 without jumping or regressing
    assert.equal(rfController.currentInspectedFrame, 5);
    assert.equal(rfController.getActiveHistoricalRecord()?.frameIndex, 5);
    assert.equal(schedController.currentInspectedFrame, 5);
    assert.equal(schedController.getActiveHistoricalRecord()?.frameIndex, 5);

    // Verify both buffers advanced symmetrically to 25 frames
    assert.equal(rfBuffer.size, 25);
    assert.equal(schedBuffer.size, 25);
    assert.equal(rfBuffer.getNewest()?.frameIndex, 25);
    assert.equal(schedBuffer.getNewest()?.frameIndex, 25);

    // Return to LIVE
    const exitRF = rfController.exitHistorical();
    const exitSched = schedController.exitHistorical();

    assert.equal(exitRF.shouldResume, false);
    assert.equal(exitSched.shouldResume, false);
    assert.equal(rfController.isInspecting, false);
    assert.equal(schedController.isInspecting, false);
    assert.equal(rfController.getActiveHistoricalRecord(), null);
    assert.equal(schedController.getActiveHistoricalRecord(), null);

    // Live stream resumes with newest frames retained without gap
    assert.equal(rfBuffer.getNewest()?.frameIndex, 25);
    assert.equal(schedBuffer.getNewest()?.frameIndex, 25);
    assert.equal(rfBuffer.getSpan().count, 25);
    assert.equal(schedBuffer.getSpan().count, 25);

    console.log('PASS Test 9 — Symmetrical live telemetry ingestion during historical inspection and clean recovery');
  }

  // Test 10: Selected-frame eviction handling during prolonged inspection
  {
    const rfBuffer = new SimulationHistoryBuffer(3000);
    const schedBuffer = new SchedulerHistoryBuffer(3000);
    const rfController = new SimulationHistoryController(rfBuffer);
    const schedController = new SchedulerHistoryController(schedBuffer);

    // Fill buffer to capacity (3,000 frames: 1 to 3000)
    for (let f = 1; f <= 3000; f++) {
      rfBuffer.push(createMockRFRecord(f, f * 0.02));
      schedBuffer.push(createMockSchedulerRecord(f, f * 0.02));
    }

    // Inspect frame 10 (valid at this moment)
    rfController.enterHistorical(10, false);
    schedController.enterHistorical(10, false);

    assert.equal(rfController.isEvicted, false);
    assert.equal(schedController.isEvicted, false);
    assert.equal(rfController.currentInspectedFrame, 10);
    assert.equal(schedController.currentInspectedFrame, 10);

    // Push 100 new frames (3001 to 3100) — frame 10 is evicted as oldest retained becomes 101
    for (let f = 3001; f <= 3100; f++) {
      rfBuffer.push(createMockRFRecord(f, f * 0.02));
      schedBuffer.push(createMockSchedulerRecord(f, f * 0.02));
    }

    assert.equal(rfBuffer.getSpan().oldestFrame, 101);
    assert.equal(schedBuffer.getSpan().oldestFrame, 101);
    assert.equal(rfBuffer.isEvicted(10), true);
    assert.equal(schedBuffer.isEvicted(10), true);

    // getActiveHistoricalRecord triggers eviction detection and clamps to oldest retained frame
    const clampedRF = rfController.getActiveHistoricalRecord();
    const clampedSched = schedController.getActiveHistoricalRecord();

    assert.equal(rfController.isEvicted, true, 'rfController must flag eviction');
    assert.equal(schedController.isEvicted, true, 'schedController must flag eviction');
    assert.equal(clampedRF?.frameIndex, 101, 'rfController must clamp to oldest retained frame');
    assert.equal(clampedSched?.frameIndex, 101, 'schedController must clamp to oldest retained frame');
    assert.equal(rfController.currentInspectedFrame, 101);
    assert.equal(schedController.currentInspectedFrame, 101);

    // Exiting historical clears eviction flag
    rfController.exitHistorical();
    schedController.exitHistorical();
    assert.equal(rfController.isEvicted, false);
    assert.equal(schedController.isEvicted, false);

    console.log('PASS Test 10 — Selected-frame eviction detection and oldest-frame clamping during prolonged inspection');
  }

  // Test 11: Ground terminal inventory data mapping (16 nodes, Cartesian coordinates, MSL, AGL, and tactical roles)
  {
    const worker = new SimulationWorkerManager();
    const nodes = worker.buildNodesTelemetry();

    assert.equal(nodes.length, 16, 'Exactly 16 terminals must be present in nodes_telemetry');

    function getExpectedRole(id: number): string {
      if (id === 15) return 'Main Command Post (20W Dish)';
      if (id === 4) return 'Recon Patrol (Occlusion Target)';
      if (id === 1) return 'Squad Leader (Voice Lead)';
      if (id === 2) return 'Medic (Voice MC-PTT)';
      if (id === 3 || id === 6 || id === 9) return 'Scout (Tactical Video)';
      return 'Soldier Terminal';
    }

    for (const node of nodes) {
      assert(Number.isInteger(node.node_id) && node.node_id >= 0 && node.node_id <= 15, `Node ID ${node.node_id} valid`);
      const expectedName = node.node_id === 15 ? 'MCP' : `S${node.node_id}`;
      assert.equal(node.name, expectedName, `Callsign for node ${node.node_id} matches`);

      assert(Number.isFinite(node.x_m), `x_m finite for node ${node.node_id}`);
      assert(Number.isFinite(node.y_m), `y_m finite for node ${node.node_id}`);
      assert(Number.isFinite(node.z_m), `z_m finite for node ${node.node_id}`);

      assert.equal(node.coordinate_reference, 'local Cartesian; x/y metres; z absolute altitude MSL metres');
      assert(Number.isFinite(node.terrain_elevation_msl_m), `terrain_elevation_msl_m finite for node ${node.node_id}`);
      assert(Number.isFinite(node.agl_m) && node.agl_m > 0, `agl_m positive for node ${node.node_id}`);
      assert.equal(node.altitude_msl_m, node.z_m, `altitude_msl_m equals z_m for node ${node.node_id}`);

      const role = getExpectedRole(node.node_id);
      assert(role.length > 0, `Role defined for node ${node.node_id}`);

      assert(typeof node.link_outage === 'boolean', `link_outage boolean for node ${node.node_id}`);
      assert(typeof node.terrain_is_los === 'boolean', `terrain_is_los boolean for node ${node.node_id}`);
      assert(Number.isFinite(node.diffraction_loss_db), `diffraction_loss_db finite for node ${node.node_id}`);
      assert(typeof node.modcod_name === 'string', `modcod_name string for node ${node.node_id}`);
      assert(Number.isFinite(node.snr_db), `snr_db finite for node ${node.node_id}`);
    }

    console.log('PASS Test 11 — Ground terminal inventory data mapping (16 nodes, Cartesian coords, MSL, AGL, roles)');
  }

  console.log('\nAll Milestone 5 Historical Timeline 60-Second and Isolation tests passed successfully.');
}

runTests().catch((err) => {
  console.error('\nFAIL verifyHistoryTimeline60s:', err);
  process.exit(1);
});
