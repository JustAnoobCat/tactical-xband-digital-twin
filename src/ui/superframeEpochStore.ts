/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Superframe Epoch Store (DRDO-TAC-XBAND-ARCH-TIMELINE-17)
 *
 * Implements:
 * 1. Bounded high-performance circular ring buffer for completed TDMA superframe
 *    communication epoch records and mid-run reconfiguration discontinuities.
 * 2. Strict run-generation monotonic isolation (`simulationRunId` state machine)
 *    with side-effect-free validation and coordinator cleanup hooks.
 * 3. Dedicated bounded FIFO retention and O(evictionCapacity) deduplication for
 *    point-in-time `NODE_EVICTION_FINALIZATION` records plus O(1) Option A
 *    discarded-history watermark tracking.
 */

import type {
  TimelineCommunicationRecord,
  SuperframeEpochRecord,
  SuperframeDiscontinuityRecord,
  EvictionDropFinalizationRecord,
} from '../shared/workerProtocol';

export type IntervalCommunicationRecord = SuperframeEpochRecord | SuperframeDiscontinuityRecord;

export type RunGenerationSyncResult =
  | 'ACCEPTED'
  | 'FIRST_TAGGED_ACTIVATION'
  | 'RESET_AND_ACCEPTED'
  | 'REJECTED_STALE';

export type StoreRunTransitionKind =
  | 'FIRST_TAGGED_ACTIVATION'
  | 'RESET_AND_ACCEPTED'
  | 'EXPLICIT_RESET';

export interface EpochStoreCoordinatorHooks {
  readonly hasCoordinatedHistory?: () => boolean;
  readonly onBeforeTaggedTransition?: (
    kind: StoreRunTransitionKind,
    nextRunId: number | null
  ) => void;
}

export interface EvictionHistoryMetadata {
  readonly evictionCapacity: number;
  readonly retainedCount: number;
  readonly totalEvictionRecordsSeen: number;
  readonly discardedEvictionCount: number;
  readonly evictedByCapacityCount: number;
  readonly evictedByHorizonCount: number;
  readonly hasEvictedFinalizationHistory: boolean;
  readonly oldestRetainedTimestampS: number | null;
  readonly newestRetainedTimestampS: number | null;
  readonly oldestRetainedFrameIndex: number | null;
  readonly newestRetainedFrameIndex: number | null;
  readonly minDiscardedTimestampS: number | null;
  readonly maxDiscardedTimestampS: number | null;
  readonly minDiscardedFrameIndex: number | null;
  readonly maxDiscardedFrameIndex: number | null;
  readonly minRetainedFinalizationIndex: number | null;
  readonly maxRetainedFinalizationIndex: number | null;
  readonly evictionFloorIndex: number;
}

function isValidSimulationRunTag(runId: unknown): runId is number {
  return typeof runId === 'number' && Number.isInteger(runId) && runId >= 1;
}

function isValidTimelineRecordStructure(record: unknown): record is TimelineCommunicationRecord {
  if (!record || typeof record !== 'object') {
    return false;
  }
  const r = record as Partial<TimelineCommunicationRecord>;
  if (r.simulationRunId !== undefined && !isValidSimulationRunTag(r.simulationRunId)) {
    return false;
  }
  if (r.recordType === 'EPOCH' || r.recordType === 'DISCONTINUITY') {
    return (
      typeof r.startTimeS === 'number' &&
      Number.isFinite(r.startTimeS) &&
      r.startTimeS >= 0 &&
      typeof r.endTimeS === 'number' &&
      Number.isFinite(r.endTimeS) &&
      r.endTimeS >= r.startTimeS
    );
  }
  if (r.recordType === 'NODE_EVICTION_FINALIZATION') {
    const ev = r as Partial<EvictionDropFinalizationRecord>;
    return (
      typeof ev.finalizationIndex === 'number' &&
      Number.isInteger(ev.finalizationIndex) &&
      ev.finalizationIndex >= 0 &&
      typeof ev.nodeId === 'number' &&
      Number.isInteger(ev.nodeId) &&
      typeof ev.timestampS === 'number' &&
      Number.isFinite(ev.timestampS) &&
      ev.timestampS >= 0 &&
      typeof ev.associatedSimulationFrameIndex === 'number' &&
      Number.isInteger(ev.associatedSimulationFrameIndex) &&
      ev.associatedSimulationFrameIndex >= 0 &&
      typeof ev.totalDroppedBytes === 'number' &&
      Number.isFinite(ev.totalDroppedBytes) &&
      ev.totalDroppedBytes >= 0 &&
      typeof ev.totalDroppedPkts === 'number' &&
      Number.isFinite(ev.totalDroppedPkts) &&
      ev.totalDroppedPkts >= 0 &&
      (ev.schedulerId === 'STATIC_TDMA' || ev.schedulerId === 'TAC_TAD')
    );
  }
  return false;
}

