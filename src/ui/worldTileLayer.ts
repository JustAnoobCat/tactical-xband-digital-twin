/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Global Radar DEM & Slippy-Tile Renderer for 2D Radar Canvas
 *
 * Projects global Web Mercator Terrarium elevation tiles onto the 2D Radar canvas's
 * equirectangular ENU coordinate system and shades every tile using the exact
 * dark-mode tactical Lambertian hillshade palette from hillshadeGenerator.ts.
 * This ensures every tile across the entire globe renders in unified Radar mode
 * (never MapLibre full-color satellite photography) when zoomed out in Radar SAT mode.
 */

import {
  GEODESY_ORIGIN_LAT_DEG,
  GEODESY_ORIGIN_LON_DEG,
  METERS_PER_DEG_LAT,
  METERS_PER_DEG_LON,
} from '../core/geodesy';
import type { RadarViewport } from './controllers/radar2dRenderer';

export const DEFAULT_WORLD_SATELLITE_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const DEFAULT_WORLD_SATELLITE_ATTRIBUTION =
  'Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export const DEFAULT_WORLD_RADAR_DEM_TILE_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const MAX_MERCATOR_LAT_DEG = 85.05112878;
const MAX_VISIBLE_TILES_PER_FRAME = 120;
const MIN_WORLD_TILE_ZOOM = 2;
const MAX_WORLD_TILE_ZOOM = 15;
const TILE_ERROR_RETRY_COOLDOWN_MS = 30_000;
const DEFAULT_WORLD_TILE_CACHE_SIZE = 64;
const DEFAULT_TERRARIUM_SCRATCH_PIXELS = 65536;

export const AIRGAP_OFFLINE_STORAGE_KEY = 'xband_airgap_offline_only';

let sharedTerrariumElevScratch = new Float32Array(DEFAULT_TERRARIUM_SCRATCH_PIXELS);

function getTerrariumElevScratch(totalPixels: number): Float32Array {
  if (totalPixels <= sharedTerrariumElevScratch.length) {
    return sharedTerrariumElevScratch;
  }
  sharedTerrariumElevScratch = new Float32Array(totalPixels);
  return sharedTerrariumElevScratch;
}

export function isAirGapDefaultEnvironment(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' && navigator.userAgent.includes('Electron')) {
    return true;
  }
  if (typeof window !== 'undefined' && window !== null) {
    if ('__TAURI__' in window || '__TAURI_INTERNALS__' in window) {
      return true;
    }
  }
  if (typeof location !== 'undefined') {
    if (
      typeof location.protocol === 'string' &&
      (location.protocol === 'file:' || location.protocol === 'tauri:' || location.protocol === 'app:')
    ) {
      return true;
    }
    if (
      typeof location.hostname === 'string' &&
      (location.hostname === 'tauri.localhost' || location.hostname.endsWith('.tauri.localhost'))
    ) {
      return true;
    }
  }
  return false;
}

export function getAirGapOfflineOnly(): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(AIRGAP_OFFLINE_STORAGE_KEY);
      if (stored === '1' || stored === 'true') return true;
      if (stored === '0' || stored === 'false') return false;
    }
  } catch {
    // Ignore storage access restrictions
  }
  return isAirGapDefaultEnvironment();
}

export function setAirGapOfflineOnly(enabled: boolean): boolean {
  const next = Boolean(enabled);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(AIRGAP_OFFLINE_STORAGE_KEY, next ? '1' : '0');
    }
  } catch {
    // Ignore storage access restrictions
  }
  return next;
}

export function isExternalHttpUrl(url: string): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

export interface VisibleWorldTile {
  readonly z: number;
  readonly tx: number;
  readonly ty: number;
  readonly key: string;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

export function tileXToLonDeg(tx: number, z: number): number {
  return (tx / Math.pow(2, z)) * 360.0 - 180.0;
}

export function tileYToLatDeg(ty: number, z: number): number {
  const n = Math.PI - (2.0 * Math.PI * ty) / Math.pow(2, z);
  return (180.0 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function lonDegToTileX(lonDeg: number, z: number): number {
  return Math.floor(((lonDeg + 180.0) / 360.0) * Math.pow(2, z));
}

export function latDegToTileY(latDeg: number, z: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LAT_DEG, Math.min(MAX_MERCATOR_LAT_DEG, latDeg));
  const latRad = (clamped * Math.PI) / 180.0;
  const mercN = Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad));
  const y = ((1.0 - mercN / Math.PI) / 2.0) * Math.pow(2, z);
  return Math.floor(y);
}

