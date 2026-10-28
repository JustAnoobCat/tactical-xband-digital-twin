/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Core Configuration Module (TypeScript Port)
 *
 * Implements physical constants, tactical RF payload specifications,
 * ITU-R propagation environment geometry (P.834, P.676, P.838),
 * and Aerial Communication Node (ACN) orbital kinematics parameters.
 */

export const SPEED_OF_LIGHT = 299792458.0; // Exact SI constant (m/s)
export const BOLTZMANN_CONSTANT = 1.380649e-23; // Exact SI constant (J/K)

export type NodeType = 'soldier' | 'mcp' | 'acn';

/** Authoritative IDs for the registered ground-node population. */
export const GROUND_NODE_IDS: readonly number[] = Object.freeze(Array.from({ length: 16 }, (_, id) => id));

export interface TransmitterParams {
  readonly txPowerDbm: number;
  readonly antennaGainDbi: number;
}

export interface IRFConfig {
  readonly carrierFrequencyHz: number;
  readonly channelBandwidthHz: number;
  readonly acnTxPowerDbm: number;
  readonly acnAntennaGainDbi: number;
  readonly acnNoiseFigureDb: number;
  readonly soldierTxPowerDbm: number;
  readonly soldierAntennaGainDbi: number;
  readonly mcpTxPowerDbm: number;
  readonly mcpAntennaGainDbi: number;
  readonly implementationMarginDb: number;
  readonly cableLossDb: number;
  readonly speedOfLight: number;
  readonly boltzmannConstant: number;
}

export class RFConfig implements IRFConfig {
  public readonly carrierFrequencyHz: number;
  public readonly channelBandwidthHz: number;
  public readonly acnTxPowerDbm: number;
  public readonly acnAntennaGainDbi: number;
  public readonly acnNoiseFigureDb: number;
  public readonly soldierTxPowerDbm: number;
  public readonly soldierAntennaGainDbi: number;
  public readonly mcpTxPowerDbm: number;
  public readonly mcpAntennaGainDbi: number;
  public readonly implementationMarginDb: number;
  public readonly cableLossDb: number;
  public readonly speedOfLight: number;
  public readonly boltzmannConstant: number;

  constructor(init?: Partial<IRFConfig>) {
    this.carrierFrequencyHz = init?.carrierFrequencyHz ?? 8.0e9; // 8.0 GHz Tactical X-band
    this.channelBandwidthHz = init?.channelBandwidthHz ?? 1.0e6; // 1.0 MHz shared channel
    this.acnTxPowerDbm = init?.acnTxPowerDbm ?? 40.0; // 10 W RF power amplifier
    this.acnAntennaGainDbi = init?.acnAntennaGainDbi ?? 15.0; // Steerable array / horn
    this.acnNoiseFigureDb = init?.acnNoiseFigureDb ?? 5.0; // Low-noise receiver front-end
    this.soldierTxPowerDbm = init?.soldierTxPowerDbm ?? 36.0; // 4.0 W manpack PA
    this.soldierAntennaGainDbi = init?.soldierAntennaGainDbi ?? 3.0; // Omni whip antenna
    this.mcpTxPowerDbm = init?.mcpTxPowerDbm ?? 43.0; // 20.0 W high-power transmitter
    this.mcpAntennaGainDbi = init?.mcpAntennaGainDbi ?? 20.0; // High-gain parabolic dish
    this.implementationMarginDb = init?.implementationMarginDb ?? 2.5; // Filter ripple, ADC, phase jitter
    this.cableLossDb = init?.cableLossDb ?? 1.5; // RF feedline & connector loss
    this.speedOfLight = init?.speedOfLight ?? SPEED_OF_LIGHT;
    this.boltzmannConstant = init?.boltzmannConstant ?? BOLTZMANN_CONSTANT;
  }

  /**
   * Carrier wavelength in meters: lambda = c / f_c
   */
  public get wavelengthM(): number {
    return this.speedOfLight / this.carrierFrequencyHz;
  }

  /**
   * Resolves transmitter power and antenna gain for a given node category.
   */
  public getTransmitterParams(nodeType: NodeType | string): TransmitterParams {
    const normalized = nodeType.trim().toLowerCase();
    switch (normalized) {
      case 'soldier':
      case 'manpack':
      case 'infantry':
        return {
          txPowerDbm: this.soldierTxPowerDbm,
          antennaGainDbi: this.soldierAntennaGainDbi,
        };
      case 'mcp':
      case 'command_post':
      case 'main_command_post':
      case 'vehicular':
        return {
          txPowerDbm: this.mcpTxPowerDbm,
          antennaGainDbi: this.mcpAntennaGainDbi,
        };
      case 'acn':
      case 'airborne':
      case 'relay':
        return {
          txPowerDbm: this.acnTxPowerDbm,
          antennaGainDbi: this.acnAntennaGainDbi,
        };
      default:
        throw new Error(
          `Unrecognized nodeType: '${nodeType}'. Expected 'soldier', 'mcp', or 'acn'.`
        );
    }
  }
}

