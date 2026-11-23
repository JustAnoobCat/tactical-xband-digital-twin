# Implementation Specification: UI-05 Frontier Direct-Manipulation Terrain Toolbox

**Document ID:** SPEC-UI05-DIRECT-MANIPULATION-TOOLBOX  
**Version:** 1.0.0  
**Status:** Approved & Implementing  
**Author:** Tactical C2 Systems Architect & Engineering Implementer  
**Date:** November 2026  
**Reference Architecture:** `AGENTS.md`, `docs/specs/SPEC-INTUITIVE-TOOLBOX-RIGHT-PANEL-AND-UX-FINISH.md`, `docs/specs/ui01-tactical-workbench-architecture.md`, `docs/specs/ui02-lattice-obsidian-cutover.md`

---

## 1. Executive Summary & Problem Statement

In the previous revision of the Tactical C2 digital twin, activating terrain analysis tools required a clumsy multi-step ceremony:
1. The operator clicked a tool icon on the left rail (`.tb-rail-btn`).
2. The right-hand inspector opened, but the map remained disarmed in passive navigate mode.
3. The operator was forced to scan the right inspector and click a secondary action button (e.g. `Measure A → B`, `Pick Site on Map`, `Draw Area`, `Place on Map`) before picking coordinates on the map.
4. During picking, the docked right inspector panel jarred operators by blanking out or auto-collapsing.
5. Completing or restarting a measurement required finding a "Clear" button instead of fluid re-clicking or double-clicking to close polygons.
6. The left rail icons used ambiguous or inconsistent symbols without immediate hotkey tooltips, and standard CAD/GIS single-key shortcuts (`V`, `R`, `P`, `A`, `B`) were absent.

Phase **UI-05** modernizes the terrain toolbox into a **frontier direct-manipulation CAD/GIS workflow**:
- **1-Click Auto-Arming:** Selecting any tool immediately arms coordinate picking on the map (`data-tb-picking="true"`, crosshair cursor, top-center floating badge).
- **Universal CAD/GIS Iconography:** Sharp 1.6px-stroke monochrome SVG glyphs with standardized semantics (Pointer Arrow for Pan, Tick-marked Diagonal for Ruler, Reticle for Probe, Square-handled Polygon for Area, Isometric Cube for Barrier).
- **Zero-Lag CSS Hover Flyouts:** Instant CSS-driven tooltips displaying `"R · Ruler"`, `"P · Probe"`, `"A · Area"`, `"B · Barrier"`, `"V · Pan"` on hover/focus with hotkey badges.
- **Figma-Style Hotkeys (`V`, `R`, `P`, `A`, `B`, `Enter`, `Esc`):** Instant tool selection guarded strictly against input fields and browser modifier keys (`Ctrl+R`, `Ctrl+P`, `Ctrl+A` never hijacked).
- **Docked Inspector Visibility:** The right inspector panel remains docked and visible during picking so operators immediately observe live calculations populate as points are placed.
- **Fluid Re-Click & Double-Click Completion:** Double-click closes area polygons; re-clicking starts fresh ruler measurements with zero required "Clear" clicks.
- **Terse Step Guidance:** Step guide banner reduced to 4–7 word phrases with zero verbose multi-sentence tutorials.

---

## 2. Architecture & State Machine

### 2.1 Tool Modes & 1-Click Auto-Arm State Machine

| Mode Identifier | Hotkey | Tool Label | Auto-Armed Tool Mode | Picking Label Banner |
|---|---|---|---|---|
| `dem` | `V` | Pan | `idle` | *(Hidden — standard grab navigation)* |
| `transect` | `R` | Ruler | `transect-2pt` | `RULER · Click A → B` |
| `probe` | `P` | Probe | `probe` | `PROBE · Click terrain` |
| `region` | `A` | Area | `region` | `AREA · Click corners · Dbl-click to finish` |
| `obstacle` | `B` | Barrier | `obstacle-place` | `BARRIER · Click to place` |

