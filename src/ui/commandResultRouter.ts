import { MAX_ACN_WAYPOINTS } from '../core/config';
import { validateClosedWaypointPath } from '../core/waypoints';
import type { WorkerCommandResult } from '../shared/workerProtocol';
import { isFiniteNumber } from '../shared/utils';

export interface RoutedCommandResult {
  readonly type: string;
  readonly command_type: string;
  readonly request_id?: string | number;
  readonly accepted?: boolean;
  readonly reason?: string;
  readonly spatial_locked?: boolean;
  readonly trajectory_config?: WorkerCommandResult['trajectory_config'] | unknown;
}

export interface CommandResultHandlers {
  readonly pendingObstacleRequestId: string | null;
  readonly pendingTrajectoryRequestId: string | null;
  /** Return true only when the obstacle editor accepted this response. */
  readonly reconcileObstacle: (result: RoutedCommandResult) => boolean;
  readonly reconcileTrajectory: (result: RoutedCommandResult) => void;
  readonly updateSpatialLock: (locked: boolean) => void;
  readonly setWorkerLabel: (label: string) => void;
}

const WORKER_COMMANDS = new Set([
  'OBSTACLES_REPLACE', 'CONFIG_UPDATE', 'SET_SPATIAL_LOCK', 'SIM_CONTROL', 'SET_SPEED',
  'LOAD_PRESET', 'SET_SCHEDULER', 'SELECT_NODE', 'INJECT_TRAFFIC', 'CLEAR_TRANSFER',
  'SET_TERRAIN_MODE', 'NODE_MOVE', 'GET_HILLSHADE',
]);

function isValidTrajectoryConfig(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  if (config.trajectory_mode !== 'ellipse' && config.trajectory_mode !== 'waypoints') return false;
  if (!isFiniteNumber(config.center_x_m) || Math.abs(config.center_x_m) > 600000 ||
      !isFiniteNumber(config.center_y_m) || Math.abs(config.center_y_m) > 600000 ||
      !isFiniteNumber(config.orbit_a_m) || config.orbit_a_m <= 0 || config.orbit_a_m > 600000 ||
      !isFiniteNumber(config.orbit_b_m) || config.orbit_b_m <= 0 || config.orbit_b_m > 600000 ||
      !isFiniteNumber(config.orbit_rotation_deg) || Math.abs(config.orbit_rotation_deg) > 360 ||
      !Array.isArray(config.waypoints) || config.waypoints.length > MAX_ACN_WAYPOINTS) return false;
  const points: { x: number; y: number; z?: number }[] = [];
  for (const item of config.waypoints) {
    if (!item || typeof item !== 'object') return false;
    const point = item as Record<string, unknown>;
    const xCandidate = point.x_m ?? point.xM;
    const yCandidate = point.y_m ?? point.yM;
    if (!isFiniteNumber(xCandidate) || Math.abs(xCandidate) > 600000 ||
        !isFiniteNumber(yCandidate) || Math.abs(yCandidate) > 600000) return false;
    const zCandidate = point.z_m ?? point.zM;
    const zM = isFiniteNumber(zCandidate) ? zCandidate : undefined;
    if (zM !== undefined && (zM < 0 || zM > 100000)) return false;
    points.push({ x: xCandidate, y: yCandidate, ...(zM !== undefined ? { z: zM } : {}) });
  }
  if (points.length > 0) {
    try { validateClosedWaypointPath(points.map(point => ({ xM: point.x, yM: point.y, ...(point.z !== undefined ? { zM: point.z } : {}) }))); }
    catch (_) { return false; }
  }
  if (config.trajectory_mode === 'waypoints' && points.length === 0) return false;
  return true;
}

function hasValidTrajectoryResponse(result: RoutedCommandResult): boolean {
  if (typeof result.accepted !== 'boolean' || typeof result.spatial_locked !== 'boolean') return false;
  if (result.accepted) return isValidTrajectoryConfig(result.trajectory_config);
  return typeof result.reason === 'string' && result.reason.trim().length > 0;
}

/** Route worker results by command before considering request IDs. */
export function routeCommandResult(result: RoutedCommandResult, handlers: CommandResultHandlers): void {
  if (!result || result.type !== 'COMMAND_RESULT' || !WORKER_COMMANDS.has(result.command_type)) return;

  if (result.command_type === 'OBSTACLES_REPLACE') {
    // An obstacle response has no side effects unless it completes the exact
    // pending obstacle request. In particular, its ID cannot complete a path edit.
    if (handlers.pendingObstacleRequestId === null ||
        typeof result.request_id !== 'string' ||
        result.request_id !== handlers.pendingObstacleRequestId) return;
    if (!handlers.reconcileObstacle(result)) return;
    if (typeof result.spatial_locked === 'boolean') handlers.updateSpatialLock(result.spatial_locked);
    if (result.accepted === false) handlers.setWorkerLabel(`Worker rejected ${result.command_type}: ${result.reason || ''}`);
    return;
  }

  if (result.command_type === 'CONFIG_UPDATE') {
    const completesTrajectory = handlers.pendingTrajectoryRequestId !== null &&
      result.request_id === handlers.pendingTrajectoryRequestId;
    // Validate a matching path response in full before lock, editor, pending, or
    // status callbacks can observe it. Other config updates retain their normal path.
    if (completesTrajectory && !hasValidTrajectoryResponse(result)) return;
    if (typeof result.spatial_locked === 'boolean') handlers.updateSpatialLock(result.spatial_locked);
    if (completesTrajectory) handlers.reconcileTrajectory(result);
  } else if (result.command_type === 'SET_SPATIAL_LOCK') {
    if (typeof result.spatial_locked === 'boolean') handlers.updateSpatialLock(result.spatial_locked);
  } else if (typeof result.spatial_locked === 'boolean') {
    handlers.updateSpatialLock(result.spatial_locked);
  }

  if (result.accepted === false) handlers.setWorkerLabel(`Worker rejected ${result.command_type}: ${result.reason || ''}`);
  else if (result.command_type === 'SET_SPATIAL_LOCK') handlers.setWorkerLabel('Worker 50 Hz');
}
