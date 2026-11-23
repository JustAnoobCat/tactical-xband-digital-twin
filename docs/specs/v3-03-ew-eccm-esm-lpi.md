# V3-03: Defense EW / ECCM, MVDR Spatial Null-Steering, Adversary ESM/ELINT LPI Engine & GNSS Timing Spoofing

**Specification Identifier:** `SPEC-V3-03-EW-ECCM-ESM-LPI`  
**Milestone:** V3-03 (Frontier Milestone 3)  
**Parent Framework:** `AGENTS.md` (Authoritative Architecture & Discrete-Event Loop Invariants)  
**Status:** **APPROVED FOR IMPLEMENTATION**  

---

## 1. Executive Summary & Problem Formulation

In high-intensity electronic warfare (EW) environments such as the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$), tactical airborne networks operate under multifaceted electromagnetic contested conditions:
1. **High-Power Ground Jammers:** Ground-based electronic countermeasure (ECM) emitters inject severe barrage or partial-band noise into airborne receiver antennas, degrading physical Signal-to-Interference-plus-Noise Ratio (SINR) and driving modulations down to `QPSK 1/4` or complete link outage.
2. **Spread Spectrum Electronic Counter-Countermeasures (ECCM):** To maintain survivable communications under high-power jamming, tactical waveforms employ Direct Sequence Spread Spectrum (DSSS) or Frequency Hopping Spread Spectrum (FHSS). The processing gain $G_p$ suppresses wideband and partial-band jammer power spectral density by spreading the signal across wide RF bandwidths.
3. **Phased Array Spatial Filtering (MVDR Null-Steering):** When jammer azimuth deviates from the desired communication peer, Minimum Variance Distortionless Response (MVDR) adaptive beamforming steers deep angular nulls ($25\text{ dB}$) toward the jammer, rejecting interference while maintaining distortionless unit gain on the desired boresight.
4. **Adversary ESM / ELINT Interception & Low Probability of Intercept (LPI):** Adversary Electronic Support Measures (ESM) stations monitor RF emissions across the tactical theater. To prevent adversary geodetic localization and targeting, friendly airborne nodes must calculate their LPI Safety Margin, adversary detection radius ($R_{\text{det}}$), and intercept probability ($P_I$).
5. **Adversary GNSS Timing Spoofing:** Modern adversaries employ false GNSS signals to induce deliberate timing drift on airborne and ground nodes. Because Time-Division Multiple Access (TDMA) relies on microsecond-accurate Timing Advance (TA) to prevent uplink slot collisions, unmitigated timing drift collapses usable guard intervals, inducing catastrophic frame collisions unless atomic/OCXO holdover filters intervene.

**Objective of V3-03:**
Implement an authoritative, deterministic, pure mathematical engine (`src/core/ewEccmEngine.ts`) modeling:
- DSSS and FHSS processing gain with partial-band jammer penalty.
- MVDR spatial null-steering with $C^1$ continuous raised-cosine transition and shortest-arc angular wrap.
- Joint EW jammer mitigation combining spatial nulling and spread spectrum gains.
- Adversary ESM/ELINT interception radius and logistic intercept probability adhering strictly to inverse-square propagation.
- GNSS timing spoofing TA drift injection coupled closed-loop to TDMA slot collision models, with OCXO holdover resilience.
- Wire these features opt-in into the 50 Hz discrete simulation loop in `src/worker/simWorker.ts`.
- Expose compact, accessible direct-manipulation controls in `index.html` and verify system behavior in Suite 105 (`src/tests/verifyEwEccmAndLpi.ts`).

---

## 2. Architectural Invariants & Constraints

