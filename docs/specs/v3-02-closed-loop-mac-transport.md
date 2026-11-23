# V3-02: True Closed-Loop MAC/PHY Scheduler Coupling, Transport AIMD Congestion Control & Adaptive ISR Video Bitrate (ABR)

**Specification Identifier:** `SPEC-V3-02-CLOSED-LOOP-MAC-TRANSPORT`  
**Milestone:** V3-02 (Frontier Milestone 2)  
**Parent Framework:** `AGENTS.md` (Authoritative Architecture & Discrete-Event Loop Invariants)  
**Status:** **APPROVED FOR IMPLEMENTATION**  

---

## 1. Executive Summary & Problem Formulation

In previous releases of the Tactical X-Band Air-to-Ground Network Digital Twin:
1. High-fidelity MAC/PHY feedback (delayed CQI aging, 3GPP Outer-Loop Link Adaptation (OLLA), HARQ process pool with Chase Combining, and dynamic TDMA guard time evaluation) operated primarily as a telemetry observer. The primary TDMA schedulers (`Tac-TAD` and `LegacyStatic`) scheduled full nominal link budget capacities, creating an open-loop discrepancy between physical channel impairments and MAC queue service rates.
2. In tactical airborne networks, link conditions fluctuate drastically due to aircraft maneuvers (up to $45^\circ$ bank angle defilade), mountain obstruction knife-edge diffraction, multi-biome ground multipath, and atmospheric fade. Fixed-bitrate tactical video streams (5QI 67) persistently overwhelm fading links, causing bufferbloat, head-of-line blocking, and packet delay drops that cripple concurrent mission-critical C2 (5QI 69) and PTT voice (5QI 65).
3. Traditional TCP congestion control suffers catastrophic throughput collapse over tactical wireless links because random RF packet errors are misinterpreted as buffer congestion. A tactical transport layer requires cross-layer coupling: rapid multiplicative decrease during true link or buffer loss, paired with an Adaptive Bitrate (ABR) application layer that steps video encoding rates up and down hysteretically to match physical channel capacity.

**Objective of V3-02:**
Author and deploy a pure, functional, deterministic engine (`src/core/transportAbrEngine.ts`) comprising:
- A 4-tier hysteretic ISR Video ABR ladder (`ISR_VIDEO_ABR_TIERS`) spanning 0.30 Mbps to 6.00 Mbps.
- A pure Transport Additive Increase / Multiplicative Decrease (AIMD) congestion controller with pacing rate and throttle scale calculation.
- A closed-loop effective capacity coupler computing instantaneous scheduler airtime scaling from dynamic guard overhead, slot collision outage, HARQ retransmission consumption, and residual BLER.
- Close the loop in `src/worker/simWorker.ts` so `enableMacPhyFeedback` genuinely modulates scheduler capacity and goodput, and `enableTransportAbr` modulates video traffic injection (5QI 67).
- Expose direct-manipulation UI controls in `index.html` and verify system performance via Suite 104 (`src/tests/verifyClosedLoopMacTransport.ts`).

---

## 2. Architectural Invariants & Constraints

1. **Active Authoritative Runtime:** Live simulation state (per-node AIMD congestion window, ABR tier, healthy frame streaks, and drop histories) lives exclusively within `SimulationWorkerManager` in `src/worker/simWorker.ts`. The UI thread remains purely a visualization and command dispatch layer.
2. **50 Hz Discrete-Event Budget ($\Delta t = 20\text{ ms}$):** Every function in `src/core/transportAbrEngine.ts` must execute in $< 3\,\mu\text{s}$ per call. A micro-benchmark of 10,000 combined evaluations must complete in $< 30\text{ ms}$.
3. **Pure Functional Determinism:** Zero `Math.random()`. No mutable module-level state. Functions must be pure state-in/state-out transformers, guarded against `NaN`, negative, or infinite values.
4. **Strict Backward Compatibility:** `enableMacPhyFeedback` and `enableTransportAbr` default to `false`. When disabled, scheduler and queue outputs remain bit-for-bit identical to baseline runs, guaranteeing that all 103 existing verification suites pass unmodified.
5. **Clean Simulation Reset:** All per-node AIMD and ABR states must be cleanly re-initialized or cleared on `RESET_SIM`.
6. **UI & Accessibility Standards:** Zero emojis, zero font sizes $< 10\text{px}$, zero duplicate IDs, proper `<label for="...">` accessibility associations in `index.html`.

