# SPEC-TERRAIN-WORKSPACE-UX-REVAMP (REV2)
## Tactical X-Band — Terrain Map / Spatial Workspace UX Redesign

**Status:** REV2 — Incorporates Role 3 Audit Corrections, Approved Decisions & Browser Verification Evidence (Awaiting Explicit Implementation Authorization)  
**Date:** 2026-11-12  
**Role:** Senior Product Designer, UX Architect & Frontend Engineering Lead  
**Branch:** `main` (pre-existing uncommitted work preserved; audit & planning only — zero application source edits)

---

## Skills Activated

| Skill | Status | Applied To |
|---|---|---|
| `ui-ux-pro-max` | ✅ Read & applied | Design system search, visual hierarchy, density, accessibility, interaction rules |
| `better-interface` | ✅ Read & applied | Audit framework — layout, writing, typography, color, UI polish, evidence-backed reporting |
| `design-system` | ✅ Read & applied | Three-layer token architecture assessment (`c2-console-theme.css`), component token alignment |
| `codebase-design` | ✅ Read & applied | Deep-module vocabulary: seam placement, interface depth analysis |
| `code-review` | Available | Reserved for post-implementation audit |
| `ui-styling` | Available | Reserved for implementation phase |
| `design` | Available | Reserved for implementation phase |
| `verification-before-completion` | Available | Reserved for implementation verification |

---

## A. Executive UX Diagnosis

### Verified Runtime Architecture

At application boot (`index.html:3080-3083`), `#radar-stage` (defined inside `#tab-overview` in static markup) is **re-parented into `#persistent-map-mount`** inside `.persistent-map-panel` (left column of `.main-viewport`, default `--map-width: 58%`). The right column (`.detail-viewport`, default `42%`) displays whichever workspace tab is active (default `#tab-overview`, which holds `<aside class="pane overview-sidebar">`). Consequently, the spatial workspace is persistent across all tabs, while `#tab-overview` controls the operational/authoring sidebar beside it.

### Root Cause Summary

The terrain map workspace suffers from **five compounding root causes** verified via code inspection and Playwright Chromium captures:

**1. Excessive vertical chrome around the persistent map panel starves the terrain canvas.**  
Inside `.persistent-map-panel`, four stacked horizontal chrome bands surround `#radar-container`: `.map-chrome` (`33px`), `.stage-toolbar` (`87px` wrapped at `1440×900` & `1366×768`; `127px` at `1024×768`), `.situation-strip` (`50px`), and `.sim-timeline-panel` (`160px` fixed). Including `.topbar` (`50–75px`), non-canvas chrome consumes **`380px` of `900px` (42.2%)** at `1440×900` and **`445px` of `768px` (57.9%)** at `1024×768` — leaving only `324px` height for the entire map stage on a `1024×768` laptop before any overlay or inspector opens.

**2. Unstructured stage toolbar groups wrap mid-pair on desktop and laptop widths.**  
`.stage-toolbar` (`index.html:702-736`) packs 8 logically distinct control groups (`View`, `Map`, `Spatial lock`, `Mesh`, `Terrain`, `Range`, `Center`, `Obstacle tool`) into one unseparated flex-wrap container. Even at `1440×900` (`781px` map pane width), it wraps to `87px` (2 rows). At `1366×768` (`738px` pane), it orphans the `TERRAIN` label at the end of row 1 while its `[Satellite | Synthetic | Upload…]` buttons wrap to row 2. At `1024×768` (`539px` pane), it wraps to 3 rows (`127px`) and orphans `RANGE` from its buttons.

**3. Selected-state node inspector enters flex flow and abruptly shrinks or overflows the map canvas.**  
In the unselected/dismissed default state, `#map-node-details` carries `.is-empty` or `.is-closed` (`display: none !important`, `0px` footprint). However, upon node/ACN selection (including automatically in `runKargilScenario()` at `index.html:8091-8097`), `#map-node-details` enters flex flow inside `.radar-stage-body`:
- On `1440×900` and `1366×768` (`stageBody > 720px`, `flex-direction: row`), it steals **`270px` horizontally** (`34.6%` and `36.6%` of `stageBody` respectively), shrinking the map canvas to `511×521` (`1440×900`) or `468×389` (`1366×768`) and clipping its own bottom `[LOS]`/`[Fresnel]` buttons.
- On `1280×800` (`688px ≤ 720px` `@container` breakpoint in `c2-console-theme.css:1047`) and `1024×768` (`≤ 1100px` media query), `.radar-stage-body` flips to `flex-direction: column`, turning `#map-node-details` into a `145px`-tall bottom drawer (`34.5%`–`47.3%` of `stageBody`). At `1024×768`, `min-height: 175px` on `.radar-canvas-container` + `145px` inspector = `320px > 306px` available height, **overflowing `stageBody` by `14px`** and reducing the map to `539×175px` (`22.8%` of viewport height).

**4. Floating overlays collide with each other, block map clicks, and obscure 34%–49% of the canvas.**  
Empirical Playwright Chromium measurements on `#radar-container` show:
- `#terrain-toolbox-stack` (`top: 10px; left: 10px; bottom: 44px`) occupies **`37.1%`** of `#radar-container` at `1440×900` (`toolboxPanel` `310×301` = `22.9%` + `toolboxDrawer` `360×160` = `14.2%`), **`34.3%–36.0%`** at `1366×768`, and **`49.1%`** at `1024×768` (`285×301` on `539×324`, squeezing out the drawer and overlapping `#radar-cursor-hud`). Because it intercepts pointer events over the upper-left canvas, clicks on the left ~50% of the map fail to place transect/probe points when the toolbox is open.
- When Terrain Toolbox (`37.1%`), expanded Legend (`641×40` = `6.2%`), and Map Layers Popover (`310×445` = `33.9%`) are open together at `1440×900`, the Layers Popover directly overlaps the Legend (`6,704 px²` collision) and net overlay coverage reaches **`~75.5%`** (`~77.2%` gross).
- On the Radar canvas, `DataCommVisualizer.renderSuperframeHudIndicator()` (`src/ui/dataCommVisualization.ts:1963-2049`) draws the `TDMA 50x EXPANDED ...` pill at `bannerX = 10, bannerY = 42` with unclamped `bannerW = textWidth + 16`, colliding with `#terrain-toolbox-panel` and overflowing narrow (`539px`) canvases.

