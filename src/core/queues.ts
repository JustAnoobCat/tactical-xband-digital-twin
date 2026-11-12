/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Multi-Class QoS Queues & Traffic Subsystems (TypeScript Port)
 *
 * Implements:
 * 1. 3GPP MCX 5QI profiles (69 C2, 65 Voice, 67 Video, 70 Photo).
 * 2. Bounded strict-priority queue with CoDel sojourn tracking,
 *    bounded memory ceiling (max 120 packets for 5QI 69), and selective pruning.
 * 3. Dismounted soldier & command post tactical traffic generator.
 */

import { NodeType } from './config';
import { Position3D } from '../shared/types';
import { NodeIdentity, NodeTrafficOptions, formatDeterministicNodeUuid } from './nodeRegistry';

export class Packet {
  constructor(
    public readonly packetId: number,
    public readonly nodeId: number,
    public readonly qos5qi: number,
    public readonly sizeBytes: number,
    public readonly arrivalTimeS: number,
    public readonly deadlineS: number,
    public sojournTimeS: number = 0.0
  ) {}

  public get sizeBits(): number {
    return this.sizeBytes * 8;
  }
}

export interface QoSProfile {
  readonly name: string;
  readonly priority: number;
  readonly pdbS: number;
  readonly defaultBytes: number;
}

export const QOS_PROFILES: Readonly<Record<number, QoSProfile>> = {
  69: { name: 'Emergency_C2', priority: 1, pdbS: 60.0, defaultBytes: 128 },
  65: { name: 'MC_PTT_Voice', priority: 2, pdbS: 0.075, defaultBytes: 160 },
  67: { name: 'MC_Video', priority: 3, pdbS: 0.15, defaultBytes: 1200 },
  70: { name: 'Tactical_Photo', priority: 4, pdbS: 0.5, defaultBytes: 1400 },
};

/**
 * Bounded Strict-Priority Multi-Class Queue with Head-of-Line (HOL) sojourn tracking.
 */
export class FQCoDelQueue {
  public readonly maxBufferPackets: number;
  public readonly maxC2Packets: number;

  public totalEnqueued: number = 0;
  public droppedDelayCount: number = 0;
  public droppedOverflowCount: number = 0;

  private _droppedDelayBytes: number = 0;
  private _droppedOverflowBytes: number = 0;
  private _totalDroppedBytes: number = 0;

  // Monotonic per-instance drop counters (survive FQCoDelQueue.reset() for eviction reconciliation)
  private _monotonicDroppedDelayCount: number = 0;
  private _monotonicDroppedOverflowCount: number = 0;
  private _monotonicDroppedDelayBytes: number = 0;
  private _monotonicDroppedOverflowBytes: number = 0;
  private _monotonicTotalDroppedBytes: number = 0;

  public get droppedDelayBytes(): number {
    return this._droppedDelayBytes;
  }

  public get droppedOverflowBytes(): number {
    return this._droppedOverflowBytes;
  }

  public get totalDroppedBytes(): number {
    return this._totalDroppedBytes;
  }

  public get monotonicDroppedDelayCount(): number {
    return this._monotonicDroppedDelayCount;
  }

  public get monotonicDroppedOverflowCount(): number {
    return this._monotonicDroppedOverflowCount;
  }

  public get monotonicDroppedDelayBytes(): number {
    return this._monotonicDroppedDelayBytes;
  }

  public get monotonicDroppedOverflowBytes(): number {
    return this._monotonicDroppedOverflowBytes;
  }

  public get monotonicTotalDroppedBytes(): number {
    return this._monotonicTotalDroppedBytes;
  }

  private recordOverflowDrop(bytes: number, count: number = 1): void {
    this.droppedOverflowCount += count;
    this._droppedOverflowBytes += bytes;
    this._totalDroppedBytes += bytes;
    this._monotonicDroppedOverflowCount += count;
    this._monotonicDroppedOverflowBytes += bytes;
    this._monotonicTotalDroppedBytes += bytes;
  }

  private recordDelayDrop(bytes: number, count: number = 1): void {
    this.droppedDelayCount += count;
    this._droppedDelayBytes += bytes;
    this._totalDroppedBytes += bytes;
    this._monotonicDroppedDelayCount += count;
    this._monotonicDroppedDelayBytes += bytes;
    this._monotonicTotalDroppedBytes += bytes;
  }

