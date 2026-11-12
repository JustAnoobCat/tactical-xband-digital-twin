/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Zoomable Canvas Link-Profile Viewport Model & Renderer
 *
 * Provides an independent, zoomable, and pannable viewport for the authoritative
 * worker-generated link profile. Gestures and viewport state are strictly isolated
 * from simulation state, trajectory edits, obstacle edits, and map interactions.
 */

import type { LinkProfile, LinkProfileObstacleInterval, LinkProfileSample } from '../core/linkProfile';
import { HIGHLAND_THEME } from './workbench/chartTheme';

export interface ViewportBounds {
  readonly minDKm: number;
  readonly maxDKm: number;
  readonly minAltM: number;
  readonly maxAltM: number;
}

export interface ViewportLayout {
  readonly width: number;
  readonly height: number;
  readonly padL: number;
  readonly padR: number;
  readonly padT: number;
  readonly padB: number;
}

export interface ProfileStatusSummary {
  readonly terrainIsLos: boolean;
  readonly obstacleBlocked: boolean;
  readonly terrainClearanceM: number;
  readonly diffractionLossDb: number;
  readonly primaryBlockedObstacleId: string | null;
  readonly terrainStatusText: string;
  readonly terrainBadgeClass: string;
  readonly obstacleStatusText: string;
  readonly obstacleBadgeClass: string;
}

/** Minimum and maximum physical limits for the viewport to prevent inversion or arithmetic overflow. */
export const VIEWPORT_LIMITS = {
  MIN_SPAN_D_KM: 0.05,       // 50 metres min horizontal view span
  MAX_SPAN_D_KM: 1200.0,     // 1,200 km max domain span
  MIN_SPAN_ALT_M: 10.0,      // 10 metres min elevation span
  MAX_SPAN_ALT_M: 30000.0,   // 30,000 metres max elevation span
  MIN_DOMAIN_D_KM: -100.0,
  MAX_DOMAIN_D_KM: 1300.0,
  MIN_DOMAIN_ALT_M: -1000.0,
  MAX_DOMAIN_ALT_M: 35000.0,
  MAX_ZOOM_FACTOR: 50.0,
  MIN_ZOOM_FACTOR: 0.2,
} as const;

export function calcNiceStep(range: number, targetTicks = 5): number {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const safeTicks = Math.max(1, targetTicks);
  const raw = range / safeTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const n = raw / mag;
  const mult = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return mult * mag;
}

/**
 * Encapsulates the viewport coordinates, zoom/pan transforms, and fit calculations.
 * Pure TypeScript with no direct DOM dependency, allowing 100% headless testability.
 */
export class LinkProfileViewportState {
  private minDKm: number = 0;
  private maxDKm: number = 10;
  private minAltM: number = 0;
  private maxAltM: number = 5000;

  private fitMinDKm: number = 0;
  private fitMaxDKm: number = 10;
  private fitMinAltM: number = 0;
  private fitMaxAltM: number = 5000;

  private userModified: boolean = false;
  private lastSelectedNodeId: number | null = null;

  constructor() {
    this.resetToDefaults();
  }

  public resetToDefaults(): void {
    this.minDKm = 0;
    this.maxDKm = 10;
    this.minAltM = 0;
    this.maxAltM = 5000;
    this.fitMinDKm = 0;
    this.fitMaxDKm = 10;
    this.fitMinAltM = 0;
    this.fitMaxAltM = 5000;
    this.userModified = false;
    this.lastSelectedNodeId = null;
  }

  public get bounds(): ViewportBounds {
    return {
      minDKm: this.minDKm,
      maxDKm: this.maxDKm,
      minAltM: this.minAltM,
      maxAltM: this.maxAltM,
    };
  }

  public get fitBounds(): ViewportBounds {
    return {
      minDKm: this.fitMinDKm,
      maxDKm: this.fitMaxDKm,
      minAltM: this.fitMinAltM,
      maxAltM: this.fitMaxAltM,
    };
  }

  public get isUserModified(): boolean {
    return this.userModified;
  }

  public get zoomFactor(): number {
    const fitSpanD = Math.max(0.001, this.fitMaxDKm - this.fitMinDKm);
    const currSpanD = Math.max(0.001, this.maxDKm - this.minDKm);
    return Math.round((fitSpanD / currSpanD) * 10) / 10;
  }

