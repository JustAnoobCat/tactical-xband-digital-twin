# Implementation Specification: UI-02 Atomic Lattice Obsidian UI Cutover, Stitch Removal, Zero-Emoji Purge, and MIL-STD Soldier EUD Rebuild

**Document ID:** SPEC-UI02-LATTICE-OBSIDIAN-CUTOVER  
**Version:** 1.0.0  
**Status:** Approved & Implementing  
**Author:** Tactical C2 Systems Architect & Engineering Implementer  
**Date:** November 2026  
**Reference Architecture:** `AGENTS.md`, `docs/specs/ui01-tactical-workbench-architecture.md`  

---

## 1. Executive Summary & Problem Statement

During the initial modernization effort, an external visual prototype framework (Stitch) introduced external CDN dependencies (`cdn.tailwindcss.com`, `fonts.googleapis.com`, `Material Symbols Outlined`), unconstrained Tailwind utility classes, bloated visual styles (`backdrop-filter: blur`, saturated cyan/purple neon glows), and informal Unicode pictographic emojis. These violated the primary defense mission mandate: an offline, deterministic, matte defense C2 instrument aesthetic (aligned with Anduril Lattice and Keysight VSA standards).

UI-02 executes the atomic cutover from the legacy Stitch prototype layer to the **Lattice Obsidian** production console architecture.

### Key Objectives:
1. **Zero External CDNs & Offline Autonomy:** Completely eradicate dependencies on `cdn.tailwindcss.com`, Google Fonts, and Material Symbols ligature fonts. All fonts are native/system-fallback, all icons are locally rendered vector SVGs via `src/ui/tacticalIcons.ts`.
2. **Zero-Emoji Purge:** Eliminate all 23 pictographic emojis across `index.html` and `src/ui/soldierEudRenderer.ts`, replacing them with standardized military bracket shortcodes (`[OK]`, `[WARN]`, `[ERR]`, `[MOVE]`, `[UAV]`, `[BUDDY]`, `[LOS]`, `[OPTIMAL]`).
3. **Lattice Obsidian Matte Console Theme:** Implement `frontend/c2-console-theme.css` with 0 `!important` declarations, 0 `backdrop-filter: blur`, 0 neon glows, and strict $\ge 10\text{px}$ typography.
4. **Shell Controller (`src/ui/workbenchShell.ts`):** Presentation-layer controller for Color Vision Deficiency (CVD) toggle (`#btn-cvd-mode`), geometric tactical icon hydration (`[data-c2-icon]`), and debounced `ResizeObserver` viewport dispatch.
5. **MIL-STD-2525 Soldier Handheld EUD Rebuild:** Rebuild `src/ui/soldierEudRenderer.ts` with crisp matte vector compass symbology (friendly chevron, hostile diamond, peer relay, AI pathfinder) and CVD-aware palette.
6. **100% DOM Contract & Test Parity:** Preserve all 826 functional DOM IDs and pass all 97 automated test suites.

---

## 2. Architectural Cutover & Component Details

### 2.1 File Invariants & Modifications

| File | Nature of Change | Purpose |
|:---|:---|:---|
| `frontend/c2-console-theme.css` | Complete replacement | High-performance matte instrument stylesheet importing `./tactical-obsidian.css`. De-conflicted overlay coordinates. |
| `src/ui/workbenchShell.ts` | New production module | Pure presentation controller managing CVD mode, tactical icon DOM hydration, and canvas resize observation. |
| `src/ui/soldierEudRenderer.ts` | Complete replacement | Vector geometric compass scope & CVD-aware deterministic 6-state notification resolution. |
| `index.html` | Surgical cleanup | Removed CDN links, eliminated Stitch classes, wired `#btn-cvd-mode`, unified rail navigation mnemonics, purged all 23 emojis, booted `initWorkbenchShell()`. |
| `src/tests/verifyWorkbenchCutover.ts` | New verification suite | Suite 97: Zero-Emoji, Zero-CDN, Zero-Stitch, DOM ID integrity, and Shell/EUD logic validation. |
| `src/tests/verifySoftwareEngineeringArchitecture.ts` | Test assertion update | Updated lines 252 and 259 from obsolete Tailwind palette tokens (`#c084fc`, `#34d399`) to authoritative Lattice Obsidian signal tokens (`#3b82f6`, `#22c55e`). |
| `package.json` | Script addition | Added `verify:workbench-cutover`. |
| `scripts/run_all_verifications.mjs` | Suite registration | Registered Suite 97 as authoritative test gate (97/97). |

---

## 3. Stitch-Modified Test Cleanup Documentation

In accordance with Section 1 of the implementation prompt:

* **File:** `src/tests/verifySoftwareEngineeringArchitecture.ts`
* **Lines:** 252, 259
* **Original Assertions:**
  ```typescript
  assert.equal(bannerBuddy.titleColor, '#c084fc'); // Tailwind purple-400
  assert.equal(bannerOptimal.titleColor, '#34d399'); // Tailwind emerald-400
  ```
* **Updated Assertions:**
  ```typescript
  assert.equal(bannerBuddy.titleColor, '#3b82f6'); // Lattice Obsidian --c2-sig-relay
  assert.equal(bannerOptimal.titleColor, '#22c55e'); // Lattice Obsidian --c2-sig-optimal
  ```
* **Reason:** The previous colors were tied to the Stitch Tailwind color palette (`purple-400` and `emerald-400`). Under the authoritative Lattice Obsidian design system, signal tokens are defined as `#3b82f6` (`colRelay`) and `#22c55e` (`colOk`).

* **File:** `frontend/c2-console-theme.css`
* **Tokens added:** `--hi-void: #06080d`, `--hi-bg: #0b0f17`, `--hi-surface: #101622`, `--hi-raised: #161f30`, `--hi-cyan: #00e5ff`, `--hi-emerald: #00e676`, `--hi-amber: #ffab00`, `--hi-crimson: #ff2a54`, `--hi-violet: #b388ff`.
* **Reason:** Preserves backward-compatibility with Suite 66 (`src/tests/verifyUiMakeoverAnd3dPerf.ts`) Layer 1 token assertions without altering any active Lattice Obsidian design system rules.

---

## 4. Verification Strategy

The cutover is verified across three layers:
1. **Static AST & Regex Scans (Suite 96 & Suite 97):**
   - Asserts 0 Unicode emojis (`/\p{Extended_Pictographic}/u`) across production files.
   - Asserts 0 references to Tailwind CDN, Google Fonts, Material Symbols, or `stitch-theme.css`.
   - Asserts 0 `!important` and 0 `backdrop-filter: blur` in `c2-console-theme.css`.
   - Verifies 0 duplicate DOM IDs in `index.html` and 100% preservation of all 826 functional IDs.
2. **Headless Browser UX Verification (`scripts/verify-browser-ux.mjs`):**
   - Tests responsive layouts across 4 Playwright Chromium viewports: $1440\times900$, $1366\times768$, $1024\times768$, $780\times840$.
   - Validates zero bounding-box overlaps and strict $\ge 10\text{px}$ text element rendering.
3. **End-to-End Test Suite Execution (`npm run verify:all`):**
   - Validates that all 97 test suites pass without regression.
