/**
 * src/core/boundedReplayBuffer.ts
 *
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Bounded FIFO Ring & Adaptive-Decimation Replay Buffer
 *
 * Provides deterministic, memory-capped storage for simulation replay frames:
 * - 'ring': Strict O(1) circular overwrite FIFO ring buffer (0 shift() overhead).
 * - 'adaptive-decimate': Multi-rate adaptive decimation retaining mission start (t0),
 *   prioritizing keyframes (outages/handovers), and thinning regular frames to
 *   maintain constant memory ceiling across arbitrary mission durations.
 * - O(log N) binary search temporal scrubbing via findNearestByTime.
 */

export type ReplayBufferMode = 'ring' | 'adaptive-decimate';

export interface BoundedReplayBufferConfig {
  readonly maxFrames: number;
  readonly mode: ReplayBufferMode;
  readonly maxKeyframesRatio?: number;
}

export interface ReplayFrameEntry<T> {
  readonly simTimeSec: number;
  readonly payload: T;
  readonly isKeyframe: boolean;
  readonly frameId: number;
}

export interface ReplayBufferStats {
  readonly storedFrames: number;
  readonly maxFrames: number;
  readonly totalIngested: number;
  readonly evictedFrames: number;
  readonly currentStride: number;
  readonly keyframeCount: number;
  readonly utilizationRatio: number;
}

export class BoundedReplayBuffer<T> {
  public readonly maxFrames: number;
  public readonly mode: ReplayBufferMode;
  public readonly maxKeyframesRatio: number;

  private _storedFrames: number = 0;
  private _totalIngested: number = 0;
  private _evictedFrames: number = 0;
  private _currentStride: number = 1;
  private _keyframeCount: number = 0;

  // Ring mode circular storage
  private readonly ringSlots: (ReplayFrameEntry<T> | null)[];
  private headIndex: number = 0;

  // Adaptive mode dense storage
  private denseFrames: ReplayFrameEntry<T>[] = [];

  constructor(config: BoundedReplayBufferConfig) {
    if (!Number.isInteger(config.maxFrames) || config.maxFrames < 4) {
      throw new Error(`maxFrames must be an integer >= 4, got ${config.maxFrames}`);
    }
    if (config.mode !== 'ring' && config.mode !== 'adaptive-decimate') {
      throw new Error(`Invalid replay buffer mode: ${config.mode}`);
    }

    const keyRatio = config.maxKeyframesRatio ?? 0.25;
    if (!Number.isFinite(keyRatio) || keyRatio <= 0.0 || keyRatio > 1.0) {
      throw new Error(`maxKeyframesRatio must be in (0, 1], got ${keyRatio}`);
    }

    this.maxFrames = config.maxFrames;
    this.mode = config.mode;
    this.maxKeyframesRatio = keyRatio;

    if (this.mode === 'ring') {
      this.ringSlots = new Array(this.maxFrames).fill(null);
    } else {
      this.ringSlots = [];
    }
  }

  public get storedFrames(): number {
    return this._storedFrames;
  }

  public get totalIngested(): number {
    return this._totalIngested;
  }

  public get evictedFrames(): number {
    return this._evictedFrames;
  }

  public get currentStride(): number {
    return this._currentStride;
  }

  public get keyframeCount(): number {
    return this._keyframeCount;
  }

  /**
   * Pushes a new frame into the buffer at the specified simulation time.
   *
   * @param simTimeSec Monotonically non-decreasing simulation timestamp (seconds).
   * @param payload Frame payload data.
   * @param isKeyframe If true, marks as essential event (e.g. link outage, jammer activation).
   * @returns boolean true if the frame was stored, false if decimated/skipped.
   */
  public push(simTimeSec: number, payload: T, isKeyframe = false): boolean {
    if (!Number.isFinite(simTimeSec)) {
      throw new Error(`simTimeSec must be a finite number, got ${simTimeSec}`);
    }

    const frameId = this._totalIngested;
    const entry: ReplayFrameEntry<T> = {
      simTimeSec,
      payload,
      isKeyframe,
      frameId,
    };

    if (this.mode === 'ring') {
      return this.pushRing(entry);
    } else {
      return this.pushAdaptive(entry);
    }
  }

