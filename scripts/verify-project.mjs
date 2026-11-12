import { readFileSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/worker/simWorker.ts', import.meta.url), 'utf8');
const requiredFiles = [
  '../src/core/config.ts', '../src/core/terrain.ts', '../src/core/linkBudget.ts',
  '../src/core/trajectory.ts', '../src/core/queues.ts', '../src/core/scheduler.ts',
  '../src/tests/verifyPhysics.ts', '../src/tests/verifyScheduler.ts', '../src/tests/verifyWorkerState.ts',
  '../benchmark_results/BENCHMARK_DOSSIER.md', '../benchmark_results/summary_metrics.csv', '../METRICS_PATCH_NOTES.md',
];

const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, status: 'PASS' }); }
  catch (error) { checks.push({ name, status: 'FAIL', detail: error.message }); }
}

check('Required TypeScript, verification, and benchmark artifacts exist', () => {
  for (const file of requiredFiles) assert.ok(existsSync(new URL(file, import.meta.url)), `Missing ${file}`);
});
check('All five detail workspaces remain present', () => {
  for (const id of ['tab-overview', 'tab-scheduler', 'tab-terrain', 'tab-terminal', 'tab-doc']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `Missing ${id}`);
  }
});
check('Persistent map mount and resize separator are wired', () => {
  assert.match(html, /id="persistent-map-mount"/);
  assert.match(html, /id="map-resize-handle"/);
  assert.match(html, /appendChild\(radarStage\)/);
  assert.match(html, /xband-map-width-pct/);
});
check('Map renderer continues while detail navigation changes', () => {
  assert.match(html, /drawRadar\(\);/);
  assert.match(html, /function drawRadar\(\)/);
  assert.match(html, /requestAnimationFrame\(animationLoop\)/);
});
check('Simulation remains worker-backed and telemetry-driven', () => {
  assert.match(html, /new Worker\(new URL\("\.\/src\/worker\/simWorker\.ts", import\.meta\.url\)/);
  assert.match(html, /msg\.type === 'TELEMETRY_FRAME'/);
  assert.match(worker, /postMessage\(/);
});
check('Research report distinguishes historical results from current-engine validation', () => {
  assert.match(html, /Historical benchmark results \(legacy Python engine\)/);
  assert.match(html, /not a verified statement about the current TypeScript engine/);
  assert.match(html, /Python ↔ TypeScript parity/);
  assert.match(html, /Data-quality flag/);
});
check('Terminal search is wired to the populated terminal selector', () => {
  assert.match(html, /id="terminal-search"/);
  assert.match(html, /window\.filterTerminalOptions = function\(query\)/);
  assert.match(html, /option\.hidden = !match/);
  assert.match(html, /terminal-search-status/);
});
check('Scheduler allocation inspector uses current worker-frame allocations', () => {
  assert.match(html, /id="allocation-inspector"/);
  assert.match(html, /frame\.active_gantt_allocations/);
  assert.match(html, /selectedAllocations\.reduce/);
  assert.match(html, /per-frame airtime/);
});


check('Detail tabs stack live context above their analytical workspace', () => {
  assert.match(html, /\.tab-content\.active\{display:flex;flex-direction:column\}/);
  assert.match(html, /\.analysis-context\{flex:none;display:flex;/);
});

check('Detailed analysis workspaces use responsive layouts', () => {
  assert.match(html, /\.cols\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(300px,1fr\)\)/);
  assert.match(html, /@media\(max-width:860px\)/);
  assert.match(html, /\.main-viewport\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html, /\.fresnel-canvas-box\{height:clamp\(/);
});

check('Scheduler percentiles are worker-authoritative', () => {
  assert.match(html, /frame\.static_p50_bps/);
  assert.match(html, /frame\.tac_p50_bps/);
  assert.match(html, /rolling_window_sample_count/);
  assert.match(html, /nearest-rank/);
  assert.doesNotMatch(html, /validTacDeltas/);
  assert.doesNotMatch(html, /Mbit\/frame/);
});

check('Comparison table distinguishes unavailable telemetry from confirmed zero', () => {
  assert.match(html, /const UNAVAILABLE = '—'/);
  assert.match(html, /function setMetricText/);
  assert.match(html, /dataset\.telemetryState = 'unavailable'/);
  assert.match(html, /static_utilization_pct/);
  assert.match(html, /tac_utilization_pct/);
  assert.match(html, /static_selected_backlog_kb/);
  assert.match(html, /KiB/);
});

check('Stage 12 reduces horizontal overflow in analytical panels', () => {
  assert.match(html, /\.table-scroll\{overflow-x:auto\}/);
  assert.match(html, /\.data-table\{width:100%;border-collapse:collapse;font-size:12px;min-width:480px\}/);
  assert.match(html, /\.traffic-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html, /Static TDMA schedules every available slot/);
});

check('Simulation reset clears scheduler adaptation and run-local state', () => {
  assert.match(worker, /public resetSimulationState\(\): void/);
  assert.match(worker, /this\.staticScheduler = new LegacyStaticScheduler\(\)/);
  assert.match(worker, /this\.tacScheduler = new TerrainAwareDynamicScheduler\(0\.008\)/);
  assert.match(worker, /this\.node4Frozen = false/);
  assert.match(worker, /this\.lastReportStatic = null/);
  assert.match(worker, /this\.lastReportTac = null/);
  assert.equal((worker.match(/this\.resetSimulationState\(\);/g) || []).length, 2,
    'Both UI reset pathways should use the same reset implementation');
});

check('Experiment capture exports raw telemetry with provenance metadata', () => {
  assert.match(html, /id="experiment-start"/);
  assert.match(html, /function experimentObserve\(frame\)/);
  assert.match(html, /function experimentExportCsv\(\)/);
  assert.match(html, /function experimentExportJson\(\)/);
  assert.match(html, /seed: 'unavailable in current telemetry'/);
  assert.match(html, /not guaranteed complete per-frame instrumentation/);
  assert.match(html, /experimentObserve\(frame\);/);
});

check('Headless TypeScript benchmark runner records provenance and raw outputs', () => {
  const runner = readFileSync(new URL('../scripts/run_ts_benchmark.ts', import.meta.url), 'utf8');
  assert.match(runner, /new SimulationWorkerManager\(seed \* 100_000\)/);
  assert.match(runner, /setTerrainMode\('synthetic'\)/);
  assert.match(runner, /frames_completed/);
  assert.match(runner, /writeFileSync\(jsonPath/);
  assert.match(runner, /writeFileSync\(csvPath/);
  assert.match(worker, /typeof document === 'undefined'/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts?.['benchmark:ts'] ?? '', /vite-node/);
});


check('Scheduler reports symmetric airtime, payload, backlog, and drop-delta metrics', () => {
  const scheduler = readFileSync(new URL('../src/core/scheduler.ts', import.meta.url), 'utf8');
  assert.match(scheduler, /totalUlScheduledS/);
  assert.match(scheduler, /totalUlAvailableS/);
  assert.match(scheduler, /totalUlUnusedS/);
  assert.match(scheduler, /totalPayloadBitsDequeued/);
  assert.match(scheduler, /packetsDroppedDelayThisFrame/);
  assert.match(scheduler, /packetsDroppedOverflowThisFrame/);
  assert.match(scheduler, /collectDropMetrics\(nodes, this\.previousDropCounts\)/);
  assert.match(scheduler, /ls\.isOutage\)\)\s*\)\s*\{\s*continue/);
  assert.doesNotMatch(scheduler, /totalBitsWastedOnOutage: 0, \/\/ 0\.0% severed-link waste/);
  const runner = readFileSync(new URL('../scripts/run_ts_benchmark.ts', import.meta.url), 'utf8');
  assert.match(runner, /static_unused_ul_time_s/);
  assert.match(runner, /tac_unused_ul_time_s/);
  assert.match(runner, /static_delay_drops_observed/);
  assert.match(runner, /tac_final_backlog_bits/);
  assert.match(runner, /metric_definitions/);
});

check('Worker accumulates comparable run-level airtime and payload metrics', () => {
  assert.match(worker, /staticScheduledUlTimeS \+= reportStatic\.totalUlScheduledS/);
  assert.match(worker, /tacScheduledUlTimeS \+= reportTac\.totalUlScheduledS/);
  assert.match(worker, /staticPayloadBitsDequeued \+= reportStatic\.totalPayloadBitsDequeued/);
  assert.match(worker, /tacPayloadBitsDequeued \+= reportTac\.totalPayloadBitsDequeued/);
  assert.match(worker, /staticDelayDropsThisRun \+= reportStatic\.packetsDroppedDelayThisFrame/);
  assert.match(worker, /tacOverflowDropsThisRun \+= reportTac\.packetsDroppedOverflowThisFrame/);
});

check('Current package has build and test commands', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.scripts?.build, 'Missing build script');
  assert.ok(pkg.scripts?.test, 'Missing test script');
  assert.ok(!pkg.scripts.test.includes('no test specified'), 'Placeholder test command remains');
});

check('Simulation timeline infrastructure provides observational epoch clock and batch spatial staging', () => {
  assert.match(worker, /batchSpatialSnapshots/);
  assert.match(worker, /tdmaSimTimeS/);
  assert.match(worker, /superframeEpochIndex/);
  assert.match(worker, /completed_superframes/);
  const protocol = readFileSync(new URL('../src/shared/workerProtocol.ts', import.meta.url), 'utf8');
  assert.match(protocol, /SpatialFrameSnapshot/);
  assert.match(protocol, /TimelineCommunicationRecord/);
});

for (const item of checks) {
  console.log(`${item.status.padEnd(4)} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
}
const failed = checks.filter(x => x.status === 'FAIL').length;
console.log(`\nStructural verification: ${checks.length - failed}/${checks.length} checks passed.`);
if (failed) process.exitCode = 1;
