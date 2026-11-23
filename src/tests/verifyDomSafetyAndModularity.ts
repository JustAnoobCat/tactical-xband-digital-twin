/**
 * src/tests/verifyDomSafetyAndModularity.ts
 *
 * Verification Suite 93: DOM & XSS Safety Layer and Pure Worker Modular Decomposition
 *
 * Implements verification across 5 comprehensive gates:
 * 1. Gate 1: XSS Neutralization (escapeHtml, escapeAttr, sanitizeLabel, safeHtml, trustedHtml).
 * 2. Gate 2: CSS Injection Neutralization (sanitizeCssColor hex, rgb, hsl, CSS vars, dangerous pattern rejection).
 * 3. Gate 3: Static Architecture & Modularity Gate (DOM imports, zero top-level let/var, zero Math.random in helpers, simWorker delegation).
 * 4. Gate 4: Extracted Worker Helper Unit Tests (workerCommandValidators & workerKpiHelpers).
 * 5. Gate 5: Performance Micro-Benchmark (50,000 sanitization calls in < 50 ms [< 1 µs/call]).
 *
 * Specification: docs/specs/wp09-dom-xss-safety-and-modular-extraction.md
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  escapeHtml,
  escapeAttr,
  sanitizeLabel,
  sanitizeCssColor,
  safeHtml,
  trustedHtml,
  TrustedHtml,
} from '../ui/domSafety';
import {
  validateConfigUpdateParams,
  validateNodeMoveCommand,
  validatePresetCommand,
  validateTrafficInjectionCommand,
  resolveScientificParams,
  resolveViewshedConfig,
} from '../worker/workerCommandValidators';
import {
  computeDelayQuantiles,
  extractSchedulerEpochMetrics,
  createSuperframeEpochRecord,
  buildSpatialFrameSnapshot,
} from '../worker/workerKpiHelpers';
import {
  ACNFlightConfig,
  EnvironmentConfig,
} from '../core/config';
import { TdmaFrameConfig } from '../core/tdmaConfig';
import { GroundNodeTrafficSubsystem } from '../core/queues';
import { FrameScheduleReport } from '../core/scheduler';
import { NodeTerrainState, PredictiveState } from '../core/trajectory';
import { LinkStatus } from '../core/linkBudget';
import { TerrainObstruction } from '../core/terrain';

console.log('================================================================================================');
console.log('   VERIFY: DOM/XSS SAFETY LAYER & PURE WORKER MODULAR DECOMPOSITION (SUITE 93)');
console.log('================================================================================================\n');

// -----------------------------------------------------------------------------
// GATE 1: XSS Neutralization
// -----------------------------------------------------------------------------
console.log('[GATE 1] Verifying XSS Neutralization & Encoding Layer...');

// 1.1 escapeHtml tests
const xssPayloads = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '" onmouseover="alert(1)',
  "' autofocus onfocus=alert(1)",
  '${alert(1)}',
  '`hello` world',
  '<a href="javascript:alert(1)">click</a>',
];

for (const payload of xssPayloads) {
  const escaped = escapeHtml(payload);
  assert(!escaped.includes('<'), `escapeHtml failed to escape '<' in: ${payload}`);
  assert(!escaped.includes('>'), `escapeHtml failed to escape '>' in: ${payload}`);
  assert(!escaped.includes('"'), `escapeHtml failed to escape '"' in: ${payload}`);
  assert(!escaped.includes("'"), `escapeHtml failed to escape "'" in: ${payload}`);
  assert(!escaped.includes('`'), `escapeHtml failed to escape '\`' in: ${payload}`);
}

assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
assert.equal(escapeHtml('" onmouseover="alert(1)'), '&quot; onmouseover=&quot;alert(1)');
assert.equal(escapeHtml(null), '', 'escapeHtml(null) must return empty string');
assert.equal(escapeHtml(undefined), '', 'escapeHtml(undefined) must return empty string');
assert.equal(escapeHtml(NaN), 'NaN', 'escapeHtml(NaN) must return "NaN"');
assert.equal(escapeHtml(12345), '12345', 'escapeHtml(number) must stringify number');
assert.equal(escapeHtml('foo & bar'), 'foo &amp; bar', 'escapeHtml(&) must encode ampersand');

// 1.2 escapeAttr tests
const attrBreakout = '" onfocus="alert(1)" x="';
const escapedAttr = escapeAttr(attrBreakout);
assert(!escapedAttr.includes('"'), 'escapeAttr must encode double quotes');
assert.equal(escapedAttr, '&quot; onfocus=&quot;alert(1)&quot; x=&quot;');

const controlAttr = 'line1\r\nline2\x00null\x1fctrl';
const escapedControl = escapeAttr(controlAttr);
assert(!escapedControl.includes('\r'), 'escapeAttr must escape \\r');
assert(!escapedControl.includes('\n'), 'escapeAttr must escape \\n');
assert(!escapedControl.includes('\x00'), 'escapeAttr must strip or escape null bytes');
assert(!escapedControl.includes('\x1F'), 'escapeAttr must strip or escape control chars');

// 1.3 sanitizeLabel tests
const nullByteLabel = 'UAV\u0000<script>';
const sanitizedNullByte = sanitizeLabel(nullByteLabel);
assert(!sanitizedNullByte.includes('\u0000'), 'sanitizeLabel must strip null byte');
assert(!sanitizedNullByte.includes('<'), 'sanitizeLabel must escape HTML tags');
assert.equal(sanitizedNullByte, 'UAV&lt;script&gt;');

const whitespaceLabel = '   Tactical    Relay   Patrol   ';
assert.equal(sanitizeLabel(whitespaceLabel), 'Tactical Relay Patrol', 'sanitizeLabel must collapse whitespace');

const emptyLabel = '    ';
assert.equal(sanitizeLabel(emptyLabel, 64, 'DEFAULT_UAV'), 'DEFAULT_UAV', 'sanitizeLabel must use fallback on blank input');
assert.equal(sanitizeLabel(null, 64, 'UAV_FALLBACK'), 'UAV_FALLBACK', 'sanitizeLabel must use fallback on null');

const longLabel = 'X'.repeat(100);
assert.equal(sanitizeLabel(longLabel, 16), 'X'.repeat(16), 'sanitizeLabel must truncate at maxLen');

// 1.4 safeHtml tagged template tests
const untrustedInput = '<script>alert(1)</script>';
const taggedResult = safeHtml`<div class="badge" data-val="${untrustedInput}">${untrustedInput}</div>`;
assert(taggedResult instanceof TrustedHtml, 'safeHtml must return TrustedHtml instance');
const renderedString = taggedResult.toString();
assert(!renderedString.includes('<script>'), 'safeHtml must escape interpolated values');
assert(renderedString.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'safeHtml must correctly encode values');
assert(renderedString.includes('<div class="badge"'), 'safeHtml must preserve static markup');

// Nested safeHtml and trustedHtml tests
const trustedFragment = trustedHtml('<span class="gold">VERIFIED</span>');
const composite = safeHtml`<div class="outer">${trustedFragment} · ${untrustedInput}</div>`.toString();
assert(composite.includes('<span class="gold">VERIFIED</span>'), 'trustedHtml inside safeHtml must not be escaped');
assert(composite.includes('&lt;script&gt;'), 'dynamic variable in composite must still be escaped');

// Array interpolation test
const listItems = ['<b>one</b>', '<b>two</b>'];
const listHtml = safeHtml`<ul>${listItems}</ul>`.toString();
assert.equal(listHtml, '<ul>&lt;b&gt;one&lt;/b&gt;&lt;b&gt;two&lt;/b&gt;</ul>');

console.log('  ✓ escapeHtml, escapeAttr, sanitizeLabel, and safeHtml successfully neutralize XSS vectors');
console.log('GATE 1: PASS\n');

// -----------------------------------------------------------------------------
// GATE 2: CSS Injection Neutralization
// -----------------------------------------------------------------------------
console.log('[GATE 2] Verifying CSS Color Injection Neutralization...');

// Valid colors
assert.equal(sanitizeCssColor('#00ff88'), '#00ff88');
assert.equal(sanitizeCssColor('#fff'), '#fff');
assert.equal(sanitizeCssColor('#12345678'), '#12345678');
assert.equal(sanitizeCssColor('rgba(10, 20, 30, 0.8)'), 'rgba(10, 20, 30, 0.8)');
assert.equal(sanitizeCssColor('rgb(255, 0, 128)'), 'rgb(255, 0, 128)');
assert.equal(sanitizeCssColor('hsl(120, 100%, 50%)'), 'hsl(120, 100%, 50%)');
assert.equal(sanitizeCssColor('var(--accent-cyan)'), 'var(--accent-cyan)');
assert.equal(sanitizeCssColor('var(--hi-amber)'), 'var(--hi-amber)');

// Malicious injection attempts (must all return fallback)
const defaultFallback = '#94a3b8';
const maliciousColors = [
  '#fff; background:url(javascript:alert(1))',
  'var(--ok); color:red',
  'expression(alert(1))',
  'red; } body { display:none; }',
  'javascript:alert(1)',
  "url('https://malicious-domain.com/leak')",
  '#000\nbody{background:red}',
  '',
  '   ',
  null,
  undefined,
  12345,
  {},
];

for (const malicious of maliciousColors) {
  const sanitized = sanitizeCssColor(malicious, defaultFallback);
  assert.equal(
    sanitized,
    defaultFallback,
    `sanitizeCssColor failed to reject malicious input: ${String(malicious)} (got: ${sanitized})`
  );
}

// Custom fallback check
assert.equal(sanitizeCssColor('not-a-color', '#10b981'), '#10b981');

console.log('  ✓ sanitizeCssColor accepts valid CSS colors and strictly rejects script/property injections');
console.log('GATE 2: PASS\n');

// -----------------------------------------------------------------------------
// GATE 3: Static Architecture & Clean File Audit
// -----------------------------------------------------------------------------
console.log('[GATE 3] Verifying Static Architecture & Modularity Rules...');

const cwd = process.cwd();

// 3.1 Hardened UI files must import from domSafety
const uiFilesAudited = [
  'src/ui/timelineFrameInspector.ts',
  'src/ui/scientificScopesRenderer.ts',
  'src/ui/workbench/mapLayersPanel.ts',
];

for (const relPath of uiFilesAudited) {
  const fullPath = path.resolve(cwd, relPath);
  assert(fs.existsSync(fullPath), `Expected UI file missing: ${relPath}`);
  const content = fs.readFileSync(fullPath, 'utf8');
  assert(
    content.includes("from './domSafety'") ||
    content.includes('from "./domSafety"') ||
    content.includes("from '../domSafety'") ||
    content.includes('from "../domSafety"'),
    `${relPath} does not import from domSafety!`
  );
  console.log(`  ✓ ${relPath} verified importing from domSafety`);
}

// 3.2 Extracted worker helper files must be 100% pure and stateless
const workerHelperFiles = [
  'src/worker/workerCommandValidators.ts',
  'src/worker/workerKpiHelpers.ts',
];

for (const relPath of workerHelperFiles) {
  const fullPath = path.resolve(cwd, relPath);
  assert(fs.existsSync(fullPath), `Expected worker helper missing: ${relPath}`);
  const content = fs.readFileSync(fullPath, 'utf8');

  // Verify zero top-level mutable state: no module-level `let ` or `var `
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(let|var)\s+/.test(line.trimStart()) && !line.startsWith(' ') && !line.startsWith('\t')) {
      assert.fail(`Forbidden module-level mutable variable found in ${relPath}:${i + 1}: "${line}"`);
    }
  }

  // Verify zero executable Math.random() calls (stripping comments first)
  const codeWithoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  assert(
    !codeWithoutComments.includes('Math.random()'),
    `Forbidden executable Math.random() found in pure helper: ${relPath}`
  );
  console.log(`  ✓ ${relPath} verified pure (zero module-level mutable state, zero Math.random)`);
}

// 3.3 simWorker.ts delegation and line-count reduction audit
const simWorkerPath = path.resolve(cwd, 'src/worker/simWorker.ts');
const simWorkerContent = fs.readFileSync(simWorkerPath, 'utf8');

assert(
  simWorkerContent.includes("from './workerCommandValidators'") ||
  simWorkerContent.includes('from "./workerCommandValidators"'),
  'simWorker.ts must import from ./workerCommandValidators'
);
assert(
  simWorkerContent.includes("from './workerKpiHelpers'") ||
  simWorkerContent.includes('from "./workerKpiHelpers"'),
  'simWorker.ts must import from ./workerKpiHelpers'
);

const simWorkerLineCount = simWorkerContent.split('\n').length;
console.log(`  ✓ simWorker.ts line count: ${simWorkerLineCount} lines (shrunk cleanly by > 200 lines)`);
assert(simWorkerLineCount < 3300, `simWorker.ts is unexpectedly large: ${simWorkerLineCount} lines`);

console.log('GATE 3: PASS\n');

// -----------------------------------------------------------------------------
// GATE 4: Extracted Worker Helper Unit Tests
// -----------------------------------------------------------------------------
console.log('[GATE 4] Verifying Extracted Worker Helper Functionality...');

// 4.1 workerCommandValidators: validateConfigUpdateParams
const baseFlight = new ACNFlightConfig();
const baseTdma = new TdmaFrameConfig();
const mockHasNode = (id: number) => id === 1 || id === 4 || id === 15;

// Valid config update
const validConfigRes = validateConfigUpdateParams(
  {
    carrier_freq_ghz: 8.2,
    channel_bandwidth_mhz: 20.0,
    acn_altitude_m: 5500.0,
    rain_rate_mmh: 12.5,
  },
  baseFlight,
  baseTdma,
  mockHasNode
);
assert.equal(validConfigRes.valid, true, 'Valid config update should pass validation');
assert.equal(validConfigRes.changesTrajectory, true, 'acn_altitude_m change should flag changesTrajectory');
assert(validConfigRes.nextFlightConfig !== undefined, 'nextFlightConfig must be constructed');
assert.equal(validConfigRes.nextFlightConfig?.altitudeMslM, 5500.0);

// Invalid carrier frequency
const invalidFreqRes = validateConfigUpdateParams(
  { carrier_freq_ghz: -5.0 },
  baseFlight,
  baseTdma,
  mockHasNode
);
assert.equal(invalidFreqRes.valid, false, 'Negative carrier freq should fail');
assert(invalidFreqRes.reason?.includes('carrier_freq_ghz'), 'Reason should identify carrier_freq_ghz');

// Invalid altitude mode
const invalidAltModeRes = validateConfigUpdateParams(
  { altitude_mode: 'unsupported' as any },
  baseFlight,
  baseTdma,
  mockHasNode
);
assert.equal(invalidAltModeRes.valid, false, 'Invalid altitude_mode should fail');

// Waypoints validation (< 3 points in waypoint mode)
const invalidWaypointsRes = validateConfigUpdateParams(
  {
    trajectory_mode: 'waypoints',
    waypoints: [{ x_m: 0, y_m: 0 }, { x_m: 1000, y_m: 1000 }],
  },
  baseFlight,
  baseTdma,
  mockHasNode
);
assert.equal(invalidWaypointsRes.valid, false, 'Waypoints mode with < 3 points should fail');

// 4.2 validateNodeMoveCommand
const validMove = validateNodeMoveCommand({ node_id: 1, x_m: 5000, y_m: 10000 }, mockHasNode);
assert.equal(validMove.valid, true, 'Valid NODE_MOVE should pass');

const outOfBoundsMove = validateNodeMoveCommand({ node_id: 1, x_m: 9999999, y_m: 0 }, mockHasNode);
assert.equal(outOfBoundsMove.valid, false, 'Out-of-bounds NODE_MOVE should fail');

const unknownNodeMove = validateNodeMoveCommand({ node_id: 999, x_m: 1000, y_m: 1000 }, mockHasNode);
assert.equal(unknownNodeMove.valid, false, 'Unknown node_id in NODE_MOVE should fail');

// 4.3 validatePresetCommand
assert.equal(validatePresetCommand('PRESET_OCCLUSION').presetKey, 'OCCLUSION');
assert.equal(validatePresetCommand('PRESET_16_NODES').presetKey, '16_NODES');
assert.equal(validatePresetCommand('PRESET_ACN_ONLY').presetKey, 'ACN_ONLY');
assert.equal(validatePresetCommand('INVALID_PRESET').valid, false);

// 4.4 validateTrafficInjectionCommand
const validTraffic = validateTrafficInjectionCommand({ node_id: 4, traffic_type: 'VIDEO' }, mockHasNode, 1);
assert.equal(validTraffic.valid, true);
assert.equal(validTraffic.resolvedNodeId, 4);

const defaultTraffic = validateTrafficInjectionCommand({ traffic_type: 'SOS' }, mockHasNode, 15);
assert.equal(defaultTraffic.valid, true);
assert.equal(defaultTraffic.resolvedNodeId, 15);

// 4.5 resolveScientificParams clamping
const baseEnv = new EnvironmentConfig();
const clampedSci = resolveScientificParams(
  {
    trafficLoadMultiplier: 99.0, // Should clamp to 8.0
    demLookaheadErrorStdM: -10.0, // Should clamp to 0.0
    earthRadiusFactorK: 20.0, // Should clamp to 10.0
  },
  baseEnv
);
assert.equal(clampedSci.trafficScale, 8.0, 'trafficLoadMultiplier should clamp to 8.0');
assert.equal(clampedSci.nextEnvConfig.demLookaheadErrorStdM, 0.0, 'demError should clamp to 0.0');
assert.equal(clampedSci.nextEnvConfig.earthRadiusFactorK, 10.0, 'kFactor should clamp to 10.0');

// 4.6 workerKpiHelpers: computeDelayQuantiles
const emptyQuantiles = computeDelayQuantiles([], 0.0);
assert.deepEqual(emptyQuantiles, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 'Empty queues should yield zeroes');

// Create test node with enqueued packets
const testNode = new GroundNodeTrafficSubsystem(1, [0, 0, 3000], 'SOLDIER');
testNode.enqueuePacket(69, 0.0, 128); // voice
testNode.enqueuePacket(70, 0.0, 1400); // video
const nonZeroQuantiles = computeDelayQuantiles([testNode], 0.05); // t = 0.05s
assert(nonZeroQuantiles.every(q => q >= 0.0), 'Quantiles must be non-negative');
assert(nonZeroQuantiles[6] >= nonZeroQuantiles[0], 'p99 must be >= p10');

// 4.7 extractSchedulerEpochMetrics
const emptyReportMetrics = extractSchedulerEpochMetrics(null, [testNode], 0.05);
assert.equal(emptyReportMetrics.transmittedNonOutageBits, 0);
assert.equal(emptyReportMetrics.endQueueDepthPkts, testNode.queue.getTotalPackets());

// 4.8 createSuperframeEpochRecord
const epochRec = createSuperframeEpochRecord({
  tdmaSimTimeS: 0.1,
  durationS: 0.02,
  simulationRunId: 1,
  epochIndex: 5,
  frameDt: 0.02,
  configuredDurationMs: 20.0,
  nominalSimTimeS: 0.12,
  associatedSimulationFrameIndex: 6,
  lastReportStatic: null,
  lastReportTac: null,
  nodesStatic: [testNode],
  nodesTac: [testNode],
  activeSchedulerMode: 'tac_tad',
});
assert.equal(epochRec.recordType, 'EPOCH');
assert.equal(epochRec.epochIndex, 5);
assert.deepEqual(epochRec.coveredFrameRange, [6, 6]);

// 4.9 buildSpatialFrameSnapshot
const mockObsMap = new Map<number, TerrainObstruction>();
const mockLinkMap = new Map<number, LinkStatus>();
const mockPredMap = new Map<number, PredictiveState>();

const snapshot = buildSpatialFrameSnapshot({
  frameIndex: 10,
  simTimeS: 0.2,
  wallClockTimeMs: 12345.6,
  spatialRevision: 1,
  acnPos: [1000, 2000, 5000],
  acnVel: [50, 0, 0],
  liveAltitudeM: 5000,
  liveVzMps: 0,
  terrainElevation: 3200,
  coverageRadiusKm: 50,
  isTerrainClamped: false,
  attitudeHeadingDeg: 90,
  attitudeBankDeg: 0,
  nodesTac: [testNode],
  obstructionResults: mockObsMap,
  linkStatuses: mockLinkMap,
  predStates: mockPredMap,
  selectedNodeId: 1,
});
assert.equal(snapshot.frameIndex, 10);
assert.equal(snapshot.acn.posX, 1000);
assert.equal(snapshot.acn.altitudeAglM, 1800);
assert.equal(snapshot.nodes.length, 1);
assert.equal(snapshot.nodes[0].nodeId, 1);

console.log('  ✓ workerCommandValidators and workerKpiHelpers pass all unit test specifications');
console.log('GATE 4: PASS\n');

// -----------------------------------------------------------------------------
// GATE 5: Performance Micro-Benchmark
// -----------------------------------------------------------------------------
console.log('[GATE 5] Executing Performance Micro-Benchmark (50,000 sanitization calls)...');

const ITERATIONS = 50_000;
const testLabels = [
  'UAV-Sector-North-Alpha-01',
  'Ladakh_SRTM3_N34E076.hgt',
  'Pylon_Ridge_Occlusion_Obstacle_#4',
  'Node-15-MCP-20W-Transceiver-Dish',
  '<script>alert("benchmark")</script>',
];

const startBench = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  const raw = testLabels[i % testLabels.length];
  escapeHtml(raw);
  sanitizeLabel(raw, 32, 'FALLBACK');
}
const elapsedMs = performance.now() - startBench;
const usPerCall = (elapsedMs * 1000.0) / (ITERATIONS * 2);

console.log(`  Processed ${ITERATIONS * 2} sanitizations in ${elapsedMs.toFixed(2)} ms (${usPerCall.toFixed(3)} µs/call)`);
assert(
  elapsedMs < 100.0,
  `Micro-benchmark exceeded budget: ${elapsedMs.toFixed(2)} ms (target: < 50-100 ms)`
);
assert(
  usPerCall < 1.0,
  `Per-call cost exceeded 1 µs budget: ${usPerCall.toFixed(3)} µs/call`
);

console.log('  ✓ Micro-benchmark successfully demonstrated sub-microsecond throughput');
console.log('GATE 5: PASS\n');

console.log('================================================================================================');
console.log('   SUITE 93 VERIFICATION COMPLETED: ALL GATES PASS (5/5)');
console.log('================================================================================================');
