/**
 * Headless paired-scheduler benchmark for the current TypeScript engine.
 * Example: npx vite-node scripts/run_ts_benchmark.ts --frames 500 --seeds 1,2,3
 * Uses synthetic terrain for reproducibility; it does not validate the real DEM path.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SimulationWorkerManager } from '../src/worker/simWorker';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
function parsePositiveInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

const frames = parsePositiveInt(argValue('--frames', '500'), '--frames');
const seeds = argValue('--seeds', '1,2,3,4,5').split(',').map(s => parsePositiveInt(s.trim(), '--seeds entry'));
const outputDir = resolve(argValue('--out', 'benchmark_results/generated'));
const rows: Array<Record<string, number | string>> = [];

for (const seed of seeds) {
  const started = performance.now();
  const manager = new SimulationWorkerManager(seed * 100_000);
  manager.terrainEngine.setTerrainMode('synthetic');
  manager.isPaused = true;
  for (let i = 0; i < frames; i++) manager.tickSimulation();
  const elapsedMs = performance.now() - started;
  const simDurationS = manager.simTimeS;
  const m = manager.metrics;
  rows.push({
    schema_version: '1.1', engine: 'typescript_webworker', terrain_mode: manager.terrainEngine.terrain_mode,
    seed, frames_requested: frames, frames_completed: manager.frameIndex,
    sim_duration_s: Number(simDurationS.toFixed(6)), wall_runtime_ms: Number(elapsedMs.toFixed(3)),
    static_goodput_bits: Math.round(m.staticGoodputBits), tac_goodput_bits: Math.round(m.tacGoodputBits),
    static_goodput_mbps_avg: Number((m.staticGoodputBits / simDurationS / 1e6).toFixed(6)),
    tac_goodput_mbps_avg: Number((m.tacGoodputBits / simDurationS / 1e6).toFixed(6)),
    goodput_ratio_tac_over_static: Number((m.tacGoodputBits / Math.max(1, m.staticGoodputBits)).toFixed(6)),
    static_dropped_packets_final: m.staticDroppedPkts, tac_dropped_packets_final: m.tacDroppedPkts,
    static_delay_drops_observed: m.staticDelayDropsThisRun,
    tac_delay_drops_observed: m.tacDelayDropsThisRun,
    static_overflow_drops_observed: m.staticOverflowDropsThisRun,
    tac_overflow_drops_observed: m.tacOverflowDropsThisRun,
    static_payload_bits_dequeued: Math.round(m.staticPayloadBitsDequeued),
    tac_payload_bits_dequeued: Math.round(m.tacPayloadBitsDequeued),
    static_wasted_bits_on_outage: Math.round(m.staticWastedBits),
    tac_wasted_bits_on_outage: Math.round(m.tacWastedBits),
    static_scheduled_ul_time_s: Number(m.staticScheduledUlTimeS.toFixed(9)),
    tac_scheduled_ul_time_s: Number(m.tacScheduledUlTimeS.toFixed(9)),
    static_available_ul_time_s: Number(m.staticAvailableUlTimeS.toFixed(9)),
    tac_available_ul_time_s: Number(m.tacAvailableUlTimeS.toFixed(9)),
    static_unused_ul_time_s: Number(m.staticUnusedUlTimeS.toFixed(9)),
    tac_unused_ul_time_s: Number(m.tacUnusedUlTimeS.toFixed(9)),
    static_run_ul_utilization_pct: Number((100 * m.staticScheduledUlTimeS / Math.max(m.staticAvailableUlTimeS, 1e-12)).toFixed(6)),
    tac_run_ul_utilization_pct: Number((100 * m.tacScheduledUlTimeS / Math.max(m.tacAvailableUlTimeS, 1e-12)).toFixed(6)),
    static_final_frame_ul_utilization_pct: Number(m.lastStaticUtilPct.toFixed(6)),
    tac_final_frame_ul_utilization_pct: Number(m.lastTacUtilPct.toFixed(6)),
    static_final_backlog_bits: Math.round(m.staticFinalBacklogBits),
    tac_final_backlog_bits: Math.round(m.tacFinalBacklogBits),
  });
  console.log(`seed=${seed} frames=${manager.frameIndex}/${frames} Tac-TAD/static goodput ratio=${rows[rows.length - 1].goodput_ratio_tac_over_static}`);
}
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
  schema_version: '1.1', generated_at_utc: new Date().toISOString(), engine: 'TypeScript WebWorker engine',
  methodology: 'Paired side-by-side schedulers; fresh manager per seed; synthetic terrain; fixed frames per run. Goodput is payload dequeued while the scheduler reports a usable link. Airtime utilization is scheduled airtime including guard intervals divided by available uplink airtime.',
  metric_definitions: {
    goodput_bits: 'Sum of actual packet payload bits dequeued on usable links; not slot capacity and not an independent end-to-end receiver/ACK measurement.',
    payload_bits_dequeued: 'Actual packet payload bits removed from queues, including payload removed during a reported outage.',
    wasted_bits_on_outage: 'Payload bits removed from a queue while the corresponding link/predictive state is in outage. Tac-TAD filters unusable links before dequeue, so zero is expected by design.',
    dropped_packets_final: 'Cumulative delay plus overflow drop counters at the end of the run.',
    drops_observed: 'Sum of per-frame non-negative deltas in cumulative delay/overflow drop counters.',
    scheduled_ul_time_s: 'Sum of slot duration plus guard interval for all scheduled allocations.',
    unused_ul_time_s: 'Available uplink airtime minus scheduled airtime, clamped at zero.',
    run_ul_utilization_pct: 'Total scheduled uplink airtime divided by total available uplink airtime across the run.',
    final_backlog_bits: 'Queued payload bits remaining after the final simulated frame.',
  },
  limitations: [
    'This benchmark does not establish parity with the legacy Python engine.',
    'Synthetic terrain is forced; real DEM loading and provenance are not evaluated.',
    'Goodput is a scheduler-level model metric, not independently verified receiver delivery or ACK completion.',
    'Outage waste measures payload dequeued during outage, not RF energy or all forms of unused capacity.',
    'Scheduler comparisons are paired within each run; seed offset is the varied input.',
  ],
  configuration: { frames_per_run: frames, seeds, terrain_mode: 'synthetic' }, runs: rows,
}, null, 2));
writeFileSync(csvPath, `${fields.join(',')}\n${rows.map(row => fields.map(f => csvCell(row[f])).join(',')).join('\n')}\n`);
console.log(`\nWrote ${rows.length} runs:\n  ${jsonPath}\n  ${csvPath}`);
