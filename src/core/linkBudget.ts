/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Link Budget & Adaptive Modulation Engine (TypeScript Port)
 *
 * Implements:
 * 1. Free Space Path Loss (FSPL) and Friis transmission equation.
 * 2. ITU-R P.676 atmospheric gas absorption (0.012 dB/km at 8.0 GHz).
 * 3. ITU-R P.838-3 specific rain attenuation.
 * 4. Receiver thermal noise floor over 1.0 MHz bandwidth.
 * 5. DVB-S2X / 3GPP Rel-17 NTN discrete 8-state MODCOD table with 2.5 dB margin.
 */

import { EnvironmentConfig, NodeType, RFConfig, SPEED_OF_LIGHT } from './config';
import {
  type AcnSectorEvaluation,
  type AcnSectorId,
  worldLosToBodyFrame,
  computeAirframeShadowLossDb,
  type AttitudeEulerDeg,
} from './antennaArray';
import type { Position3D } from '../shared/types';
import {
  DEFAULT_K_FACTOR,
  DEFAULT_TRUE_EARTH_RADIUS_M,
  DEFAULT_X_BAND_WAVELENGTH_M,
  computeBullingtonDiffraction,
  computeDeygoutMultiEdgeDiffraction,
  computeSingleEdgeProfileDiffraction,
  computeCorrelatedRicianJakesFading,
  type BullingtonDiffractionResult,
  type DeygoutMultiEdgeResult,
  type CorrelatedRicianJakesParams,
  type CorrelatedRicianJakesResult,
} from './rfPropagationMath';
import {
  type BiomeEmParameters,
  type BiomeId,
  type PolarizationMode,
  THEATER_BIOMES,
  computeTwoRayGroundReflectionDb,
  computeItuR833VegetationLossDb,
  computeGoldhirshDustAttenuationDb,
  computePolarizationMismatchLossDb,
  evaluateAdvectingWeatherCellsRainMmH,
} from './biomePhysics';

export type { BullingtonDiffractionResult, DeygoutMultiEdgeResult, CorrelatedRicianJakesParams, CorrelatedRicianJakesResult };

export interface ModCodEntry {
  readonly name: string;
  readonly minSnrDb: number;
  readonly spectralEfficiencyBpsHz: number;
}

/**
 * DVB-S2X / 3GPP Rel-17 Non-Terrestrial Network (NTN) MODCOD Table
 * Ordered descending by SNR threshold for optimal rate matching.
 */
export const MODCOD_TABLE: readonly ModCodEntry[] = [
  { name: '64-APSK 5/6', minSnrDb: 22.0, spectralEfficiencyBpsHz: 4.95 },
  { name: '32-APSK 3/4', minSnrDb: 17.5, spectralEfficiencyBpsHz: 3.70 },
  { name: '16-APSK 4/5', minSnrDb: 14.0, spectralEfficiencyBpsHz: 3.16 },
  { name: '16-APSK 2/3', minSnrDb: 11.5, spectralEfficiencyBpsHz: 2.64 },
  { name: '8-PSK 3/5',   minSnrDb: 8.0,  spectralEfficiencyBpsHz: 1.78 },
  { name: 'QPSK 3/4',    minSnrDb: 5.5,  spectralEfficiencyBpsHz: 1.49 },
  { name: 'QPSK 1/2',    minSnrDb: 2.5,  spectralEfficiencyBpsHz: 0.99 },
  { name: 'pi/2-BPSK 1/3', minSnrDb: -1.5, spectralEfficiencyBpsHz: 0.33 },
] as const;

export interface LinkStatus {
  readonly nodeType: NodeType | string;
  readonly slantRangeM: number;
  readonly fsplDb: number;
  readonly diffractionLossDb: number;
  readonly gasLossDb: number;
  readonly rainLossDb: number;
  readonly cableLossDb: number;
  readonly implementationMarginDb: number;
  readonly totalLossDb: number;
  readonly pTxDbm: number;
  readonly txGainDbi: number;
  readonly rxGainDbi: number;
  readonly prxDbm: number;
  readonly pNoiseDbm: number;
  readonly snrDb: number;
  readonly modcodName: string;
  readonly spectralEfficiency: number;
  readonly bitrateBps: number;
  readonly bitrateMbps: number;
  readonly isOutage: boolean;
  /** True when geometry intersects a screening-only obstacle; no attenuation is inferred. */
  readonly obstacleBlocked?: boolean;
  readonly timingAdvanceS?: number;
  readonly timingAdvanceUs?: number;
  readonly crestRadiusM?: number;
  readonly curvatureLossDb?: number;
  readonly skyNoiseIncreaseDb?: number;
  readonly skyTemperatureK?: number;
  readonly activeSectorId?: AcnSectorId;
  readonly sectorBoresightDeg?: 0 | 90 | 180 | 270;
  readonly acnHeadingDeg?: number;
  readonly bodyAzimuthDeg?: number;
  readonly offBoresightAzDeg?: number;
  readonly elevationAngleDeg?: number;
  readonly patternRollOffDb?: number;
  readonly allSectorGainsDbi?: readonly [number, number, number, number];
  readonly isCrossoverZone?: boolean;
  readonly handoverOccurred?: boolean;
  readonly handoverCount?: number;
  readonly radialVelocityMs?: number;
  readonly dopplerShiftHz?: number;
  readonly dopplerRateHzS?: number;
  readonly jammerInterferenceDbm?: number;
  readonly sinrDb?: number;
  readonly isRelayed?: boolean;
  readonly relayHop1BitrateMbps?: number;
  readonly relayHop2BitrateMbps?: number;
  readonly relayHop1SnrDb?: number;
  readonly relayHop2SnrDb?: number;
  readonly ricianKFactorDb?: number;
  readonly ricianFadingGainDb?: number;
  readonly ollaMarginDb?: number;
  readonly cqiDecodeFailure?: boolean;
  readonly diffractionModel?: 'deygout-multiedge' | 'bullington' | 'single-edge';
  readonly secondaryDiffractionEdges?: number;
  readonly airframeShadowLossDb?: number;
  readonly bodyElevationDeg?: number;
  readonly correlatedFadingDb?: number;
  readonly coherenceTimeMs?: number;
  readonly twoRayDeltaDb?: number;
  readonly vegetationLossDb?: number;
  readonly dustStormLossDb?: number;
  readonly polarizationLossDb?: number;
  readonly weatherCellRainMmH?: number;
  readonly biomeId?: BiomeId;
}

