# Specification V3-10: De-Monolithizing index.html Part 2 — Strictly Typed 2D Radar Renderer & Direct-Manipulation Terrain Toolbox Controller

## 1. Context & Motivation

Following Phase 1 of de-monolithizing `index.html` (SPEC-V3-09, which extracted `telemetryDomUpdaters.ts`, `missionIoController.ts`, and `commandPaletteController.ts`), the main application document `index.html` still contained over 23,000 lines. The largest monolithic clusters remaining in inline `<script>` blocks were:
1. **2D Radar Canvas Rendering & Overlays (~3,150 lines):**
   - Pure coordinate transforms (`getRadarGeometry`, `worldToScreen`, `screenToWorld`)
   - 4 CAD Precision Tool overlays:
     - Tool #1: Geodetic & RF Ruler overlay (`renderGeodeticRulerOverlay`)
     - Tool #2: Precision Cursor Signal Probe overlay (`renderPrecisionCursorProbeOverlay`)
     - Tool #3: Area of Operations (AO) Swath Coverage overlay (`renderPrecisionAoSwathOverlay`)
     - Tool #4: CAD Precision Obstacle & Link Slicer overlay (`renderPrecisionCadObstacleOverlay`)
   - The master `drawRadar()` drawing pipeline: backdrop, elevation contours, range rings, cardinal marks, MGRS 10km grid, link rays, Fresnel zones, obstruction markers, constellation relays, primary ACN track, and ground nodes.
   - Radar canvas link/node hit-testing and dragging/zooming event handlers.
2. **Direct-Manipulation Terrain Toolbox Controller (~1,880 lines):**
   - 1-Click auto-arming state transitions (`setTbMode(mode, autoArm)`)
   - Keyboard hotkey dispatching (`V/R/P/A/B/Enter/Esc`) with strict editable target guards (`isEditableKeyboardTarget`)
   - Interactive scientific calculations: Transect profile evaluation, Signal Probe analysis, Zonal statistics & peak finder, Bridge relay candidate search, and DEM provenance display.
   - Interactive drawing state: Waypoint placement, vertex dragging, rubber-band lines, obstacle handle positioning, and polygon closure.
   - Inspector drawer DOM rendering and action gates.

**SPEC-V3-10** executes Phase 2 of de-monolithizing `index.html` by extracting two high-performance, strictly typed TypeScript controllers:
- `src/ui/controllers/radar2dRenderer.ts`: Strictly typed 2D radar coordinate transforms, layer visibility filtering, CAD precision overlay rendering, `canvasLabelPlacer` collision avoidance, `cartographyRenderer` scale bar/MGRS integration, and hit-testing.
- `src/ui/controllers/terrainToolboxController.ts`: Strictly typed 1-click direct-manipulation toolbox state machine, Figma-style keyboard shortcuts (`V/R/P/A/B/Enter/Esc`), scientific evaluation engines, direct-manipulation vertex/handle editing, and XSS-safe drawer rendering.

---

## 2. Architectural Invariants & Seams

1. **Active Authoritative Runtime:** Live mutable simulation physics remains strictly in `src/worker/simWorker.ts` (3,281 lines) at 50 Hz ($\Delta t = 20\text{ ms}$). All worker computation remains authoritative.
2. **Worker State Authority & Line Count:** `src/worker/simWorker.ts` must remain untouched at exactly 3,281 lines.
3. **Pure Mathematical Transforms:** Coordinate transforms (`worldEnuToRadarCanvas`, `radarCanvasToWorldEnu`, `getRadarGeometry`) and hotkey resolvers (`resolveToolboxHotkeyAction`, `isEditableKeyboardTarget`) must be 100% pure, deterministic, and unit-testable headlessly without DOM or WebGL.
4. **Zero Per-Frame Leaks & High Performance:** 2D canvas drawing must generate minimal per-frame garbage, reusing pre-calculated paths and geometries where applicable.
5. **XSS & DOM Safety:** Every dynamic string interpolated into the DOM (e.g. drawer HTML, tooltips, statuses) must use `textContent` or `escapeHtml` / `escapeAttr` from `src/ui/domSafety.ts`.
6. **DOM Contract & Static Assertion Preservation:**
   - 100% of existing DOM element IDs, classes, and global bindings referenced by inline HTML attributes (`onclick`, `onchange`) are preserved.
   - Existing static test checks (such as `isEditableKeyboardTarget` in `src/tests/verifyDirectToolboxUx.ts`, `createLabelPlacer` in `src/tests/verifyCanvasDeclutterAndSecurity.ts`, and 3D mode guards in `src/tests/verifyUiMakeoverAnd3dPerf.ts`) are preserved via thin delegators and clean facades in `index.html`.