function resolveMetersPerDegLon(originLatDeg: number): number {
  if (Math.abs(originLatDeg - GEODESY_ORIGIN_LAT_DEG) < 1e-9) {
    return METERS_PER_DEG_LON;
  }
  return Math.max(1000.0, METERS_PER_DEG_LAT * Math.cos((originLatDeg * Math.PI) / 180.0));
}

/**
 * Unwrapped linear conversion from geodetic (lat, lon) to local Radar ENU meters.
 */
export function geodeticToUnwrappedEnu(
  latDeg: number,
  lonDeg: number,
  originLatDeg: number = GEODESY_ORIGIN_LAT_DEG,
  originLonDeg: number = GEODESY_ORIGIN_LON_DEG
): { xM: number; yM: number } {
  const mPerDegLon = resolveMetersPerDegLon(originLatDeg);
  return {
    xM: (lonDeg - originLonDeg) * mPerDegLon,
    yM: (latDeg - originLatDeg) * METERS_PER_DEG_LAT,
  };
}

export function formatSlippyTileUrl(template: string, z: number, tx: number, ty: number): string {
  return template
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(tx))
    .replace(/\{y\}/g, String(ty));
}

/**
 * Decodes AWS Terrarium RGB pixel into elevation in metres MSL.
 * Formula: elevation_m = (R * 256 + G + B / 256) - 32768
 */
export function decodeTerrariumElevationM(r: number, g: number, b: number): number {
  return r * 256.0 + g + b / 256.0 - 32768.0;
}

/**
 * Maps elevation (m MSL) and Lambertian shade factor [0.22..1.0] into the
 * dark-mode tactical Radar military color ramp matching hillshadeGenerator.ts.
 */
export function shadeRadarElevationRgb(
  elevM: number,
  shade: number,
  isCoastline = false
): [number, number, number] {
  if (elevM <= 0.0) {
    // Ocean / bathymetry: deep tactical abyssal navy
    const tOcean = Math.max(0.0, Math.min(1.0, (elevM + 5000.0) / 5000.0));
    const oceanShade = 0.78 + 0.22 * shade;
    const r = Math.min(255, Math.max(5, Math.floor((6 + tOcean * 5) * oceanShade)));
    const g = Math.min(255, Math.max(8, Math.floor((10 + tOcean * 6) * oceanShade)));
    const b = Math.min(255, Math.max(13, Math.floor((16 + tOcean * 9) * oceanShade)));
    return [r, g, b];
  }

  let rBase: number;
  let gBase: number;
  let bBase: number;

  if (elevM < 1200.0) {
    // Coastal plains & lowlands: crisp dark tactical slate clearly distinct from ocean
    const t = elevM / 1200.0;
    rBase = 17 + t * 5;
    gBase = 23 + t * 6;
    bBase = 33 + t * 7;
  } else if (elevM < 2800.0) {
    // Foothills & plateaus transitioning smoothly into Ladakh's valley palette
    const t = (elevM - 1200.0) / 1600.0;
    rBase = 22 + t * 3;
    gBase = 29 + t * 3;
    bBase = 40 + t * 4;
  } else if (elevM < 4450.0) {
    // Mid-elevation slopes & ridges: tactical steel (matches hillshadeGenerator.ts)
    const t = (elevM - 2800.0) / 1650.0;
    rBase = 25 + t * 13;
    gBase = 32 + t * 16;
    bBase = 44 + t * 20;
  } else if (elevM < 5350.0) {
    // High alpine massifs: dark granite (matches hillshadeGenerator.ts)
    const t = (elevM - 4450.0) / 900.0;
    rBase = 38 + t * 24;
    gBase = 48 + t * 28;
    bBase = 64 + t * 34;
  } else {
    // Summit crests: subtle frosted peaks (matches hillshadeGenerator.ts)
    const t = Math.max(0.0, Math.min(1.0, (elevM - 5350.0) / 1200.0));
    rBase = 62 + t * 26;
    gBase = 76 + t * 30;
    bBase = 98 + t * 36;
  }

  let red = Math.min(255, Math.max(10, Math.floor(rBase * shade)));
  let green = Math.min(255, Math.max(14, Math.floor(gBase * shade)));
  let blue = Math.min(255, Math.max(20, Math.floor(bBase * shade)));

  if (isCoastline) {
    // Subtle radar shoreline accent for crisp global continent silhouettes
    red = Math.min(255, red + 14);
    green = Math.min(255, green + 22);
    blue = Math.min(255, blue + 30);
  }

  return [red, green, blue];
}

