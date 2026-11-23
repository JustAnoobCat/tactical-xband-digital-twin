/**
 * Tactical EW / ECCM, MVDR Spatial Null-Steering, Adversary ESM/ELINT LPI Engine & GNSS Spoofing
 * Specification: docs/specs/v3-03-ew-eccm-esm-lpi.md (SPEC-V3-03)
 *
 * Implements pure, functional, deterministic evaluators for:
 * 1. Spread Spectrum Processing Gain (FHSS / DSSS) with partial-band jammer penalty.
 * 2. Minimum Variance Distortionless Response (MVDR) phased array spatial null-steering.
 * 3. Joint EW Jammer Mitigation combining spatial rejection and spread spectrum gains.
 * 4. Adversary ESM / ELINT Interception Radius, LPI Safety Ratio & Intercept Probability.
 * 5. GNSS Timing Spoofing TA Drift and OCXO/atomic holdover mitigation.
 */

export type SpreadSpectrumEccmMode = 'NONE' | 'FHSS' | 'DSSS';

export interface SpreadSpectrumParams {
  readonly eccmMode: SpreadSpectrumEccmMode;
  readonly spreadBandwidthHz: number;
  readonly signalBandwidthHz: number;
  readonly partialBandJamFraction?: number;
}

export interface MvdrNullSteeringParams {
  readonly desiredAzimuthDeg: number;
  readonly jammerAzimuthDeg: number;
  readonly nullBeamwidthDeg?: number;
  readonly maxNullDepthDb?: number;
}

export interface EwJammerMitigationParams {
  readonly rawJammerPowerDbm: number;
  readonly spatialNullRejectionDb: number;
  readonly eccmProcessingGainDb: number;
  readonly desiredSignalPowerDbm?: number;
  readonly thermalNoisePowerDbm?: number;
}

export interface EwJammerMitigationResult {
  readonly effectiveJammerPowerDbm: number;
  readonly totalMitigationDb: number;
  readonly sinrImprovementDb: number;
  readonly jammerSuppressed: boolean;
}

export interface AdversaryEsmLpiParams {
  readonly txPowerDbm: number;
  readonly txGainDbi?: number;
  readonly friendlyRangeM?: number;
  readonly freqHz?: number;
  readonly esmSensitivityDbm?: number;
  readonly esmAntennaGainDbi?: number;
  readonly esmDistanceM?: number;
  readonly esmTerrainShieldDb?: number;
}

export interface AdversaryEsmLpiResult {
  readonly interceptPowerDbm: number;
  readonly detectionRadiusM: number;
  readonly detectionRadiusKm: number;
  readonly lpiSafetyRatio: number;
  readonly interceptProbability: number;
}

export interface EwEccmTelemetryParams {
  readonly eccmMode: SpreadSpectrumEccmMode;
  readonly mvdrNullSteeringEnabled: boolean;
  readonly adversaryEsmEnabled: boolean;
  readonly gnssSpoofingRateUsPerSec: number;
  readonly antiSpoofHoldoverActive: boolean;
  readonly gnssTaDriftUs: number;
  readonly meanProcessingGainDb: number;
  readonly meanSpatialNullRejectionDb: number;
  readonly meanEffectiveJammerPowerDbm: number;
  readonly rawJammerPowerDbm: number;
  readonly jammerSuppressed: boolean;
  readonly esmDetectionRadiusKm: number;
  readonly lpiSafetyRatio: number;
  readonly maxInterceptProbability: number;
  readonly gnssSpoofSlotCollision: boolean;
}

export interface EwEccmTelemetry {
  readonly eccm_mode: SpreadSpectrumEccmMode;
  readonly mvdr_null_steering_enabled: boolean;
  readonly adversary_esm_enabled: boolean;
  readonly gnss_spoofing_rate_us_per_sec: number;
  readonly anti_spoof_holdover_active: boolean;
  readonly gnss_ta_drift_us: number;
  readonly mean_processing_gain_db: number;
  readonly mean_spatial_null_rejection_db: number;
  readonly mean_effective_jammer_power_dbm: number;
  readonly raw_jammer_power_dbm: number;
  readonly jammer_suppressed: boolean;
  readonly esm_detection_radius_km: number;
  readonly lpi_safety_ratio: number;
  readonly max_intercept_probability: number;
  readonly gnss_spoof_slot_collision: boolean;
}

