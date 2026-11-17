/**
 * src/core/geodeticRulerEngine.ts
 *
 * CAD/GIS-Grade Precision Geodetic & RF Line-of-Sight Ruler Engine (Tool #1 DEM Transect).
 * Implements high-precision horizontal, vertical, compass azimuth, back-azimuth,
 * 15° Shift-angle snapping, and 80-sample split-ray marching for blocking ridge detection.
 *
 * Specification: docs/specs/SPEC-PRECISION-GEODETIC-LOS-RULER-TOOL1.md
 */

import {
  SPEED_OF_LIGHT_M_S,
  DEFAULT_X_BAND_FREQ_HZ,
  DEFAULT_X_BAND_WAVELENGTH_M,
  DEFAULT_K_FACTOR,
  DEFAULT_TRUE_EARTH_RADIUS_M,
  COMPASS_16_CARDINALS,
  type Cardinal16,
  azimuthToCardinal16,
  computeEarthBulgeM,
  computeFirstFresnelRadiusM,
  computeBearingDeg,
  computeSlantAndHorizDistance,
} from './rfPropagationMath';

export {
  SPEED_OF_LIGHT_M_S,
  DEFAULT_X_BAND_FREQ_HZ,
  DEFAULT_X_BAND_WAVELENGTH_M,
  DEFAULT_K_FACTOR,
  DEFAULT_TRUE_EARTH_RADIUS_M,
};

export const COMPASS_16_WINDS = COMPASS_16_CARDINALS;
export type CompassWindLabel = Cardinal16;

/**
 * Maps a compass azimuth angle [0, 360) to a 16-wind cardinal label.
 * 0° = North, 90° = East, 180° = South, 270° = West.
 */
export function compassRoseLabel(azimuthDeg: number): CompassWindLabel {
  return azimuthToCardinal16(azimuthDeg);
}

export interface GeodeticRulerPoint {
  readonly xM: number;
  readonly yM: number;
  readonly groundElevationM?: number;
  readonly mastHeightM?: number;
}

export interface GeodeticRulerMetrics {
  readonly dxM: number;
  readonly dyM: number;
  readonly horizontalDistanceM: number;
  readonly dHorizM: number;
  readonly dHorizKm: number;
  readonly slantDistance3DM: number;
  readonly d3dM: number;
  readonly d3dKm: number;
  readonly antennaElevationDeltaM: number;
  readonly deltaZM: number;
  readonly groundElevationDeltaM: number;
  readonly azimuthDeg: number;
  readonly azDeg: number;
  readonly backAzimuthDeg: number;
  readonly backAzDeg: number;
  readonly cardinalOctant: CompassWindLabel;
  readonly compassLabel: CompassWindLabel;
  readonly verticalAngleDeg: number;
  readonly vertAngleDeg: number;
  readonly elevationAngleDeg: number;
  readonly gradePct: number;
}

/**
 * Computes exact horizontal, vertical, 3D slant, compass azimuth, back-azimuth,
 * and slope grade between Point A and Point B.
 *
 * Supports both object-based inputs ({ xM, yM, groundElevationM, mastHeightM })
 * and scalar argument signatures.
 */
