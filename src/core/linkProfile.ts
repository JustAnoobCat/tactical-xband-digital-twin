import type { Position3D, TerrainObstruction } from './terrain';

/** One worker-generated sample along the ground terminal to ACN link. All elevations and distances are metres. */
export interface LinkProfileSample {
  /** Horizontal plan-view ground distance from the ground terminal. */
  readonly horizontalGroundDistanceM: number;
  /** 3D distance along the link ray from the ground terminal. */
  readonly slantDistanceM: number;
  readonly terrainElevationMslM: number;
  /** Terrain MSL plus the same effective-Earth bulge used by terrain obstruction evaluation. */
  readonly effectiveTerrainElevationMslM: number;
  readonly losElevationMslM: number;
  readonly fresnelRadiusM: number;
  readonly lowerFresnelElevationMslM: number;
  readonly upperFresnelElevationMslM: number;
  /** Signed LOS-to-effective-terrain clearance at this visualization sample. */
  readonly effectiveTerrainClearanceM: number;
}

/** Obstacle hit interval projected from the physics engine's 3D-ray fractions. */
export interface LinkProfileObstacleInterval {
  readonly obstacleId: string;
  readonly entryFraction: number;
  readonly exitFraction: number;
  readonly entryHorizontalDistanceM: number;
  readonly exitHorizontalDistanceM: number;
  readonly entrySlantDistanceM: number;
  readonly exitSlantDistanceM: number;
  readonly penetrationM: number;
}

/** Typed profile contract. Coordinates use local Cartesian x/y metres and absolute MSL z metres. */
export interface LinkProfile {
  readonly selectedGroundNodeId: number;
  readonly nodeName: string;
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly groundNodePositionMslM: Position3D;
  readonly acnPositionMslM: Position3D;
  readonly horizontalGroundDistanceM: number;
  readonly slantDistanceM: number;
  /** Existing worker profile uses 0.6 F1; this reports that exact existing factor. */
  readonly fresnelFraction: number;
  /** Authoritative result from TerrainEngine.evaluateTerrainObstruction(). */
  readonly terrainIsLos: boolean;
  readonly terrainMinimumClearanceM: number;
  readonly terrainCriticalFresnelRadiusM: number;
  readonly diffractionLossDb: number;
  /** Independent screening result from ObstacleField.intersectRay(). */
  readonly obstacleBlocked: boolean;
  readonly obstacleIntervals: readonly LinkProfileObstacleInterval[];
  readonly samples: readonly LinkProfileSample[];
  /** False only when profile inputs are numerically invalid; no sample is emitted in that case. */
  readonly valid: boolean;
}

export interface BuildLinkProfileInput {
  readonly selectedGroundNodeId: number;
  readonly nodeName: string;
  readonly frameIndex: number;
  readonly simulationTimeS: number;
  readonly groundNodePositionMslM: Position3D;
  readonly acnPositionMslM: Position3D;
  readonly wavelengthM: number;
  readonly effectiveEarthRadiusM: number;
  readonly fresnelFraction?: number;
  readonly sampleCount: number;
  readonly obstruction: TerrainObstruction;
  readonly getTerrainElevationMslM: (xM: number, yM: number) => number;
  readonly computeEarthBulgeM: (d1M: number, d2M: number, radiusM: number) => number;
}

const finitePosition = (p: Position3D): boolean => p.length === 3 && p.every(Number.isFinite);

/**
 * Builds display geometry from worker-owned terrain/obstruction inputs. Propagation remains based on slant distance;
 * horizontal distance is only the profile's display coordinate.
 */
