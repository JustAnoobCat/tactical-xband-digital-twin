/**
 * src/core/ipcTransferCodec.ts
 *
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Zero-Copy TypedArray IPC Transfer Codec & Transferable Collector
 *
 * Provides deterministic binary packing/unpacking utilities for dense numeric
 * arrays (terrain profiles, viewshed/coverage rasters, VSA I/Q symbol streams)
 * and safe, cycle-protected transferable collection preventing DataCloneError
 * and worker state detachment hazards.
 */

// -----------------------------------------------------------------------------
// Types & Interfaces
// -----------------------------------------------------------------------------

export interface PackedGridFloat32 {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float32Array;
}

export interface UnpackedGridFloat32 {
  readonly rows: number;
  readonly cols: number;
  readonly values: Float32Array;
}

export interface UnpackedTerrainProfile {
  readonly distancesM: Float32Array;
  readonly terrainElevM: Float32Array;
  readonly losHeightM: Float32Array;
  readonly fresnelRadiusM: Float32Array;
  readonly count: number;
}

export interface UnpackedConstellationIQ {
  readonly iSamples: Float32Array;
  readonly qSamples: Float32Array;
  readonly count: number;
}

export interface CloneTransferableOptions {
  readonly sanitizeNonFinite?: boolean;
  readonly fallbackValue?: number;
}

export interface CollectTransferablesOptions {
  readonly maxDepth?: number;
  readonly excludeBuffers?: ReadonlySet<ArrayBuffer>;
}

// -----------------------------------------------------------------------------
// 1. Dedicated Outbound Buffer Allocation (Detachment Safety Guard)
// -----------------------------------------------------------------------------

/**
 * Clones any numeric array or TypedArray into a fresh, dedicated `Float32Array`
 * backed by its own unique `ArrayBuffer`.
 *
 * CRITICAL DETACHMENT SAFETY:
 * Calling this guarantees that passing the returned Float32Array's buffer in a
 * worker `postMessage(..., [buffer])` transfer list will NEVER detach
 * worker-retained simulation state.
 */
export function cloneToTransferableFloat32(
  source: ArrayLike<number>,
  options?: CloneTransferableOptions
): Float32Array {
  const len = source.length;
  const out = new Float32Array(len);
  const sanitize = options?.sanitizeNonFinite === true;
  const fallback = options?.fallbackValue ?? 0.0;

  for (let i = 0; i < len; i++) {
    const val = source[i];
    if (sanitize && !Number.isFinite(val)) {
      out[i] = fallback;
    } else {
      out[i] = val;
    }
  }

  return out;
}

// -----------------------------------------------------------------------------
// 2. 2D Grid Packing & Unpacking (Viewshed & Coverage Rasters)
// -----------------------------------------------------------------------------

/**
 * Packs 2D spatial grid values into a single contiguous Float32Array raster.
 * Total byte size: rows * cols * 4 bytes.
 */
export function packFloat32Grid(
  values: ArrayLike<number>,
  rows: number,
  cols: number,
  options?: CloneTransferableOptions
): PackedGridFloat32 {
  if (!Number.isInteger(rows) || rows < 0 || !Number.isInteger(cols) || cols < 0) {
    throw new Error(`Grid dimensions must be non-negative integers: rows=${rows}, cols=${cols}`);
  }
  const expectedLen = rows * cols;
  if (values.length !== expectedLen) {
    throw new Error(
      `Grid values length (${values.length}) does not match rows * cols (${expectedLen})`
    );
  }

  const data = cloneToTransferableFloat32(values, options);
  return { rows, cols, data };
}

/**
 * Unpacks a 2D grid from either a PackedGridFloat32 record or a raw Float32Array.
 */
