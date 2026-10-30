/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * M6.1 Task 5: 2D Tactical Map Terrain & DEM Coverage Boundary Renderer
 *
 * Provides:
 * 1. Authoritative world-to-screen terrain placement with exact metric scale and aspect ratio.
 * 2. Transparent invalid elevation sample handling (packed 0 -> alpha 0).
 * 3. High-definition rectangular satellite DEM coverage boundary overlay and corner brackets.
 * 4. Coordinate alignment and invariant transformations during pan and zoom.
 */

import { TerrainBoundsTelemetry, REAL_LADAKH_DEM_METADATA } from '../core/terrain';

export interface RadarGeometry {
  readonly centerX: number;
  readonly centerY: number;
  readonly scale: number;
}

export interface PanOffset {
  readonly xM: number;
  readonly yM: number;
}

export interface TerrainScreenBounds {
  readonly tl: { readonly x: number; readonly y: number };
  readonly br: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number; // height / width
  readonly isRealMode: boolean;
  readonly isValidCoverage: boolean;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface DemBoundaryGeometry {
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly brackets: {
    readonly tl: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
    readonly tr: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
    readonly bl: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
    readonly br: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
  };
  readonly badge: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly title: string;
    readonly subtitle: string;
  };
  readonly dimensionsTag?: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly text: string;
  };
}

/**
 * Maps world Cartesian coordinates (metres from origin) to 2D Canvas screen coordinates.
 */
export function worldToRadarScreen(
  xM: number,
  yM: number,
  geometry: RadarGeometry,
  pan: PanOffset
): { x: number; y: number } {
  return {
    x: geometry.centerX + (xM - pan.xM) * geometry.scale,
    y: geometry.centerY - (yM - pan.yM) * geometry.scale,
  };
}

/**
 * Maps 2D Canvas screen coordinates back to world Cartesian coordinates (metres from origin).
 */
export function radarScreenToWorld(
  px: number,
  py: number,
  geometry: RadarGeometry,
  pan: PanOffset
): { xM: number; yM: number } {
  return {
    xM: (px - geometry.centerX) / geometry.scale + pan.xM,
    yM: (geometry.centerY - py) / geometry.scale + pan.yM,
  };
}

/**
 * Computes authoritative screen bounds for terrain rendering.
 * In real DEM mode: uses genuine geographic bounds (+/-91.84 km E-W, +/-110.93 km N-S, aspect ratio ~1.208).
 * In synthetic mode: uses square full-theater regional domain (+/-600 km, aspect ratio 1.0).
 */
export function computeTerrainScreenBounds(
  bounds: TerrainBoundsTelemetry | null,
  fallbackRadiusM: number,
  geometry: RadarGeometry,
  pan: PanOffset
): TerrainScreenBounds {
  let minX: number, maxX: number, minY: number, maxY: number;
  let isRealMode = false;
  let isValidCoverage = false;

  if (bounds && typeof bounds === 'object') {
    minX = bounds.minX;
    maxX = bounds.maxX;
    minY = bounds.minY;
    maxY = bounds.maxY;
    isRealMode = bounds.terrainMode === 'real';
    isValidCoverage = bounds.isValidCoverage;
  } else {
    minX = -fallbackRadiusM;
    maxX = fallbackRadiusM;
    minY = -fallbackRadiusM;
    maxY = fallbackRadiusM;
    isRealMode = false;
    isValidCoverage = true;
  }

  // Top-Left is North-West (minX, maxY) because +Y is North (up) and Canvas screen Y is down.
  const tl = worldToRadarScreen(minX, maxY, geometry, pan);
  // Bottom-Right is South-East (maxX, minY).
  const br = worldToRadarScreen(maxX, minY, geometry, pan);

  const width = br.x - tl.x;
  const height = br.y - tl.y;
  const aspectRatio = width > 0 ? height / width : 1.0;

  return {
    tl,
    br,
    width,
    height,
    aspectRatio,
    isRealMode,
    isValidCoverage,
    minX,
    maxX,
    minY,
    maxY,
  };
}

/**
 * Processes worker-provided 2D packed RGB grid into raw ImageData byte array.
 * Converts packed 0 or invalid samples into completely transparent pixels (alpha = 0),
 * preventing unmapped or missing terrain from being painted as opaque black elevation.
 */
export function processHillshadeImageData(
  data: readonly (readonly number[])[],
  targetImgData: Uint8ClampedArray | number[]
): { validPixels: number; transparentPixels: number } {
  let validPixels = 0;
  let transparentPixels = 0;
  let p = 0;

  const numRows = data.length;
  for (let r = 0; r < numRows; r++) {
    const row = data[r];
    const numCols = row.length;
    for (let c = 0; c < numCols; c++) {
      const v = row[c];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        const red = (v >> 16) & 255;
        const green = (v >> 8) & 255;
        const blue = v & 255;
        targetImgData[p++] = Math.min(255, red);
        targetImgData[p++] = Math.min(255, green);
        targetImgData[p++] = Math.min(255, blue);
        targetImgData[p++] = 255; // Fully opaque for valid terrain
        validPixels++;
      } else {
        // Transparent for unmapped, out-of-coverage, or NaN samples
        targetImgData[p++] = 0;
        targetImgData[p++] = 0;
        targetImgData[p++] = 0;
        targetImgData[p++] = 0; // Fully transparent
        transparentPixels++;
      }
    }
  }

  return { validPixels, transparentPixels };
}

