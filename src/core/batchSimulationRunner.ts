/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Headless Single-Trial Simulation Runner, Monte Carlo Aggregation & CSV Formatter
 *
 * Pure isomorphic TypeScript runner executing on the authoritative `SimulationWorkerManager`
 * at exact 50 Hz discrete-event cadence (FRAME_DT = 0.020 s).
 */

import { FRAME_DT } from '../shared/constants';
import type { ConfigUpdateParams, WorkerInboundCommand } from '../shared/workerProtocol';
import { SimulationWorkerManager } from '../worker/simWorker';
import { THEATER_BIOMES, type BiomeId } from './biomePhysics';
import { computeTelemetryStateDigest } from './flightRecorder';
import { parseMissionScenarioJson, type MissionScenarioV3 } from './militaryGisEngine';
import {
  MAX_OBSTACLE_DIMENSION_M,
  MAX_OBSTACLE_HEIGHT_M,
  MIN_OBSTACLE_DIMENSION_M,
  type CuboidObstacle,
} from './obstacles';
import { computeSampleStatistics } from './statisticalBenchmarkEngine';

export interface HeadlessTrialOptions {
  readonly seed: number;
  readonly biomeId?: BiomeId;
  readonly durationS: number;
  readonly rainRateMmH?: number;
  readonly jammerEnabled?: boolean;
  readonly enableRicianFading?: boolean;
  readonly enableAirframeShadowing?: boolean;
  readonly scenarioJson?: string;
}

export interface HeadlessTrialResult {
  readonly seed: number;
  readonly biomeId: BiomeId;
  readonly ticks: number;
  readonly elapsedMs: number;
  readonly finalStateDigestHex: string;
  readonly staticGoodputMbps: number;
  readonly reactiveGoodputMbps: number;
  readonly tacGoodputMbps: number;
  readonly staticDropRatePct: number;
  readonly reactiveDropRatePct: number;
  readonly tacDropRatePct: number;
  readonly tacVsStaticGainRatio: number;
  readonly meanSnrDb: number;
  readonly outageRatioPct: number;
}

export interface BatchMetricSummary {
  readonly mean: number;
  readonly std: number;
  readonly ci95HalfWidth: number;
}

export interface BatchSimulationSummary {
  readonly trialCount: number;
  readonly seeds: readonly number[];
  readonly biomeId: BiomeId | 'mixed';
  readonly ticksPerTrial: number;
  readonly staticGoodputMbps: BatchMetricSummary;
  readonly reactiveGoodputMbps: BatchMetricSummary;
  readonly tacGoodputMbps: BatchMetricSummary;
  readonly staticDropRatePct: BatchMetricSummary;
  readonly reactiveDropRatePct: BatchMetricSummary;
  readonly tacDropRatePct: BatchMetricSummary;
  readonly tacVsStaticGainRatio: BatchMetricSummary;
  readonly meanSnrDb: BatchMetricSummary;
  readonly outageRatioPct: BatchMetricSummary;
  readonly elapsedMs: BatchMetricSummary;
}

const MAX_WAYPOINTS = 32;

function isValidBiomeId(value: string): value is BiomeId {
  return Object.prototype.hasOwnProperty.call(THEATER_BIOMES, value);
}

function dispatchCommandOrThrow(manager: SimulationWorkerManager, cmd: WorkerInboundCommand): void {
  const res = manager.handleMessage(cmd);
  if (!res.accepted) {
    throw new Error(`Worker rejected command ${cmd.type}: ${res.reason ?? 'unknown reason'}`);
  }
}

