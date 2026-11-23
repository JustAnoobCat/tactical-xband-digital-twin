/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Pure Worker Inbound Command Payload Validators & Normalizers
 *
 * Implements authoritative validation, bounds checking, and parameter normalization
 * for worker inbound messages (SET_PARAMS, NODE_MOVE, LOAD_PRESET, SET_SCIENTIFIC_PARAMS, etc.).
 *
 * STRICT INVARIANTS:
 * - 100% pure, stateless functions.
 * - Zero module-level mutable state (`let` / `var`).
 * - Zero `Math.random()`.
 */

import {
  ACNFlightConfig,
  type ACNWaypoint,
  EnvironmentConfig,
  MAX_ACN_WAYPOINTS,
} from '../core/config';
import { TdmaFrameConfig } from '../core/tdmaConfig';
import {
  THEATER_HALF_M,
  MIN_GROUND_AGL_M,
  MAX_GROUND_AGL_M,
  ACN_ID,
} from '../shared/constants';
import { isFiniteNumber } from '../shared/utils';
import type { ConfigUpdateParams, SpreadSpectrumEccmMode } from '../shared/workerProtocol';
import type {
  BiomeId,
  PolarizationMode,
  AdvectingWeatherCell,
} from '../core/biomePhysics';

export interface ValidatedConfigParamsResult {
  readonly valid: boolean;
  readonly reason?: string;
  readonly changesTrajectory?: boolean;
  readonly changesTerrain?: boolean;
  readonly hasAgl?: boolean;
  readonly nextFlightConfig?: ACNFlightConfig;
  readonly nextTdmaConfig?: TdmaFrameConfig | null;
  readonly nextWaypoints?: readonly ACNWaypoint[];
  readonly targetSpeedMps?: number;
  readonly accelLimitMps2?: number;
  readonly decelLimitMps2?: number;
  readonly enableAirframeShadowing?: boolean;
  readonly enableCorrelatedRicianFading?: boolean;
  readonly enableMacPhyFeedback?: boolean;
  readonly enableDubinsKinematics?: boolean;
  readonly viewshedFidelityMode?: 'fast' | 'link-budget-parity';
  readonly biomeId?: BiomeId;
  readonly enableBiomeEmPhysics?: boolean;
  readonly polarizationMode?: PolarizationMode;
  readonly dustVisibilityKm?: number;
  readonly foliageDepthM?: number;
  readonly weatherCells?: readonly AdvectingWeatherCell[];
  readonly enableTransportAbr?: boolean;
  readonly eccmMode?: SpreadSpectrumEccmMode;
  readonly enableMvdrNullSteering?: boolean;
  readonly enableAdversaryEsmModel?: boolean;
  readonly gnssSpoofingRateUsPerSec?: number;
  readonly enableAntiSpoofHoldover?: boolean;
  readonly acnConstellationCount?: number;
  readonly enableMultiHopManet?: boolean;
  readonly enableGroundConvoyMobility?: boolean;
  readonly windSpeedMs?: number;
  readonly windDirectionDeg?: number;
  readonly enableAutoCfitPullUp?: boolean;
}

/**
 * Validates and normalizes parameters for SET_PARAMS / CONFIG_UPDATE / UPDATE_PARAMS commands.
 */
