# Implementation Specification: Tactical X-Band Digital Twin Performance & Efficiency Optimization

**Document ID:** `SPEC-PERFORMANCE-OPTIMIZATION-REV1`  
**Author:** Role 1: Engineering Planner  
**Date:** 2026-11-13  
**Status:** PROPOSED (Awaiting User Sign-Off)  
**Target Repository:** `tactical-xband-digital-twin`  
**Target Branch:** `main`  

---

## 1. Executive Summary & Problem Diagnosis

Empirical performance profiling of the digital twin frontend under active simulation reveals high CPU utilization, memory pressure, and frame drops caused by five compounding architectural bottlenecks:

1. **Worker Ray-Marching Array Allocation Churn (`src/core/terrain.ts:887–895`):**  
   Inside `evaluateTerrainObstruction()`, the ray-marching algorithm instantiates a dynamic array `let steps: number[] = []` and appends up to 1,000 float samples per ray check (`d3D / stepIntervalM`). Across 16 active ground nodes evaluated at 50 Hz, this generates **up to 800,000 array allocations and push operations per second**, placing severe pressure on the V8 Garbage Collector and causing periodic GC pauses.
2. **Redundant Geodetic Trigonometry (`src/worker/telemetrySerializer.ts:230`):**  
   `cartesianToGeodetic(nx, ny)` performs ellipsoidal trigonometry (WGS-84 coordinate transformations) 50 times per second for every ground node, even though tactical ground stations are stationary and never move unless manually dragged or updated via `NODE_UPDATE`.
3. **Un-Gated Canvas2D Rendering Passes (`src/ui/simulationTimelineController.ts:257`, `index.html:11771–11800, 13815–13835`):**  
   - `simTimelineController.ingestTelemetry()` synchronously renders the multi-track timeline canvas (`this.renderer.render()`) 50 times per second inside the Web Worker `onmessage` callback.
   - Simultaneously, `animationLoop()` runs on `requestAnimationFrame` (60–144 Hz) and unconditionally calls `drawRadar()` every frame, even when the simulation is paused and camera pan/zoom is static.
   - `drawRadar()` executes 1,400 lines of canvas pathing and label placement even when MapLibre GL 2D mode is active (`terrainMapMode === 'maplibre'`) and the 2D canvas is hidden (`display: none`).
   - Analytical right-hand workspace canvases (`drawWaterfall()`, `drawFresnel()`) execute without strict active-tab gating.
4. **High-Frequency DOM Thrashing & Reflows (`index.html:5106–5124, 11413–11550`):**  
   - `updateDashboardDOM(frame)` alters 40+ text nodes, classes, and styles 50 times per second, well beyond human perceptual thresholds (~15 Hz), triggering continuous browser layout tree invalidations.
   - `renderRegistration()`, `renderTerminalInventory()`, and `renderNetworkTrafficInventory()` construct full DOM tables with `.innerHTML` at 50 Hz, even when the user is viewing unrelated tabs (`#tab-overview`, `#tab-doc`).
5. **Continuous WebGL Render Loops & Hidden Entity Updates (`src/ui/three/sceneManager.ts:615–635`, `index.html:5384`):**  
   - `ThreeSceneManager` continuously runs 60 FPS WebGL render passes even when the 3D camera is stationary, controls have settled, and the simulation is paused.
   - `threeController.updateTelemetry(frame)` mutates 3D entity matrices at 50 Hz even while the digital twin is operating in 2D mode.
6. **Monolithic 2.3 MB Entry Bundle (`dist/assets/index-*.js`):**  
   Vite builds a single massive 2,304 kB chunk combining application logic with Three.js and MapLibre GL, causing high initial parse, compile, and memory consumption.

---

## 2. Strict Architectural Invariants & Non-Negotiables

To pass independent audit, the implementation must strictly uphold these repo invariants:

