# SPEC-WP06: MAC/PHY Feedback Dynamics — Delayed-CQI AMC with OLLA, RTT-Delayed HARQ Chase Combining & Incremental Redundancy, Dynamic TDMA Guard Overhead

**Specification Document:** `docs/specs/wp06-mac-phy-feedback-dynamics.md`  
**Status:** Approved  
**Execution Lead:** Role 2 Coder / Implementer  
**Classification:** MAC/PHY Protocol Dynamics / AMC & HARQ / TDMA Guard Optimization / 50 Hz Web Worker Invariants  
**Applies to Modules:** `src/core/macPhyFeedback.ts`, `src/core/tdmaConfig.ts`, `src/core/scheduler.ts`, `src/tests/verifyMacPhyFeedback.ts`  

---

## 1. Executive Summary & Zero-Duplication Audit

### 1.1 Context & Background
In airborne tactical Non-Terrestrial Networks (NTN) operating in high-relief mountainous environments (e.g. Ladakh sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$), physical link dynamics are strongly influenced by round-trip propagation times over long slant ranges ($10\text{ km} \le d_{\text{slant}} \le 200\text{ km}$) and rapid terrain-induced fading. Traditional terrestrial cellular assumptions of negligible propagation delay and instantaneous channel state feedback breakdown in this regime:
1. **CQI Aging & Stale AMC:** Link quality measurements reported by ground stations experience significant round-trip feedback latency ($L_{\text{CQI}} \ge \lceil (2 d_{\text{slant}}/c + T_{\text{proc}})/T_{\text{frame}} \rceil$). Selecting Modulation and Coding Schemes (MCS) based on uncompensated stale CQI causes severe rate overshoot and catastrophic packet drops during sudden shadow fades.
2. **Outer-Loop Link Adaptation (OLLA):** An adaptive SNR offset must dynamically adjust the reported CQI based on ACK/NACK feedback to stabilize the Transport Block Error Rate (BLER) around a target operating point (e.g., $P_{\text{target}} = 10\%$).
3. **Long-RTT Hybrid ARQ (HARQ):** Airborne propagation distances introduce an explicit RTT turnaround barrier before retransmissions can be dispatched. Retransmitted packets combine energy with prior attempts via Chase Combining (linear energy addition) or Incremental Redundancy (additional LDPC code rate gain).
4. **Slant-Range & TA-Coupled TDMA Guard Overhead:** Inter-slot guard intervals must protect against multi-node arrival timing disparities. When closed-loop Timing Advance (TA) is locked, guard time covers residual tracking error $\epsilon_{\text{TA}}$; when TA is lost (open-loop RACH), guard time must absorb the full two-way round-trip propagation delay ($2 d_{\text{slant}} / c$), drastically reducing slot efficiency or causing slot collision outage. Dedicated RACH control slots further constrain payload capacity.

### 1.2 Zero-Duplication Codebase Audit
Before authoring any new code, a comprehensive audit across existing repository modules was conducted:
- **`src/core/linkBudget.ts`:** Houses the authoritative DVB-S2X / 3GPP Rel-17 discrete 8-state MODCOD table (`MODCOD_TABLE` and `ModCodEntry`), ranging from $\pi/2$-BPSK 1/3 ($-1.5\text{ dB}$, $0.33\text{ bps/Hz}$) up to 64-APSK 5/6 ($22.0\text{ dB}$, $4.95\text{ bps/Hz}$). Also contains `computeRicianMultipathFading()`. **Mandate:** `MODCOD_TABLE` must be imported directly—zero re-declaration or duplication.
- **`src/core/config.ts` & `src/core/rfPropagationMath.ts`:** Export the canonical speed of light constant `SPEED_OF_LIGHT` / `SPEED_OF_LIGHT_M_S` ($299,792,458\text{ m/s}$). **Mandate:** Reuse canonical constants directly.
- **`src/core/ntnSignalingEngine.ts`:** Implements 3GPP TS 38.213 Timing Advance index math (`computeTimingAdvanceIndex`, `TA_STEP_US = 0.26 µs`) and 4-step RACH procedures. Models signaling call flows, but does not provide pure mathematical link adaptation, HARQ combining pools, or dynamic TDMA frame guard sizing.
- **`src/core/tdmaConfig.ts`:** Implements static frame structures (`TdmaFrameConfig`, `guardIntervalUs = 12.0 µs`). Does not dynamically couple guard intervals to slant range or TA status.
- **`src/core/scheduler.ts`:** Houses `LegacyStaticScheduler` and `TerrainAwareDynamicScheduler` (`Tac-TAD`). Schedules slots based on instantaneous link budget rates.
- **`src/tests/verifyRicianFadingAndCqiAging.ts` (Suite 30):** Evaluates end-to-end simulation worker behavior with a fixed 40 ms buffer delay, but does not provide a pure, standalone, unit-testable mathematical engine for closed-loop AMC with OLLA, HARQ combining gains, or range-dependent guard overhead.
- **Architectural Seam:** WP-06 introduces `src/core/macPhyFeedback.ts` as a pure, stateless functional engine with zero mutable global state, deterministic pseudo-random hashing, and $< 5\text{ µs}$ execution budget per 50 Hz tick. Non-breaking hooks are wired into `tdmaConfig.ts` and `scheduler.ts`.

