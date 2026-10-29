/**
 * Milestone 3B.2B — Profile Freshness and Selection
 *
 * Regression tests verifying:
 *  1. Selecting a different node while paused refreshes the profile for that node.
 *  2. Applying an obstacle while paused refreshes the profile immediately.
 *  3. Refreshing does not advance simulation time, frame, traffic, queues,
 *     scheduler state, or frame-based KPIs.
 *  4. A rejected or spatial-lock-blocked obstacle replacement leaves committed
 *     profile state (profileSerial) unchanged.
 *  5. A delayed response for an old selection cannot overwrite the latest selection.
 *  6. An old obstacle response cannot overwrite a profile for a newer committed set.
 *  7. Malformed or mismatched responses cannot partially mutate state.
 *  8. Existing telemetry and Canvas tuple consumers remain compatible.
 *  9. Terrain LOS and obstacle blockage remain independent in profile metadata.
 */

import assert from 'node:assert/strict';
import { SimulationWorkerManager } from '../worker/simWorker';
import { TerrainEngine } from '../core/terrain';
import { PredictiveLookAheadEngine } from '../core/trajectory';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Capture all PROFILE_FRAME messages emitted by emitProfileFrame(). */
function captureProfileFrames(sim: SimulationWorkerManager): {
  frames: Array<{ selectedNodeId: number; profileSerial: number; fresnel: any }>;
  restore: () => void;
} {
  const frames: Array<{ selectedNodeId: number; profileSerial: number; fresnel: any }> = [];
  const original = (sim as any).emitHostMessage.bind(sim);
  (sim as any).emitHostMessage = (msg: any) => {
    if (msg && msg.type === 'PROFILE_FRAME') frames.push(msg);
    original(msg);
  };
  return { frames, restore: () => { (sim as any).emitHostMessage = original; } };
}

