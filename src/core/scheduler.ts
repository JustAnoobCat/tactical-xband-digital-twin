/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Dual-Scheduler Engine (TypeScript Port)
 *
 * Implements:
 * 1. Legacy Static Equal-Slot TDMA (rigid 988 us slots; high outage airtime waste).
 * 2. Terrain-Aware Dynamic Scheduler (Tac-TAD):
 *    - Zero-allocation outage reclamation (reclaims 100% time on severed links).
 *    - Priority-weighted urgency metric (Psi_i) protecting GBR C2 and voice.
 *    - Exact-fit dynamic slot sizing (tau_i = Q_i / R_i).
 *    - Predictive pre-occlusion queue evacuation (Phi_evac surge to 5.0x).
 */

import { FinalDropCaptureResult } from '../shared/workerProtocol';
import { SPEED_OF_LIGHT } from './config';
import { LinkStatus } from './linkBudget';
import { GroundNodeTrafficSubsystem, QOS_PROFILES } from './queues';
import { NodeTerrainState, PredictiveState } from './trajectory';
import { TdmaFrameConfig } from './tdmaConfig';

export type { FinalDropCaptureResult };

export const T_FRAME_S: number = 0.02; // 20 ms superframe
export const T_CTRL_S: number = 0.001; // 1 ms control subframe
export const T_DL_MIN_S: number = 0.003; // 3 ms minimum DL broadcast
export const T_DL_MAX_S: number = 0.007; // 7 ms maximum dynamic DL breathing
export const T_UL_NOMINAL_S: number = 0.016; // 16 ms nominal UL allocation
export const TAU_GUARD_S: number = 12e-6; // 12 us Timing Advance guard
export const TAU_MIN_S: number = 200e-6; // 200 us minimum allocatable slot

export interface SlotAllocation {
  readonly nodeId: number;
  readonly slotStartS: number;
  readonly durationS: number;
  readonly timingAdvanceS: number;
  readonly modcodName: string;
  readonly spectralEfficiency: number;
  readonly capacityBits: number;
  readonly isPreOcclusionFlush: boolean;
  readonly sectorId?: 0 | 1 | 2 | 3;
}

export interface FrameScheduleReport {
  readonly frameIndex: number;
  readonly timestampS: number;
  readonly schedulerName: string;
  readonly allocations: readonly SlotAllocation[];
  /** Scheduled uplink airtime including guard intervals, in seconds. */
  readonly totalUlScheduledS: number;
  /** Available uplink airtime for this frame, in seconds. */
  readonly totalUlAvailableS: number;
  /** Available airtime not scheduled to any node, in seconds. */
  readonly totalUlUnusedS: number;
  readonly totalUlUtilizationPct: number;
  /** Payload bits dequeued from queues, whether or not the link was in outage. */
  readonly totalPayloadBitsDequeued: number;
  /** Payload bits actually counted as goodput (dequeued while the link is usable). */
  readonly totalBitsTransmitted: number;
  /** Payload bits dequeued but not deliverable because the link was in outage. */
  readonly totalBitsWastedOnOutage: number;
  /** Cumulative queue drops at the end of this frame. */
  readonly packetsDroppedDelay: number;
  readonly packetsDroppedOverflow: number;
  /** New drops that occurred during this frame. */
  readonly packetsDroppedDelayThisFrame: number;
  readonly packetsDroppedOverflowThisFrame: number;
  /** Per-frame dropped bytes across all nodes (matches *ThisFrame). */
  readonly droppedDelayBytes: number;
  readonly droppedOverflowBytes: number;
  readonly totalDroppedBytes: number;
  /** Per-frame dropped bytes that occurred during this frame. */
  readonly droppedDelayBytesThisFrame: number;
  readonly droppedOverflowBytesThisFrame: number;
  readonly totalDroppedBytesThisFrame: number;
  /** Cumulative dropped bytes accumulated across the simulation run (including evicted nodes). */
  readonly runDroppedDelayBytes: number;
  readonly runDroppedOverflowBytes: number;
  readonly runTotalDroppedBytes: number;
  /** Queue backlog remaining after this frame, in bits. */
  readonly totalBacklogBits: number;
  /** Authoritative superframe duration in seconds (Resolving Audit Finding 5). */
  readonly superframeDurationS: number;
  /** Authoritative sync/C2 duration in seconds (Resolving Audit Finding 5). */
  readonly ctrlDurationS: number;
  /** Authoritative downlink duration in seconds (Resolving Audit Finding 5). */
  readonly dlDurationS: number;
  /** Authoritative available uplink duration in seconds (Resolving Audit Finding 5). */
  readonly ulAvailableDurationS: number;
  readonly sectorScheduledUlS?: readonly [number, number, number, number];
  readonly sectorAvailableUlS?: readonly [number, number, number, number];
  readonly sectorUnusedUlS?: readonly [number, number, number, number];
  readonly sectorUtilizationPct?: readonly [number, number, number, number];
  readonly sectorNodeCounts?: readonly [number, number, number, number];
  readonly sectorGoodputBits?: readonly [number, number, number, number];
}

interface NodeDropCounters {
  readonly delayPkts: number;
  readonly overflowPkts: number;
  readonly delayBytes: number;
  readonly overflowBytes: number;
  readonly totalBytes: number;
}

const ZERO_NODE_DROP_COUNTERS: NodeDropCounters = {
  delayPkts: 0,
  overflowPkts: 0,
  delayBytes: 0,
  overflowBytes: 0,
  totalBytes: 0,
};

const ZERO_DROP_CAPTURE: FinalDropCaptureResult = {
  captured: false,
  droppedDelayPkts: 0,
  droppedOverflowPkts: 0,
  totalDroppedPkts: 0,
  droppedDelayBytes: 0,
  droppedOverflowBytes: 0,
  totalDroppedBytes: 0,
};

interface DropMetrics {
  delayTotal: number;
  overflowTotal: number;
  delayThisFrame: number;
  overflowThisFrame: number;
  droppedDelayBytes: number;
  droppedOverflowBytes: number;
  totalDroppedBytes: number;
  droppedDelayBytesThisFrame: number;
  droppedOverflowBytesThisFrame: number;
  totalDroppedBytesThisFrame: number;
}

function diffDropCounter(curr: number, prev: number): number {
  return curr >= prev ? curr - prev : curr;
}

function captureNodeDropCounters(node: GroundNodeTrafficSubsystem): NodeDropCounters {
  const q = node.queue as unknown as {
    droppedDelayCount: number;
    droppedOverflowCount: number;
    droppedDelayBytes: number;
    droppedOverflowBytes: number;
    totalDroppedBytes: number;
    monotonicDroppedDelayCount?: number;
    monotonicDroppedOverflowCount?: number;
    monotonicDroppedDelayBytes?: number;
    monotonicDroppedOverflowBytes?: number;
    monotonicTotalDroppedBytes?: number;
  };
  return {
    delayPkts: q.monotonicDroppedDelayCount ?? q.droppedDelayCount,
    overflowPkts: q.monotonicDroppedOverflowCount ?? q.droppedOverflowCount,
    delayBytes: q.monotonicDroppedDelayBytes ?? q.droppedDelayBytes,
    overflowBytes: q.monotonicDroppedOverflowBytes ?? q.droppedOverflowBytes,
    totalBytes: q.monotonicTotalDroppedBytes ?? q.totalDroppedBytes,
  };
}

