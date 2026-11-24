# Specification V3-05: True Digital-Twin Calibration & Flight-Test Trace Replay Engine

**Document ID:** `SPEC-V3-05-DIGITAL-TWIN-CALIBRATION`  
**Status:** Approved / Authoritative  
**Domain:** Airborne Tactical Network Simulation Engine (TypeScript / Vite 50 Hz Web Worker & Main UI Thread)  
**Parent Framework:** Tactical X-Band Air-to-Ground Digital Twin Architectural Framework  

---

## 1. Executive Architectural Overview

Specification V3-05 establishes the authoritative **Digital-Twin Calibration & Flight-Test Trace Replay Engine**, closing the loop between theoretical high-fidelity RF/MAC/Transport models and empirical flight-test telemetry recorded during operational X-band airborne trials in mountainous and maritime sectors.

```
+-----------------------------------------------------------------------------+
| Empirical Flight-Test Trace (.CSV) or Built-In Benchmarks                   |
| (Kargil Alpine Double-Ridge Pass / Arabian Sea Coastal Multipath Pass)      |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| Zero-Dependency Robust CSV Parser (parseFlightTestTraceCsv)                 |
| - Header aliases (time_s, range_m, measured_snr_db, bank_deg, nu, etc.)    |
| - Automatic 3D ENU / Geographic slant-range derivation                      |
| - Resilient NaN row skip and syntax anomaly warnings                        |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| First-Principles Physics Prediction Pipeline (evaluateTwinCalibrationTrace) |
| - FSPL + ITU-R P.676 Gas + Scaled ITU-R P.838 Rain                          |
| - Scaled ITU-R P.526 Knife-Edge Diffraction + Two-Ray Ground Lobing         |
| - Airframe Bank Shadowing + DVB-S2X MODCOD Goodput Mapping                  |
+-----------------------------------------------------------------------------+
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
+-------------------------------------+ +-------------------------------------+
| Statistical Discrepancy Diagnostics | | Bounded Auto-Calibration Solver     |
| - RMSE, MAE, Mean Bias, Max/P95     | | (autoCalibrateTwinParameters)       |
| - Pearson r, R^2 Coefficient        | | - Multi-scale coordinate descent    |
| - Outage Confusion Matrix (Acc, F1) | | - Converges in < 30 ms              |
| - Certification Grade Award         | | - Identifies cable/connector biases |
+-------------------------------------+ +-------------------------------------+
                   │                                     │
                   └──────────────────┬──────────────────┘
                                      ▼
+-----------------------------------------------------------------------------+
| UI Presentation & Reproducible Verification                                 |
| - HiDPI Dual-Trace Scope (src/ui/calibrationPanelRenderer.ts)               |
| - Markdown / LaTeX Calibration Dossier Export                               |
| - Continuous Verification Gate (Suite 107)                                  |
+-----------------------------------------------------------------------------+
```

### Architectural & Operational Invariants
1. **Scope Boundary Discipline:** The calibration engine operates strictly outside `src/worker/*`, preserving the $< 3,300$ line constraint on `simWorker.ts` and ensuring zero disturbance to the 50 Hz discrete-event simulation loop.
2. **Stateless Core Engine:** All functions in `src/core/digitalTwinCalibrationEngine.ts` are 100% pure, deterministic, free of `Math.random()`, and free of module-level mutable state.
3. **Physical Ground Truth:** Predicted signal levels must invoke real physical functions from `src/core/rfPropagationMath.ts`, `src/core/linkBudget.ts` (`MODCOD_TABLE`, atmospheric/rain models), `src/core/antennaArray.ts`, and `src/core/biomePhysics.ts` — stubbed or synthetic mathematical formulas are strictly prohibited.
4. **Computational Budget:** Auto-calibration over a 100-sample flight-test trace must complete in $< 30\,\text{ms}$ total execution time.
5. **Zero-Slop UI Standards:** No emojis, all fonts $\ge 10\,\text{px}$, all inputs paired with `<label for="...">` and `aria-label`, zero duplicate IDs, and zero `backdrop-filter: blur`.

---

## 2. Mathematical & Physical Formulations

### 2.1 Flight-Test Trace Schema & Slant-Range Derivation
A flight-test observation sample $i$ contains:
$$\mathbf{s}_i = \{ t_i, d_i, h_{\text{tx},i}, h_{\text{rx},i}, \gamma_{\text{meas},i}, \nu_i, R_i, \phi_i, \text{biome}_i, R_{\text{goodput},i} \}$$
When Cartesian coordinates are provided instead of slant range ($[x_{\text{acn}}, y_{\text{acn}}, z_{\text{acn}}]$ and $[x_{\text{node}}, y_{\text{node}}, z_{\text{node}}]$):
$$d_i = \sqrt{(x_{\text{acn},i} - x_{\text{node},i})^2 + (y_{\text{acn},i} - y_{\text{node},i})^2 + (z_{\text{acn},i} - z_{\text{node},i})^2}$$

