# SPEC-WP08: Web Worker Zero-Copy Transferables & Bounded Adaptive Replay Buffer Engine

**Specification Document:** `docs/specs/wp08-worker-transferables-and-bounded-replay.md`  
**Status:** Approved  
**Execution Lead:** Role 2 Coder / Implementer  
**Classification:** Web Worker IPC Optimization / Zero-Copy TypedArray Transferables / Bounded FIFO Ring & Adaptive Replay Decimation / 50 Hz Discrete-Event Loop Invariants  
**Applies to Modules:** `src/core/ipcTransferCodec.ts`, `src/core/boundedReplayBuffer.ts`, `src/worker/simWorker.ts`, `src/tests/verifyWorkerTransferAndReplayBounds.ts`

---

## 1. Executive Summary & Problem Formulation

### 1.1 Context & Motivation
The Tactical X-Band Air-to-Ground Network Digital Twin simulates an airborne communications node (ACN) and ground tactical mesh in the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$). The authoritative simulation engine runs in a background Web Worker (`src/worker/simWorker.ts`) advancing a discrete-event loop at 50 Hz ($\Delta t = 20\text{ ms}$).

On every tick or upon request, dense numeric telemetry arrays must cross the thread boundary between the Web Worker and the main UI thread:
1. **Viewshed SINR & Coverage Grids:** Polar SINR arrays ($576$ to $16,384+$ floating-point cells).
2. **Fresnel & Path Profiles:** Parallel vectors of horizontal distance, terrain elevation, line-of-sight elevation, and Fresnel radii ($64$ to $512+$ samples per profile).
3. **Vector Signal Analyzer (VSA) Constellation I/Q Streams:** Thousands of in-phase ($I$) and quadrature ($Q$) baseband symbols for high-order DVB-S2X modulations (up to 64-APSK / 64-QAM).

Under traditional structural cloning (`postMessage(message)` without transfer lists), the browser engine performs a recursive deep copy and serialization of every numeric array. For large grids (e.g. $128 \times 128 = 16,384$ floats), JSON stringification consumes $\sim 200\text{ KB}$ and serialization adds several milliseconds of latency, threatening the strict $20\text{ ms}$ ($50\text{ Hz}$) worker time budget.

Furthermore, long simulation runs (e.g., thousands of seconds) ingest tens of thousands of telemetry and timeline frames. Without deterministic bounds, unbounded memory growth ($O(N)$ heap accumulation) inevitably induces garbage collection spikes or browser tab Out-Of-Memory (OOM) crashes.

WP-08 establishes:
1. A zero-copy **`ipcTransferCodec`** packing dense multidimensional arrays into single contiguous `Float32Array` buffers with safe `ArrayBuffer` transfer lists.
2. A critical **Detachment Safety & Deduplication Engine** that prevents `DataCloneError: Duplicate ArrayBuffer` and ensures worker-retained state (such as DEM heightfields and polar viewshed caches) is never detached across simulation ticks.
3. A deterministic **`BoundedReplayBuffer<T>`** supporting strict $O(1)$ circular ring buffering and adaptive stride decimation with keyframe retention guarantees and absolute memory ceiling invariants.

---

## 2. Mathematical Formulations & Binary Packing Layouts

### 2.1 Single-Buffer Interleaved Terrain Profile Layout
A terrain profile consists of 4 parallel float sequences of sample count $N$:
- $d_i$: Horizontal ground distance from transmitter (m)
- $h_{\text{terrain}, i}$: Effective terrain elevation including Earth curvature (m MSL)
- $h_{\text{los}, i}$: 3D line-of-sight ray elevation (m MSL)
- $r_{\text{fresnel}, i}$: 1st Fresnel zone radius (m)

Instead of transferring 4 separate `Float32Array` buffers (requiring 4 distinct allocations and 4 transfer handles), `packTerrainProfileTyped` interleaves all 4 quantities into a single contiguous `Float32Array` with stride $S = 4$:
$$\text{packed}[4i + 0] = d_i, \quad \text{packed}[4i + 1] = h_{\text{terrain}, i}, \quad \text{packed}[4i + 2] = h_{\text{los}, i}, \quad \text{packed}[4i + 3] = r_{\text{fresnel}, i}$$
Total buffer size: $4 \times 4N = 16N\text{ bytes}$.  
Transfer handles required: exactly $1\text{ ArrayBuffer}$.

### 2.2 Contiguous 2D Grid Representation for Viewshed & Coverage
For an $R \times C$ 2D spatial grid (e.g. $128 \times 128 = 16,384$ cells):
- Row-major contiguous packing: $\text{index}(r, c) = r \cdot C + c$.
- Total elements: $N = R \cdot C$. Total byte size: $4 \times 16,384 = 65,536\text{ bytes}$ ($64\text{ KB}$).
- Comparison with JSON: A JSON string representation of $16,384$ floating-point numbers consumes $\approx 220\text{ KB}$ (a $> 3.3\times$ payload reduction).
- Single `ArrayBuffer` transfer eliminates thread-copy overhead entirely ($0\text{ µs}$ memcpy via pointer exchange).

### 2.3 Single-Buffer Interleaved VSA I/Q Constellation Layout
For $N$ received baseband constellation symbols $(I_k, Q_k)$:
- Interleaved layout with stride $S = 2$:
  $$\text{packed}[2k + 0] = I_k, \quad \text{packed}[2k + 1] = Q_k$$
- Total buffer size: $2 \times 4N = 8N\text{ bytes}$.
- Restores in-phase and quadrature components with $< 10^{-4}$ Float32 numerical precision.

