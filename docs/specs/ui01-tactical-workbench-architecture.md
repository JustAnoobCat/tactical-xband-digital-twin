# Specification UI-01: Forensic DOM Contract Audit & Tactical Obsidian Design System Foundation

**Status:** Approved Architectural Blueprint
**Role:** Coder / Implementer (Role 2 per `AGENTS.md`)
**Phase:** UI-01 Foundation
**Scope:** Standalone Design System, Forensic Audit, DOM ID Contract Registry, Monochrome SVG Icon Kit, Suite 96

---

## 1. Executive Summary & Authoritative Invariants

Phase UI-01 establishes the rock-solid, zero-AI-slop structural foundation for the Tactical X-Band Air-to-Ground Network Digital Twin.
This phase performs a complete forensic audit of all 826 DOM IDs, analyzes the failure modes of the previous Google Stitch MCP UI overhaul attempt, documents an exact 4-zone map-first C2 workbench layout, defines the matte Tactical Obsidian design token architecture in `frontend/tactical-obsidian.css`, introduces a pure geometric SVG icon system in `src/ui/tacticalIcons.ts`, and verifies the foundation via Suite 96 (`src/tests/verifyTacticalDesignSystem.ts`).

### Authoritative Architectural Invariants (per `AGENTS.md` §1):
1. **Worker State Authority:** Live simulation state (positions, velocities, queues, TDMA slots) lives exclusively in `src/worker/simWorker.ts`. The UI thread projects telemetry and inspects history without mutating live worker state.
2. **50 Hz Discrete Loop Budget:** All worker computations strictly complete within $\Delta t = 20\text{ ms}$. CSS and DOM layouts must not introduce forced reflow loops or UI thread jank.
3. **Physical & Mathematical Rigor:** RF and geodesy models (FSPL, ITU-R P.676, ITU-R P.838, ITU-R P.526, WGS-84, DVB-S2X, 3GPP 5QI) remain strictly untouched.
4. **Atomic Cutover Safety:** In UI-01, `index.html` is strictly read-only. The new stylesheet `frontend/tactical-obsidian.css` is authored as a standalone asset and will be cleanly wired in UI-02 to prevent half-migrated states.
5. **Zero-AI-Slop Mandate:** Absolutely zero emojis in production UI stylesheets, icon kits, or labels. Zero neon glow shadows, purple/cyan gradients, glassmorphism `backdrop-filter: blur`, or puffy 16px consumer pill buttons.

---

## 2. Stitch Overhaul Failure Analysis & Root Cause Postmortem

During earlier prototyping, an automated transplant using Google Stitch MCP was introduced (`frontend/stitch-theme.css`, `docs/specs/SPEC-CODEBASE-DRIVEN-STITCH-UI-OVERHAUL.md`, and inline modifications to `index.html`). A forensic audit reveals four fatal failure modes:

### 2.1 Specificity Wars and Utility Class Bloat
`frontend/stitch-theme.css` injected 327 lines filled with `!important` declarations across hundreds of utility classes (`.font-console-title`, `.bg-c2-void`, `.text-c2-text-bright`, `.border-c2-line-subtle`, etc.). When combined with existing rules in `frontend/c2-console-theme.css`, this caused cascading specificity conflicts, broken hover/active states, and unmaintainable stylesheet coupling.

### 2.2 External CDN Runtime Dependency in Tactical Runtime
Stitch injected `<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>` and external Google Fonts (`Material Symbols Outlined`) into the head of `index.html`. For an air-gapped tactical defense digital twin or environments with strict Content Security Policies (CSP), relying on an external CDN runtime compiler introduces critical vulnerabilities, high latency, non-deterministic layout shifts, and catastrophic offline failure.

### 2.3 Broken Layout Geometry & Viewport Cramping
The tactical digital twin is fundamentally a **spatial C2 theater**. Stitch introduced fixed-width horizontal stacking and uncontrolled vertical wrapping, squeezing the 2D/3D radar canvas (`#radar-container`) into a cramped sub-pane while wasting screen real estate on oversized padding and redundant headers. Slide-over drawers and panels (`.terrain-toolbox-panel`, `#sim-timeline-panel`, `#map-node-details`) collided in the z-index stack, intercepting canvas pointer events.

### 2.4 Non-Compliant Visual Distraction (Neon Glow & Pill Aesthetic)
Stitch utilized saturated glowing cyan borders (`rgba(0, 229, 255, 0.65)`), rounded pill containers, and uneven text contrast that violated WCAG 2.1 AA requirements and degraded tactical operator focus. Tactical defense workstations (e.g. Keysight, Rohde & Schwarz, Thales) strictly employ matte surfaces, hairline borders, and subdued functional signal coding.

---

## 3. The 4-Zone Map-First Tactical C2 Workbench Blueprint

To eliminate UI bloat while retaining 100% of the twin's deep scientific instruments, the interface is organized into 4 disciplined zones operating within an unscrollable `100vw × 100vh` frame:

```
+----------------------------------------------------------------------------------------------------+
| ZONE 1: TOP COMMAND STRIP (40px)                                                                   |
| [Mark] [Scenario] | [PLAY/PAUSE] [STEP] [RESET] [Speed] [T+ Clock] | [5 WORKSPACE MODES] | [Health] [CVD]|
+--------+-------------------------------------------------------------------------+-----------------+
| ZONE 2 | ZONE 3: DOMINANT CENTER VIEWPORT (FLUID THEATER)                        | ZONE 4:         |
| (48px) |                                                                         | CONTEXTUAL      |
| [Lyr]  | - 2D MapLibre / 3D Three.js Hardware Canvas                             | INSPECTOR       |
| [Dem]  | - Corner HUD: [2D | 3D | SPLIT] [Spatial Lock] [Cursor Lat/Lon/Alt]     | (340px)         |
| [Prb]  | - Active Tool Readout Bar                                                | Strictly filtered|
| [Rul]  |                                                                         | by active       |
| [Swa]  | +---------------------------------------------------------------------+ | Workspace Mode: |
| [Cad]  | | SLIDE-OVER TOOL DRAWER (300px) - Opens on tool selection,             | - OPS           |
| [Vsh]  | | collapses cleanly on close/ESC. Zero canvas occlusion when idle.   | | - RF / PHY      |
| [Way]  | +---------------------------------------------------------------------+ | - MAC / NET     |
| [AIP]  |                                                                         | - PLAN / AI     |
| [Jam]  |                                                                         | - LAB           |
+--------+-------------------------------------------------------------------------+-----------------+
| ZONE 4 (BOTTOM): REPLAY TIMELINE (44px) / EXPANDABLE DIAGNOSTIC DOCK (220px)                       |
| [Live/Pause] [Scrubber 0..60s] [Zoom] [CSV] | [Expand Dock: Goodput / ECDF / PDU Analyzer]          |
+----------------------------------------------------------------------------------------------------+
```

### Zone Specifications:

#### Zone 1: Top Command Strip (`40px`)
- **Fixed Height:** `40px`, zero outer margin.
- **Subsystems:**
  1. **Mark & Identity:** System mark `XBAND-DT // 8.0 GHz`, sector identifier `LATTICE-90`.
  2. **Scenario Preset:** Dropdown (`#scenario-select`, `#scenario-desc`) for tactical presets.
  3. **Simulation Transport:** Master control cluster (`#btn-pause`, `#btn-step`, `#btn-sim-reset`, `#sim-speed-slider`, `#sim-speed-readout`, `#sim-speed-input`, `#sim-clock-display`).
  4. **5-Mode Workspace Switcher:** Segmented control toggling: `OPS` | `RF / PHY` | `MAC / NET` | `PLAN / AI` | `LAB`.
  5. **Telemetry Health Strip:** Compact live KPIs (UAV altitude/position, active link count, aggregate goodput, mean SNR, BLER).
  6. **Accessibility & Utility Controls:** CVD toggle (`#btn-toggle-cvd`), Help/Reference modal toggles (`#btn-help`, `#btn-expert`), and Inspector toggle (`#btn-toggle-inspector`).

#### Zone 2: Left Precision Tool Rail (`48px` + `300px` Slide-Over Drawer)
- **Rail Width:** `48px`, fixed vertical column on viewport left.
- **Slide-Over Drawer:** `300px` slide-out container (`#terrain-toolbox-drawer`) that floats over the canvas when active and auto-collapses on Escape or close button click.
- **Tool Roster (10 Precision Instruments):**
  1. **Layers:** MapLibre/vector layers and hillshade rasters (`#tool-map-layers`, `#tb-tool-dem`).
  2. **Terrain / SRTM .hgt:** Elevation profile loader & mosaic stitcher (`#terrainFileInput`, `#terrainFolderInput`, `#btn-load-hgt`).
  3. **Cursor Probe:** Lat/Lon/Alt query with knife-edge diffraction probe (`#tb-tool-probe`, `#btn-probe-snap-best`).
  4. **Geodetic Ruler:** WGS-84 Vincenty geodesic distance & RF line-of-sight ruler (`#tb-tool-ruler`, `#btn-toggle-ruler-ticks`).
  5. **AO Swath Scanner:** Area of operations polygonal coverage & dead-zone scanner (`#tb-tool-swath`, `#btn-swath-scan`).
  6. **CAD Obstacles:** 3D building/mesh placement & link-slicer engine (`#tb-tool-cad`, `#btn-cad-slice`, `#tb-obs-place-btn`).
  7. **Viewshed Advisor:** Polar X-band line-of-sight viewshed and relay placement recommender (`#toggle-viewshed-heatmap`, `#btn-recompute-relay-advisor`).
  8. **Flight Waypoints:** UAV kinematic path authoring and waypoint table (`#btn-author-tab-traj`, `#btn-fp-apply-pattern`).
  9. **Tactical AI Pathfinder:** Autonomous NLoS link-recovery pathfinder (`#btn-ai-auto-heal-toggle`, `#btn-ai-buddy-mesh-toggle`).
  10. **Contested EW / Jammer:** Airborne jamming pod and electronic warfare injection (`#btn-inject-jammer`, `#btn-inject-traffic`).

#### Zone 3: Dominant Center Viewport (Fluid Unobstructed Theater Canvas)
- **Sizing:** `flex: 1`, `min-width: 0`, `min-height: 0`. Guaranteed at least 55% of window width across all responsive breakpoints.
- **Canvases:**
  - 2D Canvas (`#radar-canvas`, `#radar-stage`, `#radar-container`): MapLibre / HTML5 Canvas tactical map.
  - 3D WebGL Canvas (`#three-canvas`): Three.js photorealistic Ladakh terrain and volumetric beam meshes.
- **Corner HUD (Non-Occluding Matte Overlays):**
  - Top-Left: View mode segmented toggle (`#btnView2D`, `#btnView3D`), Spatial Lock toggle (`#btn-spatial-lock`).
  - Top-Right: Picking / Tool Action status banner (`#tb-picking-bar`).
  - Bottom-Left: Tabular radar cursor readout (`#radar-cursor-hud`, `#radar-hud-coords`, `#radar-hud-locked-pill`).
  - Bottom-Right: Compact map legend (`.map-legend`, `#btn-legend-toggle`).

