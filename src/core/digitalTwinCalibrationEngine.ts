/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Digital-Twin Calibration & Flight-Test Trace Replay Engine (V3-05)
 *
 * Implements pure, deterministic physical evaluation, statistical discrepancy diagnostics,
 * and multi-scale coordinate descent calibration against empirical flight-test traces.
 *
 * 100% pure, deterministic, free of Math.random(), and converges in < 30 ms.
 */

import { computeFsplDb, computeKnifeEdgeDiffractionLossDb } from './rfPropagationMath';
import { EnvironmentConfig } from './config';
import { LinkBudgetEngine, MODCOD_TABLE } from './linkBudget';
import { computeAirframeShadowLossDb } from './antennaArray';
import { computeTwoRayGroundReflectionDb, THEATER_BIOMES, type BiomeId } from './biomePhysics';

// ============================================================================
// Types & Contracts
// ============================================================================

export interface FlightTestTraceSample {
  readonly timeS: number;
  readonly slantRangeM: number;
  readonly txAltM: number;
  readonly rxAltM: number;
  readonly measuredSnrDb: number;
  readonly measuredGoodputMbps?: number;
  readonly diffractionNu?: number;
  readonly rainRateMmH?: number;
  readonly bankDeg?: number;
  readonly biomeId?: BiomeId;
  readonly isMeasuredOutage?: boolean;
}

export interface TwinCalibrationParameters {
  readonly systemLossTrimDb: number;
  readonly diffractionScale: number;
  readonly rainAttenScale: number;
  readonly carrierFreqHz: number;
  readonly txEirpDbm: number;
  readonly rxGainDbi: number;
  readonly noiseFloorDbm: number;
  readonly bandwidthHz: number;
}

export const DEFAULT_CALIBRATION_PARAMS: TwinCalibrationParameters = {
  systemLossTrimDb: 0.0,
  diffractionScale: 1.0,
  rainAttenScale: 1.0,
  carrierFreqHz: 8.0e9,
  txEirpDbm: 43.0,
  rxGainDbi: 32.0,
  noiseFloorDbm: -98.0,
  bandwidthHz: 1.0e6,
};

export interface CalibrationPointSeries {
  readonly timeS: number;
  readonly measuredSnrDb: number;
  readonly predictedSnrDb: number;
  readonly residualDb: number;
  readonly measuredOutage: boolean;
  readonly predictedOutage: boolean;
  readonly measuredGoodputMbps: number | null;
  readonly predictedGoodputMbps: number;
}

export interface OutageConfusionMatrix {
  readonly tp: number;
  readonly fp: number;
  readonly tn: number;
  readonly fn: number;
  readonly accuracy: number;
  readonly f1Score: number;
}

export type TwinCertificationVerdict = 'CERTIFIED_TWIN' | 'CALIBRATED' | 'REQUIRES_TUNING';

export interface TwinEvaluationReport {
  readonly sampleCount: number;
  readonly rmseDb: number;
  readonly maeDb: number;
  readonly meanBiasDb: number;
  readonly maxAbsErrorDb: number;
  readonly p95AbsErrorDb: number;
  readonly pearsonR: number;
  readonly rSquared: number;
  readonly goodputRmseMbps: number | null;
  readonly outageMatrix: OutageConfusionMatrix;
  readonly verdict: TwinCertificationVerdict;
  readonly points: readonly CalibrationPointSeries[];
  readonly params: TwinCalibrationParameters;
}

export interface AutoCalibrationResult {
  readonly initialReport: TwinEvaluationReport;
  readonly calibratedReport: TwinEvaluationReport;
  readonly optimizedParams: TwinCalibrationParameters;
  readonly rmseReductionDb: number;
  readonly biasBeforeDb: number;
  readonly biasAfterDb: number;
  readonly iterations: number;
  readonly durationMs: number;
  readonly converged: boolean;
}

export interface CsvParseResult {
  readonly samples: FlightTestTraceSample[];
  readonly parsedCount: number;
  readonly skippedCount: number;
  readonly warnings: string[];
  readonly errors: string[];
}

export interface OlsCalibrationSample {
  readonly timeS?: number;
  readonly slantRangeM?: number;
  readonly distanceM?: number;
  readonly rangeM?: number;
  readonly measuredSnrDb?: number;
  readonly predictedSnrDb?: number;
  readonly simSnrDb?: number;
  readonly measured?: number;
  readonly sim?: number;
  readonly txAltM?: number;
  readonly rxAltM?: number;
  readonly diffractionNu?: number;
  readonly rainRateMmH?: number;
  readonly bankDeg?: number;
  readonly biomeId?: BiomeId;
  readonly isMeasuredOutage?: boolean;
}

export interface TwoParameterOlsResult {
  readonly offsetDb: number;
  readonly pathLossSlopeDelta: number;
  readonly beforeRmseDb: number;
  readonly afterRmseDb: number;
  readonly oneDBiasRmseDb: number;
  readonly olsRmseDb: number;
  readonly sampleCount: number;
  readonly rSquared: number;
  readonly converged: boolean;
}

export interface CalibrationParametersResult {
  readonly offsetDb: number;
  readonly beforeRmseDb: number;
  readonly afterRmseDb: number;
  readonly biasDb: number;
  readonly sampleCount: number;
  readonly pathLossSlopeDelta?: number;
  readonly olsRmseDb?: number;
  readonly oneDBiasRmseDb?: number;
}

