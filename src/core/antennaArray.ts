import { Position3D } from '../shared/types';

export type AcnSectorId = 0 | 1 | 2 | 3;

export const ACN_SECTOR_BORESIGHTS_DEG: readonly [0, 90, 180, 270] = [0, 90, 180, 270] as const;

export const ACN_SECTOR_LABELS: readonly [string, string, string, string] = [
  'S0 (0° FWD)',
  'S1 (90° STBD)',
  'S2 (180° AFT)',
  'S3 (270° PORT)',
] as const;

export interface AntennaArrayConfig {
  readonly hpbwAzimuthDeg: number;
  readonly hpbwElevationDeg: number;
  readonly mechanicalDowntiltDeg: number;
  readonly maxAttenuationDb: number;
  readonly handoverHysteresisDb: number;
  readonly crossoverWarningMarginDeg: number;
}

export const DEFAULT_QUAD_ANTENNA_CONFIG: AntennaArrayConfig = {
  hpbwAzimuthDeg: 90.0,
  hpbwElevationDeg: 65.0,
  mechanicalDowntiltDeg: -15.0,
  maxAttenuationDb: 25.0,
  handoverHysteresisDb: 1.5,
  crossoverWarningMarginDeg: 7.0,
};

export interface AcnAttitudeState {
  readonly headingDeg: number;
  readonly pitchDeg: number;
  readonly bankDeg: number;
}

export interface AcnSectorEvaluation {
  readonly activeSectorId: AcnSectorId;
  readonly sectorBoresightDeg: 0 | 90 | 180 | 270;
  readonly sectorLabel: string;
  readonly acnHeadingDeg: number;
  readonly acnPitchDeg: number;
  readonly acnBankDeg: number;
  readonly worldBearingDeg: number;
  readonly bodyAzimuthDeg: number;
  readonly offBoresightAzDeg: number;
  readonly elevationAngleDeg: number;
  readonly patternRollOffDb: number;
  readonly allSectorGainsDbi: readonly [number, number, number, number];
  readonly isCrossoverZone: boolean;
  readonly handoverOccurred: boolean;
  readonly handoverCount: number;
}

export class QuadSectorAntennaEngine {
  private readonly config: AntennaArrayConfig;
  private readonly activeSectorByNode = new Map<number, AcnSectorId>();
  private readonly handoverCountByNode = new Map<number, number>();
  private lastValidHeadingDeg: number = 0.0;
  private prevHeadingDeg: number | null = null;
  private prevTimeS: number | null = null;
  private currentBankDeg: number = 0.0;

  constructor(config: AntennaArrayConfig = DEFAULT_QUAD_ANTENNA_CONFIG) {
    this.config = config;
  }

  public static wrapSignedDeg(angleDeg: number): number {
    return ((((angleDeg + 180.0) % 360.0) + 360.0) % 360.0) - 180.0;
  }

  public computeAcnAttitude(acnVelocity: Position3D, simTimeS?: number, commitKinematics: boolean = false): AcnAttitudeState {
    const [vx, vy, vz] = acnVelocity;
    const horizSpeed = Math.hypot(vx, vy);
    let headingDeg = this.lastValidHeadingDeg;
    if (horizSpeed > 1e-3) {
      headingDeg = ((Math.atan2(vx, vy) * 180.0) / Math.PI + 360.0) % 360.0;
      if (commitKinematics) {
        this.lastValidHeadingDeg = headingDeg;
      }
    }

    const pitchDeg = horizSpeed > 1e-3 ? (Math.atan2(vz, horizSpeed) * 180.0) / Math.PI : 0.0;

    let bankDeg = this.currentBankDeg;
    if (commitKinematics && simTimeS !== undefined) {
      if (this.prevHeadingDeg !== null && this.prevTimeS !== null) {
        const dt = simTimeS - this.prevTimeS;
        if (dt > 1e-4 && dt < 2.0) {
          const dHeadingRad = (QuadSectorAntennaEngine.wrapSignedDeg(headingDeg - this.prevHeadingDeg) * Math.PI) / 180.0;
          const yawRateRadS = dHeadingRad / dt;
          const rawBankDeg = (Math.atan2(horizSpeed * yawRateRadS, 9.80665) * 180.0) / Math.PI;
          bankDeg = Math.max(-35.0, Math.min(35.0, rawBankDeg));
          this.currentBankDeg = bankDeg;
        }
      }
      this.prevHeadingDeg = headingDeg;
      this.prevTimeS = simTimeS;
    }

    return { headingDeg, pitchDeg, bankDeg };
  }

