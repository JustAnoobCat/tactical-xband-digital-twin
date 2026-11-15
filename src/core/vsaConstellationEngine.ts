/**
 * src/core/vsaConstellationEngine.ts
 *
 * First-Principles DVB-S2X (ETSI EN 302 307-2) Baseband I/Q Constellation,
 * Analytical EVM, Carrier Phase Jitter, and LDPC Waterfall BLER Engine.
 *
 * Modeled after Keysight 89600 VSA and Rohde & Schwarz VSE Vector Signal Analyzers.
 */

import { MODCOD_TABLE, type ModCodEntry } from './linkBudget.js';

export interface IqPoint {
  readonly i: number;
  readonly q: number;
}

export interface VsaConstellationInfo {
  readonly modcodName: string;
  readonly constellationType: string;
  readonly modulationOrder: number; // M-ary (2, 4, 8, 16, 32, 64)
  readonly spectralEfficiencyBpsHz: number;
  readonly minSnrDb: number;
}

export interface VsaTerminalMetrics {
  readonly sinrDb: number;
  readonly snrMarginDb: number;
  readonly evmRmsPct: number;
  readonly evmDb: number;
  readonly phaseErrorDeg: number;
  readonly ldpcBler: number;
  readonly isLock: boolean;
  readonly constellationInfo: VsaConstellationInfo;
  readonly referenceConstellation: readonly IqPoint[];
  readonly receivedSymbols: readonly IqPoint[];
}

export interface VsaEvaluationParams {
  readonly snrDb: number;
  readonly minSnrDb?: number;
  readonly ricianKDb?: number;
  readonly dopplerShiftHz?: number;
  readonly modcodName?: string;
  readonly isOutage?: boolean;
  readonly seed?: number;
}

/**
 * Normalizes an array of I/Q points so that average symbol energy E_avg = (1/M) sum (|s_k|^2) === 1.000000.
 */
function normalizeToUnitAverageEnergy(points: readonly IqPoint[]): IqPoint[] {
  if (points.length === 0) return [];
  let sumEnergy = 0;
  for (let k = 0; k < points.length; k++) {
    sumEnergy += points[k].i * points[k].i + points[k].q * points[k].q;
  }
  const meanEnergy = sumEnergy / points.length;
  if (meanEnergy <= 1e-12) return points.map((p) => ({ i: p.i, q: p.q }));
  const scale = 1.0 / Math.sqrt(meanEnergy);
  return points.map((p) => ({
    i: p.i * scale,
    q: p.q * scale,
  }));
}

/**
 * Returns canonical unit-energy DVB-S2X reference constellations.
 *
 * Supported Constellations:
 * - QPSK: 4 points on unit circle at +/-45 deg, +/-135 deg: (+/-1/sqrt(2), +/-1/sqrt(2)).
 * - 8-PSK: 8 points on unit circle at theta_k = k * pi / 4.
 * - 16-QAM: 4x4 rectangular QAM lattice {-3, -1, 1, 3}^2 / sqrt(10).
 * - 16-APSK: ETSI EN 302 307-1 concentric 4+12 ring geometry (gamma = R2/R1 = 2.60) normalized to unit energy.
 * - 32-APSK: ETSI EN 302 307-1 concentric 4+12+16 3-ring geometry (gamma1 = 2.54, gamma2 = 4.33) normalized to unit energy.
 * - 64-QAM / 64-APSK: 8x8 square QAM lattice {-7, -5, -3, -1, 1, 3, 5, 7}^2 / sqrt(42).
 * - pi/2-BPSK / BPSK: 2 points on unit circle (+/-1, 0).
 */
