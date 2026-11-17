# SPEC-SOFTWARE-ENGINEERING-MODULARITY-AND-DRY-REFACTOR: Software Engineering Modularity, DRY Physics Unification, and Type-Checked UI Scopes

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity per AGENTS.md)  
**Target Runtimes:** `src/core/rfPropagationMath.ts`, `src/core/geodeticRulerEngine.ts`, `src/core/cursorProbeEngine.ts`, `src/core/aoSwathScannerEngine.ts`, `src/core/cadObstacleSlicerEngine.ts`, `src/core/tacticalAiPathfinder.ts`, `src/worker/aiCopilotCoordinator.ts`, `src/worker/simWorker.ts`, `src/ui/scientificScopesRenderer.ts`, `src/ui/soldierEudRenderer.ts`, `index.html`, `src/tests/verifySoftwareEngineeringArchitecture.ts`, `scripts/run_all_verifications.mjs`, `package.json`, `README.md`  

---

## 1. Executive Summary & Problem Formulation

Across iterative capability expansions (Precision Geodetic Rulers, Real-time RF Viewshed, CAD Obstacle Slicing, Tactical Edge-AI Co-Pilot, ATAK Soldier Handheld EUD, and Multi-Scope Scientific Telemetry), specialized engines accrued localized implementations of shared mathematical formulas, worker state orchestrations, and canvas rendering logic:

1. **DRY Physics Duplication:** Foundational geodetic and RF propagation equations—such as $4/3$ effective Earth bulge calculation ($\Delta h_{\text{bulge}} = d_1 d_2 / (2 k R_e)$), first Fresnel zone radius ($r_{F1} = \sqrt{\lambda d_1 d_2 / (d_1 + d_2)}$), ITU-R P.526 knife-edge diffraction loss ($J(\nu)$), Free Space Path Loss ($\text{FSPL}$), and 16-wind cardinal bearing conversions—were independently re-implemented across `geodeticRulerEngine.ts`, `cursorProbeEngine.ts`, `aoSwathScannerEngine.ts`, `cadObstacleSlicerEngine.ts`, and `tacticalAiPathfinder.ts`.
2. **Worker Monolith Growth:** `src/worker/simWorker.ts` swelled with 5-pillar Edge-AI state tracking, Sky-Shepherd smooth loiter kinematic slewing, and multi-waypoint Tobler hiking traversal, diluting the single responsibility of the `SimulationWorkerManager` discrete-event loop coordinator.
3. **Unchecked UI Scope Renderers:** Complex canvas rendering routines (Body-Frame Polar Radiation Scope [ITU-R F.1336], ITU-R Link Budget Waterfall, Empirical CDF Delay Distribution [3GPP 5QI PDB], Multi-Point Parametric Sensitivity Sweep, 50 Hz Worker Jitter Histogram, and ATAK Soldier Compass) resided in untyped `<script>` blocks within `index.html`, bypassing static analysis from `tsc --noEmit`.

This specification formalizes the comprehensive Software Engineering Modularity Refactor:
- **Canonical DRY Physics Engine (`src/core/rfPropagationMath.ts`):** Centralizes all shared RF and geodetic mathematics into a single, pure, unit-annotated library consumed by all precision diagnostic engines.
- **Worker Separation of Concerns (`src/worker/aiCopilotCoordinator.ts`):** Extracts Edge-AI copilot state tracking, Sky-Shepherd slew dynamics, and multi-waypoint movement into `EdgeAiCopilotCoordinator`, leaving `simWorker.ts` lean and focused on discrete-event time stepping.
- **Type-Checked UI Scope Renderers (`src/ui/scientificScopesRenderer.ts` & `src/ui/soldierEudRenderer.ts`):** Extracts all scientific instrument and soldier phone canvas rendering routines into strongly-typed TypeScript modules that compile cleanly under `tsc --noEmit`, while maintaining thin delegating wrapper functions in `index.html` to guarantee 100% backward compatibility with static test assertions.

---

## 2. Mathematical Formulations & Canonical Library Architecture

### 2.1 Canonical Equations in `src/core/rfPropagationMath.ts`

1. **Effective Earth Bulge (Spherical Curved-Earth Correction):**
   $$\Delta h_{\text{bulge}}(d_1, d_2, k, R_e) = \frac{d_1 \cdot d_2}{2 \cdot k \cdot R_e}$$
   Where $k = 4/3$ (standard atmospheric refraction index) and $R_e = 6,371,000\text{ m}$.

2. **First Fresnel Zone Radius:**
   $$r_{F1}(d_1, d_2, \lambda) = \sqrt{\frac{\lambda \cdot d_1 \cdot d_2}{d_1 + d_2}}$$
   Where $\lambda = c / f_0$, $c = 299,792,458\text{ m/s}$, and $f_0 = 8.0\text{ GHz}$ for X-band.

3. **ITU-R P.526-15 Knife-Edge Diffraction Loss:**
   $$J(\nu) = \begin{cases} 0.0\text{ dB}, & \nu \le -0.78 \\ 6.9 + 20 \log_{10}\left(\sqrt{(\nu - 0.1)^2 + 1} + \nu - 0.1\right), & \nu > -0.78 \end{cases}$$

4. **Curved-Earth Free Space Path Loss (FSPL):**
   $$\text{FSPL}(d, f_0) = 20 \log_{10}(d) + 20 \log_{10}(f_0) - 147.552$$

