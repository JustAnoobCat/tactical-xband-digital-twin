import assert from 'node:assert/strict';
import { EnvironmentConfig, GROUND_NODE_IDS, RFConfig } from '../core/config';
import { MAX_OBSTACLES, Obstacle, ObstacleField, obstacleContainsPoint, obstacleFootprintPoints } from '../core/obstacles';
import { TerrainEngine } from '../core/terrain';
import { PredictiveLookAheadEngine } from '../core/trajectory';
import { SimulationWorkerManager } from '../worker/simWorker';
import { ObstacleCommandResult, ObstacleEditorState, resolveSpatialCanvasTarget } from '../ui/obstacleEditorState';
import { parseEditorNumber, TrajectoryEditorState } from '../ui/trajectoryEditorState';
import { routeCommandResult, type RoutedCommandResult } from '../ui/commandResultRouter';

const editor = new ObstacleEditorState();
const selectedObstacle = (): Obstacle | null => editor.selectedObstacle;
const cuboidId = editor.create('cuboid', 100, 200);
assert.equal(editor.committed.length, 0, 'draft creation does not mutate committed geometry');
const leaked = editor.draft as Obstacle[];
(leaked[0] as any).xM = 999;
assert.equal(editor.draft[0].xM, 100, 'draft getter returns a defensive copy');
assert.equal(editor.selectedId, cuboidId);
editor.move(cuboidId, 120, 220);
editor.updateSelected({ widthM: 250, depthM: 120, heightM: 80, rotationDeg: 37 });
assert.deepEqual(editor.selectedObstacle, {
  id: cuboidId, shape: 'cuboid', xM: 120, yM: 220, widthM: 250, depthM: 120, heightM: 80, rotationDeg: 37,
});
assert.equal(editor.validate(), null);

const coneId = editor.create('cone', -100, 50);
editor.updateSelected({ radiusM: 90, heightM: 110 });
assert.equal(selectedObstacle()?.shape, 'cone');
assert.deepEqual(Object.keys(selectedObstacle()!).sort(), ['heightM', 'id', 'radiusM', 'shape', 'xM', 'yM'].sort());
const pyramidId = editor.create('pyramid', 0, -150);
editor.updateSelected({ widthM: 40, depthM: 20, rotationDeg: -90, heightM: 30 });
assert.equal(selectedObstacle()?.shape, 'pyramid');
assert.equal(selectedObstacle() && 'rotationDeg' in selectedObstacle()! ? (selectedObstacle() as Extract<Obstacle, { shape: 'pyramid' }>).rotationDeg : undefined, -90);
editor.select(coneId);
assert.equal(editor.selectedId, coneId);
editor.select(pyramidId);
editor.deleteSelected();
assert.equal(editor.draft.some(o => o.id === pyramidId), false);

editor.select(cuboidId);
editor.updateSelected({ widthM: 5001 });
assert.match(editor.validate() || '', /width and depth/);
assert.throws(() => editor.beginApply('bad'), /width and depth/);
editor.updateSelected({ widthM: 0.01 });
assert.match(editor.validate() || '', /width and depth/);
editor.updateSelected({ widthM: 0.1, heightM: 5001 });
assert.match(editor.validate() || '', /height/);
editor.updateSelected({ heightM: 5000, xM: 600001 });
assert.match(editor.validate() || '', /coordinates/);
editor.updateSelected({ xM: 120, widthM: 250 });
assert.equal(editor.validate(), null, 'valid values within the core boundaries can be applied');
const countEditor = new ObstacleEditorState();
for (let i = 0; i < MAX_OBSTACLES; i++) countEditor.create('cone', i * 100, 0);
assert.equal(countEditor.draft.length, MAX_OBSTACLES);
assert.throws(() => countEditor.create('cone', 0, 0), new RegExp(String(MAX_OBSTACLES)));
const shapeValidation = new ObstacleEditorState();
shapeValidation.create('cone', 0, 0); shapeValidation.updateSelected({ radiusM: 0.01 });
assert.match(shapeValidation.validate() || '', /radius/);
shapeValidation.cancel();
shapeValidation.create('pyramid', 0, 0);
shapeValidation.updateSelected({ depthM: 5001, rotationDeg: 361 });
assert.match(shapeValidation.validate() || '', /width and depth/);
shapeValidation.updateSelected({ depthM: 100, rotationDeg: 361 });
assert.match(shapeValidation.validate() || '', /rotation/);

