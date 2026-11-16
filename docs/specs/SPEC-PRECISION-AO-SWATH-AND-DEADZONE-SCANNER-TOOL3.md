# SPEC-PRECISION-AO-SWATH-AND-DEADZONE-SCANNER-TOOL3: CAD/QGIS-Grade Precision Area-of-Operations (AO) Swath, Dead-Zone Matrix Scanner & Tactical Squad Auto-Deployer Upgrade

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity)  
**Target Runtimes:** `src/core/aoSwathScannerEngine.ts`, `index.html` (`#radar-canvas`, `#tb-pane-region`), `src/tests/verifyPrecisionAoSwathTool3.ts`, `package.json`, `scripts/run_all_verifications.mjs`, `README.md`  

---

## 1. Executive Summary & Operational Context

In high-relief mountainous topography (e.g. the Ladakh sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$), airborne tactical relay planning requires rapid, quantitative area-of-operations (AO) reconnaissance. Military command staff need to immediately delineate a tactical sector, understand relief and slopes, evaluate radio-frequency (RF) line-of-sight and diffraction coverage from orbiting airborne communication nodes (ACN), locate severe shadow dead-zones, and deploy balanced ground squads or high-altitude relay masts.

This upgrade transforms **Tool #3 (`Region` / `#tb-pane-region`)** into a **CAD/QGIS-Grade Precision Area-of-Operations (AO) Swath, Dead-Zone Matrix Scanner & Tactical Squad Auto-Deployer**:
1. **Pure AO Swath Geometry & 64-Cell Dead-Zone Engine (`src/core/aoSwathScannerEngine.ts`):**
   - Live East-West width $\Delta X\text{ [km]}$, North-South height $\Delta Y\text{ [km]}$, diagonal span $D_{\text{diag}}\text{ [km]}$, forward diagonal azimuth $\theta_{\text{diag}}^\circ$, and enclosed area $A\text{ [km}^2\text{]}$.
   - `Shift`-key 1:1 square constraint enforcing $\Delta X === \Delta Y$.
   - $8 \times 8 = 64$ cell zonal RF lattice evaluated against the airborne ACN:
     - 16-step curved-Earth ray-marching ($K = 4/3$ refraction) from each cell center to the ACN.
     - Knife-edge diffraction loss ($L_{\text{diff}}$), ACN quad-sector antenna gain pattern at heading $\psi_{\text{acn}}$, free space path loss (FSPL), and net SINR calculation.
     - Zone classification: `HIGH_RATE_LOS` ($\text{SINR} \ge 12.0\text{ dB} \land \text{isLoS}$), `MARGINAL_DIFFRACTED` ($\text{SINR} \ge -2.85\text{ dB}$), or `DEAD_ZONE_OUTAGE` ($\text{SINR} < -2.85\text{ dB}$).
   - Extreme topographical and RF pin identification:
     - Summit Peak (`▲ SUMMIT [XXXXm · XXdB]`)
     - Valley Floor (`▼ VALLEY [XXXXm]`)
     - Worst Dead Zone (`✕ DEAD ZONE [-XXdB]`)
   - Tactical 4-quadrant squad dispersion coordinates (`squadDeployCoords`).
2. **Interactive Canvas Micro-Interactions (`#radar-canvas`):**
   - Render 64 color-coded matrix tiles directly inside the AO swath: Emerald (`rgba(0, 230, 118, 0.18)`), Amber (`rgba(255, 171, 0, 0.20)`), and Crimson (`rgba(255, 42, 84, 0.24)`).
   - Live CAD dimension callouts along top edge, height edge, and dashed diagonal with azimuth angle.
   - 4 draggable corner handles `[NW, NE, SE, SW]` with hover feedback allowing real-time resizing of the active swath box.
   - On-canvas badges for Summit Peak, Valley Floor, and Worst Dead Zone.
   - Cell-level HUD hover inspector detailing cell elevation, local slope, SINR, and supported MODCOD.
3. **Upgraded Tool #3 DOM Controls (`#tb-pane-region`):**
   - Preserves all existing `#tb-region-*` DOM IDs (`#tb-region-bounds`, `#tb-region-area`, `#tb-region-mean`, `#tb-region-minmax`, `#tb-region-std`, `#tb-region-summit`, `#tb-region-ruggedness`, `#tb-region-los-pct`, `#tb-region-canvas`).
   - Adds `#tb-region-dimensions`, `#tb-region-sinr-stats`, and `#tb-region-valley-floor` readouts.
   - Adds `#btn-region-deploy-squad` to instantly spawn a 4-node soldier tactical squad distributed across the AO quadrants.
   - Adds `#btn-region-spawn-summit-relay` to deploy a Mobile Command Post (MCP) relay on the AO summit peak.
