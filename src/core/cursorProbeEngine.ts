/**
 * src/core/cursorProbeEngine.ts
 *
 * CAD/STK-Grade Precision Cursor RF Link Probe, 360° Horizon Mask Analyzer & Unit Spawner Engine (Tool #2).
 * Implements real-time cursor-to-ACN 3D geometry, 48-sample curved-Earth ray-marching,
 * terrain horizon mask angle clearance, serving ACN quadrant sector (S0..S3) identification,
 * ITU-R F.1336 roll-off loss, 8.0 GHz link budget, 16-azimuth 360° polar horizon mask skyline,
 * reference pin [P1] differential comparison, and 2 km polar-grid peak optimizer.
 *
 * Specification: docs/specs/SPEC-PRECISION-CURSOR-RF-PROBE-AND-UNIT-SPAWNER-TOOL2.md
 */

import { SPEED_OF_LIGHT } from './config';
import { MODCOD_TABLE } from './linkBudget';
import { ACN_SECTOR_LABELS } from './antennaArray';

export const SPEED_OF_LIGHT_M_S = SPEED_OF_LIGHT ?? 299792458.0;
export const DEFAULT_X_BAND_FREQ_HZ = 8.0e9; // 8.0 GHz
export const DEFAULT_X_BAND_WAVELENGTH_M = SPEED_OF_LIGHT_M_S / DEFAULT_X_BAND_FREQ_HZ; // ~0.037474 m
export const DEFAULT_K_FACTOR = 4.0 / 3.0; // Standard atmospheric refraction
export const DEFAULT_EARTH_RADIUS_M = 6371000.0; // WGS-84 volumetric mean
export const DEFAULT_R_EFF_M = DEFAULT_K_FACTOR * DEFAULT_EARTH_RADIUS_M; // ~8494666.67 m

// Standard Tactical Link Budget Constants (8 GHz ACN-Ground)
export const PROBE_LINK_BUDGET = {
  txPowerDbm: 43.0, // 20 W ACN PA
  txGainDbi: 18.0, // Peak horn / sector array gain
  rxGainDbi: 3.0, // Ground terminal monopole / patch gain
  noisePowerDbm: -104.0, // Receiver thermal noise floor + NF
  gasLossBaselineDb: 1.2, // Atmospheric absorption baseline
  specificGasLossDbPerKm: 0.012, // ITU-R P.676 absorption at 8.0 GHz
  maxRollOffDb: 25.0, // Maximum antenna off-boresight attenuation
  hpbwAzDeg: 90.0, // Sector half-power beamwidth
  channelBandwidthHz: 1.0e6, // 1.0 MHz shared channel
};

export interface BlockingRidgePeak {
  readonly xM: number;
  readonly yM: number;
  readonly zMslM: number;
  readonly distKm: number;
}

export interface HorizonMaskAzimuthBin {
  readonly azimuthDeg: number;
  readonly maskAngleDeg: number;
  readonly isBlockedAtAcnEl: boolean;
}

export interface PinnedProbeReference {
  readonly probeX?: number;
  readonly probeY?: number;
  readonly xM?: number;
  readonly yM?: number;
  readonly x?: number;
  readonly y?: number;
  readonly zGroundM?: number;
  readonly groundElevationM?: number;
  readonly estSinrDb?: number;
  readonly sinrDb?: number;
  readonly estBitrateMbps?: number;
  readonly bitrateMbps?: number;
}

export interface ProbeDifferentialMetrics {
  readonly distFromPinKm: number;
  readonly bearingFromPinDeg: number;
  readonly deltaElevM: number;
  readonly deltaSinrDb: number;
  readonly deltaBitrateMbps: number;
}

export interface CursorProbeAnalysis {
  // Coordinates & Altitudes
  readonly probeX: number;
  readonly probeY: number;
  readonly xM?: number;
  readonly yM?: number;
  readonly x?: number;
  readonly y?: number;
  readonly groundElevationM: number;
  readonly zGroundM?: number;
  readonly mastHeightM: number;
  readonly antennaAltitudeM: number;
  readonly acnPos: [number, number, number];
  readonly acnHeadingDeg: number;

  // 3D Geometry to ACN
  readonly dxM: number;
  readonly dyM: number;
  readonly dzM: number;
  readonly horizontalDistanceM: number;
  readonly dHorizM: number;
  readonly dHorizKm: number;
  readonly slantDistance3DM: number;
  readonly d3dM: number;
  readonly d3dKm: number;
  readonly azimuthToAcnDeg: number;
  readonly azToAcnDeg: number;
  readonly elevationAngleToAcnDeg: number;
  readonly elToAcnDeg: number;

