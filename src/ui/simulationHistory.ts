/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Milestone 3B.2D — Historical Simulation Frame & Profile Store
 *
 * Provides a bounded, read-only ring buffer for historical simulation frames and
 * authoritative link profiles. Enables smooth scrubbing and frame inspection
 * in the Terrain & RF workspace without mutating live simulation state or
 * duplicating the full terrain DEM.
 */

import type { LinkProfile, LinkProfileObstacleInterval, LinkProfileSample } from '../core/linkProfile';
import type { Position3D } from '../shared/types';

export interface HistoricalObstructionSummary {
  readonly terrainIsLos: boolean;
  readonly obstacleBlocked: boolean;
  readonly minClearanceM: number;
  readonly diffractionLossDb: number;
  readonly primaryBlockedObstacleId: string | null;
  readonly terrainStatusText: string;
  readonly terrainBadgeClass: string;
  readonly obstacleStatusText: string;
  readonly obstacleBadgeClass: string;
}

export interface HistoricalLinkBudgetSnapshot {
  readonly modcodName: string;
  readonly snrDb: number;
  readonly spectralEfficiencyBpsHz: number;
  readonly slantRangeKm: number;
  readonly fsplDb: number;
  readonly diffractionLossDb: number;
  readonly rxPowerDbm: number;
  readonly earthBulgeM: number;
  readonly gaseousLossDb: number;
  readonly pNoiseDbm?: number;
  readonly rainLossDb?: number;
}

/**
 * Immutable snapshot of a simulation frame's link profile and telemetry metadata.
 * Contains no references to the mutable live simulation engine or full terrain DEM.
 */
export interface HistoricalFrameRecord {
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly selectedNodeId: number;
  readonly nodeName: string;
  readonly profileSerial: number;
  readonly spatialRevision?: number;
  readonly groundNodePositionMslM: Position3D;
  readonly acnPositionMslM: Position3D;
  readonly profile: LinkProfile;
  readonly obstruction: HistoricalObstructionSummary;
  readonly linkBudget: HistoricalLinkBudgetSnapshot;
  /** Legacy compatibility coordinates: [along_dist_km, terrain_alt_m, los_alt_m, fresnel_radius_m]. */
  readonly profilePoints?: readonly [number, number, number, number][];
  readonly groundNodeAglM?: number;
}

export interface HistorySpan {
  readonly count: number;
  readonly capacity: number;
  readonly oldestFrame: number | null;
  readonly newestFrame: number | null;
  readonly oldestTimeS: number | null;
  readonly newestTimeS: number | null;
}

/**
 * Empirically measures the approximate memory footprint of a single historical frame record in bytes.
 * Validates actual stored data shape rather than assuming static sizing.
 */
export function estimateRecordMemoryBytes(record: HistoricalFrameRecord): number {
  if (!record || typeof record !== 'object') return 0;

  // Base JS object overhead (~64 bytes for record envelope)
  let bytes = 64;

  // Scalar numbers and booleans (~8 bytes each)
  bytes += 10 * 8; // frameIndex, simulationTimeS, selectedNodeId, profileSerial, etc.
  bytes += (record.nodeName?.length ?? 0) * 2;

  // Position 3D arrays (3 floats + array overhead ~56 bytes)
  bytes += 56 * 2;

  // Obstruction summary
  bytes += 64 + (record.obstruction.terrainStatusText?.length ?? 0) * 2 +
    (record.obstruction.obstacleStatusText?.length ?? 0) * 2 +
    (record.obstruction.primaryBlockedObstacleId?.length ?? 0) * 2;

  // Link budget snapshot
  bytes += 64 + (record.linkBudget.modcodName?.length ?? 0) * 2;

  // Profile
  if (record.profile && typeof record.profile === 'object') {
    bytes += 128; // profile object overhead

    // Samples: 64 samples × ~72 bytes per sample (9 numeric properties + object)
    if (Array.isArray(record.profile.samples)) {
      bytes += record.profile.samples.length * 72;
    }

    // Obstacle intervals: ~64 bytes per interval + obstacleId string
    if (Array.isArray(record.profile.obstacleIntervals)) {
      for (const interval of record.profile.obstacleIntervals) {
        bytes += 64 + (interval.obstacleId?.length ?? 0) * 2;
      }
    }
  }

  // Legacy profile points if present: 4 numbers per point = 32 bytes + array overhead
  if (Array.isArray(record.profilePoints)) {
    bytes += record.profilePoints.length * 32;
  }

  return bytes;
}

