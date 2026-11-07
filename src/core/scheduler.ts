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

import { LinkStatus } from './linkBudget';
import { GroundNodeTrafficSubsystem, QOS_PROFILES } from './queues';
import { NodeTerrainState, PredictiveState } from './trajectory';
import { TdmaFrameConfig } from './tdmaConfig';

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
}

interface DropMetrics {
  delayTotal: number;
  overflowTotal: number;
  delayThisFrame: number;
  overflowThisFrame: number;
}

/** Queue counters are cumulative, so report both totals and non-negative per-frame deltas. */
function collectDropMetrics(
  nodes: readonly GroundNodeTrafficSubsystem[],
  previous: Map<number, { delay: number; overflow: number }>
): DropMetrics {
  let delayTotal = 0;
  let overflowTotal = 0;
  let delayThisFrame = 0;
  let overflowThisFrame = 0;
  for (const node of nodes) {
    const delay = node.queue.droppedDelayCount;
    const overflow = node.queue.droppedOverflowCount;
    const prev = previous.get(node.nodeId) ?? { delay: 0, overflow: 0 };
    delayTotal += delay;
    overflowTotal += overflow;
    delayThisFrame += Math.max(0, delay - prev.delay);
    overflowThisFrame += Math.max(0, overflow - prev.overflow);
    previous.set(node.nodeId, { delay, overflow });
  }
  return { delayTotal, overflowTotal, delayThisFrame, overflowThisFrame };
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
  evictNode?(nodeId: number): void;
}

/**
 * Legacy Static Equal-Slot TDMA Scheduler.
 *
 * Divides uplink time equally across all N registered nodes:
 *   tauSlot = (T_UL_NOMINAL_S - N * TAU_GUARD_S) / N (exactly 988 us for N=16)
 * Blindly transmits into mountain shadow obstacles, wasting up to 33% of frame time.
 */
export class LegacyStaticScheduler implements BaseScheduler {
  public readonly schedulerName: string = 'Legacy_Static_TDMA';
  private config: TdmaFrameConfig = new TdmaFrameConfig();
  private readonly previousDropCounts = new Map<number, { delay: number; overflow: number }>();

  public setTdmaConfig(config: TdmaFrameConfig): void {
    this.config = config;
  }

  public evictNode(nodeId: number): void {
    this.previousDropCounts.delete(nodeId);
  }

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
        packetsDroppedDelay: 0,
        packetsDroppedOverflow: 0,
        packetsDroppedDelayThisFrame: 0,
        packetsDroppedOverflowThisFrame: 0,
        totalBacklogBits: 0,
        superframeDurationS: this.config.frameDurationS,
        ctrlDurationS: this.config.ctrlDurationS,
        dlDurationS: this.config.dlMinDurationS,
        ulAvailableDurationS: tUlAvailable,
      };
    }

    const tauSlot = (tUlAvailable - K * this.config.guardIntervalS) / K;

    const allocations: SlotAllocation[] = [];
    let totalBitsTx = 0;
    let totalBitsWasted = 0;
    let totalPayloadBitsDequeued = 0;
    let usedTimeS = 0.0;
    let slotStartS = currentSimTimeS + this.config.ctrlDurationS + this.config.dlMinDurationS;

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
        timingAdvanceS: 0.001,
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
        if (ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF || ls?.isOutage) {
          totalBitsWasted += bitsServed;
        } else {
          totalBitsTx += bitsServed;
        }
      }
    }

    const drops = collectDropMetrics(nodes, this.previousDropCounts);
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
      packetsDroppedDelay: drops.delayTotal,
      packetsDroppedOverflow: drops.overflowTotal,
      packetsDroppedDelayThisFrame: drops.delayThisFrame,
      packetsDroppedOverflowThisFrame: drops.overflowThisFrame,
      totalBacklogBits: backlogBits,
      superframeDurationS: this.config.frameDurationS,
      ctrlDurationS: this.config.ctrlDurationS,
      dlDurationS: this.config.dlMinDurationS,
      ulAvailableDurationS: tUlAvailable,
    };
  }
}

/**
 * Terrain-Aware Dynamic Scheduler (Tac-TAD).
 */
export class TerrainAwareDynamicScheduler implements BaseScheduler {
  public readonly schedulerName: string = 'Tac_TAD';
  public readonly tauMaxNormalS: number;
  private config: TdmaFrameConfig = new TdmaFrameConfig();
  private readonly previousDropCounts = new Map<number, { delay: number; overflow: number }>();

  private readonly rAvg: Map<number, number> = new Map();
  private readonly alphaPf: number = 0.05;
  private readonly weights: Readonly<Record<number, number>> = {
    69: 200.0,
    65: 50.0,
    67: 2.0,
    70: 1.0,
  };

  constructor(tauMaxNormalS: number = 0.008) {
    this.tauMaxNormalS = tauMaxNormalS;
  }

  public setTdmaConfig(config: TdmaFrameConfig): void {
    this.config = config;
  }