function applyScenarioToManager(manager: SimulationWorkerManager, scenario: MissionScenarioV3): void {
  if (isValidBiomeId(scenario.theater.biomeId)) {
    dispatchCommandOrThrow(manager, {
      type: 'SET_BIOME',
      biomeId: scenario.theater.biomeId,
    });
  }

  const rf = scenario.rfConfig ?? {};
  let carrierFreqGhz: number | undefined;
  let channelBandwidthMhz: number | undefined;
  let rainRateMmh: number | undefined;
  let trafficLoadMultiplier: number | undefined;
  let jammerEnabled: boolean | undefined;
  let jammerEirpDbm: number | undefined;
  let ricianFadingEnabled: boolean | undefined;
  let cqiFeedbackDelayMs: number | undefined;
  let earthRadiusFactorK: number | undefined;
  let activeRelayEnabled: boolean | undefined;

  for (const [k, v] of Object.entries(rf)) {
    if (k === 'carrier_freq_hz' && typeof v === 'number' && Number.isFinite(v) && v > 0) {
      carrierFreqGhz = v / 1e9;
    } else if (k === 'carrier_freq_ghz' && typeof v === 'number' && Number.isFinite(v) && v > 0) {
      carrierFreqGhz = v;
    } else if (k === 'channel_bandwidth_hz' && typeof v === 'number' && Number.isFinite(v) && v > 0) {
      channelBandwidthMhz = Math.max(0.1, Math.min(50.0, v / 1e6));
    } else if (k === 'channel_bandwidth_mhz' && typeof v === 'number' && Number.isFinite(v) && v > 0) {
      channelBandwidthMhz = Math.max(0.1, Math.min(50.0, v));
    } else if (k === 'rain_rate_mmh' && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      rainRateMmh = v;
    } else if (
      (k === 'traffic_scale' || k === 'trafficLoadMultiplier' || k === 'traffic_load_multiplier') &&
      typeof v === 'number' &&
      Number.isFinite(v)
    ) {
      trafficLoadMultiplier = v;
    } else if ((k === 'jammerEnabled' || k === 'jammer_enabled') && typeof v === 'boolean') {
      jammerEnabled = v;
    } else if ((k === 'jammerEirpDbm' || k === 'jammer_eirp_dbm') && typeof v === 'number' && Number.isFinite(v)) {
      jammerEirpDbm = v;
    } else if ((k === 'ricianFadingEnabled' || k === 'enable_rician_fading') && typeof v === 'boolean') {
      ricianFadingEnabled = v;
    } else if (k === 'cqiFeedbackDelayMs' && typeof v === 'number' && Number.isFinite(v)) {
      cqiFeedbackDelayMs = v;
    } else if (k === 'earthRadiusFactorK' && typeof v === 'number' && Number.isFinite(v)) {
      earthRadiusFactorK = v;
    } else if ((k === 'activeRelayEnabled' || k === 'enable_active_relay') && typeof v === 'boolean') {
      activeRelayEnabled = v;
    }
  }

  const useWaypoints =
    scenario.acn.orbitPattern.trim().toLowerCase().includes('waypoint') &&
    scenario.acn.waypoints.length >= 3;

  const configParams: ConfigUpdateParams = {
    acn_altitude_m: scenario.acn.cruiseAltMslM,
    loiter_speed_mps: scenario.acn.cruiseAirspeedMs,
    trajectory_mode: useWaypoints ? 'waypoints' : 'ellipse',
    ...(useWaypoints
      ? {
          waypoints: scenario.acn.waypoints.slice(0, MAX_WAYPOINTS).map((w) => ({
            x_m: w.xM,
            y_m: w.yM,
            z_m: w.altM,
          })),
        }
      : {}),
    ...(carrierFreqGhz !== undefined ? { carrier_freq_ghz: carrierFreqGhz } : {}),
    ...(channelBandwidthMhz !== undefined ? { channel_bandwidth_mhz: channelBandwidthMhz } : {}),
    ...(rainRateMmh !== undefined ? { rain_rate_mmh: rainRateMmh } : {}),
  };

  dispatchCommandOrThrow(manager, { type: 'CONFIG_UPDATE', params: configParams });

  if (
    trafficLoadMultiplier !== undefined ||
    jammerEnabled !== undefined ||
    jammerEirpDbm !== undefined ||
    ricianFadingEnabled !== undefined ||
    cqiFeedbackDelayMs !== undefined ||
    earthRadiusFactorK !== undefined ||
    activeRelayEnabled !== undefined
  ) {
    dispatchCommandOrThrow(manager, {
      type: 'SET_SCIENTIFIC_PARAMS',
      ...(trafficLoadMultiplier !== undefined ? { trafficLoadMultiplier } : {}),
      ...(jammerEnabled !== undefined ? { jammerEnabled } : {}),
      ...(jammerEirpDbm !== undefined ? { jammerEirpDbm } : {}),
      ...(ricianFadingEnabled !== undefined
        ? { ricianFadingEnabled, enableCorrelatedRicianFading: ricianFadingEnabled }
        : {}),
      ...(cqiFeedbackDelayMs !== undefined ? { cqiFeedbackDelayMs } : {}),
      ...(earthRadiusFactorK !== undefined ? { earthRadiusFactorK } : {}),
      ...(activeRelayEnabled !== undefined ? { activeRelayEnabled } : {}),
    });
  }

  const obstacles: CuboidObstacle[] = [];
  for (const obs of scenario.obstacles) {
    if (!Array.isArray(obs.points) || obs.points.length < 2) continue;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const pt of obs.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    const rawW = maxX - minX;
    const rawD = maxY - minY;
    obstacles.push({
      id: obs.id,
      shape: 'cuboid',
      xM: (minX + maxX) * 0.5,
      yM: (minY + maxY) * 0.5,
      widthM: Math.max(MIN_OBSTACLE_DIMENSION_M, Math.min(MAX_OBSTACLE_DIMENSION_M, rawW > 0 ? rawW : 100)),
      depthM: Math.max(MIN_OBSTACLE_DIMENSION_M, Math.min(MAX_OBSTACLE_DIMENSION_M, rawD > 0 ? rawD : 100)),
      heightM: Math.max(MIN_OBSTACLE_DIMENSION_M, Math.min(MAX_OBSTACLE_HEIGHT_M, obs.heightM)),
      rotationDeg: 0,
    });
  }
  dispatchCommandOrThrow(manager, { type: 'OBSTACLES_REPLACE', obstacles });

  const existingIds = new Set(manager.nodeRegistry.getAll().map((e) => e.identity.nodeId));
  const targetIds = new Set(scenario.nodes.map((n) => n.id));
  for (const existingId of existingIds) {
    if (!targetIds.has(existingId)) {
      dispatchCommandOrThrow(manager, { type: 'NODE_DELETE', node_id: existingId });
    }
  }

  for (const sn of scenario.nodes) {
    const tacticalPriority = Math.max(0.1, Math.min(5.0, sn.tacticalPriority));
    const roleNorm = typeof sn.role === 'string' ? sn.role.trim().toLowerCase() : undefined;
    const role = roleNorm === 'soldier' || roleNorm === 'mcp' || roleNorm === 'convoy' ? roleNorm : undefined;
    const rawTx = sn.tx_power_dbm ?? sn.txPowerDbm;
    const txPowerDbm =
      typeof rawTx === 'number' && Number.isFinite(rawTx) ? Math.max(10.0, Math.min(50.0, rawTx)) : undefined;

    if (existingIds.has(sn.id)) {
      dispatchCommandOrThrow(manager, {
        type: 'NODE_UPDATE',
        node_id: sn.id,
        callsign: sn.callsign,
        ...(role ? { role } : {}),
        x_m: sn.xM,
        y_m: sn.yM,
        agl_m: sn.aglM,
        tactical_priority: tacticalPriority,
        ...(txPowerDbm !== undefined ? { tx_power_dbm: txPowerDbm } : {}),
      });
    } else {
      dispatchCommandOrThrow(manager, {
        type: 'NODE_ADD',
        callsign: sn.callsign,
        ...(role ? { role } : {}),
        x_m: sn.xM,
        y_m: sn.yM,
        agl_m: sn.aglM,
        tactical_priority: tacticalPriority,
        ...(txPowerDbm !== undefined ? { tx_power_dbm: txPowerDbm } : {}),
      });
    }
  }
}

