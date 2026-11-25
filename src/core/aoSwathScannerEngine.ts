/**
 * src/core/aoSwathScannerEngine.ts
 *
 * CAD/QGIS-Grade Precision Area-of-Operations (AO) Swath, Dead-Zone Matrix Scanner
 * & Tactical Squad Auto-Deployer Engine (Tool #3).
 *
 * Implements:
 * 1. Live East-West width, North-South height, diagonal span, diagonal bearing, and enclosed area.
 * 2. Shift-key 1:1 aspect ratio square constraint (constrainSquareRegion).
 * 3. 8x8 (64-cell) zonal RF lattice evaluating knife-edge diffraction, quad-sector ACN antenna coupling,
 *    FSPL, and received SINR against the airborne ACN.
 * 4. Micro-topography analysis: slope gradient, TRI, and elevation distribution.
 * 5. Extreme topographical and RF pinfinders: Summit Peak, Valley Floor, and Worst Dead-Zone.
 * 6. Tactical 4-quadrant ground squad dispersion coordinate generator.
 *
 * Specification: docs/specs/SPEC-PRECISION-AO-SWATH-AND-DEADZONE-SCANNER-TOOL3.md
 */

import type { Position3D } from '../shared/types';
import { EnvironmentConfig, RFConfig, SPEED_OF_LIGHT } from './config';
import { LinkBudgetEngine } from './linkBudget';
import { ACN_SECTOR_LABELS } from './antennaArray';
import {
  SPEED_OF_LIGHT_M_S,
  DEFAULT_X_BAND_FREQ_HZ,
  DEFAULT_X_BAND_WAVELENGTH_M,
  DEFAULT_K_FACTOR,
  DEFAULT_TRUE_EARTH_RADIUS_M,
  DEFAULT_R_EFF_M,
  computeEarthBulgeM,
  computeKnifeEdgeDiffractionLossDb,
  computeBearingDeg,
  computeSlantAndHorizDistance,
} from './rfPropagationMath';

export const DEFAULT_EARTH_RADIUS_M = DEFAULT_TRUE_EARTH_RADIUS_M;
export {
  SPEED_OF_LIGHT_M_S,
  DEFAULT_X_BAND_FREQ_HZ,
  DEFAULT_X_BAND_WAVELENGTH_M,
  DEFAULT_K_FACTOR,
  DEFAULT_R_EFF_M,
};

const DEFAULT_AO_RF_CONFIG = new RFConfig();
const DEFAULT_AO_ENV_CONFIG = new EnvironmentConfig();
const AO_LINK_ENGINE = new LinkBudgetEngine();

// Canonical Tactical Uplink Constants from RFConfig (8.0 GHz Soldier-to-ACN)
export const AO_LINK_BUDGET = {
  txPowerDbm: DEFAULT_AO_RF_CONFIG.soldierTxPowerDbm, // 36.0 dBm (4 W manpack PA)
  txGainDbi: DEFAULT_AO_RF_CONFIG.soldierAntennaGainDbi, // 3.0 dBi ground terminal whip
  rxGainDbi: DEFAULT_AO_RF_CONFIG.acnAntennaGainDbi, // 16.0 dBi ACN quad-sector array
  cableAndMarginDb:
    DEFAULT_AO_RF_CONFIG.cableLossDb + DEFAULT_AO_RF_CONFIG.implementationMarginDb, // 4.0 dB
  noisePowerDbm: LinkBudgetEngine.computeThermalNoiseFloorDbm(
    DEFAULT_AO_RF_CONFIG.channelBandwidthHz,
    DEFAULT_AO_RF_CONFIG.acnNoiseFigureDb
  ).pNoiseDbm, // ~ -108.975 dBm (1 MHz, 5 dB NF, 290 K)
  gasLossBaselineDb: 0.0, // Altitude-integrated ITU-R P.676 computed dynamically in LinkBudgetEngine
  specificGasLossDbPerKm: 0.012, // Sea-level reference specific attenuation (dB/km)
  maxRollOffDb: 25.0, // Maximum antenna off-boresight attenuation
  hpbwAzDeg: DEFAULT_AO_RF_CONFIG.acnSectorHpbwAzDeg, // 90.0 deg sector half-power beamwidth
  channelBandwidthHz: DEFAULT_AO_RF_CONFIG.channelBandwidthHz, // 1.0 MHz shared channel
};

