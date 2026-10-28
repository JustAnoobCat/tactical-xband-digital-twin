import { MAX_ACN_WAYPOINTS } from '../core/config';

export type TrajectoryMode = 'ellipse' | 'waypoints';
export interface WaypointPoint { xM: number; yM: number; }
export interface EllipseDraft {
  mode: 'ellipse'; centerXm: number; centerYm: number;
  radiusAM: number; radiusBM: number; rotationDeg: number;
}
export interface WaypointDraft { mode: 'waypoints'; points: WaypointPoint[]; }
export type TrajectoryDraft = EllipseDraft | WaypointDraft;

export function parseEditorNumber(value: string): number {
  const trimmed = value.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

/** Node targets win overlaps; waypoint selection remains available outside a node hitbox. */
export function canvasPointerTarget(nodeDistancePx: number, waypointDistancePx: number, nodeRadiusPx = 16, waypointRadiusPx = 12): 'node' | 'waypoint' | null {
  if (nodeDistancePx <= nodeRadiusPx) return 'node';
  if (waypointDistancePx <= waypointRadiusPx) return 'waypoint';
  return null;
}

export function cloneTrajectoryDraft(draft: TrajectoryDraft): TrajectoryDraft {
  return draft.mode === 'ellipse' ? { ...draft } : { mode: 'waypoints', points: draft.points.map(point => ({ ...point })) };
}

/** UI-only draft state; committed state changes only from authoritative worker telemetry. */
export class TrajectoryEditorState {
  private readonly committed = new Map<TrajectoryMode, TrajectoryDraft>();
  private readonly drafts = new Map<TrajectoryMode, TrajectoryDraft>();
  public activeMode: TrajectoryMode = 'ellipse';
  public selectedWaypoint = -1;
  private inputError: string | null = null;

  constructor() {
    const ellipse: EllipseDraft = { mode: 'ellipse', centerXm: 0, centerYm: 0, radiusAM: 20000, radiusBM: 10000, rotationDeg: 35 };
    const waypoints: WaypointDraft = { mode: 'waypoints', points: [] };
    this.committed.set('ellipse', ellipse);
    this.committed.set('waypoints', waypoints);
    this.drafts.set('ellipse', cloneTrajectoryDraft(ellipse));
    this.drafts.set('waypoints', cloneTrajectoryDraft(waypoints));
  }

  public get preview(): TrajectoryDraft { return cloneTrajectoryDraft(this.drafts.get(this.activeMode)!); }
  public get committedActive(): TrajectoryDraft { return cloneTrajectoryDraft(this.committed.get(this.activeMode)!); }
  public get dirty(): boolean { return JSON.stringify(this.preview) !== JSON.stringify(this.committedActive); }

  public setMode(mode: TrajectoryMode): void {
    this.activeMode = mode;
    this.inputError = null;
    if (mode === 'waypoints') {
      const draft = this.preview as WaypointDraft;
      this.selectedWaypoint = Math.min(this.selectedWaypoint, draft.points.length - 1);
    } else this.selectedWaypoint = -1;
  }

  public editEllipse(update: Partial<Omit<EllipseDraft, 'mode'>>): void {
    if (this.activeMode !== 'ellipse') throw new Error('Ellipse controls are inactive.');
    this.inputError = null;
    this.drafts.set('ellipse', { ...(this.preview as EllipseDraft), ...update });
  }

  public addWaypoint(point: WaypointPoint): number {
    if (this.activeMode !== 'waypoints') throw new Error('Waypoint controls are inactive.');
    this.assertWaypoint(point);
    this.inputError = null;
    const draft = this.preview as WaypointDraft;
    if (draft.points.length >= MAX_ACN_WAYPOINTS) throw new Error(`Maximum ${MAX_ACN_WAYPOINTS} waypoints reached.`);
    this.drafts.set('waypoints', { mode: 'waypoints', points: [...draft.points, { ...point }] });
    this.selectedWaypoint = draft.points.length;
    return this.selectedWaypoint;
  }

  public moveWaypoint(index: number, point: WaypointPoint): void {
    const draft = this.preview as WaypointDraft;
    if (this.activeMode !== 'waypoints' || !Number.isInteger(index) || !draft.points[index]) throw new Error('Select a waypoint to move.');
    this.assertWaypoint(point);
    this.inputError = null;
    const points = draft.points.map((item, i) => i === index ? { ...point } : item);
    this.drafts.set('waypoints', { mode: 'waypoints', points });
    this.selectedWaypoint = index;
  }

  public removeSelectedWaypoint(): void {
    const draft = this.preview as WaypointDraft;
    if (this.activeMode !== 'waypoints' || this.selectedWaypoint < 0 || !draft.points[this.selectedWaypoint]) throw new Error('Select a waypoint to remove.');
    if (draft.points.length <= 3) throw new Error('A closed waypoint path needs at least three points.');
    this.inputError = null;
    const points = draft.points.filter((_, i) => i !== this.selectedWaypoint);
    this.selectedWaypoint = Math.min(this.selectedWaypoint, points.length - 1);
    this.drafts.set('waypoints', { mode: 'waypoints', points });
  }

  public selectWaypoint(index: number): void {
    const draft = this.preview as WaypointDraft;
    this.inputError = null;
    this.selectedWaypoint = Number.isInteger(index) && index >= 0 && index < draft.points.length ? index : -1;
  }

  public validatePreview(): string | null {
    if (this.inputError) return this.inputError;
    const draft = this.preview;
    if (draft.mode === 'ellipse') {
      const values = [draft.centerXm, draft.centerYm, draft.radiusAM, draft.radiusBM, draft.rotationDeg];
      if (!values.every(Number.isFinite)) return 'Ellipse values must be finite numbers.';
      if (Math.abs(draft.centerXm) > 600000 || Math.abs(draft.centerYm) > 600000) return 'Ellipse center must be within ±600,000 m.';
      if (draft.radiusAM <= 0 || draft.radiusAM > 600000 || draft.radiusBM <= 0 || draft.radiusBM > 600000) return 'Ellipse axes must be greater than 0 and at most 600,000 m.';
      if (Math.abs(draft.rotationDeg) > 360) return 'Rotation must be within ±360 degrees.';
      return null;
    }
    if (draft.points.length < 3) return 'Add at least three waypoints to close the route.';
    if (draft.points.length > MAX_ACN_WAYPOINTS) return `A route can contain at most ${MAX_ACN_WAYPOINTS} waypoints.`;
    for (const point of draft.points) {
      if (!Number.isFinite(point.xM) || !Number.isFinite(point.yM)) return 'Waypoint coordinates must be finite numbers.';
      if (Math.abs(point.xM) > 600000 || Math.abs(point.yM) > 600000) return 'Waypoint coordinates must be within ±600,000 m.';
    }
    return null;
  }

  public setInputError(message: string | null): void { this.inputError = message; }

  private assertWaypoint(point: WaypointPoint): void {
    if (!Number.isFinite(point.xM) || !Number.isFinite(point.yM)) throw new Error('Waypoint coordinates must be finite numbers.');
    if (Math.abs(point.xM) > 600000 || Math.abs(point.yM) > 600000) throw new Error('Waypoint coordinates must be within ±600,000 m.');
  }

  public cancel(): void {
    this.inputError = null;
    this.drafts.set(this.activeMode, cloneTrajectoryDraft(this.committed.get(this.activeMode)!));
    this.selectedWaypoint = -1;
  }

  public syncCommitted(config: any, forceDraft = false): void {
    if (config?.trajectory_mode === 'ellipse') {
      const draft: EllipseDraft = {
        mode: 'ellipse', centerXm: config.center_x_m, centerYm: config.center_y_m,
        radiusAM: config.orbit_a_m, radiusBM: config.orbit_b_m, rotationDeg: config.orbit_rotation_deg,
      };
      const existing = this.committed.get('ellipse')!;
      const draftIsClean = JSON.stringify(this.drafts.get('ellipse')) === JSON.stringify(existing);
      this.committed.set('ellipse', draft);
      if (forceDraft || draftIsClean) this.drafts.set('ellipse', cloneTrajectoryDraft(draft));
    } else if (config?.trajectory_mode === 'waypoints' && Array.isArray(config.waypoints)) {
      const draft: WaypointDraft = { mode: 'waypoints', points: config.waypoints.map((point: any) => ({ xM: point.x_m, yM: point.y_m })) };
      const existing = this.committed.get('waypoints')!;
      const draftIsClean = JSON.stringify(this.drafts.get('waypoints')) === JSON.stringify(existing);
      this.committed.set('waypoints', draft);
      if (forceDraft || draftIsClean) this.drafts.set('waypoints', cloneTrajectoryDraft(draft));
    }
  }
}