/**
 * Executes a single deterministic headless simulation trial on a real `SimulationWorkerManager`
 * stepping at exact 50 Hz (FRAME_DT = 0.020 s).
 */
export function runSingleHeadlessTrial(options: HeadlessTrialOptions): HeadlessTrialResult {
  if (!Number.isFinite(options.seed)) {
    throw new Error(`Trial seed must be finite, got ${options.seed}`);
  }
  if (!Number.isFinite(options.durationS) || options.durationS <= 0) {
    throw new Error(`Trial durationS must be > 0, got ${options.durationS}`);
  }

  const ticks = Math.max(1, Math.round(options.durationS * 50));
  const seedOffset = Math.trunc(options.seed) * 100_000;
  const manager = new SimulationWorkerManager(seedOffset, '16_NODES');
  manager.isPaused = true;

  // Omit heavy UI-only telemetry scopes while keeping authoritative 50 Hz state digest intact.
  dispatchCommandOrThrow(manager, {
    type: 'SET_TELEMETRY_PROFILE',
    subscriptions: {
      linkProfile: false,
      vsaConstellation: false,
      pduDissector: false,
      viewshed: false,
    },
    uiPublishIntervalTicks: 1,
  });

  if (options.scenarioJson !== undefined) {
    const parsed = parseMissionScenarioJson(options.scenarioJson);
    if (!parsed.ok || !parsed.scenario) {
      throw new Error(`Invalid scenarioJson: ${parsed.error ?? 'parse failed'}`);
    }
    applyScenarioToManager(manager, parsed.scenario);
  }

  if (options.biomeId !== undefined) {
    dispatchCommandOrThrow(manager, {
      type: 'SET_BIOME',
      biomeId: options.biomeId,
    });
  }

  if (options.rainRateMmH !== undefined) {
    dispatchCommandOrThrow(manager, {
      type: 'CONFIG_UPDATE',
      params: { rain_rate_mmh: options.rainRateMmH },
    });
  }

  if (
    options.jammerEnabled !== undefined ||
    options.enableRicianFading !== undefined ||
    options.enableAirframeShadowing !== undefined
  ) {
    dispatchCommandOrThrow(manager, {
      type: 'SET_SCIENTIFIC_PARAMS',
      ...(options.jammerEnabled !== undefined ? { jammerEnabled: options.jammerEnabled } : {}),
      ...(options.enableRicianFading !== undefined
        ? {
            ricianFadingEnabled: options.enableRicianFading,
            enableCorrelatedRicianFading: options.enableRicianFading,
          }
        : {}),
      ...(options.enableAirframeShadowing !== undefined
        ? { enableAirframeShadowing: options.enableAirframeShadowing }
        : {}),
    });
  }

  let snrSum = 0;
  let snrCount = 0;
  let outageSamples = 0;
  let totalLinkSamples = 0;

  const startedMs = performance.now();
  for (let i = 0; i < ticks; i++) {
    const isLast = i === ticks - 1;
    manager.tickSimulation(isLast);
    for (const ls of manager.linkStatuses.values()) {
      const effSnr = ls.sinrDb ?? ls.snrDb;
      if (Number.isFinite(effSnr)) {
        snrSum += effSnr;
        snrCount++;
      }
      totalLinkSamples++;
      if (ls.isOutage) {
        outageSamples++;
      }
    }
  }
  const elapsedMs = performance.now() - startedMs;

  const finalFrame = manager.lastTelemetryFrame;
  if (!finalFrame) {
    throw new Error('Headless trial finished without emitting a final TelemetryFrame');
  }

  const simDurationS = ticks * FRAME_DT;
  const m = manager.metrics;

  const staticGoodputMbps = m.staticGoodputBits / simDurationS / 1e6;
  const reactiveGoodputMbps = (m.reactiveGoodputBits ?? 0) / simDurationS / 1e6;
  const tacGoodputMbps = m.tacGoodputBits / simDurationS / 1e6;

  const staticDropRatePct =
    m.staticEnqueuedPkts > 0 ? (100.0 * m.staticDroppedPkts) / m.staticEnqueuedPkts : 0.0;
  const reactiveEnqueued = m.reactiveEnqueuedPkts ?? 0;
  const reactiveDropRatePct =
    reactiveEnqueued > 0 ? (100.0 * (m.reactiveDroppedPkts ?? 0)) / reactiveEnqueued : 0.0;
  const tacDropRatePct =
    m.tacEnqueuedPkts > 0 ? (100.0 * m.tacDroppedPkts) / m.tacEnqueuedPkts : 0.0;

  const tacVsStaticGainRatio =
    m.staticGoodputBits > 0
      ? m.tacGoodputBits / m.staticGoodputBits
      : m.tacGoodputBits > 0
        ? m.tacGoodputBits
        : 1.0;

  const meanSnrDb = snrCount > 0 ? snrSum / snrCount : 0.0;
  const outageRatioPct = totalLinkSamples > 0 ? (100.0 * outageSamples) / totalLinkSamples : 0.0;
  const finalStateDigestHex = finalFrame.state_digest_hex ?? computeTelemetryStateDigest(finalFrame);

  return {
    seed: options.seed,
    biomeId: manager.biomeId,
    ticks,
    elapsedMs,
    finalStateDigestHex,
    staticGoodputMbps,
    reactiveGoodputMbps,
    tacGoodputMbps,
    staticDropRatePct,
    reactiveDropRatePct,
    tacDropRatePct,
    tacVsStaticGainRatio,
    meanSnrDb,
    outageRatioPct,
  };
}

