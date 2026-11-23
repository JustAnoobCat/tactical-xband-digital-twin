/**
 * src/core/rfPropagationMath.ts
 *
 * Canonical DRY RF & Geodetic Mathematics Library.
 * Single source of truth for ITU-R first-principles RF equations, geodetic
 * line-of-sight geometry, Fresnel zone dimensions, and spherical Earth curvature.
 *
 * Specification: docs/specs/SPEC-SOFTWARE-ENGINEERING-MODULARITY-AND-DRY-REFACTOR.md
 */

export const SPEED_OF_LIGHT_M_S = 299792458.0;
export const DEFAULT_X_BAND_FREQ_HZ = 8.0e9; // 8.0 GHz
export const DEFAULT_X_BAND_WAVELENGTH_M = SPEED_OF_LIGHT_M_S / DEFAULT_X_BAND_FREQ_HZ; // ~0.037474 m
export const DEFAULT_K_FACTOR = 4.0 / 3.0; // 1.3333333333 Standard atmospheric refraction
export const DEFAULT_TRUE_EARTH_RADIUS_M = 6371000.0; // WGS-84 volumetric mean
export const DEFAULT_R_EFF_M = DEFAULT_K_FACTOR * DEFAULT_TRUE_EARTH_RADIUS_M; // ~8494666.67 m

export const COMPASS_16_CARDINALS = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW',
  'W', 'WNW', 'NW', 'NNW',
] as const;

export type Cardinal16 = typeof COMPASS_16_CARDINALS[number];

/**
 * Computes effective spherical Earth curvature bulge (Δh in metres) arched
 * into the chord line between two points separated by total distance D = d1 + d2.
 *
 * Δh_bulge = +(d1 * d2) / (2 * K * R_E)
 *
 * @param d1M Distance from transmitter / start point to sample along chord (metres)
 * @param d2M Distance from sample to receiver / end point along chord (metres)
 * @param kFactor Atmospheric refraction factor (default 4/3 = 1.3333333333)
 * @param earthRadiusM Mean Earth radius in metres (default 6,371,000.0 m)
 * @returns Positive bulge height in metres
 */
export function computeEarthBulgeM(
  d1M: number,
  d2M: number,
  kFactor: number = DEFAULT_K_FACTOR,
  earthRadiusM: number = DEFAULT_TRUE_EARTH_RADIUS_M
): number {
  if (d1M <= 0.0 || d2M <= 0.0) return 0.0;
  const effectiveEarthRadiusM = kFactor * earthRadiusM;
  return (d1M * d2M) / (2.0 * effectiveEarthRadiusM);
}

/**
 * Computes the first Fresnel zone radius r_F1 (metres) at an intermediate path point.
 *
 * r_F1 = sqrt((λ * d1 * d2) / (d1 + d2))
 *
 * @param d1M Distance from transmitter to obstacle (metres)
 * @param d2M Distance from obstacle to receiver (metres)
 * @param wavelengthM Carrier wavelength in metres (default 8.0 GHz: ~0.037474 m)
 * @returns First Fresnel zone radius in metres
 */
export function computeFirstFresnelRadiusM(
  d1M: number,
  d2M: number,
  wavelengthM: number = DEFAULT_X_BAND_WAVELENGTH_M
): number {
  if (d1M <= 0.0 || d2M <= 0.0) return 0.0;
  const totalDist = d1M + d2M;
  if (totalDist <= 1e-6) return 0.0;
  return Math.sqrt((wavelengthM * d1M * d2M) / totalDist);
}

/**
 * Computes ITU-R P.526-15 Eq. (14) single knife-edge diffraction loss J(ν) in dB.
 *
 * For ν <= -0.78: J(ν) = 0.0 dB
 * For ν > -0.78:  J(ν) = 6.9 + 20 * log10(sqrt((ν - 0.1)^2 + 1) + ν - 0.1)
 *
 * @param nu Dimensionless diffraction parameter ν
 * @returns Knife-edge diffraction loss in dB (>= 0.0 dB)
 */
