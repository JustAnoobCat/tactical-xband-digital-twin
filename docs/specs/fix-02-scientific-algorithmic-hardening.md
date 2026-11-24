# SPEC-FIX-02: Scientific & Algorithmic Hardening

**Document ID:** `docs/specs/fix-02-scientific-algorithmic-hardening.md`  
**Classification:** Scientific Rigor, Algorithmic Integrity, Geodetic Accuracy & Physical Robustness  
**Target Architecture:** TypeScript / Vite Web Worker Digital Twin (DRDO X-Band Air-to-Ground Relay Network)  
**Status:** Approved & Implemented (Role 2 Implementer)  
**Suite Registration:** Suite 116 (`npm run verify:fix02-algorithms`)  

---

## 1. Executive Summary & Purpose

FIX-02 delivers targeted scientific and algorithmic hardening across four foundational engines of the Tactical X-Band Digital Twin:

1. **Closed-Form 2-Parameter OLS Propagation Calibration (`src/core/digitalTwinCalibrationEngine.ts`):**
   - Upgrades digital twin trace calibration from single-variable constant offset to exact $2 \times 2$ Ordinary Least Squares normal equations fitting $\hat{y}_i = y_i^{\text{sim}} + \Delta_0 + \Delta_n \cdot 10\log_{10}(\max(1, d_i) / 1000)$.
   - Solves hardware loss trim $\Delta_0$ (dB) and empirical path-loss exponent slope delta $\Delta_n$ in closed form.
   - Guarantees finite numerical behavior with zero `NaN` via determinant guard $|\det| < 10^{-12}$ (falling back cleanly to optimal 1D bias $\Delta_0 = -\text{bias}, \Delta_n = 0$), and ensures monotonic RMSE ordering: $\text{RMSE}_{\text{OLS}} \le \text{RMSE}_{\text{1D}} \le \text{RMSE}_{\text{uncal}}$.
   - Backward-compatible with 1D callers via populated `pathLossSlopeDelta` and `olsRmseDb` fields.

