/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Pure Headless 3D Volumetric RF Math Engine (M6.2.3 / V3-07)
 *
 * Implements 100% pure, zero-WebGL, deterministic mathematics for:
 * 1. 3D 0.6 F1 Fresnel Clearance Ellipsoids & SO(3) Orthonormal Chord Basis
 * 2. 3D Banking Quad-Sector Antenna Lobes via Tait-Bryan (Yaw, Pitch, Roll) Rotation
 * 3. 3D EW Jammer Threat Dome & Convective Weather Cylinders
 * 4. CVD-Compliant Link Status Color Resolution
 * 5. Deterministic Nearest-Entity World-Hit Distance Picking
 *
 * Invariants: Zero Math.random(), zero module-level mutable state, zero Three.js dependencies.
 */

import { CanvasCvdMode, getLatticeCanvasPalette } from '../canvasTheme';

/** Exact SI speed of light constant (m/s) */
export const SPEED_OF_LIGHT_M_S = 299792458.0;

/** Default X-Band carrier frequency (8.0 GHz) */
export const DEFAULT_X_BAND_FREQ_HZ = 8.0e9;

/** Default 0.6 F1 knife-edge clearance fraction */
export const DEFAULT_FRESNEL_CLEARANCE_FRACTION = 0.6;

/** Default visual scale factor for Fresnel ellipsoid radius in 3D scene */
export const DEFAULT_FRESNEL_VISUAL_SCALE = 12.0;

/** Quad-sector antenna designations and boresight azimuths in body frame (deg) */
export const QUAD_SECTOR_CONFIG = [
  { sectorIndex: 0, name: 'S0_FWD', boresightDeg: 0.0 },
  { sectorIndex: 1, name: 'S1_STBD', boresightDeg: 90.0 },
  { sectorIndex: 2, name: 'S2_AFT', boresightDeg: 180.0 },
  { sectorIndex: 3, name: 'S3_PORT', boresightDeg: 270.0 },
] as const;

export type Vector3Tuple = [number, number, number];
export type Vector3Input = readonly [number, number, number] | { readonly x: number; readonly y: number; readonly z: number };

function extractCoords(v: Vector3Input): Vector3Tuple {
  if (Array.isArray(v)) {
    return [v[0], v[1], v[2]];
  }
  const obj = v as { readonly x: number; readonly y: number; readonly z: number };
  return [obj.x, obj.y, obj.z];
}

/* ========================================================================== */
/* 1. 3D FRESNEL ELLIPSOID & ORTHONORMAL CHORD BASIS                          */
/* ========================================================================== */

export interface FresnelEllipsoidParams {
  readonly txWorld: Vector3Input;
  readonly rxWorld: Vector3Input;
  readonly slantRangeM?: number;
  readonly freqHz?: number;
  readonly clearanceFraction?: number;
  readonly metersToWorldScale?: number;
  readonly visualRadialScale?: number;
}

export interface OrthonormalBasis {
  readonly axisX: Vector3Tuple;
  readonly axisY: Vector3Tuple; // Points along unit chord Tx -> Rx
  readonly axisZ: Vector3Tuple;
}

export interface FresnelEllipsoidTransform {
  readonly centerWorld: Vector3Tuple;
  readonly chordLengthWorld: number;
  readonly physicalMidpointRadiusM: number;
  readonly clearanceRadiusM: number;
  readonly visualRadiusWorld: number;
  readonly basis: OrthonormalBasis;
  readonly rotationMatrix3x3: readonly [
    number, number, number,
    number, number, number,
    number, number, number,
  ];
  readonly isValid: boolean;
}

/**
 * Computes exact physical Fresnel radius, clearance radius, and right-handed
 * orthonormal basis for an ellipsoid aligned along the Tx -> Rx chord.
 *
 * Basis is constructed such that:
 * - axisY is parallel to unit chord (Tx -> Rx)
 * - axisX and axisZ are orthogonal to axisY and each other
 * - B^T * B = I and det(B) = +1
 */
