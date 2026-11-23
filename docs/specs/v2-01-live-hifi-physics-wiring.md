# V2-01: Live 50 Hz Worker Wiring & UI Controls for High-Fidelity Physics Engine

**Specification Identifier:** `SPEC-V2-01-LIVE-HIFI-PHYSICS-WIRING`  
**Milestone:** V2-01 (Frontier Milestone 1)  
**Parent Framework:** `AGENTS.md` (Authoritative Architecture & Discrete-Event Loop Invariants)  
**Status:** **APPROVED FOR IMPLEMENTATION**  

---

## 1. Executive Summary & Problem Formulation

During previous development phases (Work Packages `WP-05` through `WP-10`), high-fidelity physical propagation and control models were implemented and verified in isolation under dedicated unit tests:
- **WP-05 (`verifyAttitudeAndChannelDynamics.ts`):** 3D airframe attitude (bank/pitch/yaw), wing/fuselage defilade shadowing, and 8.0 GHz time-correlated Zheng-Xiao Rician-Jakes fading.
- **WP-06 (`verifyMacPhyFeedback.ts`):** Delayed-CQI AMC overshoot, Outer-Loop Link Adaptation (OLLA) BLER tracking, stop-and-wait HARQ with Chase Combining energy conservation, and dynamic slant-range TDMA guard intervals.
- **WP-07 (`verifyKinematicPathfinder.ts`):** Dubins fixed-wing minimum turn radius kinematics ($R_{\min} = V^2 / (g \tan\phi)$) and 3D flight trajectory smoothing.
- **WP-10 (`verifyViewshedParityAndAccessibility.ts`):** Dual-fidelity viewshed SINR engine with exact `link-budget-parity` ray marching vs. amortized `fast` mode.

However, in the live production simulation worker (`src/worker/simWorker.ts`), these advanced engines were either dormant, pinned to lightweight baselines, or lacked direct interactive toggle controls in the C2 console.

**Objective of V2-01:** Wire all 5 opt-in high-fidelity physics models directly into the live 50 Hz discrete-event loop ($\Delta t = 20\text{ ms}$) within `SimulationWorkerManager`, expose typed additive IPC configuration commands, aggregate and emit comprehensive `hifi_telemetry` metrics, provide compact matte UI controls in the `#tab-terrain` (`RF`) console panel, and enforce 100% backward compatibility (default-OFF) so all 99 existing verification suites pass bit-for-bit identically.

---

## 2. Architectural Invariants & Constraints

1. **Active Authoritative Runtime:** All mutable simulation state lives strictly inside `SimulationWorkerManager` in `src/worker/simWorker.ts`. The UI thread remains purely a projection and dispatch boundary.
2. **50 Hz Discrete-Event Budget ($\Delta t = 20\text{ ms}$):** Total per-tick execution time of `tickSimulation` must comfortably complete within $\le 10\text{ ms}$ even when all 5 high-fidelity models are simultaneously active.
3. **Pure Zero-Randomness Determinism:** Zero `Math.random()` in physical models. Fading, HARQ channel realization, and OLLA adaptation use deterministic pseudo-random seeds derived strictly from `(simTimeS, nodeId, carrierFreqHz, processId)`.
4. **State Cleanup on `RESET_SIM`:** All per-node state maps (`ollaOffsetByNode`, `cqiHistoryByNode`, `harqSlotByNode`, `prevSectorByNode`) and cumulative counters (`harqRetxTotal`) must be cleanly re-initialized whenever `resetSimulationState()` is invoked.
5. **Strict Backward Compatibility:** All 5 flags default to `false` (or `'fast'` for viewshed). Unconfigured runs produce bit-for-bit identical telemetry to the baseline simulation.

---

## 3. High-Fidelity Physics Models Specification

### 3.1 Model 1: 3D Airframe Attitude & Fuselage Shadowing (`WP-05`)
- **Config Key:** `enableAirframeShadowing: boolean` (default: `false`).
- **Kinematic Formulation:**
  $$\phi = \arctan\left(\frac{v_{\text{horiz}} \cdot \dot{\psi}}{g}\right) \quad (\text{clamped to } \pm 45^\circ)$$
  $$\theta = \arctan\left(\frac{v_z}{v_{\text{horiz}}}\right), \quad \psi = \text{atan2}(v_x, v_y)$$
