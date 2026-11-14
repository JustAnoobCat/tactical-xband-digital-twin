/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Shared Worker Communication Protocol & Message Contracts
 *
 * Defines strongly typed contracts for all message exchanges between
 * the authoritative Web Worker simulation engine and the main UI thread.
 */

import type { Position3D } from './types';
import type { NodeType, AltitudeMode } from '../core/config';
export type { AltitudeMode };
import type { NodeTrafficOptions } from '../core/nodeRegistry';
import type { Obstacle } from '../core/obstacles';
import type { LinkProfile } from '../core/linkProfile';
import type { TerrainBoundsTelemetry, TerrainObstruction, DemGeographicMetadata } from '../core/terrain';
import type { NodeTerrainState } from '../core/trajectory';
import type { ActiveTransferTelemetry } from '../core/transferMetrics';
import type { RegistrationState, RegistrationEvent } from '../core/registration';
import type { RelayAdvisorReport } from '../core/viewshedEngine';
export type { RelayAdvisorReport };
import { TdmaFrameConfig } from '../core/tdmaConfig';
import type { ITdmaFrameConfig, TdmaUplinkPolicy } from '../core/tdmaConfig';
export { TdmaFrameConfig };
export type { ITdmaFrameConfig, TdmaUplinkPolicy };

// ----------------------------------------------------------------------------
// Component Telemetry Contracts
// ----------------------------------------------------------------------------

export interface TrajectoryConfigTelemetry {
  readonly trajectory_mode: 'ellipse' | 'waypoints';
  readonly center_x_m: number;
  readonly center_y_m: number;
  readonly orbit_a_m: number;
  readonly orbit_b_m: number;
  readonly orbit_rotation_deg: number;
  readonly loiter_speed_mps?: number;
  readonly current_speed_mps?: number;
  readonly acn_altitude_m?: number;
  readonly altitude_mode?: AltitudeMode;
  readonly target_agl_m?: number;
  readonly max_climb_rate_mps?: number;
  readonly max_descent_rate_mps?: number;
  readonly waypoints: readonly { readonly x_m: number; readonly y_m: number; readonly z_m?: number }[];
}

export interface AcnTelemetry {
  readonly pos_x: number;
  readonly pos_y: number;
  readonly pos_z: number;
  readonly lat_deg: number;
  readonly lon_deg: number;
  readonly vel_x: number;
  readonly vel_y: number;
  readonly vel_z?: number;
  readonly pitch_deg?: number;
  readonly bank_deg?: number;
  readonly heading_deg?: number;
  readonly altitude_msl_m?: number;
  readonly altitude_agl_m?: number;
  readonly terrain_elevation_msl_m?: number;
  readonly altitude_mode?: AltitudeMode;
  readonly target_altitude_m?: number;
  readonly is_terrain_clamped?: boolean;
  readonly heading_rad: number;
  readonly current_speed_mps: number;
  readonly target_speed_mps: number;
  readonly acceleration_limit_mps2?: number;
  readonly deceleration_limit_mps2?: number;
  readonly coverage_radius_m: number;
  readonly coverage_radius_km: number;
  readonly flight_path: readonly (readonly [number, number])[];
  readonly flight_path_3d?: readonly (readonly [number, number, number])[];
}

export interface NodeTransferTelemetry {
  readonly node_id: number;
  readonly status: 'IDLE' | 'TRANSMITTING' | 'BLOCKED_NLOS' | 'FAILED_DROPPED' | 'ACKNOWLEDGED' | string;
  readonly status_message: string;
  readonly active_type: string | null;
  readonly total_bytes: number;
  readonly delivered_bytes: number;
  readonly dropped_bytes: number;
  readonly dropped_packets: number;
  readonly progress_pct: number;
  readonly start_time_s: number;
  readonly ack_time_s: number;
  readonly current_rate_bps: number;
  readonly current_rate_mbps: number;
  readonly eta_s: number | null;
  readonly eta_status: string;
}

