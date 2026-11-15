/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Deep Scientific Terrain Analysis Controller (SPEC-3D-MAPLIBRE-TOOLBOX-UPGRADE-01)
 *
 * Implements:
 * 1. CloudRF / Google Earth Pro Transect Analysis (8 GHz Fresnel ellipse, 4/3 Earth bulge, P.526 diff loss, SNR/MODCOD)
 * 2. Ansys STK Virtual Terminal Link Probe (Slant range, elevation, LoS check, SNR, MODCOD, node spawner payload)
 * 3. QGIS Zonal Statistics & Local Summit Pinpointer (Summit coordinate, ruggedness TRI, 6x6 grid LoS coverage %)
 * 4. Excalidraw Obstacle Authoring Ergonomics (Shape modes, ITU-R material profiles, Undo/Redo stack, inventory list)
 */

import { MODCOD_TABLE } from '../core/linkBudget';
import type { Obstacle } from '../core/obstacles';

export const EFFECTIVE_EARTH_RADIUS_M = (4.0 / 3.0) * 6371000.0; // 8,494,666.67 m
export const X_BAND_CARRIER_FREQ_HZ = 8.0e9; // 8.0 GHz
export const SPEED_OF_LIGHT_M_S = 299792458.0;
export const X_BAND_WAVELENGTH_M = SPEED_OF_LIGHT_M_S / X_BAND_CARRIER_FREQ_HZ; // ~0.03747 m (~0.0375 m)

// Default System Link Budget Parameters for 8 GHz X-Band ACN-Ground Link
export const LINK_BUDGET_CONFIG = {
  txPowerDbm: 43.0, // 20 W
  txGainDbi: 18.0, // Sector / directional horn
  rxGainDbi: 3.0, // Terminal monopole / patch
  noisePowerDbm: -104.0, // 20 MHz thermal noise floor + NF
  gasRainLossMarginDb: 1.2, // Atmospheric absorption baseline
};

// -----------------------------------------------------------------------------
// Tool 1: CloudRF / Google Earth Pro Fresnel & Transect Metrics
// -----------------------------------------------------------------------------

export interface TransectFresnelPoint {
  readonly distM: number;
  readonly terrainMslM: number;
  readonly earthBulgeM: number;
  readonly bulgedTerrainMslM: number;
  readonly losMslM: number;
  readonly f1RadiusM: number;
  readonly f1Lower06MslM: number;
  readonly clearanceM: number;
  readonly isIntruding: boolean;
}

export interface TransectRfMetrics {
  readonly minF1ClearanceM: number;
  readonly minF1ClearancePct: number;
  readonly dominantCrestDistM: number;
  readonly p526DiffractionLossDb: number;
  readonly estSnrDb: number;
  readonly estModcod: string;
  readonly points: readonly TransectFresnelPoint[];
}

/**
 * Calculates 4/3 effective Earth curvature bulge at distance s along total link distance D.
 * Delta h(s) = s * (D - s) / (2 * R_eff)
 */
export function computeEarthBulgeM(sM: number, totalDistM: number, rEffM = EFFECTIVE_EARTH_RADIUS_M): number {
  if (totalDistM <= 0 || sM <= 0 || sM >= totalDistM) return 0;
  return (sM * (totalDistM - sM)) / (2.0 * rEffM);
}

/**
 * Calculates 8.0 GHz 1st Fresnel zone radius r_F1(s) = sqrt(lambda * s * (D - s) / D).
 */
export function computeFresnelRadiusM(sM: number, totalDistM: number, lambdaM = X_BAND_WAVELENGTH_M): number {
  if (totalDistM <= 0 || sM <= 0 || sM >= totalDistM) return 0;
  return Math.sqrt((lambdaM * sM * (totalDistM - sM)) / totalDistM);
}

/**
 * Evaluates ITU-R P.526 single knife-edge diffraction loss J(nu).
 */
export function computeP526DiffractionLossDb(nu: number): number {
  if (nu <= -0.78) return 0.0;
  const term = Math.sqrt((nu - 0.1) * (nu - 0.1) + 1.0) + nu - 0.1;
  return 6.9 + 20.0 * Math.log10(Math.max(1e-6, term));
}