export class SuperframeEpochStore {
  public readonly capacity: number;
  public readonly evictionCapacity: number;
  private readonly slots: (IntervalCommunicationRecord | null)[];
  private writeIndex: number = 0;
  private _count: number = 0;

  // Run-generation state machine (monotone per-session run isolation)
  private taggedModeLocked: boolean = false;
  private activeSimulationRunId: number | null = null;
  private minimumAcceptedRunId: number = 1;
  private pendingResetCleared: boolean = false;
  private coordinatorHooks: EpochStoreCoordinatorHooks | null = null;
  private isDispatchingCoordinatorHook: boolean = false;

  // Bounded eviction finalization history + O(evictionCapacity) dedup + O(1) Option A watermarks
  private evictionRecords: EvictionDropFinalizationRecord[] = [];
  private readonly retainedEvictionIndices: Set<number> = new Set();
  private evictionFloorIndex: number = 0;
  private totalEvictionRecordsSeen: number = 0;
  private discardedEvictionCount: number = 0;
  private evictedByCapacityCount: number = 0;
  private evictedByHorizonCount: number = 0;
  private minDiscardedTimestampS: number | null = null;
  private maxDiscardedTimestampS: number | null = null;
  private minDiscardedFrameIndex: number | null = null;
  private maxDiscardedFrameIndex: number | null = null;

  constructor(capacity: number = 6000, evictionCapacity: number = 1000) {
    if (capacity <= 0 || !Number.isInteger(capacity)) {
      throw new Error(`Epoch store capacity must be a positive integer, got ${capacity}`);
    }
    if (evictionCapacity <= 0 || !Number.isInteger(evictionCapacity)) {
      throw new Error(`Eviction store capacity must be a positive integer, got ${evictionCapacity}`);
    }
    this.capacity = capacity;
    this.evictionCapacity = evictionCapacity;
    this.slots = new Array(capacity).fill(null);
  }

  public get count(): number {
    return this._count;
  }

  public get evictionCount(): number {
    return this.evictionRecords.length;
  }

  public isTaggedRunActive(): boolean {
    return this.taggedModeLocked;
  }

  public getActiveSimulationRunId(): number | null {
    return this.activeSimulationRunId;
  }

  public getMinimumAcceptedRunId(): number {
    return this.minimumAcceptedRunId;
  }

  public registerCoordinator(hooks: EpochStoreCoordinatorHooks | null): () => void {
    this.coordinatorHooks = hooks;
    return () => {
      if (this.coordinatorHooks === hooks) {
        this.coordinatorHooks = null;
      }
    };
  }

  public hasAnyStoredData(): boolean {
    return (
      this._count > 0 ||
      this.evictionRecords.length > 0 ||
      Boolean(this.coordinatorHooks?.hasCoordinatedHistory?.())
    );
  }

  private dispatchCoordinatorHook(kind: StoreRunTransitionKind, nextRunId: number | null): void {
    if (this.isDispatchingCoordinatorHook) {
      return;
    }
    this.isDispatchingCoordinatorHook = true;
    try {
      this.coordinatorHooks?.onBeforeTaggedTransition?.(kind, nextRunId);
    } finally {
      this.isDispatchingCoordinatorHook = false;
    }
  }

  private clearDataBuffersOnly(): void {
    this.slots.fill(null);
    this.writeIndex = 0;
    this._count = 0;

    this.evictionRecords = [];
    this.retainedEvictionIndices.clear();
    this.evictionFloorIndex = 0;
    this.totalEvictionRecordsSeen = 0;
    this.discardedEvictionCount = 0;
    this.evictedByCapacityCount = 0;
    this.evictedByHorizonCount = 0;
    this.minDiscardedTimestampS = null;
    this.maxDiscardedTimestampS = null;
    this.minDiscardedFrameIndex = null;
    this.maxDiscardedFrameIndex = null;
  }