export interface NodeTelemetryItem {
  readonly node_id: number;
  readonly entity_id?: string;
  readonly creation_sequence?: number;
  readonly name: string;
  readonly node_type: NodeType | string;
  readonly x_m: number;
  readonly y_m: number;
  readonly z_m: number;
  readonly position?: readonly [number, number, number];
  readonly lat_deg: number;
  readonly lon_deg: number;
  readonly coordinate_reference: string;
  readonly terrain_elevation_msl_m: number;
  readonly agl_m: number;
  readonly altitude_msl_m: number;
  readonly slant_range_km: number;
  readonly snr_db: number;
  readonly modcod_name: string;
  readonly link_outage: boolean;
  readonly bitrate_bps: number;
  readonly bitrate_mbps: number;
  readonly terrain_is_los: boolean;
  readonly diffraction_loss_db: number;
  readonly state_name: NodeTerrainState | string;
  readonly time_to_occlusion_s: number;
  readonly time_to_emergence_s: number;
  readonly fresnel_clearance_m: number;
  readonly obstacle_blocked: boolean;
  readonly is_coverage_complete?: boolean;
  readonly isCoverageComplete?: boolean;
  readonly coverage_note?: string;
  readonly coverageNote?: string;
  readonly c2_backlog: number;
  readonly voice_backlog: number;
  readonly video_backlog: number;
  readonly photo_backlog: number;
  readonly c2_bytes: number;
  readonly voice_bytes: number;
  readonly video_bytes: number;
  readonly photo_bytes: number;
  readonly total_backlog_bytes: number;
  readonly is_transmitting: boolean;
  readonly is_wasting_airtime: boolean;
  readonly allocated_slot_ms: number;
  readonly allocated_capacity_bits: number;
  readonly transfer_state: NodeTransferTelemetry | null;
  readonly color_hex: string;
  readonly tx_power_dbm: number;
  readonly battery_capacity_mah: number;
  readonly battery_level_pct: number;
  readonly tactical_priority: number;
  readonly is_depleted: boolean;
  readonly registration_state: string;
  readonly registration_start_time_s: number | null;
  readonly registration_completion_time_s: number | null;
  readonly registration_elapsed_s: number | null;
  readonly communication_eligible: boolean;
  readonly active_sector_id?: 0 | 1 | 2 | 3;
  readonly sector_boresight_deg?: 0 | 90 | 180 | 270;
  readonly body_azimuth_deg?: number;
  readonly off_boresight_deg?: number;
  readonly pattern_rolloff_db?: number;
  readonly sector_gains_dbi?: readonly [number, number, number, number];
  readonly is_crossover_zone?: boolean;
  readonly handover_count?: number;
  readonly crest_radius_m?: number;
  readonly curvature_loss_db?: number;
  readonly sky_temp_k?: number;
  readonly sky_noise_db?: number;
  readonly timing_advance_us?: number;
  readonly radial_vel_ms?: number;
  readonly doppler_shift_hz?: number;
  readonly doppler_rate_hz_s?: number;
  readonly jammer_interference_dbm?: number;
  readonly sinr_db?: number;
  readonly [key: string]: unknown;
}

export type SerializedNodeTelemetry = NodeTelemetryItem;

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
  readonly sector_id?: 0 | 1 | 2 | 3;
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
  readonly crest_radius_m?: number;
  readonly curvature_loss_db?: number;
  readonly bullington_apex_dist_m?: number;
  readonly sky_noise_increase_db?: number;
  readonly sky_temperature_k?: number;
  readonly is_coverage_complete?: boolean;
  readonly isCoverageComplete?: boolean;
  readonly coverage_note?: string;
  readonly coverageNote?: string;
  readonly radial_vel_ms?: number;
  readonly doppler_shift_hz?: number;
  readonly doppler_rate_hz_s?: number;
  readonly jammer_interference_dbm?: number;
  readonly sinr_db?: number;
  readonly [key: string]: unknown;
}

export interface FresnelSliceTelemetry {
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
  readonly state_name?: NodeTerrainState | string;
  readonly crest_radius_m?: number;
  readonly curvature_loss_db?: number;
  readonly bullington_apex_dist_m?: number;
  readonly link_budget: SelectedLinkBudgetTelemetry;
  readonly profile_points: readonly [number, number, number, number][];
  readonly is_coverage_complete?: boolean;
  readonly coverage_note?: string;
}

