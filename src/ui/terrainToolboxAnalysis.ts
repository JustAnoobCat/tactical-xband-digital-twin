/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Scientific RF & Topographic Analysis Engine (Pure TypeScript, Zero DOM)
 *
 * Implements Phase A (DEM Provenance, Anisotropic Slope/Ridge, Mode 2 Transect Profiler,
 * Mode 4 Zonal Statistics & CSV/GeoJSON Exports) and Phase B (Mode 3 Viewshed/Orbit/Sweep,
 * Mode 4 Joint Relay Bridge Finder).
 */

import { ACNFlightConfig, EnvironmentConfig, MAX_ACN_WAYPOINTS, RFConfig } from '../core/config';
import { cartesianToGeodetic } from '../core/geodesy';
import { LinkBudgetEngine, MODCOD_TABLE, type LinkStatus } from '../core/linkBudget';
import { buildLinkProfile, type LinkProfile, type LinkProfileSample } from '../core/linkProfile';
import {
  DEFAULT_GRID_SIZE,
  TerrainEngine,
  type Position3D,
  type TerrainBoundsTelemetry,
} from '../core/terrain';
import { createACNTrajectory } from '../core/trajectory';
import { MAX_ACTIVE_GROUND_NODES, THEATER_HALF_M } from '../shared/constants';
import type { TrajectoryConfigTelemetry } from '../shared/workerProtocol';

export interface ToolboxGroundNodeView {
  readonly nodeId: number;
  readonly name: string;
  readonly nodeType: string;
  readonly xM: number;
  readonly yM: number;
  readonly aglM: number;
  readonly terrainMslM: number;
  readonly snrDb: number | null;
  readonly isLos: boolean;
  readonly obstacleBlocked: boolean;
}

export interface ToolboxSimulationContext {
  readonly terrainEngine: TerrainEngine;
  readonly rfConfig: RFConfig;
  readonly envConfig: EnvironmentConfig;
  readonly acnPositionMslM: Position3D | null;
  readonly trajectoryConfig: TrajectoryConfigTelemetry | null;
  readonly groundNodes: readonly ToolboxGroundNodeView[];
  readonly spatialRevision: number;
  readonly isHistoricalInspecting: boolean;
  readonly spatialLocked: boolean;
}

export interface DemSampleResult {
  readonly elevationM: number;
  readonly isWithinCoverage: boolean;
}

export interface DemProvenanceSummary {
  readonly terrainMode: 'real' | 'synthetic';
  readonly tileName: string;
  readonly rasterWidth: number;
  readonly rasterHeight: number;
  readonly groundResolutionXM: number;
  readonly groundResolutionYM: number;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly voidCount: number;
  readonly isValidCoverage: boolean;
  readonly outsideCoverageWarning: boolean;
  readonly bounds: TerrainBoundsTelemetry;
}

export interface SlopeAndRidgeGrid {
  readonly width: number;
  readonly height: number;
  readonly bounds: TerrainBoundsTelemetry;
  readonly slopeDeg: Float32Array;
  readonly ridgeTpiM: Float32Array;
  readonly maxSlopeDeg: number;
  readonly maxAbsTpiM: number;
}

export interface TransectVertexInput {
  readonly xM: number;
  readonly yM: number;
  readonly aglM: number;
  readonly heightMode: 'ground_agl' | 'acn_alt';
}

export interface TransectOptions {
  readonly kFactor?: number;
  readonly includeObstacles?: boolean;
  readonly nodeType?: 'soldier' | 'mcp';
  readonly sampleCount?: number;
  readonly rainRateMmH?: number;
}

export type TransectSampleStatus = 'clear' | 'grazing' | 'shadow' | 'obstacle' | 'out_of_coverage';

export interface TransectSampleDiagnostic {
  readonly segmentIndex: number;
  readonly cumulativeDistM: number;
  readonly segmentAlong: number;
  readonly xM: number;
  readonly yM: number;
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly terrainMslM: number;
  readonly effectiveTerrainMslM: number;
  readonly losMslM: number;
  readonly fresnelRadiusM: number;
  readonly lowerFresnel06MslM: number;
  readonly clearanceM: number;
  readonly clearanceRatio: number;
  readonly nu: number;
  readonly fresnelIntrusionPct: number;
  readonly status: TransectSampleStatus;
}

export interface DominantFresnelCrest {
  readonly segmentIndex: number;
  readonly cumulativeDistM: number;
  readonly xM: number;
  readonly yM: number;
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly terrainMslM: number;
  readonly effectiveTerrainMslM: number;
  readonly clearanceM: number;
  readonly fresnelRadiusM: number;
  readonly nu: number;
  readonly fresnelIntrusionPct: number;
  readonly minExtraHeightUniformM: number;
  readonly minExtraHeightEndpointBM: number;
}

export interface SpecularReflectionPoint {
  readonly segmentIndex: number;
  readonly xM: number;
  readonly yM: number;
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly terrainMslM: number;
  readonly grazingAngleADeg: number;
  readonly grazingAngleBDeg: number;
  readonly excessPathM: number;
  readonly phaseDeltaRad: number;
  readonly risk: 'HIGH' | 'MODERATE' | 'LOW' | 'N/A';
}

export interface KFactorSweepPoint {
  readonly kFactor: number;
  readonly isLos: boolean;
  readonly minClearanceM: number;
  readonly diffractionLossDb: number;
}

export interface RainSweepPoint {
  readonly rainRateMmH: number;
  readonly snrDb: number;
  readonly rainLossDb: number;
  readonly modcodName: string;
  readonly bitrateMbps: number;
  readonly isOutage: boolean;
}

export type CriticalRainReason = 'OK' | 'OBSTACLE_BLOCKED' | 'OUT_OF_COVERAGE' | 'COINCIDENT' | 'ALREADY_IN_OUTAGE';

export interface TransectSegmentResult {
  readonly segmentIndex: number;
  readonly start: TransectVertexInput & { readonly terrainMslM: number; readonly antennaMslM: number };
  readonly end: TransectVertexInput & { readonly terrainMslM: number; readonly antennaMslM: number };
  readonly horizontalDistanceM: number;
  readonly slantDistanceM: number;
  readonly isCoverageComplete: boolean;
  readonly coverageNote?: string;
  readonly isLos: boolean;
  readonly obstacleBlocked: boolean;
  readonly minClearanceM: number;
  readonly fresnelRadiusM: number;
  readonly diffractionLossDb: number;
  readonly linkStatus: LinkStatus | null;
  readonly zeroRainSnrDb: number | null;
  readonly criticalRainRateMmH: number | null;
  readonly rainStatusReason: CriticalRainReason;
  readonly rainSweep: readonly RainSweepPoint[];
  readonly kFactorSweep: readonly KFactorSweepPoint[];
  readonly criticalKFactor: number | null;
  readonly specular: SpecularReflectionPoint | null;
  readonly dominantCrest: DominantFresnelCrest | null;
  readonly profile: LinkProfile | null;
  readonly samples: readonly TransectSampleDiagnostic[];
}

export interface TransectAnalysisResult {
  readonly valid: boolean;
  readonly isCoverageComplete: boolean;
  readonly totalHorizontalM: number;
  readonly totalSlantM: number;
  readonly segments: readonly TransectSegmentResult[];
  readonly dominantCrest: DominantFresnelCrest | null;
  readonly minExtraHeightUniformM: number;
  readonly minExtraHeightEndpointBM: number;
  readonly worstLinkStatus: LinkStatus | null;
  readonly worstCriticalRainRateMmH: number | null;
  readonly worstSpecular: SpecularReflectionPoint | null;
  readonly samples: readonly TransectSampleDiagnostic[];
}

export interface ToolboxRegionPoint {
  readonly x: number;
  readonly y: number;
  readonly lng?: number;
  readonly lat?: number;
}

export interface ToolboxRegionInput {
  readonly id: number;
  readonly color: string;
  readonly visible: boolean;
  readonly points: readonly ToolboxRegionPoint[];
}

export interface RegionZonalStats {
  readonly regionId: number;
  readonly areaKm2: number;
  readonly totalInteriorSamples: number;
  readonly validDemSamples: number;
  readonly coverageCompletenessPct: number;
  readonly minElevationM: number | null;
  readonly meanElevationM: number | null;
  readonly maxElevationM: number | null;
  readonly stdElevationM: number | null;
  readonly meanSlopeDeg: number | null;
  readonly p95SlopeDeg: number | null;
  readonly losCoveragePct: number | null;
  readonly medianDiffractionLossDb: number | null;
  readonly enclosedNodeCount: number;
  readonly enclosedNodeIds: readonly number[];
  readonly enclosedMeanSnrDb: number | null;
  readonly bestRelayCoord: {
    readonly xM: number;
    readonly yM: number;
    readonly latDeg: number;
    readonly lonDeg: number;
    readonly elevationM: number;
    readonly snrDb: number;
  } | null;
}

const OUTAGE_SNR_FLOOR_DB = MODCOD_TABLE[MODCOD_TABLE.length - 1].minSnrDb; // -1.5 dB
const K_SWEEP_VALUES: readonly number[] = [2 / 3, 0.85, 1.0, 1.15, 4 / 3];