  // Horizon Mask & Terrain LoS
  readonly horizonMaskAngleDeg: number;
  readonly theta_horizonMaskDeg: number;
  readonly clearanceAngleDeg: number;
  readonly angularClearanceDeg: number;
  readonly isLos: boolean;
  readonly blockingRidgePeak: BlockingRidgePeak | null;

  // Quad-Sector ACN Identification & Roll-Off
  readonly bodyAzDeg: number;
  readonly activeSectorId: 0 | 1 | 2 | 3;
  readonly activeSectorLabel: string;
  readonly offBoresightDeg: number;
  readonly rollOffLossDb: number;

  // RF Link Budget & Capacity
  readonly fsplDb: number;
  readonly gasLossDb: number;
  readonly diffLossDb: number;
  readonly estSinrDb: number;
  readonly sinrDb?: number;
  readonly modcodName: string;
  readonly spectralEfficiencyBpsHz: number;
  readonly estBitrateMbps: number;
  readonly bitrateMbps?: number;

  // 360° Polar Horizon Mask Ring
  readonly horizonMask16: readonly HorizonMaskAzimuthBin[];
  readonly skyOpennessPct: number;

  // Pinned Reference Comparison
  readonly deltaVsPin: ProbeDifferentialMetrics | null;
}

export interface OptimalSignalPeakResult {
  readonly bestX: number;
  readonly bestY: number;
  readonly bestZ: number;
  readonly bestSinrDb: number;
  readonly bestSkyOpennessPct: number;
  readonly bestModcod: string;
  readonly bestBitrateMbps: number;

  // Aliases
  readonly xM: number;
  readonly yM: number;
  readonly zM: number;
  readonly sinrDb: number;
}

/**
 * Computes ITU-R P.526 single knife-edge diffraction loss J(nu).
 */
export function computeP526DiffractionDb(nu: number): number {
  if (nu <= -0.78) return 0.0;
  const term = Math.sqrt((nu - 0.1) * (nu - 0.1) + 1.0) + nu - 0.1;
  return 6.9 + 20.0 * Math.log10(Math.max(1e-6, term));
}

/**
 * Evaluates the instantaneous CAD/STK-grade RF link, horizon mask clearance,
 * quad-sector antenna coupling, and 360° polar skyline between a cursor probe antenna and ACN.
 */