export interface ComparativeKpiDashboard {
  readonly static_goodput_mb: number;
  readonly tac_goodput_mb: number;
  readonly gain_multiplier: number;
  readonly static_waste_pct: number;
  readonly tac_waste_pct: number;
  readonly static_drops: number;
  readonly static_drop_pct: number;
  readonly tac_drops: number;
  readonly tac_drop_pct: number;
  readonly ul_utilization_pct: number;
  readonly node4_pre_shadow_backlog_kb: number;
  readonly static_node4_pre_shadow_backlog_kb: number;
  readonly node4_evac_status: string;
  readonly static_selected_backlog_kb: number | null;
  readonly tac_selected_backlog_kb: number | null;
  readonly static_goodput_frame_bits: number;
  readonly tac_goodput_frame_bits: number;
  readonly active_goodput_frame_bits: number;
  readonly static_wasted_frame_bits: number;
  readonly tac_wasted_frame_bits: number;
  readonly active_wasted_frame_bits: number;
  readonly static_drop_delay_frame_pkts: number;
  readonly static_drop_overflow_frame_pkts: number;
  readonly static_drop_frame_pkts: number;
  readonly tac_drop_delay_frame_pkts: number;
  readonly tac_drop_overflow_frame_pkts: number;
  readonly tac_drop_frame_pkts: number;
  readonly active_drop_delay_frame_pkts: number;
  readonly active_drop_overflow_frame_pkts: number;
  readonly active_drop_frame_pkts: number;
  readonly static_utilization_pct: number;
  readonly tac_utilization_pct: number;
  readonly static_p50_bps: number | null;
  readonly static_p95_bps: number | null;
  readonly tac_p50_bps: number | null;
  readonly tac_p95_bps: number | null;
  readonly rolling_window_sample_count: number;
  readonly rolling_window_capacity: number;
}

export interface RegistrationTelemetry {
  readonly nodes: readonly {
    readonly node_id: number;
    readonly entity_id?: string;
    readonly state: RegistrationState | string;
    readonly start_time_s: number | null;
    readonly completion_time_s: number | null;
  }[];
  readonly events: readonly RegistrationEvent[];
}

export interface DownlinkTelemetry {
  readonly is_control_broadcast: boolean;
  readonly ctrl_duration_ms: number;
  readonly dl_duration_ms: number;
  readonly broadcast_active: boolean;
}

export interface TelemetryFrame {
  readonly frame_index: number;
  readonly sim_time_s: number;
  readonly speed: number;
  readonly target_speed: number;
  readonly achieved_speed: number;
  readonly paused: boolean;
  readonly step_request_id?: number;
  readonly spatial_locked: boolean;
  readonly spatial_revision: number;
  readonly trajectory_config: TrajectoryConfigTelemetry;
  readonly scheduler_mode: string;
  readonly selected_node_id: number;
  readonly plain_english_narrative: string;
  readonly acn_telemetry: AcnTelemetry;
  readonly nodes_telemetry: readonly NodeTelemetryItem[];
  readonly registration_telemetry: RegistrationTelemetry;
  readonly active_gantt_allocations: readonly TelemetryGanttAllocation[];
  readonly static_gantt_allocations: readonly TelemetryGanttAllocation[];
  readonly tac_gantt_allocations: readonly TelemetryGanttAllocation[];
  readonly reactive_gantt_allocations?: readonly TelemetryGanttAllocation[];
  readonly comparative_kpi_dashboard: ComparativeKpiDashboard;
  readonly static_p50_bps: number | null;
  readonly static_p95_bps: number | null;
  readonly tac_p50_bps: number | null;
  readonly tac_p95_bps: number | null;
  readonly selected_node_fresnel: FresnelSliceTelemetry;
  readonly selected_link_budget: SelectedLinkBudgetTelemetry;
  readonly transfer_telemetry: ActiveTransferTelemetry;
  readonly active_transfers: readonly ActiveTransferTelemetry[];
  readonly downlink_telemetry: DownlinkTelemetry;
  readonly terrain_mode: string;
  readonly terrain_bounds_km: number;
  readonly terrain_bounds: TerrainBoundsTelemetry;
  readonly tdma_frame_config?: ITdmaFrameConfig;
  readonly batch_spatial_snapshots?: readonly SpatialFrameSnapshot[];
  readonly completed_superframes?: readonly TimelineCommunicationRecord[];
  readonly simulation_run_id?: number;
  readonly acn_heading_deg?: number;
  readonly acn_bank_deg?: number;
  readonly sector_node_counts?: readonly [number, number, number, number];
  readonly static_sector_util_pct?: readonly [number, number, number, number];
  readonly tac_sector_util_pct?: readonly [number, number, number, number];
  readonly tac_sector_goodput_mbps?: readonly [number, number, number, number];
  readonly total_sector_handovers?: number;
  readonly static_goodput_mbps?: number;
  readonly static_util_pct?: number;
  readonly static_wasted_bits?: number;
  readonly static_delay_drops?: number;
  readonly static_overflow_drops?: number;
  readonly static_scheduled_ul_s?: number;
  readonly tac_goodput_mbps?: number;
  readonly tac_util_pct?: number;
  readonly tac_wasted_bits?: number;
  readonly tac_delay_drops?: number;
  readonly tac_overflow_drops?: number;
  readonly tac_scheduled_ul_s?: number;
  readonly reactive_goodput_mbps?: number;
  readonly reactive_util_pct?: number;
  readonly reactive_wasted_bits?: number;
  readonly reactive_delay_drops?: number;
  readonly reactive_overflow_drops?: number;
  readonly reactive_scheduled_ul_s?: number;
  readonly reactive_sector_util_pct?: readonly [number, number, number, number];
  readonly dem_lookahead_error_std_m?: number;
  readonly traffic_load_multiplier?: number;
  readonly jammer_enabled?: boolean;
  readonly jammer_eirp_dbm?: number;
  readonly jammer_pos_enu?: Position3D;
  readonly jammer_terrain_shield_db?: number;
  readonly jammer_sector_interference_dbm?: readonly [number, number, number, number];
  readonly viewshed_sinr_grid?: Float32Array | readonly number[];
  readonly relay_advisor?: RelayAdvisorReport;
  readonly static_delay_ecdf_ms?: readonly number[];
  readonly reactive_delay_ecdf_ms?: readonly number[];
  readonly tac_delay_ecdf_ms?: readonly number[];
  readonly static_p50_ms?: number;
  readonly static_p95_ms?: number;
  readonly static_p99_ms?: number;
  readonly reactive_p50_ms?: number;
  readonly reactive_p95_ms?: number;
  readonly reactive_p99_ms?: number;
  readonly tac_p50_ms?: number;
  readonly tac_p95_ms?: number;
  readonly tac_p99_ms?: number;
}

