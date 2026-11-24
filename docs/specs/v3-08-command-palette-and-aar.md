# SPEC-V3-08: Frontier Command Palette (Ctrl+K), After-Action Review (AAR) Briefing Exporter & Secondary-Tab Obsidian Polish

## 1. Executive Summary & Authoritative Seams
This specification defines the architectural and mathematical implementation for:
1. **Frontier Command Palette (`Ctrl+K` / `Cmd+K`):** A headless-testable, keyboard-driven tactical command orchestrator allowing rapid navigation across all 9 workspaces, biome switching, physics model toggling, 3D layer activation, cartographic tools, and telemetry exports without touching the mouse.
2. **One-Click After-Action Review (AAR) Tactical Mission Briefing Exporter:** A deterministic reporting engine that compiles live multi-seed scheduler ablation KPIs, 3GPP 5QI QoS SLA verification, active physical/EW model stacks, and ground fleet MGRS positions into publication-ready Markdown (`.md`) and air-gapped, zero-CDN printable HTML (`.html`).
3. **Secondary-Tab Obsidian Polish & DOM Hygiene:** Zero `!important`, zero `backdrop-filter: blur`, zero neon glows, zero font sizes $< 10\text{px}$, zero emojis, and air-tight XSS neutralization across all dynamic user/telemetry inputs.

### Authorized Seams & Scope Bounds
- `docs/specs/v3-08-command-palette-and-aar.md` (Specification document)
- `src/ui/commandPaletteEngine.ts` (Pure command catalog, prefix/fuzzy ranking, and keyboard reducer)
- `src/core/aarBriefingGenerator.ts` (Pure AAR Markdown and air-gapped printable HTML generator)
- `frontend/c2-console-theme.css` (Matte Lattice Obsidian styling for modal and topbar button)
- `index.html` (Topbar button `#btn-command-palette`, modal `#c2-cmd-palette-modal`, AAR export buttons `#btn-export-aar-md` and `#btn-export-aar-html`, global keyboard shortcuts)
- `src/tests/verifyCommandPaletteAndAar.ts` (Suite 110 verification suite)
- `package.json` & `scripts/run_all_verifications.mjs` (Suite 110 registration)
- **Immutable Files:** `src/worker/*` (preserves `simWorker.ts` strictly at 3,281 lines), `src/core/linkBudget.ts`, `src/core/rfPropagationMath.ts`, `src/core/geodesy.ts`, `src/core/biomePhysics.ts`, `src/core/scheduler.ts`, `src/ui/three/*`, `core/*`, `server/*`, `electron/*`.

---

## 2. Command Palette Architectural Contract

### 2.1 Command Schema & Catalog
Each command is represented by an immutable structure:
```ts
export type PaletteCommandCategory = 'NAV' | 'BIOME' | 'PHYSICS' | 'TOOLS' | 'SIM' | 'EXPORT';

export interface PaletteCommand {
  readonly id: string;
  readonly category: PaletteCommandCategory;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly shortcut?: string;
  readonly actionId?: string;
}
```

The catalog `DEFAULT_PALETTE_COMMANDS` contains $\ge 24$ authoritative tactical actions:
- **Workspaces (`NAV`):** OPS / Mission Overview (`1`), TDMA / Scheduler (`2`), NET / Network Performance (`3`), RF / Terrain & RF (`4`), NODES / Terminals & VSA (`5`), PLAN / Scenario Authoring (`6`), ANALYTICS / Comparative Analytics (`7`), CAL / Twin Calibration (`8`), LAB / Technical Reference & Diagnostics (`9`).
- **Biomes (`BIOME`):** Ladakh Alpine Mountain, Kargil Valley Corridor, Thar Arid Desert, Indo-Gangetic Open Plains, Northeast Tropical Jungle, Arabian Sea Maritime Littoral.
- **Cartographic & 3D Tools (`TOOLS`):** 2D/3D Toggle (`T`), CVD Colorblind Palette, 3D Fresnel Ellipsoids, 3D Banking Sector Lobes, 3D EW & Storm Volumes, Tactical MGRS Grid, Distance Ruler (`R`), Cursor Probe (`P`), Area Swath (`A`), CAD Obstacle Barrier (`B`), Pan / Navigate (`N`).
- **Physics & EW (`PHYSICS`):** Toggle High-Fidelity All Models (Shadowing, Rician, Feedback, ABR, Dubins, Viewshed), Toggle Biome EM Ground Reflection.
- **Simulation Transport (`SIM`):** Pause / Resume (`Space`), Reset Theater, Execute Kargil Transit Profile, Auto-Calibrate Digital Twin Residuals.
- **Mission Export (`EXPORT`):** Save Scenario JSON v3, Export OGC KML 2.2, Export DoD CoT XML 2.0, Export After-Action Review Markdown, Print After-Action Review HTML.

