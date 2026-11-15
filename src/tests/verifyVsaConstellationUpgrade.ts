/**
 * src/tests/verifyVsaConstellationUpgrade.ts
 *
 * Verification suite for:
 * SPEC-DVBS2X-IQ-CONSTELLATION-VSA-UPGRADE: Keysight 89600 & Rohde & Schwarz VSE
 * DVB-S2X Baseband I/Q Constellation, EVM & LDPC BLER Analyzer Upgrade.
 *
 * Checks:
 * - VSA-T1: Exact Unit-Energy Reference Constellation Normalization (QPSK, 8-PSK, 16-QAM, 16-APSK, 32-APSK, 64-QAM, 64-APSK)
 * - VSA-T2: First-Principles EVM (20 dB -> 10.00%, 0 dB -> 100.0%) & Monotonic LDPC BLER Waterfall Decline
 * - VSA-T3: DOM Elements in #tab-terminal, Global Layout Invariance, & Specification Registration
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getReferenceConstellation,
  evaluateTerminalVsaMetrics,
  resolveConstellationInfo,
  sampleNoisyIqSymbols,
} from '../core/vsaConstellationEngine.js';

console.log('--- RUNNING DVB-S2X I/Q CONSTELLATION & VSA UPGRADE VERIFICATION ---');

// ============================================================================
// VSA-T1: Canonical Unit-Energy Constellation Normalization
// ============================================================================
console.log('\n[VSA-T1] Testing Canonical Unit-Energy Constellation Normalization...');

const constellationsToTest = [
  { name: 'QPSK', expectedCount: 4 },
  { name: '8-PSK', expectedCount: 8 },
  { name: '16-QAM', expectedCount: 16 },
  { name: '16-APSK', expectedCount: 16 },
  { name: '32-APSK', expectedCount: 32 },
  { name: '64-QAM', expectedCount: 64 },
  { name: '64-APSK', expectedCount: 64 },
];

for (const tc of constellationsToTest) {
  const points = getReferenceConstellation(tc.name);
  assert.equal(
    points.length,
    tc.expectedCount,
    `Constellation ${tc.name} must have ${tc.expectedCount} points (got ${points.length})`
  );

  let sumEnergy = 0;
  for (const pt of points) {
    assert.ok(Number.isFinite(pt.i), `Point I coordinate must be finite in ${tc.name}`);
    assert.ok(Number.isFinite(pt.q), `Point Q coordinate must be finite in ${tc.name}`);
    sumEnergy += pt.i * pt.i + pt.q * pt.q;
  }
  const meanEnergy = sumEnergy / points.length;

  assert.ok(
    Math.abs(meanEnergy - 1.0) <= 1e-4,
    `Constellation ${tc.name} must have unit average energy 1.0 +/- 1e-4 (got ${meanEnergy})`
  );
  console.log(`  ✓ ${tc.name}: M=${points.length}, Mean Symbol Energy E_avg = ${meanEnergy.toFixed(6)} [PASS]`);
}

// Check BPSK as well
const bpsk = getReferenceConstellation('BPSK');
assert.equal(bpsk.length, 2, 'BPSK must have 2 points');
const bpskEnergy = (bpsk[0].i ** 2 + bpsk[0].q ** 2 + bpsk[1].i ** 2 + bpsk[1].q ** 2) / 2.0;
assert.ok(Math.abs(bpskEnergy - 1.0) <= 1e-4, 'BPSK must have unit energy');

console.log('  ✓ VSA-T1 passed: All reference constellations strictly unit-energy normalized');

// ============================================================================
// VSA-T2: First-Principles EVM & LDPC Waterfall Monotonicity
// ============================================================================
console.log('\n[VSA-T2] Testing First-Principles EVM and LDPC Waterfall Monotonicity...');

// 1. Check EVM at 20.0 dB -> 10.00%
const eval20 = evaluateTerminalVsaMetrics({
  snrDb: 20.0,
  minSnrDb: 10.0,
  ricianKDb: 12.0,
  dopplerShiftHz: 0.0,
  modcodName: '16-APSK 2/3',
});
assert.ok(
  Math.abs(eval20.evmRmsPct - 10.0) < 1e-3,
  `At SINR=20.0 dB, EVM_rms must equal 10.00% (got ${eval20.evmRmsPct}%)`
);
assert.equal(eval20.evmDb, -20.0, 'EVM_dB must equal -SINR_dB');

// 2. Check EVM at 0.0 dB -> 100.0%
const eval0 = evaluateTerminalVsaMetrics({
  snrDb: 0.0,
  minSnrDb: 5.5,
  ricianKDb: 6.0,
  dopplerShiftHz: 120.0,
  modcodName: 'QPSK 3/4',
});
assert.ok(
  Math.abs(eval0.evmRmsPct - 100.0) < 1e-3,
  `At SINR=0.0 dB, EVM_rms must equal 100.00% (got ${eval0.evmRmsPct}%)`
);
assert.equal(eval0.evmDb, 0.0, 'EVM_dB must equal -0.0 dB');

// 3. Check Monotonicity of LDPC Waterfall BLER as SINR increases above threshold
const reqSnr = 11.5; // 16-APSK 2/3
let prevBler = 1.01;
const testSnrs = [8.0, 10.0, 11.5, 12.5, 14.0, 16.0, 18.0, 22.0];

for (const snr of testSnrs) {
  const m = evaluateTerminalVsaMetrics({
    snrDb: snr,
    minSnrDb: reqSnr,
    ricianKDb: 10.0,
    dopplerShiftHz: 400.0,
    modcodName: '16-APSK 2/3',
    isOutage: false,
  });
  assert.ok(
    m.ldpcBler <= prevBler,
    `BLER must decrease monotonically as SINR increases: snr=${snr}, bler=${m.ldpcBler}, prevBler=${prevBler}`
  );
  assert.ok(m.ldpcBler >= 1e-7 && m.ldpcBler <= 1.0, `BLER must be clamped in [1e-7, 1.0] (got ${m.ldpcBler})`);
  prevBler = m.ldpcBler;
}

// 4. Check that at high margin (> 4 dB above threshold), BLER is low and demod is locked
const evalHigh = evaluateTerminalVsaMetrics({
  snrDb: 18.0,
  minSnrDb: 11.5,
  ricianKDb: 15.0,
  dopplerShiftHz: 200.0,
  modcodName: '16-APSK 2/3',
});
assert.ok(evalHigh.ldpcBler < 1e-3, `BLER at +6.5 dB margin must be < 1e-3 (got ${evalHigh.ldpcBler})`);
assert.equal(evalHigh.isLock, true, 'Demodulator must be locked at high positive SINR margin');

// 5. Check Carrier phase jitter formula bounds [0.1 deg, 45.0 deg]
assert.ok(evalHigh.phaseErrorDeg >= 0.1 && evalHigh.phaseErrorDeg <= 45.0, 'Phase jitter in valid bounds');

// 6. Check received symbols length
assert.equal(evalHigh.receivedSymbols.length, 64, 'Must generate exactly 64 received symbols');

console.log('  ✓ VSA-T2 passed: EVM 20dB=10.00%, 0dB=100.0%, and LDPC waterfall monotonicity verified');

// ============================================================================
// VSA-T3: DOM Elements & Global Layout Invariance
// ============================================================================
console.log('\n[VSA-T3] Testing DOM Elements and Global Layout Invariance...');

// 1. Check specification file exists on disk
const specPath = resolve(process.cwd(), 'docs/specs/SPEC-DVBS2X-IQ-CONSTELLATION-VSA-UPGRADE.md');
assert.ok(existsSync(specPath), 'SPEC-DVBS2X-IQ-CONSTELLATION-VSA-UPGRADE.md must exist on disk');
const specContent = readFileSync(specPath, 'utf-8');
assert.ok(
  specContent.includes('SPEC-DVBS2X-IQ-CONSTELLATION-VSA-UPGRADE'),
  'Specification must contain identifier'
);
assert.ok(
  specContent.includes('APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)'),
  'Specification must contain reviewer sign-off'
);

// 2. Check README.md links specification in Section 7
const readmeContent = readFileSync(resolve(process.cwd(), 'README.md'), 'utf-8');
assert.ok(
  readmeContent.includes('SPEC-DVBS2X-IQ-CONSTELLATION-VSA-UPGRADE.md'),
  'README.md must link to SPEC-DVBS2X-IQ-CONSTELLATION-VSA-UPGRADE.md in Section 7'
);

// 3. Check required DOM elements in index.html inside #tab-terminal
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');
const tabTerminalIdx = indexHtml.indexOf('id="tab-terminal"');
assert.ok(tabTerminalIdx > 0, '#tab-terminal must exist in index.html');
const tabTerminalEndIdx = indexHtml.indexOf('</section>', tabTerminalIdx);
const tabTerminalHtml = indexHtml.slice(tabTerminalIdx, tabTerminalEndIdx);

const requiredIds = [
  'iq-constellation-canvas',
  'vsa-node-select',
  'vsa-lock-badge',
  'vsa-evm-pct',
  'vsa-snr-margin',
  'vsa-phase-err',
  'vsa-ldpc-bler',
  'vsa-modcod-order',
];

for (const id of requiredIds) {
  assert.ok(
    tabTerminalHtml.includes(`id="${id}"`),
    `DOM element #${id} must exist inside #tab-terminal in index.html`
  );
}

// 4. Global Page Layout and Theme CSS Invariance Check
assert.ok(
  indexHtml.includes('class="rail"'),
  '.rail must remain present in index.html'
);
assert.ok(
  indexHtml.includes('class="topbar"'),
  '.topbar must remain present in index.html'
);
assert.ok(
  indexHtml.includes('class="shell"') || indexHtml.includes('class="app-shell"'),
  '.shell / .app-shell must remain present in index.html'
);
assert.ok(
  indexHtml.includes('id="radar-container"'),
  '#radar-container must remain present in index.html'
);

// Verify frontend/c2-console-theme.css has git clean status (untouched)
const { execSync } = await import('node:child_process');
const gitDiffCss = execSync('git diff frontend/c2-console-theme.css', { encoding: 'utf-8' }).trim();
assert.equal(gitDiffCss, '', 'frontend/c2-console-theme.css must remain 100% untouched');

console.log('  ✓ VSA-T3 passed: DOM presence, layout invariance, and spec registration verified');

console.log('\n===============================================================');
console.log('ALL DVB-S2X I/Q CONSTELLATION & VSA VERIFICATION TESTS PASSED');
console.log('===============================================================\n');
