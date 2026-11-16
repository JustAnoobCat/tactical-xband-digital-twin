# SPEC-PRECISION-GEODETIC-LOS-RULER-TOOL1: CAD/GIS-Grade Precision Geodetic & RF Line-of-Sight Ruler Upgrade

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity)  
**Target Runtimes:** `src/core/geodeticRulerEngine.ts`, `index.html` (`#radar-canvas`, `#tb-pane-transect`), `src/tests/verifyPrecisionGeodeticRuler.ts`, `package.json`, `scripts/run_all_verifications.mjs`, `README.md`  

---

## 1. Executive Summary & Operational Context

In the Tactical X-Band Air-to-Ground Network Digital Twin, operations in the mountainous terrain of the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$) require millimeter-level coordinate precision, exact 3D slant distances, vertical antenna elevation/depression angles, forward and back compass azimuths, and instant RF line-of-sight (LoS) occlusion detection.

This upgrade transforms **Tool #1 (`DEM Transect` / `#tb-pane-transect`)** from a basic profile grapher into a **CAD/GIS-Grade Precision Geodetic & RF Line-of-Sight Ruler**:
1. **Pure Geodetic & RF Ruler Geometry Engine (`src/core/geodeticRulerEngine.ts`):**
   - Exact horizontal displacement $D_{\text{horiz}} = \sqrt{\Delta x^2 + \Delta y^2}$ and 3D slant range $D_{3\text{D}} = \sqrt{D_{\text{horiz}}^2 + \Delta Z_{\text{ant}}^2}$.
   - Forward compass azimuth $\theta_{\text{az}} \in [0^\circ, 360^\circ)$ ($0^\circ = \text{North } +y, 90^\circ = \text{East } +x$), back-azimuth $\theta_{\text{back}} = (\theta_{\text{az}} + 180^\circ) \bmod 360^\circ$, and 16-wind compass rose labeling.
   - Vertical elevation/depression angle $\theta_{\text{vert}} = \arctan(\Delta Z_{\text{ant}} / D_{\text{horiz}})$ and slope grade percentage.
   - Constrained $15^\circ$ angle snapping (`Shift` key modifier).
   - High-fidelity 80-sample split-ray marching detecting the first grazing occlusion distance and maximum intrusion ridge crest (`blockingPeak`).
2. **Three-Phase CAD Canvas Micro-Interactions (`#radar-canvas`):**
   - **Phase 1 (Aiming Point A):** Live cursor HUD tag (`AIM POINT A · Lat/Lon · Elev: XXXX m MSL`) with $15\text{px}$ magnetic snapping to Ground Nodes (`[SNAP: Node S{id}]`), Relay Beacon (`[SNAP: Relay MCP-OPT]`), EW Jammer (`[SNAP: EW-JAM]`), and ACN (`[SNAP: ACN]`).
   - **Phase 2 (Rubber-Banding A → Cursor):** Protractor angle arc at Point A with True North $0^\circ\text{ N}$ dashed datum line, swept cyan angle arc, graduated kilometer ruler tick marks, real-time split-color ray (solid Emerald `#00e676` up to obstruction, pulsing crimson `✕ BLOCKING PEAK [XXXXm]` reticle, dashed Crimson `#ff2a54` in shadow), and on-line dark-glass callout pill showing horizontal/3D distance, forward/back azimuth, vertical angle/grade, and estimated 8 GHz link status/SNR/MODCOD.
   - **Phase 3 (Locked Line A ↔ B):** Draggable `[A]` and `[B]` endpoint handles, interactive hover bead snapping to the line with cross-section callout ($s$, ground elevation, ray altitude, Fresnel clearance), plus instantaneous action buttons `[ ⇄ Swap A ↔ B ]` and `[ ▲ Spawn Relay on Blocking Peak ]`.
3. **Strict UI Layout Lock:**
   - All global styles (`.rail`, `.topbar`, `.app-shell`, `frontend/c2-console-theme.css`) remain 100% untouched.

---

## 2. Mathematical Formulation & Geodetic Identities

### 2.1 Horizontal & 3D Slant Distance
Given transmitter antenna Point A $(x_A, y_A, z_{\text{ant}, A})$ and receiver antenna Point B $(x_B, y_B, z_{\text{ant}, B})$ in Local Tangent Plane (ENU) Cartesian coordinates:
$$\Delta x = x_B - x_A, \quad \Delta y = y_B - y_A$$
$$D_{\text{horiz}} = \sqrt{\Delta x^2 + \Delta y^2}$$

With terrain ground elevations $z_{\text{ground}, A}, z_{\text{ground}, B}$ and mast heights $h_{\text{mast}, A}, h_{\text{mast}, B}$:
$$z_{\text{ant}, A} = z_{\text{ground}, A} + h_{\text{mast}, A}, \quad z_{\text{ant}, B} = z_{\text{ground}, B} + h_{\text{mast}, B}$$
$$\Delta Z_{\text{ant}} = z_{\text{ant}, B} - z_{\text{ant}, A}, \quad \Delta Z_{\text{ground}} = z_{\text{ground}, B} - z_{\text{ground}, A}$$
$$D_{3\text{D}} = \sqrt{D_{\text{horiz}}^2 + \Delta Z_{\text{ant}}^2}$$

