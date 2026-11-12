/**
 * Telemetry- and LinkProfile-backed RF Overlay Geometry & Rendering.
 *
 * Strictly consumes worker-authoritative `LinkProfile` data (`selected_node_fresnel.profile`
 * or `HistoricalFrameRecord.profile`). Never synthesizes fallback Fresnel curves or terrain
 * obstruction crests when no valid profile exists.
 */

import type { LinkProfile, LinkProfileSample } from '../../core/linkProfile';
import type { Point2D } from '../../shared/types';
import { HIGHLAND_THEME } from './chartTheme';
import type { RadarLabelPlacer } from './radarLabelLayout';

export type RfOverlayStatus = 'clear' | 'warning' | 'blocked';

export interface RfCrestPoint {
  readonly xM: number;
  readonly yM: number;
  readonly clearanceM: number;
  readonly requiredM: number;
  readonly isBlocked: boolean;
  readonly alongFraction: number;
}

export interface RfObstacleHitSegment {
  readonly obstacleId: string;
  readonly startXM: number;
  readonly startYM: number;
  readonly endXM: number;
  readonly endYM: number;
  readonly penetrationM: number;
}

export interface RfOverlayGeometry {
  readonly nodeId: number;
  readonly frameIndex: number;
  readonly status: RfOverlayStatus;
  readonly losStart: Point2D;
  readonly losEnd: Point2D;
  readonly polygonWorld: readonly Point2D[];
  readonly maxR1M: number;
  readonly fresnelFraction: number;
  readonly minClearanceM: number;
  readonly diffractionLossDb: number;
  readonly badgeText: string;
  readonly losLabel: string;
  readonly crestPoint: RfCrestPoint | null;
  readonly obstacleSegments: readonly RfObstacleHitSegment[];
}

export interface SignalQualityNodeDatum {
  readonly nodeId: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly snrDb: number | null;
  readonly stateName: string | null | undefined;
  readonly isOutage: boolean;
  readonly isBlocked: boolean;
  readonly isSelected: boolean;
  readonly alpha: number;
}

export interface RadarRfRenderOptions {
  readonly showLos: boolean;
  readonly showFresnel: boolean;
  readonly showObstructions: boolean;
  readonly fresnelOpacity: number;
  readonly monoFont: string;
  readonly projectWorldToScreen: (xM: number, yM: number) => Point2D;
  readonly placer?: RadarLabelPlacer;
  readonly viewportW?: number;
  readonly viewportH?: number;
}

