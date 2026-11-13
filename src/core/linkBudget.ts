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

import { EnvironmentConfig, NodeType, RFConfig } from './config';
import type { AcnSectorEvaluation, AcnSectorId } from './antennaArray';

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
}

export class LinkBudgetEngine {
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
  public static selectModCod(snrDb: number): { name: string; spectralEfficiencyBpsHz: number } {
    for (let i = 0; i < MODCOD_TABLE.length; i++) {
      const entry = MODCOD_TABLE[i];
      if (snrDb >= entry.minSnrDb) {
        return {
          name: entry.name,
          spectralEfficiencyBpsHz: entry.spectralEfficiencyBpsHz,
        };
      }
    }
    return { name: 'LINK_OUTAGE', spectralEfficiencyBpsHz: 0.0 };
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
    sectorEval?: AcnSectorEvaluation,
    nodeAltM?: number,
    acnAltM?: number
  ): LinkStatus {
    const fsplDb = LinkBudgetEngine.computeFsplDb(slantRangeM, rf.carrierFrequencyHz, rf.speedOfLight);
    const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(slantRangeM, nodeAltM, acnAltM, rf.carrierFrequencyHz);
    const rainLossDb = LinkBudgetEngine.computeRainAttenuationDb(slantRangeM, env, nodeAltM, acnAltM);

    // Sum channel losses
    const cableLossDb = rf.cableLossDb;
    const implementationMarginDb = rf.implementationMarginDb;
    const totalLossDb =
      fsplDb +
      diffractionLossDb +
      gasLossDb +
      rainLossDb +
      cableLossDb +
      implementationMarginDb;

    // Transceiver parameters
    const { txPowerDbm: defaultTxPowerDbm, antennaGainDbi } = rf.getTransmitterParams(nodeType);
    const txPowerDbm = customTxPowerDbm !== undefined && Number.isFinite(customTxPowerDbm) ? customTxPowerDbm : defaultTxPowerDbm;
    const patternRollOffDb = sectorEval ? sectorEval.patternRollOffDb : 0.0;
    const rxGainDbi = rf.acnAntennaGainDbi - patternRollOffDb;

    // Received signal power at ACN LNA input
    const prxDbm = txPowerDbm + antennaGainDbi + rxGainDbi - totalLossDb;

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
      const aAtm = gasLossDb + rainLossDb;
      const Tm = 275.0; // Mean atmospheric physical temperature (K)
      skyTemperatureK = Tm * (1.0 - Math.pow(10.0, -aAtm / 10.0));
      const T0 = 290.0; // Reference noise temperature (K)
      const noiseFactor = Math.pow(10.0, rf.acnNoiseFigureDb / 10.0);
      skyNoiseIncreaseDb = 10.0 * Math.log10(1.0 + skyTemperatureK / (T0 * noiseFactor));
      pNoiseDbm = pNoiseThermalDbm + skyNoiseIncreaseDb;
    }

    // Net Signal-to-Noise Ratio (SNR)
    const snrDb = prxDbm - pNoiseDbm;

    // Dynamic MODCOD selection & capacity mapping
    const modcod = LinkBudgetEngine.selectModCod(snrDb);
    const isOutage = obstacleBlocked || modcod.name === 'LINK_OUTAGE';
    const spectralEfficiency = isOutage ? 0.0 : modcod.spectralEfficiencyBpsHz;
    const bitrateBps = isOutage ? 0.0 : spectralEfficiency * rf.channelBandwidthHz;
    const bitrateMbps = bitrateBps / 1.0e6;

    const timingAdvanceS = slantRangeM > 0 ? (2.0 * slantRangeM) / rf.speedOfLight : 0.001;

    return {
      nodeType,
      slantRangeM,
      fsplDb,
      diffractionLossDb,
      gasLossDb,
      rainLossDb,
      cableLossDb,
      implementationMarginDb,
      totalLossDb,
      pTxDbm: txPowerDbm,
      txGainDbi: antennaGainDbi,
      rxGainDbi,
      prxDbm,
      pNoiseDbm,
      snrDb,
      modcodName: obstacleBlocked ? 'OBSTACLE_BLOCKED' : modcod.name,
      spectralEfficiency,
      bitrateBps,
      bitrateMbps,
      isOutage,
      obstacleBlocked,
      timingAdvanceS,
      skyNoiseIncreaseDb,
      skyTemperatureK,
      activeSectorId: sectorEval?.activeSectorId,
      sectorBoresightDeg: sectorEval?.sectorBoresightDeg,
      acnHeadingDeg: sectorEval?.acnHeadingDeg,
      bodyAzimuthDeg: sectorEval?.bodyAzimuthDeg,
      offBoresightAzDeg: sectorEval?.offBoresightAzDeg,
      elevationAngleDeg: sectorEval?.elevationAngleDeg,
      patternRollOffDb: sectorEval ? sectorEval.patternRollOffDb : undefined,
      allSectorGainsDbi: sectorEval?.allSectorGainsDbi,
      isCrossoverZone: sectorEval?.isCrossoverZone,
      handoverOccurred: sectorEval?.handoverOccurred,
      handoverCount: sectorEval?.handoverCount,
    };
  }
}