/**
 * Computes tactical coverage boundary geometry including brackets, reticles, and labels.
 * Returns null if not in real DEM mode or coverage is not valid.
 */
export function computeDemBoundaryGeometry(
  screenBounds: TerrainScreenBounds,
  canvasWidth: number,
  canvasHeight: number,
  bounds: TerrainBoundsTelemetry | null
): DemBoundaryGeometry | null {
  if (!screenBounds.isRealMode) {
    return null;
  }

  const { tl, br, width, height, maxX, maxY } = screenBounds;
  const rect = { x: tl.x, y: tl.y, w: width, h: height };

  const cornerLen = Math.min(16, Math.max(6, Math.min(width, height) * 0.08));

  const brackets = {
    tl: [
      [tl.x, tl.y + cornerLen],
      [tl.x, tl.y],
      [tl.x + cornerLen, tl.y],
    ] as const,
    tr: [
      [br.x - cornerLen, tl.y],
      [br.x, tl.y],
      [br.x, tl.y + cornerLen],
    ] as const,
    bl: [
      [tl.x, br.y - cornerLen],
      [tl.x, br.y],
      [tl.x + cornerLen, br.y],
    ] as const,
    br: [
      [br.x - cornerLen, br.y],
      [br.x, br.y],
      [br.x, br.y - cornerLen],
    ] as const,
  };

  const title = 'SATELLITE DEM COVERAGE';
  const rasterW = bounds?.rasterWidth ?? REAL_LADAKH_DEM_METADATA.rasterWidth;
  const rasterH = bounds?.rasterHeight ?? REAL_LADAKH_DEM_METADATA.rasterHeight;
  const subtitle = `LADAKH (${rasterW}×${rasterH})`;

  const badgeW = 148;
  const badgeH = 26;
  const badgeX = Math.max(10, Math.min(canvasWidth - badgeW - 10, tl.x + 8));
  const badgeY = Math.max(10, Math.min(canvasHeight - badgeH - 10, tl.y + 8));

  const badge = {
    x: badgeX,
    y: badgeY,
    w: badgeW,
    h: badgeH,
    title,
    subtitle,
  };

  let dimensionsTag: DemBoundaryGeometry['dimensionsTag'] = undefined;
  if (br.x >= 90 && br.y >= 30 && br.x <= canvasWidth + 50 && br.y <= canvasHeight + 50) {
    const text = `±${(maxX / 1000).toFixed(1)} km E-W × ±${(maxY / 1000).toFixed(1)} km N-S`;
    const dimW = 160;
    const dimH = 15;
    const dimX = Math.max(10, Math.min(canvasWidth - dimW - 10, br.x - dimW - 8));
    const dimY = Math.max(20, Math.min(canvasHeight - dimH - 8, br.y - dimH - 6));
    dimensionsTag = {
      x: dimX,
      y: dimY,
      w: dimW,
      h: dimH,
      text,
    };
  }

  return {
    rect,
    brackets,
    badge,
    dimensionsTag,
  };
}

/**
 * Renders the tactical satellite DEM coverage boundary and labels onto the 2D canvas context.
 */
export function renderDemCoverageBoundary(
  ctx: CanvasRenderingContext2D,
  geom: DemBoundaryGeometry,
  monoFont: string
): void {
  ctx.save();

  // 1. Dashed coverage boundary
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(geom.rect.x, geom.rect.y, geom.rect.w, geom.rect.h);
  ctx.setLineDash([]);

  // 2. Solid corner brackets
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.90)';
  ctx.lineWidth = 1.6;

  for (const b of [geom.brackets.tl, geom.brackets.tr, geom.brackets.bl, geom.brackets.br]) {
    ctx.beginPath();
    ctx.moveTo(b[0][0], b[0][1]);
    ctx.lineTo(b[1][0], b[1][1]);
    ctx.lineTo(b[2][0], b[2][1]);
    ctx.stroke();
  }

  // 3. Identification badge
  const b = geom.badge;
  ctx.fillStyle = 'rgba(11, 14, 20, 0.88)';
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.50)';
  ctx.lineWidth = 1;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeRect(b.x, b.y, b.w, b.h);

  ctx.font = `bold 9px ${monoFont}`;
  ctx.fillStyle = 'rgba(56, 189, 248, 0.95)';
  ctx.fillText(b.title, b.x + 7, b.y + 11);

  ctx.font = `8px ${monoFont}`;
  ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
  ctx.fillText(b.subtitle, b.x + 7, b.y + 21);

  // 4. Subtle dimensions tag at bottom-right
  if (geom.dimensionsTag) {
    const d = geom.dimensionsTag;
    ctx.fillStyle = 'rgba(11, 14, 20, 0.85)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1;
    ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.strokeRect(d.x, d.y, d.w, d.h);

    ctx.font = `8px ${monoFont}`;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.90)';
    ctx.fillText(d.text, d.x + 4, d.y + 11);
  }

  ctx.restore();
}

