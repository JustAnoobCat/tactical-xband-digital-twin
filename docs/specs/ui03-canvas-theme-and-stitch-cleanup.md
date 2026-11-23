# Implementation Specification: UI-03 Unified Canvas Obsidian/CVD Theme, Live Playwright CVD/Air-Gap Checks & Dead Stitch Artifact Cleanup

**Document ID:** SPEC-UI03-CANVAS-THEME-AND-STITCH-CLEANUP  
**Version:** 1.0.0  
**Status:** Approved & Implementing  
**Author:** Tactical C2 Systems Architect & Engineering Implementer  
**Date:** November 2026  
**Reference Architecture:** `AGENTS.md`, `docs/specs/ui01-tactical-workbench-architecture.md`, `docs/specs/ui02-lattice-obsidian-cutover.md`

---

## 1. Executive Summary & Problem Statement

Phase UI-02 successfully established the **Lattice Obsidian** CSS design system and presentation shell controller, purging emojis and legacy CDN references from the primary markup and stylesheets. However, several canvas rendering modules (`src/ui/soldierEudRenderer.ts`, `src/ui/scientificScopesRenderer.ts`, `src/ui/dataCommVisualization.ts`) still relied on hardcoded hex literals or legacy color palettes, resulting in inconsistent styling, non-synchronized Color Vision Deficiency (CVD) adaptations across 2D scopes, and memory allocation overhead.

Furthermore, several dead Stitch prototyping files remained on disk (`frontend/stitch-theme.css`, `docs/specs/SPEC-CODEBASE-DRIVEN-STITCH-UI-OVERHAUL.md`, `docs/stitch_reference/`, `scripts/capture_live_redesign_screenshots.mjs`), introducing cognitive clutter and potential security/audit concerns.

Phase **UI-03** accomplishes four core objectives:
1. **Unified Canvas Theme Architecture (`src/ui/canvasTheme.ts`):** Implements a zero-allocation, pre-frozen canvas palette registry (`LATTICE_CANVAS_STANDARD` and `LATTICE_CANVAS_CVD`) matching `c2-console-theme.css` tokens and meeting WCAG 2.1 AA ($\ge 4.5:1$) contrast against `#0d1015`.
2. **2D Scope Alignment:** Refactors `soldierEudRenderer.ts`, `scientificScopesRenderer.ts`, and `dataCommVisualization.ts` to consume `getLatticeCanvasPalette()`, guaranteeing real-time CVD adaptability and identical matte MIL-STD/Obsidian visuals with 0 per-frame allocations.
3. **Live Playwright CVD & Air-Gap Verification (`scripts/verify-browser-ux.mjs`):** Integrates live browser request interception verifying zero network calls to external CDNs (`cdn.tailwindcss.com`, `fonts.googleapis.com`, `fonts.gstatic.com`) and validates live `#btn-cvd-mode` toggling, DOM dataset synchronization, and `localStorage` reload persistence.
4. **Dead Stitch Artifact Deletion & Suite 98 Gate:** Completely purges all 4 dead Stitch artifacts after static audit and codifies Suite 98 (`src/tests/verifyUiPolishAndCleanup.ts`) to prevent regressions.

---

## 2. Architecture & Seams

### 2.1 Palette Registry (`src/ui/canvasTheme.ts`)
The palette registry provides pre-frozen, immutable palette objects for both `'standard'` and `'colorblind-safe'` modes:
- `voidBg`: `#080a0d` (Canvas outer background)
- `panelBg`: `#0d1015` (Instrument well background)
- `cardBg`: `#12161d` (Substrate card)
- `gridMajor`: `#222a36` (Major polar / Cartesian gridlines)
- `gridMinor`: `#19202a` (Minor division ticks)
- `axisStroke`: `#3b4b61` (Axes and reference lines)
- `textPrimary`: `#e6edf3` (Primary labels — 16.1:1 contrast)
- `textSecondary`: `#9ba8ba` (Secondary annotations — 7.9:1 contrast)
- `textMuted`: `#78879c` (Axis unit legends — 5.2:1 contrast)
- `accent`: `#38bdf8` (Command / ACN accent)
- `accentFill`: `rgba(56, 189, 248, 0.14)`
- Standard Signals:
  - `optimal`: `#22c55e` (8.4:1 contrast)
  - `degraded`: `#eab308` (9.9:1 contrast)
  - `critical`: `#f97316` (6.8:1 contrast)
  - `outage`: `#ef4444` (5.1:1 contrast)
  - `relay`: `#3b82f6` (5.2:1 contrast)
