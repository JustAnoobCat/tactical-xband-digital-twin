/**
 * Profile Engine for the X-Band Aerial Communication Network Digital Twin.
 *
 * Encapsulates domain propagation calculations for path profiling:
 * 1. Ground path profile elevation and curvature sampling across 80 points.
 * 2. Analytical spherical Earth bulge calculations.
 * 3. 1st Fresnel zone ellipse clearance and knife-edge diffraction geometry.
 * 4. Obstacle intersection interval projections along the 3D ray.
 * 5. Selected terminal RF link budget evaluation.
 *
 * This module is part of the authoritative domain / simulation physics layer.
 */

import type { Position3D } from '../shared/types';
import { FRESNEL_SAMPLES } from '../shared/constants';
import type {
  FresnelSliceTelemetry,
  SelectedLinkBudgetTelemetry,
} from '../shared/workerProtocol';
import { TerrainEngine, TerrainObstruction } from './terrain';
import { RFConfig, EnvironmentConfig } from './config';
import { LinkBudgetEngine, LinkStatus } from './linkBudget';
import { buildLinkProfile, LinkProfile } from './linkProfile';
import { NodeTerrainState, PredictiveState } from './trajectory';
import { GroundNodeTrafficSubsystem } from './queues';

/** Existing profile visualization/clearance factor. Does not alter terrain or link-budget decisions. */
export const PROFILE_FRESNEL_FRACTION = 0.6;

/**
 * Parameters for computing the selected node's link budget.
 */
export interface BuildSelectedLinkBudgetParams {
  readonly node: GroundNodeTrafficSubsystem;
  readonly linkStatus: LinkStatus | undefined;
  readonly obstruction: TerrainObstruction | undefined;
  readonly effectiveEarthRadiusM: number;
  readonly channelBandwidthHz: number;
}

/**
 * Computes the authoritative selected link budget with Earth curvature bulge.
 */
export function buildSelectedLinkBudget(
  params: BuildSelectedLinkBudgetParams
): SelectedLinkBudgetTelemetry {
  const { node, linkStatus, obstruction, effectiveEarthRadiusM, channelBandwidthHz } = params;
  const slantM = linkStatus?.slantRangeM ?? 0;
  const earthBulgeM = TerrainEngine.computeEarthBulge(
    slantM / 2.0,
    slantM / 2.0,
    effectiveEarthRadiusM
  );
  return {
    node_id: node.nodeId,
    node_type: node.nodeType,
    slant_range_m: slantM,
    slant_range_km: slantM / 1000.0,
    fspl_db: linkStatus?.fsplDb ?? 0,
    diffraction_loss_db: linkStatus?.diffractionLossDb ?? obstruction?.diffractionLossDb ?? 0,
    gas_loss_db: linkStatus?.gasLossDb ?? 0,
    rain_loss_db: linkStatus?.rainLossDb ?? 0,
    cable_loss_db: linkStatus?.cableLossDb ?? 0,
    implementation_margin_db: linkStatus?.implementationMarginDb ?? 0,
    total_loss_db: linkStatus?.totalLossDb ?? 0,
    tx_power_dbm: linkStatus?.pTxDbm ?? 0,
    tx_gain_dbi: linkStatus?.txGainDbi ?? 0,
    rx_gain_dbi: linkStatus?.rxGainDbi ?? 0,
    prx_dbm: linkStatus?.prxDbm ?? 0,
    pnoise_dbm: linkStatus?.pNoiseDbm ?? 0,
    snr_db: linkStatus?.snrDb ?? -99.0,
    modcod_name: linkStatus?.modcodName ?? 'LINK_OUTAGE',
    spectral_efficiency_bps_hz: linkStatus?.spectralEfficiency ?? 0,
    bitrate_bps: linkStatus?.bitrateBps ?? 0,
    bitrate_mbps: linkStatus?.bitrateMbps ?? 0,
    is_outage: linkStatus?.isOutage ?? true,
    obstacle_blocked: linkStatus?.obstacleBlocked ?? false,
    terrain_is_los: obstruction?.isLos ?? true,
    earth_bulge_m: earthBulgeM,
    channel_bandwidth_hz: channelBandwidthHz,
    crest_radius_m: obstruction?.crestRadiusM,
    curvature_loss_db: obstruction?.curvatureLossDb,
    bullington_apex_dist_m: obstruction?.bullingtonApexDistM,
    sky_noise_increase_db: linkStatus?.skyNoiseIncreaseDb,
    sky_temperature_k: linkStatus?.skyTemperatureK,
    is_coverage_complete: obstruction?.isCoverageComplete ?? true,
    isCoverageComplete: obstruction?.isCoverageComplete ?? true,
    coverage_note: obstruction?.coverageNote,
    coverageNote: obstruction?.coverageNote,
    radial_vel_ms: linkStatus?.radialVelocityMs ?? 0.0,
    doppler_shift_hz: linkStatus?.dopplerShiftHz ?? 0.0,
    doppler_rate_hz_s: linkStatus?.dopplerRateHzS ?? 0.0,
    jammer_interference_dbm: linkStatus?.jammerInterferenceDbm,
    sinr_db: linkStatus?.sinrDb ?? linkStatus?.snrDb ?? -99.0,
  };
}

