/**
 * Headless paired-scheduler benchmark for the current TypeScript engine.
 * Example: npx vite-node scripts/run_ts_benchmark.ts --frames 500 --seeds 1,2,3 --terrain-mode synthetic
 * Supports both synthetic procedural terrain and authentic real satellite DEM benchmarks.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { SimulationWorkerManager } from '../src/worker/simWorker';
import { computeNearestRankPercentile } from '../src/core/rollingGoodput';
import { generateSimulationTrace } from '../src/tests/helpers/simulationTrace';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
function parsePositiveInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
function parseNonNegativeInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

const durationArg = argValue('--duration', '');
const frames = durationArg
  ? Math.max(1, Math.round(Number(durationArg) / 0.020))
  : parsePositiveInt(argValue('--frames', '500'), '--frames');
const demLookaheadErrorStdM = Number(argValue('--dem-error-m', '0.0'));
const seedsRaw = argValue('--seeds', '1,2,3,4,5');
const seeds: number[] = seedsRaw.split(',').map(s => parsePositiveInt(s.trim(), '--seeds entry'));
const warmupFrames = parseNonNegativeInt(argValue('--warmup', '0'), '--warmup');
const requestedTerrainMode = argValue('--terrain-mode', 'synthetic').toLowerCase();
if (requestedTerrainMode !== 'synthetic' && requestedTerrainMode !== 'real') {
  throw new Error(`--terrain-mode must be 'synthetic' or 'real', got '${requestedTerrainMode}'`);
}
const outputDir = resolve(argValue('--out', 'benchmark_results/generated'));

const traceEnabled = process.argv.includes('--trace');
const traceInterval = parsePositiveInt(argValue('--trace-interval', '1'), '--trace-interval');
const traceOut = argValue('--trace-out', '');

// Environment and Provenance Metadata (Milestone M0.1)
let gitCommit = 'unknown';
let gitBranch = 'unknown';
let gitDirty = false;
try {
  gitCommit = execSync('git rev-parse HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  const status = execSync('git status --porcelain', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  gitDirty = status.length > 0;
} catch (_) {}

let realDemBuffer: Buffer | null = null;
let terrainAssetChecksum: string | null = null;
const realDemPath = resolve(process.cwd(), 'public/terrain/real_ladakh_dem.bin');

if (requestedTerrainMode === 'real') {
  if (!existsSync(realDemPath)) {
    throw new Error(`Real satellite DEM file not found at ${realDemPath}`);
  }
  realDemBuffer = readFileSync(realDemPath);
  if (realDemBuffer.byteLength < 512 * 512 * 4) {
    throw new Error(`Real satellite DEM buffer must be at least 1,048,576 bytes, got ${realDemBuffer.byteLength}`);
  }
  terrainAssetChecksum = createHash('sha256').update(realDemBuffer).digest('hex');
}

// Unmeasured Warm-up Execution on an isolated worker instance to warm V8 Turbofan JIT compiler
if (warmupFrames > 0) {
  const warmupManager = new SimulationWorkerManager(999_999);
  if (requestedTerrainMode === 'real' && realDemBuffer) {
    const demArray = new Float32Array(realDemBuffer.buffer, realDemBuffer.byteOffset, 512 * 512);
    warmupManager.terrainEngine.loadCustomDem(demArray);
    (warmupManager as any).resampleGroundNodeAltitudes?.();
  } else {
    warmupManager.terrainEngine.setTerrainMode('synthetic');
  }
  warmupManager.isPaused = true;
  for (let w = 0; w < warmupFrames; w++) {
    warmupManager.tickSimulation();
  }
}

const rows: Array<Record<string, number | string>> = [];
const allStepDurationsMs: number[] = [];
const allSetupDurationsMs: number[] = [];
const benchmarkStartMs = performance.now();

for (const seed of seeds) {
  const setupStart = performance.now();
  const manager = new SimulationWorkerManager(seed * 100_000);
  if (demLookaheadErrorStdM > 0) {
    manager.envConfig.demLookaheadErrorStdM = demLookaheadErrorStdM;
  }

  if (requestedTerrainMode === 'real' && realDemBuffer) {
    const demArray = new Float32Array(realDemBuffer.buffer, realDemBuffer.byteOffset, 512 * 512);
    manager.terrainEngine.loadCustomDem(demArray);
    (manager as any).resampleGroundNodeAltitudes?.();
  } else {
    manager.terrainEngine.setTerrainMode('synthetic');
  }

  manager.isPaused = true;
  const setupPhaseMs = performance.now() - setupStart;
  allSetupDurationsMs.push(setupPhaseMs);

  // Measured Benchmark Execution with Per-Step Latency Profiling
  const stepDurationsMs: number[] = new Array(frames);
  const started = performance.now();
  for (let i = 0; i < frames; i++) {
    const stepStart = performance.now();
    manager.tickSimulation();
    const stepTimeMs = performance.now() - stepStart;
    stepDurationsMs[i] = stepTimeMs;
    allStepDurationsMs.push(stepTimeMs);
  }
  const elapsedMs = performance.now() - started;
  const simDurationS = frames * 0.020; // Exact simulation duration for measured frames
  const m = manager.metrics;

  const sortedLatencies = [...stepDurationsMs].sort((a, b) => a - b);
  const p50 = computeNearestRankPercentile(sortedLatencies, 0.50) ?? 0;
  const p95 = computeNearestRankPercentile(sortedLatencies, 0.95) ?? 0;
  const p99 = computeNearestRankPercentile(sortedLatencies, 0.99) ?? 0;
  const meanStep = sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length;
  const minStep = sortedLatencies[0] ?? 0;
  const maxStep = sortedLatencies[sortedLatencies.length - 1] ?? 0;

  rows.push({
    schema_version: '1.3', engine: 'typescript_webworker', terrain_mode: manager.terrainEngine.terrain_mode,
    seed, frames_requested: frames, frames_completed: manager.frameIndex,
    setup_phase_ms: Number(setupPhaseMs.toFixed(3)),
    sim_duration_s: Number(simDurationS.toFixed(6)), wall_runtime_ms: Number(elapsedMs.toFixed(3)),
    step_p50_ms: Number(p50.toFixed(4)),
    step_p95_ms: Number(p95.toFixed(4)),
    step_p99_ms: Number(p99.toFixed(4)),
    step_mean_ms: Number(meanStep.toFixed(4)),
    step_min_ms: Number(minStep.toFixed(4)),
    step_max_ms: Number(maxStep.toFixed(4)),
    static_goodput_bits: Math.round(m.staticGoodputBits), tac_goodput_bits: Math.round(m.tacGoodputBits),
    reactive_goodput_bits: Math.round(m.reactiveGoodputBits ?? 0),
    static_goodput_mbps_avg: Number((m.staticGoodputBits / simDurationS / 1e6).toFixed(6)),
    tac_goodput_mbps_avg: Number((m.tacGoodputBits / simDurationS / 1e6).toFixed(6)),
    reactive_goodput_mbps_avg: Number(((m.reactiveGoodputBits ?? 0) / simDurationS / 1e6).toFixed(6)),
    goodput_ratio_tac_over_static: Number((m.tacGoodputBits / Math.max(1, m.staticGoodputBits)).toFixed(6)),
    goodput_ratio_tac_over_reactive: Number((m.tacGoodputBits / Math.max(1, m.reactiveGoodputBits ?? 1)).toFixed(6)),
    static_dropped_packets_final: m.staticDroppedPkts, tac_dropped_packets_final: m.tacDroppedPkts,
    reactive_dropped_packets_final: m.reactiveDroppedPkts ?? 0,
    static_delay_drops_observed: m.staticDelayDropsThisRun,
    tac_delay_drops_observed: m.tacDelayDropsThisRun,
    reactive_delay_drops_observed: m.reactiveDelayDropsThisRun ?? 0,
    static_overflow_drops_observed: m.staticOverflowDropsThisRun,
    tac_overflow_drops_observed: m.tacOverflowDropsThisRun,
    reactive_overflow_drops_observed: m.reactiveOverflowDropsThisRun ?? 0,
    static_payload_bits_dequeued: Math.round(m.staticPayloadBitsDequeued),
    tac_payload_bits_dequeued: Math.round(m.tacPayloadBitsDequeued),
    reactive_payload_bits_dequeued: Math.round(m.reactivePayloadBitsDequeued ?? 0),
    static_wasted_bits_on_outage: Math.round(m.staticWastedBits),
    tac_wasted_bits_on_outage: Math.round(m.tacWastedBits),
    reactive_wasted_bits_on_outage: Math.round(m.reactiveWastedBits ?? 0),
    static_scheduled_ul_time_s: Number(m.staticScheduledUlTimeS.toFixed(9)),
    tac_scheduled_ul_time_s: Number(m.tacScheduledUlTimeS.toFixed(9)),
    reactive_scheduled_ul_time_s: Number((m.reactiveScheduledUlTimeS ?? 0).toFixed(9)),
    static_available_ul_time_s: Number(m.staticAvailableUlTimeS.toFixed(9)),
    tac_available_ul_time_s: Number(m.tacAvailableUlTimeS.toFixed(9)),
    reactive_available_ul_time_s: Number((m.reactiveAvailableUlTimeS ?? 0).toFixed(9)),
    static_unused_ul_time_s: Number(m.staticUnusedUlTimeS.toFixed(9)),
    tac_unused_ul_time_s: Number(m.tacUnusedUlTimeS.toFixed(9)),
    reactive_unused_ul_time_s: Number((m.reactiveUnusedUlTimeS ?? 0).toFixed(9)),
    static_run_ul_utilization_pct: Number((100 * m.staticScheduledUlTimeS / Math.max(m.staticAvailableUlTimeS, 1e-12)).toFixed(6)),
    tac_run_ul_utilization_pct: Number((100 * m.tacScheduledUlTimeS / Math.max(m.tacAvailableUlTimeS, 1e-12)).toFixed(6)),
    reactive_run_ul_utilization_pct: Number((100 * (m.reactiveScheduledUlTimeS ?? 0) / Math.max(m.reactiveAvailableUlTimeS ?? 1, 1e-12)).toFixed(6)),
    static_final_frame_ul_utilization_pct: Number(m.lastStaticUtilPct.toFixed(6)),
    tac_final_frame_ul_utilization_pct: Number(m.lastTacUtilPct.toFixed(6)),
    reactive_final_frame_ul_utilization_pct: Number((m.lastReactiveUtilPct ?? 0).toFixed(6)),
    static_final_backlog_bits: Math.round(m.staticFinalBacklogBits),
    tac_final_backlog_bits: Math.round(m.tacFinalBacklogBits),
    reactive_final_backlog_bits: Math.round(m.reactiveFinalBacklogBits ?? 0),
  });
  console.log(`seed=${seed} mode=${manager.terrainEngine.terrain_mode} frames=${frames} setup=${setupPhaseMs.toFixed(2)}ms Tac=${(m.tacGoodputBits / 1e6).toFixed(2)}Mb/drops(${m.tacDelayDropsThisRun}d/${m.tacOverflowDropsThisRun}o) Static=${(m.staticGoodputBits / 1e6).toFixed(2)}Mb/drops(${m.staticDelayDropsThisRun}d/${m.staticOverflowDropsThisRun}o) Reactive=${((m.reactiveGoodputBits ?? 0) / 1e6).toFixed(2)}Mb/drops(${m.reactiveDelayDropsThisRun ?? 0}d/${m.reactiveOverflowDropsThisRun ?? 0}o) (p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms)`);
}

const totalWallElapsedMs = performance.now() - benchmarkStartMs;
const overallSorted = [...allStepDurationsMs].sort((a, b) => a - b);
const overallP50 = computeNearestRankPercentile(overallSorted, 0.50) ?? 0;
const overallP95 = computeNearestRankPercentile(overallSorted, 0.95) ?? 0;
const overallP99 = computeNearestRankPercentile(overallSorted, 0.99) ?? 0;
const overallMean = overallSorted.reduce((a, b) => a + b, 0) / (overallSorted.length || 1);

const sortedSetups = [...allSetupDurationsMs].sort((a, b) => a - b);
const p50Setup = computeNearestRankPercentile(sortedSetups, 0.50) ?? 0;
const meanSetup = sortedSetups.reduce((a, b) => a + b, 0) / (sortedSetups.length || 1);

if (rows.some(row => row.frames_completed !== frames)) throw new Error('One or more runs did not complete the requested frame count');
mkdirSync(outputDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const jsonPath = resolve(outputDir, `typescript-benchmark-${stamp}.json`);
const csvPath = resolve(outputDir, `typescript-benchmark-${stamp}.csv`);
const fields = Object.keys(rows[0]);
const csvCell = (value: unknown) => {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

writeFileSync(jsonPath, JSON.stringify({
  schema_version: '1.3',
  generated_at_utc: new Date().toISOString(),
  engine: 'TypeScript WebWorker engine',
  provenance: {
    git_commit: gitCommit,
    git_branch: gitBranch,
    git_dirty: gitDirty,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu_model: os.cpus()[0]?.model ?? 'unknown',
    cpu_count: os.cpus().length,
  },
  configuration: {
    frames_per_run: frames,
    seeds,
    terrain_mode: requestedTerrainMode,
    dem_lookahead_error_std_m: demLookaheadErrorStdM,
    terrain_asset_checksum_sha256: terrainAssetChecksum,
    simulation_timestep_s: 0.020,
    warmup_frames: warmupFrames,
  },
  overall_setup_stats: {
    runs_initialized: allSetupDurationsMs.length,
    p50_setup_ms: Number(p50Setup.toFixed(4)),
    mean_setup_ms: Number(meanSetup.toFixed(4)),
    min_setup_ms: Number((sortedSetups[0] ?? 0).toFixed(4)),
    max_setup_ms: Number((sortedSetups[sortedSetups.length - 1] ?? 0).toFixed(4)),
  },
  overall_latency_stats: {
    total_steps_profiled: allStepDurationsMs.length,
    p50_step_ms: Number(overallP50.toFixed(4)),
    p95_step_ms: Number(overallP95.toFixed(4)),
    p99_step_ms: Number(overallP99.toFixed(4)),
    mean_step_ms: Number(overallMean.toFixed(4)),
    min_step_ms: Number((overallSorted[0] ?? 0).toFixed(4)),
    max_step_ms: Number((overallSorted[overallSorted.length - 1] ?? 0).toFixed(4)),
    total_campaign_wall_duration_ms: Number(totalWallElapsedMs.toFixed(3)),
  },
  methodology: 'Paired side-by-side schedulers; fresh manager per seed; fixed frames per run. Goodput is payload dequeued while the scheduler reports a usable link. Airtime utilization is scheduled airtime including guard intervals divided by available uplink airtime.',
  metric_definitions: {
    setup_phase_ms: 'One-time pre-simulation initialization duration in milliseconds, including worker manager instantiation, terrain loading/configuration, and node elevation resampling. Measured separately from step latency.',
    goodput_bits: 'Sum of actual packet payload bits dequeued on usable links; not slot capacity and not an independent end-to-end receiver/ACK measurement.',
    payload_bits_dequeued: 'Actual packet payload bits removed from queues, including payload removed during a reported outage.',
    wasted_bits_on_outage: 'Payload bits removed from a queue while the corresponding link/predictive state is in outage. Tac-TAD filters unusable links before dequeue, so zero is expected by design.',
    dropped_packets_final: 'Cumulative delay plus overflow drop counters at the end of the run.',
    drops_observed: 'Sum of per-frame non-negative deltas in cumulative delay/overflow drop counters.',
    scheduled_ul_time_s: 'Sum of slot duration plus guard interval for all scheduled allocations.',
    unused_ul_time_s: 'Available uplink airtime minus scheduled airtime, clamped at zero.',
    run_ul_utilization_pct: 'Total scheduled uplink airtime divided by total available uplink airtime across the run.',
    final_backlog_bits: 'Queued payload bits remaining after the final simulated frame.',
    step_p50_ms: '50th percentile (median) per-step simulation wall-clock execution duration in milliseconds.',
    step_p95_ms: '95th percentile per-step simulation wall-clock execution duration in milliseconds.',
    step_p99_ms: '99th percentile per-step simulation wall-clock execution duration in milliseconds.',
  },
  limitations: [
    'This benchmark does not establish parity with the legacy Python engine.',
    'Synthetic terrain is generated procedurally via 2D IFFT; real DEM benchmark loads satellite Float32 raster from disk.',
    'Goodput is a scheduler-level model metric, not independently verified receiver delivery or ACK completion.',
    'Outage waste measures payload dequeued during outage, not RF energy or all forms of unused capacity.',
    'Scheduler comparisons are paired within each run; seed offset is the varied input.',
    'Steady-state step latency strictly measures tickSimulation() execution, excluding setup_phase_ms.',
    'Measured step latency includes internal telemetry frame construction, but excludes Web Worker message transport, structured cloning serialization overhead, and browser rendering.',
    'With --warmup 0, JIT cold-start compilation and terrain initializations cause initial frames to experience latency spikes up to 35-45 ms; pre-warming eliminates JIT compilation artifacts.',
  ],
  runs: rows,
}, null, 2));

writeFileSync(csvPath, `${fields.join(',')}\n${rows.map(row => fields.map(f => csvCell(row[f])).join(',')).join('\n')}\n`);
console.log(`\nWrote ${rows.length} runs:\n  ${jsonPath}\n  ${csvPath}`);

// Optional Canonical State-Hash Trace Recording
if (traceEnabled) {
  const traceTargetSeed = seeds[0];
  const traceResult = generateSimulationTrace({
    seed: traceTargetSeed,
    frames,
    terrainMode: requestedTerrainMode,
    traceInterval,
    realDemBuffer,
    terrainAssetChecksum,
  });
  const traceDestination = traceOut
    ? resolve(traceOut)
    : resolve(outputDir, `simulation-trace-${requestedTerrainMode}-seed${traceTargetSeed}-${stamp}.json`);
  mkdirSync(resolve(traceDestination, '..'), { recursive: true });
  writeFileSync(traceDestination, JSON.stringify(traceResult, null, 2), 'utf8');
  console.log(`\n[+] Canonical state-hash trace saved to:\n  ${traceDestination}`);
}
