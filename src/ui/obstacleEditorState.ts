import {
  MAX_OBSTACLES, MAX_OBSTACLE_DIMENSION_M, MAX_OBSTACLE_HEIGHT_M, MIN_OBSTACLE_DIMENSION_M,
  OBSTACLE_WORLD_LIMIT_M, Obstacle, normalizeObstacle,
} from '../core/obstacles';
import { GROUND_NODE_IDS } from '../core/config';

export type ObstacleMapMode = 'navigate' | 'select' | 'place';
export interface ObstructionSnapshot {
  readonly node_id: number;
  readonly terrain_is_los: boolean;
  readonly obstacle_blocked: boolean;
  readonly obstacle_intersections: readonly { readonly obstacleId: string; readonly entryFraction: number; readonly exitFraction: number; readonly penetrationM: number }[];
  readonly link_outage: boolean;
  readonly bitrate_bps: number;
  readonly modcod_name: string;
  readonly predicted_state: string;
  readonly time_to_occlusion_s: number;
  readonly time_to_emergence_s: number;
  readonly is_shadowed: boolean;
}
export interface ObstacleCommandResult {
  readonly type: 'COMMAND_RESULT';
  readonly command_type: string;
  readonly request_id?: string | number;
  readonly accepted: boolean;
  readonly reason?: string;
  readonly spatial_locked: boolean;
  readonly obstacle_set?: readonly Obstacle[];
  readonly obstruction_state?: readonly ObstructionSnapshot[];
}

const cloneObstacle = (o: Obstacle): Obstacle => ({ ...o });
const cloneSet = (items: readonly Obstacle[]): Obstacle[] => items.map(cloneObstacle);
const cloneSnapshot = (items: readonly ObstructionSnapshot[]): ObstructionSnapshot[] => items.map(item => ({
  ...item, obstacle_intersections: item.obstacle_intersections.map(hit => ({ ...hit })),
}));
const isNumber = (value: unknown): value is number => typeof value === 'number' && !Number.isNaN(value);
const PREDICTION_STATES = new Set([
  'NORMAL_LOS', 'PRE_OCCLUSION_FLUSH', 'HARD_SHADOW_CUTOFF', 'RE_EMERGENCE_BURST',
]);

function isValidObstructionSnapshot(value: unknown): value is readonly ObstructionSnapshot[] {
  if (!Array.isArray(value) || value.length !== GROUND_NODE_IDS.length) return false;
  const seenIds = new Set<number>();
  const entriesValid = value.every((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Record<string, unknown>;
    if (!Number.isInteger(item.node_id) || !GROUND_NODE_IDS.includes(item.node_id as number) ||
        seenIds.has(item.node_id as number) ||
        typeof item.terrain_is_los !== 'boolean' || typeof item.obstacle_blocked !== 'boolean' ||
        !Array.isArray(item.obstacle_intersections) || typeof item.link_outage !== 'boolean' ||
        typeof item.bitrate_bps !== 'number' || !Number.isFinite(item.bitrate_bps) || item.bitrate_bps < 0 ||
        typeof item.modcod_name !== 'string' || item.modcod_name.length === 0 ||
        typeof item.predicted_state !== 'string' || !PREDICTION_STATES.has(item.predicted_state) ||
        !isNumber(item.time_to_occlusion_s) || item.time_to_occlusion_s < 0 ||
        !isNumber(item.time_to_emergence_s) || item.time_to_emergence_s < 0 ||
        typeof item.is_shadowed !== 'boolean') return false;
    const intersectionsValid = item.obstacle_intersections.every((rawHit: unknown) => {
      if (!rawHit || typeof rawHit !== 'object') return false;
      const hit = rawHit as Record<string, unknown>;
      return typeof hit.obstacleId === 'string' && hit.obstacleId.length > 0 &&
        typeof hit.entryFraction === 'number' && Number.isFinite(hit.entryFraction) && hit.entryFraction >= 0 && hit.entryFraction <= 1 &&
        typeof hit.exitFraction === 'number' && Number.isFinite(hit.exitFraction) && hit.exitFraction >= hit.entryFraction && hit.exitFraction <= 1 &&
        typeof hit.penetrationM === 'number' && Number.isFinite(hit.penetrationM) && hit.penetrationM >= 0;
    });
    if (intersectionsValid) seenIds.add(item.node_id as number);
    return intersectionsValid;
  });
  return entriesValid && seenIds.size === GROUND_NODE_IDS.length;
}