export interface AirframeChannelOptions {
  readonly uavAttitude?: AttitudeEulerDeg;
  readonly antennaMount?: 'belly' | 'dorsal';
  readonly enableAirframeShadowing?: boolean;
  readonly losVectorEnu?: { losEast: number; losNorth: number; losUp: number } | readonly [number, number, number];
  readonly correlatedFadingParams?: CorrelatedRicianJakesParams;
  readonly biomeEmParams?: BiomeEmParameters;
}

export class LinkBudgetEngine {
  /**
   * First-principles 8.0 GHz 3D Kinematic Doppler frequency shift (f_d) and analytical
   * drift rate (f_d_dot) between ACN and stationary ground node.
   *
   * Formulations:
   * 1. Line-of-sight unit vector: d_vec = r_node - r_acn, d_3d = max(||d_vec||, 1.0), u_hat = d_vec / d_3d
   * 2. Radial velocity (v_rad > 0 when closing): v_rad = v_acn . u_hat
   * 3. Carrier Doppler shift: f_d = (f_c / c) * v_rad
   * 4. Analytical Doppler drift rate: f_d_dot = (f_c / c) * (a_acn . u_hat - (||v_acn||^2 - v_rad^2) / d_3d)
   */
  public static computeDopplerKinematics(
    acnPos: Position3D,
    acnVel: Position3D,
    nodePos: Position3D,
    carrierFreqHz: number = 8.0e9,
    acnAccel: Position3D = [0, 0, 0]
  ): { radialVelocityMs: number; dopplerShiftHz: number; dopplerRateHzS: number } {
    const dx = nodePos[0] - acnPos[0];
    const dy = nodePos[1] - acnPos[1];
    const dz = nodePos[2] - acnPos[2];
    const slantDistM = Math.hypot(dx, dy, dz);
    const d3dM = Math.max(slantDistM, 1.0);
    const ux = dx / d3dM;
    const uy = dy / d3dM;
    const uz = dz / d3dM;

    const radialVelocityMs = acnVel[0] * ux + acnVel[1] * uy + acnVel[2] * uz;
    const c = SPEED_OF_LIGHT;
    const dopplerShiftHz = (carrierFreqHz / c) * radialVelocityMs;

    const vNormSq = acnVel[0] * acnVel[0] + acnVel[1] * acnVel[1] + acnVel[2] * acnVel[2];
    const aDotU = acnAccel[0] * ux + acnAccel[1] * uy + acnAccel[2] * uz;
    const transverseTerm = (vNormSq - radialVelocityMs * radialVelocityMs) / d3dM;
    const dopplerRateHzS = (carrierFreqHz / c) * (aDotU - transverseTerm);

    return {
      radialVelocityMs,
      dopplerShiftHz,
      dopplerRateHzS,
    };
  }

  /**
   * 3GPP TR 38.811 Elevation- and Diffraction-Coupled Rician Multipath Fading Synthesis.
   *
   * 1. 3GPP TR 38.811 Elevation & Diffraction-Coupled Rician K-factor (dB):
   *    K_dB = clamp_{[-2.0, 20.0]}(4.0 + 13.5 * sin(max(|theta_el|, 2.0 deg) * pi / 180) - 0.35 * min(max(L_diff, 0), 25.0))
   *    K_lin = 10^(K_dB / 10.0)
   *
   * 2. Deterministic Clarke / Jakes Doppler-Coherent Sum-of-Sinusoids (M = 6 scatterers):
   *    A_s = sqrt(K_lin / (K_lin + 1.0))
   *    sigma_d = sqrt(1.0 / ((K_lin + 1.0) * 6.0))
   *    f_max = max(|f_d|, 12.0) Hz (12 Hz floor for airframe vibration / clutter micro-Doppler)
   *    For m = 0..5:
   *      alpha_m = (2m + 1) * pi / 12
   *      psi_{i,m} = nodeId * 1.618034 + m * 2.399963
   *      theta_m(t) = 2 * pi * f_max * t * cos(alpha_m) + psi_{i,m}
   *      I_mp = sigma_d * sum(cos(theta_m(t)))
   *      Q_mp = sigma_d * sum(sin(theta_m(t)))
   *    P_env = (A_s + I_mp)^2 + Q_mp^2
   *    G_Rice,dB = clamp_{[-12.0, 4.5]}(10 * log10(max(P_env, 0.0631)))
   */
  public static computeRicianMultipathFading(
    nodeId: number,
    simTimeS: number,
    elevationAngleDeg: number,
    diffractionLossDb: number,
    dopplerShiftHz: number
  ): { ricianKFactorDb: number; fadingGainDb: number } {
    const absElevDeg = Math.abs(elevationAngleDeg);
    const effElevDeg = Math.max(absElevDeg, 2.0);
    const elevRad = (effElevDeg * Math.PI) / 180.0;
    const effDiffDb = Math.min(Math.max(diffractionLossDb, 0.0), 25.0);

    const rawKDb = 4.0 + 13.5 * Math.sin(elevRad) - 0.35 * effDiffDb;
    const ricianKFactorDb = Math.max(-2.0, Math.min(20.0, rawKDb));
    const kLin = Math.pow(10.0, ricianKFactorDb / 10.0);

    const as = Math.sqrt(kLin / (kLin + 1.0));
    const sigmaD = Math.sqrt(1.0 / ((kLin + 1.0) * 6.0));
    const fMax = Math.max(Math.abs(dopplerShiftHz), 12.0);

    let sumCos = 0.0;
    let sumSin = 0.0;
    const twoPiFMaxT = 2.0 * Math.PI * fMax * simTimeS;

    for (let m = 0; m < 6; m++) {
      const alphaM = ((2 * m + 1) * Math.PI) / 12.0;
      const psiIm = nodeId * 1.618034 + m * 2.399963;
      const thetaM = twoPiFMaxT * Math.cos(alphaM) + psiIm;
      sumCos += Math.cos(thetaM);
      sumSin += Math.sin(thetaM);
    }

    const imp = sigmaD * sumCos;
    const qmp = sigmaD * sumSin;
    const pEnv = (as + imp) * (as + imp) + qmp * qmp;
    const safePEnv = Math.max(pEnv, 0.0631);
    const rawFadingGainDb = 10.0 * Math.log10(safePEnv);
    const fadingGainDb = Math.max(-12.0, Math.min(4.5, rawFadingGainDb));

    return {
      ricianKFactorDb,
      fadingGainDb,
    };
  }

