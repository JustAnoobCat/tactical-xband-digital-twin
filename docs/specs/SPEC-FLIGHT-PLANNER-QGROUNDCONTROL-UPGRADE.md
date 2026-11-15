# SPEC-FLIGHT-PLANNER-QGROUNDCONTROL-UPGRADE: QGroundControl / ForeFlight Mission & Trajectory Planner Upgrade

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity)  
**Scope:** `src/core/trajectory.ts`, `index.html`, `src/tests/verifyFlightPlannerUpgrade.ts`, `README.md`  

---

## 1. Executive Summary & Operational Context

The Tactical X-Band Air-to-Ground Network Digital Twin operates in the high-relief alpine terrain of the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$). The Airborne Communications Node (ACN) provides vital relay connectivity to 16 tactical ground stations distributed across deep glaciated valleys and rugged mountain ridges. 

This specification defines the upgrade of the **Flight Trajectory & Mission Planner** (`#tab-authoring` & `src/core/trajectory.ts`), taking inspiration from premier aerospace mission planning suites: **QGroundControl**, **ArduPilot Mission Planner**, and **ForeFlight**. 

Key capabilities introduced:
1. **Aerospace Flight Pattern Generators (`generateFlightPatternWaypoints`)**: Rapid parameterization of four canonical tactical flight patterns:
   - `ellipse_orbit`: 8-waypoint closed elliptical orbit at configurable cruise altitude $z_{\text{MSL}}$ and major/minor radii.
   - `racetrack_hold`: 8-waypoint holding pattern with parallel straight legs and $180^\circ$ coordinated turn endcaps.
   - `figure8_valley`: 8-waypoint Lemniscate of Gerono cross-valley patrol ($x(\theta) = A \sin\theta, y(\theta) = B \sin\theta \cos\theta$) crossing the central ridge and alternating lobes over North/South valleys.
   - `canyon_transit`: 6-waypoint terrain-skimming alpine corridor route with stepped waypoint altitudes ($4,800\text{ m} \to 5,350\text{ m} \to 4,900\text{ m}$ MSL).
2. **First-Principles Aerodynamic Envelope & CFIT Evaluation (`evaluateFlightPlanProfile`)**:
   - Equidistant sampling ($N = 64$) along the closed 3D spline/orbit path.
   - True Above-Ground-Level (AGL) clearance profiling against the underlying Digital Elevation Model (DEM) with Controlled Flight Into Terrain (CFIT) warnings whenever $\text{AGL} < 300\text{ m}$.
   - Instantaneous path curvature $\kappa$ and coordinated-turn bank angle:
     $$\phi_k = \frac{180}{\pi} \arctan\left(\frac{V^2 \kappa_k}{g}\right)$$
   - Minimum turn radius envelope $R_{\min} = \frac{V^2}{g \tan\phi_{\max}} = \frac{1}{\kappa_{\max}}$.
   - Multi-phase route Line-of-Sight (LoS) ground coverage prediction across tactical ground nodes.
3. **ForeFlight Vertical Terrain Clearance Profile Canvas (`#fp-vertical-profile-canvas`)**:
   - Interactive high-DPI canvas displaying route distance $s \in [0, L_{\text{total}}]\text{ [km]}$ versus altitude MSL.
   - Ground DEM terrain polygon, $+300\text{ m AGL}$ Minimum Safe Altitude (MSA) clearance boundary, cyan UAV trajectory profile, and waypoint diamond markers `WP1..WPN`.
   - Visual highlighting of hazardous proximity segments in crimson (`#ff2a54`) with warning badges.
4. **Mission Workstation UI & Aerodynamic Telemetry Strip**:
   - Clean, high-density C2 mission bar in `#tab-authoring` with pattern selection, cruise altitude, and cruise airspeed inputs.
   - Envelope telemetry badges: Circuit Distance, Orbit Period, Min AGL Clearance, Peak Bank Angle, Min Turn Radius, and Predicted LoS Coverage.

---

## 2. Mathematical & Aerodynamic Formulation

### 2.1 Coordinated-Turn Aerodynamic Bank Angle
In steady, coordinated, level turns, the aerodynamic lift vector $L$ tilts by bank angle $\phi$. Balancing gravitational weight $m g$ with vertical lift component $L \cos\phi$, and centripetal acceleration with horizontal lift component $L \sin\phi$:
$$L \cos\phi = m g$$
$$L \sin\phi = m \frac{V^2}{R} = m V^2 \kappa$$
Dividing the two equations yields the classical coordinated-turn relation:
$$\tan\phi = \frac{V^2 \kappa}{g} \implies \phi = \arctan\left(\frac{V^2 \kappa}{g}\right)$$
where:
- $V$: True Airspeed ($\text{m/s}$)
- $\kappa$: Horizontal path curvature ($\text{m}^{-1}$), defined for planar curve $(x(s), y(s))$ by:
  $$\kappa = \frac{|\dot{x}\ddot{y} - \dot{y}\ddot{x}|}{(\dot{x}^2 + \dot{y}^2)^{3/2}}$$
- $g = 9.80665\text{ m/s}^2$: Standard gravitational acceleration.