/**
 * Converts raw Terrarium RGBA pixel buffer (width x height) into a shaded
 * dark-mode tactical Radar hillshade RGBA buffer using NW 315° Lambertian lighting.
 */
export function shadeTerrariumTileRgba(
  srcRgba: Uint8ClampedArray,
  dstRgba: Uint8ClampedArray,
  width: number,
  height: number,
  z: number,
  centerLatDeg: number
): void {
  const total = width * height;
  const elev = getTerrariumElevScratch(total);
  for (let i = 0; i < total; i++) {
    const p = i << 2;
    elev[i] = decodeTerrariumElevationM(srcRgba[p], srcRgba[p + 1], srcRgba[p + 2]);
  }

  const latRad = (Math.max(-80, Math.min(80, centerLatDeg)) * Math.PI) / 180.0;
  const metersPerPixel = Math.max(1.0, (156543.03392 * Math.cos(latRad)) / Math.pow(2, z));
  // Boost vertical relief gently at continental/world zooms so mountain chains stay crisp
  const ex = z >= 8 ? 2.4 : z >= 5 ? 4.5 : 8.5;

  // NW 315° / 45° Sun illumination matching hillshadeGenerator.ts
  const lx = -0.5;
  const ly = 0.5;
  const lz = 0.7071;

  for (let r = 0; r < height; r++) {
    const rPrev = r > 0 ? r - 1 : 0;
    const rNext = r < height - 1 ? r + 1 : height - 1;
    const rowOff = r * width;
    const rowPrevOff = rPrev * width;
    const rowNextOff = rNext * width;
    const spanY = Math.max(1, rNext - rPrev) * metersPerPixel;

    for (let c = 0; c < width; c++) {
      const cPrev = c > 0 ? c - 1 : 0;
      const cNext = c < width - 1 ? c + 1 : width - 1;
      const spanX = Math.max(1, cNext - cPrev) * metersPerPixel;

      const idx = rowOff + c;
      const zVal = elev[idx];
      const dzdx = (elev[rowOff + cNext] - elev[rowOff + cPrev]) / spanX;
      // rPrev is North (+Y), rNext is South (-Y)
      const dzdy = (elev[rowPrevOff + c] - elev[rowNextOff + c]) / spanY;

      const nx = -dzdx * ex;
      const ny = -dzdy * ex;
      const nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);
      const dot = (nx * lx + ny * ly + nz * lz) * invLen;
      const shade = Math.max(0.24, Math.min(1.0, 0.46 + 0.54 * dot));

      const isCoast =
        zVal > 0.0 &&
        (elev[rowOff + cPrev] <= 0.0 ||
          elev[rowOff + cNext] <= 0.0 ||
          elev[rowPrevOff + c] <= 0.0 ||
          elev[rowNextOff + c] <= 0.0);

      const [red, green, blue] = shadeRadarElevationRgb(zVal, shade, isCoast);
      const p = idx << 2;
      dstRgba[p] = red;
      dstRgba[p + 1] = green;
      dstRgba[p + 2] = blue;
      dstRgba[p + 3] = 255;
    }
  }
}

/**
 * Computes the list of visible Web Mercator tiles projected into exact
 * screen rectangles for the current 2D Radar viewport.
 */