function isValidDemValue(v: number): boolean {
  return Number.isFinite(v) && v !== -32768;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Safely samples terrain elevation without falling back from Real DEM to Synthetic terrain.
 */
export function sampleDemSafe(engine: TerrainEngine, xM: number, yM: number): DemSampleResult {
  if (!Number.isFinite(xM) || !Number.isFinite(yM)) {
    return { elevationM: Number.NaN, isWithinCoverage: false };
  }
  if (engine.terrainMode === 'real') {
    if (!engine.hasRealDem || !engine.realDemGrid || !engine.isWithinDemCoverage(xM, yM)) {
      return { elevationM: Number.NaN, isWithinCoverage: false };
    }
    const elev = engine.getDemElevation(xM, yM);
    if (!Number.isFinite(elev)) {
      return { elevationM: Number.NaN, isWithinCoverage: false };
    }
    return { elevationM: elev, isWithinCoverage: true };
  }
  const inTheater = Math.abs(xM) <= THEATER_HALF_M && Math.abs(yM) <= THEATER_HALF_M;
  const elev = engine.getElevation(xM, yM);
  if (!inTheater || !Number.isFinite(elev)) {
    return { elevationM: Number.NaN, isWithinCoverage: false };
  }
  return { elevationM: elev, isWithinCoverage: true };
}

/**
 * Mode 1: Returns active DEM provenance metadata and coverage bounds.
 */
export function getDemProvenanceSummary(
  engine: TerrainEngine,
  hasOutOfCoverageActive: boolean,
): DemProvenanceSummary {
  const bounds = engine.getTerrainBoundsTelemetry();
  if (engine.terrainMode === 'synthetic') {
    return {
      terrainMode: 'synthetic',
      tileName: 'SYNTHETIC_FBM',
      rasterWidth: bounds.rasterWidth,
      rasterHeight: bounds.rasterHeight,
      groundResolutionXM: bounds.groundResolutionXM,
      groundResolutionYM: bounds.groundResolutionYM,
      minElevationM: 2800,
      maxElevationM: 5900,
      voidCount: 0,
      isValidCoverage: bounds.isValidCoverage,
      outsideCoverageWarning: hasOutOfCoverageActive,
      bounds,
    };
  }
  const meta = engine.demMetadata;
  return {
    terrainMode: 'real',
    tileName: meta.tileName ?? 'LADAKH',
    rasterWidth: meta.rasterWidth,
    rasterHeight: meta.rasterHeight,
    groundResolutionXM: meta.groundResolutionXM,
    groundResolutionYM: meta.groundResolutionYM,
    minElevationM: Number.isFinite(meta.minElevationM) ? meta.minElevationM! : 0,
    maxElevationM: Number.isFinite(meta.maxElevationM) ? meta.maxElevationM! : 0,
    voidCount: Number.isFinite(meta.voidCount) ? meta.voidCount! : 0,
    isValidCoverage: bounds.isValidCoverage,
    outsideCoverageWarning: hasOutOfCoverageActive,
    bounds,
  };
}

/**
 * Mode 1: Computes anisotropic terrain slope (deg) and 3x3 Topographic Position Index (TPI, m).
 * Uses exact dx/dy in real DEM mode, and samples engine.getElevation() in synthetic mode.
 */
export function computeSlopeAndRidgeGrid(engine: TerrainEngine): SlopeAndRidgeGrid {
  const bounds = engine.getTerrainBoundsTelemetry();
  let width: number;
  let height: number;
  let dx: number;
  let dy: number;
  let grid: Float32Array;

  if (engine.terrainMode === 'real' && engine.realDemGrid !== null) {
    const meta = engine.demMetadata;
    width = meta.rasterWidth;
    height = meta.rasterHeight;
    dx = meta.groundResolutionXM > 0 ? meta.groundResolutionXM : (bounds.maxX - bounds.minX) / Math.max(1, width - 1);
    dy = meta.groundResolutionYM > 0 ? meta.groundResolutionYM : (bounds.maxY - bounds.minY) / Math.max(1, height - 1);
    grid = engine.realDemGrid;
  } else {
    width = DEFAULT_GRID_SIZE;
    height = DEFAULT_GRID_SIZE;
    dx = (bounds.maxX - bounds.minX) / Math.max(1, width - 1);
    dy = (bounds.maxY - bounds.minY) / Math.max(1, height - 1);
    grid = new Float32Array(width * height);
    for (let r = 0; r < height; r++) {
      const yM = bounds.maxY - r * dy;
      for (let c = 0; c < width; c++) {
        const xM = bounds.minX + c * dx;
        grid[r * width + c] = engine.getElevation(xM, yM);
      }
    }
  }

  const total = width * height;
  const slopeDeg = new Float32Array(total);
  const ridgeTpiM = new Float32Array(total);
  let maxSlopeDeg = 0;
  let maxAbsTpiM = 0;

  for (let r = 0; r < height; r++) {
    const rowOff = r * width;
    for (let c = 0; c < width; c++) {
      const idx = rowOff + c;
      const zc = grid[idx];
      if (!isValidDemValue(zc)) {
        slopeDeg[idx] = Number.NaN;
        ridgeTpiM[idx] = Number.NaN;
        continue;
      }

      const zLeft = c > 0 ? grid[idx - 1] : Number.NaN;
      const zRight = c < width - 1 ? grid[idx + 1] : Number.NaN;
      const zNorth = r > 0 ? grid[(r - 1) * width + c] : Number.NaN;
      const zSouth = r < height - 1 ? grid[(r + 1) * width + c] : Number.NaN;

      const leftOk = isValidDemValue(zLeft);
      const rightOk = isValidDemValue(zRight);
      const northOk = isValidDemValue(zNorth);
      const southOk = isValidDemValue(zSouth);

      let dzdx = 0;
      if (leftOk && rightOk) dzdx = (zRight - zLeft) / (2 * dx);
      else if (rightOk) dzdx = (zRight - zc) / dx;
      else if (leftOk) dzdx = (zc - zLeft) / dx;

      let dzdy = 0;
      if (northOk && southOk) dzdy = (zNorth - zSouth) / (2 * dy);
      else if (northOk) dzdy = (zNorth - zc) / dy;
      else if (southOk) dzdy = (zc - zSouth) / dy;

      const sDeg = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
      slopeDeg[idx] = sDeg;
      if (sDeg > maxSlopeDeg) maxSlopeDeg = sDeg;

      let sum3x3 = 0;
      let count3x3 = 0;
      const rMin = Math.max(0, r - 1);
      const rMax = Math.min(height - 1, r + 1);
      const cMin = Math.max(0, c - 1);
      const cMax = Math.min(width - 1, c + 1);
      for (let rr = rMin; rr <= rMax; rr++) {
        for (let cc = cMin; cc <= cMax; cc++) {
          const val = grid[rr * width + cc];
          if (isValidDemValue(val)) {
            sum3x3 += val;
            count3x3++;
          }
        }
      }
      const tpi = count3x3 > 0 ? zc - sum3x3 / count3x3 : 0;
      ridgeTpiM[idx] = tpi;
      const absTpi = Math.abs(tpi);
      if (absTpi > maxAbsTpiM) maxAbsTpiM = absTpi;
    }
  }

  return { width, height, bounds, slopeDeg, ridgeTpiM, maxSlopeDeg, maxAbsTpiM };
}

function computeSpecularPoint(
  segmentIndex: number,
  samples: readonly LinkProfileSample[],
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  zA: number,
  zB: number,
  wavelengthM: number,
  d3D: number,
): SpecularReflectionPoint | null {
  const n = samples.length;
  if (n < 3 || d3D <= 0) return null;
  const totalHoriz = samples[n - 1].horizontalGroundDistanceM;
  if (!(totalHoriz > 0)) return null;

  // O(N) dual running-max-slope visibility
  const visFromA = new Uint8Array(n);
  const visFromB = new Uint8Array(n);

  let maxSlopeA = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < n - 1; i++) {
    const dA = samples[i].horizontalGroundDistanceM;
    if (dA <= 0) continue;
    const slopeA = (samples[i].effectiveTerrainElevationMslM - zA) / dA;
    if (slopeA >= maxSlopeA - 1e-9) {
      visFromA[i] = 1;
      maxSlopeA = slopeA;
    }
  }

  let maxSlopeB = Number.NEGATIVE_INFINITY;
  for (let i = n - 2; i >= 1; i--) {
    const dB = totalHoriz - samples[i].horizontalGroundDistanceM;
    if (dB <= 0) continue;
    const slopeB = (samples[i].effectiveTerrainElevationMslM - zB) / dB;
    if (slopeB >= maxSlopeB - 1e-9) {
      visFromB[i] = 1;
      maxSlopeB = slopeB;
    }
  }

  let bestIdx = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  let bestPsiA = 0;
  let bestPsiB = 0;

  for (let i = 1; i < n - 1; i++) {
    if (!visFromA[i] || !visFromB[i]) continue;
    const dA = samples[i].horizontalGroundDistanceM;
    const dB = totalHoriz - dA;
    if (dA <= 0 || dB <= 0) continue;

    const spanD = samples[i + 1].horizontalGroundDistanceM - samples[i - 1].horizontalGroundDistanceM;
    const dzSlope = samples[i + 1].effectiveTerrainElevationMslM - samples[i - 1].effectiveTerrainElevationMslM;
    const alpha = spanD > 0 ? Math.atan(dzSlope / spanD) : 0;

    const zTerrain = samples[i].effectiveTerrainElevationMslM;
    const thetaA = Math.atan2(zA - zTerrain, dA);
    const thetaB = Math.atan2(zB - zTerrain, dB);
    const psiA = thetaA + alpha;
    const psiB = thetaB - alpha;
    if (psiA <= 0 || psiB <= 0) continue;

    const diff = Math.abs(psiA - psiB);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
      bestPsiA = psiA;
      bestPsiB = psiB;
    }
  }

  if (bestIdx < 0) return null;

  const s = samples[bestIdx];
  const frac = s.horizontalGroundDistanceM / totalHoriz;
  const xM = startX + frac * (endX - startX);
  const yM = startY + frac * (endY - startY);
  const geo = cartesianToGeodetic(xM, yM);

  const dA = s.horizontalGroundDistanceM;
  const dB = totalHoriz - dA;
  const lRef = Math.hypot(dA, zA - s.effectiveTerrainElevationMslM) + Math.hypot(dB, zB - s.effectiveTerrainElevationMslM);
  const excessPathM = Math.max(0, lRef - d3D);
  const phaseDeltaRad = wavelengthM > 0 ? (2 * Math.PI * excessPathM) / wavelengthM : 0;
  const avgDeg = ((bestPsiA + bestPsiB) * 0.5 * 180) / Math.PI;
  const risk: SpecularReflectionPoint['risk'] =
    avgDeg <= 6 ? 'HIGH' : avgDeg <= 15 ? 'MODERATE' : 'LOW';

  return {
    segmentIndex,
    xM,
    yM,
    latDeg: geo.latDeg,
    lonDeg: geo.lonDeg,
    terrainMslM: s.terrainElevationMslM,
    grazingAngleADeg: (bestPsiA * 180) / Math.PI,
    grazingAngleBDeg: (bestPsiB * 180) / Math.PI,
    excessPathM,
    phaseDeltaRad,
    risk,
  };
}

