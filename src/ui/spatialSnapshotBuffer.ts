/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Spatial Snapshot Buffer (DRDO-TAC-XBAND-ARCH-TIMELINE-17)
 *
 * Implements Option G3: Compact columnar typed-array storage for 50 Hz spatial kinematic snapshots.
 * - Stores up to 3,000 frames and up to 128 active ground nodes.
 * - Retains Float64 precision for simulation & wall-clock timestamps.
 * - True O(1) wraparound eviction without Array.shift().
 * - Monotonic frameIndex enforcement and duplicate rejection.
 * - Sequence gap / discontinuity detection.
 * - High-speed binary search lookup by simulation timestamp and O(1) direct ring lookup by frame index.
 * - Selection stability: historical selected frame is preserved under influx until evicted.
 * - Total memory footprint at maximum capacity (3,000 frames, 128 nodes) strictly < 6.5 MB.
 */

import { NodeTerrainState } from '../core/trajectory';
import type {
  SpatialFrameSnapshot,
  SpatialAcnSnapshot,
  SpatialNodeSnapshot,
  SpatialLinkBudgetSnapshot,
} from '../shared/workerProtocol';

export interface SpatialDiscontinuityEvent {
  readonly missingStartFrame: number;
  readonly missingEndFrame: number;
  readonly count: number;
}

export interface NodeHistoricalTimeSeries {
  readonly nodeId: number;
  readonly count: number;
  readonly timestampsS: Float64Array;
  readonly snrDb: Float32Array;
  readonly aglM: Float32Array;
  readonly isLos: Uint8Array;
  readonly isOutage: Uint8Array;
  readonly isObstacleBlocked: Uint8Array;
  readonly currentState: Uint8Array;
}

export interface ReadonlySpatialExportColumns {
  readonly capacity: number;
  readonly count: number;
  readonly maxActiveGroundNodes: number;
  readonly writeIndex: number;
  readonly frameIndices: Readonly<Int32Array>;
  readonly simulationTimeS: Readonly<Float64Array>;
  readonly wallClockTimeMs: Readonly<Float64Array>;
  readonly acnPosX: Readonly<Float32Array>;
  readonly acnPosY: Readonly<Float32Array>;
  readonly acnPosZ: Readonly<Float32Array>;
  readonly acnVelX: Readonly<Float32Array>;
  readonly acnVelY: Readonly<Float32Array>;
  readonly acnVelZ: Readonly<Float32Array>;
  readonly acnHeadingRad: Readonly<Float32Array>;
  readonly acnPitchDeg: Readonly<Float32Array>;
  readonly acnAltitudeMslM: Readonly<Float32Array>;
  readonly acnAltitudeAglM: Readonly<Float32Array>;
  readonly acnCoverageRadiusKm: Readonly<Float32Array>;
  readonly acnIsTerrainClamped: Readonly<Uint8Array>;
  readonly hasSelectedLinkBudget: Readonly<Uint8Array>;
  readonly selNodeId: Readonly<Int16Array>;
  readonly selSlantRangeKm: Readonly<Float32Array>;
  readonly selFsplDb: Readonly<Float32Array>;
  readonly selDiffractionLossDb: Readonly<Float32Array>;
  readonly selGasLossDb: Readonly<Float32Array>;
  readonly selRainLossDb: Readonly<Float32Array>;
  readonly selTotalLossDb: Readonly<Float32Array>;
  readonly selSnrDb: Readonly<Float32Array>;
  readonly selBitrateMbps: Readonly<Float32Array>;
  readonly selModcodCode: Readonly<Uint8Array>;
  readonly selIsOutage: Readonly<Uint8Array>;
  readonly nodeCounts: Readonly<Uint8Array>;
  readonly nodeIds: Readonly<Uint8Array>;
  readonly nodeFlags: Readonly<Uint8Array>;
  readonly nodeSnrDb: Readonly<Int16Array>;
  readonly getModcodName: (code: number) => string;
  readonly getStateName: (stateCode: number) => string;
}