/** Snapshot non-profile simulation state for invariant checks. */
function snapshotSimState(sim: SimulationWorkerManager) {
  return {
    simTimeS: sim.simTimeS,
    frameIndex: sim.frameIndex,
    queueBits: sim.nodesTac.map(n => n.queue.getTotalBacklogBits()),
    tacEnqueued: sim.metrics.tacEnqueuedPkts,
    tacGoodput: sim.metrics.tacGoodputBits,
    obstacles: [...sim.terrainEngine.obstacleField.all],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — SELECT_NODE while paused refreshes profile for the new node
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager();
  sim.isPaused = true;

  const initialNodeId = sim.selectedNodeId; // 4 by default
  const otherNodeId = initialNodeId === 4 ? 2 : 4;

  const { frames, restore } = captureProfileFrames(sim);
  const before = snapshotSimState(sim);

  const res = sim.handleMessage({ type: 'SELECT_NODE', node_id: otherNodeId });
  assert.equal(res.accepted, true);
  assert.equal(sim.selectedNodeId, otherNodeId, 'worker selectedNodeId updated');

  assert.equal(frames.length, 1, 'exactly one PROFILE_FRAME emitted on selection');
  assert.equal(frames[0].selectedNodeId, otherNodeId, 'PROFILE_FRAME carries the new node id');
  assert.equal(typeof frames[0].profileSerial, 'number', 'profileSerial is a number');
  assert.ok(frames[0].profileSerial > 0, 'profileSerial is positive');
  assert.ok(frames[0].fresnel && typeof frames[0].fresnel === 'object', 'fresnel payload present');
  assert.equal(frames[0].fresnel.node_id, otherNodeId, 'fresnel node_id matches selection');
  assert.ok(frames[0].fresnel.profile && frames[0].fresnel.profile.valid, 'profile is valid');
  assert.equal(frames[0].fresnel.profile.selectedGroundNodeId, otherNodeId,
    'typed profile carries the newly selected node id');

  // Sim time, frame, queues, and KPI accumulators must be unchanged.
  const after = snapshotSimState(sim);
  assert.equal(after.simTimeS, before.simTimeS, 'sim time not advanced by SELECT_NODE');
  assert.equal(after.frameIndex, before.frameIndex, 'frame index not advanced');
  assert.deepEqual(after.queueBits, before.queueBits, 'queue backlog not changed');
  assert.equal(after.tacEnqueued, before.tacEnqueued, 'traffic metrics not changed');

  restore();
  console.log('PASS Test 1 — SELECT_NODE while paused refreshes profile for the new node');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — OBSTACLES_REPLACE while paused refreshes profile immediately
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager();
  sim.terrainEngine = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 0 });
  sim.lookaheadEngine = new PredictiveLookAheadEngine(
    sim.terrainEngine, sim.linkEngine, sim.rfConfig, sim.envConfig, sim.flightConfig, sim.trajectoryEngine,
  );
  sim.isPaused = true;
  // Place selected node at known clear position.
  const nid = sim.selectedNodeId;
  sim.nodesTac[nid].position = [12000, 8000, 2];
  sim.nodesStatic[nid].position = [12000, 8000, 2];

  // Run one tick so obstructionResults are populated.
  sim.isPaused = false;
  sim.tickSimulation();
  sim.isPaused = true;

  const { frames, restore } = captureProfileFrames(sim);
  const before = snapshotSimState(sim);
  const beforeSerial = (sim as any).profileSerial as number;

  const blockerObs = {
    id: 'test-blocker', shape: 'cuboid',
    x_m: 12000, y_m: 8000, width_m: 2000, depth_m: 2000, height_m: 5000, rotation_deg: 0,
  };
  const res = sim.handleMessage({ type: 'OBSTACLES_REPLACE', request_id: 'test-obs-1', obstacles: [blockerObs] });
  assert.equal(res.accepted, true, 'obstacle replace accepted');

  // Profile frame must have been emitted.
  assert.equal(frames.length, 1, 'exactly one PROFILE_FRAME emitted after obstacle commit');
  const emittedSerial = frames[0].profileSerial;
  assert.ok(emittedSerial > beforeSerial, 'profileSerial incremented');
  assert.equal(frames[0].selectedNodeId, sim.selectedNodeId, 'PROFILE_FRAME targets current node');
  assert.equal(frames[0].fresnel.profile.obstacleBlocked, true,
    'refreshed profile reflects the newly committed obstacle');
  assert.equal(frames[0].fresnel.profile.terrainIsLos, true,
    'terrain LOS is separate from obstacle blockage in the refreshed profile');

  // Sim time, frame, queues, KPIs must be unchanged.
  const after = snapshotSimState(sim);
  assert.equal(after.simTimeS, before.simTimeS, 'sim time not advanced by obstacle commit');
  assert.equal(after.frameIndex, before.frameIndex, 'frame index not advanced');
  assert.deepEqual(after.queueBits, before.queueBits, 'queue backlog not changed');
  assert.equal(after.tacEnqueued, before.tacEnqueued, 'enqueued packet count not changed');
  assert.equal(after.tacGoodput, before.tacGoodput, 'goodput accumulator not changed');

  restore();
  console.log('PASS Test 2 — OBSTACLES_REPLACE while paused refreshes profile immediately');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Profile refresh does not advance any sim state (extended)
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager();
  sim.terrainEngine = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 0 });
  sim.lookaheadEngine = new PredictiveLookAheadEngine(
    sim.terrainEngine, sim.linkEngine, sim.rfConfig, sim.envConfig, sim.flightConfig, sim.trajectoryEngine,
  );
  sim.isPaused = true;
  sim.tickSimulation();
  sim.isPaused = true;

  const snap0 = snapshotSimState(sim);
  const staticGoodput0 = sim.metrics.staticGoodputBits;
  const staticEnqueued0 = sim.metrics.staticEnqueuedPkts;

  // Trigger emitProfileFrame() directly.
  const { frames, restore } = captureProfileFrames(sim);
  sim.emitProfileFrame();
  sim.emitProfileFrame();
  sim.emitProfileFrame();

  const snap1 = snapshotSimState(sim);
  assert.equal(snap1.simTimeS, snap0.simTimeS, 'emitProfileFrame does not change sim time');
  assert.equal(snap1.frameIndex, snap0.frameIndex, 'emitProfileFrame does not change frame index');
  assert.deepEqual(snap1.queueBits, snap0.queueBits, 'emitProfileFrame does not change queue state');
  assert.equal(snap1.tacEnqueued, snap0.tacEnqueued, 'emitProfileFrame does not change tac enqueued');
  assert.equal(sim.metrics.staticGoodputBits, staticGoodput0, 'static goodput accumulator unchanged');
  assert.equal(sim.metrics.staticEnqueuedPkts, staticEnqueued0, 'static enqueued count unchanged');

  assert.equal(frames.length, 3, 'three PROFILE_FRAMEs emitted');
  // Serials must be strictly increasing.
  assert.ok(frames[1].profileSerial > frames[0].profileSerial, 'serial increments per emission');
  assert.ok(frames[2].profileSerial > frames[1].profileSerial, 'serial continues incrementing');

  restore();
  console.log('PASS Test 3 — emitProfileFrame never advances simulation state or accumulators');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Rejected / spatial-lock-blocked obstacle does not mutate profile state
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager();
  sim.terrainEngine = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 0 });
  sim.lookaheadEngine = new PredictiveLookAheadEngine(
    sim.terrainEngine, sim.linkEngine, sim.rfConfig, sim.envConfig, sim.flightConfig, sim.trajectoryEngine,
  );
  sim.isPaused = true;

  const committedObstacle = {
    id: 'safe-obs', shape: 'cuboid',
    x_m: 0, y_m: 0, width_m: 10, depth_m: 10, height_m: 10, rotation_deg: 0,
  };
  assert.equal(sim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [committedObstacle] }).accepted, true);
  const serialAfterCommit = (sim as any).profileSerial as number;
  const { frames, restore } = captureProfileFrames(sim);

  // Invalid batch — should be rejected.
  const invalidRes = sim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [{ ...committedObstacle, x_m: Number.NaN }] });
  assert.equal(invalidRes.accepted, false, 'NaN obstacle rejected');
  assert.equal(frames.length, 0, 'no PROFILE_FRAME emitted on rejection');
  assert.equal((sim as any).profileSerial, serialAfterCommit, 'profileSerial not changed on rejection');
  // The committed set is stored in normalised camelCase form; verify the ID is preserved.
  const committed = sim.terrainEngine.obstacleField.all;
  assert.equal(committed.length, 1, 'committed obstacle count unchanged after rejection');
  assert.equal(committed[0].id, committedObstacle.id, 'committed obstacle id preserved after rejection');

  // Spatial lock — should also be rejected.
  sim.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: true });
  const lockedRes = sim.handleMessage({
    type: 'OBSTACLES_REPLACE', obstacles: [{ ...committedObstacle, id: 'new-obs' }],
  });
  assert.equal(lockedRes.accepted, false, 'locked replace rejected');
  assert.equal(frames.length, 0, 'no PROFILE_FRAME emitted under spatial lock');
  assert.equal((sim as any).profileSerial, serialAfterCommit, 'profileSerial unchanged after locked rejection');
  sim.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: false });

  restore();
  console.log('PASS Test 4 — Rejected / spatial-lock-blocked obstacle leaves profile serial and geometry unchanged');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Stale node-selection response cannot overwrite newer selection state
