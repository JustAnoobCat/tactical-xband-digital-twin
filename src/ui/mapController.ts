/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * MapLibre Subsystem Controller & Screen Projection Seam (M7.2)
 *
 * Implements high-performance screen-space projection from authoritative local Cartesian
 * ENU coordinates to MapLibre container pixels via WGS-84 Plate Carrée geodesy.
 * Powers 60 FPS transparent kinetic canvas animation overlays above MapLibre.
 */

import {
  cartesianToGeodetic,
  GEODESY_ORIGIN_LAT_DEG,
  GEODESY_ORIGIN_LON_DEG,
  METERS_PER_DEG_LAT,
  METERS_PER_DEG_LON,
} from '../core/geodesy';
import { THEATER_BIOMES, type BiomeId } from '../core/biomePhysics';
import { BIOME_DEM_METADATA } from '../core/terrain';
import {
  DEFAULT_WORLD_SATELLITE_ATTRIBUTION,
  DEFAULT_WORLD_SATELLITE_TILE_URL,
  getAirGapOfflineOnly,
  isExternalHttpUrl,
} from './worldTileLayer';

export interface MapLibreStyleOptions {
  readonly airGapOfflineOnly?: boolean;
  readonly rasterTiles?: readonly string[];
  readonly attribution?: string;
  readonly maxzoom?: number;
}

export function buildOfflineSafeMapStyle(options: MapLibreStyleOptions = {}): Record<string, any> {
  const airGap = options.airGapOfflineOnly ?? getAirGapOfflineOnly();
  const rawTiles = options.rasterTiles && options.rasterTiles.length > 0
    ? options.rasterTiles
    : [DEFAULT_WORLD_SATELLITE_TILE_URL];
  const allowedTiles = airGap
    ? rawTiles.filter((t) => typeof t === 'string' && t.trim().length > 0 && !isExternalHttpUrl(t))
    : rawTiles.filter((t) => typeof t === 'string' && t.trim().length > 0);

  const bgLayer = {
    id: 'airgap-bg',
    type: 'background',
    paint: { 'background-color': '#0b1017' },
  };

  if (allowedTiles.length === 0) {
    return {
      version: 8,
      sources: {},
      layers: [bgLayer],
    };
  }

  return {
    version: 8,
    sources: {
      'maplibre-satellite': {
        type: 'raster',
        tiles: [...allowedTiles],
        tileSize: 256,
        maxzoom: Number.isFinite(Number(options.maxzoom)) ? Number(options.maxzoom) : 19,
        attribution: options.attribution || DEFAULT_WORLD_SATELLITE_ATTRIBUTION,
      },
    },
    layers: [
      bgLayer,
      {
        id: 'maplibre-satellite-layer',
        type: 'raster',
        source: 'maplibre-satellite',
      },
    ],
  };
}

export class MapController {
  private map: any;
  private biomeId: BiomeId = 'alpine_mountain';
  private customOriginLatDeg: number | undefined;
  private customOriginLonDeg: number | undefined;

  constructor(mapInstance?: any, biomeId: BiomeId = 'alpine_mountain') {
    this.map = mapInstance ?? null;
    if (biomeId && (biomeId in BIOME_DEM_METADATA || biomeId in THEATER_BIOMES)) {
      this.biomeId = biomeId;
    }
  }

  public setMapInstance(mapInstance: any): void {
    this.map = mapInstance;
  }

  public getMapInstance(): any {
    return this.map;
  }

  public setBiome(biomeId: BiomeId): void {
    if (biomeId && (biomeId in BIOME_DEM_METADATA || biomeId in THEATER_BIOMES)) {
      this.biomeId = biomeId;
      this.customOriginLatDeg = undefined;
      this.customOriginLonDeg = undefined;
    }
  }

  public getBiome(): BiomeId {
    return this.biomeId;
  }

  public setOrigin(latDeg: number, lonDeg: number): void {
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return;
    this.customOriginLatDeg = latDeg;
    this.customOriginLonDeg = lonDeg;
  }

  public getOrigin(): { latDeg: number; lonDeg: number } {
    if (
      this.customOriginLatDeg !== undefined &&
      this.customOriginLonDeg !== undefined
    ) {
      return { latDeg: this.customOriginLatDeg, lonDeg: this.customOriginLonDeg };
    }
    const meta = BIOME_DEM_METADATA[this.biomeId];
    const def = THEATER_BIOMES[this.biomeId];
    return {
      latDeg: meta?.centerLatDeg ?? def?.centerLatDeg ?? GEODESY_ORIGIN_LAT_DEG,
      lonDeg: meta?.centerLonDeg ?? def?.centerLonDeg ?? GEODESY_ORIGIN_LON_DEG,
    };
  }

  public buildMapLibreStyle(options: MapLibreStyleOptions = {}): Record<string, any> {
    return buildOfflineSafeMapStyle(options);
  }

  /**
   * Projects local ENU Cartesian coordinates (xM, yM in metres) to WGS-84 geodetic
   * coordinates using the active biome center (BIOME_DEM_METADATA / THEATER_BIOMES).
   */
  public projectEnuToGeodetic(xM: number, yM: number): { latDeg: number; lonDeg: number } {
    const hasCustom =
      this.customOriginLatDeg !== undefined && this.customOriginLonDeg !== undefined;
    if (!hasCustom && this.biomeId === 'alpine_mountain') {
      const geo = cartesianToGeodetic(xM, yM);
      return { latDeg: geo.latDeg, lonDeg: geo.lonDeg };
    }

    if (hasCustom) {
      const centerLat = this.customOriginLatDeg as number;
      const centerLon = this.customOriginLonDeg as number;
      const mPerDegLat = METERS_PER_DEG_LAT;
      const mPerDegLon = Math.max(
        1000.0,
        111320.0 * Math.cos((centerLat * Math.PI) / 180.0)
      );
      return {
        latDeg: centerLat + yM / mPerDegLat,
        lonDeg: centerLon + xM / mPerDegLon,
      };
    }

    const meta = BIOME_DEM_METADATA[this.biomeId];
    const def = THEATER_BIOMES[this.biomeId];
    const centerLat = meta?.centerLatDeg ?? def?.centerLatDeg ?? GEODESY_ORIGIN_LAT_DEG;
    const centerLon = meta?.centerLonDeg ?? def?.centerLonDeg ?? GEODESY_ORIGIN_LON_DEG;

    const mPerDegLat = meta?.halfHeightM ?? METERS_PER_DEG_LAT;
    const mPerDegLon =
      meta?.halfWidthM ??
      (METERS_PER_DEG_LON / Math.cos((GEODESY_ORIGIN_LAT_DEG * Math.PI) / 180.0)) *
        Math.cos((centerLat * Math.PI) / 180.0);

    return {
      latDeg: centerLat + yM / mPerDegLat,
      lonDeg: centerLon + xM / mPerDegLon,
    };
  }

  /**
   * Projects local ENU Cartesian coordinates (xM, yM in metres) to screen container point { x, y }
   * via biome-aware WGS-84 geodetic conversion and MapLibre map.project([lon, lat]).
   * Returns null if MapLibre instance is unavailable or point projection fails.
   */
  public projectEnuToContainerPoint(xM: number, yM: number): { x: number; y: number } | null {
    if (!this.map || typeof this.map.project !== 'function') {
      return null;
    }
    try {
      const geo = this.projectEnuToGeodetic(xM, yM);
      const pt = this.map.project([geo.lonDeg, geo.latDeg]);
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
        return null;
      }
      return { x: pt.x, y: pt.y };
    } catch {
      return null;
    }
  }
}