  private readonly subqueues: Map<number, Packet[]>;

  constructor(maxBufferPackets: number = 400, maxC2Packets: number = 120) {
    this.maxBufferPackets = maxBufferPackets;
    this.maxC2Packets = maxC2Packets;
    this.subqueues = new Map([
      [69, []],
      [65, []],
      [67, []],
      [70, []],
    ]);
  }

  public getTotalPackets(): number {
    let count = 0;
    for (const q of this.subqueues.values()) {
      count += q.length;
    }
    return count;
  }

  public getTotalBacklogBytes(): number {
    let bytes = 0;
    for (const q of this.subqueues.values()) {
      for (let i = 0; i < q.length; i++) {
        bytes += q[i].sizeBytes;
      }
    }
    return bytes;
  }

  public getTotalBacklogBits(): number {
    return this.getTotalBacklogBytes() * 8;
  }

  public getClassBacklogBytes(qos5qi: number): number {
    const q = this.subqueues.get(qos5qi);
    if (!q) return 0;
    let bytes = 0;
    for (let i = 0; i < q.length; i++) {
      bytes += q[i].sizeBytes;
    }
    return bytes;
  }

  public getClassBacklogBits(qos5qi: number): number {
    return this.getClassBacklogBytes(qos5qi) * 8;
  }

  public getClassPacketCount(qos5qi: number): number {
    return this.subqueues.get(qos5qi)?.length ?? 0;
  }

  public getHolDelayS(qos5qi: number, currentSimTimeS: number): number {
    const q = this.subqueues.get(qos5qi);
    if (q && q.length > 0) {
      return Math.max(0.0, currentSimTimeS - q[0].arrivalTimeS);
    }
    return 0.0;
  }

  /**
   * Enqueues packet according to bounded priority rules:
   * 1. Total buffer capped at 400 packets. Lower priority traffic (70 -> 67 -> 65) is evicted first.
   * 2. 5QI 69 has a hard bounded ceiling of 120 packets; oldest 69 is dropped if ceiling is breached.
   */
  public enqueue(packet: Packet): [boolean, Packet[]] {
    this.totalEnqueued += 1;
    const qos = packet.qos5qi;
    const evicted: Packet[] = [];
    const targetQ = this.subqueues.get(qos);
    if (!targetQ) {
      return [false, [packet]];
    }

    if (qos === 69) {
      if (targetQ.length >= this.maxC2Packets) {
        const drop = targetQ.shift()!;
        evicted.push(drop);
      } else if (this.getTotalPackets() >= this.maxBufferPackets) {
        let dropped = false;
        for (const dropQos of [70, 67, 65]) {
          const dq = this.subqueues.get(dropQos)!;
          if (dq.length > 0) {
            evicted.push(dq.shift()!);
            dropped = true;
            break;
          }
        }
        if (!dropped) {
          evicted.push(targetQ.shift()!);
        }
      }

      targetQ.push(packet);
      for (let i = 0; i < evicted.length; i++) {
        this.recordOverflowDrop(evicted[i].sizeBytes, 1);
      }
      return [true, evicted];
    }

    // Non-C2 traffic (65, 67, 70)
    if (this.getTotalPackets() >= this.maxBufferPackets) {
      let dropped = false;
      for (const dropQos of [70, 67, 65]) {
        const dq = this.subqueues.get(dropQos)!;
        if (dq.length > 0) {
          evicted.push(dq.shift()!);
          dropped = true;
          break;
        }
      }
      if (!dropped) {
        // Only C2 in buffer, cannot evict C2 for lower priority
        evicted.push(packet);
        this.recordOverflowDrop(packet.sizeBytes, 1);
        return [false, evicted];
      }
    }

    targetQ.push(packet);
    for (let i = 0; i < evicted.length; i++) {
      this.recordOverflowDrop(evicted[i].sizeBytes, 1);
    }
    return [true, evicted];
  }