// Empty, malformed, NaN and infinite numeric inputs remain invalid instead of falling back to defaults.
for (const input of ['', '   ', '12m', '1e', 'NaN', 'Infinity', '-Infinity']) {
  const invalidEditor = new ObstacleEditorState();
  const invalidId = invalidEditor.create('cuboid', 0, 0);
  const parsed = parseEditorNumber(input);
  invalidEditor.updateSelected({ widthM: parsed });
  const invalidDraft = invalidEditor.draft.find(item => item.id === invalidId)! as Extract<Obstacle, { shape: 'cuboid' }>;
  if (Number.isNaN(parsed)) assert.ok(Number.isNaN(invalidDraft.widthM), `input '${input}' remains NaN in draft`);
  else assert.equal(invalidDraft.widthM, parsed, `input '${input}' remains unchanged in draft`);
  assert.match(invalidEditor.validate() || '', /width and depth/);
  assert.throws(() => invalidEditor.beginApply(`invalid-${input}`), /width and depth/);
  assert.equal(invalidEditor.pendingRequestId, null);
}

for (const shape of ['cuboid', 'pyramid'] as const) {
  const boundedEditor = new ObstacleEditorState();
  boundedEditor.create(shape, 0, 0);
  boundedEditor.updateSelected({ widthM: 0, depthM: 100, heightM: 100 });
  assert.match(boundedEditor.validate() || '', /width and depth/, `${shape} rejects zero width`);
  boundedEditor.updateSelected({ widthM: -1 });
  assert.match(boundedEditor.validate() || '', /width and depth/, `${shape} rejects negative width`);
  boundedEditor.updateSelected({ widthM: 100, depthM: 0 });
  assert.match(boundedEditor.validate() || '', /width and depth/, `${shape} rejects zero depth`);
  boundedEditor.updateSelected({ depthM: -1 });
  assert.match(boundedEditor.validate() || '', /width and depth/, `${shape} rejects negative depth`);
  boundedEditor.updateSelected({ depthM: 100, heightM: 0 });
  assert.match(boundedEditor.validate() || '', /height/, `${shape} rejects zero height`);
  boundedEditor.updateSelected({ heightM: -1 });
  assert.match(boundedEditor.validate() || '', /height/, `${shape} rejects negative height`);
  boundedEditor.updateSelected({ widthM: 0.1, depthM: 0.1, heightM: 0.1, rotationDeg: -360 });
  assert.equal(boundedEditor.validate(), null, `${shape} accepts minimum footprint/height and -360°`);
  boundedEditor.updateSelected({ widthM: 5000, depthM: 5000, heightM: 5000, rotationDeg: 360 });
  assert.equal(boundedEditor.validate(), null, `${shape} accepts maximum footprint/height and +360°`);
}
const coneBoundedEditor = new ObstacleEditorState();
coneBoundedEditor.create('cone', 0, 0);
coneBoundedEditor.updateSelected({ radiusM: 0, heightM: 10 });
assert.match(coneBoundedEditor.validate() || '', /radius/, 'cone rejects zero radius');
coneBoundedEditor.updateSelected({ radiusM: -1 });
assert.match(coneBoundedEditor.validate() || '', /radius/, 'cone rejects negative radius');
coneBoundedEditor.updateSelected({ radiusM: 10, heightM: 0 });
assert.match(coneBoundedEditor.validate() || '', /height/, 'cone rejects zero height');
coneBoundedEditor.updateSelected({ heightM: -1 });
assert.match(coneBoundedEditor.validate() || '', /height/, 'cone rejects negative height');
coneBoundedEditor.updateSelected({ radiusM: 0.1, heightM: 0.1 });
assert.equal(coneBoundedEditor.validate(), null, 'cone accepts minimum radius and height');
coneBoundedEditor.updateSelected({ radiusM: 5000, heightM: 5000 });
assert.equal(coneBoundedEditor.validate(), null, 'cone accepts maximum radius and height');

