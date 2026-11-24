# Specification V3-09: De-Monolithizing index.html Part 1 — Strict TypeScript UI Controllers

## 1. Context & Motivation

The `index.html` file in the Tactical X-Band Air-to-Ground Network Digital Twin repository grew to over 21,000 lines, containing a mixture of DOM structure, CSS styles, and a large inline `<script type="module">` block executing simulation coordination, telemetry rendering, mission input/output, digital-twin calibration, and user interaction.

While high-frequency worker loops operate strictly in `src/worker/simWorker.ts` (3,281 lines) at 50 Hz ($\Delta t = 20\text{ ms}$), the UI layer's inline script in `index.html` suffered from:
1. **Limited Static Analysis:** Inline script code in `index.html` is not fully verified during `npm run typecheck` (`tsc --noEmit`), allowing potential type drift or uncaught regressions.
2. **Untestable DOM Updaters:** Telemetry updaters and mission I/O routines embedded in inline script blocks could not be directly unit-tested without loading the entire 21,000-line HTML file into a browser runner.
3. **Monolithic Complexity:** Over 1,000 lines of business logic for telemetry display, calibration plotting, GIS/CoT export, and the Command Palette were mixed together with worker message plumbing.

**SPEC-V3-09** begins Phase 1 of de-monolithizing `index.html` by extracting three coherent, modular, and strictly typed TypeScript UI controllers:
- `src/ui/controllers/telemetryDomUpdaters.ts`: High-frequency and telemetry DOM updaters (HiFi physics, biomes, constellation mobility, 5QI QoS SLAs, fleet table with signature diffing, and aggregate throughput).
- `src/ui/controllers/missionIoController.ts`: Mission Scenario JSON export/import, Military GIS (KML & ATAK Cursor-on-Target XML) export, GeoTIFF upload, AAR Markdown/HTML export, and Digital-Twin Calibration UI + Canvas oscilloscope.
- `src/ui/controllers/commandPaletteController.ts`: `Ctrl+K` Frontier Command Palette DOM lifecycle, keyboard event delegation, search ranking, and command execution dispatching.

---

## 2. Architectural Invariants & Seams

1. **Active Authoritative Runtime:** Live mutable simulation state remains strictly in `src/worker/simWorker.ts`. These UI controllers operate strictly on the main thread, receiving telemetry snapshots and emitting outbound worker commands or downloading files.
2. **Worker State Authority & Line Count:** `src/worker/simWorker.ts` must remain untouched at exactly 3,281 lines.
3. **Type Safety & Zero `any` Abuse:** All extracted controllers import exact typed interfaces from:
   - `src/shared/workerProtocol.ts` (`HiFiTelemetryUpdateMessage`, `WorkerInboundCommand`, `TelemetryMessage`, etc.)
   - `src/core/digitalTwinCalibrationEngine.ts` (`FieldTrialTracePoint`, `TwinCalibrationReport`, etc.)
   - `src/core/militaryGisEngine.ts` (`TacticalSnapshot`, `exportKmlPlacemarks`, `exportCursorOnTargetXml`)
   - `src/core/aarBriefingGenerator.ts` (`AarMissionSnapshot`, `generateAarMarkdown`, `generateAarPrintableHtml`, `fmtInt`)
   - `src/ui/commandPaletteEngine.ts` (`DEFAULT_PALETTE_COMMANDS`, `filterAndRankCommands`, `stepPaletteSelection`)
4. **XSS & DOM Safety:** All dynamic text written to the DOM must use `textContent` or `escapeHtml` / `escapeAttr` from `src/ui/domSafety.ts`.
5. **DOM Contract Preservation:** 100% of existing DOM element IDs, classes, and global bindings referenced in HTML inline attributes (`onchange="onBiomeEmToggleChange(this.checked)"`, `onclick="toggleAllHiFiPhysics()"`, `window.isMgrsGridActive`, etc.) are preserved.
6. **Zero Performance Regression:** High-frequency 50 Hz DOM manipulation (e.g. fleet table rendering) preserves DOM signature-diffing (`lastOpsFleetSignature`) to eliminate unnecessary DOM mutations and garbage collection pauses.
7. **Monolith Reduction Target:** Extracting these controllers must achieve a net reduction of $\ge 700$ lines in `index.html`.

---

## 3. Module Specifications

### 3.1 `src/ui/controllers/telemetryDomUpdaters.ts`

Extracted from inline functions handling telemetry rendering:
- `updateHiFiPhysicsUI(data: Partial<HiFiTelemetryUpdateMessage>): void`: Updates telemetry indicators for airframe shadowing, correlated Rician fading, MAC/PHY CSI feedback, transport ABR, viewshed ray-marching, and biome ground reflections.
- `updateBiomePhysicsUI(data: any): void`: Updates biome name, ground permittivity $\epsilon_r$, conductivity $\sigma$, ground reflection loss, roughness loss, and fog/dust extinction.
- `updateConstellationMobilityUI(data: any): void`: Updates ACN constellation telemetry, Dubins turning radius, orbit period, and ISL inter-relay connectivity status.
- `updateOpsQosSlaUI(kpi: any): void`: Updates 3GPP 5QI SLA compliance metrics, real-time latencies vs. budgets, and pass/fail indicators.
- `renderOpsFleetRegistry(nodes: readonly any[], selectedNodeId?: number | string | null): void`: Renders ground terminal fleet table rows (`#ops-fleet-tbody`) using signature-diffing to avoid re-rendering identical states, attaching node selection clicks.
- `updateTopbarAggregateThroughput(rxGoodputMbps: number): void`: Updates topbar telemetry badges with formatted link speed.
- `resetTelemetryDomState(): void`: Resets cached signatures and telemetry indicators on simulation reset.

