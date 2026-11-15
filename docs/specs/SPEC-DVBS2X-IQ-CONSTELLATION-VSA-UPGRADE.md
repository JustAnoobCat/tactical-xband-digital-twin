# SPEC-DVBS2X-IQ-CONSTELLATION-VSA-UPGRADE: Keysight 89600 & Rohde & Schwarz VSE DVB-S2X Baseband I/Q Constellation, EVM & LDPC BLER Analyzer Upgrade

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity)  
**Scope:** `src/core/vsaConstellationEngine.ts`, `index.html`, `src/tests/verifyVsaConstellationUpgrade.ts`, `package.json`, `scripts/run_all_verifications.mjs`, `README.md`  

---

## 1. Executive Summary & Operational Context

The Tactical X-Band Air-to-Ground Network Digital Twin models an airborne communications node (ACN) relaying multi-service tactical traffic across 16 ground stations in high-relief mountainous topography (Ladakh sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$). The physical air-to-ground interface utilizes ETSI EN 302 307-2 (DVB-S2X) adaptive coding and modulation (ACM) waveforms across 8 operational MODCOD tiers ranging from $\pi/2\text{-BPSK}$ to $64\text{-APSK}$.

This specification defines the deep physical layer vector signal instrumentation of the **Ground Terminals Workspace (`#tab-terminal`)**, inspired by premier test & measurement vector signal analyzer (VSA) platforms (Keysight 89600 VSA and Rohde & Schwarz VSE):
1. **Pure TypeScript DVB-S2X Baseband I/Q Constellation, EVM & LDPC BLER Engine (`src/core/vsaConstellationEngine.ts`)**:
   - First-principles canonical unit-energy DVB-S2X reference constellations ($E_{\text{avg}} = \frac{1}{M}\sum_{k=0}^{M-1} |s_k|^2 \equiv 1.000000$) covering $\text{QPSK}$, $8\text{-PSK}$, $16\text{-QAM}$, $16\text{-APSK}$ (ETSI EN 302 307-1 concentric 4+12 ring geometry, $\gamma = 2.60$), $32\text{-APSK}$ (concentric 4+12+16 ring geometry, $\gamma_1 = 2.54, \gamma_2 = 4.33$), and $64\text{-QAM} / 64\text{-APSK}$ ($8 \times 8$ square QAM lattice normalized by $1/\sqrt{42}$).
   - Analytical Root-Mean-Square Error Vector Magnitude ($\text{EVM}_{\text{rms}}$) and $\text{EVM}_{\text{dB}}$ calculated directly from instantaneous terminal Signal-to-Interference-plus-Noise Ratio (SINR $\gamma_{\text{dB}}$).
   - Carrier Recovery PLL residual phase jitter $\sigma_{\theta,\text{deg}}$ modeling the joint impact of additive noise, Doppler shift $f_d$, and 3GPP Rician $K$-factor multipath spread.
   - Post-LDPC FECFRAME waterfall Block Error Rate ($\text{BLER}$) modeling steep DVB-S2X 64,800-bit LDPC waterfall performance ($\beta = 4.5\text{ dB}^{-1}$).
   - Deterministic 64-symbol complex baseband scatter cloud generator using Box-Muller Gaussian transformations scaled by physical noise variance $\sigma_n^2 = 1/\max(\gamma_{\text{lin}}, 0.01)$.
2. **Interactive I/Q Constellation & Vector Signal Analyzer Scope in `#tab-terminal` (`index.html`)**:
   - HiDPI DPR-scaled baseband constellation scope (`#iq-constellation-canvas`) rendering $I/Q$ orthogonal crosshairs, unit-energy circle ($|s| = 1.0$), reference constellation targets (`+`), and 64 received symbol scatter clouds.
   - Synchronized terminal selector (`#vsa-node-select`) and live demodulator lock status badge (`#vsa-lock-badge`).
   - Detailed VSA physical layer telemetry grid displaying RMS EVM, SINR margin against MODCOD threshold, PLL phase jitter $\sigma_\theta$, and post-LDPC BLER.
