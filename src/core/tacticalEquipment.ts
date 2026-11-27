/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Deployable Multi-Equipment Tactical RF Registry & Physics Engine (MENTOR-02)
 *
 * Supports:
 * - barrage_jammer: Omnidirectional broadband X-band jammer
 * - spot_jammer: Directional high-gain sector-focused X-band jammer
 * - relay_mast: Elevated Decode-and-Forward two-hop relay mast
 * - esm_sensor: Adversary passive Electronic Support Measures (ESM) intercept receiver
 *
 * Invariants:
 * - Registry capped at MAX_TACTICAL_EQUIPMENT = 32.
 * - Coordinates bounded to [-THEATER_HALF_M, THEATER_HALF_M].
 * - EIRP clamped [10, 90] dBm; height AGL clamped [1, 100] m.
 * - Multi-jammer summation strictly in linear milliwatts (10^(I_dBm / 10)).
 * - Zero heap allocation on fast path when no equipment / jammers are active.
 */

import { THEATER_HALF_M } from '../shared/constants';
import type { Position3D } from '../shared/types';
import {
  EnvironmentConfig,
  RFConfig,
  type McsMode,
  type ManualModulation,
  type ManualFec,
} from './config';
import { LinkBudgetEngine, type LinkStatus } from './linkBudget';
import { THEATER_BIOMES } from './biomePhysics';
import type { TerrainEngine, TerrainObstruction } from './terrain';
import type { QuadSectorAntennaEngine, AcnAttitudeState } from './antennaArray';

export type TacticalEquipmentType = 'barrage_jammer' | 'spot_jammer' | 'relay_mast' | 'esm_sensor';

export const MAX_TACTICAL_EQUIPMENT = 32;
export const MIN_EQUIPMENT_EIRP_DBM = 10.0;
export const MAX_EQUIPMENT_EIRP_DBM = 90.0;
export const MIN_EQUIPMENT_HEIGHT_AGL_M = 1.0;
export const MAX_EQUIPMENT_HEIGHT_AGL_M = 100.0;
export const DEFAULT_ESM_SENSITIVITY_DBM = -95.0;

export interface TacticalEquipmentInput {
  readonly id?: string;
  readonly type: TacticalEquipmentType;
  readonly label?: string;
  readonly xM: number;
  readonly yM: number;
  readonly zM?: number;
  readonly heightAglM?: number;
  readonly eirpDbm?: number;
  readonly enabled?: boolean;
  readonly azimuthDeg?: number;
  readonly beamwidthDeg?: number;
  readonly sensitivityDbm?: number;
}

export interface TacticalEquipmentItem {
  readonly id: string;
  readonly type: TacticalEquipmentType;
  readonly label: string;
  readonly xM: number;
  readonly yM: number;
  readonly zM: number;
  readonly heightAglM: number;
  readonly eirpDbm: number;
  readonly enabled: boolean;
  readonly azimuthDeg?: number;
  readonly beamwidthDeg?: number;
  readonly sensitivityDbm?: number;
}

export interface TacticalEquipmentTelemetry {
  readonly id: string;
  readonly type: TacticalEquipmentType;
  readonly label: string;
  readonly x_m: number;
  readonly y_m: number;
  readonly z_m: number;
  readonly height_agl_m: number;
  readonly eirp_dbm: number;
  readonly enabled: boolean;
  readonly azimuth_deg?: number;
  readonly beamwidth_deg?: number;
  readonly sensitivity_dbm?: number;
  readonly effective_radius_m?: number;
  readonly jammer_shield_db?: number;
  readonly relayed_count?: number;
  readonly intercept_rx_dbm?: number;
  readonly intercept_margin_db?: number;
  readonly intercept_detected?: boolean;
}

export interface TacticalEquipmentUpdatePatch {
  readonly label?: string;
  readonly xM?: number;
  readonly yM?: number;
  readonly zM?: number;
  readonly heightAglM?: number;
  readonly eirpDbm?: number;
  readonly enabled?: boolean;
  readonly azimuthDeg?: number;
  readonly beamwidthDeg?: number;
  readonly sensitivityDbm?: number;
}

export interface TacticalEquipmentOpResult {
  readonly accepted: boolean;
  readonly item?: TacticalEquipmentItem;
  readonly deletedId?: string;
  readonly reason?: string;
}

const VALID_EQUIPMENT_TYPES: ReadonlySet<string> = new Set([
  'barrage_jammer',
  'spot_jammer',
  'relay_mast',
  'esm_sensor',
]);

function defaultEirpForType(type: TacticalEquipmentType): number {
  switch (type) {
    case 'barrage_jammer': return 65.0;
    case 'spot_jammer': return 72.0;
    case 'relay_mast': return 43.0;
    case 'esm_sensor': return 20.0;
  }
}

function defaultHeightAglForType(type: TacticalEquipmentType): number {
  return type === 'relay_mast' ? 15.0 : 3.0;
}