---

## 3. Mathematical & Algorithmic Formulation

### 3.1 4-Tier ISR Video ABR Ladder & Hysteresis Thresholds

Tactical airborne Intelligence, Surveillance, and Reconnaissance (ISR) video streams operate across four standardized resolution and bitrate tiers defined in `ISR_VIDEO_ABR_TIERS`:

| Tier | Name | Target Bitrate ($R_{\text{target}}$) | Minimum SNR ($\gamma_{\text{min}}$) | Maximum BLER ($\text{BLER}_{\text{max}}$) | Max Queue Fill ($\rho_{\text{max}}$) | Tactical Operational Profile |
|---|---|---|---|---|---|---|
| **Tier 0** | `360P_LOW_BW` | $0.30\text{ Mbps}$ | $-1.5\text{ dB}$ | $1.00$ | $1.00$ | Severe jamming / deep mountain defilade survivor mode |
| **Tier 1** | `720P_TAC` | $1.00\text{ Mbps}$ | $+4.0\text{ dB}$ | $0.18$ | $0.75$ | Degraded tactical video / long-range standoff |
| **Tier 2** | `1080P_HD` | $2.50\text{ Mbps}$ | $+9.0\text{ dB}$ | $0.10$ | $0.55$ | Baseline standard tactical ISR high-definition video |
| **Tier 3** | `4K_EO_IR` | $6.00\text{ Mbps}$ | $+14.0\text{ dB}$ | $0.05$ | $0.35$ | Optimal line-of-sight close-range sensor payload downlink |

#### Immediate Fast Step-Down Policy
Tactical networks cannot tolerate bufferbloat or dropped C2 packets while waiting for slow filtering. If any critical impairment threshold is violated:
$$\text{Degraded} \iff \text{isOutage} \lor \gamma_{\text{actual}} < \gamma_{\text{min}}(k) \lor \text{BLER} > \text{BLER}_{\text{max}}(k) \lor \rho > \rho_{\text{max}}(k)$$
where $k \in \{0, 1, 2, 3\}$ is the current tier index, and $\rho = \frac{Q_{\text{bytes}}}{Q_{\text{capacity}}}$ is the 5QI-67 queue fill ratio.

Upon degradation:
1. If $\text{isOutage} = \text{true}$, tier immediately drops to **Tier 0** ($k \leftarrow 0$).
2. Otherwise, the algorithm scans descending tiers $j \in \{k-1, \dots, 0\}$ and selects the highest tier satisfying all three sustainability criteria:
   $$\gamma_{\text{actual}} \ge \gamma_{\text{min}}(j) \quad \land \quad \text{BLER} \le \text{BLER}_{\text{max}}(j) \quad \land \quad \rho \le \rho_{\text{max}}(j)$$
   If no tier satisfies the conditions, the system defaults to Tier 0.
3. The healthy frame counter is immediately reset: $\text{healthyStreak} \leftarrow 0$.
4. Transition action is flagged as `'down'`.