3. **Strict UI Layout & Invariant Locks**:
   - Preserves global page layout (`.rail`, `.topbar`, `.app-shell`, `#radar-container`) and theme colors in `frontend/c2-console-theme.css` 100% untouched.
   - All additions are strictly confined within `#tab-terminal`.

---

## 2. Mathematical Formulation & Physical Standards

### 2.1 Canonical Unit-Energy DVB-S2X Constellations (ETSI EN 302 307-1 / EN 302 307-2)

All reference constellations are normalized to exact unit average symbol energy:
$$E_{\text{avg}} = \frac{1}{M}\sum_{k=0}^{M-1} (|I_k|^2 + |Q_k|^2) = 1.000000$$

1. **QPSK ($M = 4$):**
   Points placed on the unit circle at $\pm 45^\circ, \pm 135^\circ$:
   $$s_k = \frac{1}{\sqrt{2}} (\pm 1 \pm j), \quad |s_k|^2 = 1.0$$

2. **8-PSK ($M = 8$):**
   Points placed on the unit circle with uniform angular separation $\Delta\theta = \frac{\pi}{4}$:
   $$s_k = \cos\left(k \frac{\pi}{4}\right) + j \sin\left(k \frac{\pi}{4}\right), \quad k \in \{0, 1, \dots, 7\}$$

3. **16-APSK ($M = 16$, 4+12 Concentric Rings):**
   ETSI EN 302 307-1 specifies two concentric rings with radius ratio $\gamma = R_2 / R_1 = 2.60$:
   - Inner ring ($N_1 = 4$): radius $R_1$, angles $\theta_1 = \frac{\pi}{4} + k \frac{\pi}{2}$ for $k=0..3$.
   - Outer ring ($N_2 = 12$): radius $R_2 = \gamma R_1$, angles $\theta_2 = \frac{\pi}{12} + m \frac{\pi}{6}$ for $m=0..11$.
   The average energy equation:
   $$E_{\text{avg}} = \frac{4 R_1^2 + 12 (\gamma R_1)^2}{16} = \frac{R_1^2 (4 + 12 \gamma^2)}{16} \equiv 1.0 \implies R_1 = \sqrt{\frac{4}{1 + 3\gamma^2}}, \quad R_2 = \gamma R_1$$

4. **16-QAM ($M = 16$, $4 \times 4$ Grid):**
   Uniform rectangular lattice $I, Q \in \{-3, -1, 1, 3\} / \sqrt{10}$, yielding:
   $$E_{\text{avg}} = \frac{1}{16} \sum_{i} (I_i^2 + Q_i^2) = \frac{10}{10} = 1.000000$$

5. **32-APSK ($M = 32$, 4+12+16 Concentric Rings):**
   ETSI EN 302 307-1 specifies three concentric rings with radius ratios $\gamma_1 = R_2 / R_1 = 2.54$, $\gamma_2 = R_3 / R_1 = 4.33$:
   - Ring 1 ($N_1 = 4$): radius $R_1$, angles $\frac{\pi}{4} + k \frac{\pi}{2}$ ($k=0..3$).
   - Ring 2 ($N_2 = 12$): radius $R_2 = \gamma_1 R_1$, angles $\frac{\pi}{12} + m \frac{\pi}{6}$ ($m=0..11$).
   - Ring 3 ($N_3 = 16$): radius $R_3 = \gamma_2 R_1$, angles $\frac{\pi}{16} + p \frac{\pi}{8}$ ($p=0..15$).
   Normalization constant:
   $$R_1 = \sqrt{\frac{32}{4 + 12\gamma_1^2 + 16\gamma_2^2}}, \quad R_2 = \gamma_1 R_1, \quad R_3 = \gamma_2 R_1$$

6. **64-QAM / 64-APSK ($M = 64$, $8 \times 8$ Grid):**
   Square lattice $I, Q \in \{-7, -5, -3, -1, 1, 3, 5, 7\} / \sqrt{42}$:
   $$\sum_{k=-7,\text{odd}}^7 k^2 = 168 \implies \frac{1}{8}(168) + \frac{1}{8}(168) = 42 \implies \text{Scale} = \frac{1}{\sqrt{42}}$$

---

### 2.2 First-Principles Physical Signal Quality & VSA Metrics