// ----------------------------------------------------------------------------
// Timeline System Contracts (DRDO-TAC-XBAND-ARCH-TIMELINE-17)
// ----------------------------------------------------------------------------

export interface SpatialAcnSnapshot {
  readonly posX: number;
  readonly posY: number;
  readonly posZ: number;
  readonly velX: number;
  readonly velY: number;
  readonly velZ: number;
  readonly headingRad: number;
  readonly pitchDeg: number;
  readonly altitudeMslM: number;
  readonly altitudeAglM: number;
  readonly coverageRadiusKm: number;
  readonly isTerrainClamped: boolean;
}

export interface SpatialNodeSnapshot {
  readonly nodeId: number;
  readonly posX: number;
  readonly posY: number;
  readonly posZ: number;
  readonly altitudeMslM: number;
  readonly altitudeAglM: number;
  readonly isLos: boolean;
  readonly isOutage: boolean;
  readonly isObstacleBlocked: boolean;
  readonly snrDb: number;
  readonly currentState: NodeTerrainState | string;
  readonly active_sector_id?: 0 | 1 | 2 | 3;
  readonly pattern_rolloff_db?: number;
}

export interface SpatialLinkBudgetSnapshot {
  readonly slantRangeM: number;
  readonly fsplDb: number;
  readonly diffractionLossDb: number;
  readonly gasLossDb: number;
  readonly rainLossDb: number;
  readonly totalLossDb: number;
  readonly snrDb: number;
  readonly modcodName: string;
  readonly bitrateMbps: number;
  readonly isOutage: boolean;
}

export interface SpatialFrameSnapshot {
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly wallClockTimeMs: number;
  readonly spatialRevision: number;
  readonly acn: SpatialAcnSnapshot;
  readonly nodes: readonly SpatialNodeSnapshot[];
  readonly selectedLinkBudget: SpatialLinkBudgetSnapshot | null;
  readonly acn_heading_deg?: number;
  readonly acn_bank_deg?: number;
}

