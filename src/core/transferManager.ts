/**
 * Active Mission Transfer Manager for the X-Band Aerial Communication Network Digital Twin.
 *
 * Encapsulates application-layer file and message transfer tracking:
 * 1. Per-node transfer state transitions (IDLE, TRANSMITTING, BLOCKED_NLOS, ACKNOWLEDGED, FAILED_DROPPED).
 * 2. Payload delivery accumulation from scheduler slot allocations.
 * 3. Shadow occlusion detection and automatic resume on re-emergence.
 * 4. Queue drop attribution and transfer expiration.
 * 5. Instantaneous and smoothed transfer rate (bps) and ETA calculations.
 *
 * This module is part of the authoritative domain state machine layer.
 */

import { FRAME_DT } from '../shared/constants';
import { GroundNodeTrafficSubsystem, QOS_PROFILES } from './queues';
import { LinkStatus } from './linkBudget';
import { FrameScheduleReport } from './scheduler';
import { NodeTerrainState, PredictiveState } from './trajectory';
import {
  calculateTransferEtaSeconds,
  calculateTransferRateBps,
  smoothTransferRateBps,
} from './transferMetrics';

/** Active file / packet transfer state tracking for individual nodes */
export interface NodeTransferState {
  activeType: string | null;
  totalBytes: number;
  deliveredBytes: number;
  prevDeliveredBytes: number;
  droppedBytes: number;
  droppedPackets: number;
  status: 'IDLE' | 'TRANSMITTING' | 'BLOCKED_NLOS' | 'FAILED_DROPPED' | 'ACKNOWLEDGED';
  statusMessage: string;
  startTimeS: number;
  ackTimeS: number;
  lastQueueDrops: number;
  lastUpdateSimTimeS: number;
  currentRateBps: number;
  etaS: number | null;
  etaStatus: string;
}

/** Creates a fresh idle transfer state object */
export function createIdleTransferState(): NodeTransferState {
  return {
    activeType: null,
    totalBytes: 0,
    deliveredBytes: 0,
    prevDeliveredBytes: 0,
    droppedBytes: 0,
    droppedPackets: 0,
    status: 'IDLE',
    statusMessage: '',
    startTimeS: -1.0,
    ackTimeS: -1.0,
    lastQueueDrops: 0,
    lastUpdateSimTimeS: -1.0,
    currentRateBps: 0,
    etaS: null,
    etaStatus: 'STANDBY',
  };
}

/** Standard default byte sizes for recognized tactical traffic types */
export function getDefaultPayloadBytes(trafficType: string): number {
  const ttype = trafficType.toUpperCase();
  if (ttype.includes('PHOTO')) return 2000000;
  if (ttype.includes('VIDEO')) return 42000;
  if (ttype.includes('VOICE')) return 8000;
  return 2560; // Default SOS / C2
}

/** Parameters required for a 50 Hz discrete transfer state machine advancement step */
export interface ActiveTransferStepParams {
  readonly activeNodes: readonly GroundNodeTrafficSubsystem[];
  readonly linkStatuses: ReadonlyMap<number, LinkStatus>;
  readonly predStates: ReadonlyMap<number, PredictiveState>;
  readonly activeReport: FrameScheduleReport | null;
  readonly simTimeS: number;
  readonly isPaused: boolean;
}

export class ActiveTransferManager {
  private readonly transfers = new Map<number, NodeTransferState>();

  /**
   * Returns a read-only map of all tracked node transfer states.
   */
  public get states(): ReadonlyMap<number, NodeTransferState> {
    return this.transfers;
  }

  /**
   * Returns the transfer state for a specific ground node, or undefined if untracked.
   */
  public get(nodeId: number): NodeTransferState | undefined {
    return this.transfers.get(nodeId);
  }

  /**
   * Returns the transfer state for a specific ground node, or undefined if untracked.
   * Alias for get(nodeId) supporting explicit semantic queries.
   */
  public getNodeTransferState(nodeId: number): NodeTransferState | undefined {
    return this.transfers.get(nodeId);
  }

  /**
   * Checks whether a ground node has an active transfer entry.
   */
  public has(nodeId: number): boolean {
    return this.transfers.has(nodeId);
  }

  /**
   * Resets all transfer records, optionally populating idle records for the given node IDs.
   */
  public reset(nodeIds?: Iterable<number>): void {
    this.transfers.clear();
    if (nodeIds) {
      for (const nid of nodeIds) {
        this.transfers.set(nid, createIdleTransferState());
      }
    }
  }

  /**
   * Registers an initial idle transfer slot for a new or duplicated ground node.
   */
  public registerNode(nodeId: number): void {
    this.transfers.set(nodeId, createIdleTransferState());
  }

  /**
   * Evicts transfer tracking for a deleted ground node.
   */
  public evictNode(nodeId: number): boolean {
    return this.transfers.delete(nodeId);
  }

  /**
   * Resets a node's active transfer state back to IDLE (e.g. on CLEAR_TRANSFER).
   */
  public clearTransfer(nodeId: number): void {
    this.transfers.set(nodeId, createIdleTransferState());
  }

