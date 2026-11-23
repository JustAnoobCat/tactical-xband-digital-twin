/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Geodesy Module — Authoritative WGS-84 ECEF / ENU / Vincenty & DEM Mapping
 *
 * Implements high-precision, zero-side-effect geodetic primitives:
 * 1. Canonical WGS-84 Ellipsoid constants (a = 6,378,137.0 m, f = 1 / 298.257223563).
 * 2. 3D ECEF <-> Geodetic conversions with Bowring / Newton-Raphson convergence (< 1e-11 rad).
 * 3. 3D Geodetic <-> Local Topocentric ENU transformations with exact rotation matrices.
 * 4. Surface-constrained 2D ENU <-> Geodetic conversions eliminating Earth-curvature altitude leakage.
 * 5. Ellipsoidal Vincenty inverse distance and forward/back azimuth calculation with antipodal fallback.
 * 6. True 3D ECEF chord slant range and topocentric transmitter look angles (azimuth and elevation).
 * 7. Backward-compatible DEM-aligned Local Equirectangular mapping (Plate Carrée with standard parallel)
 *    preserving exact contracts for TerrainEngine, worker telemetry, and existing verification suites.
 *
 * Specification: docs/specs/wp03-wgs84-ecef-enu-geodesy.md
 */

import { REAL_LADAKH_DEM_METADATA } from './terrain';

// =================================================================================================
// 1. Authoritative Reference Ellipsoid Constants (WGS-84 / EPSG:7030)
// =================================================================================================

/** Semi-major axis (equatorial radius) in metres. */
export const WGS84_A_M = 6378137.0;
export const WGS84_SEMI_MAJOR_AXIS_M = WGS84_A_M;

/** Reciprocal flattening 1/f = 298.257223563. */
export const WGS84_INV_F = 298.257223563;
export const WGS84_F = 1.0 / WGS84_INV_F;
export const WGS84_FLATTENING = WGS84_F;

/** Semi-minor axis (polar radius) in metres: b = a * (1 - f). */
export const WGS84_B_M = WGS84_A_M * (1.0 - WGS84_F);
export const WGS84_SEMI_MINOR_AXIS_M = WGS84_B_M;

/** First eccentricity squared: e^2 = 2f - f^2 = (a^2 - b^2) / a^2. */
export const WGS84_E2 = 2.0 * WGS84_F - WGS84_F * WGS84_F;
export const WGS84_ECCENTRICITY_SQ = WGS84_E2;

/** Second eccentricity squared: e'^2 = (a^2 - b^2) / b^2 = e^2 / (1 - e^2). */
export const WGS84_E_PRIME2 = (WGS84_A_M * WGS84_A_M - WGS84_B_M * WGS84_B_M) / (WGS84_B_M * WGS84_B_M);

// =================================================================================================
// 2. DEM-Aligned Theater Constants (M7.1 Equirectangular Reference)
// =================================================================================================

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

// =================================================================================================
// 3. Types and Interfaces
// =================================================================================================

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

export interface EcefCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EnuCoordinate {
  readonly eastM: number;
  readonly northM: number;
  readonly upM: number;
}

export interface GeodeticCoordinate3D {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly altM: number;
}

export interface LocalRadii {
  /** Meridional radius of curvature (along meridian) in metres. */
  readonly Rm: number;
  /** Prime vertical radius of curvature (transverse radius) in metres. */
  readonly Rn: number;
  /** Gaussian mean radius of curvature sqrt(Rm * Rn) in metres. */
  readonly Rgauss: number;
}

export interface VincentyResult {
  readonly distanceM: number;
  readonly initialBearingDeg: number;
  readonly finalBearingDeg: number;
  readonly iterations: number;
  readonly converged: boolean;
}

export interface SlantRangeLookAngles {
  readonly slantRangeM: number;
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
  readonly groundArcM: number;
}

// =================================================================================================
// 4. Input Validation Helpers
// =================================================================================================

function validateFiniteNumber(val: number, name: string): void {
  if (!Number.isFinite(val)) {
    throw new TypeError(`Invalid coordinate parameter '${name}': must be a finite number, got ${val}.`);
  }
}