export function validateConfigUpdateParams(
  rawParams: unknown,
  currentFlightConfig: ACNFlightConfig,
  currentTdmaConfig: TdmaFrameConfig,
  hasNode: (nodeId: number) => boolean
): ValidatedConfigParamsResult {
  const p = (
    rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)
  ) ? (rawParams as ConfigUpdateParams) : null;

  if (!p) {
    return { valid: false, reason: 'params must be an object.' };
  }

  const numericKeys = [
    'carrier_freq_ghz', 'channel_bandwidth_mhz', 'rain_rate_mmh', 'acn_altitude_m', 'orbit_a_m', 'orbit_b_m',
    'orbit_rotation_deg', 'loiter_speed_mps', 'acceleration_limit_mps2', 'deceleration_limit_mps2', 'coverage_radius_km',
    'center_x_m', 'center_y_m', 'node_id', 'agl_m', 'target_agl_m', 'max_climb_rate_mps', 'max_descent_rate_mps',
  ] as const;

  for (const key of numericKeys) {
    if (Object.prototype.hasOwnProperty.call(p, key) && !isFiniteNumber((p as any)[key])) {
      return { valid: false, reason: `${key} must be a finite number.` };
    }
  }

  if (p.terrain_mode !== undefined && p.terrain_mode !== 'real' && p.terrain_mode !== 'synthetic') {
    return { valid: false, reason: 'terrain_mode must be real or synthetic.' };
  }
  if (p.enableAirframeShadowing !== undefined && typeof p.enableAirframeShadowing !== 'boolean') {
    return { valid: false, reason: 'enableAirframeShadowing must be a boolean.' };
  }
  if (p.enableCorrelatedRicianFading !== undefined && typeof p.enableCorrelatedRicianFading !== 'boolean') {
    return { valid: false, reason: 'enableCorrelatedRicianFading must be a boolean.' };
  }
  if (p.enableMacPhyFeedback !== undefined && typeof p.enableMacPhyFeedback !== 'boolean') {
    return { valid: false, reason: 'enableMacPhyFeedback must be a boolean.' };
  }
  if (p.enableDubinsKinematics !== undefined && typeof p.enableDubinsKinematics !== 'boolean') {
    return { valid: false, reason: 'enableDubinsKinematics must be a boolean.' };
  }
  if (p.enableTransportAbr !== undefined && typeof p.enableTransportAbr !== 'boolean') {
    return { valid: false, reason: 'enableTransportAbr must be a boolean.' };
  }
  if (p.eccmMode !== undefined && p.eccmMode !== 'NONE' && p.eccmMode !== 'FHSS' && p.eccmMode !== 'DSSS') {
    return { valid: false, reason: "eccmMode must be 'NONE', 'FHSS', or 'DSSS'." };
  }
  if (p.enableMvdrNullSteering !== undefined && typeof p.enableMvdrNullSteering !== 'boolean') {
    return { valid: false, reason: 'enableMvdrNullSteering must be a boolean.' };
  }
  if (p.enableAdversaryEsmModel !== undefined && typeof p.enableAdversaryEsmModel !== 'boolean') {
    return { valid: false, reason: 'enableAdversaryEsmModel must be a boolean.' };
  }
  if (p.gnssSpoofingRateUsPerSec !== undefined && (typeof p.gnssSpoofingRateUsPerSec !== 'number' || !Number.isFinite(p.gnssSpoofingRateUsPerSec) || p.gnssSpoofingRateUsPerSec < 0)) {
    return { valid: false, reason: 'gnssSpoofingRateUsPerSec must be a non-negative finite number.' };
  }
  if (p.enableAntiSpoofHoldover !== undefined && typeof p.enableAntiSpoofHoldover !== 'boolean') {
    return { valid: false, reason: 'enableAntiSpoofHoldover must be a boolean.' };
  }
  if (p.acnConstellationCount !== undefined && (!Number.isInteger(p.acnConstellationCount) || p.acnConstellationCount < 1 || p.acnConstellationCount > 4)) {
    return { valid: false, reason: 'acnConstellationCount must be an integer between 1 and 4.' };
  }
  if (p.enableMultiHopManet !== undefined && typeof p.enableMultiHopManet !== 'boolean') {
    return { valid: false, reason: 'enableMultiHopManet must be a boolean.' };
  }
  if (p.enableGroundConvoyMobility !== undefined && typeof p.enableGroundConvoyMobility !== 'boolean') {
    return { valid: false, reason: 'enableGroundConvoyMobility must be a boolean.' };
  }
  if (p.windSpeedMs !== undefined && (typeof p.windSpeedMs !== 'number' || !Number.isFinite(p.windSpeedMs) || p.windSpeedMs < 0 || p.windSpeedMs > 50)) {
    return { valid: false, reason: 'windSpeedMs must be a finite number between 0 and 50.' };
  }
  if (p.windDirectionDeg !== undefined && (typeof p.windDirectionDeg !== 'number' || !Number.isFinite(p.windDirectionDeg))) {
    return { valid: false, reason: 'windDirectionDeg must be a finite number.' };
  }
  if (p.enableAutoCfitPullUp !== undefined && typeof p.enableAutoCfitPullUp !== 'boolean') {
    return { valid: false, reason: 'enableAutoCfitPullUp must be a boolean.' };
  }
  if (p.viewshedFidelityMode !== undefined && p.viewshedFidelityMode !== 'fast' && p.viewshedFidelityMode !== 'link-budget-parity') {
    return { valid: false, reason: "viewshedFidelityMode must be 'fast' or 'link-budget-parity'." };
  }
  if (p.trajectory_mode !== undefined && p.trajectory_mode !== 'ellipse' && p.trajectory_mode !== 'waypoints') {
    return { valid: false, reason: 'trajectory_mode must be ellipse or waypoints.' };
  }
  if (p.altitude_mode !== undefined && p.altitude_mode !== 'fix' && p.altitude_mode !== 'amsl' && p.altitude_mode !== 'agl') {
    return { valid: false, reason: "altitude_mode must be 'fix', 'amsl', or 'agl'." };
  }
  if (p.carrier_freq_ghz !== undefined && p.carrier_freq_ghz <= 0) {
    return { valid: false, reason: 'carrier_freq_ghz must be greater than zero.' };
  }
  if (p.channel_bandwidth_mhz !== undefined && (p.channel_bandwidth_mhz < 0.1 || p.channel_bandwidth_mhz > 50.0)) {
    return { valid: false, reason: 'channel_bandwidth_mhz must be between 0.1 and 50.0 MHz.' };
  }
  if (p.rain_rate_mmh !== undefined && p.rain_rate_mmh < 0) {
    return { valid: false, reason: 'rain_rate_mmh cannot be negative.' };
  }
  if (p.acn_altitude_m !== undefined && (p.acn_altitude_m <= 0 || p.acn_altitude_m > 100000)) {
    return { valid: false, reason: 'acn_altitude_m must be in (0, 100000].' };
  }
  if (p.target_agl_m !== undefined && (p.target_agl_m <= 0 || p.target_agl_m > 100000)) {
    return { valid: false, reason: 'target_agl_m must be in (0, 100000].' };
  }
  if (p.max_climb_rate_mps !== undefined && (p.max_climb_rate_mps <= 0 || p.max_climb_rate_mps > 1000)) {
    return { valid: false, reason: 'max_climb_rate_mps must be in (0, 1000].' };
  }
  if (p.max_descent_rate_mps !== undefined && (p.max_descent_rate_mps <= 0 || p.max_descent_rate_mps > 1000)) {
    return { valid: false, reason: 'max_descent_rate_mps must be in (0, 1000].' };
  }
  if (
    (p.orbit_a_m !== undefined && (p.orbit_a_m <= 0 || p.orbit_a_m > THEATER_HALF_M)) ||
    (p.orbit_b_m !== undefined && (p.orbit_b_m <= 0 || p.orbit_b_m > THEATER_HALF_M))
  ) {
    return { valid: false, reason: 'Orbit axes must be in (0, 600000] metres.' };
  }
  if (p.orbit_rotation_deg !== undefined && Math.abs(p.orbit_rotation_deg) > 360) {
    return { valid: false, reason: 'orbit_rotation_deg must be within ±360 degrees.' };
  }
  if (p.loiter_speed_mps !== undefined && (p.loiter_speed_mps < 0 || p.loiter_speed_mps > 1000)) {
    return { valid: false, reason: 'loiter_speed_mps must be in [0, 1000].' };
  }
  if (p.acceleration_limit_mps2 !== undefined && (p.acceleration_limit_mps2 <= 0 || p.acceleration_limit_mps2 > 50)) {
    return { valid: false, reason: 'acceleration_limit_mps2 must be in (0, 50].' };
  }
  if (p.deceleration_limit_mps2 !== undefined && (p.deceleration_limit_mps2 <= 0 || p.deceleration_limit_mps2 > 50)) {
    return { valid: false, reason: 'deceleration_limit_mps2 must be in (0, 50].' };
  }
  if (
    (p.center_x_m !== undefined && Math.abs(p.center_x_m) > THEATER_HALF_M) ||
    (p.center_y_m !== undefined && Math.abs(p.center_y_m) > THEATER_HALF_M)
  ) {
    return { valid: false, reason: 'Orbit center coordinates must be within ±600000 metres.' };
  }
  if (p.coverage_radius_km !== undefined && (p.coverage_radius_km <= 0 || p.coverage_radius_km > 600)) {
    return { valid: false, reason: 'coverage_radius_km must be in (0, 600].' };
  }

  const hasAgl = p.agl_m !== undefined || p.node_id !== undefined;
  if (hasAgl && (p.agl_m === undefined || p.node_id === undefined || !Number.isInteger(p.node_id) || !hasNode(p.node_id))) {
    return { valid: false, reason: 'AGL updates require a valid ground node_id and agl_m.' };
  }
  if (p.agl_m !== undefined && (p.agl_m < MIN_GROUND_AGL_M || p.agl_m > MAX_GROUND_AGL_M)) {
    return { valid: false, reason: `agl_m must be between ${MIN_GROUND_AGL_M} and ${MAX_GROUND_AGL_M} metres.` };
  }

  let nextTdmaConfig: TdmaFrameConfig | null = null;
  if (p.tdma_frame_config !== undefined) {
    if (typeof p.tdma_frame_config !== 'object' || p.tdma_frame_config === null || Array.isArray(p.tdma_frame_config)) {
      return { valid: false, reason: 'tdma_frame_config must be an object.' };
    }
    try {
      nextTdmaConfig = new TdmaFrameConfig({
        ...currentTdmaConfig.toObject(),
        ...p.tdma_frame_config,
      });
    } catch (error) {
      return { valid: false, reason: error instanceof Error ? error.message : 'Invalid TDMA frame configuration.' };
    }
  }

  const nextMode = p.trajectory_mode ?? currentFlightConfig.trajectoryMode;
  if (p.waypoints !== undefined && nextMode !== 'waypoints') {
    return { valid: false, reason: 'waypoints can only be edited while trajectory_mode is explicitly waypoints.' };
  }

  let nextWaypoints = currentFlightConfig.waypoints;
  if (p.waypoints !== undefined) {
    if (!Array.isArray(p.waypoints)) {
      return { valid: false, reason: 'waypoints must be an array of {x_m, y_m} points.' };
    }
    const parsed: { xM: number; yM: number; zM?: number }[] = [];
    for (let i = 0; i < p.waypoints.length; i++) {
      const point = p.waypoints[i] as any;
      const xCandidate = point?.x_m ?? point?.xM;
      const yCandidate = point?.y_m ?? point?.yM;
      if (
        !point ||
        typeof point !== 'object' ||
        !isFiniteNumber(xCandidate) ||
        !isFiniteNumber(yCandidate) ||
        Math.abs(xCandidate) > THEATER_HALF_M ||
        Math.abs(yCandidate) > THEATER_HALF_M
      ) {
        return { valid: false, reason: `Waypoint ${i} must have finite x_m/y_m coordinates within ±600000 metres.` };
      }
      const zCandidate = point.z_m ?? point.zM;
      const zM = isFiniteNumber(zCandidate) ? zCandidate : undefined;
      if (zM !== undefined && (zM < 0 || zM > 100000)) {
        return { valid: false, reason: `Waypoint ${i} altitude must be in [0, 100000] metres.` };
      }
      parsed.push({
        xM: xCandidate,
        yM: yCandidate,
        ...(zM !== undefined ? { zM } : {}),
      });
    }
    if (parsed.length > MAX_ACN_WAYPOINTS) {
      return { valid: false, reason: `waypoints cannot exceed ${MAX_ACN_WAYPOINTS} points.` };
    }
    nextWaypoints = parsed;
  }

  if (nextMode === 'waypoints' && (p.trajectory_mode === 'waypoints' || p.waypoints !== undefined) && nextWaypoints.length < 3) {
    return { valid: false, reason: 'Switching to waypoint mode requires at least three waypoints.' };
  }
  if (nextMode === 'waypoints' && (p.center_x_m !== undefined || p.center_y_m !== undefined)) {
    return { valid: false, reason: 'center_x_m/center_y_m apply only to ellipse mode.' };
  }

  const trajectoryKeys = [
    'acn_altitude_m', 'altitude_mode', 'target_agl_m', 'max_climb_rate_mps', 'max_descent_rate_mps',
    'orbit_a_m', 'orbit_b_m', 'orbit_rotation_deg', 'loiter_speed_mps',
    'acceleration_limit_mps2', 'deceleration_limit_mps2',
    'center_x_m', 'center_y_m', 'trajectory_mode', 'waypoints',
  ] as const;
  const changesTrajectory = trajectoryKeys.some((k) => (p as any)[k] !== undefined);
  const changesTerrain = p.terrain_mode !== undefined;

  let nextFlightConfig: ACNFlightConfig | undefined;
  if (changesTrajectory || p.coverage_radius_km !== undefined) {
    nextFlightConfig = new ACNFlightConfig({
      ...currentFlightConfig,
      trajectoryMode: nextMode,
      waypoints: nextWaypoints,
      altitudeMslM: p.acn_altitude_m ?? currentFlightConfig.altitudeMslM,
      altitudeMode: p.altitude_mode ?? currentFlightConfig.altitudeMode,
      targetAglM: p.target_agl_m ?? currentFlightConfig.targetAglM,
      maxClimbRateMps: p.max_climb_rate_mps ?? currentFlightConfig.maxClimbRateMps,
      maxDescentRateMps: p.max_descent_rate_mps ?? currentFlightConfig.maxDescentRateMps,
      loiterRadiusAM: p.orbit_a_m ?? currentFlightConfig.loiterRadiusAM,
      loiterRadiusBM: p.orbit_b_m ?? currentFlightConfig.loiterRadiusBM,
      loiterRotationDeg: p.orbit_rotation_deg ?? currentFlightConfig.loiterRotationDeg,
      loiterSpeedMps: p.loiter_speed_mps ?? currentFlightConfig.loiterSpeedMps,
      accelerationLimitMps2: p.acceleration_limit_mps2 ?? currentFlightConfig.accelerationLimitMps2,
      decelerationLimitMps2: p.deceleration_limit_mps2 ?? currentFlightConfig.decelerationLimitMps2,
      centerXm: p.center_x_m ?? currentFlightConfig.centerXm,
      centerYm: p.center_y_m ?? currentFlightConfig.centerYm,
      coverageRadiusKm: p.coverage_radius_km ?? currentFlightConfig.coverageRadiusKm,
    });
  }

  return {
    valid: true,
    changesTrajectory,
    changesTerrain,
    hasAgl,
    nextFlightConfig,
    nextTdmaConfig,
    nextWaypoints,
    targetSpeedMps: p.loiter_speed_mps,
    accelLimitMps2: p.acceleration_limit_mps2,
    decelLimitMps2: p.deceleration_limit_mps2,
    enableAirframeShadowing: p.enableAirframeShadowing,
    enableCorrelatedRicianFading: p.enableCorrelatedRicianFading,
    enableMacPhyFeedback: p.enableMacPhyFeedback,
    enableDubinsKinematics: p.enableDubinsKinematics,
    viewshedFidelityMode: p.viewshedFidelityMode,
    enableTransportAbr: p.enableTransportAbr,
    eccmMode: p.eccmMode,
    enableMvdrNullSteering: p.enableMvdrNullSteering,
    enableAdversaryEsmModel: p.enableAdversaryEsmModel,
    gnssSpoofingRateUsPerSec: p.gnssSpoofingRateUsPerSec,
    enableAntiSpoofHoldover: p.enableAntiSpoofHoldover,
    acnConstellationCount: p.acnConstellationCount,
    enableMultiHopManet: p.enableMultiHopManet,
    enableGroundConvoyMobility: p.enableGroundConvoyMobility,
    windSpeedMs: p.windSpeedMs,
    windDirectionDeg: p.windDirectionDeg,
    enableAutoCfitPullUp: p.enableAutoCfitPullUp,
  };
}