2. **Exact 2D `(nodeId, hops)` MANET Routing & High-Relief A2A Terrain Clearance (`src/core/constellationAndMobilityEngine.ts`):**
   - Resolves the hop-constrained shortest path defect where naive 1D Dijkstra permitted a cheaper multi-hop path (exceeding `maxHops`) to prune a valid $\le \text{maxHops}$ route.
   - Tracks 2D distance state per `(nodeId, hopCount)` pair with $O(H \cdot (V \log V + E))$ determinism, preserving the exact half-duplex in-band throughput formula $R_{\text{e2e}} = 1 / \sum (1 / R_h)$.
   - Introduces optional `peakTerrainElevM?: number` parameter to `evaluateA2aCrosslink`. When supplied, evaluates ray midpoint altitude factoring $4/3 R_e$ Earth curvature drop $\Delta h = d^2 / (8 R_e')$; flags `isLineOfSightClear: false`, `losClear: false`, and zeroes backhaul throughput upon mountain ridge obstruction.

3. **MGRS Meridional Arc Band-Boundary Recovery & Actionable GeoTIFF Diagnostics (`src/core/militaryGisEngine.ts`):**
   - Replaces unconstrained latitude band scanning with exact WGS-84 meridional arc minimum/maximum northing bounds $[N_{\min} - 150\text{ km}, N_{\max} + 150\text{ km}]$, preventing $\pm 2{,}000\text{ km}$ 100 km-square cycle jumps across band edges (`32.01°N`, `39.99°N`) and Southern Hemisphere bands (e.g. Sydney `-33.87°S`, Amazon Basin `-3.47°S`).
   - Exports canonical `latLonToMgrs` and `mgrsToLatLon` aliases.
   - Inspects GeoTIFF IFD tags for compression (`tag 259 !== 1`) and tiling (`tag 322/324`), returning crisp actionable diagnostics and `gdal_translate` remediation commands rather than generic errors.

4. **3D Volumetric Fresnel Ellipsoid & Banking Lobe Mathematical Audit (`src/ui/three/threeVolumetricRfMath.ts`):**
   - Inspected `computeFresnelEllipsoidTransform`: verified first Fresnel radius $F_1 = \sqrt{\lambda d_1 d_2 / D}$ at midpoint ($0.5\sqrt{\lambda D}$) with default $0.6 F_1$ knife-edge clearance fraction and Gram-Schmidt SO(3) orthonormal basis ($B^T B = I, \det(B) = +1$).
   - Inspected `computeQuadSectorLobeTransforms`: verified Tait-Bryan attitude rotation sequence (Yaw $\to$ Pitch $\to$ Roll) where positive right bank drops Starboard wing (S1 depression increases, dirY decreases) and raises Port wing (S3 depression decreases, dirY increases).
   - Confirmed 100% mathematically sound; zero sign bugs detected.

---

## 2. Mathematical Formulations

### 2.1 2-Parameter OLS Normal Equations
Given $N$ samples with slant ranges $d_i$, simulated SNR $y_i^{\text{sim}}$, and empirical measured SNR $y_i^{\text{meas}}$:
$$x_i = 10 \log_{10}\left(\frac{\max(1, d_i)}{1000}\right), \quad z_i = y_i^{\text{meas}} - y_i^{\text{sim}}$$
$$\begin{bmatrix} N & \sum x_i \\ \sum x_i & \sum x_i^2 \end{bmatrix} \begin{bmatrix} \Delta_0 \\ \Delta_n \end{bmatrix} = \begin{bmatrix} \sum z_i \\ \sum x_i z_i \end{bmatrix}$$
$$\Delta_n = \frac{N \sum x_i z_i - \sum x_i \sum z_i}{N \sum x_i^2 - (\sum x_i)^2} = \frac{\text{Cov}(x, z)}{\text{Var}(x)}, \quad \Delta_0 = \bar{z} - \Delta_n \bar{x}$$
When $\text{Var}(x) < 10^{-12}$:
$$\Delta_n = 0, \quad \Delta_0 = \bar{z} = -\text{Bias}_{\text{sim}}$$

### 2.2 2D Dijkstra Hop-Constrained Optimization
$$\min_{\pi \in \Pi} \sum_{e \in \pi} w_e \quad \text{s.t.} \quad |\pi| \le H_{\max}, \quad w_e = \frac{1}{\max(0.1, R_e)} + 0.05$$
State space: $S = \{ (u, h) \mid u \in V, h \in [0 \dots H_{\max}] \}$.

### 2.3 Air-to-Air Ridge Occlusion
$$R_e' = \frac{4}{3} R_e \approx 8{,}494{,}667\text{ m}$$
$$h_{\text{ray, mid}} = \frac{h_A + h_B}{2} - \frac{d^2}{8 R_e'}$$
If $h_{\text{ray, mid}} < \text{peakTerrainElevM}$, line-of-sight is blocked ($C_{\text{A2A}} = 0\text{ Mbps}$, $\text{SNR} = -99\text{ dB}$, $\text{FSPL} = 999\text{ dB}$).

---

## 3. Verification Suite 116 Mapping

| Test ID | Gate | Focus | Acceptance Threshold |
|:---|:---|:---|:---|
| **[FIX02-T1]** | 1 | 2-Parameter Closed-Form OLS | Offset error $< 0.05\text{ dB}$, slope error $< 0.05$, $\text{RMSE}_{\text{after}} < 0.05\text{ dB}$, 1D-bias $\text{RMSE} > 1.0\text{ dB}$, collinear/empty guards |
| **[FIX02-T2]** | 2 | 2D MANET & A2A Terrain | Adversarial 4-hop bypass correctly finds 2-hop route $[1, 2, 99]$ with exact $3.333\text{ Mbps}$ half-duplex throughput; 5,800 m ridge blocks two 4,500 m ACNs |
| **[FIX02-T3]** | 3 | MGRS Exactness & GeoTIFF | Round-trip error $< 5.0\text{ m}$ across 6 sectors (Ladakh, band edges, Thar, Sydney, Amazon); crisp tag 259/322 error diagnostics |

---

## 4. Architectural Invariants Maintained

1. **Zero Math.random():** Pure deterministic execution across all modules.
2. **Zero Worker Contamination:** Live worker state runtime preserved intact.
3. **Execution Budget:** Suite 116 completes in $< 1.5\text{ seconds}$.