  /**
   * Updates reference profile geometry.
   * Automatically resets fit when node selection changes or when no manual pan/zoom is active.
   */
  public syncProfile(profile: LinkProfile | null, options?: { forceReset?: boolean }): boolean {
    if (!profile || !profile.valid || profile.samples.length < 2) {
      return false;
    }

    const nodeChanged = this.lastSelectedNodeId !== null && this.lastSelectedNodeId !== profile.selectedGroundNodeId;
    this.lastSelectedNodeId = profile.selectedGroundNodeId;

    // Calculate optimal fit bounds from profile geometry
    const dMaxKm = Math.max(0.1, profile.horizontalGroundDistanceM / 1000);
    let loAlt = Number.POSITIVE_INFINITY;
    let hiAlt = Number.NEGATIVE_INFINITY;

    for (const s of profile.samples) {
      if (Number.isFinite(s.terrainElevationMslM)) loAlt = Math.min(loAlt, s.terrainElevationMslM);
      if (Number.isFinite(s.effectiveTerrainElevationMslM)) {
        loAlt = Math.min(loAlt, s.effectiveTerrainElevationMslM);
        hiAlt = Math.max(hiAlt, s.effectiveTerrainElevationMslM);
      }
      if (Number.isFinite(s.losElevationMslM)) {
        loAlt = Math.min(loAlt, s.losElevationMslM);
        hiAlt = Math.max(hiAlt, s.losElevationMslM);
      }
      if (Number.isFinite(s.lowerFresnelElevationMslM)) loAlt = Math.min(loAlt, s.lowerFresnelElevationMslM);
      if (Number.isFinite(s.upperFresnelElevationMslM)) hiAlt = Math.max(hiAlt, s.upperFresnelElevationMslM);
    }

    if (!Number.isFinite(loAlt) || !Number.isFinite(hiAlt) || hiAlt <= loAlt) {
      loAlt = 0;
      hiAlt = 5000;
    }

    const rawSpan = Math.max(200, hiAlt - loAlt);
    const altStep = calcNiceStep(rawSpan + 300, 5);
    const fitMinAlt = Math.floor((loAlt - 150) / altStep) * altStep;
    const fitMaxAlt = Math.ceil((hiAlt + 150) / altStep) * altStep;

    this.fitMinDKm = 0;
    this.fitMaxDKm = dMaxKm;
    this.fitMinAltM = fitMinAlt;
    this.fitMaxAltM = fitMaxAlt;

    if (options?.forceReset || nodeChanged || !this.userModified) {
      this.resetFit();
      return true;
    }

    return false;
  }

  public resetFit(): void {
    this.minDKm = this.fitMinDKm;
    this.maxDKm = this.fitMaxDKm;
    this.minAltM = this.fitMinAltM;
    this.maxAltM = this.fitMaxAltM;
    this.userModified = false;
  }

  /**
   * Uniform zoom centered at a fractional viewport coordinate (0..1).
   * @param factor > 1 zooms in (closer view), < 1 zooms out (wider view).
   */
  public zoom(factor: number, centerFractionX = 0.5, centerFractionY = 0.5): void {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;

    const currentSpanD = this.maxDKm - this.minDKm;
    const currentSpanAlt = this.maxAltM - this.minAltM;

    let targetSpanD = currentSpanD / factor;
    let targetSpanAlt = currentSpanAlt / factor;

    // Enforce span limits
    targetSpanD = Math.max(VIEWPORT_LIMITS.MIN_SPAN_D_KM, Math.min(VIEWPORT_LIMITS.MAX_SPAN_D_KM, targetSpanD));
    targetSpanAlt = Math.max(VIEWPORT_LIMITS.MIN_SPAN_ALT_M, Math.min(VIEWPORT_LIMITS.MAX_SPAN_ALT_M, targetSpanAlt));

    const fracX = Math.max(0, Math.min(1, centerFractionX));
    const fracY = Math.max(0, Math.min(1, centerFractionY));

    const focusD = this.minDKm + fracX * currentSpanD;
    const focusAlt = this.minAltM + fracY * currentSpanAlt;

    let nextMinD = focusD - fracX * targetSpanD;
    let nextMaxD = nextMinD + targetSpanD;
    let nextMinAlt = focusAlt - fracY * targetSpanAlt;
    let nextMaxAlt = nextMinAlt + targetSpanAlt;

    // Clamp within global domain limits
    if (nextMinD < VIEWPORT_LIMITS.MIN_DOMAIN_D_KM) {
      nextMinD = VIEWPORT_LIMITS.MIN_DOMAIN_D_KM;
      nextMaxD = nextMinD + targetSpanD;
    } else if (nextMaxD > VIEWPORT_LIMITS.MAX_DOMAIN_D_KM) {
      nextMaxD = VIEWPORT_LIMITS.MAX_DOMAIN_D_KM;
      nextMinD = nextMaxD - targetSpanD;
    }

    if (nextMinAlt < VIEWPORT_LIMITS.MIN_DOMAIN_ALT_M) {
      nextMinAlt = VIEWPORT_LIMITS.MIN_DOMAIN_ALT_M;
      nextMaxAlt = nextMinAlt + targetSpanAlt;
    } else if (nextMaxAlt > VIEWPORT_LIMITS.MAX_DOMAIN_ALT_M) {
      nextMaxAlt = VIEWPORT_LIMITS.MAX_DOMAIN_ALT_M;
      nextMinAlt = nextMaxAlt - targetSpanAlt;
    }

    this.minDKm = nextMinD;
    this.maxDKm = nextMaxD;
    this.minAltM = nextMinAlt;
    this.maxAltM = nextMaxAlt;
    this.userModified = true;
  }