#### Zone 4: Collapsible Right Contextual Inspector (`340px`) + Bottom Replay Timeline
- **Right Inspector Width:** `340px` (responsive to `300px` at $\le 1440\text{px}$ and `276px` at $\le 1280\text{px}$, fully collapsible to `0px`).
- **Mode-Filtered Contextual Panes:**
  - **Mode OPS (Operations):** Selected node details (`#map-node-details`), terminal inventory (`#terminal-inventory-table`), situation strip (`#situation-strip`), soldier handheld EUD (`#soldier-eud-container`).
  - **Mode RF / PHY (Physical Layer):** Ray-traced terrain path profile (`#profile-canvas`), link waterfall (`#link-waterfall-canvas`), DVB-S2X I/Q constellation (`#iq-constellation-canvas`), 4-sector antenna polar plot (`#polar-antenna-canvas`), parametric sensitivity sweep (`#sensitivity-sweep-canvas`).
  - **Mode MAC / NET (Networking & Protocol):** TDMA frame logic analyzer & Gantt timeline (`#gantt-canvas`), PDU dissector table (`#allocation-inspector`), buffer queue backlog (`#sched-chart-backlog`), 3GPP 5QI SLA compliance (`#qos-sla-canvas`), NTN RACH signaling ladder (`#ntn-signaling-canvas`).
  - **Mode PLAN / AI (Planning & Optimization):** Flight trajectory editor (`#authoring-pane-traj`), TDMA slot authoring (`#authoring-pane-tdma`), CAD obstacle link-slicer (`#authoring-pane-obs`), Tactical AI recovery advisor.
  - **Mode LAB (Research & Diagnostics):** 50 Hz worker jitter profiler (`#worker-jitter-canvas`), scientific benchmark engine, documentation & formulas (`#tab-doc`), LaTeX ablation tables (`#btn-copy-latex-ablation`), reproducible research dossier generator (`#btn-generate-research-dossier`).
- **Bottom Timeline Bar (`44px`) & Expandable Diagnostic Dock (`220px`):**
  - Compact Replay Bar: Frame scrubber (`#sim-timeline-canvas`, `#timeline-time-display`, `#timeline-btn-play`, `#timeline-btn-step-back`, `#timeline-btn-step-fwd`, `#timeline-btn-live`).
  - Expandable Dock (`#sim-timeline-inspector-container`): Diagnostic scopes (Rolling Goodput `#overview-goodput-canvas`, ECDF Delay `#ecdf-delay-canvas`, PDU packet inspector).

---

## 4. Current Emoji & AI-Slop Inventory (Purge Target for UI-02 / UI-03)

A strict static scan identified 31 emoji occurrences across the codebase. These will be purged in UI-02 and UI-03 and replaced with crisp geometric SVGs from `src/ui/tacticalIcons.ts` or standard military shortcodes (`[WARN]`, `[OK]`, `[ERR]`):