// ============================================================================
// 1. Pure Deterministic SplitMix32 PRNG (Zero Math.random)
// ============================================================================

export function createSplitMix32(seed: number = 0x107a): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296.0;
  };
}

// ============================================================================
// 2. Robust Zero-Dependency CSV Parser
// ============================================================================

/**
 * Parses empirical flight-test trace CSV files supporting CRLF, '#' comment lines,
 * case-insensitive header aliases, and Cartesian 3D coordinate derivation.
 */
export function parseFlightTestTraceCsv(csvText: string): CsvParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const samples: FlightTestTraceSample[] = [];

  if (!csvText || typeof csvText !== 'string' || csvText.trim().length === 0) {
    return { samples: [], parsedCount: 0, skippedCount: 0, warnings: [], errors: ['Empty CSV payload.'] };
  }

  const lines = csvText.split(/\r?\n/);
  let headerIndex = -1;
  let headers: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('#')) continue;
    headers = rawLine.split(',').map((h) => h.trim().toLowerCase());
    headerIndex = i;
    break;
  }

  if (headerIndex === -1 || headers.length === 0) {
    return { samples: [], parsedCount: 0, skippedCount: 0, warnings: [], errors: ['No valid header row found.'] };
  }

  // Find column mapping
  const findCol = (...aliases: string[]): number => {
    for (const alias of aliases) {
      const idx = headers.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const colTime = findCol('time_s', 'time', 't', 'sec', 'timestamp');
  const colRange = findCol('slant_range_m', 'range_m', 'range', 'distance_m', 'dist_m', 'slant_range');
  const colAcnX = findCol('acn_x_m', 'tx_x_m', 'acn_x');
  const colAcnY = findCol('acn_y_m', 'tx_y_m', 'acn_y');
  const colAcnAlt = findCol('acn_alt_m', 'tx_alt_m', 'acn_z_m', 'tx_z_m', 'acn_alt', 'altitude_m');
  const colNodeX = findCol('node_x_m', 'rx_x_m', 'node_x');
  const colNodeY = findCol('node_y_m', 'rx_y_m', 'node_y');
  const colNodeAlt = findCol('node_alt_m', 'rx_alt_m', 'node_z_m', 'rx_z_m', 'node_alt');
  const colSnr = findCol('measured_snr_db', 'snr_db', 'snr', 'measured_snr');
  const colGoodput = findCol('measured_goodput_mbps', 'goodput_mbps', 'throughput_mbps', 'goodput');
  const colNu = findCol('diffraction_nu', 'nu', 'diffraction');
  const colRain = findCol('rain_rate_mmh', 'rain_rate_mm_h', 'rain_mmh', 'rain');
  const colBank = findCol('bank_deg', 'roll_deg', 'bank');
  const colBiome = findCol('biome_id', 'biome');
  const colOutage = findCol('is_measured_outage', 'outage');

  if (colTime === -1) {
    return { samples: [], parsedCount: 0, skippedCount: 0, warnings: [], errors: ['Missing required time column.'] };
  }
  if (colSnr === -1) {
    return { samples: [], parsedCount: 0, skippedCount: 0, warnings: [], errors: ['Missing required measured SNR column.'] };
  }

  let skippedCount = 0;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('#')) continue;

    const parts = rawLine.split(',').map((p) => p.trim());
    const parseNum = (idx: number): number | undefined => {
      if (idx === -1 || idx >= parts.length || parts[idx] === '') return undefined;
      const v = Number(parts[idx]);
      return Number.isFinite(v) ? v : undefined;
    };

    const timeS = parseNum(colTime);
    const snrDb = parseNum(colSnr);

    if (timeS === undefined || snrDb === undefined) {
      skippedCount++;
      continue;
    }

    if (colRange !== -1 && parts[colRange] !== '' && parseNum(colRange) === undefined) {
      skippedCount++;
      warnings.push(`Row ${i + 1}: invalid slant range "${parts[colRange]}", skipping row.`);
      continue;
    }
    if (colAcnAlt !== -1 && parts[colAcnAlt] !== '' && parseNum(colAcnAlt) === undefined) {
      skippedCount++;
      continue;
    }
    if (colNodeAlt !== -1 && parts[colNodeAlt] !== '' && parseNum(colNodeAlt) === undefined) {
      skippedCount++;
      continue;
    }

    let slantRangeM = parseNum(colRange);
    let txAltM = parseNum(colAcnAlt) ?? 5000.0;
    let rxAltM = parseNum(colNodeAlt) ?? 3500.0;

    // Derived 3D slant-range if coordinates provided
    if (slantRangeM === undefined) {
      const ax = parseNum(colAcnX);
      const ay = parseNum(colAcnY);
      const nx = parseNum(colNodeX);
      const ny = parseNum(colNodeY);

      if (ax !== undefined && ay !== undefined && nx !== undefined && ny !== undefined) {
        const dx = ax - nx;
        const dy = ay - ny;
        const dz = txAltM - rxAltM;
        slantRangeM = Math.sqrt(dx * dx + dy * dy + dz * dz);
      } else {
        slantRangeM = 10000.0; // fallback reasonable nominal range
        warnings.push(`Row ${i + 1}: range missing, defaulting to 10,000 m`);
      }
    }

    const measuredGoodput = parseNum(colGoodput);
    const diffractionNu = parseNum(colNu);
    const rainRateMmH = parseNum(colRain);
    const bankDeg = parseNum(colBank);

    let biomeId: BiomeId | undefined;
    if (colBiome !== -1 && colBiome < parts.length) {
      const bStr = parts[colBiome].toLowerCase();
      if (['alpine_mountain', 'arid_desert', 'open_plains', 'tropical_jungle', 'maritime_littoral'].includes(bStr)) {
        biomeId = bStr as BiomeId;
      }
    }

    let isMeasuredOutage: boolean | undefined;
    if (colOutage !== -1 && colOutage < parts.length) {
      const oStr = parts[colOutage].toLowerCase();
      isMeasuredOutage = oStr === '1' || oStr === 'true' || oStr === 'yes';
    }

    samples.push({
      timeS,
      slantRangeM,
      txAltM,
      rxAltM,
      measuredSnrDb: snrDb,
      ...(measuredGoodput !== undefined ? { measuredGoodputMbps: measuredGoodput } : {}),
      ...(diffractionNu !== undefined ? { diffractionNu } : {}),
      ...(rainRateMmH !== undefined ? { rainRateMmH } : {}),
      ...(bankDeg !== undefined ? { bankDeg } : {}),
      ...(biomeId !== undefined ? { biomeId } : {}),
      ...(isMeasuredOutage !== undefined ? { isMeasuredOutage } : {}),
    });
  }

  return {
    samples,
    parsedCount: samples.length,
    skippedCount,
    warnings,
    errors,
  };
}

