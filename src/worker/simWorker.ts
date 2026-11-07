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
  ACNFlightConfig,
  EnvironmentConfig,
  GROUND_NODE_IDS,
  MAX_ACN_WAYPOINTS,
  NodeType,
  RFConfig,
  SPEED_OF_LIGHT,
} from '../core/config';
import { LinkBudgetEngine, LinkStatus } from '../core/linkBudget';
import { Obstacle } from '../core/obstacles';
import {
  GroundNodeTrafficSubsystem,
  Packet,
  QOS_PROFILES,
} from '../core/queues';
import {
  BaseScheduler,
  FrameScheduleReport,
  LegacyStaticScheduler,
  SlotAllocation,
  TerrainAwareDynamicScheduler,
  T_FRAME_S,
} from '../core/scheduler';
import {
  REAL_LADAKH_DEM_METADATA,
  TerrainBoundsTelemetry,
  TerrainEngine,
  TerrainObstruction,
} from '../core/terrain';
import { RollingGoodputTracker } from '../core/rollingGoodput';
import { RegistrationLifecycle } from '../core/registration';
import { TdmaFrameConfig } from '../core/tdmaConfig';
import {
  NodeRegistry,
  createDefault16NodeRegistry,
  GroundNodeEntity,
  formatDeterministicNodeUuid,
  NodeTrafficOptions,
} from '../core/nodeRegistry';
import {
  ActiveTransferManager,
  type NodeTransferState,
  getDefaultPayloadBytes,
} from '../core/transferManager';
import {
  ACNTrajectory,
  createACNTrajectory,
  NodeTerrainState,
  PredictiveLookAheadEngine,
  PredictiveState,
} from '../core/trajectory';
import {
  FRAME_DT,
  THEATER_HALF_M,
  MCP_ID,
  ACN_ID,
  FRESNEL_SAMPLES,
  MIN_GROUND_AGL_M,
  MAX_GROUND_AGL_M,
  DEFAULT_ANTENNA_AGL_M,
  MAX_ACTIVE_GROUND_NODES,
  PLAYBACK_SPEED,
} from '../shared/constants';
import { isFiniteNumber } from '../shared/utils';
import type { Position3D } from '../shared/types';
import type {
  WorkerCommandResult,
  SelectedLinkBudgetTelemetry,
  TelemetryGanttAllocation,
  WorkerInboundCommand,
  WorkerOutboundMessage,
  TelemetryFrame,
  NodeTelemetryItem,
  FresnelSliceTelemetry,
  TerrainMeshDataReadyMessage,
  ConfigUpdateParams,
} from '../shared/workerProtocol';
import {
  HillshadeGenerator,
  type HillshadeResult,
} from './hillshadeGenerator';
import {
  TelemetrySerializer,
  normalizeSlotAllocationToFrame,
  type RunningMetrics,
  type TelemetrySimulationState,
} from './telemetrySerializer';
import {
  NodeLifecycleManager,
} from './nodeLifecycleManager';
import {
  TerrainMeshGenerator,
  type TerrainMeshGenerationResult,
} from './terrainMeshGenerator';
import {
  buildFresnelSlice as computeFresnelSlice,
  buildEmptyFresnelSlice,
  PROFILE_FRESNEL_FRACTION,
} from '../core/profileEngine';

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
};
export type {
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
};

const ANTENNA_HEIGHT_M = 2.0;
const NUM_NODES = GROUND_NODE_IDS.length;

export class SimulationWorkerManager {
  public rfConfig: RFConfig;
  public envConfig: EnvironmentConfig;
  public flightConfig: ACNFlightConfig;
  public terrainEngine: TerrainEngine;
  public linkEngine: LinkBudgetEngine;
  public trajectoryEngine: ACNTrajectory;
  public lookaheadEngine: PredictiveLookAheadEngine;

  public staticScheduler: LegacyStaticScheduler;
  public tacScheduler: TerrainAwareDynamicScheduler;
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

  public getLiveAcnPosition(): [number, number, number] {
    const p = this.trajectoryEngine.getAcnPosition(this.simTimeS);
    return [p[0], p[1], this.liveAltitudeM];
  }

  public nodeRegistry: NodeRegistry;
  public nodesStatic: GroundNodeTrafficSubsystem[] = [];
  public nodesTac: GroundNodeTrafficSubsystem[] = [];
  public linkStatuses: Map<number, LinkStatus> = new Map();
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