export interface SchedulerEpochMetrics {
  readonly transmittedNonOutageBits: number;
  readonly outageWastedBits: number;
  readonly totalPayloadBitsDequeued: number;
  readonly droppedDelayPkts: number;
  readonly droppedOverflowPkts: number;
  readonly totalDroppedPkts: number;
  readonly droppedDelayBytes: number | null;
  readonly droppedOverflowBytes: number | null;
  readonly totalDroppedBytes: number | null;
  readonly ulUtilizationPct: number;

  // Phase 0 Additive Queue Instrumentation (Strictly independent per scheduler)
  readonly endQueueDepthPkts?: number;
  readonly endBacklogBytes?: number;
  readonly meanHeadOfLineSojournMs?: number | null;
}

export interface SuperframeEpochRecord {
  readonly recordType: 'EPOCH';
  readonly simulationRunId?: number;
  readonly epochIndex: number;
  readonly startTimeS: number;
  readonly endTimeS: number;
  readonly durationMs: number;
  readonly configuredDurationMs: number;
  readonly nominalSimTimeS: number;
  readonly associatedSimulationFrameIndex: number;
  readonly coveredFrameRange?: readonly [number, number];
  readonly staticMetrics: SchedulerEpochMetrics;
  readonly tacMetrics: SchedulerEpochMetrics;
  readonly activeSchedulerMode: 'tac_tad' | 'static';
}

export interface SuperframeDiscontinuityRecord {
  readonly recordType: 'DISCONTINUITY';
  readonly simulationRunId?: number;
  readonly discontinuityIndex: number;
  readonly epochIndex?: number;
  readonly startTimeS: number;
  readonly endTimeS: number;
  readonly discardedDurationMs: number;
  readonly discardedDurationS?: number;
  readonly oldDurationMs: number;
  readonly newDurationMs: number;
  readonly nominalSimTimeS: number;
  readonly reason: 'RECONFIGURATION_RESET';
  readonly reconfigurationReason?: string;
}

export type EvictionSchedulerId = 'STATIC_TDMA' | 'TAC_TAD';

export interface FinalDropCaptureResult {
  readonly captured: boolean;
  readonly droppedDelayPkts: number;
  readonly droppedOverflowPkts: number;
  readonly totalDroppedPkts: number;
  readonly droppedDelayBytes: number;
  readonly droppedOverflowBytes: number;
  readonly totalDroppedBytes: number;
}

export interface EvictionDropFinalizationRecord {
  readonly recordType: 'NODE_EVICTION_FINALIZATION';
  readonly simulationRunId?: number;
  readonly finalizationIndex: number;
  readonly schedulerId: EvictionSchedulerId;
  readonly nodeId: number;
  readonly timestampS: number;
  readonly associatedSimulationFrameIndex: number;
  readonly droppedDelayPkts: number;
  readonly droppedOverflowPkts: number;
  readonly totalDroppedPkts: number;
  readonly droppedDelayBytes: number;
  readonly droppedOverflowBytes: number;
  readonly totalDroppedBytes: number;
  readonly reason: 'NODE_DELETE';
}

export type TimelineCommunicationRecord =
  | SuperframeEpochRecord
  | SuperframeDiscontinuityRecord
  | EvictionDropFinalizationRecord;

/**
 * Authoritative Simulation Telemetry Frame contract alias.
 */
export type SimulationTelemetryFrame = TelemetryFrame;

// ----------------------------------------------------------------------------
// Worker Command Result
// ----------------------------------------------------------------------------

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
  readonly simulation_run_id?: number;
  readonly eviction_finalizations?: readonly EvictionDropFinalizationRecord[];
}

// ----------------------------------------------------------------------------
// Inbound Worker Commands (Main Thread -> Worker)
// ----------------------------------------------------------------------------

export interface BaseWorkerInboundCommand {
  readonly type: string;
  readonly request_id?: string | number;
}

export interface SimControlCommand extends BaseWorkerInboundCommand {
  readonly type: 'SIM_CONTROL';
  readonly action: 'pause' | 'resume' | 'step' | 'reset';
  readonly step_request_id?: number;
}

export interface SetSpeedCommand extends BaseWorkerInboundCommand {
  readonly type: 'SET_SPEED';
  readonly speed: number;
}

export interface SetSchedulerCommand extends BaseWorkerInboundCommand {
  readonly type: 'SET_SCHEDULER';
  readonly mode: 'tac_tad' | 'static';
}

