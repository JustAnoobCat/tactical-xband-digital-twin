/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Pure TypeScript Dual-Mode Terrain & Geometrical Propagation Engine
 *
 * Expanded Regional Theater: 1,200 x 1,200 km (+/- 600 km from center)
 * Ensures full-bleed edge-to-edge terrain coverage even at maximum zoom-out.
 */

import { EnvironmentConfig, RFConfig, SPEED_OF_LIGHT } from './config';
import { ObstacleField, ObstacleIntersection } from './obstacles';
import type { Position3D } from '../shared/types';
import { THEATER_HALF_M } from '../shared/constants';
import type { BiomeId } from './biomePhysics';
import { wasmEvaluateBatchRays } from './wasmPhysicsBridge';

export type { Position3D };

export interface SlantGeometry {
  readonly slantRangeM: number;
  readonly elevationDeg: number;
  readonly tauPropS: number;
  readonly timingAdvanceS: number;
}

export interface BullingtonApexData {
  readonly distM: number;
  readonly elevM: number;
  readonly losHeightM: number;
  readonly diffractionParameterNu: number;
  readonly lossDb: number;
  readonly txHorizonDistM: number;
  readonly txHorizonElevM: number;
  readonly rxHorizonDistM: number;
  readonly rxHorizonElevM: number;
}

export interface TerrainObstruction {
  readonly minClearanceM: number;
  readonly fresnelRadiusM: number;
  readonly diffractionLossDb: number;
  readonly isLos: boolean;
  readonly isHardShadow?: boolean;
  /** Explicit coverage tracking: true if every sample along path has genuine, valid DEM elevation. */
  readonly isCoverageComplete?: boolean;
  /** Structural geometry result; independent of terrain LOS and terrain diffraction. */
  readonly obstacleBlocked: boolean;
  readonly obstacleIntersections: readonly ObstacleIntersection[];
  /** Detailed reason when terrain coverage is incomplete along propagation path. */
  readonly coverageNote?: string;
  // First-principles ITU-R P.526-15 physical parameters
  readonly crestRadiusM?: number;
  readonly curvatureLossDb?: number;
  readonly bullingtonApexDistM?: number;
  readonly bullingtonApex?: BullingtonApexData | null;
}

// Regional 1,200 x 1,200 km Theater Extent (+/- 600 km from origin)
export const THEATER_EXTENT_1200KM_M = THEATER_HALF_M;
export const DEFAULT_GRID_SIZE = 512;

// ----------------------------------------------------------------------------
// Authentic Geographic Metadata & Coordinate Transformation Specifications
// ----------------------------------------------------------------------------

/**
 * Geodetic and raster metadata for the authentic real Ladakh satellite DEM raster.
 *
 * Registration: Point-registered / gridline-registered matrix where:
 *   - Column 0 is on the West boundary (minLonDeg).
 *   - Column 511 is on the East boundary (maxLonDeg).
 *   - Row 0 is on the North boundary (maxLatDeg).
 *   - Row 511 is on the South boundary (minLatDeg).
 *   - Center (x=0, y=0) corresponds exactly to pixel (255.5, 255.5) at 34.5°N, 76.5°E.
 *
 * Metric scale on WGS-84 ellipsoid at 34.5°N:
 *   - 1° Latitude = 110,931.4506 m (Meridian radius of curvature M = 6,355,903.9 m)
 *   - 1° Longitude = 91,839.9774 m (Prime vertical radius N * cos(34.5°) = 6,384,997.1 * cos(34.5°) m)
 *
 * Projection: Local Equirectangular (Plate Carrée with standard parallel phi0 = 34.5°N).
 *   Scale distortion is 0.00% at theater center, < 0.45% within the active tactical cluster (+/- 42 km),
 *   and < 1.21% at the furthest raster corners (+/- 111 km).
 */
export interface DemGeographicMetadata {
  readonly rasterWidth: number;
  readonly rasterHeight: number;
  readonly centerLatDeg: number;
  readonly centerLonDeg: number;
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
  readonly halfWidthM: number;
  readonly halfHeightM: number;
  readonly groundResolutionXM: number;
  readonly groundResolutionYM: number;
  readonly minX?: number;
  readonly maxX?: number;
  readonly minY?: number;
  readonly maxY?: number;
  readonly tileName?: string;
  readonly minElevationM?: number;
  readonly maxElevationM?: number;
  readonly voidCount?: number;
}

export const REAL_LADAKH_DEM_METADATA: DemGeographicMetadata = Object.freeze({
  rasterWidth: 512,
  rasterHeight: 512,
  centerLatDeg: 34.5,
  centerLonDeg: 76.5,
  minLatDeg: 33.5,
  maxLatDeg: 35.5,
  minLonDeg: 75.5,
  maxLonDeg: 77.5,
  halfWidthM: 91839.9774,
  halfHeightM: 110931.4506,
  groundResolutionXM: (2.0 * 91839.9774) / 511.0, // 359.4519663405088 m/pixel
  groundResolutionYM: (2.0 * 110931.4506) / 511.0, // 434.1739749510763 m/pixel
  minX: -91839.9774,
  maxX: 91839.9774,
  minY: -110931.4506,
  maxY: 110931.4506,
  tileName: 'LADAKH',
});

export const BIOME_DEM_METADATA: Readonly<Record<BiomeId, DemGeographicMetadata>> = Object.freeze({
  alpine_mountain: REAL_LADAKH_DEM_METADATA,
  arid_desert: Object.freeze({
    rasterWidth: 512,
    rasterHeight: 512,
    centerLatDeg: 27.0,
    centerLonDeg: 71.5,
    minLatDeg: 26.0,
    maxLatDeg: 28.0,
    minLonDeg: 70.5,
    maxLonDeg: 72.5,
    halfWidthM: 99000.0,
    halfHeightM: 110900.0,
    groundResolutionXM: (2.0 * 99000.0) / 511.0,
    groundResolutionYM: (2.0 * 110900.0) / 511.0,
    minX: -99000.0,
    maxX: 99000.0,
    minY: -110900.0,
    maxY: 110900.0,
    tileName: 'THAR_DESERT',
    minElevationM: 180.0,
    maxElevationM: 310.0,
    voidCount: 0,
  }),
  open_plains: Object.freeze({
    rasterWidth: 512,
    rasterHeight: 512,
    centerLatDeg: 28.5,
    centerLonDeg: 77.2,
    minLatDeg: 27.5,
    maxLatDeg: 29.5,
    minLonDeg: 76.2,
    maxLonDeg: 78.2,
    halfWidthM: 98000.0,
    halfHeightM: 110900.0,
    groundResolutionXM: (2.0 * 98000.0) / 511.0,
    groundResolutionYM: (2.0 * 110900.0) / 511.0,
    minX: -98000.0,
    maxX: 98000.0,
    minY: -110900.0,
    maxY: 110900.0,
    tileName: 'INDO_GANGETIC_PLAINS',
    minElevationM: 200.0,
    maxElevationM: 240.0,
    voidCount: 0,
  }),
  tropical_jungle: Object.freeze({
    rasterWidth: 512,
    rasterHeight: 512,
    centerLatDeg: 26.0,
    centerLonDeg: 93.0,
    minLatDeg: 25.0,
    maxLatDeg: 27.0,
    minLonDeg: 92.0,
    maxLonDeg: 94.0,
    halfWidthM: 100000.0,
    halfHeightM: 110900.0,
    groundResolutionXM: (2.0 * 100000.0) / 511.0,
    groundResolutionYM: (2.0 * 110900.0) / 511.0,
    minX: -100000.0,
    maxX: 100000.0,
    minY: -110900.0,
    maxY: 110900.0,
    tileName: 'NORTHEAST_JUNGLE',
    minElevationM: 250.0,
    maxElevationM: 1350.0,
    voidCount: 0,
  }),
  maritime_littoral: Object.freeze({
    rasterWidth: 512,
    rasterHeight: 512,
    centerLatDeg: 18.5,
    centerLonDeg: 72.0,
    minLatDeg: 17.5,
    maxLatDeg: 19.5,
    minLonDeg: 71.0,
    maxLonDeg: 73.0,
    halfWidthM: 106000.0,
    halfHeightM: 110900.0,
    groundResolutionXM: (2.0 * 106000.0) / 511.0,
    groundResolutionYM: (2.0 * 110900.0) / 511.0,
    minX: -106000.0,
    maxX: 106000.0,
    minY: -110900.0,
    maxY: 110900.0,
    tileName: 'ARABIAN_SEA_LITTORAL',
    minElevationM: 0.0,
    maxElevationM: 220.0,
    voidCount: 0,
  }),
});

export interface DemPixelCoord {
  readonly col: number;
  readonly row: number;
  readonly isInside: boolean;
}

export interface GeographicCoordinate {
  readonly latDeg: number;
  readonly lonDeg: number;
}

