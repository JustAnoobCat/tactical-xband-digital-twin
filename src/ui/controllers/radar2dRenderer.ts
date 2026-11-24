/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Strictly Typed 2D Radar Canvas Renderer & Precision Overlays (SPEC-V3-10)
 *
 * Extracted from monolithic index.html into a modular, headless-testable,
 * strictly typed controller.
 *
 * Responsibilities:
 * 1. Pure 2D Radar coordinate transforms (ENU <-> Radar Screen Canvas).
 * 2. Hit-testing for comm links, ground nodes, and CAD obstacle handles.
 * 3. 4 CAD Precision Tool Overlays:
 *    - Tool #1: Geodetic & RF Ruler overlay (Fresnel clearance, blocking crests)
 *    - Tool #2: Precision Cursor Signal Probe overlay (concentric rings, live SNR)
 *    - Tool #3: Area of Operations (AO) Swath Coverage overlay (grid, corners)
 *    - Tool #4: CAD Precision Obstacle & Link Slicer overlay (barriers, handles)
 * 4. Master 2D Radar Scene Renderer:
 *    - Matte basalt tactical canvas base
 *    - Terrain hillshade/relief with authoritative aspect ratio
 *    - DEM boundary and coverage indicators
 *    - Cartographic overlays (metric scale bar, true north rose, MGRS 10km grid)
 *    - Comm links with dynamic coloring, Fresnel zones, and line-of-sight status
 *    - ACN orbit trail, heading indicator, and secondary constellation relays
 *    - Ground nodes (MCPs, soldiers, labels using LabelPlacer de-cluttering)
 */

import { createLabelPlacer, CanvasLabelPlacer } from '../canvasLabelPlacer';
import { drawCartographicOverlays } from '../cartographyRenderer';
import { HIGHLAND_THEME } from '../workbench/chartTheme';
import {
  computeTerrainScreenBounds,
  computeDemBoundaryGeometry,
  renderDemCoverageBoundary,
} from '../terrainMapRenderer';
import {
  classifyAndStyleLink,
  getMapLinkStyle,
  getStatusBadgeInfo,
} from '../mapLinkStyles';
import { cartesianToGeodetic } from '../../core/geodesy';
import { obstacleContainsPoint } from '../../core/obstacles';
import { escapeHtml } from '../domSafety';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface RadarViewport {
  readonly width: number;
  readonly height: number;
  readonly rangeM: number;
  readonly panOffsetX_m?: number;
  readonly panOffsetY_m?: number;
}

export interface RadarPoint2D {
  readonly x: number;
  readonly y: number;
}

export interface RadarWorldPoint2D {
  readonly xM: number;
  readonly yM: number;
}

export interface ObstacleEndpoints {
  readonly v1: RadarPoint2D;
  readonly v2: RadarPoint2D;
  readonly center: RadarPoint2D;
  readonly lengthM: number;
  readonly heightM: number;
  readonly shape: string;
  readonly material: string;
}

export interface Radar2dRendererDeps {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly getRangeM: () => number;
  readonly getPanOffset: () => { xM: number; yM: number };
  readonly getStageViewMode: () => string;
  readonly getTerrainMapMode: () => string;
  readonly getLatestTelemetry: () => any;
  readonly getHistoricalSnapshot: () => any;
  readonly getActiveTerrainBounds: () => any;
  readonly getHillshadeCanvas: () => HTMLCanvasElement | null;
  readonly getBackdropCanvas: () => HTMLCanvasElement | null;
  readonly getBackdropMode: () => string;
  readonly getMapLayerRegistry: () => any;
  readonly getContextualMapContext: () => any;
  readonly getSelectedNodeId: () => number | string | null;
  readonly getToolboxState: () => any;
  readonly getObstacleEditor: () => any;
  readonly isMgrsGridActive: () => boolean;
  readonly onSelectNode?: (nodeId: number) => void;
  readonly onDismissInspector?: () => void;
  readonly markDirty?: () => void;
  readonly setRangeM?: (rangeM: number) => void;
  readonly setPanOffset?: (xM: number, yM: number) => void;
}

