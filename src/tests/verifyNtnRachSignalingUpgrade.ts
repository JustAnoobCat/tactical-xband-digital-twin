/**
 * src/tests/verifyNtnRachSignalingUpgrade.ts
 *
 * Automated Verification Suite for:
 * SPEC-3GPP-NTN-RACH-AND-HANDOVER-LADDER-UPGRADE: 3GPP Rel-17 NTN 4-Step RACH,
 * Timing Advance Acquisition, C-RNTI Allocation & Event A3 Handover Signaling.
 *
 * Test Suites:
 * - NRS-T1: Speed-of-Light Propagation & 12-Bit 3GPP TA Index Math
 * - NRS-T2: RRC State Transitions & 5-Step Call-Flow Completeness
 * - NRS-T3: DOM Elements in #tab-registration, Global Layout Invariance & Spec Registration
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import {
  evaluateNtnNodeSignaling,
  computeDeterministicCRnti,
  computePrachPreambleIndex,
  computePropagationDelayUs,
  computeTimingAdvanceIndex,
  computeRachAcquisitionLatencyMs,
  SPEED_OF_LIGHT_M_S,
  TA_STEP_US,
  MAX_TA_INDEX,
} from '../core/ntnSignalingEngine';

console.log('='.repeat(96));
console.log('   3GPP REL-17 NTN RACH & HANDOVER LADDER VERIFICATION SUITE');
console.log('   Specification: SPEC-3GPP-NTN-RACH-AND-HANDOVER-LADDER-UPGRADE // NRS-T1 - NRS-T3');
console.log('='.repeat(96));

// =================================================================================================
// [NRS-T1] Speed-of-Light Propagation & 12-Bit 3GPP TA Index Math
// =================================================================================================
console.log('\n[NRS-T1] Verifying Speed-of-Light Propagation & 12-Bit 3GPP TA Index Math...');
{
  // 1. Authoritative Reference Check: d_3D = 14,989.6229 m
  const targetDistanceM = 14989.6229;
  const report = evaluateNtnNodeSignaling({
    nodeId: 1,
    slantRangeM: targetDistanceM,
    snrDb: 18.5,
    isOutage: false,
    isRegistered: true,
    activeSectorId: 0,
    handoverCount: 2,
    modcodName: '16APSK-2/3',
    totalBacklogBits: 1024,
  });

  // tau_prop = 14989.6229 / 299792458.0 * 1e6 = 50.0000... μs
  assert.ok(
    Math.abs(report.tauPropUs - 50.0) < 1e-4,
    `tau_prop must equal 50.000 μs at d = ${targetDistanceM} m, got ${report.tauPropUs}`
  );
  console.log(`  ✓ One-Way Propagation Delay: tau_prop = ${report.tauPropUs.toFixed(4)} μs === 50.000 μs [PASS]`);

  // tau_TA = 2.0 * tau_prop = 100.000 μs
  assert.ok(
    Math.abs(report.tauTaUs - 100.0) < 1e-4,
    `tau_TA must equal 100.000 μs, got ${report.tauTaUs}`
  );
  console.log(`  ✓ Two-Way Timing Advance: tau_TA = ${report.tauTaUs.toFixed(4)} μs === 100.000 μs [PASS]`);

  // T_A index = round(100.0 / 0.26) = round(384.615) = 385
  const expectedTaIndex = Math.round(100.0 / 0.26);
  assert.equal(
    report.taIndex,
    385,
    `3GPP TS 38.213 TA Index must equal 385 (round(100 / 0.26)), got ${report.taIndex}`
  );
  assert.equal(report.taIndex, expectedTaIndex);
  console.log(`  ✓ 12-Bit TA Command Index: T_A = ${report.taIndex} === 385 (SCS 30 kHz step 0.26 μs) [PASS]`);

  // T_RACH = 5.0 + 4 * 50.0 / 1000 = 5.0 + 0.200 = 5.200 ms
  assert.ok(
    Math.abs(report.rachLatencyMs - 5.2) < 1e-4,
    `T_RACH must equal 5.200 ms, got ${report.rachLatencyMs}`
  );
  console.log(`  ✓ 4-Step RACH Latency: T_RACH = ${report.rachLatencyMs.toFixed(4)} ms === 5.200 ms [PASS]`);

  // 2. Boundary Condition & Clamp Checks
  const zeroReport = evaluateNtnNodeSignaling({ nodeId: 2, slantRangeM: 0.0 });
  assert.equal(zeroReport.tauPropUs, 0.0, 'Zero distance must give tau_prop = 0');
  assert.equal(zeroReport.tauTaUs, 0.0, 'Zero distance must give tau_TA = 0');
  assert.equal(zeroReport.taIndex, 0, 'Zero distance must give T_A index = 0');
  assert.equal(zeroReport.rachLatencyMs, 5.0, 'Zero distance must give T_RACH = 5.0 ms (gNB+RRC processing base)');
  console.log('  ✓ Zero Distance Boundary: tau_prop=0 μs, T_A=0, T_RACH=5.0 ms [PASS]');

  const extremeReport = evaluateNtnNodeSignaling({ nodeId: 3, slantRangeM: 1000000.0 }); // 1000 km
  assert.equal(extremeReport.taIndex, MAX_TA_INDEX, `Extreme distance must clamp at MAX_TA_INDEX (${MAX_TA_INDEX})`);
  console.log(`  ✓ Upper Clamp Boundary: T_A index clamped strictly to [0, ${MAX_TA_INDEX}] [PASS]`);

  // 3. Zadoff-Chu Preamble Index Formula: (nodeId * 7 + 13) % 64
  for (let nid = 1; nid <= 16; nid++) {
    const pIdx = computePrachPreambleIndex(nid);
    const expectedP = ((nid * 7 + 13) % 64 + 64) % 64;
    assert.equal(pIdx, expectedP, `Node ${nid} ZC preamble must equal ${expectedP}`);
    assert.ok(pIdx >= 0 && pIdx <= 63, `Node ${nid} ZC preamble must be in [0, 63]`);
  }
  console.log('  ✓ Zadoff-Chu Preamble Generation: Verified across nodes 1..16 [PASS]');

  console.log('  ✓ NRS-T1 passed: All Speed-of-Light & 3GPP Timing Advance mathematical identities verified');
}

// =================================================================================================
// [NRS-T2] RRC State Transitions & 5-Step Call-Flow Completeness
// =================================================================================================
console.log('\n[NRS-T2] Verifying RRC State Transitions & 5-Step Call-Flow Completeness...');
{
  // 1. Nominal Registered LoS Node -> RRC_CONNECTED
  const connectedReport = evaluateNtnNodeSignaling({
    nodeId: 1,
    slantRangeM: 15000.0,
    snrDb: 18.0,
    isOutage: false,
    isRegistered: true,
    activeSectorId: 1,
    handoverCount: 0,
    modcodName: '16APSK-2/3',
    totalBacklogBits: 4096,
  });
  assert.equal(connectedReport.rrcState, 'RRC_CONNECTED', 'Registered LoS node must report RRC_CONNECTED');
  assert.equal(connectedReport.cRntiHex, '0x4E01', 'Node 1 C-RNTI must be 0x4E01');

  // 2. Occluded Outage Node -> RRC_RLF_RECOVERY
  const outageReport = evaluateNtnNodeSignaling({
    nodeId: 2,
    slantRangeM: 22000.0,
    snrDb: -5.0,
    isOutage: true,
    isRegistered: true,
    activeSectorId: 2,
    handoverCount: 3,
    modcodName: 'QPSK-1/4',
    totalBacklogBits: 8192,
  });
  assert.equal(outageReport.rrcState, 'RRC_RLF_RECOVERY', 'Occluded outage node must report RRC_RLF_RECOVERY');
  assert.equal(outageReport.cRntiHex, '0x4E02', 'Node 2 C-RNTI must be 0x4E02');

  // 3. Unregistered Node -> RRC_IDLE
  const idleReport = evaluateNtnNodeSignaling({
    nodeId: 16,
    slantRangeM: 30000.0,
    snrDb: 10.0,
    isOutage: false,
    isRegistered: false,
    activeSectorId: 3,
    handoverCount: 1,
  });
  assert.equal(idleReport.rrcState, 'RRC_IDLE', 'Unregistered node must report RRC_IDLE');
  assert.equal(idleReport.cRntiHex, '0x4E10', 'Node 16 C-RNTI must be 0x4E10');

  // 4. Verify 5-Step Call-Flow Ladder Structure and Contents
  for (const rep of [connectedReport, outageReport, idleReport]) {
    assert.equal(rep.steps.length, 5, 'Must contain exactly 5 ladder steps');

    // Step 1: Msg1 PRACH Preamble
    const s1 = rep.steps[0];
    assert.equal(s1.stepIndex, 1);
    assert.equal(s1.dir, 'UE_TO_SECTOR');
    assert.ok(s1.label.startsWith('Msg1: PRACH (ZC #'));
    assert.ok(s1.detail.includes('τ_prop='));

    // Step 2: Msg2 RAR + TA Cmd
    const s2 = rep.steps[1];
    assert.equal(s2.stepIndex, 2);
    assert.equal(s2.dir, 'SECTOR_TO_UE');
    assert.ok(s2.label.startsWith('Msg2: RAR (T_A='));
    assert.ok(s2.label.includes(rep.cRntiHex), `Msg2 must contain TC-RNTI ${rep.cRntiHex}`);
    assert.ok(s2.detail.includes('τ_TA='));

    // Step 3: Msg3 RRC Setup Req
    const s3 = rep.steps[2];
    assert.equal(s3.stepIndex, 3);
    assert.equal(s3.dir, 'UE_TO_RRC');
    assert.ok(s3.label.startsWith('Msg3: RRCSetupRequest + 5QI BSR'));

    // Step 4: Msg4 Contention Resolution
    const s4 = rep.steps[3];
    assert.equal(s4.stepIndex, 4);
    assert.equal(s4.dir, 'RRC_TO_UE');
    assert.ok(s4.label.startsWith('Msg4: ContentionResolution'));
    assert.ok(s4.label.includes(rep.rrcState), `Msg4 must include RRC state [${rep.rrcState}]`);
    assert.ok(s4.detail.includes('SINR='));

    // Step 5: Event A3 Beam Mobility
    const s5 = rep.steps[4];
    assert.equal(s5.stepIndex, 5);
    assert.equal(s5.dir, 'RRC_TO_UE');
    assert.ok(s5.label.startsWith('A3 MeasReport / Beam Lock'));
    assert.ok(s5.detail.includes('HO Count='));
  }
  console.log('  ✓ 5-Step Call-Flow Ladder: Msg1..Msg4 + Event A3 verified across states [PASS]');

  // Step 4 failure state in RRC_RLF_RECOVERY
  assert.equal(outageReport.steps[3].status, 'FAILED', 'Msg4 status must be FAILED in RRC_RLF_RECOVERY');
  assert.equal(connectedReport.steps[3].status, 'SUCCESS', 'Msg4 status must be SUCCESS in RRC_CONNECTED');

  console.log('  ✓ NRS-T2 passed: All RRC states and 5-step call-flow sequences verified');
}

// =================================================================================================
// [NRS-T3] DOM Elements in #tab-registration, Global Layout Invariance & Spec Registration
// =================================================================================================
console.log('\n[NRS-T3] Verifying DOM Elements in #tab-registration, Layout Invariance & Spec Registration...');
{
  // 1. Specification file on disk
  const specPath = resolve(process.cwd(), 'docs/specs/SPEC-3GPP-NTN-RACH-AND-HANDOVER-LADDER-UPGRADE.md');
  assert.ok(existsSync(specPath), 'Specification file SPEC-3GPP-NTN-RACH-AND-HANDOVER-LADDER-UPGRADE.md must exist on disk');
  const specContent = readFileSync(specPath, 'utf-8');
  assert.ok(
    specContent.includes('APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)'),
    'Specification must contain Role 1 Planner sign-off'
  );
  console.log('  ✓ Spec File: docs/specs/SPEC-3GPP-NTN-RACH-AND-HANDOVER-LADDER-UPGRADE.md verified with Planner sign-off [PASS]');

  // 2. README.md links specification in Section 7
  const readmeContent = readFileSync(resolve(process.cwd(), 'README.md'), 'utf-8');
  assert.ok(
    readmeContent.includes('SPEC-3GPP-NTN-RACH-AND-HANDOVER-LADDER-UPGRADE.md'),
    'README.md Section 7 must link to SPEC-3GPP-NTN-RACH-AND-HANDOVER-LADDER-UPGRADE.md'
  );
  console.log('  ✓ README.md Section 7 specification link verified [PASS]');

  // 3. Inspect index.html for required DOM IDs inside #tab-registration
  const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');
  const tabRegStart = indexHtml.indexOf('id="tab-registration"');
  assert.ok(tabRegStart > 0, '#tab-registration must exist in index.html');
  const tabRegEnd = indexHtml.indexOf('</section>', tabRegStart);
  assert.ok(tabRegEnd > tabRegStart, '#tab-registration must terminate with </section>');
  const tabRegHtml = indexHtml.slice(tabRegStart, tabRegEnd);

  const requiredIds = [
    'ntn-signaling-panel',
    'ntn-signaling-canvas',
    'ntn-node-select',
    'ntn-rrc-state-badge',
    'ntn-crnti-readout',
    'ntn-rach-latency-readout',
    'ntn-ta-cmd-readout',
  ];

  for (const id of requiredIds) {
    assert.ok(
      tabRegHtml.includes(`id="${id}"`),
      `Required element #${id} must exist inside #tab-registration in index.html`
    );
  }
  console.log(`  ✓ All ${requiredIds.length} required DOM elements verified inside #tab-registration [PASS]`);

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

  console.log('  ✓ NRS-T3 passed: DOM presence, layout invariance, and spec registration verified');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL 3GPP REL-17 NTN RACH & HANDOVER SIGNALING VERIFICATION TESTS PASSED (3/3 SUITES)');
console.log('='.repeat(96) + '\n');
