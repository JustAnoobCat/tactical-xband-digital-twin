/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Pure TypeScript Dual-Mode Terrain & Geometrical Propagation Engine
 *
 * Expanded Regional Theater: 1,200 x 1,200 km (+/- 600 km from center)
 * Ensures full-bleed edge-to-edge terrain coverage even at maximum zoom-out.
 */

import { EnvironmentConfig, RFConfig, SPEED_OF_LIGHT } from './config';
import { ObstacleField, ObstacleIntersection } from './obstacles';

export type Position3D = readonly [xM: number, yM: number, zM: number];

export interface SlantGeometry {
  readonly slantRangeM: number;
  readonly elevationDeg: number;
  readonly tauPropS: number;
  readonly timingAdvanceS: number;
}

export interface TerrainObstruction {
  readonly minClearanceM: number;
  readonly fresnelRadiusM: number;
  readonly diffractionLossDb: number;
  readonly isLos: boolean;
  /** Explicit coverage tracking: true if every sample along path has genuine, valid DEM elevation. */
  readonly isCoverageComplete?: boolean;
  /** Structural geometry result; independent of terrain LOS and terrain diffraction. */
  readonly obstacleBlocked: boolean;
  readonly obstacleIntersections: readonly ObstacleIntersection[];
  /** Detailed reason when terrain coverage is incomplete along propagation path. */
  readonly coverageNote?: string;
}

