/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Trajectory & Orbital Predictive Look-Ahead Engine (TypeScript Port)
 *
 * Implements:
 * 1. Constant True Airspeed (60.0 m/s +/- 0.5 m/s) along an inclined elliptical orbit
 *    parameterized via arc-length numerical integration.
 * 2. 4-State Predictive Occlusion Machine:
 *    NORMAL_LOS -> PRE_OCCLUSION_FLUSH -> HARD_SHADOW_CUTOFF -> RE_EMERGENCE_BURST.
 */

import { ACNFlightConfig, EnvironmentConfig, RFConfig } from './config';
import { LinkBudgetEngine } from './linkBudget';
import { Position3D, TerrainEngine } from './terrain';

export enum NodeTerrainState {
  NORMAL_LOS = 'NORMAL_LOS',
  PRE_OCCLUSION_FLUSH = 'PRE_OCCLUSION_FLUSH',
  HARD_SHADOW_CUTOFF = 'HARD_SHADOW_CUTOFF',
  RE_EMERGENCE_BURST = 'RE_EMERGENCE_BURST',
}

export interface PredictiveState {
  readonly currentState: NodeTerrainState;
  readonly timeToOcclusionS: number;
  readonly timeToEmergenceS: number;
  readonly fresnelClearanceM: number;
  readonly fresnelRateOfChangeMps: number;
  readonly predictedOutageDurationS: number;
}

/**
 * Constant-Airspeed Rotated Elliptical Kinematics Engine.
 *
 * Integrates arc-length parameterized orbit so tangential speed |v| = 60.0 m/s
 * remains invariant along the rotated ellipse.
 */
export class ACNTrajectoryEngine {
  public readonly flightConfig: ACNFlightConfig;
  public readonly numLutSamples: number;
  public readonly orbitPeriodS: number;

  private readonly thetaLut: Float64Array;
  private readonly sLut: Float64Array;
  private readonly totalPerimeterM: number;

  constructor(flightConfig: ACNFlightConfig, numLutSamples: number = 2048) {
    this.flightConfig = flightConfig;
    this.numLutSamples = numLutSamples;

    const a = this.flightConfig.loiterRadiusAM;
    const b = this.flightConfig.loiterRadiusBM;
    const v0 = this.flightConfig.loiterSpeedMps;

    this.thetaLut = new Float64Array(numLutSamples);
    this.sLut = new Float64Array(numLutSamples);

    const dTheta = (2.0 * Math.PI) / (numLutSamples - 1);
    let cumulativeS = 0.0;
    this.sLut[0] = 0.0;
    this.thetaLut[0] = 0.0;

    for (let i = 1; i < numLutSamples; i++) {
      const thetaPrev = (i - 1) * dTheta;
      const thetaCurr = i * dTheta;
      this.thetaLut[i] = thetaCurr;

      const dsPrev = Math.sqrt(
        Math.pow(a * Math.sin(thetaPrev), 2) + Math.pow(b * Math.cos(thetaPrev), 2)
      );
      const dsCurr = Math.sqrt(
        Math.pow(a * Math.sin(thetaCurr), 2) + Math.pow(b * Math.cos(thetaCurr), 2)
      );

      cumulativeS += 0.5 * (dsPrev + dsCurr) * dTheta;
      this.sLut[i] = cumulativeS;
    }

    this.totalPerimeterM = this.sLut[numLutSamples - 1];
    this.orbitPeriodS = v0 > 0 ? this.totalPerimeterM / v0 : 1.0;
  }

  /**
   * Resolves eccentric angle theta at time tS using linear interpolation over arc-length LUT.
   */
  public getThetaAtTime(tS: number): number {
    if (this.totalPerimeterM <= 0.0) return 0.0;
    const v0 = this.flightConfig.loiterSpeedMps;
    let dist = (v0 * tS) % this.totalPerimeterM;
    if (dist < 0.0) dist += this.totalPerimeterM;

    // Binary search over sLut
    let low = 0;
    let high = this.numLutSamples - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.sLut[mid] < dist) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const idx = Math.max(1, Math.min(this.numLutSamples - 1, low));
    const s0 = this.sLut[idx - 1];
    const s1 = this.sLut[idx];
    const frac = s1 > s0 ? (dist - s0) / (s1 - s0) : 0.0;