/** Queue counters are cumulative, so report cumulative totals plus non-negative per-frame deltas. */
function collectDropMetrics(
  nodes: readonly GroundNodeTrafficSubsystem[],
  previous: Map<number, NodeDropCounters>
): DropMetrics {
  let delayTotal = 0;
  let overflowTotal = 0;
  let delayThisFrame = 0;
  let overflowThisFrame = 0;
  let droppedDelayBytesThisFrame = 0;
  let droppedOverflowBytesThisFrame = 0;
  let totalDroppedBytesThisFrame = 0;
  for (const node of nodes) {
    const curr = captureNodeDropCounters(node);
    const prev = previous.get(node.nodeId) ?? ZERO_NODE_DROP_COUNTERS;
    delayTotal += curr.delayPkts;
    overflowTotal += curr.overflowPkts;
    delayThisFrame += diffDropCounter(curr.delayPkts, prev.delayPkts);
    overflowThisFrame += diffDropCounter(curr.overflowPkts, prev.overflowPkts);
    const dDelayBytes = diffDropCounter(curr.delayBytes, prev.delayBytes);
    const dOverflowBytes = diffDropCounter(curr.overflowBytes, prev.overflowBytes);
    const dTotalBytes = diffDropCounter(curr.totalBytes, prev.totalBytes);
    droppedDelayBytesThisFrame += dDelayBytes;
    droppedOverflowBytesThisFrame += dOverflowBytes;
    totalDroppedBytesThisFrame += dTotalBytes;
    previous.set(node.nodeId, curr);
  }
  return {
    delayTotal,
    overflowTotal,
    delayThisFrame,
    overflowThisFrame,
    droppedDelayBytes: droppedDelayBytesThisFrame,
    droppedOverflowBytes: droppedOverflowBytesThisFrame,
    totalDroppedBytes: totalDroppedBytesThisFrame,
    droppedDelayBytesThisFrame,
    droppedOverflowBytesThisFrame,
    totalDroppedBytesThisFrame,
  };
}

function totalBacklogBits(nodes: readonly GroundNodeTrafficSubsystem[]): number {
  return nodes.reduce((sum, node) => sum + node.queue.getTotalBacklogBits(), 0);
}

export interface BaseScheduler {
  readonly schedulerName: string;
  scheduleFrame(
    frameIndex: number,
    currentSimTimeS: number,
    nodes: readonly GroundNodeTrafficSubsystem[],
    linkStatuses: ReadonlyMap<number, LinkStatus> | Record<number, LinkStatus>,
    predictiveStates: ReadonlyMap<number, PredictiveState> | Record<number, PredictiveState>,
    dlBacklogBytes?: number
  ): FrameScheduleReport;
  registerNode?(node: GroundNodeTrafficSubsystem): void;
  capturePendingDropsBeforeEviction?(node: GroundNodeTrafficSubsystem): FinalDropCaptureResult;
  evictNode?(nodeId: number, node?: GroundNodeTrafficSubsystem): FinalDropCaptureResult | null;
  getRunDropTotals?(): {
    readonly droppedDelayBytes: number;
    readonly droppedOverflowBytes: number;
    readonly totalDroppedBytes: number;
  };
  hasDropBaseline?(nodeId: number): boolean;
  hasTrackedNode?(nodeId: number): boolean;
}

abstract class DropTrackingScheduler implements BaseScheduler {
  public abstract readonly schedulerName: string;
  protected config: TdmaFrameConfig = new TdmaFrameConfig();
  protected readonly previousDropCounts = new Map<number, NodeDropCounters>();
  private readonly trackedNodes = new Map<number, GroundNodeTrafficSubsystem>();
  private readonly retiredNodeInstances = new WeakSet<GroundNodeTrafficSubsystem>();
  private _runDroppedDelayBytes: number = 0;
  private _runDroppedOverflowBytes: number = 0;

  protected get runDroppedDelayBytes(): number {
    return this._runDroppedDelayBytes;
  }

  protected get runDroppedOverflowBytes(): number {
    return this._runDroppedOverflowBytes;
  }

  protected get runTotalDroppedBytes(): number {
    return this._runDroppedDelayBytes + this._runDroppedOverflowBytes;
  }

  public setTdmaConfig(config: TdmaFrameConfig): void {
    this.config = config;
  }

  public registerNode(node: GroundNodeTrafficSubsystem): void {
    if (this.retiredNodeInstances.has(node)) {
      return;
    }
    const existing = this.trackedNodes.get(node.nodeId);
    if (!this.previousDropCounts.has(node.nodeId) || existing !== node) {
      this.previousDropCounts.set(node.nodeId, captureNodeDropCounters(node));
    }
    this.trackedNodes.set(node.nodeId, node);
  }

