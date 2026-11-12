/**
 * Telemetry Serializer for the X-Band Aerial Communication Network Digital Twin.
 *
 * Encapsulates telemetry packaging, formatting, and protocol payload serialization:
 * 1. Assembly of full 50 Hz TELEMETRY_FRAME protocol messages.
 * 2. Assembly of out-of-band PROFILE_FRAME protocol messages.
 * 3. Individual node telemetry formatting (coordinates, queues, battery, registration, transfer).
 * 4. Slot allocation normalization into Gantt-compatible frame intervals.
 * 5. Comparative KPI dashboard aggregation and calculations.
 * 6. Active transfer telemetry formatting.
 *
 * This module is pure telemetry formatting: all domain propagation, Fresnel geometry,
 * terrain sampling, and RF link-budget calculations remain in the simulation/domain layer.
 */

import {
  FRAME_DT,
  MCP_ID,
  THEATER_HALF_M,
} from '../shared/constants';
import type {
  TelemetryFrame,
  NodeTelemetryItem,
  FresnelSliceTelemetry,
  TelemetryGanttAllocation,
  NodeTransferTelemetry,
  ProfileFrameMessage,
} from '../shared/workerProtocol';
import { cartesianToGeodetic } from '../core/geodesy';
import {
  REAL_LADAKH_DEM_METADATA,
  TerrainBoundsTelemetry,
  TerrainEngine,
  TerrainObstruction,
} from '../core/terrain';
import { ACNFlightConfig, type AltitudeMode } from '../core/config';
import { LinkStatus } from '../core/linkBudget';
import {
  SlotAllocation,
  FrameScheduleReport,
} from '../core/scheduler';
import { GroundNodeTrafficSubsystem } from '../core/queues';
import { NodeRegistry } from '../core/nodeRegistry';
import { RegistrationLifecycle } from '../core/registration';
import { RollingGoodputTracker } from '../core/rollingGoodput';
import { TdmaFrameConfig } from '../core/tdmaConfig';
import {
  ActiveTransferTelemetry,
  calculateTransferEtaSeconds,
} from '../core/transferMetrics';
import {
  type NodeTransferState,
} from '../core/transferManager';
import {
  ACNTrajectory,
  NodeTerrainState,
  PredictiveState,
} from '../core/trajectory';
import { PROFILE_FRESNEL_FRACTION } from '../core/profileEngine';

export { PROFILE_FRESNEL_FRACTION };
export type { NodeTransferState };

/** Running metrics tracking cumulative simulation KPIs */
export interface RunningMetrics {
  staticGoodputBits: number;
  tacGoodputBits: number;
  staticWastedBits: number;
  tacWastedBits: number;
  staticDroppedPkts: number;
  tacDroppedPkts: number;
  staticEnqueuedPkts: number;
  tacEnqueuedPkts: number;
  node4PreShadowBacklogKb: number;
  staticNode4PreShadowBacklogKb: number;
  lastStaticUtilPct: number;
  lastTacUtilPct: number;
  staticScheduledUlTimeS: number;
  tacScheduledUlTimeS: number;
  staticAvailableUlTimeS: number;
  tacAvailableUlTimeS: number;
  staticUnusedUlTimeS: number;
  tacUnusedUlTimeS: number;
  staticPayloadBitsDequeued: number;
  tacPayloadBitsDequeued: number;
  staticDelayDropsThisRun: number;
  tacDelayDropsThisRun: number;
  staticOverflowDropsThisRun: number;
  tacOverflowDropsThisRun: number;
  staticFinalBacklogBits: number;
  tacFinalBacklogBits: number;
}


/**
 * Authoritative read-only simulation state interface required for telemetry serialization.
 * SimulationWorkerManager satisfies this contract without coupling this module to domain engines.
 */
export interface TelemetrySimulationState {
  readonly frameIndex: number;
  readonly simTimeS: number;
  readonly speed: number;
  readonly achievedSpeed: number;
  readonly isPaused: boolean;
  readonly activeStepRequestId?: number;
  readonly spatialLocked: boolean;
  readonly spatialRevision: number;
  readonly schedulerMode: string;
  readonly selectedNodeId: number;

  readonly nodesStatic: readonly GroundNodeTrafficSubsystem[];
  readonly nodesTac: readonly GroundNodeTrafficSubsystem[];
  readonly nodeRegistry: NodeRegistry;
  readonly registrationLifecycle: RegistrationLifecycle;

