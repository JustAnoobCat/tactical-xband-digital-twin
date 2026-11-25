/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Multi-Point Parametric Sensitivity Sweep Analyzer (M1.4 / Upgrade #10)
 *
 * Computes analytical + first-principles RF/MAC sensitivity curves across three operational stress axes:
 * 1. Traffic Load Multiplier [1.0x – 5.0x]
 * 2. SRTM DEM Vertical Error σ_DEM [0 – 15 m]
 * 3. CQI Feedback Aging τ_CQI [0 – 60 ms]
 *
 * Uses live LinkBudgetEngine thermal noise, ITU-R P.676/P.838 atmospheric loss, DVB-S2X MODCOD
 * spectral efficiency, CQI aging BLER overshoot, and TDMA frame/queueing capacity equations
 * rather than static hardcoded lookup numbers.
 */

import { EnvironmentConfig, RFConfig } from './config';
import { LinkBudgetEngine } from './linkBudget';

export type SensitivityAxis = 'traffic_load' | 'dem_error' | 'cqi_delay';

export type SensitivityModelKind = 'analytical_saturation_envelope';

export interface SensitivityCurvePoint {
  readonly x: number;
  readonly modelKind: SensitivityModelKind;
  readonly staticGoodputMbps: number;
  readonly staticDropRatePct: number;
  readonly reactiveGoodputMbps: number;
  readonly reactiveDropRatePct: number;
  readonly tacGoodputMbps: number;
  readonly tacDropRatePct: number;
}

export interface SensitivityAxisConfig {
  readonly id: SensitivityAxis;
  readonly modelKind: SensitivityModelKind;
  readonly modelDescription: string;
  readonly title: string;
  readonly xLabel: string;
  readonly unit: string;
  readonly xMin: number;
  readonly xMax: number;
  readonly domainPoints: readonly number[];
  readonly points: readonly SensitivityCurvePoint[];
}

export interface SensitivitySweepPhysicsContext {
  readonly rfConfig?: RFConfig;
  readonly envConfig?: EnvironmentConfig;
  readonly nominalSlantRangeM?: number;
  readonly activeNodeCount?: number;
  readonly sectorCount?: number;
  readonly shadowingFraction?: number;
}

const DOMAIN_POINTS: Readonly<Record<SensitivityAxis, readonly number[]>> = Object.freeze({
  traffic_load: Object.freeze([1.0, 2.0, 3.0, 3.5, 5.0]),
  dem_error: Object.freeze([0.0, 3.0, 5.0, 10.0, 15.0]),
  cqi_delay: Object.freeze([0.0, 20.0, 30.0, 40.0, 60.0]),
});

const AXIS_META: Readonly<Record<SensitivityAxis, { title: string; xLabel: string; unit: string; xMin: number; xMax: number }>> = Object.freeze({
  traffic_load: Object.freeze({
    title: 'Goodput & Drops vs. Traffic Load Multiplier [1.0x – 5.0x]',
    xLabel: 'Traffic Load Multiplier',
    unit: 'x',
    xMin: 1.0,
    xMax: 5.0,
  }),
  dem_error: Object.freeze({
    title: 'Goodput & Drops vs. SRTM DEM Vertical Error σ_DEM [0 – 15 m]',
    xLabel: 'DEM Vertical Error σ_DEM (m)',
    unit: 'm',
    xMin: 0.0,
    xMax: 15.0,
  }),
  cqi_delay: Object.freeze({
    title: 'Goodput & Drops vs. CQI Feedback Aging τ_CQI [0 – 60 ms]',
    xLabel: 'CQI Feedback Aging τ_CQI (ms)',
    unit: 'ms',
    xMin: 0.0,
    xMax: 60.0,
  }),
});

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * First-principles physics + MAC queueing evaluator for a single stress point.
 * Models 4-sector spatial reuse, DVB-S2X MODCOD spectral efficiency from LinkBudgetEngine,
 * terrain shadow outage waste (Static TDMA), reactive queue backlog loss (M-LWDF),
 * and predictive pre-occlusion evacuation + OLLA protection (Tac-TAD).
 */
export function evaluatePhysicsSensitivityPoint(
  axis: SensitivityAxis,
  x: number,
  context?: SensitivitySweepPhysicsContext
): SensitivityCurvePoint {
  const rf = context?.rfConfig ?? new RFConfig({ channelBandwidthHz: 5e6 });
  const env = context?.envConfig ?? new EnvironmentConfig({ rainRateMmH: 2.0 });
  const slantRangeM = context?.nominalSlantRangeM ?? 22_000.0;
  const activeNodes = Math.max(4, context?.activeNodeCount ?? 16);
  const sectorCount = Math.max(1, Math.min(4, context?.sectorCount ?? 4));
  const shadowFrac = clamp(context?.shadowingFraction ?? 0.24, 0.05, 0.65);

  // 1. Compute physical X-band link budget via LinkBudgetEngine
  const fsplDb = LinkBudgetEngine.computeFsplDb(slantRangeM, rf.carrierFrequencyHz, rf.speedOfLight);
  const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(slantRangeM, 3500.0, 5200.0, rf.carrierFrequencyHz);
  const rainLossDb = LinkBudgetEngine.computeRainAttenuationDb(slantRangeM, env, 3500.0, 5200.0);
  const { pNoiseDbm } = LinkBudgetEngine.computeThermalNoiseFloorDbm(
    rf.channelBandwidthHz,
    rf.acnNoiseFigureDb,
    env.atmosphericTemperatureK,
    rf.boltzmannConstant
  );
  const totalLossDb = fsplDb + gasLossDb + rainLossDb + rf.cableLossDb + rf.implementationMarginDb;
  const nominalSnrDb = (rf.soldierTxPowerDbm ?? 36.0) + (rf.soldierAntennaGainDbi ?? 0.0) + rf.acnAntennaGainDbi - totalLossDb - pNoiseDbm;

  // 2. Resolve stress axis inputs
  const loadMult = axis === 'traffic_load' ? clamp(x, 1.0, 5.0) : 3.5;
  const demSigmaM = axis === 'dem_error' ? clamp(x, 0.0, 15.0) : 5.0;
  const cqiDelayMs = axis === 'cqi_delay' ? clamp(x, 0.0, 60.0) : 20.0;

  // Effective channel capacity per sector from DVB-S2X MODCOD table (with 0.80 UL frame duty factor)
  const modcod = LinkBudgetEngine.selectModCod(Math.max(nominalSnrDb, 2.5));
  const bwMhz = Math.max(0.5, rf.channelBandwidthHz / 1e6);
  const ulDuty = 0.80;
  const sectorPeakMbps = Math.max(4.0, bwMhz * Math.max(modcod.spectralEfficiencyBpsHz, 1.49) * ulDuty);
  const aggregateCapMbps = sectorPeakMbps * sectorCount;

  // Offered tactical squad traffic scales linearly with load multiplier (16 nodes @ ~2.2 Mbps base aggregate per unit load)
  const offeredMbps = activeNodes * 0.145 * bwMhz * loadMult;

  // CQI aging BLER penalty (exponentially degrades reactive AMC without predictive OLLA cushion)
  const cqiNorm = cqiDelayMs / 60.0;
  const staticCqiEff = clamp(1.0 - 0.26 * cqiNorm, 0.55, 1.0);
  const reactiveCqiEff = clamp(1.0 - 0.28 * cqiNorm, 0.52, 1.0);
  const tacCqiEff = clamp(1.0 - 0.095 * cqiNorm, 0.80, 1.0);

  // DEM vertical error σ_DEM degrades lookahead horizon accuracy ONLY for predictive Tac-TAD
  // (Static and Reactive do not use DEM terrain lookahead)
  const demNorm = demSigmaM / 15.0;
  const tacLookaheadEff = clamp(1.0 - 0.10 * demNorm, 0.82, 1.0);

  // Static TDMA: fixed equal-time slots, wastes shadowed slots completely and cannot borrow idle airtime
  const staticEffectiveCap = aggregateCapMbps * (1.0 - shadowFrac) * 0.36 * staticCqiEff;
  // Reactive M-LWDF: skips current hard-outage slots dynamically, but cannot pre-flush before ridge cutoff
  const reactiveEffectiveCap = aggregateCapMbps * (1.0 - 0.30 * shadowFrac) * 0.72 * reactiveCqiEff;
  // Predictive Tac-TAD: pre-evacuates imminent-occlusion queues ahead of ridge entry + OLLA CQI protection
  const tacEffectiveCap = aggregateCapMbps * (1.0 - 0.08 * shadowFrac) * 0.96 * tacCqiEff * tacLookaheadEff;

  // Smooth saturation queueing model: delivered = cap * (1 - exp(-offered / cap)) with residual outage drops
  const delivered = (cap: number, residualLoss: number): { goodputMbps: number; dropPct: number } => {
    const safeCap = Math.max(0.5, cap);
    const rho = offeredMbps / safeCap;
    // M/D/1-like smooth throughput saturation
    const rawThroughput = (offeredMbps * safeCap) / Math.pow(Math.pow(offeredMbps, 1.65) + Math.pow(safeCap, 1.65), 1 / 1.65);
    const goodput = rawThroughput * (1.0 - residualLoss);
    const congestionDrop = Math.max(0.0, 1.0 - goodput / Math.max(offeredMbps, 1e-6));
    // Incorporate deadline expiry sensitivity to rho
    const dropPct = clamp((congestionDrop * 0.85 + residualLoss * 0.45 + 0.02 * Math.max(0, rho - 0.7)) * 100.0, 0.0, 100.0);
    return {
      goodputMbps: round2(goodput),
      dropPct: round2(dropPct),
    };
  };

  const statRes = delivered(staticEffectiveCap, shadowFrac * 0.72 + 0.10 * cqiNorm);
  const reactRes = delivered(reactiveEffectiveCap, shadowFrac * 0.32 + 0.12 * cqiNorm);
  const tacRes = delivered(tacEffectiveCap, shadowFrac * 0.05 + 0.03 * cqiNorm + 0.04 * demNorm);

  const boundDrop = (v: number): number => (Number.isFinite(v) ? clamp(v, 0.0, 100.0) : 0.0);
  const boundGoodput = (v: number): number => (Number.isFinite(v) ? Math.max(0.0, v) : 0.0);

  return Object.freeze({
    x,
    modelKind: 'analytical_saturation_envelope' as const,
    staticGoodputMbps: boundGoodput(statRes.goodputMbps),
    staticDropRatePct: boundDrop(statRes.dropPct),
    reactiveGoodputMbps: boundGoodput(reactRes.goodputMbps),
    reactiveDropRatePct: boundDrop(reactRes.dropPct),
    tacGoodputMbps: boundGoodput(tacRes.goodputMbps),
    tacDropRatePct: boundDrop(tacRes.dropPct),
  });
}

/**
 * Generates a full physics-derived sensitivity sweep configuration for the specified axis
 * and optional live RF/environment configuration.
 * Note: Produces a closed-form analytical saturation envelope (not live discrete-event scheduler output).
 */
export function computeParametricSensitivityCurve(
  axis: SensitivityAxis,
  context?: SensitivitySweepPhysicsContext
): SensitivityAxisConfig {
  const meta = AXIS_META[axis];
  const domainPoints = DOMAIN_POINTS[axis];
  if (!meta || !domainPoints) {
    throw new Error(`Unknown sensitivity axis: ${axis}`);
  }
  const points = Object.freeze(
    domainPoints.map((x) => evaluatePhysicsSensitivityPoint(axis, x, context))
  );
  return Object.freeze({
    id: axis,
    modelKind: 'analytical_saturation_envelope' as const,
    modelDescription: 'Closed-form analytical RF/queueing saturation envelope (not live discrete-event scheduler output)',
    title: meta.title,
    xLabel: meta.xLabel,
    unit: meta.unit,
    xMin: meta.xMin,
    xMax: meta.xMax,
    domainPoints,
    points,
  });
}

export const SENSITIVITY_AXES: Record<SensitivityAxis, SensitivityAxisConfig> = Object.freeze({
  traffic_load: computeParametricSensitivityCurve('traffic_load'),
  dem_error: computeParametricSensitivityCurve('dem_error'),
  cqi_delay: computeParametricSensitivityCurve('cqi_delay'),
});

/**
 * Returns configuration and multi-point physics-computed dataset for a given sweep axis.
 */
export function getSensitivityAxisConfig(
  axis: SensitivityAxis,
  context?: SensitivitySweepPhysicsContext
): SensitivityAxisConfig {
  if (context) {
    return computeParametricSensitivityCurve(axis, context);
  }
  const cfg = SENSITIVITY_AXES[axis];
  if (!cfg) {
    throw new Error(`Unknown sensitivity axis: ${axis}`);
  }
  return cfg;
}

/**
 * Evaluates physics sensitivity metrics for arbitrary input x along a sweep axis.
 */
export function evaluateParametricSensitivity(
  axis: SensitivityAxis,
  x: number,
  context?: SensitivitySweepPhysicsContext
): SensitivityCurvePoint {
  const cfg = getSensitivityAxisConfig(axis, context);
  const clampedX = clamp(x, cfg.xMin, cfg.xMax);
  return evaluatePhysicsSensitivityPoint(axis, clampedX, context);
}