const DEFAULT_MODCOD_DICT: readonly string[] = [
  'UNKNOWN',
  'LINK_OUTAGE',
  'OBSTACLE_BLOCKED',
  'IDLE_UNALLOCATED',
  'DEPLETED_OUTAGE',
  'pi/2-BPSK 1/3',
  'QPSK 1/2',
  'QPSK 3/4',
  '8-PSK 3/5',
  '16-APSK 2/3',
  '16-APSK 4/5',
  '32-APSK 3/4',
  '64-APSK 5/6',
];

const STATE_TO_CODE: Record<string, number> = {
  [NodeTerrainState.NORMAL_LOS]: 0,
  [NodeTerrainState.PRE_OCCLUSION_FLUSH]: 1,
  [NodeTerrainState.HARD_SHADOW_CUTOFF]: 2,
  [NodeTerrainState.RE_EMERGENCE_BURST]: 3,
};

const CODE_TO_STATE: readonly NodeTerrainState[] = [
  NodeTerrainState.NORMAL_LOS,
  NodeTerrainState.PRE_OCCLUSION_FLUSH,
  NodeTerrainState.HARD_SHADOW_CUTOFF,
  NodeTerrainState.RE_EMERGENCE_BURST,
];

export class SpatialSnapshotBuffer {
  public readonly capacity: number;
  public readonly maxActiveGroundNodes: number;
  private writeIndex: number = 0;
  private _count: number = 0;
  public lastIngestedFrameIndex: number = -1;
  public readonly discontinuities: SpatialDiscontinuityEvent[] = [];
  public selectedSnapshotIndex: number = -1;

  // Frame metadata & ACN kinematics columns (Length N = capacity)
  private readonly frameIndices: Int32Array;
  private readonly simulationTimeS: Float64Array;
  private readonly wallClockTimeMs: Float64Array;
  private readonly spatialRevision: Int32Array;
  private readonly acnPosX: Float32Array;
  private readonly acnPosY: Float32Array;
  private readonly acnPosZ: Float32Array;
  private readonly acnVelX: Float32Array;
  private readonly acnVelY: Float32Array;
  private readonly acnVelZ: Float32Array;
  private readonly acnHeadingRad: Float32Array;
  private readonly acnPitchDeg: Float32Array;
  private readonly acnAltitudeMslM: Float32Array;
  private readonly acnAltitudeAglM: Float32Array;
  private readonly acnCoverageRadiusKm: Float32Array;
  private readonly acnIsTerrainClamped: Uint8Array;
  private readonly nodeCounts: Uint8Array;
  private readonly hasSelectedLinkBudget: Uint8Array;

  // Selected HUD scalars (Length N = capacity)
  private readonly selNodeId: Int16Array;
  private readonly selSlantRangeKm: Float32Array;
  private readonly selFsplDb: Float32Array;
  private readonly selDiffractionLossDb: Float32Array;
  private readonly selGasLossDb: Float32Array;
  private readonly selRainLossDb: Float32Array;
  private readonly selTotalLossDb: Float32Array;
  private readonly selSnrDb: Float32Array;
  private readonly selBitrateMbps: Float32Array;
  private readonly selIsOutage: Uint8Array;
  private readonly selModcodCode: Uint8Array;

  // Ground Nodes Matrix Columns (Length N * M = capacity * maxActiveGroundNodes)
  private readonly nodeIds: Uint8Array;
  private readonly nodeFlags: Uint8Array;
  private readonly nodeAglM: Int16Array;
  private readonly nodeSnrDb: Int16Array;
  private readonly nodePosZ: Int16Array;
  private readonly nodePosX: Float32Array;
  private readonly nodePosY: Float32Array;

  // Dynamic MODCOD dictionary mapping
  private readonly modcodToCode = new Map<string, number>();
  private readonly codeToModcod: string[] = [];