function defaultLabelForType(type: TacticalEquipmentType, seq: number): string {
  switch (type) {
    case 'barrage_jammer': return `Barrage Jammer #${seq}`;
    case 'spot_jammer': return `Spot Jammer #${seq}`;
    case 'relay_mast': return `Relay Mast #${seq}`;
    case 'esm_sensor': return `ESM Sensor #${seq}`;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function isValidEquipmentType(t: unknown): t is TacticalEquipmentType {
  return typeof t === 'string' && VALID_EQUIPMENT_TYPES.has(t);
}

/**
 * Stateful registry managing up to 32 deployed tactical RF equipment units.
 */
export class TacticalEquipmentRegistry {
  private readonly items: Map<string, TacticalEquipmentItem> = new Map();
  private nextSeq: number = 1;

  public get size(): number {
    return this.items.size;
  }

  public list(): readonly TacticalEquipmentItem[] {
    return Array.from(this.items.values());
  }

  public get(id: string): TacticalEquipmentItem | undefined {
    return this.items.get(id);
  }

  public add(
    input: TacticalEquipmentInput,
    terrainElevationLookup?: (xM: number, yM: number) => number
  ): TacticalEquipmentOpResult {
    if (this.items.size >= MAX_TACTICAL_EQUIPMENT) {
      return {
        accepted: false,
        reason: `Maximum tactical equipment capacity (${MAX_TACTICAL_EQUIPMENT}) reached.`,
      };
    }
    if (!input || !isValidEquipmentType(input.type)) {
      return { accepted: false, reason: 'Invalid tactical equipment type.' };
    }
    if (
      typeof input.xM !== 'number' || !Number.isFinite(input.xM) ||
      typeof input.yM !== 'number' || !Number.isFinite(input.yM)
    ) {
      return { accepted: false, reason: 'Equipment coordinates (xM, yM) must be finite numbers.' };
    }
    if (Math.abs(input.xM) > THEATER_HALF_M || Math.abs(input.yM) > THEATER_HALF_M) {
      return {
        accepted: false,
        reason: `Equipment coordinates must lie within [-${THEATER_HALF_M}, ${THEATER_HALF_M}] m.`,
      };
    }

    const rawId = typeof input.id === 'string' && input.id.trim().length > 0
      ? input.id.trim()
      : `eq-${this.nextSeq}`;
    if (this.items.has(rawId)) {
      return { accepted: false, reason: `Equipment id '${rawId}' already exists.` };
    }

    const seq = this.nextSeq++;
    const rawH = input.heightAglM !== undefined ? input.heightAglM : defaultHeightAglForType(input.type);
    if (!Number.isFinite(rawH)) {
      return { accepted: false, reason: 'heightAglM must be finite.' };
    }
    const heightAglM = clamp(rawH, MIN_EQUIPMENT_HEIGHT_AGL_M, MAX_EQUIPMENT_HEIGHT_AGL_M);

    const rawEirp = input.eirpDbm !== undefined ? input.eirpDbm : defaultEirpForType(input.type);
    if (!Number.isFinite(rawEirp)) {
      return { accepted: false, reason: 'eirpDbm must be finite.' };
    }
    const eirpDbm = clamp(rawEirp, MIN_EQUIPMENT_EIRP_DBM, MAX_EQUIPMENT_EIRP_DBM);

    const groundElev = terrainElevationLookup ? terrainElevationLookup(input.xM, input.yM) : 0.0;
    const safeGroundElev = Number.isFinite(groundElev) ? groundElev : 0.0;
    const zM = input.zM !== undefined && Number.isFinite(input.zM)
      ? input.zM
      : safeGroundElev + heightAglM;

    const label = typeof input.label === 'string' && input.label.trim().length > 0
      ? input.label.trim().slice(0, 64)
      : defaultLabelForType(input.type, seq);

    const item: TacticalEquipmentItem = {
      id: rawId,
      type: input.type,
      label,
      xM: input.xM,
      yM: input.yM,
      zM,
      heightAglM,
      eirpDbm,
      enabled: input.enabled ?? true,
      ...(input.azimuthDeg !== undefined && Number.isFinite(input.azimuthDeg)
        ? { azimuthDeg: ((input.azimuthDeg % 360) + 360) % 360 }
        : {}),
      ...(input.beamwidthDeg !== undefined && Number.isFinite(input.beamwidthDeg)
        ? { beamwidthDeg: clamp(input.beamwidthDeg, 5.0, 180.0) }
        : {}),
      ...(input.type === 'esm_sensor'
        ? {
            sensitivityDbm:
              input.sensitivityDbm !== undefined && Number.isFinite(input.sensitivityDbm)
                ? clamp(input.sensitivityDbm, -140.0, -40.0)
                : DEFAULT_ESM_SENSITIVITY_DBM,
          }
        : {}),
    };

    this.items.set(rawId, item);
    return { accepted: true, item };
  }

  public update(
    id: string,
    patch: TacticalEquipmentUpdatePatch,
    terrainElevationLookup?: (xM: number, yM: number) => number
  ): TacticalEquipmentOpResult {
    const existing = this.items.get(id);
    if (!existing) {
      return { accepted: false, reason: `Equipment '${id}' not found.` };
    }

    const nextX = patch.xM !== undefined ? patch.xM : existing.xM;
    const nextY = patch.yM !== undefined ? patch.yM : existing.yM;
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY) ||
        Math.abs(nextX) > THEATER_HALF_M || Math.abs(nextY) > THEATER_HALF_M) {
      return { accepted: false, reason: 'Updated coordinates are invalid or out of theater bounds.' };
    }

    const rawH = patch.heightAglM !== undefined ? patch.heightAglM : existing.heightAglM;
    if (!Number.isFinite(rawH)) {
      return { accepted: false, reason: 'heightAglM must be finite.' };
    }
    const heightAglM = clamp(rawH, MIN_EQUIPMENT_HEIGHT_AGL_M, MAX_EQUIPMENT_HEIGHT_AGL_M);

    const rawEirp = patch.eirpDbm !== undefined ? patch.eirpDbm : existing.eirpDbm;
    if (!Number.isFinite(rawEirp)) {
      return { accepted: false, reason: 'eirpDbm must be finite.' };
    }
    const eirpDbm = clamp(rawEirp, MIN_EQUIPMENT_EIRP_DBM, MAX_EQUIPMENT_EIRP_DBM);

    let zM = existing.zM;
    if (patch.zM !== undefined && Number.isFinite(patch.zM)) {
      zM = patch.zM;
    } else if (patch.xM !== undefined || patch.yM !== undefined || patch.heightAglM !== undefined) {
      const groundElev = terrainElevationLookup ? terrainElevationLookup(nextX, nextY) : (existing.zM - existing.heightAglM);
      zM = (Number.isFinite(groundElev) ? groundElev : 0.0) + heightAglM;
    }

    const updated: TacticalEquipmentItem = {
      ...existing,
      label: typeof patch.label === 'string' && patch.label.trim().length > 0 ? patch.label.trim().slice(0, 64) : existing.label,
      xM: nextX,
      yM: nextY,
      zM,
      heightAglM,
      eirpDbm,
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : existing.enabled,
      ...(patch.azimuthDeg !== undefined && Number.isFinite(patch.azimuthDeg)
        ? { azimuthDeg: ((patch.azimuthDeg % 360) + 360) % 360 }
        : existing.azimuthDeg !== undefined ? { azimuthDeg: existing.azimuthDeg } : {}),
      ...(patch.beamwidthDeg !== undefined && Number.isFinite(patch.beamwidthDeg)
        ? { beamwidthDeg: clamp(patch.beamwidthDeg, 5.0, 180.0) }
        : existing.beamwidthDeg !== undefined ? { beamwidthDeg: existing.beamwidthDeg } : {}),
      ...(patch.sensitivityDbm !== undefined && Number.isFinite(patch.sensitivityDbm)
        ? { sensitivityDbm: clamp(patch.sensitivityDbm, -140.0, -40.0) }
        : existing.sensitivityDbm !== undefined ? { sensitivityDbm: existing.sensitivityDbm } : {}),
    };

    this.items.set(id, updated);
    return { accepted: true, item: updated };
  }

  public delete(id: string): TacticalEquipmentOpResult {
    if (!this.items.has(id)) {
      return { accepted: false, reason: `Equipment '${id}' not found.` };
    }
    this.items.delete(id);
    return { accepted: true, deletedId: id };
  }

  public clear(): void {
    this.items.clear();
  }

  public resampleElevations(terrainElevationLookup: (xM: number, yM: number) => number): void {
    for (const [id, eq] of this.items.entries()) {
      const groundElev = terrainElevationLookup(eq.xM, eq.yM);
      const safeGround = Number.isFinite(groundElev) ? groundElev : 0.0;
      this.items.set(id, { ...eq, zM: safeGround + eq.heightAglM });
    }
  }
}