// (UI-layer simulation: mimics the latestProfileSerial / latestProfileNodeId guard)
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager();

  // Collect all PROFILE_FRAME messages in emission order.
  const allFrames: Array<{ selectedNodeId: number; profileSerial: number; fresnel: any }> = [];
  const orig = (sim as any).emitHostMessage.bind(sim);
  (sim as any).emitHostMessage = (msg: any) => {
    if (msg && msg.type === 'PROFILE_FRAME') allFrames.push(msg);
    orig(msg);
  };

  // Select node A then immediately node B.
  sim.handleMessage({ type: 'SELECT_NODE', node_id: 2 });
  sim.handleMessage({ type: 'SELECT_NODE', node_id: 7 });

  assert.equal(allFrames.length, 2, 'two PROFILE_FRAMEs emitted, one per selection');
  const [frameA, frameB] = allFrames;
  assert.equal(frameA.selectedNodeId, 2);
  assert.equal(frameB.selectedNodeId, 7);
  assert.ok(frameB.profileSerial > frameA.profileSerial, 'newer selection has higher serial');

  // Simulate the UI acceptance logic.
  let uiSerial = 0;
  let uiNodeId = -1;
  let uiFresnel: any = null;

  function applyProfileFrame(frame: typeof allFrames[0]) {
    // Matches the UI guard in index.html:
    if (frame.profileSerial <= uiSerial) return; // stale serial
    if (frame.selectedNodeId !== sim.selectedNodeId) return; // wrong node
    uiSerial = frame.profileSerial;
    uiNodeId = frame.selectedNodeId;
    uiFresnel = frame.fresnel;
  }

  // Apply newer frame first (as if it arrived before the older one — network reorder scenario).
  applyProfileFrame(frameB);
  assert.equal(uiNodeId, 7, 'newer frame applied');
  assert.equal(uiSerial, frameB.profileSerial);

  // Now deliver the older frame — must be discarded.
  applyProfileFrame(frameA);
  assert.equal(uiNodeId, 7, 'older frame did not overwrite newer selection');
  assert.equal(uiSerial, frameB.profileSerial, 'serial not regressed');
  assert.equal(uiFresnel?.node_id, 7, 'fresnel still reflects the newer selection');

  (sim as any).emitHostMessage = orig;
  console.log('PASS Test 5 — Stale node-selection response cannot overwrite newer selection state');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — Old obstacle response cannot overwrite profile for a newer obstacle set
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager();
  sim.terrainEngine = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 0 });
  sim.lookaheadEngine = new PredictiveLookAheadEngine(
    sim.terrainEngine, sim.linkEngine, sim.rfConfig, sim.envConfig, sim.flightConfig, sim.trajectoryEngine,
  );

  const obs1 = { id: 'obs1', shape: 'cuboid', x_m: 100, y_m: 0, width_m: 10, depth_m: 10, height_m: 10, rotation_deg: 0 };
  const obs2 = { id: 'obs2', shape: 'cuboid', x_m: 200, y_m: 0, width_m: 10, depth_m: 10, height_m: 10, rotation_deg: 0 };

  const allFrames: any[] = [];
  const orig = (sim as any).emitHostMessage.bind(sim);
  (sim as any).emitHostMessage = (msg: any) => {
    if (msg && msg.type === 'PROFILE_FRAME') allFrames.push(msg);
    orig(msg);
  };

  sim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [obs1] });
  sim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [obs1, obs2] });

  assert.equal(allFrames.length, 2, 'two PROFILE_FRAMEs, one per obstacle commit');
  const [frame1, frame2] = allFrames;
  assert.ok(frame2.profileSerial > frame1.profileSerial, 'second commit has higher serial');

  // UI guard simulation: applying out-of-order.
  let uiSerial = 0;
  let uiFresnel: any = null;

  function applyIfFresh(frame: any) {
    if (frame.profileSerial <= uiSerial) return;
    if (frame.selectedNodeId !== sim.selectedNodeId) return;
    uiSerial = frame.profileSerial;
    uiFresnel = frame.fresnel;
  }

  applyIfFresh(frame2); // newer arrives first
  applyIfFresh(frame1); // older arrives late — must be rejected

  assert.equal(uiSerial, frame2.profileSerial, 'serial not regressed');
  assert.equal(uiFresnel, frame2.fresnel, 'fresnel retained from the newer commit');

  (sim as any).emitHostMessage = orig;
  console.log('PASS Test 6 — Old obstacle response cannot overwrite profile for a newer obstacle set');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — Malformed or mismatched PROFILE_FRAME cannot partially mutate state
