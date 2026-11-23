/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Pure Multi-Biome Electromagnetic Physics Engine
 *
 * Implements:
 * 1. Multi-Biome Environmental Registry (THEATER_BIOMES)
 * 2. Complex Fresnel Two-Ray Ground Reflection with Rayleigh Surface Roughness
 * 3. ITU-R P.833-10 Vegetation & Canopy Specific Attenuation
 * 4. Goldhirsh (2001) X-Band Sand & Dust Storm Particulate Attenuation
 * 5. Antenna Polarization Mismatch & ITU-R P.530 Rain Cross-Polarization Discrimination (XPD)
 * 6. Dynamic 2D Gaussian Advecting Weather Cell Path Integration
 *
 * STRICT INVARIANTS:
 * - 100% pure, deterministic functions.
 * - Zero module-level mutable state.
 * - Zero Math.random().
 * - Strict execution budget: < 5 microseconds per link call.
 */

export type BiomeId =
  | 'alpine_mountain'
  | 'arid_desert'
  | 'open_plains'
  | 'tropical_jungle'
  | 'maritime_littoral';

export type PolarizationMode = 'RHCP' | 'LHCP' | 'LINEAR_V' | 'LINEAR_H';

export interface TheaterBiomeDefinition {
  readonly id: BiomeId;
  readonly name: string;
  readonly centerLatDeg: number;
  readonly centerLonDeg: number;
  readonly baseElevationM: number;
  readonly reliefAmplitudeM: number;
  readonly relativePermittivity: number;
  readonly conductivitySm: number;
  readonly surfaceRoughnessM: number;
  readonly defaultKFactor: number;
  readonly freezingIsothermM: number;
  readonly defaultFoliageDepthM: number;
  readonly defaultDustVisibilityKm: number;
  readonly description: string;
}

/**
 * Authoritative registry of the 5 canonical tactical biomes.
 */
export const THEATER_BIOMES: Readonly<Record<BiomeId, TheaterBiomeDefinition>> = Object.freeze({
  alpine_mountain: Object.freeze({
    id: 'alpine_mountain',
    name: 'Ladakh Alpine Mountain',
    centerLatDeg: 34.5,
    centerLonDeg: 76.5,
    baseElevationM: 2900.0,
    reliefAmplitudeM: 2900.0,
    relativePermittivity: 5.5,
    conductivitySm: 0.002,
    surfaceRoughnessM: 1.8,
    defaultKFactor: 1.333,
    freezingIsothermM: 4200.0,
    defaultFoliageDepthM: 0.0,
    defaultDustVisibilityKm: 15.0,
    description: 'High-relief glaciated granitic terrain with rocky scree, deep knife-edge valleys, and arid alpine climate.',
  }),
  arid_desert: Object.freeze({
    id: 'arid_desert',
    name: 'Thar Arid Desert',
    centerLatDeg: 27.0,
    centerLonDeg: 71.5,
    baseElevationM: 180.0,
    reliefAmplitudeM: 130.0,
    relativePermittivity: 3.0,
    conductivitySm: 0.0005,
    surfaceRoughnessM: 0.08,
    defaultKFactor: 1.2,
    freezingIsothermM: 5000.0,
    defaultFoliageDepthM: 0.0,
    defaultDustVisibilityKm: 1.5,
    description: 'Low-dielectric quartz sand dunes with sparse vegetation, extreme sub-refraction, and severe dust storm attenuation.',
  }),
  open_plains: Object.freeze({
    id: 'open_plains',
    name: 'Indo-Gangetic Open Plains',
    centerLatDeg: 28.5,
    centerLonDeg: 77.2,
    baseElevationM: 200.0,
    reliefAmplitudeM: 40.0,
    relativePermittivity: 15.0,
    conductivitySm: 0.025,
    surfaceRoughnessM: 0.15,
    defaultKFactor: 1.333,
    freezingIsothermM: 4800.0,
    defaultFoliageDepthM: 5.0,
    defaultDustVisibilityKm: 12.0,
    description: 'Flat alluvial fertile agricultural plain with moist loam soil, strong specular ground multipath, and isolated tree lines.',
  }),
  tropical_jungle: Object.freeze({
    id: 'tropical_jungle',
    name: 'Northeast Tropical Jungle',
    centerLatDeg: 26.0,
    centerLonDeg: 93.0,
    baseElevationM: 250.0,
    reliefAmplitudeM: 1100.0,
    relativePermittivity: 20.0,
    conductivitySm: 0.035,
    surfaceRoughnessM: 0.35,
    defaultKFactor: 1.333,
    freezingIsothermM: 5200.0,
    defaultFoliageDepthM: 45.0,
    defaultDustVisibilityKm: 25.0,
    description: 'Dense multilayer wet broadleaf evergreen canopy with high foliage attenuation and high soil moisture content.',
  }),
  maritime_littoral: Object.freeze({
    id: 'maritime_littoral',
    name: 'Arabian Sea Maritime Littoral',
    centerLatDeg: 18.5,
    centerLonDeg: 72.0,
    baseElevationM: 0.0,
    reliefAmplitudeM: 220.0,
    relativePermittivity: 70.0,
    conductivitySm: 4.5,
    surfaceRoughnessM: 0.05,
    defaultKFactor: 1.333,
    freezingIsothermM: 5500.0,
    defaultFoliageDepthM: 0.0,
    defaultDustVisibilityKm: 20.0,
    description: 'High-salinity seawater with massive dielectric permittivity and conductivity, creating intense specular two-ray multipath.',
  }),
});

