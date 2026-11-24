# Specification V3-12: V3-11 Finding Closure, Expanded 9-Tab + 5-Biome Playwright E2E Matrix, Native Node V8 Coverage Reporter & V3.0 Grand Sync

## 1. Context & Motivation

This specification defines the final release milestone (**V3-12**) for the Tactical X-Band Air-to-Ground Network Digital Twin (Release V3.0):

1. **V3-11 Auditor Finding Closure:**
   - **Finding 1:** In `index.html` within `drawSensitivitySweepScope(frame)`, an undefined symbol reference `updateSensitivityTable` was corrected to pass `$('sci-sweep-active-readout')` into `renderSensitivitySweepScope()`.
   - **Finding 2:** In `src/core/offlineTileProtocol.ts`, `parseOfflineTileRequestUrl` now strictly rejects URLs containing query strings or URL fragment hashes (`parsed.search || parsed.hash`), with explicit regression tests added to Suite 113 (`src/tests/verifyParityServerAndOfflineTiles.ts`).

2. **Expanded 9-Tab + 5-Biome Playwright Browser E2E Matrix (`scripts/verify-browser-ux.mjs`):**
   - Retains all existing 4 viewport gates (`1440×900`, `1366×768`, `1024×768`, `780×840`) ensuring zero layout regressions, zero overflow, and zero uncaught console errors.
   - Augments the Desktop (`1440×900`) viewport run with live interactive smoke verifications:
     - Sequential activation and visibility of all 9 rail tabs: `#tab-btn-overview`, `#tab-btn-scheduler`, `#tab-btn-network`, `#tab-btn-terrain`, `#tab-btn-terminal`, `#tab-btn-authoring`, `#tab-btn-doc`, `#tab-btn-registration`, `#tab-btn-soldier`.
     - Multi-Biome switching: `#dem-sector-select` switching to `arabian_maritime` and reverting to `ladakh`.
     - Hi-Fi Physics master toggle: clicking `#btn-hifi-all-toggle` and verifying `#toggle-hifi-attitude` becomes checked.
     - Closed-loop Digital Twin Auto-Calibration: in `#tab-doc` (LAB), invoking `#btn-cal-auto-solve` and asserting `#cal-verdict-badge` displays `CERTIFIED_TWIN` and `#cal-rmse-val` displays `dB`.
     - Command Palette modal (`Ctrl+K`): triggering `Control+k`, confirming `#c2-cmd-palette-modal` displays, typing `maritime`, verifying candidate filter list results ($\ge 1$), and dismissing cleanly via `Escape`.
     - 3D Volumetric RF HUD: switching to 3D mode (`#btnView3D`), verifying HUD controls `#btn-3d-fresnel`, `#btn-3d-lobes`, and `#btn-3d-volumes`, and asserting aria-pressed toggle state.

3. **Zero-Dependency Native Node V8 Coverage Reporter (`scripts/run_v8_coverage.mjs`):**
   - Implements native V8 code coverage collection utilizing Node.js built-in `NODE_V8_COVERAGE` without adding heavy external npm dependencies (e.g., c8 or nyc).
   - Executes a representative fast core-engine test batch across propagation, geodesy, diffraction, mobility, scheduling, calibration, and GIS persistence.
   - Aggregates block- and function-level coverage metrics across `src/core/*.ts`, prints a formatted console table, writes structured JSON to `benchmark_results/generated/v8-coverage-summary.json`, and cleans up temporary coverage files in a `finally` block.
   - Exposes `npm run verify:coverage`.

4. **V3.0 Grand Sync & Release Readiness Quality Gate (`src/tests/verifyReleaseV3Readiness.ts` — Suite 114):**
   - Synchronizes `README.md` to reflect the complete V3.0 Multi-Terrain Tactical Digital Twin capabilities:
     - Live interactive GitHub Pages demo link: `https://justanoobcat.github.io/tactical-xband-digital-twin/`
     - GitHub Actions CI status badge (`https://github.com/JustAnoobCat/tactical-xband-digital-twin/actions/workflows/ci.yml/badge.svg`)
     - Canonical verification counts: exact 114 TypeScript verification suites, 27 Python pytest suites, 4-viewport Playwright matrix.
     - Accurate command runbook: `npm run server:ts`, `npm run verify:coverage`, `npm run benchmark:scientific`.
     - Zero broken local markdown links.
   - Introduces Suite 114 (`src/tests/verifyReleaseV3Readiness.ts`) enforcing:
     - `[REL-T1]` Documentation & Link Integrity: All local markdown links in `README.md` resolve to disk; live demo URL and CI badge present; exact 114 suite count; all 12 specs (`v3-01` to `v3-12`) present.
     - `[REL-T2]` Suite Registry & Package Parity: `scripts/run_all_verifications.mjs` registers exact 114 suites; `package.json` contains required scripts.
     - `[REL-T3]` Global Architecture & Zero-Slop Invariant Gate: `src/worker/simWorker.ts` strictly `< 3,300` lines; `index.html` has zero duplicate IDs, zero external CDN links, zero emojis; `frontend/c2-console-theme.css` has zero `!important` and zero `backdrop-filter: blur`; `electron/main.cjs` preserves sandboxing and `xband-tile` isolation.

---

## 2. Architectural Invariants

1. **Active Authoritative Runtime:** Live mutable simulation physics remains strictly in `src/worker/simWorker.ts` (3,281 lines) at 50 Hz ($\Delta t = 20\text{ ms}$). `simWorker.ts` remains completely untouched.
2. **Zero New External Dependencies:** V8 coverage parsing and E2E verifications rely strictly on native Node.js APIs (`fs`, `path`, `os`, `child_process`) and existing Playwright tooling.
3. **Strict Sandboxing & Offline Isolation:** Electron configuration maintains `sandbox: true`, `contextIsolation: true`, and strictly rejects external network destinations.
4. **Link & Documentation Integrity:** All local links in documentation must resolve to real files on disk without dead references.

---

## 3. Verification Plan

1. `node --check electron/main.cjs`
2. `node --check scripts/run_v8_coverage.mjs`
3. `npm run typecheck`
4. `npx tsx src/tests/verifyParityServerAndOfflineTiles.ts` (Suite 113)
5. `npx tsx src/tests/verifyReleaseV3Readiness.ts` (Suite 114)
6. `npm run verify:coverage`
7. `pytest -v`
8. `npm run build`
9. `node scripts/verify-browser-ux.mjs`
10. `npm run verify:all`