const SPEED_OF_LIGHT_M_S = 299792458.0;
// 20 * log10(4 * pi / c) = 20 * log10(4 * Math.PI / 299792458) = -147.55221658421886 dB
const FSPL_CONST_DB = 20.0 * Math.log10((4.0 * Math.PI) / SPEED_OF_LIGHT_M_S);

/**
 * Computes spread spectrum processing gain (Gp) in dB.
 * - 'NONE': 0.0 dB
 * - 'DSSS': 10 * log10(max(1, W_ss / W_sig))
 * - 'FHSS': Base hop gain 10 * log10(max(1, W_ss / W_sig)) reduced by partial-band jammer concentration penalty,
 *           bounded >= 0.0 dB.
 */
export function computeSpreadSpectrumProcessingGainDb(params: SpreadSpectrumParams): number {
  if (params.eccmMode === 'NONE') {
    return 0.0;
  }

  const wSs = Number.isFinite(params.spreadBandwidthHz) ? Math.max(1.0, params.spreadBandwidthHz) : 1.0;
  const wSig = Number.isFinite(params.signalBandwidthHz) ? Math.max(1.0, params.signalBandwidthHz) : 1.0;
  const bwRatio = Math.max(1.0, wSs / wSig);
  const baseGainDb = 10.0 * Math.log10(bwRatio);

  if (params.eccmMode === 'DSSS') {
    return baseGainDb;
  }

  if (params.eccmMode === 'FHSS') {
    const rawFrac = params.partialBandJamFraction;
    const rho = (rawFrac !== undefined && Number.isFinite(rawFrac))
      ? Math.max(1e-6, Math.min(1.0, rawFrac))
      : 1.0;
    // Partial-band jammer concentrates power in fraction rho of band, increasing PSD by 10*log10(1/rho) dB.
    const concentrationPenaltyDb = 10.0 * Math.log10(1.0 / rho);
    return Math.max(0.0, baseGainDb - concentrationPenaltyDb);
  }

  return 0.0;
}

/**
 * Computes MVDR adaptive beamforming spatial null rejection in dB.
 * - Computes shortest wrapped angular separation Δθ in [0, 180] deg (e.g. 359 <-> 1 wraps to 2 deg).
 * - Δθ <= 0.5 deg => 0.0 dB (collinear jammer cannot be nulled without nulling the desired signal).
 * - Δθ >= nullBeamwidthDeg => maxNullDepthDb (nominal 25.0 dB).
 * - Smooth C^1 raised-cosine ramp across (0.5 deg, nullBeamwidthDeg).
 */
export function computeMvdrNullSteeringRejectionDb(params: MvdrNullSteeringParams): number {
  const desiredAz = Number.isFinite(params.desiredAzimuthDeg) ? params.desiredAzimuthDeg : 0.0;
  const jammerAz = Number.isFinite(params.jammerAzimuthDeg) ? params.jammerAzimuthDeg : 0.0;

  // Geodetic shortest arc wrap on circle [0, 360)
  const diff = Math.abs(desiredAz - jammerAz) % 360.0;
  const deltaTheta = diff > 180.0 ? 360.0 - diff : diff;

  const nullBw = (params.nullBeamwidthDeg !== undefined && Number.isFinite(params.nullBeamwidthDeg) && params.nullBeamwidthDeg > 0.5)
    ? params.nullBeamwidthDeg
    : 12.0;
  const maxDepth = (params.maxNullDepthDb !== undefined && Number.isFinite(params.maxNullDepthDb) && params.maxNullDepthDb >= 0.0)
    ? params.maxNullDepthDb
    : 25.0;

  if (deltaTheta <= 0.5) {
    return 0.0;
  }

  if (deltaTheta >= nullBw) {
    return maxDepth;
  }

  // Smooth C^1 raised-cosine transition: x in (0, 1), f(x) = (1 - cos(pi * x)) / 2
  const x = (deltaTheta - 0.5) / (nullBw - 0.5);
  return ((1.0 - Math.cos(Math.PI * x)) / 2.0) * maxDepth;
}

