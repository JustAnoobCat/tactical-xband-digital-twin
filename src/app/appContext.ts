/// <reference path="./windowBindings.d.ts" />
/**
 * Shared typed application context for the Tactical X-Band Digital Twin UI.
 * Centralizes mutable UI state, core singletons, canvas references, DOM helpers,
 * and cross-module action dispatch with zero circular imports.
 */
type MapLibreMap = import('maplibre-gl').Map;
import { PLAYBACK_SPEED } from '../shared/constants.ts';
import type {
  TelemetryFrame,
  NodeTelemetryItem,
  WorkerInboundCommand,
  WorkerCommandResult,
  TerrainMeshDataReadyMessage,
  TrajectoryConfigTelemetry,
  ITdmaFrameConfig,
  HiFiPhysicsTelemetry,
  TransportAbrTelemetry,
  EwEccmTelemetry,
  ConstellationMobilityTelemetry,
  TelemetryFrameMessage,
  BiomeId,
  AltitudeMode,
  TelemetryGanttAllocation,
} from '../shared/workerProtocol.ts';
import type { TerrainBoundsLike } from './windowBindings.d.ts';
import { DecodedTileCache, DEFAULT_LRU_CACHE_CAPACITY } from '../core/hgtMosaic.ts';
import type { SrtmCatalogTile } from '../core/hgtMosaic.ts';
import { OfflineMissionPackStore } from '../core/offlineMissionPackStore.ts';
import { TerrainEngine } from '../core/terrain.ts';
import type { DemGeographicMetadata } from '../core/terrain.ts';
import { EventSourcedFlightRecorder } from '../core/flightRecorder.ts';
import { TrajectoryEditorState } from '../ui/trajectoryEditorState.ts';
import { ObstacleEditorState } from '../ui/obstacleEditorState.ts';
import { ObstacleHistoryManager } from '../ui/terrainAnalysisController.ts';
import { LinkProfileViewportState } from '../ui/linkProfileViewport.ts';
import type { ProfileHoverInfo } from '../ui/linkProfileViewport.ts';
import { TopViewViewportState } from '../ui/pathProfileTopView.ts';
import { SimulationHistoryBuffer, SimulationHistoryController } from '../ui/simulationHistory.ts';
import type { HistoricalFrameRecord } from '../ui/simulationHistory.ts';
import { SchedulerHistoryBuffer, SchedulerHistoryController } from '../ui/schedulerHistory.ts';
import type { SchedulerFrameRecord } from '../ui/schedulerHistory.ts';
import { SpatialSnapshotBuffer } from '../ui/spatialSnapshotBuffer.ts';
import { SuperframeEpochStore } from '../ui/superframeEpochStore.ts';
import { createInitialTimelineInspectorVisibility } from '../ui/timelineFrameInspector.ts';
import type { TimelineInspectorVisibilityState } from '../ui/timelineFrameInspector.ts';
import { HistoricalSessionCoordinator } from '../ui/historicalSessionCoordinator.ts';
import { MapLayerRegistry } from '../ui/workbench/mapLayerRegistry.ts';
import type { ContextualMapContext } from '../ui/workbench/mapLayerRegistry.ts';
import { MapLayersPanel } from '../ui/workbench/mapLayersPanel.ts';
import { DataCommVisualizer } from '../ui/dataCommVisualization.ts';
import { NetworkPerformanceHistory } from '../ui/networkPerformanceDashboard.ts';
import { NetworkTrafficTracker } from '../ui/networkTrafficInventory.ts';
import { RadarLabelPlacer } from '../ui/workbench/radarLabelLayout.ts';
import { DiagnosticsTracker } from '../ui/workbench/diagnosticsTelemetry.ts';
import { initWorkbenchShell } from '../ui/workbenchShell.ts';
import { createTelemetryDomUpdaters } from '../ui/controllers/telemetryDomUpdaters.ts';
type ThreeSceneController = import('../ui/three/threeSceneController.ts').ThreeSceneController;
import type { StageViewMode, TerrainMeshDataPayload, TerrainMeshResolution } from '../ui/three/threeTypes.ts';
type MapController = import('../ui/mapController.ts').MapController;
import type { SimulationTimelineRenderer } from '../ui/simulationTimelineRenderer.ts';
import type { SimulationTimelineController } from '../ui/simulationTimelineController.ts';
import type { SystemHealthHud } from '../ui/systemHealthHud.ts';
import type { WorldTileLayer } from '../ui/worldTileLayer.ts';
import type { RadarNodeMarkerLayer } from '../ui/radarNodeMarkerLayer.ts';
import type { createRadar2dRenderer } from '../ui/controllers/radar2dRenderer.ts';
import type { OfflineMissionPackKind } from '../core/offlineMissionPackStore.ts';
import type { ProbeHeatmapLayerMode, ProbeHeatmapPalette } from '../ui/terrainToolboxCharts.ts';
import type { ProbeHeatmapConfig } from '../ui/toolboxPrecisionSuite.ts';
import type { createTerrainToolboxController } from '../ui/controllers/terrainToolboxController.ts';
import type { DashboardAndAuthoringController } from '../ui/controllers/dashboardAndAuthoringController.ts';
import type { MissionIoController } from '../ui/controllers/missionIoController.ts';
import type { CommandPaletteController } from '../ui/controllers/commandPaletteController.ts';
import type { TwinEvaluationReport } from '../core/digitalTwinCalibrationEngine.ts';
import type { QosNetworkSlaReport } from '../core/qosSlaEngine.ts';