  public computeSectorAttenuationDb(offBoresightAzDeg: number, elevationBodyDeg: number): number {
    const azRatio = offBoresightAzDeg / this.config.hpbwAzimuthDeg;
    const azLossDb = Math.min(12.0 * azRatio * azRatio, this.config.maxAttenuationDb);

    const elDeltaDeg = elevationBodyDeg - this.config.mechanicalDowntiltDeg;
    const elRatio = elDeltaDeg / this.config.hpbwElevationDeg;
    const elLossDb = Math.min(12.0 * elRatio * elRatio, this.config.maxAttenuationDb);

    return Math.min(azLossDb + elLossDb, this.config.maxAttenuationDb);
  }

  public evaluateNodeSector(
    nodeId: number,
    acnPos: Position3D,
    acnVelocity: Position3D,
    nodePos: Position3D,
    peakBoresightGainDbi: number,
    commitState: boolean = true,
    attitudeOverride?: AcnAttitudeState
  ): AcnSectorEvaluation {
    const attitude = attitudeOverride ?? this.computeAcnAttitude(acnVelocity);
    const { headingDeg: acnHeadingDeg, pitchDeg: acnPitchDeg, bankDeg: acnBankDeg } = attitude;

    const dx = nodePos[0] - acnPos[0];
    const dy = nodePos[1] - acnPos[1];
    const dz = nodePos[2] - acnPos[2];
    const horizDistM = Math.hypot(dx, dy);

    const worldBearingDeg =
      horizDistM > 1e-3 ? ((Math.atan2(dx, dy) * 180.0) / Math.PI + 360.0) % 360.0 : 0.0;
    let bodyAzimuthDeg = (worldBearingDeg - acnHeadingDeg + 360.0) % 360.0;
    let elevationAngleDeg = (Math.atan2(dz, Math.max(horizDistM, 1e-3)) * 180.0) / Math.PI;
    if (horizDistM > 1e-3 || Math.abs(dz) > 1e-3) {
      const bodyLos = worldLosToBodyFrame(dx, dy, dz, {
        headingDeg: acnHeadingDeg,
        pitchDeg: acnPitchDeg,
        rollDeg: acnBankDeg,
      });
      bodyAzimuthDeg = bodyLos.bodyAzimuthDeg;
      elevationAngleDeg = bodyLos.bodyElevationDeg;
    }

    const sectorGains: [number, number, number, number] = [0, 0, 0, 0];
    const sectorLosses: [number, number, number, number] = [0, 0, 0, 0];
    const sectorOffBoresights: [number, number, number, number] = [0, 0, 0, 0];

    let bestSectorId: AcnSectorId = 0;
    let bestGainDbi = -Infinity;

    for (let k = 0; k < 4; k++) {
      const sectorId = k as AcnSectorId;
      const boresightDeg = ACN_SECTOR_BORESIGHTS_DEG[sectorId];
      const offAzDeg = QuadSectorAntennaEngine.wrapSignedDeg(bodyAzimuthDeg - boresightDeg);
      const lossDb = this.computeSectorAttenuationDb(offAzDeg, elevationAngleDeg);
      const gainDbi = peakBoresightGainDbi - lossDb;

      sectorOffBoresights[sectorId] = offAzDeg;
      sectorLosses[sectorId] = lossDb;
      sectorGains[sectorId] = gainDbi;

      if (gainDbi > bestGainDbi) {
        bestGainDbi = gainDbi;
        bestSectorId = sectorId;
      }
    }

    const prevSectorId = this.activeSectorByNode.get(nodeId);
    let activeSectorId: AcnSectorId = bestSectorId;
    let handoverOccurred = false;

    if (prevSectorId !== undefined && prevSectorId !== bestSectorId) {
      const prevGainDbi = sectorGains[prevSectorId];
      if (bestGainDbi < prevGainDbi + this.config.handoverHysteresisDb) {
        activeSectorId = prevSectorId;
      } else {
        handoverOccurred = true;
      }
    }

    let handoverCount = this.handoverCountByNode.get(nodeId) ?? 0;
    if (commitState) {
      this.activeSectorByNode.set(nodeId, activeSectorId);
      if (handoverOccurred) {
        handoverCount += 1;
        this.handoverCountByNode.set(nodeId, handoverCount);
      }
    }

    const activeOffAzDeg = sectorOffBoresights[activeSectorId];
    const absOffAz = Math.abs(activeOffAzDeg);
    const isCrossoverZone =
      absOffAz >= 45.0 - this.config.crossoverWarningMarginDeg &&
      absOffAz <= 45.0 + this.config.crossoverWarningMarginDeg;

    return {
      activeSectorId,
      sectorBoresightDeg: ACN_SECTOR_BORESIGHTS_DEG[activeSectorId],
      sectorLabel: ACN_SECTOR_LABELS[activeSectorId],
      acnHeadingDeg,
      acnPitchDeg,
      acnBankDeg,
      worldBearingDeg,
      bodyAzimuthDeg,
      offBoresightAzDeg: activeOffAzDeg,
      elevationAngleDeg,
      patternRollOffDb: sectorLosses[activeSectorId],
      allSectorGainsDbi: sectorGains,
      isCrossoverZone,
      handoverOccurred,
      handoverCount,
    };
  }