function isFinitePoint3D(p: readonly number[] | undefined | null): p is readonly [number, number, number] {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function findWorstCrestSample(
  samples: readonly LinkProfileSample[]
): { sample: LinkProfileSample; index: number } | null {
  if (!samples.length) return null;
  const startIdx = samples.length >= 3 ? 1 : 0;
  const endIdx = samples.length >= 3 ? samples.length - 1 : samples.length;
  let bestSample = samples[startIdx];
  let bestIdx = startIdx;
  let bestClearance = bestSample.effectiveTerrainClearanceM;

  for (let i = startIdx + 1; i < endIdx; i++) {
    const s = samples[i];
    if (Number.isFinite(s.effectiveTerrainClearanceM) && s.effectiveTerrainClearanceM < bestClearance) {
      bestClearance = s.effectiveTerrainClearanceM;
      bestSample = s;
      bestIdx = i;
    }
  }
  return Number.isFinite(bestClearance) ? { sample: bestSample, index: bestIdx } : null;
}

/**
 * Derives 2D/Geo RF overlay geometry strictly from an authoritative `LinkProfile`.
 * Returns `null` when profile is missing, invalid, incomplete, or mismatched.
 */
export function computeRfOverlayGeometry(
  profile: LinkProfile | null | undefined,
  options?: { expectedNodeId?: number | null }
): RfOverlayGeometry | null {
  if (!profile || profile.valid !== true || profile.isCoverageComplete === false) {
    return null;
  }
  if (!Array.isArray(profile.samples) || profile.samples.length < 2) {
    return null;
  }
  if (
    options?.expectedNodeId !== null &&
    options?.expectedNodeId !== undefined &&
    Number.isFinite(options.expectedNodeId) &&
    profile.selectedGroundNodeId !== options.expectedNodeId
  ) {
    return null;
  }
  if (!isFinitePoint3D(profile.groundNodePositionMslM) || !isFinitePoint3D(profile.acnPositionMslM)) {
    return null;
  }

  const gx = profile.groundNodePositionMslM[0];
  const gy = profile.groundNodePositionMslM[1];
  const ax = profile.acnPositionMslM[0];
  const ay = profile.acnPositionMslM[1];
  const dx = ax - gx;
  const dy = ay - gy;
  const horizLenM = Math.hypot(dx, dy);
  if (!Number.isFinite(horizLenM) || horizLenM <= 1) {
    return null;
  }

  const totalHorizM = Number.isFinite(profile.horizontalGroundDistanceM) && profile.horizontalGroundDistanceM > 1
    ? profile.horizontalGroundDistanceM
    : horizLenM;

  const fresnelFraction = Number.isFinite(profile.fresnelFraction) && profile.fresnelFraction > 0
    ? profile.fresnelFraction
    : 0.6;

  let maxR1M = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const r1 = profile.samples[i].fresnelRadiusM;
    if (Number.isFinite(r1) && r1 > maxR1M) {
      maxR1M = r1;
    }
  }
  if (!(maxR1M > 0)) {
    return null;
  }

  // Perpendicular unit vector in local ENU metres
  const nx = -dy / horizLenM;
  const ny = dx / horizLenM;

  // Exaggerated lateral corridor scale so sub-20m X-band Fresnel radii are legible
  // across 30-200 km operational theater extents while preserving exact 0.6*r1 taper shape.
  const visualHalfWidthM = Math.max(450, Math.min(3600, horizLenM * 0.055));
  const leftEdge: Point2D[] = [];
  const rightEdge: Point2D[] = [];

  for (let i = 0; i < profile.samples.length; i++) {
    const sample = profile.samples[i];
    const t = Math.max(0, Math.min(1, sample.horizontalGroundDistanceM / totalHorizM));
    const cx = gx + dx * t;
    const cy = gy + dy * t;
    const normR = Math.max(0, Math.min(1, sample.fresnelRadiusM / maxR1M));
    const offsetM = normR * visualHalfWidthM;
    leftEdge.push({ x: cx + nx * offsetM, y: cy + ny * offsetM });
    rightEdge.push({ x: cx - nx * offsetM, y: cy - ny * offsetM });
  }

  const polygonWorld: Point2D[] = [...leftEdge];
  for (let i = rightEdge.length - 1; i >= 0; i--) {
    polygonWorld.push(rightEdge[i]);
  }
  if (polygonWorld.length > 0) {
    polygonWorld.push(polygonWorld[0]);
  }

  const minClearanceM = Number.isFinite(profile.terrainMinimumClearanceM)
    ? profile.terrainMinimumClearanceM
    : 0;
  const diffractionLossDb = Number.isFinite(profile.diffractionLossDb)
    ? profile.diffractionLossDb
    : 0;
  const criticalRequiredM = fresnelFraction * (Number.isFinite(profile.terrainCriticalFresnelRadiusM)
    ? profile.terrainCriticalFresnelRadiusM
    : 0);

  let status: RfOverlayStatus = 'clear';
  if (!profile.terrainIsLos || profile.obstacleBlocked) {
    status = 'blocked';
  } else if (minClearanceM < criticalRequiredM) {
    status = 'warning';
  }

  const worst = findWorstCrestSample(profile.samples);
  let crestPoint: RfCrestPoint | null = null;
  if (worst) {
    const t = Math.max(0, Math.min(1, worst.sample.horizontalGroundDistanceM / totalHorizM));
    const requiredAtCrestM = fresnelFraction * worst.sample.fresnelRadiusM;
    const clearanceM = worst.sample.effectiveTerrainClearanceM;
    crestPoint = {
      xM: gx + dx * t,
      yM: gy + dy * t,
      clearanceM,
      requiredM: requiredAtCrestM,
      isBlocked: !profile.terrainIsLos || clearanceM <= 0,
      alongFraction: t,
    };
  }

  const obstacleSegments: RfObstacleHitSegment[] = Array.isArray(profile.obstacleIntervals)
    ? profile.obstacleIntervals
        .filter((hit) =>
          Number.isFinite(hit.entryFraction) &&
          Number.isFinite(hit.exitFraction) &&
          hit.exitFraction >= hit.entryFraction
        )
        .map((hit) => {
          const t0 = Math.max(0, Math.min(1, hit.entryFraction));
          const t1 = Math.max(0, Math.min(1, hit.exitFraction));
          return {
            obstacleId: hit.obstacleId,
            startXM: gx + dx * t0,
            startYM: gy + dy * t0,
            endXM: gx + dx * t1,
            endYM: gy + dy * t1,
            penetrationM: Number.isFinite(hit.penetrationM) ? hit.penetrationM : 0,
          };
        })
    : [];

  const clearanceStr = `${minClearanceM >= 0 ? '+' : ''}${minClearanceM.toFixed(0)} m`;
  const lossStr = diffractionLossDb > 0.05 ? ` · −${diffractionLossDb.toFixed(1)} dB` : '';
  const statusHeadline = !profile.terrainIsLos
    ? 'TERRAIN BLOCKED'
    : profile.obstacleBlocked
      ? 'OBSTACLE BLOCKED'
      : status === 'warning'
        ? 'MARGINAL FRESNEL'
        : 'LOS CLEAR';

  return {
    nodeId: profile.selectedGroundNodeId,
    frameIndex: profile.frameIndex,
    status,
    losStart: { x: gx, y: gy },
    losEnd: { x: ax, y: ay },
    polygonWorld,
    maxR1M,
    fresnelFraction,
    minClearanceM,
    diffractionLossDb,
    badgeText: `EXAGGERATED LATERAL SCALE · max r1 = ${maxR1M.toFixed(1)} m`,
    losLabel: `${statusHeadline} · ${clearanceStr}${lossStr}`,
    crestPoint,
    obstacleSegments,
  };
}