/**
 * Mode 2: Evaluates single-hop or multi-segment polyline transect with full RF link budget,
 * dominant Fresnel crest, height deltas, O(N) specular reflection, k-sweep, and M3 rain sensitivity.
 */
export function evaluateTransect(
  ctx: ToolboxSimulationContext,
  waypoints: readonly TransectVertexInput[],
  opts: TransectOptions = {},
): TransectAnalysisResult {
  if (waypoints.length < 2) {
    return {
      valid: false,
      isCoverageComplete: false,
      totalHorizontalM: 0,
      totalSlantM: 0,
      segments: [],
      dominantCrest: null,
      minExtraHeightUniformM: 0,
      minExtraHeightEndpointBM: 0,
      worstLinkStatus: null,
      worstCriticalRainRateMmH: null,
      worstSpecular: null,
      samples: [],
    };
  }

  const includeObstacles = opts.includeObstacles ?? true;
  const nodeType = opts.nodeType ?? 'soldier';
  const kFactor = opts.kFactor ?? ctx.envConfig.effectiveEarthRadiusFactor;
  const rainRateMmH = opts.rainRateMmH ?? ctx.envConfig.rainRateMmH;

  const env = new EnvironmentConfig({
    effectiveEarthRadiusFactor: kFactor,
    trueEarthRadiusM: ctx.envConfig.trueEarthRadiusM,
    rainRateMmH,
    rainCellLengthKm: ctx.envConfig.rainCellLengthKm,
    atmosphericTemperatureK: ctx.envConfig.atmosphericTemperatureK,
  });
  const zeroRainEnv = new EnvironmentConfig({
    effectiveEarthRadiusFactor: kFactor,
    trueEarthRadiusM: ctx.envConfig.trueEarthRadiusM,
    rainRateMmH: 0,
    rainCellLengthKm: ctx.envConfig.rainCellLengthKm,
    atmosphericTemperatureK: ctx.envConfig.atmosphericTemperatureK,
  });

  const linkEngine = new LinkBudgetEngine();
  const acnAltDefault = ctx.acnPositionMslM?.[2] ?? 5000;

  const resolveVertex = (v: TransectVertexInput) => {
    const dem = sampleDemSafe(ctx.terrainEngine, v.xM, v.yM);
    const antennaMslM =
      v.heightMode === 'acn_alt'
        ? acnAltDefault
        : dem.isWithinCoverage
          ? dem.elevationM + v.aglM
          : Number.NaN;
    return { ...v, terrainMslM: dem.elevationM, antennaMslM, isWithinCoverage: dem.isWithinCoverage };
  };

  const resolved = waypoints.map(resolveVertex);
  const segments: TransectSegmentResult[] = [];
  const allSamples: TransectSampleDiagnostic[] = [];

  let totalHorizontalM = 0;
  let totalSlantM = 0;
  let allCoverageComplete = true;

  let globalDominantCrest: DominantFresnelCrest | null = null;
  let minGlobalRatio = Number.POSITIVE_INFINITY;
  let globalExtraUniformM = 0;
  let globalExtraEndpointBM = 0;
  let worstLinkStatus: LinkStatus | null = null;
  let worstCriticalRainRateMmH: number | null = null;
  let worstSpecular: SpecularReflectionPoint | null = null;

  for (let segIdx = 0; segIdx < resolved.length - 1; segIdx++) {
    const start = resolved[segIdx];
    const end = resolved[segIdx + 1];
    const dx = end.xM - start.xM;
    const dy = end.yM - start.yM;
    const d2D = Math.hypot(dx, dy);
    const dz = Number.isFinite(end.antennaMslM) && Number.isFinite(start.antennaMslM)
      ? end.antennaMslM - start.antennaMslM
      : 0;
    const d3D = Math.hypot(d2D, dz);

    const posA: Position3D = [start.xM, start.yM, start.antennaMslM];
    const posB: Position3D = [end.xM, end.yM, end.antennaMslM];

    const obstruction = ctx.terrainEngine.evaluateTerrainObstruction(posA, posB, ctx.rfConfig, env);
    const effObstacleBlocked = includeObstacles ? obstruction.obstacleBlocked : false;
    const isCovComplete =
      start.isWithinCoverage && end.isWithinCoverage && obstruction.isCoverageComplete !== false;

    if (!isCovComplete) allCoverageComplete = false;

    const sampleCount = opts.sampleCount ?? clamp(Math.ceil(d2D / 150), 48, 256);
    const profile = buildLinkProfile({
      selectedGroundNodeId: -1,
      nodeName: `T${segIdx + 1}`,
      frameIndex: 0,
      simulationTimeS: 0,
      groundNodePositionMslM: posA,
      acnPositionMslM: posB,
      wavelengthM: ctx.rfConfig.wavelengthM,
      effectiveEarthRadiusM: env.effectiveEarthRadiusM,
      fresnelFraction: 0.6,
      sampleCount,
      obstruction,
      getTerrainElevationMslM: (x, y) => sampleDemSafe(ctx.terrainEngine, x, y).elevationM,
      computeEarthBulgeM: TerrainEngine.computeEarthBulge,
    });

    const segSamples: TransectSampleDiagnostic[] = [];
    let segDomCrest: DominantFresnelCrest | null = null;
    let segMinRatio = Number.POSITIVE_INFINITY;
    let segExtraUniformM = 0;
    let segExtraEndpointBM = 0;

    if (profile.valid && profile.samples.length > 0 && d3D > 0) {
      const wavelength = ctx.rfConfig.wavelengthM;
      for (let i = 0; i < profile.samples.length; i++) {
        const ps = profile.samples[i];
        const along = profile.samples.length > 1 ? i / (profile.samples.length - 1) : 0;
        const xM = start.xM + along * dx;
        const yM = start.yM + along * dy;
        const geo = cartesianToGeodetic(xM, yM);

        const d1M = ps.slantDistanceM;
        const d2M = d3D - d1M;
        const r1 = ps.fresnelRadiusM;
        const hClear = ps.effectiveTerrainClearanceM;
        const clearanceRatio = r1 > 0 ? hClear / r1 : (hClear >= 0 ? 1 : -1);
        const nu =
          d1M > 1e-3 && d2M > 1e-3
            ? -hClear * Math.sqrt((2.0 / wavelength) * (1.0 / d1M + 1.0 / d2M))
            : 0;
        const fresnelIntrusionPct =
          r1 > 0 ? Math.max(0, ((0.6 * r1 - hClear) / (0.6 * r1)) * 100) : 0;

        const insideObstacle =
          includeObstacles &&
          profile.obstacleIntervals.some(
            (iv) => along >= iv.entryFraction && along <= iv.exitFraction,
          );

        let status: TransectSampleStatus;
        if (!isCovComplete) status = 'out_of_coverage';
        else if (insideObstacle) status = 'obstacle';
        else if (clearanceRatio <= 0) status = 'shadow';
        else if (clearanceRatio < 0.6) status = 'grazing';
        else status = 'clear';

        const diag: TransectSampleDiagnostic = {
          segmentIndex: segIdx,
          cumulativeDistM: totalHorizontalM + ps.horizontalGroundDistanceM,
          segmentAlong: along,
          xM,
          yM,
          latDeg: geo.latDeg,
          lonDeg: geo.lonDeg,
          terrainMslM: ps.terrainElevationMslM,
          effectiveTerrainMslM: ps.effectiveTerrainElevationMslM,
          losMslM: ps.losElevationMslM,
          fresnelRadiusM: r1,
          lowerFresnel06MslM: ps.lowerFresnelElevationMslM,
          clearanceM: hClear,
          clearanceRatio,
          nu,
          fresnelIntrusionPct,
          status,
        };
        segSamples.push(diag);
        allSamples.push(diag);

        if (i > 0 && i < profile.samples.length - 1 && r1 > 0) {
          const deficitM = Math.max(0, 0.6 * r1 - hClear);
          const sFrac = d1M / d3D;
          if (deficitM > segExtraUniformM) segExtraUniformM = deficitM;
          if (sFrac > 1e-6) {
            const deficitB = deficitM / sFrac;
            if (deficitB > segExtraEndpointBM) segExtraEndpointBM = deficitB;
          }
          if (clearanceRatio < segMinRatio) {
            segMinRatio = clearanceRatio;
            segDomCrest = {
              segmentIndex: segIdx,
              cumulativeDistM: diag.cumulativeDistM,
              xM,
              yM,
              latDeg: geo.latDeg,
              lonDeg: geo.lonDeg,
              terrainMslM: ps.terrainElevationMslM,
              effectiveTerrainMslM: ps.effectiveTerrainElevationMslM,
              clearanceM: hClear,
              fresnelRadiusM: r1,
              nu,
              fresnelIntrusionPct,
              minExtraHeightUniformM: segExtraUniformM,
              minExtraHeightEndpointBM: segExtraEndpointBM,
            };
          }
        }
      }
      if (segDomCrest) {
        segDomCrest = {
          ...segDomCrest,
          minExtraHeightUniformM: segExtraUniformM,
          minExtraHeightEndpointBM: segExtraEndpointBM,
        };
      }
    }

    if (segExtraUniformM > globalExtraUniformM) globalExtraUniformM = segExtraUniformM;
    if (segExtraEndpointBM > globalExtraEndpointBM) globalExtraEndpointBM = segExtraEndpointBM;
    if (segDomCrest && segMinRatio < minGlobalRatio) {
      minGlobalRatio = segMinRatio;
      globalDominantCrest = segDomCrest;
    }

    let linkStatus: LinkStatus | null = null;
    let zeroRainSnrDb: number | null = null;
    let criticalRainRateMmH: number | null = null;
    let rainStatusReason: CriticalRainReason = 'OK';
    const rainSweep: RainSweepPoint[] = [];
    const kFactorSweep: KFactorSweepPoint[] = [];
    let criticalKFactor: number | null = null;

    if (!isCovComplete) {
      rainStatusReason = 'OUT_OF_COVERAGE';
    } else if (!(d3D > 1e-3)) {
      rainStatusReason = 'COINCIDENT';
    } else {
      linkStatus = linkEngine.evaluateLink(
        nodeType,
        d3D,
        obstruction.diffractionLossDb,
        ctx.rfConfig,
        env,
        effObstacleBlocked,
      );
      const zeroStatus = linkEngine.evaluateLink(
        nodeType,
        d3D,
        obstruction.diffractionLossDb,
        ctx.rfConfig,
        zeroRainEnv,
        effObstacleBlocked,
      );
      zeroRainSnrDb = zeroStatus.snrDb;

      if (effObstacleBlocked) {
        criticalRainRateMmH = null;
        rainStatusReason = 'OBSTACLE_BLOCKED';
      } else if (zeroStatus.snrDb < OUTAGE_SNR_FLOOR_DB) {
        criticalRainRateMmH = 0;
        rainStatusReason = 'ALREADY_IN_OUTAGE';
      } else {
        const lEffKm = Math.min(d3D / 1000, env.rainCellLengthKm);
        criticalRainRateMmH =
          lEffKm > 0
            ? Math.pow((zeroStatus.snrDb - OUTAGE_SNR_FLOOR_DB) / (0.00411 * lEffKm), 1 / 1.39)
            : null;
        rainStatusReason = 'OK';
      }

      for (let r = 0; r <= 50; r += 5) {
        const sweepEnv = new EnvironmentConfig({
          effectiveEarthRadiusFactor: kFactor,
          trueEarthRadiusM: ctx.envConfig.trueEarthRadiusM,
          rainRateMmH: r,
          rainCellLengthKm: ctx.envConfig.rainCellLengthKm,
          atmosphericTemperatureK: ctx.envConfig.atmosphericTemperatureK,
        });
        const st = linkEngine.evaluateLink(
          nodeType,
          d3D,
          obstruction.diffractionLossDb,
          ctx.rfConfig,
          sweepEnv,
          effObstacleBlocked,
        );
        rainSweep.push({
          rainRateMmH: r,
          snrDb: st.snrDb,
          rainLossDb: st.rainLossDb,
          modcodName: st.modcodName,
          bitrateMbps: st.bitrateMbps,
          isOutage: st.isOutage,
        });
      }

      for (const kVal of K_SWEEP_VALUES) {
        const kEnv = new EnvironmentConfig({
          effectiveEarthRadiusFactor: kVal,
          trueEarthRadiusM: ctx.envConfig.trueEarthRadiusM,
          rainRateMmH,
          rainCellLengthKm: ctx.envConfig.rainCellLengthKm,
          atmosphericTemperatureK: ctx.envConfig.atmosphericTemperatureK,
        });
        const kObs = ctx.terrainEngine.evaluateTerrainObstruction(posA, posB, ctx.rfConfig, kEnv);
        kFactorSweep.push({
          kFactor: kVal,
          isLos: kObs.isLos,
          minClearanceM: kObs.minClearanceM,
          diffractionLossDb: kObs.diffractionLossDb,
        });
      }
      for (let ki = 1; ki < kFactorSweep.length; ki++) {
        if (kFactorSweep[ki].isLos !== kFactorSweep[ki - 1].isLos) {
          criticalKFactor = (kFactorSweep[ki].kFactor + kFactorSweep[ki - 1].kFactor) * 0.5;
          break;
        }
      }
    }

    const specular =
      isCovComplete && profile.valid
        ? computeSpecularPoint(
            segIdx,
            profile.samples,
            start.xM,
            start.yM,
            end.xM,
            end.yM,
            start.antennaMslM,
            end.antennaMslM,
            ctx.rfConfig.wavelengthM,
            d3D,
          )
        : null;

    if (linkStatus) {
      if (!worstLinkStatus || linkStatus.snrDb < worstLinkStatus.snrDb) {
        worstLinkStatus = linkStatus;
      }
    }
    if (criticalRainRateMmH !== null) {
      if (worstCriticalRainRateMmH === null || criticalRainRateMmH < worstCriticalRainRateMmH) {
        worstCriticalRainRateMmH = criticalRainRateMmH;
      }
    }
    if (specular) {
      const rank = { HIGH: 3, MODERATE: 2, LOW: 1, 'N/A': 0 };
      if (!worstSpecular || rank[specular.risk] > rank[worstSpecular.risk]) {
        worstSpecular = specular;
      }
    }

    totalHorizontalM += d2D;
    totalSlantM += d3D;

    segments.push({
      segmentIndex: segIdx,
      start,
      end,
      horizontalDistanceM: d2D,
      slantDistanceM: d3D,
      isCoverageComplete: isCovComplete,
      coverageNote: obstruction.coverageNote,
      isLos: obstruction.isLos && !effObstacleBlocked,
      obstacleBlocked: effObstacleBlocked,
      minClearanceM: obstruction.minClearanceM,
      fresnelRadiusM: obstruction.fresnelRadiusM,
      diffractionLossDb: obstruction.diffractionLossDb,
      linkStatus,
      zeroRainSnrDb,
      criticalRainRateMmH,
      rainStatusReason,
      rainSweep,
      kFactorSweep,
      criticalKFactor,
      specular,
      dominantCrest: segDomCrest,
      profile,
      samples: segSamples,
    });
  }

  if (globalDominantCrest) {
    globalDominantCrest = {
      ...globalDominantCrest,
      minExtraHeightUniformM: globalExtraUniformM,
      minExtraHeightEndpointBM: globalExtraEndpointBM,
    };
  }

  return {
    valid: segments.length > 0,
    isCoverageComplete: allCoverageComplete,
    totalHorizontalM,
    totalSlantM,
    segments,
    dominantCrest: globalDominantCrest,
    minExtraHeightUniformM: globalExtraUniformM,
    minExtraHeightEndpointBM: globalExtraEndpointBM,
    worstLinkStatus,
    worstCriticalRainRateMmH,
    worstSpecular,
    samples: allSamples,
  };
}