  public getTotalHandovers(): number {
    let sum = 0;
    for (const c of this.handoverCountByNode.values()) sum += c;
    return sum;
  }

  public reset(): void {
    this.activeSectorByNode.clear();
    this.handoverCountByNode.clear();
    this.lastValidHeadingDeg = 0.0;
    this.prevHeadingDeg = null;
    this.prevTimeS = null;
    this.currentBankDeg = 0.0;
  }

  public evictNode(nodeId: number): void {
    this.activeSectorByNode.delete(nodeId);
    this.handoverCountByNode.delete(nodeId);
  }
}

export interface BodyFrameLosResult {
  readonly bodyForward: number;
  readonly bodyRight: number;
  readonly bodyDown: number;
  readonly bodyAzimuthDeg: number;
  readonly bodyElevationDeg: number;
}

export interface AttitudeEulerDeg {
  readonly yawDeg?: number;
  readonly headingDeg?: number;
  readonly pitchDeg?: number;
  readonly rollDeg?: number;
  readonly bankDeg?: number;
}

/**
 * Transforms an ENU line-of-sight vector into the aircraft body frame using exact orthogonal
 * Tait-Bryan Z-Y-X (yaw, pitch, roll) rotation.
 *
 * @param losEast Delta East in metres (+x in ENU)
 * @param losNorth Delta North in metres (+y in ENU)
 * @param losUp Delta Up in metres (+z in ENU)
 * @param attitude Aircraft Euler attitude angles in degrees
 * @returns 3D body-frame coordinates and spherical body angles (azimuth and elevation)
 */
