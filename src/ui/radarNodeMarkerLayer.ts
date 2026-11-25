/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Radar Ground Node Marker Overlay & Smooth Transition Engine
 *
 * Renders ground terminal markers as GPU-composited DOM nodes layered over the
 * 2D radar canvas (`#radar-container`), enabling:
 * - Smooth CSS `transform` transitions as fleet ground terminals move across terrain
 * - Instant zero-lag repositioning during interactive camera pan/zoom/resize
 * - Smooth CSS color/border/shape transitions when link status changes
 * - Web Animations API (WAAPI) acquisition rings, status-change pulses, and selection lock-on
 * - Automatic `prefers-reduced-motion: reduce` respect and WP-10 CVD palette inheritance
 */

import {
  classifyLinkCommunicationStatus,
  LinkCommunicationStatus,
  MIN_OPERATIONAL_SNR_DB,
} from '../core/linkStatusClassifier';

// ============================================================================
// Pure Types & Classifiers
// ============================================================================

export type RadarMarkerVisualStatus =
  | 'connected'
  | 'degraded'
  | 'blocked-terrain'
  | 'blocked-obstacle'
  | 'outage'
  | 'unknown';

export interface RadarCameraSignature {
  readonly width: number;
  readonly height: number;
  readonly rangeM: number;
  readonly panX: number;
  readonly panY: number;
}

export interface RadarNodeTelemetryLike {
  readonly nodeId?: number;
  readonly node_id?: number;
  readonly callsign?: string | null;
  readonly label?: string | null;
  readonly posX?: number;
  readonly posY?: number;
  readonly terrain_is_los?: boolean | null;
  readonly isLos?: boolean | null;
  readonly obstacle_blocked?: boolean | null;
  readonly isObstacleBlocked?: boolean | null;
  readonly link_outage?: boolean | null;
  readonly is_outage?: boolean | null;
  readonly isOutage?: boolean | null;
  readonly diffraction_loss_db?: number | null;
  readonly snr_db?: number | null;
  readonly snrDb?: number | null;
  readonly modcod_name?: string | null;
  readonly state_name?: string | null;
  readonly predicted_state?: string | null;
  readonly currentState?: string | null;
  readonly time_to_occlusion_s?: number | null;
  readonly is_coverage_complete?: boolean | null;
  readonly isCoverageComplete?: boolean | null;
  readonly [key: string]: unknown;
}

export interface RadarMarkerProjection {
  readonly nodeId: number;
  readonly x: number;
  readonly y: number;
  readonly status: RadarMarkerVisualStatus;
  readonly selected: boolean;
  readonly label: string;
  readonly snrDb?: number | null;
}

export interface RadarMarkerMotionDelta {
  readonly distancePx: number;
  readonly headingDeg: number | null;
  readonly moved: boolean;
}

const CAMERA_EPSILON = 1e-4;
const MOTION_THRESHOLD_PX = 0.35;

/**
 * Maps an authoritative `LinkCommunicationStatus` to its CSS `data-status` token.
 */
export function mapLinkStatusToMarkerStatus(
  status: LinkCommunicationStatus
): RadarMarkerVisualStatus {
  switch (status) {
    case 'CONNECTED':
      return 'connected';
    case 'DEGRADED':
      return 'degraded';
    case 'BLOCKED_TERRAIN':
      return 'blocked-terrain';
    case 'BLOCKED_OBSTACLE':
      return 'blocked-obstacle';
    case 'OUTAGE_DISCONNECTED':
      return 'outage';
    default:
      return 'unknown';
  }
}

/**
 * Pure, deterministic resolver that maps either a live `nodes_telemetry` record
 * or a compact historical `SpatialNodeSnapshot` into a semantic marker status.
 */