The minimum turn radius along the route is governed by peak curvature $\kappa_{\max}$:
$$R_{\min} = \frac{1}{\kappa_{\max}} = \frac{V^2}{g \tan\phi_{\max}}$$

### 2.2 Controlled Flight Into Terrain (CFIT) & Minimum Safe Altitude (MSA)
For each sampled position along the route $(x_k, y_k, z_{\text{acn}, k})$:
$$\text{AGL}_k = z_{\text{acn}, k} - z_{\text{dem}}(x_k, y_k)$$
A proximity violation (`cfitWarning = true`) is triggered when:
$$\text{AGL}_k < \text{MSA}_{\text{floor}} = 300.0\text{ m}$$

### 2.3 Route Line-of-Sight (LoS) Coverage Prediction
The flight route is sampled at 12 equidistant orbital phases $m \in \{0, ..., 11\}$. At each phase $m$, the Line-of-Sight obstruction between the ACN position and all registered tactical ground stations is evaluated against the DEM:
$$\text{LoS}_{\text{cov}}(m) = \frac{1}{N_{\text{nodes}}} \sum_{j=1}^{N_{\text{nodes}}} \mathbf{1}\left[\text{isLos}(\text{ACN}_m, \text{Node}_j)\right]$$
The route-wide average coverage metric is:
$$\text{predictedLoSCoveragePct} = \frac{100}{12} \sum_{m=0}^{11} \text{LoS}_{\text{cov}}(m)$$

---

## 3. Aerospace Flight Pattern Geometries

1. **Standard Elliptical Orbit (`ellipse_orbit`)**:
   Closed 8-waypoint ellipse centered at $(x_c, y_c)$ with semi-major axis $a$, semi-minor axis $b$, and inclination rotation $\psi$:
   $$\begin{pmatrix} x_k \\ y_k \end{pmatrix} = \begin{pmatrix} x_c \\ y_c \end{pmatrix} + \begin{pmatrix} \cos\psi & -\sin\psi \\ \sin\psi & \cos\psi \end{pmatrix} \begin{pmatrix} a \cos\theta_k \\ b \sin\theta_k \end{pmatrix}, \quad \theta_k = \frac{2\pi k}{8}$$

2. **Racetrack Holding Pattern (`racetrack_hold`)**:
   Standard 8-waypoint pattern with two parallel straight legs of length $L$ separated by distance $2R$, terminated by constant-radius semicircular turns of radius $R$:
   - Eastbound leg: $(-L/2, -R) \to (+L/2, -R)$
   - East turn: $(+L/2 + R\cos(-\pi/4), R\sin(-\pi/4)) \to (+L/2 + R\cos(\pi/4), R\sin(\pi/4))$
   - Westbound leg: $(+L/2, +R) \to (-L/2, +R)$
   - West turn: $(-L/2 - R\cos(\pi/4), R\sin(\pi/4)) \to (-L/2 - R\cos(-\pi/4), R\sin(-\pi/4))$

3. **Figure-8 Cross-Valley Relay (`figure8_valley`)**:
   Lemniscate of Gerono closed loop crossing the central mountain ridge origin $(0, 0)$ with alternating North/South valley lobes:
   $$x_k = x_c + A \sin\theta_k, \quad y_k = y_c + B \sin\theta_k \cos\theta_k, \quad \theta_k = \frac{2\pi k}{8}$$

4. **Kargil Canyon Corridor Transit (`canyon_transit`)**:
   6-waypoint terrain-skimming mountain corridor following natural alpine valley cuts with stepped waypoint altitudes:
   - Stepped altitude envelope: $4,800\text{ m} \to 5,350\text{ m (high pass)} \to 4,900\text{ m MSL}$.

---

## 4. UI Architecture & Invariants

1. **Strict UI Layout Lock**:
   - Global `.rail`, `.topbar`, `.app-shell`, and CSS tokens in `frontend/c2-console-theme.css` remain 100% untouched.
   - All additions are confined inside `#tab-authoring` (`#authoring-pane-traj`).
   - `#radar-container` layout and dimensions are strictly unaffected.
2. **Accessibility & Design Rules**:
   - Every input, select, and button has explicit `aria-label` attributes.
   - Minimum font-size $\ge 10\text{px}$.
   - High-DPI canvas rendering (`devicePixelRatio` scaling).

---

## 5. Verification Plan

- **FPU-T1 (Aerospace Pattern Generators)**: Verify `generateFlightPatternWaypoints` produces valid, closed, non-collinear 3D waypoint paths for all 4 pattern types.
- **FPU-T2 (Coordinated-Turn Aerodynamics & CFIT Detection)**: Verify exact kinematic bank angle $\phi = \arctan(V^2 \kappa / g)$, positive circuit distance/period, and CFIT flag detection when clearance $< 300\text{ m}$.
- **FPU-T3 (DOM & Global Layout Invariance Check)**: Verify presence of all required controls (`#fp-vertical-profile-canvas`, `#fp-pattern-select`, `#fp-cruise-alt-input`, `#fp-cruise-speed-input`, `#btn-fp-apply-pattern`, badges) and confirm zero layout regressions.