function validateLatLonRange(latDeg: number, lonDeg: number): void {
  if (latDeg < -90.0 || latDeg > 90.0) {
    throw new RangeError(`Latitude out of valid range [-90.0, +90.0]: got ${latDeg}°`);
  }
  if (lonDeg < -180.0 || lonDeg > 180.0) {
    throw new RangeError(`Longitude out of valid range [-180.0, +180.0]: got ${lonDeg}°`);
  }
}

// =================================================================================================
// 5. Canonical WGS-84 Radii of Curvature
// =================================================================================================

/**
 * Computes the principal radii of curvature on the WGS-84 ellipsoid at geodetic latitude phi.
 *
 * @param latDeg Geodetic latitude in decimal degrees [-90.0, +90.0].
 * @returns Meridional (Rm), Prime Vertical (Rn), and Gaussian mean (Rgauss) radii in metres.
 */
export function wgs84LocalRadii(latDeg: number): LocalRadii {
  validateFiniteNumber(latDeg, 'latDeg');
  if (latDeg < -90.0 || latDeg > 90.0) {
    throw new RangeError(`Latitude out of valid range [-90.0, +90.0]: got ${latDeg}°`);
  }

  const phi = (latDeg * Math.PI) / 180.0;
  const sinPhi = Math.sin(phi);
  const wSq = 1.0 - WGS84_E2 * sinPhi * sinPhi;
  const w = Math.sqrt(wSq);

  const Rn = WGS84_A_M / w;
  const Rm = (WGS84_A_M * (1.0 - WGS84_E2)) / (w * wSq);
  const Rgauss = Math.sqrt(Rm * Rn);

  return { Rm, Rn, Rgauss };
}

// =================================================================================================
// 6. 3D WGS-84 Geodetic <-> ECEF Conversions
// =================================================================================================

/**
 * Converts WGS-84 geodetic coordinates (lat, lon, alt) to Earth-Centered, Earth-Fixed (ECEF) Cartesian coordinates.
 * Pure function, zero side effects.
 *
 * @param latDeg Geodetic latitude in decimal degrees [-90.0, +90.0].
 * @param lonDeg Geodetic longitude in decimal degrees [-180.0, +180.0].
 * @param altM Ellipsoidal height above WGS-84 reference ellipsoid in metres (default 0).
 * @returns ECEF Cartesian coordinates { x, y, z } in metres.
 */
export function geodeticToEcef(latDeg: number, lonDeg: number, altM: number = 0.0): EcefCoordinate {
  validateFiniteNumber(latDeg, 'latDeg');
  validateFiniteNumber(lonDeg, 'lonDeg');
  validateFiniteNumber(altM, 'altM');
  validateLatLonRange(latDeg, lonDeg);

  const phi = (latDeg * Math.PI) / 180.0;
  const lam = (lonDeg * Math.PI) / 180.0;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLam = Math.sin(lam);
  const cosLam = Math.cos(lam);

  const N = WGS84_A_M / Math.sqrt(1.0 - WGS84_E2 * sinPhi * sinPhi);

  const x = (N + altM) * cosPhi * cosLam;
  const y = (N + altM) * cosPhi * sinLam;
  const z = (N * (1.0 - WGS84_E2) + altM) * sinPhi;

  return { x, y, z };
}

/**
 * Converts ECEF Cartesian coordinates (x, y, z) to WGS-84 geodetic coordinates (lat, lon, alt).
 * Utilizes Bowring's closed-form initial approximation followed by high-precision fixed-point
 * iteration converging to machine precision (< 1e-12 rad latitude error).
 * Handles polar singularities cleanly without division-by-zero.
 *
 * @param x ECEF X coordinate in metres.
 * @param y ECEF Y coordinate in metres.
 * @param z ECEF Z coordinate in metres.
 * @returns Geodetic coordinates { latDeg, lonDeg, altM }.
 */