export interface JammerSourceParams {
  readonly id: string;
  readonly type: 'legacy' | 'barrage_jammer' | 'spot_jammer';
  readonly posEnu: Position3D;
  readonly eirpDbm: number;
  readonly azimuthDeg?: number;
  readonly beamwidthDeg?: number;
}

export interface AggregateJammerWorkerResult {
  readonly jammerShieldLossDb: number;
  readonly jammerSectorInterferenceDbm: readonly [number, number, number, number];
  readonly jammerInterferenceBySector: readonly [number, number, number, number] | undefined;
  readonly dominantJammerPosEnu: Position3D | undefined;
  readonly shieldByEquipmentId: ReadonlyMap<string, number> | undefined;
}

const IDLE_SECTOR_FLOOR: readonly [number, number, number, number] = Object.freeze([-150.0, -150.0, -150.0, -150.0]);
const IDLE_JAMMER_WORKER_RESULT: AggregateJammerWorkerResult = Object.freeze({
  jammerShieldLossDb: 0.0,
  jammerSectorInterferenceDbm: IDLE_SECTOR_FLOOR,
  jammerInterferenceBySector: undefined,
  dominantJammerPosEnu: undefined,
  shieldByEquipmentId: undefined,
});

function wrapAngleDeg180(deg: number): number {
  let d = ((deg + 180.0) % 360.0);
  if (d < 0.0) d += 360.0;
  return d - 180.0;
}

/**
 * Computes directional focus offset (dB) for a Spot Jammer along the jammer->ACN ray.
 * Within main lobe (azimuthDeg undefined -> auto-steered at ACN): +6 dB focused gain.
 * Off-boresight rolls off smoothly down to a -20 dB sidelobe floor.
 */
function computeSpotJammerGainOffsetDb(
  jPos: Position3D,
  acnPos: Position3D,
  azimuthDeg: number | undefined,
  beamwidthDeg: number | undefined
): number {
  if (azimuthDeg === undefined || !Number.isFinite(azimuthDeg)) {
    return 6.0;
  }
  const bearingToAcnDeg = ((Math.atan2(acnPos[0] - jPos[0], acnPos[1] - jPos[1]) * 180.0) / Math.PI + 360.0) % 360.0;
  const deltaDeg = Math.abs(wrapAngleDeg180(bearingToAcnDeg - azimuthDeg));
  const halfBw = Math.max(2.5, (beamwidthDeg ?? 35.0) * 0.5);
  return Math.max(-20.0, 6.0 - 12.0 * Math.pow(deltaDeg / halfBw, 2));
}

function evaluateSingleJammerPath(
  jPos: Position3D,
  eirpDbm: number,
  isSpot: boolean,
  azimuthDeg: number | undefined,
  beamwidthDeg: number | undefined,
  acnPos: Position3D,
  acnVel: Position3D,
  acnAttitude: AcnAttitudeState | undefined,
  terrainEngine: TerrainEngine,
  rfConfig: RFConfig,
  envConfig: EnvironmentConfig,
  antennaEngine?: QuadSectorAntennaEngine
): {
  shieldLossDb: number;
  sectorRxDbm: readonly [number, number, number, number];
  scalarRxDbm: number;
} {
  const dJammerM = Math.max(Math.hypot(acnPos[0] - jPos[0], acnPos[1] - jPos[1], acnPos[2] - jPos[2]), 1.0);
  const jammerObs = terrainEngine.evaluateTerrainObstruction(jPos, acnPos, rfConfig, envConfig);
  const shieldLossDb = jammerObs.diffractionLossDb ?? 0.0;
  const fsplJ = LinkBudgetEngine.computeFsplDb(dJammerM, rfConfig.carrierFrequencyHz, rfConfig.speedOfLight);
  const gasJ = LinkBudgetEngine.computeGaseousAttenuationDb(dJammerM, jPos[2], acnPos[2], rfConfig.carrierFrequencyHz);
  const freezingIsothermM = THEATER_BIOMES[terrainEngine.activeBiomeId]?.freezingIsothermM ?? 4800.0;
  const rainJ = LinkBudgetEngine.computeRainAttenuationDb(dJammerM, envConfig, jPos[2], acnPos[2], freezingIsothermM, rfConfig.carrierFrequencyHz);
  const lossJ = fsplJ + shieldLossDb + gasJ + rainJ + rfConfig.cableLossDb;
  const spotGainDb = isSpot ? computeSpotJammerGainOffsetDb(jPos, acnPos, azimuthDeg, beamwidthDeg) : 0.0;
  const effEirpDbm = eirpDbm + spotGainDb;

  if (antennaEngine) {
    const sectorEval = antennaEngine.evaluateNodeSector(
      -999,
      acnPos,
      acnVel,
      jPos,
      rfConfig.acnAntennaGainDbi,
      false,
      acnAttitude
    );
    const gains = sectorEval.allSectorGainsDbi;
    const s0 = effEirpDbm + gains[0] - lossJ;
    const s1 = effEirpDbm + gains[1] - lossJ;
    const s2 = effEirpDbm + gains[2] - lossJ;
    const s3 = effEirpDbm + gains[3] - lossJ;
    return {
      shieldLossDb,
      sectorRxDbm: [s0, s1, s2, s3],
      scalarRxDbm: effEirpDbm + gains[sectorEval.activeSectorId] - lossJ,
    };
  }

  const rxDbm = effEirpDbm + rfConfig.acnAntennaGainDbi - lossJ;
  return {
    shieldLossDb,
    sectorRxDbm: [rxDbm, rxDbm, rxDbm, rxDbm],
    scalarRxDbm: rxDbm,
  };
}