**5. Operational monitoring and scenario authoring share the same sidebar context.**  
`aside.overview-sidebar` mixes live mission monitoring (`Operations`) and scenario configuration (`Authoring Studio`: Flight Trajectory, TDMA Waveform, 3D Obstacles) under a compact subtab toggle (`index.html:942-1283`), diluting operational focus and separating configuration editors from the `CONFIG` group in the main navigation rail (`Terrain & RF`, `Terminals`).

---

## B. Current UI Inventory

### Global Chrome (always visible)
| Element | Location | Responsibility |
|---|---|---|
| `.topbar` | `header.topbar` (`index.html:578`) | Brand, Pause/Step, Playback speed slider/input/presets, Reset, Elapsed clock & frame counter |
| `.rail` | `nav.rail` (`index.html:623`) | 4 groups, 7 workspace tabs: `Mission` (1), `Scheduler` (2), `Network` (3), `Terrain & RF` (4), `Terminals` (5), `Diag & Ref` (6), `Registration` (7), plus `Expert` & `Help` utilities |
| `.historical-mode-banner` | Below topbar (`index.html:614`) | Conditional banner during historical inspection + `Return to Live` button |

### Persistent Map Panel (`.persistent-map-panel`, left 58% of `.main-viewport`)
| Element | Location | Responsibility |
|---|---|---|
| `.map-chrome` | `index.html:651` (`33px` high) | Static title ("Tactical picture · Ladakh sector"), `#btn-legend-toggle`, `#map-chrome-mode-badge` (mutated at `L3258, L3295`) |
| `.persistent-map-mount` | `#persistent-map-mount` (`index.html:658`) | Runtime host for `#radar-stage` (re-parented from `#tab-overview` at `index.html:3081-3083`) |
| `.stage-toolbar` | `index.html:702-736` (`87–127px`) | 8 control groups: `View` (2D/3D), `Map` (Radar/MapLibre), `Spatial lock`, `Mesh` (3D only), `Terrain` (Satellite/Synthetic/Upload), `Range` (30/60/100/200 km + `Center` + `Obstacle tool`) |
| `.radar-canvas-container` | `#radar-container` (`index.html:738`) | Hosts `#radar-canvas` (2D), `#maplibre-stage` (MapLibre), `#three-stage-container` (3D), plus floating overlays |
| `#terrain-toolbox-stack` | `index.html:744-876` (`top:10; left:10`) | `#terrain-toolbox-toggle-btn`, 4-mode `#terrain-toolbox-panel` (DEM, Transect, Probe, Region), and `#terrain-toolbox-drawer` |
| `#radar-cursor-hud` / `#radar-hud-locked-pill` | `index.html:878-881` (`bottom:8-10; left:8-10`) | Mutually exclusive cursor geo/elevation readout or spatial-lock pill |
| `#map-renderer-notice` | `index.html:882` (`bottom:44; left:10`) | MapLibre satellite imagery fallback notice |
| `#three-stage-container` | `index.html:883-891` | Three.js 3D terrain canvas + `.three-hud-overlay` (`bottom: 14px; left: 14px`) |
| `.map-legend` | `index.html:892-905` (`top:10; right:10`) | Collapsible 11-item legend (spans nearly full width when expanded) |
| `#map-layers-btn` & `#map-layers-popover` | `src/ui/workbench/mapLayersPanel.ts` (`bottom:12; right:12`) | Trigger button (`Layers · 9/17`) + 5-category, 17-layer popover with presets and opacity sliders |
| `#map-node-details` | `index.html:907-919` (flex sibling inside `.radar-stage-body`) | Selected node/ACN inspector (`0px` when `.is-empty`/`.is-closed`; `270px` right column or `145px` bottom drawer when selected) |
| `#map-node-tooltip` | `index.html:743` | Pointer-following node/link hover tooltip |
| `.situation-strip` | `index.html:921` (`50px` high) | Narrative live assessment strip (`#overview-narrative`), queried by Recent Activity logger at `index.html:13206-13208` |
| `.sim-timeline-panel` | `index.html:659-693` (`160px` fixed, `clamp(340px,42vh,520px)` when `.is-expanded`) | Timeline transport/zoom/CSV controls, scrubber canvas, and expandable Frame Inspector |

### Detail Viewport (`.detail-viewport`, right 42% of `.main-viewport`)
| Element | Location | Responsibility |
|---|---|---|
| `#tab-overview` (`aside.overview-sidebar`) | `index.html:924-1284` | `Operations` subview (4 health chips, Scenario controls, Network outcome KPIs, Inspect a terminal, Recent trend) & `Authoring Studio` subview (Flight Trajectory, TDMA Waveform, 3D Obstacles) |
| Tabs 2–7 | `index.html:1289+` | `Scheduler`, `Network`, `Terrain & RF`, `Terminals`, `Diag & Ref`, `Registration` |

---

## C. Prioritized UX Problems (Code & Browser-Verified)

### CRITICAL

**C1 — Stage toolbar wraps unpredictably and splits labels from their controls**  
*Severity: HIGH | Frequency: Every session | Evidence: Screenshots `03`, `09`, `12`; `index.html:702-736`*  
At `1440×900` (`781px` pane), `.stage-toolbar` wraps to 2 rows (`87px`). At `1366×768` (`738px` pane), the `TERRAIN` `.tool-label` sits orphaned at the right end of row 1 while `[Satellite | Synthetic | Upload…]` wraps to row 2. At `1024×768` (`539px` pane), it wraps to **3 rows (`127px`)**, orphaning `RANGE` on row 2.