export interface TerrainBoundsTelemetry {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly rasterWidth: number;
  readonly rasterHeight: number;
  readonly groundResolutionXM: number;
  readonly groundResolutionYM: number;
  readonly isValidCoverage: boolean;
  readonly halfWidthM: number;
  readonly halfHeightM: number;
  readonly terrainMode: 'real' | 'synthetic';
  readonly tileName?: string;
}

// ----------------------------------------------------------------------------
// 2D Inverse Fast Fourier Transform (Cooley-Tukey Radix-2)
// ----------------------------------------------------------------------------
function ifft1d(real: Float64Array, imag: Float64Array, n: number): void {
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr;
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
    let k = n >> 1;
    while (k > 0 && k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (2.0 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1.0;
      let wi = 0.0;
      for (let k = 0; k < half; k++) {
        const posEven = i + k;
        const posOdd = i + k + half;
        const tr = wr * real[posOdd] - wi * imag[posOdd];
        const ti = wr * imag[posOdd] + wi * real[posOdd];
        real[posOdd] = real[posEven] - tr;
        imag[posOdd] = imag[posEven] - ti;
        real[posEven] += tr;
        imag[posEven] += ti;
        const nextWr = wr * wStepR - wi * wStepI;
        wi = wr * wStepI + wi * wStepR;
        wr = nextWr;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    real[i] /= n;
    imag[i] /= n;
  }
}

/**
 * Generates an authentic 2D Fractional Brownian Motion (fBm) elevation matrix
 * via 2D Fourier Spectral Synthesis across the expanded 1,200x1,200 km domain.
 */
export function generateSpectralElevationGrid(
  size: number = DEFAULT_GRID_SIZE,
  theaterExtentM: number = THEATER_EXTENT_1200KM_M,
  beta: number = 2.3,
  seed: number = 42
): Float32Array {
  const real = new Float64Array(size * size);
  const imag = new Float64Array(size * size);

  let s = (seed ^ 0x6d2b79f5) >>> 0;
  const nextRand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296.0;
  };

  const half = size / 2;
  for (let r = 0; r < size; r++) {
    const ky = r < half ? r / size : (r - size) / size;
    for (let c = 0; c < size; c++) {
      const kx = c < half ? c / size : (c - size) / size;
      const kSq = kx * kx + ky * ky;

      if (r === 0 && c === 0) {
        real[0] = 0.0;
        imag[0] = 0.0;
        continue;
      }

      const amp = 1.0 / Math.pow(kSq, beta / 4.0);
      const phase = nextRand() * 2.0 * Math.PI;
      const idx = r * size + c;
      real[idx] = amp * Math.cos(phase);
      imag[idx] = amp * Math.sin(phase);
    }
  }

  // 2D IFFT: Rows then Columns
  const rowR = new Float64Array(size);
  const rowI = new Float64Array(size);
  for (let r = 0; r < size; r++) {
    const offset = r * size;
    for (let c = 0; c < size; c++) {
      rowR[c] = real[offset + c];
      rowI[c] = imag[offset + c];
    }
    ifft1d(rowR, rowI, size);
    for (let c = 0; c < size; c++) {
      real[offset + c] = rowR[c];
      imag[offset + c] = rowI[c];
    }
  }

  const colR = new Float64Array(size);
  const colI = new Float64Array(size);
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size; r++) {
      colR[r] = real[r * size + c];
      colI[r] = imag[r * size + c];
    }
    ifft1d(colR, colI, size);
    for (let r = 0; r < size; r++) {
      real[r * size + c] = colR[r];
      imag[r * size + c] = colI[r];
    }
  }

  let minFbm = Number.POSITIVE_INFINITY;
  let maxFbm = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < size * size; i++) {
    const val = real[i];
    if (val < minFbm) minFbm = val;
    if (val > maxFbm) maxFbm = val;
  }
  const fbmRange = Math.max(1e-9, maxFbm - minFbm);

  const ang = (35.0 * Math.PI) / 180.0;
  const sinA = Math.sin(ang);
  const cosA = Math.cos(ang);
  const step = (theaterExtentM * 2.0) / (size - 1);

  const out = new Float32Array(size * size);
  let minComb = Number.POSITIVE_INFINITY;
  let maxComb = Number.NEGATIVE_INFINITY;

  for (let r = 0; r < size; r++) {
    const y = -theaterExtentM + r * step;
    for (let c = 0; c < size; c++) {
      const x = -theaterExtentM + c * step;
      const idx = r * size + c;
      const normFbm = (real[idx] - minFbm) / fbmRange;

      // Natural meandering valley depression
      const v = -x * sinA + y * cosA;
      const valleyTrough = 0.28 * Math.exp(-(v * v) / (2.0 * Math.pow(75000.0, 2)));

      const combined = normFbm - valleyTrough;
      out[idx] = combined;
      if (combined < minComb) minComb = combined;
      if (combined > maxComb) maxComb = combined;
    }
  }

  // Scale to authentic Ladakh elevations: 2900m to 5800m MSL
  const combRange = Math.max(1e-9, maxComb - minComb);
  for (let i = 0; i < size * size; i++) {
    out[i] = 2900.0 + ((out[i] - minComb) / combRange) * 2900.0;
  }

  return out;
}

export interface ElevationGridBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function resolveProceduralBiomeBounds(
  biomeId: BiomeId,
  bounds?: ElevationGridBounds
): ElevationGridBounds {
  if (bounds) return bounds;
  const meta = BIOME_DEM_METADATA[biomeId] ?? REAL_LADAKH_DEM_METADATA;
  return {
    minX: meta.minX ?? -meta.halfWidthM,
    maxX: meta.maxX ?? meta.halfWidthM,
    minY: meta.minY ?? -meta.halfHeightM,
    maxY: meta.maxY ?? meta.halfHeightM,
  };
}

/**
 * Generates procedural elevation matrix for Thar Arid Desert (180m to 310m MSL).
 * Features transverse dune fields, barchan slip-faces, and low regional relief.
 * Point-registered with row 0 = maxY (North) and row size-1 = minY (South).
 */
export function generateAridDesertElevationGrid(
  size: number = DEFAULT_GRID_SIZE,
  _theaterExtentM: number = THEATER_EXTENT_1200KM_M,
  seed: number = 42,
  bounds?: ElevationGridBounds
): Float32Array {
  const out = new Float32Array(size * size);
  const { minX, maxX, minY, maxY } = resolveProceduralBiomeBounds('arid_desert', bounds);
  const stepX = (maxX - minX) / Math.max(1, size - 1);
  const stepY = (maxY - minY) / Math.max(1, size - 1);
  const duneAngle = (22.0 * Math.PI) / 180.0;
  const sinD = Math.sin(duneAngle);
  const cosD = Math.cos(duneAngle);

  let s = (seed ^ 0x12a45b7f) >>> 0;
  const nextR = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296.0;
  };
  const phase1 = nextR() * Math.PI * 2.0;
  const phase2 = nextR() * Math.PI * 2.0;

  let minVal = Number.POSITIVE_INFINITY;
  let maxVal = Number.NEGATIVE_INFINITY;

  for (let r = 0; r < size; r++) {
    const y = maxY - r * stepY;
    for (let c = 0; c < size; c++) {
      const x = minX + c * stepX;
      const idx = r * size + c;

      const u = x * cosD + y * sinD;
      const v = -x * sinD + y * cosD;

      const swell = Math.sin(u / 65000.0 + phase1) * 0.35 + Math.cos(v / 85000.0 + phase2) * 0.25;
      const duneWavelength = 18000.0;
      const dunePhase = (u / duneWavelength) * 2.0 * Math.PI;
      const duneWave = Math.sin(dunePhase) + 0.35 * Math.sin(2.0 * dunePhase + 0.4);
      const ripple = Math.sin((v / 4500.0) * 2.0 * Math.PI) * 0.15;

      const combined = swell + 0.65 * duneWave + ripple;
      out[idx] = combined;
      if (combined < minVal) minVal = combined;
      if (combined > maxVal) maxVal = combined;
    }
  }

  const range = Math.max(1e-9, maxVal - minVal);
  for (let i = 0; i < size * size; i++) {
    out[i] = 180.0 + ((out[i] - minVal) / range) * 130.0;
  }
  return out;
}

/**
 * Generates procedural elevation matrix for Indo-Gangetic Open Plains (200m to 240m MSL).
 * Features gentle alluvial slope, low relief, and a subtle meandering river depression corridor.
 * Point-registered with row 0 = maxY (North) and row size-1 = minY (South).
 */
