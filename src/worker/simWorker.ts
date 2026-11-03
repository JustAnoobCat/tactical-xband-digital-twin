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
import {
  Position3D,
  REAL_LADAKH_DEM_METADATA,
  TerrainBoundsTelemetry,
  TerrainEngine,
  TerrainObstruction,
} from '../core/terrain';
import { cartesianToGeodetic } from '../core/geodesy';
import { RollingGoodputTracker } from '../core/rollingGoodput';
import { RegistrationLifecycle } from '../core/registration';
import {
  NodeRegistry,
  createDefault16NodeRegistry,
  GroundNodeEntity,
  formatDeterministicNodeUuid,
  MAX_ACTIVE_GROUND_NODES,
  DEFAULT_ANTENNA_AGL_M,
  NodeTrafficOptions,
} from '../core/nodeRegistry';
import {
  ActiveTransferTelemetry,
  calculateTransferEtaSeconds,
  calculateTransferRateBps,
  smoothTransferRateBps,
} from '../core/transferMetrics';
import {
  ACNTrajectory,
  createACNTrajectory,
  NodeTerrainState,
  PredictiveLookAheadEngine,
  PredictiveState,
} from '../core/trajectory';

export const FRAME_DT = 0.020; // 50 Hz superframe (20 ms)
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
  readonly node_id?: number;
  readonly entity_id?: string;
  readonly deleted_node_id?: number;
  readonly source_node_id?: number;
  readonly creation_sequence?: number;
  readonly nodes_count?: number;
  readonly trajectory_config?: {
    readonly trajectory_mode: 'ellipse' | 'waypoints';
    readonly center_x_m: number;
    readonly center_y_m: number;
    readonly orbit_a_m: number;
    readonly orbit_b_m: number;
    readonly orbit_rotation_deg: number;
    readonly loiter_speed_mps?: number;
    readonly acn_altitude_m?: number;
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
    readonly is_coverage_complete?: boolean;
    readonly coverage_note?: string;
  }[];
}

export interface SelectedLinkBudgetTelemetry {
  readonly node_id: number;
  readonly node_type: NodeType | string;
  readonly slant_range_m: number;
  readonly slant_range_km: number;
  readonly fspl_db: number;
  readonly diffraction_loss_db: number;
  readonly gas_loss_db: number;
  readonly rain_loss_db: number;
  readonly cable_loss_db: number;
  readonly implementation_margin_db: number;
  readonly total_loss_db: number;
  readonly tx_power_dbm: number;
  readonly tx_gain_dbi: number;
  readonly rx_gain_dbi: number;
  readonly prx_dbm: number;
  readonly pnoise_dbm: number;
  readonly snr_db: number;
  readonly modcod_name: string;
  readonly spectral_efficiency_bps_hz: number;
  readonly bitrate_bps: number;
  readonly bitrate_mbps: number;
  readonly is_outage: boolean;
  readonly obstacle_blocked: boolean;
  readonly terrain_is_los: boolean;
  readonly earth_bulge_m: number;
  readonly channel_bandwidth_hz?: number;
  readonly is_coverage_complete?: boolean;
  readonly isCoverageComplete?: boolean;
  readonly coverage_note?: string;
  readonly coverageNote?: string;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

interface NodeTransferState {
  activeType: string | null;
  totalBytes: number;
  deliveredBytes: number;
  prevDeliveredBytes: number;
  droppedBytes: number;
  droppedPackets: number;
  status: 'IDLE' | 'TRANSMITTING' | 'BLOCKED_NLOS' | 'FAILED_DROPPED' | 'ACKNOWLEDGED';
  statusMessage: string;
  startTimeS: number;
  ackTimeS: number;
  lastQueueDrops: number;
  lastUpdateSimTimeS: number;
  currentRateBps: number;
  etaS: number | null;
  etaStatus: string;
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

export interface TelemetryGanttAllocation {
  readonly node_id: number;
  readonly start_ms: number;
  readonly duration_ms: number;
  readonly duration_s: number;
  readonly slot_start_s: number;
  readonly capacity_bits: number;
  readonly modcod_name: string;
  readonly spectral_efficiency: number;
  readonly c2_bytes: number;
  readonly voice_bytes: number;
  readonly video_bytes: number;
  readonly photo_bytes: number;
  readonly is_pre_occlusion_flush: boolean;
  readonly is_out_of_frame?: boolean;
}

/**
 * Normalizes an authoritative SlotAllocation from absolute simulation seconds into
 * current-frame-relative milliseconds [0.0, frameDurationMs), preserving exact duration,
 * node ID, capacity, and pre-occlusion metadata.
 *
 * Emits an explicit diagnostic warning if an allocation falls outside the current frame interval,
 * has non-finite values, or has non-positive duration.
 */
export function normalizeSlotAllocationToFrame(
  a: SlotAllocation,
  frameStartSimTimeS: number,
  frameDurationS: number = FRAME_DT
): TelemetryGanttAllocation {
  const relStartS = a.slotStartS - frameStartSimTimeS;
  const startMs = relStartS * 1000.0;
  const durationMs = a.durationS * 1000.0;
  const endMs = startMs + durationMs;
  const maxFrameMs = frameDurationS * 1000.0;

  // Floating-point tolerance for tiny numerical boundary deviations only (0.1 us)
  const EPSILON = 1e-4;

  // 1. Explicitly diagnose non-finite values
  const isFiniteNumbers =
    Number.isFinite(startMs) &&
    Number.isFinite(durationMs) &&
    Number.isFinite(endMs);

  // 2. Explicitly diagnose zero or negative allocation durations
  const isNonPositiveDuration = !isFiniteNumbers || durationMs <= 0.0;

  // 3. Half-open interval [0, maxFrameMs): slot may end at maxFrameMs, but must not begin at maxFrameMs
  const isOutOfInterval =
    !isFiniteNumbers ||
    startMs < -EPSILON ||
    startMs >= maxFrameMs - EPSILON ||
    endMs > maxFrameMs + EPSILON;

  const isOutOfFrame = !isFiniteNumbers || isNonPositiveDuration || isOutOfInterval;

  if (!isFiniteNumbers) {
    console.warn(
      `[Scheduler Diagnostic] Non-finite allocation timing for node ${a.nodeId}: ` +
      `start_ms=${startMs}, duration_ms=${durationMs}, end_ms=${endMs}`
    );
  } else if (isNonPositiveDuration) {
    console.warn(
      `[Scheduler Diagnostic] Non-positive allocation duration for node ${a.nodeId}: ` +
      `duration_ms=${durationMs.toFixed(3)}ms (must be strictly > 0)`
    );
  } else if (isOutOfInterval) {
    console.warn(
      `[Scheduler Diagnostic] Out-of-frame allocation for node ${a.nodeId}: ` +
      `start=${startMs.toFixed(3)}ms, duration=${durationMs.toFixed(3)}ms, end=${endMs.toFixed(3)}ms ` +
      `(frame interval [0.000, ${maxFrameMs.toFixed(3)}) ms, frameStartSimTimeS=${frameStartSimTimeS.toFixed(4)})`
    );
  }

  return {
    node_id: a.nodeId,
    start_ms: startMs,
    duration_ms: durationMs,
    duration_s: a.durationS,
    slot_start_s: a.slotStartS,
    capacity_bits: a.capacityBits,
    modcod_name: a.modcodName,
    spectral_efficiency: a.spectralEfficiency,
    c2_bytes: a.capacityBits > 0 ? 128 : 0,
    voice_bytes: 0,
    video_bytes: 0,
    photo_bytes: 0,
    is_pre_occlusion_flush: a.isPreOcclusionFlush,
    is_out_of_frame: isOutOfFrame,
  };
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
  public achievedSpeed: number = 1.0;
  public isPaused: boolean = false;
  public activeStepRequestId: number | undefined = undefined;
  public schedulerMode: string = 'tac_tad';
  public selectedNodeId: number = -1;
  public currentScenarioPreset: 'ACN_ONLY' | '16_NODES' = 'ACN_ONLY';
  public spatialLocked: boolean = false;
  public spatialRevision: number = 0;

  public nodeRegistry: NodeRegistry;
  public nodesStatic: GroundNodeTrafficSubsystem[] = [];
  public nodesTac: GroundNodeTrafficSubsystem[] = [];
  public linkStatuses: Map<number, LinkStatus> = new Map();
  public predStates: Map<number, PredictiveState> = new Map();
  public obstructionResults: Map<number, TerrainObstruction> = new Map();
  public nodeTransfers: Map<number, NodeTransferState> = new Map();
  public readonly registrationLifecycle = new RegistrationLifecycle(500);

  public metrics: RunningMetrics;
  public hillshadeGrid: number[][] = [];

  private cachedRealHillshade: { grid: number[][]; demRef: Float32Array | null; size: number } | null = null;
  private cachedSynthHillshade: { grid: number[][]; size: number } | null = null;

  private timerId: number | null = null;
  private simDebtMs: number = 0.0;
  private lastTickRealMs: number = 0.0;
  private lastSpeedMeasureTime: number = 0.0;
  private lastSpeedMeasureSimTime: number = 0.0;
  private node4Frozen: boolean = false;
  private lastReportStatic: FrameScheduleReport | null = null;
  private lastReportTac: FrameScheduleReport | null = null;
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
    this.nodesStatic = [];
    this.nodesTac = [];

    for (const entity of this.nodeRegistry.getAll()) {
      const i = entity.identity.nodeId;
      const [x, y] = entity.position;
      const z = this.terrainEngine.getElevation(x, y) + entity.aglM;

      const staticNode = new GroundNodeTrafficSubsystem(
        i,
        entity.identity.role,
        [x, y, z],
        entity.seed,
        entity.trafficOptions,
        entity.identity
      );
      const tacNode = new GroundNodeTrafficSubsystem(
        i,
        entity.identity.role,
        [x, y, z],
        entity.seed,
        entity.trafficOptions,
        entity.identity
      );
      staticNode.aglM = entity.aglM;
      tacNode.aglM = entity.aglM;
      staticNode.txPowerDbm = entity.txPowerDbm;
      tacNode.txPowerDbm = entity.txPowerDbm;
      staticNode.batteryCapacityMah = entity.batteryCapacityMah ?? (entity.identity.role === 'mcp' ? 20000 : 5000);
      tacNode.batteryCapacityMah = entity.batteryCapacityMah ?? (entity.identity.role === 'mcp' ? 20000 : 5000);
      staticNode.batteryLevelPct = entity.batteryLevelPct ?? 100.0;
      tacNode.batteryLevelPct = entity.batteryLevelPct ?? 100.0;
      staticNode.tacticalPriority = entity.tacticalPriority ?? 1.0;
      tacNode.tacticalPriority = entity.tacticalPriority ?? 1.0;
      staticNode.isDepleted = (entity.batteryLevelPct ?? 100.0) <= 0;
      tacNode.isDepleted = (entity.batteryLevelPct ?? 100.0) <= 0;
      this.nodesStatic.push(staticNode);
      this.nodesTac.push(tacNode);
    }
  }