---

## 3. Web Worker Detachment Safety & Deduplication Invariants

### 3.1 The ArrayBuffer Detachment Hazard
Under the HTML Living Standard for Structured Cloning, when an `ArrayBuffer` is passed in the `transfer` list:
$$\operatorname{postMessage}(\text{message}, [\text{buffer}])$$
The sending execution context **immediately detaches** the underlying memory. Its `byteLength` becomes $0$ and any subsequent read or write in the sender throws or returns zeroes.

> **CRITICAL ARCHITECTURAL INVARIANT (§1 of AGENTS.md):**  
> Mutable simulation state retained in `src/worker/simWorker.ts` across ticks (such as `TerrainEngine` DEM heightfields, `PolarViewshedEngine.sinrGridDb`, or lookup tables) must **NEVER** be detached!

To guarantee absolute detachment safety:
1. **Fresh Allocation via `cloneToTransferableFloat32`:** Outbound arrays destined for zero-copy transfer must be cloned or packed into freshly allocated, single-owner `ArrayBuffer` instances.
2. **`excludeBuffers` Guard:** The transferable collector accepts a `ReadonlySet<ArrayBuffer>` of worker-retained buffers. Any buffer in this set is strictly omitted from the transfer list, falling back safely to structured copy rather than detaching worker state.

### 3.2 Duplicate ArrayBuffer Elimination
Passing the same `ArrayBuffer` twice in the `transfer` list of `postMessage` or `structuredClone` triggers a fatal runtime exception:
`DOMException: DataCloneError: Duplicate transferables`

This occurs frequently when multiple TypedArray subviews (e.g., different channel views or slice offsets) point to regions of the same underlying buffer.
`collectTransferables` traverses object graphs, maintains a `Set<ArrayBuffer>` of discovered buffers, and ensures each unique `ArrayBuffer` appears **at most once** in the returned transfer list.

### 3.3 Cyclic Object Traversal Protection
Telemetry payloads may contain complex nested structures. `collectTransferables` enforces:
- Cycle-detection via `WeakSet<object>`.
- Depth-limiting with configurable `maxDepth` (default: 8 levels).
- Rejection of already-detached buffers (`byteLength === 0`) and `SharedArrayBuffer` instances.

---

## 4. Bounded Adaptive Replay Buffer Architecture

### 4.1 FIFO Ring Mode (`'ring'`)
For fixed-window inspection (e.g. the last 500 or 3,000 frames):
- Capacity $M = \text{maxFrames} \ge 4$.
- Array-backed circular indexing: $\text{writeIndex} = (\text{writeIndex} + 1) \bmod M$.
- $O(1)$ push time; zero array reallocation or $O(N)$ `shift()` operations.
- Preserves exactly the most recent $M$ frames in strictly non-decreasing timestamp order.

### 4.2 Adaptive Decimation Mode (`'adaptive-decimate'`)
For unbounded mission durations where overall temporal coverage must be preserved within a fixed memory envelope:
- Configuration: $M = \text{maxFrames}$, $\alpha_{\text{key}} = \text{maxKeyframesRatio}$ (default $0.25$).
- Current stride $S \ge 1$ (starts at $1$).
- **Keyframe Guarantee:** Frames marked `isKeyframe === true` (e.g., link outage state transitions, jammer activations, emergency rerouting) are prioritized.
- **Compaction Trigger:** When buffer count reaches $M$ and a new frame arrives:
  1. Retain initial anchor frame $t_0$ (Frame 0).
  2. Retain all keyframes up to ceiling $K_{\max} = \lfloor \alpha_{\text{key}} \cdot M \rfloor$. If keyframes exceed $K_{\max}$ (adversarial keyframe flood), oldest non-essential keyframes are thinned so memory ceiling $M$ is **never** breached.
  3. From regular (non-keyframe) frames, retain every 2nd frame (decimate by 2).
  4. Stride is doubled: $S \leftarrow 2S$.
  5. The compacted elements are shifted in-place, halving the buffer occupancy and creating headroom for subsequent frames sampled at the new stride $S$.

### 4.3 Logarithmic Scrubbing via Binary Search
Both ring and adaptive buffers support $O(\log N)$ temporal scrubbing via `findNearestByTime(targetTimeSec)`:
- Returns `null` if buffer is empty.
- Clamps to oldest frame if $\text{targetTime} \le t_{\text{oldest}}$ and to newest frame if $\text{targetTime} \ge t_{\text{newest}}$.
- Binary searches between strictly monotonic timestamps to return the closest temporal record in $\le \lceil \log_2 M \rceil$ comparisons ($\le 12$ iterations for $M = 3,000$).

---

## 5. Performance Budget & Verification Targets

| Metric | Target | Verification Method |
|---|---|---|
| IPC Packing Latency | $< 100\text{ µs}$ per 50 Hz tick | Micro-benchmark across 1,000 ticks in Suite 92 |
| Buffer Overhead | $< 0.5\%$ of 20 ms tick budget | Total time for 1,000 ticks $< 100\text{ ms}$ |
| Detachment Safety | 0 worker-retained buffer detaches | Explicit assertion that `sinrGridDb.byteLength > 0` |
| Transfer Deduplication | 0 `DataCloneError` exceptions | Native `structuredClone(..., { transfer })` test |
| Replay Memory Ceiling | `storedFrames <= maxFrames` | Ingestion of 20,000 frames under 100% keyframe flood |
| Float32 Numerical Precision | Max absolute error $< 10^{-4}$ | Unpacked profile, grid, and IQ comparisons |
