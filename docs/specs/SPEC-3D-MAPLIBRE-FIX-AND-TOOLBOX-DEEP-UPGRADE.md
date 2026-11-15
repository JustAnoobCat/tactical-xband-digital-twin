# SPEC-3D-MAPLIBRE-FIX-AND-TOOLBOX-DEEP-UPGRADE
## 3D Mode Zero-Lag Fix, Scheduler-Synchronized MapLibre Kinetics & Best-in-Class Terrain Toolbox Deep Upgrade

**Document ID:** `DRDO-TAC-XBAND-SPEC-3D-MAPLIBRE-TOOLBOX-UPGRADE-01`  
**Status:** Approved by Role 1 Planner (GEMINI ARGON) & Implemented (Milestone M1.6)  
**Author:** Engineering Planner (Role 1) & Implementer (Role 2)  
**Target Runtimes:** 3D Three.js / WebGL Subsystem (`src/ui/three/sceneManager.ts`, `src/ui/three/terrainBuilder.ts`, `src/ui/three/terrainRenderer.ts`, `src/ui/three/tacticalEntityManager.ts`), MapLibre Kinetic Overlay Engine (`index.html`), Scientific Terrain Toolbox (`#terrain-toolbox` in `index.html`, `src/ui/terrainAnalysisController.ts`, `src/core/obstacles.ts`)

---

### 1. Executive Summary & Problem Formulation

Operating an airborne tactical X-band ($8.0\text{ GHz}$) relay network digital twin in high-relief alpine topography (Ladakh sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$) demands simultaneous visual fluid performance, strict scheduler-link physical coherence, and scientific-grade terrain analysis tools:

1. **3D Mode Frame Lag Elimination:**  
   Prior 3D mode execution suffered frame stalls on standard laptop and Linux desktop GPUs due to:
   - High triangle vertex count on native $512\times 512$ terrain meshes ($262,144$ vertices, $522,242$ triangles).
   - CPU-to-GPU buffer re-uploads caused by calling `.computeLineDistances()` on `LineDashedMaterial` instances within the 50 Hz render loop.
   - High background canvas redraw overhead from `#sim-timeline-canvas` running unthrottled during 3D camera navigation.  
   **Solution:** Introduce `buildFastDemGeometry` ($128\times 128 = 16,384$ vertices, $32,258$ triangles — $16\times$ fewer triangles), map with pre-baked hillshade texture on unlit `THREE.MeshBasicMaterial` (`createFastTerrainMaterial`), eliminate all per-frame `.computeLineDistances()` calls in `tacticalEntityManager.ts` by transitioning to pooled solid `THREE.LineBasicMaterial`, and throttle `#sim-timeline-canvas` to $8\text{ Hz}$ ($125\text{ ms}$) in 3D mode.

2. **Scheduler-Synchronized MapLibre Kinetic Animation:**  
   Prior MapLibre overlay animation simulated packet pulses uniformly across all active nodes regardless of TDMA slot assignments.  
   **Solution:** Drive `renderMapLibreKineticOverlay` strictly from `frame.tac_gantt` (or `frame.static_gantt`), indexing active slot allocations in `scheduledAllocByNodeId`. Only animate uplink packet pulse trains on links where `isScheduled && !isOutage`, color-coding by active 3GPP 5QI traffic class (Crimson `5QI 69`, Cyan `5QI 65`, Emerald `5QI 67`, Amber `5QI 70`, or Violet `is_pre_occlusion_flush`). Display `[TX] ${durationMs}ms · ${modcod}` badges on scheduled nodes and flash `[WASTED TX]` badges with crimson dashed rays on severed static links during terrain blockage.

3. **Best-in-Class Scientific Terrain Toolbox Deep Upgrade (`#terrain-toolbox`):**  
   Deepen the 4 core terrain tools inspired by industry-standard systems:
   - **Tool 1 — DEM Transect (CloudRF & Google Earth Pro):** TX and RX mast height inputs ($1\text{–}2,000\text{ m}$ AGL), $4/3$ effective Earth curvature bulge $\Delta h(s) = \frac{s(D-s)}{2 R_{\text{eff}}}$, 8.0 GHz 1st Fresnel zone ($F_1$) ellipse $r_{F1}(s) = \sqrt{\frac{\lambda s (D-s)}{D}}$ ($\lambda = 0.0375\text{ m}$), dashed $60\% F_1$ envelope, red intrusion shading, Min $F_1$ clearance readout, ITU-R P.526 knife-edge diffraction loss readout, estimated 8.0 GHz SNR/MODCOD readout, and synchronized map hover crosshair with reticle on `#radar-canvas` and tooltip on `#tb-transect-canvas`.
   - **Tool 2 — Probe (Ansys STK Virtual Terminal Link Probe):** Instantaneous link probe between virtual ground terminal $(x, y, z_{\text{DEM}} + 2.0\text{ m})$ and current ACN position (slant range, elevation angle, LoS status, SNR, MODCOD), and `+ Spawn Terminal at Probe Point` button dispatching `ADD_GROUND_NODE` to the simulation worker.
   - **Tool 3 — Region (QGIS Zonal RF Coverage & Summit Finder):** Precise local summit coordinate $(x_{\max}, y_{\max}, z_{\max})$ marked with a gold summit marker `▲ MAX [XXXX m]` on `#radar-canvas`, terrain ruggedness index / mean slope, and estimated ACN LoS coverage % sampled across a $6\times 6$ sub-grid.
   - **Tool 4 — 3D Obstacles (Excalidraw Authoring Ergonomics):** Shape selector (`Ridge Wall`, `Bunker / Block`, `Peak / Dome`), ITU-R material profile selector (`Alpine Granite`, `Reinforced Concrete`, `Dense Conifer Foliage`), Excalidraw-style Undo/Redo history stack, and interactive obstacle inventory list with individual `[×]` deletion buttons.