1. **50 Hz Worker Loop Authority:** The Web Worker (`src/worker/simWorker.ts`) remains the sole authoritative runtime for live mutable simulation state, advancing on a strict 50 Hz discrete event loop ($\Delta t = 20\text{ ms}$). No discrete physics time-step, event sequence, or TDMA framing may be altered.
2. **Physical & Mathematical Rigor:** Ray-marching across Ladakh terrain ($34.5^\circ\text{N}, 76.5^\circ\text{E}$) must remain physically exact. Do NOT introduce coarse multi-point heuristics (e.g. 3-point or 5-point sampling) that alias knife-edge mountain ridges. Every ray sample along the profile must evaluate at exact `stepIntervalM` (100.0 m) intervals with Earth-curvature bulge compensation.
3. **Persistent Map Architecture:** The radar canvas is housed in `.persistent-map-panel` (left viewport column), completely separate from right-hand detail workspace tabs (`.detail-viewport`). The radar canvas must continue rendering during live simulation regardless of which right-hand tab is selected (`tab-overview`, `tab-scheduler`, `tab-terrain`, `tab-terminal`, `tab-doc`, `tab-network`, `tab-registration`, `tab-authoring`).
4. **Ring Buffer Integrity:** The 3,000-frame (60 s at 50 Hz) ring buffer capacity (`SimulationHistoryBuffer(3000)`, `SchedulerHistoryBuffer(3000)`) must remain completely intact to preserve `verify:history-timeline` (`src/tests/verifyHistoryTimeline60s.ts`) assertions. Frame counts must not be downsampled.
5. **Full Test Non-Regression:** Implementation must cleanly pass all 55 test suites (`npm run verify:all`), structural checks (`verify:project`), and multi-viewport Playwright UX tests (`verify:browser`).

---