export function resolveRadarNodeMarkerStatus(
  raw: RadarNodeTelemetryLike | null | undefined
): RadarMarkerVisualStatus {
  if (!raw || typeof raw !== 'object') return 'unknown';

  const hasObstacleBool = typeof raw.obstacle_blocked === 'boolean' || typeof raw.isObstacleBlocked === 'boolean';
  const hasLosBool = typeof raw.terrain_is_los === 'boolean' || typeof raw.isLos === 'boolean';
  const hasOutageBool =
    typeof raw.link_outage === 'boolean' ||
    typeof raw.is_outage === 'boolean' ||
    typeof raw.isOutage === 'boolean';

  if (hasLosBool) {
    const obstacleBlocked =
      typeof raw.obstacle_blocked === 'boolean'
        ? raw.obstacle_blocked
        : typeof raw.isObstacleBlocked === 'boolean'
          ? raw.isObstacleBlocked
          : false;
    const terrainIsLos =
      typeof raw.terrain_is_los === 'boolean'
        ? raw.terrain_is_los
        : (raw.isLos as boolean);
    const snrDb =
      typeof raw.snr_db === 'number' && Number.isFinite(raw.snr_db)
        ? raw.snr_db
        : typeof raw.snrDb === 'number' && Number.isFinite(raw.snrDb)
          ? raw.snrDb
          : null;
    const linkOutage = hasOutageBool
      ? Boolean(
          typeof raw.link_outage === 'boolean'
            ? raw.link_outage
            : typeof raw.is_outage === 'boolean'
              ? raw.is_outage
              : raw.isOutage
        )
      : (snrDb !== null && snrDb < MIN_OPERATIONAL_SNR_DB);

    const classified = classifyLinkCommunicationStatus({
      terrain_is_los: terrainIsLos,
      obstacle_blocked: obstacleBlocked,
      link_outage: linkOutage,
      diffraction_loss_db:
        typeof raw.diffraction_loss_db === 'number' ? raw.diffraction_loss_db : null,
      snr_db: snrDb,
      modcod_name: typeof raw.modcod_name === 'string' ? raw.modcod_name : null,
      state_name:
        typeof raw.state_name === 'string'
          ? raw.state_name
          : typeof raw.currentState === 'string'
            ? raw.currentState
            : null,
      predicted_state: typeof raw.predicted_state === 'string' ? raw.predicted_state : null,
      time_to_occlusion_s:
        typeof raw.time_to_occlusion_s === 'number' ? raw.time_to_occlusion_s : null,
      is_coverage_complete:
        typeof raw.is_coverage_complete === 'boolean'
          ? raw.is_coverage_complete
          : typeof raw.isCoverageComplete === 'boolean'
            ? raw.isCoverageComplete
            : undefined,
    });
    return mapLinkStatusToMarkerStatus(classified.status);
  }

  return 'unknown';
}

/**
 * Detects whether the 2D radar camera/viewport changed between render frames.
 * Used to disable CSS position transitions during user pan/zoom/resize so markers
 * stay rigidly locked to the canvas terrain and link lines with zero rubber-banding.
 */
export function didRadarCameraChange(
  prev: RadarCameraSignature | null,
  next: RadarCameraSignature
): boolean {
  if (!prev) return true;
  return (
    Math.abs(prev.width - next.width) > CAMERA_EPSILON ||
    Math.abs(prev.height - next.height) > CAMERA_EPSILON ||
    Math.abs(prev.rangeM - next.rangeM) > CAMERA_EPSILON ||
    Math.abs(prev.panX - next.panX) > CAMERA_EPSILON ||
    Math.abs(prev.panY - next.panY) > CAMERA_EPSILON
  );
}

/**
 * Computes screen-space movement distance and heading between successive frames.
 */
export function computeMarkerMotionDelta(
  prev: { readonly x: number; readonly y: number } | undefined,
  next: { readonly x: number; readonly y: number }
): RadarMarkerMotionDelta {
  if (!prev) {
    return { distancePx: 0, headingDeg: null, moved: false };
  }
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const distancePx = Math.hypot(dx, dy);
  if (distancePx < MOTION_THRESHOLD_PX) {
    return { distancePx, headingDeg: null, moved: false };
  }
  const headingDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { distancePx, headingDeg, moved: true };
}

/**
 * Formats a concise tactical tag for a ground node marker.
 */
export function formatRadarNodeTag(nodeId: number, callsign?: string | null): string {
  const trimmed = typeof callsign === 'string' ? callsign.trim() : '';
  if (trimmed.length > 0 && trimmed.length <= 12) {
    return trimmed;
  }
  return `S${nodeId}`;
}

// ============================================================================
// DOM & Web Animations API Controller
// ============================================================================

export interface RadarNodeMarkerLayerOptions {
  readonly container: HTMLElement;
  readonly documentRef?: Document;
  readonly prefersReducedMotion?: () => boolean;
}