export function computeVisibleWorldTiles(
  viewport: RadarViewport,
  origin?: { readonly latDeg: number; readonly lonDeg: number }
): VisibleWorldTile[] {
  const w = viewport.width;
  const h = viewport.height;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return [];

  const originLatDeg =
    origin && Number.isFinite(origin.latDeg)
      ? Math.max(-MAX_MERCATOR_LAT_DEG, Math.min(MAX_MERCATOR_LAT_DEG, origin.latDeg))
      : GEODESY_ORIGIN_LAT_DEG;
  const originLonDeg =
    origin && Number.isFinite(origin.lonDeg) ? origin.lonDeg : GEODESY_ORIGIN_LON_DEG;
  const mPerDegLon = resolveMetersPerDegLon(originLatDeg);

  const validRange = Number.isFinite(viewport.rangeM) && viewport.rangeM > 0 ? viewport.rangeM : 60000;
  const centerX = w / 2;
  const centerY = h / 2;
  const scale = (Math.min(centerX, centerY) * 0.94) / validRange;
  if (!Number.isFinite(scale) || scale <= 0) return [];

  const panX = viewport.panOffsetX_m ?? 0;
  const panY = viewport.panOffsetY_m ?? 0;

  const minXM = panX - centerX / scale;
  const maxXM = panX + centerX / scale;
  const minYM = panY - centerY / scale;
  const maxYM = panY + centerY / scale;

  const minLon = originLonDeg + minXM / mPerDegLon;
  const maxLon = originLonDeg + maxXM / mPerDegLon;
  const minLat = Math.max(-MAX_MERCATOR_LAT_DEG, originLatDeg + minYM / METERS_PER_DEG_LAT);
  const maxLat = Math.min(MAX_MERCATOR_LAT_DEG, originLatDeg + maxYM / METERS_PER_DEG_LAT);

  if (minLat >= maxLat) return [];

  const spanLonDeg = Math.max(1e-4, maxLon - minLon);
  const degPerPx = spanLonDeg / Math.max(1, w);
  const rawZoom = Math.log2(360.0 / (256.0 * degPerPx));
  // Prefer z >= 3 at continental/world scale so each Mercator latitude band is thin
  // enough to reproject accurately onto the equirectangular Radar canvas.
  let z = Math.max(3, Math.min(MAX_WORLD_TILE_ZOOM, Math.round(rawZoom)));

  const computeBoundsForZoom = (zoom: number) => {
    const n = 1 << zoom;
    const rawMinTx = Math.floor(((minLon + 180.0) / 360.0) * n);
    const rawMaxTx = Math.floor(((maxLon + 180.0) / 360.0) * n);
    const minTx = Math.max(-n, rawMinTx);
    const maxTx = Math.min(2 * n - 1, rawMaxTx);
    const minTy = Math.max(0, latDegToTileY(maxLat, zoom));
    const maxTy = Math.min(n - 1, latDegToTileY(minLat, zoom));
    return { n, minTx, maxTx, minTy, maxTy };
  };

  let bounds = computeBoundsForZoom(z);
  while (
    z > MIN_WORLD_TILE_ZOOM &&
    (bounds.maxTx - bounds.minTx + 1) * (bounds.maxTy - bounds.minTy + 1) > MAX_VISIBLE_TILES_PER_FRAME
  ) {
    z -= 1;
    bounds = computeBoundsForZoom(z);
  }

  const { n, minTx, maxTx, minTy, maxTy } = bounds;
  if (minTx > maxTx || minTy > maxTy) return [];

  const tiles: VisibleWorldTile[] = [];
  for (let ty = minTy; ty <= maxTy; ty++) {
    const latNorth = tileYToLatDeg(ty, z);
    const latSouth = tileYToLatDeg(ty + 1, z);
    const yNorthM = (latNorth - originLatDeg) * METERS_PER_DEG_LAT;
    const ySouthM = (latSouth - originLatDeg) * METERS_PER_DEG_LAT;
    const sy0 = centerY - (yNorthM - panY) * scale;
    const sy1 = centerY - (ySouthM - panY) * scale;
    const dh = sy1 - sy0;
    if (dh <= 0 || sy1 < -2 || sy0 > h + 2) continue;

    for (let txRaw = minTx; txRaw <= maxTx; txRaw++) {
      const lonWest = (txRaw / n) * 360.0 - 180.0;
      const lonEast = ((txRaw + 1) / n) * 360.0 - 180.0;
      const xWestM = (lonWest - originLonDeg) * mPerDegLon;
      const xEastM = (lonEast - originLonDeg) * mPerDegLon;
      const sx0 = centerX + (xWestM - panX) * scale;
      const sx1 = centerX + (xEastM - panX) * scale;
      const dw = sx1 - sx0;
      if (dw <= 0 || sx1 < -2 || sx0 > w + 2) continue;

      const tx = ((txRaw % n) + n) % n;
      tiles.push({
        z,
        tx,
        ty,
        key: `${z}/${tx}/${ty}`,
        dx: sx0,
        dy: sy0,
        dw,
        dh,
      });
    }
  }

  return tiles;
}

