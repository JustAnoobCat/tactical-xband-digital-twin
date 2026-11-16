# SPEC-INTUITIVE-TOOLBOX-RIGHT-PANEL-AND-UX-FINISH: Intuitive Terrain Toolbox Right-Hand Panel Docking, Human-Friendly Naming & Ergonomic UX Finish

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity)  
**Target Runtimes:** `index.html` (`.detail-viewport`, `#terrain-toolbox`, `#map-active-tool-bar`, `#tb-pane-transect`, `#radar-canvas`), `src/tests/verifyIntuitiveToolboxUx.ts`, `package.json`, `scripts/run_all_verifications.mjs`, `README.md`

---

## 1. Executive Summary & Operational Context

In high-relief mountainous topography such as the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$), tactical communications officers, mission operators, and electronic warfare planners require intuitive, streamlined, and friction-free geospatial analysis tools. The previous iteration of the Terrain Toolbox implemented advanced CAD/GIS algorithms (geodetic ruler ray-marching, 360° skyline probe, 64-cell AO swath scanner, and 3D link slicer) but placed their controls and complex metrics in a cramped 300px floating container that obstructed 40%+ of the tactical radar map, while using cryptic labels (e.g. `2-pt A→B`) and perpetually cluttering the measurement ruler with kilometer division ticks (`1k`, `2k`, `3k`).

This upgrade provides the definitive ergonomic finish:
1. **Intuitive Human-Friendly Tool Naming:**
   - `#tb-tool-transect`: **`📏 Measure Line & LoS`** (Sub-label: `Distance, Angle & Sightline`) — eliminating all cryptic `2-pt A→B` terminology.
   - `#tb-tool-probe`: **`📍 Signal Probe & Spawn`** (Sub-label: `Spot Signal & Place Unit`).
   - `#tb-tool-region`: **`⬚ Area Coverage Scan`** (Sub-label: `Scan Valley & Peaks`).
   - `#tb-tool-obstacle`: **`🧱 Build 3D Barrier`** (Sub-label: `Draw Wall to Block Links`).
2. **Spacious Right-Hand Workspace Area Inspector Docking:**
   - Whenever any tool is activated or the toolbox is opened (`tbOpen === true`), `#terrain-toolbox` is docked and displayed inside the spacious **Right-Hand Panel (`.detail-viewport`)** as a full-width, roomy inspector view with generous 16px padding, 200px-tall visualizer canvases, and a readable 2-column metrics grid (`13px–15px` values).
   - Simultaneously, on the map canvas (`#radar-container`), a slim, non-intrusive 1-row floating HUD pill bar `#map-active-tool-bar` (`[ 📏 Measure Line ] [ 📍 Signal Probe ] [ ⬚ Area Scan ] [ 🧱 3D Barrier ] [ ✕ Exit Tool (Esc) ]`) renders at top-center, keeping **95%+ of the map completely unobstructed**.
3. **Clean Measurement Line Default & On-Demand Ruler Scale Divisions:**
   - Perpendicular kilometer ticks (`1k, 2k, 3k...`) are hidden by default (`tbShowRulerTicks = false`), presenting a clean, uncluttered sightline between Points `[A]` and `[B]` with a high-contrast Total Distance & Angle Callout Pill (`8.42 km · 064.4° ENE · Elev Δ +612m (+4.2°)` and `CLEAR LoS / BLOCKED`).
   - Adds toggle button `#btn-toggle-ruler-ticks` (`Show Scale Divisions [OFF/ON]`) inside `#tb-pane-transect` to display division ticks on demand.
4. **Universal `Escape` (`Esc`) Key Exit & Right-Click Measurement Reset:**
   - Pressing `Escape` at any time exits the active tool, clears in-progress rubber-band drag states, restores the normal map cursor, hides `#map-active-tool-bar`, and immediately reveals the active right-hand workspace tab.
   - Right-clicking (`contextmenu`) on `#radar-canvas` during active measurement clears the points without exiting the tool mode, enabling immediate consecutive measurements.
5. **Dynamic Step-by-Step Guidance Banner (`#tb-step-guide-banner`):**
   - Renders a high-contrast instruction banner at the top of `#terrain-toolbox` updating dynamically with user state across all 4 tools.

---

## 2. Architectural Invariants & Seam Specifications

### 2.1 State Management & Invariants
- `tbOpen: boolean`: Global flag indicating whether the toolbox workspace inspector is active.
- `tbShowRulerTicks: boolean`: Defaults to `false`. When `false`, kilometer ticks along the ruler shaft are omitted; when `true`, ticks are rendered.
- `tbActiveMode: 'transect' | 'probe' | 'region' | 'obstacle'`: Identifies the currently active tool inspector pane.
- Map Interaction Mode: When a tool is active, the map cursor reflects the tool action (crosshair during rubber-banding, grab during navigation).

### 2.2 Right-Hand Workspace (`.detail-viewport`) Docking
- Structure:
  ```html
  <section class="detail-viewport" id="detail-viewport" aria-label="Selected workspace">
    <div class="detail-status-strip">...</div>
    <div id="terrain-toolbox" class="terrain-toolbox-viewport" style="display:none;" aria-label="Terrain Toolbox Inspector">
      <!-- Header with #terrain-toolbox-close -->
      <!-- Dynamic Step-by-Step Guidance Banner #tb-step-guide-banner -->
      <!-- 4 Intuitive Mode Tabs #tb-tool-transect, #tb-tool-probe, #tb-tool-region, #tb-tool-obstacle -->
      <!-- Tool Panes & Canvases -->
    </div>
    <!-- Normal Workspace Tabs (.tab-content) -->
  </section>
  ```
- When `tbOpen = true`: `.detail-viewport > .tab-content` elements have `display: none;`, `#terrain-toolbox` has `display: flex;`.
- When `tbOpen = false`: `#terrain-toolbox` has `display: none;`, active `.tab-content` has `display: ''`.

### 2.3 Slim Floating HUD Map Tool Bar (`#map-active-tool-bar`)
- Positioned floating at `top: 10px; left: 50%; transform: translateX(-50%);` inside `#radar-container`.
- Elements:
  - `[ 📏 Measure Line ]` -> activates Transect tool
  - `[ 📍 Signal Probe ]` -> activates Probe tool
  - `[ ⬚ Area Scan ]` -> activates Region tool
  - `[ 🧱 3D Barrier ]` -> activates Obstacle tool
  - `[ ✕ Exit Tool (Esc) ]` -> calls `closeTerrainToolbox()`

---

## 3. Verification Protocol

The implementation is verified by:
1. `src/tests/verifyIntuitiveToolboxUx.ts`:
   - **ITU-T1:** Human-friendly tool names (`Measure Line & LoS`, `Signal Probe & Spawn`, `Area Coverage Scan`, `Build 3D Barrier`), zero `2-pt A→B` text, presence of `#tb-step-guide-banner`.
   - **ITU-T2:** `#btn-toggle-ruler-ticks` toggle button exists, defaults `tbShowRulerTicks = false`, gates tick drawing.
   - **ITU-T3:** Universal `Escape` key exit handler, right-hand workspace restoration, spec existence and README link.
2. Full suite run via `scripts/run_all_verifications.mjs` verifying all 78+ test suites pass 100%.
3. Playwright browser UX verification via `npm run verify:browser` across Desktop, Standard Laptop, Constrained Laptop, and Mobile Split viewports.
