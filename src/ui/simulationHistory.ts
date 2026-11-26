/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Milestone 3B.2D — Historical Simulation Frame & Profile Store
 *
 * Provides a bounded, read-only ring buffer for historical simulation frames and
 * authoritative link profiles using flat TypedArray ring storage. Eliminates
 * 50 Hz hot-path Object.freeze() churn and per-frame object bloat while lazily
 * constructing frozen immutable snapshots on read.
 */

import type { LinkProfile, LinkProfileObstacleInterval, LinkProfileSample } from '../core/linkProfile';
import type { BullingtonApexData } from '../core/terrain';
import type { Position3D } from '../shared/types';

export interface HistoricalObstructionSummary {
  readonly terrainIsLos: boolean;
  readonly obstacleBlocked: boolean;
  readonly minClearanceM: number;
  readonly diffractionLossDb: number;
  readonly primaryBlockedObstacleId: string | null;
  readonly terrainStatusText: string;
  readonly terrainBadgeClass: string;
  readonly obstacleStatusText: string;
  readonly obstacleBadgeClass: string;
}

export interface HistoricalLinkBudgetSnapshot {
  readonly modcodName: string;
  readonly snrDb: number;
  readonly spectralEfficiencyBpsHz: number;
  readonly slantRangeKm: number;
  readonly fsplDb: number;
  readonly diffractionLossDb: number;
  readonly rxPowerDbm: number;
  readonly earthBulgeM: number;
  readonly gaseousLossDb: number;
  readonly pNoiseDbm?: number;
  readonly rainLossDb?: number;
}

/**
 * Immutable snapshot of a simulation frame's link profile and telemetry metadata.
 * Contains no references to the mutable live simulation engine or full terrain DEM.
 */
export interface HistoricalFrameRecord {
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly selectedNodeId: number;
  readonly nodeName: string;
  readonly profileSerial: number;
  readonly spatialRevision?: number;
  readonly groundNodePositionMslM: Position3D;
  readonly acnPositionMslM: Position3D;
  readonly profile: LinkProfile;
  readonly obstruction: HistoricalObstructionSummary;
  readonly linkBudget: HistoricalLinkBudgetSnapshot;
  /** Legacy compatibility coordinates: [along_dist_km, terrain_alt_m, los_alt_m, fresnel_radius_m]. */
  readonly profilePoints?: readonly [number, number, number, number][];
  readonly groundNodeAglM?: number;
}

export interface HistoricalFrameInput {
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly selectedNodeId: number;
  readonly nodeName: string;
  readonly profileSerial?: number;
  readonly spatialRevision?: number;
  readonly groundNodePositionMslM: Position3D;
  readonly acnPositionMslM: Position3D;
  readonly profile: LinkProfile;
  readonly obstruction: HistoricalObstructionSummary;
  readonly linkBudget: HistoricalLinkBudgetSnapshot;
  readonly profilePoints?: readonly [number, number, number, number][];
  readonly groundNodeAglM?: number;
}

export interface HistorySpan {
  readonly count: number;
  readonly capacity: number;
  readonly oldestFrame: number | null;
  readonly newestFrame: number | null;
  readonly oldestTimeS: number | null;
  readonly newestTimeS: number | null;
}

const MAX_TYPED_PROFILE_SAMPLES = 64;
const SCALAR_STRIDE = 25;
const BULLINGTON_STRIDE = 9;
const STRING_ID_STRIDE = 8;
const BYTES_PER_TYPED_SLOT =
  8 + // frameIndex
  8 + // simTimeS
  4 + // selectedNodeId
  4 + // profileSerial
  4 + // spatialRevision
  24 + // groundPos (3 * f64)
  24 + // acnPos (3 * f64)
  SCALAR_STRIDE * 8 + // 25 * f64
  BULLINGTON_STRIDE * 4 + // 9 * f32
  2 + // flags (u16)
  1 + // sampleCount (u8)
  STRING_ID_STRIDE * 2 + // 8 * u16
  MAX_TYPED_PROFILE_SAMPLES * 4 * 4; // 64 * 4 * f32

const FLAG_PROF_LOS = 1 << 0;
const FLAG_PROF_OBS = 1 << 1;
const FLAG_PROF_VALID = 1 << 2;
const FLAG_SUM_LOS = 1 << 3;
const FLAG_SUM_OBS = 1 << 4;
const FLAG_HAS_PRIMARY_OBS_ID = 1 << 5;
const FLAG_HAS_BULLINGTON = 1 << 6;
const FLAG_HAS_PROFILE_POINTS = 1 << 7;

/**
 * Empirically measures the approximate memory footprint of a single historical frame record in bytes.
 * Validates actual stored data shape rather than assuming static sizing.
 */
