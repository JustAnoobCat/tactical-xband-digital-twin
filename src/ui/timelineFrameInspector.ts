/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Simulation Timeline Frame Inspector & Dual-Scheduler Comparison (SPEC-TIMELINE-ENHANCE-01-REV10)
 *
 * Implements:
 * - Exact half-open physical frame interval association [t_k - 0.020, t_k).
 * - Exact 1D interval union without gap bridging (c <= b merge condition).
 * - Strict duration invariant: coveredDurationMs + uncoveredDurationMs === 20.0 ms.
 * - Tolerance-qualified continuous coverage classification (epsilon = 0.01 ms).
 * - Deterministic communication history status evaluation (Priority 1 through 4).
 * - Origin-straddling frame handling ([t_start, 0) unsimulated pre-origin time).
 * - Dual-scheduler metric comparisons (Goodput, Dequeued Payload Delivery Ratio, Deltas).
 * - Expandable inspector DOM presentation (Option I2).
 */

import type {
  SpatialFrameSnapshot,
  SpatialAcnSnapshot,
  SpatialNodeSnapshot,
  SpatialLinkBudgetSnapshot,
  TimelineCommunicationRecord,
  SuperframeEpochRecord,
  SuperframeDiscontinuityRecord,
  SchedulerEpochMetrics,
  EvictionDropFinalizationRecord,
} from '../shared/workerProtocol';
import type { SpatialSnapshotBuffer } from './spatialSnapshotBuffer';
import type { EvictionHistoryMetadata, SuperframeEpochStore } from './superframeEpochStore';

export interface TimelineInspectorVisibilityState {
  readonly isExpanded: boolean;
  readonly isHistoricalMode: boolean;
  readonly expandedBeforeHistorical: boolean;
  readonly manuallyCollapsedInHistorical: boolean;
}

export function createInitialTimelineInspectorVisibility(): TimelineInspectorVisibilityState {
  return {
    isExpanded: false,
    isHistoricalMode: false,
    expandedBeforeHistorical: false,
    manuallyCollapsedInHistorical: false,
  };
}

export function transitionTimelineInspectorStatus(
  state: TimelineInspectorVisibilityState,
  isLive: boolean
): TimelineInspectorVisibilityState {
  if (!isLive && !state.isHistoricalMode) {
    // Live -> Historical edge: capture pre-historical state and auto-expand
    return {
      isExpanded: true,
      isHistoricalMode: true,
      expandedBeforeHistorical: state.isExpanded,
      manuallyCollapsedInHistorical: false,
    };
  }
  if (!isLive && state.isHistoricalMode) {
    // Remaining inside historical mode: preserve manual collapse/expand choice
    return state;
  }
  if (isLive && state.isHistoricalMode) {
    // Historical -> Live edge: restore pre-historical expansion state
    return {
      isExpanded: state.expandedBeforeHistorical,
      isHistoricalMode: false,
      expandedBeforeHistorical: state.expandedBeforeHistorical,
      manuallyCollapsedInHistorical: false,
    };
  }
  return state;
}

export function toggleTimelineInspectorManual(
  state: TimelineInspectorVisibilityState
): TimelineInspectorVisibilityState {
  const nextExpanded = !state.isExpanded;
  return {
    ...state,
    isExpanded: nextExpanded,
    manuallyCollapsedInHistorical: state.isHistoricalMode
      ? !nextExpanded
      : state.manuallyCollapsedInHistorical,
  };
}

export function resetTimelineInspectorVisibility(): TimelineInspectorVisibilityState {
  return createInitialTimelineInspectorVisibility();
}

export type EpochOverlapRelationship =
  | 'EXACT_1_TO_1'                        // Exactly 1 epoch: [t_s, t_e) == [t_k - 0.020, t_k)
  | 'SUB_FRAME_CONTINUOUS_COVERAGE'       // 2+ epochs fully and continuously cover [t_k - 0.020, t_k)
  | 'SUB_FRAME_PARTIAL_OR_DISCONTINUOUS'  // 2+ epochs with internal gap, overlap, or boundary mismatch
  | 'SPANNING_PARTIAL'                    // 1 epoch spanning multiple frames: t_s <= t_k - 0.020 && t_e >= t_k
  | 'BOUNDARY_PARTIAL'                    // Fractional boundary overlap (e.g. residual epoch from reset)
  | 'NO_EPOCHS';                          // Zero epoch records overlap this frame

export type CommunicationHistoryStatus =
  | 'AVAILABLE'
  | 'HISTORY_EVICTED'
  | 'IN_FLIGHT_PENDING'
  | 'PRE_SIMULATION'
  | 'RECORD_ABSENT';

export interface SchedulerMetricComparison {
  readonly goodputBps: number;
  readonly dequeuedPayloadDeliveryRatioPct: number | null; // null if dequeuedBits === 0
  readonly transmittedNonOutageBits: number;
  readonly outageWastedBits: number;
  readonly totalPayloadBitsDequeued: number;
  readonly droppedPkts: number;
  readonly droppedBytes: number | null;
  readonly endQueueDepthPkts?: number;
  readonly endBacklogBytes?: number;
  readonly meanHeadOfLineSojournMs?: number | null;
}