/** Shared spatial hit priority; node targets win, then the active spatial tool, then map pan. */
export function resolveSpatialCanvasTarget(
  nodeDistancePx: number,
  waypointDistancePx: number,
  obstacleDistancePx: number,
  obstacleMode: ObstacleMapMode,
  waypointActive: boolean,
  nodeRadiusPx = 16,
  editRadiusPx = 12,
): 'node' | 'obstacle' | 'waypoint' | null {
  if (nodeDistancePx <= nodeRadiusPx) return 'node';
  if (obstacleMode !== 'navigate') return obstacleDistancePx <= editRadiusPx ? 'obstacle' : null;
  if (waypointActive && waypointDistancePx <= editRadiusPx) return 'waypoint';
  return null;
}

/** UI state only: the worker remains authoritative for committed geometry and obstruction. */
export class ObstacleEditorState {
  private committedSet: Obstacle[] = [];
  private draftSet: Obstacle[] = [];
  private obstructionSet: ObstructionSnapshot[] = [];
  private selected: string | null = null;
  private pending: string | null = null;
  private locked = false;
  private obstructionIsCurrent = false;
  private idCounter = 0;
  public mode: ObstacleMapMode = 'navigate';
  public placementShape: Obstacle['shape'] = 'cuboid';
  public message = 'Obstacle edits are previews until applied.';

  public get committed(): readonly Obstacle[] { return cloneSet(this.committedSet); }
  public get draft(): readonly Obstacle[] { return cloneSet(this.draftSet); }
  public get selectedId(): string | null { return this.selected; }
  public get pendingRequestId(): string | null { return this.pending; }
  public get spatialLocked(): boolean { return this.locked; }
  public get obstructionSnapshot(): readonly ObstructionSnapshot[] { return cloneSnapshot(this.obstructionSet); }
  public get obstructionSnapshotIsCurrent(): boolean { return this.obstructionIsCurrent; }
  public get dirty(): boolean { return JSON.stringify(this.committedSet) !== JSON.stringify(this.draftSet); }
  public get selectedObstacle(): Obstacle | null {
    const obstacle = this.draftSet.find(o => o.id === this.selected);
    return obstacle ? cloneObstacle(obstacle) : null;
  }

  public setSpatialLock(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    this.message = locked ? 'Spatial lock is on. Draft is read-only until unlocked.' : 'Spatial lock is off.';
  }

  public setMode(mode: ObstacleMapMode): void { this.mode = mode; }
  public setPlacementShape(shape: Obstacle['shape']): void { this.placementShape = shape; }

  public select(id: string | null): void {
    this.selected = id !== null && this.draftSet.some(o => o.id === id) ? id : null;
  }

  public create(shape: Obstacle['shape'], xM: number, yM: number): string {
    this.assertEditable();
    if (this.draftSet.length >= MAX_OBSTACLES) throw new Error(`Obstacle set cannot exceed ${MAX_OBSTACLES} items.`);
    const id = this.nextId();
    const input = shape === 'cone'
      ? { id, shape, xM, yM, radiusM: 50, heightM: 50 }
      : { id, shape, xM, yM, widthM: 100, depthM: 100, heightM: 50, rotationDeg: 0 };
    const obstacle = normalizeObstacle(input);
    this.draftSet = [...this.draftSet, obstacle];
    this.selected = id;
    this.message = 'Obstacle added to draft. Apply to commit it.';
    return id;
  }

  public move(id: string, xM: number, yM: number): void {
    this.assertEditable();
    const obstacle = this.require(id);
    this.replaceDraft(id, { ...obstacle, xM, yM } as Obstacle);
  }

  public updateSelected(patch: Record<string, unknown>): void {
    this.assertEditable();
    if (!this.selected) throw new Error('Select an obstacle first.');
    this.require(this.selected);
    // Keep malformed in-progress numeric edits in the draft so Apply can report
    // the core validator's message without changing committed worker state.
    this.draftSet = this.draftSet.map(o => o.id === this.selected ? { ...o, ...patch } as Obstacle : o);
    try { this.validate(); this.message = 'Draft updated. Apply to commit it.'; }
    catch (error) { this.message = error instanceof Error ? error.message : 'Invalid obstacle.'; }
  }

  public deleteSelected(): void {
    this.assertEditable();
    if (!this.selected) throw new Error('Select an obstacle first.');
    this.draftSet = this.draftSet.filter(o => o.id !== this.selected);
    this.selected = this.draftSet.at(-1)?.id ?? null;
    this.message = 'Obstacle removed from draft. Apply to commit the removal.';
  }