/**
 * Pure multi-jammer interference aggregator (linear milliwatt summation).
 * Sums the legacy EW jammer (when envConfig.jammerEnabled) plus all active
 * deployed 'barrage_jammer' and 'spot_jammer' units.
 *
 * Returns -Infinity with ZERO allocations when no jammers are active.
 */
export function computeAggregateJammerInterferenceDbm(params: {
  readonly equipment: readonly TacticalEquipmentItem[];
  readonly acnPos: Position3D;
  readonly acnVel?: Position3D;
  readonly acnAttitude?: AcnAttitudeState;
  readonly terrainEngine: TerrainEngine;
  readonly rfConfig: RFConfig;
  readonly envConfig: EnvironmentConfig;
  readonly antennaEngine?: QuadSectorAntennaEngine;
  readonly sectorIndex?: 0 | 1 | 2 | 3;
}): number {
  const legacyActive = Boolean(params.envConfig?.jammerEnabled);
  const items = params.equipment;
  let hasActiveDeployed = false;
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const eq = items[i];
      if (eq.enabled && (eq.type === 'barrage_jammer' || eq.type === 'spot_jammer')) {
        hasActiveDeployed = true;
        break;
      }
    }
  }
  if (!legacyActive && !hasActiveDeployed) {
    return Number.NEGATIVE_INFINITY;
  }

  const acnVel: Position3D = params.acnVel ?? [0, 0, 0];
  let totalMw = 0.0;

  if (legacyActive) {
    const jX = params.envConfig.jammerPosEnu[0];
    const jY = params.envConfig.jammerPosEnu[1];
    const surfZ = params.terrainEngine.getElevation(jX, jY);
    const jZ = Number.isFinite(surfZ) ? surfZ + 3.0 : 3.0;
    const res = evaluateSingleJammerPath(
      [jX, jY, jZ],
      params.envConfig.jammerEirpDbm,
      false,
      undefined,
      undefined,
      params.acnPos,
      acnVel,
      params.acnAttitude,
      params.terrainEngine,
      params.rfConfig,
      params.envConfig,
      params.antennaEngine
    );
    const rxDbm = params.sectorIndex !== undefined ? res.sectorRxDbm[params.sectorIndex] : res.scalarRxDbm;
    totalMw += Math.pow(10.0, rxDbm / 10.0);
  }

  if (hasActiveDeployed) {
    for (let i = 0; i < items.length; i++) {
      const eq = items[i];
      if (!eq.enabled || (eq.type !== 'barrage_jammer' && eq.type !== 'spot_jammer')) continue;
      const res = evaluateSingleJammerPath(
        [eq.xM, eq.yM, eq.zM],
        eq.eirpDbm,
        eq.type === 'spot_jammer',
        eq.azimuthDeg,
        eq.beamwidthDeg,
        params.acnPos,
        acnVel,
        params.acnAttitude,
        params.terrainEngine,
        params.rfConfig,
        params.envConfig,
        params.antennaEngine
      );
      const rxDbm = params.sectorIndex !== undefined ? res.sectorRxDbm[params.sectorIndex] : res.scalarRxDbm;
      totalMw += Math.pow(10.0, rxDbm / 10.0);
    }
  }

  return totalMw > 0.0 ? 10.0 * Math.log10(totalMw) : Number.NEGATIVE_INFINITY;
}

/**
 * Worker-facing 4-sector multi-jammer aggregator.
 * Zero-allocation fast path when neither legacy jammer nor deployed jammers are active.
 */
export function evaluateAllJammersBySector(params: {
  readonly equipment: readonly TacticalEquipmentItem[];
  readonly acnPos: Position3D;
  readonly acnVel: Position3D;
  readonly acnAttitude?: AcnAttitudeState;
  readonly terrainEngine: TerrainEngine;
  readonly rfConfig: RFConfig;
  readonly envConfig: EnvironmentConfig;
  readonly antennaEngine: QuadSectorAntennaEngine;
}): AggregateJammerWorkerResult {
  const legacyActive = Boolean(params.envConfig?.jammerEnabled);
  const items = params.equipment;
  let hasActiveDeployed = false;
  for (let i = 0; i < items.length; i++) {
    const eq = items[i];
    if (eq.enabled && (eq.type === 'barrage_jammer' || eq.type === 'spot_jammer')) {
      hasActiveDeployed = true;
      break;
    }
  }
  if (!legacyActive && !hasActiveDeployed) {
    return IDLE_JAMMER_WORKER_RESULT;
  }

  let mw0 = 0.0;
  let mw1 = 0.0;
  let mw2 = 0.0;
  let mw3 = 0.0;
  let dominantPowerDbm = Number.NEGATIVE_INFINITY;
  let dominantShieldDb = 0.0;
  let dominantJammerPosEnu: Position3D | undefined = undefined;
  const shieldByEquipmentId = hasActiveDeployed ? new Map<string, number>() : undefined;

  if (legacyActive) {
    const jX = params.envConfig.jammerPosEnu[0];
    const jY = params.envConfig.jammerPosEnu[1];
    const surfZ = params.terrainEngine.getElevation(jX, jY);
    const jZ = Number.isFinite(surfZ) ? surfZ + 3.0 : 3.0;
    const jPos: Position3D = [jX, jY, jZ];
    const res = evaluateSingleJammerPath(
      jPos,
      params.envConfig.jammerEirpDbm,
      false,
      undefined,
      undefined,
      params.acnPos,
      params.acnVel,
      params.acnAttitude,
      params.terrainEngine,
      params.rfConfig,
      params.envConfig,
      params.antennaEngine
    );
    mw0 += Math.pow(10.0, res.sectorRxDbm[0] / 10.0);
    mw1 += Math.pow(10.0, res.sectorRxDbm[1] / 10.0);
    mw2 += Math.pow(10.0, res.sectorRxDbm[2] / 10.0);
    mw3 += Math.pow(10.0, res.sectorRxDbm[3] / 10.0);
    dominantPowerDbm = res.scalarRxDbm;
    dominantShieldDb = res.shieldLossDb;
    dominantJammerPosEnu = jPos;
  }

  if (hasActiveDeployed) {
    for (let i = 0; i < items.length; i++) {
      const eq = items[i];
      if (!eq.enabled || (eq.type !== 'barrage_jammer' && eq.type !== 'spot_jammer')) continue;
      const jPos: Position3D = [eq.xM, eq.yM, eq.zM];
      const res = evaluateSingleJammerPath(
        jPos,
        eq.eirpDbm,
        eq.type === 'spot_jammer',
        eq.azimuthDeg,
        eq.beamwidthDeg,
        params.acnPos,
        params.acnVel,
        params.acnAttitude,
        params.terrainEngine,
        params.rfConfig,
        params.envConfig,
        params.antennaEngine
      );
      mw0 += Math.pow(10.0, res.sectorRxDbm[0] / 10.0);
      mw1 += Math.pow(10.0, res.sectorRxDbm[1] / 10.0);
      mw2 += Math.pow(10.0, res.sectorRxDbm[2] / 10.0);
      mw3 += Math.pow(10.0, res.sectorRxDbm[3] / 10.0);
      shieldByEquipmentId?.set(eq.id, res.shieldLossDb);
      if (res.scalarRxDbm > dominantPowerDbm) {
        dominantPowerDbm = res.scalarRxDbm;
        dominantShieldDb = res.shieldLossDb;
        dominantJammerPosEnu = jPos;
      }
    }
  }

  const sectorTuple: readonly [number, number, number, number] = [
    mw0 > 0 ? 10.0 * Math.log10(mw0) : -150.0,
    mw1 > 0 ? 10.0 * Math.log10(mw1) : -150.0,
    mw2 > 0 ? 10.0 * Math.log10(mw2) : -150.0,
    mw3 > 0 ? 10.0 * Math.log10(mw3) : -150.0,
  ];

  return {
    jammerShieldLossDb: dominantShieldDb,
    jammerSectorInterferenceDbm: sectorTuple,
    jammerInterferenceBySector: sectorTuple,
    dominantJammerPosEnu,
    shieldByEquipmentId,
  };
}