  constructor(capacity: number = 3000, maxActiveGroundNodes: number = 128) {
    if (capacity <= 0 || !Number.isInteger(capacity)) {
      throw new Error(`Buffer capacity must be a positive integer, got ${capacity}`);
    }
    if (maxActiveGroundNodes <= 0 || !Number.isInteger(maxActiveGroundNodes)) {
      throw new Error(`Max active ground nodes must be a positive integer, got ${maxActiveGroundNodes}`);
    }

    this.capacity = capacity;
    this.maxActiveGroundNodes = maxActiveGroundNodes;

    // Allocate frame columns (3,000 slots)
    this.frameIndices = new Int32Array(capacity);
    this.simulationTimeS = new Float64Array(capacity);
    this.wallClockTimeMs = new Float64Array(capacity);
    this.spatialRevision = new Int32Array(capacity);
    this.acnPosX = new Float32Array(capacity);
    this.acnPosY = new Float32Array(capacity);
    this.acnPosZ = new Float32Array(capacity);
    this.acnVelX = new Float32Array(capacity);
    this.acnVelY = new Float32Array(capacity);
    this.acnVelZ = new Float32Array(capacity);
    this.acnHeadingRad = new Float32Array(capacity);
    this.acnPitchDeg = new Float32Array(capacity);
    this.acnAltitudeMslM = new Float32Array(capacity);
    this.acnAltitudeAglM = new Float32Array(capacity);
    this.acnCoverageRadiusKm = new Float32Array(capacity);
    this.acnIsTerrainClamped = new Uint8Array(capacity);
    this.nodeCounts = new Uint8Array(capacity);
    this.hasSelectedLinkBudget = new Uint8Array(capacity);

    this.selNodeId = new Int16Array(capacity);
    this.selSlantRangeKm = new Float32Array(capacity);
    this.selFsplDb = new Float32Array(capacity);
    this.selDiffractionLossDb = new Float32Array(capacity);
    this.selGasLossDb = new Float32Array(capacity);
    this.selRainLossDb = new Float32Array(capacity);
    this.selTotalLossDb = new Float32Array(capacity);
    this.selSnrDb = new Float32Array(capacity);
    this.selBitrateMbps = new Float32Array(capacity);
    this.selIsOutage = new Uint8Array(capacity);
    this.selModcodCode = new Uint8Array(capacity);

    // Allocate ground node matrix columns (3,000 * 128 = 384,000 slots)
    const nodeSlots = capacity * maxActiveGroundNodes;
    this.nodeIds = new Uint8Array(nodeSlots);
    this.nodeFlags = new Uint8Array(nodeSlots);
    this.nodeAglM = new Int16Array(nodeSlots);
    this.nodeSnrDb = new Int16Array(nodeSlots);
    this.nodePosZ = new Int16Array(nodeSlots);
    this.nodePosX = new Float32Array(nodeSlots);
    this.nodePosY = new Float32Array(nodeSlots);

    // Initialize MODCOD dictionary
    for (let i = 0; i < DEFAULT_MODCOD_DICT.length; i++) {
      const name = DEFAULT_MODCOD_DICT[i];
      this.modcodToCode.set(name, i);
      this.codeToModcod.push(name);
    }
  }

  private getOrCreateModcodCode(name: string): number {
    const existing = this.modcodToCode.get(name);
    if (existing !== undefined) return existing;
    if (this.codeToModcod.length >= 255) {
      return 0; // fallback to UNKNOWN
    }
    const code = this.codeToModcod.length;
    this.modcodToCode.set(name, code);
    this.codeToModcod.push(name);
    return code;
  }

  private getModcodFromCode(code: number): string {
    return this.codeToModcod[code] ?? 'UNKNOWN';
  }

  public get count(): number {
    return this._count;
  }