const applySet = editor.beginApply('obstacles-accepted');
assert.equal(applySet.length, 2, 'Apply carries the full draft set');
assert.equal(editor.pendingRequestId, 'obstacles-accepted');
assert.throws(() => editor.move(cuboidId, 0, 0), /current obstacle update/);
assert.throws(() => editor.cancel(), /current obstacle update/);
const acceptedSet = applySet.map(o => ({ ...o }));
const acceptedSnapshot = GROUND_NODE_IDS.map(node_id => ({
  node_id, terrain_is_los: true, obstacle_blocked: node_id === 4,
  obstacle_intersections: node_id === 4 ? [{ obstacleId: cuboidId, entryFraction: 0.4, exitFraction: 0.6, penetrationM: 12 }] : [],
  link_outage: node_id === 4, bitrate_bps: node_id === 4 ? 0 : 1000000,
  modcod_name: node_id === 4 ? 'LINK_OUTAGE' : 'QPSK_1_2', predicted_state: node_id === 4 ? 'HARD_SHADOW_CUTOFF' : 'NORMAL_LOS',
  time_to_occlusion_s: node_id === 4 ? 0 : Number.POSITIVE_INFINITY,
  time_to_emergence_s: node_id === 4 ? 4 : Number.POSITIVE_INFINITY, is_shadowed: node_id === 4,
}));
editor.reconcile({
  type: 'COMMAND_RESULT', command_type: 'OBSTACLES_REPLACE', request_id: 'obstacles-accepted',
  accepted: true, spatial_locked: false, obstacle_set: acceptedSet, obstruction_state: acceptedSnapshot,
} as ObstacleCommandResult);
assert.equal(editor.pendingRequestId, null);
assert.deepEqual(editor.draft, editor.committed, 'accepted worker geometry replaces the draft and committed view');
assert.equal(editor.obstructionSnapshotIsCurrent, true);
assert.equal(editor.obstructionSnapshot.length, GROUND_NODE_IDS.length, 'complete worker node snapshot is accepted');
assert.equal(editor.obstructionSnapshot.find(item => item.node_id === 0)?.time_to_occlusion_s, Number.POSITIVE_INFINITY,
  'legitimate infinite prediction times from the worker are preserved');
acceptedSnapshot.find(item => item.node_id === 4)!.obstacle_intersections[0].penetrationM = 999;
assert.equal(editor.obstructionSnapshot.find(item => item.node_id === 4)!.obstacle_intersections[0].penetrationM, 12, 'snapshot getter and setter use defensive copies');
editor.markSimulationFrameAdvanced();
assert.equal(editor.obstructionSnapshotIsCurrent, false, 'new telemetry frame takes over current-time map state without changing frame KPIs here');

