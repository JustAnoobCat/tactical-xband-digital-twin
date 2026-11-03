/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Multi-Tile SRTM HGT Terrain Folder Loading, Mosaic Stitching & Patch Streaming
 *
 * Implements:
 *   - Automatic folder scanning and HGT tile cataloging.
 *   - Spatial clustering of contiguous neighbouring tiles (connected components).
 *   - Patch-based selection with bounded maximum active tiles for lower-end hardware.
 *   - Seamless multi-tile mosaic stitching with shared boundary edge resolution.
 *   - Missing tile graceful handling (NaN void fill).
 *   - LRU decoded tile cache for memory efficiency.
 */

import {
  SRTM3_BYTE_LENGTH,
  SRTM1_BYTE_LENGTH,
  SRTM3_SAMPLE_COUNT,
  SRTM1_SAMPLE_COUNT,
  HGT_METERS_PER_DEG_LAT,
  HGT_METERS_PER_DEG_LON,
  THEATER_ORIGIN_LAT_DEG,
  THEATER_ORIGIN_LON_DEG,
  parseSrtmTileName,
  decodeHgtBuffer,
} from './hgtParser';
import type { DemGeographicMetadata } from './terrain';

export const DEFAULT_MAX_ACTIVE_TILES = 4; // e.g. 2x2 contiguous patch
export const DEFAULT_LRU_CACHE_CAPACITY = 12; // In-memory decoded tiles

export interface SrtmCatalogTile {
  readonly tileName: string;
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
  readonly centerLatDeg: number;
  readonly centerLonDeg: number;
  readonly file: File | Blob;
  readonly sizeBytes: number;
  readonly resolution: 'SRTM1' | 'SRTM3';
  readonly sampleCount: number;
}

export interface DecodedTile {
  readonly tileName: string;
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
  readonly sampleCount: number;
  readonly elevations: Float32Array;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly voidCount: number;
}

export interface TileCluster {
  readonly clusterId: number;
  readonly tiles: readonly SrtmCatalogTile[];
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
}

export interface PatchSelection {
  readonly anchorTileName: string;
  readonly tiles: readonly SrtmCatalogTile[];
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
  readonly rows: number;
  readonly cols: number;
  readonly missingNeighbourNames: readonly string[];
}

export interface StitchedMosaicResult {
  readonly rasterWidth: number;
  readonly rasterHeight: number;
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
  readonly tileNames: readonly string[];
  readonly elevations: Float32Array;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly voidCount: number;
  readonly metadata: DemGeographicMetadata;
  readonly missingTiles: readonly string[];
}

/**
 * Builds a catalog of valid SRTM HGT tiles from a folder file list or array.
 * Validates filename format [NS]\d{2}[EW]\d{3}\.hgt and standard byte size.
 */
export function buildTileCatalog(
  files: Iterable<File | Blob | { name: string; size: number }>
): SrtmCatalogTile[] {
  const catalogMap = new Map<string, SrtmCatalogTile>();

  for (const f of files) {
    const filename = (f as any).name || (f as any).webkitRelativePath || '';
    if (!filename.toLowerCase().endsWith('.hgt')) {
      continue;
    }

    const coords = parseSrtmTileName(filename);
    if (!coords) {
      continue;
    }

    const size = (f as any).size || 0;
    let resolution: 'SRTM1' | 'SRTM3';
    let sampleCount: number;

    if (size === SRTM3_BYTE_LENGTH) {
      resolution = 'SRTM3';
      sampleCount = SRTM3_SAMPLE_COUNT;
    } else if (size === SRTM1_BYTE_LENGTH) {
      resolution = 'SRTM1';
      sampleCount = SRTM1_SAMPLE_COUNT;
    } else {
      // Skip files with invalid byte counts
      continue;
    }

    const tileName = coords.tileName;
    if (!catalogMap.has(tileName)) {
      catalogMap.set(tileName, {
        tileName,
        minLatDeg: coords.minLatDeg,
        maxLatDeg: coords.maxLatDeg,
        minLonDeg: coords.minLonDeg,
        maxLonDeg: coords.maxLonDeg,
        centerLatDeg: coords.centerLatDeg,
        centerLonDeg: coords.centerLonDeg,
        file: f as File | Blob,
        sizeBytes: size,
        resolution,
        sampleCount,
      });
    }
  }

  return Array.from(catalogMap.values()).sort((a, b) =>
    a.tileName.localeCompare(b.tileName)
  );
}