/**
 * Exports Mode 2 transect diagnostics to RFC-4180 CSV with provenance header comments.
 */
export function exportTransectCsv(result: TransectAnalysisResult): string {
  const lines: string[] = [
    `# SPEC-TERRAIN-TOOLBOX-SCI-01-REV2 Transect Export`,
    `# TotalHorizontalKm=${(result.totalHorizontalM / 1000).toFixed(4)},TotalSlantKm=${(result.totalSlantM / 1000).toFixed(4)},CoverageComplete=${result.isCoverageComplete}`,
    'segment,dist_km,lat_deg,lon_deg,terrain_msl_m,eff_terrain_msl_m,los_msl_m,fresnel_06_lower_msl_m,clearance_m,nu,status',
  ];
  for (const s of result.samples) {
    lines.push(
      [
        s.segmentIndex + 1,
        (s.cumulativeDistM / 1000).toFixed(4),
        s.latDeg.toFixed(6),
        s.lonDeg.toFixed(6),
        s.terrainMslM.toFixed(2),
        s.effectiveTerrainMslM.toFixed(2),
        s.losMslM.toFixed(2),
        s.lowerFresnel06MslM.toFixed(2),
        s.clearanceM.toFixed(2),
        s.nu.toFixed(4),
        s.status,
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

export function pointInPolygon(x: number, y: number, pts: readonly ToolboxRegionPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function computePolygonAreaKm2(pts: readonly ToolboxRegionPoint[]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2e6;
}

/**
 * Mode 4: Evaluates zonal elevation, anisotropic slope, ACN LOS coverage, enclosed nodes, and best relay cell.
 */
export function analyzeRegionZonal(
  ctx: ToolboxSimulationContext,
  region: ToolboxRegionInput,
  opts: { includeObstacles: boolean; nodeType: 'soldier' | 'mcp' },
): RegionZonalStats {
  const pts = region.points;
  const areaKm2 = computePolygonAreaKm2(pts);

  const enclosedNodes = pts.length >= 3
    ? ctx.groundNodes.filter((n) => pointInPolygon(n.xM, n.yM, pts))
    : [];
  const snrVals = enclosedNodes.map((n) => n.snrDb).filter((v): v is number => v !== null && Number.isFinite(v));
  const enclosedMeanSnrDb = snrVals.length > 0 ? snrVals.reduce((a, b) => a + b, 0) / snrVals.length : null;

  if (pts.length < 3) {
    return {
      regionId: region.id,
      areaKm2: 0,
      totalInteriorSamples: 0,
      validDemSamples: 0,
      coverageCompletenessPct: 0,
      minElevationM: null,
      meanElevationM: null,
      maxElevationM: null,
      stdElevationM: null,
      meanSlopeDeg: null,
      p95SlopeDeg: null,
      losCoveragePct: null,
      medianDiffractionLossDb: null,
      enclosedNodeCount: enclosedNodes.length,
      enclosedNodeIds: enclosedNodes.map((n) => n.nodeId),
      enclosedMeanSnrDb,
      bestRelayCoord: null,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const gridN = 32;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const stepX = spanX / gridN;
  const stepY = spanY / gridN;
  const slopeStep = Math.max(30, Math.min(stepX, stepY));

  const elevs: number[] = [];
  const slopes: number[] = [];
  const diffLosses: number[] = [];
  let totalInteriorSamples = 0;
  let losClearCount = 0;
  let bestRelayCoord: RegionZonalStats['bestRelayCoord'] = null;

  const linkEngine = new LinkBudgetEngine();
  const acnPos = ctx.acnPositionMslM;

  for (let r = 0; r < gridN; r++) {
    const yM = minY + (r + 0.5) * stepY;
    for (let c = 0; c < gridN; c++) {
      const xM = minX + (c + 0.5) * stepX;
      if (!pointInPolygon(xM, yM, pts)) continue;
      totalInteriorSamples++;

      const dem = sampleDemSafe(ctx.terrainEngine, xM, yM);
      if (!dem.isWithinCoverage) continue;
      elevs.push(dem.elevationM);

      const eE = sampleDemSafe(ctx.terrainEngine, xM + slopeStep, yM);
      const eW = sampleDemSafe(ctx.terrainEngine, xM - slopeStep, yM);
      const eN = sampleDemSafe(ctx.terrainEngine, xM, yM + slopeStep);
      const eS = sampleDemSafe(ctx.terrainEngine, xM, yM - slopeStep);
      let dzdx = 0;
      if (eE.isWithinCoverage && eW.isWithinCoverage) dzdx = (eE.elevationM - eW.elevationM) / (2 * slopeStep);
      else if (eE.isWithinCoverage) dzdx = (eE.elevationM - dem.elevationM) / slopeStep;
      else if (eW.isWithinCoverage) dzdx = (dem.elevationM - eW.elevationM) / slopeStep;

      let dzdy = 0;
      if (eN.isWithinCoverage && eS.isWithinCoverage) dzdy = (eN.elevationM - eS.elevationM) / (2 * slopeStep);
      else if (eN.isWithinCoverage) dzdy = (eN.elevationM - dem.elevationM) / slopeStep;
      else if (eS.isWithinCoverage) dzdy = (dem.elevationM - eS.elevationM) / slopeStep;

      slopes.push(Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI));

      if (acnPos) {
        const nodePos: Position3D = [xM, yM, dem.elevationM + 2.0];
        const obs = ctx.terrainEngine.evaluateTerrainObstruction(
          nodePos,
          acnPos,
          ctx.rfConfig,
          ctx.envConfig,
          250.0,
        );
        const effBlocked = opts.includeObstacles ? obs.obstacleBlocked : false;
        if (obs.isCoverageComplete !== false) {
          diffLosses.push(obs.diffractionLossDb);
          if (obs.isLos && !effBlocked) {
            losClearCount++;
            const d3D = Math.hypot(acnPos[0] - xM, acnPos[1] - yM, acnPos[2] - nodePos[2]);
            if (d3D > 1e-3) {
              const st = linkEngine.evaluateLink(
                opts.nodeType,
                d3D,
                obs.diffractionLossDb,
                ctx.rfConfig,
                ctx.envConfig,
                false,
              );
              if (!bestRelayCoord || st.snrDb > bestRelayCoord.snrDb) {
                const geo = cartesianToGeodetic(xM, yM);
                bestRelayCoord = {
                  xM,
                  yM,
                  latDeg: geo.latDeg,
                  lonDeg: geo.lonDeg,
                  elevationM: dem.elevationM,
                  snrDb: st.snrDb,
                };
              }
            }
          }
        }
      }
    }
  }

  const validDemSamples = elevs.length;
  const coverageCompletenessPct =
    totalInteriorSamples > 0 ? (validDemSamples / totalInteriorSamples) * 100 : 0;

  let minElevationM: number | null = null;
  let maxElevationM: number | null = null;
  let meanElevationM: number | null = null;
  let stdElevationM: number | null = null;

  if (validDemSamples > 0) {
    let minE = Number.POSITIVE_INFINITY;
    let maxE = Number.NEGATIVE_INFINITY;
    let sumE = 0;
    for (const e of elevs) {
      if (e < minE) minE = e;
      if (e > maxE) maxE = e;
      sumE += e;
    }
    meanElevationM = sumE / validDemSamples;
    minElevationM = minE;
    maxElevationM = maxE;
    let varSum = 0;
    for (const e of elevs) varSum += (e - meanElevationM) ** 2;
    stdElevationM = Math.sqrt(varSum / validDemSamples);
  }

  let meanSlopeDeg: number | null = null;
  let p95SlopeDeg: number | null = null;
  if (slopes.length > 0) {
    meanSlopeDeg = slopes.reduce((a, b) => a + b, 0) / slopes.length;
    const sorted = [...slopes].sort((a, b) => a - b);
    p95SlopeDeg = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)))];
  }

  let medianDiffractionLossDb: number | null = null;
  if (diffLosses.length > 0) {
    const sorted = [...diffLosses].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianDiffractionLossDb =
      sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
  }

  const losCoveragePct = validDemSamples > 0 && acnPos ? (losClearCount / validDemSamples) * 100 : null;

  return {
    regionId: region.id,
    areaKm2,
    totalInteriorSamples,
    validDemSamples,
    coverageCompletenessPct,
    minElevationM,
    meanElevationM,
    maxElevationM,
    stdElevationM,
    meanSlopeDeg,
    p95SlopeDeg,
    losCoveragePct,
    medianDiffractionLossDb,
    enclosedNodeCount: enclosedNodes.length,
    enclosedNodeIds: enclosedNodes.map((n) => n.nodeId),
    enclosedMeanSnrDb,
    bestRelayCoord,
  };
}

/**
 * Exports a drawn region polygon and its zonal statistics + best relay site as GeoJSON.
 */
export function exportRegionGeoJson(
  region: ToolboxRegionInput,
  stats: RegionZonalStats,
): string {
  const ring = region.points.map((p) => {
    const geo = cartesianToGeodetic(p.x, p.y);
    return [geo.lonDeg, geo.latDeg];
  });
  if (ring.length >= 3) ring.push(ring[0]);

  const features: Array<Record<string, unknown>> = [
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        regionId: region.id,
        color: region.color,
        areaKm2: Number(stats.areaKm2.toFixed(4)),
        coverageCompletenessPct: Number(stats.coverageCompletenessPct.toFixed(2)),
        minElevationM: stats.minElevationM,
        meanElevationM: stats.meanElevationM,
        maxElevationM: stats.maxElevationM,
        meanSlopeDeg: stats.meanSlopeDeg,
        p95SlopeDeg: stats.p95SlopeDeg,
        losCoveragePct: stats.losCoveragePct,
        medianDiffractionLossDb: stats.medianDiffractionLossDb,
        enclosedNodeCount: stats.enclosedNodeCount,
        enclosedMeanSnrDb: stats.enclosedMeanSnrDb,
      },
    },
  ];

  if (stats.bestRelayCoord) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [stats.bestRelayCoord.lonDeg, stats.bestRelayCoord.latDeg],
      },
      properties: {
        role: 'best_relay_site',
        regionId: region.id,
        elevationMslM: Number(stats.bestRelayCoord.elevationM.toFixed(2)),
        predictedSnrDb: Number(stats.bestRelayCoord.snrDb.toFixed(2)),
      },
    });
  }

  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

