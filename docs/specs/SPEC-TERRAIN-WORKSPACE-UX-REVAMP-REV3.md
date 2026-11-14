# SPEC-TERRAIN-WORKSPACE-UX-REVAMP-REV3
## Implementation Specification: Terrain Workspace, Responsive Chrome, Overlay Coordination, Accessibility & Visual Polish

**Status:** REV3.1 — Incorporates Role 3 Audit Corrections (2 Blocking + 3 Minor Adjustments; Read-Only Planning Phase; Awaiting Explicit User Sign-Off)  
**Date:** 2026-11-12  
**Role:** Role 1 — Independent Engineering Planner (`engineering-planner`)  
**Scope:** Main-thread UI/UX (`index.html`, `frontend/c2-console-theme.css`, `src/ui/simulationTimelineRenderer.ts`, `src/ui/workbench/mapLayersPanel.ts`, `scripts/verify-browser-ux.mjs`)  
**Excluded (Strictly Untouched):** `src/worker/*.ts`, `src/core/*.ts`, `src/shared/*.ts`, `core/`, `server/`, `electron/`

---

## Decisions & Issues Ledger

| ID | Topic | Decision / Status | Rationale |
|---|---|---|---|
| `DEC-001` | Overlay coordination inside `#radar-container` | **PROPOSED:** Deterministic single coordinator (`syncFloatingOverlayLayout` + open/close hooks) enforcing mutual exclusion (`Toolbox` ↔ `Layers` ↔ `Inspector`/`Legend`) and width-aware clamping | Prevents `15,647–60,711 px²` overlaps at `1440×900` / `1366×768` and `18–36.75px` crushes at `1024×768` while preserving `verify-browser-ux.mjs` simultaneous `Inspector + Legend + Layers` E2E test |
| `DEC-002` | Constrained laptop & mobile map height budget | **PROPOSED:** `@container (max-width: 700px)` toolbar compaction (`<= 72px`, max 2 rows) + `@media (max-width: 1120px)` single-row `.topbar` + `clamp(120px, 17vh, 160px)` timeline height (skipping inline `--timeline-height` override on boot when `localStorage` is empty) | Reclaims `#radar-container` from `306px` (`39.8%`) to `>= 520px` (`~68%`) at `1024×768` and `>= 405px` (`>= 48%`) at `780×840`, while keeping `verify-browser-ux.mjs` timeline drag target (`> 160px`) green |
| `DEC-003` | Mobile `.rail` (`<= 860px`) overflow | **PROPOSED:** Wrap `.rail` cleanly (`flex-wrap: wrap`, 2 compact rows) instead of `overflow-x: auto` clipping | Eliminates off-screen clipping (`scrollW: 1019px` vs `780px`) of tabs 6–8 and `Expert`/`Help` |
| `DEC-004` | Timeline canvas track heights & `LOOKAHEAD HORIZON` | **PROPOSED:** Derive `commH` dynamically from canvas CSS height `h`; render `LOOKAHEAD HORIZON` inside the communication track below `rulerH` | Eliminates vertical clipping of `ACN ALT | SPD | NODES` at `160px`/`100px` panel height and removes `● LIVE` badge overlap; zero regression to `verifySimulationTimeline*` |
| `DEC-005` | Destructive action safety | **PROPOSED:** Shared two-step inline confirmation helper (`armDestructiveConfirm`, 4 s timeout + `Escape` cancel) on UI clicks only | Protects `RESET`, `Reset theater`, `Delete` node (both table & floating inspector), and `Delete selected` obstacle without blocking main thread or breaking programmatic `loadPreset`/`resetSim` calls |
| `DEC-006` | Sequential rail order (`1–8`) & Kargil initial state | **PROPOSED:** Reorder `Tab 6 = Authoring`, `Tab 7 = Diag & Ref`, `Tab 8 = Registration`; suppress auto-opening floating `#map-node-details` on `runKargilScenario()` | Restores sequential `1–8` rail numbering/hotkeys and keeps Kargil map center unobstructed until user selects a target; updates `scripts/verify-browser-ux.mjs` explicitly |

**Open Issues:** None — all 13 verified Playwright/Chromium audit findings map cleanly to verified source seams and existing test contracts.

---

## 1. Objective & Scope

### 1.1 Primary Objective
Resolve all 13 verified UI, layout, overlay collision, accessibility, typography, and color findings from the live Playwright/Chromium frontend audit across `1440×900`, `1366×768`, `1024×768`, and `780×840` viewports without altering simulation physics, worker state authority, or existing test invariants.

### 1.2 Target Seam
- **Layout & Styling Seam:** [`frontend/c2-console-theme.css`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/frontend/c2-console-theme.css) (preserving inline CSS regex invariants inside [`index.html`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/index.html) `<style>`).
- **DOM & UI Controller Seam:** [`index.html`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/index.html) overlay coordination (`syncFloatingOverlayLayout`, `setTerrainToolboxExpanded`, `#btn-legend-toggle`, `dismissNodeInspector`), form/select A11y bindings, destructive confirmation wrapper, narrative strip toggle, tab order (`TABS` / `tabs`), and `runKargilScenario()`.
- **Map Layers Panel Seam:** [`src/ui/workbench/mapLayersPanel.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/ui/workbench/mapLayersPanel.ts) (`setOpen` hook coordination).
- **Timeline Canvas Seam:** [`src/ui/simulationTimelineRenderer.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/ui/simulationTimelineRenderer.ts) (`render`, `renderFutureLookahead`, `renderSpatialRibbon`).
- **Browser E2E Gate Seam:** [`scripts/verify-browser-ux.mjs`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/scripts/verify-browser-ux.mjs).

