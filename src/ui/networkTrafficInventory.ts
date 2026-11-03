/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Authoritative Network Traffic Inventory & Communication Flow Engine
 *
 * Implements:
 * 1. Per-node traffic tracking (Uplink & Downlink) reusing authoritative simulation worker telemetry.
 * 2. Detailed flow records with mathematical consistency (sent, received, rate, SNR, packets, drops).
 * 3. Combined network aggregate summary (total throughput, payload, loss, active links, SNR metrics).
 * 4. Per-node traffic summary with communication availability & successful transfers count.
 * 5. Robust reset handling, tab-switch persistence, and dynamic node addition/deletion pruning.
 * 6. Authentic flow representation: Ground Terminal -> ACN -> Ground Terminals (no fabricated P2P).
 */

import { classifyLinkCommunicationStatus, LinkCommunicationStatus } from '../core/linkStatusClassifier';
import { getNodeRole } from './nodeInventory';

export interface TrafficNodeTelemetry {
  readonly [key: string]: unknown;
  readonly node_id: number;
  readonly name?: string;
  readonly node_type?: string;
  readonly snr_db?: number;
  readonly bitrate_mbps?: number;
  readonly bitrate_bps?: number;
  readonly link_outage?: boolean;
  readonly terrain_is_los?: boolean;
  readonly obstacle_blocked?: boolean;
  readonly is_transmitting?: boolean;
  readonly allocated_slot_ms?: number;
  readonly allocated_capacity_bits?: number;
  readonly transfer_state?: {
    readonly status?: string;
    readonly status_message?: string;
    readonly active_type?: string;
    readonly total_bytes?: number;
    readonly delivered_bytes?: number;
    readonly dropped_bytes?: number;
    readonly dropped_packets?: number;
    readonly current_rate_bps?: number;
    readonly current_rate_mbps?: number;
    readonly start_time_s?: number;
    readonly ack_time_s?: number;
  } | null;
}

export interface DownlinkSubframeTelemetry {
  readonly is_control_broadcast?: boolean;
  readonly ctrl_duration_ms?: number;
  readonly dl_duration_ms?: number;
  readonly broadcast_active?: boolean;
}

export interface NetworkTrafficFrame {
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly nodes: readonly TrafficNodeTelemetry[];
  readonly downlinkTelemetry?: DownlinkSubframeTelemetry | null;
  readonly schedulerMode?: string;
}

export interface TrafficFlowRecord {
  readonly id: string;
  readonly fromId: number | 'ACN';
  readonly fromName: string;
  readonly toId: number | 'ACN' | 'BROADCAST';
  readonly toName: string;
  readonly direction: 'Uplink' | 'Downlink';
  readonly dataSentBytes: number;
  readonly dataReceivedBytes: number;
  readonly dataRateMbps: number;
  readonly snrDb: number | null;
  readonly linkStatus: LinkCommunicationStatus;
  readonly linkStatusText: string;
  readonly packetsSent: number;
  readonly packetsReceived: number;
  readonly packetsLost: number;
  readonly lastActivitySimTimeS: number | null;
  readonly isTransmitting: boolean;
}

export interface PerNodeTrafficSummary {
  readonly nodeId: number;
  readonly callsign: string;
  readonly role: string;
  readonly totalDataTransmittedBytes: number;
  readonly totalDataReceivedBytes: number;
  readonly currentUploadRateMbps: number;
  readonly currentDownloadRateMbps: number;
  readonly totalSuccessfulTransfers: number;
  readonly snrDb: number | null;
  readonly linkStatus: LinkCommunicationStatus;
  readonly communicationAvailabilityPct: number;
  readonly activeLinksCount: number;
}

export interface CombinedNetworkSummary {
  readonly totalPayloadTransmittedBytes: number;
  readonly totalPayloadReceivedBytes: number;
  readonly totalUplinkThroughputMbps: number;
  readonly totalDownlinkThroughputMbps: number;
  readonly activeCommunicationLinksCount: number;
  readonly totalSuccessfulDeliveries: number;
  readonly totalPacketsLost: number;
  readonly averageSnrDb: number | null;
  readonly minimumSnrDb: number | null;
}

