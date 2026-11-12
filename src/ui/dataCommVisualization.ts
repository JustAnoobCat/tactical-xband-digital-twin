/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * TDMA-Slot-Synchronized Communication Visualization Module (Feature 1)
 *
 * Implements 50x time-expanded playback with immutable captured superframe snapshots:
 * 1. Deep-frozen immutable superframe snapshots capturing authoritative worker allocations,
 *    subframe timing, and ground node telemetry without mutating live state.
 * 2. Strict dual-buffer snapshot lifecycle:
 *    - Active snapshot plays for its full cycle (1,000 ms at 1x speed).
 *    - Live frames update at most one pending snapshot without overwriting active playback mid-cycle.
 *    - Pending snapshot promoted only at cycle rollover.
 * 3. Historical scrubbing integration:
 *    - Uses the selected historical record's own simulation timestamp and allocations.
 *    - Normalizes camelCase (historical) and snake_case (live) allocation structures.
 *    - Immediate latching when inspected record changes; preserves playback position on identical record.
 * 4. Coordinate independence:
 *    - Snapshot stores purely simulation identity; screen coordinates are resolved dynamically from
 *      the current canvas projection during render, ensuring pan, zoom, and resize work seamlessly.
 * 5. Simulation speed and pause/resume safety:
 *    - Cycle duration scales inversely with speed (1x = 1000ms, 2x = 500ms, 0.5x = 2000ms).
 *    - Preserves exact 50x simulation-time expansion.
 *    - Pause freezes playback; resume does not introduce a wall-clock jump.
 */

import { ActiveTransferTelemetry } from '../core/transferMetrics';
import type { ITdmaFrameConfig } from '../core/tdmaConfig';
import type { Point2D } from '../shared/types';
import { HIGHLAND_THEME } from './workbench/chartTheme';

export type { Point2D };

export interface ParticleState {
  readonly x: number;
  readonly y: number;
  readonly progress: number;
  readonly isDropped: boolean;
}

/**
 * Normalized slot allocation representation inside an immutable snapshot.
 * Compatible with both live worker telemetry (snake_case) and historical records (camelCase).
 */
export interface SnapshotSlotAllocation {
  readonly nodeId: number;
  readonly startMs: number;
  readonly durationMs: number;
  readonly capacityBits: number;
  readonly modcodName?: string;
  readonly spectralEfficiency?: number;
  readonly isPreOcclusionFlush: boolean;
}

/**
 * Normalized ground terminal state required for communication visualization.
 * Excludes display coordinates to keep snapshots coordinate-invariant under pan/zoom/resize.
 */
export interface SnapshotNodeState {
  readonly nodeId: number;
  readonly isOperational: boolean;
  readonly isBlocked: boolean;
  readonly isObstacleBlocked: boolean;
  readonly isOutage: boolean;
  readonly isDegraded: boolean;
  readonly linkStatus: string;
  readonly isSelected: boolean;
  readonly isTransmitting: boolean;
  readonly isWastingAirtime: boolean;
  readonly queueBacklogBytes: number;
  readonly transfer: ActiveTransferTelemetry | null;
}

/**
 * Immutable snapshot of one complete 20 ms TDMA superframe.
 * Contains only data required to render the 1,000 ms visual playback cycle.
 */
export interface SuperframeVisualSnapshot {
  readonly snapshotId: string;
  readonly source: 'live' | 'historical';
  readonly sessionId: number;
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly schedulerMode: string;
  readonly stepRequestId?: number;

  // Authoritative subframe boundaries (ms within 20 ms superframe)
  readonly superframeDurationMs: number;
  readonly ctrlDurationMs: number;
  readonly dlDurationMs: number;

  // Deep-copied authoritative allocations and endpoint states
  readonly allocations: readonly SnapshotSlotAllocation[];
  readonly staticAllocations?: readonly SnapshotSlotAllocation[];
  readonly tacAllocations?: readonly SnapshotSlotAllocation[];
  readonly nodes: readonly SnapshotNodeState[];
  readonly isBroadcastingDownlink: boolean;
}

export type TimelinePhase =
  | 'CONTROL_BROADCAST'   // [0 ms, ctrl_ms) - ACN broadcasts network sync / TA
  | 'DOWNLINK_BROADCAST'  // [ctrl_ms, ctrl_ms + dl_ms) - ACN downlink broadcast
  | 'UPLINK_SLOT'         // [start_ms, start_ms + dur_ms) - Scheduled ground node uplink
  | 'GUARD'               // Physical inter-slot guard band / radio turnaround interval
  | 'IDLE_RECLAIMED'      // Tac-TAD dynamic unallocated airtime (reclaimed / sleep)
  | 'CONFLICT'            // Scheduler integrity violation (overlapping allocations)
  | 'IDLE_GUARD';         // Neutral unclassified idle airtime / backward-compatibility

export type PlaybackMode = 'continuous' | 'stepped' | 'historical';
export type SteppedLifecycleState = 'idle' | 'waiting_for_telemetry' | 'playing' | 'complete';

export type TdmaSubframePhase = TimelinePhase;

export type CommDirection = 'UL' | 'DL' | 'NONE';

export interface ConflictInterval {
  readonly startMs: number;
  readonly endMs: number;
  readonly nodeA: number;
  readonly nodeB: number;
  readonly diagnostic: string;
}

export interface ResolvedTimelineSegment {
  readonly phase: TimelinePhase;
  readonly scheduledNodeId: number | null;
  readonly startMs: number;
  readonly durationMs: number;
  readonly endMs: number;
  readonly capacityBits: number;
  readonly isPreOcclusionFlush: boolean;
  readonly modcodName?: string;
  readonly spectralEfficiency?: number;
  readonly direction: CommDirection;
  readonly isWastedAirtime?: boolean;
}

export interface ActiveSlotState {
  readonly phase: TdmaSubframePhase;
  readonly scheduledNodeId: number | null;
  readonly slotStartMs: number;
  readonly slotDurationMs: number;
  readonly slotEndMs?: number;
  readonly slotProgress: number; // 0.0 to 1.0 within this active slot
  readonly capacityBits: number;
  readonly isPreOcclusionFlush: boolean;
  readonly modcodName?: string;
  readonly spectralEfficiency?: number;
  readonly direction?: CommDirection;
  readonly isWastedAirtime?: boolean;
  readonly overlapDiagnostic?: string;
}

export interface ResolveTimelineParams {
  readonly allocations: readonly any[] | undefined | null;
  readonly ctrlDurationMs?: number;
  readonly dlDurationMs?: number;
  readonly superframeDurationMs?: number;
  readonly nodes?: readonly SnapshotNodeState[] | readonly any[];
  readonly schedulerMode?: string;
}

export interface ResolvedSuperframeTimeline {
  readonly superframeDurationMs: number;
  readonly ctrlDurationMs: number;
  readonly dlDurationMs: number;
  readonly ulAvailableDurationMs: number;
  readonly allocations: readonly SnapshotSlotAllocation[];
  readonly segments: readonly ResolvedTimelineSegment[];
  readonly hasOverlap: boolean;
  readonly overlapWarning?: string;
  readonly overlapWarnings: readonly string[];
  readonly conflictIntervals: readonly ConflictInterval[];
  resolveAt(subframeOffsetMs: number): ActiveSlotState;
}

export interface DownlinkTelemetryInfo {
  readonly is_control_broadcast?: boolean;
  readonly ctrl_duration_ms?: number;
  readonly dl_duration_ms?: number;
  readonly broadcast_active?: boolean;
}

/**
 * Options passed to DataCommVisualizer.render() for snapshot-anchored rendering.
 */
export interface DataCommRenderOptions {
  readonly snapshot: SuperframeVisualSnapshot;
  readonly acnScreenPos: Point2D;
  readonly nodeScreenPositions: ReadonlyMap<number, Point2D> | Record<number, Point2D>;
  readonly speed?: number;
  readonly isPaused?: boolean;
  readonly isVisualPaused?: boolean;
  readonly visualTimeMs?: number; // Optional explicit visual time for unit testing
  readonly showVisualOverlay?: boolean;
  readonly opacityMultiplier?: number;
}

// Backward-compatibility interfaces for existing callers & tests
export interface ActiveGanttAllocation {
  readonly node_id?: number;
  readonly nodeId?: number;
  readonly start_ms?: number;
  readonly startMs?: number;
  readonly duration_ms?: number;
  readonly durationMs?: number;
  readonly capacity_bits?: number;
  readonly capacityBits?: number;
  readonly modcod_name?: string;
  readonly modcodName?: string;
  readonly spectral_efficiency?: number;
  readonly spectralEfficiency?: number;
  readonly is_pre_occlusion_flush?: boolean;
  readonly isPreOcclusionFlush?: boolean;
}

export interface DataCommNodePoint {
  readonly nodeId: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly isOperational: boolean;
  readonly isBlocked: boolean;
  readonly isObstacleBlocked: boolean;
  readonly isOutage: boolean;
  readonly isDegraded: boolean;
  readonly linkStatus: string;
  readonly isSelected: boolean;
  readonly isTransmitting: boolean;
  readonly isWastingAirtime: boolean;
  readonly queueBacklogBytes?: number;
  readonly transfer?: ActiveTransferTelemetry | null;
}

export interface DataCommAcnPoint {
  readonly screenX: number;
  readonly screenY: number;
  readonly isBroadcastingDownlink?: boolean;
}

export interface DataCommFrameInput {
  readonly simTimeS: number;
  readonly visualTimeS?: number;
  readonly isPaused: boolean;
  readonly acn: DataCommAcnPoint;
  readonly nodes: readonly DataCommNodePoint[];
  readonly schedulerMode: string;
  readonly activeAllocations?: readonly ActiveGanttAllocation[];
  readonly downlinkTelemetry?: DownlinkTelemetryInfo | null;
  readonly dlBroadcastActive?: boolean;
  readonly superframeDurationMs?: number;
  readonly tdmaFrameConfig?: ITdmaFrameConfig | Partial<ITdmaFrameConfig> | null;
}

/**
 * Deep-freezes a snapshot object and all its nested properties.
 */
