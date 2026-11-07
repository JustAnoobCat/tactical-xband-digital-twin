# Step C2 Final Report: Safe Terrain Raycast Deduplication (Options A + B)

---

## 1. Executive Summary

Milestone Step C2 implements two targeted raycast deduplications in the DRDO Tactical X-Band Aerial Communication Network Digital Twin simulation engine:
- **Option A (Current-Frame Obstruction Reuse):** In `src/worker/simWorker.ts`, the already-computed current-frame `TerrainObstruction` is passed directly from `refreshObstructionState()` and `ensureNodeDomainEvaluations()` into `PredictiveLookAheadEngine.evaluatePredictiveState()`. In `src/core/trajectory.ts`, `evaluatePredictiveState()` accepts an optional `currentObs?: TerrainObstruction` parameter, preserving existing callers that invoke it without a precomputed obstruction.
- **Option B (Derivative Raycast Reuse at Horizon Step 1):** In `src/core/trajectory.ts`, the already-computed `nextObs` result is reused at horizon `step = 1` in both Regime A (hard shadow) and Regime B (unobstructed line-of-sight).
- **Operation-Count Reduction:** In both benchmark passes, the number of evaluated terrain raycasts decreased by exactly **2 raycasts per node per frame ($2N$)** across all four node tiers:
  - 16 nodes: 528 $\to$ 496 raycasts/tick (-32 raycasts, -6.06%)
  - 32 nodes: 1051 $\to$ 987 raycasts/tick (-64 raycasts, -6.09%)
  - 64 nodes: 2107 $\to$ 1979 raycasts/tick (-128 raycasts, -6.07%)
  - 128 nodes: 4219 $\to$ 3963 raycasts/tick (-256 raycasts, -6.07%)
- **Verification Status:**
  - Complete 46-suite verification runner: **46 / 46 passed (100.0%)**.
  - Authoritative determinism suite (T1–T6): **All 6 tests passed (100.0%)**.
  - TypeScript type checking and structural project verification: **19 / 19 passed**.

---

## 2. Mathematical Basis of Deduplication & Equivalence

### 2.1 Option A: Current-Frame Obstruction Reuse
At simulation time $t$, `refreshObstructionState()` evaluates:
$$\text{obstruction} = \text{evaluateTerrainObstruction}(\mathbf{p}_{\text{node}}, \mathbf{p}_{\text{acn}}(t), \text{rfConfig}, \text{envConfig})$$
Previously, `evaluatePredictiveState()` recomputed this identical evaluation:
$$\text{currentObs} = \text{evaluateTerrainObstruction}(\mathbf{p}_{\text{node}}, \mathbf{p}_{\text{acn}}(t), \text{rfConfig}, \text{envConfig})$$
Because `evaluateTerrainObstruction()` is a stateless, pure function with no mutable side effects or internal caching, passing `obstruction` into `evaluatePredictiveState()` as `currentObs` supplies identical inputs to downstream calculations.

### 2.2 Option B: Derivative Raycast Reuse at Horizon Step 1
To compute the rate of change of Fresnel clearance ($\dot{C}_{\text{Fresnel}}$), `evaluatePredictiveState()` evaluates:
$$\text{nextPos} = \mathbf{p}_{\text{acn}}(t + \Delta t_{\text{step}})$$
$$\text{nextObs} = \text{evaluateTerrainObstruction}(\mathbf{p}_{\text{node}}, \text{nextPos}, \text{rfConfig}, \text{envConfig})$$
where $\Delta t_{\text{step}} = 0.5\text{ s}$.

In the subsequent horizon lookahead loops (both Regime A and Regime B), horizon step 1 evaluates:
$$\text{futureT} = t + 1 \times \Delta t_{\text{step}} = t + \Delta t_{\text{step}}$$
$$\text{futureAcn} = \mathbf{p}_{\text{acn}}(\text{futureT}) = \mathbf{p}_{\text{acn}}(t + \Delta t_{\text{step}}) = \text{nextPos}$$
$$\text{futureObs} = \text{evaluateTerrainObstruction}(\mathbf{p}_{\text{node}}, \text{futureAcn}, \text{rfConfig}, \text{envConfig})$$

Because `nodePos`, `futureAcn`, `rfConfig`, and `envConfig` at `step = 1` are identical to the inputs already supplied to compute `nextObs`, reusing `nextObs` when `step === 1` eliminates the redundant raycast. Equivalence is grounded strictly in identical input arguments to a deterministic function, not on trajectory displacement approximations. Subsequent horizon steps ($2 \dots 30$) maintain their original evaluation sequence and behavior.

