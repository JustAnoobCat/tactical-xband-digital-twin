/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Path Profile Plan-View (Top View) Viewport Model & Authentic DEM Renderers (Feature 6A & 6A.1)
 *
 * Provides genuine vertical down-looking (plan-view) interactive visualizations
 * with authentic DEM-derived terrain rendering for BOTH:
 *  1. Terrain Path Profile: Actual Ladakh DEM valleys & ridges, hypsometric relief
 *     shading, summit crests, ridge occlusions, obstacle footprints, distance, and direction.
 *  2. RF Path Profile: The SAME underlying authentic DEM terrain with 1st Fresnel zone
 *     translucent ground swath, unified RF link status styling, terrain blockage regions,
 *     obstacle-blocked intervals, and clear distinction between carrier link connectivity
 *     and active payload transmission.
 *
 * Viewport transformations, zoom, pan, and view-mode toggling are strictly isolated
 * from worker simulation state, queues, schedulers, and node selection.
 * Terrain raster output is cached to guarantee high responsiveness on modest hardware (Intel UHD 620).
 */

import type { LinkProfile, LinkProfileSample } from '../core/linkProfile';
import { obstacleFootprintPoints, type Obstacle } from '../core/obstacles';
import type { ViewportLayout } from './linkProfileViewport';
import { calcNiceStep } from './linkProfileViewport';
import type { LinkCommunicationStatus, LinkStatusClassification } from '../core/linkStatusClassifier';
import { getMapLinkStyle } from './mapLinkStyles';
import {
  REAL_LADAKH_DEM_METADATA,
  type TerrainBoundsTelemetry,
  type DemGeographicMetadata,
} from '../core/terrain';

export interface TopViewBounds {
  readonly minXM: number;
  readonly maxXM: number;
  readonly minYM: number;
  readonly maxYM: number;
}

export const TOP_VIEW_LIMITS = {
  MIN_SPAN_M: 500.0,         // 500 metres min span (max zoom-in)
  MAX_SPAN_M: 400000.0,      // 400 km max span (max zoom-out)
  DOMAIN_MIN_M: -250000.0,   // 250 km bounds clamp
  DOMAIN_MAX_M: 250000.0,
  MARGIN_FRACTION: 0.22,     // 22% margin around link endpoints on fit for geographic context
  MIN_MARGIN_M: 3000.0,      // 3 km minimum margin
} as const;

export interface TopViewTerrainSource {
  readonly canvas?: HTMLCanvasElement | null;
  readonly bounds?: TerrainBoundsTelemetry | null;
  readonly demGrid?: Float32Array | null;
}

export interface TopViewRenderOptions {
  readonly hillshadeCanvas?: HTMLCanvasElement | null;
  readonly activeTerrainBounds?: TerrainBoundsTelemetry | null;
  readonly terrainSource?: TopViewTerrainSource | null;
  readonly acnTelemetry?: {
    readonly heading_deg?: number;
    readonly velocity?: readonly [number, number];
    readonly vel_x?: number;
    readonly vel_y?: number;
    readonly position_m?: readonly [number, number, number];
    readonly altitude_m?: number;
    readonly flight_path?: readonly [number, number][];
    readonly waypoints?: readonly any[];
  } | null;
  readonly selectedNode?: {
    readonly node_id?: number;
    readonly name?: string;
    readonly node_type?: string;
    readonly x_m?: number;
    readonly y_m?: number;
    readonly terrain_elevation_msl_m?: number;
    readonly agl_m?: number;
  } | null;
  readonly allNodes?: readonly any[];
  readonly obstacles?: readonly any[];
  readonly showElevationLegend?: boolean;
  readonly waypoints?: readonly any[];
  readonly trajectoryMode?: string;
}

export interface DemHillshadeRaster {
  readonly width: number;
  readonly height: number;
  readonly bounds: TerrainBoundsTelemetry;
  readonly packedRgbGrid: readonly (readonly number[])[];
  readonly rgbaBuffer: Uint8ClampedArray;
  readonly canvas?: HTMLCanvasElement | null;
}

export const KNOWN_LADAKH_SUMMITS: readonly { name: string; elevM: number; xM: number; yM: number }[] = [
  { name: 'MT. KARGIL-I', elevM: 4150, xM: 5000, yM: 270 },
  { name: 'ZANSKAR-NW', elevM: 5640, xM: -9000, yM: 12000 },
  { name: 'NUN-KUN', elevM: 5820, xM: 14000, yM: 15000 },
  { name: 'SURU CRAG', elevM: 5120, xM: 12000, yM: -9000 },
  { name: 'DRAS PASS', elevM: 4790, xM: -14000, yM: -8000 },
];

/**
 * Generates an authentic hillshade and elevation raster from DEM samples.
 * Uses exact Lambertian reflectance (azimuth 315° NW, altitude 45°) and
 * authentic Ladakh tactical hypsometric color grading (2800m - 5800m MSL).
 * Preserves transparency for out-of-coverage (NaN) samples.
 */
export function generateDemHillshadeRaster(
  elevGrid: Float32Array,
  width: number = 512,
  height: number = 512,
  metadata: DemGeographicMetadata = REAL_LADAKH_DEM_METADATA
): DemHillshadeRaster {
  const stepX = (metadata.halfWidthM * 2.0) / (width - 1);
  const stepY = (metadata.halfHeightM * 2.0) / (height - 1);

  // Northwest Sun Illumination: Azimuth 315°, Altitude 45°
  const lx = -0.5;
  const ly = 0.5;
  const lz = 0.7071;

  const rgbaBuffer = new Uint8ClampedArray(width * height * 4);
  const grid: number[][] = [];

  for (let r = 0; r < height; r++) {
    const rowPack: number[] = [];
    const rPrev = Math.max(0, r - 1);
    const rNext = Math.min(height - 1, r + 1);

    for (let c = 0; c < width; c++) {
      const cPrev = Math.max(0, c - 1);
      const cNext = Math.min(width - 1, c + 1);
      const pixelIdx = (r * width + c) * 4;

      const z = elevGrid[r * width + c];

      // Explicit invalid / out-of-coverage handling: if elevation is NaN or non-finite, emit transparent pixel
      if (!Number.isFinite(z)) {
        rowPack.push(0);
        rgbaBuffer[pixelIdx] = 0;
        rgbaBuffer[pixelIdx + 1] = 0;
        rgbaBuffer[pixelIdx + 2] = 0;
        rgbaBuffer[pixelIdx + 3] = 0;
        continue;
      }

      // Compute x-gradient with finite difference
      let dzdx = 0.0;
      const zCNext = elevGrid[r * width + cNext];
      const zCPrev = elevGrid[r * width + cPrev];
      if (Number.isFinite(zCNext) && Number.isFinite(zCPrev) && cNext !== cPrev) {
        dzdx = (zCNext - zCPrev) / ((cNext - cPrev) * stepX);
      } else if (Number.isFinite(zCNext) && cNext !== c) {
        dzdx = (zCNext - z) / ((cNext - c) * stepX);
      } else if (Number.isFinite(zCPrev) && c !== cPrev) {
        dzdx = (z - zCPrev) / ((c - cPrev) * stepX);
      }

      // Compute y-gradient with finite difference (Row 0 is North +Y)
      let dzdy = 0.0;
      const zRPrev = elevGrid[rPrev * width + c];
      const zRNext = elevGrid[rNext * width + c];
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

      // Dark-mode tactical military color grading based on altitude (2800m - 5800m)
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

      rgbaBuffer[pixelIdx] = red;
      rgbaBuffer[pixelIdx + 1] = green;
      rgbaBuffer[pixelIdx + 2] = blue;
      rgbaBuffer[pixelIdx + 3] = 255; // Fully opaque for valid terrain
    }
    grid.push(rowPack);
  }

  let canvas: HTMLCanvasElement | null = null;
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    try {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.createImageData(width, height);
        imgData.data.set(rgbaBuffer);
        ctx.putImageData(imgData, 0, 0);
      }
    } catch {
      // In testing environments without full ImageData canvas support
    }
  }

  const bounds: TerrainBoundsTelemetry = {
    minX: -metadata.halfWidthM,
    maxX: metadata.halfWidthM,
    minY: -metadata.halfHeightM,
    maxY: metadata.halfHeightM,
    rasterWidth: width,
    rasterHeight: height,
    groundResolutionXM: stepX,
    groundResolutionYM: stepY,
    isValidCoverage: true,
    halfWidthM: metadata.halfWidthM,
    halfHeightM: metadata.halfHeightM,
    terrainMode: 'real',
  };

  return {
    width,
    height,
    bounds,
    packedRgbGrid: grid,
    rgbaBuffer,
    canvas,
  };
}

