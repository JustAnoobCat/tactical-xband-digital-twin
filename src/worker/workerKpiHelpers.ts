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
import { FrameScheduleReport } from '../core/scheduler';
import { NodeTerrainState, PredictiveState } from '../core/trajectory';
import { TerrainObstruction } from '../core/terrain';
import { LinkStatus } from '../core/linkBudget';
import type {
  SchedulerEpochMetrics,
  SuperframeEpochRecord,
  SpatialFrameSnapshot,
  SpatialNodeSnapshot,
  SpatialLinkBudgetSnapshot,
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