export function deepFreezeSnapshot(snapshot: SuperframeVisualSnapshot): SuperframeVisualSnapshot {
  if (Object.isFrozen(snapshot)) return snapshot;

  if (Array.isArray(snapshot.allocations)) {
    snapshot.allocations.forEach((a) => Object.freeze(a));
    Object.freeze(snapshot.allocations);
  }

  if (Array.isArray(snapshot.nodes)) {
    snapshot.nodes.forEach((n) => {
      if (n.transfer && typeof n.transfer === 'object') {
        Object.freeze(n.transfer);
      }
      Object.freeze(n);
    });
    Object.freeze(snapshot.nodes);
  }

  return Object.freeze(snapshot);
}

/**
 * Clones transfer telemetry object deeply to prevent retaining worker references.
 */
export function cloneTransferTelemetry(
  t: ActiveTransferTelemetry | null | undefined
): ActiveTransferTelemetry | null {
  if (!t || typeof t !== 'object') return null;
  return {
    node_id: t.node_id,
    status: t.status,
    status_message: t.status_message,
    active_type: t.active_type,
    total_bytes: t.total_bytes,
    delivered_bytes: t.delivered_bytes,
    dropped_bytes: t.dropped_bytes,
    dropped_packets: t.dropped_packets,
    progress_pct: t.progress_pct,
    start_time_s: t.start_time_s,
    ack_time_s: t.ack_time_s,
    current_rate_bps: t.current_rate_bps,
    current_rate_mbps: t.current_rate_mbps,
    eta_s: t.eta_s,
    eta_status: t.eta_status,
  };
}

/**
 * Normalizes allocation objects from any source (live worker snake_case or historical camelCase).
 */
export function normalizeSnapshotAllocations(
  rawAllocs: readonly any[] | undefined | null
): SnapshotSlotAllocation[] {
  if (!rawAllocs || !Array.isArray(rawAllocs)) return [];
  return rawAllocs.map((a) => ({
    nodeId: typeof a.nodeId === 'number' ? a.nodeId : (typeof a.node_id === 'number' ? a.node_id : 0),
    startMs: typeof a.startMs === 'number' ? a.startMs : (typeof a.start_ms === 'number' ? a.start_ms : 0),
    durationMs: typeof a.durationMs === 'number' ? a.durationMs : (typeof a.duration_ms === 'number' ? a.duration_ms : 0),
    capacityBits: typeof a.capacityBits === 'number' ? a.capacityBits : (typeof a.capacity_bits === 'number' ? a.capacity_bits : 0),
    modcodName: a.modcodName ?? a.modcod_name,
    spectralEfficiency: a.spectralEfficiency ?? a.spectral_efficiency,
    isPreOcclusionFlush: Boolean(a.isPreOcclusionFlush ?? a.is_pre_occlusion_flush),
  }));
}

/**
 * Creates an immutable, deep-frozen superframe snapshot from live or historical data.
 */
export function createSuperframeSnapshot(params: {
  source: 'live' | 'historical';
  sessionId?: number;
  frameIndex: number;
  simulationTimeS: number;
  schedulerMode: string;
  stepRequestId?: number;
  superframeDurationMs?: number;
  ctrlDurationMs?: number;
  dlDurationMs?: number;
  allocations: readonly any[];
  staticAllocations?: readonly any[];
  tacAllocations?: readonly any[];
  nodes: readonly any[];
  isBroadcastingDownlink?: boolean;
  tdmaFrameConfig?: ITdmaFrameConfig | Partial<ITdmaFrameConfig>;
}): SuperframeVisualSnapshot {
  const sessionId = params.sessionId ?? 0;
  const frameIndex = Math.max(0, params.frameIndex);
  const simTimeS = Math.max(0, params.simulationTimeS);
  const snapshotId = `${params.source}:${sessionId}:${frameIndex}:${simTimeS.toFixed(3)}`;

  const normAllocs = normalizeSnapshotAllocations(params.allocations);
  const normStaticAllocs = params.staticAllocations ? normalizeSnapshotAllocations(params.staticAllocations) : undefined;
  const normTacAllocs = params.tacAllocations ? normalizeSnapshotAllocations(params.tacAllocations) : undefined;

  const normNodes: SnapshotNodeState[] = (params.nodes || []).map((n) => ({
    nodeId: typeof n.nodeId === 'number' ? n.nodeId : (typeof n.node_id === 'number' ? n.node_id : 0),
    isOperational: Boolean(n.isOperational ?? (!n.linkOutage && !n.obstacleBlocked && !n.isOutage && !n.isBlocked)),
    isBlocked: Boolean(n.isBlocked ?? n.obstacleBlocked),
    isObstacleBlocked: Boolean(n.isObstacleBlocked ?? n.obstacleBlocked),
    isOutage: Boolean(n.isOutage ?? n.linkOutage),
    isDegraded: Boolean(n.isDegraded ?? (n.linkStatus === 'DEGRADED')),
    linkStatus: n.linkStatus ?? (n.obstacleBlocked ? 'BLOCKED_OBSTACLE' : (n.linkOutage ? 'OUTAGE_DISCONNECTED' : 'CONNECTED')),
    isSelected: Boolean(n.isSelected),
    isTransmitting: Boolean(n.isTransmitting),
    isWastingAirtime: Boolean(n.isWastingAirtime),
    queueBacklogBytes: n.queueBacklogBytes ?? n.total_backlog_bytes ?? n.totalBacklogBytes ?? 0,
    transfer: cloneTransferTelemetry(n.transfer),
  }));

  const superframeDurationMs = params.superframeDurationMs ?? params.tdmaFrameConfig?.frameDurationMs ?? 20.0;
  const ctrlDurationMs = params.ctrlDurationMs ?? params.tdmaFrameConfig?.ctrlDurationMs ?? 1.0;
  const dlDurationMs = params.dlDurationMs ?? params.tdmaFrameConfig?.dlMinDurationMs ?? 3.0;

  const snapshot: SuperframeVisualSnapshot = {
    snapshotId,
    source: params.source,
    sessionId,
    frameIndex,
    simulationTimeS: simTimeS,
    schedulerMode: params.schedulerMode || 'tac_tad',
    superframeDurationMs,
    ctrlDurationMs,
    dlDurationMs,
    allocations: normAllocs,
    ...(normStaticAllocs ? { staticAllocations: normStaticAllocs } : {}),
    ...(normTacAllocs ? { tacAllocations: normTacAllocs } : {}),
    nodes: normNodes,
    isBroadcastingDownlink: params.isBroadcastingDownlink ?? true,
    ...(typeof params.stepRequestId === 'number' ? { stepRequestId: params.stepRequestId } : {}),
  };

  return deepFreezeSnapshot(snapshot);
}

/**
 * Creates a SuperframeVisualSnapshot from a TelemetryFrame or historical telemetry record.
 */
export function createSuperframeSnapshotFromTelemetry(
  frame: any,
  options?: {
    sessionId?: number;
    source?: 'live' | 'historical';
    nodes?: readonly any[];
  }
): SuperframeVisualSnapshot {
  const superframeDurationMs = frame.tdma_frame_config?.frameDurationMs ?? 20.0;
  const ctrlDurationMs = frame.downlink_telemetry?.ctrl_duration_ms ?? frame.tdma_frame_config?.ctrlDurationMs ?? 1.0;
  const dlDurationMs = frame.downlink_telemetry?.dl_duration_ms ?? frame.tdma_frame_config?.dlMinDurationMs ?? 3.0;

  return createSuperframeSnapshot({
    source: options?.source ?? 'live',
    sessionId: options?.sessionId,
    frameIndex: frame.frame_index ?? Math.round((frame.sim_time_s || 0) / (superframeDurationMs / 1000.0)),
    simulationTimeS: frame.sim_time_s ?? 0,
    schedulerMode: frame.scheduler_mode ?? 'tac_tad',
    stepRequestId: frame.step_request_id,
    superframeDurationMs,
    ctrlDurationMs,
    dlDurationMs,
    allocations: frame.active_gantt_allocations ?? [],
    staticAllocations: frame.static_gantt_allocations,
    tacAllocations: frame.tac_gantt_allocations,
    nodes: options?.nodes ?? frame.nodes_telemetry ?? [],
    isBroadcastingDownlink: Boolean(frame.downlink_telemetry?.broadcast_active ?? true),
  });
}

/**
 * Pure mathematical helper: linear interpolation between two screen points.
 */
export function interpolateLinkPosition(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  progress: number
): Point2D {
  const t = Math.max(0, Math.min(1, progress));
  return {
    x: fromX + t * (toX - fromX),
    y: fromY + t * (toY - fromY),
  };
}

/**
 * Pure mathematical helper: computes directional particle positions along a link vector.
 */
export function computeParticlePositions(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  simTimeS: number,
  speed: number = 1.2,
  count: number = 4,
  maxProgress: number = 1.0
): ParticleState[] {
  const particles: ParticleState[] = [];
  const safeCount = Math.max(1, count);
  const basePhase = ((simTimeS * speed) % 1.0 + 1.0) % 1.0;

  for (let i = 0; i < safeCount; i++) {
    const rawP = (basePhase + i / safeCount) % 1.0;
    const isDropped = rawP > maxProgress;
    const effectiveP = Math.min(rawP, maxProgress);
    const pos = interpolateLinkPosition(fromX, fromY, toX, toY, effectiveP);
    particles.push({
      x: pos.x,
      y: pos.y,
      progress: effectiveP,
      isDropped,
    });
  }

  return particles;
}

/**
 * Pure mathematical helper: computes directional packet positions strictly based on
 * the active slot progress [0.0, 1.0).
 * Packets travel from (fromX, fromY) -> (toX, toY).
 */
export function computeSlotPacketPositions(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  slotProgress: number,
  count: number = 3,
  maxProgress: number = 1.0
): ParticleState[] {
  const particles: ParticleState[] = [];
  const safeCount = Math.max(1, count);
  const clampedProgress = Math.max(0, Math.min(1, slotProgress));

  for (let i = 0; i < safeCount; i++) {
    const rawP = (clampedProgress * 2.0 + i / safeCount) % 1.0;
    const isDropped = rawP > maxProgress;
    const effectiveP = Math.min(rawP, maxProgress);
    const pos = interpolateLinkPosition(fromX, fromY, toX, toY, effectiveP);
    particles.push({
      x: pos.x,
      y: pos.y,
      progress: effectiveP,
      isDropped,
    });
  }

  return particles;
}

/**
 * Pure helper: returns true if link status prohibits payload delivery.
 */
