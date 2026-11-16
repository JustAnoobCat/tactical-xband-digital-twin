# SPEC-PRECISION-CURSOR-RF-PROBE-AND-UNIT-SPAWNER-TOOL2: CAD/STK-Grade Precision Cursor RF Link Probe, 360° Horizon Mask Analyzer & Unit Spawner Upgrade

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity)  
**Target Runtimes:** `src/core/cursorProbeEngine.ts`, `index.html` (`#radar-canvas`, `#tb-pane-probe`), `src/tests/verifyPrecisionCursorProbeTool2.ts`, `package.json`, `scripts/run_all_verifications.mjs`, `README.md`  

---

## 1. Executive Summary & Operational Context

In high-relief tactical theaters such as the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$), radio line-of-sight (LoS) to airborne communication nodes (ACN) is heavily governed by surrounding ridgelines, terrain horizon masks, and aircraft quad-sector antenna orientation. Rapid deployment of ground tactical assets (e.g. Soldier Terminals, Mobile Command Posts, or Electronic Warfare Jammer relocations) requires operators to analyze link viability, horizon clearance, and antenna mast elevations dynamically across the terrain surface.

This upgrade transforms **Tool #2 (`Probe` / `#tb-pane-probe`)** from a static single-site query into a **CAD/STK-Grade Precision Cursor RF Link Probe, 360° Horizon Mask Analyzer & Unit Spawner**:
1. **Pure Cursor RF Link & 360° Horizon Mask Engine (`src/core/cursorProbeEngine.ts`):**
   - Instantaneous 3D slant geometry, forward azimuth $\theta_{\text{azToAcn}}$, and elevation angle $\theta_{\text{elToAcn}}$ from the cursor probe antenna to the airborne ACN.
   - High-fidelity 48-sample curved-Earth ray-marching ($K = 4/3$ effective Earth radius) evaluating the terrain horizon mask angle $\theta_{\text{mask}}$ and angular clearance $\Delta\theta_{\text{clearance}} = \theta_{\text{elToAcn}} - \theta_{\text{mask}}$.
   - Identification of dominant blocking ridge peak coordinates and elevation when optical LoS is occluded.
   - Serving ACN quadrant sector identification ($S_0 \dots S_3$: FWD, STBD, AFT, PORT), off-boresight angle computation, and ITU-R F.1336 antenna roll-off loss.
   - 8.0 GHz tactical link budget computing FSPL, ITU-R P.676 atmospheric gaseous loss, ITU-R P.526 knife-edge diffraction loss, received SINR, DVB-S2X / 3GPP Rel-17 NTN adaptive MODCOD mapping, and net achievable bitrate.
   - 16-compass-azimuth 360° polar horizon mask skyline evaluation calculating clear-sky vs. terrain-masked azimuths and percentage sky openness.
   - Reference pin `[P1]` lock & real-time differential comparison ($\Delta\text{Elev}, \Delta\text{SINR}, \Delta\text{Bitrate}$, range, and bearing).
   - Polar-grid 2 km radius smart peak finder scanning 16 azimuths $\times$ 5 radial distances to pinpoint optimal antenna siting locations.
2. **Interactive Canvas Micro-Interactions (`#radar-canvas`):**
   - Real-time split-color Probe $\to$ ACN vector: solid Emerald (`#00e676`) when clear LoS, or split at the blocking ridge crest with a pulsing crimson **`✕ BLOCKING RIDGE [XXXXm]`** marker and dashed Crimson (`#ff2a54`) into the terrain shadow.
   - 360° Polar Horizon Mask Ring (`34px` radius) centered on the probe cursor: rendering clear-sky sectors in Emerald and terrain-masked sectors in Crimson.
   - Interactive reference pin `[P1]` anchor badge with dashed cyan differential comparison line to the moving cursor.
3. **Upgraded Tool #2 DOM Controls (`#tb-pane-probe`):**
   - Preserves all existing `#tb-probe-*` IDs (`#tb-probe-acn-range`, `#tb-probe-acn-el`, `#tb-probe-acn-los`, `#tb-probe-acn-sinr`, `#tb-probe-acn-modcod`, `#tb-probe-spawn-node`).
   - Adds `#tb-probe-mast-input` for custom antenna mast heights ($1 \dots 200\text{ m AGL}$).
   - Adds `#tb-probe-unit-select` allowing direct deployment of Soldier Terminals ($30\text{ dBm}$), Mobile Command Posts ($40\text{ dBm}$), or EW Jammer relocations.
   - Adds `#tb-probe-horizon-mask`, `#tb-probe-sector-bore`, and `#tb-probe-delta-pin` telemetry readouts.
   - Adds `#btn-probe-snap-best` to automatically snap the probe to the highest SINR peak within 2 km.