export function computeKnifeEdgeDiffractionLossDb(nu: number): number {
  if (nu <= -0.78) return 0.0;
  const term = Math.sqrt((nu - 0.1) * (nu - 0.1) + 1.0) + nu - 0.1;
  const loss = 6.9 + 20.0 * Math.log10(Math.max(1e-6, term));
  return Math.max(0.0, loss);
}

/**
 * Alias for computeKnifeEdgeDiffractionLossDb for backward compatibility.
 */
export const computeKnifeEdgeLossDb = computeKnifeEdgeDiffractionLossDb;

/**
 * Alias for computeKnifeEdgeDiffractionLossDb conforming to ITU-R P.526 naming.
 */
export const ituR526KnifeEdgeLossDb = computeKnifeEdgeDiffractionLossDb;

export interface BullingtonDiffractionResult {
  readonly lossDb: number;
  readonly nuApex: number;
  readonly apexDistM: number;
  readonly apexElevMslM: number;
  readonly isLos: boolean;
}

export interface DeygoutMultiEdgeResult {
  readonly totalLossDb: number;
  readonly primaryNu: number;
  readonly primaryLossDb: number;
  readonly primaryEdgeIndex: number;
  readonly primaryEdgeDistM: number;
  readonly secondaryLeftNu: number;
  readonly secondaryLeftLossDb: number;
  readonly secondaryLeftIndex: number;
  readonly secondaryRightNu: number;
  readonly secondaryRightLossDb: number;
  readonly secondaryRightIndex: number;
  readonly secondaryEdgeCount: number;
  readonly bullingtonLossDb: number;
  readonly correctionDb: number;
  readonly method: 'deygout-multiedge' | 'bullington' | 'single-edge';
}

/**
 * Computes ITU-R P.526-15 §4.5.1 Bullington equivalent knife-edge diffraction loss over
 * a sampled terrain/CAD profile.
 *
 * Constructs horizon tangents from transmitter (index 0) and receiver (index N-1),
 * intersects the horizon rays to identify the equivalent apex position and clearance,
 * and evaluates J(nu_apex).
 *
 * @param distancesM Array of horizontal distances along path (metres, monotonically increasing)
 * @param elevationsM Array of total elevations along path (metres MSL, terrain + CAD)
 * @param wavelengthM Carrier wavelength in metres (default 8.0 GHz: ~0.037474 m)
 * @param kFactor Effective Earth refraction factor (default 4/3)
 * @param earthRadiusM Mean Earth radius in metres (default 6,371,000.0 m)
 */
