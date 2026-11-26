/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Milestone: Scheduler Performance History Store
 *
 * Provides a bounded, immutable, read-only ring buffer for historical scheduler frames
 * using compact TypedArray ring storage. Eliminates 50 Hz write-path Object.freeze()
 * allocations while lazily constructing deeply frozen SchedulerFrameRecord snapshots on read.
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

export interface SchedulerFrameInput {
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

const KPI_STRIDE = 34;
const ALLOC_NUM_STRIDE = 12;
const BACKLOG_NUM_STRIDE = 12;
const BACKLOG_META_STRIDE = 3;
const FIXED_BYTES_PER_SLOT = 8 + 8 + 4 + 4 + 2 + 2 + 2 + KPI_STRIDE * 8;

const SFLAG_HAS_SELECTED_NODE = 1 << 0;
const SFLAG_HAS_EVAC_STATUS = 1 << 1;
const SFLAG_HAS_STATIC_ALLOCS = 1 << 2;
const SFLAG_HAS_TAC_ALLOCS = 1 << 3;
const SFLAG_STATIC_SEL_NULL = 1 << 4;
const SFLAG_TAC_SEL_NULL = 1 << 5;

const NB_HAS_OUTAGE = 1 << 0;
const NB_OUTAGE_TRUE = 1 << 1;
const NB_HAS_OBS_BLK = 1 << 2;
const NB_OBS_BLK_TRUE = 1 << 3;

function optNum(val: number | null | undefined): number {
  return typeof val === 'number' ? val : Number.NaN;
}

function readOptNum(val: number): number | undefined {
  return Number.isNaN(val) ? undefined : val;
}

/**
 * Measures the approximate memory footprint of a single scheduler frame record in bytes.
 */
export function estimateSchedulerRecordMemoryBytes(record: SchedulerFrameRecord): number {
  if (!record || typeof record !== 'object') return 0;

  let bytes = 64;
  bytes += (record.selectedNodeId !== null ? 3 : 2) * 8;
  bytes += (record.schedulerMode?.length ?? 0) * 2;

  if (Array.isArray(record.activeAllocations)) {
    bytes += 32;
    for (const alloc of record.activeAllocations) {
      bytes += 80;
      bytes += (alloc.modcodName?.length ?? 0) * 2;
    }
  }

  if (Array.isArray(record.nodeBacklogs)) {
    bytes += 32;
    for (const nb of record.nodeBacklogs) {
      bytes += 96;
      bytes += (nb.name?.length ?? 0) * 2;
      bytes += (nb.stateName?.length ?? 0) * 2;
    }
  }

  if (record.kpi && typeof record.kpi === 'object') {
    bytes += 64;
    bytes += Object.keys(record.kpi).length * 8;
    bytes += (record.kpi.node4EvacStatus?.length ?? 0) * 2;
  }

  return bytes;
}

function freezeAllocArray(list: readonly SchedulerSlotAllocation[]): readonly SchedulerSlotAllocation[] {
  return Object.freeze(
    list.map((a) =>
      Object.freeze({
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
        photoBytes: a.photoBytes,
        videoBytes: a.videoBytes,
        isPreOcclusionFlush: Boolean(a.isPreOcclusionFlush),
      })
    )
  );
}

/**
 * Creates a defensive, deeply immutable snapshot of a scheduler frame record from incoming telemetry.
 */
export function createSchedulerRecordSnapshot(input: SchedulerFrameInput): SchedulerFrameRecord {
  const clonedActiveAllocations = Array.isArray(input.activeAllocations)
    ? freezeAllocArray(input.activeAllocations)
    : Object.freeze([]);

  const clonedStaticAllocations = Array.isArray(input.staticAllocations)
    ? freezeAllocArray(input.staticAllocations)
    : undefined;

  const clonedTacAllocations = Array.isArray(input.tacAllocations)
    ? freezeAllocArray(input.tacAllocations)
    : undefined;

  const clonedBacklogs: SchedulerNodeBacklog[] = Array.isArray(input.nodeBacklogs)
    ? input.nodeBacklogs.map((nb) =>
        Object.freeze({
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
        })
      )
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
    activeAllocations: clonedActiveAllocations,
    staticAllocations: clonedStaticAllocations,
    tacAllocations: clonedTacAllocations,
    nodeBacklogs: Object.freeze(clonedBacklogs),
    kpi: frozenKpi,
    ctrlDurationMs: input.ctrlDurationMs,
    dlDurationMs: input.dlDurationMs,
    superframeDurationMs: input.superframeDurationMs ?? 20.0,
  });

  return record;
}