interface NodeAccumulator {
  lastDeliveredBytes: number;
  lastDroppedBytes: number;
  lastDroppedPackets: number;
  cumulativeSentBytes: number;
  cumulativeDeliveredBytes: number;
  cumulativePacketsSent: number;
  cumulativePacketsReceived: number;
  cumulativePacketsLost: number;
  successfulTransfers: number;
  lastActivitySimTimeS: number | null;
  framesWithComms: number;
  totalFramesSeen: number;
  lastTransferStatus: string | null;
}

const finite = (val: unknown): val is number =>
  typeof val === 'number' && Number.isFinite(val);

/**
 * Authoritative tracker maintaining mathematically consistent counters across simulation frames.
 */
export class NetworkTrafficTracker {
  private readonly nodeAccumulators = new Map<number, NodeAccumulator>();
  private lastSimTimeS = 0;
  private cumulativeDlBroadcastBytes = 0;

  public clear(): void {
    this.nodeAccumulators.clear();
    this.lastSimTimeS = 0;
    this.cumulativeDlBroadcastBytes = 0;
  }

  private getOrCreateAccumulator(nodeId: number): NodeAccumulator {
    let acc = this.nodeAccumulators.get(nodeId);
    if (!acc) {
      acc = {
        lastDeliveredBytes: 0,
        lastDroppedBytes: 0,
        lastDroppedPackets: 0,
        cumulativeSentBytes: 0,
        cumulativeDeliveredBytes: 0,
        cumulativePacketsSent: 0,
        cumulativePacketsReceived: 0,
        cumulativePacketsLost: 0,
        successfulTransfers: 0,
        lastActivitySimTimeS: null,
        framesWithComms: 0,
        totalFramesSeen: 0,
        lastTransferStatus: null,
      };
      this.nodeAccumulators.set(nodeId, acc);
    }
    return acc;
  }

  /**
   * Synchronizes node accumulators with the current active node list, removing stale accumulators.
   */
  public prune(activeNodeIds: readonly number[]): void {
    const activeSet = new Set(activeNodeIds);
    for (const id of this.nodeAccumulators.keys()) {
      if (!activeSet.has(id)) {
        this.nodeAccumulators.delete(id);
      }
    }
  }