**C2 — Selected-state `#map-node-details` abruptly resizes or overflows the map canvas**  
*Severity: HIGH | Frequency: Every node selection (and auto-triggered by `runKargilScenario()`) | Evidence: Screenshots `kargil_1366x768_node4_selected`, `kargil_1280x800_node4_selected`, `kargil_1024x768_node4_selected`; `index.html:115-128`, `c2-console-theme.css:1047-1062`*  
While `0px` when unselected (`.is-empty`/`.is-closed`), selecting any node forces `.radar-canvas-container` to shrink:
- `1440×900`: canvas shrinks `781×521` → `511×521` (`-34.6%` width).
- `1366×768`: canvas shrinks `738×389` → `468×389` (`-36.6%` width); inspector's `[LOS]`/`[Fresnel]` buttons clip at bottom.
- `1280×800`: flips to column layout; inspector takes `688×145` (`34.5%` height), shrinking canvas to `688×276`.
- `1024×768`: flips to column layout; `175px` min canvas + `145px` inspector = `320px > 306px` `stageBody`, overflowing vertically and leaving only `175px` (`22.8%` of viewport height) for the map.

**C3 — Floating Terrain Toolbox occludes 34%–49% of the map canvas and blocks map clicks**  
*Severity: HIGH | Frequency: Every terrain analysis workflow | Evidence: Screenshots `03`, `04`, `09`, `13`; `index.html:744-876`, `c2-console-theme.css:1116-1164`*  
Empirically measured occlusion of `#radar-container`:
- `1440×900` (Transect + drawer): **`37.1%`** (`toolboxPanel` `310×301` = `22.9%` + `toolboxDrawer` `360×160` = `14.2%`).
- `1366×768` (Transect / Probe + drawer): **`34.3%–36.0%`**.
- `1024×768` (Transect panel): **`49.1%`** (`285×301` on `539×324`), squeezing out the drawer, overlapping `#radar-cursor-hud`, and swallowing pointer clicks over the left half of the canvas (preventing `T1` placement at `x = 45%` in screenshot `13`).

**C4 — Left-edge and right-edge floating HUD collisions**  
*Severity: HIGH | Frequency: Constant / layer inspection | Evidence: Screenshots `04`, `05`, `09`, `13`; `c2-console-theme.css:962-1039, 1352-1410`, `src/ui/dataCommVisualization.ts:1963-2049`*  
- **Left-edge stack:** `#terrain-toolbox-toggle-btn`, `#terrain-toolbox-stack`, `#radar-cursor-hud` (truncated horizontally by `max-width: calc(100% - 162px)`), `#map-renderer-notice`, and `DataCommVisualizer`'s `TDMA 50x EXPANDED ...` pill (`bannerX = 10`, unclamped width) compete in the same left-edge zone.
- **Right-edge collision:** At `1440×900`, opening `#map-layers-popover` (`310×445`, `33.9%` of canvas) while `.map-legend` (`641×40`, `6.2%`) is open causes a direct **`6,704 px²` overlap** (`04_1440x900_radar_congested.png`), pushing combined canvas overlay occlusion to `~75.5%` net (`~77.2%` gross).

### HIGH

**H1 — `Obstacle tool: OFF` is buried inside the `Range` control group** (`index.html:726-734`). Unrelated to radar range; low discoverability.  
**H2 — `.situation-strip` consumes `50px` below the map for redundant narrative text** (`index.html:921`). Combined with `.map-chrome` (`33px`), `83px` of static chrome strips shrink map height unnecessarily.  
**H3 — `.map-chrome` (`33px`) occupies permanent vertical height for a mostly static label** (`index.html:651-657`).  
**H4 — No visual hierarchy between primary mode switches, utility actions, and edit/lock toggles** (`index.html:703-735`).  
**H5 — Radar vs. MapLibre vs. 3D Terrain parity gaps** (`c2-console-theme.css:1319-1347`, `index.html:883-891`). MapLibre adds bottom-right native attribution next to `#map-layers-btn`, displays `#map-renderer-notice` over bottom-left, and leaves Radar-centric Terrain Toolbox controls looking identical without clear capability scoping; 3D Terrain places `.three-hud-overlay` at bottom-left (`left: 14px; bottom: 14px`) without toolbox rail coordination.  
**H6 — Authoring Studio mixed into operational `Mission overview` sidebar** (`index.html:942-1283`). Trajectory, TDMA, and Obstacle authoring belong under `CONFIG` rather than competing with live KPIs.  
**H7 — `#map-node-details` action buttons clip vertically on `1366×768` and `1024×768`** (`kargil_1366x768_node4_selected.png`, `kargil_1024x768_node4_selected.png`).

### MEDIUM

**M1 — `.sim-timeline-panel` height is locked at `160px`** (`index.html:76` `min-height: 120px`, `c2-console-theme.css:1779` `height: 130px !important`) unless Frame Inspector `.is-expanded` (`340–520px`) is toggled; no compact/collapsed mode or persistent user resize.  
**M2 — `.map-resize-handle` (`8px` wide) has a narrow hit target** (`index.html:82-84`).  
**M3 — Spatial editing modes lack a clear canvas-level mode indicator** (`obstacleEditorState.ts`, `trajectoryEditorState.ts`, `Move on map`).  
**M4 — Timeline transport buttons (`play`, `step-back`, `step-fwd`, `expand`) are icon-only without compact text/tooltip cues in collapsed view** (`index.html:662-686`).  
**M5 — Base inline CSS (`index.html:18-20`) defines legacy cool-blue `button.active` (`#dbe4ff`) and `.primary:hover` (`#b6c7ff`) colors**, overridden by `c2-console-theme.css`.