export type WorldTileRenderMode = 'radar-terrarium' | 'raster';

interface CachedTileEntry {
  status: 'loading' | 'loaded' | 'error';
  source: HTMLCanvasElement | HTMLImageElement;
  width: number;
  height: number;
  lastUsed: number;
  errorTimestampMs?: number;
}

export interface WorldTileLayerOptions {
  readonly tileUrlTemplate?: string;
  readonly renderMode?: WorldTileRenderMode;
  readonly maxCacheSize?: number;
  readonly opacity?: number;
  readonly allowExternalTiles?: boolean;
  readonly airGapOfflineOnly?: boolean;
  readonly originLatDeg?: number;
  readonly originLonDeg?: number;
}

/**
 * Stateful LRU-cached global tile layer for 2D Radar canvas rendering.
 * In default 'radar-terrarium' mode, decodes global Terrarium elevation PNGs into
 * cached dark-mode tactical Radar hillshade canvases matching hillshadeGenerator.ts.
 */
export class WorldTileLayer {
  private tileUrlTemplate: string;
  private readonly renderMode: WorldTileRenderMode;
  private readonly maxCacheSize: number;
  private readonly opacity: number;
  private allowExternalTilesOption: boolean | undefined;
  private airGapOfflineOnlyOption: boolean | undefined;
  private originLatDeg: number;
  private originLonDeg: number;
  private readonly cache = new Map<string, CachedTileEntry>();
  private accessTick = 0;
  private loadGeneration = 0;
  private pendingNotify = false;

  constructor(options: WorldTileLayerOptions = {}) {
    this.renderMode = options.renderMode ?? 'radar-terrarium';
    this.tileUrlTemplate =
      options.tileUrlTemplate ||
      (this.renderMode === 'radar-terrarium'
        ? DEFAULT_WORLD_RADAR_DEM_TILE_URL
        : DEFAULT_WORLD_SATELLITE_TILE_URL);
    this.maxCacheSize = options.maxCacheSize ?? DEFAULT_WORLD_TILE_CACHE_SIZE;
    this.opacity = options.opacity ?? 0.96;
    this.allowExternalTilesOption = options.allowExternalTiles;
    this.airGapOfflineOnlyOption = options.airGapOfflineOnly;
    this.originLatDeg =
      options.originLatDeg !== undefined && Number.isFinite(options.originLatDeg)
        ? Math.max(-MAX_MERCATOR_LAT_DEG, Math.min(MAX_MERCATOR_LAT_DEG, options.originLatDeg))
        : GEODESY_ORIGIN_LAT_DEG;
    this.originLonDeg =
      options.originLonDeg !== undefined && Number.isFinite(options.originLonDeg)
        ? options.originLonDeg
        : GEODESY_ORIGIN_LON_DEG;
  }

  public getMaxCacheSize(): number {
    return this.maxCacheSize;
  }

  public isAirGapOfflineOnly(): boolean {
    if (this.airGapOfflineOnlyOption !== undefined) {
      return this.airGapOfflineOnlyOption;
    }
    return getAirGapOfflineOnly();
  }

  public setAirGapOfflineOnly(enabled: boolean | undefined): void {
    this.airGapOfflineOnlyOption = enabled;
  }