  protected trackScheduledNodes(nodes: readonly GroundNodeTrafficSubsystem[]): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!this.retiredNodeInstances.has(node)) {
        this.trackedNodes.set(node.nodeId, node);
      }
    }
  }

  protected applyFrameDropMetrics(drops: DropMetrics): void {
    this._runDroppedDelayBytes += drops.droppedDelayBytesThisFrame;
    this._runDroppedOverflowBytes += drops.droppedOverflowBytesThisFrame;
  }

  public capturePendingDropsBeforeEviction(node: GroundNodeTrafficSubsystem): FinalDropCaptureResult {
    if (this.retiredNodeInstances.has(node)) {
      return ZERO_DROP_CAPTURE;
    }
    const curr = captureNodeDropCounters(node);
    const prev = this.previousDropCounts.get(node.nodeId) ?? ZERO_NODE_DROP_COUNTERS;
    const droppedDelayPkts = diffDropCounter(curr.delayPkts, prev.delayPkts);
    const droppedOverflowPkts = diffDropCounter(curr.overflowPkts, prev.overflowPkts);
    const droppedDelayBytes = diffDropCounter(curr.delayBytes, prev.delayBytes);
    const droppedOverflowBytes = diffDropCounter(curr.overflowBytes, prev.overflowBytes);
    const totalDroppedBytes = diffDropCounter(curr.totalBytes, prev.totalBytes);
    this._runDroppedDelayBytes += droppedDelayBytes;
    this._runDroppedOverflowBytes += droppedOverflowBytes;
    this.previousDropCounts.set(node.nodeId, curr);
    this.retiredNodeInstances.add(node);
    return {
      captured: true,
      droppedDelayPkts,
      droppedOverflowPkts,
      totalDroppedPkts: droppedDelayPkts + droppedOverflowPkts,
      droppedDelayBytes,
      droppedOverflowBytes,
      totalDroppedBytes,
    };
  }

  public evictNode(nodeId: number, node?: GroundNodeTrafficSubsystem): FinalDropCaptureResult | null {
    const hadBaseline = this.previousDropCounts.has(nodeId);
    const hadTracked = this.trackedNodes.has(nodeId);
    if (!hadBaseline && !hadTracked) {
      return null;
    }
    const target = node ?? this.trackedNodes.get(nodeId);
    let result: FinalDropCaptureResult = ZERO_DROP_CAPTURE;
    if (target && !this.retiredNodeInstances.has(target)) {
      result = this.capturePendingDropsBeforeEviction(target);
    }
    this.previousDropCounts.delete(nodeId);
    this.trackedNodes.delete(nodeId);
    this.onNodeEvicted(nodeId);
    return result;
  }

  protected onNodeEvicted(_nodeId: number): void {
    // Optional subclass cleanup
  }

  public getRunDropTotals(): {
    readonly droppedDelayBytes: number;
    readonly droppedOverflowBytes: number;
    readonly totalDroppedBytes: number;
  } {
    return {
      droppedDelayBytes: this._runDroppedDelayBytes,
      droppedOverflowBytes: this._runDroppedOverflowBytes,
      totalDroppedBytes: this.runTotalDroppedBytes,
    };
  }

  public hasDropBaseline(nodeId: number): boolean {
    return this.previousDropCounts.has(nodeId);
  }

  public hasTrackedNode(nodeId: number): boolean {
    return this.trackedNodes.has(nodeId);
  }

  protected buildEmptyDropFields() {
    return {
      packetsDroppedDelay: 0,
      packetsDroppedOverflow: 0,
      packetsDroppedDelayThisFrame: 0,
      packetsDroppedOverflowThisFrame: 0,
      droppedDelayBytes: 0,
      droppedOverflowBytes: 0,
      totalDroppedBytes: 0,
      droppedDelayBytesThisFrame: 0,
      droppedOverflowBytesThisFrame: 0,
      totalDroppedBytesThisFrame: 0,
      runDroppedDelayBytes: this._runDroppedDelayBytes,
      runDroppedOverflowBytes: this._runDroppedOverflowBytes,
      runTotalDroppedBytes: this.runTotalDroppedBytes,
    };
  }

  protected buildDropReportFields(drops: DropMetrics) {
    return {
      packetsDroppedDelay: drops.delayTotal,
      packetsDroppedOverflow: drops.overflowTotal,
      packetsDroppedDelayThisFrame: drops.delayThisFrame,
      packetsDroppedOverflowThisFrame: drops.overflowThisFrame,
      droppedDelayBytes: drops.droppedDelayBytes,
      droppedOverflowBytes: drops.droppedOverflowBytes,
      totalDroppedBytes: drops.totalDroppedBytes,
      droppedDelayBytesThisFrame: drops.droppedDelayBytesThisFrame,
      droppedOverflowBytesThisFrame: drops.droppedOverflowBytesThisFrame,
      totalDroppedBytesThisFrame: drops.totalDroppedBytesThisFrame,
      runDroppedDelayBytes: this._runDroppedDelayBytes,
      runDroppedOverflowBytes: this._runDroppedOverflowBytes,
      runTotalDroppedBytes: this.runTotalDroppedBytes,
    };
  }

  public abstract scheduleFrame(
    frameIndex: number,
    currentSimTimeS: number,
    nodes: readonly GroundNodeTrafficSubsystem[],
    linkStatuses: ReadonlyMap<number, LinkStatus> | Record<number, LinkStatus>,
    predictiveStates: ReadonlyMap<number, PredictiveState> | Record<number, PredictiveState>,
    dlBacklogBytes?: number
  ): FrameScheduleReport;
}

/**
 * Legacy Static Equal-Slot TDMA Scheduler.
 *
 * Divides uplink time equally across all N registered nodes:
 *   tauSlot = (T_UL_NOMINAL_S - N * TAU_GUARD_S) / N (exactly 988 us for N=16)
 * Blindly transmits into mountain shadow obstacles, wasting up to 33% of frame time.
 */
export class LegacyStaticScheduler extends DropTrackingScheduler {
  public readonly schedulerName: string = 'Legacy_Static_TDMA';
  public enableMultiSector: boolean = false;

  public scheduleFrame(
    frameIndex: number,
    currentSimTimeS: number,
    nodes: readonly GroundNodeTrafficSubsystem[],
    linkStatuses: ReadonlyMap<number, LinkStatus> | Record<number, LinkStatus>,
    predictiveStates: ReadonlyMap<number, PredictiveState> | Record<number, PredictiveState>,
    _dlBacklogBytes: number = 0
  ): FrameScheduleReport {
    const numNodes = nodes.length;
    const tUlAvailable = this.config.frameDurationS - this.config.ctrlDurationS - this.config.dlMinDurationS;

    const getLink = (id: number): LinkStatus | undefined =>
      linkStatuses instanceof Map
        ? linkStatuses.get(id)
        : (linkStatuses as Record<number, LinkStatus>)[id];

    const getPred = (id: number): PredictiveState | undefined => {
      if (predictiveStates instanceof Map) {
        return predictiveStates.get(id);
      }

      return (predictiveStates as Record<number, PredictiveState>)[id];
    };

    const isMultiSectorActive = this.enableMultiSector && nodes.some(n => getLink(n.nodeId)?.activeSectorId !== undefined);

    if (isMultiSectorActive) {
      const sectorBuckets: GroundNodeTrafficSubsystem[][] = [[], [], [], []];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const secId = (getLink(node.nodeId)?.activeSectorId ?? 0) as 0 | 1 | 2 | 3;
        sectorBuckets[secId].push(node);
      }

      const sectorScheduledUlS: [number, number, number, number] = [0, 0, 0, 0];
      const sectorAvailableUlS: [number, number, number, number] = [tUlAvailable, tUlAvailable, tUlAvailable, tUlAvailable];
      const sectorUnusedUlS: [number, number, number, number] = [tUlAvailable, tUlAvailable, tUlAvailable, tUlAvailable];
      const sectorUtilizationPct: [number, number, number, number] = [0, 0, 0, 0];
      const sectorNodeCounts: [number, number, number, number] = [
        sectorBuckets[0].length,
        sectorBuckets[1].length,
        sectorBuckets[2].length,
        sectorBuckets[3].length,
      ];
      const sectorGoodputBits: [number, number, number, number] = [0, 0, 0, 0];

      const allocations: SlotAllocation[] = [];
      let totalBitsTx = 0;
      let totalBitsWasted = 0;
      let totalPayloadBitsDequeued = 0;

      for (let k = 0; k < 4; k++) {
        const bucket = sectorBuckets[k];
        if (bucket.length === 0) continue;

        const secK = bucket.length;
        const secTauSlot = (tUlAvailable - secK * this.config.guardIntervalS) / secK;
        let secUsedTimeS = 0.0;
        let secSlotStartS = currentSimTimeS + this.config.ctrlDurationS + this.config.dlMinDurationS;
        let secBitsTx = 0;

        for (let i = 0; i < bucket.length; i++) {
          const node = bucket[i];
          const ls = getLink(node.nodeId);
          const ps = getPred(node.nodeId);

          const isDepleted = node.batteryLevelPct <= 0 || node.isDepleted;
          const rate = (!isDepleted && ls && ls.bitrateBps > 0) ? ls.bitrateBps : (isDepleted ? 0 : 4.95e6);
          const capBits = isDepleted ? 0 : Math.floor(secTauSlot * rate);
          const capBytes = Math.floor(capBits / 8);

          allocations.push({
            nodeId: node.nodeId,
            slotStartS: secSlotStartS,
            durationS: secTauSlot,
            timingAdvanceS: (ls && ls.slantRangeM > 0) ? (2.0 * ls.slantRangeM) / SPEED_OF_LIGHT : 0.001,
            modcodName: isDepleted ? 'DEPLETED_OUTAGE' : (ls?.modcodName ?? 'LINK_OUTAGE'),
            spectralEfficiency: isDepleted ? 0.0 : (ls?.spectralEfficiency ?? 0.0),
            capacityBits: capBits,
            isPreOcclusionFlush: false,
            sectorId: k as 0 | 1 | 2 | 3,
          });

          secUsedTimeS += secTauSlot + this.config.guardIntervalS;
          secSlotStartS += secTauSlot + this.config.guardIntervalS;

          if (!isDepleted) {
            const served = node.queue.dequeue(capBytes, currentSimTimeS);
            let bitsServed = 0;
            for (let p = 0; p < served.length; p++) {
              bitsServed += served[p].sizeBits;
            }

            totalPayloadBitsDequeued += bitsServed;
            if (ls?.isOutage || !ls || ls.bitrateBps <= 0) {
              totalBitsWasted += bitsServed;
            } else {
              totalBitsTx += bitsServed;
              secBitsTx += bitsServed;
            }
          }
        }

        sectorScheduledUlS[k] = secUsedTimeS;
        sectorAvailableUlS[k] = tUlAvailable;
        sectorUnusedUlS[k] = Math.max(0, tUlAvailable - secUsedTimeS);
        sectorUtilizationPct[k] = tUlAvailable > 0 ? (secUsedTimeS / tUlAvailable) * 100.0 : 0.0;
        sectorGoodputBits[k] = secBitsTx;
      }

      this.trackScheduledNodes(nodes);
      const drops = collectDropMetrics(nodes, this.previousDropCounts);
      this.applyFrameDropMetrics(drops);
      const backlogBits = totalBacklogBits(nodes);

      const totalUlAvailableS = 4 * tUlAvailable;
      const totalUlScheduledS = sectorScheduledUlS.reduce((a, b) => a + b, 0);
      const totalUlUnusedS = Math.max(0, totalUlAvailableS - totalUlScheduledS);
      const totalUlUtilizationPct = totalUlAvailableS > 0 ? (totalUlScheduledS / totalUlAvailableS) * 100.0 : 0.0;

      return {
        frameIndex,
        timestampS: currentSimTimeS,
        schedulerName: this.schedulerName,
        allocations,
        totalUlScheduledS,
        totalUlAvailableS,
        totalUlUnusedS,
        totalUlUtilizationPct,
        totalPayloadBitsDequeued,
        totalBitsTransmitted: totalBitsTx,
        totalBitsWastedOnOutage: totalBitsWasted,
        ...this.buildDropReportFields(drops),
        totalBacklogBits: backlogBits,
        superframeDurationS: this.config.frameDurationS,
        ctrlDurationS: this.config.ctrlDurationS,
        dlDurationS: this.config.dlMinDurationS,
        ulAvailableDurationS: tUlAvailable,
        sectorScheduledUlS,
        sectorAvailableUlS,
        sectorUnusedUlS,
        sectorUtilizationPct,
        sectorNodeCounts,
        sectorGoodputBits,
      };
    }

