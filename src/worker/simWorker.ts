/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * 50 Hz WebWorker Simulation Engine
 *
 * Runs headless discrete-event network simulation in a background thread:
 * 1. Generates 512x512 3D Lambertian hillshade across the expanded 1,200x1,200 km regional theater.
 * 2. Awaits real satellite DEM acquisition (/terrain/real_ladakh_dem.bin) on startup using dynamic Base URL.
 * 3. Dual-scheduler simulation (Static TDMA vs. Tac-TAD Dynamic) with live KPI accumulation.
 * 4. Active mission transfer state machine (SOS, Photo, Video, Voice) with ACK/drop tracking.
 */

import {
  ACNFlightConfig, EnvironmentConfig, GROUND_NODE_IDS, MAX_ACN_WAYPOINTS, NodeType, RFConfig, SPEED_OF_LIGHT,
} from '../core/config';
import { LinkBudgetEngine, LinkStatus, type AirframeChannelOptions } from '../core/linkBudget';
import {
  computeCqiLagFrames, stepOllaOffsetDb, evaluateDelayedCqiAmc, createHarqProcessSlot, stepHarqProcess, computeDynamicTdmaOverhead, SPEED_OF_LIGHT_M_S, type HarqProcessSlot,
} from '../core/macPhyFeedback';
import { computeMinTurnRadiusM } from '../core/kinematicPathSmoother';
import { QuadSectorAntennaEngine } from '../core/antennaArray';
import { Obstacle } from '../core/obstacles';
import { GroundNodeTrafficSubsystem, Packet, QOS_PROFILES } from '../core/queues';
import {
  BaseScheduler, FrameScheduleReport, LegacyStaticScheduler, ReactiveMlwdfScheduler, SlotAllocation, TerrainAwareDynamicScheduler, T_FRAME_S, type SchedulerMacFeedbackOptions,
} from '../core/scheduler';
import {
  ISR_VIDEO_ABR_TIERS, type VideoAbrTier, type AbrState, type AimdState, createInitialAbrState, createInitialAimdState, stepAdaptiveVideoBitrate, stepAimdCongestionControl, computeClosedLoopEffectiveCapacityScale, evaluateNodeTransportAbr, computeTransportAbrTelemetry,
} from '../core/transportAbrEngine';
import {
  computeSpreadSpectrumProcessingGainDb, computeMvdrNullSteeringRejectionDb, evaluateEwJammerMitigation, evaluateAdversaryEsmLpi, computeGnssSpoofingTaDriftUs, buildEwEccmTelemetry, computeNodeEwJammerMitigation, evaluateLiveEwEccmTelemetry, type SpreadSpectrumEccmMode, type EwEccmTelemetry, type EwJammerMitigationResult,
} from '../core/ewEccmEngine';
import {
  stepConstellationWorkerSystem, createDefaultGroundConvoyStates, type ConstellationMobilityTelemetry, type NodeHandoverState, type GroundConvoyState,
} from '../core/constellationAndMobilityEngine';
import { REAL_LADAKH_DEM_METADATA, TerrainBoundsTelemetry, TerrainEngine, TerrainObstruction } from '../core/terrain';
import { RollingGoodputTracker } from '../core/rollingGoodput';
import { RegistrationLifecycle } from '../core/registration';
import { TdmaFrameConfig } from '../core/tdmaConfig';
import {
  NodeRegistry, createDefault16NodeRegistry, GroundNodeEntity, formatDeterministicNodeUuid, NodeTrafficOptions,
} from '../core/nodeRegistry';
import { ActiveTransferManager, type NodeTransferState, getDefaultPayloadBytes } from '../core/transferManager';
import { EdgeAiCopilotCoordinator, type ActiveAiMovement } from './aiCopilotCoordinator';
import {
  EdgeAiQTable, computeAiRecoveryAdvisory, computeToblerWalkingSpeedMs, evaluateAiBuddyRelayRescue, computeAiSkyShepherdUavOffset, computeAiLpiStealthPower, predictNodeBlackoutCountdown, type AiNodeRecoveryRecommendation, type AiBuddyRelayResult, type AiSkyShepherdResult, type AiLpiStealthResult, type AiBlackoutForecastResult, type SquadNodeForBuddyEval, type FixedWingKinematicConstraints,
} from '../core/tacticalAiPathfinder';
import {
  ACNTrajectory, createACNTrajectory, NodeTerrainState, PredictiveLookAheadEngine, PredictiveState, computeAirframeAttitude,
} from '../core/trajectory';
import {
  FRAME_DT, THEATER_HALF_M, MCP_ID, ACN_ID, FRESNEL_SAMPLES, MIN_GROUND_AGL_M, MAX_GROUND_AGL_M, DEFAULT_ANTENNA_AGL_M, MAX_ACTIVE_GROUND_NODES, PLAYBACK_SPEED,
} from '../shared/constants';
import { isFiniteNumber } from '../shared/utils';
import type { Position3D } from '../shared/types';
import type {
  WorkerCommandResult, SelectedLinkBudgetTelemetry, TelemetryGanttAllocation, WorkerInboundCommand, WorkerOutboundMessage, TelemetryFrame, NodeTelemetryItem, FresnelSliceTelemetry, TerrainMeshDataReadyMessage, ConfigUpdateParams, SpatialFrameSnapshot, SpatialNodeSnapshot, SpatialLinkBudgetSnapshot, TimelineCommunicationRecord, SuperframeEpochRecord, SuperframeDiscontinuityRecord, SchedulerEpochMetrics, EvictionDropFinalizationRecord, EvictionSchedulerId, HiFiPhysicsTelemetry, TransportAbrTelemetry,
} from '../shared/workerProtocol';
import { HillshadeGenerator, type HillshadeResult } from './hillshadeGenerator';
import { TelemetrySerializer, normalizeSlotAllocationToFrame, type RunningMetrics, type TelemetrySimulationState } from './telemetrySerializer';
import { NodeLifecycleManager } from './nodeLifecycleManager';
import { TerrainMeshGenerator, type TerrainMeshGenerationResult } from './terrainMeshGenerator';
import { buildFresnelSlice as computeFresnelSlice, buildEmptyFresnelSlice, PROFILE_FRESNEL_FRACTION } from '../core/profileEngine';
import { PolarViewshedEngine, type RelayAdvisorReport } from '../core/viewshedEngine';
import {
  collectTransferables, cloneToTransferableFloat32, packFloat32Grid, packTerrainProfileTyped, packConstellationIQ, type PackedGridFloat32, type UnpackedGridFloat32, type UnpackedTerrainProfile, type UnpackedConstellationIQ,
} from '../core/ipcTransferCodec';
import { BoundedReplayBuffer, type ReplayBufferStats, type ReplayFrameEntry, type ReplayBufferMode } from '../core/boundedReplayBuffer';
import {
  computeDelayQuantiles as computeDelayQuantilesHelper, extractSchedulerEpochMetrics as extractSchedulerEpochMetricsHelper, createSuperframeEpochRecord, buildSpatialFrameSnapshot, buildHiFiPhysicsTelemetry, createDefaultSimulationMetrics, createTelemetryFrameOutboundMessage, buildObstructionStateSnapshot, evaluateAcmCqiAgingAndOlla, computeJammerInterference, captureEvictionFinalizationRecord,
} from './workerKpiHelpers';
import {
  validateConfigUpdateParams, validateNodeMoveCommand, validatePresetCommand, validateTrafficInjectionCommand, resolveScientificParams, resolveViewshedConfig, validateSetBiomeCommand,
} from './workerCommandValidators';
import type { BiomeId, PolarizationMode, AdvectingWeatherCell, BiomeEmParameters } from '../core/biomePhysics';

export {
  FRAME_DT,
  MCP_ID,
  ACN_ID,
  THEATER_HALF_M,
  FRESNEL_SAMPLES,
  HillshadeGenerator,
  TelemetrySerializer,
  NodeLifecycleManager,
  TerrainMeshGenerator,
  ActiveTransferManager,
  normalizeSlotAllocationToFrame,
  PROFILE_FRESNEL_FRACTION,
  PolarViewshedEngine,
  collectTransferables,
  cloneToTransferableFloat32,
  packFloat32Grid,
  packTerrainProfileTyped,
  packConstellationIQ,
  BoundedReplayBuffer,
  computeDelayQuantilesHelper as computeDelayQuantiles,
  extractSchedulerEpochMetricsHelper as extractSchedulerEpochMetrics,
  createSuperframeEpochRecord,
  buildSpatialFrameSnapshot,
  validateConfigUpdateParams,
  validateNodeMoveCommand,
  validatePresetCommand,
  validateTrafficInjectionCommand,
  resolveScientificParams,
  resolveViewshedConfig,
};
export type {
  RelayAdvisorReport,
  WorkerCommandResult,
  SelectedLinkBudgetTelemetry,
  TelemetryGanttAllocation,
  WorkerInboundCommand,
  WorkerOutboundMessage,
  TelemetryFrame,
  NodeTelemetryItem,
  FresnelSliceTelemetry,
  HillshadeResult,
  RunningMetrics,
  NodeTransferState,
  TelemetrySimulationState,
  TerrainMeshGenerationResult,
  PackedGridFloat32,
  UnpackedGridFloat32,
  UnpackedTerrainProfile,
  UnpackedConstellationIQ,
  ReplayBufferStats,
  ReplayFrameEntry,
  ReplayBufferMode,
};

const ANTENNA_HEIGHT_M = 2.0;
const NUM_NODES = GROUND_NODE_IDS.length;

/**
 * Resolves the authoritative simulation frame index associated with a synchronous NODE_DELETE eviction.
 */
export function resolveDeletionFrameAssociation(simTimeS: number, frameIndex: number): number {
  if (frameIndex <= 0) return 1;
  const expectedTickEndS = frameIndex * FRAME_DT;
  if (simTimeS > expectedTickEndS + 1e-9) {
    // Defensive branch (pure-helper unit-tested only; unreachable under current worker tick entry)
    return frameIndex + Math.max(1, Math.ceil((simTimeS - expectedTickEndS - 1e-9) / FRAME_DT));
  }
  return frameIndex;
}

export class SimulationWorkerManager {
  public rfConfig: RFConfig;
  public envConfig: EnvironmentConfig;
  public flightConfig: ACNFlightConfig;
  public terrainEngine: TerrainEngine;
  public linkEngine: LinkBudgetEngine;
  public readonly antennaEngine: QuadSectorAntennaEngine = new QuadSectorAntennaEngine();
  public trajectoryEngine: ACNTrajectory;
  public lookaheadEngine: PredictiveLookAheadEngine;
  public lookaheadIntervalFrames: number = 5; // Default: 10 Hz (every 5th frame) at 50 Hz physics
  private readonly deferredEmergencyQueue: Set<number> = new Set();

  public get lookaheadCadenceHz(): number {
    return Math.round(50 / Math.max(1, this.lookaheadIntervalFrames));
  }

  public setLookaheadCadence(cadenceHz: number): void {
    if (cadenceHz >= 50) {
      this.lookaheadIntervalFrames = 1; // 50 Hz Reference mode
    } else {
      this.lookaheadIntervalFrames = Math.max(1, Math.round(50 / Math.max(1, cadenceHz)));
    }
    this.lookaheadEngine.invalidateAll();
    this.deferredEmergencyQueue.clear();
  }

  public staticScheduler: LegacyStaticScheduler;
  public tacScheduler: TerrainAwareDynamicScheduler;
  public reactiveScheduler: ReactiveMlwdfScheduler;
  public tdmaConfig: TdmaFrameConfig = new TdmaFrameConfig();
  private tdmaAccumulatorS: number = 0.0;

  public simTimeS: number = 0.0;
  public frameIndex: number = 0;
  public speed: number = PLAYBACK_SPEED.defaultValue;
  public achievedSpeed: number = 1.0;
  public isPaused: boolean = false;
  public activeStepRequestId: number | undefined = undefined;
  public schedulerMode: string = 'tac_tad';
  public selectedNodeId: number = -1;
  public currentScenarioPreset: 'ACN_ONLY' | '16_NODES' = 'ACN_ONLY';
  public spatialLocked: boolean = false;
  public spatialRevision: number = 0;
  public liveAltitudeM: number = 5000.0;
  public liveVzMps: number = 0.0;
  public isTerrainClamped: boolean = false;
  public prevAcnVel: Position3D = [0, 0, 0];
  public jammerShieldLossDb: number = 0.0;
  public jammerSectorInterferenceDbm: readonly [number, number, number, number] = [-150.0, -150.0, -150.0, -150.0];
  public readonly viewshedEngine: PolarViewshedEngine = new PolarViewshedEngine();
  public viewshedEnabled: boolean = false;
  public relayAdvisorReport: RelayAdvisorReport | undefined = undefined;
  public relayedNodeCount: number = 0;
  public relayBackhaulSectorId?: 0 | 1 | 2 | 3;
  public relayBackhaulSnrDb?: number;
  private relayHop1ObstructionCache: Map<number, TerrainObstruction> = new Map();

  public clearRelayHop1Cache(): void {
    this.relayHop1ObstructionCache.clear();
  }
  public lastTelemetryFrame: TelemetryFrame | null = null;
  public batchSpatialSnapshots: SpatialFrameSnapshot[] = [];
  public tdmaSimTimeS: number = 0.0;
  public superframeEpochIndex: number = 0;
  public discontinuityIndex: number = 0;
  public simulationRunId: number = 1;
  private evictionFinalizationIndex: number = 0;
  public pendingTimelineRecords: TimelineCommunicationRecord[] = [];
  public readonly replayBuffer: BoundedReplayBuffer<TelemetryFrame> = new BoundedReplayBuffer<TelemetryFrame>({
    maxFrames: 500,
    mode: 'ring',
  });

  public getRetainedBuffers(): Set<ArrayBuffer> {
    const retained = new Set<ArrayBuffer>();
    try {
      const viewshedBuf = this.viewshedEngine.getSinrGrid().buffer;
      if (viewshedBuf instanceof ArrayBuffer) retained.add(viewshedBuf);
    } catch {
      // Ignored if uninitialized
    }
    try {
      const demBuf = this.terrainEngine.realDemGrid?.buffer;
      if (demBuf instanceof ArrayBuffer) retained.add(demBuf);
    } catch {
      // Ignored if uninitialized
    }
    return retained;
  }

  public getLiveAcnPosition(): [number, number, number] {
    const p = this.trajectoryEngine.getAcnPosition(this.simTimeS);
    return [
      p[0] + this.skyShepherdCurrentOffset[0],
      p[1] + this.skyShepherdCurrentOffset[1],
      this.liveAltitudeM + this.skyShepherdCurrentOffset[2],
    ];
  }

  public get viewshedSinrGrid(): Float32Array | undefined {
    return this.viewshedEnabled
      ? cloneToTransferableFloat32(this.viewshedEngine.getSinrGrid())
      : undefined;
  }

  public get relayAdvisor(): RelayAdvisorReport | undefined {
    return this.relayAdvisorReport;
  }

  public computeDelayQuantiles(nodes: readonly GroundNodeTrafficSubsystem[]): number[] {
    return computeDelayQuantilesHelper(nodes, this.simTimeS);
  }

  public get staticDelayEcdfMs(): readonly number[] {
    return this.computeDelayQuantiles(this.nodesStatic);
  }

  public get tacDelayEcdfMs(): readonly number[] {
    return this.computeDelayQuantiles(this.nodesTac);
  }

  public get reactiveDelayEcdfMs(): readonly number[] {
    return this.computeDelayQuantiles(this.nodesReactive);
  }

  public computeRelayAdvisor(): RelayAdvisorReport {
    this.clearRelayHop1Cache();
    const nodes = this.nodesTac.length > 0 ? this.nodesTac : this.nodesStatic;
    const report = this.viewshedEngine.computeOptimalRelayPlacement(
      this.trajectoryEngine,
      this.terrainEngine,
      nodes,
      this.rfConfig,
      this.envConfig
    );
    this.relayAdvisorReport = report;
    return report;
  }

  public nodeRegistry: NodeRegistry;
  public nodesStatic: GroundNodeTrafficSubsystem[] = [];
  public nodesTac: GroundNodeTrafficSubsystem[] = [];
  public nodesReactive: GroundNodeTrafficSubsystem[] = [];
  public linkStatuses: Map<number, LinkStatus> = new Map();
  public readonly linkStatusesStatic: Map<number, LinkStatus> = new Map();
  public readonly linkStatusesReactive: Map<number, LinkStatus> = new Map();
  public readonly linkStatusesTac: Map<number, LinkStatus> = new Map();
  public readonly nodeSinrHistory: Map<number, Float64Array> = new Map();
  public predStates: Map<number, PredictiveState> = new Map();
  public obstructionResults: Map<number, TerrainObstruction> = new Map();
  public readonly transferManager: ActiveTransferManager = new ActiveTransferManager();

  public get nodeTransfers(): ReadonlyMap<number, NodeTransferState> {
    return this.transferManager.states;
  }
  public readonly registrationLifecycle = new RegistrationLifecycle(500);

  public metrics: RunningMetrics;
  public hillshadeGrid: number[][] = [];
  public readonly hillshadeGenerator: HillshadeGenerator;
  public readonly telemetrySerializer: TelemetrySerializer = new TelemetrySerializer();

  // Dedicated Edge-AI Co-Pilot Coordinator (SPEC-SOFTWARE-ENGINEERING-MODULARITY-AND-DRY-REFACTOR)
  public readonly aiCoordinator: EdgeAiCopilotCoordinator = new EdgeAiCopilotCoordinator();

  // Edge-AI NLoS Recovery Pathfinder & Auto-Healing Engine
  public aiAutoHealEnabled: boolean = false;
  get aiBuddyMeshEnabled(): boolean { return this.aiCoordinator.aiBuddyMeshEnabled; }
  set aiBuddyMeshEnabled(v: boolean) { this.aiCoordinator.aiBuddyMeshEnabled = v; }
  get aiLpiStealthEnabled(): boolean { return this.aiCoordinator.aiLpiStealthEnabled; }
  set aiLpiStealthEnabled(v: boolean) { this.aiCoordinator.aiLpiStealthEnabled = v; }
  get aiSkyShepherdActive(): boolean { return this.aiCoordinator.aiSkyShepherdActive; }
  set aiSkyShepherdActive(v: boolean) { this.aiCoordinator.aiSkyShepherdActive = v; }
  get skyShepherdCurrentOffset(): [number, number, number] { return this.aiCoordinator.skyShepherdCurrentOffset; }
  set skyShepherdCurrentOffset(v: [number, number, number]) { this.aiCoordinator.skyShepherdCurrentOffset = v; }
  get skyShepherdTargetOffset(): [number, number, number] { return this.aiCoordinator.skyShepherdTargetOffset; }
  set skyShepherdTargetOffset(v: [number, number, number]) { this.aiCoordinator.skyShepherdTargetOffset = v; }
  get aiSkyShepherdNodeId(): number | null { return this.aiCoordinator.aiSkyShepherdNodeId; }
  set aiSkyShepherdNodeId(v: number | null) { this.aiCoordinator.aiSkyShepherdNodeId = v; }
  get aiSkyShepherdDirective(): string { return this.aiCoordinator.aiSkyShepherdDirective; }
  set aiSkyShepherdDirective(v: string) { this.aiCoordinator.aiSkyShepherdDirective = v; }
  get aiPinnedNodes(): Set<number> { return this.aiCoordinator.aiPinnedNodes; }
  get aiBuddyRelayResults(): Map<number, AiBuddyRelayResult> { return this.aiCoordinator.aiBuddyRelayResults; }
  get aiLpiStealthResults(): Map<number, AiLpiStealthResult> { return this.aiCoordinator.aiLpiStealthResults; }
  get aiBlackoutForecasts(): Map<number, AiBlackoutForecastResult> { return this.aiCoordinator.aiBlackoutForecasts; }
  public readonly aiQTable: EdgeAiQTable = new EdgeAiQTable();
  get aiRecommendations(): Map<number, AiNodeRecoveryRecommendation> { return this.aiCoordinator.aiRecommendations; }
  get aiActiveMovingNodes(): Set<number> { return this.aiCoordinator.aiActiveMovingNodes; }
  public aiActiveRepositionCount: number = 0;
  private get aiLastEvalTick(): Map<number, number> { return this.aiCoordinator.aiLastEvalTick; }
  private get aiActiveMovements(): Map<number, ActiveAiMovement> { return this.aiCoordinator.aiActiveMovements; }
  private aiTickCount: number = 0;

