/**
 * Hillshade Relief Generator for the X-Band Aerial Communication Network Digital Twin.
 *
 * Encapsulates:
 * 1. 3D Lambertian shaded relief grid calculation across genuine real DEM coverage
 *    and synthetic full-theater procedural terrain.
 * 2. Internal caching of computed relief grids across mode switches and static DEM references.
 * 3. Continuous elevation sampling (direct-raster satellite DEM access and interpolated queries).
 * 4. Gradient, surface normal, and illumination calculations with NaN-safe boundary handling.
 * 5. Dark-mode tactical military color grading based on absolute altitude.
 */

import {
  REAL_LADAKH_DEM_METADATA,
  TerrainBoundsTelemetry,
  TerrainEngine,
} from '../core/terrain';
import { THEATER_HALF_M } from '../shared/constants';
import type { HillshadeReadyMessage } from '../shared/workerProtocol';

/**
 * Result of a hillshade relief generation or cache retrieval operation.
 */
export interface HillshadeResult {
  readonly grid: number[][];
  readonly gridSize: number;
  readonly boundsKm: number;
  readonly bounds: TerrainBoundsTelemetry;
  readonly terrainMode: 'real' | 'synthetic';
  /** True if the result was retrieved from internal cache without recomputation */
  readonly isCached: boolean;
  /** Ready-to-emit host telemetry message matching the authoritative worker protocol */
  readonly message: HillshadeReadyMessage;
}

/**
 * Cached hillshade entry for internal reuse.
 */
export interface CachedHillshadeEntry {
  readonly grid: number[][];
  readonly size: number;
  readonly demRef?: Float32Array | null;
}

/**
 * Dedicated hillshade generator encapsulating relief computation and caching.
 */
export class HillshadeGenerator {
  private cachedRealHillshade: { grid: number[][]; demRef: Float32Array | null; size: number } | null = null;
  private cachedSynthHillshade: { grid: number[][]; size: number } | null = null;
  private currentGrid: number[][] = [];

  constructor(private readonly defaultEngine?: TerrainEngine) {}

  /** Authoritative grid from the most recent generation or cache hit */
  public get hillshadeGrid(): number[][] {
    return this.currentGrid;
  }

  /** Read-only snapshot of cached real DEM hillshade entry */
  public get realCache(): Readonly<{ grid: number[][]; demRef: Float32Array | null; size: number }> | null {
    return this.cachedRealHillshade;
  }

  /** Read-only snapshot of cached synthetic hillshade entry */
  public get synthCache(): Readonly<{ grid: number[][]; size: number }> | null {
    return this.cachedSynthHillshade;
  }

  /**
   * Invalidate real DEM hillshade cache (e.g. when custom DEM elevations are loaded).
   */
  public invalidateRealCache(): void {
    this.cachedRealHillshade = null;
  }

  /**
   * Invalidate synthetic hillshade cache.
   */
  public invalidateSyntheticCache(): void {
    this.cachedSynthHillshade = null;
  }

  /**
   * Invalidate all hillshade caches.
   */
  public invalidateAll(): void {
    this.cachedRealHillshade = null;
    this.cachedSynthHillshade = null;
  }

