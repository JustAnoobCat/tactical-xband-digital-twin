/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Geodesy Module — WGS-84 Local Equirectangular Mapping (M7.1)
 *
 * Implements pure, bidirectional geographic coordinate conversions between
 * the authoritative local Cartesian theater coordinate system (metres)
 * and WGS-84 geodetic coordinates (degrees Latitude and Longitude).
 *
 * Projection Architecture:
 * - Projection Type: Local Equirectangular (Plate Carrée with standard parallel)
 * - Reference Ellipsoid: WGS-84 (a = 6,378,137.0 m, f = 1 / 298.257223563)
 * - Theater Origin (0, 0): 34.500000°N, 76.500000°E (center of calibrated Ladakh DEM)
 * - Standard Parallel: phi0 = 34.500000°N
 * - Meridional scale: 110,931.4506 m / degree Latitude (halfHeightM)
 * - Parallel scale: 91,839.9774 m / degree Longitude (halfWidthM)
 * - Axis convention: +X = East (metres), +Y = North (metres), +Z = Altitude MSL (metres)
 *
 * Mathematical Properties:
 * - Linear bijection across R^2.
 * - Invertible with numerical round-trip error < 1e-7 metres.
 * - Out-of-coverage coordinates are unprojected without silent clamping,
 *   with boundary containment explicitly tracked via `isWithinCoverage`.
 */

import { REAL_LADAKH_DEM_METADATA } from './terrain';

export const GEODESY_ORIGIN_LAT_DEG = REAL_LADAKH_DEM_METADATA.centerLatDeg; // 34.5° N
export const GEODESY_ORIGIN_LON_DEG = REAL_LADAKH_DEM_METADATA.centerLonDeg; // 76.5° E
export const METERS_PER_DEG_LAT = REAL_LADAKH_DEM_METADATA.halfHeightM;     // 110,931.4506 m/deg
export const METERS_PER_DEG_LON = REAL_LADAKH_DEM_METADATA.halfWidthM;      // 91,839.9774 m/deg

export const DEM_COVERAGE_HALF_WIDTH_M = REAL_LADAKH_DEM_METADATA.halfWidthM;
export const DEM_COVERAGE_HALF_HEIGHT_M = REAL_LADAKH_DEM_METADATA.halfHeightM;
export const DEM_MIN_LAT_DEG = REAL_LADAKH_DEM_METADATA.minLatDeg; // 33.5° N
export const DEM_MAX_LAT_DEG = REAL_LADAKH_DEM_METADATA.maxLatDeg; // 35.5° N
export const DEM_MIN_LON_DEG = REAL_LADAKH_DEM_METADATA.minLonDeg; // 75.5° E
export const DEM_MAX_LON_DEG = REAL_LADAKH_DEM_METADATA.maxLonDeg; // 77.5° E

export interface GeodeticCoordinate {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly isWithinCoverage: boolean;
}

export interface CartesianCoordinate {
  readonly xM: number;
  readonly yM: number;
  readonly isWithinCoverage: boolean;
}

/**
 * Projects local Cartesian coordinates (metres from origin) to WGS-84 geographic coordinates (degrees).
 *
 * @param xM Easting offset in metres (+X East, -X West).
 * @param yM Northing offset in metres (+Y North, -Y South).
 * @returns Geodetic coordinates (latDeg, lonDeg) and DEM coverage flag.
 * @throws TypeError if xM or yM are not finite numbers.
 */
export function cartesianToGeodetic(xM: number, yM: number): GeodeticCoordinate {
  if (!Number.isFinite(xM) || !Number.isFinite(yM)) {
    throw new TypeError(`Invalid Cartesian coordinates: xM and yM must be finite numbers, got (${xM}, ${yM}).`);
  }

  const latDeg = GEODESY_ORIGIN_LAT_DEG + yM / METERS_PER_DEG_LAT;
  const lonDeg = GEODESY_ORIGIN_LON_DEG + xM / METERS_PER_DEG_LON;

  const isWithinCoverage =
    Math.abs(xM) <= DEM_COVERAGE_HALF_WIDTH_M &&
    Math.abs(yM) <= DEM_COVERAGE_HALF_HEIGHT_M;

  return { latDeg, lonDeg, isWithinCoverage };
}