7. **Monolith Reduction Target:** Net line reduction in `index.html` must be $\ge 1,500$ lines.
8. **Test Concurrency Protection:** Micro-benchmark and CPU-sensitive suites (`verify:military-gis`, `verify:ew-eccm-lpi`, `verify:constellation-mobility`, `verify:three-volumetric-rf`, `verify:command-palette-aar`, `verify:digital-twin-calibration`, `verify:publication-dossier`, `verify:typed-ui-controllers-1`, `verify:typed-ui-controllers-2`) execute in `serialSuiteIds` in `scripts/run_all_verifications.mjs` to prevent thread starvation during parallel test runs.

---

## 3. Module Specifications

### 3.1 `src/ui/controllers/radar2dRenderer.ts`

#### Pure Transform Functions:
```ts
export interface RadarViewport {
  readonly width: number;
  readonly height: number;
  readonly rangeM: number;
  readonly panOffsetX_m?: number;
  readonly panOffsetY_m?: number;
}

export function getRadarGeometry(w: number, h: number, rangeM: number): {
  centerX: number;
  centerY: number;
  scale: number;
};

export function worldEnuToRadarCanvas(
  xM: number,
  yM: number,
  viewport: RadarViewport
): { x: number; y: number };

export function radarCanvasToWorldEnu(
  canvasX: number,
  canvasY: number,
  viewport: RadarViewport
): { xM: number; yM: number };
```

#### Pure Hit-Testing Utilities:
```ts
export function hitTestRadarLink(
  px: number,
  py: number,
  viewport: RadarViewport,
  acnPosWorld: { x: number; y: number },
  nodes: ReadonlyArray<{ nodeId: number; posX: number; posY: number }>,
  radiusPx?: number
): { nodeId: number; distance: number } | null;

export function hitTestRadarNode(
  px: number,
  py: number,
  viewport: RadarViewport,
  nodes: ReadonlyArray<{ nodeId: number; posX: number; posY: number }>,
  radiusPx?: number
): { nodeId: number; distance: number } | null;
```

#### Overlay Renderers:
- `renderPrecisionCadObstacleOverlay(ctx, w, h, deps)`: CAD obstacle footprints, handles, and 3D shadow extrusion.
- `renderGeodeticRulerOverlay(ctx, w, h, deps)`: Transect line, Fresnel zone clearance, blocking crests, and distance annotations.
- `renderPrecisionCursorProbeOverlay(ctx, w, h, deps)`: Cursor crosshair, probe radius circles, and real-time SNR readouts.
- `renderPrecisionAoSwathOverlay(ctx, w, h, deps)`: Area bounding box, grid cells, corner drag handles, and elevation/coverage statistics.

#### Controller Factory:
```ts
export interface Radar2dRendererDependencies {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  getRangeM: () => number;
  getPanOffset: () => { xM: number; yM: number };
  getStageViewMode: () => string;
  getTerrainMapMode: () => string;
  getLatestTelemetry: () => any;
  getHistoricalSnapshot: () => any;
  getMapLayerRegistry: () => any;
  getContextualMapContext: () => any;
  getSelectedNodeId: () => number | string | null;
  getToolboxState: () => any;
  isMgrsGridActive: () => boolean;
  onSelectNode?: (nodeId: number) => void;
  markDirty?: () => void;
}

export function createRadar2dRenderer(deps: Radar2dRendererDependencies): {
  renderRadar: () => void;
  worldToScreen: (x: number, y: number) => { x: number; y: number };
  screenToWorld: (px: number, py: number) => { x: number; y: number };
  radarLinkHit: (px: number, py: number, radiusPx?: number) => number | null;
  findCadObstacleHandleHit: (px: number, py: number) => any;
  findAoSwathCornerHit: (px: number, py: number, thresholdPx?: number) => string | null;
};
```

---

