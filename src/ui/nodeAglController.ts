/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Feature 7 — Configurable Ground-Node AGL UI Controller
 *
 * Implements frontend validation, state synchronization, spatial-lock blocking,
 * historical mode locking, and command formatting for per-node Antenna AGL (0.0 to 1000.0 m).
 */

export const MIN_GROUND_AGL_M = 0.0;
export const MAX_GROUND_AGL_M = 1000.0;
export const DEFAULT_GROUND_AGL_M = 2.0;

export interface AglValidationResult {
  readonly valid: boolean;
  readonly value?: number;
  readonly reason?: string;
}

/**
 * Validates candidate Antenna AGL input.
 * Strictly enforces finite numeric values within [0.0, 1000.0] metres.
 */
export function validateNodeAgl(val: unknown): AglValidationResult {
  if (val === undefined || val === null || val === '') {
    return { valid: false, reason: 'AGL value cannot be empty.' };
  }
  const num = typeof val === 'number' ? val : parseFloat(String(val).trim());
  if (!Number.isFinite(num)) {
    return { valid: false, reason: 'Antenna AGL must be a finite number.' };
  }
  if (num < MIN_GROUND_AGL_M || num > MAX_GROUND_AGL_M) {
    return {
      valid: false,
      reason: `Antenna AGL must be between ${MIN_GROUND_AGL_M.toFixed(1)} and ${MAX_GROUND_AGL_M.toFixed(1)} metres.`,
    };
  }
  return { valid: true, value: num };
}

export interface AglEditEligibility {
  readonly canEdit: boolean;
  readonly reason?: string;
}

/**
 * Checks whether editing Antenna AGL is permitted under current simulation state.
 * Blocks editing when:
 * 1. Historical inspection is active.
 * 2. Spatial lock is enabled.
 * 3. Target node is ACN (node_id -1) or outside 0..15 range.
 */
export function checkAglEditEligibility(options: {
  readonly spatialLocked: boolean;
  readonly isHistorical: boolean;
  readonly nodeId: number;
}): AglEditEligibility {
  if (options.isHistorical) {
    return {
      canEdit: false,
      reason: 'Cannot edit AGL in historical inspection mode. Return to LIVE to edit.',
    };
  }
  if (options.spatialLocked) {
    return {
      canEdit: false,
      reason: 'Spatial lock is enabled; disable spatial lock to edit Antenna AGL.',
    };
  }
  if (!Number.isInteger(options.nodeId) || options.nodeId < 0 || options.nodeId >= 16) {
    return {
      canEdit: false,
      reason: 'ACN altitude is configured separately. AGL applies only to ground terminals (Node 0–15).',
    };
  }
  return { canEdit: true };
}

/**
 * Derives the total MSL antenna altitude from bare DEM terrain elevation and AGL.
 * Total MSL = Terrain Elevation + AGL.
 */
export function deriveTotalMslAltitude(terrainElevationMslM: number, aglM: number): number {
  return terrainElevationMslM + aglM;
}

/**
 * Generates the authoritative CONFIG_UPDATE worker command payload for an AGL update.
 */
export function buildAglConfigUpdateCommand(nodeId: number, aglM: number, requestId?: string): {
  readonly type: 'CONFIG_UPDATE';
  readonly request_id?: string;
  readonly params: {
    readonly node_id: number;
    readonly agl_m: number;
  };
} {
  return {
    type: 'CONFIG_UPDATE',
    ...(requestId ? { request_id: requestId } : {}),
    params: {
      node_id: nodeId,
      agl_m: aglM,
    },
  };
}