export interface SelectNodeCommand extends BaseWorkerInboundCommand {
  readonly type: 'SELECT_NODE';
  readonly node_id: number;
}

export interface SetSpatialLockCommand extends BaseWorkerInboundCommand {
  readonly type: 'SET_SPATIAL_LOCK';
  readonly locked: boolean;
}

export interface NodeMoveCommand extends BaseWorkerInboundCommand {
  readonly type: 'NODE_MOVE';
  readonly node_id: number;
  readonly x_m: number;
  readonly y_m: number;
}

export interface NodeAddCommand extends BaseWorkerInboundCommand {
  readonly type: 'NODE_ADD';
  readonly role?: NodeType;
  readonly x_m?: number;
  readonly y_m?: number;
  readonly position?: readonly [number, number] | [number, number];
  readonly agl_m?: number;
  readonly callsign?: string;
  readonly color_hex?: string;
  readonly tx_power_dbm?: number;
  readonly battery_capacity_mah?: number;
  readonly battery_level_pct?: number;
  readonly tactical_priority?: number;
  readonly request_id?: string | number;
  readonly traffic_options?: NodeTrafficOptions;
}

export interface NodeDeleteCommand extends BaseWorkerInboundCommand {
  readonly type: 'NODE_DELETE';
  readonly node_id: number;
  readonly request_id?: string | number;
}

export interface NodeDuplicateCommand extends BaseWorkerInboundCommand {
  readonly type: 'NODE_DUPLICATE';
  readonly source_node_id: number;
  readonly offset_x_m?: number;
  readonly offset_y_m?: number;
  readonly callsign?: string;
  readonly request_id?: string | number;
}

export interface NodeUpdateCommand extends BaseWorkerInboundCommand {
  readonly type: 'NODE_UPDATE';
  readonly node_id: number;
  readonly x_m?: number;
  readonly y_m?: number;
  readonly agl_m?: number;
  readonly callsign?: string;
  readonly role?: 'soldier' | 'mcp';
  readonly color_hex?: string;
  readonly tx_power_dbm?: number;
  readonly battery_capacity_mah?: number;
  readonly battery_level_pct?: number;
  readonly tactical_priority?: number;
  readonly traffic_options?: NodeTrafficOptions;
  readonly request_id?: string | number;
}

export interface ObstaclesReplaceCommand extends BaseWorkerInboundCommand {
  readonly type: 'OBSTACLES_REPLACE';
  readonly obstacles: readonly Obstacle[] | Obstacle[] | readonly unknown[];
  readonly request_id?: string | number;
}

export interface ConfigUpdateParams {
  readonly carrier_freq_ghz?: number;
  readonly channel_bandwidth_mhz?: number;
  readonly rain_rate_mmh?: number;
  readonly acn_altitude_m?: number;
  readonly altitude_mode?: AltitudeMode;
  readonly target_agl_m?: number;
  readonly max_climb_rate_mps?: number;
  readonly max_descent_rate_mps?: number;
  readonly orbit_a_m?: number;
  readonly orbit_b_m?: number;
  readonly orbit_rotation_deg?: number;
  readonly loiter_speed_mps?: number;
  readonly acceleration_limit_mps2?: number;
  readonly deceleration_limit_mps2?: number;
  readonly coverage_radius_km?: number;
  readonly center_x_m?: number;
  readonly center_y_m?: number;
  readonly node_id?: number;
  readonly agl_m?: number;
  readonly terrain_mode?: 'real' | 'synthetic';
  readonly trajectory_mode?: 'ellipse' | 'waypoints';
  readonly waypoints?: readonly { readonly x_m: number; readonly y_m: number; readonly z_m?: number }[];
  readonly tdma_frame_config?: Partial<ITdmaFrameConfig>;
  readonly lookahead_cadence_hz?: number;
  readonly lookahead_interval_frames?: number;
}