  /**
   * Computes Free Space Path Loss (FSPL) in dB:
   * FSPL = 20*log10(d) + 20*log10(fc) + 20*log10(4*pi/c)
   */
  public static computeFsplDb(slantRangeM: number, fcHz: number, speedOfLightMps: number): number {
    if (slantRangeM <= 0.0) {
      throw new Error(`Slant range must be positive, got ${slantRangeM} m.`);
    }
    return (
      20.0 * Math.log10(slantRangeM) +
      20.0 * Math.log10(fcHz) +
      20.0 * Math.log10((4.0 * Math.PI) / speedOfLightMps)
    );
  }

  /**
   * ITU-R P.676-13 / P.835-6 Altitude-Integrated Gaseous Absorption for 8.0 GHz Tactical X-band.
   * Specific attenuation gamma_o,0 = 0.0072 dB/km (oxygen, scale height ho = 6000 m).
   * Specific attenuation gamma_w,0 = 0.0028 dB/km (water vapor, scale height hw = 2000 m).
   *
   * Exact fallback: If nodeAltM === undefined || acnAltM === undefined,
   * returns legacy constant: 0.012 * (Math.max(slantRangeM, 1.0) / 1000.0).
   */
  public static computeGaseousAttenuationDb(
    slantRangeM: number,
    nodeAltM?: number,
    acnAltM?: number,
    carrierFreqHz: number = 8.0e9
  ): number {
    const rangeM = Math.max(slantRangeM, 1.0);
    if (nodeAltM === undefined || acnAltM === undefined) {
      return 0.012 * (rangeM / 1000.0);
    }

    const z1 = Math.min(nodeAltM, acnAltM);
    const z2 = Math.max(nodeAltM, acnAltM);
    const ho = 6000.0;
    const gammaO0 = 0.0072;
    const hw = 2000.0;
    const gammaW0 = 0.0028;

    const eta = (alt1: number, alt2: number, H: number): number => {
      const deltaZ = Math.abs(alt2 - alt1);
      if (deltaZ > 10.0) {
        return (H / deltaZ) * (Math.exp(-alt1 / H) - Math.exp(-alt2 / H));
      } else {
        return Math.exp(-(alt1 + alt2) / (2.0 * H));
      }
    };

    const etaO = eta(z1, z2, ho);
    const etaW = eta(z1, z2, hw);
    const aGas = (gammaO0 * etaO + gammaW0 * etaW) * (rangeM / 1000.0);
    return Math.max(0.0, aGas);
  }

  /**
   * ITU-R P.838-3 / P.839-4 Hydrometeor Rain Attenuation for 8.0 GHz (Horizontal polarization).
   * k_H = 0.00411, alpha_H = 1.390
   * gamma_R = k_H * (rainRate ^ alpha_H) dB/km
   * Freezing ceiling h_R = 4800.0 m MSL (34.5°N Ladakh).
   *
   * Exact fallback: If nodeAltM === undefined || acnAltM === undefined,
   * returns legacy formula without altitude partitioning.
   */
  public static computeRainAttenuationDb(
    slantRangeM: number,
    env: EnvironmentConfig,
    nodeAltM?: number,
    acnAltM?: number
  ): number {
    const rainRate = env.rainRateMmH ?? 0.0;
    if (rainRate <= 0.0 || slantRangeM <= 0.0) {
      return 0.0;
    }
    const kH = 0.00411;
    const alphaH = 1.39;
    const gammaR = kH * Math.pow(rainRate, alphaH);
    const rainPathKm = Math.min(slantRangeM / 1000.0, env.rainCellLengthKm ?? 10.0);

    if (nodeAltM === undefined || acnAltM === undefined) {
      return gammaR * rainPathKm;
    }

    const z1 = Math.min(nodeAltM, acnAltM);
    const z2 = Math.max(nodeAltM, acnAltM);
    const hR = 4800.0; // Freezing ceiling in meters MSL

    let fLiquid: number;
    if (z1 >= hR) {
      fLiquid = 0.0;
    } else if (z2 <= hR) {
      fLiquid = 1.0;
    } else {
      const deltaZ = Math.abs(z2 - z1);
      fLiquid = deltaZ > 0.0 ? Math.max(0.0, Math.min(1.0, (hR - z1) / deltaZ)) : 1.0;
    }

    const aRain = gammaR * rainPathKm * (fLiquid + 0.08 * (1.0 - fLiquid));
    return Math.max(0.0, aRain);
  }

