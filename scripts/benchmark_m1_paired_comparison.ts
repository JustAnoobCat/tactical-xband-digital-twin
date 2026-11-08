#!/usr/bin/env node
/**
 * scripts/benchmark_m1_paired_comparison.ts
 *
 * DRDO Tactical X-Band Air-to-Ground Digital Twin
 * Milestone M1: Predictive Lookahead Decoupling Paired Benchmark
 *
 * Rigorously executes paired trials comparing:
 *   1. 50 Hz Reference Engine (lookaheadIntervalFrames = 1)
 *   2. 10 Hz Decoupled Candidate (lookaheadIntervalFrames = 5)
 *
 * Profiles across all 4 population tiers (16, 32, 64, 128 nodes) over 3 seeds [42, 101, 202]
 * with authentic Ladakh DEM (512x512 Float32) and reports:
 *   - Mean, P50, P95, P99, Max physics tick latency
 *   - Percentage of frames exceeding 20 ms deadline
 *   - Maximum consecutive deadline misses
 *   - Lookahead raycast invocations per tick
 *   - Workload reduction factor (raycast and latency speedups)
 *   - Tactical goodput (bits) and packet drop equivalence
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';

import { SimulationWorkerManager } from '../src/worker/simWorker';
import { NodeLifecycleManager } from '../src/worker/nodeLifecycleManager';

function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const TICKS_PER_TRIAL = Math.max(50, parseInt(getArg('--ticks', '100'), 10));
const WARMUP_TICKS = Math.max(0, parseInt(getArg('--warmup', '10'), 10));
const POPULATION_TIERS = [16, 32, 64, 128];
const TRIALS_SEEDS = [42, 101, 202];
const OUTPUT_DIR = resolve(process.cwd(), getArg('--out-dir', 'benchmark_results/generated'));
const REAL_DEM_PATH = resolve(process.cwd(), 'public/terrain/real_ladakh_dem.bin');

interface TierRunStats {
  samplesPhysicsMs: number[];
  samplesLookaheadMs: number[];
  samplesCurrentObsMs: number[];
  samplesLookaheadRaycasts: number[];
  samplesCurrentObsRaycasts: number[];
  samplesTotalRaycasts: number[];
  tacGoodputBits: number;
  tacDroppedPkts: number;
}

interface StatMetrics {
  mean_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  min_ms: number;
  std_dev_ms: number;
  deadline_misses: number;
  deadline_miss_pct: number;
  max_consecutive_misses: number;
  avg_lookahead_raycasts: number;
  avg_total_raycasts: number;
  tac_goodput_bits: number;
  tac_dropped_pkts: number;
}

function computeMetrics(stats: TierRunStats): StatMetrics {
  const samples = stats.samplesPhysicsMs;
  const n = samples.length;
  if (n === 0) {
    return {
      mean_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0, max_ms: 0, min_ms: 0, std_dev_ms: 0,
      deadline_misses: 0, deadline_miss_pct: 0, max_consecutive_misses: 0,
      avg_lookahead_raycasts: 0, avg_total_raycasts: 0, tac_goodput_bits: 0, tac_dropped_pkts: 0,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  let varSum = 0;
  for (const v of sorted) varSum += (v - mean) * (v - mean);
  const stdDev = Math.sqrt(varSum / (n > 1 ? n - 1 : 1));

  let deadlineMisses = 0;
  let maxConsec = 0;
  let currentConsec = 0;
  for (const v of samples) {
    if (v > 20.0) {
      deadlineMisses++;
      currentConsec++;
      if (currentConsec > maxConsec) maxConsec = currentConsec;
    } else {
      currentConsec = 0;
    }
  }

  const lookaheadRaycastSum = stats.samplesLookaheadRaycasts.reduce((a, b) => a + b, 0);
  const totalRaycastSum = stats.samplesTotalRaycasts.reduce((a, b) => a + b, 0);

  const p50Idx = Math.min(n - 1, Math.floor(n * 0.50));
  const p95Idx = Math.min(n - 1, Math.floor(n * 0.95));
  const p99Idx = Math.min(n - 1, Math.floor(n * 0.99));

  return {
    mean_ms: Number(mean.toFixed(2)),
    p50_ms: Number(sorted[p50Idx].toFixed(2)),
    p95_ms: Number(sorted[p95Idx].toFixed(2)),
    p99_ms: Number(sorted[p99Idx].toFixed(2)),
    max_ms: Number(sorted[n - 1].toFixed(2)),
    min_ms: Number(sorted[0].toFixed(2)),
    std_dev_ms: Number(stdDev.toFixed(2)),
    deadline_misses: deadlineMisses,
    deadline_miss_pct: Number(((deadlineMisses / n) * 100).toFixed(1)),
    max_consecutive_misses: maxConsec,
    avg_lookahead_raycasts: Number((lookaheadRaycastSum / n).toFixed(1)),
    avg_total_raycasts: Number((totalRaycastSum / n).toFixed(1)),
    tac_goodput_bits: stats.tacGoodputBits,
    tac_dropped_pkts: stats.tacDroppedPkts,
  };
}

function createInstance(
  targetNodeCount: number,
  seed: number,
  demBuffer: Buffer,
  cadenceHz: number
): SimulationWorkerManager {
  const manager = new SimulationWorkerManager(seed * 100_000, '16_NODES');
  manager.setLookaheadCadence(cadenceHz);

  const demArray = new Float32Array(demBuffer.buffer, demBuffer.byteOffset, 512 * 512);
  const ok = manager.terrainEngine.loadCustomDem(demArray);
  if (!ok) throw new Error('Failed to load custom DEM');

  NodeLifecycleManager.resampleGroundNodeAltitudes(
    manager.nodesStatic,
    manager.nodesTac,
    manager.nodeRegistry,
    manager.terrainEngine
  );

  for (let i = 16; i < targetNodeCount; i++) {
    const res = manager.handleMessage({
      type: 'NODE_ADD',
      x_m: (i % 10) * 1000 - 5000,
      y_m: Math.floor(i / 10) * 1000 - 5000,
      agl_m: 2.0,
    });
    if (!res.accepted) throw new Error(`NODE_ADD failed for node ${i}: ${res.reason}`);
  }

  return manager;
}

class InstrumentedEngine {
  public lookaheadMs = 0;
  public lookaheadRaycasts = 0;
  public currentObsMs = 0;
  public currentObsRaycasts = 0;
  private insideLookahead = false;

  constructor(public readonly mgr: SimulationWorkerManager) {
    const origLookahead = mgr.lookaheadEngine.evaluatePredictiveState.bind(mgr.lookaheadEngine);
    mgr.lookaheadEngine.evaluatePredictiveState = (...args: any[]) => {
      this.insideLookahead = true;
      const t0 = performance.now();
      try {
        return (origLookahead as any)(...args);
      } finally {
        this.lookaheadMs += performance.now() - t0;
        this.insideLookahead = false;
      }
    };

    const origObs = mgr.terrainEngine.evaluateTerrainObstruction.bind(mgr.terrainEngine);
    mgr.terrainEngine.evaluateTerrainObstruction = (...args) => {
      const t0 = performance.now();
      const res = origObs(...args);
      const dt = performance.now() - t0;
      if (this.insideLookahead) {
        this.lookaheadRaycasts++;
      } else {
        this.currentObsMs += dt;
        this.currentObsRaycasts++;
      }
      return res;
    };
  }

  public resetFrame(): void {
    this.lookaheadMs = 0;
    this.lookaheadRaycasts = 0;
    this.currentObsMs = 0;
    this.currentObsRaycasts = 0;
    this.insideLookahead = false;
  }
}

async function run() {
  console.log('='.repeat(110));
  console.log('   DRDO X-BAND DIGITAL TWIN // M1 PREDICTIVE LOOKAHEAD PAIRED BENCHMARK');
  console.log('   50 Hz Reference Engine vs 10 Hz Decoupled Candidate (Ladakh DEM)');
  console.log('='.repeat(110));

  if (!existsSync(REAL_DEM_PATH)) throw new Error(`Missing DEM at ${REAL_DEM_PATH}`);
  const demBuffer = readFileSync(REAL_DEM_PATH);
  const demSha = createHash('sha256').update(demBuffer).digest('hex');

  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim().slice(0, 8);
  } catch (_) {}

  console.log(` Platform : ${process.platform} ${process.arch} | Node ${process.version} | Git: ${gitCommit}`);
  console.log(` Hardware : ${os.cpus().length}x ${os.cpus()[0]?.model} | RAM: ${(os.totalmem() / 1e9).toFixed(1)} GB`);
  console.log(` DEM SHA  : ${demSha}`);
  console.log(` Tiers    : [${POPULATION_TIERS.join(', ')}] nodes | Seeds: [${TRIALS_SEEDS.join(', ')}] | ${TICKS_PER_TRIAL} ticks/trial`);
  console.log('-'.repeat(110));

  const comparisonResults: Array<{
    node_count: number;
    reference_50hz: StatMetrics;
    candidate_10hz: StatMetrics;
    workload_reduction_ratio: number;
    latency_reduction_pct: number;
    goodput_delta_pct: number;
    packet_drop_delta: number;
  }> = [];

  for (const tier of POPULATION_TIERS) {
    console.log(`\n[*] Profiling Tier: ${tier} Nodes across ${TRIALS_SEEDS.length} seeds (${TICKS_PER_TRIAL} ticks each)...`);

    // 1. Reference Run (50 Hz lookahead)
    const refStats: TierRunStats = {
      samplesPhysicsMs: [],
      samplesLookaheadMs: [],
      samplesCurrentObsMs: [],
      samplesLookaheadRaycasts: [],
      samplesCurrentObsRaycasts: [],
      samplesTotalRaycasts: [],
      tacGoodputBits: 0,
      tacDroppedPkts: 0,
    };

    for (const seed of TRIALS_SEEDS) {
      const mgr = createInstance(tier, seed, demBuffer, 50);
      const instrumented = new InstrumentedEngine(mgr);

      for (let w = 0; w < WARMUP_TICKS; w++) {
        mgr.tickSimulation(false);
      }

      for (let f = 0; f < TICKS_PER_TRIAL; f++) {
        instrumented.resetFrame();
        const t0 = performance.now();
        mgr.tickSimulation(false);
        const tickMs = performance.now() - t0;

        refStats.samplesPhysicsMs.push(tickMs);
        refStats.samplesLookaheadMs.push(instrumented.lookaheadMs);
        refStats.samplesCurrentObsMs.push(instrumented.currentObsMs);
        refStats.samplesLookaheadRaycasts.push(instrumented.lookaheadRaycasts);
        refStats.samplesCurrentObsRaycasts.push(instrumented.currentObsRaycasts);
        refStats.samplesTotalRaycasts.push(instrumented.lookaheadRaycasts + instrumented.currentObsRaycasts);
      }
      refStats.tacGoodputBits += mgr.metrics.tacGoodputBits;
      refStats.tacDroppedPkts += mgr.metrics.tacDroppedPkts;
    }

    const refMetrics = computeMetrics(refStats);

    // 2. Candidate Run (10 Hz lookahead)
    const candStats: TierRunStats = {
      samplesPhysicsMs: [],
      samplesLookaheadMs: [],
      samplesCurrentObsMs: [],
      samplesLookaheadRaycasts: [],
      samplesCurrentObsRaycasts: [],
      samplesTotalRaycasts: [],
      tacGoodputBits: 0,
      tacDroppedPkts: 0,
    };

    for (const seed of TRIALS_SEEDS) {
      const mgr = createInstance(tier, seed, demBuffer, 10);
      const instrumented = new InstrumentedEngine(mgr);

      for (let w = 0; w < WARMUP_TICKS; w++) {
        mgr.tickSimulation(false);
      }

      for (let f = 0; f < TICKS_PER_TRIAL; f++) {
        instrumented.resetFrame();
        const t0 = performance.now();
        mgr.tickSimulation(false);
        const tickMs = performance.now() - t0;

        candStats.samplesPhysicsMs.push(tickMs);
        candStats.samplesLookaheadMs.push(instrumented.lookaheadMs);
        candStats.samplesCurrentObsMs.push(instrumented.currentObsMs);
        candStats.samplesLookaheadRaycasts.push(instrumented.lookaheadRaycasts);
        candStats.samplesCurrentObsRaycasts.push(instrumented.currentObsRaycasts);
        candStats.samplesTotalRaycasts.push(instrumented.lookaheadRaycasts + instrumented.currentObsRaycasts);
      }
      candStats.tacGoodputBits += mgr.metrics.tacGoodputBits;
      candStats.tacDroppedPkts += mgr.metrics.tacDroppedPkts;
    }

    const candMetrics = computeMetrics(candStats);

    const workloadReduction = Number((refMetrics.avg_lookahead_raycasts / Math.max(1, candMetrics.avg_lookahead_raycasts)).toFixed(2));
    const latencyReduction = Number((((refMetrics.mean_ms - candMetrics.mean_ms) / refMetrics.mean_ms) * 100).toFixed(1));
    const goodputDeltaPct = Number((((candMetrics.tac_goodput_bits - refMetrics.tac_goodput_bits) / Math.max(1, refMetrics.tac_goodput_bits)) * 100).toFixed(4));
    const dropDelta = candMetrics.tac_dropped_pkts - refMetrics.tac_dropped_pkts;

    console.log(`  Reference (50 Hz): Mean=${refMetrics.mean_ms}ms, P50=${refMetrics.p50_ms}ms, P95=${refMetrics.p95_ms}ms, P99=${refMetrics.p99_ms}ms, Max=${refMetrics.max_ms}ms | >20ms: ${refMetrics.deadline_miss_pct}% (max consec: ${refMetrics.max_consecutive_misses}) | Raycasts: ${refMetrics.avg_lookahead_raycasts} lookahead/tick`);
    console.log(`  Candidate (10 Hz): Mean=${candMetrics.mean_ms}ms, P50=${candMetrics.p50_ms}ms, P95=${candMetrics.p95_ms}ms, P99=${candMetrics.p99_ms}ms, Max=${candMetrics.max_ms}ms | >20ms: ${candMetrics.deadline_miss_pct}% (max consec: ${candMetrics.max_consecutive_misses}) | Raycasts: ${candMetrics.avg_lookahead_raycasts} lookahead/tick`);
    console.log(`  Workload Reduction: ${workloadReduction}x fewer lookahead raycasts | Mean Latency Reduction: ${latencyReduction}% | Goodput Delta: ${goodputDeltaPct}% | Drop Delta: ${dropDelta} pkts`);

    comparisonResults.push({
      node_count: tier,
      reference_50hz: refMetrics,
      candidate_10hz: candMetrics,
      workload_reduction_ratio: workloadReduction,
      latency_reduction_pct: latencyReduction,
      goodput_delta_pct: goodputDeltaPct,
      packet_drop_delta: dropDelta,
    });
  }

  // ---------------------------------------------------------------------------
  // Comparative Summary Tables
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(120));
  console.log('   TABLE 1: PHYSICS TICK LATENCY & REAL-TIME DEADLINE AUDIT (300 TICKS/TIER)');
  console.log('='.repeat(120));
  console.log('┌───────┬──────────────────────────────────────────────┬──────────────────────────────────────────────┬──────────────┐');
  console.log('│       │             50 Hz Reference Engine           │           10 Hz Decoupled Candidate          │  Reduction   │');
  console.log('│ Nodes ├─────────┬─────────┬─────────┬────────┬───────┼─────────┬─────────┬─────────┬────────┬───────┼──────────────┤');
  console.log('│       │ Mean    │ P50     │ P95     │ P99    │ >20ms │ Mean    │ P50     │ P95     │ P99    │ >20ms │ Mean Speedup │');
  console.log('├───────┼─────────┼─────────┼─────────┼────────┼───────┼─────────┼─────────┼─────────┼────────┼───────┼──────────────┤');
  for (const r of comparisonResults) {
    const ref = r.reference_50hz;
    const cand = r.candidate_10hz;
    console.log(
      `│  ${r.node_count.toString().padEnd(4, ' ')} │` +
      ` ${ref.mean_ms.toFixed(2).padStart(6, ' ')}ms │` +
      ` ${ref.p50_ms.toFixed(2).padStart(6, ' ')}ms │` +
      ` ${ref.p95_ms.toFixed(2).padStart(6, ' ')}ms │` +
      ` ${ref.p99_ms.toFixed(2).padStart(5, ' ')}ms│` +
      ` ${ref.deadline_miss_pct.toFixed(1).padStart(4, ' ')}% │` +
      ` ${cand.mean_ms.toFixed(2).padStart(6, ' ')}ms │` +
      ` ${cand.p50_ms.toFixed(2).padStart(6, ' ')}ms │` +
      ` ${cand.p95_ms.toFixed(2).padStart(6, ' ')}ms │` +
      ` ${cand.p99_ms.toFixed(2).padStart(5, ' ')}ms│` +
      ` ${cand.deadline_miss_pct.toFixed(1).padStart(4, ' ')}% │` +
      `    ${r.latency_reduction_pct.toFixed(1).padStart(5, ' ')}%    │`
    );
  }
  console.log('└───────┴─────────┴─────────┴─────────┴────────┴───────┴─────────┴─────────┴─────────┴────────┴───────┴──────────────┘');

  console.log('\n' + '='.repeat(120));
  console.log('   TABLE 2: COMPUTATIONAL RAYCAST WORKLOAD & TACTICAL CONSERVATION AUDIT');
  console.log('='.repeat(120));
  console.log('┌───────┬────────────────────────────┬────────────────────────────┬──────────────┬────────────────────────────┐');
  console.log('│       │  Lookahead Raycasts/Tick   │    Total Raycasts/Tick     │ Raycast Load │    Tactical Equivalence    │');
  console.log('│ Nodes ├──────────────┬─────────────┼──────────────┬─────────────┤  Reduction   ├─────────────┬──────────────┤');
  console.log('│       │ 50 Hz Ref    │ 10 Hz Cand  │ 50 Hz Ref    │ 10 Hz Cand  │    Factor    │ Goodput Δ % │ Drop Delta   │');
  console.log('├───────┼──────────────┼─────────────┼──────────────┼─────────────┼──────────────┼─────────────┼──────────────┤');
  for (const r of comparisonResults) {
    const ref = r.reference_50hz;
    const cand = r.candidate_10hz;
    console.log(
      `│  ${r.node_count.toString().padEnd(4, ' ')} │` +
      `  ${ref.avg_lookahead_raycasts.toFixed(1).padStart(8, ' ')}    │` +
      `  ${cand.avg_lookahead_raycasts.toFixed(1).padStart(8, ' ')}   │` +
      `  ${ref.avg_total_raycasts.toFixed(1).padStart(8, ' ')}    │` +
      `  ${cand.avg_total_raycasts.toFixed(1).padStart(8, ' ')}   │` +
      `    ${r.workload_reduction_ratio.toFixed(2).padStart(5, ' ')}x    │` +
      `  ${r.goodput_delta_pct.toFixed(4).padStart(8, ' ')}% │` +
      `   ${r.packet_drop_delta.toString().padStart(6, ' ')} pkts │`
    );
  }
  console.log('└───────┴──────────────┴─────────────┴──────────────┴─────────────┴──────────────┴─────────────┴──────────────┘');

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = resolve(OUTPUT_DIR, `benchmark-m1-paired-comparison-${stamp}.json`);
  const latestPath = resolve(OUTPUT_DIR, 'benchmark-m1-paired-comparison-latest.json');

  const payload = {
    schema_version: '1.0.0',
    generated_at_utc: new Date().toISOString(),
    git_commit: gitCommit,
    dem_sha256: demSha,
    hardware: {
      platform: process.platform,
      arch: process.arch,
      cpu_model: os.cpus()[0]?.model,
      cpu_count: os.cpus().length,
      ram_gb: Number((os.totalmem() / 1e9).toFixed(1)),
    },
    configuration: {
      ticks_per_trial: TICKS_PER_TRIAL,
      warmup_ticks: WARMUP_TICKS,
      tiers: POPULATION_TIERS,
      trials_seeds: TRIALS_SEEDS,
      real_time_deadline_ms: 20.0,
    },
    results: comparisonResults,
  };

  writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
  writeFileSync(latestPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`\n[+] Machine-readable paired report saved to:`);
  console.log(`    ${reportPath}`);
  console.log(`    ${latestPath}\n`);
}

run().catch((err) => {
  console.error('[!] Fatal error in paired benchmark:', err);
  process.exit(1);
});
