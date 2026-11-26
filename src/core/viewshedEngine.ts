/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Polar X-Band SINR Viewshed Engine & 360° Orbit-Integrated Relay Placement Advisor
 *
 * Implements:
 * 1. Zero-allocation Polar X-Band SINR Viewshed Grid (36 azimuths x 16 radial ranges = 576 polar cells).
 * 2. 50 Hz discrete-event slice updates (amortized 6 azimuth rays per 20 ms tick).
 * 3. ITU-R P.526-15 terrain diffraction, ITU-R F.1336 body-fixed 4-sector antenna gain,
 *    ITU-R P.676 altitude gaseous absorption, and contested EW jammer interference coupling.
 * 4. 360° Orbit-Integrated Availability & Optimal Ridgeline Relay Placement Advisor.
 */

import { Position3D } from '../shared/types';
import { RFConfig, EnvironmentConfig, NodeType } from './config';
import { TerrainEngine, TerrainObstruction } from './terrain';
import { QuadSectorAntennaEngine, AcnAttitudeState, worldLosToBodyFrame } from './antennaArray';
import { LinkBudgetEngine, LinkStatus } from './linkBudget';
import { THEATER_BIOMES } from './biomePhysics';
import { isWasmPhysicsReady, wasmComputePolarViewshed } from './wasmPhysicsBridge';
import type { ACNTrajectory } from './trajectory';

export const NUM_AZIMUTHS = 36; // 10° angular steps: 0°, 10°, ..., 350°
export const NUM_RANGES = 16;   // 16 radial rings: 1,500 m to 24,000 m in 1,500 m steps
export const R_MIN_M = 1500;
export const R_STEP_M = 1500;
export const R_MAX_M = 24000;
export const TOTAL_VIEWSHED_CELLS = NUM_AZIMUTHS * NUM_RANGES; // 576

export interface RelayAdvisorReport {
  readonly optimalPosEnu: Position3D;
  readonly optimalLatDeg: number;
  readonly optimalLonDeg: number;
  readonly elevationMslM: number;
  readonly orbitAvailabilityPct: number;
  readonly groundNodeCoveragePct: number;
  readonly meanSinrToAcnDb: number;
}

export interface ViewshedParityOptions {
  readonly nodeType?: NodeType | string;
  readonly customTxPowerDbm?: number;
  readonly customRxGainDbi?: number;
  readonly attitudeOverride?: AcnAttitudeState;
  readonly jammerInterferenceBySector?: readonly [number, number, number, number];
  readonly stepIntervalM?: number;
  readonly groundTerminalHeightM?: number;
  readonly crestRadiusM?: number;
  readonly curvatureLossDb?: number;
}

export interface ViewshedParityResult {
  readonly position: Position3D;
  readonly sinrDb: number;
  readonly linkStatus: LinkStatus;
  readonly obstruction: TerrainObstruction;
  readonly isOutage: boolean;
  readonly isLos: boolean;
  readonly modcodName: string;
  readonly bitrateMbps: number;
}

export interface ViewshedParityAuditReport {
  readonly sampleCount: number;
  readonly maxAbsErrorDb: number;
  readonly meanAbsErrorDb: number;
  readonly rmseDb: number;
  readonly biasDb: number;
  readonly classificationAgreementRate: number;
  readonly disagreementIndices: readonly number[];
}

export type ViewshedSampleInput =
  | number
  | { readonly snrDb?: number; readonly sinrDb?: number; readonly isOutage?: boolean };

/**
 * Quantitative auditor measuring RF link-budget parity and classification agreement
 * between viewshed grid samples and live link evaluations.
 */
