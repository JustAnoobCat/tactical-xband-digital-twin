/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * 2D Cartographic Overlays Renderer (SPEC-V3-06)
 *
 * Renders:
 * 1. Dynamic Metric Scale Bar with 1-2-5 cartographic steps (100m–50km) in bottom-center.
 * 2. True North Compass Rose dial in top-right.
 * 3. Optional MGRS Tactical Coordinate Grid overlay with 10km/20km ticks and square labels.
 *
 * Uses Zero-Allocation Matte Lattice Obsidian Canvas Palette (src/ui/canvasTheme.ts).
 */

import { getLatticeCanvasPalette, type CanvasCvdMode } from './canvasTheme';
import { geodeticToMgrs } from '../core/militaryGisEngine';
import { cartesianToGeodetic } from '../core/geodesy';

const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

export interface CartographicScaleBarStep {
  readonly stepM: number;
  readonly barWidthPx: number;
  readonly labelFull: string;
  readonly labelHalf: string;
}

export interface CartographicOverlayParams {
  readonly width: number;
  readonly height: number;
  readonly metersPerPixel: number;
  readonly showMgrsGrid?: boolean;
  readonly cvdMode?: CanvasCvdMode;
  readonly screenToWorld?: (sx: number, sy: number) => { x: number; y: number };
  readonly worldToScreen?: (wx: number, wy: number) => { x: number; y: number };
}

/** Predefined 1-2-5 cartographic metric steps in metres. */
const NICE_SCALE_STEPS_M = [
  50, 100, 200, 500,
  1000, 2000, 5000,
  10000, 20000, 50000,
  100000, 200000, 500000,
  1000000, 2000000, 5000000, 10000000,
];

/**
 * Selects an aesthetically balanced 1-2-5 metric scale bar step so the bar
 * remains reliably between 50 px and 130 px wide on screen.
 */