export interface SchedulerComparisonSummary {
  readonly static: SchedulerMetricComparison;
  readonly tac: SchedulerMetricComparison;
  readonly deltas: {
    readonly deltaTxBits: number;
    readonly deltaDeliveredBytes: number;
    readonly deltaWastedBits: number;
    readonly deltaWastedBytes: number;
    readonly deltaDroppedPkts: number;
    readonly deltaGoodputBps: number;
    readonly deltaGoodputRelPct: number | null;
    readonly deltaRatioPctPoints: number | null;
  };
}

export interface FrameInspectorPayload {
  readonly frameIndex: number;
  readonly simulationTimeS: number; // Exclusive end timestamp
  readonly wallClockTimeMs: number;
  readonly frameInterval: {
    readonly startTimeS: number;    // t_k - 0.020
    readonly endTimeS: number;      // t_k
    readonly durationMs: number;    // 20.0
  };

  // Spatial Kinematics (ACN)
  readonly acn: SpatialAcnSnapshot;

  // Ground Nodes (Full Matrix)
  readonly nodes: readonly SpatialNodeSnapshot[];

  // Selected Node Link Budget (with restored atmospheric losses)
  readonly selectedNodeId: number | null;
  readonly selectedLinkBudget: (SpatialLinkBudgetSnapshot & {
    readonly gasLossDb: number;
    readonly rainLossDb: number;
  }) | null;

  // Communication Mapping: Segregated collections & verified relationship
  readonly epochRelationship: EpochOverlapRelationship;
  readonly communicationHistoryStatus: CommunicationHistoryStatus;
  readonly coveredDurationMs: number;
  readonly uncoveredDurationMs: number;
  readonly hasReconfigurationDiscontinuity: boolean;

  readonly overlappingRecords: readonly TimelineCommunicationRecord[];
  readonly epochs: readonly SuperframeEpochRecord[];
  readonly discontinuities: readonly SuperframeDiscontinuityRecord[];
  readonly evictionFinalizations: readonly EvictionDropFinalizationRecord[];
  readonly evictedFinalizationHistoryMayBeTruncated: boolean;
  readonly evictionHistoryMetadata: EvictionHistoryMetadata;

  // Scheduler Comparison Summary
  readonly comparison: SchedulerComparisonSummary | null;

  // Diagnostics & Quality Flags
  readonly semanticWarning?: string;
}

const EMPTY_EVICTION_METADATA: EvictionHistoryMetadata = {
  evictionCapacity: 0,
  retainedCount: 0,
  totalEvictionRecordsSeen: 0,
  discardedEvictionCount: 0,
  evictedByCapacityCount: 0,
  evictedByHorizonCount: 0,
  hasEvictedFinalizationHistory: false,
  oldestRetainedTimestampS: null,
  newestRetainedTimestampS: null,
  oldestRetainedFrameIndex: null,
  newestRetainedFrameIndex: null,
  minDiscardedTimestampS: null,
  maxDiscardedTimestampS: null,
  minDiscardedFrameIndex: null,
  maxDiscardedFrameIndex: null,
  minRetainedFinalizationIndex: null,
  maxRetainedFinalizationIndex: null,
  evictionFloorIndex: 0,
};

export const EPSILON_TIME_S = 1e-5; // 0.01 ms unified tolerance threshold

/**
 * Pure function: Evaluates communication history status per Section B.5 precedence rules.
 */
export function determineCommunicationHistoryStatus(params: {
  readonly frameStartS: number;
  readonly frameEndS: number;
  readonly oldestEpochStartTimeS: number | null;
  readonly newestEpochEndTimeS: number | null;
  readonly isSimRunning: boolean;
  readonly currentSimTimeS: number;
  readonly tdmaAccumulatorS?: number;
}): CommunicationHistoryStatus {
  // 1. PRE_SIMULATION: Entire frame interval ends at or before simulation origin
  if (params.frameEndS <= 0.0) return 'PRE_SIMULATION';

  // 2. HISTORY_EVICTED: Retained epoch history has moved past this frame
  if (params.oldestEpochStartTimeS !== null && params.frameEndS <= params.oldestEpochStartTimeS) {
    return 'HISTORY_EVICTED';
  }

  // 3. IN_FLIGHT_PENDING: Strictly requires an ACTIVE running simulation,
  // authoritative clock having reached or passed frame start (never future lookahead),
  // and affirmative in-flight evidence.
  if (
    params.isSimRunning &&
    params.newestEpochEndTimeS !== null &&
    params.frameStartS >= params.newestEpochEndTimeS &&
    params.currentSimTimeS >= params.frameStartS
  ) {
    const hasAccumulator = (params.tdmaAccumulatorS ?? 0) > 0.0;
    const isClockWithinEpochWindow =
      (params.currentSimTimeS - params.newestEpochEndTimeS) <= 0.050;

    if (hasAccumulator || isClockWithinEpochWindow) {
      return 'IN_FLIGHT_PENDING';
    }
  }

  // 4. RECORD_ABSENT: Deterministic fallback (paused/stopped, future lookahead, sequence gaps, empty epoch store at t > 0)
  return 'RECORD_ABSENT';
}