export function estimateRecordMemoryBytes(record: HistoricalFrameRecord): number {
  if (!record || typeof record !== 'object') return 0;

  // Base JS object overhead (~64 bytes for record envelope)
  let bytes = 64;

  // Scalar numbers and booleans (~8 bytes each)
  bytes += 10 * 8;
  bytes += (record.nodeName?.length ?? 0) * 2;

  // Position 3D arrays
  bytes += 56 * 2;

  // Obstruction summary
  bytes += 64 + (record.obstruction.terrainStatusText?.length ?? 0) * 2 +
    (record.obstruction.obstacleStatusText?.length ?? 0) * 2 +
    (record.obstruction.primaryBlockedObstacleId?.length ?? 0) * 2;

  // Link budget snapshot
  bytes += 64 + (record.linkBudget.modcodName?.length ?? 0) * 2;

  // Profile
  if (record.profile && typeof record.profile === 'object') {
    bytes += 128;
    if (Array.isArray(record.profile.samples)) {
      bytes += record.profile.samples.length * 72;
    }
    if (Array.isArray(record.profile.obstacleIntervals)) {
      for (const interval of record.profile.obstacleIntervals) {
        bytes += 64 + (interval.obstacleId?.length ?? 0) * 2;
      }
    }
  }

  if (Array.isArray(record.profilePoints)) {
    bytes += record.profilePoints.length * 32;
  }

  return bytes;
}

/**
 * Creates a defensive, immutable snapshot of a historical frame record from incoming telemetry.
 */
export function createHistoricalRecordSnapshot(input: HistoricalFrameInput): HistoricalFrameRecord {
  const clonedSamples: LinkProfileSample[] = Array.isArray(input.profile?.samples)
    ? input.profile.samples.map(s => Object.freeze({ ...s }))
    : [];

  const clonedIntervals: LinkProfileObstacleInterval[] = Array.isArray(input.profile?.obstacleIntervals)
    ? input.profile.obstacleIntervals.map(i => Object.freeze({ ...i }))
    : [];

  const frozenProfile: LinkProfile = Object.freeze({
    selectedGroundNodeId: input.profile?.selectedGroundNodeId ?? input.selectedNodeId,
    nodeName: input.profile?.nodeName ?? input.nodeName,
    frameIndex: input.profile?.frameIndex ?? input.frameIndex,
    simulationTimeS: input.profile?.simulationTimeS ?? input.simulationTimeS,
    groundNodePositionMslM: Object.freeze([...(input.profile?.groundNodePositionMslM ?? input.groundNodePositionMslM)]) as unknown as Position3D,
    acnPositionMslM: Object.freeze([...(input.profile?.acnPositionMslM ?? input.acnPositionMslM)]) as unknown as Position3D,
    horizontalGroundDistanceM: input.profile?.horizontalGroundDistanceM ?? 0,
    slantDistanceM: input.profile?.slantDistanceM ?? 0,
    fresnelFraction: input.profile?.fresnelFraction ?? 0.6,
    terrainIsLos: input.profile?.terrainIsLos ?? input.obstruction.terrainIsLos,
    terrainMinimumClearanceM: input.profile?.terrainMinimumClearanceM ?? input.obstruction.minClearanceM,
    terrainCriticalFresnelRadiusM: input.profile?.terrainCriticalFresnelRadiusM ?? 0,
    diffractionLossDb: input.profile?.diffractionLossDb ?? input.obstruction.diffractionLossDb,
    obstacleBlocked: input.profile?.obstacleBlocked ?? input.obstruction.obstacleBlocked,
    obstacleIntervals: Object.freeze(clonedIntervals),
    samples: Object.freeze(clonedSamples),
    kFactor: input.profile?.kFactor ?? (4.0 / 3.0),
    refractivityGradNPerKm: input.profile?.refractivityGradNPerKm ?? -39.25,
    maxEarthBulgeM: input.profile?.maxEarthBulgeM ?? 0,
    bullingtonApex: input.profile?.bullingtonApex ? Object.freeze({ ...input.profile.bullingtonApex }) : null,
    fresnelZone2RadiusMidM: input.profile?.fresnelZone2RadiusMidM ?? 0,
    fresnelZone3RadiusMidM: input.profile?.fresnelZone3RadiusMidM ?? 0,
    valid: input.profile?.valid ?? true,
  });

  const record: HistoricalFrameRecord = Object.freeze({
    frameIndex: input.frameIndex,
    simulationTimeS: input.simulationTimeS,
    selectedNodeId: input.selectedNodeId,
    nodeName: input.nodeName,
    profileSerial: input.profileSerial ?? 0,
    spatialRevision: input.spatialRevision ?? 0,
    groundNodePositionMslM: Object.freeze([...input.groundNodePositionMslM]) as unknown as Position3D,
    acnPositionMslM: Object.freeze([...input.acnPositionMslM]) as unknown as Position3D,
    profile: frozenProfile,
    obstruction: Object.freeze({ ...input.obstruction }),
    linkBudget: Object.freeze({ ...input.linkBudget }),
    profilePoints: input.profilePoints ? Object.freeze(input.profilePoints.map(p => Object.freeze([...p]) as unknown as [number, number, number, number])) : undefined,
    groundNodeAglM: input.groundNodeAglM,
  });

  return record;
}