5. **Geodetic Bearing and 16-Wind Compass Cardinal:**
   $$\theta = (\text{atan2}(\Delta X, \Delta Y) \cdot 180 / \pi + 360) \bmod 360$$
   $$\text{Cardinal}_{16} \in \{\text{'N'}, \text{'NNE'}, \text{'NE'}, \text{'ENE'}, \text{'E'}, \text{'ESE'}, \text{'SE'}, \text{'SSE'}, \text{'S'}, \text{'SSW'}, \text{'SW'}, \text{'WSW'}, \text{'W'}, \text{'WNW'}, \text{'NW'}, \text{'NNW'}\}$$

6. **Slant and Horizontal Range:**
   $$d_{\text{horiz}} = \sqrt{\Delta X^2 + \Delta Y^2}, \quad d_{\text{slant}} = \sqrt{d_{\text{horiz}}^2 + \Delta Z^2}$$

---

## 3. Worker Modularization: `EdgeAiCopilotCoordinator`

The `EdgeAiCopilotCoordinator` in `src/worker/aiCopilotCoordinator.ts` encapsulates:
1. **Pillar 1 (Buddy-Relay Mesh Delivery):** Caches peer relay links, evaluating candidate relay paths and mapping active Buddy-Relay `LinkStatus` records.
2. **Pillar 2 (EW Defilade Terrain Shielding):** Coordinates terrain masking and jammer angle calculations.
3. **Pillar 3 (Sky-Shepherd Slew Kinematics):** Manages `skyShepherdCurrentOffset` and `skyShepherdTargetOffset`, smoothly advancing loiter offsets toward the optimal canyon vantage point at $v_{\text{horiz,max}} = 80\text{ m/s}$ and $v_{\text{vert,max}} = 25\text{ m/s}$ on each 50 Hz discrete step.
4. **Pillar 4 (LPI/LPD Stealth Throttling):** Evaluates minimum required transmit power while preserving target MODCOD margin.
5. **Pillar 5 (15-Second Blackout Warning):** Evaluates future UAV loiter line-of-sight against mountain ridges.
6. **Multi-Waypoint Tobler Movement Stepper (`stepActiveAiNodeMoves`):** Handles multi-segment waypoint traversal, applying Tobler's Hiking Function $W(s) = 6 \cdot e^{-3.5 \cdot |s + 0.05|}$, computing heading/bearing and elevation profiles dynamically.

In `src/worker/simWorker.ts`, `SimulationWorkerManager` delegates to `this.aiCoordinator`, exposing clean pass-through accessors for zero disruption to existing IPC command handlers and serialization routines.

---

## 4. Type-Checked UI Canvas Renderers

1. **`src/ui/scientificScopesRenderer.ts`:**
   - `drawPolarAntennaScope`: Body-frame 4-sector parabolic gain curve radiation scope with node overlay and handover count.
   - `drawLinkWaterfallCanvas`: 8-stage ITU-R link budget waterfall analyzer ($P_{\text{tx}}$, $G_{\text{tx}}$, $\text{FSPL}$, $A_{\text{gas}}$, $A_{\text{rain}}$, $L_{\text{diff}}$, $G_{\text{acn}}$, $P_{\text{rx}}$ vs $P_{\text{noise}}$).
   - `drawEcdfDelayScope`: Empirical cumulative distribution function delay curves across Static TDMA, Reactive M-LWDF, and Tac-TAD against 3GPP TS 23.501 5QI PDB limits.
   - `drawSensitivitySweepScope`: Multi-point parametric sensitivity sweep curves across domain axes (traffic load, DEM error, CQI feedback delay) with live operating point cursor.
   - `drawWorkerJitterHistogramScope`: 8-bin worker execution latency histogram with color-coded latency tiers and 20.0 ms hard real-time ceiling.
2. **`src/ui/soldierEudRenderer.ts`:**
   - `drawSoldierCompassScope`: ATAK handheld compass rose with rotating cardinal ring, active heading needle, direct UAV line-of-sight vector, and next AI waypoint bearing bug.
   - `resolveSoldierAiNotificationBanner`: Pure status resolver returning deterministic styling and tactical alerts (Transit, 15s Blackout Warning, Sky-Shepherd Repositioning, Buddy-Relay Active, AI Walk Directive, and Optimal Clear LoS).

---

## 5. Strict Invariants

1. **Zero Functional or Visual Regressions:** All 85 existing verification suites, browser tests, and benchmarks must pass without modification to expected simulation outputs.
2. **Theme Protection:** `frontend/c2-console-theme.css`, `.rail`, `.topbar`, and `.app-shell` remain 100% untouched.
3. **Static Regex Compatibility:** All static test regexes in `src/tests/verify*.ts` and `scripts/verify-project.mjs` continue to pass via delegating wrapper functions.
4. **50 Hz Discrete-Event Budget:** Total worker execution time per 20 ms discrete step remains strictly $\le 6.5\text{ ms}$ (p50).

---

## 6. Verification Suite Requirements (SEA-T1–T4)

- **SEA-T1 (DRY Single-Source-of-Truth Math):** Verify `src/core/rfPropagationMath.ts` exports all canonical functions and that all 5 precision diagnostic engines import from it.
- **SEA-T2 (Worker Coordinator Decomposition):** Verify `EdgeAiCopilotCoordinator` cleanly steps Sky-Shepherd kinematics and multi-waypoint movements and is integrated into `simWorker.ts`.
- **SEA-T3 (Type-Checked UI Scope Modules):** Verify `scientificScopesRenderer.ts` and `soldierEudRenderer.ts` compile cleanly, export typed renderers, and are imported by `index.html`.
- **SEA-T4 (Spec Persistence & Theme Invariance):** Verify spec file exists on disk, is linked in Section 7 of `README.md`, and `frontend/c2-console-theme.css` has zero git diff.
