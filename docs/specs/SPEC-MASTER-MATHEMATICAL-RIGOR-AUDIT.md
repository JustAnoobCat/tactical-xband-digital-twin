# SPEC-MASTER-MATHEMATICAL-RIGOR-AUDIT: Master Mathematical & Physical Rigor Audit

**Specification Document:** `docs/specs/SPEC-MASTER-MATHEMATICAL-RIGOR-AUDIT.md`  
**Status:** Approved by Role 1 Engineering Planner (Gemini Argon)  
**Execution Lead:** Role 2 Coder / Implementer  
**Classification:** Core Simulation Physics & Master Verification  
**Applies to Modules:** `src/core/*` and `src/ui/three/*`  

---

## 1. Executive Summary & Audit Scope

This specification establishes complete mathematical, physical, and geodetic rigor across all 16 core engines and UI components of the DRDO Tactical X-Band Air-to-Ground Network Digital Twin. It provides exact analytical proofs, eliminates discrepancies between chord and local-tangent spherical Earth coordinate frames, harmonizes 3D aircraft attitude rotations with WebGL/Three.js axes, enforces continuous boundary transitions for ITU-R P.526-15 rounded-crest diffraction $T(m, n)$, and consolidates all 10 core physics domains into a unified Master Mathematical Verification Suite (`src/tests/verifyMasterMathematicalRigor.ts`).

---

## 2. Mathematical Corrections & Seams

### 2.1 Task 1: Earth Curvature Bulge Sign & Coordinate Frame Invariance
In the chord reference frame between transmitter TX at $(0, z_{\text{ant}})$ and receiver RX at $(D, z_{\text{acn}})$:
$$z_{\text{los}}(s) = z_{\text{ant}} + \frac{s}{D}(z_{\text{acn}} - z_{\text{ant}})$$
The effective Earth curvature bulge arches **upward** into the chord by:
$$\Delta h_{\text{bulge}}(s) = +\frac{s(D - s)}{2 K R_E} \ge 0$$
where $K = 4/3$ and $R_E = 6,371,000\text{ m}$, yielding an effective radius $R_{\text{eff}} \approx 8,494,666.67\text{ m}$.
At baseline $D = 20\text{ km}$ and midpoint $s = 10\text{ km}$:
$$\Delta h_{\text{bulge}}(10\text{ km}) = \frac{10000 \times 10000}{2 \times 8494666.67} = +5.886046\text{ m}$$

In `src/core/cursorProbeEngine.ts`:
1. **Probe $\to$ ACN Path:** The chord-frame effective terrain elevation is $z_{\text{eff}}(s) = z_{\text{dem}}(s) + \Delta h_{\text{bulge}}(s)$. The horizon mask elevation angle along the path is evaluated in the chord frame as:
   $$\theta_{\text{horizon}}(s) = \text{atan2}(z_{\text{eff}}(s) - z_{\text{ant}}, \, s)$$
   Comparing $\max \theta_{\text{horizon}}(s)$ against chord elevation angle $\theta_{\text{elToAcn}} = \text{atan2}(z_{\text{acn}} - z_{\text{ant}}, \, D)$ guarantees that angular clearance $\Delta \theta = \theta_{\text{elToAcn}} - \max \theta_{\text{horizon}}$ is strictly positive if and only if geometric clearance $z_{\text{los}}(s) - z_{\text{eff}}(s) > 0$ along all samples.
2. **16-Sector 360° Polar Horizon Ring:** At arbitrary azimuths without a chord endpoint $D$, terrain peaks at distance $r$ drop below the local horizontal tangent plane by $-\frac{r^2}{2 K R_E}$, evaluated as $\theta_{\text{localHorizon}}(r) = \text{atan2}(z_{\text{dem}}(r) - \frac{r^2}{2 K R_E} - z_{\text{ant}}, \, r)$, and compared against the curvature-corrected ACN elevation angle:
   $$\theta_{\text{elToAcn,true}} = \text{atan2}\left(z_{\text{acn}} - \frac{D^2}{2 K R_E} - z_{\text{ant}}, \, D\right)$$
3. **Helper Engines Audit:** Verified that `geodeticRulerEngine.ts`, `aoSwathScannerEngine.ts`, `cadObstacleSlicerEngine.ts`, and `tacticalAiPathfinder.ts` all add $+\Delta h_{\text{bulge}}$ to $z_{\text{dem}}$ in the chord frame, matching `TerrainEngine.computeEarthBulge`.

---

### 2.2 Task 2: 3D Sector Cone Euler Rotation Axis Alignment
In the project's Three.js coordinate space, world axes map to ENU as follows:
- $+X = \text{East}$
- $+Y = \text{North}$
- $+Z = \text{Up}$

The ACN aircraft model and the 4-sector antenna cone array are modeled in body coordinates where:
- $+Y = \text{Aircraft Forward Nose (0° FWD)}$
- $+X = \text{Starboard Wing (90° STBD)}$
- $+Z = \text{Dorsal Up}$

Euler rotation order is `'ZYX'`, meaning intrinsic rotations apply around world Vertical $Z$ (Yaw $\psi$), then body Forward $Y$ (Bank/Roll $\phi$), then body Lateral $X$ (Pitch $\theta = 0$):
$$\text{yawRotZ} = -\psi = -\frac{\text{headingDeg} \cdot \pi}{180.0}$$
$$\text{bankRad} = \frac{\text{bankDeg} \cdot \pi}{180.0}$$
$$\mathbf{R}_{\text{sector}} = \mathbf{R}_z(\text{yawRotZ}) \cdot \mathbf{R}_y(\text{bankRad})$$
This guarantees:
1. Heading (Yaw) rotates strictly around the true Three.js Vertical (Up) axis ($+Z$).
2. Bank (Roll) rotates strictly around the true Aircraft Forward axis ($+Y$).
3. Sector S0 (0° FWD) points along the exact same 3D velocity vector as the ACN aircraft nose.