export function computeFresnelEllipsoidTransform(params: FresnelEllipsoidParams): FresnelEllipsoidTransform {
  const tx = extractCoords(params.txWorld);
  const rx = extractCoords(params.rxWorld);
  const freqHz = params.freqHz && params.freqHz > 0 ? params.freqHz : DEFAULT_X_BAND_FREQ_HZ;
  const clearanceFraction = params.clearanceFraction !== undefined ? params.clearanceFraction : DEFAULT_FRESNEL_CLEARANCE_FRACTION;
  const metersToWorld = params.metersToWorldScale !== undefined && params.metersToWorldScale > 0 ? params.metersToWorldScale : 1.0;
  const visualRadialScale = params.visualRadialScale !== undefined && params.visualRadialScale > 0 ? params.visualRadialScale : DEFAULT_FRESNEL_VISUAL_SCALE;

  const dx = rx[0] - tx[0];
  const dy = rx[1] - tx[1];
  const dz = rx[2] - tx[2];
  const chordLenWorld = Math.hypot(dx, dy, dz);

  const centerWorld: Vector3Tuple = [
    (tx[0] + rx[0]) * 0.5,
    (tx[1] + rx[1]) * 0.5,
    (tx[2] + rx[2]) * 0.5,
  ];

  const physicalRangeM = params.slantRangeM !== undefined && Number.isFinite(params.slantRangeM) && params.slantRangeM > 0
    ? params.slantRangeM
    : chordLenWorld / metersToWorld;

  if (!Number.isFinite(chordLenWorld) || chordLenWorld <= 1e-6 || !Number.isFinite(physicalRangeM) || physicalRangeM <= 0) {
    return {
      centerWorld,
      chordLengthWorld: 0,
      physicalMidpointRadiusM: 0,
      clearanceRadiusM: 0,
      visualRadiusWorld: 0,
      basis: {
        axisX: [1, 0, 0],
        axisY: [0, 1, 0],
        axisZ: [0, 0, 1],
      },
      rotationMatrix3x3: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      isValid: false,
    };
  }

  // Exact first Fresnel zone maximum radius at midpoint d1 = d2 = D/2:
  // r_{1, max} = 0.5 * sqrt(lambda * D)
  const wavelengthM = SPEED_OF_LIGHT_M_S / freqHz;
  const physicalMidpointRadiusM = 0.5 * Math.sqrt(wavelengthM * physicalRangeM);
  const clearanceRadiusM = clearanceFraction * physicalMidpointRadiusM;
  const visualRadiusWorld = clearanceRadiusM * metersToWorld * visualRadialScale;

  // Orthonormal basis: axisY = unit chord
  const invLen = 1.0 / chordLenWorld;
  const ay: Vector3Tuple = [dx * invLen, dy * invLen, dz * invLen];

  // Gram-Schmidt orthogonalization for axisX
  // Choose reference vector not parallel to ay
  const ref: Vector3Tuple = Math.abs(ay[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const dotRef = ref[0] * ay[0] + ref[1] * ay[1] + ref[2] * ay[2];
  const wx = ref[0] - dotRef * ay[0];
  const wy = ref[1] - dotRef * ay[1];
  const wz = ref[2] - dotRef * ay[2];
  const lenW = Math.hypot(wx, wy, wz);

  const ax: Vector3Tuple = lenW > 1e-12
    ? [wx / lenW, wy / lenW, wz / lenW]
    : [1, 0, 0];

  // axisZ = axisX x axisY (Cross product ensures right-handed system: det = +1)
  const az: Vector3Tuple = [
    ax[1] * ay[2] - ax[2] * ay[1],
    ax[2] * ay[0] - ax[0] * ay[2],
    ax[0] * ay[1] - ax[1] * ay[0],
  ];

  // 3x3 Column-major rotation matrix where col0=ax, col1=ay, col2=az
  const rotationMatrix3x3: [
    number, number, number,
    number, number, number,
    number, number, number,
  ] = [
    ax[0], ax[1], ax[2], // column 0
    ay[0], ay[1], ay[2], // column 1
    az[0], az[1], az[2], // column 2
  ];

  return {
    centerWorld,
    chordLengthWorld: chordLenWorld,
    physicalMidpointRadiusM,
    clearanceRadiusM,
    visualRadiusWorld,
    basis: {
      axisX: ax,
      axisY: ay,
      axisZ: az,
    },
    rotationMatrix3x3,
    isValid: true,
  };
}

/* ========================================================================== */
/* 2. 3D BANKING QUAD-SECTOR ANTENNA LOBES                                    */
/* ========================================================================== */

export interface QuadSectorLobeParams {
  readonly acnWorld: Vector3Input;
  readonly yawDeg: number;
  readonly pitchDeg?: number;
  readonly rollDeg?: number;
  readonly activeSectorIndex?: number;
  readonly lobeLengthWorld?: number;
  readonly halfBeamwidthDeg?: number;
  readonly depressionTiltDeg?: number;
}

export interface SectorLobeDescriptor {
  readonly sectorIndex: number;
  readonly name: string;
  readonly boresightAzimuthDeg: number;
  readonly directionWorld: Vector3Tuple;
  readonly originWorld: Vector3Tuple;
  readonly lengthWorld: number;
  readonly radiusWorld: number;
  readonly isActive: boolean;
  readonly basis: OrthonormalBasis;
}

export interface QuadSectorLobeResult {
  readonly lobes: readonly [SectorLobeDescriptor, SectorLobeDescriptor, SectorLobeDescriptor, SectorLobeDescriptor];
  readonly activeSectorIndex: number;
}

/**
 * Computes exact 3D pointing direction vectors in world space for all 4 quad sectors
 * (S0 Forward, S1 Starboard, S2 Aft, S3 Port) rotated by the ACN's Tait-Bryan attitude.
 *
 * In Three.js root coordinates:
 * - +X is East
 * - +Y is Altitude MSL (Up)
 * - +Z is South (-North)
 *
 * Level flight (roll=0, pitch=0): all 4 lobes have identical depression tilt along -Y.
 * Right bank (roll > 0): Starboard wing drops (S1 tilts down, dirY_S1 decreases),
 * while Port wing rises (S3 tilts up, dirY_S3 increases).
 */
export function computeQuadSectorLobeTransforms(params: QuadSectorLobeParams): QuadSectorLobeResult {
  const acnOrigin = extractCoords(params.acnWorld);
  const yawDeg = Number.isFinite(params.yawDeg) ? params.yawDeg : 0.0;
  const pitchDeg = Number.isFinite(params.pitchDeg) ? params.pitchDeg! : 0.0;
  const rollDeg = Number.isFinite(params.rollDeg) ? params.rollDeg! : 0.0;
  const activeSector = params.activeSectorIndex !== undefined ? params.activeSectorIndex : 0;
  const lobeLen = params.lobeLengthWorld !== undefined && params.lobeLengthWorld > 0 ? params.lobeLengthWorld : 25000.0;
  const halfBwDeg = params.halfBeamwidthDeg !== undefined && params.halfBeamwidthDeg > 0 ? params.halfBeamwidthDeg : 45.0;
  const tiltDeg = params.depressionTiltDeg !== undefined ? params.depressionTiltDeg : 15.0;

  const deg2rad = Math.PI / 180.0;
  const yawRad = yawDeg * deg2rad;
  const pitchRad = pitchDeg * deg2rad;
  const rollRad = rollDeg * deg2rad;
  const tiltRad = tiltDeg * deg2rad;

  // Step 1: Base body axes in Three.js root frame at yaw = 0 (heading North)
  // +X East, +Y Up, +Z South (-Z is North)
  // Forward = [0, 0, -1] (North)
  // Right   = [1, 0, 0] (East / Starboard)
  // Up      = [0, 1, 0] (Roof)

  // Step 2: Apply Yaw (Heading) rotation around world Up (+Y)
  // Clockwise from North toward East
  // At yaw = 0: Fwd = [0, 0, -1], Right = [1, 0, 0]
  // At yaw = 90 (East): Fwd = [1, 0, 0], Right = [0, 0, 1]
  const sinY = Math.sin(yawRad);
  const cosY = Math.cos(yawRad);

  const fwdYaw: Vector3Tuple = [sinY, 0, -cosY];
  const rgtYaw: Vector3Tuple = [cosY, 0, sinY];
  const upYaw: Vector3Tuple = [0, 1, 0];

  // Step 3: Apply Pitch (nose up/down) rotation around lateral axis (rgtYaw)
  // Positive pitch rotates forward vector toward Up
  const sinP = Math.sin(pitchRad);
  const cosP = Math.cos(pitchRad);

  // Rodrigues rotation around rgtYaw
  // fwdPitch = fwdYaw * cosP + (rgtYaw x fwdYaw) * sinP
  // Note: rgtYaw x fwdYaw = [0, -1, 0] = -upYaw
  const fwdPitch: Vector3Tuple = [
    fwdYaw[0] * cosP + upYaw[0] * sinP,
    fwdYaw[1] * cosP + upYaw[1] * sinP,
    fwdYaw[2] * cosP + upYaw[2] * sinP,
  ];

  const upPitch: Vector3Tuple = [
    upYaw[0] * cosP - fwdYaw[0] * sinP,
    upYaw[1] * cosP - fwdYaw[1] * sinP,
    upYaw[2] * cosP - fwdYaw[2] * sinP,
  ];

  const rgtPitch = rgtYaw;

  // Step 4: Apply Roll (bank angle) rotation around longitudinal axis (fwdPitch)
  // Positive roll (right bank) tilts Right wing DOWN toward -Up, and Up tilts toward +Right
  const sinR = Math.sin(rollRad);
  const cosR = Math.cos(rollRad);

  // Body axes after full (Yaw, Pitch, Roll) Tait-Bryan rotation:
  const fwdBody = fwdPitch;
  const rgtBody: Vector3Tuple = [
    rgtPitch[0] * cosR - upPitch[0] * sinR,
    rgtPitch[1] * cosR - upPitch[1] * sinR,
    rgtPitch[2] * cosR - upPitch[2] * sinR,
  ];
  const upBody: Vector3Tuple = [
    upPitch[0] * cosR + rgtPitch[0] * sinR,
    upPitch[1] * cosR + rgtPitch[1] * sinR,
    upPitch[2] * cosR + rgtPitch[2] * sinR,
  ];

  // Step 5: For each sector, apply body azimuth and depression tilt (down toward -upBody)
  const cosTilt = Math.cos(tiltRad);
  const sinTilt = Math.sin(tiltRad);
  const radiusWorld = lobeLen * Math.tan(halfBwDeg * deg2rad);

  const sectorDescriptors = QUAD_SECTOR_CONFIG.map((cfg) => {
    const azRad = cfg.boresightDeg * deg2rad;
    const cosAz = Math.cos(azRad);
    const sinAz = Math.sin(azRad);

    // Direction in aircraft horizontal plane: cosAz * fwd + sinAz * rgt
    const horizX = cosAz * fwdBody[0] + sinAz * rgtBody[0];
    const horizY = cosAz * fwdBody[1] + sinAz * rgtBody[1];
    const horizZ = cosAz * fwdBody[2] + sinAz * rgtBody[2];

    // Apply depression tilt: cosTilt * horiz - sinTilt * upBody
    const dirX = cosTilt * horizX - sinTilt * upBody[0];
    const dirY = cosTilt * horizY - sinTilt * upBody[1];
    const dirZ = cosTilt * horizZ - sinTilt * upBody[2];

    const len = Math.hypot(dirX, dirY, dirZ);
    const dirNorm: Vector3Tuple = len > 1e-9 ? [dirX / len, dirY / len, dirZ / len] : [0, -1, 0];

    // Build orthonormal basis for cone (axisY = pointing direction)
    const refCone: Vector3Tuple = Math.abs(dirNorm[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    const dotC = refCone[0] * dirNorm[0] + refCone[1] * dirNorm[1] + refCone[2] * dirNorm[2];
    const cx = refCone[0] - dotC * dirNorm[0];
    const cy = refCone[1] - dotC * dirNorm[1];
    const cz = refCone[2] - dotC * dirNorm[2];
    const lenC = Math.hypot(cx, cy, cz);
    const ax: Vector3Tuple = lenC > 1e-12 ? [cx / lenC, cy / lenC, cz / lenC] : [1, 0, 0];
    const az: Vector3Tuple = [
      ax[1] * dirNorm[2] - ax[2] * dirNorm[1],
      ax[2] * dirNorm[0] - ax[0] * dirNorm[2],
      ax[0] * dirNorm[1] - ax[1] * dirNorm[0],
    ];

    return {
      sectorIndex: cfg.sectorIndex,
      name: cfg.name,
      boresightAzimuthDeg: cfg.boresightDeg,
      directionWorld: dirNorm,
      originWorld: acnOrigin,
      lengthWorld: lobeLen,
      radiusWorld,
      isActive: cfg.sectorIndex === activeSector,
      basis: {
        axisX: ax,
        axisY: dirNorm,
        axisZ: az,
      },
    };
  }) as unknown as [SectorLobeDescriptor, SectorLobeDescriptor, SectorLobeDescriptor, SectorLobeDescriptor];

  return {
    lobes: sectorDescriptors,
    activeSectorIndex: activeSector,
  };
}

/* ========================================================================== */
/* 3. 3D THREAT & WEATHER VOLUMES                                             */
/* ========================================================================== */

export interface ThreatAndWeatherParams {
  readonly jammer?: {
    readonly active?: boolean;
    readonly centerWorld: Vector3Input;
    readonly powerDbm?: number;
    readonly rangeM?: number;
    readonly heightM?: number;
  };
  readonly weatherCells?: ReadonlyArray<{
    readonly id: string | number;
    readonly centerWorld: Vector3Input;
    readonly radiusM: number;
    readonly heightM?: number;
    readonly rainRateMmH?: number;
    readonly active?: boolean;
  }>;
  readonly metersToWorldScale?: number;
}

export interface VolumetricVolumeDescriptor {
  readonly id: string;
  readonly type: 'jammer_dome' | 'weather_cell';
  readonly centerWorld: Vector3Tuple;
  readonly radiusWorld: number;
  readonly heightWorld: number;
  readonly colorHex: number;
  readonly opacity: number;
  readonly active: boolean;
}

export interface ThreatAndWeatherResult {
  readonly jammerDome: VolumetricVolumeDescriptor | null;
  readonly weatherCells: readonly VolumetricVolumeDescriptor[];
}

export function computeThreatAndWeatherVolumes(params: ThreatAndWeatherParams): ThreatAndWeatherResult {
  const scale = params.metersToWorldScale !== undefined && params.metersToWorldScale > 0 ? params.metersToWorldScale : 1.0;

  let jammerDome: VolumetricVolumeDescriptor | null = null;
  if (params.jammer && params.jammer.centerWorld) {
    const jCenter = extractCoords(params.jammer.centerWorld);
    const jRange = (params.jammer.rangeM !== undefined && params.jammer.rangeM > 0 ? params.jammer.rangeM : 15000.0) * scale;
    const jHeight = (params.jammer.heightM !== undefined && params.jammer.heightM > 0 ? params.jammer.heightM : 8000.0) * scale;
    const isActive = params.jammer.active ?? true;

    jammerDome = {
      id: 'jammer_threat_volume',
      type: 'jammer_dome',
      centerWorld: jCenter,
      radiusWorld: jRange,
      heightWorld: jHeight,
      colorHex: 0xef4444, // Red threat tone
      opacity: isActive ? 0.18 : 0.04,
      active: isActive,
    };
  }

  const weatherCells: VolumetricVolumeDescriptor[] = [];
  if (Array.isArray(params.weatherCells)) {
    for (const wc of params.weatherCells) {
      if (!wc.centerWorld) continue;
      const wCenter = extractCoords(wc.centerWorld);
      const wRad = (wc.radiusM > 0 ? wc.radiusM : 5000.0) * scale;
      const wHeight = (wc.heightM !== undefined && wc.heightM > 0 ? wc.heightM : 6000.0) * scale;
      const isActive = wc.active ?? true;
      const rain = wc.rainRateMmH !== undefined ? Math.max(0, wc.rainRateMmH) : 5.0;

      // Higher rain rate yields slightly denser cyan tone
      const opacity = isActive ? Math.min(0.35, 0.10 + (rain / 50.0) * 0.20) : 0.03;

      weatherCells.push({
        id: `weather_cell_${wc.id}`,
        type: 'weather_cell',
        centerWorld: wCenter,
        radiusWorld: wRad,
        heightWorld: wHeight,
        colorHex: 0x06b6d4, // Cyan weather cell tone
        opacity,
        active: isActive,
      });
    }
  }

  return {
    jammerDome,
    weatherCells,
  };
}

/* ========================================================================== */
/* 4. CVD-COMPLIANT STATUS COLOR RESOLUTION                                   */
/* ========================================================================== */

export interface StatusColorResult {
  readonly hex: number;
  readonly css: string;
}

export function resolveFresnelStatusColor(
  isOutage: boolean,
  minClearanceRatio: number,
  isSelected: boolean = false,
  cvdMode?: CanvasCvdMode
): StatusColorResult {
  const palette = getLatticeCanvasPalette(cvdMode);

  if (isSelected) {
    const css = palette.accent;
    return {
      hex: parseInt(css.replace('#', '0x'), 16),
      css,
    };
  }

  if (isOutage || !Number.isFinite(minClearanceRatio) || minClearanceRatio <= 0.0) {
    const css = palette.outage;
    return {
      hex: parseInt(css.replace('#', '0x'), 16),
      css,
    };
  }

  if (minClearanceRatio < DEFAULT_FRESNEL_CLEARANCE_FRACTION) {
    const css = palette.degraded;
    return {
      hex: parseInt(css.replace('#', '0x'), 16),
      css,
    };
  }

  const css = palette.optimal;
  return {
    hex: parseInt(css.replace('#', '0x'), 16),
    css,
  };
}

/* ========================================================================== */
/* 5. DETERMINISTIC NEAREST-ENTITY WORLD-HIT DISTANCE PICKING                 */
/* ========================================================================== */

export interface PickableEntity {
  readonly id: number;
  readonly positionWorld: Vector3Input;
}

/**
 * Returns the nearest entity id within maxPickRadiusWorld of hitWorld point,
 * or null if no entity is within range or coordinates are non-finite.
 */
export function pickNearestEntityFromWorldHit(
  hitWorld: Vector3Input,
  entities: ReadonlyArray<PickableEntity>,
  maxPickRadiusWorld: number
): number | null {
  if (!hitWorld || !Array.isArray(entities) || entities.length === 0) return null;
  if (!Number.isFinite(maxPickRadiusWorld) || maxPickRadiusWorld <= 0) return null;

  const hit = extractCoords(hitWorld);
  if (!Number.isFinite(hit[0]) || !Number.isFinite(hit[1]) || !Number.isFinite(hit[2])) return null;

  let nearestId: number | null = null;
  let minDistanceSq = maxPickRadiusWorld * maxPickRadiusWorld;

  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (ent.id === undefined || ent.id === null) continue;
    const pos = extractCoords(ent.positionWorld);
    if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1]) || !Number.isFinite(pos[2])) continue;

    const dx = pos[0] - hit[0];
    const dy = pos[1] - hit[1];
    const dz = pos[2] - hit[2];
    const dSq = dx * dx + dy * dy + dz * dz;

    if (dSq <= minDistanceSq) {
      minDistanceSq = dSq;
      nearestId = ent.id;
    }
  }

  return nearestId;
}