  /**
   * Ingests a telemetry frame, updating cumulative metrics without double-counting.
   */
  public ingest(frame: NetworkTrafficFrame): void {
    if (!finite(frame.simulationTimeS)) return;
    this.lastSimTimeS = frame.simulationTimeS;

    const activeNodeIds = frame.nodes.map(n => n.node_id);
    this.prune(activeNodeIds);

    // Track downlink broadcast bytes if downlink telemetry is active
    const dl = frame.downlinkTelemetry;
    if (dl && dl.broadcast_active !== false) {
      const dlMs = dl.dl_duration_ms ?? 3.0;
      // Approximate 20 ms superframe portion dedicated to downlink broadcast
      // Standard 10 MHz X-band downlink channel: ~15 Mbps nominal broadcast capacity
      const nominalDlBps = 15e6;
      const dlSec = dlMs / 1000.0;
      this.cumulativeDlBroadcastBytes += Math.floor((nominalDlBps * dlSec) / 8);
    }

    for (const node of frame.nodes) {
      const acc = this.getOrCreateAccumulator(node.node_id);
      acc.totalFramesSeen += 1;

      const commStatus = classifyLinkCommunicationStatus(node);
      const isCommsAvailable = commStatus.status === 'CONNECTED' || commStatus.status === 'DEGRADED';
      if (isCommsAvailable) {
        acc.framesWithComms += 1;
      }

      const tx = node.transfer_state;
      if (tx) {
        const delivered = finite(tx.delivered_bytes) ? Math.max(0, tx.delivered_bytes) : 0;
        const droppedBytes = finite(tx.dropped_bytes) ? Math.max(0, tx.dropped_bytes) : 0;
        const droppedPkts = finite(tx.dropped_packets) ? Math.max(0, tx.dropped_packets) : 0;
        const total = finite(tx.total_bytes) ? Math.max(0, tx.total_bytes) : 0;

        // Detect new transfer start / counter reset
        if (delivered < acc.lastDeliveredBytes || (acc.lastTransferStatus === 'ACKNOWLEDGED' && tx.status === 'TRANSMITTING')) {
          // New transfer begun
          acc.lastDeliveredBytes = 0;
          acc.lastDroppedBytes = 0;
          acc.lastDroppedPackets = 0;
        }

        const deltaDelivered = Math.max(0, delivered - acc.lastDeliveredBytes);
        const deltaDroppedBytes = Math.max(0, droppedBytes - acc.lastDroppedBytes);
        const deltaDroppedPkts = Math.max(0, droppedPkts - acc.lastDroppedPackets);

        acc.cumulativeDeliveredBytes += deltaDelivered;
        acc.cumulativeSentBytes += (deltaDelivered + deltaDroppedBytes);
        acc.cumulativePacketsLost += deltaDroppedPkts;

        // Packet estimation: 1,200 bytes per tactical IP packet (QoS profile average)
        const pktsDelivered = Math.floor(deltaDelivered / 1200) + (deltaDelivered > 0 && deltaDelivered < 1200 ? 1 : 0);
        acc.cumulativePacketsReceived += pktsDelivered;
        acc.cumulativePacketsSent += (pktsDelivered + deltaDroppedPkts);

        acc.lastDeliveredBytes = delivered;
        acc.lastDroppedBytes = droppedBytes;
        acc.lastDroppedPackets = droppedPkts;

        if (tx.status === 'TRANSMITTING' || deltaDelivered > 0) {
          acc.lastActivitySimTimeS = frame.simulationTimeS;
        }

        if (tx.status === 'ACKNOWLEDGED' && acc.lastTransferStatus !== 'ACKNOWLEDGED') {
          acc.successfulTransfers += 1;
          acc.lastActivitySimTimeS = finite(tx.ack_time_s) ? tx.ack_time_s : frame.simulationTimeS;
        }

        acc.lastTransferStatus = tx.status ?? null;
      } else {
        // No active transfer, baseline link activity check
        if (node.is_transmitting) {
          acc.lastActivitySimTimeS = frame.simulationTimeS;
        }
      }
    }
  }