export function ecefToGeodetic(x: number, y: number, z: number): GeodeticCoordinate3D {
  validateFiniteNumber(x, 'x');
  validateFiniteNumber(y, 'y');
  validateFiniteNumber(z, 'z');

  const p = Math.hypot(x, y);

  // Exact polar singularity handling
  if (p < 1e-10) {
    const latDeg = z >= 0.0 ? 90.0 : -90.0;
    const lonDeg = 0.0;
    const altM = Math.abs(z) - WGS84_B_M;
    return { latDeg, lonDeg, altM };
  }

  const lam = Math.atan2(y, x);

  // Bowring's initial approximation
  const theta = Math.atan2(z * WGS84_A_M, p * WGS84_B_M);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  let phi = Math.atan2(
    z + WGS84_E_PRIME2 * WGS84_B_M * sinTheta * sinTheta * sinTheta,
    p - WGS84_E2 * WGS84_A_M * cosTheta * cosTheta * cosTheta
  );

  // High-precision fixed-point iteration (converges in 2-3 iterations)
  for (let i = 0; i < 5; i++) {
    const sinPhi = Math.sin(phi);
    const N = WGS84_A_M / Math.sqrt(1.0 - WGS84_E2 * sinPhi * sinPhi);
    const phiNext = Math.atan2(z + WGS84_E2 * N * sinPhi, p);
    if (Math.abs(phiNext - phi) < 1e-12) {
      phi = phiNext;
      break;
    }
    phi = phiNext;
  }

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const altM = p * cosPhi + z * sinPhi - WGS84_A_M * Math.sqrt(1.0 - WGS84_E2 * sinPhi * sinPhi);

  return {
    latDeg: (phi * 180.0) / Math.PI,
    lonDeg: (lam * 180.0) / Math.PI,
    altM,
  };
}

// =================================================================================================
// 7. 3D WGS-84 Geodetic <-> Topocentric ENU Transformations
// =================================================================================================

/**
 * Transforms WGS-84 geodetic coordinates to local topocentric East-North-Up (ENU) coordinates
 * relative to a specified geodetic tangent plane origin.
 *
 * @param latDeg Geodetic latitude in decimal degrees.
 * @param lonDeg Geodetic longitude in decimal degrees.
 * @param altM Ellipsoidal altitude in metres (default 0).
 * @param originLatDeg Origin latitude in degrees (defaults to theater center 34.5°N).
 * @param originLonDeg Origin longitude in degrees (defaults to theater center 76.5°E).
 * @param originAltM Origin altitude in metres (default 0).
 * @returns ENU coordinates { eastM, northM, upM } in metres.
 */
export function geodeticToEnu(
  latDeg: number,
  lonDeg: number,
  altM: number = 0.0,
  originLatDeg: number = GEODESY_ORIGIN_LAT_DEG,
  originLonDeg: number = GEODESY_ORIGIN_LON_DEG,
  originAltM: number = 0.0
): EnuCoordinate {
  validateFiniteNumber(originLatDeg, 'originLatDeg');
  validateFiniteNumber(originLonDeg, 'originLonDeg');
  validateFiniteNumber(originAltM, 'originAltM');
  validateLatLonRange(originLatDeg, originLonDeg);

  const p = geodeticToEcef(latDeg, lonDeg, altM);
  const p0 = geodeticToEcef(originLatDeg, originLonDeg, originAltM);

  const dx = p.x - p0.x;
  const dy = p.y - p0.y;
  const dz = p.z - p0.z;

  const phi0 = (originLatDeg * Math.PI) / 180.0;
  const lam0 = (originLonDeg * Math.PI) / 180.0;
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const sinLam0 = Math.sin(lam0);
  const cosLam0 = Math.cos(lam0);

  const eastM = -sinLam0 * dx + cosLam0 * dy;
  const northM = -sinPhi0 * cosLam0 * dx - sinPhi0 * sinLam0 * dy + cosPhi0 * dz;
  const upM = cosPhi0 * cosLam0 * dx + cosPhi0 * sinLam0 * dy + sinPhi0 * dz;

  return { eastM, northM, upM };
}

