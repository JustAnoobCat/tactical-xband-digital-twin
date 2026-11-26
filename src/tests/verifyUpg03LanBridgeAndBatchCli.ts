/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Verification Suite 134 (UPG-03): Native Rust Air-Gapped LAN UDP Bridge (ATAK CoT / MAVLink v2)
 * & Multi-Core Headless TDMA/5QI Monte Carlo Batch CLI
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aggregateBatchResults,
  formatBatchCsv,
  runSingleHeadlessTrial,
  type HeadlessTrialResult,
} from '../core/batchSimulationRunner';
import { serializeMissionScenarioJson, type MissionScenarioV3 } from '../core/militaryGisEngine';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(currentDir, '../..');

let passedChecks = 0;

function check(label: string, fn: () => void): void {
  fn();
  passedChecks++;
  console.log(`  ✓ ${label}`);
}

console.log('='.repeat(92));
console.log('  SUITE 134 (UPG-03): AIR-GAPPED LAN UDP BRIDGE & MULTI-CORE HEADLESS BATCH CLI');
console.log('='.repeat(92));

// -----------------------------------------------------------------------------
// [1/4] Headless Trial Determinism & Physics Sensitivity
// -----------------------------------------------------------------------------
console.log('\n[1/4] Verifying runSingleHeadlessTrial 50 Hz Determinism & Physics Sensitivity...');

let baseRunA!: HeadlessTrialResult;
let baseRunB!: HeadlessTrialResult;

check('Two runs with seed=42, durationS=0.6 produce bit-identical state digest & KPIs', () => {
  baseRunA = runSingleHeadlessTrial({ seed: 42, durationS: 0.6 });
  baseRunB = runSingleHeadlessTrial({ seed: 42, durationS: 0.6 });

  assert.equal(baseRunA.ticks, 30, 'durationS=0.6 at 50 Hz must execute 30 ticks');
  assert.equal(baseRunA.biomeId, 'alpine_mountain');
  assert.ok(baseRunA.finalStateDigestHex.startsWith('0x'), 'State digest must be 0x hex string');
  assert.equal(
    baseRunA.finalStateDigestHex,
    baseRunB.finalStateDigestHex,
    'Deterministic seed=42 trials must emit identical finalStateDigestHex'
  );
  assert.equal(baseRunA.staticGoodputMbps, baseRunB.staticGoodputMbps);
  assert.equal(baseRunA.reactiveGoodputMbps, baseRunB.reactiveGoodputMbps);
  assert.equal(baseRunA.tacGoodputMbps, baseRunB.tacGoodputMbps);
  assert.equal(baseRunA.meanSnrDb, baseRunB.meanSnrDb);
  assert.equal(baseRunA.outageRatioPct, baseRunB.outageRatioPct);
});

check('Toggling jammerEnabled=true or rainRateMmH=30 measurably alters RF/KPI output', () => {
  const jammed = runSingleHeadlessTrial({
    seed: 42,
    durationS: 0.6,
    jammerEnabled: true,
  });
  assert.ok(
    jammed.meanSnrDb < baseRunA.meanSnrDb,
    `Jammer must reduce meanSnrDb (${jammed.meanSnrDb.toFixed(3)} < ${baseRunA.meanSnrDb.toFixed(3)})`
  );
  assert.notEqual(
    jammed.finalStateDigestHex,
    baseRunA.finalStateDigestHex,
    'Jammer must alter finalStateDigestHex'
  );

  const rainy = runSingleHeadlessTrial({
    seed: 42,
    durationS: 0.6,
    rainRateMmH: 30.0,
  });
  assert.ok(
    rainy.meanSnrDb < baseRunA.meanSnrDb,
    `Heavy rain (30 mm/h) must reduce meanSnrDb (${rainy.meanSnrDb.toFixed(3)} < ${baseRunA.meanSnrDb.toFixed(3)})`
  );
  assert.notEqual(
    rainy.finalStateDigestHex,
    baseRunA.finalStateDigestHex,
    'Rain attenuation must alter finalStateDigestHex'
  );
});