/**
 * Pre-allocated circular TypedArray ring buffer for historical simulation frames.
 * Enforces strict FIFO eviction in O(1) time with zero Object.freeze() churn on 50 Hz write,
 * lazily constructing deeply frozen HistoricalFrameRecord snapshots only on read.
 */
export class SimulationHistoryBuffer {
  private readonly capacity: number;
  private head: number = 0;
  private length: number = 0;

  private readonly frameIndexArr: Float64Array;
  private readonly simTimeArr: Float64Array;
  private readonly selectedNodeIdArr: Int32Array;
  private readonly profileSerialArr: Int32Array;
  private readonly spatialRevisionArr: Int32Array;
  private readonly groundPosArr: Float64Array;
  private readonly acnPosArr: Float64Array;
  private readonly scalarsArr: Float64Array;
  private readonly bullingtonArr: Float32Array;
  private readonly flagsArr: Uint16Array;
  private readonly sampleCountArr: Uint8Array;
  private readonly strIdsArr: Uint16Array;

  private readonly sampleTerrainArr: Float32Array;
  private readonly sampleEffTerrainArr: Float32Array;
  private readonly sampleLosArr: Float32Array;
  private readonly sampleFresnelArr: Float32Array;

  private readonly stringTable: string[] = [''];
  private readonly stringMap = new Map<string, number>([['', 0]]);
  private readonly obstacleIntervalsBySlot = new Map<number, readonly LinkProfileObstacleInterval[]>();
  private readonly overflowSamplesBySlot = new Map<number, readonly LinkProfileSample[]>();

  constructor(capacity = 3000) {
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new Error(`SimulationHistoryBuffer capacity must be an integer >= 2, got ${capacity}`);
    }
    this.capacity = capacity;
    this.frameIndexArr = new Float64Array(capacity);
    this.simTimeArr = new Float64Array(capacity);
    this.selectedNodeIdArr = new Int32Array(capacity);
    this.profileSerialArr = new Int32Array(capacity);
    this.spatialRevisionArr = new Int32Array(capacity);
    this.groundPosArr = new Float64Array(capacity * 3);
    this.acnPosArr = new Float64Array(capacity * 3);
    this.scalarsArr = new Float64Array(capacity * SCALAR_STRIDE);
    this.bullingtonArr = new Float32Array(capacity * BULLINGTON_STRIDE);
    this.flagsArr = new Uint16Array(capacity);
    this.sampleCountArr = new Uint8Array(capacity);
    this.strIdsArr = new Uint16Array(capacity * STRING_ID_STRIDE);