export function getReferenceConstellation(modcodName: string): readonly IqPoint[] {
  const norm = String(modcodName || '').toUpperCase().trim();

  // 1. 64-QAM / 64-APSK: 8x8 square QAM lattice normalized by 1/sqrt(42)
  if (norm.includes('64') || norm.includes('64-APSK') || norm.includes('64-QAM') || norm.includes('64APSK') || norm.includes('64QAM')) {
    const points: IqPoint[] = [];
    const scale = 1.0 / Math.sqrt(42.0);
    const coords = [-7, -5, -3, -1, 1, 3, 5, 7];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        points.push({
          i: coords[c] * scale,
          q: coords[r] * scale,
        });
      }
    }
    return normalizeToUnitAverageEnergy(points);
  }

  // 2. 32-APSK: ETSI EN 302 307-1 concentric 4+12+16 rings
  if (norm.includes('32') || norm.includes('32-APSK') || norm.includes('32APSK')) {
    const gamma1 = 2.54;
    const gamma2 = 4.33;
    // E_avg = (4*R1^2 + 12*(gamma1*R1)^2 + 16*(gamma2*R1)^2) / 32
    // R1 = sqrt( 32 / (4 + 12*gamma1^2 + 16*gamma2^2) )
    const denom = 4.0 + 12.0 * (gamma1 * gamma1) + 16.0 * (gamma2 * gamma2);
    const r1 = Math.sqrt(32.0 / denom);
    const r2 = gamma1 * r1;
    const r3 = gamma2 * r1;

    const points: IqPoint[] = [];
    // Ring 1: 4 points at r1
    for (let k = 0; k < 4; k++) {
      const angle = (Math.PI / 4.0) + k * (Math.PI / 2.0);
      points.push({ i: r1 * Math.cos(angle), q: r1 * Math.sin(angle) });
    }
    // Ring 2: 12 points at r2
    for (let m = 0; m < 12; m++) {
      const angle = (Math.PI / 12.0) + m * (Math.PI / 6.0);
      points.push({ i: r2 * Math.cos(angle), q: r2 * Math.sin(angle) });
    }
    // Ring 3: 16 points at r3
    for (let p = 0; p < 16; p++) {
      const angle = (Math.PI / 16.0) + p * (Math.PI / 8.0);
      points.push({ i: r3 * Math.cos(angle), q: r3 * Math.sin(angle) });
    }
    return normalizeToUnitAverageEnergy(points);
  }

  // 3. 16-QAM vs 16-APSK
  if (norm.includes('16-QAM') || norm.includes('16QAM') || norm.includes('QAM16') || norm.includes('QAM-16')) {
    const points: IqPoint[] = [];
    const scale = 1.0 / Math.sqrt(10.0);
    const coords = [-3, -1, 1, 3];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        points.push({
          i: coords[c] * scale,
          q: coords[r] * scale,
        });
      }
    }
    return normalizeToUnitAverageEnergy(points);
  }

  if (norm.includes('16') || norm.includes('16-APSK') || norm.includes('16APSK')) {
    // ETSI EN 302 307-1 concentric 4+12 ring geometry (gamma = R2/R1 = 2.60)
    const gamma = 2.60;
    // E_avg = (4*R1^2 + 12*(gamma*R1)^2) / 16 = R1^2 * (1 + 3*gamma^2) / 4 === 1
    const r1 = Math.sqrt(4.0 / (1.0 + 3.0 * gamma * gamma));
    const r2 = gamma * r1;

    const points: IqPoint[] = [];
    // Inner ring (4 points)
    for (let k = 0; k < 4; k++) {
      const angle = (Math.PI / 4.0) + k * (Math.PI / 2.0);
      points.push({ i: r1 * Math.cos(angle), q: r1 * Math.sin(angle) });
    }
    // Outer ring (12 points)
    for (let m = 0; m < 12; m++) {
      const angle = (Math.PI / 12.0) + m * (Math.PI / 6.0);
      points.push({ i: r2 * Math.cos(angle), q: r2 * Math.sin(angle) });
    }
    return normalizeToUnitAverageEnergy(points);
  }

  // 4. 8-PSK: 8 points on unit circle at theta_k = k * pi / 4
  if (norm.includes('8-PSK') || norm.includes('8PSK') || norm.includes('8 PSK') || norm.includes('8')) {
    const points: IqPoint[] = [];
    for (let k = 0; k < 8; k++) {
      const angle = k * (Math.PI / 4.0);
      points.push({ i: Math.cos(angle), q: Math.sin(angle) });
    }
    return normalizeToUnitAverageEnergy(points);
  }

  // 5. BPSK / pi/2-BPSK: 2 points on unit circle
  if (norm.includes('BPSK') || norm.includes('PI/2-BPSK') || norm.includes('PI/2 BPSK')) {
    return [
      { i: -1.0, q: 0.0 },
      { i: 1.0, q: 0.0 },
    ];
  }

  // 6. Default / QPSK: 4 points on unit circle at +/-45 deg, +/-135 deg: (+/-1/sqrt(2), +/-1/sqrt(2))
  const invSqrt2 = 1.0 / Math.SQRT2;
  return [
    { i: invSqrt2, q: invSqrt2 },
    { i: -invSqrt2, q: invSqrt2 },
    { i: -invSqrt2, q: -invSqrt2 },
    { i: invSqrt2, q: -invSqrt2 },
  ];
}

/**
 * Resolves full DVB-S2X constellation metadata from MODCOD name or table.
 */