const TAU = Math.PI * 2;
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// ============================================================================
// Pure Coordinate Transforms
// ============================================================================

/**
 * Computes radar canvas projection center and scale factor.
 */
export function getRadarGeometry(w: number, h: number, rangeM: number): {
  centerX: number;
  centerY: number;
  scale: number;
} {
  const centerX = w / 2;
  const centerY = h / 2;
  const validRange = Number.isFinite(rangeM) && rangeM > 0 ? rangeM : 60000;
  const scale = (Math.min(centerX, centerY) * 0.94) / validRange;
  return { centerX, centerY, scale };
}

/**
 * Projects local ENU coordinates (meters) to radar canvas screen pixels.
 */
export function worldEnuToRadarCanvas(
  xM: number,
  yM: number,
  viewport: RadarViewport
): RadarPoint2D {
  const g = getRadarGeometry(viewport.width, viewport.height, viewport.rangeM);
  const panX = viewport.panOffsetX_m ?? 0;
  const panY = viewport.panOffsetY_m ?? 0;
  return {
    x: g.centerX + (xM - panX) * g.scale,
    y: g.centerY - (yM - panY) * g.scale,
  };
}

/**
 * Un-projects radar canvas screen pixels to local ENU coordinates (meters).
 */
export function radarCanvasToWorldEnu(
  canvasX: number,
  canvasY: number,
  viewport: RadarViewport
): RadarWorldPoint2D {
  const g = getRadarGeometry(viewport.width, viewport.height, viewport.rangeM);
  const panX = viewport.panOffsetX_m ?? 0;
  const panY = viewport.panOffsetY_m ?? 0;
  return {
    xM: (canvasX - g.centerX) / g.scale + panX,
    yM: (g.centerY - canvasY) / g.scale + panY,
  };
}

// ============================================================================
// Pure Obstacle & Hit-Testing Utilities
// ============================================================================

/**
 * Calculates geometric endpoints and center for an obstacle.
 */
export function getObstacleEndpoints(obs: any): ObstacleEndpoints | null {
  if (!obs) return null;
  const cx = Number(obs.xM ?? obs.x_m ?? 0);
  const cy = Number(obs.yM ?? obs.y_m ?? 0);
  if (obs.shape === 'cone') {
    const r = Number(obs.radiusM ?? obs.radius_m ?? 100);
    return {
      v1: { x: cx - r, y: cy },
      v2: { x: cx + r, y: cy },
      center: { x: cx, y: cy },
      lengthM: r * 2,
      heightM: Number(obs.heightM ?? obs.height_m ?? 120),
      shape: 'peak',
      material: 'granite',
    };
  }
  const w = Number(obs.widthM ?? obs.width_m ?? 40);
  const d = Number(obs.depthM ?? obs.depth_m ?? 500);
  const rotRad = ((Number(obs.rotationDeg ?? obs.rotation_deg ?? 0)) * Math.PI) / 180.0;
  const len = Math.max(w, d);
  const halfL = len * 0.5;
  let nx = 0;
  let ny = 0;
  if (d >= w) {
    nx = -Math.sin(rotRad);
    ny = Math.cos(rotRad);
  } else {
    nx = Math.cos(rotRad);
    ny = Math.sin(rotRad);
  }
  return {
    v1: { x: cx - nx * halfL, y: cy - ny * halfL },
    v2: { x: cx + nx * halfL, y: cy + ny * halfL },
    center: { x: cx, y: cy },
    lengthM: len,
    heightM: Number(obs.heightM ?? obs.height_m ?? 120),
    shape: obs.shape || 'wall',
    material: 'granite',
  };
}

/**
 * Tests if screen coordinate hit an obstacle handle (V1, V2, or CENTER).
 */