  /**
   * Dequeues packets in strict priority order (69 -> 65 -> 67 -> 70) fitting within bytesCapacity.
   */
  public dequeue(bytesCapacity: number, currentSimTimeS: number): Packet[] {
    const served: Packet[] = [];
    let remBytes = bytesCapacity;

    for (const qos of [69, 65, 67, 70]) {
      const q = this.subqueues.get(qos)!;
      while (q.length > 0) {
        const pkt = q[0];

        // Non-C2 packets that expired at head-of-line are discarded
        if (qos !== 69 && currentSimTimeS >= pkt.deadlineS) {
          q.shift();
          this.recordDelayDrop(pkt.sizeBytes, 1);
          continue;
        }

        if (pkt.sizeBytes <= remBytes) {
          q.shift();
          pkt.sojournTimeS = Math.max(0.0, currentSimTimeS - pkt.arrivalTimeS);
          served.push(pkt);
          remBytes -= pkt.sizeBytes;
        } else {
          break;
        }
      }

      if (remBytes <= 0) break;
    }

    return served;
  }

  /**
   * Prunes non-C2 packets exceeding their packet delay budget.
   * 5QI 69 is explicitly exempt from deadline pruning during mountain shadow outrages.
   */
  public pruneExpiredPackets(currentSimTimeS: number): Packet[] {
    const pruned: Packet[] = [];

    for (const qos of [65, 67, 70]) {
      const q = this.subqueues.get(qos)!;
      const survivors: Packet[] = [];
      for (let i = 0; i < q.length; i++) {
        const pkt = q[i];
        if (currentSimTimeS >= pkt.deadlineS) {
          pruned.push(pkt);
          this.recordDelayDrop(pkt.sizeBytes, 1);
        } else {
          survivors.push(pkt);
        }
      }
      this.subqueues.set(qos, survivors);
    }

    return pruned;
  }

  public reset(): void {
    for (const q of this.subqueues.values()) {
      q.length = 0;
    }
    this.totalEnqueued = 0;
    this.droppedDelayCount = 0;
    this.droppedOverflowCount = 0;
    this._droppedDelayBytes = 0;
    this._droppedOverflowBytes = 0;
    this._totalDroppedBytes = 0;
  }
}

/**
 * Tactical Ground Node Traffic Subsystem.
 */
export class GroundNodeTrafficSubsystem {
  private static globalPacketCounter: number = 0;

  public readonly nodeId: number;
  public readonly creationSequence: number;
  public readonly entityId: string;
  public readonly identity: NodeIdentity;
  public nodeType: NodeType;
  public position: Position3D;
  /** Configured antenna height above local terrain, in metres (0–1000 m). */
  public aglM: number = 2.0;
  public readonly queue: FQCoDelQueue;

  public hasVoice: boolean;
  public voiceStartS: number;
  public voiceEndS: number;

  public hasVideo: boolean;
  public videoMeanPktsPerFrame: number;

  public hasPhoto: boolean;
  public photoTriggerTimeS: number;
  public photoSizeBytes: number;
  public photoBytesRemaining: number;

  public isShadowed: boolean = false;

  /** Configured transmit power in dBm. If undefined, falls back to role default. */
  public txPowerDbm?: number;
  /** Configured battery capacity in mAh. */
  public batteryCapacityMah: number = 5000;
  /** Current battery level percentage (0.0 to 100.0). */
  public batteryLevelPct: number = 100.0;
  /** Configured tactical priority (0.1 to 5.0). */
  public tacticalPriority: number = 1.0;
  /** Flag indicating total battery exhaustion. */
  public isDepleted: boolean = false;

  private readonly c2IntervalS: number = 0.1; // 10 Hz heartbeat
  private lastC2TimeS: number = -1.0;
  private rngState: number;

  constructor(
    nodeId: number,
    nodeType: NodeType,
    position: Position3D,
    seed: number = 42,
    options?: NodeTrafficOptions,
    identity?: NodeIdentity,
  ) {
    this.nodeId = nodeId;
    this.nodeType = nodeType;
    this.position = position;
    this.queue = new FQCoDelQueue(400, 120);

    const defaultCallsign = nodeId === 15 ? 'MCP' : `S${nodeId}`;
    this.identity = identity ?? {
      entityId: formatDeterministicNodeUuid(nodeId),
      nodeId,
      creationSequence: nodeId,
      callsign: defaultCallsign,
      role: nodeType,
    };
    this.entityId = this.identity.entityId;
    this.creationSequence = this.identity.creationSequence;

    this.hasVoice = options?.hasVoice ?? false;
    this.voiceStartS = options?.voiceStartS ?? 0.0;
    this.voiceEndS = options?.voiceEndS ?? 0.0;

    this.hasVideo = options?.hasVideo ?? false;
    this.videoMeanPktsPerFrame = options?.videoMeanPktsPerFrame ?? 1.0;

    this.hasPhoto = options?.hasPhoto ?? false;
    this.photoTriggerTimeS = options?.photoTriggerTimeS ?? 0.0;
    this.photoSizeBytes = options?.photoSizeBytes ?? 0;
    this.photoBytesRemaining = this.hasPhoto ? this.photoSizeBytes : 0;

    this.rngState = (seed ^ 0x6d2b79f5) >>> 0;
  }