/**
 * M2 Capacity & Lock Parity Gate for Mode 4 "Add Node Here" / "Add Node at Bridge".
 */
export function canAddNodeFromToolbox(
  groundNodeCount: number,
  spatialLocked: boolean,
  isHistoricalInspecting: boolean,
): boolean {
  return (
    Number.isInteger(groundNodeCount) &&
    groundNodeCount >= 0 &&
    groundNodeCount < MAX_ACTIVE_GROUND_NODES &&
    !spatialLocked &&
    !isHistoricalInspecting
  );
}

/**
 * Authoritative Gate for Mode 2 "Apply as ACN Waypoints".
 */
export function canApplyTransectAsAcnWaypoints(
  waypointCount: number,
  spatialLocked: boolean,
  isHistoricalInspecting: boolean,
): boolean {
  return (
    Number.isInteger(waypointCount) &&
    waypointCount >= 3 &&
    waypointCount <= MAX_ACN_WAYPOINTS &&
    !spatialLocked &&
    !isHistoricalInspecting
  );
}

// ============================================================================
// PHASE B — Mode 3 (Site Probe Viewshed, Orbit Persistence, Altitude Sweep)
//         & Mode 4 (Joint Relay / Multi-Hop Bridge Finder)
// ============================================================================

export type ViewshedCellStatus = 0 | 1 | 2 | 3 | 4;
// 0 = OUT_OF_COV, 1 = CLEAR_06F1, 2 = DIFFRACTED, 3 = HARD_SHADOW, 4 = OBSTACLE_BLOCKED

export interface SiteProbeInput {
  readonly xM: number;
  readonly yM: number;
  readonly observerAglM: number;
  readonly radiusM: number;
  readonly targetMode: 'acn_alt' | 'ground_agl';
  readonly targetAglM?: number;
  readonly includeObstacles: boolean;
}

export interface HorizonMaskBin {
  readonly azimuthDeg: number;
  readonly horizonElevDeg: number;
  readonly horizonDistM: number;
  readonly peakMslM: number;
  readonly isCoverageComplete: boolean;
}

export interface SiteProbeViewshedResult {
  readonly siteXM: number;
  readonly siteYM: number;
  readonly siteLatDeg: number;
  readonly siteLonDeg: number;
  readonly siteElevationM: number;
  readonly observerMslM: number;
  readonly isSiteWithinCoverage: boolean;
  readonly radiusM: number;
  readonly stepM: number;
  readonly nAzimuths: number;
  readonly nRings: number;
  readonly targetMode: 'acn_alt' | 'ground_agl';
  readonly statusGrid: Uint8Array;
  readonly horizonMask: readonly HorizonMaskBin[];
  readonly acnAzimuthDeg: number | null;
  readonly acnElevationDeg: number | null;
  readonly clearPct: number;
  readonly diffractedPct: number;
  readonly shadowPct: number;
  readonly obstacleBlockedPct: number;
  readonly outOfCoveragePct: number;
}

export interface OrbitPersistenceResult {
  readonly valid: boolean;
  readonly sampleCount: number;
  readonly orbitLosPct: number;
  readonly peakDiffractionLossDb: number;
  readonly meanSnrDb: number | null;
  readonly longestShadowWindowS: number | null;
  readonly minClearanceM: number;
}

export type SweepTarget =
  | { readonly kind: 'probe'; readonly xM: number; readonly yM: number; readonly aglM: number }
  | { readonly kind: 'region'; readonly region: ToolboxRegionInput }
  | { readonly kind: 'nodes' };

export interface AltitudeSweepResult {
  readonly valid: boolean;
  readonly targetKind: SweepTarget['kind'];
  readonly targetCount: number;
  readonly altitudesM: readonly number[];
  readonly clearLosPct: readonly number[];
  readonly meanSnrDb: readonly (number | null)[];
  readonly minClearAltitudeM: number | null;
  readonly optimalSnrAltitudeM: number | null;
}