  public validate(): string | null {
    try {
      if (this.draftSet.length > MAX_OBSTACLES) throw new Error(`Obstacle set cannot exceed ${MAX_OBSTACLES} items.`);
      const ids = new Set<string>();
      for (const item of this.draftSet) {
        const obstacle = normalizeObstacle(item);
        if (ids.has(obstacle.id)) throw new Error(`Duplicate obstacle id '${obstacle.id}'.`);
        ids.add(obstacle.id);
      }
      return null;
    } catch (error) { return error instanceof Error ? error.message : 'Invalid obstacle set.'; }
  }

  public beginApply(requestId: string): readonly Obstacle[] {
    this.assertEditable();
    if (this.pending) throw new Error('An obstacle update is already pending.');
    const error = this.validate();
    if (error) { this.message = error; throw new Error(error); }
    const normalized = this.draftSet.map(item => normalizeObstacle(item));
    this.pending = requestId;
    this.message = 'Applying obstacle set to simulation worker…';
    return cloneSet(normalized);
  }

  public reconcile(result: ObstacleCommandResult): boolean {
    // Apply responses are the only synchronization path. Ignore unsolicited,
    // stale, malformed, or unrelated results before touching any editor state.
    if (result.type !== 'COMMAND_RESULT' || result.command_type !== 'OBSTACLES_REPLACE') return false;
    if (this.pending === null || typeof result.request_id !== 'string' || result.request_id !== this.pending) return false;
    if (typeof result.accepted !== 'boolean' || typeof result.spatial_locked !== 'boolean' ||
        !Array.isArray(result.obstacle_set) || !isValidObstructionSnapshot(result.obstruction_state)) return false;

    // Stage copies and validation before committing the response, so malformed
    // response data cannot partially change the committed set or snapshot.
    let nextCommitted: Obstacle[];
    let nextObstruction: ObstructionSnapshot[];
    try {
      nextCommitted = result.obstacle_set.map(item => normalizeObstacle(item));
      nextObstruction = cloneSnapshot(result.obstruction_state);
    } catch (_) { return false; }

    this.committedSet = nextCommitted;
    this.obstructionSet = nextObstruction;
    this.obstructionIsCurrent = true;
    this.pending = null;
    this.draftSet = cloneSet(this.committedSet);
    if (this.selected && !this.draftSet.some(o => o.id === this.selected)) this.selected = null;
    this.message = result.accepted ? 'Obstacle set committed by the simulation worker.' : `Worker rejected obstacle set: ${result.reason || 'Invalid obstacle set.'}`;
    this.locked = result.spatial_locked;
    return true;
  }

  public markSimulationFrameAdvanced(): void { this.obstructionIsCurrent = false; }

  public cancel(): void {
    if (this.pending) throw new Error('Wait for the worker to finish the current obstacle update.');
    this.draftSet = cloneSet(this.committedSet);
    if (this.selected && !this.draftSet.some(o => o.id === this.selected)) this.selected = null;
    this.message = 'Draft canceled. Showing the worker-confirmed obstacles.';
  }

  private replaceDraft(id: string, updated: Obstacle): void {
    const error = normalizeObstacle(updated);
    this.draftSet = this.draftSet.map(o => o.id === id ? error : o);
    this.selected = id;
    this.message = 'Draft updated. Apply to commit it.';
  }

  private require(id: string): Obstacle {
    const obstacle = this.draftSet.find(o => o.id === id);
    if (!obstacle) throw new Error('Selected obstacle no longer exists.');
    return obstacle;
  }

  private assertEditable(): void {
    if (this.locked) throw new Error('Spatial lock is on. Obstacle geometry is read-only.');
    if (this.pending) throw new Error('Wait for the worker to finish the current obstacle update.');
  }

  private nextId(): string {
    let id: string;
    do { id = `obstacle-${++this.idCounter}`; } while (this.draftSet.some(o => o.id === id));
    return id;
  }
}

// Export core limits for accessible labels/tests while keeping validation in normalizeObstacle.
export const OBSTACLE_EDITOR_LIMITS = {
  minDimensionM: MIN_OBSTACLE_DIMENSION_M,
  maxDimensionM: MAX_OBSTACLE_DIMENSION_M,
  maxHeightM: MAX_OBSTACLE_HEIGHT_M,
  worldLimitM: OBSTACLE_WORLD_LIMIT_M,
  maxObstacles: MAX_OBSTACLES,
} as const;