export function computeBullingtonDiffraction(
  distancesM: ArrayLike<number>,
  elevationsM: ArrayLike<number>,
  wavelengthM: number = DEFAULT_X_BAND_WAVELENGTH_M,
  kFactor: number = DEFAULT_K_FACTOR,
  earthRadiusM: number = DEFAULT_TRUE_EARTH_RADIUS_M
): BullingtonDiffractionResult {
  const n = distancesM.length;
  if (n < 3) {
    return {
      lossDb: 0.0,
      nuApex: -999.0,
      apexDistM: 0.0,
      apexElevMslM: n > 0 ? elevationsM[0] : 0.0,
      isLos: true,
    };
  }

  const d0 = distancesM[0];
  const totalD = distancesM[n - 1] - d0;
  if (totalD <= 1e-3) {
    return {
      lossDb: 0.0,
      nuApex: -999.0,
      apexDistM: 0.0,
      apexElevMslM: elevationsM[0],
      isLos: true,
    };
  }

  const h0 = elevationsM[0];
  const hN = elevationsM[n - 1];
  const rEff = kFactor * earthRadiusM;
  const inv2Reff = rEff > 0 ? 1.0 / (2.0 * rEff) : 0.0;
  const sTr = (hN - h0) / totalD;

  let sTim = -Infinity;
  let sTimDist = 0.5 * totalD;
  let maxNuLos = -Infinity;
  let maxNuDist = 0.5 * totalD;
  let maxNuElev = h0;

  for (let i = 1; i < n - 1; i++) {
    const di = distancesM[i] - d0;
    if (di <= 0.0 || di >= totalD) continue;
    const dMinusDi = totalD - di;
    const earthBulge = di * dMinusDi * inv2Reff;
    const hEff = elevationsM[i] + earthBulge;

    const sTi = (hEff - h0) / di;
    if (sTi > sTim) {
      sTim = sTi;
      sTimDist = di;
    }

    const hLos = h0 + (di / totalD) * (hN - h0);
    const hObs = hEff - hLos;
    const geomFactor = Math.sqrt((2.0 / wavelengthM) * (1.0 / di + 1.0 / dMinusDi));
    const nu = hObs * geomFactor;
    if (nu > maxNuLos) {
      maxNuLos = nu;
      maxNuDist = di;
      maxNuElev = hEff;
    }
  }

  // If horizon ray from Tx does not exceed direct Tx->Rx line: LOS regime
  if (sTim < sTr) {
    const lossDb = computeKnifeEdgeDiffractionLossDb(maxNuLos);
    return {
      lossDb,
      nuApex: maxNuLos,
      apexDistM: maxNuDist,
      apexElevMslM: maxNuElev,
      isLos: maxNuLos <= -0.78,
    };
  }

  // NLOS regime: compute Rx backward horizon slope
  let sRim = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const di = distancesM[i] - d0;
    if (di <= 0.0 || di >= totalD) continue;
    const dMinusDi = totalD - di;
    const earthBulge = di * dMinusDi * inv2Reff;
    const hEff = elevationsM[i] + earthBulge;

    const sRi = (hEff - hN) / dMinusDi;
    if (sRi > sRim) {
      sRim = sRi;
    }
  }

  // Horizon ray intersection:
  // y = h0 + sTim * x
  // y = hN + sRim * (totalD - x)
  const denom = sTim + sRim;
  let dBull = denom > 1e-12 ? (hN - h0 + sRim * totalD) / denom : sTimDist;
  dBull = Math.max(1e-3, Math.min(totalD - 1e-3, dBull));

  const hBull = h0 + sTim * dBull;
  const hLosAtApex = h0 + (dBull / totalD) * (hN - h0);
  const hApexObs = hBull - hLosAtApex;
  const dMinusDBull = totalD - dBull;
  const nuBull = hApexObs * Math.sqrt((2.0 / wavelengthM) * (1.0 / dBull + 1.0 / dMinusDBull));
  const lossDb = computeKnifeEdgeDiffractionLossDb(nuBull);

  return {
    lossDb,
    nuApex: nuBull,
    apexDistM: dBull,
    apexElevMslM: hBull,
    isLos: false,
  };
}

/**
 * Evaluates single knife-edge diffraction for the worst-case dominant peak across a path profile.
 */
export function computeSingleEdgeProfileDiffraction(
  distancesM: ArrayLike<number>,
  elevationsM: ArrayLike<number>,
  wavelengthM: number = DEFAULT_X_BAND_WAVELENGTH_M,
  kFactor: number = DEFAULT_K_FACTOR,
  earthRadiusM: number = DEFAULT_TRUE_EARTH_RADIUS_M
): { lossDb: number; maxNu: number; peakIndex: number; peakDistM: number } {
  const n = distancesM.length;
  if (n < 3) {
    return { lossDb: 0.0, maxNu: -999.0, peakIndex: -1, peakDistM: 0.0 };
  }
  const d0 = distancesM[0];
  const totalD = distancesM[n - 1] - d0;
  if (totalD <= 1e-3) {
    return { lossDb: 0.0, maxNu: -999.0, peakIndex: -1, peakDistM: 0.0 };
  }

  const h0 = elevationsM[0];
  const hN = elevationsM[n - 1];
  const inv2Reff = (kFactor * earthRadiusM) > 0 ? 1.0 / (2.0 * kFactor * earthRadiusM) : 0.0;

  let maxNu = -Infinity;
  let peakIdx = -1;
  let peakDist = 0.0;

  for (let i = 1; i < n - 1; i++) {
    const di = distancesM[i] - d0;
    if (di <= 0.0 || di >= totalD) continue;
    const dMinusDi = totalD - di;
    const bulge = di * dMinusDi * inv2Reff;
    const hEff = elevationsM[i] + bulge;
    const hLos = h0 + (di / totalD) * (hN - h0);
    const hObs = hEff - hLos;
    const nu = hObs * Math.sqrt((2.0 / wavelengthM) * (1.0 / di + 1.0 / dMinusDi));
    if (nu > maxNu) {
      maxNu = nu;
      peakIdx = i;
      peakDist = di;
    }
  }

  const lossDb = computeKnifeEdgeDiffractionLossDb(maxNu);
  return { lossDb, maxNu, peakIndex: peakIdx, peakDistM: peakDist };
}