  private timerId: number | null = null;
  private simDebtMs: number = 0.0;
  private lastTickRealMs: number = 0.0;
  private lastSpeedMeasureTime: number = 0.0;
  private lastSpeedMeasureSimTime: number = 0.0;
  private node4Frozen: boolean = false;
  public lastReportStatic: FrameScheduleReport | null = null;
  public lastReportTac: FrameScheduleReport | null = null;
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
    this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);
    this.tacScheduler.setTdmaConfig(this.tdmaConfig);
    this.tdmaAccumulatorS = 0.0;

    this.metrics = {
      staticGoodputBits: 0,
      tacGoodputBits: 0,
      staticWastedBits: 0,
      tacWastedBits: 0,
      staticDroppedPkts: 0,
      tacDroppedPkts: 0,
      staticEnqueuedPkts: 0,
      tacEnqueuedPkts: 0,
      node4PreShadowBacklogKb: 0,
      staticNode4PreShadowBacklogKb: 0,
      lastStaticUtilPct: 0,
      lastTacUtilPct: 0,
      staticScheduledUlTimeS: 0,
      tacScheduledUlTimeS: 0,
      staticAvailableUlTimeS: 0,
      tacAvailableUlTimeS: 0,
      staticUnusedUlTimeS: 0,
      tacUnusedUlTimeS: 0,
      staticPayloadBitsDequeued: 0,
      tacPayloadBitsDequeued: 0,
      staticDelayDropsThisRun: 0,
      tacDelayDropsThisRun: 0,
      staticOverflowDropsThisRun: 0,
      tacOverflowDropsThisRun: 0,
      staticFinalBacklogBits: 0,
      tacFinalBacklogBits: 0,
    };

    this.initNodes();
    this.initTransfers();
  }

  private initNodes(): void {
    const { nodesStatic, nodesTac } = NodeLifecycleManager.initNodes(this.nodeRegistry, this.terrainEngine);
    this.nodesStatic = nodesStatic;
    this.nodesTac = nodesTac;
  }

  /** Re-derive each ground node's MSL altitude from the currently active terrain and its AGL. */
  private resampleGroundNodeAltitudes(): void {
    NodeLifecycleManager.resampleGroundNodeAltitudes(
      this.nodesStatic,
      this.nodesTac,
      this.nodeRegistry,
      this.terrainEngine
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
      if (transferList && transferList.length > 0) {
        self.postMessage(message, transferList as any);
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

    const acnPos: [number, number, number] = [targetPos[0], targetPos[1], this.liveAltitudeM];

    // Refresh all spatially derived decisions before traffic generation reads isShadowed.
    this.refreshObstructionState(acnPos, t);

    // TDMA Superframe Scheduling via Temporal Accumulator (Resolving Audit Finding 1)
    this.tdmaAccumulatorS += FRAME_DT;
    const tFrame = this.tdmaConfig.frameDurationS;

    if (Math.abs(tFrame - FRAME_DT) < 1e-6) {
      // Baseline 20 ms mode: 100% bit-for-bit identical to original discrete physics
      for (let i = 0; i < this.nodesStatic.length; i++) {
        const sPkts = this.nodesStatic[i].generateTraffic(t, FRAME_DT);
        const tPkts = this.nodesTac[i].generateTraffic(t, FRAME_DT);
        this.metrics.staticEnqueuedPkts += sPkts.length;
        this.metrics.tacEnqueuedPkts += tPkts.length;

        this.nodesStatic[i].queue.pruneExpiredPackets(t);
        this.nodesTac[i].queue.pruneExpiredPackets(t);
      }
      this.executeTdmaSuperframe(t, FRAME_DT);
      this.tdmaAccumulatorS = 0.0;
    } else if (tFrame < FRAME_DT - 1e-6) {
      // Fast waveforms (tFrame < 20 ms, e.g. 10 ms fast mode):
      // Execute multiple TDMA sub-cycles within one 50 Hz physics tick
      while (this.tdmaAccumulatorS >= tFrame - 1e-6) {
        for (let i = 0; i < this.nodesStatic.length; i++) {
          const sPkts = this.nodesStatic[i].generateTraffic(t, tFrame);
          const tPkts = this.nodesTac[i].generateTraffic(t, tFrame);
          this.metrics.staticEnqueuedPkts += sPkts.length;
          this.metrics.tacEnqueuedPkts += tPkts.length;

          this.nodesStatic[i].queue.pruneExpiredPackets(t);
          this.nodesTac[i].queue.pruneExpiredPackets(t);
        }
        this.executeTdmaSuperframe(t, tFrame);
        this.tdmaAccumulatorS -= tFrame;
      }
    } else {
      // Extended waveforms (tFrame > 20 ms, e.g. 40 ms extended mode):
      // Generate traffic for FRAME_DT every tick so backlogs accumulate naturally
      for (let i = 0; i < this.nodesStatic.length; i++) {
        const sPkts = this.nodesStatic[i].generateTraffic(t, FRAME_DT);
        const tPkts = this.nodesTac[i].generateTraffic(t, FRAME_DT);
        this.metrics.staticEnqueuedPkts += sPkts.length;
        this.metrics.tacEnqueuedPkts += tPkts.length;

        this.nodesStatic[i].queue.pruneExpiredPackets(t);
        this.nodesTac[i].queue.pruneExpiredPackets(t);
      }
      if (this.tdmaAccumulatorS >= tFrame - 1e-6) {
        this.executeTdmaSuperframe(t, tFrame);
        this.tdmaAccumulatorS -= tFrame;
      }
    }

    // 5. Active Transfer Machine
    const activeReport = this.schedulerMode === 'tac_tad' ? this.lastReportTac : this.lastReportStatic;
    if (activeReport) {
      this.transferManager.step({
        activeNodes: this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic,
        linkStatuses: this.linkStatuses,
        predStates: this.predStates,
        activeReport,
        simTimeS: t,
        isPaused: this.isPaused,
      });
    }

    // 6. Dispatch frame to main UI thread
    if (emitTelemetry) {
      const frame = this.buildTelemetryFrame(acnPos);
      this.emitHostMessage({ type: 'TELEMETRY_FRAME', frame });
    }
  }

  private executeTdmaSuperframe(t: number, tFrame: number): void {
    // 2. Schedulers
    const reportStatic = this.staticScheduler.scheduleFrame(
      this.frameIndex,
      t,
      this.nodesStatic,
      this.linkStatuses,
      this.predStates
    );
    const reportTac = this.tacScheduler.scheduleFrame(
      this.frameIndex,
      t,
      this.nodesTac,
      this.linkStatuses,
      this.predStates
    );

    this.lastReportStatic = reportStatic;
    this.lastReportTac = reportTac;

    // Rolling goodput sampling (M7.3: 200 superframes of completed payload delivery)
    this.staticGoodputTracker.recordSuperframeDeliveredBits(reportStatic.totalBitsTransmitted, tFrame);
    this.tacGoodputTracker.recordSuperframeDeliveredBits(reportTac.totalBitsTransmitted, tFrame);

    // 3. Metrics accumulation
    this.metrics.staticGoodputBits += reportStatic.totalBitsTransmitted;
    this.metrics.staticWastedBits += reportStatic.totalBitsWastedOnOutage;
    this.metrics.tacGoodputBits += reportTac.totalBitsTransmitted;
    this.metrics.tacWastedBits += reportTac.totalBitsWastedOnOutage;
    this.metrics.staticDroppedPkts = reportStatic.packetsDroppedDelay + reportStatic.packetsDroppedOverflow;
    this.metrics.tacDroppedPkts = reportTac.packetsDroppedDelay + reportTac.packetsDroppedOverflow;
    this.metrics.lastStaticUtilPct = reportStatic.totalUlUtilizationPct;
    this.metrics.lastTacUtilPct = reportTac.totalUlUtilizationPct;
    this.metrics.staticScheduledUlTimeS += reportStatic.totalUlScheduledS;
    this.metrics.tacScheduledUlTimeS += reportTac.totalUlScheduledS;
    this.metrics.staticAvailableUlTimeS += reportStatic.totalUlAvailableS;
    this.metrics.tacAvailableUlTimeS += reportTac.totalUlAvailableS;
    this.metrics.staticUnusedUlTimeS += reportStatic.totalUlUnusedS;
    this.metrics.tacUnusedUlTimeS += reportTac.totalUlUnusedS;
    this.metrics.staticPayloadBitsDequeued += reportStatic.totalPayloadBitsDequeued;
    this.metrics.tacPayloadBitsDequeued += reportTac.totalPayloadBitsDequeued;
    this.metrics.staticDelayDropsThisRun += reportStatic.packetsDroppedDelayThisFrame;
    this.metrics.tacDelayDropsThisRun += reportTac.packetsDroppedDelayThisFrame;
    this.metrics.staticOverflowDropsThisRun += reportStatic.packetsDroppedOverflowThisFrame;
    this.metrics.tacOverflowDropsThisRun += reportTac.packetsDroppedOverflowThisFrame;
    this.metrics.staticFinalBacklogBits = reportStatic.totalBacklogBits;
    this.metrics.tacFinalBacklogBits = reportTac.totalBacklogBits;

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

    // 4.5. Deterministic Node Battery & Energy Drain Model
    const activeReport = this.schedulerMode === 'tac_tad' ? reportTac : reportStatic;
    for (let i = 0; i < this.nodesTac.length; i++) {
      const nodeTac = this.nodesTac[i];
      const nodeStat = this.nodesStatic[i];
      const nid = nodeTac.nodeId;
      const isMcp = nodeTac.nodeType === 'mcp';
      const iIdleMa = isMcp ? 400.0 : 150.0;
      const pTxDbm = nodeTac.txPowerDbm ?? (isMcp ? 43.0 : 36.0);
      const pRfWatts = Math.pow(10.0, (pTxDbm - 30.0) / 10.0);
      const iTxRfMa = (pRfWatts / (0.35 * 12.0)) * 1000.0;
      const iTxTotalMa = iIdleMa + iTxRfMa;

      const alloc = activeReport.allocations.find((a) => a.nodeId === nid);
      const tTxS = alloc && alloc.durationS > 0 && !nodeTac.isDepleted ? alloc.durationS : 0.0;
      const tIdleS = Math.max(0.0, tFrame - tTxS);
      const drainedMah = (iIdleMa * tIdleS + iTxTotalMa * tTxS) / 3600.0;
      const capacityMah = Math.max(100.0, nodeTac.batteryCapacityMah || (isMcp ? 20000.0 : 5000.0));
      const deltaPct = (drainedMah / capacityMah) * 100.0;
      const nextLevelPct = Math.max(0.0, Math.min(100.0, nodeTac.batteryLevelPct - deltaPct));

      nodeTac.batteryLevelPct = nextLevelPct;
      nodeStat.batteryLevelPct = nextLevelPct;
      const depleted = nextLevelPct <= 0.0;
      nodeTac.isDepleted = depleted;
      nodeStat.isDepleted = depleted;
      this.nodeRegistry.updateBatteryLevel(nid, nextLevelPct);
    }
  }

  /** Recompute spatial decisions only; does not advance time or run traffic/schedulers. */
  private refreshObstructionState(acnPos: [number, number, number], timeS: number): void {
    const nextLinks = new Map<number, LinkStatus>();
    const nextPredictions = new Map<number, PredictiveState>();
    const nextObstructions = new Map<number, TerrainObstruction>();
    const nextShadow = new Map<number, boolean>();
    for (let i = 0; i < this.nodesTac.length; i++) {
      const node = this.nodesTac[i];
      const nid = node.nodeId;
      const obstruction = this.terrainEngine.evaluateTerrainObstruction(node.position, acnPos, this.rfConfig, this.envConfig);
      const prediction = this.lookaheadEngine.evaluatePredictiveState(node.position, timeS, obstruction);
      const [nx, ny, nz] = node.position;
      const slantM = Math.hypot(acnPos[0] - nx, acnPos[1] - ny, acnPos[2] - nz);
      nextObstructions.set(nid, obstruction);
      nextPredictions.set(nid, prediction);
      nextLinks.set(nid, this.linkEngine.evaluateLink(node.nodeType, slantM, obstruction.diffractionLossDb, this.rfConfig, this.envConfig, obstruction.obstacleBlocked, node.txPowerDbm));
      // Traffic-generation shadow is current geometry, independent of a predicted re-emergence label.
      nextShadow.set(nid, !obstruction.isLos || obstruction.obstacleBlocked);
    }
    // Publish staged results together so no caller can observe a partial node refresh.
    this.linkStatuses.clear(); for (const [id, value] of nextLinks) this.linkStatuses.set(id, value);
    this.predStates.clear(); for (const [id, value] of nextPredictions) this.predStates.set(id, value);
    this.obstructionResults.clear(); for (const [id, value] of nextObstructions) this.obstructionResults.set(id, value);
    for (let i = 0; i < this.nodesTac.length; i++) {
      const nid = this.nodesTac[i].nodeId;
      const isShad = nextShadow.get(nid) ?? false;
      this.nodesTac[i].isShadowed = isShad;
      this.nodesStatic[i].isShadowed = isShad;
    }
  }

  private getObstructionStateSnapshot(): NonNullable<WorkerCommandResult['obstruction_state']> {
    return this.nodesTac.map(node => {
      const obstruction = this.obstructionResults.get(node.nodeId);
      const link = this.linkStatuses.get(node.nodeId);
      const prediction = this.predStates.get(node.nodeId);
      return {
        node_id: node.nodeId,
        entity_id: node.entityId,
        creation_sequence: node.creationSequence,
        terrain_is_los: obstruction?.isLos ?? true,
        obstacle_blocked: obstruction?.obstacleBlocked ?? false,
        obstacle_intersections: obstruction?.obstacleIntersections.map(hit => ({ ...hit })) ?? [],
        link_outage: link?.isOutage ?? true,
        bitrate_bps: link?.bitrateBps ?? 0,
        modcod_name: link?.modcodName ?? 'LINK_OUTAGE',
        predicted_state: prediction?.currentState ?? NodeTerrainState.NORMAL_LOS,
        time_to_occlusion_s: prediction?.timeToOcclusionS ?? Number.POSITIVE_INFINITY,
        time_to_emergence_s: prediction?.timeToEmergenceS ?? Number.POSITIVE_INFINITY,
        is_shadowed: node.isShadowed,
        is_coverage_complete: obstruction?.isCoverageComplete ?? true,
        coverage_note: obstruction?.coverageNote,
      };
    });
  }


  public ensureNodeDomainEvaluations(node: GroundNodeTrafficSubsystem, acnPos: [number, number, number]): {
    obstruction: TerrainObstruction;
    linkStatus: LinkStatus;
    predState: PredictiveState;
  } {
    let obstruction = this.obstructionResults.get(node.nodeId);
    if (!obstruction) {
      obstruction = this.terrainEngine.evaluateTerrainObstruction(node.position, acnPos, this.rfConfig, this.envConfig);
      this.obstructionResults.set(node.nodeId, obstruction);
    }
    let linkStatus = this.linkStatuses.get(node.nodeId);
    if (!linkStatus) {
      const slantM = Math.hypot(acnPos[0] - node.position[0], acnPos[1] - node.position[1], acnPos[2] - node.position[2]);
      linkStatus = this.linkEngine.evaluateLink(node.nodeType, slantM, obstruction.diffractionLossDb, this.rfConfig, this.envConfig, obstruction.obstacleBlocked, node.txPowerDbm);
      this.linkStatuses.set(node.nodeId, linkStatus);
    }
    let predState = this.predStates.get(node.nodeId);
    if (!predState) {
      predState = this.lookaheadEngine.evaluatePredictiveState(node.position, this.simTimeS, obstruction);
      this.predStates.set(node.nodeId, predState);
    }
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

  private buildTelemetryFrame(acnPos: [number, number, number]): TelemetryFrame {
    this.ensureActiveNodesDomainEvaluations(acnPos);
    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;
    const selNode = activeNodes.find((n) => n.nodeId === this.selectedNodeId) ?? activeNodes[0];
    const fresnelSlice = this.buildFresnelSlice(selNode, acnPos);
    return this.telemetrySerializer.buildTelemetryFrame(this, acnPos, fresnelSlice);
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
    this.speed = PLAYBACK_SPEED.defaultValue;
    this.achievedSpeed = 1.0;
    this.simDebtMs = 0.0;
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
    this.staticScheduler = new LegacyStaticScheduler();
    this.staticScheduler.setTdmaConfig(this.tdmaConfig);
    this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);
    this.tacScheduler.setTdmaConfig(this.tdmaConfig);
    this.tdmaAccumulatorS = 0.0;
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
    this.staticGoodputTracker.reset();
    this.tacGoodputTracker.reset();
    this.liveAltitudeM = this.flightConfig.altitudeMslM;
    this.liveVzMps = 0.0;
    this.isTerrainClamped = false;
    this.trajectoryEngine.resetKinematics(this.flightConfig.loiterSpeedMps);
    this.linkStatuses.clear();
    this.predStates.clear();
    this.obstructionResults.clear();
    this.metrics = {
      staticGoodputBits: 0,
      tacGoodputBits: 0,
      staticWastedBits: 0,
      tacWastedBits: 0,
      staticDroppedPkts: 0,
      tacDroppedPkts: 0,
      staticEnqueuedPkts: 0,
      tacEnqueuedPkts: 0,
      node4PreShadowBacklogKb: 0,
      staticNode4PreShadowBacklogKb: 0,
      lastStaticUtilPct: 0,
      lastTacUtilPct: 0,
      staticScheduledUlTimeS: 0,
      tacScheduledUlTimeS: 0,
      staticAvailableUlTimeS: 0,
      tacAvailableUlTimeS: 0,
      staticUnusedUlTimeS: 0,
      tacUnusedUlTimeS: 0,
      staticPayloadBitsDequeued: 0,
      tacPayloadBitsDequeued: 0,
      staticDelayDropsThisRun: 0,
      tacDelayDropsThisRun: 0,
      staticOverflowDropsThisRun: 0,
      tacOverflowDropsThisRun: 0,
      staticFinalBacklogBits: 0,
      tacFinalBacklogBits: 0,
    };
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
        const nid = msg.node_id;
        const xm = msg.x_m;
        const ym = msg.y_m;
        if (!Number.isInteger(nid) || (nid !== ACN_ID && !this.nodeRegistry.hasNodeId(nid)) ||
            !isFiniteNumber(xm) || !isFiniteNumber(ym) ||
            Math.abs(xm) > THEATER_HALF_M || Math.abs(ym) > THEATER_HALF_M) {
          return reject('NODE_MOVE requires valid node_id and finite x_m/y_m within the terrain bounds (±600000 m).');
        }
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
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.emitProfileFrame();
        return result(true);
      }

      case 'LOAD_PRESET': {
        if (typeof msg.preset_id !== 'string') return reject('preset_id must be a string.');
        const pid = msg.preset_id.toUpperCase();
        const isOcclusion = pid === 'PRESET_OCCLUSION';
        const isAmbush = pid === 'PRESET_AMBUSH';
        const isMonsoon = pid === 'PRESET_MONSOON';
        const isReset = pid === 'PRESET_RESET';
        const isAcnOnly = pid === 'PRESET_ACN_ONLY' || pid === 'PRESET_ZERO_NODES';
        const is16Nodes = pid === 'PRESET_16_NODES' || pid === 'PRESET_CANONICAL_16' || pid === 'PRESET_DEFAULT';
        if (!isOcclusion && !isAmbush && !isMonsoon && !isReset && !isAcnOnly && !is16Nodes) return reject('Unknown preset.');
        if (this.spatialLocked && (isOcclusion || isReset || isAcnOnly || is16Nodes)) return locked();

        if (isAcnOnly) {
          this.currentScenarioPreset = 'ACN_ONLY';
          this.registrationLifecycle.clear();
          this.nodeRegistry = new NodeRegistry(this.seedOffset);
          this.initNodes();
          this.initTransfers();
          this.staticScheduler = new LegacyStaticScheduler();
          this.staticScheduler.setTdmaConfig(this.tdmaConfig);
          this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);
          this.tacScheduler.setTdmaConfig(this.tdmaConfig);
          this.selectedNodeId = -1;
          this.spatialRevision++;
          this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
          this.emitProfileFrame();
          return result(true);
        }

        if (is16Nodes) {
          this.currentScenarioPreset = '16_NODES';
          this.nodeRegistry = createDefault16NodeRegistry(this.seedOffset);
          this.registrationLifecycle.clear();
          for (const id of GROUND_NODE_IDS) this.registrationLifecycle.add(id, this.simTimeS);
          this.initNodes();
          this.initTransfers();
          this.staticScheduler = new LegacyStaticScheduler();
          this.staticScheduler.setTdmaConfig(this.tdmaConfig);
          this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);
          this.tacScheduler.setTdmaConfig(this.tdmaConfig);
          this.selectedNodeId = 4;
          this.resampleGroundNodeAltitudes();
          this.spatialRevision++;
          this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
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
        const nid = msg.node_id === undefined ? this.selectedNodeId : msg.node_id;
        if (!Number.isInteger(nid) || !this.nodeRegistry.hasNodeId(nid)) return reject('node_id must identify a registered ground node.');
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

      case 'SET_TERRAIN_MODE': {
        if (this.spatialLocked) return locked();
        if (msg.mode !== 'real' && msg.mode !== 'synthetic') return reject('mode must be real or synthetic.');
        this.terrainEngine.setTerrainMode(msg.mode);
        this.resampleGroundNodeAltitudes();
        this.initHillshade(512);
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
      case 'CONFIG_UPDATE': {
        const p: ConfigUpdateParams = (msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)) ? msg.params : msg;
        if (!p || typeof p !== 'object' || Array.isArray(p)) return reject('params must be an object.');
        const numericKeys = ['carrier_freq_ghz', 'channel_bandwidth_mhz', 'rain_rate_mmh', 'acn_altitude_m', 'orbit_a_m', 'orbit_b_m',
          'orbit_rotation_deg', 'loiter_speed_mps', 'acceleration_limit_mps2', 'deceleration_limit_mps2', 'coverage_radius_km', 'center_x_m', 'center_y_m', 'node_id', 'agl_m',
          'target_agl_m', 'max_climb_rate_mps', 'max_descent_rate_mps'] as const;
        for (const key of numericKeys) {
          if (Object.prototype.hasOwnProperty.call(p, key) && !isFiniteNumber(p[key])) return reject(`${key} must be a finite number.`);
        }
        if (p.terrain_mode !== undefined && p.terrain_mode !== 'real' && p.terrain_mode !== 'synthetic') return reject('terrain_mode must be real or synthetic.');
        if (p.trajectory_mode !== undefined && p.trajectory_mode !== 'ellipse' && p.trajectory_mode !== 'waypoints') return reject('trajectory_mode must be ellipse or waypoints.');
        if (p.altitude_mode !== undefined && p.altitude_mode !== 'fix' && p.altitude_mode !== 'amsl' && p.altitude_mode !== 'agl') {
          return reject("altitude_mode must be 'fix', 'amsl', or 'agl'.");
        }
        if (p.carrier_freq_ghz !== undefined && p.carrier_freq_ghz <= 0) return reject('carrier_freq_ghz must be greater than zero.');
        if (p.channel_bandwidth_mhz !== undefined && (p.channel_bandwidth_mhz < 0.1 || p.channel_bandwidth_mhz > 50.0)) return reject('channel_bandwidth_mhz must be between 0.1 and 50.0 MHz.');
        if (p.rain_rate_mmh !== undefined && p.rain_rate_mmh < 0) return reject('rain_rate_mmh cannot be negative.');
        if (p.acn_altitude_m !== undefined && (p.acn_altitude_m <= 0 || p.acn_altitude_m > 100000)) return reject('acn_altitude_m must be in (0, 100000].');
        if (p.target_agl_m !== undefined && (p.target_agl_m <= 0 || p.target_agl_m > 100000)) return reject('target_agl_m must be in (0, 100000].');
        if (p.max_climb_rate_mps !== undefined && (p.max_climb_rate_mps <= 0 || p.max_climb_rate_mps > 1000)) return reject('max_climb_rate_mps must be in (0, 1000].');
        if (p.max_descent_rate_mps !== undefined && (p.max_descent_rate_mps <= 0 || p.max_descent_rate_mps > 1000)) return reject('max_descent_rate_mps must be in (0, 1000].');
        if ((p.orbit_a_m !== undefined && (p.orbit_a_m <= 0 || p.orbit_a_m > THEATER_HALF_M)) || (p.orbit_b_m !== undefined && (p.orbit_b_m <= 0 || p.orbit_b_m > THEATER_HALF_M))) return reject('Orbit axes must be in (0, 600000] metres.');
        if (p.orbit_rotation_deg !== undefined && Math.abs(p.orbit_rotation_deg) > 360) return reject('orbit_rotation_deg must be within ±360 degrees.');
        if (p.loiter_speed_mps !== undefined && (p.loiter_speed_mps < 0 || p.loiter_speed_mps > 1000)) return reject('loiter_speed_mps must be in [0, 1000].');
        if (p.acceleration_limit_mps2 !== undefined && (p.acceleration_limit_mps2 <= 0 || p.acceleration_limit_mps2 > 50)) return reject('acceleration_limit_mps2 must be in (0, 50].');
        if (p.deceleration_limit_mps2 !== undefined && (p.deceleration_limit_mps2 <= 0 || p.deceleration_limit_mps2 > 50)) return reject('deceleration_limit_mps2 must be in (0, 50].');
        if ((p.center_x_m !== undefined && Math.abs(p.center_x_m) > THEATER_HALF_M) || (p.center_y_m !== undefined && Math.abs(p.center_y_m) > THEATER_HALF_M)) return reject('Orbit center coordinates must be within ±600000 metres.');
        if (p.coverage_radius_km !== undefined && (p.coverage_radius_km <= 0 || p.coverage_radius_km > 600)) return reject('coverage_radius_km must be in (0, 600].');
        const hasAgl = p.agl_m !== undefined || p.node_id !== undefined;
        if (hasAgl && (p.agl_m === undefined || p.node_id === undefined || !Number.isInteger(p.node_id) || !this.nodeRegistry.hasNodeId(p.node_id))) return reject('AGL updates require a valid ground node_id and agl_m.');
        if (p.agl_m !== undefined && (p.agl_m < MIN_GROUND_AGL_M || p.agl_m > MAX_GROUND_AGL_M)) return reject(`agl_m must be between ${MIN_GROUND_AGL_M} and ${MAX_GROUND_AGL_M} metres.`);

        let nextTdmaConfig: TdmaFrameConfig | null = null;
        if (p.tdma_frame_config !== undefined) {
          if (typeof p.tdma_frame_config !== 'object' || p.tdma_frame_config === null || Array.isArray(p.tdma_frame_config)) {
            return reject('tdma_frame_config must be an object.');
          }
          try {
            nextTdmaConfig = new TdmaFrameConfig({
              ...this.tdmaConfig.toObject(),
              ...p.tdma_frame_config,
            });
          } catch (error) {
            return reject(error instanceof Error ? error.message : 'Invalid TDMA frame configuration.');
          }
        }

        const nextMode = p.trajectory_mode ?? this.flightConfig.trajectoryMode;
        if (p.waypoints !== undefined && nextMode !== 'waypoints') return reject('waypoints can only be edited while trajectory_mode is explicitly waypoints.');
        let nextWaypoints = this.flightConfig.waypoints;
        if (p.waypoints !== undefined) {
          if (!Array.isArray(p.waypoints)) return reject('waypoints must be an array of {x_m, y_m} points.');
          const parsed: { xM: number; yM: number; zM?: number }[] = [];
          for (let i = 0; i < p.waypoints.length; i++) {
            const point = p.waypoints[i] as any;
            const xCandidate = point?.x_m ?? point?.xM;
            const yCandidate = point?.y_m ?? point?.yM;
            if (!point || typeof point !== 'object' || !isFiniteNumber(xCandidate) || !isFiniteNumber(yCandidate) ||
                Math.abs(xCandidate) > THEATER_HALF_M || Math.abs(yCandidate) > THEATER_HALF_M) {
              return reject(`Waypoint ${i} must have finite x_m/y_m coordinates within ±600000 metres.`);
            }
            const zCandidate = point.z_m ?? point.zM;
            const zM = isFiniteNumber(zCandidate) ? zCandidate : undefined;
            if (zM !== undefined && (zM < 0 || zM > 100000)) {
              return reject(`Waypoint ${i} altitude must be in [0, 100000] metres.`);
            }
            parsed.push({
              xM: xCandidate,
              yM: yCandidate,
              ...(zM !== undefined ? { zM } : {}),
            });
          }
          if (parsed.length > MAX_ACN_WAYPOINTS) return reject(`waypoints cannot exceed ${MAX_ACN_WAYPOINTS} points.`);
          nextWaypoints = parsed;
        }
        if (nextMode === 'waypoints' && (p.trajectory_mode === 'waypoints' || p.waypoints !== undefined) && nextWaypoints.length < 3) {
          return reject('Switching to waypoint mode requires at least three waypoints.');
        }
        if (nextMode === 'waypoints' && (p.center_x_m !== undefined || p.center_y_m !== undefined)) return reject('center_x_m/center_y_m apply only to ellipse mode.');

        const trajectoryKeys = [
          'acn_altitude_m', 'altitude_mode', 'target_agl_m', 'max_climb_rate_mps', 'max_descent_rate_mps',
          'orbit_a_m', 'orbit_b_m', 'orbit_rotation_deg', 'loiter_speed_mps',
          'acceleration_limit_mps2', 'deceleration_limit_mps2',
          'center_x_m', 'center_y_m', 'trajectory_mode', 'waypoints'
        ] as const;
        const changesTrajectory = trajectoryKeys.some(k => (p as any)[k] !== undefined);
        const changesTerrain = p.terrain_mode !== undefined;
        if (this.spatialLocked && (changesTrajectory || changesTerrain || hasAgl)) return locked();

        // Construct the full replacement trajectory before mutating any live configuration.
        let nextFlightConfig: ACNFlightConfig | null = null;
        let nextTrajectory: ACNTrajectory | null = null;
        if (changesTrajectory || p.coverage_radius_km !== undefined) {
          try {
            nextFlightConfig = new ACNFlightConfig({
              ...this.flightConfig,
              trajectoryMode: nextMode,
              waypoints: nextWaypoints,
              altitudeMslM: p.acn_altitude_m ?? this.flightConfig.altitudeMslM,
              altitudeMode: p.altitude_mode ?? this.flightConfig.altitudeMode,
              targetAglM: p.target_agl_m ?? this.flightConfig.targetAglM,
              maxClimbRateMps: p.max_climb_rate_mps ?? this.flightConfig.maxClimbRateMps,
              maxDescentRateMps: p.max_descent_rate_mps ?? this.flightConfig.maxDescentRateMps,
              loiterRadiusAM: p.orbit_a_m ?? this.flightConfig.loiterRadiusAM,
              loiterRadiusBM: p.orbit_b_m ?? this.flightConfig.loiterRadiusBM,
              loiterRotationDeg: p.orbit_rotation_deg ?? this.flightConfig.loiterRotationDeg,
              loiterSpeedMps: p.loiter_speed_mps ?? this.flightConfig.loiterSpeedMps,
              accelerationLimitMps2: p.acceleration_limit_mps2 ?? this.flightConfig.accelerationLimitMps2,
              decelerationLimitMps2: p.deceleration_limit_mps2 ?? this.flightConfig.decelerationLimitMps2,
              centerXm: p.center_x_m ?? this.flightConfig.centerXm,
              centerYm: p.center_y_m ?? this.flightConfig.centerYm,
              coverageRadiusKm: p.coverage_radius_km ?? this.flightConfig.coverageRadiusKm,
            });
            const prevKinematics = this.trajectoryEngine.getKinematicsState();
            nextTrajectory = createACNTrajectory(
              nextFlightConfig,
              prevKinematics,
              (x, y) => this.terrainEngine.getElevation(x, y)
            );
            if (p.loiter_speed_mps !== undefined) {
              nextTrajectory.setTargetSpeed(p.loiter_speed_mps, this.simTimeS);
            }
            if (p.acceleration_limit_mps2 !== undefined || p.deceleration_limit_mps2 !== undefined) {
              nextTrajectory.setLimits(p.acceleration_limit_mps2, p.deceleration_limit_mps2);
            }
          } catch (error) {
            return reject(error instanceof Error ? error.message : 'Invalid trajectory configuration.');
          }
        }

        // All validation/construction is complete before any scenario state is changed.
        if (changesTerrain) {
          this.terrainEngine.setTerrainMode(p.terrain_mode);
          this.resampleGroundNodeAltitudes();
        }
        if (p.carrier_freq_ghz !== undefined) this.rfConfig = new RFConfig({ ...this.rfConfig, carrierFrequencyHz: p.carrier_freq_ghz * 1e9 });
        if (p.channel_bandwidth_mhz !== undefined) this.rfConfig = new RFConfig({ ...this.rfConfig, channelBandwidthHz: p.channel_bandwidth_mhz * 1e6 });
        if (p.rain_rate_mmh !== undefined) this.envConfig = new EnvironmentConfig({ ...this.envConfig, rainRateMmH: p.rain_rate_mmh });
        if (nextFlightConfig && nextTrajectory) {
          this.flightConfig = nextFlightConfig;
          this.trajectoryEngine = nextTrajectory;
          if (p.acn_altitude_m !== undefined && this.flightConfig.altitudeMode === 'fix') {
            this.liveAltitudeM = p.acn_altitude_m;
            this.liveVzMps = 0.0;
          }
        }
        if (changesTrajectory || p.coverage_radius_km !== undefined || p.carrier_freq_ghz !== undefined || p.channel_bandwidth_mhz !== undefined || p.rain_rate_mmh !== undefined) {
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
        if (changesTerrain) this.initHillshade(512);
        if (nextTdmaConfig) {
          this.tdmaConfig = nextTdmaConfig;
          this.staticScheduler.setTdmaConfig(this.tdmaConfig);
          this.tacScheduler.setTdmaConfig(this.tdmaConfig);
          this.tdmaAccumulatorS = 0.0;
        }
        if (changesTrajectory || changesTerrain || p.agl_m !== undefined) {
          this.spatialRevision++;
        }
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
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

        this.transferManager.registerNode(nid);

        if (this.selectedNodeId < 0 || !this.nodeRegistry.hasNodeId(this.selectedNodeId)) {
          this.selectedNodeId = nid;
        }

        this.spatialRevision++;
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
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
        this.nodesStatic = this.nodesStatic.filter(n => n.nodeId !== nid);
        this.nodesTac = this.nodesTac.filter(n => n.nodeId !== nid);

        this.staticScheduler.evictNode(nid);
        this.tacScheduler.evictNode(nid);

        this.linkStatuses.delete(nid);
        this.predStates.delete(nid);
        this.obstructionResults.delete(nid);
        this.transferManager.evictNode(nid);

        if (this.selectedNodeId === nid) {
          if (this.nodesTac.length > 0) {
            this.selectedNodeId = this.nodesTac[0].nodeId;
          } else {
            this.selectedNodeId = -1;
          }
        }

        this.spatialRevision++;
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
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

        this.transferManager.registerNode(nid);

        this.spatialRevision++;
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
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
        };
        this.emitHostMessage(res);
        return res;
      }

      case 'NODE_UPDATE': {
        const outcome = NodeLifecycleManager.updateNode({
          msg,
          nodesStatic: this.nodesStatic,
          nodesTac: this.nodesTac,
          nodeRegistry: this.nodeRegistry,
          terrainEngine: this.terrainEngine,
          spatialLocked: this.spatialLocked,
        });
        if (!outcome.accepted) {
          return reject(outcome.reason!);
        }

        if (outcome.spatialChanged) {
          this.spatialRevision++;
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
        };
        this.emitHostMessage(res);
        return res;
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