/**
 * Transforms local topocentric East-North-Up (ENU) coordinates back to WGS-84 geodetic coordinates
 * relative to a specified tangent plane origin.
 *
 * @param eastM East displacement in metres.
 * @param northM North displacement in metres.
 * @param upM Up displacement in metres (default 0).
 * @param originLatDeg Origin latitude in degrees (defaults to theater center 34.5°N).
 * @param originLonDeg Origin longitude in degrees (defaults to theater center 76.5°E).
 * @param originAltM Origin altitude in metres (default 0).
 * @returns Geodetic coordinates { latDeg, lonDeg, altM }.
 */
export function enuToGeodetic(
  eastM: number,
  northM: number,
  upM: number = 0.0,
  originLatDeg: number = GEODESY_ORIGIN_LAT_DEG,
  originLonDeg: number = GEODESY_ORIGIN_LON_DEG,
  originAltM: number = 0.0
): GeodeticCoordinate3D {
  validateFiniteNumber(eastM, 'eastM');
  validateFiniteNumber(northM, 'northM');
  validateFiniteNumber(upM, 'upM');
  validateFiniteNumber(originLatDeg, 'originLatDeg');
  validateFiniteNumber(originLonDeg, 'originLonDeg');
  validateFiniteNumber(originAltM, 'originAltM');
  validateLatLonRange(originLatDeg, originLonDeg);

  const p0 = geodeticToEcef(originLatDeg, originLonDeg, originAltM);

  const phi0 = (originLatDeg * Math.PI) / 180.0;
  const lam0 = (originLonDeg * Math.PI) / 180.0;
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const sinLam0 = Math.sin(lam0);
  const cosLam0 = Math.cos(lam0);

  // Inverse rotation: transpose of R_ECEF->ENU
  const dx = -sinLam0 * eastM - sinPhi0 * cosLam0 * northM + cosPhi0 * cosLam0 * upM;
  const dy = cosLam0 * eastM - sinPhi0 * sinLam0 * northM + cosPhi0 * sinLam0 * upM;
  const dz = cosPhi0 * northM + sinPhi0 * upM;

  return ecefToGeodetic(p0.x + dx, p0.y + dy, p0.z + dz);
}

// =================================================================================================
// 8. Surface-Constrained 2D ENU <-> Geodetic Conversions (Zero Curvature Leakage)
// =================================================================================================

/**
 * Projects WGS-84 geographic coordinates to local 2D horizontal coordinates (eastM, northM)
 * on the terrain surface (altM = surfaceAltM).
 *
 * @param latDeg Latitude in decimal degrees.
 * @param lonDeg Longitude in decimal degrees.
 * @param originLatDeg Origin latitude in degrees (default 34.5°N).
 * @param originLonDeg Origin longitude in degrees (default 76.5°E).
 * @param surfaceAltM Surface altitude in metres (default 0).
 */
export function geodeticToEnu2D(
  latDeg: number,
  lonDeg: number,
  originLatDeg: number = GEODESY_ORIGIN_LAT_DEG,
  originLonDeg: number = GEODESY_ORIGIN_LON_DEG,
  surfaceAltM: number = 0.0
): { eastM: number; northM: number } {
  const enu = geodeticToEnu(latDeg, lonDeg, surfaceAltM, originLatDeg, originLonDeg, surfaceAltM);
  return { eastM: enu.eastM, northM: enu.northM };
}

/**
 * Inverts local 2D horizontal coordinates (eastM, northM) to WGS-84 geodetic coordinates (latDeg, lonDeg)
 * constrained strictly to the ellipsoid surface (altM = surfaceAltM).
 *
 * Prevents tangent-plane altitude leakage (where u=0 at 150 km would cause an artificial +1.77 km altitude drop).
 * Iterates on tangent-plane upM to match the ellipsoid surface with < 1e-4 m round-trip precision.
 *
 * @param eastM East displacement in metres.
 * @param northM North displacement in metres.
 * @param originLatDeg Origin latitude in degrees (default 34.5°N).
 * @param originLonDeg Origin longitude in degrees (default 76.5°E).
 * @param surfaceAltM Surface altitude in metres (default 0).
 */