/**
 * Pure function: Computes exact 1D interval union over clipped post-origin epoch intervals.
 * Zero bridging rule: Gaps smaller than epsilon are never merged into covered duration.
 * Strictly enforces coveredDurationMs + uncoveredDurationMs === 20.0 ms.
 */
export function compute1DIntervalUnion(params: {
  readonly frameStartS: number;
  readonly frameEndS: number;
  readonly epochs: readonly SuperframeEpochRecord[];
}): {
  readonly coveredDurationMs: number;
  readonly uncoveredDurationMs: number;
  readonly relationship: EpochOverlapRelationship;
  readonly disjointSegments: readonly [number, number][];
  readonly warnings?: string;
} {
  const { frameStartS, frameEndS, epochs } = params;
  const frameDurationMs = 20.0;

  if (!epochs || epochs.length === 0) {
    return {
      coveredDurationMs: 0.0,
      uncoveredDurationMs: frameDurationMs,
      relationship: 'NO_EPOCHS',
      disjointSegments: [],
    };
  }

  // Handle origin-straddling frame (t_start < 0 < t_end)
  const isOriginStraddling = frameStartS < 0.0 && frameEndS > 0.0;
  const validDomainStartS = Math.max(frameStartS, 0.0);

  // 1. Clip epoch intervals to valid frame domain
  const clipped: [number, number][] = [];
  for (let i = 0; i < epochs.length; i++) {
    const e = epochs[i];
    const a = Math.max(e.startTimeS, validDomainStartS);
    const b = Math.min(e.endTimeS, frameEndS);
    if (a < b) {
      clipped.push([a, b]);
    }
  }

  if (clipped.length === 0) {
    return {
      coveredDurationMs: 0.0,
      uncoveredDurationMs: frameDurationMs,
      relationship: isOriginStraddling ? 'BOUNDARY_PARTIAL' : 'NO_EPOCHS',
      disjointSegments: [],
    };
  }

  // Sort ascending by start time
  clipped.sort((x, y) => x[0] - y[0]);

  // 2. Exact 1D Interval Union (U = union I_e) with c <= b merge condition (no gap bridging)
  const segments: [number, number][] = [[clipped[0][0], clipped[0][1]]];
  for (let j = 1; j < clipped.length; j++) {
    const [aj, bj] = clipped[j];
    const last = segments[segments.length - 1];
    if (aj <= last[1]) {
      last[1] = Math.max(last[1], bj);
    } else {
      segments.push([aj, bj]);
    }
  }

  // 3. Exact Duration Computation
  let totalCoveredS = 0.0;
  for (let k = 0; k < segments.length; k++) {
    totalCoveredS += (segments[k][1] - segments[k][0]);
  }

  // Clamp within [0, 20.0 ms] and preserve exactness
  const coveredDurationMs = Math.max(0.0, Math.min(20.0, totalCoveredS * 1000.0));
  const uncoveredDurationMs = 20.0 - coveredDurationMs;

  let warnings: string | undefined;

  // 4. Classification
  let relationship: EpochOverlapRelationship;

  if (isOriginStraddling) {
    const preOriginMs = (0.0 - frameStartS) * 1000.0;
    warnings = `Origin-Straddling Frame: ${preOriginMs.toFixed(3)} ms precedes simulation origin (t < 0.0 s unsimulated). Covered duration ${coveredDurationMs.toFixed(3)} ms, Uncovered duration ${uncoveredDurationMs.toFixed(3)} ms.`;
    relationship = epochs.length >= 2 ? 'SUB_FRAME_PARTIAL_OR_DISCONTINUOUS' : 'BOUNDARY_PARTIAL';
    return {
      coveredDurationMs,
      uncoveredDurationMs,
      relationship,
      disjointSegments: segments,
      warnings,
    };
  }

  if (epochs.length === 1) {
    const e = epochs[0];
    const startMatch = Math.abs(e.startTimeS - frameStartS) <= EPSILON_TIME_S;
    const endMatch = Math.abs(e.endTimeS - frameEndS) <= EPSILON_TIME_S;

    if (startMatch && endMatch) {
      relationship = 'EXACT_1_TO_1';
    } else if (
      e.startTimeS <= frameStartS + EPSILON_TIME_S &&
      e.endTimeS >= frameEndS - EPSILON_TIME_S &&
      e.durationMs > 20.0 + EPSILON_TIME_S * 1000.0
    ) {
      relationship = 'SPANNING_PARTIAL';
      const range = e.coveredFrameRange ? `[${e.coveredFrameRange[0]}, ${e.coveredFrameRange[1]}]` : 'multi-frame';
      warnings = `Spanning Multi-Frame Epoch (${e.durationMs.toFixed(1)} ms, frames ${range}): metrics reflect entire superframe, not frame-local interval.`;
    } else {
      relationship = 'BOUNDARY_PARTIAL';
    }
  } else {
    // 2+ Epochs
    // Check tolerance criteria:
    // a) Uncovered tolerance: uncoveredDurationMs <= 0.01 ms
    const isUncoveredWithinTol = uncoveredDurationMs <= EPSILON_TIME_S * 1000.0;

    // b) Internal gap tolerance: for all adjacent segments, gap <= EPSILON_TIME_S
    let internalGapsOk = true;
    for (let s = 0; s < segments.length - 1; s++) {
      const gapS = segments[s + 1][0] - segments[s][1];
      if (gapS > EPSILON_TIME_S) {
        internalGapsOk = false;
        break;
      }
    }

    // c) Boundary gap tolerance
    const startGapS = segments[0][0] - validDomainStartS;
    const endGapS = frameEndS - segments[segments.length - 1][1];
    const boundaryGapsOk = startGapS <= EPSILON_TIME_S && endGapS <= EPSILON_TIME_S;

    // d) No severe input epoch overlaps
    let overlapsOk = true;
    for (let p = 0; p < epochs.length - 1; p++) {
      if (epochs[p].endTimeS > epochs[p + 1].startTimeS + EPSILON_TIME_S) {
        overlapsOk = false;
        break;
      }
    }

    if (isUncoveredWithinTol && internalGapsOk && boundaryGapsOk && overlapsOk) {
      relationship = 'SUB_FRAME_CONTINUOUS_COVERAGE';
    } else {
      relationship = 'SUB_FRAME_PARTIAL_OR_DISCONTINUOUS';
      warnings = `Partial Sub-Frame Coverage: Covered ${coveredDurationMs.toFixed(3)} ms, Uncovered ${uncoveredDurationMs.toFixed(3)} ms. Metrics reflect individual sub-epochs; frame-local total is not fabricated.`;
    }
  }

  return {
    coveredDurationMs,
    uncoveredDurationMs,
    relationship,
    disjointSegments: segments,
    warnings,
  };
}

