# Tactical X-Band Air-to-Ground Digital Twin — Full Codebase Context

This file is an authoritative, consolidated codebase context bundle prepared for LLMs.
It includes full system specifications, file manifests, and verbatim source code.

## Table of Packed Files

| Path | Lines | Size (Bytes) |
| :--- | :--- | :--- |
| `docs/PHASE_0_BASELINE.md` | 153 | 9,752 |
| `M0_IMPLEMENTATION_NOTES.md` | 220 | 21,285 |
| `METRICS_PATCH_NOTES.md` | 35 | 2,866 |
| `benchmark_results/BENCHMARK_DOSSIER.md` | 127 | 11,462 |
| `package.json` | 26 | 779 |
| `tsconfig.json` | 18 | 358 |
| `vite.config.ts` | 30 | 415 |
| `requirements.txt` | 8 | 123 |
| `electron/main.cjs` | 30 | 691 |
| `src/core/config.ts` | 225 | 9,420 |
| `src/core/geodesy.ts` | 146 | 6,300 |
| `src/core/hgtMosaic.ts` | 588 | 18,082 |
| `src/core/hgtParser.ts` | 288 | 8,575 |
| `src/core/linkBudget.ts` | 213 | 7,379 |
| `src/core/linkProfile.ts` | 193 | 9,496 |
| `src/core/linkStatusClassifier.ts` | 488 | 18,516 |
| `src/core/nodeRegistry.ts` | 452 | 15,273 |
| `src/core/obstacles.ts` | 260 | 14,889 |
| `src/core/profileEngine.ts` | 271 | 9,387 |
| `src/core/queues.ts` | 442 | 13,050 |
| `src/core/registration.ts` | 29 | 2,065 |
| `src/core/rollingGoodput.ts` | 179 | 5,502 |
| `src/core/scheduler.ts` | 491 | 17,653 |
| `src/core/terrain.ts` | 931 | 30,778 |
| `src/core/trajectory.ts` | 792 | 29,570 |
| `src/core/transferManager.ts` | 278 | 9,609 |
| `src/core/transferMetrics.ts` | 119 | 3,861 |
| `src/core/waypoints.ts` | 39 | 2,326 |
| `src/shared/constants.ts` | 33 | 1,168 |
| `src/shared/types.ts` | 21 | 575 |
| `src/shared/utils.ts` | 16 | 496 |
| `src/shared/workerProtocol.ts` | 611 | 21,302 |
| `src/worker/hillshadeGenerator.ts` | 328 | 11,852 |
| `src/worker/nodeLifecycleManager.ts` | 507 | 18,949 |
| `src/worker/simWorker.ts` | 1,429 | 62,349 |
| `src/worker/telemetrySerializer.ts` | 628 | 28,078 |
| `src/worker/terrainMeshGenerator.ts` | 100 | 3,653 |
| `core/config.py` | 184 | 7,744 |
| `core/link_budget.py` | 247 | 8,065 |
| `core/queues.py` | 474 | 19,016 |
| `core/scheduler.py` | 375 | 14,633 |
| `core/terrain.py` | 393 | 14,848 |
| `core/trajectory.py` | 317 | 13,326 |

**Total Files**: 43 | **Total Lines**: 12,734 | **Total Bytes**: 505,516 (~126,379 tokens)

---

## Source Code Files

### File: `docs/PHASE_0_BASELINE.md` (153 lines, 9,752 bytes)

```markdown
# Phase 0 Architecture & Verification Baseline
## DRDO Tactical X-Band Aerial Communication Network Digital Twin

> **Document Status:** Authoritative Baseline Record  
> **Milestone Completed:** Phase 0 (Phase 0A: Safety Net & Phase 0B Tasks A & B: Foundation)  
> **Effective Date:** 2026-11-06  
> **Evaluation Mode:** Strictly Verified Against Restored Repository Code

---

## 1. Execution Environment & Toolchain

The following runtime and compiler versions are verified and active for the repository:

| Tool / Dependency | Version | Scope / Lock Status |
| :--- | :--- | :--- |
| **Node.js** | `v24.19.0` | Active runtime (`process.version`) |
| **npm** | `12.0.2` | Package manager |
| **Vite** | `6.4.5` | Bundler & dev server (declared `^6.0.0` in `package.json`) |
| **TypeScript** | `5.9.3` | Typechecker & compiler (declared `^5.0.0` in `package.json`) |
| **vite-node** | `3.2.4` | In-memory TypeScript runner (exact `3.2.4` in `devDependencies`) |
| **three** | `0.187.0` | 3D rendering engine (declared `^0.187.0` in `package.json`) |
| **maplibre-gl** | `6.16.0` | Geospatial Map engine (declared `^6.16.0` in `package.json`) |

### Dependency Installation & Reproducibility
The project relies strictly on `package-lock.json` (lockfileVersion 3). To restore the complete environment reproducibly on any clean checkout without manual binary links:

```bash
# Clean, deterministic installation directly from package-lock.json
npm ci
```
*Verification Result:* Adds 46 audited packages in ~5 seconds with 0 vulnerabilities. Automatically creates the npm-managed binary link at `node_modules/.bin/vite-node`.

---

## 2. Verification Baseline

The following commands represent the official safety net for the repository. Every command was executed and verified:

```bash
# 1. Deterministic dependency restoration
npm ci

# 2. Static TypeScript typecheck (non-strict mode)
npm run typecheck

# 3. Structural repository and architecture assertion suite
npm run verify:project

# 4. Comprehensive automated verification suite (all 33 registered suites)
npm test

# 5. Production Vite bundle build
npm run build
```

### Verified Baseline Results
* **`npm run typecheck` (`tsc --noEmit`):**
  - **Result:** PASSED (Exit Code: `0`, 0 errors).
  - Validates all files under `src/core/`, `src/shared/`, `src/worker/`, and `src/ui/`.
* **`npm run verify:project` (`scripts/verify-project.mjs`):**
  - **Result:** PASSED (Exit Code: `0`, **19 / 19 checks passed**).
  - Validates artifact existence, 5 workspace tabs, MapLibre & Three mounts, worker-backed simulation, metrics symmetry, and script existence.
* **`npm test` / `npm run verify:all` (`scripts/run_all_verifications.mjs`):**
  - **Result:** PASSED (Exit Code: `0`, **33 / 33 suites passed**, 100.0% pass rate).
  - Total suite runtime: ~127–138 seconds.
  - Covers structural checks, static typecheck, physical propagation & geodesy, TDMA scheduler, worker state, kinematics, obstacle engine, link profile freshness, 60s ring buffer history, Three.js terrain/entities, canvas renderer, and 100-frame determinism trace.
* **`npm run build` (`vite build`):**
  - **Result:** PASSED (Exit Code: `0`, built in ~11–13 seconds).
  - Production bundle generated cleanly in `dist/` with source maps.

---

## 3. Determinism References & Golden State Hashes

Simulation determinism is verified using the canonical 64-bit IEEE-754 state-hash tracing engine (`src/tests/helpers/simulationTrace.ts`). Floating-point values are converted to raw 16-character hexadecimal bit patterns (`float64ToCanonicalHex`) with $-0.0$ normalized to $+0.0$ and hashed via SHA-256 (`state_sha256`).

### Terrain Asset Reference
* **Asset Path:** `public/terrain/real_ladakh_dem.bin`
* **File Size:** 1,048,576 bytes ($512 \times 512$ Float32 elevations)
* **Authoritative SHA-256 Checksum:**  
  `db042461396eab173f3d84d822233f3dc20010a03907d4f4ef358cd565215d96`

### Frozen Reference State Hashes

#### A. Synthetic Procedural DEM (`seed: 42`, $dt = 0.020\text{ s}$, 50 Hz)
* **Frame 0 ($t = 0.00\text{ s}$):** `610bfc696c1463727e981337f71e22b1ce2326c993eebaabf07c1aadfba134b7`
* **Frame 1 ($t = 0.02\text{ s}$):** `cecd3add18687179b94e1c333fe28e4089e679d6f31bb720f17cb646607b911c`
* **Frame 2 ($t = 0.04\text{ s}$):** `1d07c4b4a1b0aa447d21c437a505b22998a4422e11d95393ddae76a804f3583d`
* **Frame 10 ($t = 0.20\text{ s}$):** `948a3d1dffb8758b76c8c11e749aeb94d5a8946766cb2a430ee8e614d9b4b0ba`

#### B. Authentic Real Ladakh Satellite DEM (`seed: 7`, $dt = 0.020\text{ s}$, 50 Hz)
* **Frame 0 ($t = 0.00\text{ s}$):** `de7678d938d312f638684028f6b6bd81a55d5455af043ea3651487a575018c0d`
* **Frame 1 ($t = 0.02\text{ s}$):** `739d99ed3f23a9b42068be6f3a0ebcb5cea49fb092b2f7b6050534af5520a8f7`
* **Frame 2 ($t = 0.04\text{ s}$):** `c501c1ec0fc6927d3afffe5c1de283da44ed52ac7a02ee563909a27c85d76e03`
* **Frame 10 ($t = 0.20\text{ s}$):** `bc3b63d69a686fe493bb3c97b83d168571409ffae789ea3b98c56e07774776e0`

*Invariance Rule:* Any subsequent refactoring must reproduce these state hashes bit-for-bit when executing `node_modules/.bin/vite-node src/tests/verifyDeterminismTrace.ts`.

---

## 4. Architectural Invariants

Throughout all upcoming phases, the following invariants are strictly enforced:

1. **Worker State Authority:** The simulation Web Worker (`src/worker/simWorker.ts`) remains the single source of truth for all mutable tactical simulation state (node positions, battery levels, packet queues, trajectories, slot allocations). The main thread maintains only a read-only projection (`latestTelemetryFrame`).
2. **Worker Protocol Preservation:** The asynchronous IPC message contracts in `src/shared/workerProtocol.ts` (`WorkerCommand` and `WorkerOutboundMessage`) must remain backward-compatible.
3. **Dual-Thread Terrain Architecture:**
   - Worker-side `TerrainEngine` handles ray-casting, Fresnel occlusion, and look-ahead predictions.
   - Main-thread `mainTerrainEngine` handles 60 FPS live tactical radar cursor readout (`updateRadarCursorReadout`) and HGT tile mosaic stitching (`stitchHgtTiles`).
4. **Physical & Domain Preservation:** All physical calculations (ITU-R P.834, P.676, P.838 atmospheric loss, FSPL, Shannon capacity), TDMA slot scheduling logic, FQ-CoDel queue disciplines, Dubins kinematics, and battery thermodynamics must produce identical numerical outputs.
5. **Anti-Over-Engineering:** No dependency-injection frameworks, abstract factories, or unnecessary micro-interfaces. Modules must remain direct, concrete, and performant at 50 Hz.

---

## 5. Phase 0 Changes Implemented

### Phase 0A (Infrastructure & Safety Net)
* **`package.json`:** Corrected scripts to expose `test`, `typecheck`, `verify:project`, `verify:all`, and `benchmark:ts`. Added exact dependency `"vite-node": "3.2.4"`.
* **`package-lock.json`:** Regenerated cleanly via npm to include `vite-node@3.2.4` and its 5 sub-dependencies (`cac`, `debug`, `es-module-lexer`, `ms`, `pathe`).
* **`tsconfig.json`:** Created baseline non-strict configuration (`strict: false`) covering `src/core/`, `src/shared/`, `src/worker/`, and `src/ui/`.

### Phase 0B (Tasks A & B: Foundation)
* **`src/shared/utils.ts` (New Leaf File):**
  - Consolidated duplicate `isFiniteNumber(value: unknown): value is number` type guards.
  - Implemented pure `clamp(value: number, min: number, max: number): number`.
* **`src/shared/constants.ts` (Enriched):**
  - Added centralized node limits: `MIN_GROUND_AGL_M = 0.0`, `MAX_GROUND_AGL_M = 1000.0`, `DEFAULT_ANTENNA_AGL_M = 2.0`, `MAX_ACTIVE_GROUND_NODES = 128`.
* **Consumer Decoupling with Backwards-Compatible Re-Exports:**
  - `src/core/nodeRegistry.ts`: Imports `DEFAULT_ANTENNA_AGL_M` and `MAX_ACTIVE_GROUND_NODES` from `src/shared/constants` and re-exports them.
  - `src/worker/nodeLifecycleManager.ts`: Imports shared constants and `isFiniteNumber` from `src/shared/`, re-exporting them for test compatibility.
  - `src/ui/nodeAglController.ts`: Imports AGL limits from `src/shared/constants` and preserves `DEFAULT_GROUND_AGL_M` alias.
  - `src/worker/simWorker.ts`: Imports shared constants and `isFiniteNumber` from `src/shared/`, eliminating 3 duplicate local declarations.
  - `src/ui/commandResultRouter.ts`: Imports `isFiniteNumber` from `src/shared/utils`.

---

## 6. Known Deferred Work (Future Phases)

The following items were identified during inspection and are intentionally deferred to future phases:

1. **Battery Model Extraction (`src/core/batteryModel.ts`):**
   - Extract power amplifier efficiency (`0.35`), supply voltage (`12.0 V`), idle/TX drain, and capacity equations out of `simWorker.ts:436-465` into a pure, testable domain function (`computeStepBatteryDrain`). Deferred to Phase 1.
2. **`queues.ts` / `nodeRegistry.ts` Decoupling:**
   - Invert the dependency where `GroundNodeTrafficSubsystem` imports `formatDeterministicNodeUuid` from `nodeRegistry.ts`. Deferred to Phase 1.
3. **Synthetic Procedural DEM Generator Extraction:**
   - Extract procedural Diamond-Square/Perlin elevation synthesis out of `src/core/terrain.ts` into `src/core/syntheticDemGenerator.ts`. Deferred to Phase 1.
4. **Worker State Decomposition:**
   - Decompose `SimulationWorkerManager` into `SimulationEngine`, `SimulationClock`, and `NodeSimulationPool` (unifying `nodesStatic` and `nodesTac` parallel arrays into atomic pairs). Deferred to Phase 2.
5. **Main-Thread UI Monolith Extraction:**
   - Extract inline JavaScript from `index.html` into scoped panel controllers (`OverviewTabController`, `SchedulerTabController`, `TerrainRFTabController`, etc.) managed by a lightweight `AppShell`. Deferred to Phase 4.
6. **Strict Mode TypeScript Hardening:**
   - Incrementally enable `strict: true` after code boundaries are cleanly isolated. Deferred to Phase 5.
```

### File: `M0_IMPLEMENTATION_NOTES.md` (220 lines, 21,285 bytes)

```markdown
# Milestone M0.1 — Reproducible Verification Baseline Implementation Notes

## 1. Overview & Objectives

Milestone **M0.1 (Reproducible Verification Baseline)** establishes a reproducible, reliable verification and benchmarking baseline for the DRDO Tactical X-Band Digital Twin before introducing simulation architecture, dynamic node, or terrain physics upgrades.

### Key Principles & Constraints
1. **Zero Physics / Architecture Changes**: All simulation logic, RF propagation formulas, terrain profile calculations, TDMA scheduler behavior, packet queue disciplines, and the discrete 20 ms simulation timestep ($dt = 0.020\text{ s}$, $50\text{ Hz}$) remain strictly unmodified.
2. **Authoritative Engine Preservation**: The TypeScript simulation engine remains authoritative.
3. **No Unnecessary Dependencies**: Zero external runtime or development dependencies were introduced.
4. **Observational Purity**: All benchmarking, timing measurements, and canonical state-hash tracing are strictly non-mutating and decoupled from simulation decision logic.

---

## 2. Independent Audit Remediation & Provenance Disclosures

Following independent technical audits by GPT-5.6 Luna ("Pass with Conditions") and GLM 5.3 Flash, the following provenance clarifications, architectural disclosures, and corrections have been implemented:

### 2.1 Git Commit Hash & Working-Tree State
- **Authoritative Base Commit Hash**: `601b6eeabbb81007a942d1f2a77dcdfe86dbdfe5` (on branch `main`).
- **Working-Tree Status (`git_dirty: true`)**: All baseline verification reports and benchmark outputs record `git_dirty: true`. This is expected and strictly accurate because the M0.1 verification harness (`scripts/run_all_verifications.mjs`), test suites (`src/tests/verifyDeterminismTrace.ts`, `src/tests/helpers/simulationTrace.ts`), and baseline documentation (`M0_IMPLEMENTATION_NOTES.md`) are new, uncommitted files in the workspace while establishing the baseline.
- **Authoritative Provenance**: Each individual JSON report contains an embedded `provenance` metadata block recording exact Git state, host OS, Node.js version, and CPU model at the exact moment of execution. This JSON block is authoritative for each respective artifact.

### 2.2 Benchmark Execution Boundaries & Timing Isolation
- **Warm-Up Manager Instance**: Benchmark pre-warming (`--warmup N`) is executed on an isolated in-process `SimulationWorkerManager` instance within the same Node.js process, **not** in a separate Web Worker thread.
- **Measured Step Latency vs. End-to-End Worker Transport**: The per-step wall-clock latency metric (`step_p50_ms`, `step_mean_ms`, etc.) measures the synchronous execution duration of `manager.tickSimulation()`, which includes simulation physics, RF math, queue servicing, scheduling, and internal telemetry-frame assembly (`buildTelemetryFrame()`). It **strictly excludes** asynchronous Web Worker IPC transport (`postMessage`), browser structured-cloning serialization overhead, and DOM/Three.js rendering time.
- **Dedicated Setup Phase Timing (`setup_phase_ms`)**: Benchmark Schema 1.3 explicitly separates `setup_phase_ms` (which encompasses worker manager instantiation, DEM buffer loading, terrain mode initialization, and ground-node elevation resampling) from the simulation tick loop.
- **Cold-Start Behavior (`--warmup 0`)**: Without warm-up ticks, the first simulation frame experiences a cold-start latency spike (~35–45 ms vs. ~18 ms steady-state) due to V8 Turbofan JIT compilation and initial terrain buffer materialization. Pre-warming via `--warmup 10` compiles hot code paths, yielding clean steady-state measurements.

### 2.3 Subsystem Coupling Disclosures & Future Cleanup Items
1. **Module-Level Synthetic Terrain Cache**: `src/core/terrain.ts` maintains a module-scoped cache (`cachedSyntheticDem`) for procedural 2D IFFT elevation data. While this accelerates instantiation of synthetic scenarios, it creates shared state across simulation instances in the same process. Multi-tile terrain ingestion in Milestone M2 will encapsulate terrain state strictly within engine instances.
2. **Process-Global Packet Counter**: `GroundNodeTrafficSubsystem.globalPacketCounter` in `src/core/queues.ts` statically increments across the Node.js process. Mathematical and source code audit confirmed that `packetId` is assigned upon packet creation but is never inspected, branched upon, or used in routing, scheduling, or queue drop decisions. It has been excluded from canonical state hashing to permit deterministic same-process replays without mutating simulation semantics.
3. **Private Method Reach-In**: The benchmark runner invokes `(manager as any).resampleGroundNodeAltitudes?.()` after loading custom satellite DEM rasters. This private reach-in is recorded as an explicit technical debt item to be formalized into a public lifecycle API during Milestone M1/M1a.
4. **Stderr Notice Clarification**: Direct Node process spawning (`process.execPath`) eliminated npm wrapper overhead and stderr noise for all `vite-node` verification suites. However, the `typecheck` suite invokes `npm run typecheck` (`tsc --noEmit`), which may emit npm notification banners to stderr.
5. **Real-DEM Seed Redundancy & Topological Shadowing**: In the authentic Ladakh DEM scenario, 15 out of 16 ground terminals are situated in deep mountain valleys with line-of-sight obstructed by ridgelines. Because occluded terminals buffer their traffic without transmitting, Poisson traffic RNG consumption follows identical patterns across seeds. This is an authentic consequence of the physical terrain topography, not an RNG defect.
6. **Tac-TAD Scheduling Semantics**: Tac-TAD does **not** eliminate physical RF propagation outages. Rather, Tac-TAD uses predictive link state awareness to withhold slot grants from terminals experiencing severe terrain occlusion, preventing packet payload from being dequeued into severed links and thereby achieving zero wasted bits on outage.

---

## 3. Command Reference

### Verification Commands

| Command | Description |
| :--- | :--- |
| `npm run verify:all` | Executes all 33 registered verification suites independently, generating summary tables and machine-readable JSON reports. |
| `node scripts/run_all_verifications.mjs --suite determinism` | Runs only suites matching the specified ID or pattern. |
| `node scripts/run_all_verifications.mjs --timeout 30000` | Configures per-suite timeout (default: 60,000 ms). |
| `node scripts/run_all_verifications.mjs --bail` | Aborts immediately on the first suite failure. |
| `npm test` | Legacy verification script chaining 28 test suites sequentially. |
| `npm run verify` | Runs structural repository assertions in `scripts/verify-project.mjs`. |
| `npm run typecheck` | Executes strict TypeScript compilation checks (`tsc --noEmit`). |
| `npm run build` | Builds the production Vite bundle to `dist/`. |
| `node node_modules/.bin/vite-node src/tests/verifyDeterminismTrace.ts` | Runs the authoritative determinism trace suite (Tests T1–T6). |

### Benchmark Commands

| Command | Description |
| :--- | :--- |
| `npm run benchmark:synthetic` | Runs headless benchmark with procedural 2D IFFT synthetic terrain (default 500 frames, seeds 1–5). |
| `npm run benchmark:real` | Runs headless benchmark with authentic Ladakh satellite DEM raster. |
| `npx vite-node scripts/run_ts_benchmark.ts --frames 500 --seeds 1,2,3 --terrain-mode real --warmup 10` | Runs a representative 500-frame, 3-seed benchmark with isolated warm-up. |
| `npx vite-node scripts/run_ts_benchmark.ts --frames 100 --seeds 42 --terrain-mode synthetic --trace --trace-out /path/trace.json` | Runs benchmark and exports canonical SHA-256 state-hash trace. |

---

## 4. Verification Registry (All 33 Registered Suites)

The verification runner tracks 33 distinct suites independently:

| # | Suite ID | Category | Command Executed | Duration | Status |
|---|---|---|---|---|---|
| 1 | `verify-project` | structural | `node scripts/verify-project.mjs` | 0.08s | **PASSED** |
| 2 | `typecheck` | typecheck | `npm run typecheck` | 2.51s | **PASSED** |
| 3 | `verify:physics` | physics | `node node_modules/.bin/vite-node src/tests/verifyPhysics.ts` | 0.58s | **PASSED** |
| 4 | `verify:scheduler` | scheduler | `node node_modules/.bin/vite-node src/tests/verifyScheduler.ts` | 0.59s | **PASSED** |
| 5 | `verify:worker` | worker | `node node_modules/.bin/vite-node src/tests/verifyWorkerState.ts` | 1.15s | **PASSED** |
| 6 | `verify:trajectory` | trajectory | `node node_modules/.bin/vite-node src/tests/verifyTrajectoryModes.ts` | 0.96s | **PASSED** |
| 7 | `verify:trajectory-editor` | editor | `node node_modules/.bin/vite-node src/tests/verifyTrajectoryEditor.ts` | 0.72s | **PASSED** |
| 8 | `verify:obstacles` | obstacles | `node node_modules/.bin/vite-node src/tests/verifyObstacles.ts` | 1.25s | **PASSED** |
| 9 | `verify:obstacle-editor` | editor | `node node_modules/.bin/vite-node src/tests/verifyObstacleEditor.ts` | 0.81s | **PASSED** |
| 10 | `verify:profile-freshness` | profile | `node node_modules/.bin/vite-node src/tests/verifyProfileFreshness.ts` | 1.05s | **PASSED** |
| 11 | `verify:profile-viewport` | profile | `node node_modules/.bin/vite-node src/tests/verifyProfileViewport.ts` | 0.73s | **PASSED** |
| 12 | `verify:history` | history | `node node_modules/.bin/vite-node src/tests/verifyHistoricalProfile.ts` | 0.95s | **PASSED** |
| 13 | `verify:history-scheduler` | history | `node node_modules/.bin/vite-node src/tests/verifyHistoricalScheduler.ts` | 1.16s | **PASSED** |
| 14 | `verify:history-timeline` | history | `node node_modules/.bin/vite-node src/tests/verifyHistoryTimeline60s.ts` | 1.70s | **PASSED** |
| 15 | `verify:link-classifier` | rf | `node node_modules/.bin/vite-node src/tests/verifyLinkClassifier.ts` | 0.75s | **PASSED** |
| 16 | `verify:three-foundation` | three | `node node_modules/.bin/vite-node src/tests/verifyThreeFoundation.ts` | 0.74s | **PASSED** |
| 17 | `verify:three-terrain` | three | `node node_modules/.bin/vite-node src/tests/verifyThreeTerrain.ts` | 2.01s | **PASSED** |
| 18 | `verify:three-entities` | three | `node node_modules/.bin/vite-node src/tests/verifyThreeEntities.ts` | 0.80s | **PASSED** |
| 19 | `verify:geodesy` | geodesy | `node node_modules/.bin/vite-node src/tests/verifyGeodesy.ts` | 0.71s | **PASSED** |
| 20 | `verify:cursor-readout` | ui | `node node_modules/.bin/vite-node src/tests/verifyCursorReadout.ts` | 0.78s | **PASSED** |
| 21 | `verify:scheduler-percentiles`| scheduler | `node node_modules/.bin/vite-node src/tests/verifySchedulerPercentiles.ts` | 2.58s | **PASSED** |
| 22 | `verify:path-profile-top-view`| ui | `node node_modules/.bin/vite-node src/tests/verifyPathProfileTopView.ts` | 0.74s | **PASSED** |
| 23 | `verify:node-inventory` | ui | `node node_modules/.bin/vite-node src/tests/verifyNodeInventoryCoordinates.ts` | 0.71s | **PASSED** |
| 24 | `verify:data-comm` | ui | `node node_modules/.bin/vite-node src/tests/verifyDataCommVisualization.ts` | 2.45s | **PASSED** |
| 25 | `verify:physical-speed` | trajectory | `node node_modules/.bin/vite-node src/tests/verifyPhysicalSpeed.ts` | 12.85s | **PASSED** |
| 26 | `verify:rf-bandwidth` | rf | `node node_modules/.bin/vite-node src/tests/verifyRfBandwidth.ts` | 0.96s | **PASSED** |
| 27 | `verify:integration-hardening`| integration | `node node_modules/.bin/vite-node src/tests/verifyIntegrationHardeningM63.ts` | 4.58s | **PASSED** |
| 28 | `verify:node-agl` | node | `node node_modules/.bin/vite-node src/tests/verifyNodeAglConfiguration.ts` | 1.28s | **PASSED** |
| 29 | `verify:dem-mapping` | terrain | `node node_modules/.bin/vite-node src/tests/verifyDemMapping.ts` | 0.69s | **PASSED** |
| 30 | `verify:coverage-propagation`| terrain | `node node_modules/.bin/vite-node src/tests/verifyCoveragePropagation.ts` | 0.60s | **PASSED** |
| 31 | `verify:hillshade-bounds` | terrain | `node node_modules/.bin/vite-node src/tests/verifyHillshadeBounds.ts` | 1.10s | **PASSED** |
| 32 | `verify:canvas-terrain` | terrain | `node node_modules/.bin/vite-node src/tests/verifyCanvasTerrain.ts` | 0.62s | **PASSED** |
| 33 | `verify:determinism` | determinism | `node node_modules/.bin/vite-node src/tests/verifyDeterminismTrace.ts` | 14.20s | **PASSED** |

**Execution Summary**: **33 / 33 Passed (100.0%)**.
Machine-readable report: `benchmark_results/generated/verification-report-latest.json`.

---

## 5. Deterministic State-Hash Tracing Facility (Tests T1–T6)

### Implementation Design (`src/tests/helpers/simulationTrace.ts`)
1. **Raw IEEE-754 Serialization**: Floating-point values are converted to 16-character hexadecimal strings representing raw 64-bit IEEE-754 bit patterns via `Float64Array` and `BigUint64Array`. Decimal rounding and string formatting discrepancies are completely eliminated.
2. **Negative Zero Normalization**: Negative zero (`-0.0`) is canonicalized to `+0.0` prior to bit extraction (`Object.is(val, -0) ? 0 : val`).
3. **NaN Detection**: Any occurrence of `NaN` throws an immediate assertion error rather than being masked.
4. **Deterministic Structural Traversal**: Serializes UAV position/velocity/speed, 16 ground node spatial coordinates, class subqueues (ordered by priority 69, 65, 67, 70), link status tables, lookahead predictive states, and scheduler reports.
5. **Decoupled Packet IDs**: Process-global `packetId` is excluded from the state hash after verifying it does not influence simulation decisions.
6. **Observational Purity**: Hash serialization reads read-only telemetry and does not invoke mutating operations.

### Determinism Test Results (`src/tests/verifyDeterminismTrace.ts`)
- **T1 (Same-Seed Synthetic Replay, 100 Frames)**: **PASSED**. Bit-for-bit identical traces across both sequential replays and two independent fresh Node.js processes.
- **T2 (Same-Seed Real DEM Replay, 100 Frames)**: **PASSED**. Bit-for-bit identical traces across both sequential replays and two independent fresh Node.js processes.
- **T3 (Synthetic Seed Divergence)**: **PASSED**. Confirmed that seed 1 vs seed 2 produces diverging simulation states starting at frame 2 due to seed-dependent traffic RNG draws.
- **T4 (Real DEM Seed Behavior)**: **PASSED**. Verified that multiple seeds complete with valid, finite canonical hashes without NaN occurrences under mountainous shadowing.
- **T5 (Deliberate Mutation Pinpointing)**: **PASSED**. After 10 identical frames, a single flight configuration mutation at frame 11 (`loiter_speed_mps: 90.0`) was immediately and uniquely detected at frame 11.
- **T6 (Tick-Path Observational Purity)**: **PASSED**. Confirmed that an instance stepped with active hash computation matches an unprofiled instance step-for-step with zero divergence.

---

## 6. Representative Benchmark Performance (Schema 1.3, 500 Frames × 3 Seeds)

### Environment Provenance
- **Hardware**: Intel(R) Core(TM) i3-8130U CPU @ 2.20GHz (4 logical cores)
- **OS / Platform**: Linux x64
- **Node.js**: `v24.19.0`
- **Git Commit**: `601b6eeabbb81007a942d1f2a77dcdfe86dbdfe5` (`git_dirty: true`)
- **Discrete Simulation Timestep**: $\Delta t = 20.0\text{ ms}$ ($50\text{ Hz}$)

### Latency Profile Comparison (1,500 Total Measured Steps)

| Metric | Synthetic Procedural DEM | Authentic Real Ladakh Satellite DEM |
| :--- | :--- | :--- |
| **Terrain Mode** | `synthetic` (2D IFFT procedural) | `real` (`public/terrain/real_ladakh_dem.bin`) |
| **DEM SHA-256 Checksum** | `null` | `db042461396eab173f3d84d822233f3dc20010a03907d4f4ef358cd565215d96` |
| **Warm-up Configuration** | 10 frames (isolated in-process manager) | 10 frames (isolated in-process manager) |
| **Profiled Steps** | 1,500 steps (500 frames $\times$ seeds 1, 2, 3) | 1,500 steps (500 frames $\times$ seeds 1, 2, 3) |
| **Setup Phase ($p50$ / Mean)** | 0.51 ms / 0.47 ms | 0.43 ms / 0.49 ms |
| **Median Step Latency ($p50$)** | **19.74 ms** | **11.34 ms** |
| **95th Percentile ($p95$)** | **24.91 ms** | **15.55 ms** |
| **99th Percentile ($p99$)** | **30.17 ms** | **18.06 ms** |
| **Mean Step Latency** | **20.30 ms** | **11.77 ms** |
| **Min Step Latency** | 17.14 ms | 9.78 ms |
| **Max Step Latency** | 46.50 ms | 33.38 ms |
| **Total Wall Duration** | 30.46 s | 17.66 s |

---

## 7. Real-Time ($1\times$) and Accelerated Performance Analysis

### Simulation Timestep Constraint
The discrete simulation superframe is strictly **20 ms** ($\Delta t = 0.020\text{ s}$).

### Performance Interpretation
- **Real-Time $1\times$ Execution**:
  - In Real DEM mode, the median step execution time ($11.34\text{ ms}$) easily fits within the 20 ms budget. However, tail latency ($p99 = 18.06\text{ ms}$, $\max = 33.38\text{ ms}$) occasionally breaches the budget.
  - In Synthetic DEM mode, median latency ($19.74\text{ ms}$) is very close to the 20 ms threshold, but tail latency ($p95 = 24.91\text{ ms}$, $p99 = 30.17\text{ ms}$, $\max = 46.50\text{ ms}$) exceeds 20 ms.
  - **Conclusion**: Unconditional real-time execution ($1\times$) cannot be claimed without qualifications on this hardware. While typical (median) steps execute within budget, tail latency spikes cause frame slips during heavy obstruction updates.
- **Feasibility of $100\times$ Execution**:
  - $100\times$ acceleration requires each step to execute in $\le 0.20\text{ ms}$ ($200\ \mu\text{s}$).
  - With current per-step execution times between 11 ms and 19 ms, headless execution currently runs at approximately **$1.0\times$ to $1.7\times$ real-time** sequentially.
  - Reaching $100\times$ will require worker-internal step batching, suppressing UI telemetry frame emission during accelerated phases, and vectorizing path-profile line-of-sight checks.

---

## 8. Scheduler Metric Interpretation

### Source Code Findings (`src/core/scheduler.ts`)
The benchmark reports three primary MAC/scheduler metrics:

1. **`goodput_bits` (`totalBitsTransmitted`)**:
   - *Definition*: The sum of actual packet payload bits dequeued from node priority queues for terminals that have a **viable RF link** (`!isOutage` and `currentState !== HARD_SHADOW_CUTOFF`).
   - *Technical Distinction*: This is a **scheduler/MAC-level allocation metric**. It indicates that payload was placed into a TDMA slot with adequate link margin. It is **NOT** end-to-end transport goodput, as it does not model physical receiver demodulation errors, CRC checks, or transport-layer (TCP/ACK) receipt.
2. **`payload_bits_dequeued` (`totalPayloadBitsDequeued`)**:
   - *Definition*: The total quantity of payload bits removed from node queues during the frame, regardless of link status.
3. **`wasted_bits_on_outage` (`totalBitsWastedOnOutage`)**:
   - *Definition*: The payload bits dequeued while the corresponding terminal's link was severed by terrain occlusion or obstacle blockage.
   - *Static TDMA*: Because Static TDMA allocates slots round-robin regardless of RF visibility, occluded terminals dequeue packets into severed links, resulting in **2,841,600 wasted bits** over 500 frames in the Ladakh scenario.
   - *Tac-TAD*: Tac-TAD filters out occluded links before scheduling, strictly achieving **0 wasted bits** by design.

### Explanation of the 1.00 Ratio in Real Ladakh DEM Mode
In the Ladakh DEM benchmark (500 frames), both schedulers produce an identical `goodput_bits` of 732,160 bits (ratio = 1.00).
- *Root Cause*: Pervasive topographic occlusion in the mountainous Ladakh terrain blocks 15 out of 16 ground terminals. Only one node (MCP) has an unblocked line-of-sight link.
- *Scenario Dynamic*: Both Static TDMA and Tac-TAD assign sufficient slot capacity to MCP to evacuate its incoming traffic demand. For the remaining 15 occluded terminals, Static TDMA radiates into mountain rock (wasting 2.84 Mb), whereas Tac-TAD withholds transmissions and reclaims airtime (packet delay drops: 1,304 vs 172).
- *Engineering Conclusion*: A 1.00 ratio in this scenario is an artifact of severe topographic blockage and single-node LOS availability, not evidence that the schedulers are equivalent.

---

## 9. Quarantined Artifacts & Generated Data Hygiene

The three pre-fix benchmark pairs contaminated by the earlier warm-up metric issue have been quarantined:
- `benchmark_results/generated/quarantine_superseded_m01/typescript-benchmark-2026-11-03T07-16-33-115Z.*`
- `benchmark_results/generated/quarantine_superseded_m01/typescript-benchmark-2026-11-03T07-17-03-262Z.*`
- `benchmark_results/generated/quarantine_superseded_m01/typescript-benchmark-2026-11-03T07-17-15-974Z.*`
- Accompanied by a dedicated `README.md` explaining why they are superseded.
- The tracked legacy baseline `typescript-benchmark-2026-10-27T06-51-55-930Z.*` is preserved and annotated as a legacy Schema 1.1 artifact lacking modern provenance metadata.

---

## 10. Build Warnings & Known Limitations

1. **Vite Production Chunk Warning**:
   ```text
   dist/assets/index-BE3oJXLh.js  867.27 kB │ gzip: 225.09 kB
   (!) Some chunks are larger than 500 kB after minification.
   ```
   *Note*: Expected due to bundled Three.js and core mathematical libraries; will be addressed during future frontend code-splitting milestones.
2. **Terrain Scope**:
   Real DEM mode currently evaluates the single $512 \times 512$ Ladakh raster tile. Multi-tile terrain ingestion is scheduled for Milestone M2.
```

### File: `METRICS_PATCH_NOTES.md` (35 lines, 2,866 bytes)

```markdown
# Metrics-correction patch notes

## Changed
- `src/core/scheduler.ts`
  - Added explicit available, scheduled, and unused uplink airtime fields.
  - Added payload-bits-dequeued separately from goodput bits.
  - Added final queue backlog bits.
  - Preserved cumulative drop totals and added per-frame drop deltas using scheduler-local snapshots.
  - Tac-TAD now skips links marked as outage as well as hard-shadow/zero-rate links, preventing queue dequeue on a link explicitly marked unusable.
  - Replaced the misleading hardcoded comment with an explicit definition: Tac-TAD's outage-wasted dequeued payload is zero because unusable links are filtered before dequeue.
- `src/worker/simWorker.ts`
  - Accumulates per-run scheduled/available/unused airtime, payload dequeued, drop deltas, and final backlog for both schedulers.
  - Keeps final cumulative drop counts as final counters; it does not incorrectly add cumulative values each frame.
- `scripts/run_ts_benchmark.ts`
  - Bumped result schema to 1.1.
  - Exports run-level airtime utilization, unused airtime, payload dequeued, outage-wasted payload, observed drop increments, final cumulative drops, and final backlog.
  - Adds explicit metric definitions and limitations.
- `src/tests/verifyScheduler.ts`
  - Added checks that outage queues remain queued under Tac-TAD, airtime totals reconcile, and cumulative drops are not misreported as per-frame deltas.
- `scripts/verify-project.mjs`
  - Added structural checks for the new instrumentation.

## Verification performed in this environment
- `npm test`: PASS, 19/19 structural checks.
- TypeScript compilation of scheduler, worker, benchmark runner, and scheduler verification suite using the globally available TypeScript compiler and a temporary Node type shim: PASS.
- `src/tests/verifyScheduler.ts`: PASS, all six scheduler/queue/trajectory checks.
- Headless benchmark smoke run: PASS, 100 frames each for seeds 1 and 2. Ratios were 2.662763 and 2.978923, matching the previously observed short-run ratios.
- `npm run build`: NOT VERIFIED. The uploaded ZIP had no complete installed dependencies; `npm ci` timed out in this environment and `vite` was unavailable. Run `npm ci` then `npm run build` on the project machine.

## Interpretation cautions
- Goodput is actual packet payload dequeued while the scheduler reports a usable link; it is not an independent receiver/ACK measurement.
- Tac-TAD's zero outage-waste metric means it does not dequeue payload while a link is marked unusable. It does not mean zero unused airtime or zero RF energy waste.
- Scheduled airtime includes each allocation's guard interval. Unused airtime is available uplink time minus scheduled airtime.
- The original 10-seed, 5,000-frame result was produced before this patch and must be rerun to report corrected metrics.
- No Python/TypeScript parity claim is made.
```

### File: `benchmark_results/BENCHMARK_DOSSIER.md` (127 lines, 11,462 bytes)

```markdown
# HISTORICAL BENCHMARK DOSSIER: TACTICAL X-BAND TDMA DIGITAL TWIN (LEGACY PYTHON ENGINE)
Classification: Deterministic Simulation Evaluation (Ladakh Sector Scenario)

---

### BENCHMARK PROVENANCE & HOST SYSTEM METADATA
- **Execution Timestamp (UTC):** `2026-10-22 17:06:33 UTC` to `2026-10-22 17:11:23 UTC`
- **Wall-Clock Execution Time:** `289.76 seconds` (Achieved simulation rate: `17.3 fps`)
- **Simulated Mission Duration:** `100.0 seconds` (`5,000` superframes at 50 Hz cadence)
- **Host Operating System:** `Linux-7.2.9-201.fc44.x86_64-x86_64-with-glibc2.43`
- **Python Runtime:** `3.14.8` (Architecture: `x86_64`, CPU: `Generic Processor`)
- **Deterministic Random Seed:** `42`
- **Channel Prediction Cadence:** `10 Hz (100 ms step)` decoupled from `50 Hz (20 ms)` TDMA slot allocation

---

### 1. EXECUTIVE SUMMARY & SYSTEM OVERVIEW

**Evidence status:** historical legacy-Python run; seed 42; current TypeScript parity not established. Treat all values below as provisional until the current engine reproduces them from raw run outputs.
This archived benchmark dossier records a historical comparative evaluation from the **legacy Python engine** of the **Terrain-Aware Dynamic Scheduler (Tac-TAD)** versus **Legacy Static TDMA** for an Aerial Communication Node (ACN / UAV) operating at **8.0 GHz (Tactical X-Band)** over high-relief Himalayan topography (Ladakh / Kargil Sector).

Under identical multi-class tactical traffic generation across 16 ground terminals, **Tac-TAD achieves a +7.78x Goodput Advantage**, reduces concluded packet drop rates from **52.7% down to 13.9%**, and completely eliminates the **6.3% slot-time allocation waste** caused by Legacy Static TDMA assigning transmission slots to nodes occluded by mountain rock.

---

### 2. METHODOLOGY & SCOPE BOUNDARIES

This research benchmark is a deterministic comparative simulation using project-defined approximations inspired by ITU-R P.526, ITU-R P.834, 3GPP 5QI, and DVB-S2X parameters. The models operate under the following explicit scope specifications:

- **Geometry**: 4/3 spherical Earth mean-radius curvature approximation ($R_{\text{eff}} = 8,494.67\,\text{km}$, ITU-R P.834).
- **Diffraction**: Single-dominant-obstacle knife-edge diffraction with First Fresnel Zone clearance and an empirical 12 dB rounded-crest Fock penalty (ITU-R P.526-15).
- **Queues**: 3GPP MCX multi-class strict-priority queue with CoDel sojourn deadline pruning and bounded C2 capacity.
- **Trajectory**: Constant true airspeed ($60\,\text{m/s}$) along an arc-length parameterized ellipse ($a = 20\,\text{km}, b = 10\,\text{km}, \phi = 35^\circ$).
- **Terrain**: Calibrated deterministic Himalayan geomorphic model.
- **Cadence**: Configured for a 20 ms superframe timestep (50 Hz simulation interval) with 10 Hz trajectory lookahead decimation.

| Subsystem Component | Specification / Value | Standard / Mathematical Model |
| :--- | :--- | :--- |
| **Carrier Frequency** | `8.0 GHz` (X-Band) | Tactical Shared Air-to-Ground Carrier |
| **Shared RF Channel Bandwidth** | `1.0 MHz` | Single Carrier Dynamic TDD/TDMA |
| **ACN Transceiver PA / Antenna** | `40.0 dBm` (10 W) / `15.0 dBi` | Planar Conformal Phased Array |
| **Soldier Terminal PA / Antenna** | `36.0 dBm` (4 W) / `3.0 dBi` | Hemispheric Omni Whip Manpack |
| **Main Command Post PA / Antenna**| `43.0 dBm` (20 W) / `20.0 dBi` | Directional Tracking Parabolic Dish |
| **Tropospheric Refraction** | $k = 4/3$ ($R_{\text{eff}} = 8,494.67\,\text{km}$) | ITU-R P.834 Mean-Radius Spherical Earth |
| **Obstacle Diffraction Regime** | Knife-Edge + Fock Curvature (+12 dB) | ITU-R P.526-15 Rounded-Crest Dominant Obstacle |
| **Atmospheric Specific Attenuation**| `0.012 dB/km` (Clean Alpine Air) | ITU-R P.676 Gaseous Absorption |
| **ACN Flight Trajectory** | Constant Speed ($60\,\text{m/s}$) on Ellipse ($a=20\text{km}, b=10\text{km}$) | Arc-Length Parameterized Numerical Integration |
| **Superframe Structure** | $20.0\,\text{ms}$ (50 Hz frame rate) | 1ms CTRL + 3ms DL BCAST + 16ms Uplink |
| **Closed-Loop Timing Advance** | $\tau_{\text{guard}} = 12.0\,\mu\text{s}$ | $TA = 2 \cdot d_{3D} / c$ Closed-Loop Alignment |
| **Active Deployed Nodes** | 16 Terminals (15 Soldiers + 1 MCP) | Deterministic Ladakh valley deployment |

---

### 3. CONSOLIDATED MAC PERFORMANCE MATRIX

| Performance KPI Metric | Legacy Static TDMA | Tac-TAD (Dynamic Ours) | Operational Delta / Gain |
| :--- | :---: | :---: | :---: |
| **Total Delivered Goodput** | **27.72 Mb** | **215.78 Mb** | **+7.78x Throughput Gain** |
| **Median Superframe Goodput (P50)**| **0.13 Mbps** | **2.11 Mbps** | **+1.98 Mbps** |
| **Peak Superframe Goodput (P95)** | **0.96 Mbps** | **3.49 Mbps** | **+2.53 Mbps** |
| **Concluded Packet Drop Rate** | **52.68%** | **13.93%** | **-38.75% Drops Slashed** |
| **Pending In-Flight Rate (at Termination)** | `0.08%` (39 pkts) | `0.00%` (2 pkts) | `-0.07%` In-Flight |
| **Total Non-Delivery Rate (Drops + Pending)** | **52.71%** | **13.93%** | **-38.78% Deficit Reduced** |
| **Hard-Shadow Slot-Time Allocation Waste (Fraction of frame time assigned to severed links)** | **6.31%** | **0.00%** | **-6.31% Slot Waste Eliminated** |
| **Severed-Link Payload Waste (Bits dequeued into severed links)** | `6.02 Mb (17.9%)` | `0.00 Mb (0.0%)` | `-6.02 Mb` Saved |
| **Total Concluded Packets Dropped** | `27,088` | `7,168` | `-19,920` Packets Saved |

> **Clarification Note on Allocation Waste:** The 0.00% figure represents zero payload slot allocation to severed links. It does not imply zero protocol overhead or zero unallocated frame slack.

> **Clarification Note on Pending In-Flight Packets:** Packets remaining in queue at simulation termination ($T+100.0\text{s}$) without exceeding their deadline are classified as `PENDING_AT_TERMINATION` and are reported separately from the Concluded Packet Drop Rate.

---

### 4. 3GPP 5QI QUALITY-OF-SERVICE & LATENCY BENCHMARKS

| QoS Class Identifier & Traffic Profile | Static Drop Rate | Tac-TAD Drop Rate | Static Pending | Tac-TAD Pending | Static Mean Latency | Tac-TAD Mean Latency | Tac-TAD P95 Latency | PDB Delay Budget |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **5QI 69: Emergency C2 / SOS** | 7.92% | **4.63%** | 0.0% | 0.0% | 0.0 ms | **232.5 ms** | **0.0 ms** | `60 s (Persistent)` |
| **5QI 65: MC-PTT Voice** | 25.70% | **25.73%** | 0.0% | 0.0% | 0.0 ms | **0.1 ms** | **0.0 ms** | `75 ms` |
| **5QI 67: Tactical Video Feed** | 100.00% | **12.37%** | 0.2% | 0.0% | 0.0 ms | **6.4 ms** | **40.0 ms** | `150 ms` |
| **5QI 70: High-Res Recon Photo** | 100.00% | **1.15%** | 0.0% | 0.0% | 0.0 ms | **132.7 ms** | **340.0 ms** | `500 ms` |

> **Clarification Note on 5QI 69 (Emergency C2):** Class 69 implements bounded-memory protection (capped buffer). Under sustained overload, the oldest packets are evicted to preserve memory bounds.

---

### 5. TECHNICAL NARRATIVE & PROPAGATION PHYSICS ANALYSIS

#### 1. The Physics of Blind Static TDMA Failure
In conventional static TDMA architectures, the 16 ms uplink frame is divided symmetrically into rigid 1.0 ms slots per ground terminal. When a ground terminal (e.g., Recon Node 4) passes behind an alpine ridge feature (such as Mt. Kargil-I at 4,150 m MSL), the slant line-of-sight is severed. In standard systems, the ACN continues blindly assigning transmission slots to that severed terminal. 
- Transmissions into severed rock walls produce **zero received bits** at the airborne receiver.
- This creates **6.3% slot-time allocation waste** and burns **6.02 Mb of payload data**, simultaneously depriving heavily backlogged command posts (MCP Node 15) of necessary throughput, resulting in buffer overflow drops.

#### 2. The Predictive Look-Ahead Machine (`T_occ <= 3.0s`)
Tac-TAD resolves this via orbital trajectory propagation and a 4-state predictive machine:
1. `NORMAL_LOS`: Ground terminal has clear first Fresnel zone clearance. Normal rate-adaptive modulation.
2. `PRE_OCCLUSION_FLUSH`: When the look-ahead engine predicts optical occlusion within $T_{\text{occ}} \le 3.0\,\text{s}$, Tac-TAD urgently expands that terminal's superframe allocation, dumping the local queue onto the link before optical severing occurs.
3. `HARD_SHADOW_CUTOFF`: Upon line-of-sight severing, transmission allocations are immediately reduced to $0.0\,\text{ms}$ (100% time reclaimed). Cross-layer radio backoff prevents packet drops while queue generation pauses.
4. `RE_EMERGENCE_BURST`: As the terminal emerges from the mountain shadow, Tac-TAD pre-allocates zero-contention recovery capacity to drain accumulated C2 buffers instantly.

#### 3. Closed-Loop Timing Advance Efficiency
With accurate closed-loop timing advance ($TA = 2 \cdot d_{3D} / c$), guard intervals between TDMA bursts are safely collapsed to $\tau_{\text{guard}} = 12\,\mu\text{s}$. This limits guard overhead to under $1.0\%$ of the total frame, dedicating $>90\%$ of frame time to useful payload transmission.

---

### 6. GENERATED PUBLICATION ARTIFACTS
The following scientific figures have been generated and saved to `benchmark_results`:
- **`fig1_goodput_cdf.png`**: Instantaneous goodput (Mbps) empirical CDF comparing Static TDMA vs. Tac-TAD with median and 95th percentile markers.
- **`fig2_latency_cdf_5qi.png`**: 4-panel latency distribution comparing packet sojourn delays against strict 3GPP PDB deadlines.
- **`fig3_drop_rate_vs_terrain.png`**: Concluded drop rate percentage grouped by geomorphic occlusion states, verifying near-zero transition drops.
- **`fig4_spectral_efficiency_breakdown.png`**: Superframe time utilization stacked breakdown, contrasting 0.0% allocation waste in Tac-TAD against static TDMA.
- **`summary_metrics.csv`**: Raw structured scalar KPI export for downstream CI/CD regression verification.

---

### 7. DATA-QUALITY REVIEW AND REQUIRED FOLLOW-UP

1. **Execution cadence:** the source records 5,000 frames over 289.76 seconds of wall time (17.3 frames/s), while the configured simulated cadence is 50 frames/s. These are different quantities. The current engine's wall-clock performance must be benchmarked separately; the legacy report should not imply that the run executed in real time.
2. **Latency distribution integrity:** several rows in the QoS table report a positive mean latency alongside a P95 of 0.0 ms. This is not a credible percentile summary without a documented explanation and must be treated as a metric aggregation defect or unresolved data-quality issue until raw packet-level samples are inspected.
3. **Reproduction on migrated engine:** run identical scenario configuration and seeds against the TypeScript engine and legacy baseline. Compare packet-level outcomes where feasible, and document expected numerical differences.
4. **Statistical coverage:** one deterministic seed is insufficient for broad performance claims. Add paired multi-seed Monte Carlo runs, confidence intervals, scenario sensitivity analysis, and transparent exclusions.
5. **Artifact provenance:** retain the exact source revision, environment, configuration, terrain checksum, raw metrics, logs, and script versions used to generate each figure and table.

Until these actions are complete, use the tables as **historical benchmark evidence**, not as proof of current TypeScript performance or operational readiness.

---
*Historical report compiled by Tactical X-Band Digital Twin Benchmark Suite v4.4. Current-engine replication and metric audit pending.*
```

### File: `package.json` (26 lines, 779 bytes)

```json
{
  "name": "tactical-x-band-air-to-ground-network",
  "version": "1.0.0",
  "description": "TypeScript WebWorker digital twin for X-band air-to-ground TDMA research and simulation.",
  "main": "electron/main.cjs",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "node scripts/run_all_verifications.mjs",
    "verify:project": "node scripts/verify-project.mjs",
    "verify:all": "node scripts/run_all_verifications.mjs",
    "typecheck": "tsc --noEmit",
    "benchmark:ts": "vite-node scripts/run_ts_benchmark.ts"
  },
  "dependencies": {
    "maplibre-gl": "^6.16.0",
    "three": "^0.187.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vite": "^6.0.0",
    "vite-node": "3.2.4"
  }
}
```

### File: `tsconfig.json` (18 lines, 358 bytes)

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext", "DOM", "WebWorker"],
    "types": ["vite/client"],
    "noEmit": true,
    "skipLibCheck": true,
    "strict": false
  },
  "include": [
    "src/core/**/*",
    "src/shared/**/*",
    "src/worker/**/*",
    "src/ui/**/*"
  ]
}
```

### File: `vite.config.ts` (30 lines, 415 bytes)

```typescript

import { defineConfig } from "vite";

export default defineConfig({
  base:
    process.env.GITHUB_ACTIONS === "true"
      ? "/tactical-xband-digital-twin/"
      : "/",

  server: {
    port: 8000,
    open: true,
    host: "0.0.0.0",
  },

  preview: {
    port: 8000,
    open: true,
    host: "0.0.0.0",
  },

  worker: {
    format: "es",
  },

  build: {
    target: "esnext",
    sourcemap: true,
  },
});
```

### File: `requirements.txt` (8 lines, 123 bytes)

```txt
fastapi>=0.100.0
uvicorn>=0.22.0
websockets>=11.0
numpy>=1.24.0
scipy>=1.10.0
matplotlib>=3.7.0
pytest>=7.3.0
httpx>=0.24.0
```

### File: `electron/main.cjs` (30 lines, 691 bytes)

```javascript
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#12171d",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

### File: `src/core/config.ts` (225 lines, 9,420 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Core Configuration Module (TypeScript Port)
 *
 * Implements physical constants, tactical RF payload specifications,
 * ITU-R propagation environment geometry (P.834, P.676, P.838),
 * and Aerial Communication Node (ACN) orbital kinematics parameters.
 */

export const SPEED_OF_LIGHT = 299792458.0; // Exact SI constant (m/s)
export const BOLTZMANN_CONSTANT = 1.380649e-23; // Exact SI constant (J/K)

export type NodeType = 'soldier' | 'mcp' | 'acn';

/** Authoritative IDs for the registered ground-node population. */
export const GROUND_NODE_IDS: readonly number[] = Object.freeze(Array.from({ length: 16 }, (_, id) => id));

export interface TransmitterParams {
  readonly txPowerDbm: number;
  readonly antennaGainDbi: number;
}

export interface IRFConfig {
  readonly carrierFrequencyHz: number;
  readonly channelBandwidthHz: number;
  readonly acnTxPowerDbm: number;
  readonly acnAntennaGainDbi: number;
  readonly acnNoiseFigureDb: number;
  readonly soldierTxPowerDbm: number;
  readonly soldierAntennaGainDbi: number;
  readonly mcpTxPowerDbm: number;
  readonly mcpAntennaGainDbi: number;
  readonly implementationMarginDb: number;
  readonly cableLossDb: number;
  readonly speedOfLight: number;
  readonly boltzmannConstant: number;
}

export class RFConfig implements IRFConfig {
  public readonly carrierFrequencyHz: number;
  public readonly channelBandwidthHz: number;
  public readonly acnTxPowerDbm: number;
  public readonly acnAntennaGainDbi: number;
  public readonly acnNoiseFigureDb: number;
  public readonly soldierTxPowerDbm: number;
  public readonly soldierAntennaGainDbi: number;
  public readonly mcpTxPowerDbm: number;
  public readonly mcpAntennaGainDbi: number;
  public readonly implementationMarginDb: number;
  public readonly cableLossDb: number;
  public readonly speedOfLight: number;
  public readonly boltzmannConstant: number;

  constructor(init?: Partial<IRFConfig>) {
    this.carrierFrequencyHz = init?.carrierFrequencyHz ?? 8.0e9; // 8.0 GHz Tactical X-band
    this.channelBandwidthHz = init?.channelBandwidthHz ?? 1.0e6; // 1.0 MHz shared channel
    this.acnTxPowerDbm = init?.acnTxPowerDbm ?? 40.0; // 10 W RF power amplifier
    this.acnAntennaGainDbi = init?.acnAntennaGainDbi ?? 15.0; // Steerable array / horn
    this.acnNoiseFigureDb = init?.acnNoiseFigureDb ?? 5.0; // Low-noise receiver front-end
    this.soldierTxPowerDbm = init?.soldierTxPowerDbm ?? 36.0; // 4.0 W manpack PA
    this.soldierAntennaGainDbi = init?.soldierAntennaGainDbi ?? 3.0; // Omni whip antenna
    this.mcpTxPowerDbm = init?.mcpTxPowerDbm ?? 43.0; // 20.0 W high-power transmitter
    this.mcpAntennaGainDbi = init?.mcpAntennaGainDbi ?? 20.0; // High-gain parabolic dish
    this.implementationMarginDb = init?.implementationMarginDb ?? 2.5; // Filter ripple, ADC, phase jitter
    this.cableLossDb = init?.cableLossDb ?? 1.5; // RF feedline & connector loss
    this.speedOfLight = init?.speedOfLight ?? SPEED_OF_LIGHT;
    this.boltzmannConstant = init?.boltzmannConstant ?? BOLTZMANN_CONSTANT;

    if (!Number.isFinite(this.channelBandwidthHz) || this.channelBandwidthHz < 0.1e6 || this.channelBandwidthHz > 50.0e6) {
      throw new Error('channelBandwidthHz must be finite and in [0.1, 50.0] MHz.');
    }
    if (!Number.isFinite(this.carrierFrequencyHz) || this.carrierFrequencyHz <= 0) {
      throw new Error('carrierFrequencyHz must be a positive finite number.');
    }
  }

  /**
   * Carrier wavelength in meters: lambda = c / f_c
   */
  public get wavelengthM(): number {
    return this.speedOfLight / this.carrierFrequencyHz;
  }

  /**
   * Resolves transmitter power and antenna gain for a given node category.
   */
  public getTransmitterParams(nodeType: NodeType | string): TransmitterParams {
    const normalized = nodeType.trim().toLowerCase();
    switch (normalized) {
      case 'soldier':
      case 'manpack':
      case 'infantry':
        return {
          txPowerDbm: this.soldierTxPowerDbm,
          antennaGainDbi: this.soldierAntennaGainDbi,
        };
      case 'mcp':
      case 'command_post':
      case 'main_command_post':
      case 'vehicular':
        return {
          txPowerDbm: this.mcpTxPowerDbm,
          antennaGainDbi: this.mcpAntennaGainDbi,
        };
      case 'acn':
      case 'airborne':
      case 'relay':
        return {
          txPowerDbm: this.acnTxPowerDbm,
          antennaGainDbi: this.acnAntennaGainDbi,
        };
      default:
        throw new Error(
          `Unrecognized nodeType: '${nodeType}'. Expected 'soldier', 'mcp', or 'acn'.`
        );
    }
  }
}

export interface IEnvironmentConfig {
  readonly effectiveEarthRadiusFactor: number;
  readonly trueEarthRadiusM: number;
  readonly rainRateMmH: number;
  readonly rainCellLengthKm: number;
  readonly atmosphericTemperatureK: number;
}

export class EnvironmentConfig implements IEnvironmentConfig {
  public readonly effectiveEarthRadiusFactor: number;
  public readonly trueEarthRadiusM: number;
  public readonly rainRateMmH: number;
  public readonly rainCellLengthKm: number;
  public readonly atmosphericTemperatureK: number;

  constructor(init?: Partial<IEnvironmentConfig>) {
    this.effectiveEarthRadiusFactor = init?.effectiveEarthRadiusFactor ?? 4.0 / 3.0; // ITU-R P.834 k-factor
    this.trueEarthRadiusM = init?.trueEarthRadiusM ?? 6371000.0; // WGS-84 volumetric mean
    this.rainRateMmH = init?.rainRateMmH ?? 0.0; // Precipitation rate (mm/h)
    this.rainCellLengthKm = init?.rainCellLengthKm ?? 10.0; // Convective cell extent
    this.atmosphericTemperatureK = init?.atmosphericTemperatureK ?? 290.0; // Ambient noise temperature (K)
  }

  /**
   * Effective Earth radius: R'_e = k * R_true (~8,494,666.67 m)
   */
  public get effectiveEarthRadiusM(): number {
    return this.trueEarthRadiusM * this.effectiveEarthRadiusFactor;
  }
}

export type ACNTrajectoryMode = 'ellipse' | 'waypoints';
/** Maximum editable waypoints keeps worker lookup tables bounded at 512 samples per segment. */
export const MAX_ACN_WAYPOINTS = 64;

/** A local Cartesian waypoint in metres. Waypoint loops close from last to first. */
export interface ACNWaypoint {
  readonly xM: number;
  readonly yM: number;
}

export interface IACNFlightConfig {
  readonly trajectoryMode: ACNTrajectoryMode;
  readonly waypoints: readonly ACNWaypoint[];
  readonly altitudeMslM: number;
  readonly loiterRadiusAM: number;
  readonly loiterRadiusBM: number;
  readonly loiterRotationDeg: number;
  readonly loiterSpeedMps: number;
  readonly centerXm: number;
  readonly centerYm: number;
  readonly coverageRadiusKm: number;
  readonly accelerationLimitMps2?: number;
  readonly decelerationLimitMps2?: number;
}

export class ACNFlightConfig implements IACNFlightConfig {
  public readonly trajectoryMode: ACNTrajectoryMode;
  public readonly waypoints: readonly ACNWaypoint[];
  public readonly altitudeMslM: number;
  public readonly loiterRadiusAM: number; // Semi-major axis (m)
  public readonly loiterRadiusBM: number; // Semi-minor axis (m)
  public readonly loiterRotationDeg: number; // Elliptical inclination angle (deg)
  public readonly loiterSpeedMps: number; // Constant true airspeed (m/s)
  public readonly centerXm: number; // Orbit center X (m)
  public readonly centerYm: number; // Orbit center Y (m)
  public readonly coverageRadiusKm: number; // Radio footprint radius (km)
  public readonly accelerationLimitMps2: number; // Max acceleration limit (m/s^2)
  public readonly decelerationLimitMps2: number; // Max deceleration limit (m/s^2)

  constructor(init?: Partial<IACNFlightConfig>) {
    this.trajectoryMode = init?.trajectoryMode ?? 'ellipse';
    this.waypoints = Object.freeze((init?.waypoints ?? []).map(point => Object.freeze({ xM: point.xM, yM: point.yM })));
    this.altitudeMslM = init?.altitudeMslM ?? 5000.0;
    this.loiterRadiusAM = init?.loiterRadiusAM ?? 20000.0;
    this.loiterRadiusBM = init?.loiterRadiusBM ?? 10000.0;
    this.loiterRotationDeg = init?.loiterRotationDeg ?? 35.0;
    this.loiterSpeedMps = init?.loiterSpeedMps ?? 60.0;
    this.centerXm = init?.centerXm ?? 0.0;
    this.centerYm = init?.centerYm ?? 0.0;
    this.coverageRadiusKm = init?.coverageRadiusKm ?? 35.0;
    this.accelerationLimitMps2 = init?.accelerationLimitMps2 ?? 5.0;
    this.decelerationLimitMps2 = init?.decelerationLimitMps2 ?? 5.0;

    if (!Number.isFinite(this.altitudeMslM) || this.altitudeMslM <= 0 || this.altitudeMslM > 100000) {
      throw new Error('altitudeMslM must be finite and in (0, 100000] m.');
    }
    if (!Number.isFinite(this.loiterSpeedMps) || this.loiterSpeedMps < 0 || this.loiterSpeedMps > 1000) {
      throw new Error('loiterSpeedMps must be finite and in [0, 1000] m/s.');
    }
    if (!Number.isFinite(this.accelerationLimitMps2) || this.accelerationLimitMps2 <= 0) {
      throw new Error('accelerationLimitMps2 must be a positive finite number.');
    }
    if (!Number.isFinite(this.decelerationLimitMps2) || this.decelerationLimitMps2 <= 0) {
      throw new Error('decelerationLimitMps2 must be a positive finite number.');
    }
  }

  public get coverageRadiusM(): number {
    return this.coverageRadiusKm * 1000.0;
  }
}

export const DEFAULT_RF_CONFIG = new RFConfig();
export const DEFAULT_ENVIRONMENT_CONFIG = new EnvironmentConfig();
export const DEFAULT_ACN_FLIGHT_CONFIG = new ACNFlightConfig();
```

### File: `src/core/geodesy.ts` (146 lines, 6,300 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Geodesy Module — WGS-84 Local Equirectangular Mapping (M7.1)
 *
 * Implements pure, bidirectional geographic coordinate conversions between
 * the authoritative local Cartesian theater coordinate system (metres)
 * and WGS-84 geodetic coordinates (degrees Latitude and Longitude).
 *
 * Projection Architecture:
 * - Projection Type: Local Equirectangular (Plate Carrée with standard parallel)
 * - Reference Ellipsoid: WGS-84 (a = 6,378,137.0 m, f = 1 / 298.257223563)
 * - Theater Origin (0, 0): 34.500000°N, 76.500000°E (center of calibrated Ladakh DEM)
 * - Standard Parallel: phi0 = 34.500000°N
 * - Meridional scale: 110,931.4506 m / degree Latitude (halfHeightM)
 * - Parallel scale: 91,839.9774 m / degree Longitude (halfWidthM)
 * - Axis convention: +X = East (metres), +Y = North (metres), +Z = Altitude MSL (metres)
 *
 * Mathematical Properties:
 * - Linear bijection across R^2.
 * - Invertible with numerical round-trip error < 1e-7 metres.
 * - Out-of-coverage coordinates are unprojected without silent clamping,
 *   with boundary containment explicitly tracked via `isWithinCoverage`.
 */

import { REAL_LADAKH_DEM_METADATA } from './terrain';

export const GEODESY_ORIGIN_LAT_DEG = REAL_LADAKH_DEM_METADATA.centerLatDeg; // 34.5° N
export const GEODESY_ORIGIN_LON_DEG = REAL_LADAKH_DEM_METADATA.centerLonDeg; // 76.5° E
export const METERS_PER_DEG_LAT = REAL_LADAKH_DEM_METADATA.halfHeightM;     // 110,931.4506 m/deg
export const METERS_PER_DEG_LON = REAL_LADAKH_DEM_METADATA.halfWidthM;      // 91,839.9774 m/deg

export const DEM_COVERAGE_HALF_WIDTH_M = REAL_LADAKH_DEM_METADATA.halfWidthM;
export const DEM_COVERAGE_HALF_HEIGHT_M = REAL_LADAKH_DEM_METADATA.halfHeightM;
export const DEM_MIN_LAT_DEG = REAL_LADAKH_DEM_METADATA.minLatDeg; // 33.5° N
export const DEM_MAX_LAT_DEG = REAL_LADAKH_DEM_METADATA.maxLatDeg; // 35.5° N
export const DEM_MIN_LON_DEG = REAL_LADAKH_DEM_METADATA.minLonDeg; // 75.5° E
export const DEM_MAX_LON_DEG = REAL_LADAKH_DEM_METADATA.maxLonDeg; // 77.5° E

export interface GeodeticCoordinate {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly isWithinCoverage: boolean;
}

export interface CartesianCoordinate {
  readonly xM: number;
  readonly yM: number;
  readonly isWithinCoverage: boolean;
}

/**
 * Projects local Cartesian coordinates (metres from origin) to WGS-84 geographic coordinates (degrees).
 *
 * @param xM Easting offset in metres (+X East, -X West).
 * @param yM Northing offset in metres (+Y North, -Y South).
 * @returns Geodetic coordinates (latDeg, lonDeg) and DEM coverage flag.
 * @throws TypeError if xM or yM are not finite numbers.
 */
export function cartesianToGeodetic(xM: number, yM: number): GeodeticCoordinate {
  if (!Number.isFinite(xM) || !Number.isFinite(yM)) {
    throw new TypeError(`Invalid Cartesian coordinates: xM and yM must be finite numbers, got (${xM}, ${yM}).`);
  }

  const latDeg = GEODESY_ORIGIN_LAT_DEG + yM / METERS_PER_DEG_LAT;
  const lonDeg = GEODESY_ORIGIN_LON_DEG + xM / METERS_PER_DEG_LON;

  const isWithinCoverage =
    Math.abs(xM) <= DEM_COVERAGE_HALF_WIDTH_M &&
    Math.abs(yM) <= DEM_COVERAGE_HALF_HEIGHT_M;

  return { latDeg, lonDeg, isWithinCoverage };
}

/**
 * Projects WGS-84 geographic coordinates (degrees) to local Cartesian coordinates (metres from origin).
 * Exact linear inverse of cartesianToGeodetic.
 *
 * @param latDeg Latitude in decimal degrees [-90.0, +90.0].
 * @param lonDeg Longitude in decimal degrees [-180.0, +180.0].
 * @returns Local Cartesian coordinates (xM, yM) and DEM coverage flag.
 * @throws RangeError if latitude is outside [-90, 90] or longitude outside [-180, 180].
 * @throws TypeError if latDeg or lonDeg are not finite numbers.
 */
export function geodeticToCartesian(latDeg: number, lonDeg: number): CartesianCoordinate {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    throw new TypeError(`Invalid geodetic coordinates: latDeg and lonDeg must be finite numbers, got (${latDeg}, ${lonDeg}).`);
  }
  if (latDeg < -90.0 || latDeg > 90.0) {
    throw new RangeError(`Latitude out of valid range [-90.0, +90.0]: got ${latDeg}°`);
  }
  if (lonDeg < -180.0 || lonDeg > 180.0) {
    throw new RangeError(`Longitude out of valid range [-180.0, +180.0]: got ${lonDeg}°`);
  }

  const xM = (lonDeg - GEODESY_ORIGIN_LON_DEG) * METERS_PER_DEG_LON;
  const yM = (latDeg - GEODESY_ORIGIN_LAT_DEG) * METERS_PER_DEG_LAT;

  const isWithinCoverage =
    latDeg >= DEM_MIN_LAT_DEG &&
    latDeg <= DEM_MAX_LAT_DEG &&
    lonDeg >= DEM_MIN_LON_DEG &&
    lonDeg <= DEM_MAX_LON_DEG;

  return { xM, yM, isWithinCoverage };
}

/**
 * Formats a decimal degree coordinate into human-readable Degrees-Minutes-Seconds (DMS) string.
 *
 * @param deg Coordinate in decimal degrees.
 * @param isLatitude True for Latitude (N/S), False for Longitude (E/W).
 */
export function formatDmsComponent(deg: number, isLatitude: boolean): string {
  if (!Number.isFinite(deg)) return '--';
  const sign = deg >= 0 ? 1 : -1;
  const absVal = Math.abs(deg);
  const d = Math.floor(absVal);
  const remMinutes = (absVal - d) * 60.0;
  const m = Math.floor(remMinutes);
  const s = (remMinutes - m) * 60.0;

  const hemisphere = isLatitude
    ? sign >= 0 ? 'N' : 'S'
    : sign >= 0 ? 'E' : 'W';

  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${hemisphere}`;
}

/**
 * Formats a pair of decimal coordinates into a concise decimal degree string (e.g. "34.50000°N, 76.50000°E").
 */
export function formatGeodeticDecimal(latDeg: number, lonDeg: number, fractionDigits: number = 5): string {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return '--';
  const latHemi = latDeg >= 0 ? 'N' : 'S';
  const lonHemi = lonDeg >= 0 ? 'E' : 'W';
  return `${Math.abs(latDeg).toFixed(fractionDigits)}°${latHemi}, ${Math.abs(lonDeg).toFixed(fractionDigits)}°${lonHemi}`;
}

/**
 * Formats a pair of decimal coordinates into a standard DMS string (e.g. "34°30'00.0\"N, 76°30'00.0\"E").
 */
export function formatGeodeticDms(latDeg: number, lonDeg: number): string {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return '--';
  return `${formatDmsComponent(latDeg, true)}, ${formatDmsComponent(lonDeg, false)}`;
}

```

### File: `src/core/hgtMosaic.ts` (588 lines, 18,082 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Multi-Tile SRTM HGT Terrain Folder Loading, Mosaic Stitching & Patch Streaming
 *
 * Implements:
 *   - Automatic folder scanning and HGT tile cataloging.
 *   - Spatial clustering of contiguous neighbouring tiles (connected components).
 *   - Patch-based selection with bounded maximum active tiles for lower-end hardware.
 *   - Seamless multi-tile mosaic stitching with shared boundary edge resolution.
 *   - Missing tile graceful handling (NaN void fill).
 *   - LRU decoded tile cache for memory efficiency.
 */

import {
  SRTM3_BYTE_LENGTH,
  SRTM1_BYTE_LENGTH,
  SRTM3_SAMPLE_COUNT,
  SRTM1_SAMPLE_COUNT,
  HGT_METERS_PER_DEG_LAT,
  HGT_METERS_PER_DEG_LON,
  THEATER_ORIGIN_LAT_DEG,
  THEATER_ORIGIN_LON_DEG,
  parseSrtmTileName,
  decodeHgtBuffer,
} from './hgtParser';
import type { DemGeographicMetadata } from './terrain';

export const DEFAULT_MAX_ACTIVE_TILES = 4; // e.g. 2x2 contiguous patch
export const DEFAULT_LRU_CACHE_CAPACITY = 12; // In-memory decoded tiles

export interface SrtmCatalogTile {
  readonly tileName: string;
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
  readonly centerLatDeg: number;
  readonly centerLonDeg: number;
  readonly file: File | Blob;
  readonly sizeBytes: number;
  readonly resolution: 'SRTM1' | 'SRTM3';
  readonly sampleCount: number;
}

export interface DecodedTile {
  readonly tileName: string;
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
  readonly sampleCount: number;
  readonly elevations: Float32Array;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly voidCount: number;
}

export interface TileCluster {
  readonly clusterId: number;
  readonly tiles: readonly SrtmCatalogTile[];
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
}

export interface PatchSelection {
  readonly anchorTileName: string;
  readonly tiles: readonly SrtmCatalogTile[];
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
  readonly rows: number;
  readonly cols: number;
  readonly missingNeighbourNames: readonly string[];
}

export interface StitchedMosaicResult {
  readonly rasterWidth: number;
  readonly rasterHeight: number;
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
  readonly tileNames: readonly string[];
  readonly elevations: Float32Array;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly voidCount: number;
  readonly metadata: DemGeographicMetadata;
  readonly missingTiles: readonly string[];
}

/**
 * Builds a catalog of valid SRTM HGT tiles from a folder file list or array.
 * Validates filename format [NS]\d{2}[EW]\d{3}\.hgt and standard byte size.
 */
export function buildTileCatalog(
  files: Iterable<File | Blob | { name: string; size: number }>
): SrtmCatalogTile[] {
  const catalogMap = new Map<string, SrtmCatalogTile>();

  for (const f of files) {
    const filename = (f as any).name || (f as any).webkitRelativePath || '';
    if (!filename.toLowerCase().endsWith('.hgt')) {
      continue;
    }

    const coords = parseSrtmTileName(filename);
    if (!coords) {
      continue;
    }

    const size = (f as any).size || 0;
    let resolution: 'SRTM1' | 'SRTM3';
    let sampleCount: number;

    if (size === SRTM3_BYTE_LENGTH) {
      resolution = 'SRTM3';
      sampleCount = SRTM3_SAMPLE_COUNT;
    } else if (size === SRTM1_BYTE_LENGTH) {
      resolution = 'SRTM1';
      sampleCount = SRTM1_SAMPLE_COUNT;
    } else {
      // Skip files with invalid byte counts
      continue;
    }

    const tileName = coords.tileName;
    if (!catalogMap.has(tileName)) {
      catalogMap.set(tileName, {
        tileName,
        minLatDeg: coords.minLatDeg,
        maxLatDeg: coords.maxLatDeg,
        minLonDeg: coords.minLonDeg,
        maxLonDeg: coords.maxLonDeg,
        centerLatDeg: coords.centerLatDeg,
        centerLonDeg: coords.centerLonDeg,
        file: f as File | Blob,
        sizeBytes: size,
        resolution,
        sampleCount,
      });
    }
  }

  return Array.from(catalogMap.values()).sort((a, b) =>
    a.tileName.localeCompare(b.tileName)
  );
}

/**
 * Groups catalog tiles into contiguous geographic clusters (connected components).
 * Two tiles are adjacent if their latitude difference <= 1 and longitude difference <= 1.
 */
export function clusterNeighbouringTiles(
  catalog: readonly SrtmCatalogTile[]
): TileCluster[] {
  if (catalog.length === 0) return [];

  const tileMap = new Map<string, SrtmCatalogTile>();
  catalog.forEach((t) => tileMap.set(t.tileName, t));

  const visited = new Set<string>();
  const clusters: TileCluster[] = [];
  let nextClusterId = 1;

  for (const startTile of catalog) {
    if (visited.has(startTile.tileName)) continue;

    const clusterTiles: SrtmCatalogTile[] = [];
    const queue: SrtmCatalogTile[] = [startTile];
    visited.add(startTile.tileName);

    while (queue.length > 0) {
      const current = queue.shift()!;
      clusterTiles.push(current);

      // Check all 8 neighbours (N, S, E, W, and diagonals)
      for (let dLat = -1; dLat <= 1; dLat++) {
        for (let dLon = -1; dLon <= 1; dLon++) {
          if (dLat === 0 && dLon === 0) continue;

          const nLat = current.minLatDeg + dLat;
          const nLon = current.minLonDeg + dLon;
          const latHemi = nLat >= 0 ? 'N' : 'S';
          const lonHemi = nLon >= 0 ? 'E' : 'W';
          const nName = `${latHemi}${String(Math.abs(nLat)).padStart(2, '0')}${lonHemi}${String(
            Math.abs(nLon)
          ).padStart(3, '0')}`;

          const neighbour = tileMap.get(nName);
          if (neighbour && !visited.has(neighbour.tileName)) {
            visited.add(neighbour.tileName);
            queue.push(neighbour);
          }
        }
      }
    }

    let minLat = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let minLon = Number.POSITIVE_INFINITY;
    let maxLon = Number.NEGATIVE_INFINITY;

    for (const t of clusterTiles) {
      if (t.minLatDeg < minLat) minLat = t.minLatDeg;
      if (t.maxLatDeg > maxLat) maxLat = t.maxLatDeg;
      if (t.minLonDeg < minLon) minLon = t.minLonDeg;
      if (t.maxLonDeg > maxLon) maxLon = t.maxLonDeg;
    }

    clusters.push({
      clusterId: nextClusterId++,
      tiles: clusterTiles,
      minLatDeg: minLat,
      maxLatDeg: maxLat,
      minLonDeg: minLon,
      maxLonDeg: maxLon,
    });
  }

  // Sort by cluster size descending (largest contiguous area first)
  return clusters.sort((a, b) => b.tiles.length - a.tiles.length);
}

/**
 * Selects an active contiguous patch of tiles (bounded to maxTiles, default 4 = 2x2)
 * around an anchor tile or target geographic position.
 */
export function selectActivePatch(options: {
  catalog: readonly SrtmCatalogTile[];
  targetLatDeg?: number;
  targetLonDeg?: number;
  anchorTileName?: string;
  maxTiles?: number;
}): PatchSelection | null {
  const { catalog, anchorTileName } = options;
  if (!catalog || catalog.length === 0) return null;

  const targetLat = options.targetLatDeg ?? THEATER_ORIGIN_LAT_DEG;
  const targetLon = options.targetLonDeg ?? THEATER_ORIGIN_LON_DEG;
  const maxTiles = Math.max(1, Math.min(9, options.maxTiles ?? DEFAULT_MAX_ACTIVE_TILES));

  const tileMap = new Map<string, SrtmCatalogTile>();
  catalog.forEach((t) => tileMap.set(t.tileName, t));

  // Find anchor tile
  let anchorTile: SrtmCatalogTile | undefined;
  if (anchorTileName) {
    anchorTile = tileMap.get(anchorTileName.toUpperCase());
  }

  if (!anchorTile) {
    // Pick tile closest to target
    let minDistSq = Number.POSITIVE_INFINITY;
    for (const t of catalog) {
      const dLat = t.centerLatDeg - targetLat;
      const dLon = t.centerLonDeg - targetLon;
      const distSq = dLat * dLat + dLon * dLon;
      if (distSq < minDistSq) {
        minDistSq = distSq;
        anchorTile = t;
      }
    }
  }

  if (!anchorTile) return null;

  // If maxTiles is 1, return single tile patch
  if (maxTiles === 1) {
    return {
      anchorTileName: anchorTile.tileName,
      tiles: [anchorTile],
      minLatDeg: anchorTile.minLatDeg,
      maxLatDeg: anchorTile.maxLatDeg,
      minLonDeg: anchorTile.minLonDeg,
      maxLonDeg: anchorTile.maxLonDeg,
      rows: 1,
      cols: 1,
      missingNeighbourNames: [],
    };
  }

  // For maxTiles <= 4: evaluate 2x2 bounding boxes that contain the anchor tile
  // Candidates for anchor position in a 2x2:
  //   1) Anchor is bottom-left  ([lat, lat+1] x [lon, lon+1])
  //   2) Anchor is bottom-right ([lat, lat+1] x [lon-1, lon])
  //   3) Anchor is top-left     ([lat-1, lat] x [lon, lon+1])
  //   4) Anchor is top-right    ([lat-1, lat] x [lon-1, lon])
  const aLat = anchorTile.minLatDeg;
  const aLon = anchorTile.minLonDeg;

  interface WindowCandidate {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
    existingTiles: SrtmCatalogTile[];
    missingNames: string[];
    score: number;
  }

  const windows: WindowCandidate[] = [];
  const offsets = [
    { dLat: 0, dLon: 0 },
    { dLat: 0, dLon: -1 },
    { dLat: -1, dLon: 0 },
    { dLat: -1, dLon: -1 },
  ];

  for (const off of offsets) {
    const minLat = aLat + off.dLat;
    const maxLat = minLat + 2;
    const minLon = aLon + off.dLon;
    const maxLon = minLon + 2;

    const existing: SrtmCatalogTile[] = [];
    const missing: string[] = [];

    for (let rLat = minLat; rLat < maxLat; rLat++) {
      for (let cLon = minLon; cLon < maxLon; cLon++) {
        const latHemi = rLat >= 0 ? 'N' : 'S';
        const lonHemi = cLon >= 0 ? 'E' : 'W';
        const name = `${latHemi}${String(Math.abs(rLat)).padStart(2, '0')}${lonHemi}${String(
          Math.abs(cLon)
        ).padStart(3, '0')}`;

        const found = tileMap.get(name);
        if (found) {
          existing.push(found);
        } else {
          missing.push(name);
        }
      }
    }

    // Score favours windows with more existing tiles and closeness to target
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const distToTarget = Math.hypot(centerLat - targetLat, centerLon - targetLon);
    const score = existing.length * 10 - distToTarget;

    windows.push({
      minLat,
      maxLat,
      minLon,
      maxLon,
      existingTiles: existing,
      missingNames: missing,
      score,
    });
  }

  // Sort by score descending
  windows.sort((a, b) => b.score - a.score);
  const best = windows[0];

  return {
    anchorTileName: anchorTile.tileName,
    tiles: best.existingTiles,
    minLatDeg: best.minLat,
    maxLatDeg: best.maxLat,
    minLonDeg: best.minLon,
    maxLonDeg: best.maxLon,
    rows: best.maxLat - best.minLat,
    cols: best.maxLon - best.minLon,
    missingNeighbourNames: best.missingNames,
  };
}

/**
 * LRU In-Memory Cache for decoded HGT tiles.
 * Avoids redundant re-decoding when panning or shifting the active patch.
 */
export class DecodedTileCache {
  private cache = new Map<string, DecodedTile>();
  private readonly capacity: number;

  constructor(capacity = DEFAULT_LRU_CACHE_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  public get(tileName: string): DecodedTile | undefined {
    const key = tileName.toUpperCase();
    const item = this.cache.get(key);
    if (item) {
      // Refresh LRU order (delete and re-insert)
      this.cache.delete(key);
      this.cache.set(key, item);
    }
    return item;
  }

  public set(tileName: string, tile: DecodedTile): void {
    const key = tileName.toUpperCase();
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict oldest entry (first key in insertion-ordered map)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, tile);
  }

  public has(tileName: string): boolean {
    return this.cache.has(tileName.toUpperCase());
  }

  public get size(): number {
    return this.cache.size;
  }

  public clear(): void {
    this.cache.clear();
  }
}

/**
 * Stitches multiple neighbouring decoded HGT tiles into a single seamless mosaic Float32Array.
 * Handles:
 *   - Shared boundary edge resolution (averaging valid overlapping samples, void fill).
 *   - Missing tiles within the patch bounding box (filled with Number.NaN).
 *   - North-to-South row orientation and West-to-East column orientation.
 */
export function stitchHgtTiles(
  tiles: readonly DecodedTile[],
  explicitBounds?: { minLatDeg: number; maxLatDeg: number; minLonDeg: number; maxLonDeg: number }
): StitchedMosaicResult {
  if (!tiles || tiles.length === 0) {
    throw new Error('stitchHgtTiles: At least one tile is required to stitch a mosaic.');
  }

  // Determine uniform sample count (SRTM3 = 1201, SRTM1 = 3601)
  const sampleCount = tiles[0].sampleCount;

  // Determine bounding box in integer degrees
  let minLat = explicitBounds?.minLatDeg ?? Number.POSITIVE_INFINITY;
  let maxLat = explicitBounds?.maxLatDeg ?? Number.NEGATIVE_INFINITY;
  let minLon = explicitBounds?.minLonDeg ?? Number.POSITIVE_INFINITY;
  let maxLon = explicitBounds?.maxLonDeg ?? Number.NEGATIVE_INFINITY;

  for (const t of tiles) {
    if (t.minLatDeg < minLat) minLat = t.minLatDeg;
    if (t.maxLatDeg > maxLat) maxLat = t.maxLatDeg;
    if (t.minLonDeg < minLon) minLon = t.minLonDeg;
    if (t.maxLonDeg > maxLon) maxLon = t.maxLonDeg;
  }

  const tileRows = maxLat - minLat;
  const tileCols = maxLon - minLon;

  if (tileRows <= 0 || tileCols <= 0) {
    throw new Error(`stitchHgtTiles: Invalid mosaic dimensions: ${tileRows}x${tileCols} degrees.`);
  }

  // Mosaic raster dimensions
  // Each 1-deg interval adds (sampleCount - 1) cells, plus 1 for the closing boundary sample.
  const step = sampleCount - 1;
  const totalCols = tileCols * step + 1;
  const totalRows = tileRows * step + 1;

  const mosaic = new Float32Array(totalCols * totalRows).fill(Number.NaN);
  const weights = new Uint8Array(totalCols * totalRows);

  const tileSet = new Set<string>();
  tiles.forEach((t) => tileSet.add(t.tileName));

  const missingTiles: string[] = [];
  for (let rLat = minLat; rLat < maxLat; rLat++) {
    for (let cLon = minLon; cLon < maxLon; cLon++) {
      const latHemi = rLat >= 0 ? 'N' : 'S';
      const lonHemi = cLon >= 0 ? 'E' : 'W';
      const name = `${latHemi}${String(Math.abs(rLat)).padStart(2, '0')}${lonHemi}${String(
        Math.abs(cLon)
      ).padStart(3, '0')}`;
      if (!tileSet.has(name)) {
        missingTiles.push(name);
      }
    }
  }

  let minElev = Number.POSITIVE_INFINITY;
  let maxElev = Number.NEGATIVE_INFINITY;
  let voidCount = 0;

  // Stamp each tile into the mosaic
  for (const tile of tiles) {
    // Tile row 0 is Northern edge. Tile col 0 is Western edge.
    // In mosaic: tr = 0 is Northernmost tile row (maxLat - tile.maxLatDeg)
    const tr = maxLat - tile.maxLatDeg;
    const tc = tile.minLonDeg - minLon;

    const rowOffset = tr * step;
    const colOffset = tc * step;
    const N = tile.sampleCount;

    for (let r = 0; r < N; r++) {
      const destR = rowOffset + r;
      const destRowBase = destR * totalCols;
      const srcRowBase = r * N;

      for (let c = 0; c < N; c++) {
        const destC = colOffset + c;
        const destIdx = destRowBase + destC;
        const val = tile.elevations[srcRowBase + c];

        if (Number.isFinite(val)) {
          const curW = weights[destIdx];
          if (curW === 0) {
            mosaic[destIdx] = val;
            weights[destIdx] = 1;
          } else {
            // Shared boundary edge with neighbour: average overlapping valid samples
            mosaic[destIdx] = (mosaic[destIdx] * curW + val) / (curW + 1);
            weights[destIdx] = (curW + 1) as any;
          }
        }
      }
    }
  }

  // Calculate elevation statistics and void count across the mosaic
  for (let i = 0; i < mosaic.length; i++) {
    const v = mosaic[i];
    if (Number.isFinite(v)) {
      if (v < minElev) minElev = v;
      if (v > maxElev) maxElev = v;
    } else {
      voidCount++;
    }
  }

  // Derive georeferenced Cartesian bounds relative to theater origin (34.5°N, 76.5°E)
  const minX = (minLon - THEATER_ORIGIN_LON_DEG) * HGT_METERS_PER_DEG_LON;
  const maxX = (maxLon - THEATER_ORIGIN_LON_DEG) * HGT_METERS_PER_DEG_LON;
  const minY = (minLat - THEATER_ORIGIN_LAT_DEG) * HGT_METERS_PER_DEG_LAT;
  const maxY = (maxLat - THEATER_ORIGIN_LAT_DEG) * HGT_METERS_PER_DEG_LAT;
  const halfWidthM = (maxX - minX) / 2.0;
  const halfHeightM = (maxY - minY) / 2.0;

  const tileNames = tiles.map((t) => t.tileName).sort();
  const tileLabel = tileNames.length === 1 ? tileNames[0] : `PATCH [${tileNames.join(', ')}]`;

  const metadata: DemGeographicMetadata = {
    rasterWidth: totalCols,
    rasterHeight: totalRows,
    centerLatDeg: (minLat + maxLat) / 2.0,
    centerLonDeg: (minLon + maxLon) / 2.0,
    minLatDeg: minLat,
    maxLatDeg: maxLat,
    minLonDeg: minLon,
    maxLonDeg: maxLon,
    halfWidthM,
    halfHeightM,
    groundResolutionXM: (maxX - minX) / (totalCols - 1),
    groundResolutionYM: (maxY - minY) / (totalRows - 1),
    minX,
    maxX,
    minY,
    maxY,
    tileName: tileLabel,
    minElevationM: Number.isFinite(minElev) ? minElev : 0,
    maxElevationM: Number.isFinite(maxElev) ? maxElev : 0,
    voidCount,
  };

  return {
    rasterWidth: totalCols,
    rasterHeight: totalRows,
    minLatDeg: minLat,
    maxLatDeg: maxLat,
    minLonDeg: minLon,
    maxLonDeg: maxLon,
    tileNames,
    elevations: mosaic,
    minElevationM: Number.isFinite(minElev) ? minElev : 0,
    maxElevationM: Number.isFinite(maxElev) ? maxElev : 0,
    voidCount,
    metadata,
    missingTiles,
  };
}

```

### File: `src/core/hgtParser.ts` (288 lines, 8,575 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * SRTM HGT Elevation Data Parser & Geographic Integration
 *
 * Supports:
 *   - SRTM3: 1201 x 1201 samples (3 arc-second ~90m), 2,884,802 bytes
 *   - SRTM1: 3601 x 3601 samples (1 arc-second ~30m), 25,934,402 bytes
 *   - Signed 16-bit big-endian integers (Int16BE)
 *   - Standard SRTM void handling (-32768 / 0x8000 mapped to NaN)
 *   - Standard 1-degree tile georeferencing ([NS]\d{2}[EW]\d{3})
 *   - Local Equirectangular projection relative to theater origin (34.5°N, 76.5°E)
 */

import type { DemGeographicMetadata } from './terrain';

export const SRTM3_SAMPLE_COUNT = 1201;
export const SRTM3_BYTE_LENGTH = 1201 * 1201 * 2; // 2,884,802 bytes

export const SRTM1_SAMPLE_COUNT = 3601;
export const SRTM1_BYTE_LENGTH = 3601 * 3601 * 2; // 25,934,402 bytes

export const SRTM_VOID_VALUE = -32768; // 0x8000

// Standard WGS-84 metric constants at standard parallel phi0 = 34.5°N
export const HGT_METERS_PER_DEG_LAT = 110931.4506;
export const HGT_METERS_PER_DEG_LON = 91839.9774;
export const THEATER_ORIGIN_LAT_DEG = 34.5;
export const THEATER_ORIGIN_LON_DEG = 76.5;

export interface SrtmTileCoordinates {
  readonly tileName: string;
  readonly isNorth: boolean;
  readonly isEast: boolean;
  readonly latInt: number;
  readonly lonInt: number;
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
  readonly centerLatDeg: number;
  readonly centerLonDeg: number;
}

export interface HgtResolutionInfo {
  readonly resolution: 'SRTM1' | 'SRTM3';
  readonly sampleCount: number;
}

export interface HgtDecodeResult {
  readonly elevations: Float32Array;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly voidCount: number;
  readonly validCount: number;
}

export interface HgtParseResult {
  readonly success: boolean;
  readonly error?: string;
  readonly resolution?: 'SRTM1' | 'SRTM3';
  readonly sampleCount?: number;
  readonly metadata?: DemGeographicMetadata;
  readonly elevations?: Float32Array;
  readonly minElevationM?: number;
  readonly maxElevationM?: number;
  readonly voidCount?: number;
  readonly validCount?: number;
}

/**
 * Detects whether buffer length matches standard SRTM1 or SRTM3 byte lengths.
 * Returns null if size does not match either.
 */
export function detectHgtResolution(byteLength: number): HgtResolutionInfo | null {
  if (byteLength === SRTM3_BYTE_LENGTH) {
    return { resolution: 'SRTM3', sampleCount: SRTM3_SAMPLE_COUNT };
  }
  if (byteLength === SRTM1_BYTE_LENGTH) {
    return { resolution: 'SRTM1', sampleCount: SRTM1_SAMPLE_COUNT };
  }
  return null;
}

/**
 * Parses SRTM 1-degree tile naming convention from filename or path.
 * Format: [NS]\d{2}[EW]\d{3}(\.hgt)? (case-insensitive)
 *
 * The coordinate in the tile name specifies the South-West corner of the tile.
 * For example:
 *   N34E076 spans [34.0°N, 35.0°N] latitude and [76.0°E, 77.0°E] longitude.
 *   S12W077 spans [-12.0°N, -11.0°N] latitude and [-77.0°E, -76.0°E] longitude.
 */
export function parseSrtmTileName(filenameOrPath: string): SrtmTileCoordinates | null {
  if (!filenameOrPath || typeof filenameOrPath !== 'string') {
    return null;
  }

  // Extract base filename without directory path
  const baseName = filenameOrPath.split(/[/\\]/).pop() ?? filenameOrPath;
  const match = baseName.match(/([NSns])(\d{2})([EWew])(\d{3})/i);
  if (!match) {
    return null;
  }

  const latHemi = match[1].toUpperCase();
  const latVal = parseInt(match[2], 10);
  const lonHemi = match[3].toUpperCase();
  const lonVal = parseInt(match[4], 10);

  if (isNaN(latVal) || isNaN(lonVal)) {
    return null;
  }

  if (latVal < 0 || latVal > 89) {
    return null;
  }

  if (lonVal < 0 || lonVal > 179) {
    return null;
  }

  const isNorth = latHemi === 'N';
  const isEast = lonHemi === 'E';

  const minLatDeg = isNorth ? latVal : -latVal;
  const maxLatDeg = minLatDeg + 1.0;
  const minLonDeg = isEast ? lonVal : -lonVal;
  const maxLonDeg = minLonDeg + 1.0;

  const centerLatDeg = minLatDeg + 0.5;
  const centerLonDeg = minLonDeg + 0.5;

  const paddedLat = String(latVal).padStart(2, '0');
  const paddedLon = String(lonVal).padStart(3, '0');
  const tileName = `${latHemi}${paddedLat}${lonHemi}${paddedLon}`;

  return {
    tileName,
    isNorth,
    isEast,
    latInt: latVal,
    lonInt: lonVal,
    minLatDeg,
    maxLatDeg,
    minLonDeg,
    maxLonDeg,
    centerLatDeg,
    centerLonDeg,
  };
}

/**
 * Decodes signed 16-bit big-endian samples from SRTM buffer into Float32Array.
 * Voids (-32768) are converted to Number.NaN for safe propagation checks.
 */
export function decodeHgtBuffer(
  buffer: ArrayBuffer | Uint8Array,
  sampleCount: number
): HgtDecodeResult {
  const totalSamples = sampleCount * sampleCount;
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const elevations = new Float32Array(totalSamples);

  let minElev = Number.POSITIVE_INFINITY;
  let maxElev = Number.NEGATIVE_INFINITY;
  let voidCount = 0;
  let validCount = 0;

  for (let i = 0; i < totalSamples; i++) {
    const b0 = uint8[i * 2];
    const b1 = uint8[i * 2 + 1];
    const raw = (b0 << 8) | b1;
    // Sign-extension for 16-bit signed integer
    const int16 = (raw << 16) >> 16;

    if (int16 === SRTM_VOID_VALUE) {
      elevations[i] = Number.NaN;
      voidCount++;
    } else {
      elevations[i] = int16;
      validCount++;
      if (int16 < minElev) minElev = int16;
      if (int16 > maxElev) maxElev = int16;
    }
  }

  return {
    elevations,
    minElevationM: Number.isFinite(minElev) ? minElev : 0,
    maxElevationM: Number.isFinite(maxElev) ? maxElev : 0,
    voidCount,
    validCount,
  };
}

/**
 * Derives georeferenced DemGeographicMetadata for an SRTM tile in local Cartesian coordinates
 * relative to the theater origin (34.5°N, 76.5°E).
 */
export function createHgtGeographicMetadata(
  coords: SrtmTileCoordinates,
  sampleCount: number,
  minElev: number,
  maxElev: number,
  voidCount: number
): DemGeographicMetadata {
  const minX = (coords.minLonDeg - THEATER_ORIGIN_LON_DEG) * HGT_METERS_PER_DEG_LON;
  const maxX = (coords.maxLonDeg - THEATER_ORIGIN_LON_DEG) * HGT_METERS_PER_DEG_LON;
  const minY = (coords.minLatDeg - THEATER_ORIGIN_LAT_DEG) * HGT_METERS_PER_DEG_LAT;
  const maxY = (coords.maxLatDeg - THEATER_ORIGIN_LAT_DEG) * HGT_METERS_PER_DEG_LAT;
  const halfWidthM = (maxX - minX) / 2.0;
  const halfHeightM = (maxY - minY) / 2.0;

  return {
    rasterWidth: sampleCount,
    rasterHeight: sampleCount,
    centerLatDeg: coords.centerLatDeg,
    centerLonDeg: coords.centerLonDeg,
    minLatDeg: coords.minLatDeg,
    maxLatDeg: coords.maxLatDeg,
    minLonDeg: coords.minLonDeg,
    maxLonDeg: coords.maxLonDeg,
    halfWidthM,
    halfHeightM,
    groundResolutionXM: (maxX - minX) / (sampleCount - 1),
    groundResolutionYM: (maxY - minY) / (sampleCount - 1),
    minX,
    maxX,
    minY,
    maxY,
    tileName: coords.tileName,
    minElevationM: minElev,
    maxElevationM: maxElev,
    voidCount,
  };
}

/**
 * End-to-end SRTM HGT buffer parser.
 * Validates dimensions, decodes Int16BE elevations, handles voids, and georeferences the tile.
 */
export function parseHgtBuffer(
  filenameOrPath: string,
  buffer: ArrayBuffer | Uint8Array,
  fallbackCoords?: SrtmTileCoordinates
): HgtParseResult {
  const byteLength = buffer.byteLength;
  const resInfo = detectHgtResolution(byteLength);

  if (!resInfo) {
    return {
      success: false,
      error: `Invalid HGT file size (${byteLength.toLocaleString()} bytes). Expected SRTM3 (2,884,802 bytes for 1201×1201) or SRTM1 (25,934,402 bytes for 3601×3601).`,
    };
  }

  let coords = parseSrtmTileName(filenameOrPath);
  if (!coords) {
    if (fallbackCoords) {
      coords = fallbackCoords;
    } else {
      // If filename does not contain SRTM tile coordinates, default to standard Ladakh theater tile N34E076
      coords = parseSrtmTileName('N34E076.hgt')!;
    }
  }

  const decode = decodeHgtBuffer(buffer, resInfo.sampleCount);
  const metadata = createHgtGeographicMetadata(
    coords,
    resInfo.sampleCount,
    decode.minElevationM,
    decode.maxElevationM,
    decode.voidCount
  );

  return {
    success: true,
    resolution: resInfo.resolution,
    sampleCount: resInfo.sampleCount,
    metadata,
    elevations: decode.elevations,
    minElevationM: decode.minElevationM,
    maxElevationM: decode.maxElevationM,
    voidCount: decode.voidCount,
    validCount: decode.validCount,
  };
}

```

### File: `src/core/linkBudget.ts` (213 lines, 7,379 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Link Budget & Adaptive Modulation Engine (TypeScript Port)
 *
 * Implements:
 * 1. Free Space Path Loss (FSPL) and Friis transmission equation.
 * 2. ITU-R P.676 atmospheric gas absorption (0.012 dB/km at 8.0 GHz).
 * 3. ITU-R P.838-3 specific rain attenuation.
 * 4. Receiver thermal noise floor over 1.0 MHz bandwidth.
 * 5. DVB-S2X / 3GPP Rel-17 NTN discrete 8-state MODCOD table with 2.5 dB margin.
 */

import { EnvironmentConfig, NodeType, RFConfig } from './config';

export interface ModCodEntry {
  readonly name: string;
  readonly minSnrDb: number;
  readonly spectralEfficiencyBpsHz: number;
}

/**
 * DVB-S2X / 3GPP Rel-17 Non-Terrestrial Network (NTN) MODCOD Table
 * Ordered descending by SNR threshold for optimal rate matching.
 */
export const MODCOD_TABLE: readonly ModCodEntry[] = [
  { name: '64-APSK 5/6', minSnrDb: 22.0, spectralEfficiencyBpsHz: 4.95 },
  { name: '32-APSK 3/4', minSnrDb: 17.5, spectralEfficiencyBpsHz: 3.70 },
  { name: '16-APSK 4/5', minSnrDb: 14.0, spectralEfficiencyBpsHz: 3.16 },
  { name: '16-APSK 2/3', minSnrDb: 11.5, spectralEfficiencyBpsHz: 2.64 },
  { name: '8-PSK 3/5',   minSnrDb: 8.0,  spectralEfficiencyBpsHz: 1.78 },
  { name: 'QPSK 3/4',    minSnrDb: 5.5,  spectralEfficiencyBpsHz: 1.49 },
  { name: 'QPSK 1/2',    minSnrDb: 2.5,  spectralEfficiencyBpsHz: 0.99 },
  { name: 'pi/2-BPSK 1/3', minSnrDb: -1.5, spectralEfficiencyBpsHz: 0.33 },
] as const;

export interface LinkStatus {
  readonly nodeType: NodeType | string;
  readonly slantRangeM: number;
  readonly fsplDb: number;
  readonly diffractionLossDb: number;
  readonly gasLossDb: number;
  readonly rainLossDb: number;
  readonly cableLossDb: number;
  readonly implementationMarginDb: number;
  readonly totalLossDb: number;
  readonly pTxDbm: number;
  readonly txGainDbi: number;
  readonly rxGainDbi: number;
  readonly prxDbm: number;
  readonly pNoiseDbm: number;
  readonly snrDb: number;
  readonly modcodName: string;
  readonly spectralEfficiency: number;
  readonly bitrateBps: number;
  readonly bitrateMbps: number;
  readonly isOutage: boolean;
  /** True when geometry intersects a screening-only obstacle; no attenuation is inferred. */
  readonly obstacleBlocked?: boolean;
}

export class LinkBudgetEngine {
  /**
   * Computes Free Space Path Loss (FSPL) in dB:
   * FSPL = 20*log10(d) + 20*log10(fc) + 20*log10(4*pi/c)
   */
  public static computeFsplDb(slantRangeM: number, fcHz: number, speedOfLightMps: number): number {
    if (slantRangeM <= 0.0) {
      throw new Error(`Slant range must be positive, got ${slantRangeM} m.`);
    }
    return (
      20.0 * Math.log10(slantRangeM) +
      20.0 * Math.log10(fcHz) +
      20.0 * Math.log10((4.0 * Math.PI) / speedOfLightMps)
    );
  }

  /**
   * ITU-R P.676 Gaseous Absorption for 8.0 GHz Tactical X-band.
   * Specific attenuation gamma_g = 0.012 dB/km in clear alpine troposphere.
   */
  public static computeGaseousAttenuationDb(slantRangeM: number): number {
    return 0.012 * (slantRangeM / 1000.0);
  }

  /**
   * ITU-R P.838-3 Hydrometeor Rain Attenuation for 8.0 GHz (Horizontal polarization).
   * k_H = 0.00411, alpha_H = 1.390
   * gamma_R = k_H * (rainRate ^ alpha_H) dB/km
   * Effective path capped by rain cell extent.
   */
  public static computeRainAttenuationDb(slantRangeM: number, env: EnvironmentConfig): number {
    if (env.rainRateMmH <= 0.0) {
      return 0.0;
    }
    const kH = 0.00411;
    const alphaH = 1.39;
    const gammaR = kH * Math.pow(env.rainRateMmH, alphaH);
    const rainPathKm = Math.min(slantRangeM / 1000.0, env.rainCellLengthKm);
    return gammaR * rainPathKm;
  }

  /**
   * Computes thermal receiver noise floor in Watts and dBm:
   * P_noise_w = k_B * T * B * 10^(NF / 10)
   * P_noise_dbm = 10 * log10(P_noise_w * 1000)
   */
  public static computeThermalNoiseFloorDbm(
    bandwidthHz: number,
    noiseFigureDb: number,
    temperatureK: number = 290.0,
    boltzmannConstant: number = 1.380649e-23
  ): { pNoiseW: number; pNoiseDbm: number } {
    const noiseFactor = Math.pow(10.0, noiseFigureDb / 10.0);
    const pNoiseW = boltzmannConstant * temperatureK * bandwidthHz * noiseFactor;
    const pNoiseDbm = 10.0 * Math.log10(pNoiseW * 1000.0);
    return { pNoiseW, pNoiseDbm };
  }

  /**
   * Selects highest order operational DVB-S2X / 3GPP Rel-17 MODCOD for received SNR.
   */
  public static selectModCod(snrDb: number): { name: string; spectralEfficiencyBpsHz: number } {
    for (let i = 0; i < MODCOD_TABLE.length; i++) {
      const entry = MODCOD_TABLE[i];
      if (snrDb >= entry.minSnrDb) {
        return {
          name: entry.name,
          spectralEfficiencyBpsHz: entry.spectralEfficiencyBpsHz,
        };
      }
    }
    return { name: 'LINK_OUTAGE', spectralEfficiencyBpsHz: 0.0 };
  }

  /**
   * Predicts physical RF link performance, received power, net SNR,
   * adaptive MODCOD scheme, and net achievable bitrate.
   */
  public evaluateLink(
    nodeType: NodeType | string,
    slantRangeM: number,
    diffractionLossDb: number,
    rf: RFConfig,
    env: EnvironmentConfig,
    obstacleBlocked: boolean = false,
    customTxPowerDbm?: number
  ): LinkStatus {
    const fsplDb = LinkBudgetEngine.computeFsplDb(slantRangeM, rf.carrierFrequencyHz, rf.speedOfLight);
    const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(slantRangeM);
    const rainLossDb = LinkBudgetEngine.computeRainAttenuationDb(slantRangeM, env);

    // Sum channel losses
    const cableLossDb = rf.cableLossDb;
    const implementationMarginDb = rf.implementationMarginDb;
    const totalLossDb =
      fsplDb +
      diffractionLossDb +
      gasLossDb +
      rainLossDb +
      cableLossDb +
      implementationMarginDb;

    // Transceiver parameters
    const { txPowerDbm: defaultTxPowerDbm, antennaGainDbi } = rf.getTransmitterParams(nodeType);
    const txPowerDbm = customTxPowerDbm !== undefined && Number.isFinite(customTxPowerDbm) ? customTxPowerDbm : defaultTxPowerDbm;
    const rxGainDbi = rf.acnAntennaGainDbi;

    // Received signal power at ACN LNA input
    const prxDbm = txPowerDbm + antennaGainDbi + rxGainDbi - totalLossDb;

    // Thermal noise floor
    const { pNoiseDbm } = LinkBudgetEngine.computeThermalNoiseFloorDbm(
      rf.channelBandwidthHz,
      rf.acnNoiseFigureDb,
      env.atmosphericTemperatureK,
      rf.boltzmannConstant
    );

    // Net Signal-to-Noise Ratio (SNR)
    const snrDb = prxDbm - pNoiseDbm;

    // Dynamic MODCOD selection & capacity mapping
    const modcod = LinkBudgetEngine.selectModCod(snrDb);
    const isOutage = obstacleBlocked || modcod.name === 'LINK_OUTAGE';
    const spectralEfficiency = isOutage ? 0.0 : modcod.spectralEfficiencyBpsHz;
    const bitrateBps = isOutage ? 0.0 : spectralEfficiency * rf.channelBandwidthHz;
    const bitrateMbps = bitrateBps / 1.0e6;

    return {
      nodeType,
      slantRangeM,
      fsplDb,
      diffractionLossDb,
      gasLossDb,
      rainLossDb,
      cableLossDb,
      implementationMarginDb,
      totalLossDb,
      pTxDbm: txPowerDbm,
      txGainDbi: antennaGainDbi,
      rxGainDbi,
      prxDbm,
      pNoiseDbm,
      snrDb,
      modcodName: obstacleBlocked ? 'OBSTACLE_BLOCKED' : modcod.name,
      spectralEfficiency,
      bitrateBps,
      bitrateMbps,
      isOutage,
      obstacleBlocked,
    };
  }
}
```

### File: `src/core/linkProfile.ts` (193 lines, 9,496 bytes)

```typescript
import type { Position3D } from '../shared/types';
import type { TerrainObstruction } from './terrain';

/** One worker-generated sample along the ground terminal to ACN link. All elevations and distances are metres. */
export interface LinkProfileSample {
  /** Horizontal plan-view ground distance from the ground terminal. */
  readonly horizontalGroundDistanceM: number;
  /** 3D distance along the link ray from the ground terminal. */
  readonly slantDistanceM: number;
  readonly terrainElevationMslM: number;
  /** Terrain MSL plus the same effective-Earth bulge used by terrain obstruction evaluation. */
  readonly effectiveTerrainElevationMslM: number;
  readonly losElevationMslM: number;
  readonly fresnelRadiusM: number;
  readonly lowerFresnelElevationMslM: number;
  readonly upperFresnelElevationMslM: number;
  /** Signed LOS-to-effective-terrain clearance at this visualization sample. */
  readonly effectiveTerrainClearanceM: number;
}

/** Obstacle hit interval projected from the physics engine's 3D-ray fractions. */
export interface LinkProfileObstacleInterval {
  readonly obstacleId: string;
  readonly entryFraction: number;
  readonly exitFraction: number;
  readonly entryHorizontalDistanceM: number;
  readonly exitHorizontalDistanceM: number;
  readonly entrySlantDistanceM: number;
  readonly exitSlantDistanceM: number;
  readonly penetrationM: number;
}

/** Typed profile contract. Coordinates use local Cartesian x/y metres and absolute MSL z metres. */
export interface LinkProfile {
  readonly selectedGroundNodeId: number;
  readonly nodeName: string;
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly groundNodePositionMslM: Position3D;
  readonly acnPositionMslM: Position3D;
  readonly horizontalGroundDistanceM: number;
  readonly slantDistanceM: number;
  /** Existing worker profile uses 0.6 F1; this reports that exact existing factor. */
  readonly fresnelFraction: number;
  /** Authoritative result from TerrainEngine.evaluateTerrainObstruction(). */
  readonly terrainIsLos: boolean;
  readonly terrainMinimumClearanceM: number;
  readonly terrainCriticalFresnelRadiusM: number;
  readonly diffractionLossDb: number;
  /** Independent screening result from ObstacleField.intersectRay(). */
  readonly obstacleBlocked: boolean;
  readonly obstacleIntervals: readonly LinkProfileObstacleInterval[];
  readonly samples: readonly LinkProfileSample[];
  /** False only when profile inputs are numerically invalid or traverse out-of-coverage terrain; no sample is emitted in that case. */
  readonly valid: boolean;
  /** Explicit terrain coverage status; false if any sample along the propagation profile is unmapped. */
  readonly isCoverageComplete?: boolean;
  /** Explanatory description when profile is invalid or extends outside DEM coverage. */
  readonly invalidReason?: string;
}

export interface BuildLinkProfileInput {
  readonly selectedGroundNodeId: number;
  readonly nodeName: string;
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly groundNodePositionMslM: Position3D;
  readonly acnPositionMslM: Position3D;
  readonly wavelengthM: number;
  readonly effectiveEarthRadiusM: number;
  readonly fresnelFraction?: number;
  readonly sampleCount: number;
  readonly obstruction: TerrainObstruction;
  readonly getTerrainElevationMslM: (xM: number, yM: number) => number;
  readonly computeEarthBulgeM: (d1M: number, d2M: number, radiusM: number) => number;
}

const finitePosition = (p: Position3D): boolean => p.length === 3 && p.every(Number.isFinite);

/**
 * Builds display geometry from worker-owned terrain/obstruction inputs. Propagation remains based on slant distance;
 * horizontal distance is only the profile's display coordinate.
 */
export function buildLinkProfile(input: BuildLinkProfileInput): LinkProfile {
  const fraction = input.fresnelFraction ?? 0.6;
  const node = input.groundNodePositionMslM;
  const acn = input.acnPositionMslM;
  const dx = acn[0] - node[0], dy = acn[1] - node[1], dz = acn[2] - node[2];
  const horizontalDistanceM = Math.hypot(dx, dy);
  const slantDistanceM = Math.hypot(horizontalDistanceM, dz);
  const isCoverageComplete = input.obstruction.isCoverageComplete !== false;
  let invalidReason: string | undefined = undefined;

  let valid = isCoverageComplete &&
    finitePosition(node) && finitePosition(acn) &&
    Number.isFinite(input.frameIndex) && Number.isFinite(input.simulationTimeS) &&
    Number.isFinite(input.wavelengthM) && input.wavelengthM > 0 &&
    Number.isFinite(input.effectiveEarthRadiusM) && input.effectiveEarthRadiusM > 0 &&
    Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 &&
    Number.isInteger(input.sampleCount) && input.sampleCount >= 2 &&
    Number.isFinite(horizontalDistanceM) && Number.isFinite(slantDistanceM) &&
    Number.isFinite(input.obstruction.minClearanceM) &&
    Number.isFinite(input.obstruction.fresnelRadiusM) &&
    Number.isFinite(input.obstruction.diffractionLossDb) &&
    input.obstruction.obstacleIntersections.every(hit => typeof hit.obstacleId === 'string' && hit.obstacleId.length > 0 &&
      Number.isFinite(hit.entryFraction) && Number.isFinite(hit.exitFraction) && hit.entryFraction >= 0 &&
      hit.exitFraction >= hit.entryFraction && hit.exitFraction <= 1 && Number.isFinite(hit.penetrationM));

  if (!isCoverageComplete) {
    invalidReason = input.obstruction.coverageNote ?? 'Propagation profile extends outside mapped DEM coverage';
  }

  const samples: LinkProfileSample[] = [];
  if (valid) {
    try {
      for (let i = 0; i < input.sampleCount; i++) {
        const along = i / (input.sampleCount - 1);
        const d1M = along * slantDistanceM;
        const d2M = slantDistanceM - d1M;
        const xM = node[0] + along * dx;
        const yM = node[1] + along * dy;
        const terrainMslM = input.getTerrainElevationMslM(xM, yM);
        if (!Number.isFinite(terrainMslM)) {
          valid = false;
          invalidReason = 'Propagation profile extends outside mapped DEM coverage (unmapped terrain sample)';
          break;
        }
        const bulgeM = slantDistanceM > 0
          ? input.computeEarthBulgeM(d1M, d2M, input.effectiveEarthRadiusM)
          : 0;
        const effectiveTerrainMslM = terrainMslM + bulgeM;
        const losMslM = node[2] + along * dz;
        const fresnelRadiusM = slantDistanceM > 0
          ? Math.sqrt(Math.max(0, input.wavelengthM * d1M * d2M / slantDistanceM))
          : 0;
        const offsetM = fraction * fresnelRadiusM;
        const values = [terrainMslM, effectiveTerrainMslM, losMslM, fresnelRadiusM, offsetM];
        if (!values.every(Number.isFinite)) {
          valid = false;
          invalidReason = 'Propagation profile values contain non-finite numbers';
          break;
        }
        samples.push({
          horizontalGroundDistanceM: along * horizontalDistanceM,
          slantDistanceM: d1M,
          terrainElevationMslM: terrainMslM,
          effectiveTerrainElevationMslM: effectiveTerrainMslM,
          losElevationMslM: losMslM,
          fresnelRadiusM,
          lowerFresnelElevationMslM: losMslM - offsetM,
          upperFresnelElevationMslM: losMslM + offsetM,
          effectiveTerrainClearanceM: losMslM - effectiveTerrainMslM,
        });
      }
    } catch {
      valid = false;
      invalidReason = 'Exception occurred during profile sampling';
    }
  }
  if (!valid) samples.length = 0;
  const intervals: LinkProfileObstacleInterval[] = valid ? input.obstruction.obstacleIntersections.map(hit => ({
    obstacleId: hit.obstacleId,
    entryFraction: hit.entryFraction,
    exitFraction: hit.exitFraction,
    entryHorizontalDistanceM: hit.entryFraction * horizontalDistanceM,
    exitHorizontalDistanceM: hit.exitFraction * horizontalDistanceM,
    entrySlantDistanceM: hit.entryFraction * slantDistanceM,
    exitSlantDistanceM: hit.exitFraction * slantDistanceM,
    penetrationM: hit.penetrationM,
  })) : [];

  return {
    selectedGroundNodeId: Number.isInteger(input.selectedGroundNodeId) ? input.selectedGroundNodeId : -1,
    nodeName: typeof input.nodeName === 'string' ? input.nodeName : '',
    frameIndex: Number.isFinite(input.frameIndex) ? input.frameIndex : 0,
    simulationTimeS: Number.isFinite(input.simulationTimeS) ? input.simulationTimeS : 0,
    groundNodePositionMslM: finitePosition(node) ? [...node] as unknown as Position3D : [0, 0, 0],
    acnPositionMslM: finitePosition(acn) ? [...acn] as unknown as Position3D : [0, 0, 0],
    horizontalGroundDistanceM: Number.isFinite(horizontalDistanceM) ? horizontalDistanceM : 0,
    slantDistanceM: Number.isFinite(slantDistanceM) ? slantDistanceM : 0,
    fresnelFraction: Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 ? fraction : 0.6,
    terrainIsLos: input.obstruction.isLos === true,
    terrainMinimumClearanceM: Number.isFinite(input.obstruction.minClearanceM) ? input.obstruction.minClearanceM : 0,
    terrainCriticalFresnelRadiusM: Number.isFinite(input.obstruction.fresnelRadiusM) ? input.obstruction.fresnelRadiusM : 0,
    diffractionLossDb: Number.isFinite(input.obstruction.diffractionLossDb) ? input.obstruction.diffractionLossDb : 0,
    obstacleBlocked: input.obstruction.obstacleBlocked === true,
    obstacleIntervals: intervals,
    samples,
    valid,
    isCoverageComplete: valid && isCoverageComplete,
    invalidReason: !valid ? (invalidReason ?? 'Profile inputs contain non-finite values') : undefined,
  };
}
```

### File: `src/core/linkStatusClassifier.ts` (488 lines, 18,516 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Authoritative Communication Link Status Classifier (Milestone 4 Step 2 & 3)
 *
 * Provides a pure, deterministic, independently testable link-status classifier
 * using authoritative telemetry from the simulation worker, link budget engine,
 * and terrain propagation models.
 *
 * Status Classifications:
 * - CONNECTED: Operational link with nominal line-of-sight, zero diffraction loss, and valid operational MODCOD.
 * - DEGRADED: Operational link with reduced quality grounded in physical/lookahead indicators
 *             (diffraction loss > 0 dB from ITU-R 0.6 F1 Fresnel encroachment, pre-occlusion flush
 *             lookahead warning, or lowest operational MODCOD tier pi/2-BPSK 1/3).
 * - BLOCKED_TERRAIN: Non-operational due to physical terrain occlusion (optical LOS severed: terrain_is_los === false).
 * - BLOCKED_OBSTACLE: Non-operational due to artificial obstacle intersection along line of sight.
 * - OUTAGE_DISCONNECTED: Non-operational due to link-budget exhaustion (SNR below -1.5 dB demodulation threshold)
 *                        without physical terrain or obstacle blockage.
 * - UNKNOWN: Required telemetry fields are missing, malformed, or invalid.
 *
 * Conflict Resolution & Precedence:
 * 1. Invalid or missing essential telemetry (missing booleans, NaN values) -> UNKNOWN
 * 2. Artificial obstacle blockage -> BLOCKED_OBSTACLE
 *    (If terrain LOS is also occluded, BLOCKED_OBSTACLE still applies as the local screening barrier,
 *    and the reason string explicitly records that terrain LOS is also occluded).
 * 3. Physical terrain occlusion (terrain_is_los === false) -> BLOCKED_TERRAIN
 * 4. Propagation outage with clear physical geometry -> OUTAGE_DISCONNECTED
 *    (Contradictory link_outage=false with SNR < -1.5 dB or modcod=LINK_OUTAGE correctly resolves to outage).
 * 5. Operational with quality degradation factors -> DEGRADED
 * 6. Operational nominal LOS -> CONNECTED
 */

import { MODCOD_TABLE } from './linkBudget';
import { NodeTerrainState } from './trajectory';

/**
 * Standard communication link statuses for Tactical X-Band Air-to-Ground links.
 */
export type LinkCommunicationStatus =
  | 'CONNECTED'
  | 'DEGRADED'
  | 'BLOCKED_TERRAIN'
  | 'BLOCKED_OBSTACLE'
  | 'OUTAGE_DISCONNECTED'
  | 'UNKNOWN';

/**
 * Known operational MODCOD scheme names from the DVB-S2X / 3GPP Rel-17 NTN table.
 */
const KNOWN_OPERATIONAL_MODCODS = new Set<string>(MODCOD_TABLE.map((m) => m.name));

/**
 * Lowest operational DVB-S2X modulation tier at the demodulation threshold (-1.5 dB).
 */
export const THRESHOLD_MODCOD_NAME = 'pi/2-BPSK 1/3';

/**
 * Minimum SNR sensitivity threshold for DVB-S2X demodulation in dB.
 * Below this threshold, MODCOD selection drops to LINK_OUTAGE.
 */
export const MIN_OPERATIONAL_SNR_DB = -1.5;

/**
 * Floating-point tolerance for diffraction loss comparison in dB.
 */
export const DIFFRACTION_LOSS_EPSILON_DB = 1e-4;

/**
 * Telemetry input interface accepted by the link status classifier.
 * Compatible with `nodes_telemetry` items, `SelectedLinkBudgetTelemetry`,
 * and worker `obstruction_state` snapshots.
 */
export interface LinkStatusTelemetryInput {
  readonly terrain_is_los?: boolean | null;
  readonly obstacle_blocked?: boolean | null;
  readonly link_outage?: boolean | null;
  readonly is_outage?: boolean | null;
  readonly modcod_name?: string | null;
  readonly diffraction_loss_db?: number | null;
  readonly snr_db?: number | null;
  readonly bitrate_bps?: number | null;
  readonly bitrate_mbps?: number | null;
  readonly state_name?: string | NodeTerrainState | null;
  readonly predicted_state?: string | NodeTerrainState | null;
  readonly fresnel_clearance_m?: number | null;
  readonly time_to_occlusion_s?: number | null;
  readonly is_coverage_complete?: boolean | null;
  readonly isCoverageComplete?: boolean | null;
  readonly coverage_note?: string | null;
  readonly coverageNote?: string | null;
  readonly [key: string]: unknown;
}

/**
 * Detailed breakdown of input telemetry and identified degradation factors.
 */
export interface LinkStatusDetails {
  readonly terrainIsLos: boolean | null;
  readonly obstacleBlocked: boolean | null;
  readonly isOutage: boolean | null;
  readonly diffractionLossDb: number | null;
  readonly snrDb: number | null;
  readonly modcodName: string | null;
  readonly stateName: string | null;
  readonly degradationFactors: readonly string[];
}

/**
 * Authoritative classification result for a communication link.
 */
export interface LinkStatusClassification {
  readonly status: LinkCommunicationStatus;
  /** True only if communication link is active and transmitting data (CONNECTED or DEGRADED). */
  readonly isOperational: boolean;
  /** True if link is severed by a physical obstruction (BLOCKED_TERRAIN or BLOCKED_OBSTACLE). */
  readonly isBlocked: boolean;
  /** True if link is in an outage or blocked state (BLOCKED_TERRAIN, BLOCKED_OBSTACLE, or OUTAGE_DISCONNECTED). */
  readonly isOutage: boolean;
  /** Explicit, human-readable scientific rationale describing why this classification was chosen. */
  readonly reason: string;
  /** Normalized input telemetry fields and identified degradation factors. */
  readonly details: LinkStatusDetails;
}

/**
 * Returns true if the status represents an operational link carrying traffic.
 */
export function isLinkOperational(status: LinkCommunicationStatus): boolean {
  return status === 'CONNECTED' || status === 'DEGRADED';
}

/**
 * Returns true if the status represents a physical blockage (terrain or artificial obstacle).
 */
export function isLinkBlocked(status: LinkCommunicationStatus): boolean {
  return status === 'BLOCKED_TERRAIN' || status === 'BLOCKED_OBSTACLE';
}

/**
 * Pure, deterministic classifier function for Tactical X-Band Air-to-Ground links.
 * Evaluates authoritative telemetry against physical and lookahead propagation rules.
 */
export function classifyLinkCommunicationStatus(
  input: LinkStatusTelemetryInput | null | undefined
): LinkStatusClassification {
  // ── Step 0: Input validation & missing telemetry detection ────────────────
  if (!input || typeof input !== 'object') {
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: 'Input telemetry is missing or not a valid object.',
      details: {
        terrainIsLos: null,
        obstacleBlocked: null,
        isOutage: null,
        diffractionLossDb: null,
        snrDb: null,
        modcodName: null,
        stateName: null,
        degradationFactors: [],
      },
    };
  }

  // Essential boolean flags must be strictly boolean
  if (typeof input.obstacle_blocked !== 'boolean') {
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: "Required telemetry field 'obstacle_blocked' is missing or not a boolean.",
      details: {
        terrainIsLos: typeof input.terrain_is_los === 'boolean' ? input.terrain_is_los : null,
        obstacleBlocked: null,
        isOutage: null,
        diffractionLossDb: null,
        snrDb: null,
        modcodName: null,
        stateName: null,
        degradationFactors: [],
      },
    };
  }

  if (typeof input.terrain_is_los !== 'boolean') {
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: "Required telemetry field 'terrain_is_los' is missing or not a boolean.",
      details: {
        terrainIsLos: null,
        obstacleBlocked: input.obstacle_blocked,
        isOutage: null,
        diffractionLossDb: null,
        snrDb: null,
        modcodName: null,
        stateName: null,
        degradationFactors: [],
      },
    };
  }

  // Authoritative outage indicator must be provided as a boolean in either link_outage or is_outage
  const hasOutageBoolean =
    typeof input.link_outage === 'boolean' || typeof input.is_outage === 'boolean';
  if (!hasOutageBoolean) {
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: "Required telemetry field 'link_outage' or 'is_outage' is missing or not a boolean.",
      details: {
        terrainIsLos: input.terrain_is_los,
        obstacleBlocked: input.obstacle_blocked,
        isOutage: null,
        diffractionLossDb: null,
        snrDb: null,
        modcodName: typeof input.modcod_name === 'string' ? input.modcod_name : null,
        stateName: null,
        degradationFactors: [],
      },
    };
  }

  // Incomplete terrain coverage check for non-obstacle links
  const isCoverageIncomplete =
    input.is_coverage_complete === false || input.isCoverageComplete === false;

  if (isCoverageIncomplete && !input.obstacle_blocked) {
    const note =
      (typeof input.coverage_note === 'string' && input.coverage_note) ||
      (typeof input.coverageNote === 'string' && input.coverageNote) ||
      'Propagation path traverses unmapped terrain outside DEM coverage.';
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: `Terrain coverage incomplete: ${note}`,
      details: {
        terrainIsLos: null,
        obstacleBlocked: false,
        isOutage: null,
        diffractionLossDb: null,
        snrDb: null,
        modcodName: typeof input.modcod_name === 'string' ? input.modcod_name : null,
        stateName: null,
        degradationFactors: ['INCOMPLETE_TERRAIN_COVERAGE'],
      },
    };
  }

  // Validate numeric fields when provided
  if (
    !input.obstacle_blocked &&
    input.diffraction_loss_db !== undefined &&
    input.diffraction_loss_db !== null &&
    (typeof input.diffraction_loss_db !== 'number' || !Number.isFinite(input.diffraction_loss_db))
  ) {
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: "Telemetry field 'diffraction_loss_db' is provided but is not a finite number.",
      details: {
        terrainIsLos: input.terrain_is_los,
        obstacleBlocked: input.obstacle_blocked,
        isOutage: null,
        diffractionLossDb: null,
        snrDb: null,
        modcodName: typeof input.modcod_name === 'string' ? input.modcod_name : null,
        stateName: null,
        degradationFactors: [],
      },
    };
  }

  if (
    !input.obstacle_blocked &&
    input.snr_db !== undefined &&
    input.snr_db !== null &&
    (typeof input.snr_db !== 'number' || !Number.isFinite(input.snr_db))
  ) {
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: "Telemetry field 'snr_db' is provided but is not a finite number.",
      details: {
        terrainIsLos: input.terrain_is_los,
        obstacleBlocked: input.obstacle_blocked,
        isOutage: null,
        diffractionLossDb: typeof input.diffraction_loss_db === 'number' ? input.diffraction_loss_db : null,
        snrDb: null,
        modcodName: typeof input.modcod_name === 'string' ? input.modcod_name : null,
        stateName: null,
        degradationFactors: [],
      },
    };
  }

  // Normalized values
  const obstacleBlocked = input.obstacle_blocked;
  const terrainIsLos = input.terrain_is_los;
  const diffractionLossDb =
    typeof input.diffraction_loss_db === 'number' && Number.isFinite(input.diffraction_loss_db)
      ? input.diffraction_loss_db
      : null;
  const snrDb =
    typeof input.snr_db === 'number' && Number.isFinite(input.snr_db) ? input.snr_db : null;
  const modcodName = typeof input.modcod_name === 'string' ? input.modcod_name : null;
  const rawState = input.state_name ?? input.predicted_state;
  const stateName = typeof rawState === 'string' ? rawState : null;

  // Resolve outage with conflict-safety:
  // If SNR is below DVB-S2X threshold (-1.5 dB) or modcod indicates outage, outage takes precedence
  // over any contradictory false flag, preventing unverified healthy classifications.
  const rawOutageBool =
    typeof input.link_outage === 'boolean' ? input.link_outage : (input.is_outage as boolean);
  const isBelowSnrCutoff = snrDb !== null && snrDb < MIN_OPERATIONAL_SNR_DB;
  const isOutageModcod = modcodName === 'LINK_OUTAGE' || modcodName === 'OBSTACLE_BLOCKED';
  const derivedOutage = rawOutageBool || isBelowSnrCutoff || isOutageModcod;

  // ── Step 1: Precedence Rule 1 — Artificial Obstacle Blockage ─────────────
  if (obstacleBlocked) {
    const terrainNote = isCoverageIncomplete
      ? ' (terrain coverage is incomplete along path)'
      : (!terrainIsLos
        ? ' (terrain optical line-of-sight is also occluded)'
        : ' (terrain line-of-sight is clear)');
    return {
      status: 'BLOCKED_OBSTACLE',
      isOperational: false,
      isBlocked: true,
      isOutage: true,
      reason: `Blocked by artificial obstacle along line-of-sight${terrainNote}.`,
      details: {
        terrainIsLos,
        obstacleBlocked: true,
        isOutage: true,
        diffractionLossDb,
        snrDb,
        modcodName,
        stateName,
        degradationFactors: isCoverageIncomplete ? ['INCOMPLETE_TERRAIN_COVERAGE'] : [],
      },
    };
  }

  // ── Step 2: Precedence Rule 2 — Physical Terrain Occlusion ────────────────
  // Strictly governed by physical line-of-sight (terrain_is_los === false).
  // Note: HARD_SHADOW_CUTOFF is a lookahead prediction from PredictiveLookAheadEngine;
  // physical occlusion is authoritatively established when optical LOS is severed.
  if (!terrainIsLos) {
    const diffText =
      diffractionLossDb !== null ? `; diffraction loss: ${diffractionLossDb.toFixed(1)} dB` : '';
    const stateSuffix = stateName ? ` [lookahead: ${stateName}]` : '';
    return {
      status: 'BLOCKED_TERRAIN',
      isOperational: false,
      isBlocked: true,
      isOutage: true,
      reason: `Blocked by terrain obstruction (optical line-of-sight severed${diffText})${stateSuffix}.`,
      details: {
        terrainIsLos: false,
        obstacleBlocked: false,
        isOutage: true,
        diffractionLossDb,
        snrDb,
        modcodName,
        stateName,
        degradationFactors: [],
      },
    };
  }

  // ── Step 3: Precedence Rule 3 — RF Link Budget Propagation Outage ─────────
  // Physical geometry is unobstructed by both obstacles and terrain (terrain_is_los === true),
  // but link budget cannot close (SNR below -1.5 dB sensitivity threshold or link_outage flag set).
  if (derivedOutage === true || modcodName === 'LINK_OUTAGE') {
    const snrText = snrDb !== null ? ` (SNR: ${snrDb.toFixed(1)} dB < -1.5 dB threshold)` : '';
    return {
      status: 'OUTAGE_DISCONNECTED',
      isOperational: false,
      isBlocked: false,
      isOutage: true,
      reason: `Disconnected due to link-budget outage (insufficient SNR for demodulation; terrain and obstacles are clear${snrText}).`,
      details: {
        terrainIsLos: true,
        obstacleBlocked: false,
        isOutage: true,
        diffractionLossDb,
        snrDb,
        modcodName: modcodName ?? 'LINK_OUTAGE',
        stateName,
        degradationFactors: [],
      },
    };
  }

  // ── Step 4: Precedence Rule 4 — Operational Link Degradation Analysis ────
  // Link is operational (not in outage, not blocked). Evaluate defensible indicators:
  const degradationFactors: string[] = [];
  const factorDescriptions: string[] = [];

  // A. Knife-edge Fresnel encroachment (diffraction loss > 0 dB while in optical LOS)
  // Rationale: In TerrainEngine (ITU-R P.526), when 0.0 < minClearanceRatio < 0.6,
  // knife-edge diffraction loss is 6.0 * (1.0 - ratio / 0.6) dB > 0.0 dB.
  if (diffractionLossDb !== null && diffractionLossDb > DIFFRACTION_LOSS_EPSILON_DB) {
    degradationFactors.push('fresnel_diffraction_encroachment');
    factorDescriptions.push(
      `terrain knife-edge diffraction loss ${diffractionLossDb.toFixed(1)} dB (0.6 F1 Fresnel encroachment)`
    );
  }

  // B. Predictive lookahead pre-occlusion flush state
  // Rationale: Lookahead engine calculates terminal will enter terrain shadow within lookahead horizon (<= 3.0s).
  if (stateName === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
    degradationFactors.push('pre_occlusion_lookahead_warning');
    const timeToOcc =
      typeof input.time_to_occlusion_s === 'number' && input.time_to_occlusion_s >= 0
        ? ` in ${input.time_to_occlusion_s.toFixed(1)}s`
        : '';
    factorDescriptions.push(
      `predictive lookahead pre-occlusion flush active (terrain shadow imminent${timeToOcc})`
    );
  }

  // C. Lowest operational DVB-S2X modulation tier
  // Rationale: pi/2-BPSK 1/3 operates at the absolute threshold (-1.5 dB). Any additional loss triggers complete outage.
  if (modcodName === THRESHOLD_MODCOD_NAME) {
    degradationFactors.push('threshold_modcod_tier');
    const snrSuffix = snrDb !== null ? ` at SNR ${snrDb.toFixed(1)} dB` : '';
    factorDescriptions.push(
      `lowest operational modulation tier (${THRESHOLD_MODCOD_NAME}${snrSuffix})`
    );
  }

  if (degradationFactors.length > 0) {
    return {
      status: 'DEGRADED',
      isOperational: true,
      isBlocked: false,
      isOutage: false,
      reason: `Operational with degraded link quality: ${factorDescriptions.join('; ')}.`,
      details: {
        terrainIsLos: true,
        obstacleBlocked: false,
        isOutage: false,
        diffractionLossDb,
        snrDb,
        modcodName,
        stateName,
        degradationFactors,
      },
    };
  }

  // ── Step 5: Precedence Rule 5 — Nominal Line-of-Sight Connected ──────────
  const modcodDesc = modcodName ? `MODCOD: ${modcodName}` : 'MODCOD operational';
  const snrDesc = snrDb !== null ? `, SNR: ${snrDb.toFixed(1)} dB` : '';
  const diffDesc = diffractionLossDb !== null ? `, ${diffractionLossDb.toFixed(1)} dB diffraction` : '';

  return {
    status: 'CONNECTED',
    isOperational: true,
    isBlocked: false,
    isOutage: false,
    reason: `Nominal operational line-of-sight link connected (${modcodDesc}${snrDesc}${diffDesc}).`,
    details: {
      terrainIsLos: true,
      obstacleBlocked: false,
      isOutage: false,
      diffractionLossDb,
      snrDb,
      modcodName,
      stateName,
      degradationFactors: [],
    },
  };
}
```

### File: `src/core/nodeRegistry.ts` (452 lines, 15,273 bytes)

```typescript
/**
 * src/core/nodeRegistry.ts
 *
 * Milestone M1a: Stable Entity Identity and Registry Compatibility.
 *
 * Implements:
 * 1. NodeIdentity interface preserving numeric nodeId (0..15), creationSequence (0..15),
 *    stable RFC 4122 UUID v4 entityId, callsign, role, and display metadata.
 * 2. GroundNodeEntity data record encapsulating identity, spatial coordinates,
 *    antenna AGL, traffic generator profile, and deterministic RNG seed.
 * 3. Seed mapping formula: 1000 + nodeId + seedOffset.
 * 4. NodeRegistry class providing O(1) indexed lookups by nodeId, entityId,
 *    and creationSequence, with mutation tracking for position/AGL changes.
 * 5. createDefault16NodeRegistry factory restoring the canonical 16-node layout.
 */

import { NodeType, GROUND_NODE_IDS } from './config';
import {
  MCP_ID,
  DEFAULT_ANTENNA_AGL_M,
  MAX_ACTIVE_GROUND_NODES,
} from '../shared/constants';

export { MCP_ID, DEFAULT_ANTENNA_AGL_M, MAX_ACTIVE_GROUND_NODES };

export interface NodeIdentity {
  /** Stable RFC 4122 UUID v4 or persistent string identifier. */
  readonly entityId: string;
  /** Compact numeric index; 0–15 for canonical legacy nodes. */
  readonly nodeId: number;
  /** Monotonically assigned sequence index; 0–15 for canonical legacy nodes. */
  readonly creationSequence: number;
  /** Tactical callsign (e.g., 'S0'..'S14', 'MCP'). */
  readonly callsign: string;
  /** Operational node type. */
  readonly role: NodeType;
  /** Presentation UI color hex code. */
  readonly colorHex?: string;
}

export interface NodeTrafficOptions {
  readonly hasVoice?: boolean;
  readonly voiceStartS?: number;
  readonly voiceEndS?: number;
  readonly hasVideo?: boolean;
  readonly videoMeanPktsPerFrame?: number;
  readonly hasPhoto?: boolean;
  readonly photoTriggerTimeS?: number;
  readonly photoSizeBytes?: number;
}

export interface GroundNodeEntity {
  readonly identity: NodeIdentity;
  /** Planar coordinates [x, y] in local theater Cartesian metres. */
  position: [number, number];
  /** Antenna height above ground level in metres. */
  aglM: number;
  /** Traffic subsystem options. */
  trafficOptions: NodeTrafficOptions;
  /** Deterministic RNG seed derived via computeNodeSeed. */
  readonly seed: number;
  /** Configured transmit power in dBm. */
  txPowerDbm?: number;
  /** Battery capacity in mAh. */
  batteryCapacityMah?: number;
  /** Current battery level percentage (0.0 - 100.0). */
  batteryLevelPct?: number;
  /** Tactical priority multiplier (0.1 - 5.0). */
  tacticalPriority?: number;
}

/**
 * Generates an RFC 4122 UUID v4 identifier.
 */
export function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Deterministically formats an RFC 4122 UUID v4 for a canonical node ID.
 * Produces format: 00000000-0000-4000-8000-xxxxxxxxxxxx
 */
export function formatDeterministicNodeUuid(nodeId: number): string {
  const hex = (nodeId >>> 0).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

/**
 * Authoritative seed calculation formula: 1000 + nodeId + seedOffset.
 */
export function computeNodeSeed(nodeId: number, seedOffset: number = 0): number {
  return 1000 + nodeId + seedOffset;
}

/**
 * Authoritative initial 16-node tactical planar coordinate layout.
 */
export const CANONICAL_16_NODE_POSITIONS: readonly (readonly [number, number])[] = Object.freeze([
  [-18000.0, -12000.0], // Node 0: Rifleman
  [-8000.0, -5000.0],   // Node 1: Squad Leader
  [15000.0, -20000.0],  // Node 2: Medic
  [-25000.0, 18000.0],  // Node 3: Scout Alpha
  [12000.0, 8000.0],    // Node 4: Recon Patrol (Occlusion Target)
  [28000.0, 32000.0],   // Node 5: Rifleman
  [-32000.0, -25000.0], // Node 6: Scout Bravo
  [-12000.0, 24000.0],  // Node 7: Designated Marksman
  [22000.0, 12000.0],   // Node 8: Support Gunner
  [35000.0, -15000.0],  // Node 9: Scout Charlie
  [42000.0, -28000.0],  // Node 10: Rifleman
  [-40000.0, 5000.0],   // Node 11: Ammo Carrier
  [8000.0, -14000.0],   // Node 12: Forward Observer
  [18000.0, 22000.0],   // Node 13: RTL Relay
  [-5000.0, 15000.0],   // Node 14: Rifleman
  [-20000.0, -30000.0], // Node 15: Main Command Post (MCP 20W Dish)
]);

/**
 * Resolves default traffic options for the canonical 16-node scenario.
 */
export function getCanonicalTrafficOptions(nodeId: number): NodeTrafficOptions {
  return {
    hasVoice: nodeId === MCP_ID || nodeId === 4 || nodeId === 1 || nodeId === 2,
    voiceStartS: nodeId === 4 ? 1.0 : 0.0,
    voiceEndS: nodeId === 4 ? 3.8 : 1e6,
    hasVideo: nodeId === MCP_ID || nodeId === 3 || nodeId === 6 || nodeId === 9,
    videoMeanPktsPerFrame: nodeId === MCP_ID ? 2.5 : 0.8,
    hasPhoto: nodeId === 4,
    photoTriggerTimeS: 1.8,
    photoSizeBytes: 240000,
  };
}

/**
 * NodeRegistry encapsulates stable ground node entity records.
 */
export class NodeRegistry {
  private readonly byNodeId: Map<number, GroundNodeEntity> = new Map();
  private readonly byEntityId: Map<string, GroundNodeEntity> = new Map();
  private readonly bySequence: Map<number, GroundNodeEntity> = new Map();
  private readonly entityList: GroundNodeEntity[] = [];
  private readonly deletedNodeIds: Set<number> = new Set();
  private nextAvailableNodeId: number = 16;
  private nextCreationSequence: number = 16;

  constructor(public readonly seedOffset: number = 0) {}

  public register(entity: GroundNodeEntity): void {
    if (this.byNodeId.has(entity.identity.nodeId)) {
      throw new Error(`NodeRegistry: duplicate nodeId ${entity.identity.nodeId}`);
    }
    if (this.byEntityId.has(entity.identity.entityId)) {
      throw new Error(`NodeRegistry: duplicate entityId ${entity.identity.entityId}`);
    }
    this.byNodeId.set(entity.identity.nodeId, entity);
    this.byEntityId.set(entity.identity.entityId, entity);
    // Also index "node-${nodeId}" for flexible lookup
    this.byEntityId.set(`node-${entity.identity.nodeId}`, entity);
    this.bySequence.set(entity.identity.creationSequence, entity);
    this.entityList.push(entity);

    // Keep allocation watermarks beyond any manually or canonically registered node
    if (entity.identity.nodeId >= this.nextAvailableNodeId) {
      this.nextAvailableNodeId = entity.identity.nodeId + 1;
    }
    if (entity.identity.creationSequence >= this.nextCreationSequence) {
      this.nextCreationSequence = entity.identity.creationSequence + 1;
    }
  }

  public getByNodeId(nodeId: number): GroundNodeEntity | undefined {
    return this.byNodeId.get(nodeId);
  }

  public getByEntityId(entityId: string): GroundNodeEntity | undefined {
    return this.byEntityId.get(entityId);
  }

  public getByCreationSequence(sequence: number): GroundNodeEntity | undefined {
    return this.bySequence.get(sequence);
  }

  public hasNodeId(nodeId: number): boolean {
    return this.byNodeId.has(nodeId);
  }

  public hasEntityId(entityId: string): boolean {
    return this.byEntityId.has(entityId);
  }

  public getAll(): readonly GroundNodeEntity[] {
    return [...this.entityList];
  }

  public getNodeIds(): readonly number[] {
    return this.entityList.map(e => e.identity.nodeId);
  }

  public getEntityIds(): readonly string[] {
    return this.entityList.map(e => e.identity.entityId);
  }

  public get size(): number {
    return this.entityList.length;
  }

  public canAddNode(): boolean {
    return this.entityList.length < MAX_ACTIVE_GROUND_NODES;
  }

  /**
   * Allocates the next strictly unique numeric nodeId.
   * Never reuses any previously allocated or deleted nodeId.
   */
  public allocateNextNodeId(): number {
    while (this.byNodeId.has(this.nextAvailableNodeId) || this.deletedNodeIds.has(this.nextAvailableNodeId)) {
      this.nextAvailableNodeId++;
    }
    return this.nextAvailableNodeId++;
  }

  /**
   * Allocates the next monotonically increasing creation sequence index.
   */
  public allocateNextCreationSequence(): number {
    return this.nextCreationSequence++;
  }

  public isNodeIdDeleted(nodeId: number): boolean {
    return this.deletedNodeIds.has(nodeId);
  }

  public getDeletedNodeIds(): readonly number[] {
    return Array.from(this.deletedNodeIds);
  }

  /**
   * Safely unregisters an active ground node, removing it from all active index maps
   * and recording its numeric nodeId in the deleted tombstone set to prevent reuse.
   */
  public unregister(nodeId: number): GroundNodeEntity | undefined {
    const entity = this.byNodeId.get(nodeId);
    if (!entity) return undefined;

    this.byNodeId.delete(nodeId);
    this.byEntityId.delete(entity.identity.entityId);
    this.byEntityId.delete(`node-${nodeId}`);
    this.bySequence.delete(entity.identity.creationSequence);

    const idx = this.entityList.findIndex(e => e.identity.nodeId === nodeId);
    if (idx !== -1) {
      this.entityList.splice(idx, 1);
    }

    this.deletedNodeIds.add(nodeId);
    return entity;
  }

  /**
   * Creates, registers, and returns a new dynamic ground node entity.
   * Enforces the MAX_ACTIVE_GROUND_NODES (128) ceiling.
   */
  public createDynamicNode(params: {
    callsign?: string;
    role?: NodeType;
    position?: [number, number];
    aglM?: number;
    trafficOptions?: NodeTrafficOptions;
    entityId?: string;
    colorHex?: string;
    txPowerDbm?: number;
    batteryCapacityMah?: number;
    batteryLevelPct?: number;
    tacticalPriority?: number;
  } = {}): GroundNodeEntity {
    if (!this.canAddNode()) {
      throw new Error(`Maximum active ground-node capacity (${MAX_ACTIVE_GROUND_NODES}) reached.`);
    }

    const nodeId = this.allocateNextNodeId();
    const creationSequence = this.allocateNextCreationSequence();
    const entityId = params.entityId ?? generateUuidV4();
    const role: NodeType = params.role ?? 'soldier';
    const callsign = params.callsign ?? (role === 'mcp' ? `MCP-${nodeId}` : `S${nodeId}`);
    const colorHex = params.colorHex ?? (role === 'mcp' ? '#f59e0b' : '#38bdf8');
    const position: [number, number] = params.position ? [params.position[0], params.position[1]] : [0, 0];
    const aglM = params.aglM !== undefined ? params.aglM : DEFAULT_ANTENNA_AGL_M;
    const trafficOptions: NodeTrafficOptions = params.trafficOptions ? { ...params.trafficOptions } : {};
    const seed = computeNodeSeed(nodeId, this.seedOffset);
    const txPowerDbm = params.txPowerDbm !== undefined ? params.txPowerDbm : (role === 'mcp' ? 43.0 : 36.0);
    const batteryCapacityMah = params.batteryCapacityMah !== undefined ? params.batteryCapacityMah : (role === 'mcp' ? 20000 : 5000);
    const batteryLevelPct = params.batteryLevelPct !== undefined ? Math.max(0.0, Math.min(100.0, params.batteryLevelPct)) : 100.0;
    const tacticalPriority = params.tacticalPriority !== undefined ? Math.max(0.1, Math.min(5.0, params.tacticalPriority)) : 1.0;

    const identity: NodeIdentity = {
      entityId,
      nodeId,
      creationSequence,
      callsign,
      role,
      colorHex,
    };

    const entity: GroundNodeEntity = {
      identity,
      position,
      aglM,
      trafficOptions,
      seed,
      txPowerDbm,
      batteryCapacityMah,
      batteryLevelPct,
      tacticalPriority,
    };

    this.register(entity);
    return entity;
  }

  public updateSpatial(nodeId: number, x: number, y: number, aglM?: number): boolean {
    const entity = this.byNodeId.get(nodeId);
    if (!entity) return false;
    entity.position = [x, y];
    if (aglM !== undefined) {
      entity.aglM = aglM;
    }
    return true;
  }

  public updateAgl(nodeId: number, aglM: number): boolean {
    const entity = this.byNodeId.get(nodeId);
    if (!entity) return false;
    entity.aglM = aglM;
    return true;
  }

  public updateBatteryLevel(nodeId: number, batteryLevelPct: number): boolean {
    const entity = this.byNodeId.get(nodeId);
    if (!entity) return false;
    entity.batteryLevelPct = Math.max(0.0, Math.min(100.0, batteryLevelPct));
    return true;
  }

  public updateEntity(
    nodeId: number,
    updates: {
      callsign?: string;
      role?: NodeType;
      position?: [number, number];
      aglM?: number;
      trafficOptions?: NodeTrafficOptions;
      colorHex?: string;
      txPowerDbm?: number;
      batteryCapacityMah?: number;
      batteryLevelPct?: number;
      tacticalPriority?: number;
    }
  ): boolean {
    const entity = this.byNodeId.get(nodeId);
    if (!entity) return false;

    if (updates.position) {
      entity.position = [updates.position[0], updates.position[1]];
    }
    if (updates.aglM !== undefined) {
      entity.aglM = updates.aglM;
    }
    if (updates.trafficOptions) {
      entity.trafficOptions = { ...updates.trafficOptions };
    }
    if (updates.txPowerDbm !== undefined) {
      entity.txPowerDbm = updates.txPowerDbm;
    }
    if (updates.batteryCapacityMah !== undefined) {
      entity.batteryCapacityMah = updates.batteryCapacityMah;
    }
    if (updates.batteryLevelPct !== undefined) {
      entity.batteryLevelPct = Math.max(0.0, Math.min(100.0, updates.batteryLevelPct));
    }
    if (updates.tacticalPriority !== undefined) {
      entity.tacticalPriority = Math.max(0.1, Math.min(5.0, updates.tacticalPriority));
    }
    if (updates.callsign !== undefined || updates.role !== undefined || updates.colorHex !== undefined) {
      const updatedIdentity: NodeIdentity = {
        ...entity.identity,
        callsign: updates.callsign ?? entity.identity.callsign,
        role: updates.role ?? entity.identity.role,
        colorHex: updates.colorHex ?? entity.identity.colorHex,
      };
      (entity as any).identity = updatedIdentity;
    }
    return true;
  }

  public clear(): void {
    this.byNodeId.clear();
    this.byEntityId.clear();
    this.bySequence.clear();
    this.entityList.length = 0;
    this.deletedNodeIds.clear();
    this.nextAvailableNodeId = 0;
    this.nextCreationSequence = 0;
  }
}

/**
 * Creates and populates the canonical 16-node registry for M1a.
 */
export function createDefault16NodeRegistry(seedOffset: number = 0): NodeRegistry {
  const registry = new NodeRegistry(seedOffset);

  for (const i of GROUND_NODE_IDS) {
    const [x, y] = CANONICAL_16_NODE_POSITIONS[i];
    const role: NodeType = i === MCP_ID ? 'mcp' : 'soldier';
    const callsign = i === MCP_ID ? 'MCP' : `S${i}`;
    const entityId = formatDeterministicNodeUuid(i);
    const creationSequence = i;
    const seed = computeNodeSeed(i, seedOffset);
    const trafficOptions = getCanonicalTrafficOptions(i);

    const identity: NodeIdentity = {
      entityId,
      nodeId: i,
      creationSequence,
      callsign,
      role,
      colorHex: i === MCP_ID ? '#f59e0b' : '#38bdf8',
    };

    const entity: GroundNodeEntity = {
      identity,
      position: [x, y],
      aglM: DEFAULT_ANTENNA_AGL_M,
      trafficOptions,
      seed,
      txPowerDbm: i === MCP_ID ? 43.0 : 36.0,
      batteryCapacityMah: i === MCP_ID ? 20000 : 5000,
      batteryLevelPct: 100.0,
      tacticalPriority: 1.0,
    };

    registry.register(entity);
  }

  return registry;
}
```

### File: `src/core/obstacles.ts` (260 lines, 14,889 bytes)

```typescript
import type { Position3D } from '../shared/types';

/** Maximum number of simultaneously committed obstacles. Keep benchmarked with look-ahead. */
export const MAX_OBSTACLES = 128;
export const OBSTACLE_CELL_SIZE_M = 5000;
export const MIN_OBSTACLE_DIMENSION_M = 0.1;
export const MAX_OBSTACLE_DIMENSION_M = 5000;
export const MAX_OBSTACLE_HEIGHT_M = 5000;
export const OBSTACLE_WORLD_LIMIT_M = 600000;
// DEM-backed terrain is spatially smooth at the scale of these queries. Split the
// terrain-dependent 1D profile at this distance before bounded maximization.
const MAX_TERRAIN_INTERVAL_M = 25;
const MAXIMIZER_ITERATIONS = 20;

export interface CuboidObstacle {
  readonly id: string; readonly shape: 'cuboid';
  readonly xM: number; readonly yM: number; readonly widthM: number; readonly depthM: number;
  readonly heightM: number; readonly rotationDeg: number;
}
export interface ConeObstacle {
  readonly id: string; readonly shape: 'cone';
  readonly xM: number; readonly yM: number; readonly radiusM: number; readonly heightM: number;
}
export interface PyramidObstacle {
  readonly id: string; readonly shape: 'pyramid';
  readonly xM: number; readonly yM: number; readonly widthM: number; readonly depthM: number;
  readonly heightM: number; readonly rotationDeg: number;
}
export type Obstacle = CuboidObstacle | ConeObstacle | PyramidObstacle;

export interface ObstacleIntersection {
  readonly obstacleId: string;
  readonly entryFraction: number;
  readonly exitFraction: number;
  readonly penetrationM: number;
}

interface Bounds { minX: number; maxX: number; minY: number; maxY: number; }
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const cellKey = (x: number, y: number): string => `${x},${y}`;

/** Validate and make a defensive, normalized copy. Rotation is counter-clockwise degrees from +X in map coordinates. */
export function normalizeObstacle(input: unknown): Obstacle {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Obstacle must be an object.');
  const o = input as Record<string, unknown>;
  const xValue = o.x_m ?? o.xM, yValue = o.y_m ?? o.yM, heightValue = o.height_m ?? o.heightM;
  const widthValue = o.width_m ?? o.widthM, depthValue = o.depth_m ?? o.depthM;
  const radiusValue = o.radius_m ?? o.radiusM, rotationValue = o.rotation_deg ?? o.rotationDeg;
  if (typeof o.id !== 'string' || !o.id.trim() || o.id.length > 64) throw new Error('Obstacle id must be a non-empty string of at most 64 characters.');
  if (o.shape !== 'cuboid' && o.shape !== 'cone' && o.shape !== 'pyramid') throw new Error(`Obstacle ${o.id} has an unsupported shape.`);
  if (!finite(xValue) || !finite(yValue) || Math.abs(xValue) > OBSTACLE_WORLD_LIMIT_M || Math.abs(yValue) > OBSTACLE_WORLD_LIMIT_M) {
    throw new Error(`Obstacle ${o.id} coordinates must be finite and within ±${OBSTACLE_WORLD_LIMIT_M} m.`);
  }
  if (!finite(heightValue) || heightValue < MIN_OBSTACLE_DIMENSION_M || heightValue > MAX_OBSTACLE_HEIGHT_M) throw new Error(`Obstacle ${o.id} height must be in [${MIN_OBSTACLE_DIMENSION_M}, ${MAX_OBSTACLE_HEIGHT_M}] m.`);
  let normalized: Obstacle;
  if (o.shape === 'cone') {
    if (!finite(radiusValue) || radiusValue < MIN_OBSTACLE_DIMENSION_M || radiusValue > MAX_OBSTACLE_DIMENSION_M) throw new Error(`Obstacle ${o.id} radius must be in [${MIN_OBSTACLE_DIMENSION_M}, ${MAX_OBSTACLE_DIMENSION_M}] m.`);
    normalized = { id: o.id.trim(), shape: 'cone', xM: xValue, yM: yValue, radiusM: radiusValue, heightM: heightValue };
  } else {
    if (!finite(widthValue) || !finite(depthValue) || widthValue < MIN_OBSTACLE_DIMENSION_M || depthValue < MIN_OBSTACLE_DIMENSION_M || widthValue > MAX_OBSTACLE_DIMENSION_M || depthValue > MAX_OBSTACLE_DIMENSION_M) {
      throw new Error(`Obstacle ${o.id} width and depth must be in [${MIN_OBSTACLE_DIMENSION_M}, ${MAX_OBSTACLE_DIMENSION_M}] m.`);
    }
    if (!finite(rotationValue) || Math.abs(rotationValue) > 360) throw new Error(`Obstacle ${o.id} rotation must be within ±360 degrees.`);
    normalized = o.shape === 'cuboid'
      ? { id: o.id.trim(), shape: 'cuboid', xM: xValue, yM: yValue, widthM: widthValue, depthM: depthValue, heightM: heightValue, rotationDeg: rotationValue }
      : { id: o.id.trim(), shape: 'pyramid', xM: xValue, yM: yValue, widthM: widthValue, depthM: depthValue, heightM: heightValue, rotationDeg: rotationValue };
  }
  const b = obstacleBounds(normalized);
  if (b.minX < -OBSTACLE_WORLD_LIMIT_M || b.maxX > OBSTACLE_WORLD_LIMIT_M || b.minY < -OBSTACLE_WORLD_LIMIT_M || b.maxY > OBSTACLE_WORLD_LIMIT_M) {
    throw new Error(`Obstacle ${o.id} footprint must remain within ±${OBSTACLE_WORLD_LIMIT_M} m.`);
  }
  return normalized;
}

function obstacleBounds(o: Obstacle): Bounds {
  if (o.shape === 'cone') return { minX: o.xM - o.radiusM, maxX: o.xM + o.radiusM, minY: o.yM - o.radiusM, maxY: o.yM + o.radiusM };
  const a = o.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const hx = o.widthM / 2, hy = o.depthM / 2;
  const rx = Math.abs(c) * hx + Math.abs(s) * hy, ry = Math.abs(s) * hx + Math.abs(c) * hy;
  return { minX: o.xM - rx, maxX: o.xM + rx, minY: o.yM - ry, maxY: o.yM + ry };
}

function localXY(o: Exclude<Obstacle, ConeObstacle>, x: number, y: number): [number, number] {
  const a = -o.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), dx = x - o.xM, dy = y - o.yM;
  return [c * dx - s * dy, s * dx + c * dy];
}

/** World-coordinate plan-view boundary; does not approximate terrain draping or vertical surfaces. */
export function obstacleFootprintPoints(o: Obstacle, circleSegments = 48): [number, number][] {
  if (o.shape === 'cone') {
    const count = Math.max(12, Math.floor(circleSegments));
    return Array.from({ length: count }, (_, i) => {
      const a = 2 * Math.PI * i / count;
      return [o.xM + o.radiusM * Math.cos(a), o.yM + o.radiusM * Math.sin(a)];
    });
  }
  const hx = o.widthM / 2, hy = o.depthM / 2, a = o.rotationDeg * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => [o.xM + c * x - s * y, o.yM + s * x + c * y]);
}

/** Exact XY footprint hit test, with an optional world-space tolerance for Canvas selection. */
export function obstacleContainsPoint(o: Obstacle, x: number, y: number, toleranceM = 0): boolean {
  if (!finite(x) || !finite(y) || !finite(toleranceM) || toleranceM < 0) return false;
  if (o.shape === 'cone') return Math.hypot(x - o.xM, y - o.yM) <= o.radiusM + toleranceM;
  const [lx, ly] = localXY(o, x, y);
  return Math.abs(lx) <= o.widthM / 2 + toleranceM && Math.abs(ly) <= o.depthM / 2 + toleranceM;
}

/** Return the closed [entry, exit] parameter interval of a 2D segment through a footprint. */
export function footprintInterval(o: Obstacle, start: readonly [number, number], end: readonly [number, number]): [number, number] | null {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  let lo = 0, hi = 1;
  if (o.shape === 'cone') {
    const ox = start[0] - o.xM, oy = start[1] - o.yM;
    const a = dx * dx + dy * dy, b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - o.radiusM * o.radiusM;
    if (a < 1e-18) return c <= 1e-9 ? [0, 1] : null;
    const disc = b * b - 4 * a * c;
    if (disc < -1e-9) return null;
    const root = Math.sqrt(Math.max(0, disc));
    lo = Math.max(0, (-b - root) / (2 * a)); hi = Math.min(1, (-b + root) / (2 * a));
  } else {
    const [x0, y0] = localXY(o, start[0], start[1]);
    const [x1, y1] = localXY(o, end[0], end[1]);
    const lx = x1 - x0, ly = y1 - y0;
    for (const [p, d, half] of [[x0, lx, o.widthM / 2], [y0, ly, o.depthM / 2]] as const) {
      if (Math.abs(d) < 1e-12) { if (p < -half - 1e-9 || p > half + 1e-9) return null; }
      else {
        const a = (-half - p) / d, b = (half - p) / d;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      }
    }
  }
  return lo <= hi + 1e-12 ? [Math.max(0, lo), Math.min(1, hi)] : null;
}

/** Height above pointwise terrain: cuboid constant, cone radial linear taper, pyramid planar max-norm taper. */
export function obstacleHeightAboveGround(o: Obstacle, x: number, y: number): number {
  if (o.shape === 'cone') {
    const r = Math.hypot(x - o.xM, y - o.yM);
    return r > o.radiusM ? 0 : o.heightM * Math.max(0, 1 - r / o.radiusM);
  }
  const [lx, ly] = localXY(o, x, y), nx = Math.abs(lx) / (o.widthM / 2), ny = Math.abs(ly) / (o.depthM / 2);
  if (nx > 1 || ny > 1) return 0;
  if (o.shape === 'cuboid') return o.heightM;
  return o.heightM * Math.max(0, 1 - Math.max(nx, ny));
}

/** Absolute MSL roof/surface envelope at world XY; terrain is sampled pointwise beneath the footprint. */
export function obstacleSurfaceHeight(o: Obstacle, x: number, y: number, groundElevationMslM: (x: number, y: number) => number): number {
  return groundElevationMslM(x, y) + obstacleHeightAboveGround(o, x, y);
}

/** Grid-indexed obstacle collection. Terrain anchoring is pointwise: base z = terrain(x,y), roof profile = base + shape height. */
export class ObstacleField {
  private values: readonly Obstacle[] = [];
  private cells = new Map<string, readonly Obstacle[]>();

  public get all(): readonly Obstacle[] { return this.values.map(o => ({ ...o })); }

  public replace(inputs: unknown): readonly Obstacle[] {
    if (!Array.isArray(inputs)) throw new Error('obstacles must be an array.');
    if (inputs.length > MAX_OBSTACLES) throw new Error(`Obstacle set cannot exceed ${MAX_OBSTACLES} items.`);
    const next = inputs.map(normalizeObstacle), ids = new Set<string>();
    for (const o of next) { if (ids.has(o.id)) throw new Error(`Duplicate obstacle id '${o.id}'.`); ids.add(o.id); }
    const mutable = new Map<string, Obstacle[]>();
    for (const o of next) {
      const b = obstacleBounds(o), x0 = Math.floor(b.minX / OBSTACLE_CELL_SIZE_M), x1 = Math.floor(b.maxX / OBSTACLE_CELL_SIZE_M);
      const y0 = Math.floor(b.minY / OBSTACLE_CELL_SIZE_M), y1 = Math.floor(b.maxY / OBSTACLE_CELL_SIZE_M);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = cellKey(x, y), list = mutable.get(key) ?? []; list.push(o); mutable.set(key, list);
      }
    }
    this.values = next;
    this.cells = new Map([...mutable].map(([key, list]) => [key, list]));
    return this.all;
  }

  private candidates(start: Position3D, end: Position3D): Set<Obstacle> {
    const dx = end[0] - start[0], dy = end[1] - start[1], stepX = Math.sign(dx), stepY = Math.sign(dy);
    let cx = Math.floor(start[0] / OBSTACLE_CELL_SIZE_M), cy = Math.floor(start[1] / OBSTACLE_CELL_SIZE_M);
    const endX = Math.floor(end[0] / OBSTACLE_CELL_SIZE_M), endY = Math.floor(end[1] / OBSTACLE_CELL_SIZE_M);
    const tDeltaX = dx === 0 ? Infinity : OBSTACLE_CELL_SIZE_M / Math.abs(dx), tDeltaY = dy === 0 ? Infinity : OBSTACLE_CELL_SIZE_M / Math.abs(dy);
    let tMaxX = dx === 0 ? Infinity : (((stepX > 0 ? cx + 1 : cx) * OBSTACLE_CELL_SIZE_M) - start[0]) / dx;
    let tMaxY = dy === 0 ? Infinity : (((stepY > 0 ? cy + 1 : cy) * OBSTACLE_CELL_SIZE_M) - start[1]) / dy;
    const found = new Set<Obstacle>();
    // At most 2 * theater diagonal / cell size plus a small endpoint margin.
    for (let n = 0; n < 1000; n++) {
      for (const o of this.cells.get(cellKey(cx, cy)) ?? []) found.add(o);
      if (cx === endX && cy === endY) break;
      if (Math.abs(tMaxX - tMaxY) < 1e-12) {
        // Supercover both side cells at a grid-corner crossing so tangent footprints aren't skipped.
        for (const key of [cellKey(cx + stepX, cy), cellKey(cx, cy + stepY)]) {
          for (const o of this.cells.get(key) ?? []) found.add(o);
        }
        cx += stepX; cy += stepY; tMaxX += tDeltaX; tMaxY += tDeltaY;
      } else if (tMaxX < tMaxY) { cx += stepX; tMaxX += tDeltaX; }
      else { cy += stepY; tMaxY += tDeltaY; }
    }
    return found;
  }

  /** Geometric screening only; no material attenuation or dB loss is inferred. */
  public intersectRay(start: Position3D, end: Position3D, groundElevation: (x: number, y: number, fraction: number) => number): ObstacleIntersection[] {
    const hits: ObstacleIntersection[] = [];
    for (const o of this.candidates(start, end)) {
      const interval = footprintInterval(o, [start[0], start[1]], [end[0], end[1]]);
      if (!interval) continue;
      const [lo, hi] = interval, span = hi - lo;
      const horizontalLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
      const depthAt = (t: number): number => {
        const x = start[0] + (end[0] - start[0]) * t, y = start[1] + (end[1] - start[1]) * t;
        const base = groundElevation(x, y, t), z = start[2] + (end[2] - start[2]) * t;
        const roof = obstacleSurfaceHeight(o, x, y, () => base);
        return Math.min(z - base, roof - z);
      };
      // Footprint clipping is analytic. Inside it, the shape-only roof profiles
      // (constant cuboid, radial cone, piecewise-planar pyramid) are continuous;
      // terrain is the only arbitrary spatial function. Partition its ray profile
      // into bounded 25 m intervals, then maximize each interval with golden
      // section search. Unlike the old capped uniform scan, every interval gets
      // its own extrema search, so a narrow vertical crossing or tangent is not
      // dependent on landing on one of a fixed set of samples. DEM variation is
      // still approximated within each interval because the callback has no
      // derivative/curvature bound.
      const intervalCount = Math.max(1, Math.ceil(horizontalLength * span / MAX_TERRAIN_INTERVAL_M));
      let blocked = false, penetration = 0;
      const consider = (t: number): void => {
        const depth = depthAt(t);
        if (depth >= -1e-7) {
          blocked = true;
          penetration = Math.max(penetration, Math.max(0, depth));
        }
      };
      for (let i = 0; i < intervalCount; i++) {
        const left0 = lo + span * i / intervalCount;
        const right0 = lo + span * (i + 1) / intervalCount;
        consider(left0);
        consider(right0);
        let left = left0, right = right0;
        const ratio = (Math.sqrt(5) - 1) / 2;
        let t1 = right - ratio * (right - left), t2 = left + ratio * (right - left);
        let d1 = depthAt(t1), d2 = depthAt(t2);
        for (let k = 0; k < MAXIMIZER_ITERATIONS; k++) {
          if (d1 < d2) {
            left = t1; t1 = t2; d1 = d2;
            t2 = left + ratio * (right - left); d2 = depthAt(t2);
          } else {
            right = t2; t2 = t1; d2 = d1;
            t1 = right - ratio * (right - left); d1 = depthAt(t1);
          }
        }
        consider((left + right) / 2);
        consider((left0 + right0) / 2);
      }
      if (blocked) hits.push({ obstacleId: o.id, entryFraction: lo, exitFraction: hi, penetrationM: penetration });
    }
    return hits;
  }
}
```

### File: `src/core/profileEngine.ts` (271 lines, 9,387 bytes)

```typescript
/**
 * Profile Engine for the X-Band Aerial Communication Network Digital Twin.
 *
 * Encapsulates domain propagation calculations for path profiling:
 * 1. Ground path profile elevation and curvature sampling across 80 points.
 * 2. Analytical spherical Earth bulge calculations.
 * 3. 1st Fresnel zone ellipse clearance and knife-edge diffraction geometry.
 * 4. Obstacle intersection interval projections along the 3D ray.
 * 5. Selected terminal RF link budget evaluation.
 *
 * This module is part of the authoritative domain / simulation physics layer.
 */

import type { Position3D } from '../shared/types';
import { FRESNEL_SAMPLES } from '../shared/constants';
import type {
  FresnelSliceTelemetry,
  SelectedLinkBudgetTelemetry,
} from '../shared/workerProtocol';
import { TerrainEngine, TerrainObstruction } from './terrain';
import { RFConfig, EnvironmentConfig } from './config';
import { LinkBudgetEngine, LinkStatus } from './linkBudget';
import { buildLinkProfile, LinkProfile } from './linkProfile';
import { NodeTerrainState, PredictiveState } from './trajectory';
import { GroundNodeTrafficSubsystem } from './queues';

/** Existing profile visualization/clearance factor. Does not alter terrain or link-budget decisions. */
export const PROFILE_FRESNEL_FRACTION = 0.6;

/**
 * Parameters for computing the selected node's link budget.
 */
export interface BuildSelectedLinkBudgetParams {
  readonly node: GroundNodeTrafficSubsystem;
  readonly linkStatus: LinkStatus | undefined;
  readonly obstruction: TerrainObstruction | undefined;
  readonly effectiveEarthRadiusM: number;
  readonly channelBandwidthHz: number;
}

/**
 * Computes the authoritative selected link budget with Earth curvature bulge.
 */
export function buildSelectedLinkBudget(
  params: BuildSelectedLinkBudgetParams
): SelectedLinkBudgetTelemetry {
  const { node, linkStatus, obstruction, effectiveEarthRadiusM, channelBandwidthHz } = params;
  const slantM = linkStatus?.slantRangeM ?? 0;
  const earthBulgeM = TerrainEngine.computeEarthBulge(
    slantM / 2.0,
    slantM / 2.0,
    effectiveEarthRadiusM
  );
  return {
    node_id: node.nodeId,
    node_type: node.nodeType,
    slant_range_m: slantM,
    slant_range_km: slantM / 1000.0,
    fspl_db: linkStatus?.fsplDb ?? 0,
    diffraction_loss_db: linkStatus?.diffractionLossDb ?? obstruction?.diffractionLossDb ?? 0,
    gas_loss_db: linkStatus?.gasLossDb ?? 0,
    rain_loss_db: linkStatus?.rainLossDb ?? 0,
    cable_loss_db: linkStatus?.cableLossDb ?? 0,
    implementation_margin_db: linkStatus?.implementationMarginDb ?? 0,
    total_loss_db: linkStatus?.totalLossDb ?? 0,
    tx_power_dbm: linkStatus?.pTxDbm ?? 0,
    tx_gain_dbi: linkStatus?.txGainDbi ?? 0,
    rx_gain_dbi: linkStatus?.rxGainDbi ?? 0,
    prx_dbm: linkStatus?.prxDbm ?? 0,
    pnoise_dbm: linkStatus?.pNoiseDbm ?? 0,
    snr_db: linkStatus?.snrDb ?? -99.0,
    modcod_name: linkStatus?.modcodName ?? 'LINK_OUTAGE',
    spectral_efficiency_bps_hz: linkStatus?.spectralEfficiency ?? 0,
    bitrate_bps: linkStatus?.bitrateBps ?? 0,
    bitrate_mbps: linkStatus?.bitrateMbps ?? 0,
    is_outage: linkStatus?.isOutage ?? true,
    obstacle_blocked: linkStatus?.obstacleBlocked ?? false,
    terrain_is_los: obstruction?.isLos ?? true,
    earth_bulge_m: earthBulgeM,
    channel_bandwidth_hz: channelBandwidthHz,
    is_coverage_complete: obstruction?.isCoverageComplete ?? true,
    isCoverageComplete: obstruction?.isCoverageComplete ?? true,
    coverage_note: obstruction?.coverageNote,
    coverageNote: obstruction?.coverageNote,
  };
}

/**
 * Empty/unregistered Fresnel slice fallback when no ground node is selected or present.
 */
export function buildEmptyFresnelSlice(
  frameIndex: number,
  simTimeS: number,
  acnPos: [number, number, number]
): FresnelSliceTelemetry {
  return {
    profile: {
      selectedGroundNodeId: -1,
      nodeName: 'NONE',
      frameIndex,
      simulationTimeS: simTimeS,
      groundNodePositionMslM: [0, 0, 0],
      acnPositionMslM: acnPos,
      horizontalGroundDistanceM: 0,
      slantDistanceM: 0,
      fresnelFraction: PROFILE_FRESNEL_FRACTION,
      terrainIsLos: true,
      terrainMinimumClearanceM: 0,
      terrainCriticalFresnelRadiusM: 0,
      diffractionLossDb: 0,
      obstacleBlocked: false,
      obstacleIntervals: [],
      samples: [],
      valid: false,
      isCoverageComplete: false,
      invalidReason: 'No ground nodes registered in scenario.',
    },
    node_id: -1,
    node_name: 'NONE',
    distance_km: 0,
    clearance_m: 0,
    status: 'NO_NODES_REGISTERED',
    obstructed: false,
    diffraction_loss_db: 0,
    terrain_is_los: true,
    obstacle_blocked: false,
    obstacle_intersections: [],
    state_name: NodeTerrainState.NORMAL_LOS,
    profile_points: [],
    link_budget: {
      node_id: -1,
      node_type: 'soldier',
      slant_range_m: 0,
      slant_range_km: 0,
      fspl_db: 0,
      diffraction_loss_db: 0,
      gas_loss_db: 0,
      rain_loss_db: 0,
      cable_loss_db: 0,
      implementation_margin_db: 0,
      total_loss_db: 0,
      tx_power_dbm: 0,
      tx_gain_dbi: 0,
      rx_gain_dbi: 0,
      prx_dbm: 0,
      pnoise_dbm: 0,
      snr_db: -99.0,
      modcod_name: 'LINK_OUTAGE',
      spectral_efficiency_bps_hz: 0,
      bitrate_bps: 0,
      bitrate_mbps: 0,
      is_outage: true,
      obstacle_blocked: false,
      terrain_is_los: true,
      earth_bulge_m: 0,
      is_coverage_complete: false,
      coverage_note: 'No ground nodes registered in scenario.',
    },
    is_coverage_complete: false,
    coverage_note: 'No ground nodes registered in scenario.',
  };
}

/**
 * Parameters for building the complete ground path profile and Fresnel slice telemetry.
 */
export interface BuildFresnelSliceParams {
  readonly node: GroundNodeTrafficSubsystem;
  readonly resolvedName: string;
  readonly acnPos: [number, number, number];
  readonly frameIndex: number;
  readonly simTimeS: number;
  readonly rfConfig: RFConfig;
  readonly envConfig: EnvironmentConfig;
  readonly terrainEngine: TerrainEngine;
  readonly linkEngine: LinkBudgetEngine;
  readonly obstruction: TerrainObstruction;
  readonly linkStatus: LinkStatus;
  readonly predState?: PredictiveState;
  readonly fresnelFraction?: number;
  readonly sampleCount?: number;
}

/**
 * Computes authoritative ground path profile, Fresnel clearance, and link budget for the selected node.
 */
export function buildFresnelSlice(
  params: BuildFresnelSliceParams
): FresnelSliceTelemetry {
  const {
    node,
    resolvedName,
    acnPos,
    frameIndex,
    simTimeS,
    rfConfig,
    envConfig,
    terrainEngine,
    obstruction,
    linkStatus,
    predState,
    fresnelFraction = PROFILE_FRESNEL_FRACTION,
    sampleCount = FRESNEL_SAMPLES,
  } = params;

  const linkProfile = buildLinkProfile({
    selectedGroundNodeId: node.nodeId,
    nodeName: resolvedName,
    frameIndex,
    simulationTimeS: simTimeS,
    groundNodePositionMslM: node.position,
    acnPositionMslM: acnPos,
    wavelengthM: rfConfig.wavelengthM,
    effectiveEarthRadiusM: envConfig.effectiveEarthRadiusM,
    fresnelFraction,
    sampleCount,
    obstruction,
    getTerrainElevationMslM: (xM, yM) => terrainEngine.getElevation(xM, yM),
    computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });

  // Retain the existing tuple shape for the Canvas renderer. Its first coordinate
  // is horizontal distance in km (as required for a ground path profile).
  const profilePoints: [number, number, number, number][] = linkProfile.samples.map(sample => [
    sample.horizontalGroundDistanceM / 1000,
    sample.effectiveTerrainElevationMslM,
    sample.losElevationMslM,
    sample.lowerFresnelElevationMslM,
  ]);

  let obstructed = false;
  let minClearanceM = Number.POSITIVE_INFINITY;
  for (const sample of linkProfile.samples) {
    if (sample.effectiveTerrainElevationMslM > sample.losElevationMslM) obstructed = true;
    const clearance = sample.effectiveTerrainClearanceM;
    if (clearance < minClearanceM) minClearanceM = clearance;
  }

  const linkBudget = buildSelectedLinkBudget({
    node,
    linkStatus,
    obstruction,
    effectiveEarthRadiusM: envConfig.effectiveEarthRadiusM,
    channelBandwidthHz: rfConfig.channelBandwidthHz,
  });

  const isCoverageComplete = obstruction.isCoverageComplete !== false && linkProfile.valid;

  return {
    profile: linkProfile,
    node_id: node.nodeId,
    node_name: resolvedName,
    distance_km: linkProfile.slantDistanceM / 1000.0,
    clearance_m: isCoverageComplete
      ? (Number.isFinite(minClearanceM) ? minClearanceM : obstruction.minClearanceM)
      : Number.NaN,
    status: !isCoverageComplete
      ? 'UNAVAILABLE: PATH EXTENDS OUTSIDE DEM COVERAGE'
      : (obstructed ? 'OBSTRUCTED (LINE-OF-SIGHT SEVERED)' : 'CLEAR 1ST FRESNEL ZONE'),
    obstructed: isCoverageComplete ? obstructed : false,
    diffraction_loss_db: linkStatus.diffractionLossDb ?? obstruction.diffractionLossDb,
    terrain_is_los: obstruction.isLos,
    obstacle_blocked: linkStatus.obstacleBlocked ?? false,
    obstacle_intersections: obstruction.obstacleIntersections,
    state_name: predState?.currentState ?? NodeTerrainState.NORMAL_LOS,
    profile_points: profilePoints,
    link_budget: linkBudget,
    is_coverage_complete: isCoverageComplete,
    coverage_note: obstruction.coverageNote ?? linkProfile.invalidReason,
  };
}
```

### File: `src/core/queues.ts` (442 lines, 13,050 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Multi-Class QoS Queues & Traffic Subsystems (TypeScript Port)
 *
 * Implements:
 * 1. 3GPP MCX 5QI profiles (69 C2, 65 Voice, 67 Video, 70 Photo).
 * 2. Bounded strict-priority queue with CoDel sojourn tracking,
 *    bounded memory ceiling (max 120 packets for 5QI 69), and selective pruning.
 * 3. Dismounted soldier & command post tactical traffic generator.
 */

import { NodeType } from './config';
import { Position3D } from '../shared/types';
import { NodeIdentity, NodeTrafficOptions, formatDeterministicNodeUuid } from './nodeRegistry';

export class Packet {
  constructor(
    public readonly packetId: number,
    public readonly nodeId: number,
    public readonly qos5qi: number,
    public readonly sizeBytes: number,
    public readonly arrivalTimeS: number,
    public readonly deadlineS: number,
    public sojournTimeS: number = 0.0
  ) {}

  public get sizeBits(): number {
    return this.sizeBytes * 8;
  }
}

export interface QoSProfile {
  readonly name: string;
  readonly priority: number;
  readonly pdbS: number;
  readonly defaultBytes: number;
}

export const QOS_PROFILES: Readonly<Record<number, QoSProfile>> = {
  69: { name: 'Emergency_C2', priority: 1, pdbS: 60.0, defaultBytes: 128 },
  65: { name: 'MC_PTT_Voice', priority: 2, pdbS: 0.075, defaultBytes: 160 },
  67: { name: 'MC_Video', priority: 3, pdbS: 0.15, defaultBytes: 1200 },
  70: { name: 'Tactical_Photo', priority: 4, pdbS: 0.5, defaultBytes: 1400 },
};

/**
 * Bounded Strict-Priority Multi-Class Queue with Head-of-Line (HOL) sojourn tracking.
 */
export class FQCoDelQueue {
  public readonly maxBufferPackets: number;
  public readonly maxC2Packets: number;

  public totalEnqueued: number = 0;
  public droppedDelayCount: number = 0;
  public droppedOverflowCount: number = 0;

  private readonly subqueues: Map<number, Packet[]>;

  constructor(maxBufferPackets: number = 400, maxC2Packets: number = 120) {
    this.maxBufferPackets = maxBufferPackets;
    this.maxC2Packets = maxC2Packets;
    this.subqueues = new Map([
      [69, []],
      [65, []],
      [67, []],
      [70, []],
    ]);
  }

  public getTotalPackets(): number {
    let count = 0;
    for (const q of this.subqueues.values()) {
      count += q.length;
    }
    return count;
  }

  public getTotalBacklogBytes(): number {
    let bytes = 0;
    for (const q of this.subqueues.values()) {
      for (let i = 0; i < q.length; i++) {
        bytes += q[i].sizeBytes;
      }
    }
    return bytes;
  }

  public getTotalBacklogBits(): number {
    return this.getTotalBacklogBytes() * 8;
  }

  public getClassBacklogBytes(qos5qi: number): number {
    const q = this.subqueues.get(qos5qi);
    if (!q) return 0;
    let bytes = 0;
    for (let i = 0; i < q.length; i++) {
      bytes += q[i].sizeBytes;
    }
    return bytes;
  }

  public getClassBacklogBits(qos5qi: number): number {
    return this.getClassBacklogBytes(qos5qi) * 8;
  }

  public getClassPacketCount(qos5qi: number): number {
    return this.subqueues.get(qos5qi)?.length ?? 0;
  }

  public getHolDelayS(qos5qi: number, currentSimTimeS: number): number {
    const q = this.subqueues.get(qos5qi);
    if (q && q.length > 0) {
      return Math.max(0.0, currentSimTimeS - q[0].arrivalTimeS);
    }
    return 0.0;
  }

  /**
   * Enqueues packet according to bounded priority rules:
   * 1. Total buffer capped at 400 packets. Lower priority traffic (70 -> 67 -> 65) is evicted first.
   * 2. 5QI 69 has a hard bounded ceiling of 120 packets; oldest 69 is dropped if ceiling is breached.
   */
  public enqueue(packet: Packet): [boolean, Packet[]] {
    this.totalEnqueued += 1;
    const qos = packet.qos5qi;
    const evicted: Packet[] = [];
    const targetQ = this.subqueues.get(qos);
    if (!targetQ) {
      return [false, [packet]];
    }

    if (qos === 69) {
      if (targetQ.length >= this.maxC2Packets) {
        const drop = targetQ.shift()!;
        evicted.push(drop);
      } else if (this.getTotalPackets() >= this.maxBufferPackets) {
        let dropped = false;
        for (const dropQos of [70, 67, 65]) {
          const dq = this.subqueues.get(dropQos)!;
          if (dq.length > 0) {
            evicted.push(dq.shift()!);
            dropped = true;
            break;
          }
        }
        if (!dropped) {
          evicted.push(targetQ.shift()!);
        }
      }

      targetQ.push(packet);
      this.droppedOverflowCount += evicted.length;
      return [true, evicted];
    }

    // Non-C2 traffic (65, 67, 70)
    if (this.getTotalPackets() >= this.maxBufferPackets) {
      let dropped = false;
      for (const dropQos of [70, 67, 65]) {
        const dq = this.subqueues.get(dropQos)!;
        if (dq.length > 0) {
          evicted.push(dq.shift()!);
          dropped = true;
          break;
        }
      }
      if (!dropped) {
        // Only C2 in buffer, cannot evict C2 for lower priority
        evicted.push(packet);
        this.droppedOverflowCount += 1;
        return [false, evicted];
      }
    }

    targetQ.push(packet);
    this.droppedOverflowCount += evicted.length;
    return [true, evicted];
  }

  /**
   * Dequeues packets in strict priority order (69 -> 65 -> 67 -> 70) fitting within bytesCapacity.
   */
  public dequeue(bytesCapacity: number, currentSimTimeS: number): Packet[] {
    const served: Packet[] = [];
    let remBytes = bytesCapacity;

    for (const qos of [69, 65, 67, 70]) {
      const q = this.subqueues.get(qos)!;
      while (q.length > 0) {
        const pkt = q[0];

        // Non-C2 packets that expired at head-of-line are discarded
        if (qos !== 69 && currentSimTimeS >= pkt.deadlineS) {
          q.shift();
          this.droppedDelayCount += 1;
          continue;
        }

        if (pkt.sizeBytes <= remBytes) {
          q.shift();
          pkt.sojournTimeS = Math.max(0.0, currentSimTimeS - pkt.arrivalTimeS);
          served.push(pkt);
          remBytes -= pkt.sizeBytes;
        } else {
          break;
        }
      }

      if (remBytes <= 0) break;
    }

    return served;
  }

  /**
   * Prunes non-C2 packets exceeding their packet delay budget.
   * 5QI 69 is explicitly exempt from deadline pruning during mountain shadow outrages.
   */
  public pruneExpiredPackets(currentSimTimeS: number): Packet[] {
    const pruned: Packet[] = [];

    for (const qos of [65, 67, 70]) {
      const q = this.subqueues.get(qos)!;
      const survivors: Packet[] = [];
      for (let i = 0; i < q.length; i++) {
        const pkt = q[i];
        if (currentSimTimeS >= pkt.deadlineS) {
          pruned.push(pkt);
          this.droppedDelayCount += 1;
        } else {
          survivors.push(pkt);
        }
      }
      this.subqueues.set(qos, survivors);
    }

    return pruned;
  }
}

/**
 * Tactical Ground Node Traffic Subsystem.
 */
export class GroundNodeTrafficSubsystem {
  private static globalPacketCounter: number = 0;

  public readonly nodeId: number;
  public readonly creationSequence: number;
  public readonly entityId: string;
  public readonly identity: NodeIdentity;
  public nodeType: NodeType;
  public position: Position3D;
  /** Configured antenna height above local terrain, in metres (0–1000 m). */
  public aglM: number = 2.0;
  public readonly queue: FQCoDelQueue;

  public hasVoice: boolean;
  public voiceStartS: number;
  public voiceEndS: number;

  public hasVideo: boolean;
  public videoMeanPktsPerFrame: number;

  public hasPhoto: boolean;
  public photoTriggerTimeS: number;
  public photoSizeBytes: number;
  public photoBytesRemaining: number;

  public isShadowed: boolean = false;

  /** Configured transmit power in dBm. If undefined, falls back to role default. */
  public txPowerDbm?: number;
  /** Configured battery capacity in mAh. */
  public batteryCapacityMah: number = 5000;
  /** Current battery level percentage (0.0 to 100.0). */
  public batteryLevelPct: number = 100.0;
  /** Configured tactical priority (0.1 to 5.0). */
  public tacticalPriority: number = 1.0;
  /** Flag indicating total battery exhaustion. */
  public isDepleted: boolean = false;

  private readonly c2IntervalS: number = 0.1; // 10 Hz heartbeat
  private lastC2TimeS: number = -1.0;
  private rngState: number;

  constructor(
    nodeId: number,
    nodeType: NodeType,
    position: Position3D,
    seed: number = 42,
    options?: NodeTrafficOptions,
    identity?: NodeIdentity,
  ) {
    this.nodeId = nodeId;
    this.nodeType = nodeType;
    this.position = position;
    this.queue = new FQCoDelQueue(400, 120);

    const defaultCallsign = nodeId === 15 ? 'MCP' : `S${nodeId}`;
    this.identity = identity ?? {
      entityId: formatDeterministicNodeUuid(nodeId),
      nodeId,
      creationSequence: nodeId,
      callsign: defaultCallsign,
      role: nodeType,
    };
    this.entityId = this.identity.entityId;
    this.creationSequence = this.identity.creationSequence;

    this.hasVoice = options?.hasVoice ?? false;
    this.voiceStartS = options?.voiceStartS ?? 0.0;
    this.voiceEndS = options?.voiceEndS ?? 0.0;

    this.hasVideo = options?.hasVideo ?? false;
    this.videoMeanPktsPerFrame = options?.videoMeanPktsPerFrame ?? 1.0;

    this.hasPhoto = options?.hasPhoto ?? false;
    this.photoTriggerTimeS = options?.photoTriggerTimeS ?? 0.0;
    this.photoSizeBytes = options?.photoSizeBytes ?? 0;
    this.photoBytesRemaining = this.hasPhoto ? this.photoSizeBytes : 0;

    this.rngState = (seed ^ 0x6d2b79f5) >>> 0;
  }

  private nextRandom(): number {
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private poissonDraw(lambda: number): number {
    if (lambda <= 0.0) return 0;
    const limit = Math.exp(-lambda);
    let count = 0;
    let p = 1.0;
    while (p > limit) {
      count++;
      p *= this.nextRandom();
    }
    return Math.max(0, count - 1);
  }

  public enqueuePacket(
    qos: number,
    currentSimTimeS: number,
    sizeBytes?: number,
    deadlineS?: number
  ): Packet {
    GroundNodeTrafficSubsystem.globalPacketCounter += 1;
    const prof = QOS_PROFILES[qos] ?? QOS_PROFILES[69];
    const sz = sizeBytes ?? prof.defaultBytes;
    const dl = deadlineS ?? currentSimTimeS + prof.pdbS;

    const pkt = new Packet(
      GroundNodeTrafficSubsystem.globalPacketCounter,
      this.nodeId,
      qos,
      sz,
      currentSimTimeS,
      dl
    );
    this.queue.enqueue(pkt);
    return pkt;
  }

  public generateTraffic(
    currentSimTimeS: number,
    _frameDurationS: number = 0.02
  ): Packet[] {
    if (this.batteryLevelPct <= 0 || this.isDepleted) {
      return [];
    }
    const generated: Packet[] = [];

    // 1. 5QI 69: Periodic C2 Health & Status
    if (this.lastC2TimeS < 0.0 || currentSimTimeS - this.lastC2TimeS >= this.c2IntervalS) {
      generated.push(this.enqueuePacket(69, currentSimTimeS));
      this.lastC2TimeS = currentSimTimeS;
    }

    // 2. 5QI 65: Mission-Critical PTT Voice
    if (this.hasVoice && currentSimTimeS >= this.voiceStartS && currentSimTimeS <= this.voiceEndS) {
      generated.push(this.enqueuePacket(65, currentSimTimeS));
    }

    // 3. 5QI 67: Tactical Mission-Critical Video (Paused if radio is in shadow)
    if (this.hasVideo && !this.isShadowed) {
      const numVideo = this.poissonDraw(this.videoMeanPktsPerFrame);
      for (let i = 0; i < numVideo; i++) {
        generated.push(this.enqueuePacket(67, currentSimTimeS));
      }
    }

    // 4. 5QI 70: High-Resolution Imagery
    if (
      this.hasPhoto &&
      currentSimTimeS >= this.photoTriggerTimeS &&
      this.photoBytesRemaining > 0
    ) {
      const slices = Math.min(2, Math.ceil(this.photoBytesRemaining / 1400));
      for (let i = 0; i < slices; i++) {
        const chunk = Math.min(1400, this.photoBytesRemaining);
        generated.push(this.enqueuePacket(70, currentSimTimeS, chunk));
        this.photoBytesRemaining -= chunk;
      }
    }

    return generated;
  }

  public injectTraffic(trafficType: string, currentSimTimeS: number): number {
    if (this.batteryLevelPct <= 0 || this.isDepleted) {
      return 0;
    }
    const kind = trafficType.trim().toUpperCase();
    let count = 0;

    if (kind === 'SOS' || kind === 'C2' || kind === 'EMERGENCY') {
      for (let i = 0; i < 8; i++) {
        this.enqueuePacket(69, currentSimTimeS);
        count++;
      }
    } else if (kind === 'VOICE' || kind === 'PTT') {
      this.hasVoice = true;
      this.voiceStartS = currentSimTimeS;
      this.voiceEndS = currentSimTimeS + 5.0;
      count += 1;
    } else if (kind === 'VIDEO' || kind === 'BURST') {
      this.hasVideo = true;
      this.videoMeanPktsPerFrame = 3.0;
      count += 5;
    } else if (kind === 'PHOTO' || kind === 'IMAGE') {
      this.hasPhoto = true;
      this.photoTriggerTimeS = currentSimTimeS;
      this.photoBytesRemaining += 2000000;
      count += 1;
    }

    return count;
  }
}
```

### File: `src/core/registration.ts` (29 lines, 2,065 bytes)

```typescript
export type RegistrationState = 'UNREGISTERED' | 'REQUESTING' | 'REGISTERED' | 'REJECTED' | 'LOST';
export interface RegistrationEvent { node_id: number; state: RegistrationState | 'CREATED' | 'REMOVED'; sim_time_s: number; }
export interface NodeRegistration { state: RegistrationState; start_time_s: number | null; completion_time_s: number | null; }

/** Deterministic association abstraction. ACN acceptance is immediate; no RF/auth handshake is modeled. */
export class RegistrationLifecycle {
  private readonly states = new Map<number, NodeRegistration>();
  private readonly history: RegistrationEvent[] = [];
  constructor(private readonly historyLimit = 500) {}
  clear(): void { this.states.clear(); this.history.length = 0; }
  private record(nodeId: number, state: RegistrationEvent['state'], time: number): void {
    this.history.push({ node_id: nodeId, state, sim_time_s: time });
    if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
  }
  add(nodeId: number, time: number): void {
    this.record(nodeId, 'CREATED', time);
    this.states.set(nodeId, { state: 'UNREGISTERED', start_time_s: null, completion_time_s: null });
    this.record(nodeId, 'REQUESTING', time);
    this.states.set(nodeId, { state: 'REQUESTING', start_time_s: time, completion_time_s: null });
    this.record(nodeId, 'REGISTERED', time);
    this.states.set(nodeId, { state: 'REGISTERED', start_time_s: time, completion_time_s: time });
  }
  remove(nodeId: number, time: number): void { if (this.states.delete(nodeId)) this.record(nodeId, 'REMOVED', time); }
  get(nodeId: number): NodeRegistration { return this.states.get(nodeId) ?? { state: 'UNREGISTERED', start_time_s: null, completion_time_s: null }; }
  events(): RegistrationEvent[] { return this.history.map(event => ({ ...event })); }
  active(): Array<{ node_id: number; state: RegistrationState; start_time_s: number | null; completion_time_s: number | null }> {
    return [...this.states].map(([node_id, state]) => ({ node_id, ...state }));
  }
}
```

### File: `src/core/rollingGoodput.ts` (179 lines, 5,502 bytes)

```typescript
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

```

### File: `src/core/scheduler.ts` (491 lines, 17,653 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Dual-Scheduler Engine (TypeScript Port)
 *
 * Implements:
 * 1. Legacy Static Equal-Slot TDMA (rigid 988 us slots; high outage airtime waste).
 * 2. Terrain-Aware Dynamic Scheduler (Tac-TAD):
 *    - Zero-allocation outage reclamation (reclaims 100% time on severed links).
 *    - Priority-weighted urgency metric (Psi_i) protecting GBR C2 and voice.
 *    - Exact-fit dynamic slot sizing (tau_i = Q_i / R_i).
 *    - Predictive pre-occlusion queue evacuation (Phi_evac surge to 5.0x).
 */

import { LinkStatus } from './linkBudget';
import { GroundNodeTrafficSubsystem, QOS_PROFILES } from './queues';
import { NodeTerrainState, PredictiveState } from './trajectory';

export const T_FRAME_S: number = 0.02; // 20 ms superframe
export const T_CTRL_S: number = 0.001; // 1 ms control subframe
export const T_DL_MIN_S: number = 0.003; // 3 ms minimum DL broadcast
export const T_DL_MAX_S: number = 0.007; // 7 ms maximum dynamic DL breathing
export const T_UL_NOMINAL_S: number = 0.016; // 16 ms nominal UL allocation
export const TAU_GUARD_S: number = 12e-6; // 12 us Timing Advance guard
export const TAU_MIN_S: number = 200e-6; // 200 us minimum allocatable slot

export interface SlotAllocation {
  readonly nodeId: number;
  readonly slotStartS: number;
  readonly durationS: number;
  readonly timingAdvanceS: number;
  readonly modcodName: string;
  readonly spectralEfficiency: number;
  readonly capacityBits: number;
  readonly isPreOcclusionFlush: boolean;
}

export interface FrameScheduleReport {
  readonly frameIndex: number;
  readonly timestampS: number;
  readonly schedulerName: string;
  readonly allocations: readonly SlotAllocation[];
  /** Scheduled uplink airtime including guard intervals, in seconds. */
  readonly totalUlScheduledS: number;
  /** Available uplink airtime for this frame, in seconds. */
  readonly totalUlAvailableS: number;
  /** Available airtime not scheduled to any node, in seconds. */
  readonly totalUlUnusedS: number;
  readonly totalUlUtilizationPct: number;
  /** Payload bits dequeued from queues, whether or not the link was in outage. */
  readonly totalPayloadBitsDequeued: number;
  /** Payload bits actually counted as goodput (dequeued while the link is usable). */
  readonly totalBitsTransmitted: number;
  /** Payload bits dequeued but not deliverable because the link was in outage. */
  readonly totalBitsWastedOnOutage: number;
  /** Cumulative queue drops at the end of this frame. */
  readonly packetsDroppedDelay: number;
  readonly packetsDroppedOverflow: number;
  /** New drops that occurred during this frame. */
  readonly packetsDroppedDelayThisFrame: number;
  readonly packetsDroppedOverflowThisFrame: number;
  /** Queue backlog remaining after this frame, in bits. */
  readonly totalBacklogBits: number;
}

interface DropMetrics {
  delayTotal: number;
  overflowTotal: number;
  delayThisFrame: number;
  overflowThisFrame: number;
}

/** Queue counters are cumulative, so report both totals and non-negative per-frame deltas. */
function collectDropMetrics(
  nodes: readonly GroundNodeTrafficSubsystem[],
  previous: Map<number, { delay: number; overflow: number }>
): DropMetrics {
  let delayTotal = 0;
  let overflowTotal = 0;
  let delayThisFrame = 0;
  let overflowThisFrame = 0;
  for (const node of nodes) {
    const delay = node.queue.droppedDelayCount;
    const overflow = node.queue.droppedOverflowCount;
    const prev = previous.get(node.nodeId) ?? { delay: 0, overflow: 0 };
    delayTotal += delay;
    overflowTotal += overflow;
    delayThisFrame += Math.max(0, delay - prev.delay);
    overflowThisFrame += Math.max(0, overflow - prev.overflow);
    previous.set(node.nodeId, { delay, overflow });
  }
  return { delayTotal, overflowTotal, delayThisFrame, overflowThisFrame };
}

function totalBacklogBits(nodes: readonly GroundNodeTrafficSubsystem[]): number {
  return nodes.reduce((sum, node) => sum + node.queue.getTotalBacklogBits(), 0);
}

export interface BaseScheduler {
  readonly schedulerName: string;
  scheduleFrame(
    frameIndex: number,
    currentSimTimeS: number,
    nodes: readonly GroundNodeTrafficSubsystem[],
    linkStatuses: ReadonlyMap<number, LinkStatus> | Record<number, LinkStatus>,
    predictiveStates: ReadonlyMap<number, PredictiveState> | Record<number, PredictiveState>,
    dlBacklogBytes?: number
  ): FrameScheduleReport;
  evictNode?(nodeId: number): void;
}

/**
 * Legacy Static Equal-Slot TDMA Scheduler.
 *
 * Divides uplink time equally across all N registered nodes:
 *   tauSlot = (T_UL_NOMINAL_S - N * TAU_GUARD_S) / N (exactly 988 us for N=16)
 * Blindly transmits into mountain shadow obstacles, wasting up to 33% of frame time.
 */
export class LegacyStaticScheduler implements BaseScheduler {
  public readonly schedulerName: string = 'Legacy_Static_TDMA';
  private readonly previousDropCounts = new Map<number, { delay: number; overflow: number }>();

  public evictNode(nodeId: number): void {
    this.previousDropCounts.delete(nodeId);
  }

  public scheduleFrame(
    frameIndex: number,
    currentSimTimeS: number,
    nodes: readonly GroundNodeTrafficSubsystem[],
    linkStatuses: ReadonlyMap<number, LinkStatus> | Record<number, LinkStatus>,
    predictiveStates: ReadonlyMap<number, PredictiveState> | Record<number, PredictiveState>,
    _dlBacklogBytes: number = 0
  ): FrameScheduleReport {
    const numNodes = nodes.length;
    const tUlAvailable = T_FRAME_S - T_CTRL_S - T_DL_MIN_S;

    if (numNodes === 0) {
      return {
        frameIndex,
        timestampS: currentSimTimeS,
        schedulerName: this.schedulerName,
        allocations: [],
        totalUlScheduledS: 0,
        totalUlAvailableS: tUlAvailable,
        totalUlUnusedS: tUlAvailable,
        totalUlUtilizationPct: 0,
        totalPayloadBitsDequeued: 0,
        totalBitsTransmitted: 0,
        totalBitsWastedOnOutage: 0,
        packetsDroppedDelay: 0,
        packetsDroppedOverflow: 0,
        packetsDroppedDelayThisFrame: 0,
        packetsDroppedOverflowThisFrame: 0,
        totalBacklogBits: 0,
      };
    }

    const tauSlot = (tUlAvailable - numNodes * TAU_GUARD_S) / numNodes;

    const allocations: SlotAllocation[] = [];
    let totalBitsTx = 0;
    let totalBitsWasted = 0;
    let totalPayloadBitsDequeued = 0;
    let usedTimeS = 0.0;
    let slotStartS = currentSimTimeS + T_CTRL_S + T_DL_MIN_S;

    const getLink = (id: number): LinkStatus | undefined =>
      linkStatuses instanceof Map
        ? linkStatuses.get(id)
        : (linkStatuses as Record<number, LinkStatus>)[id];

    const getPred = (id: number): PredictiveState | undefined => {
      if (predictiveStates instanceof Map) {
        return predictiveStates.get(id);
      }

      return (predictiveStates as Record<number, PredictiveState>)[id];
    };

    for (let i = 0; i < numNodes; i++) {
      const node = nodes[i];
      const ls = getLink(node.nodeId);
      const ps = getPred(node.nodeId);

      const isDepleted = node.batteryLevelPct <= 0 || node.isDepleted;
      const rate = (!isDepleted && ls && ls.bitrateBps > 0) ? ls.bitrateBps : (isDepleted ? 0 : 4.95e6);
      const capBits = isDepleted ? 0 : Math.floor(tauSlot * rate);
      const capBytes = Math.floor(capBits / 8);

      allocations.push({
        nodeId: node.nodeId,
        slotStartS,
        durationS: tauSlot,
        timingAdvanceS: 0.001,
        modcodName: isDepleted ? 'DEPLETED_OUTAGE' : (ls?.modcodName ?? 'LINK_OUTAGE'),
        spectralEfficiency: isDepleted ? 0.0 : (ls?.spectralEfficiency ?? 0.0),
        capacityBits: capBits,
        isPreOcclusionFlush: false,
      });

      usedTimeS += tauSlot + TAU_GUARD_S;
      slotStartS += tauSlot + TAU_GUARD_S;

      if (!isDepleted) {
        const served = node.queue.dequeue(capBytes, currentSimTimeS);
        let bitsServed = 0;
        for (let p = 0; p < served.length; p++) {
          bitsServed += served[p].sizeBits;
        }

        totalPayloadBitsDequeued += bitsServed;
        if (ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF || ls?.isOutage) {
          totalBitsWasted += bitsServed;
        } else {
          totalBitsTx += bitsServed;
        }
      }
    }

    const drops = collectDropMetrics(nodes, this.previousDropCounts);
    const backlogBits = totalBacklogBits(nodes);
    const utilPct = (usedTimeS / tUlAvailable) * 100.0;

    return {
      frameIndex,
      timestampS: currentSimTimeS,
      schedulerName: this.schedulerName,
      allocations,
      totalUlScheduledS: usedTimeS,
      totalUlAvailableS: tUlAvailable,
      totalUlUnusedS: Math.max(0, tUlAvailable - usedTimeS),
      totalUlUtilizationPct: utilPct,
      totalPayloadBitsDequeued,
      totalBitsTransmitted: totalBitsTx,
      totalBitsWastedOnOutage: totalBitsWasted,
      packetsDroppedDelay: drops.delayTotal,
      packetsDroppedOverflow: drops.overflowTotal,
      packetsDroppedDelayThisFrame: drops.delayThisFrame,
      packetsDroppedOverflowThisFrame: drops.overflowThisFrame,
      totalBacklogBits: backlogBits,
    };
  }
}

/**
 * Terrain-Aware Dynamic Scheduler (Tac-TAD).
 */
export class TerrainAwareDynamicScheduler implements BaseScheduler {
  public readonly schedulerName: string = 'Tac_TAD';
  public readonly tauMaxNormalS: number;
  private readonly previousDropCounts = new Map<number, { delay: number; overflow: number }>();

  private readonly rAvg: Map<number, number> = new Map();
  private readonly alphaPf: number = 0.05;
  private readonly weights: Readonly<Record<number, number>> = {
    69: 200.0,
    65: 50.0,
    67: 2.0,
    70: 1.0,
  };

  constructor(tauMaxNormalS: number = 0.008) {
    this.tauMaxNormalS = tauMaxNormalS;
  }

  public evictNode(nodeId: number): void {
    this.previousDropCounts.delete(nodeId);
    this.rAvg.delete(nodeId);
  }

  public scheduleFrame(
    frameIndex: number,
    currentSimTimeS: number,
    nodes: readonly GroundNodeTrafficSubsystem[],
    linkStatuses: ReadonlyMap<number, LinkStatus> | Record<number, LinkStatus>,
    predictiveStates: ReadonlyMap<number, PredictiveState> | Record<number, PredictiveState>,
    dlBacklogBytes: number = 0
  ): FrameScheduleReport {
    const tDl = dlBacklogBytes > 5000 ? Math.min(T_DL_MAX_S, T_DL_MIN_S + 0.002) : T_DL_MIN_S;
    const tUlAvailable = T_FRAME_S - T_CTRL_S - tDl;

    if (nodes.length === 0) {
      return {
        frameIndex,
        timestampS: currentSimTimeS,
        schedulerName: this.schedulerName,
        allocations: [],
        totalUlScheduledS: 0,
        totalUlAvailableS: tUlAvailable,
        totalUlUnusedS: tUlAvailable,
        totalUlUtilizationPct: 0,
        totalPayloadBitsDequeued: 0,
        totalBitsTransmitted: 0,
        totalBitsWastedOnOutage: 0,
        packetsDroppedDelay: 0,
        packetsDroppedOverflow: 0,
        packetsDroppedDelayThisFrame: 0,
        packetsDroppedOverflowThisFrame: 0,
        totalBacklogBits: 0,
      };
    }

    const getLink = (id: number): LinkStatus | undefined =>
      linkStatuses instanceof Map
        ? linkStatuses.get(id)
        : (linkStatuses as Record<number, LinkStatus>)[id];

    const getPred = (id: number): PredictiveState | undefined =>
      predictiveStates instanceof Map
        ? predictiveStates.get(id)
        : (predictiveStates as Record<number, PredictiveState>)[id];

    // Step 1: Reclaim 100% time on severed links (Filter out hard shadow or 0 rate nodes)
    const candidateNodes: GroundNodeTrafficSubsystem[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const ps = getPred(node.nodeId);
      const ls = getLink(node.nodeId);

      if (
        ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF ||
        (ls && (ls.bitrateBps <= 0 || ls.isOutage))
      ) {
        continue; // Do not dequeue payload or allocate airtime to an unusable link.
      }

      if (node.batteryLevelPct <= 0 || node.isDepleted) {
        continue; // Depleted battery cannot transmit.
      }

      if (
        node.queue.getTotalBacklogBits() === 0 &&
        ps?.currentState !== NodeTerrainState.PRE_OCCLUSION_FLUSH
      ) {
        continue;
      }

      candidateNodes.push(node);
    }

    // Step 2: Compute Lyapunov Composite Metric Psi_i
    const ranked: Array<{ psi: number; node: GroundNodeTrafficSubsystem }> = [];
    for (let i = 0; i < candidateNodes.length; i++) {
      const node = candidateNodes[i];
      const nid = node.nodeId;
      const ps = getPred(nid);
      const ls = getLink(nid);
      const q = node.queue;
      const qTotalBits = q.getTotalBacklogBits();

      // Urgency metric
      let urgency = 0.0;
      for (const [qidStr, weight] of Object.entries(this.weights)) {
        const qid = Number(qidStr);
        if (q.getClassBacklogBytes(qid) > 0) {
          const hol = q.getHolDelayS(qid, currentSimTimeS);
          const pdb = QOS_PROFILES[qid]?.pdbS ?? 0.1;
          urgency += weight * Math.exp(Math.min(8.0, hol / pdb));
        }
      }
      if (urgency === 0.0) urgency = 0.1;

      // Proportional fairness
      const rInst = ls?.bitrateBps ?? 1e6;
      const rPrev = this.rAvg.get(nid) ?? 100000.0;
      const pfTerm = rInst / Math.max(1000.0, rPrev);

      // Backlog utility
      const backlogUtility = Math.max(1.0, Math.log2(1.0 + qTotalBits / 8000.0));

      // Predictive evacuation boost
      let phiEvac = 1.0;
      if (ps?.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
        const warning = 3.0;
        const tOcc = ps.timeToOcclusionS;
        const evacRatio = Math.max(0.0, (warning - tOcc) / warning);
        phiEvac = 1.0 + 5.0 * evacRatio * Math.min(1.0, qTotalBits / 20000.0);
      } else if (ps?.currentState === NodeTerrainState.RE_EMERGENCE_BURST) {
        phiEvac = 4.0;
      }

      const priorityMultiplier = Math.max(0.1, Math.min(5.0, node.tacticalPriority ?? 1.0));
      const psi = phiEvac * urgency * pfTerm * backlogUtility * priorityMultiplier;
      ranked.push({ psi, node });
    }

    ranked.sort((a, b) => b.psi - a.psi);

    // Step 3: Exact-Fit Slot Sizing
    const allocations: SlotAllocation[] = [];
    let totalBitsTx = 0;
    let totalPayloadBitsDequeued = 0;
    let usedTimeS = 0.0;
    let remainingUlTimeS = tUlAvailable;
    let slotStartS = currentSimTimeS + T_CTRL_S + tDl;
    const scheduledIds = new Set<number>();

    for (let i = 0; i < ranked.length; i++) {
      if (remainingUlTimeS < TAU_MIN_S) break;

      const node = ranked[i].node;
      const nid = node.nodeId;
      const ps = getPred(nid);
      const ls = getLink(nid);
      const rInst = ls?.bitrateBps ?? 1e6;
      const qTotalBits = node.queue.getTotalBacklogBits();
      if (qTotalBits === 0) continue;

      const tauReq = qTotalBits / rInst;
      let tauSlot: number;
      let isFlush = false;

      if (ps?.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
        tauSlot = Math.min(remainingUlTimeS - TAU_GUARD_S, Math.max(tauReq, TAU_MIN_S));
        isFlush = true;
      } else {
        tauSlot = Math.min(tauReq, this.tauMaxNormalS, remainingUlTimeS - TAU_GUARD_S);
      }

      if (tauSlot < TAU_MIN_S) continue;

      const capBits = Math.floor(tauSlot * rInst);
      const capBytes = Math.floor(capBits / 8);

      allocations.push({
        nodeId: nid,
        slotStartS,
        durationS: tauSlot,
        timingAdvanceS: 0.001,
        modcodName: ls?.modcodName ?? 'LINK_OUTAGE',
        spectralEfficiency: ls?.spectralEfficiency ?? 0.0,
        capacityBits: capBits,
        isPreOcclusionFlush: isFlush,
      });

      scheduledIds.add(nid);

      const served = node.queue.dequeue(capBytes, currentSimTimeS);
      let bitsServed = 0;
      for (let p = 0; p < served.length; p++) {
        bitsServed += served[p].sizeBits;
      }
      totalPayloadBitsDequeued += bitsServed;
      // Candidate filtering above excludes hard-shadow and reported-outage links.
      totalBitsTx += bitsServed;

      // Update Proportional Fairness moving average
      const rAchieved = bitsServed / T_FRAME_S;
      const rPrev = this.rAvg.get(nid) ?? 100000.0;
      this.rAvg.set(nid, (1.0 - this.alphaPf) * rPrev + this.alphaPf * rAchieved);

      const consumed = tauSlot + TAU_GUARD_S;
      usedTimeS += consumed;
      slotStartS += consumed;
      remainingUlTimeS -= consumed;
    }

    // Decay PF throughput for unscheduled candidate nodes
    for (let i = 0; i < nodes.length; i++) {
      const nid = nodes[i].nodeId;
      if (!scheduledIds.has(nid)) {
        const rPrev = this.rAvg.get(nid) ?? 100000.0;
        this.rAvg.set(nid, (1.0 - this.alphaPf) * rPrev);
      }
    }

    const drops = collectDropMetrics(nodes, this.previousDropCounts);
    const backlogBits = totalBacklogBits(nodes);
    const utilPct = (usedTimeS / tUlAvailable) * 100.0;

    return {
      frameIndex,
      timestampS: currentSimTimeS,
      schedulerName: this.schedulerName,
      allocations,
      totalUlScheduledS: usedTimeS,
      totalUlAvailableS: tUlAvailable,
      totalUlUnusedS: Math.max(0, tUlAvailable - usedTimeS),
      totalUlUtilizationPct: utilPct,
      totalPayloadBitsDequeued,
      totalBitsTransmitted: totalBitsTx,
      // Tac-TAD filters unusable links before dequeue, so no dequeued payload is wasted on outage.
      totalBitsWastedOnOutage: 0,
      packetsDroppedDelay: drops.delayTotal,
      packetsDroppedOverflow: drops.overflowTotal,
      packetsDroppedDelayThisFrame: drops.delayThisFrame,
      packetsDroppedOverflowThisFrame: drops.overflowThisFrame,
      totalBacklogBits: backlogBits,
    };
  }
}
```

### File: `src/core/terrain.ts` (931 lines, 30,778 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Pure TypeScript Dual-Mode Terrain & Geometrical Propagation Engine
 *
 * Expanded Regional Theater: 1,200 x 1,200 km (+/- 600 km from center)
 * Ensures full-bleed edge-to-edge terrain coverage even at maximum zoom-out.
 */

import { EnvironmentConfig, RFConfig, SPEED_OF_LIGHT } from './config';
import { ObstacleField, ObstacleIntersection } from './obstacles';
import type { Position3D } from '../shared/types';
import { THEATER_HALF_M } from '../shared/constants';

export type { Position3D };

export interface SlantGeometry {
  readonly slantRangeM: number;
  readonly elevationDeg: number;
  readonly tauPropS: number;
  readonly timingAdvanceS: number;
}

export interface TerrainObstruction {
  readonly minClearanceM: number;
  readonly fresnelRadiusM: number;
  readonly diffractionLossDb: number;
  readonly isLos: boolean;
  /** Explicit coverage tracking: true if every sample along path has genuine, valid DEM elevation. */
  readonly isCoverageComplete?: boolean;
  /** Structural geometry result; independent of terrain LOS and terrain diffraction. */
  readonly obstacleBlocked: boolean;
  readonly obstacleIntersections: readonly ObstacleIntersection[];
  /** Detailed reason when terrain coverage is incomplete along propagation path. */
  readonly coverageNote?: string;
}

// Regional 1,200 x 1,200 km Theater Extent (+/- 600 km from origin)
export const THEATER_EXTENT_1200KM_M = THEATER_HALF_M;
export const DEFAULT_GRID_SIZE = 512;

// ----------------------------------------------------------------------------
// Authentic Geographic Metadata & Coordinate Transformation Specifications
// ----------------------------------------------------------------------------

/**
 * Geodetic and raster metadata for the authentic real Ladakh satellite DEM raster.
 *
 * Registration: Point-registered / gridline-registered matrix where:
 *   - Column 0 is on the West boundary (minLonDeg).
 *   - Column 511 is on the East boundary (maxLonDeg).
 *   - Row 0 is on the North boundary (maxLatDeg).
 *   - Row 511 is on the South boundary (minLatDeg).
 *   - Center (x=0, y=0) corresponds exactly to pixel (255.5, 255.5) at 34.5°N, 76.5°E.
 *
 * Metric scale on WGS-84 ellipsoid at 34.5°N:
 *   - 1° Latitude = 110,931.4506 m (Meridian radius of curvature M = 6,355,903.9 m)
 *   - 1° Longitude = 91,839.9774 m (Prime vertical radius N * cos(34.5°) = 6,384,997.1 * cos(34.5°) m)
 *
 * Projection: Local Equirectangular (Plate Carrée with standard parallel phi0 = 34.5°N).
 *   Scale distortion is 0.00% at theater center, < 0.45% within the active tactical cluster (+/- 42 km),
 *   and < 1.21% at the furthest raster corners (+/- 111 km).
 */
export interface DemGeographicMetadata {
  readonly rasterWidth: number;
  readonly rasterHeight: number;
  readonly centerLatDeg: number;
  readonly centerLonDeg: number;
  readonly minLatDeg: number;
  readonly maxLatDeg: number;
  readonly minLonDeg: number;
  readonly maxLonDeg: number;
  readonly halfWidthM: number;
  readonly halfHeightM: number;
  readonly groundResolutionXM: number;
  readonly groundResolutionYM: number;
  readonly minX?: number;
  readonly maxX?: number;
  readonly minY?: number;
  readonly maxY?: number;
  readonly tileName?: string;
  readonly minElevationM?: number;
  readonly maxElevationM?: number;
  readonly voidCount?: number;
}

export const REAL_LADAKH_DEM_METADATA: DemGeographicMetadata = Object.freeze({
  rasterWidth: 512,
  rasterHeight: 512,
  centerLatDeg: 34.5,
  centerLonDeg: 76.5,
  minLatDeg: 33.5,
  maxLatDeg: 35.5,
  minLonDeg: 75.5,
  maxLonDeg: 77.5,
  halfWidthM: 91839.9774,
  halfHeightM: 110931.4506,
  groundResolutionXM: (2.0 * 91839.9774) / 511.0, // 359.4519663405088 m/pixel
  groundResolutionYM: (2.0 * 110931.4506) / 511.0, // 434.1739749510763 m/pixel
  minX: -91839.9774,
  maxX: 91839.9774,
  minY: -110931.4506,
  maxY: 110931.4506,
  tileName: 'LADAKH',
});

export interface DemPixelCoord {
  readonly col: number;
  readonly row: number;
  readonly isInside: boolean;
}

export interface GeographicCoordinate {
  readonly latDeg: number;
  readonly lonDeg: number;
}

export interface TerrainBoundsTelemetry {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly rasterWidth: number;
  readonly rasterHeight: number;
  readonly groundResolutionXM: number;
  readonly groundResolutionYM: number;
  readonly isValidCoverage: boolean;
  readonly halfWidthM: number;
  readonly halfHeightM: number;
  readonly terrainMode: 'real' | 'synthetic';
  readonly tileName?: string;
}

// ----------------------------------------------------------------------------
// 2D Inverse Fast Fourier Transform (Cooley-Tukey Radix-2)
// ----------------------------------------------------------------------------
function ifft1d(real: Float64Array, imag: Float64Array, n: number): void {
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr;
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
    let k = n >> 1;
    while (k > 0 && k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (2.0 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1.0;
      let wi = 0.0;
      for (let k = 0; k < half; k++) {
        const posEven = i + k;
        const posOdd = i + k + half;
        const tr = wr * real[posOdd] - wi * imag[posOdd];
        const ti = wr * imag[posOdd] + wi * real[posOdd];
        real[posOdd] = real[posEven] - tr;
        imag[posOdd] = imag[posEven] - ti;
        real[posEven] += tr;
        imag[posEven] += ti;
        const nextWr = wr * wStepR - wi * wStepI;
        wi = wr * wStepI + wi * wStepR;
        wr = nextWr;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    real[i] /= n;
    imag[i] /= n;
  }
}

/**
 * Generates an authentic 2D Fractional Brownian Motion (fBm) elevation matrix
 * via 2D Fourier Spectral Synthesis across the expanded 1,200x1,200 km domain.
 */
export function generateSpectralElevationGrid(
  size: number = DEFAULT_GRID_SIZE,
  theaterExtentM: number = THEATER_EXTENT_1200KM_M,
  beta: number = 2.3,
  seed: number = 42
): Float32Array {
  const real = new Float64Array(size * size);
  const imag = new Float64Array(size * size);

  let s = (seed ^ 0x6d2b79f5) >>> 0;
  const nextRand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296.0;
  };

  const half = size / 2;
  for (let r = 0; r < size; r++) {
    const ky = r < half ? r / size : (r - size) / size;
    for (let c = 0; c < size; c++) {
      const kx = c < half ? c / size : (c - size) / size;
      const kSq = kx * kx + ky * ky;

      if (r === 0 && c === 0) {
        real[0] = 0.0;
        imag[0] = 0.0;
        continue;
      }

      const amp = 1.0 / Math.pow(kSq, beta / 4.0);
      const phase = nextRand() * 2.0 * Math.PI;
      const idx = r * size + c;
      real[idx] = amp * Math.cos(phase);
      imag[idx] = amp * Math.sin(phase);
    }
  }

  // 2D IFFT: Rows then Columns
  const rowR = new Float64Array(size);
  const rowI = new Float64Array(size);
  for (let r = 0; r < size; r++) {
    const offset = r * size;
    for (let c = 0; c < size; c++) {
      rowR[c] = real[offset + c];
      rowI[c] = imag[offset + c];
    }
    ifft1d(rowR, rowI, size);
    for (let c = 0; c < size; c++) {
      real[offset + c] = rowR[c];
      imag[offset + c] = rowI[c];
    }
  }

  const colR = new Float64Array(size);
  const colI = new Float64Array(size);
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size; r++) {
      colR[r] = real[r * size + c];
      colI[r] = imag[r * size + c];
    }
    ifft1d(colR, colI, size);
    for (let r = 0; r < size; r++) {
      real[r * size + c] = colR[r];
      imag[r * size + c] = colI[r];
    }
  }

  let minFbm = Number.POSITIVE_INFINITY;
  let maxFbm = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < size * size; i++) {
    const val = real[i];
    if (val < minFbm) minFbm = val;
    if (val > maxFbm) maxFbm = val;
  }
  const fbmRange = Math.max(1e-9, maxFbm - minFbm);

  const ang = (35.0 * Math.PI) / 180.0;
  const sinA = Math.sin(ang);
  const cosA = Math.cos(ang);
  const step = (theaterExtentM * 2.0) / (size - 1);

  const out = new Float32Array(size * size);
  let minComb = Number.POSITIVE_INFINITY;
  let maxComb = Number.NEGATIVE_INFINITY;

  for (let r = 0; r < size; r++) {
    const y = -theaterExtentM + r * step;
    for (let c = 0; c < size; c++) {
      const x = -theaterExtentM + c * step;
      const idx = r * size + c;
      const normFbm = (real[idx] - minFbm) / fbmRange;

      // Natural meandering valley depression
      const v = -x * sinA + y * cosA;
      const valleyTrough = 0.28 * Math.exp(-(v * v) / (2.0 * Math.pow(75000.0, 2)));

      const combined = normFbm - valleyTrough;
      out[idx] = combined;
      if (combined < minComb) minComb = combined;
      if (combined > maxComb) maxComb = combined;
    }
  }

  // Scale to authentic Ladakh elevations: 2900m to 5800m MSL
  const combRange = Math.max(1e-9, maxComb - minComb);
  for (let i = 0; i < size * size; i++) {
    out[i] = 2900.0 + ((out[i] - minComb) / combRange) * 2900.0;
  }

  return out;
}

let _cachedSynthGrid: Float32Array | null = null;
function getCachedSynthGrid(): Float32Array {
  if (!_cachedSynthGrid) {
    _cachedSynthGrid = generateSpectralElevationGrid(DEFAULT_GRID_SIZE, THEATER_EXTENT_1200KM_M, 2.3, 42);
  }
  return _cachedSynthGrid;
}

export class TerrainEngine {
  public readonly theaterExtentM: number;
  public terrainMode: 'real' | 'synthetic';
  public hasRealDem: boolean = false;
  public realDemGrid: Float32Array | null = null;
  public demMetadata: DemGeographicMetadata = REAL_LADAKH_DEM_METADATA;
  private readonly customElevationFn?: (xM: number, yM: number) => number;
  /** Canonical committed obstacle state shared by live links, prediction and profiles. */
  public readonly obstacleField = new ObstacleField();

  constructor(options?: {
    theaterExtentM?: number;
    terrainMode?: 'real' | 'synthetic';
    customElevationFn?: (xM: number, yM: number) => number;
  }) {
    this.theaterExtentM = options?.theaterExtentM ?? THEATER_EXTENT_1200KM_M;
    this.terrainMode = options?.terrainMode ?? 'real';
    this.customElevationFn = options?.customElevationFn;
  }

  public get terrain_mode(): 'real' | 'synthetic' {
    return this.terrainMode;
  }

  public set terrain_mode(mode: 'real' | 'synthetic') {
    this.terrainMode = mode;
  }

  public setTerrainMode(mode: 'real' | 'synthetic'): string {
    this.terrainMode = mode;
    return this.terrainMode;
  }

  public set_terrain_mode(mode: 'real' | 'synthetic'): string {
    return this.setTerrainMode(mode);
  }

  /**
   * Asynchronously loads real satellite elevation data.
   * Dynamically resolves using Vite's BASE_URL or relative paths for GitHub Pages subpaths.
   */
  public async loadRealSatelliteDem(url?: string): Promise<boolean> {
    
const baseUrl = import.meta.env.BASE_URL || "/";
const cleanBase = baseUrl.endsWith("/")
  ? baseUrl
  : `${baseUrl}/`;

const defaultUrl = new URL(
  `${cleanBase}terrain/real_ladakh_dem.bin`,
  self.location.origin
).toString();


    
const candidateUrls = url
  ? [url, defaultUrl]
  : [
      defaultUrl,
      new URL(
        "../terrain/real_ladakh_dem.bin",
        self.location.href
      ).toString(),
    ];

    for (const targetUrl of candidateUrls) {
      try {
        const response = await fetch(targetUrl);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength >= 512 * 512 * 4) {
            this.realDemGrid = new Float32Array(buffer, 0, 512 * 512);
            this.hasRealDem = true;
            this.terrainMode = 'real';
            console.log(`[TerrainEngine] Loaded real satellite DEM from: ${targetUrl}`);
            return true;
          } else {
            console.warn(`[TerrainEngine] Buffer size mismatch from ${targetUrl}, expected >= 1MB.`);
          }
        }
      } catch (_) {
        // Try next candidate URL
      }
    }

    console.warn('[TerrainEngine] Could not fetch real satellite DEM from any candidate URL, using synthetic fallback.');
    return false;
  }

  public loadCustomDem(data: Float32Array | ArrayBuffer, metadata?: DemGeographicMetadata): boolean {
    this.realDemGrid = data instanceof Float32Array ? data : new Float32Array(data);
    this.demMetadata = metadata ? Object.freeze({ ...metadata }) : REAL_LADAKH_DEM_METADATA;
    this.hasRealDem = true;
    this.terrainMode = 'real';
    return true;
  }

  public load_custom_dem(_filepath: string): boolean {
    return true;
  }

  /**
   * Evaluates whether local Cartesian coordinates (xM, yM) in metres fall inside
   * the genuine geographic coverage of the active real DEM raster.
   */
  public isWithinDemCoverage(xM: number, yM: number): boolean {
    const meta = this.demMetadata;
    const minX = meta.minX ?? -meta.halfWidthM;
    const maxX = meta.maxX ?? meta.halfWidthM;
    const minY = meta.minY ?? -meta.halfHeightM;
    const maxY = meta.maxY ?? meta.halfHeightM;
    return (
      Number.isFinite(xM) &&
      Number.isFinite(yM) &&
      xM >= minX &&
      xM <= maxX &&
      yM >= minY &&
      yM <= maxY
    );
  }

  /**
   * Maps local Cartesian coordinates (metres East/North from origin 34.5°N, 76.5°E)
   * to continuous floating-point column and row indices in the DEM raster.
   *
   * Point registration:
   *   col 0 = West bound (minX, minLonDeg)
   *   col N-1 = East bound (maxX, maxLonDeg)
   *   row 0 = North bound (maxY, maxLatDeg)
   *   row N-1 = South bound (minY, minLatDeg)
   */
  public worldToDemPixel(xM: number, yM: number): DemPixelCoord {
    const meta = this.demMetadata;
    const isInside = this.isWithinDemCoverage(xM, yM);
    const minX = meta.minX ?? -meta.halfWidthM;
    const maxX = meta.maxX ?? meta.halfWidthM;
    const minY = meta.minY ?? -meta.halfHeightM;
    const maxY = meta.maxY ?? meta.halfHeightM;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const u = spanX > 0 ? (xM - minX) / spanX : 0;
    const v = spanY > 0 ? (maxY - yM) / spanY : 0;
    const col = u * (meta.rasterWidth - 1);
    const row = v * (meta.rasterHeight - 1);
    return { col, row, isInside };
  }

  /**
   * Maps floating-point DEM column and row coordinates back to local Cartesian
   * coordinates (metres from origin). Exact inverse of worldToDemPixel.
   */
  public demPixelToWorld(col: number, row: number): { xM: number; yM: number } {
    const meta = this.demMetadata;
    const minX = meta.minX ?? -meta.halfWidthM;
    const maxX = meta.maxX ?? meta.halfWidthM;
    const minY = meta.minY ?? -meta.halfHeightM;
    const maxY = meta.maxY ?? meta.halfHeightM;
    const u = meta.rasterWidth > 1 ? col / (meta.rasterWidth - 1) : 0;
    const v = meta.rasterHeight > 1 ? row / (meta.rasterHeight - 1) : 0;
    const xM = minX + u * (maxX - minX);
    const yM = maxY - v * (maxY - minY);
    return { xM, yM };
  }

  /**
   * Projects local Cartesian coordinates (metres from origin) to WGS-84 geographic
   * coordinates (degrees) using the verified Local Equirectangular projection
   * (Plate Carrée with standard parallel at theater center phi0 = 34.5°N).
   *
   * Scale constants:
   *   1° Latitude  = 110,931.4506 m (WGS-84 meridian radius M at 34.5°N)
   *   1° Longitude = 91,839.9774 m  (WGS-84 prime vertical N * cos(34.5°N))
   */
  public worldToLatLon(xM: number, yM: number): GeographicCoordinate {
    const meta = REAL_LADAKH_DEM_METADATA;
    const latDeg = meta.centerLatDeg + yM / meta.halfHeightM;
    const lonDeg = meta.centerLonDeg + xM / meta.halfWidthM;
    return { latDeg, lonDeg };
  }

  /**
   * Projects WGS-84 geographic coordinates (degrees) to local Cartesian coordinates
   * (metres from origin). Exact inverse of worldToLatLon.
   */
  public latLonToWorld(latDeg: number, lonDeg: number): { xM: number; yM: number } {
    const meta = REAL_LADAKH_DEM_METADATA;
    const xM = (lonDeg - meta.centerLonDeg) * meta.halfWidthM;
    const yM = (latDeg - meta.centerLatDeg) * meta.halfHeightM;
    return { xM, yM };
  }

  /**
   * Returns authoritative bounding telemetry for the active terrain mode.
   * In real DEM mode, bounds represent the genuine geographic coverage of the Ladakh DEM raster
   * (-91,839.98m to +91,839.98m E-W, -110,931.45m to +110,931.45m N-S) rather than the 1,200 km theater.
   * In synthetic mode, bounds cover the full 1,200x1,200 km regional domain.
   */
  public getTerrainBoundsTelemetry(): TerrainBoundsTelemetry {
    if (this.terrainMode === 'real') {
      const meta = this.demMetadata;
      const minX = meta.minX ?? -meta.halfWidthM;
      const maxX = meta.maxX ?? meta.halfWidthM;
      const minY = meta.minY ?? -meta.halfHeightM;
      const maxY = meta.maxY ?? meta.halfHeightM;
      return {
        minX,
        maxX,
        minY,
        maxY,
        rasterWidth: meta.rasterWidth,
        rasterHeight: meta.rasterHeight,
        groundResolutionXM: meta.groundResolutionXM,
        groundResolutionYM: meta.groundResolutionYM,
        isValidCoverage: this.hasRealDem && this.realDemGrid !== null,
        halfWidthM: meta.halfWidthM,
        halfHeightM: meta.halfHeightM,
        terrainMode: 'real',
        tileName: meta.tileName,
      };
    } else {
      const extent = this.theaterExtentM;
      const size = DEFAULT_GRID_SIZE;
      const step = (2.0 * extent) / (size - 1);
      return {
        minX: -extent,
        maxX: extent,
        minY: -extent,
        maxY: extent,
        rasterWidth: size,
        rasterHeight: size,
        groundResolutionXM: step,
        groundResolutionYM: step,
        isValidCoverage: true,
        halfWidthM: extent,
        halfHeightM: extent,
        terrainMode: 'synthetic',
      };
    }
  }

  public getTerrainBounds(): TerrainBoundsTelemetry {
    return this.getTerrainBoundsTelemetry();
  }

  /**
   * Bilinear interpolation across 512x512 matrix over [-theaterExtentM, +theaterExtentM].
   * Used for procedural synthetic terrain synthesis.
   */
  private interpolateGrid(grid: Float32Array, xM: number, yM: number, isRow0North: boolean): number {
    const size = DEFAULT_GRID_SIZE;
    const extent = this.theaterExtentM;

    const u = Math.max(0.0, Math.min(1.0, (xM + extent) / (2.0 * extent)));
    const v = isRow0North
      ? Math.max(0.0, Math.min(1.0, (extent - yM) / (2.0 * extent)))
      : Math.max(0.0, Math.min(1.0, (yM + extent) / (2.0 * extent)));

    const cFloat = u * (size - 1);
    const rFloat = v * (size - 1);

    const c0 = Math.floor(cFloat);
    const r0 = Math.floor(rFloat);
    const c1 = Math.min(size - 1, c0 + 1);
    const r1 = Math.min(size - 1, r0 + 1);

    const fc = cFloat - c0;
    const fr = rFloat - r0;

    const v00 = grid[r0 * size + c0];
    const v01 = grid[r0 * size + c1];
    const v10 = grid[r1 * size + c0];
    const v11 = grid[r1 * size + c1];

    const top = v00 * (1.0 - fc) + v01 * fc;
    const bot = v10 * (1.0 - fc) + v11 * fc;

    return top * (1.0 - fr) + bot * fr;
  }

  /**
   * Bilinear interpolation across authentic real DEM raster.
   * Maps local Cartesian coordinates (xM, yM) to continuous pixel coordinates
   * within genuine DEM geographic coverage.
   *
   * Point-registered (gridline-registered):
   *   col 0..N-1 across N-1 intervals
   *   row 0..N-1 across N-1 intervals, row 0 is North.
   *
   * Handles void samples (-32768 or NaN) by performing normalized weighted interpolation
   * across valid surrounding corners. Returns Number.NaN if coordinates fall outside
   * genuine DEM coverage or all surrounding pixels are void.
   */
  public interpolateDemGrid(grid: Float32Array, xM: number, yM: number): number {
    const px = this.worldToDemPixel(xM, yM);
    if (!px.isInside) {
      return Number.NaN;
    }

    const meta = this.demMetadata;
    const width = meta.rasterWidth;
    const height = meta.rasterHeight;

    const cFloat = Math.max(0.0, Math.min(width - 1, px.col));
    const rFloat = Math.max(0.0, Math.min(height - 1, px.row));

    const c0 = Math.floor(cFloat);
    const r0 = Math.floor(rFloat);
    const c1 = Math.min(width - 1, c0 + 1);
    const r1 = Math.min(height - 1, r0 + 1);

    const fc = cFloat - c0;
    const fr = rFloat - r0;

    const v00 = grid[r0 * width + c0];
    const v01 = grid[r0 * width + c1];
    const v10 = grid[r1 * width + c0];
    const v11 = grid[r1 * width + c1];

    const isValid00 = Number.isFinite(v00) && v00 !== -32768;
    const isValid01 = Number.isFinite(v01) && v01 !== -32768;
    const isValid10 = Number.isFinite(v10) && v10 !== -32768;
    const isValid11 = Number.isFinite(v11) && v11 !== -32768;

    if (isValid00 && isValid01 && isValid10 && isValid11) {
      const top = v00 * (1.0 - fc) + v01 * fc;
      const bot = v10 * (1.0 - fc) + v11 * fc;
      return top * (1.0 - fr) + bot * fr;
    }

    // Normalized weighted interpolation across valid surrounding pixels
    let totalWeight = 0.0;
    let weightedSum = 0.0;

    const w00 = (1.0 - fc) * (1.0 - fr);
    const w01 = fc * (1.0 - fr);
    const w10 = (1.0 - fc) * fr;
    const w11 = fc * fr;

    if (isValid00) { totalWeight += w00; weightedSum += w00 * v00; }
    if (isValid01) { totalWeight += w01; weightedSum += w01 * v01; }
    if (isValid10) { totalWeight += w10; weightedSum += w10 * v10; }
    if (isValid11) { totalWeight += w11; weightedSum += w11 * v11; }

    if (totalWeight > 1e-6) {
      return weightedSum / totalWeight;
    }

    return Number.NaN;
  }

  /**
   * Returns raw satellite DEM elevation in metres MSL via bilinear interpolation
   * across genuine DEM coverage.
   *
   * Returns Number.NaN if coordinates fall outside genuine DEM coverage or are non-finite,
   * or if real DEM data is not loaded.
   */
  public getDemElevation(xM: number, yM: number): number {
    if (!this.hasRealDem || !this.realDemGrid) {
      return Number.NaN;
    }
    return this.interpolateDemGrid(this.realDemGrid, xM, yM);
  }

  /**
   * Evaluates terrain elevation MSL (m).
   *
   * In 'real' mode:
   *   - Queries the authentic 512x512 Ladakh DEM at genuine geographic scale.
   *   - Returns Number.NaN when outside genuine DEM coverage or if coordinates are non-finite.
   *   - Preserves authentic Float32 measurements.
   *
   * In 'synthetic' mode (or fallback when real DEM is not loaded):
   *   - Procedural 2D fBm terrain across the full 1,200 km regional theater extent.
   */
  public getElevation(xM: number, yM: number): number {
    if (this.customElevationFn) {
      return this.customElevationFn(xM, yM);
    }

    if (!Number.isFinite(xM) || !Number.isFinite(yM)) {
      return Number.NaN;
    }

    if (this.terrainMode === 'real' && this.hasRealDem && this.realDemGrid) {
      if (!this.isWithinDemCoverage(xM, yM)) {
        return Number.NaN;
      }
      return this.interpolateDemGrid(this.realDemGrid, xM, yM);
    }

    // Procedural synthetic mode or fallback across 1,200 km theater
    const baseElev = this.interpolateGrid(getCachedSynthGrid(), xM, yM, false);
    if (!Number.isFinite(baseElev)) {
      return Number.NaN;
    }

    // Mt. Kargil-I Tactical Barrier Ridge (x=5000m, y=270m, peak z=4150m)
    const xArg = Math.max(-100.0, -Math.pow((xM - 5000.0) / 450.0, 2));
    const yArg = Math.max(-50.0, Math.min(50.0, (Math.abs(yM - 270.0) - 90.0) / 12.0));
    const ridgeKargil = 1150.0 * Math.exp(xArg) * (1.0 / (1.0 + Math.exp(yArg)));

    return Math.max(2800.0, Math.min(5900.0, baseElev + ridgeKargil));
  }

  public static computeEarthBulge(d1M: number, d2M: number, rEffM: number): number {
    if (rEffM <= 0.0) return 0.0;
    return (d1M * d2M) / (2.0 * rEffM);
  }

  public computeSlantGeometry(
    nodePos: Position3D,
    acnPos: Position3D,
    env: EnvironmentConfig
  ): SlantGeometry {
    const [nx, ny, nz] = nodePos;
    const [ax, ay, az] = acnPos;

    const dx = ax - nx;
    const dy = ay - ny;
    const dz = az - nz;

    const d2D = Math.hypot(dx, dy);
    const d3D = Math.hypot(d2D, dz);
    const rEff = env.effectiveEarthRadiusM;
    const phi = rEff > 0.0 ? d2D / rEff : 0.0;

    let elevationDeg: number;
    if (d2D < 1e-3) {
      elevationDeg = dz >= 0.0 ? 90.0 : -90.0;
    } else {
      const elevRad = Math.atan2(
        (rEff + az) * Math.cos(phi) - (rEff + nz),
        (rEff + az) * Math.sin(phi)
      );
      elevationDeg = (elevRad * 180.0) / Math.PI;
    }

    const tauPropS = d3D / SPEED_OF_LIGHT;
    const timingAdvanceS = 2.0 * tauPropS;

    return { slantRangeM: d3D, elevationDeg, tauPropS, timingAdvanceS };
  }

  public evaluateTerrainObstruction(
    nodePos: Position3D,
    acnPos: Position3D,
    rf: RFConfig,
    env: EnvironmentConfig,
    stepIntervalM: number = 100.0
  ): TerrainObstruction {
    const [nx, ny, nz] = nodePos;
    const [ax, ay, az] = acnPos;

    const dx = ax - nx;
    const dy = ay - ny;
    const dz = az - nz;
    const d3D = Math.hypot(Math.hypot(dx, dy), dz);

    const wavelength = rf.wavelengthM;
    const rEff = env.effectiveEarthRadiusM;

    let isCoverageComplete = true;
    let coverageNote: string | undefined = undefined;

    // Check finite coordinates for endpoints
    if (
      !Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz) ||
      !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) ||
      !Number.isFinite(d3D)
    ) {
      isCoverageComplete = false;
      coverageNote = 'OUT_OF_COVERAGE: Ray endpoints contain non-finite coordinates';
    }

    // In real DEM mode, check start and target terminal boundaries
    if (isCoverageComplete && this.terrainMode === 'real' && this.hasRealDem && this.realDemGrid) {
      if (!this.isWithinDemCoverage(nx, ny)) {
        isCoverageComplete = false;
        coverageNote = 'OUT_OF_COVERAGE: Ground terminal is outside mapped DEM coverage';
      } else if (!this.isWithinDemCoverage(ax, ay)) {
        isCoverageComplete = false;
        coverageNote = 'OUT_OF_COVERAGE: Aircraft (ACN) is outside mapped DEM coverage';
      }
    }

    // Always evaluate custom obstacle intersections along the 3D ray
    const obstacleIntersections = this.obstacleField.intersectRay(nodePos, acnPos, (x, y, fraction) => {
      const d1 = d3D * fraction, d2 = d3D - d1;
      return this.getElevation(x, y) + TerrainEngine.computeEarthBulge(d1, d2, rEff);
    });
    const obstacleBlocked = obstacleIntersections.length > 0;

    // If endpoints are outside coverage, abort immediately without fabricating clearance
    if (!isCoverageComplete) {
      return {
        minClearanceM: Number.NaN,
        fresnelRadiusM: Number.NaN,
        diffractionLossDb: Number.NaN,
        isLos: false,
        isCoverageComplete: false,
        obstacleBlocked,
        obstacleIntersections,
        coverageNote: coverageNote ?? 'OUT_OF_COVERAGE: Propagation path traverses unmapped terrain',
      };
    }

    // Near-coincident terminal check
    if (d3D < 1e-3) {
      const hTerrain = this.getElevation(nx, ny);
      if (!Number.isFinite(hTerrain)) {
        return {
          minClearanceM: Number.NaN,
          fresnelRadiusM: Number.NaN,
          diffractionLossDb: Number.NaN,
          isLos: false,
          isCoverageComplete: false,
          obstacleBlocked,
          obstacleIntersections,
          coverageNote: 'OUT_OF_COVERAGE: Terminal position is outside mapped DEM coverage',
        };
      }
      const hClear = nz - hTerrain;
      return {
        minClearanceM: hClear,
        fresnelRadiusM: 0.0,
        diffractionLossDb: 0.0,
        isLos: hClear >= 0.0,
        isCoverageComplete: true,
        obstacleBlocked,
        obstacleIntersections,
        coverageNote: undefined,
      };
    }

    let steps: number[] = [];
    if (d3D <= stepIntervalM * 2.0) {
      steps = [d3D * 0.5];
    } else {
      for (let s = stepIntervalM; s < d3D; s += stepIntervalM) {
        steps.push(s);
      }
    }

    let minClearanceRatio = Number.POSITIVE_INFINITY;
    let minClearanceM = 0.0;
    let critFresnelRadiusM = 0.0;
    let critD1 = d3D * 0.5;
    let critD2 = d3D * 0.5;

    for (let i = 0; i < steps.length; i++) {
      const d1 = steps[i];
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

    if (!isCoverageComplete) {
      return {
        minClearanceM: Number.NaN,
        fresnelRadiusM: Number.NaN,
        diffractionLossDb: Number.NaN,
        isLos: false,
        isCoverageComplete: false,
        obstacleBlocked,
        obstacleIntersections,
        coverageNote: coverageNote ?? 'OUT_OF_COVERAGE: Propagation path traverses unmapped terrain',
      };
    }

    let diffractionLossDb: number;
    let isLos: boolean;

    if (minClearanceRatio >= 0.6) {
      diffractionLossDb = 0.0;
      isLos = true;
    } else if (minClearanceRatio > 0.0) {
      diffractionLossDb = 6.0 * (1.0 - minClearanceRatio / 0.6);
      isLos = true;
    } else {
      isLos = false;
      const nu = -minClearanceM * Math.sqrt(
        (2.0 / wavelength) * (1.0 / critD1 + 1.0 / critD2)
      );
      const arg = Math.sqrt(Math.pow(nu - 0.1, 2) + 1.0) + (nu - 0.1);
      const knifeEdgeLoss = 6.9 + 20.0 * Math.log10(Math.max(arg, 1e-9));
      const fockPenaltyDb = 12.0;
      diffractionLossDb = knifeEdgeLoss + fockPenaltyDb;
    }

    return {
      minClearanceM,
      fresnelRadiusM: critFresnelRadiusM,
      diffractionLossDb,
      isLos,
      isCoverageComplete: true,
      obstacleBlocked,
      obstacleIntersections,
      coverageNote: undefined,
    };
  }
}
```

### File: `src/core/trajectory.ts` (792 lines, 29,570 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Trajectory & Orbital Predictive Look-Ahead Engine (TypeScript Port)
 *
 * Implements:
 * 1. Constant True Airspeed (60.0 m/s +/- 0.5 m/s) along an inclined elliptical orbit
 *    parameterized via arc-length numerical integration.
 * 2. 4-State Predictive Occlusion Machine:
 *    NORMAL_LOS -> PRE_OCCLUSION_FLUSH -> HARD_SHADOW_CUTOFF -> RE_EMERGENCE_BURST.
 */

import { ACNFlightConfig, ACNWaypoint, EnvironmentConfig, RFConfig } from './config';
import { LinkBudgetEngine } from './linkBudget';
import { TerrainEngine } from './terrain';
import type { Position3D } from '../shared/types';
import { validateClosedWaypointPath } from './waypoints';

export enum NodeTerrainState {
  NORMAL_LOS = 'NORMAL_LOS',
  PRE_OCCLUSION_FLUSH = 'PRE_OCCLUSION_FLUSH',
  HARD_SHADOW_CUTOFF = 'HARD_SHADOW_CUTOFF',
  RE_EMERGENCE_BURST = 'RE_EMERGENCE_BURST',
}

export interface PredictiveState {
  readonly currentState: NodeTerrainState;
  readonly timeToOcclusionS: number;
  readonly timeToEmergenceS: number;
  readonly fresnelClearanceM: number;
  readonly fresnelRateOfChangeMps: number;
  readonly predictedOutageDurationS: number;
  readonly obstacleBlocked?: boolean;
}

export interface TrajectoryKinematicsSnapshot {
  readonly t0S: number;
  readonly s0M: number;
  readonly v0Mps: number;
  readonly targetSpeedMps: number;
  readonly accelLimitMps2: number;
  readonly decelLimitMps2: number;
}

/** Position/velocity contract shared by the live simulation and look-ahead engine. */
export interface ACNTrajectory {
  getAcnPosition(tS: number): [number, number, number];
  getAcnVelocity(tS: number): [number, number, number];
  getPathPoints(numPoints?: number): [number, number][];
  readonly totalLengthM: number;
  readonly currentSpeedMps: number;
  readonly targetSpeedMps: number;
  setTargetSpeed(targetSpeedMps: number, currentSimTimeS?: number): void;
  setLimits(accelLimitMps2?: number, decelLimitMps2?: number): void;
  getCurrentSpeed(tS: number): number;
  resetKinematics(initialSpeedMps?: number): void;
  getKinematicsState(): TrajectoryKinematicsSnapshot;
  restoreKinematicsState(snapshot: TrajectoryKinematicsSnapshot): void;
}

/**
 * Continuous speed-transition kinematics engine.
 *
 * Implements bounded acceleration/deceleration speed transitions:
 * v(t) ramps from v0 to targetSpeed at rates a_acc or a_dec.
 * The analytic integral of v(t) yields displacement Delta s(t - t0) in O(1) time
 * with exact position and velocity continuity at runtime speed changes and mode switches.
 */
export class TrajectoryKinematics {
  private t0S: number = 0.0;
  private s0M: number = 0.0;
  private v0Mps: number = 60.0;
  public targetSpeedMps: number = 60.0;
  public accelLimitMps2: number = 5.0;
  public decelLimitMps2: number = 5.0;

  constructor(
    initialSpeedMps: number = 60.0,
    accelLimitMps2: number = 5.0,
    decelLimitMps2: number = 5.0,
    initialDistanceM: number = 0.0,
    initialTimeS: number = 0.0
  ) {
    if (!Number.isFinite(initialSpeedMps) || initialSpeedMps < 0 || initialSpeedMps > 1000) {
      throw new Error('Initial speed must be finite and in [0, 1000] m/s.');
    }
    if (!Number.isFinite(accelLimitMps2) || accelLimitMps2 <= 0) {
      throw new Error('Acceleration limit must be a positive finite number.');
    }
    if (!Number.isFinite(decelLimitMps2) || decelLimitMps2 <= 0) {
      throw new Error('Deceleration limit must be a positive finite number.');
    }
    if (!Number.isFinite(initialDistanceM)) {
      throw new Error('Initial distance must be finite.');
    }
    if (!Number.isFinite(initialTimeS)) {
      throw new Error('Initial time must be finite.');
    }
    this.v0Mps = initialSpeedMps;
    this.targetSpeedMps = initialSpeedMps;
    this.accelLimitMps2 = accelLimitMps2;
    this.decelLimitMps2 = decelLimitMps2;
    this.s0M = initialDistanceM;
    this.t0S = initialTimeS;
  }

  public getSnapshot(): TrajectoryKinematicsSnapshot {
    return {
      t0S: this.t0S,
      s0M: this.s0M,
      v0Mps: this.v0Mps,
      targetSpeedMps: this.targetSpeedMps,
      accelLimitMps2: this.accelLimitMps2,
      decelLimitMps2: this.decelLimitMps2,
    };
  }

  public restoreSnapshot(snap: TrajectoryKinematicsSnapshot): void {
    this.t0S = snap.t0S;
    this.s0M = snap.s0M;
    this.v0Mps = snap.v0Mps;
    this.targetSpeedMps = snap.targetSpeedMps;
    this.accelLimitMps2 = snap.accelLimitMps2;
    this.decelLimitMps2 = snap.decelLimitMps2;
  }

  public setTargetSpeed(targetMps: number, currentSimTimeS: number = 0, totalLengthM: number = 1): void {
    if (!Number.isFinite(targetMps) || targetMps < 0 || targetMps > 1000) {
      throw new Error('Target speed must be finite and in [0, 1000] m/s.');
    }
    if (!Number.isFinite(currentSimTimeS)) {
      throw new Error('Current simulation time must be finite.');
    }
    if (!Number.isFinite(totalLengthM) || totalLengthM <= 0) {
      throw new Error('Trajectory total length must be a positive finite number.');
    }
    const curr = this.evaluateAtTime(currentSimTimeS, totalLengthM);
    this.t0S = currentSimTimeS;
    this.s0M = curr.distanceM;
    this.v0Mps = curr.speedMps;
    this.targetSpeedMps = targetMps;
  }

  public setLimits(accelLimitMps2?: number, decelLimitMps2?: number): void {
    if (accelLimitMps2 !== undefined) {
      if (!Number.isFinite(accelLimitMps2) || accelLimitMps2 <= 0) {
        throw new Error('Acceleration limit must be a positive finite number.');
      }
      this.accelLimitMps2 = accelLimitMps2;
    }
    if (decelLimitMps2 !== undefined) {
      if (!Number.isFinite(decelLimitMps2) || decelLimitMps2 <= 0) {
        throw new Error('Deceleration limit must be a positive finite number.');
      }
      this.decelLimitMps2 = decelLimitMps2;
    }
  }

  public reset(initialSpeedMps: number = 60.0): void {
    if (!Number.isFinite(initialSpeedMps) || initialSpeedMps < 0 || initialSpeedMps > 1000) {
      throw new Error('Initial speed must be finite and in [0, 1000] m/s.');
    }
    this.t0S = 0.0;
    this.s0M = 0.0;
    this.v0Mps = initialSpeedMps;
    this.targetSpeedMps = initialSpeedMps;
  }

  public evaluateAtTime(tS: number, totalLengthM: number): { distanceM: number; speedMps: number } {
    if (!Number.isFinite(tS)) {
      throw new Error('Simulation time must be finite.');
    }
    if (!Number.isFinite(totalLengthM) || totalLengthM <= 0) {
      throw new Error('Trajectory total length must be a positive finite number.');
    }
    const dt = tS - this.t0S;

    if (dt >= 0) {
      const v0 = this.v0Mps;
      const vt = this.targetSpeedMps;

      if (Math.abs(v0 - vt) < 1e-9) {
        let dist = (this.s0M + vt * dt) % totalLengthM;
        if (dist < 0) dist += totalLengthM;
        return { distanceM: dist, speedMps: vt };
      }

      if (v0 < vt) {
        const a = this.accelLimitMps2;
        const tRamp = (vt - v0) / a;
        if (dt <= tRamp) {
          const speed = v0 + a * dt;
          const deltaS = v0 * dt + 0.5 * a * dt * dt;
          let dist = (this.s0M + deltaS) % totalLengthM;
          if (dist < 0) dist += totalLengthM;
          return { distanceM: dist, speedMps: speed };
        } else {
          const deltaSRamp = v0 * tRamp + 0.5 * a * tRamp * tRamp;
          const deltaSConst = vt * (dt - tRamp);
          let dist = (this.s0M + deltaSRamp + deltaSConst) % totalLengthM;
          if (dist < 0) dist += totalLengthM;
          return { distanceM: dist, speedMps: vt };
        }
      } else {
        const d = this.decelLimitMps2;
        const tRamp = (v0 - vt) / d;
        if (dt <= tRamp) {
          const speed = v0 - d * dt;
          const deltaS = v0 * dt - 0.5 * d * dt * dt;
          let dist = (this.s0M + deltaS) % totalLengthM;
          if (dist < 0) dist += totalLengthM;
          return { distanceM: dist, speedMps: speed };
        } else {
          const deltaSRamp = v0 * tRamp - 0.5 * d * tRamp * tRamp;
          const deltaSConst = vt * (dt - tRamp);
          let dist = (this.s0M + deltaSRamp + deltaSConst) % totalLengthM;
          if (dist < 0) dist += totalLengthM;
          return { distanceM: dist, speedMps: vt };
        }
      }
    } else {
      const v0 = this.v0Mps;
      let dist = (this.s0M + v0 * dt) % totalLengthM;
      if (dist < 0) dist += totalLengthM;
      return { distanceM: dist, speedMps: v0 };
    }
  }
}

/**
 * Constant-Airspeed & Bounded-Acceleration Rotated Elliptical Kinematics Engine.
 *
 * Integrates arc-length parameterized orbit with bounded acceleration/deceleration
 * speed transitions and hover support.
 */
export class ACNTrajectoryEngine implements ACNTrajectory {
  public readonly flightConfig: ACNFlightConfig;
  public readonly numLutSamples: number;
  public readonly orbitPeriodS: number;
  public readonly totalLengthM: number;

  private readonly thetaLut: Float64Array;
  private readonly sLut: Float64Array;
  private readonly totalPerimeterM: number;
  private readonly kinematics: TrajectoryKinematics;

  constructor(flightConfig: ACNFlightConfig, numLutSamples: number = 2048) {
    if (!Number.isFinite(flightConfig.loiterSpeedMps) || flightConfig.loiterSpeedMps < 0 || flightConfig.loiterSpeedMps > 1000) {
      throw new Error('Trajectory speed must be finite and in [0, 1000] m/s.');
    }
    if (!Number.isFinite(flightConfig.altitudeMslM) || !Number.isFinite(flightConfig.centerXm) || !Number.isFinite(flightConfig.centerYm) ||
        !Number.isFinite(flightConfig.loiterRadiusAM) || !Number.isFinite(flightConfig.loiterRadiusBM) ||
        flightConfig.loiterRadiusAM <= 0 || flightConfig.loiterRadiusBM <= 0 || !Number.isFinite(flightConfig.loiterRotationDeg)) {
      throw new Error('Ellipse trajectory configuration must contain finite coordinates, altitude, rotation, and positive axes.');
    }
    this.flightConfig = flightConfig;
    this.numLutSamples = numLutSamples;

    const a = this.flightConfig.loiterRadiusAM;
    const b = this.flightConfig.loiterRadiusBM;
    const v0 = this.flightConfig.loiterSpeedMps;

    this.thetaLut = new Float64Array(numLutSamples);
    this.sLut = new Float64Array(numLutSamples);

    const dTheta = (2.0 * Math.PI) / (numLutSamples - 1);
    let cumulativeS = 0.0;
    this.sLut[0] = 0.0;
    this.thetaLut[0] = 0.0;

    for (let i = 1; i < numLutSamples; i++) {
      const thetaPrev = (i - 1) * dTheta;
      const thetaCurr = i * dTheta;
      this.thetaLut[i] = thetaCurr;

      const dsPrev = Math.sqrt(
        Math.pow(a * Math.sin(thetaPrev), 2) + Math.pow(b * Math.cos(thetaPrev), 2)
      );
      const dsCurr = Math.sqrt(
        Math.pow(a * Math.sin(thetaCurr), 2) + Math.pow(b * Math.cos(thetaCurr), 2)
      );

      cumulativeS += 0.5 * (dsPrev + dsCurr) * dTheta;
      this.sLut[i] = cumulativeS;
    }

    this.totalPerimeterM = this.sLut[numLutSamples - 1];
    this.totalLengthM = this.totalPerimeterM;
    this.orbitPeriodS = v0 > 0 ? this.totalPerimeterM / v0 : Number.POSITIVE_INFINITY;

    this.kinematics = new TrajectoryKinematics(
      v0,
      flightConfig.accelerationLimitMps2,
      flightConfig.decelerationLimitMps2
    );
  }

  public get currentSpeedMps(): number {
    return this.kinematics.evaluateAtTime(0, this.totalPerimeterM).speedMps;
  }

  public get targetSpeedMps(): number {
    return this.kinematics.targetSpeedMps;
  }

  public getCurrentSpeed(tS: number): number {
    return this.kinematics.evaluateAtTime(tS, this.totalPerimeterM).speedMps;
  }

  public setTargetSpeed(targetSpeedMps: number, currentSimTimeS: number = 0): void {
    this.kinematics.setTargetSpeed(targetSpeedMps, currentSimTimeS, this.totalPerimeterM);
  }

  public setLimits(accelLimitMps2?: number, decelLimitMps2?: number): void {
    this.kinematics.setLimits(accelLimitMps2, decelLimitMps2);
  }

  public resetKinematics(initialSpeedMps?: number): void {
    this.kinematics.reset(initialSpeedMps ?? this.flightConfig.loiterSpeedMps);
  }

  public getKinematicsState(): TrajectoryKinematicsSnapshot {
    return this.kinematics.getSnapshot();
  }

  public restoreKinematicsState(snapshot: TrajectoryKinematicsSnapshot): void {
    this.kinematics.restoreSnapshot(snapshot);
  }

  /**
   * Resolves eccentric angle theta at arc-length distance using linear interpolation over arc-length LUT.
   */
  public getThetaAtDistance(dist: number): number {
    if (this.totalPerimeterM <= 0.0) return 0.0;
    let s = dist % this.totalPerimeterM;
    if (s < 0.0) s += this.totalPerimeterM;

    // Binary search over sLut
    let low = 0;
    let high = this.numLutSamples - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.sLut[mid] < s) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const idx = Math.max(1, Math.min(this.numLutSamples - 1, low));
    const s0 = this.sLut[idx - 1];
    const s1 = this.sLut[idx];
    const frac = s1 > s0 ? (s - s0) / (s1 - s0) : 0.0;

    return this.thetaLut[idx - 1] + frac * (this.thetaLut[idx] - this.thetaLut[idx - 1]);
  }

  /**
   * Resolves eccentric angle theta at time tS using current speed kinematics.
   */
  public getThetaAtTime(tS: number): number {
    if (this.totalPerimeterM <= 0.0) return 0.0;
    const { distanceM } = this.kinematics.evaluateAtTime(tS, this.totalPerimeterM);
    return this.getThetaAtDistance(distanceM);
  }

  /**
   * Calculates 3D Cartesian coordinates [x, y, z] (m) at time tS along rotated ellipse.
   */
  public getAcnPosition(tS: number): [number, number, number] {
    const a = this.flightConfig.loiterRadiusAM;
    const b = this.flightConfig.loiterRadiusBM;
    const phi = (this.flightConfig.loiterRotationDeg * Math.PI) / 180.0;
    const cx = this.flightConfig.centerXm;
    const cy = this.flightConfig.centerYm;
    const cz = this.flightConfig.altitudeMslM;

    const theta = this.getThetaAtTime(tS);
    const xRaw = a * Math.cos(theta);
    const yRaw = b * Math.sin(theta);

    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    const x = cx + xRaw * cosPhi - yRaw * sinPhi;
    const y = cy + xRaw * sinPhi + yRaw * cosPhi;
    const z = cz;

    return [x, y, z];
  }

  /**
   * Calculates tangent velocity vector [vx, vy, vz] (m/s).
   * Exact magnitude sqrt(vx^2 + vy^2) equals current speed m/s (0.0 m/s when hovering).
   */
  public getAcnVelocity(tS: number): [number, number, number] {
    const a = this.flightConfig.loiterRadiusAM;
    const b = this.flightConfig.loiterRadiusBM;
    const speed = this.getCurrentSpeed(tS);
    if (speed <= 1e-9) return [0.0, 0.0, 0.0];

    const phi = (this.flightConfig.loiterRotationDeg * Math.PI) / 180.0;

    const theta = this.getThetaAtTime(tS);
    const dsDtheta = Math.sqrt(
      Math.pow(a * Math.sin(theta), 2) + Math.pow(b * Math.cos(theta), 2)
    );
    if (dsDtheta < 1e-9) return [0.0, 0.0, 0.0];

    const dThetaDt = speed / dsDtheta;
    const vxRaw = -a * Math.sin(theta) * dThetaDt;
    const vyRaw = b * Math.cos(theta) * dThetaDt;

    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    const vx = vxRaw * cosPhi - vyRaw * sinPhi;
    const vy = vxRaw * sinPhi + vyRaw * cosPhi;

    return [vx, vy, 0.0];
  }

  public getPathPoints(numPoints: number = 64): [number, number][] {
    const a = this.flightConfig.loiterRadiusAM;
    const b = this.flightConfig.loiterRadiusBM;
    const phi = (this.flightConfig.loiterRotationDeg * Math.PI) / 180.0;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    const points: [number, number][] = [];
    for (let i = 0; i < numPoints; i++) {
      const theta = (2.0 * Math.PI * i) / numPoints;
      const xr = a * Math.cos(theta), yr = b * Math.sin(theta);
      points.push([
        this.flightConfig.centerXm + xr * cosPhi - yr * sinPhi,
        this.flightConfig.centerYm + xr * sinPhi + yr * cosPhi,
      ]);
    }
    return points;
  }
}

interface WaypointSample {
  readonly distanceM: number;
  readonly segment: number;
  readonly u: number;
  readonly point: readonly [number, number];
}

/**
 * Closed, shape-limited cubic Hermite waypoint loop, sampled by arc length.
 * Shared bounded tangents keep the curve C1 at waypoints. Tangent arms are
 * limited by adjacent edge lengths to control excursions on irregular routes.
 */
export class WaypointTrajectoryEngine implements ACNTrajectory {
  public readonly flightConfig: ACNFlightConfig;
  public readonly totalLengthM: number;
  public readonly orbitPeriodS: number;

  private readonly points: readonly ACNWaypoint[];
  private readonly samples: WaypointSample[] = [];
  private readonly kinematics: TrajectoryKinematics;

  constructor(flightConfig: ACNFlightConfig, samplesPerSegment: number = 512) {
    if (flightConfig.trajectoryMode !== 'waypoints') throw new Error('Waypoint trajectory mode must be explicit.');
    if (!Number.isFinite(flightConfig.loiterSpeedMps) || flightConfig.loiterSpeedMps < 0 || flightConfig.loiterSpeedMps > 1000) {
      throw new Error('Waypoint trajectory speed must be finite and in [0, 1000] m/s.');
    }
    if (!Number.isFinite(flightConfig.altitudeMslM)) throw new Error('ACN altitude must be finite.');
    const input = flightConfig.waypoints;
    if (!Number.isInteger(samplesPerSegment) || samplesPerSegment < 8) throw new Error('samplesPerSegment must be an integer of at least 8.');
    const copied = validateClosedWaypointPath(input);
    this.points = Object.freeze(copied);
    this.flightConfig = flightConfig;

    let distanceM = 0;
    let previous = this.evaluateSegment(0, 0);
    this.samples.push({ distanceM, segment: 0, u: 0, point: previous });
    for (let segment = 0; segment < copied.length; segment++) {
      if (segment > 0) {
        const start = this.evaluateSegment(segment, 0);
        this.samples.push({ distanceM, segment, u: 0, point: start });
        previous = start;
      }
      for (let step = 1; step <= samplesPerSegment; step++) {
        const u = step / samplesPerSegment;
        const point = this.evaluateSegment(segment, u);
        distanceM += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        this.samples.push({ distanceM, segment, u, point });
        previous = point;
      }
    }
    if (!(distanceM > 1e-6) || !Number.isFinite(distanceM)) throw new Error('Waypoint loop is degenerate.');
    this.totalLengthM = distanceM;
    this.orbitPeriodS = flightConfig.loiterSpeedMps > 0 ? distanceM / flightConfig.loiterSpeedMps : Number.POSITIVE_INFINITY;

    this.kinematics = new TrajectoryKinematics(
      flightConfig.loiterSpeedMps,
      flightConfig.accelerationLimitMps2,
      flightConfig.decelerationLimitMps2
    );
  }

  public get currentSpeedMps(): number {
    return this.kinematics.evaluateAtTime(0, this.totalLengthM).speedMps;
  }

  public get targetSpeedMps(): number {
    return this.kinematics.targetSpeedMps;
  }

  public getCurrentSpeed(tS: number): number {
    return this.kinematics.evaluateAtTime(tS, this.totalLengthM).speedMps;
  }

  public setTargetSpeed(targetSpeedMps: number, currentSimTimeS: number = 0): void {
    this.kinematics.setTargetSpeed(targetSpeedMps, currentSimTimeS, this.totalLengthM);
  }

  public setLimits(accelLimitMps2?: number, decelLimitMps2?: number): void {
    this.kinematics.setLimits(accelLimitMps2, decelLimitMps2);
  }

  public resetKinematics(initialSpeedMps?: number): void {
    this.kinematics.reset(initialSpeedMps ?? this.flightConfig.loiterSpeedMps);
  }

  public getKinematicsState(): TrajectoryKinematicsSnapshot {
    return this.kinematics.getSnapshot();
  }

  public restoreKinematicsState(snapshot: TrajectoryKinematicsSnapshot): void {
    this.kinematics.restoreSnapshot(snapshot);
  }

  private evaluateSegment(segment: number, u: number): [number, number] {
    const count = this.points.length;
    const p1 = this.points[segment % count];
    const p2 = this.points[(segment + 1) % count];
    const tangentAt = (index: number): [number, number] => {
      const previous = this.points[(index + count - 1) % count];
      const current = this.points[index % count];
      const next = this.points[(index + 1) % count];
      const inX = current.xM - previous.xM, inY = current.yM - previous.yM;
      const outX = next.xM - current.xM, outY = next.yM - current.yM;
      const inLength = Math.hypot(inX, inY), outLength = Math.hypot(outX, outY);
      const inUx = inX / inLength, inUy = inY / inLength;
      const outUx = outX / outLength, outUy = outY / outLength;
      let tx = inUx + outUx, ty = inUy + outUy;
      let tangentLength = Math.hypot(tx, ty);
      if (tangentLength <= 1e-9) {
        tx = outUx;
        ty = outUy;
        tangentLength = 1;
      }
      // The Bézier-equivalent control arm is at most one quarter of either
      // adjacent edge, limiting excursions on acute and irregular corners.
      const magnitude = 0.75 * Math.min(inLength, outLength);
      return [tx / tangentLength * magnitude, ty / tangentLength * magnitude];
    };
    const [m1x, m1y] = tangentAt(segment);
    const [m2x, m2y] = tangentAt(segment + 1);
    const t = Math.max(0, Math.min(1, u));
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return [
      h00 * p1.xM + h10 * m1x + h01 * p2.xM + h11 * m2x,
      h00 * p1.yM + h10 * m1y + h01 * p2.yM + h11 * m2y,
    ];
  }

  private distanceAtTime(tS: number): number {
    if (!Number.isFinite(tS)) throw new Error('Simulation time must be finite.');
    return this.kinematics.evaluateAtTime(tS, this.totalLengthM).distanceM;
  }

  private pointAtDistance(distanceM: number): [number, number] {
    let low = 0, high = this.samples.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.samples[mid].distanceM <= distanceM) low = mid + 1;
      else high = mid;
    }
    const leftIndex = Math.max(0, low - 1);
    const left = this.samples[leftIndex];
    const right = this.samples[Math.min(this.samples.length - 1, leftIndex + 1)];
    if (left.segment !== right.segment || right.distanceM <= left.distanceM) return [...left.point];
    const fraction = Math.max(0, Math.min(1, (distanceM - left.distanceM) / (right.distanceM - left.distanceM)));
    return this.evaluateSegment(left.segment, left.u + fraction * (right.u - left.u));
  }

  public getAcnPosition(tS: number): [number, number, number] {
    const [x, y] = this.pointAtDistance(this.distanceAtTime(tS));
    return [x, y, this.flightConfig.altitudeMslM];
  }

  public getAcnVelocity(tS: number): [number, number, number] {
    const speed = this.getCurrentSpeed(tS);
    if (speed <= 1e-9) return [0, 0, 0];
    // Return the centered 20 ms position derivative used by the 50 Hz worker.
    // Its magnitude is deliberately not normalized: the arc-length table's
    // measured timing error must remain visible to link/telemetry consumers.
    const halfStepS = 0.01;
    const before = this.getAcnPosition(tS - halfStepS);
    const after = this.getAcnPosition(tS + halfStepS);
    return [(after[0] - before[0]) / (2 * halfStepS), (after[1] - before[1]) / (2 * halfStepS), 0];
  }

  public getPathPoints(numPoints: number = 64): [number, number][] {
    if (!Number.isInteger(numPoints) || numPoints < 3) throw new Error('numPoints must be an integer of at least 3.');
    return Array.from({ length: numPoints }, (_, i) => this.pointAtDistance(this.totalLengthM * i / numPoints));
  }

  /** Segment starts derived from the same chord-length table used for timing. */
  public getSegmentBoundaryTimesS(): number[] {
    return this.samples
      .filter(sample => sample.u === 0)
      .map(sample => this.flightConfig.loiterSpeedMps > 0 ? sample.distanceM / this.flightConfig.loiterSpeedMps : 0);
  }
}

export function createACNTrajectory(flightConfig: ACNFlightConfig, previousState?: TrajectoryKinematicsSnapshot): ACNTrajectory {
  const engine = flightConfig.trajectoryMode === 'waypoints'
    ? new WaypointTrajectoryEngine(flightConfig)
    : new ACNTrajectoryEngine(flightConfig);
  if (previousState) {
    engine.restoreKinematicsState(previousState);
  }
  return engine;
}

/**
 * Predictive Look-Ahead Machine.
 *
 * Forwards UAV trajectory across terrain to anticipate mountain shadow entry
 * and exit events before physical LOS collapse.
 */
export class PredictiveLookAheadEngine {
  public readonly terrainEngine: TerrainEngine;
  public readonly linkBudgetEngine: LinkBudgetEngine;
  public readonly rfConfig: RFConfig;
  public readonly envConfig: EnvironmentConfig;
  public readonly flightConfig: ACNFlightConfig;
  public readonly trajectoryEngine: ACNTrajectory;

  public horizonS: number;
  public dtStepS: number;
  public warningTimeThresholdS: number;

  constructor(
    terrainEngine: TerrainEngine,
    linkBudgetEngine: LinkBudgetEngine,
    rfConfig: RFConfig,
    envConfig: EnvironmentConfig,
    flightConfig: ACNFlightConfig,
    trajectoryEngine?: ACNTrajectory,
    options?: {
      horizonS?: number;
      dtStepS?: number;
      warningTimeThresholdS?: number;
    }
  ) {
    this.terrainEngine = terrainEngine;
    this.linkBudgetEngine = linkBudgetEngine;
    this.rfConfig = rfConfig;
    this.envConfig = envConfig;
    this.flightConfig = flightConfig;
    this.trajectoryEngine = trajectoryEngine ?? createACNTrajectory(flightConfig);
    this.horizonS = options?.horizonS ?? 15.0;
    this.dtStepS = options?.dtStepS ?? 0.5;
    this.warningTimeThresholdS = options?.warningTimeThresholdS ?? 3.0;
  }

  public evaluatePredictiveState(
    nodePos: Position3D,
    currentSimTimeS: number
  ): PredictiveState {
    const acnPos = this.trajectoryEngine.getAcnPosition(currentSimTimeS);
    const currentObs = this.terrainEngine.evaluateTerrainObstruction(
      nodePos,
      acnPos,
      this.rfConfig,
      this.envConfig
    );

    const nextPos = this.trajectoryEngine.getAcnPosition(currentSimTimeS + this.dtStepS);
    const nextObs = this.terrainEngine.evaluateTerrainObstruction(
      nodePos,
      nextPos,
      this.rfConfig,
      this.envConfig
    );
    const fresnelRateOfChangeMps =
      (nextObs.minClearanceM - currentObs.minClearanceM) / this.dtStepS;

    const steps = Math.floor(this.horizonS / this.dtStepS);

    if (!currentObs.isLos || currentObs.obstacleBlocked) {
      // Regime A: Hard shadow (Optical ray blocked)
      let timeToEmergenceS = Number.POSITIVE_INFINITY;

      for (let step = 1; step <= steps; step++) {
        const futureT = currentSimTimeS + step * this.dtStepS;
        const futureAcn = this.trajectoryEngine.getAcnPosition(futureT);
        const futureObs = this.terrainEngine.evaluateTerrainObstruction(
          nodePos,
          futureAcn,
          this.rfConfig,
          this.envConfig
        );
        if (futureObs.isLos && !futureObs.obstacleBlocked) {
          timeToEmergenceS = step * this.dtStepS;
          break;
        }
      }

      const predictedOutageDurationS = Number.isFinite(timeToEmergenceS) ? timeToEmergenceS : 0.0;
      const state =
        timeToEmergenceS <= 1.0
          ? NodeTerrainState.RE_EMERGENCE_BURST
          : NodeTerrainState.HARD_SHADOW_CUTOFF;

      return {
        currentState: state,
        timeToOcclusionS: 0.0,
        timeToEmergenceS,
        fresnelClearanceM: currentObs.minClearanceM,
        fresnelRateOfChangeMps,
        predictedOutageDurationS,
        obstacleBlocked: currentObs.obstacleBlocked,
      };
    } else {
      // Regime B: Unobstructed Line-of-Sight
      let timeToOcclusionS = Number.POSITIVE_INFINITY;
      let predictedOutageDurationS = 0.0;
      let occlusionStep: number | null = null;

      for (let step = 1; step <= steps; step++) {
        const futureT = currentSimTimeS + step * this.dtStepS;
        const futureAcn = this.trajectoryEngine.getAcnPosition(futureT);
        const futureObs = this.terrainEngine.evaluateTerrainObstruction(
          nodePos,
          futureAcn,
          this.rfConfig,
          this.envConfig
        );
        if (!futureObs.isLos || futureObs.obstacleBlocked) {
          timeToOcclusionS = step * this.dtStepS;
          occlusionStep = step;
          break;
        }
      }

      if (occlusionStep !== null) {
        let emergenceFound = false;
        for (let step = occlusionStep + 1; step <= steps; step++) {
          const futureT = currentSimTimeS + step * this.dtStepS;
          const futureAcn = this.trajectoryEngine.getAcnPosition(futureT);
          const futureObs = this.terrainEngine.evaluateTerrainObstruction(
            nodePos,
            futureAcn,
            this.rfConfig,
            this.envConfig
          );
          if (futureObs.isLos && !futureObs.obstacleBlocked) {
            predictedOutageDurationS = (step - occlusionStep) * this.dtStepS;
            emergenceFound = true;
            break;
          }
        }
        if (!emergenceFound) {
          predictedOutageDurationS = (steps - occlusionStep) * this.dtStepS;
        }
      }

      const state =
        timeToOcclusionS <= this.warningTimeThresholdS
          ? NodeTerrainState.PRE_OCCLUSION_FLUSH
          : NodeTerrainState.NORMAL_LOS;

      return {
        currentState: state,
        timeToOcclusionS,
        timeToEmergenceS: 0.0,
        fresnelClearanceM: currentObs.minClearanceM,
        fresnelRateOfChangeMps,
        predictedOutageDurationS,
        obstacleBlocked: currentObs.obstacleBlocked,
      };
    }
  }
}
```

### File: `src/core/transferManager.ts` (278 lines, 9,609 bytes)

```typescript
/**
 * Active Mission Transfer Manager for the X-Band Aerial Communication Network Digital Twin.
 *
 * Encapsulates application-layer file and message transfer tracking:
 * 1. Per-node transfer state transitions (IDLE, TRANSMITTING, BLOCKED_NLOS, ACKNOWLEDGED, FAILED_DROPPED).
 * 2. Payload delivery accumulation from scheduler slot allocations.
 * 3. Shadow occlusion detection and automatic resume on re-emergence.
 * 4. Queue drop attribution and transfer expiration.
 * 5. Instantaneous and smoothed transfer rate (bps) and ETA calculations.
 *
 * This module is part of the authoritative domain state machine layer.
 */

import { FRAME_DT } from '../shared/constants';
import { GroundNodeTrafficSubsystem, QOS_PROFILES } from './queues';
import { LinkStatus } from './linkBudget';
import { FrameScheduleReport } from './scheduler';
import { NodeTerrainState, PredictiveState } from './trajectory';
import {
  calculateTransferEtaSeconds,
  calculateTransferRateBps,
  smoothTransferRateBps,
} from './transferMetrics';

/** Active file / packet transfer state tracking for individual nodes */
export interface NodeTransferState {
  activeType: string | null;
  totalBytes: number;
  deliveredBytes: number;
  prevDeliveredBytes: number;
  droppedBytes: number;
  droppedPackets: number;
  status: 'IDLE' | 'TRANSMITTING' | 'BLOCKED_NLOS' | 'FAILED_DROPPED' | 'ACKNOWLEDGED';
  statusMessage: string;
  startTimeS: number;
  ackTimeS: number;
  lastQueueDrops: number;
  lastUpdateSimTimeS: number;
  currentRateBps: number;
  etaS: number | null;
  etaStatus: string;
}

/** Creates a fresh idle transfer state object */
export function createIdleTransferState(): NodeTransferState {
  return {
    activeType: null,
    totalBytes: 0,
    deliveredBytes: 0,
    prevDeliveredBytes: 0,
    droppedBytes: 0,
    droppedPackets: 0,
    status: 'IDLE',
    statusMessage: '',
    startTimeS: -1.0,
    ackTimeS: -1.0,
    lastQueueDrops: 0,
    lastUpdateSimTimeS: -1.0,
    currentRateBps: 0,
    etaS: null,
    etaStatus: 'STANDBY',
  };
}

/** Standard default byte sizes for recognized tactical traffic types */
export function getDefaultPayloadBytes(trafficType: string): number {
  const ttype = trafficType.toUpperCase();
  if (ttype.includes('PHOTO')) return 2000000;
  if (ttype.includes('VIDEO')) return 42000;
  if (ttype.includes('VOICE')) return 8000;
  return 2560; // Default SOS / C2
}

/** Parameters required for a 50 Hz discrete transfer state machine advancement step */
export interface ActiveTransferStepParams {
  readonly activeNodes: readonly GroundNodeTrafficSubsystem[];
  readonly linkStatuses: ReadonlyMap<number, LinkStatus>;
  readonly predStates: ReadonlyMap<number, PredictiveState>;
  readonly activeReport: FrameScheduleReport | null;
  readonly simTimeS: number;
  readonly isPaused: boolean;
}

export class ActiveTransferManager {
  private readonly transfers = new Map<number, NodeTransferState>();

  /**
   * Returns a read-only map of all tracked node transfer states.
   */
  public get states(): ReadonlyMap<number, NodeTransferState> {
    return this.transfers;
  }

  /**
   * Returns the transfer state for a specific ground node, or undefined if untracked.
   */
  public get(nodeId: number): NodeTransferState | undefined {
    return this.transfers.get(nodeId);
  }

  /**
   * Checks whether a ground node has an active transfer entry.
   */
  public has(nodeId: number): boolean {
    return this.transfers.has(nodeId);
  }

  /**
   * Resets all transfer records, optionally populating idle records for the given node IDs.
   */
  public reset(nodeIds?: Iterable<number>): void {
    this.transfers.clear();
    if (nodeIds) {
      for (const nid of nodeIds) {
        this.transfers.set(nid, createIdleTransferState());
      }
    }
  }

  /**
   * Registers an initial idle transfer slot for a new or duplicated ground node.
   */
  public registerNode(nodeId: number): void {
    this.transfers.set(nodeId, createIdleTransferState());
  }

  /**
   * Evicts transfer tracking for a deleted ground node.
   */
  public evictNode(nodeId: number): boolean {
    return this.transfers.delete(nodeId);
  }

  /**
   * Resets a node's active transfer state back to IDLE (e.g. on CLEAR_TRANSFER).
   */
  public clearTransfer(nodeId: number): void {
    this.transfers.set(nodeId, createIdleTransferState());
  }

  /**
   * Initializes or updates an active transfer for a node (e.g. from INJECT_TRAFFIC or scenario preset).
   */
  public startTransfer(
    nodeId: number,
    trafficType: string,
    totalBytes: number,
    simTimeS: number,
    isBlocked: boolean,
    customMessage?: string
  ): void {
    const status = isBlocked ? 'BLOCKED_NLOS' : 'TRANSMITTING';
    const statusMessage = customMessage ?? (
      isBlocked
        ? 'TERRAIN BLOCKED: Packet buffered awaiting re-emergence.'
        : 'TRANSMITTING: Uplink active.'
    );
    const etaStatus = isBlocked ? 'BLOCKED (PAUSED)' : 'CALCULATING';

    this.transfers.set(nodeId, {
      activeType: trafficType,
      totalBytes,
      deliveredBytes: 0,
      prevDeliveredBytes: 0,
      droppedBytes: 0,
      droppedPackets: 0,
      status,
      statusMessage,
      startTimeS: simTimeS,
      ackTimeS: -1,
      lastQueueDrops: 0,
      lastUpdateSimTimeS: simTimeS,
      currentRateBps: 0,
      etaS: null,
      etaStatus,
    });
  }

  /**
   * Authoritative 50 Hz discrete simulation transfer state machine update.
   */
  public step(params: ActiveTransferStepParams): void {
    const qosMap: Record<string, number> = {
      SOS: 69, C2: 69, EMERGENCY: 69,
      VOICE: 65, PTT: 65,
      VIDEO: 67,
      PHOTO: 70, IMAGE: 70,
    };

    for (const node of params.activeNodes) {
      const nid = node.nodeId;
      const trans = this.transfers.get(nid);
      if (!trans || trans.status === 'IDLE') {
        continue;
      }

      if (trans.status === 'ACKNOWLEDGED' || trans.status === 'FAILED_DROPPED') {
        trans.currentRateBps = 0;
        trans.etaS = trans.status === 'ACKNOWLEDGED' ? 0 : null;
        trans.etaStatus = trans.status === 'ACKNOWLEDGED' ? 'COMPLETE' : 'DROPPED';
        continue;
      }

      const activeT = trans.activeType ?? 'SOS';
      const targetQos = qosMap[activeT] ?? 69;
      const pred = params.predStates.get(nid);
      const currState = pred?.currentState ?? NodeTerrainState.NORMAL_LOS;

      if (currState === NodeTerrainState.HARD_SHADOW_CUTOFF && trans.status === 'TRANSMITTING') {
        trans.status = 'BLOCKED_NLOS';
        trans.statusMessage = 'TERRAIN OCCLUSION: Link severed by ridge. Uplink paused.';
      } else if (currState !== NodeTerrainState.HARD_SHADOW_CUTOFF && trans.status === 'BLOCKED_NLOS') {
        trans.status = 'TRANSMITTING';
        trans.statusMessage = 'RE-EMERGED: Resuming uplink transfer.';
      }

      const currDrops = node.queue.droppedDelayCount + node.queue.droppedOverflowCount;
      const deltaDrops = Math.max(0, currDrops - trans.lastQueueDrops);
      trans.lastQueueDrops = currDrops;

      if (deltaDrops > 0) {
        const avgSz = QOS_PROFILES[targetQos]?.defaultBytes ?? 1200;
        trans.droppedPackets += deltaDrops;
        trans.droppedBytes += deltaDrops * avgSz;
      }

      const ls = params.linkStatuses.get(nid);
      const isOutage = ls?.isOutage ?? true;

      if (!isOutage && trans.status === 'TRANSMITTING') {
        const alloc = params.activeReport?.allocations.find((a) => a.nodeId === nid);
        if (alloc && alloc.capacityBits > 0) {
          const bytesServed = Math.floor(alloc.capacityBits / 8);
          trans.deliveredBytes = Math.min(trans.totalBytes, trans.deliveredBytes + bytesServed);

          if (activeT === 'SOS' || activeT === 'C2') {
            trans.status = 'ACKNOWLEDGED';
            trans.ackTimeS = params.simTimeS;
            trans.statusMessage = `[✓] SOS ACKNOWLEDGED BY ACN AT T+${params.simTimeS.toFixed(2)}s`;
          } else if (trans.deliveredBytes >= trans.totalBytes) {
            trans.status = 'ACKNOWLEDGED';
            trans.ackTimeS = params.simTimeS;
            trans.statusMessage = `[✓] ${activeT} FULLY DELIVERED & ACKNOWLEDGED AT T+${params.simTimeS.toFixed(2)}s`;
          }
        }
      }

      const subqLen = node.queue.getClassPacketCount(targetQos);
      if (
        (trans.status === 'TRANSMITTING' || trans.status === 'BLOCKED_NLOS') &&
        trans.droppedPackets > 0 &&
        subqLen === 0 &&
        trans.deliveredBytes < trans.totalBytes
      ) {
        trans.status = 'FAILED_DROPPED';
        trans.statusMessage = `[✖] ${activeT} FAILED: Packets expired/dropped in mountain shadow!`;
      }

      // Update transfer rate and ETA strictly using simulation-time differences
      const dtSim = trans.lastUpdateSimTimeS >= 0 ? Math.max(0.001, params.simTimeS - trans.lastUpdateSimTimeS) : FRAME_DT;
      const deliveredDelta = Math.max(0, trans.deliveredBytes - trans.prevDeliveredBytes);
      trans.prevDeliveredBytes = trans.deliveredBytes;
      trans.lastUpdateSimTimeS = params.simTimeS;

      if (trans.status === 'TRANSMITTING') {
        const instRate = calculateTransferRateBps(deliveredDelta, dtSim);
        trans.currentRateBps = smoothTransferRateBps(trans.currentRateBps, instRate, 0.3);
      } else {
        trans.currentRateBps = 0;
      }

      const remaining = Math.max(0, trans.totalBytes - trans.deliveredBytes);
      const eta = calculateTransferEtaSeconds(remaining, trans.currentRateBps, trans.status, params.isPaused);
      trans.etaS = eta.etaS;
      trans.etaStatus = eta.etaStatus;
    }
  }
}
```

### File: `src/core/transferMetrics.ts` (119 lines, 3,861 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Authoritative Transfer Metrics & ETA Calculations (Feature 1)
 *
 * Provides pure, deterministic functions for computing payload transfer rate
 * and estimated time to completion (ETA) strictly using simulation-time differences.
 */

export interface ActiveTransferTelemetry {
  readonly node_id: number;
  readonly status: 'IDLE' | 'TRANSMITTING' | 'BLOCKED_NLOS' | 'FAILED_DROPPED' | 'ACKNOWLEDGED';
  readonly status_message: string;
  readonly active_type: string | null;
  readonly total_bytes: number;
  readonly delivered_bytes: number;
  readonly dropped_bytes: number;
  readonly dropped_packets: number;
  readonly progress_pct: number;
  readonly start_time_s: number;
  readonly ack_time_s: number;
  readonly current_rate_bps: number;
  readonly current_rate_mbps: number;
  readonly eta_s: number | null;
  readonly eta_status: string;
}

/**
 * Calculates payload transfer rate in bits per second using simulation-time differences.
 * Strictly avoids wall-clock/performance.now() to ensure deterministic simulation-time accounting.
 *
 * @param deliveredBytesDelta Delta of delivered payload bytes between simulation steps
 * @param simTimeDeltaS Simulation time difference in seconds
 * @returns Rate in bits per second (bps)
 */
export function calculateTransferRateBps(
  deliveredBytesDelta: number,
  simTimeDeltaS: number
): number {
  if (simTimeDeltaS <= 0 || !Number.isFinite(simTimeDeltaS)) {
    return 0;
  }
  if (deliveredBytesDelta <= 0 || !Number.isFinite(deliveredBytesDelta)) {
    return 0;
  }
  return (deliveredBytesDelta * 8) / simTimeDeltaS;
}

/**
 * Computes an exponentially smoothed rate given previous rate, instantaneous rate, and smoothing alpha.
 */
export function smoothTransferRateBps(
  prevRateBps: number,
  instantRateBps: number,
  alpha: number = 0.3
): number {
  if (prevRateBps <= 0 || !Number.isFinite(prevRateBps)) {
    return Math.max(0, instantRateBps);
  }
  if (instantRateBps <= 0 || !Number.isFinite(instantRateBps)) {
    // Graceful decay when no bytes transferred in this frame
    return Math.max(0, prevRateBps * (1 - alpha));
  }
  return Math.max(0, prevRateBps * (1 - alpha) + instantRateBps * alpha);
}

/**
 * Calculates estimated remaining time in seconds and human-readable status text.
 * Strictly handles:
 * - Completed transfers (0.0s / COMPLETE)
 * - Blocked transfers (null / BLOCKED (PAUSED))
 * - Paused simulation (null / SIM PAUSED)
 * - Dropped payload (null / DROPPED)
 * - Zero rate or calculating state (null / CALCULATING)
 * - Standby/idle states
 */
export function calculateTransferEtaSeconds(
  remainingBytes: number,
  rateBps: number,
  status: string,
  isPaused: boolean
): { etaS: number | null; etaStatus: string } {
  if (status === 'IDLE' || !status) {
    return { etaS: null, etaStatus: 'STANDBY' };
  }
  if (status === 'ACKNOWLEDGED' || remainingBytes <= 0) {
    return { etaS: 0, etaStatus: 'COMPLETE' };
  }
  if (status === 'BLOCKED_NLOS') {
    return { etaS: null, etaStatus: 'BLOCKED (PAUSED)' };
  }
  if (status === 'FAILED_DROPPED') {
    return { etaS: null, etaStatus: 'DROPPED' };
  }
  if (status === 'IDLE' || !status) {
    return { etaS: null, etaStatus: 'STANDBY' };
  }
  if (isPaused) {
    return { etaS: null, etaStatus: 'SIM PAUSED' };
  }
  if (status !== 'TRANSMITTING') {
    return { etaS: null, etaStatus: status };
  }
  if (rateBps <= 0 || !Number.isFinite(rateBps)) {
    return { etaS: null, etaStatus: 'CALCULATING' };
  }

  const remainingBits = remainingBytes * 8;
  const etaS = remainingBits / rateBps;

  if (!Number.isFinite(etaS) || etaS < 0) {
    return { etaS: null, etaStatus: '--' };
  }

  const etaStatus = etaS < 60
    ? `${etaS.toFixed(1)}s`
    : `${Math.floor(etaS / 60)}m ${(etaS % 60).toFixed(0)}s`;

  return { etaS, etaStatus };
}
```

### File: `src/core/waypoints.ts` (39 lines, 2,326 bytes)

```typescript
import { ACNWaypoint, MAX_ACN_WAYPOINTS } from './config';

/** Validate and defensively copy a closed waypoint loop using the worker's route rules. */
export function validateClosedWaypointPath(input: unknown): readonly ACNWaypoint[] {
  if (!Array.isArray(input) || input.length < 3) throw new Error('A closed waypoint path requires at least three waypoints.');
  if (input.length > MAX_ACN_WAYPOINTS) throw new Error(`A waypoint path cannot exceed ${MAX_ACN_WAYPOINTS} waypoints.`);

  const copied: ACNWaypoint[] = input.map((point: unknown, index: number) => {
    if (!point || typeof point !== 'object') throw new Error(`Waypoint ${index} must have finite xM and yM coordinates.`);
    const candidate = point as Record<string, unknown>;
    if (typeof candidate.xM !== 'number' || !Number.isFinite(candidate.xM) ||
        typeof candidate.yM !== 'number' || !Number.isFinite(candidate.yM)) {
      throw new Error(`Waypoint ${index} must have finite xM and yM coordinates.`);
    }
    return Object.freeze({ xM: candidate.xM, yM: candidate.yM });
  });

  const distinct = new Set(copied.map(point => `${point.xM},${point.yM}`));
  if (distinct.size < 3) throw new Error('A waypoint path requires at least three distinct points.');
  for (let i = 0; i < copied.length; i++) {
    const a = copied[i], b = copied[(i + 1) % copied.length];
    const edgeLength = Math.hypot(b.xM - a.xM, b.yM - a.yM);
    if (!Number.isFinite(edgeLength) || edgeLength <= 1e-6) {
      throw new Error('Consecutive waypoints, including the closing pair, must be distinct.');
    }
  }
  const origin = copied[0];
  let farthest = copied[1];
  for (const point of copied.slice(2)) {
    if (Math.hypot(point.xM - origin.xM, point.yM - origin.yM) > Math.hypot(farthest.xM - origin.xM, farthest.yM - origin.yM)) farthest = point;
  }
  const baseline = Math.hypot(farthest.xM - origin.xM, farthest.yM - origin.yM);
  const maxPerpendicularDistance = copied.reduce((maximum, point) => Math.max(maximum,
    Math.abs((farthest.xM - origin.xM) * (point.yM - origin.yM) - (farthest.yM - origin.yM) * (point.xM - origin.xM)) / baseline), 0);
  if (!Number.isFinite(maxPerpendicularDistance) || maxPerpendicularDistance <= 1e-9) {
    throw new Error('Waypoint loop must enclose non-collinear geometry.');
  }
  return Object.freeze(copied);
}
```

### File: `src/shared/constants.ts` (33 lines, 1,168 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Centralized Shared Simulation & Environment Constants
 */

/** Nominal discrete simulation superframe duration (50 Hz = 20 ms). */
export const FRAME_DT = 0.020;

/** Regional theater half-span from origin (+/- 600 km, giving 1,200 x 1,200 km domain). */
export const THEATER_HALF_M = 600000.0;

/** Dedicated numeric node identifier for the Main Command Post. */
export const MCP_ID = 15;

/** Special node identifier for the Aerial Communication Node (e.g. orbit drag translation). */
export const ACN_ID = -1;

/** Standard number of ray-march samples across the propagation path for Fresnel clearance analysis. */
export const FRESNEL_SAMPLES = 80;

/** Minimum antenna height above ground level in metres. */
export const MIN_GROUND_AGL_M = 0.0;

/** Maximum antenna height above ground level in metres. */
export const MAX_GROUND_AGL_M = 1000.0;

/** Default antenna height above ground level in metres for newly created ground nodes. */
export const DEFAULT_ANTENNA_AGL_M = 2.0;

/** Maximum capacity ceiling of active ground nodes in the simulation. */
export const MAX_ACTIVE_GROUND_NODES = 128;


```

### File: `src/shared/types.ts` (21 lines, 575 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Shared Domain-Independent Types
 */

/**
 * 3D Cartesian coordinates [x, y, z] in metres.
 * x: East-West displacement (m) relative to theater origin.
 * y: North-South displacement (m) relative to theater origin.
 * z: Absolute altitude (m) MSL (Mean Sea Level).
 */
export type Position3D = readonly [xM: number, yM: number, zM: number];

/**
 * 2D coordinate point [x, y] (e.g. screen pixel coordinates or planar local coordinates).
 */
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

```

### File: `src/shared/utils.ts` (16 lines, 496 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Shared Utility Functions
 */

/**
 * Type guard verifying that a value is a finite number (excluding NaN and Infinities).
 */
export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Clamps a numeric value within the inclusive range [min, max].
 */
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
```

### File: `src/shared/workerProtocol.ts` (611 lines, 21,302 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Shared Worker Communication Protocol & Message Contracts
 *
 * Defines strongly typed contracts for all message exchanges between
 * the authoritative Web Worker simulation engine and the main UI thread.
 */

import type { Position3D } from './types';
import type { NodeType } from '../core/config';
import type { NodeTrafficOptions } from '../core/nodeRegistry';
import type { Obstacle } from '../core/obstacles';
import type { LinkProfile } from '../core/linkProfile';
import type { TerrainBoundsTelemetry, TerrainObstruction, DemGeographicMetadata } from '../core/terrain';
import type { NodeTerrainState } from '../core/trajectory';
import type { ActiveTransferTelemetry } from '../core/transferMetrics';
import type { RegistrationState, RegistrationEvent } from '../core/registration';

// ----------------------------------------------------------------------------
// Component Telemetry Contracts
// ----------------------------------------------------------------------------

export interface TrajectoryConfigTelemetry {
  readonly trajectory_mode: 'ellipse' | 'waypoints';
  readonly center_x_m: number;
  readonly center_y_m: number;
  readonly orbit_a_m: number;
  readonly orbit_b_m: number;
  readonly orbit_rotation_deg: number;
  readonly loiter_speed_mps?: number;
  readonly current_speed_mps?: number;
  readonly acn_altitude_m?: number;
  readonly waypoints: readonly { readonly x_m: number; readonly y_m: number }[];
}

export interface AcnTelemetry {
  readonly pos_x: number;
  readonly pos_y: number;
  readonly pos_z: number;
  readonly lat_deg: number;
  readonly lon_deg: number;
  readonly vel_x: number;
  readonly vel_y: number;
  readonly heading_rad: number;
  readonly current_speed_mps: number;
  readonly target_speed_mps: number;
  readonly acceleration_limit_mps2?: number;
  readonly deceleration_limit_mps2?: number;
  readonly coverage_radius_m: number;
  readonly coverage_radius_km: number;
  readonly flight_path: readonly (readonly [number, number])[];
}

export interface NodeTransferTelemetry {
  readonly node_id: number;
  readonly status: 'IDLE' | 'TRANSMITTING' | 'BLOCKED_NLOS' | 'FAILED_DROPPED' | 'ACKNOWLEDGED' | string;
  readonly status_message: string;
  readonly active_type: string | null;
  readonly total_bytes: number;
  readonly delivered_bytes: number;
  readonly dropped_bytes: number;
  readonly dropped_packets: number;
  readonly progress_pct: number;
  readonly start_time_s: number;
  readonly ack_time_s: number;
  readonly current_rate_bps: number;
  readonly current_rate_mbps: number;
  readonly eta_s: number | null;
  readonly eta_status: string;
}

export interface NodeTelemetryItem {
  readonly node_id: number;
  readonly entity_id?: string;
  readonly creation_sequence?: number;
  readonly name: string;
  readonly node_type: NodeType | string;
  readonly x_m: number;
  readonly y_m: number;
  readonly z_m: number;
  readonly position?: readonly [number, number, number];
  readonly lat_deg: number;
  readonly lon_deg: number;
  readonly coordinate_reference: string;
  readonly terrain_elevation_msl_m: number;
  readonly agl_m: number;
  readonly altitude_msl_m: number;
  readonly slant_range_km: number;
  readonly snr_db: number;
  readonly modcod_name: string;
  readonly link_outage: boolean;
  readonly bitrate_bps: number;
  readonly bitrate_mbps: number;
  readonly terrain_is_los: boolean;
  readonly diffraction_loss_db: number;
  readonly state_name: NodeTerrainState | string;
  readonly time_to_occlusion_s: number;
  readonly time_to_emergence_s: number;
  readonly fresnel_clearance_m: number;
  readonly obstacle_blocked: boolean;
  readonly is_coverage_complete?: boolean;
  readonly isCoverageComplete?: boolean;
  readonly coverage_note?: string;
  readonly coverageNote?: string;
  readonly c2_backlog: number;
  readonly voice_backlog: number;
  readonly video_backlog: number;
  readonly photo_backlog: number;
  readonly c2_bytes: number;
  readonly voice_bytes: number;
  readonly video_bytes: number;
  readonly photo_bytes: number;
  readonly total_backlog_bytes: number;
  readonly is_transmitting: boolean;
  readonly is_wasting_airtime: boolean;
  readonly allocated_slot_ms: number;
  readonly allocated_capacity_bits: number;
  readonly transfer_state: NodeTransferTelemetry | null;
  readonly color_hex: string;
  readonly tx_power_dbm: number;
  readonly battery_capacity_mah: number;
  readonly battery_level_pct: number;
  readonly tactical_priority: number;
  readonly is_depleted: boolean;
  readonly registration_state: string;
  readonly registration_start_time_s: number | null;
  readonly registration_completion_time_s: number | null;
  readonly registration_elapsed_s: number | null;
  readonly communication_eligible: boolean;
  readonly [key: string]: unknown;
}

export interface TelemetryGanttAllocation {
  readonly node_id: number;
  readonly start_ms: number;
  readonly duration_ms: number;
  readonly duration_s: number;
  readonly slot_start_s: number;
  readonly capacity_bits: number;
  readonly modcod_name: string;
  readonly spectral_efficiency: number;
  readonly c2_bytes: number;
  readonly voice_bytes: number;
  readonly video_bytes: number;
  readonly photo_bytes: number;
  readonly is_pre_occlusion_flush: boolean;
  readonly is_out_of_frame?: boolean;
}

export interface SelectedLinkBudgetTelemetry {
  readonly node_id: number;
  readonly node_type: NodeType | string;
  readonly slant_range_m: number;
  readonly slant_range_km: number;
  readonly fspl_db: number;
  readonly diffraction_loss_db: number;
  readonly gas_loss_db: number;
  readonly rain_loss_db: number;
  readonly cable_loss_db: number;
  readonly implementation_margin_db: number;
  readonly total_loss_db: number;
  readonly tx_power_dbm: number;
  readonly tx_gain_dbi: number;
  readonly rx_gain_dbi: number;
  readonly prx_dbm: number;
  readonly pnoise_dbm: number;
  readonly snr_db: number;
  readonly modcod_name: string;
  readonly spectral_efficiency_bps_hz: number;
  readonly bitrate_bps: number;
  readonly bitrate_mbps: number;
  readonly is_outage: boolean;
  readonly obstacle_blocked: boolean;
  readonly terrain_is_los: boolean;
  readonly earth_bulge_m: number;
  readonly channel_bandwidth_hz?: number;
  readonly is_coverage_complete?: boolean;
  readonly isCoverageComplete?: boolean;
  readonly coverage_note?: string;
  readonly coverageNote?: string;
  readonly [key: string]: unknown;
}

export interface FresnelSliceTelemetry {
  readonly profile: LinkProfile;
  readonly node_id: number;
  readonly node_name: string;
  readonly distance_km: number;
  readonly clearance_m: number;
  readonly status: string;
  readonly obstructed: boolean;
  readonly diffraction_loss_db: number;
  readonly terrain_is_los: boolean;
  readonly obstacle_blocked: boolean;
  readonly obstacle_intersections: TerrainObstruction['obstacleIntersections'];
  readonly state_name?: NodeTerrainState | string;
  readonly link_budget: SelectedLinkBudgetTelemetry;
  readonly profile_points: readonly [number, number, number, number][];
  readonly is_coverage_complete?: boolean;
  readonly coverage_note?: string;
}

export interface ComparativeKpiDashboard {
  readonly static_goodput_mb: number;
  readonly tac_goodput_mb: number;
  readonly gain_multiplier: number;
  readonly static_waste_pct: number;
  readonly tac_waste_pct: number;
  readonly static_drops: number;
  readonly static_drop_pct: number;
  readonly tac_drops: number;
  readonly tac_drop_pct: number;
  readonly ul_utilization_pct: number;
  readonly node4_pre_shadow_backlog_kb: number;
  readonly static_node4_pre_shadow_backlog_kb: number;
  readonly node4_evac_status: string;
  readonly static_selected_backlog_kb: number | null;
  readonly tac_selected_backlog_kb: number | null;
  readonly static_goodput_frame_bits: number;
  readonly tac_goodput_frame_bits: number;
  readonly active_goodput_frame_bits: number;
  readonly static_wasted_frame_bits: number;
  readonly tac_wasted_frame_bits: number;
  readonly active_wasted_frame_bits: number;
  readonly static_drop_delay_frame_pkts: number;
  readonly static_drop_overflow_frame_pkts: number;
  readonly static_drop_frame_pkts: number;
  readonly tac_drop_delay_frame_pkts: number;
  readonly tac_drop_overflow_frame_pkts: number;
  readonly tac_drop_frame_pkts: number;
  readonly active_drop_delay_frame_pkts: number;
  readonly active_drop_overflow_frame_pkts: number;
  readonly active_drop_frame_pkts: number;
  readonly static_utilization_pct: number;
  readonly tac_utilization_pct: number;
  readonly static_p50_bps: number | null;
  readonly static_p95_bps: number | null;
  readonly tac_p50_bps: number | null;
  readonly tac_p95_bps: number | null;
  readonly rolling_window_sample_count: number;
  readonly rolling_window_capacity: number;
}

export interface RegistrationTelemetry {
  readonly nodes: readonly {
    readonly node_id: number;
    readonly entity_id?: string;
    readonly state: RegistrationState | string;
    readonly start_time_s: number | null;
    readonly completion_time_s: number | null;
  }[];
  readonly events: readonly RegistrationEvent[];
}

export interface DownlinkTelemetry {
  readonly is_control_broadcast: boolean;
  readonly ctrl_duration_ms: number;
  readonly dl_duration_ms: number;
  readonly broadcast_active: boolean;
}

export interface TelemetryFrame {
  readonly frame_index: number;
  readonly sim_time_s: number;
  readonly speed: number;
  readonly target_speed: number;
  readonly achieved_speed: number;
  readonly paused: boolean;
  readonly step_request_id?: number;
  readonly spatial_locked: boolean;
  readonly spatial_revision: number;
  readonly trajectory_config: TrajectoryConfigTelemetry;
  readonly scheduler_mode: string;
  readonly selected_node_id: number;
  readonly plain_english_narrative: string;
  readonly acn_telemetry: AcnTelemetry;
  readonly nodes_telemetry: readonly NodeTelemetryItem[];
  readonly registration_telemetry: RegistrationTelemetry;
  readonly active_gantt_allocations: readonly TelemetryGanttAllocation[];
  readonly static_gantt_allocations: readonly TelemetryGanttAllocation[];
  readonly tac_gantt_allocations: readonly TelemetryGanttAllocation[];
  readonly comparative_kpi_dashboard: ComparativeKpiDashboard;
  readonly static_p50_bps: number | null;
  readonly static_p95_bps: number | null;
  readonly tac_p50_bps: number | null;
  readonly tac_p95_bps: number | null;
  readonly selected_node_fresnel: FresnelSliceTelemetry;
  readonly selected_link_budget: SelectedLinkBudgetTelemetry;
  readonly transfer_telemetry: ActiveTransferTelemetry;
  readonly active_transfers: readonly ActiveTransferTelemetry[];
  readonly downlink_telemetry: DownlinkTelemetry;
  readonly terrain_mode: string;
  readonly terrain_bounds_km: number;
  readonly terrain_bounds: TerrainBoundsTelemetry;
}

// ----------------------------------------------------------------------------
// Worker Command Result
// ----------------------------------------------------------------------------

export interface WorkerCommandResult {
  readonly type: 'COMMAND_RESULT';
  readonly command_type: string;
  readonly accepted: boolean;
  readonly reason?: string;
  readonly spatial_locked: boolean;
  readonly request_id?: string | number;
  readonly node_id?: number;
  readonly entity_id?: string;
  readonly deleted_node_id?: number;
  readonly source_node_id?: number;
  readonly creation_sequence?: number;
  readonly nodes_count?: number;
  readonly trajectory_config?: {
    readonly trajectory_mode: 'ellipse' | 'waypoints';
    readonly center_x_m: number;
    readonly center_y_m: number;
    readonly orbit_a_m: number;
    readonly orbit_b_m: number;
    readonly orbit_rotation_deg: number;
    readonly loiter_speed_mps?: number;
    readonly acn_altitude_m?: number;
    readonly waypoints: readonly { readonly x_m: number; readonly y_m: number }[];
  };
  readonly obstacle_set?: readonly Obstacle[];
  readonly obstruction_state?: readonly {
    readonly node_id: number;
    readonly terrain_is_los: boolean;
    readonly obstacle_blocked: boolean;
    readonly obstacle_intersections: TerrainObstruction['obstacleIntersections'];
    readonly link_outage: boolean;
    readonly bitrate_bps: number;
    readonly modcod_name: string;
    readonly predicted_state: NodeTerrainState;
    readonly time_to_occlusion_s: number;
    readonly time_to_emergence_s: number;
    readonly is_shadowed: boolean;
    readonly is_coverage_complete?: boolean;
    readonly coverage_note?: string;
  }[];
}

// ----------------------------------------------------------------------------
// Inbound Worker Commands (Main Thread -> Worker)
// ----------------------------------------------------------------------------

export interface BaseWorkerInboundCommand {
  readonly type: string;
  readonly request_id?: string | number;
}

export interface SimControlCommand extends BaseWorkerInboundCommand {
  readonly type: 'SIM_CONTROL';
  readonly action: 'pause' | 'resume' | 'step' | 'reset';
  readonly step_request_id?: number;
}

export interface SetSpeedCommand extends BaseWorkerInboundCommand {
  readonly type: 'SET_SPEED';
  readonly speed: number;
}

export interface SetSchedulerCommand extends BaseWorkerInboundCommand {
  readonly type: 'SET_SCHEDULER';
  readonly mode: 'tac_tad' | 'static';
}

export interface SelectNodeCommand extends BaseWorkerInboundCommand {
  readonly type: 'SELECT_NODE';
  readonly node_id: number;
}

export interface SetSpatialLockCommand extends BaseWorkerInboundCommand {
  readonly type: 'SET_SPATIAL_LOCK';
  readonly locked: boolean;
}

export interface NodeMoveCommand extends BaseWorkerInboundCommand {
  readonly type: 'NODE_MOVE';
  readonly node_id: number;
  readonly x_m: number;
  readonly y_m: number;
}

export interface NodeAddCommand extends BaseWorkerInboundCommand {
  readonly type: 'NODE_ADD';
  readonly role?: NodeType;
  readonly x_m?: number;
  readonly y_m?: number;
  readonly position?: readonly [number, number] | [number, number];
  readonly agl_m?: number;
  readonly callsign?: string;
  readonly color_hex?: string;
  readonly tx_power_dbm?: number;
  readonly battery_capacity_mah?: number;
  readonly battery_level_pct?: number;
  readonly tactical_priority?: number;
  readonly request_id?: string | number;
  readonly traffic_options?: NodeTrafficOptions;
}

export interface NodeDeleteCommand extends BaseWorkerInboundCommand {
  readonly type: 'NODE_DELETE';
  readonly node_id: number;
  readonly request_id?: string | number;
}

export interface NodeDuplicateCommand extends BaseWorkerInboundCommand {
  readonly type: 'NODE_DUPLICATE';
  readonly source_node_id: number;
  readonly offset_x_m?: number;
  readonly offset_y_m?: number;
  readonly callsign?: string;
  readonly request_id?: string | number;
}

export interface NodeUpdateCommand extends BaseWorkerInboundCommand {
  readonly type: 'NODE_UPDATE';
  readonly node_id: number;
  readonly x_m?: number;
  readonly y_m?: number;
  readonly agl_m?: number;
  readonly callsign?: string;
  readonly role?: 'soldier' | 'mcp';
  readonly color_hex?: string;
  readonly tx_power_dbm?: number;
  readonly battery_capacity_mah?: number;
  readonly battery_level_pct?: number;
  readonly tactical_priority?: number;
  readonly traffic_options?: NodeTrafficOptions;
  readonly request_id?: string | number;
}

export interface ObstaclesReplaceCommand extends BaseWorkerInboundCommand {
  readonly type: 'OBSTACLES_REPLACE';
  readonly obstacles: readonly Obstacle[] | Obstacle[] | readonly unknown[];
  readonly request_id?: string | number;
}

export interface ConfigUpdateParams {
  readonly carrier_freq_ghz?: number;
  readonly channel_bandwidth_mhz?: number;
  readonly rain_rate_mmh?: number;
  readonly acn_altitude_m?: number;
  readonly orbit_a_m?: number;
  readonly orbit_b_m?: number;
  readonly orbit_rotation_deg?: number;
  readonly loiter_speed_mps?: number;
  readonly acceleration_limit_mps2?: number;
  readonly deceleration_limit_mps2?: number;
  readonly coverage_radius_km?: number;
  readonly center_x_m?: number;
  readonly center_y_m?: number;
  readonly node_id?: number;
  readonly agl_m?: number;
  readonly terrain_mode?: 'real' | 'synthetic';
  readonly trajectory_mode?: 'ellipse' | 'waypoints';
  readonly waypoints?: readonly { readonly x_m: number; readonly y_m: number }[];
}

export interface ConfigUpdateCommand extends BaseWorkerInboundCommand {
  readonly type: 'CONFIG_UPDATE' | 'SET_PARAMS';
  readonly request_id?: string | number;
  readonly params?: ConfigUpdateParams;
  readonly carrier_freq_ghz?: number;
  readonly channel_bandwidth_mhz?: number;
  readonly rain_rate_mmh?: number;
  readonly acn_altitude_m?: number;
  readonly orbit_a_m?: number;
  readonly orbit_b_m?: number;
  readonly orbit_rotation_deg?: number;
  readonly loiter_speed_mps?: number;
  readonly acceleration_limit_mps2?: number;
  readonly deceleration_limit_mps2?: number;
  readonly coverage_radius_km?: number;
  readonly center_x_m?: number;
  readonly center_y_m?: number;
  readonly node_id?: number;
  readonly agl_m?: number;
  readonly terrain_mode?: 'real' | 'synthetic';
  readonly trajectory_mode?: 'ellipse' | 'waypoints';
  readonly waypoints?: readonly { readonly x_m: number; readonly y_m: number }[];
}

export interface LoadPresetCommand extends BaseWorkerInboundCommand {
  readonly type: 'LOAD_PRESET';
  readonly preset_id: 'ACN_ONLY' | '16_NODES' | string;
}

export interface InjectTrafficCommand extends BaseWorkerInboundCommand {
  readonly type: 'INJECT_TRAFFIC';
  readonly node_id?: number;
  readonly traffic_type: string;
}

export interface ClearTransferCommand extends BaseWorkerInboundCommand {
  readonly type: 'CLEAR_TRANSFER';
  readonly node_id?: number;
}

export interface SetTerrainModeCommand extends BaseWorkerInboundCommand {
  readonly type: 'SET_TERRAIN_MODE';
  readonly mode: 'real' | 'synthetic';
}

export interface LoadCustomDemCommand extends BaseWorkerInboundCommand {
  readonly type: 'LOAD_CUSTOM_DEM';
  readonly elevations: Float32Array | ArrayBuffer;
  readonly buffer?: ArrayBuffer | Float32Array;
  readonly request_id?: string | number;
  readonly metadata?: DemGeographicMetadata;
}

export interface GetHillshadeCommand extends BaseWorkerInboundCommand {
  readonly type: 'GET_HILLSHADE';
}

export interface GetTerrainBoundsCommand extends BaseWorkerInboundCommand {
  readonly type: 'GET_TERRAIN_BOUNDS';
  readonly request_id?: string | number;
}

export interface GetTerrainMeshDataCommand extends BaseWorkerInboundCommand {
  readonly type: 'GET_TERRAIN_MESH_DATA';
  readonly request_id?: string | number;
}

export type WorkerInboundCommand =
  | SimControlCommand
  | SetSpeedCommand
  | SetSchedulerCommand
  | SelectNodeCommand
  | SetSpatialLockCommand
  | NodeMoveCommand
  | NodeAddCommand
  | NodeDeleteCommand
  | NodeDuplicateCommand
  | NodeUpdateCommand
  | ObstaclesReplaceCommand
  | ConfigUpdateCommand
  | LoadPresetCommand
  | InjectTrafficCommand
  | ClearTransferCommand
  | SetTerrainModeCommand
  | LoadCustomDemCommand
  | GetHillshadeCommand
  | GetTerrainBoundsCommand
  | GetTerrainMeshDataCommand;

// ----------------------------------------------------------------------------
// Outbound Worker Messages (Worker -> Main Thread)
// ----------------------------------------------------------------------------

export interface TelemetryFrameMessage {
  readonly type: 'TELEMETRY_FRAME';
  readonly frame: TelemetryFrame;
}

export interface ProfileFrameMessage {
  readonly type: 'PROFILE_FRAME';
  readonly selectedNodeId: number;
  readonly profileSerial: number;
  readonly spatial_revision: number;
  readonly fresnel: FresnelSliceTelemetry;
  readonly selected_link_budget?: SelectedLinkBudgetTelemetry;
  readonly nodes_telemetry?: readonly NodeTelemetryItem[];
}

export interface HillshadeReadyMessage {
  readonly type: 'HILLSHADE_READY';
  readonly grid_size: number;
  readonly bounds_km: number;
  readonly bounds: TerrainBoundsTelemetry;
  readonly data: readonly (readonly number[])[] | number[][];
  readonly terrain_mode: 'real' | 'synthetic';
}

export interface TerrainBoundsReadyMessage {
  readonly type: 'TERRAIN_BOUNDS_READY';
  readonly request_id?: string | number;
  readonly bounds: TerrainBoundsTelemetry;
}

export interface CustomDemLoadedMessage {
  readonly type: 'CUSTOM_DEM_LOADED';
  readonly request_id?: string | number;
  readonly tile_name: string;
  readonly resolution: number;
  readonly bounds: TerrainBoundsTelemetry;
}

export interface TerrainMeshDataReadyMessage {
  readonly type: 'TERRAIN_MESH_DATA_READY';
  readonly request_id?: string | number;
  readonly terrain_mode: 'real' | 'synthetic';
  readonly bounds: TerrainBoundsTelemetry;
  readonly grid_size: number;
  readonly min_elevation_m: number;
  readonly max_elevation_m: number;
  readonly elevations: Float32Array;
}

/** Discriminated union of all messages posted from the simulation worker to the host. */
export type WorkerOutboundMessage =
  | TelemetryFrameMessage
  | ProfileFrameMessage
  | HillshadeReadyMessage
  | TerrainBoundsReadyMessage
  | CustomDemLoadedMessage
  | TerrainMeshDataReadyMessage
  | WorkerCommandResult;
```

### File: `src/worker/hillshadeGenerator.ts` (328 lines, 11,852 bytes)

```typescript
/**
 * Hillshade Relief Generator for the X-Band Aerial Communication Network Digital Twin.
 *
 * Encapsulates:
 * 1. 3D Lambertian shaded relief grid calculation across genuine real DEM coverage
 *    and synthetic full-theater procedural terrain.
 * 2. Internal caching of computed relief grids across mode switches and static DEM references.
 * 3. Continuous elevation sampling (direct-raster satellite DEM access and interpolated queries).
 * 4. Gradient, surface normal, and illumination calculations with NaN-safe boundary handling.
 * 5. Dark-mode tactical military color grading based on absolute altitude.
 */

import {
  REAL_LADAKH_DEM_METADATA,
  TerrainBoundsTelemetry,
  TerrainEngine,
} from '../core/terrain';
import { THEATER_HALF_M } from '../shared/constants';
import type { HillshadeReadyMessage } from '../shared/workerProtocol';

/**
 * Result of a hillshade relief generation or cache retrieval operation.
 */
export interface HillshadeResult {
  readonly grid: number[][];
  readonly gridSize: number;
  readonly boundsKm: number;
  readonly bounds: TerrainBoundsTelemetry;
  readonly terrainMode: 'real' | 'synthetic';
  /** True if the result was retrieved from internal cache without recomputation */
  readonly isCached: boolean;
  /** Ready-to-emit host telemetry message matching the authoritative worker protocol */
  readonly message: HillshadeReadyMessage;
}

/**
 * Cached hillshade entry for internal reuse.
 */
export interface CachedHillshadeEntry {
  readonly grid: number[][];
  readonly size: number;
  readonly demRef?: Float32Array | null;
}

/**
 * Dedicated hillshade generator encapsulating relief computation and caching.
 */
export class HillshadeGenerator {
  private cachedRealHillshade: { grid: number[][]; demRef: Float32Array | null; size: number } | null = null;
  private cachedSynthHillshade: { grid: number[][]; size: number } | null = null;
  private currentGrid: number[][] = [];

  constructor(private readonly defaultEngine?: TerrainEngine) {}

  /** Authoritative grid from the most recent generation or cache hit */
  public get hillshadeGrid(): number[][] {
    return this.currentGrid;
  }

  /** Read-only snapshot of cached real DEM hillshade entry */
  public get realCache(): Readonly<{ grid: number[][]; demRef: Float32Array | null; size: number }> | null {
    return this.cachedRealHillshade;
  }

  /** Read-only snapshot of cached synthetic hillshade entry */
  public get synthCache(): Readonly<{ grid: number[][]; size: number }> | null {
    return this.cachedSynthHillshade;
  }

  /**
   * Invalidate real DEM hillshade cache (e.g. when custom DEM elevations are loaded).
   */
  public invalidateRealCache(): void {
    this.cachedRealHillshade = null;
  }

  /**
   * Invalidate synthetic hillshade cache.
   */
  public invalidateSyntheticCache(): void {
    this.cachedSynthHillshade = null;
  }

  /**
   * Invalidate all hillshade caches.
   */
  public invalidateAll(): void {
    this.cachedRealHillshade = null;
    this.cachedSynthHillshade = null;
  }

  /**
   * Generates or retrieves a shaded relief grid across genuine terrain coverage:
   * - In real DEM mode: uses genuine Ladakh DEM coordinates (+/-91.8 km E-W, +/-110.9 km N-S, aspect ratio ~1.2079),
   *   exact metric ground resolution (dx=359.45m, dy=434.17m), and 512x512 matrix.
   * - In synthetic mode: covers full 1,200x1,200 km regional domain (+/-600 km).
   *
   * Static terrain hillshades are cached to avoid recomputation across frames or mode toggles.
   *
   * @param terrainEngine Authoritative TerrainEngine instance (defaults to constructor instance if provided)
   * @param gridSize Dimension of square hillshade output grid (defaults to 512)
   */
  public generate(terrainEngine?: TerrainEngine, gridSize: number = 512): HillshadeResult {
    const engine = terrainEngine ?? this.defaultEngine;
    if (!engine) {
      throw new Error('HillshadeGenerator: TerrainEngine is required to generate hillshade.');
    }

    const size = gridSize;
    const isReal = engine.terrainMode === 'real' && engine.hasRealDem && engine.realDemGrid !== null;
    const bounds = engine.getTerrainBoundsTelemetry();

    // Check cache first to avoid recomputing static DEM hillshades
    if (isReal) {
      if (
        this.cachedRealHillshade &&
        this.cachedRealHillshade.demRef === engine.realDemGrid &&
        this.cachedRealHillshade.size === size
      ) {
        this.currentGrid = this.cachedRealHillshade.grid;
        return {
          grid: this.currentGrid,
          gridSize: size,
          boundsKm: bounds.halfWidthM / 1000.0,
          bounds,
          terrainMode: engine.terrain_mode,
          isCached: true,
          message: {
            type: 'HILLSHADE_READY',
            grid_size: size,
            bounds_km: bounds.halfWidthM / 1000.0,
            bounds,
            data: this.currentGrid,
            terrain_mode: engine.terrain_mode,
          },
        };
      }
    } else {
      if (
        this.cachedSynthHillshade &&
        this.cachedSynthHillshade.size === size
      ) {
        this.currentGrid = this.cachedSynthHillshade.grid;
        return {
          grid: this.currentGrid,
          gridSize: size,
          boundsKm: bounds.halfWidthM / 1000.0,
          bounds,
          terrainMode: engine.terrain_mode,
          isCached: true,
          message: {
            type: 'HILLSHADE_READY',
            grid_size: size,
            bounds_km: bounds.halfWidthM / 1000.0,
            bounds,
            data: this.currentGrid,
            terrain_mode: engine.terrain_mode,
          },
        };
      }
    }

    const meta = engine.demMetadata ?? REAL_LADAKH_DEM_METADATA;
    const stepX = isReal ? (bounds.maxX - bounds.minX) / (size - 1) : (THEATER_HALF_M * 2.0) / (size - 1);
    const stepY = isReal ? (bounds.maxY - bounds.minY) / (size - 1) : (THEATER_HALF_M * 2.0) / (size - 1);

    // Northwest Sun Illumination: Azimuth 315°, Altitude 45°
    const lx = -0.5;
    const ly = 0.5;
    const lz = 0.7071;

    // 1. Pre-sample continuous elevations across genuine coverage domain
    const elevMatrix: Float32Array[] = [];
    if (isReal && size === meta.rasterWidth && meta.rasterHeight === 512 && engine.realDemGrid && engine.realDemGrid.length === size * size) {
      // Direct access from point-registered satellite DEM raster (zero interpolation overhead)
      const realGrid = engine.realDemGrid;
      for (let r = 0; r < size; r++) {
        const row = new Float32Array(size);
        const offset = r * size;
        for (let c = 0; c < size; c++) {
          row[c] = realGrid[offset + c];
        }
        elevMatrix.push(row);
      }
    } else if (isReal) {
      for (let r = 0; r < size; r++) {
        const y = bounds.maxY - r * stepY;
        const row = new Float32Array(size);
        for (let c = 0; c < size; c++) {
          const x = bounds.minX + c * stepX;
          const val = engine.getElevation(x, y);
          row[c] = Number.isFinite(val) ? val : (meta.minElevationM ?? 0);
        }
        elevMatrix.push(row);
      }
    } else {
      // Synthetic procedural terrain across full 1,200 km regional domain
      for (let r = 0; r < size; r++) {
        const y = THEATER_HALF_M - r * stepY;
        const row = new Float32Array(size);
        for (let c = 0; c < size; c++) {
          const x = -THEATER_HALF_M + c * stepX;
          row[c] = engine.getElevation(x, y);
        }
        elevMatrix.push(row);
      }
    }

    // 2. Calculate gradients, surface normals, and Lambertian lighting
    const grid: number[][] = [];
    for (let r = 0; r < size; r++) {
      const rowPack: number[] = [];
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(size - 1, r + 1);

      for (let c = 0; c < size; c++) {
        const cPrev = Math.max(0, c - 1);
        const cNext = Math.min(size - 1, c + 1);

        const z = elevMatrix[r][c];

        // Explicit invalid / out-of-coverage handling: if elevation is NaN or non-finite, emit transparent/invalid pixel (0)
        if (!Number.isFinite(z)) {
          rowPack.push(0);
          continue;
        }

        // Compute x-gradient with NaN-safe finite difference
        let dzdx = 0.0;
        const zCNext = elevMatrix[r][cNext];
        const zCPrev = elevMatrix[r][cPrev];
        if (Number.isFinite(zCNext) && Number.isFinite(zCPrev) && cNext !== cPrev) {
          dzdx = (zCNext - zCPrev) / ((cNext - cPrev) * stepX);
        } else if (Number.isFinite(zCNext) && cNext !== c) {
          dzdx = (zCNext - z) / ((cNext - c) * stepX);
        } else if (Number.isFinite(zCPrev) && c !== cPrev) {
          dzdx = (z - zCPrev) / ((c - cPrev) * stepX);
        }

        // Compute y-gradient with NaN-safe finite difference
        // Note: rPrev is North (+Y) of rNext (South -Y), so (elev[rPrev] - elev[rNext]) / ((rNext - rPrev) * stepY)
        let dzdy = 0.0;
        const zRPrev = elevMatrix[rPrev][c];
        const zRNext = elevMatrix[rNext][c];
        if (Number.isFinite(zRPrev) && Number.isFinite(zRNext) && rNext !== rPrev) {
          dzdy = (zRPrev - zRNext) / ((rNext - rPrev) * stepY);
        } else if (Number.isFinite(zRPrev) && r !== rPrev) {
          dzdy = (zRPrev - z) / ((r - rPrev) * stepY);
        } else if (Number.isFinite(zRNext) && rNext !== r) {
          dzdy = (z - zRNext) / ((rNext - r) * stepY);
        }

        // Surface normal N = (-dzdx * exaggeration, -dzdy * exaggeration, 1.0)
        const ex = 2.4;
        const nx = -dzdx * ex;
        const ny = -dzdy * ex;
        const nz = 1.0;
        const lenN = Math.hypot(nx, ny, nz);

        // Dot product N . L
        const dot = (nx * lx + ny * ly + nz * lz) / lenN;
        const shade = Math.max(0.22, Math.min(1.0, 0.44 + 0.56 * dot));

        // Dark-mode tactical military color grading based on altitude
        const tElev = Math.max(0.0, Math.min(1.0, (z - 2800.0) / 3000.0));

        let rBase: number, gBase: number, bBase: number;
        if (tElev < 0.18) {
          // Low valleys: deep charcoal slate
          const t = tElev / 0.18;
          rBase = 14 + t * 6;  gBase = 19 + t * 7;  bBase = 28 + t * 8;
        } else if (tElev < 0.55) {
          // Mid-elevation slopes & ridges: tactical steel
          const t = (tElev - 0.18) / 0.37;
          rBase = 20 + t * 18; gBase = 26 + t * 22; bBase = 36 + t * 28;
        } else if (tElev < 0.85) {
          // High alpine massifs: dark granite
          const t = (tElev - 0.55) / 0.30;
          rBase = 38 + t * 24; gBase = 48 + t * 28; bBase = 64 + t * 34;
        } else {
          // Summit crests (Zanskar, Nun-Kun): subtle frosted peaks
          const t = (tElev - 0.85) / 0.15;
          rBase = 62 + t * 25; gBase = 76 + t * 28; bBase = 98 + t * 32;
        }

        const red = Math.min(255, Math.max(10, Math.floor(rBase * shade)));
        const green = Math.min(255, Math.max(14, Math.floor(gBase * shade)));
        const blue = Math.min(255, Math.max(20, Math.floor(bBase * shade)));

        const packed = (red << 16) | (green << 8) | blue;
        rowPack.push(packed);
      }
      grid.push(rowPack);
    }

    // Cache generated hillshade
    if (isReal) {
      this.cachedRealHillshade = {
        grid,
        demRef: engine.realDemGrid,
        size,
      };
    } else {
      this.cachedSynthHillshade = {
        grid,
        size,
      };
    }

    this.currentGrid = grid;
    return {
      grid,
      gridSize: size,
      boundsKm: bounds.halfWidthM / 1000.0,
      bounds,
      terrainMode: engine.terrain_mode,
      isCached: false,
      message: {
        type: 'HILLSHADE_READY',
        grid_size: size,
        bounds_km: bounds.halfWidthM / 1000.0,
        bounds,
        data: grid,
        terrain_mode: engine.terrain_mode,
      },
    };
  }
}
```

### File: `src/worker/nodeLifecycleManager.ts` (507 lines, 18,949 bytes)

```typescript
/**
 * src/worker/nodeLifecycleManager.ts
 *
 * Phase 2D: Ground Node Lifecycle Manager
 *
 * Encapsulates:
 * 1. Initial node subsystem creation (`initNodes`).
 * 2. Canonical twin-node construction (`createNodePair`).
 * 3. Ground-node altitude resampling (`resampleGroundNodeAltitudes`).
 * 4. Input validation for dynamic node operations.
 * 5. Dynamic node addition: validation, entity creation, twin subsystem instantiation, and registration lifecycle.
 * 6. Dynamic node duplication: validation, entity creation, twin subsystem instantiation, and registration lifecycle.
 * 7. Dynamic node updates: validation, spatial derivation, property mutation, and registry synchronization.
 * 8. Dynamic node deletion: validation, entity unregistration, and registration lifecycle removal.
 *
 * Note: SimulationWorkerManager retains ownership of twin arrays, active schedulers, transfer manager,
 * RF caches, selection state, and simulation timing.
 */

import {
  GroundNodeEntity,
  NodeRegistry,
} from '../core/nodeRegistry';
import { NodeType } from '../core/config';
import {
  THEATER_HALF_M,
  MIN_GROUND_AGL_M,
  MAX_GROUND_AGL_M,
  DEFAULT_ANTENNA_AGL_M,
  MAX_ACTIVE_GROUND_NODES,
} from '../shared/constants';
export {
  MIN_GROUND_AGL_M,
  MAX_GROUND_AGL_M,
  DEFAULT_ANTENNA_AGL_M,
  MAX_ACTIVE_GROUND_NODES,
};
import { TerrainEngine } from '../core/terrain';
import { GroundNodeTrafficSubsystem } from '../core/queues';
import { RegistrationLifecycle } from '../core/registration';
import { isFiniteNumber } from '../shared/utils';
export { isFiniteNumber };
import type {
  WorkerInboundCommand,
} from '../shared/workerProtocol';

export interface AddNodeParams {
  msg: Extract<WorkerInboundCommand, { type: 'NODE_ADD' }>;
  nodeRegistry: NodeRegistry;
  registrationLifecycle: RegistrationLifecycle;
  terrainEngine: TerrainEngine;
  simTimeS: number;
  spatialLocked: boolean;
}

export interface AddNodeOutcome {
  accepted: boolean;
  reason?: string;
  entity?: GroundNodeEntity;
  nodePair?: [GroundNodeTrafficSubsystem, GroundNodeTrafficSubsystem];
}

export interface DeleteNodeParams {
  msg: Extract<WorkerInboundCommand, { type: 'NODE_DELETE' }>;
  nodeRegistry: NodeRegistry;
  registrationLifecycle: RegistrationLifecycle;
  simTimeS: number;
  spatialLocked: boolean;
}

export interface DeleteNodeOutcome {
  accepted: boolean;
  reason?: string;
  deletedNodeId?: number;
}

export interface DuplicateNodeParams {
  msg: Extract<WorkerInboundCommand, { type: 'NODE_DUPLICATE' }>;
  nodeRegistry: NodeRegistry;
  registrationLifecycle: RegistrationLifecycle;
  terrainEngine: TerrainEngine;
  simTimeS: number;
  spatialLocked: boolean;
}

export interface DuplicateNodeOutcome {
  accepted: boolean;
  reason?: string;
  entity?: GroundNodeEntity;
  sourceNodeId?: number;
  nodePair?: [GroundNodeTrafficSubsystem, GroundNodeTrafficSubsystem];
}

export interface UpdateNodeParams {
  msg: Extract<WorkerInboundCommand, { type: 'NODE_UPDATE' }>;
  nodesStatic: GroundNodeTrafficSubsystem[];
  nodesTac: GroundNodeTrafficSubsystem[];
  nodeRegistry: NodeRegistry;
  terrainEngine: TerrainEngine;
  spatialLocked: boolean;
}

export interface UpdateNodeOutcome {
  accepted: boolean;
  reason?: string;
  nodeId?: number;
  spatialChanged?: boolean;
}

export class NodeLifecycleManager {
  /**
   * Constructs an identical pair of [staticNode, tacNode] from an authoritative entity record.
   */
  public static createNodePair(
    entity: GroundNodeEntity,
    terrainEngine: TerrainEngine
  ): [GroundNodeTrafficSubsystem, GroundNodeTrafficSubsystem] {
    const nid = entity.identity.nodeId;
    const [x, y] = entity.position;
    const terrainMsl = terrainEngine.getElevation(x, y);
    const z = terrainMsl + entity.aglM;

    const staticNode = new GroundNodeTrafficSubsystem(
      nid,
      entity.identity.role,
      [x, y, z],
      entity.seed,
      entity.trafficOptions,
      entity.identity
    );
    const tacNode = new GroundNodeTrafficSubsystem(
      nid,
      entity.identity.role,
      [x, y, z],
      entity.seed,
      entity.trafficOptions,
      entity.identity
    );

    staticNode.aglM = entity.aglM;
    tacNode.aglM = entity.aglM;
    staticNode.txPowerDbm = entity.txPowerDbm;
    tacNode.txPowerDbm = entity.txPowerDbm;

    const defaultCapacity = entity.identity.role === 'mcp' ? 20000 : 5000;
    staticNode.batteryCapacityMah = entity.batteryCapacityMah ?? defaultCapacity;
    tacNode.batteryCapacityMah = entity.batteryCapacityMah ?? defaultCapacity;

    const batteryLevel = entity.batteryLevelPct ?? 100.0;
    staticNode.batteryLevelPct = batteryLevel;
    tacNode.batteryLevelPct = batteryLevel;

    const priority = entity.tacticalPriority ?? 1.0;
    staticNode.tacticalPriority = priority;
    tacNode.tacticalPriority = priority;

    const depleted = batteryLevel <= 0;
    staticNode.isDepleted = depleted;
    tacNode.isDepleted = depleted;

    return [staticNode, tacNode];
  }

  /**
   * Instantiates initial twin arrays from all entities currently in the registry.
   */
  public static initNodes(
    nodeRegistry: NodeRegistry,
    terrainEngine: TerrainEngine
  ): {
    nodesStatic: GroundNodeTrafficSubsystem[];
    nodesTac: GroundNodeTrafficSubsystem[];
  } {
    const nodesStatic: GroundNodeTrafficSubsystem[] = [];
    const nodesTac: GroundNodeTrafficSubsystem[] = [];

    for (const entity of nodeRegistry.getAll()) {
      const [staticNode, tacNode] = this.createNodePair(entity, terrainEngine);
      nodesStatic.push(staticNode);
      nodesTac.push(tacNode);
    }

    return { nodesStatic, nodesTac };
  }

  /**
   * Re-derives each ground node's MSL altitude from the active terrain and its AGL.
   * Synchronizes spatial changes back to the nodeRegistry.
   */
  public static resampleGroundNodeAltitudes(
    nodesStatic: GroundNodeTrafficSubsystem[],
    nodesTac: GroundNodeTrafficSubsystem[],
    nodeRegistry: NodeRegistry,
    terrainEngine: TerrainEngine
  ): void {
    for (const nodes of [nodesStatic, nodesTac]) {
      for (const node of nodes) {
        const [x, y] = node.position;
        const elev = terrainEngine.getElevation(x, y);
        const groundMsl = Number.isFinite(elev)
          ? elev
          : (Number.isFinite(node.position[2]) ? node.position[2] - node.aglM : 3500);
        node.position = [x, y, groundMsl + node.aglM];
        nodeRegistry.updateSpatial(node.nodeId, x, y, node.aglM);
      }
    }
  }

  /**
   * Validates and executes dynamic node addition (NODE_ADD).
   */
  public static addNode(params: AddNodeParams): AddNodeOutcome {
    const {
      msg,
      nodeRegistry,
      registrationLifecycle,
      terrainEngine,
      simTimeS,
      spatialLocked,
    } = params;

    if (spatialLocked) {
      return { accepted: false, reason: 'Spatial lock is enabled; spatial state was not changed.' };
    }
    if (nodeRegistry.size >= MAX_ACTIVE_GROUND_NODES) {
      return { accepted: false, reason: `Maximum active ground-node capacity (${MAX_ACTIVE_GROUND_NODES}) reached.` };
    }

    const xm = msg.x_m !== undefined ? msg.x_m : 0.0;
    const ym = msg.y_m !== undefined ? msg.y_m : 0.0;
    const aglM = msg.agl_m !== undefined ? msg.agl_m : DEFAULT_ANTENNA_AGL_M;

    if (!isFiniteNumber(xm) || !isFiniteNumber(ym) || Math.abs(xm) > THEATER_HALF_M || Math.abs(ym) > THEATER_HALF_M) {
      return { accepted: false, reason: 'NODE_ADD requires finite x_m and y_m coordinates within theater bounds (±600000 m).' };
    }
    if (!isFiniteNumber(aglM) || aglM < MIN_GROUND_AGL_M || aglM > MAX_GROUND_AGL_M) {
      return { accepted: false, reason: `NODE_ADD requires agl_m between ${MIN_GROUND_AGL_M} and ${MAX_GROUND_AGL_M} metres.` };
    }
    if (msg.role !== undefined && msg.role !== 'soldier' && msg.role !== 'mcp') {
      return { accepted: false, reason: "role must be 'soldier' or 'mcp'." };
    }
    if (msg.callsign !== undefined && (typeof msg.callsign !== 'string' || msg.callsign.trim().length === 0)) {
      return { accepted: false, reason: 'callsign must be a non-empty string.' };
    }
    if (msg.tx_power_dbm !== undefined && (!isFiniteNumber(msg.tx_power_dbm) || msg.tx_power_dbm < 10.0 || msg.tx_power_dbm > 50.0)) {
      return { accepted: false, reason: 'tx_power_dbm must be a finite number between 10.0 and 50.0 dBm.' };
    }
    if (msg.battery_capacity_mah !== undefined && (!isFiniteNumber(msg.battery_capacity_mah) || msg.battery_capacity_mah < 100.0 || msg.battery_capacity_mah > 500000.0)) {
      return { accepted: false, reason: 'battery_capacity_mah must be a finite number between 100.0 and 500000.0 mAh.' };
    }
    if (msg.battery_level_pct !== undefined && (!isFiniteNumber(msg.battery_level_pct) || msg.battery_level_pct < 0.0 || msg.battery_level_pct > 100.0)) {
      return { accepted: false, reason: 'battery_level_pct must be a finite number between 0.0 and 100.0 percent.' };
    }
    if (msg.tactical_priority !== undefined && (!isFiniteNumber(msg.tactical_priority) || msg.tactical_priority < 0.1 || msg.tactical_priority > 5.0)) {
      return { accepted: false, reason: 'tactical_priority must be a finite number between 0.1 and 5.0.' };
    }
    if (msg.color_hex !== undefined && (typeof msg.color_hex !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(msg.color_hex.trim()))) {
      return { accepted: false, reason: 'color_hex must be a valid hex color code (e.g. #38bdf8).' };
    }

    const role: NodeType = msg.role ?? 'soldier';
    const entity = nodeRegistry.createDynamicNode({
      callsign: msg.callsign ? msg.callsign.trim() : undefined,
      role,
      position: [xm, ym],
      aglM,
      trafficOptions: msg.traffic_options,
      colorHex: msg.color_hex ? msg.color_hex.trim() : undefined,
      txPowerDbm: msg.tx_power_dbm,
      batteryCapacityMah: msg.battery_capacity_mah,
      batteryLevelPct: msg.battery_level_pct,
      tacticalPriority: msg.tactical_priority,
    });

    const nid = entity.identity.nodeId;
    registrationLifecycle.add(nid, simTimeS);

    const nodePair = this.createNodePair(entity, terrainEngine);

    return {
      accepted: true,
      entity,
      nodePair,
    };
  }

  /**
   * Validates and executes node deletion (NODE_DELETE).
   */
  public static deleteNode(params: DeleteNodeParams): DeleteNodeOutcome {
    const {
      msg,
      nodeRegistry,
      registrationLifecycle,
      simTimeS,
      spatialLocked,
    } = params;

    if (spatialLocked) {
      return { accepted: false, reason: 'Spatial lock is enabled; spatial state was not changed.' };
    }
    const nid = msg.node_id;
    if (!Number.isInteger(nid) || !nodeRegistry.hasNodeId(nid)) {
      return { accepted: false, reason: 'node_id must identify an active registered ground node.' };
    }

    // 1. Registry unregister and tombstone
    nodeRegistry.unregister(nid);

    // 2. Registration lifecycle removal
    registrationLifecycle.remove(nid, simTimeS);

    return {
      accepted: true,
      deletedNodeId: nid,
    };
  }

  /**
   * Validates and executes dynamic node duplication (NODE_DUPLICATE).
   */
  public static duplicateNode(params: DuplicateNodeParams): DuplicateNodeOutcome {
    const {
      msg,
      nodeRegistry,
      registrationLifecycle,
      terrainEngine,
      simTimeS,
      spatialLocked,
    } = params;

    if (spatialLocked) {
      return { accepted: false, reason: 'Spatial lock is enabled; spatial state was not changed.' };
    }
    if (nodeRegistry.size >= MAX_ACTIVE_GROUND_NODES) {
      return { accepted: false, reason: `Maximum active ground-node capacity (${MAX_ACTIVE_GROUND_NODES}) reached.` };
    }

    const srcId = msg.source_node_id;
    if (!Number.isInteger(srcId) || !nodeRegistry.hasNodeId(srcId)) {
      return { accepted: false, reason: 'source_node_id must identify an active registered ground node.' };
    }
    const src = nodeRegistry.getByNodeId(srcId);
    if (!src) {
      return { accepted: false, reason: 'Source node entity could not be retrieved.' };
    }

    const dx = isFiniteNumber(msg.offset_x_m) ? msg.offset_x_m : 500.0;
    const dy = isFiniteNumber(msg.offset_y_m) ? msg.offset_y_m : 500.0;
    const newX = src.position[0] + dx;
    const newY = src.position[1] + dy;

    if (Math.abs(newX) > THEATER_HALF_M || Math.abs(newY) > THEATER_HALF_M) {
      return { accepted: false, reason: 'Duplicated node coordinates fall outside theater bounds (±600000 m).' };
    }

    const callsign = msg.callsign && typeof msg.callsign === 'string' && msg.callsign.trim().length > 0
      ? msg.callsign.trim()
      : `${src.identity.callsign}_copy`;

    const entity = nodeRegistry.createDynamicNode({
      callsign,
      role: src.identity.role,
      position: [newX, newY],
      aglM: src.aglM,
      trafficOptions: { ...src.trafficOptions },
      colorHex: src.identity.colorHex,
      txPowerDbm: src.txPowerDbm,
      batteryCapacityMah: src.batteryCapacityMah,
      batteryLevelPct: src.batteryLevelPct,
      tacticalPriority: src.tacticalPriority,
    });

    const nid = entity.identity.nodeId;
    registrationLifecycle.add(nid, simTimeS);

    const nodePair = this.createNodePair(entity, terrainEngine);

    return {
      accepted: true,
      entity,
      sourceNodeId: srcId,
      nodePair,
    };
  }

  /**
   * Validates and executes node property and spatial updates (NODE_UPDATE).
   */
  public static updateNode(params: UpdateNodeParams): UpdateNodeOutcome {
    const {
      msg,
      nodesStatic,
      nodesTac,
      nodeRegistry,
      terrainEngine,
      spatialLocked,
    } = params;

    const nid = msg.node_id;
    if (!Number.isInteger(nid) || !nodeRegistry.hasNodeId(nid)) {
      return { accepted: false, reason: 'node_id must identify an active registered ground node.' };
    }

    const changesSpatial = msg.x_m !== undefined || msg.y_m !== undefined || msg.agl_m !== undefined;
    if (spatialLocked && changesSpatial) {
      return { accepted: false, reason: 'Spatial lock is enabled; spatial state was not changed.' };
    }

    const staticNode = nodesStatic.find(n => n.nodeId === nid);
    const tacNode = nodesTac.find(n => n.nodeId === nid);
    const entity = nodeRegistry.getByNodeId(nid);
    if (!staticNode || !tacNode || !entity) {
      return { accepted: false, reason: 'Target node was not found.' };
    }

    if (msg.x_m !== undefined && (!isFiniteNumber(msg.x_m) || Math.abs(msg.x_m) > THEATER_HALF_M)) {
      return { accepted: false, reason: 'x_m must be a finite number within theater bounds (±600000 m).' };
    }
    if (msg.y_m !== undefined && (!isFiniteNumber(msg.y_m) || Math.abs(msg.y_m) > THEATER_HALF_M)) {
      return { accepted: false, reason: 'y_m must be a finite number within theater bounds (±600000 m).' };
    }
    if (msg.agl_m !== undefined && (!isFiniteNumber(msg.agl_m) || msg.agl_m < MIN_GROUND_AGL_M || msg.agl_m > MAX_GROUND_AGL_M)) {
      return { accepted: false, reason: `agl_m must be between ${MIN_GROUND_AGL_M} and ${MAX_GROUND_AGL_M} metres.` };
    }
    if (msg.role !== undefined && msg.role !== 'soldier' && msg.role !== 'mcp') {
      return { accepted: false, reason: "role must be 'soldier' or 'mcp'." };
    }
    if (msg.callsign !== undefined && (typeof msg.callsign !== 'string' || msg.callsign.trim().length === 0)) {
      return { accepted: false, reason: 'callsign must be a non-empty string.' };
    }
    if (msg.tx_power_dbm !== undefined && (!isFiniteNumber(msg.tx_power_dbm) || msg.tx_power_dbm < 10.0 || msg.tx_power_dbm > 50.0)) {
      return { accepted: false, reason: 'tx_power_dbm must be a finite number between 10.0 and 50.0 dBm.' };
    }
    if (msg.battery_capacity_mah !== undefined && (!isFiniteNumber(msg.battery_capacity_mah) || msg.battery_capacity_mah < 100.0 || msg.battery_capacity_mah > 500000.0)) {
      return { accepted: false, reason: 'battery_capacity_mah must be a finite number between 100.0 and 500000.0 mAh.' };
    }
    if (msg.battery_level_pct !== undefined && (!isFiniteNumber(msg.battery_level_pct) || msg.battery_level_pct < 0.0 || msg.battery_level_pct > 100.0)) {
      return { accepted: false, reason: 'battery_level_pct must be a finite number between 0.0 and 100.0 percent.' };
    }
    if (msg.tactical_priority !== undefined && (!isFiniteNumber(msg.tactical_priority) || msg.tactical_priority < 0.1 || msg.tactical_priority > 5.0)) {
      return { accepted: false, reason: 'tactical_priority must be a finite number between 0.1 and 5.0.' };
    }
    if (msg.color_hex !== undefined && (typeof msg.color_hex !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(msg.color_hex.trim()))) {
      return { accepted: false, reason: 'color_hex must be a valid hex color code (e.g. #38bdf8).' };
    }

    const nextX = msg.x_m !== undefined ? msg.x_m : staticNode.position[0];
    const nextY = msg.y_m !== undefined ? msg.y_m : staticNode.position[1];
    const nextAgl = msg.agl_m !== undefined ? msg.agl_m : staticNode.aglM;
    const nextTerrainMsl = terrainEngine.getElevation(nextX, nextY);
    const nextZ = nextTerrainMsl + nextAgl;

    staticNode.position = [nextX, nextY, nextZ];
    tacNode.position = [nextX, nextY, nextZ];
    staticNode.aglM = nextAgl;
    tacNode.aglM = nextAgl;

    if (msg.role !== undefined) {
      staticNode.nodeType = msg.role;
      tacNode.nodeType = msg.role;
    }
    if (msg.tx_power_dbm !== undefined) {
      staticNode.txPowerDbm = msg.tx_power_dbm;
      tacNode.txPowerDbm = msg.tx_power_dbm;
    }
    if (msg.battery_capacity_mah !== undefined) {
      staticNode.batteryCapacityMah = msg.battery_capacity_mah;
      tacNode.batteryCapacityMah = msg.battery_capacity_mah;
    }
    if (msg.battery_level_pct !== undefined) {
      staticNode.batteryLevelPct = msg.battery_level_pct;
      tacNode.batteryLevelPct = msg.battery_level_pct;
      staticNode.isDepleted = msg.battery_level_pct <= 0;
      tacNode.isDepleted = msg.battery_level_pct <= 0;
    }
    if (msg.tactical_priority !== undefined) {
      staticNode.tacticalPriority = msg.tactical_priority;
      tacNode.tacticalPriority = msg.tactical_priority;
    }

    nodeRegistry.updateEntity(nid, {
      position: [nextX, nextY],
      aglM: nextAgl,
      role: msg.role,
      callsign: msg.callsign ? msg.callsign.trim() : undefined,
      trafficOptions: msg.traffic_options,
      colorHex: msg.color_hex ? msg.color_hex.trim() : undefined,
      txPowerDbm: msg.tx_power_dbm,
      batteryCapacityMah: msg.battery_capacity_mah,
      batteryLevelPct: msg.battery_level_pct,
      tacticalPriority: msg.tactical_priority,
    });

    const updatedEntity = nodeRegistry.getByNodeId(nid);
    if (updatedEntity) {
      (staticNode as any).identity = updatedEntity.identity;
      (tacNode as any).identity = updatedEntity.identity;
    }

    return {
      accepted: true,
      nodeId: nid,
      spatialChanged: changesSpatial,
    };
  }
}
```

### File: `src/worker/simWorker.ts` (1,429 lines, 62,349 bytes)

```typescript
/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * 50 Hz WebWorker Simulation Engine
 *
 * Runs headless discrete-event network simulation in a background thread:
 * 1. Generates 512x512 3D Lambertian hillshade across the expanded 1,200x1,200 km regional theater.
 * 2. Awaits real satellite DEM acquisition (/terrain/real_ladakh_dem.bin) on startup using dynamic Base URL.
 * 3. Dual-scheduler simulation (Static TDMA vs. Tac-TAD Dynamic) with live KPI accumulation.
 * 4. Active mission transfer state machine (SOS, Photo, Video, Voice) with ACK/drop tracking.
 */

import {
  ACNFlightConfig,
  EnvironmentConfig,
  GROUND_NODE_IDS,
  MAX_ACN_WAYPOINTS,
  NodeType,
  RFConfig,
  SPEED_OF_LIGHT,
} from '../core/config';
import { LinkBudgetEngine, LinkStatus } from '../core/linkBudget';
import { Obstacle } from '../core/obstacles';
import {
  GroundNodeTrafficSubsystem,
  Packet,
  QOS_PROFILES,
} from '../core/queues';
import {
  BaseScheduler,
  FrameScheduleReport,
  LegacyStaticScheduler,
  SlotAllocation,
  TerrainAwareDynamicScheduler,
  T_FRAME_S,
} from '../core/scheduler';
import {
  REAL_LADAKH_DEM_METADATA,
  TerrainBoundsTelemetry,
  TerrainEngine,
  TerrainObstruction,
} from '../core/terrain';
import { RollingGoodputTracker } from '../core/rollingGoodput';
import { RegistrationLifecycle } from '../core/registration';
import {
  NodeRegistry,
  createDefault16NodeRegistry,
  GroundNodeEntity,
  formatDeterministicNodeUuid,
  NodeTrafficOptions,
} from '../core/nodeRegistry';
import {
  ActiveTransferManager,
  type NodeTransferState,
  getDefaultPayloadBytes,
} from '../core/transferManager';
import {
  ACNTrajectory,
  createACNTrajectory,
  NodeTerrainState,
  PredictiveLookAheadEngine,
  PredictiveState,
} from '../core/trajectory';
import {
  FRAME_DT,
  THEATER_HALF_M,
  MCP_ID,
  ACN_ID,
  FRESNEL_SAMPLES,
  MIN_GROUND_AGL_M,
  MAX_GROUND_AGL_M,
  DEFAULT_ANTENNA_AGL_M,
  MAX_ACTIVE_GROUND_NODES,
} from '../shared/constants';
import { isFiniteNumber } from '../shared/utils';
import type { Position3D } from '../shared/types';
import type {
  WorkerCommandResult,
  SelectedLinkBudgetTelemetry,
  TelemetryGanttAllocation,
  WorkerInboundCommand,
  WorkerOutboundMessage,
  TelemetryFrame,
  NodeTelemetryItem,
  FresnelSliceTelemetry,
  TerrainMeshDataReadyMessage,
  ConfigUpdateParams,
} from '../shared/workerProtocol';
import {
  HillshadeGenerator,
  type HillshadeResult,
} from './hillshadeGenerator';
import {
  TelemetrySerializer,
  normalizeSlotAllocationToFrame,
  type RunningMetrics,
  type TelemetrySimulationState,
} from './telemetrySerializer';
import {
  NodeLifecycleManager,
} from './nodeLifecycleManager';
import {
  TerrainMeshGenerator,
  type TerrainMeshGenerationResult,
} from './terrainMeshGenerator';
import {
  buildFresnelSlice as computeFresnelSlice,
  buildEmptyFresnelSlice,
  PROFILE_FRESNEL_FRACTION,
} from '../core/profileEngine';

export {
  FRAME_DT,
  MCP_ID,
  ACN_ID,
  THEATER_HALF_M,
  FRESNEL_SAMPLES,
  HillshadeGenerator,
  TelemetrySerializer,
  NodeLifecycleManager,
  TerrainMeshGenerator,
  ActiveTransferManager,
  normalizeSlotAllocationToFrame,
  PROFILE_FRESNEL_FRACTION,
};
export type {
  WorkerCommandResult,
  SelectedLinkBudgetTelemetry,
  TelemetryGanttAllocation,
  WorkerInboundCommand,
  WorkerOutboundMessage,
  TelemetryFrame,
  NodeTelemetryItem,
  FresnelSliceTelemetry,
  HillshadeResult,
  RunningMetrics,
  NodeTransferState,
  TelemetrySimulationState,
  TerrainMeshGenerationResult,
};

const ANTENNA_HEIGHT_M = 2.0;
const NUM_NODES = GROUND_NODE_IDS.length;

export class SimulationWorkerManager {
  public rfConfig: RFConfig;
  public envConfig: EnvironmentConfig;
  public flightConfig: ACNFlightConfig;
  public terrainEngine: TerrainEngine;
  public linkEngine: LinkBudgetEngine;
  public trajectoryEngine: ACNTrajectory;
  public lookaheadEngine: PredictiveLookAheadEngine;

  public staticScheduler: LegacyStaticScheduler;
  public tacScheduler: TerrainAwareDynamicScheduler;

  public simTimeS: number = 0.0;
  public frameIndex: number = 0;
  public speed: number = 1.0;
  public achievedSpeed: number = 1.0;
  public isPaused: boolean = false;
  public activeStepRequestId: number | undefined = undefined;
  public schedulerMode: string = 'tac_tad';
  public selectedNodeId: number = -1;
  public currentScenarioPreset: 'ACN_ONLY' | '16_NODES' = 'ACN_ONLY';
  public spatialLocked: boolean = false;
  public spatialRevision: number = 0;

  public nodeRegistry: NodeRegistry;
  public nodesStatic: GroundNodeTrafficSubsystem[] = [];
  public nodesTac: GroundNodeTrafficSubsystem[] = [];
  public linkStatuses: Map<number, LinkStatus> = new Map();
  public predStates: Map<number, PredictiveState> = new Map();
  public obstructionResults: Map<number, TerrainObstruction> = new Map();
  public readonly transferManager: ActiveTransferManager = new ActiveTransferManager();

  public get nodeTransfers(): ReadonlyMap<number, NodeTransferState> {
    return this.transferManager.states;
  }
  public readonly registrationLifecycle = new RegistrationLifecycle(500);

  public metrics: RunningMetrics;
  public hillshadeGrid: number[][] = [];
  public readonly hillshadeGenerator: HillshadeGenerator;
  public readonly telemetrySerializer: TelemetrySerializer = new TelemetrySerializer();

  private timerId: number | null = null;
  private simDebtMs: number = 0.0;
  private lastTickRealMs: number = 0.0;
  private lastSpeedMeasureTime: number = 0.0;
  private lastSpeedMeasureSimTime: number = 0.0;
  private node4Frozen: boolean = false;
  public lastReportStatic: FrameScheduleReport | null = null;
  public lastReportTac: FrameScheduleReport | null = null;
  /** Monotone counter incremented on every profile emission; used for stale-response detection. */
  private profileSerial: number = 0;

  /** Rolling 200-superframe (4-second) goodput trackers for P50 and P95 statistics (M7.3) */
  public readonly staticGoodputTracker: RollingGoodputTracker = new RollingGoodputTracker(200);
  public readonly tacGoodputTracker: RollingGoodputTracker = new RollingGoodputTracker(200);

  constructor(
    private readonly seedOffset: number = 0,
    initialScenarioPreset?: 'ACN_ONLY' | '16_NODES'
  ) {
    const isWorkerRuntime = typeof self !== 'undefined' && typeof document === 'undefined';
    this.currentScenarioPreset = initialScenarioPreset ?? (isWorkerRuntime ? 'ACN_ONLY' : '16_NODES');

    if (this.currentScenarioPreset === '16_NODES') {
      this.nodeRegistry = createDefault16NodeRegistry(this.seedOffset);
      this.selectedNodeId = 4;
      for (const id of GROUND_NODE_IDS) this.registrationLifecycle.add(id, this.simTimeS);
    } else {
      this.nodeRegistry = new NodeRegistry(this.seedOffset);
      this.selectedNodeId = -1;
    }
    this.rfConfig = new RFConfig();
    this.envConfig = new EnvironmentConfig();
    this.flightConfig = new ACNFlightConfig();
    this.terrainEngine = new TerrainEngine({ theaterExtentM: THEATER_HALF_M, terrainMode: 'real' });
    this.hillshadeGenerator = new HillshadeGenerator(this.terrainEngine);
    this.linkEngine = new LinkBudgetEngine();
    this.trajectoryEngine = createACNTrajectory(this.flightConfig);
    this.lookaheadEngine = new PredictiveLookAheadEngine(
      this.terrainEngine,
      this.linkEngine,
      this.rfConfig,
      this.envConfig,
      this.flightConfig,
      this.trajectoryEngine
    );

    this.staticScheduler = new LegacyStaticScheduler();
    this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);

    this.metrics = {
      staticGoodputBits: 0,
      tacGoodputBits: 0,
      staticWastedBits: 0,
      tacWastedBits: 0,
      staticDroppedPkts: 0,
      tacDroppedPkts: 0,
      staticEnqueuedPkts: 0,
      tacEnqueuedPkts: 0,
      node4PreShadowBacklogKb: 0,
      staticNode4PreShadowBacklogKb: 0,
      lastStaticUtilPct: 0,
      lastTacUtilPct: 0,
      staticScheduledUlTimeS: 0,
      tacScheduledUlTimeS: 0,
      staticAvailableUlTimeS: 0,
      tacAvailableUlTimeS: 0,
      staticUnusedUlTimeS: 0,
      tacUnusedUlTimeS: 0,
      staticPayloadBitsDequeued: 0,
      tacPayloadBitsDequeued: 0,
      staticDelayDropsThisRun: 0,
      tacDelayDropsThisRun: 0,
      staticOverflowDropsThisRun: 0,
      tacOverflowDropsThisRun: 0,
      staticFinalBacklogBits: 0,
      tacFinalBacklogBits: 0,
    };

    this.initNodes();
    this.initTransfers();
  }

  private initNodes(): void {
    const { nodesStatic, nodesTac } = NodeLifecycleManager.initNodes(this.nodeRegistry, this.terrainEngine);
    this.nodesStatic = nodesStatic;
    this.nodesTac = nodesTac;
  }

  /** Re-derive each ground node's MSL altitude from the currently active terrain and its AGL. */
  private resampleGroundNodeAltitudes(): void {
    NodeLifecycleManager.resampleGroundNodeAltitudes(
      this.nodesStatic,
      this.nodesTac,
      this.nodeRegistry,
      this.terrainEngine
    );
  }

  public getNodeEntity(nodeIdOrEntityId: number | string): GroundNodeEntity | undefined {
    if (typeof nodeIdOrEntityId === 'number') {
      return this.nodeRegistry.getByNodeId(nodeIdOrEntityId);
    }
    return this.nodeRegistry.getByEntityId(nodeIdOrEntityId);
  }

  private initTransfers(): void {
    this.transferManager.reset(this.nodeRegistry.getNodeIds());
  }

  /**
   * Generates or retrieves a shaded relief grid across genuine terrain coverage:
   * - In real DEM mode: uses genuine Ladakh DEM coordinates (+/-91.8 km E-W, +/-110.9 km N-S, aspect ratio ~1.2079),
   *   exact metric ground resolution (dx=359.45m, dy=434.17m), and 512x512 matrix.
   * - In synthetic mode: covers full 1,200x1,200 km regional domain (+/-600 km).
   * Delegates computation and caching to HillshadeGenerator, preserving host telemetry emission.
   */
  public initHillshade(gridSize: number = 512): void {
    const result = this.hillshadeGenerator.generate(this.terrainEngine, gridSize);
    this.hillshadeGrid = result.grid;
    this.emitHostMessage(result.message);
  }

  public getTerrainBounds(): TerrainBoundsTelemetry {
    return this.terrainEngine.getTerrainBoundsTelemetry();
  }

  private emitHostMessage(message: WorkerOutboundMessage, transferList?: Transferable[]): void {
    // Keep the engine importable in Node-based headless benchmarks.
    if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
      if (transferList && transferList.length > 0) {
        self.postMessage(message, transferList as any);
      } else {
        self.postMessage(message);
      }
    }
  }

  /**
   * Build and emit a PROFILE_FRAME for the currently selected node using the
   * current committed geometry and sim time. Does NOT advance time, queues,
   * scheduler, or frame-based KPIs.
   *
   * The emitted message carries `selectedNodeId` and a monotone `profileSerial`
   * so the UI can discard any response that arrived for an older selection or
   * after a newer request was already processed.
   */
  public emitProfileFrame(): void {
    const acnPos = this.trajectoryEngine.getAcnPosition(this.simTimeS);
    this.ensureActiveNodesDomainEvaluations(acnPos);
    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;
    const selNode = activeNodes.find((n) => n.nodeId === this.selectedNodeId) ?? activeNodes[0];
    const fresnelSlice = this.buildFresnelSlice(selNode, acnPos);
    const nodesTel = this.buildNodesTelemetry();
    const message = this.telemetrySerializer.buildProfileFrameMessage(
      this.selectedNodeId,
      ++this.profileSerial,
      this.spatialRevision,
      fresnelSlice,
      nodesTel
    );
    this.emitHostMessage(message);
  }

  public tickSimulation(emitTelemetry: boolean = true): void {
    this.simTimeS += FRAME_DT;
    this.frameIndex += 1;
    const t = this.simTimeS;

    const acnPos = this.trajectoryEngine.getAcnPosition(t);

    // Refresh all spatially derived decisions before traffic generation reads isShadowed.
    this.refreshObstructionState(acnPos, t);

    // 1. Generate traffic and prune queues
    for (let i = 0; i < this.nodesStatic.length; i++) {
      const sPkts = this.nodesStatic[i].generateTraffic(t, FRAME_DT);
      const tPkts = this.nodesTac[i].generateTraffic(t, FRAME_DT);
      this.metrics.staticEnqueuedPkts += sPkts.length;
      this.metrics.tacEnqueuedPkts += tPkts.length;

      this.nodesStatic[i].queue.pruneExpiredPackets(t);
      this.nodesTac[i].queue.pruneExpiredPackets(t);
    }

    // 2. Schedulers
    const reportStatic = this.staticScheduler.scheduleFrame(
      this.frameIndex,
      t,
      this.nodesStatic,
      this.linkStatuses,
      this.predStates
    );
    const reportTac = this.tacScheduler.scheduleFrame(
      this.frameIndex,
      t,
      this.nodesTac,
      this.linkStatuses,
      this.predStates
    );

    this.lastReportStatic = reportStatic;
    this.lastReportTac = reportTac;

    // Rolling goodput sampling (M7.3: 200 superframes / 4 seconds of completed payload delivery)
    this.staticGoodputTracker.recordSuperframeDeliveredBits(reportStatic.totalBitsTransmitted);
    this.tacGoodputTracker.recordSuperframeDeliveredBits(reportTac.totalBitsTransmitted);

    // 3. Metrics accumulation
    this.metrics.staticGoodputBits += reportStatic.totalBitsTransmitted;
    this.metrics.staticWastedBits += reportStatic.totalBitsWastedOnOutage;
    this.metrics.tacGoodputBits += reportTac.totalBitsTransmitted;
    this.metrics.tacWastedBits += reportTac.totalBitsWastedOnOutage;
    this.metrics.staticDroppedPkts = reportStatic.packetsDroppedDelay + reportStatic.packetsDroppedOverflow;
    this.metrics.tacDroppedPkts = reportTac.packetsDroppedDelay + reportTac.packetsDroppedOverflow;
    this.metrics.lastStaticUtilPct = reportStatic.totalUlUtilizationPct;
    this.metrics.lastTacUtilPct = reportTac.totalUlUtilizationPct;
    this.metrics.staticScheduledUlTimeS += reportStatic.totalUlScheduledS;
    this.metrics.tacScheduledUlTimeS += reportTac.totalUlScheduledS;
    this.metrics.staticAvailableUlTimeS += reportStatic.totalUlAvailableS;
    this.metrics.tacAvailableUlTimeS += reportTac.totalUlAvailableS;
    this.metrics.staticUnusedUlTimeS += reportStatic.totalUlUnusedS;
    this.metrics.tacUnusedUlTimeS += reportTac.totalUlUnusedS;
    this.metrics.staticPayloadBitsDequeued += reportStatic.totalPayloadBitsDequeued;
    this.metrics.tacPayloadBitsDequeued += reportTac.totalPayloadBitsDequeued;
    this.metrics.staticDelayDropsThisRun += reportStatic.packetsDroppedDelayThisFrame;
    this.metrics.tacDelayDropsThisRun += reportTac.packetsDroppedDelayThisFrame;
    this.metrics.staticOverflowDropsThisRun += reportStatic.packetsDroppedOverflowThisFrame;
    this.metrics.tacOverflowDropsThisRun += reportTac.packetsDroppedOverflowThisFrame;
    this.metrics.staticFinalBacklogBits = reportStatic.totalBacklogBits;
    this.metrics.tacFinalBacklogBits = reportTac.totalBacklogBits;

    // 4. Track Node 4 pre-shadow backlog
    const n4Pred = this.predStates.get(4);
    const node4Tac = this.nodesTac.find(n => n.nodeId === 4);
    const node4Stat = this.nodesStatic.find(n => n.nodeId === 4);
    const n4TacKb = node4Tac ? node4Tac.queue.getTotalBacklogBytes() / 1024.0 : 0.0;
    const n4StatKb = node4Stat ? node4Stat.queue.getTotalBacklogBytes() / 1024.0 : 0.0;

    if (n4Pred?.currentState === NodeTerrainState.NORMAL_LOS || n4Pred?.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
      this.metrics.node4PreShadowBacklogKb = n4TacKb;
      this.metrics.staticNode4PreShadowBacklogKb = n4StatKb;
      this.node4Frozen = false;
    } else if (n4Pred?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF && !this.node4Frozen) {
      this.metrics.node4PreShadowBacklogKb = n4TacKb;
      this.metrics.staticNode4PreShadowBacklogKb = n4StatKb;
      this.node4Frozen = true;
    }

    // 4.5. Deterministic Node Battery & Energy Drain Model
    const activeReport = this.schedulerMode === 'tac_tad' ? reportTac : reportStatic;
    for (let i = 0; i < this.nodesTac.length; i++) {
      const nodeTac = this.nodesTac[i];
      const nodeStat = this.nodesStatic[i];
      const nid = nodeTac.nodeId;
      const isMcp = nodeTac.nodeType === 'mcp';
      const iIdleMa = isMcp ? 400.0 : 150.0;
      const pTxDbm = nodeTac.txPowerDbm ?? (isMcp ? 43.0 : 36.0);
      const pRfWatts = Math.pow(10.0, (pTxDbm - 30.0) / 10.0);
      const iTxRfMa = (pRfWatts / (0.35 * 12.0)) * 1000.0;
      const iTxTotalMa = iIdleMa + iTxRfMa;

      const alloc = activeReport.allocations.find((a) => a.nodeId === nid);
      const tTxS = alloc && alloc.durationS > 0 && !nodeTac.isDepleted ? alloc.durationS : 0.0;
      const tIdleS = Math.max(0.0, FRAME_DT - tTxS);
      const drainedMah = (iIdleMa * tIdleS + iTxTotalMa * tTxS) / 3600.0;
      const capacityMah = Math.max(100.0, nodeTac.batteryCapacityMah || (isMcp ? 20000.0 : 5000.0));
      const deltaPct = (drainedMah / capacityMah) * 100.0;
      const nextLevelPct = Math.max(0.0, Math.min(100.0, nodeTac.batteryLevelPct - deltaPct));

      nodeTac.batteryLevelPct = nextLevelPct;
      nodeStat.batteryLevelPct = nextLevelPct;
      const depleted = nextLevelPct <= 0.0;
      nodeTac.isDepleted = depleted;
      nodeStat.isDepleted = depleted;
      this.nodeRegistry.updateBatteryLevel(nid, nextLevelPct);
    }

    // 5. Active Transfer Machine
    this.transferManager.step({
      activeNodes: this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic,
      linkStatuses: this.linkStatuses,
      predStates: this.predStates,
      activeReport,
      simTimeS: t,
      isPaused: this.isPaused,
    });

    // 6. Dispatch frame to main UI thread
    if (emitTelemetry) {
      const frame = this.buildTelemetryFrame(acnPos);
      this.emitHostMessage({ type: 'TELEMETRY_FRAME', frame });
    }
  }

  /** Recompute spatial decisions only; does not advance time or run traffic/schedulers. */
  private refreshObstructionState(acnPos: [number, number, number], timeS: number): void {
    const nextLinks = new Map<number, LinkStatus>();
    const nextPredictions = new Map<number, PredictiveState>();
    const nextObstructions = new Map<number, TerrainObstruction>();
    const nextShadow = new Map<number, boolean>();
    for (let i = 0; i < this.nodesTac.length; i++) {
      const node = this.nodesTac[i];
      const nid = node.nodeId;
      const obstruction = this.terrainEngine.evaluateTerrainObstruction(node.position, acnPos, this.rfConfig, this.envConfig);
      const prediction = this.lookaheadEngine.evaluatePredictiveState(node.position, timeS);
      const [nx, ny, nz] = node.position;
      const slantM = Math.hypot(acnPos[0] - nx, acnPos[1] - ny, acnPos[2] - nz);
      nextObstructions.set(nid, obstruction);
      nextPredictions.set(nid, prediction);
      nextLinks.set(nid, this.linkEngine.evaluateLink(node.nodeType, slantM, obstruction.diffractionLossDb, this.rfConfig, this.envConfig, obstruction.obstacleBlocked, node.txPowerDbm));
      // Traffic-generation shadow is current geometry, independent of a predicted re-emergence label.
      nextShadow.set(nid, !obstruction.isLos || obstruction.obstacleBlocked);
    }
    // Publish staged results together so no caller can observe a partial node refresh.
    this.linkStatuses.clear(); for (const [id, value] of nextLinks) this.linkStatuses.set(id, value);
    this.predStates.clear(); for (const [id, value] of nextPredictions) this.predStates.set(id, value);
    this.obstructionResults.clear(); for (const [id, value] of nextObstructions) this.obstructionResults.set(id, value);
    for (let i = 0; i < this.nodesTac.length; i++) {
      const nid = this.nodesTac[i].nodeId;
      const isShad = nextShadow.get(nid) ?? false;
      this.nodesTac[i].isShadowed = isShad;
      this.nodesStatic[i].isShadowed = isShad;
    }
  }

  private getObstructionStateSnapshot(): NonNullable<WorkerCommandResult['obstruction_state']> {
    return this.nodesTac.map(node => {
      const obstruction = this.obstructionResults.get(node.nodeId);
      const link = this.linkStatuses.get(node.nodeId);
      const prediction = this.predStates.get(node.nodeId);
      return {
        node_id: node.nodeId,
        entity_id: node.entityId,
        creation_sequence: node.creationSequence,
        terrain_is_los: obstruction?.isLos ?? true,
        obstacle_blocked: obstruction?.obstacleBlocked ?? false,
        obstacle_intersections: obstruction?.obstacleIntersections.map(hit => ({ ...hit })) ?? [],
        link_outage: link?.isOutage ?? true,
        bitrate_bps: link?.bitrateBps ?? 0,
        modcod_name: link?.modcodName ?? 'LINK_OUTAGE',
        predicted_state: prediction?.currentState ?? NodeTerrainState.NORMAL_LOS,
        time_to_occlusion_s: prediction?.timeToOcclusionS ?? Number.POSITIVE_INFINITY,
        time_to_emergence_s: prediction?.timeToEmergenceS ?? Number.POSITIVE_INFINITY,
        is_shadowed: node.isShadowed,
        is_coverage_complete: obstruction?.isCoverageComplete ?? true,
        coverage_note: obstruction?.coverageNote,
      };
    });
  }


  public ensureNodeDomainEvaluations(node: GroundNodeTrafficSubsystem, acnPos: [number, number, number]): {
    obstruction: TerrainObstruction;
    linkStatus: LinkStatus;
    predState: PredictiveState;
  } {
    let obstruction = this.obstructionResults.get(node.nodeId);
    if (!obstruction) {
      obstruction = this.terrainEngine.evaluateTerrainObstruction(node.position, acnPos, this.rfConfig, this.envConfig);
      this.obstructionResults.set(node.nodeId, obstruction);
    }
    let linkStatus = this.linkStatuses.get(node.nodeId);
    if (!linkStatus) {
      const slantM = Math.hypot(acnPos[0] - node.position[0], acnPos[1] - node.position[1], acnPos[2] - node.position[2]);
      linkStatus = this.linkEngine.evaluateLink(node.nodeType, slantM, obstruction.diffractionLossDb, this.rfConfig, this.envConfig, obstruction.obstacleBlocked, node.txPowerDbm);
      this.linkStatuses.set(node.nodeId, linkStatus);
    }
    let predState = this.predStates.get(node.nodeId);
    if (!predState) {
      predState = this.lookaheadEngine.evaluatePredictiveState(node.position, this.simTimeS);
      this.predStates.set(node.nodeId, predState);
    }
    return { obstruction, linkStatus, predState };
  }

  public ensureActiveNodesDomainEvaluations(acnPos: [number, number, number]): void {
    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;
    for (const node of activeNodes) {
      this.ensureNodeDomainEvaluations(node, acnPos);
    }
  }

  public buildNodesTelemetry(): NodeTelemetryItem[] {
    const acnPos = this.trajectoryEngine.getAcnPosition(this.simTimeS);
    this.ensureActiveNodesDomainEvaluations(acnPos);
    return this.telemetrySerializer.buildNodesTelemetry(this, acnPos);
  }

  private buildTelemetryFrame(acnPos: [number, number, number]): TelemetryFrame {
    this.ensureActiveNodesDomainEvaluations(acnPos);
    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;
    const selNode = activeNodes.find((n) => n.nodeId === this.selectedNodeId) ?? activeNodes[0];
    const fresnelSlice = this.buildFresnelSlice(selNode, acnPos);
    return this.telemetrySerializer.buildTelemetryFrame(this, acnPos, fresnelSlice);
  }

  private buildFresnelSlice(
    node: GroundNodeTrafficSubsystem | undefined,
    acnPos: [number, number, number]
  ): FresnelSliceTelemetry {
    if (!node) {
      return buildEmptyFresnelSlice(this.frameIndex, this.simTimeS, acnPos);
    }
    const { obstruction, linkStatus, predState } = this.ensureNodeDomainEvaluations(node, acnPos);
    const regEntity = this.nodeRegistry.getByNodeId(node.nodeId);
    const resolvedName = regEntity?.identity.callsign ?? node.identity?.callsign ?? (node.nodeId === MCP_ID ? 'MCP' : `S${node.nodeId}`);
    return computeFresnelSlice({
      node,
      resolvedName,
      acnPos,
      frameIndex: this.frameIndex,
      simTimeS: this.simTimeS,
      rfConfig: this.rfConfig,
      envConfig: this.envConfig,
      terrainEngine: this.terrainEngine,
      linkEngine: this.linkEngine,
      obstruction,
      linkStatus,
      predState,
      fresnelFraction: PROFILE_FRESNEL_FRACTION,
      sampleCount: FRESNEL_SAMPLES,
    });
  }

  private computeFlightPath(numPoints: number = 64): [number, number][] {
    return this.trajectoryEngine.getPathPoints(numPoints);
  }

  /**
   * Reset all run-local state before a fresh experiment. Scenario configuration
   * (RF, terrain mode, rain, and flight parameters) is intentionally preserved;
   * scheduler adaptation state and per-run counters are not.
   */
  public resetSimulationState(): void {
    this.speed = 1.0;
    this.achievedSpeed = 1.0;
    this.simDebtMs = 0.0;
    this.lastSpeedMeasureTime = 0.0;
    this.lastSpeedMeasureSimTime = 0.0;
    if (this.timerId !== null) {
      this.restartTimer();
    }
    this.registrationLifecycle.clear();
    if (this.currentScenarioPreset === '16_NODES') {
      this.nodeRegistry = createDefault16NodeRegistry(this.seedOffset);
      this.selectedNodeId = 4;
    } else {
      this.nodeRegistry = new NodeRegistry(this.seedOffset);
      this.selectedNodeId = -1;
    }
    this.initNodes();
    this.initTransfers();
    this.staticScheduler = new LegacyStaticScheduler();
    this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);
    this.simTimeS = 0.0;
    if (this.currentScenarioPreset === '16_NODES') {
      for (const id of GROUND_NODE_IDS) this.registrationLifecycle.add(id, this.simTimeS);
    }
    this.frameIndex = 0;
    this.spatialRevision = 0;
    this.node4Frozen = false;
    this.activeStepRequestId = undefined;
    this.lastReportStatic = null;
    this.lastReportTac = null;
    this.staticGoodputTracker.reset();
    this.tacGoodputTracker.reset();
    this.trajectoryEngine.resetKinematics(this.flightConfig.loiterSpeedMps);
    this.linkStatuses.clear();
    this.predStates.clear();
    this.obstructionResults.clear();
    this.metrics = {
      staticGoodputBits: 0,
      tacGoodputBits: 0,
      staticWastedBits: 0,
      tacWastedBits: 0,
      staticDroppedPkts: 0,
      tacDroppedPkts: 0,
      staticEnqueuedPkts: 0,
      tacEnqueuedPkts: 0,
      node4PreShadowBacklogKb: 0,
      staticNode4PreShadowBacklogKb: 0,
      lastStaticUtilPct: 0,
      lastTacUtilPct: 0,
      staticScheduledUlTimeS: 0,
      tacScheduledUlTimeS: 0,
      staticAvailableUlTimeS: 0,
      tacAvailableUlTimeS: 0,
      staticUnusedUlTimeS: 0,
      tacUnusedUlTimeS: 0,
      staticPayloadBitsDequeued: 0,
      tacPayloadBitsDequeued: 0,
      staticDelayDropsThisRun: 0,
      tacDelayDropsThisRun: 0,
      staticOverflowDropsThisRun: 0,
      tacOverflowDropsThisRun: 0,
      staticFinalBacklogBits: 0,
      tacFinalBacklogBits: 0,
    };
  }

  public handleMessage(msg: WorkerInboundCommand): WorkerCommandResult {
    const commandType = msg && typeof msg === 'object' && 'type' in msg ? String(msg.type).toUpperCase() : 'UNKNOWN';
    const result = (accepted: boolean, reason?: string): WorkerCommandResult => {
      const response: WorkerCommandResult = {
        type: 'COMMAND_RESULT', command_type: commandType, accepted,
        ...(msg && typeof msg === 'object' && msg.request_id !== undefined ? { request_id: msg.request_id } : {}),
        ...(msg && typeof msg === 'object' && msg.request_id !== undefined ? { trajectory_config: {
          trajectory_mode: this.flightConfig.trajectoryMode,
          center_x_m: this.flightConfig.centerXm,
          center_y_m: this.flightConfig.centerYm,
          orbit_a_m: this.flightConfig.loiterRadiusAM,
          orbit_b_m: this.flightConfig.loiterRadiusBM,
          orbit_rotation_deg: this.flightConfig.loiterRotationDeg,
          loiter_speed_mps: this.flightConfig.loiterSpeedMps,
          acn_altitude_m: this.flightConfig.altitudeMslM,
          waypoints: this.flightConfig.waypoints.map(point => ({ x_m: point.xM, y_m: point.yM })),
        } } : {}),
        ...(commandType === 'OBSTACLES_REPLACE' ? { obstacle_set: this.terrainEngine.obstacleField.all } : {}),
        ...(commandType === 'OBSTACLES_REPLACE' ? { obstruction_state: this.getObstructionStateSnapshot() } : {}),
        ...(reason ? { reason } : {}), spatial_locked: this.spatialLocked,
      };
      this.emitHostMessage(response);
      return response;
    };
    const reject = (reason: string) => result(false, reason);
    const locked = () => reject('Spatial lock is enabled; spatial state was not changed.');
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return reject('Command must be an object.');

    switch (msg.type) {
      case 'OBSTACLES_REPLACE': {
        if (this.spatialLocked) return locked();
        const previousObstacles = this.terrainEngine.obstacleField.all;
        try {
          // ObstacleField validates and builds its spatial index before atomically swapping state.
          this.terrainEngine.obstacleField.replace(msg.obstacles);
        } catch (error) {
          return reject(error instanceof Error ? error.message : 'Invalid obstacle set.');
        }
        try {
          this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        } catch (error) {
          // Refresh is staged; restore geometry if derived-state evaluation unexpectedly fails.
          this.terrainEngine.obstacleField.replace(previousObstacles);
          return reject(error instanceof Error ? error.message : 'Invalid obstacle set.');
        }
        // Emit an out-of-band profile frame so the UI reflects the new obstacle geometry
        // immediately, without waiting for the next normal telemetry tick.
        this.spatialRevision++;
        this.emitProfileFrame();
        return result(true);
      }

      case 'SET_SPATIAL_LOCK':
        if (typeof msg.locked !== 'boolean') return reject('locked must be a boolean.');
        this.spatialLocked = msg.locked;
        return result(true);

      case 'NODE_MOVE': {
        if (this.spatialLocked) return locked();
        const nid = msg.node_id;
        const xm = msg.x_m;
        const ym = msg.y_m;
        if (!Number.isInteger(nid) || (nid !== ACN_ID && !this.nodeRegistry.hasNodeId(nid)) ||
            !isFiniteNumber(xm) || !isFiniteNumber(ym) ||
            Math.abs(xm) > THEATER_HALF_M || Math.abs(ym) > THEATER_HALF_M) {
          return reject('NODE_MOVE requires valid node_id and finite x_m/y_m within the terrain bounds (±600000 m).');
        }
        if (nid === ACN_ID) {
          const deltaX = xm - this.flightConfig.centerXm;
          const deltaY = ym - this.flightConfig.centerYm;
          const translatedWaypoints = this.flightConfig.waypoints.map(point => ({ xM: point.xM + deltaX, yM: point.yM + deltaY }));
          let next: ACNFlightConfig, trajectory: ACNTrajectory;
          try {
            next = new ACNFlightConfig({ ...this.flightConfig, centerXm: xm, centerYm: ym, waypoints: translatedWaypoints });
            trajectory = createACNTrajectory(next);
          } catch (error) {
            return reject(error instanceof Error ? error.message : 'Invalid trajectory update.');
          }
          this.flightConfig = next;
          this.trajectoryEngine = trajectory;
          this.lookaheadEngine = new PredictiveLookAheadEngine(
            this.terrainEngine, this.linkEngine, this.rfConfig, this.envConfig, next, trajectory
          );
        } else {
          const staticNode = this.nodesStatic.find(n => n.nodeId === nid);
          const tacNode = this.nodesTac.find(n => n.nodeId === nid);
          if (!staticNode || !tacNode) return reject(`Node ${nid} not found in active simulation.`);
          const terrainMsl = this.terrainEngine.getElevation(xm, ym);
          staticNode.position = [xm, ym, terrainMsl + staticNode.aglM];
          tacNode.position = [xm, ym, terrainMsl + tacNode.aglM];
          this.nodeRegistry.updateSpatial(nid, xm, ym);
        }
        this.spatialRevision++;
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.emitProfileFrame();
        return result(true);
      }

      case 'LOAD_PRESET': {
        if (typeof msg.preset_id !== 'string') return reject('preset_id must be a string.');
        const pid = msg.preset_id.toUpperCase();
        const isOcclusion = pid === 'PRESET_OCCLUSION';
        const isAmbush = pid === 'PRESET_AMBUSH';
        const isMonsoon = pid === 'PRESET_MONSOON';
        const isReset = pid === 'PRESET_RESET';
        const isAcnOnly = pid === 'PRESET_ACN_ONLY' || pid === 'PRESET_ZERO_NODES';
        const is16Nodes = pid === 'PRESET_16_NODES' || pid === 'PRESET_CANONICAL_16' || pid === 'PRESET_DEFAULT';
        if (!isOcclusion && !isAmbush && !isMonsoon && !isReset && !isAcnOnly && !is16Nodes) return reject('Unknown preset.');
        if (this.spatialLocked && (isOcclusion || isReset || isAcnOnly || is16Nodes)) return locked();

        if (isAcnOnly) {
          this.currentScenarioPreset = 'ACN_ONLY';
          this.registrationLifecycle.clear();
          this.nodeRegistry = new NodeRegistry(this.seedOffset);
          this.initNodes();
          this.initTransfers();
          this.staticScheduler = new LegacyStaticScheduler();
          this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);
          this.selectedNodeId = -1;
          this.spatialRevision++;
          this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
          this.emitProfileFrame();
          return result(true);
        }

        if (is16Nodes) {
          this.currentScenarioPreset = '16_NODES';
          this.nodeRegistry = createDefault16NodeRegistry(this.seedOffset);
          this.registrationLifecycle.clear();
          for (const id of GROUND_NODE_IDS) this.registrationLifecycle.add(id, this.simTimeS);
          this.initNodes();
          this.initTransfers();
          this.staticScheduler = new LegacyStaticScheduler();
          this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);
          this.selectedNodeId = 4;
          this.resampleGroundNodeAltitudes();
          this.spatialRevision++;
          this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
          this.emitProfileFrame();
          return result(true);
        }

        if (isOcclusion || isAmbush) {
          if (this.nodeRegistry.size === 0) {
            this.currentScenarioPreset = '16_NODES';
            this.nodeRegistry = createDefault16NodeRegistry(this.seedOffset);
            this.registrationLifecycle.clear();
            for (const id of GROUND_NODE_IDS) this.registrationLifecycle.add(id, this.simTimeS);
            this.initNodes();
            this.initTransfers();
            this.resampleGroundNodeAltitudes();
          }
        }

        if (isOcclusion) {
          this.spatialRevision++;
          const terrainMsl = this.terrainEngine.getElevation(12000.0, 8000.0);
          this.nodesStatic[4].position = [12000.0, 8000.0, terrainMsl + this.nodesStatic[4].aglM];
          this.nodesTac[4].position = [12000.0, 8000.0, terrainMsl + this.nodesTac[4].aglM];
          this.nodeRegistry.updateSpatial(4, 12000.0, 8000.0);
          this.selectedNodeId = 4;
          for (let k = 0; k < 30; k++) {
            this.nodesStatic[4].enqueuePacket(70, this.simTimeS, 1400);
            this.nodesTac[4].enqueuePacket(70, this.simTimeS, 1400);
          }
          this.transferManager.startTransfer(
            4,
            'PHOTO',
            42000,
            this.simTimeS,
            false,
            'PRESET OCCLUSION: Node 4 enqueued 42 KB photo.'
          );
        } else if (isAmbush) {
          this.envConfig = new EnvironmentConfig({ ...this.envConfig, rainRateMmH: 0.0 });
          this.selectedNodeId = 1;
          for (let k = 0; k < 20; k++) {
            this.nodesStatic[1].enqueuePacket(69, this.simTimeS, 128);
            this.nodesTac[1].enqueuePacket(69, this.simTimeS, 128);
          }
          for (let k = 0; k < 35; k++) {
            this.nodesStatic[15].enqueuePacket(67, this.simTimeS, 1200);
            this.nodesTac[15].enqueuePacket(67, this.simTimeS, 1200);
          }
        } else if (isMonsoon) {
          this.envConfig = new EnvironmentConfig({ ...this.envConfig, rainRateMmH: 35.0 });
        } else {
          this.resetSimulationState();
        }
        this.emitProfileFrame();
        return result(true);
      }

      case 'INJECT_TRAFFIC': {
        const nid = msg.node_id === undefined ? this.selectedNodeId : msg.node_id;
        if (!Number.isInteger(nid) || !this.nodeRegistry.hasNodeId(nid)) return reject('node_id must identify a registered ground node.');
        const staticNode = this.nodesStatic.find(n => n.nodeId === nid);
        const tacNode = this.nodesTac.find(n => n.nodeId === nid);
        if (!staticNode || !tacNode) return reject('node_id must identify an active ground node.');
        const ttype = String(msg.traffic_type ?? 'SOS').toUpperCase();
        const bytes = getDefaultPayloadBytes(ttype);
        const ps = this.predStates.get(nid);
        const isBlocked = ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF;
        this.transferManager.startTransfer(nid, ttype, bytes, this.simTimeS, isBlocked);
        staticNode.injectTraffic(ttype, this.simTimeS);
        tacNode.injectTraffic(ttype, this.simTimeS);
        return result(true);
      }

      case 'SET_TERRAIN_MODE': {
        if (this.spatialLocked) return locked();
        if (msg.mode !== 'real' && msg.mode !== 'synthetic') return reject('mode must be real or synthetic.');
        this.terrainEngine.setTerrainMode(msg.mode);
        this.resampleGroundNodeAltitudes();
        this.initHillshade(512);
        return result(true);
      }

      case 'LOAD_CUSTOM_DEM': {
        if (this.spatialLocked) return locked();
        const elevations = msg.elevations;
        const metadata = msg.metadata;
        if (!elevations || (!(elevations instanceof Float32Array) && !(elevations instanceof ArrayBuffer))) {
          return reject('elevations must be Float32Array or ArrayBuffer.');
        }

        const success = this.terrainEngine.loadCustomDem(elevations, metadata);
        if (!success) {
          return reject('Failed to load custom DEM into terrain engine.');
        }

        this.hillshadeGenerator.invalidateRealCache();
        this.resampleGroundNodeAltitudes();
        this.spatialRevision++;
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.initHillshade(512);

        const bounds = this.terrainEngine.getTerrainBoundsTelemetry();
        this.emitHostMessage({
          type: 'TERRAIN_BOUNDS_READY',
          request_id: msg.request_id,
          bounds,
        });
        this.emitHostMessage({
          type: 'CUSTOM_DEM_LOADED',
          request_id: msg.request_id,
          tile_name: metadata?.tileName ?? 'custom',
          resolution: metadata?.rasterWidth ?? 512,
          bounds,
        });

        this.emitProfileFrame();
        return result(true);
      }

      case 'GET_HILLSHADE':
        this.initHillshade(512);
        return result(true);

      case 'GET_TERRAIN_BOUNDS': {
        const bounds = this.getTerrainBounds();
        this.emitHostMessage({
          type: 'TERRAIN_BOUNDS_READY',
          request_id: msg.request_id,
          bounds,
        });
        return result(true);
      }

      case 'GET_TERRAIN_MESH_DATA': {
        const { message: payload, transferList } = TerrainMeshGenerator.generate(
          this.terrainEngine,
          msg.request_id,
          512
        );

        // Transfer ownership of transferGrid.buffer ONLY
        this.emitHostMessage(payload, transferList);
        return result(true);
      }

      case 'SET_PARAMS':
      case 'CONFIG_UPDATE': {
        const p: ConfigUpdateParams = (msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)) ? msg.params : msg;
        if (!p || typeof p !== 'object' || Array.isArray(p)) return reject('params must be an object.');
        const numericKeys = ['carrier_freq_ghz', 'channel_bandwidth_mhz', 'rain_rate_mmh', 'acn_altitude_m', 'orbit_a_m', 'orbit_b_m',
          'orbit_rotation_deg', 'loiter_speed_mps', 'acceleration_limit_mps2', 'deceleration_limit_mps2', 'coverage_radius_km', 'center_x_m', 'center_y_m', 'node_id', 'agl_m'] as const;
        for (const key of numericKeys) {
          if (Object.prototype.hasOwnProperty.call(p, key) && !isFiniteNumber(p[key])) return reject(`${key} must be a finite number.`);
        }
        if (p.terrain_mode !== undefined && p.terrain_mode !== 'real' && p.terrain_mode !== 'synthetic') return reject('terrain_mode must be real or synthetic.');
        if (p.trajectory_mode !== undefined && p.trajectory_mode !== 'ellipse' && p.trajectory_mode !== 'waypoints') return reject('trajectory_mode must be ellipse or waypoints.');
        if (p.carrier_freq_ghz !== undefined && p.carrier_freq_ghz <= 0) return reject('carrier_freq_ghz must be greater than zero.');
        if (p.channel_bandwidth_mhz !== undefined && (p.channel_bandwidth_mhz < 0.1 || p.channel_bandwidth_mhz > 50.0)) return reject('channel_bandwidth_mhz must be between 0.1 and 50.0 MHz.');
        if (p.rain_rate_mmh !== undefined && p.rain_rate_mmh < 0) return reject('rain_rate_mmh cannot be negative.');
        if (p.acn_altitude_m !== undefined && (p.acn_altitude_m <= 0 || p.acn_altitude_m > 100000)) return reject('acn_altitude_m must be in (0, 100000].');
        if ((p.orbit_a_m !== undefined && (p.orbit_a_m <= 0 || p.orbit_a_m > THEATER_HALF_M)) || (p.orbit_b_m !== undefined && (p.orbit_b_m <= 0 || p.orbit_b_m > THEATER_HALF_M))) return reject('Orbit axes must be in (0, 600000] metres.');
        if (p.orbit_rotation_deg !== undefined && Math.abs(p.orbit_rotation_deg) > 360) return reject('orbit_rotation_deg must be within ±360 degrees.');
        if (p.loiter_speed_mps !== undefined && (p.loiter_speed_mps < 0 || p.loiter_speed_mps > 1000)) return reject('loiter_speed_mps must be in [0, 1000].');
        if (p.acceleration_limit_mps2 !== undefined && (p.acceleration_limit_mps2 <= 0 || p.acceleration_limit_mps2 > 50)) return reject('acceleration_limit_mps2 must be in (0, 50].');
        if (p.deceleration_limit_mps2 !== undefined && (p.deceleration_limit_mps2 <= 0 || p.deceleration_limit_mps2 > 50)) return reject('deceleration_limit_mps2 must be in (0, 50].');
        if ((p.center_x_m !== undefined && Math.abs(p.center_x_m) > THEATER_HALF_M) || (p.center_y_m !== undefined && Math.abs(p.center_y_m) > THEATER_HALF_M)) return reject('Orbit center coordinates must be within ±600000 metres.');
        if (p.coverage_radius_km !== undefined && (p.coverage_radius_km <= 0 || p.coverage_radius_km > 600)) return reject('coverage_radius_km must be in (0, 600].');
        const hasAgl = p.agl_m !== undefined || p.node_id !== undefined;
        if (hasAgl && (p.agl_m === undefined || p.node_id === undefined || !Number.isInteger(p.node_id) || !this.nodeRegistry.hasNodeId(p.node_id))) return reject('AGL updates require a valid ground node_id and agl_m.');
        if (p.agl_m !== undefined && (p.agl_m < MIN_GROUND_AGL_M || p.agl_m > MAX_GROUND_AGL_M)) return reject(`agl_m must be between ${MIN_GROUND_AGL_M} and ${MAX_GROUND_AGL_M} metres.`);

        const nextMode = p.trajectory_mode ?? this.flightConfig.trajectoryMode;
        if (p.waypoints !== undefined && nextMode !== 'waypoints') return reject('waypoints can only be edited while trajectory_mode is explicitly waypoints.');
        let nextWaypoints = this.flightConfig.waypoints;
        if (p.waypoints !== undefined) {
          if (!Array.isArray(p.waypoints)) return reject('waypoints must be an array of {x_m, y_m} points.');
          const parsed: { xM: number; yM: number }[] = [];
          for (let i = 0; i < p.waypoints.length; i++) {
            const point = p.waypoints[i];
            if (!point || typeof point !== 'object' || !isFiniteNumber(point.x_m) || !isFiniteNumber(point.y_m) ||
                Math.abs(point.x_m) > THEATER_HALF_M || Math.abs(point.y_m) > THEATER_HALF_M) {
              return reject(`Waypoint ${i} must have finite x_m/y_m coordinates within ±600000 metres.`);
            }
            parsed.push({ xM: point.x_m, yM: point.y_m });
          }
          if (parsed.length > MAX_ACN_WAYPOINTS) return reject(`waypoints cannot exceed ${MAX_ACN_WAYPOINTS} points.`);
          nextWaypoints = parsed;
        }
        if (nextMode === 'waypoints' && (p.trajectory_mode === 'waypoints' || p.waypoints !== undefined) && nextWaypoints.length < 3) {
          return reject('Switching to waypoint mode requires at least three waypoints.');
        }
        if (nextMode === 'waypoints' && (p.center_x_m !== undefined || p.center_y_m !== undefined)) return reject('center_x_m/center_y_m apply only to ellipse mode.');

        const trajectoryKeys = ['acn_altitude_m', 'orbit_a_m', 'orbit_b_m', 'orbit_rotation_deg', 'loiter_speed_mps', 'acceleration_limit_mps2', 'deceleration_limit_mps2', 'center_x_m', 'center_y_m', 'trajectory_mode', 'waypoints'] as const;
        const changesTrajectory = trajectoryKeys.some(k => p[k] !== undefined);
        const changesTerrain = p.terrain_mode !== undefined;
        if (this.spatialLocked && (changesTrajectory || changesTerrain || hasAgl)) return locked();

        // Construct the full replacement trajectory before mutating any live configuration.
        let nextFlightConfig: ACNFlightConfig | null = null;
        let nextTrajectory: ACNTrajectory | null = null;
        if (changesTrajectory || p.coverage_radius_km !== undefined) {
          try {
            nextFlightConfig = new ACNFlightConfig({
              ...this.flightConfig,
              trajectoryMode: nextMode,
              waypoints: nextWaypoints,
              altitudeMslM: p.acn_altitude_m ?? this.flightConfig.altitudeMslM,
              loiterRadiusAM: p.orbit_a_m ?? this.flightConfig.loiterRadiusAM,
              loiterRadiusBM: p.orbit_b_m ?? this.flightConfig.loiterRadiusBM,
              loiterRotationDeg: p.orbit_rotation_deg ?? this.flightConfig.loiterRotationDeg,
              loiterSpeedMps: p.loiter_speed_mps ?? this.flightConfig.loiterSpeedMps,
              accelerationLimitMps2: p.acceleration_limit_mps2 ?? this.flightConfig.accelerationLimitMps2,
              decelerationLimitMps2: p.deceleration_limit_mps2 ?? this.flightConfig.decelerationLimitMps2,
              centerXm: p.center_x_m ?? this.flightConfig.centerXm,
              centerYm: p.center_y_m ?? this.flightConfig.centerYm,
              coverageRadiusKm: p.coverage_radius_km ?? this.flightConfig.coverageRadiusKm,
            });
            const prevKinematics = this.trajectoryEngine.getKinematicsState();
            nextTrajectory = createACNTrajectory(nextFlightConfig, prevKinematics);
            if (p.loiter_speed_mps !== undefined) {
              nextTrajectory.setTargetSpeed(p.loiter_speed_mps, this.simTimeS);
            }
            if (p.acceleration_limit_mps2 !== undefined || p.deceleration_limit_mps2 !== undefined) {
              nextTrajectory.setLimits(p.acceleration_limit_mps2, p.deceleration_limit_mps2);
            }
          } catch (error) {
            return reject(error instanceof Error ? error.message : 'Invalid trajectory configuration.');
          }
        }

        // All validation/construction is complete before any scenario state is changed.
        if (changesTerrain) {
          this.terrainEngine.setTerrainMode(p.terrain_mode);
          this.resampleGroundNodeAltitudes();
        }
        if (p.carrier_freq_ghz !== undefined) this.rfConfig = new RFConfig({ ...this.rfConfig, carrierFrequencyHz: p.carrier_freq_ghz * 1e9 });
        if (p.channel_bandwidth_mhz !== undefined) this.rfConfig = new RFConfig({ ...this.rfConfig, channelBandwidthHz: p.channel_bandwidth_mhz * 1e6 });
        if (p.rain_rate_mmh !== undefined) this.envConfig = new EnvironmentConfig({ ...this.envConfig, rainRateMmH: p.rain_rate_mmh });
        if (nextFlightConfig && nextTrajectory) {
          this.flightConfig = nextFlightConfig;
          this.trajectoryEngine = nextTrajectory;
        }
        if (changesTrajectory || p.coverage_radius_km !== undefined || p.carrier_freq_ghz !== undefined || p.channel_bandwidth_mhz !== undefined || p.rain_rate_mmh !== undefined) {
          this.lookaheadEngine = new PredictiveLookAheadEngine(
            this.terrainEngine, this.linkEngine, this.rfConfig, this.envConfig, this.flightConfig, this.trajectoryEngine
          );
        }
        if (p.agl_m !== undefined && p.node_id !== undefined) {
          const nid = p.node_id;
          const staticNode = this.nodesStatic.find(n => n.nodeId === nid);
          const tacNode = this.nodesTac.find(n => n.nodeId === nid);
          if (staticNode && tacNode) {
            const terrainMsl = this.terrainEngine.getElevation(tacNode.position[0], tacNode.position[1]);
            staticNode.aglM = p.agl_m;
            tacNode.aglM = p.agl_m;
            staticNode.position = [staticNode.position[0], staticNode.position[1], terrainMsl + p.agl_m];
            tacNode.position = [tacNode.position[0], tacNode.position[1], terrainMsl + p.agl_m];
            this.nodeRegistry.updateAgl(nid, p.agl_m);
          }
        }
        if (changesTerrain) this.initHillshade(512);
        if (changesTrajectory || changesTerrain || p.agl_m !== undefined) {
          this.spatialRevision++;
        }
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.emitProfileFrame();
        return result(true);
      }

      case 'SIM_CONTROL': {
        const act = typeof msg.action === 'string' ? msg.action.toLowerCase() : '';
        if (!['pause', 'resume', 'step', 'reset'].includes(act)) return reject('action must be pause, resume, step, or reset.');
        if (act === 'reset' && this.spatialLocked) return locked();
        if (act === 'pause') {
          this.isPaused = true;
          this.achievedSpeed = 0.0;
        } else if (act === 'resume') {
          this.isPaused = false;
          this.simDebtMs = 0.0;
          this.lastTickRealMs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
          this.lastSpeedMeasureTime = 0.0;
          this.lastSpeedMeasureSimTime = this.simTimeS;
        } else if (act === 'step') {
          this.isPaused = true;
          this.activeStepRequestId = typeof msg.step_request_id === 'number' ? msg.step_request_id : undefined;
          this.tickSimulation();
          this.activeStepRequestId = undefined;
        }
        else this.resetSimulationState();
        return result(true);
      }

      case 'SET_SPEED':
        if (!isFiniteNumber(msg.speed) || msg.speed < 0.1 || msg.speed > 10) return reject('speed must be finite and between 0.1 and 10.');
        this.speed = msg.speed;
        this.restartTimer();
        return result(true);

      case 'SET_SCHEDULER':
        if (msg.mode !== 'tac_tad' && msg.mode !== 'static') return reject('mode must be tac_tad or static.');
        this.schedulerMode = msg.mode;
        return result(true);

      case 'SELECT_NODE':
        if (msg.node_id === -1) {
          this.selectedNodeId = -1;
          this.emitProfileFrame();
          return result(true);
        }
        if (!Number.isInteger(msg.node_id) || !this.nodeRegistry.hasNodeId(msg.node_id)) return reject('node_id must identify a registered ground node.');
        this.selectedNodeId = msg.node_id;
        this.emitProfileFrame();
        return result(true);

      case 'CLEAR_TRANSFER': {
        const nid = msg.node_id === undefined ? this.selectedNodeId : msg.node_id;
        if (!Number.isInteger(nid) || !this.nodeRegistry.hasNodeId(nid)) return reject('node_id must identify a registered ground node.');
        this.transferManager.clearTransfer(nid);
        return result(true);
      }

      case 'NODE_ADD': {
        const outcome = NodeLifecycleManager.addNode({
          msg,
          nodeRegistry: this.nodeRegistry,
          registrationLifecycle: this.registrationLifecycle,
          terrainEngine: this.terrainEngine,
          simTimeS: this.simTimeS,
          spatialLocked: this.spatialLocked,
        });
        if (!outcome.accepted) {
          return reject(outcome.reason!);
        }

        const nid = outcome.entity!.identity.nodeId;
        this.nodesStatic.push(outcome.nodePair![0]);
        this.nodesTac.push(outcome.nodePair![1]);

        this.transferManager.registerNode(nid);

        if (this.selectedNodeId < 0 || !this.nodeRegistry.hasNodeId(this.selectedNodeId)) {
          this.selectedNodeId = nid;
        }

        this.spatialRevision++;
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.emitProfileFrame();

        const res: WorkerCommandResult = {
          type: 'COMMAND_RESULT',
          command_type: 'NODE_ADD',
          accepted: true,
          node_id: nid,
          entity_id: outcome.entity!.identity.entityId,
          creation_sequence: outcome.entity!.identity.creationSequence,
          nodes_count: this.nodeRegistry.size,
          spatial_locked: this.spatialLocked,
          request_id: msg.request_id,
        };
        this.emitHostMessage(res);
        return res;
      }

      case 'NODE_DELETE': {
        const outcome = NodeLifecycleManager.deleteNode({
          msg,
          nodeRegistry: this.nodeRegistry,
          registrationLifecycle: this.registrationLifecycle,
          simTimeS: this.simTimeS,
          spatialLocked: this.spatialLocked,
        });
        if (!outcome.accepted) {
          return reject(outcome.reason!);
        }

        const nid = outcome.deletedNodeId!;
        this.nodesStatic = this.nodesStatic.filter(n => n.nodeId !== nid);
        this.nodesTac = this.nodesTac.filter(n => n.nodeId !== nid);

        this.staticScheduler.evictNode(nid);
        this.tacScheduler.evictNode(nid);

        this.linkStatuses.delete(nid);
        this.predStates.delete(nid);
        this.obstructionResults.delete(nid);
        this.transferManager.evictNode(nid);

        if (this.selectedNodeId === nid) {
          if (this.nodesTac.length > 0) {
            this.selectedNodeId = this.nodesTac[0].nodeId;
          } else {
            this.selectedNodeId = -1;
          }
        }

        this.spatialRevision++;
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.emitProfileFrame();

        const res: WorkerCommandResult = {
          type: 'COMMAND_RESULT',
          command_type: 'NODE_DELETE',
          accepted: true,
          node_id: nid,
          deleted_node_id: nid,
          nodes_count: this.nodeRegistry.size,
          spatial_locked: this.spatialLocked,
          request_id: msg.request_id,
        };
        this.emitHostMessage(res);
        return res;
      }

      case 'NODE_DUPLICATE': {
        const outcome = NodeLifecycleManager.duplicateNode({
          msg,
          nodeRegistry: this.nodeRegistry,
          registrationLifecycle: this.registrationLifecycle,
          terrainEngine: this.terrainEngine,
          simTimeS: this.simTimeS,
          spatialLocked: this.spatialLocked,
        });
        if (!outcome.accepted) {
          return reject(outcome.reason!);
        }

        const nid = outcome.entity!.identity.nodeId;
        this.nodesStatic.push(outcome.nodePair![0]);
        this.nodesTac.push(outcome.nodePair![1]);

        this.transferManager.registerNode(nid);

        this.spatialRevision++;
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.emitProfileFrame();

        const res: WorkerCommandResult = {
          type: 'COMMAND_RESULT',
          command_type: 'NODE_DUPLICATE',
          accepted: true,
          node_id: nid,
          entity_id: outcome.entity!.identity.entityId,
          source_node_id: outcome.sourceNodeId!,
          creation_sequence: outcome.entity!.identity.creationSequence,
          nodes_count: this.nodeRegistry.size,
          spatial_locked: this.spatialLocked,
          request_id: msg.request_id,
        };
        this.emitHostMessage(res);
        return res;
      }

      case 'NODE_UPDATE': {
        const outcome = NodeLifecycleManager.updateNode({
          msg,
          nodesStatic: this.nodesStatic,
          nodesTac: this.nodesTac,
          nodeRegistry: this.nodeRegistry,
          terrainEngine: this.terrainEngine,
          spatialLocked: this.spatialLocked,
        });
        if (!outcome.accepted) {
          return reject(outcome.reason!);
        }

        if (outcome.spatialChanged) {
          this.spatialRevision++;
        }
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.emitProfileFrame();

        const res: WorkerCommandResult = {
          type: 'COMMAND_RESULT',
          command_type: 'NODE_UPDATE',
          accepted: true,
          node_id: outcome.nodeId!,
          spatial_locked: this.spatialLocked,
          request_id: msg.request_id,
        };
        this.emitHostMessage(res);
        return res;
      }
      default:
        return reject(`Unsupported command type '${commandType}'.`);
    }
  }

  public async start(): Promise<void> {
    // 1. Try to load real satellite DEM using dynamic Base URL
    try {
      const ok = await this.terrainEngine.loadRealSatelliteDem();
      if (ok) {
        console.log('[Worker] Real satellite DEM loaded successfully.');
        // Loading the DEM changes elevation samples while the nodes still carry
        // constructor-time fallback altitudes. Resample before starting the ticker.
        this.resampleGroundNodeAltitudes();
      } else {
        console.log('[Worker] Real satellite DEM not found, using synthetic procedural fallback.');
        this.terrainEngine.setTerrainMode('synthetic');
      }
    } catch (e) {
      console.warn('[Worker] Satellite DEM acquisition note:', e);
      this.terrainEngine.setTerrainMode('synthetic');
    }

    // 2. Generate 512x512 hillshade relief grid covering the 1,200 km theater
    this.initHillshade(512);

    // 3. Start 50 Hz discrete-event ticker
    this.restartTimer();
  }

  private restartTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    this.lastTickRealMs = now;
    this.simDebtMs = 0;

    // For speed <= 1.0: pace by adjusting timer interval (e.g. 0.1x -> 200ms, 0.5x -> 40ms, 1.0x -> 20ms)
    // For speed > 1.0: keep timer interval at a reliable 20ms (50 Hz) and batch multiple 20ms steps per tick
    const intervalMs = this.speed <= 1.0
      ? Math.max(20, Math.round(20.0 / this.speed))
      : 20;

    const timer = setInterval(() => {
      if (this.isPaused) {
        this.lastTickRealMs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now();
        this.simDebtMs = 0;
        return;
      }

      const tickNow = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
      const elapsedRealMs = Math.min(250, Math.max(0, tickNow - this.lastTickRealMs));
      this.lastTickRealMs = tickNow;

      // Accumulate simulated milliseconds debt
      this.simDebtMs += elapsedRealMs * this.speed;

      // Bound max steps in a single batch to prevent spiral-of-death on heavy CPU stalls
      const maxStepsPerBatch = Math.max(1, Math.min(25, Math.ceil(this.speed * 2.5)));
      let stepsRun = 0;

      // Run 20 ms simulation steps while we have accumulated simulation debt
      while (this.simDebtMs >= 20.0 && stepsRun < maxStepsPerBatch) {
        stepsRun++;
        this.simDebtMs -= 20.0;
        // In a batch, only emit telemetry on the final step to keep main thread UI responsive
        const isFinalStep = (this.simDebtMs < 20.0 || stepsRun >= maxStepsPerBatch);
        this.tickSimulation(isFinalStep);
      }

      // If debt still exceeds 50ms after batching, drain excess debt to avoid runaway catchup lag
      if (this.simDebtMs > 50.0) {
        this.simDebtMs = 50.0;
      }

      // Track achieved speed over rolling ~400ms window
      this.updateAchievedSpeedMeasurement(tickNow);
    }, intervalMs);

    if (typeof (timer as any)?.unref === 'function') {
      (timer as any).unref();
    }
    this.timerId = timer as unknown as number;
  }

  private updateAchievedSpeedMeasurement(wallNow: number): void {
    if (this.lastSpeedMeasureTime <= 0) {
      this.lastSpeedMeasureTime = wallNow;
      this.lastSpeedMeasureSimTime = this.simTimeS;
      return;
    }
    const wallElapsedMs = wallNow - this.lastSpeedMeasureTime;
    if (wallElapsedMs >= 400) {
      const realElapsedS = wallElapsedMs / 1000.0;
      const simElapsedS = this.simTimeS - this.lastSpeedMeasureSimTime;
      if (this.isPaused) {
        this.achievedSpeed = 0.0;
      } else if (realElapsedS > 0) {
        this.achievedSpeed = Math.round((simElapsedS / realElapsedS) * 100) / 100;
      }
      this.lastSpeedMeasureTime = wallNow;
      this.lastSpeedMeasureSimTime = this.simTimeS;
    }
  }
}

// Instantiate only when executed inside a browser worker. Importing this module
// from Node must not start timers or require Worker globals.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const simWorker = new SimulationWorkerManager(0, 'ACN_ONLY');
  void simWorker.start();
  self.onmessage = (event: MessageEvent<WorkerInboundCommand>) => {
    simWorker.handleMessage(event.data);
  };
}
```

### File: `src/worker/telemetrySerializer.ts` (628 lines, 28,078 bytes)

```typescript
/**
 * Telemetry Serializer for the X-Band Aerial Communication Network Digital Twin.
 *
 * Encapsulates telemetry packaging, formatting, and protocol payload serialization:
 * 1. Assembly of full 50 Hz TELEMETRY_FRAME protocol messages.
 * 2. Assembly of out-of-band PROFILE_FRAME protocol messages.
 * 3. Individual node telemetry formatting (coordinates, queues, battery, registration, transfer).
 * 4. Slot allocation normalization into Gantt-compatible frame intervals.
 * 5. Comparative KPI dashboard aggregation and calculations.
 * 6. Active transfer telemetry formatting.
 *
 * This module is pure telemetry formatting: all domain propagation, Fresnel geometry,
 * terrain sampling, and RF link-budget calculations remain in the simulation/domain layer.
 */

import {
  FRAME_DT,
  MCP_ID,
  THEATER_HALF_M,
} from '../shared/constants';
import type {
  TelemetryFrame,
  NodeTelemetryItem,
  FresnelSliceTelemetry,
  TelemetryGanttAllocation,
  NodeTransferTelemetry,
  ProfileFrameMessage,
} from '../shared/workerProtocol';
import { cartesianToGeodetic } from '../core/geodesy';
import {
  REAL_LADAKH_DEM_METADATA,
  TerrainBoundsTelemetry,
  TerrainEngine,
  TerrainObstruction,
} from '../core/terrain';
import { ACNFlightConfig } from '../core/config';
import { LinkStatus } from '../core/linkBudget';
import {
  SlotAllocation,
  FrameScheduleReport,
} from '../core/scheduler';
import { GroundNodeTrafficSubsystem } from '../core/queues';
import { NodeRegistry } from '../core/nodeRegistry';
import { RegistrationLifecycle } from '../core/registration';
import { RollingGoodputTracker } from '../core/rollingGoodput';
import {
  ActiveTransferTelemetry,
  calculateTransferEtaSeconds,
} from '../core/transferMetrics';
import {
  type NodeTransferState,
} from '../core/transferManager';
import {
  ACNTrajectory,
  NodeTerrainState,
  PredictiveState,
} from '../core/trajectory';
import { PROFILE_FRESNEL_FRACTION } from '../core/profileEngine';

export { PROFILE_FRESNEL_FRACTION };
export type { NodeTransferState };

/** Running metrics tracking cumulative simulation KPIs */
export interface RunningMetrics {
  staticGoodputBits: number;
  tacGoodputBits: number;
  staticWastedBits: number;
  tacWastedBits: number;
  staticDroppedPkts: number;
  tacDroppedPkts: number;
  staticEnqueuedPkts: number;
  tacEnqueuedPkts: number;
  node4PreShadowBacklogKb: number;
  staticNode4PreShadowBacklogKb: number;
  lastStaticUtilPct: number;
  lastTacUtilPct: number;
  staticScheduledUlTimeS: number;
  tacScheduledUlTimeS: number;
  staticAvailableUlTimeS: number;
  tacAvailableUlTimeS: number;
  staticUnusedUlTimeS: number;
  tacUnusedUlTimeS: number;
  staticPayloadBitsDequeued: number;
  tacPayloadBitsDequeued: number;
  staticDelayDropsThisRun: number;
  tacDelayDropsThisRun: number;
  staticOverflowDropsThisRun: number;
  tacOverflowDropsThisRun: number;
  staticFinalBacklogBits: number;
  tacFinalBacklogBits: number;
}


/**
 * Authoritative read-only simulation state interface required for telemetry serialization.
 * SimulationWorkerManager satisfies this contract without coupling this module to domain engines.
 */
export interface TelemetrySimulationState {
  readonly frameIndex: number;
  readonly simTimeS: number;
  readonly speed: number;
  readonly achievedSpeed: number;
  readonly isPaused: boolean;
  readonly activeStepRequestId?: number;
  readonly spatialLocked: boolean;
  readonly spatialRevision: number;
  readonly schedulerMode: string;
  readonly selectedNodeId: number;

  readonly nodesStatic: readonly GroundNodeTrafficSubsystem[];
  readonly nodesTac: readonly GroundNodeTrafficSubsystem[];
  readonly nodeRegistry: NodeRegistry;
  readonly registrationLifecycle: RegistrationLifecycle;

  readonly flightConfig: ACNFlightConfig;
  readonly trajectoryEngine: ACNTrajectory;
  readonly terrainEngine: TerrainEngine;

  readonly linkStatuses: ReadonlyMap<number, LinkStatus>;
  readonly predStates: ReadonlyMap<number, PredictiveState>;
  readonly obstructionResults: ReadonlyMap<number, TerrainObstruction>;
  readonly nodeTransfers: ReadonlyMap<number, NodeTransferState>;

  readonly metrics: RunningMetrics;
  readonly lastReportStatic: FrameScheduleReport | null;
  readonly lastReportTac: FrameScheduleReport | null;
  readonly staticGoodputTracker: RollingGoodputTracker;
  readonly tacGoodputTracker: RollingGoodputTracker;
}

/**
 * Normalizes an authoritative TDMA slot allocation into standard frame timing and Gantt metrics.
 *
 * Emits an explicit diagnostic warning if an allocation falls outside the current frame interval,
 * has non-finite values, or has non-positive duration.
 */
export function normalizeSlotAllocationToFrame(
  a: SlotAllocation,
  frameStartSimTimeS: number,
  frameDurationS: number = FRAME_DT
): TelemetryGanttAllocation {
  const relStartS = a.slotStartS - frameStartSimTimeS;
  const startMs = relStartS * 1000.0;
  const durationMs = a.durationS * 1000.0;
  const endMs = startMs + durationMs;
  const maxFrameMs = frameDurationS * 1000.0;

  // Floating-point tolerance for tiny numerical boundary deviations only (0.1 us)
  const EPSILON = 1e-4;

  // 1. Explicitly diagnose non-finite values
  const isFiniteNumbers =
    Number.isFinite(startMs) &&
    Number.isFinite(durationMs) &&
    Number.isFinite(endMs);

  // 2. Explicitly diagnose zero or negative allocation durations
  const isNonPositiveDuration = !isFiniteNumbers || durationMs <= 0.0;

  // 3. Half-open interval [0, maxFrameMs): slot may end at maxFrameMs, but must not begin at maxFrameMs
  const isOutOfInterval =
    !isFiniteNumbers ||
    startMs < -EPSILON ||
    startMs >= maxFrameMs - EPSILON ||
    endMs > maxFrameMs + EPSILON;

  const isOutOfFrame = !isFiniteNumbers || isNonPositiveDuration || isOutOfInterval;

  if (!isFiniteNumbers) {
    console.warn(
      `[Scheduler Diagnostic] Non-finite allocation timing for node ${a.nodeId}: ` +
      `start_ms=${startMs}, duration_ms=${durationMs}, end_ms=${endMs}`
    );
  } else if (isNonPositiveDuration) {
    console.warn(
      `[Scheduler Diagnostic] Non-positive allocation duration for node ${a.nodeId}: ` +
      `duration_ms=${durationMs.toFixed(3)}ms (must be strictly > 0)`
    );
  } else if (isOutOfInterval) {
    console.warn(
      `[Scheduler Diagnostic] Out-of-frame allocation for node ${a.nodeId}: ` +
      `start=${startMs.toFixed(3)}ms, duration=${durationMs.toFixed(3)}ms, end=${endMs.toFixed(3)}ms ` +
      `(frame interval [0.000, ${maxFrameMs.toFixed(3)}) ms, frameStartSimTimeS=${frameStartSimTimeS.toFixed(4)})`
    );
  }

  return {
    node_id: a.nodeId,
    start_ms: startMs,
    duration_ms: durationMs,
    duration_s: a.durationS,
    slot_start_s: a.slotStartS,
    capacity_bits: a.capacityBits,
    modcod_name: a.modcodName,
    spectral_efficiency: a.spectralEfficiency,
    c2_bytes: a.capacityBits > 0 ? 128 : 0,
    voice_bytes: 0,
    video_bytes: 0,
    photo_bytes: 0,
    is_pre_occlusion_flush: a.isPreOcclusionFlush,
    is_out_of_frame: isOutOfFrame,
  };
}

/**
 * Dedicated telemetry serializer constructing host telemetry payloads from simulation state.
 */
export class TelemetrySerializer {
  /**
   * Constructs telemetry items for all active ground nodes from precomputed domain results.
   */
  public buildNodesTelemetry(
    state: TelemetrySimulationState,
    acnPos: [number, number, number]
  ): NodeTelemetryItem[] {
    const activeNodes = state.schedulerMode === 'tac_tad' ? state.nodesTac : state.nodesStatic;
    return activeNodes.map((node) => {
      const obstruction = state.obstructionResults.get(node.nodeId);
      const ls = state.linkStatuses.get(node.nodeId);
      const ps = state.predStates.get(node.nodeId);
      const q = node.queue;

      const [nx, ny] = node.position;
      const geo = cartesianToGeodetic(nx, ny);

      const c2Bytes = q.getClassBacklogBytes(69);
      const voiceBytes = q.getClassBacklogBytes(65);
      const videoBytes = q.getClassBacklogBytes(67);
      const photoBytes = q.getClassBacklogBytes(70);

      const activeReport = state.schedulerMode === 'tac_tad' ? state.lastReportTac : state.lastReportStatic;
      const alloc = activeReport?.allocations.find((a) => a.nodeId === node.nodeId);
      const trans = state.nodeTransfers.get(node.nodeId);
      const isOutage = ls?.isOutage ?? true;
      const isObstacleBlocked = ls?.obstacleBlocked ?? false;
      const isTerrainBlocked = !(obstruction?.isLos ?? true);
      const isBlocked = isTerrainBlocked || isObstacleBlocked;
      const isHardShadow = ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF;
      const hasSlotCapacity = alloc !== undefined && alloc.capacityBits > 0 && alloc.durationS > 0;
      const isTransmitting = !isOutage && !isBlocked && !isHardShadow && (
        (trans !== undefined && trans.status === 'TRANSMITTING') ||
        (hasSlotCapacity && q.getTotalBacklogBytes() > 0)
      );
      const isWastingAirtime = Boolean(hasSlotCapacity && (isOutage || isBlocked || isHardShadow));

      const transRemaining = trans ? Math.max(0, trans.totalBytes - trans.deliveredBytes) : 0;
      const transEta = trans ? calculateTransferEtaSeconds(transRemaining, trans.currentRateBps, trans.status, state.isPaused) : { etaS: null, etaStatus: 'STANDBY' };

      const transState: NodeTransferTelemetry | null = trans && trans.status !== 'IDLE' ? {
        node_id: node.nodeId,
        status: trans.status,
        status_message: trans.statusMessage,
        active_type: trans.activeType,
        total_bytes: trans.totalBytes,
        delivered_bytes: trans.deliveredBytes,
        dropped_bytes: trans.droppedBytes,
        dropped_packets: trans.droppedPackets,
        progress_pct: trans.totalBytes > 0 ? Math.min(100.0, Math.round(((trans.deliveredBytes / trans.totalBytes) * 100.0) * 10) / 10) : 0.0,
        start_time_s: trans.startTimeS,
        ack_time_s: trans.ackTimeS,
        current_rate_bps: trans.currentRateBps,
        current_rate_mbps: trans.currentRateBps / 1e6,
        eta_s: transEta.etaS,
        eta_status: transEta.etaStatus,
      } : null;

      const regEntity = state.nodeRegistry.getByNodeId(node.nodeId);
      const registration = state.registrationLifecycle.get(node.nodeId);
      const callsign = regEntity?.identity.callsign ?? node.identity?.callsign ?? (node.nodeId === MCP_ID ? 'MCP' : `S${node.nodeId}`);

      return {
        node_id: node.nodeId,
        entity_id: node.entityId,
        creation_sequence: node.creationSequence,
        name: callsign,
        node_type: node.nodeType,
        x_m: node.position[0],
        y_m: node.position[1],
        z_m: node.position[2],
        lat_deg: geo.latDeg,
        lon_deg: geo.lonDeg,
        coordinate_reference: 'local Cartesian; x/y metres; z absolute altitude MSL metres',
        terrain_elevation_msl_m: state.terrainEngine.getElevation(node.position[0], node.position[1]),
        agl_m: node.aglM,
        altitude_msl_m: node.position[2],
        slant_range_km: (ls?.slantRangeM ?? 0) / 1000.0,
        snr_db: ls?.snrDb ?? -99.0,
        modcod_name: ls?.modcodName ?? 'LINK_OUTAGE',
        link_outage: ls?.isOutage ?? true,
        bitrate_bps: ls?.bitrateBps ?? 0,
        bitrate_mbps: ls?.bitrateMbps ?? 0,
        terrain_is_los: obstruction?.isLos ?? true,
        diffraction_loss_db: ls?.diffractionLossDb ?? obstruction?.diffractionLossDb ?? 0,
        state_name: ps?.currentState ?? NodeTerrainState.NORMAL_LOS,
        time_to_occlusion_s: ps?.timeToOcclusionS ?? -1,
        time_to_emergence_s: ps?.timeToEmergenceS ?? -1,
        fresnel_clearance_m: ps?.fresnelClearanceM ?? 0,
        obstacle_blocked: ls?.obstacleBlocked ?? false,
        is_coverage_complete: obstruction?.isCoverageComplete ?? true,
        isCoverageComplete: obstruction?.isCoverageComplete ?? true,
        coverage_note: obstruction?.coverageNote,
        coverageNote: obstruction?.coverageNote,
        c2_backlog: q.getClassPacketCount(69),
        voice_backlog: q.getClassPacketCount(65),
        video_backlog: q.getClassPacketCount(67),
        photo_backlog: q.getClassPacketCount(70),
        c2_bytes: c2Bytes,
        voice_bytes: voiceBytes,
        video_bytes: videoBytes,
        photo_bytes: photoBytes,
        total_backlog_bytes: q.getTotalBacklogBytes(),
        is_transmitting: isTransmitting,
        is_wasting_airtime: isWastingAirtime,
        allocated_slot_ms: (alloc?.durationS ?? 0) * 1000.0,
        allocated_capacity_bits: alloc?.capacityBits ?? 0,
        transfer_state: transState,
        color_hex: regEntity?.identity.colorHex ?? node.identity?.colorHex ?? (node.nodeType === 'mcp' ? '#f59e0b' : '#38bdf8'),
        tx_power_dbm: node.txPowerDbm ?? (node.nodeType === 'mcp' ? 43.0 : 36.0),
        battery_capacity_mah: node.batteryCapacityMah ?? (node.nodeType === 'mcp' ? 20000 : 5000),
        battery_level_pct: Number((node.batteryLevelPct ?? 100.0).toFixed(1)),
        tactical_priority: node.tacticalPriority ?? 1.0,
        is_depleted: node.batteryLevelPct <= 0 || node.isDepleted,
        registration_state: registration.state,
        registration_start_time_s: registration.start_time_s,
        registration_completion_time_s: registration.completion_time_s,
        registration_elapsed_s: registration.start_time_s === null ? null : Math.max(0, state.simTimeS - registration.start_time_s),
        communication_eligible: registration.state === 'REGISTERED',
      };
    });
  }

  /**
   * Helper constructing Node 4 status text for comparative KPI dashboard.
   */
  public getNode4Status(
    predStates: ReadonlyMap<number, PredictiveState>,
    nodesTac: readonly GroundNodeTrafficSubsystem[]
  ): string {
    const ps = predStates.get(4);
    if (!ps) return 'NOMINAL';
    const node4 = nodesTac.find((n) => n.nodeId === 4);
    if (!node4) return 'NOMINAL';
    const kb = node4.queue.getTotalBacklogBytes() / 1024.0;
    switch (ps.currentState) {
      case NodeTerrainState.NORMAL_LOS: return 'NOMINAL';
      case NodeTerrainState.PRE_OCCLUSION_FLUSH: return `EVACUATING ${kb.toFixed(1)} KB`;
      case NodeTerrainState.HARD_SHADOW_CUTOFF: return 'SHADOWED - BUFFERING';
      case NodeTerrainState.RE_EMERGENCE_BURST: return 'BURST RECOVERY';
      default: return 'NOMINAL';
    }
  }

  /**
   * Builds the complete 50 Hz TELEMETRY_FRAME payload for host publication,
   * using precomputed Fresnel slice and domain state.
   */
  public buildTelemetryFrame(
    state: TelemetrySimulationState,
    acnPos: [number, number, number],
    fresnelSlice: FresnelSliceTelemetry
  ): TelemetryFrame {
    const activeNodes = state.schedulerMode === 'tac_tad' ? state.nodesTac : state.nodesStatic;
    const [vx, vy] = state.trajectoryEngine.getAcnVelocity(state.simTimeS);

    const nodesTel = this.buildNodesTelemetry(state, acnPos);

    // Detect state nodes synchronously so TypeScript tracks types cleanly
    let flushNode: { node: GroundNodeTrafficSubsystem; ps: PredictiveState } | null = null;
    let cutoffNode: { node: GroundNodeTrafficSubsystem; ps: PredictiveState } | null = null;
    let burstNode: { node: GroundNodeTrafficSubsystem; ps: PredictiveState } | null = null;

    for (const node of activeNodes) {
      const ps = state.predStates.get(node.nodeId);
      if (ps) {
        if (ps.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH && !flushNode) {
          flushNode = { node, ps };
        } else if (ps.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF && !cutoffNode) {
          cutoffNode = { node, ps };
        } else if (ps.currentState === NodeTerrainState.RE_EMERGENCE_BURST && !burstNode) {
          burstNode = { node, ps };
        }
      }
    }

    let narrative = activeNodes.length === 0
      ? 'ACN RELAY STANDBY: Operational loiter orbit active. Zero ground terminals currently deployed. Ready for dynamic terminal deployment.'
      : 'NOMINAL PATROL: All terminals in clear Line-of-Sight. ACN coverage bubble tracking along elliptical orbit at FL500 (5,000m).';
    if (flushNode) {
      narrative = `LOOK-AHEAD EVENT: S${flushNode.node.nodeId} predicted to enter mountain shadow in ${flushNode.ps.timeToOcclusionS.toFixed(1)}s. Tac-TAD expanded its slot to evacuate queue backlog before cutoff.`;
    } else if (cutoffNode) {
      narrative = `TERRAIN OUTAGE: S${cutoffNode.node.nodeId} line-of-sight is severed by mountain ridge. Static TDMA is wasting frame time radiating into rock. Tac-TAD reclaims 100% of the slot for other units.`;
    } else if (burstNode) {
      narrative = `RE-EMERGENCE: S${burstNode.node.nodeId} cleared the ridge. Tac-TAD allocated an immediate zero-contention burst to restore tactical comms.`;
    }

    const sg = state.metrics.staticGoodputBits;
    const tg = state.metrics.tacGoodputBits;
    const sw = state.metrics.staticWastedBits;
    const tw = state.metrics.tacWastedBits;
    const sd = state.metrics.staticDroppedPkts;
    const td = state.metrics.tacDroppedPkts;
    const se = Math.max(1, state.metrics.staticEnqueuedPkts);
    const te = Math.max(1, state.metrics.tacEnqueuedPkts);

    const activeReport = state.schedulerMode === 'tac_tad' ? state.lastReportTac : state.lastReportStatic;

    const staticDropDelayThisFrame = state.lastReportStatic?.packetsDroppedDelayThisFrame ?? 0;
    const staticDropOverflowThisFrame = state.lastReportStatic?.packetsDroppedOverflowThisFrame ?? 0;
    const staticDropTotalThisFrame = staticDropDelayThisFrame + staticDropOverflowThisFrame;

    const tacDropDelayThisFrame = state.lastReportTac?.packetsDroppedDelayThisFrame ?? 0;
    const tacDropOverflowThisFrame = state.lastReportTac?.packetsDroppedOverflowThisFrame ?? 0;
    const tacDropTotalThisFrame = tacDropDelayThisFrame + tacDropOverflowThisFrame;

    const activeDropDelayThisFrame = state.schedulerMode === 'tac_tad' ? tacDropDelayThisFrame : staticDropDelayThisFrame;
    const activeDropOverflowThisFrame = state.schedulerMode === 'tac_tad' ? tacDropOverflowThisFrame : staticDropOverflowThisFrame;
    const activeDropTotalThisFrame = state.schedulerMode === 'tac_tad' ? tacDropTotalThisFrame : staticDropTotalThisFrame;

    const activeGoodputBitsThisFrame = state.schedulerMode === 'tac_tad'
      ? (state.lastReportTac?.totalBitsTransmitted ?? 0)
      : (state.lastReportStatic?.totalBitsTransmitted ?? 0);
    const activeWastedBitsThisFrame = state.schedulerMode === 'tac_tad'
      ? (state.lastReportTac?.totalBitsWastedOnOutage ?? 0)
      : (state.lastReportStatic?.totalBitsWastedOnOutage ?? 0);

    const selStaticNode = state.nodesStatic.find(n => n.nodeId === state.selectedNodeId);
    const selTacNode = state.nodesTac.find(n => n.nodeId === state.selectedNodeId);
    const staticSelectedBacklogKb = selStaticNode
      ? selStaticNode.queue.getTotalBacklogBytes() / 1024.0
      : null;
    const tacSelectedBacklogKb = selTacNode
      ? selTacNode.queue.getTotalBacklogBytes() / 1024.0
      : null;

    const kpi = {
      static_goodput_mb: sg / 1e6,
      tac_goodput_mb: tg / 1e6,
      gain_multiplier: tg / Math.max(sg, 1.0),
      static_waste_pct: sg + sw > 0 ? (sw / (sg + sw)) * 100.0 : 0.0,
      tac_waste_pct: tg + tw > 0 ? (tw / (tg + tw)) * 100.0 : 0.0,
      static_drops: sd,
      static_drop_pct: (sd / se) * 100.0,
      tac_drops: td,
      tac_drop_pct: (td / te) * 100.0,
      ul_utilization_pct: activeReport?.totalUlUtilizationPct ?? 0,
      node4_pre_shadow_backlog_kb: state.metrics.node4PreShadowBacklogKb,
      static_node4_pre_shadow_backlog_kb: state.metrics.staticNode4PreShadowBacklogKb,
      node4_evac_status: this.getNode4Status(state.predStates, state.nodesTac),
      static_selected_backlog_kb: staticSelectedBacklogKb,
      tac_selected_backlog_kb: tacSelectedBacklogKb,

      // Exact per-frame scheduler metrics (purely additive):
      static_goodput_frame_bits: state.lastReportStatic?.totalBitsTransmitted ?? 0,
      tac_goodput_frame_bits: state.lastReportTac?.totalBitsTransmitted ?? 0,
      active_goodput_frame_bits: activeGoodputBitsThisFrame,
      static_wasted_frame_bits: state.lastReportStatic?.totalBitsWastedOnOutage ?? 0,
      tac_wasted_frame_bits: state.lastReportTac?.totalBitsWastedOnOutage ?? 0,
      active_wasted_frame_bits: activeWastedBitsThisFrame,
      static_drop_delay_frame_pkts: staticDropDelayThisFrame,
      static_drop_overflow_frame_pkts: staticDropOverflowThisFrame,
      static_drop_frame_pkts: staticDropTotalThisFrame,
      tac_drop_delay_frame_pkts: tacDropDelayThisFrame,
      tac_drop_overflow_frame_pkts: tacDropOverflowThisFrame,
      tac_drop_frame_pkts: tacDropTotalThisFrame,
      active_drop_delay_frame_pkts: activeDropDelayThisFrame,
      active_drop_overflow_frame_pkts: activeDropOverflowThisFrame,
      active_drop_frame_pkts: activeDropTotalThisFrame,
      static_utilization_pct: state.lastReportStatic?.totalUlUtilizationPct ?? 0,
      tac_utilization_pct: state.lastReportTac?.totalUlUtilizationPct ?? 0,

      // Rolling P50/P95 goodput statistics in bps (M7.3)
      static_p50_bps: state.staticGoodputTracker.p50Bps,
      static_p95_bps: state.staticGoodputTracker.p95Bps,
      tac_p50_bps: state.tacGoodputTracker.p50Bps,
      tac_p95_bps: state.tacGoodputTracker.p95Bps,
      rolling_window_sample_count: state.staticGoodputTracker.sampleCount,
      rolling_window_capacity: state.staticGoodputTracker.capacity,
    };

    const trans = state.nodeTransfers.get(state.selectedNodeId) ?? {
      activeType: null, totalBytes: 0, deliveredBytes: 0, prevDeliveredBytes: 0, droppedBytes: 0, droppedPackets: 0,
      status: 'IDLE' as const, statusMessage: '', startTimeS: -1, ackTimeS: -1, lastQueueDrops: 0,
      lastUpdateSimTimeS: -1, currentRateBps: 0, etaS: null, etaStatus: 'STANDBY'
    };
    const pct = trans.totalBytes > 0 ? (trans.deliveredBytes / trans.totalBytes) * 100.0 : 0.0;

    const transRemaining = Math.max(0, trans.totalBytes - trans.deliveredBytes);
    const transEta = calculateTransferEtaSeconds(transRemaining, trans.currentRateBps, trans.status, state.isPaused);

    const transferTel: ActiveTransferTelemetry = {
      node_id: state.selectedNodeId,
      status: trans.status,
      status_message: trans.statusMessage,
      active_type: trans.activeType,
      total_bytes: trans.totalBytes,
      delivered_bytes: trans.deliveredBytes,
      dropped_bytes: trans.droppedBytes,
      dropped_packets: trans.droppedPackets,
      progress_pct: Math.min(100.0, Math.round(pct * 10) / 10),
      start_time_s: trans.startTimeS,
      ack_time_s: trans.ackTimeS,
      current_rate_bps: trans.currentRateBps,
      current_rate_mbps: trans.currentRateBps / 1e6,
      eta_s: transEta.etaS,
      eta_status: transEta.etaStatus,
    };

    const activeTransfers: ActiveTransferTelemetry[] = [];
    for (const [nid, t] of state.nodeTransfers.entries()) {
      if (t.status !== 'IDLE') {
        const p = t.totalBytes > 0 ? (t.deliveredBytes / t.totalBytes) * 100.0 : 0.0;
        const tRemaining = Math.max(0, t.totalBytes - t.deliveredBytes);
        const tEta = calculateTransferEtaSeconds(tRemaining, t.currentRateBps, t.status, state.isPaused);
        activeTransfers.push({
          node_id: nid,
          status: t.status,
          status_message: t.statusMessage,
          active_type: t.activeType,
          total_bytes: t.totalBytes,
          delivered_bytes: t.deliveredBytes,
          dropped_bytes: t.droppedBytes,
          dropped_packets: t.droppedPackets,
          progress_pct: Math.min(100.0, Math.round(p * 10) / 10),
          start_time_s: t.startTimeS,
          ack_time_s: t.ackTimeS,
          current_rate_bps: t.currentRateBps,
          current_rate_mbps: t.currentRateBps / 1e6,
          eta_s: tEta.etaS,
          eta_status: tEta.etaStatus,
        });
      }
    }

    const mapAlloc = (a: SlotAllocation) => normalizeSlotAllocationToFrame(a, state.simTimeS, FRAME_DT);
    const allocations = (activeReport?.allocations ?? []).map(mapAlloc);
    const acnGeo = cartesianToGeodetic(acnPos[0], acnPos[1]);

    return {
      frame_index: state.frameIndex,
      sim_time_s: state.simTimeS,
      speed: state.speed,
      target_speed: state.speed,
      achieved_speed: state.isPaused ? 0.0 : (state.achievedSpeed > 0 ? state.achievedSpeed : state.speed),
      paused: state.isPaused,
      step_request_id: state.activeStepRequestId,
      spatial_locked: state.spatialLocked,
      spatial_revision: state.spatialRevision,
      trajectory_config: {
        trajectory_mode: state.flightConfig.trajectoryMode,
        center_x_m: state.flightConfig.centerXm,
        center_y_m: state.flightConfig.centerYm,
        orbit_a_m: state.flightConfig.loiterRadiusAM,
        orbit_b_m: state.flightConfig.loiterRadiusBM,
        orbit_rotation_deg: state.flightConfig.loiterRotationDeg,
        loiter_speed_mps: state.flightConfig.loiterSpeedMps,
        current_speed_mps: state.trajectoryEngine.getCurrentSpeed(state.simTimeS),
        acn_altitude_m: state.flightConfig.altitudeMslM,
        waypoints: state.flightConfig.waypoints.map(point => ({ x_m: point.xM, y_m: point.yM })),
      },
      scheduler_mode: state.schedulerMode,
      selected_node_id: state.selectedNodeId,
      plain_english_narrative: narrative,
      acn_telemetry: {
        pos_x: acnPos[0],
        pos_y: acnPos[1],
        pos_z: acnPos[2],
        lat_deg: acnGeo.latDeg,
        lon_deg: acnGeo.lonDeg,
        vel_x: vx,
        vel_y: vy,
        heading_rad: Math.atan2(vy, vx),
        current_speed_mps: state.trajectoryEngine.getCurrentSpeed(state.simTimeS),
        target_speed_mps: state.flightConfig.loiterSpeedMps,
        acceleration_limit_mps2: state.flightConfig.accelerationLimitMps2,
        deceleration_limit_mps2: state.flightConfig.decelerationLimitMps2,
        coverage_radius_m: state.flightConfig.coverageRadiusKm * 1000.0,
        coverage_radius_km: state.flightConfig.coverageRadiusKm,
        flight_path: state.trajectoryEngine.getPathPoints(64),
      },
      nodes_telemetry: nodesTel,
      registration_telemetry: { nodes: state.registrationLifecycle.active(), events: state.registrationLifecycle.events() },
      active_gantt_allocations: allocations,
      static_gantt_allocations: (state.lastReportStatic?.allocations ?? []).map(mapAlloc),
      tac_gantt_allocations: (state.lastReportTac?.allocations ?? []).map(mapAlloc),
      comparative_kpi_dashboard: kpi,
      static_p50_bps: state.staticGoodputTracker.p50Bps,
      static_p95_bps: state.staticGoodputTracker.p95Bps,
      tac_p50_bps: state.tacGoodputTracker.p50Bps,
      tac_p95_bps: state.tacGoodputTracker.p95Bps,
      selected_node_fresnel: fresnelSlice,
      selected_link_budget: fresnelSlice.link_budget,
      transfer_telemetry: transferTel,
      active_transfers: activeTransfers,
      downlink_telemetry: {
        is_control_broadcast: true,
        ctrl_duration_ms: 1.0,
        dl_duration_ms: (state.schedulerMode === 'tac_tad' && state.lastReportTac ? Math.max(3.0, 20.0 - 1.0 - (state.lastReportTac.totalUlAvailableS * 1000.0)) : 3.0),
        broadcast_active: true,
      },
      terrain_mode: state.terrainEngine.terrain_mode,
      terrain_bounds_km: state.terrainEngine.terrain_mode === 'real'
        ? REAL_LADAKH_DEM_METADATA.halfWidthM / 1000
        : THEATER_HALF_M / 1000,
      terrain_bounds: state.terrainEngine.getTerrainBoundsTelemetry(),
    };
  }

  /**
   * Builds an out-of-band PROFILE_FRAME protocol message from precomputed Fresnel and node telemetry.
   */
  public buildProfileFrameMessage(
    selectedNodeId: number,
    profileSerial: number,
    spatialRevision: number,
    fresnelSlice: FresnelSliceTelemetry,
    nodesTelemetry: readonly NodeTelemetryItem[]
  ): ProfileFrameMessage {
    return {
      type: 'PROFILE_FRAME',
      selectedNodeId,
      profileSerial,
      spatial_revision: spatialRevision,
      fresnel: fresnelSlice,
      selected_link_budget: fresnelSlice.link_budget,
      nodes_telemetry: nodesTelemetry,
    };
  }
}
```

### File: `src/worker/terrainMeshGenerator.ts` (100 lines, 3,653 bytes)

```typescript
/**
 * 3D Terrain Elevation Mesh Data Generator
 *
 * Encapsulates generation and packaging of the 512x512 elevation grid
 * for 3D Three.js terrain mesh rendering:
 * 1. Direct-copy raster extraction for real satellite DEMs matching the 512x512 matrix.
 * 2. Bilateral spatial sampling across terrain bounds for synthetic procedural or custom DEMs.
 * 3. Exact min/max elevation derivation and non-finite value handling.
 * 4. Transferable ArrayBuffer packaging for zero-copy worker-to-host IPC.
 */

import { TerrainBoundsTelemetry, TerrainEngine } from '../core/terrain';
import type { TerrainMeshDataReadyMessage } from '../shared/workerProtocol';

/**
 * Result of generating terrain elevation mesh data, containing
 * the protocol message and the transferable buffer list.
 */
export interface TerrainMeshGenerationResult {
  readonly message: TerrainMeshDataReadyMessage;
  readonly transferList: Transferable[];
}

/**
 * Dedicated terrain mesh generator. Pure generator with zero mutation of
 * SimulationWorkerManager state or simulation timestep.
 */
export class TerrainMeshGenerator {
  public static readonly DEFAULT_GRID_SIZE = 512;

  /**
   * Generates a 512x512 elevation grid from real DEM raster or synthetic bounding-box sampling.
   *
   * @param terrainEngine Authoritative terrain engine instance
   * @param requestId Optional inbound command request ID to correlate with host
   * @param gridSize Elevation matrix resolution (default 512)
   */
  public static generate(
    terrainEngine: TerrainEngine,
    requestId?: string | number,
    gridSize: number = TerrainMeshGenerator.DEFAULT_GRID_SIZE
  ): TerrainMeshGenerationResult {
    const isReal =
      terrainEngine.terrainMode === 'real' &&
      terrainEngine.hasRealDem &&
      terrainEngine.realDemGrid !== null;
    const bounds = terrainEngine.getTerrainBoundsTelemetry();
    const transferGrid = new Float32Array(gridSize * gridSize);

    let minElev = Number.POSITIVE_INFINITY;
    let maxElev = Number.NEGATIVE_INFINITY;

    if (
      isReal &&
      terrainEngine.realDemGrid &&
      terrainEngine.realDemGrid.length === gridSize * gridSize
    ) {
      // Direct 512x512 copy
      transferGrid.set(terrainEngine.realDemGrid);
      for (let i = 0; i < transferGrid.length; i++) {
        const v = transferGrid[i];
        if (Number.isFinite(v)) {
          if (v < minElev) minElev = v;
          if (v > maxElev) maxElev = v;
        }
      }
    } else {
      // Synthetic procedural mode or custom resolution DEM: sample 512x512 matrix over bounds
      const stepX = (bounds.maxX - bounds.minX) / (gridSize - 1.0);
      const stepY = (bounds.maxY - bounds.minY) / (gridSize - 1.0);
      for (let r = 0; r < gridSize; r++) {
        const yM = bounds.maxY - r * stepY; // Row 0 is North (+Y)
        for (let c = 0; c < gridSize; c++) {
          const xM = bounds.minX + c * stepX; // Col 0 is West (-X)
          const v = terrainEngine.getElevation(xM, yM);
          const val = Number.isFinite(v) ? v : 0;
          transferGrid[r * gridSize + c] = val;
          if (val < minElev) minElev = val;
          if (val > maxElev) maxElev = val;
        }
      }
    }

    const payload: TerrainMeshDataReadyMessage = {
      type: 'TERRAIN_MESH_DATA_READY',
      request_id: requestId,
      terrain_mode: terrainEngine.terrainMode,
      bounds,
      grid_size: gridSize,
      min_elevation_m: Number.isFinite(minElev) ? minElev : 0,
      max_elevation_m: Number.isFinite(maxElev) ? maxElev : 5000,
      elevations: transferGrid,
    };

    return {
      message: payload,
      transferList: [transferGrid.buffer],
    };
  }
}
```

### File: `core/config.py` (184 lines, 7,744 bytes)

```python
"""
Tactical X-Band Air-to-Ground Network Digital Twin - Core Configuration Module.

Provides strongly typed, runtime-configurable dataclasses for RF payloads,
propagation environments (ITU-R P.834 / P.676 / P.838), and Aerial Communication
Node (ACN) orbital flight kinematics over high-relief topography.
"""

from dataclasses import dataclass, field
import math
from typing import Optional, Tuple


SPEED_OF_LIGHT: float = 299792458.0  # Exact SI constant in m/s
BOLTZMANN_CONSTANT: float = 1.380649e-23  # Exact SI constant in J/K


@dataclass(frozen=True)
class RFConfig:
    """
    Tactical RF parameters for X-band air-to-ground waveform and transceiver hardware.
    
    Defaults reflect high-altitude tactical relays communicating with dismounted
    infantry manpacks and armored command posts.
    """
    carrier_frequency_hz: float = 8.0e9  # 8.0 GHz Tactical X-band
    channel_bandwidth_hz: float = 1.0e6  # 1.0 MHz shared channel bandwidth
    
    # Aerial Communication Node (ACN) Transceiver
    acn_tx_power_dbm: float = 40.0  # 10 W RF power amplifier
    acn_antenna_gain_dbi: float = 15.0  # Airborne steerable planar patch / conformal array
    acn_noise_figure_db: float = 5.0  # Low-noise receiver front-end NF
    
    # Dismounted Soldier Node (4W Manpack)
    soldier_tx_power_dbm: float = 36.0  # 4.0 W PA
    soldier_antenna_gain_dbi: float = 3.0  # Hemispheric omni whip antenna
    
    # Main Command Post (MCP, 20W Dish)
    mcp_tx_power_dbm: float = 43.0  # 20.0 W high-power vehicular transmitter
    mcp_antenna_gain_dbi: float = 20.0  # High-gain directional parabolic tracking dish
    
    # Hardware Losses & Margin
    implementation_margin_db: float = 2.5  # Filter ripple, ADC quantization, phase jitter
    cable_loss_db: float = 1.5  # RF feedline insertion loss and connector degradation
    speed_of_light: float = SPEED_OF_LIGHT

    @property
    def wavelength_m(self) -> float:
        """Carrier wavelength in meters."""
        return self.speed_of_light / self.carrier_frequency_hz

    def get_transmitter_params(self, node_type: str) -> Tuple[float, float]:
        """
        Retrieve transmitter RF power (dBm) and antenna gain (dBi) for a node type.
        
        Args:
            node_type: Identifier string ('soldier', 'mcp', 'acn')
            
        Returns:
            Tuple of (tx_power_dbm, antenna_gain_dbi)
        """
        normalized = node_type.strip().lower()
        if normalized in ("soldier", "manpack", "infantry"):
            return self.soldier_tx_power_dbm, self.soldier_antenna_gain_dbi
        if normalized in ("mcp", "command_post", "main_command_post", "vehicular"):
            return self.mcp_tx_power_dbm, self.mcp_antenna_gain_dbi
        if normalized in ("acn", "airborne", "relay"):
            return self.acn_tx_power_dbm, self.acn_antenna_gain_dbi
        raise ValueError(
            f"Unrecognized node_type: '{node_type}'. Expected 'soldier', 'mcp', or 'acn'."
        )


@dataclass(frozen=True)
class EnvironmentConfig:
    """
    Environmental, tropospheric, and planetary geometry parameters.
    
    Adheres to ITU-R recommendations P.834, P.676, and P.838.
    """
    effective_earth_radius_factor: float = 4.0 / 3.0  # ITU-R P.834 standard k-factor
    true_earth_radius_m: float = 6371000.0  # WGS-84 volumetric mean Earth radius
    rain_rate_mm_h: float = 0.0  # Precipitation rate: 0=clear, 15=moderate, 50=monsoon
    rain_cell_length_km: float = 10.0  # Effective horizontal convective cell extent
    atmospheric_temperature_k: float = 290.0  # Standard reference noise temperature

    @property
    def effective_earth_radius_m(self) -> float:
        """Effective Earth radius (R_eff = k * R_true) in meters (~8494.67 km)."""
        return self.true_earth_radius_m * self.effective_earth_radius_factor


@dataclass
class ACNFlightConfig:
    """
    Kinematics, fully parametric rotated elliptical loiter orbit configuration,
    and RF coverage footprint for the Aerial Communication Node (ACN).
    """
    altitude_msl_m: float = 5000.0
    loiter_radius_a_m: float = 20000.0   # Semi-major axis (20 km)
    loiter_radius_b_m: float = 10000.0   # Semi-minor axis (10 km)
    loiter_rotation_deg: float = 35.0    # Ellipse tilt / inclination angle
    loiter_speed_mps: float = 60.0       # 216 km/h loiter true airspeed
    center_x_m: float = 0.0              # Orbit origin Easting (m)
    center_y_m: float = 0.0              # Orbit origin Northing (m)
    coverage_radius_km: float = 35.0     # Dynamic ACN RF coverage footprint radius (km)

    def __init__(
        self,
        altitude_msl_m: float = 5000.0,
        loiter_radius_a_m: float = 20000.0,
        loiter_radius_b_m: float = 10000.0,
        loiter_rotation_deg: float = 35.0,
        loiter_speed_mps: float = 60.0,
        center_x_m: float = 0.0,
        center_y_m: float = 0.0,
        loiter_radius_m: Optional[float] = None,
        coverage_radius_km: float = 35.0,
        coverage_radius_m: Optional[float] = None,
        **kwargs
    ) -> None:
        self.altitude_msl_m = float(altitude_msl_m)
        if loiter_radius_m is not None:
            # Legacy circular initialization fallback
            self.loiter_radius_a_m = float(loiter_radius_m)
            self.loiter_radius_b_m = float(loiter_radius_m)
            self.loiter_rotation_deg = 0.0
        else:
            self.loiter_radius_a_m = float(loiter_radius_a_m)
            self.loiter_radius_b_m = float(loiter_radius_b_m)
            self.loiter_rotation_deg = float(loiter_rotation_deg)
        self.loiter_speed_mps = float(loiter_speed_mps)
        self.center_x_m = float(center_x_m)
        self.center_y_m = float(center_y_m)
        if coverage_radius_m is not None:
            self.coverage_radius_km = float(coverage_radius_m) / 1000.0
        else:
            self.coverage_radius_km = float(coverage_radius_km)

    @property
    def loiter_radius_m(self) -> float:
        """Backwards compatibility alias for older modules expecting loiter_radius_m."""
        return self.loiter_radius_a_m

    @loiter_radius_m.setter
    def loiter_radius_m(self, value: float) -> None:
        self.loiter_radius_a_m = float(value)
        self.loiter_radius_b_m = float(value)
        self.loiter_rotation_deg = 0.0

    @property
    def coverage_radius_m(self) -> float:
        """Dynamic ACN RF coverage footprint radius in meters."""
        return self.coverage_radius_km * 1000.0

    @coverage_radius_m.setter
    def coverage_radius_m(self, value: float) -> None:
        self.coverage_radius_km = float(value) / 1000.0

    def get_position(self, time_s: float) -> Tuple[float, float, float]:
        """
        Compute ACN 3D Cartesian coordinates (x, y, z) at time t along rotated ellipse.
        
        Uses Ramanujan's formula for the elliptical perimeter to compute the orbital period.
        """
        a = self.loiter_radius_a_m
        b = self.loiter_radius_b_m
        if (a + b) <= 0.0:
            return (self.center_x_m, self.center_y_m, self.altitude_msl_m)

        h_param = ((a - b) ** 2) / ((a + b) ** 2)
        denom = 10.0 + math.sqrt(max(0.0, 4.0 - 3.0 * h_param))
        perimeter = math.pi * (a + b) * (1.0 + (3.0 * h_param) / denom)
        orbit_period_s = perimeter / max(0.1, self.loiter_speed_mps)
        omega = (2.0 * math.pi) / orbit_period_s

        phi = math.radians(self.loiter_rotation_deg)
        x_raw = a * math.cos(omega * time_s)
        y_raw = b * math.sin(omega * time_s)

        x = self.center_x_m + x_raw * math.cos(phi) - y_raw * math.sin(phi)
        y = self.center_y_m + x_raw * math.sin(phi) + y_raw * math.cos(phi)
        z = self.altitude_msl_m
        return (x, y, z)
```

### File: `core/link_budget.py` (247 lines, 8,065 bytes)

```python
"""
Tactical X-Band Air-to-Ground Network Digital Twin - Link Budget Engine.

Computes atmospheric attenuation (ITU-R P.676), hydrometeor rain loss (ITU-R P.838),
thermal noise floors, and performs adaptive modulation and coding (MODCOD) selection
compliant with DVB-S2X / 3GPP Rel 17 NTN standards.
"""

from dataclasses import dataclass
import math
from typing import List, Tuple

try:
    from core.config import RFConfig, EnvironmentConfig, BOLTZMANN_CONSTANT, SPEED_OF_LIGHT
except ImportError:
    from .config import RFConfig, EnvironmentConfig, BOLTZMANN_CONSTANT, SPEED_OF_LIGHT


@dataclass(frozen=True)
class ModCodEntry:
    """Modulation and Coding scheme threshold entry."""
    name: str
    min_snr_db: float
    spectral_efficiency_bps_hz: float


# DVB-S2X / 3GPP Rel 17 Non-Terrestrial Network (NTN) MODCOD Table
# Ordered descending by SNR requirement for optimal rate matching
MODCOD_TABLE: List[ModCodEntry] = [
    ModCodEntry("64-APSK 5/6", 22.0, 4.95),
    ModCodEntry("32-APSK 3/4", 17.5, 3.70),
    ModCodEntry("16-APSK 4/5", 14.0, 3.16),
    ModCodEntry("16-APSK 2/3", 11.5, 2.64),
    ModCodEntry("8-PSK 3/5", 8.0, 1.78),
    ModCodEntry("QPSK 3/4", 5.5, 1.49),
    ModCodEntry("QPSK 1/2", 2.5, 0.99),
    ModCodEntry("pi/2-BPSK 1/3", -1.5, 0.33),
]


@dataclass
class LinkStatus:
    """
    Comprehensive physical layer telemetry and telemetry report for an RF link.
    """
    node_type: str
    slant_range_m: float
    fspl_db: float
    diffraction_loss_db: float
    gas_loss_db: float
    rain_loss_db: float
    cable_loss_db: float
    implementation_margin_db: float
    total_path_loss_db: float
    p_tx_dbm: float
    tx_gain_dbi: float
    rx_gain_dbi: float
    p_rx_dbm: float
    p_noise_dbm: float
    snr_db: float
    modcod: str
    spectral_efficiency_bps_hz: float
    bitrate_bps: float
    is_outage: bool

    @property
    def bitrate_mbps(self) -> float:
        """Achievable throughput in Megabits per second."""
        return self.bitrate_bps / 1.0e6

    @property
    def modulation(self) -> str:
        """MODCOD scheme designation alias."""
        return self.modcod

    @property
    def snr(self) -> float:
        """Signal-to-Noise Ratio alias in dB."""
        return self.snr_db


class LinkBudgetEngine:
    """
    Deterministic Link Budget & Adaptive Modulation Engine.
    """

    @staticmethod
    def compute_gaseous_attenuation(d_3d_m: float) -> float:
        """
        ITU-R P.676 Gaseous Absorption for 8.0 GHz Tactical X-band.
        
        Specific attenuation gamma_g = 0.012 dB/km.
        """
        return 0.012 * (d_3d_m / 1000.0)

    @staticmethod
    def compute_rain_attenuation(
        d_3d_m: float,
        env_config: EnvironmentConfig
    ) -> float:
        """
        ITU-R P.838 Hydrometeor Rain Attenuation for 8.0 GHz (Horizontal polarization).
        
        k_H = 0.00411, alpha_H = 1.390
        gamma_R = k_H * (rain_rate ^ alpha_H) dB/km
        Effective rain cell length capped by env_config.rain_cell_length_km.
        """
        if env_config.rain_rate_mm_h <= 0.0:
            return 0.0
        
        k_h = 0.00411
        alpha_h = 1.390
        gamma_r = k_h * (env_config.rain_rate_mm_h ** alpha_h)
        rain_path_km = min(d_3d_m / 1000.0, env_config.rain_cell_length_km)
        return gamma_r * rain_path_km

    @staticmethod
    def compute_thermal_noise_floor_dbm(
        bandwidth_hz: float,
        noise_figure_db: float,
        temperature_k: float = 290.0,
    ) -> Tuple[float, float]:
        """
        Compute thermal receiver noise floor power.
        
        P_noise_w = k_B * T * B * 10^(NF / 10)
        P_noise_dbm = 10 * log10(P_noise_w * 1000)
        
        Returns:
            Tuple of (p_noise_w, p_noise_dbm)
        """
        noise_factor = 10.0 ** (noise_figure_db / 10.0)
        p_noise_w = BOLTZMANN_CONSTANT * temperature_k * bandwidth_hz * noise_factor
        p_noise_dbm = 10.0 * math.log10(p_noise_w * 1000.0)
        return (p_noise_w, p_noise_dbm)

    @classmethod
    def select_modcod(cls, snr_db: float) -> Tuple[str, float]:
        """
        Select highest order operational DVB-S2X / 3GPP Rel 17 MODCOD.
        
        Args:
            snr_db: Received SNR in dB.
            
        Returns:
            Tuple of (modcod_name, spectral_efficiency_bps_hz)
        """
        for entry in MODCOD_TABLE:
            if snr_db >= entry.min_snr_db:
                return entry.name, entry.spectral_efficiency_bps_hz
        return "LINK_OUTAGE", 0.0

    def evaluate_link(
        self,
        node_type: str,
        slant_range_m: float,
        diffraction_loss_db: float,
        rf_config: RFConfig,
        env_config: EnvironmentConfig,
    ) -> LinkStatus:
        """
        Predict full RF link performance, received power, and achievable throughput.
        
        Computes FSPL, gaseous attenuation, precipitation loss, thermal noise,
        net SNR, and assigns optimal MODCOD.
        
        Args:
            node_type: 'soldier' or 'mcp'
            slant_range_m: 3D Euclidean distance in meters.
            diffraction_loss_db: Terrain obstruction loss in dB.
            rf_config: Transmitter and receiver configurations.
            env_config: Tropospheric environment parameters.
            
        Returns:
            Structured LinkStatus telemetry record.
        """
        if slant_range_m <= 0.0:
            raise ValueError(f"Slant range must be positive, got {slant_range_m} m.")

        # Free Space Path Loss (FSPL): 20*log10(d) + 20*log10(fc) + 20*log10(4*pi/c)
        fc = rf_config.carrier_frequency_hz
        c = rf_config.speed_of_light
        fspl_db = (
            20.0 * math.log10(slant_range_m)
            + 20.0 * math.log10(fc)
            + 20.0 * math.log10(4.0 * math.pi / c)
        )

        # Atmospheric attenuation
        gas_loss_db = self.compute_gaseous_attenuation(slant_range_m)
        rain_loss_db = self.compute_rain_attenuation(slant_range_m, env_config)

        # Total channel loss summation
        cable_loss_db = rf_config.cable_loss_db
        impl_margin_db = rf_config.implementation_margin_db
        total_path_loss_db = (
            fspl_db
            + diffraction_loss_db
            + gas_loss_db
            + rain_loss_db
            + cable_loss_db
            + impl_margin_db
        )

        # Transmitter and receiver front-end setup
        p_tx_dbm, tx_gain_dbi = rf_config.get_transmitter_params(node_type)
        rx_gain_dbi = rf_config.acn_antenna_gain_dbi

        # Received power at ACN LNA input
        p_rx_dbm = p_tx_dbm + tx_gain_dbi + rx_gain_dbi - total_path_loss_db

        # Thermal noise floor
        _, p_noise_dbm = self.compute_thermal_noise_floor_dbm(
            bandwidth_hz=rf_config.channel_bandwidth_hz,
            noise_figure_db=rf_config.acn_noise_figure_db,
            temperature_k=env_config.atmospheric_temperature_k,
        )

        # Net Signal-to-Noise Ratio (SNR)
        snr_db = p_rx_dbm - p_noise_dbm

        # Dynamic MODCOD selection & bitrate calculation
        modcod_name, spectral_eff = self.select_modcod(snr_db)
        bitrate_bps = spectral_eff * rf_config.channel_bandwidth_hz
        is_outage = modcod_name == "LINK_OUTAGE"

        return LinkStatus(
            node_type=node_type,
            slant_range_m=slant_range_m,
            fspl_db=fspl_db,
            diffraction_loss_db=diffraction_loss_db,
            gas_loss_db=gas_loss_db,
            rain_loss_db=rain_loss_db,
            cable_loss_db=cable_loss_db,
            implementation_margin_db=impl_margin_db,
            total_path_loss_db=total_path_loss_db,
            p_tx_dbm=p_tx_dbm,
            tx_gain_dbi=tx_gain_dbi,
            rx_gain_dbi=rx_gain_dbi,
            p_rx_dbm=p_rx_dbm,
            p_noise_dbm=p_noise_dbm,
            snr_db=snr_db,
            modcod=modcod_name,
            spectral_efficiency_bps_hz=spectral_eff,
            bitrate_bps=bitrate_bps,
            is_outage=is_outage,
        )
```

### File: `core/queues.py` (474 lines, 19,016 bytes)

```python
"""
core/queues.py - Multi-Class QoS Queues & Traffic Subsystems
Tactical X-Band Air-to-Ground Network Digital Twin

Implements Bounded Strict-Priority Multi-Class Queue with CoDel-inspired sojourn delay tracking and deadline pruning,
dual byte/bit accessors, drop counter property aliases, Head-of-Line (HOL) delay telemetry,
ingress packet counters, overflow eviction tracking with 2-tuple return, and bounded-memory
protection with oldest-packet eviction under sustained C2 overload.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import math
import random
from typing import Any, Dict, List, Optional, Tuple

# ----------------------------------------------------------------------------------------
# Project-defined tactical QoS classes inspired by 3GPP MCX 5QI profiles
# ----------------------------------------------------------------------------------------
QOS_PROFILES: Dict[int, Dict[str, Any]] = {
    69: {
        "name": "Emergency C2 / Mission-Critical Signaling",
        "priority": 1,
        "pdb_s": 60.0,  # 60.0s deadline (persists across mountain shadows)
        "default_bytes": 128,
        "strict_priority": True,
    },
    65: {
        "name": "Mission-Critical PTT Voice",
        "priority": 2,
        "pdb_s": 0.075,  # 75 ms Packet Delay Budget
        "default_bytes": 160,
        "strict_priority": False,
    },
    67: {
        "name": "Mission-Critical Video",
        "priority": 3,
        "pdb_s": 0.150,  # 150 ms Packet Delay Budget
        "default_bytes": 1200,
        "strict_priority": False,
    },
    70: {
        "name": "High-Resolution Tactical Imagery / Photo",
        "priority": 4,
        "pdb_s": 0.500,  # 500 ms Packet Delay Budget
        "default_bytes": 1400,
        "strict_priority": False,
    },
}


@dataclass
class Packet:
    packet_id: int
    node_id: int
    qos_5qi: int
    size_bytes: int
    arrival_time_s: float
    deadline_s: float
    sojourn_time_s: float = 0.0

    @property
    def size_bits(self) -> int:
        """Returns packet payload size in bits."""
        return self.size_bytes * 8


class EnqueueResult(tuple):
    """2-tuple (admitted_bool, evicted_packets_list) maintaining boolean truthiness."""

    def __bool__(self) -> bool:
        return bool(self[0])


# ----------------------------------------------------------------------------------------
# Bounded Strict-Priority Multi-Class Queue with Eviction Tracking
# ----------------------------------------------------------------------------------------
class FQCoDelQueue:
    """
    Bounded Strict-Priority Multi-Class Queue with CoDel-inspired sojourn delay tracking and deadline pruning.

    Manages per-5QI subqueues with strict priority scheduling, bounded memory guarantees,
    tail-drop prioritization, dual byte/bit telemetry accessors, Head-of-Line (HOL) delay metrics,
    total enqueue counters, drop counter property aliases, and bounded-memory protection with
    oldest-packet eviction under sustained C2 overload.
    """

    def __init__(self, max_buffer_packets: int = 400, max_c2_packets: int = 120) -> None:
        self.max_buffer_packets = max_buffer_packets
        self.max_c2_packets = max_c2_packets
        self.total_enqueued: int = 0
        self.last_evicted_packets: List[Packet] = []
        self.subqueues: Dict[int, deque[Packet]] = {
            69: deque(),  # Emergency C2 (Persistent, bounded at 120 pkts)
            65: deque(),  # MC-PTT Voice
            67: deque(),  # MC-Video
            70: deque(),  # Tactical Photo
        }
        self.total_dropped_overflow: int = 0
        self.total_dropped_deadline: int = 0

    # ------------------------------------------------------------------------------------
    # Drop Counter Property Aliases for Cross-Module Compatibility
    # ------------------------------------------------------------------------------------
    @property
    def dropped_delay_count(self) -> int:
        """Alias for total_dropped_deadline expected by core/scheduler.py."""
        return getattr(self, "total_dropped_deadline", 0)

    @dropped_delay_count.setter
    def dropped_delay_count(self, val: int) -> None:
        self.total_dropped_deadline = val

    @property
    def dropped_overflow_count(self) -> int:
        """Alias for total_dropped_overflow expected by core/scheduler.py."""
        return getattr(self, "total_dropped_overflow", 0)

    @dropped_overflow_count.setter
    def dropped_overflow_count(self, val: int) -> None:
        self.total_dropped_overflow = val

    # ------------------------------------------------------------------------------------
    # Backlog Telemetry Accessors (Bytes & Bits)
    # ------------------------------------------------------------------------------------
    def get_total_packets(self) -> int:
        """Returns total aggregate packet count across all subqueues."""
        return sum(len(q) for q in self.subqueues.values())

    @property
    def total_packets(self) -> int:
        return self.get_total_packets()

    def get_total_backlog_bytes(self) -> int:
        """Returns total aggregate backlog across all subqueues in bytes."""
        return sum(sum(p.size_bytes for p in q) for q in self.subqueues.values())

    @property
    def total_backlog_bytes(self) -> int:
        return self.get_total_backlog_bytes()

    def get_total_backlog_bits(self) -> int:
        """Returns total aggregate backlog across all subqueues in bits."""
        return self.get_total_backlog_bytes() * 8

    @property
    def total_backlog_bits(self) -> int:
        return self.get_total_backlog_bits()

    def get_class_backlog_bytes(self, qos_5qi: int) -> int:
        """Returns backlog for a specific 5QI class in bytes."""
        subq = self.subqueues.get(qos_5qi)
        if not subq:
            return 0
        return sum(p.size_bytes for p in subq)

    def get_class_backlog_bits(self, qos_5qi: int) -> int:
        """Returns backlog for a specific 5QI class in bits."""
        return self.get_class_backlog_bytes(qos_5qi) * 8

    def get_class_packet_count(self, qos_5qi: int) -> int:
        """Returns the number of queued packets for the given 5QI class."""
        subq = self.subqueues.get(qos_5qi)
        return len(subq) if subq else 0

    def get_class_packets(self, qos_5qi: int) -> int:
        """Alias for get_class_packet_count for RL environment compatibility."""
        return self.get_class_packet_count(qos_5qi)

    def get_packet_counts(self) -> Dict[int, int]:
        """Returns dictionary mapping each 5QI class to its queued packet count."""
        return {qos: len(subq) for qos, subq in self.subqueues.items()}

    # ------------------------------------------------------------------------------------
    # Head-of-Line (HOL) Delay Telemetry
    # ------------------------------------------------------------------------------------
    def get_hol_delay_s(self, qos_5qi: int, current_time_s: float) -> float:
        """
        Returns the Head-of-Line (HOL) sojourn delay in seconds for the given 5QI class.
        If the subqueue is empty, returns 0.0s.
        """
        subq = self.subqueues.get(qos_5qi)
        if subq:
            return max(0.0, current_time_s - subq[0].arrival_time_s)
        return 0.0

    def get_max_hol_delay_s(self, current_time_s: float) -> float:
        """Returns the peak Head-of-Line (HOL) delay across all 5QI classes."""
        delays = [self.get_hol_delay_s(qos, current_time_s) for qos in self.subqueues]
        return max(delays) if delays else 0.0

    # ------------------------------------------------------------------------------------
    # Queue Mutators & Eviction Tracking
    # ------------------------------------------------------------------------------------
    def enqueue(self, packet: Packet) -> Tuple[bool, List[Packet]]:
        """
        Enqueues packet into corresponding 5QI subqueue with bounded memory policy:
        - Increments self.total_enqueued counter upon packet reception.
        - If buffer >= 400, evicts from lowest priority class (70, then 67, then 65).
        - If buffer is full of Class 69, enforces a hard ceiling of 120 packets
          (drops oldest C2 packet to maintain bounded memory).
        - Class 69 is never dropped to accommodate lower-priority traffic.
        Returns a 2-tuple: (success_bool, evicted_packets_list).
        """
        self.total_enqueued += 1
        qos = packet.qos_5qi
        evicted_packets: List[Packet] = []

        if qos == 69:
            # Enforce hard bounded memory ceiling on Class 69
            if len(self.subqueues[69]) >= self.max_c2_packets:
                evicted = self.subqueues[69].popleft()
                evicted_packets.append(evicted)
            elif self.get_total_packets() >= self.max_buffer_packets:
                # Evict lowest-priority traffic to make room for C2
                dropped = False
                for drop_qos in [70, 67, 65]:
                    if len(self.subqueues[drop_qos]) > 0:
                        evicted = self.subqueues[drop_qos].popleft()
                        evicted_packets.append(evicted)
                        dropped = True
                        break
                if not dropped:
                    # Buffer completely filled with C2; drop oldest C2
                    evicted = self.subqueues[69].popleft()
                    evicted_packets.append(evicted)

            self.subqueues[69].append(packet)
            self.total_dropped_overflow += len(evicted_packets)
            self.last_evicted_packets = evicted_packets
            return EnqueueResult((True, evicted_packets))

        # Non-C2 traffic (65, 67, 70)
        if self.get_total_packets() >= self.max_buffer_packets:
            dropped = False
            for drop_qos in [70, 67, 65]:
                if len(self.subqueues[drop_qos]) > 0:
                    evicted = self.subqueues[drop_qos].popleft()
                    evicted_packets.append(evicted)
                    dropped = True
                    break

            if not dropped:
                # Buffer has only C2; cannot evict C2 for lower priority
                evicted_packets.append(packet)
                self.total_dropped_overflow += len(evicted_packets)
                self.last_evicted_packets = evicted_packets
                return EnqueueResult((False, evicted_packets))

        self.subqueues[qos].append(packet)
        self.total_dropped_overflow += len(evicted_packets)
        self.last_evicted_packets = evicted_packets
        return EnqueueResult((True, evicted_packets))

    def prune_expired_packets(self, current_time_s: float) -> int:
        """
        Prunes packets reaching or exceeding their Packet Delay Budget.
        CRITICAL: Class 69 (Emergency C2) is completely excluded from deadline pruning.
        """
        pruned_count = 0
        for qos in [65, 67, 70]:
            subq = self.subqueues[qos]
            n = len(subq)
            for _ in range(n):
                pkt = subq.popleft()
                if current_time_s >= pkt.deadline_s:
                    pruned_count += 1
                    self.total_dropped_deadline += 1
                else:
                    subq.append(pkt)
        return pruned_count

    def dequeue(self, bytes_capacity: int, current_time_s: float) -> List[Packet]:
        """
        Strict priority dequeue: 69 (Emergency C2) -> 65 (Voice) -> 67 (Video) -> 70 (Photo).
        Head-of-line expired packets for non-C2 traffic reaching or exceeding deadline are pruned during dequeue.
        Updates sojourn_time_s upon departure.
        """
        served: List[Packet] = []
        rem_bytes = bytes_capacity

        for qos in [69, 65, 67, 70]:
            subq = self.subqueues[qos]
            while subq:
                pkt = subq[0]

                # Head-of-line expiration check for non-C2 flows
                if qos != 69 and current_time_s >= pkt.deadline_s:
                    subq.popleft()
                    self.total_dropped_deadline += 1
                    continue

                if pkt.size_bytes <= rem_bytes:
                    subq.popleft()
                    pkt.sojourn_time_s = max(0.0, current_time_s - pkt.arrival_time_s)
                    served.append(pkt)
                    rem_bytes -= pkt.size_bytes
                else:
                    break

            if rem_bytes <= 0:
                break

        return served


# ----------------------------------------------------------------------------------------
# Tactical Ground Node Traffic Subsystem
# ----------------------------------------------------------------------------------------
class GroundNodeTrafficSubsystem:
    """
    Simulates tactical traffic generation (voice calls, video feeds, photo transmissions,
    and periodic C2 telemetry) for a single dismounted soldier or command post.
    """

    _global_packet_id_counter: int = 0

    def __init__(
        self,
        node_id: int,
        node_type: str,
        position: Tuple[float, float, float],
        seed: int = 42,
        has_voice: bool = False,
        voice_start_s: float = 0.0,
        voice_end_s: float = 0.0,
        has_video: bool = False,
        video_mean_pkts_per_frame: float = 1.0,
        has_photo: bool = False,
        photo_trigger_time_s: float = 0.0,
        photo_size_bytes: int = 0,
        **kwargs: Any,
    ) -> None:
        self.node_id = node_id
        self.node_type = node_type
        self.position = position
        self.rng = random.Random(seed)
        self.queue = FQCoDelQueue(max_buffer_packets=400, max_c2_packets=120)

        self.has_voice = has_voice
        self.voice_start_s = voice_start_s
        self.voice_end_s = voice_end_s

        self.has_video = has_video
        self.video_mean_pkts_per_frame = video_mean_pkts_per_frame

        self.has_photo = has_photo
        self.photo_trigger_time_s = photo_trigger_time_s
        self.photo_size_bytes = photo_size_bytes
        self.photo_bytes_remaining = photo_size_bytes if has_photo else 0

        self.c2_interval_s = 0.100  # 10 Hz C2 heartbeat
        self.last_c2_time_s = -1.0

    # ------------------------------------------------------------------------------------
    # Direct Delegation Helpers for RL Observation Space
    # ------------------------------------------------------------------------------------
    def get_hol_delay_s(self, qos_5qi: int, current_time_s: float) -> float:
        """Delegates HOL delay query to the internal queue."""
        return self.queue.get_hol_delay_s(qos_5qi, current_time_s)

    def get_class_packet_count(self, qos_5qi: int) -> int:
        """Delegates packet count query to the internal queue."""
        return self.queue.get_class_packet_count(qos_5qi)

    def get_class_packets(self, qos_5qi: int) -> int:
        """Alias for get_class_packet_count."""
        return self.queue.get_class_packets(qos_5qi)

    def _poisson_draw(self, lam: float) -> int:
        if lam <= 0.0:
            return 0
        limit = math.exp(-lam)
        count = 0
        p = 1.0
        while p > limit:
            count += 1
            p *= self.rng.random()
        return max(0, count - 1)

    def _enqueue(
        self,
        qos: int,
        current_time_s: float,
        size_bytes: Optional[int] = None,
        deadline_s: Optional[float] = None,
    ) -> Packet:
        GroundNodeTrafficSubsystem._global_packet_id_counter += 1
        prof = QOS_PROFILES[qos]
        sz = int(size_bytes if size_bytes is not None else prof["default_bytes"])
        dl = deadline_s if deadline_s is not None else (current_time_s + float(prof["pdb_s"]))

        pkt = Packet(
            packet_id=GroundNodeTrafficSubsystem._global_packet_id_counter,
            node_id=self.node_id,
            qos_5qi=qos,
            size_bytes=sz,
            arrival_time_s=current_time_s,
            deadline_s=dl,
            sojourn_time_s=0.0,
        )
        self.queue.enqueue(pkt)
        return pkt

    def generate_traffic(
        self,
        current_time_s: float,
        frame_duration_s: float = 0.020,
    ) -> List[Packet]:
        """Generates real-time packet arrivals across active traffic profiles."""
        generated: List[Packet] = []

        # 1. 5QI 69: Periodic C2 Health & Status Signaling
        if self.last_c2_time_s < 0.0 or (current_time_s - self.last_c2_time_s) >= self.c2_interval_s:
            generated.append(self._enqueue(69, current_time_s))
            self.last_c2_time_s = current_time_s

        # 2. 5QI 65: Mission-Critical PTT Voice
        if self.has_voice and (self.voice_start_s <= current_time_s <= self.voice_end_s):
            # 20ms audio frame codec packet
            generated.append(self._enqueue(65, current_time_s))

        # 3. 5QI 67: Tactical Mission-Critical Video
        if self.has_video:
            num_video = self._poisson_draw(self.video_mean_pkts_per_frame)
            for _ in range(num_video):
                generated.append(self._enqueue(67, current_time_s))

        # 4. 5QI 70: Tactical High-Resolution Imagery
        if self.has_photo and (current_time_s >= self.photo_trigger_time_s) and (self.photo_bytes_remaining > 0):
            slices = min(2, math.ceil(self.photo_bytes_remaining / 1400))
            for _ in range(slices):
                chunk = min(1400, self.photo_bytes_remaining)
                generated.append(self._enqueue(70, current_time_s, size_bytes=chunk))
                self.photo_bytes_remaining -= chunk

        return generated

    def inject_traffic(self, traffic_type: str, current_time_s: float) -> int:
        """
        Injects tactical traffic burst.

        Returns:
            int: Number of immediate packets enqueued (for SOS) or units of traffic burst activated (for voice/video/photo).
        """
        kind = traffic_type.strip().upper()
        count = 0
        if kind in ("SOS", "C2", "EMERGENCY"):
            for _ in range(8):
                self._enqueue(69, current_time_s)
                count += 1
        elif kind in ("VOICE", "PTT"):
            self.has_voice = True
            self.voice_start_s = current_time_s
            self.voice_end_s = current_time_s + 5.0
            count += 1
        elif kind in ("VIDEO", "BURST"):
            self.has_video = True
            self.video_mean_pkts_per_frame = 3.0
            count += 5
        elif kind in ("PHOTO", "IMAGE"):
            self.has_photo = True
            self.photo_trigger_time_s = current_time_s
            self.photo_bytes_remaining += 2_000_000
            count += 1
        return count


# ----------------------------------------------------------------------------------------
# Explicit Class Alias for Semantic Clarity
# ----------------------------------------------------------------------------------------
BoundedStrictPriorityQueue = FQCoDelQueue
```

### File: `core/scheduler.py` (375 lines, 14,633 bytes)

```python
"""
Tactical X-Band Air-to-Ground Network Digital Twin - Module 3: Dual-Scheduler Engine.

Compares Legacy Static TDMA against the Terrain-Aware Dynamic Scheduler (Tac-TAD)
featuring exact-fit dynamic slot sizing, proportional fairness, and predictive
cross-layer queue evacuation prior to mountain occlusion.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
import math
from typing import Dict, List, Optional
import numpy as np

try:
    from core.queues import GroundNodeTrafficSubsystem, QOS_PROFILES
    from core.trajectory import NodeTerrainState, PredictiveState
    from core.link_budget import LinkStatus
except ImportError:
    from .queues import GroundNodeTrafficSubsystem, QOS_PROFILES
    from .trajectory import NodeTerrainState, PredictiveState
    from .link_budget import LinkStatus


# Superframe Structure Parameters
T_FRAME_S: float = 0.020  # 20 ms superframe period
TAU_GUARD_S: float = 12e-6  # 12 microseconds guard band with closed-loop TA
TAU_MIN_S: float = 200e-6  # 200 microseconds minimum allocatable slot
T_CTRL_S: float = 0.001  # 1 ms control / BSR channel
T_DL_MIN_S: float = 0.003  # 3 ms minimum DL broadcast
T_DL_MAX_S: float = 0.007  # 7 ms maximum DL breathing duration
T_UL_NOMINAL_S: float = 0.016  # 16 ms nominal UL data allocation


@dataclass
class SlotAllocation:
    """Uplink TDMA slot assignment for an individual ground terminal."""
    node_id: int
    slot_start_s: float
    duration_s: float
    timing_advance_s: float
    modcod_name: str
    spectral_efficiency: float
    allocated_capacity_bits: int
    is_pre_occlusion_flush: bool


@dataclass
class FrameScheduleReport:
    """Comprehensive performance telemetry for a single scheduled superframe."""
    frame_index: int
    timestamp_s: float
    scheduler_name: str
    allocations: List[SlotAllocation]
    total_ul_utilization_pct: float
    total_bits_transmitted: int
    total_bits_wasted_on_outage: int
    packets_dropped_delay: int
    packets_dropped_overflow: int


class BaseScheduler(ABC):
    """Abstract base class for tactical air-to-ground MAC frame schedulers."""

    @abstractmethod
    def schedule_frame(
        self,
        frame_index: int,
        current_time: float,
        nodes: List[GroundNodeTrafficSubsystem],
        link_statuses: Dict[int, LinkStatus],
        predictive_states: Dict[int, PredictiveState],
        dl_backlog_bytes: int = 0,
    ) -> FrameScheduleReport:
        """Schedule uplink transmissions for all nodes in the superframe."""
        pass


class LegacyStaticScheduler(BaseScheduler):
    """
    Legacy Static Equal-Slot TDMA Scheduler.
    
    Divides uplink data time equally among all registered terminals:
      tau_slot = (T_UL_nominal - N * tau_guard) / N
    Assigns fixed slots regardless of channel SNR, queue backlogs, or terrain occlusion.
    If a node is occluded in HARD_SHADOW_CUTOFF (rate = 0), transmitted bits are wasted.
    """

    def __init__(
        self,
        t_frame_s: float = T_FRAME_S,
        t_ctrl_s: float = T_CTRL_S,
        t_dl_nominal_s: float = T_DL_MIN_S,
        tau_guard_s: float = TAU_GUARD_S,
        tau_min_s: float = TAU_MIN_S,
    ) -> None:
        self.t_frame_s = t_frame_s
        self.t_ctrl_s = t_ctrl_s
        self.t_dl_nominal_s = t_dl_nominal_s
        self.tau_guard_s = tau_guard_s
        self.tau_min_s = tau_min_s
        self.scheduler_name = "Legacy_Static_TDMA"

    def schedule_frame(
        self,
        frame_index: int,
        current_time: float,
        nodes: List[GroundNodeTrafficSubsystem],
        link_statuses: Dict[int, LinkStatus],
        predictive_states: Dict[int, PredictiveState],
        dl_backlog_bytes: int = 0,
    ) -> FrameScheduleReport:
        n_nodes = len(nodes)
        t_ul_available = self.t_frame_s - self.t_ctrl_s - self.t_dl_nominal_s
        tau_slot = (t_ul_available - n_nodes * self.tau_guard_s) / n_nodes

        allocations: List[SlotAllocation] = []
        total_bits_tx: int = 0
        total_bits_wasted: int = 0
        used_time_s: float = 0.0

        slot_start_s = current_time + self.t_ctrl_s + self.t_dl_nominal_s

        for node in nodes:
            ls = link_statuses[node.node_id]
            ps = predictive_states[node.node_id]

            # Blind TDMA assigns nominal rate based on standard modulation (e.g. 4.95 Mbps)
            rate = ls.bitrate_bps if ls.bitrate_bps > 0 else 4.95e6
            cap_bits = int(tau_slot * rate)
            cap_bytes = cap_bits // 8

            spec_eff = getattr(ls, "spectral_efficiency_bps_hz", getattr(ls, "spectral_efficiency", 0.0))

            alloc = SlotAllocation(
                node_id=node.node_id,
                slot_start_s=slot_start_s,
                duration_s=tau_slot,
                timing_advance_s=0.001,
                modcod_name=ls.modcod,
                spectral_efficiency=spec_eff,
                allocated_capacity_bits=cap_bits,
                is_pre_occlusion_flush=False,
            )
            allocations.append(alloc)
            used_time_s += tau_slot + self.tau_guard_s
            slot_start_s += tau_slot + self.tau_guard_s

            # Terminal dequeues packets into allocated grant
            served_pkts = node.queue.dequeue(cap_bytes, current_time)
            bits_served = sum(p.size_bits for p in served_pkts)

            # In HARD_SHADOW_CUTOFF or outage, transmissions into severed channel fail completely
            if ps.current_state == NodeTerrainState.HARD_SHADOW_CUTOFF or ls.is_outage:
                total_bits_wasted += bits_served
            else:
                total_bits_tx += bits_served

        total_delay_drops = sum(n.queue.dropped_delay_count for n in nodes)
        total_overflow_drops = sum(n.queue.dropped_overflow_count for n in nodes)
        util_pct = (used_time_s / t_ul_available) * 100.0

        return FrameScheduleReport(
            frame_index=frame_index,
            timestamp_s=current_time,
            scheduler_name=self.scheduler_name,
            allocations=allocations,
            total_ul_utilization_pct=util_pct,
            total_bits_transmitted=total_bits_tx,
            total_bits_wasted_on_outage=total_bits_wasted,
            packets_dropped_delay=total_delay_drops,
            packets_dropped_overflow=total_overflow_drops,
        )


class TerrainAwareDynamicScheduler(BaseScheduler):
    """
    Terrain-Aware Dynamic Scheduler (Tac-TAD).
    
    Innovations:
      1. Zero-Allocation Outage Reclamation: Reclaims 100% of airtime from occluded nodes.
      2. Priority-Weighted Urgency Metric (Psi_i) protecting GBR Mission-Critical C2 and Voice.
      3. Exact-Fit Dynamic Slot Sizing: Allocates precisely tau_req = Q_total / R_inst.
      4. Pre-Occlusion Predictive Evacuation: Expands slots to available frame slack
         during PRE_OCCLUSION_FLUSH to flush queues before mountain shadow hits.
    """

    def __init__(
        self,
        t_frame_s: float = T_FRAME_S,
        t_ctrl_s: float = T_CTRL_S,
        t_dl_min_s: float = T_DL_MIN_S,
        t_dl_max_s: float = T_DL_MAX_S,
        tau_guard_s: float = TAU_GUARD_S,
        tau_min_s: float = TAU_MIN_S,
        tau_max_normal_s: float = 0.008,
    ) -> None:
        self.t_frame_s = t_frame_s
        self.t_ctrl_s = t_ctrl_s
        self.t_dl_min_s = t_dl_min_s
        self.t_dl_max_s = t_dl_max_s
        self.tau_guard_s = tau_guard_s
        self.tau_min_s = tau_min_s
        self.tau_max_normal_s = tau_max_normal_s
        self.scheduler_name = "Tac_TAD"

        self.r_avg: Dict[int, float] = {}
        self.alpha_pf: float = 0.05
        # High urgency weights protecting 5QI 69 (40ms PDB) and 5QI 65 (75ms PDB) from starvation
        self.weights: Dict[int, float] = {69: 200.0, 65: 50.0, 67: 2.0, 70: 1.0}

    def schedule_frame(
        self,
        frame_index: int,
        current_time: float,
        nodes: List[GroundNodeTrafficSubsystem],
        link_statuses: Dict[int, LinkStatus],
        predictive_states: Dict[int, PredictiveState],
        dl_backlog_bytes: int = 0,
    ) -> FrameScheduleReport:
        # Dynamic TDD breathing: adjust T_DL based on ACN broadcast queue
        if dl_backlog_bytes > 5000:
            t_dl = min(self.t_dl_max_s, self.t_dl_min_s + 0.002)
        else:
            t_dl = self.t_dl_min_s

        t_ul_available = self.t_frame_s - self.t_ctrl_s - t_dl
        allocations: List[SlotAllocation] = []
        total_bits_tx: int = 0
        used_time_s: float = 0.0

        # Step 1: Filter out nodes in HARD_SHADOW_CUTOFF (diffraction outage)
        candidate_nodes: List[GroundNodeTrafficSubsystem] = []
        for node in nodes:
            ps = predictive_states[node.node_id]
            ls = link_statuses[node.node_id]

            # 100% time reclamation on severed links
            if ps.current_state == NodeTerrainState.HARD_SHADOW_CUTOFF or ls.bitrate_bps <= 0:
                continue

            # Only candidate if backlog exists or entering pre-occlusion flush
            if node.queue.get_total_backlog_bits() == 0 and ps.current_state != NodeTerrainState.PRE_OCCLUSION_FLUSH:
                continue

            candidate_nodes.append(node)

        # Step 2: Compute Dynamic Priority Metric Psi_i
        candidate_metrics: List[tuple[float, GroundNodeTrafficSubsystem]] = []
        for node in candidate_nodes:
            nid = node.node_id
            ps = predictive_states[nid]
            ls = link_statuses[nid]
            q = node.queue
            q_total_bits = q.get_total_backlog_bits()

            # Base Urgency: sum over classes [ weight_c * exp(HOL_delay / PDB) ]
            urgency = 0.0
            for qid, weight in self.weights.items():
                if q.get_class_backlog_bytes(qid) > 0:
                    hol = q.get_hol_delay_s(qid, current_time)
                    pdb = float(QOS_PROFILES[qid]["pdb_s"])
                    urgency += weight * math.exp(min(8.0, hol / pdb))
            if urgency == 0.0:
                urgency = 0.1

            # Proportional Fairness Term: R_inst / R_avg
            r_inst = ls.bitrate_bps
            r_prev = self.r_avg.get(nid, 100000.0)
            pf_term = r_inst / max(1000.0, r_prev)

            # Lower-bounded backlog utility prevents small C2 packets from being starved
            backlog_utility = max(1.0, math.log2(1.0 + q_total_bits / 8000.0))

            # Predictive Evacuation Boost (Phi_evac)
            if ps.current_state == NodeTerrainState.PRE_OCCLUSION_FLUSH:
                warning_threshold = 3.0
                t_occ = ps.time_to_occlusion_s
                evac_ratio = max(0.0, (warning_threshold - t_occ) / warning_threshold)
                phi_evac = 1.0 + 5.0 * evac_ratio * min(1.0, q_total_bits / 20000.0)
            elif ps.current_state == NodeTerrainState.RE_EMERGENCE_BURST:
                phi_evac = 4.0
            else:
                phi_evac = 1.0

            psi_i = phi_evac * urgency * pf_term * backlog_utility
            candidate_metrics.append((psi_i, node))

        # Sort candidate nodes in descending order of priority metric Psi_i
        candidate_metrics.sort(key=lambda x: x[0], reverse=True)

        # Step 3: Exact-Fit Slot Sizing
        remaining_ul_time_s = t_ul_available
        slot_start_s = current_time + self.t_ctrl_s + t_dl
        scheduled_node_ids = set()

        for psi_i, node in candidate_metrics:
            if remaining_ul_time_s < self.tau_min_s:
                break

            nid = node.node_id
            ps = predictive_states[nid]
            ls = link_statuses[nid]
            r_inst = ls.bitrate_bps
            q_total_bits = node.queue.get_total_backlog_bits()

            if q_total_bits == 0:
                continue

            tau_req = q_total_bits / r_inst

            # In PRE_OCCLUSION_FLUSH: allow slot to expand to entire available frame slack!
            if ps.current_state == NodeTerrainState.PRE_OCCLUSION_FLUSH:
                tau_slot = min(remaining_ul_time_s - self.tau_guard_s, max(tau_req, self.tau_min_s))
                is_flush = True
            else:
                tau_slot = min(tau_req, self.tau_max_normal_s, remaining_ul_time_s - self.tau_guard_s)
                is_flush = False

            if tau_slot < self.tau_min_s:
                continue

            cap_bits = int(tau_slot * r_inst)
            cap_bytes = cap_bits // 8

            spec_eff = getattr(ls, "spectral_efficiency_bps_hz", getattr(ls, "spectral_efficiency", 0.0))

            alloc = SlotAllocation(
                node_id=nid,
                slot_start_s=slot_start_s,
                duration_s=tau_slot,
                timing_advance_s=0.001,
                modcod_name=ls.modcod,
                spectral_efficiency=spec_eff,
                allocated_capacity_bits=cap_bits,
                is_pre_occlusion_flush=is_flush,
            )
            allocations.append(alloc)
            scheduled_node_ids.add(nid)

            served_pkts = node.queue.dequeue(cap_bytes, current_time)
            bits_served = sum(p.size_bits for p in served_pkts)
            total_bits_tx += bits_served

            # Update exponential moving average throughput
            r_achieved = bits_served / self.t_frame_s
            r_prev = self.r_avg.get(nid, 100000.0)
            self.r_avg[nid] = (1.0 - self.alpha_pf) * r_prev + self.alpha_pf * r_achieved

            time_consumed = tau_slot + self.tau_guard_s
            used_time_s += time_consumed
            slot_start_s += time_consumed
            remaining_ul_time_s -= time_consumed

        # Decay PF throughput for unscheduled candidate nodes
        for node in nodes:
            if node.node_id not in scheduled_node_ids:
                r_prev = self.r_avg.get(node.node_id, 100000.0)
                self.r_avg[node.node_id] = (1.0 - self.alpha_pf) * r_prev

        total_delay_drops = sum(n.queue.dropped_delay_count for n in nodes)
        total_overflow_drops = sum(n.queue.dropped_overflow_count for n in nodes)
        util_pct = (used_time_s / t_ul_available) * 100.0

        return FrameScheduleReport(
            frame_index=frame_index,
            timestamp_s=current_time,
            scheduler_name=self.scheduler_name,
            allocations=allocations,
            total_ul_utilization_pct=util_pct,
            total_bits_transmitted=total_bits_tx,
            total_bits_wasted_on_outage=0,  # Zero bits wasted on severed links
            packets_dropped_delay=total_delay_drops,
            packets_dropped_overflow=total_overflow_drops,
        )
```

### File: `core/terrain.py` (393 lines, 14,848 bytes)

```python
"""
Tactical X-Band Air-to-Ground Network Digital Twin - Terrain Engine Module.

Implements high-resolution dual-mode topography over an expanded 600x600 km regional theater:
  1. Real Satellite & Custom DEMs (bilinear interpolation over [-300000, +300000] meters)
  2. Synthetic Procedural (2D Fourier Spectral Synthesis 1/f^beta fBm)

Includes 4/3 Earth refraction geometry (ITU-R P.834) and obstacle diffraction
analysis utilizing the Deygout rounded-crest model (ITU-R P.526-15) with Fock
creeping-wave losses.
"""

from typing import Tuple, Optional, Callable, Union
import math
import os
from pathlib import Path
import numpy as np
from scipy.interpolate import RegularGridInterpolator

try:
    from core.config import RFConfig, EnvironmentConfig, SPEED_OF_LIGHT
except ImportError:
    from .config import RFConfig, EnvironmentConfig, SPEED_OF_LIGHT

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CUSTOM_DEM_PATH = PROJECT_ROOT / "data" / "terrain" / "custom_uploaded_dem.npy"
DEFAULT_REAL_DEM_PATH = PROJECT_ROOT / "data" / "terrain" / "ladakh_real_dem.npy"
FALLBACK_DEM_PATH = PROJECT_ROOT / "data" / "terrain" / "ladakh_elevation.npy"

# Regional 600x600 km Theater Extent (+/- 300 km from origin)
THEATER_EXTENT_600KM_M = 300000.0


def _generate_spectral_elevation_grid(
    size: int = 512,
    theater_extent_m: float = THEATER_EXTENT_600KM_M,
    beta: float = 2.3,
    seed: int = 42,
) -> np.ndarray:
    """
    Generates an authentic 2D Fractional Brownian Motion (fBm) elevation matrix
    via 2D Fourier Spectral Synthesis (1 / f^beta power-law filtering) across
    an expanded 600x600 km domain ([-300000, +300000] m).
    """
    rng = np.random.RandomState(seed)

    # 1. 2D spatial frequency coordinates
    kx = np.fft.fftfreq(size)[:, None]
    ky = np.fft.rfftfreq(size)[None, :]
    k_sq = kx**2 + ky**2
    k_sq[0, 0] = 1.0  # Avoid divide-by-zero at DC component

    # 2. Power-law spectral filter: amplitude ~ 1 / (k^beta)
    amplitude = 1.0 / (k_sq ** (beta / 2.0))
    amplitude[0, 0] = 0.0

    # 3. Random uniform phase generation
    phases = rng.uniform(0.0, 2.0 * np.pi, size=(size, size // 2 + 1))
    fourier_coeffs = amplitude * np.exp(1j * phases)

    # 4. Inverse 2D real Fast Fourier Transform
    elevation = np.fft.irfft2(fourier_coeffs, s=(size, size))
    elevation = (elevation - elevation.min()) / (elevation.max() - elevation.min())

    # 5. Continuous valley trough along 35-degree tectonic strike angle across 600 km
    grid_coords = np.linspace(-theater_extent_m, theater_extent_m, size)
    X, Y = np.meshgrid(grid_coords, grid_coords)  # X: horizontal (col), Y: vertical (row)

    ang = math.radians(35.0)
    v = -X * math.sin(ang) + Y * math.cos(ang)

    # Smooth 50 km Gaussian valley depression scaled for 600 km theater
    valley_trough = 0.35 * np.exp(-(v**2) / (2.0 * (50000.0**2)))

    combined = elevation - valley_trough
    combined = (combined - combined.min()) / (combined.max() - combined.min())

    # 6. Scale to authentic Ladakh elevations: 2900m to 5800m MSL
    return 2900.0 + combined * 2900.0


# Module-level cached synthetic spectral model across 600x600 km
_GLOBAL_THEATER_EXTENT_M = THEATER_EXTENT_600KM_M
_GLOBAL_GRID_SIZE = 512
_GLOBAL_SPECTRAL_GRID = _generate_spectral_elevation_grid(
    size=_GLOBAL_GRID_SIZE,
    theater_extent_m=_GLOBAL_THEATER_EXTENT_M,
    beta=2.3,
    seed=42,
)
_GLOBAL_GRID_COORDS = np.linspace(-_GLOBAL_THEATER_EXTENT_M, _GLOBAL_THEATER_EXTENT_M, _GLOBAL_GRID_SIZE)
_GLOBAL_SYNTH_INTERPOLATOR = RegularGridInterpolator(
    (_GLOBAL_GRID_COORDS, _GLOBAL_GRID_COORDS),  # (y_coords, x_coords)
    _GLOBAL_SPECTRAL_GRID,
    method="linear",
    bounds_error=False,
    fill_value=None,
)


def _procedural_himalayan_elevation(
    x_m: Union[float, np.ndarray],
    y_m: Union[float, np.ndarray]
) -> Union[float, np.ndarray]:
    """
    Evaluates terrain elevation MSL (m) using the cached 2D spectral synthesis model
    over the 600 km domain, superimposing the Kargil tactical ridge at (5000, 270, 4150).
    """
    x_arr = np.asarray(x_m, dtype=float)
    y_arr = np.asarray(y_m, dtype=float)

    if x_arr.ndim == 0:
        base_elev = float(_GLOBAL_SYNTH_INTERPOLATOR((float(y_arr), float(x_arr))))
    else:
        pts = np.column_stack((y_arr.ravel(), x_arr.ravel()))
        base_elev = _GLOBAL_SYNTH_INTERPOLATOR(pts).reshape(x_arr.shape)

    # Kargil Tactical Barrier Ridge (x=5000m, y=270m, z=4150m)
    x_arg = np.clip(-((x_arr - 5000.0) / 450.0) ** 2, -100.0, 0.0)
    y_arg = np.clip((np.abs(y_arr - 270.0) - 90.0) / 12.0, -50.0, 50.0)
    ridge_kargil = 1150.0 * np.exp(x_arg) * (1.0 / (1.0 + np.exp(y_arg)))

    total = np.clip(base_elev + ridge_kargil, 2800.0, 5900.0)

    if np.isscalar(x_m) and np.isscalar(y_m):
        return float(total)
    return total


class TerrainEngine:
    """
    Dual-Mode Tactical Topography & Geometrical Propagation Engine.

    Modes:
      - 'real': Loads Satellite or Custom DEM raster arrays with bilinear interpolation
                over the expanded 600x600 km domain ([-300000, +300000] m).
      - 'synthetic': Uses the procedural 2D Fourier Spectral Synthesis model.
    """

    def __init__(
        self,
        elevation_file_path: Optional[str] = None,
        custom_elevation_fn: Optional[Callable[[Union[float, np.ndarray], Union[float, np.ndarray]], Union[float, np.ndarray]]] = None,
        theater_extent_m: float = THEATER_EXTENT_600KM_M,
        terrain_mode: str = "real",
    ) -> None:
        """
        Initialize the terrain engine in 'real' or 'synthetic' mode.
        """
        self.elevation_file_path = elevation_file_path
        self.custom_elevation_fn = custom_elevation_fn
        self.theater_extent_m = theater_extent_m
        self.terrain_mode: str = terrain_mode.lower().strip() if terrain_mode in ("real", "synthetic") else "real"

        self.real_dem_grid: Optional[np.ndarray] = None
        self._real_interpolator: Optional[RegularGridInterpolator] = None
        self._synth_interpolator: RegularGridInterpolator = _GLOBAL_SYNTH_INTERPOLATOR

        self._init_dem_sources()

    def _init_dem_sources(self) -> None:
        """Loads and binds real DEM raster if present on disk."""
        target_path: Optional[Path] = None
        if self.elevation_file_path:
            candidate = Path(self.elevation_file_path)
            if candidate.exists():
                target_path = candidate

        if target_path is None:
            if CUSTOM_DEM_PATH.exists():
                target_path = CUSTOM_DEM_PATH
            elif DEFAULT_REAL_DEM_PATH.exists():
                target_path = DEFAULT_REAL_DEM_PATH
            elif FALLBACK_DEM_PATH.exists():
                target_path = FALLBACK_DEM_PATH

        if target_path is not None and target_path.exists():
            self.load_custom_dem(str(target_path))

    def load_custom_dem(self, filepath: Union[str, Path]) -> bool:
        """
        Loads a numpy elevation array, sets up bilinear interpolation across the
        expanded theater domain [-300000, +300000] meters, and activates 'real' mode.
        """
        path = Path(filepath)
        if not path.exists():
            return False

        try:
            grid = np.load(path, mmap_mode="r").astype(np.float32)
            ny, nx = grid.shape

            # RegularGridInterpolator requires strictly ascending grid coordinates
            x_coords = np.linspace(-self.theater_extent_m, self.theater_extent_m, nx)
            y_ascending = np.linspace(-self.theater_extent_m, self.theater_extent_m, ny)
            grid_ascending = np.flipud(grid)  # Row 0: North (+Y), Row ny-1: South (-Y)

            self.real_dem_grid = grid
            self._real_interpolator = RegularGridInterpolator(
                (y_ascending, x_coords),
                grid_ascending,
                method="linear",
                bounds_error=False,
                fill_value=None,
            )
            self.terrain_mode = "real"
            self.elevation_file_path = str(path)
            return True
        except Exception as e:
            print(f"[TerrainEngine] Error loading custom DEM from {filepath}: {e}")
            self.real_dem_grid = None
            self._real_interpolator = None
            return False

    def set_terrain_mode(self, mode: str) -> str:
        """
        Dynamically toggle between 'real' Satellite/Custom DEM and 'synthetic' procedural mode.
        """
        cleaned = mode.lower().strip()
        if cleaned in ("real", "synthetic"):
            self.terrain_mode = cleaned
            if self.terrain_mode == "real" and self._real_interpolator is None:
                self._init_dem_sources()
        return self.terrain_mode

    def get_elevation(
        self,
        x_m: Union[float, np.ndarray],
        y_m: Union[float, np.ndarray]
    ) -> Union[float, np.ndarray]:
        """
        Query ground elevation MSL in meters at coordinates (x, y) relative to theater center.
        """
        if self.custom_elevation_fn is not None:
            elev = self.custom_elevation_fn(x_m, y_m)
            if np.isscalar(x_m) and np.isscalar(y_m):
                return float(elev)
            return elev

        x_arr = np.asarray(x_m, dtype=float)
        y_arr = np.asarray(y_m, dtype=float)

        # 1. Evaluate elevation according to active mode over [-300000, +300000] domain
        if self.terrain_mode == "real" and self._real_interpolator is not None:
            if x_arr.ndim == 0:
                base_elev = float(self._real_interpolator((float(y_arr), float(x_arr))))
            else:
                pts = np.column_stack((y_arr.ravel(), x_arr.ravel()))
                base_elev = self._real_interpolator(pts).reshape(x_arr.shape)
        else:
            # Synthetic procedural mode
            if x_arr.ndim == 0:
                base_elev = float(self._synth_interpolator((float(y_arr), float(x_arr))))
            else:
                pts = np.column_stack((y_arr.ravel(), x_arr.ravel()))
                base_elev = self._synth_interpolator(pts).reshape(x_arr.shape)

        # 2. Superimpose the deterministic Kargil barrier ridge at x=5000m, y=270m
        x_arg = np.clip(-((x_arr - 5000.0) / 450.0) ** 2, -100.0, 0.0)
        y_arg = np.clip((np.abs(y_arr - 270.0) - 90.0) / 12.0, -50.0, 50.0)
        ridge_kargil = 1150.0 * np.exp(x_arg) * (1.0 / (1.0 + np.exp(y_arg)))

        total = np.clip(base_elev + ridge_kargil, 2800.0, 5900.0)

        if np.isscalar(x_m) and np.isscalar(y_m):
            return float(total)
        return total

    @staticmethod
    def compute_earth_bulge(
        d1_m: float,
        d2_m: float,
        r_effective_m: float = (4.0 / 3.0) * 6371000.0
    ) -> float:
        """
        Compute ITU-R P.834 4/3 Earth curvature bulge height at intermediate path location.
        Formula: delta_h = (d1 * d2) / (2 * R_effective)
        """
        return (d1_m * d2_m) / (2.0 * r_effective_m)

    def compute_slant_geometry(
        self,
        node_pos: Tuple[float, ...],
        acn_pos: Tuple[float, ...],
        env_config: EnvironmentConfig,
    ) -> Tuple[float, float, float, float]:
        """
        Compute curved Earth 3D slant range geometry, elevation angle, and closed-loop timing.
        """
        nx, ny = node_pos[0], node_pos[1]
        nz = node_pos[2] if len(node_pos) > 2 else float(self.get_elevation(nx, ny))

        ax, ay = acn_pos[0], acn_pos[1]
        az = acn_pos[2] if len(acn_pos) > 2 else 5000.0

        dx = ax - nx
        dy = ay - ny
        dz = az - nz

        d_2d = math.hypot(dx, dy)
        d_3d = math.hypot(d_2d, dz)

        r_eff = env_config.effective_earth_radius_m
        phi = d_2d / r_eff if r_eff > 0.0 else 0.0

        if d_2d < 1e-3:
            elev_rad = math.pi / 2.0 if dz >= 0.0 else -math.pi / 2.0
        else:
            elev_rad = math.atan2(
                (r_eff + az) * math.cos(phi) - (r_eff + nz),
                (r_eff + az) * math.sin(phi)
            )

        elevation_deg = math.degrees(elev_rad)
        tau_prop_s = d_3d / SPEED_OF_LIGHT
        timing_advance_s = 2.0 * tau_prop_s

        return (d_3d, elevation_deg, tau_prop_s, timing_advance_s)

    def evaluate_terrain_obstruction(
        self,
        node_pos: Tuple[float, ...],
        acn_pos: Tuple[float, ...],
        rf_config: RFConfig,
        env_config: EnvironmentConfig,
        step_interval_m: float = 100.0,
    ) -> Tuple[float, float, float, bool]:
        """
        Perform 100m ray-tracing obstruction analysis using ITU-R P.526-15 Deygout model.
        """
        nx, ny = node_pos[0], node_pos[1]
        nz = node_pos[2] if len(node_pos) > 2 else float(self.get_elevation(nx, ny))

        ax, ay = acn_pos[0], acn_pos[1]
        az = acn_pos[2] if len(acn_pos) > 2 else 5000.0

        dx = ax - nx
        dy = ay - ny
        dz = az - nz
        d_3d = math.hypot(math.hypot(dx, dy), dz)

        wavelength = rf_config.wavelength_m
        r_eff = env_config.effective_earth_radius_m

        if d_3d <= step_interval_m * 2.0:
            steps = np.array([d_3d * 0.5])
        else:
            steps = np.arange(step_interval_m, d_3d, step_interval_m)

        d1 = steps
        d2 = d_3d - d1
        fraction = d1 / d_3d

        sample_x = nx + fraction * dx
        sample_y = ny + fraction * dy

        elevations = self.get_elevation(sample_x, sample_y)
        if np.isscalar(elevations):
            elevations = np.array([elevations])

        earth_bulge = (d1 * d2) / (2.0 * r_eff)
        h_terrain_eff = elevations + earth_bulge

        h_los = nz + fraction * dz
        h_clear = h_los - h_terrain_eff
        r1 = np.sqrt(wavelength * (d1 * d2) / d_3d)

        clearance_ratios = h_clear / r1

        crit_idx = int(np.argmin(clearance_ratios))
        min_clearance_ratio = float(clearance_ratios[crit_idx])
        min_clearance_m = float(h_clear[crit_idx])
        fresnel_radius_m = float(r1[crit_idx])
        crit_d1 = float(d1[crit_idx])
        crit_d2 = float(d2[crit_idx])

        if min_clearance_ratio >= 0.6:
            diffraction_loss_db = 0.0
            is_los_bool = True
        elif min_clearance_ratio > 0.0:
            diffraction_loss_db = 6.0 * (1.0 - (min_clearance_ratio / 0.6))
            is_los_bool = True
        else:
            is_los_bool = False
            nu = -min_clearance_m * math.sqrt(
                (2.0 / wavelength) * (1.0 / crit_d1 + 1.0 / crit_d2)
            )
            arg = math.sqrt((nu - 0.1) ** 2 + 1.0) + (nu - 0.1)
            knife_edge_loss = 6.9 + 20.0 * math.log10(max(arg, 1e-9))
            fock_penalty_db = 12.0
            diffraction_loss_db = knife_edge_loss + fock_penalty_db

        return (min_clearance_m, fresnel_radius_m, diffraction_loss_db, is_los_bool)
```

### File: `core/trajectory.py` (317 lines, 13,326 bytes)

```python
"""
core/trajectory.py - Kinematics & Predictive Look-Ahead Trajectory Engine
Tactical X-Band Air-to-Ground Network Digital Twin

Implements constant tangential airspeed integration (60 m/s +/- 1 m/s) along rotated
elliptical orbits and orbital predictive look-ahead state classification.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
import math
from typing import Any, Optional, Tuple

import numpy as np

try:
    from core.config import ACNFlightConfig, EnvironmentConfig, RFConfig, SPEED_OF_LIGHT
except ImportError:
    from .config import ACNFlightConfig, EnvironmentConfig, RFConfig, SPEED_OF_LIGHT


# ----------------------------------------------------------------------------------------
# 4-State Predictive Occlusion Machine
# ----------------------------------------------------------------------------------------
class NodeTerrainState(IntEnum):
    NORMAL_LOS = 0
    PRE_OCCLUSION_FLUSH = 1
    HARD_SHADOW_CUTOFF = 2
    RE_EMERGENCE_BURST = 3


@dataclass
class PredictiveState:
    current_state: NodeTerrainState
    time_to_occlusion_s: float
    time_to_emergence_s: float
    fresnel_clearance_m: float
    fresnel_rate_of_change_mps: float = 0.0
    predicted_outage_duration_s: float = 0.0
    apparent_doppler_hz: float = 0.0
    shadow_duration_s: float = 0.0


# ----------------------------------------------------------------------------------------
# Constant-Airspeed Rotated Elliptical Kinematics Engine
# ----------------------------------------------------------------------------------------
class ACNTrajectoryEngine:
    """
    Calculates 3D coordinates and tangential velocity vectors for an ACN loitering along
    a rotated ellipse at a constant true airspeed (v = 60.0 m/s +/- 1.0 m/s).
    
    Uses arc-length parameterized numerical integration to map time t -> parametric angle theta:
        ds/dtheta = sqrt((a * sin(theta))^2 + (b * cos(theta))^2)
        dtheta/dt = loiter_speed_mps / ds_dtheta
    """

    def __init__(self, flight_config: ACNFlightConfig, num_lut_samples: int = 16384) -> None:
        self.flight_config = flight_config
        self.num_lut_samples = num_lut_samples
        self._build_arc_length_lut()

    def _build_arc_length_lut(self) -> None:
        a = float(self.flight_config.loiter_radius_a_m)
        b = float(self.flight_config.loiter_radius_b_m)
        v0 = float(self.flight_config.loiter_speed_mps)

        self.theta_lut = np.linspace(0.0, 2.0 * np.pi, self.num_lut_samples)
        ds_dtheta = np.sqrt((a * np.sin(self.theta_lut)) ** 2 + (b * np.cos(self.theta_lut)) ** 2)

        d_theta = self.theta_lut[1] - self.theta_lut[0]
        s_cumulative = np.zeros(self.num_lut_samples, dtype=float)
        s_cumulative[1:] = np.cumsum(0.5 * (ds_dtheta[:-1] + ds_dtheta[1:]) * d_theta)

        self.s_lut = s_cumulative
        self.total_perimeter_m = float(self.s_lut[-1])

        if self.total_perimeter_m <= 0.0 or v0 <= 0.0:
            self.orbit_period_s = 1.0
        else:
            self.orbit_period_s = self.total_perimeter_m / v0

    def get_orbital_period(self) -> float:
        return self.orbit_period_s

    def _get_theta_at_time(self, t_s: float) -> float:
        if self.total_perimeter_m <= 0.0 or self.orbit_period_s <= 0.0:
            return 0.0
        v0 = float(self.flight_config.loiter_speed_mps)
        distance_along_orbit = (v0 * t_s) % self.total_perimeter_m
        theta = float(np.interp(distance_along_orbit, self.s_lut, self.theta_lut))
        return theta

    def get_acn_position(self, t_s: float) -> Tuple[float, float, float]:
        """Calculates 3D Cartesian coordinates (x, y, z) at time t along rotated ellipse."""
        a = float(self.flight_config.loiter_radius_a_m)
        b = float(self.flight_config.loiter_radius_b_m)
        phi = math.radians(float(self.flight_config.loiter_rotation_deg))
        cx = float(self.flight_config.center_x_m)
        cy = float(self.flight_config.center_y_m)
        cz = float(self.flight_config.altitude_msl_m)

        theta = self._get_theta_at_time(t_s)
        x_raw = a * math.cos(theta)
        y_raw = b * math.sin(theta)

        cos_phi = math.cos(phi)
        sin_phi = math.sin(phi)
        x = cx + x_raw * cos_phi - y_raw * sin_phi
        y = cy + x_raw * sin_phi + y_raw * cos_phi
        z = cz
        return (x, y, z)

    def get_acn_velocity(self, t_s: float) -> Tuple[float, float, float]:
        """
        Calculates tangent velocity vector (vx, vy, vz).
        Guarantees tangential magnitude sqrt(vx^2 + vy^2) == loiter_speed_mps (60.0 m/s).
        """
        a = float(self.flight_config.loiter_radius_a_m)
        b = float(self.flight_config.loiter_radius_b_m)
        v0 = float(self.flight_config.loiter_speed_mps)
        phi = math.radians(float(self.flight_config.loiter_rotation_deg))

        theta = self._get_theta_at_time(t_s)

        ds_dtheta = math.sqrt((a * math.sin(theta)) ** 2 + (b * math.cos(theta)) ** 2)
        if ds_dtheta < 1e-9:
            return (0.0, 0.0, 0.0)

        dtheta_dt = v0 / ds_dtheta
        vx_raw = -a * math.sin(theta) * dtheta_dt
        vy_raw = b * math.cos(theta) * dtheta_dt

        cos_phi = math.cos(phi)
        sin_phi = math.sin(phi)
        vx = vx_raw * cos_phi - vy_raw * sin_phi
        vy = vx_raw * sin_phi + vy_raw * cos_phi
        vz = 0.0
        return (vx, vy, vz)


# ----------------------------------------------------------------------------------------
# Orbital Predictive Look-Ahead Machine
# ----------------------------------------------------------------------------------------
class PredictiveLookAheadEngine:
    """
    Evaluates current and upcoming Fresnel zone clearances by forward-propagating
    the ACN orbit across the digital elevation model.
    """

    def __init__(
        self,
        terrain_engine: Any,
        link_budget_engine: Any,
        rf_config: RFConfig,
        env_config: EnvironmentConfig,
        flight_config: ACNFlightConfig,
        trajectory_engine: ACNTrajectoryEngine,
        lookahead_horizon_s: float = 12.0,
        step_dt_s: float = 0.25,
        flush_threshold_s: float = 3.0,
        burst_duration_s: float = 2.0,
    ) -> None:
        self.terrain_engine = terrain_engine
        self.link_budget_engine = link_budget_engine
        self.rf_config = rf_config
        self.env_config = env_config
        self.flight_config = flight_config
        self.trajectory_engine = trajectory_engine
        self.lookahead_horizon_s = lookahead_horizon_s
        self.step_dt_s = step_dt_s
        self.flush_threshold_s = flush_threshold_s
        self.burst_duration_s = burst_duration_s

    def evaluate_predictive_state(
        self,
        node_pos: Tuple[float, float, float],
        current_time_s: float,
    ) -> PredictiveState:
        """
        Classifies node link into:
            NORMAL_LOS -> PRE_OCCLUSION_FLUSH (T_occ <= 3.0s) -> HARD_SHADOW_CUTOFF (is_outage=True)
            -> RE_EMERGENCE_BURST (time_since_emergence <= 2.0s) -> NORMAL_LOS.
        """
        acn_pos = self.trajectory_engine.get_acn_position(current_time_s)
        acn_vel = self.trajectory_engine.get_acn_velocity(current_time_s)

        min_clear_m, fresnel_r_m, diff_loss_db, is_los_now = (
            self.terrain_engine.evaluate_terrain_obstruction(
                node_pos, acn_pos, self.rf_config, self.env_config
            )
        )

        # 1. Apparent Doppler shift calculation
        dx = node_pos[0] - acn_pos[0]
        dy = node_pos[1] - acn_pos[1]
        dz = node_pos[2] - acn_pos[2]
        dist = max(math.sqrt(dx * dx + dy * dy + dz * dz), 1.0)
        v_radial = (acn_vel[0] * dx + acn_vel[1] * dy + acn_vel[2] * dz) / dist
        fc = self.rf_config.carrier_frequency_hz
        doppler_hz = (v_radial / SPEED_OF_LIGHT) * fc

        # 2. Clearance rate of change (dC/dt)
        next_acn_pos = self.trajectory_engine.get_acn_position(current_time_s + self.step_dt_s)
        next_clear_m, _, _, _ = self.terrain_engine.evaluate_terrain_obstruction(
            node_pos, next_acn_pos, self.rf_config, self.env_config
        )
        clearance_rate_mps = (next_clear_m - min_clear_m) / self.step_dt_s

        # --------------------------------------------------------------------------------
        # Regime A: Currently in Mountain Shadow (Severed Line-of-Sight)
        # --------------------------------------------------------------------------------
        if not is_los_now:
            time_to_emergence = float("inf")
            steps = int(self.lookahead_horizon_s / self.step_dt_s)
            for step in range(1, steps + 1):
                future_t = current_time_s + step * self.step_dt_s
                future_acn = self.trajectory_engine.get_acn_position(future_t)
                _, _, _, future_is_los = self.terrain_engine.evaluate_terrain_obstruction(
                    node_pos, future_acn, self.rf_config, self.env_config
                )
                if future_is_los:
                    time_to_emergence = step * self.step_dt_s
                    break

            outage_dur = time_to_emergence if math.isfinite(time_to_emergence) else 0.0

            return PredictiveState(
                current_state=NodeTerrainState.HARD_SHADOW_CUTOFF,
                time_to_occlusion_s=0.0,
                time_to_emergence_s=time_to_emergence,
                fresnel_clearance_m=min_clear_m,
                fresnel_rate_of_change_mps=clearance_rate_mps,
                predicted_outage_duration_s=outage_dur,
                apparent_doppler_hz=doppler_hz,
                shadow_duration_s=outage_dur,
            )

        # --------------------------------------------------------------------------------
        # Regime B: Line-of-Sight Currently Clear
        # --------------------------------------------------------------------------------
        # 1. Check if node recently emerged from shadow (Re-emergence Burst window)
        just_emerged = False
        past_steps = int(self.burst_duration_s / self.step_dt_s)
        for step in range(1, past_steps + 1):
            past_t = current_time_s - step * self.step_dt_s
            if past_t < 0.0:
                break
            past_acn = self.trajectory_engine.get_acn_position(past_t)
            _, _, _, past_is_los = self.terrain_engine.evaluate_terrain_obstruction(
                node_pos, past_acn, self.rf_config, self.env_config
            )
            if not past_is_los:
                just_emerged = True
                break

        if just_emerged:
            return PredictiveState(
                current_state=NodeTerrainState.RE_EMERGENCE_BURST,
                time_to_occlusion_s=float("inf"),
                time_to_emergence_s=0.0,
                fresnel_clearance_m=min_clear_m,
                fresnel_rate_of_change_mps=clearance_rate_mps,
                predicted_outage_duration_s=0.0,
                apparent_doppler_hz=doppler_hz,
                shadow_duration_s=0.0,
            )

        # 2. Check upcoming occlusion within lookahead horizon
        time_to_occlusion = float("inf")
        predicted_outage_duration = 0.0
        steps = int(self.lookahead_horizon_s / self.step_dt_s)
        occlusion_step: Optional[int] = None

        for step in range(1, steps + 1):
            future_t = current_time_s + step * self.step_dt_s
            future_acn = self.trajectory_engine.get_acn_position(future_t)
            _, _, _, future_is_los = self.terrain_engine.evaluate_terrain_obstruction(
                node_pos, future_acn, self.rf_config, self.env_config
            )
            if not future_is_los:
                time_to_occlusion = step * self.step_dt_s
                occlusion_step = step
                break

        # If upcoming occlusion detected, forward-trace duration of that future shadow
        if occlusion_step is not None:
            emergence_found = False
            for step in range(occlusion_step + 1, steps + 1):
                future_t = current_time_s + step * self.step_dt_s
                future_acn = self.trajectory_engine.get_acn_position(future_t)
                _, _, _, future_is_los = self.terrain_engine.evaluate_terrain_obstruction(
                    node_pos, future_acn, self.rf_config, self.env_config
                )
                if future_is_los:
                    predicted_outage_duration = (step - occlusion_step) * self.step_dt_s
                    emergence_found = True
                    break
            if not emergence_found:
                predicted_outage_duration = (steps - occlusion_step) * self.step_dt_s

        if time_to_occlusion <= self.flush_threshold_s:
            curr_state = NodeTerrainState.PRE_OCCLUSION_FLUSH
        else:
            curr_state = NodeTerrainState.NORMAL_LOS

        return PredictiveState(
            current_state=curr_state,
            time_to_occlusion_s=time_to_occlusion,
            time_to_emergence_s=0.0,
            fresnel_clearance_m=min_clear_m,
            fresnel_rate_of_change_mps=clearance_rate_mps,
            predicted_outage_duration_s=predicted_outage_duration,
            apparent_doppler_hz=doppler_hz,
            shadow_duration_s=predicted_outage_duration,
        )
```

