import type { Position3D } from './terrain';

/** Maximum number of simultaneously committed obstacles. Keep benchmarked with look-ahead. */
export const MAX_OBSTACLES = 128;
export const OBSTACLE_CELL_SIZE_M = 5000;
export const MIN_OBSTACLE_DIMENSION_M = 0.1;
export const MAX_OBSTACLE_DIMENSION_M = 5000;
export const MAX_OBSTACLE_HEIGHT_M = 5000;
export const OBSTACLE_WORLD_LIMIT_M = 600000;
// DEM-backed terrain is spatially smooth at the scale of these queries. Split the
// terrain-dependent 1D profile at this distance before bounded maximization.
const MAX_TERRAIN_INTERVAL_M = 25;
const MAXIMIZER_ITERATIONS = 20;

export interface CuboidObstacle {
  readonly id: string; readonly shape: 'cuboid';
  readonly xM: number; readonly yM: number; readonly widthM: number; readonly depthM: number;
  readonly heightM: number; readonly rotationDeg: number;
}
export interface ConeObstacle {
  readonly id: string; readonly shape: 'cone';
  readonly xM: number; readonly yM: number; readonly radiusM: number; readonly heightM: number;
}
export interface PyramidObstacle {
  readonly id: string; readonly shape: 'pyramid';
  readonly xM: number; readonly yM: number; readonly widthM: number; readonly depthM: number;
  readonly heightM: number; readonly rotationDeg: number;
}
export type Obstacle = CuboidObstacle | ConeObstacle | PyramidObstacle;

export interface ObstacleIntersection {
  readonly obstacleId: string;
  readonly entryFraction: number;
  readonly exitFraction: number;
  readonly penetrationM: number;
}

interface Bounds { minX: number; maxX: number; minY: number; maxY: number; }
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const cellKey = (x: number, y: number): string => `${x},${y}`;

/** Validate and make a defensive, normalized copy. Rotation is counter-clockwise degrees from +X in map coordinates. */
export function normalizeObstacle(input: unknown): Obstacle {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Obstacle must be an object.');
  const o = input as Record<string, unknown>;
  const xValue = o.x_m ?? o.xM, yValue = o.y_m ?? o.yM, heightValue = o.height_m ?? o.heightM;
  const widthValue = o.width_m ?? o.widthM, depthValue = o.depth_m ?? o.depthM;
  const radiusValue = o.radius_m ?? o.radiusM, rotationValue = o.rotation_deg ?? o.rotationDeg;
  if (typeof o.id !== 'string' || !o.id.trim() || o.id.length > 64) throw new Error('Obstacle id must be a non-empty string of at most 64 characters.');
  if (o.shape !== 'cuboid' && o.shape !== 'cone' && o.shape !== 'pyramid') throw new Error(`Obstacle ${o.id} has an unsupported shape.`);
  if (!finite(xValue) || !finite(yValue) || Math.abs(xValue) > OBSTACLE_WORLD_LIMIT_M || Math.abs(yValue) > OBSTACLE_WORLD_LIMIT_M) {
    throw new Error(`Obstacle ${o.id} coordinates must be finite and within ±${OBSTACLE_WORLD_LIMIT_M} m.`);
  }
  if (!finite(heightValue) || heightValue < MIN_OBSTACLE_DIMENSION_M || heightValue > MAX_OBSTACLE_HEIGHT_M) throw new Error(`Obstacle ${o.id} height must be in [${MIN_OBSTACLE_DIMENSION_M}, ${MAX_OBSTACLE_HEIGHT_M}] m.`);
  let normalized: Obstacle;
  if (o.shape === 'cone') {
    if (!finite(radiusValue) || radiusValue < MIN_OBSTACLE_DIMENSION_M || radiusValue > MAX_OBSTACLE_DIMENSION_M) throw new Error(`Obstacle ${o.id} radius must be in [${MIN_OBSTACLE_DIMENSION_M}, ${MAX_OBSTACLE_DIMENSION_M}] m.`);
    normalized = { id: o.id.trim(), shape: 'cone', xM: xValue, yM: yValue, radiusM: radiusValue, heightM: heightValue };
  } else {
    if (!finite(widthValue) || !finite(depthValue) || widthValue < MIN_OBSTACLE_DIMENSION_M || depthValue < MIN_OBSTACLE_DIMENSION_M || widthValue > MAX_OBSTACLE_DIMENSION_M || depthValue > MAX_OBSTACLE_DIMENSION_M) {
      throw new Error(`Obstacle ${o.id} width and depth must be in [${MIN_OBSTACLE_DIMENSION_M}, ${MAX_OBSTACLE_DIMENSION_M}] m.`);
    }
    if (!finite(rotationValue) || Math.abs(rotationValue) > 360) throw new Error(`Obstacle ${o.id} rotation must be within ±360 degrees.`);
    normalized = o.shape === 'cuboid'
      ? { id: o.id.trim(), shape: 'cuboid', xM: xValue, yM: yValue, widthM: widthValue, depthM: depthValue, heightM: heightValue, rotationDeg: rotationValue }
      : { id: o.id.trim(), shape: 'pyramid', xM: xValue, yM: yValue, widthM: widthValue, depthM: depthValue, heightM: heightValue, rotationDeg: rotationValue };
  }
  const b = obstacleBounds(normalized);
  if (b.minX < -OBSTACLE_WORLD_LIMIT_M || b.maxX > OBSTACLE_WORLD_LIMIT_M || b.minY < -OBSTACLE_WORLD_LIMIT_M || b.maxY > OBSTACLE_WORLD_LIMIT_M) {
    throw new Error(`Obstacle ${o.id} footprint must remain within ±${OBSTACLE_WORLD_LIMIT_M} m.`);
  }
  return normalized;
}