  public evictNode(nodeId: number): void {
    this.previousDropCounts.delete(nodeId);
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
        packetsDroppedDelay: 0,
        packetsDroppedOverflow: 0,
        packetsDroppedDelayThisFrame: 0,
        packetsDroppedOverflowThisFrame: 0,
        totalBacklogBits: 0,
        superframeDurationS: this.config.frameDurationS,
        ctrlDurationS: this.config.ctrlDurationS,
        dlDurationS: tDl,
        ulAvailableDurationS: tUlAvailable,
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

    // Step 1: Reclaim 100% time on severed links (Filter out hard shadow or 0 rate nodes)
    const candidateNodes: GroundNodeTrafficSubsystem[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const ps = getPred(node.nodeId);
      const ls = getLink(node.nodeId);

      if (
        ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF ||
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

      // Urgency metric
      let urgency = 0.0;
      for (const [qidStr, weight] of Object.entries(this.weights)) {
        const qid = Number(qidStr);
        if (q.getClassBacklogBytes(qid) > 0) {
          const hol = q.getHolDelayS(qid, currentSimTimeS);
          const pdb = QOS_PROFILES[qid]?.pdbS ?? 0.1;
          urgency += weight * Math.exp(Math.min(8.0, hol / pdb));
        }
      }
      if (urgency === 0.0) urgency = 0.1;

      // Proportional fairness
      const rInst = ls?.bitrateBps ?? 1e6;
      const rPrev = this.rAvg.get(nid) ?? 100000.0;
      const pfTerm = rInst / Math.max(1000.0, rPrev);

      // Backlog utility
      const backlogUtility = Math.max(1.0, Math.log2(1.0 + qTotalBits / 8000.0));

      // Predictive evacuation boost
      let phiEvac = 1.0;
      if (ps?.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
        const warning = 3.0;
        const tOcc = ps.timeToOcclusionS;
        const evacRatio = Math.max(0.0, (warning - tOcc) / warning);
        phiEvac = 1.0 + 5.0 * evacRatio * Math.min(1.0, qTotalBits / 20000.0);
      } else if (ps?.currentState === NodeTerrainState.RE_EMERGENCE_BURST) {
        phiEvac = 4.0;
      }

      const priorityMultiplier = Math.max(0.1, Math.min(5.0, node.tacticalPriority ?? 1.0));
      const psi = phiEvac * urgency * pfTerm * backlogUtility * priorityMultiplier;
      ranked.push({ psi, node });
    }

    ranked.sort((a, b) => b.psi - a.psi);

    // Step 3: Exact-Fit Slot Sizing
    const allocations: SlotAllocation[] = [];
    let totalBitsTx = 0;
    let totalPayloadBitsDequeued = 0;
    let usedTimeS = 0.0;
    let remainingUlTimeS = tUlAvailable;
    let slotStartS = currentSimTimeS + this.config.ctrlDurationS + tDl;
    const scheduledIds = new Set<number>();

    for (let i = 0; i < ranked.length; i++) {
      if (remainingUlTimeS < this.config.minSlotDurationS) break;

      const node = ranked[i].node;
      const nid = node.nodeId;
      const ps = getPred(nid);
      const ls = getLink(nid);
      const rInst = ls?.bitrateBps ?? 1e6;
      const qTotalBits = node.queue.getTotalBacklogBits();
      if (qTotalBits === 0) continue;

      const tauReq = qTotalBits / rInst;
      let tauSlot: number;
      let isFlush = false;

      if (ps?.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
        tauSlot = Math.min(remainingUlTimeS - this.config.guardIntervalS, Math.max(tauReq, this.config.minSlotDurationS));
        isFlush = true;
      } else {
        const maxSlot = Math.min(this.tauMaxNormalS, this.config.maxSlotDurationS);
        tauSlot = Math.min(tauReq, maxSlot, remainingUlTimeS - this.config.guardIntervalS);
      }

      if (tauSlot < this.config.minSlotDurationS) continue;

      const capBits = Math.floor(tauSlot * rInst);
      const capBytes = Math.floor(capBits / 8);

      allocations.push({
        nodeId: nid,
        slotStartS,
        durationS: tauSlot,
        timingAdvanceS: 0.001,
        modcodName: ls?.modcodName ?? 'LINK_OUTAGE',
        spectralEfficiency: ls?.spectralEfficiency ?? 0.0,
        capacityBits: capBits,
        isPreOcclusionFlush: isFlush,
      });

      scheduledIds.add(nid);

      const served = node.queue.dequeue(capBytes, currentSimTimeS);
      let bitsServed = 0;
      for (let p = 0; p < served.length; p++) {
        bitsServed += served[p].sizeBits;
      }
      totalPayloadBitsDequeued += bitsServed;
      // Candidate filtering above excludes hard-shadow and reported-outage links.
      totalBitsTx += bitsServed;

      // Update Proportional Fairness moving average using variable superframe duration
      const rAchieved = bitsServed / this.config.frameDurationS;
      const rPrev = this.rAvg.get(nid) ?? 100000.0;
      this.rAvg.set(nid, (1.0 - this.alphaPf) * rPrev + this.alphaPf * rAchieved);

      const consumed = tauSlot + this.config.guardIntervalS;
      usedTimeS += consumed;
      slotStartS += consumed;
      remainingUlTimeS -= consumed;
    }

    // Decay PF throughput for unscheduled candidate nodes
    for (let i = 0; i < nodes.length; i++) {
      const nid = nodes[i].nodeId;
      if (!scheduledIds.has(nid)) {
        const rPrev = this.rAvg.get(nid) ?? 100000.0;
        this.rAvg.set(nid, (1.0 - this.alphaPf) * rPrev);
      }
    }

    const drops = collectDropMetrics(nodes, this.previousDropCounts);
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
      packetsDroppedDelay: drops.delayTotal,
      packetsDroppedOverflow: drops.overflowTotal,
      packetsDroppedDelayThisFrame: drops.delayThisFrame,
      packetsDroppedOverflowThisFrame: drops.overflowThisFrame,
      totalBacklogBits: backlogBits,
      superframeDurationS: this.config.frameDurationS,
      ctrlDurationS: this.config.ctrlDurationS,
      dlDurationS: tDl,
      ulAvailableDurationS: tUlAvailable,
    };
  }
}