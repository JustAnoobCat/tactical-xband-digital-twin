# SPEC-PRECISION-CAD-OBSTACLE-LINK-SLICER-TOOL4: Excalidraw / CAD-Grade Interactive Barrier Extruder & Real-Time 3D Link-Slice Previewer Upgrade

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity)  
**Target Runtimes:** `src/core/cadObstacleSlicerEngine.ts`, `index.html` (`#radar-canvas`, `#tb-pane-obstacle`), `src/tests/verifyPrecisionCadObstacleTool4.ts`, `package.json`, `scripts/run_all_verifications.mjs`, `README.md`  

---

## 1. Executive Summary & Operational Context

In high-relief mountainous topography such as the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$), tactical wireless networks are vulnerable to both natural terrain obstructions and synthetic or tactical obstacles (such as fortified defensive berms, concrete blast barriers, mountain ridge walls, or conifer canopy buffers). Electronic warfare planners and tactical communications officers need the ability to model, place, adjust, and simulate obstacle barriers with precision CAD ergonomics. Crucially, operators must understand the exact physical impact of an obstacle on active 3D air-to-ground communication links between Ground Terminals and an orbiting Airborne Communication Node (ACN).

This upgrade transforms **Tool #4 (`3D Obstacles` / `#tb-pane-obstacle`)** into an **Excalidraw / CAD-Grade Interactive Barrier Extruder & Real-Time 3D Link-Slice Previewer**:
1. **Pure CAD Barrier Geometry & 3D Link-Slice Intersection Engine (`src/core/cadObstacleSlicerEngine.ts`):**
   - Exact parametric 2D segment intersection $(t_{\text{wall}}, u_{\text{link}}) \in [0, 1]^2$ between barrier segments $\overline{V_1 V_2}$ and active Ground Node $\leftrightarrow$ ACN link rays.
   - Live CAD dimension calculations: wall horizontal length $L\text{ [m]}$, strike azimuth $\theta_{\text{wall}}^\circ$, wall normal azimuth $\theta_{\text{normal}}^\circ$, midpoint ground elevation $z_{\text{ground}}\text{ [m MSL]}$, and crest top elevation $z_{\text{wallTop}}\text{ [m MSL]}$.
   - $15^\circ$ angle increment snapping when `Shift` key is held.
   - Exact 3D Line-of-Sight ray altitude $z_{\text{ray}}(P_{\text{int}})$ at intersection point $P_{\text{int}}$.
   - $K = 4/3$ curved-Earth curvature bulge $\Delta h_{\text{bulge}}$ and terrain elevation $z_{\text{ground}}(P_{\text{int}})$.
   - Required Blocking Height ($H_{\text{req}}$) to physically intercept the 3D ray.
   - 8.0 GHz First Fresnel Zone radius $r_{F1}$, obstacle intrusion $h_{\text{intrusion}}$, Fresnel parameter $\nu$, and ITU-R P.526 knife-edge diffraction loss with material absorption caps (Granite $45\text{ dB}$, Concrete $35\text{ dB}$, Foliage $0.25\text{ dB/m}$).
   - Link slice classification: `'SLICED_BLOCKED'` ($h_{\text{intrusion}} \ge 0$), `'FRESNEL_GRAZING'` ($-0.6 r_{F1} \le h_{\text{intrusion}} < 0$), or `'RAY_FLIES_OVER'` ($h_{\text{intrusion}} < -0.6 r_{F1}$).
   - Perpendicular link-slicer barrier generator constructing a normal barrier at any fraction along a selected node's link with auto-calculated height guaranteed to sever that link.