---

## D. Proposed Information Architecture (Aligned with Approved Decisions)

### 5-Tier Visibility Model

```
TIER 1 — Always Visible (Structural Chrome)
  • Topbar (unchanged density — NO health chips added here): Brand, Run control, Speed, Reset, Elapsed clock
  • Navigation Rail: 4 groups, 8 tabs (adds #tab-authoring under CONFIG group; hotkeys 1–8)
  • Compact Status Strip above .detail-viewport (flex column above tab panes):
      4 Health Tally Chips (Connected/Degraded/Blocked/Outage) + 1-line compact Live Assessment
      (carries id="situation-strip" + #overview-narrative to preserve event logging without costing map height)

TIER 2 — Always Visible (Spatial Workspace)
  • Unified Map Toolbar (clean 2-row max, zero orphan labels):
      Row 1 (Mode & Terrain): [2D | 3D] · [Radar | MapLibre] · [Satellite | Synthetic | Upload…] · [512|256 when 3D] · [#map-chrome-mode-badge]
      Row 2 (Nav, Edit & Safety): [30 | 60 | 100 | 200 km] · [Center] · [Obstacle tool] · [Spatial lock] · [#btn-legend-toggle]
  • Live Map Canvas (Radar / MapLibre / 3D) — full height & width, NEVER shrunk by inspector or toolbox
  • Bottom-left Cursor HUD (auto-fades when idle; shifts clear of 36px left icon rail)

TIER 3 — Contextually Visible (Transient / Mode-Scoped Only)
  • Edit-Mode Indicator Strip + Canvas Border Ring: ONLY rendered while an editing operation is active
    (Obstacle place/select-move, Trajectory waypoint place, Ground node move-on-map); zero permanent banner chrome when idle
  • Historical Inspection Banner: Existing #historical-mode-banner (only when scrubbing history)

TIER 4 — On-Demand / Progressive Disclosure (Zero Persistent Canvas Shrink)
  • Terrain Toolbox: Preserves #terrain-toolbox-stack & #terrain-toolbox-drawer IDs, restyled as a 36px left-edge
    icon rail (DEM, Transect, Probe, Region) + expandable overlay drawer (does NOT reduce map canvas flex width;
    auto-minimizes/collapses during active map point-picking so left-side clicks are never blocked)
  • Node / ACN Inspector: #map-node-details relocated inside #radar-container as a canvas-relative right-side overlay
    with adaptive positioning (prefers bottom-right above #map-layers-btn; avoids Legend, Layers Popover, and HUDs)
  • Map Legend: .map-legend toggleable via #btn-legend-toggle, positioned cleanly clear of #map-layers-popover
  • Map Layers Popover: Existing 5-category, 17-layer trigger (#map-layers-btn) & popover (#map-layers-popover)
  • Timeline Panel: Persistent below map, vertically resizable (100–320px) + collapsible 38px compact strip (localStorage persisted)

TIER 5 — Dedicated Workspace Tab (Config / Authoring)
  • New #tab-authoring ("Authoring") tab under CONFIG group in nav rail (hotkey 8):
    Houses Flight Trajectory editor, TDMA Waveform editor, and 3D Obstacles editor (moved out of #tab-overview)
```

---

## E. Proposed Workspace Layout & Annotated Wireframes