  /**
   * Returns the exact sum of byte lengths of all internal typed array buffers.
   */
  public getTotalByteLength(): number {
    let bytes = 0;
    // Frame metadata & ACN kinematics
    bytes += this.frameIndices.byteLength;
    bytes += this.simulationTimeS.byteLength;
    bytes += this.wallClockTimeMs.byteLength;
    bytes += this.spatialRevision.byteLength;
    bytes += this.acnPosX.byteLength;
    bytes += this.acnPosY.byteLength;
    bytes += this.acnPosZ.byteLength;
    bytes += this.acnVelX.byteLength;
    bytes += this.acnVelY.byteLength;
    bytes += this.acnVelZ.byteLength;
    bytes += this.acnHeadingRad.byteLength;
    bytes += this.acnPitchDeg.byteLength;
    bytes += this.acnAltitudeMslM.byteLength;
    bytes += this.acnAltitudeAglM.byteLength;
    bytes += this.acnCoverageRadiusKm.byteLength;
    bytes += this.acnIsTerrainClamped.byteLength;
    bytes += this.nodeCounts.byteLength;
    bytes += this.hasSelectedLinkBudget.byteLength;

    // HUD scalars
    bytes += this.selNodeId.byteLength;
    bytes += this.selSlantRangeKm.byteLength;
    bytes += this.selFsplDb.byteLength;
    bytes += this.selDiffractionLossDb.byteLength;
    bytes += this.selGasLossDb.byteLength;
    bytes += this.selRainLossDb.byteLength;
    bytes += this.selTotalLossDb.byteLength;
    bytes += this.selSnrDb.byteLength;
    bytes += this.selBitrateMbps.byteLength;
    bytes += this.selIsOutage.byteLength;
    bytes += this.selModcodCode.byteLength;

    // Node matrix
    bytes += this.nodeIds.byteLength;
    bytes += this.nodeFlags.byteLength;
    bytes += this.nodeAglM.byteLength;
    bytes += this.nodeSnrDb.byteLength;
    bytes += this.nodePosZ.byteLength;
    bytes += this.nodePosX.byteLength;
    bytes += this.nodePosY.byteLength;

    return bytes;
  }

