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
    const bodyAzimuthDeg = (worldBearingDeg - acnHeadingDeg + 360.0) % 360.0;
    const worldElevationDeg = (Math.atan2(dz, Math.max(horizDistM, 1e-3)) * 180.0) / Math.PI;

    const bodyAzRad = (bodyAzimuthDeg * Math.PI) / 180.0;
    const elevationAngleDeg =
      worldElevationDeg - acnBankDeg * Math.sin(bodyAzRad) - acnPitchDeg * Math.cos(bodyAzRad);

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
