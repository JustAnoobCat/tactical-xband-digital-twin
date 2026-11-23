# SPEC-WP11: Scientific Benchmarking Rigor — Deterministic Multi-Seed Monte Carlo, Student-t Confidence Intervals, Welch's t-Test & ITU-R Reference Cross-Validation

**Specification Document:** `docs/specs/wp11-scientific-benchmarking-rigor.md`  
**Status:** Approved  
**Execution Lead:** Role 2 Coder / Implementer  
**Classification:** Scientific Benchmarking / Rigorous Statistical Inference / Physics-Realism Ablation / 50 Hz Web Worker Invariants  
**Applies to Modules:** `src/core/statisticalBenchmarkEngine.ts`, `src/tests/verifyScientificBenchmarkRigor.ts` (Suite 95), `scripts/run_all_verifications.mjs`, `package.json`  

---

## 1. Executive Summary & Zero-Duplication Audit

### 1.1 Context & Scientific Rationale
Air-to-ground tactical Non-Terrestrial Networks (NTN) operating in high-relief mountainous topography (e.g., Ladakh sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$) present complex, non-linear multi-scale physical dynamics:
- High-order knife-edge and cascaded Deygout diffraction over sharp mountain ridges (ITU-R P.526-15).
- Airframe wing-chord and fuselage shadow attenuation during high-rate banking maneuvers.
- Time-correlated 8.0 GHz Doppler kinematics and Rician-Jakes multi-path fading.
- Round-trip propagation latency ($10\text{ km} \le d_{\text{slant}} \le 200\text{ km}$) driving CQI aging, MCS overshoot, and long-RTT HARQ retransmission delays.
- Slant-range-coupled dynamic TDMA guard overhead and Timing Advance (TA) tracking error.