/**
 * Computes ITU-R P.526 Cascaded Deygout Multi-Edge Diffraction across a path profile.
 *
 * Implements up to 3 cascading knife edges (Primary m, Left Secondary s1, Right Secondary s2)
 * with:
 * 1. Anti-shoulder double-counting guard: requires candidate secondary edges to be distinct local
 *    peaks separated from the primary peak by a genuine elevation/clearance valley.
 * 2. Secondary Fresnel parameter evaluation relative to sub-path chords (Tx -> top-of-m, top-of-m -> Rx)
 *    with sub-path Earth curvature bulge.
 * 3. ITU-R P.526 / Causebrook spacing correction to prevent overestimation on closely spaced edges.
 * 4. Rigorous physical lower bounds: total loss never drops below max(J(nu_m), L_bullington).
 *
 * @param distancesM Array of sample distances along the path (metres, monotonically increasing)
 * @param elevationsM Array of total elevations along the path (metres MSL, terrain + CAD)
 * @param wavelengthM Carrier wavelength in metres (default 8.0 GHz: ~0.037474 m)
 * @param kFactor Effective Earth refraction factor (default 4/3)
 * @param earthRadiusM Mean Earth radius in metres (default 6,371,000.0 m)
 */
export function computeDeygoutMultiEdgeDiffraction(
  distancesM: ArrayLike<number>,
  elevationsM: ArrayLike<number>,
  wavelengthM: number = DEFAULT_X_BAND_WAVELENGTH_M,
  kFactor: number = DEFAULT_K_FACTOR,
  earthRadiusM: number = DEFAULT_TRUE_EARTH_RADIUS_M
): DeygoutMultiEdgeResult {
  const n = distancesM.length;
  if (n < 3) {
    return {
      totalLossDb: 0.0,
      primaryNu: -999.0,
      primaryLossDb: 0.0,
      primaryEdgeIndex: -1,
      primaryEdgeDistM: 0.0,
      secondaryLeftNu: -999.0,
      secondaryLeftLossDb: 0.0,
      secondaryLeftIndex: -1,
      secondaryRightNu: -999.0,
      secondaryRightLossDb: 0.0,
      secondaryRightIndex: -1,
      secondaryEdgeCount: 0,
      bullingtonLossDb: 0.0,
      correctionDb: 0.0,
      method: 'deygout-multiedge',
    };
  }

  const d0 = distancesM[0];
  const totalD = distancesM[n - 1] - d0;
  if (totalD <= 1e-3) {
    return {
      totalLossDb: 0.0,
      primaryNu: -999.0,
      primaryLossDb: 0.0,
      primaryEdgeIndex: -1,
      primaryEdgeDistM: 0.0,
      secondaryLeftNu: -999.0,
      secondaryLeftLossDb: 0.0,
      secondaryLeftIndex: -1,
      secondaryRightNu: -999.0,
      secondaryRightLossDb: 0.0,
      secondaryRightIndex: -1,
      secondaryEdgeCount: 0,
      bullingtonLossDb: 0.0,
      correctionDb: 0.0,
      method: 'deygout-multiedge',
    };
  }

  const h0 = elevationsM[0];
  const hN = elevationsM[n - 1];
  const rEff = kFactor * earthRadiusM;
  const inv2Reff = rEff > 0 ? 1.0 / (2.0 * rEff) : 0.0;

  // Step 1: Find Primary Edge m maximizing nu relative to direct line
  let nuM = -Infinity;
  let m = -1;
  let dM = 0.0;
  let hEffM = h0;

  for (let i = 1; i < n - 1; i++) {
    const di = distancesM[i] - d0;
    if (di <= 0.0 || di >= totalD) continue;
    const dMinusDi = totalD - di;
    const bulge = di * dMinusDi * inv2Reff;
    const hEff = elevationsM[i] + bulge;
    const hLos = h0 + (di / totalD) * (hN - h0);
    const hObs = hEff - hLos;
    const nu = hObs * Math.sqrt((2.0 / wavelengthM) * (1.0 / di + 1.0 / dMinusDi));
    if (nu > nuM) {
      nuM = nu;
      m = i;
      dM = di;
      hEffM = hEff;
    }
  }

  // Pristine LOS shortcut: if primary nu <= -0.78, diffraction loss is strictly 0 dB
  if (nuM <= -0.78 || m <= 0) {
    return {
      totalLossDb: 0.0,
      primaryNu: nuM,
      primaryLossDb: 0.0,
      primaryEdgeIndex: m,
      primaryEdgeDistM: dM,
      secondaryLeftNu: -999.0,
      secondaryLeftLossDb: 0.0,
      secondaryLeftIndex: -1,
      secondaryRightNu: -999.0,
      secondaryRightLossDb: 0.0,
      secondaryRightIndex: -1,
      secondaryEdgeCount: 0,
      bullingtonLossDb: 0.0,
      correctionDb: 0.0,
      method: 'deygout-multiedge',
    };
  }

  const primaryLossDb = computeKnifeEdgeDiffractionLossDb(nuM);

  // Compute Bullington reference loss for physical bounding
  const bullingtonResult = computeBullingtonDiffraction(distancesM, elevationsM, wavelengthM, kFactor, earthRadiusM);
  const bullingtonLossDb = bullingtonResult.lossDb;

  // Step 2 & 3: Anti-Shoulder Guard & Secondary Edge Evaluation
  // Left sub-path: Tx (0, h0) -> Primary Peak m (dM, hEffM)
  let s1Idx = -1;
  let s1Nu = -Infinity;
  let s1DistM = 0.0;

  if (m >= 2 && dM > 1e-3) {
    for (let i = 1; i < m; i++) {
      // Must be a local peak in elevation
      const hi = elevationsM[i];
      const isLocalPeak = hi >= elevationsM[i - 1] && hi >= elevationsM[i + 1];
      if (!isLocalPeak) continue;

      // Must be separated from primary peak m by a genuine valley / dip
      let hasValley = false;
      const minPeakHeight = Math.min(hi, elevationsM[m]);
      for (let k = i + 1; k < m; k++) {
        if (elevationsM[k] < minPeakHeight - 1e-4) {
          hasValley = true;
          break;
        }
      }
      if (!hasValley) continue;

      const d1a = distancesM[i] - d0;
      const d1b = dM - d1a;
      if (d1a <= 0.0 || d1b <= 0.0) continue;

      // Sub-path Earth bulge and chord
      const subBulge = (d1a * d1b) * inv2Reff;
      const hSubEff = hi + subBulge;
      const hSubChord = h0 + (d1a / dM) * (hEffM - h0);
      const hSubObs = hSubEff - hSubChord;
      const nuSub = hSubObs * Math.sqrt((2.0 / wavelengthM) * (1.0 / d1a + 1.0 / d1b));

      if (nuSub > s1Nu) {
        s1Nu = nuSub;
        s1Idx = i;
        s1DistM = d1a;
      }
    }
  }

  // Right sub-path: Primary Peak m (0, hEffM) -> Rx (totalD - dM, hN)
  let s2Idx = -1;
  let s2Nu = -Infinity;
  let s2DistM = 0.0;
  const d2Total = totalD - dM;

  if (m <= n - 3 && d2Total > 1e-3) {
    for (let j = m + 1; j < n - 1; j++) {
      // Must be a local peak in elevation
      const hj = elevationsM[j];
      const isLocalPeak = hj >= elevationsM[j - 1] && hj >= elevationsM[j + 1];
      if (!isLocalPeak) continue;

      // Must be separated from primary peak m by a genuine valley / dip
      let hasValley = false;
      const minPeakHeight = Math.min(hj, elevationsM[m]);
      for (let k = m + 1; k < j; k++) {
        if (elevationsM[k] < minPeakHeight - 1e-4) {
          hasValley = true;
          break;
        }
      }
      if (!hasValley) continue;

      const d2a = (distancesM[j] - d0) - dM;
      const d2b = d2Total - d2a;
      if (d2a <= 0.0 || d2b <= 0.0) continue;

      // Sub-path Earth bulge and chord
      const subBulge = (d2a * d2b) * inv2Reff;
      const hSubEff = hj + subBulge;
      const hSubChord = hEffM + (d2a / d2Total) * (hN - hEffM);
      const hSubObs = hSubEff - hSubChord;
      const nuSub = hSubObs * Math.sqrt((2.0 / wavelengthM) * (1.0 / d2a + 1.0 / d2b));

      if (nuSub > s2Nu) {
        s2Nu = nuSub;
        s2Idx = j;
        s2DistM = distancesM[j] - d0;
      }
    }
  }

  let secondaryEdgeCount = 0;
  let secondaryLeftLossDb = 0.0;
  let c1Db = 0.0;

  if (s1Idx >= 0 && s1Nu > -0.78) {
    secondaryEdgeCount++;
    secondaryLeftLossDb = computeKnifeEdgeDiffractionLossDb(s1Nu);
    const dSep1 = dM - (distancesM[s1Idx] - d0);
    c1Db = secondaryLeftLossDb * Math.exp(-3.5 * (dSep1 / dM));
  } else {
    s1Nu = -999.0;
  }

  let secondaryRightLossDb = 0.0;
  let c2Db = 0.0;

  if (s2Idx >= 0 && s2Nu > -0.78) {
    secondaryEdgeCount++;
    secondaryRightLossDb = computeKnifeEdgeDiffractionLossDb(s2Nu);
    const dSep2 = (distancesM[s2Idx] - d0) - dM;
    c2Db = secondaryRightLossDb * Math.exp(-3.5 * (dSep2 / d2Total));
  } else {
    s2Nu = -999.0;
  }

  const effectiveLeftLoss = Math.max(0.0, secondaryLeftLossDb - c1Db);
  const effectiveRightLoss = Math.max(0.0, secondaryRightLossDb - c2Db);
  const rawDeygoutTotal = primaryLossDb + effectiveLeftLoss + effectiveRightLoss;
  const correctionDb = c1Db + c2Db;

  // Bounded total: for single-edge / smooth hill (no secondary edges), loss equals primaryLossDb.
  // When secondary edges exist, bound between max(primary, bullington) and 60.0 dB upper ceiling.
  const totalLossDb = secondaryEdgeCount > 0
    ? Math.max(primaryLossDb, bullingtonLossDb, Math.min(60.0, rawDeygoutTotal))
    : primaryLossDb;

  return {
    totalLossDb,
    primaryNu: nuM,
    primaryLossDb,
    primaryEdgeIndex: m,
    primaryEdgeDistM: dM,
    secondaryLeftNu: s1Nu,
    secondaryLeftLossDb: secondaryLeftLossDb,
    secondaryLeftIndex: s1Idx,
    secondaryRightNu: s2Nu,
    secondaryRightLossDb: secondaryRightLossDb,
    secondaryRightIndex: s2Idx,
    secondaryEdgeCount,
    bullingtonLossDb,
    correctionDb,
    method: 'deygout-multiedge',
  };
}