export function auditViewshedLinkBudgetParity(
  viewshedSamples: readonly ViewshedSampleInput[],
  liveLinkSamples: readonly ViewshedSampleInput[],
  linkMarginThresholdDb: number = -1.5
): ViewshedParityAuditReport {
  if (!viewshedSamples || !liveLinkSamples) {
    return {
      sampleCount: 0,
      maxAbsErrorDb: 0.0,
      meanAbsErrorDb: 0.0,
      rmseDb: 0.0,
      biasDb: 0.0,
      classificationAgreementRate: 1.0,
      disagreementIndices: [],
    };
  }

  const count = Math.min(viewshedSamples.length, liveLinkSamples.length);
  if (count === 0) {
    return {
      sampleCount: 0,
      maxAbsErrorDb: 0.0,
      meanAbsErrorDb: 0.0,
      rmseDb: 0.0,
      biasDb: 0.0,
      classificationAgreementRate: 1.0,
      disagreementIndices: [],
    };
  }

  let validCount = 0;
  let sumDiff = 0.0;
  let sumAbsDiff = 0.0;
  let sumSqDiff = 0.0;
  let maxAbs = 0.0;
  let agreementCount = 0;
  const disagreementIndices: number[] = [];

  for (let i = 0; i < count; i++) {
    const s1 = viewshedSamples[i];
    const s2 = liveLinkSamples[i];

    let v1: number | undefined;
    let o1: boolean | undefined;
    if (typeof s1 === 'number') {
      if (Number.isFinite(s1)) v1 = s1;
    } else if (s1 && typeof s1 === 'object') {
      const num = s1.sinrDb !== undefined ? s1.sinrDb : s1.snrDb;
      if (num !== undefined && Number.isFinite(num)) v1 = num;
      o1 = s1.isOutage;
    }

    let v2: number | undefined;
    let o2: boolean | undefined;
    if (typeof s2 === 'number') {
      if (Number.isFinite(s2)) v2 = s2;
    } else if (s2 && typeof s2 === 'object') {
      const num = s2.sinrDb !== undefined ? s2.sinrDb : s2.snrDb;
      if (num !== undefined && Number.isFinite(num)) v2 = num;
      o2 = s2.isOutage;
    }

    if (v1 === undefined || v2 === undefined) {
      continue;
    }

    validCount++;
    const diff = v1 - v2;
    const absDiff = Math.abs(diff);
    sumDiff += diff;
    sumAbsDiff += absDiff;
    sumSqDiff += diff * diff;
    if (absDiff > maxAbs) maxAbs = absDiff;

    const outage1 = o1 !== undefined ? o1 : v1 < linkMarginThresholdDb;
    const outage2 = o2 !== undefined ? o2 : v2 < linkMarginThresholdDb;

    if (outage1 === outage2) {
      agreementCount++;
    } else {
      disagreementIndices.push(i);
    }
  }

  if (validCount === 0) {
    return {
      sampleCount: 0,
      maxAbsErrorDb: 0.0,
      meanAbsErrorDb: 0.0,
      rmseDb: 0.0,
      biasDb: 0.0,
      classificationAgreementRate: 1.0,
      disagreementIndices: [],
    };
  }

  return {
    sampleCount: validCount,
    maxAbsErrorDb: Number(maxAbs.toFixed(4)),
    meanAbsErrorDb: Number((sumAbsDiff / validCount).toFixed(4)),
    rmseDb: Number(Math.sqrt(sumSqDiff / validCount).toFixed(4)),
    biasDb: Number((sumDiff / validCount).toFixed(4)),
    classificationAgreementRate: Number((agreementCount / validCount).toFixed(4)),
    disagreementIndices,
  };
}

export class PolarViewshedEngine {
  // Pre-allocated Float32Array: 0 heap allocations in the 50 Hz discrete simulation loop
  private readonly sinrGridDb = new Float32Array(TOTAL_VIEWSHED_CELLS);
  private nextAzimuthSliceIndex: number = 0;
  private readonly antennaEngine: QuadSectorAntennaEngine;
  private readonly linkBudgetEngine: LinkBudgetEngine;

  constructor(antennaEngine?: QuadSectorAntennaEngine, linkBudgetEngine?: LinkBudgetEngine) {
    this.antennaEngine = antennaEngine ?? new QuadSectorAntennaEngine();
    this.linkBudgetEngine = linkBudgetEngine ?? new LinkBudgetEngine();
    // Initialize with baseline noise floor / outage floor
    this.sinrGridDb.fill(-30.0);
  }

  /**
   * Returns authoritative raw Float32Array buffer of all 576 polar SINR cells (dB).
   */
  public getSinrGrid(): Float32Array {
    return this.sinrGridDb;
  }

  /**
   * Evaluates physical RF link budget with exact parity against live UAV links.
   * Leverages canonical terrain ray-marching, 4-sector antenna roll-off, and LinkBudgetEngine.evaluateLink.
   */
  public evaluateViewshedPointWithParity(
    target: Position3D | { worldBearingDeg: number; rangeM: number },
    acnPos: Position3D,
    acnVel: Position3D,
    terrain: TerrainEngine,
    rf: RFConfig,
    env: EnvironmentConfig,
    options?: ViewshedParityOptions
  ): ViewshedParityResult {
    let cellPos: Position3D;
    let slantDistM: number;
    const terminalHeight = options?.groundTerminalHeightM ?? 2.0;

    if ('worldBearingDeg' in target) {
      const radBearing = (target.worldBearingDeg * Math.PI) / 180.0;
      const sinB = Math.sin(radBearing);
      const cosB = Math.cos(radBearing);
      const cellX = acnPos[0] + target.rangeM * sinB;
      const cellY = acnPos[1] + target.rangeM * cosB;
      let zGround = terrain.getElevation(cellX, cellY);
      if (!Number.isFinite(zGround)) {
        zGround = 0.0;
      }
      const cellZ = zGround + terminalHeight;
      cellPos = [cellX, cellY, cellZ];
      const dx = cellX - acnPos[0];
      const dy = cellY - acnPos[1];
      const dz = cellZ - acnPos[2];
      slantDistM = Math.max(Math.hypot(dx, dy, dz), 1.0);
    } else {
      cellPos = target;
      const dx = cellPos[0] - acnPos[0];
      const dy = cellPos[1] - acnPos[1];
      const dz = cellPos[2] - acnPos[2];
      slantDistM = Math.max(Math.hypot(dx, dy, dz), 1.0);
    }

    const stepIntervalM = options?.stepIntervalM ?? 100.0;
    const obs = terrain.evaluateTerrainObstruction(cellPos, acnPos, rf, env, stepIntervalM);

    const attitude = options?.attitudeOverride ?? this.antennaEngine.computeAcnAttitude(acnVel);
    const sectorEval = this.antennaEngine.evaluateNodeSector(
      0,
      acnPos,
      acnVel,
      cellPos,
      rf.acnAntennaGainDbi,
      false,
      attitude
    );

    const activeSectorId = sectorEval.activeSectorId;
    const jammerDbm = options?.jammerInterferenceBySector?.[activeSectorId];
    const nodeType = options?.nodeType ?? 'soldier';
    const customTxPowerDbm = options?.customTxPowerDbm;

    const crestRadiusM = options?.crestRadiusM ?? obs.crestRadiusM;
    const curvatureLossDb = options?.curvatureLossDb ?? obs.curvatureLossDb;

    const linkStatus = this.linkBudgetEngine.evaluateLink(
      nodeType,
      slantDistM,
      obs.diffractionLossDb,
      rf,
      env,
      obs.obstacleBlocked,
      customTxPowerDbm,
      sectorEval,
      cellPos[2],
      acnPos[2],
      crestRadiusM,
      curvatureLossDb,
      jammerDbm,
      0,
      0,
      0,
      options?.customRxGainDbi
    );

    return {
      position: cellPos,
      sinrDb: linkStatus.snrDb,
      linkStatus,
      obstruction: obs,
      isOutage: linkStatus.isOutage,
      isLos: obs.isLos,
      modcodName: linkStatus.modcodName,
      bitrateMbps: linkStatus.bitrateMbps,
    };
  }

