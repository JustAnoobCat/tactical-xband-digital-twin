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
  readonly getSweepTimeS?: () => number;
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

export interface AcnSectorWedgeSpec {
  readonly index: 0 | 1 | 2 | 3;
  readonly code: 'S0' | 'S1' | 'S2' | 'S3';
  readonly label: 'FWD' | 'STBD' | 'AFT' | 'PORT';
  readonly startRad: number;
  readonly endRad: number;
  readonly midRad: number;
  readonly rgb: readonly [number, number, number];
  readonly hex: string;
}

export interface AcnSectorSweepState {
  readonly headingDeg: number;
  readonly sweepAngleRad: number;
  readonly tailArcRad: number;
  readonly wedges: readonly AcnSectorWedgeSpec[];
}

const ACN_SECTOR_PALETTE: ReadonlyArray<{
  readonly index: 0 | 1 | 2 | 3;
  readonly code: 'S0' | 'S1' | 'S2' | 'S3';
  readonly label: 'FWD' | 'STBD' | 'AFT' | 'PORT';
  readonly boresightOffsetDeg: number;
  readonly rgb: readonly [number, number, number];
  readonly hex: string;
}> = Object.freeze([
  { index: 0, code: 'S0', label: 'FWD', boresightOffsetDeg: 0, rgb: [56, 189, 248], hex: '#38bdf8' },
  { index: 1, code: 'S1', label: 'STBD', boresightOffsetDeg: 90, rgb: [245, 158, 11], hex: '#f59e0b' },
  { index: 2, code: 'S2', label: 'AFT', boresightOffsetDeg: 180, rgb: [96, 165, 250], hex: '#60a5fa' },
  { index: 3, code: 'S3', label: 'PORT', boresightOffsetDeg: 270, rgb: [192, 132, 252], hex: '#c084fc' },
]);

/**
 * Computes pure 2D canvas angular geometry for the ACN 4-sector footprint
 * and rotating radar sweep beam.
 */
export function computeAcnSectorSweepState(
  acnHeadingDeg: number,
  simTimeS: number
): AcnSectorSweepState {
  const headingDeg = Number.isFinite(acnHeadingDeg) ? ((acnHeadingDeg % 360) + 360) % 360 : 0;
  const safeTime = Number.isFinite(simTimeS) && simTimeS >= 0 ? simTimeS : 0;
  const sweepAngleRad = (safeTime * 1.4) % TAU;
  const tailArcRad = (35 * Math.PI) / 180;

  const wedges: AcnSectorWedgeSpec[] = ACN_SECTOR_PALETTE.map((sec) => {
    const centerDeg = headingDeg + sec.boresightOffsetDeg;
    const startRad = ((centerDeg - 45 - 90) * Math.PI) / 180;
    const endRad = ((centerDeg + 45 - 90) * Math.PI) / 180;
    const midRad = ((centerDeg - 90) * Math.PI) / 180;
    return {
      index: sec.index,
      code: sec.code,
      label: sec.label,
      startRad,
      endRad,
      midRad,
      rgb: sec.rgb,
      hex: sec.hex,
    };
  });

  return {
    headingDeg,
    sweepAngleRad,
    tailArcRad,
    wedges,
  };
}

