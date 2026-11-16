# SPEC-COMPREHENSIVE-51-POINT-UX-POLISH: Comprehensive 51-Point Tactical Digital Twin UX, Cross-Tab Synchronization, Pointer Conflict & Ergonomic Polish Upgrade

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity)  
**Target Runtimes:** `index.html`, `src/tests/verifyComprehensive51PointUxPolish.ts`, `package.json`, `scripts/run_all_verifications.mjs`, `README.md`  

---

## 1. Executive Summary & Operational Context

In high-tempo military and electronic warfare operations within high-relief mountainous topography such as the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$), operators, commanders, and communications engineers require seamless, high-contrast, deterministic decision-support interfaces. 

Following a comprehensive two-pass UX audit across the entire tactical digital twin application (`index.html`), 51 concrete usability, accessibility, cross-tab synchronization, pointer conflict, and micro-interaction deficiencies were identified:
- **Pass 1 (Areas A–D, 29 findings):** Map Viewport & Toolbar (`A-1`–`A-6`), Terrain Toolbox Ergonomics & 12px Readability (`B-1`–`B-6`), Right-Hand Workspaces Tabs 1–8 Feedback (`C-1`–`C-8`), and Top Bar / Timeline / Global Keyboard Polish (`D-1`–`D-9`).
- **Pass 2 (Areas E–G, 22 findings):** Cross-Tab Node Selection Synchronization (`E-1`–`E-4`), Pointer / Gesture & Stage Viewport Mode Conflicts (`F-1`–`F-4`), and Deep Tab Workspaces Inspection (`G-1`–`G-14`).

This specification formalizes the concrete architecture, state-machine event contracts, DOM layouts, and automated verification suites necessary to deliver a military-grade, WCAG-compliant, zero-confusion operational interface while strictly preserving authoritative Web Worker simulation state, 50 Hz discrete-event loop execution, and global page layouts.

---

## 2. Architecture & Seam Specifications

### 2.1 Cross-Tab Node Selection Synchronization (`Area E`)
- **`E-1` NTN Node Dropdown Synchronization:** `syncNodeDropdowns(nid)` is expanded to include `'ntn-node-select'`. When `selectedNodeId` mutates, `selectedNtnNodeId` is set to `nid` and `renderNtnSignalingPanel()` is invoked, keeping Tab 8 (Registration) synchronized with map selections.
- **`E-2` Multi-Selection Preservation in Network Tab:** In `handleNodeSelection()`, auto-selection of `#network-node-select` only executes when fewer than 2 options are currently selected, preserving operator `Ctrl+click` multi-node comparison sets. Adds `size="4"` and hint text (`G-12`).
- **`E-3` Registration Table Reverse-Sync:** Click event delegation on `#registration-table tbody` routes row selection to `handleNodeSelection(nodeId)`, highlighting the node on the radar canvas and across all tabs.
- **`E-4` RF Waterfall Badge Immediate Update:** `#wf-target-node-badge` updates synchronously in `handleNodeSelection(nid)` regardless of Tab 4 visibility state.

### 2.2 Map Canvas Pointer Mutual Exclusion & Mode Transitions (`Area F`)
- **`F-1` 3D Mode Tool Cancellation Banner:** When transitioning to 3D (`setStageViewMode('3d')`) with an active tool session, `#edit-mode-banner` displays an informative notice: `"2D Terrain Tool closed — switched to 3D Terrain view."`
- **`F-2` Seg-Button Mode Awareness:** Range buttons (`30 km`, `60 km`, `100 km`, `200 km`) are disabled in MapLibre and 3D modes with `.seg button:disabled { opacity: 0.38; cursor: not-allowed; }` and tooltip `Range zoom — 2D Radar mode only`.
- **`F-3` 3D View Center Action:** In 3D mode, the `Center` button focuses on the active theater origin / ACN.
- **`F-4` Pointer Event Priority & Mutual Exclusion:** In `#radar-canvas` `mousedown`, when `tbOpen && tbActiveMode !== 'dem'`, terrain tool picking returns early, preventing simultaneous obstacle or waypoint hit-testing.