  /**
   * Evaluates single-cell physical link budget and SINR (dB) from a ground position to the ACN.
   *
   * Formulations:
   * 1. 3D Slant range & line-of-sight vector from ACN to ground cell.
   * 2. Body-fixed 4-sector antenna gain G_acn(theta_body, theta_el_body) via computeSectorAttenuationDb.
   * 3. FSPL (Friis) + ITU-R P.676-13 altitude gas loss + ITU-R P.838-3 rain loss + ITU-R P.526-15 diffraction loss.
   * 4. Contested EW Jammer interference I_J coupling into active ACN sector.
   * 5. Effective SINR = P_rx - 10*log10(P_noise + P_jammer).
   */
  public computeCellSinr(
    worldBearingDeg: number,
    rangeM: number,
    acnPos: Position3D,
    acnVel: Position3D,
    terrain: TerrainEngine,
    rf: RFConfig,
    env: EnvironmentConfig,
    attitudeOverride?: AcnAttitudeState,
    jammerInterferenceBySector?: readonly [number, number, number, number],
    fidelityMode: 'fast' | 'link-budget-parity' = 'fast'
  ): number {
    if (fidelityMode === 'link-budget-parity') {
      const parity = this.evaluateViewshedPointWithParity(
        { worldBearingDeg, rangeM },
        acnPos,
        acnVel,
        terrain,
        rf,
        env,
        { attitudeOverride, jammerInterferenceBySector }
      );
      return parity.sinrDb;
    }

    const radBearing = (worldBearingDeg * Math.PI) / 180.0;
    const sinB = Math.sin(radBearing);
    const cosB = Math.cos(radBearing);

    const cellX = acnPos[0] + rangeM * sinB;
    const cellY = acnPos[1] + rangeM * cosB;

    let zGround = terrain.getElevation(cellX, cellY);
    if (!Number.isFinite(zGround)) {
      zGround = 0.0;
    }
    const cellZ = zGround + 2.0; // Standard ground terminal height 2.0 m AGL
    const cellPos: Position3D = [cellX, cellY, cellZ];

    const dx = cellX - acnPos[0];
    const dy = cellY - acnPos[1];
    const dz = cellZ - acnPos[2];
    const horizDistM = Math.max(rangeM, 1.0);
    const slantDistM = Math.max(Math.hypot(dx, dy, dz), 1.0);

    // 1. Terrain diffraction obstruction
    const obs = terrain.evaluateTerrainObstruction(cellPos, acnPos, rf, env, 150.0);
    let diffLossDb = 0.0;
    if (obs.obstacleBlocked) {
      diffLossDb = 35.0;
    } else if (Number.isFinite(obs.diffractionLossDb)) {
      diffLossDb = obs.diffractionLossDb!;
    } else if (obs.isHardShadow || !obs.isCoverageComplete) {
      diffLossDb = 45.0;
    }

    // 2. ACN Attitude and Sector Antenna Gain (exact 3D NED->FRD body frame matching QuadSectorAntennaEngine)
    const attitude = attitudeOverride ?? this.antennaEngine.computeAcnAttitude(acnVel);
    const { headingDeg: acnHeadingDeg, pitchDeg: acnPitchDeg, bankDeg: acnBankDeg } = attitude;

    const bodyLos = worldLosToBodyFrame(dx, dy, dz, {
      headingDeg: acnHeadingDeg,
      pitchDeg: acnPitchDeg,
      rollDeg: acnBankDeg,
    });
    const bodyAzimuthDeg = bodyLos.bodyAzimuthDeg;
    const elevationAngleDeg = bodyLos.bodyElevationDeg;

    // Evaluate 4-sector antenna roll-off to find best active sector
    let minAttenDb = Number.POSITIVE_INFINITY;
    let activeSectorId = 0;
    for (let s = 0; s < 4; s++) {
      const boresightDeg = s * 90;
      const offBoresightAzDeg = QuadSectorAntennaEngine.wrapSignedDeg(bodyAzimuthDeg - boresightDeg);
      const attenDb = this.antennaEngine.computeSectorAttenuationDb(offBoresightAzDeg, elevationAngleDeg);
      if (attenDb < minAttenDb) {
        minAttenDb = attenDb;
        activeSectorId = s;
      }
    }
    const rxGainDbi = rf.acnAntennaGainDbi - minAttenDb;

    // 3. Propagation losses
    const freezingIsothermM = THEATER_BIOMES[terrain.activeBiomeId]?.freezingIsothermM ?? 4800.0;
    const fsplDb = LinkBudgetEngine.computeFsplDb(slantDistM, rf.carrierFrequencyHz, rf.speedOfLight);
    const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(slantDistM, cellZ, acnPos[2], rf.carrierFrequencyHz);
    const rainLossDb = LinkBudgetEngine.computeRainAttenuationDb(slantDistM, env, cellZ, acnPos[2], freezingIsothermM);
    const totalLossDb =
      fsplDb +
      diffLossDb +
      gasLossDb +
      rainLossDb +
      rf.cableLossDb +
      rf.implementationMarginDb;

    // Canonical soldier transmitter parameters from RFConfig (36.0 dBm, 3.0 dBi)
    const { txPowerDbm, antennaGainDbi: txGainDbi } = rf.getTransmitterParams('soldier');
    const prxDbm = txPowerDbm + txGainDbi + rxGainDbi - totalLossDb;

    // Thermal noise & sky temperature coupling
    const { pNoiseDbm: pNoiseThermalDbm } = LinkBudgetEngine.computeThermalNoiseFloorDbm(
      rf.channelBandwidthHz,
      rf.acnNoiseFigureDb,
      env.atmosphericTemperatureK,
      rf.boltzmannConstant
    );
    const aAtm = gasLossDb + rainLossDb;
    const Tm = 275.0;
    const skyTemperatureK = Tm * (1.0 - Math.pow(10.0, -aAtm / 10.0));
    const noiseFactor = Math.pow(10.0, rf.acnNoiseFigureDb / 10.0);
    const skyNoiseIncreaseDb = 10.0 * Math.log10(1.0 + skyTemperatureK / (290.0 * noiseFactor));
    const pNoiseDbm = pNoiseThermalDbm + skyNoiseIncreaseDb;

    // Contested EW Jammer interference coupling into active sector
    let pNoiseAndInterferenceDbm = pNoiseDbm;
    if (env.jammerEnabled && jammerInterferenceBySector !== undefined) {
      const jammerInterferenceDbm = jammerInterferenceBySector[activeSectorId];
      if (Number.isFinite(jammerInterferenceDbm)) {
        const pNoiseMw = Math.pow(10.0, pNoiseDbm / 10.0);
        const pJammerMw = Math.pow(10.0, jammerInterferenceDbm / 10.0);
        pNoiseAndInterferenceDbm = 10.0 * Math.log10(pNoiseMw + pJammerMw);
      }
    }

    return prxDbm - pNoiseAndInterferenceDbm;
  }