/**
 * Pre-allocated circular TypedArray ring buffer for historical scheduler frames.
 * Enforces strict FIFO eviction in O(1) time with zero Object.freeze() calls on write,
 * lazily constructing deeply frozen SchedulerFrameRecord snapshots only on read.
 */
export class SchedulerHistoryBuffer {
  private readonly capacity: number;
  private head: number = 0;
  private length: number = 0;

  private readonly frameIndexArr: Float64Array;
  private readonly simTimeArr: Float64Array;
  private readonly selectedNodeIdArr: Int32Array;
  private readonly spatialRevisionArr: Int32Array;
  private readonly schedulerModeIdArr: Uint16Array;
  private readonly evacStatusIdArr: Uint16Array;
  private readonly flagsArr: Uint16Array;
  private readonly kpiArr: Float64Array;

  private readonly activeAllocNums: (Float64Array | null)[];
  private readonly activeAllocModcods: (Uint16Array | null)[];
  private readonly staticAllocNums: (Float64Array | null)[];
  private readonly staticAllocModcods: (Uint16Array | null)[];
  private readonly tacAllocNums: (Float64Array | null)[];
  private readonly tacAllocModcods: (Uint16Array | null)[];
  private readonly backlogNums: (Float64Array | null)[];
  private readonly backlogMeta: (Uint16Array | null)[];

  private readonly stringTable: string[] = [''];
  private readonly stringMap = new Map<string, number>([['', 0]]);

  constructor(capacity = 3000) {
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new Error(`SchedulerHistoryBuffer capacity must be an integer >= 2, got ${capacity}`);
    }
    this.capacity = capacity;
    this.frameIndexArr = new Float64Array(capacity);
    this.simTimeArr = new Float64Array(capacity);
    this.selectedNodeIdArr = new Int32Array(capacity);
    this.spatialRevisionArr = new Int32Array(capacity);
    this.schedulerModeIdArr = new Uint16Array(capacity);
    this.evacStatusIdArr = new Uint16Array(capacity);
    this.flagsArr = new Uint16Array(capacity);
    this.kpiArr = new Float64Array(capacity * KPI_STRIDE);