export function shouldSuppressPacketFlow(linkStatus: string): boolean {
  return (
    linkStatus === 'BLOCKED_TERRAIN' ||
    linkStatus === 'BLOCKED_OBSTACLE' ||
    linkStatus === 'OUTAGE_DISCONNECTED' ||
    linkStatus === 'UNKNOWN'
  );
}

/**
 * Pure helper: computes visual subframe offset in milliseconds [0.0, superframeDurationMs)
 * from visual time.
 */
export function computeVisualSubframeOffsetMs(
  visualTimeS: number,
  cycleDurationMs: number = 1000.0,
  superframeDurationMs: number = 20.0
): number {
  if (!Number.isFinite(visualTimeS) || visualTimeS < 0) return 0.0;
  const cycleMs = Math.max(10.0, cycleDurationMs);
  const timeMs = visualTimeS * 1000.0;
  const normPhase = ((timeMs % cycleMs) + cycleMs) % cycleMs / cycleMs;
  return normPhase * superframeDurationMs;
}

/**
 * Authoritative, pure timeline resolver for TDMA superframe allocations.
 * Computes contiguous timeline segments and provides deterministic half-open [start, end)
 * slot resolution for Gantt charts, Canvas visualizer, and HUD indicators.
 */
export function resolveSuperframeTimeline(
  params: ResolveTimelineParams
): ResolvedSuperframeTimeline {
  const superframeDurationMs = Math.max(1.0, params.superframeDurationMs ?? 20.0);
  const explicitCtrl = params.ctrlDurationMs !== undefined;
  const explicitDl = params.dlDurationMs !== undefined;
  let ctrlDurationMs = Math.max(0.0, params.ctrlDurationMs ?? 1.0);
  let dlDurationMs = Math.max(0.0, params.dlDurationMs ?? 3.0);

  const rawAllocs = normalizeSnapshotAllocations(params.allocations);

  // Validate allocations and filter strictly valid ones
  const EPSILON = 1e-4; // 0.1 us tolerance

  const validAllocs: SnapshotSlotAllocation[] = [];
  for (const a of rawAllocs) {
    const isFinite = Number.isFinite(a.startMs) && Number.isFinite(a.durationMs);
    if (!isFinite || a.durationMs <= 0) {
      console.warn(`[Timeline Resolver] Discarding invalid allocation for node ${a.nodeId}: start=${a.startMs}, dur=${a.durationMs}`);
      continue;
    }
    const endMs = a.startMs + a.durationMs;
    if (a.startMs < -EPSILON || a.startMs >= superframeDurationMs - EPSILON || endMs > superframeDurationMs + EPSILON) {
      console.warn(`[Timeline Resolver] Discarding out-of-frame allocation for node ${a.nodeId}: [${a.startMs}..${endMs}) ms`);
      continue;
    }
    const cleanStartMs = Math.max(0.0, a.startMs);
    const cleanEndMs = Math.min(superframeDurationMs, endMs);
    const cleanDurationMs = cleanEndMs - cleanStartMs;
    validAllocs.push({
      ...a,
      startMs: cleanStartMs,
      durationMs: cleanDurationMs,
    });
  }

  // Deterministic sorting strictly by startMs ascending, with nodeId ascending as stable tie-breaker.
  // CapacityBits is NEVER used to prioritize or choose winners for overlapping allocations!
  validAllocs.sort((a, b) => {
    if (Math.abs(a.startMs - b.startMs) > 1e-6) {
      return a.startMs - b.startMs;
    }
    return a.nodeId - b.nodeId;
  });

  // If CTRL/DL durations were not explicitly passed and the first allocation starts
  // earlier than 4.0 ms, adjust default broadcast periods to avoid artificial overlaps
  if (!explicitCtrl && !explicitDl && validAllocs.length > 0 && validAllocs[0].startMs < 4.0) {
    if (validAllocs[0].startMs <= 0.0) {
      ctrlDurationMs = 0.0;
      dlDurationMs = 0.0;
    } else if (validAllocs[0].startMs < 1.0) {
      ctrlDurationMs = validAllocs[0].startMs;
      dlDurationMs = 0.0;
    } else {
      ctrlDurationMs = 1.0;
      dlDurationMs = Math.max(0.0, validAllocs[0].startMs - 1.0);
    }
  }

  const ulStartMs = Math.min(superframeDurationMs, ctrlDurationMs + dlDurationMs);
  const ulAvailableDurationMs = Math.max(0.0, superframeDurationMs - ulStartMs);

  // Fix 3: Detect EVERY overlapping pair and record explicit conflict intervals
  const conflictIntervals: ConflictInterval[] = [];
  const overlapWarnings: string[] = [];
  for (let i = 0; i < validAllocs.length; i++) {
    const a = validAllocs[i];
    const aEnd = a.startMs + a.durationMs;
    for (let j = i + 1; j < validAllocs.length; j++) {
      const b = validAllocs[j];
      if (b.startMs >= aEnd - EPSILON) {
        break; // Sorted by startMs; no subsequent allocations can overlap a
      }
      const overlapStart = Math.max(a.startMs, b.startMs);
      const overlapEnd = Math.min(aEnd, b.startMs + b.durationMs);
      const diag = `[Timeline Resolver Diagnostic] Overlapping allocations detected: Node ${a.nodeId} [${a.startMs.toFixed(3)}..${aEnd.toFixed(3)}) ms overlaps with Node ${b.nodeId} [${b.startMs.toFixed(3)}..${(b.startMs + b.durationMs).toFixed(3)}) ms`;
      conflictIntervals.push({
        startMs: overlapStart,
        endMs: overlapEnd,
        nodeA: a.nodeId,
        nodeB: b.nodeId,
        diagnostic: diag,
      });
      overlapWarnings.push(diag);
      console.warn(diag);
    }
  }

  const hasOverlap = conflictIntervals.length > 0;
  const overlapWarning = overlapWarnings.length > 0 ? overlapWarnings[0] : undefined;

  // Helper to check if a node is severed/wasted
  const isNodeWasted = (nodeId: number): boolean => {
    if (params.schedulerMode !== 'static' || !params.nodes) return false;
    const n = params.nodes.find((item: any) => (item.nodeId ?? item.node_id) === nodeId);
    if (!n) return false;
    return Boolean(
      n.isBlocked ||
      n.isOutage ||
      n.linkOutage ||
      n.link_outage ||
      n.obstacleBlocked ||
      n.obstacle_blocked ||
      (n.stateName ?? n.state_name) === 'HARD_SHADOW_CUTOFF'
    );
  };

  // Fix 2: Distinguish guard intervals from reclaimed airtime
  const resolveGapPhase = (gapDur: number): TimelinePhase => {
    if (params.schedulerMode === 'static') {
      return 'GUARD';
    }
    if (params.schedulerMode === 'tac_tad') {
      return gapDur > 0.05 ? 'IDLE_RECLAIMED' : 'GUARD';
    }
    return gapDur <= 0.05 ? 'GUARD' : 'IDLE_GUARD';
  };

  // Build contiguous segments across [0, superframeDurationMs)
  const segments: ResolvedTimelineSegment[] = [];

  // Segment 1: Control Broadcast
  if (ctrlDurationMs > 0) {
    segments.push({
      phase: 'CONTROL_BROADCAST',
      scheduledNodeId: null,
      startMs: 0.0,
      durationMs: ctrlDurationMs,
      endMs: ctrlDurationMs,
      capacityBits: 0,
      isPreOcclusionFlush: false,
      direction: 'DL',
    });
  }

  // Segment 2: Downlink Broadcast
  if (dlDurationMs > 0 && ulStartMs > ctrlDurationMs) {
    segments.push({
      phase: 'DOWNLINK_BROADCAST',
      scheduledNodeId: null,
      startMs: ctrlDurationMs,
      durationMs: dlDurationMs,
      endMs: ulStartMs,
      capacityBits: 0,
      isPreOcclusionFlush: false,
      direction: 'DL',
    });
  }

  // Segment 3: Uplink Slots & Gaps
  let cursorMs = ulStartMs;
  for (let i = 0; i < validAllocs.length; i++) {
    const alloc = validAllocs[i];
    const allocEnd = alloc.startMs + alloc.durationMs;

    // Gap before allocation (guard band or idle airtime)
    if (alloc.startMs > cursorMs + EPSILON) {
      const gapDur = alloc.startMs - cursorMs;
      segments.push({
        phase: resolveGapPhase(gapDur),
        scheduledNodeId: null,
        startMs: cursorMs,
        durationMs: gapDur,
        endMs: alloc.startMs,
        capacityBits: 0,
        isPreOcclusionFlush: false,
        direction: 'NONE',
      });
    }

    segments.push({
      phase: 'UPLINK_SLOT',
      scheduledNodeId: alloc.nodeId,
      startMs: alloc.startMs,
      durationMs: alloc.durationMs,
      endMs: allocEnd,
      capacityBits: alloc.capacityBits,
      isPreOcclusionFlush: alloc.isPreOcclusionFlush,
      modcodName: alloc.modcodName,
      spectralEfficiency: alloc.spectralEfficiency,
      direction: 'UL',
      isWastedAirtime: isNodeWasted(alloc.nodeId),
    });

    cursorMs = Math.max(cursorMs, allocEnd);
  }

  // Remaining airtime after last allocation
  if (cursorMs < superframeDurationMs - EPSILON) {
    const remainingDur = superframeDurationMs - cursorMs;
    segments.push({
      phase: resolveGapPhase(remainingDur),
      scheduledNodeId: null,
      startMs: cursorMs,
      durationMs: remainingDur,
      endMs: superframeDurationMs,
      capacityBits: 0,
      isPreOcclusionFlush: false,
      direction: 'NONE',
    });
  }

  // Pure resolution function using half-open interval [startMs, endMs)
  const resolveAt = (subframeOffsetMs: number): ActiveSlotState => {
    if (!Number.isFinite(subframeOffsetMs)) {
      return {
        phase: resolveGapPhase(0),
        scheduledNodeId: null,
        slotStartMs: 0.0,
        slotDurationMs: 0.0,
        slotEndMs: 0.0,
        slotProgress: 0.0,
        capacityBits: 0,
        isPreOcclusionFlush: false,
        direction: 'NONE',
        overlapDiagnostic: overlapWarning,
      };
    }

    const t = Math.max(0.0, Math.min(superframeDurationMs, subframeOffsetMs));

    // Fix 3: Conflict intervals intercept resolution — overlapping allocations CANNOT be presented as valid transmissions!
    for (const conflict of conflictIntervals) {
      if (t >= conflict.startMs && t < conflict.endMs) {
        return {
          phase: 'CONFLICT',
          scheduledNodeId: null,
          slotStartMs: conflict.startMs,
          slotDurationMs: conflict.endMs - conflict.startMs,
          slotEndMs: conflict.endMs,
          slotProgress: 0.0,
          capacityBits: 0,
          isPreOcclusionFlush: false,
          direction: 'NONE',
          overlapDiagnostic: conflict.diagnostic,
        };
      }
    }

    // Search matching segment in half-open [startMs, endMs)
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      // Half-open interval: [seg.startMs, seg.endMs)
      // A segment matches if t is strictly in [seg.startMs, seg.endMs).
      const isMatch = (t >= seg.startMs && t < seg.endMs);

      if (isMatch) {
        const elapsed = Math.max(0.0, t - seg.startMs);
        const progress = seg.durationMs > 0 ? Math.min(1.0, elapsed / seg.durationMs) : 0.0;
        return {
          phase: seg.phase,
          scheduledNodeId: seg.scheduledNodeId,
          slotStartMs: seg.startMs,
          slotDurationMs: seg.durationMs,
          slotEndMs: seg.endMs,
          slotProgress: progress,
          capacityBits: seg.capacityBits,
          isPreOcclusionFlush: seg.isPreOcclusionFlush,
          modcodName: seg.modcodName,
          spectralEfficiency: seg.spectralEfficiency,
          direction: seg.direction,
          isWastedAirtime: seg.isWastedAirtime,
          overlapDiagnostic: overlapWarning,
        };
      }
    }

    // Terminal fallback for t >= superframeDurationMs (e.g. exactly 20.0 ms holding state).
    // Superframe [0, superframeDurationMs) has concluded: no active segment matches at t >= superframeDurationMs.
    // If the superframe ended with idle/reclaimed time, preserve that idle phase name.
    const lastSeg = segments.length > 0 ? segments[segments.length - 1] : null;
    const terminalPhase = (lastSeg && lastSeg.scheduledNodeId === null && Math.abs(lastSeg.endMs - superframeDurationMs) < 1e-4)
      ? lastSeg.phase
      : resolveGapPhase(0);

    return {
      phase: terminalPhase,
      scheduledNodeId: null,
      slotStartMs: superframeDurationMs,
      slotDurationMs: 0.0,
      slotEndMs: superframeDurationMs,
      slotProgress: 1.0,
      capacityBits: 0,
      isPreOcclusionFlush: false,
      direction: 'NONE',
      overlapDiagnostic: overlapWarning,
    };
  };

  return {
    superframeDurationMs,
    ctrlDurationMs,
    dlDurationMs,
    ulAvailableDurationMs,
    allocations: validAllocs,
    segments,
    hasOverlap,
    overlapWarning,
    overlapWarnings,
    conflictIntervals,
    resolveAt,
  };
}

