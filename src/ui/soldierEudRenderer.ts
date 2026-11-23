/**
 * src/ui/soldierEudRenderer.ts
 *
 * Matte MIL-STD-2525 / ATAK Soldier Handheld EUD Renderer.
 * Zero emojis, zero glowing gradients — crisp vector geometric symbology
 * and deterministic 6-state tactical notification resolution.
 */

import { syncCanvasDpr } from './pathProfileTopView';
import { getLatticeCanvasPalette } from './canvasTheme';

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

  const palette = getLatticeCanvasPalette();
  const colOk = palette.optimal;
  const colWarn = palette.degraded;
  const colErr = palette.outage;
  const colRelay = palette.relay;
  const colCmd = palette.accent;

  if (isMoving) {
    const eta = typeof etaS === 'number' ? Math.round(etaS) : '--';
    const dist = typeof distM === 'number' ? Math.round(distM) : '--';
    return {
      background: '#121a24',
      borderColor: colCmd,
      title: `[MOVE] MOVING TO VANTAGE POINT (ETA ${eta}s · ${dist}m)`,
      titleColor: colCmd,
      badge: 'IN TRANSIT',
      badgeText: 'IN TRANSIT',
      badgeColor: colCmd,
      badgeBackground: 'rgba(56, 189, 248, 0.14)',
      text: directiveText || 'Relocating to cleared ridge vantage point.',
    };
  }

  if (blackoutSec !== null && blackoutSec !== undefined && blackoutSec <= 15.0) {
    return {
      background: '#1d1216',
      borderColor: colErr,
      title: `[ALERT] BLACKOUT IN ${blackoutSec.toFixed(1)}s`,
      titleColor: colErr,
      badge: 'PREDICTIVE',
      badgeText: 'PREDICTIVE',
      badgeColor: colErr,
      badgeBackground: 'rgba(239, 68, 68, 0.14)',
      text: 'Terrain mask imminent (<15s). Switch to Buddy-Mesh or relocate.',
    };
  }

  if (isPinned && aiSkyShepherdActive) {
    const s = typeof sinrDb === 'number' ? sinrDb : 0.0;
    return {
      background: '#121a24',
      borderColor: colCmd,
      title: `[UAV] SKY-SHEPHERD UAV REPOSITIONING (+${s.toFixed(1)} dB)`,
      titleColor: colCmd,
      badge: 'PINNED RESCUE',
      badgeText: 'PINNED RESCUE',
      badgeColor: colCmd,
      badgeBackground: 'rgba(56, 189, 248, 0.14)',
      text: aiSkyShepherdDirective || 'ACN orbit offset shifted for canyon LOS recovery.',
    };
  }

  if (isBuddy && (!isOutage || (modcodName && modcodName.startsWith('BUDDY:')))) {
    const rate = typeof bitrateMbps === 'number'
      ? bitrateMbps.toFixed(1)
      : (typeof aiBuddyRateMbps === 'number' ? aiBuddyRateMbps.toFixed(1) : '--');
    return {
      background: '#141726',
      borderColor: colRelay,
      title: `[BUDDY] BUDDY-MESH DELIVERING (${rate} Mbps)`,
      titleColor: colRelay,
      badge: 'PEER MESH',
      badgeText: 'PEER MESH',
      badgeColor: colRelay,
      badgeBackground: 'rgba(129, 140, 248, 0.14)',
      text: `Direct ACN path masked. Relaying via S${buddyNodeId ?? '?'} at ${rate} Mbps.`,
    };
  }

  if (needsMove) {
    return {
      background: '#1c1811',
      borderColor: colWarn,
      title: '[MOVE] AI WALK DIRECTIVE',
      titleColor: colWarn,
      badge: 'PATHFINDER',
      badgeText: 'PATHFINDER',
      badgeColor: colWarn,
      badgeBackground: 'rgba(234, 179, 8, 0.14)',
      text: directiveText || 'Relocate to clear LOS vantage point.',
    };
  }

  if (!isOutage && typeof sinrDb === 'number' && sinrDb >= 8.0) {
    return {
      background: '#101a16',
      borderColor: colOk,
      title: `[LOS] AI LINK RESTORED: Clear LoS at +${sinrDb.toFixed(1)} dB`,
      titleColor: colOk,
      badge: 'CLEAR LOS',
      badgeText: 'CLEAR LOS',
      badgeColor: colOk,
      badgeBackground: 'rgba(34, 197, 94, 0.14)',
      text: 'Direct ACN X-band link nominal.',
    };
  }

  return {
    background: '#101a16',
    borderColor: colOk,
    title: '[OPTIMAL] POSITION OPTIMAL',
    titleColor: colOk,
    badge: 'CLEAR LOS',
    badgeText: 'CLEAR LOS',
    badgeColor: colOk,
    badgeBackground: 'rgba(34, 197, 94, 0.14)',
    text: 'Direct ACN X-band link nominal.',
  };
}