  /**
   * Pointer-centered zoom at specific canvas coordinates.
   */
  public zoomAt(factor: number, canvasX: number, canvasY: number, layout: ViewportLayout): void {
    const plotW = Math.max(1, layout.width - layout.padL - layout.padR);
    const plotH = Math.max(1, layout.height - layout.padT - layout.padB);
    const fracX = (canvasX - layout.padL) / plotW;
    const fracY = (layout.padT + plotH - canvasY) / plotH;
    this.zoom(factor, fracX, fracY);
  }

  /**
   * Pan the viewport by canvas pixel delta.
   */
  public pan(deltaPxX: number, deltaPxY: number, layout: ViewportLayout): void {
    if (!Number.isFinite(deltaPxX) || !Number.isFinite(deltaPxY)) return;
    if (deltaPxX === 0 && deltaPxY === 0) return;

    const plotW = Math.max(1, layout.width - layout.padL - layout.padR);
    const plotH = Math.max(1, layout.height - layout.padT - layout.padB);

    const spanD = this.maxDKm - this.minDKm;
    const spanAlt = this.maxAltM - this.minAltM;

    const deltaD = -(deltaPxX / plotW) * spanD;
    const deltaAlt = (deltaPxY / plotH) * spanAlt;

    let nextMinD = this.minDKm + deltaD;
    let nextMaxD = this.maxDKm + deltaD;
    let nextMinAlt = this.minAltM + deltaAlt;
    let nextMaxAlt = this.maxAltM + deltaAlt;

    if (nextMinD < VIEWPORT_LIMITS.MIN_DOMAIN_D_KM) {
      nextMinD = VIEWPORT_LIMITS.MIN_DOMAIN_D_KM;
      nextMaxD = nextMinD + spanD;
    } else if (nextMaxD > VIEWPORT_LIMITS.MAX_DOMAIN_D_KM) {
      nextMaxD = VIEWPORT_LIMITS.MAX_DOMAIN_D_KM;
      nextMinD = nextMaxD - spanD;
    }

    if (nextMinAlt < VIEWPORT_LIMITS.MIN_DOMAIN_ALT_M) {
      nextMinAlt = VIEWPORT_LIMITS.MIN_DOMAIN_ALT_M;
      nextMaxAlt = nextMinAlt + spanAlt;
    } else if (nextMaxAlt > VIEWPORT_LIMITS.MAX_DOMAIN_ALT_M) {
      nextMaxAlt = VIEWPORT_LIMITS.MAX_DOMAIN_ALT_M;
      nextMinAlt = nextMaxAlt - spanAlt;
    }

    this.minDKm = nextMinD;
    this.maxDKm = nextMaxD;
    this.minAltM = nextMinAlt;
    this.maxAltM = nextMaxAlt;
    this.userModified = true;
  }

  // --- Coordinate Transformations ---

  public xToCanvas(dKm: number, layout: ViewportLayout): number {
    const plotW = Math.max(1, layout.width - layout.padL - layout.padR);
    const spanD = Math.max(1e-6, this.maxDKm - this.minDKm);
    return layout.padL + ((dKm - this.minDKm) / spanD) * plotW;
  }

