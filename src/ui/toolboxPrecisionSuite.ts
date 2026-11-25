/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Precision Toolbox Suite — Flagship CAD / GIS / RF-Studio UI & Canvas Overlays
 *
 * Provides pure, unit-tested geometry & instrument helpers, DEM quick-switch presets,
 * flagship sidebar instrument mounts, and precision canvas overlays for all 5 tools:
 *  - Tool 0 (DEM / Navigate): ArcGIS Pro Basemap Gallery + Instant DEM Quick-Switch
 *  - Tool 1 (Ruler / Transect): AutoCAD MEASUREGEOM dynamic input, ΔX/ΔY tracking legs, polar arc, scale ticks
 *  - Tool 2 (Probe): Keysight FieldFox RF Link Meter, 360° horizon compass rose, ACN ray, M1/ΔM2 comparison
 *  - Tool 3 (Area / Region): QGIS Zonal Coverage Composition Bar, Pix4D quick-AO presets, 8x8 heatmap & summit/valley markers
 *  - Tool 4 (Barrier / Obstacle): SketchUp Shape/Material/Push-Pull Tray, 2.5D extrusion shadow, CAD hatch & V1/V2 grips
 */

import type { RadarPoint2D, RadarViewport } from './controllers/radar2dRenderer';
import { cartesianToGeodetic } from '../core/geodesy';
import { azimuthToCardinal16 } from '../core/rfPropagationMath';
import { evaluateCursorRfProbe } from '../core/cursorProbeEngine';
import { generatePerpendicularLinkSlicerObstacle } from '../core/cadObstacleSlicerEngine';
import { sampleDemSafe, type HorizonMaskBin, type SiteProbeViewshedResult } from './terrainToolboxAnalysis';
import {
  sampleProbeSignalAtWorldPoint,
  type ProbeHeatmapLayerMode,
  type ProbeHeatmapPalette,
} from './terrainToolboxCharts';
import { buildNodeAddCommand } from './nodeInventory';
import {
  createWorkspaceTilesManager,
  type WorkspaceTilesManager,
  type WorkspaceTilesTelemetryInput,
  type WorkspaceTileId,
} from './workspaceTilesManager';

export interface ProbeHeatmapConfig {
  readonly enabled: boolean;
  readonly mode: ProbeHeatmapLayerMode;
  readonly palette: ProbeHeatmapPalette;
  readonly opacity: number;
  readonly showContours: boolean;
}

const TAU = Math.PI * 2;
const MONO = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace";

// ============================================================================
// Tool 0: DEM Quick-Switch Presets (Ladakh Alpine, Kargil Corridor, Thar Desert)
// ============================================================================

export type DemQuickPresetId = 'ladakh' | 'kargil' | 'arid_desert';

export interface DemQuickPreset {
  readonly id: DemQuickPresetId;
  readonly label: string;
  readonly shortSubtitle: string;
  readonly sectorValue: string;
  readonly terrainMode: 'real' | 'synthetic';
  readonly biomeId: 'alpine_mountain' | 'arid_desert';
  readonly coordsLabel: string;
  readonly reliefLabel: string;
}

export const DEM_QUICK_PRESETS: readonly DemQuickPreset[] = Object.freeze([
  Object.freeze({
    id: 'ladakh',
    label: 'Ladakh Alpine',
    shortSubtitle: '34.5°N · Real SRTM',
    sectorValue: 'ladakh',
    terrainMode: 'real',
    biomeId: 'alpine_mountain',
    coordsLabel: '34.5°N, 76.5°E',
    reliefLabel: '3.2–5.7 km Alpine',
  }),
  Object.freeze({
    id: 'kargil',
    label: 'Kargil Corridor',
    shortSubtitle: 'Ridge Occlusion',
    sectorValue: 'kargil',
    terrainMode: 'synthetic',
    biomeId: 'alpine_mountain',
    coordsLabel: '34.5°N, 76.1°E',
    reliefLabel: 'Steep Valley Crest',
  }),
  Object.freeze({
    id: 'arid_desert',
    label: 'Thar Desert',
    shortSubtitle: '27.0°N · Arid Dunes',
    sectorValue: 'arid_desert',
    terrainMode: 'synthetic',
    biomeId: 'arid_desert',
    coordsLabel: '27.0°N, 71.5°E',
    reliefLabel: 'Low-Relief / Dust RF',
  }),
]);

export function resolveDemQuickPresetById(id: string | null | undefined): DemQuickPreset | null {
  if (!id) return null;
  const normalized = id.trim().toLowerCase();
  if (normalized === 'ladakh' || normalized === 'alpine_mountain') {
    return DEM_QUICK_PRESETS[0];
  }
  if (normalized === 'kargil' || normalized === 'kargil_corridor') {
    return DEM_QUICK_PRESETS[1];
  }
  if (normalized === 'arid_desert' || normalized === 'thar' || normalized === 'thar_desert') {
    return DEM_QUICK_PRESETS[2];
  }
  return null;
}

export function resolveDemQuickPresetFromSector(sectorValue: string | null | undefined): DemQuickPresetId | null {
  const preset = resolveDemQuickPresetById(sectorValue);
  return preset ? preset.id : null;
}

// ============================================================================
// Pure Geometry & Instrument Helpers (Unit-Tested)
// ============================================================================

export interface AutoCadTickMark {
  readonly x: number;
  readonly y: number;
  readonly nx: number;
  readonly ny: number;
  readonly major: boolean;
  readonly label: string | null;
}

export interface AutoCadDimensionGeometry {
  readonly screenLengthPx: number;
  readonly angleRad: number;
  readonly textAngleRad: number;
  readonly midX: number;
  readonly midY: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly tickStepM: number;
  readonly ticks: readonly AutoCadTickMark[];
}

export function computeAutoCadDimensionGeometry(
  p1: RadarPoint2D,
  p2: RadarPoint2D,
  worldDistanceM: number,
  includeTicks: boolean
): AutoCadDimensionGeometry {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const screenLengthPx = Math.hypot(dx, dy);
  const angleRad = Math.atan2(dy, dx);

  let textAngleRad = angleRad;
  if (textAngleRad > Math.PI / 2) textAngleRad -= Math.PI;
  if (textAngleRad < -Math.PI / 2) textAngleRad += Math.PI;

  const ux = screenLengthPx > 1e-3 ? dx / screenLengthPx : 1;
  const uy = screenLengthPx > 1e-3 ? dy / screenLengthPx : 0;
  const normalX = -uy;
  const normalY = ux;

  const candidates = [100, 250, 500, 1000, 2000, 5000, 10000, 25000];
  let tickStepM = 1000;
  if (Number.isFinite(worldDistanceM) && worldDistanceM > 1) {
    const rawStep = worldDistanceM / 8;
    tickStepM = candidates.find((c) => c >= rawStep) ?? 25000;
  }

  const ticks: AutoCadTickMark[] = [];
  if (includeTicks && screenLengthPx >= 36 && Number.isFinite(worldDistanceM) && worldDistanceM > tickStepM) {
    const count = Math.min(40, Math.floor(worldDistanceM / tickStepM));
    for (let i = 1; i <= count; i++) {
      const distM = i * tickStepM;
      const frac = distM / worldDistanceM;
      if (frac >= 0.98) break;
      const major = i % 2 === 0 || count <= 5;
      ticks.push({
        x: p1.x + dx * frac,
        y: p1.y + dy * frac,
        nx: normalX,
        ny: normalY,
        major,
        label: major
          ? distM >= 1000
            ? `${(distM / 1000).toFixed(distM % 1000 === 0 ? 0 : 1)}k`
            : `${Math.round(distM)}m`
          : null,
      });
    }
  }

  return {
    screenLengthPx,
    angleRad,
    textAngleRad,
    midX: (p1.x + p2.x) * 0.5,
    midY: (p1.y + p2.y) * 0.5,
    normalX,
    normalY,
    tickStepM,
    ticks,
  };
}

export interface AutoCadOrthogonalDelta {
  readonly deltaXM: number;
  readonly deltaYM: number;
  readonly deltaZM: number;
  readonly dist2dM: number;
  readonly slant3dM: number;
  readonly azimuthDeg: number;
}

export function computeAutoCadOrthogonalDelta(
  p1: { readonly xM: number; readonly yM: number },
  p2: { readonly xM: number; readonly yM: number },
  z1M = 0,
  z2M = 0
): AutoCadOrthogonalDelta {
  const deltaXM = p2.xM - p1.xM;
  const deltaYM = p2.yM - p1.yM;
  const deltaZM = z2M - z1M;
  const dist2dM = Math.hypot(deltaXM, deltaYM);
  const slant3dM = Math.hypot(dist2dM, deltaZM);
  const azimuthDeg = (((Math.atan2(deltaXM, deltaYM) * 180) / Math.PI) % 360 + 360) % 360;
  return { deltaXM, deltaYM, deltaZM, dist2dM, slant3dM, azimuthDeg };
}

export function computeVertexInteriorAngleDeg(
  prev: { readonly xM: number; readonly yM: number },
  vertex: { readonly xM: number; readonly yM: number },
  next: { readonly xM: number; readonly yM: number }
): number | null {
  const ux = prev.xM - vertex.xM;
  const uy = prev.yM - vertex.yM;
  const vx = next.xM - vertex.xM;
  const vy = next.yM - vertex.yM;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < 1e-6 || lv < 1e-6) return null;
  const cosTheta = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

export function resolveRulerElevationDeltaM(
  rm?: ToolboxPrecisionSnapshot['rulerMetrics']
): number | null {
  const val =
    rm?.groundElevationDeltaM ??
    rm?.deltaZM ??
    rm?.antennaElevationDeltaM ??
    rm?.elevationDeltaM;
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

export function resolveRulerSlantDistanceM(
  rm?: ToolboxPrecisionSnapshot['rulerMetrics']
): number | null {
  const val = rm?.slantDistance3DM ?? rm?.d3dM ?? rm?.slantDistanceM;
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

export interface RfSinrMeterState {
  readonly fillPct: number;
  readonly tone: 'clear' | 'marginal' | 'shadowed';
  readonly bandLabel: string;
  readonly statusLabel: string;
}

export function computeRfSinrMeterState(sinrDb: number | null | undefined, isLos = true): RfSinrMeterState {
  if (!Number.isFinite(sinrDb as number)) {
    return { fillPct: 0, tone: 'marginal', bandLabel: 'STANDBY', statusLabel: 'NO PROBE' };
  }
  const s = sinrDb as number;
  const clamped = Math.max(-10, Math.min(30, s));
  const fillPct = ((clamped + 10) / 40) * 100;
  if (!isLos || s < -1.5) {
    return {
      fillPct: Math.max(4, fillPct),
      tone: 'shadowed',
      bandLabel: 'OUTAGE',
      statusLabel: !isLos ? 'SHADOWED' : 'BELOW FLOOR',
    };
  }
  if (s < 2.5) {
    return { fillPct, tone: 'marginal', bandLabel: 'π/2-BPSK', statusLabel: 'LOW MARGIN' };
  }
  if (s < 8.0) {
    return { fillPct, tone: 'marginal', bandLabel: 'QPSK', statusLabel: 'MARGINAL' };
  }
  if (s < 11.5) {
    return { fillPct, tone: 'clear', bandLabel: '8-PSK', statusLabel: 'CLEAR LINK' };
  }
  if (s < 22.0) {
    return { fillPct, tone: 'clear', bandLabel: '16-APSK', statusLabel: 'CLEAR LINK' };
  }
  return { fillPct, tone: 'clear', bandLabel: '64-APSK', statusLabel: 'HIGH MARGIN' };
}

export interface QgisCoverageBreakdown {
  readonly clearPct: number;
  readonly marginalPct: number;
  readonly deadZonePct: number;
}

export function computeQgisCoverageBreakdown(
  losCoveragePct: number | null | undefined,
  deadZonePct: number | null | undefined
): QgisCoverageBreakdown {
  if (!Number.isFinite(losCoveragePct as number) && !Number.isFinite(deadZonePct as number)) {
    return { clearPct: 0, marginalPct: 0, deadZonePct: 0 };
  }
  const los = Math.max(0, Math.min(100, Number(losCoveragePct ?? 0)));
  const dead = Math.max(0, Math.min(100, Number(deadZonePct ?? Math.max(0, 100 - los))));
  const clear = Math.max(0, Math.min(100 - dead, los));
  const marginal = Math.max(0, 100 - clear - dead);
  return { clearPct: clear, marginalPct: marginal, deadZonePct: dead };
}

export interface AoSwathEdgeDimensions {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly widthKm: number;
  readonly heightKm: number;
  readonly areaKm2: number;
}

export function computeAoSwathEdgeDimensions(
  box: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
): AoSwathEdgeDimensions {
  const minX = Math.min(box.x1, box.x2);
  const maxX = Math.max(box.x1, box.x2);
  const minY = Math.min(box.y1, box.y2);
  const maxY = Math.max(box.y1, box.y2);
  const widthKm = (maxX - minX) / 1000;
  const heightKm = (maxY - minY) / 1000;
  return {
    minX,
    maxX,
    minY,
    maxY,
    widthKm,
    heightKm,
    areaKm2: widthKm * heightKm,
  };
}

export interface CadBarrierStyle {
  readonly stroke: string;
  readonly fill: string;
  readonly hatch: string;
  readonly label: string;
}

export function getCadBarrierMaterialStyle(material: string | undefined): CadBarrierStyle {
  switch ((material || '').toLowerCase()) {
    case 'concrete':
      return {
        stroke: '#f59e0b',
        fill: 'rgba(245, 158, 11, 0.24)',
        hatch: 'rgba(251, 191, 36, 0.45)',
        label: 'CONCRETE 35dB',
      };
    case 'foliage':
      return {
        stroke: '#34d399',
        fill: 'rgba(52, 211, 153, 0.22)',
        hatch: 'rgba(110, 231, 183, 0.42)',
        label: 'FOLIAGE 0.25dB/m',
      };
    default:
      return {
        stroke: '#38bdf8',
        fill: 'rgba(56, 189, 248, 0.24)',
        hatch: 'rgba(125, 211, 252, 0.42)',
        label: 'GRANITE OPAQUE',
      };
  }
}

export function computeCadExtrusionShadowOffset(heightM: number): { readonly dxPx: number; readonly dyPx: number } {
  const h = Math.max(20, Math.min(2000, Number.isFinite(heightM) ? heightM : 200));
  const scale = 3 + (h / 1000) * 9;
  return { dxPx: Math.round(scale * 10) / 10, dyPx: Math.round(scale * 0.85 * 10) / 10 };
}

/**
 * Computes obstacle cuboid rotationDeg matching src/core/obstacles.ts & getObstacleEndpoints():
 * local +Y depth axis points along (-sin(rotRad), cos(rotRad)).
 */
export function computeBarrierWallRotationDeg(
  pA: { readonly x: number; readonly y: number },
  pB: { readonly x: number; readonly y: number }
): number {
  const dx = pB.x - pA.x;
  const dy = pB.y - pA.y;
  if (Math.hypot(dx, dy) < 1e-6) return 0;
  return (((Math.atan2(-dx, dy) * 180) / Math.PI) % 360 + 360) % 360;
}

/**
 * Normalizes raw worker telemetry node records into the strict shape expected by evaluateBarrierLinkIntersections().
 */
export function normalizeBarrierTelemetryNodes(rawNodes: readonly any[]): Array<{
  readonly nodeId: number;
  readonly xM: number;
  readonly yM: number;
  readonly zMslM?: number;
  readonly groundElevM?: number;
  readonly aglM?: number;
}> {
  const out: Array<{
    readonly nodeId: number;
    readonly xM: number;
    readonly yM: number;
    readonly zMslM?: number;
    readonly groundElevM?: number;
    readonly aglM?: number;
  }> = [];
  for (const n of rawNodes || []) {
    if (!n) continue;
    const nodeId = Number(n.nodeId ?? n.node_id);
    const xM = Number(n.xM ?? n.x_m ?? n.position?.[0]);
    const yM = Number(n.yM ?? n.y_m ?? n.position?.[1]);
    if (!Number.isFinite(nodeId) || !Number.isFinite(xM) || !Number.isFinite(yM)) continue;
    const zRaw = Number(n.zMslM ?? n.position?.[2]);
    const gRaw = Number(n.groundElevM ?? n.terrain_elevation_msl_m);
    const aglRaw = Number(n.aglM ?? n.agl_m ?? 2);
    out.push({
      nodeId,
      xM,
      yM,
      ...(Number.isFinite(zRaw) ? { zMslM: zRaw } : {}),
      ...(Number.isFinite(gRaw) ? { groundElevM: gRaw } : {}),
      aglM: Number.isFinite(aglRaw) ? aglRaw : 2,
    });
  }
  return out;
}

// ============================================================================
// Shared Micro-Drawing Primitives
// ============================================================================

function drawHudTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  opts: {
    borderColor?: string;
    textColor?: string;
    bgColor?: string;
    align?: 'left' | 'center' | 'right';
    fontSize?: number;
  } = {}
): void {
  const fontSize = opts.fontSize ?? 10;
  ctx.save();
  ctx.font = `600 ${fontSize}px ${MONO}`;
  const metrics = ctx.measureText(text);
  const padX = 6;
  const boxW = Math.ceil(metrics.width) + padX * 2;
  const boxH = fontSize + 7;

  let drawX = x;
  if (opts.align === 'center') drawX = x - boxW * 0.5;
  else if (opts.align === 'right') drawX = x - boxW;
  const drawY = y - boxH * 0.5;

  ctx.fillStyle = opts.bgColor ?? 'rgba(9, 11, 16, 0.92)';
  ctx.strokeStyle = opts.borderColor ?? 'rgba(56, 189, 248, 0.58)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(drawX, drawY, boxW, boxH, 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = opts.textColor ?? '#f1f5f9';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, drawX + padX, drawY + boxH * 0.5 + 0.5);
  ctx.restore();
}

function drawCadGripSquare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke = '#090b10'
): void {
  const half = size * 0.5;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.4;
  ctx.fillRect(x - half, y - half, size, size);
  ctx.strokeRect(x - half, y - half, size, size);
  ctx.restore();
}