- **Defilade Calculation:** Line-of-sight unit vector from ACN to ground node is transformed into aircraft body frame $(\text{Az}_{\text{body}}, \text{El}_{\text{body}})$. Belly-mounted horn antenna undergoes progressive shadowing ($A_{\text{shadow}} \in [0, 30]\text{ dB}$) when the aircraft banks towards high elevations $(\text{El}_{\text{body}} > -10^\circ)$.
- **Live Output:** `uav_roll_deg`, `uav_pitch_deg`, `mean_airframe_shadow_loss_db`, `max_airframe_shadow_loss_db`.

### 3.2 Model 2: Time-Correlated 8.0 GHz Zheng-Xiao Rician-Jakes Fading (`WP-05`)
- **Config Key:** `enableCorrelatedRicianFading: boolean` (default: `false`).
- **Physical Formulation:** Zheng-Xiao sum-of-sinusoids synthesis with $M = 8$ oscillator paths, carrier frequency $f_c = 8.0\text{ GHz}$, maximum Doppler shift $f_m = (v_{\text{rel}} / c) f_c$, and Clarke coherence time $\tau_c = 0.423 / f_m$.
- **Determinism:** Seeded strictly by `nodeId * 1000 + 42` and current `simTimeS`.
- **Live Output:** `mean_correlated_fading_db`, `coherence_time_ms`.

### 3.3 Model 3: MAC/PHY Closed-Loop Feedback Dynamics (`WP-06`)
- **Config Key:** `enableMacPhyFeedback: boolean` (default: `false`).
- **Delayed-CQI & OLLA Engine:**
  - CQI lag buffer of depth $L = \lceil \tau_{\text{CQI}} / \Delta t \rceil$ frames.
  - Step OLLA backoff margin:
    $$\Delta_{\text{OLLA}}[k+1] = \begin{cases} \Delta_{\text{OLLA}}[k] + \Delta_{\text{up}} & \text{on NACK (BLER target exceeded)} \\ \max(0, \Delta_{\text{OLLA}}[k] - \Delta_{\text{down}}) & \text{on ACK} \end{cases}$$
    with $\Delta_{\text{down}} = \Delta_{\text{up}} \frac{P_{\text{target}}}{1 - P_{\text{target}}}$ targeting $10\%$ BLER ($\Delta_{\text{up}} = 0.5\text{ dB}$, $\Delta_{\text{down}} = 0.0556\text{ dB}$).
- **Stop-and-Wait HARQ with Chase Combining:**
  - Multi-process HARQ slots per node. Chase Combining preserves symbol energy across retransmissions $N_{\text{tx}}$:
    $$\text{SNR}_{\text{eff}} = \text{SNR}_0 + 10 \log_{10}(N_{\text{tx}})$$
- **Dynamic TDMA Guard Overhead:**
  - Dynamic guard interval scaled to real-time round-trip propagation time:
    $$\tau_{\text{guard}} = \frac{2 \cdot d_{\text{slant},\max}}{c} + \tau_{\text{sync}}$$
- **Live Output:** `cqi_lag_frames`, `mean_olla_offset_db`, `harq_retransmissions_total`, `harq_combined_gain_db`, `dynamic_guard_efficiency`.

### 3.4 Model 4: Kinematic Dubins Path Feasibility (`WP-07`)
- **Config Key:** `enableDubinsKinematics: boolean` (default: `false`).
- **Aerodynamic Turn Radius:**
  $$R_{\min} = \frac{V^2}{g \cdot \tan(\phi_{\max})} \quad (\phi_{\max} = 30^\circ)$$
- **Path Smoothing:** When enabled, feeds aircraft kinematic constraints ($\{ R_{\min}, \gamma_{\text{climb}}, \gamma_{\text{descent}} \}$) directly into `tacticalAiPathfinder.ts` waypoints for fixed-wing feasibility.
- **Live Output:** `dubins_min_turn_radius_m`.

### 3.5 Model 5: Viewshed Dual-Fidelity Engine (`WP-10`)
- **Config Key:** `viewshedFidelityMode: 'fast' | 'link-budget-parity'` (default: `'fast'`).
- **Link Budget Parity:** Computes exact ITU-R P.526 knife-edge, atmospheric absorption, rain loss, and body-fixed quad-sector antenna roll-off at every viewshed radial sample point instead of approximate empirical thresholding.