  /**
   * Synchronizes the store with an incoming tagged `simulationRunId`.
   * Performs side-effect-free validation before mutating tagged mode or buffers,
   * and commits cleared store state BEFORE firing coordinator hooks.
   */
  public syncSimulationRunId(runId: number): RunGenerationSyncResult {
    if (!isValidSimulationRunTag(runId)) {
      return 'REJECTED_STALE';
    }
    if (runId < this.minimumAcceptedRunId) {
      return 'REJECTED_STALE';
    }
    if (this.activeSimulationRunId !== null && runId < this.activeSimulationRunId) {
      return 'REJECTED_STALE';
    }

    if (!this.taggedModeLocked) {
      this.clearDataBuffersOnly();
      this.taggedModeLocked = true;
      this.activeSimulationRunId = runId;
      this.minimumAcceptedRunId = Math.max(this.minimumAcceptedRunId, runId);
      this.pendingResetCleared = false;
      this.dispatchCoordinatorHook('FIRST_TAGGED_ACTIVATION', runId);
      return 'FIRST_TAGGED_ACTIVATION';
    }

    if (this.activeSimulationRunId === runId) {
      this.pendingResetCleared = false;
      return 'ACCEPTED';
    }

    if (this.activeSimulationRunId === null) {
      if (this.hasAnyStoredData() || !this.pendingResetCleared) {
        this.clearDataBuffersOnly();
        this.activeSimulationRunId = runId;
        this.minimumAcceptedRunId = Math.max(this.minimumAcceptedRunId, runId);
        this.pendingResetCleared = false;
        this.dispatchCoordinatorHook('RESET_AND_ACCEPTED', runId);
        return 'RESET_AND_ACCEPTED';
      }
      this.activeSimulationRunId = runId;
      this.minimumAcceptedRunId = Math.max(this.minimumAcceptedRunId, runId);
      this.pendingResetCleared = false;
      return 'ACCEPTED';
    }

    // Active runId jumped strictly forward (runId > this.activeSimulationRunId)
    this.clearDataBuffersOnly();
    this.activeSimulationRunId = runId;
    this.minimumAcceptedRunId = Math.max(this.minimumAcceptedRunId, runId);
    this.pendingResetCleared = false;
    this.dispatchCoordinatorHook('RESET_AND_ACCEPTED', runId);
    return 'RESET_AND_ACCEPTED';
  }

  /**
   * Notifies the store of an explicit simulation reset or preset transition.
   * All bounds, run monotonicity, and duplicate-empty checks run BEFORE mutating state,
   * and state commits BEFORE coordinator hooks are dispatched.
   */
  public notifySimulationReset(nextRunId?: number): boolean {
    if (nextRunId !== undefined) {
      if (!isValidSimulationRunTag(nextRunId)) {
        return false;
      }
      if (nextRunId < this.minimumAcceptedRunId) {
        return false;
      }
      if (this.activeSimulationRunId !== null && nextRunId <= this.activeSimulationRunId) {
        return false;
      }
      if (
        this.activeSimulationRunId === null &&
        nextRunId === this.minimumAcceptedRunId &&
        this.pendingResetCleared &&
        !this.hasAnyStoredData()
      ) {
        return false;
      }

      this.clearDataBuffersOnly();
      this.taggedModeLocked = true;
      this.minimumAcceptedRunId = Math.max(this.minimumAcceptedRunId, nextRunId);
      this.activeSimulationRunId = null;
      this.pendingResetCleared = true;
      this.dispatchCoordinatorHook('EXPLICIT_RESET', nextRunId);
      return true;
    }

    // 0-arg reset: reject no-op resets while already empty & without active run
    if (this.activeSimulationRunId === null && !this.hasAnyStoredData()) {
      return false;
    }

    if (this.activeSimulationRunId !== null) {
      const nextFloor = Math.max(this.minimumAcceptedRunId, this.activeSimulationRunId + 1);
      this.clearDataBuffersOnly();
      this.minimumAcceptedRunId = nextFloor;
      this.activeSimulationRunId = null;
      this.pendingResetCleared = true;
      this.dispatchCoordinatorHook('EXPLICIT_RESET', nextFloor);
      return true;
    }

    // Pre-tagged (or cleared-active) reset with residual history: preserve current taggedModeLocked
    const nextFloor = this.taggedModeLocked ? this.minimumAcceptedRunId : null;
    this.clearDataBuffersOnly();
    this.pendingResetCleared = true;
    this.dispatchCoordinatorHook('EXPLICIT_RESET', nextFloor);
    return true;
  }

