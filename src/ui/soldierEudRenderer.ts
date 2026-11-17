/**
 * src/ui/soldierEudRenderer.ts
 *
 * Dedicated Type-Checked Renderer for ATAK Soldier Handheld Phone (EUD) Workspace.
 *
 * Renders:
 * 1. 360° Tactical Compass Canvas Scope (UAV relative heading, EW jammer angle,
 *    peer squadmate bearings, buddy mesh link line, and turn-by-turn guidance arrow).
 * 2. Deterministic AI Notification Banner resolution across 6 tactical states.
 *
 * Specification: docs/specs/SPEC-SOFTWARE-ENGINEERING-MODULARITY-AND-DRY-REFACTOR.md
 */

import { syncCanvasDpr } from './pathProfileTopView';

export interface SoldierCompassNodeTelemetry {
  readonly node_id: number;
  readonly name?: string;
  readonly x_m?: number;
  readonly y_m?: number;
  readonly position?: [number, number, number] | readonly [number, number, number];
  readonly is_outage?: boolean;
  readonly ai_buddy_node_id?: number | null;
}

export interface SoldierCompassFrameTelemetry {
  readonly acn_telemetry?: {
    readonly pos_x?: number;
    readonly pos_y?: number;
  };
  readonly jammer_enabled?: boolean;
  readonly jammer_pos_enu?: [number, number, number] | readonly [number, number, number];
  readonly nodes_telemetry?: readonly SoldierCompassNodeTelemetry[];
}

export interface SoldierCompassAiRecommendation {
  readonly needsReposition?: boolean;
  readonly targetPosEnu?: [number, number, number] | readonly [number, number, number];
}

export interface SoldierNotificationBanner {
  background: string;
  borderColor: string;
  title: string;
  titleColor: string;
  badge: string;
  badgeText: string;
  badgeColor: string;
  badgeBackground: string;
  text: string;
}

export type SoldierAiBannerResult = SoldierNotificationBanner;

export interface SoldierAiBannerNodeLike {
  node_id?: number;
  ai_is_moving?: boolean;
  ai_eta_s?: number;
  ai_move_dist_m?: number;
  ai_directive_text?: string;
  ai_blackout_in_s?: number | null;
  ai_is_pinned?: boolean;
  ai_buddy_node_id?: number | null;
  bitrate_mbps?: number;
  ai_buddy_rate_mbps?: number;
  is_outage?: boolean;
  modcod_name?: string;
  ai_needs_reposition?: boolean;
  sinr_db?: number;
}

/**
 * Resolves the visual styling, badges, title, and descriptive body text
 * for the ATAK Soldier Phone AI Notification Banner across all 6 operational states.
 */
