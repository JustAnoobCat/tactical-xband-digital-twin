export interface NetworkNodeTelemetry {
  readonly node_id: number;
  readonly name?: string;
  readonly snr_db?: number;
  readonly bitrate_mbps?: number;
  readonly link_outage?: boolean;
  readonly transfer_state?: {
    readonly current_rate_bps?: number;
    readonly delivered_bytes?: number;
  } | null;
}

export interface NetworkPerformanceFrame {
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly nodes: readonly NetworkNodeTelemetry[];
}

export interface NetworkNodeSample {
  readonly nodeId: number;
  readonly snrDb: number | null;
  readonly rateMbps: number;
  readonly transferredMb: number;
  readonly linkValid: boolean;
}

export interface NetworkPerformanceSample {
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly nodes: readonly NetworkNodeSample[];
}

export interface NetworkAggregateSample {
  readonly simulationTimeS: number;
  readonly averageSnrDb: number | null;
  readonly minimumSnrDb: number | null;
  readonly totalRateMbps: number;
  readonly totalTransferredMb: number;
  readonly validLinkCount: number;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function isValidLink(node: NetworkNodeTelemetry): boolean {
  return node.link_outage === false && finite(node.snr_db);
}

export function aggregateNetworkSample(sample: NetworkPerformanceSample): NetworkAggregateSample {
  const valid = sample.nodes.filter(node => node.linkValid && finite(node.snrDb));
  const snrs = valid.map(node => node.snrDb as number);
  return {
    simulationTimeS: sample.simulationTimeS,
    averageSnrDb: snrs.length ? snrs.reduce((sum, value) => sum + value, 0) / snrs.length : null,
    minimumSnrDb: snrs.length ? Math.min(...snrs) : null,
    totalRateMbps: sample.nodes.reduce((sum, node) => sum + Math.max(0, node.rateMbps), 0),
    totalTransferredMb: sample.nodes.reduce((sum, node) => sum + Math.max(0, node.transferredMb), 0),
    validLinkCount: snrs.length,
  };
}

export class NetworkPerformanceHistory {
  readonly capacity: number;
  private readonly samples: NetworkPerformanceSample[] = [];
  private readonly lastDeliveredBytes = new Map<number, number>();
  private readonly cumulativeTransferredBytes = new Map<number, number>();
  private frameCounter = 0;
  private readonly sampleEveryFrames: number;

  constructor(capacity = 600, sampleEveryFrames = 5) {
    if (!Number.isInteger(capacity) || capacity < 2) throw new Error('History capacity must be at least 2.');
    if (!Number.isInteger(sampleEveryFrames) || sampleEveryFrames < 1) throw new Error('Sample interval must be positive.');
    this.capacity = capacity;
    this.sampleEveryFrames = sampleEveryFrames;
  }

  clear(): void {
    this.samples.length = 0;
    this.lastDeliveredBytes.clear();
    this.cumulativeTransferredBytes.clear();
    this.frameCounter = 0;
  }

  ingest(frame: NetworkPerformanceFrame, enabled = true): NetworkPerformanceSample | null {
    if (!enabled || !finite(frame.simulationTimeS) || !Number.isInteger(frame.frameIndex)) return null;
    this.frameCounter += 1;
    if (this.frameCounter % this.sampleEveryFrames !== 0) return null;

    const nodes = frame.nodes.map(node => {
      const delivered = node.transfer_state && finite(node.transfer_state.delivered_bytes)
        ? Math.max(0, node.transfer_state.delivered_bytes)
        : 0;
      const previous = this.lastDeliveredBytes.get(node.node_id);
      if (previous === undefined) {
        this.cumulativeTransferredBytes.set(node.node_id, (this.cumulativeTransferredBytes.get(node.node_id) ?? 0) + delivered);
      } else if (delivered >= previous) {
        this.cumulativeTransferredBytes.set(
          node.node_id,
          (this.cumulativeTransferredBytes.get(node.node_id) ?? 0) + delivered - previous
        );
      } else {
        // A lower counter marks a new transfer. Its already-delivered prefix is
        // new payload, while the previous transfer was fully accounted for.
        this.cumulativeTransferredBytes.set(
          node.node_id,
          (this.cumulativeTransferredBytes.get(node.node_id) ?? 0) + delivered
        );
      }
      this.lastDeliveredBytes.set(node.node_id, delivered);

      const rateBps = node.transfer_state && finite(node.transfer_state.current_rate_bps)
        ? Math.max(0, node.transfer_state.current_rate_bps)
        : 0;
      return {
        nodeId: node.node_id,
        snrDb: isValidLink(node) ? node.snr_db as number : null,
        rateMbps: rateBps / 1e6,
        transferredMb: (this.cumulativeTransferredBytes.get(node.node_id) ?? 0) / 1e6,
        linkValid: isValidLink(node),
      };
    });

    const sample = Object.freeze({
      frameIndex: frame.frameIndex,
      simulationTimeS: frame.simulationTimeS,
      nodes: Object.freeze(nodes),
    });
    this.samples.push(sample);
    if (this.samples.length > this.capacity) this.samples.shift();
    return sample;
  }

  getSamples(): readonly NetworkPerformanceSample[] {
    return this.samples;
  }

  getNodeIds(): readonly number[] {
    const ids = new Set<number>();
    for (const sample of this.samples) for (const node of sample.nodes) ids.add(node.nodeId);
    return [...ids].sort((a, b) => a - b);
  }
}