export function worldLosToBodyFrame(
  losEast: number,
  losNorth: number,
  losUp: number,
  attitude: AttitudeEulerDeg
): BodyFrameLosResult {
  if (
    !Number.isFinite(losEast) ||
    !Number.isFinite(losNorth) ||
    !Number.isFinite(losUp) ||
    !attitude
  ) {
    return {
      bodyForward: 0.0,
      bodyRight: 0.0,
      bodyDown: 0.0,
      bodyAzimuthDeg: 0.0,
      bodyElevationDeg: 0.0,
    };
  }

  const yaw = Number.isFinite(attitude.yawDeg)
    ? attitude.yawDeg!
    : (Number.isFinite(attitude.headingDeg) ? attitude.headingDeg! : 0.0);
  const pitch = Number.isFinite(attitude.pitchDeg) ? attitude.pitchDeg! : 0.0;
  const roll = Number.isFinite(attitude.rollDeg)
    ? attitude.rollDeg!
    : (Number.isFinite(attitude.bankDeg) ? attitude.bankDeg! : 0.0);

  const psiRad = (yaw * Math.PI) / 180.0;
  const thetaRad = (pitch * Math.PI) / 180.0;
  const phiRad = (roll * Math.PI) / 180.0;

  const cPsi = Math.cos(psiRad);
  const sPsi = Math.sin(psiRad);
  const cTheta = Math.cos(thetaRad);
  const sTheta = Math.sin(thetaRad);
  const cPhi = Math.cos(phiRad);
  const sPhi = Math.sin(phiRad);

  // Local navigation NED vector:
  const N = losNorth;
  const E = losEast;
  const D = -losUp;

  // Tait-Bryan Z-Y-X passive aerospace DCM: R = R_x(phi) * R_y(theta) * R_z(psi)
  const bodyForward = (cTheta * cPsi) * N + (cTheta * sPsi) * E - sTheta * D;
  const bodyRight =
    (sPhi * sTheta * cPsi - cPhi * sPsi) * N +
    (sPhi * sTheta * sPsi + cPhi * cPsi) * E +
    (sPhi * cTheta) * D;
  const bodyDown =
    (cPhi * sTheta * cPsi + sPhi * sPsi) * N +
    (cPhi * sTheta * sPsi - sPhi * cPsi) * E +
    (cPhi * cTheta) * D;

  const horizMagnitude = Math.hypot(bodyForward, bodyRight);
  let bodyAzimuthDeg = 0.0;
  if (horizMagnitude > 1e-12) {
    bodyAzimuthDeg = ((Math.atan2(bodyRight, bodyForward) * 180.0) / Math.PI + 360.0) % 360.0;
  }

  let bodyElevationDeg = 0.0;
  const totalMag = Math.hypot(horizMagnitude, bodyDown);
  if (totalMag > 1e-12) {
    bodyElevationDeg = (Math.atan2(-bodyDown, horizMagnitude) * 180.0) / Math.PI;
  }

  return {
    bodyForward,
    bodyRight,
    bodyDown,
    bodyAzimuthDeg,
    bodyElevationDeg,
  };
}

/**
 * Computes airframe fuselage blockage and wing-chord shadowing loss in dB.
 *
 * @param bodyAzimuthDeg Azimuth in aircraft body coordinates [0, 360) deg (0 = nose, 90 = right wing)
 * @param bodyElevationDeg Elevation in aircraft body coordinates [-90, +90] deg (negative = below belly)
 * @param mountPosition Antenna placement ('belly' or 'dorsal', default 'belly')
 * @returns Non-negative airframe shadow loss in dB [0.0, 15.0]
 */