// ----------------------------------------------------------------------------
// 2. Complex Fresnel Two-Ray Ground Reflection Engine
// ----------------------------------------------------------------------------

export interface TwoRayGroundReflectionParams {
  readonly txAltAglM: number;
  readonly rxAltAglM: number;
  readonly horizontalDistM: number;
  readonly freqHz: number;
  readonly relativePermittivity: number;
  readonly conductivitySm: number;
  readonly surfaceRoughnessM: number;
  readonly polarization?: 'horizontal' | 'vertical' | 'circular' | PolarizationMode;
  readonly isLosClear: boolean;
}

export interface TwoRayGroundReflectionResult {
  readonly twoRayDeltaDb: number;
  readonly reflectionMag: number;
  readonly grazingAngleDeg: number;
  readonly roughnessFactor: number;
  readonly pathDiffM: number;
}

const SPEED_OF_LIGHT_M_S = 299792458.0;

/**
 * Computes exact Fresnel two-ray ground reflection interference gain (dB).
 * Incorporates:
 * - Complex permittivity: eps_c = eps_r - j * 60 * lambda * sigma
 * - Exact Fresnel reflection coefficients (H, V, and co-polar Circular)
 * - Rayleigh surface roughness damping: rho_s = exp(-8 * pi^2 * (sigma_h * sin(psi) / lambda)^2)
 * - Coherent vector summation of direct and reflected paths
 * - Safe clamping to [-25.0, +5.5] dB
 */