  public isExternalTilesAllowed(): boolean {
    if (this.isAirGapOfflineOnly() && isExternalHttpUrl(this.tileUrlTemplate)) {
      return false;
    }
    if (this.allowExternalTilesOption !== undefined) {
      return this.allowExternalTilesOption;
    }
    if (typeof navigator !== 'undefined') {
      if (typeof navigator.userAgent === 'string' && navigator.userAgent.includes('Electron')) {
        return false;
      }
      if (navigator.onLine === false) {
        return false;
      }
    }
    return true;
  }

  public setAllowExternalTiles(allow: boolean | undefined): void {
    this.allowExternalTilesOption = allow;
  }

  public setOrigin(latDeg: number, lonDeg: number): void {
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return;
    const clampedLat = Math.max(-MAX_MERCATOR_LAT_DEG, Math.min(MAX_MERCATOR_LAT_DEG, latDeg));
    this.originLatDeg = clampedLat;
    this.originLonDeg = lonDeg;
    this.loadGeneration++;
  }

  public getOrigin(): { latDeg: number; lonDeg: number } {
    return { latDeg: this.originLatDeg, lonDeg: this.originLonDeg };
  }

  public getLoadGeneration(): number {
    return this.loadGeneration;
  }

  public setTileUrlTemplate(template: string): void {
    if (template && template !== this.tileUrlTemplate) {
      this.tileUrlTemplate = template;
      this.clear();
    }
  }

  public getTileUrlTemplate(): string {
    return this.tileUrlTemplate;
  }

  public getLoadedTileCount(): number {
    let count = 0;
    for (const entry of this.cache.values()) {
      if (entry.status === 'loaded') count++;
    }
    return count;
  }

  private releaseEntryMemory(entry: CachedTileEntry | undefined): void {
    if (!entry) return;
    const src = entry.source as unknown as {
      width?: number;
      height?: number;
      getContext?: unknown;
      src?: string;
      onload?: unknown;
      onerror?: unknown;
    };
    const isCanvasLike =
      typeof src.getContext === 'function' ||
      (typeof HTMLCanvasElement !== 'undefined' && entry.source instanceof HTMLCanvasElement) ||
      (!('src' in src) && typeof src.width === 'number' && typeof src.height === 'number');
    if (isCanvasLike) {
      src.width = 0;
      src.height = 0;
    } else if ('src' in src) {
      try {
        src.onload = null;
        src.onerror = null;
      } catch {
        // Ignore read-only mock properties
      }
    }
    entry.width = 0;
    entry.height = 0;
  }