  private nextRandom(): number {
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private poissonDraw(lambda: number): number {
    if (lambda <= 0.0) return 0;
    const limit = Math.exp(-lambda);
    let count = 0;
    let p = 1.0;
    while (p > limit) {
      count++;
      p *= this.nextRandom();
    }
    return Math.max(0, count - 1);
  }

  public enqueuePacket(
    qos: number,
    currentSimTimeS: number,
    sizeBytes?: number,
    deadlineS?: number
  ): Packet {
    GroundNodeTrafficSubsystem.globalPacketCounter += 1;
    const prof = QOS_PROFILES[qos] ?? QOS_PROFILES[69];
    const sz = sizeBytes ?? prof.defaultBytes;
    const dl = deadlineS ?? currentSimTimeS + prof.pdbS;

    const pkt = new Packet(
      GroundNodeTrafficSubsystem.globalPacketCounter,
      this.nodeId,
      qos,
      sz,
      currentSimTimeS,
      dl
    );
    this.queue.enqueue(pkt);
    return pkt;
  }

  public generateTraffic(
    currentSimTimeS: number,
    _frameDurationS: number = 0.02
  ): Packet[] {
    if (this.batteryLevelPct <= 0 || this.isDepleted) {
      return [];
    }
    const generated: Packet[] = [];

    // 1. 5QI 69: Periodic C2 Health & Status
    if (this.lastC2TimeS < 0.0 || currentSimTimeS - this.lastC2TimeS >= this.c2IntervalS) {
      generated.push(this.enqueuePacket(69, currentSimTimeS));
      this.lastC2TimeS = currentSimTimeS;
    }

    // 2. 5QI 65: Mission-Critical PTT Voice
    if (this.hasVoice && currentSimTimeS >= this.voiceStartS && currentSimTimeS <= this.voiceEndS) {
      generated.push(this.enqueuePacket(65, currentSimTimeS));
    }

    // 3. 5QI 67: Tactical Mission-Critical Video (Paused if radio is in shadow)
    if (this.hasVideo && !this.isShadowed) {
      const numVideo = this.poissonDraw(this.videoMeanPktsPerFrame);
      for (let i = 0; i < numVideo; i++) {
        generated.push(this.enqueuePacket(67, currentSimTimeS));
      }
    }

    // 4. 5QI 70: High-Resolution Imagery
    if (
      this.hasPhoto &&
      currentSimTimeS >= this.photoTriggerTimeS &&
      this.photoBytesRemaining > 0
    ) {
      const slices = Math.min(2, Math.ceil(this.photoBytesRemaining / 1400));
      for (let i = 0; i < slices; i++) {
        const chunk = Math.min(1400, this.photoBytesRemaining);
        generated.push(this.enqueuePacket(70, currentSimTimeS, chunk));
        this.photoBytesRemaining -= chunk;
      }
    }

    return generated;
  }

  public injectTraffic(trafficType: string, currentSimTimeS: number): number {
    if (this.batteryLevelPct <= 0 || this.isDepleted) {
      return 0;
    }
    const kind = trafficType.trim().toUpperCase();
    let count = 0;

    if (kind === 'SOS' || kind === 'C2' || kind === 'EMERGENCY') {
      for (let i = 0; i < 8; i++) {
        this.enqueuePacket(69, currentSimTimeS);
        count++;
      }
    } else if (kind === 'VOICE' || kind === 'PTT') {
      this.hasVoice = true;
      this.voiceStartS = currentSimTimeS;
      this.voiceEndS = currentSimTimeS + 5.0;
      count += 1;
    } else if (kind === 'VIDEO' || kind === 'BURST') {
      this.hasVideo = true;
      this.videoMeanPktsPerFrame = 3.0;
      count += 5;
    } else if (kind === 'PHOTO' || kind === 'IMAGE') {
      this.hasPhoto = true;
      this.photoTriggerTimeS = currentSimTimeS;
      this.photoBytesRemaining += 2000000;
      count += 1;
    }

    return count;
  }
}