    const K = this.config.fixedSlotCount ?? numNodes;

    if (K === 0) {
      return {
        frameIndex,
        timestampS: currentSimTimeS,
        schedulerName: this.schedulerName,
        allocations: [],
        totalUlScheduledS: 0,
        totalUlAvailableS: tUlAvailable,
        totalUlUnusedS: tUlAvailable,
        totalUlUtilizationPct: 0,
        totalPayloadBitsDequeued: 0,
        totalBitsTransmitted: 0,
        totalBitsWastedOnOutage: 0,
        ...this.buildEmptyDropFields(),
        totalBacklogBits: 0,
        superframeDurationS: this.config.frameDurationS,
        ctrlDurationS: this.config.ctrlDurationS,
        dlDurationS: this.config.dlMinDurationS,
        ulAvailableDurationS: tUlAvailable,
        sectorScheduledUlS: [0, 0, 0, 0],
        sectorAvailableUlS: [tUlAvailable, 0, 0, 0],
        sectorUnusedUlS: [tUlAvailable, 0, 0, 0],
        sectorUtilizationPct: [0, 0, 0, 0],
        sectorNodeCounts: [0, 0, 0, 0],
        sectorGoodputBits: [0, 0, 0, 0],
      };
    }

    const tauSlot = (tUlAvailable - K * this.config.guardIntervalS) / K;

    const allocations: SlotAllocation[] = [];
    let totalBitsTx = 0;
    let totalBitsWasted = 0;
    let totalPayloadBitsDequeued = 0;
    let usedTimeS = 0.0;
    let slotStartS = currentSimTimeS + this.config.ctrlDurationS + this.config.dlMinDurationS;

    for (let i = 0; i < K; i++) {
      let node: GroundNodeTrafficSubsystem | undefined;
      if (numNodes <= K) {
        if (i < numNodes) {
          node = nodes[i];
        } else {
          // IDLE_UNALLOCATED slot (Resolving Audit Finding 6)
          allocations.push({
            nodeId: -1,
            slotStartS,
            durationS: tauSlot,
            timingAdvanceS: 0.001,
            modcodName: 'IDLE_UNALLOCATED',
            spectralEfficiency: 0.0,
            capacityBits: 0,
            isPreOcclusionFlush: false,
          });
          usedTimeS += tauSlot + this.config.guardIntervalS;
          slotStartS += tauSlot + this.config.guardIntervalS;
          continue;
        }
      } else {
        // numNodes > K: round-robin modulo airtime multiplexing (Resolving Audit Finding 6)
        const nodeIdx = (i + frameIndex * K) % numNodes;
        node = nodes[nodeIdx];
      }

      const ls = getLink(node.nodeId);
      const ps = getPred(node.nodeId);

      const isDepleted = node.batteryLevelPct <= 0 || node.isDepleted;
      const rate = (!isDepleted && ls && ls.bitrateBps > 0) ? ls.bitrateBps : (isDepleted ? 0 : 4.95e6);
      const capBits = isDepleted ? 0 : Math.floor(tauSlot * rate);
      const capBytes = Math.floor(capBits / 8);

      allocations.push({
        nodeId: node.nodeId,
        slotStartS,
        durationS: tauSlot,
        timingAdvanceS: (ls && ls.slantRangeM > 0) ? (2.0 * ls.slantRangeM) / SPEED_OF_LIGHT : 0.001,
        modcodName: isDepleted ? 'DEPLETED_OUTAGE' : (ls?.modcodName ?? 'LINK_OUTAGE'),
        spectralEfficiency: isDepleted ? 0.0 : (ls?.spectralEfficiency ?? 0.0),
        capacityBits: capBits,
        isPreOcclusionFlush: false,
      });

      usedTimeS += tauSlot + this.config.guardIntervalS;
      slotStartS += tauSlot + this.config.guardIntervalS;

      if (!isDepleted) {
        const served = node.queue.dequeue(capBytes, currentSimTimeS);
        let bitsServed = 0;
        for (let p = 0; p < served.length; p++) {
          bitsServed += served[p].sizeBits;
        }

        totalPayloadBitsDequeued += bitsServed;
        if (ls?.isOutage || !ls || ls.bitrateBps <= 0) {
          totalBitsWasted += bitsServed;
        } else {
          totalBitsTx += bitsServed;
        }
      }
    }

