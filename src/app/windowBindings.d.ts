import type { SrtmCatalogTile } from '../core/hgtMosaic.ts';
import type { DemGeographicMetadata, TerrainBoundsTelemetry } from '../core/terrain.ts';
import type {
  ConstellationMobilityTelemetry,
  EwEccmTelemetry,
  HiFiPhysicsTelemetry,
  NodeTelemetryItem,
  TelemetryFrame,
  TelemetryFrameMessage,
  TransportAbrTelemetry,
  WorkerCommandResult,
} from '../shared/workerProtocol.ts';
type MapController = import('../ui/mapController.ts').MapController;
import type { StageViewMode, TerrainMeshResolution } from '../ui/three/threeTypes.ts';

export type TerrainBoundsLike = Partial<TerrainBoundsTelemetry & DemGeographicMetadata> & {
  halfWidthM?: number;
  halfHeightM?: number;
  minElevationM?: number;
  maxElevationM?: number;
};

declare global {
  interface Window {
    // Tauri & runtime raster configuration globals
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: {
      invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    __xbandMapLibreRaster?: {
      tiles?: string | string[];
      attribution?: string;
      maxzoom?: number;
    };
    __xbandMapLibreRasterTileUrl?: string;
    __xbandMapLibreRasterAttribution?: string;
    __xbandRadarDemTileUrl?: string;

    // Terrain upload & DEM controls
    getTerrainLayout?: () => {
      width: number;
      height: number;
      padL: number;
      padR: number;
      padT: number;
      padB: number;
    };
    centerMapOnTerrain?: (bounds: TerrainBoundsLike | null | undefined) => void;
    setTerrainMode?: (mode: 'real' | 'synthetic') => void;
    openUploadModal?: () => void;
    closeUploadModal?: () => void;
    onDragOver?: (e: DragEvent) => void;
    onDragLeave?: (e: DragEvent) => void;
    onDropFile?: (e: DragEvent) => void;
    onFileSelected?: (file: File) => void;
    onFolderSelected?: (fileList: FileList) => Promise<void>;
    cancelHgtLoad?: () => void;
    unloadCustomTerrain?: () => void;
    loadActivePatch?: (options: {
      catalog: readonly SrtmCatalogTile[];
      targetLatDeg?: number;
      targetLonDeg?: number;
      anchorTileName?: string;
      maxTiles?: number;
    }) => Promise<void>;
    shiftTerrainPatch?: (dLat: number, dLon: number) => Promise<void>;
    resolveBundledDemUrl?: () => string;

    // View mode, MapLibre & 3D WebGL stage controls
    isAirGapOfflineMode?: () => boolean;
    setAirGapOfflineMode?: (enabled: boolean) => boolean;
    releaseInactiveWebglContexts?: () => { three: boolean; maplibre: boolean };
    setTerrainMeshResolution?: (res: TerrainMeshResolution | string) => void;
    setStageViewMode?: (mode: StageViewMode) => void;
    setMapMode?: (mode: 'radar' | 'maplibre') => void;
    mapController?: MapController | null;

    // Terrain Toolbox compatibility & Playwright hooks
    tbOpen?: boolean;
    terrainToolMode?: string;
    __onToolboxCacheInvalidated?: () => void;
    renderToolboxDrawer?: () => void;
    handleToolboxMapClick?: (point: { x: number; y: number; lng?: number; lat?: number }) => boolean | void;
    finishTerrainRegion?: () => void;
    cancelTerrainTool?: () => void;
    clearTerrainMeasurement?: () => void;
    refreshTerrainToolbox?: () => void;
    updateStepGuideBanner?: () => void;
    setTerrainToolboxExpanded?: (expanded: boolean) => void;
    closeTerrainToolbox?: () => void;
    openTerrainToolbox?: (mode?: string) => void;
    setTbMode?: (mode: string, autoArm?: boolean) => void;
    isEditableKeyboardTarget?: (target: EventTarget | null) => boolean;
    refreshToolboxActionGates?: () => void;
    toggleTerrainToolbox?: () => void;

    // Simulation playback, scenario & scheduler controls
    togglePause?: () => void;
    stepSim?: () => void;
    resetSim?: () => void;
    setSpeed?: (spd: number | string) => void;
    onSpeedSliderInput?: (val: string) => void;
    onSpeedNumInput?: (val: string) => void;
    loadPreset?: (id: string) => void;
    runKargilScenario?: () => void;
    toggleActiveScheduler?: () => void;
    setRadarRange?: (rangeM: number, options?: { duration?: number; resetOrientation?: boolean }) => void;
    centerMapOnACN?: () => void;
    returnToLive?: () => void;
    returnSchedulerToLive?: () => void;

    // RF, physics, biome & EW controls
    onParamChange?: () => void;
    onCoverageParamChange?: () => void;
    onBandwidthParamChange?: () => void;
    onScientificParamChange?: () => void;
    toggleActiveRelay?: () => void;
    onHiFiToggleChange?: (modelKey: string, enabled: boolean) => void;
    toggleAllHiFiPhysics?: () => void;
    updateHiFiPhysicsUI?: (
      hifi?: HiFiPhysicsTelemetry | null,
      transportAbr?: TransportAbrTelemetry | null,
      ewEccm?: EwEccmTelemetry | null,
      constellationMobility?: ConstellationMobilityTelemetry | null
    ) => void;
    onEwConfigChange?: (key: string, val: unknown) => void;
    onConstellationConfigChange?: (key: string, val: unknown) => void;
    syncDemQuickPresetButtons?: (sectorVal: string) => void;
    applyDemQuickPreset?: (presetId: string) => void;
    onDemSectorChange?: (sectorVal: string) => void;
    onBiomeEmToggleChange?: (enabled: boolean) => void;
    onBiomePolChange?: (pol: string) => void;
    onBiomeDustVisChange?: (visKm: string) => void;
    onBiomeFoliageDepthChange?: (depthM: string) => void;
    updateBiomePhysicsUI?: (msg: TelemetryFrameMessage) => void;
    onRefractivityChange?: (val: string) => void;
    toggleMultiOrderFresnel?: () => void;

    // Node inventory, AGL & traffic controls
    syncSelectedNodeAglUI?: () => void;
    onNodeAglChange?: (val: number | string) => void;
    handleAglCommandResult?: (msg: WorkerCommandResult) => void;
    handleNodeCommandResult?: (msg: WorkerCommandResult) => void;
    initNodeInventoryToolbar?: () => void;
    onTargetNodeChange?: (val: number | string) => void;
    filterTerminalOptions?: (query: string) => void;
    injectTraffic?: (type: string) => void;
    clearTransfer?: () => void;

    // UI navigation, guards & inspection
    switchMainTab?: (targetTabId: string) => void;
    switchOverviewSubview?: (subview: string) => void;
    switchAuthoringPane?: (pane: string) => void;
    switchDocSubview?: (subview: string) => void;
    toggleDiagJsonExpand?: () => void;
    dismissNodeInspector?: () => void;
    disarmDestructiveButton?: (btn: HTMLElement | null) => void;
    toggleSpatialLock?: () => void;
    toggleViewshedHeatmap?: () => void;
    recomputeRelayAdvisor?: () => void;

    // Scopes, Soldier EUD, GIS & Diagnostics
    exportLatexAblationTable?: () => void;
    renderNtnSignalingAnalyzer?: (frame: TelemetryFrame) => void;
    copilotBuddyEnabled?: boolean;
    copilotLpiEnabled?: boolean;
    aiAutoHealEnabled?: boolean;
    pinnedSoldierIds?: Set<number>;
    openSoldierPhone?: (nodeId?: number) => void;
    executeAiNodeReposition?: () => void;
    toggleAiAutoHeal?: () => void;
    togglePinShepherd?: () => void;
    toggleBuddyMesh?: () => void;
    toggleLpiStealth?: () => void;
    renderOpsFleetRegistry?: (nodes: TelemetryFrame['nodes_telemetry'] | undefined) => void;
    renderVsaScope?: (nodeTel: NodeTelemetryItem | null | undefined, frame: TelemetryFrame) => void;
    renderQosSlaAnalyzer?: (frame: TelemetryFrame) => void;
    renderTwinCalibrationScope?: () => void;
    initDigitalTwinCalibrationUI?: () => void;
    isMgrsGridActive?: () => boolean;
    initMilitaryGisUI?: () => void;
    observeTelemetryTiming?: (frame: TelemetryFrame) => void;
    renderWorkerJitterProfiler?: (frame: TelemetryFrame) => void;
    switchTerminalSubtab?: (subtabName: string) => void;
    onTrafficNodeSelectChange?: (nodeIdStr: string) => void;
    onTrafficFilterChange?: () => void;
    resetTrafficFilters?: () => void;
    sortTrafficTable?: (colName: string) => void;
  }
}