/**
 * Pure function: Computes comparative scheduler metrics & deltas.
 */
export function computeSchedulerComparison(params: {
  readonly staticMetrics: SchedulerEpochMetrics;
  readonly tacMetrics: SchedulerEpochMetrics;
  readonly durationS: number;
}): SchedulerComparisonSummary {
  const { staticMetrics, tacMetrics, durationS } = params;

  function calcMetric(m: SchedulerEpochMetrics): SchedulerMetricComparison {
    const goodputBps = durationS > 0 ? m.transmittedNonOutageBits / durationS : 0;
    const dequeuedPayloadDeliveryRatioPct =
      m.totalPayloadBitsDequeued > 0
        ? (m.transmittedNonOutageBits / m.totalPayloadBitsDequeued) * 100.0
        : null;

    return {
      goodputBps,
      dequeuedPayloadDeliveryRatioPct,
      transmittedNonOutageBits: m.transmittedNonOutageBits,
      outageWastedBits: m.outageWastedBits,
      totalPayloadBitsDequeued: m.totalPayloadBitsDequeued,
      droppedPkts: m.totalDroppedPkts,
      droppedBytes: m.totalDroppedBytes,
      endQueueDepthPkts: m.endQueueDepthPkts,
      endBacklogBytes: m.endBacklogBytes,
      meanHeadOfLineSojournMs: m.meanHeadOfLineSojournMs,
    };
  }

  const staticComp = calcMetric(staticMetrics);
  const tacComp = calcMetric(tacMetrics);

  const deltaTxBits = tacComp.transmittedNonOutageBits - staticComp.transmittedNonOutageBits;
  const deltaDeliveredBytes = deltaTxBits / 8.0;
  const deltaWastedBits = tacComp.outageWastedBits - staticComp.outageWastedBits;
  const deltaWastedBytes = deltaWastedBits / 8.0;
  const deltaDroppedPkts = tacComp.droppedPkts - staticComp.droppedPkts;
  const deltaGoodputBps = tacComp.goodputBps - staticComp.goodputBps;

  const deltaGoodputRelPct =
    staticComp.transmittedNonOutageBits > 0
      ? (deltaTxBits / staticComp.transmittedNonOutageBits) * 100.0
      : null;

  const deltaRatioPctPoints =
    tacComp.dequeuedPayloadDeliveryRatioPct !== null &&
    staticComp.dequeuedPayloadDeliveryRatioPct !== null
      ? tacComp.dequeuedPayloadDeliveryRatioPct - staticComp.dequeuedPayloadDeliveryRatioPct
      : null;

  return {
    static: staticComp,
    tac: tacComp,
    deltas: {
      deltaTxBits,
      deltaDeliveredBytes,
      deltaWastedBits,
      deltaWastedBytes,
      deltaDroppedPkts,
      deltaGoodputBps,
      deltaGoodputRelPct,
      deltaRatioPctPoints,
    },
  };
}