### 2.2 Deterministic Ranking Algorithm
The query string is normalized ($q = \text{trim}(\text{lower}(Q))$):
1. **Empty Query ($q = \varnothing$):** Returns all commands in canonical order with baseline score $1$.
2. **Exact Label Prefix:** If $\text{label}$ begins with $q$, $\text{score} = 100 + \max(0, 10 - (\text{len}(\text{label}) - \text{len}(q)))$.
3. **Word-Boundary Match:** If any word in $\text{label}$ starts with $q$, $\text{score} = 70 + \max(0, 5 - \text{offset})$.
4. **Label Substring:** If $\text{label}$ contains $q$, $\text{score} = 50$.
5. **Category Prefix / Match:** If $\text{category}$ starts with $q$, $\text{score} = 40$.
6. **Keyword Match:** If any keyword starts with or contains $q$, $\text{score} = 35$.
7. **Subsequence Match:** If characters in $q$ occur sequentially in $\text{label}$, $\text{score} = 15 + \text{compactnessBonus}$.
8. **Deterministic Tie-Breaking:** Results sorted descending by score; ties resolve by canonical definition index.

### 2.3 Keyboard Navigation State Reducer
Given current selection index $i \in [-1, N-1]$, total matching count $N$, and key event:
- $N \le 0 \implies -1$
- `Home` $\implies 0$
- `End` $\implies N - 1$
- `ArrowDown` $\implies i < 0 \ ?\ 0 : (i + 1) \pmod N$
- `ArrowUp` $\implies i \le 0 \ ?\ N - 1 : i - 1$

---

## 3. After-Action Review (AAR) Briefing Generator

### 3.1 Mission Snapshot Schema (`AarMissionSnapshot`)
Captures complete operational state:
- **Metadata:** Mission title, ISO timestamp, active biome name, simulation elapsed time ($s$), total frames processed, active scheduler mode.
- **Comparative KPIs:** Tac-TAD vs. Static TDMA delivered megabits, throughput gain multiplier ($X$), average rate (Mbps), slot waste percentage, and packet drops.
- **3GPP 5QI QoS SLA Table:** P95 latency versus delay budget per traffic class (Voice 5QI-1: 100 ms, Telemetry 5QI-2: 150 ms, Video 5QI-4: 300 ms, Bulk 5QI-9: 500 ms) and overall compliance verdict.
- **High-Fidelity Physics Stack:** Boolean state of 11 physical models (Airframe shadowing, correlated Rician fading, MAC/PHY CSI feedback, transport ABR, Dubins aerodynamics, viewshed LOS, Biome EM ground reflection, ECCM frequency hopping, MVDR null-steering, multi-ACN constellation, MANET routing).
- **Ground Fleet Registry with MGRS:** Terminal ID, tactical callsign, geographic coordinates, calculated Military Grid Reference System (MGRS 1-meter precision via `geodeticToMgrs`), current quad-sector antenna allocation, modulation/coding (MODCOD), SINR (dB), and link state.
- **Digital Twin Calibration Residuals (Optional):** Pre-computed RMSE (dB), Pearson $r$, and validation verdict.