When any tool rail button or hotkey is engaged:
1. `setTerrainToolboxExpanded(true)` ensures the docked right inspector is visible in `.detail-viewport`.
2. `setTbMode(mode, true)` updates active tabs, titles, and auto-arms the target interaction mode.
3. `#radar-container` and `#terrain-toolbox-stack` receive `data-tb-picking="true"`.
4. The canvas cursor changes to `crosshair`.
5. `#tb-picking-bar` appears as a sleek, ultra-compact 1-line floating badge at the top-center of `#radar-container`.

### 2.2 Fluid Re-Click & Double-Click Completion

- **Ruler (`transect`):**
  - Click 1 sets Point A with active rubber-band line and magnetic snap.
  - Click 2 sets Point B, generates the geodetic elevation profile, diffraction loss, and Fresnel zone in `#terrain-toolbox-drawer`, and sets `data-tb-picking="false"`.
  - Re-clicking `#terrain-measure-btn` OR clicking `.tb-rail-btn[data-tb-rail-mode="transect"]` resets waypoints and immediately begins a new A→B measurement.
  - Pressing `Esc` or `V` disarms back to Pan mode.
- **Site Probe (`probe`):**
  - Clicking anywhere on the map drops/moves the probe pin immediately.
  - Live 360° viewshed, altitude sweep, and polar scopes update without requiring a separate "Clear" click.
  - Subsequent map clicks re-pin the probe coordinate smoothly.
- **Area (`region`):**
  - Clicks define polygon vertices.
  - Double-clicking on `#radar-canvas` (when $\ge 3$ vertices exist) OR pressing `Enter` OR clicking `#tb-picking-finish-btn` closes the polygon immediately.
  - AO swath metrics (mean/min/max elevation, ruggedness, LoS percentage) and GeoJSON export are rendered immediately.
- **Escape Key (`Esc`):**
  - If a tool is active/picking (`terrainToolMode !== 'idle'`), pressing `Esc` cancels the active pick and returns to Pan (`dem`) mode.
  - If the toolbox is idle, pressing `Esc` closes the toolbox inspector cleanly.

### 2.3 Docked Inspector Preservation

Because `#terrain-toolbox` is docked in the right `.detail-viewport` (outside the map canvas), it remains completely visible while picking. Operators immediately see:
- Profile charts and Fresnel clearance populate next to Point B.
- Probe SINR, MODCOD, and polar radiation sweeps populate next to the clicked site.
- AO swath metrics populate next to drawn polygons.

The guide banner (`#tb-step-guide-banner`) is kept ultra-terse:
- Transect: `Click A → B on map` / `Click Point B to lock` / `Profile locked · Click to re-measure`
- Probe: `Click any spot to probe`
- Region: `Click corners · Dbl-click to finish`
- Barrier: `Click map to drop barrier`

---

## 3. Universal CAD/GIS Iconography

All 5 quick-mode buttons inside `.tb-icon-rail` utilize standard 1.6px-stroke monochrome SVGs without decorative gradients or emojis:

```html
<!-- Pan / Navigate (V) -->
<button type="button" class="tb-rail-btn active" data-tb-rail-mode="dem" data-tb-key="V" data-tb-label="Pan" data-tb-tooltip="Pan (V)" data-tb-hotkey="V" title="Pan / Navigate (V)" aria-label="DEM &amp; Terrain Navigation">
  <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 3l12 9-5.5 1.2L8.5 19z"/>
  </svg>
</button>

<!-- Ruler & LoS Profiler (R) -->
<button type="button" class="tb-rail-btn" data-tb-rail-mode="transect" data-tb-key="R" data-tb-label="Ruler" data-tb-tooltip="Ruler (R)" data-tb-hotkey="R" title="Ruler &amp; LoS Profiler (R)" aria-label="Transect &amp; Polyline RF Profiler">
  <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 17L17 3l4 4L7 21z"/>
    <path d="M13.5 6.5l2 2M10.5 9.5l1.5 1.5M7.5 12.5l2 2"/>
  </svg>
</button>

<!-- Site Signal Probe (P) -->
<button type="button" class="tb-rail-btn" data-tb-rail-mode="probe" data-tb-key="P" data-tb-label="Probe" data-tb-tooltip="Probe (P)" data-tb-hotkey="P" title="Site Signal Probe (P)" aria-label="Site Probe &amp; Altitude Sweep">
  <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="7"/>
    <circle cx="12" cy="12" r="2" fill="currentColor"/>
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
  </svg>
</button>

<!-- Area Coverage Scan (A) -->
<button type="button" class="tb-rail-btn" data-tb-rail-mode="region" data-tb-key="A" data-tb-label="Area" data-tb-tooltip="Area (A)" data-tb-hotkey="A" title="Area Coverage Scan (A)" aria-label="Region Zonal &amp; Bridge Finder">
  <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polygon points="5,6 18,4 20,17 7,19" stroke-dasharray="3 2"/>
    <rect x="3.5" y="4.5" width="3" height="3" fill="currentColor"/>
    <rect x="16.5" y="2.5" width="3" height="3" fill="currentColor"/>
    <rect x="18.5" y="15.5" width="3" height="3" fill="currentColor"/>
    <rect x="5.5" y="17.5" width="3" height="3" fill="currentColor"/>
  </svg>
</button>

<!-- 3D Barrier & Attenuation (B) -->
<button type="button" class="tb-rail-btn" data-tb-rail-mode="obstacle" data-tb-key="B" data-tb-label="Barrier" data-tb-tooltip="Barrier (B)" data-tb-hotkey="B" title="3D Barrier &amp; Attenuation (B)" aria-label="3D Obstacles &amp; RF Attenuation">
  <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/>
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>
  </svg>
</button>

<!-- Tool Inspector Toggle Button -->
<button id="terrain-toolbox-toggle-btn" class="terrain-toolbox-toggle-btn tb-rail-toggle" type="button" title="Expand or collapse Terrain Toolbox" aria-label="Terrain Toolbox" aria-expanded="false" data-tb-label="Tool Inspector">
  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h16"/>
    <circle cx="9" cy="6" r="2" fill="currentColor"/>
    <circle cx="15" cy="12" r="2" fill="currentColor"/>
    <circle cx="10" cy="18" r="2" fill="currentColor"/>
  </svg>
  <span class="sr-only">Terrain Toolbox</span>
</button>
```

---

## 4. Zero-Lag CSS Hover Flyouts & Picking Indicators

### 4.1 Pure CSS Flyout Labels
CSS hover flyouts in `frontend/c2-console-theme.css` provide instantaneous zero-lag visual feedback without JavaScript tooltip libraries or DOM overhead:

```css
.tb-icon-rail button[data-tb-label] {
  position: relative;
}

.tb-icon-rail button[data-tb-label]::after {
  content: attr(data-tb-key) " · " attr(data-tb-label);
  position: absolute;
  left: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
  background: #131821;
  border: 1px solid #37455a;
  border-radius: 2px;
  padding: 3px 8px;
  font-family: var(--lo-mono);
  font-size: 10.5px;
  color: #f0f4f8;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  z-index: 40;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  transition: opacity 60ms ease, visibility 60ms ease;
}

.tb-icon-rail button[data-tb-label]:not([data-tb-key])::after {
  content: attr(data-tb-label);
}

.tb-icon-rail button[data-tb-label]:hover::after,
.tb-icon-rail button[data-tb-label]:focus-visible::after {
  opacity: 1;
  visibility: visible;
}
```

### 4.2 Crosshair & Armed Ring
While coordinate picking is armed, the radar container renders a focused crosshair cursor and a subtle amber/cyan armed border:

```css
#radar-container[data-tb-picking="true"],
#radar-container[data-tb-picking="true"] #radar-canvas {
  cursor: crosshair;
}

#radar-container[data-tb-picking="true"] {
  box-shadow: inset 0 0 0 1.5px rgba(56, 189, 248, 0.45);
}
```

### 4.3 Minimal `#tb-picking-bar` Floating Badge
Positioned at top-center of `#radar-container` without obscuring the canvas:

```css
#tb-picking-bar {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: #11161f;
  border: 1px solid #37455a;
  border-left: 2.5px solid #38bdf8;
  border-radius: 2px;
  font-family: var(--lo-mono);
  font-size: 10.5px;
  color: #f0f4f8;
  white-space: nowrap;
  pointer-events: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  z-index: 35;
}

#tb-picking-bar[hidden] {
  display: none;
}
```

---

## 5. Keyboard Shortcut Specifications & Input Guards

### 5.1 Guard Invariants
All hotkeys must pass the strict keyboard target guard:
```javascript
function isEditableKeyboardTarget(target) {
  if (!target || !target.closest) return false;
  return Boolean(target.closest('input, select, textarea, [contenteditable="true"], [contenteditable=""]'));
}
```
In addition:
`if (e.ctrlKey || e.metaKey || e.altKey) return;`
This ensures browser shortcuts (`Ctrl+R`, `Ctrl+P`, `Ctrl+A`) are preserved 100%.

### 5.2 3D View Guard
Toolbox hotkeys (`V`, `R`, `P`, `A`, `B`) operate exclusively on 2D maps (`radar` or `maplibre`). If the user presses a tool shortcut while in 3D mode (`stageViewMode === '3d'`), the hotkey does not corrupt 3D camera controls and shows a status notice:
`Switch to 2D Map (Radar or Geo) to use Terrain Tools.`

---

## 6. Backward-Compatible DOM ID Map

All existing IDs and attributes remain intact for backward compatibility across all 98 existing verification suites:

| Existing DOM ID | Retained Purpose |
|---|---|
| `terrain-toolbox-stack` | Container for left rail and overlay column |
| `terrain-toolbox-toggle-btn` | Toggle expand/collapse of right docked panel |
| `tb-tool-dem` | Tab button for DEM / Map mode |
| `tb-tool-transect` | Tab button for Line & LoS mode |
| `tb-tool-probe` | Tab button for Signal Probe mode |
| `tb-tool-region` | Tab button for Area Coverage mode |
| `tb-tool-obstacle` | Tab button for 3D Barrier mode |
| `terrain-measure-btn` | Action button in transect pane |
| `tb-probe-pick-btn` | Action button in probe pane |
| `terrain-region-btn` | Action button in region pane |
| `tb-obs-place-btn` | Action button in obstacle pane |
| `tb-step-guide-banner` | Terse status guide banner |
| `tb-picking-bar` | Floating top-center picking banner |
| `tb-picking-label` | Status text inside picking banner |
| `tb-picking-finish-btn` | Finish button inside picking banner |
| `tb-picking-cancel-btn` | Cancel/Esc button inside picking banner |
| `map-active-tool-bar` | Floating map active tool selector |
| `tb-bar-transect` / `tb-bar-probe` / `tb-bar-region` / `tb-bar-obstacle` / `tb-bar-exit` | Buttons in map active tool selector |
| `terrain-toolbox` | Right-hand docked inspector in `.detail-viewport` |
| `terrain-toolbox-panel` | Controls panel in docked inspector |
| `terrain-toolbox-drawer` | Analysis results drawer in docked inspector |

---

## 7. Verification Strategy & Acceptance Criteria

1. **Static Analysis & Typecheck:** `npm run typecheck` passes with zero diagnostics.
2. **Suite 99 (`src/tests/verifyDirectToolboxUx.ts`):**
   - Validates all 5 `.tb-rail-btn` buttons have universal SVGs, `data-tb-label`, `data-tb-key`, and zero emojis.
   - Validates CSS hover flyout rule in `frontend/c2-console-theme.css` has zero `!important`, zero `backdrop-filter: blur`, and zero `< 10px` fonts.
   - Validates keyboard shortcut guards prevent hijacking `Ctrl+R`, `Ctrl+P`, `Ctrl+A` or form inputs.
   - Validates 1-click auto-arm state transitions.
3. **Multi-Viewport Playwright Test (`scripts/verify-browser-ux.mjs`):**
   - 1-click auto-arming verified across all 4 viewports (`1440×900`, `1366×768`, `1024×768`, `780×840`).
   - Ruler, Probe, and Area workflows pass with 1-click direct manipulation.
4. **Comprehensive Test Suite:** `npm run verify:all` passes all 99 suites.