export function computeNiceScaleBarLengthM(
  metersPerPixel: number,
  maxBarWidthPx: number = 120
): CartographicScaleBarStep {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return { stepM: 1000, barWidthPx: 100, labelFull: '1 km', labelHalf: '500 m' };
  }

  const targetM = metersPerPixel * maxBarWidthPx;

  let bestStep = NICE_SCALE_STEPS_M[0];
  for (let i = 0; i < NICE_SCALE_STEPS_M.length; i++) {
    if (NICE_SCALE_STEPS_M[i] <= targetM) {
      bestStep = NICE_SCALE_STEPS_M[i];
    } else {
      break;
    }
  }

  // Format clean labels
  const formatM = (m: number): string => {
    if (m >= 1000) {
      const km = m / 1000;
      return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)} km`;
    }
    return `${Math.round(m)} m`;
  };

  const barWidthPx = Math.max(30, bestStep / metersPerPixel);

  return {
    stepM: bestStep,
    barWidthPx,
    labelFull: formatM(bestStep),
    labelHalf: formatM(bestStep / 2),
  };
}

/**
 * Draws crisp cartographic telemetry overlays on the 2D tactical radar display.
 */
export function drawCartographicOverlays(
  ctx: CanvasRenderingContext2D,
  params: CartographicOverlayParams
): void {
  const {
    width: w,
    height: h,
    metersPerPixel: mpp,
    showMgrsGrid = false,
    cvdMode,
    screenToWorld,
    worldToScreen,
  } = params;

  if (w <= 0 || h <= 0 || !Number.isFinite(mpp) || mpp <= 0) return;

  const palette = getLatticeCanvasPalette(cvdMode);

  ctx.save();

  // ==========================================================================
  // 1. Optional MGRS Tactical Coordinate Grid
  // ==========================================================================
  if (showMgrsGrid && mpp < 5000 && screenToWorld && worldToScreen) {
    const topLeft = screenToWorld(0, 0);
    const botRight = screenToWorld(w, h);

    const minX = Math.min(topLeft.x, botRight.x);
    const maxX = Math.max(topLeft.x, botRight.x);
    const minY = Math.min(topLeft.y, botRight.y);
    const maxY = Math.max(topLeft.y, botRight.y);

    // Grid spacing based on zoom level: 10 km, 20 km, or 50 km
    let gridSpacingM = 20000.0;
    if (mpp < 100.0) gridSpacingM = 10000.0;
    if (mpp > 350.0) gridSpacingM = 50000.0;

    const startX = Math.floor(minX / gridSpacingM) * gridSpacingM;
    const startY = Math.floor(minY / gridSpacingM) * gridSpacingM;

    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = palette.gridMajor;
    ctx.fillStyle = palette.textMuted;
    ctx.font = `500 10px ${MONO_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Vertical grid lines
    for (let gx = startX; gx <= maxX; gx += gridSpacingM) {
      const scr = worldToScreen(gx, 0);
      if (scr.x >= 0 && scr.x <= w) {
        ctx.beginPath();
        ctx.moveTo(scr.x, 0);
        ctx.lineTo(scr.x, h);
        ctx.stroke();

        // Sample geodetic coordinate to format MGRS tag
        try {
          const geo = cartesianToGeodetic(gx, maxY);
          const mgrs = geodeticToMgrs(geo.latDeg, geo.lonDeg, 2);
          ctx.fillText(mgrs.slice(0, 6), scr.x + 3, 24);
        } catch {
          // outside valid bounds
        }
      }
    }

    // Horizontal grid lines
    for (let gy = startY; gy <= maxY; gy += gridSpacingM) {
      const scr = worldToScreen(0, gy);
      if (scr.y >= 0 && scr.y <= h) {
        ctx.beginPath();
        ctx.moveTo(0, scr.y);
        ctx.lineTo(w, scr.y);
        ctx.stroke();

        try {
          const geo = cartesianToGeodetic(minX, gy);
          const mgrs = geodeticToMgrs(geo.latDeg, geo.lonDeg, 2);
          ctx.fillText(mgrs.slice(0, 6), 8, scr.y + 3);
        } catch {
          // outside valid bounds
        }
      }
    }

    ctx.setLineDash([]);
  }

  // ==========================================================================
  // 2. True North Compass Rose (Top-Right)
  // ==========================================================================
  const roseX = w - 42;
  const roseY = 46;
  const roseR = 15;

  ctx.beginPath();
  ctx.arc(roseX, roseY, roseR + 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8, 10, 13, 0.75)';
  ctx.fill();
  ctx.strokeStyle = palette.gridMajor;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Cardinal cross ticks
  ctx.strokeStyle = palette.axisStroke;
  ctx.beginPath();
  ctx.moveTo(roseX, roseY - roseR);
  ctx.lineTo(roseX, roseY + roseR);
  ctx.moveTo(roseX - roseR, roseY);
  ctx.lineTo(roseX + roseR, roseY);
  ctx.stroke();

  // North pointer arrow (Upper arrowhead)
  ctx.beginPath();
  ctx.moveTo(roseX, roseY - roseR - 1);
  ctx.lineTo(roseX + 4, roseY - 2);
  ctx.lineTo(roseX, roseY);
  ctx.closePath();
  ctx.fillStyle = palette.accent;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(roseX, roseY - roseR - 1);
  ctx.lineTo(roseX - 4, roseY - 2);
  ctx.lineTo(roseX, roseY);
  ctx.closePath();
  ctx.fillStyle = palette.textSecondary;
  ctx.fill();

  // South pointer (Lower subdued arrowhead)
  ctx.beginPath();
  ctx.moveTo(roseX, roseY + roseR + 1);
  ctx.lineTo(roseX + 3, roseY + 2);
  ctx.lineTo(roseX, roseY);
  ctx.closePath();
  ctx.fillStyle = palette.gridMajor;
  ctx.fill();

  // North 'N' letter
  ctx.font = `700 10.5px ${MONO_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = palette.accent;
  ctx.fillText('N', roseX, roseY - roseR - 3);

  // ==========================================================================
  // 3. Dynamic Metric Scale Bar (Bottom-Right, left of Layers button)
  // ==========================================================================
  const scaleStep = computeNiceScaleBarLengthM(mpp, 120);
  const barW = scaleStep.barWidthPx;
  const barH = 5;
  const padX = 14;
  const padY = 16;
  const barX = Math.max(24, Math.round(w - 146 - barW - padX));
  const barY = h - 22;

  // Backdrop pill
  ctx.fillStyle = 'rgba(8, 10, 13, 0.85)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.fillRect(barX - padX, barY - padY, barW + padX * 2, barH + padY + 4);
  ctx.strokeRect(barX - padX, barY - padY, barW + padX * 2, barH + padY + 4);

  // Alternating segments
  const halfW = barW / 2;

  // Segment 1 (Left 0..50%): Accent solid
  ctx.fillStyle = palette.accent;
  ctx.fillRect(barX, barY, halfW, barH);

  // Segment 2 (Right 50%..100%): Neutral / cardBg
  ctx.fillStyle = palette.textPrimary;
  ctx.fillRect(barX + halfW, barY, halfW, barH);

  // Scale bar outline
  ctx.strokeStyle = palette.voidBg;
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);

  // Scale bar labels (0, Half, Full)
  ctx.font = `600 10px ${MONO_FONT}`;
  ctx.fillStyle = palette.textPrimary;
  ctx.textBaseline = 'bottom';

  ctx.textAlign = 'left';
  ctx.fillText('0', barX, barY - 2);

  ctx.textAlign = 'center';
  ctx.fillText(scaleStep.labelHalf, barX + halfW, barY - 2);

  ctx.textAlign = 'right';
  ctx.fillText(scaleStep.labelFull, barX + barW, barY - 2);

  ctx.restore();
}