  public append(record: TimelineCommunicationRecord): boolean {
    // Structural-first validation: reject malformed records before touching run state
    if (!isValidTimelineRecordStructure(record)) {
      return false;
    }

    if (record.simulationRunId !== undefined) {
      const syncResult = this.syncSimulationRunId(record.simulationRunId);
      if (syncResult === 'REJECTED_STALE') {
        return false;
      }
      return this.appendValidatedRecord(record);
    }

    if (this.taggedModeLocked) {
      return false;
    }
    return this.appendLegacyUntaggedMockRecord(record);
  }

  public appendLegacyUntaggedMockForTest(record: TimelineCommunicationRecord): boolean {
    if (this.taggedModeLocked) {
      return false;
    }
    if (!isValidTimelineRecordStructure(record) || record.simulationRunId !== undefined) {
      return false;
    }
    return this.appendLegacyUntaggedMockRecord(record);
  }

  private appendLegacyUntaggedMockRecord(record: TimelineCommunicationRecord): boolean {
    if (
      (record.recordType === 'EPOCH' || record.recordType === 'DISCONTINUITY') &&
      record.startTimeS === 0 &&
      this._count > 0 &&
      this.newestRecord &&
      this.newestRecord.startTimeS > 0
    ) {
      this.clearDataBuffersOnly();
    }
    this.pendingResetCleared = false;
    return this.appendValidatedRecord(record);
  }

  private appendValidatedRecord(record: TimelineCommunicationRecord): boolean {
    if (record.recordType === 'NODE_EVICTION_FINALIZATION') {
      return this.appendEvictionFinalizationInternal(record);
    }
    return this.appendIntervalRecordInternal(record);
  }

