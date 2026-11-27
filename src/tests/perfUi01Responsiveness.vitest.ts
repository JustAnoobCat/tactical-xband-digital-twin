import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { shouldDeferSelectMutation } from '../ui/controllers/telemetryDomUpdaters';
import { createDashboardAndAuthoringController } from '../ui/controllers/dashboardAndAuthoringController';
import { createRadar2dRenderer } from '../ui/controllers/radar2dRenderer';
import { initWorkerBridgeController } from '../app/workerBridgeController';
import { SimulationWorkerManager } from '../worker/simWorker';
import type { AppContext } from '../app/appContext';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

interface MockOption {
  value: string;
  textContent: string;
  selected: boolean;
}

function createMockSelect(id: string) {
  const options: MockOption[] = [];
  let replaceCount = 0;
  let value = 'none';
  const dataset: Record<string, string> = {};
  const ownerDocument = { activeElement: null as unknown };

  const el = {
    id,
    tagName: 'SELECT',
    dataset,
    ownerDocument,
    get options() {
      return options;
    },
    get value() {
      return value;
    },
    set value(v: string) {
      value = v;
    },
    get replaceCount() {
      return replaceCount;
    },
    replaceChildren(...children: MockOption[]) {
      replaceCount++;
      options.length = 0;
      options.push(...children);
    },
  };
  return el;
}

function createMockCanvas2dContext() {
  const drawImageCalls: Array<{ img: unknown; args: number[] }> = [];
  const fillRectCalls: number[][] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    save() {},
    restore() {},
    setTransform() {},
    clearRect() {},
    fillRect(x: number, y: number, w: number, h: number) {
      fillRectCalls.push([x, y, w, h]);
    },
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    rect() {},
    clip() {},
    fill() {},
    stroke() {},
    setLineDash() {},
    fillText() {},
    measureText(t: string) {
      return { width: t.length * 6 };
    },
    drawImage(img: unknown, ...args: number[]) {
      drawImageCalls.push({ img, args });
    },
    drawImageCalls,
    fillRectCalls,
  };
  return ctx;
}