export interface RelayMastEvaluationNode {
  readonly nodeId: number;
  readonly nodeType: string;
  readonly position: Position3D;
  readonly aglM: number;
  readonly txPowerDbm?: number;
}

/**
 * Evaluates two-hop Decode-and-Forward link recovery through active deployed 'relay_mast' units
 * for shadowed or degraded ground terminals when both hop-1 (node->mast) and hop-2 (mast->ACN) have clear LOS.
 */
export function evaluateDeployedRelayMastBoost(params: {
  readonly equipment: readonly TacticalEquipmentItem[];
  readonly nodes: readonly RelayMastEvaluationNode[];
  readonly acnPos: Position3D;
  readonly acnVel: Position3D;
  readonly acnAccel?: Position3D;
  readonly acnAttitude?: AcnAttitudeState;
  readonly terrainEngine: TerrainEngine;
  readonly linkEngine: LinkBudgetEngine;
  readonly rfConfig: RFConfig;
  readonly envConfig: EnvironmentConfig;
  readonly antennaEngine: QuadSectorAntennaEngine;
  readonly nextLinks: Map<number, LinkStatus>;
  readonly nextShadow: Map<number, boolean>;
  readonly jammerInterferenceBySector?: readonly [number, number, number, number];
  readonly biomeId?: string;
  readonly acnAltAglM?: number;
}): {
  readonly relayedNodeCount: number;
  readonly relayedCountByMastId: ReadonlyMap<string, number> | undefined;
} {
  const masts: TacticalEquipmentItem[] = [];
  for (let i = 0; i < params.equipment.length; i++) {
    const eq = params.equipment[i];
    if (eq.enabled && eq.type === 'relay_mast') masts.push(eq);
  }
  if (masts.length === 0) {
    return { relayedNodeCount: 0, relayedCountByMastId: undefined };
  }

  const relayedCountByMastId = new Map<string, number>();
  const relayGainDbi = params.envConfig.relayAntennaGainDbi ?? 12.0;
  let totalRelayed = 0;

  // Pre-evaluate Hop 2 (mast -> ACN) for each active relay mast with clear LOS to ACN
  const mastBackhauls: Array<{
    mast: TacticalEquipmentItem;
    dHop2M: number;
    hop2Link: LinkStatus;
  }> = [];

  for (let m = 0; m < masts.length; m++) {
    const mast = masts[m];
    relayedCountByMastId.set(mast.id, 0);
    const mastPos: Position3D = [mast.xM, mast.yM, mast.zM];
    const hop2Obs = params.terrainEngine.evaluateTerrainObstruction(
      mastPos,
      params.acnPos,
      params.rfConfig,
      params.envConfig
    );
    if (!hop2Obs.isLos || hop2Obs.obstacleBlocked) continue;

    const dHop2M = Math.max(
      1.0,
      Math.hypot(params.acnPos[0] - mastPos[0], params.acnPos[1] - mastPos[1], params.acnPos[2] - mastPos[2])
    );
    const hop2SectorEval = params.antennaEngine.evaluateNodeSector(
      -888,
      params.acnPos,
      params.acnVel,
      mastPos,
      params.rfConfig.acnAntennaGainDbi,
      false,
      params.acnAttitude
    );
    const hop2Doppler = LinkBudgetEngine.computeDopplerKinematics(
      params.acnPos,
      params.acnVel,
      mastPos,
      params.rfConfig.carrierFrequencyHz,
      params.acnAccel ?? [0, 0, 0]
    );
    const hop2JammerDbm = params.jammerInterferenceBySector !== undefined
      ? params.jammerInterferenceBySector[hop2SectorEval.activeSectorId]
      : undefined;

    const hop2TxPowerDbm = mast.eirpDbm - params.rfConfig.mcpAntennaGainDbi;
    const hop2Link = params.linkEngine.evaluateLink({
      nodeType: 'mcp',
      slantRangeM: dHop2M,
      diffractionLossDb: hop2Obs.diffractionLossDb,
      rf: params.rfConfig,
      env: params.envConfig,
      obstacleBlocked: false,
      customTxPowerDbm: hop2TxPowerDbm,
      sectorEval: hop2SectorEval,
      nodeAltM: mastPos[2],
      acnAltM: params.acnPos[2],
      crestRadiusM: hop2Obs.crestRadiusM,
      curvatureLossDb: hop2Obs.curvatureLossDb,
      jammerInterferenceDbm: hop2JammerDbm,
      radialVelocityMs: hop2Doppler.radialVelocityMs,
      dopplerShiftHz: hop2Doppler.dopplerShiftHz,
      dopplerRateHzS: hop2Doppler.dopplerRateHzS,
      txX: mastPos[0],
      txY: mastPos[1],
      rxX: params.acnPos[0],
      rxY: params.acnPos[1],
      txAltAglM: params.acnAltAglM,
      rxAltAglM: mast.heightAglM,
    });
    if (!hop2Link.isOutage && hop2Link.bitrateBps > 0) {
      mastBackhauls.push({ mast, dHop2M, hop2Link });
    }
  }

  if (mastBackhauls.length === 0) {
    return { relayedNodeCount: 0, relayedCountByMastId };
  }

  for (let i = 0; i < params.nodes.length; i++) {
    const node = params.nodes[i];
    const directLink = params.nextLinks.get(node.nodeId);
    if (!directLink) continue;
    if (!directLink.isOutage && directLink.bitrateMbps >= 5.0) continue;

    let bestRelayed: LinkStatus | null = null;
    let bestMastId: string | null = null;

    for (let b = 0; b < mastBackhauls.length; b++) {
      const { mast, dHop2M, hop2Link } = mastBackhauls[b];
      const mastPos: Position3D = [mast.xM, mast.yM, mast.zM];
      const hop1Obs = params.terrainEngine.evaluateTerrainObstruction(
        node.position,
        mastPos,
        params.rfConfig,
        params.envConfig
      );
      if (!hop1Obs.isLos || hop1Obs.obstacleBlocked) continue;

      const dHop1M = Math.max(
        1.0,
        Math.hypot(mastPos[0] - node.position[0], mastPos[1] - node.position[1], mastPos[2] - node.position[2])
      );
      const nodeTxPowerDbm = node.txPowerDbm ?? params.rfConfig.getTransmitterParams(node.nodeType === 'convoy' ? 'vehicular' : node.nodeType).txPowerDbm;
      const hop1Link = params.linkEngine.evaluateLink({
        nodeType: node.nodeType === 'convoy' ? 'vehicular' : node.nodeType,
        slantRangeM: dHop1M,
        diffractionLossDb: hop1Obs.diffractionLossDb,
        rf: params.rfConfig,
        env: params.envConfig,
        obstacleBlocked: false,
        customTxPowerDbm: nodeTxPowerDbm,
        nodeAltM: node.position[2],
        acnAltM: mastPos[2],
        crestRadiusM: hop1Obs.crestRadiusM,
        curvatureLossDb: hop1Obs.curvatureLossDb,
        customRxGainDbi: relayGainDbi,
        txX: node.position[0],
        txY: node.position[1],
        rxX: mastPos[0],
        rxY: mastPos[1],
        txAltAglM: mast.heightAglM,
        rxAltAglM: node.aglM,
      });

      const candidate = LinkBudgetEngine.computeDecodeAndForwardRelayLink(
        directLink,
        hop1Link,
        hop2Link,
        dHop1M,
        dHop2M,
        params.rfConfig.speedOfLight
      );
      if (candidate.isRelayed && (!bestRelayed || candidate.bitrateBps > bestRelayed.bitrateBps)) {
        bestRelayed = candidate;
        bestMastId = mast.id;
      }
    }

    if (bestRelayed && bestMastId) {
      params.nextLinks.set(node.nodeId, bestRelayed);
      params.nextShadow.set(node.nodeId, false);
      relayedCountByMastId.set(bestMastId, (relayedCountByMastId.get(bestMastId) ?? 0) + 1);
      totalRelayed++;
    }
  }

  return { relayedNodeCount: totalRelayed, relayedCountByMastId };
}