  private appendIntervalRecordInternal(record: IntervalCommunicationRecord): boolean {
    const wasFull = this._count === this.capacity;
    this.slots[this.writeIndex] = record;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this._count < this.capacity) {
      this._count++;
    }
    if (wasFull && this.evictionRecords.length > 0 && this.oldestRecord) {
      this.pruneEvictionsBeforeTimestamp(this.oldestRecord.startTimeS);
    }
    return true;
  }

  private recordDiscardedEviction(
    dropped: EvictionDropFinalizationRecord,
    cause: 'capacity' | 'horizon'
  ): void {
    this.retainedEvictionIndices.delete(dropped.finalizationIndex);
    this.evictionFloorIndex = Math.max(this.evictionFloorIndex, dropped.finalizationIndex + 1);
    this.discardedEvictionCount++;
    if (cause === 'capacity') {
      this.evictedByCapacityCount++;
    } else {
      this.evictedByHorizonCount++;
    }
    this.minDiscardedTimestampS =
      this.minDiscardedTimestampS === null
        ? dropped.timestampS
        : Math.min(this.minDiscardedTimestampS, dropped.timestampS);
    this.maxDiscardedTimestampS =
      this.maxDiscardedTimestampS === null
        ? dropped.timestampS
        : Math.max(this.maxDiscardedTimestampS, dropped.timestampS);
    this.minDiscardedFrameIndex =
      this.minDiscardedFrameIndex === null
        ? dropped.associatedSimulationFrameIndex
        : Math.min(this.minDiscardedFrameIndex, dropped.associatedSimulationFrameIndex);
    this.maxDiscardedFrameIndex =
      this.maxDiscardedFrameIndex === null
        ? dropped.associatedSimulationFrameIndex
        : Math.max(this.maxDiscardedFrameIndex, dropped.associatedSimulationFrameIndex);
  }

  private pruneEvictionsBeforeTimestamp(horizonStartTimeS: number): void {
    if (this.evictionRecords.length === 0) return;
    const kept: EvictionDropFinalizationRecord[] = [];
    for (let i = 0; i < this.evictionRecords.length; i++) {
      const ev = this.evictionRecords[i];
      if (ev.timestampS < horizonStartTimeS) {
        this.recordDiscardedEviction(ev, 'horizon');
      } else {
        kept.push(ev);
      }
    }
    if (kept.length !== this.evictionRecords.length) {
      this.evictionRecords = kept;
    }
  }

  private appendEvictionFinalizationInternal(record: EvictionDropFinalizationRecord): boolean {
    if (
      record.finalizationIndex < this.evictionFloorIndex ||
      this.retainedEvictionIndices.has(record.finalizationIndex)
    ) {
      return false;
    }
    this.totalEvictionRecordsSeen++;
    this.retainedEvictionIndices.add(record.finalizationIndex);
    this.evictionRecords.push(record);
    while (this.evictionRecords.length > this.evictionCapacity) {
      const evicted = this.evictionRecords.shift()!;
      this.recordDiscardedEviction(evicted, 'capacity');
    }
    return true;
  }

  public ingestBatch(records: readonly TimelineCommunicationRecord[]): number {
    if (!Array.isArray(records) || records.length === 0) return 0;
    let appended = 0;
    for (let i = 0; i < records.length; i++) {
      if (this.append(records[i])) {
        appended++;
      }
    }
    return appended;
  }

  public get oldestRecord(): IntervalCommunicationRecord | null {
    if (this._count === 0) return null;
    if (this._count < this.capacity) {
      return this.slots[0];
    }
    return this.slots[this.writeIndex];
  }

  public get newestRecord(): IntervalCommunicationRecord | null {
    if (this._count === 0) return null;
    const newestIdx = (this.writeIndex - 1 + this.capacity) % this.capacity;
    return this.slots[newestIdx];
  }

  public get(logicalIndex: number): IntervalCommunicationRecord | null {
    if (logicalIndex < 0 || logicalIndex >= this._count) return null;
    const physicalIndex = this._count < this.capacity
      ? logicalIndex
      : (this.writeIndex + logicalIndex) % this.capacity;
    return this.slots[physicalIndex];
  }

  /**
   * Finds the epoch or discontinuity record containing timeS [startTimeS, endTimeS).
   */
  public findAtTime(timeS: number): IntervalCommunicationRecord | null {
    if (this._count === 0) return null;
    let low = 0;
    let high = this._count - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const rec = this.get(mid)!;
      if (timeS >= rec.startTimeS && timeS < rec.endTimeS) {
        return rec;
      }
      if (rec.endTimeS <= timeS) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return null;
  }

  /**
   * Retrieves all epoch/discontinuity records that overlap with the range [startTimeS, endTimeS).
   */
  public getRecordsInRange(startTimeS: number, endTimeS: number): IntervalCommunicationRecord[] {
    if (this._count === 0 || startTimeS >= endTimeS) return [];
    const results: IntervalCommunicationRecord[] = [];

    let low = 0;
    let high = this._count - 1;
    let firstIdx = -1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const rec = this.get(mid)!;
      if (rec.endTimeS > startTimeS) {
        firstIdx = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    if (firstIdx < 0) return [];

    for (let i = firstIdx; i < this._count; i++) {
      const rec = this.get(i);
      if (!rec) break;
      if (rec.startTimeS >= endTimeS) {
        break;
      }
      if (rec.startTimeS < endTimeS && rec.endTimeS > startTimeS) {
        results.push(rec);
      }
    }
    return results;
  }

  public getEvictionFinalizations(): readonly EvictionDropFinalizationRecord[] {
    return this.evictionRecords;
  }

  public getEvictionFinalizationsInWindow(
    startTimeS: number,
    endTimeS: number,
    inclusiveEnd: boolean = true
  ): EvictionDropFinalizationRecord[] {
    if (this.evictionRecords.length === 0) return [];
    if (endTimeS < startTimeS || (!inclusiveEnd && startTimeS >= endTimeS)) return [];
    const out: EvictionDropFinalizationRecord[] = [];
    for (let i = 0; i < this.evictionRecords.length; i++) {
      const ev = this.evictionRecords[i];
      if (ev.timestampS >= startTimeS && (inclusiveEnd ? ev.timestampS <= endTimeS : ev.timestampS < endTimeS)) {
        out.push(ev);
      }
    }
    return out;
  }

  public getEvictionFinalizationsForFrame(frameIndex: number): EvictionDropFinalizationRecord[] {
    if (this.evictionRecords.length === 0 || !Number.isInteger(frameIndex)) return [];
    const out: EvictionDropFinalizationRecord[] = [];
    for (let i = 0; i < this.evictionRecords.length; i++) {
      const ev = this.evictionRecords[i];
      if (ev.associatedSimulationFrameIndex === frameIndex) {
        out.push(ev);
      }
    }
    return out;
  }

  public getEvictionHistoryMetadata(): EvictionHistoryMetadata {
    const count = this.evictionRecords.length;
    let oldestTs: number | null = null;
    let newestTs: number | null = null;
    let oldestFrame: number | null = null;
    let newestFrame: number | null = null;
    let minFinIdx: number | null = null;
    let maxFinIdx: number | null = null;

    for (let i = 0; i < count; i++) {
      const ev = this.evictionRecords[i];
      oldestTs = oldestTs === null ? ev.timestampS : Math.min(oldestTs, ev.timestampS);
      newestTs = newestTs === null ? ev.timestampS : Math.max(newestTs, ev.timestampS);
      oldestFrame =
        oldestFrame === null
          ? ev.associatedSimulationFrameIndex
          : Math.min(oldestFrame, ev.associatedSimulationFrameIndex);
      newestFrame =
        newestFrame === null
          ? ev.associatedSimulationFrameIndex
          : Math.max(newestFrame, ev.associatedSimulationFrameIndex);
      minFinIdx = minFinIdx === null ? ev.finalizationIndex : Math.min(minFinIdx, ev.finalizationIndex);
      maxFinIdx = maxFinIdx === null ? ev.finalizationIndex : Math.max(maxFinIdx, ev.finalizationIndex);
    }

    return {
      evictionCapacity: this.evictionCapacity,
      retainedCount: count,
      totalEvictionRecordsSeen: this.totalEvictionRecordsSeen,
      discardedEvictionCount: this.discardedEvictionCount,
      evictedByCapacityCount: this.evictedByCapacityCount,
      evictedByHorizonCount: this.evictedByHorizonCount,
      hasEvictedFinalizationHistory: this.discardedEvictionCount > 0,
      oldestRetainedTimestampS: oldestTs,
      newestRetainedTimestampS: newestTs,
      oldestRetainedFrameIndex: oldestFrame,
      newestRetainedFrameIndex: newestFrame,
      minDiscardedTimestampS: this.minDiscardedTimestampS,
      maxDiscardedTimestampS: this.maxDiscardedTimestampS,
      minDiscardedFrameIndex: this.minDiscardedFrameIndex,
      maxDiscardedFrameIndex: this.maxDiscardedFrameIndex,
      minRetainedFinalizationIndex: minFinIdx,
      maxRetainedFinalizationIndex: maxFinIdx,
      evictionFloorIndex: this.evictionFloorIndex,
    };
  }

  public mayHaveEvictedFinalizationInTimeRange(startTimeS: number, endTimeS: number): boolean {
    if (
      this.discardedEvictionCount === 0 ||
      this.minDiscardedTimestampS === null ||
      this.maxDiscardedTimestampS === null
    ) {
      return false;
    }
    const eps = 1e-9;
    return endTimeS >= this.minDiscardedTimestampS - eps && startTimeS <= this.maxDiscardedTimestampS + eps;
  }

  public mayHaveEvictedFinalizationAtFrameOrTime(
    timeS: number | null,
    frameIndex?: number | null
  ): boolean {
    if (this.discardedEvictionCount === 0) {
      return false;
    }
    const eps = 1e-9;
    if (
      typeof timeS === 'number' &&
      Number.isFinite(timeS) &&
      this.minDiscardedTimestampS !== null &&
      this.maxDiscardedTimestampS !== null &&
      timeS >= this.minDiscardedTimestampS - eps &&
      timeS <= this.maxDiscardedTimestampS + eps
    ) {
      return true;
    }
    if (
      typeof frameIndex === 'number' &&
      Number.isInteger(frameIndex) &&
      this.minDiscardedFrameIndex !== null &&
      this.maxDiscardedFrameIndex !== null &&
      frameIndex >= this.minDiscardedFrameIndex &&
      frameIndex <= this.maxDiscardedFrameIndex
    ) {
      return true;
    }
    return false;
  }

  public clear(): void {
    this.clearDataBuffersOnly();
    this.activeSimulationRunId = null;
    this.pendingResetCleared = false;
  }
}