---

## 3. Subsystem Timing & Raycast Accounting

All measurements were collected across 300 recorded simulation ticks per tier (3 seeds `[42, 101, 202]` × 100 ticks) using the authentic Ladakh DEM (`512×512` Float32):

| Nodes | Metric | Step C1 Baseline (Pre-Opt) | Step C2 Pass 1 (Post-Opt) | Step C2 Pass 2 (Post-Opt) | Hardware Raycast Count (C1 $\to$ C2) |
|:---:|:---|:---:|:---:|:---:|:---:|
| **16** | **Physics Tick (Mean / p50 / p95)** | **23.93** / 22.66 / 36.83 ms | **35.31** / 35.59 / 46.72 ms | **36.64** / 36.34 / 47.68 ms | Total: 528 $\to$ 496 (**-32 raycasts**) |
| | Predictive Lookahead (Mean / p50 / p95) | 22.74 / 21.57 / 35.05 ms | 33.41 / 33.78 / 44.84 ms | 34.71 / 34.44 / 45.95 ms | Lookahead: 512 $\to$ 480 (**-6.25%**) |
| | Current Obstruction (Mean / p50 / p95) | 0.76 / 0.70 / 1.13 ms | 1.18 / 1.11 / 1.89 ms | 1.18 / 1.12 / 1.80 ms | Current: 16 $\to$ 16 (0%) |
| | Telemetry Frame (Mean / p50 / p95) | 0.47 / 0.40 / 0.81 ms | 0.72 / 0.60 / 1.30 ms | 0.77 / 0.62 / 1.49 ms | Profiles: 1 $\to$ 1 (0%) |
| **32** | **Physics Tick (Mean / p50 / p95)** | **39.26** / 36.20 / 63.69 ms | **65.40** / 62.39 / 87.92 ms | **60.68** / 58.45 / 84.82 ms | Total: 1051 $\to$ 987 (**-64 raycasts**) |
| | Predictive Lookahead (Mean / p50 / p95) | 37.43 / 34.49 / 60.93 ms | 62.05 / 59.23 / 84.80 ms | 57.60 / 55.53 / 80.92 ms | Lookahead: 1019 $\to$ 955 (**-6.28%**) |
| | Current Obstruction (Mean / p50 / p95) | 1.21 / 1.11 / 1.86 ms | 2.07 / 1.90 / 3.15 ms | 1.97 / 1.81 / 3.30 ms | Current: 32 $\to$ 32 (0%) |
| | Telemetry Frame (Mean / p50 / p95) | 0.45 / 0.43 / 0.76 ms | 0.80 / 0.67 / 1.72 ms | 0.74 / 0.61 / 1.38 ms | Profiles: 1 $\to$ 1 (0%) |
| **64** | **Physics Tick (Mean / p50 / p95)** | **66.11** / 64.73 / 77.54 ms | **108.36** / 105.86 / 149.67 ms | **108.52** / 105.90 / 144.44 ms | Total: 2107 $\to$ 1979 (**-128 raycasts**) |
| | Predictive Lookahead (Mean / p50 / p95) | 63.14 / 61.75 / 73.75 ms | 102.80 / 100.23 / 143.24 ms | 103.14 / 101.01 / 135.11 ms | Lookahead: 2043 $\to$ 1915 (**-6.27%**) |
| | Current Obstruction (Mean / p50 / p95) | 2.00 / 1.92 / 2.51 ms | 3.42 / 3.25 / 5.12 ms | 3.46 / 3.25 / 4.75 ms | Current: 64 $\to$ 64 (0%) |
| | Telemetry Frame (Mean / p50 / p95) | 0.44 / 0.40 / 0.70 ms | 0.75 / 0.67 / 1.35 ms | 0.76 / 0.67 / 1.25 ms | Profiles: 1 $\to$ 1 (0%) |
| **128** | **Physics Tick (Mean / p50 / p95)** | **122.47** / 117.62 / 157.14 ms | **194.29** / 190.49 / 250.36 ms | **210.07** / 201.27 / 290.24 ms | Total: 4219 $\to$ 3963 (**-256 raycasts**) |
| | Predictive Lookahead (Mean / p50 / p95) | 116.79 / 112.21 / 149.91 ms | 183.88 / 180.15 / 237.01 ms | 199.01 / 190.88 / 271.73 ms | Lookahead: 4091 $\to$ 3835 (**-6.26%**) |
| | Current Obstruction (Mean / p50 / p95) | 3.65 / 3.49 / 4.62 ms | 6.00 / 5.74 / 8.05 ms | 6.63 / 6.06 / 10.18 ms | Current: 128 $\to$ 128 (0%) |
| | Telemetry Frame (Mean / p50 / p95) | 0.65 / 0.58 / 1.14 ms | 1.18 / 1.09 / 1.87 ms | 1.28 / 1.12 / 2.53 ms | Profiles: 1 $\to$ 1 (0%) |