### 2.2 Forward & Back Compass Azimuth
With ENU conventions ($+y = \text{North } 0^\circ, +x = \text{East } 90^\circ$):
$$\theta_{\text{az}} = \left(\operatorname{atan2}(\Delta x, \Delta y) \cdot \frac{180}{\pi} + 360\right) \bmod 360$$
$$\theta_{\text{back}} = (\theta_{\text{az}} + 180) \bmod 360$$

The 16-wind compass rose index is computed via:
$$i_{\text{wind}} = \left\lfloor \frac{(\theta_{\text{az}} + 11.25^\circ) \bmod 360^\circ}{22.5^\circ} \right\rfloor$$
mapping to `['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']`.

### 2.3 Vertical Elevation/Depression Angle & Slope Grade
The angle of inclination from antenna A to antenna B is:
$$\theta_{\text{vert,deg}} = \operatorname{atan2}(\Delta Z_{\text{ant}}, \max(D_{\text{horiz}}, 0.01)) \cdot \frac{180}{\pi}$$
$$\text{gradePct} = \frac{\Delta Z_{\text{ant}}}{\max(D_{\text{horiz}}, 0.01)} \times 100.0$$

### 2.4 Shift-Key 15° Angle Snapping
When holding the `Shift` key during rubber-banding, the cursor angle $\theta_{\text{az}}$ is constrained to increments of $15^\circ$:
$$\theta_{\text{snap}} = \operatorname{round}\left(\frac{\theta_{\text{az}}}{15^\circ}\right) \times 15^\circ \pmod{360^\circ}$$
$$x_{\text{snapped}} = x_A + r \cdot \sin\left(\theta_{\text{snap}} \cdot \frac{\pi}{180}\right)$$
$$y_{\text{snapped}} = y_A + r \cdot \cos\left(\theta_{\text{snap}} \cdot \frac{\pi}{180}\right)$$
where $r = \sqrt{(x_{\text{cur}} - x_A)^2 + (y_{\text{cur}} - y_A)^2}$.

### 2.5 Ray-Marching & Blocking Crest Detection
Along the line $A \to B$ ($N = 80$ samples), for sample $i \in [0, N-1]$ at fractional distance $u_i = \frac{i}{N-1}$ and distance $s_i = u_i D_{\text{horiz}}$:
$$x_i = x_A + u_i \Delta x, \quad y_i = y_A + u_i \Delta y$$
$$\Delta h_{\text{bulge}, i} = \frac{s_i (D_{\text{horiz}} - s_i)}{2 K R_E}$$
$$z_{\text{ray}, i} = z_{\text{ant}, A} + u_i \Delta Z_{\text{ant}}$$
$$c_i = z_{\text{ray}, i} - (z_{\text{dem}, i} + \Delta h_{\text{bulge}, i})$$

First grazing occlusion occurs at:
$$s_{\text{grazing}} = \min \{ s_i \mid c_i < 0 \}$$
The dominant blocking ridge crest is the sample with maximum intrusion $-c_i > 0$ (or highest Fresnel-Kirchhoff parameter $\nu_i$):
$$\nu_i = -c_i \sqrt{\frac{2}{\lambda} \left(\frac{1}{\max(s_i, 1)} + \frac{1}{\max(D_{\text{horiz}} - s_i, 1)}\right)}$$

---

## 3. UI Micro-Interactions & State Architecture

### 3.1 Three-Phase State Machine
1. `AIM_POINT_A`:
   - Cursor tracking over `#radar-canvas`.
   - $15\text{px}$ proximity check against Ground Nodes, MCP-OPT relay, EW jammer, and ACN.
   - Live reticle tag: `AIM POINT A · Lat/Lon · Elev: XXXX m MSL`.
2. `RUBBERBAND_TO_B`:
   - Origin pinned at Point A.
   - Dynamic protractor arc at Point A with True North $0^\circ\text{ N}$ dashed line and cyan angle sweep.
   - Perpendicular kilometer tick marks along ray.
   - Split-color rendering: Emerald `#00e676` for clear segment, Crimson `#ff2a54` dashed for shadowed segment.
   - Blocking ridge pin `✕ BLOCKING PEAK [XXXXm]` rendered at peak coordinates.
   - High-contrast on-line glass callout displaying distance, azimuth, elevation angle, grade, and SNR/MODCOD.
3. `LOCKED_INSPECT`:
   - Interactive draggable `[A]` and `[B]` endpoint handles.
   - Hover inspection cross-section bead snapping onto the segment within $18\text{px}$.
   - `#btn-transect-swap-ab`: Swaps endpoints $A \leftrightarrow B$.
   - `#btn-transect-spawn-peak-relay`: Dispatches ground node creation directly at the blocking ridge crest.

---

## 4. Verification & Testing Requirements

- **PGR-T1 (Horizontal & Vertical Angle / Azimuth / Back-Azimuth Math):** Verify mathematical identities for due East, swap symmetry, and grade percentages.
- **PGR-T2 (Angle Snap & Blocking Crest Detection):** Verify $15^\circ$ angle snapping and correct identification of blocking crests and LoS clearance.
- **PGR-T3 (DOM Controls & Layout Invariance):** Verify all DOM elements inside `#tb-pane-transect` exist and confirm global styles remain untouched.