---

## 2. Mathematical Formulations & Algorithms

### 2.1 Feedback Delay & CQI Aging Model
The round-trip delay for channel quality reporting includes two-way slant range propagation delay and baseband processing turnaround:
$$\tau_{\text{feedback}} = \frac{2 d_{\text{slant}}}{c} + T_{\text{proc}}$$
Given superframe duration $T_{\text{frame}}$ (default $20\text{ ms}$) and processing delay $T_{\text{proc}}$ (default $4.0\text{ ms}$):
$$L_{\text{CQI}} = \max\left(1, \left\lceil \frac{\frac{2 d_{\text{slant}}}{c} \cdot 1000 + T_{\text{proc}}}{T_{\text{frame}}} \right\rceil\right)$$
If genie-aided instantaneous CSI is requested (`genieAided === true`), $L_{\text{CQI}} = 0$.

### 2.2 3GPP Outer-Loop Link Adaptation (OLLA)
Outer-loop link adaptation maintains an adaptive SNR backoff offset $\Delta_{\text{OLLA}}$ based on transport block ACK/NACK feedback to ensure the steady-state error rate tracks $P_{\text{target}}$ (typically $10\%$):
$$\Delta_{\text{OLLA}}^{(k+1)} = \begin{cases}
\Delta_{\text{OLLA}}^{(k)} - \Delta_{\text{up}} \cdot \frac{P_{\text{target}}}{1 - P_{\text{target}}}, & \text{if ACK} \\
\Delta_{\text{OLLA}}^{(k)} + \Delta_{\text{up}}, & \text{if NACK}
\end{cases}$$
where $\Delta_{\text{up}}$ is the step-up penalty (default $0.25\text{ dB}$).
The effective reported SNR utilized by Adaptive Modulation and Coding (AMC) is:
$$\gamma_{\text{eff}} = \gamma_{\text{rep}} - \Delta_{\text{OLLA}}$$
$\Delta_{\text{OLLA}}$ is strictly clamped to $[\Delta_{\min}, \Delta_{\max}]$ (default $[-3.0\text{ dB}, +12.0\text{ dB}]$).

### 2.3 Logistic Waterfall BLER Model & AMC Selection
Given $\gamma_{\text{eff}}$, the scheduler selects the highest operational MODCOD $m_{\text{sched}} \in \text{MODCOD\_TABLE}$ such that $\gamma_{\text{eff}} \ge \gamma_{\text{req}}(m_{\text{sched}})$. If $\gamma_{\text{eff}} < \min \gamma_{\text{req}}$, a link outage condition is declared ($m_{\text{sched}} = \text{null}$).

When actual transmission occurs at true physical SNR $\gamma_{\text{actual}}$, the transport block BLER is evaluated via the standard smooth logistic waterfall curve:
$$\text{BLER}(\gamma_{\text{actual}}, \gamma_{\text{req}}) = \frac{1}{1 + \exp\left(k_{\text{slope}} \cdot (\gamma_{\text{actual}} - \gamma_{\text{req}})\right)}$$
where $k_{\text{slope}}$ is the LDPC waterfall steepness factor (default $2.2\text{ dB}^{-1}$).
The SNR margin is $\Delta\gamma = \gamma_{\text{actual}} - \gamma_{\text{req}}$. If $\Delta\gamma < 0$, MCS overshoot occurs:
$$\text{Overshoot}_{\text{dB}} = \max(0, \gamma_{\text{req}} - \gamma_{\text{actual}})$$

### 2.4 RTT-Delayed HARQ Process Pool with Chase Combining & Incremental Redundancy
#### 2.4.1 Turnaround Barrier
A retransmission cannot be scheduled until the acknowledgment round-trip and hardware decoding turnaround have elapsed:
$$t_{\text{earliest}} = t_{\text{last\_tx}} + \frac{2 d_{\text{slant}}}{c} \cdot 1000 + T_{\text{turnaround}}$$
If current time $t < t_{\text{earliest}}$, the process returns `TX_PENDING_RTT` with wait time $t_{\text{earliest}} - t$.