function statusColors(status: RfOverlayStatus): {
  stroke: string;
  fillRgb: string;
} {
  if (status === 'blocked') {
    return { stroke: HIGHLAND_THEME.signal.vermilionBright, fillRgb: '224, 83, 71' };
  }
  if (status === 'warning') {
    return { stroke: HIGHLAND_THEME.signal.ochre, fillRgb: '233, 196, 106' };
  }
  return { stroke: HIGHLAND_THEME.cartography.terrainStrokeLos, fillRgb: '127, 161, 184' };
}

function placeRfPill(
  anchorX: number,
  anchorY: number,
  w: number,
  h: number,
  preferYOffset: number,
  opts: RadarRfRenderOptions
): { x: number; y: number; visible: boolean } {
  if (!opts.placer || !opts.viewportW || !opts.viewportH) {
    return { x: anchorX - w * 0.5, y: anchorY + preferYOffset - h * 0.5, visible: true };
  }
  const offsets: Array<readonly [number, number]> = [
    [-w * 0.5, preferYOffset - h * 0.5],
    [-w * 0.5, preferYOffset + 22 - h * 0.5],
    [-w * 0.5, preferYOffset - 22 - h * 0.5],
    [14, preferYOffset - h * 0.5],
    [-w - 14, preferYOffset - h * 0.5],
    [-w * 0.5, 42],
    [18, 28],
    [-w - 18, 28],
    [-w * 0.5, -48],
  ];
  return opts.placer.placeBox(anchorX, anchorY, w, h, offsets, {
    viewportW: opts.viewportW,
    viewportH: opts.viewportH,
    allowFallbackIfColliding: true,
  });
}

/**
 * Renders selected-link RF overlays (`rf.fresnelZone`, `rf.losAnalysis`, `rf.obstructionPoints`)
 * onto the 2D Radar canvas without modifying any simulation state.
 */