export function resolveConstellationInfo(modcodName?: string): VsaConstellationInfo {
  const norm = String(modcodName || '').toUpperCase().trim();
  const matchedEntry: ModCodEntry | undefined = MODCOD_TABLE.find(
    (m) => m.name.toUpperCase().trim() === norm || norm.includes(m.name.toUpperCase().trim())
  );

  let constellationType = 'QPSK';
  let modulationOrder = 4;
  let spectralEfficiency = matchedEntry?.spectralEfficiencyBpsHz ?? 1.49;
  let minSnrDb = matchedEntry?.minSnrDb ?? 5.5;

  if (norm.includes('64')) {
    constellationType = norm.includes('QAM') ? '64-QAM' : '64-APSK';
    modulationOrder = 64;
    spectralEfficiency = matchedEntry?.spectralEfficiencyBpsHz ?? 4.95;
    minSnrDb = matchedEntry?.minSnrDb ?? 22.0;
  } else if (norm.includes('32')) {
    constellationType = '32-APSK';
    modulationOrder = 32;
    spectralEfficiency = matchedEntry?.spectralEfficiencyBpsHz ?? 3.70;
    minSnrDb = matchedEntry?.minSnrDb ?? 17.5;
  } else if (norm.includes('16-QAM') || norm.includes('16QAM') || norm.includes('QAM16')) {
    constellationType = '16-QAM';
    modulationOrder = 16;
    spectralEfficiency = matchedEntry?.spectralEfficiencyBpsHz ?? 3.16;
    minSnrDb = matchedEntry?.minSnrDb ?? 14.0;
  } else if (norm.includes('16')) {
    constellationType = '16-APSK';
    modulationOrder = 16;
    spectralEfficiency = matchedEntry?.spectralEfficiencyBpsHz ?? 2.64;
    minSnrDb = matchedEntry?.minSnrDb ?? 11.5;
  } else if (norm.includes('8-PSK') || norm.includes('8PSK') || norm.includes('8')) {
    constellationType = '8-PSK';
    modulationOrder = 8;
    spectralEfficiency = matchedEntry?.spectralEfficiencyBpsHz ?? 1.78;
    minSnrDb = matchedEntry?.minSnrDb ?? 8.0;
  } else if (norm.includes('BPSK')) {
    constellationType = 'pi/2-BPSK';
    modulationOrder = 2;
    spectralEfficiency = matchedEntry?.spectralEfficiencyBpsHz ?? 0.33;
    minSnrDb = matchedEntry?.minSnrDb ?? -1.5;
  } else {
    constellationType = 'QPSK';
    modulationOrder = 4;
    spectralEfficiency = matchedEntry?.spectralEfficiencyBpsHz ?? 1.49;
    minSnrDb = matchedEntry?.minSnrDb ?? 5.5;
  }

  return {
    modcodName: matchedEntry?.name ?? (modcodName || 'QPSK 3/4'),
    constellationType,
    modulationOrder,
    spectralEfficiencyBpsHz: spectralEfficiency,
    minSnrDb,
  };
}

/**
 * Simple 32-bit PRNG (Mulberry32) for deterministic, reproducible symbol sampling.
 */