    this.trackScheduledNodes(nodes);
    const drops = collectDropMetrics(nodes, this.previousDropCounts);
    this.applyFrameDropMetrics(drops);
    const backlogBits = totalBacklogBits(nodes);
    const utilPct = (usedTimeS / tUlAvailable) * 100.0;

    return {
      frameIndex,
      timestampS: currentSimTimeS,
      schedulerName: this.schedulerName,
      allocations,
      totalUlScheduledS: usedTimeS,
      totalUlAvailableS: tUlAvailable,
      totalUlUnusedS: Math.max(0, tUlAvailable - usedTimeS),
      totalUlUtilizationPct: utilPct,
      totalPayloadBitsDequeued,
      totalBitsTransmitted: totalBitsTx,
      totalBitsWastedOnOutage: totalBitsWasted,
      ...this.buildDropReportFields(drops),
      totalBacklogBits: backlogBits,
      superframeDurationS: this.config.frameDurationS,
      ctrlDurationS: this.config.ctrlDurationS,
      dlDurationS: this.config.dlMinDurationS,
      ulAvailableDurationS: tUlAvailable,
      sectorScheduledUlS: [usedTimeS, 0, 0, 0],
      sectorAvailableUlS: [tUlAvailable, 0, 0, 0],
      sectorUnusedUlS: [Math.max(0, tUlAvailable - usedTimeS), 0, 0, 0],
      sectorUtilizationPct: [utilPct, 0, 0, 0],
      sectorNodeCounts: [numNodes, 0, 0, 0],
      sectorGoodputBits: [totalBitsTx, 0, 0, 0],
    };
  }
}

/**
 * Terrain-Aware Dynamic Scheduler (Tac-TAD).
 */
export class TerrainAwareDynamicScheduler extends DropTrackingScheduler {
  public readonly schedulerName: string = 'Tac_TAD';
  public readonly tauMaxNormalS: number;
  public enablePredictiveLookahead: boolean;

  private readonly rAvg: Map<number, number> = new Map();
  private readonly alphaPf: number = 0.05;
  private readonly weights: Readonly<Record<number, number>> = {
    69: 200.0,
    65: 50.0,
    67: 2.0,
    70: 1.0,
  };

  constructor(tauMaxNormalS: number = 0.008, enablePredictiveLookahead: boolean = true) {
    super();
    this.tauMaxNormalS = tauMaxNormalS;
    this.enablePredictiveLookahead = enablePredictiveLookahead;
  }

  protected override onNodeEvicted(nodeId: number): void {
    this.rAvg.delete(nodeId);
  }