export function enuToGeodetic2D(
  eastM: number,
  northM: number,
  originLatDeg: number = GEODESY_ORIGIN_LAT_DEG,
  originLonDeg: number = GEODESY_ORIGIN_LON_DEG,
  surfaceAltM: number = 0.0
): { latDeg: number; lonDeg: number } {
  validateFiniteNumber(eastM, 'eastM');
  validateFiniteNumber(northM, 'northM');

  // Initial tangent plane depression estimate u ≈ -d^2 / (2 * a)
  let u = -(eastM * eastM + northM * northM) / (2.0 * WGS84_A_M);

  // Fixed-point correction: d(altM) / d(u) ≈ 1.0 near origin
  for (let k = 0; k < 5; k++) {
    const geo = enuToGeodetic(eastM, northM, u, originLatDeg, originLonDeg, surfaceAltM);
    const altErr = geo.altM - surfaceAltM;
    if (Math.abs(altErr) < 1e-6) {
      return { latDeg: geo.latDeg, lonDeg: geo.lonDeg };
    }
    u -= altErr;
  }

  const geoFinal = enuToGeodetic(eastM, northM, u, originLatDeg, originLonDeg, surfaceAltM);
  return { latDeg: geoFinal.latDeg, lonDeg: geoFinal.lonDeg };
}

/**
 * Standard WGS-84 projection alias: maps (latDeg, lonDeg) to local Cartesian (xM, yM) via 2D ENU.
 */
export function latLonToLocal(
  latDeg: number,
  lonDeg: number,
  originLatDeg: number = GEODESY_ORIGIN_LAT_DEG,
  originLonDeg: number = GEODESY_ORIGIN_LON_DEG
): { xM: number; yM: number } {
  const enu = geodeticToEnu2D(latDeg, lonDeg, originLatDeg, originLonDeg);
  return { xM: enu.eastM, yM: enu.northM };
}

/**
 * Standard WGS-84 inverse alias: maps local Cartesian (xM, yM) to (latDeg, lonDeg) via surface-constrained 2D ENU.
 */
export function localToLatLon(
  xM: number,
  yM: number,
  originLatDeg: number = GEODESY_ORIGIN_LAT_DEG,
  originLonDeg: number = GEODESY_ORIGIN_LON_DEG,
  surfaceAltM: number = 0.0
): { latDeg: number; lonDeg: number } {
  return enuToGeodetic2D(xM, yM, originLatDeg, originLonDeg, surfaceAltM);
}

// =================================================================================================
// 9. Ellipsoidal Vincenty Inverse Geodesic
// =================================================================================================

/**
 * Computes exact ellipsoidal geodesic distance, initial forward azimuth, and final azimuth
 * between two points on the WGS-84 reference ellipsoid using Vincenty's inverse formula.
 *
 * Handles coincident points cleanly (0 m distance) and falls back gracefully to great-circle
 * spherical distance for nearly antipodal geometries failing to converge within 100 iterations.
 *
 * @param lat1Deg Latitude of point 1 in decimal degrees.
 * @param lon1Deg Longitude of point 1 in decimal degrees.
 * @param lat2Deg Latitude of point 2 in decimal degrees.
 * @param lon2Deg Longitude of point 2 in decimal degrees.
 */