  /** Re-derive each ground node's MSL altitude from the currently active terrain and its AGL. */
  private resampleGroundNodeAltitudes(): void {
    for (const nodes of [this.nodesStatic, this.nodesTac]) {
      for (const node of nodes) {
        const [x, y] = node.position;
        const elev = this.terrainEngine.getElevation(x, y);
        const groundMsl = Number.isFinite(elev)
          ? elev
          : (Number.isFinite(node.position[2]) ? node.position[2] - node.aglM : 3500);
        node.position = [x, y, groundMsl + node.aglM];
        this.nodeRegistry.updateSpatial(node.nodeId, x, y, node.aglM);
      }
    }
  }

  public getNodeEntity(nodeIdOrEntityId: number | string): GroundNodeEntity | undefined {
    if (typeof nodeIdOrEntityId === 'number') {
      return this.nodeRegistry.getByNodeId(nodeIdOrEntityId);
    }
    return this.nodeRegistry.getByEntityId(nodeIdOrEntityId);
  }

  private initTransfers(): void {
    this.nodeTransfers.clear();
    for (const nid of this.nodeRegistry.getNodeIds()) {
      this.nodeTransfers.set(nid, {
        activeType: null,
        totalBytes: 0,
        deliveredBytes: 0,
        prevDeliveredBytes: 0,
        droppedBytes: 0,
        droppedPackets: 0,
        status: 'IDLE',
        statusMessage: '',
        startTimeS: -1.0,
        ackTimeS: -1.0,
        lastQueueDrops: 0,
        lastUpdateSimTimeS: -1.0,
        currentRateBps: 0,
        etaS: null,
        etaStatus: 'STANDBY',
      });
    }
  }