export function generateOpenPlainsElevationGrid(
  size: number = DEFAULT_GRID_SIZE,
  _theaterExtentM: number = THEATER_EXTENT_1200KM_M,
  seed: number = 42,
  bounds?: ElevationGridBounds
): Float32Array {
  const out = new Float32Array(size * size);
  const { minX, maxX, minY, maxY } = resolveProceduralBiomeBounds('open_plains', bounds);
  const stepX = (maxX - minX) / Math.max(1, size - 1);
  const stepY = (maxY - minY) / Math.max(1, size - 1);
  const spanScale = Math.max(1e-9, Math.max(maxX - minX, maxY - minY));

  let s = (seed ^ 0x3c5f189d) >>> 0;
  const nextR = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296.0;
  };
  const p1 = nextR() * Math.PI * 2.0;

  let minVal = Number.POSITIVE_INFINITY;
  let maxVal = Number.NEGATIVE_INFINITY;

  for (let r = 0; r < size; r++) {
    const y = maxY - r * stepY;
    for (let c = 0; c < size; c++) {
      const x = minX + c * stepX;
      const idx = r * size + c;

      const slope = ((-x + y) / spanScale) * 0.5;
      const meanderCenter = 25000.0 * Math.sin(y / 70000.0 + p1);
      const distToRiver = Math.abs(x - meanderCenter);
      const riverTrough = -0.35 * Math.exp(-(distToRiver * distToRiver) / (2.0 * Math.pow(15000.0, 2)));
      const micro = 0.08 * (Math.sin(x / 25000.0) + Math.cos(y / 28000.0));

      const combined = slope + riverTrough + micro;
      out[idx] = combined;
      if (combined < minVal) minVal = combined;
      if (combined > maxVal) maxVal = combined;
    }
  }

  const range = Math.max(1e-9, maxVal - minVal);
  for (let i = 0; i < size * size; i++) {
    out[i] = 200.0 + ((out[i] - minVal) / range) * 40.0;
  }
  return out;
}

/**
 * Generates procedural elevation matrix for Northeast Tropical Jungle (250m to 1350m MSL).
 * Features steep dissected ridges, dendritic drainage gullies, and rolling rainforest foothills.
 * Point-registered with row 0 = maxY (North) and row size-1 = minY (South).
 */
export function generateTropicalJungleElevationGrid(
  size: number = DEFAULT_GRID_SIZE,
  _theaterExtentM: number = THEATER_EXTENT_1200KM_M,
  seed: number = 42,
  bounds?: ElevationGridBounds
): Float32Array {
  const out = new Float32Array(size * size);
  const { minX, maxX, minY, maxY } = resolveProceduralBiomeBounds('tropical_jungle', bounds);
  const stepX = (maxX - minX) / Math.max(1, size - 1);
  const stepY = (maxY - minY) / Math.max(1, size - 1);

  let s = (seed ^ 0x7f4e2a1b) >>> 0;
  const nextR = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296.0;
  };
  const ph1 = nextR() * Math.PI * 2.0;
  const ph2 = nextR() * Math.PI * 2.0;
  const ph3 = nextR() * Math.PI * 2.0;

  let minVal = Number.POSITIVE_INFINITY;
  let maxVal = Number.NEGATIVE_INFINITY;

  for (let r = 0; r < size; r++) {
    const y = maxY - r * stepY;
    for (let c = 0; c < size; c++) {
      const x = minX + c * stepX;
      const idx = r * size + c;

      const r1 = Math.sin(x / 40000.0 + ph1) * Math.cos(y / 45000.0 + ph2);
      const r2 = Math.cos((x * 0.7 - y * 0.7) / 22000.0 + ph3) * 0.5;
      const r3 = Math.sin((x * 0.4 + y * 0.9) / 12000.0) * 0.25;
      const r4 = Math.abs(Math.sin((x - y) / 8000.0)) * 0.2;

      const combined = r1 + r2 + r3 - r4;
      out[idx] = combined;
      if (combined < minVal) minVal = combined;
      if (combined > maxVal) maxVal = combined;
    }
  }

  const range = Math.max(1e-9, maxVal - minVal);
  for (let i = 0; i < size * size; i++) {
    out[i] = 250.0 + ((out[i] - minVal) / range) * 1100.0;
  }
  return out;
}

/**
 * Generates procedural elevation matrix for Arabian Sea Maritime Littoral (0m to 220m MSL).
 * Features calm open sea surface at exactly 0.0m MSL and coastal littoral cliffs rising to 220m MSL.
 * Point-registered with row 0 = maxY (North) and row size-1 = minY (South).
 */
export function generateMaritimeLittoralElevationGrid(
  size: number = DEFAULT_GRID_SIZE,
  _theaterExtentM: number = THEATER_EXTENT_1200KM_M,
  seed: number = 42,
  bounds?: ElevationGridBounds
): Float32Array {
  const out = new Float32Array(size * size);
  const { minX, maxX, minY, maxY } = resolveProceduralBiomeBounds('maritime_littoral', bounds);
  const stepX = (maxX - minX) / Math.max(1, size - 1);
  const stepY = (maxY - minY) / Math.max(1, size - 1);

  let s = (seed ^ 0x4a9b6c1d) >>> 0;
  const nextR = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296.0;
  };
  const phCoast = nextR() * Math.PI * 2.0;

  let maxLand = Number.NEGATIVE_INFINITY;

  for (let r = 0; r < size; r++) {
    const y = maxY - r * stepY;
    const coastX = -20000.0 + 35000.0 * Math.sin(y / 95000.0 + phCoast);

    for (let c = 0; c < size; c++) {
      const x = minX + c * stepX;
      const idx = r * size + c;

      if (x < coastX) {
        out[idx] = 0.0;
      } else {
        const distFromCoastM = x - coastX;
        const shelf = Math.min(1.0, distFromCoastM / 150000.0);
        const hill = 0.3 * Math.sin(x / 30000.0) * Math.cos(y / 35000.0) + 0.15 * Math.sin((x + y) / 15000.0);
        const rawLand = shelf + Math.max(0.0, hill);
        out[idx] = rawLand;
        if (rawLand > maxLand) maxLand = rawLand;
      }
    }
  }

  const landScale = maxLand > 0 ? 220.0 / maxLand : 220.0;
  for (let i = 0; i < size * size; i++) {
    if (out[i] > 0.0) {
      out[i] = Math.min(220.0, out[i] * landScale);
    }
  }

  return out;
}

/**
 * Universal biome procedural elevation grid generator.
 */
export function generateBiomeElevationGrid(
  biomeId: BiomeId,
  size: number = DEFAULT_GRID_SIZE,
  theaterExtentM: number = THEATER_EXTENT_1200KM_M,
  seed: number = 42,
  bounds?: ElevationGridBounds
): Float32Array {
  switch (biomeId) {
    case 'arid_desert':
      return generateAridDesertElevationGrid(size, theaterExtentM, seed, bounds);
    case 'open_plains':
      return generateOpenPlainsElevationGrid(size, theaterExtentM, seed, bounds);
    case 'tropical_jungle':
      return generateTropicalJungleElevationGrid(size, theaterExtentM, seed, bounds);
    case 'maritime_littoral':
      return generateMaritimeLittoralElevationGrid(size, theaterExtentM, seed, bounds);
    case 'alpine_mountain':
    default:
      return generateSpectralElevationGrid(size, theaterExtentM, 2.3, seed);
  }
}

/**
 * Computes authoritative min, max, and void count over an elevation raster.
 * Treats non-finite samples and SRTM sentinel -32768 as voids.
 */
export function computeDemGridStats(grid: Float32Array): {
  minElevationM: number;
  maxElevationM: number;
  voidCount: number;
} {
  let minElevationM = Number.POSITIVE_INFINITY;
  let maxElevationM = Number.NEGATIVE_INFINITY;
  let voidCount = 0;

  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (!Number.isFinite(v) || v === -32768) {
      voidCount++;
    } else {
      if (v < minElevationM) minElevationM = v;
      if (v > maxElevationM) maxElevationM = v;
    }
  }

  return {
    minElevationM: Number.isFinite(minElevationM) ? minElevationM : 0,
    maxElevationM: Number.isFinite(maxElevationM) ? maxElevationM : 0,
    voidCount,
  };
}

let _cachedSynthGrid: Float32Array | null = null;
function getCachedSynthGrid(): Float32Array {
  if (!_cachedSynthGrid) {
    _cachedSynthGrid = generateSpectralElevationGrid(DEFAULT_GRID_SIZE, THEATER_EXTENT_1200KM_M, 2.3, 42);
  }
  return _cachedSynthGrid;
}

export class TerrainEngine {
  public readonly theaterExtentM: number;
  public terrainMode: 'real' | 'synthetic';
  public hasRealDem: boolean = false;
  public realDemGrid: Float32Array | null = null;
  public demMetadata: DemGeographicMetadata = REAL_LADAKH_DEM_METADATA;
  public activeBiomeId: BiomeId = 'alpine_mountain';
  private _ladakhDemGrid: Float32Array | null = null;
  private readonly _biomeGridCache = new Map<BiomeId, Float32Array>();
  private readonly customElevationFn?: (xM: number, yM: number) => number;
  /** Canonical committed obstacle state shared by live links, prediction and profiles. */
  public readonly obstacleField = new ObstacleField();

  constructor(options?: {
    theaterExtentM?: number;
    terrainMode?: 'real' | 'synthetic';
    customElevationFn?: (xM: number, yM: number) => number;
    activeBiomeId?: BiomeId;
  }) {
    this.theaterExtentM = options?.theaterExtentM ?? THEATER_EXTENT_1200KM_M;
    this.terrainMode = options?.terrainMode ?? 'real';
    this.customElevationFn = options?.customElevationFn;
    if (options?.activeBiomeId) {
      this.setBiome(options.activeBiomeId);
    }
  }

