/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * SRTM HGT Elevation Data Parser & Geographic Integration
 *
 * Supports:
 *   - SRTM3: 1201 x 1201 samples (3 arc-second ~90m), 2,884,802 bytes
 *   - SRTM1: 3601 x 3601 samples (1 arc-second ~30m), 25,934,402 bytes
 *   - Signed 16-bit big-endian integers (Int16BE)
 *   - Standard SRTM void handling (-32768 / 0x8000 mapped to NaN)
 *   - Standard 1-degree tile georeferencing ([NS]\d{2}[EW]\d{3})
 *   - Local Equirectangular projection relative to theater origin (34.5°N, 76.5°E)
 */

import type { DemGeographicMetadata } from './terrain';

export const SRTM3_SAMPLE_COUNT = 1201;
export const SRTM3_BYTE_LENGTH = 1201 * 1201 * 2; // 2,884,802 bytes

export const SRTM1_SAMPLE_COUNT = 3601;
export const SRTM1_BYTE_LENGTH = 3601 * 3601 * 2; // 25,934,402 bytes

export const SRTM_VOID_VALUE = -32768; // 0x8000

// Standard WGS-84 metric constants at standard parallel phi0 = 34.5°N
export const HGT_METERS_PER_DEG_LAT = 110931.4506;
export const HGT_METERS_PER_DEG_LON = 91839.9774;
export const THEATER_ORIGIN_LAT_DEG = 34.5;
export const THEATER_ORIGIN_LON_DEG = 76.5;

export interface SrtmTileCoordinates {
  readonly tileName: string;
  readonly isNorth: boolean;
  readonly isEast: boolean;
  readonly latInt: number;
  readonly lonInt: number;
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
  readonly centerLatDeg: number;
  readonly centerLonDeg: number;
}

export interface HgtResolutionInfo {
  readonly resolution: 'SRTM1' | 'SRTM3';
  readonly sampleCount: number;
}

export interface HgtDecodeResult {
  readonly elevations: Float32Array;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly voidCount: number;
  readonly validCount: number;
}

export interface HgtParseResult {
  readonly success: boolean;
  readonly error?: string;
  readonly resolution?: 'SRTM1' | 'SRTM3';
  readonly sampleCount?: number;
  readonly metadata?: DemGeographicMetadata;
  readonly elevations?: Float32Array;
  readonly minElevationM?: number;
  readonly maxElevationM?: number;
  readonly voidCount?: number;
  readonly validCount?: number;
}

/**
 * Detects whether buffer length matches standard SRTM1 or SRTM3 byte lengths.
 * Returns null if size does not match either.
 */
export function detectHgtResolution(byteLength: number): HgtResolutionInfo | null {
  if (byteLength === SRTM3_BYTE_LENGTH) {
    return { resolution: 'SRTM3', sampleCount: SRTM3_SAMPLE_COUNT };
  }
  if (byteLength === SRTM1_BYTE_LENGTH) {
    return { resolution: 'SRTM1', sampleCount: SRTM1_SAMPLE_COUNT };
  }
  return null;
}

/**
 * Parses SRTM 1-degree tile naming convention from filename or path.
 * Format: [NS]\d{2}[EW]\d{3}(\.hgt)? (case-insensitive)
 *
 * The coordinate in the tile name specifies the South-West corner of the tile.
 * For example:
 *   N34E076 spans [34.0°N, 35.0°N] latitude and [76.0°E, 77.0°E] longitude.
 *   S12W077 spans [-12.0°N, -11.0°N] latitude and [-77.0°E, -76.0°E] longitude.
 */
export function parseSrtmTileName(filenameOrPath: string): SrtmTileCoordinates | null {
  if (!filenameOrPath || typeof filenameOrPath !== 'string') {
    return null;
  }

  // Extract base filename without directory path
  const baseName = filenameOrPath.split(/[/\\]/).pop() ?? filenameOrPath;
  const match = baseName.match(/([NSns])(\d{2})([EWew])(\d{3})/i);
  if (!match) {
    return null;
  }

  const latHemi = match[1].toUpperCase();
  const latVal = parseInt(match[2], 10);
  const lonHemi = match[3].toUpperCase();
  const lonVal = parseInt(match[4], 10);

  if (isNaN(latVal) || isNaN(lonVal)) {
    return null;
  }

  if (latVal < 0 || latVal > 89) {
    return null;
  }

  if (lonVal < 0 || lonVal > 179) {
    return null;
  }

  const isNorth = latHemi === 'N';
  const isEast = lonHemi === 'E';

  const minLatDeg = isNorth ? latVal : -latVal;
  const maxLatDeg = minLatDeg + 1.0;
  const minLonDeg = isEast ? lonVal : -lonVal;
  const maxLonDeg = minLonDeg + 1.0;

  const centerLatDeg = minLatDeg + 0.5;
  const centerLonDeg = minLonDeg + 0.5;

  const paddedLat = String(latVal).padStart(2, '0');
  const paddedLon = String(lonVal).padStart(3, '0');
  const tileName = `${latHemi}${paddedLat}${lonHemi}${paddedLon}`;

  return {
    tileName,
    isNorth,
    isEast,
    latInt: latVal,
    lonInt: lonVal,
    minLatDeg,
    maxLatDeg,
    minLonDeg,
    maxLonDeg,
    centerLatDeg,
    centerLonDeg,
  };
}