  readonly flightConfig: ACNFlightConfig;
  readonly trajectoryEngine: ACNTrajectory;
  readonly terrainEngine: TerrainEngine;
  readonly liveAltitudeM?: number;
  readonly liveVzMps?: number;
  readonly isTerrainClamped?: boolean;

  readonly linkStatuses: ReadonlyMap<number, LinkStatus>;
  readonly predStates: ReadonlyMap<number, PredictiveState>;
  readonly obstructionResults: ReadonlyMap<number, TerrainObstruction>;
  readonly nodeTransfers: ReadonlyMap<number, NodeTransferState>;

  readonly metrics: RunningMetrics;
  readonly lastReportStatic: FrameScheduleReport | null;
  readonly lastReportTac: FrameScheduleReport | null;
  readonly staticGoodputTracker: RollingGoodputTracker;
  readonly tacGoodputTracker: RollingGoodputTracker;
  readonly tdmaConfig: TdmaFrameConfig;
  readonly simulationRunId?: number;
}

/**
 * Normalizes an authoritative TDMA slot allocation into standard frame timing and Gantt metrics.
 *
 * Emits an explicit diagnostic warning if an allocation falls outside the current frame interval,
 * has non-finite values, or has non-positive duration.
 */
export function normalizeSlotAllocationToFrame(
  a: SlotAllocation,
  frameStartSimTimeS: number,
  frameDurationS: number = FRAME_DT
): TelemetryGanttAllocation {
  const relStartS = a.slotStartS - frameStartSimTimeS;
  const startMs = relStartS * 1000.0;
  const durationMs = a.durationS * 1000.0;
  const endMs = startMs + durationMs;
  const maxFrameMs = frameDurationS * 1000.0;

  // Floating-point tolerance for tiny numerical boundary deviations only (0.1 us)
  const EPSILON = 1e-4;

  // 1. Explicitly diagnose non-finite values
  const isFiniteNumbers =
    Number.isFinite(startMs) &&
    Number.isFinite(durationMs) &&
    Number.isFinite(endMs);

  // 2. Explicitly diagnose zero or negative allocation durations
  const isNonPositiveDuration = !isFiniteNumbers || durationMs <= 0.0;

  // 3. Half-open interval [0, maxFrameMs): slot may end at maxFrameMs, but must not begin at maxFrameMs
  const isOutOfInterval =
    !isFiniteNumbers ||
    startMs < -EPSILON ||
    startMs >= maxFrameMs - EPSILON ||
    endMs > maxFrameMs + EPSILON;

  const isOutOfFrame = !isFiniteNumbers || isNonPositiveDuration || isOutOfInterval;

  if (!isFiniteNumbers) {
    console.warn(
      `[Scheduler Diagnostic] Non-finite allocation timing for node ${a.nodeId}: ` +
      `start_ms=${startMs}, duration_ms=${durationMs}, end_ms=${endMs}`
    );
  } else if (isNonPositiveDuration) {
    console.warn(
      `[Scheduler Diagnostic] Non-positive allocation duration for node ${a.nodeId}: ` +
      `duration_ms=${durationMs.toFixed(3)}ms (must be strictly > 0)`
    );
  } else if (isOutOfInterval) {
    console.warn(
      `[Scheduler Diagnostic] Out-of-frame allocation for node ${a.nodeId}: ` +
      `start=${startMs.toFixed(3)}ms, duration=${durationMs.toFixed(3)}ms, end=${endMs.toFixed(3)}ms ` +
      `(frame interval [0.000, ${maxFrameMs.toFixed(3)}) ms, frameStartSimTimeS=${frameStartSimTimeS.toFixed(4)})`
    );
  }

  return {
    node_id: a.nodeId,
    start_ms: startMs,
    duration_ms: durationMs,
    duration_s: a.durationS,
    slot_start_s: a.slotStartS,
    capacity_bits: a.capacityBits,
    modcod_name: a.modcodName,
    spectral_efficiency: a.spectralEfficiency,
    c2_bytes: a.capacityBits > 0 ? 128 : 0,
    voice_bytes: 0,
    video_bytes: 0,
    photo_bytes: 0,
    is_pre_occlusion_flush: a.isPreOcclusionFlush,
    is_out_of_frame: isOutOfFrame,
  };
}

/**
 * Dedicated telemetry serializer constructing host telemetry payloads from simulation state.
 */