/**
 * Maps SNR to best supported DVB-S2X MODCOD.
 */
export function lookupModcodFromSnr(snrDb: number): string {
  for (const entry of MODCOD_TABLE) {
    if (snrDb >= entry.minSnrDb) {
      return entry.name;
    }
  }
  return 'OUTAGE';
}

/**
 * Computes complete CloudRF-style Fresnel, bulge, diffraction loss, and SNR metrics along a transect.
 */
export function computeTransectRfMetrics(
  elevations: readonly number[],
  totalDistM: number,
  txMastM: number,
  rxMastM: number,
): TransectRfMetrics {
  const n = elevations.length;
  if (n < 2 || totalDistM <= 0) {
    return {
      minF1ClearanceM: 0,
      minF1ClearancePct: 100,
      dominantCrestDistM: 0,
      p526DiffractionLossDb: 0,
      estSnrDb: -99,
      estModcod: 'OUTAGE',
      points: [],
    };
  }

  const zStart = elevations[0] + txMastM;
  const zEnd = elevations[n - 1] + rxMastM;
  const stepDistM = totalDistM / (n - 1);

  let minClearanceM = Number.POSITIVE_INFINITY;
  let minClearancePct = 100.0;
  let dominantCrestDistM = totalDistM * 0.5;
  let maxNu = -999.0;

  const points: TransectFresnelPoint[] = [];

  for (let i = 0; i < n; i++) {
    const sM = i * stepDistM;
    const terrainM = elevations[i];
    const bulgeM = computeEarthBulgeM(sM, totalDistM);
    const bulgedTerrainM = terrainM + bulgeM;
    const losM = zStart + (sM / totalDistM) * (zEnd - zStart);
    const f1Radius = computeFresnelRadiusM(sM, totalDistM);
    const f1Lower06 = losM - 0.6 * f1Radius;
    const clearanceM = losM - bulgedTerrainM;
    const isIntruding = bulgedTerrainM > f1Lower06;

    if (f1Radius > 0) {
      const clearancePct = (clearanceM / f1Radius) * 100.0;
      if (clearanceM < minClearanceM) {
        minClearanceM = clearanceM;
        minClearancePct = clearancePct;
        dominantCrestDistM = sM;
      }

      // Fresnel-Kirchhoff parameter nu
      const d1 = Math.max(1.0, sM);
      const d2 = Math.max(1.0, totalDistM - sM);
      const hObstacle = bulgedTerrainM - losM; // positive when terrain penetrates above LOS
      const nu = hObstacle * Math.sqrt((2.0 / X_BAND_WAVELENGTH_M) * (1.0 / d1 + 1.0 / d2));
      if (nu > maxNu) {
        maxNu = nu;
      }
    }

    points.push({
      distM: sM,
      terrainMslM: terrainM,
      earthBulgeM: bulgeM,
      bulgedTerrainMslM: bulgedTerrainM,
      losMslM: losM,
      f1RadiusM: f1Radius,
      f1Lower06MslM: f1Lower06,
      clearanceM,
      isIntruding,
    });
  }

  const p526DiffractionLossDb = computeP526DiffractionLossDb(maxNu);

  // Slant range FSPL calculation
  const slantM = Math.hypot(totalDistM, zEnd - zStart);
  const fsplDb = 20.0 * Math.log10(Math.max(1.0, slantM)) + 20.0 * Math.log10(X_BAND_CARRIER_FREQ_HZ) - 147.55;
  const estSnrDb =
    LINK_BUDGET_CONFIG.txPowerDbm +
    LINK_BUDGET_CONFIG.txGainDbi +
    LINK_BUDGET_CONFIG.rxGainDbi -
    fsplDb -
    p526DiffractionLossDb -
    LINK_BUDGET_CONFIG.gasRainLossMarginDb -
    LINK_BUDGET_CONFIG.noisePowerDbm;

  const estModcod = lookupModcodFromSnr(estSnrDb);

  return {
    minF1ClearanceM: Number.isFinite(minClearanceM) ? minClearanceM : 0,
    minF1ClearancePct: Number.isFinite(minClearancePct) ? minClearancePct : 100,
    dominantCrestDistM,
    p526DiffractionLossDb: Math.max(0.0, p526DiffractionLossDb),
    estSnrDb,
    estModcod,
    points,
  };
}