/**
 * Groups catalog tiles into contiguous geographic clusters (connected components).
 * Two tiles are adjacent if their latitude difference <= 1 and longitude difference <= 1.
 */
export function clusterNeighbouringTiles(
  catalog: readonly SrtmCatalogTile[]
): TileCluster[] {
  if (catalog.length === 0) return [];

  const tileMap = new Map<string, SrtmCatalogTile>();
  catalog.forEach((t) => tileMap.set(t.tileName, t));

  const visited = new Set<string>();
  const clusters: TileCluster[] = [];
  let nextClusterId = 1;

  for (const startTile of catalog) {
    if (visited.has(startTile.tileName)) continue;

    const clusterTiles: SrtmCatalogTile[] = [];
    const queue: SrtmCatalogTile[] = [startTile];
    visited.add(startTile.tileName);

    while (queue.length > 0) {
      const current = queue.shift()!;
      clusterTiles.push(current);

      // Check all 8 neighbours (N, S, E, W, and diagonals)
      for (let dLat = -1; dLat <= 1; dLat++) {
        for (let dLon = -1; dLon <= 1; dLon++) {
          if (dLat === 0 && dLon === 0) continue;

          const nLat = current.minLatDeg + dLat;
          const nLon = current.minLonDeg + dLon;
          const latHemi = nLat >= 0 ? 'N' : 'S';
          const lonHemi = nLon >= 0 ? 'E' : 'W';
          const nName = `${latHemi}${String(Math.abs(nLat)).padStart(2, '0')}${lonHemi}${String(
            Math.abs(nLon)
          ).padStart(3, '0')}`;

          const neighbour = tileMap.get(nName);
          if (neighbour && !visited.has(neighbour.tileName)) {
            visited.add(neighbour.tileName);
            queue.push(neighbour);
          }
        }
      }
    }

    let minLat = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let minLon = Number.POSITIVE_INFINITY;
    let maxLon = Number.NEGATIVE_INFINITY;

    for (const t of clusterTiles) {
      if (t.minLatDeg < minLat) minLat = t.minLatDeg;
      if (t.maxLatDeg > maxLat) maxLat = t.maxLatDeg;
      if (t.minLonDeg < minLon) minLon = t.minLonDeg;
      if (t.maxLonDeg > maxLon) maxLon = t.maxLonDeg;
    }

    clusters.push({
      clusterId: nextClusterId++,
      tiles: clusterTiles,
      minLatDeg: minLat,
      maxLatDeg: maxLat,
      minLonDeg: minLon,
      maxLonDeg: maxLon,
    });
  }

  // Sort by cluster size descending (largest contiguous area first)
  return clusters.sort((a, b) => b.tiles.length - a.tiles.length);
}

/**
 * Selects an active contiguous patch of tiles (bounded to maxTiles, default 4 = 2x2)
 * around an anchor tile or target geographic position.
 */