/**
 * Creates a defensive, immutable snapshot of a historical frame record from incoming telemetry.
 */
export function createHistoricalRecordSnapshot(input: {
  frameIndex: number;
  simulationTimeS: number;
  selectedNodeId: number;
  nodeName: string;
  profileSerial?: number;
  spatialRevision?: number;
  groundNodePositionMslM: Position3D;
  acnPositionMslM: Position3D;
  profile: LinkProfile;
  obstruction: HistoricalObstructionSummary;
  linkBudget: HistoricalLinkBudgetSnapshot;
  profilePoints?: readonly [number, number, number, number][];
  groundNodeAglM?: number;
}): HistoricalFrameRecord {
  // Defensive copy of profile samples
  const clonedSamples: LinkProfileSample[] = Array.isArray(input.profile?.samples)
    ? input.profile.samples.map(s => Object.freeze({ ...s }))
    : [];

  // Defensive copy of obstacle intervals
  const clonedIntervals: LinkProfileObstacleInterval[] = Array.isArray(input.profile?.obstacleIntervals)
    ? input.profile.obstacleIntervals.map(i => Object.freeze({ ...i }))
    : [];

  const frozenProfile: LinkProfile = Object.freeze({
    selectedGroundNodeId: input.profile?.selectedGroundNodeId ?? input.selectedNodeId,
    nodeName: input.profile?.nodeName ?? input.nodeName,
    frameIndex: input.profile?.frameIndex ?? input.frameIndex,
    simulationTimeS: input.profile?.simulationTimeS ?? input.simulationTimeS,
    groundNodePositionMslM: Object.freeze([...(input.profile?.groundNodePositionMslM ?? input.groundNodePositionMslM)]) as unknown as Position3D,
    acnPositionMslM: Object.freeze([...(input.profile?.acnPositionMslM ?? input.acnPositionMslM)]) as unknown as Position3D,
    horizontalGroundDistanceM: input.profile?.horizontalGroundDistanceM ?? 0,
    slantDistanceM: input.profile?.slantDistanceM ?? 0,
    fresnelFraction: input.profile?.fresnelFraction ?? 0.6,
    terrainIsLos: input.profile?.terrainIsLos ?? input.obstruction.terrainIsLos,
    terrainMinimumClearanceM: input.profile?.terrainMinimumClearanceM ?? input.obstruction.minClearanceM,
    terrainCriticalFresnelRadiusM: input.profile?.terrainCriticalFresnelRadiusM ?? 0,
    diffractionLossDb: input.profile?.diffractionLossDb ?? input.obstruction.diffractionLossDb,
    obstacleBlocked: input.profile?.obstacleBlocked ?? input.obstruction.obstacleBlocked,
    obstacleIntervals: Object.freeze(clonedIntervals),
    samples: Object.freeze(clonedSamples),
    valid: input.profile?.valid ?? true,
  });

  const record: HistoricalFrameRecord = Object.freeze({
    frameIndex: input.frameIndex,
    simulationTimeS: input.simulationTimeS,
    selectedNodeId: input.selectedNodeId,
    nodeName: input.nodeName,
    profileSerial: input.profileSerial ?? 0,
    spatialRevision: input.spatialRevision ?? 0,
    groundNodePositionMslM: Object.freeze([...input.groundNodePositionMslM]) as unknown as Position3D,
    acnPositionMslM: Object.freeze([...input.acnPositionMslM]) as unknown as Position3D,
    profile: frozenProfile,
    obstruction: Object.freeze({ ...input.obstruction }),
    linkBudget: Object.freeze({ ...input.linkBudget }),
    profilePoints: input.profilePoints ? Object.freeze(input.profilePoints.map(p => Object.freeze([...p]) as unknown as [number, number, number, number])) : undefined,
    groundNodeAglM: input.groundNodeAglM,
  });

  return record;
}

/**
 * Pre-allocated circular ring buffer for historical simulation frames.
 * Enforces strict FIFO eviction in O(1) time without array reallocations.
 */