export function findCadObstacleHandleHit(
  px: number,
  py: number,
  viewport: RadarViewport,
  targetObs: any,
  projectFn?: (xM: number, yM: number) => RadarPoint2D
): { handle: string; obstacle: any } | null {
  if (!targetObs) return null;
  const project = projectFn || ((xM: number, yM: number) => worldEnuToRadarCanvas(xM, yM, viewport));
  const ep = getObstacleEndpoints(targetObs);
  if (!ep) return null;

  const p1 = project(ep.v1.x, ep.v1.y);
  const p2 = project(ep.v2.x, ep.v2.y);
  const pc = project(ep.center.x, ep.center.y);
  const hitDistPx = 14;

  if (p1 && Math.hypot(px - p1.x, py - p1.y) <= hitDistPx) {
    return { handle: 'V1', obstacle: targetObs };
  }
  if (p2 && Math.hypot(px - p2.x, py - p2.y) <= hitDistPx) {
    return { handle: 'V2', obstacle: targetObs };
  }
  if (pc && Math.hypot(px - pc.x, py - pc.y) <= hitDistPx) {
    return { handle: 'CENTER', obstacle: targetObs };
  }
  return null;
}

/**
 * Tests if screen coordinate hit an Area of Operations (AO) swath corner.
 */
export function findAoSwathCornerHit(
  px: number,
  py: number,
  viewport: RadarViewport,
  box: { x1: number; y1: number; x2: number; y2: number } | null,
  thresholdPx = 14,
  projectFn?: (xM: number, yM: number) => RadarPoint2D
): string | null {
  if (!box) return null;
  const project = projectFn || ((xM: number, yM: number) => worldEnuToRadarCanvas(xM, yM, viewport));
  const minX = Math.min(box.x1, box.x2);
  const maxX = Math.max(box.x1, box.x2);
  const minY = Math.min(box.y1, box.y2);
  const maxY = Math.max(box.y1, box.y2);

  const corners: Array<{ id: string; p: RadarPoint2D }> = [
    { id: 'NW', p: project(minX, maxY) },
    { id: 'NE', p: project(maxX, maxY) },
    { id: 'SW', p: project(minX, minY) },
    { id: 'SE', p: project(maxX, minY) },
  ];

  for (const c of corners) {
    if (c.p && Math.hypot(px - c.p.x, py - c.p.y) <= thresholdPx) {
      return c.id;
    }
  }
  return null;
}

/**
 * Hit-test links between primary ACN and ground nodes.
 */
export function hitTestRadarLink(
  px: number,
  py: number,
  viewport: RadarViewport,
  acnPosWorld: { x: number; y: number },
  nodes: ReadonlyArray<{ nodeId: number; posX: number; posY: number }>,
  radiusPx = 6
): { nodeId: number; distance: number } | null {
  if (!acnPosWorld || !Number.isFinite(acnPosWorld.x) || !Number.isFinite(acnPosWorld.y)) {
    return null;
  }
  const a = worldEnuToRadarCanvas(acnPosWorld.x, acnPosWorld.y, viewport);
  let bestNode: number | null = null;
  let bestDistance = radiusPx;

  for (const node of nodes) {
    const b = worldEnuToRadarCanvas(node.posX, node.posY, viewport);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const denominator = dx * dx + dy * dy;
    const t = denominator ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / denominator)) : 0;
    const distance = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestNode = node.nodeId;
    }
  }

  return bestNode !== null ? { nodeId: bestNode, distance: bestDistance } : null;
}

/**
 * Hit-test ground nodes on radar canvas.
 */
export function hitTestRadarNode(
  px: number,
  py: number,
  viewport: RadarViewport,
  nodes: ReadonlyArray<{ nodeId: number; posX: number; posY: number }>,
  radiusPx = 14
): { nodeId: number; distance: number } | null {
  let bestNode: number | null = null;
  let bestDistance = radiusPx;

  for (const node of nodes) {
    const sp = worldEnuToRadarCanvas(node.posX, node.posY, viewport);
    const dist = Math.hypot(px - sp.x, py - sp.y);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestNode = node.nodeId;
    }
  }

  return bestNode !== null ? { nodeId: bestNode, distance: bestDistance } : null;
}

// ============================================================================
// Precision Overlay Renderers
// ============================================================================

export function renderPrecisionCadObstacleOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tbState: any,
  viewport: RadarViewport,
  projectFn?: (xM: number, yM: number) => RadarPoint2D
): void {
  const isObsActive = tbState?.activeMode === 'obstacle' || tbState?.toolMode === 'obstacle-place';
  if (!isObsActive && !tbState?.obsDrawingAnchor && !tbState?.cadObstacleReport) return;

  const project = projectFn || ((xM: number, yM: number) => worldEnuToRadarCanvas(xM, yM, viewport));
  ctx.save();

  // 1. Rubber-band line while drawing
  if (tbState?.obsDrawingAnchor && tbState?.obsRubberBandPoint) {
    const pA = project(tbState.obsDrawingAnchor.x, tbState.obsDrawingAnchor.y);
    const pB = project(tbState.obsRubberBandPoint.x, tbState.obsRubberBandPoint.y);
    if (pA && pB) {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#00e5ff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pA.x, pA.y, 6, 0, TAU);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pB.x, pB.y, 6, 0, TAU);
      ctx.fill();
      ctx.stroke();

      ctx.font = `bold 9px ${MONO}`;
      ctx.fillStyle = '#00e5ff';
      ctx.fillText('[V1]', pA.x + 8, pA.y - 6);
      ctx.fillText('[V2]', pB.x + 8, pB.y - 6);
    }
  }

  ctx.restore();
}

export function renderGeodeticRulerOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tbState: any,
  viewport: RadarViewport,
  projectFn?: (xM: number, yM: number) => RadarPoint2D
): void {
  const waypoints = tbState?.transectWaypoints || [];
  if (waypoints.length === 0 && !tbState?.rubberBandPoint) return;

  const project = projectFn || ((xM: number, yM: number) => worldEnuToRadarCanvas(xM, yM, viewport));
  ctx.save();

  const p1 = waypoints[0] ? project(waypoints[0].xM, waypoints[0].yM) : null;
  const p2 = waypoints[1]
    ? project(waypoints[1].xM, waypoints[1].yM)
    : (tbState?.rubberBandPoint ? project(tbState.rubberBandPoint.x, tbState.rubberBandPoint.y) : null);

  if (p1 && p2) {
    const isLocked = waypoints.length >= 2;
    ctx.strokeStyle = isLocked ? '#38bdf8' : 'rgba(56, 189, 248, 0.7)';
    ctx.lineWidth = isLocked ? 2.5 : 1.8;
    if (!isLocked) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Endpoint badges
    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, 5, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(p2.x, p2.y, 5, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.font = `bold 9px ${MONO}`;
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('A', p1.x + 8, p1.y - 6);
    ctx.fillText('B', p2.x + 8, p2.y - 6);
  }

  ctx.restore();
}

export function renderPrecisionCursorProbeOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tbState: any,
  viewport: RadarViewport,
  projectFn?: (xM: number, yM: number) => RadarPoint2D
): void {
  const probeSite = tbState?.probeSite;
  if (!probeSite) return;

  const project = projectFn || ((xM: number, yM: number) => worldEnuToRadarCanvas(xM, yM, viewport));
  const sp = project(probeSite.xM, probeSite.yM);
  if (!sp) return;

  ctx.save();
  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);

  // Concentric probe rings
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, 18, 0, TAU);
  ctx.arc(sp.x, sp.y, 36, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  // Crosshair
  ctx.beginPath();
  ctx.moveTo(sp.x - 10, sp.y);
  ctx.lineTo(sp.x + 10, sp.y);
  ctx.moveTo(sp.x, sp.y - 10);
  ctx.lineTo(sp.x, sp.y + 10);
  ctx.stroke();

  ctx.font = `bold 10px ${MONO}`;
  ctx.fillStyle = '#a855f7';
  ctx.fillText('[P1] PROBE', sp.x + 14, sp.y - 14);
  ctx.restore();
}

export function renderPrecisionAoSwathOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tbState: any,
  viewport: RadarViewport,
  projectFn?: (xM: number, yM: number) => RadarPoint2D
): void {
  const box = tbState?.aoSwathBox;
  if (!box || tbState?.activeMode !== 'region') return;

  const project = projectFn || ((xM: number, yM: number) => worldEnuToRadarCanvas(xM, yM, viewport));
  const minX = Math.min(box.x1, box.x2);
  const maxX = Math.max(box.x1, box.x2);
  const minY = Math.min(box.y1, box.y2);
  const maxY = Math.max(box.y1, box.y2);

  const pNW = project(minX, maxY);
  const pNE = project(maxX, maxY);
  const pSE = project(maxX, minY);
  const pSW = project(minX, minY);

  if (!pNW || !pNE || !pSE || !pSW) return;

  ctx.save();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2.0;
  ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';

  ctx.beginPath();
  ctx.moveTo(pNW.x, pNW.y);
  ctx.lineTo(pNE.x, pNE.y);
  ctx.lineTo(pSE.x, pSE.y);
  ctx.lineTo(pSW.x, pSW.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Corner handles
  const corners = [pNW, pNE, pSE, pSW];
  ctx.fillStyle = '#f59e0b';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.2;
  for (const c of corners) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }

  ctx.font = `bold 10px ${MONO}`;
  ctx.fillStyle = '#f59e0b';
  ctx.fillText('AO SWATH', pNW.x + 6, pNW.y + 14);
  ctx.restore();
}

// ============================================================================
// Factory: createRadar2dRenderer
// ============================================================================