  public scheduleFrame(
    frameIndex: number,
    currentSimTimeS: number,
    nodes: readonly GroundNodeTrafficSubsystem[],
    linkStatuses: ReadonlyMap<number, LinkStatus> | Record<number, LinkStatus>,
    predictiveStates: ReadonlyMap<number, PredictiveState> | Record<number, PredictiveState>,
    dlBacklogBytes: number = 0
  ): FrameScheduleReport {
    // Dynamic DL breathing with strict physical upper-bound ceiling check (Resolving Audit Finding 2)
    const minUlReserveS = this.config.minSlotDurationS + this.config.guardIntervalS;
    const maxAllowedDlS = this.config.frameDurationS - this.config.ctrlDurationS - minUlReserveS;
    const targetDlS = dlBacklogBytes > 5000 ? Math.min(this.config.dlMaxDurationS, this.config.dlMinDurationS + 0.002) : this.config.dlMinDurationS;
    const tDl = Math.min(targetDlS, Math.max(this.config.dlMinDurationS, maxAllowedDlS));
    const tUlAvailable = this.config.frameDurationS - this.config.ctrlDurationS - tDl;

    if (nodes.length === 0) {
      return {
        frameIndex,
        timestampS: currentSimTimeS,
        schedulerName: this.schedulerName,
        allocations: [],
        totalUlScheduledS: 0,
        totalUlAvailableS: tUlAvailable,
        totalUlUnusedS: tUlAvailable,
        totalUlUtilizationPct: 0,
        totalPayloadBitsDequeued: 0,
        totalBitsTransmitted: 0,
        totalBitsWastedOnOutage: 0,
        ...this.buildEmptyDropFields(),
        totalBacklogBits: 0,
        superframeDurationS: this.config.frameDurationS,
        ctrlDurationS: this.config.ctrlDurationS,
        dlDurationS: tDl,
        ulAvailableDurationS: tUlAvailable,
        sectorScheduledUlS: [0, 0, 0, 0],
        sectorAvailableUlS: [tUlAvailable, 0, 0, 0],
        sectorUnusedUlS: [tUlAvailable, 0, 0, 0],
        sectorUtilizationPct: [0, 0, 0, 0],
        sectorNodeCounts: [0, 0, 0, 0],
        sectorGoodputBits: [0, 0, 0, 0],
      };
    }

    const getLink = (id: number): LinkStatus | undefined =>
      linkStatuses instanceof Map
        ? linkStatuses.get(id)
        : (linkStatuses as Record<number, LinkStatus>)[id];

    const getPred = (id: number): PredictiveState | undefined =>
      predictiveStates instanceof Map
        ? predictiveStates.get(id)
        : (predictiveStates as Record<number, PredictiveState>)[id];

    const isMultiSectorActive = nodes.some(n => getLink(n.nodeId)?.activeSectorId !== undefined);

    if (isMultiSectorActive) {
      const sectorBuckets: GroundNodeTrafficSubsystem[][] = [[], [], [], []];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const secId = (getLink(node.nodeId)?.activeSectorId ?? 0) as 0 | 1 | 2 | 3;
        sectorBuckets[secId].push(node);
      }

      const sectorScheduledUlS: [number, number, number, number] = [0, 0, 0, 0];
      const sectorAvailableUlS: [number, number, number, number] = [tUlAvailable, tUlAvailable, tUlAvailable, tUlAvailable];
      const sectorUnusedUlS: [number, number, number, number] = [tUlAvailable, tUlAvailable, tUlAvailable, tUlAvailable];
      const sectorUtilizationPct: [number, number, number, number] = [0, 0, 0, 0];
      const sectorNodeCounts: [number, number, number, number] = [
        sectorBuckets[0].length,
        sectorBuckets[1].length,
        sectorBuckets[2].length,
        sectorBuckets[3].length,
      ];
      const sectorGoodputBits: [number, number, number, number] = [0, 0, 0, 0];

      const allocations: SlotAllocation[] = [];
      let totalBitsTx = 0;
      let totalPayloadBitsDequeued = 0;
      const scheduledIds = new Set<number>();

      for (let k = 0; k < 4; k++) {
        const secNodes = sectorBuckets[k];
        if (secNodes.length === 0) continue;

        // Step 1: Reclaim 100% time on severed links (Filter out hard shadow or 0 rate nodes)
        const candidateNodes: GroundNodeTrafficSubsystem[] = [];
        for (let i = 0; i < secNodes.length; i++) {
          const node = secNodes[i];
          const ps = getPred(node.nodeId);
          const ls = getLink(node.nodeId);

          const isHardShadow = ps?.isHardShadow !== undefined
            ? ps.isHardShadow
            : (ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF);

          if (
            isHardShadow ||
            (ls && (ls.bitrateBps <= 0 || ls.isOutage))
          ) {
            continue; // Do not dequeue payload or allocate airtime to an unusable link.
          }

          if (node.batteryLevelPct <= 0 || node.isDepleted) {
            continue; // Depleted battery cannot transmit.
          }

          if (
            node.queue.getTotalBacklogBits() === 0 &&
            ps?.currentState !== NodeTerrainState.PRE_OCCLUSION_FLUSH
          ) {
            continue;
          }

          candidateNodes.push(node);
        }

        // Step 2: Compute Lyapunov Composite Metric Psi_i
        const ranked: Array<{ psi: number; node: GroundNodeTrafficSubsystem }> = [];
        for (let i = 0; i < candidateNodes.length; i++) {
          const node = candidateNodes[i];
          const nid = node.nodeId;
          const ps = getPred(nid);
          const ls = getLink(nid);
          const q = node.queue;
          const qTotalBits = q.getTotalBacklogBits();

          // Urgency metric & HoL delay ratio
          let urgency = 0.0;
          let maxHolRatio = 0.0;
          for (const [qidStr, weight] of Object.entries(this.weights)) {
            const qid = Number(qidStr);
            if (q.getClassBacklogBytes(qid) > 0) {
              const hol = q.getHolDelayS(qid, currentSimTimeS);
              const pdb = QOS_PROFILES[qid]?.pdbS ?? 0.1;
              const ratio = hol / pdb;
              if (ratio > maxHolRatio) maxHolRatio = ratio;
              urgency += weight * Math.exp(Math.min(8.0, ratio));
            }
          }
          if (urgency === 0.0) urgency = 0.1;

          // Exponential HoL delay urgency boost when approaching PDB (>= 50% PDB elapsed)
          const holDelayBoost = maxHolRatio >= 0.5 ? Math.exp(Math.min(6.0, 3.0 * maxHolRatio)) : 1.0;

          // Proportional fairness
          const rInst = ls?.bitrateBps ?? 1e6;
          const rPrev = this.rAvg.get(nid) ?? 100000.0;
          const pfTerm = rInst / Math.max(1000.0, rPrev);

          // Backlog utility
          const backlogUtility = Math.max(1.0, Math.log2(1.0 + qTotalBits / 8000.0));

          // Predictive evacuation boost (strictly gated by enablePredictiveLookahead)
          let phiEvac = 1.0;
          if (this.enablePredictiveLookahead) {
            if (ps?.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
              const warning = 3.0;
              const tOcc = ps.timeToOcclusionS;
              const evacRatio = Math.max(0.0, (warning - tOcc) / warning);
              phiEvac = 1.0 + 5.0 * evacRatio * Math.min(1.0, qTotalBits / 20000.0);
            } else if (ps?.currentState === NodeTerrainState.RE_EMERGENCE_BURST) {
              phiEvac = 4.0;
            }

            // Crossover boundary pre-flush boost (1.25x boost if isCrossoverZone === true)
            if (ls?.isCrossoverZone) {
              phiEvac *= 1.25;
            }
          }

          const priorityMultiplier = Math.max(0.1, Math.min(5.0, node.tacticalPriority ?? 1.0));
          const psi = phiEvac * urgency * holDelayBoost * pfTerm * backlogUtility * priorityMultiplier;
          ranked.push({ psi, node });
        }

        ranked.sort((a, b) => b.psi - a.psi);

        // Step 3: Work-Conserving Multi-Pass Slot Sizing for Sector k
        const candidatePlan: Array<{
          node: GroundNodeTrafficSubsystem;
          nid: number;
          ls: LinkStatus | undefined;
          ps: PredictiveState | undefined;
          rInst: number;
          tauSlot: number;
          isFlush: boolean;
          remainingBacklogBits: number;
        }> = [];

        let secRemainingUlTimeS = tUlAvailable;

        // Pass 1: Primary allocation up to tauMaxNormalS (or flush duration)
        for (let i = 0; i < ranked.length; i++) {
          if (secRemainingUlTimeS < this.config.minSlotDurationS + this.config.guardIntervalS) break;

          const node = ranked[i].node;
          const nid = node.nodeId;
          const ps = getPred(nid);
          const ls = getLink(nid);
          const rInst = ls?.bitrateBps ?? 1e6;
          const qTotalBits = node.queue.getTotalBacklogBits();
          if (qTotalBits === 0) continue;

          const tauReq = qTotalBits / rInst;
          const maxAvailSlot = secRemainingUlTimeS - this.config.guardIntervalS;
          let tauSlot: number;
          let isFlush = false;

          if (this.enablePredictiveLookahead && ps?.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
            tauSlot = Math.min(maxAvailSlot, Math.max(tauReq, this.config.minSlotDurationS));
            isFlush = true;
          } else {
            const maxSlot = Math.min(this.tauMaxNormalS, this.config.maxSlotDurationS);
            tauSlot = Math.min(tauReq, maxSlot, maxAvailSlot);
          }

          if (tauSlot < this.config.minSlotDurationS) continue;

          const capBits = Math.floor(tauSlot * rInst);
          const remainingBacklog = Math.max(0, qTotalBits - capBits);

          candidatePlan.push({
            node,
            nid,
            ls,
            ps,
            rInst,
            tauSlot,
            isFlush,
            remainingBacklogBits: remainingBacklog,
          });

          secRemainingUlTimeS -= (tauSlot + this.config.guardIntervalS);
        }

        // Pass 2: Work-Conserving Deficit Drainage
        // Redistribute leftover sector airtime to backlogged candidates without adding guard intervals
        if (secRemainingUlTimeS > 0.0001) {
          for (let i = 0; i < candidatePlan.length && secRemainingUlTimeS > 0.0001; i++) {
            const plan = candidatePlan[i];
            if (plan.remainingBacklogBits <= 0) continue;

            const extraTauReq = plan.remainingBacklogBits / plan.rInst;
            const maxAddTau = Math.min(
              this.config.maxSlotDurationS - plan.tauSlot,
              secRemainingUlTimeS
            );
            const addTau = Math.min(extraTauReq, maxAddTau);

            if (addTau > 0.00001) {
              plan.tauSlot += addTau;
              secRemainingUlTimeS -= addTau;
              const additionalBits = Math.floor(addTau * plan.rInst);
              plan.remainingBacklogBits = Math.max(0, plan.remainingBacklogBits - additionalBits);
            }
          }
        }

        // Step 4: Dequeue and materialize allocations for Sector k
        let secUsedTimeS = 0.0;
        let secSlotStartS = currentSimTimeS + this.config.ctrlDurationS + tDl;
        let secBitsTx = 0;

        for (let i = 0; i < candidatePlan.length; i++) {
          const plan = candidatePlan[i];
          const tauSlot = plan.tauSlot;
          const capBits = Math.floor(tauSlot * plan.rInst);
          const capBytes = Math.floor(capBits / 8);

          allocations.push({
            nodeId: plan.nid,
            slotStartS: secSlotStartS,
            durationS: tauSlot,
            timingAdvanceS: (plan.ls && plan.ls.slantRangeM > 0) ? (2.0 * plan.ls.slantRangeM) / SPEED_OF_LIGHT : 0.001,
            modcodName: plan.ls?.modcodName ?? 'LINK_OUTAGE',
            spectralEfficiency: plan.ls?.spectralEfficiency ?? 0.0,
            capacityBits: capBits,
            isPreOcclusionFlush: plan.isFlush,
            sectorId: k as 0 | 1 | 2 | 3,
          });

          scheduledIds.add(plan.nid);

          const served = plan.node.queue.dequeue(capBytes, currentSimTimeS);
          let bitsServed = 0;
          for (let p = 0; p < served.length; p++) {
            bitsServed += served[p].sizeBits;
          }
          totalPayloadBitsDequeued += bitsServed;
          totalBitsTx += bitsServed;
          secBitsTx += bitsServed;

          // Update Proportional Fairness moving average using variable superframe duration
          const rAchieved = bitsServed / this.config.frameDurationS;
          const rPrev = this.rAvg.get(plan.nid) ?? 100000.0;
          this.rAvg.set(plan.nid, (1.0 - this.alphaPf) * rPrev + this.alphaPf * rAchieved);

          const consumed = tauSlot + this.config.guardIntervalS;
          secUsedTimeS += consumed;
          secSlotStartS += consumed;
        }

        sectorScheduledUlS[k] = secUsedTimeS;
        sectorAvailableUlS[k] = tUlAvailable;
        sectorUnusedUlS[k] = Math.max(0, tUlAvailable - secUsedTimeS);
        sectorUtilizationPct[k] = tUlAvailable > 0 ? (secUsedTimeS / tUlAvailable) * 100.0 : 0.0;
        sectorGoodputBits[k] = secBitsTx;
      }

      // Decay PF throughput for unscheduled candidate nodes
      for (let i = 0; i < nodes.length; i++) {
        const nid = nodes[i].nodeId;
        if (!scheduledIds.has(nid)) {
          const rPrev = this.rAvg.get(nid) ?? 100000.0;
          this.rAvg.set(nid, (1.0 - this.alphaPf) * rPrev);
        }
      }

      this.trackScheduledNodes(nodes);
      const drops = collectDropMetrics(nodes, this.previousDropCounts);
      this.applyFrameDropMetrics(drops);
      const backlogBits = totalBacklogBits(nodes);

      const totalUlAvailableS = 4 * tUlAvailable;
      const totalUlScheduledS = sectorScheduledUlS.reduce((a, b) => a + b, 0);
      const totalUlUnusedS = Math.max(0, totalUlAvailableS - totalUlScheduledS);
      const utilPct = totalUlAvailableS > 0 ? (totalUlScheduledS / totalUlAvailableS) * 100.0 : 0.0;

      return {
        frameIndex,
        timestampS: currentSimTimeS,
        schedulerName: this.schedulerName,
        allocations,
        totalUlScheduledS,
        totalUlAvailableS,
        totalUlUnusedS,
        totalUlUtilizationPct: utilPct,
        totalPayloadBitsDequeued,
        totalBitsTransmitted: totalBitsTx,
        totalBitsWastedOnOutage: 0,
        ...this.buildDropReportFields(drops),
        totalBacklogBits: backlogBits,
        superframeDurationS: this.config.frameDurationS,
        ctrlDurationS: this.config.ctrlDurationS,
        dlDurationS: tDl,
        ulAvailableDurationS: tUlAvailable,
        sectorScheduledUlS,
        sectorAvailableUlS,
        sectorUnusedUlS,
        sectorUtilizationPct,
        sectorNodeCounts,
        sectorGoodputBits,
      };
    }