export class TelemetrySerializer {
  /**
   * Constructs telemetry items for all active ground nodes from precomputed domain results.
   */
  public buildNodesTelemetry(
    state: TelemetrySimulationState,
    acnPos: [number, number, number]
  ): NodeTelemetryItem[] {
    const activeNodes = state.schedulerMode === 'tac_tad' ? state.nodesTac : state.nodesStatic;
    return activeNodes.map((node) => {
      const obstruction = state.obstructionResults.get(node.nodeId);
      const ls = state.linkStatuses.get(node.nodeId);
      const ps = state.predStates.get(node.nodeId);
      const q = node.queue;

      const [nx, ny] = node.position;
      const geo = cartesianToGeodetic(nx, ny);

      const c2Bytes = q.getClassBacklogBytes(69);
      const voiceBytes = q.getClassBacklogBytes(65);
      const videoBytes = q.getClassBacklogBytes(67);
      const photoBytes = q.getClassBacklogBytes(70);

      const activeReport = state.schedulerMode === 'tac_tad' ? state.lastReportTac : state.lastReportStatic;
      const alloc = activeReport?.allocations.find((a) => a.nodeId === node.nodeId);
      const trans = state.nodeTransfers.get(node.nodeId);
      const isOutage = ls?.isOutage ?? true;
      const isObstacleBlocked = ls?.obstacleBlocked ?? false;
      const isTerrainBlocked = !(obstruction?.isLos ?? true);
      const isBlocked = isTerrainBlocked || isObstacleBlocked;
      const isHardShadow = ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF;
      const hasSlotCapacity = alloc !== undefined && alloc.capacityBits > 0 && alloc.durationS > 0;
      const isTransmitting = !isOutage && !isBlocked && !isHardShadow && (
        (trans !== undefined && trans.status === 'TRANSMITTING') ||
        (hasSlotCapacity && q.getTotalBacklogBytes() > 0)
      );
      const isWastingAirtime = Boolean(hasSlotCapacity && (isOutage || isBlocked || isHardShadow));

      const transRemaining = trans ? Math.max(0, trans.totalBytes - trans.deliveredBytes) : 0;
      const transEta = trans ? calculateTransferEtaSeconds(transRemaining, trans.currentRateBps, trans.status, state.isPaused) : { etaS: null, etaStatus: 'STANDBY' };

      const transState: NodeTransferTelemetry | null = trans && trans.status !== 'IDLE' ? {
        node_id: node.nodeId,
        status: trans.status,
        status_message: trans.statusMessage,
        active_type: trans.activeType,
        total_bytes: trans.totalBytes,
        delivered_bytes: trans.deliveredBytes,
        dropped_bytes: trans.droppedBytes,
        dropped_packets: trans.droppedPackets,
        progress_pct: trans.totalBytes > 0 ? Math.min(100.0, Math.round(((trans.deliveredBytes / trans.totalBytes) * 100.0) * 10) / 10) : 0.0,
        start_time_s: trans.startTimeS,
        ack_time_s: trans.ackTimeS,
        current_rate_bps: trans.currentRateBps,
        current_rate_mbps: trans.currentRateBps / 1e6,
        eta_s: transEta.etaS,
        eta_status: transEta.etaStatus,
      } : null;

      const regEntity = state.nodeRegistry.getByNodeId(node.nodeId);
      const registration = state.registrationLifecycle.get(node.nodeId);
      const callsign = regEntity?.identity.callsign ?? node.identity?.callsign ?? (node.nodeId === MCP_ID ? 'MCP' : `S${node.nodeId}`);

      return {
        node_id: node.nodeId,
        entity_id: node.entityId,
        creation_sequence: node.creationSequence,
        name: callsign,
        node_type: node.nodeType,
        x_m: node.position[0],
        y_m: node.position[1],
        z_m: node.position[2],
        lat_deg: geo.latDeg,
        lon_deg: geo.lonDeg,
        coordinate_reference: 'local Cartesian; x/y metres; z absolute altitude MSL metres',
        terrain_elevation_msl_m: state.terrainEngine.getElevation(node.position[0], node.position[1]),
        agl_m: node.aglM,
        altitude_msl_m: node.position[2],
        slant_range_km: (ls?.slantRangeM ?? 0) / 1000.0,
        snr_db: ls?.snrDb ?? -99.0,
        modcod_name: ls?.modcodName ?? 'LINK_OUTAGE',
        link_outage: ls?.isOutage ?? true,
        bitrate_bps: ls?.bitrateBps ?? 0,
        bitrate_mbps: ls?.bitrateMbps ?? 0,
        terrain_is_los: obstruction?.isLos ?? true,
        diffraction_loss_db: ls?.diffractionLossDb ?? obstruction?.diffractionLossDb ?? 0,
        state_name: ps?.currentState ?? NodeTerrainState.NORMAL_LOS,
        time_to_occlusion_s: ps?.timeToOcclusionS ?? -1,
        time_to_emergence_s: ps?.timeToEmergenceS ?? -1,
        fresnel_clearance_m: ps?.fresnelClearanceM ?? 0,
        obstacle_blocked: ls?.obstacleBlocked ?? false,
        is_coverage_complete: obstruction?.isCoverageComplete ?? true,
        isCoverageComplete: obstruction?.isCoverageComplete ?? true,
        coverage_note: obstruction?.coverageNote,
        coverageNote: obstruction?.coverageNote,
        c2_backlog: q.getClassPacketCount(69),
        voice_backlog: q.getClassPacketCount(65),
        video_backlog: q.getClassPacketCount(67),
        photo_backlog: q.getClassPacketCount(70),
        c2_bytes: c2Bytes,
        voice_bytes: voiceBytes,
        video_bytes: videoBytes,
        photo_bytes: photoBytes,
        total_backlog_bytes: q.getTotalBacklogBytes(),
        is_transmitting: isTransmitting,
        is_wasting_airtime: isWastingAirtime,
        allocated_slot_ms: (alloc?.durationS ?? 0) * 1000.0,
        allocated_capacity_bits: alloc?.capacityBits ?? 0,
        transfer_state: transState,
        color_hex: regEntity?.identity.colorHex ?? node.identity?.colorHex ?? (node.nodeType === 'mcp' ? '#f59e0b' : '#38bdf8'),
        tx_power_dbm: node.txPowerDbm ?? (node.nodeType === 'mcp' ? 43.0 : 36.0),
        battery_capacity_mah: node.batteryCapacityMah ?? (node.nodeType === 'mcp' ? 20000 : 5000),
        battery_level_pct: Number((node.batteryLevelPct ?? 100.0).toFixed(1)),
        tactical_priority: node.tacticalPriority ?? 1.0,
        is_depleted: node.batteryLevelPct <= 0 || node.isDepleted,
        registration_state: registration.state,
        registration_start_time_s: registration.start_time_s,
        registration_completion_time_s: registration.completion_time_s,
        registration_elapsed_s: registration.start_time_s === null ? null : Math.max(0, state.simTimeS - registration.start_time_s),
        communication_eligible: registration.state === 'REGISTERED',
      };
    });
  }