/**
 * Inspects a spatial frame by frameIndex and builds the complete FrameInspectorPayload.
 */
export function inspectTimelineFrame(params: {
  readonly frameIndex: number;
  readonly spatialBuffer: SpatialSnapshotBuffer;
  readonly epochStore: SuperframeEpochStore;
  readonly isSimRunning: boolean;
  readonly currentSimTimeS: number;
  readonly tdmaAccumulatorS?: number;
  readonly selectedNodeId?: number | null;
}): FrameInspectorPayload | null {
  const {
    frameIndex,
    spatialBuffer,
    epochStore,
    isSimRunning,
    currentSimTimeS,
    tdmaAccumulatorS,
    selectedNodeId,
  } = params;

  const snap = spatialBuffer.findSnapshotByFrameIndex(frameIndex);
  if (!snap) return null;

  // In simWorker, simulationTimeS is exclusive end time
  const frameEndS = snap.simulationTimeS;
  const frameStartS = frameEndS - 0.020;

  // Segregate communication records
  const allRecords = epochStore.getRecordsInRange(frameStartS, frameEndS);
  const epochs: SuperframeEpochRecord[] = [];
  const discontinuities: SuperframeDiscontinuityRecord[] = [];

  for (let i = 0; i < allRecords.length; i++) {
    const r = allRecords[i];
    if (r.recordType === 'EPOCH') {
      epochs.push(r as SuperframeEpochRecord);
    } else if (r.recordType === 'DISCONTINUITY') {
      discontinuities.push(r as SuperframeDiscontinuityRecord);
    }
  }

  // Segregated point eviction finalizations associated with this simulation frame
  const evictionFinalizations =
    typeof epochStore.getEvictionFinalizationsForFrame === 'function'
      ? epochStore.getEvictionFinalizationsForFrame(frameIndex)
      : [];

  const oldestEpoch = epochStore.oldestRecord?.recordType === 'EPOCH'
    ? (epochStore.oldestRecord as SuperframeEpochRecord)
    : null;
  const newestEpoch = epochStore.newestRecord?.recordType === 'EPOCH'
    ? (epochStore.newestRecord as SuperframeEpochRecord)
    : null;

  const unionResult = compute1DIntervalUnion({
    frameStartS,
    frameEndS,
    epochs,
  });

  const commStatus = epochs.length > 0
    ? 'AVAILABLE'
    : determineCommunicationHistoryStatus({
        frameStartS,
        frameEndS,
        oldestEpochStartTimeS: oldestEpoch ? oldestEpoch.startTimeS : null,
        newestEpochEndTimeS: newestEpoch ? newestEpoch.endTimeS : null,
        isSimRunning,
        currentSimTimeS,
        tdmaAccumulatorS,
      });

  const evictionHistoryMetadata =
    typeof epochStore.getEvictionHistoryMetadata === 'function'
      ? epochStore.getEvictionHistoryMetadata()
      : EMPTY_EVICTION_METADATA;
  const evictedFinalizationHistoryMayBeTruncated =
    evictionHistoryMetadata.discardedEvictionCount > 0 &&
    ((evictionHistoryMetadata.minDiscardedFrameIndex !== null &&
      evictionHistoryMetadata.maxDiscardedFrameIndex !== null &&
      frameIndex >= evictionHistoryMetadata.minDiscardedFrameIndex &&
      frameIndex <= evictionHistoryMetadata.maxDiscardedFrameIndex) ||
      commStatus === 'HISTORY_EVICTED');

  // Calculate scheduler comparison summary if epochs exist
  let comparison: SchedulerComparisonSummary | null = null;
  if (epochs.length === 1) {
    const ep = epochs[0];
    comparison = computeSchedulerComparison({
      staticMetrics: ep.staticMetrics,
      tacMetrics: ep.tacMetrics,
      durationS: ep.durationMs / 1000.0,
    });
  } else if (epochs.length >= 2 && unionResult.relationship === 'SUB_FRAME_CONTINUOUS_COVERAGE') {
    // Sum aggregates across sub-frame epochs
    let staticTx = 0, staticWasted = 0, staticDequeued = 0, staticDrops = 0;
    let tacTx = 0, tacWasted = 0, tacDequeued = 0, tacDrops = 0;

    for (let e = 0; e < epochs.length; e++) {
      const ep = epochs[e];
      staticTx += ep.staticMetrics.transmittedNonOutageBits;
      staticWasted += ep.staticMetrics.outageWastedBits;
      staticDequeued += ep.staticMetrics.totalPayloadBitsDequeued;
      staticDrops += ep.staticMetrics.totalDroppedPkts;

      tacTx += ep.tacMetrics.transmittedNonOutageBits;
      tacWasted += ep.tacMetrics.outageWastedBits;
      tacDequeued += ep.tacMetrics.totalPayloadBitsDequeued;
      tacDrops += ep.tacMetrics.totalDroppedPkts;
    }

    const lastEp = epochs[epochs.length - 1];
    comparison = computeSchedulerComparison({
      staticMetrics: {
        transmittedNonOutageBits: staticTx,
        outageWastedBits: staticWasted,
        totalPayloadBitsDequeued: staticDequeued,
        droppedDelayPkts: 0,
        droppedOverflowPkts: 0,
        totalDroppedPkts: staticDrops,
        droppedDelayBytes: null,
        droppedOverflowBytes: null,
        totalDroppedBytes: null,
        ulUtilizationPct: lastEp.staticMetrics.ulUtilizationPct,
        endQueueDepthPkts: lastEp.staticMetrics.endQueueDepthPkts,
        endBacklogBytes: lastEp.staticMetrics.endBacklogBytes,
        meanHeadOfLineSojournMs: lastEp.staticMetrics.meanHeadOfLineSojournMs,
      },
      tacMetrics: {
        transmittedNonOutageBits: tacTx,
        outageWastedBits: tacWasted,
        totalPayloadBitsDequeued: tacDequeued,
        droppedDelayPkts: 0,
        droppedOverflowPkts: 0,
        totalDroppedPkts: tacDrops,
        droppedDelayBytes: null,
        droppedOverflowBytes: null,
        totalDroppedBytes: null,
        ulUtilizationPct: lastEp.tacMetrics.ulUtilizationPct,
        endQueueDepthPkts: lastEp.tacMetrics.endQueueDepthPkts,
        endBacklogBytes: lastEp.tacMetrics.endBacklogBytes,
        meanHeadOfLineSojournMs: lastEp.tacMetrics.meanHeadOfLineSojournMs,
      },
      durationS: unionResult.coveredDurationMs / 1000.0,
    });
  }

  // Restored selected link budget with atmospheric losses
  let restoredSelectedLinkBudget: (SpatialLinkBudgetSnapshot & {
    readonly gasLossDb: number;
    readonly rainLossDb: number;
  }) | null = null;

  if (snap.selectedLinkBudget) {
    const lb = snap.selectedLinkBudget;
    restoredSelectedLinkBudget = {
      ...lb,
      gasLossDb: lb.gasLossDb ?? 0.0,
      rainLossDb: lb.rainLossDb ?? 0.0,
    };
  }

  return {
    frameIndex,
    simulationTimeS: frameEndS,
    wallClockTimeMs: snap.wallClockTimeMs,
    frameInterval: {
      startTimeS: frameStartS,
      endTimeS: frameEndS,
      durationMs: 20.0,
    },
    acn: snap.acn,
    nodes: snap.nodes,
    selectedNodeId: selectedNodeId ?? null,
    selectedLinkBudget: restoredSelectedLinkBudget,
    epochRelationship: unionResult.relationship,
    communicationHistoryStatus: commStatus,
    coveredDurationMs: unionResult.coveredDurationMs,
    uncoveredDurationMs: unionResult.uncoveredDurationMs,
    hasReconfigurationDiscontinuity: discontinuities.length > 0,
    overlappingRecords: allRecords,
    epochs,
    discontinuities,
    evictionFinalizations,
    evictedFinalizationHistoryMayBeTruncated,
    evictionHistoryMetadata,
    comparison,
    semanticWarning: unionResult.warnings,
  };
}

