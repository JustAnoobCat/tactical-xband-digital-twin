/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Scientific Terrain Toolbox Canvas Charts & Raster Encoders
 *
 * Uses Highland Instrument theme tokens exclusively.
 */

import { HIGHLAND_THEME } from './workbench/chartTheme';
import type {
  AltitudeSweepResult,
  BridgeFinderResult,
  SiteProbeViewshedResult,
  SlopeAndRidgeGrid,
  TransectAnalysisResult,
  TransectSampleStatus,
} from './terrainToolboxAnalysis';

export const TRANSECT_STATUS_COLORS: Readonly<Record<TransectSampleStatus, string>> = Object.freeze({
  clear: HIGHLAND_THEME.signal.sage,
  grazing: HIGHLAND_THEME.signal.ochre,
  shadow: HIGHLAND_THEME.signal.vermilion,
  obstacle: HIGHLAND_THEME.signal.copper,
  out_of_coverage: HIGHLAND_THEME.signal.ash,
});

const TRANSECT_PAD = Object.freeze({ left: 36, right: 10, top: 14, bottom: 20 });

function lerpRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * c),
    Math.round(a[1] + (b[1] - a[1]) * c),
    Math.round(a[2] + (b[2] - a[2]) * c),
  ];
}

function slopeColor(deg: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, deg / 45));
  if (t < 0.33) return lerpRgb([24, 34, 42], [82, 183, 136], t / 0.33);
  if (t < 0.66) return lerpRgb([82, 183, 136], [233, 196, 106], (t - 0.33) / 0.33);
  return lerpRgb([233, 196, 106], [224, 83, 71], (t - 0.66) / 0.34);
}

function ridgeColor(tpiM: number, maxAbsTpiM: number): [number, number, number] {
  const scale = Math.max(15, maxAbsTpiM * 0.45);
  const norm = Math.max(-1, Math.min(1, tpiM / scale));
  if (norm < 0) return lerpRgb([35, 42, 54], [90, 120, 190], -norm);
  return lerpRgb([35, 42, 54], [240, 184, 92], norm);
}

/**
 * Pure RGBA encoder for Slope (°) and Ridge Crest (TPI m) rasters.
 * Voids / NaNs always map to alpha === 0.
 */
export function encodeSlopeRidgeRgba(
  grid: SlopeAndRidgeGrid,
  mode: 'slope' | 'ridge',
  outWidth: number,
  outHeight: number,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(outWidth * outHeight * 4);
  const src = mode === 'slope' ? grid.slopeDeg : grid.ridgeTpiM;
  const srcW = grid.width;
  const srcH = grid.height;

  for (let y = 0; y < outHeight; y++) {
    const sy = outHeight > 1 ? Math.round((y / (outHeight - 1)) * (srcH - 1)) : 0;
    for (let x = 0; x < outWidth; x++) {
      const sx = outWidth > 1 ? Math.round((x / (outWidth - 1)) * (srcW - 1)) : 0;
      const val = src[sy * srcW + sx];
      const p = (y * outWidth + x) * 4;
      if (!Number.isFinite(val)) {
        rgba[p + 3] = 0;
        continue;
      }
      const rgb = mode === 'slope' ? slopeColor(val) : ridgeColor(val, grid.maxAbsTpiM);
      rgba[p] = rgb[0];
      rgba[p + 1] = rgb[1];
      rgba[p + 2] = rgb[2];
      rgba[p + 3] = 225;
    }
  }
  return rgba;
}

/**
 * Renders Slope or Ridge Crest raster into a <= 512x512 offscreen canvas.
 */
