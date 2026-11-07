/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Three.js 3D Subsystem — Type Definitions & Coordinate Contracts (M6.2.1)
 *
 * Enforces the approved M6.2 coordinate mapping and lifecycle interfaces:
 *   - Simulation frame: +X East (m), +Y North (m), +Z Altitude MSL (m)
 *   - worldGroup rotation: -PI/2 around X
 *   - Three.js root frame: +X East, +Y Altitude MSL, +Z South (-North)
 *   - Camera outside worldGroup in Three.js root space, Camera Up = (0, 1, 0)
 */

import * as THREE from 'three';
import type { TerrainBoundsTelemetry } from '../../core/terrain';

export type StageViewMode = '2d' | '3d';
export type TerrainMeshResolution = 'native512' | 'balanced256';

export interface TerrainMeshDataPayload {
  readonly terrainMode: 'real' | 'synthetic';
  readonly bounds: TerrainBoundsTelemetry;
  readonly gridSize: number;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly elevations: Float32Array;
}

export interface TerrainGeometryBuildResult {
  readonly meshGeometry: THREE.BufferGeometry;
  readonly skirtGeometry: THREE.BufferGeometry | null;
  readonly resolution: TerrainMeshResolution;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly minElevationM: number;
  readonly maxElevationM: number;
}

export interface ThreeRendererConfig {
  /** DOM container hosting the Three.js canvas */
  readonly container: HTMLElement;
  /** Optional existing canvas element; if omitted, renderer creates its own */
  readonly canvas?: HTMLCanvasElement;
  /** Whether to enable antialiasing (default true) */
  readonly antialias?: boolean;
  /** Maximum device pixel ratio cap to protect low-power / integrated GPUs (default 2) */
  readonly maxPixelRatio?: number;
  /** Power preference hint for WebGL context creation */
  readonly powerPreference?: 'default' | 'high-performance' | 'low-power';
  /** Clear color hex (default 0x080c10 - tactical dark matte) */
  readonly clearColor?: number;
  /** Clear alpha (default 1.0) */
  readonly clearAlpha?: number;
}

export interface ThreeSceneMetrics {
  readonly fps: number;
  readonly frameTimeMs: number;
  readonly renderCount: number;
  readonly isRunning: boolean;
  readonly isContextLost: boolean;
  readonly viewMode: StageViewMode;
  readonly terrainResolution?: TerrainMeshResolution;
  readonly terrainVertexCount?: number;
  readonly terrainTriangleCount?: number;
  readonly drawCalls?: number;
  readonly entityCount?: number;
}

export interface CameraPresetConfig {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly up: THREE.Vector3;
  readonly fovDeg?: number;
}

/**
 * Coordinate Conversion Utilities
 *
 * Simulation Frame (Right-Handed):
 *   +X: East (m)
 *   +Y: North (m)
 *   +Z: Altitude MSL (m)
 *
 * Three.js Root Frame (Right-Handed):
 *   +X_three: East (m)
 *   +Y_three: Altitude MSL (m)
 *   +Z_three: South = -North (m)
 */

export function simToThreeCoords(xSimM: number, ySimM: number, zSimMslM: number): THREE.Vector3 {
  return new THREE.Vector3(xSimM, zSimMslM, -ySimM);
}

export function threeToSimCoords(v: THREE.Vector3): { xM: number; yM: number; zMslM: number } {
  return {
    xM: v.x,
    yM: -v.z,
    zMslM: v.y,
  };
}

/**
 * Standard Camera Presets derived in M6.2 architecture addendum
 */
export const CAMERA_PRESETS = Object.freeze({
  /**
   * Tactical View: Oblique perspective from South looking North at ~22.5 deg elevation.
   * Target is theater center at median terrain altitude 3,500 m MSL.
   */
  TACTICAL: Object.freeze({
    position: new THREE.Vector3(0, 45000, 100000),
    target: new THREE.Vector3(0, 3500, 0),
    up: new THREE.Vector3(0, 1, 0),
    fovDeg: 45,
  }),

  /**
   * Top-Down Nadir View: Looking straight down at center from 180 km altitude.
   * Camera up is (0, 0, -1) so that Screen-Up is -Z_three = +Y_sim (North),
   * and Screen-Right is +X_three = +X_sim (East), exactly matching 2D radar canvas.
   */
  NADIR: Object.freeze({
    position: new THREE.Vector3(0, 180000, 0),
    target: new THREE.Vector3(0, 0, 0),
    up: new THREE.Vector3(0, 0, -1),
    fovDeg: 45,
  }),
});