/**
 * Renders Frame Inspector DOM into a host container.
 */
export function renderFrameInspectorDom(
  payload: FrameInspectorPayload | null,
  container: HTMLElement,
  options?: {
    readonly isExpanded?: boolean;
    readonly onExpandToggle?: () => void;
  }
): void {
  if (!container) return;

  if (!payload) {
    container.innerHTML = `
      <div class="timeline-inspector-empty muted">
        Select a frame on the timeline to inspect spatial kinematics and communication epoch metrics.
      </div>
    `;
    return;
  }

  const {
    frameIndex,
    simulationTimeS,
    frameInterval,
    acn,
    selectedLinkBudget,
    epochRelationship,
    communicationHistoryStatus,
    coveredDurationMs,
    uncoveredDurationMs,
    hasReconfigurationDiscontinuity,
    evictionFinalizations,
    evictedFinalizationHistoryMayBeTruncated,
    evictionHistoryMetadata,
    comparison,
    semanticWarning,
  } = payload;

  const isExpanded = options?.isExpanded ?? false;

  // Format Status Badge
  let statusBadgeClass = 'badge-muted';
  let statusBadgeText: string = communicationHistoryStatus;
  if (communicationHistoryStatus === 'AVAILABLE') {
    statusBadgeClass = 'badge-sage';
    statusBadgeText = epochRelationship === 'EXACT_1_TO_1' ? 'EXACT 1:1' : epochRelationship.replace(/_/g, ' ');
  } else if (communicationHistoryStatus === 'IN_FLIGHT_PENDING') {
    statusBadgeClass = 'badge-sage-subtle';
    statusBadgeText = 'IN-FLIGHT / PENDING';
  } else if (communicationHistoryStatus === 'HISTORY_EVICTED') {
    statusBadgeClass = 'badge-ochre';
    statusBadgeText = 'COMM HISTORY EVICTED';
  } else if (communicationHistoryStatus === 'PRE_SIMULATION') {
    statusBadgeClass = 'badge-muted';
    statusBadgeText = 'PRE-SIMULATION';
  }

  let html = `
    <div class="timeline-inspector-header">
      <div class="inspector-title">
        <span class="inspector-frame-pill">FRAME #${frameIndex}</span>
        <span class="inspector-time">[${frameInterval.startTimeS.toFixed(3)}s – ${frameInterval.endTimeS.toFixed(3)}s)</span>
        <span class="inspector-status-badge ${statusBadgeClass}">${statusBadgeText}</span>
        ${hasReconfigurationDiscontinuity ? '<span class="badge-gold">RECONFIG DISCONTINUITY</span>' : ''}
      </div>
      <div class="inspector-actions">
        <button id="btn-toggle-expand-inspector" class="btn-tool-secondary" style="font-size: 10px; padding: 2px 8px;">
          ${isExpanded ? 'Collapse Inspector ⤓' : 'Expand Inspector ⤢'}
        </button>
      </div>
    </div>
  `;

  if (semanticWarning) {
    html += `<div class="inspector-warning-banner">${semanticWarning}</div>`;
  }

  if (evictedFinalizationHistoryMayBeTruncated) {
    const minT = evictionHistoryMetadata.minDiscardedTimestampS != null
      ? `${evictionHistoryMetadata.minDiscardedTimestampS.toFixed(3)}s`
      : '—';
    const maxT = evictionHistoryMetadata.maxDiscardedTimestampS != null
      ? `${evictionHistoryMetadata.maxDiscardedTimestampS.toFixed(3)}s`
      : '—';
    html += `<div class="inspector-warning-banner inspector-eviction-truncation-notice">Node-eviction drop finalization history may be truncated near this frame (${evictionHistoryMetadata.discardedEvictionCount} pruned record(s) observed across [${minT}, ${maxT}]).</div>`;
  }

  // Spatial Kinematics Row
  const altM = Math.round(acn.altitudeMslM);
  const spdKmh = Math.round(Math.hypot(acn.velX, acn.velY) * 3.6);
  const hdgDeg = Math.round((acn.headingRad * 180) / Math.PI);

  html += `
    <div class="inspector-grid-row">
      <div class="inspector-stat-group">
        <span class="stat-label">ACN Position</span>
        <span class="stat-val">${Math.round(acn.posX)}, ${Math.round(acn.posY)}, ${altM}m</span>
      </div>
      <div class="inspector-stat-group">
        <span class="stat-label">Kinematics</span>
        <span class="stat-val">${spdKmh} km/h · ${hdgDeg}° hdg · ${acn.pitchDeg.toFixed(1)}° pitch</span>
      </div>
      <div class="inspector-stat-group">
        <span class="stat-label">Coverage</span>
        <span class="stat-val">${acn.coverageRadiusKm.toFixed(1)} km · ${payload.nodes.length} nodes</span>
      </div>
      ${
        selectedLinkBudget
          ? `
      <div class="inspector-stat-group">
        <span class="stat-label">Selected Link</span>
        <span class="stat-val">${selectedLinkBudget.snrDb.toFixed(1)} dB · ${selectedLinkBudget.modcodName} · Gas: ${selectedLinkBudget.gasLossDb.toFixed(2)}dB · Rain: ${selectedLinkBudget.rainLossDb.toFixed(2)}dB</span>
      </div>
      `
          : ''
      }
    </div>
  `;

  // Scheduler Comparison Table (Option I2)
  if (comparison) {
    const s = comparison.static;
    const t = comparison.tac;
    const d = comparison.deltas;

    const sRatio = s.dequeuedPayloadDeliveryRatioPct !== null ? `${s.dequeuedPayloadDeliveryRatioPct.toFixed(1)}%` : '—';
    const tRatio = t.dequeuedPayloadDeliveryRatioPct !== null ? `${t.dequeuedPayloadDeliveryRatioPct.toFixed(1)}%` : '—';
    const dRatio = d.deltaRatioPctPoints !== null ? `${d.deltaRatioPctPoints >= 0 ? '+' : ''}${d.deltaRatioPctPoints.toFixed(1)}% pts` : '—';

    const sGoodput = (s.goodputBps / 1e6).toFixed(2);
    const tGoodput = (t.goodputBps / 1e6).toFixed(2);
    const dGoodput = (d.deltaGoodputBps / 1e6).toFixed(2);
    const dGoodputRel = d.deltaGoodputRelPct !== null ? `(${d.deltaGoodputRelPct >= 0 ? '+' : ''}${d.deltaGoodputRelPct.toFixed(1)}%)` : '';

    html += `
      <table class="inspector-comparison-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Static TDMA</th>
            <th>Tac-TAD</th>
            <th>Advantage / Delta</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Goodput</td>
            <td>${sGoodput} Mbps</td>
            <td>${tGoodput} Mbps</td>
            <td class="${d.deltaGoodputBps >= 0 ? 'text-sage' : 'text-crimson'}">${d.deltaGoodputBps >= 0 ? '+' : ''}${dGoodput} Mbps ${dGoodputRel}</td>
          </tr>
          <tr>
            <td>Dequeued Delivery Ratio</td>
            <td>${sRatio}</td>
            <td>${tRatio}</td>
            <td class="${(d.deltaRatioPctPoints ?? 0) >= 0 ? 'text-sage' : 'text-crimson'}">${dRatio}</td>
          </tr>
          <tr>
            <td>Delivered Payload</td>
            <td>${(s.transmittedNonOutageBits / 8).toLocaleString()} B</td>
            <td>${(t.transmittedNonOutageBits / 8).toLocaleString()} B</td>
            <td class="${d.deltaTxBits >= 0 ? 'text-sage' : 'text-crimson'}">${d.deltaTxBits >= 0 ? '+' : ''}${d.deltaDeliveredBytes.toLocaleString()} B</td>
          </tr>
          <tr>
            <td>Outage Wasted Bits</td>
            <td>${s.outageWastedBits.toLocaleString()} b</td>
            <td>${t.outageWastedBits.toLocaleString()} b</td>
            <td class="${d.deltaWastedBits <= 0 ? 'text-sage' : 'text-crimson'}">${d.deltaWastedBits <= 0 ? '' : '+'}${d.deltaWastedBytes.toLocaleString()} B</td>
          </tr>
          <tr>
            <td>Dropped Packets</td>
            <td>${s.droppedPkts} pkts</td>
            <td>${t.droppedPkts} pkts</td>
            <td class="${d.deltaDroppedPkts <= 0 ? 'text-sage' : 'text-crimson'}">${d.deltaDroppedPkts <= 0 ? '' : '+'}${d.deltaDroppedPkts} pkts</td>
          </tr>
          <tr>
            <td>Queue Depth / Backlog</td>
            <td>${s.endQueueDepthPkts ?? '—'} pkts / ${s.endBacklogBytes != null ? (s.endBacklogBytes / 1024).toFixed(1) + ' KB' : '—'}</td>
            <td>${t.endQueueDepthPkts ?? '—'} pkts / ${t.endBacklogBytes != null ? (t.endBacklogBytes / 1024).toFixed(1) + ' KB' : '—'}</td>
            <td>HOL Sojourn: Static ${s.meanHeadOfLineSojournMs != null ? s.meanHeadOfLineSojournMs.toFixed(1) + 'ms' : '—'} vs Tac ${t.meanHeadOfLineSojournMs != null ? t.meanHeadOfLineSojournMs.toFixed(1) + 'ms' : '—'}</td>
          </tr>
        </tbody>
      </table>
    `;
  } else {
    html += `
      <div class="inspector-status-notice muted">
        ${
          communicationHistoryStatus === 'IN_FLIGHT_PENDING'
            ? 'Current TDMA superframe is actively in-flight. Metrics will populate upon epoch completion.'
            : communicationHistoryStatus === 'HISTORY_EVICTED'
            ? 'Communication epoch history for this time has been evicted from the rolling 6,000-record buffer.'
            : communicationHistoryStatus === 'PRE_SIMULATION'
            ? 'Simulation origin: frame interval ends at or before t = 0.0 s.'
            : 'No communication epoch recorded for this interval.'
        }
      </div>
    `;
  }

  if (evictionFinalizations.length > 0) {
    html += '<div class="inspector-eviction-finalizations">';
    html += '<div class="stat-label" style="margin-top:6px;">Synchronous Node-Delete Drop Finalizations</div>';
    for (let i = 0; i < evictionFinalizations.length; i++) {
      const ev = evictionFinalizations[i];
      html += `<div class="inspector-eviction-row muted">${ev.schedulerId} · Node ${ev.nodeId} · ${ev.totalDroppedPkts} pkts (${ev.totalDroppedBytes} B: delay ${ev.droppedDelayBytes} B / overflow ${ev.droppedOverflowBytes} B) @ t=${ev.timestampS.toFixed(4)}s</div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;

  // Bind expand toggle button
  const btnToggle = container.querySelector('#btn-toggle-expand-inspector');
  if (btnToggle && options?.onExpandToggle) {
    btnToggle.addEventListener('click', () => {
      options.onExpandToggle?.();
    });
  }
}