export interface IEnvironmentConfig {
  readonly effectiveEarthRadiusFactor: number;
  readonly trueEarthRadiusM: number;
  readonly rainRateMmH: number;
  readonly rainCellLengthKm: number;
  readonly atmosphericTemperatureK: number;
}

export class EnvironmentConfig implements IEnvironmentConfig {
  public readonly effectiveEarthRadiusFactor: number;
  public readonly trueEarthRadiusM: number;
  public readonly rainRateMmH: number;
  public readonly rainCellLengthKm: number;
  public readonly atmosphericTemperatureK: number;

  constructor(init?: Partial<IEnvironmentConfig>) {
    this.effectiveEarthRadiusFactor = init?.effectiveEarthRadiusFactor ?? 4.0 / 3.0; // ITU-R P.834 k-factor
    this.trueEarthRadiusM = init?.trueEarthRadiusM ?? 6371000.0; // WGS-84 volumetric mean
    this.rainRateMmH = init?.rainRateMmH ?? 0.0; // Precipitation rate (mm/h)
    this.rainCellLengthKm = init?.rainCellLengthKm ?? 10.0; // Convective cell extent
    this.atmosphericTemperatureK = init?.atmosphericTemperatureK ?? 290.0; // Ambient noise temperature (K)
  }

  /**
   * Effective Earth radius: R'_e = k * R_true (~8,494,666.67 m)
   */
  public get effectiveEarthRadiusM(): number {
    return this.trueEarthRadiusM * this.effectiveEarthRadiusFactor;
  }
}

export type ACNTrajectoryMode = 'ellipse' | 'waypoints';
/** Maximum editable waypoints keeps worker lookup tables bounded at 512 samples per segment. */
export const MAX_ACN_WAYPOINTS = 64;

/** A local Cartesian waypoint in metres. Waypoint loops close from last to first. */
export interface ACNWaypoint {
  readonly xM: number;
  readonly yM: number;
}

export interface IACNFlightConfig {
  readonly trajectoryMode: ACNTrajectoryMode;
  readonly waypoints: readonly ACNWaypoint[];
  readonly altitudeMslM: number;
  readonly loiterRadiusAM: number;
  readonly loiterRadiusBM: number;
  readonly loiterRotationDeg: number;
  readonly loiterSpeedMps: number;
  readonly centerXm: number;
  readonly centerYm: number;
  readonly coverageRadiusKm: number;
}

export class ACNFlightConfig implements IACNFlightConfig {
  public readonly trajectoryMode: ACNTrajectoryMode;
  public readonly waypoints: readonly ACNWaypoint[];
  public readonly altitudeMslM: number;
  public readonly loiterRadiusAM: number; // Semi-major axis (m)
  public readonly loiterRadiusBM: number; // Semi-minor axis (m)
  public readonly loiterRotationDeg: number; // Elliptical inclination angle (deg)
  public readonly loiterSpeedMps: number; // Constant true airspeed (m/s)
  public readonly centerXm: number; // Orbit center X (m)
  public readonly centerYm: number; // Orbit center Y (m)
  public readonly coverageRadiusKm: number; // Radio footprint radius (km)

  constructor(init?: Partial<IACNFlightConfig>) {
    this.trajectoryMode = init?.trajectoryMode ?? 'ellipse';
    this.waypoints = Object.freeze((init?.waypoints ?? []).map(point => Object.freeze({ xM: point.xM, yM: point.yM })));
    this.altitudeMslM = init?.altitudeMslM ?? 5000.0;
    this.loiterRadiusAM = init?.loiterRadiusAM ?? 20000.0;
    this.loiterRadiusBM = init?.loiterRadiusBM ?? 10000.0;
    this.loiterRotationDeg = init?.loiterRotationDeg ?? 35.0;
    this.loiterSpeedMps = init?.loiterSpeedMps ?? 60.0;
    this.centerXm = init?.centerXm ?? 0.0;
    this.centerYm = init?.centerYm ?? 0.0;
    this.coverageRadiusKm = init?.coverageRadiusKm ?? 35.0;
  }

  public get coverageRadiusM(): number {
    return this.coverageRadiusKm * 1000.0;
  }
}

export const DEFAULT_RF_CONFIG = new RFConfig();
export const DEFAULT_ENVIRONMENT_CONFIG = new EnvironmentConfig();
export const DEFAULT_ACN_FLIGHT_CONFIG = new ACNFlightConfig();