  /**
   * Generates a shaded relief grid across genuine terrain coverage:
   * - In real DEM mode: uses genuine Ladakh DEM coordinates (+/-91.8 km E-W, +/-110.9 km N-S, aspect ratio ~1.2079),
   *   exact metric ground resolution (dx=359.45m, dy=434.17m), and 512x512 matrix.
   * - In synthetic mode: covers full 1,200x1,200 km regional domain (+/-600 km).
   * Caches results to ensure static terrain is computed once on startup/mode-switch rather than per-frame.
   */
  public initHillshade(gridSize: number = 512): void {
    const size = gridSize;
    const isReal = this.terrainEngine.terrainMode === 'real' && this.terrainEngine.hasRealDem && this.terrainEngine.realDemGrid !== null;
    const bounds = this.terrainEngine.getTerrainBoundsTelemetry();

    // Check cache first to avoid recomputing static DEM hillshades
    if (isReal) {
      if (
        this.cachedRealHillshade &&
        this.cachedRealHillshade.demRef === this.terrainEngine.realDemGrid &&
        this.cachedRealHillshade.size === size
      ) {
        this.hillshadeGrid = this.cachedRealHillshade.grid;
        this.emitHostMessage({
          type: 'HILLSHADE_READY',
          grid_size: size,
          bounds_km: bounds.halfWidthM / 1000.0,
          bounds,
          data: this.hillshadeGrid,
          terrain_mode: this.terrainEngine.terrain_mode,
        });
        return;
      }
    } else {
      if (
        this.cachedSynthHillshade &&
        this.cachedSynthHillshade.size === size
      ) {
        this.hillshadeGrid = this.cachedSynthHillshade.grid;
        this.emitHostMessage({
          type: 'HILLSHADE_READY',
          grid_size: size,
          bounds_km: bounds.halfWidthM / 1000.0,
          bounds,
          data: this.hillshadeGrid,
          terrain_mode: this.terrainEngine.terrain_mode,
        });
        return;
      }
    }

    const meta = this.terrainEngine.demMetadata ?? REAL_LADAKH_DEM_METADATA;
    const stepX = isReal ? (bounds.maxX - bounds.minX) / (size - 1) : (THEATER_HALF_M * 2.0) / (size - 1);
    const stepY = isReal ? (bounds.maxY - bounds.minY) / (size - 1) : (THEATER_HALF_M * 2.0) / (size - 1);

    // Northwest Sun Illumination: Azimuth 315°, Altitude 45°
    const lx = -0.5;
    const ly = 0.5;
    const lz = 0.7071;

    // 1. Pre-sample continuous elevations across genuine coverage domain
    const elevMatrix: Float32Array[] = [];
    if (isReal && size === meta.rasterWidth && meta.rasterHeight === 512 && this.terrainEngine.realDemGrid && this.terrainEngine.realDemGrid.length === size * size) {
      // Direct access from point-registered satellite DEM raster (zero interpolation overhead)
      const realGrid = this.terrainEngine.realDemGrid;
      for (let r = 0; r < size; r++) {
        const row = new Float32Array(size);
        const offset = r * size;
        for (let c = 0; c < size; c++) {
          row[c] = realGrid[offset + c];
        }
        elevMatrix.push(row);
      }
    } else if (isReal) {
      for (let r = 0; r < size; r++) {
        const y = bounds.maxY - r * stepY;
        const row = new Float32Array(size);
        for (let c = 0; c < size; c++) {
          const x = bounds.minX + c * stepX;
          const val = this.terrainEngine.getElevation(x, y);
          row[c] = Number.isFinite(val) ? val : (meta.minElevationM ?? 0);
        }
        elevMatrix.push(row);
      }
    } else {
      // Synthetic procedural terrain across full 1,200 km regional domain
      for (let r = 0; r < size; r++) {
        const y = THEATER_HALF_M - r * stepY;
        const row = new Float32Array(size);
        for (let c = 0; c < size; c++) {
          const x = -THEATER_HALF_M + c * stepX;
          row[c] = this.terrainEngine.getElevation(x, y);
        }
        elevMatrix.push(row);
      }
    }

    // 2. Calculate gradients, surface normals, and Lambertian lighting
    const grid: number[][] = [];
    for (let r = 0; r < size; r++) {
      const rowPack: number[] = [];
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(size - 1, r + 1);

      for (let c = 0; c < size; c++) {
        const cPrev = Math.max(0, c - 1);
        const cNext = Math.min(size - 1, c + 1);

        const z = elevMatrix[r][c];

        // Explicit invalid / out-of-coverage handling: if elevation is NaN or non-finite, emit transparent/invalid pixel (0)
        if (!Number.isFinite(z)) {
          rowPack.push(0);
          continue;
        }

        // Compute x-gradient with NaN-safe finite difference
        let dzdx = 0.0;
        const zCNext = elevMatrix[r][cNext];
        const zCPrev = elevMatrix[r][cPrev];
        if (Number.isFinite(zCNext) && Number.isFinite(zCPrev) && cNext !== cPrev) {
          dzdx = (zCNext - zCPrev) / ((cNext - cPrev) * stepX);
        } else if (Number.isFinite(zCNext) && cNext !== c) {
          dzdx = (zCNext - z) / ((cNext - c) * stepX);
        } else if (Number.isFinite(zCPrev) && c !== cPrev) {
          dzdx = (z - zCPrev) / ((c - cPrev) * stepX);
        }

        // Compute y-gradient with NaN-safe finite difference
        // Note: rPrev is North (+Y) of rNext (South -Y), so (elev[rPrev] - elev[rNext]) / ((rNext - rPrev) * stepY)
        let dzdy = 0.0;
        const zRPrev = elevMatrix[rPrev][c];
        const zRNext = elevMatrix[rNext][c];
        if (Number.isFinite(zRPrev) && Number.isFinite(zRNext) && rNext !== rPrev) {
          dzdy = (zRPrev - zRNext) / ((rNext - rPrev) * stepY);
        } else if (Number.isFinite(zRPrev) && r !== rPrev) {
          dzdy = (zRPrev - z) / ((r - rPrev) * stepY);
        } else if (Number.isFinite(zRNext) && rNext !== r) {
          dzdy = (z - zRNext) / ((rNext - r) * stepY);
        }

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

    // Cache generated hillshade
    if (isReal) {
      this.cachedRealHillshade = {
        grid,
        demRef: this.terrainEngine.realDemGrid,
        size,
      };
    } else {
      this.cachedSynthHillshade = {
        grid,
        size,
      };
    }

    this.hillshadeGrid = grid;
    this.emitHostMessage({
      type: 'HILLSHADE_READY',
      grid_size: size,
      bounds_km: bounds.halfWidthM / 1000.0,
      bounds,
      data: grid,
      terrain_mode: this.terrainEngine.terrain_mode,
    });
  }

  public getTerrainBounds(): TerrainBoundsTelemetry {
    return this.terrainEngine.getTerrainBoundsTelemetry();
  }

  private emitHostMessage(message: unknown, transferList?: Transferable[]): void {
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
    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;
    const selNode = activeNodes.find((n) => n.nodeId === this.selectedNodeId) ?? activeNodes[0];
    const acnPos = this.trajectoryEngine.getAcnPosition(this.simTimeS);
    const fresnelSlice = this.buildFresnelSlice(selNode, acnPos);
    this.emitHostMessage({
      type: 'PROFILE_FRAME',
      selectedNodeId: this.selectedNodeId,
      profileSerial: ++this.profileSerial,
      spatial_revision: this.spatialRevision,
      fresnel: fresnelSlice,
      selected_link_budget: fresnelSlice.link_budget,
      nodes_telemetry: this.buildNodesTelemetry(),
    });
  }

  public tickSimulation(emitTelemetry: boolean = true): void {
    this.simTimeS += FRAME_DT;
    this.frameIndex += 1;
    const t = this.simTimeS;

    const acnPos = this.trajectoryEngine.getAcnPosition(t);

    // Refresh all spatially derived decisions before traffic generation reads isShadowed.
    this.refreshObstructionState(acnPos, t);

    // 1. Generate traffic and prune queues
    for (let i = 0; i < this.nodesStatic.length; i++) {
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

    // Rolling goodput sampling (M7.3: 200 superframes / 4 seconds of completed payload delivery)
    this.staticGoodputTracker.recordSuperframeDeliveredBits(reportStatic.totalBitsTransmitted);
    this.tacGoodputTracker.recordSuperframeDeliveredBits(reportTac.totalBitsTransmitted);

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
      const tIdleS = Math.max(0.0, FRAME_DT - tTxS);
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

    // 5. Active Transfer Machine
    this.updateTransferStateMachine();

    // 6. Dispatch frame to main UI thread
    if (emitTelemetry) {
      const frame = this.buildTelemetryFrame(acnPos);
      this.emitHostMessage({ type: 'TELEMETRY_FRAME', frame });
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
      const prediction = this.lookaheadEngine.evaluatePredictiveState(node.position, timeS);
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
      if (!trans || trans.status === 'IDLE') {
        continue;
      }

      if (trans.status === 'ACKNOWLEDGED' || trans.status === 'FAILED_DROPPED') {
        trans.currentRateBps = 0;
        trans.etaS = trans.status === 'ACKNOWLEDGED' ? 0 : null;
        trans.etaStatus = trans.status === 'ACKNOWLEDGED' ? 'COMPLETE' : 'DROPPED';
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

      // Update transfer rate and ETA strictly using simulation-time differences
      const dtSim = trans.lastUpdateSimTimeS >= 0 ? Math.max(0.001, this.simTimeS - trans.lastUpdateSimTimeS) : FRAME_DT;
      const deliveredDelta = Math.max(0, trans.deliveredBytes - trans.prevDeliveredBytes);
      trans.prevDeliveredBytes = trans.deliveredBytes;
      trans.lastUpdateSimTimeS = this.simTimeS;

      if (trans.status === 'TRANSMITTING') {
        const instRate = calculateTransferRateBps(deliveredDelta, dtSim);
        trans.currentRateBps = smoothTransferRateBps(trans.currentRateBps, instRate, 0.3);
      } else {
        trans.currentRateBps = 0;
      }

      const remaining = Math.max(0, trans.totalBytes - trans.deliveredBytes);
      const eta = calculateTransferEtaSeconds(remaining, trans.currentRateBps, trans.status, this.isPaused);
      trans.etaS = eta.etaS;
      trans.etaStatus = eta.etaStatus;
    }
  }

  public buildNodesTelemetry(): any[] {
    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;
    const acnPos = this.trajectoryEngine.getAcnPosition(this.simTimeS);
    return activeNodes.map((node) => {
      const obstruction = this.obstructionResults.get(node.nodeId)
        ?? this.terrainEngine.evaluateTerrainObstruction(node.position, acnPos, this.rfConfig, this.envConfig);
      const [nx, ny, nz] = node.position;
      const geo = cartesianToGeodetic(nx, ny);
      const slantM = Math.hypot(acnPos[0] - nx, acnPos[1] - ny, acnPos[2] - nz);
      const ls = this.linkStatuses.get(node.nodeId)
        ?? this.linkEngine.evaluateLink(node.nodeType, slantM, obstruction.diffractionLossDb, this.rfConfig, this.envConfig, obstruction.obstacleBlocked, node.txPowerDbm);
      const ps = this.predStates.get(node.nodeId);
      const q = node.queue;

      const c2Bytes = q.getClassBacklogBytes(69);
      const voiceBytes = q.getClassBacklogBytes(65);
      const videoBytes = q.getClassBacklogBytes(67);
      const photoBytes = q.getClassBacklogBytes(70);

      const activeReport = this.schedulerMode === 'tac_tad' ? this.lastReportTac : this.lastReportStatic;
      const alloc = activeReport?.allocations.find((a) => a.nodeId === node.nodeId);
      const trans = this.nodeTransfers.get(node.nodeId);
      const isOutage = ls?.isOutage ?? true;
      const isObstacleBlocked = ls?.obstacleBlocked ?? false;
      const isTerrainBlocked = !(obstruction?.isLos ?? true);
      const isBlocked = isTerrainBlocked || isObstacleBlocked;
      const isHardShadow = ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF;
      const hasSlotCapacity = alloc !== undefined && alloc.capacityBits > 0 && alloc.durationS > 0;
      const isTransmitting = !isOutage && !isBlocked && !isHardShadow && (
        (trans !== undefined && trans.status === 'TRANSMITTING') ||
        (hasSlotCapacity && q.getTotalBacklogBytes() > 0)
      );
      const isWastingAirtime = Boolean(hasSlotCapacity && (isOutage || isBlocked || isHardShadow));

      const transRemaining = trans ? Math.max(0, trans.totalBytes - trans.deliveredBytes) : 0;
      const transEta = trans ? calculateTransferEtaSeconds(transRemaining, trans.currentRateBps, trans.status, this.isPaused) : { etaS: null, etaStatus: 'STANDBY' };

      const transState = trans && trans.status !== 'IDLE' ? {
        node_id: node.nodeId,
        status: trans.status,
        status_message: trans.statusMessage,
        active_type: trans.activeType,
        total_bytes: trans.totalBytes,
        delivered_bytes: trans.deliveredBytes,
        dropped_bytes: trans.droppedBytes,
        dropped_packets: trans.droppedPackets,
        progress_pct: trans.totalBytes > 0 ? Math.min(100.0, Math.round(((trans.deliveredBytes / trans.totalBytes) * 100.0) * 10) / 10) : 0.0,
        start_time_s: trans.startTimeS,
        ack_time_s: trans.ackTimeS,
        current_rate_bps: trans.currentRateBps,
        current_rate_mbps: trans.currentRateBps / 1e6,
        eta_s: transEta.etaS,
        eta_status: transEta.etaStatus,
      } : null;

      const regEntity = this.nodeRegistry.getByNodeId(node.nodeId);
      const registration = this.registrationLifecycle.get(node.nodeId);
      const callsign = regEntity?.identity.callsign ?? node.identity?.callsign ?? (node.nodeId === MCP_ID ? 'MCP' : `S${node.nodeId}`);

      return {
        node_id: node.nodeId,
        entity_id: node.entityId,
        creation_sequence: node.creationSequence,
        name: callsign,
        node_type: node.nodeType,
        x_m: node.position[0],
        y_m: node.position[1],
        z_m: node.position[2],
        lat_deg: geo.latDeg,
        lon_deg: geo.lonDeg,
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
        terrain_is_los: obstruction?.isLos ?? true,
        diffraction_loss_db: ls?.diffractionLossDb ?? obstruction?.diffractionLossDb ?? 0,
        state_name: ps?.currentState ?? NodeTerrainState.NORMAL_LOS,
        time_to_occlusion_s: ps?.timeToOcclusionS ?? -1,
        time_to_emergence_s: ps?.timeToEmergenceS ?? -1,
        fresnel_clearance_m: ps?.fresnelClearanceM ?? 0,
        obstacle_blocked: ls?.obstacleBlocked ?? false,
        is_coverage_complete: obstruction?.isCoverageComplete ?? true,
        isCoverageComplete: obstruction?.isCoverageComplete ?? true,
        coverage_note: obstruction?.coverageNote,
        coverageNote: obstruction?.coverageNote,
        c2_backlog: q.getClassPacketCount(69),
        voice_backlog: q.getClassPacketCount(65),
        video_backlog: q.getClassPacketCount(67),
        photo_backlog: q.getClassPacketCount(70),
        c2_bytes: c2Bytes,
        voice_bytes: voiceBytes,
        video_bytes: videoBytes,
        photo_bytes: photoBytes,
        total_backlog_bytes: q.getTotalBacklogBytes(),
        is_transmitting: isTransmitting,
        is_wasting_airtime: isWastingAirtime,
        allocated_slot_ms: (alloc?.durationS ?? 0) * 1000.0,
        allocated_capacity_bits: alloc?.capacityBits ?? 0,
        transfer_state: transState,
        color_hex: regEntity?.identity.colorHex ?? node.identity?.colorHex ?? (node.nodeType === 'mcp' ? '#f59e0b' : '#38bdf8'),
        tx_power_dbm: node.txPowerDbm ?? (node.nodeType === 'mcp' ? 43.0 : 36.0),
        battery_capacity_mah: node.batteryCapacityMah ?? (node.nodeType === 'mcp' ? 20000 : 5000),
        battery_level_pct: Number((node.batteryLevelPct ?? 100.0).toFixed(1)),
        tactical_priority: node.tacticalPriority ?? 1.0,
        is_depleted: node.batteryLevelPct <= 0 || node.isDepleted,
        registration_state: registration.state,
        registration_start_time_s: registration.start_time_s,
        registration_completion_time_s: registration.completion_time_s,
        registration_elapsed_s: registration.start_time_s === null ? null : Math.max(0, this.simTimeS - registration.start_time_s),
        communication_eligible: registration.state === 'REGISTERED',
      };
    });
  }

  private buildTelemetryFrame(acnPos: [number, number, number]): any {
    const activeNodes = this.schedulerMode === 'tac_tad' ? this.nodesTac : this.nodesStatic;
    const [vx, vy] = this.trajectoryEngine.getAcnVelocity(this.simTimeS);

    const nodesTel = this.buildNodesTelemetry();

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

    let narrative = activeNodes.length === 0
      ? 'ACN RELAY STANDBY: Operational loiter orbit active. Zero ground terminals currently deployed. Ready for dynamic terminal deployment.'
      : 'NOMINAL PATROL: All terminals in clear Line-of-Sight. ACN coverage bubble tracking along elliptical orbit at FL500 (5,000m).';
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

    const staticDropDelayThisFrame = this.lastReportStatic?.packetsDroppedDelayThisFrame ?? 0;
    const staticDropOverflowThisFrame = this.lastReportStatic?.packetsDroppedOverflowThisFrame ?? 0;
    const staticDropTotalThisFrame = staticDropDelayThisFrame + staticDropOverflowThisFrame;

    const tacDropDelayThisFrame = this.lastReportTac?.packetsDroppedDelayThisFrame ?? 0;
    const tacDropOverflowThisFrame = this.lastReportTac?.packetsDroppedOverflowThisFrame ?? 0;
    const tacDropTotalThisFrame = tacDropDelayThisFrame + tacDropOverflowThisFrame;

    const activeDropDelayThisFrame = this.schedulerMode === 'tac_tad' ? tacDropDelayThisFrame : staticDropDelayThisFrame;
    const activeDropOverflowThisFrame = this.schedulerMode === 'tac_tad' ? tacDropOverflowThisFrame : staticDropOverflowThisFrame;
    const activeDropTotalThisFrame = this.schedulerMode === 'tac_tad' ? tacDropTotalThisFrame : staticDropTotalThisFrame;

    const activeGoodputBitsThisFrame = this.schedulerMode === 'tac_tad'
      ? (this.lastReportTac?.totalBitsTransmitted ?? 0)
      : (this.lastReportStatic?.totalBitsTransmitted ?? 0);
    const activeWastedBitsThisFrame = this.schedulerMode === 'tac_tad'
      ? (this.lastReportTac?.totalBitsWastedOnOutage ?? 0)
      : (this.lastReportStatic?.totalBitsWastedOnOutage ?? 0);

    const selStaticNode = this.nodesStatic.find(n => n.nodeId === this.selectedNodeId);
    const selTacNode = this.nodesTac.find(n => n.nodeId === this.selectedNodeId);
    const staticSelectedBacklogKb = selStaticNode
      ? selStaticNode.queue.getTotalBacklogBytes() / 1024.0
      : null;
    const tacSelectedBacklogKb = selTacNode
      ? selTacNode.queue.getTotalBacklogBytes() / 1024.0
      : null;

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
      static_selected_backlog_kb: staticSelectedBacklogKb,
      tac_selected_backlog_kb: tacSelectedBacklogKb,

      // Exact per-frame scheduler metrics (purely additive):
      static_goodput_frame_bits: this.lastReportStatic?.totalBitsTransmitted ?? 0,
      tac_goodput_frame_bits: this.lastReportTac?.totalBitsTransmitted ?? 0,
      active_goodput_frame_bits: activeGoodputBitsThisFrame,
      static_wasted_frame_bits: this.lastReportStatic?.totalBitsWastedOnOutage ?? 0,
      tac_wasted_frame_bits: this.lastReportTac?.totalBitsWastedOnOutage ?? 0,
      active_wasted_frame_bits: activeWastedBitsThisFrame,
      static_drop_delay_frame_pkts: staticDropDelayThisFrame,
      static_drop_overflow_frame_pkts: staticDropOverflowThisFrame,
      static_drop_frame_pkts: staticDropTotalThisFrame,
      tac_drop_delay_frame_pkts: tacDropDelayThisFrame,
      tac_drop_overflow_frame_pkts: tacDropOverflowThisFrame,
      tac_drop_frame_pkts: tacDropTotalThisFrame,
      active_drop_delay_frame_pkts: activeDropDelayThisFrame,
      active_drop_overflow_frame_pkts: activeDropOverflowThisFrame,
      active_drop_frame_pkts: activeDropTotalThisFrame,
      static_utilization_pct: this.lastReportStatic?.totalUlUtilizationPct ?? 0,
      tac_utilization_pct: this.lastReportTac?.totalUlUtilizationPct ?? 0,

      // Rolling P50/P95 goodput statistics in bps (M7.3)
      static_p50_bps: this.staticGoodputTracker.p50Bps,
      static_p95_bps: this.staticGoodputTracker.p95Bps,
      tac_p50_bps: this.tacGoodputTracker.p50Bps,
      tac_p95_bps: this.tacGoodputTracker.p95Bps,
      rolling_window_sample_count: this.staticGoodputTracker.sampleCount,
      rolling_window_capacity: this.staticGoodputTracker.capacity,
    };

    const trans = this.nodeTransfers.get(this.selectedNodeId) ?? {
      activeType: null, totalBytes: 0, deliveredBytes: 0, prevDeliveredBytes: 0, droppedBytes: 0, droppedPackets: 0,
      status: 'IDLE', statusMessage: '', startTimeS: -1, ackTimeS: -1, lastQueueDrops: 0,
      lastUpdateSimTimeS: -1, currentRateBps: 0, etaS: null, etaStatus: 'STANDBY'
    };
    const pct = trans.totalBytes > 0 ? (trans.deliveredBytes / trans.totalBytes) * 100.0 : 0.0;

    const transRemaining = Math.max(0, trans.totalBytes - trans.deliveredBytes);
    const transEta = calculateTransferEtaSeconds(transRemaining, trans.currentRateBps, trans.status, this.isPaused);

    const transferTel: ActiveTransferTelemetry = {
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
      current_rate_bps: trans.currentRateBps,
      current_rate_mbps: trans.currentRateBps / 1e6,
      eta_s: transEta.etaS,
      eta_status: transEta.etaStatus,
    };

    const activeTransfers: ActiveTransferTelemetry[] = [];
    for (const [nid, t] of this.nodeTransfers.entries()) {
      if (t.status !== 'IDLE') {
        const p = t.totalBytes > 0 ? (t.deliveredBytes / t.totalBytes) * 100.0 : 0.0;
        const tRemaining = Math.max(0, t.totalBytes - t.deliveredBytes);
        const tEta = calculateTransferEtaSeconds(tRemaining, t.currentRateBps, t.status, this.isPaused);
        activeTransfers.push({
          node_id: nid,
          status: t.status,
          status_message: t.statusMessage,
          active_type: t.activeType,
          total_bytes: t.totalBytes,
          delivered_bytes: t.deliveredBytes,
          dropped_bytes: t.droppedBytes,
          dropped_packets: t.droppedPackets,
          progress_pct: Math.min(100.0, Math.round(p * 10) / 10),
          start_time_s: t.startTimeS,
          ack_time_s: t.ackTimeS,
          current_rate_bps: t.currentRateBps,
          current_rate_mbps: t.currentRateBps / 1e6,
          eta_s: tEta.etaS,
          eta_status: tEta.etaStatus,
        });
      }
    }

    const selNode = activeNodes.find((n) => n.nodeId === this.selectedNodeId) ?? activeNodes[0];
    const fresnelSlice = this.buildFresnelSlice(selNode, acnPos);

    const mapAlloc = (a: SlotAllocation) => normalizeSlotAllocationToFrame(a, this.simTimeS, FRAME_DT);

    const allocations = (activeReport?.allocations ?? []).map(mapAlloc);
    const acnGeo = cartesianToGeodetic(acnPos[0], acnPos[1]);

    return {
      frame_index: this.frameIndex,
      sim_time_s: this.simTimeS,
      speed: this.speed,
      target_speed: this.speed,
      achieved_speed: this.isPaused ? 0.0 : (this.achievedSpeed > 0 ? this.achievedSpeed : this.speed),
      paused: this.isPaused,
      step_request_id: this.activeStepRequestId,
      spatial_locked: this.spatialLocked,
      spatial_revision: this.spatialRevision,
      trajectory_config: {
        trajectory_mode: this.flightConfig.trajectoryMode,
        center_x_m: this.flightConfig.centerXm,
        center_y_m: this.flightConfig.centerYm,
        orbit_a_m: this.flightConfig.loiterRadiusAM,
        orbit_b_m: this.flightConfig.loiterRadiusBM,
        orbit_rotation_deg: this.flightConfig.loiterRotationDeg,
        loiter_speed_mps: this.flightConfig.loiterSpeedMps,
        current_speed_mps: this.trajectoryEngine.getCurrentSpeed(this.simTimeS),
        acn_altitude_m: this.flightConfig.altitudeMslM,
        waypoints: this.flightConfig.waypoints.map(point => ({ x_m: point.xM, y_m: point.yM })),
      },
      scheduler_mode: this.schedulerMode,
      selected_node_id: this.selectedNodeId,
      plain_english_narrative: narrative,
      acn_telemetry: {
        pos_x: acnPos[0],
        pos_y: acnPos[1],
        pos_z: acnPos[2],
        lat_deg: acnGeo.latDeg,
        lon_deg: acnGeo.lonDeg,
        vel_x: vx,
        vel_y: vy,
        heading_rad: Math.atan2(vy, vx),
        current_speed_mps: this.trajectoryEngine.getCurrentSpeed(this.simTimeS),
        target_speed_mps: this.flightConfig.loiterSpeedMps,
        acceleration_limit_mps2: this.flightConfig.accelerationLimitMps2,
        deceleration_limit_mps2: this.flightConfig.decelerationLimitMps2,
        coverage_radius_m: this.flightConfig.coverageRadiusKm * 1000.0,
        coverage_radius_km: this.flightConfig.coverageRadiusKm,
        flight_path: this.computeFlightPath(64),
      },
      nodes_telemetry: nodesTel,
      registration_telemetry: { nodes: this.registrationLifecycle.active(), events: this.registrationLifecycle.events() },
      active_gantt_allocations: allocations,
      static_gantt_allocations: (this.lastReportStatic?.allocations ?? []).map(mapAlloc),
      tac_gantt_allocations: (this.lastReportTac?.allocations ?? []).map(mapAlloc),
      comparative_kpi_dashboard: kpi,
      static_p50_bps: this.staticGoodputTracker.p50Bps,
      static_p95_bps: this.staticGoodputTracker.p95Bps,
      tac_p50_bps: this.tacGoodputTracker.p50Bps,
      tac_p95_bps: this.tacGoodputTracker.p95Bps,
      selected_node_fresnel: fresnelSlice,
      selected_link_budget: fresnelSlice.link_budget,
      transfer_telemetry: transferTel,
      active_transfers: activeTransfers,
      downlink_telemetry: {
        is_control_broadcast: true,
        ctrl_duration_ms: 1.0,
        dl_duration_ms: (this.schedulerMode === 'tac_tad' && this.lastReportTac ? Math.max(3.0, 20.0 - 1.0 - (this.lastReportTac.totalUlAvailableS * 1000.0)) : 3.0),
        broadcast_active: true,
      },
      terrain_mode: this.terrainEngine.terrain_mode,
      terrain_bounds_km: this.terrainEngine.terrain_mode === 'real'
        ? REAL_LADAKH_DEM_METADATA.halfWidthM / 1000
        : THEATER_HALF_M / 1000,
      terrain_bounds: this.terrainEngine.getTerrainBoundsTelemetry(),
    };
  }

  private getNode4Status(): string {
    const ps = this.predStates.get(4);
    if (!ps) return 'NOMINAL';
    const node4 = this.nodesTac.find((n) => n.nodeId === 4);
    if (!node4) return 'NOMINAL';
    const kb = node4.queue.getTotalBacklogBytes() / 1024.0;
    switch (ps.currentState) {
      case NodeTerrainState.NORMAL_LOS: return 'NOMINAL';
      case NodeTerrainState.PRE_OCCLUSION_FLUSH: return `EVACUATING ${kb.toFixed(1)} KB`;
      case NodeTerrainState.HARD_SHADOW_CUTOFF: return 'SHADOWED - BUFFERING';
      case NodeTerrainState.RE_EMERGENCE_BURST: return 'BURST RECOVERY';
      default: return 'NOMINAL';
    }
  }

  private buildSelectedLinkBudget(
    node: GroundNodeTrafficSubsystem,
    ls: LinkStatus | undefined,
    obstruction: TerrainObstruction | undefined
  ): SelectedLinkBudgetTelemetry {
    const slantM = ls?.slantRangeM ?? 0;
    const earthBulgeM = TerrainEngine.computeEarthBulge(
      slantM / 2.0,
      slantM / 2.0,
      this.envConfig.effectiveEarthRadiusM
    );
    return {
      node_id: node.nodeId,
      node_type: node.nodeType,
      slant_range_m: slantM,
      slant_range_km: slantM / 1000.0,
      fspl_db: ls?.fsplDb ?? 0,
      diffraction_loss_db: ls?.diffractionLossDb ?? obstruction?.diffractionLossDb ?? 0,
      gas_loss_db: ls?.gasLossDb ?? 0,
      rain_loss_db: ls?.rainLossDb ?? 0,
      cable_loss_db: ls?.cableLossDb ?? 0,
      implementation_margin_db: ls?.implementationMarginDb ?? 0,
      total_loss_db: ls?.totalLossDb ?? 0,
      tx_power_dbm: ls?.pTxDbm ?? 0,
      tx_gain_dbi: ls?.txGainDbi ?? 0,
      rx_gain_dbi: ls?.rxGainDbi ?? 0,
      prx_dbm: ls?.prxDbm ?? 0,
      pnoise_dbm: ls?.pNoiseDbm ?? 0,
      snr_db: ls?.snrDb ?? -99.0,
      modcod_name: ls?.modcodName ?? 'LINK_OUTAGE',
      spectral_efficiency_bps_hz: ls?.spectralEfficiency ?? 0,
      bitrate_bps: ls?.bitrateBps ?? 0,
      bitrate_mbps: ls?.bitrateMbps ?? 0,
      is_outage: ls?.isOutage ?? true,
      obstacle_blocked: ls?.obstacleBlocked ?? false,
      terrain_is_los: obstruction?.isLos ?? true,
      earth_bulge_m: earthBulgeM,
      channel_bandwidth_hz: this.rfConfig.channelBandwidthHz,
      is_coverage_complete: obstruction?.isCoverageComplete ?? true,
      isCoverageComplete: obstruction?.isCoverageComplete ?? true,
      coverage_note: obstruction?.coverageNote,
      coverageNote: obstruction?.coverageNote,
    };
  }

  private buildFresnelSlice(node: GroundNodeTrafficSubsystem | undefined, acnPos: [number, number, number]): {
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
    readonly link_budget: SelectedLinkBudgetTelemetry;
    readonly is_coverage_complete?: boolean;
    readonly coverage_note?: string;
  } {
    if (!node) {
      return {
        profile: {
          selectedGroundNodeId: -1,
          nodeName: 'NONE',
          frameIndex: this.frameIndex,
          simulationTimeS: this.simTimeS,
          groundNodePositionMslM: [0, 0, 0],
          acnPositionMslM: acnPos,
          horizontalGroundDistanceM: 0,
          slantDistanceM: 0,
          fresnelFraction: PROFILE_FRESNEL_FRACTION,
          terrainIsLos: true,
          terrainMinimumClearanceM: 0,
          terrainCriticalFresnelRadiusM: 0,
          diffractionLossDb: 0,
          obstacleBlocked: false,
          obstacleIntervals: [],
          samples: [],
          valid: false,
          isCoverageComplete: false,
          invalidReason: 'No ground nodes registered in scenario.',
        },
        node_id: -1,
        node_name: 'NONE',
        distance_km: 0,
        clearance_m: 0,
        status: 'NO_NODES_REGISTERED',
        obstructed: false,
        diffraction_loss_db: 0,
        terrain_is_los: true,
        obstacle_blocked: false,
        obstacle_intersections: [],
        state_name: NodeTerrainState.NORMAL_LOS,
        profile_points: [],
        link_budget: {
          node_id: -1,
          node_type: 'soldier',
          slant_range_m: 0,
          slant_range_km: 0,
          fspl_db: 0,
          diffraction_loss_db: 0,
          gas_loss_db: 0,
          rain_loss_db: 0,
          cable_loss_db: 0,
          implementation_margin_db: 0,
          total_loss_db: 0,
          tx_power_dbm: 0,
          tx_gain_dbi: 0,
          rx_gain_dbi: 0,
          prx_dbm: 0,
          pnoise_dbm: 0,
          snr_db: -99.0,
          modcod_name: 'LINK_OUTAGE',
          spectral_efficiency_bps_hz: 0,
          bitrate_bps: 0,
          bitrate_mbps: 0,
          is_outage: true,
          obstacle_blocked: false,
          terrain_is_los: true,
          earth_bulge_m: 0,
          is_coverage_complete: false,
          coverage_note: 'No ground nodes registered in scenario.',
        },
        is_coverage_complete: false,
        coverage_note: 'No ground nodes registered in scenario.',
      };
    }

    const obstruction = this.obstructionResults.get(node.nodeId)
      ?? this.terrainEngine.evaluateTerrainObstruction(node.position, acnPos, this.rfConfig, this.envConfig);
    const regEntity = this.nodeRegistry.getByNodeId(node.nodeId);
    const resolvedName = regEntity?.identity.callsign ?? node.identity?.callsign ?? (node.nodeId === MCP_ID ? 'MCP' : `S${node.nodeId}`);
    const linkProfile = buildLinkProfile({
      selectedGroundNodeId: node.nodeId,
      nodeName: resolvedName,
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

    const ls = this.linkStatuses.get(node.nodeId)
      ?? this.linkEngine.evaluateLink(node.nodeType, linkProfile.slantDistanceM, obstruction.diffractionLossDb, this.rfConfig, this.envConfig, obstruction.obstacleBlocked, node.txPowerDbm);
    const ps = this.predStates.get(node.nodeId);
    const linkBudget = this.buildSelectedLinkBudget(node, ls, obstruction);

    const isCoverageComplete = obstruction.isCoverageComplete !== false && linkProfile.valid;

    return {
      profile: linkProfile,
      node_id: node.nodeId,
      node_name: resolvedName,
      distance_km: linkProfile.slantDistanceM / 1000.0,
      clearance_m: isCoverageComplete
        ? (Number.isFinite(minClearanceM) ? minClearanceM : obstruction.minClearanceM)
        : Number.NaN,
      status: !isCoverageComplete
        ? 'UNAVAILABLE: PATH EXTENDS OUTSIDE DEM COVERAGE'
        : (obstructed ? 'OBSTRUCTED (LINE-OF-SIGHT SEVERED)' : 'CLEAR 1ST FRESNEL ZONE'),
      obstructed: isCoverageComplete ? obstructed : false,
      diffraction_loss_db: ls?.diffractionLossDb ?? obstruction.diffractionLossDb,
      terrain_is_los: obstruction.isLos,
      obstacle_blocked: ls?.obstacleBlocked ?? false,
      obstacle_intersections: obstruction.obstacleIntersections,
      state_name: ps?.currentState ?? NodeTerrainState.NORMAL_LOS,
      profile_points: profilePoints,
      link_budget: linkBudget,
      is_coverage_complete: isCoverageComplete,
      coverage_note: obstruction.coverageNote ?? linkProfile.invalidReason,
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
    this.speed = 1.0;
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
    this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);
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
          loiter_speed_mps: this.flightConfig.loiterSpeedMps,
          acn_altitude_m: this.flightConfig.altitudeMslM,
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
          this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);
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
          this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);
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
          this.nodeTransfers.set(4, {
            activeType: 'PHOTO', totalBytes: 42000, deliveredBytes: 0, prevDeliveredBytes: 0, droppedBytes: 0, droppedPackets: 0,
            status: 'TRANSMITTING', statusMessage: 'PRESET OCCLUSION: Node 4 enqueued 42 KB photo.',
            startTimeS: this.simTimeS, ackTimeS: -1, lastQueueDrops: 0,
            lastUpdateSimTimeS: this.simTimeS, currentRateBps: 0, etaS: null, etaStatus: 'CALCULATING'
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
        let bytes = 2560;
        if (ttype.includes('PHOTO')) bytes = 2000000;
        else if (ttype.includes('VIDEO')) bytes = 42000;
        else if (ttype.includes('VOICE')) bytes = 8000;
        const ps = this.predStates.get(nid);
        const isBlocked = ps?.currentState === NodeTerrainState.HARD_SHADOW_CUTOFF;
        this.nodeTransfers.set(nid, {
          activeType: ttype, totalBytes: bytes, deliveredBytes: 0, prevDeliveredBytes: 0, droppedBytes: 0, droppedPackets: 0,
          status: isBlocked ? 'BLOCKED_NLOS' : 'TRANSMITTING',
          statusMessage: isBlocked ? 'TERRAIN BLOCKED: Packet buffered awaiting re-emergence.' : 'TRANSMITTING: Uplink active.',
          startTimeS: this.simTimeS, ackTimeS: -1, lastQueueDrops: 0,
          lastUpdateSimTimeS: this.simTimeS, currentRateBps: 0, etaS: null, etaStatus: isBlocked ? 'BLOCKED (PAUSED)' : 'CALCULATING'
        });
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
        if (!elevations || (!(elevations instanceof Float32Array) && !(elevations.buffer instanceof ArrayBuffer))) {
          return reject('elevations must be Float32Array or ArrayBuffer.');
        }

        const success = this.terrainEngine.loadCustomDem(elevations, metadata);
        if (!success) {
          return reject('Failed to load custom DEM into terrain engine.');
        }

        this.cachedRealHillshade = null;
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
        const isReal = this.terrainEngine.terrainMode === 'real' && this.terrainEngine.hasRealDem && this.terrainEngine.realDemGrid !== null;
        const bounds = this.getTerrainBounds();
        const gridSize = 512;
        const transferGrid = new Float32Array(gridSize * gridSize);

        let minElev = Number.POSITIVE_INFINITY;
        let maxElev = Number.NEGATIVE_INFINITY;

        if (isReal && this.terrainEngine.realDemGrid && this.terrainEngine.realDemGrid.length === gridSize * gridSize) {
          // Direct 512x512 copy
          transferGrid.set(this.terrainEngine.realDemGrid);
          for (let i = 0; i < transferGrid.length; i++) {
            const v = transferGrid[i];
            if (Number.isFinite(v)) {
              if (v < minElev) minElev = v;
              if (v > maxElev) maxElev = v;
            }
          }
        } else {
          // Synthetic procedural mode or custom resolution DEM: sample 512x512 matrix over bounds
          const stepX = (bounds.maxX - bounds.minX) / 511.0;
          const stepY = (bounds.maxY - bounds.minY) / 511.0;
          for (let r = 0; r < gridSize; r++) {
            const yM = bounds.maxY - r * stepY; // Row 0 is North (+Y)
            for (let c = 0; c < gridSize; c++) {
              const xM = bounds.minX + c * stepX; // Col 0 is West (-X)
              const v = this.terrainEngine.getElevation(xM, yM);
              const val = Number.isFinite(v) ? v : 0;
              transferGrid[r * gridSize + c] = val;
              if (val < minElev) minElev = val;
              if (val > maxElev) maxElev = val;
            }
          }
        }

        const payload = {
          type: 'TERRAIN_MESH_DATA_READY',
          request_id: msg.request_id,
          terrain_mode: this.terrainEngine.terrainMode,
          bounds,
          grid_size: gridSize,
          min_elevation_m: isFinite(minElev) ? minElev : 0,
          max_elevation_m: isFinite(maxElev) ? maxElev : 5000,
          elevations: transferGrid,
        };

        // Transfer ownership of transferGrid.buffer ONLY
        this.emitHostMessage(payload, [transferGrid.buffer]);
        return result(true);
      }

      case 'SET_PARAMS':
      case 'CONFIG_UPDATE': {
        const p = (msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)) ? msg.params : msg;
        if (!p || typeof p !== 'object' || Array.isArray(p)) return reject('params must be an object.');
        const numericKeys = ['carrier_freq_ghz', 'channel_bandwidth_mhz', 'rain_rate_mmh', 'acn_altitude_m', 'orbit_a_m', 'orbit_b_m',
          'orbit_rotation_deg', 'loiter_speed_mps', 'acceleration_limit_mps2', 'deceleration_limit_mps2', 'coverage_radius_km', 'center_x_m', 'center_y_m', 'node_id', 'agl_m'];
        for (const key of numericKeys) {
          if (Object.prototype.hasOwnProperty.call(p, key) && !isFiniteNumber(p[key])) return reject(`${key} must be a finite number.`);
        }
        if (p.terrain_mode !== undefined && p.terrain_mode !== 'real' && p.terrain_mode !== 'synthetic') return reject('terrain_mode must be real or synthetic.');
        if (p.trajectory_mode !== undefined && p.trajectory_mode !== 'ellipse' && p.trajectory_mode !== 'waypoints') return reject('trajectory_mode must be ellipse or waypoints.');
        if (p.carrier_freq_ghz !== undefined && p.carrier_freq_ghz <= 0) return reject('carrier_freq_ghz must be greater than zero.');
        if (p.channel_bandwidth_mhz !== undefined && (p.channel_bandwidth_mhz < 0.1 || p.channel_bandwidth_mhz > 50.0)) return reject('channel_bandwidth_mhz must be between 0.1 and 50.0 MHz.');
        if (p.rain_rate_mmh !== undefined && p.rain_rate_mmh < 0) return reject('rain_rate_mmh cannot be negative.');
        if (p.acn_altitude_m !== undefined && (p.acn_altitude_m <= 0 || p.acn_altitude_m > 100000)) return reject('acn_altitude_m must be in (0, 100000].');
        if (['orbit_a_m', 'orbit_b_m'].some(k => p[k] !== undefined && (p[k] <= 0 || p[k] > THEATER_HALF_M))) return reject('Orbit axes must be in (0, 600000] metres.');
        if (p.orbit_rotation_deg !== undefined && Math.abs(p.orbit_rotation_deg) > 360) return reject('orbit_rotation_deg must be within ±360 degrees.');
        if (p.loiter_speed_mps !== undefined && (p.loiter_speed_mps < 0 || p.loiter_speed_mps > 1000)) return reject('loiter_speed_mps must be in [0, 1000].');
        if (p.acceleration_limit_mps2 !== undefined && (p.acceleration_limit_mps2 <= 0 || p.acceleration_limit_mps2 > 50)) return reject('acceleration_limit_mps2 must be in (0, 50].');
        if (p.deceleration_limit_mps2 !== undefined && (p.deceleration_limit_mps2 <= 0 || p.deceleration_limit_mps2 > 50)) return reject('deceleration_limit_mps2 must be in (0, 50].');
        if (['center_x_m', 'center_y_m'].some(k => p[k] !== undefined && Math.abs(p[k]) > THEATER_HALF_M)) return reject('Orbit center coordinates must be within ±600000 metres.');
        if (p.coverage_radius_km !== undefined && (p.coverage_radius_km <= 0 || p.coverage_radius_km > 600)) return reject('coverage_radius_km must be in (0, 600].');
        const hasAgl = p.agl_m !== undefined || p.node_id !== undefined;
        if (hasAgl && (p.agl_m === undefined || !Number.isInteger(p.node_id) || !this.nodeRegistry.hasNodeId(p.node_id))) return reject('AGL updates require a valid ground node_id and agl_m.');
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

        const trajectoryKeys = ['acn_altitude_m', 'orbit_a_m', 'orbit_b_m', 'orbit_rotation_deg', 'loiter_speed_mps', 'acceleration_limit_mps2', 'deceleration_limit_mps2', 'center_x_m', 'center_y_m', 'trajectory_mode', 'waypoints'];
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
              accelerationLimitMps2: p.acceleration_limit_mps2 ?? this.flightConfig.accelerationLimitMps2,
              decelerationLimitMps2: p.deceleration_limit_mps2 ?? this.flightConfig.decelerationLimitMps2,
              centerXm: p.center_x_m ?? this.flightConfig.centerXm,
              centerYm: p.center_y_m ?? this.flightConfig.centerYm,
              coverageRadiusKm: p.coverage_radius_km ?? this.flightConfig.coverageRadiusKm,
            });
            const prevKinematics = this.trajectoryEngine.getKinematicsState();
            nextTrajectory = createACNTrajectory(nextFlightConfig, prevKinematics);
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
        }
        if (changesTrajectory || p.coverage_radius_km !== undefined || p.carrier_freq_ghz !== undefined || p.channel_bandwidth_mhz !== undefined || p.rain_rate_mmh !== undefined) {
          this.lookaheadEngine = new PredictiveLookAheadEngine(
            this.terrainEngine, this.linkEngine, this.rfConfig, this.envConfig, this.flightConfig, this.trajectoryEngine
          );
        }
        if (p.agl_m !== undefined) {
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
        if (!isFiniteNumber(msg.speed) || msg.speed < 0.1 || msg.speed > 10) return reject('speed must be finite and between 0.1 and 10.');
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
        this.nodeTransfers.set(nid, {
          activeType: null, totalBytes: 0, deliveredBytes: 0, prevDeliveredBytes: 0, droppedBytes: 0, droppedPackets: 0,
          status: 'IDLE', statusMessage: '', startTimeS: -1, ackTimeS: -1, lastQueueDrops: 0,
          lastUpdateSimTimeS: -1, currentRateBps: 0, etaS: null, etaStatus: 'STANDBY'
        });
        return result(true);
      }

      case 'NODE_ADD': {
        if (this.spatialLocked) return locked();
        if (this.nodeRegistry.size >= MAX_ACTIVE_GROUND_NODES) {
          return reject(`Maximum active ground-node capacity (${MAX_ACTIVE_GROUND_NODES}) reached.`);
        }
        const xm = msg.x_m !== undefined ? msg.x_m : 0.0;
        const ym = msg.y_m !== undefined ? msg.y_m : 0.0;
        const aglM = msg.agl_m !== undefined ? msg.agl_m : DEFAULT_ANTENNA_AGL_M;
        if (!isFiniteNumber(xm) || !isFiniteNumber(ym) || Math.abs(xm) > THEATER_HALF_M || Math.abs(ym) > THEATER_HALF_M) {
          return reject('NODE_ADD requires finite x_m and y_m coordinates within theater bounds (±600000 m).');
        }
        if (!isFiniteNumber(aglM) || aglM < MIN_GROUND_AGL_M || aglM > MAX_GROUND_AGL_M) {
          return reject(`NODE_ADD requires agl_m between ${MIN_GROUND_AGL_M} and ${MAX_GROUND_AGL_M} metres.`);
        }
        if (msg.role !== undefined && msg.role !== 'soldier' && msg.role !== 'mcp') {
          return reject("role must be 'soldier' or 'mcp'.");
        }
        if (msg.callsign !== undefined && (typeof msg.callsign !== 'string' || msg.callsign.trim().length === 0)) {
          return reject('callsign must be a non-empty string.');
        }
        if (msg.tx_power_dbm !== undefined && (!isFiniteNumber(msg.tx_power_dbm) || msg.tx_power_dbm < 10.0 || msg.tx_power_dbm > 50.0)) {
          return reject('tx_power_dbm must be a finite number between 10.0 and 50.0 dBm.');
        }
        if (msg.battery_capacity_mah !== undefined && (!isFiniteNumber(msg.battery_capacity_mah) || msg.battery_capacity_mah < 100.0 || msg.battery_capacity_mah > 500000.0)) {
          return reject('battery_capacity_mah must be a finite number between 100.0 and 500000.0 mAh.');
        }
        if (msg.battery_level_pct !== undefined && (!isFiniteNumber(msg.battery_level_pct) || msg.battery_level_pct < 0.0 || msg.battery_level_pct > 100.0)) {
          return reject('battery_level_pct must be a finite number between 0.0 and 100.0 percent.');
        }
        if (msg.tactical_priority !== undefined && (!isFiniteNumber(msg.tactical_priority) || msg.tactical_priority < 0.1 || msg.tactical_priority > 5.0)) {
          return reject('tactical_priority must be a finite number between 0.1 and 5.0.');
        }
        if (msg.color_hex !== undefined && (typeof msg.color_hex !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(msg.color_hex.trim()))) {
          return reject('color_hex must be a valid hex color code (e.g. #38bdf8).');
        }

        const role: NodeType = msg.role ?? 'soldier';
        const entity = this.nodeRegistry.createDynamicNode({
          callsign: msg.callsign ? msg.callsign.trim() : undefined,
          role,
          position: [xm, ym],
          aglM,
          trafficOptions: msg.traffic_options,
          colorHex: msg.color_hex ? msg.color_hex.trim() : undefined,
          txPowerDbm: msg.tx_power_dbm,
          batteryCapacityMah: msg.battery_capacity_mah,
          batteryLevelPct: msg.battery_level_pct,
          tacticalPriority: msg.tactical_priority,
        });

        const nid = entity.identity.nodeId;
        this.registrationLifecycle.add(nid, this.simTimeS);
        const terrainMsl = this.terrainEngine.getElevation(xm, ym);
        const z = terrainMsl + aglM;

        const staticNode = new GroundNodeTrafficSubsystem(
          nid,
          role,
          [xm, ym, z],
          entity.seed,
          entity.trafficOptions,
          entity.identity
        );
        const tacNode = new GroundNodeTrafficSubsystem(
          nid,
          role,
          [xm, ym, z],
          entity.seed,
          entity.trafficOptions,
          entity.identity
        );
        staticNode.aglM = aglM;
        tacNode.aglM = aglM;
        staticNode.txPowerDbm = entity.txPowerDbm;
        tacNode.txPowerDbm = entity.txPowerDbm;
        staticNode.batteryCapacityMah = entity.batteryCapacityMah ?? (entity.identity.role === 'mcp' ? 20000 : 5000);
        tacNode.batteryCapacityMah = entity.batteryCapacityMah ?? (entity.identity.role === 'mcp' ? 20000 : 5000);
        staticNode.batteryLevelPct = entity.batteryLevelPct ?? 100.0;
        tacNode.batteryLevelPct = entity.batteryLevelPct ?? 100.0;
        staticNode.tacticalPriority = entity.tacticalPriority ?? 1.0;
        tacNode.tacticalPriority = entity.tacticalPriority ?? 1.0;
        staticNode.isDepleted = (entity.batteryLevelPct ?? 100.0) <= 0;
        tacNode.isDepleted = (entity.batteryLevelPct ?? 100.0) <= 0;
        this.nodesStatic.push(staticNode);
        this.nodesTac.push(tacNode);

        this.nodeTransfers.set(nid, {
          activeType: null, totalBytes: 0, deliveredBytes: 0, prevDeliveredBytes: 0, droppedBytes: 0, droppedPackets: 0,
          status: 'IDLE', statusMessage: '', startTimeS: -1, ackTimeS: -1, lastQueueDrops: 0,
          lastUpdateSimTimeS: -1, currentRateBps: 0, etaS: null, etaStatus: 'STANDBY'
        });

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
          entity_id: entity.identity.entityId,
          creation_sequence: entity.identity.creationSequence,
          nodes_count: this.nodeRegistry.size,
          spatial_locked: this.spatialLocked,
          request_id: msg.request_id,
        };
        this.emitHostMessage(res);
        return res;
      }

      case 'NODE_DELETE': {
        if (this.spatialLocked) return locked();
        const nid = msg.node_id;
        if (!Number.isInteger(nid) || !this.nodeRegistry.hasNodeId(nid)) {
          return reject('node_id must identify an active registered ground node.');
        }

        this.nodeRegistry.unregister(nid);
        this.registrationLifecycle.remove(nid, this.simTimeS);
        this.nodesStatic = this.nodesStatic.filter(n => n.nodeId !== nid);
        this.nodesTac = this.nodesTac.filter(n => n.nodeId !== nid);

        this.staticScheduler.evictNode(nid);
        this.tacScheduler.evictNode(nid);

        this.linkStatuses.delete(nid);
        this.predStates.delete(nid);
        this.obstructionResults.delete(nid);
        this.nodeTransfers.delete(nid);

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
        if (this.spatialLocked) return locked();
        if (this.nodeRegistry.size >= MAX_ACTIVE_GROUND_NODES) {
          return reject(`Maximum active ground-node capacity (${MAX_ACTIVE_GROUND_NODES}) reached.`);
        }
        const srcId = msg.source_node_id;
        if (!Number.isInteger(srcId) || !this.nodeRegistry.hasNodeId(srcId)) {
          return reject('source_node_id must identify an active registered ground node.');
        }
        const src = this.nodeRegistry.getByNodeId(srcId);
        if (!src) return reject('Source node entity could not be retrieved.');

        const dx = isFiniteNumber(msg.offset_x_m) ? msg.offset_x_m : 500.0;
        const dy = isFiniteNumber(msg.offset_y_m) ? msg.offset_y_m : 500.0;
        const newX = src.position[0] + dx;
        const newY = src.position[1] + dy;

        if (Math.abs(newX) > THEATER_HALF_M || Math.abs(newY) > THEATER_HALF_M) {
          return reject('Duplicated node coordinates fall outside theater bounds (±600000 m).');
        }

        const callsign = msg.callsign && typeof msg.callsign === 'string' && msg.callsign.trim().length > 0
          ? msg.callsign.trim()
          : `${src.identity.callsign}_copy`;

        const entity = this.nodeRegistry.createDynamicNode({
          callsign,
          role: src.identity.role,
          position: [newX, newY],
          aglM: src.aglM,
          trafficOptions: { ...src.trafficOptions },
          colorHex: src.identity.colorHex,
        });

        const nid = entity.identity.nodeId;
        this.registrationLifecycle.add(nid, this.simTimeS);
        const terrainMsl = this.terrainEngine.getElevation(newX, newY);
        const z = terrainMsl + src.aglM;

        const staticNode = new GroundNodeTrafficSubsystem(
          nid,
          entity.identity.role,
          [newX, newY, z],
          entity.seed,
          entity.trafficOptions,
          entity.identity
        );
        const tacNode = new GroundNodeTrafficSubsystem(
          nid,
          entity.identity.role,
          [newX, newY, z],
          entity.seed,
          entity.trafficOptions,
          entity.identity
        );
        staticNode.aglM = src.aglM;
        tacNode.aglM = src.aglM;
        this.nodesStatic.push(staticNode);
        this.nodesTac.push(tacNode);

        this.nodeTransfers.set(nid, {
          activeType: null, totalBytes: 0, deliveredBytes: 0, prevDeliveredBytes: 0, droppedBytes: 0, droppedPackets: 0,
          status: 'IDLE', statusMessage: '', startTimeS: -1, ackTimeS: -1, lastQueueDrops: 0,
          lastUpdateSimTimeS: -1, currentRateBps: 0, etaS: null, etaStatus: 'STANDBY'
        });

        this.spatialRevision++;
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.emitProfileFrame();

        const res: WorkerCommandResult = {
          type: 'COMMAND_RESULT',
          command_type: 'NODE_DUPLICATE',
          accepted: true,
          node_id: nid,
          entity_id: entity.identity.entityId,
          source_node_id: srcId,
          creation_sequence: entity.identity.creationSequence,
          nodes_count: this.nodeRegistry.size,
          spatial_locked: this.spatialLocked,
          request_id: msg.request_id,
        };
        this.emitHostMessage(res);
        return res;
      }

      case 'NODE_UPDATE': {
        const nid = msg.node_id;
        if (!Number.isInteger(nid) || !this.nodeRegistry.hasNodeId(nid)) {
          return reject('node_id must identify an active registered ground node.');
        }

        const changesSpatial = msg.x_m !== undefined || msg.y_m !== undefined || msg.agl_m !== undefined;
        if (this.spatialLocked && changesSpatial) return locked();

        const staticNode = this.nodesStatic.find(n => n.nodeId === nid);
        const tacNode = this.nodesTac.find(n => n.nodeId === nid);
        const entity = this.nodeRegistry.getByNodeId(nid);
        if (!staticNode || !tacNode || !entity) return reject('Target node was not found.');

        if (msg.x_m !== undefined && (!isFiniteNumber(msg.x_m) || Math.abs(msg.x_m) > THEATER_HALF_M)) {
          return reject('x_m must be a finite number within theater bounds (±600000 m).');
        }
        if (msg.y_m !== undefined && (!isFiniteNumber(msg.y_m) || Math.abs(msg.y_m) > THEATER_HALF_M)) {
          return reject('y_m must be a finite number within theater bounds (±600000 m).');
        }
        if (msg.agl_m !== undefined && (!isFiniteNumber(msg.agl_m) || msg.agl_m < MIN_GROUND_AGL_M || msg.agl_m > MAX_GROUND_AGL_M)) {
          return reject(`agl_m must be between ${MIN_GROUND_AGL_M} and ${MAX_GROUND_AGL_M} metres.`);
        }
        if (msg.role !== undefined && msg.role !== 'soldier' && msg.role !== 'mcp') {
          return reject("role must be 'soldier' or 'mcp'.");
        }
        if (msg.callsign !== undefined && (typeof msg.callsign !== 'string' || msg.callsign.trim().length === 0)) {
          return reject('callsign must be a non-empty string.');
        }
        if (msg.tx_power_dbm !== undefined && (!isFiniteNumber(msg.tx_power_dbm) || msg.tx_power_dbm < 10.0 || msg.tx_power_dbm > 50.0)) {
          return reject('tx_power_dbm must be a finite number between 10.0 and 50.0 dBm.');
        }
        if (msg.battery_capacity_mah !== undefined && (!isFiniteNumber(msg.battery_capacity_mah) || msg.battery_capacity_mah < 100.0 || msg.battery_capacity_mah > 500000.0)) {
          return reject('battery_capacity_mah must be a finite number between 100.0 and 500000.0 mAh.');
        }
        if (msg.battery_level_pct !== undefined && (!isFiniteNumber(msg.battery_level_pct) || msg.battery_level_pct < 0.0 || msg.battery_level_pct > 100.0)) {
          return reject('battery_level_pct must be a finite number between 0.0 and 100.0 percent.');
        }
        if (msg.tactical_priority !== undefined && (!isFiniteNumber(msg.tactical_priority) || msg.tactical_priority < 0.1 || msg.tactical_priority > 5.0)) {
          return reject('tactical_priority must be a finite number between 0.1 and 5.0.');
        }
        if (msg.color_hex !== undefined && (typeof msg.color_hex !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(msg.color_hex.trim()))) {
          return reject('color_hex must be a valid hex color code (e.g. #38bdf8).');
        }

        const nextX = msg.x_m !== undefined ? msg.x_m : staticNode.position[0];
        const nextY = msg.y_m !== undefined ? msg.y_m : staticNode.position[1];
        const nextAgl = msg.agl_m !== undefined ? msg.agl_m : staticNode.aglM;
        const nextTerrainMsl = this.terrainEngine.getElevation(nextX, nextY);
        const nextZ = nextTerrainMsl + nextAgl;

        staticNode.position = [nextX, nextY, nextZ];
        tacNode.position = [nextX, nextY, nextZ];
        staticNode.aglM = nextAgl;
        tacNode.aglM = nextAgl;

        if (msg.role !== undefined) {
          staticNode.nodeType = msg.role;
          tacNode.nodeType = msg.role;
        }
        if (msg.tx_power_dbm !== undefined) {
          staticNode.txPowerDbm = msg.tx_power_dbm;
          tacNode.txPowerDbm = msg.tx_power_dbm;
        }
        if (msg.battery_capacity_mah !== undefined) {
          staticNode.batteryCapacityMah = msg.battery_capacity_mah;
          tacNode.batteryCapacityMah = msg.battery_capacity_mah;
        }
        if (msg.battery_level_pct !== undefined) {
          staticNode.batteryLevelPct = msg.battery_level_pct;
          tacNode.batteryLevelPct = msg.battery_level_pct;
          staticNode.isDepleted = msg.battery_level_pct <= 0;
          tacNode.isDepleted = msg.battery_level_pct <= 0;
        }
        if (msg.tactical_priority !== undefined) {
          staticNode.tacticalPriority = msg.tactical_priority;
          tacNode.tacticalPriority = msg.tactical_priority;
        }

        this.nodeRegistry.updateEntity(nid, {
          position: [nextX, nextY],
          aglM: nextAgl,
          role: msg.role,
          callsign: msg.callsign ? msg.callsign.trim() : undefined,
          trafficOptions: msg.traffic_options,
          colorHex: msg.color_hex ? msg.color_hex.trim() : undefined,
          txPowerDbm: msg.tx_power_dbm,
          batteryCapacityMah: msg.battery_capacity_mah,
          batteryLevelPct: msg.battery_level_pct,
          tacticalPriority: msg.tactical_priority,
        });

        const updatedEntity = this.nodeRegistry.getByNodeId(nid);
        if (updatedEntity) {
          (staticNode as any).identity = updatedEntity.identity;
          (tacNode as any).identity = updatedEntity.identity;
        }

        if (changesSpatial) {
          this.spatialRevision++;
        }
        this.refreshObstructionState(this.trajectoryEngine.getAcnPosition(this.simTimeS), this.simTimeS);
        this.emitProfileFrame();

        const res: WorkerCommandResult = {
          type: 'COMMAND_RESULT',
          command_type: 'NODE_UPDATE',
          accepted: true,
          node_id: nid,
          spatial_locked: this.spatialLocked,
          request_id: msg.request_id,
        };
        this.emitHostMessage(res);
        return res;
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
  self.onmessage = (event: MessageEvent) => {
    simWorker.handleMessage(event.data);
  };
}