function drawAcn4SectorAndSweepOverlay(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  coverageRadiusPx: number,
  viewportW: number,
  viewportH: number,
  acnHeadingDeg: number,
  simTimeS: number,
  activeSectorId: number | null
): void {
  const sweepState = computeAcnSectorSweepState(acnHeadingDeg, simTimeS);
  const wedgeRadiusPx = Math.max(42, coverageRadiusPx);
  const hudRingRadiusPx = Math.max(48, Math.min(wedgeRadiusPx, Math.min(viewportW, viewportH) * 0.43));

  ctx.save();

  // 1. Translucent 4-sector wedges rotated by ACN heading
  for (const wedge of sweepState.wedges) {
    const isServing = activeSectorId === wedge.index;
    const fillAlpha = isServing ? 0.22 : 0.09;
    const [r, g, b] = wedge.rgb;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, wedgeRadiusPx, wedge.startRad, wedge.endRad);
    ctx.closePath();
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillAlpha})`;
    ctx.fill();

    if (isServing) {
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.55)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // 2. Thin quadrant divider radials & outer coverage ring
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const wedge of sweepState.wedges) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + Math.cos(wedge.startRad) * wedgeRadiusPx,
      centerY + Math.sin(wedge.startRad) * wedgeRadiusPx
    );
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(centerX, centerY, wedgeRadiusPx, 0, TAU);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  if (wedgeRadiusPx > hudRingRadiusPx * 1.15) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, hudRingRadiusPx, 0, TAU);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 3. Rotating radar sweep phosphor trail (~35 deg fan) + leading beam
  const beamAngle = sweepState.sweepAngleRad - Math.PI / 2;
  const tailStart = beamAngle - sweepState.tailArcRad;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.arc(centerX, centerY, hudRingRadiusPx, tailStart, beamAngle);
  ctx.closePath();

  if (typeof ctx.createRadialGradient === 'function') {
    const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, hudRingRadiusPx);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.34)');
    grad.addColorStop(0.65, 'rgba(56, 189, 248, 0.16)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0.03)');
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
  }
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(
    centerX + Math.cos(beamAngle) * hudRingRadiusPx,
    centerY + Math.sin(beamAngle) * hudRingRadiusPx
  );
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 4. Compact FWD / STBD / AFT / PORT sector labels inside the scope
  const labelR = Math.max(30, hudRingRadiusPx * 0.72);
  ctx.font = `600 10px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const wedge of sweepState.wedges) {
    const lx = centerX + Math.cos(wedge.midRad) * labelR;
    const ly = centerY + Math.sin(wedge.midRad) * labelR;
    if (lx < 16 || lx > viewportW - 16 || ly < 16 || ly > viewportH - 16) continue;
    const isServing = activeSectorId === wedge.index;
    const [r, g, b] = wedge.rgb;
    ctx.fillStyle = isServing ? `rgba(${r}, ${g}, ${b}, 0.98)` : `rgba(${r}, ${g}, ${b}, 0.72)`;
    ctx.fillText(wedge.label, lx, ly);
  }

  ctx.restore();
}