    // Step 1: Reclaim 100% time on severed links (Filter out hard shadow or 0 rate nodes)
    const candidateNodes: GroundNodeTrafficSubsystem[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const ps = getPred(node.nodeId);
      const ls = getLink(node.nodeId);

      const isHardShadow = ps?.isHardShadow !== undefined
        ? ps.isHardShadow
        : (ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF);

      if (
        isHardShadow ||
        (ls && (ls.bitrateBps <= 0 || ls.isOutage))
      ) {
        continue; // Do not dequeue payload or allocate airtime to an unusable link.
      }

      if (node.batteryLevelPct <= 0 || node.isDepleted) {
        continue; // Depleted battery cannot transmit.
      }

      if (
        node.queue.getTotalBacklogBits() === 0 &&
        ps?.currentState !== NodeTerrainState.PRE_OCCLUSION_FLUSH
      ) {
        continue;
      }

      candidateNodes.push(node);
    }

    // Step 2: Compute Lyapunov Composite Metric Psi_i
    const ranked: Array<{ psi: number; node: GroundNodeTrafficSubsystem }> = [];
    for (let i = 0; i < candidateNodes.length; i++) {
      const node = candidateNodes[i];
      const nid = node.nodeId;
      const ps = getPred(nid);
      const ls = getLink(nid);
      const q = node.queue;
      const qTotalBits = q.getTotalBacklogBits();

      // Urgency metric & HoL delay ratio
      let urgency = 0.0;
      let maxHolRatio = 0.0;
      for (const [qidStr, weight] of Object.entries(this.weights)) {
        const qid = Number(qidStr);
        if (q.getClassBacklogBytes(qid) > 0) {
          const hol = q.getHolDelayS(qid, currentSimTimeS);
          const pdb = QOS_PROFILES[qid]?.pdbS ?? 0.1;
          const ratio = hol / pdb;
          if (ratio > maxHolRatio) maxHolRatio = ratio;
          urgency += weight * Math.exp(Math.min(8.0, ratio));
        }
      }
      if (urgency === 0.0) urgency = 0.1;

      // Exponential HoL delay urgency boost when approaching PDB (>= 50% PDB elapsed)
      const holDelayBoost = maxHolRatio >= 0.5 ? Math.exp(Math.min(6.0, 3.0 * maxHolRatio)) : 1.0;

      // Proportional fairness
      const rInst = ls?.bitrateBps ?? 1e6;
      const rPrev = this.rAvg.get(nid) ?? 100000.0;
      const pfTerm = rInst / Math.max(1000.0, rPrev);

      // Backlog utility
      const backlogUtility = Math.max(1.0, Math.log2(1.0 + qTotalBits / 8000.0));

      // Predictive evacuation boost (strictly gated by enablePredictiveLookahead)
      let phiEvac = 1.0;
      if (this.enablePredictiveLookahead) {
        if (ps?.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
          const warning = 3.0;
          const tOcc = ps.timeToOcclusionS;
          const evacRatio = Math.max(0.0, (warning - tOcc) / warning);
          phiEvac = 1.0 + 5.0 * evacRatio * Math.min(1.0, qTotalBits / 20000.0);
        } else if (ps?.currentState === NodeTerrainState.RE_EMERGENCE_BURST) {
          phiEvac = 4.0;
        }
      }

      const priorityMultiplier = Math.max(0.1, Math.min(5.0, node.tacticalPriority ?? 1.0));
      const psi = phiEvac * urgency * holDelayBoost * pfTerm * backlogUtility * priorityMultiplier;
      ranked.push({ psi, node });
    }

    ranked.sort((a, b) => b.psi - a.psi);