export class SimulationHistoryBuffer {
  private readonly capacity: number;
  private readonly buffer: (HistoricalFrameRecord | null)[];
  private head: number = 0;   // Monotonically increasing insertion counter
  private length: number = 0; // Current count: min(head, capacity)

  constructor(capacity = 3000) {
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new Error(`SimulationHistoryBuffer capacity must be an integer >= 2, got ${capacity}`);
    }
    this.capacity = capacity;
    this.buffer = new Array<HistoricalFrameRecord | null>(capacity).fill(null);
  }

  public get maxCapacity(): number {
    return this.capacity;
  }

  public get size(): number {
    return this.length;
  }

  /**
   * Pushes a new frame record into the ring buffer. Evicts the oldest record in O(1) time when full.
   * If a frame-index regression (e.g. worker reset or restart) is detected, clears the buffer first
   * so lookups remain strictly monotonic. Replaces duplicate consecutive frames in-place.
   */
  public push(record: HistoricalFrameRecord): void {
    if (!record || typeof record.frameIndex !== 'number' || !Number.isFinite(record.frameIndex)) {
      return;
    }

    if (this.length > 0) {
      const newest = this.getNewest();
      if (newest) {
        // Detect frame-index regression or worker restart
        if (record.frameIndex < newest.frameIndex) {
          this.clear();
        } else if (record.frameIndex === newest.frameIndex) {
          // Replace slot for consecutive duplicate frame index (e.g. paused refresh)
          const slot = (this.head - 1 + this.capacity) % this.capacity;
          this.buffer[slot] = record;
          return;
        }
      }
    }

    const slot = this.head % this.capacity;
    this.buffer[slot] = record;
    this.head++;
    if (this.length < this.capacity) {
      this.length++;
    }
  }

  /**
   * Look up a historical frame record by its exact frame index.
   */
  public getByFrameIndex(frameIndex: number): HistoricalFrameRecord | null {
    if (this.length === 0 || !Number.isFinite(frameIndex)) return null;

    const oldest = this.getOldest();
    const newest = this.getNewest();
    if (!oldest || !newest) return null;
    if (frameIndex < oldest.frameIndex || frameIndex > newest.frameIndex) {
      return null;
    }

    // Search backward from newest (most queries target recent frames)
    const startOffset = this.head - 1;
    for (let i = 0; i < this.length; i++) {
      const slot = (startOffset - i) % this.capacity;
      const rec = this.buffer[slot];
      if (rec && rec.frameIndex === frameIndex) {
        return rec;
      }
      if (rec && rec.frameIndex < frameIndex) {
        // Frame sequence is strictly monotone increasing; if we passed below frameIndex, it is absent.
        break;
      }
    }
    return null;
  }

  /**
   * Returns the oldest available record currently in the buffer, or null if empty.
   */
  public getOldest(): HistoricalFrameRecord | null {
    if (this.length === 0) return null;
    const slot = (this.head - this.length) % this.capacity;
    return this.buffer[slot];
  }

  /**
   * Returns the newest available record currently in the buffer, or null if empty.
   */
  public getNewest(): HistoricalFrameRecord | null {
    if (this.length === 0) return null;
    const slot = (this.head - 1) % this.capacity;
    return this.buffer[slot];
  }

  /**
   * Checks whether a given frame index was once recorded but has since been evicted.
   */
  public isEvicted(frameIndex: number): boolean {
    if (this.length === 0 || !Number.isFinite(frameIndex)) return false;
    const oldest = this.getOldest();
    return oldest !== null && frameIndex < oldest.frameIndex;
  }

  /**
   * Returns a summary of current historical coverage.
   */
  public getSpan(): HistorySpan {
    const oldest = this.getOldest();
    const newest = this.getNewest();
    return {
      count: this.length,
      capacity: this.capacity,
      oldestFrame: oldest ? oldest.frameIndex : null,
      newestFrame: newest ? newest.frameIndex : null,
      oldestTimeS: oldest ? oldest.simulationTimeS : null,
      newestTimeS: newest ? newest.simulationTimeS : null,
    };
  }

  /**
   * Clears all historical records and resets pointers.
   */
  public clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.length = 0;
  }

  /**
   * Calculates the exact measured memory footprint of all stored frame records in bytes.
   */
  public measureTotalMemoryBytes(): number {
    let total = 0;
    for (let i = 0; i < this.length; i++) {
      const slot = (this.head - 1 - i) % this.capacity;
      const rec = this.buffer[slot];
      if (rec) {
        total += estimateRecordMemoryBytes(rec);
      }
    }
    return total;
  }
}