export type AoZoneClass = 'HIGH_RATE_LOS' | 'MARGINAL_DIFFRACTED' | 'DEAD_ZONE_OUTAGE';

export interface AoSwathCell {
  readonly col: number;
  readonly row: number;
  readonly xM: number;
  readonly yM: number;
  readonly zMslM: number;
  readonly slopeDeg: number;
  readonly triM: number;
  readonly isLineOfSight: boolean;
  readonly isLos: boolean;
  readonly sinrDb: number;
  readonly diffLossDb: number;
  readonly modcodName: string;
  readonly zoneClass: AoZoneClass;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface AoSwathExtremePoint {
  readonly xM: number;
  readonly yM: number;
  readonly zMslM: number;
  readonly sinrDb: number;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}

export interface AoSwathAnalysisReport {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly widthKm: number;
  readonly heightKm: number;
  readonly areaKm2: number;
  readonly diagonalKm: number;
  readonly diagonalAzimuthDeg: number;
  readonly cells: readonly AoSwathCell[];
  readonly summitPeak: AoSwathExtremePoint;
  readonly valleyFloor: AoSwathExtremePoint;
  readonly worstDeadZone: AoSwathExtremePoint;
  readonly squadDeployCoords: readonly [Position3D, Position3D, Position3D, Position3D];
  readonly losCoveragePct: number;
  readonly marginalPct: number;
  readonly deadZonePct: number;
  readonly meanSinrDb: number;
  readonly minSinrDb: number;
  readonly maxSinrDb: number;
  readonly meanElevM: number;
  readonly stdElevM: number;
  readonly reliefM: number;
  readonly meanSlopeDeg: number;
  readonly triM: number;
}

/**
 * Computes knife-edge diffraction loss in dB per ITU-R P.526 from Fresnel-Kirchhoff parameter nu.
 */
export function computeP526DiffractionDb(nu: number): number {
  return computeKnifeEdgeDiffractionLossDb(nu);
}

/**
 * Constrains rectangular region corners to a 1:1 aspect ratio square when Shift is held.
 * L = max(|x2 - x1|, |y2 - y1|)
 * returns [x1 + sign(x2 - x1) * L, y1 + sign(y2 - y1) * L]
 */
export function constrainSquareRegion(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): [number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const signX = dx < 0 ? -1 : 1;
  const signY = dy < 0 ? -1 : 1;
  const L = Math.max(Math.abs(dx), Math.abs(dy));
  return [x1 + signX * L, y1 + signY * L];
}

/**
 * Evaluates a CAD/QGIS-grade precision Area-of-Operations (AO) Swath,
 * scanning an 8x8 (64-cell) grid for micro-topography, knife-edge diffraction,
 * ACN quad-sector antenna coupling, and net SINR dead-zone outage distribution.
 */
export function evaluateAoSwathAnalysis(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  acnPosEnu: { x?: number; y?: number; z?: number; xM?: number; yM?: number; zM?: number } | [number, number, number] | readonly [number, number, number],
  acnHeadingDeg: number,
  getElevationAt: (x: number, y: number) => number,
  gridResolution: number = 8,
  rfConfig?: RFConfig,
  envConfig?: EnvironmentConfig
): AoSwathAnalysisReport {
  const effRf = rfConfig ?? DEFAULT_AO_RF_CONFIG;
  const effEnv = envConfig ?? DEFAULT_AO_ENV_CONFIG;
  // 1. Swath Bounding Box & Dimensions
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  const spanXM = Math.max(1.0, maxX - minX);
  const spanYM = Math.max(1.0, maxY - minY);
  const widthKm = (maxX - minX) / 1000.0;
  const heightKm = (maxY - minY) / 1000.0;
  const areaKm2 = widthKm * heightKm;
  const diagonalKm = Math.hypot(widthKm, heightKm);
  const diagonalAzimuthDeg = computeBearingDeg(x2 - x1, y2 - y1);

  // 2. Resolve ACN Position
  let xAcn = 0.0;
  let yAcn = 0.0;
  let zAcn = 5000.0;
  if (Array.isArray(acnPosEnu)) {
    xAcn = acnPosEnu[0];
    yAcn = acnPosEnu[1];
    zAcn = acnPosEnu[2];
  } else {
    const obj = acnPosEnu as { x?: number; y?: number; z?: number; xM?: number; yM?: number; zM?: number };
    xAcn = obj.xM ?? obj.x ?? 0.0;
    yAcn = obj.yM ?? obj.y ?? 0.0;
    zAcn = obj.zM ?? obj.z ?? 5000.0;
  }

  // 3. Evaluate Grid of Cells
  const N = Math.max(2, Math.round(gridResolution));
  const cellDx = spanXM / N;
  const cellDy = spanYM / N;

  interface IntermediateCell {
    col: number;
    row: number;
    xM: number;
    yM: number;
    zMslM: number;
    slopeDeg: number;
    isLineOfSight: boolean;
    sinrDb: number;
    diffLossDb: number;
    modcodName: string;
    zoneClass: AoZoneClass;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }

  const rawCells: IntermediateCell[] = [];
  let sumElev = 0.0;
  let sumSlope = 0.0;
  let sumSinr = 0.0;
  let minSinr = Infinity;
  let maxSinr = -Infinity;

  let maxElevSample: IntermediateCell | null = null;
  let minElevSample: IntermediateCell | null = null;
  let worstSinrSample: IntermediateCell | null = null;

  const NUM_RAY_STEPS = 16;
  const slopeDelta = Math.min(50.0, Math.max(1.0, Math.min(cellDx, cellDy) * 0.25));

  for (let r = 0; r < N; r++) {
    const cMinY = minY + r * cellDy;
    const cMaxY = cMinY + cellDy;
    const yc = (cMinY + cMaxY) * 0.5;

    for (let c = 0; c < N; c++) {
      const cMinX = minX + c * cellDx;
      const cMaxX = cMinX + cellDx;
      const xc = (cMinX + cMaxX) * 0.5;

      const zc = getElevationAt(xc, yc);
      sumElev += zc;

      // Local slope via central difference
      const dzX = getElevationAt(xc + slopeDelta, yc) - getElevationAt(xc - slopeDelta, yc);
      const dzY = getElevationAt(xc, yc + slopeDelta) - getElevationAt(xc, yc - slopeDelta);
      const grad = Math.hypot(dzX, dzY) / (2.0 * slopeDelta);
      const slopeDeg = (Math.atan(grad) * 180.0) / Math.PI;
      sumSlope += slopeDeg;

      // Antenna phase center at 2.0 m AGL
      const zAnt = zc + 2.0;
      const dx = xAcn - xc;
      const dy = yAcn - yc;
      const dz = zAcn - zAnt;
      const { horizDistM: dHorizM, slantDistM: d3dM } = computeSlantAndHorizDistance(dx, dy, dz);

      // 16-Step Curved Earth Ray-Marching
      let maxNu = -999.0;
      let isRayBlocked = false;

      for (let step = 1; step <= NUM_RAY_STEPS; step++) {
        const u = step / NUM_RAY_STEPS;
        const sM = u * dHorizM;
        const sx = xc + u * dx;
        const sy = yc + u * dy;
        const zDem = getElevationAt(sx, sy);

        // Curvature bulge along chord
        const chordBulgeM = computeEarthBulgeM(sM, dHorizM - sM, DEFAULT_K_FACTOR, DEFAULT_EARTH_RADIUS_M);
        const effTerrainZ = zDem + chordBulgeM;
        const rayZ = zAnt + u * dz;

        if (effTerrainZ >= rayZ) {
          isRayBlocked = true;
        }

        const intrusionM = effTerrainZ - rayZ;
        const d1 = Math.max(1.0, sM);
        const d2 = Math.max(1.0, dHorizM - sM);
        const nu = intrusionM * Math.sqrt((2.0 / DEFAULT_X_BAND_WAVELENGTH_M) * (1.0 / d1 + 1.0 / d2));
        if (nu > maxNu) {
          maxNu = nu;
        }
      }

      const diffLossDb = Math.max(
        0.0,
        isRayBlocked
          ? computeP526DiffractionDb(maxNu)
          : (maxNu > -0.78 ? computeP526DiffractionDb(maxNu) : 0.0)
      );
      const isLineOfSight = !isRayBlocked;

      // Quad-Sector ACN Identification & Roll-Off Loss
      const azFromAcnDeg = computeBearingDeg(-dx, -dy);
      const bodyAzDeg = ((azFromAcnDeg - acnHeadingDeg) % 360.0 + 360.0) % 360.0;
      const sectorIdx = Math.round(bodyAzDeg / 90.0) % 4;
      const activeSectorId = (sectorIdx < 0 ? sectorIdx + 4 : sectorIdx) as 0 | 1 | 2 | 3;
      const sectorBoresightDeg = activeSectorId * 90.0;
      let offBoresightDeg = Math.abs(bodyAzDeg - sectorBoresightDeg);
      if (offBoresightDeg > 180.0) {
        offBoresightDeg = 360.0 - offBoresightDeg;
      }
      const azRatio = offBoresightDeg / AO_LINK_BUDGET.hpbwAzDeg;
      const rollOffLossDb = Math.min(12.0 * azRatio * azRatio, AO_LINK_BUDGET.maxRollOffDb);

      // Canonical 8.0 GHz Link Budget Calculation via LinkBudgetEngine
      const linkStatus = AO_LINK_ENGINE.evaluateLink({
        nodeType: 'soldier',
        slantRangeM: Math.max(1.0, d3dM),
        diffractionLossDb: diffLossDb,
        rf: effRf,
        env: effEnv,
        obstacleBlocked: false,
        nodeAltM: zAnt,
        acnAltM: zAcn,
        customRxGainDbi: effRf.acnAntennaGainDbi - rollOffLossDb,
        txX: xc,
        txY: yc,
        rxX: xAcn,
        rxY: yAcn,
      });
      const sinrDb = linkStatus.sinrDb ?? linkStatus.snrDb;

      sumSinr += sinrDb;
      if (sinrDb < minSinr) minSinr = sinrDb;
      if (sinrDb > maxSinr) maxSinr = sinrDb;

      const selectedModcodName = linkStatus.modcodName;

      // Zone Classification
      let zoneClass: AoZoneClass;
      if (sinrDb >= 12.0 && isLineOfSight) {
        zoneClass = 'HIGH_RATE_LOS';
      } else if (sinrDb >= -2.85) {
        zoneClass = 'MARGINAL_DIFFRACTED';
      } else {
        zoneClass = 'DEAD_ZONE_OUTAGE';
      }

      const cellItem: IntermediateCell = {
        col: c,
        row: r,
        xM: xc,
        yM: yc,
        zMslM: zc,
        slopeDeg,
        isLineOfSight,
        sinrDb,
        diffLossDb,
        modcodName: selectedModcodName,
        zoneClass,
        minX: cMinX,
        maxX: cMaxX,
        minY: cMinY,
        maxY: cMaxY,
      };

      rawCells.push(cellItem);

      if (!maxElevSample || zc > maxElevSample.zMslM) maxElevSample = cellItem;
      if (!minElevSample || zc < minElevSample.zMslM) minElevSample = cellItem;
      if (!worstSinrSample || sinrDb < worstSinrSample.sinrDb) worstSinrSample = cellItem;
    }
  }

  const totalCells = rawCells.length;
  const meanElevM = sumElev / totalCells;
  const meanSlopeDeg = sumSlope / totalCells;
  const meanSinrDb = sumSinr / totalCells;

  // 4. Compute Terrain Ruggedness Index (TRI) and Elevation Variance
  let sumSqElevDev = 0.0;
  let sumTriDev = 0.0;
  let losCount = 0;
  let marginalCount = 0;
  let deadZoneCount = 0;

  for (const cell of rawCells) {
    const diff = cell.zMslM - meanElevM;
    sumSqElevDev += diff * diff;
    sumTriDev += Math.abs(diff);

    if (cell.zoneClass === 'HIGH_RATE_LOS') losCount++;
    else if (cell.zoneClass === 'MARGINAL_DIFFRACTED') marginalCount++;
    else if (cell.zoneClass === 'DEAD_ZONE_OUTAGE') deadZoneCount++;
  }

  const stdElevM = Math.sqrt(sumSqElevDev / totalCells);
  const triM = sumTriDev / totalCells;
  const losCoveragePct = (losCount / totalCells) * 100.0;
  const marginalPct = (marginalCount / totalCells) * 100.0;
  const deadZonePct = (deadZoneCount / totalCells) * 100.0;

  // Build Final AoSwathCell Array with exact triM
  const cells: AoSwathCell[] = rawCells.map(c => ({
    ...c,
    triM: Math.abs(c.zMslM - meanElevM),
    isLos: c.isLineOfSight,
  }));

  // 5. Extreme Points
  const fallbackSummit = cells[0];
  const summitCell = maxElevSample || fallbackSummit;
  const valleyCell = minElevSample || fallbackSummit;
  const worstCell = worstSinrSample || fallbackSummit;

  const summitPeak: AoSwathExtremePoint = {
    xM: summitCell.xM,
    yM: summitCell.yM,
    zMslM: summitCell.zMslM,
    sinrDb: summitCell.sinrDb,
    x: summitCell.xM,
    y: summitCell.yM,
    z: summitCell.zMslM,
  };

  const valleyFloor: AoSwathExtremePoint = {
    xM: valleyCell.xM,
    yM: valleyCell.yM,
    zMslM: valleyCell.zMslM,
    sinrDb: valleyCell.sinrDb,
    x: valleyCell.xM,
    y: valleyCell.yM,
    z: valleyCell.zMslM,
  };

  const worstDeadZone: AoSwathExtremePoint = {
    xM: worstCell.xM,
    yM: worstCell.yM,
    zMslM: worstCell.zMslM,
    sinrDb: worstCell.sinrDb,
    x: worstCell.xM,
    y: worstCell.yM,
    z: worstCell.zMslM,
  };

  const reliefM = summitPeak.zMslM - valleyFloor.zMslM;

  // 6. 4-Quadrant Tactical Ground Squad Deployment Coordinates
  // Well-spaced coordinates across the 4 quadrants: SW, NW, SE, NE
  const qSwX = minX + 0.25 * spanXM;
  const qSwY = minY + 0.25 * spanYM;
  const qNwX = minX + 0.25 * spanXM;
  const qNwY = minY + 0.75 * spanYM;
  const qSeX = minX + 0.75 * spanXM;
  const qSeY = minY + 0.25 * spanYM;
  const qNeX = minX + 0.75 * spanXM;
  const qNeY = minY + 0.75 * spanYM;

  const squadDeployCoords: readonly [Position3D, Position3D, Position3D, Position3D] = [
    [qSwX, qSwY, getElevationAt(qSwX, qSwY) + 2.0],
    [qNwX, qNwY, getElevationAt(qNwX, qNwY) + 2.0],
    [qSeX, qSeY, getElevationAt(qSeX, qSeY) + 2.0],
    [qNeX, qNeY, getElevationAt(qNeX, qNeY) + 2.0],
  ];

  return {
    minX,
    maxX,
    minY,
    maxY,
    widthKm,
    heightKm,
    areaKm2,
    diagonalKm,
    diagonalAzimuthDeg,
    cells,
    summitPeak,
    valleyFloor,
    worstDeadZone,
    squadDeployCoords,
    losCoveragePct,
    marginalPct,
    deadZonePct,
    meanSinrDb,
    minSinrDb: minSinr,
    maxSinrDb: maxSinr,
    meanElevM,
    stdElevM,
    reliefM,
    meanSlopeDeg,
    triM,
  };
}