2. **Interactive Canvas Micro-Interactions (`#radar-canvas`):**
   - Real-time CAD rubber-banding and drawing of barriers with live length and strike azimuth dimension tags.
   - Live Link-Intersection Reticles (`⊗`) drawn at each point where a barrier intersects a ground node's link ray.
   - Contextual status callout badges:
     - Crimson badge if blocked: `✂ S${nodeId} BLOCKED (-${lossDb}dB · Ray ${zRay}m <= Wall ${zTop}m)`
     - Amber badge if overflown: `⚠ S${nodeId} FLIES OVER (+${clr}m · Need H >= ${hReq}m)`
   - Excalidraw draggable handles: Endpoint 1 `[V1]`, Endpoint 2 `[V2]`, and Midpoint translation handle `[✥]` on selected obstacles allowing real-time repositioning and stretching directly on the map.
3. **Upgraded Tool #4 DOM Controls (`#tb-pane-obstacle`):**
   - Preserves all existing `#tb-obs-*` DOM IDs (`#tb-obs-shape-select`, `#tb-obs-material-select`, `#tb-obs-place-btn`, `#tb-obs-undo`, `#tb-obs-redo`, `#tb-obs-clear-btn`, `#tb-obs-list`).
   - Adds `#tb-obs-cad-metrics` readout for wall dimensions, strike bearing, and crest MSL.
   - Adds `#tb-obs-slice-summary` readout for count of sliced vs overflying links and minimum required barrier height.
   - Adds `#btn-obs-auto-height` to automatically size the barrier height to block all intersected links.
   - Adds `#tb-obs-target-node-select` to pick any active Ground Node.
   - Adds `#btn-obs-slice-node-link` to instantly drop a perpendicular ridge barrier across the selected node's link.
4. **Strict Layout Lock:**
   - Zero modifications to global page layout (`.rail`, `.topbar`, `.app-shell`, `#radar-container`) or `frontend/c2-console-theme.css`.

---

## 2. Mathematical Formulation & Physical Identities

### 2.1 2D Parametric Line Segment Intersection
Let the barrier segment $\overline{AB}$ extend from $A(x_A, y_A)$ to $B(x_B, y_B)$, and the link ray $\overline{CD}$ extend from Ground Node $C(x_C, y_C)$ to ACN $D(x_D, y_D)$.
Any point on $\overline{AB}$ is parameterized by $t \in [0, 1]$:
$$P(t) = A + t (B - A)$$
Any point on $\overline{CD}$ is parameterized by $u \in [0, 1]$:
$$Q(u) = C + u (D - C)$$

The intersection condition $P(t) = Q(u)$ yields the linear system:
$$\begin{pmatrix} x_B - x_A & -(x_D - x_C) \\ y_B - y_A & -(y_D - y_C) \end{pmatrix} \begin{pmatrix} t \\ u \end{pmatrix} = \begin{pmatrix} x_C - x_A \\ y_C - y_A \end{pmatrix}$$

The determinant is:
$$\Delta = (x_B - x_A)(y_D - y_C) - (y_B - y_A)(x_D - x_C)$$

When $|\Delta| > 10^{-9}$:
$$t = \frac{(x_C - x_A)(y_D - y_C) - (y_C - y_A)(x_D - x_C)}{\Delta}$$
$$u = \frac{(x_C - x_A)(y_B - y_A) - (y_C - y_A)(x_B - x_A)}{\Delta}$$

A valid physical intersection occurs if and only if $0 \le t \le 1$ and $0 \le u \le 1$. The intersection coordinate is:
$$P_{\text{int}} = (x_A + t (x_B - x_A), \; y_A + t (y_B - y_A))$$

### 2.2 CAD Barrier Geometry & $15^\circ$ Snapping
Barrier length:
$$L = \sqrt{(x_B - x_A)^2 + (y_B - y_A)^2}$$
Strike azimuth $\theta_{\text{wall}}$ (degrees clockwise from North $+y$):
$$\theta_{\text{wall}} = \left(\operatorname{atan2}(x_B - x_A, y_B - y_A) \cdot \frac{180}{\pi} + 360\right) \bmod 360$$
Normal azimuth $\theta_{\text{normal}}$:
$$\theta_{\text{normal}} = (\theta_{\text{wall}} + 90^\circ) \bmod 360$$

