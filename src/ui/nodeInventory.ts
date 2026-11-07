/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Node Inventory Display & Geographic Coordinate Resolver
 *
 * Implements authoritative validation and presentation formatting for ground-node
 * inventory rows. Strictly displays valid WGS-84 geographic coordinates emitted by
 * the authoritative simulation worker, and displays an explicit unavailable indicator ('—')
 * whenever telemetry coordinates are absent, non-numeric, or outside valid geodetic bounds.
 *
 * NEVER derives or fabricates latitude/longitude from local Cartesian X/Y coordinates in the UI.
 */

import { formatDmsComponent } from '../core/geodesy';

export interface FormattedGeodeticCoordinates {
  readonly latStr: string;
  readonly lonStr: string;
  readonly latDms: string;
  readonly lonDms: string;
  readonly hasValidGeo: boolean;
  readonly latDeg?: number;
  readonly lonDeg?: number;
}

/**
 * Validates and formats geographic coordinates for node inventory presentation.
 * Returns explicit '—' / 'Unavailable' indicators if either coordinate is missing or invalid.
 *
 * @param latDeg Candidate latitude in degrees from worker telemetry
 * @param lonDeg Candidate longitude in degrees from worker telemetry
 */
export function formatNodeGeodeticCoordinates(
  latDeg: unknown,
  lonDeg: unknown
): FormattedGeodeticCoordinates {
  const isValidLat =
    typeof latDeg === 'number' &&
    Number.isFinite(latDeg) &&
    latDeg >= -90.0 &&
    latDeg <= 90.0;

  const isValidLon =
    typeof lonDeg === 'number' &&
    Number.isFinite(lonDeg) &&
    lonDeg >= -180.0 &&
    lonDeg <= 180.0;

  if (!isValidLat || !isValidLon) {
    return {
      latStr: '—',
      lonStr: '—',
      latDms: 'Unavailable',
      lonDms: 'Unavailable',
      hasValidGeo: false,
    };
  }

  const latHemi = latDeg >= 0 ? 'N' : 'S';
  const lonHemi = lonDeg >= 0 ? 'E' : 'W';
  const latStr = `${Math.abs(latDeg).toFixed(5)}°${latHemi}`;
  const lonStr = `${Math.abs(lonDeg).toFixed(5)}°${lonHemi}`;
  const latDms = formatDmsComponent(latDeg, true);
  const lonDms = formatDmsComponent(lonDeg, false);

  return {
    latStr,
    lonStr,
    latDms,
    lonDms,
    hasValidGeo: true,
    latDeg,
    lonDeg,
  };
}

/**
 * Resolves standard tactical role label for a registered ground node ID.
 */
export function getNodeRole(nodeId: number, nodeType?: string): string {
  if (nodeType === 'mcp' || nodeId === 15) return 'Main Command Post (20W Dish)';
  if (nodeId === 4) return 'Recon Patrol (Occlusion Target)';
  if (nodeId === 1) return 'Squad Leader (Voice Lead)';
  if (nodeId === 2) return 'Medic (Voice MC-PTT)';
  if (nodeId === 3 || nodeId === 6 || nodeId === 9) return 'Scout (Tactical Video)';
  return 'Soldier Terminal';
}

export interface NodeValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

export function validateNodeCoordinates(xM: unknown, yM: unknown): NodeValidationResult {
  if (typeof xM !== 'number' || !Number.isFinite(xM) || Math.abs(xM) > 600000) {
    return { valid: false, error: 'X coordinate must be a finite number within ±600,000 metres.' };
  }
  if (typeof yM !== 'number' || !Number.isFinite(yM) || Math.abs(yM) > 600000) {
    return { valid: false, error: 'Y coordinate must be a finite number within ±600,000 metres.' };
  }
  return { valid: true };
}

export function validateNodeAglHeight(aglM: unknown): NodeValidationResult {
  if (typeof aglM !== 'number' || !Number.isFinite(aglM) || aglM < 0 || aglM > 1000) {
    return { valid: false, error: 'Antenna AGL must be between 0.0 and 1,000.0 metres.' };
  }
  return { valid: true };
}

export function validateNodeCallsign(callsign: unknown): NodeValidationResult {
  if (typeof callsign !== 'string' || callsign.trim().length === 0) {
    return { valid: false, error: 'Callsign must be a non-empty string.' };
  }
  if (callsign.trim().length > 32) {
    return { valid: false, error: 'Callsign cannot exceed 32 characters.' };
  }
  return { valid: true };
}

export function validateNodeTxPower(txPowerDbm: unknown): NodeValidationResult {
  if (typeof txPowerDbm !== 'number' || !Number.isFinite(txPowerDbm) || txPowerDbm < 10.0 || txPowerDbm > 50.0) {
    return { valid: false, error: 'Transmit power must be between 10.0 and 50.0 dBm.' };
  }
  return { valid: true };
}

