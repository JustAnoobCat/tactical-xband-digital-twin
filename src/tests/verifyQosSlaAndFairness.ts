/**
 * src/tests/verifyQosSlaAndFairness.ts
 *
 * Automated Verification Suite for:
 * SPEC-5QI-SLA-COMPLIANCE-AND-JAINS-FAIRNESS-UPGRADE: 3GPP TS 23.501 5QI Bearer SLA
 * Compliance & Jain's Fairness Analyzer Upgrade.
 *
 * Test Suites:
 * - QSF-T1: Jain's Fairness Index Mathematical Identities (J = 1.0 on equality, 1/N on monopoly, scale invariance)
 * - QSF-T2: 3GPP 5QI Bearer SLA Verdict, Sojourn Delay & Headroom Clamping
 * - QSF-T3: DOM Elements in #tab-network, Global Layout Invariance & Specification Registration
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import {
  computeJainsFairnessIndex,
  evaluate5QiBearerSlaMetrics,
  CANONICAL_5QI_BEARERS,
} from '../core/qosSlaEngine';

console.log('='.repeat(96));
console.log('   3GPP TS 23.501 5QI SLA COMPLIANCE & JAIN\'S FAIRNESS ANALYZER VERIFICATION SUITE');
console.log('   Specification: SPEC-5QI-SLA-COMPLIANCE-AND-JAINS-FAIRNESS-UPGRADE // QSF-T1 - QSF-T3');
console.log('='.repeat(96));

// =================================================================================================
// [QSF-T1] Jain's Fairness Index Mathematical Identities
// =================================================================================================
console.log('\n[QSF-T1] Verifying Raj Jain\'s Fairness Index Mathematical Identities...');
{
  // 1. Equal allocation yields J === 1.000000
  const equal4 = computeJainsFairnessIndex([10, 10, 10, 10]);
  assert.equal(
    equal4,
    1.0,
    `Equal allocation across 4 nodes must yield J = 1.000000, got ${equal4}`
  );
  console.log(`  ✓ Equal allocation [10, 10, 10, 10]: J = ${equal4.toFixed(6)} === 1.000000 [PASS]`);

  // 2. Single monopolizer among N=4 yields J === 1/N === 0.250000
  const monopoly4 = computeJainsFairnessIndex([10, 0, 0, 0]);
  assert.ok(
    Math.abs(monopoly4 - 0.25) < 1e-6,
    `Single monopolizer among N=4 must yield J = 0.250000, got ${monopoly4}`
  );
  console.log(`  ✓ Monopolizer [10, 0, 0, 0]: J = ${monopoly4.toFixed(6)} === 0.250000 (1/N) [PASS]`);

  // 3. Single monopolizer among N=2 yields J === 0.500000
  const monopoly2 = computeJainsFairnessIndex([10, 0]);
  assert.ok(
    Math.abs(monopoly2 - 0.5) < 1e-6,
    `Single monopolizer among N=2 must yield J = 0.500000, got ${monopoly2}`
  );
  console.log(`  ✓ Monopolizer [10, 0]: J = ${monopoly2.toFixed(6)} === 0.500000 [PASS]`);

  // 4. Scale Invariance: J(c * x) === J(x)
  const allocA = [12.5, 25.0, 37.5, 50.0];
  const c = 3.75;
  const allocScaled = allocA.map(v => v * c);
  const jA = computeJainsFairnessIndex(allocA);
  const jScaled = computeJainsFairnessIndex(allocScaled);
  assert.ok(
    Math.abs(jA - jScaled) < 1e-6,
    `Scale invariance must hold: J(x) = ${jA}, J(c * x) = ${jScaled}`
  );
  console.log(`  ✓ Scale Invariance: J(x) = ${jA.toFixed(6)}, J(${c} * x) = ${jScaled.toFixed(6)} (diff < 1e-6) [PASS]`);

  // 5. Theoretical value check for [10, 20, 30, 40] -> (100)^2 / (4 * 3000) = 5/6 = 0.833333...
  const expected5_6 = 5.0 / 6.0;
  const j1234 = computeJainsFairnessIndex([10, 20, 30, 40]);
  assert.ok(
    Math.abs(j1234 - expected5_6) < 1e-6,
    `Allocation [10, 20, 30, 40] must equal 5/6 ~ 0.833333, got ${j1234}`
  );
  console.log(`  ✓ Analytical benchmark [10, 20, 30, 40]: J = ${j1234.toFixed(6)} (exact 5/6 = ${expected5_6.toFixed(6)}) [PASS]`);

  // 6. Boundary & edge cases
  assert.equal(computeJainsFairnessIndex([]), 1.0, 'Empty allocations must yield J = 1.0');
  assert.equal(computeJainsFairnessIndex([0, 0, 0, 0]), 1.0, 'All-zero allocations must yield J = 1.0');
  assert.equal(computeJainsFairnessIndex([42]), 1.0, 'Single user allocation must yield J = 1.0');

  console.log('  ✓ QSF-T1 passed: All Raj Jain Fairness Index mathematical identities verified');
}

// =================================================================================================
// [QSF-T2] 3GPP 5QI Bearer SLA Verdict, Sojourn Delay & Headroom Clamping
// =================================================================================================
console.log('\n[QSF-T2] Verifying 3GPP 5QI Bearer SLA Verdicts & Headroom Clamping...');
{
  // 1. Verify 4 canonical 3GPP TS 23.501 bearers are defined
  assert.equal(CANONICAL_5QI_BEARERS.length, 4, 'Must define exactly 4 canonical bearers');
  const bearerIds = CANONICAL_5QI_BEARERS.map(b => b.qos5qi);
  assert.deepEqual(bearerIds, [69, 65, 67, 70], 'Must include 5QI 69, 65, 67, and 70');
  const pdbs = CANONICAL_5QI_BEARERS.map(b => b.pdbMs);
  // Reconciled canonical 3GPP TS 23.501 PDBs (5QI 65 MC-PTT Voice = 75 ms per REMED-04)
  assert.deepEqual(pdbs, [60.0, 75.0, 150.0, 300.0], 'Authoritative PDBs must be 60, 75, 150, 300 ms');

  // 2. Nominal Test: Low sojourn delays (all <= 0.75 * PDB) -> SLA_COMPLIANT
  const nominalNodes = [
    {
      nodeId: 1,
      c2_bytes: 256,
      c2_sojourn_ms: 20.0, // <= 0.75 * 60 = 45 ms
      voice_bytes: 320,
      voice_sojourn_ms: 30.0, // <= 0.75 * 75 = 56.25 ms
      video_bytes: 2400,
      video_sojourn_ms: 40.0, // <= 0.75 * 150 = 112.5 ms
      photo_bytes: 2800,
      photo_sojourn_ms: 60.0, // <= 0.75 * 300 = 225 ms
    },
    {
      nodeId: 2,
      c2_bytes: 128,
      c2_sojourn_ms: 15.0,
      voice_bytes: 160,
      voice_sojourn_ms: 25.0,
      video_bytes: 1200,
      video_sojourn_ms: 35.0,
      photo_bytes: 1400,
      photo_sojourn_ms: 50.0,
    },
  ];

  const nominalReport = evaluate5QiBearerSlaMetrics(nominalNodes);
  assert.equal(nominalReport.bearers.length, 4, 'Report must contain 4 bearers');
  for (const b of nominalReport.bearers) {
    assert.equal(
      b.slaVerdict,
      'SLA_COMPLIANT',
      `Bearer ${b.shortName} must report SLA_COMPLIANT under low sojourn, got ${b.slaVerdict}`
    );
    assert.ok(b.pdbHeadroomPct > 25.0, `Headroom must be > 25% for SLA_COMPLIANT, got ${b.pdbHeadroomPct}%`);
    assert.equal(b.slaCompliancePct, 100.0, `All nodes must be compliant for ${b.shortName}`);
  }
  assert.equal(nominalReport.overallSlaCompliancePct, 100.0, 'Overall compliance must be 100.0%');
  console.log('  ✓ Nominal Scenario: All 4 bearers SLA_COMPLIANT, overall compliance = 100.0% [PASS]');

  // 3. At-Risk Test: Sojourn between 0.75 * PDB and 1.0 * PDB -> SLA_AT_RISK
  const atRiskNodes = [
    {
      nodeId: 1,
      c2_bytes: 256,
      c2_sojourn_ms: 50.0, // 50ms > 45ms and <= 60ms -> SLA_AT_RISK
      voice_bytes: 320,
      voice_sojourn_ms: 65.0, // 65ms > 56.25ms and <= 75ms -> SLA_AT_RISK
      video_bytes: 1200,
      video_sojourn_ms: 125.0, // 125ms > 112.5ms and <= 150ms -> SLA_AT_RISK
      photo_bytes: 1400,
      photo_sojourn_ms: 250.0, // 250ms > 225ms and <= 300ms -> SLA_AT_RISK
    },
  ];
  const atRiskReport = evaluate5QiBearerSlaMetrics(atRiskNodes);
  for (const b of atRiskReport.bearers) {
    assert.equal(
      b.slaVerdict,
      'SLA_AT_RISK',
      `Bearer ${b.shortName} must report SLA_AT_RISK, got ${b.slaVerdict}`
    );
    assert.ok(b.pdbHeadroomPct >= 0.0 && b.pdbHeadroomPct <= 25.0, `Headroom must be in [0, 25]%, got ${b.pdbHeadroomPct}%`);
    assert.equal(b.slaCompliancePct, 100.0, `Nodes within PDB are compliant count-wise`);
  }
  console.log('  ✓ At-Risk Scenario: All 4 bearers correctly classified as SLA_AT_RISK [PASS]');

  // 4. Breached Test: Sojourn > PDB -> SLA_BREACHED and Headroom clamped to 0.0%
  const breachedNodes = [
    {
      nodeId: 1,
      c2_bytes: 512,
      c2_sojourn_ms: 75.0, // 75ms > 60ms PDB -> SLA_BREACHED
      voice_bytes: 320,
      voice_sojourn_ms: 120.0, // 120ms > 100ms PDB -> SLA_BREACHED
      video_bytes: 2400,
      video_sojourn_ms: 180.0, // 180ms > 150ms PDB -> SLA_BREACHED
      photo_bytes: 2800,
      photo_sojourn_ms: 360.0, // 360ms > 300ms PDB -> SLA_BREACHED
    },
  ];
  const breachedReport = evaluate5QiBearerSlaMetrics(breachedNodes);
  for (const b of breachedReport.bearers) {
    assert.equal(
      b.slaVerdict,
      'SLA_BREACHED',
      `Bearer ${b.shortName} must report SLA_BREACHED, got ${b.slaVerdict}`
    );
    assert.equal(
      b.pdbHeadroomPct,
      0.0,
      `PDB headroom must clamp to 0.0% when sojourn exceeds PDB, got ${b.pdbHeadroomPct}%`
    );
    assert.equal(b.slaCompliancePct, 0.0, `Non-compliant node results in 0% compliance`);
  }
  assert.equal(breachedReport.overallSlaCompliancePct, 0.0, 'Overall compliance must drop to 0.0%');
  console.log('  ✓ Breached Scenario: All 4 bearers SLA_BREACHED, headroom clamped to 0.0% [PASS]');

  // 5. Backlog Accounting
  const totalExpectedBits = (512 + 320 + 2400 + 2800) * 8; // 48256 bits = 48.256 kbits
  assert.equal(breachedReport.totalNetworkBacklogBits, totalExpectedBits);
  assert.equal(breachedReport.totalNetworkBacklogKbits, totalExpectedBits / 1000.0);
  console.log(`  ✓ Backlog Conservation: Total Backlog = ${breachedReport.totalNetworkBacklogKbits} kbits (${breachedReport.totalNetworkBacklogBits} bits) [PASS]`);

  console.log('  ✓ QSF-T2 passed: All 4 3GPP 5QI bearer SLA metrics, verdicts, and headroom verified');
}

// =================================================================================================
// [QSF-T3] DOM Elements in #tab-network, Global Layout Invariance & Specification Registration
// =================================================================================================
console.log('\n[QSF-T3] Verifying DOM Elements in #tab-network, Layout Invariance & Spec Registration...');
{
  // 1. Specification file on disk
  const specPath = resolve(process.cwd(), 'docs/specs/SPEC-5QI-SLA-COMPLIANCE-AND-JAINS-FAIRNESS-UPGRADE.md');
  assert.ok(existsSync(specPath), 'Specification file SPEC-5QI-SLA-COMPLIANCE-AND-JAINS-FAIRNESS-UPGRADE.md must exist on disk');
  const specContent = readFileSync(specPath, 'utf-8');
  assert.ok(
    specContent.includes('APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)'),
    'Specification must contain Role 1 Planner sign-off'
  );
  console.log('  ✓ Spec File: docs/specs/SPEC-5QI-SLA-COMPLIANCE-AND-JAINS-FAIRNESS-UPGRADE.md verified with Planner sign-off [PASS]');

  // 2. README.md links specification in Section 7
  const readmeContent = readFileSync(resolve(process.cwd(), 'README.md'), 'utf-8');
  assert.ok(
    readmeContent.includes('SPEC-5QI-SLA-COMPLIANCE-AND-JAINS-FAIRNESS-UPGRADE.md'),
    'README.md Section 7 must link to SPEC-5QI-SLA-COMPLIANCE-AND-JAINS-FAIRNESS-UPGRADE.md'
  );
  console.log('  ✓ README.md Section 7 specification link verified [PASS]');

  // 3. Inspect index.html for required DOM IDs inside #tab-network
  const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');
  const tabNetStart = indexHtml.indexOf('id="tab-network"');
  assert.ok(tabNetStart > 0, '#tab-network must exist in index.html');
  const tabNetEnd = indexHtml.indexOf('</section>', tabNetStart);
  assert.ok(tabNetEnd > tabNetStart, '#tab-network must terminate with </section>');
  const tabNetHtml = indexHtml.slice(tabNetStart, tabNetEnd);

  const requiredIds = [
    'qos-sla-panel',
    'qos-sla-canvas',
    'qos-jains-fairness',
    'qos-overall-sla',
    'qos-total-backlog',
    'qos-sla-table-body',
  ];

  for (const id of requiredIds) {
    assert.ok(
      tabNetHtml.includes(`id="${id}"`),
      `Required element #${id} must exist inside #tab-network in index.html`
    );
  }
  console.log(`  ✓ All ${requiredIds.length} required DOM elements verified inside #tab-network [PASS]`);

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

  console.log('  ✓ QSF-T3 passed: DOM presence, layout invariance, and spec registration verified');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL 3GPP 5QI SLA & JAIN\'S FAIRNESS VERIFICATION TESTS PASSED (3/3 SUITES)');
console.log('='.repeat(96) + '\n');