  /**
   * Computes an entire radial azimuth ray (all 16 range bins) in a single pass.
   */
  public computeAzimuthRay(
    azimuthIndex: number,
    acnPos: Position3D,
    acnVel: Position3D,
    terrain: TerrainEngine,
    rf: RFConfig,
    env: EnvironmentConfig,
    attitudeOverride?: AcnAttitudeState,
    jammerInterferenceBySector?: readonly [number, number, number, number],
    fidelityMode: 'fast' | 'link-budget-parity' = 'fast'
  ): void {
    const bearingDeg = (azimuthIndex * 10) % 360;
    const baseOffset = azimuthIndex * NUM_RANGES;

    for (let j = 0; j < NUM_RANGES; j++) {
      const rangeM = (j + 1) * R_STEP_M;
      const sinrDb = this.computeCellSinr(
        bearingDeg,
        rangeM,
        acnPos,
        acnVel,
        terrain,
        rf,
        env,
        attitudeOverride,
        jammerInterferenceBySector,
        fidelityMode
      );
      this.sinrGridDb[baseOffset + j] = sinrDb;
    }
  }

  private tryComputeWasmSweep(
    acnPos: Position3D,
    acnVel: Position3D,
    terrain: TerrainEngine,
    rf: RFConfig,
    env: EnvironmentConfig,
    attitudeOverride?: AcnAttitudeState,
    jammerInterferenceBySector?: readonly [number, number, number, number],
    fidelityMode: 'fast' | 'link-budget-parity' = 'fast'
  ): Float32Array | null {
    if (
      !isWasmPhysicsReady() ||
      fidelityMode !== 'fast' ||
      terrain.terrainMode !== 'real' ||
      !terrain.hasRealDem ||
      !terrain.realDemGrid ||
      terrain.obstacleField.all.length > 0 ||
      Boolean((terrain as unknown as { customElevationFn?: unknown }).customElevationFn) ||
      (env.demLookaheadErrorStdM ?? 0) > 0
    ) {
      return null;
    }

    const bounds = terrain.getTerrainBoundsTelemetry();
    const attitude = attitudeOverride ?? this.antennaEngine.computeAcnAttitude(acnVel);
    const { txPowerDbm: soldierTxPowerDbm, antennaGainDbi: soldierAntennaGainDbi } =
      rf.getTransmitterParams('soldier');
    const freezingIsothermM = THEATER_BIOMES[terrain.activeBiomeId]?.freezingIsothermM ?? 4800.0;

    return wasmComputePolarViewshed(
      terrain.realDemGrid,
      bounds.rasterWidth,
      bounds.rasterHeight,
      bounds.minX,
      bounds.maxX,
      bounds.minY,
      bounds.maxY,
      {
        numBearings: NUM_AZIMUTHS,
        numRanges: NUM_RANGES,
        rMinM: R_MIN_M,
        rStepM: R_STEP_M,
        acnPos,
        headingDeg: attitude.headingDeg,
        pitchDeg: attitude.pitchDeg,
        bankDeg: attitude.bankDeg,
        carrierFreqHz: rf.carrierFrequencyHz,
        speedOfLight: rf.speedOfLight,
        channelBandwidthHz: rf.channelBandwidthHz,
        acnAntennaGainDbi: rf.acnAntennaGainDbi,
        acnNoiseFigureDb: rf.acnNoiseFigureDb,
        soldierTxPowerDbm,
        soldierAntennaGainDbi,
        cableLossDb: rf.cableLossDb,
        implementationMarginDb: rf.implementationMarginDb,
        boltzmannConstant: rf.boltzmannConstant,
        hpbwAzDeg: rf.acnSectorHpbwAzDeg ?? 90.0,
        hpbwElDeg: rf.acnSectorHpbwElDeg ?? 65.0,
        downtiltDeg: rf.acnSectorDowntiltDeg ?? -15.0,
        rEffM: env.effectiveEarthRadiusM,
        atmosphericTempK: env.atmosphericTemperatureK,
        rainRateMmH: env.rainRateMmH ?? 0.0,
        rainCellLengthKm: env.rainCellLengthKm ?? 10.0,
        freezingIsothermM,
        jammerEnabled: Boolean(env.jammerEnabled),
        jammerBySector: jammerInterferenceBySector,
      }
    );
  }