### 2.2 First-Principles Physical Prediction Pipeline
For each observation $i$, the digital-twin predicted SNR $\hat{\gamma}_i$ is computed from first principles:
$$\hat{\gamma}_i = P_{\text{tx,EIRP}} + G_{\text{rx}} - \text{FSPL}(d_i, f) - \alpha_{\text{diff}} L_{\text{diff}}(\nu_i) - L_{\text{gas}}(d_i, h_{\text{tx},i}, h_{\text{rx},i}, f) - \alpha_{\text{rain}} L_{\text{rain}}(d_i, R_i) - L_{\text{shadow}}(\phi_i) + \Delta G_{\text{tworay},i} - L_{\text{trim}} - P_N$$
where:
- $\text{FSPL}(d_i, f) = 20\log_{10}(d_i) + 20\log_{10}(f) - 147.55\,\text{dB}$.
- $L_{\text{diff}}(\nu_i)$ is evaluated using `computeKnifeEdgeDiffractionLossDb(\nu_i)` per ITU-R P.526.
- $L_{\text{gas}}$ is evaluated using `LinkBudgetEngine.computeGaseousAttenuationDb` per ITU-R P.676.
- $L_{\text{rain}}$ is evaluated using `LinkBudgetEngine.computeRainAttenuationDb` per ITU-R P.838.
- $L_{\text{shadow}}(\phi_i)$ is evaluated using `computeAirframeShadowLossDb(\phi_i)` from `antennaArray.ts`.
- $\Delta G_{\text{tworay},i}$ is evaluated using `computeTwoRayGroundReflectionDb` when the biome exhibits specular reflections (`maritime_littoral`, `arid_desert`, `open_plains`).
- $L_{\text{trim}}$ is the calibrated hardware RF insertion/cable loss trim parameter.
- $P_N = -174.0 + 10\log_{10}(B) + NF\,\text{dBm}$ is the thermal noise floor.

Predicted goodput $\hat{R}_{\text{goodput},i}$ maps $\hat{\gamma}_i$ through canonical `MODCOD_TABLE`:
$$\hat{R}_{\text{goodput},i} = \begin{cases} 0.0 & \hat{\gamma}_i < -1.5\,\text{dB} \\ B \cdot \eta_{\text{MODCOD}}(\hat{\gamma}_i) \cdot (1 - \text{OH}_{\text{MAC}}) & \hat{\gamma}_i \ge -1.5\,\text{dB} \end{cases}$$

### 2.3 Residual Metrics & Discrepancy Diagnostics
Given $N$ valid matched samples, the error residual is $e_i = \hat{\gamma}_i - \gamma_{\text{meas},i}$.

1. **Root Mean Square Error (RMSE):**
   $$\text{RMSE} = \sqrt{\frac{1}{N}\sum_{i=1}^N (\hat{\gamma}_i - \gamma_{\text{meas},i})^2}$$
2. **Mean Absolute Error (MAE):**
   $$\text{MAE} = \frac{1}{N}\sum_{i=1}^N |\hat{\gamma}_i - \gamma_{\text{meas},i}|$$
3. **Mean Bias Error (MBE):**
   $$\text{Bias} = \frac{1}{N}\sum_{i=1}^N (\hat{\gamma}_i - \gamma_{\text{meas},i})$$
4. **Pearson Correlation Coefficient $r$:**
   $$r = \frac{\sum_{i=1}^N (\hat{\gamma}_i - \bar{\hat{\gamma}})(\gamma_{\text{meas},i} - \bar{\gamma}_{\text{meas}})}{\sqrt{\sum_{i=1}^N (\hat{\gamma}_i - \bar{\hat{\gamma}})^2} \cdot \sqrt{\sum_{i=1}^N (\gamma_{\text{meas},i} - \bar{\gamma}_{\text{meas}})^2}}$$
   *Zero-variance guard:* If either variance is $< 10^{-12}$, $r$ returns $1.0$ if $\text{RMSE} < 10^{-6}$, else $0.0$.
5. **Coefficient of Determination $R^2$:**
   $$R^2 = 1 - \frac{\sum_{i=1}^N (\hat{\gamma}_i - \gamma_{\text{meas},i})^2}{\sum_{i=1}^N (\gamma_{\text{meas},i} - \bar{\gamma}_{\text{meas}})^2}$$
6. **Outage Classification Matrix ($\gamma < -1.5\,\text{dB}$):**
   Evaluates True Positives (TP), False Positives (FP), True Negatives (TN), False Negatives (FN), Classification Accuracy, and F1-Score:
   $$\text{Accuracy} = \frac{\text{TP} + \text{TN}}{N}, \quad \text{F1} = \frac{2\,\text{TP}}{2\,\text{TP} + \text{FP} + \text{FN}}$$