#### Conservative Hysteretic Step-Up Policy
To prevent rapid flapping and bitrate oscillation across fading boundaries, upgrading from tier $k$ to tier $k+1$ requires meeting strict hysteretic safety margins sustained across a hold window of $H = 15$ consecutive discrete simulation frames ($300\text{ ms}$ at $50\text{ Hz}$):
$$\gamma_{\text{actual}} \ge \gamma_{\text{min}}(k+1) + \Delta \gamma_{\text{hyst}} \quad (\Delta \gamma_{\text{hyst}} = 2.0\text{ dB})$$
$$\text{BLER} \le \text{BLER}_{\text{max}}(k+1) \times 0.70$$
$$\rho \le \rho_{\text{max}}(k+1) \times 0.80$$

If all three conditions are satisfied:
- $\text{healthyStreak} \leftarrow \text{healthyStreak} + 1$.
- If $\text{healthyStreak} \ge H$:
  - $k \leftarrow k + 1$
  - $\text{healthyStreak} \leftarrow 0$
  - Transition action is flagged as `'up'`.
- Else:
  - Transition action is `'hold'`.
If any condition fails:
- $\text{healthyStreak} \leftarrow 0$.
- Transition action is `'hold'`.

---

### 3.2 Transport AIMD Congestion Control Dynamics

The transport-layer congestion control maintains a per-node state:
$$\mathcal{S}_{\text{AIMD}} = \langle W_{\text{cwnd}}, W_{\text{ssthresh}}, \text{phase}, R_{\text{pacing}}, S_{\text{throttle}} \rangle$$
initialized to $W_{\text{cwnd}} = 4\text{ packets}$, $W_{\text{ssthresh}} = 32\text{ packets}$, and $\text{phase} = \text{'slow\_start'}$.

#### Multiplicative Decrease (Loss Event)
If packet losses are detected in the current transmission frame ($N_{\text{lost}} > 0$):
$$W_{\text{ssthresh}} \leftarrow \max\left(W_{\text{min}}, W_{\text{cwnd}} \times \beta\right) \quad (\beta = 0.5, W_{\text{min}} = 1)$$
$$W_{\text{cwnd}} \leftarrow W_{\text{ssthresh}}$$
$$\text{phase} \leftarrow \text{'recovery'}$$

#### Additive Increase (Acked Packets)
If no losses occur and $N_{\text{acked}} > 0$:
1. **Slow-Start Phase** ($W_{\text{cwnd}} < W_{\text{ssthresh}}$):
   $$W_{\text{cwnd}} \leftarrow \min\left(W_{\text{max}}, W_{\text{cwnd}} + N_{\text{acked}}\right) \quad (W_{\text{max}} = 128)$$
   $$\text{phase} \leftarrow \text{'slow\_start'}$$
2. **Congestion Avoidance Phase** ($W_{\text{cwnd}} \ge W_{\text{ssthresh}}$):
   $$W_{\text{cwnd}} \leftarrow \min\left(W_{\text{max}}, W_{\text{cwnd}} + \frac{N_{\text{acked}}}{\max(1, W_{\text{cwnd}})}\right)$$
   $$\text{phase} \leftarrow \text{'congestion\_avoidance'}$$

#### Pacing Rate & Throttle Scaling
The pacing rate in Megabits per second is computed from the current congestion window and round-trip time:
$$R_{\text{pacing}} = \frac{W_{\text{cwnd}} \times \text{MSS} \times 8}{\max(1, \text{RTT}_{\text{ms}}) \times 1000} \quad (\text{MSS} = 1200\text{ bytes})$$
The normalized transmission throttle scale is bounded in $[0.10, 1.00]$:
$$S_{\text{throttle}} = \text{clamp}\left(\frac{W_{\text{cwnd}}}{W_{\text{max}}}, 0.10, 1.00\right)$$

---

### 3.3 Closed-Loop MAC/PHY Capacity Coupling Math

When `enableMacPhyFeedback` is active, the raw link budget capacity cannot be treated as $100\%$ deliverable. The true closed-loop capacity scale $\eta_{\text{closed\_loop}} \in [0.0, 1.0]$ combines four physical and MAC factors:

$$\eta_{\text{closed\_loop}} = \begin{cases} 
0.0 & \text{if } \text{slotCollisionOutage} = \text{true} \\
\text{clamp}\left(\eta_{\text{guard}} \times \eta_{\text{retx}} \times \eta_{\text{delivery}}, 0.0, 1.0\right) & \text{otherwise}
\end{cases}$$

Where:
1. **Timing Advance Collision Outage ($\text{slotCollisionOutage}$):** If slant range exceeds the maximum propagation delay absorbable by the timing advance window, pulses collide with adjacent slots, causing total airtime collapse ($\eta = 0.0$).
2. **Dynamic Guard Interval Efficiency ($\eta_{\text{guard}}$):** Derived from `computeDynamicTdmaOverhead`, accounting for slant range propagation delay and RF switching overhead ($\eta_{\text{guard}} \le 1.0$).
3. **HARQ Retransmission Airtime Penalty ($\eta_{\text{retx}}$):** If an active HARQ retransmission is scheduled (`harqActiveRetx = true`), half of the slot's transport blocks are dedicated to re-sending unacknowledged data, consuming $50\%$ of novel payload airtime:
   $$\eta_{\text{retx}} = \begin{cases} 0.50 & \text{if HARQ retransmission active} \\ 1.00 & \text{otherwise} \end{cases}$$
4. **Residual BLER Delivery Factor ($\eta_{\text{delivery}}$):** Errored transport blocks cannot be successfully decoded at the receiver:
   $$\eta_{\text{delivery}} = \text{clamp}\left(1.0 - \text{BLER}_{\text{delayed\_cqi}}, 0.0, 1.0\right)$$

#### Application to Schedulers
The effective physical bitrate $R_{\text{eff}, i}$ for node $i$ fed into both `LegacyStaticScheduler` and `TerrainAwareDynamicScheduler` (`Tac-TAD`) is:
$$R_{\text{eff}, i} = R_{\text{phy}, i} \times \eta_{\text{closed\_loop}, i}$$
This directly scales the dequeued bytes $\text{capBytes} = \left\lfloor \frac{\tau_i \times R_{\text{eff}, i}}{8} \right\rfloor$, ensuring that goodput, queue backlogs, delay drops, and Lyapunov urgency metrics respond genuinely in closed loop.

---

### 3.4 Adaptive Traffic Generation Coupling

In `src/core/queues.ts`, `generateTraffic` accepts an optional `videoBitrateScale` parameter:
$$S_{\text{video}} = \frac{R_{\text{target}}(k)}{R_{\text{baseline}}} \quad (R_{\text{baseline}} = 2.50\text{ Mbps})$$
The Poisson packet generation rate for 5QI 67 becomes:
$$\lambda_{67} = \lambda_{\text{mean}} \times \text{trafficLoadMultiplier} \times S_{\text{video}}$$
When `videoBitrateScale` is omitted or $1.0$, $S_{\text{video}} = 1.0$, preserving identical baseline behavior.

---

## 4. Telemetry Schema & IPC Contracts

### 4.1 Transport ABR Telemetry Block
Appended additively to `TelemetryFrame` in `src/shared/workerProtocol.ts`:

```typescript
export interface TransportAbrTelemetry {
  readonly enabled: boolean;
  readonly mean_cwnd_packets: number;
  readonly mean_video_bitrate_mbps: number;
  readonly active_video_tier_label: string;
  readonly abr_step_downs: number;
  readonly abr_step_ups: number;
  readonly mean_closed_loop_capacity_scale: number;
}
```

### 4.2 Configuration Flags
Added as optional properties to `HiFiPhysicsConfigFlags`, `ConfigUpdateParams`, and `workerCommandValidators.ts`:
- `enableTransportAbr?: boolean` (defaults to `false`).

---

## 5. UI Controls & DOM Specifications (`index.html`)

