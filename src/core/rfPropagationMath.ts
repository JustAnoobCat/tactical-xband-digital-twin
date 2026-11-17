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