// ─────────────────────────────────────────────────────────────────────────────
{
  // Mimics the UI guard for malformed payloads (missing/wrong type fields).
  let uiSerial = 10;
  let uiFresnel: any = { sentinel: true };
  const currentNodeId = 4;

  function applyGuarded(msg: any) {
    const serial = typeof msg.profileSerial === 'number' ? msg.profileSerial : -1;
    const nodeId = typeof msg.selectedNodeId === 'number' ? msg.selectedNodeId : -1;
    if (serial <= uiSerial) return;
    if (nodeId !== currentNodeId) return;
    if (!msg.fresnel || typeof msg.fresnel !== 'object') return;
    uiSerial = serial;
    uiFresnel = msg.fresnel;
  }

  const badPayloads = [
    // stale serial
    { type: 'PROFILE_FRAME', profileSerial: 5, selectedNodeId: 4, fresnel: { updated: true } },
    // wrong node
    { type: 'PROFILE_FRAME', profileSerial: 20, selectedNodeId: 7, fresnel: { updated: true } },
    // missing fresnel
    { type: 'PROFILE_FRAME', profileSerial: 20, selectedNodeId: 4, fresnel: null },
    // non-object fresnel
    { type: 'PROFILE_FRAME', profileSerial: 20, selectedNodeId: 4, fresnel: 'bad' },
    // missing profileSerial
    { type: 'PROFILE_FRAME', selectedNodeId: 4, fresnel: { updated: true } },
    // missing selectedNodeId
    { type: 'PROFILE_FRAME', profileSerial: 20, fresnel: { updated: true } },
  ];
  for (const payload of badPayloads) {
    applyGuarded(payload);
    assert.equal(uiSerial, 10, `serial must not change for bad payload: ${JSON.stringify(payload)}`);
    assert.equal(uiFresnel.sentinel, true, `fresnel must not change for bad payload: ${JSON.stringify(payload)}`);
  }

  // A valid payload must succeed.
  applyGuarded({ type: 'PROFILE_FRAME', profileSerial: 15, selectedNodeId: 4, fresnel: { updated: true } });
  assert.equal(uiSerial, 15, 'valid payload accepted');
  assert.equal(uiFresnel.updated, true);

  console.log('PASS Test 7 — Malformed or mismatched PROFILE_FRAME cannot partially mutate UI state');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Existing telemetry and Canvas tuple consumers remain compatible
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager();
  sim.terrainEngine = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 0 });
  sim.lookaheadEngine = new PredictiveLookAheadEngine(
    sim.terrainEngine, sim.linkEngine, sim.rfConfig, sim.envConfig, sim.flightConfig, sim.trajectoryEngine,
  );
  sim.tickSimulation();

  const acnPos = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  const telemetry = (sim as any).buildTelemetryFrame(acnPos);
  const fresnel = telemetry.selected_node_fresnel;

  // Legacy fields must remain present and correct.
  assert.ok(typeof fresnel.distance_km === 'number' && Number.isFinite(fresnel.distance_km),
    'distance_km (slant) still present in telemetry fresnel slice');
  assert.ok(Array.isArray(fresnel.profile_points) && fresnel.profile_points.length > 1,
    'profile_points still present and non-empty');
  assert.equal(typeof fresnel.profile_points[0][0], 'number', 'profile_points[0][0] is a number');

  // Typed profile fields.
  assert.ok(fresnel.profile && fresnel.profile.valid, 'typed profile is valid');
  assert.equal(fresnel.profile.selectedGroundNodeId, sim.selectedNodeId, 'typed profile node id matches');
  assert.equal(fresnel.profile.frameIndex, sim.frameIndex);
  assert.ok(typeof fresnel.profile.horizontalGroundDistanceM === 'number' && Number.isFinite(fresnel.profile.horizontalGroundDistanceM));

  // Profile emitted via emitProfileFrame must carry the same fresnel structure.
  const collectedFrames: any[] = [];
  const orig = (sim as any).emitHostMessage.bind(sim);
  (sim as any).emitHostMessage = (msg: any) => {
    if (msg && msg.type === 'PROFILE_FRAME') collectedFrames.push(msg);
    orig(msg);
  };
  sim.emitProfileFrame();
  assert.equal(collectedFrames.length, 1, 'emitProfileFrame produces one PROFILE_FRAME');
  const pf = collectedFrames[0].fresnel;
  assert.ok(Array.isArray(pf.profile_points) && pf.profile_points.length > 1,
    'PROFILE_FRAME fresnel carries profile_points compatible tuple');
  assert.equal(pf.profile_points[0][0], 0,
    'first profile_points x-coordinate is 0 (ground node)');
  assert.ok(pf.profile && pf.profile.valid, 'typed profile within PROFILE_FRAME is valid');
  (sim as any).emitHostMessage = orig;

  console.log('PASS Test 8 — Existing telemetry and Canvas tuple consumers remain compatible');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — Terrain LOS and obstacle blockage remain independent in profile metadata
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager(99);
  sim.terrainEngine = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 0 });
  sim.lookaheadEngine = new PredictiveLookAheadEngine(
    sim.terrainEngine, sim.linkEngine, sim.rfConfig, sim.envConfig, sim.flightConfig, sim.trajectoryEngine,
  );

  // Move selected node to a known open location.
  const nid = sim.selectedNodeId;
  sim.nodesTac[nid].position = [12000, 8000, 2];
  sim.nodesStatic[nid].position = [12000, 8000, 2];
  sim.tickSimulation(); // populate obstructionResults

  // Verify clear state first.
  const clearObs = sim.obstructionResults.get(nid);
  assert.equal(clearObs?.isLos, true, 'node is initially in LOS');
  assert.equal(clearObs?.obstacleBlocked, false, 'no obstacle blocking initially');

  // Place a large obstacle mid-link.
  const acnPos = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  const midX = (sim.nodesTac[nid].position[0] + acnPos[0]) / 2;
  const midY = (sim.nodesTac[nid].position[1] + acnPos[1]) / 2;
  const blocker = {
    id: 'terrain-test-blocker', shape: 'cuboid',
    x_m: midX, y_m: midY, width_m: 3000, depth_m: 3000, height_m: 4999, rotation_deg: 0,
  };
  const obsResult = sim.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [blocker] });
  assert.equal(obsResult.accepted, true);

  // Collect the PROFILE_FRAME emitted by the OBSTACLES_REPLACE handler.
  const frames: any[] = [];
  const orig = (sim as any).emitHostMessage.bind(sim);
  (sim as any).emitHostMessage = (msg: any) => { if (msg?.type === 'PROFILE_FRAME') frames.push(msg); orig(msg); };
  // Re-emit to capture (the one from OBSTACLES_REPLACE was emitted before we patched).
  sim.emitProfileFrame();
  (sim as any).emitHostMessage = orig;

  assert.equal(frames.length, 1);
  const prof = frames[0].fresnel.profile;
  assert.equal(prof.obstacleBlocked, true, 'profile correctly reports obstacle blockage');
  // terrainIsLos reflects only the terrain physics result — with flat terrain and obstacle, terrain is still LOS.
  assert.equal(prof.terrainIsLos, true, 'terrain LOS is independent of obstacle blockage');
  // Also verify via top-level fresnel fields.
  assert.equal(frames[0].fresnel.obstacle_blocked, true);
  assert.equal(frames[0].fresnel.terrain_is_los, true, 'fresnel slice terrain_is_los stays independent');

  console.log('PASS Test 9 — Terrain LOS and obstacle blockage remain independent in profile metadata');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 10 — NODE_MOVE while paused refreshes profile and telemetry immediately
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager();
  sim.terrainEngine = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 0 });
  sim.lookaheadEngine = new PredictiveLookAheadEngine(
    sim.terrainEngine, sim.linkEngine, sim.rfConfig, sim.envConfig, sim.flightConfig, sim.trajectoryEngine,
  );
  sim.isPaused = true;
  const nid = sim.selectedNodeId;

  const { frames, restore } = captureProfileFrames(sim);
  const before = snapshotSimState(sim);

  const moveRes = sim.handleMessage({ type: 'NODE_MOVE', node_id: nid, x_m: 25000, y_m: 15000 });
  assert.equal(moveRes.accepted, true);

  assert.equal(frames.length, 1, 'exactly one PROFILE_FRAME emitted after NODE_MOVE');
  assert.equal(frames[0].selectedNodeId, nid);
  assert.ok(frames[0].fresnel && typeof frames[0].fresnel === 'object');
  assert.ok((frames[0] as any).selected_link_budget, 'selected_link_budget included in PROFILE_FRAME');
  assert.equal((frames[0] as any).selected_link_budget.node_id, nid);
  assert.ok((frames[0] as any).selected_link_budget.slant_range_km > 0);
  assert.ok((frames[0] as any).selected_link_budget.earth_bulge_m >= 0);
  assert.ok(Array.isArray((frames[0] as any).nodes_telemetry), 'nodes_telemetry included in PROFILE_FRAME');
  const movedNodeTel = (frames[0] as any).nodes_telemetry.find((n: any) => n.node_id === nid);
  assert.equal(movedNodeTel.x_m, 25000);
  assert.equal(movedNodeTel.y_m, 15000);
  assert.equal(typeof movedNodeTel.terrain_is_los, 'boolean');
  assert.equal(typeof movedNodeTel.diffraction_loss_db, 'number');

  // Verify simulation time, frame, queues, KPIs are unchanged
  const after = snapshotSimState(sim);
  assert.equal(after.simTimeS, before.simTimeS, 'sim time not advanced by NODE_MOVE');
  assert.equal(after.frameIndex, before.frameIndex, 'frame index not advanced');
  assert.deepEqual(after.queueBits, before.queueBits, 'queue state not changed');

  restore();
  console.log('PASS Test 10 — NODE_MOVE while paused refreshes profile and telemetry immediately');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 — CONFIG_UPDATE / SET_PARAMS while paused refreshes profile immediately
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager();
  sim.terrainEngine = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 0 });
  sim.lookaheadEngine = new PredictiveLookAheadEngine(
    sim.terrainEngine, sim.linkEngine, sim.rfConfig, sim.envConfig, sim.flightConfig, sim.trajectoryEngine,
  );
  sim.isPaused = true;

  const { frames, restore } = captureProfileFrames(sim);
  const before = snapshotSimState(sim);

  // Test with CONFIG_UPDATE
  const configRes = sim.handleMessage({
    type: 'CONFIG_UPDATE',
    params: { carrier_freq_ghz: 10.0, rain_rate_mmh: 15.0 },
  });
  assert.equal(configRes.accepted, true);
  assert.equal(frames.length, 1, 'PROFILE_FRAME emitted on CONFIG_UPDATE');
  assert.ok((frames[0] as any).selected_link_budget.rain_loss_db > 0, 'rain loss is computed authoritatively');
  assert.equal(sim.rfConfig.carrierFrequencyHz, 10.0e9);

  // Test alias SET_PARAMS
  const setParamsRes = sim.handleMessage({
    type: 'SET_PARAMS',
    params: { carrier_freq_ghz: 11.5 },
  });
  assert.equal(setParamsRes.accepted, true);
  assert.equal(frames.length, 2, 'PROFILE_FRAME emitted on SET_PARAMS');
  assert.equal(sim.rfConfig.carrierFrequencyHz, 11.5e9);

  // Verify simulation time, frame, queues, KPIs are unchanged
  const after = snapshotSimState(sim);
  assert.equal(after.simTimeS, before.simTimeS, 'sim time not advanced by parameter updates');
  assert.equal(after.frameIndex, before.frameIndex, 'frame index not advanced');

  restore();
  console.log('PASS Test 11 — CONFIG_UPDATE / SET_PARAMS while paused refreshes profile immediately');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 12 — Telemetry frame carries authoritative link budget, terrain LOS, and earth bulge