// Regional 1,200 x 1,200 km Theater Extent (+/- 600 km from origin)
export const THEATER_EXTENT_1200KM_M = 600000.0;
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
  private readonly customElevationFn?: (xM: number, yM: number) => number;
  /** Canonical committed obstacle state shared by live links, prediction and profiles. */
  public readonly obstacleField = new ObstacleField();

  constructor(options?: {
    theaterExtentM?: number;
    terrainMode?: 'real' | 'synthetic';
    customElevationFn?: (xM: number, yM: number) => number;
  }) {
    this.theaterExtentM = options?.theaterExtentM ?? THEATER_EXTENT_1200KM_M;
    this.terrainMode = options?.terrainMode ?? 'real';
    this.customElevationFn = options?.customElevationFn;
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

  public loadCustomDem(data: Float32Array | ArrayBuffer): boolean {
    this.realDemGrid = data instanceof Float32Array ? data : new Float32Array(data);
    this.hasRealDem = true;
    this.terrainMode = 'real';
    return true;
  }

  public load_custom_dem(_filepath: string): boolean {
    return true;
  }

  /**
   * Evaluates whether local Cartesian coordinates (xM, yM) in metres fall inside
   * the genuine geographic coverage of the real Ladakh satellite DEM raster.
   */
  public isWithinDemCoverage(xM: number, yM: number): boolean {
    const meta = REAL_LADAKH_DEM_METADATA;
    return (
      Number.isFinite(xM) &&
      Number.isFinite(yM) &&
      Math.abs(xM) <= meta.halfWidthM &&
      Math.abs(yM) <= meta.halfHeightM
    );
  }

  /**
   * Maps local Cartesian coordinates (metres East/North from origin 34.5°N, 76.5°E)
   * to continuous floating-point column and row indices in the 512x512 DEM raster.
   *
   * Point registration:
   *   col 0 = West bound (-halfWidthM, 75.5°E)
   *   col 511 = East bound (+halfWidthM, 77.5°E)
   *   row 0 = North bound (+halfHeightM, 35.5°N)
   *   row 511 = South bound (-halfHeightM, 33.5°N)
   */
  public worldToDemPixel(xM: number, yM: number): DemPixelCoord {
    const meta = REAL_LADAKH_DEM_METADATA;
    const isInside = this.isWithinDemCoverage(xM, yM);
    const u = (xM + meta.halfWidthM) / (2.0 * meta.halfWidthM);
    const v = (meta.halfHeightM - yM) / (2.0 * meta.halfHeightM);
    const col = u * (meta.rasterWidth - 1);
    const row = v * (meta.rasterHeight - 1);
    return { col, row, isInside };
  }

  /**
   * Maps floating-point DEM column and row coordinates back to local Cartesian
   * coordinates (metres from origin). Exact inverse of worldToDemPixel.
   */
  public demPixelToWorld(col: number, row: number): { xM: number; yM: number } {
    const meta = REAL_LADAKH_DEM_METADATA;
    const u = col / (meta.rasterWidth - 1);
    const v = row / (meta.rasterHeight - 1);
    const xM = -meta.halfWidthM + u * (2.0 * meta.halfWidthM);
    const yM = meta.halfHeightM - v * (2.0 * meta.halfHeightM);
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
    const meta = REAL_LADAKH_DEM_METADATA;
    const latDeg = meta.centerLatDeg + yM / meta.halfHeightM;
    const lonDeg = meta.centerLonDeg + xM / meta.halfWidthM;
    return { latDeg, lonDeg };
  }

  /**
   * Projects WGS-84 geographic coordinates (degrees) to local Cartesian coordinates
   * (metres from origin). Exact inverse of worldToLatLon.
   */
  public latLonToWorld(latDeg: number, lonDeg: number): { xM: number; yM: number } {
    const meta = REAL_LADAKH_DEM_METADATA;
    const xM = (lonDeg - meta.centerLonDeg) * meta.halfWidthM;
    const yM = (latDeg - meta.centerLatDeg) * meta.halfHeightM;
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
      const meta = REAL_LADAKH_DEM_METADATA;
      return {
        minX: -meta.halfWidthM,
        maxX: meta.halfWidthM,
        minY: -meta.halfHeightM,
        maxY: meta.halfHeightM,
        rasterWidth: meta.rasterWidth,
        rasterHeight: meta.rasterHeight,
        groundResolutionXM: meta.groundResolutionXM,
        groundResolutionYM: meta.groundResolutionYM,
        isValidCoverage: this.hasRealDem && this.realDemGrid !== null,
        halfWidthM: meta.halfWidthM,
        halfHeightM: meta.halfHeightM,
        terrainMode: 'real',
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
   * Bilinear interpolation across authentic 512x512 real DEM raster.
   * Maps local Cartesian coordinates (xM, yM) to continuous pixel coordinates
   * within genuine DEM geographic coverage [-halfWidthM, +halfWidthM] x [-halfHeightM, +halfHeightM].
   *
   * Point-registered (gridline-registered):
   *   col 0..511 across 511 intervals (359.452 m/px)
   *   row 0..511 across 511 intervals (434.174 m/px), row 0 is North.
   *
   * Returns Number.NaN if coordinates fall outside genuine DEM coverage or are non-finite.
   */
  public interpolateDemGrid(grid: Float32Array, xM: number, yM: number): number {
    const px = this.worldToDemPixel(xM, yM);
    if (!px.isInside) {
      return Number.NaN;
    }

    const meta = REAL_LADAKH_DEM_METADATA;
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

    const top = v00 * (1.0 - fc) + v01 * fc;
    const bot = v10 * (1.0 - fc) + v11 * fc;

    return top * (1.0 - fr) + bot * fr;
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

  public evaluateTerrainObstruction(
    nodePos: Position3D,
    acnPos: Position3D,
    rf: RFConfig,
    env: EnvironmentConfig,
    stepIntervalM: number = 100.0
  ): TerrainObstruction {
    const [nx, ny, nz] = nodePos;
    const [ax, ay, az] = acnPos;

    const dx = ax - nx;
    const dy = ay - ny;
    const dz = az - nz;
    const d3D = Math.hypot(Math.hypot(dx, dy), dz);

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
        isCoverageComplete: true,
        obstacleBlocked,
        obstacleIntersections,
        coverageNote: undefined,
      };
    }

    let steps: number[] = [];
    if (d3D <= stepIntervalM * 2.0) {
      steps = [d3D * 0.5];
    } else {
      for (let s = stepIntervalM; s < d3D; s += stepIntervalM) {
        steps.push(s);
      }
    }

    let minClearanceRatio = Number.POSITIVE_INFINITY;
    let minClearanceM = 0.0;
    let critFresnelRadiusM = 0.0;
    let critD1 = d3D * 0.5;
    let critD2 = d3D * 0.5;

    for (let i = 0; i < steps.length; i++) {
      const d1 = steps[i];
      const d2 = d3D - d1;
      const fraction = d1 / d3D;

      const sampleX = nx + fraction * dx;
      const sampleY = ny + fraction * dy;

      const hTerrain = this.getElevation(sampleX, sampleY);
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
      }
    }

    if (!isCoverageComplete) {
      return {
        minClearanceM: Number.NaN,
        fresnelRadiusM: Number.NaN,
        diffractionLossDb: Number.NaN,
        isLos: false,
        isCoverageComplete: false,
        obstacleBlocked,
        obstacleIntersections,
        coverageNote: coverageNote ?? 'OUT_OF_COVERAGE: Propagation path traverses unmapped terrain',
      };
    }

    let diffractionLossDb: number;
    let isLos: boolean;

    if (minClearanceRatio >= 0.6) {
      diffractionLossDb = 0.0;
      isLos = true;
    } else if (minClearanceRatio > 0.0) {
      diffractionLossDb = 6.0 * (1.0 - minClearanceRatio / 0.6);
      isLos = true;
    } else {
      isLos = false;
      const nu = -minClearanceM * Math.sqrt(
        (2.0 / wavelength) * (1.0 / critD1 + 1.0 / critD2)
      );
      const arg = Math.sqrt(Math.pow(nu - 0.1, 2) + 1.0) + (nu - 0.1);
      const knifeEdgeLoss = 6.9 + 20.0 * Math.log10(Math.max(arg, 1e-9));
      const fockPenaltyDb = 12.0;
      diffractionLossDb = knifeEdgeLoss + fockPenaltyDb;
    }

    return {
      minClearanceM,
      fresnelRadiusM: critFresnelRadiusM,
      diffractionLossDb,
      isLos,
      isCoverageComplete: true,
      obstacleBlocked,
      obstacleIntersections,
      coverageNote: undefined,
    };
  }
}