// -----------------------------------------------------------------------------
// Tool 2: Ansys STK Virtual Terminal Link Probe
// -----------------------------------------------------------------------------

export interface ProbeLinkTelemetry {
  readonly probeX: number;
  readonly probeY: number;
  readonly probeAltMslM: number;
  readonly acnPos: [number, number, number];
  readonly slantRangeKm: number;
  readonly elevationDeg: number;
  readonly isLos: boolean;
  readonly diffLossDb: number;
  readonly sinrDb: number;
  readonly modcod: string;
}

/**
 * Evaluates the instantaneous 3D link between a virtual ground terminal and current ACN position.
 */
export function evaluateVirtualTerminalLink(
  probeX: number,
  probeY: number,
  probeElevM: number,
  probeAglM: number,
  acnPos: [number, number, number],
  sampleElevationFn: (x: number, y: number) => number,
): ProbeLinkTelemetry {
  const probeAltM = probeElevM + probeAglM;
  const dx = acnPos[0] - probeX;
  const dy = acnPos[1] - probeY;
  const dz = acnPos[2] - probeAltM;

  const horizDistM = Math.hypot(dx, dy);
  const slantM = Math.hypot(horizDistM, dz);
  const slantRangeKm = slantM / 1000.0;
  const elevationDeg = (Math.asin(dz / Math.max(1.0, slantM)) * 180.0) / Math.PI;

  // Sample 24 points along ray to check Line-of-Sight and maximum diffraction penetration
  const numSamples = 24;
  let isLos = true;
  let maxNu = -999.0;

  for (let i = 1; i < numSamples; i++) {
    const t = i / numSamples;
    const sx = probeX + dx * t;
    const sy = probeY + dy * t;
    const rayZ = probeAltM + dz * t;
    const terrainZ = sampleElevationFn(sx, sy);
    const bulge = computeEarthBulgeM(horizDistM * t, horizDistM);
    const effTerrainZ = terrainZ + bulge;

    if (effTerrainZ >= rayZ) {
      isLos = false;
    }

    const d1 = Math.max(1.0, horizDistM * t);
    const d2 = Math.max(1.0, horizDistM * (1.0 - t));
    const h = effTerrainZ - rayZ;
    const nu = h * Math.sqrt((2.0 / X_BAND_WAVELENGTH_M) * (1.0 / d1 + 1.0 / d2));
    if (nu > maxNu) {
      maxNu = nu;
    }
  }

  const diffLossDb = computeP526DiffractionLossDb(maxNu);
  const fsplDb = 20.0 * Math.log10(Math.max(1.0, slantM)) + 20.0 * Math.log10(X_BAND_CARRIER_FREQ_HZ) - 147.55;
  const sinrDb =
    LINK_BUDGET_CONFIG.txPowerDbm +
    LINK_BUDGET_CONFIG.txGainDbi +
    LINK_BUDGET_CONFIG.rxGainDbi -
    fsplDb -
    diffLossDb -
    LINK_BUDGET_CONFIG.gasRainLossMarginDb -
    LINK_BUDGET_CONFIG.noisePowerDbm;

  const modcod = lookupModcodFromSnr(sinrDb);

  return {
    probeX,
    probeY,
    probeAltMslM: probeAltM,
    acnPos,
    slantRangeKm,
    elevationDeg,
    isLos,
    diffLossDb: Math.max(0.0, diffLossDb),
    sinrDb,
    modcod,
  };
}

// -----------------------------------------------------------------------------
// Tool 3: QGIS Zonal Statistics & Local Summit Pinpointer
// -----------------------------------------------------------------------------

export interface ZonalSummitResult {
  readonly summitX: number;
  readonly summitY: number;
  readonly summitElevationM: number;
  readonly minElevationM: number;
  readonly meanElevationM: number;
  readonly maxElevationM: number;
  readonly terrainRuggednessIndexM: number; // TRI (mean absolute elevation difference from local mean)
  readonly meanSlopeDeg: number;
  readonly losCoveragePct: number;
  readonly validSampleCount: number;
}