    // Step 3: Work-Conserving Multi-Pass Slot Sizing
    const candidatePlan: Array<{
      node: GroundNodeTrafficSubsystem;
      nid: number;
      ls: LinkStatus | undefined;
      ps: PredictiveState | undefined;
      rInst: number;
      tauSlot: number;
      isFlush: boolean;
      remainingBacklogBits: number;
    }> = [];

    let remainingUlTimeS = tUlAvailable;

    // Pass 1: Primary allocation up to tauMaxNormalS (or flush duration)
    for (let i = 0; i < ranked.length; i++) {
      if (remainingUlTimeS < this.config.minSlotDurationS + this.config.guardIntervalS) break;

      const node = ranked[i].node;
      const nid = node.nodeId;
      const ps = getPred(nid);
      const ls = getLink(nid);
      const rInst = ls?.bitrateBps ?? 1e6;
      const qTotalBits = node.queue.getTotalBacklogBits();
      if (qTotalBits === 0) continue;

      const tauReq = qTotalBits / rInst;
      const maxAvailSlot = remainingUlTimeS - this.config.guardIntervalS;
      let tauSlot: number;
      let isFlush = false;

      if (this.enablePredictiveLookahead && ps?.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
        tauSlot = Math.min(maxAvailSlot, Math.max(tauReq, this.config.minSlotDurationS));
        isFlush = true;
      } else {
        const maxSlot = Math.min(this.tauMaxNormalS, this.config.maxSlotDurationS);
        tauSlot = Math.min(tauReq, maxSlot, maxAvailSlot);
      }

      if (tauSlot < this.config.minSlotDurationS) continue;

      const capBits = Math.floor(tauSlot * rInst);
      const remainingBacklog = Math.max(0, qTotalBits - capBits);

      candidatePlan.push({
        node,
        nid,
        ls,
        ps,
        rInst,
        tauSlot,
        isFlush,
        remainingBacklogBits: remainingBacklog,
      });

      remainingUlTimeS -= (tauSlot + this.config.guardIntervalS);
    }

    // Pass 2: Work-Conserving Deficit Drainage
    if (remainingUlTimeS > 0.0001) {
      for (let i = 0; i < candidatePlan.length && remainingUlTimeS > 0.0001; i++) {
        const plan = candidatePlan[i];
        if (plan.remainingBacklogBits <= 0) continue;

        const extraTauReq = plan.remainingBacklogBits / plan.rInst;
        const maxAddTau = Math.min(
          this.config.maxSlotDurationS - plan.tauSlot,
          remainingUlTimeS
        );
        const addTau = Math.min(extraTauReq, maxAddTau);

        if (addTau > 0.00001) {
          plan.tauSlot += addTau;
          remainingUlTimeS -= addTau;
          const additionalBits = Math.floor(addTau * plan.rInst);
          plan.remainingBacklogBits = Math.max(0, plan.remainingBacklogBits - additionalBits);
        }
      }
    }

    // Step 4: Dequeue and materialize allocations
    const allocations: SlotAllocation[] = [];
    let totalBitsTx = 0;
    let totalPayloadBitsDequeued = 0;
    let usedTimeS = 0.0;
    let slotStartS = currentSimTimeS + this.config.ctrlDurationS + tDl;
    const scheduledIds = new Set<number>();

    for (let i = 0; i < candidatePlan.length; i++) {
      const plan = candidatePlan[i];
      const tauSlot = plan.tauSlot;
      const capBits = Math.floor(tauSlot * plan.rInst);
      const capBytes = Math.floor(capBits / 8);

      allocations.push({
        nodeId: plan.nid,
        slotStartS,
        durationS: tauSlot,
        timingAdvanceS: (plan.ls && plan.ls.slantRangeM > 0) ? (2.0 * plan.ls.slantRangeM) / SPEED_OF_LIGHT : 0.001,
        modcodName: plan.ls?.modcodName ?? 'LINK_OUTAGE',
        spectralEfficiency: plan.ls?.spectralEfficiency ?? 0.0,
        capacityBits: capBits,
        isPreOcclusionFlush: plan.isFlush,
      });

      scheduledIds.add(plan.nid);

      const served = plan.node.queue.dequeue(capBytes, currentSimTimeS);
      let bitsServed = 0;
      for (let p = 0; p < served.length; p++) {
        bitsServed += served[p].sizeBits;
      }
      totalPayloadBitsDequeued += bitsServed;
      // Candidate filtering above excludes hard-shadow and reported-outage links.
      totalBitsTx += bitsServed;

      // Update Proportional Fairness moving average using variable superframe duration
      const rAchieved = bitsServed / this.config.frameDurationS;
      const rPrev = this.rAvg.get(plan.nid) ?? 100000.0;
      this.rAvg.set(plan.nid, (1.0 - this.alphaPf) * rPrev + this.alphaPf * rAchieved);

      const consumed = tauSlot + this.config.guardIntervalS;
      usedTimeS += consumed;
      slotStartS += consumed;
    }

    // Decay PF throughput for unscheduled candidate nodes
    for (let i = 0; i < nodes.length; i++) {
      const nid = nodes[i].nodeId;
      if (!scheduledIds.has(nid)) {
        const rPrev = this.rAvg.get(nid) ?? 100000.0;
        this.rAvg.set(nid, (1.0 - this.alphaPf) * rPrev);
      }
    }

    this.trackScheduledNodes(nodes);
    const drops = collectDropMetrics(nodes, this.previousDropCounts);
    this.applyFrameDropMetrics(drops);
    const backlogBits = totalBacklogBits(nodes);
    const utilPct = (usedTimeS / tUlAvailable) * 100.0;

    return {
      frameIndex,
      timestampS: currentSimTimeS,
      schedulerName: this.schedulerName,
      allocations,
      totalUlScheduledS: usedTimeS,
      totalUlAvailableS: tUlAvailable,
      totalUlUnusedS: Math.max(0, tUlAvailable - usedTimeS),
      totalUlUtilizationPct: utilPct,
      totalPayloadBitsDequeued,
      totalBitsTransmitted: totalBitsTx,
      // Tac-TAD filters unusable links before dequeue, so no dequeued payload is wasted on outage.
      totalBitsWastedOnOutage: 0,
      ...this.buildDropReportFields(drops),
      totalBacklogBits: backlogBits,
      superframeDurationS: this.config.frameDurationS,
      ctrlDurationS: this.config.ctrlDurationS,
      dlDurationS: tDl,
      ulAvailableDurationS: tUlAvailable,
      sectorScheduledUlS: [usedTimeS, 0, 0, 0],
      sectorAvailableUlS: [tUlAvailable, 0, 0, 0],
      sectorUnusedUlS: [Math.max(0, tUlAvailable - usedTimeS), 0, 0, 0],
      sectorUtilizationPct: [utilPct, 0, 0, 0],
      sectorNodeCounts: [nodes.length, 0, 0, 0],
      sectorGoodputBits: [totalBitsTx, 0, 0, 0],
    };
  }
}

/**
 * Reactive M-LWDF Scheduler (ablation baseline: lookahead disabled, Phi_evac = 1.0).
 */
export class ReactiveMlwdfScheduler extends TerrainAwareDynamicScheduler {
  public override readonly schedulerName: string = 'Reactive_M_LWDF';

  constructor(tauMaxNormalS: number = 0.008) {
    super(tauMaxNormalS, false);
  }
}