  // High-Fidelity Physics Engine Opt-In Flags & Deterministic State (SPEC-V2-01)
  public enableAirframeShadowing: boolean = false;
  public enableCorrelatedRicianFading: boolean = false;
  public enableMacPhyFeedback: boolean = false;
  public enableDubinsKinematics: boolean = false;
  public viewshedFidelityMode: 'fast' | 'link-budget-parity' = 'fast';

  // Multi-Biome Theater Platform & Biome-Adaptive RF Physics (SPEC-V3-01)
  public biomeId: BiomeId = 'alpine_mountain';
  public enableBiomeEmPhysics: boolean = false;
  public polarizationMode: PolarizationMode = 'RHCP';
  public dustVisibilityKm: number = 15.0;
  public foliageDepthM: number = 0.0;
  public weatherCells: readonly AdvectingWeatherCell[] = [];
  public liveMeanTwoRayGainDb: number = 0.0;
  public liveMeanFoliageLossDb: number = 0.0;
  public liveMeanDustLossDb: number = 0.0;
  public liveMeanPolLossDb: number = 0.0;

  // Transport AIMD Congestion Control & Adaptive Video Bitrate (SPEC-V3-02)
  public enableTransportAbr: boolean = false;
  public readonly aimdStateByNode: Map<number, AimdState> = new Map();
  public readonly abrStateByNode: Map<number, AbrState> = new Map();
  public readonly closedLoopCapacityScaleByNode: Map<number, number> = new Map();
  public abrStepDownsTotal: number = 0;
  public abrStepUpsTotal: number = 0;

  // Worker-owned deterministic state for MAC/PHY & Hi-Fi models
  public readonly ollaOffsetByNode: Map<number, number> = new Map();
  public readonly cqiHistoryByNode: Map<number, number[]> = new Map();
  public readonly harqSlotByNode: Map<number, HarqProcessSlot> = new Map();
  public readonly guardScaleByNode: Map<number, number> = new Map();
  public readonly delayedCqiSnrByNode: Map<number, number> = new Map();
  private readonly cqiDecodeFailureByNode: Map<number, boolean> = new Map();
  private readonly lpiSavedTxPowerByNode: Map<number, number | undefined> = new Map();
  private lastObstructionTimeS: number = -1.0;
  public harqRetxTotal: number = 0;
  public readonly prevSectorByNode: Map<number, number> = new Map();
  public hifiTelemetry: HiFiPhysicsTelemetry | undefined = undefined;

  // Electronic Warfare / ECCM & GNSS Spoofing (SPEC-V3-03)
  public eccmMode: SpreadSpectrumEccmMode = 'NONE';
  public enableMvdrNullSteering: boolean = false; public enableAdversaryEsmModel: boolean = false;
  public gnssSpoofingRateUsPerSec: number = 0.0; public enableAntiSpoofHoldover: boolean = false;
  public gnssSpoofElapsedSec: number = 0.0; public liveMeanProcessingGainDb: number = 0.0;
  public liveMeanSpatialNullRejectionDb: number = 0.0; public liveMeanEffectiveJammerPowerDbm: number = -150.0;
  public liveRawJammerPowerDbm: number = -150.0; public liveJammerSuppressed: boolean = false;
  public liveMaxSlantRangeM: number = 10000.0; public ewEccmTelemetry: EwEccmTelemetry | undefined = undefined;

  // Constellation, MANET & High-Alt Aerodynamics (SPEC-V3-04)
  public acnConstellationCount: number = 1; public enableMultiHopManet: boolean = false;
  public enableGroundConvoyMobility: boolean = false; public windSpeedMs: number = 0.0;
  public windDirectionDeg: number = 270.0; public enableAutoCfitPullUp: boolean = false;
  public readonly nodeHandoverStates: Map<number, NodeHandoverState> = new Map();
  public readonly groundConvoyStates: Map<number, GroundConvoyState> = createDefaultGroundConvoyStates();
  public uavEnduranceRemainingMin: number = 480.0; public handoverEventsTotal: number = 0;
  public constellationMobilityTelemetry: ConstellationMobilityTelemetry | undefined = undefined;

  private timerId: number | null = null;
  private simDebtMs: number = 0.0;
  private lastTickRealMs: number = 0.0;
  private lastSpeedMeasureTime: number = 0.0;
  private lastSpeedMeasureSimTime: number = 0.0;
  private node4Frozen: boolean = false;
  public lastReportStatic: FrameScheduleReport | null = null;
  public lastReportTac: FrameScheduleReport | null = null;
  public lastReportReactive: FrameScheduleReport | null = null;
  /** Monotone counter incremented on every profile emission; used for stale-response detection. */
  private profileSerial: number = 0;

  /** Rolling 200-superframe (4-second) goodput trackers for P50 and P95 statistics (M7.3) */
  public readonly staticGoodputTracker: RollingGoodputTracker = new RollingGoodputTracker(200);
  public readonly tacGoodputTracker: RollingGoodputTracker = new RollingGoodputTracker(200);

  constructor(
    private readonly seedOffset: number = 0,
    initialScenarioPreset?: 'ACN_ONLY' | '16_NODES'
  ) {
    const isWorkerRuntime = typeof self !== 'undefined' && typeof document === 'undefined';
    this.currentScenarioPreset = initialScenarioPreset ?? (isWorkerRuntime ? 'ACN_ONLY' : '16_NODES');

    if (this.currentScenarioPreset === '16_NODES') {
      this.nodeRegistry = createDefault16NodeRegistry(this.seedOffset);
      this.selectedNodeId = 4;
      for (const id of GROUND_NODE_IDS) this.registrationLifecycle.add(id, this.simTimeS);
    } else {
      this.nodeRegistry = new NodeRegistry(this.seedOffset);
      this.selectedNodeId = -1;
    }
    this.rfConfig = new RFConfig();
    this.envConfig = new EnvironmentConfig();
    this.flightConfig = new ACNFlightConfig();
    this.terrainEngine = new TerrainEngine({ theaterExtentM: THEATER_HALF_M, terrainMode: 'real' });
    this.hillshadeGenerator = new HillshadeGenerator(this.terrainEngine);
    this.linkEngine = new LinkBudgetEngine();
    this.liveAltitudeM = this.flightConfig.altitudeMslM;
    this.liveVzMps = 0.0;
    this.isTerrainClamped = false;
    this.trajectoryEngine = createACNTrajectory(
      this.flightConfig,
      undefined,
      (x, y) => this.terrainEngine.getElevation(x, y)
    );
    this.lookaheadEngine = new PredictiveLookAheadEngine(
      this.terrainEngine,
      this.linkEngine,
      this.rfConfig,
      this.envConfig,
      this.flightConfig,
      this.trajectoryEngine
    );

    this.staticScheduler = new LegacyStaticScheduler();
    this.staticScheduler.setTdmaConfig(this.tdmaConfig);
    this.staticScheduler.enableMultiSector = true;
    this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);
    this.tacScheduler.setTdmaConfig(this.tdmaConfig);
    this.reactiveScheduler = new ReactiveMlwdfScheduler(0.008);
    this.reactiveScheduler.setTdmaConfig(this.tdmaConfig);
    this.tdmaAccumulatorS = 0.0;

    this.metrics = createDefaultSimulationMetrics();