  /**
   * Computes thermal receiver noise floor in Watts and dBm:
   * P_noise_w = k_B * T * B * 10^(NF / 10)
   * P_noise_dbm = 10 * log10(P_noise_w * 1000)
   */
  public static computeThermalNoiseFloorDbm(
    bandwidthHz: number,
    noiseFigureDb: number,
    temperatureK: number = 290.0,
    boltzmannConstant: number = 1.380649e-23
  ): { pNoiseW: number; pNoiseDbm: number } {
    const noiseFactor = Math.pow(10.0, noiseFigureDb / 10.0);
    const pNoiseW = boltzmannConstant * temperatureK * bandwidthHz * noiseFactor;
    const pNoiseDbm = 10.0 * Math.log10(pNoiseW * 1000.0);
    return { pNoiseW, pNoiseDbm };
  }

  /**
   * Selects highest order operational DVB-S2X / 3GPP Rel-17 MODCOD for received SNR.
   */
  public static selectModCod(snrDb: number): { name: string; spectralEfficiencyBpsHz: number; minSnrDb: number } {
    for (let i = 0; i < MODCOD_TABLE.length; i++) {
      const entry = MODCOD_TABLE[i];
      if (snrDb >= entry.minSnrDb) {
        return {
          name: entry.name,
          spectralEfficiencyBpsHz: entry.spectralEfficiencyBpsHz,
          minSnrDb: entry.minSnrDb,
        };
      }
    }
    return { name: 'LINK_OUTAGE', spectralEfficiencyBpsHz: 0.0, minSnrDb: Number.NEGATIVE_INFINITY };
  }

  /**
   * Computes multi-edge diffraction loss over a sampled path profile (distancesM, elevationsM).
   *
   * @param distancesM Array of horizontal distances along path in metres
   * @param elevationsM Array of total elevations along path in metres MSL (terrain + CAD obstacles)
   * @param wavelengthM Carrier wavelength in metres (default 8.0 GHz: ~0.037474 m)
   * @param kFactor Effective Earth refraction factor (default 4/3)
   * @param earthRadiusM Mean Earth radius in metres (default 6,371,000.0 m)
   * @param model Diffraction algorithm: 'deygout-multiedge' (default), 'bullington', or 'single-edge'
   */
  public static computeProfileDiffraction(
    distancesM: ArrayLike<number>,
    elevationsM: ArrayLike<number>,
    wavelengthM: number = DEFAULT_X_BAND_WAVELENGTH_M,
    kFactor: number = DEFAULT_K_FACTOR,
    earthRadiusM: number = DEFAULT_TRUE_EARTH_RADIUS_M,
    model: 'deygout-multiedge' | 'bullington' | 'single-edge' = 'deygout-multiedge'
  ): DeygoutMultiEdgeResult {
    if (model === 'bullington') {
      const bull = computeBullingtonDiffraction(distancesM, elevationsM, wavelengthM, kFactor, earthRadiusM);
      return {
        totalLossDb: bull.lossDb,
        primaryNu: bull.nuApex,
        primaryLossDb: bull.lossDb,
        primaryEdgeIndex: -1,
        primaryEdgeDistM: bull.apexDistM,
        secondaryLeftNu: -999.0,
        secondaryLeftLossDb: 0.0,
        secondaryLeftIndex: -1,
        secondaryRightNu: -999.0,
        secondaryRightLossDb: 0.0,
        secondaryRightIndex: -1,
        secondaryEdgeCount: 0,
        bullingtonLossDb: bull.lossDb,
        correctionDb: 0.0,
        method: 'bullington',
      };
    }

    if (model === 'single-edge') {
      const se = computeSingleEdgeProfileDiffraction(distancesM, elevationsM, wavelengthM, kFactor, earthRadiusM);
      return {
        totalLossDb: se.lossDb,
        primaryNu: se.maxNu,
        primaryLossDb: se.lossDb,
        primaryEdgeIndex: se.peakIndex,
        primaryEdgeDistM: se.peakDistM,
        secondaryLeftNu: -999.0,
        secondaryLeftLossDb: 0.0,
        secondaryLeftIndex: -1,
        secondaryRightNu: -999.0,
        secondaryRightLossDb: 0.0,
        secondaryRightIndex: -1,
        secondaryEdgeCount: 0,
        bullingtonLossDb: 0.0,
        correctionDb: 0.0,
        method: 'single-edge',
      };
    }

    return computeDeygoutMultiEdgeDiffraction(distancesM, elevationsM, wavelengthM, kFactor, earthRadiusM);
  }