export interface ConfigUpdateCommand extends BaseWorkerInboundCommand {
  readonly type: 'CONFIG_UPDATE' | 'SET_PARAMS' | 'UPDATE_PARAMS';
  readonly request_id?: string | number;
  readonly params?: ConfigUpdateParams;
  readonly carrier_freq_ghz?: number;
  readonly channel_bandwidth_mhz?: number;
  readonly rain_rate_mmh?: number;
  readonly acn_altitude_m?: number;
  readonly altitude_mode?: AltitudeMode;
  readonly target_agl_m?: number;
  readonly max_climb_rate_mps?: number;
  readonly max_descent_rate_mps?: number;
  readonly orbit_a_m?: number;
  readonly orbit_b_m?: number;
  readonly orbit_rotation_deg?: number;
  readonly loiter_speed_mps?: number;
  readonly acceleration_limit_mps2?: number;
  readonly deceleration_limit_mps2?: number;
  readonly coverage_radius_km?: number;
  readonly center_x_m?: number;
  readonly center_y_m?: number;
  readonly node_id?: number;
  readonly agl_m?: number;
  readonly terrain_mode?: 'real' | 'synthetic';
  readonly trajectory_mode?: 'ellipse' | 'waypoints';
  readonly waypoints?: readonly { readonly x_m: number; readonly y_m: number; readonly z_m?: number }[];
  readonly tdma_frame_config?: Partial<ITdmaFrameConfig>;
  readonly lookahead_cadence_hz?: number;
  readonly lookahead_interval_frames?: number;
}

export interface LoadPresetCommand extends BaseWorkerInboundCommand {
  readonly type: 'LOAD_PRESET';
  readonly preset_id: 'ACN_ONLY' | '16_NODES' | string;
}

export interface InjectTrafficCommand extends BaseWorkerInboundCommand {
  readonly type: 'INJECT_TRAFFIC';
  readonly node_id?: number;
  readonly traffic_type: string;
}

export interface ClearTransferCommand extends BaseWorkerInboundCommand {
  readonly type: 'CLEAR_TRANSFER';
  readonly node_id?: number;
}

export interface SetTerrainModeCommand extends BaseWorkerInboundCommand {
  readonly type: 'SET_TERRAIN_MODE';
  readonly mode: 'real' | 'synthetic';
}

export interface LoadCustomDemCommand extends BaseWorkerInboundCommand {
  readonly type: 'LOAD_CUSTOM_DEM';
  readonly elevations: Float32Array | ArrayBuffer;
  readonly buffer?: ArrayBuffer | Float32Array;
  readonly request_id?: string | number;
  readonly metadata?: DemGeographicMetadata;
}

export interface GetHillshadeCommand extends BaseWorkerInboundCommand {
  readonly type: 'GET_HILLSHADE';
}

export interface GetTerrainBoundsCommand extends BaseWorkerInboundCommand {
  readonly type: 'GET_TERRAIN_BOUNDS';
  readonly request_id?: string | number;
}

export interface GetTerrainMeshDataCommand extends BaseWorkerInboundCommand {
  readonly type: 'GET_TERRAIN_MESH_DATA';
  readonly request_id?: string | number;
}

export interface SetScientificParamsCommand extends BaseWorkerInboundCommand {
  readonly type: 'SET_SCIENTIFIC_PARAMS';
  readonly demLookaheadErrorStdM?: number;
  readonly trafficLoadMultiplier?: number;
  readonly jammerEnabled?: boolean;
  readonly jammerEirpDbm?: number;
  readonly viewshedEnabled?: boolean;
  readonly recomputeRelayAdvisor?: boolean;
}

export interface SetViewshedConfigCommand extends BaseWorkerInboundCommand {
  readonly type: 'SET_VIEWSHED_CONFIG';
  readonly viewshedEnabled?: boolean;
  readonly recomputeRelayAdvisor?: boolean;
}

export type WorkerInboundCommand =
  | SimControlCommand
  | SetSpeedCommand
  | SetSchedulerCommand
  | SelectNodeCommand
  | SetSpatialLockCommand
  | SetScientificParamsCommand
  | SetViewshedConfigCommand
  | NodeMoveCommand
  | NodeAddCommand
  | NodeDeleteCommand
  | NodeDuplicateCommand
  | NodeUpdateCommand
  | ObstaclesReplaceCommand
  | ConfigUpdateCommand
  | LoadPresetCommand
  | InjectTrafficCommand
  | ClearTransferCommand
  | SetTerrainModeCommand
  | LoadCustomDemCommand
  | GetHillshadeCommand
  | GetTerrainBoundsCommand
  | GetTerrainMeshDataCommand;

// ----------------------------------------------------------------------------
// Outbound Worker Messages (Worker -> Main Thread)
// ----------------------------------------------------------------------------