Added inside `#hi-fi-physics-panel`:
```html
<div class="inspector-metric" style="display:flex;flex-direction:column;gap:6px;padding:8px;background:var(--lo-bg-card,#12161f);border:1px solid var(--lo-line,#1e2638);border-radius:3px;">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
    <label for="toggle-hifi-abr" style="font-size:11px;font-weight:600;color:var(--lo-text-bright,#e6edf3);cursor:pointer;display:flex;align-items:center;gap:6px;">
      <input type="checkbox" id="toggle-hifi-abr" onchange="onHiFiToggleChange('enableTransportAbr', this.checked)" aria-label="Enable Transport AIMD and Adaptive Video Bitrate" style="cursor:pointer;">
      Transport AIMD &amp; ABR (V3-02)
    </label>
  </div>
  <span style="font-size:10px;color:var(--lo-text-muted,#8b949e);">AIMD congestion control &amp; 4-tier ISR video ladder</span>
  <strong id="hifi-abr-readout" class="c-acc" style="font-size:10.5px;font-family:var(--lo-mono,monospace);color:var(--lo-accent,#38bdf8);">Off (Fixed Bitrate)</strong>
</div>
```

- Included in `toggleAllHiFiPhysics()` toggle cascade.
- Updated dynamically in `updateHiFiPhysicsUI()` to display active tier name, bitrate, average congestion window, and capacity scale.
- Completely free of emojis, zero font sizes $< 10\text{px}$, and zero duplicate IDs.

---

## 6. Verification Test Suite Architecture (Suite 104)

`src/tests/verifyClosedLoopMacTransport.ts` executes 4 rigorous verification targets:

1. **[CLT-T1] AIMD Slow-Start, Congestion Avoidance & Multiplicative Backoff:**
   - Tests exponential slow-start doubling ($4 \to 8 \to 16 \to 32$).
   - Tests linear increase in congestion avoidance ($32 \to 33$).
   - Tests exact $50\%$ multiplicative backoff on loss ($32 \to 16$).
   - Tests boundary clamping $[1, 128]$ and `NaN`/negative input safety.

2. **[CLT-T2] ABR Fast Step-Down & Anti-Oscillation Hysteresis:**
   - Tests immediate step-down from Tier 2 to Tier 0 on severe fade ($-10\text{ dB}$) or outage.
   - Tests immediate step-down on queue congestion ($85\%$ fill).
   - Tests zero premature step-up during frames $1 \dots 14$ under favorable channel conditions.
   - Tests clean single-tier step-up at frame $15$ with healthy streak reset.

3. **[CLT-T3] True Closed-Loop Scheduler Impact Proof (Live Worker):**
   - Runs `SimulationWorkerManager` across 3 arms over 120 frames with identical traffic:
     - **Arm A (Baseline):** `enableMacPhyFeedback: false`, `enableTransportAbr: false`.
     - **Arm B (Closed-Loop MAC/PHY):** `enableMacPhyFeedback: true`, `enableTransportAbr: false`.
       Asserts primary `Tac-TAD` delivered goodput (`totalBitsTransmitted`) **genuinely differs** from Arm A and $\text{mean\_closed\_loop\_capacity\_scale} < 1.0$.
     - **Arm C (Closed-Loop + ABR):** `enableMacPhyFeedback: true`, `enableTransportAbr: true`.
       Asserts `transport_abr_telemetry` populates finite `mean_cwnd_packets`, `mean_video_bitrate_mbps`, valid tier label, and non-zero step activity.

4. **[CLT-T4] Determinism, `RESET_SIM` Cleanup, UI Labels & Micro-Benchmark:**
   - Two independent runs produce bit-for-bit identical telemetry frames.
   - `RESET_SIM` resets all AIMD/ABR maps and step counters to zero.
   - Validates `#toggle-hifi-abr`, `<label for>`, and styling in `index.html`.
   - Executes 10,000 combined AIMD + ABR + coupler evaluations in $< 30\text{ ms}$ ($< 3\,\mu\text{s/call}$).