export function renderSlopeOrRidgeBackdropCanvas(
  grid: SlopeAndRidgeGrid,
  mode: 'slope' | 'ridge',
  targetCanvas?: HTMLCanvasElement,
): HTMLCanvasElement {
  const outW = Math.min(512, Math.max(2, grid.width));
  const outH = Math.min(512, Math.max(2, grid.height));
  const canvas = targetCanvas ?? document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const rgba = encodeSlopeRidgeRgba(grid, mode, outW, outH);
  const img = ctx.createImageData(outW, outH);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function prepareCanvasDpr(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
): CanvasRenderingContext2D | null {
  const dpr = typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
    ? Math.max(1, Math.min(2, window.devicePixelRatio))
    : 1;
  const targetW = Math.round(cssW * dpr);
  const targetH = Math.round(cssH * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * Maps a CSS X coordinate inside the transect profile canvas to the nearest sample index.
 */
export function transectCanvasXToSampleIndex(
  canvasCssX: number,
  canvasCssWidth: number,
  result: TransectAnalysisResult | null,
): number | null {
  if (!result || !result.samples.length || !(result.totalHorizontalM > 0)) return null;
  const plotW = Math.max(1, canvasCssWidth - TRANSECT_PAD.left - TRANSECT_PAD.right);
  if (canvasCssX < TRANSECT_PAD.left || canvasCssX > TRANSECT_PAD.left + plotW) return null;
  const targetDist = ((canvasCssX - TRANSECT_PAD.left) / plotW) * result.totalHorizontalM;
  let bestIdx = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < result.samples.length; i++) {
    const diff = Math.abs(result.samples[i].cumulativeDistM - targetDist);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Renders the Mode 2 compact elevation + 4/3-Earth bulge + 0.6 F1 + obstacle + specular canvas.
 */
export function renderTransectProfileCanvas(
  canvas: HTMLCanvasElement,
  result: TransectAnalysisResult | null,
  hoverSampleIdx: number | null = null,
): void {
  const cssW = canvas.clientWidth > 40 ? canvas.clientWidth : 280;
  const cssH = canvas.clientHeight > 40 ? canvas.clientHeight : 135;
  const ctx = prepareCanvasDpr(canvas, cssW, cssH);
  if (!ctx) return;

  ctx.fillStyle = HIGHLAND_THEME.substrate.void;
  ctx.fillRect(0, 0, cssW, cssH);

  if (!result || !result.valid || result.samples.length < 2 || !(result.totalHorizontalM > 0)) {
    ctx.fillStyle = HIGHLAND_THEME.text.muted;
    ctx.font = `10px ${HIGHLAND_THEME.font.mono}`;
    ctx.textAlign = 'center';
    ctx.fillText(
      result && !result.isCoverageComplete
        ? 'OUTSIDE DEM COVERAGE'
        : 'Pick 2+ points on map to profile transect',
      cssW * 0.5,
      cssH * 0.5,
    );
    return;
  }

  const plotX = TRANSECT_PAD.left;
  const plotY = TRANSECT_PAD.top;
  const plotW = Math.max(20, cssW - TRANSECT_PAD.left - TRANSECT_PAD.right);
  const plotH = Math.max(20, cssH - TRANSECT_PAD.top - TRANSECT_PAD.bottom);

  let minElev = Number.POSITIVE_INFINITY;
  let maxElev = Number.NEGATIVE_INFINITY;
  for (const s of result.samples) {
    const vals = [s.terrainMslM, s.effectiveTerrainMslM, s.losMslM, s.lowerFresnel06MslM];
    for (const v of vals) {
      if (Number.isFinite(v)) {
        if (v < minElev) minElev = v;
        if (v > maxElev) maxElev = v;
      }
    }
  }
  if (!Number.isFinite(minElev) || !Number.isFinite(maxElev)) {
    minElev = 3000;
    maxElev = 5500;
  }
  const padElev = Math.max(60, (maxElev - minElev) * 0.12);
  minElev -= padElev;
  maxElev += padElev;
  const spanElev = Math.max(10, maxElev - minElev);

  const xOf = (distM: number) => plotX + (distM / result.totalHorizontalM) * plotW;
  const yOf = (elevM: number) => plotY + (1 - (elevM - minElev) / spanElev) * plotH;

  // Gridlines
  ctx.strokeStyle = HIGHLAND_THEME.line.grid;
  ctx.lineWidth = 1;
  for (let g = 0; g <= 2; g++) {
    const gy = plotY + (g / 2) * plotH;
    ctx.beginPath();
    ctx.moveTo(plotX, gy);
    ctx.lineTo(plotX + plotW, gy);
    ctx.stroke();
    const labelVal = maxElev - (g / 2) * spanElev;
    ctx.fillStyle = HIGHLAND_THEME.text.faint;
    ctx.font = `9px ${HIGHLAND_THEME.font.mono}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(labelVal)}`, plotX - 4, gy + 3);
  }

  // Terrain polygon fill
  const samples = result.samples;
  ctx.beginPath();
  ctx.moveTo(xOf(samples[0].cumulativeDistM), plotY + plotH);
  for (const s of samples) {
    ctx.lineTo(xOf(s.cumulativeDistM), yOf(s.terrainMslM));
  }
  ctx.lineTo(xOf(samples[samples.length - 1].cumulativeDistM), plotY + plotH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, plotY, 0, plotY + plotH);
  grad.addColorStop(0, 'rgba(82, 183, 136, 0.28)');
  grad.addColorStop(1, 'rgba(20, 23, 28, 0.85)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Terrain ridge line
  ctx.strokeStyle = HIGHLAND_THEME.cartography.terrainBareDem;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  samples.forEach((s, i) => {
    const px = xOf(s.cumulativeDistM);
    const py = yOf(s.terrainMslM);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // 4/3 Earth effective bulge terrain curve
  ctx.strokeStyle = HIGHLAND_THEME.signal.ochreStrokeSoft;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  samples.forEach((s, i) => {
    const px = xOf(s.cumulativeDistM);
    const py = yOf(s.effectiveTerrainMslM);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // 1st Fresnel Zone (F1) upper and lower ellipse envelope (8.0 GHz)
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  // Upper F1
  ctx.beginPath();
  samples.forEach((s, i) => {
    const px = xOf(s.cumulativeDistM);
    const py = yOf(s.losMslM + s.fresnelRadiusM);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  // Lower F1
  ctx.beginPath();
  samples.forEach((s, i) => {
    const px = xOf(s.cumulativeDistM);
    const py = yOf(s.losMslM - s.fresnelRadiusM);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // Red shading where terrain intrudes into 0.6 F1
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (b.effectiveTerrainMslM > b.lowerFresnel06MslM || a.effectiveTerrainMslM > a.lowerFresnel06MslM) {
      const x0 = xOf(a.cumulativeDistM);
      const x1 = xOf(b.cumulativeDistM);
      const y0Terrain = yOf(a.effectiveTerrainMslM);
      const y1Terrain = yOf(b.effectiveTerrainMslM);
      const y0F1 = yOf(a.lowerFresnel06MslM);
      const y1F1 = yOf(b.lowerFresnel06MslM);

      ctx.fillStyle = 'rgba(255, 42, 84, 0.35)';
      ctx.beginPath();
      ctx.moveTo(x0, y0Terrain);
      ctx.lineTo(x1, y1Terrain);
      ctx.lineTo(x1, y1F1);
      ctx.lineTo(x0, y0F1);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 0.6 F1 lower corridor envelope (dashed)
  ctx.strokeStyle = HIGHLAND_THEME.signal.sageStrokeSoft;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  samples.forEach((s, i) => {
    const px = xOf(s.cumulativeDistM);
    const py = yOf(s.lowerFresnel06MslM);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // Obstacle intervals & LOS segments
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (b.status === 'obstacle') {
      const rx = xOf(a.cumulativeDistM);
      const rw = Math.max(2, xOf(b.cumulativeDistM) - rx);
      ctx.fillStyle = HIGHLAND_THEME.signal.copperSoft;
      ctx.fillRect(rx, plotY, rw, plotH);
    }
    ctx.strokeStyle = TRANSECT_STATUS_COLORS[b.status];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xOf(a.cumulativeDistM), yOf(a.losMslM));
    ctx.lineTo(xOf(b.cumulativeDistM), yOf(b.losMslM));
    ctx.stroke();
  }

  // Dominant Fresnel crest pin
  if (result.dominantCrest) {
    const cx = xOf(result.dominantCrest.cumulativeDistM);
    const cy = yOf(result.dominantCrest.effectiveTerrainMslM);
    ctx.fillStyle = result.dominantCrest.clearanceM < 0
      ? HIGHLAND_THEME.signal.vermilion
      : HIGHLAND_THEME.signal.ochre;
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Specular marker
  if (result.worstSpecular) {
    const sp = result.worstSpecular;
    const segStart = result.segments[sp.segmentIndex]?.start;
    if (segStart) {
      let cumOffset = 0;
      for (let i = 0; i < sp.segmentIndex; i++) cumOffset += result.segments[i].horizontalDistanceM;
      const sx = xOf(cumOffset + Math.hypot(sp.xM - segStart.xM, sp.yM - segStart.yM));
      const sy = yOf(sp.terrainMslM);
      ctx.fillStyle = HIGHLAND_THEME.signal.amberBright;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 4);
      ctx.lineTo(sx + 4, sy);
      ctx.lineTo(sx, sy + 4);
      ctx.lineTo(sx - 4, sy);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Hover crosshair & tooltip
  if (hoverSampleIdx !== null && samples[hoverSampleIdx]) {
    const hs = samples[hoverSampleIdx];
    const hx = xOf(hs.cumulativeDistM);
    const hy = yOf(hs.terrainMslM);
    ctx.strokeStyle = HIGHLAND_THEME.text.primary;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, plotY);
    ctx.lineTo(hx, plotY + plotH);
    ctx.stroke();
    ctx.fillStyle = HIGHLAND_THEME.signal.amberBright;
    ctx.beginPath();
    ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Tooltip readout on canvas: Dist: X.XX km | Elev: XXXX m | F1 Clr: XX.X m
    const tipText = `Dist: ${(hs.cumulativeDistM / 1000).toFixed(2)} km | Elev: ${Math.round(hs.terrainMslM)} m | F1 Clr: ${hs.clearanceM.toFixed(1)} m`;
    ctx.font = `600 9px ${HIGHLAND_THEME.font.mono}`;
    const tw = ctx.measureText(tipText).width;
    const tx = Math.max(plotX + 2, Math.min(plotX + plotW - tw - 6, hx - tw / 2));
    ctx.fillStyle = 'rgba(6, 8, 13, 0.88)';
    ctx.fillRect(tx - 2, plotY + 4, tw + 6, 13);
    ctx.strokeStyle = HIGHLAND_THEME.signal.amberBright;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(tx - 2, plotY + 4, tw + 6, 13);
    ctx.fillStyle = HIGHLAND_THEME.signal.amberBright;
    ctx.fillText(tipText, tx + 1, plotY + 14);
  }

  // Frame & X axis labels
  ctx.strokeStyle = HIGHLAND_THEME.line.frame;
  ctx.lineWidth = 1;
  ctx.strokeRect(plotX, plotY, plotW, plotH);

  ctx.fillStyle = HIGHLAND_THEME.text.faint;
  ctx.font = `9px ${HIGHLAND_THEME.font.mono}`;
  ctx.textAlign = 'left';
  ctx.fillText('0 km', plotX, cssH - 5);
  ctx.textAlign = 'right';
  ctx.fillText(`${(result.totalHorizontalM / 1000).toFixed(1)} km`, plotX + plotW, cssH - 5);
}

// ============================================================================
// PHASE B — Mode 3 & 4 Canvas Rasterizers (M4) + Polar & Sweep Charts
// ============================================================================

const VIEWSHED_RGBA: Readonly<Record<number, readonly [number, number, number, number]>> = {
  0: [0, 0, 0, 0],
  1: [82, 183, 136, 130],   // CLEAR_06F1 (sage)
  2: [233, 196, 106, 155],  // DIFFRACTED (ochre)
  3: [224, 83, 71, 145],    // HARD_SHADOW (vermilion)
  4: [217, 119, 54, 175],   // OBSTACLE_BLOCKED (copper)
};

/**
 * Rasterizes Mode 3 polar viewshed statusGrid into a square RGBA buffer (row 0 = North).
 * Used for both Radar Canvas 2D drawImage and MapLibre image source (M4).
 */
export function encodeViewshedRgba(
  viewshed: SiteProbeViewshedResult,
  size: number = 256,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  if (!viewshed.isSiteWithinCoverage || viewshed.nRings <= 0 || viewshed.nAzimuths <= 0) {
    return rgba;
  }
  const half = (size - 1) * 0.5;
  const azStepDeg = 360 / viewshed.nAzimuths;

  for (let y = 0; y < size; y++) {
    const ny = (half - y) / Math.max(1, half); // +1 North, -1 South
    for (let x = 0; x < size; x++) {
      const nx = (x - half) / Math.max(1, half); // -1 West, +1 East
      const rNorm = Math.hypot(nx, ny);
      const p = (y * size + x) * 4;
      if (rNorm > 1.0) {
        rgba[p + 3] = 0;
        continue;
      }
      const distM = rNorm * viewshed.radiusM;
      const rIdx = Math.min(viewshed.nRings - 1, Math.max(0, Math.floor(distM / viewshed.stepM)));
      const azDeg = ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360;
      const azIdx = Math.floor(azDeg / azStepDeg) % viewshed.nAzimuths;
      const st = viewshed.statusGrid[azIdx * viewshed.nRings + rIdx];
      const col = VIEWSHED_RGBA[st] ?? VIEWSHED_RGBA[0];
      rgba[p] = col[0];
      rgba[p + 1] = col[1];
      rgba[p + 2] = col[2];
      rgba[p + 3] = col[3];
    }
  }
  return rgba;
}

export type ProbeHeatmapLayerMode = 'signal' | 'viewshed';
export type ProbeHeatmapPalette = 'rf_spectrum' | 'thermal' | 'viridis';

export interface ProbeHeatmapEncodeOptions {
  readonly mode?: ProbeHeatmapLayerMode;
  readonly palette?: ProbeHeatmapPalette;
  readonly showContours?: boolean;
}

export interface ProbeSignalSample {
  readonly distM: number;
  readonly azDeg: number;
  readonly sinrDb: number;
  readonly rssiDbm: number;
  readonly status: number;
  readonly modcodTier: '64-QAM' | '16-QAM' | 'QPSK' | 'OUTAGE';
}

const HEATMAP_STOPS: Readonly<Record<ProbeHeatmapPalette, ReadonlyArray<readonly [number, readonly [number, number, number]]>>> = {
  rf_spectrum: [
    [0.0, [95, 22, 38]],     // -15 dB deep shadow / outage
    [0.33, [215, 68, 62]],   //   0 dB outage / QPSK threshold
    [0.52, [238, 178, 56]],  //  +8 dB marginal QPSK
    [0.72, [48, 196, 134]],  // +17 dB good 16-QAM
    [1.0, [56, 218, 245]],   // +30 dB peak 64-QAM
  ],
  thermal: [
    [0.0, [24, 16, 62]],
    [0.28, [120, 28, 114]],
    [0.55, [218, 72, 56]],
    [0.80, [248, 176, 48]],
    [1.0, [252, 246, 178]],
  ],
  viridis: [
    [0.0, [68, 1, 84]],
    [0.25, [59, 82, 139]],
    [0.50, [33, 145, 140]],
    [0.75, [94, 201, 98]],
    [1.0, [253, 231, 37]],
  ],
};

function samplePaletteRgb(
  palette: ProbeHeatmapPalette,
  tRaw: number,
): [number, number, number] {
  const stops = HEATMAP_STOPS[palette] ?? HEATMAP_STOPS.rf_spectrum;
  const t = Math.max(0, Math.min(1, tRaw));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t <= t1 || i === stops.length - 2) {
      const f = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;
      return lerpRgb(c0, c1, f);
    }
  }
  const last = stops[stops.length - 1][1];
  return [last[0], last[1], last[2]];
}

function samplePolarBilinear(
  grid: Float32Array,
  nAzimuths: number,
  nRings: number,
  azFloat: number,
  rFloat: number,
): number {
  const az0 = ((Math.floor(azFloat) % nAzimuths) + nAzimuths) % nAzimuths;
  const az1 = (az0 + 1) % nAzimuths;
  const fa = azFloat - Math.floor(azFloat);

  const rClamped = Math.max(0, Math.min(nRings - 1, rFloat));
  const r0 = Math.floor(rClamped);
  const r1 = Math.min(nRings - 1, r0 + 1);
  const fr = rClamped - r0;

  const v00 = grid[az0 * nRings + r0];
  const v10 = grid[az1 * nRings + r0];
  const v01 = grid[az0 * nRings + r1];
  const v11 = grid[az1 * nRings + r1];

  if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) {
    const fallback = Number.isFinite(v00) ? v00 : Number.isFinite(v01) ? v01 : Number.isFinite(v10) ? v10 : v11;
    return Number.isFinite(fallback) ? fallback : Number.NaN;
  }
  const top = v00 + (v10 - v00) * fa;
  const bot = v01 + (v11 - v01) * fa;
  return top + (bot - top) * fr;
}

/**
 * Samples interpolated RF signal strength (SINR dB, RSSI dBm, MODCOD tier) at any world (xM, yM)
 * inside a computed SiteProbeViewshedResult propagation circle.
 */
export function sampleProbeSignalAtWorldPoint(
  viewshed: SiteProbeViewshedResult | null | undefined,
  xM: number,
  yM: number,
): ProbeSignalSample | null {
  if (!viewshed || !viewshed.isSiteWithinCoverage || viewshed.nRings <= 0 || viewshed.nAzimuths <= 0) {
    return null;
  }
  const dx = xM - viewshed.siteXM;
  const dy = yM - viewshed.siteYM;
  const distM = Math.hypot(dx, dy);
  if (distM > viewshed.radiusM) return null;

  const azDeg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const azStepDeg = 360 / viewshed.nAzimuths;
  const azFloat = azDeg / azStepDeg;
  const rFloat = Math.max(0, distM / viewshed.stepM - 1);
  const azIdx = Math.floor(azFloat) % viewshed.nAzimuths;
  const rIdx = Math.min(viewshed.nRings - 1, Math.max(0, Math.floor(distM / viewshed.stepM)));
  const status = viewshed.statusGrid[azIdx * viewshed.nRings + rIdx] ?? 0;
  if (status === 0) return null;

  const hasSinr = viewshed.sinrGrid && viewshed.sinrGrid.length === viewshed.nAzimuths * viewshed.nRings;
  const hasRssi = viewshed.rssiGridDbm && viewshed.rssiGridDbm.length === viewshed.nAzimuths * viewshed.nRings;
  const sinrDb = hasSinr
    ? samplePolarBilinear(viewshed.sinrGrid, viewshed.nAzimuths, viewshed.nRings, azFloat, rFloat)
    : status === 1 ? 16 : status === 2 ? 4 : -10;
  const rssiDbm = hasRssi
    ? samplePolarBilinear(viewshed.rssiGridDbm, viewshed.nAzimuths, viewshed.nRings, azFloat, rFloat)
    : sinrDb - 101;
  if (!Number.isFinite(sinrDb)) return null;

  const modcodTier: ProbeSignalSample['modcodTier'] =
    sinrDb >= 18 ? '64-QAM' : sinrDb >= 10 ? '16-QAM' : sinrDb >= 0 ? 'QPSK' : 'OUTAGE';

  return { distM, azDeg, sinrDb, rssiDbm, status, modcodTier };
}

/**
 * Rasterizes Mode 3 continuous RF Signal Propagation Heat Map (or discrete LoS Viewshed)
 * into a smooth bilinear-interpolated RGBA buffer with optional iso-dB contour lines.
 */
export function encodeProbeSignalHeatmapRgba(
  viewshed: SiteProbeViewshedResult,
  size: number = 320,
  opts: ProbeHeatmapEncodeOptions = {},
): Uint8ClampedArray {
  const mode: ProbeHeatmapLayerMode = opts.mode ?? 'signal';
  const palette: ProbeHeatmapPalette = opts.palette ?? 'rf_spectrum';
  const showContours = opts.showContours !== false;

  if (mode === 'viewshed' || !viewshed.sinrGrid || viewshed.sinrGrid.length !== viewshed.nAzimuths * viewshed.nRings) {
    return encodeViewshedRgba(viewshed, size);
  }

  const rgba = new Uint8ClampedArray(size * size * 4);
  if (!viewshed.isSiteWithinCoverage || viewshed.nRings <= 0 || viewshed.nAzimuths <= 0) {
    return rgba;
  }

  const half = (size - 1) * 0.5;
  const azStepDeg = 360 / viewshed.nAzimuths;
  const sinrField = showContours ? new Float32Array(size * size) : null;
  if (sinrField) sinrField.fill(Number.NaN);

  const SINR_MIN = -15.0;
  const SINR_MAX = 30.0;
  const SINR_SPAN = SINR_MAX - SINR_MIN;

  for (let y = 0; y < size; y++) {
    const ny = (half - y) / Math.max(1, half);
    for (let x = 0; x < size; x++) {
      const nx = (x - half) / Math.max(1, half);
      const rNorm = Math.hypot(nx, ny);
      const p = (y * size + x) * 4;
      if (rNorm > 1.0) {
        rgba[p + 3] = 0;
        continue;
      }

      const distM = rNorm * viewshed.radiusM;
      const azDeg = ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360;
      const azFloat = azDeg / azStepDeg;
      const rFloat = Math.max(0, distM / viewshed.stepM - 1);
      const sinrDb = samplePolarBilinear(viewshed.sinrGrid, viewshed.nAzimuths, viewshed.nRings, azFloat, rFloat);

      if (!Number.isFinite(sinrDb)) {
        rgba[p + 3] = 0;
        continue;
      }

      if (sinrField) sinrField[y * size + x] = sinrDb;

      const t = (sinrDb - SINR_MIN) / SINR_SPAN;
      const rgb = samplePaletteRgb(palette, t);
      const edgeFade = rNorm > 0.94 ? Math.max(0, (1.0 - rNorm) / 0.06) : 1.0;
      // Slightly higher opacity for strong signal & clear ridge shadows, soft feather at outer rim
      const baseAlpha = sinrDb < 0 ? 158 : 192;

      rgba[p] = rgb[0];
      rgba[p + 1] = rgb[1];
      rgba[p + 2] = rgb[2];
      rgba[p + 3] = Math.round(baseAlpha * edgeFade);
    }
  }

  // Subtle crisp iso-dB contour lines at 0 dB (Outage boundary), +10 dB (16-QAM), +18 dB (64-QAM)
  if (sinrField) {
    const levels = [0.0, 10.0, 18.0];
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = y * size + x;
        const v = sinrField[idx];
        if (!Number.isFinite(v)) continue;
        const vr = sinrField[idx + 1];
        const vd = sinrField[idx + size];
        if (!Number.isFinite(vr) || !Number.isFinite(vd)) continue;

        let hitLevel = -1;
        for (let li = 0; li < levels.length; li++) {
          const lv = levels[li];
          if ((v < lv && (vr >= lv || vd >= lv)) || (v >= lv && (vr < lv || vd < lv))) {
            hitLevel = li;
            break;
          }
        }
        if (hitLevel >= 0) {
          const p = idx * 4;
          if (rgba[p + 3] > 20) {
            const blend = hitLevel === 0 ? 0.55 : 0.42;
            rgba[p] = Math.round(rgba[p] * (1 - blend) + 245 * blend);
            rgba[p + 1] = Math.round(rgba[p + 1] * (1 - blend) + 250 * blend);
            rgba[p + 2] = Math.round(rgba[p + 2] * (1 - blend) + 255 * blend);
            rgba[p + 3] = Math.min(235, rgba[p + 3] + 35);
          }
        }
      }
    }
  }

  return rgba;
}

export function renderProbeHeatmapCanvas(
  viewshed: SiteProbeViewshedResult,
  targetCanvas?: HTMLCanvasElement,
  size: number = 320,
  opts: ProbeHeatmapEncodeOptions = {},
): HTMLCanvasElement {
  const canvas = targetCanvas ?? document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(size, size);
  img.data.set(encodeProbeSignalHeatmapRgba(viewshed, size, opts));
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function renderViewshedCanvas(
  viewshed: SiteProbeViewshedResult,
  targetCanvas?: HTMLCanvasElement,
  size: number = 256,
): HTMLCanvasElement {
  const canvas = targetCanvas ?? document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(size, size);
  img.data.set(encodeViewshedRgba(viewshed, size));
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Rasterizes Mode 4 Bridge Finder bottleneck SNR grid into an RGBA buffer.
 */
export function encodeBridgeHeatmapRgba(bridge: BridgeFinderResult): Uint8ClampedArray {
  const w = bridge.gridWidth;
  const h = bridge.gridHeight;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const val = bridge.bottleneckSnrGrid[i];
    const p = i * 4;
    if (!Number.isFinite(val)) {
      rgba[p + 3] = 0;
      continue;
    }
    if (val <= -900) {
      // Masked / shadowed cell
      rgba[p] = 116;
      rgba[p + 1] = 124;
      rgba[p + 2] = 136;
      rgba[p + 3] = 55;
      continue;
    }
    const t = Math.max(0, Math.min(1, (val + 1.5) / 26.5));
    const rgb = t < 0.5
      ? lerpRgb([224, 83, 71], [233, 196, 106], t * 2)
      : lerpRgb([233, 196, 106], [82, 183, 136], (t - 0.5) * 2);
    rgba[p] = rgb[0];
    rgba[p + 1] = rgb[1];
    rgba[p + 2] = rgb[2];
    rgba[p + 3] = 185;
  }
  return rgba;
}

export function renderBridgeHeatmapCanvas(
  bridge: BridgeFinderResult,
  targetCanvas?: HTMLCanvasElement,
): HTMLCanvasElement {
  const canvas = targetCanvas ?? document.createElement('canvas');
  canvas.width = bridge.gridWidth;
  canvas.height = bridge.gridHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(bridge.gridWidth, bridge.gridHeight);
  img.data.set(encodeBridgeHeatmapRgba(bridge));
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Mode 3: 360-degree Polar Horizon Mask Chart (0 deg North top).
 */
export function renderPolarHorizonChart(
  canvas: HTMLCanvasElement,
  viewshed: SiteProbeViewshedResult | null,
): void {
  const cssW = canvas.clientWidth > 40 ? canvas.clientWidth : 280;
  const cssH = canvas.clientHeight > 40 ? canvas.clientHeight : 148;
  const ctx = prepareCanvasDpr(canvas, cssW, cssH);
  if (!ctx) return;

  ctx.fillStyle = HIGHLAND_THEME.substrate.void;
  ctx.fillRect(0, 0, cssW, cssH);

  if (!viewshed || !viewshed.isSiteWithinCoverage || viewshed.horizonMask.length === 0) {
    ctx.fillStyle = HIGHLAND_THEME.text.muted;
    ctx.font = `10px ${HIGHLAND_THEME.font.mono}`;
    ctx.textAlign = 'center';
    ctx.fillText(
      viewshed && !viewshed.isSiteWithinCoverage
        ? 'OUTSIDE DEM COVERAGE'
        : 'Pick a site on map to compute horizon mask',
      cssW * 0.5,
      cssH * 0.5,
    );
    return;
  }

  const cx = cssW * 0.5;
  const cy = cssH * 0.52;
  const maxR = Math.max(24, Math.min(cssW, cssH) * 0.39);
  const maxElevDeg = 45;

  // Elevation rings (15, 30, 45 deg)
  ctx.strokeStyle = HIGHLAND_THEME.line.gridMajor;
  ctx.lineWidth = 1;
  [15, 30, 45].forEach((deg) => {
    const r = (deg / maxElevDeg) * maxR;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Cardinal crosshairs & labels
  ctx.strokeStyle = HIGHLAND_THEME.line.grid;
  ctx.beginPath();
  ctx.moveTo(cx - maxR, cy);
  ctx.lineTo(cx + maxR, cy);
  ctx.moveTo(cx, cy - maxR);
  ctx.lineTo(cx, cy + maxR);
  ctx.stroke();

  ctx.fillStyle = HIGHLAND_THEME.text.faint;
  ctx.font = `9px ${HIGHLAND_THEME.font.mono}`;
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - maxR - 4);
  ctx.fillText('S', cx, cy + maxR + 10);
  ctx.textAlign = 'left';
  ctx.fillText('E', cx + maxR + 4, cy + 3);
  ctx.fillText('45°', cx + 3, cy - maxR + 10);
  ctx.textAlign = 'right';
  ctx.fillText('W', cx - maxR - 4, cy + 3);

  // Polar horizon polygon
  let peakBin = viewshed.horizonMask[0];
  ctx.beginPath();
  viewshed.horizonMask.forEach((bin, i) => {
    if (bin.horizonElevDeg > peakBin.horizonElevDeg) peakBin = bin;
    const clamped = Math.max(0, Math.min(maxElevDeg, bin.horizonElevDeg));
    const r = (clamped / maxElevDeg) * maxR;
    const theta = (bin.azimuthDeg * Math.PI) / 180 - Math.PI * 0.5;
    const px = cx + r * Math.cos(theta);
    const py = cy + r * Math.sin(theta);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = HIGHLAND_THEME.signal.vermilionSoft;
  ctx.fill();
  ctx.strokeStyle = HIGHLAND_THEME.signal.vermilion;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Peak azimuth marker
  const peakR = (Math.max(0, Math.min(maxElevDeg, peakBin.horizonElevDeg)) / maxElevDeg) * maxR;
  const peakTheta = (peakBin.azimuthDeg * Math.PI) / 180 - Math.PI * 0.5;
  ctx.fillStyle = HIGHLAND_THEME.signal.ochre;
  ctx.beginPath();
  ctx.arc(cx + peakR * Math.cos(peakTheta), cy + peakR * Math.sin(peakTheta), 3, 0, Math.PI * 2);
  ctx.fill();

  // ACN position marker
  if (viewshed.acnAzimuthDeg !== null && viewshed.acnElevationDeg !== null) {
    const acnR = (Math.max(0, Math.min(maxElevDeg, viewshed.acnElevationDeg)) / maxElevDeg) * maxR;
    const acnTheta = (viewshed.acnAzimuthDeg * Math.PI) / 180 - Math.PI * 0.5;
    const ax = cx + acnR * Math.cos(acnTheta);
    const ay = cy + acnR * Math.sin(acnTheta);
    ctx.fillStyle = HIGHLAND_THEME.signal.amberBright;
    ctx.beginPath();
    ctx.arc(ax, ay, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = HIGHLAND_THEME.substrate.void;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

/**
 * Mode 3: Dual-series UAV Altitude Optimization Sweep Chart (% Clear 0.6 F1 + Mean SNR dB).
 */
export function renderAltitudeSweepChart(
  canvas: HTMLCanvasElement,
  sweep: AltitudeSweepResult | null,
): void {
  const cssW = canvas.clientWidth > 40 ? canvas.clientWidth : 280;
  const cssH = canvas.clientHeight > 40 ? canvas.clientHeight : 130;
  const ctx = prepareCanvasDpr(canvas, cssW, cssH);
  if (!ctx) return;

  ctx.fillStyle = HIGHLAND_THEME.substrate.void;
  ctx.fillRect(0, 0, cssW, cssH);

  if (!sweep || !sweep.valid || sweep.altitudesM.length < 2) {
    ctx.fillStyle = HIGHLAND_THEME.text.muted;
    ctx.font = `10px ${HIGHLAND_THEME.font.mono}`;
    ctx.textAlign = 'center';
    ctx.fillText('No valid targets for altitude sweep', cssW * 0.5, cssH * 0.5);
    return;
  }

  const pad = { left: 32, right: 34, top: 14, bottom: 20 };
  const plotW = Math.max(20, cssW - pad.left - pad.right);
  const plotH = Math.max(20, cssH - pad.top - pad.bottom);
  const minAlt = sweep.altitudesM[0];
  const maxAlt = sweep.altitudesM[sweep.altitudesM.length - 1];
  const altSpan = Math.max(1, maxAlt - minAlt);

  const snrVals = sweep.meanSnrDb.filter((v): v is number => v !== null && Number.isFinite(v));
  const minSnr = snrVals.length ? Math.min(-5, Math.min(...snrVals)) : -5;
  const maxSnr = snrVals.length ? Math.max(25, Math.max(...snrVals)) : 25;
  const snrSpan = Math.max(5, maxSnr - minSnr);

  const xOf = (altM: number) => pad.left + ((altM - minAlt) / altSpan) * plotW;
  const yPct = (pct: number) => pad.top + (1 - pct / 100) * plotH;
  const ySnr = (snr: number) => pad.top + (1 - (snr - minSnr) / snrSpan) * plotH;

  // Grid
  ctx.strokeStyle = HIGHLAND_THEME.line.grid;
  ctx.lineWidth = 1;
  [0, 50, 100].forEach((p) => {
    const gy = yPct(p);
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(pad.left + plotW, gy);
    ctx.stroke();
    ctx.fillStyle = HIGHLAND_THEME.signal.sage;
    ctx.font = `8.5px ${HIGHLAND_THEME.font.mono}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${p}%`, pad.left - 3, gy + 3);
  });

  // Right SNR axis labels
  ctx.fillStyle = HIGHLAND_THEME.signal.amber;
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.round(maxSnr)}dB`, pad.left + plotW + 3, pad.top + 6);
  ctx.fillText(`${Math.round(minSnr)}dB`, pad.left + plotW + 3, pad.top + plotH);

  // Optimal vertical pins
  if (sweep.minClearAltitudeM !== null) {
    const mx = xOf(sweep.minClearAltitudeM);
    ctx.strokeStyle = HIGHLAND_THEME.signal.sageStrokeSoft;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(mx, pad.top);
    ctx.lineTo(mx, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (sweep.optimalSnrAltitudeM !== null) {
    const ox = xOf(sweep.optimalSnrAltitudeM);
    ctx.strokeStyle = HIGHLAND_THEME.signal.amberStrokeSoft;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(ox, pad.top);
    ctx.lineTo(ox, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Clear LOS % series (sage)
  ctx.strokeStyle = HIGHLAND_THEME.signal.sage;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  sweep.altitudesM.forEach((alt, i) => {
    const px = xOf(alt);
    const py = yPct(sweep.clearLosPct[i]);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // Mean SNR series (amber)
  ctx.strokeStyle = HIGHLAND_THEME.signal.amber;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  let started = false;
  sweep.altitudesM.forEach((alt, i) => {
    const snr = sweep.meanSnrDb[i];
    if (snr === null || !Number.isFinite(snr)) return;
    const px = xOf(alt);
    const py = ySnr(snr);
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else {
      ctx.lineTo(px, py);
    }
  });
  ctx.stroke();

  // Frame & X labels
  ctx.strokeStyle = HIGHLAND_THEME.line.frame;
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, plotW, plotH);

  ctx.fillStyle = HIGHLAND_THEME.text.faint;
  ctx.font = `9px ${HIGHLAND_THEME.font.mono}`;
  ctx.textAlign = 'left';
  ctx.fillText(`${(minAlt / 1000).toFixed(1)} km`, pad.left, cssH - 5);
  ctx.textAlign = 'right';
  ctx.fillText(`${(maxAlt / 1000).toFixed(1)} km`, pad.left + plotW, cssH - 5);
}