4. **Strict Layout Lock:**
   - Zero changes to global page layout (`.rail`, `.topbar`, `.app-shell`, `#radar-container`) or `frontend/c2-console-theme.css`.

---

## 2. Mathematical Formulation & Geodetic / RF Identities

### 2.1 Horizontal & 3D Slant Geometry to ACN
Given probe coordinates $(x_P, y_P)$ with ground elevation $z_{\text{ground}} = \text{getElevationAt}(x_P, y_P)$ and antenna mast height $h_{\text{mast}}$:
$$z_{\text{ant}} = z_{\text{ground}} + h_{\text{mast}}$$

Given ACN position $(x_{\text{acn}}, y_{\text{acn}}, z_{\text{acn}})$ in Local Tangent Plane (ENU) Cartesian meters:
$$\Delta x = x_{\text{acn}} - x_P, \quad \Delta y = y_{\text{acn}} - y_P, \quad \Delta Z = z_{\text{acn}} - z_{\text{ant}}$$
$$D_{\text{horiz}} = \sqrt{\Delta x^2 + \Delta y^2}, \quad D_{3\text{D}} = \sqrt{D_{\text{horiz}}^2 + \Delta Z^2}$$

### 2.2 Forward Azimuth and Vertical Elevation Angle
Forward compass azimuth from Probe to ACN ($0^\circ = \text{North } +y, 90^\circ = \text{East } +x$):
$$\theta_{\text{azToAcn}} = \left(\operatorname{atan2}(\Delta x, \Delta y) \cdot \frac{180}{\pi} + 360\right) \bmod 360$$

Vertical elevation angle from probe antenna to ACN:
$$\theta_{\text{elToAcn}} = \operatorname{atan2}(\Delta Z, \max(D_{\text{horiz}}, 1.0)) \cdot \frac{180}{\pi}$$

### 2.3 48-Sample Curved-Earth Ray-Marching & Horizon Mask Angle
Along the ground path $(x_P, y_P) \to (x_{\text{acn}}, y_{\text{acn}})$, $N = 48$ samples are taken at fractional steps $u_i = i / 48$ for $i \in [1, 48]$:
$$s_i = u_i \cdot D_{\text{horiz}}, \quad x_i = x_P + u_i \Delta x, \quad y_i = y_P + u_i \Delta y$$
$$z_{\text{dem}, i} = \text{getElevationAt}(x_i, y_i)$$

With standard $K = 4/3$ atmospheric refraction ($R_E = 6,371,000\text{ m}$, $R_{\text{eff}} = K R_E \approx 8,494,667\text{ m}$):
The curvature drop relative to the probe tangent plane is:
$$\Delta h_{\text{bulge}}(s_i) = \frac{s_i^2}{2 R_{\text{eff}}}$$

The terrain elevation angle from the probe antenna is:
$$\theta_i = \operatorname{atan2}(z_{\text{dem}, i} - \Delta h_{\text{bulge}}(s_i) - z_{\text{ant}}, s_i) \cdot \frac{180}{\pi}$$
$$\theta_{\text{mask}} = \max_{i=1 \dots 48} \theta_i$$

Angular horizon clearance to the ACN is:
$$\Delta\theta_{\text{clearance}} = \theta_{\text{elToAcn}} - \theta_{\text{mask}}$$

Optical line-of-sight is clear when $\Delta\theta_{\text{clearance}} > 0$. When occluded ($\Delta\theta_{\text{clearance}} \le 0$), the blocking ridge peak is recorded at the sample $i$ with maximal ray intrusion:
$$\text{blockingRidgePeak} = (x_i, y_i, z_{\text{dem}, i}, s_i / 1000)$$

### 2.4 Quad-Sector ACN Identification & Roll-Off Loss
Azimuth from ACN back towards the Probe:
$$\theta_{\text{azFromAcn}} = \left(\operatorname{atan2}(-\Delta x, -\Delta y) \cdot \frac{180}{\pi} + 360\right) \bmod 360$$

Body-frame azimuth relative to ACN aircraft heading $\psi_{\text{acn}}$:
$$\theta_{\text{bodyAz}} = (\theta_{\text{azFromAcn}} - \psi_{\text{acn}} + 360) \bmod 360$$

