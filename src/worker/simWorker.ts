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
import { buildLinkProfile, LinkProfile } from '../core/linkProfile';
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
import { Position3D, TerrainEngine, TerrainObstruction } from '../core/terrain';
import {
  ACNTrajectory,
  createACNTrajectory,
  NodeTerrainState,
  PredictiveLookAheadEngine,
  PredictiveState,
} from '../core/trajectory';

const FRAME_DT = 0.020; // 50 Hz superframe (20 ms)
const THEATER_HALF_M = 600000.0; // 1,200x1,200 km domain (+/- 600 km from center)
const ANTENNA_HEIGHT_M = 2.0;
const NUM_NODES = GROUND_NODE_IDS.length;
const MCP_ID = 15;
const ACN_ID = -1;
const FRESNEL_SAMPLES = 80;
/** Existing profile visualization/clearance factor. This does not alter terrain or link-budget decisions. */
const PROFILE_FRESNEL_FRACTION = 0.6;
const MIN_GROUND_AGL_M = 0;
const MAX_GROUND_AGL_M = 1000;

export interface WorkerCommandResult {
  readonly type: 'COMMAND_RESULT';
  readonly command_type: string;
  readonly accepted: boolean;
  readonly reason?: string;
  readonly spatial_locked: boolean;
  readonly request_id?: string | number;
  readonly trajectory_config?: {
    readonly trajectory_mode: 'ellipse' | 'waypoints';
    readonly center_x_m: number;
    readonly center_y_m: number;
    readonly orbit_a_m: number;
    readonly orbit_b_m: number;
    readonly orbit_rotation_deg: number;
    readonly waypoints: readonly { readonly x_m: number; readonly y_m: number }[];
  };
  readonly obstacle_set?: readonly Obstacle[];
  readonly obstruction_state?: readonly {
    readonly node_id: number;
    readonly terrain_is_los: boolean;
    readonly obstacle_blocked: boolean;
    readonly obstacle_intersections: TerrainObstruction['obstacleIntersections'];
    readonly link_outage: boolean;
    readonly bitrate_bps: number;
    readonly modcod_name: string;
    readonly predicted_state: NodeTerrainState;
    readonly time_to_occlusion_s: number;
    readonly time_to_emergence_s: number;
    readonly is_shadowed: boolean;
  }[];
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

interface NodeTransferState {
  activeType: string | null;
  totalBytes: number;
  deliveredBytes: number;
  droppedBytes: number;
  droppedPackets: number;
  status: 'IDLE' | 'TRANSMITTING' | 'BLOCKED_NLOS' | 'FAILED_DROPPED' | 'ACKNOWLEDGED';
  statusMessage: string;
  startTimeS: number;
  ackTimeS: number;
  lastQueueDrops: number;
}

interface RunningMetrics {
  staticGoodputBits: number;
  tacGoodputBits: number;
  staticWastedBits: number;
  tacWastedBits: number;
  staticDroppedPkts: number;
  tacDroppedPkts: number;
  staticEnqueuedPkts: number;
  tacEnqueuedPkts: number;
  node4PreShadowBacklogKb: number;
  staticNode4PreShadowBacklogKb: number;
  lastStaticUtilPct: number;
  lastTacUtilPct: number;
  staticScheduledUlTimeS: number;
  tacScheduledUlTimeS: number;
  staticAvailableUlTimeS: number;
  tacAvailableUlTimeS: number;
  staticUnusedUlTimeS: number;
  tacUnusedUlTimeS: number;
  staticPayloadBitsDequeued: number;
  tacPayloadBitsDequeued: number;
  staticDelayDropsThisRun: number;
  tacDelayDropsThisRun: number;
  staticOverflowDropsThisRun: number;
  tacOverflowDropsThisRun: number;
  staticFinalBacklogBits: number;
  tacFinalBacklogBits: number;
}

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

  public simTimeS: number = 0.0;
  public frameIndex: number = 0;
  public speed: number = 1.0;
  public isPaused: boolean = false;
  public schedulerMode: string = 'tac_tad';
  public selectedNodeId: number = 4;
  public spatialLocked: boolean = false;

  public nodesStatic: GroundNodeTrafficSubsystem[] = [];
  public nodesTac: GroundNodeTrafficSubsystem[] = [];
  public linkStatuses: Map<number, LinkStatus> = new Map();
  public predStates: Map<number, PredictiveState> = new Map();
  public obstructionResults: Map<number, TerrainObstruction> = new Map();
  public nodeTransfers: Map<number, NodeTransferState> = new Map();

  public metrics: RunningMetrics;
  public hillshadeGrid: number[][] = [];

  private timerId: number | null = null;
  private node4Frozen: boolean = false;
  private lastReportStatic: FrameScheduleReport | null = null;
  private lastReportTac: FrameScheduleReport | null = null;

  constructor(private readonly seedOffset: number = 0) {
    this.rfConfig = new RFConfig();
    this.envConfig = new EnvironmentConfig();
    this.flightConfig = new ACNFlightConfig();
    this.terrainEngine = new TerrainEngine({ theaterExtentM: THEATER_HALF_M, terrainMode: 'real' });
    this.linkEngine = new LinkBudgetEngine();
    this.trajectoryEngine = createACNTrajectory(this.flightConfig);
    this.lookaheadEngine = new PredictiveLookAheadEngine(
      this.terrainEngine,
      this.linkEngine,
      this.rfConfig,
      this.envConfig,
      this.flightConfig,
      this.trajectoryEngine
    );

    this.staticScheduler = new LegacyStaticScheduler();
    this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);

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
    // 16 tactical nodes realistically dispersed in the valley corridor and foothills
    const positions: [number, number][] = [
      [-18000.0, -12000.0], // Node 0: Rifleman
      [-8000.0, -5000.0],   // Node 1: Squad Leader
      [15000.0, -20000.0],  // Node 2: Medic
      [-25000.0, 18000.0],  // Node 3: Scout Alpha
      [12000.0, 8000.0],    // Node 4: Recon Patrol (Occlusion Target)
      [28000.0, 32000.0],   // Node 5: Rifleman
      [-32000.0, -25000.0], // Node 6: Scout Bravo
      [-12000.0, 24000.0],  // Node 7: Designated Marksman
      [22000.0, 12000.0],   // Node 8: Support Gunner
      [35000.0, -15000.0],  // Node 9: Scout Charlie
      [42000.0, -28000.0],  // Node 10: Rifleman
      [-40000.0, 5000.0],   // Node 11: Ammo Carrier
      [8000.0, -14000.0],   // Node 12: Forward Observer
      [18000.0, 22000.0],   // Node 13: RTL Relay
      [-5000.0, 15000.0],   // Node 14: Rifleman
      [-20000.0, -30000.0], // Node 15: Main Command Post (MCP 20W Dish)
    ];