- CVD Signals (Wong / Okabe-Ito optimized for protanopia, deuteranopia, tritanopia):
  - `optimal`: `#4ade80` (10.9:1 contrast)
  - `degraded`: `#facc15` (12.4:1 contrast)
  - `critical`: `#fb923c` (8.4:1 contrast)
  - `outage`: `#ec4899` (5.4:1 contrast)
  - `relay`: `#818cf8` (6.4:1 contrast)

### 2.2 Scope Consumption
- **`soldierEudRenderer.ts`:** Consumes `getLatticeCanvasPalette()`. Dial background, concentric range rings, azimuth ticks, ownship reticle, friendly ACN chevron, hostile jammer diamond, and peer relay markers read dynamically from the active palette, ensuring instantaneous redraw when CVD mode is toggled.
- **`scientificScopesRenderer.ts`:** Consumes `getLatticeCanvasPalette()`. Polar radiation grid, link waterfall budget bars, delay ECDF curves, parametric sensitivity curves, and worker jitter histogram bars adapt immediately to Obsidian well styling and CVD mode.
- **`dataCommVisualization.ts`:** Consumes `getLatticeCanvasPalette()` for link and status rendering.

### 2.3 Forensic Test Compatibility Contract (`verify:data-comm`)
In `src/tests/verifyDataCommVisualization.ts`, line 1978 explicitly asserts:
```typescript
const queueExpiredBadge = recorder.filledTexts.find((t) => t.text.includes('[✕ QUEUE EXPIRED]'));
assert.ok(queueExpiredBadge !== undefined, 'Node badge must display [✕ QUEUE EXPIRED]');
```
Additionally, lines 3255, 3346, and 3370 assert specific fill styles for transfer status badges (`TX [FLUSH]`, `SYNC`, `DL`).
To maintain 100% test compatibility with `verify:data-comm` (76/76 passing), the exact badge text `[✕ QUEUE EXPIRED]` and `[✓ COMPLETE]` are preserved in `src/ui/dataCommVisualization.ts`, while link strokes and unasserted canvas elements consume `getLatticeCanvasPalette()`.

---

## 3. Dead Stitch Artifact Cleanup Inventory

The following 4 untracked artifacts from the early Stitch prototype are verified to have zero runtime references and are permanently deleted:
1. `frontend/stitch-theme.css`: Obsolete Tailwind utility bundle replaced by `c2-console-theme.css`.
2. `docs/specs/SPEC-CODEBASE-DRIVEN-STITCH-UI-OVERHAUL.md`: Superseded specification replaced by `ui01-tactical-workbench-architecture.md` and `ui02-lattice-obsidian-cutover.md`.
3. `docs/stitch_reference/`: Obsolete prototype mockups and design notes.
4. `scripts/capture_live_redesign_screenshots.mjs`: Legacy prototype screenshot script targeting non-existent Stitch DOM elements.

---

## 4. Verification Plan (Suite 98 & Browser UX)

1. **Suite 98 (`src/tests/verifyUiPolishAndCleanup.ts`):**
   - `[UIP-T1]` Unified Canvas Theme & WCAG Contrast:
     - Confirms `LATTICE_CANVAS_STANDARD` and `LATTICE_CANVAS_CVD` are frozen singletons.
     - Confirms zero-allocation reference identity (`===`).
     - Confirms all signal and text tokens achieve $\ge 4.5:1$ contrast against `panelBg` (`#0d1015`) via `computeWcagContrastRatio`.
   - `[UIP-T2]` Dead Stitch Artifact Purge Gate:
     - Confirms none of the 4 files exist on disk.
     - Confirms zero active imports/references to `stitch-theme.css` in production code.
   - `[UIP-T3]` Zero-Emoji Sweep Across Polished UI Modules:
     - Asserts 0 Unicode emojis (`/\p{Extended_Pictographic}/u`) in `canvasTheme.ts`, `soldierEudRenderer.ts`, `scientificScopesRenderer.ts`, `workbenchShell.ts`, and `tacticalIcons.ts`.
2. **Live Browser UX (`scripts/verify-browser-ux.mjs`):**
   - Live network interception asserting 0 external CDN requests.
   - Live `#btn-cvd-mode` toggle, `aria-pressed`, `textContent`, `document.documentElement.dataset.cvdMode`, and page reload persistence via `localStorage`.