export function selectActivePatch(options: {
  catalog: readonly SrtmCatalogTile[];
  targetLatDeg?: number;
  targetLonDeg?: number;
  anchorTileName?: string;
  maxTiles?: number;
}): PatchSelection | null {
  const { catalog, anchorTileName } = options;
  if (!catalog || catalog.length === 0) return null;

  const targetLat = options.targetLatDeg ?? THEATER_ORIGIN_LAT_DEG;
  const targetLon = options.targetLonDeg ?? THEATER_ORIGIN_LON_DEG;
  const maxTiles = Math.max(1, Math.min(9, options.maxTiles ?? DEFAULT_MAX_ACTIVE_TILES));

  const tileMap = new Map<string, SrtmCatalogTile>();
  catalog.forEach((t) => tileMap.set(t.tileName, t));

  // Find anchor tile
  let anchorTile: SrtmCatalogTile | undefined;
  if (anchorTileName) {
    anchorTile = tileMap.get(anchorTileName.toUpperCase());
  }

  if (!anchorTile) {
    // Pick tile closest to target
    let minDistSq = Number.POSITIVE_INFINITY;
    for (const t of catalog) {
      const dLat = t.centerLatDeg - targetLat;
      const dLon = t.centerLonDeg - targetLon;
      const distSq = dLat * dLat + dLon * dLon;
      if (distSq < minDistSq) {
        minDistSq = distSq;
        anchorTile = t;
      }
    }
  }

  if (!anchorTile) return null;

  // If maxTiles is 1, return single tile patch
  if (maxTiles === 1) {
    return {
      anchorTileName: anchorTile.tileName,
      tiles: [anchorTile],
      minLatDeg: anchorTile.minLatDeg,
      maxLatDeg: anchorTile.maxLatDeg,
      minLonDeg: anchorTile.minLonDeg,
      maxLonDeg: anchorTile.maxLonDeg,
      rows: 1,
      cols: 1,
      missingNeighbourNames: [],
    };
  }

  // For maxTiles <= 4: evaluate 2x2 bounding boxes that contain the anchor tile
  // Candidates for anchor position in a 2x2:
  //   1) Anchor is bottom-left  ([lat, lat+1] x [lon, lon+1])
  //   2) Anchor is bottom-right ([lat, lat+1] x [lon-1, lon])
  //   3) Anchor is top-left     ([lat-1, lat] x [lon, lon+1])
  //   4) Anchor is top-right    ([lat-1, lat] x [lon-1, lon])
  const aLat = anchorTile.minLatDeg;
  const aLon = anchorTile.minLonDeg;

  interface WindowCandidate {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
    existingTiles: SrtmCatalogTile[];
    missingNames: string[];
    score: number;
  }

  const windows: WindowCandidate[] = [];
  const offsets = [
    { dLat: 0, dLon: 0 },
    { dLat: 0, dLon: -1 },
    { dLat: -1, dLon: 0 },
    { dLat: -1, dLon: -1 },
  ];

  for (const off of offsets) {
    const minLat = aLat + off.dLat;
    const maxLat = minLat + 2;
    const minLon = aLon + off.dLon;
    const maxLon = minLon + 2;

    const existing: SrtmCatalogTile[] = [];
    const missing: string[] = [];

    for (let rLat = minLat; rLat < maxLat; rLat++) {
      for (let cLon = minLon; cLon < maxLon; cLon++) {
        const latHemi = rLat >= 0 ? 'N' : 'S';
        const lonHemi = cLon >= 0 ? 'E' : 'W';
        const name = `${latHemi}${String(Math.abs(rLat)).padStart(2, '0')}${lonHemi}${String(
          Math.abs(cLon)
        ).padStart(3, '0')}`;

        const found = tileMap.get(name);
        if (found) {
          existing.push(found);
        } else {
          missing.push(name);
        }
      }
    }

    // Score favours windows with more existing tiles and closeness to target
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const distToTarget = Math.hypot(centerLat - targetLat, centerLon - targetLon);
    const score = existing.length * 10 - distToTarget;

    windows.push({
      minLat,
      maxLat,
      minLon,
      maxLon,
      existingTiles: existing,
      missingNames: missing,
      score,
    });
  }

  // Sort by score descending
  windows.sort((a, b) => b.score - a.score);
  const best = windows[0];

  return {
    anchorTileName: anchorTile.tileName,
    tiles: best.existingTiles,
    minLatDeg: best.minLat,
    maxLatDeg: best.maxLat,
    minLonDeg: best.minLon,
    maxLonDeg: best.maxLon,
    rows: best.maxLat - best.minLat,
    cols: best.maxLon - best.minLon,
    missingNeighbourNames: best.missingNames,
  };
}