4. **Strict Layout Lock:**
   - Zero modifications to global page layout (`.rail`, `.topbar`, `.app-shell`, `#radar-container`) or `frontend/c2-console-theme.css`.

---

## 2. Mathematical Formulation & Geodetic / RF Identities

### 2.1 Swath Bounding Box & Dimensions
Given two defining diagonal corners $(x_1, y_1)$ and $(x_2, y_2)$ in Local Tangent Plane (ENU) Cartesian meters:
$$x_{\min} = \min(x_1, x_2), \quad x_{\max} = \max(x_1, x_2)$$
$$y_{\min} = \min(y_1, y_2), \quad y_{\max} = \max(y_1, y_2)$$

$$\Delta X_{\text{km}} = \frac{x_{\max} - x_{\min}}{1000}, \quad \Delta Y_{\text{km}} = \frac{y_{\max} - y_{\min}}{1000}$$
$$A_{\text{km}^2} = \Delta X_{\text{km}} \cdot \Delta Y_{\text{km}}$$
$$D_{\text{diag, km}} = \sqrt{\Delta X_{\text{km}}^2 + \Delta Y_{\text{km}}^2}$$
$$\theta_{\text{diag}} = \left(\operatorname{atan2}(x_2 - x_1, y_2 - y_1) \cdot \frac{180}{\pi} + 360\right) \bmod 360$$

When the `Shift` key is engaged, the bounding box is constrained to a 1:1 aspect ratio square:
$$L = \max(|x_2 - x_1|, |y_2 - y_1|)$$
$$x_2' = x_1 + \operatorname{sgn}(x_2 - x_1) \cdot L, \quad y_2' = y_1 + \operatorname{sgn}(y_2 - y_1) \cdot L$$

### 2.2 64-Cell Lattice & Topographical Profiling
The bounding box $[x_{\min}, x_{\max}] \times [y_{\min}, y_{\max}]$ is discretized into an $N \times N$ grid ($N = 8$, giving 64 cells).
For column $c \in [0, N-1]$ and row $r \in [0, N-1]$:
$$x_c = x_{\min} + \left(c + \frac{1}{2}\right) \frac{x_{\max} - x_{\min}}{N}, \quad y_r = y_{\min} + \left(r + \frac{1}{2}\right) \frac{y_{\max} - y_{\min}}{N}$$
$$z_{\text{ground}} = \text{getElevationAt}(x_c, y_r), \quad z_{\text{ant}} = z_{\text{ground}} + 2.0\text{ m}$$

Local slope angle $\theta_{\text{slope}}$ is computed via central finite difference ($\delta = 50\text{ m}$):
$$\nabla_x = \frac{\text{getElevationAt}(x_c + \delta, y_r) - \text{getElevationAt}(x_c - \delta, y_r)}{2\delta}$$
$$\nabla_y = \frac{\text{getElevationAt}(x_c, y_r + \delta) - \text{getElevationAt}(x_c, y_r - \delta)}{2\delta}$$
$$\theta_{\text{slope}} = \operatorname{atan}\left(\sqrt{\nabla_x^2 + \nabla_y^2}\right) \cdot \frac{180}{\pi}$$

Terrain Ruggedness Index (TRI) for cell $k$ relative to the AO mean elevation $\mu_z$:
$$\text{TRI}_k = |z_{\text{ground}, k} - \mu_z|, \quad \text{TRI}_{\text{mean}} = \frac{1}{64} \sum_{k=1}^{64} \text{TRI}_k$$

### 2.3 16-Step Curved-Earth Ray-Marching & RF Evaluation
For each cell antenna at $(x_c, y_r, z_{\text{ant}})$ to the airborne ACN $(x_{\text{acn}}, y_{\text{acn}}, z_{\text{acn}})$:
$$\Delta x = x_{\text{acn}} - x_c, \quad \Delta y = y_{\text{acn}} - y_r, \quad \Delta z = z_{\text{acn}} - z_{\text{ant}}$$
$$D_{\text{horiz}} = \sqrt{\Delta x^2 + \Delta y^2}, \quad D_{3\text{D}} = \sqrt{D_{\text{horiz}}^2 + \Delta z^2}$$