---

## 4. IPC Protocol Schema & Contracts

### 4.1 Inbound Commands (`src/shared/workerProtocol.ts`)
Additive optional fields on `ConfigUpdateParams`, `ConfigUpdateCommand`, and `SetScientificParamsCommand`:
```typescript
export interface HiFiPhysicsConfigFlags {
  readonly enableAirframeShadowing?: boolean;
  readonly enableCorrelatedRicianFading?: boolean;
  readonly enableMacPhyFeedback?: boolean;
  readonly enableDubinsKinematics?: boolean;
  readonly viewshedFidelityMode?: 'fast' | 'link-budget-parity';
}
```

### 4.2 Outbound Telemetry (`src/shared/workerProtocol.ts`)
Additive optional field on `TelemetryFrame`:
```typescript
export interface HiFiPhysicsTelemetry {
  readonly enabled_flags: {
    readonly enableAirframeShadowing: boolean;
    readonly enableCorrelatedRicianFading: boolean;
    readonly enableMacPhyFeedback: boolean;
    readonly enableDubinsKinematics: boolean;
    readonly viewshedFidelityMode: 'fast' | 'link-budget-parity';
  };
  readonly uav_roll_deg: number;
  readonly uav_pitch_deg: number;
  readonly mean_airframe_shadow_loss_db: number;
  readonly max_airframe_shadow_loss_db: number;
  readonly mean_correlated_fading_db: number;
  readonly coherence_time_ms: number;
  readonly cqi_lag_frames: number;
  readonly mean_olla_offset_db: number;
  readonly harq_retransmissions_total: number;
  readonly harq_combined_gain_db: number;
  readonly dynamic_guard_efficiency: number;
  readonly dubins_min_turn_radius_m: number;
}
```

---

## 5. UI Controls Specification (`index.html`)

Located inside `#tab-terrain` (`RF` tab) as a compact, industrial matte card `#hi-fi-physics-panel`:
- Header: `HIGH-FIDELITY PHYSICS ENGINE` with master toggle `#btn-hifi-all-toggle`.
- 5 labeled checkbox rows with real-time numeric telemetry readouts:
  1. `toggle-hifi-attitude`: Airframe Attitude & Shadowing (`#hifi-attitude-readout`)
  2. `toggle-hifi-rician`: Correlated 8 GHz Rician Fading (`#hifi-rician-readout`)
  3. `toggle-hifi-harq`: MAC/PHY Feedback & HARQ (`#hifi-harq-readout`)
  4. `toggle-hifi-dubins`: Dubins Turn Kinematics (`#hifi-dubins-readout`)
  5. `toggle-hifi-viewshed-parity`: Link-Budget Viewshed Parity (`#hifi-viewshed-readout`)
- Strict compliance with UI Design Rules: zero emojis, military-grade monochrome palette, font sizes $\ge 10\text{px}$, unambiguous `aria-label` tags.

---

## 6. Verification Suite Strategy (Suite 100)

`src/tests/verifyLiveHighFidelityWiring.ts` verifies:
1. **Default-OFF Baseline Invariant:** On worker startup, all 5 flags default to `false` / `'fast'`. Telemetry operates with standard link budgets.
2. **Individual & Joint Toggle Activation:** Validates each model activates independently and in combination via `CONFIG_UPDATE` / `UPDATE_CONFIG` / `SET_SCIENTIFIC_PARAMS`.
3. **Physical & Mathematical Sanity:**
   - Bank angle changes roll and triggers airframe shadow loss $> 0\text{ dB}$ on occluded aspect angles.
   - Correlated fading maintains expected variance and coherence time.
   - OLLA offset dynamically adapts when frame channel worsens.
   - Dubins turn radius matches $V^2 / (g \tan 30^\circ)$.
   - Viewshed parity produces link-budget matched SINR grid.
4. **50 Hz Loop Latency Budget:** 200 consecutive ticks with all 5 flags active execute comfortably in under $10\text{ ms/tick}$.
5. **Reset Invariant:** `SIM_CONTROL` with `reset` cleanly re-initializes all high-fidelity state maps without memory leaks.
6. **UI Contract Integrity:** Validates that `#hi-fi-physics-panel` and all 5 toggle IDs exist in `index.html` with valid DOM labels and 0 broken attributes.