---

## 4. Latency Analysis: Measured vs. Estimated Savings

### 4.1 Status of the 7.30 ms Figure
- The **7.30 ms** savings figure at 128 nodes is a **theoretical derived estimate**, **not a measured wall-clock improvement**.
- It was calculated by multiplying the baseline cost of a current-frame raycast ($3.65\text{ ms} / 128 = 28.52\ \mu\text{s}$) by the 256 eliminated raycasts ($256 \times 28.52\ \mu\text{s} = 7.30\text{ ms}$).
- Because post-optimization wall-clock execution occurred under higher host system load, gross wall-clock latency increased rather than decreased between runs.
- **Direct Timing Evidence:** No direct wall-clock latency reduction was measured between the Step C1 baseline artifact and the Step C2 artifacts. The verified outcome is the elimination of **2 raycasts per node per tick ($2N$)**.

### 4.2 Reconciliation of Wall-Clock Timing Drift
- **Hardware Telemetry:**
  - Querying `/sys/devices/system/cpu/cpu*/thermal_throttle/*` confirmed **0 hardware thermal throttling events**.
  - CPU temperatures were recorded at **48.5°C to 57.0°C**, well within normal operating limits.
  - `/sys/devices/system/cpu/intel_pstate/no_turbo` confirmed that Turbo Boost is disabled (`no_turbo = 1`); CPU frequency is governed at base clock (`2.20 GHz`).
- **Host Workload Context:**
  - System load average during Step C2 was **3.90, 5.82, 6.21** on a 4-thread CPU, with concurrent desktop applications (Freebuff renderer at 71.1% CPU, Antigravity renderer at 39.3% CPU, Brave, KWin) active on the desktop.
- **Conclusion:** CPU scheduling contention from concurrent desktop applications is a **plausible explanation** for the observed wall-clock timing inflation across all subsystems, but direct scheduler preemption latency was not instrumented or proven.

---

## 5. Determinism & Trace Verification Disclosures

### 5.1 Post-Change Replay vs. Pre/Post Baseline Equivalence
- **Deterministic Replay (Post-Change):** Verified. Running `src/tests/verifyDeterminismTrace.ts` post-change confirmed that independent runs produce bit-for-bit identical state hashes across 100 simulation frames in both synthetic (T1) and real DEM (T2) modes.
- **Pre/Post Implementation Equivalence:** Pre-C2 trace artifacts were not retained on disk prior to Step C2 (the determinism test harness unlinks temporary trace files upon assertion). Consequently, **direct bit-for-bit baseline equivalence between pre-C2 and post-C2 simulation traces was not established**.
- **Physics Regression Qualification:** The narrow source-level reuse appears behavior-preserving because identical mathematical inputs are reused for pure, stateless functions. However, because persistent pre/post trace artifacts were unavailable for direct file comparison, this remains a qualified engineering assessment rather than an unconditional proof of zero simulation regression.

---

## 6. Artifact & File Change Summary

### 6.1 Artifact Inventory
- **Step C1 Baseline:** `benchmark_results/generated/benchmark-subsystem-breakdown-2026-11-06T18-36-15-432Z.json`
- **Step C2 Pass 1:** `benchmark_results/generated/benchmark-subsystem-breakdown-2026-11-06T19-04-14-922Z.json`
- **Step C2 Pass 2:** `benchmark_results/generated/benchmark-subsystem-breakdown-2026-11-06T19-09-53-325Z.json`
- **Verification Report:** `benchmark_results/generated/verification-report-2026-11-06T18-59-01-104Z.json` (46/46 passed)

### 6.2 Source Files Modified
- [`src/core/trajectory.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/core/trajectory.ts) (Option A + B)
- [`src/worker/simWorker.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/worker/simWorker.ts) (Option A)
- [`scripts/benchmark_subsystem_breakdown.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/scripts/benchmark_subsystem_breakdown.ts) (Harness hook argument passthrough)

Zero additional production, test, or configuration files were modified.
