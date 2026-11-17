/**
 * src/core/cadObstacleSlicerEngine.ts
 *
 * Excalidraw / CAD-Grade Interactive Barrier Extruder & Real-Time 3D Link-Slice Previewer.
 *
 * Provides:
 * 1. 2D exact parametric line segment intersection against ground node-to-ACN link vectors.
 * 2. 15° CAD angle increment snapping.
 * 3. 3D Line-of-Sight ray altitude, Earth curvature bulge, required blocking height,
 *    and ITU-R P.526 knife-edge diffraction loss with material absorption caps.
 * 4. Automatic perpendicular link slicer barrier generator.
 */

import {
  DEFAULT_K_FACTOR,
  DEFAULT_TRUE_EARTH_RADIUS_M,
  DEFAULT_R_EFF_M,
  DEFAULT_X_BAND_FREQ_HZ,
  DEFAULT_X_BAND_WAVELENGTH_M,
  SPEED_OF_LIGHT_M_S,
  computeEarthBulgeM,
  computeFirstFresnelRadiusM,
  computeKnifeEdgeDiffractionLossDb,
  computeBearingDeg,
} from './rfPropagationMath';

export const DEFAULT_EARTH_RADIUS_M = DEFAULT_TRUE_EARTH_RADIUS_M;
export const X_BAND_FREQ_HZ = DEFAULT_X_BAND_FREQ_HZ;
export const SPEED_OF_LIGHT_MPS = SPEED_OF_LIGHT_M_S;
export const X_BAND_WAVELENGTH_M = DEFAULT_X_BAND_WAVELENGTH_M;
export {
  DEFAULT_K_FACTOR,
  DEFAULT_R_EFF_M,
};

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface SegmentIntersection2D {
  readonly xM: number;
  readonly yM: number;
  readonly wallFraction: number; // t in [0, 1]
  readonly linkFraction: number; // u in [0, 1]
}

export type BarrierSliceVerdict = 'SLICED_BLOCKED' | 'FRESNEL_GRAZING' | 'RAY_FLIES_OVER';

export interface LinkIntersectionSliceDetail {
  readonly nodeId: number;
  readonly xM: number;
  readonly yM: number;
  readonly wallFraction: number;
  readonly linkFraction: number;
  readonly d1M: number;
  readonly d2M: number;
  readonly totalDistM: number;
  readonly zGroundMslM: number;
  readonly earthBulgeM: number;
  readonly zEffGroundMslM: number;
  readonly zRayMslM: number;
  readonly zWallTopMslM: number;
  readonly fresnelRadiusM: number;
  readonly intrusionM: number;
  readonly nu: number;
  readonly diffractionLossDb: number;
  readonly requiredBlockingHeightM: number;
  readonly sliceVerdict: BarrierSliceVerdict;
}

export interface BarrierSliceAnalysisReport {
  readonly v1: Point2D;
  readonly v2: Point2D;
  readonly lengthM: number;
  readonly strikeAzimuthDeg: number;
  readonly normalAzimuthDeg: number;
  readonly midGroundElevM: number;
  readonly midTopElevM: number;
  readonly wallHeightM: number;
  readonly shapeType: string;
  readonly materialType: string;
  readonly intersections: readonly LinkIntersectionSliceDetail[];
  readonly slicedNodeIds: readonly number[];
  readonly grazingNodeIds: readonly number[];
  readonly overflyingNodeIds: readonly number[];
  readonly maxRequiredHeightToSliceAllM: number;
  readonly recommendedAutoHeightM: number;
}

export interface PerpendicularLinkSlicerObstacle {
  readonly v1: Point2D;
  readonly v2: Point2D;
  readonly center: Point2D;
  readonly widthM: number;
  readonly depthM: number;
  readonly optimalHeightM: number;
  readonly strikeAzimuthDeg: number;
  readonly shape: 'cuboid';
  readonly material: 'granite';
}

