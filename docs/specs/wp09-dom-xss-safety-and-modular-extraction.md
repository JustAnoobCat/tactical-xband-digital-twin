# SPEC-WP09: Reusable DOM/XSS Safety Layer and Pure Worker Modular Decomposition

**Specification Document:** `docs/specs/wp09-dom-xss-safety-and-modular-extraction.md`  
**Status:** Approved  
**Execution Lead:** Role 2 Coder / Implementer  
**Classification:** DOM Security & XSS Neutralization / Web Worker Separation of Concerns / Pure Stateless Extraction / Zero-Regression Invariants  
**Applies to Modules:**
- `src/ui/domSafety.ts` (create)
- `src/ui/timelineFrameInspector.ts` (harden)
- `src/ui/scientificScopesRenderer.ts` (harden)
- `src/ui/workbench/mapLayersPanel.ts` (harden)
- `src/worker/workerCommandValidators.ts` (create)
- `src/worker/workerKpiHelpers.ts` (create)
- `src/worker/simWorker.ts` (delegate & shrink)
- `src/tests/verifyDomSafetyAndModularity.ts` (create — Suite 93)

---

## 1. Executive Summary & Problem Formulation

### 1.1 Context & Motivation
The Tactical X-Band Air-to-Ground Network Digital Twin renders real-time mission telemetry, terrain profiles, link budgets, RF waveforms, and dynamic tactical events. In the active UI layer, dynamic strings (node callsigns, telemetry warnings, file names, obstacle labels, and diagnostic texts) are projected into the DOM.

Unescaped dynamic string interpolations into DOM sinks (`innerHTML`, `insertAdjacentHTML`, and CSS attribute/color properties) introduce severe Cross-Site Scripting (XSS) and CSS injection vulnerabilities. For instance:
- An adversarial or malformed node callsign or DEM file name containing `<script>alert(1)</script>` or `<img src=x onerror=alert(1)>` could execute arbitrary script in the user's browser session.
- An unescaped CSS color string containing `; background: url(javascript:...)` or breaking out of style attributes could manipulate page styling or exfiltrate DOM tokens.

Concurrently, the background simulation worker (`src/worker/simWorker.ts`) has grown to ~3,455 lines of code, accumulating disparate responsibilities including:
1. Active discrete-event stepping (50 Hz, $\Delta t = 20\text{ ms}$).
2. Complex inbound IPC command payload validation, range clamping, and parameter normalization.
3. Quantile delay computation, scheduler epoch metric extraction, and spatial snapshot composition.

Per §1 of `AGENTS.md`, all mutable live simulation state must remain strictly authoritative within the Web Worker. However, pure validation and KPI formatting logic should be decomposed into dedicated, 100% pure, stateless helper modules to maintain software engineering modularity, readability, and unit testability without altering simulation physics, thread state, or determinism.

---

## 2. Invariants & Scope Boundaries

### 2.1 Preserved Workspace & Uncommitted File Boundary
- **STRICT EXCLUSION:** Per `AGENTS.md` and user instructions, dirty/uncommitted Stitch UI overhaul files (specifically `src/ui/soldierEudRenderer.ts`, `index.html`, `frontend/*`, etc.) **MUST NOT BE EDITED**.
- Clean files under `src/ui/*.ts` that contain unescaped dynamic HTML sinks (`src/ui/timelineFrameInspector.ts`, `src/ui/scientificScopesRenderer.ts`, and `src/ui/workbench/mapLayersPanel.ts`) are hardened.

### 2.2 Worker Authority & Pure Helper Invariants
- **Zero Mutable State:** Any module extracted under `src/worker/` (`workerCommandValidators.ts`, `workerKpiHelpers.ts`) contains **zero** top-level `let` or `var` mutable bindings and **zero** calls to `Math.random()`.
- **Worker Authority (§1 AGENTS.md):** All simulation state (queues, nodes, trajectories, timers, random generators) remains strictly enclosed within `src/worker/simWorker.ts`.
- **Zero Physics/Math Mutation:** No modifications to RF link budgets, Fresnel profiles, diffraction calculations, or DVB-S2X MODCOD tables.
- **IPC Contract Preservation:** Zero changes to `WorkerInboundCommand` or `WorkerOutboundMessage` schemas; all test-asserted DOM IDs, CSS classes, inline styles, and `data-*` attributes remain byte-for-byte intact.