    this.activeAllocNums = new Array<Float64Array | null>(capacity).fill(null);
    this.activeAllocModcods = new Array<Uint16Array | null>(capacity).fill(null);
    this.staticAllocNums = new Array<Float64Array | null>(capacity).fill(null);
    this.staticAllocModcods = new Array<Uint16Array | null>(capacity).fill(null);
    this.tacAllocNums = new Array<Float64Array | null>(capacity).fill(null);
    this.tacAllocModcods = new Array<Uint16Array | null>(capacity).fill(null);
    this.backlogNums = new Array<Float64Array | null>(capacity).fill(null);
    this.backlogMeta = new Array<Uint16Array | null>(capacity).fill(null);
  }

  public get maxCapacity(): number {
    return this.capacity;
  }

  public get size(): number {
    return this.length;
  }

  private internString(value: string | null | undefined): number {
    if (typeof value !== 'string') return 0;
    const existing = this.stringMap.get(value);
    if (existing !== undefined) return existing;
    const idx = this.stringTable.length;
    if (idx < 65535) {
      this.stringTable.push(value);
      this.stringMap.set(value, idx);
      return idx;
    }
    return 0;
  }

  private packAllocations(
    list: readonly SchedulerSlotAllocation[]
  ): { nums: Float64Array | null; modcods: Uint16Array | null } {
    if (!list || list.length === 0) {
      return { nums: null, modcods: null };
    }
    const n = list.length;
    const nums = new Float64Array(n * ALLOC_NUM_STRIDE);
    const modcods = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const a = list[i];
      const off = i * ALLOC_NUM_STRIDE;
      nums[off] = a.nodeId;
      nums[off + 1] = a.startMs;
      nums[off + 2] = a.durationMs;
      nums[off + 3] = a.durationS;
      nums[off + 4] = a.slotStartS;
      nums[off + 5] = a.capacityBits;
      nums[off + 6] = optNum(a.spectralEfficiency);
      nums[off + 7] = optNum(a.c2Bytes);
      nums[off + 8] = optNum(a.voiceBytes);
      nums[off + 9] = optNum(a.videoBytes);
      nums[off + 10] = optNum(a.photoBytes);
      nums[off + 11] = a.isPreOcclusionFlush ? 1 : 0;
      modcods[i] = typeof a.modcodName === 'string' ? this.internString(a.modcodName) : 0;
    }
    return { nums, modcods };
  }

  private unpackAllocations(
    nums: Float64Array | null,
    modcods: Uint16Array | null
  ): readonly SchedulerSlotAllocation[] {
    if (!nums || nums.length === 0) {
      return Object.freeze([]);
    }
    const n = nums.length / ALLOC_NUM_STRIDE;
    const out: SchedulerSlotAllocation[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const off = i * ALLOC_NUM_STRIDE;
      const mcId = modcods ? modcods[i] : 0;
      out[i] = Object.freeze({
        nodeId: nums[off],
        startMs: nums[off + 1],
        durationMs: nums[off + 2],
        durationS: nums[off + 3],
        slotStartS: nums[off + 4],
        capacityBits: nums[off + 5],
        modcodName: mcId > 0 ? this.stringTable[mcId] : undefined,
        spectralEfficiency: readOptNum(nums[off + 6]),
        c2Bytes: readOptNum(nums[off + 7]),
        voiceBytes: readOptNum(nums[off + 8]),
        videoBytes: readOptNum(nums[off + 9]),
        photoBytes: readOptNum(nums[off + 10]),
        isPreOcclusionFlush: nums[off + 11] === 1,
      });
    }
    return Object.freeze(out);
  }

  private writeSlot(slot: number, input: SchedulerFrameInput): void {
    this.frameIndexArr[slot] = input.frameIndex;
    this.simTimeArr[slot] = input.simulationTimeS;
    this.spatialRevisionArr[slot] = input.spatialRevision ?? 0;
    this.schedulerModeIdArr[slot] = this.internString(input.schedulerMode || 'tac_tad');

    let flags = 0;
    if (typeof input.selectedNodeId === 'number' && Number.isFinite(input.selectedNodeId)) {
      flags |= SFLAG_HAS_SELECTED_NODE;
      this.selectedNodeIdArr[slot] = input.selectedNodeId;
    } else {
      this.selectedNodeIdArr[slot] = -1;
    }

    const kpi = input.kpi;
    const kOff = slot * KPI_STRIDE;
    this.kpiArr[kOff] = kpi.staticGoodputMb;
    this.kpiArr[kOff + 1] = kpi.tacGoodputMb;
    this.kpiArr[kOff + 2] = kpi.gainMultiplier;
    this.kpiArr[kOff + 3] = kpi.staticWastePct;
    this.kpiArr[kOff + 4] = kpi.tacWastePct;
    this.kpiArr[kOff + 5] = kpi.staticDrops;
    this.kpiArr[kOff + 6] = kpi.staticDropPct;
    this.kpiArr[kOff + 7] = kpi.tacDrops;
    this.kpiArr[kOff + 8] = kpi.tacDropPct;
    this.kpiArr[kOff + 9] = kpi.ulUtilizationPct;
    this.kpiArr[kOff + 10] = optNum(kpi.staticUtilizationPct);
    this.kpiArr[kOff + 11] = optNum(kpi.tacUtilizationPct);
    this.kpiArr[kOff + 12] = optNum(kpi.activeGoodputFrameBits);
    this.kpiArr[kOff + 13] = optNum(kpi.staticGoodputFrameBits);
    this.kpiArr[kOff + 14] = optNum(kpi.tacGoodputFrameBits);
    this.kpiArr[kOff + 15] = optNum(kpi.activeWastedFrameBits);
    this.kpiArr[kOff + 16] = optNum(kpi.staticWastedFrameBits);
    this.kpiArr[kOff + 17] = optNum(kpi.tacWastedFrameBits);
    this.kpiArr[kOff + 18] = optNum(kpi.activeDropFramePkts);
    this.kpiArr[kOff + 19] = optNum(kpi.staticDropFramePkts);
    this.kpiArr[kOff + 20] = optNum(kpi.tacDropFramePkts);
    this.kpiArr[kOff + 21] = optNum(kpi.activeDropDelayFramePkts);
    this.kpiArr[kOff + 22] = optNum(kpi.activeDropOverflowFramePkts);
    this.kpiArr[kOff + 23] = optNum(kpi.staticDropDelayFramePkts);
    this.kpiArr[kOff + 24] = optNum(kpi.staticDropOverflowFramePkts);
    this.kpiArr[kOff + 25] = optNum(kpi.tacDropDelayFramePkts);
    this.kpiArr[kOff + 26] = optNum(kpi.tacDropOverflowFramePkts);
    this.kpiArr[kOff + 27] = optNum(kpi.node4PreShadowBacklogKb);
    this.kpiArr[kOff + 28] = optNum(kpi.staticNode4PreShadowBacklogKb);
    if (kpi.staticSelectedBacklogKb === null) {
      flags |= SFLAG_STATIC_SEL_NULL;
      this.kpiArr[kOff + 29] = Number.NaN;
    } else {
      this.kpiArr[kOff + 29] = optNum(kpi.staticSelectedBacklogKb);
    }
    if (kpi.tacSelectedBacklogKb === null) {
      flags |= SFLAG_TAC_SEL_NULL;
      this.kpiArr[kOff + 30] = Number.NaN;
    } else {
      this.kpiArr[kOff + 30] = optNum(kpi.tacSelectedBacklogKb);
    }
    this.kpiArr[kOff + 31] = optNum(input.ctrlDurationMs);
    this.kpiArr[kOff + 32] = optNum(input.dlDurationMs);
    this.kpiArr[kOff + 33] = typeof input.superframeDurationMs === 'number' ? input.superframeDurationMs : 20.0;

    if (typeof kpi.node4EvacStatus === 'string') {
      flags |= SFLAG_HAS_EVAC_STATUS;
      this.evacStatusIdArr[slot] = this.internString(kpi.node4EvacStatus);
    } else {
      this.evacStatusIdArr[slot] = 0;
    }

    const activePacked = this.packAllocations(input.activeAllocations ?? []);
    this.activeAllocNums[slot] = activePacked.nums;
    this.activeAllocModcods[slot] = activePacked.modcods;

    if (Array.isArray(input.staticAllocations)) {
      flags |= SFLAG_HAS_STATIC_ALLOCS;
      const p = this.packAllocations(input.staticAllocations);
      this.staticAllocNums[slot] = p.nums;
      this.staticAllocModcods[slot] = p.modcods;
    } else {
      this.staticAllocNums[slot] = null;
      this.staticAllocModcods[slot] = null;
    }

    if (Array.isArray(input.tacAllocations)) {
      flags |= SFLAG_HAS_TAC_ALLOCS;
      const p = this.packAllocations(input.tacAllocations);
      this.tacAllocNums[slot] = p.nums;
      this.tacAllocModcods[slot] = p.modcods;
    } else {
      this.tacAllocNums[slot] = null;
      this.tacAllocModcods[slot] = null;
    }

    this.flagsArr[slot] = flags;

    const nbList = Array.isArray(input.nodeBacklogs) ? input.nodeBacklogs : [];
    if (nbList.length === 0) {
      this.backlogNums[slot] = null;
      this.backlogMeta[slot] = null;
    } else {
      const nbNums = new Float64Array(nbList.length * BACKLOG_NUM_STRIDE);
      const nbMeta = new Uint16Array(nbList.length * BACKLOG_META_STRIDE);
      for (let i = 0; i < nbList.length; i++) {
        const nb = nbList[i];
        const nOff = i * BACKLOG_NUM_STRIDE;
        const mOff = i * BACKLOG_META_STRIDE;
        nbNums[nOff] = nb.nodeId;
        nbNums[nOff + 1] = nb.c2Bytes;
        nbNums[nOff + 2] = nb.voiceBytes;
        nbNums[nOff + 3] = nb.videoBytes;
        nbNums[nOff + 4] = nb.photoBytes;
        nbNums[nOff + 5] = nb.totalBacklogBytes;
        nbNums[nOff + 6] = nb.c2Packets;
        nbNums[nOff + 7] = nb.voicePackets;
        nbNums[nOff + 8] = nb.videoPackets;
        nbNums[nOff + 9] = nb.photoPackets;
        nbNums[nOff + 10] = optNum(nb.snrDb);
        nbNums[nOff + 11] = optNum(nb.bitrateMbps);

        nbMeta[mOff] = typeof nb.name === 'string' ? this.internString(nb.name) : 0;
        nbMeta[mOff + 1] = typeof nb.stateName === 'string' ? this.internString(nb.stateName) : 0;
        let nbFlags = 0;
        if (typeof nb.linkOutage === 'boolean') {
          nbFlags |= NB_HAS_OUTAGE | (nb.linkOutage ? NB_OUTAGE_TRUE : 0);
        }
        if (typeof nb.obstacleBlocked === 'boolean') {
          nbFlags |= NB_HAS_OBS_BLK | (nb.obstacleBlocked ? NB_OBS_BLK_TRUE : 0);
        }
        nbMeta[mOff + 2] = nbFlags;
      }
      this.backlogNums[slot] = nbNums;
      this.backlogMeta[slot] = nbMeta;
    }
  }

  private readSlotAsFrozenRecord(slot: number): SchedulerFrameRecord {
    const flags = this.flagsArr[slot];
    const kOff = slot * KPI_STRIDE;

    const kpi: SchedulerKpiSnapshot = Object.freeze({
      staticGoodputMb: this.kpiArr[kOff],
      tacGoodputMb: this.kpiArr[kOff + 1],
      gainMultiplier: this.kpiArr[kOff + 2],
      staticWastePct: this.kpiArr[kOff + 3],
      tacWastePct: this.kpiArr[kOff + 4],
      staticDrops: this.kpiArr[kOff + 5],
      staticDropPct: this.kpiArr[kOff + 6],
      tacDrops: this.kpiArr[kOff + 7],
      tacDropPct: this.kpiArr[kOff + 8],
      ulUtilizationPct: this.kpiArr[kOff + 9],
      staticUtilizationPct: readOptNum(this.kpiArr[kOff + 10]),
      tacUtilizationPct: readOptNum(this.kpiArr[kOff + 11]),
      activeGoodputFrameBits: readOptNum(this.kpiArr[kOff + 12]),
      staticGoodputFrameBits: readOptNum(this.kpiArr[kOff + 13]),
      tacGoodputFrameBits: readOptNum(this.kpiArr[kOff + 14]),
      activeWastedFrameBits: readOptNum(this.kpiArr[kOff + 15]),
      staticWastedFrameBits: readOptNum(this.kpiArr[kOff + 16]),
      tacWastedFrameBits: readOptNum(this.kpiArr[kOff + 17]),
      activeDropFramePkts: readOptNum(this.kpiArr[kOff + 18]),
      staticDropFramePkts: readOptNum(this.kpiArr[kOff + 19]),
      tacDropFramePkts: readOptNum(this.kpiArr[kOff + 20]),
      activeDropDelayFramePkts: readOptNum(this.kpiArr[kOff + 21]),
      activeDropOverflowFramePkts: readOptNum(this.kpiArr[kOff + 22]),
      staticDropDelayFramePkts: readOptNum(this.kpiArr[kOff + 23]),
      staticDropOverflowFramePkts: readOptNum(this.kpiArr[kOff + 24]),
      tacDropDelayFramePkts: readOptNum(this.kpiArr[kOff + 25]),
      tacDropOverflowFramePkts: readOptNum(this.kpiArr[kOff + 26]),
      node4PreShadowBacklogKb: readOptNum(this.kpiArr[kOff + 27]),
      staticNode4PreShadowBacklogKb: readOptNum(this.kpiArr[kOff + 28]),
      node4EvacStatus:
        flags & SFLAG_HAS_EVAC_STATUS ? this.stringTable[this.evacStatusIdArr[slot]] : undefined,
      staticSelectedBacklogKb:
        flags & SFLAG_STATIC_SEL_NULL ? null : readOptNum(this.kpiArr[kOff + 29]),
      tacSelectedBacklogKb:
        flags & SFLAG_TAC_SEL_NULL ? null : readOptNum(this.kpiArr[kOff + 30]),
    });

    const nbNums = this.backlogNums[slot];
    const nbMeta = this.backlogMeta[slot];
    let frozenBacklogs: readonly SchedulerNodeBacklog[];
    if (!nbNums || !nbMeta || nbNums.length === 0) {
      frozenBacklogs = Object.freeze([]);
    } else {
      const nbCount = nbNums.length / BACKLOG_NUM_STRIDE;
      const arr: SchedulerNodeBacklog[] = new Array(nbCount);
      for (let i = 0; i < nbCount; i++) {
        const nOff = i * BACKLOG_NUM_STRIDE;
        const mOff = i * BACKLOG_META_STRIDE;
        const nameId = nbMeta[mOff];
        const stateId = nbMeta[mOff + 1];
        const nbFlags = nbMeta[mOff + 2];
        arr[i] = Object.freeze({
          nodeId: nbNums[nOff],
          name: nameId > 0 ? this.stringTable[nameId] : undefined,
          c2Bytes: nbNums[nOff + 1],
          voiceBytes: nbNums[nOff + 2],
          videoBytes: nbNums[nOff + 3],
          photoBytes: nbNums[nOff + 4],
          totalBacklogBytes: nbNums[nOff + 5],
          c2Packets: nbNums[nOff + 6],
          voicePackets: nbNums[nOff + 7],
          videoPackets: nbNums[nOff + 8],
          photoPackets: nbNums[nOff + 9],
          snrDb: readOptNum(nbNums[nOff + 10]),
          bitrateMbps: readOptNum(nbNums[nOff + 11]),
          stateName: stateId > 0 ? this.stringTable[stateId] : undefined,
          linkOutage: nbFlags & NB_HAS_OUTAGE ? Boolean(nbFlags & NB_OUTAGE_TRUE) : undefined,
          obstacleBlocked: nbFlags & NB_HAS_OBS_BLK ? Boolean(nbFlags & NB_OBS_BLK_TRUE) : undefined,
        });
      }
      frozenBacklogs = Object.freeze(arr);
    }

    return Object.freeze({
      frameIndex: this.frameIndexArr[slot],
      simulationTimeS: this.simTimeArr[slot],
      schedulerMode: this.stringTable[this.schedulerModeIdArr[slot]] ?? 'tac_tad',
      selectedNodeId: flags & SFLAG_HAS_SELECTED_NODE ? this.selectedNodeIdArr[slot] : null,
      spatialRevision: this.spatialRevisionArr[slot],
      activeAllocations: this.unpackAllocations(
        this.activeAllocNums[slot],
        this.activeAllocModcods[slot]
      ),
      staticAllocations:
        flags & SFLAG_HAS_STATIC_ALLOCS
          ? this.unpackAllocations(this.staticAllocNums[slot], this.staticAllocModcods[slot])
          : undefined,
      tacAllocations:
        flags & SFLAG_HAS_TAC_ALLOCS
          ? this.unpackAllocations(this.tacAllocNums[slot], this.tacAllocModcods[slot])
          : undefined,
      nodeBacklogs: frozenBacklogs,
      kpi,
      ctrlDurationMs: readOptNum(this.kpiArr[kOff + 31]),
      dlDurationMs: readOptNum(this.kpiArr[kOff + 32]),
      superframeDurationMs: this.kpiArr[kOff + 33],
    });
  }

  /**
   * Zero-freeze hot-path ingestion into TypedArray ring storage.
   */
  public pushRaw(input: SchedulerFrameInput): void {
    if (!input || typeof input.frameIndex !== 'number' || !Number.isFinite(input.frameIndex)) {
      return;
    }

    if (this.length > 0) {
      const newestSlot = (this.head - 1) % this.capacity;
      const newestFrame = this.frameIndexArr[newestSlot];
      if (input.frameIndex < newestFrame) {
        this.clear();
      } else if (input.frameIndex === newestFrame) {
        this.writeSlot(newestSlot, input);
        return;
      }
    }

    const slot = this.head % this.capacity;
    this.writeSlot(slot, input);
    this.head++;
    if (this.length < this.capacity) {
      this.length++;
    }
  }

  public push(record: SchedulerFrameRecord): void {
    this.pushRaw(record);
  }

  public getByFrameIndex(frameIndex: number): SchedulerFrameRecord | null {
    if (this.length === 0 || !Number.isFinite(frameIndex)) return null;

    const oldestSlot = (this.head - this.length) % this.capacity;
    const newestSlot = (this.head - 1) % this.capacity;
    if (frameIndex < this.frameIndexArr[oldestSlot] || frameIndex > this.frameIndexArr[newestSlot]) {
      return null;
    }

    const startOffset = this.head - 1;
    for (let i = 0; i < this.length; i++) {
      const slot = (startOffset - i) % this.capacity;
      const f = this.frameIndexArr[slot];
      if (f === frameIndex) {
        return this.readSlotAsFrozenRecord(slot);
      }
      if (f < frameIndex) {
        break;
      }
    }
    return null;
  }

  public getOldest(): SchedulerFrameRecord | null {
    if (this.length === 0) return null;
    const slot = (this.head - this.length) % this.capacity;
    return this.readSlotAsFrozenRecord(slot);
  }

  public getNewest(): SchedulerFrameRecord | null {
    if (this.length === 0) return null;
    const slot = (this.head - 1) % this.capacity;
    return this.readSlotAsFrozenRecord(slot);
  }

  public isEvicted(frameIndex: number): boolean {
    if (this.length === 0 || !Number.isFinite(frameIndex)) return false;
    const oldestSlot = (this.head - this.length) % this.capacity;
    return frameIndex < this.frameIndexArr[oldestSlot];
  }

  public getSpan(): SchedulerHistorySpan {
    if (this.length === 0) {
      return {
        count: 0,
        capacity: this.capacity,
        oldestFrame: null,
        newestFrame: null,
        oldestTimeS: null,
        newestTimeS: null,
      };
    }
    const oldestSlot = (this.head - this.length) % this.capacity;
    const newestSlot = (this.head - 1) % this.capacity;
    return {
      count: this.length,
      capacity: this.capacity,
      oldestFrame: this.frameIndexArr[oldestSlot],
      newestFrame: this.frameIndexArr[newestSlot],
      oldestTimeS: this.simTimeArr[oldestSlot],
      newestTimeS: this.simTimeArr[newestSlot],
    };
  }

  public getChronologicalRecords(): SchedulerFrameRecord[] {
    if (this.length === 0) return [];
    const result: SchedulerFrameRecord[] = new Array(this.length);
    const startSlot = (this.head - this.length) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const slot = (startSlot + i) % this.capacity;
      result[i] = this.readSlotAsFrozenRecord(slot);
    }
    return result;
  }

  public clear(): void {
    this.head = 0;
    this.length = 0;
    this.activeAllocNums.fill(null);
    this.activeAllocModcods.fill(null);
    this.staticAllocNums.fill(null);
    this.staticAllocModcods.fill(null);
    this.tacAllocNums.fill(null);
    this.tacAllocModcods.fill(null);
    this.backlogNums.fill(null);
    this.backlogMeta.fill(null);
  }

  public measureTotalMemoryBytes(): number {
    let total = this.length * FIXED_BYTES_PER_SLOT;
    const startSlot = (this.head - this.length + this.capacity) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const slot = (startSlot + i) % this.capacity;
      total += this.activeAllocNums[slot]?.byteLength ?? 0;
      total += this.activeAllocModcods[slot]?.byteLength ?? 0;
      total += this.staticAllocNums[slot]?.byteLength ?? 0;
      total += this.staticAllocModcods[slot]?.byteLength ?? 0;
      total += this.tacAllocNums[slot]?.byteLength ?? 0;
      total += this.tacAllocModcods[slot]?.byteLength ?? 0;
      total += this.backlogNums[slot]?.byteLength ?? 0;
      total += this.backlogMeta[slot]?.byteLength ?? 0;
    }
    return total;
  }
}