### Primary Workspace (`1440×900` Reference & `1366×768` Laptop)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TOPBAR (unchanged, clean): Brand | RUN CTRL [PAUSE][STEP] | SPEED [1.0× slider] | RESET │ T+01:23.4s #247 │
├──────┬─────────────────────────────────────────────────┬───┬───────────────────────────┤
│ RAIL │ PERSISTENT MAP PANEL (~58%)                     │ R │ DETAIL VIEWPORT (~42%)    │
│      │ ┌─────────────────────────────────────────────┐ │ S │ (display:flex; flex-col)  │
│ MISS │ │ STAGE TOOLBAR (clean groups, .sep dividers) │ │ Z │ ┌───────────────────────┐ │
│ [1]  │ │ [2D|3D] [Radar|ML] | [Sat|Syn|Upl] | [●Live]│ │   │ │ CONN:1 DEG:0 BLK:15   │ │
│      │ │ [30|60|100|200km][⌖] | [Obs][Lock] | [Lgnd] │ │   │ │ #situation-strip (1L) │ │
│ ANLY │ ├─────────────────────────────────────────────┤ │   │ └───────────────────────┘ │
│ [2]  │ │ (Transient Edit Banner — ONLY when editing) │ │   │ ┌───────────────────────┐ │
│ [3]  │ ├─┬───────────────────────────────────────────┤ │   │ │ Active Tab Pane       │ │
│      │ │⛰│  LIVE MAP CANVAS (100% canvas width,      │ │   │ │ (.tab-content,        │ │
│ CONF │ │╌│  never shrunk by inspector or toolbox)    │ │   │ │  flex:1; min-height:0)│ │
│ [4]  │ │◉│                                           │ │   │ │                       │ │
│ [5]  │ │□│                        ┌────────────────┐ │ │   │ │ Mission Ops: Scenario,│ │
│ [8]* │ │ │                        │ SELECTED NODE  │ │ │   │ │ KPIs, Terminal Glance,│ │
│      │ │ │                        │ S4 #4       [×]│ │ │   │ │ Recent Trend          │ │
│ SYST │ │ │                        │ [scrollable kv]│ │ │   │ │                       │ │
│ [6]  │ │ │                        │ [pinned actions]│ │ │   │ │                       │ │
│ [7]  │ │ │                        └────────────────┘ │ │   │ │                       │ │
│      │ └─┴─ [● CURSOR HUD] ──────────── [Layers ▲] ──┘ │   │ │                       │ │
│      │ ╞═══════════════════ timeline drag handle ════╡ │   │ │                       │ │
│      │ │ TIMELINE (collapsible 38px or 100–320px)    │ │   │ │                       │ │
└──────┴─┴─────────────────────────────────────────────┴─┴───┴───────────────────────────┘
  * [8] Authoring (#tab-authoring: Trajectory / TDMA / 3D Obstacles) in CONFIG group
```

### Adaptive Positioning Matrix for Node Inspector Overlay

| Active Right-Side UI State | Inspector Preferred Anchor | Collision Avoidance Rule |
|---|---|---|
| Normal (Layers closed, Legend collapsed) | **Bottom-right** (`right: 12px; bottom: 48px`) | Clears `#map-layers-btn` (`bottom: 12px`, `36px` tall); leaves upper-right & center-left ACN orbit wide open |
| Legend expanded (`top: 10px; right: 10px`) + Layers closed | **Bottom-right** (`right: 12px; bottom: 48px`) | Inspector `max-height` capped at `calc(100% - legendHeight - 72px)` so they never touch |
| Layers Popover open (`bottom: 48px; right: 12px`) | **Top-right** (`top: 10px; right: 12px`) or **Left of Popover** (`right: 332px; bottom: 48px` if canvas ≥ `640px` wide) | Automatic `data-inspector-anchor="bottom-right \| top-right \| offset-left"` attribute prevents any overlap |
| Narrow laptop (`#radar-container` < `520px` wide) | **Bottom-right compact sheet** (`width: min(260px, calc(100% - 24px))`, `max-height: min(240px, 62%)`) | Internal scroll for KV grid; header (`Selected Node` + `×`) and action footer (`Edit/Move/Focus/Performance/Delete` + `LOS/Fresnel`) stay pinned and unclipped |

### Terrain Toolbox — Left-Edge Icon Rail + Expandable Overlay

```
  Collapsed (default):                  Expanded (overlay, canvas width unchanged):
  ┌──┬─────────────────────────┐        ┌──┬──────────────────────┬────────────────┐
  │⛰│                         │        │⛰│ TERRAIN TOOLBOX  [×] │                │
  │╌│   Full Map Canvas       │        │╌│ [2-Pt][Poly][Clear]  │  Map Canvas    │
  │◉│   (100% width)          │        │◉│ Height A / B / k     │  remains 100%  │
  │□│                         │        │□│ ── Analysis Drawer ──│  unresized;    │
  └──┴─────────────────────────┘        │  │ [RF Profile Canvas]  │  auto-minimizes│
   36px rail                            │  │ [KV metrics]         │  while picking │
                                        └──┴──────────────────────┴────────────────┘
                                        36px rail + ~290px overlay
```

---

## F. Interaction Workflows & Locked Contracts

### F1 — Inspecting an ACN or Ground Node (Hide vs. Deselect Contract Locked)
1. Hovering a node/link displays `#map-node-tooltip` (unchanged).
2. Clicking a node, ACN, or link opens `#map-node-details` as an **adaptive right-side overlay** inside `#radar-container` (zero canvas resize/shift).
3. **Hide vs. Deselect Lock:** Dismissing the overlay (via `×`, `Escape`, or an intentional empty-terrain click) **ONLY sets `inspectorDismissed = true` and adds `.is-closed`**; it MUST **NOT** set `selectedNodeId = -1`. That preserves the active terminal selection across `Terrain & RF`, `Terminals`, `Scheduler`, `LOS`, and `Fresnel` quick overlays. Clicking any node/ACN sets `inspectorDismissed = false` and re-opens the overlay.
4. **Never Auto-Dismiss on Non-Selection Map Interactions:** Panning, zooming, dragging the map, opening/closing Layers or Legend, switching Radar ↔ MapLibre ↔ 3D, or running Terrain Toolbox tools MUST NOT close the inspector.
5. **Exact Empty-Terrain Click Guard & Event Seams:**
   - **Neutral-Mode Guard:** Empty-terrain dismissal fires **only** when `terrainToolMode === 'idle' && obstacleEditor.mode === 'navigate' && !waypointPlacementArmed && trajectoryEditor.activeMode !== 'waypoints'` (`index.html:12240, 12274`).
   - **Radar (`radarCanvas`):** Track `panStartX/panStartY` on `mousedown` (`index.html:12293`); on `mouseup`, if `isPanning` ended with `Math.hypot(e.clientX - panStartX, e.clientY - panStartY) < 4` and the neutral-mode guard passes, dismiss overlay (`inspectorDismissed = true`).
   - **MapLibre (`mapLibreInstance`):** Wire `mapLibreInstance.on('click', ...)` (MapLibre suppresses `click` on drag-pan); require `!suppressNextMapLibreClick`, no node/ACN/link/obstacle/toolbox hit, and the neutral-mode guard before setting `inspectorDismissed = true`.
   - **3D Terrain (`threeCanvas`):** Track `pointerdown` → `pointerup` distance; only dismiss if travel `< 4px`, no node/ACN was selected (`threeController.onNodeSelected` at `index.html:5257`), and neutral-mode guard passes (OrbitControls drags `>= 4px` never dismiss).

### F2 — Adding, Moving, or Editing Ground Nodes
1. Adding/editing metadata continues via `Terminals` tab or inspector `Edit / rename`.
2. Clicking `Move on map` activates transient **Edit Mode Indicator** (`📍 MOVE NODE — Drag highlighted marker to reposition · [Done]`) with an amber canvas ring; vanishes on completion/cancel.

### F3 — Editing the ACN Trajectory
1. Located in **`#tab-authoring`** (`Authoring` under `CONFIG`, `Flight Trajectory` pane).
2. When `Place on map` is active (`waypointPlacementArmed`), transient Edit Mode Indicator appears (`✈ TRAJECTORY EDIT — Click map to add waypoint · [Done] [Cancel]`); vanishes when exited.

### F4 — Adding and Managing Obstacles
1. Full obstacle editor moves to **`#tab-authoring`** (`3D Obstacles` pane).
2. `#obstacle-map-tool` moves into the stage toolbar's `Edit` group (separated from `Range`).
3. When active (`obstacleEditor.mode !== 'navigate'`), transient Edit Mode Indicator appears (`⬛ OBSTACLE EDIT — Click/drag footprints · [Apply] [Cancel]`) and vanishes when deactivated.

### F5 — Viewing Communication Links and Transmissions
Preserved unchanged. `.map-legend` toggles via `#btn-legend-toggle` and never collides with `#map-layers-popover`.

### F6 — Switching Between Radar, MapLibre, and 3D Terrain
1. All modes share the same `.stage-toolbar`, `#map-node-details` overlay, `#map-layers-btn`/`#map-layers-popover`, `.map-legend`, transient edit-mode ring, and `#radar-cursor-hud`.
2. MapLibre's bottom-right attribution stays clear of `#map-layers-btn` and adaptive `#map-node-details`.
3. In **MapLibre** mode, Terrain Toolbox remains usable for geo-referenced overlays while Radar-only backdrop controls show `Radar only` disabled state.
4. In **3D Terrain** mode, `.three-hud-overlay` (`bottom: 14px; left: 14px`) shifts right of the `36px` left icon rail (`left: 48px`), and the Terrain Toolbox drawer collapses/shows a `2D / Geo only` notice so 3D navigation is unobstructed.

### F7 — Managing Map Layers
Preserved in `MapLayersPanel` (`src/ui/workbench/mapLayersPanel.ts`); emits open/closed state attribute on `#radar-stage` (e.g., `data-layers-open="true|false"`) so `#map-node-details` adapts its anchor deterministically.

### F8 — Timeline Playback and History
1. Top edge of `#sim-timeline-panel` gains a draggable resize handle (`4px` visual handle with `12px` hit zone, `ns-resize` cursor, keyboard `ArrowUp`/`ArrowDown` support).
2. **Persisted States (`localStorage`):** `xband-timeline-height-v1` (clamped `100px–320px`, default `160px`) and `xband-timeline-collapsed-v1` (`boolean`):
   - **Compact / Collapsed (`38px`, `.is-collapsed`):** Single toolbar row retaining `Play/Pause`, `Step Back`, `Step Fwd`, `● LIVE`, `00.00s` time display, and `Expand` toggle; `.sim-timeline-canvas-container` hidden (`display: none`).
   - **Expanded (`100px–320px`):** Scrubber canvas flexes dynamically (`flex: 1 1 auto; height: auto !important; min-height: 0`), overriding the fixed `130px !important` rule in `c2-console-theme.css:1779` and `min-height: 120px` in `index.html:76`.
   - **Frame Inspector Open (`.is-expanded`):** Preserves `clamp(340px, 42vh, 520px)` inspector view; `localStorage` height writes MUST ignore `38px` collapsed and `.is-expanded` inspector heights so user's preferred scrubber height is never overwritten.

### F9 — Accessing Advanced Diagnostics
Terrain Toolbox analysis drawer opens inside the left-edge expandable overlay (with `Open in Terrain & RF` deep link). `Diag & Ref`, `Scheduler`, and Frame Inspector remain 1 click away.

---

## G. Visual Design Direction & CSS Compatibility Contracts

- **Design System:** Preserve and enforce the **Highland Instrument** 3-layer token architecture in [`frontend/c2-console-theme.css`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/frontend/c2-console-theme.css) (`--hi-*` primitives → semantic bridge → `--c2-*` tokens), aligned with `ui-ux-pro-max` **Data-Dense Dashboard** + **HUD/FUI** contrast (`>= 4.5:1`), `prefers-reduced-motion`, and `:focus-visible`.
- **Mandatory CSS/Test Invariance Rules:**
  1. **Do NOT alter `.map-legend { ... }` or `.map-legend span { ... }` inside `index.html:131-161`** — `verifyDataCommVisualization.ts:2069-2093` parses those inline blocks with strict string assertions (`flex-wrap: wrap`, no `overflow-x: auto`, no `white-space: nowrap` on container, literal `max-width: calc(100% - 20px)`, and `white-space:nowrap` on `.map-legend span`). Place all legend layout/placement overrides in `frontend/c2-console-theme.css`.
  2. **Preserve `verify-project.mjs` inline CSS contracts** (`index.html:88` `.tab-content.active{display:flex;flex-direction:column}`, `.cols{...}`, `@media(max-width:860px)`, `.main-viewport{grid-template-columns:minmax(0,1fr)...}`, `.fresnel-canvas-box{height:clamp(...)}`). Apply `.detail-viewport` flex + `.tab-content` non-absolute overrides (`position: relative; inset: auto; flex: 1 1 auto; min-height: 0;`) inside `frontend/c2-console-theme.css` so `.tab-content` stacks cleanly below the new status strip without breaking `verify-project.mjs:64`.
  3. **Align legacy base accents (`index.html:18-20`):** Note `button.active` (`#dbe4ff`) and `.primary:hover` (`#b6c7ff`) are already overridden by `c2-console-theme.css`; unify any remaining hover/active edge rules in `c2-console-theme.css` without disturbing `verifyTimelineCorrective.ts` (`TC-CORR-15`).
- **Map Chrome Reclamation (`+83px` height):** Removing `.situation-strip` below the map (`+50px`) and folding `.map-chrome` (`+33px`) into `.stage-toolbar` (relocating `#map-chrome-mode-badge` and `#btn-legend-toggle` into `.stage-toolbar`'s right utility cluster) returns `83px` of vertical height directly to `#radar-container`.

---

## H. Implementation Architecture & Backwards-Compatible Contracts

### Affected Files & Module Seams

| File | Change Type | Responsibility |
|---|---|---|
| [`index.html`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/index.html) | Markup + UI wiring | Reorganize `.stage-toolbar` (relocate `#map-chrome-mode-badge` & `#btn-legend-toggle`, remove `.map-chrome`); move `#map-node-details` inside `#radar-container`; restyle `#terrain-toolbox-stack` in place; move `.health-tally-strip` + `#situation-strip`/`#overview-narrative` to `.detail-viewport` top status strip; add `#tab-authoring` + update `TABS`/hotkeys `1–8`/tour text + `switchOverviewSubview('authoring')` shim; add timeline resize/collapse controls + empty-terrain click handlers |
| [`frontend/c2-console-theme.css`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/frontend/c2-console-theme.css) | Stylesheet | Toolbar `.sep` & `flex-wrap: nowrap` group rules; `.detail-viewport` flex + `.tab-content` relative sizing; adaptive `#map-node-details` overlay (`data-inspector-anchor`); `36px` left-edge icon rail + overlay drawer for `#terrain-toolbox-stack`; `.three-hud-overlay` offset; transient `.edit-mode-banner`/ring; timeline `.is-collapsed` & dynamic canvas flex overrides |
| [`src/ui/dataCommVisualization.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/ui/dataCommVisualization.ts) | Minimal | Update `renderSuperframeHudIndicator()` (`L1963-L2049`) so the `TDMA 50x EXPANDED ...` pill shifts clear of the `36px` left icon rail (`bannerX >= 52`) and clamps/truncates cleanly to `canvasWidth - bannerX - 12` |
| [`src/ui/terrainMapRenderer.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/ui/terrainMapRenderer.ts) | Preserve contract | **Preserve** `computeDemBoundaryGeometry()` (`L240-L258`) so `verifyMapLayerSystem.ts` check `[8/8]` (`badge.x >= 166` wide, `badge.y >= 74` narrow) continues passing untouched |
| [`src/ui/obstacleEditorState.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/ui/obstacleEditorState.ts) | Minimal | Emit/expose active mode state for transient `.edit-mode-banner` |
| [`src/ui/trajectoryEditorState.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/ui/trajectoryEditorState.ts) | Minimal | Emit/expose waypoint placement state for transient `.edit-mode-banner` |
| [`src/ui/workbench/mapLayersPanel.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/ui/workbench/mapLayersPanel.ts) | Minimal | Expose open/closed state attribute (`data-layers-open`) on container/stage so `#map-node-details` adapts anchor cleanly |
| [`src/ui/simulationTimelineController.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/ui/simulationTimelineController.ts) | Minimal (or UI wrapper in `index.html`) | Trigger `renderer.resize()` when timeline height or `.is-collapsed` state changes |

### Locked Compatibility Contracts (Must Not Break)
1. **`.situation-strip` / `#situation-strip` Logger (`index.html:13206-13208`):** Relocated narrative container in the `.detail-viewport` status strip MUST retain `id="situation-strip"` (and contain `#overview-narrative`) so `document.querySelector('.situation-strip, #situation-strip, [id*="situation"]')` keeps logging situational changes.
2. **Terrain Toolbox DOM IDs (`verifyTerrainToolboxSci.ts:92-93`, `index.html:9029-9059`):** Preserve `id="terrain-toolbox-stack"`, `id="terrain-toolbox-toggle-btn"`, `id="terrain-toolbox-panel"`, `id="terrain-toolbox-close-btn"`, `id="terrain-toolbox-drawer"`, and all internal mode/control IDs.
3. **Tab & Hotkey Routing (`index.html:937, 2311, 2314-2319, 2507, 10011`):**
   - Update `TABS` (`L10011`) and `tabs` (`L2314`) to include `'tab-authoring'` / `'authoring'` (hotkey `8`), updating `/^[1-7]$/` → `/^[1-8]$/` and Tour text (`L937`: `1–8 switch workspaces`).
   - Retain `window.switchOverviewSubview('authoring')` as a compatibility shim calling `window.switchMainTab('tab-authoring')` (and `'ops'` routing to `'tab-overview'`), while `btn-help` (`L2311`) continues focusing `#welcome` in `#tab-overview`.
   - Preserve all IDs checked by `verify-project.mjs:22-25` (`tab-overview`, `tab-scheduler`, `tab-terrain`, `tab-terminal`, `tab-doc`).
4. **Simulation & Worker Invariants:** Zero edits to `src/worker/simWorker.ts`, `src/core/*.ts`, `src/shared/workerProtocol.ts`, RF physics, Fresnel/diffraction, TDMA scheduling, or 50 Hz loop timing.

---

## I. Finalized 8-Milestone Implementation Sequence

1. **Milestone 1 — Stage Toolbar Reorganization & Chrome Consolidation** *(LOW risk)*  
   Split `.stage-toolbar` into 2 clean rows/groups with `.sep` dividers and `flex-wrap: nowrap` per group (zero orphaned labels), move `Obstacle tool` into an `Edit` group, relocate `#map-chrome-mode-badge` and `#btn-legend-toggle` into `.stage-toolbar`, and remove `.map-chrome` (`+33px`).
2. **Milestone 2 — Health Chips Status Strip Above `.detail-viewport` & Remove `.situation-strip` Below Map** *(LOW risk)*  
   Convert `.detail-viewport` to `display: flex; flex-direction: column;` in `c2-console-theme.css` and `.tab-content` to `position: relative; inset: auto; flex: 1 1 auto; min-height: 0;`. Mount the 4 health chips (`#tally-*`) + compact `id="situation-strip"` (`#overview-narrative`) at the top of `.detail-viewport` (`+50px` map height).
3. **Milestone 3 — Authoring Studio → Dedicated `#tab-authoring` (`CONFIG` Rail Group)** *(LOW risk)*  
   Add `tab-btn-authoring` under `CONFIG` in `.rail` (hotkey `8`), relocate Flight Trajectory, TDMA Waveform, and 3D Obstacles editors into `#tab-authoring`, update `TABS`/`tabs`/`/^[1-8]$/`/tour text, and add `switchOverviewSubview('authoring')` compatibility shim.
4. **Milestone 4 — Adaptive Canvas-Relative Node Inspector Overlay** *(MEDIUM risk)*  
   Move `#map-node-details` inside `#radar-container` as an `absolute` overlay (zero canvas resize/shift on selection across all viewports). Implement adaptive anchor (`bottom-right` preferred; `top-right` or `offset-left` when `#map-layers-popover` or `.map-legend` conflicts), pinned header + action footer (`[LOS]`/`[Fresnel]` never clip), `×` + `Escape` + strict neutral-mode non-drag empty-terrain dismissal (`inspectorDismissed = true` only, never clearing `selectedNodeId`), across Radar, MapLibre, and 3D Terrain.
5. **Milestone 5 — Terrain Toolbox Left-Edge Icon Rail + Expandable Overlay Drawer & TDMA Pill De-Confliction** *(MEDIUM risk)*  
   Restyle `#terrain-toolbox-stack` (preserving all required IDs) into a `36px` left-edge icon rail (`DEM`, `Transect`, `Probe`, `Region`) + expandable overlay drawer (zero map canvas width shrink), with auto-minimize during active map picking. Update `DataCommVisualizer.renderSuperframeHudIndicator()` (`src/ui/dataCommVisualization.ts:1963-2049`) to clear the `36px` rail (`bannerX >= 52`) and clamp width; keep `terrainMapRenderer.ts` `computeDemBoundaryGeometry()` invariant intact.
6. **Milestone 6 — Transient Edit-Mode Visual Contract** *(LOW risk)*  
   Add conditional `.edit-mode-banner` + amber canvas ring rendered **only** while Obstacle tool, Trajectory waypoint placement, or Node move-on-map is active; zero permanent chrome when idle.
7. **Milestone 7 — Resizable & Collapsible Timeline (`localStorage` Persisted)** *(LOW risk)*  
   Add top-edge drag-resize handle (`100px–320px`) + `38px` compact `.is-collapsed` state (retaining Play/Pause, Step Back/Fwd, `● LIVE`, `00.00s`, Expand toggle) persisted via `xband-timeline-height-v1` and `xband-timeline-collapsed-v1`, overriding `min-height: 120px` (`index.html:76`) and `height: 130px !important` (`c2-console-theme.css:1779`), ignoring collapsed/`.is-expanded` heights on save, and calling `simTimelineRenderer.resize()`.
8. **Milestone 8 — Radar / MapLibre / 3D Consistency & Responsive Polish Pass** *(LOW risk)*  
   Verify identical chrome, inspector, legend, layers, edit-mode, and toolbox behavior across Radar, MapLibre, and 3D Terrain (`.three-hud-overlay` cleared of `36px` rail) at `1920×1080`, `1440×900`, `1366×768`, `1280×800`, and `1024×768` (plus `860px` mobile breakpoint).

---

## J. Before / After Evaluation & Verification Plan

### Measured Baseline vs. Targets

| Metric | Measured Baseline | Redesign Target |
|---|---|---|
| Map canvas shift/shrink on node selection | `-34.6%` width (`1440×900`), `-36.6%` (`1366×768`), `-34.5%` height (`1280×800`), `-42.9%` + `14px` overflow (`1024×768`) | **`0%` canvas resize or shift** at every viewport |
| Terrain Toolbox canvas occlusion & click blocking | `34.3%–37.1%` (`1440`/`1366`), `49.1%` (`1024×768`); blocks left-side clicks | **`36px` rail** collapsed; non-blocking expandable overlay + auto-minimize while picking |
| Legend ↔ Layers Popover collision (`1440×900`) | `6,704 px²` direct overlap | **`0 px²` overlap** |
| Stage toolbar height & orphan labels (`1024×768`) | `127px` (3 rows), `RANGE` orphaned (`TERRAIN` orphaned at `1366×768`) | **`≤ 72px`** (2 clean rows, zero orphaned labels) |
| Non-canvas vertical chrome (`1024×768`) | `445px / 768px` (`57.9%` overhead, leaving `324px` stage) | Reclaim `~83px` (`situation-strip` + `map-chrome`) + up to `122px` when timeline collapsed |
| Inspector action button clipping (`1366×768` / `1024×768`) | `[LOS]` / `[Fresnel]` clipped at bottom | **0% clipping** (pinned action footer) |

### Verification Commands (Verified Against `package.json` & `scripts/run_all_verifications.mjs`)
- `npm run typecheck`
- `npm run build`
- `npm run verify:project`
- `npm run verify:map-layers`
- `npm run verify:simulation-timeline`
- `npm run verify:timeline-corrective`
- `npm run verify:terrain-toolbox`
- `npx vite-node src/tests/verifyDataCommVisualization.ts` *(or `node scripts/run_all_verifications.mjs --suite verify:data-comm`)*
- `npx vite-node src/tests/verifyObstacleEditor.ts`
- `npx vite-node src/tests/verifyTrajectoryEditor.ts`
- `npx vite-node src/tests/verifyNodeInventoryCoordinates.ts`
- `npm run verify:all`
- Playwright Chromium visual & bounding-box regression capture across **Radar**, **MapLibre**, and **3D Terrain** at `1440×900`, `1366×768`, `1280×800`, and `1024×768`.

---

## Git Safety Record

Pre-existing uncommitted changes on `main` (`frontend/c2-console-theme.css`, `index.html`, `package.json`, `scripts/run_all_verifications.mjs`, `src/core/terrain.ts`, plus untracked `terrainToolbox*.ts` and `verifyTerrainToolboxSci.ts`) remain **completely preserved**. Only `SPEC-TERRAIN-WORKSPACE-UX-REVAMP.md` was updated.