export function wgs84VincentyInverse(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number
): VincentyResult {
  validateFiniteNumber(lat1Deg, 'lat1Deg');
  validateFiniteNumber(lon1Deg, 'lon1Deg');
  validateFiniteNumber(lat2Deg, 'lat2Deg');
  validateFiniteNumber(lon2Deg, 'lon2Deg');
  validateLatLonRange(lat1Deg, lon1Deg);
  validateLatLonRange(lat2Deg, lon2Deg);

  // Exact coincident points check
  if (Math.abs(lat1Deg - lat2Deg) < 1e-12 && Math.abs(lon1Deg - lon2Deg) < 1e-12) {
    return {
      distanceM: 0.0,
      initialBearingDeg: 0.0,
      finalBearingDeg: 0.0,
      iterations: 0,
      converged: true,
    };
  }

  const phi1 = (lat1Deg * Math.PI) / 180.0;
  const lam1 = (lon1Deg * Math.PI) / 180.0;
  const phi2 = (lat2Deg * Math.PI) / 180.0;
  const lam2 = (lon2Deg * Math.PI) / 180.0;

  const U1 = Math.atan((1.0 - WGS84_F) * Math.tan(phi1));
  const U2 = Math.atan((1.0 - WGS84_F) * Math.tan(phi2));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  const L = lam2 - lam1;
  let lam = L;
  let iterations = 0;
  let converged = false;

  let sinSigma = 0.0;
  let cosSigma = 0.0;
  let sigma = 0.0;
  let sinAlpha = 0.0;
  let cosSqAlpha = 0.0;
  let cos2SigmaM = 0.0;
  let C = 0.0;

  for (let i = 0; i < 100; i++) {
    iterations++;
    const sinLam = Math.sin(lam);
    const cosLam = Math.cos(lam);

    sinSigma = Math.hypot(
      cosU2 * sinLam,
      cosU1 * sinU2 - sinU1 * cosU2 * cosLam
    );

    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLam;

    if (sinSigma < 1e-15) {
      if (cosSigma < 0.0) {
        // Exact antipodal points: break out of iteration loop to fall through to spherical fallback
        break;
      }
      return {
        distanceM: 0.0,
        initialBearingDeg: 0.0,
        finalBearingDeg: 0.0,
        iterations,
        converged: true,
      };
    }

    sigma = Math.atan2(sinSigma, cosSigma);

    sinAlpha = (cosU1 * cosU2 * sinLam) / sinSigma;
    cosSqAlpha = 1.0 - sinAlpha * sinAlpha;

    cos2SigmaM = cosSqAlpha !== 0.0
      ? cosSigma - (2.0 * sinU1 * sinU2) / cosSqAlpha
      : 0.0;

    C = (WGS84_F / 16.0) * cosSqAlpha * (4.0 + WGS84_F * (4.0 - 3.0 * cosSqAlpha));
    const lamPrev = lam;
    lam = L + (1.0 - C) * WGS84_F * sinAlpha * (
      sigma + C * sinSigma * (
        cos2SigmaM + C * cosSigma * (-1.0 + 2.0 * cos2SigmaM * cos2SigmaM)
      )
    );

    if (Math.abs(lam - lamPrev) < 1e-12) {
      converged = true;
      break;
    }
  }

  // Graceful fallback for nearly antipodal points
  if (!converged) {
    const R = (2.0 * WGS84_A_M + WGS84_B_M) / 3.0;
    const dPhi = phi2 - phi1;
    const dLam = lam2 - lam1;
    const hav = Math.sin(dPhi / 2.0) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2.0) ** 2;
    const c = 2.0 * Math.atan2(Math.sqrt(hav), Math.sqrt(Math.max(0.0, 1.0 - hav)));
    const distanceM = R * c;

    const y = Math.sin(dLam) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
    const initialBearingDeg = ((Math.atan2(y, x) * 180.0) / Math.PI + 360.0) % 360.0;
    return {
      distanceM,
      initialBearingDeg,
      finalBearingDeg: (initialBearingDeg + 180.0) % 360.0,
      iterations,
      converged: false,
    };
  }

  const uSq = cosSqAlpha * ((WGS84_A_M * WGS84_A_M - WGS84_B_M * WGS84_B_M) / (WGS84_B_M * WGS84_B_M));
  const A = 1.0 + (uSq / 16384.0) * (4096.0 + uSq * (-768.0 + uSq * (320.0 - 175.0 * uSq)));
  const B = (uSq / 1024.0) * (256.0 + uSq * (-128.0 + uSq * (74.0 - 47.0 * uSq)));

  const deltaSigma = B * sinSigma * (
    cos2SigmaM + (B / 4.0) * (
      cosSigma * (-1.0 + 2.0 * cos2SigmaM * cos2SigmaM) -
      (B / 6.0) * cos2SigmaM * (-3.0 + 4.0 * sinSigma * sinSigma) * (-3.0 + 4.0 * cos2SigmaM * cos2SigmaM)
    )
  );

  const s = WGS84_B_M * A * (sigma - deltaSigma);

  const alpha1 = Math.atan2(
    cosU2 * Math.sin(lam),
    cosU1 * sinU2 - sinU1 * cosU2 * Math.cos(lam)
  );
  const alpha2 = Math.atan2(
    cosU1 * Math.sin(lam),
    -sinU1 * cosU2 + cosU1 * sinU2 * Math.cos(lam)
  );

  const initialBearingDeg = ((alpha1 * 180.0) / Math.PI + 360.0) % 360.0;
  const finalBearingDeg = ((alpha2 * 180.0) / Math.PI + 360.0) % 360.0;

  return {
    distanceM: s,
    initialBearingDeg,
    finalBearingDeg,
    iterations,
    converged: true,
  };
}