/**
 * Computes exact parametric intersection between segment AB (wall) and segment CD (link ray).
 * Returns { xM, yM, wallFraction: t, linkFraction: u } if segments intersect, or null otherwise.
 */
export function computeSegmentIntersection2D(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): SegmentIntersection2D | null {
  const abX = bx - ax;
  const abY = by - ay;
  const cdX = dx - cx;
  const cdY = dy - cy;
  const denom = abX * cdY - abY * cdX;

  if (Math.abs(denom) < 1e-9) {
    return null; // parallel or degenerate
  }

  const caX = cx - ax;
  const caY = cy - ay;

  const t = (caX * cdY - caY * cdX) / denom;
  const u = (caX * abY - caY * abX) / denom;

  if (t < -1e-7 || t > 1.0000001 || u < -1e-7 || u > 1.0000001) {
    return null;
  }

  const clampedT = Math.max(0.0, Math.min(1.0, t));
  const clampedU = Math.max(0.0, Math.min(1.0, u));

  const xM = ax + clampedT * abX;
  const yM = ay + clampedT * abY;

  return {
    xM,
    yM,
    wallFraction: clampedT,
    linkFraction: clampedU,
  };
}

/**
 * Snaps barrier endpoint V2 around V1 to the nearest 15° increment when Shift is held.
 */
export function snapBarrierAngle(v1: Point2D, v2: Point2D, incrementDeg = 15.0): Point2D {
  const dx = v2.x - v1.x;
  const dy = v2.y - v1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return { ...v2 };

  const angRad = Math.atan2(dy, dx);
  const stepRad = (incrementDeg * Math.PI) / 180.0;
  const snappedRad = Math.round(angRad / stepRad) * stepRad;

  return {
    x: v1.x + len * Math.cos(snappedRad),
    y: v1.y + len * Math.sin(snappedRad),
  };
}

/**
 * Calculates ITU-R P.526 knife-edge diffraction loss with material absorption caps.
 */
export function computeP526DiffractionDb(nu: number, material: string = 'granite'): number {
  const rawLossDb = computeKnifeEdgeDiffractionLossDb(nu);

  const mat = material.toLowerCase();
  if (mat.includes('concrete')) {
    return Math.min(35.0, rawLossDb);
  } else if (mat.includes('foliage')) {
    return Math.min(25.0, rawLossDb * 0.75);
  } else {
    // Granite / Default Knife-Edge
    return Math.min(45.0, rawLossDb);
  }
}

/**
 * Evaluates real-time 2D/3D intersections between a barrier segment V1->V2 and all active Ground Node -> ACN links.
 */