1. **Active Authoritative Runtime:** All mutable simulation state (accumulated GNSS spoofing drift, active ECCM configurations, jammer mitigation states) resides exclusively within `SimulationWorkerManager` in `src/worker/simWorker.ts`.
2. **50 Hz Discrete-Event Budget ($\Delta t = 20\text{ ms}$):** All computations in `src/core/ewEccmEngine.ts` must execute in $< 3\,\mu\text{s}$ per call. A micro-benchmark of 10,000 evaluations must complete in $< 30\text{ ms}$.
3. **Pure Functional Determinism:** Functions must be 100% deterministic, free of `Math.random()`, free of mutable module-level state, guarded against `NaN`, infinite, or negative inputs.
4. **Strict Backward Compatibility:** All flags (`eccmMode: 'NONE'`, `enableMvdrNullSteering: false`, `enableAdversaryEsmModel: false`, `gnssSpoofingRateUsPerSec: 0`, `enableAntiSpoofHoldover: false`) default to disabled/zero. All 104 prior verification suites must remain 100% bit-for-bit identical.
5. **Clean Simulation Reset:** On `RESET_SIM`, all EW/ECCM telemetry and accumulated GNSS timing drift must reset cleanly to initial states.
6. **UI & Accessibility Standards:** Zero emojis, zero font sizes $< 10\text{px}$, zero duplicate IDs, proper `<label for="...">` associations and compact layout within `#tab-terrain` (`RF` tab) in `index.html`.

---

## 3. Mathematical & Algorithmic Formulation

### 3.1 Spread Spectrum ECCM Processing Gain ($G_p$)

Spread spectrum techniques distribute signal power across a RF bandwidth $W_{\text{ss}}$ significantly wider than the minimum information bandwidth $W_{\text{sig}}$:

$$\text{Bandwidth Ratio} = \frac{W_{\text{ss}}}{W_{\text{sig}}}$$

1. **Direct Sequence Spread Spectrum (DSSS):**
   The theoretical processing gain in decibels is:
   $$G_{p,\text{DSSS}} = 10 \log_{10}\left(\max\left(1, \frac{W_{\text{ss}}}{W_{\text{sig}}}\right)\right)$$
   For a spreading bandwidth of $W_{\text{ss}} = 20\text{ MHz}$ and signal bandwidth $W_{\text{sig}} = 1\text{ MHz}$:
   $$G_{p,\text{DSSS}} = 10 \log_{10}(20) \approx 13.0103\text{ dB}$$

2. **Frequency Hopping Spread Spectrum (FHSS):**
   In FHSS, the carrier frequency hops across $N_{\text{channels}} = \lfloor W_{\text{ss}} / W_{\text{sig}} \rfloor$ discrete slots. When a jammer operates across the entire band ($\rho = 1.0$), the average processing gain equals $10 \log_{10}(W_{\text{ss}} / W_{\text{sig}})$.
   When an adversary partial-band jammer concentrates its total interference power into a fraction $\rho = \text{partialBandJamFraction} \in (0, 1]$ of the hopping band, the jammer spectral density within the jammed fraction increases by $1/\rho$ ($10\log_{10}(1/\rho)\text{ dB}$).
   The effective processing gain against partial-band jamming is bounded by:
   $$G_{p,\text{FHSS}} = \max\left(0.0, 10 \log_{10}\left(\frac{W_{\text{ss}}}{W_{\text{sig}}}\right) - 10 \log_{10}\left(\frac{1}{\rho}\right)\right) = \max\left(0.0, 10 \log_{10}\left(\frac{W_{\text{ss}} \cdot \rho}{W_{\text{sig}}}\right)\right)$$
   When $\rho = 1.0$, $G_{p,\text{FHSS}} = 13.0103\text{ dB}$. When $\rho = 0.5$, $G_{p,\text{FHSS}} = 10.0\text{ dB}$.

3. **Baseline (`'NONE'`):**
   $$G_{p} = 0.0\text{ dB}$$

---

### 3.2 MVDR Phased Array Spatial Null-Steering Rejection

Let $\theta_{\text{des}} \in [0, 360)^\circ$ be the azimuth angle from the ACN to the desired communicating peer, and $\theta_{\text{jam}} \in [0, 360)^\circ$ be the azimuth angle from the ACN to the jammer.

#### Shortest Wrapped Angular Separation
The true geodetic angular separation on the circle $[0, 360)^\circ$ is:
$$\Delta\theta_{\text{raw}} = |\theta_{\text{des}} - \theta_{\text{jam}}| \pmod{360}$$
$$\Delta\theta = \begin{cases} 360^\circ - \Delta\theta_{\text{raw}}, & \text{if } \Delta\theta_{\text{raw}} > 180^\circ \\ \Delta\theta_{\text{raw}}, & \text{otherwise} \end{cases} \quad \implies \Delta\theta \in [0, 180]^\circ$$
This formulation guarantees that $359^\circ \leftrightarrow 1^\circ$ yields an exact separation of $\Delta\theta = 2.0^\circ$.