#### 2.4.2 Combining SNR Gain
For transmission attempts with physical SNRs $\gamma_0, \gamma_1, \dots, \gamma_k$:
- **Chase Combining (CC):** Linear energy addition across repeated identical code symbols:
  $$\gamma_{\text{CC}} = 10 \log_{10}\left(\sum_{j=0}^{k} 10^{\gamma_j / 10}\right)$$
  For equal SNRs $\gamma_j = \gamma$:
  - 2 transmissions: $\gamma + 10 \log_{10}(2) = \gamma + 3.0103\text{ dB}$
  - 3 transmissions: $\gamma + 10 \log_{10}(3) = \gamma + 4.7712\text{ dB}$
  - 4 transmissions: $\gamma + 10 \log_{10}(4) = \gamma + 6.0206\text{ dB}$
- **Incremental Redundancy (IR):** In addition to Chase energy summation, punctured parity bits provide monotonic coding gain $\Delta_{\text{IR}}(k)$:
  $$\gamma_{\text{IR}} = \gamma_{\text{CC}} + \Delta_{\text{IR}}(k)$$
  where $\Delta_{\text{IR}}(0) = 0.0\text{ dB}$, $\Delta_{\text{IR}}(1) = 1.0\text{ dB}$, and $\Delta_{\text{IR}}(k \ge 2) = 1.5\text{ dB}$.

#### 2.4.3 Deterministic Hash-Based PRNG
To strictly prohibit mutable random state and `Math.random()` in the Web Worker, stochastic BLER trials use a 32-bit Murmur/SplitMix-style integer hash:
$$h = \operatorname{hash32}(\text{seed}, \text{frameIndex}, \text{processId}, \text{txCount})$$
$$u = \frac{h}{2^{32}} \in [0, 1)$$
If $u \ge \text{BLER}$, the block is decoded (`ACK`); if $u < \text{BLER}$, decode fails (`NACK`). Exhausting `maxRetransmissions` transitions the process to `HARQ_FAILURE`.

### 2.5 Range-Coupled Dynamic TDMA Guard & RACH Control Overhead
Let slot duration be $\tau_{\text{slot}} = T_{\text{slot}} \cdot 1000\text{ µs}$ and superframe have $N_{\text{slots}}$ slots.
1. **Required Guard Interval:**
   - **Timing Advance Locked (`timingAdvanceActive === true`):**
     $$\tau_{\text{guard}} = \max\left(\tau_{\text{switch}}, \frac{2 \cdot \epsilon_{\text{TA}}}{c} \cdot 10^6 + \tau_{\text{switch}}\right)$$
   - **Timing Advance Lost / Open-Loop (`timingAdvanceActive === false`):**
     $$\tau_{\text{guard}} = \frac{2 \cdot d_{\text{slant}}}{c} \cdot 10^6 + \tau_{\text{switch}}$$
2. **Usable Slot Duration:**
   $$\tau_{\text{usable}} = \max(0, \tau_{\text{slot}} - \tau_{\text{guard}} - \tau_{\text{preamble}})$$
3. **Slot Collision Outage:**
   $$\text{isOutage} = (\tau_{\text{guard}} + \tau_{\text{preamble}} \ge \tau_{\text{slot}}) \iff (\tau_{\text{usable}} \le 0)$$
4. **Data Slots & Frame Efficiency:**
   $$N_{\text{control}} = \operatorname{clamp}(N_{\text{RACH}}, 0, N_{\text{slots}})$$
   $$N_{\text{data}} = \max(0, N_{\text{slots}} - N_{\text{control}})$$
   $$\eta_{\text{slot}} = \frac{\tau_{\text{usable}}}{\tau_{\text{slot}}}$$
   $$\eta_{\text{frame}} = \begin{cases}
   0.0, & \text{if } \text{isOutage} \\
   \eta_{\text{slot}} \cdot \frac{N_{\text{data}}}{N_{\text{slots}}}, & \text{otherwise}
   \end{cases}$$

---

## 3. Pure Interface Contracts (`src/core/macPhyFeedback.ts`)