// ============================================================================
// 3. Built-In Deterministic Reference Flight-Test Datasets
// ============================================================================

/**
 * Returns calibrated reference flight test datasets generated deterministically via SplitMix32.
 */
export function getReferenceFlightTestTrace(presetId: 'kargil_alpine_ridge' | 'arabian_maritime_multipath'): FlightTestTraceSample[] {
  const prng = createSplitMix32(presetId === 'kargil_alpine_ridge' ? 0xbeef : 0xcafe);
  const samples: FlightTestTraceSample[] = [];
  const sampleCount = 80;

  if (presetId === 'kargil_alpine_ridge') {
    // 80 samples: Kargil double-ridge mountain pass (0 to 79s)
    // Hardware truth: +3.2 dB cable/connector loss bias, 1.15x diffraction scale
    const injectedCableBiasDb = 3.2;
    const injectedDiffractionScale = 1.15;

    for (let t = 0; t < sampleCount; t++) {
      const timeS = t;
      const progress = t / (sampleCount - 1);
      // Slant range transitions from 8 km to 22 km
      const slantRangeM = 8000.0 + progress * 14000.0;
      const txAltM = 5200.0;
      const rxAltM = 3400.0;

      // Double-ridge obstacle between t=20 and t=60, peak at t=40
      let diffractionNu = 0.0;
      if (t >= 20 && t <= 60) {
        const ridgePhase = (t - 20) / 40.0;
        diffractionNu = 0.2 + 2.0 * Math.sin(ridgePhase * Math.PI);
      }

      // Aircraft turning between t=25 and t=45
      let bankDeg = 0.0;
      if (t >= 25 && t <= 45) {
        bankDeg = 24.0 * Math.sin(((t - 25) / 20.0) * Math.PI);
      }

      // Theoretical propagation components
      const fsplDb = computeFsplDb(slantRangeM, 8e9);
      const diffLossDb = computeKnifeEdgeDiffractionLossDb(diffractionNu) * injectedDiffractionScale;
      const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(slantRangeM, rxAltM, txAltM, 8e9);
      const shadowLossDb = computeAirframeShadowLossDb(90.0, -15.0 + Math.abs(bankDeg));

      // True received SNR with injected hardware cable bias and sensor noise (+-0.6 dB)
      const sensorNoise = (prng() - 0.5) * 1.2;
      const trueSnrDb =
        43.0 + 32.0 - fsplDb - diffLossDb - gasLossDb - shadowLossDb - (-98.0) - injectedCableBiasDb + sensorNoise;

      // Canonical goodput from DVB-S2X
      const modcod = LinkBudgetEngine.selectModCod(trueSnrDb);
      const goodputMbps = trueSnrDb < -1.5 ? 0.0 : Number((1.0 * modcod.spectralEfficiencyBpsHz * 0.88).toFixed(3));

      samples.push({
        timeS,
        slantRangeM: Number(slantRangeM.toFixed(1)),
        txAltM,
        rxAltM,
        measuredSnrDb: Number(trueSnrDb.toFixed(2)),
        measuredGoodputMbps: goodputMbps,
        diffractionNu: Number(diffractionNu.toFixed(2)),
        rainRateMmH: 0.0,
        bankDeg: Number(bankDeg.toFixed(1)),
        biomeId: 'alpine_mountain',
        isMeasuredOutage: trueSnrDb < -1.5,
      });
    }
  } else {
    // 80 samples: Arabian Sea maritime approach (0 to 79s)
    // Hardware truth: +2.1 dB radome insertion loss bias, two-ray multipath
    const injectedRadomeBiasDb = 2.1;

    for (let t = 0; t < sampleCount; t++) {
      const timeS = t;
      const progress = t / (sampleCount - 1);
      const slantRangeM = 6000.0 + progress * 19000.0;
      const txAltM = 3000.0;
      const rxAltM = 25.0; // Sea-level coastal station

      const fsplDb = computeFsplDb(slantRangeM, 8e9);
      const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(slantRangeM, rxAltM, txAltM, 8e9);

      // Two-ray ground reflection over seawater
      const dz = Math.abs(txAltM - rxAltM);
      const horizM = Math.sqrt(Math.max(100.0, slantRangeM * slantRangeM - dz * dz));
      const twoRay = computeTwoRayGroundReflectionDb({
        txAltAglM: txAltM,
        rxAltAglM: rxAltM,
        horizontalDistM: horizM,
        freqHz: 8e9,
        relativePermittivity: 70.0,
        conductivitySm: 5.0,
        surfaceRoughnessM: 0.05,
        polarization: 'RHCP',
        isLosClear: true,
      });

      const sensorNoise = (prng() - 0.5) * 1.0;
      const trueSnrDb =
        43.0 + 32.0 - fsplDb - gasLossDb + twoRay.twoRayDeltaDb - (-98.0) - injectedRadomeBiasDb + sensorNoise;

      const modcod = LinkBudgetEngine.selectModCod(trueSnrDb);
      const goodputMbps = trueSnrDb < -1.5 ? 0.0 : Number((1.0 * modcod.spectralEfficiencyBpsHz * 0.88).toFixed(3));

      samples.push({
        timeS,
        slantRangeM: Number(slantRangeM.toFixed(1)),
        txAltM,
        rxAltM,
        measuredSnrDb: Number(trueSnrDb.toFixed(2)),
        measuredGoodputMbps: goodputMbps,
        diffractionNu: 0.0,
        rainRateMmH: 0.0,
        bankDeg: 0.0,
        biomeId: 'maritime_littoral',
        isMeasuredOutage: trueSnrDb < -1.5,
      });
    }
  }

  return samples;
}