    const sampleTotal = capacity * MAX_TYPED_PROFILE_SAMPLES;
    this.sampleTerrainArr = new Float32Array(sampleTotal);
    this.sampleEffTerrainArr = new Float32Array(sampleTotal);
    this.sampleLosArr = new Float32Array(sampleTotal);
    this.sampleFresnelArr = new Float32Array(sampleTotal);
  }

  public get maxCapacity(): number {
    return this.capacity;
  }

  public get size(): number {
    return this.length;
  }

  private internString(value: string | null | undefined): number {
    const str = typeof value === 'string' ? value : '';
    const existing = this.stringMap.get(str);
    if (existing !== undefined) return existing;
    const idx = this.stringTable.length;
    if (idx < 65535) {
      this.stringTable.push(str);
      this.stringMap.set(str, idx);
      return idx;
    }
    return 0;
  }

  private writeSlot(slot: number, input: HistoricalFrameInput): void {
    const p = input.profile;
    const obs = input.obstruction;
    const lb = input.linkBudget;

    this.frameIndexArr[slot] = input.frameIndex;
    this.simTimeArr[slot] = input.simulationTimeS;
    this.selectedNodeIdArr[slot] = input.selectedNodeId;
    this.profileSerialArr[slot] = input.profileSerial ?? 0;
    this.spatialRevisionArr[slot] = input.spatialRevision ?? 0;

    const posOff = slot * 3;
    const gPos = p?.groundNodePositionMslM ?? input.groundNodePositionMslM;
    const aPos = p?.acnPositionMslM ?? input.acnPositionMslM;
    this.groundPosArr[posOff] = gPos[0] ?? 0;
    this.groundPosArr[posOff + 1] = gPos[1] ?? 0;
    this.groundPosArr[posOff + 2] = gPos[2] ?? 0;
    this.acnPosArr[posOff] = aPos[0] ?? 0;
    this.acnPosArr[posOff + 1] = aPos[1] ?? 0;
    this.acnPosArr[posOff + 2] = aPos[2] ?? 0;

    const sOff = slot * SCALAR_STRIDE;
    this.scalarsArr[sOff] = p?.horizontalGroundDistanceM ?? 0;
    this.scalarsArr[sOff + 1] = p?.slantDistanceM ?? 0;
    this.scalarsArr[sOff + 2] = p?.fresnelFraction ?? 0.6;
    this.scalarsArr[sOff + 3] = p?.terrainMinimumClearanceM ?? obs.minClearanceM;
    this.scalarsArr[sOff + 4] = p?.terrainCriticalFresnelRadiusM ?? 0;
    this.scalarsArr[sOff + 5] = p?.diffractionLossDb ?? obs.diffractionLossDb;
    this.scalarsArr[sOff + 6] = p?.kFactor ?? (4.0 / 3.0);
    this.scalarsArr[sOff + 7] = p?.refractivityGradNPerKm ?? -39.25;
    this.scalarsArr[sOff + 8] = p?.maxEarthBulgeM ?? 0;
    this.scalarsArr[sOff + 9] = p?.fresnelZone2RadiusMidM ?? 0;
    this.scalarsArr[sOff + 10] = p?.fresnelZone3RadiusMidM ?? 0;
    this.scalarsArr[sOff + 11] = lb.snrDb;
    this.scalarsArr[sOff + 12] = lb.spectralEfficiencyBpsHz;
    this.scalarsArr[sOff + 13] = lb.slantRangeKm;
    this.scalarsArr[sOff + 14] = lb.fsplDb;
    this.scalarsArr[sOff + 15] = lb.diffractionLossDb;
    this.scalarsArr[sOff + 16] = lb.rxPowerDbm;
    this.scalarsArr[sOff + 17] = lb.earthBulgeM;
    this.scalarsArr[sOff + 18] = lb.gaseousLossDb;
    this.scalarsArr[sOff + 19] = typeof lb.pNoiseDbm === 'number' ? lb.pNoiseDbm : Number.NaN;
    this.scalarsArr[sOff + 20] = typeof lb.rainLossDb === 'number' ? lb.rainLossDb : Number.NaN;
    this.scalarsArr[sOff + 21] = typeof input.groundNodeAglM === 'number' ? input.groundNodeAglM : Number.NaN;
    this.scalarsArr[sOff + 22] = obs.minClearanceM;
    this.scalarsArr[sOff + 23] = obs.diffractionLossDb;
    this.scalarsArr[sOff + 24] = p?.selectedGroundNodeId ?? input.selectedNodeId;

    let flags = 0;
    if (p?.terrainIsLos ?? obs.terrainIsLos) flags |= FLAG_PROF_LOS;
    if (p?.obstacleBlocked ?? obs.obstacleBlocked) flags |= FLAG_PROF_OBS;
    if (p?.valid ?? true) flags |= FLAG_PROF_VALID;
    if (obs.terrainIsLos) flags |= FLAG_SUM_LOS;
    if (obs.obstacleBlocked) flags |= FLAG_SUM_OBS;
    if (obs.primaryBlockedObstacleId !== null && obs.primaryBlockedObstacleId !== undefined) {
      flags |= FLAG_HAS_PRIMARY_OBS_ID;
    }
    if (p?.bullingtonApex) {
      flags |= FLAG_HAS_BULLINGTON;
      const b = p.bullingtonApex;
      const bOff = slot * BULLINGTON_STRIDE;
      this.bullingtonArr[bOff] = b.distM;
      this.bullingtonArr[bOff + 1] = b.elevM;
      this.bullingtonArr[bOff + 2] = b.losHeightM;
      this.bullingtonArr[bOff + 3] = b.diffractionParameterNu;
      this.bullingtonArr[bOff + 4] = b.lossDb;
      this.bullingtonArr[bOff + 5] = b.txHorizonDistM;
      this.bullingtonArr[bOff + 6] = b.txHorizonElevM;
      this.bullingtonArr[bOff + 7] = b.rxHorizonDistM;
      this.bullingtonArr[bOff + 8] = b.rxHorizonElevM;
    }
    if (Array.isArray(input.profilePoints)) {
      flags |= FLAG_HAS_PROFILE_POINTS;
    }
    this.flagsArr[slot] = flags;

    const strOff = slot * STRING_ID_STRIDE;
    this.strIdsArr[strOff] = this.internString(input.nodeName);
    this.strIdsArr[strOff + 1] = this.internString(p?.nodeName ?? input.nodeName);
    this.strIdsArr[strOff + 2] = this.internString(lb.modcodName);
    this.strIdsArr[strOff + 3] = this.internString(obs.terrainStatusText);
    this.strIdsArr[strOff + 4] = this.internString(obs.terrainBadgeClass);
    this.strIdsArr[strOff + 5] = this.internString(obs.obstacleStatusText);
    this.strIdsArr[strOff + 6] = this.internString(obs.obstacleBadgeClass);
    this.strIdsArr[strOff + 7] = this.internString(obs.primaryBlockedObstacleId);

    if (Array.isArray(p?.obstacleIntervals) && p.obstacleIntervals.length > 0) {
      this.obstacleIntervalsBySlot.set(
        slot,
        p.obstacleIntervals.map((iv) => ({
          obstacleId: iv.obstacleId,
          entryFraction: iv.entryFraction,
          exitFraction: iv.exitFraction,
          entryHorizontalDistanceM: iv.entryHorizontalDistanceM,
          exitHorizontalDistanceM: iv.exitHorizontalDistanceM,
          entrySlantDistanceM: iv.entrySlantDistanceM,
          exitSlantDistanceM: iv.exitSlantDistanceM,
          penetrationM: iv.penetrationM,
        }))
      );
    } else {
      this.obstacleIntervalsBySlot.delete(slot);
    }

    const samples = Array.isArray(p?.samples) ? p.samples : [];
    if (samples.length <= MAX_TYPED_PROFILE_SAMPLES) {
      this.overflowSamplesBySlot.delete(slot);
      this.sampleCountArr[slot] = samples.length;
      const baseSample = slot * MAX_TYPED_PROFILE_SAMPLES;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const idx = baseSample + i;
        this.sampleTerrainArr[idx] = s.terrainElevationMslM;
        this.sampleEffTerrainArr[idx] = s.effectiveTerrainElevationMslM;
        this.sampleLosArr[idx] = s.losElevationMslM;
        this.sampleFresnelArr[idx] = s.fresnelRadiusM;
      }
    } else {
      this.sampleCountArr[slot] = MAX_TYPED_PROFILE_SAMPLES;
      this.overflowSamplesBySlot.set(slot, samples.map((s) => ({ ...s })));
    }
  }

  private readSlotAsFrozenRecord(slot: number): HistoricalFrameRecord {
    const frameIndex = this.frameIndexArr[slot];
    const simTimeS = this.simTimeArr[slot];
    const selectedNodeId = this.selectedNodeIdArr[slot];
    const profileSerial = this.profileSerialArr[slot];
    const spatialRevision = this.spatialRevisionArr[slot];

    const posOff = slot * 3;
    const groundPos = Object.freeze([
      this.groundPosArr[posOff],
      this.groundPosArr[posOff + 1],
      this.groundPosArr[posOff + 2],
    ]) as unknown as Position3D;
    const acnPos = Object.freeze([
      this.acnPosArr[posOff],
      this.acnPosArr[posOff + 1],
      this.acnPosArr[posOff + 2],
    ]) as unknown as Position3D;

    const sOff = slot * SCALAR_STRIDE;
    const horizDist = this.scalarsArr[sOff];
    const slantDist = this.scalarsArr[sOff + 1];
    const fresnelFrac = this.scalarsArr[sOff + 2];
    const profMinClr = this.scalarsArr[sOff + 3];
    const critFresnel = this.scalarsArr[sOff + 4];
    const profDiffLoss = this.scalarsArr[sOff + 5];
    const kFactor = this.scalarsArr[sOff + 6];
    const refractivity = this.scalarsArr[sOff + 7];
    const maxBulge = this.scalarsArr[sOff + 8];
    const f2Mid = this.scalarsArr[sOff + 9];
    const f3Mid = this.scalarsArr[sOff + 10];
    const pNoise = this.scalarsArr[sOff + 19];
    const rainLoss = this.scalarsArr[sOff + 20];
    const aglM = this.scalarsArr[sOff + 21];

    const flags = this.flagsArr[slot];
    const strOff = slot * STRING_ID_STRIDE;
    const nodeName = this.stringTable[this.strIdsArr[strOff]] ?? '';
    const profNodeName = this.stringTable[this.strIdsArr[strOff + 1]] ?? nodeName;

    const overflow = this.overflowSamplesBySlot.get(slot);
    let frozenSamples: readonly LinkProfileSample[];
    let profilePoints: readonly [number, number, number, number][] | undefined;

    if (overflow) {
      frozenSamples = Object.freeze(overflow.map((s) => Object.freeze({ ...s })));
      if (flags & FLAG_HAS_PROFILE_POINTS) {
        profilePoints = Object.freeze(
          overflow.map((s) =>
            Object.freeze([
              s.horizontalGroundDistanceM / 1000,
              s.terrainElevationMslM,
              s.losElevationMslM,
              s.fresnelRadiusM,
            ]) as unknown as [number, number, number, number]
          )
        );
      }
    } else {
      const count = this.sampleCountArr[slot];
      const baseSample = slot * MAX_TYPED_PROFILE_SAMPLES;
      const arr: LinkProfileSample[] = new Array(count);
      const pts: [number, number, number, number][] | undefined =
        flags & FLAG_HAS_PROFILE_POINTS ? new Array(count) : undefined;
      const denom = count > 1 ? count - 1 : 1;

      for (let i = 0; i < count; i++) {
        const idx = baseSample + i;
        const along = count > 1 ? i / denom : 0;
        const hDist = along * horizDist;
        const sDist = along * slantDist;
        const terr = this.sampleTerrainArr[idx];
        const effTerr = this.sampleEffTerrainArr[idx];
        const los = this.sampleLosArr[idx];
        const r1 = this.sampleFresnelArr[idx];
        const clr = los - effTerr;
        const offset = fresnelFrac * r1;
        const nu = r1 > 0 && i > 0 && i < count - 1 ? (-clr * Math.SQRT2) / r1 : 0.0;

        arr[i] = Object.freeze({
          horizontalGroundDistanceM: hDist,
          slantDistanceM: sDist,
          terrainElevationMslM: terr,
          effectiveTerrainElevationMslM: effTerr,
          losElevationMslM: los,
          fresnelRadiusM: r1,
          fresnel2RadiusM: Math.SQRT2 * r1,
          fresnel3RadiusM: Math.sqrt(3.0) * r1,
          earthBulgeM: effTerr - terr,
          nu,
          lowerFresnelElevationMslM: los - offset,
          upperFresnelElevationMslM: los + offset,
          effectiveTerrainClearanceM: clr,
        });

        if (pts) {
          pts[i] = Object.freeze([hDist / 1000, terr, los, r1]) as unknown as [number, number, number, number];
        }
      }
      frozenSamples = Object.freeze(arr);
      if (pts) {
        profilePoints = Object.freeze(pts);
      }
    }

    const rawIntervals = this.obstacleIntervalsBySlot.get(slot) ?? [];
    const frozenIntervals = Object.freeze(rawIntervals.map((iv) => Object.freeze({ ...iv })));

    let bullingtonApex: BullingtonApexData | null = null;
    if (flags & FLAG_HAS_BULLINGTON) {
      const bOff = slot * BULLINGTON_STRIDE;
      bullingtonApex = Object.freeze({
        distM: this.bullingtonArr[bOff],
        elevM: this.bullingtonArr[bOff + 1],
        losHeightM: this.bullingtonArr[bOff + 2],
        diffractionParameterNu: this.bullingtonArr[bOff + 3],
        lossDb: this.bullingtonArr[bOff + 4],
        txHorizonDistM: this.bullingtonArr[bOff + 5],
        txHorizonElevM: this.bullingtonArr[bOff + 6],
        rxHorizonDistM: this.bullingtonArr[bOff + 7],
        rxHorizonElevM: this.bullingtonArr[bOff + 8],
      });
    }

    const profile: LinkProfile = Object.freeze({
      selectedGroundNodeId: this.scalarsArr[sOff + 24],
      nodeName: profNodeName,
      frameIndex,
      simulationTimeS: simTimeS,
      groundNodePositionMslM: groundPos,
      acnPositionMslM: acnPos,
      horizontalGroundDistanceM: horizDist,
      slantDistanceM: slantDist,
      fresnelFraction: fresnelFrac,
      terrainIsLos: Boolean(flags & FLAG_PROF_LOS),
      terrainMinimumClearanceM: profMinClr,
      terrainCriticalFresnelRadiusM: critFresnel,
      diffractionLossDb: profDiffLoss,
      obstacleBlocked: Boolean(flags & FLAG_PROF_OBS),
      obstacleIntervals: frozenIntervals,
      samples: frozenSamples,
      kFactor,
      refractivityGradNPerKm: refractivity,
      maxEarthBulgeM: maxBulge,
      bullingtonApex,
      fresnelZone2RadiusMidM: f2Mid,
      fresnelZone3RadiusMidM: f3Mid,
      valid: Boolean(flags & FLAG_PROF_VALID),
    });

    const obstruction: HistoricalObstructionSummary = Object.freeze({
      terrainIsLos: Boolean(flags & FLAG_SUM_LOS),
      obstacleBlocked: Boolean(flags & FLAG_SUM_OBS),
      minClearanceM: this.scalarsArr[sOff + 22],
      diffractionLossDb: this.scalarsArr[sOff + 23],
      primaryBlockedObstacleId:
        flags & FLAG_HAS_PRIMARY_OBS_ID
          ? (this.stringTable[this.strIdsArr[strOff + 7]] ?? null)
          : null,
      terrainStatusText: this.stringTable[this.strIdsArr[strOff + 3]] ?? '',
      terrainBadgeClass: this.stringTable[this.strIdsArr[strOff + 4]] ?? '',
      obstacleStatusText: this.stringTable[this.strIdsArr[strOff + 5]] ?? '',
      obstacleBadgeClass: this.stringTable[this.strIdsArr[strOff + 6]] ?? '',
    });

    const linkBudget: HistoricalLinkBudgetSnapshot = Object.freeze({
      modcodName: this.stringTable[this.strIdsArr[strOff + 2]] ?? 'UNKNOWN',
      snrDb: this.scalarsArr[sOff + 11],
      spectralEfficiencyBpsHz: this.scalarsArr[sOff + 12],
      slantRangeKm: this.scalarsArr[sOff + 13],
      fsplDb: this.scalarsArr[sOff + 14],
      diffractionLossDb: this.scalarsArr[sOff + 15],
      rxPowerDbm: this.scalarsArr[sOff + 16],
      earthBulgeM: this.scalarsArr[sOff + 17],
      gaseousLossDb: this.scalarsArr[sOff + 18],
      pNoiseDbm: Number.isNaN(pNoise) ? undefined : pNoise,
      rainLossDb: Number.isNaN(rainLoss) ? undefined : rainLoss,
    });

    return Object.freeze({
      frameIndex,
      simulationTimeS: simTimeS,
      selectedNodeId,
      nodeName,
      profileSerial,
      spatialRevision,
      groundNodePositionMslM: groundPos,
      acnPositionMslM: acnPos,
      profile,
      obstruction,
      linkBudget,
      profilePoints,
      groundNodeAglM: Number.isNaN(aglM) ? undefined : aglM,
    });
  }

  /**
   * Zero-freeze hot-path ingestion into TypedArray ring storage.
   */
  public pushRaw(input: HistoricalFrameInput): void {
    if (!input || typeof input.frameIndex !== 'number' || !Number.isFinite(input.frameIndex)) {
      return;
    }

    if (this.length > 0) {
      const newestSlot = (this.head - 1) % this.capacity;
      const newestFrame = this.frameIndexArr[newestSlot];
      if (input.frameIndex < newestFrame) {
        this.clear();
      } else if (input.frameIndex === newestFrame) {
        this.writeSlot(newestSlot, input);
        return;
      }
    }

    const slot = this.head % this.capacity;
    this.writeSlot(slot, input);
    this.head++;
    if (this.length < this.capacity) {
      this.length++;
    }
  }

  /**
   * Pushes a frame record into the TypedArray ring buffer. Evicts oldest in O(1) time.
   */
  public push(record: HistoricalFrameRecord): void {
    this.pushRaw(record);
  }

  /**
   * Look up a historical frame record by its exact frame index (constructs frozen view lazily).
   */
  public getByFrameIndex(frameIndex: number): HistoricalFrameRecord | null {
    if (this.length === 0 || !Number.isFinite(frameIndex)) return null;

    const oldestSlot = (this.head - this.length) % this.capacity;
    const newestSlot = (this.head - 1) % this.capacity;
    if (frameIndex < this.frameIndexArr[oldestSlot] || frameIndex > this.frameIndexArr[newestSlot]) {
      return null;
    }

    const startOffset = this.head - 1;
    for (let i = 0; i < this.length; i++) {
      const slot = (startOffset - i) % this.capacity;
      const f = this.frameIndexArr[slot];
      if (f === frameIndex) {
        return this.readSlotAsFrozenRecord(slot);
      }
      if (f < frameIndex) {
        break;
      }
    }
    return null;
  }

  public getOldest(): HistoricalFrameRecord | null {
    if (this.length === 0) return null;
    const slot = (this.head - this.length) % this.capacity;
    return this.readSlotAsFrozenRecord(slot);
  }

  public getNewest(): HistoricalFrameRecord | null {
    if (this.length === 0) return null;
    const slot = (this.head - 1) % this.capacity;
    return this.readSlotAsFrozenRecord(slot);
  }

  public isEvicted(frameIndex: number): boolean {
    if (this.length === 0 || !Number.isFinite(frameIndex)) return false;
    const oldestSlot = (this.head - this.length) % this.capacity;
    return frameIndex < this.frameIndexArr[oldestSlot];
  }

  public getSpan(): HistorySpan {
    if (this.length === 0) {
      return {
        count: 0,
        capacity: this.capacity,
        oldestFrame: null,
        newestFrame: null,
        oldestTimeS: null,
        newestTimeS: null,
      };
    }
    const oldestSlot = (this.head - this.length) % this.capacity;
    const newestSlot = (this.head - 1) % this.capacity;
    return {
      count: this.length,
      capacity: this.capacity,
      oldestFrame: this.frameIndexArr[oldestSlot],
      newestFrame: this.frameIndexArr[newestSlot],
      oldestTimeS: this.simTimeArr[oldestSlot],
      newestTimeS: this.simTimeArr[newestSlot],
    };
  }

  public clear(): void {
    this.head = 0;
    this.length = 0;
    this.obstacleIntervalsBySlot.clear();
    this.overflowSamplesBySlot.clear();
  }

  /**
   * Measures the TypedArray + sparse metadata memory footprint of stored records in bytes.
   */
  public measureTotalMemoryBytes(): number {
    let total = this.length * BYTES_PER_TYPED_SLOT;
    for (const intervals of this.obstacleIntervalsBySlot.values()) {
      for (const iv of intervals) {
        total += 64 + (iv.obstacleId?.length ?? 0) * 2;
      }
    }
    for (const overflow of this.overflowSamplesBySlot.values()) {
      total += overflow.length * 72;
    }
    return total;
  }
}