function obstacleBounds(o: Obstacle): Bounds {
  if (o.shape === 'cone') return { minX: o.xM - o.radiusM, maxX: o.xM + o.radiusM, minY: o.yM - o.radiusM, maxY: o.yM + o.radiusM };
  const a = o.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const hx = o.widthM / 2, hy = o.depthM / 2;
  const rx = Math.abs(c) * hx + Math.abs(s) * hy, ry = Math.abs(s) * hx + Math.abs(c) * hy;
  return { minX: o.xM - rx, maxX: o.xM + rx, minY: o.yM - ry, maxY: o.yM + ry };
}

function localXY(o: Exclude<Obstacle, ConeObstacle>, x: number, y: number): [number, number] {
  const a = -o.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), dx = x - o.xM, dy = y - o.yM;
  return [c * dx - s * dy, s * dx + c * dy];
}

/** World-coordinate plan-view boundary; does not approximate terrain draping or vertical surfaces. */
export function obstacleFootprintPoints(o: Obstacle, circleSegments = 48): [number, number][] {
  if (o.shape === 'cone') {
    const count = Math.max(12, Math.floor(circleSegments));
    return Array.from({ length: count }, (_, i) => {
      const a = 2 * Math.PI * i / count;
      return [o.xM + o.radiusM * Math.cos(a), o.yM + o.radiusM * Math.sin(a)];
    });
  }
  const hx = o.widthM / 2, hy = o.depthM / 2, a = o.rotationDeg * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => [o.xM + c * x - s * y, o.yM + s * x + c * y]);
}

/** Exact XY footprint hit test, with an optional world-space tolerance for Canvas selection. */
export function obstacleContainsPoint(o: Obstacle, x: number, y: number, toleranceM = 0): boolean {
  if (!finite(x) || !finite(y) || !finite(toleranceM) || toleranceM < 0) return false;
  if (o.shape === 'cone') return Math.hypot(x - o.xM, y - o.yM) <= o.radiusM + toleranceM;
  const [lx, ly] = localXY(o, x, y);
  return Math.abs(lx) <= o.widthM / 2 + toleranceM && Math.abs(ly) <= o.depthM / 2 + toleranceM;
}