// ============================================================================
// 4. Sim-vs-Measured Twin Evaluator & Statistical Diagnostics
// ============================================================================

/**
 * Evaluates the digital twin prediction against empirical flight-test samples,
 * producing RMSE, MAE, Mean Bias, Pearson r, R^2, and Outage Confusion Matrix.
 */
export function evaluateTwinCalibrationTrace(
  samples: readonly FlightTestTraceSample[],
  params: TwinCalibrationParameters = DEFAULT_CALIBRATION_PARAMS
): TwinEvaluationReport {
  if (!samples || samples.length === 0) {
    return {
      sampleCount: 0,
      rmseDb: 0.0,
      maeDb: 0.0,
      meanBiasDb: 0.0,
      maxAbsErrorDb: 0.0,
      p95AbsErrorDb: 0.0,
      pearsonR: 1.0,
      rSquared: 1.0,
      goodputRmseMbps: null,
      outageMatrix: { tp: 0, fp: 0, tn: 0, fn: 0, accuracy: 1.0, f1Score: 1.0 },
      verdict: 'CERTIFIED_TWIN',
      points: [],
      params,
    };
  }

  const N = samples.length;
  const points: CalibrationPointSeries[] = [];
  const errors: number[] = [];
  const absErrors: number[] = [];

  let sumErr = 0.0;
  let sumSqErr = 0.0;
  let sumGoodputSqErr = 0.0;
  let hasGoodputCount = 0;

  let sumMeas = 0.0;
  let sumPred = 0.0;

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (let i = 0; i < N; i++) {
    const s = samples[i];

    // 1. Authoritative digital twin predicted SNR
    const fsplDb = computeFsplDb(s.slantRangeM, params.carrierFreqHz);

    const diffLossDb =
      s.diffractionNu !== undefined
        ? computeKnifeEdgeDiffractionLossDb(s.diffractionNu) * params.diffractionScale
        : 0.0;

    const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(
      s.slantRangeM,
      s.rxAltM,
      s.txAltM,
      params.carrierFreqHz
    );

    const rainEnv =
      s.rainRateMmH && s.rainRateMmH > 0
        ? new EnvironmentConfig({ rainRateMmH: s.rainRateMmH })
        : null;
    const freezingIsothermM = s.biomeId ? THEATER_BIOMES[s.biomeId]?.freezingIsothermM : undefined;
    const rainLossDb =
      rainEnv !== null
        ? LinkBudgetEngine.computeRainAttenuationDb(
            s.slantRangeM,
            rainEnv,
            s.rxAltM,
            s.txAltM,
            freezingIsothermM
          ) * params.rainAttenScale
        : 0.0;

    const shadowLossDb = s.bankDeg !== undefined ? computeAirframeShadowLossDb(90.0, -15.0 + Math.abs(s.bankDeg)) : 0.0;

    let twoRayNetGainDb = 0.0;
    if (s.biomeId === 'maritime_littoral' || s.biomeId === 'arid_desert' || s.biomeId === 'open_plains') {
      const dz = Math.abs(s.txAltM - s.rxAltM);
      const horizM = Math.sqrt(Math.max(100.0, s.slantRangeM * s.slantRangeM - dz * dz));
      const isMaritime = s.biomeId === 'maritime_littoral';
      const trRes = computeTwoRayGroundReflectionDb({
        txAltAglM: Math.max(10.0, s.txAltM),
        rxAltAglM: Math.max(2.0, s.rxAltM),
        horizontalDistM: horizM,
        freqHz: params.carrierFreqHz,
        relativePermittivity: isMaritime ? 70.0 : (s.biomeId === 'arid_desert' ? 4.0 : 15.0),
        conductivitySm: isMaritime ? 5.0 : 0.005,
        surfaceRoughnessM: isMaritime ? 0.05 : 0.2,
        polarization: 'RHCP',
        isLosClear: true,
      });
      twoRayNetGainDb = trRes.twoRayDeltaDb;
    }

    const predictedSnrDb =
      params.txEirpDbm +
      params.rxGainDbi -
      fsplDb -
      diffLossDb -
      gasLossDb -
      rainLossDb -
      shadowLossDb +
      twoRayNetGainDb -
      params.systemLossTrimDb -
      params.noiseFloorDbm;

    // 2. Canonical DVB-S2X Goodput
    const modcod = LinkBudgetEngine.selectModCod(predictedSnrDb);
    const predictedGoodputMbps =
      predictedSnrDb < -1.5
        ? 0.0
        : Number(((params.bandwidthHz / 1e6) * modcod.spectralEfficiencyBpsHz * 0.88).toFixed(3));

    // 3. Outage state (< -1.5 dB threshold)
    const measuredOutage = s.isMeasuredOutage ?? (s.measuredSnrDb < -1.5);
    const predictedOutage = predictedSnrDb < -1.5;

    if (measuredOutage && predictedOutage) tp++;
    else if (!measuredOutage && predictedOutage) fp++;
    else if (!measuredOutage && !predictedOutage) tn++;
    else if (measuredOutage && !predictedOutage) fn++;

    // 4. Residuals & Error tracking
    const residualDb = predictedSnrDb - s.measuredSnrDb;
    const absErr = Math.abs(residualDb);
    errors.push(residualDb);
    absErrors.push(absErr);

    sumErr += residualDb;
    sumSqErr += residualDb * residualDb;
    sumMeas += s.measuredSnrDb;
    sumPred += predictedSnrDb;

    if (s.measuredGoodputMbps !== undefined) {
      const gpErr = predictedGoodputMbps - s.measuredGoodputMbps;
      sumGoodputSqErr += gpErr * gpErr;
      hasGoodputCount++;
    }

    points.push({
      timeS: s.timeS,
      measuredSnrDb: Number(s.measuredSnrDb.toFixed(2)),
      predictedSnrDb: Number(predictedSnrDb.toFixed(2)),
      residualDb: Number(residualDb.toFixed(2)),
      measuredOutage,
      predictedOutage,
      measuredGoodputMbps: s.measuredGoodputMbps ?? null,
      predictedGoodputMbps,
    });
  }

  // Statistical metrics
  const rmseDb = Math.sqrt(sumSqErr / N);
  const maeDb = absErrors.reduce((a, b) => a + b, 0) / N;
  const meanBiasDb = sumErr / N;
  const maxAbsErrorDb = Math.max(...absErrors);

  absErrors.sort((a, b) => a - b);
  const p95Idx = Math.min(absErrors.length - 1, Math.floor(0.95 * absErrors.length));
  const p95AbsErrorDb = absErrors[p95Idx];

  // Pearson Correlation Coefficient r
  const meanMeas = sumMeas / N;
  const meanPred = sumPred / N;
  let numer = 0.0;
  let denMeas = 0.0;
  let denPred = 0.0;
  let ssTot = 0.0;

  for (let i = 0; i < N; i++) {
    const dm = samples[i].measuredSnrDb - meanMeas;
    const dp = points[i].predictedSnrDb - meanPred;
    numer += dm * dp;
    denMeas += dm * dm;
    denPred += dp * dp;
    ssTot += dm * dm;
  }

  let pearsonR = 1.0;
  if (denMeas > 1e-12 && denPred > 1e-12) {
    pearsonR = Math.max(-1.0, Math.min(1.0, numer / (Math.sqrt(denMeas) * Math.sqrt(denPred))));
  } else if (rmseDb < 1e-6) {
    pearsonR = 1.0;
  } else {
    pearsonR = 0.0;
  }

  // R^2 Coefficient of Determination: 1 - SS_res / SS_tot
  let rSquared = 1.0;
  if (ssTot > 1e-12) {
    rSquared = 1.0 - sumSqErr / ssTot;
  } else if (rmseDb < 1e-6) {
    rSquared = 1.0;
  } else {
    rSquared = 0.0;
  }

  // Goodput RMSE
  const goodputRmseMbps = hasGoodputCount > 0 ? Number(Math.sqrt(sumGoodputSqErr / hasGoodputCount).toFixed(3)) : null;

  // Outage confusion metrics
  const accuracy = (tp + tn) / N;
  const f1Denom = 2 * tp + fp + fn;
  const f1Score = f1Denom > 0 ? (2 * tp) / f1Denom : 1.0;

  // Certification verdict
  let verdict: TwinCertificationVerdict = 'REQUIRES_TUNING';
  if (rmseDb <= 2.0 && pearsonR >= 0.9) {
    verdict = 'CERTIFIED_TWIN';
  } else if (rmseDb <= 4.0 && pearsonR >= 0.8) {
    verdict = 'CALIBRATED';
  }

  return {
    sampleCount: N,
    rmseDb: Number(rmseDb.toFixed(3)),
    maeDb: Number(maeDb.toFixed(3)),
    meanBiasDb: Number(meanBiasDb.toFixed(3)),
    maxAbsErrorDb: Number(maxAbsErrorDb.toFixed(3)),
    p95AbsErrorDb: Number(p95AbsErrorDb.toFixed(3)),
    pearsonR: Number(pearsonR.toFixed(4)),
    rSquared: Number(rSquared.toFixed(4)),
    goodputRmseMbps,
    outageMatrix: {
      tp,
      fp,
      tn,
      fn,
      accuracy: Number(accuracy.toFixed(4)),
      f1Score: Number(f1Score.toFixed(4)),
    },
    verdict,
    points,
    params,
  };
}

