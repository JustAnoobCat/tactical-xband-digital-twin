import { ACNWaypoint, MAX_ACN_WAYPOINTS } from './config';

/** Validate and defensively copy a closed waypoint loop using the worker's route rules. */
export function validateClosedWaypointPath(input: unknown): readonly ACNWaypoint[] {
  if (!Array.isArray(input) || input.length < 3) throw new Error('A closed waypoint path requires at least three waypoints.');
  if (input.length > MAX_ACN_WAYPOINTS) throw new Error(`A waypoint path cannot exceed ${MAX_ACN_WAYPOINTS} waypoints.`);

  const copied: ACNWaypoint[] = input.map((point: unknown, index: number) => {
    if (!point || typeof point !== 'object') throw new Error(`Waypoint ${index} must have finite xM and yM coordinates.`);
    const candidate = point as Record<string, unknown>;
    const xCandidate = candidate.xM ?? candidate.x_m;
    const yCandidate = candidate.yM ?? candidate.y_m;
    if (typeof xCandidate !== 'number' || !Number.isFinite(xCandidate) ||
        typeof yCandidate !== 'number' || !Number.isFinite(yCandidate)) {
      throw new Error(`Waypoint ${index} must have finite xM and yM coordinates.`);
    }
    const zCandidate = candidate.zM ?? candidate.z_m;
    const zM = typeof zCandidate === 'number' && Number.isFinite(zCandidate) ? zCandidate : undefined;
    return Object.freeze({
      xM: xCandidate,
      yM: yCandidate,
      ...(zM !== undefined ? { zM } : {}),
    });
  });

  const distinct = new Set(copied.map(point => `${point.xM},${point.yM}`));
  if (distinct.size < 3) throw new Error('A waypoint path requires at least three distinct points.');
  for (let i = 0; i < copied.length; i++) {
    const a = copied[i], b = copied[(i + 1) % copied.length];
    const edgeLength = Math.hypot(b.xM - a.xM, b.yM - a.yM);
    if (!Number.isFinite(edgeLength) || edgeLength <= 1e-6) {
      throw new Error('Consecutive waypoints, including the closing pair, must be distinct.');
    }
  }
  const origin = copied[0];
  let farthest = copied[1];
  for (const point of copied.slice(2)) {
    if (Math.hypot(point.xM - origin.xM, point.yM - origin.yM) > Math.hypot(farthest.xM - origin.xM, farthest.yM - origin.yM)) farthest = point;
  }
  const baseline = Math.hypot(farthest.xM - origin.xM, farthest.yM - origin.yM);
  const maxPerpendicularDistance = copied.reduce((maximum, point) => Math.max(maximum,
    Math.abs((farthest.xM - origin.xM) * (point.yM - origin.yM) - (farthest.yM - origin.yM) * (point.xM - origin.xM)) / baseline), 0);
  if (!Number.isFinite(maxPerpendicularDistance) || maxPerpendicularDistance <= 1e-9) {
    throw new Error('Waypoint loop must enclose non-collinear geometry.');
  }
  return Object.freeze(copied);
}