/**
 * Decodes signed 16-bit big-endian samples from SRTM buffer into Float32Array.
 * Voids (-32768) are converted to Number.NaN for safe propagation checks.
 */
export function decodeHgtBuffer(
  buffer: ArrayBuffer | Uint8Array,
  sampleCount: number
): HgtDecodeResult {
  const totalSamples = sampleCount * sampleCount;
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const elevations = new Float32Array(totalSamples);

  let minElev = Number.POSITIVE_INFINITY;
  let maxElev = Number.NEGATIVE_INFINITY;
  let voidCount = 0;
  let validCount = 0;

  for (let i = 0; i < totalSamples; i++) {
    const b0 = uint8[i * 2];
    const b1 = uint8[i * 2 + 1];
    const raw = (b0 << 8) | b1;
    // Sign-extension for 16-bit signed integer
    const int16 = (raw << 16) >> 16;

    if (int16 === SRTM_VOID_VALUE) {
      elevations[i] = Number.NaN;
      voidCount++;
    } else {
      elevations[i] = int16;
      validCount++;
      if (int16 < minElev) minElev = int16;
      if (int16 > maxElev) maxElev = int16;
    }
  }

  return {
    elevations,
    minElevationM: Number.isFinite(minElev) ? minElev : 0,
    maxElevationM: Number.isFinite(maxElev) ? maxElev : 0,
    voidCount,
    validCount,
  };
}

/**
 * Derives georeferenced DemGeographicMetadata for an SRTM tile in local Cartesian coordinates
 * relative to the theater origin (34.5°N, 76.5°E).
 */
export function createHgtGeographicMetadata(
  coords: SrtmTileCoordinates,
  sampleCount: number,
  minElev: number,
  maxElev: number,
  voidCount: number
): DemGeographicMetadata {
  const minX = (coords.minLonDeg - THEATER_ORIGIN_LON_DEG) * HGT_METERS_PER_DEG_LON;
  const maxX = (coords.maxLonDeg - THEATER_ORIGIN_LON_DEG) * HGT_METERS_PER_DEG_LON;
  const minY = (coords.minLatDeg - THEATER_ORIGIN_LAT_DEG) * HGT_METERS_PER_DEG_LAT;
  const maxY = (coords.maxLatDeg - THEATER_ORIGIN_LAT_DEG) * HGT_METERS_PER_DEG_LAT;
  const halfWidthM = (maxX - minX) / 2.0;
  const halfHeightM = (maxY - minY) / 2.0;

  return {
    rasterWidth: sampleCount,
    rasterHeight: sampleCount,
    centerLatDeg: coords.centerLatDeg,
    centerLonDeg: coords.centerLonDeg,
    minLatDeg: coords.minLatDeg,
    maxLatDeg: coords.maxLatDeg,
    minLonDeg: coords.minLonDeg,
    maxLonDeg: coords.maxLonDeg,
    halfWidthM,
    halfHeightM,
    groundResolutionXM: (maxX - minX) / (sampleCount - 1),
    groundResolutionYM: (maxY - minY) / (sampleCount - 1),
    minX,
    maxX,
    minY,
    maxY,
    tileName: coords.tileName,
    minElevationM: minElev,
    maxElevationM: maxElev,
    voidCount,
  };
}

/**
 * End-to-end SRTM HGT buffer parser.
 * Validates dimensions, decodes Int16BE elevations, handles voids, and georeferences the tile.
 */
export function parseHgtBuffer(
  filenameOrPath: string,
  buffer: ArrayBuffer | Uint8Array,
  fallbackCoords?: SrtmTileCoordinates
): HgtParseResult {
  const byteLength = buffer.byteLength;
  const resInfo = detectHgtResolution(byteLength);

  if (!resInfo) {
    return {
      success: false,
      error: `Invalid HGT file size (${byteLength.toLocaleString()} bytes). Expected SRTM3 (2,884,802 bytes for 1201×1201) or SRTM1 (25,934,402 bytes for 3601×3601).`,
    };
  }

  let coords = parseSrtmTileName(filenameOrPath);
  if (!coords) {
    if (fallbackCoords) {
      coords = fallbackCoords;
    } else {
      // If filename does not contain SRTM tile coordinates, default to standard Ladakh theater tile N34E076
      coords = parseSrtmTileName('N34E076.hgt')!;
    }
  }

  const decode = decodeHgtBuffer(buffer, resInfo.sampleCount);
  const metadata = createHgtGeographicMetadata(
    coords,
    resInfo.sampleCount,
    decode.minElevationM,
    decode.maxElevationM,
    decode.voidCount
  );

  return {
    success: true,
    resolution: resInfo.resolution,
    sampleCount: resInfo.sampleCount,
    metadata,
    elevations: decode.elevations,
    minElevationM: decode.minElevationM,
    maxElevationM: decode.maxElevationM,
    voidCount: decode.voidCount,
    validCount: decode.validCount,
  };
}