    return this.thetaLut[idx - 1] + frac * (this.thetaLut[idx] - this.thetaLut[idx - 1]);
  }

  /**
   * Calculates 3D Cartesian coordinates [x, y, z] (m) at time tS along rotated ellipse.
   */
  public getAcnPosition(tS: number): [number, number, number] {
    const a = this.flightConfig.loiterRadiusAM;
    const b = this.flightConfig.loiterRadiusBM;
    const phi = (this.flightConfig.loiterRotationDeg * Math.PI) / 180.0;
    const cx = this.flightConfig.centerXm;
    const cy = this.flightConfig.centerYm;
    const cz = this.flightConfig.altitudeMslM;

    const theta = this.getThetaAtTime(tS);
    const xRaw = a * Math.cos(theta);
    const yRaw = b * Math.sin(theta);

    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    const x = cx + xRaw * cosPhi - yRaw * sinPhi;
    const y = cy + xRaw * sinPhi + yRaw * cosPhi;
    const z = cz;

    return [x, y, z];
  }

  /**
   * Calculates tangent velocity vector [vx, vy, vz] (m/s).
   * Exact magnitude sqrt(vx^2 + vy^2) equals loiterSpeedMps (60.0 m/s).
   */
  public getAcnVelocity(tS: number): [number, number, number] {
    const a = this.flightConfig.loiterRadiusAM;
    const b = this.flightConfig.loiterRadiusBM;
    const v0 = this.flightConfig.loiterSpeedMps;
    const phi = (this.flightConfig.loiterRotationDeg * Math.PI) / 180.0;

    const theta = this.getThetaAtTime(tS);
    const dsDtheta = Math.sqrt(
      Math.pow(a * Math.sin(theta), 2) + Math.pow(b * Math.cos(theta), 2)
    );
    if (dsDtheta < 1e-9) return [0.0, 0.0, 0.0];

    const dThetaDt = v0 / dsDtheta;
    const vxRaw = -a * Math.sin(theta) * dThetaDt;
    const vyRaw = b * Math.cos(theta) * dThetaDt;

    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    const vx = vxRaw * cosPhi - vyRaw * sinPhi;
    const vy = vxRaw * sinPhi + vyRaw * cosPhi;

    return [vx, vy, 0.0];
  }
}

/**
 * Predictive Look-Ahead Machine.
 *
 * Forwards UAV trajectory across terrain to anticipate mountain shadow entry
 * and exit events before physical LOS collapse.
 */
export class PredictiveLookAheadEngine {
  public readonly terrainEngine: TerrainEngine;
  public readonly linkBudgetEngine: LinkBudgetEngine;
  public readonly rfConfig: RFConfig;
  public readonly envConfig: EnvironmentConfig;
  public readonly flightConfig: ACNFlightConfig;
  public readonly trajectoryEngine: ACNTrajectoryEngine;

  public horizonS: number;
  public dtStepS: number;
  public warningTimeThresholdS: number;

  constructor(
    terrainEngine: TerrainEngine,
    linkBudgetEngine: LinkBudgetEngine,
    rfConfig: RFConfig,
    envConfig: EnvironmentConfig,
    flightConfig: ACNFlightConfig,
    trajectoryEngine?: ACNTrajectoryEngine,
    options?: {
      horizonS?: number;
      dtStepS?: number;
      warningTimeThresholdS?: number;
    }
  ) {
    this.terrainEngine = terrainEngine;
    this.linkBudgetEngine = linkBudgetEngine;
    this.rfConfig = rfConfig;
    this.envConfig = envConfig;
    this.flightConfig = flightConfig;
    this.trajectoryEngine = trajectoryEngine ?? new ACNTrajectoryEngine(flightConfig);
    this.horizonS = options?.horizonS ?? 15.0;
    this.dtStepS = options?.dtStepS ?? 0.5;
    this.warningTimeThresholdS = options?.warningTimeThresholdS ?? 3.0;
  }