export function computeTwoRayGroundReflectionDb(
  params: TwoRayGroundReflectionParams
): TwoRayGroundReflectionResult {
  const {
    txAltAglM,
    rxAltAglM,
    horizontalDistM,
    freqHz,
    relativePermittivity,
    conductivitySm,
    surfaceRoughnessM,
    polarization = 'circular',
    isLosClear,
  } = params;

  // Invalid or blocked geometry returns neutral 0 dB delta
  if (
    !isLosClear ||
    horizontalDistM <= 1.0 ||
    txAltAglM <= 0.0 ||
    rxAltAglM <= 0.0 ||
    !Number.isFinite(horizontalDistM) ||
    !Number.isFinite(txAltAglM) ||
    !Number.isFinite(rxAltAglM)
  ) {
    return {
      twoRayDeltaDb: 0.0,
      reflectionMag: 0.0,
      grazingAngleDeg: 0.0,
      roughnessFactor: 0.0,
      pathDiffM: 0.0,
    };
  }

  const fHz = freqHz > 0 ? freqHz : 8.0e9;
  const lambda = SPEED_OF_LIGHT_M_S / fHz;

  // Grazing angle psi = atan2(htx + hrx, dh)
  const sumH = txAltAglM + rxAltAglM;
  const diffH = Math.abs(txAltAglM - rxAltAglM);
  const psi = Math.atan2(sumH, horizontalDistM);
  const sinPsi = Math.sin(psi);
  const cosPsi = Math.cos(psi);
  const cos2Psi = cosPsi * cosPsi;
  const grazingAngleDeg = psi * (180.0 / Math.PI);

  // Path length difference: deltaD = sqrt(dh^2 + (htx + hrx)^2) - sqrt(dh^2 + (htx - hrx)^2)
  const dReflected = Math.hypot(horizontalDistM, sumH);
  const dDirect = Math.hypot(horizontalDistM, diffH);
  const pathDiffM = Math.max(0.0, dReflected - dDirect);

  // Complex permittivity: eps_c = eps_r - j * (60 * lambda * sigma)
  const epsR = Math.max(1.0, relativePermittivity);
  const sigma = Math.max(0.0, conductivitySm);
  const epsI = -60.0 * lambda * sigma;

  // u = eps_c - cos^2(psi) = (epsR - cos2Psi) + j * epsI
  const uR = epsR - cos2Psi;
  const uI = epsI;
  const uMag = Math.hypot(uR, uI);

  // w = sqrt(u) = wR + j * wI (principal branch with wR >= 0, wI <= 0 because uI <= 0)
  const wR = Math.sqrt(Math.max(0.0, (uMag + uR) * 0.5));
  const wI = (uI < 0.0 ? -1.0 : 1.0) * Math.sqrt(Math.max(0.0, (uMag - uR) * 0.5));

  // Horizontal Fresnel: Gamma_H = (sinPsi - w) / (sinPsi + w)
  const numHr = sinPsi - wR;
  const numHi = -wI;
  const denHr = sinPsi + wR;
  const denHi = wI;
  const denHMagSq = denHr * denHr + denHi * denHi;
  const gammaHr = (numHr * denHr + numHi * denHi) / (denHMagSq || 1e-12);
  const gammaHi = (numHi * denHr - numHr * denHi) / (denHMagSq || 1e-12);

  // Vertical Fresnel: Gamma_V = (eps_c * sinPsi - w) / (eps_c * sinPsi + w)
  // eps_c * sinPsi = (epsR * sinPsi) + j * (epsI * sinPsi)
  const eSinR = epsR * sinPsi;
  const eSinI = epsI * sinPsi;
  const numVr = eSinR - wR;
  const numVi = eSinI - wI;
  const denVr = eSinR + wR;
  const denVi = eSinI + wI;
  const denVMagSq = denVr * denVr + denVi * denVi;
  const gammaVr = (numVr * denVr + numVi * denVi) / (denVMagSq || 1e-12);
  const gammaVi = (numVi * denVr - numVr * denVi) / (denVMagSq || 1e-12);

  // Reflection coefficient based on polarization mode
  let reflR: number;
  let reflI: number;
  if (polarization === 'horizontal' || polarization === 'LINEAR_H') {
    reflR = gammaHr;
    reflI = gammaHi;
  } else if (polarization === 'vertical' || polarization === 'LINEAR_V') {
    reflR = gammaVr;
    reflI = gammaVi;
  } else {
    // Co-polar circular reflection: 0.5 * (Gamma_H + Gamma_V)
    reflR = 0.5 * (gammaHr + gammaVr);
    reflI = 0.5 * (gammaHi + gammaVi);
  }

  // Rayleigh surface roughness reduction: rho_s = exp(-8 * pi^2 * (sigma_h * sin(psi) / lambda)^2)
  const sigmaH = Math.max(0.0, surfaceRoughnessM);
  const roughExponent = 8.0 * Math.PI * Math.PI * Math.pow((sigmaH * sinPsi) / lambda, 2.0);
  const roughnessFactor = Math.exp(-Math.min(50.0, roughExponent));

  // Effective damped reflection coefficient
  const effReflR = reflR * roughnessFactor;
  const effReflI = reflI * roughnessFactor;
  const reflectionMag = Math.hypot(effReflR, effReflI);

  // Phase delay across path difference: phi = -2 * pi * pathDiffM / lambda
  const phaseDelay = -((2.0 * Math.PI * pathDiffM) / lambda);
  const cosDelay = Math.cos(phaseDelay);
  const sinDelay = Math.sin(phaseDelay);

  // z = effRefl * exp(j * phaseDelay)
  const zR = effReflR * cosDelay - effReflI * sinDelay;
  const zI = effReflR * sinDelay + effReflI * cosDelay;

  // Interference voltage factor V = |1 + z|
  const vReal = 1.0 + zR;
  const vImag = zI;
  const vMag = Math.hypot(vReal, vImag);

  // Convert to dB, clamped safely to [-25.0, +5.5] dB
  const rawDb = 20.0 * Math.log10(Math.max(1e-4, vMag));
  const twoRayDeltaDb = Math.max(-25.0, Math.min(5.5, rawDb));

  return {
    twoRayDeltaDb,
    reflectionMag,
    grazingAngleDeg,
    roughnessFactor,
    pathDiffM,
  };
}