```typescript
export interface EvaluateDelayedCqiAmcParams {
  readonly reportedSnrDb: number;
  readonly actualSnrDb: number;
  readonly ollaOffsetDb?: number;
  readonly kSlope?: number;
}

export interface DelayedCqiAmcResult {
  readonly selectedModcod: ModCodEntry | null;
  readonly effectiveReportedSnrDb: number;
  readonly snrMarginDb: number;
  readonly bler: number;
  readonly mcsOvershootDb: number;
  readonly isLinkOutage: boolean;
}

export type HarqCombiningMode = 'chase' | 'ir';
export type HarqProcessState = 'IDLE' | 'WAITING_RTT' | 'COMPLETED';
export type HarqStepEvent = 'IDLE' | 'TX_PENDING_RTT' | 'ACK' | 'NACK_RETRY_SCHEDULED' | 'HARQ_FAILURE';

export interface HarqProcessSlot {
  readonly processId: number;
  readonly state: HarqProcessState;
  readonly txCount: number;
  readonly lastTxTimeMs: number;
  readonly snrHistoryDb: readonly number[];
}

export interface StepHarqParams {
  readonly currentTimeMs: number;
  readonly slantRangeM: number;
  readonly actualSnrDb: number;
  readonly requiredSnrDb: number;
  readonly combiningMode?: HarqCombiningMode;
  readonly maxRetransmissions?: number;
  readonly processingTurnaroundMs?: number;
  readonly frameIndex?: number;
  readonly seed?: number;
  readonly kSlope?: number;
}

export interface StepHarqResult {
  readonly nextSlot: HarqProcessSlot;
  readonly event: HarqStepEvent;
  readonly combinedSnrDb: number;
  readonly bler: number;
  readonly rttWaitMs: number;
}

export interface DynamicTdmaOverheadParams {
  readonly slotDurationMs: number;
  readonly slotsPerFrame: number;
  readonly slantRangeM: number;
  readonly timingAdvanceActive: boolean;
  readonly taResidualErrorM?: number;
  readonly rfSwitchGuardUs?: number;
  readonly preambleUs?: number;
  readonly rachControlSlotsPerFrame?: number;
}

export interface DynamicTdmaOverheadResult {
  readonly requiredGuardUs: number;
  readonly propagationRttUs: number;
  readonly usableSlotUs: number;
  readonly slotCollisionOutage: boolean;
  readonly dataSlotsPerFrame: number;
  readonly controlSlotsPerFrame: number;
  readonly slotEfficiency: number;
  readonly frameDataEfficiency: number;
}
```

---

## 4. Verification Suite Architecture (`src/tests/verifyMacPhyFeedback.ts`)

Suite 90 validates six core physical propositions:
1. **Section 1: Delayed CQI Overshoot vs. Genie-Aided AMC:** Proves that an abrupt $-8\text{ dB}$ channel fade causes severe MCS overshoot and transient BLER spikes under delayed CQI ($L=2$), whereas genie-aided ($L=0$) switches immediately. Validates OLLA convergence back to $P_{\text{target}} = 10\%$ over 500 frames under persistent $+3\text{ dB}$ CQI estimation bias.
2. **Section 2: Long-RTT HARQ Turnaround Gating:** Proves that at $200\text{ km}$ ($\text{RTT} \approx 1.334\text{ ms}$, $T_{\text{proc}} = 2.0\text{ ms}$), retransmission attempts at $t = 2.0\text{ ms}$ and $t = 3.30\text{ ms}$ are gated as `TX_PENDING_RTT`, permitting transmission at $t = 3.35\text{ ms}$.
3. **Section 3: Chase Combining Energy Conservation & IR Gain:** Proves exact analytical multi-transmission energy addition ($+3.0103\text{ dB}$, $+4.7712\text{ dB}$, $+6.0206\text{ dB}$ to $< 10^{-4}\text{ dB}$) and verifies incremental redundancy coding gain. Confirms `HARQ_FAILURE` upon exceeding `maxRetransmissions`.
4. **Section 4: Dynamic TDMA Guard Overhead & TA Loss Collapse:** Proves that at $200\text{ km}$ with $1.0\text{ ms}$ slots, closed-loop TA preserves $> 85\%$ slot efficiency, while TA loss causes two-way RTT ($1334\text{ µs} > 1000\text{ µs}$) to trigger full slot collision outage (`frameDataEfficiency === 0.0`). Proves 2-slot RACH allocation yields an exact 20% throughput penalty.
5. **Section 5: Determinism, Robustness & Integration Hooks:** Verifies bit-exact determinism across identical seeds, robustness against `NaN`, negative distances, and edge cases, and end-to-end delegation through `tdmaConfig.ts` and `scheduler.ts`.
6. **Section 6: 50 Hz Performance Micro-Benchmark:** 10,000 iterations of combined feedback calculations complete in $< 50\text{ ms}$ ($< 5\text{ µs/call}$), comfortably fitting within the $20\text{ ms}$ loop budget.