### 2.4 Certification Grade Criteria
- **`'CERTIFIED_TWIN'`**: $\text{RMSE} \le 2.0\,\text{dB}$ and $r \ge 0.90$.
- **`'CALIBRATED'`**: $\text{RMSE} \le 4.0\,\text{dB}$ and $r \ge 0.80$.
- **`'REQUIRES_TUNING'`**: Fails both above thresholds.

### 2.5 Deterministic Bounded Auto-Calibration Solver
The calibration optimizer solves:
$$\min_{\boldsymbol{\theta}} \text{RMSE}(\boldsymbol{\theta}), \quad \boldsymbol{\theta} = [L_{\text{trim}}, \alpha_{\text{diff}}, \alpha_{\text{rain}}]^T$$
subject to:
$$L_{\text{trim}} \in [-12.0, +12.0]\,\text{dB}, \quad \alpha_{\text{diff}} \in [0.5, 2.0], \quad \alpha_{\text{rain}} \in [0.5, 2.0]$$

**Algorithm: Multi-Scale Coordinate Descent**
1. Initialize $\boldsymbol{\theta}_0 = [0.0, 1.0, 1.0]^T$.
2. For step sizes $\delta_{\text{trim}} \in [2.0, 0.5, 0.1, 0.02]$ and $\delta_{\alpha} \in [0.2, 0.05, 0.01]$:
   - For each parameter $j \in \{1, 2, 3\}$:
     - Test candidate perturbations $\theta_j + \delta_j$ and $\theta_j - \delta_j$ clamped to bounds.
     - Accept candidate with strictly lower RMSE.
3. Stop when $\Delta \text{RMSE} < 10^{-4}$ or outer iterations exceed $40$.
4. Determinism is guaranteed by the fixed iteration schedule and lack of stochastic steps.

---

## 3. Built-In Reference Flight-Test Datasets

1. **`'kargil_alpine_ridge'` (80 samples, $t = 0 \dots 80\,\text{s}$):**
   - Trajectory: UAV loitering across a steep double-ridge canyon with deep knife-edge diffraction obstruction ($\nu \in [0.2, 2.8]$).
   - Injected hardware reality: Uncalibrated $+3.2\,\text{dB}$ cable/coupler loss bias, $1.15\times$ diffraction scaling, and deterministic pseudorandom sensor noise ($\pm 0.6\,\text{dB}$) generated via pure SplitMix32 hashing.
2. **`'arabian_maritime_multipath'` (80 samples, $t = 0 \dots 80\,\text{s}$):**
   - Trajectory: Low-altitude coastal maritime approach over seawater ($\epsilon_r = 70, \sigma = 5.0\,\text{S/m}$) exhibiting Fresnel interference lobes.
   - Injected hardware reality: Uncalibrated $+2.1\,\text{dB}$ radome insertion loss bias and SplitMix32 sensor noise.

---

## 4. Verification Test Suite Matrix (Suite 107)

| Test ID | Gate Name | Target Metric / Acceptance Criteria |
|---|---|---|
| **[DTC-T1]** | CSV Parser Fidelity & Resilience | Parses valid CSV with headers, CRLF, `#` comments, 3D ENU/geographic coordinates; safely skips `NaN`/malformed rows with accurate count; never throws on garbage text. |
| **[DTC-T2]** | Exact Statistical Metrics & Confusion Matrix | Synthetic ground truth: exact $+2.0\,\text{dB}$ shift yields $\text{RMSE} = 2.000$, $\text{MAE} = 2.000$, $\text{Bias} = +2.000$, $r = 1.000$ ($< 10^{-6}$ error); exact TP/FP/TN/FN/Accuracy/F1. |
| **[DTC-T3]** | Auto-Calibration Solver Convergence | On `'kargil_alpine_ridge'`: initial RMSE $> 2.5\,\text{dB}$, auto-calibration reduces RMSE by $> 1.5\,\text{dB}$ to $< 1.2\,\text{dB}$, reduces $|\text{Bias}| < 0.15\,\text{dB}$, recovers $L_{\text{trim}} \in [2.7, 3.7]\,\text{dB}$, and achieves `CERTIFIED_TWIN`. On `'arabian_maritime_multipath'`: achieves `CERTIFIED_TWIN`. |
| **[DTC-T4]** | Determinism, Performance & UI Contracts | Bit-exact reproducibility across twin runs in $< 30\,\text{ms}$; safe handling of empty/1-point traces; UI DOM elements `#twin-calibration-panel`, `#twin-calibration-canvas`, zero emojis, and zero duplicate IDs verified. |

---

## 5. Architectural Sign-Off
Approved for implementation under Role 2: Coder / Implementer. All modifications conform strictly to designated seams and preserve all 106 prior verification suites.
