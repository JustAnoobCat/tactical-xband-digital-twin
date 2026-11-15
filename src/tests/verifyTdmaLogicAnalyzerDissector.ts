/**
 * src/tests/verifyTdmaLogicAnalyzerDissector.ts
 *
 * Verification suite for:
 * SPEC-TDMA-LOGIC-ANALYZER-PDU-DISSECTOR: Saleae Logic 2 Timing Analyzer &
 * Wireshark Layer-1/Layer-2 X-Band MAC PDU Frame Dissector.
 *
 * Checks:
 * - TLA-T1: Exact Bit Conservation & Timing Advance Speed-of-Light Calculation
 * - TLA-T2: Outage / Pre-Occlusion Delivery Classification & Hex Header Determinism
 * - TLA-T3: DOM Elements in #tab-scheduler & Specification Artifact Registration
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  dissectTdmaSlotAllocation,
  computeCrc32,
  SPEED_OF_LIGHT_M_S,
} from '../core/pduDissector.js';

console.log('--- RUNNING TDMA LOGIC ANALYZER & PDU DISSECTOR VERIFICATION ---');

// ============================================================================
// TLA-T1: Exact Bit Conservation & Speed-of-Light Timing Advance
// ============================================================================
console.log('\n[TLA-T1] Testing Exact Bit Conservation and Timing Advance...');

const testCases = [
  { capacityBits: 0, q_c2: 0, q_voice: 0, q_video: 0, q_photo: 0, slantRangeM: 10000 },
  { capacityBits: 256, q_c2: 50, q_voice: 0, q_video: 0, q_photo: 0, slantRangeM: 15000 },
  { capacityBits: 512, q_c2: 100, q_voice: 100, q_video: 0, q_photo: 0, slantRangeM: 20000 },
  { capacityBits: 4096, q_c2: 20, q_voice: 50, q_video: 200, q_photo: 1000, slantRangeM: 28450 },
  { capacityBits: 100000, q_c2: 500, q_voice: 1500, q_video: 8000, q_photo: 20000, slantRangeM: 45000 },
  { capacityBits: 1337, q_c2: 0, q_voice: 0, q_video: 0, q_photo: 0, slantRangeM: 33333 },
];

for (const tc of testCases) {
  const pdu = dissectTdmaSlotAllocation({
    nodeId: 3,
    sectorId: 1,
    slotStartS: 0.005,
    durationS: 0.002,
    modcodName: '16APSK 3/4',
    spectralEfficiency: 2.966,
    capacityBits: tc.capacityBits,
    isPreOcclusionFlush: false,
  }, 'Tac-TAD', {
    q_c2: tc.q_c2,
    q_voice: tc.q_voice,
    q_video: tc.q_video,
    q_photo: tc.q_photo,
    slant_range_m: tc.slantRangeM,
    snr_db: 18.5,
    is_outage: false,
  });

  // Verify Exact Bit Conservation
  const sumBits = pdu.framingOverheadBits + pdu.c2Bits + pdu.voiceBits + pdu.videoBits + pdu.photoBits + pdu.paddingBits;
  assert.equal(
    sumBits,
    pdu.totalCapacityBits,
    `Exact bit conservation violated: sum=${sumBits} vs total=${pdu.totalCapacityBits}`
  );

  // Verify Timing Advance Speed-of-Light Calculation
  const expectedTaUs = ((2.0 * tc.slantRangeM) / SPEED_OF_LIGHT_M_S) * 1e6;
  assert.ok(
    Math.abs(pdu.timingAdvanceUs - expectedTaUs) < 1e-6,
    `Timing advance mismatch: got ${pdu.timingAdvanceUs}, expected ${expectedTaUs}`
  );
}

// Check with explicit timingAdvanceS
const pduExplicitTa = dissectTdmaSlotAllocation({
  nodeId: 2,
  sectorId: 0,
  slotStartS: 0.002,
  durationS: 0.001,
  timingAdvanceS: 0.00018, // 180 us
  capacityBits: 2000,
}, 'Static', { slant_range_m: 50000 });
assert.equal(pduExplicitTa.timingAdvanceUs, 180.0, 'Explicit timing advance must be used when provided');

console.log('  ✓ TLA-T1 passed: Exact bit conservation and speed-of-light timing advance verified');

// ============================================================================
// TLA-T2: Outage vs Pre-Occlusion Classification & Hex Header Determinism
// ============================================================================
console.log('\n[TLA-T2] Testing Outage/Pre-Occlusion Classification & Hex Header...');

// 1. Outage slot
const pduOutage = dissectTdmaSlotAllocation({
  nodeId: 4,
  sectorId: 2,
  capacityBits: 5000,
}, 'Static', {
  is_outage: true,
  snr_db: -6.0,
});
assert.equal(pduOutage.deliveryStatus, 'OUTAGE_WASTED_BURST', 'Outage slot must yield OUTAGE_WASTED_BURST');
assert.equal(pduOutage.wastedBits, 5000, 'Wasted bits must equal totalCapacityBits during outage');
assert.equal(pduOutage.deliveredBits, 0, 'Delivered bits must be 0 during outage');

// 2. Pre-Occlusion Flush slot
const pduPreEvac = dissectTdmaSlotAllocation({
  nodeId: 4,
  sectorId: 2,
  capacityBits: 8000,
  isPreOcclusionFlush: true,
}, 'Tac-TAD', {
  is_outage: false,
  snr_db: 14.0,
});
assert.equal(pduPreEvac.deliveryStatus, 'PRE_OCCLUSION_EVAC_BURST', 'Pre-occlusion flush must yield PRE_OCCLUSION_EVAC_BURST');
assert.equal(pduPreEvac.wastedBits, 0);
assert.equal(pduPreEvac.deliveredBits, 8000);

// 3. Nominal Delivered Burst
const pduNominal = dissectTdmaSlotAllocation({
  nodeId: 1,
  sectorId: 0,
  capacityBits: 12000,
  isPreOcclusionFlush: false,
}, 'Tac-TAD', {
  is_outage: false,
  snr_db: 22.0,
});
assert.equal(pduNominal.deliveryStatus, 'NOMINAL_DELIVERED_BURST');
assert.equal(pduNominal.deliveredBits, 12000);

// 4. Hex header dump format & determinism
assert.ok(pduNominal.hexHeaderDump.startsWith('58 42'), 'Header must start with 58 42 (XB sync word)');
assert.ok(pduNominal.hexHeaderDump.includes('[SYNC:XB | SEC:S0 | NID:1 | CRC32:OK]'), 'Header must contain decode summary');

// Test determinism over multiple calls
const pduNominal2 = dissectTdmaSlotAllocation({
  nodeId: 1,
  sectorId: 0,
  capacityBits: 12000,
  isPreOcclusionFlush: false,
}, 'Tac-TAD', {
  is_outage: false,
  snr_db: 22.0,
});
assert.equal(pduNominal.hexHeaderDump, pduNominal2.hexHeaderDump, 'Hex header dump must be 100% deterministic');

// Test CRC32 function
const testCrc = computeCrc32([0x58, 0x42, 0x00, 0x01]);
assert.ok(typeof testCrc === 'number' && testCrc > 0, 'CRC-32 must compute positive 32-bit unsigned integer');

console.log('  ✓ TLA-T2 passed: Delivery status classification and deterministic hex header verified');

// ============================================================================
// TLA-T3: DOM Elements & Specification Artifact Registration
// ============================================================================
console.log('\n[TLA-T3] Testing DOM Elements and Specification Registration...');

// 1. Check specification file exists on disk
const specPath = resolve(process.cwd(), 'docs/specs/SPEC-TDMA-LOGIC-ANALYZER-PDU-DISSECTOR.md');
assert.ok(existsSync(specPath), 'SPEC-TDMA-LOGIC-ANALYZER-PDU-DISSECTOR.md must exist on disk');
const specContent = readFileSync(specPath, 'utf-8');
assert.ok(
  specContent.includes('SPEC-TDMA-LOGIC-ANALYZER-PDU-DISSECTOR'),
  'Specification must contain identifier'
);
assert.ok(
  specContent.includes('APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)'),
  'Specification must contain reviewer sign-off'
);

// 2. Check README.md links specification in Section 7
const readmeContent = readFileSync(resolve(process.cwd(), 'README.md'), 'utf-8');
assert.ok(
  readmeContent.includes('SPEC-TDMA-LOGIC-ANALYZER-PDU-DISSECTOR.md'),
  'README.md must link to SPEC-TDMA-LOGIC-ANALYZER-PDU-DISSECTOR.md in Section 7'
);

// 3. Check required DOM elements in index.html inside #tab-scheduler
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');
const tabSchedulerIdx = indexHtml.indexOf('id="tab-scheduler"');
assert.ok(tabSchedulerIdx > 0, '#tab-scheduler must exist in index.html');
const tabSchedulerEndIdx = indexHtml.indexOf('</section>', tabSchedulerIdx);
const tabSchedulerHtml = indexHtml.slice(tabSchedulerIdx, tabSchedulerEndIdx);

const requiredIds = [
  'pdu-dissector-panel',
  'btn-pdu-auto-follow',
  'pdu-byte-bar',
  'pdu-layer1-phy',
  'pdu-layer2-mac',
  'pdu-hex-dump',
];

for (const id of requiredIds) {
  assert.ok(
    tabSchedulerHtml.includes(`id="${id}"`),
    `DOM element #${id} must exist inside #tab-scheduler in index.html`
  );
}

console.log('  ✓ TLA-T3 passed: DOM presence and specification registration verified');

console.log('\n===============================================================');
console.log('ALL TDMA LOGIC ANALYZER & PDU DISSECTOR VERIFICATION TESTS PASSED');
console.log('===============================================================\n');