export function computeAirframeShadowLossDb(
  bodyAzimuthDeg: number,
  bodyElevationDeg: number,
  mountPosition: 'belly' | 'dorsal' = 'belly'
): number {
  if (!Number.isFinite(bodyAzimuthDeg) || !Number.isFinite(bodyElevationDeg)) {
    return 0.0;
  }

  const effectiveEl = mountPosition === 'dorsal' ? -bodyElevationDeg : bodyElevationDeg;

  // 1. Fuselage blockage model
  let fuselageLossDb = 0.0;
  if (effectiveEl <= -5.0) {
    fuselageLossDb = 0.0;
  } else if (effectiveEl >= 15.0) {
    fuselageLossDb = 15.0;
  } else {
    // Smooth C1 raised-cosine transition across [-5°, +15°]
    const u = (effectiveEl - (-5.0)) / (15.0 - (-5.0)); // [0, 1]
    fuselageLossDb = 15.0 * 0.5 * (1.0 - Math.cos(Math.PI * u));
  }

  // 2. Additive wing-chord shadowing bump: centered at |bodyAzimuthDeg| = 90° (±20° width) and bodyElevationDeg in [-5°, +5°]
  let wingLossDb = 0.0;
  const azNorm = ((bodyAzimuthDeg % 360.0) + 360.0) % 360.0;
  const distToStarboard = Math.abs(azNorm - 90.0);
  const distToPort = Math.abs(azNorm - 270.0);
  const deltaAzWing = Math.min(distToStarboard, distToPort);

  if (deltaAzWing <= 20.0 && effectiveEl >= -5.0 && effectiveEl <= 5.0) {
    const uAz = deltaAzWing / 20.0;
    const uEl = Math.abs(effectiveEl) / 5.0;
    const factorAz = 0.5 * (1.0 + Math.cos(Math.PI * uAz));
    const factorEl = 0.5 * (1.0 + Math.cos(Math.PI * uEl));
    wingLossDb = 4.0 * factorAz * factorEl;
  }

  return Math.max(0.0, Math.min(15.0, fuselageLossDb + wingLossDb));
}

export interface QuadSectorSelectionResult {
  readonly sectorIndex: AcnSectorId;
  readonly switched: boolean;
  readonly angularOffsetDeg: number;
  readonly boresightDeg: number;
}

/**
 * Pure, stateless quad-sector antenna selection with angular hysteresis margin.
 *
 * @param azimuthDeg Target body azimuth in degrees (arbitrary angle, wrapped internally)
 * @param previousSectorIndex Currently active sector index (0..3) or null/undefined
 * @param hysteresisMarginDeg Additional angular margin to retain previous sector (default 3.0°)
 * @returns QuadSectorSelectionResult
 */
export function selectQuadSectorWithHysteresis(
  azimuthDeg: number,
  previousSectorIndex?: number | null,
  hysteresisMarginDeg: number = 3.0
): QuadSectorSelectionResult {
  const azNorm = ((azimuthDeg % 360.0) + 360.0) % 360.0;
  const nominalSector = (Math.floor(((azNorm + 45.0) % 360.0) / 90.0) % 4) as AcnSectorId;

  const hasPrev =
    previousSectorIndex !== null &&
    previousSectorIndex !== undefined &&
    Number.isInteger(previousSectorIndex) &&
    previousSectorIndex >= 0 &&
    previousSectorIndex <= 3;

  if (!hasPrev) {
    const boresightDeg = (nominalSector * 90) as 0 | 90 | 180 | 270;
    const angularOffsetDeg = ((((azNorm - boresightDeg + 180.0) % 360.0) + 360.0) % 360.0) - 180.0;
    return {
      sectorIndex: nominalSector,
      switched: false,
      angularOffsetDeg,
      boresightDeg,
    };
  }

  const prevSector = previousSectorIndex as AcnSectorId;
  const prevBoresightDeg = prevSector * 90;
  const diffToPrev = ((((azNorm - prevBoresightDeg + 180.0) % 360.0) + 360.0) % 360.0) - 180.0;

  if (Math.abs(diffToPrev) <= 45.0 + Math.max(0.0, hysteresisMarginDeg)) {
    return {
      sectorIndex: prevSector,
      switched: false,
      angularOffsetDeg: diffToPrev,
      boresightDeg: prevBoresightDeg,
    };
  }

  const boresightDeg = (nominalSector * 90) as 0 | 90 | 180 | 270;
  const angularOffsetDeg = ((((azNorm - boresightDeg + 180.0) % 360.0) + 360.0) % 360.0) - 180.0;
  return {
    sectorIndex: nominalSector,
    switched: nominalSector !== prevSector,
    angularOffsetDeg,
    boresightDeg,
  };
}