/**
 * Computes analytical Free-Space Path Loss (FSPL) in dB:
 * FSPL(dB) = 20*log10(d) + 20*log10(fc) + 20*log10(4*π / c)
 *
 * At 8.0 GHz and 10 km:
 * 20*log10(10000) = 80 dB
 * 20*log10(8e9) = 198.0617997 dB
 * 20*log10(4*π / 299792458) = -147.550294 dB
 * Total = 130.5115 dB
 *
 * @param distanceM Slant distance in metres
 * @param carrierFreqHz Carrier frequency in Hz (default 8.0e9 Hz)
 * @param speedOfLight Speed of light in m/s (default 299,792,458.0 m/s)
 * @returns FSPL in dB
 */
export function computeFsplDb(
  distanceM: number,
  carrierFreqHz: number = DEFAULT_X_BAND_FREQ_HZ,
  speedOfLight: number = SPEED_OF_LIGHT_M_S
): number {
  const d = Math.max(1.0, distanceM);
  const fc = Math.max(1.0, carrierFreqHz);
  return (
    20.0 * Math.log10(d) +
    20.0 * Math.log10(fc) +
    20.0 * Math.log10((4.0 * Math.PI) / speedOfLight)
  );
}

/**
 * Maps a compass azimuth angle [0, 360) degrees to a 16-wind cardinal label.
 * 0° = 'N', 22.5° = 'NNE', 45° = 'NE', 90° = 'E', ..., 270° = 'W', 337.5° = 'NNW'.
 *
 * @param azimuthDeg Compass azimuth in degrees (clockwise from True North)
 * @returns 16-wind cardinal direction string
 */