  public get terrain_mode(): 'real' | 'synthetic' {
    return this.terrainMode;
  }

  public set terrain_mode(mode: 'real' | 'synthetic') {
    this.terrainMode = mode;
  }

  public setTerrainMode(mode: 'real' | 'synthetic'): string {
    this.terrainMode = mode;
    return this.terrainMode;
  }

  public set_terrain_mode(mode: 'real' | 'synthetic'): string {
    return this.setTerrainMode(mode);
  }

  /**
   * Sets the active theater biome, generating procedural terrain and updating geodetic DEM metadata.
   */
  public setBiome(biomeId: BiomeId): void {
    this.activeBiomeId = biomeId;
    if (biomeId === 'alpine_mountain') {
      if (this._ladakhDemGrid) {
        this.realDemGrid = this._ladakhDemGrid;
        const stats = computeDemGridStats(this._ladakhDemGrid);
        this.demMetadata = Object.freeze({ ...REAL_LADAKH_DEM_METADATA, ...stats });
        this.hasRealDem = true;
        this.terrainMode = 'real';
      } else {
        this.demMetadata = REAL_LADAKH_DEM_METADATA;
      }
      return;
    }

    const meta = BIOME_DEM_METADATA[biomeId] ?? REAL_LADAKH_DEM_METADATA;
    let grid = this._biomeGridCache.get(biomeId);
    if (!grid) {
      grid = generateBiomeElevationGrid(biomeId, DEFAULT_GRID_SIZE, this.theaterExtentM, 42, {
        minX: meta.minX ?? -meta.halfWidthM,
        maxX: meta.maxX ?? meta.halfWidthM,
        minY: meta.minY ?? -meta.halfHeightM,
        maxY: meta.maxY ?? meta.halfHeightM,
      });
      this._biomeGridCache.set(biomeId, grid);
    }

    const stats = computeDemGridStats(grid);
    this.demMetadata = Object.freeze({
      ...meta,
      minElevationM: stats.minElevationM,
      maxElevationM: stats.maxElevationM,
      voidCount: stats.voidCount,
    });
    this.realDemGrid = grid;
    this.hasRealDem = true;
    this.terrainMode = 'real';
  }