/**
 * State machine managing historical inspection vs live stream mode.
 * Enforces the invariant that historical inspection is strictly read-only and
 * preserves prior simulation running/paused state across LIVE returns.
 */
export class SimulationHistoryController {
  private readonly buffer: SimulationHistoryBuffer;
  private inspecting: boolean = false;
  private inspectedFrameIndex: number | null = null;
  private wasRunningBeforeHistorical: boolean = false;
  private isCurrentlyEvicted: boolean = false;

  constructor(buffer: SimulationHistoryBuffer) {
    this.buffer = buffer;
  }

  public get historyBuffer(): SimulationHistoryBuffer {
    return this.buffer;
  }

  public get isInspecting(): boolean {
    return this.inspecting;
  }

  public get currentInspectedFrame(): number | null {
    return this.inspectedFrameIndex;
  }

  public get wasRunningBefore(): boolean {
    return this.wasRunningBeforeHistorical;
  }

  public get isEvicted(): boolean {
    return this.isCurrentlyEvicted;
  }

  public enterHistorical(targetFrameIndex?: number, isCurrentlyRunning = false): {
    record: HistoricalFrameRecord | null;
    shouldPause: boolean;
  } {
    if (!this.inspecting) {
      this.inspecting = true;
      this.wasRunningBeforeHistorical = isCurrentlyRunning;
    }

    const span = this.buffer.getSpan();
    const frameToInspect = typeof targetFrameIndex === 'number'
      ? targetFrameIndex
      : (span.newestFrame ?? 0);

    const record = this.scrubTo(frameToInspect);

    return {
      record,
      shouldPause: isCurrentlyRunning,
    };
  }