/**
 * Analyzes a rectangular region bounding box, finding the local summit and computing zonal statistics.
 */
export function computeZonalSummitAndRuggedness(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  sampleElevationFn: (x: number, y: number) => number,
  acnPos: [number, number, number],
): ZonalSummitResult {
  let summitX = (minX + maxX) * 0.5;
  let summitY = (minY + maxY) * 0.5;
  let summitElev = Number.NEGATIVE_INFINITY;
  let minElev = Number.POSITIVE_INFINITY;
  let sumElev = 0.0;
  let totalValid = 0;

  // 1. Grid search for local summit and elevation distribution
  const gridDivs = 16;
  const elevations: number[] = [];
  for (let r = 0; r <= gridDivs; r++) {
    const y = minY + (maxY - minY) * (r / gridDivs);
    for (let c = 0; c <= gridDivs; c++) {
      const x = minX + (maxX - minX) * (c / gridDivs);
      const elev = sampleElevationFn(x, y);
      if (Number.isFinite(elev)) {
        elevations.push(elev);
        sumElev += elev;
        totalValid++;
        if (elev > summitElev) {
          summitElev = elev;
          summitX = x;
          summitY = y;
        }
        if (elev < minElev) {
          minElev = elev;
        }
      }
    }
  }

  const meanElev = totalValid > 0 ? sumElev / totalValid : 3500.0;

  // 2. Terrain Ruggedness Index (TRI) and Slope estimation
  let sumTri = 0.0;
  for (const e of elevations) {
    sumTri += Math.abs(e - meanElev);
  }
  const terrainRuggednessIndexM = totalValid > 0 ? sumTri / totalValid : 0.0;
  const spanDiagM = Math.hypot(maxX - minX, maxY - minY);
  const elevRangeM = Math.max(0.0, summitElev - minElev);
  const meanSlopeDeg = (Math.atan2(elevRangeM, Math.max(1.0, spanDiagM * 0.5)) * 180.0) / Math.PI;

  // 3. Estimated ACN Line-of-Sight Coverage % across a 6x6 sub-grid (36 test points)
  const subGridN = 6;
  let losPassCount = 0;
  let totalSubSamples = 0;

  for (let r = 0; r < subGridN; r++) {
    const py = minY + (maxY - minY) * ((r + 0.5) / subGridN);
    for (let c = 0; c < subGridN; c++) {
      const px = minX + (maxX - minX) * ((c + 0.5) / subGridN);
      const pElev = sampleElevationFn(px, py);
      if (Number.isFinite(pElev)) {
        totalSubSamples++;
        const pz = pElev + 2.0;
        const dx = acnPos[0] - px;
        const dy = acnPos[1] - py;
        const dz = acnPos[2] - pz;
        const dist = Math.hypot(dx, dy);

        let clear = true;
        for (let k = 1; k <= 8; k++) {
          const t = k / 9.0;
          const kx = px + dx * t;
          const ky = py + dy * t;
          const kz = pz + dz * t;
          const rayTerrain = sampleElevationFn(kx, ky) + computeEarthBulgeM(dist * t, dist);
          if (rayTerrain >= kz) {
            clear = false;
            break;
          }
        }
        if (clear) losPassCount++;
      }
    }
  }

  const losCoveragePct = totalSubSamples > 0 ? (losPassCount / totalSubSamples) * 100.0 : 0.0;

  return {
    summitX,
    summitY,
    summitElevationM: Number.isFinite(summitElev) ? summitElev : meanElev,
    minElevationM: Number.isFinite(minElev) ? minElev : meanElev,
    meanElevationM: meanElev,
    maxElevationM: Number.isFinite(summitElev) ? summitElev : meanElev,
    terrainRuggednessIndexM,
    meanSlopeDeg,
    losCoveragePct,
    validSampleCount: totalValid,
  };
}

// -----------------------------------------------------------------------------
// Tool 4: Excalidraw-Style Obstacle Authoring & Undo/Redo Ergonomics
// -----------------------------------------------------------------------------