function createPrng(seed: number): () => number {
  let s = (seed ^ 0x12345678) >>> 0;
  return function (): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard Box-Muller transform for zero-mean, unit-variance Gaussian random variables.
 */
function sampleGaussian(prng: () => number): [number, number] {
  let u1 = prng();
  while (u1 <= 1e-7) u1 = prng();
  const u2 = prng();
  const radius = Math.sqrt(-2.0 * Math.log(u1));
  const theta = 2.0 * Math.PI * u2;
  return [radius * Math.cos(theta), radius * Math.sin(theta)];
}

/**
 * Deterministic Noisy I/Q Symbol Cloud Generator.
 *
 * Synthesizes N_sym = 64 received complex symbols:
 *   r_m = s_{k(m)} * exp(j * Delta_theta_m) + (n_{I,m} + j * n_{Q,m})
 *
 * where s_k is drawn from the reference constellation, Delta_theta_m ~ N(0, sigma_theta^2),
 * and n_I, n_Q ~ N(0, sigma_n^2 / 2).
 */
export function sampleNoisyIqSymbols(
  referenceConstellation: readonly IqPoint[],
  sigmaN: number,
  phaseJitterRad: number,
  symbolCount: number = 64,
  seed: number = 42
): IqPoint[] {
  if (referenceConstellation.length === 0) return [];
  const prng = createPrng(seed);
  const symbols: IqPoint[] = [];
  const M = referenceConstellation.length;
  const noiseScale = sigmaN / Math.SQRT2;

  for (let m = 0; m < symbolCount; m++) {
    const k = m % M;
    const ref = referenceConstellation[k];

    // Residual carrier phase jitter
    const [zTheta] = sampleGaussian(prng);
    const deltaTheta = zTheta * phaseJitterRad;
    const cosTheta = Math.cos(deltaTheta);
    const sinTheta = Math.sin(deltaTheta);

    // Rotated ideal symbol
    const rotI = ref.i * cosTheta - ref.q * sinTheta;
    const rotQ = ref.i * sinTheta + ref.q * cosTheta;

    // Additive white Gaussian noise (AWGN)
    const [zI, zQ] = sampleGaussian(prng);
    const nI = zI * noiseScale;
    const nQ = zQ * noiseScale;

    symbols.push({
      i: rotI + nI,
      q: rotQ + nQ,
    });
  }

  return symbols;
}

/**
 * First-Principles Error Vector Magnitude (EVM_rms), Carrier Phase Jitter,
 * and Post-LDPC Block Error Rate (BLER) Evaluator.
 *
 * Implements:
 * 1. gamma_lin = 10^(gamma_dB / 10.0), sigma_n^2 = 1 / max(gamma_lin, 0.01)
 * 2. EVM_rms,pct = clamp[0.5, 100.0] (100.0 * sqrt(1 / max(gamma_lin, 0.01))) [%], EVM_dB = -gamma_dB
 * 3. sigma_theta,deg = clamp[0.1, 45.0] ( (180 / pi) * sqrt( 1 / (2 * max(gamma_lin, 0.1)) + 0.002 * (|f_d| / 1600.0)^2 / max(10^(K_dB / 10), 0.5) ) )
 * 4. BLER = clamp[1e-7, 1.0] ( 1.0 / (1.0 + exp( 4.5 * (gamma_dB - gamma_req,dB + 0.8) )) )
 */
export function evaluateTerminalVsaMetrics(params: VsaEvaluationParams): VsaTerminalMetrics {
  const sinrDb = typeof params.snrDb === 'number' && Number.isFinite(params.snrDb) ? params.snrDb : -10.0;
  const info = resolveConstellationInfo(params.modcodName);
  const minSnrDb = typeof params.minSnrDb === 'number' && Number.isFinite(params.minSnrDb) ? params.minSnrDb : info.minSnrDb;
  const ricianKDb = typeof params.ricianKDb === 'number' && Number.isFinite(params.ricianKDb) ? params.ricianKDb : 10.0;
  const dopplerShiftHz = typeof params.dopplerShiftHz === 'number' && Number.isFinite(params.dopplerShiftHz) ? params.dopplerShiftHz : 0.0;
  const isOutage = Boolean(params.isOutage || sinrDb < minSnrDb);

  // 1. Linear SINR & noise variance per complex symbol
  const gammaLin = Math.pow(10.0, sinrDb / 10.0);
  const clampedGammaLin = Math.max(gammaLin, 0.01);
  const sigmaNSq = 1.0 / clampedGammaLin;
  const sigmaN = Math.sqrt(sigmaNSq);

  // 2. Analytical RMS EVM
  const rawEvmPct = 100.0 * Math.sqrt(1.0 / clampedGammaLin);
  const evmRmsPct = Math.max(0.5, Math.min(100.0, rawEvmPct));
  const rawEvmDb = -sinrDb;
  const evmDb = Object.is(rawEvmDb, -0) ? 0 : rawEvmDb;

  // 3. Carrier Recovery PLL Residual Phase Error (sigma_theta [deg])
  const kLin = Math.pow(10.0, ricianKDb / 10.0);
  const termNoise = 1.0 / (2.0 * Math.max(gammaLin, 0.1));
  const dopplerRatio = Math.abs(dopplerShiftHz) / 1600.0;
  const termDoppler = (0.002 * dopplerRatio * dopplerRatio) / Math.max(kLin, 0.5);
  const rawPhaseErrDeg = (180.0 / Math.PI) * Math.sqrt(termNoise + termDoppler);
  const phaseErrorDeg = Math.max(0.1, Math.min(45.0, rawPhaseErrDeg));
  const phaseErrorRad = (phaseErrorDeg * Math.PI) / 180.0;

  // 4. Post-LDPC Waterfall Block Error Rate (BLER)
  const snrMarginDb = sinrDb - minSnrDb;
  const waterfallArg = 4.5 * (sinrDb - minSnrDb + 0.8);
  const rawBler = 1.0 / (1.0 + Math.exp(waterfallArg));
  const ldpcBler = isOutage ? 1.0 : Math.max(1e-7, Math.min(1.0, rawBler));

  // Demod lock criteria: not in outage and BLER < 0.10
  const isLock = !isOutage && ldpcBler < 0.10 && sinrDb >= minSnrDb;

  // 5. Constellation and Noisy Symbols
  const referenceConstellation = getReferenceConstellation(info.constellationType);
  const seed = params.seed ?? Math.floor(Math.abs(sinrDb * 100) + Math.abs(dopplerShiftHz));
  const receivedSymbols = sampleNoisyIqSymbols(referenceConstellation, sigmaN, phaseErrorRad, 64, seed);

  return {
    sinrDb,
    snrMarginDb,
    evmRmsPct,
    evmDb,
    phaseErrorDeg,
    ldpcBler,
    isLock,
    constellationInfo: info,
    referenceConstellation,
    receivedSymbols,
  };
}