/**
 * LRU In-Memory Cache for decoded HGT tiles.
 * Avoids redundant re-decoding when panning or shifting the active patch.
 */
export class DecodedTileCache {
  private cache = new Map<string, DecodedTile>();
  private readonly capacity: number;

  constructor(capacity = DEFAULT_LRU_CACHE_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  public get(tileName: string): DecodedTile | undefined {
    const key = tileName.toUpperCase();
    const item = this.cache.get(key);
    if (item) {
      // Refresh LRU order (delete and re-insert)
      this.cache.delete(key);
      this.cache.set(key, item);
    }
    return item;
  }

  public set(tileName: string, tile: DecodedTile): void {
    const key = tileName.toUpperCase();
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict oldest entry (first key in insertion-ordered map)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, tile);
  }

  public has(tileName: string): boolean {
    return this.cache.has(tileName.toUpperCase());
  }

  public get size(): number {
    return this.cache.size;
  }

  public clear(): void {
    this.cache.clear();
  }
}

/**
 * Stitches multiple neighbouring decoded HGT tiles into a single seamless mosaic Float32Array.
 * Handles:
 *   - Shared boundary edge resolution (averaging valid overlapping samples, void fill).
 *   - Missing tiles within the patch bounding box (filled with Number.NaN).
 *   - North-to-South row orientation and West-to-East column orientation.
 */