#### Null Rejection Profile
An adaptive MVDR array maintains distortionless response ($0\text{ dB}$ attenuation) in the look direction $\theta_{\text{des}}$. However:
1. **Collinear Degeneracy ($\Delta\theta \le 0.5^\circ$):**
   When the jammer is collinear with the desired signal, steering a spatial null toward the jammer would inevitably null the desired signal itself. Hence:
   $$R_{\text{null}}(\Delta\theta) = 0.0\text{ dB} \quad \text{for } \Delta\theta \le 0.5^\circ$$
2. **Far-Out Null Region ($\Delta\theta \ge \theta_{\text{null\_bw}}$ where $\theta_{\text{null\_bw}} = 12.0^\circ$):**
   When the jammer is well outside the main lobe null notch, the adaptive array achieves its maximum null depth:
   $$R_{\text{null}}(\Delta\theta) = R_{\text{max}} = 25.0\text{ dB} \quad \text{for } \Delta\theta \ge 12.0^\circ$$
3. **Transition Region ($0.5^\circ < \Delta\theta < 12.0^\circ$):**
   To prevent discontinuous step artifacts in numerical optimization and discrete-event loops, the rejection follows a smooth $C^1$ raised-cosine ramp:
   $$x = \frac{\Delta\theta - 0.5^\circ}{\theta_{\text{null\_bw}} - 0.5^\circ} \in (0, 1)$$
   $$R_{\text{null}}(\Delta\theta) = \frac{1 - \cos(\pi x)}{2} \cdot R_{\text{max}}$$
   Note that $\left.\frac{dR_{\text{null}}}{dx}\right|_{x=0} = 0$ and $\left.\frac{dR_{\text{null}}}{dx}\right|_{x=1} = 0$, guaranteeing zero derivative discontinuity at both boundary points.

---

### 3.3 Joint EW Jammer Mitigation Evaluation

Given raw received jammer power $I_{\text{raw,dBm}}$, spatial null rejection $R_{\text{null,dB}}$, and spread spectrum processing gain $G_{p,\text{dB}}$:
$$I_{\text{eff,dBm}} = I_{\text{raw,dBm}} - R_{\text{null,dB}} - G_{p,\text{dB}}$$

With desired received signal power $S_{\text{dBm}}$ and background thermal noise $N_{\text{dBm}}$:
$$\text{SINR}_{\text{raw}} = S_{\text{dBm}} - 10 \log_{10}\left(10^{N_{\text{dBm}}/10} + 10^{I_{\text{raw,dBm}}/10}\right)$$
$$\text{SINR}_{\text{mitigated}} = S_{\text{dBm}} - 10 \log_{10}\left(10^{N_{\text{dBm}}/10} + 10^{I_{\text{eff,dBm}}/10}\right)$$
$$\Delta\text{SINR} = \text{SINR}_{\text{mitigated}} - \text{SINR}_{\text{raw}}$$

The jammer is flagged as `jammerSuppressed` when:
$$I_{\text{eff,dBm}} \le N_{\text{dBm}} \quad \lor \quad (R_{\text{null,dB}} + G_{p,\text{dB}} \ge 20.0\text{ dB})$$

---

### 3.4 Adversary ESM/ELINT Interception & LPI Ratio

Adversary ESM intercept receivers seek to detect tactical airborne and ground emissions. The received intercept power at adversary distance $d_{\text{ESM}}$ is governed by free-space path loss and terrain diffraction:
$$P_{\text{int,dBm}} = P_{\text{tx}} + G_{\text{tx}} + G_{\text{ESM}} - \text{FSPL}(d_{\text{ESM}}, f) - L_{\text{diff,ESM}}$$
where $\text{FSPL}(d, f) = 20 \log_{10}(d) + 20 \log_{10}(f) - 147.5522\text{ dB}$.

#### Theoretical Free-Space Detection Radius ($R_{\text{det}}$)
At the sensitivity threshold $S_{\text{ESM}}$ (nominal $-105\text{ dBm}$):
$$\text{FSPL}(R_{\text{det}}, f) = P_{\text{tx}} + G_{\text{tx}} + G_{\text{ESM}} - L_{\text{diff,ESM}} - S_{\text{ESM}}$$
$$R_{\text{det}} = 10^{\frac{P_{\text{tx}} + G_{\text{tx}} + G_{\text{ESM}} - L_{\text{diff,ESM}} - S_{\text{ESM}} - 20\log_{10}\left(\frac{4\pi f}{c}\right)}{20}}$$

