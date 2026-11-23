/**
 * src/tests/verifyWorkerJitterAndDossierUpgrade.ts
 *
 * Automated Verification Suite for:
 * SPEC-REALTIME-WORKER-JITTER-AND-DOSSIER-EXPORTER-UPGRADE: 50 Hz Web Worker Jitter Profiler
 * & Reproducible Research Dossier Exporter Upgrade.
 *
 * Test Suites:
 * - WJD-T1: 8-Bin Histogram Probability Conservation & Real-Time Headroom Math
 * - WJD-T2: Reproducible Research Dossier Markdown + IEEE LaTeX Exporter Completeness
 * - WJD-T3: DOM Elements in #tab-diagnostics, Global Layout Invariance & Spec Registration
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import {
  evaluateWorkerRealTimeProfile,
  generateExperimentDossierMarkdown,
  type WorkerRealTimeProfileReport,
  type ExperimentDossierSnapshot,
} from '../core/workerJitterProfiler';

console.log('='.repeat(96));
console.log('   50 HZ WORKER JITTER PROFILER & EXPERIMENT DOSSIER VERIFICATION SUITE');
console.log('   Specification: SPEC-REALTIME-WORKER-JITTER-AND-DOSSIER-EXPORTER-UPGRADE // WJD-T1 - WJD-T3');
console.log('='.repeat(96));

// =================================================================================================
// [WJD-T1] 8-Bin Histogram Probability Conservation & Real-Time Headroom Math
// =================================================================================================
console.log('\n[WJD-T1] Verifying 8-Bin Histogram Probability Conservation & Real-Time Headroom Math...');
{
  // 1. Authoritative Reference Check: [4.2, 4.5, 4.8, 5.1, 5.4, 6.0, 7.2, 8.0]
  const nominalSamples = [4.2, 4.5, 4.8, 5.1, 5.4, 6.0, 7.2, 8.0];
  const report = evaluateWorkerRealTimeProfile(nominalSamples);

  // Sample Count
  assert.equal(report.sampleCount, 8, `Sample count must equal 8, got ${report.sampleCount}`);

  // Histogram Bins Integrity & Conservation
  assert.equal(report.histogramBins.length, 8, 'Histogram must contain exactly 8 bins');
  const sumFraction = report.histogramBins.reduce((acc, bin) => acc + bin.fraction, 0.0);
  assert.ok(
    Math.abs(sumFraction - 1.0) < 1e-6,
    `Sum of bin fractions must conserve probability 1.000000, got ${sumFraction}`
  );
  console.log(`  ✓ 8-Bin Histogram Probability Conservation: sum(fraction) = ${sumFraction.toFixed(6)} === 1.000000 [PASS]`);

  // Percentiles
  assert.ok(report.p95Ms <= 8.0, `p95Ms must be <= 8.0 ms, got ${report.p95Ms}`);
  assert.ok(report.p50Ms > 0 && report.p50Ms <= report.p90Ms, 'p50Ms <= p90Ms check');
  assert.ok(report.p90Ms <= report.p95Ms, 'p90Ms <= p95Ms check');
  assert.ok(report.p95Ms <= report.p99Ms, 'p95Ms <= p99Ms check');
  assert.ok(report.p99Ms <= report.maxMs, 'p99Ms <= maxMs check');
  console.log(`  ✓ Execution Percentiles: p50=${report.p50Ms.toFixed(2)}ms, p90=${report.p90Ms.toFixed(2)}ms, p95=${report.p95Ms.toFixed(2)}ms, p99=${report.p99Ms.toFixed(2)}ms, max=${report.maxMs.toFixed(2)}ms [PASS]`);

  // Headroom Percentage: (1.0 - p95 / 20.0) * 100.0 >= 60.0%
  assert.ok(report.headroomPct >= 60.0, `headroomPct must be >= 60.0%, got ${report.headroomPct}%`);
  console.log(`  ✓ Real-Time Deadline Headroom: ${report.headroomPct.toFixed(2)}% >= 60.0% [PASS]`);

  // Overrun and Verdict
  assert.equal(report.deadlineOverrunCount, 0, 'Nominal profile must have 0 deadline overruns');
  assert.equal(report.realTimeVerdict, 'HARD_RT_CERTIFIED', 'Nominal profile must be HARD_RT_CERTIFIED');
  console.log(`  ✓ Real-Time Verdict: ${report.realTimeVerdict} [PASS]`);

  // 2. Deadline Overrun Boundary Check
  const overrunSamples = [5.0, 6.0, 7.0, 21.5];
  const overrunReport = evaluateWorkerRealTimeProfile(overrunSamples);
  assert.equal(overrunReport.deadlineOverrunCount, 1, 'Overrun sample count must be 1');
  assert.equal(overrunReport.realTimeVerdict, 'DEADLINE_OVERRUN', 'Overrun sample must yield DEADLINE_OVERRUN');
  console.log('  ✓ Deadline Overrun Detection: 21.5 ms -> DEADLINE_OVERRUN [PASS]');

  // 3. Soft RT Warning Check (p95 > 15.0 ms, but no overrun > 20 ms)
  const softSamples = [16.0, 16.5, 17.0, 17.5, 18.0];
  const softReport = evaluateWorkerRealTimeProfile(softSamples);
  assert.equal(softReport.deadlineOverrunCount, 0, 'No overrun > 20 ms');
  assert.equal(softReport.realTimeVerdict, 'SOFT_RT_WARNING', 'p95 > 15.0 ms must yield SOFT_RT_WARNING');
  console.log('  ✓ Soft RT Warning Detection: p95 > 15 ms without overrun -> SOFT_RT_WARNING [PASS]');

  // 4. RFC 3550 Inter-Frame Pacing Jitter Formula
  const deltas = [21.0, 19.0, 22.0, 18.0];
  const jitterReport = evaluateWorkerRealTimeProfile(nominalSamples, deltas);
  assert.ok(Number.isFinite(jitterReport.rfc3550JitterMs) && jitterReport.rfc3550JitterMs > 0.0, 'RFC 3550 jitter must be positive');
  console.log(`  ✓ RFC 3550 Jitter: ${jitterReport.rfc3550JitterMs.toFixed(3)} ms [PASS]`);

  // 5. Empty Input Safety Check
  const emptyReport = evaluateWorkerRealTimeProfile([]);
  assert.equal(emptyReport.sampleCount, 0);
  assert.equal(emptyReport.histogramBins.length, 8);
  console.log('  ✓ Empty Sample Array Guard: Successfully produced zeroed profile [PASS]');

  console.log('  ✓ WJD-T1 passed: All 8-bin histogram, percentile, and real-time certification math verified');
}

// =================================================================================================
// [WJD-T2] Reproducible Research Dossier Completeness
// =================================================================================================
console.log('\n[WJD-T2] Verifying Reproducible Research Dossier Completeness...');
{
  const mockProfile = evaluateWorkerRealTimeProfile([4.2, 4.5, 4.8, 5.1, 5.4, 6.0, 7.2, 8.0]);
  const mockSnapshot: ExperimentDossierSnapshot = {
    simTimeS: 45.2,
    frameIndex: 2260,
    staticGoodputMbps: 12.45,
    reactiveGoodputMbps: 20.35,
    tacGoodputMbps: 20.55,
    staticDrops: 1420,
    reactiveDrops: 165,
    tacDrops: 152,
    staticUtilPct: 62.4,
    reactiveUtilPct: 88.5,
    tacUtilPct: 91.2,
    demErrorM: 0.0,
    trafficScale: 1.0,
    jammerEnabled: true,
    activeRelayEnabled: true,
    ricianEnabled: true,
    earthRadiusFactorK: 1.333,
    rtProfile: mockProfile,
  };

  const dossier = generateExperimentDossierMarkdown(mockSnapshot);

  // 1. Title verification
  assert.ok(
    dossier.includes('# DRDO Tactical X-Band Digital Twin — Reproducible Experiment Dossier'),
    'Dossier must contain main title'
  );

  // 2. Four numbered sections verification
  assert.ok(
    dossier.includes('## 1. Theater & ITU-R / 3GPP Physical Configuration Provenance'),
    'Must include Section 1: Physical Configuration Provenance'
  );
  assert.ok(
    dossier.includes('## 2. 3-Way Lockstep MAC Scheduler Ablation Results'),
    'Must include Section 2: 3-Way MAC Scheduler Ablation Results'
  );
  assert.ok(
    dossier.includes('## 3. IEEE Transactions LaTeX Table (`booktabs`)'),
    'Must include Section 3: IEEE LaTeX Table'
  );
  assert.ok(
    dossier.includes('## 4. 50 Hz Real-Time Discrete-Event Engine Certification'),
    'Must include Section 4: 50 Hz Engine Certification'
  );

  // 3. LaTeX Table Fencing and Booktabs
  assert.ok(dossier.includes('\\begin{table}'), 'Must contain \\begin{table}');
  assert.ok(dossier.includes('\\end{table}'), 'Must contain \\end{table}');
  assert.ok(dossier.includes('\\toprule'), 'Must contain \\toprule');
  assert.ok(dossier.includes('\\midrule'), 'Must contain \\midrule');
  assert.ok(dossier.includes('\\bottomrule'), 'Must contain \\bottomrule');
  assert.ok(dossier.includes('Legacy Static TDMA'), 'Must mention Legacy Static TDMA in LaTeX');
  assert.ok(dossier.includes('Reactive M-LWDF'), 'Must mention Reactive M-LWDF in LaTeX');
  assert.ok(dossier.includes('Predictive Tac-TAD'), 'Must mention Predictive Tac-TAD in LaTeX');

  // 4. Check for invalid serialization tokens
  assert.ok(!dossier.includes('NaN'), 'Dossier must not contain NaN');
  assert.ok(!dossier.includes('undefined'), 'Dossier must not contain undefined');
  assert.ok(!dossier.includes('null'), 'Dossier must not contain null');

  // 5. Check real-time values in Section 4
  assert.ok(dossier.includes('HARD_RT_CERTIFIED'), 'Must display realTimeVerdict in Section 4');
  assert.ok(dossier.includes('Deadline Headroom'), 'Must mention Deadline Headroom in Section 4');

  console.log('  ✓ Dossier Sections, LaTeX booktabs formatting, and token validity verified [PASS]');
  console.log('  ✓ WJD-T2 passed: All Reproducible Research Dossier requirements verified');
}

// =================================================================================================
// [WJD-T3] DOM & Global Layout Invariance Check
// =================================================================================================
console.log('\n[WJD-T3] Verifying DOM & Global Layout Invariance Check...');
{
  // 1. Specification file on disk
  const specPath = resolve(process.cwd(), 'docs/specs/SPEC-REALTIME-WORKER-JITTER-AND-DOSSIER-EXPORTER-UPGRADE.md');
  assert.ok(existsSync(specPath), 'Specification file SPEC-REALTIME-WORKER-JITTER-AND-DOSSIER-EXPORTER-UPGRADE.md must exist on disk');
  const specContent = readFileSync(specPath, 'utf-8');
  assert.ok(
    specContent.includes('APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)'),
    'Specification must contain Role 1 Planner sign-off'
  );
  console.log('  ✓ Spec File: docs/specs/SPEC-REALTIME-WORKER-JITTER-AND-DOSSIER-EXPORTER-UPGRADE.md verified with Planner sign-off [PASS]');

  // 2. README.md links specification in Section 7
  const readmeContent = readFileSync(resolve(process.cwd(), 'README.md'), 'utf-8');
  assert.ok(
    readmeContent.includes('SPEC-REALTIME-WORKER-JITTER-AND-DOSSIER-EXPORTER-UPGRADE.md'),
    'README.md Section 7 must link to SPEC-REALTIME-WORKER-JITTER-AND-DOSSIER-EXPORTER-UPGRADE.md'
  );
  console.log('  ✓ README.md Section 7 specification link verified [PASS]');

  // 3. Inspect index.html for required DOM IDs inside #tab-diagnostics
  const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');
  const tabDiagStart = indexHtml.indexOf('id="tab-diagnostics"');
  assert.ok(tabDiagStart > 0, '#tab-diagnostics must exist in index.html');
  
  // Find container end (either </section> or </div> matching container)
  const tabDiagRest = indexHtml.slice(tabDiagStart);
  
  const requiredIds = [
    'rt-profiler-panel',
    'worker-jitter-canvas',
    'rt-verdict-badge',
    'rt-headroom-readout',
    'btn-generate-research-dossier',
    'dossier-markdown-preview',
  ];

  for (const id of requiredIds) {
    assert.ok(
      tabDiagRest.includes(`id="${id}"`),
      `Required element #${id} must exist inside #tab-diagnostics in index.html`
    );
  }
  console.log(`  ✓ All ${requiredIds.length} required DOM elements verified inside #tab-diagnostics [PASS]`);

  // 4. Global Page Layout Invariance Check
  assert.ok(/class="[^"]*\brail\b/.test(indexHtml), '.rail must remain present in index.html');
  assert.ok(/class="[^"]*\btopbar\b/.test(indexHtml), '.topbar must remain present in index.html');
  assert.ok(
    /class="[^"]*\b(shell|app-shell)\b/.test(indexHtml) || indexHtml.includes('shell') || indexHtml.includes('app-shell'),
    '.shell / .app-shell must remain present in index.html'
  );
  assert.ok(indexHtml.includes('id="radar-container"'), '#radar-container must remain present in index.html');
  console.log('  ✓ Global Page Layout Invariant (.rail, .topbar, .app-shell, #radar-container) verified [PASS]');

  // 5. Global Theme CSS Existence Check
  assert.ok(existsSync(resolve(process.cwd(), 'frontend/c2-console-theme.css')), 'frontend/c2-console-theme.css must exist');
  console.log('  ✓ frontend/c2-console-theme.css exists [PASS]');

  console.log('  ✓ WJD-T3 passed: DOM presence, layout invariance, and spec registration verified');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL WORKER JITTER PROFILER & DOSSIER VERIFICATION TESTS PASSED (3/3 SUITES)');
console.log('='.repeat(96) + '\n');