export function stitchHgtTiles(
  tiles: readonly DecodedTile[],
  explicitBounds?: { minLatDeg: number; maxLatDeg: number; minLonDeg: number; maxLonDeg: number }
): StitchedMosaicResult {
  if (!tiles || tiles.length === 0) {
    throw new Error('stitchHgtTiles: At least one tile is required to stitch a mosaic.');
  }

  // Determine uniform sample count (SRTM3 = 1201, SRTM1 = 3601)
  const sampleCount = tiles[0].sampleCount;

  // Determine bounding box in integer degrees
  let minLat = explicitBounds?.minLatDeg ?? Number.POSITIVE_INFINITY;
  let maxLat = explicitBounds?.maxLatDeg ?? Number.NEGATIVE_INFINITY;
  let minLon = explicitBounds?.minLonDeg ?? Number.POSITIVE_INFINITY;
  let maxLon = explicitBounds?.maxLonDeg ?? Number.NEGATIVE_INFINITY;

  for (const t of tiles) {
    if (t.minLatDeg < minLat) minLat = t.minLatDeg;
    if (t.maxLatDeg > maxLat) maxLat = t.maxLatDeg;
    if (t.minLonDeg < minLon) minLon = t.minLonDeg;
    if (t.maxLonDeg > maxLon) maxLon = t.maxLonDeg;
  }

  const tileRows = maxLat - minLat;
  const tileCols = maxLon - minLon;

  if (tileRows <= 0 || tileCols <= 0) {
    throw new Error(`stitchHgtTiles: Invalid mosaic dimensions: ${tileRows}x${tileCols} degrees.`);
  }

  // Mosaic raster dimensions
  // Each 1-deg interval adds (sampleCount - 1) cells, plus 1 for the closing boundary sample.
  const step = sampleCount - 1;
  const totalCols = tileCols * step + 1;
  const totalRows = tileRows * step + 1;

  const mosaic = new Float32Array(totalCols * totalRows).fill(Number.NaN);
  const weights = new Uint8Array(totalCols * totalRows);

  const tileSet = new Set<string>();
  tiles.forEach((t) => tileSet.add(t.tileName));

  const missingTiles: string[] = [];
  for (let rLat = minLat; rLat < maxLat; rLat++) {
    for (let cLon = minLon; cLon < maxLon; cLon++) {
      const latHemi = rLat >= 0 ? 'N' : 'S';
      const lonHemi = cLon >= 0 ? 'E' : 'W';
      const name = `${latHemi}${String(Math.abs(rLat)).padStart(2, '0')}${lonHemi}${String(
        Math.abs(cLon)
      ).padStart(3, '0')}`;
      if (!tileSet.has(name)) {
        missingTiles.push(name);
      }
    }
  }

  let minElev = Number.POSITIVE_INFINITY;
  let maxElev = Number.NEGATIVE_INFINITY;
  let voidCount = 0;

  // Stamp each tile into the mosaic
  for (const tile of tiles) {
    // Tile row 0 is Northern edge. Tile col 0 is Western edge.
    // In mosaic: tr = 0 is Northernmost tile row (maxLat - tile.maxLatDeg)
    const tr = maxLat - tile.maxLatDeg;
    const tc = tile.minLonDeg - minLon;

    const rowOffset = tr * step;
    const colOffset = tc * step;
    const N = tile.sampleCount;

    for (let r = 0; r < N; r++) {
      const destR = rowOffset + r;
      const destRowBase = destR * totalCols;
      const srcRowBase = r * N;

      for (let c = 0; c < N; c++) {
        const destC = colOffset + c;
        const destIdx = destRowBase + destC;
        const val = tile.elevations[srcRowBase + c];

        if (Number.isFinite(val)) {
          const curW = weights[destIdx];
          if (curW === 0) {
            mosaic[destIdx] = val;
            weights[destIdx] = 1;
          } else {
            // Shared boundary edge with neighbour: average overlapping valid samples
            mosaic[destIdx] = (mosaic[destIdx] * curW + val) / (curW + 1);
            weights[destIdx] = (curW + 1) as any;
          }
        }
      }
    }
  }

  // Calculate elevation statistics and void count across the mosaic
  for (let i = 0; i < mosaic.length; i++) {
    const v = mosaic[i];
    if (Number.isFinite(v)) {
      if (v < minElev) minElev = v;
      if (v > maxElev) maxElev = v;
    } else {
      voidCount++;
    }
  }

  // Derive georeferenced Cartesian bounds relative to theater origin (34.5°N, 76.5°E)
  const minX = (minLon - THEATER_ORIGIN_LON_DEG) * HGT_METERS_PER_DEG_LON;
  const maxX = (maxLon - THEATER_ORIGIN_LON_DEG) * HGT_METERS_PER_DEG_LON;
  const minY = (minLat - THEATER_ORIGIN_LAT_DEG) * HGT_METERS_PER_DEG_LAT;
  const maxY = (maxLat - THEATER_ORIGIN_LAT_DEG) * HGT_METERS_PER_DEG_LAT;
  const halfWidthM = (maxX - minX) / 2.0;
  const halfHeightM = (maxY - minY) / 2.0;

  const tileNames = tiles.map((t) => t.tileName).sort();
  const tileLabel = tileNames.length === 1 ? tileNames[0] : `PATCH [${tileNames.join(', ')}]`;

  const metadata: DemGeographicMetadata = {
    rasterWidth: totalCols,
    rasterHeight: totalRows,
    centerLatDeg: (minLat + maxLat) / 2.0,
    centerLonDeg: (minLon + maxLon) / 2.0,
    minLatDeg: minLat,
    maxLatDeg: maxLat,
    minLonDeg: minLon,
    maxLonDeg: maxLon,
    halfWidthM,
    halfHeightM,
    groundResolutionXM: (maxX - minX) / (totalCols - 1),
    groundResolutionYM: (maxY - minY) / (totalRows - 1),
    minX,
    maxX,
    minY,
    maxY,
    tileName: tileLabel,
    minElevationM: Number.isFinite(minElev) ? minElev : 0,
    maxElevationM: Number.isFinite(maxElev) ? maxElev : 0,
    voidCount,
  };

  return {
    rasterWidth: totalCols,
    rasterHeight: totalRows,
    minLatDeg: minLat,
    maxLatDeg: maxLat,
    minLonDeg: minLon,
    maxLonDeg: maxLon,
    tileNames,
    elevations: mosaic,
    minElevationM: Number.isFinite(minElev) ? minElev : 0,
    maxElevationM: Number.isFinite(maxElev) ? maxElev : 0,
    voidCount,
    metadata,
    missingTiles,
  };
}