export function evaluateBarrierLinkIntersections(
  v1: Point2D,
  v2: Point2D,
  wallHeightM: number,
  shapeType: string = 'wall',
  materialType: string = 'granite',
  nodes: readonly {
    readonly nodeId: number;
    readonly xM: number;
    readonly yM: number;
    readonly zMslM?: number;
    readonly groundElevM?: number;
    readonly aglM?: number;
  }[],
  acnPosEnu: { readonly x: number; readonly y: number; readonly z: number },
  getElevationAt: (x: number, y: number) => number,
): BarrierSliceAnalysisReport {
  const dx = v2.x - v1.x;
  const dy = v2.y - v1.y;
  const lengthM = Math.hypot(dx, dy);

  // Strike azimuth (degrees clockwise from North +y)
  const strikeAzimuthDeg = lengthM > 1e-4
    ? computeBearingDeg(dx, dy)
    : 0.0;
  const normalAzimuthDeg = (strikeAzimuthDeg + 90.0) % 360.0;

  const midX = (v1.x + v2.x) * 0.5;
  const midY = (v1.y + v2.y) * 0.5;
  const midGroundElevM = getElevationAt(midX, midY);
  const midTopElevM = midGroundElevM + wallHeightM;

  const intersections: LinkIntersectionSliceDetail[] = [];

  for (const node of nodes) {
    const nodeX = node.xM;
    const nodeY = node.yM;

    const nodeGround = typeof node.groundElevM === 'number' && Number.isFinite(node.groundElevM)
      ? node.groundElevM
      : getElevationAt(nodeX, nodeY);
    const nodeAgl = typeof node.aglM === 'number' && Number.isFinite(node.aglM)
      ? node.aglM
      : 2.0;
    const zNode = typeof node.zMslM === 'number' && Number.isFinite(node.zMslM)
      ? node.zMslM
      : (nodeGround + nodeAgl);

    let intRes = computeSegmentIntersection2D(
      v1.x, v1.y,
      v2.x, v2.y,
      nodeX, nodeY,
      acnPosEnu.x, acnPosEnu.y,
    );

    // If point dome/peak and segments don't cross directly, check proximity to peak center
    if (!intRes && shapeType === 'peak') {
      const linkDx = acnPosEnu.x - nodeX;
      const linkDy = acnPosEnu.y - nodeY;
      const linkLen2 = linkDx * linkDx + linkDy * linkDy;
      if (linkLen2 > 1.0) {
        const u = ((midX - nodeX) * linkDx + (midY - nodeY) * linkDy) / linkLen2;
        if (u >= 0.01 && u <= 0.99) {
          const projX = nodeX + u * linkDx;
          const projY = nodeY + u * linkDy;
          const distToMid = Math.hypot(projX - midX, projY - midY);
          const peakRadius = Math.max(75.0, lengthM * 0.5);
          if (distToMid <= peakRadius) {
            intRes = {
              xM: projX,
              yM: projY,
              wallFraction: 0.5,
              linkFraction: u,
            };
          }
        }
      }
    }

    if (!intRes) continue;

    const u = intRes.linkFraction;
    if (u < 0.005 || u > 0.995) continue;

    const px = intRes.xM;
    const py = intRes.yM;

    const d1M = Math.hypot(px - nodeX, py - nodeY);
    const d2M = Math.hypot(acnPosEnu.x - px, acnPosEnu.y - py);
    const totalDistM = d1M + d2M;

    const earthBulgeM = computeEarthBulgeM(d1M, d2M, DEFAULT_K_FACTOR, DEFAULT_EARTH_RADIUS_M);
    const zGroundMslM = getElevationAt(px, py);
    const zEffGroundMslM = zGroundMslM + earthBulgeM;

    const zRayMslM = zNode + u * (acnPosEnu.z - zNode);
    const zWallTopMslM = zEffGroundMslM + wallHeightM;

    const requiredBlockingHeightM = Math.max(10.0, Math.ceil(zRayMslM - zEffGroundMslM));
    const intrusionM = zWallTopMslM - zRayMslM;

    const fresnelRadiusM = computeFirstFresnelRadiusM(d1M, d2M, X_BAND_WAVELENGTH_M);
    const nu = fresnelRadiusM > 0.0
      ? intrusionM * (Math.SQRT2 / fresnelRadiusM)
      : (intrusionM > 0.0 ? 10.0 : -10.0);

    const diffractionLossDb = computeP526DiffractionDb(nu, materialType);

    let sliceVerdict: BarrierSliceVerdict = 'RAY_FLIES_OVER';
    if (intrusionM >= 0.0) {
      sliceVerdict = 'SLICED_BLOCKED';
    } else if (intrusionM >= -0.6 * fresnelRadiusM) {
      sliceVerdict = 'FRESNEL_GRAZING';
    } else {
      sliceVerdict = 'RAY_FLIES_OVER';
    }

    intersections.push({
      nodeId: node.nodeId,
      xM: px,
      yM: py,
      wallFraction: intRes.wallFraction,
      linkFraction: u,
      d1M,
      d2M,
      totalDistM,
      zGroundMslM,
      earthBulgeM,
      zEffGroundMslM,
      zRayMslM,
      zWallTopMslM,
      fresnelRadiusM,
      intrusionM,
      nu,
      diffractionLossDb,
      requiredBlockingHeightM,
      sliceVerdict,
    });
  }

  const slicedNodeIds = intersections
    .filter(i => i.sliceVerdict === 'SLICED_BLOCKED')
    .map(i => i.nodeId);
  const grazingNodeIds = intersections
    .filter(i => i.sliceVerdict === 'FRESNEL_GRAZING')
    .map(i => i.nodeId);
  const overflyingNodeIds = intersections
    .filter(i => i.sliceVerdict === 'RAY_FLIES_OVER')
    .map(i => i.nodeId);

  const maxHReq = intersections.length > 0
    ? Math.max(...intersections.map(i => i.requiredBlockingHeightM))
    : 80.0;
  const maxRequiredHeightToSliceAllM = intersections.length > 0
    ? maxHReq + 35.0
    : 120.0;
  const recommendedAutoHeightM = Math.max(80.0, maxHReq + 25.0);

  return {
    v1,
    v2,
    lengthM,
    strikeAzimuthDeg,
    normalAzimuthDeg,
    midGroundElevM,
    midTopElevM,
    wallHeightM,
    shapeType,
    materialType,
    intersections,
    slicedNodeIds,
    grazingNodeIds,
    overflyingNodeIds,
    maxRequiredHeightToSliceAllM,
    recommendedAutoHeightM,
  };
}

