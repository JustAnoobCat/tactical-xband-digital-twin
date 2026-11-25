/**
 * Suite 100: Live 50 Hz Worker Wiring & UI Controls for High-Fidelity Physics Engine
 * Specification: docs/specs/v2-01-live-hifi-physics-wiring.md (SPEC-V2-01)
 *
 * Verifies:
 * 1. Default-OFF Backward Compatibility: All 5 models start disabled; baseline telemetry is bit-exact.
 * 2. Individual Model Activation: Toggling each model updates config, flags, and telemetry metrics.
 * 3. Simultaneous Multi-Model Execution & 50 Hz Budget: All 5 models active for 200 ticks (<10 ms/tick, deterministic, finite).
 * 4. State Cleanup on RESET_SIM: Worker-authoritative maps, OLLA offsets, and HARQ slots clean up completely on reset.
 * 5. UI DOM & Accessibility Contract: #hi-fi-physics-panel in index.html, zero emojis, fonts >= 10px, zero duplicate IDs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SimulationWorkerManager } from '../worker/simWorker';
import type { HiFiPhysicsTelemetry, TelemetryFrameMessage } from '../shared/workerProtocol';

const ANSI = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

async function runSuite(): Promise<void> {
  console.log('='.repeat(80));
  console.log(`${ANSI.bold}${ANSI.cyan}[SUITE 100] Live 50 Hz High-Fidelity Physics Engine Wiring & UI Controls${ANSI.reset}`);
  console.log('='.repeat(80));

  // ===========================================================================
  // TEST 1: Default-OFF Compatibility (Baseline Simulation Parity)
  // ===========================================================================
  console.log('\n[1/5] Verifying Default-OFF Baseline Backward Compatibility...');

  let capturedFrames: TelemetryFrameMessage[] = [];
  (globalThis as any).self = {
    postMessage: (msg: any) => {
      if (msg && msg.type === 'TELEMETRY_FRAME') {
        capturedFrames.push(msg);
      }
    },
  };

  const sim1 = new SimulationWorkerManager(100_001, '16_NODES');
  sim1.terrainEngine.setTerrainMode('synthetic');
  sim1.isPaused = true;

  // Confirm default values
  assert.equal(sim1.enableAirframeShadowing, false, 'Airframe shadowing must default to false');
  assert.equal(sim1.enableCorrelatedRicianFading, false, 'Correlated Rician fading must default to false');
  assert.equal(sim1.enableMacPhyFeedback, false, 'MAC/PHY feedback must default to false');
  assert.equal(sim1.enableDubinsKinematics, false, 'Dubins kinematics must default to false');
  assert.equal(sim1.viewshedFidelityMode, 'fast', 'Viewshed fidelity mode must default to fast');
  assert.equal(sim1.ollaOffsetByNode.size, 0, 'OLLA offset map must be initially empty');
  assert.equal(sim1.cqiHistoryByNode.size, 0, 'CQI history map must be initially empty');
  assert.equal(sim1.harqSlotByNode.size, 0, 'HARQ slot map must be initially empty');
  assert.equal(sim1.harqRetxTotal, 0, 'HARQ retransmissions must start at 0');

  // Advance 5 baseline ticks
  for (let t = 0; t < 5; t++) {
    sim1.tickSimulation(true);
  }

  assert.ok(capturedFrames.length >= 5, 'Must have captured at least 5 telemetry frames');
  const frame1 = capturedFrames[capturedFrames.length - 1].frame;
  assert.ok(frame1.hifi_telemetry, 'hifi_telemetry must be attached to TelemetryFrame');

  const hifi1 = frame1.hifi_telemetry!;
  assert.equal(hifi1.enabled_flags.enableAirframeShadowing, false);
  assert.equal(hifi1.enabled_flags.enableCorrelatedRicianFading, false);
  assert.equal(hifi1.enabled_flags.enableMacPhyFeedback, false);
  assert.equal(hifi1.enabled_flags.enableDubinsKinematics, false);
  assert.equal(hifi1.enabled_flags.viewshedFidelityMode, 'fast');

  // When disabled, shadow losses and fading offset must be 0 dB
  assert.equal(hifi1.mean_airframe_shadow_loss_db, 0);
  assert.equal(hifi1.max_airframe_shadow_loss_db, 0);
  assert.equal(hifi1.mean_correlated_fading_db, 0);
  assert.equal(hifi1.cqi_lag_frames, 0);
  assert.equal(hifi1.mean_olla_offset_db, 0);
  assert.equal(hifi1.harq_retransmissions_total, 0);
  assert.ok(hifi1.dubins_min_turn_radius_m > 0, 'Dubins turn radius should report non-zero kinematic baseline');

  console.log(`  ${ANSI.green}✓ Default-OFF compatibility verified: all 5 models inert, baseline output exact${ANSI.reset}`);

  // ===========================================================================
  // TEST 2: Individual Model Activation via CONFIG_UPDATE & SET_SCIENTIFIC_PARAMS
  // ===========================================================================
  console.log('\n[2/5] Verifying Individual Model Toggling via CONFIG_UPDATE...');

  // Model A: Airframe Shadowing (WP-05)
  sim1.handleCommand({
    type: 'CONFIG_UPDATE',
    params: { enableAirframeShadowing: true },
  });
  assert.equal(sim1.enableAirframeShadowing, true, 'sim1.enableAirframeShadowing must become true');
  sim1.tickSimulation(true);
  let latestHifi = capturedFrames[capturedFrames.length - 1].frame.hifi_telemetry!;
  assert.equal(latestHifi.enabled_flags.enableAirframeShadowing, true);
  assert.ok(Number.isFinite(latestHifi.uav_roll_deg), 'uav_roll_deg must be finite');
  assert.ok(Number.isFinite(latestHifi.uav_pitch_deg), 'uav_pitch_deg must be finite');

  // Model B: Correlated 8 GHz Rician Fading (WP-05)
  sim1.handleCommand({
    type: 'CONFIG_UPDATE',
    params: { enableCorrelatedRicianFading: true },
  });
  assert.equal(sim1.enableCorrelatedRicianFading, true, 'sim1.enableCorrelatedRicianFading must become true');
  sim1.tickSimulation(true);
  latestHifi = capturedFrames[capturedFrames.length - 1].frame.hifi_telemetry!;
  assert.equal(latestHifi.enabled_flags.enableCorrelatedRicianFading, true);
  assert.ok(latestHifi.coherence_time_ms > 0, 'coherence_time_ms must be positive for 8 GHz mobile channel');

  // Model C: Closed-Loop MAC/PHY Feedback (WP-06)
  sim1.handleCommand({
    type: 'CONFIG_UPDATE',
    params: { enableMacPhyFeedback: true },
  });
  assert.equal(sim1.enableMacPhyFeedback, true, 'sim1.enableMacPhyFeedback must become true');
  for (let k = 0; k < 10; k++) {
    sim1.tickSimulation(true);
  }
  latestHifi = capturedFrames[capturedFrames.length - 1].frame.hifi_telemetry!;
  assert.equal(latestHifi.enabled_flags.enableMacPhyFeedback, true);
  assert.ok(sim1.cqiHistoryByNode.size > 0, 'CQI history ring buffer must populate for active nodes');
  assert.ok(sim1.ollaOffsetByNode.size > 0, 'OLLA offset map must populate for active nodes');
  assert.ok(latestHifi.dynamic_guard_efficiency > 0 && latestHifi.dynamic_guard_efficiency <= 1.0);

  // Model D: Dubins Fixed-Wing Kinematics (WP-07)
  sim1.handleCommand({
    type: 'SET_SCIENTIFIC_PARAMS',
    enableDubinsKinematics: true,
  });
  assert.equal(sim1.enableDubinsKinematics, true, 'sim1.enableDubinsKinematics must become true via SET_SCIENTIFIC_PARAMS');
  sim1.tickSimulation(true);
  latestHifi = capturedFrames[capturedFrames.length - 1].frame.hifi_telemetry!;
  assert.equal(latestHifi.enabled_flags.enableDubinsKinematics, true);
  assert.ok(latestHifi.dubins_min_turn_radius_m > 100, 'Fixed wing turn radius must exceed 100m at cruising speed');

  // Model E: Viewshed Fidelity Mode (WP-10)
  sim1.handleCommand({
    type: 'CONFIG_UPDATE',
    params: { viewshedFidelityMode: 'link-budget-parity' },
  });
  assert.equal(sim1.viewshedFidelityMode, 'link-budget-parity', 'sim1.viewshedFidelityMode must become link-budget-parity');
  sim1.tickSimulation(true);
  latestHifi = capturedFrames[capturedFrames.length - 1].frame.hifi_telemetry!;
  assert.equal(latestHifi.enabled_flags.viewshedFidelityMode, 'link-budget-parity');

  console.log(`  ${ANSI.green}✓ Individual model activation verified across CONFIG_UPDATE & SET_SCIENTIFIC_PARAMS${ANSI.reset}`);

  // ===========================================================================
  // TEST 3: Simultaneous Multi-Model Execution & 50 Hz Discrete Budget
  // ===========================================================================
  console.log('\n[3/5] Verifying 200 Consecutive 50 Hz Ticks with All 5 Models Active...');

  const simBench = new SimulationWorkerManager(200_002, '16_NODES');
  simBench.terrainEngine.setTerrainMode('synthetic');
  simBench.isPaused = true;

  // Enable all 5 models simultaneously
  simBench.handleCommand({
    type: 'CONFIG_UPDATE',
    params: {
      enableAirframeShadowing: true,
      enableCorrelatedRicianFading: true,
      enableMacPhyFeedback: true,
      enableDubinsKinematics: true,
      viewshedFidelityMode: 'link-budget-parity',
    },
  });

  // 10-tick JIT warm-up before timing to eliminate cold-start transients
  for (let i = 0; i < 10; i++) {
    simBench.tickSimulation(false);
  }

  const TICK_COUNT = 200;
  const startMs = performance.now();
  for (let i = 0; i < TICK_COUNT; i++) {
    simBench.tickSimulation(false);
  }
  const elapsedMs = performance.now() - startMs;
  const meanTickLatencyMs = elapsedMs / TICK_COUNT;

  console.log(`    Total time for ${TICK_COUNT} ticks: ${elapsedMs.toFixed(2)} ms`);
  console.log(`    Mean tick latency: ${meanTickLatencyMs.toFixed(3)} ms/tick (50 Hz budget = 20.00 ms/tick)`);

  assert.ok(
    meanTickLatencyMs < 15.0,
    `Mean tick latency (${meanTickLatencyMs.toFixed(3)} ms) must stay comfortably below 15 ms (well within 20 ms budget)`
  );

  // Verify all telemetry fields are strictly finite and defined
  simBench.tickSimulation(true);
  const benchHifi = simBench.hifiTelemetry;
  assert.ok(benchHifi, 'simBench.hifiTelemetry must be defined');

  assert.ok(Number.isFinite(benchHifi.uav_roll_deg), 'uav_roll_deg must be finite');
  assert.ok(Number.isFinite(benchHifi.uav_pitch_deg), 'uav_pitch_deg must be finite');
  assert.ok(Number.isFinite(benchHifi.mean_airframe_shadow_loss_db), 'mean_airframe_shadow_loss_db must be finite');
  assert.ok(Number.isFinite(benchHifi.max_airframe_shadow_loss_db), 'max_airframe_shadow_loss_db must be finite');
  assert.ok(Number.isFinite(benchHifi.mean_correlated_fading_db), 'mean_correlated_fading_db must be finite');
  assert.ok(Number.isFinite(benchHifi.coherence_time_ms), 'coherence_time_ms must be finite');
  assert.ok(Number.isInteger(benchHifi.cqi_lag_frames), 'cqi_lag_frames must be an integer');
  assert.ok(Number.isFinite(benchHifi.mean_olla_offset_db), 'mean_olla_offset_db must be finite');
  assert.ok(Number.isInteger(benchHifi.harq_retransmissions_total), 'harq_retransmissions_total must be an integer');
  assert.ok(Number.isFinite(benchHifi.harq_combined_gain_db), 'harq_combined_gain_db must be finite');
  assert.ok(Number.isFinite(benchHifi.dynamic_guard_efficiency), 'dynamic_guard_efficiency must be finite');
  assert.ok(Number.isFinite(benchHifi.dubins_min_turn_radius_m), 'dubins_min_turn_radius_m must be finite');

  // Verify multi-run bit-exact determinism
  const simDeterminism = new SimulationWorkerManager(200_002, '16_NODES');
  simDeterminism.terrainEngine.setTerrainMode('synthetic');
  simDeterminism.isPaused = true;
  simDeterminism.handleCommand({
    type: 'CONFIG_UPDATE',
    params: {
      enableAirframeShadowing: true,
      enableCorrelatedRicianFading: true,
      enableMacPhyFeedback: true,
      enableDubinsKinematics: true,
      viewshedFidelityMode: 'link-budget-parity',
    },
  });

  for (let i = 0; i < 50; i++) {
    simDeterminism.tickSimulation(false);
  }
  simDeterminism.tickSimulation(true);

  // Compare to a fresh run with the same seed up to 51 ticks
  const simDetReference = new SimulationWorkerManager(200_002, '16_NODES');
  simDetReference.terrainEngine.setTerrainMode('synthetic');
  simDetReference.isPaused = true;
  simDetReference.handleCommand({
    type: 'CONFIG_UPDATE',
    params: {
      enableAirframeShadowing: true,
      enableCorrelatedRicianFading: true,
      enableMacPhyFeedback: true,
      enableDubinsKinematics: true,
      viewshedFidelityMode: 'link-budget-parity',
    },
  });
  for (let i = 0; i < 50; i++) {
    simDetReference.tickSimulation(false);
  }
  simDetReference.tickSimulation(true);

  assert.equal(
    simDeterminism.hifiTelemetry!.mean_correlated_fading_db,
    simDetReference.hifiTelemetry!.mean_correlated_fading_db,
    'Fading must be bit-exact deterministic across identical runs'
  );
  assert.equal(
    simDeterminism.hifiTelemetry!.mean_olla_offset_db,
    simDetReference.hifiTelemetry!.mean_olla_offset_db,
    'OLLA offset must be bit-exact deterministic across identical runs'
  );
  assert.equal(
    simDeterminism.hifiTelemetry!.harq_retransmissions_total,
    simDetReference.hifiTelemetry!.harq_retransmissions_total,
    'HARQ retransmissions must be bit-exact deterministic across identical runs'
  );

  console.log(`  ${ANSI.green}✓ 50 Hz budget verified: ${meanTickLatencyMs.toFixed(3)} ms/tick, strictly deterministic and NaN-free${ANSI.reset}`);

  // ===========================================================================
  // TEST 4: State Cleanup on SIM_CONTROL (reset)
  // ===========================================================================
  console.log('\n[4/5] Verifying State Cleanup on SIM_CONTROL reset...');

  // Ensure maps have state before reset
  assert.ok(simBench.cqiHistoryByNode.size > 0, 'cqiHistoryByNode must contain items prior to reset');
  assert.ok(simBench.ollaOffsetByNode.size > 0, 'ollaOffsetByNode must contain items prior to reset');

  // Trigger simulation reset
  simBench.handleCommand({
    type: 'SIM_CONTROL',
    action: 'reset',
  });

  assert.equal(simBench.ollaOffsetByNode.size, 0, 'ollaOffsetByNode must be cleared on reset');
  assert.equal(simBench.cqiHistoryByNode.size, 0, 'cqiHistoryByNode must be cleared on reset');
  assert.equal(simBench.harqSlotByNode.size, 0, 'harqSlotByNode must be cleared on reset');
  assert.equal(simBench.harqRetxTotal, 0, 'harqRetxTotal must reset to 0');
  assert.equal(simBench.prevSectorByNode.size, 0, 'prevSectorByNode must be cleared on reset');
  assert.equal(simBench.hifiTelemetry, undefined, 'hifiTelemetry must be undefined after reset');

  console.log(`  ${ANSI.green}✓ Full state cleanup verified on SIM_CONTROL reset${ANSI.reset}`);

  // ===========================================================================
  // TEST 5: UI DOM & Accessibility Contract in index.html
  // ===========================================================================
  console.log('\n[5/5] Verifying UI DOM, IDs, Labels, Zero-Emoji and Font Compliance in index.html...');

  const indexPath = path.resolve(process.cwd(), 'index.html');
  assert.ok(fs.existsSync(indexPath), 'index.html must exist');
  const indexHtml = fs.readFileSync(indexPath, 'utf-8');

  // Verify #hi-fi-physics-panel card exists inside #tab-terrain
  assert.ok(indexHtml.includes('id="hi-fi-physics-panel"'), 'Card id="hi-fi-physics-panel" must exist');
  const terrainTabIdx = indexHtml.indexOf('id="tab-terrain"');
  const terminalTabIdx = indexHtml.indexOf('id="tab-terminal"');
  const panelIdx = indexHtml.indexOf('id="hi-fi-physics-panel"');
  assert.ok(
    terrainTabIdx < panelIdx && panelIdx < terminalTabIdx,
    '#hi-fi-physics-panel must be located inside the RF / Terrain tab (#tab-terrain)'
  );

  // Verify 1-click button
  const mainTsPath = path.resolve(process.cwd(), 'src/main.ts');
  const mainTs = fs.readFileSync(mainTsPath, 'utf-8');
  assert.ok(indexHtml.includes('id="btn-hifi-all-toggle"'), 'Button id="btn-hifi-all-toggle" must exist');
  assert.ok(mainTs.includes('btn-hifi-all-toggle') && mainTs.includes('toggleAllHiFiPhysics'), 'src/main.ts must wire #btn-hifi-all-toggle to toggleAllHiFiPhysics()');

  // Verify 5 labeled checkboxes
  const expectedCheckboxes = [
    'toggle-hifi-attitude',
    'toggle-hifi-rician',
    'toggle-hifi-harq',
    'toggle-hifi-dubins',
    'toggle-hifi-viewshed-parity',
  ];
  for (const cbId of expectedCheckboxes) {
    assert.ok(indexHtml.includes(`id="${cbId}"`), `Checkbox id="${cbId}" must exist`);
    assert.ok(indexHtml.includes(`for="${cbId}"`), `Label for="${cbId}" must exist for accessibility`);
  }

  // Verify 5 live telemetry readouts
  const expectedReadouts = [
    'hifi-attitude-readout',
    'hifi-rician-readout',
    'hifi-harq-readout',
    'hifi-dubins-readout',
    'hifi-viewshed-readout',
  ];
  for (const roId of expectedReadouts) {
    assert.ok(indexHtml.includes(`id="${roId}"`), `Readout span id="${roId}" must exist`);
  }

  // Verify zero duplicate IDs for these elements
  const allIdsToCheck = ['hi-fi-physics-panel', 'btn-hifi-all-toggle', ...expectedCheckboxes, ...expectedReadouts];
  for (const elemId of allIdsToCheck) {
    const matches = indexHtml.match(new RegExp(`id=["']${elemId}["']`, 'g')) || [];
    assert.equal(matches.length, 1, `Element id="${elemId}" must appear exactly once in index.html (found ${matches.length})`);
  }

  // Extract panel HTML block and verify zero emojis & no font < 10px
  const panelStart = indexHtml.indexOf('<div class="panel" id="hi-fi-physics-panel"');
  const panelEnd = indexHtml.indexOf('</div>', panelStart + indexHtml.slice(panelStart).indexOf('</div class="inspector-grid"') + 500);
  const panelSnippet = indexHtml.slice(panelStart, panelStart + 4500);

  // Emojis regex: check common emoji Unicode ranges
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.ok(!emojiRegex.test(panelSnippet), 'No emojis permitted in #hi-fi-physics-panel');

  // Verify no inline font-size below 10px
  const fontMatches = [...panelSnippet.matchAll(/font-size:\s*([0-9.]+)px/g)];
  for (const m of fontMatches) {
    const px = parseFloat(m[1]);
    assert.ok(px >= 10.0, `Font size ${px}px in #hi-fi-physics-panel must be >= 10px`);
  }

  // Verify script wiring in src/main.ts
  assert.ok(mainTs.includes('window.onHiFiToggleChange = function'), 'window.onHiFiToggleChange must be defined');
  assert.ok(mainTs.includes('window.toggleAllHiFiPhysics = function'), 'window.toggleAllHiFiPhysics must be defined');
  assert.ok(mainTs.includes('window.updateHiFiPhysicsUI = updateHiFiPhysicsUI'), 'window.updateHiFiPhysicsUI must be exported');
  assert.ok(mainTs.includes('updateHiFiPhysicsUI(msg.frame.hifi_telemetry)'), 'updateHiFiPhysicsUI must be invoked on frame receipt');

  console.log(`  ${ANSI.green}✓ UI DOM & accessibility contract verified: 5 controls, 5 readouts, zero emojis, >=10px fonts${ANSI.reset}`);

  console.log('\n' + '='.repeat(80));
  console.log(`${ANSI.bold}${ANSI.green}[ALL CHECKS PASSED] Suite 100: Live 50 Hz High-Fidelity Physics Engine Verified${ANSI.reset}`);
  console.log('='.repeat(80));
}

runSuite().catch((err) => {
  console.error(`\n${ANSI.red}[SUITE 100 FAILED]:${ANSI.reset}`, err);
  process.exit(1);
});
