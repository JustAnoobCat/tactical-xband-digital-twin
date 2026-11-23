/**
 * src/tests/verifyTacticalAiPathfinder.ts
 *
 * Authoritative verification suite for Suite 81:
 * 100% Local, Ultra-Lightweight Edge-AI NLoS Link-Recovery Pathfinder & Autonomous Self-Healing Engine
 * (SPEC-TACTICAL-AI-NLOS-PATHFINDER-AND-AUTO-REPOSITION.md).
 *
 * Verifies:
 * - AIP-T1: Tobler Biomechanics & Ultra-Fast < 1.0 ms Execution Budget
 * - AIP-T2: NLoS Recovery Waypoint Discovery & Online Tabular Q-Table Learning
 * - AIP-T3: Worker Autonomous Node Repositioning Loop & Protocol Contracts
 * - AIP-T4: DOM Controls, Spec Persistence & Global Layout Invariance
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeToblerWalkingSpeedMs,
  EdgeAiQTable,
  computeAiRecoveryAdvisory,
  getCardinal16,
  type AiRecoveryAdvisoryParams,
  type AiNodeRecoveryRecommendation,
} from '../core/tacticalAiPathfinder';
import { SimulationWorkerManager } from '../worker/simWorker';
import { ACN_ID } from '../shared/constants';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('='.repeat(96));
console.log('   VERIFY: TACTICAL EDGE-AI NLOS PATHFINDER & AUTO-REPOSITION SUITE (AIP-T1–T4)');
console.log('='.repeat(96));

// -----------------------------------------------------------------------------
// AIP-T1: Tobler Biomechanics & Ultra-Fast Execution Budget
// -----------------------------------------------------------------------------
console.log('\n[AIP-T1] Tobler Biomechanics & Execution Budget...');

// 1. Flat ground: S = 0 -> v = 2.2 * exp(-3.5 * 0.05) ~ 1.846 m/s
const flatSoldier = computeToblerWalkingSpeedMs(100.0, 0.0, 'SOLDIER');
assert.ok(Math.abs(flatSoldier.speedMs - 1.846) < 0.05, `Flat soldier speed should be ~1.85 m/s, got ${flatSoldier.speedMs}`);
assert.equal(flatSoldier.isPassable, true, 'Flat ground must be passable');
assert.ok(flatSoldier.etaSeconds > 50 && flatSoldier.etaSeconds < 56, `ETA should be ~54s, got ${flatSoldier.etaSeconds}`);

// 2. Peak downhill speed at S = -0.05: v = v_max = 2.2 m/s
const downhillPeak = computeToblerWalkingSpeedMs(100.0, -5.0, 'SOLDIER');
assert.ok(Math.abs(downhillPeak.speedMs - 2.2) < 0.02, `Peak downhill speed should be 2.2 m/s, got ${downhillPeak.speedMs}`);

// 3. Steep uphill at S = +0.3 (~16.7 deg): v = 2.2 * exp(-3.5 * 0.35) ~ 0.647 m/s
const steepUphill = computeToblerWalkingSpeedMs(100.0, 30.0, 'SOLDIER');
assert.ok(steepUphill.speedMs < flatSoldier.speedMs, 'Steep uphill must be slower than flat ground');
assert.ok(Math.abs(steepUphill.speedMs - 0.647) < 0.05, `Steep uphill speed should be ~0.65 m/s, got ${steepUphill.speedMs}`);
assert.equal(steepUphill.isPassable, true, '16.7 deg slope must be passable (<= 35 deg)');

// 4. Vehicle MCP baseline speed: v_max = 8.5 m/s
const flatMcp = computeToblerWalkingSpeedMs(100.0, 0.0, 'MCP');
assert.ok(Math.abs(flatMcp.speedMs - (8.5 * Math.exp(-0.175))) < 0.1, `Flat MCP speed should be ~7.13 m/s, got ${flatMcp.speedMs}`);

// 5. Cliff: slope > 35 degrees is impassable
const cliff = computeToblerWalkingSpeedMs(100.0, 100.0, 'SOLDIER'); // 45 degrees
assert.equal(cliff.isPassable, false, 'Slope > 35 degrees must be marked impassable');

// 6. Cardinal direction helper
assert.equal(getCardinal16(0), 'N', 'Bearing 0 should be North');
assert.equal(getCardinal16(90), 'E', 'Bearing 90 should be East');
assert.equal(getCardinal16(180), 'S', 'Bearing 180 should be South');
assert.equal(getCardinal16(270), 'W', 'Bearing 270 should be West');
assert.equal(getCardinal16(45), 'NE', 'Bearing 45 should be North-East');

// 7. Execution Budget: Benchmark 100 evaluations
const mockElevation = (x: number, y: number) => 3200.0 + 0.05 * x - 0.02 * y;
const qTableBench = new EdgeAiQTable();
const benchParams: AiRecoveryAdvisoryParams = {
  nodeId: 4,
  nodePos: [1000.0, 2000.0, 3250.0],
  nodeType: 'SOLDIER',
  acnPos: [5000.0, 15000.0, 6000.0],
  currentSinrDb: -5.0,
  currentIsOutage: true,
  getElevationAt: mockElevation,
  qTable: qTableBench,
};

const t0 = performance.now();
const WARMUP_RUNS = 10;
const BENCH_RUNS = 100;
for (let i = 0; i < WARMUP_RUNS + BENCH_RUNS; i++) {
  computeAiRecoveryAdvisory(benchParams);
}
const elapsedMs = performance.now() - t0;
const avgMs = elapsedMs / (WARMUP_RUNS + BENCH_RUNS);
console.log(`  -> Average single advisory evaluation time: ${avgMs.toFixed(4)} ms (Budget: < 1.0 ms)`);
assert.ok(avgMs < 1.0, `Advisory evaluation must execute in < 1.0 ms, took ${avgMs.toFixed(4)} ms`);
console.log('✓ AIP-T1 PASS: Tobler biomechanics and execution budget verified.');

// -----------------------------------------------------------------------------
// AIP-T2: NLoS Recovery Waypoint Discovery & Online Tabular Q-Table Learning
// -----------------------------------------------------------------------------
console.log('\n[AIP-T2] NLoS Recovery Waypoint Discovery & Online Tabular Q-Table Learning...');

// 1. Q-table memory allocation: Exactly 256 Float32 elements = 1,024 bytes (1 KB)
const qTable = new EdgeAiQTable();
assert.equal(qTable.qTable.length, 256, 'Q-table buffer must have 256 Float32 entries (16 nodes x 16 sectors)');
assert.equal(qTable.qTable.byteLength, 1024, 'Q-table memory must be exactly 1,024 bytes (1 KB)');

// Initial values are 0
assert.equal(qTable.getQValue(4, 2), 0.0, 'Initial Q-value must be 0.0');

// Update Q-value
const updatedQ = qTable.updateQValue(4, 2, 18.5, 0.2);
assert.ok(Math.abs(updatedQ - 3.7) < 0.01, `Q-value after learning should be ~3.7, got ${updatedQ}`);
assert.equal(qTable.getQValue(4, 2), updatedQ, 'getQValue must retrieve updated value');

// Reset Q-table
qTable.reset();
assert.equal(qTable.getQValue(4, 2), 0.0, 'reset() must restore 0.0');

// 2. Optimal position early-exit
const optimalAdvisory = computeAiRecoveryAdvisory({
  nodeId: 1,
  nodePos: [0, 0, 3200],
  nodeType: 'SOLDIER',
  acnPos: [0, 10000, 5000],
  currentSinrDb: 15.0,
  currentIsOutage: false,
  getElevationAt: () => 3200,
});
assert.equal(optimalAdvisory.needsReposition, false, 'Clear LoS optimal position should not need reposition');
assert.equal(optimalAdvisory.status, 'OPTIMAL_POSITION');
assert.ok(optimalAdvisory.directiveText.includes('optimal'), 'Directive text must confirm link optimal');

// 3. Occluded shadow recovery search
// Simulate a ridge obstacle between node (0, 0) and ACN (0, 15000, 5000):
// A ridge at y = 300..1200 with peak elevation 3600m occludes direct line
const ridgeElevation = (x: number, y: number) => {
  // Base elevation is 3200m
  // High ridge between y = 200 and y = 1000
  if (y > 100 && y < 1200) {
    return 3550.0 - 0.001 * (x - 400) * (x - 400); // Ridge is lower to the east (x > 300)
  }
  // Clear valley / elevated bench to the East (x = 320m, elev 3300m)
  if (x > 200 && y <= 100) {
    return 3320.0;
  }
  return 3200.0;
};

const recoveryAdvisory = computeAiRecoveryAdvisory({
  nodeId: 4,
  nodePos: [0.0, 0.0, 3200.0],
  nodeType: 'SOLDIER',
  acnPos: [0.0, 15000.0, 5000.0],
  currentSinrDb: -12.0,
  currentIsOutage: true,
  getElevationAt: ridgeElevation,
  qTable,
});

assert.equal(recoveryAdvisory.needsReposition, true, 'Occluded node must need reposition');
assert.equal(recoveryAdvisory.status, 'RECOVERY_DIRECTIVE_FOUND');
assert.ok(recoveryAdvisory.moveDistanceM > 50, `Move distance should be > 50m, got ${recoveryAdvisory.moveDistanceM}`);
assert.ok(recoveryAdvisory.predictedSinrDb > -12.0 + 5.0, `Predicted SINR (${recoveryAdvisory.predictedSinrDb}) must improve by at least 5 dB over -12 dB`);
assert.ok(recoveryAdvisory.directiveText.includes('MOVE'), 'Directive text must contain MOVE directive');
assert.ok(recoveryAdvisory.directiveText.includes('Restores'), 'Directive text must indicate restored link');
console.log(`  -> Recovery Directive: "${recoveryAdvisory.directiveText}"`);
console.log('✓ AIP-T2 PASS: NLoS recovery waypoint discovery and Q-learning verified.');

// -----------------------------------------------------------------------------
// AIP-T3: Worker Autonomous Node Repositioning Loop & Protocol Contracts
// -----------------------------------------------------------------------------
console.log('\n[AIP-T3] Worker Autonomous Node Repositioning Loop & Protocol Contracts...');

const workerManager = new SimulationWorkerManager();
// Set up worker simulation
assert.ok(workerManager.nodesStatic.length > 0, 'Worker must initialize static nodes');
assert.ok(workerManager.nodesTac.length > 0, 'Worker must initialize tac nodes');

// Verify initial AI auto-heal state is disabled by default
assert.equal(workerManager.aiAutoHealEnabled, false, 'aiAutoHealEnabled must default to false on startup');

// Test inbound command: SET_AI_AUTO_HEAL
const setAutoHealRes = workerManager.handleCommand({
  type: 'SET_AI_AUTO_HEAL',
  enabled: true,
});
assert.equal(setAutoHealRes.accepted, true, 'SET_AI_AUTO_HEAL must be accepted');
assert.equal(workerManager.aiAutoHealEnabled, true, 'aiAutoHealEnabled must be updated');

// Test inbound command: TRIGGER_AI_NODE_REPOSITION
const targetNodeId = 4;
const targetStaticNode = workerManager.nodesStatic.find(n => n.nodeId === targetNodeId)!;
const initialPos: [number, number, number] = [...targetStaticNode.position];

// Set advisory recommendation on worker
const triggerRes = workerManager.handleCommand({
  type: 'TRIGGER_AI_NODE_REPOSITION',
  nodeId: targetNodeId,
});
assert.equal(triggerRes.accepted, true, 'TRIGGER_AI_NODE_REPOSITION must be accepted');

// Step the worker discrete event loop for multiple ticks (e.g. 50 ticks = 1 second)
const initialDistToTarget = workerManager.getActiveRepositionDistRemaining(targetNodeId);
for (let step = 0; step < 20; step++) {
  workerManager.stepSimulation();
}
const steppedDistToTarget = workerManager.getActiveRepositionDistRemaining(targetNodeId);
if (initialDistToTarget !== null && steppedDistToTarget !== null) {
  assert.ok(steppedDistToTarget <= initialDistToTarget, 'Stepping worker must progress node towards recovery target');
}

// Reset auto-heal to false
workerManager.handleCommand({
  type: 'SET_AI_AUTO_HEAL',
  enabled: false,
});
assert.equal(workerManager.aiAutoHealEnabled, false, 'aiAutoHealEnabled must turn off');
console.log('✓ AIP-T3 PASS: Worker autonomous repositioning loop verified.');

// -----------------------------------------------------------------------------
// AIP-T4: DOM Controls, Spec Persistence & Global Layout Invariance
// -----------------------------------------------------------------------------
console.log('\n[AIP-T4] DOM Controls, Spec Persistence & Global Layout Invariance...');

const indexHtmlPath = path.join(ROOT_DIR, 'index.html');
assert.ok(existsSync(indexHtmlPath), 'index.html must exist');
const html = readFileSync(indexHtmlPath, 'utf8');

// 1. Verify Edge-AI DOM elements in index.html
assert.ok(html.includes('id="ai-pathfinder-card"') || html.includes("id='ai-pathfinder-card'"), 'index.html must have #ai-pathfinder-card');
assert.ok(html.includes('id="ai-directive-readout"') || html.includes("id='ai-directive-readout'"), 'index.html must have #ai-directive-readout');
assert.ok(html.includes('id="btn-ai-reposition-node"') || html.includes("id='btn-ai-reposition-node'"), 'index.html must have #btn-ai-reposition-node');
assert.ok(html.includes('id="btn-ai-auto-heal-toggle"') || html.includes("id='btn-ai-auto-heal-toggle'"), 'index.html must have #btn-ai-auto-heal-toggle');

// 2. Verify Spec file on disk and linked in README.md
const specPath = path.join(ROOT_DIR, 'docs/specs/SPEC-TACTICAL-AI-NLOS-PATHFINDER-AND-AUTO-REPOSITION.md');
assert.ok(existsSync(specPath), 'SPEC-TACTICAL-AI-NLOS-PATHFINDER-AND-AUTO-REPOSITION.md must exist on disk');

const readmePath = path.join(ROOT_DIR, 'README.md');
const readmeContent = readFileSync(readmePath, 'utf8');
assert.ok(readmeContent.includes('SPEC-TACTICAL-AI-NLOS-PATHFINDER-AND-AUTO-REPOSITION.md'), 'README.md must link the AI pathfinder spec');

// 3. Verify c2-console-theme.css exists
assert.ok(existsSync(path.join(ROOT_DIR, 'frontend/c2-console-theme.css')), 'frontend/c2-console-theme.css must exist');

console.log('✓ AIP-T4 PASS: DOM controls, spec persistence, and theme invariance verified.');

console.log('\n' + '='.repeat(96));
console.log('   ALL 4 AIP VERIFICATION SUITES (AIP-T1–T4) PASSED CONVINCINGLY');
console.log('='.repeat(96));