function drawAcnTrajectoryTrack2d(
  ctx: CanvasRenderingContext2D,
  worldToScreenFn: (xM: number, yM: number) => RadarPoint2D,
  flightPath: ReadonlyArray<readonly [number, number]> | undefined,
  trajectoryConfig: {
    readonly trajectory_mode?: string;
    readonly center_x_m?: number;
    readonly center_y_m?: number;
    readonly orbit_a_m?: number;
    readonly orbit_b_m?: number;
    readonly orbit_rotation_deg?: number;
    readonly waypoints?: ReadonlyArray<{ readonly x_m: number; readonly y_m: number }>;
  } | null | undefined,
  accentColor: string
): void {
  const pts: Array<{ xM: number; yM: number }> = [];
  if (Array.isArray(flightPath) && flightPath.length >= 2) {
    for (const p of flightPath) {
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
        pts.push({ xM: p[0], yM: p[1] });
      }
    }
  } else if (trajectoryConfig?.trajectory_mode === 'waypoints' && Array.isArray(trajectoryConfig.waypoints)) {
    for (const wp of trajectoryConfig.waypoints) {
      if (Number.isFinite(wp.x_m) && Number.isFinite(wp.y_m)) {
        pts.push({ xM: wp.x_m, yM: wp.y_m });
      }
    }
  } else {
    const mode = String(trajectoryConfig?.trajectory_mode ?? 'ellipse').toLowerCase();
    if (mode === 'ellipse' || mode === 'elliptical') {
      const cx = Number.isFinite(trajectoryConfig?.center_x_m) ? Number(trajectoryConfig?.center_x_m) : 0;
      const cy = Number.isFinite(trajectoryConfig?.center_y_m) ? Number(trajectoryConfig?.center_y_m) : 0;
      const a = Number.isFinite(trajectoryConfig?.orbit_a_m) && Number(trajectoryConfig?.orbit_a_m) > 0
        ? Number(trajectoryConfig?.orbit_a_m)
        : 20000;
      const b = Number.isFinite(trajectoryConfig?.orbit_b_m) && Number(trajectoryConfig?.orbit_b_m) > 0
        ? Number(trajectoryConfig?.orbit_b_m)
        : 10000;
      const rotDeg = Number.isFinite(trajectoryConfig?.orbit_rotation_deg) ? Number(trajectoryConfig?.orbit_rotation_deg) : 35;
      const phi = (rotDeg * Math.PI) / 180;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      const segments = 64;
      for (let i = 0; i < segments; i++) {
        const theta = (i / segments) * TAU;
        const xr = a * Math.cos(theta);
        const yr = b * Math.sin(theta);
        pts.push({
          xM: cx + xr * cosPhi - yr * sinPhi,
          yM: cy + xr * sinPhi + yr * cosPhi,
        });
      }
    }
  }

  if (pts.length < 2) return;

  ctx.save();
  ctx.strokeStyle = accentColor;
  ctx.globalAlpha = 0.42;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  const p0 = worldToScreenFn(pts[0].xM, pts[0].yM);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i++) {
    const p = worldToScreenFn(pts[i].xM, pts[i].yM);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function formatNodeRadarCallout(nodeId: number, callsign?: string | null, teamName?: string | null): string {
  const baseTag = formatRadarNodeTag(nodeId, callsign);
  if (typeof teamName !== 'string' || !teamName.trim()) return baseTag;
  const trimmed = teamName.trim();
  const shortWord = trimmed.split(/\s+/)[0] || trimmed;
  const badge = shortWord.length > 10 ? shortWord.slice(0, 10) : shortWord;
  return `${baseTag} [${badge}]`;
}

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

function drawTacticalEquipmentOverlays(
  ctx: CanvasRenderingContext2D,
  equipment: readonly any[],
  worldToScreen: (xM: number, yM: number) => RadarPoint2D,
  acnPosWorld: { x: number; y: number },
  scale: number,
  sweepTimeS: number,
  labelPlacer: CanvasLabelPlacer | null
): void {
  if (!equipment || equipment.length === 0) return;
  const pulse = (Math.max(0, sweepTimeS) * 0.85) % 1.0;

  ctx.save();
  for (let i = 0; i < equipment.length; i++) {
    const eq = equipment[i];
    if (!eq || !Number.isFinite(eq.x_m) || !Number.isFinite(eq.y_m)) continue;
    const pt = worldToScreen(eq.x_m, eq.y_m);
    const active = eq.enabled !== false;
    const alphaScale = active ? 1.0 : 0.35;
    const rawRadiusPx = (Number.isFinite(eq.effective_radius_m) ? eq.effective_radius_m : 4500) * scale;
    const ringPx = Math.max(16, Math.min(90, rawRadiusPx));

    if (eq.type === 'barrage_jammer' || eq.type === 'spot_jammer') {
      // Pulsing red interference rings + diamond (JMR)
      if (active) {
        const pulseR = ringPx * (0.35 + 0.65 * pulse);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pulseR, 0, TAU);
        ctx.strokeStyle = `rgba(239, 68, 68, ${(1 - pulse) * 0.65})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, ringPx, 0, TAU);
      ctx.strokeStyle = `rgba(239, 68, 68, ${0.42 * alphaScale})`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (eq.type === 'spot_jammer') {
        const aimDeg = typeof eq.azimuth_deg === 'number' && Number.isFinite(eq.azimuth_deg)
          ? eq.azimuth_deg
          : (((Math.atan2(acnPosWorld.x - eq.x_m, acnPosWorld.y - eq.y_m) * 180) / Math.PI) + 360) % 360;
        const bwRad = ((typeof eq.beamwidth_deg === 'number' ? eq.beamwidth_deg : 35) * Math.PI) / 180;
        const aimCanvasRad = ((aimDeg - 90) * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.arc(pt.x, pt.y, ringPx * 1.15, aimCanvasRad - bwRad * 0.5, aimCanvasRad + bwRad * 0.5);
        ctx.closePath();
        ctx.fillStyle = `rgba(239, 68, 68, ${0.18 * alphaScale})`;
        ctx.fill();
      }

      ctx.fillStyle = active ? '#ef4444' : '#7f1d1d';
      ctx.strokeStyle = '#090b10';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - 7);
      ctx.lineTo(pt.x + 7, pt.y);
      ctx.lineTo(pt.x, pt.y + 7);
      ctx.lineTo(pt.x - 7, pt.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const tag = eq.type === 'spot_jammer' ? 'JMR-S' : 'JMR';
      ctx.font = `bold 10px ${MONO}`;
      const tagW = Math.max(24, ctx.measureText(tag).width || tag.length * 6.5);
      const placed = labelPlacer
        ? labelPlacer.placeLabel(pt.x + 9, pt.y - 10, tagW, 12, pt.x, pt.y)
        : { x: pt.x + 9, y: pt.y - 10 };
      ctx.fillStyle = `rgba(248, 113, 113, ${alphaScale})`;
      ctx.fillText(tag, placed.x, placed.y + 10);
    } else if (eq.type === 'relay_mast') {
      // Emerald mast + halo (RLY)
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, ringPx, 0, TAU);
      ctx.strokeStyle = `rgba(16, 185, 129, ${0.32 * alphaScale})`;
      ctx.lineWidth = 1.1;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 11, 0, TAU);
      ctx.fillStyle = `rgba(16, 185, 129, ${0.22 * alphaScale})`;
      ctx.fill();

      ctx.strokeStyle = active ? '#10b981' : '#065f46';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - 8);
      ctx.lineTo(pt.x, pt.y + 7);
      ctx.moveTo(pt.x - 5, pt.y - 4);
      ctx.lineTo(pt.x + 5, pt.y - 4);
      ctx.moveTo(pt.x - 4, pt.y + 7);
      ctx.lineTo(pt.x + 4, pt.y + 7);
      ctx.stroke();

      const tag = 'RLY';
      ctx.font = `bold 10px ${MONO}`;
      const tagW = Math.max(24, ctx.measureText(tag).width || 24);
      const placed = labelPlacer
        ? labelPlacer.placeLabel(pt.x + 9, pt.y - 10, tagW, 12, pt.x, pt.y)
        : { x: pt.x + 9, y: pt.y - 10 };
      ctx.fillStyle = `rgba(52, 211, 153, ${alphaScale})`;
      ctx.fillText(tag, placed.x, placed.y + 10);
    } else if (eq.type === 'esm_sensor') {
      // Amber intercept sector (ESM)
      const sweepCenter = ((sweepTimeS * 0.7) % TAU) - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.arc(pt.x, pt.y, ringPx * 0.9, sweepCenter - 0.55, sweepCenter + 0.55);
      ctx.closePath();
      ctx.fillStyle = eq.intercept_detected
        ? `rgba(245, 158, 11, ${0.28 * alphaScale})`
        : `rgba(245, 158, 11, ${0.14 * alphaScale})`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, ringPx * 0.9, 0, TAU);
      ctx.strokeStyle = `rgba(245, 158, 11, ${0.4 * alphaScale})`;
      ctx.lineWidth = 1.1;
      ctx.setLineDash([2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = active ? '#f59e0b' : '#78350f';
      ctx.strokeStyle = '#090b10';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5.5, 0, TAU);
      ctx.fill();
      ctx.stroke();

      const tag = eq.intercept_detected ? 'ESM*' : 'ESM';
      ctx.font = `bold 10px ${MONO}`;
      const tagW = Math.max(24, ctx.measureText(tag).width || 24);
      const placed = labelPlacer
        ? labelPlacer.placeLabel(pt.x + 9, pt.y - 10, tagW, 12, pt.x, pt.y)
        : { x: pt.x + 9, y: pt.y - 10 };
      ctx.fillStyle = `rgba(251, 191, 36, ${alphaScale})`;
      ctx.fillText(tag, placed.x, placed.y + 10);
    }
  }
  ctx.restore();
}

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
      originLatDeg: activeBoundsForCarto?.centerLatDeg ?? worldTileLayer?.getOrigin?.()?.latDeg,
      originLonDeg: activeBoundsForCarto?.centerLonDeg ?? worldTileLayer?.getOrigin?.()?.lonDeg,
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
          teamName: n.teamName ?? n.team_name ?? null,
          posX: Number(n.posX),
          posY: Number(n.posY),
          snrDb: n.snrDb,
          isLos: Boolean(n.isLos),
          raw: n,
          markerStatus: resolveRadarNodeMarkerStatus(n),
        }))
      : (liveTelemetry?.nodes_telemetry || []).map((n: any) => ({
          nodeId: Number(n.node_id),
          callsign: n.callsign ?? n.label ?? n.name ?? null,
          teamName: n.team_name ?? n.teamName ?? null,
          posX: Number(n.x_m ?? n.position?.[0] ?? 0),
          posY: Number(n.y_m ?? n.position?.[1] ?? 0),
          snrDb: n.snr_db,
          isLos: Boolean(n.terrain_is_los),
          raw: n,
          markerStatus: resolveRadarNodeMarkerStatus(n),
        }));

    const selectedNodeId = deps.getSelectedNodeId();

    // 5.0 Planned ACN Elliptical / Waypoint Trajectory Orbit Track
    const visTrajectory = mapLayers?.getEffectiveVisibility('entities.trajectory', focusCtx) ?? true;
    if (visTrajectory) {
      drawAcnTrajectoryTrack2d(
        ctx,
        (xM, yM) => worldToScreen(xM, yM, w, h),
        !histSnap ? liveTelemetry?.acn_telemetry?.flight_path : undefined,
        !histSnap ? liveTelemetry?.trajectory_config : undefined,
        palette.accent
      );
    }

    // 5a. ACN 4-Sector Footprint & Rotating Radar Sweep Overlay
    const visAcnSectors = mapLayers?.getEffectiveVisibility('rf.acnSectors', focusCtx) ?? true;
    if (visAcnSectors && Number.isFinite(acnPosWorld.x) && Number.isFinite(acnPosWorld.y)) {
      const acnPt = worldToScreen(acnPosWorld.x, acnPosWorld.y, w, h);
      const rawHeadingDeg = histSnap?.acn_heading_deg ?? liveTelemetry?.acn_heading_deg;
      const rawHeadingRad = histSnap?.acn?.headingRad ?? liveTelemetry?.acn_telemetry?.heading_rad;
      const headingDeg =
        typeof rawHeadingDeg === 'number' && Number.isFinite(rawHeadingDeg)
          ? rawHeadingDeg
          : typeof rawHeadingRad === 'number' && Number.isFinite(rawHeadingRad)
            ? ((Math.PI / 2 - rawHeadingRad) * 180) / Math.PI
            : 0;
      const covKm = Number(
        histSnap?.acn?.coverageRadiusKm ?? liveTelemetry?.acn_telemetry?.coverage_radius_km ?? 35
      );
      const covRadiusM = Number.isFinite(covKm) && covKm > 0 ? covKm * 1000 : 35000;
      const sweepTimeS =
        deps.getSweepTimeS?.() ??
        Number(histSnap?.simulationTimeS ?? liveTelemetry?.sim_time_s ?? 0);
      const selNodeObj = nodes.find((n: any) => String(n.nodeId) === String(selectedNodeId));
      const rawSector =
        selNodeObj?.raw?.active_sector ??
        selNodeObj?.raw?.serving_sector ??
        selNodeObj?.raw?.active_sector_id;
      const activeSectorId =
        typeof rawSector === 'number' && Number.isFinite(rawSector) ? rawSector : null;

      drawAcn4SectorAndSweepOverlay(
        ctx,
        acnPt.x,
        acnPt.y,
        covRadiusM * geometry.scale,
        w,
        h,
        headingDeg,
        sweepTimeS,
        activeSectorId
      );
    }

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
              label: formatNodeRadarCallout(node.nodeId, node.callsign, node.teamName),
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

        const nodeTag = formatNodeRadarCallout(node.nodeId, node.callsign, node.teamName);
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

    // 7b. Deployed Tactical RF Equipment (Barrage/Spot Jammers, Relay Masts, ESM Sensors)
    if (!histSnap && Array.isArray(liveTelemetry?.tactical_equipment) && liveTelemetry.tactical_equipment.length > 0) {
      const eqSweepTimeS = deps.getSweepTimeS?.() ?? Number(liveTelemetry?.sim_time_s ?? 0);
      drawTacticalEquipmentOverlays(
        ctx,
        liveTelemetry.tactical_equipment,
        (xM, yM) => worldToScreen(xM, yM, w, h),
        acnPosWorld,
        geometry.scale,
        eqSweepTimeS,
        activeLabelPlacer
      );
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

export interface HeadlessRadar2dOptions {
  readonly width: number;
  readonly height: number;
  readonly rangeM?: number;
  readonly panOffsetX_m?: number;
  readonly panOffsetY_m?: number;
  readonly flightTrajectoryMode?: 'ELLIPTICAL' | 'WAYPOINTS' | 'ellipse' | 'waypoints';
  readonly acnPositionEnu?: readonly [number, number, number];
  readonly telemetry?: any;
  readonly selectedNodeId?: number | string | null;
}

/**
 * Direct headless entry point sharing the authoritative 2D Radar renderer pipeline.
 */
export function drawRadar2D(ctx: CanvasRenderingContext2D, options: HeadlessRadar2dOptions): void {
  const width = options.width;
  const height = options.height;
  const rangeM = options.rangeM ?? 60000;
  const panX = options.panOffsetX_m ?? 0;
  const panY = options.panOffsetY_m ?? 0;
  const modeNormalized =
    String(options.flightTrajectoryMode ?? options.telemetry?.trajectory_config?.trajectory_mode ?? 'ellipse')
      .toLowerCase() === 'waypoints'
      ? 'waypoints'
      : 'ellipse';
  const acnPos = options.acnPositionEnu;
  const baseTel = options.telemetry ?? {};
  const mergedTelemetry = {
    ...baseTel,
    trajectory_config: {
      ...(baseTel.trajectory_config ?? {}),
      trajectory_mode: modeNormalized,
    },
    acn_telemetry: {
      ...(baseTel.acn_telemetry ?? {}),
      ...(acnPos
        ? {
            pos_x: acnPos[0],
            pos_y: acnPos[1],
            pos_z: acnPos[2],
          }
        : {}),
    },
  };
  const stubCanvas = {
    width,
    height,
    parentElement: { clientWidth: width, clientHeight: height },
  } as unknown as HTMLCanvasElement;
  const renderer = createRadar2dRenderer({
    canvas: stubCanvas,
    ctx,
    getRangeM: () => rangeM,
    getPanOffset: () => ({ xM: panX, yM: panY }),
    getStageViewMode: () => '2d',
    getTerrainMapMode: () => 'radar',
    getLatestTelemetry: () => mergedTelemetry,
    getHistoricalSnapshot: () => null,
    getActiveTerrainBounds: () => null,
    getHillshadeCanvas: () => null,
    getBackdropCanvas: () => null,
    getBackdropMode: () => 'relief',
    getMapLayerRegistry: () => null,
    getContextualMapContext: () => ({}),
    getSelectedNodeId: () => options.selectedNodeId ?? null,
    getToolboxState: () => ({}),
    getObstacleEditor: () => null,
    isMgrsGridActive: () => false,
  });
  renderer.renderRadar();
}