    this.initNodes();
    this.registerActiveNodesWithSchedulers();
    this.initTransfers();
    this.computeRelayAdvisor();
  }

  private initNodes(): void {
    const { nodesStatic, nodesTac, nodesReactive } = NodeLifecycleManager.initNodes(this.nodeRegistry, this.terrainEngine);
    this.nodesStatic = nodesStatic;
    this.nodesTac = nodesTac;
    this.nodesReactive = nodesReactive;
    this.aiCoordinator.reset();
    this.aiActiveRepositionCount = 0;
    this.aiAutoHealEnabled = false;
  }

  public getActiveRepositionDistRemaining(nodeId: number): number | null {
    const node = this.nodesStatic.find(n => n.nodeId === nodeId);
    if (!node) return null;
    return this.aiCoordinator.getActiveRepositionDistRemaining(nodeId, node.position);
  }

  public stepSimulation(): void {
    this.tickSimulation(false);
  }

  public handleCommand(msg: WorkerInboundCommand): WorkerCommandResult {
    return this.handleMessage(msg);
  }

  private registerActiveNodesWithSchedulers(): void {
    for (let i = 0; i < this.nodesStatic.length; i++) this.staticScheduler.registerNode(this.nodesStatic[i]);
    for (let i = 0; i < this.nodesTac.length; i++) this.tacScheduler.registerNode(this.nodesTac[i]);
    for (let i = 0; i < this.nodesReactive.length; i++) this.reactiveScheduler.registerNode(this.nodesReactive[i]);
  }

  private reinitSchedulers(): void {
    this.staticScheduler = new LegacyStaticScheduler(); this.staticScheduler.setTdmaConfig(this.tdmaConfig); this.staticScheduler.enableMultiSector = true;
    this.tacScheduler = new TerrainAwareDynamicScheduler(0.008); this.tacScheduler.setTdmaConfig(this.tdmaConfig);
    this.reactiveScheduler = new ReactiveMlwdfScheduler(0.008); this.reactiveScheduler.setTdmaConfig(this.tdmaConfig);
    this.registerActiveNodesWithSchedulers();
  }

  private preparePresetRunReset(): void {
    this.simulationRunId += 1;
    this.evictionFinalizationIndex = 0;
    this.pendingTimelineRecords = [];
    this.batchSpatialSnapshots = [];
  }

  private captureEvictionFinalization(
    schedulerId: EvictionSchedulerId,
    scheduler: LegacyStaticScheduler | TerrainAwareDynamicScheduler,
    nodeId: number,
    node: GroundNodeTrafficSubsystem | undefined,
    associatedSimulationFrameIndex: number
  ): EvictionDropFinalizationRecord | null {
    return captureEvictionFinalizationRecord({
      schedulerId,
      scheduler,
      nodeId,
      node,
      associatedSimulationFrameIndex,
      simulationRunId: this.simulationRunId,
      finalizationIndex: this.evictionFinalizationIndex++,
      simTimeS: this.simTimeS,
    });
  }

  /** Re-derive each ground node's MSL altitude from the currently active terrain and its AGL. */
  private resampleGroundNodeAltitudes(): void {
    NodeLifecycleManager.resampleGroundNodeAltitudes(
      this.nodesStatic,
      this.nodesTac,
      this.nodeRegistry,
      this.terrainEngine,
      this.nodesReactive
    );
  }

  public getNodeEntity(nodeIdOrEntityId: number | string): GroundNodeEntity | undefined {
    if (typeof nodeIdOrEntityId === 'number') {
      return this.nodeRegistry.getByNodeId(nodeIdOrEntityId);
    }
    return this.nodeRegistry.getByEntityId(nodeIdOrEntityId);
  }

  private initTransfers(): void {
    this.transferManager.reset(this.nodeRegistry.getNodeIds());
  }

  /**
   * Generates or retrieves a shaded relief grid across genuine terrain coverage:
   * - In real DEM mode: uses genuine Ladakh DEM coordinates (+/-91.8 km E-W, +/-110.9 km N-S, aspect ratio ~1.2079),
   *   exact metric ground resolution (dx=359.45m, dy=434.17m), and 512x512 matrix.
   * - In synthetic mode: covers full 1,200x1,200 km regional domain (+/-600 km).
   * Delegates computation and caching to HillshadeGenerator, preserving host telemetry emission.
   */
  public initHillshade(gridSize: number = 512): void {
    const result = this.hillshadeGenerator.generate(this.terrainEngine, gridSize);
    this.hillshadeGrid = result.grid;
    this.emitHostMessage(result.message);
  }

  public getTerrainBounds(): TerrainBoundsTelemetry {
    return this.terrainEngine.getTerrainBoundsTelemetry();
  }

  private emitHostMessage(message: WorkerOutboundMessage, transferList?: Transferable[]): void {
    // Keep the engine importable in Node-based headless benchmarks.
    if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
      const actualTransferList = (transferList && transferList.length > 0)
        ? transferList
        : collectTransferables(message, { excludeBuffers: this.getRetainedBuffers() });

      if (actualTransferList && actualTransferList.length > 0) {
        self.postMessage(message, actualTransferList as any);
      } else {
        self.postMessage(message);
      }
    }
  }

  /**
   * Build and emit a PROFILE_FRAME for the currently selected node using the
   * current committed geometry and sim time. Does NOT advance time, queues,
   * scheduler, or frame-based KPIs.
   *
   * The emitted message carries `selectedNodeId` and a monotone `profileSerial`
   * so the UI can discard any response that arrived for an older selection or
   * after a newer request was already processed.
   */
  public emitProfileFrame(): void {
    const acnPos = this.getLiveAcnPosition();
    this.ensureActiveNodesDomainEvaluations(acnPos);
    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;
    const selNode = activeNodes.find((n) => n.nodeId === this.selectedNodeId) ?? activeNodes[0];
    const fresnelSlice = this.buildFresnelSlice(selNode, acnPos);
    const nodesTel = this.buildNodesTelemetry();
    const message = this.telemetrySerializer.buildProfileFrameMessage(
      this.selectedNodeId,
      ++this.profileSerial,
      this.spatialRevision,
      fresnelSlice,
      nodesTel
    );
    this.emitHostMessage(message);
  }

  private buildGroundKinematicConstraints(nodeType: string): FixedWingKinematicConstraints {
    const speedMs = nodeType === 'mcp' ? 8.0 : 1.4;
    const maxVertRateMs = nodeType === 'mcp'
      ? Math.min(2.4, speedMs * 0.3)
      : Math.min(0.6, speedMs * 0.45);
    return {
      speedMs,
      maxBankDeg: 0.0,
      minTurnRadiusOverrideM: nodeType === 'mcp' ? 12.0 : 3.0,
      maxClimbRateMs: maxVertRateMs,
      maxDescentRateMs: maxVertRateMs,
    };
  }

  public tickSimulation(emitTelemetry: boolean = true): void {
    this.simTimeS += FRAME_DT;
    this.frameIndex += 1;
    const t = this.simTimeS;

    const targetPos = this.trajectoryEngine.getAcnPosition(t);
    const targetZ = targetPos[2];

    if (this.flightConfig.altitudeMode === 'fix') {
      this.liveAltitudeM = this.flightConfig.altitudeMslM;
      this.liveVzMps = 0.0;
    } else {
      const deltaZ = targetZ - this.liveAltitudeM;
      const aMax = this.flightConfig.maxVerticalAccelerationMps2 ?? 5.0;
      const vMax = deltaZ >= 0
        ? (this.flightConfig.maxClimbRateMps ?? 10.0)
        : (this.flightConfig.maxDescentRateMps ?? 8.0);
      const halfA_Dt = 0.5 * aMax * FRAME_DT;
      const vBrakeMag = Math.sqrt(2.0 * aMax * Math.abs(deltaZ) + halfA_Dt * halfA_Dt) - halfA_Dt;
      const vBrake = Math.sign(deltaZ) * Math.max(0, vBrakeMag);
      const vDesired = Math.sign(deltaZ) * Math.min(vMax, Math.abs(vBrake));
      const maxDeltaV = aMax * FRAME_DT;
      const deltaV = Math.max(-maxDeltaV, Math.min(maxDeltaV, vDesired - this.liveVzMps));
      this.liveVzMps += deltaV;

      const nextZ = this.liveAltitudeM + this.liveVzMps * FRAME_DT;
      if ((deltaZ > 0 && nextZ >= targetZ) || (deltaZ < 0 && nextZ <= targetZ)) {
        this.liveAltitudeM = targetZ;
      } else {
        this.liveAltitudeM = nextZ;
      }
    }

    const terrainZ = this.terrainEngine.getElevation(targetPos[0], targetPos[1]);
    const safeFloor = Number.isFinite(terrainZ) ? terrainZ + 50.0 : 50.0;
    if (this.liveAltitudeM < safeFloor) {
      this.liveAltitudeM = safeFloor;
      if (this.liveVzMps < 0) this.liveVzMps = 0.0;
      this.isTerrainClamped = true;
    } else {
      this.isTerrainClamped = false;
    }

    // Closed-Loop Pillar 3: Sky-Shepherd UAV Loiter Orbit Slew Dynamics (80 m/s horiz, 25 m/s vert)
    const shepherdOffset = this.aiCoordinator.stepSkyShepherdSlew(FRAME_DT);

    const acnPos: [number, number, number] = [
      targetPos[0] + shepherdOffset[0],
      targetPos[1] + shepherdOffset[1],
      this.liveAltitudeM + shepherdOffset[2],
    ];

    // Advance active Edge-AI node repositioning movements
    const movedAny = this.aiCoordinator.stepActiveAiNodeMoves(
      FRAME_DT,
      (x, y) => this.terrainEngine.getElevation(x, y),
      this.nodesStatic,
      this.nodesTac,
      this.nodesReactive,
      this.nodeRegistry,
      this.linkStatuses,
      this.aiQTable
    );
    if (movedAny) {
      this.spatialRevision++;
      this.lookaheadEngine.invalidateAll();
      this.deferredEmergencyQueue.clear();
    }
    this.aiActiveRepositionCount = this.aiCoordinator.aiActiveMovements.size;

    // Refresh all spatially derived decisions before traffic generation reads isShadowed.
    this.refreshObstructionState(acnPos, t);

    // Evaluate Edge-AI NLoS Recovery recommendations (cadenced to >= 50 ticks / 1.0s)
    this.aiTickCount++;
    for (let i = 0; i < this.nodesStatic.length; i++) {
      const node = this.nodesStatic[i];
      const nid = node.nodeId;
      const ls = this.linkStatuses.get(nid);
      const isOutage = ls?.isOutage ?? true;
      const sinrDb = ls?.sinrDb ?? ls?.snrDb ?? -99.0;
      const lastEval = this.aiLastEvalTick.get(nid) ?? -999;

      if ((isOutage || sinrDb < 8.0) && (this.aiTickCount - lastEval >= 50)) {
        const rec = computeAiRecoveryAdvisory({
          nodeId: nid,
          nodePos: node.position,
          nodeType: node.nodeType,
          acnPos,
          currentSinrDb: sinrDb,
          currentIsOutage: isOutage,
          getElevationAt: (x, y) => this.terrainEngine.getElevation(x, y),
          qTable: this.aiQTable,
          obstacles: this.terrainEngine.obstacleField.all,
          jammerPosEnu: this.envConfig.jammerPosEnu,
          jammerEnabled: this.envConfig.jammerEnabled,
          rfConfig: this.rfConfig,
          envConfig: this.envConfig,
          kinematicConstraints: this.enableDubinsKinematics
            ? this.buildGroundKinematicConstraints(node.nodeType)
            : undefined,
        });
        this.aiRecommendations.set(nid, rec);
        this.aiLastEvalTick.set(nid, this.aiTickCount);

        // If Auto-Heal is enabled and not already moving, immediately initiate recovery movement
        if (this.aiAutoHealEnabled && rec.needsReposition && !this.aiActiveMovements.has(nid)) {
          const walkPath = rec.walkPathEnu && rec.walkPathEnu.length >= 2
            ? rec.walkPathEnu
            : [node.position, [rec.targetPos[0], rec.targetPos[1], rec.targetPos[2]] as Position3D];
          const firstTarget = walkPath[1] ?? rec.targetPos;
          const firstDist = Math.hypot(firstTarget[0] - node.position[0], firstTarget[1] - node.position[1]);
          const firstDeltaZ = firstTarget[2] - node.position[2];
          const tobler = computeToblerWalkingSpeedMs(firstDist, firstDeltaZ, node.nodeType);
          this.aiActiveMovements.set(nid, {
            targetPos: [rec.targetPos[0], rec.targetPos[1], rec.targetPos[2]],
            speedMs: Math.max(0.5, tobler.speedMs),
            moveBearingDeg: rec.moveBearingDeg,
            waypoints: walkPath,
            waypointIndex: 1,
          });
          this.aiActiveMovingNodes.add(nid);
          this.aiActiveRepositionCount = this.aiActiveMovements.size;
        }
      } else if (!isOutage && sinrDb >= 8.0 && !this.aiActiveMovements.has(nid)) {
        const existingRec = this.aiRecommendations.get(nid);
        if (existingRec && existingRec.needsReposition) {
          const rec = computeAiRecoveryAdvisory({
            nodeId: nid,
            nodePos: node.position,
            nodeType: node.nodeType,
            acnPos,
            currentSinrDb: sinrDb,
            currentIsOutage: false,
            getElevationAt: (x, y) => this.terrainEngine.getElevation(x, y),
            qTable: this.aiQTable,
            obstacles: this.terrainEngine.obstacleField.all,
            jammerPosEnu: this.envConfig.jammerPosEnu,
            jammerEnabled: this.envConfig.jammerEnabled,
            rfConfig: this.rfConfig,
            envConfig: this.envConfig,
            kinematicConstraints: this.enableDubinsKinematics
              ? this.buildGroundKinematicConstraints(node.nodeType)
              : undefined,
          });
          this.aiRecommendations.set(nid, rec);
        }
      }
    }

    // Evaluate Edge-AI Copilot Pillars (cadenced to every 25 ticks / 0.5s)
    if (this.aiTickCount % 25 === 0) {
      // Prepare squad nodes for buddy mesh evaluation
      const squadForBuddy: SquadNodeForBuddyEval[] = this.nodesStatic.map(n => {
        const ls = this.linkStatuses.get(n.nodeId);
        return {
          nodeId: n.nodeId,
          position: n.position,
          nodeType: n.nodeType,
          isOutage: ls?.isOutage ?? true,
          directBitrateMbps: ls?.bitrateMbps ?? 0.0,
          directSinrDb: ls?.sinrDb ?? ls?.snrDb ?? -99.0,
        };
      });

      for (let i = 0; i < this.nodesStatic.length; i++) {
        const node = this.nodesStatic[i];
        const nid = node.nodeId;
        const ls = this.linkStatuses.get(nid);
        const isOutage = ls?.isOutage ?? true;
        const sinrDb = ls?.sinrDb ?? ls?.snrDb ?? -99.0;
        const directRate = ls?.bitrateMbps ?? 0.0;

        // Pillar 1: AI Buddy-Relay Peer-to-Peer Squad Mesh
        if (this.aiBuddyMeshEnabled) {
          const buddyResult = evaluateAiBuddyRelayRescue(
            {
              nodeId: nid,
              position: node.position,
              isOutage,
              directBitrateMbps: directRate,
              directSinrDb: sinrDb,
            },
            squadForBuddy,
            (x, y) => this.terrainEngine.getElevation(x, y),
            this.rfConfig.carrierFrequencyHz,
            this.rfConfig.channelBandwidthHz
          );
          this.aiBuddyRelayResults.set(nid, buddyResult);
        } else {
          this.aiBuddyRelayResults.delete(nid);
        }

        // Pillar 4: AI LPI/LPD Stealth Transmit Power Controller
        const nominalTxPowerDbm = node.nodeType === 'mcp'
          ? (this.rfConfig.mcpTxPowerDbm ?? 40.0)
          : (this.rfConfig.soldierTxPowerDbm ?? 30.0);
        if (this.aiLpiStealthEnabled) {
          const lpiResult = this.aiCoordinator.evaluateLpiStealth(
            nominalTxPowerDbm,
            sinrDb,
            isOutage,
            18.5
          );
          this.aiLpiStealthResults.set(nid, lpiResult);
        } else {
          this.aiLpiStealthResults.set(nid, {
            lpiTxPowerDbm: nominalTxPowerDbm,
            reductionDb: 0.0,
            powerSavedPct: 0.0,
            mode: 'MAX_BOOST_DIFFRACTION',
          });
        }

        // Pillar 5: AI 15-Second Blackout Countdown Forecaster
        const blackoutForecast = this.aiCoordinator.evaluateBlackoutCountdown(
          node.position,
          sinrDb,
          isOutage,
          (dtS: number) => this.trajectoryEngine.getAcnPosition(t + dtS),
          (x, y) => this.terrainEngine.getElevation(x, y),
          t,
          this.rfConfig.carrierFrequencyHz
        );
        this.aiBlackoutForecasts.set(nid, blackoutForecast);
      }

      // Pillar 3: AI Sky-Shepherd UAV Loiter Shift for Pinned Units
      if (this.aiSkyShepherdActive && this.aiSkyShepherdNodeId !== null) {
        const pinnedNode = this.nodesStatic.find(n => n.nodeId === this.aiSkyShepherdNodeId);
        if (pinnedNode) {
          const centerPos: Position3D = [
            this.flightConfig.centerXm,
            this.flightConfig.centerYm,
            this.liveAltitudeM ?? this.flightConfig.altitudeMslM,
          ];
          const shepherdRes = this.aiCoordinator.evaluateSkyShepherd(
            pinnedNode.position,
            centerPos,
            (x, y) => this.terrainEngine.getElevation(x, y),
            this.rfConfig.carrierFrequencyHz
          );
          this.aiSkyShepherdDirective = shepherdRes.shepherdDirectiveText;
        }
      }
    }

    // Capture spatial snapshot for batch preservation (TL-T16)
    this.batchSpatialSnapshots.push(this.captureSpatialFrameSnapshot(acnPos));
    if (this.batchSpatialSnapshots.length > 5000) {
      this.batchSpatialSnapshots.splice(0, this.batchSpatialSnapshots.length - 5000);
    }

    // TDMA Superframe Scheduling via Temporal Accumulator (Resolving Audit Finding 1)
    this.tdmaAccumulatorS += FRAME_DT;
    const tFrame = this.tdmaConfig.frameDurationS;

    if (this.enableTransportAbr) {
      this.stepTransportAbrLoop();
    }

    if (Math.abs(tFrame - FRAME_DT) < 1e-6) {
      this.generateTickTraffic(t, FRAME_DT);
      this.executeTdmaSuperframe(t, FRAME_DT);
      this.recordSuperframeEpoch(FRAME_DT);
      this.tdmaAccumulatorS = 0.0;
      this.stepTransferForCurrentSuperframe(t, this.schedulerMode === 'tac_tad' ? this.lastReportTac : this.lastReportStatic);
    } else if (tFrame < FRAME_DT - 1e-6) {
      while (this.tdmaAccumulatorS >= tFrame - 1e-6) {
        this.generateTickTraffic(t, tFrame);
        this.executeTdmaSuperframe(t, tFrame);
        this.recordSuperframeEpoch(tFrame);
        this.tdmaAccumulatorS -= tFrame;
        this.stepTransferForCurrentSuperframe(t, this.schedulerMode === 'tac_tad' ? this.lastReportTac : this.lastReportStatic);
      }
    } else {
      this.generateTickTraffic(t, FRAME_DT);
      if (this.tdmaAccumulatorS >= tFrame - 1e-6) {
        this.executeTdmaSuperframe(t, tFrame);
        this.recordSuperframeEpoch(tFrame);
        this.tdmaAccumulatorS -= tFrame;
        this.stepTransferForCurrentSuperframe(t, this.schedulerMode === 'tac_tad' ? this.lastReportTac : this.lastReportStatic);
      } else {
        this.stepTransferForCurrentSuperframe(t, null);
      }
    }

    // 6. Dispatch frame to main UI thread
    if (emitTelemetry) {
      const frame = this.buildTelemetryFrame(acnPos);
      this.replayBuffer.push(t, frame, false);
      (frame as any).batch_spatial_snapshots = this.batchSpatialSnapshots.splice(0);
      (frame as any).completed_superframes = this.pendingTimelineRecords.splice(0);
      this.emitHostMessage(createTelemetryFrameOutboundMessage(frame, {
        biomeId: this.biomeId,
        enableBiomeEmPhysics: this.enableBiomeEmPhysics,
        polarizationMode: this.polarizationMode,
        liveMeanTwoRayGainDb: this.liveMeanTwoRayGainDb,
        liveMeanFoliageLossDb: this.liveMeanFoliageLossDb,
        liveMeanDustLossDb: this.liveMeanDustLossDb,
        liveMeanPolLossDb: this.liveMeanPolLossDb,
        weatherCellCount: this.weatherCells.length,
      }));
    }
  }

  private stepTransferForCurrentSuperframe(t: number, activeReport: FrameScheduleReport | null): void {
    this.transferManager.step({
      activeNodes: this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic,
      linkStatuses: this.linkStatuses,
      predStates: this.predStates,
      activeReport,
      simTimeS: t,
      isPaused: this.isPaused,
    });
  }

  private generateTickTraffic(t: number, stepDt: number): void {
    const trafficScale = this.envConfig.trafficLoadMultiplier ?? 1.0;
    for (let i = 0; i < this.nodesStatic.length; i++) {
      const nid = this.nodesStatic[i].nodeId;
      const abr = this.abrStateByNode.get(nid);
      const tierIdx = abr?.currentTierIndex ?? 2;
      const tierDef = ISR_VIDEO_ABR_TIERS[tierIdx] ?? ISR_VIDEO_ABR_TIERS[2];
      const videoScale = this.enableTransportAbr ? tierDef.targetBitrateMbps / 2.5 : 1.0;

      const sPkts = this.nodesStatic[i].generateTraffic(t, stepDt, trafficScale, videoScale);
      const tPkts = this.nodesTac[i].generateTraffic(t, stepDt, trafficScale, videoScale);
      const rPkts = this.nodesReactive[i]?.generateTraffic(t, stepDt, trafficScale, videoScale) ?? [];
      this.metrics.staticEnqueuedPkts += sPkts.length;
      this.metrics.tacEnqueuedPkts += tPkts.length;
      this.metrics.reactiveEnqueuedPkts = (this.metrics.reactiveEnqueuedPkts ?? 0) + rPkts.length;

      this.nodesStatic[i].queue.pruneExpiredPackets(t);
      this.nodesTac[i].queue.pruneExpiredPackets(t);
      this.nodesReactive[i]?.queue.pruneExpiredPackets(t);
    }
  }

  private executeTdmaSuperframe(t: number, tFrame: number): void {
    const macFeedbackOptions: SchedulerMacFeedbackOptions | undefined = this.enableMacPhyFeedback
      ? {
          nodeClosedLoopCapacityScale: this.closedLoopCapacityScaleByNode,
          nodeGuardScale: this.guardScaleByNode,
          nodeDelayedCqiSnrDb: this.delayedCqiSnrByNode,
          nodeOllaOffsetDb: this.ollaOffsetByNode,
        }
      : undefined;

    // 2. Schedulers
    const reportStatic = this.staticScheduler.scheduleFrame(
      this.frameIndex,
      t,
      this.nodesStatic,
      this.linkStatusesStatic.size > 0 ? this.linkStatusesStatic : this.linkStatuses,
      this.predStates,
      0,
      macFeedbackOptions
    );
    const reportTac = this.tacScheduler.scheduleFrame(
      this.frameIndex,
      t,
      this.nodesTac,
      this.linkStatusesTac.size > 0 ? this.linkStatusesTac : this.linkStatuses,
      this.predStates,
      0,
      macFeedbackOptions
    );
    const reportReactive = this.reactiveScheduler.scheduleFrame(
      this.frameIndex,
      t,
      this.nodesReactive,
      this.linkStatusesReactive.size > 0 ? this.linkStatusesReactive : this.linkStatuses,
      this.predStates,
      0,
      macFeedbackOptions
    );

    this.lastReportStatic = reportStatic;
    this.lastReportTac = reportTac;
    this.lastReportReactive = reportReactive;

    // Rolling goodput sampling (M7.3: 200 superframes of completed payload delivery)
    this.staticGoodputTracker.recordSuperframeDeliveredBits(reportStatic.totalBitsTransmitted, tFrame);
    this.tacGoodputTracker.recordSuperframeDeliveredBits(reportTac.totalBitsTransmitted, tFrame);

    // 3. Metrics accumulation
    this.metrics.staticGoodputBits += reportStatic.totalBitsTransmitted;
    this.metrics.staticWastedBits += reportStatic.totalBitsWastedOnOutage;
    this.metrics.tacGoodputBits += reportTac.totalBitsTransmitted;
    this.metrics.tacWastedBits += reportTac.totalBitsWastedOnOutage;
    this.metrics.reactiveGoodputBits = (this.metrics.reactiveGoodputBits ?? 0) + reportReactive.totalBitsTransmitted;
    this.metrics.reactiveWastedBits = (this.metrics.reactiveWastedBits ?? 0) + reportReactive.totalBitsWastedOnOutage;
    this.metrics.staticDroppedPkts += reportStatic.packetsDroppedDelayThisFrame + reportStatic.packetsDroppedOverflowThisFrame;
    this.metrics.tacDroppedPkts += reportTac.packetsDroppedDelayThisFrame + reportTac.packetsDroppedOverflowThisFrame;
    this.metrics.reactiveDroppedPkts = (this.metrics.reactiveDroppedPkts ?? 0) + reportReactive.packetsDroppedDelayThisFrame + reportReactive.packetsDroppedOverflowThisFrame;
    this.metrics.lastStaticUtilPct = reportStatic.totalUlUtilizationPct;
    this.metrics.lastTacUtilPct = reportTac.totalUlUtilizationPct;
    this.metrics.lastReactiveUtilPct = reportReactive.totalUlUtilizationPct;
    this.metrics.staticScheduledUlTimeS += reportStatic.totalUlScheduledS;
    this.metrics.tacScheduledUlTimeS += reportTac.totalUlScheduledS;
    this.metrics.reactiveScheduledUlTimeS = (this.metrics.reactiveScheduledUlTimeS ?? 0) + reportReactive.totalUlScheduledS;
    this.metrics.staticAvailableUlTimeS += reportStatic.totalUlAvailableS;
    this.metrics.tacAvailableUlTimeS += reportTac.totalUlAvailableS;
    this.metrics.reactiveAvailableUlTimeS = (this.metrics.reactiveAvailableUlTimeS ?? 0) + reportReactive.totalUlAvailableS;
    this.metrics.staticUnusedUlTimeS += reportStatic.totalUlUnusedS;
    this.metrics.tacUnusedUlTimeS += reportTac.totalUlUnusedS;
    this.metrics.reactiveUnusedUlTimeS = (this.metrics.reactiveUnusedUlTimeS ?? 0) + reportReactive.totalUlUnusedS;
    this.metrics.staticPayloadBitsDequeued += reportStatic.totalPayloadBitsDequeued;
    this.metrics.tacPayloadBitsDequeued += reportTac.totalPayloadBitsDequeued;
    this.metrics.reactivePayloadBitsDequeued = (this.metrics.reactivePayloadBitsDequeued ?? 0) + reportReactive.totalPayloadBitsDequeued;
    this.metrics.staticDelayDropsThisRun += reportStatic.packetsDroppedDelayThisFrame;
    this.metrics.tacDelayDropsThisRun += reportTac.packetsDroppedDelayThisFrame;
    this.metrics.reactiveDelayDropsThisRun = (this.metrics.reactiveDelayDropsThisRun ?? 0) + reportReactive.packetsDroppedDelayThisFrame;
    this.metrics.staticOverflowDropsThisRun += reportStatic.packetsDroppedOverflowThisFrame;
    this.metrics.tacOverflowDropsThisRun += reportTac.packetsDroppedOverflowThisFrame;
    this.metrics.reactiveOverflowDropsThisRun = (this.metrics.reactiveOverflowDropsThisRun ?? 0) + reportReactive.packetsDroppedOverflowThisFrame;
    this.metrics.staticFinalBacklogBits = reportStatic.totalBacklogBits;
    this.metrics.tacFinalBacklogBits = reportTac.totalBacklogBits;
    this.metrics.reactiveFinalBacklogBits = reportReactive.totalBacklogBits;

    // 4. Track Node 4 pre-shadow backlog
    const n4Pred = this.predStates.get(4);
    const node4Tac = this.nodesTac.find(n => n.nodeId === 4);
    const node4Stat = this.nodesStatic.find(n => n.nodeId === 4);
    const n4TacKb = node4Tac ? node4Tac.queue.getTotalBacklogBytes() / 1024.0 : 0.0;
    const n4StatKb = node4Stat ? node4Stat.queue.getTotalBacklogBytes() / 1024.0 : 0.0;

    if (n4Pred?.currentState === NodeTerrainState.NORMAL_LOS || n4Pred?.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
      this.metrics.node4PreShadowBacklogKb = n4TacKb;
      this.metrics.staticNode4PreShadowBacklogKb = n4StatKb;
      this.node4Frozen = false;
    } else if (n4Pred?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF && !this.node4Frozen) {
      this.metrics.node4PreShadowBacklogKb = n4TacKb;
      this.metrics.staticNode4PreShadowBacklogKb = n4StatKb;
      this.node4Frozen = true;
    }

    // 4.5. Deterministic Per-Arm Node Battery & Energy Drain Model
    const drainArm = (nodes: GroundNodeTrafficSubsystem[], report: FrameScheduleReport, syncRegistry: boolean) => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const isMcp = node.nodeType === 'mcp';
        const iIdleMa = isMcp ? 400.0 : 150.0;
        const pTxDbm = node.txPowerDbm ?? (isMcp ? 43.0 : 36.0);
        const iTxTotalMa = iIdleMa + (Math.pow(10.0, (pTxDbm - 30.0) / 10.0) / 4.2) * 1000.0;
        const alloc = report.allocations.find((a) => a.nodeId === node.nodeId);
        const tTxS = alloc && alloc.durationS > 0 && !node.isDepleted ? alloc.durationS : 0.0;
        const drainedMah = (iIdleMa * Math.max(0.0, tFrame - tTxS) + iTxTotalMa * tTxS) / 3600.0;
        const capMah = Math.max(100.0, node.batteryCapacityMah || (isMcp ? 20000.0 : 5000.0));
        node.batteryLevelPct = Math.max(0.0, Math.min(100.0, node.batteryLevelPct - (drainedMah / capMah) * 100.0));
        node.isDepleted = node.batteryLevelPct <= 0.0;
        if (syncRegistry) this.nodeRegistry.updateBatteryLevel(node.nodeId, node.batteryLevelPct);
      }
    };
    drainArm(this.nodesTac, reportTac, this.schedulerMode === 'tac_tad');
    drainArm(this.nodesStatic, reportStatic, this.schedulerMode === 'static');
    drainArm(this.nodesReactive, reportReactive, this.schedulerMode !== 'tac_tad' && this.schedulerMode !== 'static');
  }

  public captureSpatialFrameSnapshot(acnPos: [number, number, number]): SpatialFrameSnapshot {
    const vel = this.trajectoryEngine.getAcnVelocity(this.simTimeS);
    const vx = vel[0];
    const vy = vel[1];
    const vz = this.liveVzMps;
    const acnVel: [number, number, number] = [vx, vy, vz];
    const attitude = this.antennaEngine.computeAcnAttitude(acnVel, this.simTimeS, false);
    const terrainElevation = this.terrainEngine.getElevation(acnPos[0], acnPos[1]);

    return buildSpatialFrameSnapshot({
      frameIndex: this.frameIndex,
      simTimeS: this.simTimeS,
      wallClockTimeMs: performance.now(),
      spatialRevision: this.spatialRevision,
      acnPos,
      acnVel,
      liveAltitudeM: this.liveAltitudeM,
      liveVzMps: this.liveVzMps,
      terrainElevation,
      coverageRadiusKm: this.flightConfig.coverageRadiusKm,
      isTerrainClamped: this.isTerrainClamped,
      attitudeHeadingDeg: attitude.headingDeg,
      attitudeBankDeg: attitude.bankDeg,
      nodesTac: this.nodesTac,
      obstructionResults: this.obstructionResults,
      linkStatuses: this.linkStatuses,
      predStates: this.predStates,
      selectedNodeId: this.selectedNodeId,
    });
  }

  private recordSuperframeEpoch(durationS: number): void {
    const epochRecord = createSuperframeEpochRecord({
      tdmaSimTimeS: this.tdmaSimTimeS,
      durationS,
      simulationRunId: this.simulationRunId,
      epochIndex: this.superframeEpochIndex++,
      frameDt: FRAME_DT,
      configuredDurationMs: this.tdmaConfig.frameDurationMs,
      nominalSimTimeS: this.simTimeS,
      associatedSimulationFrameIndex: this.frameIndex,
      lastReportStatic: this.lastReportStatic,
      lastReportTac: this.lastReportTac,
      nodesStatic: this.nodesStatic,
      nodesTac: this.nodesTac,
      activeSchedulerMode: this.schedulerMode === 'static' ? 'static' : 'tac_tad',
    });
    this.pendingTimelineRecords.push(epochRecord);
    if (this.pendingTimelineRecords.length > 5000) {
      this.pendingTimelineRecords.splice(0, this.pendingTimelineRecords.length - 5000);
    }
    this.tdmaSimTimeS += durationS;
  }

  /** Recompute spatial decisions only; does not advance time or run traffic/schedulers. */
  private refreshObstructionState(acnPos: [number, number, number], timeS: number): void {
    const nextLinks = new Map<number, LinkStatus>();
    const nextPredictions = new Map<number, PredictiveState>();
    const nextObstructions = new Map<number, TerrainObstruction>();
    const nextShadow = new Map<number, boolean>();

    const numNodes = this.nodesTac.length;
    const interval = Math.max(1, this.lookaheadIntervalFrames);

    const rawVel = this.trajectoryEngine.getAcnVelocity(timeS);
    const acnVel: [number, number, number] = [rawVel[0], rawVel[1], this.liveVzMps];
    const dtStep = this.lastObstructionTimeS >= 0 ? timeS - this.lastObstructionTimeS : 0.0;
    const acnAccel: Position3D = dtStep > 1e-6
      ? [(acnVel[0] - this.prevAcnVel[0]) / dtStep, (acnVel[1] - this.prevAcnVel[1]) / dtStep, (acnVel[2] - this.prevAcnVel[2]) / dtStep]
      : [0, 0, 0];
    if (dtStep > 1e-6 || this.lastObstructionTimeS < 0) {
      this.prevAcnVel = acnVel;
      this.lastObstructionTimeS = timeS;
    }
    const acnAttitude = this.antennaEngine.computeAcnAttitude(acnVel, timeS, true);

    const horizSpeed = Math.hypot(acnVel[0], acnVel[1]);
    const bankRad = (acnAttitude.bankDeg * Math.PI) / 180.0;
    const yawRateRadS = horizSpeed > 1e-3 ? (9.80665 * Math.tan(bankRad)) / horizSpeed : 0.0;
    const uavAttitude = computeAirframeAttitude(acnVel[0], acnVel[1], acnVel[2], yawRateRadS, 45.0);
    const dubinsMinTurnRadiusM = computeMinTurnRadiusM(horizSpeed, 30.0);

    let sumShadowLossDb = 0.0;
    let maxShadowLossDb = 0.0;
    let sumCorrelatedFadingDb = 0.0;
    let latestCoherenceTimeMs = 0.0;
    let sumOllaOffsetDb = 0.0;
    let latestHarqGainDb = 0.0;
    let maxSlantRangeM = 1.0;
    let sumTwoRayGainDb = 0.0;
    let sumFoliageLossDb = 0.0;
    let sumDustLossDb = 0.0;
    let sumPolLossDb = 0.0;
    let biomeEvaluatedCount = 0;

    // GNSS Timing Spoofing Timing Advance (TA) Drift Evaluation
    let taDriftUs = 0.0;
    let effectiveTaResidualErrorM = 50.0;
    if (this.gnssSpoofingRateUsPerSec > 0.0) {
      if (dtStep > 1e-6) this.gnssSpoofElapsedSec += dtStep;
      taDriftUs = computeGnssSpoofingTaDriftUs(
        this.gnssSpoofElapsedSec,
        this.gnssSpoofingRateUsPerSec,
        2000.0,
        this.enableAntiSpoofHoldover
      );
      const taDriftRangeErrorM = (SPEED_OF_LIGHT_M_S * (taDriftUs * 1e-6)) / 2.0;
      effectiveTaResidualErrorM = 50.0 + taDriftRangeErrorM;
    } else {
      this.gnssSpoofElapsedSec = 0.0;
    }

    let sumProcessingGainDb = 0.0;
    let sumSpatialNullRejectionDb = 0.0;
    let sumEffectiveJammerDbm = 0.0;
    let sumRawJammerDbm = 0.0;
    let anyJammerSuppressed = false;
    let ewEvaluatedCount = 0;

    // Evaluate Contested EW Jammer Ingress & Terrain Shielding
    const jammerRes = computeJammerInterference({
      jammerEnabled: this.envConfig.jammerEnabled,
      jammerPosEnu: this.envConfig.jammerPosEnu,
      jammerEirpDbm: this.envConfig.jammerEirpDbm,
      acnPos,
      acnVel,
      acnAttitude,
      terrainEngine: this.terrainEngine,
      rfConfig: this.rfConfig,
      envConfig: this.envConfig,
      antennaEngine: this.antennaEngine,
    });
    this.jammerShieldLossDb = jammerRes.jammerShieldLossDb;
    this.jammerSectorInterferenceDbm = jammerRes.jammerSectorInterferenceDbm;
    const jammerInterferenceBySector = jammerRes.jammerInterferenceBySector;

    const acnGroundElevM = this.terrainEngine.getElevation(acnPos[0], acnPos[1]);
    const acnAltAglM = Math.max(1.5, acnPos[2] - (Number.isFinite(acnGroundElevM) ? acnGroundElevM : 0.0));

    // 1. Authoritative 50 Hz Physical Obstruction Evaluation for ALL nodes
    for (let i = 0; i < numNodes; i++) {
      const node = this.nodesTac[i];
      const nid = node.nodeId;
      const obstruction = this.terrainEngine.evaluateTerrainObstruction(node.position, acnPos, this.rfConfig, this.envConfig);
      const [nx, ny, nz] = node.position;
      const slantM = Math.hypot(acnPos[0] - nx, acnPos[1] - ny, acnPos[2] - nz);
      maxSlantRangeM = Math.max(maxSlantRangeM, slantM);
      const sectorEval = this.antennaEngine.evaluateNodeSector(
        nid,
        acnPos,
        acnVel,
        node.position,
        this.rfConfig.acnAntennaGainDbi,
        true,
        acnAttitude
      );

      const doppler = LinkBudgetEngine.computeDopplerKinematics(
        acnPos,
        acnVel,
        node.position,
        this.rfConfig.carrierFrequencyHz,
        acnAccel
      );

      const activeSectorId = sectorEval.activeSectorId;
      const rawNodeJammerInterferenceDbm = jammerInterferenceBySector !== undefined
        ? jammerInterferenceBySector[activeSectorId]
        : undefined;

      const nodeEw = computeNodeEwJammerMitigation({
        rawJammerDbm: rawNodeJammerInterferenceDbm,
        eccmMode: this.eccmMode,
        enableMvdrNullSteering: this.enableMvdrNullSteering,
        acnPos,
        jammerPosEnu: this.envConfig.jammerPosEnu,
        targetBearingDeg: sectorEval.worldBearingDeg,
        channelBandwidthHz: this.rfConfig.channelBandwidthHz || 1e6,
      });

      const nodeJammerInterferenceDbm = nodeEw.effectiveJammerDbm;
      if (rawNodeJammerInterferenceDbm !== undefined) {
        sumProcessingGainDb += nodeEw.eccmProcessingGainDb;
        sumSpatialNullRejectionDb += nodeEw.spatialNullRejectionDb;
        sumEffectiveJammerDbm += (nodeEw.effectiveJammerDbm ?? -150.0);
        sumRawJammerDbm += rawNodeJammerInterferenceDbm;
        if (nodeEw.jammerSuppressed) anyJammerSuppressed = true;
        ewEvaluatedCount++;
      }

      let ricianKFactorDb: number | undefined = undefined;
      let ricianFadingGainDb: number | undefined = undefined;
      const dynamicRicianKDb = Math.max(
        -2.0,
        Math.min(20.0, 4.0 + 13.5 * Math.sin((Math.max(Math.abs(sectorEval.elevationAngleDeg ?? 0.0), 2.0) * Math.PI) / 180.0) - 0.35 * Math.min(Math.max(obstruction.diffractionLossDb, 0.0), 25.0))
      );

      // Avoid double-applying fading when correlated Jakes Rician fading is active
      if (this.envConfig.ricianFadingEnabled && !this.enableCorrelatedRicianFading) {
        const fading = LinkBudgetEngine.computeRicianMultipathFading(
          node.nodeId,
          this.simTimeS,
          sectorEval.elevationAngleDeg ?? 0.0,
          obstruction.diffractionLossDb,
          doppler.dopplerShiftHz
        );
        ricianKFactorDb = fading.ricianKFactorDb;
        ricianFadingGainDb = fading.fadingGainDb;
      }

      // Closed-Loop Pillar 4: AI LPI/LPD Stealth RF Power Throttling (preserves custom user TX power when off)
      let customTxPowerDbm = node.txPowerDbm;
      if (this.aiLpiStealthEnabled) {
        if (!this.lpiSavedTxPowerByNode.has(nid)) this.lpiSavedTxPowerByNode.set(nid, node.txPowerDbm);
        const nominalTxPowerDbm = this.lpiSavedTxPowerByNode.get(nid) ?? (node.nodeType === 'mcp' ? (this.rfConfig.mcpTxPowerDbm ?? 40.0) : (this.rfConfig.soldierTxPowerDbm ?? 36.0));
        const lpiResult = computeAiLpiStealthPower(nominalTxPowerDbm, this.linkStatuses.get(nid)?.snrDb ?? 20.0, !obstruction.isLos || (obstruction.obstacleBlocked ?? false), 18.5);
        this.aiLpiStealthResults.set(nid, lpiResult);
        customTxPowerDbm = lpiResult.lpiTxPowerDbm;
        node.txPowerDbm = customTxPowerDbm;
      } else if (this.lpiSavedTxPowerByNode.has(nid)) {
        const restored = this.lpiSavedTxPowerByNode.get(nid);
        this.lpiSavedTxPowerByNode.delete(nid);
        node.txPowerDbm = restored;
        customTxPowerDbm = restored;
      }

      let ollaMarginDb: number | undefined = undefined;
      let cqiDecodeFailure: boolean | undefined = undefined;

      if (this.enableMacPhyFeedback) {
        let cqiHist = this.cqiHistoryByNode.get(nid);
        if (!cqiHist) {
          cqiHist = [];
          this.cqiHistoryByNode.set(nid, cqiHist);
        }
        cqiHist.push(this.linkStatuses.get(nid)?.snrDb ?? 18.0);
        if (cqiHist.length > 50) cqiHist.shift();

        const currentOlla = this.ollaOffsetByNode.get(nid) ?? 0.0;
        sumOllaOffsetDb += currentOlla;
        ollaMarginDb = currentOlla;
        cqiDecodeFailure = this.cqiDecodeFailureByNode.get(nid);

        if (!this.harqSlotByNode.has(nid)) {
          this.harqSlotByNode.set(nid, createHarqProcessSlot(nid));
        }
      }

      let airframeOptions: AirframeChannelOptions | undefined = undefined;
      if (this.enableAirframeShadowing || this.enableCorrelatedRicianFading) {
        airframeOptions = {
          uavAttitude: {
            yawDeg: uavAttitude.yawDeg,
            pitchDeg: uavAttitude.pitchDeg,
            rollDeg: uavAttitude.rollDeg,
          },
          antennaMount: 'belly',
          enableAirframeShadowing: this.enableAirframeShadowing,
          losVectorEnu: [nx - acnPos[0], ny - acnPos[1], nz - acnPos[2]],
          correlatedFadingParams: this.enableCorrelatedRicianFading ? {
            simTimeS: this.simTimeS,
            seed: nid * 1000 + 42,
            carrierFreqHz: this.rfConfig.carrierFrequencyHz,
            radialVelocityMs: doppler.radialVelocityMs,
            relativeSpeedMps: horizSpeed,
            ricianKFactorDb: dynamicRicianKDb,
          } : undefined,
        };
      }

      if (this.enableBiomeEmPhysics) {
        airframeOptions = {
          ...airframeOptions,
          biomeEmParams: {
            enableBiomeEmPhysics: true,
            biomeId: this.biomeId,
            txAltAglM: acnAltAglM,
            rxAltAglM: node.aglM ?? 2.0,
            polarization: this.polarizationMode,
            relativeBankDeg: uavAttitude.rollDeg ?? 0.0,
            dustVisibilityKm: this.dustVisibilityKm,
            foliageDepthM: this.foliageDepthM,
            weatherCells: this.weatherCells,
            simTimeSec: this.simTimeS,
          },
        };
      }

      const ls = this.linkEngine.evaluateLink({
        nodeType: node.nodeType, slantRangeM: slantM, diffractionLossDb: obstruction.diffractionLossDb,
        rf: this.rfConfig, env: this.envConfig, obstacleBlocked: obstruction.obstacleBlocked,
        customTxPowerDbm, sectorEval, nodeAltM: nz, acnAltM: acnPos[2],
        crestRadiusM: obstruction.crestRadiusM, curvatureLossDb: obstruction.curvatureLossDb,
        jammerInterferenceDbm: nodeJammerInterferenceDbm, radialVelocityMs: doppler.radialVelocityMs,
        dopplerShiftHz: doppler.dopplerShiftHz, dopplerRateHzS: doppler.dopplerRateHzS,
        fadingGainDb: ricianFadingGainDb, ricianKFactorDb, ollaMarginDb, cqiDecodeFailure,
        airframeOptions, txX: nx, txY: ny, rxX: acnPos[0], rxY: acnPos[1],
        biomeId: this.biomeId, txAltAglM: acnAltAglM, rxAltAglM: node.aglM ?? 2.0,
      });

      if (ls.airframeShadowLossDb !== undefined) {
        sumShadowLossDb += ls.airframeShadowLossDb;
        maxShadowLossDb = Math.max(maxShadowLossDb, ls.airframeShadowLossDb);
      }
      if (ls.correlatedFadingDb !== undefined) {
        sumCorrelatedFadingDb += ls.correlatedFadingDb;
      }
      if (ls.coherenceTimeMs !== undefined && Number.isFinite(ls.coherenceTimeMs)) {
        latestCoherenceTimeMs = ls.coherenceTimeMs;
      }
      if (ls.twoRayDeltaDb !== undefined) {
        sumTwoRayGainDb += ls.twoRayDeltaDb;
      }
      if (ls.vegetationLossDb !== undefined) {
        sumFoliageLossDb += ls.vegetationLossDb;
      }
      if (ls.dustStormLossDb !== undefined) {
        sumDustLossDb += ls.dustStormLossDb;
      }
      if (ls.polarizationLossDb !== undefined) {
        sumPolLossDb += ls.polarizationLossDb;
      }
      if (this.enableBiomeEmPhysics) {
        biomeEvaluatedCount++;
      }

      if (this.enableMacPhyFeedback) {
        const cqiLagFrames = computeCqiLagFrames(slantM, this.tdmaConfig.frameDurationMs, 4.0);
        const cqiHist = this.cqiHistoryByNode.get(nid);
        const delayedIdx = Math.max(0, (cqiHist?.length ?? 1) - 1 - cqiLagFrames);
        const reportedCqi = cqiHist?.[delayedIdx] ?? ls.snrDb;
        let currentOlla = this.ollaOffsetByNode.get(nid) ?? 0.0;

        const amcRes = evaluateDelayedCqiAmc({
          reportedSnrDb: reportedCqi,
          actualSnrDb: ls.snrDb,
          ollaOffsetDb: currentOlla,
        });

        const isAck = amcRes.bler < 0.5 && !amcRes.isLinkOutage;
        currentOlla = stepOllaOffsetDb(currentOlla, isAck, 0.1, 0.25, 0.0, 10.0);
        this.ollaOffsetByNode.set(nid, currentOlla);

        let harqActiveRetx = false;
        const harqSlot = this.harqSlotByNode.get(nid);
        if (harqSlot) {
          const harqRes = stepHarqProcess(harqSlot, {
            currentTimeMs: this.simTimeS * 1000.0,
            slantRangeM: slantM,
            actualSnrDb: ls.snrDb,
            requiredSnrDb: amcRes.selectedModcod?.minSnrDb ?? 5.0,
            combiningMode: 'chase',
            maxRetransmissions: 4,
            seed: nid * 1000 + this.frameIndex,
          });
          this.harqSlotByNode.set(nid, harqRes.nextSlot);
          if (harqRes.event === 'NACK_RETRY_SCHEDULED') {
            this.harqRetxTotal++;
            harqActiveRetx = true;
          } else if (harqRes.event === 'TX_PENDING_RTT') {
            harqActiveRetx = true;
          }
          const harqGain = Math.max(0.0, harqRes.combinedSnrDb - ls.snrDb);
          latestHarqGainDb = Math.max(latestHarqGainDb, harqGain);
        }

        const slotsPerFrame = this.tdmaConfig.fixedSlotCount ?? 16;
        const uplinkMs = Math.max(1.0, this.tdmaConfig.frameDurationMs - this.tdmaConfig.ctrlDurationMs - this.tdmaConfig.dlMinDurationMs);
        const slotDurationMs = uplinkMs / slotsPerFrame;
        const guardRes = computeDynamicTdmaOverhead({
          slotDurationMs,
          slotsPerFrame,
          slantRangeM: slantM,
          timingAdvanceActive: true,
          taResidualErrorM: effectiveTaResidualErrorM,
        });

        const closedLoopScale = computeClosedLoopEffectiveCapacityScale({
          dynamicGuardEfficiency: guardRes.frameDataEfficiency,
          slotCollisionOutage: guardRes.slotCollisionOutage,
          delayedCqiBler: amcRes.bler,
          harqActiveRetx,
          harqCombinedSnrMarginDb: amcRes.snrMarginDb,
        });
        this.closedLoopCapacityScaleByNode.set(nid, closedLoopScale);
        this.guardScaleByNode.set(nid, guardRes.frameDataEfficiency);
        this.delayedCqiSnrByNode.set(nid, reportedCqi);
        this.cqiDecodeFailureByNode.set(nid, !isAck && !amcRes.isLinkOutage);
      }

      nextObstructions.set(nid, obstruction);
      nextLinks.set(nid, ls);
      // Traffic-generation shadow is current geometry or link outage
      nextShadow.set(nid, !obstruction.isLos || obstruction.obstacleBlocked || ls.isOutage);
    }

    if (!this.enableMacPhyFeedback) {
      this.closedLoopCapacityScaleByNode.clear();
      this.guardScaleByNode.clear();
      this.delayedCqiSnrByNode.clear();
      this.cqiDecodeFailureByNode.clear();
    }

    let dynamicGuardEfficiency = 1.0;
    if (this.enableMacPhyFeedback) {
      const slotsPerFrame = this.tdmaConfig.fixedSlotCount ?? 16;
      const uplinkMs = Math.max(1.0, this.tdmaConfig.frameDurationMs - this.tdmaConfig.ctrlDurationMs - this.tdmaConfig.dlMinDurationMs);
      const slotDurationMs = uplinkMs / slotsPerFrame;
      const guardRes = computeDynamicTdmaOverhead({
        slotDurationMs,
        slotsPerFrame,
        slantRangeM: maxSlantRangeM,
        timingAdvanceActive: true,
        taResidualErrorM: effectiveTaResidualErrorM,
      });
      dynamicGuardEfficiency = guardRes.frameDataEfficiency;
    }

    const cqiLagFrames = this.enableMacPhyFeedback
      ? computeCqiLagFrames(maxSlantRangeM, this.tdmaConfig.frameDurationMs, 4.0)
      : 0;

    this.hifiTelemetry = buildHiFiPhysicsTelemetry({
      enableAirframeShadowing: this.enableAirframeShadowing,
      enableCorrelatedRicianFading: this.enableCorrelatedRicianFading,
      enableMacPhyFeedback: this.enableMacPhyFeedback,
      enableDubinsKinematics: this.enableDubinsKinematics,
      viewshedFidelityMode: this.viewshedFidelityMode,
      uavAttitude,
      numNodes,
      sumShadowLossDb,
      maxShadowLossDb,
      sumCorrelatedFadingDb,
      latestCoherenceTimeMs,
      cqiLagFrames,
      sumOllaOffsetDb,
      harqRetxTotal: this.harqRetxTotal,
      latestHarqGainDb,
      dynamicGuardEfficiency,
      dubinsMinTurnRadiusM,
    });

    this.liveMaxSlantRangeM = maxSlantRangeM;
    this.liveMeanProcessingGainDb = ewEvaluatedCount > 0 ? sumProcessingGainDb / ewEvaluatedCount : 0.0;
    this.liveMeanSpatialNullRejectionDb = ewEvaluatedCount > 0 ? sumSpatialNullRejectionDb / ewEvaluatedCount : 0.0;
    this.liveMeanEffectiveJammerPowerDbm = ewEvaluatedCount > 0 ? sumEffectiveJammerDbm / ewEvaluatedCount : -150.0;
    this.liveRawJammerPowerDbm = ewEvaluatedCount > 0 ? sumRawJammerDbm / ewEvaluatedCount : -150.0;
    this.liveJammerSuppressed = anyJammerSuppressed;

    // 1a. Active Two-Hop Decode-and-Forward (DF) Tactical Mesh Relay Evaluation
    let relayedNodeCount = 0;
    let relayBackhaulSectorId: 0 | 1 | 2 | 3 | undefined = undefined;
    let relayBackhaulSnrDb: number | undefined = undefined;

    if (this.envConfig.activeRelayEnabled && this.relayAdvisorReport && this.relayAdvisorReport.optimalPosEnu) {
      const relayPos = this.relayAdvisorReport.optimalPosEnu;
      const dHop2M = Math.max(1.0, Math.hypot(acnPos[0] - relayPos[0], acnPos[1] - relayPos[1], acnPos[2] - relayPos[2]));
      const hop2Obs = this.terrainEngine.evaluateTerrainObstruction(relayPos, acnPos, this.rfConfig, this.envConfig);
      const hop2SectorEval = this.antennaEngine.evaluateNodeSector(
        -888,
        acnPos,
        acnVel,
        relayPos,
        this.rfConfig.acnAntennaGainDbi,
        false,
        acnAttitude
      );
      const hop2Doppler = LinkBudgetEngine.computeDopplerKinematics(
        acnPos,
        acnVel,
        relayPos,
        this.rfConfig.carrierFrequencyHz,
        acnAccel
      );
      const rawHop2JammerInterferenceDbm = this.envConfig.jammerEnabled && jammerInterferenceBySector !== undefined
        ? jammerInterferenceBySector[hop2SectorEval.activeSectorId]
        : undefined;

      const hop2Ew = computeNodeEwJammerMitigation({
        rawJammerDbm: rawHop2JammerInterferenceDbm,
        eccmMode: this.eccmMode,
        enableMvdrNullSteering: this.enableMvdrNullSteering,
        acnPos,
        jammerPosEnu: this.envConfig.jammerPosEnu,
        targetBearingDeg: hop2SectorEval.worldBearingDeg,
        channelBandwidthHz: this.rfConfig.channelBandwidthHz || 1e6,
      });
      const hop2JammerInterferenceDbm = hop2Ew.effectiveJammerDbm;

      const hop2Link = this.linkEngine.evaluateLink({
        nodeType: 'mcp', slantRangeM: dHop2M, diffractionLossDb: hop2Obs.diffractionLossDb,
        rf: this.rfConfig, env: this.envConfig, obstacleBlocked: hop2Obs.obstacleBlocked,
        customTxPowerDbm: this.rfConfig.mcpTxPowerDbm, sectorEval: hop2SectorEval,
        nodeAltM: relayPos[2], acnAltM: acnPos[2], crestRadiusM: hop2Obs.crestRadiusM,
        curvatureLossDb: hop2Obs.curvatureLossDb, jammerInterferenceDbm: hop2JammerInterferenceDbm,
        radialVelocityMs: hop2Doppler.radialVelocityMs, dopplerShiftHz: hop2Doppler.dopplerShiftHz,
        dopplerRateHzS: hop2Doppler.dopplerRateHzS, txX: relayPos[0], txY: relayPos[1],
        rxX: acnPos[0], rxY: acnPos[1], biomeId: this.biomeId, txAltAglM: acnAltAglM, rxAltAglM: 3.0,
      });

      relayBackhaulSectorId = hop2SectorEval.activeSectorId;
      relayBackhaulSnrDb = hop2Link.snrDb;

      for (let i = 0; i < numNodes; i++) {
        const node = this.nodesTac[i];
        const nid = node.nodeId;
        const directLink = nextLinks.get(nid)!;

        if (directLink.isOutage || directLink.bitrateMbps < 5.0) {
          let hop1Obs = this.relayHop1ObstructionCache.get(nid);
          if (!hop1Obs) {
            hop1Obs = this.terrainEngine.evaluateTerrainObstruction(
              node.position,
              relayPos,
              this.rfConfig,
              this.envConfig
            );
            this.relayHop1ObstructionCache.set(nid, hop1Obs);
          }

          const dHop1M = Math.max(1.0, Math.hypot(
            relayPos[0] - node.position[0],
            relayPos[1] - node.position[1],
            relayPos[2] - node.position[2]
          ));

          const hop1Link = this.linkEngine.evaluateLink({
            nodeType: node.nodeType, slantRangeM: dHop1M, diffractionLossDb: hop1Obs.diffractionLossDb,
            rf: this.rfConfig, env: this.envConfig, obstacleBlocked: hop1Obs.obstacleBlocked,
            customTxPowerDbm: node.txPowerDbm, nodeAltM: node.position[2], acnAltM: relayPos[2],
            crestRadiusM: hop1Obs.crestRadiusM, curvatureLossDb: hop1Obs.curvatureLossDb,
            customRxGainDbi: this.envConfig.relayAntennaGainDbi, txX: node.position[0], txY: node.position[1],
            rxX: relayPos[0], rxY: relayPos[1], biomeId: this.biomeId, txAltAglM: 3.0, rxAltAglM: node.aglM ?? 2.0,
          });

          const relayedLink = LinkBudgetEngine.computeDecodeAndForwardRelayLink(
            directLink,
            hop1Link,
            hop2Link,
            dHop1M,
            dHop2M,
            this.rfConfig.speedOfLight
          );

          if (relayedLink.isRelayed) {
            nextLinks.set(nid, relayedLink);
            nextShadow.set(nid, false);
            relayedNodeCount++;
          }
        }
      }
    }

    this.relayedNodeCount = relayedNodeCount;
    this.relayBackhaulSectorId = relayBackhaulSectorId;
    this.relayBackhaulSnrDb = relayBackhaulSnrDb;

    this.liveMeanTwoRayGainDb = biomeEvaluatedCount > 0 ? sumTwoRayGainDb / biomeEvaluatedCount : 0.0;
    this.liveMeanFoliageLossDb = biomeEvaluatedCount > 0 ? sumFoliageLossDb / biomeEvaluatedCount : 0.0;
    this.liveMeanDustLossDb = biomeEvaluatedCount > 0 ? sumDustLossDb / biomeEvaluatedCount : 0.0;
    this.liveMeanPolLossDb = biomeEvaluatedCount > 0 ? sumPolLossDb / biomeEvaluatedCount : 0.0;

    // 1a-2. Closed-Loop Pillar 1: AI Buddy-Relay Squad Mesh Delivery
    if (this.aiBuddyMeshEnabled) {
      const squadForBuddy: SquadNodeForBuddyEval[] = this.nodesTac.map(oNode => {
        const oLs = nextLinks.get(oNode.nodeId);
        return {
          nodeId: oNode.nodeId,
          position: oNode.position,
          nodeType: oNode.nodeType,
          isOutage: oLs?.isOutage ?? true,
          directBitrateMbps: oLs?.bitrateMbps ?? 0.0,
          directSinrDb: oLs?.snrDb ?? -99.0,
        };
      });

      for (let i = 0; i < numNodes; i++) {
        const node = this.nodesTac[i];
        const nid = node.nodeId;
        const curLs = nextLinks.get(nid);
        if (curLs && (curLs.isOutage || curLs.bitrateMbps < 1.0)) {
          const buddyRes = evaluateAiBuddyRelayRescue(
            {
              nodeId: nid,
              position: node.position,
              isOutage: true,
              directBitrateMbps: curLs.bitrateMbps ?? 0.0,
              directSinrDb: curLs.snrDb ?? -99.0,
            },
            squadForBuddy,
            (x, y) => this.terrainEngine.getElevation(x, y),
            this.rfConfig.carrierFrequencyHz,
            this.rfConfig.channelBandwidthHz
          );
          this.aiBuddyRelayResults.set(nid, buddyRes);

          if (buddyRes.buddyNodeId !== null && buddyRes.buddyBitrateMbps > 0 && buddyRes.harmonicRateMbps > 0) {
            const buddyNodeLink = nextLinks.get(buddyRes.buddyNodeId);
            const harmonicRate = buddyRes.harmonicRateMbps;
            const buddyRelayedLink: LinkStatus = {
              ...curLs,
              isOutage: false,
              isRelayed: true,
              bitrateMbps: harmonicRate,
              bitrateBps: harmonicRate * 1e6,
              snrDb: buddyRes.buddySinrDb,
              modcodName: `BUDDY:S${buddyRes.buddyNodeId}`,
              activeSectorId: buddyNodeLink?.activeSectorId ?? curLs.activeSectorId,
            };
            nextLinks.set(nid, buddyRelayedLink);
            nextShadow.set(nid, false);
          }
        }
      }
    }

    // 1b. Real-Time Polar X-Band SINR Viewshed Slice Sweep (Amortized 6 Azimuths per 20 ms tick)
    if (this.viewshedEnabled) {
      this.viewshedEngine.updateSlice(
        acnPos,
        acnVel,
        this.terrainEngine,
        this.rfConfig,
        this.envConfig,
        6,
        acnAttitude,
        jammerInterferenceBySector,
        this.viewshedFidelityMode
      );
    }

    // 2. Predictive Lookahead Evaluation (Decoupled with Interleaved Round-Robin & Bounded Emergency Budget)
    if (interval <= 1) {
      // 50 Hz Reference Mode: Evaluate all nodes unconditionally
      for (let i = 0; i < numNodes; i++) {
        const node = this.nodesTac[i];
        const nid = node.nodeId;
        const obstruction = nextObstructions.get(nid)!;
        const prediction = this.lookaheadEngine.evaluatePredictiveState(node.position, timeS, obstruction, nid, this.antennaEngine, nextLinks.get(nid));
        nextPredictions.set(nid, prediction);
        this.lookaheadEngine.storeCachedEntry(nid, {
          nodeId: nid,
          evaluatedSimTimeS: timeS,
          evaluatedFrameIndex: this.frameIndex,
          nodePosition: node.position,
          rawPrediction: prediction,
          spatialRevision: this.spatialRevision,
        });
      }
      this.deferredEmergencyQueue.clear();
    } else {
      // 10 Hz Decoupled Interleaved Mode
      const currentPhase = this.frameIndex % interval;
      const normalQuota = Math.ceil(numNodes / interval);
      const emergencyQuota = normalQuota; // Strictly bounded emergency allowance per frame
      let emergencyCount = 0;

      const scheduledNodes: GroundNodeTrafficSubsystem[] = [];
      const emergencyNodes: GroundNodeTrafficSubsystem[] = [];
      const cacheReconcileNodes: GroundNodeTrafficSubsystem[] = [];

      for (let i = 0; i < numNodes; i++) {
        const node = this.nodesTac[i];
        const nid = node.nodeId;
        const cached = this.lookaheadEngine.getCachedEntry(nid);
        const obstruction = nextObstructions.get(nid)!;
        const isPhysicallyBlocked = !obstruction.isLos || obstruction.obstacleBlocked;

        const isScheduled = PredictiveLookAheadEngine.getNodeLookaheadPhase(nid, interval) === currentPhase;
        const hasValidCache =
          cached !== undefined &&
          cached.spatialRevision === this.spatialRevision &&
          Math.hypot(
            cached.nodePosition[0] - node.position[0],
            cached.nodePosition[1] - node.position[1],
            cached.nodePosition[2] - node.position[2]
          ) < 1e-3;

        // Discrepancy check: unexpected transition where cached prediction contradicts current physical observation
        const isDiscrepancy =
          !hasValidCache ||
          this.deferredEmergencyQueue.has(nid) ||
          (hasValidCache && isPhysicallyBlocked && cached.rawPrediction.currentState === NodeTerrainState.NORMAL_LOS && cached.rawPrediction.timeToOcclusionS > 1.0);

        if (isScheduled) {
          scheduledNodes.push(node);
        } else if (isDiscrepancy) {
          emergencyNodes.push(node);
        } else {
          cacheReconcileNodes.push(node);
        }
      }

      const nodesToCompute: Set<number> = new Set();

      // Grant scheduled lookaheads up to normalQuota
      for (const node of scheduledNodes) {
        if (nodesToCompute.size < normalQuota) {
          nodesToCompute.add(node.nodeId);
          this.deferredEmergencyQueue.delete(node.nodeId);
        } else {
          cacheReconcileNodes.push(node);
        }
      }

      // Grant emergency lookaheads within bounded emergencyQuota
      for (const node of emergencyNodes) {
        if (emergencyCount < emergencyQuota) {
          nodesToCompute.add(node.nodeId);
          emergencyCount++;
          this.deferredEmergencyQueue.delete(node.nodeId);
        } else {
          // Defer excess emergencies to subsequent frames
          this.deferredEmergencyQueue.add(node.nodeId);
          cacheReconcileNodes.push(node);
        }
      }

      // Execute full 30-step lookahead for budgeted nodes
      for (let i = 0; i < numNodes; i++) {
        const node = this.nodesTac[i];
        const nid = node.nodeId;
        const obstruction = nextObstructions.get(nid)!;

        if (nodesToCompute.has(nid)) {
          const prediction = this.lookaheadEngine.evaluatePredictiveState(node.position, timeS, obstruction, nid, this.antennaEngine, nextLinks.get(nid));
          nextPredictions.set(nid, prediction);
          this.lookaheadEngine.storeCachedEntry(nid, {
            nodeId: nid,
            evaluatedSimTimeS: timeS,
            evaluatedFrameIndex: this.frameIndex,
            nodePosition: node.position,
            rawPrediction: prediction,
            spatialRevision: this.spatialRevision,
          });
        } else {
          // Intervening / deferred frame: Reconcile with authoritative 50 Hz physical observation
          const cached = this.lookaheadEngine.getCachedEntry(nid);
          if (cached) {
            const dtElapsed = Math.max(0.0, timeS - cached.evaluatedSimTimeS);
            const reconciled = this.lookaheadEngine.reconcilePredictiveState(
              cached.rawPrediction,
              dtElapsed,
              obstruction,
              nextLinks.get(nid)
            );
            nextPredictions.set(nid, reconciled);
          } else {
            // Unbudgeted cold or invalidated node: use instantaneous 50 Hz physical observation
            // to generate a safe default prediction without running an expensive 30-step raycast.
            // Node is deferred to upcoming frames within the strict per-frame budget.
            const isPhysicallyBlocked = !obstruction.isLos || (obstruction.obstacleBlocked ?? false);
            const curLs = nextLinks.get(nid);
            const isWorkingLink = Boolean(curLs && !curLs.isOutage && curLs.bitrateBps > 0 && !curLs.obstacleBlocked);
            const isHardShadow = isWorkingLink ? false : isPhysicallyBlocked;
            const fallbackPrediction: PredictiveState = {
              currentState: isPhysicallyBlocked ? NodeTerrainState.HARD_SHADOW_CUTOFF : NodeTerrainState.NORMAL_LOS,
              timeToOcclusionS: Number.POSITIVE_INFINITY,
              timeToEmergenceS: Number.POSITIVE_INFINITY,
              fresnelClearanceM: obstruction.minClearanceM,
              fresnelRateOfChangeMps: 0.0,
              predictedOutageDurationS: 0.0,
              obstacleBlocked: obstruction.obstacleBlocked ?? false,
              isHardShadow,
            };
            nextPredictions.set(nid, fallbackPrediction);
            this.deferredEmergencyQueue.add(nid);
          }
        }
      }
    }
    // Publish staged results together so no caller can observe a partial node refresh.
    this.linkStatuses.clear();
    this.linkStatusesStatic.clear();
    this.linkStatusesReactive.clear();
    this.linkStatusesTac.clear();

    const isRician = this.envConfig.ricianFadingEnabled;
    const delayMs = this.envConfig.cqiFeedbackDelayMs;
    const delaySteps = Math.min(3, Math.max(0, Math.round(delayMs / 20)));

    for (const [nid, ls] of nextLinks) {
      this.linkStatuses.set(nid, ls);

      if (!isRician || delayMs <= 0) {
        if (isRician) {
          (ls as any).ollaMarginDb = 0.0;
        }
        this.linkStatusesStatic.set(nid, ls);
        this.linkStatusesReactive.set(nid, ls);
        this.linkStatusesTac.set(nid, ls);
        continue;
      }

      // Update 4-frame SINR circular history
      const currentSinr = ls.sinrDb ?? ls.snrDb;
      let hist = this.nodeSinrHistory.get(nid);
      if (!hist) {
        hist = new Float64Array(4);
        hist.fill(currentSinr);
        this.nodeSinrHistory.set(nid, hist);
      } else {
        hist[3] = hist[2];
        hist[2] = hist[1];
        hist[1] = hist[0];
        hist[0] = currentSinr;
      }

      const delayedSinr = hist[delaySteps];

      const { lsBaseline, lsTac, ollaMarginDb } = evaluateAcmCqiAgingAndOlla(
        ls,
        currentSinr,
        delayedSinr,
        delayMs,
        this.rfConfig.channelBandwidthHz
      );
      this.linkStatusesStatic.set(nid, lsBaseline);
      this.linkStatusesReactive.set(nid, lsBaseline);
      this.linkStatusesTac.set(nid, lsTac);
      (ls as any).ollaMarginDb = ollaMarginDb;
    }
    this.predStates.clear(); for (const [id, value] of nextPredictions) this.predStates.set(id, value);
    this.obstructionResults.clear(); for (const [id, value] of nextObstructions) this.obstructionResults.set(id, value);
    for (let i = 0; i < this.nodesTac.length; i++) {
      const nid = this.nodesTac[i].nodeId;
      const isShad = nextShadow.get(nid) ?? false;
      this.nodesTac[i].isShadowed = isShad;
      this.nodesStatic[i].isShadowed = isShad;
      if (this.nodesReactive[i]) this.nodesReactive[i].isShadowed = isShad;
    }
  }

  private getObstructionStateSnapshot(): NonNullable<WorkerCommandResult['obstruction_state']> {
    return buildObstructionStateSnapshot(
      this.nodesTac,
      this.obstructionResults,
      this.linkStatuses,
      this.predStates
    );
  }


  public ensureNodeDomainEvaluations(node: GroundNodeTrafficSubsystem, acnPos: [number, number, number]): {
    obstruction: TerrainObstruction;
    linkStatus: LinkStatus;
    predState: PredictiveState;
  } {
    if (!this.obstructionResults.has(node.nodeId) || !this.linkStatuses.has(node.nodeId) || !this.predStates.has(node.nodeId)) {
      this.refreshObstructionState(acnPos, this.simTimeS);
    }
    const obstruction = this.obstructionResults.get(node.nodeId) ?? this.terrainEngine.evaluateTerrainObstruction(node.position, acnPos, this.rfConfig, this.envConfig);
    const linkStatus = this.linkStatuses.get(node.nodeId) ?? this.linkEngine.evaluateLink({
      nodeType: node.nodeType,
      slantRangeM: Math.hypot(acnPos[0] - node.position[0], acnPos[1] - node.position[1], acnPos[2] - node.position[2]),
      diffractionLossDb: obstruction.diffractionLossDb, rf: this.rfConfig, env: this.envConfig,
      obstacleBlocked: obstruction.obstacleBlocked, customTxPowerDbm: node.txPowerDbm,
      nodeAltM: node.position[2], acnAltM: acnPos[2], txX: node.position[0], txY: node.position[1],
      rxX: acnPos[0], rxY: acnPos[1], biomeId: this.biomeId, rxAltAglM: node.aglM ?? 2.0,
    });
    const predState = this.predStates.get(node.nodeId) ?? this.lookaheadEngine.evaluatePredictiveState(node.position, this.simTimeS, obstruction, node.nodeId, this.antennaEngine, linkStatus);
    return { obstruction, linkStatus, predState };
  }

  public ensureActiveNodesDomainEvaluations(acnPos: [number, number, number]): void {
    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;
    for (const node of activeNodes) {
      this.ensureNodeDomainEvaluations(node, acnPos);
    }
  }

  public buildNodesTelemetry(): NodeTelemetryItem[] {
    const acnPos = this.getLiveAcnPosition();
    this.ensureActiveNodesDomainEvaluations(acnPos);
    return this.telemetrySerializer.buildNodesTelemetry(this, acnPos);
  }

  private stepTransportAbrLoop(): void {
    if (!this.enableTransportAbr) return;

    for (let i = 0; i < this.nodesTac.length; i++) {
      const node = this.nodesTac[i];
      const nid = node.nodeId;
      const ls = this.linkStatuses.get(nid);

      const aimdState = this.aimdStateByNode.get(nid) ?? createInitialAimdState(4, 32);
      const abrState = this.abrStateByNode.get(nid) ?? createInitialAbrState(2);

      const isOutage = Boolean(ls?.isOutage || node.isShadowed || (ls && ls.bitrateBps <= 0));
      const snrDb = isOutage ? -100.0 : (ls?.snrDb ?? 18.0);

      let effectiveBler = 0.0;
      if (isOutage) {
        effectiveBler = 1.0;
      } else if (this.enableMacPhyFeedback) {
        const cqiLag = computeCqiLagFrames(ls?.slantRangeM ?? 0, this.tdmaConfig.frameDurationMs, 4.0);
        const cqiHist = this.cqiHistoryByNode.get(nid);
        const delayedIdx = Math.max(0, (cqiHist?.length ?? 1) - 1 - cqiLag);
        const reportedCqi = cqiHist?.[delayedIdx] ?? (ls?.snrDb ?? 18.0);
        const currentOlla = this.ollaOffsetByNode.get(nid) ?? 0.0;
        const amc = evaluateDelayedCqiAmc({
          reportedSnrDb: reportedCqi,
          actualSnrDb: ls?.snrDb ?? 18.0,
          ollaOffsetDb: currentOlla,
        });
        effectiveBler = amc.bler;
      }

      const videoBytes = node.queue.getClassBacklogBytes(67);
      const maxVideoBytes = Math.max(1, node.queue.maxBufferPackets * 1200);
      const queueFillRatio = Math.max(0.0, Math.min(1.0, videoBytes / maxVideoBytes));

      const stepRes = evaluateNodeTransportAbr({
        aimdState,
        abrState,
        isOutage,
        snrDb,
        effectiveBler,
        queueFillRatio,
        slantRangeM: ls?.slantRangeM ?? 0,
        speedOfLight: SPEED_OF_LIGHT,
      });

      this.aimdStateByNode.set(nid, stepRes.nextAimd);
      this.abrStateByNode.set(nid, stepRes.nextAbr);
      if (stepRes.abrAction === 'down') {
        this.abrStepDownsTotal++;
      } else if (stepRes.abrAction === 'up') {
        this.abrStepUpsTotal++;
      }
    }
  }

  private buildTransportAbrTelemetry(): TransportAbrTelemetry {
    return computeTransportAbrTelemetry({
      enabled: this.enableTransportAbr, nodeIds: this.nodesTac.map(n => n.nodeId),
      aimdStateByNode: this.aimdStateByNode, abrStateByNode: this.abrStateByNode,
      closedLoopCapacityScaleByNode: this.closedLoopCapacityScaleByNode, selectedNodeId: this.selectedNodeId,
      abrStepDownsTotal: this.abrStepDownsTotal, abrStepUpsTotal: this.abrStepUpsTotal,
    });
  }

  private buildEwEccmTelemetry(): EwEccmTelemetry {
    const selNode = this.nodesTac.find((n) => n.nodeId === this.selectedNodeId) ?? this.nodesTac[0];
    const ewTelem = evaluateLiveEwEccmTelemetry({
      eccmMode: this.eccmMode, enableMvdrNullSteering: this.enableMvdrNullSteering,
      enableAdversaryEsmModel: this.enableAdversaryEsmModel, gnssSpoofingRateUsPerSec: this.gnssSpoofingRateUsPerSec,
      enableAntiSpoofHoldover: this.enableAntiSpoofHoldover, gnssSpoofElapsedSec: this.gnssSpoofElapsedSec,
      tdmaConfig: this.tdmaConfig, carrierFrequencyHz: this.rfConfig.carrierFrequencyHz,
      jammerShieldLossDb: this.jammerShieldLossDb, liveMeanProcessingGainDb: this.liveMeanProcessingGainDb,
      liveMeanSpatialNullRejectionDb: this.liveMeanSpatialNullRejectionDb, liveMeanEffectiveJammerPowerDbm: this.liveMeanEffectiveJammerPowerDbm,
      liveRawJammerPowerDbm: this.liveRawJammerPowerDbm, liveJammerSuppressed: this.liveJammerSuppressed,
      liveMaxSlantRangeM: this.liveMaxSlantRangeM, selectedNodeTxPowerDbm: selNode?.txPowerDbm ?? 36.0,
    });
    this.ewEccmTelemetry = ewTelem;
    return ewTelem;
  }

  private buildConstellationMobilityTelemetry(acnPos: [number, number, number]): ConstellationMobilityTelemetry {
    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;
    const nodePositions = new Map<number, [number, number, number]>();
    const nodeDirectSnrMap = new Map<number, number>();
    for (let i = 0; i < activeNodes.length; i++) {
      const n = activeNodes[i];
      nodePositions.set(n.nodeId, [n.position[0], n.position[1], n.position[2]]);
      const ls = this.linkStatuses.get(n.nodeId);
      nodeDirectSnrMap.set(n.nodeId, ls?.snrDb ?? ls?.sinrDb ?? -99.0);
    }
    const vel = this.trajectoryEngine.getAcnVelocity(this.simTimeS);
    const hdgDeg = ((Math.atan2(vel[1], vel[0]) * 180.0 / Math.PI % 360) + 360) % 360;
    const stepOut = stepConstellationWorkerSystem({
      acnConstellationCount: this.acnConstellationCount, enableMultiHopManet: this.enableMultiHopManet,
      enableGroundConvoyMobility: this.enableGroundConvoyMobility, windSpeedMs: this.windSpeedMs,
      windDirectionDeg: this.windDirectionDeg, enableAutoCfitPullUp: this.enableAutoCfitPullUp,
      simTimeSec: this.simTimeS, primaryAcnPos: acnPos, primaryAcnHdgDeg: hdgDeg,
      liveAltitudeM: this.liveAltitudeM, liveVzMps: this.liveVzMps,
      maxTerrainAheadM: this.terrainEngine.getElevation(acnPos[0], acnPos[1]) ?? 3500.0,
      nodePositions, nodeDirectSnrMap, nodeHandoverStates: this.nodeHandoverStates,
      groundConvoyStates: this.groundConvoyStates, uavEnduranceRemainingMin: this.uavEnduranceRemainingMin,
      handoverEventsTotal: this.handoverEventsTotal, dtSec: FRAME_DT,
      terrain: this.terrainEngine,
      rfConfig: this.rfConfig,
      envConfig: this.envConfig,
    });
    this.uavEnduranceRemainingMin = stepOut.updatedEnduranceMin;
    this.handoverEventsTotal = stepOut.handoverEventsTotal;
    if (this.enableAutoCfitPullUp && stepOut.cfitPullUpActive) {
      if (stepOut.commandedVzMps !== undefined) this.liveVzMps = stepOut.commandedVzMps;
      if (stepOut.commandedAltitudeMslM !== undefined && this.liveAltitudeM < stepOut.commandedAltitudeMslM) {
        this.liveAltitudeM = Math.min(stepOut.commandedAltitudeMslM, this.liveAltitudeM + this.liveVzMps * FRAME_DT);
      }
    }
    this.constellationMobilityTelemetry = stepOut.telemetry;
    return stepOut.telemetry;
  }

  private buildTelemetryFrame(acnPos: [number, number, number]): TelemetryFrame {
    this.ensureActiveNodesDomainEvaluations(acnPos);
    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;
    const selNode = activeNodes.find((n) => n.nodeId === this.selectedNodeId) ?? activeNodes[0];
    const fresnelSlice = this.buildFresnelSlice(selNode, acnPos);
    const frame = this.telemetrySerializer.buildTelemetryFrame(this, acnPos, fresnelSlice);
    (frame as any).transport_abr_telemetry = this.buildTransportAbrTelemetry();
    (frame as any).ew_eccm_telemetry = this.buildEwEccmTelemetry();
    (frame as any).constellation_mobility_telemetry = this.buildConstellationMobilityTelemetry(acnPos);
    this.lastTelemetryFrame = frame;
    return frame;
  }

  private buildFresnelSlice(
    node: GroundNodeTrafficSubsystem | undefined,
    acnPos: [number, number, number]
  ): FresnelSliceTelemetry {
    if (!node) {
      return buildEmptyFresnelSlice(this.frameIndex, this.simTimeS, acnPos);
    }
    const { obstruction, linkStatus, predState } = this.ensureNodeDomainEvaluations(node, acnPos);
    const regEntity = this.nodeRegistry.getByNodeId(node.nodeId);
    const resolvedName = regEntity?.identity.callsign ?? node.identity?.callsign ?? (node.nodeId === MCP_ID ? 'MCP' : `S${node.nodeId}`);
    return computeFresnelSlice({
      node,
      resolvedName,
      acnPos,
      frameIndex: this.frameIndex,
      simTimeS: this.simTimeS,
      rfConfig: this.rfConfig,
      envConfig: this.envConfig,
      terrainEngine: this.terrainEngine,
      linkEngine: this.linkEngine,
      obstruction,
      linkStatus,
      predState,
      fresnelFraction: PROFILE_FRESNEL_FRACTION,
      sampleCount: FRESNEL_SAMPLES,
    });
  }

  private computeFlightPath(numPoints: number = 64): [number, number][] {
    return this.trajectoryEngine.getPathPoints(numPoints);
  }

  /**
   * Reset all run-local state before a fresh experiment. Scenario configuration
   * (RF, terrain mode, rain, and flight parameters) is intentionally preserved;
   * scheduler adaptation state and per-run counters are not.
   */
  public resetSimulationState(): void {
    this.simulationRunId += 1;
    this.evictionFinalizationIndex = 0;
    this.speed = PLAYBACK_SPEED.defaultValue;
    this.achievedSpeed = 1.0;
    this.simDebtMs = 0.0;
    this.prevAcnVel = [0, 0, 0];
    this.jammerShieldLossDb = 0.0;
    this.jammerSectorInterferenceDbm = [-150.0, -150.0, -150.0, -150.0];
    this.lastSpeedMeasureTime = 0.0;
    this.lastSpeedMeasureSimTime = 0.0;
    if (this.timerId !== null) {
      this.restartTimer();
    }
    this.registrationLifecycle.clear();
    if (this.currentScenarioPreset === '16_NODES') {
      this.nodeRegistry = createDefault16NodeRegistry(this.seedOffset);
      this.selectedNodeId = 4;
    } else {
      this.nodeRegistry = new NodeRegistry(this.seedOffset);
      this.selectedNodeId = -1;
    }
    this.initNodes();
    this.initTransfers();
    this.antennaEngine.reset();
    this.reinitSchedulers();
    this.tdmaAccumulatorS = 0.0;
    this.tdmaSimTimeS = 0.0;
    this.superframeEpochIndex = 0;
    this.discontinuityIndex = 0;
    this.pendingTimelineRecords = [];
    this.batchSpatialSnapshots = [];
    this.simTimeS = 0.0;
    if (this.currentScenarioPreset === '16_NODES') {
      for (const id of GROUND_NODE_IDS) this.registrationLifecycle.add(id, this.simTimeS);
    }
    this.frameIndex = 0;
    this.spatialRevision = 0;
    this.node4Frozen = false;
    this.activeStepRequestId = undefined;
    this.lastReportStatic = null;
    this.lastReportTac = null;
    this.lastReportReactive = null;
    this.staticGoodputTracker.reset();
    this.tacGoodputTracker.reset();
    this.liveAltitudeM = this.flightConfig.altitudeMslM;
    this.liveVzMps = 0.0;
    this.isTerrainClamped = false;
    this.trajectoryEngine.resetKinematics(this.flightConfig.loiterSpeedMps);
    this.linkStatuses.clear();
    this.linkStatusesStatic.clear();
    this.linkStatusesReactive.clear();
    this.linkStatusesTac.clear();
    this.nodeSinrHistory.clear();
    this.predStates.clear();
    this.obstructionResults.clear();
    this.clearRelayHop1Cache();
    this.relayedNodeCount = 0;
    this.relayBackhaulSectorId = undefined;
    this.relayBackhaulSnrDb = undefined;
    this.ollaOffsetByNode.clear();
    this.cqiHistoryByNode.clear();
    this.harqSlotByNode.clear();
    this.harqRetxTotal = 0;
    this.aimdStateByNode.clear();
    this.abrStateByNode.clear();
    this.closedLoopCapacityScaleByNode.clear();
    this.abrStepDownsTotal = 0;
    this.abrStepUpsTotal = 0;
    this.prevSectorByNode.clear();
    this.hifiTelemetry = undefined;
    this.biomeId = 'alpine_mountain'; this.enableBiomeEmPhysics = false; this.polarizationMode = 'RHCP';
    this.dustVisibilityKm = 15.0; this.foliageDepthM = 0.0; this.weatherCells = [];
    this.liveMeanTwoRayGainDb = 0.0; this.liveMeanFoliageLossDb = 0.0; this.liveMeanDustLossDb = 0.0; this.liveMeanPolLossDb = 0.0;
    this.eccmMode = 'NONE'; this.enableMvdrNullSteering = false; this.enableAdversaryEsmModel = false;
    this.gnssSpoofingRateUsPerSec = 0.0; this.enableAntiSpoofHoldover = false; this.gnssSpoofElapsedSec = 0.0;
    this.liveMeanProcessingGainDb = 0.0; this.liveMeanSpatialNullRejectionDb = 0.0;
    this.liveMeanEffectiveJammerPowerDbm = -150.0; this.liveRawJammerPowerDbm = -150.0;
    this.liveJammerSuppressed = false; this.liveMaxSlantRangeM = 10000.0; this.ewEccmTelemetry = undefined;
    this.acnConstellationCount = 1; this.enableMultiHopManet = false; this.enableGroundConvoyMobility = false;
    this.windSpeedMs = 0.0; this.windDirectionDeg = 270.0; this.enableAutoCfitPullUp = false;
    this.nodeHandoverStates.clear(); this.groundConvoyStates.clear();
    const defConvoys = createDefaultGroundConvoyStates();
    for (const [k, v] of defConvoys.entries()) this.groundConvoyStates.set(k, v);
    this.uavEnduranceRemainingMin = 480.0; this.handoverEventsTotal = 0; this.constellationMobilityTelemetry = undefined;
    this.terrainEngine.setBiome('alpine_mountain');
    this.lookaheadEngine?.invalidateAll();
    this.deferredEmergencyQueue.clear();
    this.metrics = createDefaultSimulationMetrics();
  }

  public handleMessage(msg: WorkerInboundCommand): WorkerCommandResult {
    const commandType = msg && typeof msg === 'object' && 'type' in msg ? String(msg.type).toUpperCase() : 'UNKNOWN';
    const result = (accepted: boolean, reason?: string): WorkerCommandResult => {
      const response: WorkerCommandResult = {
        type: 'COMMAND_RESULT', command_type: commandType, accepted,
        ...(msg && typeof msg === 'object' && msg.request_id !== undefined ? { request_id: msg.request_id } : {}),
        ...(msg && typeof msg === 'object' && msg.request_id !== undefined ? { trajectory_config: {
          trajectory_mode: this.flightConfig.trajectoryMode,
          center_x_m: this.flightConfig.centerXm,
          center_y_m: this.flightConfig.centerYm,
          orbit_a_m: this.flightConfig.loiterRadiusAM,
          orbit_b_m: this.flightConfig.loiterRadiusBM,
          orbit_rotation_deg: this.flightConfig.loiterRotationDeg,
          loiter_speed_mps: this.flightConfig.loiterSpeedMps,
          acn_altitude_m: this.flightConfig.altitudeMslM,
          waypoints: this.flightConfig.waypoints.map(point => ({ x_m: point.xM, y_m: point.yM })),
        } } : {}),
        ...(commandType === 'OBSTACLES_REPLACE' ? { obstacle_set: this.terrainEngine.obstacleField.all } : {}),
        ...(commandType === 'OBSTACLES_REPLACE' ? { obstruction_state: this.getObstructionStateSnapshot() } : {}),
        ...(reason ? { reason } : {}), spatial_locked: this.spatialLocked,
        simulation_run_id: this.simulationRunId,
      };
      this.emitHostMessage(response);
      return response;
    };
    const reject = (reason: string) => result(false, reason);
    const locked = () => reject('Spatial lock is enabled; spatial state was not changed.');
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return reject('Command must be an object.');

    switch (msg.type) {
      case 'OBSTACLES_REPLACE': {
        if (this.spatialLocked) return locked();
        const previousObstacles = this.terrainEngine.obstacleField.all;
        try {
          // ObstacleField validates and builds its spatial index before atomically swapping state.
          this.terrainEngine.obstacleField.replace(msg.obstacles);
          this.lookaheadEngine.invalidateAll();
          this.deferredEmergencyQueue.clear();
        } catch (error) {
          return reject(error instanceof Error ? error.message : 'Invalid obstacle set.');
        }
        try {
          this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        } catch (error) {
          // Refresh is staged; restore geometry if derived-state evaluation unexpectedly fails.
          this.terrainEngine.obstacleField.replace(previousObstacles);
          return reject(error instanceof Error ? error.message : 'Invalid obstacle set.');
        }
        // Emit an out-of-band profile frame so the UI reflects the new obstacle geometry
        // immediately, without waiting for the next normal telemetry tick.
        this.spatialRevision++;
        this.emitProfileFrame();
        return result(true);
      }

      case 'SET_SPATIAL_LOCK':
        if (typeof msg.locked !== 'boolean') return reject('locked must be a boolean.');
        this.spatialLocked = msg.locked;
        return result(true);

      case 'NODE_MOVE': {
        if (this.spatialLocked) return locked();
        const moveValidation = validateNodeMoveCommand(
          msg,
          (id) => this.nodeRegistry.hasNodeId(id),
          ACN_ID,
          THEATER_HALF_M
        );
        if (!moveValidation.valid) {
          return reject(moveValidation.reason!);
        }
        const nid = msg.node_id;
        const xm = msg.x_m;
        const ym = msg.y_m;
        if (nid === ACN_ID) {
          const deltaX = xm - this.flightConfig.centerXm;
          const deltaY = ym - this.flightConfig.centerYm;
          const translatedWaypoints = this.flightConfig.waypoints.map(point => ({ xM: point.xM + deltaX, yM: point.yM + deltaY }));
          let next: ACNFlightConfig, trajectory: ACNTrajectory;
          try {
            next = new ACNFlightConfig({ ...this.flightConfig, centerXm: xm, centerYm: ym, waypoints: translatedWaypoints });
            trajectory = createACNTrajectory(next);
          } catch (error) {
            return reject(error instanceof Error ? error.message : 'Invalid trajectory update.');
          }
          this.flightConfig = next;
          this.trajectoryEngine = trajectory;
          this.lookaheadEngine = new PredictiveLookAheadEngine(
            this.terrainEngine, this.linkEngine, this.rfConfig, this.envConfig, next, trajectory
          );
        } else {
          const staticNode = this.nodesStatic.find(n => n.nodeId === nid);
          const tacNode = this.nodesTac.find(n => n.nodeId === nid);
          if (!staticNode || !tacNode) return reject(`Node ${nid} not found in active simulation.`);
          const terrainMsl = this.terrainEngine.getElevation(xm, ym);
          staticNode.position = [xm, ym, terrainMsl + staticNode.aglM];
          tacNode.position = [xm, ym, terrainMsl + tacNode.aglM];
          this.nodeRegistry.updateSpatial(nid, xm, ym);
        }
        this.spatialRevision++;
        this.lookaheadEngine.invalidateAll();
        this.deferredEmergencyQueue.clear();
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.computeRelayAdvisor();
        this.emitProfileFrame();
        return result(true);
      }

      case 'LOAD_PRESET': {
        const presetValidation = validatePresetCommand(msg.preset_id);
        if (!presetValidation.valid) return reject(presetValidation.reason!);
        const pidKey = presetValidation.presetKey!;
        const isOcclusion = pidKey === 'OCCLUSION';
        const isAmbush = pidKey === 'AMBUSH';
        const isMonsoon = pidKey === 'MONSOON';
        const isReset = pidKey === 'RESET';
        const isAcnOnly = pidKey === 'ACN_ONLY';
        const is16Nodes = pidKey === '16_NODES';
        if (this.spatialLocked && (isOcclusion || isReset || isAcnOnly || is16Nodes)) return locked();

        if (isAcnOnly) {
          this.preparePresetRunReset();
          this.currentScenarioPreset = 'ACN_ONLY';
          this.registrationLifecycle.clear();
          this.nodeRegistry = new NodeRegistry(this.seedOffset);
          this.initNodes();
          this.initTransfers();
          this.reinitSchedulers();
          this.selectedNodeId = -1;
          this.spatialRevision++;
          this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
          this.computeRelayAdvisor();
          this.emitProfileFrame();
          return result(true);
        }

        if (is16Nodes) {
          this.preparePresetRunReset();
          this.currentScenarioPreset = '16_NODES';
          this.nodeRegistry = createDefault16NodeRegistry(this.seedOffset);
          this.registrationLifecycle.clear();
          for (const id of GROUND_NODE_IDS) this.registrationLifecycle.add(id, this.simTimeS);
          this.initNodes();
          this.initTransfers();
          this.reinitSchedulers();
          this.selectedNodeId = 4;
          this.resampleGroundNodeAltitudes();
          this.spatialRevision++;
          this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
          this.computeRelayAdvisor();
          this.emitProfileFrame();
          return result(true);
        }

        if (isOcclusion || isAmbush) {
          if (this.nodeRegistry.size === 0) {
            this.currentScenarioPreset = '16_NODES';
            this.nodeRegistry = createDefault16NodeRegistry(this.seedOffset);
            this.registrationLifecycle.clear();
            for (const id of GROUND_NODE_IDS) this.registrationLifecycle.add(id, this.simTimeS);
            this.initNodes();
            this.initTransfers();
            this.resampleGroundNodeAltitudes();
          }
        }

        if (isOcclusion) {
          this.spatialRevision++;
          const terrainMsl = this.terrainEngine.getElevation(12000.0, 8000.0);
          this.nodesStatic[4].position = [12000.0, 8000.0, terrainMsl + this.nodesStatic[4].aglM];
          this.nodesTac[4].position = [12000.0, 8000.0, terrainMsl + this.nodesTac[4].aglM];
          this.nodeRegistry.updateSpatial(4, 12000.0, 8000.0);
          this.selectedNodeId = 4;
          for (let k = 0; k < 30; k++) {
            this.nodesStatic[4].enqueuePacket(70, this.simTimeS, 1400);
            this.nodesTac[4].enqueuePacket(70, this.simTimeS, 1400);
          }
          this.transferManager.startTransfer(
            4,
            'PHOTO',
            42000,
            this.simTimeS,
            false,
            'PRESET OCCLUSION: Node 4 enqueued 42 KB photo.'
          );
        } else if (isAmbush) {
          this.envConfig = new EnvironmentConfig({ ...this.envConfig, rainRateMmH: 0.0 });
          this.selectedNodeId = 1;
          for (let k = 0; k < 20; k++) {
            this.nodesStatic[1].enqueuePacket(69, this.simTimeS, 128);
            this.nodesTac[1].enqueuePacket(69, this.simTimeS, 128);
          }
          for (let k = 0; k < 35; k++) {
            this.nodesStatic[15].enqueuePacket(67, this.simTimeS, 1200);
            this.nodesTac[15].enqueuePacket(67, this.simTimeS, 1200);
          }
        } else if (isMonsoon) {
          this.envConfig = new EnvironmentConfig({ ...this.envConfig, rainRateMmH: 35.0 });
        } else {
          this.resetSimulationState();
        }
        this.emitProfileFrame();
        return result(true);
      }

      case 'INJECT_TRAFFIC': {
        const trafficValidation = validateTrafficInjectionCommand(
          msg,
          (id) => this.nodeRegistry.hasNodeId(id),
          this.selectedNodeId
        );
        if (!trafficValidation.valid) return reject(trafficValidation.reason!);
        const nid = trafficValidation.resolvedNodeId!;
        const staticNode = this.nodesStatic.find(n => n.nodeId === nid);
        const tacNode = this.nodesTac.find(n => n.nodeId === nid);
        if (!staticNode || !tacNode) return reject('node_id must identify an active ground node.');
        const ttype = String(msg.traffic_type ?? 'SOS').toUpperCase();
        const bytes = getDefaultPayloadBytes(ttype);
        const ps = this.predStates.get(nid);
        const isBlocked = ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF;
        this.transferManager.startTransfer(nid, ttype, bytes, this.simTimeS, isBlocked);
        staticNode.injectTraffic(ttype, this.simTimeS);
        tacNode.injectTraffic(ttype, this.simTimeS);
        return result(true);
      }

      case 'SET_SCIENTIFIC_PARAMS': {
        const sci = resolveScientificParams(msg, this.envConfig);
        if (sci.viewshedEnabled !== undefined) this.viewshedEnabled = sci.viewshedEnabled;
        if (sci.recomputeRelayAdvisor) this.computeRelayAdvisor();
        if (sci.enableAirframeShadowing !== undefined) this.enableAirframeShadowing = sci.enableAirframeShadowing; if (sci.enableCorrelatedRicianFading !== undefined) this.enableCorrelatedRicianFading = sci.enableCorrelatedRicianFading;
        if (sci.enableMacPhyFeedback !== undefined) this.enableMacPhyFeedback = sci.enableMacPhyFeedback; if (sci.enableDubinsKinematics !== undefined) this.enableDubinsKinematics = sci.enableDubinsKinematics;
        if (sci.viewshedFidelityMode !== undefined) this.viewshedFidelityMode = sci.viewshedFidelityMode; if (sci.enableTransportAbr !== undefined) this.enableTransportAbr = sci.enableTransportAbr;
        if (sci.eccmMode !== undefined) this.eccmMode = sci.eccmMode; if (sci.enableMvdrNullSteering !== undefined) this.enableMvdrNullSteering = sci.enableMvdrNullSteering;
        if (sci.enableAdversaryEsmModel !== undefined) this.enableAdversaryEsmModel = sci.enableAdversaryEsmModel; if (sci.enableAntiSpoofHoldover !== undefined) this.enableAntiSpoofHoldover = sci.enableAntiSpoofHoldover;
        if (sci.gnssSpoofingRateUsPerSec !== undefined) { this.gnssSpoofingRateUsPerSec = sci.gnssSpoofingRateUsPerSec; if (this.gnssSpoofingRateUsPerSec <= 0) this.gnssSpoofElapsedSec = 0.0; }
        if (sci.acnConstellationCount !== undefined) this.acnConstellationCount = sci.acnConstellationCount; if (sci.enableMultiHopManet !== undefined) this.enableMultiHopManet = sci.enableMultiHopManet;
        if (sci.enableGroundConvoyMobility !== undefined) this.enableGroundConvoyMobility = sci.enableGroundConvoyMobility; if (sci.windSpeedMs !== undefined) this.windSpeedMs = sci.windSpeedMs;
        if (sci.windDirectionDeg !== undefined) this.windDirectionDeg = sci.windDirectionDeg; if (sci.enableAutoCfitPullUp !== undefined) this.enableAutoCfitPullUp = sci.enableAutoCfitPullUp;
        if (sci.biomeId !== undefined && sci.biomeId !== this.biomeId) {
          this.biomeId = sci.biomeId;
          this.terrainEngine.setBiome(sci.biomeId);
          this.hillshadeGenerator.invalidateRealCache();
          this.resampleGroundNodeAltitudes();
          this.spatialRevision++;
          this.lookaheadEngine.invalidateAll();
          this.deferredEmergencyQueue.clear();
          this.initHillshade(512);
        }
        if (sci.enableBiomeEmPhysics !== undefined) this.enableBiomeEmPhysics = sci.enableBiomeEmPhysics;
        if (sci.polarizationMode !== undefined) this.polarizationMode = sci.polarizationMode;
        if (sci.dustVisibilityKm !== undefined) this.dustVisibilityKm = sci.dustVisibilityKm;
        if (sci.foliageDepthM !== undefined) this.foliageDepthM = sci.foliageDepthM;
        if (sci.weatherCells !== undefined) this.weatherCells = sci.weatherCells;
        this.envConfig = sci.nextEnvConfig;
        this.lookaheadEngine.setEnvConfig(this.envConfig);
        for (let i = 0; i < this.nodesStatic.length; i++) this.nodesStatic[i].trafficLoadMultiplier = sci.trafficScale;
        for (let i = 0; i < this.nodesTac.length; i++) this.nodesTac[i].trafficLoadMultiplier = sci.trafficScale;
        for (let i = 0; i < this.nodesReactive.length; i++) this.nodesReactive[i].trafficLoadMultiplier = sci.trafficScale;
        this.lookaheadEngine.invalidateAll();
        if (sci.clearSinrHistory) {
          this.nodeSinrHistory.clear();
        }
        if (
          sci.needsObstructionRefresh ||
          sci.enableAirframeShadowing !== undefined ||
          sci.enableCorrelatedRicianFading !== undefined ||
          sci.enableMacPhyFeedback !== undefined ||
          sci.enableDubinsKinematics !== undefined ||
          sci.viewshedFidelityMode !== undefined ||
          sci.enableTransportAbr !== undefined ||
          sci.eccmMode !== undefined ||
          sci.enableMvdrNullSteering !== undefined
        ) {
          this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        }
        return result(true);
      }

      case 'SET_VIEWSHED_CONFIG': {
        const v = resolveViewshedConfig(msg, this.envConfig);
        if (v.viewshedEnabled !== undefined) {
          this.viewshedEnabled = v.viewshedEnabled;
        }
        if (v.recomputeRelayAdvisor) {
          this.computeRelayAdvisor();
        }
        if (v.nextEnvConfig) {
          this.envConfig = v.nextEnvConfig;
          this.lookaheadEngine.setEnvConfig(this.envConfig);
        }
        if (v.needsObstructionRefresh) {
          this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        }
        return result(true);
      }

      case 'SET_TERRAIN_MODE': {
        if (this.spatialLocked) return locked();
        if (msg.mode !== 'real' && msg.mode !== 'synthetic') return reject('mode must be real or synthetic.');
        this.terrainEngine.setTerrainMode(msg.mode);
        this.resampleGroundNodeAltitudes();
        this.initHillshade(512);
        return result(true);
      }

      case 'SET_BIOME': {
        if (this.spatialLocked) return locked();
        const v = validateSetBiomeCommand(msg);
        if (!v.valid || !v.biomeId) return reject(v.reason ?? 'Invalid SET_BIOME payload.');
        this.biomeId = v.biomeId;
        if (v.enableBiomeEmPhysics !== undefined) this.enableBiomeEmPhysics = v.enableBiomeEmPhysics;
        if (v.polarizationMode !== undefined) this.polarizationMode = v.polarizationMode;
        if (v.dustVisibilityKm !== undefined) this.dustVisibilityKm = v.dustVisibilityKm;
        if (v.foliageDepthM !== undefined) this.foliageDepthM = v.foliageDepthM;
        if (v.weatherCells !== undefined) this.weatherCells = v.weatherCells;

        this.terrainEngine.setBiome(v.biomeId);
        this.hillshadeGenerator.invalidateRealCache();
        this.resampleGroundNodeAltitudes();
        this.spatialRevision++;
        this.lookaheadEngine.invalidateAll();
        this.deferredEmergencyQueue.clear();
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.initHillshade(512);

        const bounds = this.terrainEngine.getTerrainBoundsTelemetry();
        this.emitHostMessage({
          type: 'TERRAIN_BOUNDS_READY',
          request_id: msg.request_id,
          bounds,
        });
        return result(true);
      }

      case 'LOAD_CUSTOM_DEM': {
        if (this.spatialLocked) return locked();
        const elevations = msg.elevations;
        const metadata = msg.metadata;
        if (!elevations || (!(elevations instanceof Float32Array) && !(elevations instanceof ArrayBuffer))) {
          return reject('elevations must be Float32Array or ArrayBuffer.');
        }

        const success = this.terrainEngine.loadCustomDem(elevations, metadata);
        if (!success) {
          return reject('Failed to load custom DEM into terrain engine.');
        }

        this.hillshadeGenerator.invalidateRealCache();
        this.resampleGroundNodeAltitudes();
        this.spatialRevision++;
        this.lookaheadEngine.invalidateAll();
        this.deferredEmergencyQueue.clear();
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.initHillshade(512);

        const bounds = this.terrainEngine.getTerrainBoundsTelemetry();
        this.emitHostMessage({
          type: 'TERRAIN_BOUNDS_READY',
          request_id: msg.request_id,
          bounds,
        });
        this.emitHostMessage({
          type: 'CUSTOM_DEM_LOADED',
          request_id: msg.request_id,
          tile_name: metadata?.tileName ?? 'custom',
          resolution: metadata?.rasterWidth ?? 512,
          bounds,
        });

        this.emitProfileFrame();
        return result(true);
      }

      case 'GET_HILLSHADE':
        this.initHillshade(512);
        return result(true);

      case 'GET_TERRAIN_BOUNDS': {
        const bounds = this.getTerrainBounds();
        this.emitHostMessage({
          type: 'TERRAIN_BOUNDS_READY',
          request_id: msg.request_id,
          bounds,
        });
        return result(true);
      }

      case 'GET_TERRAIN_MESH_DATA': {
        const { message: payload, transferList } = TerrainMeshGenerator.generate(
          this.terrainEngine,
          msg.request_id,
          512
        );

        // Transfer ownership of transferGrid.buffer ONLY
        this.emitHostMessage(payload, transferList);
        return result(true);
      }

      case 'SET_PARAMS':
      case 'CONFIG_UPDATE':
      case 'UPDATE_PARAMS':
      case 'UPDATE_CONFIG': {
        const p: ConfigUpdateParams = (msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)) ? msg.params : msg;
        const validation = validateConfigUpdateParams(
          p,
          this.flightConfig,
          this.tdmaConfig,
          (id) => this.nodeRegistry.hasNodeId(id)
        );
        if (!validation.valid) {
          return reject(validation.reason!);
        }
        if (this.spatialLocked && (validation.changesTrajectory || validation.changesTerrain || validation.hasAgl)) {
          return locked();
        }

        if (validation.enableAirframeShadowing !== undefined) this.enableAirframeShadowing = validation.enableAirframeShadowing; if (validation.enableCorrelatedRicianFading !== undefined) this.enableCorrelatedRicianFading = validation.enableCorrelatedRicianFading;
        if (validation.enableMacPhyFeedback !== undefined) this.enableMacPhyFeedback = validation.enableMacPhyFeedback; if (validation.enableDubinsKinematics !== undefined) this.enableDubinsKinematics = validation.enableDubinsKinematics;
        if (validation.viewshedFidelityMode !== undefined) this.viewshedFidelityMode = validation.viewshedFidelityMode; if (validation.enableTransportAbr !== undefined) this.enableTransportAbr = validation.enableTransportAbr;
        if (validation.eccmMode !== undefined) this.eccmMode = validation.eccmMode; if (validation.enableMvdrNullSteering !== undefined) this.enableMvdrNullSteering = validation.enableMvdrNullSteering;
        if (validation.enableAdversaryEsmModel !== undefined) this.enableAdversaryEsmModel = validation.enableAdversaryEsmModel; if (validation.enableAntiSpoofHoldover !== undefined) this.enableAntiSpoofHoldover = validation.enableAntiSpoofHoldover;
        if (validation.gnssSpoofingRateUsPerSec !== undefined) { this.gnssSpoofingRateUsPerSec = validation.gnssSpoofingRateUsPerSec; if (this.gnssSpoofingRateUsPerSec <= 0) this.gnssSpoofElapsedSec = 0.0; }
        if (validation.acnConstellationCount !== undefined) this.acnConstellationCount = validation.acnConstellationCount; if (validation.enableMultiHopManet !== undefined) this.enableMultiHopManet = validation.enableMultiHopManet;
        if (validation.enableGroundConvoyMobility !== undefined) this.enableGroundConvoyMobility = validation.enableGroundConvoyMobility; if (validation.windSpeedMs !== undefined) this.windSpeedMs = validation.windSpeedMs;
        if (validation.windDirectionDeg !== undefined) this.windDirectionDeg = validation.windDirectionDeg; if (validation.enableAutoCfitPullUp !== undefined) this.enableAutoCfitPullUp = validation.enableAutoCfitPullUp;

        // Construct the full replacement trajectory before mutating any live configuration.
        let nextFlightConfig: ACNFlightConfig | null = validation.nextFlightConfig ?? null;
        let nextTrajectory: ACNTrajectory | null = null;
        if (validation.changesTrajectory || p.coverage_radius_km !== undefined) {
          try {
            nextFlightConfig = validation.nextFlightConfig!;
            const prevKinematics = this.trajectoryEngine.getKinematicsState();
            nextTrajectory = createACNTrajectory(
              nextFlightConfig,
              prevKinematics,
              (x, y) => this.terrainEngine.getElevation(x, y)
            );
            if (validation.targetSpeedMps !== undefined) {
              nextTrajectory.setTargetSpeed(validation.targetSpeedMps, this.simTimeS);
            }
            if (validation.accelLimitMps2 !== undefined || validation.decelLimitMps2 !== undefined) {
              nextTrajectory.setLimits(validation.accelLimitMps2, validation.decelLimitMps2);
            }
          } catch (error) {
            return reject(error instanceof Error ? error.message : 'Invalid trajectory configuration.');
          }
        }

        // All validation/construction is complete before any scenario state is changed.
        if (validation.changesTerrain) {
          this.terrainEngine.setTerrainMode(p.terrain_mode!);
          this.resampleGroundNodeAltitudes();
        }
        if (p.carrier_freq_ghz !== undefined) this.rfConfig = new RFConfig({ ...this.rfConfig, carrierFrequencyHz: p.carrier_freq_ghz * 1e9 });
        if (p.channel_bandwidth_mhz !== undefined) this.rfConfig = new RFConfig({ ...this.rfConfig, channelBandwidthHz: p.channel_bandwidth_mhz * 1e6 });
        if (p.rain_rate_mmh !== undefined) this.envConfig = new EnvironmentConfig({ ...this.envConfig, rainRateMmH: p.rain_rate_mmh });
        if (p.earthRadiusFactorK !== undefined && Number.isFinite(p.earthRadiusFactorK)) {
          const k = Math.max(0.5, Math.min(10.0, p.earthRadiusFactorK));
          this.envConfig = new EnvironmentConfig({ ...this.envConfig, earthRadiusFactorK: k, effectiveEarthRadiusFactor: k });
        }
        if (nextFlightConfig && nextTrajectory) {
          this.flightConfig = nextFlightConfig;
          this.trajectoryEngine = nextTrajectory;
          if (p.acn_altitude_m !== undefined && this.flightConfig.altitudeMode === 'fix') {
            this.liveAltitudeM = p.acn_altitude_m;
            this.liveVzMps = 0.0;
          }
        }
        if (validation.changesTrajectory || p.coverage_radius_km !== undefined || p.carrier_freq_ghz !== undefined || p.channel_bandwidth_mhz !== undefined || p.rain_rate_mmh !== undefined || p.earthRadiusFactorK !== undefined) {
          this.lookaheadEngine = new PredictiveLookAheadEngine(
            this.terrainEngine, this.linkEngine, this.rfConfig, this.envConfig, this.flightConfig, this.trajectoryEngine
          );
        }
        if (p.agl_m !== undefined && p.node_id !== undefined) {
          const nid = p.node_id;
          const staticNode = this.nodesStatic.find(n => n.nodeId === nid);
          const tacNode = this.nodesTac.find(n => n.nodeId === nid);
          if (staticNode && tacNode) {
            const terrainMsl = this.terrainEngine.getElevation(tacNode.position[0], tacNode.position[1]);
            staticNode.aglM = p.agl_m;
            tacNode.aglM = p.agl_m;
            staticNode.position = [staticNode.position[0], staticNode.position[1], terrainMsl + p.agl_m];
            tacNode.position = [tacNode.position[0], tacNode.position[1], terrainMsl + p.agl_m];
            this.nodeRegistry.updateAgl(nid, p.agl_m);
          }
        }
        if (validation.changesTerrain) this.initHillshade(512);
        if (validation.nextTdmaConfig) {
          const oldDurationMs = this.tdmaConfig.frameDurationMs;
          const newDurationMs = validation.nextTdmaConfig.frameDurationMs;
          const residualS = this.tdmaAccumulatorS;

          this.tdmaConfig = validation.nextTdmaConfig;
          this.staticScheduler.setTdmaConfig(this.tdmaConfig);
          this.tacScheduler.setTdmaConfig(this.tdmaConfig);
          this.tdmaAccumulatorS = 0.0;

          if (residualS > 1e-6) {
            const discontinuityRecord: SuperframeDiscontinuityRecord = {
              recordType: 'DISCONTINUITY',
              simulationRunId: this.simulationRunId,
              discontinuityIndex: this.discontinuityIndex++,
              epochIndex: this.superframeEpochIndex++,
              startTimeS: this.tdmaSimTimeS,
              endTimeS: this.tdmaSimTimeS + residualS,
              discardedDurationMs: residualS * 1000.0,
              discardedDurationS: residualS,
              oldDurationMs,
              newDurationMs,
              nominalSimTimeS: this.simTimeS,
              reason: 'RECONFIGURATION_RESET',
              reconfigurationReason: `Waveform switched from ${oldDurationMs}ms to ${newDurationMs}ms`,
            };
            this.pendingTimelineRecords.push(discontinuityRecord);
            this.tdmaSimTimeS = this.tdmaSimTimeS + residualS;
          } else {
            this.tdmaSimTimeS = Math.max(this.tdmaSimTimeS, this.simTimeS);
          }
        }
        if (p.lookahead_cadence_hz !== undefined) {
          const hz = Number(p.lookahead_cadence_hz);
          if (Number.isFinite(hz)) {
            this.setLookaheadCadence(hz);
          }
        }
        if (p.lookahead_interval_frames !== undefined) {
          const iv = Number(p.lookahead_interval_frames);
          if (Number.isFinite(iv) && iv >= 1) {
            this.lookaheadIntervalFrames = Math.round(iv);
            this.lookaheadEngine.invalidateAll();
            this.deferredEmergencyQueue.clear();
          }
        }
        if (validation.changesTrajectory || validation.changesTerrain || p.agl_m !== undefined || p.altitude_mode !== undefined || p.acn_altitude_m !== undefined) {
          this.spatialRevision++;
          this.lookaheadEngine.invalidateAll();
          this.deferredEmergencyQueue.clear();
        }
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.computeRelayAdvisor();
        this.emitProfileFrame();
        return result(true);
      }

      case 'SIM_CONTROL': {
        const act = typeof msg.action === 'string' ? msg.action.toLowerCase() : '';
        if (!['pause', 'resume', 'step', 'reset'].includes(act)) return reject('action must be pause, resume, step, or reset.');
        if (act === 'reset' && this.spatialLocked) return locked();
        if (act === 'pause') {
          this.isPaused = true;
          this.achievedSpeed = 0.0;
        } else if (act === 'resume') {
          this.isPaused = false;
          this.simDebtMs = 0.0;
          this.lastTickRealMs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
          this.lastSpeedMeasureTime = 0.0;
          this.lastSpeedMeasureSimTime = this.simTimeS;
        } else if (act === 'step') {
          this.isPaused = true;
          this.activeStepRequestId = typeof msg.step_request_id === 'number' ? msg.step_request_id : undefined;
          this.tickSimulation();
          this.activeStepRequestId = undefined;
        }
        else this.resetSimulationState();
        return result(true);
      }

      case 'SET_SPEED':
        if (!isFiniteNumber(msg.speed) || msg.speed < PLAYBACK_SPEED.min || msg.speed > PLAYBACK_SPEED.max) {
          return reject(`speed must be finite and between ${PLAYBACK_SPEED.min} and ${PLAYBACK_SPEED.max}.`);
        }
        this.speed = msg.speed;
        this.restartTimer();
        return result(true);

      case 'SET_SCHEDULER':
        if (msg.mode !== 'tac_tad' && msg.mode !== 'static') return reject('mode must be tac_tad or static.');
        this.schedulerMode = msg.mode;
        return result(true);

      case 'SELECT_NODE':
        if (msg.node_id === -1) {
          this.selectedNodeId = -1;
          this.emitProfileFrame();
          return result(true);
        }
        if (!Number.isInteger(msg.node_id) || !this.nodeRegistry.hasNodeId(msg.node_id)) return reject('node_id must identify a registered ground node.');
        this.selectedNodeId = msg.node_id;
        this.emitProfileFrame();
        return result(true);

      case 'CLEAR_TRANSFER': {
        const nid = msg.node_id === undefined ? this.selectedNodeId : msg.node_id;
        if (!Number.isInteger(nid) || !this.nodeRegistry.hasNodeId(nid)) return reject('node_id must identify a registered ground node.');
        this.transferManager.clearTransfer(nid);
        return result(true);
      }

      case 'NODE_ADD': {
        const outcome = NodeLifecycleManager.addNode({
          msg,
          nodeRegistry: this.nodeRegistry,
          registrationLifecycle: this.registrationLifecycle,
          terrainEngine: this.terrainEngine,
          simTimeS: this.simTimeS,
          spatialLocked: this.spatialLocked,
        });
        if (!outcome.accepted) {
          return reject(outcome.reason!);
        }

        const nid = outcome.entity!.identity.nodeId;
        this.nodesStatic.push(outcome.nodePair![0]);
        this.nodesTac.push(outcome.nodePair![1]);
        if (outcome.nodePair![2]) {
          this.nodesReactive.push(outcome.nodePair![2]);
          this.reactiveScheduler.registerNode(outcome.nodePair![2]);
        }
        this.staticScheduler.registerNode(outcome.nodePair![0]);
        this.tacScheduler.registerNode(outcome.nodePair![1]);

        this.transferManager.registerNode(nid);

        if (this.selectedNodeId < 0 || !this.nodeRegistry.hasNodeId(this.selectedNodeId)) {
          this.selectedNodeId = nid;
        }

        this.spatialRevision++;
        this.lookaheadEngine.invalidateAll();
        this.deferredEmergencyQueue.clear();
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.computeRelayAdvisor();
        this.emitProfileFrame();

        const res: WorkerCommandResult = {
          type: 'COMMAND_RESULT',
          command_type: 'NODE_ADD',
          accepted: true,
          node_id: nid,
          entity_id: outcome.entity!.identity.entityId,
          creation_sequence: outcome.entity!.identity.creationSequence,
          nodes_count: this.nodeRegistry.size,
          spatial_locked: this.spatialLocked,
          request_id: msg.request_id,
          simulation_run_id: this.simulationRunId,
        };
        this.emitHostMessage(res);
        return res;
      }

      case 'NODE_DELETE': {
        const outcome = NodeLifecycleManager.deleteNode({
          msg,
          nodeRegistry: this.nodeRegistry,
          registrationLifecycle: this.registrationLifecycle,
          simTimeS: this.simTimeS,
          spatialLocked: this.spatialLocked,
        });
        if (!outcome.accepted) {
          return reject(outcome.reason!);
        }

        const nid = outcome.deletedNodeId!;
        const staticNode = this.nodesStatic.find((n) => n.nodeId === nid);
        const tacNode = this.nodesTac.find((n) => n.nodeId === nid);
        const associatedFrame = resolveDeletionFrameAssociation(this.simTimeS, this.frameIndex);

        const evictionRecords: EvictionDropFinalizationRecord[] = [];
        const staticEviction = this.captureEvictionFinalization(
          'STATIC_TDMA',
          this.staticScheduler,
          nid,
          staticNode,
          associatedFrame
        );
        if (staticEviction) {
          evictionRecords.push(staticEviction);
        }
        const tacEviction = this.captureEvictionFinalization(
          'TAC_TAD',
          this.tacScheduler,
          nid,
          tacNode,
          associatedFrame
        );
        if (tacEviction) {
          evictionRecords.push(tacEviction);
        }
        if (evictionRecords.length > 0) {
          this.pendingTimelineRecords.push(...evictionRecords);
        }

        this.nodesStatic = this.nodesStatic.filter(n => n.nodeId !== nid);
        this.nodesTac = this.nodesTac.filter(n => n.nodeId !== nid);
        this.nodesReactive = this.nodesReactive.filter(n => n.nodeId !== nid);

        this.linkStatuses.delete(nid);
        this.predStates.delete(nid);
        this.obstructionResults.delete(nid);
        this.lookaheadEngine.invalidateNode(nid);
        this.deferredEmergencyQueue.delete(nid);
        this.transferManager.evictNode(nid);
        this.antennaEngine.evictNode(nid);

        if (this.selectedNodeId === nid) {
          if (this.nodesTac.length > 0) {
            this.selectedNodeId = this.nodesTac[0].nodeId;
          } else {
            this.selectedNodeId = -1;
          }
        }

        this.spatialRevision++;
        this.lookaheadEngine.invalidateAll();
        this.deferredEmergencyQueue.clear();
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.computeRelayAdvisor();
        this.emitProfileFrame();

        const res: WorkerCommandResult = {
          type: 'COMMAND_RESULT',
          command_type: 'NODE_DELETE',
          accepted: true,
          node_id: nid,
          deleted_node_id: nid,
          nodes_count: this.nodeRegistry.size,
          spatial_locked: this.spatialLocked,
          request_id: msg.request_id,
          simulation_run_id: this.simulationRunId,
          eviction_finalizations: evictionRecords,
        };
        this.emitHostMessage(res);
        return res;
      }

      case 'NODE_DUPLICATE': {
        const outcome = NodeLifecycleManager.duplicateNode({
          msg,
          nodeRegistry: this.nodeRegistry,
          registrationLifecycle: this.registrationLifecycle,
          terrainEngine: this.terrainEngine,
          simTimeS: this.simTimeS,
          spatialLocked: this.spatialLocked,
        });
        if (!outcome.accepted) {
          return reject(outcome.reason!);
        }

        const nid = outcome.entity!.identity.nodeId;
        this.nodesStatic.push(outcome.nodePair![0]);
        this.nodesTac.push(outcome.nodePair![1]);
        if (outcome.nodePair![2]) {
          this.nodesReactive.push(outcome.nodePair![2]);
          this.reactiveScheduler.registerNode(outcome.nodePair![2]);
        }
        this.staticScheduler.registerNode(outcome.nodePair![0]);
        this.tacScheduler.registerNode(outcome.nodePair![1]);

        this.transferManager.registerNode(nid);

        this.spatialRevision++;
        this.lookaheadEngine.invalidateAll();
        this.deferredEmergencyQueue.clear();
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.computeRelayAdvisor();
        this.emitProfileFrame();

        const res: WorkerCommandResult = {
          type: 'COMMAND_RESULT',
          command_type: 'NODE_DUPLICATE',
          accepted: true,
          node_id: nid,
          entity_id: outcome.entity!.identity.entityId,
          source_node_id: outcome.sourceNodeId!,
          creation_sequence: outcome.entity!.identity.creationSequence,
          nodes_count: this.nodeRegistry.size,
          spatial_locked: this.spatialLocked,
          request_id: msg.request_id,
          simulation_run_id: this.simulationRunId,
        };
        this.emitHostMessage(res);
        return res;
      }

      case 'NODE_UPDATE': {
        const outcome = NodeLifecycleManager.updateNode({
          msg,
          nodesStatic: this.nodesStatic,
          nodesTac: this.nodesTac,
          nodesReactive: this.nodesReactive,
          nodeRegistry: this.nodeRegistry,
          terrainEngine: this.terrainEngine,
          spatialLocked: this.spatialLocked,
        });
        if (!outcome.accepted) {
          return reject(outcome.reason!);
        }

        if (outcome.spatialChanged) {
          this.spatialRevision++;
          if (outcome.nodeId !== undefined) {
            this.lookaheadEngine.invalidateNode(outcome.nodeId);
          }
        }
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.emitProfileFrame();

        const res: WorkerCommandResult = {
          type: 'COMMAND_RESULT',
          command_type: 'NODE_UPDATE',
          accepted: true,
          node_id: outcome.nodeId!,
          spatial_locked: this.spatialLocked,
          request_id: msg.request_id,
          simulation_run_id: this.simulationRunId,
        };
        this.emitHostMessage(res);
        return res;
      }

      case 'TRIGGER_AI_NODE_REPOSITION': {
        const nid = msg.nodeId;
        const staticNode = this.nodesStatic.find(n => n.nodeId === nid);
        if (!staticNode) return reject(`Node ${nid} not found in active simulation.`);
        let rec = this.aiRecommendations.get(nid);
        if (!rec || !rec.needsReposition) {
          const acnPos = this.getLiveAcnPosition();
          const ls = this.linkStatuses.get(nid);
          rec = computeAiRecoveryAdvisory({
            nodeId: nid,
            nodePos: staticNode.position,
            nodeType: staticNode.nodeType,
            acnPos,
            currentSinrDb: ls?.sinrDb ?? -99.0,
            currentIsOutage: ls?.isOutage ?? true,
            getElevationAt: (x, y) => this.terrainEngine.getElevation(x, y),
            qTable: this.aiQTable,
            obstacles: this.terrainEngine.obstacleField.all,
            rfConfig: this.rfConfig,
            envConfig: this.envConfig,
            kinematicConstraints: this.enableDubinsKinematics
              ? this.buildGroundKinematicConstraints(staticNode.nodeType)
              : undefined,
          });
          this.aiRecommendations.set(nid, rec);
          this.aiLastEvalTick.set(nid, this.aiTickCount);
        }
        if (rec && rec.needsReposition) {
          const walkPath = rec.walkPathEnu && rec.walkPathEnu.length >= 2
            ? rec.walkPathEnu
            : [staticNode.position, [rec.targetPos[0], rec.targetPos[1], rec.targetPos[2]] as Position3D];
          const firstTarget = walkPath[1] ?? rec.targetPos;
          const firstDist = Math.hypot(firstTarget[0] - staticNode.position[0], firstTarget[1] - staticNode.position[1]);
          const firstDeltaZ = firstTarget[2] - staticNode.position[2];
          const tobler = computeToblerWalkingSpeedMs(firstDist, firstDeltaZ, staticNode.nodeType);
          this.aiActiveMovements.set(nid, {
            targetPos: [rec.targetPos[0], rec.targetPos[1], rec.targetPos[2]],
            speedMs: Math.max(0.5, tobler.speedMs),
            moveBearingDeg: rec.moveBearingDeg,
            waypoints: walkPath,
            waypointIndex: 1,
          });
          this.aiActiveMovingNodes.add(nid);
          this.aiActiveRepositionCount = this.aiActiveMovements.size;
        }
        return result(true);
      }

      case 'SET_AI_AUTO_HEAL': {
        if (typeof msg.enabled !== 'boolean') return reject('enabled must be a boolean.');
        this.aiAutoHealEnabled = msg.enabled;
        return result(true);
      }

      case 'TRIGGER_AI_SKY_SHEPHERD': {
        const nid = msg.pinnedNodeId;
        const enabled = Boolean(msg.enabled);
        if (enabled) {
          this.aiPinnedNodes.add(nid);
          this.aiSkyShepherdActive = true;
          this.aiSkyShepherdNodeId = nid;
          const pinnedNode = this.nodesStatic.find(n => n.nodeId === nid);
          if (pinnedNode) {
            const centerPos: Position3D = [
              this.flightConfig.centerXm,
              this.flightConfig.centerYm,
              this.liveAltitudeM ?? this.flightConfig.altitudeMslM,
            ];
            const shepherdRes = this.aiCoordinator.evaluateSkyShepherd(
              pinnedNode.position,
              centerPos,
              (x, y) => this.terrainEngine.getElevation(x, y),
              this.rfConfig.carrierFrequencyHz
            );
            this.aiSkyShepherdDirective = shepherdRes.shepherdDirectiveText;
            if (shepherdRes.isShepherdFeasible) {
              this.skyShepherdTargetOffset = [shepherdRes.deltaXM, shepherdRes.deltaYM, shepherdRes.deltaAltM];
            } else {
              this.skyShepherdTargetOffset = [0, 0, 0];
            }
          }
        } else {
          this.aiPinnedNodes.delete(nid);
          if (this.aiSkyShepherdNodeId === nid) {
            this.aiSkyShepherdActive = false;
            this.aiSkyShepherdNodeId = null;
            this.aiSkyShepherdDirective = '';
            this.skyShepherdTargetOffset = [0, 0, 0];
          }
        }
        return result(true);
      }

      case 'SET_AI_COPILOT_CONFIG': {
        if (typeof msg.buddyMeshEnabled === 'boolean') {
          this.aiBuddyMeshEnabled = msg.buddyMeshEnabled;
        }
        if (typeof msg.lpiStealthEnabled === 'boolean') {
          this.aiLpiStealthEnabled = msg.lpiStealthEnabled;
        }
        if (typeof msg.autoHealEnabled === 'boolean') {
          this.aiAutoHealEnabled = msg.autoHealEnabled;
        }
        return result(true);
      }

      default:
        return reject(`Unsupported command type '${commandType}'.`);
    }
  }

  public async start(): Promise<void> {
    // 1. Try to load real satellite DEM using dynamic Base URL
    try {
      const ok = await this.terrainEngine.loadRealSatelliteDem();
      if (ok) {
        console.log('[Worker] Real satellite DEM loaded successfully.');
        // Loading the DEM changes elevation samples while the nodes still carry
        // constructor-time fallback altitudes. Resample before starting the ticker.
        this.resampleGroundNodeAltitudes();
      } else {
        console.log('[Worker] Real satellite DEM not found, using synthetic procedural fallback.');
        this.terrainEngine.setTerrainMode('synthetic');
      }
    } catch (e) {
      console.warn('[Worker] Satellite DEM acquisition note:', e);
      this.terrainEngine.setTerrainMode('synthetic');
    }

    // 2. Generate 512x512 hillshade relief grid covering the 1,200 km theater
    this.initHillshade(512);

    // 3. Start 50 Hz discrete-event ticker
    this.restartTimer();
  }

  private restartTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    this.lastTickRealMs = now;
    this.simDebtMs = 0;

    // For speed <= 1.0: pace by adjusting timer interval (e.g. 0.1x -> 200ms, 0.5x -> 40ms, 1.0x -> 20ms)
    // For speed > 1.0: keep timer interval at a reliable 20ms (50 Hz) and batch multiple 20ms steps per tick
    const intervalMs = this.speed <= 1.0
      ? Math.max(20, Math.round(20.0 / this.speed))
      : 20;

    const timer = setInterval(() => {
      if (this.isPaused) {
        this.lastTickRealMs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now();
        this.simDebtMs = 0;
        return;
      }

      const tickNow = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
      const elapsedRealMs = Math.min(250, Math.max(0, tickNow - this.lastTickRealMs));
      this.lastTickRealMs = tickNow;

      // Accumulate simulated milliseconds debt
      this.simDebtMs += elapsedRealMs * this.speed;

      // Bound max steps in a single batch to prevent spiral-of-death on heavy CPU stalls
      const maxStepsPerBatch = Math.max(1, Math.min(25, Math.ceil(this.speed * 2.5)));
      let stepsRun = 0;

      // Run 20 ms simulation steps while we have accumulated simulation debt
      while (this.simDebtMs >= 20.0 && stepsRun < maxStepsPerBatch) {
        stepsRun++;
        this.simDebtMs -= 20.0;
        // In a batch, only emit telemetry on the final step to keep main thread UI responsive
        const isFinalStep = (this.simDebtMs < 20.0 || stepsRun >= maxStepsPerBatch);
        this.tickSimulation(isFinalStep);
      }

      // If debt still exceeds 50ms after batching, drain excess debt to avoid runaway catchup lag
      if (this.simDebtMs > 50.0) {
        this.simDebtMs = 50.0;
      }

      // Track achieved speed over rolling ~400ms window
      this.updateAchievedSpeedMeasurement(tickNow);
    }, intervalMs);

    if (typeof (timer as any)?.unref === 'function') {
      (timer as any).unref();
    }
    this.timerId = timer as unknown as number;
  }

  private updateAchievedSpeedMeasurement(wallNow: number): void {
    if (this.lastSpeedMeasureTime <= 0) {
      this.lastSpeedMeasureTime = wallNow;
      this.lastSpeedMeasureSimTime = this.simTimeS;
      return;
    }
    const wallElapsedMs = wallNow - this.lastSpeedMeasureTime;
    if (wallElapsedMs >= 400) {
      const realElapsedS = wallElapsedMs / 1000.0;
      const simElapsedS = this.simTimeS - this.lastSpeedMeasureSimTime;
      if (this.isPaused) {
        this.achievedSpeed = 0.0;
      } else if (realElapsedS > 0) {
        this.achievedSpeed = Math.round((simElapsedS / realElapsedS) * 100) / 100;
      }
      this.lastSpeedMeasureTime = wallNow;
      this.lastSpeedMeasureSimTime = this.simTimeS;
    }
  }
}

// Instantiate only when executed inside a browser worker. Importing this module
// from Node must not start timers or require Worker globals.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const simWorker = new SimulationWorkerManager(0, 'ACN_ONLY');
  void simWorker.start();
  self.onmessage = (event: MessageEvent<WorkerInboundCommand>) => {
    simWorker.handleMessage(event.data);
  };
}