  /**
   * Initializes or updates an active transfer for a node (e.g. from INJECT_TRAFFIC or scenario preset).
   */
  public startTransfer(
    nodeId: number,
    trafficType: string,
    totalBytes: number,
    simTimeS: number,
    isBlocked: boolean,
    customMessage?: string
  ): void {
    const status = isBlocked ? 'BLOCKED_NLOS' : 'TRANSMITTING';
    const statusMessage = customMessage ?? (
      isBlocked
        ? 'TERRAIN BLOCKED: Packet buffered awaiting re-emergence.'
        : 'TRANSMITTING: Uplink active.'
    );
    const etaStatus = isBlocked ? 'BLOCKED (PAUSED)' : 'CALCULATING';

    this.transfers.set(nodeId, {
      activeType: trafficType,
      totalBytes,
      deliveredBytes: 0,
      prevDeliveredBytes: 0,
      droppedBytes: 0,
      droppedPackets: 0,
      status,
      statusMessage,
      startTimeS: simTimeS,
      ackTimeS: -1,
      lastQueueDrops: 0,
      lastUpdateSimTimeS: simTimeS,
      currentRateBps: 0,
      etaS: null,
      etaStatus,
    });
  }

  /**
   * Authoritative 50 Hz discrete simulation transfer state machine update.
   */
  public step(params: ActiveTransferStepParams): void {
    const qosMap: Record<string, number> = {
      SOS: 69, C2: 69, EMERGENCY: 69,
      VOICE: 65, PTT: 65,
      VIDEO: 67,
      PHOTO: 70, IMAGE: 70,
    };

    for (const node of params.activeNodes) {
      const nid = node.nodeId;
      const trans = this.transfers.get(nid);
      if (!trans || trans.status === 'IDLE') {
        continue;
      }

      if (trans.status === 'ACKNOWLEDGED' || trans.status === 'FAILED_DROPPED') {
        trans.currentRateBps = 0;
        trans.etaS = trans.status === 'ACKNOWLEDGED' ? 0 : null;
        trans.etaStatus = trans.status === 'ACKNOWLEDGED' ? 'COMPLETE' : 'DROPPED';
        continue;
      }

      const activeT = trans.activeType ?? 'SOS';
      const targetQos = qosMap[activeT] ?? 69;
      const pred = params.predStates.get(nid);
      const currState = pred?.currentState ?? NodeTerrainState.NORMAL_LOS;
      const ls = params.linkStatuses.get(nid);
      const isOutage = ls?.isOutage ?? true;

      if ((currState === NodeTerrainState.HARD_SHADOW_CUTOFF || isOutage) && trans.status === 'TRANSMITTING') {
        trans.status = 'BLOCKED_NLOS';
        trans.statusMessage = 'TERRAIN OCCLUSION: Link severed by ridge. Uplink paused.';
      } else if (!isOutage && currState !== NodeTerrainState.HARD_SHADOW_CUTOFF && trans.status === 'BLOCKED_NLOS') {
        trans.status = 'TRANSMITTING';
        trans.statusMessage = 'RE-EMERGED: Resuming uplink transfer.';
      }

      const currDrops = node.queue.droppedDelayCount + node.queue.droppedOverflowCount;
      const deltaDrops = Math.max(0, currDrops - trans.lastQueueDrops);
      trans.lastQueueDrops = currDrops;

      if (deltaDrops > 0) {
        const avgSz = QOS_PROFILES[targetQos]?.defaultBytes ?? 1200;
        trans.droppedPackets += deltaDrops;
        trans.droppedBytes += deltaDrops * avgSz;
      }

      if (!isOutage && trans.status === 'TRANSMITTING') {
        const alloc = params.activeReport?.allocations.find((a) => a.nodeId === nid);
        if (alloc && alloc.capacityBits > 0) {
          const bytesServed = Math.floor(alloc.capacityBits / 8);
          trans.deliveredBytes = Math.min(trans.totalBytes, trans.deliveredBytes + bytesServed);

          if (activeT === 'SOS' || activeT === 'C2') {
            trans.status = 'ACKNOWLEDGED';
            trans.ackTimeS = params.simTimeS;
            trans.statusMessage = `[✓] SOS ACKNOWLEDGED BY ACN AT T+${params.simTimeS.toFixed(2)}s`;
          } else if (trans.deliveredBytes >= trans.totalBytes) {
            trans.status = 'ACKNOWLEDGED';
            trans.ackTimeS = params.simTimeS;
            trans.statusMessage = `[✓] ${activeT} FULLY DELIVERED & ACKNOWLEDGED AT T+${params.simTimeS.toFixed(2)}s`;
          }
        }
      }

      const subqLen = node.queue.getClassPacketCount(targetQos);
      if (
        (trans.status === 'TRANSMITTING' || trans.status === 'BLOCKED_NLOS') &&
        trans.droppedPackets > 0 &&
        subqLen === 0 &&
        trans.deliveredBytes < trans.totalBytes
      ) {
        trans.status = 'FAILED_DROPPED';
        trans.statusMessage = `[✖] ${activeT} FAILED: Packets expired/dropped in mountain shadow!`;
      }

      // Update transfer rate and ETA strictly using simulation-time differences
      const dtSim = trans.lastUpdateSimTimeS >= 0 ? Math.max(0.001, params.simTimeS - trans.lastUpdateSimTimeS) : FRAME_DT;
      const deliveredDelta = Math.max(0, trans.deliveredBytes - trans.prevDeliveredBytes);
      trans.prevDeliveredBytes = trans.deliveredBytes;
      trans.lastUpdateSimTimeS = params.simTimeS;

      if (trans.status === 'TRANSMITTING') {
        const instRate = calculateTransferRateBps(deliveredDelta, dtSim);
        trans.currentRateBps = smoothTransferRateBps(trans.currentRateBps, instRate, 0.3);
      } else {
        trans.currentRateBps = 0;
      }

      const remaining = Math.max(0, trans.totalBytes - trans.deliveredBytes);
      const eta = calculateTransferEtaSeconds(remaining, trans.currentRateBps, trans.status, params.isPaused);
      trans.etaS = eta.etaS;
      trans.etaStatus = eta.etaStatus;
    }
  }
}