export interface RadarNodeMarkerLayer {
  sync(
    markers: readonly RadarMarkerProjection[],
    camera: RadarCameraSignature,
    visible: boolean
  ): void;
  hide(): void;
  clear(): void;
  getMarkerCount(): number;
}

interface ActiveMarkerRecord {
  readonly root: HTMLElement;
  readonly pulse: HTMLElement;
  readonly reticle: HTMLElement;
  readonly dot: HTMLElement;
  readonly tag: HTMLElement;
  x: number;
  y: number;
  status: RadarMarkerVisualStatus;
  selected: boolean;
  label: string;
  pulseAnim: Animation | null;
  dotAnim: Animation | null;
  reticleAnim: Animation | null;
}

function defaultPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function safeAnimate(
  el: HTMLElement,
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  options: KeyframeAnimationOptions,
  reducedMotion: boolean,
  prior: Animation | null
): Animation | null {
  if (prior && typeof prior.cancel === 'function') {
    try {
      prior.cancel();
    } catch {
      // Ignore already-finished animation cancellation errors
    }
  }
  if (reducedMotion || typeof el.animate !== 'function') {
    return null;
  }
  try {
    return el.animate(keyframes, options);
  } catch {
    return null;
  }
}

export function createRadarNodeMarkerLayer(
  options: RadarNodeMarkerLayerOptions
): RadarNodeMarkerLayer {
  const { container } = options;
  const doc = options.documentRef ?? container.ownerDocument ?? document;
  const isReducedMotion = options.prefersReducedMotion ?? defaultPrefersReducedMotion;

  const records = new Map<number, ActiveMarkerRecord>();
  let prevCamera: RadarCameraSignature | null = null;
  let isHidden = false;

  const cancelRecordAnimations = (record: ActiveMarkerRecord): void => {
    if (record.pulseAnim && typeof record.pulseAnim.cancel === 'function') {
      try { record.pulseAnim.cancel(); } catch { /* noop */ }
      record.pulseAnim = null;
    }
    if (record.dotAnim && typeof record.dotAnim.cancel === 'function') {
      try { record.dotAnim.cancel(); } catch { /* noop */ }
      record.dotAnim = null;
    }
    if (record.reticleAnim && typeof record.reticleAnim.cancel === 'function') {
      try { record.reticleAnim.cancel(); } catch { /* noop */ }
      record.reticleAnim = null;
    }
  };

  const setHiddenState = (hidden: boolean) => {
    if (isHidden === hidden) return;
    isHidden = hidden;
    container.hidden = hidden;
    container.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    if (hidden) {
      prevCamera = null;
    }
  };

  const createMarkerDom = (marker: RadarMarkerProjection, reducedMotion: boolean): ActiveMarkerRecord => {
    const root = doc.createElement('div');
    root.className = 'radar-node-marker';
    root.setAttribute('data-node-id', String(marker.nodeId));
    root.setAttribute('data-status', marker.status);
    root.setAttribute('data-selected', marker.selected ? 'true' : 'false');
    root.setAttribute('data-moving', 'false');
    root.style.transform = `translate3d(${marker.x.toFixed(2)}px, ${marker.y.toFixed(2)}px, 0)`;

    const pulse = doc.createElement('span');
    pulse.className = 'radar-node-pulse';

    const reticle = doc.createElement('span');
    reticle.className = 'radar-node-reticle';

    const dot = doc.createElement('span');
    dot.className = 'radar-node-dot';

    const tag = doc.createElement('span');
    tag.className = 'radar-node-tag';
    tag.textContent = marker.label;

    root.appendChild(pulse);
    root.appendChild(reticle);
    root.appendChild(dot);
    root.appendChild(tag);
    container.appendChild(root);

    const dotAnim = safeAnimate(
      dot,
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.35)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1.18)', offset: 0.65 },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
      ],
      { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      reducedMotion,
      null
    );

    const pulseAnim = safeAnimate(
      pulse,
      [
        { opacity: 0.72, transform: 'translate(-50%, -50%) scale(0.65)' },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(2.4)' },
      ],
      { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      reducedMotion,
      null
    );

    const reticleAnim = marker.selected
      ? safeAnimate(
          reticle,
          [
            { opacity: 0.2, transform: 'translate(-50%, -50%) scale(1.45)' },
            { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
          ],
          { duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
          reducedMotion,
          null
        )
      : null;

    return {
      root,
      pulse,
      reticle,
      dot,
      tag,
      x: marker.x,
      y: marker.y,
      status: marker.status,
      selected: marker.selected,
      label: marker.label,
      pulseAnim,
      dotAnim,
      reticleAnim,
    };
  };

  const sync = (
    markers: readonly RadarMarkerProjection[],
    camera: RadarCameraSignature,
    visible: boolean
  ): void => {
    if (!visible) {
      setHiddenState(true);
      return;
    }

    setHiddenState(false);

    const reducedMotion = isReducedMotion();
    const cameraChanged = didRadarCameraChange(prevCamera, camera);
    prevCamera = {
      width: camera.width,
      height: camera.height,
      rangeM: camera.rangeM,
      panX: camera.panX,
      panY: camera.panY,
    };

    // Disable position CSS transition on camera pan/zoom/resize frames so markers
    // stay rigidly locked to the canvas terrain & links without rubber-banding.
    container.setAttribute('data-camera-moving', cameraChanged || reducedMotion ? 'true' : 'false');

    const activeIds = new Set<number>();

    for (const marker of markers) {
      if (!Number.isFinite(marker.x) || !Number.isFinite(marker.y)) continue;
      activeIds.add(marker.nodeId);

      const existing = records.get(marker.nodeId);
      if (!existing) {
        records.set(marker.nodeId, createMarkerDom(marker, reducedMotion));
        continue;
      }

      const delta = computeMarkerMotionDelta(
        { x: existing.x, y: existing.y },
        { x: marker.x, y: marker.y }
      );
      const positionMoved = delta.moved && !cameraChanged;

      if (Math.abs(existing.x - marker.x) > 0.05 || Math.abs(existing.y - marker.y) > 0.05) {
        existing.root.style.transform = `translate3d(${marker.x.toFixed(2)}px, ${marker.y.toFixed(2)}px, 0)`;
        existing.x = marker.x;
        existing.y = marker.y;
      }

      existing.root.setAttribute('data-moving', positionMoved ? 'true' : 'false');

      if (existing.status !== marker.status) {
        existing.status = marker.status;
        existing.root.setAttribute('data-status', marker.status);

        // Trigger WAAPI status-change radar ping + dot emphasis pop
        existing.pulseAnim = safeAnimate(
          existing.pulse,
          [
            { opacity: 0.88, transform: 'translate(-50%, -50%) scale(0.7)' },
            { opacity: 0.42, transform: 'translate(-50%, -50%) scale(1.85)', offset: 0.5 },
            { opacity: 0, transform: 'translate(-50%, -50%) scale(2.9)' },
          ],
          { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
          reducedMotion,
          existing.pulseAnim
        );

        existing.dotAnim = safeAnimate(
          existing.dot,
          [
            { transform: 'translate(-50%, -50%) scale(1)' },
            { transform: 'translate(-50%, -50%) scale(1.34)', offset: 0.42 },
            { transform: 'translate(-50%, -50%) scale(1)' },
          ],
          { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          reducedMotion,
          existing.dotAnim
        );
      }

      if (existing.selected !== marker.selected) {
        existing.selected = marker.selected;
        existing.root.setAttribute('data-selected', marker.selected ? 'true' : 'false');
        if (marker.selected) {
          existing.reticleAnim = safeAnimate(
            existing.reticle,
            [
              { opacity: 0.25, transform: 'translate(-50%, -50%) scale(1.48)' },
              { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
            ],
            { duration: 210, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
            reducedMotion,
            existing.reticleAnim
          );
        }
      }

      if (existing.label !== marker.label) {
        existing.label = marker.label;
        existing.tag.textContent = marker.label;
      }
    }

    // Remove markers for despawned nodes cleanly
    for (const [nodeId, record] of records.entries()) {
      if (!activeIds.has(nodeId)) {
        cancelRecordAnimations(record);
        record.root.remove();
        records.delete(nodeId);
      }
    }
  };

  const hide = (): void => {
    setHiddenState(true);
  };

  const clear = (): void => {
    for (const record of records.values()) {
      cancelRecordAnimations(record);
      record.root.remove();
    }
    records.clear();
    prevCamera = null;
  };

  return {
    sync,
    hide,
    clear,
    getMarkerCount: () => records.size,
  };
}