export interface BridgeEndpoint {
  readonly xM: number;
  readonly yM: number;
  readonly aglM: number;
  readonly label?: string;
}

export interface BridgeFinderResult {
  readonly valid: boolean;
  readonly endpointA: BridgeEndpoint;
  readonly endpointB: BridgeEndpoint;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number };
  readonly bottleneckSnrGrid: Float32Array;
  readonly validCandidateCount: number;
  readonly optimalBridge: {
    readonly xM: number;
    readonly yM: number;
    readonly latDeg: number;
    readonly lonDeg: number;
    readonly elevationM: number;
    readonly snrADb: number;
    readonly snrBDb: number;
    readonly bottleneckSnrDb: number;
    readonly bothLos: boolean;
  } | null;
}

/**
 * Mode 3: 360-degree polar horizon mask & slant-corrected curved-Earth viewshed.
 */
export function computeSiteProbeViewshed(
  ctx: ToolboxSimulationContext,
  input: SiteProbeInput,
): SiteProbeViewshedResult {
  const nAzimuths = 180;
  const radiusM = clamp(Number.isFinite(input.radiusM) ? input.radiusM : 24000, 5000, 60000);
  const stepM = Math.min(150, Math.max(100, radiusM / 200));
  const nRings = Math.max(1, Math.round(radiusM / stepM));
  const statusGrid = new Uint8Array(nAzimuths * nRings);
  const horizonMask: HorizonMaskBin[] = [];

  const siteDem = sampleDemSafe(ctx.terrainEngine, input.xM, input.yM);
  const siteGeo = cartesianToGeodetic(input.xM, input.yM);
  const observerMslM = siteDem.isWithinCoverage ? siteDem.elevationM + input.observerAglM : Number.NaN;

  let acnAzimuthDeg: number | null = null;
  let acnElevationDeg: number | null = null;
  if (ctx.acnPositionMslM && siteDem.isWithinCoverage) {
    const dxAcn = ctx.acnPositionMslM[0] - input.xM;
    const dyAcn = ctx.acnPositionMslM[1] - input.yM;
    const d2Acn = Math.hypot(dxAcn, dyAcn);
    acnAzimuthDeg = ((Math.atan2(dxAcn, dyAcn) * 180) / Math.PI + 360) % 360;
    const sg = ctx.terrainEngine.computeSlantGeometry(
      [input.xM, input.yM, observerMslM],
      ctx.acnPositionMslM,
      ctx.envConfig,
    );
    acnElevationDeg = d2Acn > 0 ? sg.elevationDeg : 90;
  }

  if (!siteDem.isWithinCoverage) {
    for (let k = 0; k < nAzimuths; k++) {
      horizonMask.push({
        azimuthDeg: k * 2,
        horizonElevDeg: 0,
        horizonDistM: 0,
        peakMslM: Number.NaN,
        isCoverageComplete: false,
      });
    }
    return {
      siteXM: input.xM,
      siteYM: input.yM,
      siteLatDeg: siteGeo.latDeg,
      siteLonDeg: siteGeo.lonDeg,
      siteElevationM: Number.NaN,
      observerMslM: Number.NaN,
      isSiteWithinCoverage: false,
      radiusM,
      stepM,
      nAzimuths,
      nRings,
      targetMode: input.targetMode,
      statusGrid,
      horizonMask,
      acnAzimuthDeg: null,
      acnElevationDeg: null,
      clearPct: 0,
      diffractedPct: 0,
      shadowPct: 0,
      obstacleBlockedPct: 0,
      outOfCoveragePct: 100,
    };
  }

  const rEff = ctx.envConfig.effectiveEarthRadiusM;
  const wavelength = ctx.rfConfig.wavelengthM;
  const acnAlt = ctx.acnPositionMslM?.[2] ?? 5000;
  const targetAglM = input.targetAglM ?? 2.0;
  const obstacles = input.includeObstacles ? ctx.terrainEngine.obstacleField.all : [];
  const hasObstacles = obstacles.length > 0;
  const obsPos: Position3D = [input.xM, input.yM, observerMslM];

  // Precompute bounding radius per obstacle to cull rays quickly
  const obsCull = obstacles.map((o) => {
    const halfSpan = o.shape === 'cone' ? o.radiusM : Math.hypot(o.widthM * 0.5, o.depthM * 0.5);
    const dx = o.xM - input.xM;
    const dy = o.yM - input.yM;
    return { dx, dy, dist: Math.hypot(dx, dy), boundR: halfSpan + 100 };
  });

  const counts = [0, 0, 0, 0, 0];
  const crestD = new Float64Array(32);
  const crestH = new Float64Array(32);

  for (let azIdx = 0; azIdx < nAzimuths; azIdx++) {
    const azDeg = azIdx * 2;
    const azRad = (azDeg * Math.PI) / 180;
    const ux = Math.sin(azRad);
    const uy = Math.cos(azRad);

    let rayHasObs = false;
    if (hasObstacles) {
      for (let oi = 0; oi < obsCull.length; oi++) {
        const oc = obsCull[oi];
        const proj = oc.dx * ux + oc.dy * uy;
        if (proj + oc.boundR < 0 || proj - oc.boundR > radiusM) continue;
        const perp = Math.abs(oc.dx * uy - oc.dy * ux);
        if (perp <= oc.boundR) {
          rayHasObs = true;
          break;
        }
      }
    }

    let stackLen = 0;
    let maxSlope = Number.NEGATIVE_INFINITY;
    let horizonDistM = 0;
    let peakMslM = siteDem.elevationM;
    let rayCovComplete = true;
    let rayLostCov = false;

    for (let rIdx = 0; rIdx < nRings; rIdx++) {
      const dh = (rIdx + 1) * stepM;
      const tx = input.xM + dh * ux;
      const ty = input.yM + dh * uy;

      if (rayLostCov) {
        statusGrid[azIdx * nRings + rIdx] = 0;
        counts[0]++;
        continue;
      }

      const tgtDem = sampleDemSafe(ctx.terrainEngine, tx, ty);
      if (!tgtDem.isWithinCoverage) {
        rayCovComplete = false;
        rayLostCov = true;
        statusGrid[azIdx * nRings + rIdx] = 0;
        counts[0]++;
        continue;
      }

      const zTgt = input.targetMode === 'acn_alt' ? acnAlt : tgtDem.elevationM + targetAglM;
      let cellStatus: ViewshedCellStatus = 1;

      if (stackLen > 0) {
        const dz = zTgt - observerMslM;
        const d3D = Math.hypot(dh, dz);
        const gamma = d3D / dh;
        const mTgt = dz / dh - dh / (2 * rEff);

        if (mTgt <= maxSlope) {
          cellStatus = 3;
        } else {
          let minRatio = Number.POSITIVE_INFINITY;
          for (let ci = 0; ci < stackLen; ci++) {
            const dc = crestD[ci];
            const hc = crestH[ci];
            const frac = dc / dh;
            const d1 = gamma * dc;
            const d2 = gamma * (dh - dc);
            const bulge = (d1 * d2) / (2 * rEff);
            const hLos = observerMslM + frac * dz;
            const hClear = hLos - (hc + bulge);
            const r1 = Math.sqrt((wavelength * d1 * d2) / d3D);
            const ratio = r1 > 0 ? hClear / r1 : hClear >= 0 ? 1 : -1;
            if (ratio < minRatio) minRatio = ratio;
          }
          if (minRatio <= 0) cellStatus = 3;
          else if (minRatio < 0.6) cellStatus = 2;
          else cellStatus = 1;
        }
      }

      if (rayHasObs) {
        const hits = ctx.terrainEngine.obstacleField.intersectRay(
          obsPos,
          [tx, ty, zTgt],
          (x, y, fraction) => {
            const d3D = Math.hypot(dh, zTgt - observerMslM);
            const d1 = d3D * fraction;
            const d2 = d3D - d1;
            return ctx.terrainEngine.getElevation(x, y) + TerrainEngine.computeEarthBulge(d1, d2, rEff);
          },
        );
        if (hits.length > 0) cellStatus = 4;
      }

      statusGrid[azIdx * nRings + rIdx] = cellStatus;
      counts[cellStatus]++;

      // Update horizon mask and upper convex crest stack with (dh, tgtDem.elevationM)
      const mk = (tgtDem.elevationM - observerMslM) / dh - dh / (2 * rEff);
      if (mk > maxSlope) {
        maxSlope = mk;
        horizonDistM = dh;
        peakMslM = tgtDem.elevationM;
      }

      // Upper convex hull maintenance over (d, h)
      while (stackLen >= 2) {
        const dA = crestD[stackLen - 2];
        const hA = crestH[stackLen - 2];
        const dB = crestD[stackLen - 1];
        const hB = crestH[stackLen - 1];
        const slopeAB = (hB - hA) / (dB - dA);
        const slopeAC = (tgtDem.elevationM - hA) / (dh - dA);
        if (slopeAB <= slopeAC) {
          stackLen--;
        } else {
          break;
        }
      }
      if (stackLen < 16) {
        crestD[stackLen] = dh;
        crestH[stackLen] = tgtDem.elevationM;
        stackLen++;
      } else {
        // Keep last 15 hull crests + new crest
        for (let k = 1; k < 16; k++) {
          crestD[k - 1] = crestD[k];
          crestH[k - 1] = crestH[k];
        }
        crestD[15] = dh;
        crestH[15] = tgtDem.elevationM;
      }
    }

    const horizonElevDeg = Number.isFinite(maxSlope) ? (Math.atan(maxSlope) * 180) / Math.PI : 0;
    horizonMask.push({
      azimuthDeg: azDeg,
      horizonElevDeg,
      horizonDistM,
      peakMslM,
      isCoverageComplete: rayCovComplete,
    });
  }

  const totalCells = Math.max(1, nAzimuths * nRings);
  return {
    siteXM: input.xM,
    siteYM: input.yM,
    siteLatDeg: siteGeo.latDeg,
    siteLonDeg: siteGeo.lonDeg,
    siteElevationM: siteDem.elevationM,
    observerMslM,
    isSiteWithinCoverage: true,
    radiusM,
    stepM,
    nAzimuths,
    nRings,
    targetMode: input.targetMode,
    statusGrid,
    horizonMask,
    acnAzimuthDeg,
    acnElevationDeg,
    clearPct: (counts[1] / totalCells) * 100,
    diffractedPct: (counts[2] / totalCells) * 100,
    shadowPct: (counts[3] / totalCells) * 100,
    obstacleBlockedPct: (counts[4] / totalCells) * 100,
    outOfCoveragePct: (counts[0] / totalCells) * 100,
  };
}