  /**
   * Predicts physical RF link performance, received power, net SNR,
   * adaptive MODCOD scheme, and net achievable bitrate.
   */
  public evaluateLink(
    nodeType: NodeType | string,
    slantRangeM: number,
    diffractionLossDb: number,
    rf: RFConfig,
    env: EnvironmentConfig,
    obstacleBlocked: boolean = false,
    customTxPowerDbm?: number,
    sectorEval?: AcnSectorEvaluation & { jammerInterferenceDbm?: number },
    nodeAltM?: number,
    acnAltM?: number,
    crestRadiusM?: number,
    curvatureLossDb?: number,
    jammerInterferenceDbm?: number,
    radialVelocityMs?: number,
    dopplerShiftHz?: number,
    dopplerRateHzS?: number,
    customRxGainDbi?: number,
    fadingGainDb?: number,
    ricianKFactorDb?: number,
    ollaMarginDb?: number,
    cqiDecodeFailure?: boolean,
    profile?: { distancesM: ArrayLike<number>; elevationsM: ArrayLike<number> },
    diffractionModel?: 'deygout-multiedge' | 'bullington' | 'single-edge',
    airframeOptions?: AirframeChannelOptions,
    biomeEmParams?: BiomeEmParameters
  ): LinkStatus {
    // Ergonomic normalization if caller omitted profile / diffractionModel
    let effAirframeOptions = airframeOptions;
    let effProfile = profile;
    let effDiffractionModel = diffractionModel;
    let effBiomeEmParams = biomeEmParams ?? effAirframeOptions?.biomeEmParams;

    if (
      effProfile &&
      (
        'enableAirframeShadowing' in (effProfile as any) ||
        'correlatedFadingParams' in (effProfile as any) ||
        'uavAttitude' in (effProfile as any) ||
        'antennaMount' in (effProfile as any) ||
        'enableBiomeEmPhysics' in (effProfile as any) ||
        'biomeId' in (effProfile as any)
      )
    ) {
      if ('enableBiomeEmPhysics' in (effProfile as any) || 'biomeId' in (effProfile as any)) {
        effBiomeEmParams = effProfile as any;
      } else {
        effAirframeOptions = effProfile as any;
      }
      effProfile = undefined;
    } else if (
      effDiffractionModel &&
      typeof effDiffractionModel === 'object' &&
      (
        'enableAirframeShadowing' in (effDiffractionModel as any) ||
        'correlatedFadingParams' in (effDiffractionModel as any) ||
        'uavAttitude' in (effDiffractionModel as any) ||
        'antennaMount' in (effDiffractionModel as any) ||
        'enableBiomeEmPhysics' in (effDiffractionModel as any) ||
        'biomeId' in (effDiffractionModel as any)
      )
    ) {
      if ('enableBiomeEmPhysics' in (effDiffractionModel as any) || 'biomeId' in (effDiffractionModel as any)) {
        effBiomeEmParams = effDiffractionModel as any;
      } else {
        effAirframeOptions = effDiffractionModel as any;
      }
      effDiffractionModel = undefined;
    }
    if (!effBiomeEmParams && effAirframeOptions?.biomeEmParams) {
      effBiomeEmParams = effAirframeOptions.biomeEmParams;
    }

    let effDiffractionLossDb = diffractionLossDb;
    let secondaryEdges: number | undefined = undefined;
    let modelUsed: 'deygout-multiedge' | 'bullington' | 'single-edge' | undefined = effDiffractionModel;

    if (effProfile && effProfile.distancesM.length >= 3) {
      const model = effDiffractionModel ?? 'deygout-multiedge';
      modelUsed = model;
      const wavelengthM = (rf.speedOfLight || 299792458.0) / (rf.carrierFrequencyHz || 8.0e9);
      const kFactor = env.effectiveEarthRadiusFactor ?? env.earthRadiusFactorK ?? DEFAULT_K_FACTOR;
      const diffResult = LinkBudgetEngine.computeProfileDiffraction(
        effProfile.distancesM,
        effProfile.elevationsM,
        wavelengthM,
        kFactor,
        DEFAULT_TRUE_EARTH_RADIUS_M,
        model
      );
      effDiffractionLossDb = diffResult.totalLossDb;
      secondaryEdges = diffResult.secondaryEdgeCount;
    }

    const fsplDb = LinkBudgetEngine.computeFsplDb(slantRangeM, rf.carrierFrequencyHz, rf.speedOfLight);
    const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(slantRangeM, nodeAltM, acnAltM, rf.carrierFrequencyHz);
    const rainLossDb = LinkBudgetEngine.computeRainAttenuationDb(slantRangeM, env, nodeAltM, acnAltM);

    // Biome-adaptive EM physics (Two-ray ground reflection, vegetation, dust, polarization, weather cells)
    let twoRayDeltaDb: number | undefined = undefined;
    let vegetationLossDb: number | undefined = undefined;
    let dustStormLossDb: number | undefined = undefined;
    let polarizationLossDb: number | undefined = undefined;
    let weatherCellRainMmH: number | undefined = undefined;
    let effRainLossDb = rainLossDb;

    if (effBiomeEmParams?.enableBiomeEmPhysics) {
      const bId = effBiomeEmParams.biomeId ?? 'alpine_mountain';
      const bDef = THEATER_BIOMES[bId] ?? THEATER_BIOMES.alpine_mountain;

      // Dynamic advecting weather cells
      if (effBiomeEmParams.weatherCells && effBiomeEmParams.weatherCells.length > 0) {
        const cellRes = evaluateAdvectingWeatherCellsRainMmH(
          0.0,
          0.0,
          slantRangeM,
          0.0,
          effBiomeEmParams.weatherCells,
          effBiomeEmParams.simTimeSec ?? 0.0
        );
        weatherCellRainMmH = cellRes.pathAvgRainMmH;
        if (weatherCellRainMmH > 0.0) {
          const cellEnv = new EnvironmentConfig({ ...env, rainRateMmH: (env.rainRateMmH || 0.0) + weatherCellRainMmH });
          effRainLossDb = LinkBudgetEngine.computeRainAttenuationDb(slantRangeM, cellEnv, nodeAltM, acnAltM);
        }
      }

      // 1. Two-ray ground reflection
      const txAlt = effBiomeEmParams.txAltAglM ?? (acnAltM !== undefined ? acnAltM : 1000.0);
      const rxAlt = effBiomeEmParams.rxAltAglM ?? (nodeAltM !== undefined ? nodeAltM : 10.0);
      const horizDist = effBiomeEmParams.horizontalDistM ?? Math.max(1.0, Math.sqrt(Math.max(0.0, slantRangeM * slantRangeM - Math.pow(txAlt - rxAlt, 2))));
      const isLosClear = !obstacleBlocked && effDiffractionLossDb <= 0.1;
      const pol = effBiomeEmParams.polarization ?? 'RHCP';

      const twoRayRes = computeTwoRayGroundReflectionDb({
        txAltAglM: txAlt,
        rxAltAglM: rxAlt,
        horizontalDistM: horizDist,
        freqHz: rf.carrierFrequencyHz,
        relativePermittivity: bDef.relativePermittivity,
        conductivitySm: bDef.conductivitySm,
        surfaceRoughnessM: bDef.surfaceRoughnessM,
        polarization: pol,
        isLosClear,
      });
      twoRayDeltaDb = twoRayRes.twoRayDeltaDb;

      // 2. ITU-R P.833-10 vegetation attenuation
      const foliageDepth = effBiomeEmParams.foliageDepthM !== undefined
        ? effBiomeEmParams.foliageDepthM
        : bDef.defaultFoliageDepthM;
      const regime = effBiomeEmParams.foliageRegime ?? (bId === 'tropical_jungle' ? 'tropical-dense' : 'temperate-woodland');
      vegetationLossDb = computeItuR833VegetationLossDb(rf.carrierFrequencyHz / 1e9, foliageDepth, regime);

      // 3. Goldhirsh dust storm attenuation
      const dustVis = effBiomeEmParams.dustVisibilityKm !== undefined
        ? effBiomeEmParams.dustVisibilityKm
        : bDef.defaultDustVisibilityKm;
      dustStormLossDb = computeGoldhirshDustAttenuationDb(rf.carrierFrequencyHz / 1e9, slantRangeM / 1000.0, dustVis);

      // 4. Polarization mismatch
      const relBank = effBiomeEmParams.relativeBankDeg ?? (effAirframeOptions?.uavAttitude?.rollDeg ?? 0.0);
      polarizationLossDb = computePolarizationMismatchLossDb(pol, pol, relBank, effRainLossDb);
    }

    const biomeNetLossDb =
      (vegetationLossDb ?? 0.0) +
      (dustStormLossDb ?? 0.0) +
      (polarizationLossDb ?? 0.0) -
      (twoRayDeltaDb ?? 0.0);

    // 3D Airframe attitude & shadowing
    let airframeShadowLossDb: number | undefined = undefined;
    let computedBodyAz: number | undefined = sectorEval?.bodyAzimuthDeg;
    let computedBodyEl: number | undefined = sectorEval?.elevationAngleDeg;

    if (effAirframeOptions?.enableAirframeShadowing) {
      if (effAirframeOptions.losVectorEnu && effAirframeOptions.uavAttitude) {
        const los = Array.isArray(effAirframeOptions.losVectorEnu)
          ? { losEast: effAirframeOptions.losVectorEnu[0], losNorth: effAirframeOptions.losVectorEnu[1], losUp: effAirframeOptions.losVectorEnu[2] }
          : effAirframeOptions.losVectorEnu as { losEast: number; losNorth: number; losUp: number };
        const bodyLos = worldLosToBodyFrame(los.losEast, los.losNorth, los.losUp, effAirframeOptions.uavAttitude);
        computedBodyAz = bodyLos.bodyAzimuthDeg;
        computedBodyEl = bodyLos.bodyElevationDeg;
      }
      const azForShadow = computedBodyAz ?? 0.0;
      const elForShadow = computedBodyEl ?? 0.0;
      airframeShadowLossDb = computeAirframeShadowLossDb(azForShadow, elForShadow, effAirframeOptions.antennaMount ?? 'belly');
    }

    // Sum channel losses
    const cableLossDb = rf.cableLossDb;
    const implementationMarginDb = rf.implementationMarginDb;
    const totalLossDb =
      fsplDb +
      effDiffractionLossDb +
      gasLossDb +
      effRainLossDb +
      cableLossDb +
      implementationMarginDb +
      (airframeShadowLossDb ?? 0.0) +
      biomeNetLossDb;

    // Transceiver parameters
    const { txPowerDbm: defaultTxPowerDbm, antennaGainDbi } = rf.getTransmitterParams(nodeType);
    const txPowerDbm = customTxPowerDbm !== undefined && Number.isFinite(customTxPowerDbm) ? customTxPowerDbm : defaultTxPowerDbm;
    const patternRollOffDb = sectorEval ? sectorEval.patternRollOffDb : 0.0;
    const rxGainDbi = customRxGainDbi !== undefined && Number.isFinite(customRxGainDbi)
      ? customRxGainDbi
      : (rf.acnAntennaGainDbi - patternRollOffDb);

    // 3GPP TR 38.811 Rician multipath fading gain / Time-Correlated Zheng-Xiao fading
    let effFadingGainDb = fadingGainDb;
    let effRicianKDb = ricianKFactorDb;
    let correlatedFadingDb: number | undefined = undefined;
    let coherenceTimeMs: number | undefined = undefined;

    if (effAirframeOptions?.correlatedFadingParams) {
      const corrResult = computeCorrelatedRicianJakesFading(effAirframeOptions.correlatedFadingParams);
      effFadingGainDb = corrResult.fadingGainDb;
      effRicianKDb = corrResult.ricianKFactorDb;
      correlatedFadingDb = corrResult.fadingGainDb;
      coherenceTimeMs = corrResult.coherenceTimeMs;
    } else if (effFadingGainDb === undefined && env.ricianFadingEnabled) {
      const elev = sectorEval?.elevationAngleDeg ?? 0.0;
      const fDoppler = dopplerShiftHz ?? 0.0;
      const rician = LinkBudgetEngine.computeRicianMultipathFading(0, 0, elev, diffractionLossDb, fDoppler);
      effFadingGainDb = rician.fadingGainDb;
      effRicianKDb = rician.ricianKFactorDb;
    }
    const fadingTerm = (effFadingGainDb !== undefined && Number.isFinite(effFadingGainDb)) ? effFadingGainDb : 0.0;

    // Received signal power at ACN LNA input
    const prxDbm = txPowerDbm + antennaGainDbi + rxGainDbi - totalLossDb + fadingTerm;

    // Thermal noise floor
    const { pNoiseDbm: pNoiseThermalDbm } = LinkBudgetEngine.computeThermalNoiseFloorDbm(
      rf.channelBandwidthHz,
      rf.acnNoiseFigureDb,
      env.atmosphericTemperatureK,
      rf.boltzmannConstant
    );

    // ITU-R P.618-14 Sky-Noise Coupling
    let skyNoiseIncreaseDb = 0.0;
    let skyTemperatureK = 0.0;
    let pNoiseDbm = pNoiseThermalDbm;

    if (nodeAltM !== undefined && acnAltM !== undefined) {
      const aAtm = gasLossDb + effRainLossDb;
      const Tm = 275.0; // Mean atmospheric physical temperature (K)
      skyTemperatureK = Tm * (1.0 - Math.pow(10.0, -aAtm / 10.0));
      const T0 = 290.0; // Reference noise temperature (K)
      const noiseFactor = Math.pow(10.0, rf.acnNoiseFigureDb / 10.0);
      skyNoiseIncreaseDb = 10.0 * Math.log10(1.0 + skyTemperatureK / (T0 * noiseFactor));
      pNoiseDbm = pNoiseThermalDbm + skyNoiseIncreaseDb;
    }

    // Contested Jammer Interference & Effective Physical SINR
    const effJammerInterferenceDbm = jammerInterferenceDbm !== undefined && Number.isFinite(jammerInterferenceDbm)
      ? jammerInterferenceDbm
      : (sectorEval as { jammerInterferenceDbm?: number } | undefined)?.jammerInterferenceDbm;

    let pNoiseAndInterferenceDbm = pNoiseDbm;
    let sinrDb: number;

    if (effJammerInterferenceDbm !== undefined && Number.isFinite(effJammerInterferenceDbm)) {
      const pNoiseMw = Math.pow(10.0, pNoiseDbm / 10.0);
      const pJammerMw = Math.pow(10.0, effJammerInterferenceDbm / 10.0);
      pNoiseAndInterferenceDbm = 10.0 * Math.log10(pNoiseMw + pJammerMw);
      sinrDb = prxDbm - pNoiseAndInterferenceDbm;
    } else {
      sinrDb = prxDbm - pNoiseDbm;
    }

    // Dynamic MODCOD selection & capacity mapping using effective SINR
    const snrDb = sinrDb;
    const modcod = LinkBudgetEngine.selectModCod(snrDb);
    const isOutage = obstacleBlocked || modcod.name === 'LINK_OUTAGE';
    const spectralEfficiency = isOutage ? 0.0 : modcod.spectralEfficiencyBpsHz;
    const bitrateBps = isOutage ? 0.0 : spectralEfficiency * rf.channelBandwidthHz;
    const bitrateMbps = bitrateBps / 1.0e6;

    const cSpeed = rf.speedOfLight || 299792458.0;
    const timingAdvanceS = slantRangeM > 0 ? (2.0 * slantRangeM) / cSpeed : 0.001;
    const timingAdvanceUs = slantRangeM > 0 ? ((2.0 * slantRangeM) / cSpeed) * 1e6 : 0.0;

    return {
      nodeType,
      slantRangeM,
      fsplDb,
      diffractionLossDb: effDiffractionLossDb,
      gasLossDb,
      rainLossDb: effRainLossDb,
      cableLossDb,
      implementationMarginDb,
      totalLossDb,
      pTxDbm: txPowerDbm,
      txGainDbi: antennaGainDbi,
      rxGainDbi,
      prxDbm,
      pNoiseDbm: pNoiseAndInterferenceDbm,
      snrDb,
      sinrDb,
      jammerInterferenceDbm: effJammerInterferenceDbm,
      radialVelocityMs,
      dopplerShiftHz,
      dopplerRateHzS,
      modcodName: obstacleBlocked ? 'OBSTACLE_BLOCKED' : modcod.name,
      spectralEfficiency,
      bitrateBps,
      bitrateMbps,
      isOutage,
      obstacleBlocked,
      timingAdvanceS,
      timingAdvanceUs,
      crestRadiusM,
      curvatureLossDb,
      skyNoiseIncreaseDb,
      skyTemperatureK,
      activeSectorId: sectorEval?.activeSectorId,
      sectorBoresightDeg: sectorEval?.sectorBoresightDeg,
      acnHeadingDeg: sectorEval?.acnHeadingDeg,
      bodyAzimuthDeg: computedBodyAz,
      offBoresightAzDeg: sectorEval?.offBoresightAzDeg,
      elevationAngleDeg: computedBodyEl,
      patternRollOffDb: sectorEval ? sectorEval.patternRollOffDb : undefined,
      allSectorGainsDbi: sectorEval?.allSectorGainsDbi,
      isCrossoverZone: sectorEval?.isCrossoverZone,
      handoverOccurred: sectorEval?.handoverOccurred,
      handoverCount: sectorEval?.handoverCount,
      ricianKFactorDb: effRicianKDb,
      ricianFadingGainDb: effFadingGainDb,
      ollaMarginDb,
      cqiDecodeFailure,
      diffractionModel: modelUsed,
      secondaryDiffractionEdges: secondaryEdges,
      airframeShadowLossDb,
      bodyElevationDeg: computedBodyEl,
      correlatedFadingDb,
      coherenceTimeMs,
      twoRayDeltaDb,
      vegetationLossDb,
      dustStormLossDb,
      polarizationLossDb,
      weatherCellRainMmH,
      biomeId: effBiomeEmParams?.enableBiomeEmPhysics ? effBiomeEmParams.biomeId : undefined,
    };
  }