// Only the current pending request may reconcile worker state.
const gateEditor = new ObstacleEditorState();
const idA = gateEditor.create('cuboid', 10, 20);
const setA = gateEditor.beginApply('gate-A');
const snapshotA = acceptedSnapshot.map(item => item.node_id === 4 ? {
  ...item, obstacle_intersections: [{ obstacleId: idA, entryFraction: 0.2, exitFraction: 0.4, penetrationM: 3 }],
} : { ...item, obstacle_intersections: [] });
const responseA: ObstacleCommandResult = {
  type: 'COMMAND_RESULT', command_type: 'OBSTACLES_REPLACE', request_id: 'gate-A', accepted: true,
  spatial_locked: false, obstacle_set: [...setA], obstruction_state: snapshotA,
};
gateEditor.reconcile(responseA);
gateEditor.move(idA, 30, 40);
const idB = gateEditor.create('cone', 50, 60);
const setB = gateEditor.beginApply('gate-B');
gateEditor.select(idA);
const gateSnapshot = () => JSON.stringify({
  committed: gateEditor.committed, draft: gateEditor.draft, obstruction: gateEditor.obstructionSnapshot,
  obstructionCurrent: gateEditor.obstructionSnapshotIsCurrent, pending: gateEditor.pendingRequestId,
  selection: gateEditor.selectedId, message: gateEditor.message, locked: gateEditor.spatialLocked,
});
gateEditor.setSpatialLock(true);
const unchangedDuringB = gateSnapshot();
const setC: Obstacle[] = [{ id: 'response-C', shape: 'pyramid', xM: 0, yM: 0, widthM: 25, depthM: 35, heightM: 45, rotationDeg: 20 }];
gateEditor.reconcile({ ...responseA, request_id: 'different-request', obstacle_set: setC });
assert.equal(gateSnapshot(), unchangedDuringB, 'different request ID preserves committed, draft, snapshot, pending, selection, and message');
gateEditor.reconcile({ ...responseA, command_type: 'CONFIG_UPDATE', request_id: 'gate-B', obstacle_set: setC });
assert.equal(gateSnapshot(), unchangedDuringB, 'unrelated command type preserves all editor state');
gateEditor.reconcile({ ...responseA, request_id: 'gate-A', obstacle_set: setC });
assert.equal(gateSnapshot(), unchangedDuringB, 'stale A response cannot overwrite a newer pending B Apply');
const snapshotB = snapshotA.map(item => ({ ...item, obstacle_blocked: false, is_shadowed: false, obstacle_intersections: [] }));
gateEditor.reconcile({
  type: 'COMMAND_RESULT', command_type: 'OBSTACLES_REPLACE', request_id: 'gate-B', accepted: true,
  spatial_locked: false, obstacle_set: setB, obstruction_state: snapshotB,
});
assert.equal(gateEditor.pendingRequestId, null);
assert.deepEqual(gateEditor.committed, setB, 'matching accepted response reconciles state B');
assert.deepEqual(gateEditor.draft, setB);
assert.equal(gateEditor.selectedId, idA, 'matching reconciliation preserves a still-present selection');
assert.deepEqual(gateEditor.obstructionSnapshot, snapshotB);
assert.match(gateEditor.message, /committed/);
gateEditor.move(idB, 70, 80);
gateEditor.beginApply('gate-D');
gateEditor.reconcile({
  type: 'COMMAND_RESULT', command_type: 'OBSTACLES_REPLACE', request_id: 'gate-D', accepted: false,
  reason: 'validation rejected', spatial_locked: false, obstacle_set: setB, obstruction_state: snapshotB,
});
assert.equal(gateEditor.pendingRequestId, null);
assert.deepEqual(gateEditor.committed, setB);
assert.deepEqual(gateEditor.draft, setB, 'matching rejected response restores worker-confirmed state');
assert.match(gateEditor.message, /validation rejected/);

// Exercise the same result router used by the Canvas worker handler. Cross-command
// request-ID collisions must not route a result into the wrong editor.
const routedCalls: string[] = [];
const routingHandlers = (pendingObstacleRequestId: string | null, pendingTrajectoryRequestId: string | null) => ({
  pendingObstacleRequestId,
  pendingTrajectoryRequestId,
  reconcileObstacle: (_result: RoutedCommandResult) => { routedCalls.push('obstacle'); return true; },
  reconcileTrajectory: (_result: RoutedCommandResult) => { routedCalls.push('trajectory'); },
  updateSpatialLock: (_locked: boolean) => { routedCalls.push('lock'); },
  setWorkerLabel: (_label: string) => { routedCalls.push('label'); },
});
routeCommandResult({
  type: 'COMMAND_RESULT', command_type: 'OBSTACLES_REPLACE', request_id: 'shared-id',
  accepted: false, reason: 'stale obstacle response', spatial_locked: true,
}, routingHandlers('current-obstacles', 'shared-id'));
assert.deepEqual(routedCalls, [], 'unmatched obstacle result cannot affect a colliding pending trajectory request or any other UI state');

routedCalls.length = 0;
routeCommandResult({
  type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'shared-id',
  accepted: true, spatial_locked: false,
}, routingHandlers('shared-id', null));
assert.deepEqual(routedCalls, ['lock'], 'CONFIG_UPDATE with obstacle request ID cannot reconcile obstacle state');

routedCalls.length = 0;
routeCommandResult({
  type: 'COMMAND_RESULT', command_type: 'OBSTACLES_REPLACE', request_id: 'shared-id',
  accepted: true, spatial_locked: false,
}, routingHandlers('shared-id', 'shared-id'));
assert.deepEqual(routedCalls, ['obstacle', 'lock'], 'matching obstacle response reconciles obstacles without also completing trajectory');