check('runSingleHeadlessTrial applies MissionScenarioV3 JSON cleanly', () => {
  const scenario: MissionScenarioV3 = {
    schemaVersion: 'xband-dt-scenario-v3',
    title: 'UPG-03 Batch Desert Scenario',
    timestamp: '2026-11-26T00:00:00Z',
    theater: {
      biomeId: 'arid_desert',
      centerLatDeg: 27.0,
      centerLonDeg: 71.5,
    },
    acn: {
      callsign: 'VIPER-01',
      cruiseAltMslM: 4200,
      cruiseAirspeedMs: 55,
      orbitPattern: 'ellipse',
      waypoints: [],
    },
    nodes: [
      { id: 0, callsign: 'S0', role: 'soldier', xM: 500, yM: 500, aglM: 2, tacticalPriority: 1.0 },
      { id: 1, callsign: 'S1', role: 'soldier', xM: -500, yM: 400, aglM: 2, tacticalPriority: 2.0 },
    ],
    obstacles: [],
    rfConfig: {
      rain_rate_mmh: 0,
      jammerEnabled: false,
    },
  };
  const scenarioRes = runSingleHeadlessTrial({
    seed: 7,
    durationS: 0.4,
    scenarioJson: serializeMissionScenarioJson(scenario),
  });
  assert.equal(scenarioRes.biomeId, 'arid_desert');
  assert.equal(scenarioRes.ticks, 20);
  assert.ok(Number.isFinite(scenarioRes.meanSnrDb));
});

// -----------------------------------------------------------------------------
// [2/4] Batch Aggregation & Deterministic CSV Formatting
// -----------------------------------------------------------------------------
console.log('\n[2/4] Verifying aggregateBatchResults & formatBatchCsv...');

check('aggregateBatchResults & formatBatchCsv sort by seed and produce valid statistics', () => {
  const t3 = runSingleHeadlessTrial({ seed: 3, durationS: 0.4 });
  const t1 = runSingleHeadlessTrial({ seed: 1, durationS: 0.4 });
  const t2 = runSingleHeadlessTrial({ seed: 2, durationS: 0.4 });

  const summary = aggregateBatchResults([t3, t1, t2]);
  assert.equal(summary.trialCount, 3);
  assert.deepEqual(summary.seeds, [1, 2, 3], 'Summary seeds must be sorted ascending');
  assert.equal(summary.ticksPerTrial, 20);

  for (const metric of [
    summary.staticGoodputMbps,
    summary.reactiveGoodputMbps,
    summary.tacGoodputMbps,
    summary.staticDropRatePct,
    summary.reactiveDropRatePct,
    summary.tacDropRatePct,
    summary.tacVsStaticGainRatio,
    summary.meanSnrDb,
    summary.outageRatioPct,
    summary.elapsedMs,
  ]) {
    assert.ok(Number.isFinite(metric.mean), 'Summary mean must be finite');
    assert.ok(Number.isFinite(metric.std) && metric.std >= 0, 'Summary std must be finite >= 0');
    assert.ok(
      Number.isFinite(metric.ci95HalfWidth) && metric.ci95HalfWidth >= 0,
      'Summary ci95HalfWidth must be finite >= 0'
    );
  }

  const csvOutOfOrder = formatBatchCsv([t3, t1, t2]);
  const csvInOrder = formatBatchCsv([t1, t2, t3]);
  assert.equal(csvOutOfOrder, csvInOrder, 'CSV output must be deterministic regardless of completion order');

  const lines = csvOutOfOrder.trim().split('\n');
  assert.equal(lines.length, 4, 'CSV must contain 1 header + 3 trial rows');
  const headerCols = lines[0].split(',');
  assert.equal(headerCols[0], 'seed');
  assert.equal(lines[1].split(',')[0], '1');
  assert.equal(lines[2].split(',')[0], '2');
  assert.equal(lines[3].split(',')[0], '3');
});

// -----------------------------------------------------------------------------
// [3/4] Multi-Core Worker Threads CLI Parity (--workers 1 vs --workers 2)
// -----------------------------------------------------------------------------
console.log('\n[3/4] Verifying Multi-Core stratos_cli.ts Parity (--workers 1 vs --workers 2)...');