/**
 * Empty/unregistered Fresnel slice fallback when no ground node is selected or present.
 */
export function buildEmptyFresnelSlice(
  frameIndex: number,
  simTimeS: number,
  acnPos: [number, number, number]
): FresnelSliceTelemetry {
  return {
    profile: {
      selectedGroundNodeId: -1,
      nodeName: 'NONE',
      frameIndex,
      simulationTimeS: simTimeS,
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

/**
 * Parameters for building the complete ground path profile and Fresnel slice telemetry.
 */
export interface BuildFresnelSliceParams {
  readonly node: GroundNodeTrafficSubsystem;
  readonly resolvedName: string;
  readonly acnPos: [number, number, number];
  readonly frameIndex: number;
  readonly simTimeS: number;
  readonly rfConfig: RFConfig;
  readonly envConfig: EnvironmentConfig;
  readonly terrainEngine: TerrainEngine;
  readonly linkEngine: LinkBudgetEngine;
  readonly obstruction: TerrainObstruction;
  readonly linkStatus: LinkStatus;
  readonly predState?: PredictiveState;
  readonly fresnelFraction?: number;
  readonly sampleCount?: number;
}

/**
 * Computes authoritative ground path profile, Fresnel clearance, and link budget for the selected node.
 */
export function buildFresnelSlice(
  params: BuildFresnelSliceParams
): FresnelSliceTelemetry {
  const {
    node,
    resolvedName,
    acnPos,
    frameIndex,
    simTimeS,
    rfConfig,
    envConfig,
    terrainEngine,
    obstruction,
    linkStatus,
    predState,
    fresnelFraction = PROFILE_FRESNEL_FRACTION,
    sampleCount = FRESNEL_SAMPLES,
  } = params;

  const linkProfile = buildLinkProfile({
    selectedGroundNodeId: node.nodeId,
    nodeName: resolvedName,
    frameIndex,
    simulationTimeS: simTimeS,
    groundNodePositionMslM: node.position,
    acnPositionMslM: acnPos,
    wavelengthM: rfConfig.wavelengthM,
    effectiveEarthRadiusM: envConfig.effectiveEarthRadiusM,
    fresnelFraction,
    sampleCount,
    obstruction,
    getTerrainElevationMslM: (xM, yM) => terrainEngine.getElevation(xM, yM),
    computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });

  // Retain the existing tuple shape for the Canvas renderer. Its first coordinate
  // is horizontal distance in km (as required for a ground path profile).
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

  const linkBudget = buildSelectedLinkBudget({
    node,
    linkStatus,
    obstruction,
    effectiveEarthRadiusM: envConfig.effectiveEarthRadiusM,
    channelBandwidthHz: rfConfig.channelBandwidthHz,
  });

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
    diffraction_loss_db: linkStatus.diffractionLossDb ?? obstruction.diffractionLossDb,
    terrain_is_los: obstruction.isLos,
    obstacle_blocked: linkStatus.obstacleBlocked ?? false,
    obstacle_intersections: obstruction.obstacleIntersections,
    state_name: predState?.currentState ?? NodeTerrainState.NORMAL_LOS,
    crest_radius_m: obstruction.crestRadiusM,
    curvature_loss_db: obstruction.curvatureLossDb,
    bullington_apex_dist_m: obstruction.bullingtonApexDistM,
    profile_points: profilePoints,
    link_budget: linkBudget,
    is_coverage_complete: isCoverageComplete,
    coverage_note: obstruction.coverageNote ?? linkProfile.invalidReason,
  };
}