export interface EsmInterceptReading {
  readonly rxPowerDbm: number;
  readonly marginDb: number;
  readonly detected: boolean;
}

/**
 * Evaluates passive adversary ESM intercept power & detection margin (rxPowerDbm - sensitivityDbm)
 * at each active deployed 'esm_sensor'. Returns undefined when no ESM sensors are deployed.
 */
export function evaluateDeployedEsmIntercept(params: {
  readonly equipment: readonly TacticalEquipmentItem[];
  readonly acnPos: Position3D;
  readonly nodes?: readonly RelayMastEvaluationNode[];
  readonly terrainEngine: TerrainEngine;
  readonly rfConfig: RFConfig;
  readonly envConfig: EnvironmentConfig;
}): ReadonlyMap<string, EsmInterceptReading> | undefined {
  let hasEsm = false;
  for (let i = 0; i < params.equipment.length; i++) {
    const eq = params.equipment[i];
    if (eq.enabled && eq.type === 'esm_sensor') {
      hasEsm = true;
      break;
    }
  }
  if (!hasEsm) return undefined;

  const readings = new Map<string, EsmInterceptReading>();
  const acnEirpDbm = params.rfConfig.acnTxPowerDbm + params.rfConfig.acnAntennaGainDbi;
  const esmAntennaGainDbi = 0.0;

  for (let i = 0; i < params.equipment.length; i++) {
    const eq = params.equipment[i];
    if (!eq.enabled || eq.type !== 'esm_sensor') continue;
    const esmPos: Position3D = [eq.xM, eq.yM, eq.zM];
    const sensitivityDbm = eq.sensitivityDbm ?? DEFAULT_ESM_SENSITIVITY_DBM;

    // 1. ACN downlink intercept
    const dAcnM = Math.max(1.0, Math.hypot(params.acnPos[0] - esmPos[0], params.acnPos[1] - esmPos[1], params.acnPos[2] - esmPos[2]));
    const obsAcn = params.terrainEngine.evaluateTerrainObstruction(params.acnPos, esmPos, params.rfConfig, params.envConfig);
    const fsplAcn = LinkBudgetEngine.computeFsplDb(dAcnM, params.rfConfig.carrierFrequencyHz, params.rfConfig.speedOfLight);
    const gasAcn = LinkBudgetEngine.computeGaseousAttenuationDb(dAcnM, params.acnPos[2], esmPos[2], params.rfConfig.carrierFrequencyHz);
    const rainAcn = LinkBudgetEngine.computeRainAttenuationDb(dAcnM, params.envConfig, params.acnPos[2], esmPos[2]);
    let maxRxDbm = acnEirpDbm + esmAntennaGainDbi - (fsplAcn + (obsAcn.diffractionLossDb ?? 0.0) + gasAcn + rainAcn);

    // 2. Ground terminal uplink intercept
    const nodes = params.nodes ?? [];
    for (let n = 0; n < nodes.length; n++) {
      const node = nodes[n];
      const dNodeM = Math.max(1.0, Math.hypot(node.position[0] - esmPos[0], node.position[1] - esmPos[1], node.position[2] - esmPos[2]));
      const txGain = params.rfConfig.getTransmitterParams(node.nodeType === 'convoy' ? 'vehicular' : node.nodeType).antennaGainDbi;
      const obsNode = params.terrainEngine.evaluateTerrainObstruction(node.position, esmPos, params.rfConfig, params.envConfig);
      const fsplNode = LinkBudgetEngine.computeFsplDb(dNodeM, params.rfConfig.carrierFrequencyHz, params.rfConfig.speedOfLight);
      const gasNode = LinkBudgetEngine.computeGaseousAttenuationDb(dNodeM, node.position[2], esmPos[2], params.rfConfig.carrierFrequencyHz);
      const rainNode = LinkBudgetEngine.computeRainAttenuationDb(dNodeM, params.envConfig, node.position[2], esmPos[2]);
      const nodeTxPowerDbm = node.txPowerDbm ?? params.rfConfig.getTransmitterParams(node.nodeType === 'convoy' ? 'vehicular' : node.nodeType).txPowerDbm;
      const rxNodeDbm = nodeTxPowerDbm + txGain + esmAntennaGainDbi - (fsplNode + (obsNode.diffractionLossDb ?? 0.0) + gasNode + rainNode);
      if (rxNodeDbm > maxRxDbm) {
        maxRxDbm = rxNodeDbm;
      }
    }

    const marginDb = maxRxDbm - sensitivityDbm;
    readings.set(eq.id, {
      rxPowerDbm: maxRxDbm,
      marginDb,
      detected: marginDb >= 0.0,
    });
  }

  return readings;
}