check('stratos_cli.ts --workers 2 and --workers 1 produce bit-identical digests and CSV', () => {
  const tmpCsv1 = path.join(os.tmpdir(), `stratos-upg03-w1-${process.pid}.csv`);
  const tmpCsv2 = path.join(os.tmpdir(), `stratos-upg03-w2-${process.pid}.csv`);

  try {
    const outW1 = execFileSync(
      'npx',
      ['tsx', 'scripts/stratos_cli.ts', '--seeds', '4', '--duration', '0.4', '--workers', '1', '--out', tmpCsv1, '--json'],
      { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const outW2 = execFileSync(
      'npx',
      ['tsx', 'scripts/stratos_cli.ts', '--seeds', '4', '--duration', '0.4', '--workers', '2', '--out', tmpCsv2, '--json'],
      { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );

    const parsed1 = JSON.parse(outW1) as { summary: { seeds: number[] }; trials: HeadlessTrialResult[] };
    const parsed2 = JSON.parse(outW2) as { summary: { seeds: number[] }; trials: HeadlessTrialResult[] };

    assert.equal(parsed1.trials.length, 4, '--workers 1 must return 4 trials');
    assert.equal(parsed2.trials.length, 4, '--workers 2 must return 4 trials');
    assert.deepEqual(
      parsed1.trials.map((t) => t.seed),
      [1, 2, 3, 4],
      '--workers 1 trials must be sorted [1, 2, 3, 4]'
    );
    assert.deepEqual(
      parsed2.trials.map((t) => t.seed),
      [1, 2, 3, 4],
      '--workers 2 trials must be sorted [1, 2, 3, 4]'
    );

    for (let i = 0; i < 4; i++) {
      assert.equal(
        parsed2.trials[i].finalStateDigestHex,
        parsed1.trials[i].finalStateDigestHex,
        `Seed ${i + 1} digest mismatch between --workers 1 and --workers 2`
      );
      assert.equal(parsed2.trials[i].tacGoodputMbps, parsed1.trials[i].tacGoodputMbps);
      assert.equal(parsed2.trials[i].staticGoodputMbps, parsed1.trials[i].staticGoodputMbps);
      assert.equal(parsed2.trials[i].meanSnrDb, parsed1.trials[i].meanSnrDb);
    }

    const csv1 = fs.readFileSync(tmpCsv1, 'utf8');
    const csv2 = fs.readFileSync(tmpCsv2, 'utf8');
    assert.equal(csv2, csv1, 'CSV output must be bit-identical between --workers 1 and --workers 2');
  } finally {
    try { fs.unlinkSync(tmpCsv1); } catch {}
    try { fs.unlinkSync(tmpCsv2); } catch {}
  }
});

// -----------------------------------------------------------------------------
// [4/4] Static Security Audit of Rust Air-Gapped LAN Bridge & Tauri IPC
// -----------------------------------------------------------------------------
console.log('\n[4/4] Auditing src-tauri/src/lan_bridge.rs & src-tauri/src/lib.rs Security Invariants...');

check('lan_bridge.rs enforces private-IP allowlist, TTL=1 multicast, MAVLink v2 0xFD CRC-16, and no background threads', () => {
  const lanBridgePath = path.join(ROOT_DIR, 'src-tauri/src/lan_bridge.rs');
  assert.equal(fs.existsSync(lanBridgePath), true, 'src-tauri/src/lan_bridge.rs must exist');
  const lanRs = fs.readFileSync(lanBridgePath, 'utf8');

  assert.ok(lanRs.includes('pub fn is_allowed_airgap_ip'), 'Must export is_allowed_airgap_ip');
  assert.ok(lanRs.includes('pub fn validate_airgap_udp_target'), 'Must export validate_airgap_udp_target');
  assert.ok(lanRs.includes('is_loopback()'), 'Must check IPv4/IPv6 loopback');
  assert.ok(lanRs.includes('is_private()'), 'Must check RFC 1918 private IPv4 ranges');
  assert.ok(lanRs.includes('is_link_local()'), 'Must check RFC 3927 link-local IPv4');
  assert.ok(lanRs.includes('is_multicast()'), 'Must check IPv4 multicast range');
  assert.ok(lanRs.includes('0xfe00') && lanRs.includes('0xfc00'), 'Must check IPv6 fc00::/7 ULA');
  assert.ok(lanRs.includes('0xffc0') && lanRs.includes('0xfe80'), 'Must check IPv6 fe80::/10 link-local');
  assert.ok(lanRs.includes('1024'), 'Must enforce unprivileged port >= 1024');
  assert.ok(lanRs.includes('set_multicast_ttl_v4(1)'), 'Must lock IPv4 multicast TTL to 1');
  assert.ok(lanRs.includes('0xFD'), 'Must frame MAVLink v2 STX 0xFD');
  assert.ok(lanRs.includes('33'), 'Must encode GLOBAL_POSITION_INT message ID 33');
  assert.ok(lanRs.includes('104'), 'Must apply GLOBAL_POSITION_INT CRC_EXTRA = 104');
  assert.equal(/\bstd::thread::spawn\b/.test(lanRs), false, 'Must NEVER spawn background transmit threads');
});

check('lib.rs registers mod lan_bridge and exposes send_atak_cot_udp & send_mavlink_telemetry_udp commands', () => {
  const libPath = path.join(ROOT_DIR, 'src-tauri/src/lib.rs');
  const libRs = fs.readFileSync(libPath, 'utf8');

  assert.ok(libRs.includes('mod lan_bridge;'), 'lib.rs must register mod lan_bridge');
  assert.ok(libRs.includes('send_atak_cot_udp'), 'lib.rs must expose send_atak_cot_udp');
  assert.ok(libRs.includes('send_mavlink_telemetry_udp'), 'lib.rs must expose send_mavlink_telemetry_udp');
});

console.log('\n' + '='.repeat(92));
console.log(`  SUITE 134 SUMMARY: ${passedChecks}/7 checks passed, 0 failures.`);
console.log('='.repeat(92) + '\n');
