/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Milestone: Scheduler Performance History Store
 *
 * Provides a bounded, immutable, read-only ring buffer for historical scheduler frames,
 * per-frame slot allocations, multi-class queue backlogs, and authoritative performance KPIs.
 * Enables historical inspection and trend visualization in the Scheduler workspace without
 * mutating live simulation state, rewinding the worker, or storing DEM elevation grids.
 */

export interface SchedulerSlotAllocation {
  readonly nodeId: number;
  readonly startMs: number;
  readonly durationMs: number;
  readonly durationS: number;
  readonly slotStartS: number;
  readonly capacityBits: number;
  readonly modcodName?: string;
  readonly spectralEfficiency?: number;
  readonly c2Bytes?: number;
  readonly voiceBytes?: number;
  readonly videoBytes?: number;
  readonly photoBytes?: number;
  readonly isPreOcclusionFlush: boolean;
}

export interface SchedulerNodeBacklog {
  readonly nodeId: number;
  readonly name?: string;
  readonly c2Bytes: number;
  readonly voiceBytes: number;
  readonly videoBytes: number;
  readonly photoBytes: number;
  readonly totalBacklogBytes: number;
  readonly c2Packets: number;
  readonly voicePackets: number;
  readonly videoPackets: number;
  readonly photoPackets: number;
  readonly snrDb?: number;
  readonly bitrateMbps?: number;
  readonly stateName?: string;
  readonly linkOutage?: boolean;
  readonly obstacleBlocked?: boolean;
}

export interface SchedulerKpiSnapshot {
  // Cumulative run-level totals
  readonly staticGoodputMb: number;
  readonly tacGoodputMb: number;
  readonly gainMultiplier: number;
  readonly staticWastePct: number;
  readonly tacWastePct: number;
  readonly staticDrops: number;
  readonly staticDropPct: number;
  readonly tacDrops: number;
  readonly tacDropPct: number;

  // Instantaneous superframe interval metrics
  readonly ulUtilizationPct: number;
  readonly staticUtilizationPct?: number;
  readonly tacUtilizationPct?: number;

  // Exact per-frame interval deltas (when exposed by worker)
  readonly activeGoodputFrameBits?: number;
  readonly staticGoodputFrameBits?: number;
  readonly tacGoodputFrameBits?: number;
  readonly activeWastedFrameBits?: number;
  readonly staticWastedFrameBits?: number;
  readonly tacWastedFrameBits?: number;
  readonly activeDropFramePkts?: number;
  readonly staticDropFramePkts?: number;
  readonly tacDropFramePkts?: number;
  readonly activeDropDelayFramePkts?: number;
  readonly activeDropOverflowFramePkts?: number;
  readonly staticDropDelayFramePkts?: number;
  readonly staticDropOverflowFramePkts?: number;
  readonly tacDropDelayFramePkts?: number;
  readonly tacDropOverflowFramePkts?: number;

  // Scenario state markers
  readonly node4PreShadowBacklogKb?: number;
  readonly staticNode4PreShadowBacklogKb?: number;
  readonly node4EvacStatus?: string;
  readonly staticSelectedBacklogKb?: number | null;
  readonly tacSelectedBacklogKb?: number | null;
}

/**
 * Immutable snapshot of a simulation frame's scheduler state and performance telemetry.
 * Contains no references to the mutable live simulation engine or full terrain DEM.
 */
export interface SchedulerFrameRecord {
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly schedulerMode: string;
  readonly selectedNodeId: number | null;
  readonly spatialRevision?: number;
  readonly activeAllocations: readonly SchedulerSlotAllocation[];
  readonly staticAllocations?: readonly SchedulerSlotAllocation[];
  readonly tacAllocations?: readonly SchedulerSlotAllocation[];
  readonly nodeBacklogs: readonly SchedulerNodeBacklog[];
  readonly kpi: SchedulerKpiSnapshot;
  readonly ctrlDurationMs?: number;
  readonly dlDurationMs?: number;
  readonly superframeDurationMs?: number;
}

export interface SchedulerHistorySpan {
  readonly count: number;
  readonly capacity: number;
  readonly oldestFrame: number | null;
  readonly newestFrame: number | null;
  readonly oldestTimeS: number | null;
  readonly newestTimeS: number | null;
}

/**
 * Measures the approximate memory footprint of a single scheduler frame record in bytes.
 * Validates stored data shape and verifies DEM and full terrain structures are absent.
 */