/**
 * Validates a NODE_MOVE inbound command.
 */
export function validateNodeMoveCommand(
  msg: any,
  hasNode: (nodeId: number) => boolean,
  acnId: number = ACN_ID,
  theaterHalfM: number = THEATER_HALF_M
): { valid: boolean; reason?: string } {
  const nid = msg?.node_id;
  const xm = msg?.x_m;
  const ym = msg?.y_m;
  if (
    !Number.isInteger(nid) ||
    (nid !== acnId && !hasNode(nid)) ||
    !isFiniteNumber(xm) ||
    !isFiniteNumber(ym) ||
    Math.abs(xm) > theaterHalfM ||
    Math.abs(ym) > theaterHalfM
  ) {
    return {
      valid: false,
      reason: 'NODE_MOVE requires valid node_id and finite x_m/y_m within the terrain bounds (±600000 m).',
    };
  }
  return { valid: true };
}

/**
 * Validates a LOAD_PRESET inbound command preset identifier.
 */
export function validatePresetCommand(presetIdCandidate: unknown): {
  valid: boolean;
  reason?: string;
  presetKey?: 'OCCLUSION' | 'AMBUSH' | 'MONSOON' | 'RESET' | 'ACN_ONLY' | '16_NODES';
} {
  if (typeof presetIdCandidate !== 'string') {
    return { valid: false, reason: 'preset_id must be a string.' };
  }
  const pid = presetIdCandidate.toUpperCase();
  if (pid === 'PRESET_OCCLUSION') return { valid: true, presetKey: 'OCCLUSION' };
  if (pid === 'PRESET_AMBUSH') return { valid: true, presetKey: 'AMBUSH' };
  if (pid === 'PRESET_MONSOON') return { valid: true, presetKey: 'MONSOON' };
  if (pid === 'PRESET_RESET') return { valid: true, presetKey: 'RESET' };
  if (pid === 'PRESET_ACN_ONLY' || pid === 'PRESET_ZERO_NODES') return { valid: true, presetKey: 'ACN_ONLY' };
  if (pid === 'PRESET_16_NODES' || pid === 'PRESET_CANONICAL_16' || pid === 'PRESET_DEFAULT') {
    return { valid: true, presetKey: '16_NODES' };
  }
  return { valid: false, reason: 'Unknown preset.' };
}