  /**
   * Evaluates physical RF link performance with an explicit terrain + CAD obstacle elevation profile,
   * computing multi-edge diffraction via ITU-R P.526 Cascaded Deygout or Bullington.
   */
  public evaluateLinkWithProfile(
    nodeType: NodeType | string,
    slantRangeM: number,
    profile: { distancesM: ArrayLike<number>; elevationsM: ArrayLike<number> },
    rf: RFConfig,
    env: EnvironmentConfig,
    diffractionModel: 'deygout-multiedge' | 'bullington' | 'single-edge' = 'deygout-multiedge',
    obstacleBlocked: boolean = false,
    customTxPowerDbm?: number,
    sectorEval?: AcnSectorEvaluation & { jammerInterferenceDbm?: number },
    nodeAltM?: number,
    acnAltM?: number,
    crestRadiusM?: number,
    curvatureLossDb?: number,
    jammerInterferenceDbm?: number,
    radialVelocityMs?: number,
    dopplerShiftHz?: number,
    dopplerRateHzS?: number,
    customRxGainDbi?: number,
    fadingGainDb?: number,
    ricianKFactorDb?: number,
    ollaMarginDb?: number,
    cqiDecodeFailure?: boolean,
    airframeOptions?: AirframeChannelOptions
  ): LinkStatus {
    return this.evaluateLink(
      nodeType,
      slantRangeM,
      0.0,
      rf,
      env,
      obstacleBlocked,
      customTxPowerDbm,
      sectorEval,
      nodeAltM,
      acnAltM,
      crestRadiusM,
      curvatureLossDb,
      jammerInterferenceDbm,
      radialVelocityMs,
      dopplerShiftHz,
      dopplerRateHzS,
      customRxGainDbi,
      fadingGainDb,
      ricianKFactorDb,
      ollaMarginDb,
      cqiDecodeFailure,
      profile,
      diffractionModel,
      airframeOptions
    );
  }