---

### 2. Physical & Mathematical Formulations

#### 2.1 Decimated Fast 128x128 DEM Geometry
For a DEM bounding box $[x_{\min}, x_{\max}] \times [y_{\min}, y_{\max}]$, the $128 \times 128$ decimated grid samples $N = 128$ points per dimension:
$$\Delta x = \frac{x_{\max} - x_{\min}}{127}, \quad \Delta y = \frac{y_{\max} - y_{\min}}{127}$$
$$r_{\text{src}} = \frac{r \cdot 511}{127}, \quad c_{\text{src}} = \frac{c \cdot 511}{127}$$
Vertex elevations are evaluated via continuous bilinear interpolation on the source DEM raster. Vertices: $16,384$, Triangles: $(127 \times 127) \times 2 = 32,258$, indexed with `Uint16Array` (fitting comfortably within the 65,536 limit).

#### 2.2 Fresnel Zone Ellipse & 4/3 Earth Bulge
At distance $s$ along a link of total horizontal length $D$, with effective Earth radius $R_{\text{eff}} = \frac{4}{3} R_E \approx 8.495 \times 10^6\text{ m}$:
$$\Delta h(s) = \frac{s (D - s)}{2 R_{\text{eff}}}$$
For carrier frequency $f = 8.0\text{ GHz}$ ($\lambda = \frac{c}{f} = 0.0375\text{ m}$), the first Fresnel zone radius $r_{F1}(s)$ is:
$$r_{F1}(s) = \sqrt{\frac{\lambda s (D - s)}{D}}$$
The $60\% F_1$ clearance boundary is:
$$r_{0.6}(s) = 0.6 \cdot r_{F1}(s)$$
Line-of-Sight height at distance $s$ between transmitter mast $z_1 = z_{\text{DEM}}(0) + h_{\text{TX}}$ and receiver mast $z_2 = z_{\text{DEM}}(D) + h_{\text{RX}}$:
$$z_{\text{LoS}}(s) = z_1 + \frac{s}{D}(z_2 - z_1)$$
Clearance above bulged terrain:
$$c(s) = z_{\text{LoS}}(s) - [z_{\text{terrain}}(s) + \Delta h(s)]$$
Obstruction/intrusion occurs when $c(s) < r_{0.6}(s)$, shaded in translucent crimson.

#### 2.3 ITU-R P.526 Knife-Edge Diffraction Loss
At the dominant crest with obstruction height $h = -c(s)$ and sub-distances $d_1 = s, d_2 = D - s$:
$$\nu = h \sqrt{\frac{2}{\lambda} \left(\frac{1}{d_1} + \frac{1}{d_2}\right)}$$
$$J(\nu) = \begin{cases} 0\text{ dB}, & \nu \le -0.78 \\ 6.9 + 20 \log_{10}\left(\sqrt{(\nu - 0.1)^2 + 1} + \nu - 0.1\right)\text{ dB}, & \nu > -0.78 \end{cases}$$

#### 2.4 Estimated 8.0 GHz Link Budget & MODCOD Lookup
Slant range $d_{\text{slant}} = \sqrt{D^2 + (z_2 - z_1)^2}$.
$$\text{FSPL}(\text{dB}) = 20 \log_{10}(d_{\text{slant}}) + 20 \log_{10}(f_{\text{Hz}}) - 147.55$$
$$\text{SNR}(\text{dB}) = P_{\text{TX}}(\text{dBm}) + G_{\text{TX}} + G_{\text{RX}} - \text{FSPL} - J(\nu) - L_{\text{atm}} - P_{\text{noise}}(\text{dBm})$$

---

### 3. Verification & Compliance Matrix

| ID | Test Suite | Scope & Verification Invariants |
|:---|:---|:---|
| **TBU-T1** | 3D `fast128` Decimation & Zero `computeLineDistances` | Verifies `terrainBuilder.ts` defines `buildFastDemGeometry` ($N = 128, 16,384$ vertices, $32,258$ triangles), `sceneManager.ts` defaults to `fast128`, unlit `createFastTerrainMaterial` uses `MeshBasicMaterial`, and `tacticalEntityManager.ts` has 0 `.computeLineDistances()` calls. |
| **TBU-T2** | Scheduler-Synchronized MapLibre Kinetic Overlay | Verifies `renderMapLibreKineticOverlay` indexes `scheduledAllocByNodeId` from `tac_gantt` / `static_gantt`, gates packet pulse trains on `isScheduled && !isOutage`, renders 5QI color pulses, and flashes `[WASTED TX]` on severed static links. |
| **TBU-T3** | CloudRF Transect Fresnel & STK Probe Readouts | Verifies `#tb-transect-tx-mast`, `#tb-transect-rx-mast`, `#tb-transect-fresnel`, `#tb-transect-snr`, `#tb-probe-acn-sinr`, and `#tb-probe-spawn-node` exist, compute valid physical $F_1$ clearance, and dispatch ground terminal spawning. |
| **TBU-T4** | QGIS Region Summit & Excalidraw Obstacle Ergonomics | Verifies `#tb-region-summit`, `#tb-region-los-pct`, `#tb-obs-shape-select`, `#tb-obs-material-select`, `#tb-obs-undo`, `#tb-obs-redo`, and `#tb-obs-list` function cleanly with undo/redo stack. |