  /**
   * Generates the flow records for all active communication links.
   */
  public getFlowRecords(frame: NetworkTrafficFrame): TrafficFlowRecord[] {
    const records: TrafficFlowRecord[] = [];

    // 1. Uplink Flows: Each registered ground node -> ACN Relay
    for (const node of frame.nodes) {
      const acc = this.getOrCreateAccumulator(node.node_id);
      const callsign = node.name || `S${node.node_id}`;
      const commStatus = classifyLinkCommunicationStatus(node);

      const tx = node.transfer_state;
      const rateMbps = tx && finite(tx.current_rate_mbps)
        ? Math.max(0, tx.current_rate_mbps)
        : (tx && finite(tx.current_rate_bps) ? Math.max(0, tx.current_rate_bps / 1e6) : 0);

      const isTx = Boolean(node.is_transmitting || (tx && tx.status === 'TRANSMITTING'));
      const snr = finite(node.snr_db) && node.snr_db > -90 ? node.snr_db : null;

      records.push({
        id: `flow-ul-${node.node_id}`,
        fromId: node.node_id,
        fromName: `Node ${node.node_id} (${callsign})`,
        toId: 'ACN',
        toName: 'ACN Relay (FL500)',
        direction: 'Uplink',
        dataSentBytes: acc.cumulativeSentBytes,
        dataReceivedBytes: acc.cumulativeDeliveredBytes,
        dataRateMbps: Number(rateMbps.toFixed(2)),
        snrDb: snr !== null ? Number(snr.toFixed(1)) : null,
        linkStatus: commStatus.status,
        linkStatusText: commStatus.status.replace(/_/g, ' '),
        packetsSent: acc.cumulativePacketsSent,
        packetsReceived: acc.cumulativePacketsReceived,
        packetsLost: acc.cumulativePacketsLost,
        lastActivitySimTimeS: acc.lastActivitySimTimeS,
        isTransmitting: isTx,
      });
    }

    // 2. Downlink Flow: ACN Relay -> Ground Terminals (Broadcast)
    if (frame.nodes.length > 0) {
      const validLinks = frame.nodes.filter(n => {
        const s = classifyLinkCommunicationStatus(n).status;
        return s === 'CONNECTED' || s === 'DEGRADED';
      });

      const avgSnr = validLinks.length > 0
        ? validLinks.reduce((sum, n) => sum + (n.snr_db ?? 0), 0) / validLinks.length
        : null;

      // Downlink throughput during broadcast phase
      const dlDurationMs = frame.downlinkTelemetry?.dl_duration_ms ?? 3.0;
      const dlRateMbps = validLinks.length > 0 ? (15.0 * (dlDurationMs / 20.0)) : 0.0;

      records.push({
        id: 'flow-dl-broadcast',
        fromId: 'ACN',
        fromName: 'ACN Relay (FL500)',
        toId: 'BROADCAST',
        toName: `Ground Terminals (${validLinks.length}/${frame.nodes.length} in LOS)`,
        direction: 'Downlink',
        dataSentBytes: this.cumulativeDlBroadcastBytes,
        dataReceivedBytes: Math.floor(this.cumulativeDlBroadcastBytes * (validLinks.length / Math.max(1, frame.nodes.length))),
        dataRateMbps: Number(dlRateMbps.toFixed(2)),
        snrDb: avgSnr !== null ? Number(avgSnr.toFixed(1)) : null,
        linkStatus: validLinks.length > 0 ? 'CONNECTED' : 'OUTAGE_DISCONNECTED',
        linkStatusText: validLinks.length > 0 ? 'BROADCAST ACTIVE' : 'NO NODES IN LOS',
        packetsSent: Math.floor(this.cumulativeDlBroadcastBytes / 1200),
        packetsReceived: Math.floor(this.cumulativeDlBroadcastBytes * (validLinks.length / Math.max(1, frame.nodes.length)) / 1200),
        packetsLost: 0,
        lastActivitySimTimeS: this.lastSimTimeS > 0 ? this.lastSimTimeS : null,
        isTransmitting: validLinks.length > 0,
      });
    }

    return records;
  }

  /**
   * Generates per-node summary statistics.
   */
  public getPerNodeSummary(nodeId: number, frame: NetworkTrafficFrame): PerNodeTrafficSummary | null {
    const node = frame.nodes.find(n => n.node_id === nodeId);
    if (!node) return null;

    const acc = this.getOrCreateAccumulator(nodeId);
    const callsign = node.name || `S${node.node_id}`;
    const role = getNodeRole(node.node_id, node.node_type);
    const commStatus = classifyLinkCommunicationStatus(node);

    const tx = node.transfer_state;
    const uploadRateMbps = tx && finite(tx.current_rate_mbps)
      ? Math.max(0, tx.current_rate_mbps)
      : (tx && finite(tx.current_rate_bps) ? Math.max(0, tx.current_rate_bps / 1e6) : 0);

    const isCommsAvailable = commStatus.status === 'CONNECTED' || commStatus.status === 'DEGRADED';
    const dlDurationMs = frame.downlinkTelemetry?.dl_duration_ms ?? 3.0;
    const downloadRateMbps = isCommsAvailable ? Number((15.0 * (dlDurationMs / 20.0)).toFixed(2)) : 0.0;

    const availabilityPct = acc.totalFramesSeen > 0
      ? Number(((acc.framesWithComms / acc.totalFramesSeen) * 100).toFixed(1))
      : (isCommsAvailable ? 100.0 : 0.0);

    const snr = finite(node.snr_db) && node.snr_db > -90 ? node.snr_db : null;

    // Estimate received downlink portion for this node based on availability
    const rxBytes = Math.floor(this.cumulativeDlBroadcastBytes * (availabilityPct / 100.0));

    return {
      nodeId: node.node_id,
      callsign,
      role,
      totalDataTransmittedBytes: acc.cumulativeSentBytes,
      totalDataReceivedBytes: rxBytes,
      currentUploadRateMbps: Number(uploadRateMbps.toFixed(2)),
      currentDownloadRateMbps: downloadRateMbps,
      totalSuccessfulTransfers: acc.successfulTransfers,
      snrDb: snr !== null ? Number(snr.toFixed(1)) : null,
      linkStatus: commStatus.status,
      communicationAvailabilityPct: availabilityPct,
      activeLinksCount: isCommsAvailable ? 1 : 0,
    };
  }