/**
 * Singleton cache for DEM hillshade rasters and offscreen canvases.
 * Prevents redundant rasterization across frames, view-mode switches, and zoom/pan actions.
 */
export class TopViewTerrainCache {
  private static cachedRaster: DemHillshadeRaster | null = null;
  private static cachedDemRef: Float32Array | null = null;
  private static cachedCanvas: HTMLCanvasElement | null = null;
  private static generationCount: number = 0;

  public static getGenerationCount(): number {
    return this.generationCount;
  }

  public static clear(): void {
    this.cachedRaster = null;
    this.cachedDemRef = null;
    this.cachedCanvas = null;
    this.generationCount = 0;
  }

  public static setCanvas(canvas: HTMLCanvasElement | null): void {
    this.cachedCanvas = canvas;
  }

  public static getOrCreateRaster(demGrid: Float32Array): DemHillshadeRaster {
    if (this.cachedRaster && this.cachedDemRef === demGrid) {
      return this.cachedRaster;
    }
    this.cachedDemRef = demGrid;
    this.cachedRaster = generateDemHillshadeRaster(demGrid);
    this.cachedCanvas = this.cachedRaster.canvas ?? null;
    this.generationCount++;
    return this.cachedRaster;
  }

  public static getActiveCanvas(options?: TopViewRenderOptions): HTMLCanvasElement | null {
    if (options?.hillshadeCanvas) {
      this.cachedCanvas = options.hillshadeCanvas;
      return options.hillshadeCanvas;
    }
    if (options?.terrainSource?.canvas) {
      this.cachedCanvas = options.terrainSource.canvas;
      return options.terrainSource.canvas;
    }
    if (this.cachedCanvas) {
      return this.cachedCanvas;
    }
    if (options?.terrainSource?.demGrid) {
      return this.getOrCreateRaster(options.terrainSource.demGrid).canvas ?? null;
    }
    return null;
  }
}

/**
 * Synchronizes canvas backing pixel dimensions to its CSS display dimensions and DPR.
 * Uses idempotent setTransform(dpr, 0, 0, dpr, 0, 0) to prevent transform accumulation.
 * Safely handles zero-sized or temporarily hidden containers.
 */
export function syncCanvasDpr(
  canvas: HTMLCanvasElement,
  ctx?: CanvasRenderingContext2D | null,
  options?: {
    dpr?: number;
    cssWidth?: number;
    cssHeight?: number;
  }
): {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  backingWidth: number;
  backingHeight: number;
  isVisible: boolean;
} {
  const dpr = options?.dpr ?? (typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1);
  const container = canvas.parentElement;
  const rect = container
    ? container.getBoundingClientRect()
    : (typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : { width: 0, height: 0 });
  const cssWidth = options?.cssWidth ?? (container && container.clientWidth > 0 ? container.clientWidth : (canvas.clientWidth > 0 ? canvas.clientWidth : rect.width));
  const cssHeight = options?.cssHeight ?? (container && container.clientHeight > 0 ? container.clientHeight : (canvas.clientHeight > 0 ? canvas.clientHeight : rect.height));

  if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth <= 0 || cssHeight <= 0) {
    return {
      cssWidth: 0,
      cssHeight: 0,
      dpr,
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      isVisible: false,
    };
  }

  const targetW = Math.max(1, Math.round(cssWidth * dpr));
  const targetH = Math.max(1, Math.round(cssHeight * dpr));

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const context = ctx ?? canvas.getContext('2d');
  if (context && typeof context.setTransform === 'function') {
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  return {
    cssWidth,
    cssHeight,
    dpr,
    backingWidth: targetW,
    backingHeight: targetH,
    isVisible: true,
  };
}

/**
 * 2D Plan-View (Top View) Viewport State.
 * Pure TypeScript with no direct DOM dependencies; provides 100% headless testability.
 */
export class TopViewViewportState {
  private minXM: number = -30000;
  private maxXM: number = 30000;
  private minYM: number = -30000;
  private maxYM: number = 30000;

  private fitMinXM: number = -30000;
  private fitMaxXM: number = 30000;
  private fitMinYM: number = -30000;
  private fitMaxYM: number = 30000;

  private userModified: boolean = false;
  private lastSelectedNodeId: number | null = null;
  private lastAcnPos: [number, number] | null = null;

  constructor() {
    this.resetToDefaults();
  }

  public resetToDefaults(): void {
    this.minXM = -30000;
    this.maxXM = 30000;
    this.minYM = -30000;
    this.maxYM = 30000;
    this.fitMinXM = -30000;
    this.fitMaxXM = 30000;
    this.fitMinYM = -30000;
    this.fitMaxYM = 30000;
    this.userModified = false;
    this.lastSelectedNodeId = null;
    this.lastAcnPos = null;
  }

  public get bounds(): TopViewBounds {
    return {
      minXM: this.minXM,
      maxXM: this.maxXM,
      minYM: this.minYM,
      maxYM: this.maxYM,
    };
  }

  public get fitBounds(): TopViewBounds {
    return {
      minXM: this.fitMinXM,
      maxXM: this.fitMaxXM,
      minYM: this.fitMinYM,
      maxYM: this.fitMaxYM,
    };
  }

  public get isUserModified(): boolean {
    return this.userModified;
  }

  public get zoomFactor(): number {
    const fitSpanX = Math.max(1, this.fitMaxXM - this.fitMinXM);
    const currSpanX = Math.max(1, this.maxXM - this.minXM);
    return Math.round((fitSpanX / currSpanX) * 10) / 10;
  }

  /**
   * Synchronizes viewport bounds to the active link endpoints.
   * Preserves 1:1 aspect ratio to avoid spatial distortion.
   */
  public syncLink(
    nodePos: readonly [number, number, number] | null,
    acnPos: readonly [number, number, number] | null,
    options?: { forceReset?: boolean; selectedNodeId?: number; layout?: ViewportLayout }
  ): boolean {
    if (!nodePos || !acnPos || !Number.isFinite(nodePos[0]) || !Number.isFinite(acnPos[0])) {
      return false;
    }

    const nodeId = options?.selectedNodeId ?? null;
    const nodeChanged = this.lastSelectedNodeId !== null && nodeId !== null && this.lastSelectedNodeId !== nodeId;
    this.lastSelectedNodeId = nodeId;

    const x0 = nodePos[0], y0 = nodePos[1];
    const x1 = acnPos[0], y1 = acnPos[1];

    let rawMinX = Math.min(x0, x1);
    let rawMaxX = Math.max(x0, x1);
    let rawMinY = Math.min(y0, y1);
    let rawMaxY = Math.max(y0, y1);

    const spanX = Math.max(TOP_VIEW_LIMITS.MIN_SPAN_M, rawMaxX - rawMinX);
    const spanY = Math.max(TOP_VIEW_LIMITS.MIN_SPAN_M, rawMaxY - rawMinY);

    const marginX = Math.max(TOP_VIEW_LIMITS.MIN_MARGIN_M, spanX * TOP_VIEW_LIMITS.MARGIN_FRACTION);
    const marginY = Math.max(TOP_VIEW_LIMITS.MIN_MARGIN_M, spanY * TOP_VIEW_LIMITS.MARGIN_FRACTION);

    let fitMinX = rawMinX - marginX;
    let fitMaxX = rawMaxX + marginX;
    let fitMinY = rawMinY - marginY;
    let fitMaxY = rawMaxY + marginY;

    // Aspect ratio adjustment to match layout if available
    const layout = options?.layout;
    if (layout && layout.width > 0 && layout.height > 0) {
      const plotW = Math.max(1, layout.width - layout.padL - layout.padR);
      const plotH = Math.max(1, layout.height - layout.padT - layout.padB);
      const aspectLayout = plotW / plotH;

      const currentSpanX = fitMaxX - fitMinX;
      const currentSpanY = fitMaxY - fitMinY;
      const aspectSpan = currentSpanX / currentSpanY;

      if (aspectSpan < aspectLayout) {
        // Expand X to match layout aspect
        const targetSpanX = currentSpanY * aspectLayout;
        const midX = (fitMinX + fitMaxX) / 2;
        fitMinX = midX - targetSpanX / 2;
        fitMaxX = midX + targetSpanX / 2;
      } else {
        // Expand Y to match layout aspect
        const targetSpanY = currentSpanX / aspectLayout;
        const midY = (fitMinY + fitMaxY) / 2;
        fitMinY = midY - targetSpanY / 2;
        fitMaxY = midY + targetSpanY / 2;
      }
    }

    this.fitMinXM = fitMinX;
    this.fitMaxXM = fitMaxX;
    this.fitMinYM = fitMinY;
    this.fitMaxYM = fitMaxY;

    if (options?.forceReset || nodeChanged || !this.userModified) {
      this.resetFit();
      return true;
    }

    return false;
  }