Prior verification suites in this repository (e.g., Suite 24 `verify:ablation`, Suite 28 `verify:publication-ecdf`, Suite 85 `verify:master-math`, Suite 90 `verify:mac-phy-feedback`) validate individual unit behaviors or deterministic single-seed runs. However, publication-grade scientific claims require **rigorous statistical inference**:
1. **$N \ge 30$ Multi-Seed Replications:** Single-run benchmarks can suffer from sample bias or stochastic variance. Central Limit Theorem (CLT) guarantees asymptotic normality for sample means when $N \ge 30$.
2. **Student-$t$ 95% Confidence Intervals:** Every reported benchmark metric (Goodput, BLER, Outage, SNR) must be reported with explicit $95\%$ confidence bounds $[\bar{x} - t_{0.975,\nu} \cdot \text{SE}, \bar{x} + t_{0.975,\nu} \cdot \text{SE}]$ rather than bare point estimates.
3. **Welch's Two-Sample $t$-Test:** Pairwise comparisons between ablation configurations must not assume equal sample variances. Welch's unequal-variance $t$-test with Welch–Satterthwaite degrees of freedom and exact two-tailed $p$-values must formally establish whether observed differences are statistically significant ($p < 0.01$ or $p < 0.05$).
4. **Standardized Effect Sizes (Cohen's $d$):** Statistical significance ($p < 0.01$) must be paired with effect magnitude ($d > 0.8$ for large effects) to ensure operational relevance.
5. **External Published Reference Anchor Cross-Validation:** Analytical predictions must be continuously anchored against external international standards (ITU-R P.525, ITU-R P.526-15, ITU-R P.838-3, ITU-R P.676-13, and canonical WGS-84 / Vincenty 1975 geodetic benchmarks).

### 1.2 Zero-Duplication Codebase Audit
All existing modules remain authoritative and untouched:
- **`src/core/rfPropagationMath.ts`:** Canonical DRY RF equations (`computeFsplDb`, `computeKnifeEdgeDiffractionLossDb`, `computeDeygoutMultiEdgeDiffraction`, `computeEarthBulgeM`, `computeCorrelatedRicianJakesFading`).
- **`src/core/linkBudget.ts`:** Authoritative DVB-S2X MODCOD table (`MODCOD_TABLE`), `computeGaseousAttenuationDb`, `computeRainAttenuationDb`.
- **`src/core/antennaArray.ts`:** 3D airframe shadowing (`computeAirframeShadowLossDb`).
- **`src/core/macPhyFeedback.ts`:** Closed-loop MAC/PHY feedback (`evaluateDelayedCqiAmc`, `stepOllaOffsetDb`, `stepHarqProcess`, `computeDynamicTdmaOverhead`).
- **`src/core/geodesy.ts`:** WGS-84 ellipsoidal transformations and `wgs84VincentyInverse`.

**Architectural Boundary:**
`src/core/statisticalBenchmarkEngine.ts` is introduced as a pure, stateless mathematical module with zero `Math.random()`, zero mutable global state, and sub-second execution runtime. It consumes the existing physics engines as-is, ensuring 100% backward compatibility across all 94 existing test suites.

---

## 2. Mathematical Formulations & Statistical Engine

### 2.1 Sample Summary Statistics & 95% Student-$t$ Confidence Intervals
Given a sample vector $\mathbf{x} = [x_1, x_2, \dots, x_N]$ filtered for finite numbers:
- **Sample Mean:**
  $$\bar{x} = \frac{1}{N} \sum_{i=1}^N x_i$$
- **Unbiased Sample Variance (Bessel-Corrected):**
  $$s^2 = \frac{1}{N - 1} \sum_{i=1}^N (x_i - \bar{x})^2, \quad s = \sqrt{s^2}$$
- **Standard Error of the Mean (SE):**
  $$\text{SE} = \frac{s}{\sqrt{N}}$$
- **Order Statistics & Percentiles:**
  On sorted array $x_{(1)} \le x_{(2)} \le \dots \le x_{(N)}$, compute median ($p_{50}$), $p_{95}$, and $p_{99}$ via continuous linear interpolation:
  $$\text{pos} = p \cdot (N - 1), \quad k = \lfloor \text{pos} \rfloor, \quad \theta = \text{pos} - k$$
  $$Q(p) = x_{(k+1)} + \theta \cdot (x_{(k+2)} - x_{(k+1)})$$
- **Two-Tailed 95% Student-$t$ Critical Value $t_{0.975, \nu}$ ($\nu = N - 1$):**
  For $\nu \in [1, 30]$, exact values from the standard Student-$t$ distribution are stored:
  - $\nu = 1 \implies 12.7062$
  - $\nu = 5 \implies 2.5706$
  - $\nu = 29 \implies 2.04523$
  - $\nu = 30 \implies 2.04227$
  For $\nu > 30$, the high-order Cornish-Fisher asymptotic expansion is utilized:
  $$t_{0.975, \nu} \approx z + \frac{z^3 + z}{4\nu} + \frac{5z^5 + 16z^3 + 3z}{96\nu^2} + \frac{3z^7 + 19z^5 + 17z^3 - 15z}{384\nu^3}$$
  where $z = \Phi^{-1}(0.975) = 1.95996398454$. As $\nu \to \infty$, $t_{0.975, \nu} \to 1.95996$.
- **Margin of Error (MoE) & Confidence Interval:**
  $$\text{MoE} = t_{0.975, \nu} \cdot \text{SE}$$
  $$\text{CI}_{95\%} = [\bar{x} - \text{MoE}, \, \bar{x} + \text{MoE}]$$

### 2.2 Welch's Two-Sample $t$-Test with Welch–Satterthwaite Degrees of Freedom
Comparing condition $A$ ($n_A, \bar{x}_A, s_A^2$) and condition $B$ ($n_B, \bar{x}_B, s_B^2$):
- **Variance Contributions:**
  $$v_A = \frac{s_A^2}{n_A}, \quad v_B = \frac{s_B^2}{n_B}$$
- **Welch $t$-Statistic:**
  $$t = \frac{\bar{x}_A - \bar{x}_B}{\sqrt{v_A + v_B}}$$
- **Welch–Satterthwaite Degrees of Freedom:**
  $$\nu_{\text{ws}} = \frac{(v_A + v_B)^2}{\frac{v_A^2}{n_A - 1} + \frac{v_B^2}{n_B - 1}}$$
- **Two-Tailed $p$-Value Calculation:**
  The exact two-tailed $p$-value for Student-$t$ with degrees of freedom $\nu = \nu_{\text{ws}}$ is computed via the regularized incomplete beta function $I_x(a, b)$:
  $$x = \frac{\nu}{\nu + t^2}, \quad a = \frac{\nu}{2}, \quad b = \frac{1}{2}$$
  $$p = I_x(a, b) = \frac{B(x; a, b)}{B(a, b)} = \frac{\Gamma(a + b)}{\Gamma(a) \Gamma(b)} \int_0^x u^{a-1} (1-u)^{b-1} du$$
  Evaluated using Lentz's continued fraction expansion:
  $$I_x(a, b) = \frac{x^a (1-x)^b}{a \, B(a, b)} \cdot \frac{1}{1 + \frac{d_1}{1 + \frac{d_2}{1 + \dots}}}$$
  where:
  $$d_{2m} = \frac{m(b - m)x}{(a + 2m - 1)(a + 2m)}, \quad d_{2m+1} = -\frac{(a + m)(a + b + m)x}{(a + 2m)(a + 2m + 1)}$$
  Log-Gamma $\ln \Gamma(z)$ is computed with the 9-term Lanczos approximation, providing numerical precision $< 10^{-12}$.
- **Cohen's $d$ Standardized Effect Size:**
  $$s_{\text{pooled}} = \sqrt{\frac{(n_A - 1)s_A^2 + (n_B - 1)s_B^2}{n_A + n_B - 2}}$$
  $$d = \frac{\bar{x}_A - \bar{x}_B}{s_{\text{pooled}}}$$
  - $|d| < 0.2$: Negligible
  - $0.2 \le |d| < 0.5$: Small
  - $0.5 \le |d| < 0.8$: Medium
  - $|d| \ge 0.8$: Large effect

---

## 3. External Published Reference Anchor Cross-Validation

The benchmark engine directly tests and validates the core physical models against canonical published external benchmarks:

### 3.1 ITU-R P.525 Free-Space Path Loss (FSPL) at 8.0 GHz
Analytical Friis FSPL formula:
$$\text{FSPL}_{\text{dB}} = 20 \log_{10}(d) + 20 \log_{10}(f) + 20 \log_{10}\left(\frac{4\pi}{c}\right)$$
At $f = 8.0\text{ GHz}$ ($c = 299,792,458\text{ m/s}$):
- $d = 1\text{ km} \implies 110.506\text{ dB}$ ($\pm 0.02\text{ dB}$)
- $d = 50\text{ km} \implies 144.486\text{ dB}$ ($\pm 0.02\text{ dB}$)
- $d = 200\text{ km} \implies 156.527\text{ dB}$ ($\pm 0.02\text{ dB}$)

### 3.2 ITU-R P.526-15 Knife-Edge Diffraction Anchor Points
Single knife-edge loss $J(\nu)$:
$$J(\nu) = \begin{cases}
0.0\text{ dB}, & \nu \le -0.78 \\
6.9 + 20 \log_{10}\left(\sqrt{(\nu - 0.1)^2 + 1} + \nu - 0.1\right), & \nu > -0.78
\end{cases}$$
Published anchor points:
- $\nu = -0.78 \implies 0.00\text{ dB}$
- $\nu = 0.0 \implies 6.03 \pm 0.05\text{ dB}$
- $\nu = 1.0 \implies 13.90 \pm 0.05\text{ dB}$
- $\nu = 2.0 \implies 19.16 \pm 0.05\text{ dB}$
- $\nu = 5.0 \implies 26.86 \pm 0.05\text{ dB}$
- Asymptotic octave scaling: $\nu = 10 \to 20 \implies +6.02 \pm 0.05\text{ dB/octave}$ (since $20 \log_{10}(2) = 6.0206\text{ dB}$).

### 3.3 ITU-R P.838-3 Rain & ITU-R P.676-13 Atmospheric Gaseous Attenuation
- **Gaseous Absorption at 8.0 GHz:** At sea level, published oxygen + water vapor attenuation $\gamma_0 \in [0.005, 0.025]\text{ dB/km}$.
- **Rain Attenuation:** At $f = 8.0\text{ GHz}$, $k_H = 0.00411$, $\alpha_H = 1.39 > 1.0$. Rain loss $\gamma_R = k_H R^{\alpha_H}$ is strictly increasing super-linearly with rain rate $R$.

### 3.4 Canonical WGS-84 & $4/3 R_e$ Curvature Anchors
- **Vincenty (1975) Benchmark:** Flinders Peak ($-37.9510334^\circ, 144.4248679^\circ$) to Mt. Buninyong ($-37.6528211^\circ, 143.9264955^\circ$):
  $$\text{Distance} = 54,972.271\text{ m} \pm 0.01\text{ m}, \quad \text{Bearing} = 306.868^\circ \pm 0.01^\circ$$
- **Curved-Earth Bulge:** For $D = 100\text{ km}$ chord ($K = 4/3, R_e = 6,371,000\text{ m}, R_{\text{eff}} = 8,494,666.67\text{ m}$):
  $$\Delta h_{\text{mid}} = \frac{(50,000)^2}{2 \cdot R_{\text{eff}}} = 147.15\text{ m} \pm 1.0\text{ m}$$

---

## 4. 4-Configuration Physics-Realism Ablation Study Design

To rigorously quantify the operational impact of high-fidelity physical modeling, an automated multi-seed ablation benchmark executes $N \ge 30$ independent deterministic seeds across 4 distinct configurations:

```
[1] baseline-idealized:
    Single-edge diffraction, genie-aided L=0 AMC, no bank shadowing, ideal TDMA guard.
         │
         ▼ (Introduce Cascaded Deygout multi-edge + 3D airframe bank shadowing)
[2] multiedge-attitude:
    Cascaded Deygout multi-edge + 3D bank shadowing + genie AMC.
         │
         ▼ (Introduce Realistic 2-frame CQI feedback lag without adaptation)
[3] delayed-cqi-unprotected:
    Multi-edge + 3D bank shadowing + 2-frame CQI lag, NO OLLA, NO HARQ.
         │
         ▼ (Deploy Full Closed-Loop Tactical Stack)
[4] full-realistic-olla-harq:
    Full realistic stack: Deygout multi-edge + 3D bank shadowing + 2-frame CQI lag
    + OLLA adaptive offset + RTT-delayed HARQ Chase Combining + range-coupled TDMA guard.
```

### 4.1 Flight Segment & Tactical Channel
Across $F = 60$ discrete frames ($1.2\text{ s}$ duration at $\Delta t = 20\text{ ms}$):
- **Trajectory:** UAV at slant range $35\text{ km} \le d_{\text{slant}} \le 41\text{ km}$, flying at $150\text{ m/s}$ with continuous sinusoidal bank oscillation ($\pm 25^\circ$).
- **Topography:** Double-ridge mountain pass (Ridge 1 at $12\text{ km}$ alt $3800\text{ m}$, Ridge 2 at $24\text{ km}$ alt $4100\text{ m}$).
- **Fading:** Deterministic 8.0 GHz Doppler kinematics with Rician-Jakes multi-path fading ($K = 6.0\text{ dB}$).

### 4.2 Tracked Metrics & Hypothesis Testing
For each configuration, sample statistics and 95% Student-$t$ CIs are evaluated for:
1. `meanEffectiveGoodputFactor`: Spectral efficiency scaled by $(1 - \text{BLER})$ and TDMA frame efficiency $\eta_{\text{frame}}$.
2. `effectiveBler`: Residual transport block error rate.
3. `outageRatio`: Proportion of frames where link closes below operational MODCOD threshold or suffers slot collision.
4. `meanSnrDb`: Average physical channel SNR.

**Formal Statistical Hypotheses:**
- **Hypothesis 1 (Optimistic Bias of Idealized Models):**
  $H_0: \mu_{\text{goodput}}(\text{baseline-idealized}) = \mu_{\text{goodput}}(\text{full-realistic-olla-harq})$  
  $H_1: \mu_{\text{goodput}}(\text{baseline-idealized}) > \mu_{\text{goodput}}(\text{full-realistic-olla-harq})$ ($p < 0.01$).
- **Hypothesis 2 (Recovery Gain of Closed-Loop OLLA + HARQ):**
  $H_0: \mu_{\text{bler}}(\text{delayed-cqi-unprotected}) = \mu_{\text{bler}}(\text{full-realistic-olla-harq})$  
  $H_1: \mu_{\text{bler}}(\text{delayed-cqi-unprotected}) > \mu_{\text{bler}}(\text{full-realistic-olla-harq})$ ($p < 0.01$).

### 4.3 Determinism & Performance Budget
- **Zero Mutable State:** Hashing utilizes a SplitMix32 sequence from base seed `20261122`.
- **Runtime Target:** All $N = 30$ multi-seed runs across all 4 configurations must execute in $< 1.5\text{ s}$ total.