When the `Shift` key is pressed during drawing or editing, the angle $\theta = \operatorname{atan2}(y_B - y_A, x_B - x_A)$ is snapped to $15^\circ$ increments ($\Delta\theta = 15 \cdot \frac{\pi}{180}$):
$$\theta_{\text{snapped}} = \operatorname{round}\left(\frac{\theta}{\Delta\theta}\right) \cdot \Delta\theta$$
$$B_{\text{snapped}} = (x_A + L \cos\theta_{\text{snapped}}, \; y_A + L \sin\theta_{\text{snapped}})$$

### 2.3 3D Ray Altitude, Earth Curvature Bulge & Clearance
At intersection point $P_{\text{int}}$ along the link at fraction $u$:
Horizontal distance from ground node $C$ to $P_{\text{int}}$:
$$d_1 = \sqrt{(P_{\text{int}}.x - x_C)^2 + (P_{\text{int}}.y - y_C)^2}$$
Horizontal distance from $P_{\text{int}}$ to ACN $D$:
$$d_2 = \sqrt{(x_D - P_{\text{int}}.x)^2 + (y_D - P_{\text{int}}.y)^2}$$

Effective Earth curvature bulge ($K = 4/3$ effective Earth radius $R_{\text{eff}} = \frac{4}{3} R_E \approx 8,494,667\text{ m}$):
$$\Delta h_{\text{bulge}} = \frac{d_1 d_2}{2 R_{\text{eff}}}$$

3D Line-of-Sight ray altitude (MSL):
$$z_{\text{ray}} = z_C + u (z_D - z_C)$$
where $z_C$ is the ground node antenna altitude ($z_{\text{ground}, C} + h_{\text{agl}, C}$) and $z_D$ is the ACN altitude.

Barrier crest top altitude at $P_{\text{int}}$:
$$z_{\text{wallTop}} = z_{\text{ground}}(P_{\text{int}}) + \Delta h_{\text{bulge}} + H_{\text{wall}}$$

Required Blocking Height ($H_{\text{req}}$) to reach the 3D ray:
$$H_{\text{req}} = \max\big(10.0, \; \lceil z_{\text{ray}} - (z_{\text{ground}}(P_{\text{int}}) + \Delta h_{\text{bulge}}) \rceil\big) \text{ [m AGL]}$$

Vertical intrusion into the Line-of-Sight:
$$h_{\text{intrusion}} = z_{\text{wallTop}} - z_{\text{ray}}$$

### 2.4 First Fresnel Zone & ITU-R P.526 Diffraction Loss
Wavelength at $8.0\text{ GHz}$:
$$\lambda = \frac{c}{f} = \frac{299,792,458}{8.0 \times 10^9} \approx 0.037474\text{ m}$$
First Fresnel Zone radius at $P_{\text{int}}$:
$$r_{F1} = \sqrt{\frac{\lambda d_1 d_2}{d_1 + d_2}}$$
Fresnel-Kirchhoff diffraction parameter $\nu$:
$$\nu = h_{\text{intrusion}} \frac{\sqrt{2}}{r_{F1}} = h_{\text{intrusion}} \sqrt{\frac{2}{\lambda}\left(\frac{1}{d_1} + \frac{1}{d_2}\right)}$$

Diffraction attenuation $\Delta L_{\text{obs,dB}}$ per ITU-R P.526:
$$L_{\text{diff}}(\nu) = \begin{cases} 0 & \nu \le -0.78 \\ 6.9 + 20 \log_{10}\left(\sqrt{(\nu - 0.1)^2 + 1} + \nu - 0.1\right) & \nu > -0.78 \end{cases}$$

Material-specific capping:
- **Alpine Granite (`granite`):** Sharp knife-edge diffraction, opaque up to $45.0\text{ dB}$.
- **Reinforced Concrete (`concrete`):** Solid attenuation, capped at $35.0\text{ dB}$.
- **Dense Foliage (`foliage`):** ITU-R P.833 attenuation, capped at $25.0\text{ dB}$.