### 3.2 `src/ui/controllers/terrainToolboxController.ts`

#### Pure Input Guards & Hotkey Resolvers:
```ts
export function isEditableKeyboardTarget(target: EventTarget | null): boolean;

export function resolveToolboxHotkeyAction(
  key: string,
  opts?: {
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    isEditable?: boolean;
    is3d?: boolean;
  }
): 'cancel' | 'finish' | 'mode_dem' | 'mode_transect' | 'mode_probe' | 'mode_region' | 'mode_obstacle' | null;
```

#### State Machine & Auto-Arming:
- Modes: `'dem' | 'transect' | 'probe' | 'region' | 'obstacle'`
- Tool modes: `'idle' | 'transect-2pt' | 'transect-poly' | 'probe' | 'region' | 'obstacle-place'`
- 1-Click auto-arm parameter: `setTbMode(mode, autoArm = true)` automatically arms the tool mode and switches the active rail button and step guide banner.

#### Interactive Scientific Analyses:
- `recomputeTransect(isPreview?)`: Evaluates terrain elevation profile, Fresnel zone clearance, knife-edge diffraction loss, and geodetic curvature along the line.
- `recomputeProbeAnalysis()`: Computes multi-bearer RF link budget, line-of-sight status, and path loss to candidate node.
- `recomputeRegionZonal()`: Zonal terrain analysis across AO polygon, computing mean, min, max, slope distribution, and summit coordinates.
- `runBridgeFinder()`: Identifies optimal intermediate relay location between isolated nodes.
- `renderToolboxDrawer()`: Renders drawer content with XSS-safe string interpolation.

#### Controller Factory:
```ts
export interface TerrainToolboxControllerDeps {
  documentRef?: Document;
  windowRef?: Window;
  getTelemetry: () => any;
  getHistoricalSnapshot: () => any;
  getTerrainEngine: () => any;
  getObstacleEditor: () => any;
  sendCommand: (msg: any) => void;
  markRadarDirty: () => void;
  drawRadar: () => void;
  updateMapLibreToolSources?: () => void;
  updateMapLibreOverlay?: () => void;
}

export function createTerrainToolboxController(deps: TerrainToolboxControllerDeps): TerrainToolboxController;
```

---

## 4. Verification Suite 112 Contract (`src/tests/verifyTypedUiControllersPart2.ts`)

The implementation must pass 5 formal verification gates:
1. **[TUC2-T1] Pure Coordinate Transform & Inverse Invariants:**
   - `worldEnuToRadarCanvas` and `radarCanvasToWorldEnu` round-trip identity ($\Delta \le 1\times 10^{-4}\text{ m}$).
   - `getRadarGeometry` scale accuracy across standard radar ranges (15 km to 300 km).
   - Invariant aspect ratio: Center pixel maps exactly to pan offset.
2. **[TUC2-T2] Pure Hotkey Resolver & Editable Target Guard:**
   - Rejects keypresses when `ctrlKey`, `metaKey`, or `altKey` is active.
   - Rejects keypresses when targeting `input`, `textarea`, `select`, or `contenteditable` elements.
   - Rejects keypresses in 3D view mode (`is3d === true`).
   - Maps `Escape` $\to$ `'cancel'`, `Enter` $\to$ `'finish'`, `v/V` $\to$ `'mode_dem'`, `r/R` $\to$ `'mode_transect'`, `p/P` $\to$ `'mode_probe'`, `a/A` $\to$ `'mode_region'`, `b/B` $\to$ `'mode_obstacle'`.
3. **[TUC2-T3] Link & Node Hit-Testing Accuracy:**
   - Link hit detection finds closest link within `radiusPx`.
   - Node hit detection accurately discriminates nodes within proximity threshold.
4. **[TUC2-T4] XSS Safety & Zero-Slop Audit:**
   - All dynamic drawer output is verified to have zero unescaped HTML interpolation.
   - Zero emojis in all source files.
   - Zero duplicate DOM IDs.
5. **[TUC2-T5] Monolith Reduction & Static Assertion Preservation:**
   - `index.html` net line reduction $\ge 1,500$ lines.
   - Preserves required static test markers (`isEditableKeyboardTarget`, `createLabelPlacer`, 3D view guards).
   - Preserves 100% of DOM IDs and required `window.*` bindings.