Serving sector $S_k \in \{0, 1, 2, 3\}$ with boresights $(0^\circ, 90^\circ, 180^\circ, 270^\circ)$:
$$k = \operatorname{round}(\theta_{\text{bodyAz}} / 90^\circ) \bmod 4$$
Off-boresight angle $\Delta\theta_{\text{offBoresight}} = |\theta_{\text{bodyAz}} - k \cdot 90^\circ|$, wrapped to $[0^\circ, 180^\circ]$.

ITU-R F.1336 azimuthal pattern roll-off attenuation ($\theta_{3\text{dB}} = 90^\circ$, $A_{\max} = 25\text{ dB}$):
$$L_{\text{rollOff}} = \min\left(12.0 \cdot \left(\frac{\Delta\theta_{\text{offBoresight}}}{90.0^\circ}\right)^2, \; 25.0\text{ dB}\right)$$

### 2.5 8.0 GHz Link Budget & Adaptive Modulation
Friis Free Space Path Loss at $f_c = 8.0\text{ GHz}$:
$$L_{\text{fspl}} = 20 \log_{10}(D_{3\text{D}}) + 20 \log_{10}(8.0 \times 10^9) - 147.55$$

ITU-R P.676 atmospheric gaseous absorption and weather baseline:
$$L_{\text{gas}} = 0.012 \times \frac{D_{3\text{D}}}{1000} + 1.2\text{ dB}$$

ITU-R P.526 knife-edge diffraction loss $L_{\text{diff}}$ from dominant ray penetration parameter $\nu_{\max}$:
$$\nu_i = (z_{\text{eff}, i} - z_{\text{ray}, i}) \sqrt{\frac{2}{\lambda} \left(\frac{1}{s_i} + \frac{1}{D_{\text{horiz}} - s_i}\right)}$$
$$L_{\text{diff}} = \begin{cases} 0 & \nu_{\max} \le -0.78 \\ 6.9 + 20 \log_{10}\left(\sqrt{(\nu_{\max}-0.1)^2 + 1} + \nu_{\max} - 0.1\right) & \nu_{\max} > -0.78 \end{cases}$$

Net Effective SINR:
$$\text{SINR}_{\text{dB}} = P_{\text{tx}} + G_{\text{tx}} - L_{\text{rollOff}} + G_{\text{rx}} - L_{\text{fspl}} - L_{\text{gas}} - L_{\text{diff}} - P_{\text{noise}}$$
where $P_{\text{tx}} = 43.0\text{ dBm}$, $G_{\text{tx}} = 18.0\text{ dBi}$, $G_{\text{rx}} = 3.0\text{ dBi}$, and $P_{\text{noise}} = -104.0\text{ dBm}$.

The effective SINR is mapped to DVB-S2X MODCOD tables (BPSK 1/2 through 64-APSK 5/6) to evaluate instantaneous net capacity $\text{Bitrate}_{\text{Mbps}} = \eta \cdot B$ where $B = 1.0\text{ MHz}$.

### 2.6 16-Compass-Azimuth 360° Polar Horizon Mask Ring
Around the probe point $(x_P, y_P)$, 16 azimuth directions ($\phi_k = k \cdot 22.5^\circ$ for $k = 0 \dots 15$) are radial-sampled out to $R = 8.0\text{ km}$ in 8 radial increments ($s_j = j \cdot 1.0\text{ km}$):
$$\theta_{\text{mask}}(\phi_k) = \max_{j=1 \dots 8} \left[ \operatorname{atan2}(z_{\text{dem}}(s_j, \phi_k) - \Delta h_{\text{bulge}}(s_j) - z_{\text{ant}}, s_j) \cdot \frac{180}{\pi} \right]$$

A sector is defined as clear-sky if $\theta_{\text{mask}}(\phi_k) < \max(\theta_{\text{elToAcn}}, 8.0^\circ)$.
Sky Openness percentage is:
$$\text{skyOpennessPct} = \frac{\sum_{k=0}^{15} [\theta_{\text{mask}}(\phi_k) < \max(\theta_{\text{elToAcn}}, 8.0^\circ)]}{16} \times 100\%$$

