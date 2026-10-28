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

import { ACNFlightConfig, ACNWaypoint, EnvironmentConfig, RFConfig } from './config';
import { LinkBudgetEngine } from './linkBudget';
import { Position3D, TerrainEngine } from './terrain';
import { validateClosedWaypointPath } from './waypoints';

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
  readonly obstacleBlocked?: boolean;
}

/** Position/velocity contract shared by the live simulation and look-ahead engine. */
export interface ACNTrajectory {
  getAcnPosition(tS: number): [number, number, number];
  getAcnVelocity(tS: number): [number, number, number];
  getPathPoints(numPoints?: number): [number, number][];
}

/**
 * Constant-Airspeed Rotated Elliptical Kinematics Engine.
 *
 * Integrates arc-length parameterized orbit so tangential speed |v| = 60.0 m/s
 * remains invariant along the rotated ellipse.
 */
export class ACNTrajectoryEngine implements ACNTrajectory {
  public readonly flightConfig: ACNFlightConfig;
  public readonly numLutSamples: number;
  public readonly orbitPeriodS: number;

  private readonly thetaLut: Float64Array;
  private readonly sLut: Float64Array;
  private readonly totalPerimeterM: number;

  constructor(flightConfig: ACNFlightConfig, numLutSamples: number = 2048) {
    if (!Number.isFinite(flightConfig.loiterSpeedMps) || flightConfig.loiterSpeedMps <= 0 || flightConfig.loiterSpeedMps > 1000) {
      throw new Error('Trajectory speed must be finite and in (0, 1000] m/s.');
    }
    if (!Number.isFinite(flightConfig.altitudeMslM) || !Number.isFinite(flightConfig.centerXm) || !Number.isFinite(flightConfig.centerYm) ||
        !Number.isFinite(flightConfig.loiterRadiusAM) || !Number.isFinite(flightConfig.loiterRadiusBM) ||
        flightConfig.loiterRadiusAM <= 0 || flightConfig.loiterRadiusBM <= 0 || !Number.isFinite(flightConfig.loiterRotationDeg)) {
      throw new Error('Ellipse trajectory configuration must contain finite coordinates, altitude, rotation, and positive axes.');
    }
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

  public getPathPoints(numPoints: number = 64): [number, number][] {
    const a = this.flightConfig.loiterRadiusAM;
    const b = this.flightConfig.loiterRadiusBM;
    const phi = (this.flightConfig.loiterRotationDeg * Math.PI) / 180.0;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    const points: [number, number][] = [];
    for (let i = 0; i < numPoints; i++) {
      const theta = (2.0 * Math.PI * i) / numPoints;
      const xr = a * Math.cos(theta), yr = b * Math.sin(theta);
      points.push([
        this.flightConfig.centerXm + xr * cosPhi - yr * sinPhi,
        this.flightConfig.centerYm + xr * sinPhi + yr * cosPhi,
      ]);
    }
    return points;
  }
}

interface WaypointSample {
  readonly distanceM: number;
  readonly segment: number;
  readonly u: number;
  readonly point: readonly [number, number];
}

/**
 * Closed, shape-limited cubic Hermite waypoint loop, sampled by arc length.
 * Shared bounded tangents keep the curve C1 at waypoints. Tangent arms are
 * limited by adjacent edge lengths to control excursions on irregular routes.
 */
export class WaypointTrajectoryEngine implements ACNTrajectory {
  public readonly flightConfig: ACNFlightConfig;
  public readonly totalLengthM: number;
  public readonly orbitPeriodS: number;

  private readonly points: readonly ACNWaypoint[];
  private readonly samples: WaypointSample[] = [];

  constructor(flightConfig: ACNFlightConfig, samplesPerSegment: number = 512) {
    if (flightConfig.trajectoryMode !== 'waypoints') throw new Error('Waypoint trajectory mode must be explicit.');
    if (!Number.isFinite(flightConfig.loiterSpeedMps) || flightConfig.loiterSpeedMps <= 0 || flightConfig.loiterSpeedMps > 1000) {
      throw new Error('Waypoint trajectory speed must be finite and in (0, 1000] m/s.');
    }
    if (!Number.isFinite(flightConfig.altitudeMslM)) throw new Error('ACN altitude must be finite.');
    const input = flightConfig.waypoints;
    if (!Number.isInteger(samplesPerSegment) || samplesPerSegment < 8) throw new Error('samplesPerSegment must be an integer of at least 8.');
    const copied = validateClosedWaypointPath(input);
    this.points = Object.freeze(copied);
    this.flightConfig = flightConfig;

    let distanceM = 0;
    let previous = this.evaluateSegment(0, 0);
    this.samples.push({ distanceM, segment: 0, u: 0, point: previous });
    for (let segment = 0; segment < copied.length; segment++) {
      if (segment > 0) {
        const start = this.evaluateSegment(segment, 0);
        this.samples.push({ distanceM, segment, u: 0, point: start });
        previous = start;
      }
      for (let step = 1; step <= samplesPerSegment; step++) {
        const u = step / samplesPerSegment;
        const point = this.evaluateSegment(segment, u);
        distanceM += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        this.samples.push({ distanceM, segment, u, point });
        previous = point;
      }
    }
    if (!(distanceM > 1e-6) || !Number.isFinite(distanceM)) throw new Error('Waypoint loop is degenerate.');
    this.totalLengthM = distanceM;
    this.orbitPeriodS = distanceM / flightConfig.loiterSpeedMps;
  }