/**
 * Pure helper: resolves which TDMA phase and slot is active at a given subframe offset.
 * Supports both SnapshotSlotAllocation and ActiveGanttAllocation shapes.
 * Powered by authoritative resolveSuperframeTimeline.
 */
export function resolveActiveTdmaSlotState(
  subframeOffsetMs: number,
  allocations: readonly any[],
  ctrlDurationMs: number = 1.0,
  dlDurationMs: number = 3.0,
  superframeDurationMs: number = 20.0,
  schedulerMode?: string,
  nodes?: readonly any[]
): ActiveSlotState {
  const timeline = resolveSuperframeTimeline({
    allocations,
    ctrlDurationMs,
    dlDurationMs,
    superframeDurationMs,
    schedulerMode,
    nodes,
  });
  return timeline.resolveAt(subframeOffsetMs);
}

/**
 * Pure helper: determines TX/RX endpoint roles for a node and ACN.
 */
export function determineEndpointRoles(
  isUplink: boolean,
  isTransmitting: boolean,
  isDownlinkActive: boolean
): {
  nodeRole: 'TX' | 'RX' | null;
  acnRole: 'TX' | 'RX' | null;
} {
  if (isUplink && isTransmitting) {
    return { nodeRole: 'TX', acnRole: 'RX' };
  }
  if (!isUplink && isDownlinkActive) {
    return { nodeRole: 'RX', acnRole: 'TX' };
  }
  return { nodeRole: null, acnRole: null };
}

/**
 * Pure helper: determines TX/RX endpoint roles for a specific slot state.
 */
export function determineSlotEndpointRoles(
  activeSlot: ActiveSlotState,
  targetNodeId: number
): {
  nodeRole: 'TX' | 'RX' | null;
  acnRole: 'TX' | 'RX' | null;
} {
  if (activeSlot.phase === 'CONTROL_BROADCAST' || activeSlot.phase === 'DOWNLINK_BROADCAST') {
    return { nodeRole: 'RX', acnRole: 'TX' };
  }
  if (activeSlot.phase === 'UPLINK_SLOT' && activeSlot.scheduledNodeId === targetNodeId) {
    return { nodeRole: 'TX', acnRole: 'RX' };
  }
  return { nodeRole: null, acnRole: null };
}

/**
 * Authoritative 2D Canvas Renderer for TDMA-Slot-Synchronized Data Communication.
 * Implements 50x time-expanded playback with immutable superframe snapshots.
 */
export class DataCommVisualizer {
  public static readonly TAU = Math.PI * 2;
  public static readonly BASE_VISUAL_CYCLE_MS = 1000.0; // 1,000 ms at 1x speed

  private sessionId: number = 0;
  private activeSnapshot: SuperframeVisualSnapshot | null = null;
  private pendingSnapshot: SuperframeVisualSnapshot | null = null;
  private cycleElapsedVisualMs: number = 0.0;
  private lastWallPerfMs: number = 0.0;
  private lastSimTimeS: number = -1.0;
  private lastEffectiveSpeed: number = 1.0;

  // Stage 4 Playback Lifecycle State
  private playbackMode: PlaybackMode = 'continuous';
  private steppedLifecycle: SteppedLifecycleState = 'idle';
  private isVisualClockPaused: boolean = false;
  private steppedRequestId: number = 0;
  private activeStepRequestId: number | null = null;
  private onSteppedCycleComplete: (() => void) | null = null;

  /**
   * Clamps simulation speed into the safe operational interval [0.05, 10.0].
   */
  public clampSpeed(speed: number = 1.0): number {
    return Math.max(0.05, Math.min(10.0, Number.isFinite(speed) ? speed : 1.0));
  }

  /**
   * Returns current effective simulation speed.
   */
  public getEffectiveSpeed(): number {
    return this.lastEffectiveSpeed;
  }

  /**
   * Stage 4: Returns active playback mode ('continuous' | 'stepped' | 'historical').
   */
  public getPlaybackMode(): PlaybackMode {
    return this.playbackMode;
  }

  /**
   * Stage 4: Returns active stepped lifecycle state ('idle' | 'waiting_for_telemetry' | 'playing' | 'complete').
   */
  public getSteppedLifecycle(): SteppedLifecycleState {
    return this.steppedLifecycle;
  }

  /**
   * Stage 4: Returns current stepped request generation/ID.
   */
  public getSteppedRequestId(): number {
    return this.steppedRequestId;
  }

  /**
   * Stage 4: Returns active STEP request ID being awaited, or null if not waiting.
   */
  public getActiveStepRequestId(): number | null {
    return this.activeStepRequestId;
  }

  /**
   * Stage 4: Returns true if the visual clock is explicitly paused.
   */
  public isVisualPaused(): boolean {
    return this.isVisualClockPaused;
  }

  /**
   * Stage 4: Explicitly freezes or unfreezes visual playback clock.
   */
  public setVisualPaused(paused: boolean): void {
    this.isVisualClockPaused = paused;
  }

  /**
   * Stage 4: Sets callback invoked when a stepped cycle finishes playing and transitions to 'complete'.
   */
  public setOnSteppedCycleComplete(cb: (() => void) | null): void {
    this.onSteppedCycleComplete = cb;
  }

  /**
   * Stage 4: Returns whether a new STEP request can be initiated.
   * Returns false while awaiting telemetry or while stepped playback is active.
   */
  public canStep(): boolean {
    if (this.playbackMode === 'historical') {
      return false;
    }
    if (this.playbackMode === 'stepped') {
      return this.steppedLifecycle === 'complete' || this.steppedLifecycle === 'idle';
    }
    return true;
  }

  /**
   * Stage 4: Initiates a stepped visual lifecycle request.
   * Returns the new steppedRequestId, or null if rejected due to active playback/request.
   */
  public requestStep(): number | null {
    if (!this.canStep()) {
      return null;
    }
    this.playbackMode = 'stepped';
    this.steppedLifecycle = 'waiting_for_telemetry';
    this.steppedRequestId += 1;
    this.activeStepRequestId = this.steppedRequestId;
    this.isVisualClockPaused = false;
    return this.steppedRequestId;
  }

  /**
   * Stage 4: Explicitly latches a stepped snapshot received in response to requestStep().
   * Transitions lifecycle state from 'waiting_for_telemetry' to 'playing'.
   */
  public latchSteppedSnapshot(snapshot: SuperframeVisualSnapshot, requestId?: number): boolean {
    if (this.playbackMode !== 'stepped' || this.steppedLifecycle !== 'waiting_for_telemetry') {
      return false;
    }
    const incomingReqId = typeof requestId === 'number' ? requestId : snapshot.stepRequestId;
    if (this.activeStepRequestId !== null && incomingReqId !== this.activeStepRequestId) {
      return false;
    }
    this.activeSnapshot = snapshot;
    this.pendingSnapshot = null;
    this.cycleElapsedVisualMs = 0.0;
    this.lastWallPerfMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.steppedLifecycle = 'playing';
    this.activeStepRequestId = null;
    return true;
  }

  /**
   * Stage 4: Returns from stepped or paused playback to continuous live playback.
   */
  public resumeContinuous(): void {
    this.playbackMode = 'continuous';
    this.steppedLifecycle = 'idle';
    this.activeStepRequestId = null;
    this.isVisualClockPaused = false;
  }

