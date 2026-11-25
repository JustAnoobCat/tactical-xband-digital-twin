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
import { getLatticeCanvasPalette } from '../canvasTheme';
import { drawCartographicOverlays } from '../cartographyRenderer';
import type { BiomeId } from '../../core/biomePhysics';
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
import { obstacleContainsPoint } from '../../core/obstacles';
import { escapeHtml } from '../domSafety';
import type { WorldTileLayer } from '../worldTileLayer';
import {
  formatRadarNodeTag,
  resolveRadarNodeMarkerStatus,
  type RadarCameraSignature,
  type RadarMarkerProjection,
  type RadarNodeMarkerLayer,
} from '../radarNodeMarkerLayer';
import {
  renderAutoCadRulerOverlay,
  renderCadBarrierOverlay,
  renderQgisAoSwathOverlay,
  renderRfFieldProbeOverlay,
} from '../toolboxPrecisionSuite';

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
  readonly getTerrainMode?: () => string;
  readonly getWorldTileLayer?: () => WorldTileLayer | null;
  readonly getNodeMarkerLayer?: () => RadarNodeMarkerLayer | null;
  readonly projectEnuToScreen?: (xM: number, yM: number) => RadarPoint2D | null;
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

const BIOME_AO_LABELS: Readonly<Record<string, string>> = Object.freeze({
  alpine_mountain: 'LADAKH AO',
  arid_desert: 'THAR DESERT AO',
  open_plains: 'OPEN PLAINS AO',
  tropical_jungle: 'JUNGLE AO',
  maritime_littoral: 'LITTORAL AO',
});

function resolveActiveAoLabel(activeBounds: any, telemetry: any): string {
  const biomeId = telemetry?.biome_id ?? activeBounds?.biomeId;
  if (typeof biomeId === 'string' && BIOME_AO_LABELS[biomeId]) {
    return BIOME_AO_LABELS[biomeId];
  }
  const rawTileName =
    typeof activeBounds?.tileName === 'string' && activeBounds.tileName.trim()
      ? activeBounds.tileName.trim().replace(/_/g, ' ').toUpperCase()
      : '';
  if (rawTileName) {
    return rawTileName.endsWith('AO') ? rawTileName : `${rawTileName} AO`;
  }
  return 'THEATER AO';
}

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
  const project = projectFn || ((xM: number, yM: number) => worldEnuToRadarCanvas(xM, yM, viewport));
  renderCadBarrierOverlay(ctx, w, h, tbState, viewport, project);
}

export function renderGeodeticRulerOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tbState: any,
  viewport: RadarViewport,
  projectFn?: (xM: number, yM: number) => RadarPoint2D
): void {
  const project = projectFn || ((xM: number, yM: number) => worldEnuToRadarCanvas(xM, yM, viewport));
  renderAutoCadRulerOverlay(ctx, w, h, tbState, viewport, project);
}

export function renderPrecisionCursorProbeOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tbState: any,
  viewport: RadarViewport,
  projectFn?: (xM: number, yM: number) => RadarPoint2D
): void {
  const project = projectFn || ((xM: number, yM: number) => worldEnuToRadarCanvas(xM, yM, viewport));
  renderRfFieldProbeOverlay(ctx, w, h, tbState, viewport, project);
}

export function renderPrecisionAoSwathOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tbState: any,
  viewport: RadarViewport,
  projectFn?: (xM: number, yM: number) => RadarPoint2D
): void {
  const project = projectFn || ((xM: number, yM: number) => worldEnuToRadarCanvas(xM, yM, viewport));
  renderQgisAoSwathOverlay(ctx, w, h, tbState, viewport, project);
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
    const nodeMarkerLayer = deps.getNodeMarkerLayer?.() ?? null;
    if (!cvs || deps.getStageViewMode() === '3d') {
      nodeMarkerLayer?.hide();
      return;
    }

    const w = cvs.parentElement?.clientWidth || cvs.width || 600;
    const h = cvs.parentElement?.clientHeight || cvs.height || 500;
    if (w <= 0 || h <= 0) return;

    const ctx = deps.ctx;
    ctx.clearRect(0, 0, w, h);

    const vp = getViewport(w, h);

    // In MapLibre Geo mode, MapLibre renders the geographic world basemap, DEM, links,
    // nodes, and ACN natively. Keep radar-canvas transparent and draw only CAD tool overlays
    // projected through MapLibre's live camera.
    if (deps.getTerrainMapMode() === 'maplibre') {
      nodeMarkerLayer?.hide();
      const proj = deps.projectEnuToScreen;
      if (proj) {
        const safeProj = (xM: number, yM: number): RadarPoint2D => proj(xM, yM) ?? { x: -1e6, y: -1e6 };
        const tbState = deps.getToolboxState();
        renderGeodeticRulerOverlay(ctx, w, h, tbState, vp, safeProj);
        renderPrecisionCursorProbeOverlay(ctx, w, h, tbState, vp, safeProj);
        renderPrecisionAoSwathOverlay(ctx, w, h, tbState, vp, safeProj);
        renderPrecisionCadObstacleOverlay(ctx, w, h, tbState, vp, safeProj);
      }
      return;
    }

    const geometry = getRadarGeometry(w, h, vp.rangeM);
    const focusCtx = deps.getContextualMapContext();
    const mapLayers = deps.getMapLayerRegistry();
    const palette = getLatticeCanvasPalette();

    // 1. Base substrate
    ctx.fillStyle = palette.voidBg;
    ctx.fillRect(0, 0, w, h);

    // 2. Terrain DEM bounds & exterior world satellite basemap (Radar SAT mode when zoomed out past DEM)
    const visTerrainDem = mapLayers?.getEffectiveVisibility('base.terrainDem', focusCtx) ?? true;
    const opTerrainDem = mapLayers?.getLayerOpacity('base.terrainDem') ?? 0.8;
    const activeBackdrop = deps.getBackdropMode() !== 'relief' ? deps.getBackdropCanvas() : deps.getHillshadeCanvas();
    const isSatelliteTerrainMode = deps.getTerrainMode?.() === 'real';
    const worldTileLayer = deps.getWorldTileLayer?.() ?? null;

    const terrainBounds = (activeBackdrop && visTerrainDem)
      ? computeTerrainScreenBounds(
          deps.getActiveTerrainBounds(),
          300000,
          geometry,
          deps.getPanOffset()
        )
      : null;

    if (isSatelliteTerrainMode && worldTileLayer) {
      const fullyCoveredByDem = Boolean(
        terrainBounds &&
        terrainBounds.isRealMode &&
        terrainBounds.tl.x <= 0 &&
        terrainBounds.tl.y <= 0 &&
        terrainBounds.br.x >= w &&
        terrainBounds.br.y >= h
      );
      if (!fullyCoveredByDem) {
        ctx.save();
        if (terrainBounds && terrainBounds.isRealMode && terrainBounds.width > 1 && terrainBounds.height > 1) {
          // Clip world satellite imagery strictly OUTSIDE the Ladakh DEM coverage box so
          // Radar mode always keeps its authentic dark-mode DEM hillshade inside the AO.
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          ctx.rect(terrainBounds.tl.x, terrainBounds.tl.y, terrainBounds.width, terrainBounds.height);
          ctx.clip('evenodd');
        }
        worldTileLayer.draw(ctx, vp, () => {
          deps.markDirty?.();
        });
        ctx.restore();
      }
    }

    if (activeBackdrop && visTerrainDem && terrainBounds) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = opTerrainDem;
      ctx.drawImage(activeBackdrop, terrainBounds.tl.x, terrainBounds.tl.y, terrainBounds.width, terrainBounds.height);
      ctx.restore();

      // Satellite DEM coverage boundary if in real mode
      const visDemBoundary = mapLayers?.getEffectiveVisibility('base.demBoundary', focusCtx) ?? true;
      if (visDemBoundary && terrainBounds.isRealMode) {
        if (terrainBounds.width >= 20 && terrainBounds.height >= 20) {
          const boundaryGeom = computeDemBoundaryGeometry(terrainBounds, w, h, deps.getActiveTerrainBounds());
          if (boundaryGeom) {
            renderDemCoverageBoundary(ctx, boundaryGeom, MONO);
          }
        } else {
          // Compact AO locator reticle when zoomed out to continental/world scale
          const cx = (terrainBounds.tl.x + terrainBounds.br.x) * 0.5;
          const cy = (terrainBounds.tl.y + terrainBounds.br.y) * 0.5;
          const aoLabel = resolveActiveAoLabel(deps.getActiveTerrainBounds(), deps.getLatestTelemetry());
          ctx.save();
          ctx.strokeStyle = palette.degraded;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(cx - 7, cy - 7, 14, 14);
          ctx.font = `bold 10px ${MONO}`;
          ctx.fillStyle = palette.degraded;
          ctx.fillText(aoLabel, cx - 24, cy + 17);
          ctx.restore();
        }
      }
    }

    // 2b. Probe RF Signal Propagation Heat Map Overlay (draped over DEM relief, under links/nodes/HUD)
    const rawTbState = deps.getToolboxState() || {};
    const vsRes = rawTbState.viewshedResult;
    const vsCanvas = rawTbState.viewshedCanvas;
    const hmCfg = rawTbState.probeHeatmapConfig;
    const hmEnabled = hmCfg ? hmCfg.enabled !== false : true;
    const showProbeHm =
      rawTbState.activeMode === 'probe' ||
      rawTbState.activeMode === 'dem' ||
      rawTbState.toolMode === 'probe';
    if (showProbeHm && hmEnabled && vsCanvas && vsRes?.isSiteWithinCoverage && Number.isFinite(vsRes.radiusM)) {
      const r = vsRes.radiusM;
      const nw = worldToScreen(vsRes.siteXM - r, vsRes.siteYM + r, w, h);
      const se = worldToScreen(vsRes.siteXM + r, vsRes.siteYM - r, w, h);
      const drawW = se.x - nw.x;
      const drawH = se.y - nw.y;
      if (drawW > 4 && drawH > 4) {
        const opacity = Number.isFinite(hmCfg?.opacity)
          ? Math.max(0.15, Math.min(0.95, Number(hmCfg.opacity)))
          : 0.72;
        ctx.save();
        ctx.imageSmoothingEnabled = hmCfg?.mode !== 'viewshed';
        ctx.globalAlpha = opacity;
        ctx.drawImage(vsCanvas, nw.x, nw.y, drawW, drawH);
        ctx.restore();
      }
    }

    // 3. Label placer initialization
    activeLabelPlacer = createLabelPlacer(w, h, 4, 3);
    activeLabelPlacer.reserveRect(0, 0, 48, h);
    activeLabelPlacer.reserveRect(Math.max(0, w - 122), Math.max(0, h - 42), 114, 34);
    activeLabelPlacer.reserveRect(8, Math.max(0, h - 38), 256, 30);

    // 4. Cartographic Overlays (Scale bar, True North, optional MGRS grid)
    const activeBoundsForCarto = deps.getActiveTerrainBounds() as any;
    const activeTelForCarto = deps.getLatestTelemetry();
    const activeBiomeIdForCarto = (activeTelForCarto?.biome_id ?? activeBoundsForCarto?.biomeId) as BiomeId | undefined;
    drawCartographicOverlays(ctx, {
      width: w,
      height: h,
      metersPerPixel: 1.0 / (geometry.scale || 1.0),
      showMgrsGrid: deps.isMgrsGridActive(),
      biomeId: activeBiomeIdForCarto,
      originLatDeg: activeBoundsForCarto?.centerLatDeg,
      originLonDeg: activeBoundsForCarto?.centerLonDeg,
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
      ? histSnap.nodes.map((n: any) => ({
          nodeId: Number(n.nodeId),
          callsign: n.callsign ?? null,
          posX: Number(n.posX),
          posY: Number(n.posY),
          snrDb: n.snrDb,
          isLos: Boolean(n.isLos),
          raw: n,
          markerStatus: resolveRadarNodeMarkerStatus(n),
        }))
      : (liveTelemetry?.nodes_telemetry || []).map((n: any) => ({
          nodeId: Number(n.node_id),
          callsign: n.callsign ?? n.label ?? null,
          posX: Number(n.x_m ?? n.position?.[0] ?? 0),
          posY: Number(n.y_m ?? n.position?.[1] ?? 0),
          snrDb: n.snr_db,
          isLos: Boolean(n.terrain_is_los),
          raw: n,
          markerStatus: resolveRadarNodeMarkerStatus(n),
        }));

    const selectedNodeId = deps.getSelectedNodeId();
    const visLinks = mapLayers?.getEffectiveVisibility('comm.links', focusCtx) ?? true;
    if (visLinks && Number.isFinite(acnPosWorld.x) && Number.isFinite(acnPosWorld.y)) {
      const acnPt = worldToScreen(acnPosWorld.x, acnPosWorld.y, w, h);
      ctx.save();
      for (const node of nodes) {
        const nodePt = worldToScreen(node.posX, node.posY, w, h);
        const isSelected = String(selectedNodeId) === String(node.nodeId);
        const linkStyle =
          node.markerStatus === 'connected'
            ? getMapLinkStyle('CONNECTED')
            : node.markerStatus === 'degraded'
              ? getMapLinkStyle('DEGRADED')
              : node.markerStatus === 'blocked-terrain'
                ? getMapLinkStyle('BLOCKED_TERRAIN')
                : node.markerStatus === 'blocked-obstacle'
                  ? getMapLinkStyle('BLOCKED_OBSTACLE')
                  : node.markerStatus === 'outage'
                    ? getMapLinkStyle('OUTAGE_DISCONNECTED')
                    : getMapLinkStyle('UNKNOWN');

        ctx.strokeStyle = isSelected ? linkStyle.selectedStrokeColor : linkStyle.strokeColor;
        ctx.lineWidth = isSelected ? linkStyle.selectedLineWidth : linkStyle.lineWidth;
        ctx.setLineDash([...linkStyle.lineDash]);

        ctx.beginPath();
        ctx.moveTo(acnPt.x, acnPt.y);
        ctx.lineTo(nodePt.x, nodePt.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // 6. Ground Nodes (GPU-composited DOM marker overlay with CSS/WAAPI transitions,
    //    falling back to canvas dots in headless environments without a DOM overlay)
    const visGroundNodes = mapLayers?.getEffectiveVisibility('entities.groundNodes', focusCtx) ?? true;
    if (nodeMarkerLayer) {
      const pan = deps.getPanOffset();
      const cameraSig: RadarCameraSignature = {
        width: w,
        height: h,
        rangeM: vp.rangeM,
        panX: pan.xM,
        panY: pan.yM,
      };
      const projections: RadarMarkerProjection[] = visGroundNodes
        ? nodes.map((node: any) => {
            const nodePt = worldToScreen(node.posX, node.posY, w, h);
            return {
              nodeId: node.nodeId,
              x: nodePt.x,
              y: nodePt.y,
              status: node.markerStatus,
              selected: String(selectedNodeId) === String(node.nodeId),
              label: formatRadarNodeTag(node.nodeId, node.callsign),
              snrDb: typeof node.snrDb === 'number' ? node.snrDb : null,
            };
          })
        : [];
      nodeMarkerLayer.sync(projections, cameraSig, visGroundNodes);
    } else if (visGroundNodes) {
      ctx.save();
      for (const node of nodes) {
        const nodePt = worldToScreen(node.posX, node.posY, w, h);
        const isSelected = String(selectedNodeId) === String(node.nodeId);

        ctx.fillStyle = isSelected ? palette.accent : palette.textSecondary;
        ctx.strokeStyle = palette.voidBg;
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.arc(nodePt.x, nodePt.y, isSelected ? 6 : 4, 0, TAU);
        ctx.fill();
        ctx.stroke();

        const nodeTag = formatRadarNodeTag(node.nodeId, node.callsign);
        ctx.font = `10px ${MONO}`;
        const tagW = Math.max(20, ctx.measureText(nodeTag).width || nodeTag.length * 6.5);
        const placed = activeLabelPlacer.placeLabel(nodePt.x + 8, nodePt.y - 12, tagW, 12, nodePt.x, nodePt.y);
        ctx.fillStyle = isSelected ? palette.accent : palette.textPrimary;
        ctx.fillText(nodeTag, placed.x, placed.y + 10);
      }
      ctx.restore();
    }

    // 7. Primary & Secondary Constellation ACNs
    const visAcn = mapLayers?.getEffectiveVisibility('entities.acn', focusCtx) ?? true;
    if (visAcn && Number.isFinite(acnPosWorld.x) && Number.isFinite(acnPosWorld.y)) {
      const acnPt = worldToScreen(acnPosWorld.x, acnPosWorld.y, w, h);
      const secondaryAcns: any[] = !histSnap && Array.isArray(liveTelemetry?.constellation_mobility_telemetry?.secondary_acns)
        ? liveTelemetry.constellation_mobility_telemetry.secondary_acns
        : [];

      ctx.save();

      // Secondary ACNs + dashed A2A cross-links back to primary ACN-1
      if (secondaryAcns.length > 0) {
        for (let sIdx = 0; sIdx < secondaryAcns.length; sIdx++) {
          const sec = secondaryAcns[sIdx];
          if (!sec || !Number.isFinite(sec.pos_x) || !Number.isFinite(sec.pos_y)) continue;
          const secPt = worldToScreen(sec.pos_x, sec.pos_y, w, h);

          // Dashed A2A cross-link back to primary ACN-1
          ctx.strokeStyle = palette.relay;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(acnPt.x, acnPt.y);
          ctx.lineTo(secPt.x, secPt.y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Secondary ACN marker (triangle in CVD-safe relay accent)
          ctx.fillStyle = palette.relay;
          ctx.strokeStyle = palette.voidBg;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(secPt.x, secPt.y - 7);
          ctx.lineTo(secPt.x + 6, secPt.y + 5);
          ctx.lineTo(secPt.x - 6, secPt.y + 5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          const secLabel = String(sec.id || sec.name || `ACN-${sIdx + 2}`);
          ctx.font = `bold 10px ${MONO}`;
          const secLabelW = Math.max(28, ctx.measureText(secLabel).width || secLabel.length * 6.5);
          const secPlaced = activeLabelPlacer.placeLabel(secPt.x + 9, secPt.y - 11, secLabelW, 12, secPt.x, secPt.y);
          ctx.fillStyle = palette.relay;
          ctx.fillText(secLabel, secPlaced.x, secPlaced.y + 10);
        }
      }

      // Primary ACN marker
      ctx.fillStyle = palette.accent;
      ctx.strokeStyle = palette.voidBg;
      ctx.lineWidth = 2.0;

      // Triangle icon
      ctx.beginPath();
      ctx.moveTo(acnPt.x, acnPt.y - 9);
      ctx.lineTo(acnPt.x + 7, acnPt.y + 6);
      ctx.lineTo(acnPt.x - 7, acnPt.y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const acnLabel = secondaryAcns.length > 0 ? 'ACN-1' : 'ACN';
      ctx.font = `bold 10px ${MONO}`;
      const acnLabelW = Math.max(24, ctx.measureText(acnLabel).width || acnLabel.length * 6.5);
      const acnPlaced = activeLabelPlacer.placeLabel(acnPt.x + 10, acnPt.y - 12, acnLabelW, 12, acnPt.x, acnPt.y);
      ctx.fillStyle = palette.accent;
      ctx.fillText(acnLabel, acnPlaced.x, acnPlaced.y + 10);
      ctx.restore();
    }

    // 8. Precision Tool Overlays (AutoCAD Ruler, RF Field Probe, QGIS AO Swath, CAD 3D Barriers)
    const tbState = { ...rawTbState, acnPosWorld };
    renderPrecisionCadObstacleOverlay(ctx, w, h, tbState, vp, (xM, yM) => worldToScreen(xM, yM, w, h));
    renderPrecisionAoSwathOverlay(ctx, w, h, tbState, vp, (xM, yM) => worldToScreen(xM, yM, w, h));
    renderGeodeticRulerOverlay(ctx, w, h, tbState, vp, (xM, yM) => worldToScreen(xM, yM, w, h));
    renderPrecisionCursorProbeOverlay(ctx, w, h, tbState, vp, (xM, yM) => worldToScreen(xM, yM, w, h));
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