### 1.3 Exclusions (Explicitly Out of Scope)
- **Zero edits** to `src/worker/*.ts`, `src/core/*.ts`, `src/shared/*.ts`, `core/`, `server/`, or `electron/`.
- **Zero edits** to physical RF/terrain/queueing/TDMA models or worker IPC contracts (`WorkerInboundCommand`, `WorkerOutboundMessage`).
- **Zero edits** to existing unit/integration test files (`src/tests/*.ts`) or `scripts/verify-project.mjs` structural assertions.

---

## 2. Baseline Architecture & Context (Stages A–C Analysis)

### 2.1 Verified Current Reality
1. **Persistent Spatial Workspace:** At boot, `#radar-stage` mounts into `#persistent-map-mount` inside `.persistent-map-panel` (`--map-width: 58%` desktop, `100%` stacked below `860px`). `#radar-container` hosts `#radar-canvas`, `#maplibre-stage`, `#three-stage-container`, `#terrain-toolbox-stack`, `.map-legend`, `#map-layers-btn` / `#map-layers-popover`, `#map-node-details`, `#radar-cursor-hud`, `#radar-hud-locked-pill`, and `#map-renderer-notice`.
2. **Current Overlay Gap (`syncFloatingOverlayLayout` at `index.html:2678–2723`):** Only considers `.map-legend`, `#map-layers-popover`, and `#map-node-details`. It does **not** track `#terrain-toolbox-stack` (`data-tb-expanded="true"`), does **not** enforce mutual exclusion when opening Toolbox vs. Map Layers vs. Inspector, and leaves `#terrain-toolbox-panel` (`flex: 0 0 auto`) unconstrained so `#terrain-toolbox-drawer` crushes to `18px` on short viewports (`1024×768`).
3. **Toolbar & Vertical Chrome (`index.html:709–775`, `c2-console-theme.css:930–963, 2802–2890`):** `.stage-toolbar .tool-group { flex-wrap: nowrap }` keeps `Range` (~310 px) and `Terrain` (~250 px) non-wrapping while `.stage-toolbar-row` wraps into 5 rows (`227px`) at `1024×768` (`535px` pane width). Combined with `.topbar` (`75px`) and `.sim-timeline-panel` (`160px`), `#radar-container` drops to `306px` (`39.8%`). At `780×840`, `.topbar` (`141px`) + `.rail` (`overflow-x: auto`, `scrollW: 1019px`) + `.radar-canvas-container { min-height: 240px }` starve `#radar-container` and crush `#map-node-detail-content` to `0px`.
4. **Timeline Canvas (`src/ui/simulationTimelineRenderer.ts:349–352, 401–407, 490–508`):** `rulerH (24) + commH (80) + sparkH (>= 16) = 120px` exceeds the `118px` canvas inside a `160px` panel (and overflows by `62px` when resized to `100px`), clipping `renderSpatialRibbon()` (`ACN ALT | SPD | NODES`). `renderFutureLookahead(..., y0=0)` draws `'LOOKAHEAD HORIZON'` at `y0 + 6` (`y = 6px`), colliding with `renderRuler()`'s `● LIVE` badge (`y = 4..20`, `x = w - 80..w - 6`).
5. **Protected Test Contracts Verified on Disk:**
   - [`scripts/verify-project.mjs:23, 64, 69–72`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/scripts/verify-project.mjs#L23-L72): Checks `#tab-overview`, `#tab-scheduler`, `#tab-terrain`, `#tab-terminal`, `#tab-doc` plus literal inline CSS substrings `.tab-content.active{display:flex;flex-direction:column}`, `@media(max-width:860px)`, `.main-viewport{grid-template-columns:minmax(0,1fr)`.
   - [`src/tests/verifyDataCommVisualization.ts:2069–2093`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/tests/verifyDataCommVisualization.ts#L2069-L2093): Parses `.map-legend { ... }` and `.map-legend span { ... }` inside `index.html` (`flex-wrap: wrap`, no `overflow-x: auto`, no `white-space: nowrap` on `.map-legend`, literal `max-width: calc(100% - 20px)`, `white-space:nowrap` on `.map-legend span`). **Rule:** Do NOT edit `index.html:131–161`; place all legend overrides in `frontend/c2-console-theme.css`.
   - [`src/tests/verifyTerrainToolboxSci.ts:92–93`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/tests/verifyTerrainToolboxSci.ts#L92-L93): Requires `#terrain-toolbox-stack` and `#terrain-toolbox-drawer`.
   - [`src/tests/verifyTimelineCorrective.ts:1387–1396`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/tests/verifyTimelineCorrective.ts#L1387-L1396): Requires `#map-node-detail-content` and timeline FSM hooks.
   - [`src/tests/verifySimulationTimeline.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/tests/verifySimulationTimeline.ts), `verifyTimelineEnhancement.ts`, `verifyTimelineBrowserE2E.ts`: Verified **no** assertions depend on `rulerH`, `commH`, `sparkH`, or `LOOKAHEAD HORIZON` coordinates.

### 2.2 Stage B & C Architectural Evaluation (Trade-Off Comparison)

#### Decision A: Multi-Overlay Collision Resolution inside `#radar-container`
- **Option 1 (Pure CSS Geometry Clamping Only):** Attempt to shrink all 4 overlays simultaneously into corners. *Rejected:* At `1024×768` (`535×306px`) or `780×840`, `410px` Toolbox + `286px` Inspector + `310px` Layers + Legend cannot mathematically fit without `< 40px` crushed panels or covering 100% of the playable map center.
- **Option 2 (Recommended — Deterministic Priority Coordinator + Responsive Max-Height Sharing):** Keep simultaneous `Inspector + Legend + Layers` non-overlapping via `syncFloatingOverlayLayout()` (required by `verify-browser-ux.mjs:307–326`), while **mutually excluding** heavy lateral drawers (`Terrain Toolbox` auto-closes `Map Layers` and auto-dismisses `Node Inspector` when `cw < 1100`, preserving `selectedNodeId`; opening `Map Layers` or `Node Inspector` when `cw < 1100` auto-collapses `Terrain Toolbox`; `Legend` auto-collapses when competing with `Toolbox` on `cw < 900` or when `ch < 380` with `Layers + Inspector`). *Selected:* Guarantees `0 px²` overlap, playable map center, and readable scrollable drawers at every viewport.

#### Decision B: Destructive Action Protection
- **Option 1 (`window.confirm()` Modal Dialogs):** Blocks JS event loop / 50 Hz telemetry ingestion UI loop and breaks non-dialog headless automation. *Rejected.*
- **Option 2 (Recommended — Shared Two-Step Inline Confirmation Helper `armDestructiveConfirm`):** First click arms the button (`Confirm?`, 4 s timeout, `Escape`/blur cancel, ARIA `aria-live` prompt); second click commits. Programmatic functions (`resetSim()`, `loadPreset()`) remain unblocked for URL-param/test hooks. *Selected.*

---

## 3. Affected Components & Files

| File | Seam / Lines | Planned Responsibility |
|---|---|---|
| [`frontend/c2-console-theme.css`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/frontend/c2-console-theme.css) | `L25`, `L402–790`, `L930–965`, `L1133–1155`, `L1238–1392`, `L1538–1645`, `L1945–2040`, `L2352–2366`, `L2772–2891`, plus `#network-node-select` & `.is-confirm-armed` | `--hi-text-faint` contrast uplift + `>= 10px` font floor; `@container (max-width: 700px)` toolbar compaction; `@media (max-width: 1120px)` topbar compaction; `@media (max-width: 860px)` `.rail` wrap + map height floor; Toolbox panel/drawer flex-scroll bounds; MapLibre attribution sizing; dark multi-select styling; 2-line `.situation-strip` clamp + expand state; timeline responsive height |
| [`index.html`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/index.html) | `L595–602`, `L626–642`, `L702`, `L877–906`, `L981`, `L1025`, `L1416–1465`, `L2150`, `L2324`, `L2346–2347`, `L2378`, `L2678–2723`, `L2869–2889`, `L3564–3610`, `L5485`, `L6812–6827`, `L7630`, `L8471–8477`, `L9482–9510`, `L9805–9817`, `L10463`, `L13701` | Overlay coordinator (`syncFloatingOverlayLayout` + mutual exclusion hooks); boot timeline height fallback fix (`L3564–3610`); A11y `for`/`aria-label` bindings; replace `var(--bg)` inline form styles with `var(--hi-void)`; `armDestructiveConfirm` helper + 4 UI call sites; `#btn-narrative-expand`; sequential `1–8` rail order & `tabs`/`TABS`; deduplicate `#sim-speed-readout`; fix `"Mode Mode:"`; `#traj-floor-badge` `10px`; suppress auto-opening `#map-node-details` in `runKargilScenario()`; MapLibre offline/attribution hardening |
| [`src/ui/workbench/mapLayersPanel.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/ui/workbench/mapLayersPanel.ts) | `L291–306`, `L332–341` | Notify `onOpenChange(open)` cleanly and ensure opening Map Layers triggers overlay mutual-exclusion callback |
| [`src/ui/simulationTimelineRenderer.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/ui/simulationTimelineRenderer.ts) | `L348–409`, `L490–495`, `L785–812` | Dynamic `commH` / `sparkH` partitioning from canvas `h`; clamp/center `● LIVE` badge in `renderRuler()`; draw `LOOKAHEAD HORIZON` inside comm track (`y0 + rulerH + 10`) clear of `● LIVE` badge and playhead pill |
| [`scripts/verify-browser-ux.mjs`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/scripts/verify-browser-ux.mjs) | `L208–215`, `L402–435`, plus new assertions | Assert non-auto-open inspector on Kargil start; update hotkey `8` → `6` for `#tab-authoring`; add assertions for `1366×768` & `780×840`, Toolbox mutual exclusion (`0 px²` overlap), rail visibility (`scrollWidth <= clientWidth` / no clipped tabs), form labels, timeline ribbon clipping, and two-step destructive confirmation |

**Untouched Critical Files:** `src/worker/simWorker.ts`, `src/core/*.ts`, `src/shared/*.ts`, `src/ui/terrainMapRenderer.ts` (`computeDemBoundaryGeometry`), `src/tests/*.ts`, `scripts/verify-project.mjs`.

---

## 4. Detailed Contracts & Milestone Specifications

### Milestone 1 — Overlay Mutual Exclusion & Scroll-Safe Sizing Inside `#radar-container` (HIGH #1)
**Files:** `index.html`, `frontend/c2-console-theme.css`, `src/ui/workbench/mapLayersPanel.ts`

1. **Mutual Exclusion Matrix (`syncFloatingOverlayLayout` + Trigger Hooks in `index.html`):**
   - Let `cw = containerRect.width`, `ch = containerRect.height`.
   - **Opening Terrain Toolbox (`setTerrainToolboxExpanded(true)` at `index.html:9482`):**
     - Explicitly sync `data-tb-expanded="true|false"` onto **`#radar-container`** (as well as `#terrain-toolbox-stack`) so `#radar-container[data-tb-expanded="true"] .map-legend` in `c2-console-theme.css` matches reliably.
     - Always call `mapLayersPanel?.setOpen(false)`.
     - If `cw < 1100`: call `dismissNodeInspector()` (sets `inspectorDismissed = true`, adds `.is-closed`, **preserves `selectedNodeId`**).
     - If `cw < 900` and `.map-legend` is expanded: collapse `.map-legend` (`is-collapsed`, reset `#btn-legend-toggle` `aria-pressed="false"`).
     - Call `syncFloatingOverlayLayout()`.
   - **Opening Map Layers (`MapLayersPanel.setOpen(true)` -> `onOpenChange(true)` at `index.html:5634`):**
     - Always call `window.setTerrainToolboxExpanded?.(false)` if Toolbox is expanded.
     - Call `syncFloatingOverlayLayout()`.
   - **Opening Node Inspector (`inspectorDismissed = false` in `handleNodeSelection`, `handleAcnSelection`, `onTargetNodeChange`):**
     - Compute `const cw = $('radar-container')?.getBoundingClientRect().width || $('radar-container')?.clientWidth || 0;`; if `cw < 1100` and Toolbox is expanded (`data-tb-expanded="true"`): call `window.setTerrainToolboxExpanded?.(false)`.
     - Call `syncFloatingOverlayLayout()`.
   - **Toggling Legend Open (`#btn-legend-toggle` at `index.html:2869`):**
     - Compute `const cw = $('radar-container')?.getBoundingClientRect().width || $('radar-container')?.clientWidth || 0;`; if `cw < 900` and Toolbox is expanded: call `window.setTerrainToolboxExpanded?.(false)`.
     - Call `syncFloatingOverlayLayout()`.
2. **Adaptive Geometry & Non-Crushing Scroll Bounds (`c2-console-theme.css` + `syncFloatingOverlayLayout`):**
   - **`.map-legend` (`c2-console-theme.css:1133–1141`):** Change `max-width: calc(100% - 140px) !important` → `max-width: calc(100% - 64px) !important` (clears `36px` rail + `10px` inset while reducing row count from 4 to 1–2 at `1024×768`); set `max-height: 72px; overflow-y: auto; pointer-events: auto;` only when expanded if needed, keeping `index.html:131–161` completely untouched. When Toolbox IS open on `cw >= 900`, `.radar-container[data-tb-expanded="true"] .map-legend` caps `max-width: calc(100% - 432px) !important`.
   - **`#terrain-toolbox-stack` (`c2-console-theme.css:1238–1384`):**
     - Replace `100vw - 80px` on `.terrain-toolbox-panel` and `.terrain-toolbox-drawer` with container-relative `width: min(310px, calc(100% - 4px))` and `width: min(360px, calc(100% - 4px))` inside `.tb-overlay-column`.
     - Make `.tb-overlay-column` vertically scrollable (`overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;`) while **preserving `pointer-events: none` on `.tb-overlay-column`** (so map pointer clicks outside `.terrain-toolbox-panel` / `#terrain-toolbox-drawer` still pass through to the map canvas while wheel/touch scrolling over the panel/drawer scrolls the column); cap `.terrain-toolbox-panel` at `max-height: 58%; overflow-y: auto;` when `#terrain-toolbox-drawer` is open (`:has(#terrain-toolbox-drawer:not(.is-collapsed))`) while giving `#terrain-toolbox-drawer` `flex: 1 0 130px; min-height: 120px;` (or collapsing controls cleanly on `ch < 380` with scrollable column) so `#terrain-toolbox-drawer` NEVER crushes to `18px`.
   - **`#map-layers-popover` & `#map-node-details` Simultaneous Coordination (`index.html:2678–2723`, `c2-console-theme.css:1621–1641, 1945–1996`):**
     - When `layersOpen` is true and `cw >= 580` (with `#map-layers-popover` capped at `width: min(296px, calc(100% - 24px))` and `#map-node-details` `width: min(252px, calc(100% - 372px))` when `offset-left`), `Inspector` sits cleanly at `right: 318px; bottom: 12px` (`252 + 318 + 52 = 622px`; at `1024×768` where `cw ≈ 535px`, `cw < 580` triggers stacked `top-right` anchor).
     - When `layersOpen && inspectorVisible && anchor === 'top-right'` (`cw < 580`):
       - Compute `availableH = ch - clearanceTop - 56` (reserving `8px` gap + `48px` bottom trigger clearance).
       - Allocate `maxInspH = Math.max(112, Math.floor(availableH * 0.44))` to `#map-node-details`, and set `--layers-top-clearance` from `inspRect.bottom - containerRect.top + 8`, guaranteeing `#map-layers-popover` retains `>= 130px` (`availableH * 0.50`) as long as `ch >= 340px` (secured by Milestone 2).
       - On mobile (`cw < 480` or `ch < 320`), auto-collapse `.map-legend` if both `layersOpen` and `inspectorVisible` would squeeze either below `120px`.

### Milestone 2 — Constrained Laptop (`1024×768`) & Mobile (`<= 860px`) Chrome Budget + `.rail` Wrapping (HIGH #2 & #3)
**Files:** `frontend/c2-console-theme.css`, `index.html`

1. **`.stage-toolbar` Compaction (`@container (max-width: 700px)` on `.persistent-map-panel`):**
   - Hide `.stage-toolbar .tool-label` and `.stage-toolbar .sep` (`display: none`). Note: `verify-browser-ux.mjs:293` already skips label-wrapping check when `getComputedStyle(labelEl).display === 'none'`, and `.tool-group` keeps `flex-wrap: nowrap`.
   - Tighten `.stage-toolbar` (`padding: 4px 8px; gap: 3px;`), `.stage-toolbar-row` (`gap: 4px 6px;`), `.tool-cluster` (`gap: 4px 6px;`), and `.stage-toolbar button` (`min-height: 24px; padding: 2px 6px; font-size: 10.5px;`).
   - Result at `1024×768` (`~535px` pane): Row 1 (`~460px`) + Row 2 (`~505px`) fit cleanly on **2 rows (`<= 68px` total height)** with zero mid-group wrapping.
   - At `@media (max-width: 500px)` (ultra-narrow phone/split): allow `.stage-toolbar-row` compact horizontal scroll (`overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none;`) or `<= 3` rows (`<= 96px`) while keeping `.tool-group { flex-wrap: nowrap }`.
2. **`.topbar` Compaction & Speed Readout Deduplication (`@media (max-width: 1120px)` & Medium #13):**
   - **Deduplicate Speed Readout (Finding #13):** Remove the redundant visible `#sim-speed-readout` badge next to `#sim-speed-input` (`index.html:595`; keep `<span id="sim-speed-readout" class="sr-only">` updated by `setSpeed()` if needed for screen readers, and add a subtle `×` suffix label inside `.sim-speed-ctrl` on `#sim-speed-input`).
   - At `@media (max-width: 1120px)`: hide `.brand small` and `.deck-label`, set `.brand { max-width: 165px; padding-right: 8px; margin-left: 4px; }`, `.sim-speed-slider { width: 46px; }`, `.spd-preset-btn { padding: 2px 5px; font-size: 10.5px; }` → `.topbar` stays on **1 row (`<= 48px`)** at `1024×768`.
   - At `@media (max-width: 860px)`: hide `.sim-speed-slider` (numeric input + preset buttons remain), compact `.topbar { padding: 4px 8px; gap: 5px 8px; }` → `.topbar <= 82px` at `780×840`.
3. **Timeline Default Height Coordination on Short Viewports:**
   - Update `.sim-timeline-panel` default `--timeline-height` fallback in `c2-console-theme.css:2034` to `clamp(120px, 17vh, 160px)` and `.sim-timeline-panel.is-expanded` at `@media (max-height: 800px)` to `clamp(240px, 34vh, 420px) !important`.
   - **Boot JS Fix (`index.html:3564–3610`):** Currently `let savedTimelineHeight = 160;` unconditionally calls `applyTimelineHeight(savedTimelineHeight, false)`, writing inline `--timeline-height: 160px` onto `#sim-timeline-panel` and masking the CSS fallback. Update boot initialization so that when `localStorage.getItem(TL_HEIGHT_KEY)` is absent or invalid (`hasPersistedTimelineHeight === false`), JS does **not** write `--timeline-height` inline (letting CSS `clamp(120px, 17vh, 160px)` govern) and instead syncs `timelineHandle` `aria-valuenow` from the rendered/computed height (and updates it on `window.resize` until the user manually drags).
   - At `1024×768`: `768 - 46 (topbar) - 66 (toolbar) - 131 (timeline) = 525px` (`68.4%` map height, `>= 48%`). When dragged up by `64px` in `verify-browser-ux.mjs:448`, `131 + 64 = 195px > 160px`, satisfying `verify-browser-ux.mjs:455`.
4. **Mobile (`<= 860px`) Map & `.rail` Wrapping (`c2-console-theme.css:2802–2891`):**
   - Replace `.rail { overflow-x: auto; overflow-y: hidden; }` with `flex-wrap: wrap; overflow-x: visible; row-gap: 4px; column-gap: 4px; padding: 5px 8px;` and `.rail-group { display: contents; }` (or `flex-wrap: wrap`) so all 8 `.nav-tab` buttons + `.rail-utilities` (`Expert`, `Help`) wrap cleanly across 2 compact rows with `scrollWidth <= clientWidth` (zero off-screen clipping at `780×840`).
   - Raise `.radar-canvas-container` mobile `min-height` from `240px` to `clamp(380px, 50vh, 480px)` (and `.persistent-map-panel { min-height: 0; }`, `.persistent-map-mount { min-height: 0; }`) so `#radar-container` is `>= 48%` of `840px` (`~420px`) and `#map-node-detail-content` never crushes to `0px`.

### Milestone 3 — Timeline Canvas Dynamic Track Partitioning & Label De-Confliction (HIGH #5)
**File:** [`src/ui/simulationTimelineRenderer.ts`](file:///home/aarush/Documents/vscode/tactical-xband-digital-twin-main/src/ui/simulationTimelineRenderer.ts)

1. **Dynamic Track Height Partitioning (`render()` at `L348–364`):**
   - Replace hardcoded `const commH = 80;` with dynamic partitioning bounded strictly to `h`:
     ```ts
     const rulerH = h >= 72 ? 24 : Math.max(18, Math.floor(h * 0.34));
     const sparkH = h >= 72 ? Math.min(20, Math.max(16, Math.round(h * 0.14))) : Math.max(14, Math.floor(h * 0.24));
     const commH = Math.max(18, h - rulerH - sparkH);
     ```
   - Guarantees `rulerH + commH + sparkH <= h` at default `160px` (`h ≈ 118px` → `24 + 77 + 17 = 118px`), at minimum `100px` (`h ≈ 58px` → `19 + 26 + 13` / `19 + 25 + 14 = 58px`), and when expanded (`320px`), zero clipping of `renderSpatialRibbon()` (`ACN ALT | SPD | NODES`).
   - Guard `renderSpatialRibbon()` font & text rendering (`y0 + h / 2`, `h >= 12`) and `renderCommunicationTrack()` lane labels (`laneH = (commH - 6) / 2`) against tiny `laneH` (`< 14px` omits/shrinks secondary lane label gracefully).
   - In `renderRuler()` (`L490–495`), clamp `badgeH = Math.min(16, Math.max(12, h - 2))` and vertically center `badgeY = y0 + Math.max(1, Math.floor((h - badgeH) / 2))` so the `● LIVE` / `HISTORICAL` badge never clips when a `100px` timeline panel shrinks `rulerH` to `19px`.
2. **`LOOKAHEAD HORIZON` Label De-Confliction (`renderFutureLookahead()` at `L370, L378–409`):**
   - Pass `rulerH` (or `yCommStart = rulerH`) into `renderFutureLookahead(ctx, x0, y0, w, h, rulerH)`.
   - Background shading + dashed vertical grid continue across `[y0, y0 + h]`, while `'LOOKAHEAD HORIZON'` text draws inside the communication track at `y = y0 + rulerH + 10` (`34px` at standard height, clearing `renderPlayhead()`'s `y = 18..32` pill when `!collidesRightBadge`), only when `w >= 110 && h >= rulerH + 26`.
   - If the playhead timestamp pill (`renderPlayhead()` at `L843–847`) shifts to `y = 26..40` (`collidesRightBadge = px >= w - 84`), offset `'LOOKAHEAD HORIZON'` down to `y0 + rulerH + 20` or skip if `px >= w - 120`, ensuring zero overlap with both the `● LIVE` / `HISTORICAL` badge and playhead pill.

### Milestone 4 — Accessible Form Controls, Narrative Strip & Destructive Confirmation Guards (HIGH #4, #6, #7)
**Files:** `index.html`, `frontend/c2-console-theme.css`

1. **Form & Select Accessible Names (HIGH #4):**
   - Wire explicit `for="node-input-..."` on all 10 `<label>` elements inside `#node-editor-form` (`index.html:1424–1465`: `callsign`, `role`, `x`, `y`, `agl`, `tx-power`, `battery-capacity`, `battery-level`, `priority`, `color`).
   - Add explicit `aria-label` on `#tb-transect-node-type` (`"Terminal link profile"`), `#tb-transect-k` (`"Effective Earth radius k-factor"`), `#tb-probe-target` (`"Viewshed target height"`), and on hidden file inputs `#terrainFileInput` (`"Upload single DEM or heightmap file"`) and `#terrainFolderInput` (`"Select folder of SRTM HGT tiles"`).
2. **Inline Confirmation Guard for Destructive Actions (HIGH #6):**
   - Add a reusable `armDestructiveConfirm(buttonEl, { canArm, armedLabel, statusEl, onConfirm, timeoutMs = 4000 })` helper (with a registry `disarmAllDestructiveConfirmations()`) in `index.html`:
     - **Precondition Check First:** If `canArm && !canArm()` (e.g., `spatialLocked`, `isHistoricalInspecting`, `selectedNodeId < 0`, or no obstacle selected), report immediate feedback via `statusEl` without arming.
     - First valid activation sets `buttonEl.dataset.confirmArmed = 'true'`, swaps visible label to `armedLabel` (`Confirm Reset?`, `Confirm Delete?`), adds `.is-confirm-armed` styling, and starts a 4,000 ms auto-revert timer.
     - **Explicit Disarm Guarantees:** Disarms on `Escape`, blur, **document-level capturing `pointerdown`** outside `buttonEl` (critical because `<canvas>` clicks do not blur focused buttons), and explicitly inside `handleNodeSelection()`, `handleAcnSelection()`, `onTargetNodeChange()`, and `dismissNodeInspector()` so an armed delete never transfers to a newly clicked node.
     - Second activation within 4,000 ms disarms cleanly, **re-evaluates `canArm()`** (defense-in-depth if spatial lock or historical mode activated while armed), and only then invokes `onConfirm()`.
   - Wire to the 4 UI triggers (replacing inline HTML `onclick` attributes so mouse/keyboard cannot bypass or double-trigger):
     1. Topbar `RESET` (`index.html:602`): add explicit `id="btn-sim-reset"`, remove inline `onclick="resetSim()"`, and bind JS `click` listener through `armDestructiveConfirm` (`window.resetSim()` remains direct for programmatic callers).
     2. `Reset theater` (`index.html:1025`): add explicit `id="btn-reset-theater"`, remove inline `onclick="loadPreset('PRESET_RESET')"`, and bind JS `click` listener through `armDestructiveConfirm` (`window.loadPreset('PRESET_RESET')` remains direct for URL/test callers).
     3. Delete node (`#btn-node-delete` at `L9806` AND `#map-node-details [data-map-action="delete"]` at `L5485`):
        - Extract `canDeleteSelectedNode()` (checks `!spatialLocked && !isHistoricalInspecting && selectedNodeId >= 0`) and `executeDeleteSelectedNode()` (dispatches `buildNodeDeleteCommand(selectedNodeId)`).
        - Both `#btn-node-delete` and `#map-node-details [data-map-action="delete"]` independently arm **their own** visible button via `armDestructiveConfirm` (replacing `L5485`'s blind `$('btn-node-delete')?.click()` delegation so floating-inspector deletion shows `Confirm Delete?` directly in the inspector and reports status in `#map-node-action-status`).
     4. `Delete selected` obstacle (`#obstacle-delete` at `L7630`): wrap `obstacleEditor.deleteSelected()` inside `armDestructiveConfirm` using `canArm: () => !(spatialLocked || obstacleEditor.spatialLocked || simTimelineController?.isHistoricalInspecting) && obstacleEditor.pendingRequestId === null && Boolean(obstacleEditor.selectedObstacle)`.
3. **Accessible `LIVE ASSESSMENT` Narrative Strip (HIGH #7):**
   - Update `.detail-status-strip .situation-strip span` (`c2-console-theme.css:2361–2366`) from single-line `white-space: nowrap` to a 2-line clamp (`display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.35;`) and add `.situation-strip.is-expanded span { -webkit-line-clamp: unset; display: block; }`.
   - Add an icon-only `<button type="button" id="btn-narrative-expand" class="btn-narrative-expand" aria-expanded="false" aria-controls="overview-narrative" aria-label="Expand full live assessment">` inside `#situation-strip` (no inner text characters so `#situation-strip` `textContent` logging at `index.html:13676` remains unpolluted; toggles `.is-expanded` and `aria-expanded` on click/Enter/Space).

### Milestone 5 — Rail Sequence, Kargil Auto-Open, Dark Multi-Select, MapLibre Hardening, Typography & Copy Polish (MEDIUM/LOW #8–#13)
**Files:** `index.html`, `frontend/c2-console-theme.css`, `scripts/verify-browser-ux.mjs`

1. **Sequential Rail Order & Hotkeys `1–8` (#8):**
   - Reorder `.rail` in `index.html:626–642`: `1 Mission`, `2 Scheduler`, `3 Network`, `4 Terrain & RF`, `5 Terminals`, `6 Authoring` (`CONFIG` group, `title="Scenario Authoring (6)"`), `7 Diag & Ref` (`SYSTEM` group, `title="Diagnostics & Reference (7)"`), `8 Registration` (`SYSTEM` group, `title="Registration (8)"`).
   - Update `tabs` (`index.html:2378`) to `['overview','scheduler','network','terrain','terminal','authoring','doc','registration']` and `TABS` (`index.html:10463`) to match.
2. **Dark-Theme `#network-node-select` Styling (#9):**
   - Style `#network-node-select` and `#network-node-select option` / `option:checked` in `c2-console-theme.css` (`background-color: var(--hi-void); color: var(--hi-text-primary); color-scheme: dark;`; checked option `background: var(--hi-amber-soft) linear-gradient(0deg, var(--hi-amber-soft) 0%, var(--hi-amber-soft) 100%); color: var(--hi-amber-bright);` + `:focus` highlight) to eliminate OS light-gray `#d8d8d8` blocks in Chromium.
3. **MapLibre Offline Basemap Fallback & Attribution Clearance (#10):**
   - In `initializeMapLibre()` (`index.html:6782–6827`), show `#map-renderer-notice` immediately if `navigator.onLine === false` or on tile/network error, add a concise inline dismiss/retry control or non-blocking banner placement (`bottom: 44px; left: 52px; max-width: min(340px, calc(100% - 196px))`), and update `#maplibre-map .maplibregl-ctrl-bottom-right` (`c2-console-theme.css:1554`) to `right: 134px !important; bottom: 12px !important; max-width: calc(100% - 196px);` with `.maplibregl-ctrl-attrib.maplibregl-compact-show { max-width: 200px; white-space: normal; }` so attribution never overlaps `#map-layers-btn` or `#radar-cursor-hud`.
4. **Suppress Auto-Opening Floating `#map-node-details` on `runKargilScenario()` (#11):**
   - In `runKargilScenario()` (`index.html:8471–8477`), set `inspectorDismissed = true;` alongside `selectedNodeId = 4; syncNodeDropdowns(4);` and call `renderSelectedNodeDetails()` (or `dismissNodeInspector()`), keeping `Node 4` synced in `#quickNodeSelect`, `#termNodeSelect`, and `#inventory-selected-pill` while leaving the Kargil map unobstructed until the user explicitly clicks a node/ACN, selects a terminal row, or changes `#quickNodeSelect` / `#termNodeSelect`.
5. **Typography Floor, Contrast Uplift & Undefined CSS Variable Fix (#12):**
   - Uplift `--hi-text-faint` in `c2-console-theme.css:25` (and `--faint` in `index.html:8` if outside regex checks — verify `verify-project.mjs` does not check `--faint`) from `#96928a` to `#aba79f` (`>= 5.0:1` on `--hi-elevated` `#2e3440`, `>= 6.1:1` on `--hi-surface` `#1e2229`).
   - Raise every `font-size: 8.5px`, `9px`, and `9.5px` rule in `c2-console-theme.css` — plus `.tdma-bar-segment` (`index.html:275`), `#traj-floor-badge` (`index.html:2150`), and a `c2-console-theme.css` `@media (max-width: 720px) { .map-legend { font-size: 10px !important; } }` override for `index.html:200–202` (keeping `index.html:131–161` intact) — to `>= 10px` (`10px` for compact badges/indices/micro-labels; `10.5px–11px` for KV grids and form values), eliminating all `< 10px` DOM elements.
   - Replace undefined `background:var(--bg)` on all 10 `#node-editor-form` controls (`index.html:1425–1464`) with `background:var(--hi-void)` (or CSS rule `#node-editor-form input, #node-editor-form select`).
6. **Context `"Mode Mode:"` Fix & Speed Readout Cleanup (#13):**
   - In `index.html:13701` (`installAnalysisContext`), strip the leading prefix: `const mode = rawMode.replace(/^Mode:\s*/i, '');` so `[data-context-mode]` renders `"Tac-TAD"` / `"Static"` instead of `"Mode: Tac-TAD"` after `"Mode"`.
   - Combine with Milestone 2's removal of duplicate visible `#sim-speed-readout`.
7. **Update & Extend `scripts/verify-browser-ux.mjs`:**
   - Assert `#map-node-details` remains `.is-closed` after `runKargilScenario()` while `#inventory-selected-pill` reports `Node 4`.
   - Update hotkey check from `'8'` → `'6'` for `#tab-authoring` (and verify `'7'` → `#tab-doc`, `'8'` → `#tab-registration`).
   - Extend `VERIFY_VIEWPORTS` to `1440×900`, `1366×768`, `1024×768`, and `780×840` (`<= 860px` mobile), asserting:
     - `0 px²` overlap for simultaneous `Inspector + Legend + Layers` AND mutual-exclusion behavior when opening `Terrain Toolbox`.
     - `#terrain-toolbox-drawer` height `>= 100px` when active; `#radar-container` height `>= 48%` of viewport on `1024×768` and `780×840`.
     - `.rail` all 8 tabs + `Expert`/`Help` inside viewport (`right <= viewport.width`, zero horizontal clipping).
     - All `#node-editor-form` inputs have associated `<label for>` and toolbox `<select>`s have accessible names.
     - Destructive buttons (`RESET`, `#btn-node-delete`, `#obstacle-delete`) require 2 clicks (arm on 1st click, execute on 2nd).
     - `#overview-narrative` expansion toggle works via keyboard (`aria-expanded`).

---

## 5. Verification Strategy & Measurable Acceptance Criteria

### 5.1 Automated Verification Gates (Must All Pass After Final Edit)
1. `npm run typecheck`
2. `npm run build`
3. `npm run verify:project`
4. `npm run verify:all` (covers all 55 registered suites including `verify:data-comm`, `verify:terrain-toolbox`, `verify:simulation-timeline`, `verify:timeline-e2e`, `verify:timeline-enhancement`, `verify:timeline-corrective`, `verify:map-layers`)
5. `npm run verify:browser` (Playwright/Chromium across `1440×900`, `1366×768`, `1024×768`, `780×840` in Radar, MapLibre, and 3D modes)

### 5.2 Acceptance Criteria Checklist
- [ ] **Zero Overlay Overlap:** `bboxOverlapArea === 0` across all active overlay combinations inside `#radar-container`; opening Terrain Toolbox closes Map Layers and collapses Inspector when `cw < 1100` (preserving `selectedNodeId`); `#terrain-toolbox-drawer` height `>= 100px` when open.
- [ ] **Viewport & Chrome Budget:** `#radar-container` occupies `>= 48%` of viewport height on `1024×768` and `780×840`; `.stage-toolbar <= 72px` (max 2 rows) on `1024×768`; `#map-node-detail-content` height `> 0px` on `780×840`.
- [ ] **Mobile Rail Integrity:** All 8 workspace tabs + `Expert` + `Help` fully visible inside `780×840` (`scrollWidth <= clientWidth`, zero right-edge clipping).
- [ ] **Accessibility & Forms:** Zero unlabeled inputs/selects in `#node-editor-form` and Terrain Toolbox (`for`/`id` + `aria-label`); full `#overview-narrative` text keyboard/touch accessible via `aria-expanded`; two-step confirmation guard active on all 4 destructive triggers.
- [ ] **Timeline Canvas Fidelity:** `rulerH + commH + sparkH <= h` at `100px`, `160px`, and `320px` timeline heights; `LOOKAHEAD HORIZON` renders clear of `● LIVE` badge and playhead pill.
- [ ] **Typography, Color & Polish:** Zero DOM elements `< 10px`; `--hi-text-faint` contrast `>= 4.5:1` on all `--hi-*` surfaces; sequential `1–8` rail order; dark-styled `#network-node-select`; `"Mode Tac-TAD"` (no duplicate `"Mode Mode:"`); single speed input readout; non-auto-opening inspector on `runKargilScenario()`.
- [ ] **Invariants Preserved:** `git diff --name-only` shows zero edits to `src/worker/`, `src/core/`, `src/shared/`, `src/tests/`, or `scripts/verify-project.mjs`; `graphify update .` run post-implementation.