---

## 3. DOM & XSS Safety Layer Architecture (`src/ui/domSafety.ts`)

`src/ui/domSafety.ts` provides a zero-dependency, high-performance security primitive suite designed to run in $< 1\text{ µs/call}$:

### 3.1 `escapeHtml(value: unknown): string`
Safely converts any input (`null`, `undefined`, numbers, objects, strings) into an HTML-escaped string:
- `&` $\rightarrow$ `&amp;`
- `<` $\rightarrow$ `&lt;`
- `>` $\rightarrow$ `&gt;`
- `"` $\rightarrow$ `&quot;`
- `'` $\rightarrow$ `&#39;`
- `` ` `` $\rightarrow$ `&#96;`
- `null` / `undefined` return `''`.

### 3.2 `escapeAttr(value: unknown): string`
Strict HTML attribute escaping. In addition to the characters escaped by `escapeHtml`, it strips or escapes ASCII control characters `\x00-\x1F` and `\x7F`, as well as line breaks `\r` and `\n`, neutralizing attribute breakout and quote injection vectors.

### 3.3 `sanitizeLabel(value: unknown, maxLen = 64, fallback = 'UNKNOWN'): string`
Sanitizes arbitrary user or telemetry labels (e.g., UAV callsigns, `.hgt` filenames, CAD obstacle names):
1. Converts to string, removes ASCII control characters `[\x00-\x1F\x7F]`.
2. Collapses whitespace sequences to a single space and trims edges.
3. Falls back to `fallback` if the resulting string is empty.
4. Truncates to `maxLen` code points safely.
5. Applies `escapeHtml` for safe inclusion in markup.

### 3.4 `sanitizeCssColor(value: unknown, fallback = '#94a3b8'): string`
Strictly validates CSS color strings:
- Allows hex colors: `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`.
- Allows functional numeric syntax: `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`.
- Allows safe CSS variable references: `var(--[a-zA-Z0-9_-]+)`.
- Rejects any string containing `;`, `{`, `}`, `url(`, `expression(`, `javascript:`, or control characters.
- Returns `fallback` for any rejected candidate.

### 3.5 `safeHtml` Tagged Template & `TrustedHtml` Brand
Provides a tagged template literal `safeHtml`:
```typescript
const html = safeHtml`<div class="badge">${userInput}</div>`;
```
- Interpolated values are automatically escaped via `escapeHtml` unless they are explicitly typed instances of `TrustedHtml` created via `trustedHtml(staticMarkup)`.
- Eliminates accidental XSS injection in multi-line template string construction while permitting composition of trusted sub-templates.

### 3.6 `createSafeElement(tag, attrs?, textContent?)`
Safe DOM node creation helper using native `document.createElement`, `setAttribute` with escaped attributes, and `textContent` assignment, preventing `innerHTML` usage entirely for leaf elements.

---

## 4. UI Sink Audit & Hardening Matrix

| File | Line(s) | Original Sink | Hardening Strategy |
| :--- | :--- | :--- | :--- |
| `src/ui/timelineFrameInspector.ts` | 679–684 | `container.innerHTML = ...` (empty state) | Replace with static `safeHtml` template. |
| `src/ui/timelineFrameInspector.ts` | 724–875 | `container.innerHTML = html` (dynamic metrics) | Use `safeHtml` and `escapeHtml` for all interpolated variables: `statusBadgeText`, `semanticWarning`, `modcodName`, eviction fields, comparison deltas, etc. |
| `src/ui/scientificScopesRenderer.ts` | 813–818 | `readoutElement.innerHTML = ...` | Escape `axisCfg.xLabel` and `axisCfg.unit` via `escapeHtml`; wrap static labels in `safeHtml`. |
| `src/ui/workbench/mapLayersPanel.ts` | 73, 157 | `buttonEl.innerHTML = <svg>...` | Wrap verified static SVG strings in `trustedHtml`. |
| `src/ui/workbench/mapLayersPanel.ts` | 196 | `swatch.style.backgroundColor = def.swatchColor` | Apply `sanitizeCssColor(def.swatchColor)`. |

