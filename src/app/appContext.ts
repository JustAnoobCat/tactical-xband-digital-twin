/**
 * Shared typed application context for the Tactical X-Band Digital Twin UI.
 * Centralizes mutable UI state, core singletons, canvas references, DOM helpers,
 * and cross-module action dispatch with zero circular imports.
 */
import { PLAYBACK_SPEED } from '../shared/constants.ts';
import { DecodedTileCache, DEFAULT_LRU_CACHE_CAPACITY } from '../core/hgtMosaic.ts';
import { OfflineMissionPackStore } from '../core/offlineMissionPackStore.ts';
import { TerrainEngine } from '../core/terrain.ts';
import { EventSourcedFlightRecorder } from '../core/flightRecorder.ts';
import { TrajectoryEditorState } from '../ui/trajectoryEditorState.ts';
import { ObstacleEditorState } from '../ui/obstacleEditorState.ts';
import { ObstacleHistoryManager } from '../ui/terrainAnalysisController.ts';
import { LinkProfileViewportState } from '../ui/linkProfileViewport.ts';
import { TopViewViewportState } from '../ui/pathProfileTopView.ts';
import { SimulationHistoryBuffer, SimulationHistoryController } from '../ui/simulationHistory.ts';
import { SchedulerHistoryBuffer, SchedulerHistoryController } from '../ui/schedulerHistory.ts';
import { SpatialSnapshotBuffer } from '../ui/spatialSnapshotBuffer.ts';
import { SuperframeEpochStore } from '../ui/superframeEpochStore.ts';
import { createInitialTimelineInspectorVisibility } from '../ui/timelineFrameInspector.ts';
import { HistoricalSessionCoordinator } from '../ui/historicalSessionCoordinator.ts';
import { MapLayerRegistry } from '../ui/workbench/mapLayerRegistry.ts';
import { DataCommVisualizer } from '../ui/dataCommVisualization.ts';
import { NetworkPerformanceHistory } from '../ui/networkPerformanceDashboard.ts';
import { NetworkTrafficTracker } from '../ui/networkTrafficInventory.ts';
import { RadarLabelPlacer } from '../ui/workbench/radarLabelLayout.ts';
import { DiagnosticsTracker } from '../ui/workbench/diagnosticsTelemetry.ts';
import { initWorkbenchShell } from '../ui/workbenchShell.ts';
import { createTelemetryDomUpdaters } from '../ui/controllers/telemetryDomUpdaters.ts';

export const UNAVAILABLE = '—';
export const MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace';
export const TAU = Math.PI * 2;
export const TRANSPARENT_1X1_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

export function $(id: string): any {
  return id === 'profile-canvas'
    ? document.getElementById('terrain-canvas') || document.getElementById('profile-canvas')
    : document.getElementById(id);
}

export function setText(id: string, t: string): void {
  const e = $(id);
  if (e) e.textContent = t;
}

export function isFiniteMetric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Render a telemetry-derived metric, distinguishing unavailable data (—) from
 * a confirmed worker-produced zero (0). Accepts a number, or a preformatted
 * string for composite cells; null/undefined/non-finite numbers render as unavailable.
 */
export function setMetricText(id: string, value: unknown, format?: (v: any) => string): void {
  const el = $(id) as HTMLElement | null;
  if (!el) return;
  const unavailable =
    value === null ||
    value === undefined ||
    (typeof value === 'number' && !Number.isFinite(value));
  if (unavailable) {
    el.textContent = UNAVAILABLE;
    el.dataset.telemetryState = 'unavailable';
    el.title = 'Unavailable — awaiting telemetry';
    return;
  }
  el.textContent = format ? format(value) : String(value);
  el.dataset.telemetryState = 'available';
  el.removeAttribute('title');
}

/** Render an explicitly not-applicable cell (for example, no terminal selected). */
export function setUnavailableText(id: string, text: string, title?: string): void {
  const el = $(id) as HTMLElement | null;
  if (!el) return;
  el.textContent = text;
  el.dataset.telemetryState = 'not-applicable';
  if (title) el.title = title;
  else el.removeAttribute('title');
}