/**
 * Evaluates joint EW jammer mitigation combining spatial nulling and spread spectrum processing gain.
 */
export function evaluateEwJammerMitigation(params: EwJammerMitigationParams): EwJammerMitigationResult {
  const rawJammerPowerDbm = Number.isFinite(params.rawJammerPowerDbm) ? params.rawJammerPowerDbm : -150.0;
  const spatialNullRejectionDb = Math.max(0.0, Number.isFinite(params.spatialNullRejectionDb) ? params.spatialNullRejectionDb : 0.0);
  const eccmProcessingGainDb = Math.max(0.0, Number.isFinite(params.eccmProcessingGainDb) ? params.eccmProcessingGainDb : 0.0);

  const totalMitigationDb = spatialNullRejectionDb + eccmProcessingGainDb;
  const effectiveJammerPowerDbm = rawJammerPowerDbm - totalMitigationDb;

  const nDbm = (params.thermalNoisePowerDbm !== undefined && Number.isFinite(params.thermalNoisePowerDbm))
    ? params.thermalNoisePowerDbm
    : -100.0;
  const sDbm = (params.desiredSignalPowerDbm !== undefined && Number.isFinite(params.desiredSignalPowerDbm))
    ? params.desiredSignalPowerDbm
    : -70.0;

  // Evaluate SINR improvement
  const pNoiseLinear = Math.pow(10.0, nDbm / 10.0);
  const pRawJammerLinear = Math.pow(10.0, rawJammerPowerDbm / 10.0);
  const pEffJammerLinear = Math.pow(10.0, effectiveJammerPowerDbm / 10.0);

  const rawSinrDb = sDbm - 10.0 * Math.log10(pNoiseLinear + pRawJammerLinear);
  const mitigatedSinrDb = sDbm - 10.0 * Math.log10(pNoiseLinear + pEffJammerLinear);
  const sinrImprovementDb = Math.max(0.0, mitigatedSinrDb - rawSinrDb);

  const jammerSuppressed = effectiveJammerPowerDbm <= nDbm || totalMitigationDb >= 20.0;

  return {
    effectiveJammerPowerDbm,
    totalMitigationDb,
    sinrImprovementDb,
    jammerSuppressed,
  };
}

/**
 * Evaluates adversary ESM / ELINT intercept power, free-space detection radius,
 * LPI safety ratio, and logistic intercept probability.
 * Adheres strictly to inverse-square path loss: -10 dB TX power cut shrinks R_det by exact factor sqrt(10).
 */