  public resetFit(): void {
    this.minXM = this.fitMinXM;
    this.maxXM = this.fitMaxXM;
    this.minYM = this.fitMinYM;
    this.maxYM = this.fitMaxYM;
    this.userModified = false;
  }

  public zoom(factor: number, centerFractionX = 0.5, centerFractionY = 0.5): void {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;

    const currentSpanX = this.maxXM - this.minXM;
    const currentSpanY = this.maxYM - this.minYM;

    let targetSpanX = currentSpanX / factor;
    let targetSpanY = currentSpanY / factor;

    targetSpanX = Math.max(TOP_VIEW_LIMITS.MIN_SPAN_M, Math.min(TOP_VIEW_LIMITS.MAX_SPAN_M, targetSpanX));
    targetSpanY = Math.max(TOP_VIEW_LIMITS.MIN_SPAN_M, Math.min(TOP_VIEW_LIMITS.MAX_SPAN_M, targetSpanY));

    const fracX = Math.max(0, Math.min(1, centerFractionX));
    const fracY = Math.max(0, Math.min(1, centerFractionY));

    const focusX = this.minXM + fracX * currentSpanX;
    const focusY = this.minYM + fracY * currentSpanY;

    let nextMinX = focusX - fracX * targetSpanX;
    let nextMaxX = nextMinX + targetSpanX;
    let nextMinY = focusY - fracY * targetSpanY;
    let nextMaxY = nextMinY + targetSpanY;

    if (nextMinX < TOP_VIEW_LIMITS.DOMAIN_MIN_M) {
      nextMinX = TOP_VIEW_LIMITS.DOMAIN_MIN_M;
      nextMaxX = nextMinX + targetSpanX;
    } else if (nextMaxX > TOP_VIEW_LIMITS.DOMAIN_MAX_M) {
      nextMaxX = TOP_VIEW_LIMITS.DOMAIN_MAX_M;
      nextMinX = nextMaxX - targetSpanX;
    }

    if (nextMinY < TOP_VIEW_LIMITS.DOMAIN_MIN_M) {
      nextMinY = TOP_VIEW_LIMITS.DOMAIN_MIN_M;
      nextMaxY = nextMinY + targetSpanY;
    } else if (nextMaxY > TOP_VIEW_LIMITS.DOMAIN_MAX_M) {
      nextMaxY = TOP_VIEW_LIMITS.DOMAIN_MAX_M;
      nextMinY = nextMaxY - targetSpanY;
    }

    this.minXM = nextMinX;
    this.maxXM = nextMaxX;
    this.minYM = nextMinY;
    this.maxYM = nextMaxY;
    this.userModified = true;
  }

  public zoomAt(factor: number, canvasX: number, canvasY: number, layout: ViewportLayout): void {
    const plotW = Math.max(1, layout.width - layout.padL - layout.padR);
    const plotH = Math.max(1, layout.height - layout.padT - layout.padB);
    const fracX = (canvasX - layout.padL) / plotW;
    const fracY = (layout.padT + plotH - canvasY) / plotH;
    this.zoom(factor, fracX, fracY);
  }

  public pan(deltaPxX: number, deltaPxY: number, layout: ViewportLayout): void {
    if (!Number.isFinite(deltaPxX) || !Number.isFinite(deltaPxY)) return;
    if (deltaPxX === 0 && deltaPxY === 0) return;

    const plotW = Math.max(1, layout.width - layout.padL - layout.padR);
    const plotH = Math.max(1, layout.height - layout.padT - layout.padB);

    const spanX = this.maxXM - this.minXM;
    const spanY = this.maxYM - this.minYM;

    const deltaX = -(deltaPxX / plotW) * spanX;
    const deltaY = (deltaPxY / plotH) * spanY;

    let nextMinX = this.minXM + deltaX;
    let nextMaxX = this.maxXM + deltaX;
    let nextMinY = this.minYM + deltaY;
    let nextMaxY = this.maxYM + deltaY;

    if (nextMinX < TOP_VIEW_LIMITS.DOMAIN_MIN_M) {
      nextMinX = TOP_VIEW_LIMITS.DOMAIN_MIN_M;
      nextMaxX = nextMinX + spanX;
    } else if (nextMaxX > TOP_VIEW_LIMITS.DOMAIN_MAX_M) {
      nextMaxX = TOP_VIEW_LIMITS.DOMAIN_MAX_M;
      nextMinX = nextMaxX - spanX;
    }

    if (nextMinY < TOP_VIEW_LIMITS.DOMAIN_MIN_M) {
      nextMinY = TOP_VIEW_LIMITS.DOMAIN_MIN_M;
      nextMaxY = nextMinY + spanY;
    } else if (nextMaxY > TOP_VIEW_LIMITS.DOMAIN_MAX_M) {
      nextMaxY = TOP_VIEW_LIMITS.DOMAIN_MAX_M;
      nextMinY = nextMaxY - spanY;
    }

    this.minXM = nextMinX;
    this.maxXM = nextMaxX;
    this.minYM = nextMinY;
    this.maxYM = nextMaxY;
    this.userModified = true;
  }

  // --- Coordinate Transformations (Plan-View Orthographic) ---

  public xToCanvas(xM: number, layout: ViewportLayout): number {
    const plotW = Math.max(1, layout.width - layout.padL - layout.padR);
    const spanX = Math.max(1e-6, this.maxXM - this.minXM);
    return layout.padL + ((xM - this.minXM) / spanX) * plotW;
  }

  public yToCanvas(yM: number, layout: ViewportLayout): number {
    const plotH = Math.max(1, layout.height - layout.padT - layout.padB);
    const spanY = Math.max(1e-6, this.maxYM - this.minYM);
    // Y is North (+Y upward on canvas)
    return layout.padT + plotH - ((yM - this.minYM) / spanY) * plotH;
  }

  public canvasToX(px: number, layout: ViewportLayout): number {
    const plotW = Math.max(1, layout.width - layout.padL - layout.padR);
    const spanX = Math.max(1e-6, this.maxXM - this.minXM);
    return this.minXM + ((px - layout.padL) / plotW) * spanX;
  }

  public canvasToY(py: number, layout: ViewportLayout): number {
    const plotH = Math.max(1, layout.height - layout.padT - layout.padB);
    const spanY = Math.max(1e-6, this.maxYM - this.minYM);
    return this.minYM + ((layout.padT + plotH - py) / plotH) * spanY;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-VIEW DEM TERRAIN & TACTICAL GRAPHICS
// ─────────────────────────────────────────────────────────────────────────────

function drawDemTerrain(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: TopViewViewportState,
  options?: TopViewRenderOptions
): void {
  const terrainCanvas = TopViewTerrainCache.getActiveCanvas(options);
  if (!terrainCanvas) return;

  const bounds = options?.activeTerrainBounds ?? options?.terrainSource?.bounds;
  const minX = bounds && Number.isFinite(bounds.minX)
    ? bounds.minX
    : (bounds && Number.isFinite(bounds.halfWidthM) ? -bounds.halfWidthM : -REAL_LADAKH_DEM_METADATA.halfWidthM);
  const maxX = bounds && Number.isFinite(bounds.maxX)
    ? bounds.maxX
    : (bounds && Number.isFinite(bounds.halfWidthM) ? bounds.halfWidthM : REAL_LADAKH_DEM_METADATA.halfWidthM);
  const minY = bounds && Number.isFinite(bounds.minY)
    ? bounds.minY
    : (bounds && Number.isFinite(bounds.halfHeightM) ? -bounds.halfHeightM : -REAL_LADAKH_DEM_METADATA.halfHeightM);
  const maxY = bounds && Number.isFinite(bounds.maxY)
    ? bounds.maxY
    : (bounds && Number.isFinite(bounds.halfHeightM) ? bounds.halfHeightM : REAL_LADAKH_DEM_METADATA.halfHeightM);

  const destX = viewport.xToCanvas(minX, layout);
  const destY = viewport.yToCanvas(maxY, layout);
  const destW = viewport.xToCanvas(maxX, layout) - destX;
  const destH = viewport.yToCanvas(minY, layout) - destY;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) {
    (ctx as any).imageSmoothingQuality = 'high';
  }

  ctx.drawImage(terrainCanvas as CanvasImageSource, destX, destY, destW, destH);

  // Subtle Satellite DEM Coverage Boundary & Corner reticles
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.40)';
  ctx.lineWidth = 1.0;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(destX, destY, destW, destH);
  ctx.setLineDash([]);