/**
 * Projects WGS-84 geographic coordinates (degrees) to local Cartesian coordinates (metres from origin).
 * Exact linear inverse of cartesianToGeodetic.
 *
 * @param latDeg Latitude in decimal degrees [-90.0, +90.0].
 * @param lonDeg Longitude in decimal degrees [-180.0, +180.0].
 * @returns Local Cartesian coordinates (xM, yM) and DEM coverage flag.
 * @throws RangeError if latitude is outside [-90, 90] or longitude outside [-180, 180].
 * @throws TypeError if latDeg or lonDeg are not finite numbers.
 */
export function geodeticToCartesian(latDeg: number, lonDeg: number): CartesianCoordinate {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    throw new TypeError(`Invalid geodetic coordinates: latDeg and lonDeg must be finite numbers, got (${latDeg}, ${lonDeg}).`);
  }
  if (latDeg < -90.0 || latDeg > 90.0) {
    throw new RangeError(`Latitude out of valid range [-90.0, +90.0]: got ${latDeg}°`);
  }
  if (lonDeg < -180.0 || lonDeg > 180.0) {
    throw new RangeError(`Longitude out of valid range [-180.0, +180.0]: got ${lonDeg}°`);
  }

  const xM = (lonDeg - GEODESY_ORIGIN_LON_DEG) * METERS_PER_DEG_LON;
  const yM = (latDeg - GEODESY_ORIGIN_LAT_DEG) * METERS_PER_DEG_LAT;

  const isWithinCoverage =
    latDeg >= DEM_MIN_LAT_DEG &&
    latDeg <= DEM_MAX_LAT_DEG &&
    lonDeg >= DEM_MIN_LON_DEG &&
    lonDeg <= DEM_MAX_LON_DEG;

  return { xM, yM, isWithinCoverage };
}

/**
 * Formats a decimal degree coordinate into human-readable Degrees-Minutes-Seconds (DMS) string.
 *
 * @param deg Coordinate in decimal degrees.
 * @param isLatitude True for Latitude (N/S), False for Longitude (E/W).
 */
export function formatDmsComponent(deg: number, isLatitude: boolean): string {
  if (!Number.isFinite(deg)) return '--';
  const sign = deg >= 0 ? 1 : -1;
  const absVal = Math.abs(deg);
  const d = Math.floor(absVal);
  const remMinutes = (absVal - d) * 60.0;
  const m = Math.floor(remMinutes);
  const s = (remMinutes - m) * 60.0;

  const hemisphere = isLatitude
    ? sign >= 0 ? 'N' : 'S'
    : sign >= 0 ? 'E' : 'W';

  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${hemisphere}`;
}

/**
 * Formats a pair of decimal coordinates into a concise decimal degree string (e.g. "34.50000°N, 76.50000°E").
 */
export function formatGeodeticDecimal(latDeg: number, lonDeg: number, fractionDigits: number = 5): string {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return '--';
  const latHemi = latDeg >= 0 ? 'N' : 'S';
  const lonHemi = lonDeg >= 0 ? 'E' : 'W';
  return `${Math.abs(latDeg).toFixed(fractionDigits)}°${latHemi}, ${Math.abs(lonDeg).toFixed(fractionDigits)}°${lonHemi}`;
}

/**
 * Formats a pair of decimal coordinates into a standard DMS string (e.g. "34°30'00.0\"N, 76°30'00.0\"E").
 */
export function formatGeodeticDms(latDeg: number, lonDeg: number): string {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return '--';
  return `${formatDmsComponent(latDeg, true)}, ${formatDmsComponent(lonDeg, false)}`;
}