export function validateNodeBatteryCapacity(mah: unknown): NodeValidationResult {
  if (typeof mah !== 'number' || !Number.isFinite(mah) || mah < 100.0 || mah > 500000.0) {
    return { valid: false, error: 'Battery capacity must be between 100.0 and 500,000.0 mAh.' };
  }
  return { valid: true };
}

export function validateNodeBatteryLevel(pct: unknown): NodeValidationResult {
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0.0 || pct > 100.0) {
    return { valid: false, error: 'Battery level must be between 0.0 and 100.0%.' };
  }
  return { valid: true };
}

export function validateNodeTacticalPriority(priority: unknown): NodeValidationResult {
  if (typeof priority !== 'number' || !Number.isFinite(priority) || priority < 0.1 || priority > 5.0) {
    return { valid: false, error: 'Tactical priority must be between 0.1 and 5.0.' };
  }
  return { valid: true };
}

export function validateNodeColorHex(colorHex: unknown): NodeValidationResult {
  if (typeof colorHex !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(colorHex.trim())) {
    return { valid: false, error: 'Node colour must be a valid hex code (e.g. #38bdf8).' };
  }
  return { valid: true };
}

export function buildNodeAddCommand(params: {
  xM?: number;
  yM?: number;
  aglM?: number;
  callsign?: string;
  role?: 'soldier' | 'mcp';
  colorHex?: string;
  txPowerDbm?: number;
  batteryCapacityMah?: number;
  batteryLevelPct?: number;
  tacticalPriority?: number;
  trafficOptions?: any;
  requestId?: string | number;
}): {
  type: 'NODE_ADD';
  x_m: number;
  y_m: number;
  agl_m: number;
  callsign?: string;
  role?: 'soldier' | 'mcp';
  color_hex?: string;
  tx_power_dbm?: number;
  battery_capacity_mah?: number;
  battery_level_pct?: number;
  tactical_priority?: number;
  traffic_options?: any;
  request_id?: string | number;
} {
  return {
    type: 'NODE_ADD',
    x_m: params.xM ?? 0.0,
    y_m: params.yM ?? 0.0,
    agl_m: params.aglM ?? 2.0,
    callsign: params.callsign ? params.callsign.trim() : undefined,
    role: params.role ?? 'soldier',
    color_hex: params.colorHex ? params.colorHex.trim() : undefined,
    tx_power_dbm: params.txPowerDbm,
    battery_capacity_mah: params.batteryCapacityMah,
    battery_level_pct: params.batteryLevelPct,
    tactical_priority: params.tacticalPriority,
    traffic_options: params.trafficOptions,
    request_id: params.requestId,
  };
}

export function buildNodeDeleteCommand(nodeId: number, requestId?: string | number): { type: 'NODE_DELETE'; node_id: number; request_id?: string | number } {
  return {
    type: 'NODE_DELETE',
    node_id: nodeId,
    request_id: requestId,
  };
}

export function buildNodeDuplicateCommand(sourceNodeId: number, params: {
  offsetXm?: number;
  offsetYm?: number;
  callsign?: string;
  requestId?: string | number;
} = {}): { type: 'NODE_DUPLICATE'; source_node_id: number; offset_x_m?: number; offset_y_m?: number; callsign?: string; request_id?: string | number } {
  return {
    type: 'NODE_DUPLICATE',
    source_node_id: sourceNodeId,
    offset_x_m: params.offsetXm ?? 500.0,
    offset_y_m: params.offsetYm ?? 500.0,
    callsign: params.callsign ? params.callsign.trim() : undefined,
    request_id: params.requestId,
  };
}

export function buildNodeUpdateCommand(nodeId: number, updates: {
  xM?: number;
  yM?: number;
  aglM?: number;
  callsign?: string;
  role?: 'soldier' | 'mcp';
  colorHex?: string;
  txPowerDbm?: number;
  batteryCapacityMah?: number;
  batteryLevelPct?: number;
  tacticalPriority?: number;
  trafficOptions?: any;
  requestId?: string | number;
}): {
  type: 'NODE_UPDATE';
  node_id: number;
  x_m?: number;
  y_m?: number;
  agl_m?: number;
  callsign?: string;
  role?: 'soldier' | 'mcp';
  color_hex?: string;
  tx_power_dbm?: number;
  battery_capacity_mah?: number;
  battery_level_pct?: number;
  tactical_priority?: number;
  traffic_options?: any;
  request_id?: string | number;
} {
  return {
    type: 'NODE_UPDATE',
    node_id: nodeId,
    x_m: updates.xM,
    y_m: updates.yM,
    agl_m: updates.aglM,
    callsign: updates.callsign ? updates.callsign.trim() : undefined,
    role: updates.role,
    color_hex: updates.colorHex ? updates.colorHex.trim() : undefined,
    tx_power_dbm: updates.txPowerDbm,
    battery_capacity_mah: updates.batteryCapacityMah,
    battery_level_pct: updates.batteryLevelPct,
    tactical_priority: updates.tacticalPriority,
    traffic_options: updates.trafficOptions,
    request_id: updates.requestId,
  };
}