// ============================================================================
// Tool 1 Renderer: AutoCAD MEASUREGEOM Dynamic Input Ruler Overlay
// ============================================================================

export function renderAutoCadRulerOverlay(
  ctx: CanvasRenderingContext2D,
  _w: number,
  _h: number,
  tbState: any,
  _viewport: RadarViewport,
  project: (xM: number, yM: number) => RadarPoint2D
): void {
  const waypoints = Array.isArray(tbState?.transectWaypoints) ? tbState.transectWaypoints : [];
  const rubberBand = tbState?.rubberBandPoint ?? null;
  if (waypoints.length === 0 && !rubberBand) return;

  const isLocked = waypoints.length >= 2 && !rubberBand;
  const activeMetrics = rubberBand ? (tbState?.rulerPreviewMetrics ?? tbState?.rulerMetrics) : tbState?.rulerMetrics;
  const activeEval = rubberBand ? (tbState?.rulerPreviewEval ?? tbState?.rulerEvaluation) : tbState?.rulerEvaluation;
  const showTicks = Boolean(tbState?.showRulerTicks);

  const worldChain: Array<{ xM: number; yM: number; label: string }> = waypoints.map((wp: any, idx: number) => ({
    xM: Number(wp.xM ?? wp.x ?? 0),
    yM: Number(wp.yM ?? wp.y ?? 0),
    label: String.fromCharCode(65 + (idx % 26)),
  }));
  if (rubberBand && waypoints.length >= 1) {
    worldChain.push({
      xM: Number(rubberBand.xM ?? rubberBand.x ?? 0),
      yM: Number(rubberBand.yM ?? rubberBand.y ?? 0),
      label: String.fromCharCode(65 + (waypoints.length % 26)),
    });
  }
  if (worldChain.length === 0) return;

  const screenChain = worldChain.map((pt) => ({ ...pt, sp: project(pt.xM, pt.yM) }));
  const isBlocked = activeEval && activeEval.isLineOfSightClear === false;
  const primaryColor = isBlocked ? '#f87171' : '#38bdf8';

  const isRulerActive =
    tbState?.activeMode === 'transect' ||
    tbState?.toolMode === 'transect-2pt' ||
    tbState?.toolMode === 'transect-poly' ||
    tbState?.toolMode === 'measure';

  ctx.save();

  // When user switches to another tool (Probe / Area / Barrier / Navigate), keep only a quiet reference line
  if (!isRulerActive) {
    if (screenChain.length >= 2) {
      ctx.strokeStyle = isBlocked ? 'rgba(248, 113, 113, 0.32)' : 'rgba(56, 189, 248, 0.32)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(screenChain[0].sp.x, screenChain[0].sp.y);
      for (let i = 1; i < screenChain.length; i++) ctx.lineTo(screenChain[i].sp.x, screenChain[i].sp.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    return;
  }

  // 1. Orthogonal ΔX / ΔY reference legs & live compass bearing arc (active segment)
  if (screenChain.length >= 2) {
    const activeSegIdx = screenChain.length - 2;
    const aW = screenChain[activeSegIdx];
    const bW = screenChain[activeSegIdx + 1];
    const a = aW.sp;
    const b = bW.sp;
    const dxPx = b.x - a.x;
    const dyPx = b.y - a.y;
    const lenPx = Math.hypot(dxPx, dyPx);

    if (Math.abs(dxPx) >= 28 && Math.abs(dyPx) >= 28) {
      const cornerX = b.x;
      const cornerY = a.y;
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(cornerX, cornerY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Subtle ΔX and ΔY micro-labels along reference legs
      const deltaXM = bW.xM - aW.xM;
      const deltaYM = bW.yM - aW.yM;
      ctx.font = `500 8.5px ${MONO}`;
      ctx.fillStyle = 'rgba(203, 213, 225, 0.78)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`ΔX ${(deltaXM / 1000).toFixed(1)}km`, (a.x + cornerX) * 0.5, cornerY + (dyPx >= 0 ? -9 : 9));
      ctx.textAlign = dxPx >= 0 ? 'left' : 'right';
      ctx.fillText(`ΔY ${(deltaYM / 1000).toFixed(1)}km`, cornerX + (dxPx >= 0 ? 6 : -6), (cornerY + b.y) * 0.5);
      ctx.restore();
    }

    // North reference ray + swept clockwise azimuth arc + high-contrast bearing HUD tag
    if (lenPx >= 34) {
      const rayLen = Math.min(54, Math.max(30, lenPx * 0.35));
      const arcRadius = Math.min(32, Math.max(20, lenPx * 0.22));
      const northAngle = -Math.PI / 2;
      const azDeg = Number.isFinite(activeMetrics?.azimuthDeg)
        ? activeMetrics.azimuthDeg
        : (((Math.atan2(bW.xM - aW.xM, bW.yM - aW.yM) * 180) / Math.PI) % 360 + 360) % 360;
      const oct = activeMetrics?.cardinalOctant || azimuthToCardinal16(azDeg);
      const sweepRad = (azDeg * Math.PI) / 180;
      const endAngle = northAngle + sweepRad;

      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x, a.y - rayLen);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.font = `600 8.5px ${MONO}`;
      ctx.fillStyle = 'rgba(203, 213, 225, 0.85)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', a.x, a.y - rayLen - 7);

      if (sweepRad > 0.02) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.88)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(a.x, a.y, arcRadius, northAngle, endAngle, false);
        ctx.stroke();
      }

      const midArcAngle = northAngle + sweepRad * 0.5;
      const tagDist = arcRadius + 22;
      drawHudTag(
        ctx,
        a.x + Math.cos(midArcAngle) * tagDist,
        a.y + Math.sin(midArcAngle) * tagDist,
        `${azDeg.toFixed(0)}° ${oct}`,
        {
          align: 'center',
          borderColor: 'rgba(56, 189, 248, 0.78)',
          textColor: '#bae6fd',
          fontSize: 9.5,
        }
      );
      ctx.restore();
    }
  }

  // 1b. Multi-Pt Polyline True Interior Bend Angles at Intermediate Vertices (B, C, ...)
  if (screenChain.length >= 3) {
    for (let i = 1; i < screenChain.length - 1; i++) {
      const prev = screenChain[i - 1];
      const curr = screenChain[i];
      const next = screenChain[i + 1];
      const bendDeg = computeVertexInteriorAngleDeg(prev, curr, next);
      if (bendDeg === null) continue;
      const lenPrev = Math.hypot(prev.sp.x - curr.sp.x, prev.sp.y - curr.sp.y);
      const lenNext = Math.hypot(next.sp.x - curr.sp.x, next.sp.y - curr.sp.y);
      if (lenPrev < 24 || lenNext < 24) continue;

      const ang1 = Math.atan2(prev.sp.y - curr.sp.y, prev.sp.x - curr.sp.x);
      const ang2 = Math.atan2(next.sp.y - curr.sp.y, next.sp.x - curr.sp.x);
      const diff = ((ang2 - ang1 + Math.PI * 3) % TAU) - Math.PI;
      const arcR = Math.min(24, Math.max(14, Math.min(lenPrev, lenNext) * 0.24));
      const bisect = ang1 + diff * 0.5;

      ctx.save();
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.88)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(curr.sp.x, curr.sp.y, arcR, ang1, ang1 + diff, diff < 0);
      ctx.stroke();
      drawHudTag(
        ctx,
        curr.sp.x + Math.cos(bisect) * (arcR + 18),
        curr.sp.y + Math.sin(bisect) * (arcR + 18),
        `${bendDeg.toFixed(1)}°`,
        {
          align: 'center',
          borderColor: 'rgba(251, 191, 36, 0.82)',
          textColor: '#fef3c7',
          fontSize: 9.5,
        }
      );
      ctx.restore();
    }
  }

  // 2. Render each segment with AutoCAD witness ticks, scale ticks & inline dimension HUD
  let totalWorldDistM = 0;
  for (let i = 0; i < screenChain.length - 1; i++) {
    const segA = screenChain[i];
    const segB = screenChain[i + 1];
    const segDistM = Math.hypot(segB.xM - segA.xM, segB.yM - segA.yM);
    totalWorldDistM += segDistM;
    const isPreviewSeg = Boolean(rubberBand && i === screenChain.length - 2);

    const geom = computeAutoCadDimensionGeometry(segA.sp, segB.sp, segDistM, showTicks);

    ctx.strokeStyle = 'rgba(6, 9, 14, 0.72)';
    ctx.lineWidth = isPreviewSeg ? 3.5 : 4.2;
    ctx.beginPath();
    ctx.moveTo(segA.sp.x, segA.sp.y);
    ctx.lineTo(segB.sp.x, segB.sp.y);
    ctx.stroke();

    ctx.strokeStyle = isPreviewSeg ? 'rgba(56, 189, 248, 0.88)' : primaryColor;
    ctx.lineWidth = isPreviewSeg ? 1.8 : 2.2;
    if (isPreviewSeg) ctx.setLineDash([7, 4]);
    ctx.beginPath();
    ctx.moveTo(segA.sp.x, segA.sp.y);
    ctx.lineTo(segB.sp.x, segB.sp.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // AutoCAD Architectural End Witness Ticks
    const ext = 8;
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(segA.sp.x - geom.normalX * ext, segA.sp.y - geom.normalY * ext);
    ctx.lineTo(segA.sp.x + geom.normalX * ext, segA.sp.y + geom.normalY * ext);
    ctx.moveTo(segB.sp.x - geom.normalX * ext, segB.sp.y - geom.normalY * ext);
    ctx.lineTo(segB.sp.x + geom.normalX * ext, segB.sp.y + geom.normalY * ext);
    ctx.stroke();

    // Graduated Engineering Scale Ticks
    if (geom.ticks.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.78)';
      ctx.fillStyle = '#cbd5e1';
      ctx.font = `500 8.5px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const t of geom.ticks) {
        const len = t.major ? 6 : 3.5;
        ctx.lineWidth = t.major ? 1.3 : 1;
        ctx.beginPath();
        ctx.moveTo(t.x - t.nx * len, t.y - t.ny * len);
        ctx.lineTo(t.x + t.nx * len, t.y + t.ny * len);
        ctx.stroke();
        if (t.label) {
          ctx.fillText(t.label, t.x + t.nx * 13, t.y + t.ny * 13);
        }
      }
      ctx.restore();
    }

    // Inline AutoCAD Dynamic Input Dimension Tag along midpoint
    if (geom.screenLengthPx >= 44) {
      const distStr = segDistM >= 1000 ? `${(segDistM / 1000).toFixed(2)} km` : `${Math.round(segDistM)} m`;
      const segAzDeg = (((Math.atan2(segB.xM - segA.xM, segB.yM - segA.yM) * 180) / Math.PI) % 360 + 360) % 360;
      let dimText = `${distStr} · ${segAzDeg.toFixed(1)}°`;
      if (i === screenChain.length - 2 && activeMetrics) {
        const az = Number.isFinite(activeMetrics.azimuthDeg) ? `${activeMetrics.azimuthDeg.toFixed(1)}°` : `${segAzDeg.toFixed(1)}°`;
        const grade = Number.isFinite(activeMetrics.gradePct)
          ? `${activeMetrics.gradePct >= 0 ? '+' : ''}${activeMetrics.gradePct.toFixed(1)}%`
          : '';
        const losTag = activeEval ? (activeEval.isLineOfSightClear ? 'LOS' : 'BLK') : '';
        dimText = [distStr, az, grade, losTag].filter(Boolean).join(' · ');
      }
      drawHudTag(ctx, geom.midX + geom.normalX * 16, geom.midY + geom.normalY * 16, dimText, {
        align: 'center',
        borderColor: isBlocked ? 'rgba(248, 113, 113, 0.75)' : 'rgba(56, 189, 248, 0.72)',
        textColor: isBlocked ? '#fecaca' : '#e0f2fe',
      });
    }
  }

  // 3. Synchronized Civil 3D Profile Hover Sample Marker
  const hoveredIdx = tbState?.hoveredSampleIdx;
  const hoverSample =
    typeof hoveredIdx === 'number' && Array.isArray(tbState?.transectResult?.samples)
      ? tbState.transectResult.samples[hoveredIdx]
      : null;
  if (hoverSample && Number.isFinite(hoverSample.xM) && Number.isFinite(hoverSample.yM)) {
    const hp = project(hoverSample.xM, hoverSample.yM);
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, 6, 0, TAU);
    ctx.stroke();
    drawHudTag(ctx, hp.x + 12, hp.y - 12, `${Math.round(hoverSample.terrainMslM)}m · Clr ${hoverSample.clearanceM.toFixed(0)}m`, {
      borderColor: 'rgba(251, 191, 36, 0.8)',
      textColor: '#fef3c7',
      fontSize: 9,
    });
    ctx.restore();
  }

  // 4. Blocking Ridge Peak Callout
  if (activeEval && activeEval.isLineOfSightClear === false && activeEval.blockingPeak) {
    const bp = activeEval.blockingPeak;
    const bpPt = project(bp.xM, bp.yM);
    ctx.save();
    ctx.translate(bpPt.x, bpPt.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ef4444';
    ctx.strokeStyle = '#090b10';
    ctx.lineWidth = 1.6;
    ctx.fillRect(-5, -5, 10, 10);
    ctx.strokeRect(-5, -5, 10, 10);
    ctx.restore();

    const intrusionStr = Number.isFinite(bp.intrusionM) ? `+${Math.round(bp.intrusionM)}m` : 'BLK';
    drawHudTag(ctx, bpPt.x + 12, bpPt.y - 12, `CREST ${intrusionStr}`, {
      borderColor: 'rgba(239, 68, 68, 0.82)',
      textColor: '#fecaca',
      fontSize: 9.5,
    });
  }

  // 5. Precision CAD Vertex Grips (A, B, C...) & OSNAP Indicator
  for (let i = 0; i < screenChain.length; i++) {
    const v = screenChain[i];
    const isTemp = Boolean(rubberBand && i === screenChain.length - 1);
    drawCadGripSquare(ctx, v.sp.x, v.sp.y, isTemp ? 7 : 8, isTemp ? '#bae6fd' : primaryColor);
    drawHudTag(ctx, v.sp.x + 10, v.sp.y - 10, v.label, {
      borderColor: primaryColor,
      textColor: '#f8fafc',
      fontSize: 9.5,
    });
  }

  const snap = tbState?.activeSnap;
  if (snap && snap.sp) {
    ctx.save();
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(snap.sp.x - 8, snap.sp.y - 8, 16, 16);
    drawHudTag(ctx, snap.sp.x + 12, snap.sp.y + 12, `OSNAP ${snap.label || ''}`.trim(), {
      borderColor: 'rgba(52, 211, 153, 0.8)',
      textColor: '#a7f3d0',
      fontSize: 9,
    });
    ctx.restore();
  }

  if (screenChain.length >= 3 && isLocked) {
    const last = screenChain[screenChain.length - 1].sp;
    drawHudTag(ctx, last.x + 12, last.y + 14, `TOTAL ${(totalWorldDistM / 1000).toFixed(2)} km`, {
      borderColor: 'rgba(56, 189, 248, 0.72)',
      textColor: '#bae6fd',
      fontSize: 9.5,
    });
  }

  ctx.restore();
}

// ============================================================================
// Tool 2 Renderer: Keysight FieldFox RF Field Analyzer Compass Rose & ACN Link
// ============================================================================

export function renderRfFieldProbeOverlay(
  ctx: CanvasRenderingContext2D,
  _w: number,
  _h: number,
  tbState: any,
  _viewport: RadarViewport,
  project: (xM: number, yM: number) => RadarPoint2D
): void {
  const probeSite = tbState?.probeSite;
  if (!probeSite) return;

  const isProbeActive = tbState?.activeMode === 'probe' || tbState?.toolMode === 'probe';
  const sp = project(probeSite.xM, probeSite.yM);
  const liveProbe = tbState?.cursorProbeLive ?? tbState?.probePinnedP1 ?? null;
  const pinnedP1 = tbState?.probePinnedP1 ?? null;
  const acnWorld = tbState?.acnPosWorld ?? null;

  ctx.save();

  // When user switches to Area / Barrier / Ruler, keep only a minimal unobtrusive P1 pin
  if (!isProbeActive) {
    ctx.strokeStyle = 'rgba(192, 132, 252, 0.72)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 5, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#c084fc';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 2, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }

  let acnDx = 1;
  let acnDy = -1;

  // 0. Outer RF Signal Propagation Perimeter Ring (when heat map is active)
  const vsRes = tbState?.viewshedResult as SiteProbeViewshedResult | null | undefined;
  const hmCfg = tbState?.probeHeatmapConfig as ProbeHeatmapConfig | null | undefined;
  const hmEnabled = hmCfg ? hmCfg.enabled !== false : true;
  if (hmEnabled && vsRes?.isSiteWithinCoverage && Number.isFinite(vsRes.radiusM) && vsRes.radiusM > 0) {
    const edgeEast = project(vsRes.siteXM + vsRes.radiusM, vsRes.siteYM);
    const edgeNorth = project(vsRes.siteXM, vsRes.siteYM + vsRes.radiusM);
    const rx = Math.abs(edgeEast.x - sp.x);
    const ry = Math.abs(sp.y - edgeNorth.y);
    if (rx >= 28 && ry >= 28) {
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.42)';
      ctx.lineWidth = 1.1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, rx, ry, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      const rKm = (vsRes.radiusM / 1000).toFixed(0);
      const txLabel = Number.isFinite(vsRes.txPowerDbm) ? `${Math.round(vsRes.txPowerDbm)} dBm` : '30 dBm';
      const modeLabel = hmCfg?.mode === 'viewshed' ? 'LoS' : 'RF · 8 GHz';
      drawHudTag(ctx, sp.x, sp.y - ry - 11, `${rKm} km ${modeLabel} · ${txLabel}`, {
        align: 'center',
        borderColor: 'rgba(148, 163, 184, 0.45)',
        textColor: '#cbd5e1',
        fontSize: 8.5,
      });
      ctx.restore();
    }
  }

  // 1. Live RF Propagation Ray from Probed Site to Airborne Relay (ACN) + Midpoint Slant/El Tag
  if (acnWorld && Number.isFinite(acnWorld.x) && Number.isFinite(acnWorld.y)) {
    const acnPt = project(acnWorld.x, acnWorld.y);
    acnDx = acnPt.x - sp.x;
    acnDy = acnPt.y - sp.y;
    const isLos = liveProbe?.isLos ?? liveProbe?.acnLink?.isLos ?? true;
    const rayColor = isLos ? 'rgba(52, 211, 153, 0.78)' : 'rgba(248, 113, 113, 0.82)';

    ctx.save();
    ctx.strokeStyle = rayColor;
    ctx.lineWidth = 1.6;
    ctx.setLineDash(isLos ? [6, 4] : [3, 4]);
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(acnPt.x, acnPt.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const rayLenPx = Math.hypot(acnDx, acnDy);
    if (rayLenPx >= 64 && Number.isFinite(liveProbe?.d3dKm)) {
      const midX = (sp.x + acnPt.x) * 0.5;
      const midY = (sp.y + acnPt.y) * 0.5;
      const elStr = Number.isFinite(liveProbe?.elToAcnDeg)
        ? ` · ${liveProbe.elToAcnDeg >= 0 ? '+' : ''}${liveProbe.elToAcnDeg.toFixed(1)}°`
        : '';
      drawHudTag(ctx, midX, midY - 14, `${liveProbe.d3dKm.toFixed(1)} km${elStr}`, {
        align: 'center',
        borderColor: rayColor,
        textColor: isLos ? '#a7f3d0' : '#fecaca',
        fontSize: 9,
      });
    }
    ctx.restore();
  }

  // 2. Delta Marker Vector (M1 -> ΔM2) when pinned reference differs from active probe
  if (
    pinnedP1 &&
    Number.isFinite(pinnedP1.xM) &&
    Number.isFinite(pinnedP1.yM) &&
    Math.hypot(pinnedP1.xM - probeSite.xM, pinnedP1.yM - probeSite.yM) > 100
  ) {
    const p1Sp = project(pinnedP1.xM, pinnedP1.yM);
    ctx.save();
    ctx.strokeStyle = 'rgba(192, 132, 252, 0.65)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(p1Sp.x, p1Sp.y);
    ctx.lineTo(sp.x, sp.y);
    ctx.stroke();
    ctx.setLineDash([]);
    drawCadGripSquare(ctx, p1Sp.x, p1Sp.y, 7, '#a855f7');
    drawHudTag(ctx, p1Sp.x + 10, p1Sp.y - 10, 'M1 REF', {
      borderColor: 'rgba(168, 85, 247, 0.7)',
      textColor: '#e9d5ff',
      fontSize: 8.5,
    });
    ctx.restore();
  }

  // 3. 360° Polar Horizon Mask Fill (if viewshed horizonMask bins exist) + Calibrated Compass Rose
  const rInner = 18;
  const rOuter = 40;
  const horizonMask: readonly HorizonMaskBin[] | undefined = vsRes?.horizonMask;
  if (Array.isArray(horizonMask) && horizonMask.length >= 12) {
    ctx.save();
    ctx.fillStyle = 'rgba(168, 85, 247, 0.14)';
    ctx.beginPath();
    for (let i = 0; i < horizonMask.length; i++) {
      const bin = horizonMask[i];
      const deg = Number.isFinite(bin?.azimuthDeg) ? bin.azimuthDeg : (i / horizonMask.length) * 360;
      const rad = ((deg - 90) * Math.PI) / 180;
      const elevDeg = Number.isFinite(bin?.horizonElevDeg) ? bin.horizonElevDeg : 0;
      const maskNorm = Math.max(0.12, Math.min(1, elevDeg / 30));
      const r = rInner + (rOuter - rInner) * maskNorm;
      const px = sp.x + Math.cos(rad) * r;
      const py = sp.y + Math.sin(rad) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(168, 85, 247, 0.78)';
  ctx.lineWidth = 1.3;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, rInner, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(168, 85, 247, 0.48)';
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, rOuter, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(192, 132, 252, 0.68)';
  ctx.lineWidth = 1;
  for (let deg = 0; deg < 360; deg += 30) {
    const rad = ((deg - 90) * Math.PI) / 180;
    const major = deg % 90 === 0;
    const r0 = major ? rOuter - 5 : rOuter - 3;
    const r1 = major ? rOuter + 4 : rOuter + 2;
    ctx.beginPath();
    ctx.moveTo(sp.x + Math.cos(rad) * r0, sp.y + Math.sin(rad) * r0);
    ctx.lineTo(sp.x + Math.cos(rad) * r1, sp.y + Math.sin(rad) * r1);
    ctx.stroke();
  }

  // Cardinal N/E/S/W compass rose micro-labels
  ctx.font = `600 8px ${MONO}`;
  ctx.fillStyle = 'rgba(216, 180, 254, 0.85)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', sp.x, sp.y - rOuter - 9);
  ctx.fillText('E', sp.x + rOuter + 9, sp.y);
  ctx.fillText('S', sp.x, sp.y + rOuter + 9);
  ctx.fillText('W', sp.x - rOuter - 9, sp.y);

  // Precision crosshair center
  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sp.x - 10, sp.y);
  ctx.lineTo(sp.x - 3, sp.y);
  ctx.moveTo(sp.x + 3, sp.y);
  ctx.lineTo(sp.x + 10, sp.y);
  ctx.moveTo(sp.x, sp.y - 10);
  ctx.lineTo(sp.x, sp.y - 3);
  ctx.moveTo(sp.x, sp.y + 3);
  ctx.lineTo(sp.x, sp.y + 10);
  ctx.stroke();

  ctx.fillStyle = '#c084fc';
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, 2.5, 0, TAU);
  ctx.fill();

  // 4. Inline RF Field Readout Callout — positioned cleanly below or above rose opposite ACN ray
  const sinrVal = liveProbe?.estSinrDb ?? liveProbe?.sinrDb ?? liveProbe?.acnLink?.snrDb ?? null;
  const modcod = liveProbe?.modcodName ?? liveProbe?.acnLink?.modcod ?? null;
  const elevM = liveProbe?.elevationM ?? liveProbe?.terrainMslM ?? null;

  const badgeParts = ['M1'];
  if (Number.isFinite(elevM)) badgeParts.push(`${Math.round(elevM)}m`);
  if (Number.isFinite(sinrVal)) badgeParts.push(`${sinrVal.toFixed(1)}dB`);
  if (typeof modcod === 'string' && modcod.length > 0 && modcod !== 'LINK_OUTAGE') {
    badgeParts.push(modcod.split(' ')[0]);
  }
  const isWeak = Number.isFinite(sinrVal) && sinrVal < 0;
  const tagY = acnDy <= 0 ? sp.y + rOuter + 24 : sp.y - rOuter - 24;
  drawHudTag(ctx, sp.x, tagY, badgeParts.join(' · '), {
    align: 'center',
    borderColor: isWeak ? 'rgba(248, 113, 113, 0.78)' : 'rgba(192, 132, 252, 0.82)',
    textColor: isWeak ? '#fecaca' : '#f3e8ff',
    fontSize: 9.5,
  });

  // 5. Live Cursor RF Heat Map Readout Tag (when hovering inside the active signal footprint)
  const cursorWorld = tbState?.cursorWorldPos;
  if (
    hmEnabled &&
    vsRes?.isSiteWithinCoverage &&
    cursorWorld &&
    Number.isFinite(cursorWorld.xM) &&
    Number.isFinite(cursorWorld.yM)
  ) {
    const sample = sampleProbeSignalAtWorldPoint(vsRes, cursorWorld.xM, cursorWorld.yM);
    if (sample && sample.distM > 250) {
      const cp = project(cursorWorld.xM, cursorWorld.yM);
      const distFromSitePx = Math.hypot(cp.x - sp.x, cp.y - sp.y);
      if (distFromSitePx > rOuter + 14) {
        const toneColor =
          sample.sinrDb >= 15
            ? '#34d399'
            : sample.sinrDb >= 0
              ? '#fbbf24'
              : '#f87171';
        ctx.save();
        ctx.strokeStyle = toneColor;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 4.5, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = toneColor;
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 1.8, 0, TAU);
        ctx.fill();
        const sign = sample.sinrDb >= 0 ? '+' : '';
        const rangeKm = (sample.distM / 1000).toFixed(1);
        const tagText = `${sign}${sample.sinrDb.toFixed(1)} dB · ${Math.round(sample.rssiDbm)} dBm · ${sample.modcodTier} · ${rangeKm} km`;
        drawHudTag(ctx, cp.x + 12, cp.y - 12, tagText, {
          align: 'left',
          borderColor: toneColor,
          textColor: '#f1f5f9',
          fontSize: 9,
        });
        ctx.restore();
      }
    }
  }

  ctx.restore();
}

// ============================================================================
// Tool 3 Renderer: QGIS / Pix4D AO Swath Heatmap Grid & Corner Grips
// ============================================================================

export function renderQgisAoSwathOverlay(
  ctx: CanvasRenderingContext2D,
  _w: number,
  _h: number,
  tbState: any,
  _viewport: RadarViewport,
  project: (xM: number, yM: number) => RadarPoint2D
): void {
  const active = tbState?.activeMode === 'region' || tbState?.toolMode === 'region';
  const box = tbState?.aoSwathBox ?? null;
  const draft = Array.isArray(tbState?.terrainRegionDraft) ? tbState.terrainRegionDraft : [];
  const regions = Array.isArray(tbState?.terrainRegions) ? tbState.terrainRegions : [];

  ctx.save();

  if (active && regions.length > 0) {
    for (const reg of regions) {
      if (!reg?.visible || !Array.isArray(reg.points) || reg.points.length < 3) continue;
      const pts = reg.points.map((p: any) => project(Number(p.xM ?? p.x ?? 0), Number(p.yM ?? p.y ?? 0)));
      ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  if (draft.length > 0) {
    const pts = draft.map((p: any) => project(Number(p.xM ?? p.x ?? 0), Number(p.yM ?? p.y ?? 0)));
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of pts) {
      drawCadGripSquare(ctx, p.x, p.y, 7, '#fbbf24');
    }
  }

  if (!box || !active) {
    ctx.restore();
    return;
  }

  const dims = computeAoSwathEdgeDimensions(box);
  const pNW = project(dims.minX, dims.maxY);
  const pNE = project(dims.maxX, dims.maxY);
  const pSE = project(dims.maxX, dims.minY);
  const pSW = project(dims.minX, dims.minY);

  const report = tbState?.aoSwathReport;
  if (report && Array.isArray(report.cells) && report.cells.length > 0) {
    const gridN = Math.max(1, Math.round(Math.sqrt(report.cells.length)));
    const cellW = (dims.maxX - dims.minX) / gridN;
    const cellH = (dims.maxY - dims.minY) / gridN;

    for (const cell of report.cells) {
      const cx = Number(cell.xM ?? 0);
      const cy = Number(cell.yM ?? 0);
      const tl = project(cx - cellW * 0.5, cy + cellH * 0.5);
      const br = project(cx + cellW * 0.5, cy - cellH * 0.5);
      const rw = br.x - tl.x;
      const rh = br.y - tl.y;
      if (Math.abs(rw) < 1 || Math.abs(rh) < 1) continue;

      const isLos = Boolean(cell.isLos);
      const sinr = Number(cell.sinrDb ?? -10);
      if (!isLos) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.26)';
      } else if (sinr >= 10) {
        ctx.fillStyle = 'rgba(52, 211, 153, 0.24)';
      } else {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.24)';
      }
      ctx.fillRect(tl.x, tl.y, rw, rh);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
      ctx.lineWidth = 0.6;
      ctx.strokeRect(tl.x, tl.y, rw, rh);
    }
  } else {
    ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
    ctx.beginPath();
    ctx.moveTo(pNW.x, pNW.y);
    ctx.lineTo(pNE.x, pNE.y);
    ctx.lineTo(pSE.x, pSE.y);
    ctx.lineTo(pSW.x, pSW.y);
    ctx.closePath();
    ctx.fill();
  }

  // Outer Pix4D/QGIS CAD Frame
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pNW.x, pNW.y);
  ctx.lineTo(pNE.x, pNE.y);
  ctx.lineTo(pSE.x, pSE.y);
  ctx.lineTo(pSW.x, pSW.y);
  ctx.closePath();
  ctx.stroke();

  // Interactive Corner Resize Grips
  for (const c of [pNW, pNE, pSE, pSW]) {
    drawCadGripSquare(ctx, c.x, c.y, 9, '#f59e0b');
  }

  // Top Edge Dimension + LOS% Banner AND Left Edge Height Tag
  const topMidX = (pNW.x + pNE.x) * 0.5;
  const topMidY = (pNW.y + pNE.y) * 0.5 - 24;
  const losPct = Number.isFinite(report?.losCoveragePct) ? ` · ${Math.round(report.losCoveragePct)}% LOS` : '';
  drawHudTag(ctx, topMidX, topMidY, `AO ${dims.widthKm.toFixed(1)}×${dims.heightKm.toFixed(1)} km (${dims.areaKm2.toFixed(1)} km²)${losPct}`, {
    align: 'center',
    borderColor: 'rgba(245, 158, 11, 0.75)',
    textColor: '#fef3c7',
    fontSize: 9.5,
  });

  const leftHeightPx = Math.abs(pSW.y - pNW.y);
  if (leftHeightPx >= 52) {
    drawHudTag(ctx, pNW.x - 10, (pNW.y + pSW.y) * 0.5, `${dims.heightKm.toFixed(1)} km`, {
      align: 'right',
      borderColor: 'rgba(245, 158, 11, 0.5)',
      textColor: '#fde68a',
      fontSize: 8.5,
    });
  }

  // Summit Peak Marker ▲ inside AO
  if (report?.summitPeak && Number.isFinite(report.summitPeak.xM)) {
    const sp = project(report.summitPeak.xM, report.summitPeak.yM);
    ctx.fillStyle = '#fde047';
    ctx.strokeStyle = '#090b10';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y - 6);
    ctx.lineTo(sp.x + 5.5, sp.y + 4.5);
    ctx.lineTo(sp.x - 5.5, sp.y + 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    drawHudTag(ctx, sp.x + 10, sp.y - 8, `SUMMIT ${Math.round(report.summitPeak.zMslM)}m`, {
      borderColor: 'rgba(250, 204, 21, 0.72)',
      textColor: '#fef9c3',
      fontSize: 9,
    });
  }

  // Valley Floor Marker ▼ inside AO
  if (report?.valleyFloor && Number.isFinite(report.valleyFloor.xM)) {
    const vp = project(report.valleyFloor.xM, report.valleyFloor.yM);
    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = '#090b10';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(vp.x, vp.y + 6);
    ctx.lineTo(vp.x + 5.5, vp.y - 4.5);
    ctx.lineTo(vp.x - 5.5, vp.y - 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    drawHudTag(ctx, vp.x + 10, vp.y + 8, `VALLEY ${Math.round(report.valleyFloor.zMslM)}m`, {
      borderColor: 'rgba(56, 189, 248, 0.72)',
      textColor: '#bae6fd',
      fontSize: 8.5,
    });
  }

  // Optimal Joint Relay Bridge Marker [RELAY]
  const bridge = tbState?.bridgeResult?.optimalBridge;
  if (bridge && Number.isFinite(bridge.xM) && Number.isFinite(bridge.yM)) {
    const bp = project(bridge.xM, bridge.yM);
    drawCadGripSquare(ctx, bp.x, bp.y, 9, '#34d399');
    drawHudTag(ctx, bp.x + 12, bp.y - 10, `RELAY ${bridge.bottleneckSnrDb.toFixed(1)}dB`, {
      borderColor: 'rgba(52, 211, 153, 0.8)',
      textColor: '#a7f3d0',
      fontSize: 9,
    });
  }

  ctx.restore();
}

// ============================================================================
// Tool 4 Renderer: SketchUp / AutoCAD 2.5D Extruded Barriers & Link Slicer
// ============================================================================

export function renderCadBarrierOverlay(
  ctx: CanvasRenderingContext2D,
  _w: number,
  _h: number,
  tbState: any,
  _viewport: RadarViewport,
  project: (xM: number, yM: number) => RadarPoint2D
): void {
  const obstacles = Array.isArray(tbState?.obstacles) ? tbState.obstacles : [];
  const isObsActive = tbState?.activeMode === 'obstacle' || tbState?.toolMode === 'obstacle-place';
  const hasAnchor = Boolean(tbState?.obsDrawingAnchor && tbState?.obsRubberBandPoint);
  if (obstacles.length === 0 && !isObsActive && !hasAnchor) return;

  const selectedId = tbState?.obsSelectedId ?? null;
  ctx.save();

  for (const obs of obstacles) {
    if (!obs) continue;
    const isSel = selectedId && String(obs.id) === String(selectedId);
    const mat = getCadBarrierMaterialStyle(obs.material);

    // Support both camelCase (obstacleEditor.draft) and snake_case (worker payload)
    const cx = Number(obs.xM ?? obs.center_x_m ?? obs.x_m ?? 0);
    const cy = Number(obs.yM ?? obs.center_y_m ?? obs.y_m ?? 0);
    const heightM = Number(obs.heightM ?? obs.height_m ?? 250);
    const shadow = computeCadExtrusionShadowOffset(heightM);

    if (obs.shape === 'cone' || obs.shape === 'peak') {
      const rWorld = Math.max(80, Number(obs.radiusM ?? obs.radius_m ?? (Number(obs.length_m ?? 600) * 0.5)));
      const centerPt = project(cx, cy);
      const edgePt = project(cx + rWorld, cy);
      const rPx = Math.max(9, Math.hypot(edgePt.x - centerPt.x, edgePt.y - centerPt.y));

      // SketchUp 2.5D Drop Shadow
      ctx.fillStyle = 'rgba(4, 6, 10, 0.52)';
      ctx.beginPath();
      ctx.arc(centerPt.x + shadow.dxPx, centerPt.y + shadow.dyPx, rPx, 0, TAU);
      ctx.fill();

      // Dome Concentric Elevation Rings
      ctx.fillStyle = mat.fill;
      ctx.strokeStyle = isSel ? '#ffffff' : mat.stroke;
      ctx.lineWidth = isSel ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.arc(centerPt.x, centerPt.y, rPx, 0, TAU);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = mat.hatch;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(centerPt.x, centerPt.y, rPx * 0.55, 0, TAU);
      ctx.stroke();

      if (isSel || isObsActive) {
        if (isSel) drawCadGripSquare(ctx, centerPt.x, centerPt.y, 8, '#38bdf8');
        drawHudTag(ctx, centerPt.x, centerPt.y - rPx - 12, `PEAK Ø${(rWorld * 2 / 1000).toFixed(1)}km · H:${Math.round(heightM)}m`, {
          align: 'center',
          borderColor: isSel ? 'rgba(255, 255, 255, 0.85)' : mat.stroke,
          textColor: '#f8fafc',
          fontSize: 9,
        });
      }
    } else {
      // Exact match to getObstacleEndpoints() axis convention
      const wM = Math.max(40, Number(obs.widthM ?? obs.width_m ?? obs.thickness_m ?? 180));
      const dM = Math.max(120, Number(obs.depthM ?? obs.depth_m ?? obs.length_m ?? 1200));
      const rotRad = (Number(obs.rotationDeg ?? obs.rotation_deg ?? obs.bearing_deg ?? 0) * Math.PI) / 180;
      const lenM = Math.max(wM, dM);
      const thickM = Math.min(wM, dM);
      const halfL = lenM * 0.5;
      const halfT = Math.max(55, thickM * 0.5);

      const ax = dM >= wM ? -Math.sin(rotRad) : Math.cos(rotRad);
      const ay = dM >= wM ? Math.cos(rotRad) : Math.sin(rotRad);
      const px = ay;
      const py = -ax;

      const cornersWorld = [
        [cx - ax * halfL - px * halfT, cy - ay * halfL - py * halfT],
        [cx + ax * halfL - px * halfT, cy + ay * halfL - py * halfT],
        [cx + ax * halfL + px * halfT, cy + ay * halfL + py * halfT],
        [cx - ax * halfL + px * halfT, cy - ay * halfL + py * halfT],
      ];
      const cornersScreen = cornersWorld.map(([wx, wy]) => project(wx, wy));

      // 1. SketchUp 2.5D Extrusion Drop Shadow
      ctx.fillStyle = 'rgba(4, 6, 10, 0.55)';
      ctx.beginPath();
      ctx.moveTo(cornersScreen[0].x + shadow.dxPx, cornersScreen[0].y + shadow.dyPx);
      for (let i = 1; i < cornersScreen.length; i++) {
        ctx.lineTo(cornersScreen[i].x + shadow.dxPx, cornersScreen[i].y + shadow.dyPx);
      }
      ctx.closePath();
      ctx.fill();

      // 2. Material Footprint Polygon + Clipped 45° CAD Architectural Hatching
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cornersScreen[0].x, cornersScreen[0].y);
      for (let i = 1; i < cornersScreen.length; i++) {
        ctx.lineTo(cornersScreen[i].x, cornersScreen[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = mat.fill;
      ctx.fill();

      ctx.clip();
      let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
      for (const cs of cornersScreen) {
        if (cs.x < minSx) minSx = cs.x;
        if (cs.x > maxSx) maxSx = cs.x;
        if (cs.y < minSy) minSy = cs.y;
        if (cs.y > maxSy) maxSy = cs.y;
      }
      ctx.strokeStyle = mat.hatch;
      ctx.lineWidth = 0.85;
      const span = (maxSx - minSx) + (maxSy - minSy);
      ctx.beginPath();
      for (let d = -span; d <= span; d += 7) {
        ctx.moveTo(minSx + d, minSy);
        ctx.lineTo(minSx + d - (maxSy - minSy), maxSy);
      }
      ctx.stroke();
      ctx.restore();

      // Crisp CAD Outline
      ctx.strokeStyle = isSel ? '#ffffff' : mat.stroke;
      ctx.lineWidth = isSel ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cornersScreen[0].x, cornersScreen[0].y);
      for (let i = 1; i < cornersScreen.length; i++) {
        ctx.lineTo(cornersScreen[i].x, cornersScreen[i].y);
      }
      ctx.closePath();
      ctx.stroke();

      // V1 / CENTER / V2 Interactive CAD Grips & Dimension Label
      if (isSel || isObsActive) {
        const pV1 = project(cx - ax * halfL, cy - ay * halfL);
        const pC = project(cx, cy);
        const pV2 = project(cx + ax * halfL, cy + ay * halfL);
        if (isSel) {
          drawCadGripSquare(ctx, pV1.x, pV1.y, 8, '#38bdf8');
          drawCadGripSquare(ctx, pC.x, pC.y, 8, '#f8fafc');
          drawCadGripSquare(ctx, pV2.x, pV2.y, 8, '#38bdf8');
        }
        drawHudTag(ctx, pC.x, pC.y - 24, `${(lenM / 1000).toFixed(1)}km · H:${Math.round(heightM)}m`, {
          align: 'center',
          borderColor: isSel ? 'rgba(255, 255, 255, 0.85)' : mat.stroke,
          textColor: '#f8fafc',
          fontSize: 9,
        });
      }
    }
  }

  // Live Rubber-Band Extrusion Preview while drawing V1 -> V2
  if (hasAnchor) {
    const a = tbState.obsDrawingAnchor;
    const b = tbState.obsRubberBandPoint;
    const pA = project(a.x, a.y);
    const pB = project(b.x, b.y);
    const distM = Math.hypot(b.x - a.x, b.y - a.y);
    const bearingDeg = (((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI) % 360 + 360) % 360;
    const geom = computeAutoCadDimensionGeometry(pA, pB, distM, false);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.6;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pB.x, pB.y);
    ctx.stroke();
    ctx.setLineDash([]);

    drawCadGripSquare(ctx, pA.x, pA.y, 9, '#38bdf8');
    drawCadGripSquare(ctx, pB.x, pB.y, 9, '#bae6fd');

    drawHudTag(
      ctx,
      geom.midX + geom.normalX * 16,
      geom.midY + geom.normalY * 16,
      `WALL ${Math.round(distM)}m · ${bearingDeg.toFixed(0)}°`,
      {
        align: 'center',
        borderColor: 'rgba(56, 189, 248, 0.82)',
        textColor: '#e0f2fe',
        fontSize: 9.5,
      }
    );
  }

  // 3D Link-Slicer Intersection Badges
  const report = tbState?.cadObstacleReport;
  if (report && Array.isArray(report.intersections)) {
    for (const hit of report.intersections) {
      const hx = Number(hit?.xM ?? hit?.hitXM);
      const hy = Number(hit?.yM ?? hit?.hitYM);
      if (!Number.isFinite(hx) || !Number.isFinite(hy)) continue;
      const hp = project(hx, hy);
      const isSliced = hit?.sliceVerdict === 'SLICED_BLOCKED' || Boolean(hit?.isSliced ?? hit?.sliced);
      ctx.save();
      ctx.strokeStyle = isSliced ? '#ef4444' : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hp.x - 5, hp.y - 5);
      ctx.lineTo(hp.x + 5, hp.y + 5);
      ctx.moveTo(hp.x + 5, hp.y - 5);
      ctx.lineTo(hp.x - 5, hp.y + 5);
      ctx.stroke();
      ctx.restore();

      drawHudTag(ctx, hp.x + 10, hp.y - 10, isSliced ? `BLOCKED S${hit.nodeId}` : `CLEAR S${hit.nodeId}`, {
        borderColor: isSliced ? 'rgba(239, 68, 68, 0.82)' : 'rgba(56, 189, 248, 0.72)',
        textColor: isSliced ? '#fecaca' : '#bae6fd',
        fontSize: 9,
      });
    }
  }

  ctx.restore();
}

// ============================================================================
// Flagship Sidebar Instrument Suite (Mounted Cleanly Into All 5 Toolbox Panes)
// ============================================================================

export interface ToolboxPrecisionUiDeps {
  readonly documentRef?: Document;
  readonly onPanNavigate?: () => void;
  readonly onFitDem?: () => void;
  readonly onFitNetwork?: () => void;
  readonly onSetBackdropMode?: (mode: 'relief' | 'slope' | 'ridge') => void;
  readonly onToggleLayer?: (layerId: 'base.terrainDem' | 'base.contours', visible: boolean) => void;
  readonly onArmMeasure2Pt?: () => void;
  readonly onArmMeasurePoly?: () => void;
  readonly onFinishMeasurePoly?: () => void;
  readonly onClearMeasure?: () => void;
  readonly onSwapTransectAB?: () => void;
  readonly onSpawnPeakRelay?: () => void;
  readonly onTransectSettingsChange?: () => void;
  readonly onArmProbePick?: () => void;
  readonly onSnapProbeBestPeak?: () => void;
  readonly onClearProbe?: () => void;
  readonly onDeployProbeUnit?: (unitType: string) => void;
  readonly onProbeSettingsChange?: () => void;
  readonly onProbeHeatmapConfigChange?: (patch: Partial<ProbeHeatmapConfig>) => void;
  readonly onArmRegionDraw?: () => void;
  readonly onFinishRegionDraw?: () => void;
  readonly onCancelRegionDraw?: () => void;
  readonly onQuickAoBox?: (sizeKm: number) => void;
  readonly onDeployAoSquad?: () => void;
  readonly onSpawnAoSummitRelay?: () => void;
  readonly onRegionListAction?: (action: string, regionId: number, value?: any) => void;
  readonly onArmBridgePick?: (slot: 'A' | 'B') => void;
  readonly onFindBridge?: () => void;
  readonly onClearBridge?: () => void;
  readonly onArmObstaclePlace?: () => void;
  readonly onUndoObstacle?: () => void;
  readonly onRedoObstacle?: () => void;
  readonly onClearObstacles?: () => void;
  readonly onBlockNodeLink?: (nodeId: number) => void;
  readonly onAutoSizeObstacleHeight?: () => void;
  readonly onObstacleStyleChange?: () => void;
  readonly onSetActiveObstacleHeight?: (heightM: number) => void;
  readonly getWorkspaceTelemetryInput?: () => WorkspaceTilesTelemetryInput;
  readonly onActivateWorkspaceMode?: (mode: WorkspaceTileId, autoArm: boolean) => void;
  readonly onOpenWorkspaceInspector?: (mode: WorkspaceTileId) => void;
  readonly onApplyDemPreset?: (presetId: string) => void;
}

export interface ToolboxPrecisionSnapshot {
  readonly transectWaypoints?: readonly { readonly xM: number; readonly yM: number }[];
  readonly rubberBandPoint?: { readonly xM?: number; readonly yM?: number; readonly x?: number; readonly y?: number } | null;
  readonly rulerMetrics?: {
    readonly horizontalDistanceM?: number;
    readonly slantDistanceM?: number;
    readonly slantDistance3DM?: number;
    readonly d3dM?: number;
    readonly elevationDeltaM?: number;
    readonly groundElevationDeltaM?: number;
    readonly antennaElevationDeltaM?: number;
    readonly deltaZM?: number;
    readonly azimuthDeg?: number;
    readonly cardinalOctant?: string;
  } | null;
  readonly rulerPreviewMetrics?: ToolboxPrecisionSnapshot['rulerMetrics'];
  readonly rulerEvaluation?: {
    readonly isLineOfSightClear?: boolean;
  } | null;
  readonly rulerPreviewEval?: ToolboxPrecisionSnapshot['rulerEvaluation'];
  readonly cursorProbeLive?: {
    readonly estSinrDb?: number;
    readonly isLos?: boolean;
    readonly modcodName?: string;
  } | null;
  readonly viewshedResult?: SiteProbeViewshedResult | null;
  readonly probeHeatmapConfig?: ProbeHeatmapConfig | null;
  readonly aoSwathReport?: {
    readonly losCoveragePct?: number;
    readonly deadZonePct?: number;
    readonly widthKm?: number;
    readonly heightKm?: number;
  } | null;
  readonly selectedObstacleHeightM?: number | null;
  readonly groundNodes?: readonly any[];
}

export interface ToolboxPrecisionUiController {
  readonly mount: () => void;
  readonly sync: (snapshot: ToolboxPrecisionSnapshot) => void;
}

const TAB_ICONS: Readonly<Record<string, string>> = Object.freeze({
  dem: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><polygon points="8,3.6 10,8 8,12.4 6,8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  transect: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><line x1="2.5" y1="13.5" x2="13.5" y2="2.5" stroke="currentColor" stroke-width="1.5"/><circle cx="3" cy="13" r="1.5" fill="currentColor"/><circle cx="13" cy="3" r="1.5" fill="currentColor"/><line x1="6" y1="10" x2="7.5" y2="11.5" stroke="currentColor" stroke-width="1.2"/><line x1="9" y1="7" x2="10.5" y2="8.5" stroke="currentColor" stroke-width="1.2"/></svg>',
  probe: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="2.2" fill="currentColor"/><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.5 2"/><line x1="8" y1="1" x2="8" y2="3.2" stroke="currentColor" stroke-width="1.3"/><line x1="8" y1="12.8" x2="8" y2="15" stroke="currentColor" stroke-width="1.3"/><line x1="1" y1="8" x2="3.2" y2="8" stroke="currentColor" stroke-width="1.3"/><line x1="12.8" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.3"/></svg>',
  region: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2"/><line x1="2.5" y1="8" x2="13.5" y2="8" stroke="currentColor" stroke-width="1" opacity="0.6"/><line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" stroke-width="1" opacity="0.6"/></svg>',
  obstacle: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><polygon points="2.5,11 10.5,4.5 13.5,6 5.5,12.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5,11 V7.5 L10.5,1.5 L13.5,3 V6" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
});

export function createToolboxPrecisionUi(deps: ToolboxPrecisionUiDeps = {}): ToolboxPrecisionUiController {
  let mounted = false;
  let unitSystem: 'metric' | 'nautical' = 'metric';
  let lastSnapshot: ToolboxPrecisionSnapshot = {};
  let workspaceTiles: WorkspaceTilesManager | null = null;

  const getDoc = (): Document | null => deps.documentRef ?? (typeof document !== 'undefined' ? document : null);

  function formatLen(meters: number | null | undefined): string {
    if (!Number.isFinite(meters as number)) return '--';
    const m = meters as number;
    if (unitSystem === 'nautical') {
      const nm = m / 1852;
      return `${nm.toFixed(2)} NM`;
    }
    return Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
  }

  function formatElev(meters: number | null | undefined): string {
    if (!Number.isFinite(meters as number)) return '--';
    const m = meters as number;
    if (unitSystem === 'nautical') {
      const ft = m * 3.28084;
      return `${ft >= 0 ? '+' : ''}${Math.round(ft)} ft`;
    }
    return `${m >= 0 ? '+' : ''}${Math.round(m)} m`;
  }

  function syncNodeDropdown(doc: Document, rawNodes: readonly any[] | undefined): void {
    const sel = doc.getElementById('tb-obs-target-node-select') as HTMLSelectElement | null;
    if (!sel || !Array.isArray(rawNodes) || rawNodes.length === 0) return;
    const prev = sel.value;
    const items = rawNodes
      .filter((n: any) => n && Number.isFinite(Number(n.node_id ?? n.nodeId)))
      .map((n: any) => {
        const id = Number(n.node_id ?? n.nodeId);
        const role = (n.node_type === 'mcp' || n.nodeType === 'mcp') ? 'MCP' : 'Soldier';
        const snr = Number(n.snr_db ?? n.snrDb);
        const tag = Number.isFinite(snr) ? `${snr.toFixed(1)} dB` : (n.terrain_is_los === false ? 'Blocked' : 'Active');
        return { value: String(id), label: `S${id} · ${role} (${tag})` };
      });
    if (items.length === 0) return;
    const sig = items.map((i) => `${i.value}:${i.label}`).join('|');
    if (sel.dataset.nodeSig === sig) return;
    sel.dataset.nodeSig = sig;
    sel.innerHTML = '';
    const placeholder = doc.createElement('option');
    placeholder.value = 'none';
    placeholder.textContent = 'Pick a ground node…';
    sel.appendChild(placeholder);
    for (const item of items) {
      const opt = doc.createElement('option');
      opt.value = item.value;
      opt.textContent = item.label;
      sel.appendChild(opt);
    }
    if (prev && items.some((i) => i.value === prev)) {
      sel.value = prev;
    } else if (items.length > 0) {
      sel.value = items[0].value;
    }
  }

  function mount(): void {
    const doc = getDoc();
    if (!doc || mounted) return;
    mounted = true;

    // 0. Inject clean monochrome icons into the 5 mode tabs & wire Header Pan button
    doc.querySelectorAll<HTMLButtonElement>('#terrain-toolbox .tb-mode-tab[data-tb-mode]').forEach((tab) => {
      const mode = tab.dataset.tbMode || '';
      const iconHtml = TAB_ICONS[mode];
      if (iconHtml && !tab.querySelector('.tb-tab-icon')) {
        const iconSpan = doc.createElement('span');
        iconSpan.className = 'tb-tab-icon';
        iconSpan.innerHTML = iconHtml;
        tab.prepend(iconSpan);
      }
    });

    doc.getElementById('tb-navigate-btn')?.addEventListener('click', () => {
      deps.onPanNavigate?.();
    });

    // 1. Tool 0 (DEM Quick-Switch + Fit Buttons + Surface Shading Segmented Bar + Layer Checkboxes)
    doc.getElementById('terrain-fit-btn')?.addEventListener('click', () => deps.onFitDem?.());
    doc.getElementById('terrain-fit-network-btn')?.addEventListener('click', () => deps.onFitNetwork?.());

    const demLayerCb = doc.getElementById('tb-toggle-dem-layer') as HTMLInputElement | null;
    demLayerCb?.addEventListener('change', () => deps.onToggleLayer?.('base.terrainDem', demLayerCb.checked));

    const contoursLayerCb = doc.getElementById('tb-toggle-contours-layer') as HTMLInputElement | null;
    contoursLayerCb?.addEventListener('change', () => deps.onToggleLayer?.('base.contours', contoursLayerCb.checked));

    const backdropSel = doc.getElementById('tb-backdrop-mode') as HTMLSelectElement | null;
    if (backdropSel) {
      backdropSel.addEventListener('change', () => {
        const val = backdropSel.value === 'slope' || backdropSel.value === 'ridge' ? backdropSel.value : 'relief';
        deps.onSetBackdropMode?.(val);
      });
      if (!doc.getElementById('tb-shading-seg')) {
        const seg = doc.createElement('div');
        seg.id = 'tb-shading-seg';
        seg.className = 'tb-cad-seg';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'DEM surface shading mode');
        const modes: Array<['relief' | 'slope' | 'ridge', string]> = [
          ['relief', 'Relief'],
          ['slope', 'Slope °'],
          ['ridge', 'Ridge'],
        ];
        for (const [val, label] of modes) {
          const b = doc.createElement('button');
          b.type = 'button';
          b.className = `tb-cad-seg-btn${backdropSel.value === val ? ' is-active' : ''}`;
          b.dataset.shadingVal = val;
          b.textContent = label;
          b.addEventListener('click', () => {
            backdropSel.value = val;
            backdropSel.dispatchEvent(new Event('change', { bubbles: true }));
            seg.querySelectorAll('.tb-cad-seg-btn').forEach((el) => {
              el.classList.toggle('is-active', el.getAttribute('data-shading-val') === val);
            });
          });
          seg.appendChild(b);
        }
        backdropSel.addEventListener('change', () => {
          seg.querySelectorAll('.tb-cad-seg-btn').forEach((el) => {
            el.classList.toggle('is-active', el.getAttribute('data-shading-val') === backdropSel.value);
          });
        });
        backdropSel.parentElement?.insertBefore(seg, backdropSel);
      }
    }

    // 2. Tool 1 (Measure Line & LoS — Clean Hero Card + All Button/Input Wiring)
    doc.getElementById('terrain-measure-btn')?.addEventListener('click', () => deps.onArmMeasure2Pt?.());
    doc.getElementById('tb-transect-poly-btn')?.addEventListener('click', () => deps.onArmMeasurePoly?.());
    doc.getElementById('tb-transect-finish-btn')?.addEventListener('click', () => deps.onFinishMeasurePoly?.());
    doc.getElementById('terrain-measure-clear-btn')?.addEventListener('click', () => deps.onClearMeasure?.());
    doc.getElementById('btn-transect-swap-ab')?.addEventListener('click', () => deps.onSwapTransectAB?.());
    doc.getElementById('btn-transect-spawn-peak-relay')?.addEventListener('click', () => deps.onSpawnPeakRelay?.());
    [
      'tb-transect-tx-mast',
      'tb-transect-rx-mast',
      'tb-transect-height-a',
      'tb-transect-height-b',
      'tb-transect-node-type',
      'tb-transect-k',
      'tb-transect-obstacles',
    ].forEach((id) => {
      doc.getElementById(id)?.addEventListener('change', () => deps.onTransectSettingsChange?.());
    });

    const transectPane = doc.getElementById('tb-pane-transect');
    if (transectPane && !doc.getElementById('tb-autocad-cmd-strip')) {
      const strip = doc.createElement('div');
      strip.id = 'tb-autocad-cmd-strip';
      strip.className = 'tb-instrument-card tb-instrument-autocad';
      strip.innerHTML = `
        <div class="tb-instrument-head">
          <span class="tb-instrument-title">Distance &amp; Path</span>
          <div class="tb-cad-flags">
            <span id="tb-cad-los-verdict" class="tb-verdict-tag" data-tone="idle">READY</span>
            <button type="button" id="tb-cad-unit-toggle" class="tb-cad-unit-btn" title="Switch Metric / Nautical Units">km / m</button>
          </div>
        </div>
        <div class="tb-hero-row">
          <div class="tb-hero-stat"><span>Distance</span><strong id="tb-cad-dist-2d">--</strong></div>
          <div class="tb-hero-stat"><span>Bearing</span><strong id="tb-cad-az">--°</strong></div>
          <div class="tb-hero-stat"><span>Elev Δ</span><strong id="tb-cad-dz">--</strong></div>
        </div>
        <div class="tb-cad-substrip">
          <span>Slant <strong id="tb-cad-slant-3d">--</strong></span>
          <span>East–West <strong id="tb-cad-dx">--</strong></span>
          <span>North–South <strong id="tb-cad-dy">--</strong></span>
        </div>
      `;
      const actionBar = transectPane.querySelector('.tb-action-bar');
      if (actionBar && actionBar.nextSibling) {
        transectPane.insertBefore(strip, actionBar.nextSibling);
      } else {
        transectPane.prepend(strip);
      }
      const unitBtn = doc.getElementById('tb-cad-unit-toggle');
      unitBtn?.addEventListener('click', () => {
        unitSystem = unitSystem === 'metric' ? 'nautical' : 'metric';
        unitBtn.textContent = unitSystem === 'metric' ? 'km / m' : 'NM / ft';
        sync(lastSnapshot);
      });
    }

    // 3. Tool 2 (Signal Probe & Spawn — Clear Signal Gauge + All Button/Input Wiring)
    doc.getElementById('tb-probe-pick-btn')?.addEventListener('click', () => deps.onArmProbePick?.());
    doc.getElementById('btn-probe-snap-best')?.addEventListener('click', () => deps.onSnapProbeBestPeak?.());
    doc.getElementById('tb-probe-clear-btn')?.addEventListener('click', () => deps.onClearProbe?.());
    doc.getElementById('tb-probe-spawn-node')?.addEventListener('click', () => {
      const sel = doc.getElementById('tb-probe-unit-select') as HTMLSelectElement | null;
      deps.onDeployProbeUnit?.(sel?.value || 'soldier');
    });
    const mastInput = doc.getElementById('tb-probe-mast-input') as HTMLInputElement | null;
    const aglInput = doc.getElementById('tb-probe-agl') as HTMLInputElement | null;
    mastInput?.addEventListener('change', () => {
      if (aglInput && mastInput.value) aglInput.value = mastInput.value;
      deps.onProbeSettingsChange?.();
    });
    aglInput?.addEventListener('change', () => {
      if (mastInput && aglInput.value) {
        const clamped = Math.max(1, Math.min(200, parseFloat(aglInput.value) || 2));
        mastInput.value = String(clamped);
      }
      deps.onProbeSettingsChange?.();
    });
    [
      'tb-probe-radius',
      'tb-probe-target',
      'tb-sweep-target',
      'tb-probe-obstacles',
      'tb-probe-unit-select',
    ].forEach((id) => {
      doc.getElementById(id)?.addEventListener('change', () => deps.onProbeSettingsChange?.());
    });

    const probePane = doc.getElementById('tb-pane-probe');
    if (probePane && !doc.getElementById('tb-rf-sinr-meter')) {
      const meter = doc.createElement('div');
      meter.id = 'tb-rf-sinr-meter';
      meter.className = 'tb-instrument-card tb-instrument-rf';
      meter.innerHTML = `
        <div class="tb-instrument-head">
          <span class="tb-instrument-title">Link Quality to Aircraft</span>
          <span id="tb-rf-meter-status" class="tb-rf-status" data-tone="marginal">Click map to test</span>
        </div>
        <div class="tb-rf-bar-track" aria-label="Estimated 8 GHz signal quality">
          <div id="tb-rf-bar-fill" class="tb-rf-bar-fill" data-tone="marginal" style="width:0%"></div>
          <span class="tb-rf-tick" style="left:25%"></span>
          <span class="tb-rf-tick" style="left:45%"></span>
          <span class="tb-rf-tick" style="left:65%"></span>
        </div>
        <div class="tb-rf-scale">
          <span>π/2-BPSK</span>
          <span>QPSK</span>
          <span>8-PSK</span>
          <span>16-APSK</span>
          <span>64-APSK</span>
        </div>
      `;
      const actionBar = probePane.querySelector('.tb-action-bar');
      if (actionBar && actionBar.nextSibling) {
        probePane.insertBefore(meter, actionBar.nextSibling);
      } else {
        probePane.prepend(meter);
      }
    }

    if (probePane && !doc.getElementById('tb-probe-heatmap-card')) {
      const hmCard = doc.createElement('div');
      hmCard.id = 'tb-probe-heatmap-card';
      hmCard.className = 'tb-instrument-card tb-probe-hm-card';
      hmCard.innerHTML = `
        <div class="tb-instrument-head">
          <span class="tb-instrument-title">Signal Propagation Heat Map</span>
          <label class="tb-probe-hm-toggle" title="Toggle RF signal strength heat map overlay">
            <input id="tb-probe-hm-toggle" type="checkbox" checked />
            <span id="tb-probe-hm-toggle-lbl">Overlay On</span>
          </label>
        </div>
        <div id="tb-probe-hm-controls" class="tb-probe-hm-controls">
          <div class="tb-probe-hm-row">
            <div class="tb-probe-hm-seg" role="group" aria-label="Heat map display mode">
              <button type="button" class="tb-probe-hm-seg-btn is-active" data-hm-mode="signal">Signal (dB)</button>
              <button type="button" class="tb-probe-hm-seg-btn" data-hm-mode="viewshed">LoS Zones</button>
            </div>
            <select id="tb-probe-hm-palette" class="tb-probe-hm-select" aria-label="Heat map color palette">
              <option value="rf_spectrum">RF Spectrum</option>
              <option value="thermal">Thermal</option>
              <option value="viridis">Viridis (CVD)</option>
            </select>
          </div>
          <div class="tb-probe-hm-row">
            <label class="tb-probe-hm-slider-wrap">
              <span>Opacity</span>
              <input id="tb-probe-hm-opacity" type="range" min="20" max="95" step="5" value="72" />
              <span id="tb-probe-hm-opacity-val" class="tb-probe-hm-val">72%</span>
            </label>
            <label class="tb-probe-hm-check" title="Draw 0 dB, +10 dB, and +18 dB iso-signal contours">
              <input id="tb-probe-hm-contours" type="checkbox" checked />
              <span>Iso-dB</span>
            </label>
          </div>
          <div id="tb-probe-hm-ramp" class="tb-probe-hm-ramp" data-mode="signal" data-palette="rf_spectrum" aria-label="Signal strength color scale"></div>
          <div id="tb-probe-hm-scale" class="tb-probe-hm-scale">
            <span>-15 dB</span>
            <span>0 dB</span>
            <span>+10 dB</span>
            <span>+20 dB</span>
            <span>+30 dB</span>
          </div>
          <div id="tb-probe-hm-stats" class="tb-probe-hm-stats">
            <div class="tb-probe-hm-stat">
              <span class="tb-probe-hm-stat-lbl">Usable</span>
              <span id="tb-probe-hm-usable" class="tb-probe-hm-stat-val">--%</span>
            </div>
            <div class="tb-probe-hm-stat">
              <span class="tb-probe-hm-stat-lbl">Strong</span>
              <span id="tb-probe-hm-strong" class="tb-probe-hm-stat-val">--%</span>
            </div>
            <div class="tb-probe-hm-stat">
              <span class="tb-probe-hm-stat-lbl">Mean</span>
              <span id="tb-probe-hm-mean" class="tb-probe-hm-stat-val">-- dB</span>
            </div>
            <div class="tb-probe-hm-stat">
              <span class="tb-probe-hm-stat-lbl">Radius</span>
              <span id="tb-probe-hm-radius" class="tb-probe-hm-stat-val">-- km</span>
            </div>
          </div>
        </div>
      `;
      const sinrMeter = doc.getElementById('tb-rf-sinr-meter');
      if (sinrMeter && sinrMeter.nextSibling) {
        probePane.insertBefore(hmCard, sinrMeter.nextSibling);
      } else {
        probePane.appendChild(hmCard);
      }

      const toggleEl = doc.getElementById('tb-probe-hm-toggle') as HTMLInputElement | null;
      toggleEl?.addEventListener('change', () => {
        deps.onProbeHeatmapConfigChange?.({ enabled: toggleEl.checked });
      });

      hmCard.querySelectorAll<HTMLButtonElement>('[data-hm-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.hmMode === 'viewshed' ? 'viewshed' : 'signal';
          deps.onProbeHeatmapConfigChange?.({ mode });
        });
      });

      const palSel = doc.getElementById('tb-probe-hm-palette') as HTMLSelectElement | null;
      palSel?.addEventListener('change', () => {
        const val = palSel.value;
        const palette: ProbeHeatmapPalette =
          val === 'thermal' ? 'thermal' : val === 'viridis' ? 'viridis' : 'rf_spectrum';
        deps.onProbeHeatmapConfigChange?.({ palette });
      });

      const opSlider = doc.getElementById('tb-probe-hm-opacity') as HTMLInputElement | null;
      opSlider?.addEventListener('input', () => {
        const pct = Math.max(20, Math.min(95, Number(opSlider.value) || 72));
        const valEl = doc.getElementById('tb-probe-hm-opacity-val');
        if (valEl) valEl.textContent = `${pct}%`;
        deps.onProbeHeatmapConfigChange?.({ opacity: pct / 100 });
      });

      const isoEl = doc.getElementById('tb-probe-hm-contours') as HTMLInputElement | null;
      isoEl?.addEventListener('change', () => {
        deps.onProbeHeatmapConfigChange?.({ showContours: isoEl.checked });
      });
    }

    // 4. Tool 3 (Area Coverage Scan — Quick Scan Presets + Coverage Bar + All Wiring)
    doc.getElementById('terrain-region-btn')?.addEventListener('click', () => deps.onArmRegionDraw?.());
    doc.getElementById('terrain-region-finish-btn')?.addEventListener('click', () => deps.onFinishRegionDraw?.());
    doc.getElementById('terrain-region-cancel-btn')?.addEventListener('click', () => deps.onCancelRegionDraw?.());
    doc.getElementById('btn-region-deploy-squad')?.addEventListener('click', () => deps.onDeployAoSquad?.());
    doc.getElementById('btn-region-spawn-summit-relay')?.addEventListener('click', () => deps.onSpawnAoSummitRelay?.());
    doc.getElementById('tb-bridge-a-btn')?.addEventListener('click', () => deps.onArmBridgePick?.('A'));
    doc.getElementById('tb-bridge-b-btn')?.addEventListener('click', () => deps.onArmBridgePick?.('B'));
    doc.getElementById('tb-bridge-find-btn')?.addEventListener('click', () => deps.onFindBridge?.());
    doc.getElementById('tb-bridge-clear-btn')?.addEventListener('click', () => deps.onClearBridge?.());

    const regList = doc.getElementById('terrain-toolbox-regions');
    regList?.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-region-action]');
      const row = target?.closest<HTMLElement>('[data-region-id]');
      if (!target || !row) return;
      const action = target.dataset.regionAction || '';
      const id = Number(row.dataset.regionId);
      if (action === 'select' || action === 'delete') {
        deps.onRegionListAction?.(action, id);
      }
    });
    regList?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement | null;
      const row = target?.closest<HTMLElement>('[data-region-id]');
      if (!target || !row) return;
      const action = target.dataset.regionAction || '';
      const id = Number(row.dataset.regionId);
      if (action === 'visibility') deps.onRegionListAction?.('visibility', id, target.checked);
      else if (action === 'color') deps.onRegionListAction?.('color', id, target.value);
    });

    const regionPane = doc.getElementById('tb-pane-region');
    if (regionPane && !doc.getElementById('tb-qgis-coverage-bar')) {
      const qgisCard = doc.createElement('div');
      qgisCard.id = 'tb-qgis-coverage-bar';
      qgisCard.className = 'tb-instrument-card tb-instrument-qgis';
      qgisCard.innerHTML = `
        <div class="tb-instrument-head">
          <span class="tb-instrument-title">Quick Scan Area</span>
          <div class="tb-ao-presets" role="group" aria-label="Quick scan box sizes">
            <button type="button" class="tb-ao-preset-btn" data-ao-km="6">6×6 km</button>
            <button type="button" class="tb-ao-preset-btn" data-ao-km="12">12×12 km</button>
            <button type="button" class="tb-ao-preset-btn" data-ao-km="20">20×20 km</button>
          </div>
        </div>
        <div class="tb-qgis-stack" aria-label="Area coverage breakdown">
          <div id="tb-qgis-seg-clear" class="tb-qgis-seg is-clear" style="width:0%"></div>
          <div id="tb-qgis-seg-marg" class="tb-qgis-seg is-marginal" style="width:0%"></div>
          <div id="tb-qgis-seg-dead" class="tb-qgis-seg is-dead" style="width:0%"></div>
        </div>
        <div class="tb-qgis-legend">
          <span><i class="is-clear"></i>Clear <strong id="tb-qgis-pct-clear">--%</strong></span>
          <span><i class="is-marginal"></i>Weak <strong id="tb-qgis-pct-marg">--%</strong></span>
          <span><i class="is-dead"></i>Blocked <strong id="tb-qgis-pct-dead">--%</strong></span>
        </div>
      `;
      const actionBar = regionPane.querySelector('.tb-action-bar');
      if (actionBar && actionBar.nextSibling) {
        regionPane.insertBefore(qgisCard, actionBar.nextSibling);
      } else {
        regionPane.prepend(qgisCard);
      }
      qgisCard.querySelectorAll('.tb-ao-preset-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const km = Number(btn.getAttribute('data-ao-km') || '12');
          qgisCard.querySelectorAll('.tb-ao-preset-btn').forEach((el) => {
            el.classList.toggle('is-active', el === btn);
          });
          deps.onQuickAoBox?.(km);
        });
      });
    }

    // 5. Tool 4 (Build 3D Barrier — Clean Builder Tray + All Button Wiring)
    doc.getElementById('tb-obs-place-btn')?.addEventListener('click', () => deps.onArmObstaclePlace?.());
    doc.getElementById('tb-obs-undo')?.addEventListener('click', () => deps.onUndoObstacle?.());
    doc.getElementById('tb-obs-redo')?.addEventListener('click', () => deps.onRedoObstacle?.());
    doc.getElementById('tb-obs-clear-btn')?.addEventListener('click', () => deps.onClearObstacles?.());
    doc.getElementById('btn-obs-auto-height')?.addEventListener('click', () => deps.onAutoSizeObstacleHeight?.());
    doc.getElementById('btn-obs-slice-node-link')?.addEventListener('click', () => {
      const sel = doc.getElementById('tb-obs-target-node-select') as HTMLSelectElement | null;
      const val = Number(sel?.value);
      if (Number.isFinite(val)) deps.onBlockNodeLink?.(val);
    });

    const obsPane = doc.getElementById('tb-pane-obstacle');
    const shapeSel = doc.getElementById('tb-obs-shape-select') as HTMLSelectElement | null;
    const matSel = doc.getElementById('tb-obs-material-select') as HTMLSelectElement | null;
    if (obsPane && !doc.getElementById('tb-sketchup-tray')) {
      const tray = doc.createElement('div');
      tray.id = 'tb-sketchup-tray';
      tray.className = 'tb-instrument-card tb-instrument-sketchup';
      tray.innerHTML = `
        <div class="tb-instrument-head">
          <span class="tb-instrument-title">Barrier Shape &amp; Material</span>
          <span class="tb-cad-flag is-on">Shift · 15° Snap</span>
        </div>
        <div class="tb-su-row" role="group" aria-label="Barrier geometry preset">
          <button type="button" class="tb-su-tile is-active" data-su-shape="wall">
            <svg viewBox="0 0 24 14" width="20" height="12" aria-hidden="true"><polygon points="2,10 17,4 22,6 7,12" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="2" y1="10" x2="2" y2="6" stroke="currentColor" stroke-width="1.3"/><line x1="17" y1="4" x2="17" y2="1" stroke="currentColor" stroke-width="1.3"/></svg>
            <span>Wall</span>
          </button>
          <button type="button" class="tb-su-tile" data-su-shape="block">
            <svg viewBox="0 0 24 14" width="20" height="12" aria-hidden="true"><polygon points="5,5 12,2 19,5 12,8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5,5 v5 l7,3 l7,-3 v-5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
            <span>Bunker</span>
          </button>
          <button type="button" class="tb-su-tile" data-su-shape="peak">
            <svg viewBox="0 0 24 14" width="20" height="12" aria-hidden="true"><polygon points="12,1.5 21,12 3,12" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
            <span>Peak</span>
          </button>
        </div>
        <div class="tb-su-row" role="group" aria-label="RF barrier material swatch">
          <button type="button" class="tb-su-mat is-active" data-su-mat="granite"><i class="mat-granite"></i>Granite</button>
          <button type="button" class="tb-su-mat" data-su-mat="concrete"><i class="mat-concrete"></i>Concrete</button>
          <button type="button" class="tb-su-mat" data-su-mat="foliage"><i class="mat-foliage"></i>Foliage</button>
        </div>
        <div class="tb-su-extrude">
          <span>Barrier Height</span>
          <div class="tb-su-heights" role="group" aria-label="Quick barrier height presets">
            <button type="button" class="tb-su-hbtn" data-su-height="150">150m</button>
            <button type="button" class="tb-su-hbtn" data-su-height="300">300m</button>
            <button type="button" class="tb-su-hbtn" data-su-height="600">600m</button>
            <button type="button" class="tb-su-hbtn" data-su-height="1000">1000m</button>
          </div>
        </div>
      `;
      const actionBar = obsPane.querySelector('.tb-action-bar');
      if (actionBar && actionBar.nextSibling) {
        obsPane.insertBefore(tray, actionBar.nextSibling);
      } else {
        obsPane.prepend(tray);
      }

      const syncShapeTiles = () => {
        const v = shapeSel?.value || 'wall';
        tray.querySelectorAll('.tb-su-tile').forEach((el) => {
          el.classList.toggle('is-active', el.getAttribute('data-su-shape') === v);
        });
      };
      const syncMatTiles = () => {
        const v = matSel?.value || 'granite';
        tray.querySelectorAll('.tb-su-mat').forEach((el) => {
          el.classList.toggle('is-active', el.getAttribute('data-su-mat') === v);
        });
      };

      tray.querySelectorAll('.tb-su-tile').forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = btn.getAttribute('data-su-shape') || 'wall';
          if (shapeSel) {
            shapeSel.value = val;
            shapeSel.dispatchEvent(new Event('change', { bubbles: true }));
          }
          syncShapeTiles();
          deps.onObstacleStyleChange?.();
        });
      });
      tray.querySelectorAll('.tb-su-mat').forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = btn.getAttribute('data-su-mat') || 'granite';
          if (matSel) {
            matSel.value = val;
            matSel.dispatchEvent(new Event('change', { bubbles: true }));
          }
          syncMatTiles();
          deps.onObstacleStyleChange?.();
        });
      });
      tray.querySelectorAll('.tb-su-hbtn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const h = Number(btn.getAttribute('data-su-height') || '300');
          deps.onSetActiveObstacleHeight?.(h);
          tray.querySelectorAll('.tb-su-hbtn').forEach((el) => {
            el.classList.toggle('is-active', el === btn);
          });
        });
      });
      shapeSel?.addEventListener('change', () => {
        syncShapeTiles();
        deps.onObstacleStyleChange?.();
      });
      matSel?.addEventListener('change', () => {
        syncMatTiles();
        deps.onObstacleStyleChange?.();
      });
      syncShapeTiles();
      syncMatTiles();
    }

    // Mount Workspace Tiles concurrent multi-panel overlay on radar map
    if (deps.getWorkspaceTelemetryInput && !workspaceTiles) {
      workspaceTiles = createWorkspaceTilesManager({
        getTelemetryInput: deps.getWorkspaceTelemetryInput,
        onActivateTool: (mode, autoArm) => deps.onActivateWorkspaceMode?.(mode, autoArm),
        onOpenInspector: (mode) => deps.onOpenWorkspaceInspector?.(mode),
        onApplyDemPreset: (presetId) => deps.onApplyDemPreset?.(presetId),
        onFitDem: () => deps.onFitDem?.(),
        onStartMeasureTwoPoint: () => deps.onArmMeasure2Pt?.(),
        onSwapTransect: () => deps.onSwapTransectAB?.(),
        onClearMeasure: () => deps.onClearMeasure?.(),
        onArmProbePick: () => deps.onArmProbePick?.(),
        onProbeSnapBest: () => deps.onSnapProbeBestPeak?.(),
        onClearProbe: () => deps.onClearProbe?.(),
        onQuickAoBox: (sizeKm) => deps.onQuickAoBox?.(sizeKm),
        onArmRegionDraw: () => deps.onArmRegionDraw?.(),
        onArmObstaclePlace: () => deps.onArmObstaclePlace?.(),
        onBlockFirstNodeLink: () => {
          const sel = doc.getElementById('tb-obs-target-node-select') as HTMLSelectElement | null;
          let nodeId = sel && sel.value && sel.value !== 'none' ? Number(sel.value) : NaN;
          if (!Number.isFinite(nodeId)) {
            const input = deps.getWorkspaceTelemetryInput?.();
            if (typeof input?.firstGroundNodeId === 'number') nodeId = input.firstGroundNodeId;
          }
          if (Number.isFinite(nodeId)) deps.onBlockNodeLink?.(nodeId);
        },
        onAutoSizeObstacle: () => deps.onAutoSizeObstacleHeight?.(),
      });
      workspaceTiles.mount();
    }
  }

  function sync(snapshot: ToolboxPrecisionSnapshot): void {
    lastSnapshot = snapshot;
    const doc = getDoc();
    if (!doc) return;

    const setEl = (id: string, val: string) => {
      const el = doc.getElementById(id);
      if (el && el.textContent !== val) el.textContent = val;
    };

    // Sync Tool 1 Distance & Path Hero Card (supports both locked multi-segment and live rubber-band preview)
    const wps = snapshot.transectWaypoints ?? [];
    const rb = snapshot.rubberBandPoint ?? null;
    const isPreview = Boolean(rb && wps.length >= 1);
    const effectivePts = isPreview
      ? [...wps, { xM: Number(rb!.xM ?? rb!.x ?? 0), yM: Number(rb!.yM ?? rb!.y ?? 0) }]
      : wps;
    const rm = isPreview
      ? (snapshot.rulerPreviewMetrics ?? snapshot.rulerMetrics ?? null)
      : (snapshot.rulerMetrics ?? null);
    const re = isPreview
      ? (snapshot.rulerPreviewEval ?? snapshot.rulerEvaluation ?? null)
      : (snapshot.rulerEvaluation ?? null);
    const verdictEl = doc.getElementById('tb-cad-los-verdict');
    if (effectivePts.length >= 2) {
      const segA = effectivePts[effectivePts.length - 2];
      const segB = effectivePts[effectivePts.length - 1];
      const elevDeltaM = resolveRulerElevationDeltaM(rm) ?? 0;
      const delta = computeAutoCadOrthogonalDelta(segA, segB, 0, elevDeltaM);
      const slantM = resolveRulerSlantDistanceM(rm) ?? delta.slant3dM;
      setEl('tb-cad-dist-2d', formatLen(rm?.horizontalDistanceM ?? delta.dist2dM));
      setEl('tb-cad-slant-3d', formatLen(slantM));
      setEl('tb-cad-dx', `${delta.deltaXM >= 0 ? '+' : ''}${formatLen(delta.deltaXM)}`);
      setEl('tb-cad-dy', `${delta.deltaYM >= 0 ? '+' : ''}${formatLen(delta.deltaYM)}`);
      setEl('tb-cad-dz', formatElev(elevDeltaM));
      const azDeg = rm?.azimuthDeg ?? delta.azimuthDeg;
      const oct = rm?.cardinalOctant || azimuthToCardinal16(azDeg);
      setEl('tb-cad-az', `${azDeg.toFixed(0)}° ${oct}`);
      if (verdictEl) {
        if (re && re.isLineOfSightClear === false) {
          verdictEl.textContent = 'BLOCKED';
          verdictEl.dataset.tone = 'blocked';
        } else if (re && re.isLineOfSightClear === true) {
          verdictEl.textContent = 'CLEAR LOS';
          verdictEl.dataset.tone = 'clear';
        } else {
          verdictEl.textContent = isPreview ? 'AIMING' : 'LOCKED';
          verdictEl.dataset.tone = 'idle';
        }
      }
    } else {
      setEl('tb-cad-dist-2d', '--');
      setEl('tb-cad-slant-3d', '--');
      setEl('tb-cad-dx', '--');
      setEl('tb-cad-dy', '--');
      setEl('tb-cad-dz', '--');
      setEl('tb-cad-az', '--°');
      if (verdictEl) {
        verdictEl.textContent = wps.length === 1 ? 'PICK B' : 'READY';
        verdictEl.dataset.tone = 'idle';
      }
    }

    // Sync Tool 2 Link Quality Gauge (preserve previous reading on partial syncs)
    if (snapshot.cursorProbeLive !== undefined) {
      const probe = snapshot.cursorProbeLive ?? null;
      const meterState = computeRfSinrMeterState(probe?.estSinrDb, probe?.isLos ?? true);
      const barFill = doc.getElementById('tb-rf-bar-fill');
      const meterStatus = doc.getElementById('tb-rf-meter-status');
      if (barFill) {
        barFill.style.width = `${meterState.fillPct.toFixed(1)}%`;
        barFill.dataset.tone = meterState.tone;
      }
      if (meterStatus) {
        meterStatus.dataset.tone = meterState.tone;
        if (Number.isFinite(probe?.estSinrDb as number)) {
          const qualityWord =
            meterState.tone === 'shadowed'
              ? 'Blocked'
              : meterState.tone === 'marginal'
                ? 'Weak'
                : 'Strong';
          meterStatus.textContent = `${qualityWord} · ${(probe!.estSinrDb as number).toFixed(1)} dB (${meterState.bandLabel})`;
        } else {
          meterStatus.textContent = 'Click map to test';
        }
      }
    }

    // Sync Tool 2b Signal Propagation Heat Map Controls, Legend & Coverage Stats
    const hmCfg = snapshot.probeHeatmapConfig;
    const vs = snapshot.viewshedResult;
    if (hmCfg) {
      const toggleEl = doc.getElementById('tb-probe-hm-toggle') as HTMLInputElement | null;
      if (toggleEl) toggleEl.checked = hmCfg.enabled;
      setEl('tb-probe-hm-toggle-lbl', hmCfg.enabled ? 'Overlay On' : 'Overlay Off');
      const controlsWrap = doc.getElementById('tb-probe-hm-controls');
      controlsWrap?.classList.toggle('is-disabled', !hmCfg.enabled);

      doc.querySelectorAll<HTMLButtonElement>('#tb-probe-heatmap-card [data-hm-mode]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.hmMode === hmCfg.mode);
      });

      const palSel = doc.getElementById('tb-probe-hm-palette') as HTMLSelectElement | null;
      if (palSel) {
        palSel.value = hmCfg.palette;
        palSel.disabled = hmCfg.mode === 'viewshed';
      }

      const opPct = Math.round(Math.max(20, Math.min(95, hmCfg.opacity * 100)));
      const opSlider = doc.getElementById('tb-probe-hm-opacity') as HTMLInputElement | null;
      if (opSlider && doc.activeElement !== opSlider) opSlider.value = String(opPct);
      setEl('tb-probe-hm-opacity-val', `${opPct}%`);

      const isoEl = doc.getElementById('tb-probe-hm-contours') as HTMLInputElement | null;
      if (isoEl) {
        isoEl.checked = hmCfg.showContours;
        isoEl.disabled = hmCfg.mode === 'viewshed';
      }

      const rampEl = doc.getElementById('tb-probe-hm-ramp');
      if (rampEl) {
        rampEl.dataset.mode = hmCfg.mode;
        rampEl.dataset.palette = hmCfg.palette;
      }

      const scaleEl = doc.getElementById('tb-probe-hm-scale');
      if (scaleEl) {
        scaleEl.innerHTML =
          hmCfg.mode === 'viewshed'
            ? '<span>Clear</span><span>Grazing</span><span>Shadow</span><span>Barrier</span>'
            : '<span>-15 dB</span><span>0 dB</span><span>+10 dB</span><span>+20 dB</span><span>+30 dB</span>';
      }
    }
    if (vs !== undefined) {
      const s = vs?.isSiteWithinCoverage ? vs.signalSummary : null;
      if (s && s.meanSinrDb !== null && Number.isFinite(s.meanSinrDb)) {
        setEl('tb-probe-hm-usable', `${s.usableCoveragePct.toFixed(0)}%`);
        setEl('tb-probe-hm-strong', `${s.strongCoveragePct.toFixed(0)}%`);
        const meanSign = s.meanSinrDb >= 0 ? '+' : '';
        setEl('tb-probe-hm-mean', `${meanSign}${s.meanSinrDb.toFixed(1)} dB`);
        setEl('tb-probe-hm-radius', `${(vs!.radiusM / 1000).toFixed(0)} km`);
      } else {
        setEl('tb-probe-hm-usable', '--%');
        setEl('tb-probe-hm-strong', '--%');
        setEl('tb-probe-hm-mean', '-- dB');
        setEl('tb-probe-hm-radius', '-- km');
      }
    }

    // Sync Tool 3 Area Coverage Summary Bar
    const ao = snapshot.aoSwathReport ?? null;
    const cov = computeQgisCoverageBreakdown(ao?.losCoveragePct, ao?.deadZonePct);
    const segC = doc.getElementById('tb-qgis-seg-clear');
    const segM = doc.getElementById('tb-qgis-seg-marg');
    const segD = doc.getElementById('tb-qgis-seg-dead');
    if (segC) segC.style.width = `${cov.clearPct.toFixed(1)}%`;
    if (segM) segM.style.width = `${cov.marginalPct.toFixed(1)}%`;
    if (segD) segD.style.width = `${cov.deadZonePct.toFixed(1)}%`;
    setEl('tb-qgis-pct-clear', ao ? `${cov.clearPct.toFixed(0)}%` : '--%');
    setEl('tb-qgis-pct-marg', ao ? `${cov.marginalPct.toFixed(0)}%` : '--%');
    setEl('tb-qgis-pct-dead', ao ? `${cov.deadZonePct.toFixed(0)}%` : '--%');

    // Sync Tool 4 Barrier Height Buttons & Target Node Dropdown
    if (Number.isFinite(snapshot.selectedObstacleHeightM as number)) {
      const h = Math.round(snapshot.selectedObstacleHeightM as number);
      doc.querySelectorAll('#tb-sketchup-tray .tb-su-hbtn').forEach((el) => {
        el.classList.toggle('is-active', Number(el.getAttribute('data-su-height')) === h);
      });
    }
    syncNodeDropdown(doc, snapshot.groundNodes);
    workspaceTiles?.sync();
  }

  return { mount, sync };
}

// ============================================================================
// Runtime Action Bridge (Keeps index.html lean & wires 100% of toolbox controls)
// ============================================================================

export function createToolboxRuntimeBridge(rt: any): ToolboxPrecisionUiDeps {
  const redraw = () => {
    rt.markRadarDirty?.();
    if (rt.getTerrainMapMode?.() !== 'maplibre') rt.drawRadar?.();
    else {
      rt.updateMapLibreToolSources?.();
      rt.updateMapLibreOverlay?.();
    }
  };

  const getActiveObstacle = () => {
    const ed = rt.getObstacleEditor?.();
    const draft = ed?.draft || [];
    const selId = rt.getObsSelectedId?.() || ed?.selectedId;
    return draft.find((o: any) => o.id === selId) || draft[draft.length - 1] || null;
  };

  return {
    onPanNavigate: () => {
      rt.cancelTerrainTool?.();
      rt.setTbMode?.('dem', false);
      rt.setStatus?.('Map in Pan & Zoom mode.');
    },
    onFitDem: () => {
      const te = rt.getTerrainEngine?.();
      const bounds = te?.getBounds?.();
      const spanM = bounds
        ? Math.max(Math.abs(bounds.maxX - bounds.minX), Math.abs(bounds.maxY - bounds.minY))
        : 120000;
      const cx = bounds ? (bounds.minX + bounds.maxX) * 0.5 : 0;
      const cy = bounds ? (bounds.minY + bounds.maxY) * 0.5 : 0;
      rt.setPanAndRange?.(cx, cy, Math.max(20000, spanM * 0.52));
      rt.setStatus?.('Fitted map to full terrain area.');
    },
    onFitNetwork: () => {
      const tel = rt.getLatestTelemetry?.();
      const pts: Array<[number, number]> = [];
      const acn = tel?.acn_telemetry;
      if (Number.isFinite(acn?.pos_x) && Number.isFinite(acn?.pos_y)) pts.push([acn.pos_x, acn.pos_y]);
      for (const n of tel?.nodes_telemetry || []) {
        const x = Number(n.x_m ?? n.position?.[0]);
        const y = Number(n.y_m ?? n.position?.[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
      }
      if (pts.length === 0) {
        rt.setPanAndRange?.(0, 0, 45000);
      } else {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [x, y] of pts) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        const cx = (minX + maxX) * 0.5;
        const cy = (minY + maxY) * 0.5;
        const halfSpan = Math.max(15000, Math.max(maxX - minX, maxY - minY) * 0.72);
        rt.setPanAndRange?.(cx, cy, halfSpan);
      }
      rt.setStatus?.('Fitted map to aircraft and ground units.');
    },
    onSetBackdropMode: (mode) => {
      rt.setBackdropMode?.(mode);
      rt.setStatus?.(`Terrain shading switched to ${mode === 'slope' ? 'Slope' : mode === 'ridge' ? 'Ridge' : 'Relief'}.`);
    },
    onToggleLayer: (layerId, visible) => {
      rt.setLayerVisibility?.(layerId, visible);
    },
    onArmMeasure2Pt: () => {
      rt.setMeasureMode?.('transect-2pt');
      rt.setStatus?.('Click Point A on the map, then Point B to measure.');
    },
    onArmMeasurePoly: () => {
      rt.setMeasureMode?.('transect-poly');
      rt.setStatus?.('Click multiple points on the map, then click Finish.');
    },
    onFinishMeasurePoly: () => rt.finishTransectPolyline?.(),
    onClearMeasure: () => rt.clearTerrainMeasurement?.(),
    onSwapTransectAB: () => {
      const wps = rt.getTransectWaypoints?.();
      if (!Array.isArray(wps) || wps.length < 2) {
        rt.setStatus?.('Measure two points on the map first.');
        return;
      }
      rt.setTransectWaypoints?.([...wps].reverse());
      rt.recomputeTransect?.(false);
      rt.setStatus?.('Swapped Point A and Point B direction.');
      redraw();
    },
    onSpawnPeakRelay: () => {
      const evalRes = rt.getRulerEvaluation?.();
      const bp = evalRes?.blockingPeak;
      const wps = rt.getTransectWaypoints?.() || [];
      let tx: number | null = null;
      let ty: number | null = null;
      if (bp && Number.isFinite(bp.xM) && Number.isFinite(bp.yM)) {
        tx = bp.xM;
        ty = bp.yM;
      } else if (wps.length >= 2) {
        tx = (wps[0].xM + wps[1].xM) * 0.5;
        ty = (wps[0].yM + wps[1].yM) * 0.5;
      }
      if (tx === null || ty === null) {
        rt.setStatus?.('Measure a path first to place a relay.');
        return;
      }
      rt.addNodeAt?.(tx, ty, 10, 'PEAK-RELAY', 'mcp');
    },
    onTransectSettingsChange: () => {
      if ((rt.getTransectWaypoints?.() || []).length >= 2) {
        rt.recomputeTransect?.(false);
        redraw();
      }
    },
    onArmProbePick: () => {
      rt.setToolMode?.('probe');
      rt.refreshTerrainToolbox?.();
      rt.setStatus?.('Click anywhere on the map to test 8 GHz link quality.');
    },
    onSnapProbeBestPeak: () => {
      const te = rt.getTerrainEngine?.();
      const tel = rt.getLatestTelemetry?.();
      const acn = tel?.acn_telemetry || {};
      const acnPos: [number, number, number] = [
        Number.isFinite(acn.pos_x) ? acn.pos_x : 0,
        Number.isFinite(acn.pos_y) ? acn.pos_y : 0,
        Number.isFinite(acn.altitude_msl_m) ? acn.altitude_msl_m : 5000,
      ];
      const acnHeading = Number.isFinite(tel?.acn_heading_deg) ? tel.acn_heading_deg : 0;
      const cur = rt.getProbeSite?.() || { xM: rt.getPan?.()?.x ?? 0, yM: rt.getPan?.()?.y ?? 0 };
      const getElev = (x: number, y: number) => sampleDemSafe(te, x, y).elevationM || 3500;
      let bestX = cur.xM;
      let bestY = cur.yM;
      let bestScore = -Infinity;
      const mastEl = typeof document !== 'undefined' ? (document.getElementById('tb-probe-mast-input') as HTMLInputElement | null) : null;
      const mastM = Math.max(1, Math.min(200, parseFloat(mastEl?.value || '2') || 2));
      const radii = [0, 500, 1000, 1500, 2000];
      for (const r of radii) {
        const steps = r === 0 ? 1 : 12;
        for (let i = 0; i < steps; i++) {
          const ang = (i / steps) * TAU;
          const x = cur.xM + Math.cos(ang) * r;
          const y = cur.yM + Math.sin(ang) * r;
          const probe = evaluateCursorRfProbe({ xM: x, yM: y }, mastM, acnPos, acnHeading, getElev, null);
          const score = (probe.isLos ? 100 : 0) + (Number.isFinite(probe.estSinrDb) ? probe.estSinrDb : -50);
          if (score > bestScore) {
            bestScore = score;
            bestX = x;
            bestY = y;
          }
        }
      }
      const geo = cartesianToGeodetic(bestX, bestY);
      rt.setProbeSite?.({ xM: bestX, yM: bestY, lng: geo.lonDeg, lat: geo.latDeg });
      rt.setToolMode?.('idle');
      rt.recomputeProbeAnalysis?.();
      rt.refreshTerrainToolbox?.();
      rt.setStatus?.(`Snapped to best nearby signal peak (${geo.latDeg.toFixed(3)}°N, ${geo.lonDeg.toFixed(3)}°E).`);
      redraw();
    },
    onClearProbe: () => {
      rt.clearProbe?.();
      rt.setStatus?.('Signal probe cleared.');
      redraw();
    },
    onDeployProbeUnit: (unitType) => {
      const site = rt.getProbeSite?.();
      if (!site) {
        rt.setStatus?.('Click on the map to pick a probe site first.');
        return;
      }
      if (unitType === 'jammer') {
        rt.sendCommand?.({ type: 'CONFIG_UPDATE', params: { jammer_x_m: site.xM, jammer_y_m: site.yM, jammer_active: true } });
        rt.setStatus?.(`Relocated EW Jammer to (${Math.round(site.xM)}, ${Math.round(site.yM)}) m.`);
      } else {
        const role = unitType === 'mcp' ? 'mcp' : 'soldier';
        const mastEl = typeof document !== 'undefined' ? (document.getElementById('tb-probe-mast-input') as HTMLInputElement | null) : null;
        const parsedMast = parseFloat(mastEl?.value || '');
        const agl = Number.isFinite(parsedMast) && parsedMast > 2 ? parsedMast : (role === 'mcp' ? 8 : 2);
        rt.addNodeAt?.(site.xM, site.yM, agl, role === 'mcp' ? 'PROBE-MCP' : 'PROBE-UNIT', role);
      }
    },
    onProbeSettingsChange: () => {
      if (rt.getProbeSite?.()) {
        rt.recomputeProbeAnalysis?.();
        redraw();
      }
    },
    onProbeHeatmapConfigChange: (patch) => {
      rt.updateProbeHeatmapConfig?.(patch);
    },
    onArmRegionDraw: () => {
      rt.startRegionDraw?.();
      rt.setStatus?.('Click 3 or more corners on the map, then click Finish.');
    },
    onFinishRegionDraw: () => rt.finishTerrainRegion?.(),
    onCancelRegionDraw: () => rt.cancelTerrainTool?.(),
    onQuickAoBox: (sizeKm) => {
      const pan = rt.getPan?.() || { x: 0, y: 0 };
      const half = sizeKm * 500;
      rt.setAoSwathBox?.({ x1: pan.x - half, y1: pan.y - half, x2: pan.x + half, y2: pan.y + half });
      rt.setToolMode?.('idle');
      const areaEl = typeof document !== 'undefined' ? document.getElementById('tb-region-live-area') : null;
      if (areaEl) areaEl.textContent = `Area: ${(sizeKm * sizeKm).toFixed(0)} km²`;
      rt.recomputeRegionZonal?.();
      rt.refreshTerrainToolbox?.();
      rt.setStatus?.(`Scanned ${sizeKm}×${sizeKm} km area centered on view. Drag corners to resize.`);
      redraw();
    },
    onDeployAoSquad: () => {
      const rep = rt.getAoSwathReport?.();
      const coords = rep?.squadDeployCoords;
      if (!Array.isArray(coords) || coords.length === 0) {
        rt.setStatus?.('Run an area scan first to deploy a squad.');
        return;
      }
      coords.slice(0, 4).forEach((c: any, idx: number) => {
        rt.sendCommand?.(buildNodeAddCommand({ xM: c.xM, yM: c.yM, aglM: 2, role: 'soldier', callsign: `SQD-${idx + 1}` }));
      });
      rt.setStatus?.(`Deployed ${Math.min(4, coords.length)}-unit squad across best coverage cells.`);
    },
    onSpawnAoSummitRelay: () => {
      const peak = rt.getAoSwathReport?.()?.summitPeak;
      if (!peak || !Number.isFinite(peak.xM)) {
        rt.setStatus?.('Run an area scan first to find the summit.');
        return;
      }
      rt.addNodeAt?.(peak.xM, peak.yM, 10, 'SUMMIT-MCP', 'mcp');
    },
    onRegionListAction: (action, regionId, value) => {
      rt.handleRegionListAction?.(action, regionId, value);
    },
    onArmBridgePick: (slot) => {
      rt.setToolMode?.(slot === 'A' ? 'bridge-a' : 'bridge-b');
      rt.refreshTerrainToolbox?.();
      rt.setStatus?.(`Click on the map to set Bridge Endpoint ${slot}.`);
    },
    onFindBridge: () => rt.runBridgeFinder?.(),
    onClearBridge: () => rt.clearBridge?.(),
    onArmObstaclePlace: () => {
      rt.setToolMode?.('obstacle-place');
      rt.refreshTerrainToolbox?.();
      rt.setStatus?.('Drag on the map to draw a 3D wall, or click to drop a barrier.');
    },
    onUndoObstacle: () => {
      const hist = rt.getObstacleHistory?.();
      const ed = rt.getObstacleEditor?.();
      if (!hist || !ed) return;
      const prev = hist.undo?.(ed.draft);
      if (prev) {
        rt.applyObstacleHistoryChange?.(prev);
        rt.syncObstacleFieldMirror?.(true);
        rt.recomputeCadObstacleAnalysis?.();
        rt.setStatus?.('Undid last barrier edit.');
      }
    },
    onRedoObstacle: () => {
      const hist = rt.getObstacleHistory?.();
      const ed = rt.getObstacleEditor?.();
      if (!hist || !ed) return;
      const next = hist.redo?.(ed.draft);
      if (next) {
        rt.applyObstacleHistoryChange?.(next);
        rt.syncObstacleFieldMirror?.(true);
        rt.recomputeCadObstacleAnalysis?.();
        rt.setStatus?.('Redid barrier edit.');
      }
    },
    onClearObstacles: () => {
      const ed = rt.getObstacleEditor?.();
      if (!ed || !ed.draft?.length) return;
      rt.getObstacleHistory?.()?.pushState?.(ed.draft);
      rt.setObsSelectedId?.(null);
      rt.applyObstacleHistoryChange?.([]);
      rt.syncObstacleFieldMirror?.(true);
      rt.recomputeCadObstacleAnalysis?.();
      rt.setStatus?.('Cleared all 3D barriers.');
    },
    onBlockNodeLink: (nodeId) => {
      const tel = rt.getLatestTelemetry?.();
      const ed = rt.getObstacleEditor?.();
      if (!ed || !tel) return;
      const node = (tel.nodes_telemetry || []).find((n: any) => Number(n.node_id) === nodeId);
      if (!node) {
        rt.setStatus?.('Pick an active ground node to block its link.');
        return;
      }
      const acn = tel.acn_telemetry || {};
      const acnPos = {
        x: Number.isFinite(acn.pos_x) ? acn.pos_x : 0,
        y: Number.isFinite(acn.pos_y) ? acn.pos_y : 0,
        z: Number.isFinite(acn.altitude_msl_m) ? acn.altitude_msl_m : 5000,
      };
      const nx = Number(node.x_m ?? node.position?.[0] ?? 0);
      const ny = Number(node.y_m ?? node.position?.[1] ?? 0);
      const te = rt.getTerrainEngine?.();
      const getElev = (x: number, y: number) => sampleDemSafe(te, x, y).elevationM || 3500;
      const spec = generatePerpendicularLinkSlicerObstacle({ x: nx, y: ny }, acnPos, getElev, 0.35, 1600);
      const rotDeg = computeBarrierWallRotationDeg(spec.v1, spec.v2);
      const wallLen = Math.max(200, Math.hypot(spec.v2.x - spec.v1.x, spec.v2.y - spec.v1.y));
      rt.getObstacleHistory?.()?.pushState?.(ed.draft);
      ed.create('cuboid', spec.center.x, spec.center.y);
      ed.updateSelected({
        widthM: 45,
        depthM: wallLen,
        heightM: Math.min(2000, Math.max(120, Math.round(spec.optimalHeightM))),
        rotationDeg: rotDeg,
      });
      rt.setObsSelectedId?.(ed.selectedId);
      rt.syncObstacleFieldMirror?.(true);
      rt.refreshObstacleEditor?.();
      rt.renderObstacleInventoryList?.();
      rt.recomputeCadObstacleAnalysis?.();
      rt.setStatus?.(`Placed ${Math.round(spec.optimalHeightM)} m barrier across Node S${nodeId}'s link.`);
      redraw();
    },
    onAutoSizeObstacleHeight: () => {
      const obs = getActiveObstacle();
      const rep = rt.getCadObstacleReport?.();
      if (!obs || !rep || !Number.isFinite(rep.recommendedAutoHeightM)) return;
      const targetH = Math.min(2000, Math.max(50, Math.round(rep.recommendedAutoHeightM)));
      const ed = rt.getObstacleEditor?.();
      rt.getObstacleHistory?.()?.pushState?.(ed?.draft || []);
      obs.heightM = targetH;
      ed?.updateSelected?.({ heightM: targetH });
      rt.syncObstacleFieldMirror?.(true);
      rt.renderObstacleInventoryList?.();
      rt.recomputeCadObstacleAnalysis?.();
      rt.setStatus?.(`Auto-sized barrier height to ${targetH} m to block intersected links.`);
      redraw();
    },
    onObstacleStyleChange: () => {
      rt.recomputeCadObstacleAnalysis?.();
      redraw();
    },
    onSetActiveObstacleHeight: (hM) => {
      const obs = getActiveObstacle();
      if (!obs) {
        rt.setStatus?.('Draw or select a barrier first, then pick its height.');
        return;
      }
      const ed = rt.getObstacleEditor?.();
      rt.getObstacleHistory?.()?.pushState?.(ed?.draft || []);
      obs.heightM = hM;
      ed?.updateSelected?.({ heightM: hM });
      rt.syncObstacleFieldMirror?.(true);
      rt.renderObstacleInventoryList?.();
      rt.recomputeCadObstacleAnalysis?.();
      rt.setStatus?.(`Barrier height set to ${hM} m.`);
      redraw();
    },
    getWorkspaceTelemetryInput: (): WorkspaceTilesTelemetryInput => {
      const snap = rt.getWorkspaceSnapshot?.() || {};
      const te = rt.getTerrainEngine?.();
      const tel = rt.getLatestTelemetry?.();
      const ed = rt.getObstacleEditor?.();
      const nodes = Array.isArray(tel?.nodes_telemetry) ? tel.nodes_telemetry : [];
      const firstNode = nodes.find((n: any) => Number.isFinite(Number(n?.node_id)));
      const meta = te?.getMetadata?.() || te?.metadata || null;
      const sectorEl =
        typeof document !== 'undefined'
          ? (document.getElementById('dem-sector-select') as HTMLSelectElement | null)
          : null;
      const elevRange = te?.getElevationRange?.() || null;
      return {
        activeMode: snap.activeMode,
        toolMode: snap.toolMode,
        stageViewMode: snap.stageViewMode,
        radarRangeM: snap.radarRangeM,
        backdropMode: snap.backdropMode,
        terrainSource: meta?.source || (te?.mode === 'real' ? 'Ladakh SRTM' : 'Synthetic DEM'),
        terrainSector: sectorEl?.value || te?.biomeId || '',
        terrainElevMinM: Number.isFinite(elevRange?.min) ? elevRange.min : (Number.isFinite(meta?.minElevM) ? meta.minElevM : null),
        terrainElevMaxM: Number.isFinite(elevRange?.max) ? elevRange.max : (Number.isFinite(meta?.maxElevM) ? meta.maxElevM : null),
        terrainGridSize: meta?.width && meta?.height ? `${meta.width}×${meta.height}` : '512×512',
        transectWaypoints: snap.transectWaypoints,
        transectResult: snap.transectResult,
        rulerMetrics: snap.rulerMetrics,
        rulerEvaluation: snap.rulerEvaluation,
        transectSnrLabel:
          typeof document !== 'undefined'
            ? (document.getElementById('tb-transect-snr')?.textContent?.trim() || '')
            : '',
        transectFresnelLabel:
          typeof document !== 'undefined'
            ? (document.getElementById('tb-transect-fresnel')?.textContent?.trim() || '')
            : '',
        probeSite: snap.probeSite,
        cursorProbeLive: snap.cursorProbeLive,
        viewshedResult: snap.viewshedResult,
        aoSwathBox: snap.aoSwathBox,
        aoSwathReport: snap.aoSwathReport,
        obstacles: ed?.draft || [],
        obsSelectedId: rt.getObsSelectedId?.() ?? ed?.selectedId ?? null,
        cadObstacleReport: rt.getCadObstacleReport?.() ?? null,
        groundNodeCount: nodes.length,
        firstGroundNodeId: firstNode ? Number(firstNode.node_id) : null,
      };
    },
    onActivateWorkspaceMode: (mode, autoArm) => {
      rt.setTbMode?.(mode, autoArm);
      rt.refreshTerrainToolbox?.();
    },
    onOpenWorkspaceInspector: (mode) => {
      rt.openToolboxInspector?.(mode);
    },
    onApplyDemPreset: (presetId) => {
      rt.applyDemQuickPreset?.(presetId);
    },
  };
}