  public yToCanvas(altM: number, layout: ViewportLayout): number {
    const plotH = Math.max(1, layout.height - layout.padT - layout.padB);
    const spanAlt = Math.max(1e-6, this.maxAltM - this.minAltM);
    return layout.padT + plotH - ((altM - this.minAltM) / spanAlt) * plotH;
  }

  public canvasToX(px: number, layout: ViewportLayout): number {
    const plotW = Math.max(1, layout.width - layout.padL - layout.padR);
    const spanD = Math.max(1e-6, this.maxDKm - this.minDKm);
    return this.minDKm + ((px - layout.padL) / plotW) * spanD;
  }

  public canvasToY(py: number, layout: ViewportLayout): number {
    const plotH = Math.max(1, layout.height - layout.padT - layout.padB);
    const spanAlt = Math.max(1e-6, this.maxAltM - this.minAltM);
    return this.minAltM + ((layout.padT + plotH - py) / plotH) * spanAlt;
  }
}

/**
 * Summarizes the authoritative physics status flags for the profile display.
 * Explicitly separates terrain line-of-sight from obstacle screening blockage.
 */
export function summarizeProfileStatus(profile: LinkProfile | null, legacyObstruction?: {
  terrainIsLos?: boolean;
  obstacleBlocked?: boolean;
  minClearanceM?: number;
  diffractionLossDb?: number;
  obstacleIntersections?: readonly { obstacleId: string }[];
}): ProfileStatusSummary {
  const terrainIsLos = profile ? profile.terrainIsLos : (legacyObstruction?.terrainIsLos ?? true);
  const obstacleBlocked = profile ? profile.obstacleBlocked : (legacyObstruction?.obstacleBlocked ?? false);
  const minClearanceM = profile ? profile.terrainMinimumClearanceM : (legacyObstruction?.minClearanceM ?? 0);
  const diffractionLossDb = profile ? profile.diffractionLossDb : (legacyObstruction?.diffractionLossDb ?? 0);

  const blockedId = profile && profile.obstacleIntervals.length > 0
    ? profile.obstacleIntervals[0].obstacleId
    : (legacyObstruction?.obstacleIntersections?.[0]?.obstacleId ?? null);

  let terrainText: string;
  let terrainClass: string;
  if (!terrainIsLos) {
    terrainText = `TERRAIN OCCLUSION (${diffractionLossDb.toFixed(1)} dB OUTAGE)`;
    terrainClass = 'kpi-badge badge-crimson';
  } else if (minClearanceM < 15) {
    terrainText = `GRAZING 0.6 F1 (${minClearanceM >= 0 ? '+' : ''}${minClearanceM.toFixed(0)}m)`;
    terrainClass = 'kpi-badge badge-amber';
  } else {
    terrainText = `PRISTINE LINE-OF-SIGHT (+${minClearanceM.toFixed(0)}m)`;
    terrainClass = 'kpi-badge badge-emerald';
  }

  let obstacleText: string;
  let obstacleClass: string;
  if (obstacleBlocked) {
    obstacleText = blockedId ? `OBSTACLE: BLOCKED [${blockedId}]` : 'OBSTACLE: BLOCKED';
    obstacleClass = 'kpi-badge badge-crimson';
  } else {
    obstacleText = 'OBSTACLES: CLEAR';
    obstacleClass = 'kpi-badge badge-emerald';
  }

  return {
    terrainIsLos,
    obstacleBlocked,
    terrainClearanceM: minClearanceM,
    diffractionLossDb,
    primaryBlockedObstacleId: blockedId,
    terrainStatusText: terrainText,
    terrainBadgeClass: terrainClass,
    obstacleStatusText: obstacleText,
    obstacleBadgeClass: obstacleClass,
  };
}

export interface RenderProfileOptions {
  readonly showFresnel?: boolean;
  readonly showObstacles?: boolean;
  readonly titlePrefix?: string;
}

/**
 * Draws the complete profile to the canvas context using typed profile geometry.
 */