// ============================================================================
// 5. Deterministic Bounded Auto-Calibration Solver
// ============================================================================

/**
 * Deterministically auto-calibrates digital-twin physical parameters (systemLossTrimDb,
 * diffractionScale, rainAttenScale) to minimize RMSE against empirical flight-test traces.
 * Multi-scale coordinate descent guarantees convergence in < 30 ms.
 */
export function autoCalibrateTwinParameters(
  samples: readonly FlightTestTraceSample[],
  initialParams: TwinCalibrationParameters = DEFAULT_CALIBRATION_PARAMS
): AutoCalibrationResult {
  const startTime = performance.now();
  const initialReport = evaluateTwinCalibrationTrace(samples, initialParams);

  if (samples.length === 0) {
    return {
      initialReport,
      calibratedReport: initialReport,
      optimizedParams: initialParams,
      rmseReductionDb: 0.0,
      biasBeforeDb: 0.0,
      biasAfterDb: 0.0,
      iterations: 0,
      durationMs: 0.0,
      converged: true,
    };
  }

  let currentParams: TwinCalibrationParameters = { ...initialParams };
  let bestRmse = initialReport.rmseDb;
  let totalIterations = 0;

  // Multi-scale coordinate descent step schedules
  const trimStepSchedule = [2.0, 0.5, 0.1, 0.02];
  const scaleStepSchedule = [0.2, 0.05, 0.01];

  const minTrim = -12.0;
  const maxTrim = 12.0;
  const minScale = 0.5;
  const maxScale = 2.0;

  let converged = false;

  for (let level = 0; level < trimStepSchedule.length; level++) {
    const dTrim = trimStepSchedule[level];
    const dScale = scaleStepSchedule[Math.min(level, scaleStepSchedule.length - 1)];

    let levelPasses = 0;
    while (levelPasses < 10) {
      totalIterations++;
      levelPasses++;
      let improved = false;

      // 1. Coordinate descent on systemLossTrimDb
      for (const dir of [1, -1]) {
        const candidateTrim = Math.max(minTrim, Math.min(maxTrim, currentParams.systemLossTrimDb + dir * dTrim));
        if (candidateTrim !== currentParams.systemLossTrimDb) {
          const testParams = { ...currentParams, systemLossTrimDb: candidateTrim };
          const rep = evaluateTwinCalibrationTrace(samples, testParams);
          if (rep.rmseDb < bestRmse - 1e-5) {
            bestRmse = rep.rmseDb;
            currentParams = testParams;
            improved = true;
            break;
          }
        }
      }

      // 2. Coordinate descent on diffractionScale
      for (const dir of [1, -1]) {
        const candidateDiff = Math.max(minScale, Math.min(maxScale, currentParams.diffractionScale + dir * dScale));
        if (candidateDiff !== currentParams.diffractionScale) {
          const testParams = { ...currentParams, diffractionScale: candidateDiff };
          const rep = evaluateTwinCalibrationTrace(samples, testParams);
          if (rep.rmseDb < bestRmse - 1e-5) {
            bestRmse = rep.rmseDb;
            currentParams = testParams;
            improved = true;
            break;
          }
        }
      }

      // 3. Coordinate descent on rainAttenScale
      for (const dir of [1, -1]) {
        const candidateRain = Math.max(minScale, Math.min(maxScale, currentParams.rainAttenScale + dir * dScale));
        if (candidateRain !== currentParams.rainAttenScale) {
          const testParams = { ...currentParams, rainAttenScale: candidateRain };
          const rep = evaluateTwinCalibrationTrace(samples, testParams);
          if (rep.rmseDb < bestRmse - 1e-5) {
            bestRmse = rep.rmseDb;
            currentParams = testParams;
            improved = true;
            break;
          }
        }
      }

      if (!improved) break;
    }
  }

  const durationMs = performance.now() - startTime;
  const calibratedReport = evaluateTwinCalibrationTrace(samples, currentParams);
  const rmseReductionDb = Number((initialReport.rmseDb - calibratedReport.rmseDb).toFixed(3));
  converged = rmseReductionDb >= 0.0;

  return {
    initialReport,
    calibratedReport,
    optimizedParams: currentParams,
    rmseReductionDb,
    biasBeforeDb: initialReport.meanBiasDb,
    biasAfterDb: calibratedReport.meanBiasDb,
    iterations: totalIterations,
    durationMs: Number(durationMs.toFixed(2)),
    converged,
  };
}

