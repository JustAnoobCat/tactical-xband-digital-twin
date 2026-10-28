import assert from 'node:assert/strict';
import { MAX_ACN_WAYPOINTS } from '../core/config';
import { SimulationWorkerManager } from '../worker/simWorker';
import { canvasPointerTarget, parseEditorNumber, TrajectoryEditorState } from '../ui/trajectoryEditorState';

const editor = new TrajectoryEditorState();
editor.syncCommitted({ trajectory_mode: 'ellipse', center_x_m: 10, center_y_m: 20, orbit_a_m: 2000, orbit_b_m: 1000, orbit_rotation_deg: 25 });
editor.editEllipse({ radiusAM: 3000 });
assert.equal(editor.dirty, true);
editor.setMode('waypoints');
assert.equal(editor.validatePreview(), 'Add at least three waypoints to close the route.');
editor.addWaypoint({ xM: 0, yM: 0 });
editor.addWaypoint({ xM: 1000, yM: 0 });
editor.addWaypoint({ xM: 0, yM: 1000 });
editor.addWaypoint({ xM: 1000, yM: 1000 });
assert.equal(editor.validatePreview(), null);
editor.moveWaypoint(1, { xM: 1200, yM: 25 });
assert.deepEqual(editor.preview.mode === 'waypoints' ? editor.preview.points[1] : null, { xM: 1200, yM: 25 });
editor.selectWaypoint(1);
editor.removeSelectedWaypoint();
assert.equal((editor.preview as any).points.length, 3);
assert.throws(() => editor.removeSelectedWaypoint(), /at least three/);
editor.cancel();
assert.equal((editor.preview as any).points.length, 0, 'cancel restores last committed waypoint route');
editor.setMode('ellipse');
assert.equal((editor.preview as any).radiusAM, 3000, 'mode switching preserves the uncommitted ellipse draft');
editor.cancel();
assert.equal((editor.preview as any).radiusAM, 2000, 'cancel restores the last committed ellipse values');
editor.editEllipse({ centerXm: 600001 });
assert.match(editor.validatePreview() || '', /center/);
for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  editor.editEllipse({ radiusAM: value });
  assert.match(editor.validatePreview() || '', /finite/);
}
editor.editEllipse({ centerXm: 10, centerYm: 20, radiusAM: -1 });
assert.match(editor.validatePreview() || '', /axes/);
assert.ok(Number.isNaN(parseEditorNumber('')));
assert.ok(Number.isNaN(parseEditorNumber('NaN')));
assert.equal(parseEditorNumber('Infinity'), Number.POSITIVE_INFINITY);
assert.equal(canvasPointerTarget(8, 3), 'node', 'a ground node wins when both hit targets overlap');
assert.equal(canvasPointerTarget(17, 3), 'waypoint', 'waypoints remain selectable outside the node hit target');
assert.equal(canvasPointerTarget(17, 13), null, 'empty map hit continues to pan');

const modeState = new TrajectoryEditorState();
modeState.syncCommitted({ trajectory_mode: 'waypoints', waypoints: [
  { x_m: 0, y_m: 0 }, { x_m: 500, y_m: 0 }, { x_m: 0, y_m: 500 },
] });
modeState.setMode('waypoints');
assert.equal((modeState.preview as any).points.length, 3, 'worker waypoint configuration is retained while ellipse mode is displayed');
modeState.setInputError('Waypoint coordinates must be finite numbers.');
assert.match(modeState.validatePreview() || '', /finite/, 'invalid visible waypoint input blocks Apply');
assert.throws(() => modeState.moveWaypoint(1, { xM: Number.NaN, yM: 0 }), /finite/);
assert.equal((modeState.preview as any).points[1].xM, 500, 'invalid drag leaves the draft point unchanged');
modeState.moveWaypoint(1, { xM: 600, yM: 0 });
modeState.setMode('ellipse');
modeState.editEllipse({ radiusAM: 25000 });
modeState.setMode('waypoints');
assert.equal((modeState.preview as any).points[1].xM, 600, 'switching modes preserves the waypoint draft');
modeState.setMode('ellipse');
assert.equal((modeState.preview as any).radiusAM, 25000, 'switching modes preserves the ellipse draft');

editor.setMode('waypoints');
for (let i = 0; i < MAX_ACN_WAYPOINTS; i++) editor.addWaypoint({ xM: i * 100, yM: (i % 2) * 100 });
assert.equal((editor.preview as any).points.length, MAX_ACN_WAYPOINTS);
assert.throws(() => editor.addWaypoint({ xM: 0, yM: 0 }), /Maximum/);
editor.cancel();

const worker = new SimulationWorkerManager();
const initialFlight = worker.flightConfig;
for (const orbit_a_m of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '']) {
  assert.equal(worker.handleMessage({ type: 'CONFIG_UPDATE', params: { orbit_a_m } }).accepted, false,
    'worker rejects invalid numeric ellipse values');
}
assert.equal(worker.flightConfig, initialFlight, 'invalid ellipse values preserve the last valid worker trajectory');
const waypoints = [{ x_m: 0, y_m: 0 }, { x_m: 10000, y_m: 0 }, { x_m: 0, y_m: 10000 }];
worker.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: true });
assert.equal(worker.handleMessage({ type: 'CONFIG_UPDATE', params: { trajectory_mode: 'waypoints', waypoints } }).accepted, false,
  'worker rejects a direct trajectory mutation while locked');
worker.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: false });
const accepted = worker.handleMessage({ type: 'CONFIG_UPDATE', request_id: 'editor-test', params: { trajectory_mode: 'waypoints', waypoints } });
assert.equal(accepted.accepted, true);
assert.equal(accepted.request_id, 'editor-test');
assert.deepEqual(accepted.trajectory_config?.waypoints, waypoints, 'worker acknowledges the authoritative committed route');
const committedTrajectory = worker.trajectoryEngine;
assert.equal(worker.handleMessage({ type: 'CONFIG_UPDATE', params: { trajectory_mode: 'waypoints', waypoints: [
  { x_m: 0, y_m: 0 }, { x_m: 100, y_m: 100 }, { x_m: 0, y_m: 0 },
] } }).accepted, false, 'degenerate route update is rejected');
assert.equal(worker.trajectoryEngine, committedTrajectory, 'rejected route leaves the committed trajectory intact');
assert.equal(worker.handleMessage({ type: 'CONFIG_UPDATE', params: { trajectory_mode: 'waypoints', waypoints: Array.from({ length: MAX_ACN_WAYPOINTS + 1 }, (_, i) => ({ x_m: i * 1000, y_m: (i % 2) * 1000 })) } }).accepted, false,
  'worker enforces maximum waypoint count independently of the UI');
const frame = (worker as any).buildTelemetryFrame(worker.trajectoryEngine.getAcnPosition(worker.simTimeS));
assert.deepEqual(frame.trajectory_config.waypoints, waypoints, 'worker telemetry exposes committed route configuration');
assert.deepEqual(frame.acn_telemetry.flight_path, worker.trajectoryEngine.getPathPoints(64),
  'rendered worker path samples the same committed trajectory instance');

console.log(`PASS trajectory editor state, 3..${MAX_ACN_WAYPOINTS} count bounds, worker lock, and committed route telemetry`);