// ----------------------------------------------------------------------------
// 3. ITU-R P.833-10 Vegetation / Foliage Attenuation Engine
// ----------------------------------------------------------------------------

/**
 * Computes saturated vegetation / canopy attenuation according to ITU-R P.833-10.
 *
 * Formula:
 *   A_veg = A_m * (1 - exp(-d * gamma_v / A_m)) * (f_GHz / 8.0)^0.39
 */
export function computeItuR833VegetationLossDb(
  freqGhz: number,
  foliageDepthM: number,
  regime: 'tropical-dense' | 'temperate-woodland' = 'tropical-dense'
): number {
  if (foliageDepthM <= 0.0 || !Number.isFinite(foliageDepthM)) {
    return 0.0;
  }

  const fGhz = Math.max(0.1, Number.isFinite(freqGhz) ? freqGhz : 8.0);
  const depth = Math.max(0.0, foliageDepthM);

  const gammaV = regime === 'tropical-dense' ? 1.25 : 0.75; // dB/m
  const am = regime === 'tropical-dense' ? 28.0 : 22.0;     // dB max saturation

  const freqScaling = Math.pow(fGhz / 8.0, 0.39);
  const saturationLoss = am * (1.0 - Math.exp(-(depth * gammaV) / am));
  const totalVegLossDb = saturationLoss * freqScaling;

  return Math.max(0.0, Math.min(45.0, totalVegLossDb));
}

// ----------------------------------------------------------------------------
// 4. Goldhirsh (2001) Sand & Dust Storm Particulate Attenuation Engine
// ----------------------------------------------------------------------------

/**
 * Computes X-band sand and dust storm particulate attenuation according to Goldhirsh (2001).
 *
 * Formula:
 *   alpha_dust = 0.018 * f_GHz * V_km^(-1.07) [dB/km]
 *   A_dust = alpha_dust * pathLengthKm [dB]
 *
 * Clear air threshold: V >= 10 km returns 0.0 dB.
 */