---

## 5. Web Worker Modular Decomposition

Two cohesive, strictly pure helper modules are extracted from `src/worker/simWorker.ts`:

### 5.1 `src/worker/workerCommandValidators.ts`
Contains pure, stateless validators for inbound commands:
- `validateConfigUpdateParams(...)`: Validates and normalizes parameters for `SET_PARAMS`, `CONFIG_UPDATE`, and `UPDATE_PARAMS`. Validates numeric keys, altitude modes, frequencies, bandwidths, rain rate, climb/descent rates, orbit axes, speed/acceleration limits, TDMA config objects, and waypoint arrays.
- `validateNodeMoveCommand(...)`: Validates node ID and theater boundary constraints ($\pm 600{,}000\text{ m}$) for `NODE_MOVE`.
- `validateTrafficInjectionCommand(...)`: Validates target node registration and traffic profile types.
- `validatePresetId(...)`: Validates and normalizes scenario preset identifiers (`ACN_ONLY`, `16_NODES`, `OCCLUSION`, `AMBUSH`, `MONSOON`, `RESET`).
- `validateScientificParamsCommand(...)`: Clamps DEM error ($[0, 25]\text{ m}$), traffic load ($[0.25, 8.0]$), and Earth $k$-factor ($[0.5, 10.0]$).
- `validateViewshedConfigCommand(...)`: Normalizes viewshed and active relay toggles.

### 5.2 `src/worker/workerKpiHelpers.ts`
Contains pure KPI calculation and snapshot composition utilities:
- `computeDelayQuantiles(nodes, simTimeS)`: Calculates 7-point Hol delay quantiles ($p_{10}, p_{25}, p_{50}, p_{75}, p_{90}, p_{95}, p_{99}$) across QoS classes.
- `extractSchedulerEpochMetrics(report, nodes, simTimeS)`: Extracts queue depth, backlog bytes, mean HOL sojourn time, throughput, and packet drop counts for static and tactical schedulers.
- `createSuperframeEpochRecord(...)`: Pure factory for constructing `SuperframeEpochRecord` with covered frame ranges and scheduler metrics.
- `buildSpatialFrameSnapshot(...)`: Pure builder for `SpatialFrameSnapshot`, transforming live kinematics, attitude, node obstruction results, and selected link budgets into serializable snapshots.

### 5.3 Shrink & Modularity Metrics
- Line reduction in `src/worker/simWorker.ts`: $\ge 250$ lines removed.
- State purity: Zero module-level `let`/`var` variables; zero `Math.random()`.
- Determinism: 100% bit-exact output for identical simulation seeds.

---

## 6. Verification Suite 93 (`src/tests/verifyDomSafetyAndModularity.ts`)

Suite 93 verifies all requirements across 5 gates:
1. **Gate 1: XSS Neutralization:** Verifies `escapeHtml`, `escapeAttr`, `sanitizeLabel`, and `safeHtml` neutralize payload vectors (`<script>`, `onerror`, `onload`, event handler attributes, null bytes, NaN/null/undefined).
2. **Gate 2: CSS Injection Neutralization:** Verifies `sanitizeCssColor` accepts legitimate hex, rgb/rgba, hsl/hsla, and `var(--...)` tokens while strictly rejecting malicious payloads (`;`, `{`, `}`, `url(...)`, `expression(...)`, `javascript:`).
3. **Gate 3: Static Architecture & Clean File Gate:** Verifies that hardened `src/ui/*.ts` files import `domSafety.ts`, dirty `src/ui/soldierEudRenderer.ts` was not modified, and extracted `src/worker/*.ts` helper files contain zero top-level `let`/`var` mutable state and zero `Math.random()`.
4. **Gate 4: Extracted Worker Helper Unit Tests:** Exercises `workerCommandValidators.ts` and `workerKpiHelpers.ts` across normal, boundary, and malformed inputs.
5. **Gate 5: Performance Micro-Benchmark:** 50,000 sequential `escapeHtml` and `sanitizeLabel` calls complete in $< 50\text{ ms}$ ($< 1\text{ µs/call}$).