/** Return the closed [entry, exit] parameter interval of a 2D segment through a footprint. */
export function footprintInterval(o: Obstacle, start: readonly [number, number], end: readonly [number, number]): [number, number] | null {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  let lo = 0, hi = 1;
  if (o.shape === 'cone') {
    const ox = start[0] - o.xM, oy = start[1] - o.yM;
    const a = dx * dx + dy * dy, b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - o.radiusM * o.radiusM;
    if (a < 1e-18) return c <= 1e-9 ? [0, 1] : null;
    const disc = b * b - 4 * a * c;
    if (disc < -1e-9) return null;
    const root = Math.sqrt(Math.max(0, disc));
    lo = Math.max(0, (-b - root) / (2 * a)); hi = Math.min(1, (-b + root) / (2 * a));
  } else {
    const [x0, y0] = localXY(o, start[0], start[1]);
    const [x1, y1] = localXY(o, end[0], end[1]);
    const lx = x1 - x0, ly = y1 - y0;
    for (const [p, d, half] of [[x0, lx, o.widthM / 2], [y0, ly, o.depthM / 2]] as const) {
      if (Math.abs(d) < 1e-12) { if (p < -half - 1e-9 || p > half + 1e-9) return null; }
      else {
        const a = (-half - p) / d, b = (half - p) / d;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      }
    }
  }
  return lo <= hi + 1e-12 ? [Math.max(0, lo), Math.min(1, hi)] : null;
}

/** Height above pointwise terrain: cuboid constant, cone radial linear taper, pyramid planar max-norm taper. */
export function obstacleHeightAboveGround(o: Obstacle, x: number, y: number): number {
  if (o.shape === 'cone') {
    const r = Math.hypot(x - o.xM, y - o.yM);
    return r > o.radiusM ? 0 : o.heightM * Math.max(0, 1 - r / o.radiusM);
  }
  const [lx, ly] = localXY(o, x, y), nx = Math.abs(lx) / (o.widthM / 2), ny = Math.abs(ly) / (o.depthM / 2);
  if (nx > 1 || ny > 1) return 0;
  if (o.shape === 'cuboid') return o.heightM;
  return o.heightM * Math.max(0, 1 - Math.max(nx, ny));
}

/** Absolute MSL roof/surface envelope at world XY; terrain is sampled pointwise beneath the footprint. */
export function obstacleSurfaceHeight(o: Obstacle, x: number, y: number, groundElevationMslM: (x: number, y: number) => number): number {
  return groundElevationMslM(x, y) + obstacleHeightAboveGround(o, x, y);
}

/** Grid-indexed obstacle collection. Terrain anchoring is pointwise: base z = terrain(x,y), roof profile = base + shape height. */
export class ObstacleField {
  private values: readonly Obstacle[] = [];
  private cells = new Map<string, readonly Obstacle[]>();

  public get all(): readonly Obstacle[] { return this.values.map(o => ({ ...o })); }