export function evaluateCursorRfProbe(
  probePosEnu: { x?: number; y?: number; xM?: number; yM?: number } | [number, number],
  mastHeightM: number,
  acnPosEnu: { x?: number; y?: number; z?: number; xM?: number; yM?: number; zM?: number } | [number, number, number],
  acnHeadingDeg: number,
  getElevationAt: (x: number, y: number) => number,
  pinnedRef?: PinnedProbeReference | CursorProbeAnalysis | null,
): CursorProbeAnalysis {
  // 1. Resolve probe position and antenna height
  const xP = Array.isArray(probePosEnu)
    ? probePosEnu[0]
    : (probePosEnu.xM ?? probePosEnu.x ?? 0.0);
  const yP = Array.isArray(probePosEnu)
    ? probePosEnu[1]
    : (probePosEnu.yM ?? probePosEnu.y ?? 0.0);

  const zGround = getElevationAt(xP, yP);
  const hMast = Math.max(0.1, mastHeightM);
  const zAnt = zGround + hMast;

  // 2. Resolve ACN position
  const xAcn = Array.isArray(acnPosEnu)
    ? acnPosEnu[0]
    : (acnPosEnu.xM ?? acnPosEnu.x ?? 0.0);
  const yAcn = Array.isArray(acnPosEnu)
    ? acnPosEnu[1]
    : (acnPosEnu.yM ?? acnPosEnu.y ?? 0.0);
  const zAcn = Array.isArray(acnPosEnu)
    ? acnPosEnu[2]
    : (acnPosEnu.zM ?? acnPosEnu.z ?? 3500.0);

  // 3. 3D Slant Geometry
  const dx = xAcn - xP;
  const dy = yAcn - yP;
  const dz = zAcn - zAnt;
  const dHorizM = Math.hypot(dx, dy);
  const d3dM = Math.hypot(dHorizM, dz);
  const dHorizKm = dHorizM / 1000.0;
  const d3dKm = d3dM / 1000.0;

  // Forward azimuth from probe to ACN: 0° = North, 90° = East
  const azToAcnDeg = ((Math.atan2(dx, dy) * 180.0) / Math.PI + 360.0) % 360.0;

  // Elevation angle from probe antenna to ACN
  const elToAcnDeg = (Math.atan2(dz, Math.max(dHorizM, 1.0)) * 180.0) / Math.PI;

  // 4. Ray-Marching Along Probe -> ACN Path (48 Samples)
  const NUM_RAY_SAMPLES = 48;
  let maxHorizonMaskDeg = -90.0;
  let maxNu = -999.0;
  let dominantPeakSample: { xM: number; yM: number; zMslM: number; distKm: number } | null = null;
  let maxIntrusionM = -Infinity;
  let isRayBlocked = false;

  for (let i = 1; i <= NUM_RAY_SAMPLES; i++) {
    const u = i / NUM_RAY_SAMPLES;
    const sM = u * dHorizM;
    const sx = xP + u * dx;
    const sy = yP + u * dy;
    const zDem = getElevationAt(sx, sy);

    // Tangent-plane curvature drop relative to probe antenna
    const bulgeDropM = (sM * sM) / (2.0 * DEFAULT_R_EFF_M);
    const horizonAngleDeg = (Math.atan2(zDem - bulgeDropM - zAnt, Math.max(sM, 1.0)) * 180.0) / Math.PI;
    if (horizonAngleDeg > maxHorizonMaskDeg) {
      maxHorizonMaskDeg = horizonAngleDeg;
    }

    // Chord-to-chord curvature bulge & ray clearance
    const chordBulgeM = (sM * (dHorizM - sM)) / (2.0 * DEFAULT_R_EFF_M);
    const effTerrainZ = zDem + chordBulgeM;
    const rayZ = zAnt + u * dz;
    const clearanceM = rayZ - effTerrainZ;

    if (clearanceM <= 0) {
      isRayBlocked = true;
    }

    const intrusionM = effTerrainZ - rayZ;
    const d1 = Math.max(1.0, sM);
    const d2 = Math.max(1.0, dHorizM - sM);
    const nu = intrusionM * Math.sqrt((2.0 / DEFAULT_X_BAND_WAVELENGTH_M) * (1.0 / d1 + 1.0 / d2));
    if (nu > maxNu) {
      maxNu = nu;
    }

    if (intrusionM > maxIntrusionM) {
      maxIntrusionM = intrusionM;
      dominantPeakSample = {
        xM: sx,
        yM: sy,
        zMslM: zDem,
        distKm: sM / 1000.0,
      };
    }
  }

  const angularClearanceDeg = elToAcnDeg - maxHorizonMaskDeg;
  const isLos = !isRayBlocked && angularClearanceDeg > 0.0;
  const blockingRidgePeak = isLos ? null : dominantPeakSample;

  // 5. Serving ACN Quadrant Sector (S0..S3) & ITU-R F.1336 Roll-Off Loss
  // Azimuth from ACN towards probe
  const azFromAcnDeg = ((Math.atan2(-dx, -dy) * 180.0) / Math.PI + 360.0) % 360.0;
  const bodyAzDeg = ((azFromAcnDeg - acnHeadingDeg) % 360.0 + 360.0) % 360.0;

  // Quad sector assignment: S0=0° FWD, S1=90° STBD, S2=180° AFT, S3=270° PORT
  const sectorIdx = Math.round(bodyAzDeg / 90.0) % 4;
  const activeSectorId = (sectorIdx < 0 ? sectorIdx + 4 : sectorIdx) as 0 | 1 | 2 | 3;
  const activeSectorLabel = ACN_SECTOR_LABELS[activeSectorId] ?? `S${activeSectorId}`;

  const sectorBoresightDeg = activeSectorId * 90.0;
  let offBoresightDeg = Math.abs(bodyAzDeg - sectorBoresightDeg);
  if (offBoresightDeg > 180.0) {
    offBoresightDeg = 360.0 - offBoresightDeg;
  }

  // ITU-R F.1336 azimuthal pattern attenuation
  const azRatio = offBoresightDeg / PROBE_LINK_BUDGET.hpbwAzDeg;
  const rollOffLossDb = Math.min(12.0 * azRatio * azRatio, PROBE_LINK_BUDGET.maxRollOffDb);

  // 6. 8.0 GHz Link Budget Calculation
  const fsplDb = 20.0 * Math.log10(Math.max(1.0, d3dM)) + 20.0 * Math.log10(DEFAULT_X_BAND_FREQ_HZ) - 147.55;
  const gasLossDb = PROBE_LINK_BUDGET.gasLossBaselineDb + PROBE_LINK_BUDGET.specificGasLossDbPerKm * d3dKm;
  const diffLossDb = isLos ? 0.0 : computeP526DiffractionDb(maxNu);

  const estSinrDb =
    PROBE_LINK_BUDGET.txPowerDbm +
    PROBE_LINK_BUDGET.txGainDbi -
    rollOffLossDb +
    PROBE_LINK_BUDGET.rxGainDbi -
    fsplDb -
    gasLossDb -
    diffLossDb -
    PROBE_LINK_BUDGET.noisePowerDbm;

  // DVB-S2X MODCOD Selection
  let selectedModcod = { name: 'LINK_OUTAGE', spectralEfficiencyBpsHz: 0.0 };
  for (const entry of MODCOD_TABLE) {
    if (estSinrDb >= entry.minSnrDb) {
      selectedModcod = entry;
      break;
    }
  }

  const modcodName = selectedModcod.name;
  const spectralEfficiencyBpsHz = selectedModcod.spectralEfficiencyBpsHz;
  const estBitrateMbps = (spectralEfficiencyBpsHz * PROBE_LINK_BUDGET.channelBandwidthHz) / 1.0e6;

  // 7. 16-Azimuth 360° Polar Horizon Mask Skyline Ring
  const horizonMask16: HorizonMaskAzimuthBin[] = [];
  const NUM_SKYLINE_AZ = 16;
  const SKYLINE_RADIUS_M = 8000.0;
  const SKYLINE_RADIAL_STEPS = 8;
  const skylineThresholdDeg = Math.max(elToAcnDeg, 8.0);
  let clearSectorCount = 0;

  for (let k = 0; k < NUM_SKYLINE_AZ; k++) {
    const azimuthDeg = k * 22.5;
    const azRad = (azimuthDeg * Math.PI) / 180.0;
    const sinAz = Math.sin(azRad);
    const cosAz = Math.cos(azRad);

    let maxAzMaskDeg = -90.0;
    for (let j = 1; j <= SKYLINE_RADIAL_STEPS; j++) {
      const distM = (j / SKYLINE_RADIAL_STEPS) * SKYLINE_RADIUS_M;
      const sampleX = xP + distM * sinAz;
      const sampleY = yP + distM * cosAz;
      const zSample = getElevationAt(sampleX, sampleY);

      const bulgeM = (distM * distM) / (2.0 * DEFAULT_R_EFF_M);
      const angleDeg = (Math.atan2(zSample - bulgeM - zAnt, distM) * 180.0) / Math.PI;
      if (angleDeg > maxAzMaskDeg) {
        maxAzMaskDeg = angleDeg;
      }
    }

    const isBlockedAtAcnEl = maxAzMaskDeg >= skylineThresholdDeg;
    if (!isBlockedAtAcnEl) {
      clearSectorCount++;
    }

    horizonMask16.push({
      azimuthDeg,
      maskAngleDeg: maxAzMaskDeg,
      isBlockedAtAcnEl,
    });
  }

  const skyOpennessPct = (clearSectorCount / NUM_SKYLINE_AZ) * 100.0;

  // 8. Differential Comparison Against Pinned Reference [P1]
  let deltaVsPin: ProbeDifferentialMetrics | null = null;
  if (pinnedRef) {
    const ref = pinnedRef as Record<string, number | undefined>;
    const p1X = ref.xM ?? ref.x ?? ref.probeX ?? 0.0;
    const p1Y = ref.yM ?? ref.y ?? ref.probeY ?? 0.0;
    const p1ZG = ref.zGroundM ?? ref.groundElevationM ?? 0.0;
    const p1Sinr = ref.estSinrDb ?? ref.sinrDb ?? 0.0;
    const p1Bitrate = ref.estBitrateMbps ?? ref.bitrateMbps ?? 0.0;

    const deltaX = xP - p1X;
    const deltaY = yP - p1Y;
    const distFromPinKm = Math.hypot(deltaX, deltaY) / 1000.0;
    const bearingFromPinDeg = ((Math.atan2(deltaX, deltaY) * 180.0) / Math.PI + 360.0) % 360.0;

    deltaVsPin = {
      distFromPinKm,
      bearingFromPinDeg,
      deltaElevM: zGround - p1ZG,
      deltaSinrDb: estSinrDb - p1Sinr,
      deltaBitrateMbps: estBitrateMbps - p1Bitrate,
    };
  }

  return {
    probeX: xP,
    probeY: yP,
    xM: xP,
    yM: yP,
    x: xP,
    y: yP,
    groundElevationM: zGround,
    zGroundM: zGround,
    mastHeightM: hMast,
    antennaAltitudeM: zAnt,
    acnPos: [xAcn, yAcn, zAcn],
    acnHeadingDeg,

    dxM: dx,
    dyM: dy,
    dzM: dz,
    horizontalDistanceM: dHorizM,
    dHorizM,
    dHorizKm,
    slantDistance3DM: d3dM,
    d3dM,
    d3dKm,
    azimuthToAcnDeg: azToAcnDeg,
    azToAcnDeg,
    elevationAngleToAcnDeg: elToAcnDeg,
    elToAcnDeg,

    horizonMaskAngleDeg: maxHorizonMaskDeg,
    theta_horizonMaskDeg: maxHorizonMaskDeg,
    clearanceAngleDeg: angularClearanceDeg,
    angularClearanceDeg,
    isLos,
    blockingRidgePeak,

    bodyAzDeg,
    activeSectorId,
    activeSectorLabel,
    offBoresightDeg,
    rollOffLossDb,

    fsplDb,
    gasLossDb,
    diffLossDb,
    estSinrDb,
    sinrDb: estSinrDb,
    modcodName,
    spectralEfficiencyBpsHz,
    estBitrateMbps,
    bitrateMbps: estBitrateMbps,

    horizonMask16,
    skyOpennessPct,
    deltaVsPin,
  };
}