### 3.2 Output Formats & Air-Gap Mandate
1. **Markdown (`generateAarMarkdown`):** Clean, standard GitHub-flavored Markdown document formatted with structured headers and tables.
2. **Standalone HTML5 (`generateAarPrintableHtml`):**
   - **Zero External Resources:** 100% self-contained `<style>` block. No external web fonts, no CDN scripts, no tracking pixels.
   - **Print-Optimized (`@media print`):** Crisp black/white high-contrast typography, hidden interactive chrome, explicit page breaks before fleet tables.
   - **Strict XSS Sanitization:** Every dynamic string field is escaped through `escapeHtml` / `escapeAttr` (`src/ui/domSafety.ts`). Malicious strings like `<script>alert(1)</script>` or `<img onerror=...>` are rendered completely harmless.

---

## 4. UI / UX Integration & Design Guidelines

### 4.1 Command Palette Modal (`#c2-cmd-palette-modal`)
- Located as a fixed, centered dialog overlay (`z-index: 1000`).
- Background: solid `#080a0d` backdrop with `0.8` opacity (zero blur).
- Frame: matte `#0f131a` surface, `1px solid #37455a` border, `4px` border radius, `0 16px 40px rgba(0,0,0,0.7)` drop shadow.
- Search input: auto-focused `#c2-cmd-palette-input` with hairline border, monospace placeholder, and clear button.
- Command list: scrollable `#c2-cmd-palette-list` with `role="listbox"`, hairline item separators, category badge, command label, and shortcut indicator pill.
- Focused item `.is-selected`: highlighted with `rgba(56, 189, 248, 0.15)` and cyan left border indicator.

### 4.2 Topbar Trigger Button (`#btn-command-palette`)
- Compact monospace button labeled `CMD` placed in `.topbar-right` beside `.sim-controls`.
- Styled consistently with existing topbar controls (`min-height: 24px`, font size `11px`, border radius `2px`).
- Tooltip and `aria-label`: "Open Command Palette (Ctrl+K)".
- Verified to maintain $> 48\text{px}$ clearance and zero element wrapping across all 4 Playwright screen dimensions (`1440×900`, `1366×768`, `1024×768`, `780×840`).

---

## 5. Verification Suite 110 Architecture
Suite 110 (`src/tests/verifyCommandPaletteAndAar.ts`) verifies:
- **[CPA-T1] Command Palette Fuzzy Ranking & Keyboard Reducer:**
  - Validates $\ge 24$ registered commands with unique IDs.
  - Verifies exact prefix outranks substring and subsequence (`"ruler"` $\to$ Ruler #1, `"maritime"` $\to$ Maritime Biome #1, `"aar"` $\to$ Export AAR #1).
  - Verifies empty query returns all commands in canonical order.
  - Verifies circular wrap-around and boundary handling for `ArrowDown`, `ArrowUp`, `Home`, and `End`.
  - Micro-benchmark: 1,000 queries complete in $< 15\text{ ms}$ ($< 15\ \mu\text{s/query}$).
- **[CPA-T2] AAR Markdown & Standalone Air-Gap HTML Generator:**
  - Verifies all ablation KPIs, 5QI QoS SLA verification, and physics stack are formatted.
  - Verifies auto-derived MGRS coordinates (`43S ...` for Ladakh $34.5^\circ\text{N}, 76.5^\circ\text{E}$).
  - Verifies zero `NaN`, zero `undefined`, zero external `http://` or `https://` CDN URLs in printable HTML.
  - Tests XSS injection neutralization: payloads like `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` are strictly sanitized.
- **[CPA-T3] DOM Hygiene, CSS Hygiene & Zero-Emoji Contract:**
  - Validates presence and attributes of `#btn-command-palette`, `#c2-cmd-palette-modal`, `#c2-cmd-palette-input`, `#btn-export-aar-md`, `#btn-export-aar-html`.
  - Verifies zero duplicate DOM IDs in `index.html`.
  - Scans `frontend/c2-console-theme.css` to confirm zero `!important` declarations, zero `backdrop-filter: blur`, and zero neon glows.