export function renderRadarRfOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: RfOverlayGeometry,
  opts: RadarRfRenderOptions
): void {
  const palette = statusColors(overlay.status);

  // 1. 0.6 F1 Fresnel Corridor
  if (opts.showFresnel && overlay.polygonWorld.length >= 4) {
    const pts = overlay.polygonWorld.map((pt) => opts.projectWorldToScreen(pt.x, pt.y));
    const fillAlpha = Math.max(0.10, Math.min(0.65, opts.fresnelOpacity * 0.45));
    const strokeAlpha = Math.max(0.25, Math.min(0.95, opts.fresnelOpacity));

    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(${palette.fillRgb}, ${fillAlpha.toFixed(3)})`;
    ctx.fill();
    ctx.strokeStyle = palette.stroke;
    ctx.globalAlpha = strokeAlpha;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Explicit scientific scale disclaimer pill near corridor midpoint
    const sA = opts.projectWorldToScreen(overlay.losStart.x, overlay.losStart.y);
    const sB = opts.projectWorldToScreen(overlay.losEnd.x, overlay.losEnd.y);
    const midX = (sA.x + sB.x) * 0.5;
    const midY = (sA.y + sB.y) * 0.5;
    ctx.globalAlpha = 0.96;
    ctx.font = `600 9px ${opts.monoFont}`;
    const tw = ctx.measureText(overlay.badgeText).width;
    const pw = tw + 12;
    const ph = 16;
    const box = placeRfPill(midX, midY, pw, ph, -26, opts);
    if (box.visible) {
      ctx.fillStyle = HIGHLAND_THEME.substrate.hudFill;
      ctx.fillRect(box.x, box.y, pw, ph);
      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x, box.y, pw, ph);
      ctx.fillStyle = HIGHLAND_THEME.text.primary;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(overlay.badgeText, box.x + 6, box.y + ph * 0.5 + 0.5);
    }
    ctx.restore();
  }

  // 2. Selected-Link LOS Ray & Margin Readout
  if (opts.showLos) {
    const sA = opts.projectWorldToScreen(overlay.losStart.x, overlay.losStart.y);
    const sB = opts.projectWorldToScreen(overlay.losEnd.x, overlay.losEnd.y);

    ctx.save();
    ctx.strokeStyle = palette.stroke;
    ctx.lineWidth = 2.0;
    ctx.setLineDash(overlay.status === 'blocked' ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(sA.x, sA.y);
    ctx.lineTo(sB.x, sB.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const midX = (sA.x + sB.x) * 0.5;
    const midY = (sA.y + sB.y) * 0.5;
    ctx.font = `700 9.5px ${opts.monoFont}`;
    const tw = ctx.measureText(overlay.losLabel).width;
    const pw = tw + 12;
    const ph = 16;
    const box = placeRfPill(midX, midY, pw, ph, opts.showFresnel ? 22 : 0, opts);
    if (box.visible) {
      ctx.fillStyle = HIGHLAND_THEME.substrate.hudFill;
      ctx.fillRect(box.x, box.y, pw, ph);
      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x, box.y, pw, ph);
      ctx.fillStyle = palette.stroke;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(overlay.losLabel, box.x + 6, box.y + ph * 0.5 + 0.5);
    }
    ctx.restore();
  }

  // 3. Terrain Crest & Obstacle Hits
  if (opts.showObstructions) {
    ctx.save();
    if (overlay.crestPoint) {
      const cp = opts.projectWorldToScreen(overlay.crestPoint.xM, overlay.crestPoint.yM);
      const isCrit = overlay.crestPoint.isBlocked || overlay.crestPoint.clearanceM < overlay.crestPoint.requiredM;
      const col = overlay.crestPoint.isBlocked
        ? HIGHLAND_THEME.signal.vermilionBright
        : isCrit
          ? HIGHLAND_THEME.signal.ochre
          : HIGHLAND_THEME.signal.amber;

      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 7, 0, Math.PI * 2);
      ctx.stroke();

      const arm = 4.5;
      ctx.beginPath();
      ctx.moveTo(cp.x - arm, cp.y - arm);
      ctx.lineTo(cp.x + arm, cp.y + arm);
      ctx.moveTo(cp.x + arm, cp.y - arm);
      ctx.lineTo(cp.x - arm, cp.y + arm);
      ctx.stroke();

      const tag = `CREST ${overlay.crestPoint.clearanceM >= 0 ? '+' : ''}${overlay.crestPoint.clearanceM.toFixed(0)}m`;
      ctx.font = `700 9px ${opts.monoFont}`;
      const tw = ctx.measureText(tag).width + 8;
      const box = placeRfPill(cp.x, cp.y, tw, 14, 16, opts);
      if (box.visible) {
        ctx.fillStyle = HIGHLAND_THEME.substrate.hudFill;
        ctx.fillRect(box.x, box.y, tw, 14);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.strokeRect(box.x, box.y, tw, 14);
        ctx.fillStyle = col;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tag, box.x + 4, box.y + 7.5);
      }
    }

    for (const seg of overlay.obstacleSegments) {
      const p0 = opts.projectWorldToScreen(seg.startXM, seg.startYM);
      const p1 = opts.projectWorldToScreen(seg.endXM, seg.endYM);
      const midX = (p0.x + p1.x) * 0.5;
      const midY = (p0.y + p1.y) * 0.5;

      ctx.strokeStyle = HIGHLAND_THEME.signal.copper;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();

      ctx.fillStyle = HIGHLAND_THEME.signal.vermilionBright;
      ctx.beginPath();
      ctx.arc(midX, midY, 4, 0, Math.PI * 2);
      ctx.fill();

      const label = `OBS HIT ${seg.penetrationM > 0 ? `(${seg.penetrationM.toFixed(0)}m)` : ''}`.trim();
      ctx.font = `700 9px ${opts.monoFont}`;
      const tw = ctx.measureText(label).width + 8;
      const box = placeRfPill(midX, midY, tw, 14, 18, opts);
      if (box.visible) {
        ctx.fillStyle = HIGHLAND_THEME.substrate.hudFill;
        ctx.fillRect(box.x, box.y, tw, 14);
        ctx.strokeStyle = HIGHLAND_THEME.signal.copper;
        ctx.lineWidth = 1;
        ctx.strokeRect(box.x, box.y, tw, 14);
        ctx.fillStyle = HIGHLAND_THEME.signal.vermilionBright;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, box.x + 4, box.y + 7.5);
      }
    }
    ctx.restore();
  }
}

/**
 * Renders an honest unavailable note near the selected node when historical RF overlays
 * cannot be displayed due to a missing/incomplete `HistoricalFrameRecord.profile`.
 */
export function renderRadarRfUnavailableNote(
  ctx: CanvasRenderingContext2D,
  anchorScreenPos: Point2D,
  reason: string,
  monoFont: string
): void {
  ctx.save();
  ctx.font = `600 9.5px ${monoFont}`;
  const tw = ctx.measureText(reason).width;
  const pw = tw + 12;
  const ph = 18;
  const rx = anchorScreenPos.x + 14;
  const ry = anchorScreenPos.y - 24;
  ctx.fillStyle = HIGHLAND_THEME.substrate.hudFill;
  ctx.fillRect(rx, ry, pw, ph);
  ctx.strokeStyle = HIGHLAND_THEME.signal.ochreStrokeSoft;
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, ry, pw, ph);
  ctx.fillStyle = HIGHLAND_THEME.signal.ochre;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(reason, rx + 6, ry + ph * 0.5 + 0.5);
  ctx.restore();
}

/**
 * Renders terminal SNR gauge & M1 lookahead rings (`rf.signalQuality`).
 * Critical outage/blocked alert rings always remain vivid regardless of background dimming.
 */
export function renderRadarSignalQualityRings(
  ctx: CanvasRenderingContext2D,
  nodes: readonly SignalQualityNodeDatum[],
  monoFont: string,
  showNumericSnr: boolean
): void {
  if (!nodes.length) return;
  ctx.save();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const isCritical = n.isOutage || n.isBlocked || n.stateName === 'HARD_SHADOW_CUTOFF';
    const isPreOcclusion = n.stateName === 'PRE_OCCLUSION_WARNING';
    const isRecovering = n.stateName === 'RECOVERING_EMERGENCE';

    const radius = n.isSelected ? 17 : 13;
    const effectiveAlpha = isCritical ? Math.max(n.alpha, 0.92) : n.alpha;
    ctx.globalAlpha = effectiveAlpha;

    let ringColor: string = HIGHLAND_THEME.signal.sage;
    if (isCritical) ringColor = HIGHLAND_THEME.signal.vermilionBright;
    else if (isPreOcclusion) ringColor = HIGHLAND_THEME.signal.ochre;
    else if (isRecovering) ringColor = HIGHLAND_THEME.cartography.terrainStrokeLos;
    else if (n.snrDb !== null && n.snrDb < 8) ringColor = HIGHLAND_THEME.signal.ochre;

    // Outer state ring
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = isCritical ? 2.0 : 1.5;
    if (isPreOcclusion || isRecovering) {
      ctx.setLineDash([3, 3]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.arc(n.screenX, n.screenY, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Normalized SNR arc inside the outer ring when finite SNR is present
    if (n.snrDb !== null && Number.isFinite(n.snrDb)) {
      const snrFrac = Math.max(0.1, Math.min(1, n.snrDb / 24));
      ctx.strokeStyle = n.snrDb >= 10 ? HIGHLAND_THEME.signal.sageBright : ringColor;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(n.screenX, n.screenY, radius - 3, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * snrFrac);
      ctx.stroke();

      if (showNumericSnr || n.isSelected) {
        const snrText = `${n.snrDb.toFixed(1)}dB`;
        ctx.font = `600 8.5px ${monoFont}`;
        ctx.fillStyle = ringColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(snrText, n.screenX, n.screenY + radius + 2);
      }
    }
  }
  ctx.restore();
}

export interface RfGeoJsonFeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: Array<{
    readonly type: 'Feature';
    readonly geometry: {
      readonly type: 'Polygon' | 'LineString' | 'Point';
      readonly coordinates: unknown;
    };
    readonly properties: Record<string, unknown>;
  }>;
}

/**
 * Builds GeoJSON features for the `maplibre-rf-analysis` source from authoritative `RfOverlayGeometry`.
 */
export function buildRfOverlayGeoJson(
  overlay: RfOverlayGeometry | null,
  toLonLat: (xM: number, yM: number) => [number, number],
  opts: {
    showLos: boolean;
    showFresnel: boolean;
    showObstructions: boolean;
    fresnelOpacity: number;
  }
): RfGeoJsonFeatureCollection {
  if (!overlay) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features: RfGeoJsonFeatureCollection['features'] = [];
  const color = statusColors(overlay.status).stroke;

  if (opts.showFresnel && overlay.polygonWorld.length >= 4) {
    const ring = overlay.polygonWorld.map((pt) => toLonLat(pt.x, pt.y));
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
      properties: {
        layerKind: 'fresnel',
        color,
        fillOpacity: Math.max(0.10, Math.min(0.65, opts.fresnelOpacity * 0.45)),
        lineOpacity: Math.max(0.25, Math.min(0.95, opts.fresnelOpacity)),
        badge: overlay.badgeText,
      },
    });
  }

  if (opts.showLos) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          toLonLat(overlay.losStart.x, overlay.losStart.y),
          toLonLat(overlay.losEnd.x, overlay.losEnd.y),
        ],
      },
      properties: {
        layerKind: 'los',
        color,
        label: overlay.losLabel,
      },
    });
  }

  if (opts.showObstructions) {
    if (overlay.crestPoint) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: toLonLat(overlay.crestPoint.xM, overlay.crestPoint.yM),
        },
        properties: {
          layerKind: 'crest',
          color: overlay.crestPoint.isBlocked
            ? HIGHLAND_THEME.signal.vermilionBright
            : HIGHLAND_THEME.signal.ochre,
          label: `CREST ${overlay.crestPoint.clearanceM >= 0 ? '+' : ''}${overlay.crestPoint.clearanceM.toFixed(0)}m`,
        },
      });
    }
    for (const seg of overlay.obstacleSegments) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            toLonLat(seg.startXM, seg.startYM),
            toLonLat(seg.endXM, seg.endYM),
          ],
        },
        properties: {
          layerKind: 'obstacle-hit',
          color: HIGHLAND_THEME.signal.copper,
          obstacleId: seg.obstacleId,
          penetrationM: seg.penetrationM,
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