  /**
   * Stage 4: Enters historical inspection mode.
   */
  public enterHistorical(): void {
    this.playbackMode = 'historical';
    this.steppedLifecycle = 'idle';
    this.activeStepRequestId = null;
    this.pendingSnapshot = null;
  }

  /**
   * Stage 4: Exits historical inspection mode back to live playback.
   */
  public exitHistorical(isPaused: boolean = false): void {
    this.playbackMode = 'continuous';
    this.steppedLifecycle = 'idle';
    this.activeStepRequestId = null;
    this.isVisualClockPaused = isPaused;
  }

  /**
   * Resets the visual engine and clears all snapshots (e.g. on simulation reset).
   */
  public resetVisualEngine(): void {
    this.sessionId += 1;
    this.playbackMode = 'continuous';
    this.steppedLifecycle = 'idle';
    this.steppedRequestId = 0;
    this.activeStepRequestId = null;
    this.isVisualClockPaused = false;
    this.activeSnapshot = null;
    this.pendingSnapshot = null;
    this.cycleElapsedVisualMs = 0.0;
    this.lastWallPerfMs = 0.0;
    this.lastSimTimeS = -1.0;
    this.lastEffectiveSpeed = 1.0;
  }

  /**
   * Alias for resetVisualEngine.
   */
  public reset(): void {
    this.resetVisualEngine();
  }

  /**
   * Resets visual clock state (backward compatible).
   */
  public resetVisualClock(): void {
    this.resetVisualEngine();
  }

  /**
   * Returns session ID for snapshot generation.
   */
  public getSessionId(): number {
    return this.sessionId;
  }

  /**
   * Backward-compatibility visual time getter in seconds.
   */
  public get accumulatedVisualTimeS(): number {
    return this.cycleElapsedVisualMs / 1000.0;
  }

  /**
   * Returns current active snapshot being rendered.
   */
  public getActiveSnapshot(): SuperframeVisualSnapshot | null {
    return this.activeSnapshot;
  }

  /**
   * Returns current pending snapshot awaiting promotion.
   */
  public getPendingSnapshot(): SuperframeVisualSnapshot | null {
    return this.pendingSnapshot;
  }

  /**
   * Returns elapsed milliseconds in the current visual cycle.
   */
  public getCycleElapsedVisualMs(): number {
    return this.cycleElapsedVisualMs;
  }

  /**
   * Computes cycle duration in milliseconds scaled inversely with simulation speed.
   * 1x = 1,000 ms, 2x = 500 ms, 0.5x = 2,000 ms.
   */
  public getCycleDurationMs(speed: number = 1.0): number {
    const safeSpeed = this.clampSpeed(speed);
    return DataCommVisualizer.BASE_VISUAL_CYCLE_MS / safeSpeed;
  }

  /**
   * Returns current subframe offset in milliseconds [0.0, superframeDurationMs)
   * based on current visual playback position.
   */
  public getCurrentSubframeOffsetMs(): number {
    const active = this.activeSnapshot;
    const superframeDurationMs = active ? active.superframeDurationMs : 20.0;
    const effectiveDurationMs = this.getCycleDurationMs(this.lastEffectiveSpeed);
    const cycleProgress = effectiveDurationMs > 0 ? this.cycleElapsedVisualMs / effectiveDurationMs : 0.0;
    return Math.min(superframeDurationMs, cycleProgress * superframeDurationMs);
  }

  /**
   * Returns authoritative resolved active slot state at current visual playback instant.
   */
  public getActiveSlotState(): ActiveSlotState | null {
    if (!this.activeSnapshot) return null;
    const subframeOffsetMs = this.getCurrentSubframeOffsetMs();
    return resolveActiveTdmaSlotState(
      subframeOffsetMs,
      this.activeSnapshot.allocations,
      this.activeSnapshot.ctrlDurationMs,
      this.activeSnapshot.dlDurationMs,
      this.activeSnapshot.superframeDurationMs,
      this.activeSnapshot.schedulerMode,
      this.activeSnapshot.nodes
    );
  }

  /**
   * Returns authoritative resolved superframe timeline for current active snapshot.
   */
  public getActiveTimeline(): ResolvedSuperframeTimeline | null {
    if (!this.activeSnapshot) return null;
    return resolveSuperframeTimeline({
      allocations: this.activeSnapshot.allocations,
      ctrlDurationMs: this.activeSnapshot.ctrlDurationMs,
      dlDurationMs: this.activeSnapshot.dlDurationMs,
      superframeDurationMs: this.activeSnapshot.superframeDurationMs,
      schedulerMode: this.activeSnapshot.schedulerMode,
      nodes: this.activeSnapshot.nodes,
    });
  }

  /**
   * Ingests a new snapshot following strict snapshot lifecycle rules:
   * - Discards stale telemetry from older simulation sessions (e.g. after reset).
   * - Historical snapshots: latch immediately if snapshot ID changed.
   * - Stepped snapshots: latches when awaiting telemetry; preserves active snapshot during playing/complete.
   * - Live snapshots: latch immediately if activeSnapshot is null or historical;
   *   otherwise store as pendingSnapshot (never replace activeSnapshot mid-cycle).
   */
  public ingestSnapshot(newSnapshot: SuperframeVisualSnapshot): void {
    // Protection against stale telemetry from an older session (e.g. after reset)
    if (newSnapshot.sessionId < this.sessionId) {
      if (newSnapshot.simulationTimeS > 0.001 || newSnapshot.frameIndex > 0) {
        return;
      }
    }

    // Case 1: Historical snapshot
    if (newSnapshot.source === 'historical') {
      this.playbackMode = 'historical';
      this.steppedLifecycle = 'idle';
      // Do not reset playback if scrubbing rendered the same record repeatedly
      if (this.activeSnapshot && this.activeSnapshot.snapshotId === newSnapshot.snapshotId) {
        return;
      }
      this.activeSnapshot = newSnapshot;
      this.pendingSnapshot = null;
      this.cycleElapsedVisualMs = 0.0;
      this.lastWallPerfMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return;
    }

    // Case 1b: Stepped playback mode handling
    if (this.playbackMode === 'stepped') {
      if (this.steppedLifecycle === 'waiting_for_telemetry' && newSnapshot.source === 'live') {
        // Fix 1: Accept ONLY if newSnapshot.stepRequestId matches activeStepRequestId!
        if (this.activeStepRequestId !== null && newSnapshot.stepRequestId !== this.activeStepRequestId) {
          // Uncorrelated continuous frame arriving while waiting for stepped frame; ignore!
          return;
        }
        this.activeSnapshot = newSnapshot;
        this.pendingSnapshot = null;
        this.cycleElapsedVisualMs = 0.0;
        this.lastWallPerfMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.steppedLifecycle = 'playing';
        this.activeStepRequestId = null;
        return;
      }
      // While playing or holding complete, do NOT allow newer telemetry to overwrite the stepped snapshot!
      return;
    }

    // Case 2: Live snapshot arriving while active snapshot is historical (transition to live)
    if (this.activeSnapshot && this.activeSnapshot.source === 'historical') {
      this.playbackMode = 'continuous';
      this.activeSnapshot = newSnapshot;
      this.pendingSnapshot = null;
      this.cycleElapsedVisualMs = 0.0;
      this.lastWallPerfMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return;
    }

    // Case 3: Initial live snapshot
    if (this.activeSnapshot === null) {
      this.activeSnapshot = newSnapshot;
      this.pendingSnapshot = null;
      this.cycleElapsedVisualMs = 0.0;
      this.lastWallPerfMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return;
    }

    // Case 4: Repeated render of the exact same live frame
    if (this.activeSnapshot.snapshotId === newSnapshot.snapshotId) {
      return;
    }
    if (this.pendingSnapshot && this.pendingSnapshot.snapshotId === newSnapshot.snapshotId) {
      return;
    }

    // Case 5: New live frame replaces pending snapshot only (active snapshot preserved)
    this.pendingSnapshot = newSnapshot;
  }

  /**
   * Advances the playback cycle based on elapsed wall-clock time and simulation speed.
   * Preserves continuous normalized cycle progress across dynamic simulation speed changes.
   * In stepped playback: plays complete 20 ms superframe once, then holds final phase at 100%.
   * In continuous playback: promotes pending snapshot at cycle rollover. Handles large render deltas safely.
   */
  public advancePlayback(dtWallMs: number, speed: number = 1.0, isPaused: boolean = false): void {
    if (this.activeSnapshot === null) {
      return;
    }

    const effectiveSpeed = this.clampSpeed(speed);
    const oldCycleDurationMs = this.getCycleDurationMs(this.lastEffectiveSpeed);
    const newCycleDurationMs = this.getCycleDurationMs(effectiveSpeed);

    // 1. Rescale elapsed visual time if effective speed changed to maintain continuous progress
    if (Math.abs(effectiveSpeed - this.lastEffectiveSpeed) > 1e-6) {
      const currentProgress = oldCycleDurationMs > 0 ? this.cycleElapsedVisualMs / oldCycleDurationMs : 0.0;
      // Clamp progress to [0.0, 1.0] to preserve normalized visual progress exactly
      const safeProgress = Math.max(0.0, Math.min(1.0, currentProgress));
      this.cycleElapsedVisualMs = safeProgress * newCycleDurationMs;
      this.lastEffectiveSpeed = effectiveSpeed;
    }

    // 2. Visual pause check (freezes visual playback)
    if (isPaused) {
      return;
    }

    // 3. Stepped playback lifecycle handling
    if (this.playbackMode === 'stepped') {
      if (this.steppedLifecycle === 'waiting_for_telemetry') {
        return;
      }
      if (this.steppedLifecycle === 'complete') {
        // Hold final phase at exact end of cycle
        this.cycleElapsedVisualMs = newCycleDurationMs;
        return;
      }
      if (this.steppedLifecycle === 'playing') {
        const safeDt = Math.max(0.0, dtWallMs);
        this.cycleElapsedVisualMs += safeDt;
        if (this.cycleElapsedVisualMs >= newCycleDurationMs) {
          this.cycleElapsedVisualMs = newCycleDurationMs;
          this.steppedLifecycle = 'complete';
          if (this.onSteppedCycleComplete) {
            this.onSteppedCycleComplete();
          }
        }
        return;
      }
    }

    // 4. Continuous or historical playback handling
    const safeDt = Math.max(0.0, dtWallMs);

    // Large render delta safety: if delta is huge (e.g. background tab), avoid runaway loops
    if (safeDt > newCycleDurationMs * 2) {
      if (this.pendingSnapshot !== null) {
        this.activeSnapshot = this.pendingSnapshot;
        this.pendingSnapshot = null;
      }
      this.cycleElapsedVisualMs = 0.0;
      return;
    }

    this.cycleElapsedVisualMs += safeDt;

    // Rollover: promote pending snapshot if cycle completed
    if (this.cycleElapsedVisualMs >= newCycleDurationMs) {
      if (this.pendingSnapshot !== null) {
        this.activeSnapshot = this.pendingSnapshot;
        this.pendingSnapshot = null;
      }
      this.cycleElapsedVisualMs = this.cycleElapsedVisualMs % newCycleDurationMs;
    }
  }