/**
 * Estimates visual effective footprint radius (m) for 2D/3D tactical equipment overlays.
 */
export function estimateEquipmentRadiusM(eq: TacticalEquipmentItem): number {
  if (eq.type === 'barrage_jammer' || eq.type === 'spot_jammer') {
    const baseR = 2500.0 * Math.pow(10.0, (eq.eirpDbm - 55.0) / 25.0);
    return clamp(baseR, 1200.0, 22000.0);
  }
  if (eq.type === 'relay_mast') {
    return clamp(3500.0 + eq.heightAglM * 120.0, 3500.0, 16000.0);
  }
  return 6000.0;
}

/**
 * Projects live equipment items and evaluated metrics into read-only TelemetryFrame payloads.
 */
export function serializeTacticalEquipmentTelemetry(
  equipment: readonly TacticalEquipmentItem[],
  shieldById?: ReadonlyMap<string, number>,
  relayedById?: ReadonlyMap<string, number>,
  esmReadings?: ReadonlyMap<string, EsmInterceptReading>
): TacticalEquipmentTelemetry[] {
  return equipment.map((eq) => {
    const esm = esmReadings?.get(eq.id);
    const shieldDb = shieldById?.get(eq.id);
    const relayedCount = relayedById?.get(eq.id);
    return {
      id: eq.id,
      type: eq.type,
      label: eq.label,
      x_m: eq.xM,
      y_m: eq.yM,
      z_m: eq.zM,
      height_agl_m: eq.heightAglM,
      eirp_dbm: eq.eirpDbm,
      enabled: eq.enabled,
      ...(eq.azimuthDeg !== undefined ? { azimuth_deg: eq.azimuthDeg } : {}),
      ...(eq.beamwidthDeg !== undefined ? { beamwidth_deg: eq.beamwidthDeg } : {}),
      ...(eq.sensitivityDbm !== undefined ? { sensitivity_dbm: eq.sensitivityDbm } : {}),
      effective_radius_m: estimateEquipmentRadiusM(eq),
      ...(shieldDb !== undefined ? { jammer_shield_db: shieldDb } : {}),
      ...(relayedCount !== undefined ? { relayed_count: relayedCount } : {}),
      ...(esm ? {
        intercept_rx_dbm: esm.rxPowerDbm,
        intercept_margin_db: esm.marginDb,
        intercept_detected: esm.detected,
      } : {}),
    };
  });
}

const VALID_MCS_MODES: ReadonlySet<string> = new Set(['acm_auto', 'manual_lock']);
const VALID_MANUAL_MODS: ReadonlySet<string> = new Set(['QPSK', '8-PSK', '16-QAM', '16-APSK', '32-APSK', '64-APSK']);
const VALID_MANUAL_FECS: ReadonlySet<string> = new Set(['1/2', '2/3', '3/4', '5/6']);

/**
 * Validates and applies optional manual MCS mode / modulation / FEC fields from CONFIG_UPDATE.
 */
export function applyMcsConfigUpdate(
  rfConfig: RFConfig,
  p: Record<string, unknown>
): { rfConfig: RFConfig; updated: boolean; error?: string } {
  const rawMode = p.mcs_mode ?? p.mcsMode;
  const rawMod = p.manual_modulation ?? p.manualModulation;
  const rawFec = p.manual_fec ?? p.manualFec;
  if (rawMode === undefined && rawMod === undefined && rawFec === undefined) {
    return { rfConfig, updated: false };
  }
  if (rawMode !== undefined && (typeof rawMode !== 'string' || !VALID_MCS_MODES.has(rawMode))) {
    return { rfConfig, updated: false, error: "mcs_mode must be 'acm_auto' or 'manual_lock'." };
  }
  if (rawMod !== undefined && (typeof rawMod !== 'string' || !VALID_MANUAL_MODS.has(rawMod))) {
    return { rfConfig, updated: false, error: 'Invalid manual_modulation value.' };
  }
  if (rawFec !== undefined && (typeof rawFec !== 'string' || !VALID_MANUAL_FECS.has(rawFec))) {
    return { rfConfig, updated: false, error: 'Invalid manual_fec value.' };
  }
  const nextRf = new RFConfig({
    ...rfConfig,
    mcsMode: (rawMode as McsMode | undefined) ?? rfConfig.mcsMode,
    manualModulation: (rawMod as ManualModulation | undefined) ?? rfConfig.manualModulation,
    manualFec: (rawFec as ManualFec | undefined) ?? rfConfig.manualFec,
  });
  return { rfConfig: nextRf, updated: true };
}