### 2.3 Map Toolbar, Node Inspector & Toolbox Ergonomics (`Area A` & `Area B`)
- **`A-1` & `A-2` Obstacle Sync & Spatial Lock Polish:** `#obstacle-map-tool` syncs with `🧱 Build 3D Barrier` in the toolbox. `#btn-spatial-lock` uses clear icon + text (`🔓 Lock Scenario` / `🔒 Scenario Locked`) with `.active` class while preserving `aria-pressed`.
- **`A-3` & `A-4` Node Details Empty State & Action Polish:** `.map-node-actions` and `.node-rf-quick-toggles` hide when `#map-node-details` has `.is-empty`. Action buttons update to `Link Performance ↗`, `◎ LOS Overlay`, and `〰 Fresnel Zone`.
- **`A-5` & `A-6` Heatmap Tooltip & Active Bar Accessibility:** `#toggle-viewshed-heatmap` has explicit SINR tooltip; `.map-tool-pill-btn` buttons feature `tabindex="0"` and aria announcements.
- **`B-5` Toolbox 12px Readability:** Control typography across `.terrain-toolbox-panel` and `#terrain-toolbox.terrain-toolbox-viewport` is upgraded from `10px` to `12px`.
- **`B-1` to `B-4` Toolbox Control Labels:** Labels updated to `⛰ Terrain Navigate`, `TX Mast (m AGL)`, `RX Mast (m AGL)`, `🗺 Click to Place`, and em-dash fallback metrics.
- **`B-6` Active Map Pick Highlighting:** Radar container applies an accent border and crosshair cursor during active picking.

### 2.4 Top Bar, Timeline & Keyboard Polish (`Area D`)
- **`D-1` Dynamic Play/Pause Button:** `#btn-pause` text dynamically renders `▶ RESUME` / `RESUME` when paused and `⏸ PAUSE` / `PAUSE` when running while preserving `.active` and `aria-pressed`.
- **`D-2` Historical Live Return Button:** `#timeline-btn-live` renders `↩ Return to Live` during historical inspection and `● LIVE` during real-time mode.
- **`D-3` CSV Export Feedback:** `#timeline-btn-export-csv` displays `⬇ Export CSV` with tooltip and `"Exported ✓"` visual feedback.
- **`D-4` Monospace Playback Speed Readout:** `#sim-speed-readout` removes `sr-only` to display clean `1.0×` monospace text.
- **`D-6` Interactive Health Tallies:** `.health-chip` elements gain `role="button"`, `tabindex="0"`, pointer cursor, and jump to Tab 5 (Terminals) inventory on click.
- **`D-7` to `D-9` Expert/Help & Global Keyboard Shortcuts:** Dynamic `aria-pressed` on `#btn-expert`, keyboard shortcut strip in `#welcome`, and global shortcuts: `T` (Toolbox), `M` (Focus Map), `?` (Help/Welcome), `Esc` (Exit Tool).

### 2.5 Tab Workspaces Feedback & Polish (`Area C` & `Area G`)
- **`C-1` & `C-2` Scheduler Hints & Polar Legend:** Explanatory hint under `#waterfall-canvas`; expanded `Handovers:` label in `#polar-scope-readout`.
- **`C-3` & `C-4` Traffic Injection Feedback & 5QI Labels:** `"✓ Injected!"` transient feedback; human-first 5QI labels (`C2 Command · 5QI-69`, `Voice PTT · 5QI-65`, `Video Stream · 5QI-67`, `Photo ISR · 5QI-70`).
- **`C-5` to `C-8`, `G-13`, `G-14` Canvas Hints & Empty States:** Interactive hints under profile canvases, uncluttered authoring details blocks, `"Copied LaTeX ✓"` feedback, and clean empty states for registration tables and summary.
- **`G-1`, `G-2`, `G-9`, `G-10` Action Feedback & JSON Capping:** `"Starting…"` scenario feedback, two-step `"Confirm Clear ↩"` on `#experiment-clear`, `"Computing…"` on Relay Advisor, and `max-height: 55vh; overflow-y: auto;` on `#diag-raw-json-pre`.

---

## 3. Verification Protocol & Acceptance Criteria

Suite 80 (`src/tests/verifyComprehensive51PointUxPolish.ts`) verifies:
1. **UXP-T1 (Cross-Tab Node Sync & Pointer Mutual Exclusion):**
   - `syncNodeDropdowns` includes `'ntn-node-select'` and updates `selectedNtnNodeId`.
   - `#registration-table` rows trigger `handleNodeSelection`.
   - `#wf-target-node-badge` updates on selection.
   - Range buttons disable in non-radar modes.
2. **UXP-T2 (Toolbox 12px Typography & Control Polish):**
   - `#terrain-toolbox` uses `12px` control font size (`B-5`).
   - `#tb-tool-dem` is labeled `Terrain Navigate`.
   - TX/RX mast labels include `(m AGL)`.
   - `.map-node-actions` is hidden when `.is-empty`.
3. **UXP-T3 (Topbar Pause/Resume, Speed Readout, Live Return, & Feedback):**
   - `togglePause` toggles `PAUSE` / `RESUME`.
   - `#sim-speed-readout` is visible (not `sr-only`).
   - `#timeline-btn-live` toggles `Return to Live`.
   - `.health-chip` elements have `role="button"` and `tabindex="0"`.
   - `#diag-raw-json-pre` has `max-height`.
4. **UXP-T4 (Spec Persistence & Invariants):**
   - `docs/specs/SPEC-COMPREHENSIVE-51-POINT-UX-POLISH.md` exists and is linked in `README.md`.
   - `frontend/c2-console-theme.css` is untouched.