  private evaluateSegment(segment: number, u: number): [number, number] {
    const count = this.points.length;
    const p1 = this.points[segment % count];
    const p2 = this.points[(segment + 1) % count];
    const tangentAt = (index: number): [number, number] => {
      const previous = this.points[(index + count - 1) % count];
      const current = this.points[index % count];
      const next = this.points[(index + 1) % count];
      const inX = current.xM - previous.xM, inY = current.yM - previous.yM;
      const outX = next.xM - current.xM, outY = next.yM - current.yM;
      const inLength = Math.hypot(inX, inY), outLength = Math.hypot(outX, outY);
      const inUx = inX / inLength, inUy = inY / inLength;
      const outUx = outX / outLength, outUy = outY / outLength;
      let tx = inUx + outUx, ty = inUy + outUy;
      let tangentLength = Math.hypot(tx, ty);
      if (tangentLength <= 1e-9) {
        tx = outUx;
        ty = outUy;
        tangentLength = 1;
      }
      // The Bézier-equivalent control arm is at most one quarter of either
      // adjacent edge, limiting excursions on acute and irregular corners.
      const magnitude = 0.75 * Math.min(inLength, outLength);
      return [tx / tangentLength * magnitude, ty / tangentLength * magnitude];
    };
    const [m1x, m1y] = tangentAt(segment);
    const [m2x, m2y] = tangentAt(segment + 1);
    const t = Math.max(0, Math.min(1, u));
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return [
      h00 * p1.xM + h10 * m1x + h01 * p2.xM + h11 * m2x,
      h00 * p1.yM + h10 * m1y + h01 * p2.yM + h11 * m2y,
    ];
  }

  private distanceAtTime(tS: number): number {
    if (!Number.isFinite(tS)) throw new Error('Simulation time must be finite.');
    const distance = (this.flightConfig.loiterSpeedMps * tS) % this.totalLengthM;
    return distance < 0 ? distance + this.totalLengthM : distance;
  }

  private pointAtDistance(distanceM: number): [number, number] {
    let low = 0, high = this.samples.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.samples[mid].distanceM <= distanceM) low = mid + 1;
      else high = mid;
    }
    const leftIndex = Math.max(0, low - 1);
    const left = this.samples[leftIndex];
    const right = this.samples[Math.min(this.samples.length - 1, leftIndex + 1)];
    if (left.segment !== right.segment || right.distanceM <= left.distanceM) return [...left.point];
    const fraction = Math.max(0, Math.min(1, (distanceM - left.distanceM) / (right.distanceM - left.distanceM)));
    return this.evaluateSegment(left.segment, left.u + fraction * (right.u - left.u));
  }

  public getAcnPosition(tS: number): [number, number, number] {
    const [x, y] = this.pointAtDistance(this.distanceAtTime(tS));
    return [x, y, this.flightConfig.altitudeMslM];
  }

  public getAcnVelocity(tS: number): [number, number, number] {
    // Return the centered 20 ms position derivative used by the 50 Hz worker.
    // Its magnitude is deliberately not normalized: the arc-length table's
    // measured timing error must remain visible to link/telemetry consumers.
    const halfStepS = 0.01;
    const before = this.getAcnPosition(tS - halfStepS);
    const after = this.getAcnPosition(tS + halfStepS);
    return [(after[0] - before[0]) / (2 * halfStepS), (after[1] - before[1]) / (2 * halfStepS), 0];
  }

  public getPathPoints(numPoints: number = 64): [number, number][] {
    if (!Number.isInteger(numPoints) || numPoints < 3) throw new Error('numPoints must be an integer of at least 3.');
    return Array.from({ length: numPoints }, (_, i) => this.pointAtDistance(this.totalLengthM * i / numPoints));
  }

  /** Segment starts derived from the same chord-length table used for timing. */
  public getSegmentBoundaryTimesS(): number[] {
    return this.samples
      .filter(sample => sample.u === 0)
      .map(sample => sample.distanceM / this.flightConfig.loiterSpeedMps);
  }
}

export function createACNTrajectory(flightConfig: ACNFlightConfig): ACNTrajectory {
  return flightConfig.trajectoryMode === 'waypoints'
    ? new WaypointTrajectoryEngine(flightConfig)
    : new ACNTrajectoryEngine(flightConfig);
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
  public readonly trajectoryEngine: ACNTrajectory;

  public horizonS: number;
  public dtStepS: number;
  public warningTimeThresholdS: number;

  constructor(
    terrainEngine: TerrainEngine,
    linkBudgetEngine: LinkBudgetEngine,
    rfConfig: RFConfig,
    envConfig: EnvironmentConfig,
    flightConfig: ACNFlightConfig,
    trajectoryEngine?: ACNTrajectory,
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
    this.trajectoryEngine = trajectoryEngine ?? createACNTrajectory(flightConfig);
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

    if (!currentObs.isLos || currentObs.obstacleBlocked) {
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
        if (futureObs.isLos && !futureObs.obstacleBlocked) {
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
        obstacleBlocked: currentObs.obstacleBlocked,
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
        if (!futureObs.isLos || futureObs.obstacleBlocked) {
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
          if (futureObs.isLos && !futureObs.obstacleBlocked) {
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
        obstacleBlocked: currentObs.obstacleBlocked,
      };
    }
  }
}