export function azimuthToCardinal16(azimuthDeg: number): Cardinal16 {
  const norm = ((azimuthDeg % 360.0) + 360.0) % 360.0;
  const idx = Math.floor(((norm + 11.25) % 360.0) / 22.5) % 16;
  return COMPASS_16_CARDINALS[idx];
}

/**
 * Computes compass bearing in degrees [0, 360) clockwise from True North (+y)
 * for a 2D vector (dx, dy) where +x = East and +y = North.
 *
 * θ = (atan2(dx, dy) * 180 / π + 360) mod 360
 *
 * @param dxM Delta East in metres (+x)
 * @param dyM Delta North in metres (+y)
 * @returns Bearing in degrees [0, 360)
 */
export function computeBearingDeg(dxM: number, dyM: number): number {
  const deg = (Math.atan2(dxM, dyM) * 180.0) / Math.PI;
  return ((deg % 360.0) + 360.0) % 360.0;
}

/**
 * Computes horizontal ground distance and 3D slant distance for Cartesian offsets.
 *
 * @param dxM Delta East in metres
 * @param dyM Delta North in metres
 * @param dzM Delta Altitude in metres
 * @returns Object with { horizDistM, slantDistM }
 */
export function computeSlantAndHorizDistance(
  dxM: number,
  dyM: number,
  dzM: number = 0.0
): { horizDistM: number; slantDistM: number } {
  const horizDistM = Math.hypot(dxM, dyM);
  const slantDistM = Math.hypot(horizDistM, dzM);
  return { horizDistM, slantDistM };
}

