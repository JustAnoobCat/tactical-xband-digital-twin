/**
 * =================================================================================================
 * PUBLICATION ECDF DELAY SCOPE & IEEE LATEX BENCHMARK VERIFICATION SUITE
 * Specification: SPEC-PUBLICATION-ECDF-AND-LATEX-BENCHMARK-EXPORT
 * Tests: PEL-T1 through PEL-T4
 * =================================================================================================
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SimulationWorkerManager } from '../worker/simWorker';
import { formatBenchmarkLatexTable } from '../../scripts/run_ts_benchmark';

console.log('='.repeat(96));
console.log('   PUBLICATION ECDF DELAY SCOPE & IEEE LATEX BENCHMARK VERIFICATION SUITE');
console.log('   Specification: SPEC-PUBLICATION-ECDF-AND-LATEX-BENCHMARK-EXPORT // PEL-T1 - PEL-T4');
console.log('='.repeat(96));

// =================================================================================================
// [PEL-T1] Specification Document Persistence Check (DEF-01 Resolution)
// =================================================================================================
console.log('\n[PEL-T1] Verifying Specification Document Persistence on Disk...');
{
  const specViewshedPath = resolve(process.cwd(), 'docs/specs/SPEC-REALTIME-RF-VIEWSHED-AND-RELAY-ADVISOR.md');
  const specEcdfPath = resolve(process.cwd(), 'docs/specs/SPEC-PUBLICATION-ECDF-AND-LATEX-BENCHMARK-EXPORT.md');
  const specKargilPath = resolve(process.cwd(), 'docs/specs/SPEC-KARGIL-RIDGE-TRANSIT-AND-TACTAD-ADVANTAGE.md');
  const readmePath = resolve(process.cwd(), 'README.md');

  assert.ok(existsSync(specViewshedPath), `Viewshed specification must exist at ${specViewshedPath}`);
  assert.ok(existsSync(specEcdfPath), `ECDF specification must exist at ${specEcdfPath}`);
  assert.ok(existsSync(specKargilPath), `Kargil ridge transit specification must exist at ${specKargilPath}`);

  const viewshedContent = readFileSync(specViewshedPath, 'utf8');
  const ecdfContent = readFileSync(specEcdfPath, 'utf8');
  const kargilContent = readFileSync(specKargilPath, 'utf8');
  const readmeContent = readFileSync(readmePath, 'utf8');

  assert.ok(viewshedContent.length > 500, 'Viewshed specification must be non-empty and substantive');
  assert.ok(viewshedContent.includes('ITU-R F.1336-5'), 'Viewshed spec must reference ITU-R F.1336 antenna coupling');
  assert.ok(viewshedContent.includes('Relay Advisor'), 'Viewshed spec must describe Relay Advisor');

  assert.ok(ecdfContent.length > 500, 'ECDF specification must be non-empty and substantive');
  assert.ok(ecdfContent.includes('3GPP TS 23.501'), 'ECDF spec must reference 3GPP TS 23.501 5QI PDB');
  assert.ok(ecdfContent.includes('IEEE Transactions'), 'ECDF spec must detail IEEE Transactions LaTeX export');

  assert.ok(kargilContent.length > 500, 'Kargil specification must be non-empty and substantive');
  assert.ok(kargilContent.includes('Reactive M-LWDF'), 'Kargil spec must describe Reactive M-LWDF');
  assert.ok(kargilContent.includes('Predictive Tac-TAD'), 'Kargil spec must describe Predictive Tac-TAD');

  assert.ok(readmeContent.includes('SPEC-REALTIME-RF-VIEWSHED-AND-RELAY-ADVISOR.md'), 'README.md Section 7 must link Viewshed spec');
  assert.ok(readmeContent.includes('SPEC-PUBLICATION-ECDF-AND-LATEX-BENCHMARK-EXPORT.md'), 'README.md Section 7 must link ECDF spec');
  assert.ok(readmeContent.includes('SPEC-KARGIL-RIDGE-TRANSIT-AND-TACTAD-ADVANTAGE.md'), 'README.md Section 7 must link Kargil spec');

  console.log(`  ✓ SPEC-REALTIME-RF-VIEWSHED-AND-RELAY-ADVISOR.md verified on disk (${viewshedContent.length} bytes)`);
  console.log(`  ✓ SPEC-PUBLICATION-ECDF-AND-LATEX-BENCHMARK-EXPORT.md verified on disk (${ecdfContent.length} bytes)`);
  console.log(`  ✓ SPEC-KARGIL-RIDGE-TRANSIT-AND-TACTAD-ADVANTAGE.md verified on disk (${kargilContent.length} bytes)`);
  console.log('  ✓ All specifications verified linked in README.md Section 7');
}

// =================================================================================================
// [PEL-T2] 3-Way Delay Quantile / ECDF Monotonicity Invariant Check
// =================================================================================================
console.log('\n[PEL-T2] Verifying 3-Way Delay Quantiles & ECDF Monotonicity Invariants...');
{
  const worker = new SimulationWorkerManager(42, '16_NODES');

  // Advance simulation 10 frames to generate multi-class tactical traffic
  for (let k = 0; k < 10; k++) {
    worker.tickSimulation();
  }

  const frame = worker.lastTelemetryFrame;
  assert.ok(frame !== null, 'Telemetry frame must be populated');

  const checkQuantiles = (label: string, quantiles?: readonly number[]) => {
    assert.ok(Array.isArray(quantiles), `${label} quantiles must be serialized as array`);
    assert.equal(quantiles.length, 7, `${label} quantiles must contain exactly 7 points [p10..p99]`);

    for (let i = 0; i < quantiles.length; i++) {
      assert.ok(Number.isFinite(quantiles[i]), `${label} quantile [${i}] must be finite number, got ${quantiles[i]}`);
      assert.ok(quantiles[i] >= 0.0, `${label} quantile [${i}] must be non-negative, got ${quantiles[i]}`);
    }

    // Monotonicity: p10 <= p25 <= p50 <= p75 <= p90 <= p95 <= p99
    for (let i = 1; i < quantiles.length; i++) {
      assert.ok(
        quantiles[i] >= quantiles[i - 1],
        `${label} monotonicity violated: q[${i}]=${quantiles[i]} < q[${i-1}]=${quantiles[i-1]}`
      );
    }

    const p50 = quantiles[2];
    const p95 = quantiles[5];
    const p99 = quantiles[6];
    assert.ok(p50 <= p95, `${label} p50 (${p50}) must be <= p95 (${p95})`);
    assert.ok(p95 <= p99, `${label} p95 (${p95}) must be <= p99 (${p99})`);
    console.log(`  ✓ ${label}: p50 = ${p50} ms | p95 = ${p95} ms | p99 = ${p99} ms (monotonic)`);
  };

  checkQuantiles('Legacy Static TDMA', frame.static_delay_ecdf_ms);
  checkQuantiles('Reactive M-LWDF', frame.reactive_delay_ecdf_ms);
  checkQuantiles('Predictive Tac-TAD', frame.tac_delay_ecdf_ms);

  assert.equal(frame.static_p50_ms, frame.static_delay_ecdf_ms![2]);
  assert.equal(frame.static_p95_ms, frame.static_delay_ecdf_ms![5]);
  assert.equal(frame.static_p99_ms, frame.static_delay_ecdf_ms![6]);
}

// =================================================================================================
// [PEL-T3] IEEE Transactions LaTeX Table Generator Verification
// =================================================================================================
console.log('\n[PEL-T3] Verifying IEEE Transactions LaTeX Table Generator...');
{
  const mockRows = [
    {
      static_goodput_bits: 12_430_000,
      reactive_goodput_bits: 20_510_000,
      tac_goodput_bits: 20_510_000,
      static_run_ul_utilization_pct: 94.2,
      reactive_run_ul_utilization_pct: 86.4,
      tac_run_ul_utilization_pct: 86.4,
      static_wasted_bits_on_outage: 2_800_000,
      reactive_wasted_bits_on_outage: 0,
      tac_wasted_bits_on_outage: 0,
      static_delay_drops_observed: 1449,
      reactive_delay_drops_observed: 144,
      tac_delay_drops_observed: 144,
      static_overflow_drops_observed: 0,
      reactive_overflow_drops_observed: 0,
      tac_overflow_drops_observed: 0,
    },
    {
      static_goodput_bits: 12_850_000,
      reactive_goodput_bits: 20_920_000,
      tac_goodput_bits: 20_920_000,
      static_run_ul_utilization_pct: 95.1,
      reactive_run_ul_utilization_pct: 87.2,
      tac_run_ul_utilization_pct: 87.2,
      static_wasted_bits_on_outage: 2_750_000,
      reactive_wasted_bits_on_outage: 0,
      tac_wasted_bits_on_outage: 0,
      static_delay_drops_observed: 1420,
      reactive_delay_drops_observed: 139,
      tac_delay_drops_observed: 139,
      static_overflow_drops_observed: 0,
      reactive_overflow_drops_observed: 0,
      tac_overflow_drops_observed: 0,
    },
  ];

  const latex = formatBenchmarkLatexTable(mockRows, {
    caption: 'Paired Multi-Seed Benchmark: Tactical X-Band Scheduling Across Mountain Topography',
    label: 'tab:tactical_benchmark_results',
    demErrorStdM: 0.0,
    trafficScale: 1.0,
    terrainMode: 'synthetic',
  });

  assert.ok(latex.includes('\\begin{table}[htbp]'), 'Must contain \\begin{table}');
  assert.ok(latex.includes('\\end{table}'), 'Must contain \\end{table}');
  assert.ok(latex.includes('\\begin{tabular}'), 'Must contain \\begin{tabular}');
  assert.ok(latex.includes('\\end{tabular}'), 'Must contain \\end{tabular}');
  assert.ok(latex.includes('\\toprule'), 'Must contain booktabs \\toprule');
  assert.ok(latex.includes('\\bottomrule'), 'Must contain booktabs \\bottomrule');
  assert.ok(latex.includes('Legacy Static TDMA'), 'Must include Legacy Static TDMA row');
  assert.ok(latex.includes('Reactive M-LWDF'), 'Must include Reactive M-LWDF row');
  assert.ok(latex.includes('Predictive Tac-TAD'), 'Must include Predictive Tac-TAD row');

  assert.ok(!latex.includes('NaN'), 'LaTeX output must not contain NaN');
  assert.ok(!latex.includes('undefined'), 'LaTeX output must not contain undefined');
  assert.ok(!latex.includes('null'), 'LaTeX output must not contain null');

  console.log('  ✓ Generated valid IEEE Transactions LaTeX tabular block:');
  console.log(latex.split('\n').map(l => `    ${l}`).join('\n'));
}

// =================================================================================================
// [PEL-T4] DOM Elements & Accessibility Contracts
// =================================================================================================
console.log('\n[PEL-T4] Verifying DOM Contract in index.html...');
{
  const htmlPath = resolve(process.cwd(), 'index.html');
  const html = readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('id="ecdf-delay-canvas"'), 'index.html must contain #ecdf-delay-canvas');
  assert.ok(html.includes('id="btn-copy-latex-ablation"'), 'index.html must contain #btn-copy-latex-ablation');
  assert.ok(html.includes('id="latex-export-preview"'), 'index.html must contain #latex-export-preview');

  // Verify explicit accessible names for new buttons
  assert.ok(
    html.includes('aria-label="Export 3-Way Ablation Table as IEEE LaTeX"'),
    '#btn-copy-latex-ablation must declare explicit aria-label'
  );
  assert.ok(
    html.includes('aria-label="Live Empirical CDF Packet Delay Distribution Scope"'),
    '#ecdf-delay-canvas must declare explicit aria-label'
  );

  console.log('  ✓ #ecdf-delay-canvas DOM node verified with accessible aria-label');
  console.log('  ✓ #btn-copy-latex-ablation DOM button verified with accessible aria-label');
  console.log('  ✓ #latex-export-preview DOM container verified');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL PUBLICATION ECDF & LATEX BENCHMARK VERIFICATION TESTS PASSED (4/4 SUITES)');
console.log('='.repeat(96));