export function createRadar2dRenderer(deps: Radar2dRendererDeps) {
  let activeLabelPlacer: CanvasLabelPlacer | null = null;

  const getViewport = (w: number, h: number): RadarViewport => {
    const pan = deps.getPanOffset();
    return {
      width: w,
      height: h,
      rangeM: deps.getRangeM(),
      panOffsetX_m: pan.xM,
      panOffsetY_m: pan.yM,
    };
  };

  const worldToScreen = (xM: number, yM: number, w?: number, h?: number): RadarPoint2D => {
    const width = w ?? (deps.canvas.parentElement?.clientWidth || deps.canvas.width || 600);
    const height = h ?? (deps.canvas.parentElement?.clientHeight || deps.canvas.height || 500);
    return worldEnuToRadarCanvas(xM, yM, getViewport(width, height));
  };

  const screenToWorld = (px: number, py: number, w?: number, h?: number): RadarWorldPoint2D => {
    const width = w ?? (deps.canvas.parentElement?.clientWidth || deps.canvas.width || 600);
    const height = h ?? (deps.canvas.parentElement?.clientHeight || deps.canvas.height || 500);
    return radarCanvasToWorldEnu(px, py, getViewport(width, height));
  };

  const renderRadar = () => {
    const cvs = deps.canvas;
    if (!cvs || deps.getStageViewMode() === '3d') return;

    const w = cvs.parentElement?.clientWidth || cvs.width || 600;
    const h = cvs.parentElement?.clientHeight || cvs.height || 500;
    if (w <= 0 || h <= 0) return;

    const ctx = deps.ctx;
    ctx.clearRect(0, 0, w, h);

    const vp = getViewport(w, h);
    const geometry = getRadarGeometry(w, h, vp.rangeM);
    const focusCtx = deps.getContextualMapContext();
    const mapLayers = deps.getMapLayerRegistry();

    // 1. Base substrate
    ctx.fillStyle = HIGHLAND_THEME.substrate.void;
    ctx.fillRect(0, 0, w, h);

    // 2. Terrain DEM / hillshade if enabled
    const visTerrainDem = mapLayers?.getEffectiveVisibility('base.terrainDem', focusCtx) ?? true;
    const opTerrainDem = mapLayers?.getLayerOpacity('base.terrainDem') ?? 0.8;
    const activeBackdrop = deps.getBackdropMode() !== 'relief' ? deps.getBackdropCanvas() : deps.getHillshadeCanvas();

    if (activeBackdrop && visTerrainDem) {
      const terrainBounds = computeTerrainScreenBounds(
        deps.getActiveTerrainBounds(),
        300000,
        geometry,
        deps.getPanOffset()
      );
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = opTerrainDem;
      ctx.drawImage(activeBackdrop, terrainBounds.tl.x, terrainBounds.tl.y, terrainBounds.width, terrainBounds.height);
      ctx.restore();

      // Satellite DEM coverage boundary if in real mode
      const visDemBoundary = mapLayers?.getEffectiveVisibility('base.demBoundary', focusCtx) ?? true;
      if (visDemBoundary && terrainBounds.isRealMode) {
        const boundaryGeom = computeDemBoundaryGeometry(terrainBounds, w, h, deps.getActiveTerrainBounds());
        if (boundaryGeom) {
          renderDemCoverageBoundary(ctx, boundaryGeom, MONO);
        }
      }
    }

    // 3. Label placer initialization
    activeLabelPlacer = createLabelPlacer(w, h, 4, 3);
    activeLabelPlacer.reserveRect(0, 0, 48, h);
    activeLabelPlacer.reserveRect(Math.max(0, w - 122), Math.max(0, h - 42), 114, 34);
    activeLabelPlacer.reserveRect(8, Math.max(0, h - 38), 256, 30);

    // 4. Cartographic Overlays (Scale bar, True North, optional MGRS grid)
    drawCartographicOverlays(ctx, {
      width: w,
      height: h,
      metersPerPixel: 1.0 / (geometry.scale || 1.0),
      showMgrsGrid: deps.isMgrsGridActive(),
      screenToWorld: (sx, sy) => {
        const pt = screenToWorld(sx, sy, w, h);
        return { x: pt.xM, y: pt.yM };
      },
      worldToScreen: (wx, wy) => worldToScreen(wx, wy, w, h),
    });

    // 5. Telemetry & Links
    const isHist = Boolean(deps.getHistoricalSnapshot());
    const histSnap = isHist ? deps.getHistoricalSnapshot() : null;
    const liveTelemetry = deps.getLatestTelemetry();

    const acnPosWorld = histSnap
      ? { x: histSnap.acn.posX, y: histSnap.acn.posY }
      : { x: liveTelemetry?.acn_telemetry?.pos_x ?? 0, y: liveTelemetry?.acn_telemetry?.pos_y ?? 0 };

    const nodes = histSnap
      ? histSnap.nodes.map((n: any) => ({ nodeId: n.nodeId, posX: n.posX, posY: n.posY, snrDb: n.snrDb, isLos: n.isLos }))
      : (liveTelemetry?.nodes_telemetry || []).map((n: any) => ({
          nodeId: n.node_id,
          posX: Number(n.x_m ?? n.position?.[0] ?? 0),
          posY: Number(n.y_m ?? n.position?.[1] ?? 0),
          snrDb: n.snr_db,
          isLos: n.terrain_is_los,
        }));

    const visLinks = mapLayers?.getEffectiveVisibility('comm.links', focusCtx) ?? true;
    if (visLinks && Number.isFinite(acnPosWorld.x) && Number.isFinite(acnPosWorld.y)) {
      const acnPt = worldToScreen(acnPosWorld.x, acnPosWorld.y, w, h);
      ctx.save();
      for (const node of nodes) {
        const nodePt = worldToScreen(node.posX, node.posY, w, h);
        const isSelected = deps.getSelectedNodeId() === node.nodeId;
        const strokeColor = node.isLos ? '#10b981' : '#ef4444';

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isSelected ? 2.5 : 1.2;
        if (!node.isLos) ctx.setLineDash([4, 4]);

        ctx.beginPath();
        ctx.moveTo(acnPt.x, acnPt.y);
        ctx.lineTo(nodePt.x, nodePt.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // 6. Ground Nodes
    const visGroundNodes = mapLayers?.getEffectiveVisibility('entities.groundNodes', focusCtx) ?? true;
    if (visGroundNodes) {
      ctx.save();
      for (const node of nodes) {
        const nodePt = worldToScreen(node.posX, node.posY, w, h);
        const isSelected = deps.getSelectedNodeId() === node.nodeId;

        ctx.fillStyle = isSelected ? '#38bdf8' : '#94a3b8';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.arc(nodePt.x, nodePt.y, isSelected ? 6 : 4, 0, TAU);
        ctx.fill();
        ctx.stroke();

        ctx.font = `9px ${MONO}`;
        ctx.fillStyle = isSelected ? '#38bdf8' : '#cbd5e1';
        ctx.fillText(`S${node.nodeId}`, nodePt.x + 8, nodePt.y - 4);
      }
      ctx.restore();
    }

    // 7. Primary ACN
    const visAcn = mapLayers?.getEffectiveVisibility('entities.acn', focusCtx) ?? true;
    if (visAcn && Number.isFinite(acnPosWorld.x) && Number.isFinite(acnPosWorld.y)) {
      const acnPt = worldToScreen(acnPosWorld.x, acnPosWorld.y, w, h);
      ctx.save();
      ctx.fillStyle = '#00e5ff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2.0;

      // Triangle icon
      ctx.beginPath();
      ctx.moveTo(acnPt.x, acnPt.y - 9);
      ctx.lineTo(acnPt.x + 7, acnPt.y + 6);
      ctx.lineTo(acnPt.x - 7, acnPt.y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.font = `bold 10px ${MONO}`;
      ctx.fillStyle = '#00e5ff';
      ctx.fillText('ACN', acnPt.x + 10, acnPt.y - 4);
      ctx.restore();
    }

    // 8. Precision Tool Overlays
    const tbState = deps.getToolboxState();
    renderGeodeticRulerOverlay(ctx, w, h, tbState, vp, (xM, yM) => worldToScreen(xM, yM, w, h));
    renderPrecisionCursorProbeOverlay(ctx, w, h, tbState, vp, (xM, yM) => worldToScreen(xM, yM, w, h));
    renderPrecisionAoSwathOverlay(ctx, w, h, tbState, vp, (xM, yM) => worldToScreen(xM, yM, w, h));
    renderPrecisionCadObstacleOverlay(ctx, w, h, tbState, vp, (xM, yM) => worldToScreen(xM, yM, w, h));
  };

  const radarLinkHit = (px: number, py: number, radiusPx = 6): number | null => {
    const isHist = Boolean(deps.getHistoricalSnapshot());
    const histSnap = isHist ? deps.getHistoricalSnapshot() : null;
    const liveTelemetry = deps.getLatestTelemetry();

    const acnPosWorld = histSnap
      ? { x: histSnap.acn.posX, y: histSnap.acn.posY }
      : { x: liveTelemetry?.acn_telemetry?.pos_x ?? 0, y: liveTelemetry?.acn_telemetry?.pos_y ?? 0 };

    const nodes = histSnap
      ? histSnap.nodes.map((n: any) => ({ nodeId: n.nodeId, posX: n.posX, posY: n.posY }))
      : (liveTelemetry?.nodes_telemetry || []).map((n: any) => ({
          nodeId: n.node_id,
          posX: Number(n.x_m ?? n.position?.[0] ?? 0),
          posY: Number(n.y_m ?? n.position?.[1] ?? 0),
        }));

    const w = deps.canvas.parentElement?.clientWidth || deps.canvas.width || 600;
    const h = deps.canvas.parentElement?.clientHeight || deps.canvas.height || 500;
    const hit = hitTestRadarLink(px, py, getViewport(w, h), acnPosWorld, nodes, radiusPx);
    return hit ? hit.nodeId : null;
  };

  return {
    renderRadar,
    worldToScreen,
    screenToWorld,
    radarLinkHit,
    getRadarGeometry: (w: number, h: number) => getRadarGeometry(w, h, deps.getRangeM()),
    findCadObstacleHandleHit: (px: number, py: number) => {
      const w = deps.canvas.parentElement?.clientWidth || deps.canvas.width || 600;
      const h = deps.canvas.parentElement?.clientHeight || deps.canvas.height || 500;
      const editor = deps.getObstacleEditor();
      const targetObs = editor?.draft?.find((o: any) => o.id === editor?.selectedId);
      return findCadObstacleHandleHit(px, py, getViewport(w, h), targetObs, (x, y) => worldToScreen(x, y, w, h));
    },
    findAoSwathCornerHit: (px: number, py: number, thresholdPx = 14) => {
      const w = deps.canvas.parentElement?.clientWidth || deps.canvas.width || 600;
      const h = deps.canvas.parentElement?.clientHeight || deps.canvas.height || 500;
      const tbState = deps.getToolboxState();
      return findAoSwathCornerHit(px, py, getViewport(w, h), tbState?.aoSwathBox, thresholdPx, (x, y) => worldToScreen(x, y, w, h));
    },
    getActiveLabelPlacer: () => activeLabelPlacer,
  };
}