/**
 * Validates an INJECT_TRAFFIC inbound command.
 */
export function validateTrafficInjectionCommand(
  msg: any,
  hasNode: (nodeId: number) => boolean,
  selectedNodeId: number
): { valid: boolean; reason?: string; resolvedNodeId?: number } {
  const nid = msg?.node_id === undefined ? selectedNodeId : msg?.node_id;
  if (!Number.isInteger(nid) || !hasNode(nid)) {
    return { valid: false, reason: 'node_id must identify a registered ground node.' };
  }
  return { valid: true, resolvedNodeId: nid };
}

/**
 * Resolves and clamps parameters for SET_SCIENTIFIC_PARAMS.
 */
export function resolveScientificParams(
  msg: any,
  currentEnv: EnvironmentConfig
): {
  viewshedEnabled?: boolean;
  recomputeRelayAdvisor: boolean;
  nextEnvConfig: EnvironmentConfig;
  trafficScale: number;
  clearSinrHistory: boolean;
  needsObstructionRefresh: boolean;
  enableAirframeShadowing?: boolean;
  enableCorrelatedRicianFading?: boolean;
  enableMacPhyFeedback?: boolean;
  enableDubinsKinematics?: boolean;
  viewshedFidelityMode?: 'fast' | 'link-budget-parity';
  biomeId?: BiomeId;
  enableBiomeEmPhysics?: boolean;
  polarizationMode?: PolarizationMode;
  dustVisibilityKm?: number;
  foliageDepthM?: number;
  weatherCells?: readonly AdvectingWeatherCell[];
  enableTransportAbr?: boolean;
  eccmMode?: SpreadSpectrumEccmMode;
  enableMvdrNullSteering?: boolean;
  enableAdversaryEsmModel?: boolean;
  gnssSpoofingRateUsPerSec?: number;
  enableAntiSpoofHoldover?: boolean;
  acnConstellationCount?: number;
  enableMultiHopManet?: boolean;
  enableGroundConvoyMobility?: boolean;
  windSpeedMs?: number;
  windDirectionDeg?: number;
  enableAutoCfitPullUp?: boolean;
} {
  const viewshedEnabled = msg?.viewshedEnabled !== undefined ? Boolean(msg.viewshedEnabled) : undefined;
  const recomputeRelayAdvisor = Boolean(msg?.recomputeRelayAdvisor);
  const enableAirframeShadowing = msg?.enableAirframeShadowing !== undefined ? Boolean(msg.enableAirframeShadowing) : undefined;
  const enableCorrelatedRicianFading = msg?.enableCorrelatedRicianFading !== undefined ? Boolean(msg.enableCorrelatedRicianFading) : undefined;
  const enableMacPhyFeedback = msg?.enableMacPhyFeedback !== undefined ? Boolean(msg.enableMacPhyFeedback) : undefined;
  const enableDubinsKinematics = msg?.enableDubinsKinematics !== undefined ? Boolean(msg.enableDubinsKinematics) : undefined;
  const enableTransportAbr = msg?.enableTransportAbr !== undefined ? Boolean(msg.enableTransportAbr) : undefined;
  const eccmMode = (msg?.eccmMode === 'NONE' || msg?.eccmMode === 'FHSS' || msg?.eccmMode === 'DSSS')
    ? (msg.eccmMode as SpreadSpectrumEccmMode)
    : undefined;
  const enableMvdrNullSteering = msg?.enableMvdrNullSteering !== undefined ? Boolean(msg.enableMvdrNullSteering) : undefined;
  const enableAdversaryEsmModel = msg?.enableAdversaryEsmModel !== undefined ? Boolean(msg.enableAdversaryEsmModel) : undefined;
  const gnssSpoofingRateUsPerSec = msg?.gnssSpoofingRateUsPerSec !== undefined && Number.isFinite(msg.gnssSpoofingRateUsPerSec)
    ? Math.max(0.0, msg.gnssSpoofingRateUsPerSec)
    : undefined;
  const enableAntiSpoofHoldover = msg?.enableAntiSpoofHoldover !== undefined ? Boolean(msg.enableAntiSpoofHoldover) : undefined;
  const rawAcnConstCount = msg?.acnConstellationCount ?? msg?.acn_constellation_count;
  const acnConstellationCount = rawAcnConstCount !== undefined && Number.isFinite(rawAcnConstCount)
    ? Math.min(4, Math.max(1, Math.round(rawAcnConstCount)))
    : undefined;
  const rawManet = msg?.enableMultiHopManet ?? msg?.enable_multi_hop_manet;
  const enableMultiHopManet = rawManet !== undefined ? Boolean(rawManet) : undefined;
  const rawConvoy = msg?.enableGroundConvoyMobility ?? msg?.enable_ground_convoy_mobility;
  const enableGroundConvoyMobility = rawConvoy !== undefined ? Boolean(rawConvoy) : undefined;
  const rawWindSpeed = msg?.windSpeedMs ?? msg?.wind_speed_ms;
  const windSpeedMs = rawWindSpeed !== undefined && Number.isFinite(rawWindSpeed)
    ? Math.max(0.0, Math.min(50.0, rawWindSpeed))
    : undefined;
  const rawWindDir = msg?.windDirectionDeg ?? msg?.wind_direction_deg;
  const windDirectionDeg = rawWindDir !== undefined && Number.isFinite(rawWindDir)
    ? (((rawWindDir % 360) + 360) % 360)
    : undefined;
  const rawCfit = msg?.enableAutoCfitPullUp ?? msg?.enable_auto_cfit_pull_up;
  const enableAutoCfitPullUp = rawCfit !== undefined ? Boolean(rawCfit) : undefined;
  const viewshedFidelityMode = (msg?.viewshedFidelityMode === 'fast' || msg?.viewshedFidelityMode === 'link-budget-parity')
    ? msg.viewshedFidelityMode
    : undefined;
  const biomeId = (msg?.biomeId === 'alpine_mountain' || msg?.biomeId === 'arid_desert' || msg?.biomeId === 'open_plains' || msg?.biomeId === 'tropical_jungle' || msg?.biomeId === 'maritime_littoral')
    ? (msg.biomeId as BiomeId)
    : undefined;
  const enableBiomeEmPhysics = msg?.enableBiomeEmPhysics !== undefined ? Boolean(msg.enableBiomeEmPhysics) : undefined;
  const polarizationMode = (msg?.polarizationMode === 'RHCP' || msg?.polarizationMode === 'LHCP' || msg?.polarizationMode === 'LINEAR_V' || msg?.polarizationMode === 'LINEAR_H')
    ? (msg.polarizationMode as PolarizationMode)
    : undefined;
  const dustVisibilityKm = msg?.dustVisibilityKm !== undefined && Number.isFinite(msg.dustVisibilityKm)
    ? Math.max(0.02, Math.min(50.0, msg.dustVisibilityKm))
    : undefined;
  const foliageDepthM = msg?.foliageDepthM !== undefined && Number.isFinite(msg.foliageDepthM)
    ? Math.max(0.0, Math.min(500.0, msg.foliageDepthM))
    : undefined;
  const weatherCells = Array.isArray(msg?.weatherCells) ? msg.weatherCells : undefined;
  const demError = msg?.demLookaheadErrorStdM !== undefined && Number.isFinite(msg.demLookaheadErrorStdM)
    ? Math.max(0.0, Math.min(25.0, msg.demLookaheadErrorStdM))
    : currentEnv.demLookaheadErrorStdM;
  const trafficScale = msg?.trafficLoadMultiplier !== undefined && Number.isFinite(msg.trafficLoadMultiplier)
    ? Math.max(0.25, Math.min(8.0, msg.trafficLoadMultiplier))
    : (currentEnv.trafficLoadMultiplier ?? 1.0);
  const jammerEnabled = msg?.jammerEnabled !== undefined ? Boolean(msg.jammerEnabled) : currentEnv.jammerEnabled;
  const jammerEirpDbm = msg?.jammerEirpDbm !== undefined && Number.isFinite(msg.jammerEirpDbm)
    ? msg.jammerEirpDbm
    : currentEnv.jammerEirpDbm;
  const activeRelayEnabled = msg?.activeRelayEnabled !== undefined ? Boolean(msg.activeRelayEnabled) : currentEnv.activeRelayEnabled;
  const ricianFadingEnabled = msg?.ricianFadingEnabled !== undefined ? Boolean(msg.ricianFadingEnabled) : currentEnv.ricianFadingEnabled;
  const cqiFeedbackDelayMs = msg?.cqiFeedbackDelayMs !== undefined && Number.isFinite(msg.cqiFeedbackDelayMs)
    ? msg.cqiFeedbackDelayMs
    : currentEnv.cqiFeedbackDelayMs;
  const kFactor = msg?.earthRadiusFactorK !== undefined && Number.isFinite(msg.earthRadiusFactorK)
    ? Math.max(0.5, Math.min(10.0, msg.earthRadiusFactorK))
    : currentEnv.earthRadiusFactorK;

  const nextEnvConfig = new EnvironmentConfig({
    ...currentEnv,
    demLookaheadErrorStdM: demError,
    trafficLoadMultiplier: trafficScale,
    jammerEnabled,
    jammerEirpDbm,
    activeRelayEnabled,
    ricianFadingEnabled,
    cqiFeedbackDelayMs,
    earthRadiusFactorK: kFactor,
    effectiveEarthRadiusFactor: kFactor,
  });

  const clearSinrHistory = msg?.ricianFadingEnabled !== undefined && !msg.ricianFadingEnabled;
  const needsObstructionRefresh =
    msg?.activeRelayEnabled !== undefined ||
    msg?.ricianFadingEnabled !== undefined ||
    msg?.cqiFeedbackDelayMs !== undefined ||
    msg?.earthRadiusFactorK !== undefined;

  return {
    viewshedEnabled,
    recomputeRelayAdvisor,
    nextEnvConfig,
    trafficScale,
    clearSinrHistory,
    needsObstructionRefresh,
    enableAirframeShadowing,
    enableCorrelatedRicianFading,
    enableMacPhyFeedback,
    enableDubinsKinematics,
    viewshedFidelityMode,
    biomeId,
    enableBiomeEmPhysics,
    polarizationMode,
    dustVisibilityKm,
    foliageDepthM,
    weatherCells,
    enableTransportAbr,
    eccmMode,
    enableMvdrNullSteering,
    enableAdversaryEsmModel,
    gnssSpoofingRateUsPerSec,
    enableAntiSpoofHoldover,
    acnConstellationCount,
    enableMultiHopManet,
    enableGroundConvoyMobility,
    windSpeedMs,
    windDirectionDeg,
    enableAutoCfitPullUp,
  };
}