Slice Verdict Classification:
- `'SLICED_BLOCKED'`: $h_{\text{intrusion}} \ge 0$ (Physical ray intersection / occultation).
- `'FRESNEL_GRAZING'`: $-0.6 r_{F1} \le h_{\text{intrusion}} < 0$ (Ray passes above crest but within $60\%$ of first Fresnel zone, causing Fresnel diffraction loss).
- `'RAY_FLIES_OVER'`: $h_{\text{intrusion}} < -0.6 r_{F1}$ (Ray has clear clearance above obstacle).

### 2.5 Perpendicular Link-Slicer Obstacle Generation
Given a Ground Node at $(x_N, y_N, z_N)$ and ACN at $(x_A, y_A, z_A)$:
Link horizontal vector: $\vec{u} = (x_A - x_N, \; y_A - y_N)$, length $L_{\text{link}} = \|\vec{u}\|$, normalized $\hat{u} = \vec{u} / L_{\text{link}}$.
Perpendicular normal unit vector:
$$\vec{n}_{\perp} = (-\hat{u}_y, \; \hat{u}_x) \implies \vec{n}_{\perp} \cdot \hat{u} = 0$$

At placement fraction along link $\alpha = 0.35$:
$$P_c = (x_N + \alpha (x_A - x_N), \; y_N + \alpha (y_A - y_N))$$
Barrier endpoints centered at $P_c$ with width $W = 1400\text{ m}$:
$$V_1 = P_c - \frac{W}{2} \vec{n}_{\perp}, \quad V_2 = P_c + \frac{W}{2} \vec{n}_{\perp}$$

3D ray altitude at $P_c$:
$$z_{\text{ray}}(P_c) = z_N + \alpha (z_A - z_N)$$
Bulged terrain ground elevation:
$$z_{\text{effGround}} = z_{\text{ground}}(P_c) + \frac{(\alpha L_{\text{link}})((1 - \alpha) L_{\text{link}})}{2 R_{\text{eff}}}$$
Optimal height to ensure definitive blockage:
$$H_{\text{opt}} = \max(80.0, \; \lceil z_{\text{ray}}(P_c) - z_{\text{effGround}} + 60.0 \rceil)$$

---

## 3. Verification Protocol

The implementation is verified via `src/tests/verifyPrecisionCadObstacleTool4.ts` with 3 verification gates:
- **PCO-T1 (2D Segment Intersection & 3D Ray Altitude / Required Height Math):** Verifies exact parametric intersection $(500, 0)$ between $(0, 0)\to(1000, 0)$ and $(500, -500)\to(500, 500)$, exact 3D ray altitude $z_{\text{ray}} = z_{\text{node}} + u(z_{\text{acn}} - z_{\text{node}})$, earth curvature bulge, and flags `'RAY_FLIES_OVER'` vs. `'SLICED_BLOCKED'` with $\Delta L_{\text{obs}} > 15\text{ dB}$ when wall height exceeds $H_{\text{req}} + 40\text{ m}$.
- **PCO-T2 (Perpendicular Node-Link Slicer Generator):** Verifies perpendicularity $\vec{v}_{\text{wall}} \cdot \vec{v}_{\text{link}} \approx 0$, centered positioning at $35\%$ link distance, and confirms that `optimalHeightM` physically slices the node's link (`sliceVerdict === 'SLICED_BLOCKED'`).
- **PCO-T3 (DOM Controls & Global Layout Invariance Check):** Ensures `#tb-obs-cad-metrics`, `#tb-obs-slice-summary`, `#btn-obs-auto-height`, `#tb-obs-target-node-select`, and `#btn-obs-slice-node-link` exist inside `#tb-pane-obstacle`, verifies all existing `#tb-obs-*` elements remain intact, ensures global layout and theme CSS are 100% untouched, and verifies spec persistence and `README.md` link.
