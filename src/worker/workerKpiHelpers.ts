/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Pure Worker KPI, Delay Quantile & Snapshot Composition Helpers
 *
 * Implements authoritative mathematical extraction for:
 * - HOL delay quantiles across 3GPP 5QI profiles.
 * - Dual-scheduler epoch metrics (Static TDMA vs. Tac-TAD Dynamic).
 * - Superframe epoch records with half-open coverage intervals.
 * - Spatial telemetry snapshots for UI timeline inspection.
 *
 * STRICT INVARIANTS:
 * - 100% pure, stateless functions.
 * - Zero module-level mutable state (`let` / `var`).
 * - Zero `Math.random()`.
 */

import { GroundNodeTrafficSubsystem } from '../core/queues';
import { FrameScheduleReport, LegacyStaticScheduler, TerrainAwareDynamicScheduler } from '../core/scheduler';
import { NodeTerrainState, PredictiveState } from '../core/trajectory';
import { TerrainObstruction, TerrainEngine } from '../core/terrain';
import { LinkStatus, LinkBudgetEngine } from '../core/linkBudget';
import type { Position3D } from '../shared/types';
import type { RFConfig, EnvironmentConfig } from '../core/config';
import type { RunningMetrics } from './telemetrySerializer';
import type {
  SchedulerEpochMetrics,
  SuperframeEpochRecord,
  SpatialFrameSnapshot,
  SpatialNodeSnapshot,
  SpatialLinkBudgetSnapshot,
  HiFiPhysicsTelemetry,
  TelemetryFrame,
  WorkerOutboundMessage,
  WorkerCommandResult,
  EvictionSchedulerId,
  EvictionDropFinalizationRecord,
} from '../shared/workerProtocol';

/**
 * Computes 7-point Head-Of-Line (HOL) delay quantiles (p10, p25, p50, p75, p90, p95, p99)
 * in milliseconds across all active node queues and QoS traffic classes.
 */