  /**
   * Amortized discrete-event viewshed sweep. Updates `sliceCount` (e.g. 6) azimuth rays per 20 ms tick,
   * completing a full 360° sweep (36 rays) every 6 ticks (120 ms) with zero garbage collection allocations.
   */
  public updateSlice(
    acnPos: Position3D,
    acnVel: Position3D,
    terrain: TerrainEngine,
    rf: RFConfig,
    env: EnvironmentConfig,
    sliceCount: number = 6,
    attitudeOverride?: AcnAttitudeState,
    jammerInterferenceBySector?: readonly [number, number, number, number],
    fidelityMode: 'fast' | 'link-budget-parity' = 'fast'
  ): void {
    const startAz = this.nextAzimuthSliceIndex;
    const wasmOut = this.tryComputeWasmSweep(
      acnPos,
      acnVel,
      terrain,
      rf,
      env,
      attitudeOverride,
      jammerInterferenceBySector,
      fidelityMode
    );
    if (wasmOut && wasmOut.length >= TOTAL_VIEWSHED_CELLS) {
      for (let k = 0; k < sliceCount; k++) {
        const azIdx = (startAz + k) % NUM_AZIMUTHS;
        const base = azIdx * NUM_RANGES;
        this.sinrGridDb.set(wasmOut.subarray(base, base + NUM_RANGES), base);
      }
      this.nextAzimuthSliceIndex = (startAz + sliceCount) % NUM_AZIMUTHS;
      return;
    }

    for (let k = 0; k < sliceCount; k++) {
      const azIdx = (startAz + k) % NUM_AZIMUTHS;
      this.computeAzimuthRay(
        azIdx,
        acnPos,
        acnVel,
        terrain,
        rf,
        env,
        attitudeOverride,
        jammerInterferenceBySector,
        fidelityMode
      );
    }
    this.nextAzimuthSliceIndex = (startAz + sliceCount) % NUM_AZIMUTHS;
  }

  /**
   * Synchronous evaluation of all 36 azimuth rays (576 cells). Useful for scenario initialization
   * or verification testing.
   */
  public computeFullViewshed(
    acnPos: Position3D,
    acnVel: Position3D,
    terrain: TerrainEngine,
    rf: RFConfig,
    env: EnvironmentConfig,
    attitudeOverride?: AcnAttitudeState,
    jammerInterferenceBySector?: readonly [number, number, number, number],
    fidelityMode: 'fast' | 'link-budget-parity' = 'fast'
  ): Float32Array {
    const wasmOut = this.tryComputeWasmSweep(
      acnPos,
      acnVel,
      terrain,
      rf,
      env,
      attitudeOverride,
      jammerInterferenceBySector,
      fidelityMode
    );
    if (wasmOut && wasmOut.length >= TOTAL_VIEWSHED_CELLS) {
      this.sinrGridDb.set(wasmOut.subarray(0, TOTAL_VIEWSHED_CELLS));
      return this.sinrGridDb;
    }

    for (let a = 0; a < NUM_AZIMUTHS; a++) {
      this.computeAzimuthRay(
        a,
        acnPos,
        acnVel,
        terrain,
        rf,
        env,
        attitudeOverride,
        jammerInterferenceBySector,
        fidelityMode
      );
    }
    return this.sinrGridDb;
  }