export function unpackFloat32Grid(
  packed: PackedGridFloat32 | Float32Array,
  fallbackRows?: number,
  fallbackCols?: number
): UnpackedGridFloat32 {
  if (packed instanceof Float32Array) {
    const total = packed.length;
    let rows = fallbackRows;
    let cols = fallbackCols;

    if (rows === undefined || cols === undefined) {
      const side = Math.round(Math.sqrt(total));
      if (side * side === total) {
        rows = side;
        cols = side;
      } else {
        rows = 1;
        cols = total;
      }
    }

    if (rows * cols !== total) {
      throw new Error(`Dimension mismatch: ${rows} * ${cols} !== ${total}`);
    }

    return { rows, cols, values: packed };
  }

  return {
    rows: packed.rows,
    cols: packed.cols,
    values: packed.data,
  };
}

// -----------------------------------------------------------------------------
// 3. Interleaved Terrain Profile Packing (Stride = 4)
// -----------------------------------------------------------------------------

/**
 * Packs 4 parallel profile arrays into a single interleaved Float32Array buffer:
 * [d0, elev0, los0, fresnel0, d1, elev1, los1, fresnel1, ...]
 *
 * Interleaving allows sending all 4 vectors over thread IPC using exactly ONE
 * ArrayBuffer transfer handle, avoiding 4 separate allocations.
 */
export function packTerrainProfileTyped(
  distancesM: ArrayLike<number>,
  terrainElevM: ArrayLike<number>,
  losHeightM: ArrayLike<number>,
  fresnelRadiusM: ArrayLike<number>
): Float32Array {
  const count = distancesM.length;
  if (
    terrainElevM.length !== count ||
    losHeightM.length !== count ||
    fresnelRadiusM.length !== count
  ) {
    throw new Error(
      `Terrain profile parallel arrays must have identical length: ` +
        `distances=${count}, terrainElev=${terrainElevM.length}, losHeight=${losHeightM.length}, fresnelRadius=${fresnelRadiusM.length}`
    );
  }

  const packed = new Float32Array(count * 4);
  let offset = 0;
  for (let i = 0; i < count; i++) {
    packed[offset] = distancesM[i];
    packed[offset + 1] = terrainElevM[i];
    packed[offset + 2] = losHeightM[i];
    packed[offset + 3] = fresnelRadiusM[i];
    offset += 4;
  }

  return packed;
}

/**
 * Unpacks an interleaved Float32Array profile back into 4 parallel Float32Arrays.
 */
export function unpackTerrainProfileTyped(packed: Float32Array): UnpackedTerrainProfile {
  if (packed.length % 4 !== 0) {
    throw new Error(`Interleaved terrain profile length (${packed.length}) must be a multiple of 4`);
  }

  const count = packed.length / 4;
  const distancesM = new Float32Array(count);
  const terrainElevM = new Float32Array(count);
  const losHeightM = new Float32Array(count);
  const fresnelRadiusM = new Float32Array(count);

  let offset = 0;
  for (let i = 0; i < count; i++) {
    distancesM[i] = packed[offset];
    terrainElevM[i] = packed[offset + 1];
    losHeightM[i] = packed[offset + 2];
    fresnelRadiusM[i] = packed[offset + 3];
    offset += 4;
  }

  return { distancesM, terrainElevM, losHeightM, fresnelRadiusM, count };
}

// -----------------------------------------------------------------------------
// 4. Interleaved VSA I/Q Constellation Packing (Stride = 2)
// -----------------------------------------------------------------------------

/**
 * Packs parallel I and Q baseband samples into a single interleaved Float32Array:
 * [I0, Q0, I1, Q1, ...]
 */
export function packConstellationIQ(
  iSamples: ArrayLike<number>,
  qSamples: ArrayLike<number>
): Float32Array {
  const count = iSamples.length;
  if (qSamples.length !== count) {
    throw new Error(
      `I and Q sample arrays must have identical length: iSamples=${count}, qSamples=${qSamples.length}`
    );
  }

  const packed = new Float32Array(count * 2);
  let offset = 0;
  for (let k = 0; k < count; k++) {
    packed[offset] = iSamples[k];
    packed[offset + 1] = qSamples[k];
    offset += 2;
  }

  return packed;
}