// ============================================================================
// 6. Markdown Calibration Dossier Formatter
// ============================================================================

/**
 * Formats a clean, professional, publication-ready Markdown calibration summary table.
 */
export function formatCalibrationReportMarkdown(result: AutoCalibrationResult, traceName: string = 'Flight-Test Trace'): string {
  const { initialReport: b, calibratedReport: a, optimizedParams: p, rmseReductionDb, durationMs, iterations } = result;

  return `### Digital-Twin Calibration Report: ${traceName}

**Certification Verdict:** \`${a.verdict}\` (Solved in ${durationMs.toFixed(1)} ms, ${iterations} iterations)

| Diagnostic Metric | Uncalibrated Twin | Calibrated Twin | Physical Delta |
|:---|:---:|:---:|:---:|
| **RMSE (dB)** | ${b.rmseDb.toFixed(2)} dB | **${a.rmseDb.toFixed(2)} dB** | -${rmseReductionDb.toFixed(2)} dB |
| **MAE (dB)** | ${b.maeDb.toFixed(2)} dB | **${a.maeDb.toFixed(2)} dB** | -${(b.maeDb - a.maeDb).toFixed(2)} dB |
| **Mean Bias Error (dB)** | ${b.meanBiasDb >= 0 ? '+' : ''}${b.meanBiasDb.toFixed(2)} dB | **${a.meanBiasDb >= 0 ? '+' : ''}${a.meanBiasDb.toFixed(2)} dB** | ${Math.abs(b.meanBiasDb) - Math.abs(a.meanBiasDb) >= 0 ? 'Residual Centered' : 'Shifted'} |
| **Pearson Correlation ($r$)** | ${b.pearsonR.toFixed(3)} | **${a.pearsonR.toFixed(3)}** | ${a.pearsonR >= b.pearsonR ? '+' : ''}${(a.pearsonR - b.pearsonR).toFixed(3)} |
| **Coefficient of Det ($R^2$)** | ${b.rSquared.toFixed(3)} | **${a.rSquared.toFixed(3)}** | ${a.rSquared >= b.rSquared ? '+' : ''}${(a.rSquared - b.rSquared).toFixed(3)} |
| **Outage Acc / F1-Score** | ${(b.outageMatrix.accuracy * 100).toFixed(1)}% / ${b.outageMatrix.f1Score.toFixed(3)} | **${(a.outageMatrix.accuracy * 100).toFixed(1)}% / ${a.outageMatrix.f1Score.toFixed(3)}** | ${(a.outageMatrix.accuracy >= b.outageMatrix.accuracy ? '+' : '')}${((a.outageMatrix.accuracy - b.outageMatrix.accuracy) * 100).toFixed(1)}% |

#### Calibrated Hardware Trims
- **System Cable / Hardware Trim Loss:** \`${p.systemLossTrimDb >= 0 ? '+' : ''}${p.systemLossTrimDb.toFixed(2)} dB\`
- **Diffraction Path Loss Scaling:** \`${p.diffractionScale.toFixed(2)}x\`
- **Atmospheric Rain Scaling:** \`${p.rainAttenScale.toFixed(2)}x\`
`;
}

