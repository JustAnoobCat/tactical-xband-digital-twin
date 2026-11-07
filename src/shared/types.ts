/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Shared Domain-Independent Types
 */

/**
 * 3D Cartesian coordinates [x, y, z] in metres.
 * x: East-West displacement (m) relative to theater origin.
 * y: North-South displacement (m) relative to theater origin.
 * z: Absolute altitude (m) MSL (Mean Sea Level).
 */
export type Position3D = readonly [xM: number, yM: number, zM: number];

/**
 * 2D coordinate point [x, y] (e.g. screen pixel coordinates or planar local coordinates).
 */
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