### 2.7 Differential Comparison Against Pinned Reference [P1]
When a reference pin `[P1]` $(x_1, y_1, z_{\text{ground}, 1}, \text{SINR}_1, \text{Bitrate}_1)$ is active:
$$\Delta x_P = x_P - x_1, \quad \Delta y_P = y_P - y_1$$
$$\text{distFromPinKm} = \frac{\sqrt{\Delta x_P^2 + \Delta y_P^2}}{1000}$$
$$\text{bearingFromPinDeg} = \left(\operatorname{atan2}(\Delta x_P, \Delta y_P) \cdot \frac{180}{\pi} + 360\right) \bmod 360$$
$$\Delta\text{Elev}_{\text{M}} = z_{\text{ground}, P} - z_{\text{ground}, 1}$$
$$\Delta\text{SINR}_{\text{dB}} = \text{SINR}_P - \text{SINR}_1$$
$$\Delta\text{Bitrate}_{\text{Mbps}} = \text{Bitrate}_P - \text{Bitrate}_1$$

### 2.8 Polar Grid Peak Finder within 2 km Radius
The peak optimization algorithm samples a polar lattice centered at $(x_0, y_0)$ comprising 16 radial azimuths $\times$ 5 radii ($r \in \{400, 800, 1200, 1600, 2000\}\text{ m}$):
$$(x_{k,m}, y_{k,m}) = (x_0 + r_m \sin\phi_k, \; y_0 + r_m \cos\phi_k)$$
Evaluating link budget and sky openness at each candidate coordinate, the optimizer returns the candidate $(x^*, y^*, z^*)$ maximizing $\text{SINR}_{\text{dB}}$ and sky openness.

---

## 3. Interactive Canvas & UI Architecture

### 3.1 On-Canvas Polar Horizon Mask Ring
When Tool #2 is active, a $34\text{px}$ radius polar ring is drawn at the probe cursor location. The 16 compass sectors are rendered with color-coded wedges:
- Emerald (`#00e676`, alpha 0.45): Clear-sky azimuths.
- Crimson (`#ff2a54`, alpha 0.55): Terrain-masked azimuths.
- Concentric inner reticle indicating mast height and cardinal crosshair.

### 3.2 Split-Color Probe → ACN Vector
A dynamic vector connects the probe point to the ACN position:
- **Clear LoS:** Solid Emerald ray (`#00e676`, 2.5px width) with animated pulse.
- **Occluded:** Solid Emerald segment from Probe to the blocking ridge peak; pulsing Crimson marker **`✕ BLOCKING RIDGE [XXXXm]`**; dashed Crimson ray (`#ff2a54`) extending through terrain shadow to the ACN.

### 3.3 Reference Pin [P1] Differential Vector
Clicking locks the reference pin `[P1]`. A cyan anchor badge is placed at `[P1]`, and moving the cursor renders a dashed cyan comparison chord with a floating HUD callout:
`ΔSINR: ±X.X dB | ΔElev: ±XXX m | Dist: X.XX km @ XXX°`

### 3.4 Tool #2 Controls in `#tb-pane-probe`
- `#tb-probe-mast-input`: Numerical mast height entry ($1 \dots 200\text{ m AGL}$).
- `#tb-probe-unit-select`: Target unit spawner selection (Soldier, MCP, EW Jammer).
- `#tb-probe-horizon-mask`: Horizon mask angle and sky openness percentage.
- `#tb-probe-sector-bore`: Serving sector ID ($S_0 \dots S_3$) and off-boresight angle.
- `#tb-probe-delta-pin`: Real-time differential metrics relative to `[P1]`.
- `#btn-probe-snap-best`: One-click button triggering the 2 km peak finder and snapping the probe to optimal terrain.

---

## 4. Verification Protocol

The verification suite `src/tests/verifyPrecisionCursorProbeTool2.ts` evaluates:
- **PCP-T1 (Cursor-to-ACN Geometry, Horizon Mask Angle & Sector Selection):** Exact calculation of distances, azimuths, elevation angle, horizon mask angle, 16-sector skyline mask, and sky openness percentage.
- **PCP-T2 (Pinned Reference [P1] Differential Comparison & Smart Peak Optimizer):** Differential math accuracy and validation that `findOptimalSignalPeakInRadius` finds a coordinate with greater-or-equal SINR and elevation compared to a valley floor starting point.
- **PCP-T3 (DOM Controls, Layout Invariance & Spec Registration):** Verification of all DOM element IDs, validation that `.rail`, `.topbar`, `.app-shell`, and `frontend/c2-console-theme.css` remain untouched, and verification that the specification is persisted and linked in `README.md`.