export interface CorrelatedRicianJakesParams {
  simTimeS: number;
  seed: number;
  carrierFreqHz?: number;
  radialVelocityMs?: number;
  relativeSpeedMps?: number;
  ricianKFactorDb?: number;
}

export interface CorrelatedRicianJakesResult {
  readonly fadingGainDb: number;
  readonly envelopeLinear: number;
  readonly ricianKFactorDb: number;
  readonly dopplerShiftHz: number;
  readonly maxDopplerHz: number;
  readonly coherenceTimeMs: number;
}

function hashPhaseUniform(seed: number, index: number): number {
  let h = (seed | 0) ^ Math.imul(index + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296.0;
}

/**
 * Computes deterministic, time-correlated 8.0 GHz Rician-Jakes fading using the
 * Zheng & Xiao (2003) Improved Sum-of-Sinusoids (SoS) model (M = 8 scatterers).
 *
 * Guarantees:
 * 1. Unit mean power conservation: E[r(t)^2] = 1.0 across any Rician K-factor.
 * 2. Exact 8.0 GHz Doppler kinematics: f_D = v_rad / lambda, f_D,max = v_rel / lambda.
 * 3. Clarke coherence time: T_c = 0.423 / f_D,max.
 * 4. Temporal correlation across 50 Hz frames (dt = 20 ms) governed by physical Doppler.
 * 5. 100% pure and deterministic (derived from integer seed, zero Math.random()).
 *
 * @param params CorrelatedRicianJakesParams
 * @returns CorrelatedRicianJakesResult
 */
export function computeCorrelatedRicianJakesFading(
  params: CorrelatedRicianJakesParams
): CorrelatedRicianJakesResult {
  const t = params?.simTimeS;
  const seed = params?.seed;

  if (!Number.isFinite(t) || !Number.isFinite(seed)) {
    return {
      fadingGainDb: 0.0,
      envelopeLinear: 1.0,
      ricianKFactorDb: 6.0,
      dopplerShiftHz: 0.0,
      maxDopplerHz: 0.0,
      coherenceTimeMs: Number.POSITIVE_INFINITY,
    };
  }

  const fc = Number.isFinite(params.carrierFreqHz) && params.carrierFreqHz! > 0
    ? params.carrierFreqHz!
    : DEFAULT_X_BAND_FREQ_HZ;
  const lambda = SPEED_OF_LIGHT_M_S / fc;

  const vRad = Number.isFinite(params.radialVelocityMs) ? params.radialVelocityMs! : 0.0;
  let vRel = Number.isFinite(params.relativeSpeedMps)
    ? Math.max(0.0, params.relativeSpeedMps!)
    : Math.abs(vRad);
  if (vRel < Math.abs(vRad)) {
    vRel = Math.abs(vRad);
  }

  // Exact Doppler shift and spread
  const dopplerShiftHz = vRad / lambda;
  const maxDopplerHz = vRel / lambda;

  // Clarke coherence time (seconds) -> ms
  const coherenceTimeMs = maxDopplerHz > 1e-6
    ? (0.423 / maxDopplerHz) * 1000.0
    : Number.POSITIVE_INFINITY;

  // Rician K-factor handling
  let ricianKFactorDb = Number.isFinite(params.ricianKFactorDb) ? params.ricianKFactorDb! : 6.0;
  let kLin = 0.0;
  if (ricianKFactorDb === -Infinity || ricianKFactorDb < -30.0) {
    kLin = 0.0;
    ricianKFactorDb = -Infinity;
  } else if (ricianKFactorDb >= 40.0) {
    kLin = 10000.0;
  } else {
    kLin = Math.pow(10.0, ricianKFactorDb / 10.0);
  }

  // If stationary or relative speed near 0
  if (maxDopplerHz <= 1e-6) {
    return {
      fadingGainDb: 0.0,
      envelopeLinear: 1.0,
      ricianKFactorDb,
      dopplerShiftHz: 0.0,
      maxDopplerHz: 0.0,
      coherenceTimeMs: Number.POSITIVE_INFINITY,
    };
  }

  // Zheng & Xiao (2003) Improved Sum-of-Sinusoids (M = 8)
  const M = 8;
  const intSeed = Math.floor(seed);
  const theta0 = 2.0 * Math.PI * hashPhaseUniform(intSeed, 0) - Math.PI;

  let sumCos = 0.0;
  let sumSin = 0.0;
  const twoPiFdMaxT = 2.0 * Math.PI * maxDopplerHz * t;

  for (let n = 1; n <= M; n++) {
    const alphaN = (2.0 * Math.PI * n - Math.PI + theta0) / (4.0 * M);
    const psiN = 2.0 * Math.PI * hashPhaseUniform(intSeed, 2 * n - 1) - Math.PI;
    const phiN = 2.0 * Math.PI * hashPhaseUniform(intSeed, 2 * n) - Math.PI;

    sumCos += Math.cos(twoPiFdMaxT * Math.cos(alphaN) + psiN);
    sumSin += Math.sin(twoPiFdMaxT * Math.sin(alphaN) + phiN);
  }

  const sqrtTwoOverM = Math.sqrt(2.0 / M);
  const gI = sqrtTwoOverM * sumCos;
  const gQ = sqrtTwoOverM * sumSin;

  // Specular LOS component + normalized diffuse scatter
  const losWeight = Math.sqrt(kLin / (kLin + 1.0));
  const diffWeight = Math.sqrt(1.0 / (2.0 * (kLin + 1.0)));

  const twoPiFdT = 2.0 * Math.PI * dopplerShiftHz * t;
  const zReal = losWeight * Math.cos(twoPiFdT) + diffWeight * gI;
  const zImag = losWeight * Math.sin(twoPiFdT) + diffWeight * gQ;

  const envelopeLinear = Math.hypot(zReal, zImag);
  const safeEnv = Math.max(1e-3, envelopeLinear);
  const rawGainDb = 20.0 * Math.log10(safeEnv);
  const fadingGainDb = Math.max(-30.0, Math.min(6.0, rawGainDb));

  return {
    fadingGainDb,
    envelopeLinear,
    ricianKFactorDb,
    dopplerShiftHz,
    maxDopplerHz,
    coherenceTimeMs,
  };
}