/**
 * Resolves viewshed configuration and active relay updates for SET_VIEWSHED_CONFIG.
 */
export function resolveViewshedConfig(
  msg: any,
  currentEnv: EnvironmentConfig
): {
  viewshedEnabled?: boolean;
  recomputeRelayAdvisor: boolean;
  nextEnvConfig?: EnvironmentConfig;
  needsObstructionRefresh: boolean;
} {
  const viewshedEnabled = msg?.viewshedEnabled !== undefined ? Boolean(msg.viewshedEnabled) : undefined;
  const recomputeRelayAdvisor = Boolean(msg?.recomputeRelayAdvisor);
  let nextEnvConfig: EnvironmentConfig | undefined;
  let needsObstructionRefresh = false;
  if (msg?.activeRelayEnabled !== undefined) {
    nextEnvConfig = new EnvironmentConfig({
      ...currentEnv,
      activeRelayEnabled: Boolean(msg.activeRelayEnabled),
    });
    needsObstructionRefresh = true;
  }
  return {
    viewshedEnabled,
    recomputeRelayAdvisor,
    nextEnvConfig,
    needsObstructionRefresh,
  };
}

/**
 * Validates inbound SET_BIOME command payloads.
 */
export function validateSetBiomeCommand(msg: any): {
  valid: boolean;
  reason?: string;
  biomeId?: BiomeId;
  enableBiomeEmPhysics?: boolean;
  polarizationMode?: PolarizationMode;
  dustVisibilityKm?: number;
  foliageDepthM?: number;
  weatherCells?: readonly AdvectingWeatherCell[];
} {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, reason: 'Command payload must be an object.' };
  }
  const validBiomes: BiomeId[] = [
    'alpine_mountain',
    'arid_desert',
    'open_plains',
    'tropical_jungle',
    'maritime_littoral',
  ];
  if (!validBiomes.includes(msg.biomeId)) {
    return { valid: false, reason: `Invalid biomeId: ${String(msg.biomeId)}. Must be one of ${validBiomes.join(', ')}` };
  }
  const biomeId = msg.biomeId as BiomeId;
  const enableBiomeEmPhysics = msg.enableBiomeEmPhysics !== undefined ? Boolean(msg.enableBiomeEmPhysics) : undefined;
  const polarizationMode = (msg.polarizationMode === 'RHCP' || msg.polarizationMode === 'LHCP' || msg.polarizationMode === 'LINEAR_V' || msg.polarizationMode === 'LINEAR_H')
    ? (msg.polarizationMode as PolarizationMode)
    : undefined;
  const dustVisibilityKm = msg.dustVisibilityKm !== undefined && Number.isFinite(msg.dustVisibilityKm)
    ? Math.max(0.02, Math.min(50.0, msg.dustVisibilityKm))
    : undefined;
  const foliageDepthM = msg.foliageDepthM !== undefined && Number.isFinite(msg.foliageDepthM)
    ? Math.max(0.0, Math.min(500.0, msg.foliageDepthM))
    : undefined;
  const weatherCells = Array.isArray(msg.weatherCells) ? msg.weatherCells : undefined;

  return {
    valid: true,
    biomeId,
    enableBiomeEmPhysics,
    polarizationMode,
    dustVisibilityKm,
    foliageDepthM,
    weatherCells,
  };
}
