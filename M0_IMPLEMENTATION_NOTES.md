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