/**
 * Generates an optimized perpendicular ridge barrier across a selected ground node's link ray.
 */
export function generatePerpendicularLinkSlicerObstacle(
  nodePosEnu: { readonly x: number; readonly y: number; readonly z?: number },
  acnPosEnu: { readonly x: number; readonly y: number; readonly z: number },
  getElevationAt: (x: number, y: number) => number,
  fractionAlongLink = 0.35,
  widthM = 1400.0,
): PerpendicularLinkSlicerObstacle {
  const linkDx = acnPosEnu.x - nodePosEnu.x;
  const linkDy = acnPosEnu.y - nodePosEnu.y;
  const linkLen = Math.hypot(linkDx, linkDy);
  const safeLen = Math.max(1.0, linkLen);
  const ux = linkDx / safeLen;
  const uy = linkDy / safeLen;

  // Normal perpendicular unit vector (-uy, ux)
  const nx = -uy;
  const ny = ux;

  const cx = nodePosEnu.x + fractionAlongLink * linkDx;
  const cy = nodePosEnu.y + fractionAlongLink * linkDy;

  const halfW = widthM * 0.5;
  const v1: Point2D = { x: cx - halfW * nx, y: cy - halfW * ny };
  const v2: Point2D = { x: cx + halfW * nx, y: cy + halfW * ny };

  const zNode = typeof nodePosEnu.z === 'number' && Number.isFinite(nodePosEnu.z)
    ? nodePosEnu.z
    : (getElevationAt(nodePosEnu.x, nodePosEnu.y) + 2.0);
  const zRay = zNode + fractionAlongLink * (acnPosEnu.z - zNode);

  const d1 = fractionAlongLink * linkLen;
  const d2 = (1.0 - fractionAlongLink) * linkLen;
  const bulge = computeEarthBulgeM(d1, d2, DEFAULT_K_FACTOR, DEFAULT_EARTH_RADIUS_M);
  const zGround = getElevationAt(cx, cy);
  const zEffGround = zGround + bulge;

  const optimalHeightM = Math.max(80.0, Math.ceil(zRay - zEffGround + 60.0));
  const strikeAzimuthDeg = computeBearingDeg(v2.x - v1.x, v2.y - v1.y);

  return {
    v1,
    v2,
    center: { x: cx, y: cy },
    widthM,
    depthM: 40.0,
    optimalHeightM,
    strikeAzimuthDeg,
    shape: 'cuboid',
    material: 'granite',
  };
}