// ─────────────────────────────────────────────────────────────────────────────
{
  const sim = new SimulationWorkerManager();
  sim.terrainEngine = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 0 });
  sim.lookaheadEngine = new PredictiveLookAheadEngine(
    sim.terrainEngine, sim.linkEngine, sim.rfConfig, sim.envConfig, sim.flightConfig, sim.trajectoryEngine,
  );
  sim.isPaused = true;

  const acnPos = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  const frame = (sim as any).buildTelemetryFrame(acnPos);

  // 1. Check nodes_telemetry has authoritative terrain LOS and diffraction loss
  assert.ok(Array.isArray(frame.nodes_telemetry));
  assert.equal(frame.nodes_telemetry.length, 16);
  for (const node of frame.nodes_telemetry) {
    assert.equal(typeof node.terrain_is_los, 'boolean', 'terrain_is_los is boolean');
    assert.equal(typeof node.diffraction_loss_db, 'number', 'diffraction_loss_db is numeric');
    assert.equal(typeof node.obstacle_blocked, 'boolean', 'obstacle_blocked is boolean');
    assert.equal(typeof node.link_outage, 'boolean', 'link_outage is boolean');
  }

  // 2. Check selected_link_budget has all authoritative DVB-S2X physics fields
  const lb = frame.selected_link_budget;
  assert.ok(lb && typeof lb === 'object', 'selected_link_budget is present');
  assert.equal(lb.node_id, sim.selectedNodeId);
  assert.equal(typeof lb.fspl_db, 'number');
  assert.ok(lb.fspl_db > 100, 'free-space path loss is positive dB');
  assert.equal(typeof lb.diffraction_loss_db, 'number');
  assert.equal(typeof lb.gas_loss_db, 'number');
  assert.equal(typeof lb.rain_loss_db, 'number');
  assert.equal(typeof lb.prx_dbm, 'number');
  assert.equal(typeof lb.pnoise_dbm, 'number');
  assert.equal(typeof lb.snr_db, 'number');
  assert.equal(typeof lb.modcod_name, 'string');
  assert.equal(typeof lb.earth_bulge_m, 'number');
  assert.ok(lb.earth_bulge_m >= 0, 'earth curvature bulge is non-negative');

  // Verify that profile refresh never increments frame index
  const initialFrameIndex = sim.frameIndex;
  sim.emitProfileFrame();
  assert.equal(sim.frameIndex, initialFrameIndex, 'emitProfileFrame never increments frameIndex');

  console.log('PASS Test 12 — Telemetry frame carries authoritative link budget, terrain LOS, and earth bulge');
}

console.log('PASS All Milestone 3B.2B profile-freshness regression tests passed.');