export function evaluateDeployedEquipmentTelemetry(params: {
  readonly equipment: readonly TacticalEquipmentItem[];
  readonly nodes: readonly RelayMastEvaluationNode[];
  readonly acnPos: Position3D;
  readonly acnVel: Position3D;
  readonly acnAccel?: Position3D;
  readonly acnAttitude?: AcnAttitudeState;
  readonly terrainEngine: TerrainEngine;
  readonly linkEngine: LinkBudgetEngine;
  readonly rfConfig: RFConfig;
  readonly envConfig: EnvironmentConfig;
  readonly antennaEngine: QuadSectorAntennaEngine;
  readonly nextLinks: Map<number, LinkStatus>;
  readonly nextShadow: Map<number, boolean>;
  readonly jammerInterferenceBySector?: readonly [number, number, number, number];
  readonly shieldByEquipmentId?: ReadonlyMap<string, number>;
  readonly biomeId?: string;
  readonly acnAltAglM?: number;
}): { readonly relayedNodeCount: number; readonly tacticalEquipment: readonly TacticalEquipmentTelemetry[] } {
  if (params.equipment.length === 0) {
    return { relayedNodeCount: 0, tacticalEquipment: [] };
  }
  const mastRes = evaluateDeployedRelayMastBoost(params);
  const esmReadings = evaluateDeployedEsmIntercept(params);
  return {
    relayedNodeCount: mastRes.relayedNodeCount,
    tacticalEquipment: serializeTacticalEquipmentTelemetry(
      params.equipment,
      params.shieldByEquipmentId,
      mastRes.relayedCountByMastId,
      esmReadings
    ),
  };
}

/**
 * Handles EQUIPMENT_ADD, EQUIPMENT_UPDATE, EQUIPMENT_DELETE, and EQUIPMENT_CLEAR commands.
 */
export function executeTacticalEquipmentCommand(
  registry: TacticalEquipmentRegistry,
  msg: Record<string, unknown>,
  terrainElevationLookup: (xM: number, yM: number) => number,
  spatialLocked: boolean
): { accepted: boolean; reason?: string; equipmentId?: string } {
  const commandType = String(msg.type || '').toUpperCase();
  if (spatialLocked) {
    return { accepted: false, reason: 'Spatial state is locked.' };
  }
  if (commandType === 'EQUIPMENT_ADD') {
    const xM = typeof msg.x_m === 'number' ? msg.x_m : (typeof msg.xM === 'number' ? msg.xM : Number.NaN);
    const yM = typeof msg.y_m === 'number' ? msg.y_m : (typeof msg.yM === 'number' ? msg.yM : Number.NaN);
    const res = registry.add({
      id: typeof msg.id === 'string' ? msg.id : undefined,
      type: msg.equipment_type as TacticalEquipmentType ?? (msg.equipmentType as TacticalEquipmentType),
      label: typeof msg.label === 'string' ? msg.label : undefined,
      xM,
      yM,
      heightAglM: typeof msg.height_agl_m === 'number' ? msg.height_agl_m : (typeof msg.heightAglM === 'number' ? msg.heightAglM : undefined),
      eirpDbm: typeof msg.eirp_dbm === 'number' ? msg.eirp_dbm : (typeof msg.eirpDbm === 'number' ? msg.eirpDbm : undefined),
      enabled: typeof msg.enabled === 'boolean' ? msg.enabled : undefined,
      azimuthDeg: typeof msg.azimuth_deg === 'number' ? msg.azimuth_deg : (typeof msg.azimuthDeg === 'number' ? msg.azimuthDeg : undefined),
      beamwidthDeg: typeof msg.beamwidth_deg === 'number' ? msg.beamwidth_deg : (typeof msg.beamwidthDeg === 'number' ? msg.beamwidthDeg : undefined),
      sensitivityDbm: typeof msg.sensitivity_dbm === 'number' ? msg.sensitivity_dbm : (typeof msg.sensitivityDbm === 'number' ? msg.sensitivityDbm : undefined),
    }, terrainElevationLookup);
    return res.accepted
      ? { accepted: true, equipmentId: res.item?.id }
      : { accepted: false, reason: res.reason };
  }
  if (commandType === 'EQUIPMENT_UPDATE') {
    const id = typeof msg.id === 'string' ? msg.id : '';
    const res = registry.update(id, {
      label: typeof msg.label === 'string' ? msg.label : undefined,
      xM: typeof msg.x_m === 'number' ? msg.x_m : (typeof msg.xM === 'number' ? msg.xM : undefined),
      yM: typeof msg.y_m === 'number' ? msg.y_m : (typeof msg.yM === 'number' ? msg.yM : undefined),
      heightAglM: typeof msg.height_agl_m === 'number' ? msg.height_agl_m : (typeof msg.heightAglM === 'number' ? msg.heightAglM : undefined),
      eirpDbm: typeof msg.eirp_dbm === 'number' ? msg.eirp_dbm : (typeof msg.eirpDbm === 'number' ? msg.eirpDbm : undefined),
      enabled: typeof msg.enabled === 'boolean' ? msg.enabled : undefined,
      azimuthDeg: typeof msg.azimuth_deg === 'number' ? msg.azimuth_deg : (typeof msg.azimuthDeg === 'number' ? msg.azimuthDeg : undefined),
      beamwidthDeg: typeof msg.beamwidth_deg === 'number' ? msg.beamwidth_deg : (typeof msg.beamwidthDeg === 'number' ? msg.beamwidthDeg : undefined),
      sensitivityDbm: typeof msg.sensitivity_dbm === 'number' ? msg.sensitivity_dbm : (typeof msg.sensitivityDbm === 'number' ? msg.sensitivityDbm : undefined),
    }, terrainElevationLookup);
    return res.accepted
      ? { accepted: true, equipmentId: res.item?.id }
      : { accepted: false, reason: res.reason };
  }
  if (commandType === 'EQUIPMENT_DELETE') {
    const id = typeof msg.id === 'string' ? msg.id : '';
    const res = registry.delete(id);
    return res.accepted
      ? { accepted: true, equipmentId: id }
      : { accepted: false, reason: res.reason };
  }
  if (commandType === 'EQUIPMENT_CLEAR') {
    registry.clear();
    return { accepted: true };
  }
  return { accepted: false, reason: `Unsupported equipment command '${commandType}'.` };
}