  /**
   * Main rendering routine supporting both DataCommRenderOptions and legacy DataCommFrameInput.
   */
  public render(
    ctx: CanvasRenderingContext2D,
    inputOrOptions: DataCommRenderOptions | DataCommFrameInput
  ): void {
    // Detect whether caller used new snapshot options or legacy input
    let snapshot: SuperframeVisualSnapshot;
    let acnScreenPos: Point2D;
    let nodeScreenPositions: ReadonlyMap<number, Point2D> | Record<number, Point2D>;
    let speed: number = 1.0;
    let isPaused: boolean = false;
    let manualVisualTimeMs: number | undefined;
    let showVisualOverlay = true;
    let opacityMultiplier = 1.0;

    if ('snapshot' in inputOrOptions) {
      snapshot = inputOrOptions.snapshot;
      acnScreenPos = inputOrOptions.acnScreenPos;
      nodeScreenPositions = inputOrOptions.nodeScreenPositions;
      speed = inputOrOptions.speed ?? 1.0;
      isPaused = Boolean(inputOrOptions.isPaused);
      manualVisualTimeMs = inputOrOptions.visualTimeMs;
      showVisualOverlay = inputOrOptions.showVisualOverlay ?? true;
      const rawOpacity = inputOrOptions.opacityMultiplier;
      opacityMultiplier = (typeof rawOpacity === 'number' && Number.isFinite(rawOpacity))
        ? Math.max(0, Math.min(1, rawOpacity))
        : 1.0;
    } else {
      // Legacy input wrapper: construct snapshot and extract screen positions
      const legacy = inputOrOptions as DataCommFrameInput;
      speed = 1.0;
      isPaused = Boolean(legacy.isPaused);
      acnScreenPos = { x: legacy.acn.screenX, y: legacy.acn.screenY };

      const posMap = new Map<number, Point2D>();
      legacy.nodes.forEach((n) => posMap.set(n.nodeId, { x: n.screenX, y: n.screenY }));
      nodeScreenPositions = posMap;

      const superframeDurationMs = legacy.superframeDurationMs ?? legacy.tdmaFrameConfig?.frameDurationMs ?? 20.0;
      const ctrlDurationMs = legacy.downlinkTelemetry?.ctrl_duration_ms ?? legacy.tdmaFrameConfig?.ctrlDurationMs ?? 1.0;
      const dlDurationMs = legacy.downlinkTelemetry?.dl_duration_ms ?? legacy.tdmaFrameConfig?.dlMinDurationMs ?? 3.0;

      snapshot = createSuperframeSnapshot({
        source: 'live',
        sessionId: this.sessionId,
        frameIndex: Math.round(legacy.simTimeS / (superframeDurationMs / 1000.0)),
        simulationTimeS: legacy.simTimeS,
        schedulerMode: legacy.schedulerMode,
        allocations: legacy.activeAllocations ?? [],
        nodes: legacy.nodes,
        superframeDurationMs,
        ctrlDurationMs,
        dlDurationMs,
        isBroadcastingDownlink: legacy.dlBroadcastActive ?? true,
      });

      if (typeof legacy.visualTimeS === 'number' && Number.isFinite(legacy.visualTimeS)) {
        manualVisualTimeMs = legacy.visualTimeS * 1000.0;
      }
    }

    // 1. Detect genuine simulation reset (e.g. simTimeS dropped backwards in live mode)
    if (snapshot.source === 'live') {
      if (this.lastSimTimeS > 0 && snapshot.simulationTimeS < this.lastSimTimeS - 0.001) {
        this.resetVisualEngine();
      }
      this.lastSimTimeS = snapshot.simulationTimeS;
    }

    // 2. Ingest snapshot following dual-buffer rules
    this.ingestSnapshot(snapshot);

    const activeSnap = this.activeSnapshot;
    if (!activeSnap) return;

    // 3. Advance visual cycle
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.lastWallPerfMs === 0) {
      this.lastWallPerfMs = now;
    }
    const dtWallMs = now - this.lastWallPerfMs;
    this.lastWallPerfMs = now;

    const cycleDurationMs = this.getCycleDurationMs(speed);

    const shouldPauseVisual = typeof inputOrOptions === 'object' && 'isVisualPaused' in inputOrOptions && (inputOrOptions as DataCommRenderOptions).isVisualPaused !== undefined
      ? Boolean((inputOrOptions as DataCommRenderOptions).isVisualPaused)
      : (this.playbackMode === 'stepped'
          ? this.isVisualClockPaused
          : Boolean(isPaused || this.isVisualClockPaused));

    if (typeof manualVisualTimeMs === 'number' && Number.isFinite(manualVisualTimeMs)) {
      this.cycleElapsedVisualMs = Math.max(0, manualVisualTimeMs) % cycleDurationMs;
      this.lastEffectiveSpeed = this.clampSpeed(speed);
    } else {
      this.advancePlayback(dtWallMs, speed, shouldPauseVisual);
    }

    // 4. Resolve subframe offset and active slot
    const subframeOffsetMs = this.getCurrentSubframeOffsetMs();
    const activeSlot = resolveActiveTdmaSlotState(
      subframeOffsetMs,
      activeSnap.allocations,
      activeSnap.ctrlDurationMs,
      activeSnap.dlDurationMs,
      activeSnap.superframeDurationMs,
      activeSnap.schedulerMode,
      activeSnap.nodes
    );

    // 5. Position resolver helper
    const getNodePos = (nodeId: number): Point2D => {
      if (nodeScreenPositions instanceof Map) {
        return nodeScreenPositions.get(nodeId) ?? { x: 0, y: 0 };
      }
      return (nodeScreenPositions as Record<number, Point2D>)[nodeId] ?? { x: 0, y: 0 };
    };

    ctx.save();

    if (!showVisualOverlay || opacityMultiplier <= 0.001) {
      ctx.restore();
      return;
    }

    if (opacityMultiplier < 1.0) {
      ctx.globalAlpha *= opacityMultiplier;
    }

    // 6. Render Subframe Phase Activity
    if (activeSlot.phase === 'CONTROL_BROADCAST') {
      this.renderControlBroadcast(ctx, acnScreenPos, activeSlot);
    } else if (activeSlot.phase === 'DOWNLINK_BROADCAST') {
      this.renderDownlinkBroadcast(ctx, acnScreenPos, activeSlot);
    } else if (activeSlot.phase === 'UPLINK_SLOT' && activeSlot.scheduledNodeId !== null) {
      this.renderUplinkSlotTransmission(
        ctx,
        acnScreenPos,
        activeSnap.nodes,
        getNodePos,
        activeSlot,
        activeSnap.schedulerMode
      );
    }

    // 7. Render On-Canvas Payload Progress Badges for nodes with active transfers
    this.renderTransferProgressBadges(ctx, activeSnap.nodes, getNodePos);

    // 8. Render Sleek Tactical Superframe HUD Indicator
    this.renderSuperframeHudIndicator(ctx, activeSnap, activeSlot, subframeOffsetMs, speed);

