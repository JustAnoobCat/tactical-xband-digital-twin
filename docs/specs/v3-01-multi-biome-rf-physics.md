# V3-01: Multi-Biome Theater Platform & Biome-Adaptive RF Physics

**Specification Identifier:** `SPEC-V3-01-MULTI-BIOME-RF-PHYSICS`  
**Milestone:** V3-01 (Frontier Milestone 1)  
**Parent Framework:** `AGENTS.md` (Authoritative Architecture & Discrete-Event Loop Invariants)  
**Status:** **APPROVED FOR IMPLEMENTATION**  

---

## 1. Executive Summary & Problem Formulation

The Tactical X-Band Air-to-Ground Network Digital Twin previously operated primarily within an alpine-mountain environment representing the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$). While this theater provided high-relief mountainous topography for knife-edge diffraction and terrain masking research, tactical airborne operations span diverse global biomes with fundamentally distinct electromagnetic surface properties, vegetation canopies, atmospheric obscurants, and multipath scattering environments:

1. **High-Relief Alpine Mountains (Ladakh / Karakoram):** Dry rocky regolith, high surface roughness ($\sigma_h \approx 1.8\text{ m}$), negligible vegetation, and deep valley knife-edge diffraction.
2. **Arid Sandy Deserts (Thar / Rub' al Khali):** Extremely low electrical conductivity ($\sigma \approx 0.0005\text{ S/m}$), low dielectric permittivity ($\varepsilon_r \approx 3.0$), active sand and dust storms causing high X-band particulate scattering and absorption.
3. **Open Alluvial Plains / Rural-Urban (Indo-Gangetic Basin):** Moderate-to-high moisture loam soil ($\varepsilon_r \approx 15.0, \sigma \approx 0.025\text{ S/m}$), smooth surface topography, significant specular two-ray ground multipath interference.
4. **Tropical Wet Jungle (Northeast India / Western Ghats):** Dense multilayer vegetation canopy with strong specific attenuation ($\gamma_v \approx 1.25\text{ dB/m}$) and saturation according to ITU-R P.833-10, high moisture soil ($\varepsilon_r \approx 20.0$).
5. **Maritime Littoral / Open Ocean (Arabian Sea):** High-salinity seawater with massive relative permittivity ($\varepsilon_r \approx 70.0$) and high conductivity ($\sigma \approx 4.5\text{ S/m}$), yielding strong specular reflections with constructive interference gains up to $+5.5\text{ dB}$ and deep cancellation nulls down to $-25.0\text{ dB}$.

**Objective of V3-01:** Author and deploy a pure, deterministic, multi-biome electromagnetic propagation suite in `src/core/biomePhysics.ts`, provide procedural elevation generators for all 5 biomes in `src/core/terrain.ts`, integrate additive biome EM correction terms into `src/core/linkBudget.ts` without altering existing baseline results when unconfigured, wire biome selection into `src/worker/simWorker.ts` and `index.html`, and verify with Suite 103 (`src/tests/verifyMultiBiomePhysics.ts`).

---

## 2. Architectural Invariants & Constraints

1. **Active Authoritative Runtime:** Live simulation state lives exclusively within `SimulationWorkerManager` in `src/worker/simWorker.ts`. The UI thread remains purely a visualization and command dispatch layer.
2. **50 Hz Discrete-Event Budget ($\Delta t = 20\text{ ms}$):** Every physical function in `src/core/biomePhysics.ts` must execute in $< 5\,\mu\text{s}$ per call. A complete evaluation of 10,000 links must complete in $< 50\text{ ms}$.
3. **Pure Zero-Randomness Determinism:** Zero `Math.random()`. No mutable module-level state. All calculations are pure, closed-form functions of their parameters.
4. **Strict Backward Compatibility:** The simulation boots into `alpine_mountain` by default. When biome EM physics is disabled (default `enableBiomeEmPhysics: false`), link budget evaluations remain bit-for-bit identical to baseline runs, guaranteeing that all 102 existing verification suites pass unmodified.
5. **UI & DOM Standards:** Zero emojis, zero font sizes $< 10\text{px}$, zero duplicate IDs, proper `<label for="...">` accessibility associations in `index.html`.

---

## 3. Mathematical & Physical Formulation

### 3.1 Theater Biome Definitions

The system defines 5 canonical theater biomes frozen in `THEATER_BIOMES`:

| Biome ID | Geographic Center | Elevation Profile | Dielectric $\varepsilon_r$ | Conductivity $\sigma$ (S/m) | Surface Roughness $\sigma_h$ (m) | Refractivity $k$ | Freezing Isotherm (m) | Default Canopy (m) | Default Dust $V$ (km) |
|---|---|---|---|---|---|---|---|---|---|
| `alpine_mountain` | $34.5^\circ\text{N}, 76.5^\circ\text{E}$ | $2,900 - 5,800\text{ m}$ | 5.5 | 0.002 | 1.80 | 1.333 | 4,200 | 0.0 | 15.0 |
| `arid_desert` | $27.0^\circ\text{N}, 71.5^\circ\text{E}$ | $180 - 310\text{ m}$ | 3.0 | 0.0005 | 0.08 | 1.200 | 5,000 | 0.0 | 1.5 |
| `open_plains` | $28.5^\circ\text{N}, 77.2^\circ\text{E}$ | $200 - 240\text{ m}$ | 15.0 | 0.025 | 0.15 | 1.333 | 4,800 | 5.0 | 12.0 |
| `tropical_jungle` | $26.0^\circ\text{N}, 93.0^\circ\text{E}$ | $250 - 1,350\text{ m}$ | 20.0 | 0.035 | 0.35 | 1.333 | 5,200 | 45.0 | 25.0 |
| `maritime_littoral` | $18.5^\circ\text{N}, 72.0^\circ\text{E}$ | $0 - 220\text{ m}$ | 70.0 | 4.500 | 0.05 | 1.333 | 5,500 | 0.0 | 20.0 |

---

### 3.2 Complex Fresnel Two-Ray Reflection Model

For clear line-of-sight propagation paths over reflective ground or sea, specular multipath introduces coherent interference between the direct ray and ground-reflected ray.

#### 3.2.1 Geometric Relations
Let $h_{\text{tx}}$ and $h_{\text{rx}}$ be the altitudes above local ground level (AGL) in metres, and $d_h$ be the horizontal distance in metres:
$$\psi = \arctan\left(\frac{h_{\text{tx}} + h_{\text{rx}}}{d_h}\right)$$
Direct path length:
$$d_1 = \sqrt{d_h^2 + (h_{\text{tx}} - h_{\text{rx}})^2}$$
Reflected path length:
$$d_2 = \sqrt{d_h^2 + (h_{\text{tx}} + h_{\text{rx}})^2}$$
Path length difference:
$$\Delta d = d_2 - d_1$$

#### 3.2.2 Complex Permittivity and Fresnel Reflection
For carrier frequency $f$, wavelength $\lambda = c / f$:
$$\varepsilon_c = \varepsilon_r - j \frac{\sigma}{\omega \varepsilon_0} = \varepsilon_r - j 60 \lambda \sigma$$
The horizontal and vertical Fresnel reflection coefficients are:
$$\Gamma_H = \frac{\sin\psi - \sqrt{\varepsilon_c - \cos^2\psi}}{\sin\psi + \sqrt{\varepsilon_c - \cos^2\psi}}$$
$$\Gamma_V = \frac{\varepsilon_c \sin\psi - \sqrt{\varepsilon_c - \cos^2\psi}}{\varepsilon_c \sin\psi + \sqrt{\varepsilon_c - \cos^2\psi}}$$
For circular polarization (RHCP / LHCP), the co-polarized reflection coefficient is:
$$\Gamma_{\text{circ}} = \frac{\Gamma_H + \Gamma_V}{2}$$

#### 3.2.3 Rayleigh Surface Roughness Reduction
Surface roughness with standard deviation $\sigma_h$ scatters specular energy into diffuse components, damping the coherent specular reflection coefficient according to the Rayleigh criterion:
$$\rho_s = \exp\left(-8\pi^2 \left(\frac{\sigma_h \sin\psi}{\lambda}\right)^2\right)$$
The effective reflection coefficient is:
$$\Gamma_{\text{eff}} = \rho_s \Gamma$$

#### 3.2.4 Coherent Vector Interference Gain
The coherent two-ray field voltage magnitude ratio is:
$$V_{\text{ratio}} = \left|1 + \Gamma_{\text{eff}} \exp\left(-j \frac{2\pi \Delta d}{\lambda}\right)\right|$$
The resulting interference delta in decibels is:
$$G_{\text{2ray,dB}} = 20 \log_{10}(V_{\text{ratio}})$$
To prevent unphysical singularities near zero voltage, $G_{\text{2ray,dB}}$ is clamped to $[-25.0, +5.5]\text{ dB}$.
If the link is blocked by terrain or structural obstacles (`!isLosClear`), or $d_h \le 1\text{ m}$, or either altitude is $\le 0$, $G_{\text{2ray,dB}} = 0.0\text{ dB}$.

---

### 3.3 ITU-R P.833-10 Vegetation & Canopy Attenuation

Vegetation canopy introduces specific attenuation that saturates with penetration depth due to forward diffuse scattering:
$$A_{\text{veg}}(d) = A_m \left(1 - \exp\left(-\frac{d \cdot \gamma_v}{A_m}\right)\right) \left(\frac{f_{\text{GHz}}}{8.0}\right)^{0.39}$$
Where:
- $d$: Canopy path penetration depth in metres ($d \ge 0$).
- $A_m$: Maximum saturation attenuation in dB (tropical dense: $28.0\text{ dB}$; temperate woodland: $22.0\text{ dB}$).
- $\gamma_v$: Initial specific attenuation in dB/m (tropical dense: $1.25\text{ dB/m}$; temperate woodland: $0.75\text{ dB/m}$).
- Frequency scaling follows ITU-R P.833-10 normalized to the X-band carrier ($8.0\text{ GHz}$).
- When $d \le 0$, $A_{\text{veg}} = 0.0\text{ dB}$.

---

### 3.4 Goldhirsh (2001) Sand & Dust Storm Particulate Attenuation

Severe particulate lofting in desert environments causes Mie/Rayleigh scattering and dielectric absorption at X-band. Following Goldhirsh (2001) empirical modeling:
$$\alpha_{\text{dust}} = 0.018 \cdot f_{\text{GHz}} \cdot \max(V_{\text{km}}, 0.02)^{-1.07} \quad [\text{dB/km}]$$
For total path distance $d_{\text{km}}$ through the dust cloud:
$$A_{\text{dust}} = \alpha_{\text{dust}} \cdot d_{\text{km}} \quad [\text{dB}]$$
- For optical visibility $V \ge 10\text{ km}$ (clear air), $A_{\text{dust}} = 0.0\text{ dB}$.
- $V_{\text{km}}$ is lower-bounded at $0.02\text{ km}$ ($20\text{ m}$) to prevent mathematical overflow.
- Total attenuation is bounded to $[0, 45.0]\text{ dB}$.

---

### 3.5 Polarization Mismatch & Rain Cross-Polarization Discrimination (XPD)

Antenna polarization alignment affects received signal power. Modes supported: `'RHCP'`, `'LHCP'`, `'LINEAR_V'`, `'LINEAR_H'`.

1. **Circular Matched (`RHCP` to `RHCP` or `LHCP` to `LHCP`):**
   - Ideal mismatch loss is $0.0\text{ dB}$.
   - Under hydrometeor rain attenuation $A_{\text{rain}} > 0$, rain canting induces cross-polarization discrimination (XPD) degradation modeled via ITU-R P.530:
     $$\text{XPD}_{\text{rain}} = 30.0 - 20.0 \log_{10}(1.0 + A_{\text{rain}} / 5.0)$$
     $$\text{Loss}_{\text{rain,xpd}} = -10 \log_{10}(1.0 - 10^{-\text{XPD}_{\text{rain}} / 10})$$
     clamped to $[0, 3.0]\text{ dB}$.
2. **Opposite Circular (`RHCP` to `LHCP`):**
   - Polarization isolation loss = $25.0\text{ dB}$.
3. **Linear to Circular (`LINEAR_V` / `LINEAR_H` to `RHCP` / `LHCP`):**
   - Exact half-power loss: $10 \log_{10}(2) = 3.0103\text{ dB}$.
4. **Linear to Linear (`LINEAR_V` to `LINEAR_V` / `LINEAR_H`):**
   - Sensitive to aircraft bank angle $\Delta\phi$:
     $$\text{Loss}_{\text{pol}} = -20 \log_{10}\left(\max\left(|\cos\Delta\phi|, 10^{-1.25}\right)\right)$$
     - At $\Delta\phi = 0^\circ$: $0.0\text{ dB}$.
     - At $\Delta\phi = 45^\circ$: $3.0103\text{ dB}$.
     - At $\Delta\phi = 90^\circ$ (orthogonal): capped at $25.0\text{ dB}$.

---

### 3.6 Advecting 2D Weather Cells

Localized convective rain cells translate dynamically across the theater grid:
$$\mathbf{c}(t) = \mathbf{c}_0 + \mathbf{v}_{\text{wind}} \cdot t$$
Rain rate at Cartesian coordinate $(x, y)$:
$$R(x, y, t) = R_{\text{peak}} \exp\left(-\frac{\|\mathbf{p} - \mathbf{c}(t)\|^2}{2 (R_{\text{cell}} / 2)^2}\right)$$
The effective path rain rate between transmitter $\mathbf{p}_{\text{tx}}$ and receiver $\mathbf{p}_{\text{rx}}$ is computed using 7 Simpson-spaced sample points:
$$R_{\text{path}} = \frac{1}{7} \sum_{i=0}^6 R(\mathbf{p}_i, t)$$

---

## 4. System Architecture & Seams

```
+-----------------------------------------------------------------------+
| UI Thread (Main)                                                      |
|   - #dem-sector-select (5 biomes + synthetic)                         |
|   - #tab-terrain: #toggle-biome-em, #biome-pol-select, etc.           |
+-----------------------------------+-----------------------------------+
                                    | PostMessage (Typed IPC)
                                    v
+-----------------------------------------------------------------------+
| Web Worker (simWorker.ts - 50 Hz Event Loop)                          |
|   - SimulationWorkerManager: authoritative biomeId & parameters       |
|   - Regenerates TerrainEngine mesh & hillshade on biome switch        |
|   - Evaluates LinkBudgetEngine with biomeEmParams                     |
|   - Emits telemetry: two-ray gain, veg loss, dust loss, pol loss      |
+-----------------------------------+-----------------------------------+
                                    |
                    +---------------+---------------+
                    v                               v
+-----------------------------------+   +-------------------------------+
| src/core/biomePhysics.ts          |   | src/core/terrain.ts           |
|  - computeTwoRayGroundReflection  |   |  - generateAridDesertGrid     |
|  - computeItuR833VegetationLoss   |   |  - generateOpenPlainsGrid     |
|  - computeGoldhirshDustAtten      |   |  - generateTropicalJungleGrid |
|  - computePolarizationMismatch    |   |  - generateMaritimeLittoral   |
|  - evaluateAdvectingWeatherCells  |   +-------------------------------+
+-----------------------------------+
```

---

## 5. Verification Gate & Acceptance Criteria

Suite 103 (`src/tests/verifyMultiBiomePhysics.ts`) enforces 5 mandatory assertions:
1. **[MBP-T1] Two-Ray Fresnel & Roughness Physics:** Smooth seawater ($\varepsilon_r = 70, \sigma = 4.5, \sigma_h = 0.05\text{ m}$) produces constructive peaks ($> +3\text{ dB}$) and deep nulls ($< -8\text{ dB}$); rough mountain terrain ($\sigma_h = 2.0\text{ m}$) damps reflection to near $0\text{ dB}$; NLOS returns exact $0.0\text{ dB}$.
2. **[MBP-T2] Vegetation & Dust Attenuation:** Strictly monotonic, zero loss at $0\text{ m}$ foliage / clear air $V \ge 10\text{ km}$, finite bounded values without `NaN` or `Infinity`.
3. **[MBP-T3] Polarization Mismatch:** Linear at $45^\circ$ bank yields $3.0103 \pm 0.01\text{ dB}$; circular co-pol is bank-immune ($0.0\text{ dB}$); cross-pol isolation is $25.0\text{ dB}$; linear-to-circular is $3.0103\text{ dB}$.
4. **[MBP-T4] Advecting Weather Cells & Biome Terrains:** Dynamic storm translation modulates path rain rate cleanly; all 5 procedural terrains produce valid finite elevations matching their biome specifications (Maritime has sea level $0\text{ m}$, Desert $180 - 310\text{ m}$, Alpine $> 4,500\text{ m}$).
5. **[MBP-T5] Live Worker Integration & Budget:** Clean biome switching in `SimulationWorkerManager`, state preservation across `RESET_SIM`, and 10,000 evaluations executing in $< 50\text{ ms}$ ($< 5\,\mu\text{s/call}$).
