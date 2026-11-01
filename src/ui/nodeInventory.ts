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
export function getNodeRole(nodeId: number): string {
  if (nodeId === 15) return 'Main Command Post (20W Dish)';
  if (nodeId === 4) return 'Recon Patrol (Occlusion Target)';
  if (nodeId === 1) return 'Squad Leader (Voice Lead)';
  if (nodeId === 2) return 'Medic (Voice MC-PTT)';
  if (nodeId === 3 || nodeId === 6 || nodeId === 9) return 'Scout (Tactical Video)';
  return 'Soldier Terminal';
}