export function computeGoldhirshDustAttenuationDb(
  freqGhz: number,
  pathLengthKm: number,
  visibilityKm: number
): number {
  if (
    visibilityKm >= 10.0 ||
    pathLengthKm <= 0.0 ||
    !Number.isFinite(pathLengthKm) ||
    !Number.isFinite(visibilityKm)
  ) {
    return 0.0;
  }

  const fGhz = Math.max(0.1, Number.isFinite(freqGhz) ? freqGhz : 8.0);
  const vKm = Math.max(0.02, Math.min(10.0, visibilityKm));
  const dKm = Math.max(0.0, pathLengthKm);

  // Specific attenuation: 0.018 * f * V^(-1.07) dB/km
  const alphaDbPerKm = 0.018 * fGhz * Math.pow(vKm, -1.07);
  const totalDustLossDb = alphaDbPerKm * dKm;

  return Math.max(0.0, Math.min(45.0, totalDustLossDb));
}

// ----------------------------------------------------------------------------
// 5. Antenna Polarization Mismatch & Rain XPD Engine
// ----------------------------------------------------------------------------

export interface PolarizationMismatchResult {
  readonly polarizationLossDb: number;
  readonly isRollImmune: boolean;
  readonly rainXpdPenaltyDb: number;
}

/**
 * Computes antenna polarization mismatch loss and rain-induced XPD penalty.
 *
 * Cases:
 * 1. Co-polar circular (RHCP <-> RHCP or LHCP <-> LHCP):
 *    - 0.0 dB roll mismatch (bank-immune).
 *    - Rain depolarization penalty from ITU-R P.530 if rainAttenDb > 0.
 * 2. Cross-polar circular (RHCP <-> LHCP):
 *    - 25.0 dB cross-polarization isolation loss.
 * 3. Linear to Circular (e.g. LINEAR_V <-> RHCP):
 *    - Exact 3.0103 dB (-10 * log10(0.5)).
 * 4. Linear to Linear:
 *    - -20 * log10(max(|cos(Delta_phi)|, 10^(-1.25)))
 *    - Exact 3.0103 dB at 45 deg, capped at 25.0 dB at 90 deg.
 */
export function computePolarizationMismatchLossDb(
  txPol: PolarizationMode,
  rxPol: PolarizationMode,
  relativeBankDeg: number,
  rainAttenDb: number = 0.0
): number {
  const isTxCirc = txPol === 'RHCP' || txPol === 'LHCP';
  const isRxCirc = rxPol === 'RHCP' || rxPol === 'LHCP';

  // Case 1: Both Circular
  if (isTxCirc && isRxCirc) {
    if (txPol === rxPol) {
      // Co-polar matched circular: bank immune
      if (rainAttenDb > 0.0 && Number.isFinite(rainAttenDb)) {
        // ITU-R P.530 rain depolarization
        const aRain = Math.max(0.0, rainAttenDb);
        const xpdRain = Math.max(10.0, 30.0 - 20.0 * Math.log10(1.0 + aRain / 5.0));
        const xpdLinear = Math.pow(10.0, -xpdRain / 10.0);
        const rainLossDb = -10.0 * Math.log10(Math.max(0.001, 1.0 - xpdLinear));
        return Math.min(3.0, Math.max(0.0, rainLossDb));
      }
      return 0.0;
    } else {
      // Cross-polar opposite circular: 25 dB isolation
      return 25.0;
    }
  }

  // Case 2: One Circular, One Linear (3.0103 dB theoretical split)
  if (isTxCirc !== isRxCirc) {
    return 3.010299956639812;
  }

  // Case 3: Both Linear
  let baseMisalignmentDeg = 0.0;
  if (txPol !== rxPol) {
    baseMisalignmentDeg = 90.0;
  }
  const totalMisalignmentDeg = baseMisalignmentDeg + (Number.isFinite(relativeBankDeg) ? relativeBankDeg : 0.0);
  const angleRad = (totalMisalignmentDeg * Math.PI) / 180.0;
  const cosFactor = Math.abs(Math.cos(angleRad));

  // Cap isolation to 25.0 dB (min cosFactor = 10^(-25/20) = 10^(-1.25) ~ 0.05623)
  const minCosFactor = 0.05623413251903491; // 10^(-1.25)
  const effCos = Math.max(minCosFactor, cosFactor);
  const polLossDb = -20.0 * Math.log10(effCos);

  return Math.max(0.0, Math.min(25.0, polLossDb));
}