export function computeGeodeticRulerMetrics(
  pointAOrXa: GeodeticRulerPoint | number,
  pointBOrYa: GeodeticRulerPoint | number = 0,
  zGroundA: number = 0,
  hMastA: number = 0,
  xB: number = 0,
  yB: number = 0,
  zGroundB: number = 0,
  hMastB: number = 0,
): GeodeticRulerMetrics {
  let xA_val: number;
  let yA_val: number;
  let zG_A_val: number;
  let hM_A_val: number;

  let xB_val: number;
  let yB_val: number;
  let zG_B_val: number;
  let hM_B_val: number;

  if (typeof pointAOrXa === 'object' && pointAOrXa !== null) {
    xA_val = pointAOrXa.xM;
    yA_val = pointAOrXa.yM;
    zG_A_val = pointAOrXa.groundElevationM ?? 0;
    hM_A_val = pointAOrXa.mastHeightM ?? 0;

    const ptB = typeof pointBOrYa === 'object' && pointBOrYa !== null ? pointBOrYa : { xM: 0, yM: 0 };
    xB_val = ptB.xM;
    yB_val = ptB.yM;
    zG_B_val = ptB.groundElevationM ?? 0;
    hM_B_val = ptB.mastHeightM ?? 0;
  } else {
    xA_val = pointAOrXa as number;
    yA_val = (pointBOrYa as number) ?? 0;
    zG_A_val = zGroundA;
    hM_A_val = hMastA;
    xB_val = xB;
    yB_val = yB;
    zG_B_val = zGroundB;
    hM_B_val = hMastB;
  }

  const dx = xB_val - xA_val;
  const dy = yB_val - yA_val;
  const zAntA = zG_A_val + hM_A_val;
  const zAntB = zG_B_val + hM_B_val;
  const deltaZAnt = zAntB - zAntA;
  const deltaZGround = zG_B_val - zG_A_val;

  const { horizDistM: dHoriz, slantDistM: d3d } = computeSlantAndHorizDistance(dx, dy, deltaZAnt);

  // Compass azimuth: 0° = North (+y), 90° = East (+x)
  const azDeg = computeBearingDeg(dx, dy);
  const backAzDeg = (azDeg + 180.0) % 360.0;
  const cardinal = compassRoseLabel(azDeg);

  // Vertical elevation / depression angle and slope grade %
  const denom = Math.max(dHoriz, 0.01);
  const vertAngleDeg = (Math.atan2(deltaZAnt, denom) * 180.0) / Math.PI;
  const gradePct = (deltaZAnt / denom) * 100.0;

  return {
    dxM: dx,
    dyM: dy,
    horizontalDistanceM: dHoriz,
    dHorizM: dHoriz,
    dHorizKm: dHoriz / 1000.0,
    slantDistance3DM: d3d,
    d3dM: d3d,
    d3dKm: d3d / 1000.0,
    antennaElevationDeltaM: deltaZAnt,
    deltaZM: deltaZAnt,
    groundElevationDeltaM: deltaZGround,
    azimuthDeg: azDeg,
    azDeg,
    backAzimuthDeg: backAzDeg,
    backAzDeg,
    cardinalOctant: cardinal,
    compassLabel: cardinal,
    verticalAngleDeg: vertAngleDeg,
    vertAngleDeg,
    elevationAngleDeg: vertAngleDeg,
    gradePct,
  };
}

/**
 * Snaps cursor coordinates (xCur, yCur) relative to origin (xA, yA) to discrete
 * compass angle increments (default stepDeg = 15°).
 *
 * Preserves the radial distance r = hypot(xCur - xA, yCur - yA) exactly.
 */
export function snapPointToAngleIncrement(
  xA: number,
  yA: number,
  xCur: number,
  yCur: number,
  stepDeg: number = 15.0,
): [number, number] {
  const dx = xCur - xA;
  const dy = yCur - yA;
  const r = Math.hypot(dx, dy);
  if (r < 1e-6) return [xA, yA];

  const azDeg = computeBearingDeg(dx, dy);

  const snappedAzDeg = ((Math.round(azDeg / stepDeg) * stepDeg) % 360.0 + 360.0) % 360.0;
  const rad = (snappedAzDeg * Math.PI) / 180.0;

  const snappedX = xA + r * Math.sin(rad);
  const snappedY = yA + r * Math.cos(rad);
  return [snappedX, snappedY];
}

export interface RulerSamplePoint {
  readonly index: number;
  readonly sM: number;
  readonly fraction: number;
  readonly xM: number;
  readonly yM: number;
  readonly zGroundM: number;
  readonly zBulgeM: number;
  readonly zEffectiveTerrainM: number;
  readonly zRayM: number;
  readonly f1RadiusM: number;
  readonly clearanceM: number;
  readonly intrusionM: number;
  readonly nu: number;
  readonly isClear: boolean;
}

export interface BlockingPeakInfo {
  readonly xM: number;
  readonly yM: number;
  readonly zMslM: number;
  readonly distFromAM: number;
  readonly fraction: number;
  readonly intrusionM: number;
  readonly nu: number;
}

export interface RulerProfileEvaluation {
  readonly totalHorizontalM: number;
  readonly slantDistance3DM: number;
  readonly samples: RulerSamplePoint[];
  readonly firstGrazingDistM: number | null;
  readonly blockingPeak: BlockingPeakInfo | null;
  readonly isLineOfSightClear: boolean;
  readonly minClearanceM: number;
}

export interface RulerProfileOptions {
  readonly sampleCount?: number;
  readonly kFactor?: number;
  readonly trueEarthRadiusM?: number;
  readonly carrierFrequencyHz?: number;
}

/**
 * Samples N points (default 80) along the chord from Point A to Point B,
 * evaluating terrain elevation, 4/3 Earth curvature bulge, LoS ray altitude,
 * 8.0 GHz Fresnel zone radius, clearance, knife-edge diffraction parameter nu,
 * first grazing distance, and dominant blocking ridge crest coordinates.
 */