---

### 2.3 Task 3: ITU-R P.526-15 §4.2 Cylinder Curvature $T(m, n)$ Boundary Continuity
In ITU-R P.526-15 §4.2, rounded-crest diffraction attenuation $T(m, n)$ accounts for crest radius of curvature $r_{\text{crest}}$:
$$m = r_{\text{crest}}^{2/3} \left(\frac{d_1 + d_2}{d_1 d_2}\right) \left(\frac{\lambda}{\pi}\right)^{1/3}$$
$$n = h_{\text{obs}} r_{\text{crest}}^{-1/3} \left(\frac{\pi}{\lambda}\right)^{2/3}$$
When $mn \le 4$:
$$T(m, n) = 7.2 \sqrt{m} - (2.0 - 12.5 n) m + 3.6 m^{1.5} - 0.8 m^2$$
When $mn > 4$:
$$T(m, n) = -6.0 - 20\log_{10}(mn) + 7.2 \sqrt{m} - (2.0 - 17.0 n) m + 3.6 m^{1.5} - 0.8 m^2$$

**Boundary Clamping & Smoothness:**
1. When $\nu \le -0.78$ (LoS ray completely clear of the first Fresnel zone):
   $$T(m, n) \equiv 0.0\text{ dB}$$
2. When $-0.78 < \nu < 0$ (clear optical LoS $h_{\text{obs}} < 0$, but grazing the lower 60% of the 1st Fresnel zone):
   $n$ is computed using $h_{\text{obs}} = 0$ ($n = 0$), and $T(m, 0)$ is scaled smoothly by the grazing intrusion factor:
   $$\kappa_{\text{graze}}(\nu) = \left(\frac{\nu + 0.78}{0.78}\right)^2 \in [0, 1]$$
   $$T_{\text{graze}} = T(m, 0) \cdot \kappa_{\text{graze}}(\nu)$$
   At $\nu = -0.78$, $\kappa_{\text{graze}} = 0 \implies T = 0\text{ dB}$ (continuous $C^0$ transition with zero jump discontinuity).
   At $\nu = 0$, $\kappa_{\text{graze}} = 1 \implies T = T(m, 0)$.

---

## 3. Master Verification Test Architecture (`verifyMasterMathematicalRigor.ts`)

The Master Verification Suite is organized into 5 comprehensive test suites (MMR-T1 through MMR-T5):

| Suite | Domain | Physical / Mathematical Identities Verified |
|:---|:---|:---|
| **MMR-T1** | Curved-Earth Geodesy | Identical $\Delta h_{\text{bulge}} = +5.886046\text{ m}$ at 20km midpoint across all 6 engines (`TerrainEngine`, `geodeticRulerEngine`, `cursorProbeEngine`, `aoSwathScannerEngine`, `cadObstacleSlicerEngine`, `tacticalAiPathfinder`). Verification that a terrain peak at $z_{\text{los}} - 3\text{ m}$ is occluded ($+2.886\text{ m}$ intrusion) across all engines. |
| **MMR-T2** | Radiometry & Atmosphere | Friis FSPL at 8.0 GHz ($10\text{ km} \to 130.5115\text{ dB}$), analytical scale-height integral $\eta(z_1, z_2, H)$ for ITU-R P.676 absorption, and ITU-R P.618 sky-noise temperature coupling $\Delta N_{\text{sky,dB}}$. |
| **MMR-T3** | Diffraction & Obstacles | ITU-R P.526-15 knife-edge $J(0) \approx 6.02\text{ dB}$, continuous $C^0$ transition of $J(\nu) + T(m, n) \to 0\text{ dB}$ as $\nu \to -0.78$, and Bullington double-horizon tangent apex geometry. |
| **MMR-T4** | Antennas & Doppler | ITU-R F.1336 $-3.000000\text{ dB}$ crossover at $\pm 45^\circ$, exact closing Doppler shift $f_d = (f_c/c)v_{\text{rad}}$ and closest-approach transverse rate $\dot{f}_d = -(f_c/c)(v_\perp^2/d)$, Clarke/Jakes Rician unit-mean second moment $A_s^2 + 6\sigma_d^2 \equiv 1.000000000$. |
| **MMR-T5** | Network, QoS & Capacity | Decode-and-Forward harmonic capacity $R_{\text{DF}} = (R_1 R_2)/(R_1 + R_2)$, Jain's Fairness Index $\mathcal{J}(\vec{x}) \in [1/N, 1]$, DVB-S2X unit average constellation energy $\frac{1}{M}\sum |s_k|^2 = 1.000000$, PDU bit conservation, and 4-sector TDMA airtime conservation. |

---

## 4. Verification Protocol & Quality Gates

To confirm zero regressions and mathematical perfection:
1. `npm run typecheck`
2. `node scripts/verify-project.mjs`
3. `npx vite-node src/tests/verifyMasterMathematicalRigor.ts`
4. `node scripts/run_all_verifications.mjs` (All 85 suites passing 100%)
5. `npm run verify:browser`
6. `npm run build`