/**
 * Searches a 2000m polar grid (16 azimuths x 5 radii) around a center coordinate
 * to find the optimal antenna siting position that maximizes SINR and 360° sky openness.
 */
export function findOptimalSignalPeakInRadius(
  centerX: number,
  centerY: number,
  radiusM: number,
  mastHeightM: number,
  acnPosEnu: { x?: number; y?: number; z?: number; xM?: number; yM?: number; zM?: number } | [number, number, number],
  acnHeadingDeg: number,
  getElevationAt: (x: number, y: number) => number,
): OptimalSignalPeakResult {
  const effectiveRadius = Math.max(100.0, radiusM || 2000.0);
  const numAzimuths = 16;
  const numRadii = 5;

  let bestEval = evaluateCursorRfProbe(
    { xM: centerX, yM: centerY },
    mastHeightM,
    acnPosEnu,
    acnHeadingDeg,
    getElevationAt,
  );
  let bestCoord = { x: centerX, y: centerY, z: bestEval.groundElevationM };
  let bestScore = bestEval.estSinrDb * 10.0 + bestEval.skyOpennessPct;

  for (let rIdx = 1; rIdx <= numRadii; rIdx++) {
    const r = (rIdx / numRadii) * effectiveRadius;
    for (let aIdx = 0; aIdx < numAzimuths; aIdx++) {
      const azRad = ((aIdx * 22.5) * Math.PI) / 180.0;
      const candX = centerX + r * Math.sin(azRad);
      const candY = centerY + r * Math.cos(azRad);

      const candidateEval = evaluateCursorRfProbe(
        { xM: candX, yM: candY },
        mastHeightM,
        acnPosEnu,
        acnHeadingDeg,
        getElevationAt,
      );

      const score = candidateEval.estSinrDb * 10.0 + candidateEval.skyOpennessPct;
      if (score > bestScore) {
        bestScore = score;
        bestEval = candidateEval;
        bestCoord = { x: candX, y: candY, z: candidateEval.groundElevationM };
      }
    }
  }

  return {
    bestX: bestCoord.x,
    bestY: bestCoord.y,
    bestZ: bestCoord.z,
    bestSinrDb: bestEval.estSinrDb,
    bestSkyOpennessPct: bestEval.skyOpennessPct,
    bestModcod: bestEval.modcodName,
    bestBitrateMbps: bestEval.estBitrateMbps,

    xM: bestCoord.x,
    yM: bestCoord.y,
    zM: bestCoord.z,
    sinrDb: bestEval.estSinrDb,
  };
}