routedCalls.length = 0;
routeCommandResult({
  type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'shared-id',
  accepted: true, spatial_locked: false, trajectory_config: {
    trajectory_mode: 'ellipse', center_x_m: 100, center_y_m: 200,
    orbit_a_m: 20000, orbit_b_m: 10000, orbit_rotation_deg: 35, waypoints: [],
  },
}, routingHandlers(null, 'shared-id'));
assert.deepEqual(routedCalls, ['lock', 'trajectory'], 'matching trajectory response still completes the trajectory request');

// Matching trajectory responses are fully validated before any lock/editor/status callback.
const trajectoryRoutingEditor = new TrajectoryEditorState();
trajectoryRoutingEditor.editEllipse({ centerXm: 1234 });
let trajectoryPending: string | null = 'trajectory-validation';
let trajectoryLocked = true;
let trajectoryStatus = 'waiting';
const trajectoryRouteHandlers = () => ({
  pendingObstacleRequestId: null,
  pendingTrajectoryRequestId: trajectoryPending,
  reconcileObstacle: (_result: RoutedCommandResult) => false,
  reconcileTrajectory: (result: RoutedCommandResult) => {
    if (result.accepted === false) {
      trajectoryPending = null;
      trajectoryRoutingEditor.cancel();
      trajectoryStatus = `rejected: ${result.reason}`;
    } else {
      trajectoryRoutingEditor.syncCommitted(result.trajectory_config, true);
      trajectoryPending = null;
      trajectoryStatus = 'committed';
    }
  },
  updateSpatialLock: (locked: boolean) => { trajectoryLocked = locked; },
  setWorkerLabel: (_label: string) => {},
});
const validEllipseConfig = {
  trajectory_mode: 'ellipse', center_x_m: 100, center_y_m: 200,
  orbit_a_m: 20000, orbit_b_m: 10000, orbit_rotation_deg: 35, waypoints: [],
};
const trajectoryStateSnapshot = () => JSON.stringify({
  locked: trajectoryLocked, pending: trajectoryPending, status: trajectoryStatus,
  draft: trajectoryRoutingEditor.preview, committed: trajectoryRoutingEditor.committedActive,
});
const beforeInvalidTrajectoryResults = trajectoryStateSnapshot();
const invalidTrajectoryResponses: RoutedCommandResult[] = [
  { type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation', spatial_locked: false },
  { type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation', accepted: 'yes' as unknown as boolean, spatial_locked: false },
  { type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation', accepted: true, spatial_locked: false },
  { type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation', accepted: true, spatial_locked: false, trajectory_config: { ...validEllipseConfig, orbit_a_m: Number.NaN } },
  { type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation', accepted: true, spatial_locked: false, trajectory_config: { trajectory_mode: 'waypoints', waypoints: [{ x_m: 0, y_m: 0 }, { x_m: 10, y_m: 0 }] } },
  { type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation', accepted: true, spatial_locked: false, trajectory_config: { ...validEllipseConfig, waypoints: [{ x_m: 0, y_m: 0 }] } },
  { type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation', accepted: true, spatial_locked: false, trajectory_config: { ...validEllipseConfig, waypoints: [{ x_m: 0, y_m: 0 }, { x_m: 10, y_m: 0 }] } },
  { type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation', accepted: true, spatial_locked: false, trajectory_config: { ...validEllipseConfig, waypoints: [{ x_m: 0, y_m: 0 }, { x_m: 10, y_m: 0 }, { x_m: 20, y_m: 0 }] } },
  { type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation', accepted: true, spatial_locked: false, trajectory_config: { ...validEllipseConfig, waypoints: [{ x_m: 0, y_m: 0 }, { x_m: 10, y_m: 0 }, { x_m: 0, y_m: 0 }] } },
  { type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation', accepted: false, spatial_locked: false },
  { type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation', accepted: false, spatial_locked: false, reason: '   ' },
];
for (const missingField of ['center_x_m', 'center_y_m', 'orbit_a_m', 'orbit_b_m', 'orbit_rotation_deg', 'waypoints']) {
  const incomplete = { ...validEllipseConfig } as Record<string, unknown>;
  delete incomplete[missingField];
  invalidTrajectoryResponses.push({
    type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation',
    accepted: true, spatial_locked: false, trajectory_config: incomplete,
  });
}
for (const response of invalidTrajectoryResponses) {
  routeCommandResult(response, trajectoryRouteHandlers());
  assert.equal(trajectoryStateSnapshot(), beforeInvalidTrajectoryResults, 'malformed matching trajectory result leaves lock, draft, committed state, pending ID, and status unchanged');
}
routeCommandResult({
  type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-validation',
  accepted: true, spatial_locked: false, trajectory_config: validEllipseConfig,
}, trajectoryRouteHandlers());
assert.equal(trajectoryLocked, false);
assert.equal(trajectoryPending, null);
assert.equal(trajectoryStatus, 'committed');
assert.equal((trajectoryRoutingEditor.committedActive as any).centerXm, 100, 'valid accepted response synchronizes worker trajectory config');

trajectoryPending = 'trajectory-retained-waypoints';
const retainedRoute = [{ x_m: 0, y_m: 0 }, { x_m: 100, y_m: 0 }, { x_m: 0, y_m: 100 }];
routeCommandResult({
  type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-retained-waypoints',
  accepted: true, spatial_locked: false, trajectory_config: { ...validEllipseConfig, waypoints: retainedRoute },
}, trajectoryRouteHandlers());
assert.equal(trajectoryPending, null, 'ellipse accepts a valid retained waypoint route');

trajectoryPending = 'trajectory-waypoints';
trajectoryRoutingEditor.setMode('waypoints');
const validWaypointsConfig = {
  ...validEllipseConfig, trajectory_mode: 'waypoints',
  waypoints: retainedRoute,
};
routeCommandResult({
  type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-waypoints',
  accepted: true, spatial_locked: false, trajectory_config: validWaypointsConfig,
}, trajectoryRouteHandlers());
assert.equal(trajectoryPending, null);
assert.equal((trajectoryRoutingEditor.committedActive as any).points.length, 3, 'valid complete waypoint response synchronizes the closed route');

trajectoryPending = 'trajectory-malformed-waypoints';
const beforeMalformedWaypoint = trajectoryStateSnapshot();
for (const malformedWaypointConfig of [
  { ...validWaypointsConfig, center_x_m: undefined },
  { ...validWaypointsConfig, waypoints: [{ x_m: 0, y_m: 0 }, { x_m: '100', y_m: 0 }, { x_m: 0, y_m: 100 }] },
]) {
  routeCommandResult({
    type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-malformed-waypoints',
    accepted: true, spatial_locked: true, trajectory_config: malformedWaypointConfig,
  }, trajectoryRouteHandlers());
  assert.equal(trajectoryStateSnapshot(), beforeMalformedWaypoint, 'malformed waypoint response leaves all trajectory state unchanged');
}

trajectoryPending = 'trajectory-rejected';
trajectoryLocked = true;
trajectoryStatus = 'waiting';
routeCommandResult({
  type: 'COMMAND_RESULT', command_type: 'CONFIG_UPDATE', request_id: 'trajectory-rejected',
  accepted: false, reason: 'Worker rejected invalid path.', spatial_locked: true,
}, trajectoryRouteHandlers());
assert.equal(trajectoryPending, null);
assert.equal(trajectoryLocked, true);
assert.equal(trajectoryStatus, 'rejected: Worker rejected invalid path.');

// A malformed obstruction entry rejects the entire matching replacement before commit.
const snapshotValidationEditor = new ObstacleEditorState();
const snapshotObstacleId = snapshotValidationEditor.create('cuboid', 1, 2);
const snapshotInitialSet = snapshotValidationEditor.beginApply('snapshot-A');
snapshotValidationEditor.reconcile({
  type: 'COMMAND_RESULT', command_type: 'OBSTACLES_REPLACE', request_id: 'snapshot-A', accepted: true,
  spatial_locked: false, obstacle_set: snapshotInitialSet, obstruction_state: acceptedSnapshot,
} as ObstacleCommandResult);
snapshotValidationEditor.move(snapshotObstacleId, 3, 4);
const changedObstacleId = snapshotValidationEditor.create('cone', 5, 6);
const snapshotProposedSet = snapshotValidationEditor.beginApply('snapshot-B');
const beforeBadSnapshot = JSON.stringify({
  committed: snapshotValidationEditor.committed, draft: snapshotValidationEditor.draft,
  snapshot: snapshotValidationEditor.obstructionSnapshot, current: snapshotValidationEditor.obstructionSnapshotIsCurrent,
  pending: snapshotValidationEditor.pendingRequestId, selected: snapshotValidationEditor.selectedId,
  message: snapshotValidationEditor.message, locked: snapshotValidationEditor.spatialLocked,
});
const withNode4Patch = (patch: Record<string, unknown>) => acceptedSnapshot.map(item => item.node_id === 4 ? { ...item, ...patch } : { ...item });
const duplicateSnapshot = acceptedSnapshot.map(item => ({ ...item }));
duplicateSnapshot[1] = { ...duplicateSnapshot[1], node_id: duplicateSnapshot[0].node_id };
const unexpectedSnapshot = acceptedSnapshot.map((item, index) => index === 0 ? { ...item, node_id: 999 } : { ...item });
for (const malformedSnapshot of [
  [],
  duplicateSnapshot,
  unexpectedSnapshot,
  acceptedSnapshot.slice(1),
  withNode4Patch({ bitrate_bps: 'fast' }),
  withNode4Patch({ predicted_state: 'UNKNOWN_STATE' }),
  withNode4Patch({ obstacle_intersections: [{ obstacleId: snapshotObstacleId, entryFraction: 0.8, exitFraction: 0.2, penetrationM: 2 }] }),
  withNode4Patch({ is_shadowed: 1 }),
]) {
  const reconciled = snapshotValidationEditor.reconcile({
    type: 'COMMAND_RESULT', command_type: 'OBSTACLES_REPLACE', request_id: 'snapshot-B', accepted: true,
    spatial_locked: true, obstacle_set: [{ ...snapshotProposedSet[0], xM: 99 }], obstruction_state: malformedSnapshot,
  } as unknown as ObstacleCommandResult);
  assert.equal(reconciled, false);
  assert.equal(JSON.stringify({
    committed: snapshotValidationEditor.committed, draft: snapshotValidationEditor.draft,
    snapshot: snapshotValidationEditor.obstructionSnapshot, current: snapshotValidationEditor.obstructionSnapshotIsCurrent,
    pending: snapshotValidationEditor.pendingRequestId, selected: snapshotValidationEditor.selectedId,
    message: snapshotValidationEditor.message, locked: snapshotValidationEditor.spatialLocked,
  }), beforeBadSnapshot, 'malformed obstruction state rejects atomically without committing geometry');
}
assert.ok(snapshotValidationEditor.draft.some(item => item.id === changedObstacleId));

editor.move(cuboidId, 125, 225);
editor.beginApply('obstacles-rejected');
editor.reconcile({
  type: 'COMMAND_RESULT', command_type: 'OBSTACLES_REPLACE', request_id: 'obstacles-rejected',
  accepted: false, reason: 'Spatial lock is enabled; spatial state was not changed.', spatial_locked: true,
  obstacle_set: acceptedSet, obstruction_state: acceptedSnapshot,
} as ObstacleCommandResult);
assert.equal(editor.spatialLocked, true);
assert.deepEqual(editor.draft, editor.committed, 'rejection restores worker-confirmed geometry');
assert.match(editor.message, /Worker rejected/);
assert.throws(() => editor.create('cone', 0, 0), /Spatial lock/);
assert.equal(editor.dirty, false, 'locking preserves draft without silently changing it');
editor.setSpatialLock(false);
editor.move(cuboidId, 130, 230);
editor.cancel();
assert.deepEqual(editor.draft, editor.committed, 'Cancel restores the last worker-confirmed set');

// Actual worker rejection after a lock transition reconciles the pending draft from its response.
const lockEditor = new ObstacleEditorState();
const pendingId = lockEditor.create('cone', 500, 600);
const readOnlyDraft = lockEditor.draft;
const pendingSet = lockEditor.beginApply('lock-race');
lockEditor.setSpatialLock(true);
assert.deepEqual(lockEditor.draft, readOnlyDraft, 'lock preserves the draft as a read-only preview while Apply is pending');
assert.throws(() => lockEditor.move(pendingId, 0, 0), /Spatial lock/);
lockEditor.select(pendingId);
assert.equal(lockEditor.selectedId, pendingId, 'selection remains available while locked');
const lockedWorker = new SimulationWorkerManager(33);
const lockResult = lockedWorker.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: true });
lockEditor.setSpatialLock(lockResult.spatial_locked);
const rejected = lockedWorker.handleMessage({ type: 'OBSTACLES_REPLACE', request_id: 'lock-race', obstacles: pendingSet });
lockEditor.reconcile(rejected as ObstacleCommandResult);
assert.equal(rejected.accepted, false);
assert.deepEqual(lockEditor.draft, [], 'pending lock rejection adopts the worker committed set');
assert.equal(lockEditor.spatialLocked, true);

// Hit policy matches Canvas: nodes first, then the explicit obstacle tool, then waypoints; empty clicks pan.
assert.equal(resolveSpatialCanvasTarget(4, 2, 1, 'select', true), 'node');
assert.equal(resolveSpatialCanvasTarget(30, 4, 3, 'select', true), 'obstacle');
assert.equal(resolveSpatialCanvasTarget(30, 4, 3, 'navigate', true), 'waypoint');
assert.equal(resolveSpatialCanvasTarget(30, 4, 3, 'navigate', false), null, 'empty map continues to pan');
assert.equal(resolveSpatialCanvasTarget(30, 4, 30, 'place', true), null, 'obstacle mode does not ambiguously select a waypoint');

const shapeField = new ObstacleField();
shapeField.replace([{ id: 'cone', shape: 'cone', xM: 10, yM: -20, radiusM: 12, heightM: 40 }]);
const cone = shapeField.all[0];
assert.equal(obstacleContainsPoint(cone, 10, -20), true);
assert.equal(obstacleContainsPoint(cone, 22.1, -20), false);
assert.equal(obstacleFootprintPoints(cone).length, 48, 'Canvas boundary sampling uses the core footprint helper');
const rotated: Obstacle = { id: 'rotated', shape: 'cuboid', xM: 0, yM: 0, widthM: 20, depthM: 10, heightM: 5, rotationDeg: 90 };
assert.equal(obstacleContainsPoint(rotated, 0, 9), true);
assert.equal(obstacleContainsPoint(rotated, 9, 0), false);

// Obstacle commit refreshes authoritative link/shadow state without advancing frame KPIs.
const worker = new SimulationWorkerManager(41);
const flatTerrain = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 0 });
worker.terrainEngine = flatTerrain;
worker.lookaheadEngine = new PredictiveLookAheadEngine(flatTerrain, worker.linkEngine, worker.rfConfig, worker.envConfig, worker.flightConfig, worker.trajectoryEngine);
worker.nodesTac[4].position = [12000, 8000, 2]; worker.nodesStatic[4].position = [12000, 8000, 2];
const clear = worker.handleMessage({ type: 'OBSTACLES_REPLACE', obstacles: [] });
assert.equal(clear.accepted, true);
assert.equal(worker.obstructionResults.get(4)?.obstacleBlocked, false);
const timeBefore = worker.simTimeS, frameBefore = worker.frameIndex, metricsBefore = JSON.stringify(worker.metrics);
const acn = worker.trajectoryEngine.getAcnPosition(timeBefore);
const blocked = worker.handleMessage({ type: 'OBSTACLES_REPLACE', request_id: 'editor-block', obstacles: [{
  id: 'editor-blocker', shape: 'cuboid', xM: (12000 + acn[0]) / 2, yM: (8000 + acn[1]) / 2,
  widthM: 4000, depthM: 4000, heightM: 5000, rotationDeg: 0,
}] });
assert.equal(blocked.accepted, true);
assert.equal(blocked.obstruction_state?.find(state => state.node_id === 4)?.obstacle_blocked, true);
assert.equal(blocked.obstruction_state?.find(state => state.node_id === 4)?.is_shadowed, true);
assert.equal(worker.linkStatuses.get(4)?.obstacleBlocked, true);
assert.equal(worker.nodesTac[4].isShadowed, true);
assert.equal(worker.simTimeS, timeBefore);
assert.equal(worker.frameIndex, frameBefore);
assert.equal(JSON.stringify(worker.metrics), metricsBefore, 'refresh does not change scheduler or frame-based KPIs');

console.log('PASS obstacle editor draft state, authoritative reconciliation, spatial lock, hit priority, and worker refresh flow');
