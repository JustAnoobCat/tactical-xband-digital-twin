#!/usr/bin/env vite-node
/**
 * scripts/benchmark_scale_nodes.ts
 *
 * DRDO X-Band Tactical Aerial Communication Network Digital Twin
 * Authoritative Node Population Scalability Benchmark (Step B)
 *
 * Measures discrete simulation tick execution latency across ground node population tiers:
 *   - 16 nodes (canonical baseline)
 *   - 32 nodes
 *   - 64 nodes
 *   - 96 nodes
 *   - 128 nodes (maximum architectural capacity)
 *
 * Environment:
 *   - Authentic Ladakh DEM (512x512 Float32, 1,048,576 bytes)
 *   - Isolated worker instances per tier to eliminate state contamination
 *   - Unmeasured V8 Turbofan JIT pre-warming
 *   - High-resolution wall-clock profiling via performance.now()
 *   - Dual-mode evaluation: Physics-Only vs Full Telemetry
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import os from 'node:os';

import { SimulationWorkerManager } from '../src/worker/simWorker';
import { NodeLifecycleManager } from '../src/worker/nodeLifecycleManager';
import { computeNearestRankPercentile } from '../src/core/rollingGoodput';

// -----------------------------------------------------------------------------
// CLI Argument Parsing
// -----------------------------------------------------------------------------
function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const MEASURED_TICKS = Math.max(200, parseInt(getArg('--ticks', '200'), 10));
const WARMUP_TICKS = Math.max(0, parseInt(getArg('--warmup', '20'), 10));
const JIT_WARMUP_TICKS = Math.max(0, parseInt(getArg('--jit-warmup', '100'), 10));
const BENCHMARK_SEED = parseInt(getArg('--seed', '42'), 10);
const OUTPUT_DIR = resolve(process.cwd(), getArg('--out-dir', 'benchmark_results/generated'));
const POPULATION_TIERS = [16, 32, 64, 96, 128];
const REAL_DEM_PATH = resolve(process.cwd(), 'public/terrain/real_ladakh_dem.bin');

// -----------------------------------------------------------------------------
// Provenance & Environment Capture
// -----------------------------------------------------------------------------
interface BenchmarkProvenance {
  git_commit: string;
  git_branch: string;
  git_dirty: boolean;
  node_version: string;
  v8_version: string;
  platform: string;
  arch: string;
  cpu_model: string;
  cpu_count: number;
  total_memory_bytes: number;
  free_memory_bytes: number;
  dem_file: string;
  dem_byte_length: number;
  dem_sha256: string;
}

function captureProvenance(demBuffer: Buffer): BenchmarkProvenance {
  let gitCommit = 'unknown';
  let gitBranch = 'unknown';
  let gitDirty = false;
  try {
    gitCommit = execSync('git rev-parse HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    const status = execSync('git status --porcelain', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    gitDirty = status.length > 0;
  } catch (_) {}

  return {
    git_commit: gitCommit,
    git_branch: gitBranch,
    git_dirty: gitDirty,
    node_version: process.version,
    v8_version: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpu_model: os.cpus()[0]?.model ?? 'unknown',
    cpu_count: os.cpus().length,
    total_memory_bytes: os.totalmem(),
    free_memory_bytes: os.freemem(),
    dem_file: 'public/terrain/real_ladakh_dem.bin',
    dem_byte_length: demBuffer.byteLength,
    dem_sha256: createHash('sha256').update(demBuffer).digest('hex'),
  };
}

// -----------------------------------------------------------------------------
// Instance Construction & Deterministic Population
// -----------------------------------------------------------------------------
function createTierInstance(
  targetNodeCount: number,
  seed: number,
  demBuffer: Buffer
): { manager: SimulationWorkerManager; setupDurationMs: number } {
  const t0 = performance.now();
  const manager = new SimulationWorkerManager(seed * 100_000, '16_NODES');

  // Ingest genuine Ladakh DEM into terrainEngine
  const demArray = new Float32Array(demBuffer.buffer, demBuffer.byteOffset, 512 * 512);
  const loaded = manager.terrainEngine.loadCustomDem(demArray);
  if (!loaded) {
    throw new Error('Failed to load authentic Ladakh DEM into TerrainEngine');
  }

  // Resample canonical 16 nodes to authentic DEM elevations + AGL
  NodeLifecycleManager.resampleGroundNodeAltitudes(
    manager.nodesStatic,
    manager.nodesTac,
    manager.nodeRegistry,
    manager.terrainEngine
  );

  // Sequentially add dynamic nodes up to targetNodeCount using verified placement rule
  for (let i = 16; i < targetNodeCount; i++) {
    const res = manager.handleMessage({
      type: 'NODE_ADD',
      x_m: (i % 10) * 1000 - 5000,
      y_m: Math.floor(i / 10) * 1000 - 5000,
      agl_m: 2.0,
    });
    if (!res.accepted) {
      throw new Error(`Failed to add node ${i}: ${res.reason}`);
    }
  }

  if (manager.nodesTac.length !== targetNodeCount || manager.nodesStatic.length !== targetNodeCount) {
    throw new Error(
      `Node count mismatch: expected ${targetNodeCount}, got Tac=${manager.nodesTac.length}, Static=${manager.nodesStatic.length}`
    );
  }

  const setupDurationMs = performance.now() - t0;
  return { manager, setupDurationMs };
}

// -----------------------------------------------------------------------------
// Statistical Computation
// -----------------------------------------------------------------------------
export interface LatencyStatistics {
  count: number;
  mean_ms: number;
  std_dev_ms: number;
  min_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  total_duration_ms: number;
  ticks_exceeding_20ms: number;
  pct_exceeding_20ms: number;
  mean_to_budget_ratio: number;
}

function computeStatistics(samples: number[]): LatencyStatistics {
  const n = samples.length;
  if (n === 0) {
    throw new Error('Cannot compute statistics on empty sample set');
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;

  let varianceSum = 0;
  for (const v of sorted) {
    const diff = v - mean;
    varianceSum += diff * diff;
  }
  const stdDev = Math.sqrt(varianceSum / (n > 1 ? n - 1 : 1));

  const min = sorted[0];
  const max = sorted[n - 1];
  const p50 = computeNearestRankPercentile(sorted, 0.50) ?? sorted[Math.floor(n * 0.5)];
  const p95 = computeNearestRankPercentile(sorted, 0.95) ?? sorted[Math.floor(n * 0.95)];
  const p99 = computeNearestRankPercentile(sorted, 0.99) ?? sorted[Math.floor(n * 0.99)];

  const exceeding = sorted.filter(v => v > 20.0).length;

  return {
    count: n,
    mean_ms: Number(mean.toFixed(3)),
    std_dev_ms: Number(stdDev.toFixed(3)),
    min_ms: Number(min.toFixed(3)),
    p50_ms: Number(p50.toFixed(3)),
    p95_ms: Number(p95.toFixed(3)),
    p99_ms: Number(p99.toFixed(3)),
    max_ms: Number(max.toFixed(3)),
    total_duration_ms: Number(sum.toFixed(3)),
    ticks_exceeding_20ms: exceeding,
    pct_exceeding_20ms: Number(((exceeding / n) * 100).toFixed(2)),
    mean_to_budget_ratio: Number((mean / 20.0).toFixed(3)),
  };
}

// -----------------------------------------------------------------------------
// Terminal Formatting Helpers
// -----------------------------------------------------------------------------
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function formatLatency(val: number): string {
  const str = val.toFixed(2).padStart(6, ' ') + ' ms';
  if (val > 20.0) return `${ANSI.red}${ANSI.bold}${str}${ANSI.reset}`;
  if (val > 15.0) return `${ANSI.yellow}${str}${ANSI.reset}`;
  return `${ANSI.green}${str}${ANSI.reset}`;
}

// -----------------------------------------------------------------------------
// Main Execution
// -----------------------------------------------------------------------------
interface TierRunResult {
  node_count: number;
  setup_duration_ms: number;
  physics_only: {
    stats: LatencyStatistics;
    raw_samples_ms: number[];
  };
  full_tick_with_telemetry: {
    stats: LatencyStatistics;
    raw_samples_ms: number[];
  };
}

async function runBenchmark(): Promise<void> {
  console.log('='.repeat(96));
  console.log(`${ANSI.bold}   DRDO X-BAND DIGITAL TWIN // NODE POPULATION SCALABILITY BENCHMARK (STEP B)${ANSI.reset}`);
  console.log('='.repeat(96));

  if (!existsSync(REAL_DEM_PATH)) {
    throw new Error(`Real satellite DEM file not found at ${REAL_DEM_PATH}`);
  }

  const demBuffer = readFileSync(REAL_DEM_PATH);
  if (demBuffer.byteLength < 512 * 512 * 4) {
    throw new Error(`Real satellite DEM file is smaller than expected 512x512 Float32 raster (${demBuffer.byteLength} bytes)`);
  }

  const provenance = captureProvenance(demBuffer);

  console.log(` Commit   : ${provenance.git_commit.slice(0, 8)} (${provenance.git_branch}${provenance.git_dirty ? ', dirty' : ''})`);
  console.log(` Platform : ${provenance.platform} ${provenance.arch} | Node ${provenance.node_version} | V8 ${provenance.v8_version}`);
  console.log(` Hardware : ${provenance.cpu_count}x ${provenance.cpu_model} | RAM: ${(provenance.total_memory_bytes / 1e9).toFixed(1)} GB`);
  console.log(` DEM File : ${provenance.dem_file} (${(provenance.dem_byte_length / 1024).toFixed(0)} KB)`);
  console.log(` DEM Hash : ${provenance.dem_sha256}`);
  console.log(` Target   : 5 Tiers [${POPULATION_TIERS.join(', ')}] | ${MEASURED_TICKS} ticks/tier | Warmup: ${WARMUP_TICKS} ticks`);
  console.log('-'.repeat(96));

  // Step 1: V8 JIT Warm-up on an isolated 128-node instance
  if (JIT_WARMUP_TICKS > 0) {
    process.stdout.write(`[*] Warming up V8 Turbofan JIT (${JIT_WARMUP_TICKS} ticks on isolated 128-node instance)... `);
    const warmupStart = performance.now();
    const { manager: warmupMgr } = createTierInstance(128, 999, demBuffer);
    for (let w = 0; w < Math.floor(JIT_WARMUP_TICKS / 2); w++) {
      warmupMgr.tickSimulation(false);
    }
    for (let w = 0; w < Math.ceil(JIT_WARMUP_TICKS / 2); w++) {
      warmupMgr.tickSimulation(true);
    }
    const warmupDur = (performance.now() - warmupStart).toFixed(0);
    console.log(`${ANSI.green}Ready (${warmupDur} ms)${ANSI.reset}`);
  }

  const tierResults: TierRunResult[] = [];

  // Step 2: Iterate population tiers
  for (const tier of POPULATION_TIERS) {
    console.log(`\n${ANSI.bold}[+] Executing Population Tier: ${tier} Active Nodes${ANSI.reset}`);

    // --- Mode A: Physics-Only Ticks ---
    process.stdout.write(`    -> Measuring ${MEASURED_TICKS} Physics-Only ticks (tickSimulation(false))... `);
    const { manager: physMgr, setupDurationMs: physSetupMs } = createTierInstance(tier, BENCHMARK_SEED, demBuffer);

    // Warm-up on instance
    for (let w = 0; w < WARMUP_TICKS; w++) {
      physMgr.tickSimulation(false);
    }

    const physSamples: number[] = new Array(MEASURED_TICKS);
    for (let i = 0; i < MEASURED_TICKS; i++) {
      const t0 = performance.now();
      physMgr.tickSimulation(false);
      const t1 = performance.now();
      physSamples[i] = t1 - t0;
    }
    const physStats = computeStatistics(physSamples);
    console.log(`${ANSI.green}Done${ANSI.reset} (p50: ${physStats.p50_ms.toFixed(2)}ms, p95: ${physStats.p95_ms.toFixed(2)}ms, max: ${physStats.max_ms.toFixed(2)}ms)`);

    // --- Mode B: Full Ticks with Telemetry ---
    process.stdout.write(`    -> Measuring ${MEASURED_TICKS} Full Ticks with Telemetry (tickSimulation(true))... `);
    const { manager: telMgr, setupDurationMs: telSetupMs } = createTierInstance(tier, BENCHMARK_SEED, demBuffer);

    // Warm-up on instance
    for (let w = 0; w < WARMUP_TICKS; w++) {
      telMgr.tickSimulation(true);
    }

    const telSamples: number[] = new Array(MEASURED_TICKS);
    for (let i = 0; i < MEASURED_TICKS; i++) {
      const t0 = performance.now();
      telMgr.tickSimulation(true);
      const t1 = performance.now();
      telSamples[i] = t1 - t0;
    }
    const telStats = computeStatistics(telSamples);
    console.log(`${ANSI.green}Done${ANSI.reset} (p50: ${telStats.p50_ms.toFixed(2)}ms, p95: ${telStats.p95_ms.toFixed(2)}ms, max: ${telStats.max_ms.toFixed(2)}ms)`);

    tierResults.push({
      node_count: tier,
      setup_duration_ms: Math.round(physSetupMs + telSetupMs),
      physics_only: {
        stats: physStats,
        raw_samples_ms: physSamples.map(v => Number(v.toFixed(4))),
      },
      full_tick_with_telemetry: {
        stats: telStats,
        raw_samples_ms: telSamples.map(v => Number(v.toFixed(4))),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Summary Tables
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(96));
  console.log(`${ANSI.bold}   SUMMARY BENCHMARK RESULTS (20 ms Real-Time Budget per 50 Hz Frame)${ANSI.reset}`);
  console.log('='.repeat(96));

  console.log(`\n${ANSI.bold}--- MODE A: PHYSICS-ONLY TICKS (Simulation Logic, Link Budget, Queues, Schedulers) ---${ANSI.reset}`);
  console.log('┌───────┬─────────┬───────────┬───────────┬───────────┬───────────┬───────────┬──────────────┬─────────────┐');
  console.log('│ Nodes │ Samples │   Mean    │  StdDev   │    Min    │ Median p50│    p95    │     Max      │ >20ms Over  │');
  console.log('├───────┼─────────┼───────────┼───────────┼───────────┼───────────┼───────────┼──────────────┼─────────────┤');
  for (const r of tierResults) {
    const s = r.physics_only.stats;
    const overStr = s.pct_exceeding_20ms > 0
      ? `${ANSI.red}${s.pct_exceeding_20ms.toFixed(1)}% (${s.ticks_exceeding_20ms})${ANSI.reset}`
      : `${ANSI.green}0.0% (0)${ANSI.reset}`;
    console.log(
      `│  ${String(r.node_count).padStart(3, ' ')}  │   ${String(s.count).padStart(3, ' ')}   │ ${formatLatency(s.mean_ms)} │ ${formatLatency(s.std_dev_ms)} │ ${formatLatency(s.min_ms)} │ ${formatLatency(s.p50_ms)} │ ${formatLatency(s.p95_ms)} │  ${formatLatency(s.max_ms)}  │ ${overStr.padEnd(20, ' ')}│`
    );
  }
  console.log('└───────┴─────────┴───────────┴───────────┴───────────┴───────────┴───────────┴──────────────┴─────────────┘');

  console.log(`\n${ANSI.bold}--- MODE B: FULL TICKS (Physics + Telemetry Serialization & Profile Slices) ---${ANSI.reset}`);
  console.log('┌───────┬─────────┬───────────┬───────────┬───────────┬───────────┬───────────┬──────────────┬─────────────┐');
  console.log('│ Nodes │ Samples │   Mean    │  StdDev   │    Min    │ Median p50│    p95    │     Max      │ >20ms Over  │');
  console.log('├───────┼─────────┼───────────┼───────────┼───────────┼───────────┼───────────┼──────────────┼─────────────┤');
  for (const r of tierResults) {
    const s = r.full_tick_with_telemetry.stats;
    const overStr = s.pct_exceeding_20ms > 0
      ? `${ANSI.red}${s.pct_exceeding_20ms.toFixed(1)}% (${s.ticks_exceeding_20ms})${ANSI.reset}`
      : `${ANSI.green}0.0% (0)${ANSI.reset}`;
    console.log(
      `│  ${String(r.node_count).padStart(3, ' ')}  │   ${String(s.count).padStart(3, ' ')}   │ ${formatLatency(s.mean_ms)} │ ${formatLatency(s.std_dev_ms)} │ ${formatLatency(s.min_ms)} │ ${formatLatency(s.p50_ms)} │ ${formatLatency(s.p95_ms)} │  ${formatLatency(s.max_ms)}  │ ${overStr.padEnd(20, ' ')}│`
    );
  }
  console.log('└───────┴─────────┴───────────┴───────────┴───────────┴───────────┴───────────┴──────────────┴─────────────┘');

  // ---------------------------------------------------------------------------
  // Machine-Readable JSON Export
  // ---------------------------------------------------------------------------
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = resolve(OUTPUT_DIR, `benchmark-scale-nodes-${timestamp}.json`);
  const latestPath = resolve(OUTPUT_DIR, 'benchmark-scale-nodes-latest.json');

  const payload = {
    schema_version: '1.0.0',
    generated_at_utc: new Date().toISOString(),
    provenance,
    methodology: {
      measured_ticks_per_tier: MEASURED_TICKS,
      per_instance_warmup_ticks: WARMUP_TICKS,
      jit_warmup_ticks: JIT_WARMUP_TICKS,
      real_time_budget_ms: 20.0,
      discrete_dt_s: 0.020,
      rf_carrier_frequency_ghz: 9.6,
      rf_channel_bandwidth_mhz: 1.0,
      node_placement: 'canonical_16_plus_deterministic_m1b_grid',
      node_agl_m: 2.0,
      seed: BENCHMARK_SEED,
    },
    tiers: tierResults,
  };

  writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
  writeFileSync(latestPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`\n[+] Machine-readable benchmark report saved to:`);
  console.log(`    ${reportPath}`);
  console.log(`    ${latestPath}\n`);
}

runBenchmark().catch((err) => {
  console.error('[!] Fatal benchmark failure:', err);
  process.exit(1);
});