function summarizeMetric(values: readonly number[]): BatchMetricSummary {
  const stats = computeSampleStatistics(values);
  return {
    mean: stats.mean,
    std: stats.stdDev,
    ci95HalfWidth: stats.marginOfError,
  };
}

/**
 * Sorts trials deterministically by `seed` ascending and computes mean, sample std,
 * and Student-t 95% confidence interval half-widths across all seeds.
 */
export function aggregateBatchResults(trials: readonly HeadlessTrialResult[]): BatchSimulationSummary {
  const sorted = [...trials].sort((a, b) => a.seed - b.seed);
  if (sorted.length === 0) {
    const empty: BatchMetricSummary = { mean: 0, std: 0, ci95HalfWidth: 0 };
    return {
      trialCount: 0,
      seeds: [],
      biomeId: 'alpine_mountain',
      ticksPerTrial: 0,
      staticGoodputMbps: empty,
      reactiveGoodputMbps: empty,
      tacGoodputMbps: empty,
      staticDropRatePct: empty,
      reactiveDropRatePct: empty,
      tacDropRatePct: empty,
      tacVsStaticGainRatio: empty,
      meanSnrDb: empty,
      outageRatioPct: empty,
      elapsedMs: empty,
    };
  }

  const firstBiome = sorted[0].biomeId;
  const allSameBiome = sorted.every((t) => t.biomeId === firstBiome);

  return {
    trialCount: sorted.length,
    seeds: sorted.map((t) => t.seed),
    biomeId: allSameBiome ? firstBiome : 'mixed',
    ticksPerTrial: sorted[0].ticks,
    staticGoodputMbps: summarizeMetric(sorted.map((t) => t.staticGoodputMbps)),
    reactiveGoodputMbps: summarizeMetric(sorted.map((t) => t.reactiveGoodputMbps)),
    tacGoodputMbps: summarizeMetric(sorted.map((t) => t.tacGoodputMbps)),
    staticDropRatePct: summarizeMetric(sorted.map((t) => t.staticDropRatePct)),
    reactiveDropRatePct: summarizeMetric(sorted.map((t) => t.reactiveDropRatePct)),
    tacDropRatePct: summarizeMetric(sorted.map((t) => t.tacDropRatePct)),
    tacVsStaticGainRatio: summarizeMetric(sorted.map((t) => t.tacVsStaticGainRatio)),
    meanSnrDb: summarizeMetric(sorted.map((t) => t.meanSnrDb)),
    outageRatioPct: summarizeMetric(sorted.map((t) => t.outageRatioPct)),
    elapsedMs: summarizeMetric(sorted.map((t) => t.elapsedMs)),
  };
}