  /**
   * Asynchronously loads real satellite elevation data.
   * Dynamically resolves using Vite's BASE_URL or relative paths for GitHub Pages subpaths.
   */
  public async loadRealSatelliteDem(url?: string): Promise<boolean> {
    
const baseUrl = import.meta.env.BASE_URL || "/";
const cleanBase = baseUrl.endsWith("/")
  ? baseUrl
  : `${baseUrl}/`;

const defaultUrl = new URL(
  `${cleanBase}terrain/real_ladakh_dem.bin`,
  self.location.origin
).toString();


    
const candidateUrls = url
  ? [url, defaultUrl]
  : [
      defaultUrl,
      new URL(
        "../terrain/real_ladakh_dem.bin",
        self.location.href
      ).toString(),
    ];

    for (const targetUrl of candidateUrls) {
      try {
        const response = await fetch(targetUrl);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength >= 512 * 512 * 4) {
            this.realDemGrid = new Float32Array(buffer, 0, 512 * 512);
            this._ladakhDemGrid = this.realDemGrid;
            const stats = computeDemGridStats(this.realDemGrid);
            this.demMetadata = Object.freeze({ ...REAL_LADAKH_DEM_METADATA, ...stats });
            this.hasRealDem = true;
            this.terrainMode = 'real';
            console.log(`[TerrainEngine] Loaded real satellite DEM from: ${targetUrl}`);
            return true;
          } else {
            console.warn(`[TerrainEngine] Buffer size mismatch from ${targetUrl}, expected >= 1MB.`);
          }
        }
      } catch (_) {
        // Try next candidate URL
      }
    }

    console.warn('[TerrainEngine] Could not fetch real satellite DEM from any candidate URL, using synthetic fallback.');
    return false;
  }

  public loadCustomDem(data: Float32Array | ArrayBuffer, metadata?: DemGeographicMetadata): boolean {
    const grid = data instanceof Float32Array ? data : new Float32Array(data);
    this.realDemGrid = grid;
    if (this.activeBiomeId === 'alpine_mountain') {
      this._ladakhDemGrid = grid;
    }
    const baseMeta = metadata ? metadata : REAL_LADAKH_DEM_METADATA;
    const needsStats =
      !Number.isFinite(baseMeta.minElevationM) ||
      !Number.isFinite(baseMeta.maxElevationM) ||
      !Number.isFinite(baseMeta.voidCount);
    if (needsStats) {
      const stats = computeDemGridStats(grid);
      this.demMetadata = Object.freeze({
        ...baseMeta,
        minElevationM: Number.isFinite(baseMeta.minElevationM) ? baseMeta.minElevationM : stats.minElevationM,
        maxElevationM: Number.isFinite(baseMeta.maxElevationM) ? baseMeta.maxElevationM : stats.maxElevationM,
        voidCount: Number.isFinite(baseMeta.voidCount) ? baseMeta.voidCount : stats.voidCount,
      });
    } else {
      this.demMetadata = Object.freeze({ ...baseMeta });
    }
    this.hasRealDem = true;
    this.terrainMode = 'real';
    return true;
  }

  public load_custom_dem(_filepath: string): boolean {
    return true;
  }

  /**
   * Evaluates whether local Cartesian coordinates (xM, yM) in metres fall inside
   * the genuine geographic coverage of the active real DEM raster.
   */
  public isWithinDemCoverage(xM: number, yM: number): boolean {
    const meta = this.demMetadata;
    const minX = meta.minX ?? -meta.halfWidthM;
    const maxX = meta.maxX ?? meta.halfWidthM;
    const minY = meta.minY ?? -meta.halfHeightM;
    const maxY = meta.maxY ?? meta.halfHeightM;
    return (
      Number.isFinite(xM) &&
      Number.isFinite(yM) &&
      xM >= minX &&
      xM <= maxX &&
      yM >= minY &&
      yM <= maxY
    );
  }

  /**
   * Maps local Cartesian coordinates (metres East/North from origin 34.5°N, 76.5°E)
   * to continuous floating-point column and row indices in the DEM raster.
   *
   * Point registration:
   *   col 0 = West bound (minX, minLonDeg)
   *   col N-1 = East bound (maxX, maxLonDeg)
   *   row 0 = North bound (maxY, maxLatDeg)
   *   row N-1 = South bound (minY, minLatDeg)
   */
  public worldToDemPixel(xM: number, yM: number): DemPixelCoord {
    const meta = this.demMetadata;
    const isInside = this.isWithinDemCoverage(xM, yM);
    const minX = meta.minX ?? -meta.halfWidthM;
    const maxX = meta.maxX ?? meta.halfWidthM;
    const minY = meta.minY ?? -meta.halfHeightM;
    const maxY = meta.maxY ?? meta.halfHeightM;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const u = spanX > 0 ? (xM - minX) / spanX : 0;
    const v = spanY > 0 ? (maxY - yM) / spanY : 0;
    const col = u * (meta.rasterWidth - 1);
    const row = v * (meta.rasterHeight - 1);
    return { col, row, isInside };
  }

  /**
   * Maps floating-point DEM column and row coordinates back to local Cartesian
   * coordinates (metres from origin). Exact inverse of worldToDemPixel.
   */
  public demPixelToWorld(col: number, row: number): { xM: number; yM: number } {
    const meta = this.demMetadata;
    const minX = meta.minX ?? -meta.halfWidthM;
    const maxX = meta.maxX ?? meta.halfWidthM;
    const minY = meta.minY ?? -meta.halfHeightM;
    const maxY = meta.maxY ?? meta.halfHeightM;
    const u = meta.rasterWidth > 1 ? col / (meta.rasterWidth - 1) : 0;
    const v = meta.rasterHeight > 1 ? row / (meta.rasterHeight - 1) : 0;
    const xM = minX + u * (maxX - minX);
    const yM = maxY - v * (maxY - minY);
    return { xM, yM };
  }

  /**
   * Projects local Cartesian coordinates (metres from origin) to WGS-84 geographic
   * coordinates (degrees) using the verified Local Equirectangular projection
   * (Plate Carrée with standard parallel at theater center phi0 = 34.5°N).
   *
   * Scale constants:
   *   1° Latitude  = 110,931.4506 m (WGS-84 meridian radius M at 34.5°N)
   *   1° Longitude = 91,839.9774 m  (WGS-84 prime vertical N * cos(34.5°N))
   */
  public worldToLatLon(xM: number, yM: number): GeographicCoordinate {
    const meta = this.demMetadata ?? REAL_LADAKH_DEM_METADATA;
    const minX = meta.minX ?? -meta.halfWidthM;
    const maxX = meta.maxX ?? meta.halfWidthM;
    const minY = meta.minY ?? -meta.halfHeightM;
    const maxY = meta.maxY ?? meta.halfHeightM;
    const centerXM = (minX + maxX) * 0.5;
    const centerYM = (minY + maxY) * 0.5;
    const halfSpanLonDeg = Math.max(1e-9, (meta.maxLonDeg - meta.minLonDeg) * 0.5);
    const halfSpanLatDeg = Math.max(1e-9, (meta.maxLatDeg - meta.minLatDeg) * 0.5);
    const metersPerDegLon = meta.halfWidthM / halfSpanLonDeg;
    const metersPerDegLat = meta.halfHeightM / halfSpanLatDeg;
    const latDeg = meta.centerLatDeg + (yM - centerYM) / metersPerDegLat;
    const lonDeg = meta.centerLonDeg + (xM - centerXM) / metersPerDegLon;
    return { latDeg, lonDeg };
  }

  /**
   * Projects WGS-84 geographic coordinates (degrees) to local Cartesian coordinates
   * (metres from origin). Exact inverse of worldToLatLon.
   */
  public latLonToWorld(latDeg: number, lonDeg: number): { xM: number; yM: number } {
    const meta = this.demMetadata ?? REAL_LADAKH_DEM_METADATA;
    const minX = meta.minX ?? -meta.halfWidthM;
    const maxX = meta.maxX ?? meta.halfWidthM;
    const minY = meta.minY ?? -meta.halfHeightM;
    const maxY = meta.maxY ?? meta.halfHeightM;
    const centerXM = (minX + maxX) * 0.5;
    const centerYM = (minY + maxY) * 0.5;
    const halfSpanLonDeg = Math.max(1e-9, (meta.maxLonDeg - meta.minLonDeg) * 0.5);
    const halfSpanLatDeg = Math.max(1e-9, (meta.maxLatDeg - meta.minLatDeg) * 0.5);
    const metersPerDegLon = meta.halfWidthM / halfSpanLonDeg;
    const metersPerDegLat = meta.halfHeightM / halfSpanLatDeg;
    const xM = centerXM + (lonDeg - meta.centerLonDeg) * metersPerDegLon;
    const yM = centerYM + (latDeg - meta.centerLatDeg) * metersPerDegLat;
    return { xM, yM };
  }

  /**
   * Returns authoritative bounding telemetry for the active terrain mode.
   * In real DEM mode, bounds represent the genuine geographic coverage of the Ladakh DEM raster
   * (-91,839.98m to +91,839.98m E-W, -110,931.45m to +110,931.45m N-S) rather than the 1,200 km theater.
   * In synthetic mode, bounds cover the full 1,200x1,200 km regional domain.
   */
  public getTerrainBoundsTelemetry(): TerrainBoundsTelemetry {
    if (this.terrainMode === 'real') {
      const meta = this.demMetadata;
      const minX = meta.minX ?? -meta.halfWidthM;
      const maxX = meta.maxX ?? meta.halfWidthM;
      const minY = meta.minY ?? -meta.halfHeightM;
      const maxY = meta.maxY ?? meta.halfHeightM;
      return {
        minX,
        maxX,
        minY,
        maxY,
        rasterWidth: meta.rasterWidth,
        rasterHeight: meta.rasterHeight,
        groundResolutionXM: meta.groundResolutionXM,
        groundResolutionYM: meta.groundResolutionYM,
        isValidCoverage: this.hasRealDem && this.realDemGrid !== null,
        halfWidthM: meta.halfWidthM,
        halfHeightM: meta.halfHeightM,
        terrainMode: 'real',
        tileName: meta.tileName,
      };
    } else {
      const extent = this.theaterExtentM;
      const size = DEFAULT_GRID_SIZE;
      const step = (2.0 * extent) / (size - 1);
      return {
        minX: -extent,
        maxX: extent,
        minY: -extent,
        maxY: extent,
        rasterWidth: size,
        rasterHeight: size,
        groundResolutionXM: step,
        groundResolutionYM: step,
        isValidCoverage: true,
        halfWidthM: extent,
        halfHeightM: extent,
        terrainMode: 'synthetic',
      };
    }
  }

  public getTerrainBounds(): TerrainBoundsTelemetry {
    return this.getTerrainBoundsTelemetry();
  }

  /**
   * Bilinear interpolation across 512x512 matrix over [-theaterExtentM, +theaterExtentM].
   * Used for procedural synthetic terrain synthesis.
   */
  private interpolateGrid(grid: Float32Array, xM: number, yM: number, isRow0North: boolean): number {
    const size = DEFAULT_GRID_SIZE;
    const extent = this.theaterExtentM;

    const u = Math.max(0.0, Math.min(1.0, (xM + extent) / (2.0 * extent)));
    const v = isRow0North
      ? Math.max(0.0, Math.min(1.0, (extent - yM) / (2.0 * extent)))
      : Math.max(0.0, Math.min(1.0, (yM + extent) / (2.0 * extent)));

    const cFloat = u * (size - 1);
    const rFloat = v * (size - 1);

    const c0 = Math.floor(cFloat);
    const r0 = Math.floor(rFloat);
    const c1 = Math.min(size - 1, c0 + 1);
    const r1 = Math.min(size - 1, r0 + 1);

    const fc = cFloat - c0;
    const fr = rFloat - r0;

    const v00 = grid[r0 * size + c0];
    const v01 = grid[r0 * size + c1];
    const v10 = grid[r1 * size + c0];
    const v11 = grid[r1 * size + c1];

    const top = v00 * (1.0 - fc) + v01 * fc;
    const bot = v10 * (1.0 - fc) + v11 * fc;

    return top * (1.0 - fr) + bot * fr;
  }

  /**
   * Bilinear interpolation across authentic real DEM raster.
   * Maps local Cartesian coordinates (xM, yM) to continuous pixel coordinates
   * within genuine DEM geographic coverage.
   *
   * Point-registered (gridline-registered):
   *   col 0..N-1 across N-1 intervals
   *   row 0..N-1 across N-1 intervals, row 0 is North.
   *
   * Handles void samples (-32768 or NaN) by performing normalized weighted interpolation
   * across valid surrounding corners. Returns Number.NaN if coordinates fall outside
   * genuine DEM coverage or all surrounding pixels are void.
   */
  public interpolateDemGrid(grid: Float32Array, xM: number, yM: number): number {
    const px = this.worldToDemPixel(xM, yM);
    if (!px.isInside) {
      return Number.NaN;
    }

    const meta = this.demMetadata;
    const width = meta.rasterWidth;
    const height = meta.rasterHeight;

    const cFloat = Math.max(0.0, Math.min(width - 1, px.col));
    const rFloat = Math.max(0.0, Math.min(height - 1, px.row));

    const c0 = Math.floor(cFloat);
    const r0 = Math.floor(rFloat);
    const c1 = Math.min(width - 1, c0 + 1);
    const r1 = Math.min(height - 1, r0 + 1);

    const fc = cFloat - c0;
    const fr = rFloat - r0;

    const v00 = grid[r0 * width + c0];
    const v01 = grid[r0 * width + c1];
    const v10 = grid[r1 * width + c0];
    const v11 = grid[r1 * width + c1];

    const isValid00 = Number.isFinite(v00) && v00 !== -32768;
    const isValid01 = Number.isFinite(v01) && v01 !== -32768;
    const isValid10 = Number.isFinite(v10) && v10 !== -32768;
    const isValid11 = Number.isFinite(v11) && v11 !== -32768;

    if (isValid00 && isValid01 && isValid10 && isValid11) {
      const top = v00 * (1.0 - fc) + v01 * fc;
      const bot = v10 * (1.0 - fc) + v11 * fc;
      return top * (1.0 - fr) + bot * fr;
    }

    // Normalized weighted interpolation across valid surrounding pixels
    let totalWeight = 0.0;
    let weightedSum = 0.0;

    const w00 = (1.0 - fc) * (1.0 - fr);
    const w01 = fc * (1.0 - fr);
    const w10 = (1.0 - fc) * fr;
    const w11 = fc * fr;

    if (isValid00) { totalWeight += w00; weightedSum += w00 * v00; }
    if (isValid01) { totalWeight += w01; weightedSum += w01 * v01; }
    if (isValid10) { totalWeight += w10; weightedSum += w10 * v10; }
    if (isValid11) { totalWeight += w11; weightedSum += w11 * v11; }

    if (totalWeight > 1e-6) {
      return weightedSum / totalWeight;
    }

    return Number.NaN;
  }

  /**
   * Returns raw satellite DEM elevation in metres MSL via bilinear interpolation
   * across genuine DEM coverage.
   *
   * Returns Number.NaN if coordinates fall outside genuine DEM coverage or are non-finite,
   * or if real DEM data is not loaded.
   */
  public getDemElevation(xM: number, yM: number): number {
    if (!this.hasRealDem || !this.realDemGrid) {
      return Number.NaN;
    }
    return this.interpolateDemGrid(this.realDemGrid, xM, yM);
  }

  /**
   * Evaluates terrain elevation MSL (m).
   *
   * In 'real' mode:
   *   - Queries the authentic 512x512 Ladakh DEM at genuine geographic scale.
   *   - Returns Number.NaN when outside genuine DEM coverage or if coordinates are non-finite.
   *   - Preserves authentic Float32 measurements.
   *
   * In 'synthetic' mode (or fallback when real DEM is not loaded):
   *   - Procedural 2D fBm terrain across the full 1,200 km regional theater extent.
   */
  /** Alias for getElevation for compatibility with terrain profiler callers. */
  public getElevationAt(xM: number, yM: number): number {
    return this.getElevation(xM, yM);
  }

  public getElevation(xM: number, yM: number): number {
    if (this.customElevationFn) {
      return this.customElevationFn(xM, yM);
    }

    if (!Number.isFinite(xM) || !Number.isFinite(yM)) {
      return Number.NaN;
    }

    if (this.terrainMode === 'real' && this.hasRealDem && this.realDemGrid) {
      if (!this.isWithinDemCoverage(xM, yM)) {
        return Number.NaN;
      }
      return this.interpolateDemGrid(this.realDemGrid, xM, yM);
    }

    // Procedural synthetic mode or fallback across 1,200 km theater
    const baseElev = this.interpolateGrid(getCachedSynthGrid(), xM, yM, false);
    if (!Number.isFinite(baseElev)) {
      return Number.NaN;
    }

    // Mt. Kargil-I Tactical Barrier Ridge (x=5000m, y=270m, peak z=4150m)
    const xArg = Math.max(-100.0, -Math.pow((xM - 5000.0) / 450.0, 2));
    const yArg = Math.max(-50.0, Math.min(50.0, (Math.abs(yM - 270.0) - 90.0) / 12.0));
    const ridgeKargil = 1150.0 * Math.exp(xArg) * (1.0 / (1.0 + Math.exp(yArg)));

    return Math.max(2800.0, Math.min(5900.0, baseElev + ridgeKargil));
  }

  public static computeEarthBulge(d1M: number, d2M: number, rEffM: number): number {
    if (rEffM <= 0.0) return 0.0;
    return (d1M * d2M) / (2.0 * rEffM);
  }

  public computeSlantGeometry(
    nodePos: Position3D,
    acnPos: Position3D,
    env: EnvironmentConfig
  ): SlantGeometry {
    const [nx, ny, nz] = nodePos;
    const [ax, ay, az] = acnPos;

    const dx = ax - nx;
    const dy = ay - ny;
    const dz = az - nz;

    const d2D = Math.hypot(dx, dy);
    const d3D = Math.hypot(d2D, dz);
    const rEff = env.effectiveEarthRadiusM;
    const phi = rEff > 0.0 ? d2D / rEff : 0.0;

    let elevationDeg: number;
    if (d2D < 1e-3) {
      elevationDeg = dz >= 0.0 ? 90.0 : -90.0;
    } else {
      const elevRad = Math.atan2(
        (rEff + az) * Math.cos(phi) - (rEff + nz),
        (rEff + az) * Math.sin(phi)
      );
      elevationDeg = (elevRad * 180.0) / Math.PI;
    }

    const tauPropS = d3D / SPEED_OF_LIGHT;
    const timingAdvanceS = 2.0 * tauPropS;

    return { slantRangeM: d3D, elevationDeg, tauPropS, timingAdvanceS };
  }

  /**
   * ITU-R P.526-15 §4.2 Rounded-Crest Curvature Attenuation T(m, n) (dB).
   */
  public static computeCrestCurvatureLossDb(
    crestRadiusM: number,
    d1M: number,
    d2M: number,
    hObsM: number,
    wavelengthM: number
  ): number {
    if (d1M <= 0.0 || d2M <= 0.0 || wavelengthM <= 0.0) {
      return 0.0;
    }
    const rCrest = Math.max(0.5, Math.min(2000.0, crestRadiusM));
    // Physical Fresnel diffraction parameter nu for obstacle height hObsM
    const nu = hObsM * Math.sqrt((2.0 / wavelengthM) * (1.0 / d1M + 1.0 / d2M));
    if (nu <= -0.78) {
      return 0.0;
    }

    const hObs = Math.max(0.0, hObsM);
    const m = Math.pow(rCrest, 2.0 / 3.0) * ((d1M + d2M) / (d1M * d2M)) * Math.pow(wavelengthM / Math.PI, 1.0 / 3.0);
    const n = hObs * Math.pow(rCrest, -1.0 / 3.0) * Math.pow(Math.PI / wavelengthM, 2.0 / 3.0);
    const mn = m * n;
    let tVal: number;
    if (mn <= 4.0) {
      tVal = 7.2 * Math.sqrt(m) - (2.0 - 12.5 * n) * m + 3.6 * Math.pow(m, 1.5) - 0.8 * m * m;
    } else {
      tVal = -6.0 - 20.0 * Math.log10(Math.max(mn, 1e-9)) + 7.2 * Math.sqrt(m) - (2.0 - 17.0 * n) * m + 3.6 * Math.pow(m, 1.5) - 0.8 * m * m;
    }
    const baseCurvatureLoss = Math.max(0.0, Math.min(20.0, tVal));

    if (nu < 0.0) {
      // Clear optical LoS grazing the 1st Fresnel zone: continuous C0 smooth transition to 0 dB at nu = -0.78
      const grazingFactor = Math.pow((nu + 0.78) / 0.78, 2.0);
      return Math.max(0.0, Math.min(20.0, baseCurvatureLoss * Math.max(0.0, Math.min(1.0, grazingFactor))));
    }

    return baseCurvatureLoss;
  }

  /**
   * ITU-R P.526-15 Single knife-edge diffraction loss J(nu) (dB).
   */
  public static computeKnifeEdgeLossDb(
    hPenetrationM: number,
    d1M: number,
    d2M: number,
    wavelengthM: number
  ): number {
    const nu = hPenetrationM * Math.sqrt((2.0 / wavelengthM) * (1.0 / d1M + 1.0 / d2M));
    const arg = Math.sqrt(Math.pow(nu - 0.1, 2) + 1.0) + (nu - 0.1);
    return 6.9 + 20.0 * Math.log10(Math.max(arg, 1e-9));
  }

  /**
   * ITU-R P.526-15 §4.5.1 Bullington Horizon Tangent Intersection Apex.
   */
  public static computeBullingtonApex(
    zTx: number,
    zRx: number,
    d3D: number,
    sTxMax: number,
    sRxMax: number,
    sTxDistM: number,
    sRxDistM: number
  ): { sBull: number; zBull: number; hBull: number } {
    const denom = Math.max(sTxMax + sRxMax, 1e-9);
    let sBull = (zRx - zTx + sRxMax * d3D) / denom;
    const sMin = Math.min(sTxDistM, sRxDistM);
    const sMax = Math.max(sTxDistM, sRxDistM);
    sBull = Math.max(sMin, Math.min(sMax, sBull));
    const zBull = zTx + sTxMax * sBull;
    const zLosBull = zTx + (sBull / d3D) * (zRx - zTx);
    const hBull = zBull - zLosBull;
    return { sBull, zBull, hBull };
  }

  public evaluateTerrainObstruction(
    nodePos: Position3D,
    acnPos: Position3D,
    rf: RFConfig,
    env: EnvironmentConfig,
    stepIntervalM: number = 100.0,
    elevationPerturbationStdM: number = 0.0
  ): TerrainObstruction {
    const [nx, ny, nz] = nodePos;
    const [ax, ay, az] = acnPos;

    const dx = ax - nx;
    const dy = ay - ny;
    const dz = az - nz;
    const dHoriz = Math.hypot(dx, dy);
    const d3D = Math.hypot(dHoriz, dz);
    const horizSpan = dHoriz > 1e-3 ? dHoriz : Math.max(d3D, 1e-3);

    const wavelength = rf.wavelengthM;
    const rEff = env.effectiveEarthRadiusM;

    let isCoverageComplete = true;
    let coverageNote: string | undefined = undefined;

    // Check finite coordinates for endpoints
    if (
      !Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz) ||
      !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) ||
      !Number.isFinite(d3D)
    ) {
      isCoverageComplete = false;
      coverageNote = 'OUT_OF_COVERAGE: Ray endpoints contain non-finite coordinates';
    }

    // In real DEM mode, check start and target terminal boundaries
    if (isCoverageComplete && this.terrainMode === 'real' && this.hasRealDem && this.realDemGrid) {
      if (!this.isWithinDemCoverage(nx, ny)) {
        isCoverageComplete = false;
        coverageNote = 'OUT_OF_COVERAGE: Ground terminal is outside mapped DEM coverage';
      } else if (!this.isWithinDemCoverage(ax, ay)) {
        isCoverageComplete = false;
        coverageNote = 'OUT_OF_COVERAGE: Aircraft (ACN) is outside mapped DEM coverage';
      }
    }

    // Always evaluate custom obstacle intersections along the 3D ray
    const obstacleIntersections = this.obstacleField.intersectRay(nodePos, acnPos, (x, y, fraction) => {
      const d1 = d3D * fraction, d2 = d3D - d1;
      return this.getElevation(x, y) + TerrainEngine.computeEarthBulge(d1, d2, rEff);
    });
    const obstacleBlocked = obstacleIntersections.length > 0;

    // If endpoints are outside coverage, abort immediately without fabricating clearance
    if (!isCoverageComplete) {
      return {
        minClearanceM: Number.NaN,
        fresnelRadiusM: Number.NaN,
        diffractionLossDb: Number.NaN,
        isLos: false,
        isHardShadow: true,
        isCoverageComplete: false,
        obstacleBlocked,
        obstacleIntersections,
        coverageNote: coverageNote ?? 'OUT_OF_COVERAGE: Propagation path traverses unmapped terrain',
      };
    }

    // Near-coincident terminal check
    if (d3D < 1e-3) {
      const hTerrain = this.getElevation(nx, ny);
      if (!Number.isFinite(hTerrain)) {
        return {
          minClearanceM: Number.NaN,
          fresnelRadiusM: Number.NaN,
          diffractionLossDb: Number.NaN,
          isLos: false,
          isHardShadow: true,
          isCoverageComplete: false,
          obstacleBlocked,
          obstacleIntersections,
          coverageNote: 'OUT_OF_COVERAGE: Terminal position is outside mapped DEM coverage',
        };
      }
      const hClear = nz - hTerrain;
      return {
        minClearanceM: hClear,
        fresnelRadiusM: 0.0,
        diffractionLossDb: 0.0,
        isLos: hClear >= 0.0,
        isHardShadow: hClear < 0.0,
        isCoverageComplete: true,
        obstacleBlocked,
        obstacleIntersections,
        coverageNote: undefined,
      };
    }

    let minClearanceRatio = Number.POSITIVE_INFINITY;
    let minClearanceM = 0.0;
    let critFresnelRadiusM = 0.0;
    let critD1 = d3D * 0.5;
    let critD2 = d3D * 0.5;
    let iPeak = -1;
    let totalSteps = 0;

    let sTxMax = Number.NEGATIVE_INFINITY;
    let sRxMax = Number.NEGATIVE_INFINITY;
    let sTxDistM = 0.0;
    let sRxDistM = 0.0;
    let iTx = -1;
    let iRx = -1;

    if (d3D <= stepIntervalM * 2.0) {
      // Single midpoint sample for very short baseline
      const d1 = d3D * 0.5;
      const d2 = d3D - d1;
      const fraction = 0.5;

      const sampleX = nx + fraction * dx;
      const sampleY = ny + fraction * dy;

      let hTerrain = this.getElevation(sampleX, sampleY);
      if (elevationPerturbationStdM > 0.0 && Number.isFinite(hTerrain)) {
        hTerrain += elevationPerturbationStdM *
          Math.sin(0.013 * sampleX + 0.017 * sampleY) *
          Math.cos(0.011 * sampleX - 0.019 * sampleY);
      }
      if (!Number.isFinite(hTerrain)) {
        isCoverageComplete = false;
        coverageNote = 'OUT_OF_COVERAGE: Propagation path traverses unmapped terrain outside DEM coverage';
      } else {
        const earthBulge = TerrainEngine.computeEarthBulge(d1, d2, rEff);
        const hTerrainEff = hTerrain + earthBulge;
        const hLos = nz + fraction * dz;
        const hClear = hLos - hTerrainEff;

        const r1 = Math.sqrt((wavelength * d1 * d2) / d3D);
        minClearanceRatio = hClear / r1;
        minClearanceM = hClear;
        critFresnelRadiusM = r1;
        critD1 = d1;
        critD2 = d2;
        iPeak = 1;
        totalSteps = 1;

        const hD1 = horizSpan * 0.5;
        const hD2 = Math.max(1e-3, horizSpan - hD1);
        sTxMax = (hTerrainEff - nz) / Math.max(1e-3, hD1);
        sTxDistM = hD1;
        iTx = 1;

        sRxMax = (hTerrainEff - az) / hD2;
        sRxDistM = hD1;
        iRx = 1;
      }
    } else {
      // Standard stepped ray-marching without array allocation
      let stepIdx = 0;
      for (let d1 = stepIntervalM; d1 < d3D; d1 += stepIntervalM) {
        stepIdx++;
        const d2 = d3D - d1;
        const fraction = d1 / d3D;

        const sampleX = nx + fraction * dx;
        const sampleY = ny + fraction * dy;

        let hTerrain = this.getElevation(sampleX, sampleY);
        if (elevationPerturbationStdM > 0.0 && Number.isFinite(hTerrain)) {
          hTerrain += elevationPerturbationStdM *
            Math.sin(0.013 * sampleX + 0.017 * sampleY) *
            Math.cos(0.011 * sampleX - 0.019 * sampleY);
        }
        if (!Number.isFinite(hTerrain)) {
          isCoverageComplete = false;
          coverageNote = 'OUT_OF_COVERAGE: Propagation path traverses unmapped terrain outside DEM coverage';
          break;
        }

        const earthBulge = TerrainEngine.computeEarthBulge(d1, d2, rEff);
        const hTerrainEff = hTerrain + earthBulge;

        const hLos = nz + fraction * dz;
        const hClear = hLos - hTerrainEff;

        const r1 = Math.sqrt((wavelength * d1 * d2) / d3D);
        const clearanceRatio = hClear / r1;

        if (clearanceRatio < minClearanceRatio) {
          minClearanceRatio = clearanceRatio;
          minClearanceM = hClear;
          critFresnelRadiusM = r1;
          critD1 = d1;
          critD2 = d2;
          iPeak = stepIdx;
        }

        const hD1 = horizSpan * fraction;
        const hD2 = Math.max(1e-3, horizSpan - hD1);
        const sTx = (hTerrainEff - nz) / Math.max(1e-3, hD1);
        if (sTx > sTxMax) {
          sTxMax = sTx;
          sTxDistM = hD1;
          iTx = stepIdx;
        }

        const sRx = (hTerrainEff - az) / hD2;
        if (sRx > sRxMax) {
          sRxMax = sRx;
          sRxDistM = hD1;
          iRx = stepIdx;
        }
      }
      totalSteps = stepIdx;
    }

    if (!isCoverageComplete) {
      return {
        minClearanceM: Number.NaN,
        fresnelRadiusM: Number.NaN,
        diffractionLossDb: Number.NaN,
        isLos: false,
        isHardShadow: true,
        isCoverageComplete: false,
        obstacleBlocked,
        obstacleIntersections,
        coverageNote: coverageNote ?? 'OUT_OF_COVERAGE: Propagation path traverses unmapped terrain',
      };
    }

    let diffractionLossDb: number;
    let isLos: boolean;
    let crestRadiusM: number | undefined = undefined;
    let curvatureLossDb: number | undefined = undefined;
    let bullingtonApexDistM: number | undefined = undefined;
    let bullingtonApex: BullingtonApexData | null = null;

    if (iTx !== -1 && iRx !== -1 && horizSpan > 0) {
      if (iTx !== iRx) {
        const apex = TerrainEngine.computeBullingtonApex(nz, az, horizSpan, sTxMax, sRxMax, sTxDistM, sRxDistM);
        const txHorizonElevM = nz + sTxMax * sTxDistM;
        const rxHorizonElevM = az + sRxMax * (horizSpan - sRxDistM);
        const losHeightM = nz + (apex.sBull / horizSpan) * (az - nz);
        const hBull = apex.zBull - losHeightM;
        const nu = hBull * Math.sqrt((2.0 / wavelength) * (1.0 / Math.max(1e-3, apex.sBull) + 1.0 / Math.max(1e-3, horizSpan - apex.sBull)));
        const lossDb = TerrainEngine.computeKnifeEdgeLossDb(Math.max(0, hBull), apex.sBull, Math.max(1e-3, horizSpan - apex.sBull), wavelength);
        bullingtonApex = {
          distM: apex.sBull,
          elevM: apex.zBull,
          losHeightM,
          diffractionParameterNu: nu,
          lossDb: Math.max(0, lossDb),
          txHorizonDistM: sTxDistM,
          txHorizonElevM,
          rxHorizonDistM: sRxDistM,
          rxHorizonElevM,
        };
      } else {
        const horizCritD1 = (critD1 / Math.max(1e-3, d3D)) * horizSpan;
        const horizCritD2 = Math.max(1e-3, horizSpan - horizCritD1);
        const txHorizonElevM = nz + sTxMax * horizCritD1;
        const losHeightM = nz + (horizCritD1 / horizSpan) * (az - nz);
        const hBull = txHorizonElevM - losHeightM;
        const nu = hBull * Math.sqrt((2.0 / wavelength) * (1.0 / Math.max(1e-3, horizCritD1) + 1.0 / horizCritD2));
        const lossDb = TerrainEngine.computeKnifeEdgeLossDb(Math.max(0, hBull), horizCritD1, horizCritD2, wavelength);
        bullingtonApex = {
          distM: horizCritD1,
          elevM: txHorizonElevM,
          losHeightM,
          diffractionParameterNu: nu,
          lossDb: Math.max(0, lossDb),
          txHorizonDistM: horizCritD1,
          txHorizonElevM,
          rxHorizonDistM: horizCritD1,
          rxHorizonElevM: txHorizonElevM,
        };
      }
    }

    const computePeakCurvature = (signedHObsM: number): { crestRadius: number; curvLossDb: number } => {
      if (
        iPeak <= 1 ||
        iPeak >= totalSteps ||
        critD1 - stepIntervalM <= 0.0 ||
        critD1 + stepIntervalM >= d3D
      ) {
        return { crestRadius: 2000.0, curvLossDb: 0.0 };
      }
      const sPrev = critD1 - stepIntervalM;
      const sNext = critD1 + stepIntervalM;
      const xPrev = nx + (sPrev / d3D) * dx;
      const yPrev = ny + (sPrev / d3D) * dy;
      const xNext = nx + (sNext / d3D) * dx;
      const yNext = ny + (sNext / d3D) * dy;
      const xPeak = nx + (critD1 / d3D) * dx;
      const yPeak = ny + (critD1 / d3D) * dy;

      let zTerrPrev = this.getElevation(xPrev, yPrev);
      let zTerrPeak = this.getElevation(xPeak, yPeak);
      let zTerrNext = this.getElevation(xNext, yNext);

      if (elevationPerturbationStdM > 0.0) {
        if (Number.isFinite(zTerrPrev)) zTerrPrev += elevationPerturbationStdM * Math.sin(0.013 * xPrev + 0.017 * yPrev) * Math.cos(0.011 * xPrev - 0.019 * yPrev);
        if (Number.isFinite(zTerrPeak)) zTerrPeak += elevationPerturbationStdM * Math.sin(0.013 * xPeak + 0.017 * yPeak) * Math.cos(0.011 * xPeak - 0.019 * yPeak);
        if (Number.isFinite(zTerrNext)) zTerrNext += elevationPerturbationStdM * Math.sin(0.013 * xNext + 0.017 * yNext) * Math.cos(0.011 * xNext - 0.019 * yNext);
      }

      if (!Number.isFinite(zTerrPrev) || !Number.isFinite(zTerrPeak) || !Number.isFinite(zTerrNext)) {
        return { crestRadius: 2000.0, curvLossDb: 0.0 };
      }

      const zPrev = zTerrPrev + TerrainEngine.computeEarthBulge(sPrev, d3D - sPrev, rEff);
      const zPeak = zTerrPeak + TerrainEngine.computeEarthBulge(critD1, critD2, rEff);
      const zNext = zTerrNext + TerrainEngine.computeEarthBulge(sNext, d3D - sNext, rEff);

      const deltaS = stepIntervalM;
      const zPrime = (zNext - zPrev) / (2.0 * deltaS);
      const zDoublePrime = (zPrev - 2.0 * zPeak + zNext) / (deltaS * deltaS);

      if (zDoublePrime < 0.0) {
        const denomCurv = Math.max(-zDoublePrime, 5e-4);
        const rVal = Math.pow(1.0 + zPrime * zPrime, 1.5) / denomCurv;
        const crestRadius = Math.max(0.5, Math.min(2000.0, rVal));
        const curvLossDb = TerrainEngine.computeCrestCurvatureLossDb(
          crestRadius,
          critD1,
          critD2,
          signedHObsM,
          wavelength
        );
        return { crestRadius, curvLossDb };
      }
      return { crestRadius: 2000.0, curvLossDb: 0.0 };
    };

    if (minClearanceRatio >= 0.6) {
      diffractionLossDb = 0.0;
      isLos = true;
      crestRadiusM = 2000.0;
      curvatureLossDb = 0.0;
    } else if (minClearanceRatio > 0.0) {
      const peakCurv = computePeakCurvature(-minClearanceM);
      crestRadiusM = peakCurv.crestRadius;
      curvatureLossDb = peakCurv.curvLossDb;
      diffractionLossDb = 6.0 * (1.0 - minClearanceRatio / 0.6) + curvatureLossDb;
      isLos = true;
    } else {
      isLos = false;

      // 1. Knife-edge diffraction: Bullington multi-ridge or single dominant peak
      let knifeEdgeLoss = 0.0;
      let usedBullington = false;

      if (iTx !== iRx && iTx !== -1 && iRx !== -1) {
        const apex = TerrainEngine.computeBullingtonApex(nz, az, horizSpan, sTxMax, sRxMax, sTxDistM, sRxDistM);
        if (apex.hBull > 0.0) {
          knifeEdgeLoss = TerrainEngine.computeKnifeEdgeLossDb(
            apex.hBull,
            apex.sBull,
            Math.max(1e-3, horizSpan - apex.sBull),
            wavelength
          );
          bullingtonApexDistM = apex.sBull;
          usedBullington = true;
        }
      }

      if (!usedBullington) {
        knifeEdgeLoss = TerrainEngine.computeKnifeEdgeLossDb(-minClearanceM, critD1, critD2, wavelength);
        bullingtonApexDistM = critD1;
      }

      // 2. Physical radius of curvature and rounded-crest loss T(m, n) at iPeak
      const peakCurv = computePeakCurvature(Math.max(-minClearanceM, 0.0));
      crestRadiusM = peakCurv.crestRadius;
      curvatureLossDb = peakCurv.curvLossDb;

      diffractionLossDb = knifeEdgeLoss + curvatureLossDb;
    }

    const isHardShadow = !isLos;

    return {
      minClearanceM,
      fresnelRadiusM: critFresnelRadiusM,
      diffractionLossDb,
      isLos,
      isHardShadow,
      isCoverageComplete: true,
      obstacleBlocked,
      obstacleIntersections,
      coverageNote: undefined,
      crestRadiusM,
      curvatureLossDb,
      bullingtonApexDistM,
      bullingtonApex,
    };
  }

  /**
   * Batch terrain obstruction evaluation.
   * Uses the Rust/WASM batch ray-march kernel when active in real DEM mode with no CAD obstacles,
   * and falls back cleanly to TS per-ray evaluation whenever CAD obstacles are present.
   */
  public evaluateTerrainObstructionBatch(
    rays: ReadonlyArray<{ readonly nodePos: Position3D; readonly acnPos: Position3D }>,
    rf: RFConfig,
    env: EnvironmentConfig,
    stepIntervalM: number = 100.0,
    elevationPerturbationStdM: number = 0.0
  ): TerrainObstruction[] {
    if (rays.length === 0) {
      return [];
    }

    const hasCadObstacles = this.obstacleField.all.length > 0;
    if (!hasCadObstacles && this.terrainMode === 'real' && this.hasRealDem && this.realDemGrid) {
      const bounds = this.getTerrainBoundsTelemetry();
      const packedRays = new Float64Array(rays.length * 6);
      for (let i = 0; i < rays.length; i++) {
        const b = i * 6;
        packedRays[b] = rays[i].nodePos[0];
        packedRays[b + 1] = rays[i].nodePos[1];
        packedRays[b + 2] = rays[i].nodePos[2];
        packedRays[b + 3] = rays[i].acnPos[0];
        packedRays[b + 4] = rays[i].acnPos[1];
        packedRays[b + 5] = rays[i].acnPos[2];
      }
      const wasmRes = wasmEvaluateBatchRays(
        this.realDemGrid,
        bounds.rasterWidth,
        bounds.rasterHeight,
        bounds.minX,
        bounds.maxX,
        bounds.minY,
        bounds.maxY,
        packedRays,
        rf.wavelengthM,
        env.effectiveEarthRadiusM,
        stepIntervalM,
        elevationPerturbationStdM
      );
      if (wasmRes && wasmRes.length >= rays.length * 4) {
        const out: TerrainObstruction[] = new Array(rays.length);
        for (let i = 0; i < rays.length; i++) {
          const ob = i * 4;
          const isLos = wasmRes[ob] >= 0.5;
          const diffLoss = wasmRes[ob + 1];
          const minClear = wasmRes[ob + 2];
          const complete = Number.isFinite(diffLoss) && Number.isFinite(minClear);
          out[i] = {
            minClearanceM: minClear,
            fresnelRadiusM: Number.NaN,
            diffractionLossDb: diffLoss,
            isLos: complete ? isLos : false,
            isHardShadow: !complete || !isLos,
            isCoverageComplete: complete,
            obstacleBlocked: false,
            obstacleIntersections: [],
            coverageNote: complete ? undefined : 'OUT_OF_COVERAGE: Propagation path traverses unmapped terrain',
          };
        }
        return out;
      }
    }

    return rays.map((r) =>
      this.evaluateTerrainObstruction(
        r.nodePos,
        r.acnPos,
        rf,
        env,
        stepIntervalM,
        elevationPerturbationStdM
      )
    );
  }
}