export interface TelemetryFrameMessage {
  readonly type: 'TELEMETRY_FRAME';
  readonly frame: TelemetryFrame;
  readonly static_goodput_mbps?: number;
  readonly static_util_pct?: number;
  readonly static_wasted_bits?: number;
  readonly static_delay_drops?: number;
  readonly static_overflow_drops?: number;
  readonly static_scheduled_ul_s?: number;
  readonly static_sector_util_pct?: readonly [number, number, number, number];
  readonly tac_goodput_mbps?: number;
  readonly tac_util_pct?: number;
  readonly tac_wasted_bits?: number;
  readonly tac_delay_drops?: number;
  readonly tac_overflow_drops?: number;
  readonly tac_scheduled_ul_s?: number;
  readonly tac_sector_util_pct?: readonly [number, number, number, number];
  readonly reactive_goodput_mbps?: number;
  readonly reactive_util_pct?: number;
  readonly reactive_wasted_bits?: number;
  readonly reactive_delay_drops?: number;
  readonly reactive_overflow_drops?: number;
  readonly reactive_scheduled_ul_s?: number;
  readonly reactive_sector_util_pct?: readonly [number, number, number, number];
  readonly dem_lookahead_error_std_m?: number;
  readonly traffic_load_multiplier?: number;
  readonly jammer_enabled?: boolean;
  readonly jammer_eirp_dbm?: number;
  readonly jammer_pos_enu?: Position3D;
  readonly jammer_terrain_shield_db?: number;
  readonly jammer_sector_interference_dbm?: readonly [number, number, number, number];
  readonly viewshed_sinr_grid?: Float32Array | readonly number[];
  readonly relay_advisor?: RelayAdvisorReport;
  readonly static_delay_ecdf_ms?: readonly number[];
  readonly reactive_delay_ecdf_ms?: readonly number[];
  readonly tac_delay_ecdf_ms?: readonly number[];
  readonly static_p50_ms?: number;
  readonly static_p95_ms?: number;
  readonly static_p99_ms?: number;
  readonly reactive_p50_ms?: number;
  readonly reactive_p95_ms?: number;
  readonly reactive_p99_ms?: number;
  readonly tac_p50_ms?: number;
  readonly tac_p95_ms?: number;
  readonly tac_p99_ms?: number;
}

export interface ProfileFrameMessage {
  readonly type: 'PROFILE_FRAME';
  readonly selectedNodeId: number;
  readonly profileSerial: number;
  readonly spatial_revision: number;
  readonly fresnel: FresnelSliceTelemetry;
  readonly selected_link_budget?: SelectedLinkBudgetTelemetry;
  readonly nodes_telemetry?: readonly NodeTelemetryItem[];
}

export interface HillshadeReadyMessage {
  readonly type: 'HILLSHADE_READY';
  readonly grid_size: number;
  readonly bounds_km: number;
  readonly bounds: TerrainBoundsTelemetry;
  readonly data: readonly (readonly number[])[] | number[][];
  readonly terrain_mode: 'real' | 'synthetic';
}

export interface TerrainBoundsReadyMessage {
  readonly type: 'TERRAIN_BOUNDS_READY';
  readonly request_id?: string | number;
  readonly bounds: TerrainBoundsTelemetry;
}

export interface CustomDemLoadedMessage {
  readonly type: 'CUSTOM_DEM_LOADED';
  readonly request_id?: string | number;
  readonly tile_name: string;
  readonly resolution: number;
  readonly bounds: TerrainBoundsTelemetry;
}

export interface TerrainMeshDataReadyMessage {
  readonly type: 'TERRAIN_MESH_DATA_READY';
  readonly request_id?: string | number;
  readonly terrain_mode: 'real' | 'synthetic';
  readonly bounds: TerrainBoundsTelemetry;
  readonly grid_size: number;
  readonly min_elevation_m: number;
  readonly max_elevation_m: number;
  readonly elevations: Float32Array;
}

/** Discriminated union of all messages posted from the simulation worker to the host. */
export type WorkerOutboundMessage =
  | TelemetryFrameMessage
  | ProfileFrameMessage
  | HillshadeReadyMessage
  | TerrainBoundsReadyMessage
  | CustomDemLoadedMessage
  | TerrainMeshDataReadyMessage
  | WorkerCommandResult;