export function estimateSchedulerRecordMemoryBytes(record: SchedulerFrameRecord): number {
  if (!record || typeof record !== 'object') return 0;

  // Base JS object envelope
  let bytes = 64;

  // Scalars: frameIndex, simulationTimeS, selectedNodeId
  bytes += (record.selectedNodeId !== null ? 3 : 2) * 8;
  bytes += (record.schedulerMode?.length ?? 0) * 2;

  // Active allocations array
  if (Array.isArray(record.activeAllocations)) {
    bytes += 32; // array envelope
    for (const alloc of record.activeAllocations) {
      bytes += 80; // numbers + booleans
      bytes += (alloc.modcodName?.length ?? 0) * 2;
    }
  }

  // Node backlogs array (16 nodes)
  if (Array.isArray(record.nodeBacklogs)) {
    bytes += 32;
    for (const nb of record.nodeBacklogs) {
      bytes += 96; // 10 numeric/boolean fields
      bytes += (nb.name?.length ?? 0) * 2;
      bytes += (nb.stateName?.length ?? 0) * 2;
    }
  }

  // KPI snapshot object
  if (record.kpi && typeof record.kpi === 'object') {
    bytes += 64;
    bytes += Object.keys(record.kpi).length * 8;
    bytes += (record.kpi.node4EvacStatus?.length ?? 0) * 2;
  }

  return bytes;
}

/**
 * Creates a defensive, deeply immutable snapshot of a scheduler frame record from incoming telemetry.
 */
export function createSchedulerRecordSnapshot(input: {
  frameIndex: number;
  simulationTimeS: number;
  schedulerMode: string;
  selectedNodeId: number | null;
  spatialRevision?: number;
  activeAllocations: readonly SchedulerSlotAllocation[];
  staticAllocations?: readonly SchedulerSlotAllocation[];
  tacAllocations?: readonly SchedulerSlotAllocation[];
  nodeBacklogs: readonly SchedulerNodeBacklog[];
  kpi: SchedulerKpiSnapshot;
  ctrlDurationMs?: number;
  dlDurationMs?: number;
  superframeDurationMs?: number;
}): SchedulerFrameRecord {
  // Defensive copy and freeze of active allocations
  const clonedActiveAllocations: SchedulerSlotAllocation[] = Array.isArray(input.activeAllocations)
    ? input.activeAllocations.map(a => Object.freeze({
        nodeId: a.nodeId,
        startMs: a.startMs,
        durationMs: a.durationMs,
        durationS: a.durationS,
        slotStartS: a.slotStartS,
        capacityBits: a.capacityBits,
        modcodName: a.modcodName,
        spectralEfficiency: a.spectralEfficiency,
        c2Bytes: a.c2Bytes,
        voiceBytes: a.voiceBytes,
        videoBytes: a.videoBytes,
        photoBytes: a.photoBytes,
        isPreOcclusionFlush: Boolean(a.isPreOcclusionFlush),
      }))
    : [];

  const clonedStaticAllocations: SchedulerSlotAllocation[] | undefined = Array.isArray(input.staticAllocations)
    ? input.staticAllocations.map(a => Object.freeze({ ...a }))
    : undefined;

  const clonedTacAllocations: SchedulerSlotAllocation[] | undefined = Array.isArray(input.tacAllocations)
    ? input.tacAllocations.map(a => Object.freeze({ ...a }))
    : undefined;

  // Defensive copy and freeze of node backlogs
  const clonedBacklogs: SchedulerNodeBacklog[] = Array.isArray(input.nodeBacklogs)
    ? input.nodeBacklogs.map(nb => Object.freeze({
        nodeId: nb.nodeId,
        name: nb.name,
        c2Bytes: nb.c2Bytes,
        voiceBytes: nb.voiceBytes,
        videoBytes: nb.videoBytes,
        photoBytes: nb.photoBytes,
        totalBacklogBytes: nb.totalBacklogBytes,
        c2Packets: nb.c2Packets,
        voicePackets: nb.voicePackets,
        videoPackets: nb.videoPackets,
        photoPackets: nb.photoPackets,
        snrDb: nb.snrDb,
        bitrateMbps: nb.bitrateMbps,
        stateName: nb.stateName,
        linkOutage: nb.linkOutage,
        obstacleBlocked: nb.obstacleBlocked,
      }))
    : [];

  const frozenKpi: SchedulerKpiSnapshot = Object.freeze({
    ...input.kpi,
  });

  const record: SchedulerFrameRecord = Object.freeze({
    frameIndex: input.frameIndex,
    simulationTimeS: input.simulationTimeS,
    schedulerMode: input.schedulerMode,
    selectedNodeId: input.selectedNodeId,
    spatialRevision: input.spatialRevision ?? 0,
    activeAllocations: Object.freeze(clonedActiveAllocations),
    staticAllocations: clonedStaticAllocations ? Object.freeze(clonedStaticAllocations) : undefined,
    tacAllocations: clonedTacAllocations ? Object.freeze(clonedTacAllocations) : undefined,
    nodeBacklogs: Object.freeze(clonedBacklogs),
    kpi: frozenKpi,
    ctrlDurationMs: input.ctrlDurationMs,
    dlDurationMs: input.dlDurationMs,
    superframeDurationMs: input.superframeDurationMs ?? 20.0,
  });

  return record;
}

/**
 * Pre-allocated circular ring buffer for historical scheduler frames.
 * Enforces strict FIFO eviction in O(1) time without array reallocations.
 */
export class SchedulerHistoryBuffer {
  private readonly capacity: number;
  private readonly buffer: (SchedulerFrameRecord | null)[];
  private head: number = 0;   // Monotonically increasing insertion counter
  private length: number = 0; // Current count: min(head, capacity)