    ctx.restore();
  }

  /**
   * Phase 1: Network Synchronization / Control Subframe ([0.0 ms, ctrlDurationMs)).
   * Broadcast direction: ACN -> Ground Network.
   * Renders expanding dashed synchronization wavefront arcs from ACN.
   * Does NOT invent individual per-node packets or confirmed delivery dots.
   */
  private renderControlBroadcast(
    ctx: CanvasRenderingContext2D,
    acnPos: Point2D,
    activeSlot: ActiveSlotState
  ): void {
    const p = activeSlot.slotProgress;
    ctx.save();

    // Radiate 2 concentric expanding sync wavefronts
    for (let wave = 0; wave < 2; wave++) {
      const waveP = (p + wave * 0.5) % 1.0;
      const ringRadius = 12 + waveP * 65;
      const alpha = Math.max(0, 0.65 * (1.0 - waveP));

      ctx.beginPath();
      ctx.arc(acnPos.x, acnPos.y, ringRadius, 0, DataCommVisualizer.TAU);
      ctx.strokeStyle = `rgba(138, 149, 230, ${alpha})`;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
    }

    this.renderTacticalBadge(ctx, acnPos.x, acnPos.y - 14, 'SYNC TX [ACN → ALL]', HIGHLAND_THEME.signal.indigo);
    ctx.restore();
  }

  /**
   * Phase 2: Downlink Data Broadcast Subframe ([ctrlDurationMs, ctrlDurationMs + dlDurationMs)).
   * Broadcast direction: ACN -> Ground Network.
   * Renders expanding solid RF broadcast wavefront arcs from ACN.
   * Does NOT invent individual per-node packets or confirmed delivery dots.
   */
  private renderDownlinkBroadcast(
    ctx: CanvasRenderingContext2D,
    acnPos: Point2D,
    activeSlot: ActiveSlotState
  ): void {
    const p = activeSlot.slotProgress;
    ctx.save();

    // Radiate 3 concentric expanding broadcast wavefronts
    for (let wave = 0; wave < 3; wave++) {
      const waveP = (p + wave * 0.333) % 1.0;
      const ringRadius = 14 + waveP * 85;
      const alpha = Math.max(0, 0.55 * (1.0 - waveP));

      ctx.beginPath();
      ctx.arc(acnPos.x, acnPos.y, ringRadius, 0, DataCommVisualizer.TAU);
      ctx.strokeStyle = `rgba(224, 159, 62, ${alpha})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    this.renderTacticalBadge(ctx, acnPos.x, acnPos.y - 14, 'DL TX [ACN → ALL]', HIGHLAND_THEME.signal.amberBright);
    ctx.restore();
  }

  /**
   * Phase 3: Uplink TDMA Slot Transmission ([startMs, startMs + durationMs)).
   * Strictly animates packets from Ground Terminal -> ACN.
   */
  private renderUplinkSlotTransmission(
    ctx: CanvasRenderingContext2D,
    acnPos: Point2D,
    nodes: readonly SnapshotNodeState[],
    getNodePos: (id: number) => Point2D,
    activeSlot: ActiveSlotState,
    schedulerMode: string
  ): void {
    const targetNode = nodes.find((n) => n.nodeId === activeSlot.scheduledNodeId);
    if (!targetNode) return;

    const nPos = getNodePos(targetNode.nodeId);
    ctx.save();

    const isSevered = targetNode.isBlocked || targetNode.isOutage;
    const hasBacklog = targetNode.queueBacklogBytes > 0;
    const hasActiveTransfer = Boolean(targetNode.transfer && targetNode.transfer.status === 'TRANSMITTING');
    const isPayloadActive = (targetNode.isTransmitting || hasActiveTransfer || hasBacklog) && activeSlot.capacityBits > 0 && !isSevered;

    // Case 1: Static TDMA wasting airtime into a severed link
    if (schedulerMode === 'static' && isSevered && activeSlot.capacityBits > 0) {
      this.drawStaticWastedAirtimeStream(ctx, nPos, acnPos, activeSlot.slotProgress);
      this.renderTransmitterRing(ctx, nPos.x, nPos.y, activeSlot.slotProgress, HIGHLAND_THEME.signal.vermilion);
      this.renderTacticalBadge(ctx, nPos.x, nPos.y - 10, 'TX [WASTE]', HIGHLAND_THEME.signal.vermilion);
      // ACN is NOT receiving on a severed link
    }
    // Case 2: Severed link in dynamic scheduling (suppressed / reclaimed)
    else if (isSevered) {
      ctx.restore();
      return;
    }
    // Case 3: Operational link with active modeled payload transmission
    else if (isPayloadActive) {
      this.drawActiveUplinkStream(ctx, nPos, acnPos, targetNode, activeSlot);
      const isFlush = activeSlot.isPreOcclusionFlush;
      const isDegraded = targetNode.isDegraded;
      const themeColor = isFlush ? HIGHLAND_THEME.signal.amberBright : (isDegraded ? HIGHLAND_THEME.signal.ochre : HIGHLAND_THEME.signal.sage);
      const txBadge = isFlush ? 'TX [FLUSH]' : (isDegraded ? 'TX [DEGRADED]' : 'TX');
      const rxBadge = isFlush ? 'RX [FLUSH]' : 'RX';

      this.renderTransmitterRing(ctx, nPos.x, nPos.y, activeSlot.slotProgress, themeColor);
      this.renderTacticalBadge(ctx, nPos.x, nPos.y - 10, txBadge, themeColor);

      // ACN is Receiver (RX)
      this.renderReceiverReticle(ctx, acnPos.x, acnPos.y, activeSlot.slotProgress, themeColor);
      this.renderTacticalBadge(ctx, acnPos.x, acnPos.y - 14, rxBadge, themeColor);
    }
    // Case 4: Valid allocation with ZERO payload activity (unutilized carrier)
    else if (activeSlot.capacityBits > 0) {
      this.drawUnutilizedCarrierStream(ctx, nPos, acnPos, targetNode);
      this.renderTransmitterRing(ctx, nPos.x, nPos.y, activeSlot.slotProgress, 'rgba(179, 175, 167, 0.35)');
      this.renderTacticalBadge(ctx, nPos.x, nPos.y - 10, 'TX [IDLE]', 'rgba(179, 175, 167, 0.72)');

      // ACN is Receiver (RX [IDLE])
      this.renderReceiverReticle(ctx, acnPos.x, acnPos.y, activeSlot.slotProgress, 'rgba(179, 175, 167, 0.35)');
      this.renderTacticalBadge(ctx, acnPos.x, acnPos.y - 14, 'RX [IDLE]', 'rgba(179, 175, 167, 0.72)');
    }
    // Case 5: 0-capacity or unallocated
    else {
      ctx.beginPath();
      ctx.moveTo(nPos.x, nPos.y);
      ctx.lineTo(acnPos.x, acnPos.y);
      ctx.strokeStyle = HIGHLAND_THEME.line.strong;
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Draws energized uplink link with directional traveling packets from Ground Terminal -> ACN.
   */
  private drawActiveUplinkStream(
    ctx: CanvasRenderingContext2D,
    nodePos: Point2D,
    acnPos: Point2D,
    node: SnapshotNodeState,
    activeSlot: ActiveSlotState
  ): void {
    const dx = acnPos.x - nodePos.x;
    const dy = acnPos.y - nodePos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return;

    const isFlush = activeSlot.isPreOcclusionFlush;
    const isDegraded = node.isDegraded;
    const glowColor = isFlush
      ? 'rgba(224, 159, 62, 0.85)'
      : (isDegraded ? 'rgba(233, 196, 106, 0.75)' : 'rgba(82, 183, 136, 0.85)');
    const packetColor = isFlush ? HIGHLAND_THEME.signal.amberBright : (isDegraded ? HIGHLAND_THEME.signal.ochre : HIGHLAND_THEME.signal.sageBright);
    const coreColor = HIGHLAND_THEME.text.primary;

    ctx.save();

    ctx.beginPath();
    ctx.moveTo(nodePos.x, nodePos.y);
    ctx.lineTo(acnPos.x, acnPos.y);
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = node.isSelected ? 3.0 : 2.2;
    ctx.stroke();

    const particleCount = dist > 200 ? 5 : (dist > 100 ? 4 : 3);
    const particles = computeSlotPacketPositions(
      nodePos.x,
      nodePos.y,
      acnPos.x,
      acnPos.y,
      activeSlot.slotProgress,
      particleCount,
      1.0
    );

    const angle = Math.atan2(dy, dx);
    particles.forEach((p) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);

      ctx.fillStyle = packetColor;
      ctx.beginPath();
      ctx.roundRect(-4, -1.8, 8, 3.6, 1.8);
      ctx.fill();

      ctx.fillStyle = coreColor;
      ctx.beginPath();
      ctx.roundRect(-2.5, -1, 5, 2, 1);
      ctx.fill();

      ctx.restore();
    });

    ctx.restore();
  }

  /**
   * Draws unutilized carrier stream on an allocated slot with no active payload.
   * Renders a subtle unmodulated carrier line with NO traveling payload packets.
   */
  private drawUnutilizedCarrierStream(
    ctx: CanvasRenderingContext2D,
    nodePos: Point2D,
    acnPos: Point2D,
    node: SnapshotNodeState
  ): void {
    const dx = acnPos.x - nodePos.x;
    const dy = acnPos.y - nodePos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(nodePos.x, nodePos.y);
    ctx.lineTo(acnPos.x, acnPos.y);
    ctx.strokeStyle = 'rgba(179, 175, 167, 0.25)';
    ctx.lineWidth = node.isSelected ? 1.8 : 1.2;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draws Static TDMA wasted airtime terminating abruptly at obstacle cutoff (u = 0.42).
   */
  private drawStaticWastedAirtimeStream(
    ctx: CanvasRenderingContext2D,
    nodePos: Point2D,
    acnPos: Point2D,
    slotProgress: number
  ): void {
    const cutoffProgress = 0.42;
    const barrierPoint = interpolateLinkPosition(
      nodePos.x,
      nodePos.y,
      acnPos.x,
      acnPos.y,
      cutoffProgress
    );

    ctx.save();

    ctx.beginPath();
    ctx.moveTo(nodePos.x, nodePos.y);
    ctx.lineTo(barrierPoint.x, barrierPoint.y);
    ctx.strokeStyle = 'rgba(224, 83, 71, 0.48)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([3, 3]);
    ctx.stroke();

    const particles = computeSlotPacketPositions(
      nodePos.x,
      nodePos.y,
      acnPos.x,
      acnPos.y,
      slotProgress,
      3,
      cutoffProgress
    );

    particles.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, DataCommVisualizer.TAU);
      ctx.fillStyle = HIGHLAND_THEME.signal.vermilion;
      ctx.fill();
    });

    ctx.beginPath();
    ctx.arc(barrierPoint.x, barrierPoint.y, 4.0, 0, DataCommVisualizer.TAU);
    ctx.fillStyle = 'rgba(224, 83, 71, 0.88)';
    ctx.fill();
    ctx.strokeStyle = HIGHLAND_THEME.text.primary;
    ctx.lineWidth = 1.0;
    ctx.stroke();

    ctx.strokeStyle = HIGHLAND_THEME.text.primary;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(barrierPoint.x - 2.5, barrierPoint.y - 2.5);
    ctx.lineTo(barrierPoint.x + 2.5, barrierPoint.y + 2.5);
    ctx.moveTo(barrierPoint.x + 2.5, barrierPoint.y - 2.5);
    ctx.lineTo(barrierPoint.x - 2.5, barrierPoint.y + 2.5);
    ctx.stroke();

    ctx.restore();
  }

  private renderTransmitterRing(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    progress: number,
    color: string
  ): void {
    const pulse = progress % 1.0;
    const radius = 6 + pulse * 14;
    const alpha = Math.max(0, 0.7 * (1 - pulse));

    ctx.save();
    ctx.strokeStyle = color.startsWith('#')
      ? `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
      : color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, DataCommVisualizer.TAU);
    ctx.stroke();
    ctx.restore();
  }

  private renderReceiverReticle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    progress: number,
    color: string
  ): void {
    const reticleR = 14;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    ctx.moveTo(x - reticleR, y - reticleR + 4);
    ctx.lineTo(x - reticleR, y - reticleR);
    ctx.lineTo(x - reticleR + 4, y - reticleR);
    ctx.moveTo(x + reticleR - 4, y - reticleR);
    ctx.lineTo(x + reticleR, y - reticleR);
    ctx.lineTo(x + reticleR, y - reticleR + 4);
    ctx.moveTo(x - reticleR, y + reticleR - 4);
    ctx.lineTo(x - reticleR, y + reticleR);
    ctx.lineTo(x - reticleR + 4, y + reticleR);
    ctx.moveTo(x + reticleR - 4, y + reticleR);
    ctx.lineTo(x + reticleR, y + reticleR);
    ctx.lineTo(x + reticleR, y + reticleR - 4);
    ctx.stroke();
    ctx.restore();
  }

  private renderTacticalBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
    color: string
  ): void {
    ctx.save();
    ctx.font = 'bold 8px monospace';
    const textWidth = ctx.measureText(label).width;
    const boxW = textWidth + 8;
    const boxH = 11;
    const boxX = x - boxW / 2;
    const boxY = y - boxH / 2;

    ctx.fillStyle = HIGHLAND_THEME.substrate.hudFill;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
    ctx.restore();
  }

  private renderTransferProgressBadges(
    ctx: CanvasRenderingContext2D,
    nodes: readonly SnapshotNodeState[],
    getNodePos: (id: number) => Point2D
  ): void {
    nodes.forEach((node) => {
      const trans = node.transfer;
      if (!trans || trans.status === 'IDLE') return;

      const pos = getNodePos(node.nodeId);
      const pct = Math.min(100, Math.max(0, trans.progress_pct ?? 0));
      const type = (trans.active_type ?? 'DATA').toUpperCase();
      const nodeLabel = `S${node.nodeId}`;
      const status = trans.status;

      let badgeBorder: string = HIGHLAND_THEME.signal.sage;
      let badgeText = `${nodeLabel} | ${type} | ${pct.toFixed(0)}%`;

      if (status === 'TRANSMITTING') {
        const rateMbps = trans.current_rate_mbps ? trans.current_rate_mbps.toFixed(1) : '0.0';
        badgeText = `${nodeLabel} | ${type} | ${pct.toFixed(0)}% | ${rateMbps}M | UL`;
        badgeBorder = node.isDegraded ? HIGHLAND_THEME.signal.ochre : HIGHLAND_THEME.signal.sage;
      } else if (status === 'BLOCKED_NLOS') {
        badgeText = `${nodeLabel} | ${type} | ${pct.toFixed(0)}% | BLOCKED | UL`;
        badgeBorder = HIGHLAND_THEME.signal.ochre;
      } else if (status === 'ACKNOWLEDGED') {
        badgeText = `${nodeLabel} | ${type} | [✓ COMPLETE] | UL`;
        badgeBorder = HIGHLAND_THEME.signal.sage;
      } else if (status === 'FAILED_DROPPED') {
        badgeText = `${nodeLabel} | ${type} | [✕ QUEUE EXPIRED] | UL`;
        badgeBorder = HIGHLAND_THEME.signal.vermilion;
      }

      ctx.save();
      ctx.font = '600 8.5px monospace';
      const textWidth = ctx.measureText(badgeText).width;
      const boxW = textWidth + 18;
      const boxH = 15;
      const boxX = pos.x + 8;
      const boxY = pos.y + 10;

      ctx.fillStyle = HIGHLAND_THEME.substrate.hudFill;
      ctx.fillRect(boxX, boxY, boxW, boxH);

      ctx.strokeStyle = badgeBorder;
      ctx.lineWidth = 1.0;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      const arcCenterX = boxX + 8;
      const arcCenterY = boxY + boxH / 2;
      const arcR = 4.0;

      ctx.beginPath();
      ctx.arc(arcCenterX, arcCenterY, arcR, 0, DataCommVisualizer.TAU);
      ctx.strokeStyle = HIGHLAND_THEME.line.strong;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (pct > 0) {
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + (pct / 100) * DataCommVisualizer.TAU;
        ctx.beginPath();
        ctx.arc(arcCenterX, arcCenterY, arcR, startAngle, endAngle);
        ctx.strokeStyle = badgeBorder;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.fillStyle = HIGHLAND_THEME.text.primary;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, boxX + 16, boxY + boxH / 2);

      ctx.restore();
    });
  }

  private renderSuperframeHudIndicator(
    ctx: CanvasRenderingContext2D,
    snapshot: SuperframeVisualSnapshot,
    activeSlot: ActiveSlotState,
    subframeOffsetMs: number,
    speed: number = 1.0
  ): void {
    ctx.save();
    // Clear the 36px left-edge Terrain Toolbox icon rail (8px inset + 36px rail + 8px gap = 52px).
    const bannerX = 52;
    const bannerY = 42;
    const bannerH = 18;

    let phaseLabel: string;
    let phaseColor: string;

    if (this.playbackMode === 'stepped' && this.steppedLifecycle === 'complete') {
      phaseLabel = `STEP COMPLETE // HOLDING (${subframeOffsetMs.toFixed(1)}ms)`;
      phaseColor = HIGHLAND_THEME.signal.amber;
    } else if (activeSlot.phase === 'CONTROL_BROADCAST') {
      phaseLabel = `CTRL SYNC [ACN → ALL] (${subframeOffsetMs.toFixed(1)}ms)`;
      phaseColor = HIGHLAND_THEME.signal.indigo;
    } else if (activeSlot.phase === 'DOWNLINK_BROADCAST') {
      phaseLabel = `DL BROADCAST [ACN → ALL] (${subframeOffsetMs.toFixed(1)}ms)`;
      phaseColor = HIGHLAND_THEME.signal.amberBright;
    } else if (activeSlot.phase === 'UPLINK_SLOT' && activeSlot.scheduledNodeId !== null) {
      const scheduledNode = snapshot.nodes.find((n) => n.nodeId === activeSlot.scheduledNodeId);
      const isSevered = Boolean(scheduledNode && (scheduledNode.isBlocked || scheduledNode.isOutage));
      const isWasting = snapshot.schedulerMode === 'static' && isSevered;
      const hasBacklog = Boolean(scheduledNode && scheduledNode.queueBacklogBytes > 0);
      const hasActiveTransfer = Boolean(scheduledNode && scheduledNode.transfer && scheduledNode.transfer.status === 'TRANSMITTING');
      const isPayloadActive = Boolean(scheduledNode && (scheduledNode.isTransmitting || hasActiveTransfer || hasBacklog) && activeSlot.capacityBits > 0 && !isSevered);
      const isFlush = activeSlot.isPreOcclusionFlush;

      if (isWasting) {
        phaseLabel = `UL SLOT S${activeSlot.scheduledNodeId} [WASTED AIRTIME // SEVERED] (${subframeOffsetMs.toFixed(1)}ms)`;
        phaseColor = HIGHLAND_THEME.signal.vermilion;
      } else if (isFlush && isPayloadActive) {
        phaseLabel = `UL SLOT S${activeSlot.scheduledNodeId} [PRE-OCCLUSION FLUSH] (${subframeOffsetMs.toFixed(1)}ms) | MODELED SERVICE`;
        phaseColor = HIGHLAND_THEME.signal.amberBright;
      } else if (isPayloadActive) {
        phaseLabel = `UL SLOT S${activeSlot.scheduledNodeId} [S${activeSlot.scheduledNodeId} → ACN] (${subframeOffsetMs.toFixed(1)}ms) | MODELED SERVICE`;
        phaseColor = scheduledNode?.isDegraded ? HIGHLAND_THEME.signal.ochre : HIGHLAND_THEME.signal.sage;
      } else if (activeSlot.capacityBits > 0) {
        phaseLabel = `UL SLOT S${activeSlot.scheduledNodeId} [UNUTILIZED CARRIER] (${subframeOffsetMs.toFixed(1)}ms)`;
        phaseColor = HIGHLAND_THEME.text.faint;
      } else {
        phaseLabel = `UL SLOT S${activeSlot.scheduledNodeId} (${subframeOffsetMs.toFixed(1)}ms)`;
        phaseColor = HIGHLAND_THEME.text.faint;
      }
    } else if (activeSlot.phase === 'CONFLICT') {
      phaseLabel = `OVERLAP CONFLICT [INTEGRITY ERROR] (${subframeOffsetMs.toFixed(1)}ms)`;
      phaseColor = HIGHLAND_THEME.signal.vermilion;
    } else if (activeSlot.phase === 'GUARD') {
      phaseLabel = `GUARD INTERVAL (${subframeOffsetMs.toFixed(1)}ms)`;
      phaseColor = HIGHLAND_THEME.text.faint;
    } else if (activeSlot.phase === 'IDLE_RECLAIMED') {
      phaseLabel = `IDLE AIRTIME [RECLAIMED] (${subframeOffsetMs.toFixed(1)}ms)`;
      phaseColor = HIGHLAND_THEME.signal.sage;
    } else {
      phaseLabel = `IDLE AIRTIME (${subframeOffsetMs.toFixed(1)}ms)`;
      phaseColor = HIGHLAND_THEME.text.faint;
    }

    const modeTag = this.playbackMode === 'stepped'
      ? (this.steppedLifecycle === 'complete' ? ' [STEP COMPLETE]' : ' [STEPPED]')
      : (snapshot.source === 'historical' ? ' [HISTORICAL]' : '');
    const speedTag = speed !== 1.0 ? ` ${speed.toFixed(1)}x` : '';
    const title = `TDMA 50x EXPANDED${modeTag}${speedTag} | SF #${snapshot.frameIndex} (T+${snapshot.simulationTimeS.toFixed(2)}s) | ${phaseLabel}`;
    ctx.font = 'bold 9px monospace';
    const canvasRef = (ctx as { canvas?: { clientWidth?: number; width?: number } }).canvas;
    const canvasWidth = canvasRef?.clientWidth || canvasRef?.width || 0;
    const maxBannerW = canvasWidth > 0 ? Math.max(120, canvasWidth - bannerX - 12) : Number.POSITIVE_INFINITY;

    let displayTitle = title;
    let textWidth = ctx.measureText(displayTitle).width;
    if (textWidth + 16 > maxBannerW) {
      const maxTextW = Math.max(24, maxBannerW - 16);
      let lo = 0;
      let hi = title.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const candidate = `${title.slice(0, mid)}…`;
        if (ctx.measureText(candidate).width <= maxTextW) lo = mid;
        else hi = mid - 1;
      }
      displayTitle = lo > 0 ? `${title.slice(0, lo)}…` : '…';
      textWidth = ctx.measureText(displayTitle).width;
    }
    const bannerW = Math.min(maxBannerW, textWidth + 16);

    ctx.fillStyle = HIGHLAND_THEME.substrate.hudFill;
    ctx.strokeStyle = phaseColor;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.roundRect(bannerX, bannerY, bannerW, bannerH, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = phaseColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayTitle, bannerX + 8, bannerY + bannerH / 2);

    ctx.restore();
  }
}