export function evaluateAdversaryEsmLpi(params: AdversaryEsmLpiParams): AdversaryEsmLpiResult {
  const pTxDbm = Number.isFinite(params.txPowerDbm) ? params.txPowerDbm : 30.0;
  const gTxDbi = (params.txGainDbi !== undefined && Number.isFinite(params.txGainDbi)) ? params.txGainDbi : 3.0;
  const friendlyRangeM = (params.friendlyRangeM !== undefined && Number.isFinite(params.friendlyRangeM) && params.friendlyRangeM > 0.0)
    ? params.friendlyRangeM
    : 10000.0;
  const freqHz = (params.freqHz !== undefined && Number.isFinite(params.freqHz) && params.freqHz > 0.0)
    ? params.freqHz
    : 8e9;
  const sEsmDbm = (params.esmSensitivityDbm !== undefined && Number.isFinite(params.esmSensitivityDbm))
    ? params.esmSensitivityDbm
    : -105.0;
  const gEsmDbi = (params.esmAntennaGainDbi !== undefined && Number.isFinite(params.esmAntennaGainDbi))
    ? params.esmAntennaGainDbi
    : 6.0;
  const dEsmM = (params.esmDistanceM !== undefined && Number.isFinite(params.esmDistanceM) && params.esmDistanceM > 0.0)
    ? params.esmDistanceM
    : 15000.0;
  const terrainLossDb = (params.esmTerrainShieldDb !== undefined && Number.isFinite(params.esmTerrainShieldDb))
    ? Math.max(0.0, params.esmTerrainShieldDb)
    : 0.0;

  // Free-Space Path Loss at adversary intercept distance:
  // FSPL(d, f) = 20*log10(d) + 20*log10(f) + FSPL_CONST_DB
  const freqTermDb = 20.0 * Math.log10(freqHz) + FSPL_CONST_DB;
  const fsplAtEsmDb = 20.0 * Math.log10(dEsmM) + freqTermDb;
  const interceptPowerDbm = pTxDbm + gTxDbi + gEsmDbi - fsplAtEsmDb - terrainLossDb;

  // Free-Space Detection Radius R_det where P_int == sEsmDbm:
  // sEsmDbm = pTxDbm + gTxDbi + gEsmDbi - terrainLossDb - (20*log10(R_det) + freqTermDb)
  const availablePathLossDb = pTxDbm + gTxDbi + gEsmDbi - terrainLossDb - sEsmDbm;
  let detectionRadiusM = 0.0;
  if (availablePathLossDb > freqTermDb) {
    const log10R = (availablePathLossDb - freqTermDb) / 20.0;
    detectionRadiusM = Math.pow(10.0, log10R);
  }

  const detectionRadiusKm = detectionRadiusM / 1000.0;
  const lpiSafetyRatio = friendlyRangeM / Math.max(1.0, detectionRadiusM);

  // Calibrated logistic intercept probability around sensitivity threshold
  const marginDb = interceptPowerDbm - sEsmDbm;
  const interceptProbability = 1.0 / (1.0 + Math.exp(-0.5 * marginDb));

  return {
    interceptPowerDbm,
    detectionRadiusM,
    detectionRadiusKm,
    lpiSafetyRatio,
    interceptProbability: Math.max(0.0, Math.min(1.0, interceptProbability)),
  };
}

/**
 * Computes accumulated Timing Advance (TA) drift in microseconds induced by GNSS timing spoofing.
 * - driftRateUsPerSec <= 0 or elapsedSpoofSec <= 0 => 0.0 us
 * - Linear deterministic drift min(maxDriftUs, elapsedSpoofSec * driftRateUsPerSec)
 * - Atomic/OCXO holdover reduces effective drift by 10x.
 */
export function computeGnssSpoofingTaDriftUs(
  elapsedSpoofSec: number,
  driftRateUsPerSec: number,
  maxDriftUs: number = 2000.0,
  antiSpoofHoldoverActive: boolean = false
): number {
  if (
    !Number.isFinite(driftRateUsPerSec) ||
    !Number.isFinite(elapsedSpoofSec) ||
    driftRateUsPerSec <= 0.0 ||
    elapsedSpoofSec <= 0.0
  ) {
    return 0.0;
  }

  const limitUs = (Number.isFinite(maxDriftUs) && maxDriftUs > 0.0) ? maxDriftUs : 2000.0;
  const rawDriftUs = Math.min(limitUs, elapsedSpoofSec * driftRateUsPerSec);

  return antiSpoofHoldoverActive ? rawDriftUs / 10.0 : rawDriftUs;
}

/**
 * Constructs a normalized, bounded EwEccmTelemetry record.
 */
export function buildEwEccmTelemetry(params: EwEccmTelemetryParams): EwEccmTelemetry {
  return {
    eccm_mode: params.eccmMode,
    mvdr_null_steering_enabled: params.mvdrNullSteeringEnabled,
    adversary_esm_enabled: params.adversaryEsmEnabled,
    gnss_spoofing_rate_us_per_sec: params.gnssSpoofingRateUsPerSec,
    anti_spoof_holdover_active: params.antiSpoofHoldoverActive,
    gnss_ta_drift_us: Number.isFinite(params.gnssTaDriftUs) ? params.gnssTaDriftUs : 0.0,
    mean_processing_gain_db: Number.isFinite(params.meanProcessingGainDb) ? params.meanProcessingGainDb : 0.0,
    mean_spatial_null_rejection_db: Number.isFinite(params.meanSpatialNullRejectionDb) ? params.meanSpatialNullRejectionDb : 0.0,
    mean_effective_jammer_power_dbm: Number.isFinite(params.meanEffectiveJammerPowerDbm) ? params.meanEffectiveJammerPowerDbm : -150.0,
    raw_jammer_power_dbm: Number.isFinite(params.rawJammerPowerDbm) ? params.rawJammerPowerDbm : -150.0,
    jammer_suppressed: params.jammerSuppressed,
    esm_detection_radius_km: Number.isFinite(params.esmDetectionRadiusKm) ? params.esmDetectionRadiusKm : 0.0,
    lpi_safety_ratio: Number.isFinite(params.lpiSafetyRatio) ? params.lpiSafetyRatio : 0.0,
    max_intercept_probability: Number.isFinite(params.maxInterceptProbability) ? params.maxInterceptProbability : 0.0,
    gnss_spoof_slot_collision: params.gnssSpoofSlotCollision,
  };
}