// =================================================================================================
// 10. True 3D ECEF Slant Range & Topocentric Look Angles
// =================================================================================================

/**
 * Computes exact 3D ECEF chord distance (slant range), local topocentric Tx azimuth,
 * true elevation angle (accounting for Earth curvature dip), and ellipsoidal ground arc.
 *
 * @param txLatDeg Transmitter latitude in decimal degrees.
 * @param txLonDeg Transmitter longitude in decimal degrees.
 * @param txAltM Transmitter altitude MSL/ellipsoidal in metres.
 * @param rxLatDeg Receiver latitude in decimal degrees.
 * @param rxLonDeg Receiver longitude in decimal degrees.
 * @param rxAltM Receiver altitude MSL/ellipsoidal in metres.
 */
export function wgs84SlantRangeAndLookAngles(
  txLatDeg: number,
  txLonDeg: number,
  txAltM: number,
  rxLatDeg: number,
  rxLonDeg: number,
  rxAltM: number
): SlantRangeLookAngles {
  validateFiniteNumber(txLatDeg, 'txLatDeg');
  validateFiniteNumber(txLonDeg, 'txLonDeg');
  validateFiniteNumber(txAltM, 'txAltM');
  validateFiniteNumber(rxLatDeg, 'rxLatDeg');
  validateFiniteNumber(rxLonDeg, 'rxLonDeg');
  validateFiniteNumber(rxAltM, 'rxAltM');
  validateLatLonRange(txLatDeg, txLonDeg);
  validateLatLonRange(rxLatDeg, rxLonDeg);

  const pTx = geodeticToEcef(txLatDeg, txLonDeg, txAltM);
  const pRx = geodeticToEcef(rxLatDeg, rxLonDeg, rxAltM);

  const dx = pRx.x - pTx.x;
  const dy = pRx.y - pTx.y;
  const dz = pRx.z - pTx.z;

  const slantRangeM = Math.hypot(dx, dy, dz);

  // Rotate displacement vector into local topocentric Tx ENU frame
  const phiTx = (txLatDeg * Math.PI) / 180.0;
  const lamTx = (txLonDeg * Math.PI) / 180.0;
  const sinPhiTx = Math.sin(phiTx);
  const cosPhiTx = Math.cos(phiTx);
  const sinLamTx = Math.sin(lamTx);
  const cosLamTx = Math.cos(lamTx);

  const e = -sinLamTx * dx + cosLamTx * dy;
  const n = -sinPhiTx * cosLamTx * dx - sinPhiTx * sinLamTx * dy + cosPhiTx * dz;
  const u = cosPhiTx * cosLamTx * dx + cosPhiTx * sinLamTx * dy + sinPhiTx * dz;

  const azimuthDeg = ((Math.atan2(e, n) * 180.0) / Math.PI + 360.0) % 360.0;
  const horizDist = Math.hypot(e, n);
  const elevationDeg = (Math.atan2(u, Math.max(horizDist, 0.001)) * 180.0) / Math.PI;

  const groundArcM = wgs84VincentyInverse(txLatDeg, txLonDeg, rxLatDeg, rxLonDeg).distanceM;

  return {
    slantRangeM,
    azimuthDeg,
    elevationDeg,
    groundArcM,
  };
}

// =================================================================================================
// 11. Preserved Backward-Compatible Functions (DEM Linear Mapping & Mode Option)
// =================================================================================================

export type GeodesyProjectionMode = 'equirectangular' | 'wgs84-enu';