**Physical Invariant (Inverse-Square Law):**
A $10\text{ dB}$ reduction in transmission power ($P_{\text{tx}} \to P_{\text{tx}} - 10\text{ dB}$) reduces $\text{FSPL}$ budget by $10\text{ dB}$:
$$\Delta R_{\text{det}} = 10^{-10/20} = 10^{-0.5} = \frac{1}{\sqrt{10}} \approx \frac{1}{3.162278}$$
The adversary detection radius shrinks by an exact factor of $\sqrt{10} \approx 3.16228\times$.

#### LPI Safety Ratio & Intercept Probability
The Low Probability of Intercept (LPI) Safety Ratio measures whether the friendly link operates inside or outside the adversary intercept envelope:
$$\text{LPI Safety Ratio} = \frac{d_{\text{friendly}}}{\max(1, R_{\text{det}})}$$
A ratio $> 1.0$ indicates that the friendly communications range exceeds the adversary detection horizon, guaranteeing clandestine operation.

The intercept probability $P_I$ follows a calibrated logistic receiver operating characteristic around sensitivity threshold $S_{\text{ESM}}$:
$$\Delta_{\text{margin}} = P_{\text{int,dBm}} - S_{\text{ESM}}$$
$$P_I = \frac{1}{1 + e^{-0.5 \cdot \Delta_{\text{margin}}}}$$
- When $P_{\text{int,dBm}} = S_{\text{ESM}}$, $P_I = 0.50$ (50% detection at threshold).
- When $P_{\text{int,dBm}} \gg S_{\text{ESM}}$, $P_I \to 1.0$.
- When $P_{\text{int,dBm}} \ll S_{\text{ESM}}$, $P_I \to 0.0$.

---

### 3.5 GNSS Timing Spoofing & Closed-Loop TDMA Guard Degradation

Adversary spoofing transmitters broadcast delayed or advanced pseudorange codes, inducing an artificial timing drift rate $\dot{\tau}$ ($\mu\text{s}/\text{s}$):
$$\tau_{\text{drift}}(t) = \min\left(\tau_{\text{max}}, t_{\text{spoof}} \cdot \dot{\tau}\right)$$

When an airborne or ground station activates atomic clock or oven-controlled crystal oscillator (OCXO) holdover filtering (`antiSpoofHoldoverActive: true`), oscillator drift stability suppresses the effective spoofing rate by a factor of 10:
$$\tau_{\text{drift,holdover}}(t) = \frac{\tau_{\text{drift}}(t)}{10.0}$$

In TDMA synchronization, Timing Advance (TA) compensates for round-trip propagation time:
$$\Delta d_{\text{TA}} = \frac{c \cdot (\tau_{\text{drift}} \cdot 10^{-6})}{2}$$
This residual ranging error is fed into `computeDynamicTdmaOverhead` via `taResidualErrorM`. When accumulated drift causes total required guard and preamble overhead to equal or exceed the TDMA slot duration, the system declares:
$$\text{slotCollisionOutage} = \text{true}$$
This genuinely collapses dynamic guard efficiency to 0.0 and drives transport capacity to zero.

---

## 4. Implementation Seams & Integration Points

| Component | File | Responsibilities |
|---|---|---|
| **Pure EW/ECCM Engine** | `src/core/ewEccmEngine.ts` | Pure functions for $G_p$, MVDR nulling, joint jammer mitigation, ESM intercept radius, and GNSS TA drift. |
| **Worker Protocol** | `src/shared/workerProtocol.ts` | Types for `EwEccmConfigFlags`, `EwEccmTelemetry`, and additive fields in `ConfigUpdateParams`. |
| **Command Validators** | `src/worker/workerCommandValidators.ts` | Validation and normalization of EW/ECCM command parameters. |
| **Simulation Worker** | `src/worker/simWorker.ts` | 50 Hz execution, effective jammer modulation, ESM metric calculation, GNSS spoof accumulation, and `RESET_SIM` cleanup. |
| **User Interface** | `index.html` | Compact labeled controls in `#tab-terrain` (`RF` tab) and live readout display. |
| **Verification Suite** | `src/tests/verifyEwEccmAndLpi.ts` | Suite 105 testing [EW-T1] through [EW-T5]. |