    this.nodesStatic = [];
    this.nodesTac = [];

    for (const i of GROUND_NODE_IDS) {
      const [x, y] = positions[i];
      const z = this.terrainEngine.getElevation(x, y) + ANTENNA_HEIGHT_M;
      const nodeType: NodeType = i === MCP_ID ? 'mcp' : 'soldier';

      const options = {
        hasVoice: i === MCP_ID || i === 4 || i === 1 || i === 2,
        voiceStartS: i === 4 ? 1.0 : 0.0,
        voiceEndS: i === 4 ? 3.8 : 1e6,
        hasVideo: i === MCP_ID || i === 3 || i === 6 || i === 9,
        videoMeanPktsPerFrame: i === MCP_ID ? 2.5 : 0.8,
        hasPhoto: i === 4,
        photoTriggerTimeS: 1.8,
        photoSizeBytes: 240000,
      };

      const staticNode = new GroundNodeTrafficSubsystem(i, nodeType, [x, y, z], 1000 + i + this.seedOffset, options);
      const tacNode = new GroundNodeTrafficSubsystem(i, nodeType, [x, y, z], 1000 + i + this.seedOffset, options);
      staticNode.aglM = ANTENNA_HEIGHT_M;
      tacNode.aglM = ANTENNA_HEIGHT_M;
      this.nodesStatic.push(staticNode);
      this.nodesTac.push(tacNode);
    }
  }

  /** Re-derive each ground node's MSL altitude from the currently active terrain and its AGL. */
  private resampleGroundNodeAltitudes(): void {
    for (const nodes of [this.nodesStatic, this.nodesTac]) {
      for (const node of nodes) {
        const [x, y] = node.position;
        node.position = [x, y, this.terrainEngine.getElevation(x, y) + node.aglM];
      }
    }
  }

  private initTransfers(): void {
    this.nodeTransfers.clear();
    for (let i = 0; i < NUM_NODES; i++) {
      this.nodeTransfers.set(i, {
        activeType: null,
        totalBytes: 0,
        deliveredBytes: 0,
        droppedBytes: 0,
        droppedPackets: 0,
        status: 'IDLE',
        statusMessage: '',
        startTimeS: -1.0,
        ackTimeS: -1.0,
        lastQueueDrops: 0,
      });
    }
  }

  /**
   * Generates a 512x512 shaded relief grid across the expanded 1,200x1,200 km regional domain
   * using true 3D surface normal calculations and Northwest directional Lambertian illumination.
   */
  public initHillshade(gridSize: number = 512): void {
    const size = gridSize;
    const grid: number[][] = [];
    const step = (THEATER_HALF_M * 2) / (size - 1);

    // Northwest Sun Illumination: Azimuth 315°, Altitude 45°
    const lx = -0.5;
    const ly = 0.5;
    const lz = 0.7071;

    // 1. Pre-sample continuous elevations across the 1,200 km theater
    const elevMatrix: Float32Array[] = [];
    for (let r = 0; r < size; r++) {
      const y = THEATER_HALF_M - r * step;
      const row = new Float32Array(size);
      for (let c = 0; c < size; c++) {
        const x = -THEATER_HALF_M + c * step;
        row[c] = this.terrainEngine.getElevation(x, y);
      }
      elevMatrix.push(row);
    }

    // 2. Calculate gradients, surface normals, and Lambertian lighting
    for (let r = 0; r < size; r++) {
      const rowPack: number[] = [];
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(size - 1, r + 1);

      for (let c = 0; c < size; c++) {
        const cPrev = Math.max(0, c - 1);
        const cNext = Math.min(size - 1, c + 1);

        const z = elevMatrix[r][c];
        const dzdx = (elevMatrix[r][cNext] - elevMatrix[r][cPrev]) / ((cNext - cPrev) * step);
        const dzdy = (elevMatrix[rPrev][c] - elevMatrix[rNext][c]) / ((rNext - rPrev) * step);

        // Surface normal N = (-dzdx * exaggeration, -dzdy * exaggeration, 1.0)
        const ex = 2.4;
        const nx = -dzdx * ex;
        const ny = -dzdy * ex;
        const nz = 1.0;
        const lenN = Math.hypot(nx, ny, nz);

        // Dot product N . L
        const dot = (nx * lx + ny * ly + nz * lz) / lenN;
        const shade = Math.max(0.22, Math.min(1.0, 0.44 + 0.56 * dot));

        // Dark-mode tactical military color grading based on altitude
        const tElev = Math.max(0.0, Math.min(1.0, (z - 2800.0) / 3000.0));

        let rBase: number, gBase: number, bBase: number;
        if (tElev < 0.18) {
          // Low valleys: deep charcoal slate
          const t = tElev / 0.18;
          rBase = 14 + t * 6;  gBase = 19 + t * 7;  bBase = 28 + t * 8;
        } else if (tElev < 0.55) {
          // Mid-elevation slopes & ridges: tactical steel
          const t = (tElev - 0.18) / 0.37;
          rBase = 20 + t * 18; gBase = 26 + t * 22; bBase = 36 + t * 28;
        } else if (tElev < 0.85) {
          // High alpine massifs: dark granite
          const t = (tElev - 0.55) / 0.30;
          rBase = 38 + t * 24; gBase = 48 + t * 28; bBase = 64 + t * 34;
        } else {
          // Summit crests (Zanskar, Nun-Kun): subtle frosted peaks
          const t = (tElev - 0.85) / 0.15;
          rBase = 62 + t * 25; gBase = 76 + t * 28; bBase = 98 + t * 32;
        }

        const red = Math.min(255, Math.max(10, Math.floor(rBase * shade)));
        const green = Math.min(255, Math.max(14, Math.floor(gBase * shade)));
        const blue = Math.min(255, Math.max(20, Math.floor(bBase * shade)));

        const packed = (red << 16) | (green << 8) | blue;
        rowPack.push(packed);
      }
      grid.push(rowPack);
    }

    this.hillshadeGrid = grid;
    this.emitHostMessage({
      type: 'HILLSHADE_READY',
      grid_size: size,
      bounds_km: THEATER_HALF_M / 1000,
      data: grid,
      terrain_mode: this.terrainEngine.terrain_mode,
    });
  }

  private emitHostMessage(message: unknown): void {
    // Keep the engine importable in Node-based headless benchmarks.
    if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
      self.postMessage(message);
    }
  }

  public tickSimulation(): void {
    this.simTimeS += FRAME_DT;
    this.frameIndex += 1;
    const t = this.simTimeS;

    const acnPos = this.trajectoryEngine.getAcnPosition(t);

    // Refresh all spatially derived decisions before traffic generation reads isShadowed.
    this.refreshObstructionState(acnPos, t);

    // 1. Generate traffic and prune queues
    for (let i = 0; i < NUM_NODES; i++) {
      const sPkts = this.nodesStatic[i].generateTraffic(t, FRAME_DT);
      const tPkts = this.nodesTac[i].generateTraffic(t, FRAME_DT);
      this.metrics.staticEnqueuedPkts += sPkts.length;
      this.metrics.tacEnqueuedPkts += tPkts.length;

      this.nodesStatic[i].queue.pruneExpiredPackets(t);
      this.nodesTac[i].queue.pruneExpiredPackets(t);
    }

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
    const n4TacKb = this.nodesTac[4].queue.getTotalBacklogBytes() / 1024.0;
    const n4StatKb = this.nodesStatic[4].queue.getTotalBacklogBytes() / 1024.0;

    if (n4Pred?.currentState === NodeTerrainState.NORMAL_LOS || n4Pred?.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
      this.metrics.node4PreShadowBacklogKb = n4TacKb;
      this.metrics.staticNode4PreShadowBacklogKb = n4StatKb;
      this.node4Frozen = false;
    } else if (n4Pred?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF && !this.node4Frozen) {
      this.metrics.node4PreShadowBacklogKb = n4TacKb;
      this.metrics.staticNode4PreShadowBacklogKb = n4StatKb;
      this.node4Frozen = true;
    }

    // 5. Active Transfer Machine
    this.updateTransferStateMachine();

    // 6. Dispatch frame to main UI thread
    const frame = this.buildTelemetryFrame(acnPos);
    this.emitHostMessage({ type: 'TELEMETRY_FRAME', frame });
  }

  /** Recompute spatial decisions only; does not advance time or run traffic/schedulers. */
  private refreshObstructionState(acnPos: [number, number, number], timeS: number): void {
    const nextLinks = new Map<number, LinkStatus>();
    const nextPredictions = new Map<number, PredictiveState>();
    const nextObstructions = new Map<number, TerrainObstruction>();
    const nextShadow: boolean[] = [];
    for (let i = 0; i < NUM_NODES; i++) {
      const node = this.nodesTac[i];
      const obstruction = this.terrainEngine.evaluateTerrainObstruction(node.position, acnPos, this.rfConfig, this.envConfig);
      const prediction = this.lookaheadEngine.evaluatePredictiveState(node.position, timeS);
      const [nx, ny, nz] = node.position;
      const slantM = Math.hypot(acnPos[0] - nx, acnPos[1] - ny, acnPos[2] - nz);
      nextObstructions.set(i, obstruction);
      nextPredictions.set(i, prediction);
      nextLinks.set(i, this.linkEngine.evaluateLink(node.nodeType, slantM, obstruction.diffractionLossDb, this.rfConfig, this.envConfig, obstruction.obstacleBlocked));
      // Traffic-generation shadow is current geometry, independent of a predicted re-emergence label.
      nextShadow[i] = !obstruction.isLos || obstruction.obstacleBlocked;
    }
    // Publish staged results together so no caller can observe a partial node refresh.
    this.linkStatuses.clear(); for (const [id, value] of nextLinks) this.linkStatuses.set(id, value);
    this.predStates.clear(); for (const [id, value] of nextPredictions) this.predStates.set(id, value);
    this.obstructionResults.clear(); for (const [id, value] of nextObstructions) this.obstructionResults.set(id, value);
    for (let i = 0; i < NUM_NODES; i++) {
      this.nodesTac[i].isShadowed = nextShadow[i];
      this.nodesStatic[i].isShadowed = nextShadow[i];
    }
  }

  private getObstructionStateSnapshot(): NonNullable<WorkerCommandResult['obstruction_state']> {
    return this.nodesTac.map(node => {
      const obstruction = this.obstructionResults.get(node.nodeId);
      const link = this.linkStatuses.get(node.nodeId);
      const prediction = this.predStates.get(node.nodeId);
      return {
        node_id: node.nodeId,
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
      };
    });
  }

  private updateTransferStateMachine(): void {
    const qosMap: Record<string, number> = {
      SOS: 69, C2: 69, EMERGENCY: 69,
      VOICE: 65, PTT: 65,
      VIDEO: 67,
      PHOTO: 70, IMAGE: 70,
    };

    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;

    for (const node of activeNodes) {
      const nid = node.nodeId;
      const trans = this.nodeTransfers.get(nid);
      if (!trans || trans.status === 'IDLE' || trans.status === 'ACKNOWLEDGED' || trans.status === 'FAILED_DROPPED') {
        continue;
      }

      const activeT = trans.activeType ?? 'SOS';
      const targetQos = qosMap[activeT] ?? 69;
      const pred = this.predStates.get(nid);
      const currState = pred?.currentState ?? NodeTerrainState.NORMAL_LOS;

      if (currState === NodeTerrainState.HARD_SHADOW_CUTOFF && trans.status === 'TRANSMITTING') {
        trans.status = 'BLOCKED_NLOS';
        trans.statusMessage = 'TERRAIN OCCLUSION: Link severed by ridge. Uplink paused.';
      } else if (currState !== NodeTerrainState.HARD_SHADOW_CUTOFF && trans.status === 'BLOCKED_NLOS') {
        trans.status = 'TRANSMITTING';
        trans.statusMessage = 'RE-EMERGED: Resuming uplink transfer.';
      }

      const currDrops = node.queue.droppedDelayCount + node.queue.droppedOverflowCount;
      const deltaDrops = Math.max(0, currDrops - trans.lastQueueDrops);
      trans.lastQueueDrops = currDrops;

      if (deltaDrops > 0) {
        const avgSz = QOS_PROFILES[targetQos]?.defaultBytes ?? 1200;
        trans.droppedPackets += deltaDrops;
        trans.droppedBytes += deltaDrops * avgSz;
      }

      const ls = this.linkStatuses.get(nid);
      const isOutage = ls?.isOutage ?? true;

      if (!isOutage && trans.status === 'TRANSMITTING') {
        const activeReport = this.schedulerMode === 'tac_tad' ? this.lastReportTac : this.lastReportStatic;
        const alloc = activeReport?.allocations.find((a) => a.nodeId === nid);
        if (alloc && alloc.capacityBits > 0) {
          const bytesServed = Math.floor(alloc.capacityBits / 8);
          trans.deliveredBytes = Math.min(trans.totalBytes, trans.deliveredBytes + bytesServed);

          if (activeT === 'SOS' || activeT === 'C2') {
            trans.status = 'ACKNOWLEDGED';
            trans.ackTimeS = this.simTimeS;
            trans.statusMessage = `[✓] SOS ACKNOWLEDGED BY ACN AT T+${this.simTimeS.toFixed(2)}s`;
          } else if (trans.deliveredBytes >= trans.totalBytes) {
            trans.status = 'ACKNOWLEDGED';
            trans.ackTimeS = this.simTimeS;
            trans.statusMessage = `[✓] ${activeT} FULLY DELIVERED & ACKNOWLEDGED AT T+${this.simTimeS.toFixed(2)}s`;
          }
        }
      }

      const subqLen = node.queue.getClassPacketCount(targetQos);
      if ((trans.status === 'TRANSMITTING' || trans.status === 'BLOCKED_NLOS') && trans.droppedPackets > 0 && subqLen === 0 && trans.deliveredBytes < trans.totalBytes) {
        trans.status = 'FAILED_DROPPED';
        trans.statusMessage = `[✖] ${activeT} FAILED: Packets expired/dropped in mountain shadow!`;
      }
    }
  }

  private buildTelemetryFrame(acnPos: [number, number, number]): any {
    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;
    const [vx, vy] = this.trajectoryEngine.getAcnVelocity(this.simTimeS);

    const nodesTel = activeNodes.map((node) => {
      const ls = this.linkStatuses.get(node.nodeId);
      const ps = this.predStates.get(node.nodeId);
      const q = node.queue;

      const c2Bytes = q.getClassBacklogBytes(69);
      const voiceBytes = q.getClassBacklogBytes(65);
      const videoBytes = q.getClassBacklogBytes(67);
      const photoBytes = q.getClassBacklogBytes(70);

      return {
        node_id: node.nodeId,
        name: node.nodeId === MCP_ID ? 'MCP' : `S${node.nodeId}`,
        node_type: node.nodeType,
        x_m: node.position[0],
        y_m: node.position[1],
        z_m: node.position[2],
        coordinate_reference: 'local Cartesian; x/y metres; z absolute altitude MSL metres',
        terrain_elevation_msl_m: this.terrainEngine.getElevation(node.position[0], node.position[1]),
        agl_m: node.aglM,
        altitude_msl_m: node.position[2],
        slant_range_km: (ls?.slantRangeM ?? 0) / 1000.0,
        snr_db: ls?.snrDb ?? -99.0,
        modcod_name: ls?.modcodName ?? 'LINK_OUTAGE',
        link_outage: ls?.isOutage ?? true,
        bitrate_bps: ls?.bitrateBps ?? 0,
        bitrate_mbps: ls?.bitrateMbps ?? 0,
        state_name: ps?.currentState ?? NodeTerrainState.NORMAL_LOS,
        time_to_occlusion_s: ps?.timeToOcclusionS ?? -1,
        time_to_emergence_s: ps?.timeToEmergenceS ?? -1,
        fresnel_clearance_m: ps?.fresnelClearanceM ?? 0,
        obstacle_blocked: ls?.obstacleBlocked ?? false,
        c2_backlog: q.getClassPacketCount(69),
        voice_backlog: q.getClassPacketCount(65),
        video_backlog: q.getClassPacketCount(67),
        photo_backlog: q.getClassPacketCount(70),
        c2_bytes: c2Bytes,
        voice_bytes: voiceBytes,
        video_bytes: videoBytes,
        photo_bytes: photoBytes,
        total_backlog_bytes: q.getTotalBacklogBytes(),
      };
    });

    // Detect state nodes synchronously so TypeScript tracks types cleanly
    let flushNode: { node: GroundNodeTrafficSubsystem; ps: PredictiveState } | null = null;
    let cutoffNode: { node: GroundNodeTrafficSubsystem; ps: PredictiveState } | null = null;
    let burstNode: { node: GroundNodeTrafficSubsystem; ps: PredictiveState } | null = null;

    for (const node of activeNodes) {
      const ps = this.predStates.get(node.nodeId);
      if (ps) {
        if (ps.currentState === NodeTerrainState.PRE_OCCLUSION_FLUSH && !flushNode) {
          flushNode = { node, ps };
        } else if (ps.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF && !cutoffNode) {
          cutoffNode = { node, ps };
        } else if (ps.currentState === NodeTerrainState.RE_EMERGENCE_BURST && !burstNode) {
          burstNode = { node, ps };
        }
      }
    }

    let narrative = 'NOMINAL PATROL: All terminals in clear Line-of-Sight. ACN coverage bubble tracking along elliptical orbit at FL500 (5,000m).';
    if (flushNode) {
      narrative = `LOOK-AHEAD EVENT: S${flushNode.node.nodeId} predicted to enter mountain shadow in ${flushNode.ps.timeToOcclusionS.toFixed(1)}s. Tac-TAD expanded its slot to evacuate queue backlog before cutoff.`;
    } else if (cutoffNode) {
      narrative = `TERRAIN OUTAGE: S${cutoffNode.node.nodeId} line-of-sight is severed by mountain ridge. Static TDMA is wasting frame time radiating into rock. Tac-TAD reclaims 100% of the slot for other units.`;
    } else if (burstNode) {
      narrative = `RE-EMERGENCE: S${burstNode.node.nodeId} cleared the ridge. Tac-TAD allocated an immediate zero-contention burst to restore tactical comms.`;
    }

    const sg = this.metrics.staticGoodputBits;
    const tg = this.metrics.tacGoodputBits;
    const sw = this.metrics.staticWastedBits;
    const tw = this.metrics.tacWastedBits;
    const sd = this.metrics.staticDroppedPkts;
    const td = this.metrics.tacDroppedPkts;
    const se = Math.max(1, this.metrics.staticEnqueuedPkts);
    const te = Math.max(1, this.metrics.tacEnqueuedPkts);

    const activeReport = this.schedulerMode === 'tac_tad' ? this.lastReportTac : this.lastReportStatic;

    const kpi = {
      static_goodput_mb: sg / 1e6,
      tac_goodput_mb: tg / 1e6,
      gain_multiplier: tg / Math.max(sg, 1.0),
      static_waste_pct: sg + sw > 0 ? (sw / (sg + sw)) * 100.0 : 0.0,
      tac_waste_pct: tg + tw > 0 ? (tw / (tg + tw)) * 100.0 : 0.0,
      static_drops: sd,
      static_drop_pct: (sd / se) * 100.0,
      tac_drops: td,
      tac_drop_pct: (td / te) * 100.0,
      ul_utilization_pct: activeReport?.totalUlUtilizationPct ?? 0,
      node4_pre_shadow_backlog_kb: this.metrics.node4PreShadowBacklogKb,
      static_node4_pre_shadow_backlog_kb: this.metrics.staticNode4PreShadowBacklogKb,
      node4_evac_status: this.getNode4Status(),
    };

    const trans = this.nodeTransfers.get(this.selectedNodeId) ?? {
      activeType: null, totalBytes: 0, deliveredBytes: 0, droppedBytes: 0, droppedPackets: 0,
      status: 'IDLE', statusMessage: '', startTimeS: -1, ackTimeS: -1, lastQueueDrops: 0
    };
    const pct = trans.totalBytes > 0 ? (trans.deliveredBytes / trans.totalBytes) * 100.0 : 0.0;

    const transferTel = {
      node_id: this.selectedNodeId,
      status: trans.status,
      status_message: trans.statusMessage,
      active_type: trans.activeType,
      total_bytes: trans.totalBytes,
      delivered_bytes: trans.deliveredBytes,
      dropped_bytes: trans.droppedBytes,
      dropped_packets: trans.droppedPackets,
      progress_pct: Math.min(100.0, Math.round(pct * 10) / 10),
      start_time_s: trans.startTimeS,
      ack_time_s: trans.ackTimeS,
    };

    const selNode = activeNodes.find((n) => n.nodeId === this.selectedNodeId) ?? activeNodes[0];
    const fresnelSlice = this.buildFresnelSlice(selNode, acnPos);

    const allocations = (activeReport?.allocations ?? []).map((a) => ({
      node_id: a.nodeId,
      start_ms: (a.slotStartS - (this.simTimeS - FRAME_DT)) * 1000.0,
      duration_ms: a.durationS * 1000.0,
      duration_s: a.durationS,
      slot_start_s: a.slotStartS,
      c2_bytes: a.capacityBits > 0 ? 128 : 0,
      voice_bytes: 0,
      video_bytes: 0,
      photo_bytes: 0,
      is_pre_occlusion_flush: a.isPreOcclusionFlush,
    }));

    return {
      frame_index: this.frameIndex,
      sim_time_s: this.simTimeS,
      speed: this.speed,
      paused: this.isPaused,
      spatial_locked: this.spatialLocked,
      trajectory_config: {
        trajectory_mode: this.flightConfig.trajectoryMode,
        center_x_m: this.flightConfig.centerXm,
        center_y_m: this.flightConfig.centerYm,
        orbit_a_m: this.flightConfig.loiterRadiusAM,
        orbit_b_m: this.flightConfig.loiterRadiusBM,
        orbit_rotation_deg: this.flightConfig.loiterRotationDeg,
        waypoints: this.flightConfig.waypoints.map(point => ({ x_m: point.xM, y_m: point.yM })),
      },
      scheduler_mode: this.schedulerMode,
      selected_node_id: this.selectedNodeId,
      plain_english_narrative: narrative,
      acn_telemetry: {
        pos_x: acnPos[0],
        pos_y: acnPos[1],
        pos_z: acnPos[2],
        vel_x: vx,
        vel_y: vy,
        heading_rad: Math.atan2(vy, vx),
        coverage_radius_m: this.flightConfig.coverageRadiusKm * 1000.0,
        coverage_radius_km: this.flightConfig.coverageRadiusKm,
        flight_path: this.computeFlightPath(64),
      },
      nodes_telemetry: nodesTel,
      active_gantt_allocations: allocations,
      comparative_kpi_dashboard: kpi,
      selected_node_fresnel: fresnelSlice,
      transfer_telemetry: transferTel,
      terrain_mode: this.terrainEngine.terrain_mode,
      terrain_bounds_km: THEATER_HALF_M / 1000,
    };
  }

  private getNode4Status(): string {
    const ps = this.predStates.get(4);
    if (!ps) return 'NOMINAL';
    const kb = this.nodesTac[4].queue.getTotalBacklogBytes() / 1024.0;
    switch (ps.currentState) {
      case NodeTerrainState.NORMAL_LOS: return 'NOMINAL';
      case NodeTerrainState.PRE_OCCLUSION_FLUSH: return `EVACUATING ${kb.toFixed(1)} KB`;
      case NodeTerrainState.HARD_SHADOW_CUTOFF: return 'SHADOWED - BUFFERING';
      case NodeTerrainState.RE_EMERGENCE_BURST: return 'BURST RECOVERY';
      default: return 'NOMINAL';
    }
  }

  private buildFresnelSlice(node: GroundNodeTrafficSubsystem, acnPos: [number, number, number]): {
    readonly profile: LinkProfile;
    readonly node_id: number;
    readonly node_name: string;
    readonly distance_km: number;
    readonly clearance_m: number;
    readonly status: string;
    readonly obstructed: boolean;
    readonly diffraction_loss_db: number;
    readonly terrain_is_los: boolean;
    readonly obstacle_blocked: boolean;
    readonly obstacle_intersections: TerrainObstruction['obstacleIntersections'];
    readonly state_name: NodeTerrainState;
    /** @deprecated Compatibility field; x is horizontal ground distance in km. */
    readonly profile_points: readonly [number, number, number, number][];
  } {
    const obstruction = this.obstructionResults.get(node.nodeId)
      ?? this.terrainEngine.evaluateTerrainObstruction(node.position, acnPos, this.rfConfig, this.envConfig);
    const linkProfile = buildLinkProfile({
      selectedGroundNodeId: node.nodeId,
      nodeName: node.nodeId === MCP_ID ? 'MCP' : `S${node.nodeId}`,
      frameIndex: this.frameIndex,
      simulationTimeS: this.simTimeS,
      groundNodePositionMslM: node.position,
      acnPositionMslM: acnPos,
      wavelengthM: this.rfConfig.wavelengthM,
      effectiveEarthRadiusM: this.envConfig.effectiveEarthRadiusM,
      fresnelFraction: PROFILE_FRESNEL_FRACTION,
      sampleCount: FRESNEL_SAMPLES,
      obstruction,
      getTerrainElevationMslM: (xM, yM) => this.terrainEngine.getElevation(xM, yM),
      computeEarthBulgeM: TerrainEngine.computeEarthBulge,
    });
    // Retain the existing tuple shape for the Canvas renderer. Its first coordinate
    // is now explicitly horizontal distance (as required for a ground path profile).
    const profilePoints: [number, number, number, number][] = linkProfile.samples.map(sample => [
      sample.horizontalGroundDistanceM / 1000,
      sample.effectiveTerrainElevationMslM,
      sample.losElevationMslM,
      sample.lowerFresnelElevationMslM,
    ]);
    let obstructed = false;
    let minClearanceM = Number.POSITIVE_INFINITY;
    for (const sample of linkProfile.samples) {
      if (sample.effectiveTerrainElevationMslM > sample.losElevationMslM) obstructed = true;
      const clearance = sample.effectiveTerrainClearanceM;
      if (clearance < minClearanceM) minClearanceM = clearance;
    }

    const ls = this.linkStatuses.get(node.nodeId);
    const ps = this.predStates.get(node.nodeId);

    return {
      profile: linkProfile,
      node_id: node.nodeId,
      node_name: node.nodeId === MCP_ID ? 'MCP' : `S${node.nodeId}`,
      distance_km: linkProfile.slantDistanceM / 1000.0,
      clearance_m: Number.isFinite(minClearanceM) ? minClearanceM : obstruction.minClearanceM,
      status: obstructed ? 'OBSTRUCTED (LINE-OF-SIGHT SEVERED)' : 'CLEAR 1ST FRESNEL ZONE',
      obstructed,
      diffraction_loss_db: ls?.diffractionLossDb ?? 0,
      terrain_is_los: obstruction.isLos,
      obstacle_blocked: ls?.obstacleBlocked ?? false,
      obstacle_intersections: obstruction.obstacleIntersections,
      state_name: ps?.currentState ?? NodeTerrainState.NORMAL_LOS,
      profile_points: profilePoints,
    };
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
    this.initNodes();
    this.initTransfers();
    this.staticScheduler = new LegacyStaticScheduler();
    this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);
    this.simTimeS = 0.0;
    this.frameIndex = 0;
    this.node4Frozen = false;
    this.lastReportStatic = null;
    this.lastReportTac = null;
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

  public handleMessage(msg: any): WorkerCommandResult {
    const type = msg && typeof msg === 'object' ? String(msg.type ?? '').toUpperCase() : 'UNKNOWN';
    const result = (accepted: boolean, reason?: string): WorkerCommandResult => {
      const response: WorkerCommandResult = {
        type: 'COMMAND_RESULT', command_type: type, accepted,
        ...(msg && typeof msg === 'object' && msg.request_id !== undefined ? { request_id: msg.request_id } : {}),
        ...(msg && typeof msg === 'object' && msg.request_id !== undefined ? { trajectory_config: {
          trajectory_mode: this.flightConfig.trajectoryMode,
          center_x_m: this.flightConfig.centerXm,
          center_y_m: this.flightConfig.centerYm,
          orbit_a_m: this.flightConfig.loiterRadiusAM,
          orbit_b_m: this.flightConfig.loiterRadiusBM,
          orbit_rotation_deg: this.flightConfig.loiterRotationDeg,
          waypoints: this.flightConfig.waypoints.map(point => ({ x_m: point.xM, y_m: point.yM })),
        } } : {}),
        ...(type === 'OBSTACLES_REPLACE' ? { obstacle_set: this.terrainEngine.obstacleField.all } : {}),
        ...(type === 'OBSTACLES_REPLACE' ? { obstruction_state: this.getObstructionStateSnapshot() } : {}),
        ...(reason ? { reason } : {}), spatial_locked: this.spatialLocked,
      };
      this.emitHostMessage(response);
      return response;
    };
    const reject = (reason: string) => result(false, reason);
    const locked = () => reject('Spatial lock is enabled; spatial state was not changed.');
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return reject('Command must be an object.');

    switch (type) {
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
        if (!Number.isInteger(nid) || nid < ACN_ID || nid >= NUM_NODES ||
            !isFiniteNumber(xm) || !isFiniteNumber(ym) ||
            Math.abs(xm) > THEATER_HALF_M || Math.abs(ym) > THEATER_HALF_M) {
          return reject('NODE_MOVE requires node_id -1..15 and finite x_m/y_m within the terrain bounds (±600000 m).');
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
          const staticNode = this.nodesStatic[nid], tacNode = this.nodesTac[nid];
          const terrainMsl = this.terrainEngine.getElevation(xm, ym);
          staticNode.position = [xm, ym, terrainMsl + staticNode.aglM];
          tacNode.position = [xm, ym, terrainMsl + tacNode.aglM];
        }
        return result(true);
      }

      case 'LOAD_PRESET': {
        if (typeof msg.preset_id !== 'string') return reject('preset_id must be a string.');
        const pid = msg.preset_id.toUpperCase();
        const isOcclusion = pid === 'PRESET_OCCLUSION';
        const isAmbush = pid === 'PRESET_AMBUSH';
        const isMonsoon = pid === 'PRESET_MONSOON';
        const isReset = pid === 'PRESET_RESET';
        if (!isOcclusion && !isAmbush && !isMonsoon && !isReset) return reject('Unknown preset.');
        if (this.spatialLocked && (isOcclusion || isReset)) return locked();
        if (isOcclusion) {
          const terrainMsl = this.terrainEngine.getElevation(12000.0, 8000.0);
          this.nodesStatic[4].position = [12000.0, 8000.0, terrainMsl + this.nodesStatic[4].aglM];
          this.nodesTac[4].position = [12000.0, 8000.0, terrainMsl + this.nodesTac[4].aglM];
          this.selectedNodeId = 4;
          for (let k = 0; k < 30; k++) {
            this.nodesStatic[4].enqueuePacket(70, this.simTimeS, 1400);
            this.nodesTac[4].enqueuePacket(70, this.simTimeS, 1400);
          }
          this.nodeTransfers.set(4, {
            activeType: 'PHOTO', totalBytes: 42000, deliveredBytes: 0, droppedBytes: 0, droppedPackets: 0,
            status: 'TRANSMITTING', statusMessage: 'PRESET OCCLUSION: Node 4 enqueued 42 KB photo.',
            startTimeS: this.simTimeS, ackTimeS: -1, lastQueueDrops: 0
          });
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
        return result(true);
      }

      case 'INJECT_TRAFFIC': {
        const nid = msg.node_id === undefined ? this.selectedNodeId : msg.node_id;
        if (!Number.isInteger(nid) || nid < 0 || nid >= NUM_NODES) return reject('node_id must identify a registered ground node.');
        const ttype = String(msg.traffic_type ?? 'SOS').toUpperCase();
        let bytes = 2560;
        if (ttype.includes('PHOTO')) bytes = 2000000;
        else if (ttype.includes('VIDEO')) bytes = 42000;
        else if (ttype.includes('VOICE')) bytes = 8000;
        const ps = this.predStates.get(nid);
        const isBlocked = ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF;
        this.nodeTransfers.set(nid, {
          activeType: ttype, totalBytes: bytes, deliveredBytes: 0, droppedBytes: 0, droppedPackets: 0,
          status: isBlocked ? 'BLOCKED_NLOS' : 'TRANSMITTING',
          statusMessage: isBlocked ? 'TERRAIN BLOCKED: Packet buffered awaiting re-emergence.' : 'TRANSMITTING: Uplink active.',
          startTimeS: this.simTimeS, ackTimeS: -1, lastQueueDrops: 0
        });
        this.nodesStatic[nid].injectTraffic(ttype, this.simTimeS);
        this.nodesTac[nid].injectTraffic(ttype, this.simTimeS);
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

      case 'GET_HILLSHADE':
        this.initHillshade(512);
        return result(true);

      case 'CONFIG_UPDATE': {
        const p = msg.params;
        if (!p || typeof p !== 'object' || Array.isArray(p)) return reject('params must be an object.');
        const numericKeys = ['carrier_freq_ghz', 'rain_rate_mmh', 'acn_altitude_m', 'orbit_a_m', 'orbit_b_m',
          'orbit_rotation_deg', 'loiter_speed_mps', 'coverage_radius_km', 'center_x_m', 'center_y_m', 'node_id', 'agl_m'];
        for (const key of numericKeys) {
          if (Object.prototype.hasOwnProperty.call(p, key) && !isFiniteNumber(p[key])) return reject(`${key} must be a finite number.`);
        }
        if (p.terrain_mode !== undefined && p.terrain_mode !== 'real' && p.terrain_mode !== 'synthetic') return reject('terrain_mode must be real or synthetic.');
        if (p.trajectory_mode !== undefined && p.trajectory_mode !== 'ellipse' && p.trajectory_mode !== 'waypoints') return reject('trajectory_mode must be ellipse or waypoints.');
        if (p.carrier_freq_ghz !== undefined && p.carrier_freq_ghz <= 0) return reject('carrier_freq_ghz must be greater than zero.');
        if (p.rain_rate_mmh !== undefined && p.rain_rate_mmh < 0) return reject('rain_rate_mmh cannot be negative.');
        if (p.acn_altitude_m !== undefined && (p.acn_altitude_m <= 0 || p.acn_altitude_m > 100000)) return reject('acn_altitude_m must be in (0, 100000].');
        if (['orbit_a_m', 'orbit_b_m'].some(k => p[k] !== undefined && (p[k] <= 0 || p[k] > THEATER_HALF_M))) return reject('Orbit axes must be in (0, 600000] metres.');
        if (p.orbit_rotation_deg !== undefined && Math.abs(p.orbit_rotation_deg) > 360) return reject('orbit_rotation_deg must be within ±360 degrees.');
        if (p.loiter_speed_mps !== undefined && (p.loiter_speed_mps <= 0 || p.loiter_speed_mps > 1000)) return reject('loiter_speed_mps must be in (0, 1000].');
        if (['center_x_m', 'center_y_m'].some(k => p[k] !== undefined && Math.abs(p[k]) > THEATER_HALF_M)) return reject('Orbit center coordinates must be within ±600000 metres.');
        if (p.coverage_radius_km !== undefined && (p.coverage_radius_km <= 0 || p.coverage_radius_km > 600)) return reject('coverage_radius_km must be in (0, 600].');
        const hasAgl = p.agl_m !== undefined || p.node_id !== undefined;
        if (hasAgl && (p.agl_m === undefined || !Number.isInteger(p.node_id) || p.node_id < 0 || p.node_id >= NUM_NODES)) return reject('AGL updates require a valid ground node_id and agl_m.');
        if (p.agl_m !== undefined && (p.agl_m < MIN_GROUND_AGL_M || p.agl_m > MAX_GROUND_AGL_M)) return reject(`agl_m must be between ${MIN_GROUND_AGL_M} and ${MAX_GROUND_AGL_M} metres.`);

        const nextMode = p.trajectory_mode ?? this.flightConfig.trajectoryMode;
        if (p.waypoints !== undefined && nextMode !== 'waypoints') return reject('waypoints can only be edited while trajectory_mode is explicitly waypoints.');
        let nextWaypoints = this.flightConfig.waypoints;
        if (p.waypoints !== undefined) {
          if (!Array.isArray(p.waypoints)) return reject('waypoints must be an array of {x_m, y_m} points.');
          const parsed: { xM: number; yM: number }[] = [];
          for (let i = 0; i < p.waypoints.length; i++) {
            const point = p.waypoints[i];
            if (!point || typeof point !== 'object' || !isFiniteNumber(point.x_m) || !isFiniteNumber(point.y_m) ||
                Math.abs(point.x_m) > THEATER_HALF_M || Math.abs(point.y_m) > THEATER_HALF_M) {
              return reject(`Waypoint ${i} must have finite x_m/y_m coordinates within ±600000 metres.`);
            }
            parsed.push({ xM: point.x_m, yM: point.y_m });
          }
          if (parsed.length > MAX_ACN_WAYPOINTS) return reject(`waypoints cannot exceed ${MAX_ACN_WAYPOINTS} points.`);
          nextWaypoints = parsed;
        }
        if (nextMode === 'waypoints' && (p.trajectory_mode === 'waypoints' || p.waypoints !== undefined) && nextWaypoints.length < 3) {
          return reject('Switching to waypoint mode requires at least three waypoints.');
        }
        if (nextMode === 'waypoints' && (p.center_x_m !== undefined || p.center_y_m !== undefined)) return reject('center_x_m/center_y_m apply only to ellipse mode.');

        const trajectoryKeys = ['acn_altitude_m', 'orbit_a_m', 'orbit_b_m', 'orbit_rotation_deg', 'loiter_speed_mps', 'center_x_m', 'center_y_m', 'trajectory_mode', 'waypoints'];
        const changesTrajectory = trajectoryKeys.some(k => p[k] !== undefined);
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
              loiterRadiusAM: p.orbit_a_m ?? this.flightConfig.loiterRadiusAM,
              loiterRadiusBM: p.orbit_b_m ?? this.flightConfig.loiterRadiusBM,
              loiterRotationDeg: p.orbit_rotation_deg ?? this.flightConfig.loiterRotationDeg,
              loiterSpeedMps: p.loiter_speed_mps ?? this.flightConfig.loiterSpeedMps,
              centerXm: p.center_x_m ?? this.flightConfig.centerXm,
              centerYm: p.center_y_m ?? this.flightConfig.centerYm,
              coverageRadiusKm: p.coverage_radius_km ?? this.flightConfig.coverageRadiusKm,
            });
            nextTrajectory = createACNTrajectory(nextFlightConfig);
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
        if (p.rain_rate_mmh !== undefined) this.envConfig = new EnvironmentConfig({ ...this.envConfig, rainRateMmH: p.rain_rate_mmh });
        if (nextFlightConfig && nextTrajectory) {
          this.flightConfig = nextFlightConfig;
          this.trajectoryEngine = nextTrajectory;
        }
        if (changesTrajectory || p.coverage_radius_km !== undefined || p.carrier_freq_ghz !== undefined || p.rain_rate_mmh !== undefined) {
          this.lookaheadEngine = new PredictiveLookAheadEngine(
            this.terrainEngine, this.linkEngine, this.rfConfig, this.envConfig, this.flightConfig, this.trajectoryEngine
          );
        }
        if (p.agl_m !== undefined) {
          const nid = p.node_id;
          const terrainMsl = this.terrainEngine.getElevation(this.nodesTac[nid].position[0], this.nodesTac[nid].position[1]);
          this.nodesStatic[nid].aglM = p.agl_m;
          this.nodesTac[nid].aglM = p.agl_m;
          this.nodesStatic[nid].position = [this.nodesStatic[nid].position[0], this.nodesStatic[nid].position[1], terrainMsl + p.agl_m];
          this.nodesTac[nid].position = [this.nodesTac[nid].position[0], this.nodesTac[nid].position[1], terrainMsl + p.agl_m];
        }
        if (changesTerrain) this.initHillshade(512);
        return result(true);
      }

      case 'SIM_CONTROL': {
        const act = typeof msg.action === 'string' ? msg.action.toLowerCase() : '';
        if (!['pause', 'resume', 'step', 'reset'].includes(act)) return reject('action must be pause, resume, step, or reset.');
        if (act === 'reset' && this.spatialLocked) return locked();
        if (act === 'pause') this.isPaused = true;
        else if (act === 'resume') this.isPaused = false;
        else if (act === 'step') { this.isPaused = true; this.tickSimulation(); }
        else this.resetSimulationState();
        return result(true);
      }

      case 'SET_SPEED':
        if (!isFiniteNumber(msg.speed) || msg.speed < 0.05 || msg.speed > 10) return reject('speed must be finite and between 0.05 and 10.');
        this.speed = msg.speed;
        this.restartTimer();
        return result(true);

      case 'SET_SCHEDULER':
        if (msg.mode !== 'tac_tad' && msg.mode !== 'static') return reject('mode must be tac_tad or static.');
        this.schedulerMode = msg.mode;
        return result(true);

      case 'SELECT_NODE':
        if (!Number.isInteger(msg.node_id) || msg.node_id < 0 || msg.node_id >= NUM_NODES) return reject('node_id must identify a registered ground node.');
        this.selectedNodeId = msg.node_id;
        return result(true);

      case 'CLEAR_TRANSFER': {
        const nid = msg.node_id === undefined ? this.selectedNodeId : msg.node_id;
        if (!Number.isInteger(nid) || nid < 0 || nid >= NUM_NODES) return reject('node_id must identify a registered ground node.');
        this.nodeTransfers.set(nid, {
          activeType: null, totalBytes: 0, deliveredBytes: 0, droppedBytes: 0, droppedPackets: 0,
          status: 'IDLE', statusMessage: '', startTimeS: -1, ackTimeS: -1, lastQueueDrops: 0
        });
        return result(true);
      }
      default:
        return reject(`Unsupported command type '${type}'.`);
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
    }
    const intervalMs = Math.max(4, Math.round(20.0 / this.speed));
    this.timerId = setInterval(() => {
      if (!this.isPaused) {
        this.tickSimulation();
      }
    }, intervalMs) as unknown as number;
  }
}

// Instantiate only when executed inside a browser worker. Importing this module
// from Node must not start timers or require Worker globals.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const simWorker = new SimulationWorkerManager();
  void simWorker.start();
  self.onmessage = (event: MessageEvent) => {
    simWorker.handleMessage(event.data);
  };
}