export function buildLinkProfile(input: BuildLinkProfileInput): LinkProfile {
  const fraction = input.fresnelFraction ?? 0.6;
  const node = input.groundNodePositionMslM;
  const acn = input.acnPositionMslM;
  const dx = acn[0] - node[0], dy = acn[1] - node[1], dz = acn[2] - node[2];
  const horizontalDistanceM = Math.hypot(dx, dy);
  const slantDistanceM = Math.hypot(horizontalDistanceM, dz);
  let valid = finitePosition(node) && finitePosition(acn) &&
    Number.isFinite(input.frameIndex) && Number.isFinite(input.simulationTimeS) &&
    Number.isFinite(input.wavelengthM) && input.wavelengthM > 0 &&
    Number.isFinite(input.effectiveEarthRadiusM) && input.effectiveEarthRadiusM > 0 &&
    Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 &&
    Number.isInteger(input.sampleCount) && input.sampleCount >= 2 &&
    Number.isFinite(horizontalDistanceM) && Number.isFinite(slantDistanceM) &&
    Number.isFinite(input.obstruction.minClearanceM) &&
    Number.isFinite(input.obstruction.fresnelRadiusM) &&
    Number.isFinite(input.obstruction.diffractionLossDb) &&
    input.obstruction.obstacleIntersections.every(hit => typeof hit.obstacleId === 'string' && hit.obstacleId.length > 0 &&
      Number.isFinite(hit.entryFraction) && Number.isFinite(hit.exitFraction) && hit.entryFraction >= 0 &&
      hit.exitFraction >= hit.entryFraction && hit.exitFraction <= 1 && Number.isFinite(hit.penetrationM));

  const samples: LinkProfileSample[] = [];
  if (valid) {
    try {
      for (let i = 0; i < input.sampleCount; i++) {
        const along = i / (input.sampleCount - 1);
        const d1M = along * slantDistanceM;
        const d2M = slantDistanceM - d1M;
        const xM = node[0] + along * dx;
        const yM = node[1] + along * dy;
        const terrainMslM = input.getTerrainElevationMslM(xM, yM);
        const bulgeM = slantDistanceM > 0
          ? input.computeEarthBulgeM(d1M, d2M, input.effectiveEarthRadiusM)
          : 0;
        const effectiveTerrainMslM = terrainMslM + bulgeM;
        const losMslM = node[2] + along * dz;
        const fresnelRadiusM = slantDistanceM > 0
          ? Math.sqrt(Math.max(0, input.wavelengthM * d1M * d2M / slantDistanceM))
          : 0;
        const offsetM = fraction * fresnelRadiusM;
        const values = [terrainMslM, effectiveTerrainMslM, losMslM, fresnelRadiusM, offsetM];
        if (!values.every(Number.isFinite)) { valid = false; break; }
        samples.push({
          horizontalGroundDistanceM: along * horizontalDistanceM,
          slantDistanceM: d1M,
          terrainElevationMslM: terrainMslM,
          effectiveTerrainElevationMslM: effectiveTerrainMslM,
          losElevationMslM: losMslM,
          fresnelRadiusM,
          lowerFresnelElevationMslM: losMslM - offsetM,
          upperFresnelElevationMslM: losMslM + offsetM,
          effectiveTerrainClearanceM: losMslM - effectiveTerrainMslM,
        });
      }
    } catch {
      valid = false;
    }
  }
  if (!valid) samples.length = 0;
  const intervals: LinkProfileObstacleInterval[] = valid ? input.obstruction.obstacleIntersections.map(hit => ({
    obstacleId: hit.obstacleId,
    entryFraction: hit.entryFraction,
    exitFraction: hit.exitFraction,
    entryHorizontalDistanceM: hit.entryFraction * horizontalDistanceM,
    exitHorizontalDistanceM: hit.exitFraction * horizontalDistanceM,
    entrySlantDistanceM: hit.entryFraction * slantDistanceM,
    exitSlantDistanceM: hit.exitFraction * slantDistanceM,
    penetrationM: hit.penetrationM,
  })) : [];

  return {
    selectedGroundNodeId: Number.isInteger(input.selectedGroundNodeId) ? input.selectedGroundNodeId : -1,
    nodeName: typeof input.nodeName === 'string' ? input.nodeName : '',
    frameIndex: Number.isFinite(input.frameIndex) ? input.frameIndex : 0,
    simulationTimeS: Number.isFinite(input.simulationTimeS) ? input.simulationTimeS : 0,
    groundNodePositionMslM: finitePosition(node) ? [...node] as unknown as Position3D : [0, 0, 0],
    acnPositionMslM: finitePosition(acn) ? [...acn] as unknown as Position3D : [0, 0, 0],
    horizontalGroundDistanceM: Number.isFinite(horizontalDistanceM) ? horizontalDistanceM : 0,
    slantDistanceM: Number.isFinite(slantDistanceM) ? slantDistanceM : 0,
    fresnelFraction: Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 ? fraction : 0.6,
    terrainIsLos: input.obstruction.isLos === true,
    terrainMinimumClearanceM: Number.isFinite(input.obstruction.minClearanceM) ? input.obstruction.minClearanceM : 0,
    terrainCriticalFresnelRadiusM: Number.isFinite(input.obstruction.fresnelRadiusM) ? input.obstruction.fresnelRadiusM : 0,
    diffractionLossDb: Number.isFinite(input.obstruction.diffractionLossDb) ? input.obstruction.diffractionLossDb : 0,
    obstacleBlocked: input.obstruction.obstacleBlocked === true,
    obstacleIntervals: intervals,
    samples,
    valid,
  };
}