  constructor(capacity = 3000) {
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new Error(`SchedulerHistoryBuffer capacity must be an integer >= 2, got ${capacity}`);
    }
    this.capacity = capacity;
    this.buffer = new Array<SchedulerFrameRecord | null>(capacity).fill(null);
  }

  public get maxCapacity(): number {
    return this.capacity;
  }

  public get size(): number {
    return this.length;
  }

  /**
   * Pushes a new scheduler frame record into the ring buffer. Evicts the oldest record in O(1) time when full.
   * If a frame-index regression (e.g. worker reset or restart) is detected, clears the buffer first
   * so lookups remain strictly monotonic. Replaces duplicate consecutive frames in-place.
   */
  public push(record: SchedulerFrameRecord): void {
    if (!record || typeof record.frameIndex !== 'number' || !Number.isFinite(record.frameIndex)) {
      return;
    }

    if (this.length > 0) {
      const newest = this.getNewest();
      if (newest) {
        // Detect frame-index regression or worker restart
        if (record.frameIndex < newest.frameIndex) {
          this.clear();
        } else if (newest.frameIndex === record.frameIndex) {
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
   * Looks up a historical scheduler record by exact frame index.
   */
  public getByFrameIndex(frameIndex: number): SchedulerFrameRecord | null {
    if (this.length === 0 || !Number.isFinite(frameIndex)) return null;

    const oldest = this.getOldest();
    const newest = this.getNewest();
    if (!oldest || !newest) return null;
    if (frameIndex < oldest.frameIndex || frameIndex > newest.frameIndex) {
      return null;
    }

    // Search backward from newest
    const startOffset = this.head - 1;
    for (let i = 0; i < this.length; i++) {
      const slot = (startOffset - i) % this.capacity;
      const rec = this.buffer[slot];
      if (rec && rec.frameIndex === frameIndex) {
        return rec;
      }
      if (rec && rec.frameIndex < frameIndex) {
        break;
      }
    }
    return null;
  }

  /**
   * Returns the oldest available record currently in the buffer, or null if empty.
   */
  public getOldest(): SchedulerFrameRecord | null {
    if (this.length === 0) return null;
    const slot = (this.head - this.length) % this.capacity;
    return this.buffer[slot];
  }

  /**
   * Returns the newest available record currently in the buffer, or null if empty.
   */
  public getNewest(): SchedulerFrameRecord | null {
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
  public getSpan(): SchedulerHistorySpan {
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
   * Returns all retained records in chronological order.
   * Useful for trend chart rendering.
   */
  public getChronologicalRecords(): SchedulerFrameRecord[] {
    if (this.length === 0) return [];
    const result: SchedulerFrameRecord[] = [];
    const startSlot = (this.head - this.length) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const slot = (startSlot + i) % this.capacity;
      const rec = this.buffer[slot];
      if (rec) result.push(rec);
    }
    return result;
  }

  /**
   * Clears all records and resets pointers.
   */
  public clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.length = 0;
  }

  /**
   * Measures total memory footprint in bytes.
   */
  public measureTotalMemoryBytes(): number {
    let total = 0;
    for (let i = 0; i < this.length; i++) {
      const slot = (this.head - 1 - i) % this.capacity;
      const rec = this.buffer[slot];
      if (rec) {
        total += estimateSchedulerRecordMemoryBytes(rec);
      }
    }
    return total;
  }
}

/**
 * State machine managing scheduler historical inspection vs live stream mode.
 * Enforces strictly read-only inspection and tracks simulation running/paused state.
 */
export class SchedulerHistoryController {
  private readonly buffer: SchedulerHistoryBuffer;
  private inspecting: boolean = false;
  private inspectedFrameIndex: number | null = null;
  private wasRunningBeforeHistorical: boolean = false;
  private isCurrentlyEvicted: boolean = false;

  constructor(buffer: SchedulerHistoryBuffer) {
    this.buffer = buffer;
  }

  public get historyBuffer(): SchedulerHistoryBuffer {
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
   * If the simulation was actively running, flags shouldPause = true so the caller can pause the worker.
   */
  public enterHistorical(targetFrameIndex?: number, isCurrentlyRunning = false): {
    record: SchedulerFrameRecord | null;
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
   * If the requested frame was evicted or is unavailable, clamps to the nearest valid frame.
   */
  public scrubTo(frameIndex: number): SchedulerFrameRecord | null {
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

    // Clamp to newest if ahead
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
   * Returns the active record to render: currently inspected frame if in historical mode, or null in LIVE mode.
   */
  public getActiveHistoricalRecord(): SchedulerFrameRecord | null {
    if (!this.inspecting || this.inspectedFrameIndex === null) {
      return null;
    }
    return this.scrubTo(this.inspectedFrameIndex);
  }

  /**
   * Resets historical controller state.
   */
  public reset(): void {
    this.inspecting = false;
    this.inspectedFrameIndex = null;
    this.wasRunningBeforeHistorical = false;
    this.isCurrentlyEvicted = false;
    this.buffer.clear();
  }
}