export type ObstacleShapeMode = 'wall' | 'block' | 'peak';
export type ObstacleMaterialProfile = 'granite' | 'concrete' | 'foliage';

export interface ObstaclePresetConfig {
  readonly shapeMode: ObstacleShapeMode;
  readonly material: ObstacleMaterialProfile;
  readonly label: string;
  readonly defaultWidthM: number;
  readonly defaultDepthM: number;
  readonly defaultHeightM: number;
  readonly shapeType: Obstacle['shape'];
}

export const OBSTACLE_PRESETS: Record<ObstacleShapeMode, ObstaclePresetConfig> = {
  wall: {
    shapeMode: 'wall',
    material: 'granite',
    label: 'Ridge Wall (Segment)',
    defaultWidthM: 20,
    defaultDepthM: 500,
    defaultHeightM: 120,
    shapeType: 'cuboid',
  },
  block: {
    shapeMode: 'block',
    material: 'concrete',
    label: 'Bunker / Block (Thick Barrier)',
    defaultWidthM: 100,
    defaultDepthM: 100,
    defaultHeightM: 45,
    shapeType: 'cuboid',
  },
  peak: {
    shapeMode: 'peak',
    material: 'granite',
    label: 'Peak / Dome (Prominence)',
    defaultWidthM: 150,
    defaultDepthM: 150,
    defaultHeightM: 250,
    shapeType: 'cone',
  },
};

export const MATERIAL_PROFILES: Record<ObstacleMaterialProfile, { readonly label: string; readonly attenuationDbPerM: number; readonly isKnifeEdge: boolean }> = {
  granite: {
    label: 'Alpine Granite (Opaque Knife-Edge)',
    attenuationDbPerM: 100.0,
    isKnifeEdge: true,
  },
  concrete: {
    label: 'Reinforced Concrete (35 dB Cap)',
    attenuationDbPerM: 35.0,
    isKnifeEdge: false,
  },
  foliage: {
    label: 'Dense Conifer Foliage (ITU-R P.833 0.25 dB/m)',
    attenuationDbPerM: 0.25,
    isKnifeEdge: false,
  },
};

/**
 * Manages an Excalidraw-style undo/redo history stack and inventory formatters for 3D obstacles.
 */
export class ObstacleHistoryManager {
  private undoStack: Obstacle[][] = [];
  private redoStack: Obstacle[][] = [];
  private currentObstacles: Obstacle[] = [];

  constructor(initial: readonly Obstacle[] = []) {
    this.currentObstacles = initial.map(o => ({ ...o }));
  }

  public get obstacles(): readonly Obstacle[] {
    return this.currentObstacles;
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Pushes a new state snapshot before modification.
   */
  public pushState(nextObstacles: readonly Obstacle[]): void {
    this.undoStack.push(this.currentObstacles.map(o => ({ ...o })));
    this.redoStack = []; // Clear redo stack on new action
    this.currentObstacles = nextObstacles.map(o => ({ ...o }));
  }

  public undo(): readonly Obstacle[] | null {
    if (!this.canUndo) return null;
    const prev = this.undoStack.pop()!;
    this.redoStack.push(this.currentObstacles.map(o => ({ ...o })));
    this.currentObstacles = prev;
    return this.currentObstacles;
  }

  public redo(): readonly Obstacle[] | null {
    if (!this.canRedo) return null;
    const next = this.redoStack.pop()!;
    this.undoStack.push(this.currentObstacles.map(o => ({ ...o })));
    this.currentObstacles = next;
    return this.currentObstacles;
  }

  public deleteObstacle(id: string): readonly Obstacle[] {
    const next = this.currentObstacles.filter(o => o.id !== id);
    this.pushState(next);
    return this.currentObstacles;
  }

  /**
   * Formats a user-facing inventory label for an obstacle item.
   */
  public static formatItemLabel(obs: Obstacle, index: number): string {
    const shapeLabel = obs.shape === 'cone' ? 'Dome' : (obs.shape === 'pyramid' ? 'Peak' : 'Wall/Block');
    return `#${index + 1} ${shapeLabel} · ${Math.round(obs.heightM)}m`;
  }
}