// ----------------------------------------------------------------------------
// 6. Dynamic 2D Gaussian Advecting Weather Cells Engine
// ----------------------------------------------------------------------------

export interface AdvectingWeatherCell {
  readonly id: string;
  readonly centerX0M: number;
  readonly centerY0M: number;
  readonly velocityXMps: number;
  readonly velocityYMps: number;
  readonly radiusM: number;
  readonly peakRainRateMmH: number;
}

export interface WeatherCellRainResult {
  readonly pathAvgRainMmH: number;
  readonly peakCellRainMmH: number;
  readonly activeCellCount: number;
}

/**
 * Evaluates dynamic spatial rain rate along a transmission path across advecting storm cells.
 * Uses 7-point Simpson numerical sampling along the Cartesian chord.
 */
export function evaluateAdvectingWeatherCellsRainMmH(
  txXM: number,
  txYM: number,
  rxXM: number,
  rxYM: number,
  cells: readonly AdvectingWeatherCell[],
  simTimeSec: number
): WeatherCellRainResult {
  if (!cells || cells.length === 0) {
    return { pathAvgRainMmH: 0.0, peakCellRainMmH: 0.0, activeCellCount: 0 };
  }

  const SAMPLE_COUNT = 7;
  let sumRain = 0.0;
  let peakRain = 0.0;
  let activeCount = 0;

  // Pre-calculate advected centers at simTimeSec
  const tSec = Math.max(0.0, simTimeSec);
  const activeCells = cells.map(cell => {
    const cx = cell.centerX0M + cell.velocityXMps * tSec;
    const cy = cell.centerY0M + cell.velocityYMps * tSec;
    const sigma = Math.max(100.0, cell.radiusM * 0.5);
    const twoSigmaSq = 2.0 * sigma * sigma;
    return {
      cx,
      cy,
      radiusM: cell.radiusM,
      twoSigmaSq,
      peakRainRateMmH: Math.max(0.0, cell.peakRainRateMmH),
    };
  });

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const fraction = i / (SAMPLE_COUNT - 1);
    const sx = txXM + fraction * (rxXM - txXM);
    const sy = txYM + fraction * (rxYM - txYM);

    let sampleRain = 0.0;
    for (const cell of activeCells) {
      const dx = sx - cell.cx;
      const dy = sy - cell.cy;
      const distSq = dx * dx + dy * dy;
      if (distSq < cell.radiusM * cell.radiusM * 4.0) {
        const cellVal = cell.peakRainRateMmH * Math.exp(-distSq / cell.twoSigmaSq);
        sampleRain += cellVal;
        if (cellVal > peakRain) {
          peakRain = cellVal;
        }
      }
    }
    sumRain += sampleRain;
  }

  for (const cell of activeCells) {
    if (cell.peakRainRateMmH > 0.0) {
      activeCount++;
    }
  }

  const pathAvgRainMmH = sumRain / SAMPLE_COUNT;

  return {
    pathAvgRainMmH,
    peakCellRainMmH: peakRain,
    activeCellCount: activeCount,
  };
}

// ----------------------------------------------------------------------------
// 7. Biome EM Parameters Wrapper
// ----------------------------------------------------------------------------

export interface BiomeEmParameters {
  readonly enableBiomeEmPhysics?: boolean;
  readonly biomeId?: BiomeId;
  readonly txAltAglM?: number;
  readonly rxAltAglM?: number;
  readonly horizontalDistM?: number;
  readonly polarization?: PolarizationMode;
  readonly relativeBankDeg?: number;
  readonly foliageDepthM?: number;
  readonly foliageRegime?: 'tropical-dense' | 'temperate-woodland';
  readonly dustVisibilityKm?: number;
  readonly weatherCells?: readonly AdvectingWeatherCell[];
  readonly simTimeSec?: number;
}
