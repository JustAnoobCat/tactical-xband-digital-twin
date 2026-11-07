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