## 3. The 5 Optimization Pillars (File-by-File Technical Seams)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           PILLAR OVERVIEW MATRIX                                │
├──────────┬──────────────────────────────────────┬───────────────────────────────┤
│ Pillar 1 │ Worker Physics Zero-Allocation       │ src/core/terrain.ts           │
│          │ Geodetic Coordinate Caching          │ src/worker/telemetrySerializer│
├──────────┼──────────────────────────────────────┼───────────────────────────────┤
│ Pillar 2 │ RAF Timeline Decoupling              │ src/ui/simTimelineController  │
│          │ Radar Canvas Dirty-Check Rendering   │ index.html                    │
│          │ Analytical Canvases Tab Gating       │ index.html                    │
├──────────┼──────────────────────────────────────┼───────────────────────────────┤
│ Pillar 3 │ 10–15 Hz Throttled DOM Text Flushes  │ index.html                    │
│          │ Tab-Aware Lazy DOM Table Generation  │ index.html                    │
├──────────┼──────────────────────────────────────┼───────────────────────────────┤
│ Pillar 4 │ 3D Telemetry Ingestion Gating in 2D  │ index.html                    │
│          │ Demand-Driven Three.js WebGL Passes  │ src/ui/three/sceneManager.ts  │
├──────────┼──────────────────────────────────────┼───────────────────────────────┤
│ Pillar 5 │ Production Vendor Chunk Splitting    │ vite.config.ts                │
└──────────┴──────────────────────────────────────┴───────────────────────────────┘
```

---

### Pillar 1: Worker Physics Zero-Allocation & Caching (Worker Thread)

#### Seam 1.1: Zero-Allocation Scalar Ray-Marching Loop (`src/core/terrain.ts:887–935`)
* **Problem:** `let steps: number[] = []` allocates an array of up to 1,000 numbers on every line-of-sight test. For 16 nodes at 50 Hz, this creates 800,000 allocations/sec.
* **Modification:** Replace the array creation and subsequent `for (let i = 0; i < steps.length; i++)` loop with a zero-allocation scalar loop.
* **Exact Seam Specification:**
  ```ts
  // --- Replace lines 887–934 in src/core/terrain.ts ---
  let minClearanceRatio = Number.POSITIVE_INFINITY;
  let minClearanceM = 0.0;
  let critFresnelRadiusM = 0.0;
  let critD1 = d3D * 0.5;
  let critD2 = d3D * 0.5;

  if (d3D <= stepIntervalM * 2.0) {
    // Single midpoint sample for very short baseline
    const d1 = d3D * 0.5;
    const d2 = d3D - d1;
    const fraction = 0.5;

    const sampleX = nx + fraction * dx;
    const sampleY = ny + fraction * dy;

    const hTerrain = this.getElevation(sampleX, sampleY);
    if (!Number.isFinite(hTerrain)) {
      isCoverageComplete = false;
      coverageNote = 'OUT_OF_COVERAGE: Propagation path traverses unmapped terrain outside DEM coverage';
    } else {
      const earthBulge = TerrainEngine.computeEarthBulge(d1, d2, rEff);
      const hTerrainEff = hTerrain + earthBulge;
      const hLos = nz + fraction * dz;
      const hClear = hLos - hTerrainEff;

      const r1 = Math.sqrt((wavelength * d1 * d2) / d3D);
      minClearanceRatio = hClear / r1;
      minClearanceM = hClear;
      critFresnelRadiusM = r1;
      critD1 = d1;
      critD2 = d2;
    }
  } else {
    // Standard stepped ray-marching without array allocation
    for (let d1 = stepIntervalM; d1 < d3D; d1 += stepIntervalM) {
      const d2 = d3D - d1;
      const fraction = d1 / d3D;

      const sampleX = nx + fraction * dx;
      const sampleY = ny + fraction * dy;

      const hTerrain = this.getElevation(sampleX, sampleY);
      if (!Number.isFinite(hTerrain)) {
        isCoverageComplete = false;
        coverageNote = 'OUT_OF_COVERAGE: Propagation path traverses unmapped terrain outside DEM coverage';
        break;
      }

      const earthBulge = TerrainEngine.computeEarthBulge(d1, d2, rEff);
      const hTerrainEff = hTerrain + earthBulge;

      const hLos = nz + fraction * dz;
      const hClear = hLos - hTerrainEff;

      const r1 = Math.sqrt((wavelength * d1 * d2) / d3D);
      const clearanceRatio = hClear / r1;

      if (clearanceRatio < minClearanceRatio) {
        minClearanceRatio = clearanceRatio;
        minClearanceM = hClear;
        critFresnelRadiusM = r1;
        critD1 = d1;
        critD2 = d2;
      }
    }
  }
  ```
* **Invariance Verification:** Mathematical output (`minClearanceM`, `critFresnelRadiusM`, `diffractionLossDb`, `isLos`) is bit-for-bit identical to the original array-based code, while heap allocations drop to 0.

#### Seam 1.2: Stationary Geodetic Coordinate Caching (`src/worker/telemetrySerializer.ts:215–235`)
* **Problem:** In `buildNodesTelemetry()`, `cartesianToGeodetic(nx, ny)` executes 50 times per second for every ground node, calculating repetitive trigonometric projections.
* **Modification:** Introduce a private cache map inside `TelemetrySerializer`:
  ```ts
  // --- In src/worker/telemetrySerializer.ts ---
  export class TelemetrySerializer {
    private readonly geodeticCache = new Map<number, { x: number; y: number; geo: { lat: number; lon: number } }>();

    public getGeodetic(nodeId: number, x: number, y: number): { lat: number; lon: number } {
      const cached = this.geodeticCache.get(nodeId);
      if (cached && cached.x === x && cached.y === y) {
        return cached.geo;
      }
      const geo = cartesianToGeodetic(x, y);
      this.geodeticCache.set(nodeId, { x, y, geo });
      return geo;
    }
  ```
* **Call Site Update (`telemetrySerializer.ts:230`):**
  Replace `const geo = cartesianToGeodetic(nx, ny);` with:
  ```ts
  const geo = this.getGeodetic(node.nodeId, nx, ny);
  ```
* **Cache Invalidation:** Because `getGeodetic` verifies that `cached.x === x && cached.y === y`, any manual coordinate repositioning, drag-and-drop, or scenario reload instantly and automatically refreshes the geodetic entry without manual cache eviction calls.

---

### Pillar 2: Main-Thread Render Coordination & Dirty Flagging (UI Thread)

#### Seam 2.1: Decouple Timeline Canvas Rendering from Worker IPC (`src/ui/simulationTimelineController.ts`)
* **Problem:** `simTimelineController.ingestTelemetry()` synchronously renders the multi-track canvas (`this.renderer.render()`) on line 257 inside `worker.onmessage` at 50 Hz, triggering un-coalesced painting.
* **Modification:**
  1. Add property `public isDirty: boolean = false;` to `SimulationTimelineController`.
  2. Inside `ingestTelemetry()`, replace synchronous `this.renderer.render()` with `this.isDirty = true;`.
  3. Add method `renderIfDirty(): boolean`:
     ```ts
     public renderIfDirty(): boolean {
       if (this.isDirty) {
         this.isDirty = false;
         this.renderer.render();
         return true;
       }
       return false;
     }
     ```
  4. User interactions (`seekTo`, `stepBackward`, `stepForward`, `returnToLive`, `zoomIn`, `zoomOut`, `fitHorizon`) continue to invoke `this.renderer.render()` immediately and set `this.isDirty = false`.

#### Seam 2.2: Unified Dirty-Flagged Animation Loop (`index.html:13815–13835`)
* **Problem:** `animationLoop` unconditionally invokes `drawRadar()` at 60–144 FPS even when paused and stationary.
* **Modification:** Coordinate painting inside `requestAnimationFrame` using explicit dirty flags:
  1. Define global render flags in `index.html`:
     ```js
     let radarNeedsRender = true;
     let schedulerNeedsRender = true;
     let terrainNeedsRender = true;
     function markRadarDirty() { radarNeedsRender = true; }
     ```
  2. In `worker.onmessage`:
     - When `msg.type === 'TELEMETRY_FRAME'`, set `radarNeedsRender = true; schedulerNeedsRender = true; terrainNeedsRender = true;`.
     - When `msg.type === 'PROFILE_FRAME'`, set `terrainNeedsRender = true;`.
  3. On user interaction (mouse pan, zoom, drag node, drag obstacle, select node, toggle layer, resize canvas):
     - Invoke `markRadarDirty()`.
  4. In `animationLoop(now)`:
     ```js
     function animationLoop(now) {
       try {
         if (simTimelineController) {
           const dtS = Math.min((now - lastTimelineAnimTimeMs) / 1000, 0.1);
           simTimelineController.advanceHistoricalPlayback(dtS);
           simTimelineController.renderIfDirty();
         }
         lastTimelineAnimTimeMs = now;

         // 1. Radar canvas is in .persistent-map-panel (left column) - renders when dirty
         if (radarNeedsRender || isPlayingHistory) {
           drawRadar();
           radarNeedsRender = false;
         }

         // 2. Analytical workspace canvases in right-hand column - gated by active tab
         const activeTab = document.querySelector('.tab-content.active');
         if (activeTab) {
           if (activeTab.id === 'tab-scheduler' && (schedulerNeedsRender || isPlayingHistory || !isPaused)) {
             drawWaterfall();
             schedulerNeedsRender = false;
           } else if (activeTab.id === 'tab-terrain' && (terrainNeedsRender || isPlayingHistory || !isPaused)) {
             drawFresnel();
             terrainNeedsRender = false;
           }
         }
       } catch (err) {
         console.error('Animation loop exception:', err);
       }
       requestAnimationFrame(animationLoop);
     }
     ```

#### Seam 2.3: Instant MapLibre & 3D Bypass in `drawRadar()` (`index.html:11771–11800`)
* **Problem:** `drawRadar()` executes 1,400 lines of canvas pathing even when MapLibre GL 2D mode is active and the canvas is hidden under `display: none`.
* **Modification:** Add an instant guard at line 11774 of `index.html`:
  ```js
  function drawRadar() {
    try {
      const cvs = radarCanvas;
      if (!cvs || stageViewMode === '3d' || terrainMapMode === 'maplibre') return;
      // ... rest of drawRadar ...
  ```

---

### Pillar 3: DOM Thrashing & Reflow Mitigation

#### Seam 3.1: 10–15 Hz Throttled DOM Text Updates (`index.html:11413–11550`)
* **Problem:** `updateDashboardDOM(frame)` alters 40+ DOM nodes 50 times per second ($20\text{ ms}$ interval), triggering heavy style and layout recalculation.
* **Modification:** Throttle live dashboard numerical text flushes to $\sim 12.5\text{ Hz}$ (interval $80\text{ ms}$), while retaining immediate synchronous flushes on user interactions or discrete state changes.
* **Exact Seam Specification:**
  ```js
  let lastDomUpdateMs = 0;
  const DOM_UPDATE_INTERVAL_MS = 80; // ~12.5 Hz cadence

  function updateDashboardDOM(frame, force = false) {
    if (!frame) return;
    const nowMs = performance.now();
    if (!force && (nowMs - lastDomUpdateMs < DOM_UPDATE_INTERVAL_MS)) {
      return;
    }
    lastDomUpdateMs = nowMs;
    // ... existing DOM textContent and KPI updates ...
  ```
* **Synchronous `force = true` Call Sites:**
  Pass `force = true` on:
  1. Simulation pause (`isPaused = true`) or unpause.
  2. Simulation reset (`resetSimulationState`).
  3. Single-step simulation (`STEP`).
  4. Manual node or ACN selection (`handleNodeSelection`, `handleAcnSelection`).
  5. Switching tabs (`switchMainTab`).
  6. Historical scrubbing or timeline seek.

#### Seam 3.2: Tab-Aware Lazy DOM Table Generation (`index.html:5355–5365, 11440–11455`)
* **Problem:** `renderRegistration()`, `renderTerminalInventory()`, and `renderNetworkTrafficInventory()` construct entire tables and iterate over all nodes at 50 Hz even when their container tabs are inactive.
* **Modification:**
  1. In `worker.onmessage` (line 5360):
     ```js
     // Gate registration table generation
     const activeTabId = document.querySelector('.tab-content.active')?.id;
     if (activeTabId === 'tab-registration') {
       renderRegistration(msg.frame);
     }
     ```
  2. In `updateDashboardDOM(frame)` (lines 11443, 11453):
     ```js
     const activeTabId = document.querySelector('.tab-content.active')?.id;
     if (activeTabId === 'tab-terminal') {
       const search = $('terminal-search');
       const q = search ? search.value : '';
       if (search) window.filterTerminalOptions(q);
       renderTerminalInventory(frame.nodes_telemetry, selectedNodeId, q);
       syncSelectedNodeAglUI();
     }
     if (activeTabId === 'tab-network' && !isTimelineHist) {
       renderNetworkTrafficInventory(frame);
     }
     ```
  3. In `window.switchMainTab(targetTabId)` (line 10725):
     Trigger an immediate catch-up render of the selected tab:
     ```js
     if (latestTelemetry) {
       updateDashboardDOM(latestTelemetry, true);
       if (targetTabId === 'tab-terminal' && latestTelemetry.nodes_telemetry) {
         const search = $('terminal-search');
         renderTerminalInventory(latestTelemetry.nodes_telemetry, selectedNodeId, search ? search.value : '');
       } else if (targetTabId === 'tab-network') {
         renderNetworkTrafficInventory(latestTelemetry);
       } else if (targetTabId === 'tab-registration') {
         renderRegistration(latestTelemetry);
       }
     }
     ```

---

### Pillar 4: WebGL / Three.js Pipeline Optimization

#### Seam 4.1: Gate Hidden 3D Telemetry Ingestion (`index.html:5384`)
* **Problem:** When in 2D mode, `threeController.updateTelemetry(msg.frame)` continues computing 3D matrix transformations, line points, and packet meshes at 50 Hz.
* **Modification:** Gate the call on line 5384 of `index.html`:
  ```js
  // Only ingest 3D telemetry if 3D mode is currently active
  if (threeController && stageViewMode === '3d' && !(simTimelineController?.isHistoricalInspecting)) {
    threeController.updateTelemetry(msg.frame);
  }
  ```
  *(Note: When switching from 2D to 3D via `stageViewMode === '3d'`, line 5902 already executes `threeController.updateTelemetry(latestTelemetry)`, ensuring full synchronization upon mode entry.)*

#### Seam 4.2: Demand-Driven Three.js WebGL Rendering (`src/ui/three/sceneManager.ts:615–635`)
* **Problem:** `ThreeSceneManager` continuously runs 60 FPS WebGL render passes even when the 3D camera is stationary, controls have settled, and the simulation is paused.
* **Modification:**
  1. Add private property `private isSceneDirty: boolean = true;` to `ThreeSceneManager`.
  2. Flag dirty when state changes:
     - In `updateTelemetry(frame)`: `this.isSceneDirty = true;`.
     - In `loadTerrainMeshData()`, `setTerrainResolution()`, `setHillshadeCanvas()`: `this.isSceneDirty = true;`.
     - In camera controls listeners:
       ```ts
       if (this.controls) {
         this.controls.addEventListener('change', () => { this.isSceneDirty = true; });
       }
       ```
  3. In `startAnimationLoop()` tick callback:
     ```ts
     const controlsMoved = Boolean(this.controls && this.controls.enabled && this.controls.update());
     if (controlsMoved) {
       this.isSceneDirty = true;
     }

     if (this.isSceneDirty) {
       this.render();
       this.isSceneDirty = false;
     }
     ```
  4. Ensure `this.isRunning` remains `true` while in 3D mode so `getMetrics().isRunning` assertions in `src/tests/verifyThreeFoundation.ts` pass without regression.

---

### Pillar 5: Production Bundle Code-Splitting (`vite.config.ts`)

#### Seam 5.1: Rollup Manual Vendor Chunking (`vite.config.ts:26–30`)
* **Problem:** The monolithic entry bundle `dist/assets/index-*.js` is 2,304 kB, triggering Vite chunk size warnings and heavy initial script evaluation.
* **Modification:** Configure `rollupOptions.output.manualChunks` in `vite.config.ts`:
  ```ts
  // --- In vite.config.ts ---
  export default defineConfig({
    // ... base, server, preview, worker ...
    build: {
      target: "esnext",
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-three': ['three'],
            'vendor-maplibre': ['maplibre-gl'],
          },
        },
      },
    },
  });
  ```
* **Expected Result:**
  - `vendor-three.js`: $\sim 680\text{ kB}$ (cached)
  - `vendor-maplibre.js`: $\sim 520\text{ kB}$ (cached)
  - `index.js`: Reduced from $2,304\text{ kB}$ to $\sim 950\text{ kB}$ ($\sim 58\%$ reduction in main bundle size).

---

## 4. Implementation Seam Matrix & Affected Files

| Seam ID | Target File | Line Range | Optimization Summary | Impact & Risk Mitigation |
| :--- | :--- | :--- | :--- | :--- |
| **S1.1** | `src/core/terrain.ts` | L887–935 | Replace `steps: number[]` with scalar loop `d1 < d3D`. | Eliminates 800k allocs/sec; exact physical millimeter clearance preserved. |
| **S1.2** | `src/worker/telemetrySerializer.ts` | L215–235 | Cache `cartesianToGeodetic` per node id and `(x, y)` coordinate. | Eliminates 800 trig calls/sec; automatic refresh on node drag or update. |
| **S2.1** | `src/ui/simulationTimelineController.ts` | L240–265 | Decouple `this.renderer.render()` from `ingestTelemetry()`. | Eliminates 50 Hz synchronous canvas draws; paints exclusively in RAF when dirty. |
| **S2.2** | `index.html` | L13815–13835 | Dirty-check `radarNeedsRender`, `timelineNeedsRender` in RAF. | 0% idle CPU when paused; persistent radar continues updating on live sim. |
| **S2.3** | `index.html` | L11771–11775 | Instant return if `stageViewMode === '3d' \|\| terrainMapMode === 'maplibre'`. | Skips 1,400 lines of 2D canvas drawing when radar canvas is hidden. |
| **S2.4** | `index.html` | L13820–13825 | Gate `drawWaterfall()` to `#tab-scheduler`, `drawFresnel()` to `#tab-terrain`. | Eliminates off-tab analytical canvas redrawing. |
| **S3.1** | `index.html` | L11413–11425 | Throttle `updateDashboardDOM` numerical text flushes to 10–15 Hz. | Slashes DOM reflows by 75%; immediate flush on pause, step, reset, selection. |
| **S3.2** | `index.html` | L5360, 11443 | Gate `renderRegistration`, `renderTerminalInventory`, `renderNetworkTrafficInventory` by active tab. | Prevents constructing hidden DOM tables and innerHTML strings. |
| **S3.3** | `index.html` | L10725–10740 | Immediate catch-up render of target tab in `switchMainTab()`. | Instant zero-lag UI population upon clicking tabs. |
| **S4.1** | `index.html` | L5384 | Gate `threeController.updateTelemetry` to `stageViewMode === '3d'`. | Eliminates 50 Hz 3D entity matrix recalculations when in 2D mode. |
| **S4.2** | `src/ui/three/sceneManager.ts` | L615–635 | Demand-driven WebGL rendering via `isSceneDirty`. | Prevents GPU burn when 3D camera is stationary and sim is paused. |
| **S5.1** | `vite.config.ts` | L26–30 | Configure `rollupOptions.output.manualChunks` for Three and MapLibre. | Splits monolithic 2.3 MB entry chunk; speeds up initial load time by 60%. |

---

## 5. Verification Plan & Quality Gates

To verify that the optimization preserves 100% of physical accuracy, timeline capabilities, and architectural invariants, the implementation must pass the following 6 sequential gates:

### Gate 1: TypeScript Strict Typecheck
```bash
npm run typecheck
```
*Must pass with 0 errors across all modified modules.*

### Gate 2: Vite Production Build & Chunk Verification
```bash
npm run build
```
*Verify that `dist/assets/vendor-three-*.js` and `dist/assets/vendor-maplibre-*.js` exist as independent chunks, and `dist/assets/index-*.js` is under 1,000 kB.*

### Gate 3: Structural Architecture Verification
```bash
npm run verify:project
```
*Confirms all 5 detail workspaces, persistent map mount, worker messaging, and layout CSS selectors remain intact.*

### Gate 4: 60-Second Ring Buffer & Timeline Test Verification
```bash
npx tsx src/tests/verifyHistoryTimeline60s.ts
npx tsx src/tests/verifySimulationTimeline.ts
npx tsx src/tests/verifyThreeFoundation.ts
```
*Confirms that 3,000-record capacity, FIFO eviction, and Three.js stage controller tests pass with 0 failures.*

### Gate 5: Complete Test Suite Run (All 55 Suites)
```bash
npm run verify:all
```
*All 55 verification suites (RF physics, link budget, queueing, scheduler, geodesy, terrain, and timeline) must pass 100%.*

### Gate 6: Multi-Viewport Playwright Browser UX Verification
```bash
npm run verify:browser
```
*Validates that tab switching, radar interaction, terminal filtering, and multi-viewport layouts remain fully functional at `1440×900`, `1366×768`, `1024×768`, and `780×840`.*

---

## 6. Measurable Acceptance Criteria

1. **Zero-Allocation Ray Marching:** Profiling under DevTools Memory Allocation Timeline reveals 0 dynamic array allocations per tick inside `evaluateTerrainObstruction()`.
2. **Idle CPU Utilization:** When the simulation is paused and camera is still, CPU usage of the main thread drops to **$< 2\%$** (0 canvas redraws and 0 WebGL render calls).
3. **Throttled DOM Reflows:** DOM mutations during 50 Hz live simulation occur at $\sim 12.5\text{ Hz}$ ($80\text{ ms}$ spacing), reducing layout thrashing by $> 70\%$.
4. **Persistent Map Continuity:** The radar canvas in `.persistent-map-panel` continues rendering live aircraft movement and links smoothly while switching between `#tab-overview`, `#tab-scheduler`, `#tab-terrain`, and `#tab-terminal`.
5. **Clean Bundle Output:** Vite production build generates discrete `vendor-three` and `vendor-maplibre` chunks with 0 oversized chunk warnings.
6. **Flawless Quality Gates:** All 55 test suites and Playwright UX tests pass with 0 regressions.