/**
 * Projects local Cartesian coordinates (metres from origin) to WGS-84 geographic coordinates (degrees).
 *
 * Defaults to 'equirectangular' (Plate Carrée with standard parallel) preserving 100% exact numerical
 * parity with TerrainEngine, DEM elevation indexing, and M7.1 verification tests (< 1e-12 tolerance).
 * When mode is 'wgs84-enu', uses surface-constrained WGS-84 ENU.
 *
 * @param xM Easting offset in metres (+X East, -X West).
 * @param yM Northing offset in metres (+Y North, -Y South).
 * @param mode Projection mode ('equirectangular' or 'wgs84-enu', default 'equirectangular').
 * @returns Geodetic coordinates (latDeg, lonDeg) and DEM coverage flag.
 * @throws TypeError if xM or yM are not finite numbers.
 */
export function cartesianToGeodetic(
  xM: number,
  yM: number,
  mode: GeodesyProjectionMode = 'equirectangular'
): GeodeticCoordinate {
  validateFiniteNumber(xM, 'xM');
  validateFiniteNumber(yM, 'yM');

  let latDeg: number;
  let lonDeg: number;

  if (mode === 'wgs84-enu') {
    const geo = enuToGeodetic2D(xM, yM, GEODESY_ORIGIN_LAT_DEG, GEODESY_ORIGIN_LON_DEG);
    latDeg = geo.latDeg;
    lonDeg = geo.lonDeg;
  } else {
    latDeg = GEODESY_ORIGIN_LAT_DEG + yM / METERS_PER_DEG_LAT;
    lonDeg = GEODESY_ORIGIN_LON_DEG + xM / METERS_PER_DEG_LON;
  }

  const isWithinCoverage =
    Math.abs(xM) <= DEM_COVERAGE_HALF_WIDTH_M &&
    Math.abs(yM) <= DEM_COVERAGE_HALF_HEIGHT_M;

  return { latDeg, lonDeg, isWithinCoverage };
}

/**
 * Projects WGS-84 geographic coordinates (degrees) to local Cartesian coordinates (metres from origin).
 *
 * Defaults to 'equirectangular' (exact linear inverse of cartesianToGeodetic).
 * When mode is 'wgs84-enu', uses surface-constrained WGS-84 ENU.
 *
 * @param latDeg Latitude in decimal degrees [-90.0, +90.0].
 * @param lonDeg Longitude in decimal degrees [-180.0, +180.0].
 * @param mode Projection mode ('equirectangular' or 'wgs84-enu', default 'equirectangular').
 * @returns Local Cartesian coordinates (xM, yM) and DEM coverage flag.
 * @throws RangeError if latitude is outside [-90, 90] or longitude outside [-180, 180].
 * @throws TypeError if latDeg or lonDeg are not finite numbers.
 */
export function geodeticToCartesian(
  latDeg: number,
  lonDeg: number,
  mode: GeodesyProjectionMode = 'equirectangular'
): CartesianCoordinate {
  validateFiniteNumber(latDeg, 'latDeg');
  validateFiniteNumber(lonDeg, 'lonDeg');
  validateLatLonRange(latDeg, lonDeg);

  let xM: number;
  let yM: number;

  if (mode === 'wgs84-enu') {
    const cart = geodeticToEnu2D(latDeg, lonDeg, GEODESY_ORIGIN_LAT_DEG, GEODESY_ORIGIN_LON_DEG);
    xM = cart.eastM;
    yM = cart.northM;
  } else {
    xM = (lonDeg - GEODESY_ORIGIN_LON_DEG) * METERS_PER_DEG_LON;
    yM = (latDeg - GEODESY_ORIGIN_LAT_DEG) * METERS_PER_DEG_LAT;
  }

  const isWithinCoverage =
    latDeg >= DEM_MIN_LAT_DEG &&
    latDeg <= DEM_MAX_LAT_DEG &&
    lonDeg >= DEM_MIN_LON_DEG &&
    lonDeg <= DEM_MAX_LON_DEG;

  return { xM, yM, isWithinCoverage };
}

// =================================================================================================
// 12. Geodetic String Formatters
// =================================================================================================

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