export interface NodeEwJammerMitigationParams {
  readonly rawJammerDbm: number | undefined;
  readonly eccmMode: SpreadSpectrumEccmMode;
  readonly enableMvdrNullSteering: boolean;
  readonly acnPos: [number, number, number];
  readonly jammerPosEnu: readonly [number, number] | readonly [number, number, number];
  readonly targetBearingDeg: number;
  readonly channelBandwidthHz: number;
}

export interface NodeEwJammerMitigationOutcome {
  readonly effectiveJammerDbm: number | undefined;
  readonly spatialNullRejectionDb: number;
  readonly eccmProcessingGainDb: number;
  readonly jammerSuppressed: boolean;
}

/**
 * Pure evaluator for live node/relay EW jammer mitigation combining MVDR spatial nulling and ECCM.
 */
export function computeNodeEwJammerMitigation(params: NodeEwJammerMitigationParams): NodeEwJammerMitigationOutcome {
  if (params.rawJammerDbm === undefined || (params.eccmMode === 'NONE' && !params.enableMvdrNullSteering)) {
    return {
      effectiveJammerDbm: params.rawJammerDbm,
      spatialNullRejectionDb: 0.0,
      eccmProcessingGainDb: 0.0,
      jammerSuppressed: false,
    };
  }

  let spatialNullRejectionDb = 0.0;
  if (params.enableMvdrNullSteering) {
    const jDx = params.jammerPosEnu[0] - params.acnPos[0];
    const jDy = params.jammerPosEnu[1] - params.acnPos[1];
    const jammerAzimuthDeg = Math.hypot(jDx, jDy) > 1e-3
      ? ((Math.atan2(jDx, jDy) * 180.0) / Math.PI + 360.0) % 360.0
      : 0.0;
    spatialNullRejectionDb = computeMvdrNullSteeringRejectionDb({
      desiredAzimuthDeg: params.targetBearingDeg,
      jammerAzimuthDeg,
      nullBeamwidthDeg: 12.0,
      maxNullDepthDb: 25.0,
    });
  }

  let eccmProcessingGainDb = 0.0;
  if (params.eccmMode !== 'NONE') {
    const chBwHz = Math.max(0.1e6, params.channelBandwidthHz || 1e6);
    eccmProcessingGainDb = computeSpreadSpectrumProcessingGainDb({
      eccmMode: params.eccmMode,
      spreadBandwidthHz: 20e6,
      signalBandwidthHz: chBwHz,
      partialBandJamFraction: 1.0,
    });
  }

  const ewRes = evaluateEwJammerMitigation({
    rawJammerPowerDbm: params.rawJammerDbm,
    spatialNullRejectionDb,
    eccmProcessingGainDb,
  });

  return {
    effectiveJammerDbm: ewRes.effectiveJammerPowerDbm,
    spatialNullRejectionDb,
    eccmProcessingGainDb,
    jammerSuppressed: ewRes.jammerSuppressed,
  };
}