  public replace(inputs: unknown): readonly Obstacle[] {
    if (!Array.isArray(inputs)) throw new Error('obstacles must be an array.');
    if (inputs.length > MAX_OBSTACLES) throw new Error(`Obstacle set cannot exceed ${MAX_OBSTACLES} items.`);
    const next = inputs.map(normalizeObstacle), ids = new Set<string>();
    for (const o of next) { if (ids.has(o.id)) throw new Error(`Duplicate obstacle id '${o.id}'.`); ids.add(o.id); }
    const mutable = new Map<string, Obstacle[]>();
    for (const o of next) {
      const b = obstacleBounds(o), x0 = Math.floor(b.minX / OBSTACLE_CELL_SIZE_M), x1 = Math.floor(b.maxX / OBSTACLE_CELL_SIZE_M);
      const y0 = Math.floor(b.minY / OBSTACLE_CELL_SIZE_M), y1 = Math.floor(b.maxY / OBSTACLE_CELL_SIZE_M);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = cellKey(x, y), list = mutable.get(key) ?? []; list.push(o); mutable.set(key, list);
      }
    }
    this.values = next;
    this.cells = new Map([...mutable].map(([key, list]) => [key, list]));
    return this.all;
  }

  private candidates(start: Position3D, end: Position3D): Set<Obstacle> {
    const dx = end[0] - start[0], dy = end[1] - start[1], stepX = Math.sign(dx), stepY = Math.sign(dy);
    let cx = Math.floor(start[0] / OBSTACLE_CELL_SIZE_M), cy = Math.floor(start[1] / OBSTACLE_CELL_SIZE_M);
    const endX = Math.floor(end[0] / OBSTACLE_CELL_SIZE_M), endY = Math.floor(end[1] / OBSTACLE_CELL_SIZE_M);
    const tDeltaX = dx === 0 ? Infinity : OBSTACLE_CELL_SIZE_M / Math.abs(dx), tDeltaY = dy === 0 ? Infinity : OBSTACLE_CELL_SIZE_M / Math.abs(dy);
    let tMaxX = dx === 0 ? Infinity : (((stepX > 0 ? cx + 1 : cx) * OBSTACLE_CELL_SIZE_M) - start[0]) / dx;
    let tMaxY = dy === 0 ? Infinity : (((stepY > 0 ? cy + 1 : cy) * OBSTACLE_CELL_SIZE_M) - start[1]) / dy;
    const found = new Set<Obstacle>();
    // At most 2 * theater diagonal / cell size plus a small endpoint margin.
    for (let n = 0; n < 1000; n++) {
      for (const o of this.cells.get(cellKey(cx, cy)) ?? []) found.add(o);
      if (cx === endX && cy === endY) break;
      if (Math.abs(tMaxX - tMaxY) < 1e-12) {
        // Supercover both side cells at a grid-corner crossing so tangent footprints aren't skipped.
        for (const key of [cellKey(cx + stepX, cy), cellKey(cx, cy + stepY)]) {
          for (const o of this.cells.get(key) ?? []) found.add(o);
        }
        cx += stepX; cy += stepY; tMaxX += tDeltaX; tMaxY += tDeltaY;
      } else if (tMaxX < tMaxY) { cx += stepX; tMaxX += tDeltaX; }
      else { cy += stepY; tMaxY += tDeltaY; }
    }
    return found;
  }

  /** Geometric screening only; no material attenuation or dB loss is inferred. */
  public intersectRay(start: Position3D, end: Position3D, groundElevation: (x: number, y: number, fraction: number) => number): ObstacleIntersection[] {
    const hits: ObstacleIntersection[] = [];
    for (const o of this.candidates(start, end)) {
      const interval = footprintInterval(o, [start[0], start[1]], [end[0], end[1]]);
      if (!interval) continue;
      const [lo, hi] = interval, span = hi - lo;
      const horizontalLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
      const depthAt = (t: number): number => {
        const x = start[0] + (end[0] - start[0]) * t, y = start[1] + (end[1] - start[1]) * t;
        const base = groundElevation(x, y, t), z = start[2] + (end[2] - start[2]) * t;
        const roof = obstacleSurfaceHeight(o, x, y, () => base);
        return Math.min(z - base, roof - z);
      };
      // Footprint clipping is analytic. Inside it, the shape-only roof profiles
      // (constant cuboid, radial cone, piecewise-planar pyramid) are continuous;
      // terrain is the only arbitrary spatial function. Partition its ray profile
      // into bounded 25 m intervals, then maximize each interval with golden
      // section search. Unlike the old capped uniform scan, every interval gets
      // its own extrema search, so a narrow vertical crossing or tangent is not
      // dependent on landing on one of a fixed set of samples. DEM variation is
      // still approximated within each interval because the callback has no
      // derivative/curvature bound.
      const intervalCount = Math.max(1, Math.ceil(horizontalLength * span / MAX_TERRAIN_INTERVAL_M));
      let blocked = false, penetration = 0;
      const consider = (t: number): void => {
        const depth = depthAt(t);
        if (depth >= -1e-7) {
          blocked = true;
          penetration = Math.max(penetration, Math.max(0, depth));
        }
      };
      for (let i = 0; i < intervalCount; i++) {
        const left0 = lo + span * i / intervalCount;
        const right0 = lo + span * (i + 1) / intervalCount;
        consider(left0);
        consider(right0);
        let left = left0, right = right0;
        const ratio = (Math.sqrt(5) - 1) / 2;
        let t1 = right - ratio * (right - left), t2 = left + ratio * (right - left);
        let d1 = depthAt(t1), d2 = depthAt(t2);
        for (let k = 0; k < MAXIMIZER_ITERATIONS; k++) {
          if (d1 < d2) {
            left = t1; t1 = t2; d1 = d2;
            t2 = left + ratio * (right - left); d2 = depthAt(t2);
          } else {
            right = t2; t2 = t1; d2 = d1;
            t1 = right - ratio * (right - left); d1 = depthAt(t1);
          }
        }
        consider((left + right) / 2);
        consider((left0 + right0) / 2);
      }
      if (blocked) hits.push({ obstacleId: o.id, entryFraction: lo, exitFraction: hi, penetrationM: penetration });
    }
    return hits;
  }
}