/**
 * Unpacks an interleaved Float32Array of I/Q pairs back into separate I and Q Float32Arrays.
 */
export function unpackConstellationIQ(packed: Float32Array): UnpackedConstellationIQ {
  if (packed.length % 2 !== 0) {
    throw new Error(`Interleaved I/Q buffer length (${packed.length}) must be a multiple of 2`);
  }

  const count = packed.length / 2;
  const iSamples = new Float32Array(count);
  const qSamples = new Float32Array(count);

  let offset = 0;
  for (let k = 0; k < count; k++) {
    iSamples[k] = packed[offset];
    qSamples[k] = packed[offset + 1];
    offset += 2;
  }

  return { iSamples, qSamples, count };
}

// -----------------------------------------------------------------------------
// 5. Safe Transferable Collector (Deduplicating & Detachment-Safe)
// -----------------------------------------------------------------------------

function isSharedArrayBuffer(buffer: unknown): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer;
}

/**
 * Recursively traverses an arbitrary payload object graph and collects all unique,
 * valid, non-detached `ArrayBuffer` instances suitable for passing in a worker
 * `postMessage(message, transferList)` call.
 *
 * Key Invariants:
 * 1. Deduplication: Maintains a `Set<ArrayBuffer>` so multiple TypedArray subviews
 *    sharing a single buffer yield exactly 1 transferable, preventing `DataCloneError: Duplicate ArrayBuffer`.
 * 2. Detachment Safety: Excludes any buffer present in `options.excludeBuffers`
 *    (e.g., worker-owned DEM heightfields or long-lived caches).
 * 3. Detached & Shared Buffer Skipping: Automatically skips buffers with `byteLength === 0`
 *    and skips `SharedArrayBuffer` (which must not be transferred).
 * 4. Cycle Protection: Tracks visited objects via `WeakSet<object>` to prevent infinite loops.
 * 5. Depth Bounded: Traversal terminates at `maxDepth` (default: 8).
 */
export function collectTransferables(
  payload: unknown,
  options?: CollectTransferablesOptions
): ArrayBuffer[] {
  const maxDepth = options?.maxDepth ?? 8;
  const excludeBuffers = options?.excludeBuffers;
  const seenObjects = new WeakSet<object>();
  const collected = new Set<ArrayBuffer>();

  function considerBuffer(buf: ArrayBufferLike): void {
    if (isSharedArrayBuffer(buf)) return; // Cannot transfer SharedArrayBuffer
    if (!(buf instanceof ArrayBuffer)) return;
    if (buf.byteLength === 0) return; // Already detached
    if (excludeBuffers && excludeBuffers.has(buf)) return; // Worker-retained
    collected.add(buf);
  }

  function traverse(item: unknown, depth: number): void {
    if (item === null || item === undefined || depth > maxDepth) {
      return;
    }

    if (item instanceof ArrayBuffer) {
      considerBuffer(item);
      return;
    }

    if (ArrayBuffer.isView(item)) {
      considerBuffer(item.buffer);
      return;
    }

    if (typeof item !== 'object') {
      return;
    }

    if (seenObjects.has(item)) {
      return;
    }
    seenObjects.add(item);

    if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i++) {
        traverse(item[i], depth + 1);
      }
      return;
    }

    if (item instanceof Map) {
      for (const val of item.values()) {
        traverse(val, depth + 1);
      }
      return;
    }

    if (item instanceof Set) {
      for (const val of item.values()) {
        traverse(val, depth + 1);
      }
      return;
    }

    // Standard object traversal
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      try {
        traverse(record[key], depth + 1);
      } catch {
        // Ignore non-readable getters
      }
    }
  }

  traverse(payload, 0);
  return Array.from(collected);
}