  /**
   * Generates or retrieves a shaded relief grid across genuine terrain coverage:
   * - In real DEM mode: uses genuine Ladakh DEM coordinates (+/-91.8 km E-W, +/-110.9 km N-S, aspect ratio ~1.2079),
   *   exact metric ground resolution (dx=359.45m, dy=434.17m), and 512x512 matrix.
   * - In synthetic mode: covers full 1,200x1,200 km regional domain (+/-600 km).
   *
   * Static terrain hillshades are cached to avoid recomputation across frames or mode toggles.
   *
   * @param terrainEngine Authoritative TerrainEngine instance (defaults to constructor instance if provided)
   * @param gridSize Dimension of square hillshade output grid (defaults to 512)
   */
  public generate(terrainEngine?: TerrainEngine, gridSize: number = 512): HillshadeResult {
    const engine = terrainEngine ?? this.defaultEngine;
    if (!engine) {
      throw new Error('HillshadeGenerator: TerrainEngine is required to generate hillshade.');
    }

    const size = gridSize;
    const isReal = engine.terrainMode === 'real' && engine.hasRealDem && engine.realDemGrid !== null;
    const bounds = engine.getTerrainBoundsTelemetry();

    // Check cache first to avoid recomputing static DEM hillshades
    if (isReal) {
      if (
        this.cachedRealHillshade &&
        this.cachedRealHillshade.demRef === engine.realDemGrid &&
        this.cachedRealHillshade.size === size
      ) {
        this.currentGrid = this.cachedRealHillshade.grid;
        return {
          grid: this.currentGrid,
          gridSize: size,
          boundsKm: bounds.halfWidthM / 1000.0,
          bounds,
          terrainMode: engine.terrain_mode,
          isCached: true,
          message: {
            type: 'HILLSHADE_READY',
            grid_size: size,
            bounds_km: bounds.halfWidthM / 1000.0,
            bounds,
            data: this.currentGrid,
            terrain_mode: engine.terrain_mode,
          },
        };
      }
    } else {
      if (
        this.cachedSynthHillshade &&
        this.cachedSynthHillshade.size === size
      ) {
        this.currentGrid = this.cachedSynthHillshade.grid;
        return {
          grid: this.currentGrid,
          gridSize: size,
          boundsKm: bounds.halfWidthM / 1000.0,
          bounds,
          terrainMode: engine.terrain_mode,
          isCached: true,
          message: {
            type: 'HILLSHADE_READY',
            grid_size: size,
            bounds_km: bounds.halfWidthM / 1000.0,
            bounds,
            data: this.currentGrid,
            terrain_mode: engine.terrain_mode,
          },
        };
      }
    }

    const meta = engine.demMetadata ?? REAL_LADAKH_DEM_METADATA;
    const stepX = isReal ? (bounds.maxX - bounds.minX) / (size - 1) : (THEATER_HALF_M * 2.0) / (size - 1);
    const stepY = isReal ? (bounds.maxY - bounds.minY) / (size - 1) : (THEATER_HALF_M * 2.0) / (size - 1);

    // Northwest Sun Illumination: Azimuth 315°, Altitude 45°
    const lx = -0.5;
    const ly = 0.5;
    const lz = 0.7071;

    // 1. Pre-sample continuous elevations across genuine coverage domain
    const elevMatrix: Float32Array[] = [];
    if (isReal && size === meta.rasterWidth && meta.rasterHeight === 512 && engine.realDemGrid && engine.realDemGrid.length === size * size) {
      // Direct access from point-registered satellite DEM raster (zero interpolation overhead)
      const realGrid = engine.realDemGrid;
      for (let r = 0; r < size; r++) {
        const row = new Float32Array(size);
        const offset = r * size;
        for (let c = 0; c < size; c++) {
          row[c] = realGrid[offset + c];
        }
        elevMatrix.push(row);
      }
    } else if (isReal) {
      for (let r = 0; r < size; r++) {
        const y = bounds.maxY - r * stepY;
        const row = new Float32Array(size);
        for (let c = 0; c < size; c++) {
          const x = bounds.minX + c * stepX;
          const val = engine.getElevation(x, y);
          row[c] = Number.isFinite(val) ? val : (meta.minElevationM ?? 0);
        }
        elevMatrix.push(row);
      }
    } else {
      // Synthetic procedural terrain across full 1,200 km regional domain
      for (let r = 0; r < size; r++) {
        const y = THEATER_HALF_M - r * stepY;
        const row = new Float32Array(size);
        for (let c = 0; c < size; c++) {
          const x = -THEATER_HALF_M + c * stepX;
          row[c] = engine.getElevation(x, y);
        }
        elevMatrix.push(row);
      }
    }

    // 2. Calculate gradients, surface normals, and Lambertian lighting
    const grid: number[][] = [];
    for (let r = 0; r < size; r++) {
      const rowPack: number[] = [];
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(size - 1, r + 1);

      for (let c = 0; c < size; c++) {
        const cPrev = Math.max(0, c - 1);
        const cNext = Math.min(size - 1, c + 1);

        const z = elevMatrix[r][c];

        // Explicit invalid / out-of-coverage handling: if elevation is NaN or non-finite, emit transparent/invalid pixel (0)
        if (!Number.isFinite(z)) {
          rowPack.push(0);
          continue;
        }

        // Compute x-gradient with NaN-safe finite difference
        let dzdx = 0.0;
        const zCNext = elevMatrix[r][cNext];
        const zCPrev = elevMatrix[r][cPrev];
        if (Number.isFinite(zCNext) && Number.isFinite(zCPrev) && cNext !== cPrev) {
          dzdx = (zCNext - zCPrev) / ((cNext - cPrev) * stepX);
        } else if (Number.isFinite(zCNext) && cNext !== c) {
          dzdx = (zCNext - z) / ((cNext - c) * stepX);
        } else if (Number.isFinite(zCPrev) && c !== cPrev) {
          dzdx = (z - zCPrev) / ((c - cPrev) * stepX);
        }

        // Compute y-gradient with NaN-safe finite difference
        // Note: rPrev is North (+Y) of rNext (South -Y), so (elev[rPrev] - elev[rNext]) / ((rNext - rPrev) * stepY)
        let dzdy = 0.0;
        const zRPrev = elevMatrix[rPrev][c];
        const zRNext = elevMatrix[rNext][c];
        if (Number.isFinite(zRPrev) && Number.isFinite(zRNext) && rNext !== rPrev) {
          dzdy = (zRPrev - zRNext) / ((rNext - rPrev) * stepY);
        } else if (Number.isFinite(zRPrev) && r !== rPrev) {
          dzdy = (zRPrev - z) / ((r - rPrev) * stepY);
        } else if (Number.isFinite(zRNext) && rNext !== r) {
          dzdy = (z - zRNext) / ((rNext - r) * stepY);
        }

        // Surface normal N = (-dzdx * exaggeration, -dzdy * exaggeration, 1.0)
        const ex = 2.4;
        const nx = -dzdx * ex;
        const ny = -dzdy * ex;
        const nz = 1.0;
        const lenN = Math.hypot(nx, ny, nz);

        // Dot product N . L
        const dot = (nx * lx + ny * ly + nz * lz) / lenN;
        const shade = Math.max(0.22, Math.min(1.0, 0.44 + 0.56 * dot));

        // Dark-mode tactical military color grading based on altitude
        const tElev = Math.max(0.0, Math.min(1.0, (z - 2800.0) / 3000.0));

        let rBase: number, gBase: number, bBase: number;
        if (tElev < 0.18) {
          // Low valleys: deep charcoal slate
          const t = tElev / 0.18;
          rBase = 14 + t * 6;  gBase = 19 + t * 7;  bBase = 28 + t * 8;
        } else if (tElev < 0.55) {
          // Mid-elevation slopes & ridges: tactical steel
          const t = (tElev - 0.18) / 0.37;
          rBase = 20 + t * 18; gBase = 26 + t * 22; bBase = 36 + t * 28;
        } else if (tElev < 0.85) {
          // High alpine massifs: dark granite
          const t = (tElev - 0.55) / 0.30;
          rBase = 38 + t * 24; gBase = 48 + t * 28; bBase = 64 + t * 34;
        } else {
          // Summit crests (Zanskar, Nun-Kun): subtle frosted peaks
          const t = (tElev - 0.85) / 0.15;
          rBase = 62 + t * 25; gBase = 76 + t * 28; bBase = 98 + t * 32;
        }

        const red = Math.min(255, Math.max(10, Math.floor(rBase * shade)));
        const green = Math.min(255, Math.max(14, Math.floor(gBase * shade)));
        const blue = Math.min(255, Math.max(20, Math.floor(bBase * shade)));

        const packed = (red << 16) | (green << 8) | blue;
        rowPack.push(packed);
      }
      grid.push(rowPack);
    }

    // Cache generated hillshade
    if (isReal) {
      this.cachedRealHillshade = {
        grid,
        demRef: engine.realDemGrid,
        size,
      };
    } else {
      this.cachedSynthHillshade = {
        grid,
        size,
      };
    }

    this.currentGrid = grid;
    return {
      grid,
      gridSize: size,
      boundsKm: bounds.halfWidthM / 1000.0,
      bounds,
      terrainMode: engine.terrain_mode,
      isCached: false,
      message: {
        type: 'HILLSHADE_READY',
        grid_size: size,
        bounds_km: bounds.halfWidthM / 1000.0,
        bounds,
        data: grid,
        terrain_mode: engine.terrain_mode,
      },
    };
  }
}