Along the chord, $M = 16$ samples are evaluated at fractional steps $u_i = i / 16$ ($i \in [1, 16]$):
$$s_i = u_i \cdot D_{\text{horiz}}, \quad x_i = x_c + u_i \Delta x, \quad y_i = y_r + u_i \Delta y$$
$$\Delta h_{\text{bulge}}(s_i) = \frac{s_i (D_{\text{horiz}} - s_i)}{2 R_{\text{eff}}} \quad \left(R_{\text{eff}} = \frac{4}{3} R_E \approx 8,494,667\text{ m}\right)$$
$$z_{\text{eff}, i} = \text{getElevationAt}(x_i, y_i) + \Delta h_{\text{bulge}}(s_i), \quad z_{\text{ray}, i} = z_{\text{ant}} + u_i \Delta z$$

Ray occlusion condition:
$$\text{isBlocked} = \exists i \text{ s.t. } z_{\text{eff}, i} \ge z_{\text{ray}, i}$$
$$\nu_i = (z_{\text{eff}, i} - z_{\text{ray}, i}) \sqrt{\frac{2}{\lambda} \left(\frac{1}{\max(1, s_i)} + \frac{1}{\max(1, D_{\text{horiz}} - s_i)}\right)}$$
$$L_{\text{diff}} = \begin{cases} 0 & \nu_{\max} \le -0.78 \\ 6.9 + 20 \log_{10}\left(\sqrt{(\nu_{\max}-0.1)^2 + 1} + \nu_{\max} - 0.1\right) & \nu_{\max} > -0.78 \end{cases}$$

Net Effective SINR:
$$\text{SINR}_{\text{dB}} = P_{\text{tx}} + G_{\text{tx}} - L_{\text{rollOff}} + G_{\text{rx}} - L_{\text{fspl}} - L_{\text{gas}} - L_{\text{diff}} - P_{\text{noise}}$$
Zone Classification:
- `HIGH_RATE_LOS`: $\text{SINR} \ge 12.0\text{ dB} \land \neg\text{isBlocked}$
- `MARGINAL_DIFFRACTED`: $\text{SINR} \ge -2.85\text{ dB} \land \neg\text{HIGH_RATE_LOS}$
- `DEAD_ZONE_OUTAGE`: $\text{SINR} < -2.85\text{ dB}$

### 2.4 Extreme Pins & Squad Deployment
- **Summit Peak:** $\arg\max_k z_{\text{ground}, k}$
- **Valley Floor:** $\arg\min_k z_{\text{ground}, k}$
- **Worst Dead Zone:** $\arg\min_k \text{SINR}_k$
- **Tactical Squad Deployment Coordinates (4 Quadrants):**
  - $Q_{\text{SW}}: [x_{\min} + 0.25 \Delta X, \; y_{\min} + 0.25 \Delta Y, \; z + 2.0]$
  - $Q_{\text{NW}}: [x_{\min} + 0.25 \Delta X, \; y_{\min} + 0.75 \Delta Y, \; z + 2.0]$
  - $Q_{\text{SE}}: [x_{\min} + 0.75 \Delta X, \; y_{\min} + 0.25 \Delta Y, \; z + 2.0]$
  - $Q_{\text{NE}}: [x_{\min} + 0.75 \Delta X, \; y_{\min} + 0.75 \Delta Y, \; z + 2.0]$

---

## 3. Verification Protocol

The implementation is verified via `src/tests/verifyPrecisionAoSwathTool3.ts` with 3 comprehensive verification gates:
- **PAS-T1 (CAD Swath Dimensions, Diagonal Bearing & `Shift` Square Lock):** Enforces square lock $\Delta X === \Delta Y$ when shift is held, and tests exact 3-4-5 right triangle geometry ($4\text{ km} \times 3\text{ km} \to 12\text{ km}^2$, $5\text{ km}$ diagonal, $\theta = 53.1301^\circ$).
- **PAS-T2 (64-Cell RF Coverage Matrix, Extreme Pins & 4-Node Squad Dispersion):** Verifies 64 cells, 100% partition coverage, summit $\ge$ mean $\ge$ valley, worst dead-zone $\le$ mean SINR, and 4 well-spaced tactical squad coordinates.
- **PAS-T3 (DOM Controls & Global Layout Invariance Check):** Ensures all required `#tb-region-*` elements and deployment action buttons exist, and verifies global CSS/layout remains 100% untouched.