/**
 * Draws a crisp matte MIL-STD-2525 / ATAK 360-degree Tactical Compass Scope.
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

  const palette = getLatticeCanvasPalette();
  const colOk = palette.optimal;
  const colWarn = palette.degraded;
  const colErr = palette.outage;
  const colRelay = palette.relay;
  const colCmd = palette.accent;

  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(cx, cy) - 14;

  ctx.save();

  // Matte instrument dial face (no glowing gradient)
  ctx.fillStyle = palette.voidBg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = palette.panelBg;
  ctx.strokeStyle = palette.gridMajor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Concentric range rings (33%, 66%)
  ctx.strokeStyle = palette.gridMinor;
  ctx.lineWidth = 1;
  for (const frac of [0.33, 0.66]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Orthogonal azimuth crosshairs
  ctx.strokeStyle = palette.gridMinor;
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  // 10-degree minor & 30-degree major azimuth ticks + cardinal letters
  ctx.font = '600 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let deg = 0; deg < 360; deg += 10) {
    const rad = ((deg - 90) * Math.PI) / 180;
    const isCardinal = deg % 90 === 0;
    const isMajor = deg % 30 === 0;
    const tickLen = isCardinal ? 8 : isMajor ? 5 : 3;
    ctx.strokeStyle = isCardinal ? colCmd : isMajor ? palette.axisStroke : palette.gridMajor;
    ctx.lineWidth = isCardinal ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * (radius - tickLen), cy + Math.sin(rad) * (radius - tickLen));
    ctx.lineTo(cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius);
    ctx.stroke();

    if (isCardinal) {
      const label = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : 'W';
      const lr = radius - 16;
      ctx.fillStyle = deg === 0 ? colErr : palette.textSecondary;
      ctx.fillText(label, cx + Math.cos(rad) * lr, cy + Math.sin(rad) * lr);
    }
  }

  if (!node) {
    ctx.restore();
    return;
  }

  const nX = node.x_m !== undefined ? node.x_m : (node.position ? node.position[0] : 0);
  const nY = node.y_m !== undefined ? node.y_m : (node.position ? node.position[1] : 0);

  // Airborne ACN / UAV Vector Chevron (MIL-STD Air Friendly Symbol — zero emoji)
  if (frame && frame.acn_telemetry) {
    const uavX = frame.acn_telemetry.pos_x ?? 0;
    const uavY = frame.acn_telemetry.pos_y ?? 0;
    const uavAngle = Math.atan2(uavX - nX, uavY - nY) - Math.PI / 2;
    const ux = cx + Math.cos(uavAngle) * (radius * 0.84);
    const uy = cy + Math.sin(uavAngle) * (radius * 0.84);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ux, uy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = colCmd;
    ctx.fillStyle = palette.panelBg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ux, uy - 5);
    ctx.lineTo(ux + 5, uy + 4);
    ctx.lineTo(ux, uy + 1.5);
    ctx.lineTo(ux - 5, uy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = colCmd;
    ctx.font = '700 10px monospace';
    ctx.fillText('ACN', ux, uy - 11);
  }

  // Hostile EW Jammer Diamond Symbol (MIL-STD Hostile — zero emoji)
  if (frame && frame.jammer_enabled && frame.jammer_pos_enu) {
    const jAngle = Math.atan2(frame.jammer_pos_enu[0] - nX, frame.jammer_pos_enu[1] - nY) - Math.PI / 2;
    const jx = cx + Math.cos(jAngle) * (radius * 0.84);
    const jy = cy + Math.sin(jAngle) * (radius * 0.84);

    ctx.strokeStyle = colErr;
    ctx.fillStyle = '#1d1216';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(jx, jy - 5.5);
    ctx.lineTo(jx + 5.5, jy);
    ctx.lineTo(jx, jy + 5.5);
    ctx.lineTo(jx - 5.5, jy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = colErr;
    ctx.font = '700 10px monospace';
    ctx.fillText('EW', jx, jy + 12);
  }

  // Peer Squadmates & Buddy-Mesh Relay
  if (frame && Array.isArray(frame.nodes_telemetry)) {
    frame.nodes_telemetry.forEach(other => {
      if (other.node_id === node.node_id) return;
      const oX = other.x_m !== undefined ? other.x_m : (other.position ? other.position[0] : 0);
      const oY = other.y_m !== undefined ? other.y_m : (other.position ? other.position[1] : 0);
      const dx = oX - nX;
      const dy = oY - nY;
      const dist = Math.hypot(dx, dy);
      const isBuddy = node.ai_buddy_node_id === other.node_id;

      const rRatio = Math.min(dist / 4000, 0.78);
      const bRad = Math.atan2(dx, dy) - Math.PI / 2;
      const px = cx + Math.cos(bRad) * (radius * rRatio);
      const py = cy + Math.sin(bRad) * (radius * rRatio);

      if (isBuddy) {
        ctx.strokeStyle = colRelay;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = palette.panelBg;
        ctx.strokeStyle = colRelay;
        ctx.lineWidth = 1.5;
        ctx.fillRect(px - 4, py - 4, 8, 8);
        ctx.strokeRect(px - 4, py - 4, 8, 8);
        ctx.fillStyle = colRelay;
        ctx.font = '700 10px monospace';
        ctx.fillText(`RLY S${other.node_id}`, px, py - 10);
      } else {
        ctx.fillStyle = palette.textMuted;
        ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
        ctx.font = '600 10px monospace';
        ctx.fillText(`S${other.node_id}`, px, py - 8);
      }
    });
  }

  // Turn-by-Turn AI Reposition Vector & Reticle (zero emoji)
  if (rec && rec.needsReposition && rec.targetPosEnu) {
    const tDx = rec.targetPosEnu[0] - nX;
    const tDy = rec.targetPosEnu[1] - nY;
    const distM = Math.hypot(tDx, tDy);
    const angleMath = Math.atan2(tDx, tDy) - Math.PI / 2;
    const arrowLen = Math.min(radius * 0.68, Math.max(36, (distM / 300) * radius * 0.68));
    const tipX = cx + Math.cos(angleMath) * arrowLen;
    const tipY = cy + Math.sin(angleMath) * arrowLen;

    ctx.strokeStyle = colOk;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    const headLen = 9;
    const headAngle = Math.PI / 6;
    ctx.fillStyle = colOk;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headLen * Math.cos(angleMath - headAngle), tipY - headLen * Math.sin(angleMath - headAngle));
    ctx.lineTo(tipX - headLen * Math.cos(angleMath + headAngle), tipY - headLen * Math.sin(angleMath + headAngle));
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = colWarn;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(tipX, tipY, 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = colWarn;
    ctx.font = '700 10px monospace';
    ctx.fillText('VANTAGE', tipX, tipY - 10);
  }

  // Ownship Center Reticle
  ctx.fillStyle = node.is_outage ? colErr : colOk;
  ctx.strokeStyle = palette.textPrimary;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

export const drawSoldierCompassCanvas = drawSoldierCompassScope;