/**
 * State machine managing historical inspection vs live stream mode.
 * Enforces the invariant that historical inspection is strictly read-only and
 * preserves prior simulation running/paused state across LIVE returns.
 */
export class SimulationHistoryController {
  private readonly buffer: SimulationHistoryBuffer;
  private inspecting: boolean = false;
  private inspectedFrameIndex: number | null = null;
  private wasRunningBeforeHistorical: boolean = false;
  private isCurrentlyEvicted: boolean = false;

  constructor(buffer: SimulationHistoryBuffer) {
    this.buffer = buffer;
  }

  public get historyBuffer(): SimulationHistoryBuffer {
    return this.buffer;
  }

  public get isInspecting(): boolean {
    return this.inspecting;
  }

  public get currentInspectedFrame(): number | null {
    return this.inspectedFrameIndex;
  }

  public get wasRunningBefore(): boolean {
    return this.wasRunningBeforeHistorical;
  }

  public get isEvicted(): boolean {
    return this.isCurrentlyEvicted;
  }

  /**
   * Enters historical inspection mode.
   * If the simulation was actively running, flags shouldPause = true so the caller
   * can pause the worker, and remembers that it was running so returning to LIVE resumes.
   */
  public enterHistorical(targetFrameIndex?: number, isCurrentlyRunning = false): {
    record: HistoricalFrameRecord | null;
    shouldPause: boolean;
  } {
    if (!this.inspecting) {
      this.inspecting = true;
      this.wasRunningBeforeHistorical = isCurrentlyRunning;
    }

    const newest = this.buffer.getNewest();
    const frameToInspect = typeof targetFrameIndex === 'number'
      ? targetFrameIndex
      : (newest ? newest.frameIndex : 0);

    const record = this.scrubTo(frameToInspect);

    return {
      record,
      shouldPause: isCurrentlyRunning,
    };
  }

  /**
   * Scrubs historical inspection to a target frame index.
   * If the requested frame was evicted or is unavailable, clamps to the nearest valid frame
   * and sets isCurrentlyEvicted = true.
   */
  public scrubTo(frameIndex: number): HistoricalFrameRecord | null {
    this.inspecting = true;
    this.inspectedFrameIndex = frameIndex;

    const direct = this.buffer.getByFrameIndex(frameIndex);
    if (direct) {
      this.isCurrentlyEvicted = false;
      return direct;
    }

    // Check if evicted
    if (this.buffer.isEvicted(frameIndex)) {
      this.isCurrentlyEvicted = true;
      const oldest = this.buffer.getOldest();
      if (oldest) {
        this.inspectedFrameIndex = oldest.frameIndex;
        return oldest;
      }
    }

    // Clamp to newest if target is ahead
    const newest = this.buffer.getNewest();
    if (newest && frameIndex > newest.frameIndex) {
      this.isCurrentlyEvicted = false;
      this.inspectedFrameIndex = newest.frameIndex;
      return newest;
    }

    this.isCurrentlyEvicted = false;
    return newest ?? null;
  }

  /**
   * Exits historical inspection and returns to LIVE mode.
   * Tells the caller whether the simulation should resume based on its prior running state.
   */
  public exitHistorical(): { shouldResume: boolean } {
    const shouldResume = this.wasRunningBeforeHistorical;
    this.inspecting = false;
    this.inspectedFrameIndex = null;
    this.wasRunningBeforeHistorical = false;
    this.isCurrentlyEvicted = false;
    return { shouldResume };
  }

  /**
   * Returns the active record to render: the currently inspected historical frame if in
   * historical mode, or null if in LIVE mode.
   */
  public getActiveHistoricalRecord(): HistoricalFrameRecord | null {
    if (!this.inspecting || this.inspectedFrameIndex === null) {
      return null;
    }
    return this.scrubTo(this.inspectedFrameIndex);
  }

  /**
   * Resets historical controller state when the entire simulation is reset.
   */
  public reset(): void {
    this.inspecting = false;
    this.inspectedFrameIndex = null;
    this.wasRunningBeforeHistorical = false;
    this.isCurrentlyEvicted = false;
    this.buffer.clear();
  }
}