1. **Linear SINR and Noise Variance:**
   $$\gamma_{\text{lin}} = 10^{\gamma_{\text{dB}} / 10.0}, \quad \sigma_n^2 = \frac{1}{\max(\gamma_{\text{lin}}, 0.01)}$$
2. **Analytical RMS Error Vector Magnitude ($\text{EVM}_{\text{rms}}$):**
   $$\text{EVM}_{\text{rms,pct}} = \text{clamp}_{[0.5, 100.0]}\left(100.0 \cdot \sqrt{\frac{1}{\max(\gamma_{\text{lin}}, 0.01)}}\right) [\%]$$
   $$\text{EVM}_{\text{dB}} = -\gamma_{\text{dB}}$$
3. **Carrier Recovery PLL Residual Phase Error ($\sigma_{\theta,\text{deg}}$):**
   $$\sigma_{\theta,\text{deg}} = \text{clamp}_{[0.1, 45.0]}\left(\frac{180}{\pi} \sqrt{\frac{1}{2 \max(\gamma_{\text{lin}}, 0.1)} + \frac{0.002 \cdot (|f_d| / 1600.0)^2}{\max(10^{K_{\text{dB}}/10}, 0.5)}}\right)$$
4. **Post-LDPC Block Error Rate ($\text{BLER}$):**
   Steep DVB-S2X LDPC waterfall curve ($\beta = 4.5\text{ dB}^{-1}$) with 0.8 dB implementation margin offset:
   $$\text{BLER} = \text{clamp}_{[10^{-7}, 1.0]}\left(\frac{1.0}{1.0 + \exp\big(4.5 \cdot (\gamma_{\text{dB}} - \gamma_{\text{req,dB}} + 0.8)\big)}\right)$$
5. **Deterministic Noisy Symbol Cloud Synthesis ($N_{\text{sym}} = 64$):**
   Complex symbol generation using Box-Muller Gaussian synthesis:
   $$r_m = s_{k(m)} e^{j \Delta\theta_m} + (n_{I,m} + j n_{Q,m})$$
   where $s_{k(m)}$ is drawn from the reference constellation, $\Delta\theta_m \sim \mathcal{N}(0, \sigma_{\theta,\text{rad}}^2)$, and $n_{I,m}, n_{Q,m} \sim \mathcal{N}\left(0, \frac{\sigma_n^2}{2}\right)$.

---

## 3. UI Implementation Details

1. **VSA Panel Placement in `#tab-terminal`:**
   Placed directly within `#terminal-subtab-view-inventory` between the top control cards and the inventory table.
2. **DOM Element Identifiers:**
   - `#vsa-node-select`: Synchronized node selection dropdown.
   - `#vsa-lock-badge`: Demodulator and LDPC lock badge (`DEMOD LOCK [LDPC OK]` or `CARRIER UNLOCK [OUTAGE]`).
   - `#iq-constellation-canvas`: $240 \times 240$ HiDPI canvas scope rendering $I/Q$ crosshairs, unit circle, ideal constellation points, and received symbol scatter cloud.
   - `#vsa-evm-pct`: Displaying percentage and dB EVM.
   - `#vsa-snr-margin`: Displaying margin above active MODCOD minimum SNR threshold.
   - `#vsa-phase-err`: Displaying PLL phase jitter $\sigma_\theta$ and Doppler shift $f_d$.
   - `#vsa-ldpc-bler`: Displaying post-LDPC block error rate.
   - `#vsa-modcod-order`: Displaying active MODCOD name, constellation order, and spectral efficiency.

---

## 4. Verification Gates Protocol

- **VSA-T1:** Exact unit-energy normalization across all DVB-S2X constellations ($\frac{1}{M}\sum |s_k|^2 = 1.000 \pm 10^{-4}$).
- **VSA-T2:** First-principles EVM ($\text{EVM}(20\text{ dB}) = 10.00\%$, $\text{EVM}(0\text{ dB}) = 100.00\%$) and monotonic LDPC BLER waterfall decline with increasing SINR margin.
- **VSA-T3:** DOM presence inside `#tab-terminal`, zero alterations to global layouts/themes, and specification registration on disk and in `README.md`.