  /**
   * 360° Orbit-Integrated Availability & Optimal Ridgeline Relay Placement Advisor.
   *
   * Samples high-prominence ridgeline points around the tactical theater (24 azimuths x 8 radii within [2 km, 14 km])
   * and scores each candidate relay point by:
   * 1. 360° ACN Orbit Visibility %: fraction of 12 equidistant orbital phases where candidate has unobstructed LoS (SINR >= 10 dB).
   * 2. Ground Squad Line-of-Sight Coverage %: fraction of active ground terminals with LoS or closing diffraction (SINR >= 4 dB).
   *
   * Returns an authoritative RelayAdvisorReport with optimal ridgeline coordinate and coverage metrics.
   */
  private static resolveFallbackTerrainElevationM(terrain: TerrainEngine): number {
    const bounds = typeof terrain.getTerrainBoundsTelemetry === 'function'
      ? terrain.getTerrainBoundsTelemetry()
      : null;

    let sumElev = 0.0;
    let count = 0;

    if (
      bounds &&
      Number.isFinite(bounds.minX) &&
      Number.isFinite(bounds.maxX) &&
      Number.isFinite(bounds.minY) &&
      Number.isFinite(bounds.maxY)
    ) {
      const spanX = bounds.maxX - bounds.minX;
      const spanY = bounds.maxY - bounds.minY;
      // For large synthetic theaters (e.g. +/- 600 km), sample within the active +/- 20 km tactical window
      const halfSampleX = Math.min(Math.abs(spanX) * 0.4, 20000.0);
      const halfSampleY = Math.min(Math.abs(spanY) * 0.4, 20000.0);
      const cx = 0.5 * (bounds.minX + bounds.maxX);
      const cy = 0.5 * (bounds.minY + bounds.maxY);
      const offsets = [-1, 0, 1];
      for (const ox of offsets) {
        for (const oy of offsets) {
          const z = terrain.getElevation(cx + ox * halfSampleX, cy + oy * halfSampleY);
          if (Number.isFinite(z)) {
            sumElev += z;
            count++;
          }
        }
      }
    }

    if (count === 0) {
      const centerZ = terrain.getElevation(0.0, 0.0);
      if (Number.isFinite(centerZ)) {
        return centerZ;
      }
      const metaMin = terrain.hasRealDem ? terrain.demMetadata?.minElevationM : undefined;
      if (metaMin !== undefined && Number.isFinite(metaMin)) {
        return metaMin;
      }
      return 3500.0;
    }

    return sumElev / count;
  }