describe('PERF-UI-01: Dropdown Focus-Guard, 25 Hz Telemetry Profile, Static Radar Cache & CSS Hygiene', () => {
  it('defers <select> mutations while focused/interacting and skips redundant option rebuilds via optSig', () => {
    const mockDoc = {
      activeElement: null as unknown,
      createElement: () => ({ value: '', textContent: '', selected: false }),
    };
    const sel = createMockSelect('tb-obs-target-node-select');
    sel.ownerDocument = mockDoc;

    expect(shouldDeferSelectMutation(null)).toBe(false);
    expect(shouldDeferSelectMutation(sel as unknown as HTMLSelectElement)).toBe(false);

    mockDoc.activeElement = sel;
    expect(shouldDeferSelectMutation(sel as unknown as HTMLSelectElement)).toBe(true);

    mockDoc.activeElement = null;
    expect(shouldDeferSelectMutation(sel as unknown as HTMLSelectElement)).toBe(false);

    sel.dataset.selectInteracting = 'true';
    expect(shouldDeferSelectMutation(sel as unknown as HTMLSelectElement)).toBe(true);
    delete sel.dataset.selectInteracting;

    const origDocument = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = mockDoc;
    try {
      let currentNodes = [
        { node_id: 1, node_type: 'soldier', snr_db: 14.2 },
        { node_id: 2, node_type: 'mcp', snr_db: 19.5 },
      ];
      const ctrl = createDashboardAndAuthoringController({
        getElementById: (id: string) =>
          id === 'tb-obs-target-node-select' ? (sel as unknown as HTMLElement) : null,
        sendCommand: () => {},
        getSpatialLocked: () => false,
        isHistoricalInspecting: () => false,
        getTrajectoryEditor: () => null,
        getObstacleEditor: () => ({ draft: [], selectedId: null }),
        getObstacleHistory: () => null,
        getMainTerrainEngine: () => null,
        getLatestTelemetry: () => ({
          nodes_telemetry: currentNodes,
          acn_telemetry: { pos_x: 0, pos_y: 0, altitude_msl_m: 5000 },
        }),
        getSelectedNodeId: () => 1,
        setSelectedNodeId: () => {},
        onRedrawRadar: () => {},
        onUpdateMapLibreOverlay: () => {},
        onApplyMapLibreLayerState: () => {},
        onApplyThreeLayerVisibility: () => {},
        onSyncMapLegendVisibility: () => {},
        onSyncRadarHudMode: () => {},
        onUpdateMapLibreCursor: () => {},
        getActiveSensitivityAxis: () => 'bandwidth',
        getIsMouseInsideRadar: () => false,
        getMouseWorldPos: () => ({ x: 0, y: 0 }),
        getWaypointPlacementArmed: () => false,
        setWaypointPlacementArmed: () => {},
      });

      // Initial sync populates options and sets dataset.optSig
      ctrl.recomputeCadObstacleAnalysis();
      expect(sel.replaceCount).toBe(1);
      expect(sel.options.length).toBe(3);
      expect(sel.dataset.optSig).toBeTruthy();

      // Identical telemetry tick performs zero option rebuilds
      ctrl.recomputeCadObstacleAnalysis();
      expect(sel.replaceCount).toBe(1);

      // Changed telemetry while focused defers option rebuild and marks pendingOptSync
      currentNodes = [
        { node_id: 1, node_type: 'soldier', snr_db: 18.0 },
        { node_id: 2, node_type: 'mcp', snr_db: 21.0 },
      ];
      mockDoc.activeElement = sel;
      ctrl.recomputeCadObstacleAnalysis();
      expect(sel.replaceCount).toBe(1);
      expect(sel.dataset.pendingOptSync).toBe('1');

      // Once blurred, flush rebuilds cleanly with updated signature
      mockDoc.activeElement = null;
      delete sel.dataset.pendingOptSync;
      ctrl.recomputeCadObstacleAnalysis();
      expect(sel.replaceCount).toBe(2);
    } finally {
      (globalThis as Record<string, unknown>).document = origDocument;
    }
  });

  it('sends uiPublishIntervalTicks: 2 from frontend syncTelemetrySubscriptionProfile while standalone SimulationWorkerManager defaults to 1', () => {
    const standaloneWorker = new SimulationWorkerManager(() => {});
    expect(standaloneWorker.uiPublishIntervalTicks).toBe(1);

    const postedCommands: unknown[] = [];
    const actions: Record<string, unknown> = {};
    const mockCtx = {
      worker: {
        postMessage: (msg: unknown) => postedCommands.push(msg),
        onmessage: null,
      } as unknown as Worker,
      state: {
        latestTelemetry: { frame_index: 0, sim_time_s: 0 },
      } as AppContext['state'],
      engines: {
        mapLayerRegistry: { isLayerVisible: () => false },
        obstacleEditor: {},
        trajectoryEditor: {},
        historyController: {},
        simSpatialBuffer: {},
        simEpochStore: {},
        diagnosticsTracker: {},
        flightRecorder: { recordCommand: () => {}, getEventCount: () => 0 },
      } as unknown as AppContext['engines'],
      dom: {
        $: () => null,
        setText: () => {},
      } as unknown as AppContext['dom'],
      actions: actions as unknown as AppContext['actions'],
    } as AppContext;

    initWorkerBridgeController(mockCtx);
    (actions.syncTelemetrySubscriptionProfile as (tabId: string) => void)('tab-overview');

    expect(postedCommands).toHaveLength(1);
    expect(postedCommands[0]).toEqual({
      type: 'SET_TELEMETRY_PROFILE',
      subscriptions: {
        linkProfile: false,
        vsaConstellation: false,
        pduDissector: false,
        viewshed: true,
      },
      uiPublishIntervalTicks: 2,
    });
  });

  it('caches static radar background layer across ACN/sweep frames and invalidates on zoom, pan, and biome change', () => {
    const origDocument = (globalThis as Record<string, unknown>).document;
    const offscreenCtx = createMockCanvas2dContext();
    const offscreenCanvas = {
      width: 0,
      height: 0,
      getContext: () => offscreenCtx,
    };
    (globalThis as Record<string, unknown>).document = {
      createElement: () => offscreenCanvas,
    };

    try {
      const mainCtx = createMockCanvas2dContext();
      let rangeM = 60000;
      let panX = 0;
      let panY = 0;
      let biomeId = 'alpine_mountain';
      let acnX = 0;
      let sweepTimeS = 0.5;
      let tileGen = 1;

      const stubCanvas = {
        width: 800,
        height: 600,
        parentElement: { clientWidth: 800, clientHeight: 600 },
      } as unknown as HTMLCanvasElement;

      const renderer = createRadar2dRenderer({
        canvas: stubCanvas,
        ctx: mainCtx as unknown as CanvasRenderingContext2D,
        getRangeM: () => rangeM,
        getPanOffset: () => ({ xM: panX, yM: panY }),
        getStageViewMode: () => '2d',
        getTerrainMapMode: () => 'radar',
        getTerrainMode: () => 'real',
        getWorldTileLayer: () =>
          ({
            getLoadGeneration: () => tileGen,
            getLoadedTileCount: () => 0,
            isAirGapOfflineOnly: () => true,
            getOrigin: () => ({ latDeg: 34.5, lonDeg: 76.5 }),
            draw: () => 0,
          }) as unknown as ReturnType<NonNullable<Parameters<typeof createRadar2dRenderer>[0]['getWorldTileLayer']>>,
        getSweepTimeS: () => sweepTimeS,
        getLatestTelemetry: () => ({
          biome_id: biomeId,
          sim_time_s: sweepTimeS,
          acn_telemetry: { pos_x: acnX, pos_y: 500, coverage_radius_km: 35, heading_rad: 0 },
          nodes_telemetry: [],
        }),
        getHistoricalSnapshot: () => null,
        getActiveTerrainBounds: () => ({
          biomeId,
          centerLatDeg: 34.5,
          centerLonDeg: 76.5,
          halfWidthM: 150000,
          halfHeightM: 150000,
        }),
        getHillshadeCanvas: () => null,
        getBackdropCanvas: () => null,
        getBackdropMode: () => 'relief',
        getMapLayerRegistry: () => null,
        getContextualMapContext: () => ({}),
        getSelectedNodeId: () => -1,
        getToolboxState: () => ({}),
        getObstacleEditor: () => null,
        isMgrsGridActive: () => true,
      });

      // Frame 1: cold cache miss -> draws static background into offscreen buffer, blits 1 drawImage
      renderer.renderRadar();
      expect(renderer.getStaticCacheStats()).toMatchObject({ hits: 0, misses: 1 });
      expect(mainCtx.drawImageCalls.filter((c) => c.img === offscreenCanvas)).toHaveLength(1);

      // Frame 2 & 3: only ACN position and radar sweep phase move -> cache hits, zero offscreen redraws
      acnX = 4200;
      sweepTimeS = 1.25;
      renderer.renderRadar();
      acnX = 8100;
      sweepTimeS = 2.1;
      renderer.renderRadar();
      expect(renderer.getStaticCacheStats()).toMatchObject({ hits: 2, misses: 1 });
      expect(mainCtx.drawImageCalls.filter((c) => c.img === offscreenCanvas)).toHaveLength(3);

      // Zoom change -> cache miss
      rangeM = 30000;
      renderer.renderRadar();
      expect(renderer.getStaticCacheStats()).toMatchObject({ hits: 2, misses: 2 });

      // Pan change -> cache miss
      panX = 5000;
      renderer.renderRadar();
      expect(renderer.getStaticCacheStats()).toMatchObject({ hits: 2, misses: 3 });

      // Biome change -> cache miss
      biomeId = 'arid_desert';
      renderer.renderRadar();
      expect(renderer.getStaticCacheStats()).toMatchObject({ hits: 2, misses: 4 });

      // WorldTileLayer tile load/generation change -> cache miss
      tileGen = 2;
      renderer.renderRadar();
      expect(renderer.getStaticCacheStats()).toMatchObject({ hits: 2, misses: 5 });

      // Subsequent static frame hits cache again
      renderer.renderRadar();
      expect(renderer.getStaticCacheStats()).toMatchObject({ hits: 3, misses: 5 });
    } finally {
      (globalThis as Record<string, unknown>).document = origDocument;
    }
  });

  it('ensures frontend/c2-console-theme.css has zero backdrop-filter: blur rules', () => {
    const cssPath = path.join(ROOT_DIR, 'frontend', 'c2-console-theme.css');
    const rawCss = fs.readFileSync(cssPath, 'utf-8');
    const rulesOnly = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/(?:-webkit-)?backdrop-filter\s*:[^;]*blur/i.test(rulesOnly)).toBe(false);
  });
});
