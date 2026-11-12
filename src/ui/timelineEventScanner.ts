/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Simulation Timeline Event Scanner (DRDO-TAC-XBAND-ARCH-TIMELINE-17)
 *
 * Implements Feature D (SPEC-TIMELINE-ENHANCE-01-REV10):
 * - Scans ingested spatial frames and communication epochs across 10 physical event types.
 * - Gap-aware scanning: strictly suppresses transitions across sequence gaps or buffer discontinuities.
 * - Multi-node clustering: aggregates simultaneous node transitions on the same frame.
 * - Evaluates drop spike thresholds (N_drop_thresh) and assigns scheduler discriminators:
 *   STATIC_TDMA, TAC_TAD, or BOTH.
 */

import type { SpatialSnapshotBuffer } from './spatialSnapshotBuffer';
import type { SuperframeEpochStore } from './superframeEpochStore';
import type {
  SpatialNodeSnapshot,
  SuperframeEpochRecord,
  SuperframeDiscontinuityRecord,
} from '../shared/workerProtocol';

export type TimelineEventType =
  | 'TERRAIN_LOS_LOSS'
  | 'TERRAIN_LOS_RECOVERY'
  | 'MAN_MADE_OBSTACLE_ENTER'
  | 'MAN_MADE_OBSTACLE_CLEAR'
  | 'COMM_OUTAGE_START'
  | 'COMM_OUTAGE_END'
  | 'LOOKAHEAD_TRANSITION'
  | 'RECONFIGURATION_RESET'
  | 'QUEUE_OVERFLOW_DROP'
  | 'SIGNIFICANT_DROP_SPIKE';

export type EventSchedulerId = 'STATIC_TDMA' | 'TAC_TAD' | 'BOTH' | null;

export interface TimelineEventMarker {
  readonly id: string;
  readonly eventType: TimelineEventType;
  readonly timestampS: number;
  readonly frameIndex?: number;
  readonly epochIndex?: number;
  readonly nodeIds?: readonly number[];
  readonly schedulerId?: EventSchedulerId;
  readonly color: string;
  readonly precision: string;
  readonly label: string;
  readonly details: string;
}

export const EVENT_COLORS: Record<TimelineEventType, string> = {
  TERRAIN_LOS_LOSS: '#e05347',
  TERRAIN_LOS_RECOVERY: '#52b788',
  MAN_MADE_OBSTACLE_ENTER: '#f0b85c',
  MAN_MADE_OBSTACLE_CLEAR: '#48cae4',
  COMM_OUTAGE_START: '#9d4edd',
  COMM_OUTAGE_END: '#5390d9',
  LOOKAHEAD_TRANSITION: '#e9c46a',
  RECONFIGURATION_RESET: '#ffd166',
  QUEUE_OVERFLOW_DROP: '#d90429',
  SIGNIFICANT_DROP_SPIKE: '#f77f00',
};

export interface ScanTimelineEventsOptions {
  readonly spatialBuffer: SpatialSnapshotBuffer;
  readonly epochStore: SuperframeEpochStore;
  readonly dropThreshold?: number;
}

/**
 * Scans spatial snapshots and communication records to detect physical events.
 */