  /**
   * Appends an authoritative spatial frame snapshot into columnar typed arrays.
   * Returns true if appended, false if rejected (duplicate or non-monotonic frameIndex).
   */
  public append(snapshot: SpatialFrameSnapshot): boolean {
    if (!snapshot || typeof snapshot.frameIndex !== 'number') {
      return false;
    }

    // Simulation reset detection: if incoming snapshot restarts at frame 0,
    // clear the buffer so the new simulation run is ingested cleanly.
    if (snapshot.frameIndex === 0 && this.lastIngestedFrameIndex > 0) {
      this.clear();
    }

    // Monotonicity check: reject duplicate or out-of-order snapshots
    if (this.lastIngestedFrameIndex >= 0 && snapshot.frameIndex <= this.lastIngestedFrameIndex) {
      return false;
    }

    // Sequence gap detection
    if (this.lastIngestedFrameIndex >= 0 && snapshot.frameIndex > this.lastIngestedFrameIndex + 1) {
      this.discontinuities.push({
        missingStartFrame: this.lastIngestedFrameIndex + 1,
        missingEndFrame: snapshot.frameIndex - 1,
        count: snapshot.frameIndex - 1 - this.lastIngestedFrameIndex,
      });
    }

    const idx = this.writeIndex;

    // Write frame metadata & ACN kinematics
    this.frameIndices[idx] = snapshot.frameIndex;
    this.simulationTimeS[idx] = snapshot.simulationTimeS;
    this.wallClockTimeMs[idx] = snapshot.wallClockTimeMs;
    this.spatialRevision[idx] = snapshot.spatialRevision;

    this.acnPosX[idx] = snapshot.acn.posX;
    this.acnPosY[idx] = snapshot.acn.posY;
    this.acnPosZ[idx] = snapshot.acn.posZ;
    this.acnVelX[idx] = snapshot.acn.velX;
    this.acnVelY[idx] = snapshot.acn.velY;
    this.acnVelZ[idx] = snapshot.acn.velZ;
    this.acnHeadingRad[idx] = snapshot.acn.headingRad;
    this.acnPitchDeg[idx] = snapshot.acn.pitchDeg;
    this.acnAltitudeMslM[idx] = (snapshot.acn.altitudeMslM != null && Number.isFinite(snapshot.acn.altitudeMslM))
      ? snapshot.acn.altitudeMslM
      : Number.NaN;
    this.acnAltitudeAglM[idx] = (snapshot.acn.altitudeAglM != null && Number.isFinite(snapshot.acn.altitudeAglM))
      ? snapshot.acn.altitudeAglM
      : Number.NaN;
    this.acnCoverageRadiusKm[idx] = snapshot.acn.coverageRadiusKm;
    this.acnIsTerrainClamped[idx] = snapshot.acn.isTerrainClamped ? 1 : 0;

    // Selected link budget HUD scalars
    if (snapshot.selectedLinkBudget) {
      const lb = snapshot.selectedLinkBudget;
      this.hasSelectedLinkBudget[idx] = 1;
      this.selSlantRangeKm[idx] = lb.slantRangeM / 1000.0;
      this.selFsplDb[idx] = lb.fsplDb;
      this.selDiffractionLossDb[idx] = lb.diffractionLossDb;
      this.selGasLossDb[idx] = lb.gasLossDb ?? 0.0;
      this.selRainLossDb[idx] = lb.rainLossDb ?? 0.0;
      this.selTotalLossDb[idx] = lb.totalLossDb;
      this.selSnrDb[idx] = lb.snrDb;
      this.selBitrateMbps[idx] = lb.bitrateMbps;
      this.selIsOutage[idx] = lb.isOutage ? 1 : 0;
      this.selModcodCode[idx] = this.getOrCreateModcodCode(lb.modcodName);
      this.selNodeId[idx] = -1;
    } else {
      this.hasSelectedLinkBudget[idx] = 0;
      this.selGasLossDb[idx] = 0.0;
      this.selRainLossDb[idx] = 0.0;
      this.selNodeId[idx] = -1;
    }

    // Write ground nodes matrix
    const nodes = snapshot.nodes;
    const numNodes = nodes ? Math.min(nodes.length, this.maxActiveGroundNodes) : 0;
    this.nodeCounts[idx] = numNodes;

    const baseSlot = idx * this.maxActiveGroundNodes;
    for (let j = 0; j < numNodes; j++) {
      const n = nodes[j];
      const slot = baseSlot + j;
      this.nodeIds[slot] = n.nodeId & 0xff;
      this.nodePosX[slot] = n.posX;
      this.nodePosY[slot] = n.posY;
      this.nodePosZ[slot] = Math.max(-32768, Math.min(32767, Math.round(n.posZ * 2))); // 0.5m scale
      this.nodeAglM[slot] = Math.max(-32768, Math.min(32767, Math.round(n.altitudeAglM * 10))); // 0.1m scale
      this.nodeSnrDb[slot] = Math.max(-32768, Math.min(32767, Math.round(n.snrDb * 100))); // 0.01 dB scale

      let flags = 0;
      if (n.isLos) flags |= 1;
      if (n.isOutage) flags |= 2;
      if (n.isObstacleBlocked) flags |= 4;
      const stCode = STATE_TO_CODE[n.currentState] ?? 0;
      flags |= (stCode & 7) << 3;
      this.nodeFlags[slot] = flags;
    }

    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this._count < this.capacity) {
      this._count++;
    }
    this.lastIngestedFrameIndex = snapshot.frameIndex;
    return true;
  }

  /**
   * Ingests a batch of spatial frame snapshots.
   * Returns the count of successfully appended snapshots.
   */
  public ingestBatch(snapshots: readonly SpatialFrameSnapshot[]): number {
    if (!Array.isArray(snapshots) || snapshots.length === 0) return 0;
    let appended = 0;
    for (let i = 0; i < snapshots.length; i++) {
      if (this.append(snapshots[i])) {
        appended++;
      }
    }
    return appended;
  }

  private toPhysicalIndex(logicalIndex: number): number {
    if (this._count < this.capacity) {
      return logicalIndex;
    }
    return (this.writeIndex + logicalIndex) % this.capacity;
  }

  private get oldestPhysicalIndex(): number {
    return this._count < this.capacity ? 0 : this.writeIndex;
  }

  /**
   * Reconstructs the SpatialFrameSnapshot contract on-the-fly from columnar typed arrays.
   */
  private reconstructSnapshot(idx: number): SpatialFrameSnapshot {
    const frameIndex = this.frameIndices[idx];
    const simulationTimeS = this.simulationTimeS[idx];
    const wallClockTimeMs = this.wallClockTimeMs[idx];
    const spatialRevision = this.spatialRevision[idx];

    const acn: SpatialAcnSnapshot = {
      posX: this.acnPosX[idx],
      posY: this.acnPosY[idx],
      posZ: this.acnPosZ[idx],
      velX: this.acnVelX[idx],
      velY: this.acnVelY[idx],
      velZ: this.acnVelZ[idx],
      headingRad: this.acnHeadingRad[idx],
      pitchDeg: this.acnPitchDeg[idx],
      altitudeMslM: Number.isNaN(this.acnAltitudeMslM[idx]) ? (null as any) : this.acnAltitudeMslM[idx],
      altitudeAglM: Number.isNaN(this.acnAltitudeAglM[idx]) ? (null as any) : this.acnAltitudeAglM[idx],
      coverageRadiusKm: this.acnCoverageRadiusKm[idx],
      isTerrainClamped: this.acnIsTerrainClamped[idx] === 1,
    };

    const numNodes = this.nodeCounts[idx];
    const nodes: SpatialNodeSnapshot[] = new Array(numNodes);
    const baseSlot = idx * this.maxActiveGroundNodes;

    for (let j = 0; j < numNodes; j++) {
      const slot = baseSlot + j;
      const flags = this.nodeFlags[slot];
      const isLos = (flags & 1) !== 0;
      const isOutage = (flags & 2) !== 0;
      const isObstacleBlocked = (flags & 4) !== 0;
      const stCode = (flags >> 3) & 7;
      const currentState = CODE_TO_STATE[stCode] ?? NodeTerrainState.NORMAL_LOS;

      const posX = this.nodePosX[slot];
      const posY = this.nodePosY[slot];
      const posZ = this.nodePosZ[slot] / 2.0;
      const altitudeAglM = this.nodeAglM[slot] / 10.0;
      const snrDb = this.nodeSnrDb[slot] / 100.0;

      nodes[j] = {
        nodeId: this.nodeIds[slot],
        posX,
        posY,
        posZ,
        altitudeMslM: posZ,
        altitudeAglM,
        isLos,
        isOutage,
        isObstacleBlocked,
        snrDb,
        currentState,
      };
    }

    let selectedLinkBudget: SpatialLinkBudgetSnapshot | null = null;
    if (this.hasSelectedLinkBudget[idx] === 1) {
      selectedLinkBudget = {
        slantRangeM: this.selSlantRangeKm[idx] * 1000.0,
        fsplDb: this.selFsplDb[idx],
        diffractionLossDb: this.selDiffractionLossDb[idx],
        gasLossDb: this.selGasLossDb[idx],
        rainLossDb: this.selRainLossDb[idx],
        totalLossDb: this.selTotalLossDb[idx],
        snrDb: this.selSnrDb[idx],
        modcodName: this.getModcodFromCode(this.selModcodCode[idx]),
        bitrateMbps: this.selBitrateMbps[idx],
        isOutage: this.selIsOutage[idx] === 1,
      };
    }

    return {
      frameIndex,
      simulationTimeS,
      wallClockTimeMs,
      spatialRevision,
      acn,
      nodes,
      selectedLinkBudget,
    };
  }

  public get oldestSnapshot(): SpatialFrameSnapshot | null {
    if (this._count === 0) return null;
    return this.reconstructSnapshot(this.oldestPhysicalIndex);
  }

  public get newestSnapshot(): SpatialFrameSnapshot | null {
    if (this._count === 0) return null;
    const newestIdx = (this.writeIndex - 1 + this.capacity) % this.capacity;
    return this.reconstructSnapshot(newestIdx);
  }

  public get newestSimulationTimeS(): number {
    if (this._count === 0) return 0.0;
    const newestIdx = (this.writeIndex - 1 + this.capacity) % this.capacity;
    return this.simulationTimeS[newestIdx];
  }

  public get oldestSimulationTimeS(): number {
    if (this._count === 0) return 0.0;
    return this.simulationTimeS[this.oldestPhysicalIndex];
  }

  /**
   * Retrieves snapshot by logical index (0 = oldest, count - 1 = newest).
   */
  public get(logicalIndex: number): SpatialFrameSnapshot | null {
    if (logicalIndex < 0 || logicalIndex >= this._count) return null;
    const phys = this.toPhysicalIndex(logicalIndex);
    return this.reconstructSnapshot(phys);
  }

  /**
   * Reconstructs snapshot by logical or ring index.
   */
  public getSnapshot(index: number): SpatialFrameSnapshot | null {
    if (index >= 0 && index < this._count) {
      return this.get(index);
    }
    if (index >= 0 && index < this.capacity) {
      return this.reconstructSnapshot(index);
    }
    return null;
  }

  /**
   * Selection Stability: Selects snapshot by frameIndex.
   * Returns true if frame was found and selected, false otherwise.
   */
  public selectSnapshot(frameIndex: number): boolean {
    const snap = this.findSnapshotByFrameIndex(frameIndex);
    if (snap) {
      this.selectedSnapshotIndex = frameIndex;
      return true;
    }
    return false;
  }

  /**
   * Selection Stability: Returns currently selected snapshot, or null if unselected or evicted.
   */
  public get selectedSnapshot(): SpatialFrameSnapshot | null {
    if (this.selectedSnapshotIndex < 0) return null;
    return this.findSnapshotByFrameIndex(this.selectedSnapshotIndex);
  }

  public getSelectedSnapshot(): SpatialFrameSnapshot | null {
    return this.selectedSnapshot;
  }

  /**
   * Resolves snapshot closest to the requested simulation timestamp in O(log N) time.
   * On exact midpoint ties, deterministically selects the earlier frame.
   */
  public findClosestSnapshot(targetTimeS: number): SpatialFrameSnapshot | null {
    if (this._count === 0) return null;
    let low = 0;
    let high = this._count - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const phys = this.toPhysicalIndex(mid);
      const midTime = this.simulationTimeS[phys];
      if (midTime === targetTimeS) {
        return this.reconstructSnapshot(phys);
      }
      if (midTime < targetTimeS) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const cand1Logical = Math.max(0, Math.min(this._count - 1, high));
    const cand2Logical = Math.max(0, Math.min(this._count - 1, low));
    const phys1 = this.toPhysicalIndex(cand1Logical);
    const phys2 = this.toPhysicalIndex(cand2Logical);
    const time1 = this.simulationTimeS[phys1];
    const time2 = this.simulationTimeS[phys2];
    const diff1 = Math.abs(time1 - targetTimeS);
    const diff2 = Math.abs(time2 - targetTimeS);

    // Deterministic tie-breaking: on exact midpoints (diff1 === diff2), select earlier frame
    if (diff1 <= diff2) {
      return this.reconstructSnapshot(phys1);
    } else {
      return this.reconstructSnapshot(phys2);
    }
  }

  /**
   * Finds snapshot matching exact frameIndex.
   * Uses O(1) direct ring lookup with modulo verification, falling back to O(log N) binary search on gaps.
   */
  public findSnapshotByFrameIndex(frameIndex: number): SpatialFrameSnapshot | null {
    if (this._count === 0) return null;
    const oldestPhys = this.oldestPhysicalIndex;
    const oldestFrame = this.frameIndices[oldestPhys];
    const offset = frameIndex - oldestFrame;

    if (offset >= 0 && offset < this._count) {
      const candidatePhys = (oldestPhys + offset) % this.capacity;
      if (this.frameIndices[candidatePhys] === frameIndex) {
        return this.reconstructSnapshot(candidatePhys);
      }
    }

    // Fallback binary search if sequence gaps occurred
    let low = 0;
    let high = this._count - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const phys = this.toPhysicalIndex(mid);
      const fIdx = this.frameIndices[phys];
      if (fIdx === frameIndex) {
        return this.reconstructSnapshot(phys);
      }
      if (fIdx < frameIndex) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return null;
  }

  public getSelGasLossDb(): Float32Array {
    return this.selGasLossDb;
  }

  public getSelRainLossDb(): Float32Array {
    return this.selRainLossDb;
  }

  /**
   * Extracts historical columnar time-series for a specific ground node.
   * Allocates only 7 compact typed arrays without creating per-frame snapshot objects.
   * Target performance: <= 1.5 ms for 3,000 frames.
   */
  public extractNodeTimeSeries(nodeId: number): NodeHistoricalTimeSeries {
    const n = this._count;
    const cap = this.capacity;
    const writeIdx = this.writeIndex;
    const maxNodes = this.maxActiveGroundNodes;

    const timestampsS = new Float64Array(n);
    const snrDb = new Float32Array(n);
    const aglM = new Float32Array(n);
    const isLos = new Uint8Array(n);
    const isOutage = new Uint8Array(n);
    const isObstacleBlocked = new Uint8Array(n);
    const currentState = new Uint8Array(n);

    const targetId = nodeId & 0xff;

    // Cache local array references for high-throughput loop
    const simTimeArr = this.simulationTimeS;
    const nodeCountsArr = this.nodeCounts;
    const nodeIdsArr = this.nodeIds;
    const nodeFlagsArr = this.nodeFlags;
    const nodeSnrArr = this.nodeSnrDb;
    const nodeAglArr = this.nodeAglM;

    const isWrapped = n === cap;

    for (let i = 0; i < n; i++) {
      const phys = isWrapped ? (writeIdx + i >= cap ? writeIdx + i - cap : writeIdx + i) : i;
      timestampsS[i] = simTimeArr[phys];

      const numNodes = nodeCountsArr[phys];
      let slot = phys * maxNodes;
      const endSlot = slot + numNodes;
      let found = false;

      while (slot < endSlot) {
        if (nodeIdsArr[slot] === targetId) {
          const flags = nodeFlagsArr[slot];
          isLos[i] = flags & 1;
          isOutage[i] = (flags >> 1) & 1;
          isObstacleBlocked[i] = (flags >> 2) & 1;
          currentState[i] = (flags >> 3) & 7;
          snrDb[i] = nodeSnrArr[slot] * 0.01;
          aglM[i] = nodeAglArr[slot] * 0.1;
          found = true;
          break;
        }
        slot++;
      }

      if (!found) {
        snrDb[i] = Number.NaN;
        aglM[i] = Number.NaN;
        isLos[i] = 0;
        isOutage[i] = 1;
        isObstacleBlocked[i] = 0;
        currentState[i] = 2; // HARD_SHADOW_CUTOFF
      }
    }

    return {
      nodeId,
      count: n,
      timestampsS,
      snrDb,
      aglM,
      isLos,
      isOutage,
      isObstacleBlocked,
      currentState,
    };
  }

  /**
   * Exposes strictly read-only views of internal typed arrays for zero-allocation CSV streaming.
   */
  public getReadonlyExportColumns(): ReadonlySpatialExportColumns {
    return {
      capacity: this.capacity,
      count: this._count,
      maxActiveGroundNodes: this.maxActiveGroundNodes,
      writeIndex: this.writeIndex,
      frameIndices: this.frameIndices,
      simulationTimeS: this.simulationTimeS,
      wallClockTimeMs: this.wallClockTimeMs,
      acnPosX: this.acnPosX,
      acnPosY: this.acnPosY,
      acnPosZ: this.acnPosZ,
      acnVelX: this.acnVelX,
      acnVelY: this.acnVelY,
      acnVelZ: this.acnVelZ,
      acnHeadingRad: this.acnHeadingRad,
      acnPitchDeg: this.acnPitchDeg,
      acnAltitudeMslM: this.acnAltitudeMslM,
      acnAltitudeAglM: this.acnAltitudeAglM,
      acnCoverageRadiusKm: this.acnCoverageRadiusKm,
      acnIsTerrainClamped: this.acnIsTerrainClamped,
      hasSelectedLinkBudget: this.hasSelectedLinkBudget,
      selNodeId: this.selNodeId,
      selSlantRangeKm: this.selSlantRangeKm,
      selFsplDb: this.selFsplDb,
      selDiffractionLossDb: this.selDiffractionLossDb,
      selGasLossDb: this.selGasLossDb,
      selRainLossDb: this.selRainLossDb,
      selTotalLossDb: this.selTotalLossDb,
      selSnrDb: this.selSnrDb,
      selBitrateMbps: this.selBitrateMbps,
      selModcodCode: this.selModcodCode,
      selIsOutage: this.selIsOutage,
      nodeCounts: this.nodeCounts,
      nodeIds: this.nodeIds,
      nodeFlags: this.nodeFlags,
      nodeSnrDb: this.nodeSnrDb,
      getModcodName: (code: number) => this.getModcodFromCode(code),
      getStateName: (stateCode: number) => CODE_TO_STATE[stateCode] ?? NodeTerrainState.NORMAL_LOS,
    };
  }

  public clear(): void {
    this.writeIndex = 0;
    this._count = 0;
    this.lastIngestedFrameIndex = -1;
    this.discontinuities.length = 0;
    this.selectedSnapshotIndex = -1;
    this.nodeCounts.fill(0);
    this.hasSelectedLinkBudget.fill(0);
  }
}