  const bracketLen = Math.min(18, Math.max(6, Math.min(destW, destH) * 0.04));
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.6;

  // TL
  ctx.beginPath();
  ctx.moveTo(destX, destY + bracketLen);
  ctx.lineTo(destX, destY);
  ctx.lineTo(destX + bracketLen, destY);
  ctx.stroke();

  // TR
  ctx.beginPath();
  ctx.moveTo(destX + destW - bracketLen, destY);
  ctx.lineTo(destX + destW, destY);
  ctx.lineTo(destX + destW, destY + bracketLen);
  ctx.stroke();

  // BL
  ctx.beginPath();
  ctx.moveTo(destX, destY + destH - bracketLen);
  ctx.lineTo(destX, destY + destH);
  ctx.lineTo(destX + bracketLen, destY + destH);
  ctx.stroke();

  // BR
  ctx.beginPath();
  ctx.moveTo(destX + destW - bracketLen, destY + destH);
  ctx.lineTo(destX + destW, destY + destH);
  ctx.lineTo(destX + destW, destY + destH - bracketLen);
  ctx.stroke();

  ctx.restore();
}

function drawKnownSummits(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: TopViewViewportState
): void {
  const bounds = viewport.bounds;
  ctx.save();
  for (const summit of KNOWN_LADAKH_SUMMITS) {
    if (
      summit.xM >= bounds.minXM &&
      summit.xM <= bounds.maxXM &&
      summit.yM >= bounds.minYM &&
      summit.yM <= bounds.maxYM
    ) {
      const sx = viewport.xToCanvas(summit.xM, layout);
      const sy = viewport.yToCanvas(summit.yM, layout);

      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 6);
      ctx.lineTo(sx - 4, sy + 3);
      ctx.lineTo(sx + 4, sy + 3);
      ctx.closePath();
      ctx.fill();

      ctx.font = '600 8px ui-monospace, monospace';
      ctx.fillStyle = '#fde68a';
      ctx.textAlign = 'center';
      ctx.fillText(`▲ ${summit.elevM}m ${summit.name}`, sx, sy - 8);
    }
  }
  ctx.restore();
}

export function renderElevationLegend(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout
): void {
  const { padL, height: h, padB } = layout;
  const legX = padL + 12;
  const legY = h - padB - 26;
  const legW = 96;
  const legH = 7;

  ctx.save();
  ctx.fillStyle = 'rgba(10, 16, 24, 0.78)';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if ('roundRect' in ctx && typeof ctx.roundRect === 'function') {
    ctx.roundRect(legX - 6, legY - 13, legW + 12, legH + 22, 4);
  } else {
    ctx.rect(legX - 6, legY - 13, legW + 12, legH + 22);
  }
  ctx.fill();
  ctx.stroke();

  // Title
  ctx.font = '600 7.5px ui-monospace, monospace';
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'left';
  ctx.fillText('ELEVATION MSL (m)', legX, legY - 3);

  // Gradient Bar
  const grad = ctx.createLinearGradient(legX, 0, legX + legW, 0);
  grad.addColorStop(0, '#0e131c');    // 2800m
  grad.addColorStop(0.33, '#1c2738'); // 3800m
  grad.addColorStop(0.66, '#384860'); // 4800m
  grad.addColorStop(1.0, '#6682a8');  // 5800m
  ctx.fillStyle = grad;
  ctx.fillRect(legX, legY, legW, legH);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.strokeRect(legX, legY, legW, legH);

  // Min / Max labels
  ctx.font = '7px ui-monospace, monospace';
  ctx.fillStyle = '#cbd5e1';
  ctx.textAlign = 'left';
  ctx.fillText('2.8k', legX, legY + legH + 7);
  ctx.textAlign = 'right';
  ctx.fillText('5.8k m', legX + legW, legY + legH + 7);

  ctx.restore();
}

export function drawAircraftChevron(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  headingDeg: number,
  size = 11
): void {
  ctx.save();
  ctx.translate(cx, cy);

  // A small registration mark keeps the aircraft identifiable without creating
  // a second map feature that competes with the route.
  ctx.beginPath();
  ctx.arc(0, 0, size + 5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(126, 211, 224, 0.55)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Heading 0 is North (up, -Y in canvas). Canvas 0 rad points right (+X).
  const rad = ((headingDeg - 90) * Math.PI) / 180;
  ctx.rotate(rad);

  // Short heading vector, intentionally separate from the route.
  const noseX = size * 0.9;
  const tipX = noseX + 13;
  ctx.beginPath();
  ctx.moveTo(noseX, 0);
  ctx.lineTo(tipX, 0);
  ctx.strokeStyle = 'rgba(8, 15, 23, 0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(noseX, 0);
  ctx.lineTo(tipX, 0);
  ctx.strokeStyle = '#7ed3e0';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tipX - 4, -3);
  ctx.lineTo(tipX, 0);
  ctx.lineTo(tipX - 4, 3);
  ctx.strokeStyle = '#7ed3e0';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const drawDelta = (scale = 1.0) => {
    const s = size * scale;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.72, -s * 0.62);
    ctx.lineTo(-s * 0.36, -s * 0.16);
    ctx.lineTo(-s * 0.62, 0);
    ctx.lineTo(-s * 0.36, s * 0.16);
    ctx.lineTo(-s * 0.72, s * 0.62);
    ctx.closePath();
  };

  drawDelta(1.08);
  ctx.strokeStyle = 'rgba(7, 13, 20, 0.95)';
  ctx.lineWidth = 3;
  ctx.stroke();
  drawDelta(1.0);
  ctx.fillStyle = '#b9edf2';
  ctx.fill();
  ctx.strokeStyle = '#15333d';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(size * 0.15, 0, 1.2, 0, Math.PI * 2);
  ctx.fillStyle = '#163d49';
  ctx.fill();

  ctx.restore();
}

function drawTerminalDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  isMcp: boolean,
  size = 6.5
): void {
  ctx.save();
  ctx.fillStyle = isMcp ? '#38bdf8' : '#4fd1a1';
  ctx.strokeStyle = '#0b1015';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  if (isMcp) {
    ctx.rect(cx - size, cy - size, size * 2, size * 2);
  } else {
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size, cy);
    ctx.lineTo(cx, cy + size);
    ctx.lineTo(cx - size, cy);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();

  // Center pip
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawPlanViewGrid(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: TopViewViewportState
): void {
  const { width: w, height: h, padL, padR, padT, padB } = layout;
  const plotW = Math.max(1, w - padL - padR);
  const plotH = Math.max(1, h - padT - padB);

  const bounds = viewport.bounds;
  const spanX = bounds.maxXM - bounds.minXM;
  const spanY = bounds.maxYM - bounds.minYM;

  const stepX = calcNiceStep(spanX / 1000, 5) * 1000;
  const stepY = calcNiceStep(spanY / 1000, 4) * 1000;

  ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace, monospace';

  // East-West vertical gridlines
  const startX = Math.ceil(bounds.minXM / stepX) * stepX;
  for (let x = startX; x <= bounds.maxXM + 1e-6; x += stepX) {
    const cx = Math.round(viewport.xToCanvas(x, layout)) + 0.5;
    if (cx >= padL && cx <= padL + plotW) {
      ctx.strokeStyle = 'rgba(120, 140, 160, 0.12)';
      ctx.beginPath();
      ctx.moveTo(cx, padT);
      ctx.lineTo(cx, padT + plotH);
      ctx.stroke();

      ctx.fillStyle = '#7d8c99';
      ctx.textAlign = 'center';
      const km = x / 1000;
      ctx.fillText(`${km >= 0 ? '+' : ''}${km.toFixed(0)} km E`, cx, padT + plotH + 14);
    }
  }

  // North-South horizontal gridlines
  const startY = Math.ceil(bounds.minYM / stepY) * stepY;
  for (let y = startY; y <= bounds.maxYM + 1e-6; y += stepY) {
    const cy = Math.round(viewport.yToCanvas(y, layout)) + 0.5;
    if (cy >= padT && cy <= padT + plotH) {
      ctx.strokeStyle = 'rgba(120, 140, 160, 0.12)';
      ctx.beginPath();
      ctx.moveTo(padL, cy);
      ctx.lineTo(padL + plotW, cy);
      ctx.stroke();

      ctx.fillStyle = '#7d8c99';
      ctx.textAlign = 'right';
      const km = y / 1000;
      ctx.fillText(`${km >= 0 ? '+' : ''}${km.toFixed(0)} km N`, padL - 6, cy + 3);
    }
  }

  // Compass Rose in Top-Right
  const compX = padL + plotW - 28;
  const compY = padT + 28;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.arc(compX, compY, 14, 0, Math.PI * 2);
  ctx.stroke();

  // North arrow
  ctx.beginPath();
  ctx.moveTo(compX, compY - 12);
  ctx.lineTo(compX - 4, compY - 2);
  ctx.lineTo(compX + 4, compY - 2);
  ctx.closePath();
  ctx.fillStyle = '#38bdf8';
  ctx.fill();

  ctx.font = '600 8.5px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('N', compX, compY - 14);
}

function drawObstacleFootprints(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: TopViewViewportState,
  obstacles?: readonly any[],
  highlightedIds?: readonly (string | number)[]
): void {
  if (!obstacles || obstacles.length === 0) return;
  const highlightSet = new Set(highlightedIds ? highlightedIds.map(String) : []);

  for (const obs of obstacles) {
    if (!obs || typeof obs !== 'object' || !Number.isFinite(obs.xM) || !Number.isFinite(obs.yM)) continue;
    let vertices: [number, number][];
    try {
      vertices = obstacleFootprintPoints(obs as Obstacle, 32);
    } catch {
      continue;
    }
    if (vertices.length < 3) continue;

    const isHit = highlightSet.has(String(obs.id));
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < vertices.length; i++) {
      const px = viewport.xToCanvas(vertices[i][0], layout);
      const py = viewport.yToCanvas(vertices[i][1], layout);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = isHit ? 'rgba(239, 68, 68, 0.40)' : 'rgba(249, 115, 22, 0.32)';
    ctx.fill();
    ctx.strokeStyle = isHit ? '#ef4444' : '#f97316';
    ctx.lineWidth = isHit ? 2.0 : 1.4;
    ctx.stroke();

    const centerPx = viewport.xToCanvas(obs.xM, layout);
    const centerPy = viewport.yToCanvas(obs.yM, layout);
    ctx.font = '600 8.5px ui-monospace, monospace';
    ctx.fillStyle = isHit ? '#fca5a5' : '#fed7aa';
    ctx.textAlign = 'center';
    ctx.fillText(`${obs.id}`, centerPx, centerPy + 3);
    ctx.restore();
  }
}

export interface TacticalWaypointItem {
  readonly x: number;
  readonly y: number;
  readonly label?: string;
  readonly isSelected?: boolean;
}

export function drawTacticalTrajectory(
  ctx: CanvasRenderingContext2D,
  canvasPoints: readonly [number, number][],
  options?: {
    isClosed?: boolean;
    skipChevrons?: boolean;
    acnScreenPos?: { x: number; y: number };
  }
): void {
  if (!canvasPoints || canvasPoints.length < 3) return;

  const isClosed = options?.isClosed ?? true;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const buildPath = () => {
    ctx.beginPath();
    for (let i = 0; i < canvasPoints.length; i++) {
      if (i === 0) ctx.moveTo(canvasPoints[i][0], canvasPoints[i][1]);
      else ctx.lineTo(canvasPoints[i][0], canvasPoints[i][1]);
    }
    if (isClosed) {
      ctx.closePath();
    }
  };

  // A narrow dark keyline preserves contrast over both shaded and bright DEMs.
  buildPath();
  ctx.strokeStyle = 'rgba(7, 13, 20, 0.95)';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Muted aviation cyan reads as an instrument overlay rather than a glow.
  buildPath();
  ctx.strokeStyle = '#79c8d5';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Sparse, small directional ticks communicate travel direction without
  // turning the route into a repeated pattern.
  if (!options?.skipChevrons) {
    const N = canvasPoints.length;
    const segLengths: number[] = [];
    const cumDist: number[] = [0];
    let totalLen = 0;

    const numSegments = isClosed ? N : N - 1;
    for (let i = 0; i < numSegments; i++) {
      const nextIdx = (i + 1) % N;
      const dx = canvasPoints[nextIdx][0] - canvasPoints[i][0];
      const dy = canvasPoints[nextIdx][1] - canvasPoints[i][1];
      const dist = Math.hypot(dx, dy);
      segLengths.push(dist);
      totalLen += dist;
      cumDist.push(totalLen);
    }

    // Only render chevrons if the path has sufficient screen size
    if (totalLen >= 40) {
      const targetSpacing = 180;
      const count = Math.max(1, Math.min(8, Math.round(totalLen / targetSpacing)));
      const spacing = totalLen / count;
      const acnPos = options?.acnScreenPos;

      for (let k = 0; k < count; k++) {
        const targetD = (k + 0.5) * spacing;
        let segIdx = 0;
        while (segIdx < segLengths.length - 1 && cumDist[segIdx + 1] < targetD) {
          segIdx++;
        }
        const segLen = segLengths[segIdx];
        if (segLen < 1e-3) continue;

        const u = (targetD - cumDist[segIdx]) / segLen;
        const nextIdx = (segIdx + 1) % N;
        const p0 = canvasPoints[segIdx];
        const p1 = canvasPoints[nextIdx];

        const cx = p0[0] + u * (p1[0] - p0[0]);
        const cy = p0[1] + u * (p1[1] - p0[1]);

        // If too close to the aircraft marker, skip this chevron to prevent overlapping
        if (acnPos && Math.hypot(cx - acnPos.x, cy - acnPos.y) < 28) {
          continue;
        }

        // Tangent vector
        const tx = (p1[0] - p0[0]) / segLen;
        const ty = (p1[1] - p0[1]) / segLen;
        // Perpendicular normal vector
        const nx = -ty;
        const ny = tx;

        const arrowLen = 5.5;
        const arrowWing = 3.5;
        const tipX = cx + 1.5 * tx;
        const tipY = cy + 1.5 * ty;
        const leftX = tipX - arrowLen * tx + arrowWing * nx;
        const leftY = tipY - arrowLen * ty + arrowWing * ny;
        const rightX = tipX - arrowLen * tx - arrowWing * nx;
        const rightY = tipY - arrowLen * ty - arrowWing * ny;

        ctx.beginPath();
        ctx.moveTo(leftX, leftY);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(rightX, rightY);

        ctx.strokeStyle = 'rgba(7, 13, 20, 0.9)';
        ctx.lineWidth = 3.2;
        ctx.stroke();

        ctx.strokeStyle = '#b9edf2';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

export function drawDraftTrajectory(
  ctx: CanvasRenderingContext2D,
  canvasPoints: readonly [number, number][],
  isClosed: boolean = true
): void {
  if (!canvasPoints || canvasPoints.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const buildPath = () => {
    ctx.beginPath();
    for (let i = 0; i < canvasPoints.length; i++) {
      if (i === 0) ctx.moveTo(canvasPoints[i][0], canvasPoints[i][1]);
      else ctx.lineTo(canvasPoints[i][0], canvasPoints[i][1]);
    }
    if (isClosed && canvasPoints.length >= 3) {
      ctx.closePath();
    }
  };

  // Draft routes remain amber and dashed so unapplied edits are unambiguous.
  buildPath();
  ctx.strokeStyle = 'rgba(7, 13, 20, 0.85)';
  ctx.lineWidth = 5.0;
  ctx.setLineDash([]);
  ctx.stroke();

  buildPath();
  ctx.strokeStyle = '#e5ad58';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([6, 4]);
  ctx.stroke();

  ctx.restore();
}

export function drawTacticalWaypoints(
  ctx: CanvasRenderingContext2D,
  waypoints: readonly TacticalWaypointItem[]
): void {
  if (!waypoints || waypoints.length === 0) return;

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (!wp || !Number.isFinite(wp.x) || !Number.isFinite(wp.y)) continue;

    ctx.save();

    if (wp.isSelected) {
      ctx.beginPath();
      ctx.arc(wp.x, wp.y, 9.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#f0c674';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.arc(wp.x, wp.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(7, 13, 20, 0.92)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(wp.x, wp.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = wp.isSelected ? 'rgba(229, 173, 88, 0.3)' : 'rgba(30, 41, 59, 0.9)';
    ctx.fill();
    ctx.strokeStyle = wp.isSelected ? '#f0c674' : '#d39a4a';
    ctx.lineWidth = wp.isSelected ? 1.8 : 1.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(wp.x, wp.y, 1.3, 0, Math.PI * 2);
    ctx.fillStyle = '#f0c674';
    ctx.fill();

    const label = wp.label ?? `WP${i + 1}`;
    ctx.font = '600 8px ui-monospace, monospace';
    const tw = ctx.measureText(label).width;
    const bx = wp.x + 9;
    const by = wp.y - 7;

    ctx.fillStyle = 'rgba(7, 13, 20, 0.78)';
    ctx.fillRect(bx - 2, by - 7, tw + 5, 11);
    ctx.strokeStyle = wp.isSelected ? '#f0c674' : 'rgba(211, 154, 74, 0.5)';
    ctx.lineWidth = wp.isSelected ? 1 : 0.75;
    ctx.strokeRect(bx - 2, by - 8, tw + 5, 13);

    ctx.fillStyle = wp.isSelected ? '#fff7df' : '#e8c98f';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 1, by - 1.5);

    ctx.restore();
  }
}

function drawWaypoints(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: TopViewViewportState,
  waypoints: readonly any[]
): void {
  if (!waypoints || waypoints.length === 0) return;

  const items: TacticalWaypointItem[] = [];
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (!wp) continue;
    const x = typeof wp.xM === 'number' ? wp.xM : (typeof wp.x_m === 'number' ? wp.x_m : (Array.isArray(wp) ? wp[0] : NaN));
    const y = typeof wp.yM === 'number' ? wp.yM : (typeof wp.y_m === 'number' ? wp.y_m : (Array.isArray(wp) ? wp[1] : NaN));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    items.push({
      x: viewport.xToCanvas(x, layout),
      y: viewport.yToCanvas(y, layout),
      label: `WP${i + 1}`,
    });
  }

  drawTacticalWaypoints(ctx, items);
}

function drawFlightTrajectory(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: TopViewViewportState,
  flightPath?: readonly [number, number][],
  waypoints?: readonly any[],
  acnPos?: readonly [number, number]
): void {
  if (!flightPath || flightPath.length < 3) return;

  const canvasPoints: [number, number][] = [];
  for (let i = 0; i < flightPath.length; i++) {
    canvasPoints.push([
      viewport.xToCanvas(flightPath[i][0], layout),
      viewport.yToCanvas(flightPath[i][1], layout),
    ]);
  }

  const acnScreenPos = acnPos
    ? { x: viewport.xToCanvas(acnPos[0], layout), y: viewport.yToCanvas(acnPos[1], layout) }
    : undefined;

  drawTacticalTrajectory(ctx, canvasPoints, {
    isClosed: true,
    acnScreenPos,
  });

  const wpList = waypoints ?? [];
  if (Array.isArray(wpList) && wpList.length > 0) {
    drawWaypoints(ctx, layout, viewport, wpList);
  }
}

function drawGroundNodes(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: TopViewViewportState,
  allNodes?: readonly any[],
  selectedNodeId?: number
): void {
  if (!allNodes || allNodes.length === 0) return;
  for (const node of allNodes) {
    if (!node || typeof node !== 'object') continue;
    if (node.node_id === selectedNodeId) continue;
    const x = typeof node.x_m === 'number' ? node.x_m : (node.position ? node.position[0] : NaN);
    const y = typeof node.y_m === 'number' ? node.y_m : (node.position ? node.position[1] : NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    const px = viewport.xToCanvas(x, layout);
    const py = viewport.yToCanvas(y, layout);

    ctx.save();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.font = '8px ui-monospace, monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText(`S${node.node_id}`, px, py - 5);
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP VIEW RENDERERS (TERRAIN & RF)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders the Terrain Path Profile in TOP VIEW (Plan View) mode with authentic DEM terrain.
 *
 * Displays:
 *  - Authentic Ladakh DEM relief & hypsometric elevation shading across surrounding terrain.
 *  - Restrained route vector with sparse direction markers.
 *  - Identified terrain crests and ridge occlusion hazard points.
 *  - Obstacle footprints along the path.
 *  - Compact heading-aware ACN symbol and Terminal diamond with elevation annotations.
 *  - Elevation legend.
 */
export function renderTerrainTopView(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: TopViewViewportState,
  profile: LinkProfile | null,
  options?: TopViewRenderOptions
): void {
  const { width: w, height: h, padL, padR, padT, padB } = layout;
  if (w <= 0 || h <= 0) return;

  const plotW = Math.max(1, w - padL - padR);
  const plotH = Math.max(1, h - padT - padB);

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#090e14');
  bg.addColorStop(1, '#06090d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  if (!profile || !profile.valid || profile.samples.length < 2) {
    ctx.fillStyle = '#7d8c99';
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for terrain profile data…', w / 2, h / 2);
    return;
  }

  // Draw Grid
  drawPlanViewGrid(ctx, layout, viewport);

  // Clip data rendering to plot area
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();

  // 1. Authentic DEM Terrain Layer
  drawDemTerrain(ctx, layout, viewport, options);

  // 2. Known Summits within the viewport
  drawKnownSummits(ctx, layout, viewport);

  // 2b. Custom Obstacles footprint layer
  drawObstacleFootprints(ctx, layout, viewport, options?.obstacles, profile.obstacleIntervals?.map(o => o.obstacleId));

  // 2c. Flight Trajectory loop & Waypoints
  const effectiveFlightPath = options?.acnTelemetry?.flight_path ?? (
    Array.isArray(options?.waypoints) && options.waypoints.length >= 3
      ? options.waypoints.map(wp => [
          typeof wp.xM === 'number' ? wp.xM : (typeof wp.x_m === 'number' ? wp.x_m : (Array.isArray(wp) ? wp[0] : 0)),
          typeof wp.yM === 'number' ? wp.yM : (typeof wp.y_m === 'number' ? wp.y_m : (Array.isArray(wp) ? wp[1] : 0)),
        ] as [number, number])
      : undefined
  );
  drawFlightTrajectory(
    ctx,
    layout,
    viewport,
    effectiveFlightPath,
    options?.waypoints ?? options?.acnTelemetry?.waypoints
  );

  // 2d. Ground node positions
  drawGroundNodes(ctx, layout, viewport, options?.allNodes, options?.selectedNode?.node_id ?? profile.selectedGroundNodeId);

  const node = profile.groundNodePositionMslM;
  const acn = profile.acnPositionMslM;
  const dx = acn[0] - node[0];
  const dy = acn[1] - node[1];
  const groundDistM = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const perpX = -Math.sin(angle);
  const perpY = Math.cos(angle);

  const samples = profile.samples;

  // 3. Analysis Corridor Guide (Subtle boundary lines)
  const swathHalfWidthM = Math.max(400, Math.min(2500, groundDistM * 0.035));
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);

  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const frac = samples[i].horizontalGroundDistanceM / groundDistM;
    const px = viewport.xToCanvas(node[0] + frac * dx + perpX * swathHalfWidthM, layout);
    const py = viewport.yToCanvas(node[1] + frac * dy + perpY * swathHalfWidthM, layout);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const frac = samples[i].horizontalGroundDistanceM / groundDistM;
    const px = viewport.xToCanvas(node[0] + frac * dx - perpX * swathHalfWidthM, layout);
    const py = viewport.yToCanvas(node[1] + frac * dy - perpY * swathHalfWidthM, layout);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();

  // 4. Centerline Path Vector with Direction Chevrons
  const pNodeX = viewport.xToCanvas(node[0], layout);
  const pNodeY = viewport.yToCanvas(node[1], layout);
  const pAcnX = viewport.xToCanvas(acn[0], layout);
  const pAcnY = viewport.yToCanvas(acn[1], layout);

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pNodeX, pNodeY);
  ctx.lineTo(pAcnX, pAcnY);
  ctx.stroke();

  const numChevrons = Math.max(3, Math.min(8, Math.floor(groundDistM / 8000)));
  for (let c = 1; c <= numChevrons; c++) {
    const frac = c / (numChevrons + 1);
    const mx = node[0] + frac * dx;
    const my = node[1] + frac * dy;
    const px = viewport.xToCanvas(mx, layout);
    const py = viewport.yToCanvas(my, layout);

    const chevLen = 6;
    const backAngle1 = angle + Math.PI - 0.55;
    const backAngle2 = angle + Math.PI + 0.55;

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(backAngle1) * chevLen, py - Math.sin(backAngle1) * chevLen);
    ctx.lineTo(px, py);
    ctx.lineTo(px + Math.cos(backAngle2) * chevLen, py - Math.sin(backAngle2) * chevLen);
    ctx.stroke();
  }

  // 5. Highlight Terrain Occlusion Intervals (where clearance < 0)
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.effectiveTerrainClearanceM < 0) {
      const frac = s.horizontalGroundDistanceM / groundDistM;
      const ox = node[0] + frac * dx;
      const oy = node[1] + frac * dy;
      const px = viewport.xToCanvas(ox, layout);
      const py = viewport.yToCanvas(oy, layout);

      ctx.fillStyle = 'rgba(239, 68, 68, 0.40)';
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(px - 4, py - 4);
      ctx.lineTo(px + 4, py + 4);
      ctx.moveTo(px + 4, py - 4);
      ctx.lineTo(px - 4, py + 4);
      ctx.stroke();
    }
  }

  // 6. Mark Maximum Terrain Peak along Path
  let maxElev = -Infinity;
  let maxElevIdx = -1;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].terrainElevationMslM > maxElev) {
      maxElev = samples[i].terrainElevationMslM;
      maxElevIdx = i;
    }
  }

  if (maxElevIdx >= 0) {
    const sPeak = samples[maxElevIdx];
    const frac = sPeak.horizontalGroundDistanceM / groundDistM;
    const px = viewport.xToCanvas(node[0] + frac * dx, layout);
    const py = viewport.yToCanvas(node[1] + frac * dy, layout);

    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(px, py - 9);
    ctx.lineTo(px - 5, py + 2);
    ctx.lineTo(px + 5, py + 2);
    ctx.closePath();
    ctx.fill();

    ctx.font = '600 9px ui-monospace, monospace';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.fillText(`▲ ${Math.round(maxElev)}m`, px, py - 12);
  }

  // 7. Draw Obstacle Footprints along Path
  if (profile.obstacleIntervals && profile.obstacleIntervals.length > 0) {
    for (const obs of profile.obstacleIntervals) {
      const midFrac = (obs.entryFraction + obs.exitFraction) / 2;
      const ox = node[0] + midFrac * dx;
      const oy = node[1] + midFrac * dy;
      const px = viewport.xToCanvas(ox, layout);
      const py = viewport.yToCanvas(oy, layout);

      ctx.fillStyle = 'rgba(249, 115, 22, 0.45)';
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = '600 8.5px ui-monospace, monospace';
      ctx.fillStyle = '#f97316';
      ctx.textAlign = 'center';
      ctx.fillText(`[${obs.obstacleId}]`, px, py + 14);
    }
  }

  // 8. Terminal Tactical Marker
  const isMcp = options?.selectedNode?.node_type === 'mcp' || (profile.nodeName && profile.nodeName.includes('MCP'));
  drawTerminalDiamond(ctx, pNodeX, pNodeY, Boolean(isMcp), 6.5);

  ctx.font = '700 10.5px ui-monospace, monospace';
  ctx.fillStyle = isMcp ? '#38bdf8' : '#4fd1a1';
  ctx.textAlign = 'left';
  ctx.fillText(`${profile.nodeName || 'Terminal'} [${Math.round(node[2])}m MSL]`, pNodeX + 9, pNodeY + 4);

  // 9. ACN Tactical Marker (Chevron with Heading & Glow)
  const acnHdg = options?.acnTelemetry?.heading_deg ?? (((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360);
  drawAircraftChevron(ctx, pAcnX, pAcnY, acnHdg);

  const acnText = `ACN [${Math.round(acn[2])}m MSL] · HDG ${Math.round(acnHdg)}°`;
  ctx.font = '700 10.5px ui-monospace, monospace';
  const acnTw = ctx.measureText(acnText).width;
  ctx.fillStyle = 'rgba(7, 13, 20, 0.82)';
  ctx.fillRect(pAcnX - 16 - acnTw - 6, pAcnY - 8, acnTw + 8, 16);
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
  ctx.lineWidth = 1.0;
  ctx.strokeRect(pAcnX - 16 - acnTw - 6, pAcnY - 8, acnTw + 8, 16);
  ctx.fillStyle = '#38bdf8';
  ctx.textAlign = 'right';
  ctx.fillText(acnText, pAcnX - 16, pAcnY + 4);

  // 10. Elevation Legend
  if (options?.showElevationLegend !== false) {
    renderElevationLegend(ctx, layout);
  }

  ctx.restore();

  // Top Title & Metric Banner
  const bearingDeg = ((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360;
  const distKm = groundDistM / 1000;
  const zoomText = viewport.isUserModified ? ` · Zoom ${viewport.zoomFactor.toFixed(1)}×` : '';

  ctx.font = '10.5px ui-monospace, monospace';
  ctx.fillStyle = '#9aa8b3';
  ctx.textAlign = 'left';
  ctx.fillText(
    `PLAN VIEW · Path ${distKm.toFixed(1)} km · Bearing ${bearingDeg.toFixed(0)}° · Peak ${Math.round(maxElev)}m MSL${zoomText}`,
    padL + 4,
    16
  );
}

/**
 * Renders the RF Path Profile in TOP VIEW (Plan View) mode with authentic DEM terrain.
 *
 * Displays:
 *  - Authentic Ladakh DEM relief & hypsometric elevation shading across surrounding terrain.
 *  - 1st Fresnel zone horizontal ground footprint as a translucent cyan swath over mountains.
 *  - Unified communication link status line (connected green, marginal yellow, outage red).
 *  - Highlighted terrain-obstructed and obstacle-blocked segments.
 *  - Clear visual distinction between carrier link establishment and active payload transmission.
 *  - Tactical ACN chevron and Terminal diamond endpoints.
 *  - Elevation legend.
 */
export function renderRfTopView(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: TopViewViewportState,
  profile: LinkProfile | null,
  linkBudget: { snrDb?: number; bitrateBps?: number; modcodName?: string; isOutage?: boolean; fcHz?: number; fsplDb?: number } | null,
  commStatus: LinkStatusClassification | LinkCommunicationStatus | null,
  transferState?: { status?: string; activeType?: string | null; deliveredBytes?: number; totalBytes?: number } | null,
  options?: TopViewRenderOptions
): void {
  const { width: w, height: h, padL, padR, padT, padB } = layout;
  if (w <= 0 || h <= 0) return;

  const plotW = Math.max(1, w - padL - padR);
  const plotH = Math.max(1, h - padT - padB);

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#090e14');
  bg.addColorStop(1, '#06090d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  if (!profile || !profile.valid || profile.samples.length < 2) {
    ctx.fillStyle = '#7d8c99';
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for RF link profile data…', w / 2, h / 2);
    return;
  }

  // Draw Grid
  drawPlanViewGrid(ctx, layout, viewport);

  // Clip data rendering to plot area
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();

  // 1. Authentic DEM Terrain Layer (identical alignment and scale)
  drawDemTerrain(ctx, layout, viewport, options);

  // 2. Known Summits within the viewport
  drawKnownSummits(ctx, layout, viewport);

  // 2b. Custom Obstacles footprint layer
  drawObstacleFootprints(ctx, layout, viewport, options?.obstacles, profile.obstacleIntervals?.map(o => o.obstacleId));

  // 2c. Flight Trajectory loop & Waypoints
  const effectiveFlightPath = options?.acnTelemetry?.flight_path ?? (
    Array.isArray(options?.waypoints) && options.waypoints.length >= 3
      ? options.waypoints.map(wp => [
          typeof wp.xM === 'number' ? wp.xM : (typeof wp.x_m === 'number' ? wp.x_m : (Array.isArray(wp) ? wp[0] : 0)),
          typeof wp.yM === 'number' ? wp.yM : (typeof wp.y_m === 'number' ? wp.y_m : (Array.isArray(wp) ? wp[1] : 0)),
        ] as [number, number])
      : undefined
  );
  drawFlightTrajectory(
    ctx,
    layout,
    viewport,
    effectiveFlightPath,
    options?.waypoints ?? options?.acnTelemetry?.waypoints
  );

  // 2d. Ground node positions
  drawGroundNodes(ctx, layout, viewport, options?.allNodes, options?.selectedNode?.node_id ?? profile.selectedGroundNodeId);

  const node = profile.groundNodePositionMslM;
  const acn = profile.acnPositionMslM;
  const dx = acn[0] - node[0];
  const dy = acn[1] - node[1];
  const groundDistM = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const perpX = -Math.sin(angle);
  const perpY = Math.cos(angle);

  const samples = profile.samples;

  // 3. 1st Fresnel Zone Horizontal Footprint (Translucent Cyan/Blue Swath over DEM Terrain)
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const frac = s.horizontalGroundDistanceM / groundDistM;
    const rFresnel = s.fresnelRadiusM * profile.fresnelFraction;
    const px = viewport.xToCanvas(node[0] + frac * dx + perpX * rFresnel, layout);
    const py = viewport.yToCanvas(node[1] + frac * dy + perpY * rFresnel, layout);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    const frac = s.horizontalGroundDistanceM / groundDistM;
    const rFresnel = s.fresnelRadiusM * profile.fresnelFraction;
    const px = viewport.xToCanvas(node[0] + frac * dx - perpX * rFresnel, layout);
    const py = viewport.yToCanvas(node[1] + frac * dy - perpY * rFresnel, layout);
    ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.18)'; // Translucent cyan sheen letting terrain ridges show through
  ctx.fill();

  // Dashed Fresnel boundary lines
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
  ctx.lineWidth = 1.2;

  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const frac = s.horizontalGroundDistanceM / groundDistM;
    const rFresnel = s.fresnelRadiusM * profile.fresnelFraction;
    const px = viewport.xToCanvas(node[0] + frac * dx + perpX * rFresnel, layout);
    const py = viewport.yToCanvas(node[1] + frac * dy + perpY * rFresnel, layout);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const frac = s.horizontalGroundDistanceM / groundDistM;
    const rFresnel = s.fresnelRadiusM * profile.fresnelFraction;
    const px = viewport.xToCanvas(node[0] + frac * dx - perpX * rFresnel, layout);
    const py = viewport.yToCanvas(node[1] + frac * dy - perpY * rFresnel, layout);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();

  // 4. Direct RF Propagation Ray (Unified Link Status Styling)
  const pNodeX = viewport.xToCanvas(node[0], layout);
  const pNodeY = viewport.yToCanvas(node[1], layout);
  const pAcnX = viewport.xToCanvas(acn[0], layout);
  const pAcnY = viewport.yToCanvas(acn[1], layout);

  const statusKey: LinkCommunicationStatus = typeof commStatus === 'string'
    ? commStatus
    : (commStatus && 'status' in commStatus ? commStatus.status : 'CONNECTED');
  const style = getMapLinkStyle(statusKey);
  const linkColor = style.selectedStrokeColor;
  const dashPattern = style.lineDash;

  ctx.save();
  if (dashPattern && dashPattern.length > 0) ctx.setLineDash([...dashPattern]);
  ctx.strokeStyle = linkColor;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(pNodeX, pNodeY);
  ctx.lineTo(pAcnX, pAcnY);
  ctx.stroke();
  ctx.restore();

  // 5. Highlight Terrain-Blocked Segments
  for (let i = 0; i < samples.length - 1; i++) {
    const s1 = samples[i];
    const s2 = samples[i + 1];
    if (s1.effectiveTerrainClearanceM < 0 || s2.effectiveTerrainClearanceM < 0) {
      const frac1 = s1.horizontalGroundDistanceM / groundDistM;
      const frac2 = s2.horizontalGroundDistanceM / groundDistM;
      const x1 = viewport.xToCanvas(node[0] + frac1 * dx, layout);
      const y1 = viewport.yToCanvas(node[1] + frac1 * dy, layout);
      const x2 = viewport.xToCanvas(node[0] + frac2 * dx, layout);
      const y2 = viewport.yToCanvas(node[1] + frac2 * dy, layout);

      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 6. Highlight Obstacle-Blocked Intervals
  if (profile.obstacleIntervals && profile.obstacleIntervals.length > 0) {
    for (const obs of profile.obstacleIntervals) {
      const x1 = viewport.xToCanvas(node[0] + obs.entryFraction * dx, layout);
      const y1 = viewport.yToCanvas(node[1] + obs.entryFraction * dy, layout);
      const x2 = viewport.xToCanvas(node[0] + obs.exitFraction * dx, layout);
      const y2 = viewport.yToCanvas(node[1] + obs.exitFraction * dy, layout);

      ctx.save();
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 5.0;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      ctx.font = '600 8.5px ui-monospace, monospace';
      ctx.fillStyle = '#f97316';
      ctx.textAlign = 'center';
      ctx.fillText(`⊘ ${obs.obstacleId}`, midX, midY - 8);
      ctx.restore();
    }
  }

  // 7. Active Payload Transmission Distinction
  const isTxActive = transferState?.status === 'TRANSMITTING';
  if (isTxActive && profile.terrainIsLos && !profile.obstacleBlocked) {
    const numPulses = 4;
    for (let p = 0; p < numPulses; p++) {
      const pulseFrac = (0.2 + p * 0.22) % 1.0;
      const px = viewport.xToCanvas(node[0] + pulseFrac * dx, layout);
      const py = viewport.yToCanvas(node[1] + pulseFrac * dy, layout);

      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 8. Terminal Tactical Marker
  const isMcp = options?.selectedNode?.node_type === 'mcp' || (profile.nodeName && profile.nodeName.includes('MCP'));
  drawTerminalDiamond(ctx, pNodeX, pNodeY, Boolean(isMcp), 6.5);

  ctx.font = '700 10.5px ui-monospace, monospace';
  ctx.fillStyle = isMcp ? '#38bdf8' : '#4fd1a1';
  ctx.textAlign = 'left';
  ctx.fillText(profile.nodeName || 'Terminal', pNodeX + 9, pNodeY + 4);

  // 9. ACN Tactical Marker (Chevron with Heading & Glow)
  const acnHdg = options?.acnTelemetry?.heading_deg ?? (((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360);
  drawAircraftChevron(ctx, pAcnX, pAcnY, acnHdg);

  const acnRfText = `ACN · HDG ${Math.round(acnHdg)}°`;
  ctx.font = '700 10.5px ui-monospace, monospace';
  const acnRfTw = ctx.measureText(acnRfText).width;
  ctx.fillStyle = 'rgba(7, 13, 20, 0.82)';
  ctx.fillRect(pAcnX - 16 - acnRfTw - 6, pAcnY - 8, acnRfTw + 8, 16);
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
  ctx.lineWidth = 1.0;
  ctx.strokeRect(pAcnX - 16 - acnRfTw - 6, pAcnY - 8, acnRfTw + 8, 16);
  ctx.fillStyle = '#38bdf8';
  ctx.textAlign = 'right';
  ctx.fillText(acnRfText, pAcnX - 16, pAcnY + 4);

  // 10. Elevation Legend
  if (options?.showElevationLegend !== false) {
    renderElevationLegend(ctx, layout);
  }

  ctx.restore();

  // Top Header: Link Status vs Active Payload Transmission Callout
  const snrVal = linkBudget?.snrDb;
  const snrText = typeof snrVal === 'number' && Number.isFinite(snrVal) ? ` · SNR ${snrVal.toFixed(1)} dB` : '';
  const modcodText = linkBudget?.modcodName ? ` · ${linkBudget.modcodName}` : '';
  const txText = isTxActive
    ? ` · [PAYLOAD TX ACTIVE: ${transferState?.activeType ?? 'BURST'}]`
    : (statusKey === 'CONNECTED' ? ' · [CARRIER IDLE: NO ACTIVE TX]' : '');

  ctx.font = '10.5px ui-monospace, monospace';
  ctx.fillStyle = '#9aa8b3';
  ctx.textAlign = 'left';
  ctx.fillText(
    `RF TOP VIEW · ${statusKey}${snrText}${modcodText}${txText}`,
    padL + 4,
    16
  );
}