/**
 * State machine managing scheduler historical inspection vs live stream mode.
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

  public enterHistorical(targetFrameIndex?: number, isCurrentlyRunning = false): {
    record: SchedulerFrameRecord | null;
    shouldPause: boolean;
  } {
    if (!this.inspecting) {
      this.inspecting = true;
      this.wasRunningBeforeHistorical = isCurrentlyRunning;
    }

    const span = this.buffer.getSpan();
    const frameToInspect = typeof targetFrameIndex === 'number'
      ? targetFrameIndex
      : (span.newestFrame ?? 0);

    const record = this.scrubTo(frameToInspect);

    return {
      record,
      shouldPause: isCurrentlyRunning,
    };
  }

  public scrubTo(frameIndex: number): SchedulerFrameRecord | null {
    this.inspecting = true;
    this.inspectedFrameIndex = frameIndex;

    const direct = this.buffer.getByFrameIndex(frameIndex);
    if (direct) {
      this.isCurrentlyEvicted = false;
      return direct;
    }

    if (this.buffer.isEvicted(frameIndex)) {
      this.isCurrentlyEvicted = true;
      const oldest = this.buffer.getOldest();
      if (oldest) {
        this.inspectedFrameIndex = oldest.frameIndex;
        return oldest;
      }
    }

    const newest = this.buffer.getNewest();
    if (newest && frameIndex > newest.frameIndex) {
      this.isCurrentlyEvicted = false;
      this.inspectedFrameIndex = newest.frameIndex;
      return newest;
    }

    this.isCurrentlyEvicted = false;
    return newest ?? null;
  }

  public exitHistorical(): { shouldResume: boolean } {
    const shouldResume = this.wasRunningBeforeHistorical;
    this.inspecting = false;
    this.inspectedFrameIndex = null;
    this.wasRunningBeforeHistorical = false;
    this.isCurrentlyEvicted = false;
    return { shouldResume };
  }

  public getActiveHistoricalRecord(): SchedulerFrameRecord | null {
    if (!this.inspecting || this.inspectedFrameIndex === null) {
      return null;
    }
    return this.scrubTo(this.inspectedFrameIndex);
  }

  public reset(): void {
    this.inspecting = false;
    this.inspectedFrameIndex = null;
    this.wasRunningBeforeHistorical = false;
    this.isCurrentlyEvicted = false;
    this.buffer.clear();
  }
}