  /**
   * Helper constructing Node 4 status text for comparative KPI dashboard.
   */
  public getNode4Status(
    predStates: ReadonlyMap<number, PredictiveState>,
    nodesTac: readonly GroundNodeTrafficSubsystem[]
  ): string {
    const ps = predStates.get(4);
    if (!ps) return 'NOMINAL';
    const node4 = nodesTac.find((n) => n.nodeId === 4);
    if (!node4) return 'NOMINAL';
    const kb = node4.queue.getTotalBacklogBytes() / 1024.0;
    switch (ps.currentState) {
      case NodeTerrainState.NORMAL_LOS: return 'NOMINAL';
      case NodeTerrainState.PRE_OCCLUSION_FLUSH: return `EVACUATING ${kb.toFixed(1)} KB`;
      case NodeTerrainState.HARD_SHADOW_CUTOFF: return 'SHADOWED - BUFFERING';
      case NodeTerrainState.RE_EMERGENCE_BURST: return 'BURST RECOVERY';
      default: return 'NOMINAL';
    }
  }

  /**
   * Builds the complete 50 Hz TELEMETRY_FRAME payload for host publication,
   * using precomputed Fresnel slice and domain state.
   */
  public buildTelemetryFrame(
    state: TelemetrySimulationState,
    acnPos: [number, number, number],
    fresnelSlice: FresnelSliceTelemetry
  ): TelemetryFrame {
    const activeNodes = state.schedulerMode === 'tac_tad' ? state.nodesTac : state.nodesStatic;
    const [vx, vy, vzTraj] = state.trajectoryEngine.getAcnVelocity(state.simTimeS);
    const vz = state.liveVzMps !== undefined ? state.liveVzMps : (vzTraj ?? 0.0);
    const vHoriz = Math.hypot(vx, vy);
    const pitchDeg = (Math.atan2(vz, vHoriz) * 180.0) / Math.PI;
    const terrainElevMsl = state.terrainEngine.getElevation(acnPos[0], acnPos[1]);
    const terrainElevSafe = Number.isFinite(terrainElevMsl) ? terrainElevMsl : 0.0;
    const aglM = acnPos[2] - terrainElevSafe;
    const targetPos = state.trajectoryEngine.getAcnPosition(state.simTimeS);
    const targetAltM = targetPos[2];
    const flightPath3d = typeof state.trajectoryEngine.getPathPoints3D === 'function'
      ? state.trajectoryEngine.getPathPoints3D(64)
      : undefined;

    const nodesTel = this.buildNodesTelemetry(state, acnPos);

    // Detect state nodes synchronously so TypeScript tracks types cleanly
    let flushNode: { node: GroundNodeTrafficSubsystem; ps: PredictiveState } | null = null;
    let cutoffNode: { node: GroundNodeTrafficSubsystem; ps: PredictiveState } | null = null;
    let burstNode: { node: GroundNodeTrafficSubsystem; ps: PredictiveState } | null = null;

    for (const node of activeNodes) {
      const ps = state.predStates.get(node.nodeId);
      if (ps) {
        if (ps.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH && !flushNode) {
          flushNode = { node, ps };
        } else if (ps.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF && !cutoffNode) {
          cutoffNode = { node, ps };
        } else if (ps.currentState === NodeTerrainState.RE_EMERGENCE_BURST && !burstNode) {
          burstNode = { node, ps };
        }
      }
    }

    let narrative = activeNodes.length === 0
      ? 'ACN RELAY STANDBY: Operational loiter orbit active. Zero ground terminals currently deployed. Ready for dynamic terminal deployment.'
      : 'NOMINAL PATROL: All terminals in clear Line-of-Sight. ACN coverage bubble tracking along elliptical orbit at FL500 (5,000m).';
    if (flushNode) {
      narrative = `LOOK-AHEAD EVENT: S${flushNode.node.nodeId} predicted to enter mountain shadow in ${flushNode.ps.timeToOcclusionS.toFixed(1)}s. Tac-TAD expanded its slot to evacuate queue backlog before cutoff.`;
    } else if (cutoffNode) {
      narrative = `TERRAIN OUTAGE: S${cutoffNode.node.nodeId} line-of-sight is severed by mountain ridge. Static TDMA is wasting frame time radiating into rock. Tac-TAD reclaims 100% of the slot for other units.`;
    } else if (burstNode) {
      narrative = `RE-EMERGENCE: S${burstNode.node.nodeId} cleared the ridge. Tac-TAD allocated an immediate zero-contention burst to restore tactical comms.`;
    }

    const sg = state.metrics.staticGoodputBits;
    const tg = state.metrics.tacGoodputBits;
    const sw = state.metrics.staticWastedBits;
    const tw = state.metrics.tacWastedBits;
    const sd = state.metrics.staticDroppedPkts;
    const td = state.metrics.tacDroppedPkts;
    const se = Math.max(1, state.metrics.staticEnqueuedPkts);
    const te = Math.max(1, state.metrics.tacEnqueuedPkts);

    const activeReport = state.schedulerMode === 'tac_tad' ? state.lastReportTac : state.lastReportStatic;

    const staticDropDelayThisFrame = state.lastReportStatic?.packetsDroppedDelayThisFrame ?? 0;
    const staticDropOverflowThisFrame = state.lastReportStatic?.packetsDroppedOverflowThisFrame ?? 0;
    const staticDropTotalThisFrame = staticDropDelayThisFrame + staticDropOverflowThisFrame;

    const tacDropDelayThisFrame = state.lastReportTac?.packetsDroppedDelayThisFrame ?? 0;
    const tacDropOverflowThisFrame = state.lastReportTac?.packetsDroppedOverflowThisFrame ?? 0;
    const tacDropTotalThisFrame = tacDropDelayThisFrame + tacDropOverflowThisFrame;

    const activeDropDelayThisFrame = state.schedulerMode === 'tac_tad' ? tacDropDelayThisFrame : staticDropDelayThisFrame;
    const activeDropOverflowThisFrame = state.schedulerMode === 'tac_tad' ? tacDropOverflowThisFrame : staticDropOverflowThisFrame;
    const activeDropTotalThisFrame = state.schedulerMode === 'tac_tad' ? tacDropTotalThisFrame : staticDropTotalThisFrame;

    const activeGoodputBitsThisFrame = state.schedulerMode === 'tac_tad'
      ? (state.lastReportTac?.totalBitsTransmitted ?? 0)
      : (state.lastReportStatic?.totalBitsTransmitted ?? 0);
    const activeWastedBitsThisFrame = state.schedulerMode === 'tac_tad'
      ? (state.lastReportTac?.totalBitsWastedOnOutage ?? 0)
      : (state.lastReportStatic?.totalBitsWastedOnOutage ?? 0);

    const selStaticNode = state.nodesStatic.find(n => n.nodeId === state.selectedNodeId);
    const selTacNode = state.nodesTac.find(n => n.nodeId === state.selectedNodeId);
    const staticSelectedBacklogKb = selStaticNode
      ? selStaticNode.queue.getTotalBacklogBytes() / 1024.0
      : null;
    const tacSelectedBacklogKb = selTacNode
      ? selTacNode.queue.getTotalBacklogBytes() / 1024.0
      : null;

    const kpi = {
      static_goodput_mb: sg / 1e6,
      tac_goodput_mb: tg / 1e6,
      gain_multiplier: tg / Math.max(sg, 1.0),
      static_waste_pct: sg + sw > 0 ? (sw / (sg + sw)) * 100.0 : 0.0,
      tac_waste_pct: tg + tw > 0 ? (tw / (tg + tw)) * 100.0 : 0.0,
      static_drops: sd,
      static_drop_pct: (sd / se) * 100.0,
      tac_drops: td,
      tac_drop_pct: (td / te) * 100.0,
      ul_utilization_pct: activeReport?.totalUlUtilizationPct ?? 0,
      node4_pre_shadow_backlog_kb: state.metrics.node4PreShadowBacklogKb,
      static_node4_pre_shadow_backlog_kb: state.metrics.staticNode4PreShadowBacklogKb,
      node4_evac_status: this.getNode4Status(state.predStates, state.nodesTac),
      static_selected_backlog_kb: staticSelectedBacklogKb,
      tac_selected_backlog_kb: tacSelectedBacklogKb,

      // Exact per-frame scheduler metrics (purely additive):
      static_goodput_frame_bits: state.lastReportStatic?.totalBitsTransmitted ?? 0,
      tac_goodput_frame_bits: state.lastReportTac?.totalBitsTransmitted ?? 0,
      active_goodput_frame_bits: activeGoodputBitsThisFrame,
      static_wasted_frame_bits: state.lastReportStatic?.totalBitsWastedOnOutage ?? 0,
      tac_wasted_frame_bits: state.lastReportTac?.totalBitsWastedOnOutage ?? 0,
      active_wasted_frame_bits: activeWastedBitsThisFrame,
      static_drop_delay_frame_pkts: staticDropDelayThisFrame,
      static_drop_overflow_frame_pkts: staticDropOverflowThisFrame,
      static_drop_frame_pkts: staticDropTotalThisFrame,
      tac_drop_delay_frame_pkts: tacDropDelayThisFrame,
      tac_drop_overflow_frame_pkts: tacDropOverflowThisFrame,
      tac_drop_frame_pkts: tacDropTotalThisFrame,
      active_drop_delay_frame_pkts: activeDropDelayThisFrame,
      active_drop_overflow_frame_pkts: activeDropOverflowThisFrame,
      active_drop_frame_pkts: activeDropTotalThisFrame,
      static_utilization_pct: state.lastReportStatic?.totalUlUtilizationPct ?? 0,
      tac_utilization_pct: state.lastReportTac?.totalUlUtilizationPct ?? 0,

      // Rolling P50/P95 goodput statistics in bps (M7.3)
      static_p50_bps: state.staticGoodputTracker.p50Bps,
      static_p95_bps: state.staticGoodputTracker.p95Bps,
      tac_p50_bps: state.tacGoodputTracker.p50Bps,
      tac_p95_bps: state.tacGoodputTracker.p95Bps,
      rolling_window_sample_count: state.staticGoodputTracker.sampleCount,
      rolling_window_capacity: state.staticGoodputTracker.capacity,
    };

    const trans = state.nodeTransfers.get(state.selectedNodeId) ?? {
      activeType: null, totalBytes: 0, deliveredBytes: 0, prevDeliveredBytes: 0, droppedBytes: 0, droppedPackets: 0,
      status: 'IDLE' as const, statusMessage: '', startTimeS: -1, ackTimeS: -1, lastQueueDrops: 0,
      lastUpdateSimTimeS: -1, currentRateBps: 0, etaS: null, etaStatus: 'STANDBY'
    };
    const pct = trans.totalBytes > 0 ? (trans.deliveredBytes / trans.totalBytes) * 100.0 : 0.0;

    const transRemaining = Math.max(0, trans.totalBytes - trans.deliveredBytes);
    const transEta = calculateTransferEtaSeconds(transRemaining, trans.currentRateBps, trans.status, state.isPaused);

    const transferTel: ActiveTransferTelemetry = {
      node_id: state.selectedNodeId,
      status: trans.status,
      status_message: trans.statusMessage,
      active_type: trans.activeType,
      total_bytes: trans.totalBytes,
      delivered_bytes: trans.deliveredBytes,
      dropped_bytes: trans.droppedBytes,
      dropped_packets: trans.droppedPackets,
      progress_pct: Math.min(100.0, Math.round(pct * 10) / 10),
      start_time_s: trans.startTimeS,
      ack_time_s: trans.ackTimeS,
      current_rate_bps: trans.currentRateBps,
      current_rate_mbps: trans.currentRateBps / 1e6,
      eta_s: transEta.etaS,
      eta_status: transEta.etaStatus,
    };

    const activeTransfers: ActiveTransferTelemetry[] = [];
    for (const [nid, t] of state.nodeTransfers.entries()) {
      if (t.status !== 'IDLE') {
        const p = t.totalBytes > 0 ? (t.deliveredBytes / t.totalBytes) * 100.0 : 0.0;
        const tRemaining = Math.max(0, t.totalBytes - t.deliveredBytes);
        const tEta = calculateTransferEtaSeconds(tRemaining, t.currentRateBps, t.status, state.isPaused);
        activeTransfers.push({
          node_id: nid,
          status: t.status,
          status_message: t.statusMessage,
          active_type: t.activeType,
          total_bytes: t.totalBytes,
          delivered_bytes: t.deliveredBytes,
          dropped_bytes: t.droppedBytes,
          dropped_packets: t.droppedPackets,
          progress_pct: Math.min(100.0, Math.round(p * 10) / 10),
          start_time_s: t.startTimeS,
          ack_time_s: t.ackTimeS,
          current_rate_bps: t.currentRateBps,
          current_rate_mbps: t.currentRateBps / 1e6,
          eta_s: tEta.etaS,
          eta_status: tEta.etaStatus,
        });
      }
    }

    const mapAlloc = (a: SlotAllocation) =>
      normalizeSlotAllocationToFrame(a, activeReport?.timestampS ?? state.simTimeS, state.tdmaConfig.frameDurationS);
    const allocations = (activeReport?.allocations ?? []).map(mapAlloc);

    const mapAllocStatic = (a: SlotAllocation) =>
      normalizeSlotAllocationToFrame(a, state.lastReportStatic?.timestampS ?? state.simTimeS, state.tdmaConfig.frameDurationS);
    const mapAllocTac = (a: SlotAllocation) =>
      normalizeSlotAllocationToFrame(a, state.lastReportTac?.timestampS ?? state.simTimeS, state.tdmaConfig.frameDurationS);
    const acnGeo = cartesianToGeodetic(acnPos[0], acnPos[1]);

    return {
      frame_index: state.frameIndex,
      sim_time_s: state.simTimeS,
      speed: state.speed,
      target_speed: state.speed,
      achieved_speed: state.isPaused ? 0.0 : (state.achievedSpeed > 0 ? state.achievedSpeed : state.speed),
      paused: state.isPaused,
      step_request_id: state.activeStepRequestId,
      spatial_locked: state.spatialLocked,
      spatial_revision: state.spatialRevision,
      trajectory_config: {
        trajectory_mode: state.flightConfig.trajectoryMode,
        center_x_m: state.flightConfig.centerXm,
        center_y_m: state.flightConfig.centerYm,
        orbit_a_m: state.flightConfig.loiterRadiusAM,
        orbit_b_m: state.flightConfig.loiterRadiusBM,
        orbit_rotation_deg: state.flightConfig.loiterRotationDeg,
        loiter_speed_mps: state.flightConfig.loiterSpeedMps,
        current_speed_mps: state.trajectoryEngine.getCurrentSpeed(state.simTimeS),
        acn_altitude_m: state.flightConfig.altitudeMslM,
        altitude_mode: state.flightConfig.altitudeMode,
        target_agl_m: state.flightConfig.targetAglM,
        max_climb_rate_mps: state.flightConfig.maxClimbRateMps,
        max_descent_rate_mps: state.flightConfig.maxDescentRateMps,
        waypoints: state.flightConfig.waypoints.map(point => ({
          x_m: point.xM,
          y_m: point.yM,
          ...(point.zM !== undefined && Number.isFinite(point.zM) ? { z_m: point.zM } : {}),
        })),
      },
      scheduler_mode: state.schedulerMode,
      selected_node_id: state.selectedNodeId,
      plain_english_narrative: narrative,
      acn_telemetry: {
        pos_x: acnPos[0],
        pos_y: acnPos[1],
        pos_z: acnPos[2],
        lat_deg: acnGeo.latDeg,
        lon_deg: acnGeo.lonDeg,
        vel_x: vx,
        vel_y: vy,
        vel_z: vz,
        pitch_deg: pitchDeg,
        altitude_msl_m: acnPos[2],
        altitude_agl_m: aglM,
        terrain_elevation_msl_m: terrainElevSafe,
        altitude_mode: state.flightConfig.altitudeMode,
        target_altitude_m: targetAltM,
        is_terrain_clamped: state.isTerrainClamped ?? false,
        heading_rad: Math.atan2(vy, vx),
        current_speed_mps: state.trajectoryEngine.getCurrentSpeed(state.simTimeS),
        target_speed_mps: state.flightConfig.loiterSpeedMps,
        acceleration_limit_mps2: state.flightConfig.accelerationLimitMps2,
        deceleration_limit_mps2: state.flightConfig.decelerationLimitMps2,
        coverage_radius_m: state.flightConfig.coverageRadiusKm * 1000.0,
        coverage_radius_km: state.flightConfig.coverageRadiusKm,
        flight_path: state.trajectoryEngine.getPathPoints(64),
        ...(flightPath3d ? { flight_path_3d: flightPath3d } : {}),
      },
      nodes_telemetry: nodesTel,
      registration_telemetry: { nodes: state.registrationLifecycle.active(), events: state.registrationLifecycle.events() },
      active_gantt_allocations: allocations,
      static_gantt_allocations: (state.lastReportStatic?.allocations ?? []).map(mapAllocStatic),
      tac_gantt_allocations: (state.lastReportTac?.allocations ?? []).map(mapAllocTac),
      comparative_kpi_dashboard: kpi,
      static_p50_bps: state.staticGoodputTracker.p50Bps,
      static_p95_bps: state.staticGoodputTracker.p95Bps,
      tac_p50_bps: state.tacGoodputTracker.p50Bps,
      tac_p95_bps: state.tacGoodputTracker.p95Bps,
      selected_node_fresnel: fresnelSlice,
      selected_link_budget: fresnelSlice.link_budget,
      transfer_telemetry: transferTel,
      active_transfers: activeTransfers,
      downlink_telemetry: {
        is_control_broadcast: true,
        ctrl_duration_ms: (activeReport?.ctrlDurationS ?? state.tdmaConfig.ctrlDurationS) * 1000.0,
        dl_duration_ms: (activeReport?.dlDurationS ?? state.tdmaConfig.dlMinDurationS) * 1000.0,
        broadcast_active: true,
      },
      terrain_mode: state.terrainEngine.terrain_mode,
      terrain_bounds_km: state.terrainEngine.terrain_mode === 'real'
        ? REAL_LADAKH_DEM_METADATA.halfWidthM / 1000
        : THEATER_HALF_M / 1000,
      terrain_bounds: state.terrainEngine.getTerrainBoundsTelemetry(),
      tdma_frame_config: state.tdmaConfig ? state.tdmaConfig.toObject() : undefined,
      ...(typeof state.simulationRunId === 'number' ? { simulation_run_id: state.simulationRunId } : {}),
    };
  }

  /**
   * Builds an out-of-band PROFILE_FRAME protocol message from precomputed Fresnel and node telemetry.
   */
  public buildProfileFrameMessage(
    selectedNodeId: number,
    profileSerial: number,
    spatialRevision: number,
    fresnelSlice: FresnelSliceTelemetry,
    nodesTelemetry: readonly NodeTelemetryItem[]
  ): ProfileFrameMessage {
    return {
      type: 'PROFILE_FRAME',
      selectedNodeId,
      profileSerial,
      spatial_revision: spatialRevision,
      fresnel: fresnelSlice,
      selected_link_budget: fresnelSlice.link_budget,
      nodes_telemetry: nodesTelemetry,
    };
  }
}