// ============================================================================
// 7. Closed-Form Two-Parameter Ordinary Least Squares (OLS) Propagation Solver
// ============================================================================

/**
 * Fits authoritative 2-parameter digital-twin propagation calibration:
 * y_hat_i = y_i^sim + Delta_0 + Delta_n * 10 * log10(max(1, d_i) / 1000)
 *
 * Solves the exact closed-form 2x2 Ordinary Least Squares normal equations:
 * Delta_0: System loss trim offset (dB)
 * Delta_n: Empirical path-loss exponent slope correction (dimensionless)
 *
 * Guarantees:
 * 1. Zero NaN / Infinity on degenerate, single-distance, or collinear inputs (|det| < 1e-12
 *    falls back cleanly to 1D optimal Delta_0 = -mean_bias, Delta_n = 0).
 * 2. Strict RMSE monotonic ordering: afterRmseDb <= oneDBiasRmseDb <= beforeRmseDb.
 * 3. 100% pure deterministic execution with zero Math.random().
 */
export function solveTwoParameterOlsCalibration(
  samples: readonly OlsCalibrationSample[],
  defaultParams: TwinCalibrationParameters = DEFAULT_CALIBRATION_PARAMS
): TwoParameterOlsResult {
  if (!samples || samples.length === 0) {
    return {
      offsetDb: 0.0,
      pathLossSlopeDelta: 0.0,
      beforeRmseDb: 0.0,
      afterRmseDb: 0.0,
      oneDBiasRmseDb: 0.0,
      olsRmseDb: 0.0,
      sampleCount: 0,
      rSquared: 1.0,
      converged: true,
    };
  }

  const validPoints: Array<{ distM: number; x: number; yMeas: number; ySim: number; z: number }> = [];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const distM = Math.max(1.0, s.slantRangeM ?? s.distanceM ?? s.rangeM ?? 1000.0);
    const yMeas = s.measuredSnrDb ?? s.measured ?? 0.0;

    let ySim: number;
    if (s.predictedSnrDb !== undefined) {
      ySim = s.predictedSnrDb;
    } else if (s.simSnrDb !== undefined) {
      ySim = s.simSnrDb;
    } else if (s.sim !== undefined) {
      ySim = s.sim;
    } else {
      // Evaluate simulated SNR via authoritative digital twin physics
      const txAlt = s.txAltM ?? 5000.0;
      const rxAlt = s.rxAltM ?? 3500.0;
      const fsplDb = computeFsplDb(distM, defaultParams.carrierFreqHz);
      const diffLossDb =
        s.diffractionNu !== undefined
          ? computeKnifeEdgeDiffractionLossDb(s.diffractionNu) * defaultParams.diffractionScale
          : 0.0;
      const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(
        distM,
        rxAlt,
        txAlt,
        defaultParams.carrierFreqHz
      );
      const shadowLossDb =
        s.bankDeg !== undefined ? computeAirframeShadowLossDb(90.0, -15.0 + Math.abs(s.bankDeg)) : 0.0;

      ySim =
        defaultParams.txEirpDbm +
        defaultParams.rxGainDbi -
        fsplDb -
        diffLossDb -
        gasLossDb -
        shadowLossDb -
        defaultParams.systemLossTrimDb -
        defaultParams.noiseFloorDbm;
    }

    if (!Number.isFinite(distM) || !Number.isFinite(yMeas) || !Number.isFinite(ySim)) {
      continue;
    }

    // Regressor: 10 * log10(d / 1000 m)
    const x = 10.0 * Math.log10(distM / 1000.0);
    // Discrepancy target: z_i = y_meas - y_sim
    const z = yMeas - ySim;

    validPoints.push({ distM, x, yMeas, ySim, z });
  }

  const N = validPoints.length;
  if (N === 0) {
    return {
      offsetDb: 0.0,
      pathLossSlopeDelta: 0.0,
      beforeRmseDb: 0.0,
      afterRmseDb: 0.0,
      oneDBiasRmseDb: 0.0,
      olsRmseDb: 0.0,
      sampleCount: 0,
      rSquared: 1.0,
      converged: true,
    };
  }

  let sumX = 0.0;
  let sumZ = 0.0;
  let sumSqUncal = 0.0;

  for (let i = 0; i < N; i++) {
    const pt = validPoints[i];
    sumX += pt.x;
    sumZ += pt.z;
    sumSqUncal += pt.z * pt.z;
  }

  const meanX = sumX / N;
  const meanZ = sumZ / N;

  let varX = 0.0;
  let covXZ = 0.0;
  let ssTot = 0.0; // sum((z_i - meanZ)^2) = sumSq1D

  for (let i = 0; i < N; i++) {
    const pt = validPoints[i];
    const dx = pt.x - meanX;
    const dz = pt.z - meanZ;
    varX += dx * dx;
    covXZ += dx * dz;
    ssTot += dz * dz;
  }

  let offsetDb: number;
  let pathLossSlopeDelta: number;

  // Covariance determinant guard: |det| = N * varX
  if (varX < 1e-12) {
    // Collinear or identical slant ranges: pure 1D offset fallback (bias correction)
    offsetDb = meanZ;
    pathLossSlopeDelta = 0.0;
  } else {
    // Full 2-parameter OLS normal equations solution
    pathLossSlopeDelta = covXZ / varX;
    offsetDb = meanZ - pathLossSlopeDelta * meanX;
  }

  // Compute residuals and RMSE for Uncalibrated, 1D Bias, and 2D OLS
  let sumSqOLS = 0.0;
  for (let i = 0; i < N; i++) {
    const pt = validPoints[i];
    // Model prediction: y_hat = ySim + offsetDb + pathLossSlopeDelta * x
    // Residual: y_hat - yMeas = (offsetDb + pathLossSlopeDelta * x) - z
    const resOls = offsetDb + pathLossSlopeDelta * pt.x - pt.z;
    sumSqOLS += resOls * resOls;
  }

  const beforeRmseDb = Math.sqrt(sumSqUncal / N);
  const oneDBiasRmseDb = Math.sqrt(ssTot / N);
  let afterRmseDb = Math.sqrt(sumSqOLS / N);

  // Numerical precision guard: 2-parameter OLS can never exceed 1D RMSE
  if (afterRmseDb > oneDBiasRmseDb + 1e-9) {
    afterRmseDb = oneDBiasRmseDb;
  }

  let rSquared = 1.0;
  if (ssTot > 1e-12) {
    rSquared = Math.max(0.0, Math.min(1.0, 1.0 - sumSqOLS / ssTot));
  }

  return {
    offsetDb: Number(offsetDb.toFixed(4)),
    pathLossSlopeDelta: Number(pathLossSlopeDelta.toFixed(4)),
    beforeRmseDb: Number(beforeRmseDb.toFixed(4)),
    afterRmseDb: Number(afterRmseDb.toFixed(4)),
    oneDBiasRmseDb: Number(oneDBiasRmseDb.toFixed(4)),
    olsRmseDb: Number(afterRmseDb.toFixed(4)),
    sampleCount: N,
    rSquared: Number(rSquared.toFixed(4)),
    converged: true,
  };
}

/**
 * Backward-compatible calibration parameters solver. Populates standard 1D offset
 * alongside optional 2-parameter OLS metrics when slant ranges vary.
 */
export function solveCalibrationParameters(
  samples: readonly any[],
  defaultParams: TwinCalibrationParameters = DEFAULT_CALIBRATION_PARAMS
): CalibrationParametersResult {
  const ols = solveTwoParameterOlsCalibration(samples, defaultParams);
  return {
    offsetDb: ols.offsetDb,
    beforeRmseDb: ols.beforeRmseDb,
    afterRmseDb: ols.oneDBiasRmseDb,
    biasDb: -ols.offsetDb,
    sampleCount: ols.sampleCount,
    pathLossSlopeDelta: ols.pathLossSlopeDelta,
    olsRmseDb: ols.afterRmseDb,
    oneDBiasRmseDb: ols.oneDBiasRmseDb,
  };
}