export function resolveBundledAssetUrl(relativePath: string): string {
  const cleanRel = String(relativePath || '').replace(/^\/+/, '');
  const baseEnv =
    typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL
      ? String(import.meta.env.BASE_URL)
      : './';
  const cleanBase = baseEnv.endsWith('/') ? baseEnv : `${baseEnv}/`;
  const baseUri =
    typeof document !== 'undefined' && document.baseURI
      ? document.baseURI
      : typeof window !== 'undefined'
        ? window.location.href
        : 'http://localhost/';
  try {
    const rootBase = new URL(cleanBase, baseUri);
    return new URL(cleanRel, rootBase).toString();
  } catch {
    return `${cleanBase}${cleanRel}`;
  }
}

export function formatDmsStr(deg: number, isLat: boolean): string {
  if (!Number.isFinite(deg)) return '--';
  const hemi = isLat ? (deg >= 0 ? 'N' : 'S') : deg >= 0 ? 'E' : 'W';
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const remM = (abs - d) * 60;
  const m = Math.floor(remM);
  const s = ((remM - m) * 60).toFixed(1);
  return `${d}°${String(m).padStart(2, '0')}'${s.padStart(4, '0')}"${hemi}`;
}

export function mapField(value: unknown, digits = 1, unit = ''): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(digits)}${unit}`
    : 'Unavailable';
}

export function mapEscape(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string)
  );
}

export function nodeLinkLabel(node: any): string {
  if (!node) return 'Unavailable';
  if (node.link_outage) return 'RF OUTAGE';
  if (node.obstacle_blocked || node.terrain_is_los === false) return 'BLOCKED';
  return node.is_transmitting ? 'TRANSMITTING' : 'AVAILABLE';
}

export function nodeAchievedRate(node: any): string {
  const rate = node?.transfer_state?.current_rate_mbps;
  return typeof rate === 'number' && Number.isFinite(rate) ? `${rate.toFixed(2)} Mbps` : 'Unavailable';
}

export interface AppState {
  THEATER_RADIUS_M: number;
  isPaused: boolean;
  activeBiomeId: string;
  radarNeedsRender: boolean;
  schedulerNeedsRender: boolean;
  terrainNeedsRender: boolean;
  animationLoopRafId: number | null;
  selectedNodeId: number;
  inspectorDismissed: boolean;
  nodeMoveModeActive: boolean;
  hoveredNodeId: number | null;
  hoveredLinkNodeId: number | null;
  mapHoverPoint: any;
  activeMapHoverRenderer: any;
  draggedEntity: any;
  lastMoveSendTime: number;
  hillshadeCanvas: HTMLCanvasElement | null;
  currentRadarRangeM: number;
  panOffsetX_m: number;
  panOffsetY_m: number;
  isPanning: boolean;
  panStartX: number;
  panStartY: number;
  panOriginX: number;
  panOriginY: number;
  terrainToolMode: string;
  terrainMeasurement: any;
  terrainRegionDraft: any[];
  terrainRegions: any[];
  nextTerrainRegionId: number;
  tbOpen: boolean;
  tbShowRulerTicks: boolean;
  tbActiveMode: string;
  tbBackdropMode: string;
  tbSlopeRidgeGrid: any;
  tbSlopeRidgeVersion: number;
  tbBackdropCanvas: HTMLCanvasElement | null;
  tbBackdropModeCached: string;
  tbBackdropVersionCached: number;
  tbTransectWaypoints: any[];
  tbTransectPolyDone: boolean;
  tbTransectResult: any;
  tbHoveredSampleIdx: number | null;
  tbRubberBandPoint: any;
  tbRulerMetrics: any;
  tbRulerEvaluation: any;
  tbRulerPreviewMetrics: any;
  tbRulerPreviewEval: any;
  tbActiveSnap: any;
  tbLineHover: any;
  isShiftKeyDown: boolean;
  draggedToolboxVertex: any;
  mapLibreToolboxVertexDrag: any;
  tbProbeSite: any;
  tbProbePinnedP1: any;
  tbCursorProbeLive: any;
  tbViewshedResult: any;
  tbViewshedCanvas: HTMLCanvasElement | null;
  tbProbeHeatmapConfig: {
    enabled: boolean;
    mode: string;
    palette: string;
    opacity: number;
    showContours: boolean;
  };
  tbViewshedNeedsMapLibreSync: boolean;
  tbOrbitResult: any;
  tbSweepResult: any;
  tbSelectedRegionId: number | null;
  tbZonalStats: any;
  tbRegionSummitResult: any;
  tbAoSwathBox: any;
  tbAoSwathReport: any;
  tbAoHoverCell: any;
  tbDraggedAoCorner: any;
  tbAoSwathAnchor: any;
  tbObstacleHistory: ObstacleHistoryManager;
  tbCadObstacleReport: any;
  tbObsDrawingAnchor: any;
  tbObsRubberBandPoint: any;
  tbObsSelectedId: any;
  tbObsHoverHandle: any;
  tbObsDraggedHandle: any;
  tbObsDragOrigin: any;
  tbBridgeA: any;
  tbBridgeB: any;
  tbBridgeResult: any;
  tbBridgeCanvas: HTMLCanvasElement | null;
  tbBridgeNeedsMapLibreSync: boolean;
  activeSchedulerMode: string;
  activeTerrainMode: string;
  activeTerrainBounds: any;
  pendingTerrainCenteringBounds: any;
  terrainMapMode: string;
  mapLibreInstance: any;
  mapController: any;
  mapLibreInitialized: boolean;
  mapLibreErrorShown: boolean;
  mapLibreTravelledPath: any[];
  mapLibreTerrainRaster: any;
  mapLibreTerrainVisible: boolean;
  mapLibreTerrainOpacity: number;
  mapLibreTerrainMode: string;
  mapLibreToolHandlersReady: boolean;
  mapLibreNodeDrag: any;
  mapLibreObstacleDrag: any;
  suppressNextMapLibreClick: boolean;
  inspectingAcn: boolean;
  spatialLocked: boolean;
  viewshedHeatmapEnabled: boolean;
  terrainProfileViewMode: string;
  currentSpatialRevision: number;
  trajectoryConfigSignature: string;
  committedTrajectoryMode: string;
  trajectoryRequestSerial: number;
  pendingTrajectoryRequest: any;
  waypointPlacementArmed: boolean;
  obstacleRequestSerial: number;
  pendingAltitudeMode: any;
  flightParamsDirty: boolean;
  committedFlightParams: {
    loiter_speed_mps: number;
    acn_altitude_m: number;
    altitude_mode: string;
    target_agl_m: number;
    max_climb_rate_mps: number;
    max_descent_rate_mps: number;
  };
  mouseScreenX: number;
  mouseScreenY: number;
  mouseWorldX: number;
  mouseWorldY: number;
  isMouseInsideRadar: boolean;
  toolboxCacheVersion: number;
  lastMirroredObstacleJson: string;
  lastMirroredObstacleRev: number;
  latestTelemetry: any;
  latestProfileSerial: number;
  latestProfileNodeId: number;
  stageViewMode: string;
  threeController: any;
  terrainMeshRequestId: number;
  inFlightTerrainMeshRequest: any;
  cachedTerrainMeshData: any;
  currentTerrainResolution: string;
  currentOverviewSubview: string;
  currentAuthoringPane: string;
  currentDocSubview: string;
  bridgeHistoricalActive: boolean;
  bridgeHistoricalFrame: number | null;
  bridgeHistSchedRec: any;
  bridgeHistRfRec: any;
  activeRadarLabelPlacer: any;
  mapLayersPanel: any;
  rollingWorkerStepSamples: number[];
  rollingWorkerInterFrameDeltas: number[];
  lastTelemetryArrivalTs: number;
  smoothedJitterMs: number;
  selectedNtnNodeId: number;
  selectedTrafficNodeId: number;
  trafficSortColumn: string;
  trafficSortAscending: boolean;
  currentTrafficSubtab: string;
  activeSensitivityAxis: string;
  profMultiFresnelOrders: boolean;
  profHoverInfo: any;
  pendingAglUpdate: any;
  aglFeedbackTimeout: any;
  nodeEditorMode: string;
  nodeEditorTargetId: number;
  currentSimSpeed: number;
  activeRenderedGanttSlots: any[];
  ganttHoverState: { active: boolean; x: number; y: number; hoveredSlot: any };
  pduDissectorState: { pinnedSlot: any; autoFollow: boolean };
  simTimelineRenderer: any;
  simTimelineController: any;
  timelineInspectorVisibility: any;
  lastTimelineAnimTimeMs: number;
  last3dSecondaryCanvasThrottleMs: number;
  lastMapLibreOverlaySyncMs: number;
  spatialLockControlSynced: boolean;
  networkNodeNames: Map<number, string>;
  networkGraphUpdatesEnabled: boolean;
  networkLastRenderTime: number;
  networkNodeOptionsSignature: string;
  boundMapLibreOfflineHandler: any;
  boundMapLibrePointerUp: any;
  handleTimelineInspectorReset: () => void;
  lastRenderedNodesKey: string;
  lastOpsFleetSignature: string;
  pendingNodeTarget?: any;
  [key: string]: any;
}

export interface AppActions {
  [key: string]: (...args: any[]) => any;
}

export interface AppContext {
  worker: Worker;
  state: AppState;
  engines: {
    workbenchShell: any;
    telemetryUpdaters: any;
    mainTerrainEngine: TerrainEngine;
    trajectoryEditor: TrajectoryEditorState;
    obstacleEditor: ObstacleEditorState;
    mapLayerRegistry: MapLayerRegistry;
    historyBuffer: SimulationHistoryBuffer;
    historyController: SimulationHistoryController;
    schedHistoryBuffer: SchedulerHistoryBuffer;
    schedHistoryController: SchedulerHistoryController;
    sessionCoordinator: HistoricalSessionCoordinator;
    simSpatialBuffer: SpatialSnapshotBuffer;
    simEpochStore: SuperframeEpochStore;
    dataCommVisualizer: DataCommVisualizer;
    networkPerformanceHistory: NetworkPerformanceHistory;
    networkTrafficTracker: NetworkTrafficTracker;
    diagnosticsTracker: DiagnosticsTracker;
    flightRecorder: EventSourcedFlightRecorder;
    radarLabelPlacer: RadarLabelPlacer;
    terrainProfileViewport: LinkProfileViewportState;
    terrainTopViewport: TopViewViewportState;
    tileCache: DecodedTileCache;
    offlinePackStore: OfflineMissionPackStore;
  };
  canvases: {
    radarCanvas: HTMLCanvasElement;
    radarCtx: CanvasRenderingContext2D;
    waterfallCanvas: HTMLCanvasElement;
    waterfallCtx: CanvasRenderingContext2D;
    ganttCanvas: HTMLCanvasElement;
    terrainCanvas: HTMLCanvasElement | null;
    terrainCtx: CanvasRenderingContext2D | null;
    polarAntennaCanvas: HTMLCanvasElement | null;
    polarAntennaCtx: CanvasRenderingContext2D | null;
    linkWaterfallCanvas: HTMLCanvasElement | null;
    linkWaterfallCtx: CanvasRenderingContext2D | null;
    ecdfDelayCanvas: HTMLCanvasElement | null;
    ecdfDelayCtx: CanvasRenderingContext2D | null;
    sensitivitySweepCanvas: HTMLCanvasElement | null;
    sensitivitySweepCtx: CanvasRenderingContext2D | null;
    timelineCanvas: HTMLCanvasElement | null;
  };
  dom: {
    $: typeof $;
    setText: typeof setText;
    UNAVAILABLE: typeof UNAVAILABLE;
    isFiniteMetric: typeof isFiniteMetric;
    setMetricText: typeof setMetricText;
    setUnavailableText: typeof setUnavailableText;
    MONO: typeof MONO;
    TAU: typeof TAU;
    TRANSPARENT_1X1_PNG: typeof TRANSPARENT_1X1_PNG;
    resolveBundledAssetUrl: typeof resolveBundledAssetUrl;
    formatDmsStr: typeof formatDmsStr;
    mapField: typeof mapField;
    mapEscape: typeof mapEscape;
    nodeLinkLabel: typeof nodeLinkLabel;
    nodeAchievedRate: typeof nodeAchievedRate;
  };
  actions: AppActions;
}

export function createAppContext(worker: Worker): AppContext {
  const actions: AppActions = {};

  const workbenchShell = initWorkbenchShell();
  const telemetryUpdaters = createTelemetryDomUpdaters({
    onSelectNode: (nid: any) => {
      if (typeof (window as any).onTargetNodeChange === 'function') {
        (window as any).onTargetNodeChange(Number(nid));
      }
    },
  });

  const trajectoryEditor = new TrajectoryEditorState();
  const obstacleEditor = new ObstacleEditorState();
  const tbObstacleHistory = new ObstacleHistoryManager(obstacleEditor.draft);
  const mapLayerRegistry = new MapLayerRegistry();
  const mainTerrainEngine = new TerrainEngine({ terrainMode: 'real' });

  const radarCanvas = $('radar-canvas') as HTMLCanvasElement;
  const radarCtx = radarCanvas.getContext('2d') as CanvasRenderingContext2D;
  const waterfallCanvas = $('waterfall-canvas') as HTMLCanvasElement;
  const waterfallCtx = waterfallCanvas.getContext('2d') as CanvasRenderingContext2D;
  const terrainCanvas = $('terrain-canvas') as HTMLCanvasElement | null;
  const terrainCtx = terrainCanvas ? (terrainCanvas.getContext('2d') as CanvasRenderingContext2D) : null;
  const polarAntennaCanvas = $('polar-antenna-canvas') as HTMLCanvasElement | null;
  const polarAntennaCtx = polarAntennaCanvas
    ? (polarAntennaCanvas.getContext('2d') as CanvasRenderingContext2D)
    : null;
  const linkWaterfallCanvas = $('link-waterfall-canvas') as HTMLCanvasElement | null;
  const linkWaterfallCtx = linkWaterfallCanvas
    ? (linkWaterfallCanvas.getContext('2d') as CanvasRenderingContext2D)
    : null;
  const ecdfDelayCanvas = $('ecdf-delay-canvas') as HTMLCanvasElement | null;
  const ecdfDelayCtx = ecdfDelayCanvas
    ? (ecdfDelayCanvas.getContext('2d') as CanvasRenderingContext2D)
    : null;
  const sensitivitySweepCanvas = $('sensitivity-sweep-canvas') as HTMLCanvasElement | null;
  const sensitivitySweepCtx = sensitivitySweepCanvas
    ? (sensitivitySweepCanvas.getContext('2d') as CanvasRenderingContext2D)
    : null;
  const timelineCanvas = $('sim-timeline-canvas') as HTMLCanvasElement | null;

  const state: AppState = {
    THEATER_RADIUS_M: 300000,
    isPaused: false,
    activeBiomeId: 'alpine_mountain',
    radarNeedsRender: true,
    schedulerNeedsRender: true,
    terrainNeedsRender: true,
    animationLoopRafId: null,
    selectedNodeId: -1,
    inspectorDismissed: false,
    nodeMoveModeActive: false,
    hoveredNodeId: null,
    hoveredLinkNodeId: null,
    mapHoverPoint: null,
    activeMapHoverRenderer: null,
    draggedEntity: null,
    lastMoveSendTime: 0,
    hillshadeCanvas: null,
    currentRadarRangeM: 60000,
    panOffsetX_m: 0,
    panOffsetY_m: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    panOriginX: 0,
    panOriginY: 0,
    terrainToolMode: 'idle',
    terrainMeasurement: null,
    terrainRegionDraft: [],
    terrainRegions: [],
    nextTerrainRegionId: 1,
    tbOpen: false,
    tbShowRulerTicks: false,
    tbActiveMode: 'dem',
    tbBackdropMode: 'relief',
    tbSlopeRidgeGrid: null,
    tbSlopeRidgeVersion: -1,
    tbBackdropCanvas: null,
    tbBackdropModeCached: 'relief',
    tbBackdropVersionCached: -1,
    tbTransectWaypoints: [],
    tbTransectPolyDone: false,
    tbTransectResult: null,
    tbHoveredSampleIdx: null,
    tbRubberBandPoint: null,
    tbRulerMetrics: null,
    tbRulerEvaluation: null,
    tbRulerPreviewMetrics: null,
    tbRulerPreviewEval: null,
    tbActiveSnap: null,
    tbLineHover: null,
    isShiftKeyDown: false,
    draggedToolboxVertex: null,
    mapLibreToolboxVertexDrag: null,
    tbProbeSite: null,
    tbProbePinnedP1: null,
    tbCursorProbeLive: null,
    tbViewshedResult: null,
    tbViewshedCanvas: null,
    tbProbeHeatmapConfig: {
      enabled: true,
      mode: 'signal',
      palette: 'rf_spectrum',
      opacity: 0.72,
      showContours: true,
    },
    tbViewshedNeedsMapLibreSync: false,
    tbOrbitResult: null,
    tbSweepResult: null,
    tbSelectedRegionId: null,
    tbZonalStats: null,
    tbRegionSummitResult: null,
    tbAoSwathBox: null,
    tbAoSwathReport: null,
    tbAoHoverCell: null,
    tbDraggedAoCorner: null,
    tbAoSwathAnchor: null,
    tbObstacleHistory,
    tbCadObstacleReport: null,
    tbObsDrawingAnchor: null,
    tbObsRubberBandPoint: null,
    tbObsSelectedId: null,
    tbObsHoverHandle: null,
    tbObsDraggedHandle: null,
    tbObsDragOrigin: null,
    tbBridgeA: null,
    tbBridgeB: null,
    tbBridgeResult: null,
    tbBridgeCanvas: null,
    tbBridgeNeedsMapLibreSync: false,
    activeSchedulerMode: 'tac_tad',
    activeTerrainMode: 'real',
    activeTerrainBounds: null,
    pendingTerrainCenteringBounds: null,
    terrainMapMode: 'radar',
    mapLibreInstance: null,
    mapController: null,
    mapLibreInitialized: false,
    mapLibreErrorShown: false,
    mapLibreTravelledPath: [],
    mapLibreTerrainRaster: null,
    mapLibreTerrainVisible: mapLayerRegistry.isLayerVisible('base.terrainDem'),
    mapLibreTerrainOpacity: mapLayerRegistry.getLayerOpacity('base.terrainDem'),
    mapLibreTerrainMode: 'relief',
    mapLibreToolHandlersReady: false,
    mapLibreNodeDrag: null,
    mapLibreObstacleDrag: null,
    suppressNextMapLibreClick: false,
    inspectingAcn: false,
    spatialLocked: false,
    viewshedHeatmapEnabled: false,
    terrainProfileViewMode: 'profile',
    currentSpatialRevision: 0,
    trajectoryConfigSignature: '',
    committedTrajectoryMode: 'ellipse',
    trajectoryRequestSerial: 0,
    pendingTrajectoryRequest: null,
    waypointPlacementArmed: false,
    obstacleRequestSerial: 0,
    pendingAltitudeMode: null,
    flightParamsDirty: false,
    committedFlightParams: {
      loiter_speed_mps: 60,
      acn_altitude_m: 5000,
      altitude_mode: 'fix',
      target_agl_m: 1500,
      max_climb_rate_mps: 10,
      max_descent_rate_mps: 8,
    },
    mouseScreenX: -1,
    mouseScreenY: -1,
    mouseWorldX: 0,
    mouseWorldY: 0,
    isMouseInsideRadar: false,
    toolboxCacheVersion: 0,
    lastMirroredObstacleJson: '',
    lastMirroredObstacleRev: -1,
    latestTelemetry: {
      frame_index: 0,
      sim_time_s: 0,
      active_scheduler_mode: 'tac_tad',
      acn_telemetry: {
        pos_x: 16383,
        pos_y: 11471.5,
        pos_z: 5000,
        velocity: [-34.4, 24.1, 0],
        altitude_msl_m: 5000,
        coverage_radius_km: 35,
      },
      flight_path: [],
      nodes_telemetry: [],
      active_gantt_allocations: [],
      comparative_kpi_dashboard: {},
      selected_node_fresnel: null,
      transfer_telemetry: null,
    },
    latestProfileSerial: 0,
    latestProfileNodeId: -1,
    stageViewMode: '2d',
    threeController: null,
    terrainMeshRequestId: 0,
    inFlightTerrainMeshRequest: null,
    cachedTerrainMeshData: null,
    currentTerrainResolution: 'native512',
    currentOverviewSubview: 'ops',
    currentAuthoringPane: 'traj',
    currentDocSubview: 'diag',
    bridgeHistoricalActive: false,
    bridgeHistoricalFrame: null,
    bridgeHistSchedRec: null,
    bridgeHistRfRec: null,
    activeRadarLabelPlacer: null,
    mapLayersPanel: null,
    rollingWorkerStepSamples: [4.2, 4.5, 4.8, 5.1, 5.4, 6.0, 7.2, 8.0],
    rollingWorkerInterFrameDeltas: [20.0, 20.1, 19.9, 20.2, 19.8, 20.0, 20.1, 19.9],
    lastTelemetryArrivalTs: 0,
    smoothedJitterMs: 0.42,
    selectedNtnNodeId: 1,
    selectedTrafficNodeId: 4,
    trafficSortColumn: 'fromName',
    trafficSortAscending: true,
    currentTrafficSubtab: 'inventory',
    activeSensitivityAxis: 'traffic_load',
    profMultiFresnelOrders: true,
    profHoverInfo: null,
    pendingAglUpdate: null,
    aglFeedbackTimeout: null,
    nodeEditorMode: 'add',
    nodeEditorTargetId: -1,
    currentSimSpeed: PLAYBACK_SPEED.defaultValue,
    activeRenderedGanttSlots: [],
    ganttHoverState: { active: false, x: 0, y: 0, hoveredSlot: null },
    pduDissectorState: { pinnedSlot: null, autoFollow: true },
    simTimelineRenderer: null,
    simTimelineController: null,
    timelineInspectorVisibility: createInitialTimelineInspectorVisibility(),
    lastTimelineAnimTimeMs: 0,
    last3dSecondaryCanvasThrottleMs: 0,
    lastMapLibreOverlaySyncMs: 0,
    spatialLockControlSynced: false,
    networkNodeNames: new Map<number, string>(),
    networkGraphUpdatesEnabled: true,
    networkLastRenderTime: 0,
    networkNodeOptionsSignature: '',
    boundMapLibreOfflineHandler: null,
    boundMapLibrePointerUp: null,
    handleTimelineInspectorReset: () => {},
    lastRenderedNodesKey: '',
    lastOpsFleetSignature: '',
  };

  const historyBuffer = new SimulationHistoryBuffer(3000);
  const historyController = new SimulationHistoryController(historyBuffer);
  const schedHistoryBuffer = new SchedulerHistoryBuffer(3000);
  const schedHistoryController = new SchedulerHistoryController(schedHistoryBuffer);

  return {
    worker,
    state,
    engines: {
      workbenchShell,
      telemetryUpdaters,
      mainTerrainEngine,
      trajectoryEditor,
      obstacleEditor,
      mapLayerRegistry,
      historyBuffer,
      historyController,
      schedHistoryBuffer,
      schedHistoryController,
      sessionCoordinator: new HistoricalSessionCoordinator(),
      simSpatialBuffer: new SpatialSnapshotBuffer(3000, 128),
      simEpochStore: new SuperframeEpochStore(6000),
      dataCommVisualizer: new DataCommVisualizer(),
      networkPerformanceHistory: new NetworkPerformanceHistory(600, 5),
      networkTrafficTracker: new NetworkTrafficTracker(),
      diagnosticsTracker: new DiagnosticsTracker(),
      flightRecorder: new EventSourcedFlightRecorder({
        seed: 0,
        initialBiomeId: 'alpine_mountain',
      }),
      radarLabelPlacer: new RadarLabelPlacer(),
      terrainProfileViewport: new LinkProfileViewportState(),
      terrainTopViewport: new TopViewViewportState(),
      tileCache: new DecodedTileCache(
        typeof DEFAULT_LRU_CACHE_CAPACITY !== 'undefined' ? DEFAULT_LRU_CACHE_CAPACITY : 12
      ),
      offlinePackStore: new OfflineMissionPackStore(),
    },
    canvases: {
      radarCanvas,
      radarCtx,
      waterfallCanvas,
      waterfallCtx,
      ganttCanvas: waterfallCanvas,
      terrainCanvas,
      terrainCtx,
      polarAntennaCanvas,
      polarAntennaCtx,
      linkWaterfallCanvas,
      linkWaterfallCtx,
      ecdfDelayCanvas,
      ecdfDelayCtx,
      sensitivitySweepCanvas,
      sensitivitySweepCtx,
      timelineCanvas,
    },
    dom: {
      $,
      setText,
      UNAVAILABLE,
      isFiniteMetric,
      setMetricText,
      setUnavailableText,
      MONO,
      TAU,
      TRANSPARENT_1X1_PNG,
      resolveBundledAssetUrl,
      formatDmsStr,
      mapField,
      mapEscape,
      nodeLinkLabel,
      nodeAchievedRate,
    },
    actions,
  };
}
