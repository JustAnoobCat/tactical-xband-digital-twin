# SPEC-3GPP-NTN-RICIAN-FADING-AND-CQI-AGING
## 3GPP TR 38.811 Elevation-Dependent Rician Small-Scale Multipath Fading & CQI Aging with Predictive OLLA Protection

**Document ID:** `DRDO-TAC-XBAND-SPEC-3GPP-NTN-RICIAN-01`  
**Status:** Approved by Role 1 Planner (Gemini Argon) & Implemented (Upgrade #9 / M1.3)  
**Author:** Engineering Planner (Role 1) & Implementer (Role 2)  
**Target Runtime:** Web Worker (`src/worker/simWorker.ts`, `src/core/linkBudget.ts`) & Scientific C2 Console (`index.html`)

---

### 1. Architectural Motivation & Invariants

In tactical Non-Terrestrial Networks (NTN) operating at X-band (8.0 GHz) over steep alpine terrain (e.g., Ladakh sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$), radio propagation cannot be modeled solely by large-scale path loss and macroscopic knife-edge diffraction. Tactical airborne communication links experience rapid small-scale multipath fading from ground clutter, scree slopes, canyon walls, and airframe micro-vibrations, combined with CQI (Channel Quality Indicator) feedback latency $\tau_{\text{CQI}} \in \{0, 20, 40, 60\}\text{ ms}$.

When an airborne relay relies on outdated CQI reports:
1. **The CQI Aging Outage Dilemma:** If channel quality degrades due to constructive-destructive multipath interference during the round-trip feedback latency, a naive link adapter selects an aggressive modulation and coding scheme (MODCOD). When the actual received Signal-to-Interference-plus-Noise Ratio (SINR) falls below the MODCOD's required decode threshold, an **ACM Block Decode Failure** occurs, causing 100% frame loss and wasted TDMA airtime.
2. **Predictive OLLA Margin Protection:** Rather than accepting catastrophic decode failures, `Tac-TAD` leverages terrain and channel geometry to calculate an analytical, elevation- and diffraction-dependent **Outer-Loop Link Adaptation (OLLA)** backoff margin $\Delta\gamma_{\text{OLLA}}$. By sizing transmission rates to $\text{SINR}_{\text{safe}} = \text{SINR}(t - \tau_{\text{CQI}}) - \Delta\gamma_{\text{OLLA}}$, `Tac-TAD` maintains error-free packet delivery and superior goodput under heavy fading dynamics.

#### Architectural Guardrails:
1. **Web Worker Authority & 50 Hz Budget:** All Rician fading synthesis and CQI aging tracking execute within `src/worker/simWorker.ts` and `src/core/linkBudget.ts` with 0 per-frame heap allocations, maintaining strict compliance with the $\Delta t = 20\text{ ms}$ ($p50 < 6.5\text{ ms}$) discrete-event loop budget.
2. **Physical & Mathematical Rigor:** Uses 3GPP TR 38.811 Section 6.6.2 Rician $K$-factor scaling coupled to path elevation $\theta_{\text{el}}$ and knife-edge diffraction loss $L_{\text{diff}}$, paired with unit-mean power-conserving Clarke/Jakes sum-of-sinusoids synthesis ($\mathbb{E}[|h_{\text{Rice}}|^2] = 1$).
3. **Full Backward Compatibility:** Small-scale fading defaults to disabled (`ricianFadingEnabled = false`, `cqiFeedbackDelayMs = 0`), preserving 100% bit-for-bit regression-free results across all existing baseline verification suites.

---

### 2. Mathematical Formulations

#### 2.1 3GPP TR 38.811 Elevation- and Diffraction-Coupled Rician $K$-Factor
In airborne Non-Terrestrial Networks, links with high elevation angles and unobstructed Line-of-Sight (LoS) exhibit a strong specular component ($K_{\text{dB}} \gg 0$). Conversely, links grazing shallow canyon rims or suffering diffraction loss experience heavy diffuse scattering ($K_{\text{dB}} \le 0$, approaching Rayleigh fading).

The elevation- and diffraction-coupled Rician $K$-factor in decibels is formulated as:
$$K_{\text{dB}} = \text{clamp}_{[-2.0, 20.0]}\Big(4.0 + 13.5 \sin\big(\max(|\theta_{\text{el}}|, 2.0^\circ) \cdot \frac{\pi}{180}\big) - 0.35 \min(\max(L_{\text{diff}}, 0), 25.0)\Big)$$
$$K_{\text{lin}} = 10^{K_{\text{dB}} / 10.0}$$
where $\theta_{\text{el}}$ is the geometric path elevation angle in degrees, and $L_{\text{diff}}$ is the ITU-R P.526-15 multi-ridge diffraction loss in decibels.

#### 2.2 Deterministic Clarke / Jakes Doppler-Coherent Sum-of-Sinusoids Synthesis
To maintain strict simulation determinism and reproducibility across multi-seed runs without pseudo-random state drift, small-scale multipath fading is synthesized via an analytical $M = 6$ scatterer sum-of-sinusoids model:

1. **Specular and Diffuse Partitioning:**
   $$A_s = \sqrt{\frac{K_{\text{lin}}}{K_{\text{lin}} + 1.0}}, \quad \sigma_d = \sqrt{\frac{1.0}{(K_{\text{lin}} + 1.0) \cdot 6.0}}$$
   Note that $A_s^2 + 6 \sigma_d^2 = \frac{K_{\text{lin}} + 1.0}{K_{\text{lin}} + 1.0} = 1.0$, guaranteeing unit mean power: $\mathbb{E}[|h_{\text{Rice}}|^2] = 1.0$.

2. **Scatterer Phase and Doppler Coupling:**
   - Scatterer arrival angle: $\alpha_m = \frac{(2m + 1)\pi}{12}$ for $m \in \{0, 1, 2, 3, 4, 5\}$.
   - Deterministic per-node spatial seed: $\psi_{i,m} = nodeId \cdot 1.618034 + m \cdot 2.399963$.
   - Effective Doppler spread: $f_{\max} = \max(|f_d|, 12.0)\text{ Hz}$, where $f_d$ is the 8.0 GHz kinematic Doppler shift and $12.0\text{ Hz}$ represents the minimum airframe vibration and ground clutter Doppler floor.
   - Time-varying phase: $\theta_m(t) = 2\pi f_{\max} t \cos\alpha_m + \psi_{i,m}$.

3. **In-Phase, Quadrature, and Envelope Gain:**
   $$I_{\text{mp}}(t) = \sigma_d \sum_{m=0}^5 \cos\theta_m(t), \quad Q_{\text{mp}}(t) = \sigma_d \sum_{m=0}^5 \sin\theta_m(t)$$
   $$P_{\text{env}}(t) = \big(A_s + I_{\text{mp}}(t)\big)^2 + Q_{\text{mp}}(t)^2$$
   $$G_{\text{Rice,dB}}(t) = \text{clamp}_{[-12.0, 4.5]}\big(10 \log_{10}(\max(P_{\text{env}}(t), 0.0631))\big)$$

#### 2.3 CQI Feedback Aging & Outage Conditions
Airborne schedulers maintain a 4-frame ring buffer of historical SINR observations per node corresponding to latency delays $\tau_{\text{CQI}} \in \{0, 20, 40, 60\}\text{ ms}$:
$$\text{SINR}_{\text{cqi}} = \text{SINR}(t - \tau_{\text{CQI}})$$

- **Reactive M-LWDF & Static TDMA Baseline:**  
  The transmitter selects MODCOD $M_{\text{alloc}} = \text{selectModCod}(\text{SINR}_{\text{cqi}})$.  
  If the channel faded such that the required threshold exceeds the actual physical SINR at transmission time $t$:
  $$\text{threshold}(M_{\text{alloc}}) > \text{SINR}(t) + 0.5\text{ dB}$$
  an **ACM Block Decode Failure (CQI Aging Outage)** occurs: all dequeued bits are unrecoverable and accounted as wasted airtime ($W_{\text{outage}} += \text{bits}$).

- **Predictive `Tac-TAD` with OLLA Margin:**  
  `Tac-TAD` calculates the protective OLLA backoff margin:
  $$\Delta\gamma_{\text{OLLA}} = \frac{2.5}{\sqrt{K_{\text{lin}}}} \cdot \min\left(1.0, \frac{\tau_{\text{CQI,ms}}}{20.0}\right) \text{ [dB]}$$
  and selects its transmission MODCOD using:
  $$\text{SINR}_{\text{safe}} = \text{SINR}_{\text{cqi}} - \Delta\gamma_{\text{OLLA}}$$
  Because $\Delta\gamma_{\text{OLLA}}$ dynamically expands in low-$K$ multipath environments, $\text{threshold}(M_{\text{safe}}) \le \text{SINR}(t) + 0.5\text{ dB}$, preventing decode failures and preserving application goodput.

---

### 3. Implementation Blueprint & Seams

1. **`src/core/config.ts` (`EnvironmentConfig`):**  
   Exposes `ricianFadingEnabled: boolean` and `cqiFeedbackDelayMs: number` (`0`, `20`, `40`, `60`).
2. **`src/core/linkBudget.ts` (`LinkBudgetEngine`):**  
   Implements static `computeRicianMultipathFading()` and updates `evaluateLink()` to incorporate $G_{\text{Rice,dB}}$.
3. **`src/worker/simWorker.ts`:**  
   Maintains zero-allocation per-node circular SINR buffers, applies CQI aging to baseline schedulers, and equips `Tac-TAD` with predictive OLLA compensation.
4. **`src/shared/workerProtocol.ts` & `src/worker/telemetrySerializer.ts`:**  
   Serializes `rician_k_db`, `rician_fading_db`, and `olla_margin_db` into `NodeTelemetryItem`.
5. **C2 Console UX (`index.html`):**  
   Adds `#sci-fading-cqi-select` to `#tab-scheduler`, displays live Rician telemetry in `#tab-terrain` waterfall readout, and updates Table 14 methodology reference in `#tab-doc`.

---

### 4. Verification Contracts (`src/tests/verifyRicianFadingAndCqiAging.ts`)

- **RFC-T1 (3GPP TR 38.811 Elevation & Diffraction Scaling):** Unobstructed high-elevation LoS ($\theta_{\text{el}} = 60^\circ, L_{\text{diff}} = 0\text{ dB}$) yields $K_{\text{dB}} > 14.0\text{ dB}$; low-grazing diffracted canyon links ($\theta_{\text{el}} = 5^\circ, L_{\text{diff}} = 20\text{ dB}$) yield $K_{\text{dB}} < 0\text{ dB}$.
- **RFC-T2 (Clarke/Jakes Unit-Mean Power Conservation & Determinism):** Mean linear power across 200 time steps is within $[0.85, 1.15]$, and identical input parameters yield bit-for-bit identical results.
- **RFC-T3 (OLLA Protection Against CQI Aging):** Under active fading and $\tau_{\text{CQI}} = 40\text{ ms}$, `Tac-TAD` with OLLA achieves significantly fewer CQI-mismatch wasted bits and higher goodput than uncompensated reactive selection.
- **RFC-T4 (DOM & Spec Persistence Check):** Confirms specification existence on disk and UI control availability in `index.html`.