export function evaluateRulerProfileAndBlockingPeak(
  ptA: GeodeticRulerPoint,
  ptB: GeodeticRulerPoint,
  sampleElevation: (xM: number, yM: number) => number,
  opts: RulerProfileOptions = {},
): RulerProfileEvaluation {
  const sampleCount = Math.max(2, opts.sampleCount ?? 80);
  const kFactor = opts.kFactor ?? DEFAULT_K_FACTOR;
  const trueEarthRadiusM = opts.trueEarthRadiusM ?? DEFAULT_TRUE_EARTH_RADIUS_M;
  const carrierFreqHz = opts.carrierFrequencyHz ?? DEFAULT_X_BAND_FREQ_HZ;
  const wavelengthM = SPEED_OF_LIGHT_M_S / Math.max(1.0, carrierFreqHz);

  const dx = ptB.xM - ptA.xM;
  const dy = ptB.yM - ptA.yM;
  const dHoriz = Math.hypot(dx, dy);

  const zG_A = ptA.groundElevationM ?? sampleElevation(ptA.xM, ptA.yM);
  const zG_B = ptB.groundElevationM ?? sampleElevation(ptB.xM, ptB.yM);
  const zAntA = zG_A + (ptA.mastHeightM ?? 0);
  const zAntB = zG_B + (ptB.mastHeightM ?? 0);
  const deltaZAnt = zAntB - zAntA;
  const d3d = Math.hypot(dHoriz, deltaZAnt);

  if (dHoriz <= 0) {
    return {
      totalHorizontalM: 0,
      slantDistance3DM: Math.abs(deltaZAnt),
      samples: [],
      firstGrazingDistM: null,
      blockingPeak: null,
      isLineOfSightClear: true,
      minClearanceM: 0,
    };
  }

  const effectiveEarthRadius = kFactor * trueEarthRadiusM;
  const samples: RulerSamplePoint[] = [];

  let firstGrazingDistM: number | null = null;
  let worstIntrusionM = 0;
  let worstPeakSample: RulerSamplePoint | null = null;
  let minClearanceM = Number.POSITIVE_INFINITY;

  for (let i = 0; i < sampleCount; i++) {
    const fraction = i / (sampleCount - 1);
    const sM = fraction * dHoriz;
    const xM = ptA.xM + fraction * dx;
    const yM = ptA.yM + fraction * dy;

    const zGroundM = sampleElevation(xM, yM);
    const zBulgeM = computeEarthBulgeM(sM, dHoriz - sM, kFactor, trueEarthRadiusM);
    const zEffectiveTerrainM = zGroundM + zBulgeM;
    const zRayM = zAntA + fraction * deltaZAnt;

    const f1RadiusM = computeFirstFresnelRadiusM(sM, dHoriz - sM, wavelengthM);
    const clearanceM = zRayM - zEffectiveTerrainM;
    const intrusionM = Math.max(0.0, -clearanceM);

    if (clearanceM < minClearanceM) {
      minClearanceM = clearanceM;
    }

    let nu = 0.0;
    const d1 = sM;
    const d2 = dHoriz - sM;
    if (d1 > 1e-3 && d2 > 1e-3) {
      nu = -clearanceM * Math.sqrt((2.0 / wavelengthM) * (1.0 / d1 + 1.0 / d2));
    }

    const isClear = clearanceM >= 0;

    // Track first distance where optical line of sight is broken by terrain
    if (!isClear && firstGrazingDistM === null && i > 0 && i < sampleCount - 1) {
      firstGrazingDistM = sM;
    }

    const sample: RulerSamplePoint = {
      index: i,
      sM,
      fraction,
      xM,
      yM,
      zGroundM,
      zBulgeM,
      zEffectiveTerrainM,
      zRayM,
      f1RadiusM,
      clearanceM,
      intrusionM,
      nu,
      isClear,
    };
    samples.push(sample);

    // Track peak blocking intrusion (exclude endpoints where mast is elevated)
    if (i > 0 && i < sampleCount - 1) {
      if (intrusionM > worstIntrusionM) {
        worstIntrusionM = intrusionM;
        worstPeakSample = sample;
      }
    }
  }

  let blockingPeak: BlockingPeakInfo | null = null;
  if (worstPeakSample && worstIntrusionM > 0) {
    blockingPeak = {
      xM: worstPeakSample.xM,
      yM: worstPeakSample.yM,
      zMslM: worstPeakSample.zGroundM,
      distFromAM: worstPeakSample.sM,
      fraction: worstPeakSample.fraction,
      intrusionM: worstPeakSample.intrusionM,
      nu: worstPeakSample.nu,
    };
  }

  const isLineOfSightClear = blockingPeak === null || blockingPeak.intrusionM <= 0;

  return {
    totalHorizontalM: dHoriz,
    slantDistance3DM: d3d,
    samples,
    firstGrazingDistM,
    blockingPeak,
    isLineOfSightClear,
    minClearanceM: Number.isFinite(minClearanceM) ? minClearanceM : 0,
  };
}