/**
 * Formats batch trial results sorted deterministically by `seed` ascending.
 * Omits non-deterministic wall-clock `elapsedMs` so single-thread and multi-thread runs
 * emit bit-identical CSV output.
 */
export function formatBatchCsv(trials: readonly HeadlessTrialResult[]): string {
  const sorted = [...trials].sort((a, b) => a.seed - b.seed);
  const header = [
    'seed',
    'biome_id',
    'ticks',
    'final_state_digest_hex',
    'static_goodput_mbps',
    'reactive_goodput_mbps',
    'tac_goodput_mbps',
    'static_drop_rate_pct',
    'reactive_drop_rate_pct',
    'tac_drop_rate_pct',
    'tac_vs_static_gain_ratio',
    'mean_snr_db',
    'outage_ratio_pct',
  ].join(',');

  const rows = sorted.map((t) =>
    [
      t.seed,
      t.biomeId,
      t.ticks,
      t.finalStateDigestHex,
      t.staticGoodputMbps.toFixed(6),
      t.reactiveGoodputMbps.toFixed(6),
      t.tacGoodputMbps.toFixed(6),
      t.staticDropRatePct.toFixed(6),
      t.reactiveDropRatePct.toFixed(6),
      t.tacDropRatePct.toFixed(6),
      t.tacVsStaticGainRatio.toFixed(6),
      t.meanSnrDb.toFixed(6),
      t.outageRatioPct.toFixed(6),
    ].join(',')
  );

  return [header, ...rows].join('\n') + '\n';
}