  /**
   * Generates combined network aggregate summary strictly consistent with individual records.
   */
  public getCombinedNetworkSummary(records: readonly TrafficFlowRecord[]): CombinedNetworkSummary {
    let totalSent = 0;
    let totalReceived = 0;
    let totalUlRate = 0;
    let totalDlRate = 0;
    let activeLinks = 0;
    let totalDeliveries = 0;
    let totalLost = 0;
    const validSnrs: number[] = [];

    for (const r of records) {
      totalSent += r.dataSentBytes;
      totalReceived += r.dataReceivedBytes;
      if (r.direction === 'Uplink') {
        totalUlRate += r.dataRateMbps;
        if (r.linkStatus === 'CONNECTED' || r.linkStatus === 'DEGRADED') {
          activeLinks += 1;
        }
        if (finite(r.snrDb)) {
          validSnrs.push(r.snrDb);
        }
      } else {
        totalDlRate += r.dataRateMbps;
      }
      totalLost += r.packetsLost;
    }

    for (const acc of this.nodeAccumulators.values()) {
      totalDeliveries += acc.successfulTransfers;
    }

    const avgSnr = validSnrs.length > 0
      ? Number((validSnrs.reduce((a, b) => a + b, 0) / validSnrs.length).toFixed(1))
      : null;
    const minSnr = validSnrs.length > 0
      ? Number(Math.min(...validSnrs).toFixed(1))
      : null;

    return {
      totalPayloadTransmittedBytes: totalSent,
      totalPayloadReceivedBytes: totalReceived,
      totalUplinkThroughputMbps: Number(totalUlRate.toFixed(2)),
      totalDownlinkThroughputMbps: Number(totalDlRate.toFixed(2)),
      activeCommunicationLinksCount: activeLinks,
      totalSuccessfulDeliveries: totalDeliveries,
      totalPacketsLost: totalLost,
      averageSnrDb: avgSnr,
      minimumSnrDb: minSnr,
    };
  }
}

/**
 * Presentation formatters
 */
export function formatTrafficBytes(bytes: number): string {
  if (!finite(bytes) || bytes <= 0) return '0.00 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatTrafficRate(rateMbps: number): string {
  if (!finite(rateMbps) || rateMbps <= 0) return '0.00 Mbps';
  return `${rateMbps.toFixed(2)} Mbps`;
}

export function formatTrafficSimTime(timeS: number | null): string {
  if (!finite(timeS) || timeS === null || timeS < 0) return '—';
  return `T+${timeS.toFixed(2)}s`;
}

export function formatTrafficSnr(snrDb: number | null): string {
  if (!finite(snrDb) || snrDb === null) return '—';
  return `${snrDb > 0 ? '+' : ''}${snrDb.toFixed(1)} dB`;
}

export function getTrafficStatusBadge(status: LinkCommunicationStatus): { label: string; badgeClass: string } {
  switch (status) {
    case 'CONNECTED':
      return { label: 'CONNECTED', badgeClass: 'badge-emerald' };
    case 'DEGRADED':
      return { label: 'DEGRADED', badgeClass: 'badge-amber' };
    case 'BLOCKED_TERRAIN':
      return { label: 'TERRAIN BLOCKED', badgeClass: 'badge-crimson' };
    case 'BLOCKED_OBSTACLE':
      return { label: 'OBSTACLE BLOCKED', badgeClass: 'badge-crimson' };
    case 'OUTAGE_DISCONNECTED':
      return { label: 'OUTAGE', badgeClass: 'badge-neutral' };
    default:
      return { label: 'UNKNOWN', badgeClass: 'badge-neutral' };
  }
}