  public computeOptimalRelayPlacement(
    trajectoryEngine: ACNTrajectory,
    terrain: TerrainEngine,
    groundNodes: readonly { position: readonly [number, number] | Position3D; nodeId: number }[],
    rf: RFConfig,
    env: EnvironmentConfig,
    orbitPhasesCount: number = 12
  ): RelayAdvisorReport {
    const fallbackTerrainElev = PolarViewshedEngine.resolveFallbackTerrainElevationM(terrain);

    // 1. Calculate ground node mean elevation & center
    let meanGroundElev = 0.0;
    let validNodeCount = 0;
    for (const node of groundNodes) {
      const pos = node.position;
      const posZ = pos.length >= 3 ? pos[2] : undefined;
      const sampledElev = terrain.getElevation(pos[0], pos[1]);
      const elev = posZ !== undefined && Number.isFinite(posZ)
        ? posZ
        : (Number.isFinite(sampledElev) ? sampledElev : fallbackTerrainElev);
      meanGroundElev += elev;
      validNodeCount++;
    }
    meanGroundElev = validNodeCount > 0 ? meanGroundElev / validNodeCount : fallbackTerrainElev;

    // 2. Pre-sample 12 equidistant ACN orbital phases
    let orbitPeriodS =
      (trajectoryEngine as { orbitPeriodS?: number }).orbitPeriodS ??
      (trajectoryEngine.totalLengthM > 0 && trajectoryEngine.targetSpeedMps > 0
        ? trajectoryEngine.totalLengthM / trajectoryEngine.targetSpeedMps
        : 300.0);
    if (!Number.isFinite(orbitPeriodS) || orbitPeriodS <= 0.0) {
      orbitPeriodS = 300.0;
    }
    const orbitalAcnPositions: Position3D[] = [];
    const orbitalAcnVelocities: Position3D[] = [];
    for (let m = 0; m < orbitPhasesCount; m++) {
      const phaseTimeS = (m * orbitPeriodS) / orbitPhasesCount;
      orbitalAcnPositions.push(trajectoryEngine.getAcnPosition(phaseTimeS));
      orbitalAcnVelocities.push(trajectoryEngine.getAcnVelocity(phaseTimeS));
    }

    // 3. Candidate sampling grid: 24 azimuths x 8 radial steps between 2 km and 14 km from center
    const CAND_AZIMUTHS = 24; // 15° steps
    const CAND_RADII = 8;
    const R_START_M = 2000.0;
    const R_END_M = 14000.0;
    const rStep = (R_END_M - R_START_M) / (CAND_RADII - 1);

    // Precompute real thermal noise floor from RFConfig (bandwidth + NF + temperature)
    const thermalNoise = LinkBudgetEngine.computeThermalNoiseFloorDbm(
      rf.channelBandwidthHz,
      rf.acnNoiseFigureDb,
      env.atmosphericTemperatureK,
      rf.boltzmannConstant
    );
    const baseNoiseW = thermalNoise.pNoiseW;
    const baseNoiseDbm = thermalNoise.pNoiseDbm;
    const freezingIsothermM = THEATER_BIOMES[terrain.activeBiomeId]?.freezingIsothermM ?? 4800.0;
    const { txPowerDbm: soldierTxPowerDbm, antennaGainDbi: soldierAntennaGainDbi } =
      rf.getTransmitterParams('soldier');

    let bestScore = -Infinity;
    let bestCandPos: Position3D = [0, 0, meanGroundElev + 500];
    let bestOrbitAvail = 0.0;
    let bestGroundCov = 0.0;
    let bestMeanSinr = 0.0;

    for (let a = 0; a < CAND_AZIMUTHS; a++) {
      const azRad = (a * 15.0 * Math.PI) / 180.0;
      const sinA = Math.sin(azRad);
      const cosA = Math.cos(azRad);

      for (let r = 0; r < CAND_RADII; r++) {
        const radM = R_START_M + r * rStep;
        const candX = radM * sinA;
        const candY = radM * cosA;
        const candElev = terrain.getElevation(candX, candY);
        if (!Number.isFinite(candElev)) continue;

        // Mounted on 3 m mast on ridge
        const candZ = candElev + 3.0;
        const candPos: Position3D = [candX, candY, candZ];

        // Criterion 1: ACN Orbit Visibility across the 12 phases
        let visiblePhasesCount = 0;
        let sumSinrToAcn = 0.0;
        for (let m = 0; m < orbitPhasesCount; m++) {
          const acnPos = orbitalAcnPositions[m];
          const acnVel = orbitalAcnVelocities[m];
          const dx = candX - acnPos[0];
          const dy = candY - acnPos[1];
          const dz = candZ - acnPos[2];
          const dM = Math.max(Math.hypot(dx, dy, dz), 1.0);

          const obs = terrain.evaluateTerrainObstruction(candPos, acnPos, rf, env, 200.0);
          const diffLossDb = obs.obstacleBlocked
            ? 35.0
            : (Number.isFinite(obs.diffractionLossDb) ? obs.diffractionLossDb! : (obs.isLos ? 0.0 : 45.0));

          // Slant link budget to ACN (FSPL + diffraction + gas + rain + losses)
          const fsplDb = LinkBudgetEngine.computeFsplDb(dM, rf.carrierFrequencyHz, rf.speedOfLight);
          const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(dM, candZ, acnPos[2], rf.carrierFrequencyHz);
          const rainLossDb = LinkBudgetEngine.computeRainAttenuationDb(dM, env, candZ, acnPos[2], freezingIsothermM);
          const totalLossDb = fsplDb + diffLossDb + gasLossDb + rainLossDb + rf.cableLossDb + rf.implementationMarginDb;

          // Quad-sector body-frame elevation & azimuth roll-off aligned with QuadSectorAntennaEngine (90 deg az x 65 deg el, 16 dBi peak)
          const horizD = Math.max(Math.hypot(dx, dy), 1.0);
          const elevDeg = (Math.atan2(dz, horizD) * 180.0) / Math.PI; // negative below ACN
          const acnHeadingRad = Math.atan2(acnVel[0], acnVel[1]);
          const targetAzRad = Math.atan2(dx, dy);
          let bodyAzDeg = (((targetAzRad - acnHeadingRad) * 180.0) / Math.PI) % 360.0;
          if (bodyAzDeg < 0) bodyAzDeg += 360.0;
          const nearestSectorCenter = (Math.round(bodyAzDeg / 90.0) * 90.0) % 360.0;
          const offAzDeg = QuadSectorAntennaEngine.wrapSignedDeg(bodyAzDeg - nearestSectorCenter);
          const downtiltDeg = rf.acnSectorDowntiltDeg ?? -15.0;
          const hpbwAzDeg = rf.acnSectorHpbwAzDeg ?? 90.0;
          const hpbwElDeg = rf.acnSectorHpbwElDeg ?? 65.0;
          const maxAttenDb = 25.0;
          const azLossDb = Math.min(12.0 * Math.pow(offAzDeg / hpbwAzDeg, 2), maxAttenDb);
          const elLossDb = Math.min(12.0 * Math.pow((elevDeg - downtiltDeg) / hpbwElDeg, 2), maxAttenDb);
          const patternRolloffDb = Math.min(azLossDb + elLossDb, maxAttenDb);
          const effAcnGainDbi = rf.acnAntennaGainDbi - patternRolloffDb;

          // Sky noise temperature increase from atmospheric + rain attenuation
          const atmoLossDb = gasLossDb + rainLossDb;
          const tSkyK = 275.0 * (1.0 - Math.pow(10.0, -atmoLossDb / 10.0));
          const noiseFactor = Math.pow(10.0, rf.acnNoiseFigureDb / 10.0);
          const effNoiseTempK = env.atmosphericTemperatureK * noiseFactor + tSkyK;
          let totalInterfNoiseW = rf.boltzmannConstant * effNoiseTempK * rf.channelBandwidthHz;

          // Optional EW jammer ingress at ACN
          if (env.jammerEnabled && env.jammerPosEnu) {
            const jPos = env.jammerPosEnu;
            const dJamM = Math.max(Math.hypot(acnPos[0] - jPos[0], acnPos[1] - jPos[1], acnPos[2] - jPos[2]), 1.0);
            const jObs = terrain.evaluateTerrainObstruction(jPos, acnPos, rf, env, 300.0);
            const jDiffDb = jObs.obstacleBlocked ? 35.0 : (Number.isFinite(jObs.diffractionLossDb) ? jObs.diffractionLossDb! : 0.0);
            const jFsplDb = LinkBudgetEngine.computeFsplDb(dJamM, rf.carrierFrequencyHz, rf.speedOfLight);
            const jRxDbm = (env.jammerEirpDbm ?? 50.0) + rf.acnAntennaGainDbi - 6.0 - (jFsplDb + jDiffDb);
            totalInterfNoiseW += Math.pow(10.0, (jRxDbm - 30.0) / 10.0);
          }

          const pNoisePlusInterfDbm = 10.0 * Math.log10(Math.max(totalInterfNoiseW, 1e-22) * 1000.0);

          // Relay transmitter: 30 dBm, 5 dBi directional antenna, ACN directional sector gain
          const pRxDbm = 30.0 + 5.0 + effAcnGainDbi - totalLossDb;
          const sinrDb = pRxDbm - pNoisePlusInterfDbm;

          sumSinrToAcn += sinrDb;
          if (sinrDb >= 10.0) {
            visiblePhasesCount++;
          }
        }
        const orbitAvailPct = (visiblePhasesCount / orbitPhasesCount) * 100.0;
        const meanSinrDb = sumSinrToAcn / orbitPhasesCount;

        // Criterion 2: Ground squad coverage
        let coveredGroundCount = 0;
        for (const gNode of groundNodes) {
          const gnPos = gNode.position;
          const gnElev = terrain.getElevation(gnPos[0], gnPos[1]);
          const terrainSurfaceZ = (Number.isFinite(gnElev) ? gnElev : fallbackTerrainElev) + 2.0;
          const gnPosZ = gnPos.length >= 3 ? gnPos[2] : undefined;
          const gnZ = gnPosZ !== undefined && Number.isFinite(gnPosZ)
            ? Math.max(gnPosZ, terrainSurfaceZ)
            : terrainSurfaceZ;
          const gNodePos: Position3D = [gnPos[0], gnPos[1], gnZ];

          const dGroundM = Math.max(Math.hypot(candX - gnPos[0], candY - gnPos[1], candZ - gnZ), 1.0);
          const obsNode = terrain.evaluateTerrainObstruction(gNodePos, candPos, rf, env, 200.0);
          const diffLossDb = obsNode.obstacleBlocked
            ? 35.0
            : (Number.isFinite(obsNode.diffractionLossDb) ? obsNode.diffractionLossDb! : (obsNode.isLos ? 0.0 : 45.0));

          const fsplDb = LinkBudgetEngine.computeFsplDb(dGroundM, rf.carrierFrequencyHz, rf.speedOfLight);
          const gGasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(dGroundM, gnZ, candZ, rf.carrierFrequencyHz);
          const gRainLossDb = LinkBudgetEngine.computeRainAttenuationDb(dGroundM, env, gnZ, candZ, freezingIsothermM);
          const gAtmoLossDb = gGasLossDb + gRainLossDb;
          const gSkyK = 275.0 * (1.0 - Math.pow(10.0, -gAtmoLossDb / 10.0));
          const gNoiseW = baseNoiseW + rf.boltzmannConstant * gSkyK * rf.channelBandwidthHz;
          const gNoiseDbm = 10.0 * Math.log10(Math.max(gNoiseW, 1e-22) * 1000.0);

          const pRxGroundDbm =
            soldierTxPowerDbm +
            soldierAntennaGainDbi +
            5.0 -
            (fsplDb + diffLossDb + gAtmoLossDb + rf.cableLossDb + rf.implementationMarginDb);
          const groundSinrDb = pRxGroundDbm - (Number.isFinite(gNoiseDbm) ? gNoiseDbm : baseNoiseDbm);

          if (groundSinrDb >= 4.0 || obsNode.isLos) {
            coveredGroundCount++;
          }
        }
        const groundCovPct = groundNodes.length > 0 ? (coveredGroundCount / groundNodes.length) * 100.0 : 100.0;

        // Composite Prominence Score
        // High orbit availability (>= 80%) is primary objective; elevation above mean valley awards prominence.
        const elevationBonus = Math.max(0.0, candElev - meanGroundElev);
        const prominenceFactor = candElev > meanGroundElev + 150.0 ? 1.5 + (candElev - meanGroundElev) / 1000.0 : 0.3;
        const score = (
          (orbitAvailPct >= 80.0 ? 600.0 : 0.0) +
          orbitAvailPct * 4.0 +
          groundCovPct * 3.0 +
          (elevationBonus / 20.0) +
          meanSinrDb * 0.5
        ) * prominenceFactor;

        if (score > bestScore) {
          bestScore = score;
          bestCandPos = candPos;
          bestOrbitAvail = orbitAvailPct;
          bestGroundCov = groundCovPct;
          bestMeanSinr = meanSinrDb;
        }
      }
    }

    const geo = terrain.worldToLatLon(bestCandPos[0], bestCandPos[1]);
    return {
      optimalPosEnu: bestCandPos,
      optimalLatDeg: Number(geo.latDeg.toFixed(5)),
      optimalLonDeg: Number(geo.lonDeg.toFixed(5)),
      elevationMslM: Math.round(bestCandPos[2]),
      orbitAvailabilityPct: Number(bestOrbitAvail.toFixed(1)),
      groundNodeCoveragePct: Number(bestGroundCov.toFixed(1)),
      meanSinrToAcnDb: Number(bestMeanSinr.toFixed(1)),
    };
  }
}