function buildAcnFlightConfigFromTelemetry(cfg: TrajectoryConfigTelemetry): ACNFlightConfig {
  return new ACNFlightConfig({
    trajectoryMode: cfg.trajectory_mode,
    centerXm: cfg.center_x_m,
    centerYm: cfg.center_y_m,
    loiterRadiusAM: cfg.orbit_a_m > 0 ? cfg.orbit_a_m : 20000,
    loiterRadiusBM: cfg.orbit_b_m > 0 ? cfg.orbit_b_m : 10000,
    loiterRotationDeg: cfg.orbit_rotation_deg ?? 0,
    loiterSpeedMps: cfg.loiter_speed_mps ?? 60,
    altitudeMslM: cfg.acn_altitude_m ?? 5000,
    altitudeMode: cfg.altitude_mode ?? 'fix',
    targetAglM: cfg.target_agl_m ?? 1500,
    maxClimbRateMps: cfg.max_climb_rate_mps ?? 10,
    maxDescentRateMps: cfg.max_descent_rate_mps ?? 8,
    waypoints: (cfg.waypoints ?? []).map((w) => ({
      xM: w.x_m,
      yM: w.y_m,
      ...(w.z_m !== undefined ? { zM: w.z_m } : {}),
    })),
  });
}

/**
 * Mode 3: Evaluates LOS persistence and longest shadow duration across 72 arc-length ACN orbit samples.
 */
export function computeOrbitPersistence(
  ctx: ToolboxSimulationContext,
  siteX: number,
  siteY: number,
  observerAglM: number,
  includeObstacles: boolean,
  nodeType: 'soldier' | 'mcp',
): OrbitPersistenceResult {
  const siteDem = sampleDemSafe(ctx.terrainEngine, siteX, siteY);
  if (!ctx.trajectoryConfig || !siteDem.isWithinCoverage) {
    return {
      valid: false,
      sampleCount: 0,
      orbitLosPct: 0,
      peakDiffractionLossDb: 0,
      meanSnrDb: null,
      longestShadowWindowS: null,
      minClearanceM: 0,
    };
  }

  const flightCfg = buildAcnFlightConfigFromTelemetry(ctx.trajectoryConfig);
  const traj = createACNTrajectory(flightCfg, undefined, (x, y) => ctx.terrainEngine.getElevation(x, y));
  const sampleCount = 72;
  const pts = traj.getPathPoints3D(sampleCount);
  const sitePos: Position3D = [siteX, siteY, siteDem.elevationM + observerAglM];
  const linkEngine = new LinkBudgetEngine();

  let losCount = 0;
  let peakDiff = 0;
  let minClearance = Number.POSITIVE_INFINITY;
  let snrSum = 0;
  let snrCount = 0;
  const blockedFlags = new Uint8Array(sampleCount);

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const acnPos: Position3D = [p[0], p[1], p[2]];
    const obs = ctx.terrainEngine.evaluateTerrainObstruction(
      sitePos,
      acnPos,
      ctx.rfConfig,
      ctx.envConfig,
      150.0,
    );
    const effBlocked = includeObstacles ? obs.obstacleBlocked : false;
    const isClear = obs.isCoverageComplete !== false && obs.isLos && !effBlocked;
    if (isClear) {
      losCount++;
    } else {
      blockedFlags[i] = 1;
    }
    if (Number.isFinite(obs.diffractionLossDb) && obs.diffractionLossDb > peakDiff) {
      peakDiff = obs.diffractionLossDb;
    }
    if (Number.isFinite(obs.minClearanceM) && obs.minClearanceM < minClearance) {
      minClearance = obs.minClearanceM;
    }
    if (obs.isCoverageComplete !== false) {
      const d3D = Math.hypot(acnPos[0] - sitePos[0], acnPos[1] - sitePos[1], acnPos[2] - sitePos[2]);
      if (d3D > 1e-3) {
        const st = linkEngine.evaluateLink(
          nodeType,
          d3D,
          obs.diffractionLossDb,
          ctx.rfConfig,
          ctx.envConfig,
          effBlocked,
        );
        snrSum += st.snrDb;
        snrCount++;
      }
    }
  }

  // Compute longest consecutive blocked run around closed orbit loop
  let maxConsec = 0;
  if (losCount === 0) {
    maxConsec = sampleCount;
  } else if (losCount < sampleCount) {
    let run = 0;
    for (let i = 0; i < sampleCount * 2; i++) {
      if (blockedFlags[i % sampleCount]) {
        run++;
        if (run > maxConsec) maxConsec = run;
      } else {
        run = 0;
      }
    }
    maxConsec = Math.min(sampleCount, maxConsec);
  }

  const speedMps = flightCfg.loiterSpeedMps;
  const totalLengthM = (traj as { totalLengthM?: number }).totalLengthM ?? 0;
  const longestShadowWindowS =
    speedMps > 0.01 && totalLengthM > 0
      ? maxConsec * (totalLengthM / (sampleCount * speedMps))
      : null;

  return {
    valid: true,
    sampleCount,
    orbitLosPct: (losCount / sampleCount) * 100,
    peakDiffractionLossDb: peakDiff,
    meanSnrDb: snrCount > 0 ? snrSum / snrCount : null,
    longestShadowWindowS,
    minClearanceM: Number.isFinite(minClearance) ? minClearance : 0,
  };
}

/**
 * Mode 3: UAV altitude optimization sweep (2500m -> 9000m step 500m by default).
 * Pre-samples terrain horizontal profile once per target point for O(A * N_samples) speed.
 */
export function computeAltitudeSweep(
  ctx: ToolboxSimulationContext,
  target: SweepTarget,
  opts: {
    readonly minAltM?: number;
    readonly maxAltM?: number;
    readonly stepM?: number;
    readonly includeObstacles: boolean;
    readonly nodeType: 'soldier' | 'mcp';
  },
): AltitudeSweepResult {
  const minAltM = opts.minAltM ?? 2500;
  const maxAltM = opts.maxAltM ?? 9000;
  const stepM = opts.stepM ?? 500;
  const altitudesM: number[] = [];
  for (let a = minAltM; a <= maxAltM + 1e-6; a += stepM) {
    altitudesM.push(a);
  }

  const groundPts: Array<{ xM: number; yM: number; zM: number }> = [];
  if (target.kind === 'probe') {
    const dem = sampleDemSafe(ctx.terrainEngine, target.xM, target.yM);
    if (dem.isWithinCoverage) {
      groundPts.push({ xM: target.xM, yM: target.yM, zM: dem.elevationM + target.aglM });
    }
  } else if (target.kind === 'region') {
    const pts = target.region.points;
    if (pts.length >= 3) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const gridN = 8;
      for (let r = 0; r < gridN && groundPts.length < 16; r++) {
        const yM = minY + ((r + 0.5) / gridN) * Math.max(1, maxY - minY);
        for (let c = 0; c < gridN && groundPts.length < 16; c++) {
          const xM = minX + ((c + 0.5) / gridN) * Math.max(1, maxX - minX);
          if (!pointInPolygon(xM, yM, pts)) continue;
          const dem = sampleDemSafe(ctx.terrainEngine, xM, yM);
          if (dem.isWithinCoverage) groundPts.push({ xM, yM, zM: dem.elevationM + 2.0 });
        }
      }
    }
  } else {
    for (const n of ctx.groundNodes) {
      const dem = sampleDemSafe(ctx.terrainEngine, n.xM, n.yM);
      if (dem.isWithinCoverage) groundPts.push({ xM: n.xM, yM: n.yM, zM: dem.elevationM + n.aglM });
    }
  }

  const acnX = ctx.acnPositionMslM?.[0] ?? 0;
  const acnY = ctx.acnPositionMslM?.[1] ?? 0;
  const acnDemOk = ctx.terrainEngine.terrainMode !== 'real' || ctx.terrainEngine.isWithinDemCoverage(acnX, acnY);

  if (groundPts.length === 0 || !acnDemOk) {
    return {
      valid: false,
      targetKind: target.kind,
      targetCount: groundPts.length,
      altitudesM,
      clearLosPct: altitudesM.map(() => 0),
      meanSnrDb: altitudesM.map(() => null),
      minClearAltitudeM: null,
      optimalSnrAltitudeM: null,
    };
  }

  // Pre-sample horizontal terrain elevations once per target point
  const preSampled = groundPts.map((gp) => {
    const dx = acnX - gp.xM;
    const dy = acnY - gp.yM;
    const d2D = Math.hypot(dx, dy);
    const nSteps = Math.max(2, Math.min(200, Math.ceil(d2D / 150)));
    const fracs: number[] = [];
    const hT: number[] = [];
    let covOk = true;
    for (let i = 1; i < nSteps; i++) {
      const f = i / nSteps;
      const sx = gp.xM + f * dx;
      const sy = gp.yM + f * dy;
      const d = sampleDemSafe(ctx.terrainEngine, sx, sy);
      if (!d.isWithinCoverage) {
        covOk = false;
        break;
      }
      fracs.push(f);
      hT.push(d.elevationM);
    }
    return { gp, dx, dy, d2D, fracs, hT, covOk };
  });

  const wavelength = ctx.rfConfig.wavelengthM;
  const rEff = ctx.envConfig.effectiveEarthRadiusM;
  const linkEngine = new LinkBudgetEngine();
  const hasObstacles = opts.includeObstacles && ctx.terrainEngine.obstacleField.all.length > 0;

  const clearLosPct: number[] = [];
  const meanSnrDb: (number | null)[] = [];
  let minClearAltitudeM: number | null = null;
  let optimalSnrAltitudeM: number | null = null;
  let bestMeanSnr = Number.NEGATIVE_INFINITY;

  for (const altM of altitudesM) {
    let clearCount = 0;
    let snrSum = 0;
    let snrCount = 0;

    for (const item of preSampled) {
      if (!item.covOk) continue;
      const dz = altM - item.gp.zM;
      const d3D = Math.hypot(item.d2D, dz);

      let minRatio = Number.POSITIVE_INFINITY;
      let minClearanceM = 0;
      let critD1 = d3D * 0.5;
      let critD2 = d3D * 0.5;

      for (let i = 0; i < item.fracs.length; i++) {
        const f = item.fracs[i];
        const d1 = f * d3D;
        const d2 = d3D - d1;
        const hEff = item.hT[i] + (d1 * d2) / (2 * rEff);
        const hLos = item.gp.zM + f * dz;
        const hClear = hLos - hEff;
        const r1 = d3D > 0 ? Math.sqrt((wavelength * d1 * d2) / d3D) : 0;
        const ratio = r1 > 0 ? hClear / r1 : hClear >= 0 ? 1 : -1;
        if (ratio < minRatio) {
          minRatio = ratio;
          minClearanceM = hClear;
          critD1 = d1;
          critD2 = d2;
        }
      }

      let diffLossDb = 0;
      if (minRatio >= 0.6) {
        diffLossDb = 0;
      } else if (minRatio > 0) {
        diffLossDb = 6.0 * (1.0 - minRatio / 0.6);
      } else {
        const nu = -minClearanceM * Math.sqrt((2.0 / wavelength) * (1.0 / critD1 + 1.0 / critD2));
        const arg = Math.sqrt(Math.pow(nu - 0.1, 2) + 1.0) + (nu - 0.1);
        diffLossDb = 6.9 + 20.0 * Math.log10(Math.max(arg, 1e-9)) + 12.0;
      }

      let obsBlocked = false;
      if (hasObstacles) {
        const hits = ctx.terrainEngine.obstacleField.intersectRay(
          [item.gp.xM, item.gp.yM, item.gp.zM],
          [acnX, acnY, altM],
          (x, y, fraction) => {
            const d1 = d3D * fraction;
            const d2 = d3D - d1;
            return ctx.terrainEngine.getElevation(x, y) + TerrainEngine.computeEarthBulge(d1, d2, rEff);
          },
        );
        obsBlocked = hits.length > 0;
      }

      if (minRatio >= 0.6 && !obsBlocked) clearCount++;
      if (d3D > 1e-3) {
        const st = linkEngine.evaluateLink(
          opts.nodeType,
          d3D,
          diffLossDb,
          ctx.rfConfig,
          ctx.envConfig,
          obsBlocked,
        );
        snrSum += st.snrDb;
        snrCount++;
      }
    }

    const pct = (clearCount / preSampled.length) * 100;
    const meanSnr = snrCount > 0 ? snrSum / snrCount : null;
    clearLosPct.push(pct);
    meanSnrDb.push(meanSnr);

    if (minClearAltitudeM === null && pct >= 99.99) {
      minClearAltitudeM = altM;
    }
    if (meanSnr !== null && meanSnr > bestMeanSnr) {
      bestMeanSnr = meanSnr;
      optimalSnrAltitudeM = altM;
    }
  }

  return {
    valid: true,
    targetKind: target.kind,
    targetCount: preSampled.length,
    altitudesM,
    clearLosPct,
    meanSnrDb,
    minClearAltitudeM,
    optimalSnrAltitudeM,
  };
}

