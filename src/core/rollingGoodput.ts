/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Rolling Goodput Statistics & Nearest-Rank Percentiles (M7.3)
 *
 * Implements bounded, circular rolling window tracking for superframe payload delivery
 * and computes authoritative P50 and P95 goodput statistics (bps) using the
 * nearest-rank percentile method.
 *
 * Mathematical Specification:
 * - Sampling interval: 1 superframe = 20 ms (T_FRAME_S = 0.02 s)
 * - Window size: 200 completed superframes = 4.0 seconds
 * - Metric: successfully delivered payload bits dequeued during usable link state (bits / superframe)
 * - Conversion: rate (bps) = deliveredBits / 0.02 s = deliveredBits * 50
 * - Nearest-Rank Percentile: For sorted samples x(1) <= x(2) <= ... <= x(n) with 1-based indexing,
 *     P(k) = x(ceil(k * n))
 *   where k in {0.50, 0.95}.
 * - Empty window (n = 0): returns null.
 * - Partially populated window (1 <= n < 200): computes nearest-rank percentile over available n samples.
 */

export const ROLLING_GOODPUT_WINDOW_SIZE = 200;
export const SUPERFRAME_DURATION_S = 0.020; // 20 ms

/**
 * Computes nearest-rank percentile for an already sorted numeric array.
 *
 * Mathematical definition:
 * For sorted samples x(1) <= x(2) <= ... <= x(n) (1-based):
 *   rank = ceil(k * n)
 *   P(k) = x(rank)
 *
 * In 0-based array indexing:
 *   index = ceil(k * n) - 1
 *
 * @param sortedSamples Ascending sorted array of finite numbers
 * @param k Percentile fraction in [0.0, 1.0] (e.g. 0.50 for P50, 0.95 for P95)
 * @returns Percentile value, or null if sortedSamples is empty
 */
export function computeNearestRankPercentile(
  sortedSamples: readonly number[],
  k: number
): number | null {
  const n = sortedSamples.length;
  if (n === 0) return null;

  if (!Number.isFinite(k) || k < 0.0 || k > 1.0) {
    throw new RangeError(`Percentile k must be in [0.0, 1.0], got ${k}`);
  }

  // Clamped 1-based rank: ceil(k * n)
  // For k = 0, rank is 1. For k in (0, 1], rank is ceil(k * n).
  const rank = Math.min(n, Math.max(1, Math.ceil(k * n)));
  return sortedSamples[rank - 1];
}

/**
 * Bounded circular buffer tracking the most recent N superframe goodput samples.
 * Prevents unbounded memory growth while preserving strict FIFO eviction.
 */
export class RollingGoodputTracker {
  public readonly capacity: number;
  private readonly buffer: Float64Array;
  private head: number = 0;
  private count: number = 0;

  constructor(capacity: number = ROLLING_GOODPUT_WINDOW_SIZE) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`Capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.buffer = new Float64Array(capacity);
  }

  /**
   * Ingests actual payload bits delivered in a completed superframe.
   * Converts bits per 20 ms superframe into bits per second (bps).
   *
   * @param deliveredBits Actual payload bits delivered (>= 0).
   */
  public recordSuperframeDeliveredBits(deliveredBits: number): void {
    if (!Number.isFinite(deliveredBits) || deliveredBits < 0) {
      deliveredBits = 0;
    }
    const rateBps = deliveredBits / SUPERFRAME_DURATION_S;
    this.recordSampleBps(rateBps);
  }

  /**
   * Ingests a pre-calculated goodput rate in bits per second (bps).
   */
  public recordSampleBps(rateBps: number): void {
    if (!Number.isFinite(rateBps) || rateBps < 0) {
      rateBps = 0;
    }
    this.buffer[this.head] = rateBps;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Current number of retained samples in the window (0 <= count <= capacity).
   */
  public get sampleCount(): number {
    return this.count;
  }

  /**
   * True if the rolling window has accumulated its full capacity of samples.
   */
  public isWindowFull(): boolean {
    return this.count === this.capacity;
  }

  /**
   * Clears all samples and resets the window to empty state (warm-up).
   */
  public reset(): void {
    this.head = 0;
    this.count = 0;
    this.buffer.fill(0);
  }

  /**
   * Returns a copy of the active samples in chronological insertion order.
   */
  public getChronologicalSamples(): number[] {
    const arr = new Array<number>(this.count);
    if (this.count < this.capacity) {
      for (let i = 0; i < this.count; i++) {
        arr[i] = this.buffer[i];
      }
    } else {
      // head points to the oldest sample
      for (let i = 0; i < this.capacity; i++) {
        arr[i] = this.buffer[(this.head + i) % this.capacity];
      }
    }
    return arr;
  }

  /**
   * Returns a sorted copy of the active samples in ascending order.
   */
  public getSortedSamples(): number[] {
    const arr = new Array<number>(this.count);
    for (let i = 0; i < this.count; i++) {
      arr[i] = this.buffer[i];
    }
    arr.sort((a, b) => a - b);
    return arr;
  }

  /**
   * Computes the nearest-rank percentile across current window samples in bps.
   * Returns null if the window contains 0 samples.
   */
  public getPercentileBps(k: number): number | null {
    if (this.count === 0) return null;
    const sorted = this.getSortedSamples();
    return computeNearestRankPercentile(sorted, k);
  }

  /**
   * Rolling P50 (median) goodput in bits per second (bps).
   */
  public get p50Bps(): number | null {
    return this.getPercentileBps(0.50);
  }

  /**
   * Rolling P95 goodput in bits per second (bps).
   */
  public get p95Bps(): number | null {
    return this.getPercentileBps(0.95);
  }
}