export const UNAVAILABLE = '—';
export const MIN_RADAR_RANGE_M = 120;
export const MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace';
export const TAU = Math.PI * 2;
export const TRANSPARENT_1X1_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

export function $<T extends HTMLElement = HTMLElement>(id: string): T | null {
  const el =
    id === 'profile-canvas'
      ? document.getElementById('terrain-canvas') || document.getElementById('profile-canvas')
      : document.getElementById(id);
  return el as T | null;
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
export function setMetricText(
  id: string,
  value: unknown,
  format?: ((v: any) => string | null) | null
): void {
  const el = $(id);
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
  el.textContent = format ? (format(value) ?? UNAVAILABLE) : String(value);
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

export function nodeLinkLabel(
  node: {
    link_outage?: boolean;
    obstacle_blocked?: boolean;
    terrain_is_los?: boolean;
    is_transmitting?: boolean;
  } | null | undefined
): string {
  if (!node) return 'Unavailable';
  if (node.link_outage) return 'RF OUTAGE';
  if (node.obstacle_blocked || node.terrain_is_los === false) return 'BLOCKED';
  return node.is_transmitting ? 'TRANSMITTING' : 'AVAILABLE';
}

export function nodeAchievedRate(
  node: { transfer_state?: { current_rate_mbps?: number | null } | null } | null | undefined
): string {
  const rate = node?.transfer_state?.current_rate_mbps;
  return typeof rate === 'number' && Number.isFinite(rate) ? `${rate.toFixed(2)} Mbps` : 'Unavailable';
}

export interface AppState {
  THEATER_RADIUS_M: number;
  isPaused: boolean;
  activeBiomeId: BiomeId;
  radarNeedsRender: boolean;
  schedulerNeedsRender: boolean;
  terrainNeedsRender: boolean;
  animationLoopRafId: number | null;
  radarSweepPhaseS: number;
  pendingThreeRecenter: boolean;
  selectedNodeId: number;
  inspectorDismissed: boolean;
  nodeMoveModeActive: boolean;
  hoveredNodeId: number | null;
  hoveredLinkNodeId: number | null;
  mapHoverPoint: { x: number; y: number } | null;
  activeMapHoverRenderer: string | null;
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
  tbBackdropMode: 'relief' | 'slope' | 'ridge';
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
    mode: ProbeHeatmapLayerMode;
    palette: ProbeHeatmapPalette;
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
  tbObsSelectedId: string | null;
  tbObsHoverHandle: any;
  tbObsDraggedHandle: any;
  tbObsDragOrigin: any;
  tbBridgeA: any;
  tbBridgeB: any;
  tbBridgeResult: any;
  tbBridgeCanvas: HTMLCanvasElement | null;
  tbBridgeNeedsMapLibreSync: boolean;
  activeSchedulerMode: string;
  activeTerrainMode: 'real' | 'synthetic';
  activeTerrainBounds: TerrainBoundsLike | null;
  pendingTerrainCenteringBounds: TerrainBoundsLike | null;
  terrainMapMode: 'radar' | 'maplibre';
  mapLibreInstance: MapLibreMap | null;
  mapController: MapController | null;
  mapLibreInitialized: boolean;
  mapLibreErrorShown: boolean;
  mapLibreTravelledPath: [number, number][];
  mapLibreTerrainRaster: {
    elevations: Float32Array;
    width: number;
    height: number;
    metadata: TerrainBoundsLike;
    dataUrl: string;
    coordinates: [[number, number], [number, number], [number, number], [number, number]] | [];
  } | null;
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
  pendingTrajectoryRequest: string | null;
  waypointPlacementArmed: boolean;
  equipmentPlacementArmed: boolean;
  lastEquipmentListSig: string;
  obstacleRequestSerial: number;
  pendingAltitudeMode: AltitudeMode | null;
  flightParamsDirty: boolean;
  committedFlightParams: {
    loiter_speed_mps: number;
    acn_altitude_m: number;
    altitude_mode: AltitudeMode | string;
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
  latestTelemetry: TelemetryFrame | null;
  latestProfileSerial: number;
  latestProfileNodeId: number;
  stageViewMode: StageViewMode;
  threeController: ThreeSceneController | null;
  terrainMeshRequestId: number;
  inFlightTerrainMeshRequest: { requestId: number; terrainMode: string } | null;
  cachedTerrainMeshData: TerrainMeshDataPayload | null;
  currentTerrainResolution: TerrainMeshResolution;
  currentOverviewSubview: string;
  currentAuthoringPane: string;
  currentDocSubview: string;
  bridgeHistoricalActive: boolean;
  bridgeHistoricalFrame: number | null;
  bridgeHistSchedRec: SchedulerFrameRecord | null;
  bridgeHistRfRec: HistoricalFrameRecord | null;
  activeRadarLabelPlacer: any;
  mapLayersPanel: MapLayersPanel | null;
  rollingWorkerStepSamples: number[];
  rollingWorkerInterFrameDeltas: number[];
  lastTelemetryArrivalTs: number;
  smoothedJitterMs: number;
  selectedNtnNodeId: number;
  selectedTrafficNodeId: number;
  selectedTrafficTeamId: string | null;
  selectedTeamId: string | null;
  opsFleetTeamFilter: string | null;
  checkedFleetNodeIds: Set<number>;
  nodeModalTargetId: number;
  trafficSortColumn: string;
  trafficSortAscending: boolean;
  currentTrafficSubtab: string;
  activeSensitivityAxis: string;
  profMultiFresnelOrders: boolean;
  profHoverInfo: ProfileHoverInfo | null;
  pendingAglUpdate: { nodeId: number; agl: number; reqId: string } | null;
  aglFeedbackTimeout: ReturnType<typeof setTimeout> | null;
  nodeEditorMode: string;
  nodeEditorTargetId: number;
  currentSimSpeed: number;
  activeRenderedGanttSlots: Array<TelemetryGanttAllocation & { x?: number; y?: number; w?: number; h?: number }>;
  ganttHoverState: { active: boolean; x: number; y: number; hoveredSlot: any };
  pduDissectorState: { pinnedSlot: any; autoFollow: boolean };
  simTimelineRenderer: SimulationTimelineRenderer | null;
  simTimelineController: SimulationTimelineController | null;
  timelineInspectorVisibility: TimelineInspectorVisibilityState;
  lastTimelineAnimTimeMs: number;
  last3dSecondaryCanvasThrottleMs: number;
  lastMapLibreOverlaySyncMs: number;
  spatialLockControlSynced: boolean;
  networkNodeNames: Map<number, string>;
  networkGraphUpdatesEnabled: boolean;
  networkLastRenderTime: number;
  networkNodeOptionsSignature: string;
  boundMapLibreOfflineHandler: (() => void) | null;
  boundMapLibrePointerUp: ((e: PointerEvent) => void) | null;
  handleTimelineInspectorReset: () => void;
  lastRenderedNodesKey: string;
  lastOpsFleetSignature: string;
  pendingNodeTarget?: { mode: string; nodeId: number; name?: string; requestId?: string } | null;
  activeSelectElement: HTMLSelectElement | null;
  selectInteractionUntilMs: number;
}

export interface AppActions {
  // workerBridgeController
  sendCommand: (msg: WorkerInboundCommand, transferList?: Transferable[]) => void;
  getSystemHealthHud: () => SystemHealthHud;
  syncTelemetrySubscriptionProfile: (activeTabId: string) => void;

  // terrainUploadController
  setCustomDemControlsState: (opts?: { loading?: boolean; loaded?: boolean }) => void;
  sendCustomDemZeroCopy: (elevations: Float32Array, metadata: DemGeographicMetadata) => void;
  resetTerrainFileInputs: () => void;
  invokeTauriOfflineIpc: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> | null;
  persistOfflinePack: (name: string, kind: OfflineMissionPackKind, bufferOrBytes: ArrayBuffer | Uint8Array) => Promise<void>;
  refreshOfflinePackList: () => Promise<void>;
  getTerrainLayout: () => { width: number; height: number; padL: number; padR: number; padT: number; padB: number };
  openUploadModal: () => void;
  closeUploadModal: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDropFile: (e: DragEvent) => void;
  decodeTileFile: (catalogTile: SrtmCatalogTile) => Promise<any>;

  // viewModeAnd3dController
  loadThreeStageModule: () => Promise<typeof import('../ui/three/threeSceneController.ts')>;
  loadMapLibreDependencies: () => Promise<any>;
  shouldContinueAnimationLoop: () => boolean;
  scheduleAnimationLoop: () => void;
  markRadarDirty: () => void;
  markUiDirtyAndWake: () => void;
  initThreeStage: () => Promise<void>;
  syncVolumetricRfHudButtons: () => void;
  initVolumetricRfControls: () => void;
  requestTerrainMeshData: (force?: boolean) => void;
  handleTerrainMeshDataResponse: (msg: TerrainMeshDataReadyMessage) => void;
  updateTerrainHudBadge: () => void;

  // mapLibreController
  clearMapLibreSourceHashes: () => void;
  isMapLibreDynamicSourceBusy: () => boolean;
  setMapLibreSourceData: (id: string, data: unknown, onlyWhenChanged?: boolean) => void;
  beginMapLibreCameraSync: (durationMs?: number) => number;
  endMapLibreCameraSync: (token: number) => void;
  syncRangeButtonHighlights: (rangeM: number) => void;
  getMaxRadarRangeM: () => number;
  syncMapLibreCameraFromRadarState: (duration?: number, resetOrientation?: boolean) => void;
  easeMapLibreToLocalCenter: (xM: number, yM: number, duration?: number, resetOrientation?: boolean) => void;
  syncRadarStateFromMapLibreCamera: () => void;
  mapLibreCoordinate: (xM: number, yM: number) => [number, number];
  geographicDistanceM: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => number;
  updateMapLibreToolSources: () => void;
  updateMapLibreCursor: (point?: { x: number; y: number } | null) => void;
  renderMapLibreTerrainRaster: () => void;
  applyMapLibreTerrainRaster: () => void;
  ensureMapLibreTerrainLayer: () => void;
  setMapLibreTerrainRaster: (elevations: Float32Array, metadata: TerrainBoundsLike) => void;
  applyMapLibreLayerState: () => void;
  updateMapLibreOverlay: () => void;
  fitMapLibreToTerrain: () => void;
  initializeMapLibre: () => Promise<void>;
  setMapMode: (mode: 'radar' | 'maplibre') => void;

  // radar2dAndInteractionController
  getRadarWorldTileLayer: () => WorldTileLayer;
  getRadarNodeMarkerLayer: () => RadarNodeMarkerLayer | null;
  getRadar2dRenderer: () => ReturnType<typeof createRadar2dRenderer>;
  drawLabelLeaderTick: (ctx2d: CanvasRenderingContext2D, placed: any) => void;
  invalidateToolboxCache: () => void;
  syncObstacleFieldMirror: (force?: boolean) => void;
  updateRadarCursorReadout: (worldX: number, worldY: number, visible: boolean) => void;
  renderNodeHoverTooltip: (nodeId: number | null, pt: { x: number; y: number }, mode: 'node' | 'link') => void;
  setSharedMapHover: (
    renderer: string | null,
    kind: 'node' | 'link',
    nodeId: number | null,
    pt: { x: number; y: number } | null
  ) => void;
  renderHillshadeFromWorker: (data: readonly (readonly number[])[] | number[][], gridSize: number, boundsKm: number, terrainMode?: string, bounds?: TerrainBoundsLike | null) => void;
  getRadarGeometry: (w: number, h: number) => { centerX: number; centerY: number; scale: number };
  worldToScreen: (wx: number, wy: number, w: number, h: number) => { x: number; y: number };
  screenToWorld: (sx: number, sy: number, w: number, h: number) => { x: number; y: number };
  renderMapLibreKineticOverlay: (ctx2d: CanvasRenderingContext2D, w: number, h: number, frame: TelemetryFrame) => void;
  drawRadar: () => void;
  radarLinkHit: (sx: number, sy: number, w: number, h: number, radiusPx?: number) => number | null;

  // terrainToolboxCoordinator
  getTerrainToolboxController: () => ReturnType<typeof createTerrainToolboxController>;
  getRadarPointerWorld: (event: MouseEvent | PointerEvent) => { x: number; y: number };
  terrainDistanceText: (distanceM: number) => string;
  setTerrainToolStatus: (text: string) => void;
  downloadTextBlob: (filename: string, content: string, mimeType: string) => void;
  buildToolboxSimContext: () => any;
  findMagneticSnapTarget: (px: number, py: number, w: number, h: number, snapThresholdPx?: number) => any;
  recomputeTransect: (isPreview?: boolean) => void;
  recomputeRubberBandPreview: (worldPoint: any) => void;
  findNearestTransectSampleIndex: (xM: number, yM: number, maxDistM?: number) => number | null;
  updateToolboxTransectHoverUi: () => void;
  updateProbeUiReadouts: (analysis?: any) => void;
  recomputeProbeAnalysis: () => void;
  updateProbeHeatmapConfig: (partial: Partial<ProbeHeatmapConfig>) => void;
  recomputeRegionZonal: () => void;
  runBridgeFinder: () => void;
  ensureBackdropCanvasSynced: () => void;
  renderMode1Provenance: () => void;
  recomputeActiveToolboxResults: () => void;
  refreshToolboxActionGates: () => void;
  renderToolboxDrawer: () => void;
  addToolboxNodeAt: (xM: number, yM: number, aglM: number, callsign: string, role?: string) => void;
  applyTransectAsAcnWaypoints: () => void;
  finishTransectPolyline: () => void;
  handleToolboxMapClick: (point: { x: number; y: number; lng?: number; lat?: number }) => boolean | void;
  finishTerrainRegion: () => void;
  cancelTerrainTool: () => void;
  clearTerrainMeasurement: () => void;
  refreshTerrainToolbox: () => void;
  updateStepGuideBanner: () => void;
  setTerrainToolboxExpanded: (expanded: boolean) => void;
  closeTerrainToolbox: () => void;
  setTbMode: (mode: string, autoArm?: boolean) => void;
  setupTerrainToolbox: () => void;
  syncToolboxPrecisionUi: (payload?: any) => void;

  // dashboardRenderOrchestrator
  getDashboardAndAuthoringController: () => DashboardAndAuthoringController;
  getMissionIoController: () => MissionIoController;
  getCommandPaletteController: () => CommandPaletteController;
  renderRegistration: (frame: TelemetryFrame) => void;
  renderNtnSignalingAnalyzer: (frame: TelemetryFrame) => void;
  handleAcnSelection: () => void;
  renderSelectedNodeDetails: () => void;
  handleNodeSelection: (nodeId: number) => void;
  renderSoldierPhoneWorkspace: (frame: TelemetryFrame) => void;
  renderOpsFleetRegistry: (nodes: TelemetryFrame['nodes_telemetry'] | undefined) => void;
  renderTerminalInventory: (
    nodes: TelemetryFrame['nodes_telemetry'] | undefined,
    selectedId: number,
    query?: string
  ) => void;
  populateDropdownsOnce: (nodes: TelemetryFrame['nodes_telemetry']) => void;
  renderVsaScope: (nodeTel: NodeTelemetryItem | null | undefined, frame: TelemetryFrame) => void;
  updateOpsQosSlaUI: (
    report: QosNetworkSlaReport | null,
    nodes: TelemetryFrame['nodes_telemetry']
  ) => void;
  renderQosSlaAnalyzer: (frame: TelemetryFrame) => void;
  observeTelemetryTiming: (frame: TelemetryFrame | null) => void;
  renderWorkerJitterProfiler: (frame: TelemetryFrame | null) => void;
  renderTwinCalibrationScope: () => void;
  updateTwinCalibrationDOM: (report: TwinEvaluationReport | null) => void;
  isMgrsGridActive: () => boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  buildCurrentAarSnapshot: () => any;
  renderNetworkTrafficInventory: (frame: TelemetryFrame) => void;
  experimentObserve: (frame: TelemetryFrame) => void;
  initializeExperimentCapture: () => void;
  updateDashboardDOM: (frame: TelemetryFrame, forceImmediate?: boolean) => void;
  syncZoomHudReadout: () => void;

  // scientificScopesAndTimelineController
  drawNetworkCharts: () => void;
  updateNetworkNodeOptions: (nodes: readonly any[]) => void;
  ingestNetworkPerformance: (frame: TelemetryFrame) => void;
  updateStepControlUI: (enabled?: boolean) => void;
  updatePauseButtonUI: () => void;
  recordHistoricalFrame: (frame: TelemetryFrame) => void;
  updateScrubberUI: () => void;
  syncHistoricalUIState: (rec?: HistoricalFrameRecord | null) => void;
  syncLiveUIState: () => void;
  recordSchedulerHistoricalFrame: (frame: TelemetryFrame) => void;
  updateSchedulerScrubberUI: () => void;
  syncSchedulerHistoricalUIState: (rec?: SchedulerFrameRecord | null) => void;
  syncSchedulerLiveUIState: () => void;
  returnSchedulerToLive: () => void;
  drawSchedulerCharts: () => void;
  drawPolarAntennaScope: (frame: TelemetryFrame) => void;
  drawLinkWaterfallCanvas: (frame: TelemetryFrame) => void;
  updateScientificAblationMatrix: (frame: TelemetryFrame) => void;
  drawEcdfDelayScope: (frame: TelemetryFrame) => void;
  drawSensitivitySweepScope: (frame: TelemetryFrame) => void;
  drawWaterfall: () => void;
  updatePduDissectorPanel: (frame: TelemetryFrame) => void;
  drawFresnel: () => void;

  // domEventBindings
  isDiagnosticsPanelVisible: () => boolean;
  isNeutralMapSelectionMode: () => boolean;
  dismissNodeInspector: () => void;
  disarmDestructiveButton: (btn: HTMLElement | null) => void;
  disarmAllDestructiveConfirmations: (exceptBtn?: HTMLElement | null) => void;
  armDestructiveConfirm: (
    buttonEl: HTMLElement | null,
    options: {
      armedLabel?: string;
      timeoutMs?: number;
      canArm?: () => boolean;
      onBlocked?: (() => void) | null;
      onConfirm: () => void;
    }
  ) => void;
  syncFloatingOverlayLayout: () => void;
  syncEditModeBanner: () => void;
  syncRadarHudMode: () => void;
  getContextualMapContext: () => ContextualMapContext;
  syncMapLegendVisibility: () => void;
  syncRfQuickToggleButtons: () => void;
  applyThreeLayerVisibility: () => void;
  applyMapLayersToAllRenderers: () => void;
  restoreFlightParamsFromCommitted: () => void;
  updateSpatialLockControl: (locked: boolean) => void;
  setTrajectoryMessage: (msg: string, isError?: boolean) => void;
  updateAltitudeModeUI: () => void;
  syncTrajectoryEditorFromWorker: (cfg: TrajectoryConfigTelemetry | null | undefined) => void;
  setTrajectoryDraftMode: (mode: string) => void;
  refreshTrajectoryEditor: () => void;
  addWaypointAt: (xM: number, yM: number) => void;
  applyTrajectoryDraft: () => void;
  cancelTrajectoryDraft: () => void;
  editEllipseFromInputs: () => void;
  editSelectedWaypointFromInputs: () => void;
  renderFlightPlanVerticalProfile: () => void;
  getObstacleEndpoints: (obs: any) => any;
  renderObstacleInventoryList: () => void;
  applyObstacleHistoryChange: (nextObstacles: any[]) => void;
  recomputeCadObstacleAnalysis: () => void;
  refreshObstacleEditor: () => void;
  editSelectedObstacleFromInputs: () => void;
  createObstacleAt: (xM: number, yM: number) => void;
  applyObstacleDraft: () => void;
  cancelObstacleDraft: () => void;
  activateObstacleMode: (mode: string) => void;
  setTdmaMessage: (msg: string, isError?: boolean) => void;
  updateTdmaLivePreview: () => void;
  syncInputsFromDraft: () => void;
  syncTdmaEditorFromWorker: (cfg: ITdmaFrameConfig | null | undefined) => void;
  validateTdmaDraft: () => { ok: boolean; error?: string };
  handleTdmaCommandResult: (msg: WorkerCommandResult) => void;
  applyTdmaDraft: () => void;
  resetTdmaToStandard: () => void;
  setRadarRange: (rangeM: number, options?: { duration?: number; resetOrientation?: boolean }) => void;
  updateHiFiPhysicsUI: (
    hifi?: HiFiPhysicsTelemetry | null,
    transportAbr?: TransportAbrTelemetry | null,
    ewEccm?: EwEccmTelemetry | null,
    constellationMobility?: ConstellationMobilityTelemetry | null
  ) => void;
  updateBiomePhysicsUI: (msg: TelemetryFrameMessage) => void;
  syncSelectedNodeAglUI: () => void;
  handleAglCommandResult: (msg: WorkerCommandResult) => void;
  handleNodeCommandResult: (msg: WorkerCommandResult) => void;
  initNodeInventoryToolbar: () => void;
  openNodeEditModal: (nodeId?: number) => void;
  closeNodeEditModal: () => void;
  syncMapNodeDragVisibility: (isDragging: boolean) => void;
  syncNodeDropdowns: (nodeId: number) => void;
  resizeCanvases: () => void;
  scheduleResizeCanvases: () => void;
  openResearchDocsWindow: () => void;
}

export interface AppContext {
  worker: Worker;
  state: AppState;
  engines: {
    workbenchShell: ReturnType<typeof initWorkbenchShell>;
    telemetryUpdaters: ReturnType<typeof createTelemetryDomUpdaters>;
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
  const actions = {} as AppActions;

  const workbenchShell = initWorkbenchShell();
  const telemetryUpdaters = createTelemetryDomUpdaters({
    onSelectNode: (nid: string | number) => {
      if (typeof window.onTargetNodeChange === 'function') {
        window.onTargetNodeChange(Number(nid));
      }
    },
    onEditNode: (nid: number) => {
      actions.openNodeEditModal?.(nid);
    },
    getSelectedTeamFilter: () => state.opsFleetTeamFilter,
    getCheckedFleetNodeIds: () => state.checkedFleetNodeIds,
    onToggleFleetNodeCheck: (nid: number, checked: boolean) => {
      if (checked) state.checkedFleetNodeIds.add(nid);
      else state.checkedFleetNodeIds.delete(nid);
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
    radarSweepPhaseS: 0,
    pendingThreeRecenter: false,
    selectedNodeId: -1,
    inspectorDismissed: true,
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
    equipmentPlacementArmed: false,
    lastEquipmentListSig: '',
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
    } as unknown as TelemetryFrame,
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
    selectedTrafficTeamId: null,
    selectedTeamId: null,
    opsFleetTeamFilter: null,
    checkedFleetNodeIds: new Set<number>(),
    nodeModalTargetId: -1,
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
    activeSelectElement: null,
    selectInteractionUntilMs: 0,
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