export function resolveSoldierAiNotificationBanner(
  selNodeOrParams: SoldierAiBannerNodeLike | any,
  isPinnedArg?: boolean,
  aiSkyShepherdActiveArg?: boolean,
  aiSkyShepherdDirectiveArg?: string
): SoldierNotificationBanner {
  const isDirectCall = typeof isPinnedArg === 'boolean' || typeof isPinnedArg === 'undefined';

  const isMoving = Boolean(isDirectCall ? selNodeOrParams?.ai_is_moving : selNodeOrParams?.isMoving);
  const etaS = isDirectCall ? selNodeOrParams?.ai_eta_s : selNodeOrParams?.etaSeconds;
  const distM = isDirectCall ? selNodeOrParams?.ai_move_dist_m : selNodeOrParams?.moveDistM;
  const directiveText = isDirectCall ? selNodeOrParams?.ai_directive_text : selNodeOrParams?.aiDirectiveText;

  const blackoutSec = isDirectCall
    ? selNodeOrParams?.ai_blackout_in_s
    : (selNodeOrParams?.isBlackoutSoon ? (selNodeOrParams?.blackoutSeconds ?? 10.0) : undefined);

  const isPinned = isDirectCall
    ? (Boolean(isPinnedArg) || Boolean(selNodeOrParams?.ai_is_pinned))
    : Boolean(selNodeOrParams?.isPinned);

  const aiSkyShepherdActive = isDirectCall
    ? Boolean(aiSkyShepherdActiveArg)
    : Boolean(selNodeOrParams?.aiSkyShepherdActive);

  const aiSkyShepherdDirective = isDirectCall
    ? aiSkyShepherdDirectiveArg
    : selNodeOrParams?.aiSkyShepherdDirective;

  const isBuddy = isDirectCall
    ? (selNodeOrParams?.ai_buddy_node_id !== null && selNodeOrParams?.ai_buddy_node_id !== undefined)
    : Boolean(selNodeOrParams?.isBuddy);

  const buddyNodeId = isDirectCall ? selNodeOrParams?.ai_buddy_node_id : selNodeOrParams?.aiBuddyNodeId;
  const isOutage = isDirectCall ? Boolean(selNodeOrParams?.is_outage) : Boolean(selNodeOrParams?.isOutage);
  const modcodName = isDirectCall ? selNodeOrParams?.modcod_name : selNodeOrParams?.modcodName;
  const bitrateMbps = isDirectCall ? selNodeOrParams?.bitrate_mbps : selNodeOrParams?.bitrateMbps;
  const aiBuddyRateMbps = isDirectCall ? selNodeOrParams?.ai_buddy_rate_mbps : selNodeOrParams?.aiBuddyRateMbps;
  const needsMove = isDirectCall ? Boolean(selNodeOrParams?.ai_needs_reposition) : Boolean(selNodeOrParams?.needsMove);
  const sinrDb = isDirectCall ? selNodeOrParams?.sinr_db : selNodeOrParams?.sinrDb;

  // 1. In Transit State
  if (isMoving) {
    const eta = typeof etaS === 'number' ? Math.round(etaS) : '--';
    const dist = typeof distM === 'number' ? Math.round(distM) : '--';
    return {
      background: 'rgba(56, 189, 248, 0.25)',
      borderColor: 'rgba(56, 189, 248, 0.7)',
      title: `🚶 MOVING TO VANTAGE POINT (ETA ${eta}s · ${dist}m)`,
      titleColor: '#38bdf8',
      badge: 'IN TRANSIT',
      badgeText: 'IN TRANSIT',
      badgeColor: '#38bdf8',
      badgeBackground: 'rgba(56, 189, 248, 0.2)',
      text: directiveText || 'Walking towards AI-selected ridge vantage point.',
    };
  }

  // 2. Predictive 15s Blackout Countdown
  if (blackoutSec !== null && blackoutSec !== undefined && blackoutSec <= 15.0) {
    return {
      background: 'rgba(239, 68, 68, 0.2)',
      borderColor: 'rgba(239, 68, 68, 0.6)',
      title: `⏳ BLACKOUT IN ${blackoutSec.toFixed(1)}s`,
      titleColor: '#ef4444',
      badge: 'PREDICTIVE',
      badgeText: 'PREDICTIVE',
      badgeColor: '#ef4444',
      badgeBackground: 'rgba(239, 68, 68, 0.2)',
      text: 'UAV orbit will enter mountain shadow in <15s. Shift to Buddy-Mesh or move to safe spot.',
    };
  }

  // 3. Sky-Shepherd Pinned Rescue
  if (isPinned && aiSkyShepherdActive) {
    const s = typeof sinrDb === 'number' ? sinrDb : 0.0;
    return {
      background: 'rgba(56, 189, 248, 0.2)',
      borderColor: 'rgba(56, 189, 248, 0.6)',
      title: `✈️ SKY-SHEPHERD UAV REPOSITIONING (+${s.toFixed(1)} dB)`,
      titleColor: '#38bdf8',
      badge: 'PINNED RESCUE',
      badgeText: 'PINNED RESCUE',
      badgeColor: '#38bdf8',
      badgeBackground: 'rgba(56, 189, 248, 0.2)',
      text: aiSkyShepherdDirective || 'UAV shifted loiter center to look directly into pinned canyon.',
    };
  }

  // 4. Peer Buddy-Mesh Active Forwarding
  if (isBuddy && (!isOutage || (modcodName && modcodName.startsWith('BUDDY:')))) {
    const rate = typeof bitrateMbps === 'number'
      ? bitrateMbps.toFixed(1)
      : (typeof aiBuddyRateMbps === 'number' ? aiBuddyRateMbps.toFixed(1) : '--');
    return {
      background: 'rgba(192, 132, 252, 0.2)',
      borderColor: 'rgba(192, 132, 252, 0.6)',
      title: `🔗 BUDDY-MESH DELIVERING (${rate} Mbps)`,
      titleColor: '#c084fc',
      badge: 'PEER MESH',
      badgeText: 'PEER MESH',
      badgeColor: '#c084fc',
      badgeBackground: 'rgba(192, 132, 252, 0.2)',
      text: `Direct UAV link shadowed. Traffic decoded & forwarded via S${buddyNodeId ?? '?'} at ${rate} Mbps.`,
    };
  }

  // 5. AI Walk Directive (Stationary, needs move)
  if (needsMove) {
    return {
      background: 'rgba(245, 158, 11, 0.2)',
      borderColor: 'rgba(245, 158, 11, 0.6)',
      title: '🚶 AI WALK DIRECTIVE',
      titleColor: '#fbbf24',
      badge: 'PATHFINDER',
      badgeText: 'PATHFINDER',
      badgeColor: '#fbbf24',
      badgeBackground: 'rgba(245, 158, 11, 0.2)',
      text: directiveText || 'Relocate to clear LoS vantage point with gentle slope.',
    };
  }

  // 6. Optimal Clear LoS Link Restored
  if (!isOutage && typeof sinrDb === 'number' && sinrDb >= 8.0) {
    return {
      background: 'rgba(16, 36, 28, 0.75)',
      borderColor: 'rgba(52, 211, 153, 0.4)',
      title: `🟢 AI LINK RESTORED: Clear LoS at +${sinrDb.toFixed(1)} dB`,
      titleColor: '#34d399',
      badge: 'CLEAR LOS',
      badgeText: 'CLEAR LOS',
      badgeColor: '#34d399',
      badgeBackground: 'rgba(52, 211, 153, 0.2)',
      text: 'Clear LoS to ACN loiter orbit. DVB-S2X link closure healthy.',
    };
  }

  return {
    background: 'rgba(16, 36, 28, 0.75)',
    borderColor: 'rgba(52, 211, 153, 0.4)',
    title: '🟢 POSITION OPTIMAL',
    titleColor: '#34d399',
    badge: 'CLEAR LOS',
    badgeText: 'CLEAR LOS',
    badgeColor: '#34d399',
    badgeBackground: 'rgba(52, 211, 153, 0.2)',
    text: 'Clear LoS to ACN loiter orbit. DVB-S2X link closure healthy.',
  };
}