export function computeDelayQuantiles(
  nodes: readonly GroundNodeTrafficSubsystem[],
  simTimeS: number
): number[] {
  const delaysMs: number[] = [];
  const qosList = [69, 65, 67, 70];
  for (let i = 0; i < nodes.length; i++) {
    const q = nodes[i].queue;
    for (let j = 0; j < 4; j++) {
      const qos = qosList[j];
      if (q.getClassPacketCount(qos) > 0) {
        const dMs = q.getHolDelayS(qos, simTimeS) * 1000.0;
        if (Number.isFinite(dMs) && dMs >= 0) {
          delaysMs.push(dMs);
        }
      }
    }
  }
  if (delaysMs.length === 0) {
    return [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  }
  delaysMs.sort((a, b) => a - b);
  const getQuantile = (q: number) => {
    const idx = Math.min(delaysMs.length - 1, Math.max(0, Math.floor(q * (delaysMs.length - 1))));
    return Number(delaysMs[idx].toFixed(2));
  };
  return [
    getQuantile(0.10),
    getQuantile(0.25),
    getQuantile(0.50),
    getQuantile(0.75),
    getQuantile(0.90),
    getQuantile(0.95),
    getQuantile(0.99),
  ];
}

/**
 * Extracts comprehensive queue, backlog, HOL sojourn, and throughput metrics
 * for a completed scheduling epoch.
 */
export function extractSchedulerEpochMetrics(
  report: FrameScheduleReport | null,
  nodes: readonly GroundNodeTrafficSubsystem[],
  simTimeS: number
): SchedulerEpochMetrics {
  let endQueueDepthPkts = 0;
  let endBacklogBytes = 0;
  let totalHolDelayS = 0;
  let holCount = 0;
  const qosList = [69, 65, 67, 70];

  for (let i = 0; i < nodes.length; i++) {
    const q = nodes[i].queue;
    endQueueDepthPkts += q.getTotalPackets();
    endBacklogBytes += q.getTotalBacklogBytes();
    for (let j = 0; j < 4; j++) {
      const qos = qosList[j];
      if (q.getClassPacketCount(qos) > 0) {
        holCount++;
        totalHolDelayS += q.getHolDelayS(qos, simTimeS);
      }
    }
  }

  const meanHeadOfLineSojournMs = holCount > 0 ? (totalHolDelayS / holCount) * 1000.0 : null;

  if (!report) {
    return {
      transmittedNonOutageBits: 0,
      outageWastedBits: 0,
      totalPayloadBitsDequeued: 0,
      droppedDelayPkts: 0,
      droppedOverflowPkts: 0,
      totalDroppedPkts: 0,
      droppedDelayBytes: 0,
      droppedOverflowBytes: 0,
      totalDroppedBytes: 0,
      ulUtilizationPct: 0,
      endQueueDepthPkts,
      endBacklogBytes,
      meanHeadOfLineSojournMs,
    };
  }
  return {
    transmittedNonOutageBits: report.totalBitsTransmitted,
    outageWastedBits: report.totalBitsWastedOnOutage,
    totalPayloadBitsDequeued: report.totalPayloadBitsDequeued,
    droppedDelayPkts: report.packetsDroppedDelayThisFrame,
    droppedOverflowPkts: report.packetsDroppedOverflowThisFrame,
    totalDroppedPkts: report.packetsDroppedDelayThisFrame + report.packetsDroppedOverflowThisFrame,
    droppedDelayBytes: report.droppedDelayBytesThisFrame ?? report.droppedDelayBytes,
    droppedOverflowBytes: report.droppedOverflowBytesThisFrame ?? report.droppedOverflowBytes,
    totalDroppedBytes: report.totalDroppedBytesThisFrame ?? report.totalDroppedBytes,
    ulUtilizationPct: report.totalUlUtilizationPct,
    endQueueDepthPkts,
    endBacklogBytes,
    meanHeadOfLineSojournMs,
  };
}

export interface SuperframeEpochRecordParams {
  readonly tdmaSimTimeS: number;
  readonly durationS: number;
  readonly simulationRunId: number;
  readonly epochIndex: number;
  readonly frameDt: number;
  readonly configuredDurationMs: number;
  readonly nominalSimTimeS: number;
  readonly associatedSimulationFrameIndex: number;
  readonly lastReportStatic: FrameScheduleReport | null;
  readonly lastReportTac: FrameScheduleReport | null;
  readonly nodesStatic: readonly GroundNodeTrafficSubsystem[];
  readonly nodesTac: readonly GroundNodeTrafficSubsystem[];
  readonly activeSchedulerMode: 'static' | 'tac_tad';
}

/**
 * Builds an authoritative SuperframeEpochRecord for the communication timeline buffer.
 */
export function createSuperframeEpochRecord(
  params: SuperframeEpochRecordParams
): SuperframeEpochRecord {
  const startFrame = Math.floor(params.tdmaSimTimeS / params.frameDt + 1e-6) + 1;
  const endFrame = Math.max(startFrame, Math.ceil((params.tdmaSimTimeS + params.durationS) / params.frameDt - 1e-6));

  return {
    recordType: 'EPOCH',
    simulationRunId: params.simulationRunId,
    epochIndex: params.epochIndex,
    startTimeS: params.tdmaSimTimeS,
    endTimeS: params.tdmaSimTimeS + params.durationS,
    durationMs: params.durationS * 1000.0,
    configuredDurationMs: params.configuredDurationMs,
    nominalSimTimeS: params.nominalSimTimeS,
    associatedSimulationFrameIndex: params.associatedSimulationFrameIndex,
    coveredFrameRange: [startFrame, endFrame],
    staticMetrics: extractSchedulerEpochMetrics(params.lastReportStatic, params.nodesStatic, params.nominalSimTimeS),
    tacMetrics: extractSchedulerEpochMetrics(params.lastReportTac, params.nodesTac, params.nominalSimTimeS),
    activeSchedulerMode: params.activeSchedulerMode,
  };
}

export interface BuildSpatialFrameSnapshotParams {
  readonly frameIndex: number;
  readonly simTimeS: number;
  readonly wallClockTimeMs: number;
  readonly spatialRevision: number;
  readonly acnPos: [number, number, number];
  readonly acnVel: [number, number, number];
  readonly liveAltitudeM: number;
  readonly liveVzMps: number;
  readonly terrainElevation: number;
  readonly coverageRadiusKm: number;
  readonly isTerrainClamped: boolean;
  readonly attitudeHeadingDeg: number;
  readonly attitudeBankDeg: number;
  readonly nodesTac: readonly GroundNodeTrafficSubsystem[];
  readonly obstructionResults: ReadonlyMap<number, TerrainObstruction>;
  readonly linkStatuses: ReadonlyMap<number, LinkStatus>;
  readonly predStates: ReadonlyMap<number, PredictiveState>;
  readonly selectedNodeId: number;
}

/**
 * Pure factory for assembling a SpatialFrameSnapshot.
 */
export function buildSpatialFrameSnapshot(
  params: BuildSpatialFrameSnapshotParams
): SpatialFrameSnapshot {
  const vx = params.acnVel[0];
  const vy = params.acnVel[1];
  const vz = params.liveVzMps;
  const vHoriz = Math.hypot(vx, vy);
  const headingRad = Math.atan2(vy, vx);
  const pitchDeg = (Math.atan2(vz, vHoriz) * 180.0) / Math.PI;
  const altitudeAglM = params.liveAltitudeM - params.terrainElevation;

  const nodesSnapshot: SpatialNodeSnapshot[] = params.nodesTac.map((n) => {
    const obs = params.obstructionResults.get(n.nodeId);
    const ls = params.linkStatuses.get(n.nodeId);
    const ps = params.predStates.get(n.nodeId);
    return {
      nodeId: n.nodeId,
      posX: n.position[0],
      posY: n.position[1],
      posZ: n.position[2],
      altitudeMslM: n.position[2],
      altitudeAglM: n.aglM,
      isLos: obs?.isLos ?? true,
      isOutage: ls?.isOutage ?? true,
      isObstacleBlocked: ls?.obstacleBlocked ?? false,
      snrDb: ls?.snrDb ?? 0.0,
      currentState: ps?.currentState ?? NodeTerrainState.NORMAL_LOS,
      active_sector_id: ls?.activeSectorId,
      pattern_rolloff_db: ls?.patternRollOffDb,
    };
  });

  const selLs = params.selectedNodeId >= 0 ? params.linkStatuses.get(params.selectedNodeId) : undefined;
  const selectedLinkBudget: SpatialLinkBudgetSnapshot | null = selLs
    ? {
        slantRangeM: selLs.slantRangeM,
        fsplDb: selLs.fsplDb,
        diffractionLossDb: selLs.diffractionLossDb,
        gasLossDb: selLs.gasLossDb,
        rainLossDb: selLs.rainLossDb,
        totalLossDb: selLs.totalLossDb,
        snrDb: selLs.snrDb,
        modcodName: selLs.modcodName,
        bitrateMbps: selLs.bitrateMbps,
        isOutage: selLs.isOutage,
      }
    : null;

  return {
    frameIndex: params.frameIndex,
    simulationTimeS: params.simTimeS,
    wallClockTimeMs: params.wallClockTimeMs,
    spatialRevision: params.spatialRevision,
    acn: {
      posX: params.acnPos[0],
      posY: params.acnPos[1],
      posZ: params.liveAltitudeM,
      velX: vx,
      velY: vy,
      velZ: vz,
      headingRad,
      pitchDeg,
      altitudeMslM: params.liveAltitudeM,
      altitudeAglM,
      coverageRadiusKm: params.coverageRadiusKm,
      isTerrainClamped: params.isTerrainClamped,
    },
    nodes: nodesSnapshot,
    selectedLinkBudget,
    acn_heading_deg: params.attitudeHeadingDeg,
    acn_bank_deg: params.attitudeBankDeg,
  };
}

export interface BuildHiFiTelemetryParams {
  readonly enableAirframeShadowing: boolean;
  readonly enableCorrelatedRicianFading: boolean;
  readonly enableMacPhyFeedback: boolean;
  readonly enableDubinsKinematics: boolean;
  readonly viewshedFidelityMode: 'fast' | 'link-budget-parity';
  readonly uavAttitude: { rollDeg: number; pitchDeg: number; yawDeg: number };
  readonly numNodes: number;
  readonly sumShadowLossDb: number;
  readonly maxShadowLossDb: number;
  readonly sumCorrelatedFadingDb: number;
  readonly latestCoherenceTimeMs: number;
  readonly cqiLagFrames: number;
  readonly sumOllaOffsetDb: number;
  readonly harqRetxTotal: number;
  readonly latestHarqGainDb: number;
  readonly dynamicGuardEfficiency: number;
  readonly dubinsMinTurnRadiusM: number;
}

export function buildHiFiPhysicsTelemetry(p: BuildHiFiTelemetryParams): HiFiPhysicsTelemetry {
  const n = p.numNodes > 0 ? p.numNodes : 1;
  return {
    enabled_flags: {
      enableAirframeShadowing: p.enableAirframeShadowing,
      enableCorrelatedRicianFading: p.enableCorrelatedRicianFading,
      enableMacPhyFeedback: p.enableMacPhyFeedback,
      enableDubinsKinematics: p.enableDubinsKinematics,
      viewshedFidelityMode: p.viewshedFidelityMode,
    },
    uav_roll_deg: Number(p.uavAttitude.rollDeg.toFixed(2)),
    uav_pitch_deg: Number(p.uavAttitude.pitchDeg.toFixed(2)),
    mean_airframe_shadow_loss_db: Number((p.numNodes > 0 ? p.sumShadowLossDb / n : 0.0).toFixed(2)),
    max_airframe_shadow_loss_db: Number(p.maxShadowLossDb.toFixed(2)),
    mean_correlated_fading_db: Number((p.numNodes > 0 ? p.sumCorrelatedFadingDb / n : 0.0).toFixed(2)),
    coherence_time_ms: Number(p.latestCoherenceTimeMs.toFixed(2)),
    cqi_lag_frames: p.cqiLagFrames,
    mean_olla_offset_db: Number((p.numNodes > 0 ? p.sumOllaOffsetDb / n : 0.0).toFixed(2)),
    harq_retransmissions_total: p.harqRetxTotal,
    harq_combined_gain_db: Number(p.latestHarqGainDb.toFixed(2)),
    dynamic_guard_efficiency: Number(p.dynamicGuardEfficiency.toFixed(4)),
    dubins_min_turn_radius_m: Number(p.dubinsMinTurnRadiusM.toFixed(1)),
  };
}

export function createDefaultSimulationMetrics(): RunningMetrics {
  return {
    staticGoodputBits: 0,
    tacGoodputBits: 0,
    reactiveGoodputBits: 0,
    staticWastedBits: 0,
    tacWastedBits: 0,
    reactiveWastedBits: 0,
    staticDroppedPkts: 0,
    tacDroppedPkts: 0,
    reactiveDroppedPkts: 0,
    staticEnqueuedPkts: 0,
    tacEnqueuedPkts: 0,
    reactiveEnqueuedPkts: 0,
    node4PreShadowBacklogKb: 0,
    staticNode4PreShadowBacklogKb: 0,
    lastStaticUtilPct: 0,
    lastTacUtilPct: 0,
    lastReactiveUtilPct: 0,
    staticScheduledUlTimeS: 0,
    tacScheduledUlTimeS: 0,
    reactiveScheduledUlTimeS: 0,
    staticAvailableUlTimeS: 0,
    tacAvailableUlTimeS: 0,
    reactiveAvailableUlTimeS: 0,
    staticUnusedUlTimeS: 0,
    tacUnusedUlTimeS: 0,
    reactiveUnusedUlTimeS: 0,
    staticPayloadBitsDequeued: 0,
    tacPayloadBitsDequeued: 0,
    reactivePayloadBitsDequeued: 0,
    staticDelayDropsThisRun: 0,
    tacDelayDropsThisRun: 0,
    reactiveDelayDropsThisRun: 0,
    staticOverflowDropsThisRun: 0,
    tacOverflowDropsThisRun: 0,
    reactiveOverflowDropsThisRun: 0,
    staticFinalBacklogBits: 0,
    tacFinalBacklogBits: 0,
    reactiveFinalBacklogBits: 0,
  };
}

export function createTelemetryFrameOutboundMessage(
  frame: TelemetryFrame,
  biomeParams: {
    biomeId: string;
    enableBiomeEmPhysics: boolean;
    polarizationMode: string;
    liveMeanTwoRayGainDb: number;
    liveMeanFoliageLossDb: number;
    liveMeanDustLossDb: number;
    liveMeanPolLossDb: number;
    weatherCellCount: number;
  }
): WorkerOutboundMessage {
  return {
    type: 'TELEMETRY_FRAME',
    frame,
    static_goodput_mbps: frame.static_goodput_mbps,
    static_util_pct: frame.static_util_pct,
    static_wasted_bits: frame.static_wasted_bits,
    static_delay_drops: frame.static_delay_drops,
    static_overflow_drops: frame.static_overflow_drops,
    static_scheduled_ul_s: frame.static_scheduled_ul_s,
    static_sector_util_pct: frame.static_sector_util_pct,
    tac_goodput_mbps: frame.tac_goodput_mbps,
    tac_util_pct: frame.tac_util_pct,
    tac_wasted_bits: frame.tac_wasted_bits,
    tac_delay_drops: frame.tac_delay_drops,
    tac_overflow_drops: frame.tac_overflow_drops,
    tac_scheduled_ul_s: frame.tac_scheduled_ul_s,
    tac_sector_util_pct: frame.tac_sector_util_pct,
    reactive_goodput_mbps: frame.reactive_goodput_mbps,
    reactive_util_pct: frame.reactive_util_pct,
    reactive_wasted_bits: frame.reactive_wasted_bits,
    reactive_delay_drops: frame.reactive_delay_drops,
    reactive_overflow_drops: frame.reactive_overflow_drops,
    reactive_scheduled_ul_s: frame.reactive_scheduled_ul_s,
    reactive_sector_util_pct: frame.reactive_sector_util_pct,
    dem_lookahead_error_std_m: frame.dem_lookahead_error_std_m,
    traffic_load_multiplier: frame.traffic_load_multiplier,
    jammer_enabled: frame.jammer_enabled,
    jammer_eirp_dbm: frame.jammer_eirp_dbm,
    jammer_pos_enu: frame.jammer_pos_enu,
    jammer_terrain_shield_db: frame.jammer_terrain_shield_db,
    jammer_sector_interference_dbm: frame.jammer_sector_interference_dbm,
    viewshed_sinr_grid: frame.viewshed_sinr_grid,
    relay_advisor: frame.relay_advisor,
    active_relay_enabled: frame.active_relay_enabled,
    relayed_node_count: frame.relayed_node_count,
    relay_backhaul_sector_id: frame.relay_backhaul_sector_id,
    relay_backhaul_snr_db: frame.relay_backhaul_snr_db,
    rician_fading_enabled: frame.rician_fading_enabled,
    cqi_feedback_delay_ms: frame.cqi_feedback_delay_ms,
    biome_id: biomeParams.biomeId as any,
    biome_em_enabled: biomeParams.enableBiomeEmPhysics,
    polarization_mode: biomeParams.polarizationMode as any,
    mean_two_ray_gain_db: biomeParams.liveMeanTwoRayGainDb,
    mean_foliage_loss_db: biomeParams.liveMeanFoliageLossDb,
    mean_dust_loss_db: biomeParams.liveMeanDustLossDb,
    mean_pol_loss_db: biomeParams.liveMeanPolLossDb,
    weather_cell_count: biomeParams.weatherCellCount,
  };
}

/**
 * Pure evaluator for ACM CQI Aging and OLLA margin derivation.
 */
export function evaluateAcmCqiAgingAndOlla(
  ls: LinkStatus,
  currentSinr: number,
  delayedSinr: number,
  delayMs: number,
  channelBandwidthHz: number
): { readonly lsBaseline: LinkStatus; readonly lsTac: LinkStatus; readonly ollaMarginDb: number } {
  const modcodDelayed = LinkBudgetEngine.selectModCod(delayedSinr);
  const isDelayedOutage = ls.obstacleBlocked || modcodDelayed.name === 'LINK_OUTAGE';
  const effDelayed = isDelayedOutage ? 0.0 : modcodDelayed.spectralEfficiencyBpsHz;
  const bpsDelayed = isDelayedOutage ? 0.0 : effDelayed * channelBandwidthHz;
  const isDecodeFailureBaseline = !isDelayedOutage && modcodDelayed.minSnrDb > currentSinr + 0.5;

  const lsBaseline: LinkStatus = {
    ...ls,
    modcodName: isDelayedOutage ? 'LINK_OUTAGE' : modcodDelayed.name,
    spectralEfficiency: effDelayed,
    bitrateBps: bpsDelayed,
    bitrateMbps: bpsDelayed / 1.0e6,
    isOutage: isDelayedOutage,
    cqiDecodeFailure: isDecodeFailureBaseline,
  };

  const kDb = ls.ricianKFactorDb ?? 4.0;
  const kLin = Math.pow(10.0, kDb / 10.0);
  const delayFactor = Math.min(1.0, delayMs / 20.0);
  const ollaMarginDb = (2.5 / Math.sqrt(kLin)) * delayFactor;
  const sinrSafe = delayedSinr - ollaMarginDb;

  const modcodSafe = LinkBudgetEngine.selectModCod(sinrSafe);
  const isSafeOutage = ls.obstacleBlocked || modcodSafe.name === 'LINK_OUTAGE';
  const effSafe = isSafeOutage ? 0.0 : modcodSafe.spectralEfficiencyBpsHz;
  const bpsSafe = isSafeOutage ? 0.0 : effSafe * channelBandwidthHz;
  const isDecodeFailureTac = !isSafeOutage && modcodSafe.minSnrDb > currentSinr + 0.5;

  const lsTac: LinkStatus = {
    ...ls,
    modcodName: isSafeOutage ? 'LINK_OUTAGE' : modcodSafe.name,
    spectralEfficiency: effSafe,
    bitrateBps: bpsSafe,
    bitrateMbps: bpsSafe / 1.0e6,
    isOutage: isSafeOutage,
    cqiDecodeFailure: isDecodeFailureTac,
    ollaMarginDb,
  };

  return { lsBaseline, lsTac, ollaMarginDb };
}

/**
 * Pure evaluator constructing the obstruction state snapshot for command results.
 */
export function buildObstructionStateSnapshot(
  nodes: readonly GroundNodeTrafficSubsystem[],
  obstructionResults: ReadonlyMap<number, TerrainObstruction>,
  linkStatuses: ReadonlyMap<number, LinkStatus>,
  predStates: ReadonlyMap<number, PredictiveState>
): NonNullable<WorkerCommandResult['obstruction_state']> {
  return nodes.map(node => {
    const obstruction = obstructionResults.get(node.nodeId);
    const link = linkStatuses.get(node.nodeId);
    const prediction = predStates.get(node.nodeId);
    return {
      node_id: node.nodeId,
      entity_id: node.entityId,
      creation_sequence: node.creationSequence,
      terrain_is_los: obstruction?.isLos ?? true,
      obstacle_blocked: obstruction?.obstacleBlocked ?? false,
      obstacle_intersections: obstruction?.obstacleIntersections.map(hit => ({ ...hit })) ?? [],
      link_outage: link?.isOutage ?? true,
      bitrate_bps: link?.bitrateBps ?? 0,
      modcod_name: link?.modcodName ?? 'LINK_OUTAGE',
      predicted_state: prediction?.currentState ?? NodeTerrainState.NORMAL_LOS,
      time_to_occlusion_s: prediction?.timeToOcclusionS ?? Number.POSITIVE_INFINITY,
      time_to_emergence_s: prediction?.timeToEmergenceS ?? Number.POSITIVE_INFINITY,
      is_shadowed: node.isShadowed,
      is_coverage_complete: obstruction?.isCoverageComplete ?? true,
      coverage_note: obstruction?.coverageNote,
    };
  });
}

/**
 * Pure evaluator for contested EW Jammer Ingress & Terrain Shielding.
 */
export function computeJammerInterference(params: {
  jammerEnabled: boolean;
  jammerPosEnu: readonly [number, number] | Position3D;
  jammerEirpDbm: number;
  acnPos: Position3D;
  acnVel: Position3D;
  acnAttitude: any;
  terrainEngine: TerrainEngine;
  rfConfig: RFConfig;
  envConfig: EnvironmentConfig;
  antennaEngine: any;
}): {
  readonly jammerShieldLossDb: number;
  readonly jammerSectorInterferenceDbm: readonly [number, number, number, number];
  readonly jammerInterferenceBySector: readonly [number, number, number, number] | undefined;
} {
  if (!params.jammerEnabled) {
    return {
      jammerShieldLossDb: 0.0,
      jammerSectorInterferenceDbm: [-150.0, -150.0, -150.0, -150.0],
      jammerInterferenceBySector: undefined,
    };
  }

  const jX = params.jammerPosEnu[0];
  const jY = params.jammerPosEnu[1];
  const surfaceZ = params.terrainEngine.getElevation(jX, jY);
  const jZ = Number.isFinite(surfaceZ) ? surfaceZ + 3.0 : 3.0;
  const jammerPos: Position3D = [jX, jY, jZ];
  const dJammerM = Math.max(Math.hypot(params.acnPos[0] - jX, params.acnPos[1] - jY, params.acnPos[2] - jZ), 1.0);

  const jammerObs = params.terrainEngine.evaluateTerrainObstruction(
    jammerPos,
    params.acnPos,
    params.rfConfig,
    params.envConfig
  );
  const jammerShieldLossDb = jammerObs.diffractionLossDb ?? 0.0;

  const fsplJ = LinkBudgetEngine.computeFsplDb(dJammerM, params.rfConfig.carrierFrequencyHz, params.rfConfig.speedOfLight);
  const gasJ = LinkBudgetEngine.computeGaseousAttenuationDb(dJammerM, jZ, params.acnPos[2], params.rfConfig.carrierFrequencyHz);
  const rainJ = LinkBudgetEngine.computeRainAttenuationDb(dJammerM, params.envConfig, jZ, params.acnPos[2]);
  const lossJ = fsplJ + jammerShieldLossDb + gasJ + rainJ + params.rfConfig.cableLossDb;

  const jammerSectorEval = params.antennaEngine.evaluateNodeSector(
    -999,
    params.acnPos,
    params.acnVel,
    jammerPos,
    params.rfConfig.acnAntennaGainDbi,
    false,
    params.acnAttitude
  );

  const eirp = params.jammerEirpDbm;
  const jammerInterferenceBySector: readonly [number, number, number, number] = [
    eirp + jammerSectorEval.allSectorGainsDbi[0] - lossJ,
    eirp + jammerSectorEval.allSectorGainsDbi[1] - lossJ,
    eirp + jammerSectorEval.allSectorGainsDbi[2] - lossJ,
    eirp + jammerSectorEval.allSectorGainsDbi[3] - lossJ,
  ];

  return {
    jammerShieldLossDb,
    jammerSectorInterferenceDbm: jammerInterferenceBySector,
    jammerInterferenceBySector,
  };
}

/**
 * Pure evaluator for capturing eviction drop finalization records.
 */
export function captureEvictionFinalizationRecord(params: {
  schedulerId: EvictionSchedulerId;
  scheduler: LegacyStaticScheduler | TerrainAwareDynamicScheduler;
  nodeId: number;
  node: GroundNodeTrafficSubsystem | undefined;
  associatedSimulationFrameIndex: number;
  simulationRunId: number;
  finalizationIndex: number;
  simTimeS: number;
}): EvictionDropFinalizationRecord | null {
  const capture = params.node ? params.scheduler.capturePendingDropsBeforeEviction(params.node) : null;
  const evictResult = params.scheduler.evictNode(params.nodeId, params.node);
  const finalCapture = capture && capture.captured ? capture : evictResult;
  if (!finalCapture || (finalCapture.totalDroppedBytes <= 0 && finalCapture.totalDroppedPkts <= 0)) {
    return null;
  }
  return {
    recordType: 'NODE_EVICTION_FINALIZATION',
    simulationRunId: params.simulationRunId,
    finalizationIndex: params.finalizationIndex,
    schedulerId: params.schedulerId,
    nodeId: params.nodeId,
    timestampS: params.simTimeS,
    associatedSimulationFrameIndex: params.associatedSimulationFrameIndex,
    droppedDelayPkts: finalCapture.droppedDelayPkts,
    droppedOverflowPkts: finalCapture.droppedOverflowPkts,
    totalDroppedPkts: finalCapture.totalDroppedPkts,
    droppedDelayBytes: finalCapture.droppedDelayBytes,
    droppedOverflowBytes: finalCapture.droppedOverflowBytes,
    totalDroppedBytes: finalCapture.totalDroppedBytes,
    reason: 'NODE_DELETE',
  };
}
