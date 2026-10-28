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
   * ITU-R P.676 Gaseous Absorption for 8.0 GHz Tactical X-band.
   * Specific attenuation gamma_g = 0.012 dB/km in clear alpine troposphere.
   */
  public static computeGaseousAttenuationDb(slantRangeM: number): number {
    return 0.012 * (slantRangeM / 1000.0);
  }

  /**
   * ITU-R P.838-3 Hydrometeor Rain Attenuation for 8.0 GHz (Horizontal polarization).
   * k_H = 0.00411, alpha_H = 1.390
   * gamma_R = k_H * (rainRate ^ alpha_H) dB/km
   * Effective path capped by rain cell extent.
   */
  public static computeRainAttenuationDb(slantRangeM: number, env: EnvironmentConfig): number {
    if (env.rainRateMmH <= 0.0) {
      return 0.0;
    }
    const kH = 0.00411;
    const alphaH = 1.39;
    const gammaR = kH * Math.pow(env.rainRateMmH, alphaH);
    const rainPathKm = Math.min(slantRangeM / 1000.0, env.rainCellLengthKm);
    return gammaR * rainPathKm;
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
    env: EnvironmentConfig
  ): LinkStatus {
    const fsplDb = LinkBudgetEngine.computeFsplDb(slantRangeM, rf.carrierFrequencyHz, rf.speedOfLight);
    const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(slantRangeM);
    const rainLossDb = LinkBudgetEngine.computeRainAttenuationDb(slantRangeM, env);

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
    const { txPowerDbm, antennaGainDbi } = rf.getTransmitterParams(nodeType);
    const rxGainDbi = rf.acnAntennaGainDbi;

    // Received signal power at ACN LNA input
    const prxDbm = txPowerDbm + antennaGainDbi + rxGainDbi - totalLossDb;

    // Thermal noise floor
    const { pNoiseDbm } = LinkBudgetEngine.computeThermalNoiseFloorDbm(
      rf.channelBandwidthHz,
      rf.acnNoiseFigureDb,
      env.atmosphericTemperatureK,
      rf.boltzmannConstant
    );

    // Net Signal-to-Noise Ratio (SNR)
    const snrDb = prxDbm - pNoiseDbm;

    // Dynamic MODCOD selection & capacity mapping
    const modcod = LinkBudgetEngine.selectModCod(snrDb);
    const isOutage = modcod.name === 'LINK_OUTAGE';
    const spectralEfficiency = isOutage ? 0.0 : modcod.spectralEfficiencyBpsHz;
    const bitrateBps = isOutage ? 0.0 : spectralEfficiency * rf.channelBandwidthHz;
    const bitrateMbps = bitrateBps / 1.0e6;

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
      modcodName: modcod.name,
      spectralEfficiency,
      bitrateBps,
      bitrateMbps,
      isOutage,
    };
  }
}