| File | Line | Emoji | Context / Code Snippet | Replacement Strategy |
|:---|:---:|:---:|:---|:---|
| `index.html` | 6244 | `⚠` | `spatWarn.textContent = `⚠️ Spatial environment modified (snapshot rev ${rec` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 6280 | `⚠` | `spatWarn.textContent = `⚠️ Spatial environment modified (snapshot rev ${rec` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 6561 | `⚠` | `spatWarn.textContent = `⚠️ Spatial environment modified (snapshot rev ${rec` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 6605 | `⚠` | `spatWarn.textContent = `⚠️ Spatial environment modified (snapshot rev ${rec` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 10913 | `⚠` | `ctx.fillText('⚠ TERRAIN PROXIMITY WARNING', bx + 6, by + badgeH / 2);` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14253 | `✓` | `eventTarget.textContent = '✓ Injected!';` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14422 | `✗` | `statusBox.textContent = `[✗] Error: ${parseResult.error}`;` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14448 | `✓` | `statusBox.textContent = `[✓] Loaded ${meta.tileName} (${parseResult.resolut` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14452 | `✗` | `statusBox.textContent = `[✗] Failed to process HGT: ${err?.message \|\| err` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14457 | `✗` | `statusBox.textContent = `[✗] Failed to read file: ${file.name}`;` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14512 | `✓` | `statusBox.textContent = `[✓] Custom Heightmap Processed (${file.name})`;` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14557 | `✗` | `statusBox.textContent = `[✗] Could not select a valid terrain patch from ca` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14588 | `✓` | `statusBox.textContent = `[✓] Stitched & Loaded ${tileCountStr}: ${mosaic.me` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14595 | `✗` | `statusBox.textContent = `[✗] Failed to stitch patch: ${err?.message \|\| er` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14634 | `✓` | `${patch.tiles.map(t => `<span style="color:#52b788;display:inline-block;mar` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14641 | `⚠` | `⚠️ Missing in bounding patch: ${patch.missingNeighbourNames.join(', ')} (un` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14678 | `✗` | `statusBox.textContent = `[✗] No valid SRTM .hgt files found in selected fol` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 14695 | `✗` | `statusBox.textContent = `[✗] Folder processing error: ${err?.message \|\| e` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 15075 | `⚠` | `setText('body-pillar-lpi-blackout', `LPI TX: ${lpiTx.toFixed(1)} dBm (-${lp` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 16620 | `⚠` | `else if (status === 'BLOCKED_NLOS') { badge.className = 'kpi-badge badge-am` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 17226 | `✥` | `// Center Translation Handle [✥]` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 17244 | `✥` | `ctx.fillText('[✥]', pc.x, pc.y + 14);` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `index.html` | 17293 | `⚠` | `: `⚠ S${int.nodeId} FLIES OVER (+${Math.round(Math.abs(int.intrusionM))}m ·` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `src/ui/accessibilityEncoding.ts` | 277 | `✕` | `iconChar: '✕',` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `src/ui/accessibilityEncoding.ts` | 324 | `✕` | `iconChar: '✕',` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `src/ui/dataCommVisualization.ts` | 1922 | `✓` | `badgeText = `${nodeLabel} \| ${type} \| [✓ COMPLETE] \| UL`;` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `src/ui/dataCommVisualization.ts` | 1925 | `✕` | `badgeText = `${nodeLabel} \| ${type} \| [✕ QUEUE EXPIRED] \| UL`;` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `src/ui/soldierEudRenderer.ts` | 327 | `🛰` | `ctx.fillText('🛰 UAV', ux, uy - 7);` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `src/ui/soldierEudRenderer.ts` | 345 | `⚠` | `ctx.fillText('⚠️ EW-JAM', jx, jy + 10);` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `src/ui/soldierEudRenderer.ts` | 380 | `🔗` | `ctx.fillText(`🔗 S${other.node_id}`, px, py - 8);` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |
| `src/ui/soldierEudRenderer.ts` | 436 | `★` | `ctx.fillText('★ AI SAFE', tipX, tipY - 8);` | Replace with tactical SVG icon or `[WARN]` / `[OK]` |

---

## 5. Forensic DOM ID Contract Registry

Total DOM IDs audited in `index.html`: **826**.
Total DOM IDs asserted by test suites & scripts: **273**.

Every single ID is registered below with its HTML tag, definition line, query status, asserted test suites, target workbench zone, and active workspace mode:

| DOM ID | Tag | Line | JS Query? | Test Assertions | Target Workbench Zone | Target Workspace Mode |
|:---|:---:|:---:|:---:|:---|:---|:---|
| `${n.node_id}` | `<tr>` | 6991 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `${obs.id}` | `<div>` | 10134 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `${region.id}` | `<div>` | 12808 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-reactive-delay` | `<td>` | 2139 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-reactive-goodput` | `<td>` | 2136 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-reactive-overflow` | `<td>` | 2140 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-reactive-util` | `<td>` | 2137 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-reactive-waste` | `<td>` | 2138 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-row-reactive` | `<tr>` | 2134 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-row-static` | `<tr>` | 2126 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-row-tac` | `<tr>` | 2142 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-static-delay` | `<td>` | 2131 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-static-goodput` | `<td>` | 2128 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-static-overflow` | `<td>` | 2132 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-static-util` | `<td>` | 2129 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-static-waste` | `<td>` | 2130 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-tac-delay` | `<td>` | 2147 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-tac-goodput` | `<td>` | 2144 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-tac-overflow` | `<td>` | 2148 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-tac-util` | `<td>` | 2145 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `abl-tac-waste` | `<td>` | 2146 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `ai-copilot-matrix-panel` | `<div>` | 3949 | no | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector / Contextual) | OPS |
| `ai-directive-readout` | `<div>` | 2679 | no | verifyTacticalAiPathfinder, verifyWalkablePathfinderAndObstacleAvoidance | Zone 4 (Right Inspector / Contextual) | OPS |
| `ai-pathfinder-card` | `<div>` | 2671 | no | verifyTacticalAiPathfinder | Zone 4 (Right Inspector / Contextual) | OPS |
| `ai-q-badge` | `<span>` | 2677 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `alloc-airtime` | `<strong>` | 2172 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `alloc-inspector-note` | `<p>` | 2175 | no | — | Zone 4 (Bottom Timeline & Dock) | ALL |
| `alloc-node-label` | `<strong>` | 2171 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `alloc-segments` | `<strong>` | 2173 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `allocation-inspector` | `<div>` | 2168 | no | verify-project | Zone 4 (Bottom Timeline & Dock) | ALL |
| `authoring-pane-obs` | `<div>` | 3814 | no | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `authoring-pane-tdma` | `<div>` | 3700 | no | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `authoring-pane-traj` | `<div>` | 3525 | no | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `badge-pillar-buddymesh` | `<span>` | 3988 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `badge-pillar-defilade` | `<span>` | 3999 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `badge-pillar-lpi-blackout` | `<span>` | 4021 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `badge-pillar-skyshepherd` | `<span>` | 4010 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `badge-pillar-walkable` | `<span>` | 3977 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `body-pillar-buddymesh` | `<div>` | 3990 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `body-pillar-defilade` | `<div>` | 4001 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `body-pillar-lpi-blackout` | `<div>` | 4023 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `body-pillar-skyshepherd` | `<div>` | 4012 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `body-pillar-walkable` | `<div>` | 3979 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-ai-auto-heal-matrix-toggle` | `<button>` | 3964 | YES | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-ai-auto-heal-toggle` | `<button>` | 2689 | YES | verifyTacticalAiPathfinder | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-ai-buddy-mesh-toggle` | `<button>` | 3958 | YES | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-ai-lpi-stealth-toggle` | `<button>` | 3961 | YES | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-ai-reposition-node` | `<button>` | 2683 | no | verifyTacticalAiPathfinder | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-author-tab-obs` | `<button>` | 3522 | no | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `btn-author-tab-tdma` | `<button>` | 3521 | no | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `btn-author-tab-traj` | `<button>` | 3520 | no | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `btn-banner-return-live` | `<button>` | 1003 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-center` | `<button>` | 1458 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-close-node-details` | `<button>` | 1561 | YES | verify-browser-ux | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `btn-copy-latex-ablation` | `<button>` | 2048 | YES | verifyPublicationEcdfAndLatex | Zone 4 (Right Inspector) | LAB |
| `btn-diag-json-expand` | `<button>` | 3114 | YES | — | Zone 4 (Right Inspector) | LAB |
| `btn-doc-subview-diag` | `<button>` | 3083 | YES | — | Zone 4 (Right Inspector) | LAB |
| `btn-doc-subview-ref` | `<button>` | 3084 | YES | — | Zone 4 (Right Inspector) | LAB |
| `btn-eud-pin-shepherd` | `<button>` | 3933 | YES | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `btn-eud-walk-ai` | `<button>` | 3930 | no | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `btn-expert` | `<button>` | 1063 | no | — | Zone 1 (Top Command Strip) | ALL |
| `btn-fp-apply-pattern` | `<button>` | 3554 | YES | verifyFlightPlannerUpgrade | Zone 4 (Right Inspector) | PLAN_AI |
| `btn-generate-research-dossier` | `<button>` | 3170 | YES | verifyWorkerJitterAndDossierUpgrade | Zone 4 (Right Inspector) | LAB |
| `btn-help` | `<button>` | 1067 | no | — | Zone 1 (Top Command Strip) | ALL |
| `btn-legend-toggle` | `<button>` | 1471 | YES | verify-browser-ux | Zone 3 (Center Viewport Theater) | ALL |
| `btn-narrative-expand` | `<button>` | 1126 | YES | verify-browser-ux | Zone 4 (Right Inspector) | LAB |
| `btn-node-add` | `<button>` | 2780 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `btn-node-cancel` | `<button>` | 2835 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `btn-node-delete` | `<button>` | 2782 | YES | verify-browser-ux | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `btn-node-duplicate` | `<button>` | 2781 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `btn-node-edit` | `<button>` | 2783 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `btn-node-quick-fresnel` | `<button>` | 1567 | YES | verify-browser-ux | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `btn-node-quick-los` | `<button>` | 1566 | YES | verify-browser-ux | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `btn-node-submit` | `<button>` | 2834 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `btn-obs-auto-height` | `<button>` | 1374 | YES | verifyPrecisionCadObstacleTool4 | Zone 4 (Right Inspector) | PLAN_AI |
| `btn-obs-slice-node-link` | `<button>` | 1385 | YES | verifyPrecisionCadObstacleTool4 | Zone 4 (Right Inspector) | PLAN_AI |
| `btn-open-soldier-phone` | `<button>` | 2686 | no | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `btn-pause` | `<button>` | 985 | YES | verifyComprehensive51PointUxPolish, verify-browser-ux | Zone 1 (Top Command Strip) | ALL |
| `btn-pdu-auto-follow` | `<button>` | 2185 | YES | verifyTdmaLogicAnalyzerDissector | Zone 4 (Right Inspector) | MAC_NET |
| `btn-probe-snap-best` | `<button>` | 1287 | YES | verifyPrecisionCursorProbeTool2 | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-recompute-relay-advisor` | `<button>` | 2503 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-region-deploy-squad` | `<button>` | 1337 | YES | verifyPrecisionAoSwathTool3 | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-region-spawn-summit-relay` | `<button>` | 1338 | YES | verifyPrecisionAoSwathTool3 | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-reset-theater` | `<button>` | 1626 | YES | verify-browser-ux | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-sim-reset` | `<button>` | 987 | YES | verify-browser-ux | Zone 1 (Top Command Strip) | ALL |
| `btn-spatial-lock` | `<button>` | 1467 | YES | verifyComprehensive51PointUxPolish, verify-browser-ux | Zone 3 (Center Viewport Theater) | ALL |
| `btn-step` | `<button>` | 986 | YES | — | Zone 1 (Top Command Strip) | ALL |
| `btn-subtab-inventory` | `<button>` | 2632 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-subtab-traffic` | `<button>` | 2636 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `btn-terrain-reset-fit` | `<button>` | 2464 | YES | verifyPathProfileTopView | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-terrain-view-profile` | `<button>` | 2457 | YES | verifyPathProfileTopView | Zone 4 (Right Inspector) | RF_PHY |
| `btn-terrain-view-rf-top` | `<button>` | 2459 | YES | verifyPathProfileTopView | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-terrain-view-top` | `<button>` | 2458 | YES | verifyPathProfileTopView | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-terrain-zoom-in` | `<button>` | 2462 | YES | verifyPathProfileTopView | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-terrain-zoom-out` | `<button>` | 2463 | YES | verifyPathProfileTopView | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-toggle-active-relay` | `<button>` | 2502 | YES | verifyActiveTwoHopRelay | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-toggle-ruler-ticks` | `<button>` | 1198 | YES | verifyIntuitiveToolboxUx | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-transect-spawn-peak-relay` | `<button>` | 1247 | YES | verifyPrecisionGeodeticRuler | Zone 4 (Right Inspector / Contextual) | OPS |
| `btn-transect-swap-ab` | `<button>` | 1246 | YES | verifyPrecisionGeodeticRuler | Zone 4 (Right Inspector / Contextual) | OPS |
| `btnMapLibre` | `<button>` | 1422 | YES | verify-browser-ux | Zone 4 (Right Inspector / Contextual) | OPS |
| `btnMapRadar` | `<button>` | 1421 | YES | verify-browser-ux | Zone 4 (Right Inspector / Contextual) | OPS |
| `btnRealTerrain` | `<button>` | 1429 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `btnRes256` | `<button>` | 1439 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `btnRes512` | `<button>` | 1438 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `btnSynthTerrain` | `<button>` | 1430 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `btnUploadTerrain` | `<button>` | 1431 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `btnView2D` | `<button>` | 1413 | YES | verify-browser-ux | Zone 3 (Center Viewport Theater) | ALL |
| `btnView3D` | `<button>` | 1414 | YES | verify-browser-ux | Zone 3 (Center Viewport Theater) | ALL |
| `card-pillar-buddymesh` | `<div>` | 3985 | no | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector / Contextual) | OPS |
| `card-pillar-defilade` | `<div>` | 3996 | no | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector / Contextual) | OPS |
| `card-pillar-lpi-blackout` | `<div>` | 4018 | no | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector / Contextual) | OPS |
| `card-pillar-skyshepherd` | `<div>` | 4007 | no | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector / Contextual) | OPS |
| `card-pillar-walkable` | `<div>` | 3974 | no | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector / Contextual) | OPS |
| `chart-backlog-label` | `<span>` | 1869 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `chart-backlog-val` | `<b>` | 1870 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `chart-util-val` | `<b>` | 1861 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `clock-display` | `<span>` | 966 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `context-eud-route` | `<b>` | 3861 | YES | — | Zone 4 (Right Inspector) | OPS |
| `dem-sector-select` | `<select>` | 944 | no | — | Zone 4 (Right Inspector) | RF_PHY |
| `detail-viewport` | `<section>` | 1118 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `diag-history-buffers` | `<strong>` | 3100 | no | — | Zone 4 (Right Inspector) | LAB |
| `diag-ipc-cadence` | `<strong>` | 3096 | no | — | Zone 4 (Right Inspector) | LAB |
| `diag-ipc-jitter` | `<strong>` | 3097 | no | — | Zone 4 (Right Inspector) | LAB |
| `diag-lookahead-state` | `<strong>` | 3099 | no | — | Zone 4 (Right Inspector) | LAB |
| `diag-raw-json-pre` | `<pre>` | 3116 | no | verifyComprehensive51PointUxPolish | Zone 4 (Right Inspector) | LAB |
| `diag-revision-meta` | `<strong>` | 3101 | no | — | Zone 4 (Right Inspector) | LAB |
| `diag-worker-pacing` | `<strong>` | 3098 | no | — | Zone 4 (Right Inspector) | LAB |
| `diagnostics-heading` | `<h3>` | 3091 | no | — | Zone 4 (Right Inspector) | LAB |
| `doc-subview-diag` | `<div>` | 3087 | YES | — | Zone 4 (Right Inspector) | LAB |
| `doc-subview-ref` | `<div>` | 3180 | YES | — | Zone 4 (Right Inspector) | LAB |
| `dossier-copy-status` | `<span>` | 3171 | YES | — | Zone 4 (Right Inspector) | LAB |
| `dossier-markdown-preview` | `<pre>` | 3174 | YES | verifyWorkerJitterAndDossierUpgrade | Zone 4 (Right Inspector) | LAB |
| `dropzone` | `<div>` | 4044 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `ecdf-delay-canvas` | `<canvas>` | 1985 | YES | verifyPublicationEcdfAndLatex, verifyUiMakeoverAnd3dPerf | Zone 4 (Bottom Timeline & Dock) | ALL |
| `ecdf-delay-panel` | `<div>` | 1977 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `edit-mode-badge` | `<span>` | 1476 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `edit-mode-banner` | `<div>` | 1475 | YES | verify-browser-ux | Zone 4 (Right Inspector / Contextual) | OPS |
| `edit-mode-cancel-btn` | `<button>` | 1480 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `edit-mode-done-btn` | `<button>` | 1479 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `edit-mode-text` | `<span>` | 1477 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `ellipse-editor` | `<div>` | 3669 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `eud-ai-notification-banner` | `<div>` | 3906 | YES | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `eud-banner-badge` | `<span>` | 3911 | YES | — | Zone 4 (Right Inspector) | OPS |
| `eud-banner-text` | `<div>` | 3913 | YES | — | Zone 4 (Right Inspector) | OPS |
| `eud-banner-title` | `<span>` | 3908 | YES | — | Zone 4 (Right Inspector) | OPS |
| `eud-gps-readout` | `<span>` | 3902 | YES | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `eud-lpi-readout` | `<span>` | 3901 | YES | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `eud-nav-guidance` | `<div>` | 3924 | YES | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `eud-node-select` | `<select>` | 3876 | YES | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `eud-route-badge` | `<span>` | 3895 | YES | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `eud-sinr-readout` | `<span>` | 3896 | YES | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `eud-status-bar` | `<div>` | 3893 | no | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `experiment-capture` | `<div>` | 3120 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `experiment-clear` | `<button>` | 3132 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `experiment-export-csv` | `<button>` | 3130 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `experiment-export-json` | `<button>` | 3131 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `experiment-run-label` | `<input>` | 3124 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `experiment-run-notes` | `<input>` | 3125 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `experiment-run-span` | `<span>` | 3134 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `experiment-sample-count` | `<span>` | 3134 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `experiment-start` | `<button>` | 3128 | no | verify-project | Zone 4 (Right Inspector / Contextual) | OPS |
| `experiment-status` | `<strong>` | 3134 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `experiment-stop` | `<button>` | 3129 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `flow-acn-role` | `<span>` | 3005 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `flow-dest-count` | `<small>` | 3014 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `flow-downlink-label` | `<span>` | 3008 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `flow-downlink-line` | `<div>` | 3009 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `flow-downlink-status` | `<span>` | 3010 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `flow-node-dest` | `<div>` | 3012 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `flow-node-relay` | `<div>` | 3002 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `flow-node-source` | `<div>` | 2992 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `flow-node-source-rate` | `<span>` | 2995 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `flow-node-source-role` | `<small>` | 2994 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `flow-node-source-title` | `<strong>` | 2993 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `flow-uplink-label` | `<span>` | 2998 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `flow-uplink-line` | `<div>` | 2999 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `flow-uplink-snr` | `<span>` | 3000 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `folder-patch-controls` | `<div>` | 4055 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `fp-cfit-badge` | `<span>` | 3530 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `fp-cruise-alt-input` | `<input>` | 3547 | YES | verifyFlightPlannerUpgrade | Zone 4 (Right Inspector) | PLAN_AI |
| `fp-cruise-speed-input` | `<input>` | 3551 | YES | verifyFlightPlannerUpgrade | Zone 4 (Right Inspector) | PLAN_AI |
| `fp-dist-km` | `<b>` | 3580 | YES | verifyFlightPlannerUpgrade | Zone 4 (Right Inspector) | PLAN_AI |
| `fp-los-coverage` | `<b>` | 3600 | YES | verifyFlightPlannerUpgrade | Zone 4 (Right Inspector) | PLAN_AI |
| `fp-min-agl` | `<b>` | 3588 | YES | verifyFlightPlannerUpgrade | Zone 4 (Right Inspector) | PLAN_AI |
| `fp-min-turn-radius` | `<b>` | 3596 | YES | verifyFlightPlannerUpgrade | Zone 4 (Right Inspector) | PLAN_AI |
| `fp-pattern-desc` | `<div>` | 3557 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `fp-pattern-select` | `<select>` | 3538 | YES | verifyFlightPlannerUpgrade | Zone 4 (Right Inspector) | PLAN_AI |
| `fp-peak-bank` | `<b>` | 3592 | YES | verifyFlightPlannerUpgrade | Zone 4 (Right Inspector) | PLAN_AI |
| `fp-period-s` | `<b>` | 3584 | YES | verifyFlightPlannerUpgrade | Zone 4 (Right Inspector) | PLAN_AI |
| `fp-vertical-profile-canvas` | `<canvas>` | 3572 | YES | verifyFlightPlannerUpgrade | Zone 4 (Right Inspector) | PLAN_AI |
| `frame-display` | `<span>` | 967 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `gantt-canvas` | `<canvas>` | 2164 | no | — | Zone 4 (Right Inspector) | MAC_NET |
| `gantt-canvas-wrap` | `<div>` | 2162 | no | — | Zone 4 (Right Inspector) | MAC_NET |
| `glance-rate` | `<b>` | 1757 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `glance-slant` | `<b>` | 1755 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `glance-snr` | `<b>` | 1756 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `historical-banner-summary` | `<span>` | 1001 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `historical-mode-banner` | `<div>` | 998 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `inventory-nodes-count` | `<span>` | 2772 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `inventory-selected-pill` | `<span>` | 2774 | YES | verify-browser-ux | Zone 4 (Right Inspector / Contextual) | OPS |
| `iq-constellation-canvas` | `<canvas>` | 2733 | YES | verifyVsaConstellationUpgrade | Zone 4 (Right Inspector) | RF_PHY |
| `itu-waterfall-panel` | `<div>` | 2571 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `kpi-drop-reduc-badge` | `<span>` | 1675 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `kpi-gain-badge` | `<span>` | 1637 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `kpi-stat-drop` | `<div>` | 1679 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `kpi-stat-tx` | `<div>` | 1641 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `kpi-stat-waste` | `<div>` | 1660 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `kpi-tac-drop` | `<div>` | 1678 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `kpi-tac-rate` | `<span>` | 1648 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `kpi-tac-tx` | `<div>` | 1640 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `kpi-tac-waste` | `<div>` | 1659 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `kpi-util-stat` | `<span>` | 1686 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `kpi-waste-mb` | `<span>` | 1667 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `kpi-waste-saved-badge` | `<span>` | 1656 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `label-mesh-res` | `<span>` | 1436 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `latex-export-preview` | `<pre>` | 2154 | YES | verifyPublicationEcdfAndLatex | Zone 4 (Right Inspector) | LAB |
| `lb-bulge` | `<b>` | 2538 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lb-diff` | `<b>` | 2543 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lb-fspl` | `<b>` | 2542 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lb-gas` | `<b>` | 2544 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lb-pnoise` | `<b>` | 2533 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lb-prx` | `<b>` | 2532 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lb-rain` | `<b>` | 2545 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lb-se` | `<b>` | 2531 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lb-slant` | `<b>` | 2537 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lb-snr` | `<b>` | 2530 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lbl-alt` | `<b>` | 2553 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lbl-bw` | `<b>` | 2551 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lbl-cov` | `<b>` | 2554 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lbl-freq` | `<b>` | 2550 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lbl-rain` | `<b>` | 2552 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lbl-sci-dem-error` | `<label>` | 2056 | no | — | Zone 4 (Right Inspector) | RF_PHY |
| `lbl-sci-fading-cqi` | `<label>` | 2099 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lbl-sci-jammer-select` | `<label>` | 2074 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lbl-sci-relay-select` | `<label>` | 2087 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `lbl-sci-traffic-scale` | `<label>` | 2063 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `lbl-terrain-node-agl` | `<b>` | 2556 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `link-modcod-tag` | `<span>` | 2527 | no | — | Zone 4 (Right Inspector) | MAC_NET |
| `link-waterfall-canvas` | `<canvas>` | 2578 | YES | verifyScientificInstruments, verifyUiMakeoverAnd3dPerf | Zone 4 (Right Inspector) | RF_PHY |
| `main-workspace` | `<main>` | 1074 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `map-active-tool-bar` | `<div>` | 1490 | YES | verifyIntuitiveToolboxUx | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `map-chrome-mode-badge` | `<span>` | 1446 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `map-mode-toggle` | `<div>` | 1420 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `map-node-action-status` | `<div>` | 1569 | no | verify-browser-ux | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `map-node-detail-content` | `<div>` | 1563 | YES | verifyTimelineCorrective, verify-browser-ux | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `map-node-details` | `<aside>` | 1558 | YES | verify-browser-ux | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `map-node-tooltip` | `<div>` | 1489 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `map-renderer-notice` | `<div>` | 1534 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `map-resize-handle` | `<div>` | 1117 | YES | verify-project | Zone 3 (Center Viewport Theater) | ALL |
| `maplibre-map` | `<div>` | 1487 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `maplibre-stage` | `<div>` | 1486 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `mesh-res-group` | `<div>` | 1434 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `mesh-res-toggle` | `<div>` | 1437 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `network-aggregate-card` | `<div>` | 2313 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-aggregate-chart` | `<canvas>` | 2313 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-aggregate-value` | `<b>` | 2313 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-clear` | `<button>` | 2306 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-dashboard-empty` | `<div>` | 2308 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-dashboard-state` | `<span>` | 2281 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-individual-card` | `<div>` | 2312 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-individual-chart` | `<canvas>` | 2312 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-individual-value` | `<b>` | 2312 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-node-select` | `<select>` | 2289 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `network-pause` | `<button>` | 2305 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-show-rate` | `<input>` | 2294 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-show-snr` | `<input>` | 2293 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-show-transferred` | `<input>` | 2295 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-time-range` | `<select>` | 2298 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-traffic-table` | `<table>` | 3052 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-traffic-tbody` | `<tbody>` | 3069 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `network-view-mode` | `<select>` | 2283 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `node-agl-feedback` | `<span>` | 2655 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-agl-input` | `<input>` | 2652 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-editor-form` | `<div>` | 2786 | YES | verify-browser-ux | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-editor-title` | `<div>` | 2787 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-input-agl` | `<input>` | 2810 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-input-battery-capacity` | `<input>` | 2818 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-input-battery-level` | `<input>` | 2822 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-input-callsign` | `<input>` | 2791 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-input-color` | `<input>` | 2830 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-input-priority` | `<input>` | 2826 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-input-role` | `<select>` | 2795 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-input-tx-power` | `<input>` | 2814 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-input-x` | `<input>` | 2802 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-input-y` | `<input>` | 2806 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `node-inventory-feedback` | `<div>` | 2785 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `ntn-crnti-readout` | `<span>` | 2415 | YES | verifyNtnRachSignalingUpgrade | Zone 4 (Right Inspector) | MAC_NET |
| `ntn-node-select` | `<select>` | 2411 | YES | verifyComprehensive51PointUxPolish, verifyNtnRachSignalingUpgrade | Zone 4 (Right Inspector) | MAC_NET |
| `ntn-rach-latency-readout` | `<span>` | 2416 | YES | verifyNtnRachSignalingUpgrade | Zone 4 (Right Inspector) | MAC_NET |
| `ntn-rrc-state-badge` | `<span>` | 2414 | YES | verifyNtnRachSignalingUpgrade | Zone 4 (Right Inspector) | MAC_NET |
| `ntn-signaling-canvas` | `<canvas>` | 2429 | YES | verifyNtnRachSignalingUpgrade | Zone 4 (Right Inspector) | MAC_NET |
| `ntn-signaling-panel` | `<div>` | 2403 | YES | verifyNtnRachSignalingUpgrade | Zone 4 (Right Inspector) | MAC_NET |
| `ntn-ta-cmd-readout` | `<span>` | 2417 | YES | verifyNtnRachSignalingUpgrade | Zone 4 (Right Inspector) | MAC_NET |
| `obstacle-add` | `<button>` | 3825 | YES | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-apply` | `<button>` | 3841 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-cancel` | `<button>` | 3842 | YES | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-commit-label` | `<small>` | 3816 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-delete` | `<button>` | 3840 | YES | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-depth` | `<input>` | 3834 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-depth-label` | `<label>` | 3834 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-editor-message` | `<div>` | 3844 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-height` | `<input>` | 3836 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-list` | `<div>` | 3829 | YES | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-lock-note` | `<div>` | 3846 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-map-tool` | `<button>` | 1465 | YES | verifyComprehensive51PointUxPolish | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-obstruction-summary` | `<div>` | 3845 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-place` | `<button>` | 3826 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-radius` | `<input>` | 3835 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-radius-label` | `<label>` | 3835 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-rotation` | `<input>` | 3837 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-rotation-label` | `<label>` | 3837 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-select-mode` | `<button>` | 3827 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-shape` | `<select>` | 3820 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-width` | `<input>` | 3833 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-width-label` | `<label>` | 3833 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-x` | `<input>` | 3831 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `obstacle-y` | `<input>` | 3832 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `overview-event-list` | `<ol>` | 1832 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `overview-goodput-canvas` | `<canvas>` | 1826 | YES | — | Zone 4 (Bottom Timeline & Dock) | ALL |
| `overview-narrative` | `<span>` | 1126 | YES | verify-browser-ux | Zone 4 (Right Inspector) | LAB |
| `overview-state-badge` | `<span>` | 1741 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `overview-subview-authoring` | `<div>` | 3518 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `overview-subview-ops` | `<div>` | 1596 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `overview-trend-sample-count` | `<span>` | 1830 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `param-alt` | `<input>` | 2553 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `param-bw` | `<input>` | 2551 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `param-cov` | `<input>` | 2554 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `param-freq` | `<input>` | 2550 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `param-rain` | `<input>` | 2552 | YES | verifyTerrainToolboxSci | Zone 4 (Right Inspector / Contextual) | OPS |
| `pdu-bar-c2` | `<div>` | 2197 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-bar-framing` | `<div>` | 2196 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-bar-padding` | `<div>` | 2201 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-bar-photo` | `<div>` | 2200 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-bar-video` | `<div>` | 2199 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-bar-voice` | `<div>` | 2198 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-byte-bar` | `<div>` | 2195 | no | verifyTdmaLogicAnalyzerDissector | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-capacity-readout` | `<span>` | 2193 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-dissector-panel` | `<div>` | 2179 | YES | verifyTdmaLogicAnalyzerDissector | Zone 4 (Bottom Timeline & Dock) | ALL |
| `pdu-hex-dump` | `<pre>` | 2251 | YES | verifyTdmaLogicAnalyzerDissector | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-layer1-phy` | `<div>` | 2215 | no | verifyTdmaLogicAnalyzerDissector | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-layer2-mac` | `<div>` | 2225 | no | verifyTdmaLogicAnalyzerDissector | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-layer3-sched` | `<div>` | 2236 | no | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-leg-c2` | `<span>` | 2205 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-leg-framing` | `<span>` | 2204 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-leg-padding` | `<span>` | 2209 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-leg-photo` | `<span>` | 2208 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-leg-video` | `<span>` | 2207 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-leg-voice` | `<span>` | 2206 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-mac-c2` | `<span>` | 2229 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-mac-framing` | `<span>` | 2228 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-mac-padding` | `<span>` | 2233 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-mac-photo` | `<span>` | 2232 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-mac-video` | `<span>` | 2231 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-mac-voice` | `<span>` | 2230 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-phy-cap` | `<span>` | 2222 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-phy-modcod` | `<span>` | 2221 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-phy-sector` | `<span>` | 2220 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-phy-ta` | `<span>` | 2219 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-phy-window` | `<span>` | 2218 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-sched-mode` | `<span>` | 2240 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-sched-range` | `<span>` | 2242 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-sched-snr` | `<span>` | 2243 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-sched-status` | `<span>` | 2241 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-sched-type` | `<span>` | 2239 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `pdu-slot-subhead` | `<span>` | 2183 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `persistent-map-mount` | `<div>` | 1076 | YES | verify-project | Zone 3 (Center Viewport Theater) | ALL |
| `persistent-map-panel` | `<aside>` | 1075 | YES | — | Zone 3 (Center Viewport Theater) | ALL |
| `polar-antenna-canvas` | `<canvas>` | 1961 | YES | verifyScientificInstruments, verifyUiMakeoverAnd3dPerf | Zone 4 (Right Inspector) | RF_PHY |
| `polar-scope-readout` | `<div>` | 1965 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `prof-controls-strip` | `<div>` | 2471 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `prof-physics-readout` | `<div>` | 2483 | YES | verifyPathProfileRefractivity | Zone 4 (Right Inspector / Contextual) | OPS |
| `prof-refractivity-select` | `<select>` | 2474 | no | verifyPathProfileRefractivity | Zone 4 (Right Inspector) | RF_PHY |
| `prof-toggle-fresnel-orders` | `<button>` | 2481 | YES | verifyPathProfileRefractivity | Zone 4 (Right Inspector / Contextual) | OPS |
| `profile-canvas` | `<canvas>` | 2489 | YES | — | Zone 4 (Right Inspector) | RF_PHY |
| `profile-canvas-container` | `<div>` | 2487 | no | — | Zone 4 (Right Inspector) | RF_PHY |
| `qbar-65` | `<div>` | 2660 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `qbar-67` | `<div>` | 2661 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `qbar-69` | `<div>` | 2659 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `qbar-70` | `<div>` | 2662 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `qos-jains-fairness` | `<span>` | 2325 | YES | verifyQosSlaAndFairness | Zone 4 (Right Inspector) | MAC_NET |
| `qos-overall-sla` | `<span>` | 2326 | YES | verifyQosSlaAndFairness | Zone 4 (Right Inspector) | MAC_NET |
| `qos-sla-canvas` | `<canvas>` | 2339 | YES | verifyQosSlaAndFairness | Zone 4 (Right Inspector) | MAC_NET |
| `qos-sla-panel` | `<div>` | 2318 | YES | verifyQosSlaAndFairness | Zone 4 (Right Inspector) | MAC_NET |
| `qos-sla-table-body` | `<tbody>` | 2356 | YES | verifyQosSlaAndFairness | Zone 4 (Right Inspector) | MAC_NET |
| `qos-total-backlog` | `<span>` | 2327 | YES | verifyQosSlaAndFairness | Zone 4 (Right Inspector) | MAC_NET |
| `quick-node-agl-feedback` | `<span>` | 1751 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `quick-node-agl-input` | `<input>` | 1750 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `quickNodeSelect` | `<select>` | 1744 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `qval-65` | `<output>` | 2660 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `qval-67` | `<output>` | 2661 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `qval-69` | `<output>` | 2659 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `qval-70` | `<output>` | 2662 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `radar-canvas` | `<canvas>` | 1485 | YES | verifyUiMakeoverAnd3dPerf, capture_live_redesign_screenshots, verify-browser-ux | Zone 3 (Center Viewport Theater) | ALL |
| `radar-container` | `<div>` | 1484 | YES | verifyNtnRachSignalingUpgrade, verifyPathProfileRefractivity, verifyPrecisionAoSwathTool3 (+7 more) | Zone 3 (Center Viewport Theater) | ALL |
| `radar-cursor-hud` | `<div>` | 1530 | YES | verify-browser-ux | Zone 3 (Center Viewport Theater) | ALL |
| `radar-hud-locked-pill` | `<div>` | 1533 | YES | verify-browser-ux | Zone 3 (Center Viewport Theater) | ALL |
| `radar-stage` | `<div>` | 1406 | YES | verify-browser-ux | Zone 3 (Center Viewport Theater) | ALL |
| `registration-empty` | `<div>` | 2433 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `registration-events` | `<tbody>` | 2434 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `registration-sim-time` | `<b>` | 2397 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `registration-summary` | `<div>` | 2400 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `registration-table` | `<table>` | 2433 | no | verifyComprehensive51PointUxPolish | Zone 4 (Right Inspector) | MAC_NET |
| `relay-active-stats` | `<b>` | 2521 | no | verifyActiveTwoHopRelay | Zone 4 (Right Inspector / Contextual) | OPS |
| `relay-advisor-panel` | `<div>` | 2495 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `relay-advisor-status-badge` | `<span>` | 2499 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `relay-ground-cov` | `<b>` | 2517 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `relay-optimal-pos` | `<b>` | 2509 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `relay-orbit-avail` | `<b>` | 2513 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-abstract` | `<section>` | 3200 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-appendix` | `<section>` | 3382 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-config` | `<section>` | 3321 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-engine` | `<section>` | 3224 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-history` | `<section>` | 3316 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-limitations` | `<section>` | 3490 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-methodology` | `<section>` | 3338 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-queues` | `<section>` | 3290 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-rf` | `<section>` | 3259 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-scheduler` | `<section>` | 3268 | no | — | Zone 4 (Right Inspector) | MAC_NET |
| `report-standards` | `<section>` | 3366 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-system` | `<section>` | 3207 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-terrain` | `<section>` | 3247 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-trajectory` | `<section>` | 3235 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `report-verification` | `<section>` | 3478 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `report-visualization` | `<section>` | 3309 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `rf-evicted-notice` | `<div>` | 2445 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `rt-headroom-readout` | `<strong>` | 3150 | YES | verifyWorkerJitterAndDossierUpgrade | Zone 4 (Right Inspector / Contextual) | OPS |
| `rt-jitter-readout` | `<strong>` | 3151 | YES | — | Zone 4 (Right Inspector) | LAB |
| `rt-p50-p95-readout` | `<strong>` | 3149 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `rt-profiler-heading` | `<h3>` | 3142 | no | — | Zone 4 (Right Inspector) | RF_PHY |
| `rt-profiler-panel` | `<div>` | 3139 | YES | verifyWorkerJitterAndDossierUpgrade | Zone 4 (Right Inspector) | RF_PHY |
| `rt-status-text` | `<strong>` | 3152 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `rt-verdict-badge` | `<span>` | 3145 | YES | verifyWorkerJitterAndDossierUpgrade | Zone 4 (Right Inspector / Contextual) | OPS |
| `sched-chart-backlog` | `<canvas>` | 1873 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `sched-chart-utilization` | `<canvas>` | 1864 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `sched-charts-panel` | `<div>` | 1852 | no | — | Zone 4 (Right Inspector) | MAC_NET |
| `sched-evicted-notice` | `<div>` | 1849 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `sched-snapshot-badge` | `<span>` | 1883 | no | — | Zone 4 (Right Inspector) | MAC_NET |
| `sched-snapshot-panel` | `<div>` | 1880 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `scheduler-quick-toggle` | `<button>` | 1605 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `sci-ablation-panel` | `<div>` | 2042 | no | — | Zone 4 (Right Inspector) | LAB |
| `sci-ablation-table` | `<table>` | 2114 | no | verifyScientificInstruments | Zone 4 (Right Inspector) | LAB |
| `sci-dem-error-slider` | `<input>` | 2059 | YES | verifyScientificInstruments | Zone 4 (Right Inspector) | RF_PHY |
| `sci-dem-error-val` | `<b>` | 2057 | YES | — | Zone 4 (Right Inspector) | RF_PHY |
| `sci-fading-cqi-readout` | `<span>` | 2108 | no | verifyRicianFadingAndCqiAging | Zone 4 (Right Inspector / Contextual) | OPS |
| `sci-fading-cqi-select` | `<select>` | 2101 | YES | verifyRicianFadingAndCqiAging | Zone 4 (Right Inspector / Contextual) | OPS |
| `sci-jammer-select` | `<select>` | 2076 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sci-jammer-shield-readout` | `<span>` | 2082 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sci-relay-readout` | `<span>` | 2094 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sci-relay-select` | `<select>` | 2089 | YES | verifyActiveTwoHopRelay | Zone 4 (Right Inspector / Contextual) | OPS |
| `sci-sweep-active-readout` | `<div>` | 2034 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sci-sweep-axis-select` | `<select>` | 2014 | YES | verify3dParityAndSensitivitySweep | Zone 4 (Right Inspector / Contextual) | OPS |
| `sci-traffic-scale-select` | `<select>` | 2065 | YES | verifyScientificInstruments | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `sector-array-panel` | `<div>` | 1922 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-attitude-badge` | `<span>` | 1925 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-card-0` | `<div>` | 1928 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-card-1` | `<div>` | 1935 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-card-2` | `<div>` | 1942 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-card-3` | `<div>` | 1949 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-cards-grid` | `<div>` | 1927 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-s0-nodes` | `<strong>` | 1930 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-s0-rate` | `<span>` | 1932 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-s0-util` | `<b>` | 1932 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-s1-nodes` | `<strong>` | 1937 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-s1-rate` | `<span>` | 1939 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-s1-util` | `<b>` | 1939 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-s2-nodes` | `<strong>` | 1944 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-s2-rate` | `<span>` | 1946 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-s2-util` | `<b>` | 1946 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-s3-nodes` | `<strong>` | 1951 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-s3-rate` | `<span>` | 1953 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sector-s3-util` | `<b>` | 1953 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sensitivity-sweep-canvas` | `<canvas>` | 2024 | YES | verify3dParityAndSensitivitySweep, verifyUiMakeoverAnd3dPerf | Zone 4 (Right Inspector) | RF_PHY |
| `sensitivity-sweep-panel` | `<div>` | 2006 | no | — | Zone 4 (Right Inspector) | RF_PHY |
| `sep-mesh-res` | `<span>` | 1435 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sim-achieved-readout` | `<span>` | 990 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `sim-speed-input` | `<input>` | 992 | YES | — | Zone 1 (Top Command Strip) | ALL |
| `sim-speed-readout` | `<span>` | 989 | YES | verifyComprehensive51PointUxPolish, verify-browser-ux | Zone 1 (Top Command Strip) | ALL |
| `sim-speed-slider` | `<input>` | 991 | YES | — | Zone 1 (Top Command Strip) | ALL |
| `sim-timeline-canvas` | `<canvas>` | 1112 | YES | — | Zone 4 (Bottom Timeline & Dock) | ALL |
| `sim-timeline-inspector-container` | `<div>` | 1114 | YES | — | Zone 4 (Bottom Timeline & Dock) | ALL |
| `sim-timeline-panel` | `<div>` | 1077 | YES | verify-browser-ux | Zone 4 (Bottom Timeline & Dock) | ALL |
| `sim-timeline-resize-handle` | `<div>` | 1078 | YES | verify-browser-ux | Zone 4 (Bottom Timeline & Dock) | ALL |
| `situation-strip` | `<div>` | 1126 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `snap-backlog` | `<strong>` | 1908 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `snap-cum-drops` | `<strong>` | 1916 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `snap-cum-goodput` | `<strong>` | 1912 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `snap-drops` | `<strong>` | 1904 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `snap-goodput` | `<strong>` | 1900 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `snap-mode` | `<strong>` | 1892 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `snap-time` | `<strong>` | 1888 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `snap-util` | `<strong>` | 1896 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `soldier-eud-phone-frame` | `<div>` | 3885 | no | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `soldier-phone-canvas` | `<canvas>` | 3920 | YES | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `tab-authoring` | `<section>` | 3513 | no | verifyFlightPlannerUpgrade, verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `tab-btn-authoring` | `<button>` | 1041 | no | verify-browser-ux | Zone 1 (Top Command Strip) | ALL |
| `tab-btn-doc` | `<button>` | 1046 | no | — | Zone 1 (Top Command Strip) | ALL |
| `tab-btn-network` | `<button>` | 1026 | no | — | Zone 1 (Top Command Strip) | ALL |
| `tab-btn-overview` | `<button>` | 1016 | no | verify-browser-ux | Zone 1 (Top Command Strip) | ALL |
| `tab-btn-registration` | `<button>` | 1051 | no | — | Zone 1 (Top Command Strip) | ALL |
| `tab-btn-scheduler` | `<button>` | 1021 | no | — | Zone 1 (Top Command Strip) | ALL |
| `tab-btn-soldier` | `<button>` | 1056 | no | verifyEdgeAiCopilotAndSoldierPhone | Zone 1 (Top Command Strip) | ALL |
| `tab-btn-terminal` | `<button>` | 1036 | no | verify-browser-ux | Zone 1 (Top Command Strip) | ALL |
| `tab-btn-terrain` | `<button>` | 1031 | no | — | Zone 1 (Top Command Strip) | ALL |
| `tab-diagnostics` | `<section>` | 3088 | no | verifyWorkerJitterAndDossierUpgrade | Zone 4 (Right Inspector) | LAB |
| `tab-doc` | `<section>` | 3080 | YES | verifyUiMakeoverAnd3dPerf, verify-browser-ux, verify-project | Zone 4 (Right Inspector) | LAB |
| `tab-network` | `<section>` | 2274 | no | verifyQosSlaAndFairness, verifyUiMakeoverAnd3dPerf | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `tab-overview` | `<section>` | 1404 | no | verifyUiMakeoverAnd3dPerf, verify-browser-ux, verify-project | Zone 4 (Right Inspector / Contextual) | OPS |
| `tab-registration` | `<section>` | 2396 | no | verifyNtnRachSignalingUpgrade, verifyUiMakeoverAnd3dPerf, verify-browser-ux | Zone 4 (Right Inspector) | MAC_NET |
| `tab-scheduler` | `<section>` | 1843 | no | verifyTdmaLogicAnalyzerDissector, verifyUiMakeoverAnd3dPerf, verify-project | Zone 4 (Right Inspector) | MAC_NET |
| `tab-soldier` | `<section>` | 3854 | no | verifyEdgeAiCopilotAndSoldierPhone | Zone 4 (Right Inspector) | OPS |
| `tab-terminal` | `<section>` | 2626 | no | verifyUiMakeoverAnd3dPerf, verifyVsaConstellationUpgrade, verify-project | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `tab-terrain` | `<section>` | 2439 | no | verifyPathProfileRefractivity, verifyUiMakeoverAnd3dPerf, verify-project | Zone 4 (Right Inspector / Contextual) | OPS |
| `tailwind-config` | `<script>` | 12 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tally-blocked` | `<b>` | 1123 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tally-connected` | `<b>` | 1121 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tally-degraded` | `<b>` | 1122 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tally-outage` | `<b>` | 1124 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tb-3d-scope-note` | `<div>` | 1395 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-active-tool-title` | `<h2>` | 1133 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-apply-acn-waypoints-btn` | `<button>` | 12332 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-backdrop-mode` | `<select>` | 1182 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-bar-exit` | `<button>` | 1496 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-bar-obstacle` | `<button>` | 1494 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-bar-probe` | `<button>` | 1492 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-bar-region` | `<button>` | 1493 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-bar-transect` | `<button>` | 1491 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-bridge-a-btn` | `<button>` | 1315 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-bridge-add-node-btn` | `<button>` | 12425 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-bridge-agl` | `<input>` | 1318 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-bridge-b-btn` | `<button>` | 1316 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-bridge-clear-btn` | `<button>` | 1320 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-bridge-find-btn` | `<button>` | 1319 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-dem-provenance` | `<div>` | 1190 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-drawer-content` | `<div>` | 1399 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-export-csv-btn` | `<button>` | 12333 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-export-geojson-btn` | `<button>` | 12414 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-navigate-btn` | `<button>` | 1146 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-obs-cad-metrics` | `<span>` | 1370 | YES | verifyPrecisionCadObstacleTool4 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-obs-clear-btn` | `<button>` | 1365 | YES | verifyPrecisionCadObstacleTool4, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-obs-list` | `<div>` | 1389 | YES | verifyPrecisionCadObstacleTool4, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-obs-material-select` | `<select>` | 1355 | YES | verifyPrecisionCadObstacleTool4, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-obs-place-btn` | `<button>` | 1362 | YES | verifyComprehensive51PointUxPolish, verifyPrecisionCadObstacleTool4, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-obs-redo` | `<button>` | 1364 | YES | verifyPrecisionCadObstacleTool4, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-obs-shape-select` | `<select>` | 1347 | YES | verifyPrecisionCadObstacleTool4, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-obs-slice-summary` | `<span>` | 1371 | YES | verifyPrecisionCadObstacleTool4 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-obs-target-node-select` | `<select>` | 1380 | YES | verifyPrecisionCadObstacleTool4 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-obs-undo` | `<button>` | 1363 | YES | verifyPrecisionCadObstacleTool4, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-open-terrain-rf-btn` | `<button>` | 12331 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-outside-dem-badge` | `<div>` | 1191 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-pane-dem` | `<div>` | 1173 | no | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-pane-obstacle` | `<div>` | 1344 | no | verifyPrecisionCadObstacleTool4, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-pane-probe` | `<div>` | 1252 | no | verifyPrecisionCursorProbeTool2, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-pane-region` | `<div>` | 1306 | no | verifyPrecisionAoSwathTool3, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-pane-transect` | `<div>` | 1195 | no | verifyIntuitiveToolboxUx, verifyPrecisionGeodeticRuler, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-picking-bar` | `<div>` | 1523 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-picking-cancel-btn` | `<button>` | 1526 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-picking-finish-btn` | `<button>` | 1525 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-picking-label` | `<span>` | 1524 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-polar-canvas` | `<canvas>` | 12376 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-acn-el` | `<span>` | 1292 | no | verifyPrecisionCursorProbeTool2, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-acn-los` | `<span>` | 1293 | no | verifyPrecisionCursorProbeTool2, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-acn-modcod` | `<span>` | 1295 | no | verifyPrecisionCursorProbeTool2, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-acn-range` | `<span>` | 1291 | no | verifyPrecisionCursorProbeTool2, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-acn-sinr` | `<span>` | 1294 | no | verifyPrecisionCursorProbeTool2, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-agl` | `<input>` | 1261 | YES | verifyPrecisionCursorProbeTool2 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-clear-btn` | `<button>` | 1255 | YES | verifyPrecisionCursorProbeTool2, verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-delta-pin` | `<span>` | 1298 | no | verifyPrecisionCursorProbeTool2 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-horizon-mask` | `<span>` | 1296 | no | verifyPrecisionCursorProbeTool2 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-mast-input` | `<input>` | 1259 | YES | verifyPrecisionCursorProbeTool2 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-obstacles` | `<input>` | 1270 | YES | verifyPrecisionCursorProbeTool2 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-pick-btn` | `<button>` | 1254 | YES | verifyPrecisionCursorProbeTool2, verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-radius` | `<input>` | 1263 | YES | verifyPrecisionCursorProbeTool2 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-sector-bore` | `<span>` | 1297 | no | verifyPrecisionCursorProbeTool2 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-spawn-node` | `<button>` | 1301 | YES | verifyPrecisionCursorProbeTool2, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-target` | `<select>` | 1264 | YES | verifyPrecisionCursorProbeTool2, verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-probe-unit-select` | `<select>` | 1280 | YES | verifyPrecisionCursorProbeTool2 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-add-node-btn` | `<button>` | 12413 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-area` | `<span>` | 1326 | no | verifyPrecisionAoSwathTool3 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-bounds` | `<span>` | 1325 | no | verifyPrecisionAoSwathTool3 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-canvas` | `<canvas>` | 1340 | no | verifyPrecisionAoSwathTool3 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-dimensions` | `<span>` | 1324 | no | verifyPrecisionAoSwathTool3 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-live-area` | `<span>` | 1311 | no | verifyPrecisionAoSwathTool3 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-los-pct` | `<span>` | 1333 | no | verifyPrecisionAoSwathTool3, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-mean` | `<span>` | 1329 | no | verifyPrecisionAoSwathTool3 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-minmax` | `<span>` | 1330 | no | verifyPrecisionAoSwathTool3 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-ruggedness` | `<span>` | 1332 | no | verifyPrecisionAoSwathTool3, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-sinr-stats` | `<span>` | 1334 | no | verifyPrecisionAoSwathTool3 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-std` | `<span>` | 1331 | no | verifyPrecisionAoSwathTool3 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-summit` | `<span>` | 1327 | no | verifyPrecisionAoSwathTool3, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-region-valley-floor` | `<span>` | 1328 | no | verifyPrecisionAoSwathTool3 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-span-readout` | `<span>` | 1145 | no | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-step-guide-banner` | `<div>` | 1139 | YES | verifyIntuitiveToolboxUx | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-sweep-canvas` | `<canvas>` | 12385 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-sweep-target` | `<select>` | 1272 | YES | verifyPrecisionCursorProbeTool2, verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-toggle-contours-layer` | `<input>` | 1188 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-toggle-dem-layer` | `<input>` | 1187 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-tool-dem` | `<button>` | 1150 | no | verifyComprehensive51PointUxPolish | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-tool-obstacle` | `<button>` | 1166 | no | verifyIntuitiveToolboxUx | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-tool-probe` | `<button>` | 1158 | no | verifyIntuitiveToolboxUx | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-tool-region` | `<button>` | 1162 | no | verifyIntuitiveToolboxUx | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-tool-transect` | `<button>` | 1154 | no | verifyIntuitiveToolboxUx | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-azimuth` | `<span>` | 1241 | no | verifyPrecisionGeodeticRuler | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-blocking-peak` | `<span>` | 1243 | no | verifyPrecisionGeodeticRuler | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-canvas` | `<canvas>` | 12319 | YES | verifyPrecisionGeodeticRuler, verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-diffraction` | `<span>` | 1239 | no | verifyPrecisionGeodeticRuler, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-finish-btn` | `<button>` | 1200 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-fresnel` | `<span>` | 1238 | no | verifyPrecisionGeodeticRuler, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-height-a` | `<select>` | 1211 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-height-b` | `<select>` | 1217 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-hover-readout` | `<div>` | 12320 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-k` | `<select>` | 1228 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-node-type` | `<select>` | 1224 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-obstacles` | `<input>` | 1235 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-poly-btn` | `<button>` | 1199 | YES | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-rx-mast` | `<input>` | 1207 | YES | verifyPrecisionGeodeticRuler, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-snr` | `<span>` | 1240 | no | verifyPrecisionGeodeticRuler, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-tx-mast` | `<input>` | 1205 | YES | verifyPrecisionGeodeticRuler, verifyToolboxDeepUpgrade | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tb-transect-vert-angle` | `<span>` | 1242 | no | verifyPrecisionGeodeticRuler | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `tbl-backlog-label` | `<td>` | 2263 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-drop-reduc` | `<td>` | 2261 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-n4-stat` | `<td>` | 2263 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-n4-status` | `<td>` | 2263 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-n4-tac` | `<td>` | 2263 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-p50-gain` | `<td>` | 2264 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-p50-stat` | `<td>` | 2264 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-p50-tac` | `<td>` | 2264 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-p95-gain` | `<td>` | 2265 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-p95-stat` | `<td>` | 2265 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-p95-tac` | `<td>` | 2265 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-stat-drops` | `<td>` | 2261 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-stat-tx` | `<td>` | 2259 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-stat-util` | `<td>` | 2262 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-stat-waste` | `<td>` | 2260 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-tac-drops` | `<td>` | 2261 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-tac-tx` | `<td>` | 2259 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-tac-util` | `<td>` | 2262 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-tac-waste` | `<td>` | 2260 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-tx-gain` | `<td>` | 2259 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-util-delta` | `<td>` | 2262 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tbl-waste-saved` | `<td>` | 2260 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-apply-btn` | `<button>` | 3807 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-authority-label` | `<small>` | 3702 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-bar-ctrl` | `<div>` | 3724 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-bar-dl` | `<div>` | 3725 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-bar-ul` | `<div>` | 3726 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-ctrl-ms` | `<input>` | 3762 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-diag-overhead` | `<b>` | 3743 | YES | — | Zone 4 (Right Inspector) | LAB |
| `tdma-diag-range` | `<b>` | 3739 | YES | — | Zone 4 (Right Inspector) | LAB |
| `tdma-diag-slot` | `<b>` | 3735 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `tdma-diag-ul` | `<b>` | 3731 | YES | — | Zone 4 (Right Inspector) | LAB |
| `tdma-dl-max-ms` | `<input>` | 3772 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-dl-min-ms` | `<input>` | 3767 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-editor-details` | `<details>` | 3701 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-editor-message` | `<div>` | 3810 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-fixed-slots` | `<input>` | 3801 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `tdma-fixed-slots-container` | `<div>` | 3799 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `tdma-frame-ms` | `<input>` | 3756 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-frame-slider` | `<input>` | 3755 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-frame-val` | `<span>` | 3752 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-guard-us` | `<input>` | 3777 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-max-slot-ms` | `<input>` | 3787 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `tdma-min-slot-us` | `<input>` | 3782 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `tdma-policy` | `<select>` | 3792 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-preset-select` | `<select>` | 3707 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-preview-bar` | `<div>` | 3723 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-preview-total-badge` | `<span>` | 3721 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tdma-reset-btn` | `<button>` | 3808 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `term-state-pill` | `<span>` | 2644 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `termNodeSelect` | `<select>` | 2646 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `terminal-inventory-table` | `<table>` | 2839 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `terminal-inventory-tbody` | `<tbody>` | 2858 | YES | verify-browser-ux | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `terminal-search` | `<input>` | 2645 | YES | verify-project | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `terminal-search-status` | `<div>` | 2658 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `terminal-subtab-view-inventory` | `<div>` | 2641 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `terminal-subtab-view-traffic` | `<div>` | 2867 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `terrain-canvas` | `<canvas>` | 2488 | YES | verifyPathProfileTopView | Zone 4 (Right Inspector) | RF_PHY |
| `terrain-clearance-badge` | `<span>` | 2466 | YES | verifyPathProfileTopView | Zone 4 (Right Inspector / Contextual) | OPS |
| `terrain-crest-badge` | `<span>` | 2467 | YES | verifyPathProfileTopView | Zone 4 (Right Inspector / Contextual) | OPS |
| `terrain-fit-btn` | `<button>` | 1175 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `terrain-fit-network-btn` | `<button>` | 1176 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `terrain-measure-btn` | `<button>` | 1197 | YES | verifyPrecisionGeodeticRuler, verify-browser-ux | Zone 4 (Right Inspector / Contextual) | OPS |
| `terrain-measure-clear-btn` | `<button>` | 1201 | YES | verifyPrecisionGeodeticRuler, verify-browser-ux | Zone 4 (Right Inspector / Contextual) | OPS |
| `terrain-node-agl-feedback` | `<span>` | 2563 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `terrain-node-agl-input` | `<input>` | 2560 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `terrain-node-label` | `<span>` | 2452 | YES | verifyPathProfileTopView | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `terrain-profile-panel` | `<div>` | 2448 | no | verifyPathProfileTopView | Zone 4 (Right Inspector) | RF_PHY |
| `terrain-region-btn` | `<button>` | 1308 | YES | verifyPrecisionAoSwathTool3, verify-browser-ux | Zone 4 (Right Inspector / Contextual) | OPS |
| `terrain-region-cancel-btn` | `<button>` | 1310 | YES | verifyPrecisionAoSwathTool3 | Zone 4 (Right Inspector / Contextual) | OPS |
| `terrain-region-finish-btn` | `<button>` | 1309 | YES | verifyPrecisionAoSwathTool3 | Zone 4 (Right Inspector / Contextual) | OPS |
| `terrain-toolbox` | `<div>` | 1129 | YES | verifyComprehensive51PointUxPolish, verifyIntuitiveToolboxUx, verifyTerrainToolboxSci (+1 more) | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `terrain-toolbox-close` | `<button>` | 1136 | YES | verifyIntuitiveToolboxUx, verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `terrain-toolbox-close-btn` | `<button>` | 1147 | YES | verifyIntuitiveToolboxUx, verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `terrain-toolbox-drawer` | `<div>` | 1398 | YES | verifyTerrainToolboxSci, verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `terrain-toolbox-panel` | `<div>` | 1142 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `terrain-toolbox-regions` | `<div>` | 1313 | YES | verifyPrecisionAoSwathTool3 | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `terrain-toolbox-stack` | `<div>` | 1498 | YES | verifyTerrainToolboxSci, verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `terrain-toolbox-status` | `<div>` | 1394 | no | — | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `terrain-toolbox-toggle-btn` | `<button>` | 1500 | YES | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `terrain-view-toggle` | `<div>` | 2456 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `terrain-zoom-in-btn` | `<button>` | 1178 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `terrain-zoom-label` | `<span>` | 2453 | YES | verifyPathProfileTopView | Zone 4 (Right Inspector / Contextual) | OPS |
| `terrain-zoom-out-btn` | `<button>` | 1177 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `terrainFileInput` | `<input>` | 4045 | no | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `terrainFolderInput` | `<input>` | 4046 | no | verify-browser-ux | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `three-canvas` | `<canvas>` | 1536 | YES | — | Zone 3 (Center Viewport Theater) | ALL |
| `three-stage-container` | `<div>` | 1535 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `three-terrain-badge` | `<span>` | 1538 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `three-terrain-dot` | `<span>` | 1539 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `three-terrain-status-text` | `<span>` | 1540 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `timeline-btn-collapse` | `<button>` | 1106 | YES | verify-browser-ux | Zone 4 (Bottom Timeline & Dock) | ALL |
| `timeline-btn-export-csv` | `<button>` | 1102 | YES | verifyComprehensive51PointUxPolish | Zone 4 (Bottom Timeline & Dock) | ALL |
| `timeline-btn-fit` | `<button>` | 1101 | YES | — | Zone 4 (Bottom Timeline & Dock) | ALL |
| `timeline-btn-live` | `<button>` | 1091 | YES | verifyComprehensive51PointUxPolish | Zone 4 (Bottom Timeline & Dock) | ALL |
| `timeline-btn-play` | `<button>` | 1081 | YES | — | Zone 4 (Bottom Timeline & Dock) | ALL |
| `timeline-btn-step-back` | `<button>` | 1085 | YES | — | Zone 1 (Top Command Strip) | ALL |
| `timeline-btn-step-fwd` | `<button>` | 1088 | YES | — | Zone 1 (Top Command Strip) | ALL |
| `timeline-btn-toggle-expand` | `<button>` | 1103 | YES | — | Zone 4 (Bottom Timeline & Dock) | ALL |
| `timeline-btn-zoom-in` | `<button>` | 1095 | YES | — | Zone 4 (Bottom Timeline & Dock) | ALL |
| `timeline-btn-zoom-out` | `<button>` | 1098 | YES | — | Zone 4 (Bottom Timeline & Dock) | ALL |
| `timeline-time-display` | `<div>` | 1093 | YES | verify-browser-ux | Zone 4 (Bottom Timeline & Dock) | ALL |
| `toggle-viewshed-heatmap` | `<button>` | 1444 | YES | verify3dParityAndSensitivitySweep | Zone 2 (Left Tool Rail & Drawer) | OPS / RF_PHY / PLAN_AI |
| `topbar-agg-thruput` | `<span>` | 971 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `topbar-ew-threat` | `<span>` | 979 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `topbar-jitter` | `<span>` | 975 | no | — | Zone 4 (Right Inspector) | LAB |
| `traffic-agg-deliveries` | `<b>` | 2905 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-agg-dl-rate` | `<b>` | 2895 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-agg-links` | `<b>` | 2900 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-agg-lost` | `<b>` | 2910 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-agg-min-snr` | `<small>` | 2916 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-agg-phase` | `<span>` | 2875 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-agg-rx` | `<b>` | 2885 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-agg-snr` | `<b>` | 2915 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-agg-tx` | `<b>` | 2880 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-agg-ul-rate` | `<b>` | 2890 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-direction-filter` | `<select>` | 3037 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-flow-mode-badge` | `<span>` | 2989 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-flow-narrative` | `<div>` | 3018 | YES | — | Zone 4 (Right Inspector) | LAB |
| `traffic-node-availability` | `<b>` | 2971 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `traffic-node-deliveries` | `<b>` | 2961 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `traffic-node-dl-rate` | `<b>` | 2956 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `traffic-node-links` | `<b>` | 2976 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `traffic-node-modcod` | `<small>` | 2967 | YES | — | Zone 4 (Right Inspector) | MAC_NET |
| `traffic-node-role-badge` | `<span>` | 2928 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `traffic-node-rx` | `<b>` | 2946 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `traffic-node-select` | `<select>` | 2934 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `traffic-node-snr` | `<b>` | 2966 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `traffic-node-status-badge` | `<span>` | 2930 | YES | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `traffic-node-tx` | `<b>` | 2941 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `traffic-node-ul-rate` | `<b>` | 2951 | no | — | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `traffic-search-input` | `<input>` | 3036 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-status-filter` | `<select>` | 3042 | YES | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traffic-table-count` | `<span>` | 3029 | no | — | Zone 4 (Right Inspector) | OPS / MAC_NET |
| `traj-agl-group` | `<div>` | 3648 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-altitude-mode` | `<select>` | 3636 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-altitude-msl` | `<input>` | 3645 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-axis-a` | `<input>` | 3673 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-axis-b` | `<input>` | 3674 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-center-x` | `<input>` | 3671 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-center-y` | `<input>` | 3672 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-climb-rate` | `<input>` | 3656 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-current-speed` | `<b>` | 3617 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-descent-rate` | `<input>` | 3660 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-floor-badge` | `<span>` | 3666 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-live-agl` | `<span>` | 3665 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-live-alt` | `<b>` | 3665 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-live-pitch` | `<span>` | 3666 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-live-vz` | `<span>` | 3666 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-msl-group` | `<div>` | 3643 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-rotation` | `<input>` | 3675 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-speed-mps` | `<input>` | 3621 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-speed-slider` | `<input>` | 3620 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-target-agl` | `<input>` | 3650 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-waypoint-x` | `<input>` | 3682 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-waypoint-y` | `<input>` | 3683 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-waypoint-z` | `<input>` | 3684 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `traj-waypoint-z-label` | `<label>` | 3684 | no | — | Zone 4 (Right Inspector) | PLAN_AI |
| `trajectory-add-point` | `<button>` | 3687 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `trajectory-apply` | `<button>` | 3693 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `trajectory-cancel` | `<button>` | 3694 | YES | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `trajectory-commit-label` | `<small>` | 3606 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `trajectory-editor-message` | `<div>` | 3696 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `trajectory-mode` | `<select>` | 3609 | YES | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `trajectory-place-point` | `<button>` | 3688 | YES | verify-browser-ux | Zone 4 (Right Inspector) | PLAN_AI |
| `trajectory-remove-point` | `<button>` | 3689 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `transfer-card-container` | `<div>` | 2697 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tx-bytes-lbl` | `<span>` | 2701 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tx-eta-lbl` | `<span>` | 2701 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tx-msg-lbl` | `<p>` | 2702 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tx-progress-bar` | `<div>` | 2700 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tx-status-badge` | `<span>` | 2699 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `tx-type-lbl` | `<strong>` | 2699 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `upload-modal` | `<div>` | 4040 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `upload-status` | `<div>` | 4054 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `view-mode-toggle` | `<div>` | 1412 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `vsa-analyzer-panel` | `<div>` | 2711 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `vsa-evm-pct` | `<b>` | 2740 | no | verifyVsaConstellationUpgrade | Zone 4 (Right Inspector / Contextual) | OPS |
| `vsa-ldpc-bler` | `<b>` | 2755 | no | verifyVsaConstellationUpgrade | Zone 4 (Right Inspector / Contextual) | OPS |
| `vsa-lock-badge` | `<span>` | 2724 | YES | verifyVsaConstellationUpgrade | Zone 4 (Right Inspector / Contextual) | OPS |
| `vsa-modcod-order` | `<b>` | 2760 | no | verifyVsaConstellationUpgrade | Zone 4 (Right Inspector) | MAC_NET |
| `vsa-node-select` | `<select>` | 2720 | no | verifyVsaConstellationUpgrade | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `vsa-phase-err` | `<b>` | 2750 | no | verifyVsaConstellationUpgrade | Zone 4 (Right Inspector / Contextual) | OPS |
| `vsa-snr-margin` | `<b>` | 2745 | no | verifyVsaConstellationUpgrade | Zone 4 (Right Inspector / Contextual) | OPS |
| `waterfall-canvas` | `<canvas>` | 2163 | YES | verifyUiMakeoverAnd3dPerf | Zone 4 (Right Inspector) | RF_PHY |
| `waterfall-superframe-label` | `<span>` | 2158 | YES | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `waypoint-editor` | `<div>` | 3678 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `waypoint-list` | `<div>` | 3680 | YES | — | Zone 4 (Right Inspector) | PLAN_AI |
| `welcome` | `<div>` | 1588 | no | capture_live_redesign_screenshots, verify-browser-ux | Zone 4 (Right Inspector / Contextual) | OPS |
| `welcome-dismiss` | `<button>` | 1593 | no | capture_live_redesign_screenshots, verify-browser-ux | Zone 1 (Top Command Strip) | ALL |
| `wf-atm-readout` | `<strong>` | 2591 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `wf-crest-sub` | `<div>` | 2596 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `wf-diff-readout` | `<strong>` | 2595 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `wf-doppler-readout` | `<strong>` | 2613 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `wf-doppler-sub` | `<div>` | 2614 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `wf-eirp-readout` | `<strong>` | 2583 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `wf-fspl-readout` | `<strong>` | 2587 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `wf-pnoise-readout` | `<strong>` | 2604 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `wf-prx-readout` | `<strong>` | 2600 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `wf-rician-readout` | `<strong>` | 2618 | no | verifyRicianFadingAndCqiAging | Zone 4 (Right Inspector / Contextual) | OPS |
| `wf-sky-sub` | `<div>` | 2605 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `wf-ta-readout` | `<strong>` | 2609 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `wf-target-node-badge` | `<span>` | 2574 | no | verifyComprehensive51PointUxPolish | Zone 4 (Right Inspector) | OPS / RF_PHY |
| `worker-jitter-canvas` | `<canvas>` | 3160 | YES | verifyWorkerJitterAndDossierUpgrade | Zone 4 (Right Inspector) | LAB |
| `zoom-100` | `<button>` | 1456 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `zoom-200` | `<button>` | 1457 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |
| `zoom-30` | `<button>` | 1454 | no | verifyComprehensive51PointUxPolish | Zone 4 (Right Inspector / Contextual) | OPS |
| `zoom-60` | `<button>` | 1455 | no | — | Zone 4 (Right Inspector / Contextual) | OPS |

---

## 6. Design Token Architecture (`frontend/tactical-obsidian.css`)

The Tactical Obsidian design system establishes a high-performance, WCAG 2.1 AA compliant styling foundation:

### 6.1 Surface Hierarchy
```css
:root {
  --c2-void:           #090b0e;
  --c2-surface:        #0e1116;
  --c2-elevated:       #141820;
  --c2-control:        #1a202b;
  --c2-control-hover:  #222a38;
  --c2-border:         #242c38;
  --c2-border-strong:  #38465a;
}
```

### 6.2 Typography & Tabular Numerics
```css
:root {
  --c2-font-sans: "Inter", "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --c2-font-mono: "JetBrains Mono", "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
  --c2-text-primary:   #e6edf3; /* Contrast 16.0:1 vs #0e1116 (WCAG AAA) */
  --c2-text-secondary: #9aa7b8; /* Contrast 7.74:1 vs #0e1116 (WCAG AAA) */
  --c2-text-muted:     #768499; /* Contrast 4.98:1 vs #0e1116 (WCAG AA) */
}
```

### 6.3 Semantic Signal Palette (WCAG AA >= 4.5:1, Viénot 1999 CVD Calibrated)
```css
:root {
  --c2-accent:         #38bdf8; /* Matte Tactical Steel-Cyan - Zero Glow */
  --c2-sig-optimal:    #22c55e; /* Standard Optimal */
  --c2-sig-degraded:   #eab308; /* Standard Degraded */
  --c2-sig-critical:   #f97316; /* Standard Critical */
  --c2-sig-outage:     #ef4444; /* Standard Outage */
  --c2-sig-relay:      #3b82f6; /* Standard Relay */
}

[data-cvd-mode="colorblind-safe"] {
  --c2-sig-optimal:    #4ade80; /* CVD Optimal */
  --c2-sig-degraded:   #facc15; /* CVD Degraded */
  --c2-sig-critical:   #fb923c; /* CVD Critical */
  --c2-sig-outage:     #ec4899; /* CVD Outage */
  --c2-sig-relay:      #818cf8; /* CVD Relay */
}
```

---

## 7. Migration Roadmap (UI-01 through UI-04)

- **UI-01 (Current):** Forensic DOM contract audit, Tactical Obsidian CSS foundation, crisp SVG icon kit, and Suite 96 verification.
- **UI-02:** Atomic cutover of `index.html` to `frontend/tactical-obsidian.css`. Purge `stitch-theme.css`, eliminate external CDN script dependencies, wire 4-zone workbench layout while preserving all 826 DOM ID contracts.
- **UI-03:** Refactor JS panel controllers (`src/ui/*.ts`) to drive the 5-mode workspace switcher and 48px precision tool rail. Purge lingering emojis in UI code.
- **UI-04:** Final cross-browser UX validation (`scripts/verify-browser-ux.mjs`), Playwright screenshot regression tests, and full 96-suite verification pass.