  // ---------------------------------------------------------------------------
  // Ring Buffer Push (Strict O(1) Circular Overwrite)
  // ---------------------------------------------------------------------------

  private pushRing(entry: ReplayFrameEntry<T>): boolean {
    if (this._storedFrames < this.maxFrames) {
      const writePos = (this.headIndex + this._storedFrames) % this.maxFrames;
      this.ringSlots[writePos] = entry;
      this._storedFrames++;
      if (entry.isKeyframe) this._keyframeCount++;
    } else {
      // Overwrite slot at headIndex (the oldest entry)
      const overwritten = this.ringSlots[this.headIndex];
      if (overwritten?.isKeyframe) {
        this._keyframeCount--;
      }
      this.ringSlots[this.headIndex] = entry;
      this.headIndex = (this.headIndex + 1) % this.maxFrames;
      this._evictedFrames++;
      if (entry.isKeyframe) this._keyframeCount++;
    }

    this._totalIngested++;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Adaptive Decimation Push
  // ---------------------------------------------------------------------------

  private pushAdaptive(entry: ReplayFrameEntry<T>): boolean {
    const isFirst = this._totalIngested === 0;

    // Check stride sampling for non-keyframes
    if (!isFirst && !entry.isKeyframe) {
      if (this._totalIngested % this._currentStride !== 0) {
        this._evictedFrames++;
        this._totalIngested++;
        return false;
      }
    }

    // If buffer is full, trigger compaction before inserting
    if (this._storedFrames >= this.maxFrames) {
      this.compactAdaptive();
    }

    this.denseFrames.push(entry);
    this._storedFrames = this.denseFrames.length;
    this._totalIngested++;
    if (entry.isKeyframe) this._keyframeCount++;

    return true;
  }

  /**
   * In-place adaptive compaction when buffer reaches capacity:
   * 1. Retain frame 0 (t0 anchor).
   * 2. Retain keyframes up to maxKeyframes limit (oldest thinned if flooded).
   * 3. Retain every 2nd regular frame (decimate regular frames by 2).
   * 4. Double currentStride (1 -> 2 -> 4 -> 8 -> ...).
   */
  private compactAdaptive(): void {
    if (this.denseFrames.length === 0) return;

    const t0 = this.denseFrames[0];
    const rest = this.denseFrames.slice(1);

    const keyframes = rest.filter((f) => f.isKeyframe);
    const regular = rest.filter((f) => !f.isKeyframe);

    // Bounded keyframe ceiling to prevent OOM under adversarial 100% keyframe flood
    const maxKeys = Math.max(1, Math.floor(this.maxKeyframesRatio * this.maxFrames));
    let retainedKeys = keyframes;
    if (keyframes.length > maxKeys) {
      const dropCount = keyframes.length - maxKeys;
      this._evictedFrames += dropCount;
      // Retain the newest keyframes
      retainedKeys = keyframes.slice(dropCount);
    }

    // Decimate regular frames by factor of 2 (retain every 2nd regular frame)
    const retainedRegular: ReplayFrameEntry<T>[] = [];
    for (let i = 0; i < regular.length; i++) {
      if (i % 2 === 1) {
        retainedRegular.push(regular[i]);
      } else {
        this._evictedFrames++;
      }
    }

    // Double stride for future incoming regular frames
    this._currentStride *= 2;

    // Combine and maintain chronological time order
    const combined = [t0, ...retainedKeys, ...retainedRegular];
    combined.sort((a, b) => a.simTimeSec - b.simTimeSec || a.frameId - b.frameId);

    this.denseFrames = combined;
    this._storedFrames = this.denseFrames.length;
    this._keyframeCount = this.denseFrames.filter((f) => f.isKeyframe).length;
  }

  // ---------------------------------------------------------------------------
  // Logical Index Accessor & Range
  // ---------------------------------------------------------------------------

  public getEntry(logicalIndex: number): ReplayFrameEntry<T> | null {
    if (logicalIndex < 0 || logicalIndex >= this._storedFrames) {
      return null;
    }
    if (this.mode === 'ring') {
      const idx = (this.headIndex + logicalIndex) % this.maxFrames;
      return this.ringSlots[idx];
    } else {
      return this.denseFrames[logicalIndex];
    }
  }

  /**
   * Binary search for nearest frame by simulation time. Strict O(log N).
   * Returns exact match or closest bracketed entry. Clamps to boundaries.
   */
  public findNearestByTime(targetTimeSec: number): ReplayFrameEntry<T> | null {
    if (this._storedFrames === 0 || !Number.isFinite(targetTimeSec)) {
      return null;
    }

    const first = this.getEntry(0)!;
    if (targetTimeSec <= first.simTimeSec) {
      return first;
    }

    const last = this.getEntry(this._storedFrames - 1)!;
    if (targetTimeSec >= last.simTimeSec) {
      return last;
    }

    let low = 0;
    let high = this._storedFrames - 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const midEntry = this.getEntry(mid)!;

      if (midEntry.simTimeSec === targetTimeSec) {
        return midEntry;
      } else if (midEntry.simTimeSec < targetTimeSec) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // After binary search, high and low bracket targetTimeSec:
    // high < low, and targetTimeSec is between high and low
    const leftEntry = this.getEntry(Math.max(0, high))!;
    const rightEntry = this.getEntry(Math.min(this._storedFrames - 1, low))!;

    const leftDist = Math.abs(leftEntry.simTimeSec - targetTimeSec);
    const rightDist = Math.abs(rightEntry.simTimeSec - targetTimeSec);

    return leftDist <= rightDist ? leftEntry : rightEntry;
  }

  /**
   * Retrieves all frames falling within [startTimeSec, endTimeSec].
   */
  public getRange(startTimeSec: number, endTimeSec: number): ReplayFrameEntry<T>[] {
    if (this._storedFrames === 0 || startTimeSec > endTimeSec) {
      return [];
    }

    const result: ReplayFrameEntry<T>[] = [];
    for (let i = 0; i < this._storedFrames; i++) {
      const entry = this.getEntry(i)!;
      if (entry.simTimeSec >= startTimeSec && entry.simTimeSec <= endTimeSec) {
        result.push(entry);
      } else if (entry.simTimeSec > endTimeSec) {
        break; // Chronologically ordered
      }
    }
    return result;
  }

  /**
   * Returns all stored frames as a fresh, chronologically ordered array.
   */
  public toOrderedArray(): ReplayFrameEntry<T>[] {
    const arr: ReplayFrameEntry<T>[] = new Array(this._storedFrames);
    for (let i = 0; i < this._storedFrames; i++) {
      arr[i] = this.getEntry(i)!;
    }
    return arr;
  }

  /**
   * Clears all buffer state and resets stride to 1.
   */
  public clear(): void {
    if (this.mode === 'ring') {
      this.ringSlots.fill(null);
      this.headIndex = 0;
    } else {
      this.denseFrames = [];
    }
    this._storedFrames = 0;
    this._totalIngested = 0;
    this._evictedFrames = 0;
    this._currentStride = 1;
    this._keyframeCount = 0;
  }

  /**
   * Returns snapshot statistics of buffer utilization and eviction.
   */
  public getStats(): ReplayBufferStats {
    return {
      storedFrames: this._storedFrames,
      maxFrames: this.maxFrames,
      totalIngested: this._totalIngested,
      evictedFrames: this._evictedFrames,
      currentStride: this._currentStride,
      keyframeCount: this._keyframeCount,
      utilizationRatio: this.maxFrames > 0 ? this._storedFrames / this.maxFrames : 0.0,
    };
  }
}