/**
 * Draws the high-contrast 360° ATAK Soldier Phone Compass Canvas.
 */
export function drawSoldierCompassScope(
  canvas: HTMLCanvasElement | null,
  ctx: CanvasRenderingContext2D | null,
  node: SoldierCompassNodeTelemetry | null | undefined,
  frame: SoldierCompassFrameTelemetry | null | undefined,
  rec?: SoldierCompassAiRecommendation | null
): void {
  if (!canvas || !ctx) return;
  const sync = syncCanvasDpr(canvas, ctx);
  if (!sync.isVisible) return;
  const w = sync.cssWidth || 260;
  const h = sync.cssHeight || 260;
  if (w <= 0 || h <= 0) return;

  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(cx, cy) - 14;

  // Background Dial
  ctx.save();
  const bgGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, radius);
  bgGrad.addColorStop(0, '#0a1017');
  bgGrad.addColorStop(1, '#04070a');
  ctx.fillStyle = bgGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Range rings (33%, 66%, 100%)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  [0.33, 0.66, 1.0].forEach(frac => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Crosshairs
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  // Compass Ticks and Cardinal Letters (N, E, S, W)
  ctx.font = '700 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let deg = 0; deg < 360; deg += 30) {
    const rad = ((deg - 90) * Math.PI) / 180;
    const isCardinal = deg % 90 === 0;
    const tickLen = isCardinal ? 7 : 4;
    const r1 = radius - tickLen;
    const r2 = radius;
    ctx.strokeStyle = isCardinal ? '#38bdf8' : 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = isCardinal ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1);
    ctx.lineTo(cx + Math.cos(rad) * r2, cy + Math.sin(rad) * r2);
    ctx.stroke();

    if (isCardinal) {
      const label = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : 'W';
      const lr = radius - 14;
      ctx.fillStyle = deg === 0 ? '#ef4444' : '#94a3b8';
      ctx.fillText(label, cx + Math.cos(rad) * lr, cy + Math.sin(rad) * lr);
    }
  }

  if (!node) {
    ctx.restore();
    return;
  }

  const nX = node.x_m !== undefined ? node.x_m : (node.position ? node.position[0] : 0);
  const nY = node.y_m !== undefined ? node.y_m : (node.position ? node.position[1] : 0);

  // Draw UAV (ACN) direction indicator
  if (frame && frame.acn_telemetry) {
    const acn = frame.acn_telemetry;
    const uavX = acn.pos_x ?? 0;
    const uavY = acn.pos_y ?? 0;
    const uavDx = uavX - nX;
    const uavDy = uavY - nY;
    const uavBearingRad = Math.atan2(uavDx, uavDy); // 0 = N, pi/2 = E
    const uavAngleMath = uavBearingRad - Math.PI / 2; // canvas angle
    const uavIconR = radius * 0.88;
    const ux = cx + Math.cos(uavAngleMath) * uavIconR;
    const uy = cy + Math.sin(uavAngleMath) * uavIconR;

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(ux, uy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 8.5px monospace';
    ctx.fillText('🛰 UAV', ux, uy - 7);
  }

  // Draw Enemy Jammer indicator if active
  if (frame && frame.jammer_enabled && frame.jammer_pos_enu) {
    const jDx = frame.jammer_pos_enu[0] - nX;
    const jDy = frame.jammer_pos_enu[1] - nY;
    const jBearingRad = Math.atan2(jDx, jDy);
    const jAngleMath = jBearingRad - Math.PI / 2;
    const jIconR = radius * 0.88;
    const jx = cx + Math.cos(jAngleMath) * jIconR;
    const jy = cy + Math.sin(jAngleMath) * jIconR;

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(jx, jy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '700 8px monospace';
    ctx.fillText('⚠️ EW-JAM', jx, jy + 10);
  }

  // Draw Squadmates / Buddies within local scope
  if (frame && Array.isArray(frame.nodes_telemetry)) {
    frame.nodes_telemetry.forEach(other => {
      if (other.node_id === node.node_id) return;
      const oX = other.x_m !== undefined ? other.x_m : (other.position ? other.position[0] : 0);
      const oY = other.y_m !== undefined ? other.y_m : (other.position ? other.position[1] : 0);
      const dx = oX - nX;
      const dy = oY - nY;
      const dist = Math.hypot(dx, dy);
      const isBuddy = node.ai_buddy_node_id === other.node_id;

      const maxRangeM = 4000;
      const rRatio = Math.min(dist / maxRangeM, 0.82);
      const bRad = Math.atan2(dx, dy) - Math.PI / 2;
      const px = cx + Math.cos(bRad) * (radius * rRatio);
      const py = cy + Math.sin(bRad) * (radius * rRatio);

      if (isBuddy) {
        ctx.strokeStyle = '#c084fc';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#c084fc';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '700 8.5px monospace';
        ctx.fillText(`🔗 S${other.node_id}`, px, py - 8);
      } else {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '600 7.5px monospace';
        ctx.fillText(`S${other.node_id}`, px, py - 5);
      }
    });
  }

  // Draw Center Reticle (Soldier position)
  ctx.fillStyle = node.is_outage ? '#ef4444' : '#10b981';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Turn-by-Turn Navigation Arrow to AI Waypoint (if recommended)
  if (rec && rec.needsReposition && rec.targetPosEnu) {
    const tDx = rec.targetPosEnu[0] - nX;
    const tDy = rec.targetPosEnu[1] - nY;
    const distM = Math.hypot(tDx, tDy);
    const bearingRad = Math.atan2(tDx, tDy);
    const angleMath = bearingRad - Math.PI / 2;

    const arrowLen = Math.min(radius * 0.7, Math.max(35, (distM / 300) * radius * 0.7));
    const tipX = cx + Math.cos(angleMath) * arrowLen;
    const tipY = cy + Math.sin(angleMath) * arrowLen;

    ctx.save();
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    const headLen = 10;
    const headAngle = Math.PI / 6;
    ctx.fillStyle = '#34d399';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headLen * Math.cos(angleMath - headAngle), tipY - headLen * Math.sin(angleMath - headAngle));
    ctx.lineTo(tipX - headLen * Math.cos(angleMath + headAngle), tipY - headLen * Math.sin(angleMath + headAngle));
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(tipX, tipY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '700 8.5px monospace';
    ctx.fillText('★ AI SAFE', tipX, tipY - 8);

    ctx.restore();
  }

  ctx.restore();
}

/**
 * Backward compatibility alias for drawSoldierCompassScope.
 */
export const drawSoldierCompassCanvas = drawSoldierCompassScope;