export interface LiveEwEccmTelemetryParams {
  readonly eccmMode: SpreadSpectrumEccmMode;
  readonly enableMvdrNullSteering: boolean;
  readonly enableAdversaryEsmModel: boolean;
  readonly gnssSpoofingRateUsPerSec: number;
  readonly enableAntiSpoofHoldover: boolean;
  readonly gnssSpoofElapsedSec: number;
  readonly tdmaConfig: { fixedSlotCount?: number; frameDurationMs: number; ctrlDurationMs: number; dlMinDurationMs: number };
  readonly carrierFrequencyHz: number;
  readonly jammerShieldLossDb: number;
  readonly liveMeanProcessingGainDb: number;
  readonly liveMeanSpatialNullRejectionDb: number;
  readonly liveMeanEffectiveJammerPowerDbm: number;
  readonly liveRawJammerPowerDbm: number;
  readonly liveJammerSuppressed: boolean;
  readonly liveMaxSlantRangeM: number;
  readonly selectedNodeTxPowerDbm: number;
}

/**
 * Pure evaluator for live simulation worker EW / ECCM telemetry frames.
 */
export function evaluateLiveEwEccmTelemetry(params: LiveEwEccmTelemetryParams): EwEccmTelemetry {
  let taDriftUs = 0.0;
  if (params.gnssSpoofingRateUsPerSec > 0.0 && params.gnssSpoofElapsedSec > 0.0) {
    taDriftUs = computeGnssSpoofingTaDriftUs(params.gnssSpoofElapsedSec, params.gnssSpoofingRateUsPerSec, 2000.0, params.enableAntiSpoofHoldover);
  }
  const taDriftRangeErrorM = (SPEED_OF_LIGHT_M_S * (taDriftUs * 1e-6)) / 2.0;
  const effectiveTaResidualErrorM = 50.0 + taDriftRangeErrorM;

  const slotsPerFrame = params.tdmaConfig.fixedSlotCount ?? 16;
  const uplinkMs = Math.max(1.0, params.tdmaConfig.frameDurationMs - params.tdmaConfig.ctrlDurationMs - params.tdmaConfig.dlMinDurationMs);
  const slotDurationMs = uplinkMs / slotsPerFrame;
  const slotDurationUs = slotDurationMs * 1000.0;
  const propagationRttUs = ((2.0 * (params.liveMaxSlantRangeM || 10000.0)) / SPEED_OF_LIGHT_M_S) * 1e6;
  const taResidualRttUs = ((2.0 * effectiveTaResidualErrorM) / SPEED_OF_LIGHT_M_S) * 1e6;
  const requiredGuardUs = Math.max(20.0, taResidualRttUs + 20.0);
  const slotCollisionOutage = slotDurationUs <= 0.0 || requiredGuardUs >= slotDurationUs;

  const esmRes = evaluateAdversaryEsmLpi({
    txPowerDbm: params.selectedNodeTxPowerDbm,
    txGainDbi: 3.0,
    friendlyRangeM: params.liveMaxSlantRangeM || 10000.0,
    freqHz: params.carrierFrequencyHz,
    esmSensitivityDbm: -105.0,
    esmAntennaGainDbi: 6.0,
    esmDistanceM: 15000.0,
    esmTerrainShieldDb: params.jammerShieldLossDb,
  });

  return buildEwEccmTelemetry({
    eccmMode: params.eccmMode,
    mvdrNullSteeringEnabled: params.enableMvdrNullSteering,
    adversaryEsmEnabled: params.enableAdversaryEsmModel,
    gnssSpoofingRateUsPerSec: params.gnssSpoofingRateUsPerSec,
    antiSpoofHoldoverActive: params.enableAntiSpoofHoldover,
    gnssTaDriftUs: taDriftUs,
    meanProcessingGainDb: params.liveMeanProcessingGainDb,
    meanSpatialNullRejectionDb: params.liveMeanSpatialNullRejectionDb,
    meanEffectiveJammerPowerDbm: params.liveMeanEffectiveJammerPowerDbm,
    rawJammerPowerDbm: params.liveRawJammerPowerDbm,
    jammerSuppressed: params.liveJammerSuppressed,
    esmDetectionRadiusKm: esmRes.detectionRadiusKm,
    lpiSafetyRatio: esmRes.lpiSafetyRatio,
    maxInterceptProbability: esmRes.interceptProbability,
    gnssSpoofSlotCollision: slotCollisionOutage,
  });
}