  public evaluatePredictiveState(
    nodePos: Position3D,
    currentSimTimeS: number
  ): PredictiveState {
    const acnPos = this.trajectoryEngine.getAcnPosition(currentSimTimeS);
    const currentObs = this.terrainEngine.evaluateTerrainObstruction(
      nodePos,
      acnPos,
      this.rfConfig,
      this.envConfig
    );

    const nextPos = this.trajectoryEngine.getAcnPosition(currentSimTimeS + this.dtStepS);
    const nextObs = this.terrainEngine.evaluateTerrainObstruction(
      nodePos,
      nextPos,
      this.rfConfig,
      this.envConfig
    );
    const fresnelRateOfChangeMps =
      (nextObs.minClearanceM - currentObs.minClearanceM) / this.dtStepS;

    const steps = Math.floor(this.horizonS / this.dtStepS);

    if (!currentObs.isLos) {
      // Regime A: Hard shadow (Optical ray blocked)
      let timeToEmergenceS = Number.POSITIVE_INFINITY;

      for (let step = 1; step <= steps; step++) {
        const futureT = currentSimTimeS + step * this.dtStepS;
        const futureAcn = this.trajectoryEngine.getAcnPosition(futureT);
        const futureObs = this.terrainEngine.evaluateTerrainObstruction(
          nodePos,
          futureAcn,
          this.rfConfig,
          this.envConfig
        );
        if (futureObs.isLos) {
          timeToEmergenceS = step * this.dtStepS;
          break;
        }
      }

      const predictedOutageDurationS = Number.isFinite(timeToEmergenceS) ? timeToEmergenceS : 0.0;
      const state =
        timeToEmergenceS <= 1.0
          ? NodeTerrainState.RE_EMERGENCE_BURST
          : NodeTerrainState.HARD_SHADOW_CUTOFF;

      return {
        currentState: state,
        timeToOcclusionS: 0.0,
        timeToEmergenceS,
        fresnelClearanceM: currentObs.minClearanceM,
        fresnelRateOfChangeMps,
        predictedOutageDurationS,
      };
    } else {
      // Regime B: Unobstructed Line-of-Sight
      let timeToOcclusionS = Number.POSITIVE_INFINITY;
      let predictedOutageDurationS = 0.0;
      let occlusionStep: number | null = null;

      for (let step = 1; step <= steps; step++) {
        const futureT = currentSimTimeS + step * this.dtStepS;
        const futureAcn = this.trajectoryEngine.getAcnPosition(futureT);
        const futureObs = this.terrainEngine.evaluateTerrainObstruction(
          nodePos,
          futureAcn,
          this.rfConfig,
          this.envConfig
        );
        if (!futureObs.isLos) {
          timeToOcclusionS = step * this.dtStepS;
          occlusionStep = step;
          break;
        }
      }

      if (occlusionStep !== null) {
        let emergenceFound = false;
        for (let step = occlusionStep + 1; step <= steps; step++) {
          const futureT = currentSimTimeS + step * this.dtStepS;
          const futureAcn = this.trajectoryEngine.getAcnPosition(futureT);
          const futureObs = this.terrainEngine.evaluateTerrainObstruction(
            nodePos,
            futureAcn,
            this.rfConfig,
            this.envConfig
          );
          if (futureObs.isLos) {
            predictedOutageDurationS = (step - occlusionStep) * this.dtStepS;
            emergenceFound = true;
            break;
          }
        }
        if (!emergenceFound) {
          predictedOutageDurationS = (steps - occlusionStep) * this.dtStepS;
        }
      }

      const state =
        timeToOcclusionS <= this.warningTimeThresholdS
          ? NodeTerrainState.PRE_OCCLUSION_FLUSH
          : NodeTerrainState.NORMAL_LOS;

      return {
        currentState: state,
        timeToOcclusionS,
        timeToEmergenceS: 0.0,
        fresnelClearanceM: currentObs.minClearanceM,
        fresnelRateOfChangeMps,
        predictedOutageDurationS,
      };
    }
  }
}