function coarseGeometricLos(
  engine: TerrainEngine,
  posA: Position3D,
  posB: Position3D,
  rEff: number,
): boolean {
  const dx = posB[0] - posA[0];
  const dy = posB[1] - posA[1];
  const dz = posB[2] - posA[2];
  const d3D = Math.hypot(dx, dy, dz);
  if (d3D <= 1e-3) return true;
  const step = 250;
  for (let s = step; s < d3D; s += step) {
    const f = s / d3D;
    const d1 = s;
    const d2 = d3D - s;
    const dem = sampleDemSafe(engine, posA[0] + f * dx, posA[1] + f * dy);
    if (!dem.isWithinCoverage) return false;
    const hEff = dem.elevationM + TerrainEngine.computeEarthBulge(d1, d2, rEff);
    const hLos = posA[2] + f * dz;
    if (hLos <= hEff) return false;
  }
  return true;
}

/**
 * Mode 4: Joint Relay / Multi-Hop Bridge Finder across a 24x24 grid with 2-stage prune.
 */
export function findJointRelayBridge(
  ctx: ToolboxSimulationContext,
  endpointA: BridgeEndpoint,
  endpointB: BridgeEndpoint,
  region: ToolboxRegionInput | null,
  opts: {
    readonly relayAglM: number;
    readonly includeObstacles: boolean;
    readonly nodeType: 'soldier' | 'mcp';
  },
): BridgeFinderResult {
  const gridWidth = 24;
  const gridHeight = 24;
  const bottleneckSnrGrid = new Float32Array(gridWidth * gridHeight);
  bottleneckSnrGrid.fill(Number.NaN);

  const demA = sampleDemSafe(ctx.terrainEngine, endpointA.xM, endpointA.yM);
  const demB = sampleDemSafe(ctx.terrainEngine, endpointB.xM, endpointB.yM);

  const useRegion = region !== null && region.points.length >= 3;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  if (useRegion) {
    for (const p of region.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  } else {
    const dAB = Math.hypot(endpointB.xM - endpointA.xM, endpointB.yM - endpointA.yM);
    const halfPad = Math.max(4000, 0.175 * dAB);
    minX = Math.min(endpointA.xM, endpointB.xM) - halfPad;
    maxX = Math.max(endpointA.xM, endpointB.xM) + halfPad;
    minY = Math.min(endpointA.yM, endpointB.yM) - halfPad;
    maxY = Math.max(endpointA.yM, endpointB.yM) + halfPad;
  }

  const bounds = { minX, maxX, minY, maxY };

  if (!demA.isWithinCoverage || !demB.isWithinCoverage) {
    return {
      valid: false,
      endpointA,
      endpointB,
      gridWidth,
      gridHeight,
      bounds,
      bottleneckSnrGrid,
      validCandidateCount: 0,
      optimalBridge: null,
    };
  }

  const posA: Position3D = [endpointA.xM, endpointA.yM, demA.elevationM + endpointA.aglM];
  const posB: Position3D = [endpointB.xM, endpointB.yM, demB.elevationM + endpointB.aglM];
  const rEff = ctx.envConfig.effectiveEarthRadiusM;
  const linkEngine = new LinkBudgetEngine();

  let validCandidateCount = 0;
  let optimalBridge: BridgeFinderResult['optimalBridge'] = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let r = 0; r < gridHeight; r++) {
    // Row 0 is North (maxY) to match raster convention
    const yM = maxY - ((r + 0.5) / gridHeight) * (maxY - minY);
    for (let c = 0; c < gridWidth; c++) {
      const xM = minX + ((c + 0.5) / gridWidth) * (maxX - minX);
      if (useRegion && !pointInPolygon(xM, yM, region.points)) continue;

      const demR = sampleDemSafe(ctx.terrainEngine, xM, yM);
      if (!demR.isWithinCoverage) continue;

      const posR: Position3D = [xM, yM, demR.elevationM + opts.relayAglM];
      const idx = r * gridWidth + c;

      // Stage 1: Coarse geometric LOS prune
      if (!coarseGeometricLos(ctx.terrainEngine, posA, posR, rEff) || !coarseGeometricLos(ctx.terrainEngine, posR, posB, rEff)) {
        bottleneckSnrGrid[idx] = -999; // Masked shadowed candidate cell
        continue;
      }

      // Stage 2: Full evaluateTerrainObstruction + LinkBudgetEngine
      const obsA = ctx.terrainEngine.evaluateTerrainObstruction(posA, posR, ctx.rfConfig, ctx.envConfig, 150.0);
      const obsB = ctx.terrainEngine.evaluateTerrainObstruction(posR, posB, ctx.rfConfig, ctx.envConfig, 150.0);
      const blockA = opts.includeObstacles ? obsA.obstacleBlocked : false;
      const blockB = opts.includeObstacles ? obsB.obstacleBlocked : false;
      if (obsA.isCoverageComplete === false || obsB.isCoverageComplete === false) continue;

      const d3A = Math.hypot(posR[0] - posA[0], posR[1] - posA[1], posR[2] - posA[2]);
      const d3B = Math.hypot(posB[0] - posR[0], posB[1] - posR[1], posB[2] - posR[2]);
      if (d3A <= 1e-3 || d3B <= 1e-3) continue;

      const stA = linkEngine.evaluateLink(opts.nodeType, d3A, obsA.diffractionLossDb, ctx.rfConfig, ctx.envConfig, blockA);
      const stB = linkEngine.evaluateLink(opts.nodeType, d3B, obsB.diffractionLossDb, ctx.rfConfig, ctx.envConfig, blockB);
      const bothLos = obsA.isLos && !blockA && obsB.isLos && !blockB;
      const bottleneckSnrDb = bothLos ? Math.min(stA.snrDb, stB.snrDb) : -999;

      bottleneckSnrGrid[idx] = bottleneckSnrDb;
      if (bothLos) {
        validCandidateCount++;
        if (bottleneckSnrDb > bestScore) {
          bestScore = bottleneckSnrDb;
          const geo = cartesianToGeodetic(xM, yM);
          optimalBridge = {
            xM,
            yM,
            latDeg: geo.latDeg,
            lonDeg: geo.lonDeg,
            elevationM: demR.elevationM,
            snrADb: stA.snrDb,
            snrBDb: stB.snrDb,
            bottleneckSnrDb,
            bothLos: true,
          };
        }
      }
    }
  }

  return {
    valid: true,
    endpointA,
    endpointB,
    gridWidth,
    gridHeight,
    bounds,
    bottleneckSnrGrid,
    validCandidateCount,
    optimalBridge,
  };
}