  public clear(): void {
    this.loadGeneration++;
    for (const entry of this.cache.values()) {
      this.releaseEntryMemory(entry);
    }
    this.cache.clear();
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxCacheSize) return;
    const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const excess = this.cache.size - Math.floor(this.maxCacheSize * 0.8);
    for (let i = 0; i < excess && i < entries.length; i++) {
      this.releaseEntryMemory(entries[i][1]);
      this.cache.delete(entries[i][0]);
    }
  }

  private buildRadarTileCanvas(
    img: HTMLImageElement,
    z: number,
    ty: number
  ): HTMLCanvasElement | HTMLImageElement {
    if (this.renderMode !== 'radar-terrarium' || typeof document === 'undefined') {
      return img;
    }
    const w = img.naturalWidth || 256;
    const h = img.naturalHeight || 256;
    if (w <= 0 || h <= 0) return img;
    try {
      const cvs = document.createElement('canvas');
      cvs.width = w;
      cvs.height = h;
      const c = cvs.getContext('2d');
      if (!c) return img;
      c.drawImage(img, 0, 0, w, h);
      const srcData = c.getImageData(0, 0, w, h);
      const dstData = c.createImageData(w, h);
      const centerLatDeg = (tileYToLatDeg(ty, z) + tileYToLatDeg(ty + 1, z)) * 0.5;
      shadeTerrariumTileRgba(srcData.data, dstData.data, w, h, z, centerLatDeg);
      c.putImageData(dstData, 0, 0);
      return cvs;
    } catch {
      return img;
    }
  }

  private drawParentFallback(ctx: CanvasRenderingContext2D, tile: VisibleWorldTile): boolean {
    for (let pz = tile.z - 1; pz >= MIN_WORLD_TILE_ZOOM; pz--) {
      const shift = tile.z - pz;
      const ptx = tile.tx >> shift;
      const pty = tile.ty >> shift;
      const parent = this.cache.get(`${pz}/${ptx}/${pty}`);
      if (parent && parent.status === 'loaded' && parent.width > 0 && parent.height > 0) {
        parent.lastUsed = ++this.accessTick;
        const scaleDiv = 1 << shift;
        const subX = tile.tx - (ptx << shift);
        const subY = tile.ty - (pty << shift);
        const sw = parent.width / scaleDiv;
        const sh = parent.height / scaleDiv;
        ctx.drawImage(
          parent.source,
          subX * sw,
          subY * sh,
          sw,
          sh,
          tile.dx,
          tile.dy,
          tile.dw + 0.75,
          tile.dh + 0.75
        );
        return true;
      }
    }
    return false;
  }

  public draw(
    ctx: CanvasRenderingContext2D,
    viewport: RadarViewport,
    onTileLoaded?: () => void
  ): number {
    if (typeof Image === 'undefined') return 0;
    const tiles = computeVisibleWorldTiles(viewport, {
      latDeg: this.originLatDeg,
      lonDeg: this.originLonDeg,
    });
    if (tiles.length === 0) return 0;

    const canFetchExternal = this.isExternalTilesAllowed();
    const nowMs = Date.now();
    let drawnCount = 0;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = this.opacity;

    const triggerNotify = () => {
      if (!onTileLoaded || this.pendingNotify) return;
      this.pendingNotify = true;
      const flush = () => {
        this.pendingNotify = false;
        onTileLoaded();
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(flush);
      } else {
        setTimeout(flush, 16);
      }
    };

    for (const tile of tiles) {
      let entry = this.cache.get(tile.key);
      const canRetryError =
        entry?.status === 'error' &&
        typeof entry.errorTimestampMs === 'number' &&
        nowMs - entry.errorTimestampMs >= TILE_ERROR_RETRY_COOLDOWN_MS;

      if ((!entry || canRetryError) && canFetchExternal) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        entry = { status: 'loading', source: img, width: 0, height: 0, lastUsed: ++this.accessTick };
        this.cache.set(tile.key, entry);
        this.evictIfNeeded();
        const capturedEntry = entry;
        const capturedZ = tile.z;
        const capturedTy = tile.ty;
        const capturedKey = tile.key;
        const capturedGeneration = this.loadGeneration;
        img.onload = () => {
          if (
            capturedGeneration !== this.loadGeneration ||
            this.cache.get(capturedKey) !== capturedEntry
          ) {
            img.onload = null;
            img.onerror = null;
            return;
          }
          const rendered = this.buildRadarTileCanvas(img, capturedZ, capturedTy);
          if (
            capturedGeneration !== this.loadGeneration ||
            this.cache.get(capturedKey) !== capturedEntry
          ) {
            if (rendered !== img && 'width' in rendered) {
              (rendered as HTMLCanvasElement).width = 0;
              (rendered as HTMLCanvasElement).height = 0;
            }
            return;
          }
          capturedEntry.source = rendered;
          capturedEntry.width = img.naturalWidth || 256;
          capturedEntry.height = img.naturalHeight || 256;
          capturedEntry.status = 'loaded';
          capturedEntry.errorTimestampMs = undefined;
          triggerNotify();
        };
        img.onerror = () => {
          if (
            capturedGeneration !== this.loadGeneration ||
            this.cache.get(capturedKey) !== capturedEntry
          ) {
            return;
          }
          capturedEntry.status = 'error';
          capturedEntry.errorTimestampMs = Date.now();
        };
        img.src = formatSlippyTileUrl(this.tileUrlTemplate, tile.z, tile.tx, tile.ty);
      } else if (entry) {
        entry.lastUsed = ++this.accessTick;
      }

      if (entry && entry.status === 'loaded' && entry.width > 0) {
        ctx.drawImage(entry.source, tile.dx, tile.dy, tile.dw + 0.75, tile.dh + 0.75);
        drawnCount++;
      } else if (this.drawParentFallback(ctx, tile)) {
        drawnCount++;
      }
    }

    ctx.restore();
    return drawnCount;
  }
}