Factory:
```ts
export interface TelemetryDomUpdatersDeps {
  onSelectNode?: (nodeId: number | string) => void;
  documentRef?: Document;
}

export function createTelemetryDomUpdaters(deps?: TelemetryDomUpdatersDeps): {
  updateHiFiPhysicsUI: (data: Partial<HiFiTelemetryUpdateMessage>) => void;
  updateBiomePhysicsUI: (data: any) => void;
  updateConstellationMobilityUI: (data: any) => void;
  updateOpsQosSlaUI: (kpi: any) => void;
  renderOpsFleetRegistry: (nodes: readonly any[], selectedNodeId?: number | string | null) => void;
  updateTopbarAggregateThroughput: (rxGoodputMbps: number) => void;
  resetTelemetryDomState: () => void;
};
```

### 3.2 `src/ui/controllers/missionIoController.ts`

Extracts mission scenario persistence, military GIS export, AAR briefing export, and digital-twin calibration:
- **Scenario JSON I/O:** `exportScenarioJson(state: any): void` and `importScenarioJson(file: File, onLoad: (data: any) => void): void`.
- **Military GIS Export:** Generates and triggers browser downloads for `.kml` (Google Earth / FalconView) and `.cot.xml` (ATAK / WinTAK / Android Team Awareness Kit).
- **AAR Briefing Export:** Gathers active simulation telemetry into `AarMissionSnapshot`, invoking `generateAarMarkdown` or `generateAarPrintableHtml` and initiating file downloads with status feedback (`#aar-export-status`).
- **Digital Twin Calibration & Oscilloscope:** Binds `#btn-run-calibration`, `#btn-apply-calibration-offsets`, `#btn-synthetic-field-trace`, and renders the empirical vs. simulated SINR scatter/residual plot on `#twin-calibration-scope` (HTML5 `<canvas>`).

Factory:
```ts
export interface MissionIoControllerDeps {
  postWorkerCommand: (cmd: WorkerInboundCommand) => void;
  getCurrentSimulationState: () => any;
  documentRef?: Document;
}

export function initMissionIoController(deps: MissionIoControllerDeps): {
  exportScenario: () => void;
  exportKml: () => void;
  exportCotXml: () => void;
  exportAarMarkdown: () => void;
  exportAarHtml: () => void;
  runCalibration: (trace: FieldTrialTracePoint[]) => TwinCalibrationReport | null;
  drawCalibrationScope: (points: readonly FieldTrialTracePoint[], simulatedSinrs: readonly number[]) => void;
};
```

### 3.3 `src/ui/controllers/commandPaletteController.ts`

Extracts the modal dialog lifecycle, keyboard shortcuts (`Ctrl+K`, `Cmd+K`, Arrow keys, Enter, Esc), query filtering, and command dispatching:
- **Catalog & Matching:** Uses `DEFAULT_PALETTE_COMMANDS` and `filterAndRankCommands` from `src/ui/commandPaletteEngine.ts`.
- **Keyboard Reducer:** Uses `stepPaletteSelection` for cyclic navigation across filtered items.
- **Action Dispatcher:** Maps command IDs (`nav:*`, `biome:*`, `tools:*`, `sim:*`, `export:*`) to application actions provided via an action map, strictly verifying all commands are bound.

Factory:
```ts
export interface CommandPaletteControllerDeps {
  actionMap: Record<string, () => void>;
  documentRef?: Document;
}

export function initCommandPaletteController(deps: CommandPaletteControllerDeps): {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  filter: (query: string) => void;
  selectIndex: (index: number) => void;
  executeSelected: () => void;
  dispose: () => void;
};

export function verifyAllPaletteCommandsBound(actionMap: Record<string, () => void>): {
  valid: boolean;
  missingCommands: string[];
};
```

---

## 4. Verification Plan (Suite 111)

Suite 111 (`src/tests/verifyTypedUiControllersPart1.ts`) verifies:
1. **[TUC-T1] Telemetry DOM Updaters:**
   - Headless DOM unit tests for `updateHiFiPhysicsUI`, `updateBiomePhysicsUI`, `updateConstellationMobilityUI`, `updateOpsQosSlaUI`.
   - Fleet registry rendering with signature-diffing: verifying that identical telemetry does not mutate DOM elements, while changed telemetry updates cells in-place with strict XSS sanitization.
   - Node selection callback firing on row click.
2. **[TUC-T2] Mission I/O & Calibration Controller:**
   - Generation and validation of KML Placemark XML, ATAK CoT XML event schemas, and Scenario JSON structures.
   - Generation and verification of AAR snapshot and export downloads without `NaN` or unescaped strings.
   - Canvas scope drawing and mathematical residual calculation in digital-twin calibration.
3. **[TUC-T3] Command Palette Controller:**
   - All 40 default commands in `DEFAULT_PALETTE_COMMANDS` have corresponding handlers in the action map (`verifyAllPaletteCommandsBound`).
   - Modal open/close state transitions, query filtering, keyboard navigation stepping, and selection execution under mock DOM.
4. **[TUC-T4] Monolith Line Count & Static Contract Audit:**
   - Verification that `index.html` line count has decreased by $\ge 700$ lines net.
   - Verification that all required DOM IDs, classes, and global bindings (`window.onBiomeEmToggleChange`, `window.toggleAllHiFiPhysics`, `window.isMgrsGridActive`, etc.) are intact.
   - Zero `any` in the three new controller files.