export function scanTimelineEvents(options: ScanTimelineEventsOptions): TimelineEventMarker[] {
  const events: TimelineEventMarker[] = [];
  const { spatialBuffer, epochStore } = options;
  const dropThresh = options.dropThreshold ?? 5;

  // 1. Scan Spatial Kinematic Frames for Node State Transitions
  if (spatialBuffer && spatialBuffer.count > 1) {
    let prevSnap = spatialBuffer.get(0);

    for (let i = 1; i < spatialBuffer.count; i++) {
      const currSnap = spatialBuffer.get(i);
      if (!currSnap) continue;

      if (!prevSnap) {
        prevSnap = currSnap;
        continue;
      }

      // Gap-Aware Scanning: Never evaluate transitions across discontinuity gaps
      if (currSnap.frameIndex !== prevSnap.frameIndex + 1) {
        prevSnap = currSnap;
        continue;
      }

      // Map previous node states
      const prevNodesMap = new Map<number, SpatialNodeSnapshot>();
      for (let j = 0; j < prevSnap.nodes.length; j++) {
        const pn = prevSnap.nodes[j];
        prevNodesMap.set(pn.nodeId, pn);
      }

      // Buckets for clustering simultaneous node transitions on currSnap
      const losLossNodes: number[] = [];
      const losRecoveryNodes: number[] = [];
      const obstacleEnterNodes: number[] = [];
      const obstacleClearNodes: number[] = [];
      const outageStartNodes: number[] = [];
      const outageEndNodes: number[] = [];
      const lookaheadTransitionNodes: number[] = [];

      for (let j = 0; j < currSnap.nodes.length; j++) {
        const cn = currSnap.nodes[j];
        const pn = prevNodesMap.get(cn.nodeId);
        if (!pn) continue; // Newly added node, no transition from prior frame

        // 1. Terrain LOS Loss / Recovery (precision ±20ms)
        if (pn.isLos && !cn.isLos) {
          losLossNodes.push(cn.nodeId);
        } else if (!pn.isLos && cn.isLos) {
          losRecoveryNodes.push(cn.nodeId);
        }

        // 2. 3D Obstacle Enter / Clear
        if (!pn.isObstacleBlocked && cn.isObstacleBlocked) {
          obstacleEnterNodes.push(cn.nodeId);
        } else if (pn.isObstacleBlocked && !cn.isObstacleBlocked) {
          obstacleClearNodes.push(cn.nodeId);
        }

        // 3. Comm Outage Start / End
        if (!pn.isOutage && cn.isOutage) {
          outageStartNodes.push(cn.nodeId);
        } else if (pn.isOutage && !cn.isOutage) {
          outageEndNodes.push(cn.nodeId);
        }

        // 4. Lookahead State Transition
        if (pn.currentState !== cn.currentState) {
          lookaheadTransitionNodes.push(cn.nodeId);
        }
      }

      const fIdx = currSnap.frameIndex;
      const tS = currSnap.simulationTimeS;

      if (losLossNodes.length > 0) {
        events.push({
          id: `terrain-los-loss-${fIdx}`,
          eventType: 'TERRAIN_LOS_LOSS',
          timestampS: tS,
          frameIndex: fIdx,
          nodeIds: losLossNodes,
          color: EVENT_COLORS.TERRAIN_LOS_LOSS,
          precision: '±20ms',
          label: losLossNodes.length === 1 ? `Terrain LOS Loss (Node ${losLossNodes[0]})` : `Terrain LOS Loss (${losLossNodes.length} nodes)`,
          details: `Terrain LOS Loss: Node(s) [${losLossNodes.join(', ')}] lost line-of-sight (±20ms)`,
        });
      }

      if (losRecoveryNodes.length > 0) {
        events.push({
          id: `terrain-los-recovery-${fIdx}`,
          eventType: 'TERRAIN_LOS_RECOVERY',
          timestampS: tS,
          frameIndex: fIdx,
          nodeIds: losRecoveryNodes,
          color: EVENT_COLORS.TERRAIN_LOS_RECOVERY,
          precision: '±20ms',
          label: losRecoveryNodes.length === 1 ? `Terrain LOS Recovery (Node ${losRecoveryNodes[0]})` : `Terrain LOS Recovery (${losRecoveryNodes.length} nodes)`,
          details: `Terrain LOS Recovery: Node(s) [${losRecoveryNodes.join(', ')}] restored line-of-sight (±20ms)`,
        });
      }

      if (obstacleEnterNodes.length > 0) {
        events.push({
          id: `obstacle-enter-${fIdx}`,
          eventType: 'MAN_MADE_OBSTACLE_ENTER',
          timestampS: tS,
          frameIndex: fIdx,
          nodeIds: obstacleEnterNodes,
          color: EVENT_COLORS.MAN_MADE_OBSTACLE_ENTER,
          precision: '±20ms',
          label: obstacleEnterNodes.length === 1 ? `3D Obstacle Enter (Node ${obstacleEnterNodes[0]})` : `3D Obstacle Enter (${obstacleEnterNodes.length} nodes)`,
          details: `3D Obstacle Enter: Node(s) [${obstacleEnterNodes.join(', ')}] entered obstacle shadow (±20ms)`,
        });
      }

      if (obstacleClearNodes.length > 0) {
        events.push({
          id: `obstacle-clear-${fIdx}`,
          eventType: 'MAN_MADE_OBSTACLE_CLEAR',
          timestampS: tS,
          frameIndex: fIdx,
          nodeIds: obstacleClearNodes,
          color: EVENT_COLORS.MAN_MADE_OBSTACLE_CLEAR,
          precision: '±20ms',
          label: obstacleClearNodes.length === 1 ? `3D Obstacle Clear (Node ${obstacleClearNodes[0]})` : `3D Obstacle Clear (${obstacleClearNodes.length} nodes)`,
          details: `3D Obstacle Clear: Node(s) [${obstacleClearNodes.join(', ')}] cleared obstacle shadow (±20ms)`,
        });
      }

      if (outageStartNodes.length > 0) {
        events.push({
          id: `comm-outage-start-${fIdx}`,
          eventType: 'COMM_OUTAGE_START',
          timestampS: tS,
          frameIndex: fIdx,
          nodeIds: outageStartNodes,
          color: EVENT_COLORS.COMM_OUTAGE_START,
          precision: '±20ms',
          label: outageStartNodes.length === 1 ? `Comm Outage Start (Node ${outageStartNodes[0]})` : `Comm Outage Start (${outageStartNodes.length} nodes)`,
          details: `Comm Outage Start: Node(s) [${outageStartNodes.join(', ')}] entered link outage (±20ms)`,
        });
      }

      if (outageEndNodes.length > 0) {
        events.push({
          id: `comm-outage-end-${fIdx}`,
          eventType: 'COMM_OUTAGE_END',
          timestampS: tS,
          frameIndex: fIdx,
          nodeIds: outageEndNodes,
          color: EVENT_COLORS.COMM_OUTAGE_END,
          precision: '±20ms',
          label: outageEndNodes.length === 1 ? `Comm Outage End (Node ${outageEndNodes[0]})` : `Comm Outage End (${outageEndNodes.length} nodes)`,
          details: `Comm Outage End: Node(s) [${outageEndNodes.join(', ')}] exited link outage (±20ms)`,
        });
      }

      if (lookaheadTransitionNodes.length > 0) {
        events.push({
          id: `lookahead-transition-${fIdx}`,
          eventType: 'LOOKAHEAD_TRANSITION',
          timestampS: tS,
          frameIndex: fIdx,
          nodeIds: lookaheadTransitionNodes,
          schedulerId: 'TAC_TAD',
          color: EVENT_COLORS.LOOKAHEAD_TRANSITION,
          precision: '±20ms',
          label: lookaheadTransitionNodes.length === 1 ? `FSM Transition (Node ${lookaheadTransitionNodes[0]})` : `FSM Transition (${lookaheadTransitionNodes.length} nodes)`,
          details: `Lookahead FSM Transition: Node(s) [${lookaheadTransitionNodes.join(', ')}] transitioned state (±20ms)`,
        });
      }

      prevSnap = currSnap;
    }
  }

  // 2. Scan Communication Epochs & Discontinuities
  if (epochStore && epochStore.count > 0) {
    for (let i = 0; i < epochStore.count; i++) {
      const rec = epochStore.get(i);
      if (!rec) continue;

      if (rec.recordType === 'DISCONTINUITY') {
        const disRec = rec as SuperframeDiscontinuityRecord;
        const reasonStr = disRec.reconfigurationReason ?? disRec.reason ?? 'Waveform Reconfiguration';
        events.push({
          id: `discontinuity-${disRec.discontinuityIndex ?? i}`,
          eventType: 'RECONFIGURATION_RESET',
          timestampS: disRec.startTimeS,
          color: EVENT_COLORS.RECONFIGURATION_RESET,
          precision: 'Exact',
          label: 'Reconfiguration Reset',
          details: `Reconfiguration Reset: ${reasonStr} (Exact t = ${disRec.startTimeS} s)`,
        });
      } else if (rec.recordType === 'EPOCH') {
        const ep = rec as SuperframeEpochRecord;

        // Queue Overflow Drop
        const staticOverflow = ep.staticMetrics.droppedOverflowPkts > 0;
        const tacOverflow = ep.tacMetrics.droppedOverflowPkts > 0;
        if (staticOverflow || tacOverflow) {
          const schedulerId: EventSchedulerId = (staticOverflow && !tacOverflow)
            ? 'STATIC_TDMA'
            : (!staticOverflow && tacOverflow)
              ? 'TAC_TAD'
              : 'BOTH';

          events.push({
            id: `queue-overflow-${ep.epochIndex ?? i}`,
            eventType: 'QUEUE_OVERFLOW_DROP',
            timestampS: ep.endTimeS,
            epochIndex: ep.epochIndex,
            schedulerId,
            color: EVENT_COLORS.QUEUE_OVERFLOW_DROP,
            precision: `±${ep.durationMs}ms`,
            label: `Queue Overflow Drop (${schedulerId})`,
            details: `Queue Overflow Drop (${schedulerId}): static=${ep.staticMetrics.droppedOverflowPkts}, tac=${ep.tacMetrics.droppedOverflowPkts} (±${ep.durationMs}ms)`,
          });
        }

        // Significant Drop Spike (totalDroppedPkts >= dropThreshold)
        const staticSpike = ep.staticMetrics.totalDroppedPkts >= dropThresh;
        const tacSpike = ep.tacMetrics.totalDroppedPkts >= dropThresh;
        if (staticSpike || tacSpike) {
          const schedulerId: EventSchedulerId = (staticSpike && !tacSpike)
            ? 'STATIC_TDMA'
            : (!staticSpike && tacSpike)
              ? 'TAC_TAD'
              : 'BOTH';

          events.push({
            id: `drop-spike-${ep.epochIndex ?? i}`,
            eventType: 'SIGNIFICANT_DROP_SPIKE',
            timestampS: ep.endTimeS,
            epochIndex: ep.epochIndex,
            schedulerId,
            color: EVENT_COLORS.SIGNIFICANT_DROP_SPIKE,
            precision: `±${ep.durationMs}ms`,
            label: `Significant Drop Spike (${schedulerId})`,
            details: `Drop spike >= ${dropThresh} pkts (${schedulerId}: static=${ep.staticMetrics.totalDroppedPkts}, tac=${ep.tacMetrics.totalDroppedPkts}) (±${ep.durationMs}ms)`,
          });
        }
      }
    }
  }

  // 3. Scan Retained Eviction Finalizations (Point-in-time NODE_DELETE Drop Captures)
  const evictionRecords =
    epochStore && typeof epochStore.getEvictionFinalizations === 'function'
      ? epochStore.getEvictionFinalizations()
      : [];
  for (let i = 0; i < evictionRecords.length; i++) {
    const ev = evictionRecords[i];
    const schedulerId: EventSchedulerId = ev.schedulerId;
    if (ev.droppedOverflowPkts > 0) {
      events.push({
        id: `eviction-overflow-${ev.finalizationIndex}-${ev.schedulerId}`,
        eventType: 'QUEUE_OVERFLOW_DROP',
        timestampS: ev.timestampS,
        frameIndex: ev.associatedSimulationFrameIndex,
        nodeIds: [ev.nodeId],
        schedulerId,
        color: EVENT_COLORS.QUEUE_OVERFLOW_DROP,
        precision: 'Exact (Eviction)',
        label: `Queue Overflow Drop on Eviction (${schedulerId}, Node ${ev.nodeId})`,
        details: `Eviction Finalization Overflow (${schedulerId}, Node ${ev.nodeId}): ${ev.droppedOverflowPkts} pkts (${ev.droppedOverflowBytes} B) before deletion at Frame #${ev.associatedSimulationFrameIndex}`,
      });
    }
    if (ev.totalDroppedPkts >= dropThresh) {
      events.push({
        id: `eviction-spike-${ev.finalizationIndex}-${ev.schedulerId}`,
        eventType: 'SIGNIFICANT_DROP_SPIKE',
        timestampS: ev.timestampS,
        frameIndex: ev.associatedSimulationFrameIndex,
        nodeIds: [ev.nodeId],
        schedulerId,
        color: EVENT_COLORS.SIGNIFICANT_DROP_SPIKE,
        precision: 'Exact (Eviction)',
        label: `Significant Drop Spike on Eviction (${schedulerId}, Node ${ev.nodeId})`,
        details: `Eviction Drop Spike >= ${dropThresh} pkts (${schedulerId}, Node ${ev.nodeId}): ${ev.totalDroppedPkts} pkts (${ev.totalDroppedBytes} B) before deletion at Frame #${ev.associatedSimulationFrameIndex}`,
      });
    }
  }

  // Sort events by timestamp ascending
  events.sort((a, b) => a.timestampS - b.timestampS);

  return events;
}