  /**
   * Evaluates two-hop Decode-and-Forward (DF) tactical relay link geometry and harmonic capacity.
   *
   * Formulations:
   * 1. Exact half-duplex Decode-and-Forward harmonic capacity:
   *    R_DF = (R_1 * R_2) / (R_1 + R_2) [bps]
   * 2. Bottleneck SNR: min(SNR_1, SNR_2)
   * 3. Two-hop propagation delay & round-trip Timing Advance:
   *    tau_TA,DF = 2 * (d_1 + d_2) / c
   *
   * Rescues occluded terminals when directLink is in outage or R_DF exceeds direct link bitrate.
   */
  public static computeDecodeAndForwardRelayLink(
    directLink: LinkStatus,
    hop1Link: LinkStatus,
    hop2Link: LinkStatus,
    dHop1M: number,
    dHop2M: number,
    speedOfLight: number = SPEED_OF_LIGHT
  ): LinkStatus {
    if (
      hop1Link.isOutage ||
      hop2Link.isOutage ||
      hop1Link.bitrateBps <= 0 ||
      hop2Link.bitrateBps <= 0
    ) {
      return { ...directLink, isRelayed: false };
    }

    const r1 = hop1Link.bitrateBps;
    const r2 = hop2Link.bitrateBps;
    const rDf = (r1 * r2) / (r1 + r2);

    if (directLink.isOutage || rDf > directLink.bitrateBps) {
      const bottleneckSnr = Math.min(hop1Link.snrDb, hop2Link.snrDb);
      const bottleneckSinr = Math.min(
        hop1Link.sinrDb ?? hop1Link.snrDb,
        hop2Link.sinrDb ?? hop2Link.snrDb
      );
      const bottleneckModcod =
        hop1Link.snrDb <= hop2Link.snrDb
          ? hop1Link.modcodName
          : hop2Link.modcodName;
      const totalSlantM = dHop1M + dHop2M;
      const timingAdvanceS = totalSlantM > 0 ? (2.0 * totalSlantM) / speedOfLight : 0.0;
      const timingAdvanceUs = timingAdvanceS * 1e6;

      return {
        ...directLink,
        isOutage: false,
        isRelayed: true,
        bitrateBps: rDf,
        bitrateMbps: rDf / 1.0e6,
        snrDb: bottleneckSnr,
        sinrDb: bottleneckSinr,
        modcodName: `2HOP:${bottleneckModcod}`,
        activeSectorId: hop2Link.activeSectorId,
        sectorBoresightDeg: hop2Link.sectorBoresightDeg,
        slantRangeM: totalSlantM,
        timingAdvanceS,
        timingAdvanceUs,
        relayHop1BitrateMbps: hop1Link.bitrateMbps,
        relayHop2BitrateMbps: hop2Link.bitrateMbps,
        relayHop1SnrDb: hop1Link.snrDb,
        relayHop2SnrDb: hop2Link.snrDb,
        obstacleBlocked: false,
        diffractionLossDb: 0.0,
        ricianKFactorDb: directLink.ricianKFactorDb,
        ricianFadingGainDb: directLink.ricianFadingGainDb,
        ollaMarginDb: directLink.ollaMarginDb,
        cqiDecodeFailure: directLink.cqiDecodeFailure,
      };
    }

    return { ...directLink, isRelayed: false };
  }
}