  public scrubTo(frameIndex: number): HistoricalFrameRecord | null {
    this.inspecting = true;
    this.inspectedFrameIndex = frameIndex;

    const direct = this.buffer.getByFrameIndex(frameIndex);
    if (direct) {
      this.isCurrentlyEvicted = false;
      return direct;
    }

    if (this.buffer.isEvicted(frameIndex)) {
      this.isCurrentlyEvicted = true;
      const oldest = this.buffer.getOldest();
      if (oldest) {
        this.inspectedFrameIndex = oldest.frameIndex;
        return oldest;
      }
    }

    const newest = this.buffer.getNewest();
    if (newest && frameIndex > newest.frameIndex) {
      this.isCurrentlyEvicted = false;
      this.inspectedFrameIndex = newest.frameIndex;
      return newest;
    }

    this.isCurrentlyEvicted = false;
    return newest ?? null;
  }

  public exitHistorical(): { shouldResume: boolean } {
    const shouldResume = this.wasRunningBeforeHistorical;
    this.inspecting = false;
    this.inspectedFrameIndex = null;
    this.wasRunningBeforeHistorical = false;
    this.isCurrentlyEvicted = false;
    return { shouldResume };
  }

  public getActiveHistoricalRecord(): HistoricalFrameRecord | null {
    if (!this.inspecting || this.inspectedFrameIndex === null) {
      return null;
    }
    return this.scrubTo(this.inspectedFrameIndex);
  }

  public reset(): void {
    this.inspecting = false;
    this.inspectedFrameIndex = null;
    this.wasRunningBeforeHistorical = false;
    this.isCurrentlyEvicted = false;
    this.buffer.clear();
  }
}