export function renderLinkProfileViewport(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: LinkProfileViewportState,
  profile: LinkProfile | null,
  legacyPoints?: readonly [number, number, number, number][] | null,
  options?: RenderProfileOptions,
): void {
  const { width: w, height: h, padL, padR, padT, padB } = layout;
  if (w <= 0 || h <= 0) return;

  const plotW = Math.max(1, w - padL - padR);
  const plotH = Math.max(1, h - padT - padB);

  // Background sky
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, HIGHLAND_THEME.substrate.bg);
  sky.addColorStop(1, HIGHLAND_THEME.substrate.void);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const samples = profile && profile.valid && profile.samples.length >= 2 ? profile.samples : null;
  if (!samples && (!legacyPoints || legacyPoints.length < 2)) {
    ctx.fillStyle = HIGHLAND_THEME.text.faint;
    ctx.font = `12px ${HIGHLAND_THEME.font.mono}`;
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for link profile data…', w / 2, h / 2);
    return;
  }

  const bounds = viewport.bounds;

  // Grid & Axis Ticks
  const dSpan = bounds.maxDKm - bounds.minDKm;
  const altSpan = bounds.maxAltM - bounds.minAltM;
  const dStep = calcNiceStep(dSpan, 6);
  const altStep = calcNiceStep(altSpan, 5);

  ctx.lineWidth = 1;
  ctx.font = `10px ${HIGHLAND_THEME.font.mono}`;

  // Horizontal elevation gridlines
  const startAlt = Math.ceil(bounds.minAltM / altStep) * altStep;
  for (let alt = startAlt; alt <= bounds.maxAltM + 1e-6; alt += altStep) {
    const y = Math.round(viewport.yToCanvas(alt, layout)) + 0.5;
    if (y >= padT && y <= padT + plotH) {
      ctx.strokeStyle = HIGHLAND_THEME.line.grid;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();

      ctx.fillStyle = HIGHLAND_THEME.text.faint;
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(alt)} m`, padL - 8, y + 3);
    }
  }

  // Vertical distance gridlines
  const startD = Math.max(0, Math.ceil(bounds.minDKm / dStep) * dStep);
  for (let d = startD; d <= bounds.maxDKm + 1e-6; d += dStep) {
    const x = Math.round(viewport.xToCanvas(d, layout)) + 0.5;
    if (x >= padL && x <= padL + plotW) {
      ctx.strokeStyle = HIGHLAND_THEME.line.grid;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();

      ctx.fillStyle = HIGHLAND_THEME.text.faint;
      ctx.textAlign = 'center';
      ctx.fillText(String(+d.toFixed(1)), x, padT + plotH + 14);
    }
  }

  ctx.fillStyle = HIGHLAND_THEME.text.faint;
  ctx.textAlign = 'right';
  ctx.fillText('km from terminal', w - padR, h - 5);

  // Clip profile data rendering strictly to the plot area
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();

  // Draw typed profile or fallback
  if (samples && samples.length > 0) {
    drawTypedProfileContent(ctx, layout, viewport, profile!, samples, options);
  } else if (legacyPoints && legacyPoints.length > 0) {
    drawLegacyProfileContent(ctx, layout, viewport, legacyPoints);
  } else {
    ctx.font = `12px ${HIGHLAND_THEME.font.mono}`;
    ctx.fillStyle = HIGHLAND_THEME.text.faint;
    ctx.textAlign = 'center';
    ctx.fillText('NO GROUND TERMINAL SELECTED · ACN RELAY STANDBY', padL + plotW / 2, padT + plotH / 2);
  }

  ctx.restore();

  // Header info line: Path & Zoom indicator
  const dTotalKm = profile ? profile.horizontalGroundDistanceM / 1000 : (legacyPoints ? legacyPoints.at(-1)?.[0] ?? 0 : 0);
  const slantTotalKm = profile ? profile.slantDistanceM / 1000 : dTotalKm;
  const zoomText = viewport.isUserModified ? ` · Zoom ${viewport.zoomFactor.toFixed(1)}× (drag to pan, wheel to zoom)` : '';
  const diffLossText = profile && profile.diffractionLossDb > 0 ? ` · DiffLoss ${profile.diffractionLossDb.toFixed(1)} dB` : '';
  const prefix = options?.titlePrefix ? `${options.titlePrefix} · ` : '';

  ctx.font = `10px ${HIGHLAND_THEME.font.mono}`;
  ctx.fillStyle = HIGHLAND_THEME.text.muted;
  ctx.textAlign = 'left';
  ctx.fillText(
    `${prefix}Ground path ${dTotalKm.toFixed(1)} km · Slant ${slantTotalKm.toFixed(1)} km${diffLossText}${zoomText}`,
    padL + 4,
    16,
    Math.max(120, plotW - 8)
  );
}

function drawTypedProfileContent(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: LinkProfileViewportState,
  profile: LinkProfile,
  samples: readonly LinkProfileSample[],
  options?: RenderProfileOptions,
): void {
  const { padT, padB, height: h } = layout;
  const plotH = Math.max(1, h - padT - padB);
  const base = padT + plotH;

  const showFresnel = options?.showFresnel !== false;
  const showObstacles = options?.showObstacles !== false;

  // 1. First Fresnel zone (0.6 F1 band)
  if (showFresnel) {
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const x = viewport.xToCanvas(s.horizontalGroundDistanceM / 1000, layout);
      const y = viewport.yToCanvas(s.upperFresnelElevationMslM, layout);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = samples.length - 1; i >= 0; i--) {
      const s = samples[i];
      const x = viewport.xToCanvas(s.horizontalGroundDistanceM / 1000, layout);
      const y = viewport.yToCanvas(s.lowerFresnelElevationMslM, layout);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(233, 196, 106, 0.12)';
    ctx.fill();

    // Dashed Fresnel upper and lower boundary lines
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(233, 196, 106, 0.62)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const x = viewport.xToCanvas(samples[i].horizontalGroundDistanceM / 1000, layout);
      const y = viewport.yToCanvas(samples[i].upperFresnelElevationMslM, layout);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const x = viewport.xToCanvas(samples[i].horizontalGroundDistanceM / 1000, layout);
      const y = viewport.yToCanvas(samples[i].lowerFresnelElevationMslM, layout);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Label 0.6 F₁ boundary near midpoint
    const midSample = samples[Math.floor(samples.length * 0.52)];
    if (midSample) {
      const fx = viewport.xToCanvas(midSample.horizontalGroundDistanceM / 1000, layout);
      const fy = viewport.yToCanvas(midSample.lowerFresnelElevationMslM, layout);
      if (fy > padT + 14 && fy < base - 10) {
        ctx.font = `600 8.5px ${HIGHLAND_THEME.font.mono}`;
        ctx.fillStyle = HIGHLAND_THEME.signal.ochre;
        ctx.textAlign = 'center';
        ctx.fillText('0.6 F₁', fx, fy + 10);
      }
    }
    ctx.restore();
  }

  // 2. Obstacle Screening Intervals (Authoritative structural obstacles)
  if (showObstacles && profile.obstacleIntervals && profile.obstacleIntervals.length > 0) {
    for (const obs of profile.obstacleIntervals) {
      const x1 = viewport.xToCanvas(obs.entryHorizontalDistanceM / 1000, layout);
      const x2 = viewport.xToCanvas(obs.exitHorizontalDistanceM / 1000, layout);
      const bandWidth = Math.max(3, x2 - x1);

      // Vertical obstruction band
      ctx.fillStyle = HIGHLAND_THEME.signal.copperSoft;
      ctx.fillRect(x1, padT, bandWidth, plotH);

      ctx.strokeStyle = HIGHLAND_THEME.signal.copperStrokeSoft;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x1, padT);
      ctx.lineTo(x1, base);
      ctx.moveTo(x1 + bandWidth, padT);
      ctx.lineTo(x1 + bandWidth, base);
      ctx.stroke();

      // Top label
      ctx.font = `600 9.5px ${HIGHLAND_THEME.font.mono}`;
      ctx.fillStyle = HIGHLAND_THEME.signal.copperBright;
      ctx.textAlign = 'center';
      const labelX = Math.max(layout.padL + 20, Math.min(layout.width - layout.padR - 20, x1 + bandWidth / 2));
      ctx.fillText(`⊘ ${obs.obstacleId}`, labelX, padT + 12);
    }
  }

  // 3. Terrain body: Effective terrain (incorporating Earth curvature)
  const tg = ctx.createLinearGradient(0, padT, 0, base);
  tg.addColorStop(0, HIGHLAND_THEME.cartography.terrainTopGrad);
  tg.addColorStop(1, HIGHLAND_THEME.cartography.terrainBottomGrad);

  ctx.beginPath();
  ctx.moveTo(viewport.xToCanvas(samples[0].horizontalGroundDistanceM / 1000, layout), base);
  for (let i = 0; i < samples.length; i++) {
    const x = viewport.xToCanvas(samples[i].horizontalGroundDistanceM / 1000, layout);
    const y = viewport.yToCanvas(samples[i].effectiveTerrainElevationMslM, layout);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(viewport.xToCanvas(samples.at(-1)!.horizontalGroundDistanceM / 1000, layout), base);
  ctx.closePath();
  ctx.fillStyle = tg;
  ctx.fill();

  // Bare DEM elevation line (subtle dashed line below effective terrain)
  ctx.save();
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = HIGHLAND_THEME.cartography.terrainBareDem;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = viewport.xToCanvas(samples[i].horizontalGroundDistanceM / 1000, layout);
    const y = viewport.yToCanvas(samples[i].terrainElevationMslM, layout);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // Highlighted terrain occlusions (effective terrain > LOS ray)
  let idx = 0;
  while (idx < samples.length) {
    if (samples[idx].effectiveTerrainElevationMslM > samples[idx].losElevationMslM) {
      let j = idx;
      while (j < samples.length && samples[j].effectiveTerrainElevationMslM > samples[j].losElevationMslM) j++;

      ctx.beginPath();
      for (let k = idx; k < j; k++) {
        const x = viewport.xToCanvas(samples[k].horizontalGroundDistanceM / 1000, layout);
        const y = viewport.yToCanvas(samples[k].effectiveTerrainElevationMslM, layout);
        if (k === idx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let k = j - 1; k >= idx; k--) {
        const x = viewport.xToCanvas(samples[k].horizontalGroundDistanceM / 1000, layout);
        const y = viewport.yToCanvas(samples[k].losElevationMslM, layout);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(224, 83, 71, 0.42)';
      ctx.fill();

      idx = j;
    } else {
      idx++;
    }
  }

  // Effective terrain stroke outline
  ctx.lineJoin = 'round';
  ctx.strokeStyle = !profile.terrainIsLos ? HIGHLAND_THEME.signal.vermilionBright : HIGHLAND_THEME.cartography.terrainStrokeLos;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = viewport.xToCanvas(samples[i].horizontalGroundDistanceM / 1000, layout);
    const y = viewport.yToCanvas(samples[i].effectiveTerrainElevationMslM, layout);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Dominant crest callout (truthfully sampled max elevation along path)
  let peakIdx = -1;
  let peakElevM = -Infinity;
  for (let k = 1; k < samples.length - 1; k++) {
    if (samples[k].terrainElevationMslM > peakElevM) {
      peakElevM = samples[k].terrainElevationMslM;
      peakIdx = k;
    }
  }
  if (peakIdx >= 0 && Number.isFinite(peakElevM)) {
    const px = viewport.xToCanvas(samples[peakIdx].horizontalGroundDistanceM / 1000, layout);
    const py = viewport.yToCanvas(samples[peakIdx].effectiveTerrainElevationMslM, layout);
    if (py > padT + 12 && py < base - 8) {
      ctx.fillStyle = HIGHLAND_THEME.signal.ochre;
      ctx.beginPath();
      ctx.moveTo(px, py - 5);
      ctx.lineTo(px - 3.5, py + 1.5);
      ctx.lineTo(px + 3.5, py + 1.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 4. Direct Line of Sight (LOS) Ray
  const firstSample = samples[0];
  const lastSample = samples.at(-1)!;
  const pNodeX = viewport.xToCanvas(firstSample.horizontalGroundDistanceM / 1000, layout);
  const pNodeY = viewport.yToCanvas(firstSample.losElevationMslM, layout);
  const pAcnX = viewport.xToCanvas(lastSample.horizontalGroundDistanceM / 1000, layout);
  const pAcnY = viewport.yToCanvas(lastSample.losElevationMslM, layout);

  ctx.strokeStyle = !profile.terrainIsLos ? HIGHLAND_THEME.signal.vermilionBright : HIGHLAND_THEME.signal.sage;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pNodeX, pNodeY);
  ctx.lineTo(pAcnX, pAcnY);
  ctx.stroke();

  // Terminal & ACN endpoint dots
  const drawEndpointDot = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = HIGHLAND_THEME.substrate.void;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  drawEndpointDot(pNodeX, pNodeY, HIGHLAND_THEME.signal.sage);
  drawEndpointDot(pAcnX, pAcnY, HIGHLAND_THEME.signal.amber);

  // Endpoint labels
  ctx.font = `600 10.5px ${HIGHLAND_THEME.font.mono}`;
  ctx.fillStyle = HIGHLAND_THEME.text.primary;
  ctx.textAlign = 'left';
  ctx.fillText(profile.nodeName || 'Terminal', pNodeX + 8, pNodeY - 8);
  ctx.textAlign = 'right';
  ctx.fillText('ACN', pAcnX - 8, pAcnY - 8);

  // 5. Critical Clearance Marker
  let minClearance = Number.POSITIVE_INFINITY;
  let critIndex = -1;
  for (let k = 1; k < samples.length - 1; k++) {
    const clr = samples[k].effectiveTerrainClearanceM;
    if (clr < minClearance) {
      minClearance = clr;
      critIndex = k;
    }
  }

  if (critIndex >= 0 && Number.isFinite(minClearance)) {
    const critSample = samples[critIndex];
    const cx = viewport.xToCanvas(critSample.horizontalGroundDistanceM / 1000, layout);
    const cyTerrain = viewport.yToCanvas(critSample.effectiveTerrainElevationMslM, layout);
    const cyLos = viewport.yToCanvas(critSample.losElevationMslM, layout);

    const isClear = minClearance >= 0;
    const markerColor = isClear ? HIGHLAND_THEME.signal.sage : HIGHLAND_THEME.signal.vermilionBright;

    ctx.strokeStyle = markerColor;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, cyTerrain);
    ctx.lineTo(cx, cyLos);
    ctx.stroke();

    const sign = isClear ? '+' : '';
    const txt = `${sign}${minClearance.toFixed(0)} m`;
    ctx.font = `600 10.5px ${HIGHLAND_THEME.font.mono}`;
    const textWidth = ctx.measureText(txt).width + 10;
    const badgeX = cx + textWidth + 12 < layout.width - layout.padR ? cx + 6 : cx - 6 - textWidth;
    const badgeY = (cyTerrain + cyLos) / 2 - 8;

    ctx.fillStyle = HIGHLAND_THEME.substrate.hudFill;
    ctx.fillRect(badgeX, badgeY, textWidth, 16);
    ctx.strokeStyle = markerColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(badgeX, badgeY, textWidth, 16);

    ctx.fillStyle = markerColor;
    ctx.textAlign = 'left';
    ctx.fillText(txt, badgeX + 5, badgeY + 12);
  }
}

function drawLegacyProfileContent(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: LinkProfileViewportState,
  pts: readonly [number, number, number, number][],
): void {
  const { padT, padB, height: h } = layout;
  const plotH = Math.max(1, h - padT - padB);
  const base = padT + plotH;
  const last = pts.length - 1;

  // First Fresnel zone (0.6 F1 band)
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = viewport.xToCanvas(p[0], layout);
    const y = viewport.yToCanvas(2 * p[2] - p[3], layout);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  for (let i = last; i >= 0; i--) {
    ctx.lineTo(viewport.xToCanvas(pts[i][0], layout), viewport.yToCanvas(pts[i][3], layout));
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(233, 196, 106, 0.12)';
  ctx.fill();

  // Terrain body
  ctx.beginPath();
  ctx.moveTo(viewport.xToCanvas(pts[0][0], layout), base);
  pts.forEach(p => ctx.lineTo(viewport.xToCanvas(p[0], layout), viewport.yToCanvas(p[1], layout)));
  ctx.lineTo(viewport.xToCanvas(pts[last][0], layout), base);
  ctx.closePath();
  ctx.fillStyle = HIGHLAND_THEME.cartography.terrainTopGrad;
  ctx.fill();

  // LOS Ray
  const pNX = viewport.xToCanvas(pts[0][0], layout);
  const pNY = viewport.yToCanvas(pts[0][2], layout);
  const pAX = viewport.xToCanvas(pts[last][0], layout);
  const pAY = viewport.yToCanvas(pts[last][2], layout);

  ctx.strokeStyle = HIGHLAND_THEME.signal.sage;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pNX, pNY);
  ctx.lineTo(pAX, pAY);
  ctx.stroke();
}

/**
 * Renders the dedicated Terrain Path Profile in cross-sectional PROFILE mode.
 * Highlights the effective terrain profile, bare DEM, Earth curvature, and clearance without Fresnel overlay.
 */
export function renderTerrainProfileViewport(
  ctx: CanvasRenderingContext2D,
  layout: ViewportLayout,
  viewport: LinkProfileViewportState,
  profile: LinkProfile | null,
  legacyPoints?: readonly [number, number, number, number][] | null,
): void {
  renderLinkProfileViewport(ctx, layout, viewport, profile, legacyPoints, {
    showFresnel: false,
    titlePrefix: 'TERRAIN PROFILE',
  });
}

