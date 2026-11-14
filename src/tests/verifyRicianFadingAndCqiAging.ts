/**
 * src/tests/verifyRicianFadingAndCqiAging.ts
 *
 * Automated Verification Suite for 3GPP TR 38.811 Elevation-Dependent Rician Multipath Fading,
 * CQI Feedback Delay Aging, and Predictive OLLA Margin Protection.
 *
 * Specification: docs/specs/SPEC-3GPP-NTN-RICIAN-FADING-AND-CQI-AGING.md
 *
 * Test Suites:
 * - RFC-T1: 3GPP TR 38.811 Elevation & Diffraction Scaling of Rician K-Factor (dB)
 * - RFC-T2: Clarke/Jakes Sum-of-Sinusoids Unit-Mean Power Conservation & Determinism
 * - RFC-T3: CQI Aging Outage & Predictive OLLA Margin Protection in Tac-TAD
 * - RFC-T4: UI DOM Elements, Telemetry Serialization & Specification Persistence
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RFConfig, EnvironmentConfig } from '../core/config';
import { LinkBudgetEngine } from '../core/linkBudget';
import { SimulationWorkerManager } from '../worker/simWorker';

function close(actual: number, expected: number, tolerance = 1e-4, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('='.repeat(94));
console.log('   3GPP TR 38.811 RICIAN FADING, CQI AGING & PREDICTIVE OLLA VERIFICATION SUITE');
console.log('   Specification: SPEC-3GPP-NTN-RICIAN-FADING-AND-CQI-AGING // RFC-T1 - RFC-T4');
console.log('='.repeat(94));

// =================================================================================================
// [RFC-T1] 3GPP TR 38.811 Elevation & Diffraction-Coupled Rician K-Factor Scaling
// =================================================================================================
console.log('\n[RFC-T1] Verifying 3GPP TR 38.811 Elevation & Diffraction Scaling of K_dB...');
{
  // High-elevation unobstructed LoS: theta_el = 60 deg, L_diff = 0 dB
  const resHighLoS = LinkBudgetEngine.computeRicianMultipathFading(1, 0.0, 60.0, 0.0, 50.0);
  console.log(`  High-elevation LoS (60°, 0 dB diff): K = ${resHighLoS.ricianKFactorDb.toFixed(2)} dB`);
  assert.ok(
    resHighLoS.ricianKFactorDb > 14.0,
    `High-elevation unobstructed LoS must yield K_dB > 14.0 dB (got ${resHighLoS.ricianKFactorDb} dB)`
  );
  // Theoretical: 4.0 + 13.5 * sin(60°) = 4.0 + 13.5 * 0.866025 = 15.69 dB
  close(resHighLoS.ricianKFactorDb, 4.0 + 13.5 * Math.sin((60.0 * Math.PI) / 180.0), 0.01, 'High LoS analytical match');

  // Low-grazing diffracted canyon link: theta_el = 5 deg, L_diff = 20 dB
  const resLowDiff = LinkBudgetEngine.computeRicianMultipathFading(1, 0.0, 5.0, 20.0, 50.0);
  console.log(`  Low-grazing canyon (5°, 20 dB diff): K = ${resLowDiff.ricianKFactorDb.toFixed(2)} dB`);
  assert.ok(
    resLowDiff.ricianKFactorDb < 0.0,
    `Low-grazing diffracted canyon link must yield K_dB < 0.0 dB (near-Rayleigh) (got ${resLowDiff.ricianKFactorDb} dB)`
  );
  // Theoretical: 4.0 + 13.5 * sin(5°) - 0.35 * 20.0 = 4.0 + 1.1766 - 7.0 = -1.82 dB
  close(
    resLowDiff.ricianKFactorDb,
    4.0 + 13.5 * Math.sin((5.0 * Math.PI) / 180.0) - 0.35 * 20.0,
    0.01,
    'Low canyon analytical match'
  );

  // Clamping Bounds:
  // Zenith LoS: theta_el = 90 deg, L_diff = 0 dB => 4.0 + 13.5 = 17.5 dB (within [-2, 20])
  const resZenith = LinkBudgetEngine.computeRicianMultipathFading(1, 0.0, 90.0, 0.0, 50.0);
  assert.ok(resZenith.ricianKFactorDb <= 20.0 && resZenith.ricianKFactorDb >= -2.0, 'Zenith K must stay within [-2, 20]');

  // Extreme diffraction shadow: theta_el = 2 deg, L_diff = 40 dB => clamped to -2.0 dB
  const resExtremeDiff = LinkBudgetEngine.computeRicianMultipathFading(1, 0.0, 2.0, 40.0, 50.0);
  close(resExtremeDiff.ricianKFactorDb, -2.0, 1e-4, 'Extreme diffraction must clamp K to -2.0 dB');

  console.log('  ✓ Elevation and diffraction coupling follows exact 3GPP TR 38.811 equations and clamping boundaries');
}

// =================================================================================================
// [RFC-T2] Clarke/Jakes Sum-of-Sinusoids Unit-Mean Power Conservation & Determinism
// =================================================================================================
console.log('\n[RFC-T2] Verifying Clarke/Jakes Unit-Mean Power Conservation & Determinism...');
{
  const nodeId = 3;
  const elDeg = 30.0;
  const diffDb = 3.0;
  const dopplerHz = 850.0;
  const numSteps = 200;
  const dtS = 0.02; // 50 Hz discrete step (20 ms)

  let sumLinearPower = 0.0;
  for (let k = 0; k < numSteps; k++) {
    const t = k * dtS;
    const fade = LinkBudgetEngine.computeRicianMultipathFading(nodeId, t, elDeg, diffDb, dopplerHz);
    const pLin = Math.pow(10.0, fade.fadingGainDb / 10.0);
    sumLinearPower += pLin;

    // Verify envelope gain bounds [-12 dB, +4.5 dB]
    assert.ok(
      fade.fadingGainDb >= -12.0 && fade.fadingGainDb <= 4.5,
      `Instantaneous fading gain must be clamped to [-12, +4.5] dB (got ${fade.fadingGainDb} dB)`
    );
  }

  const meanLinearPower = sumLinearPower / numSteps;
  console.log(`  Clarke/Jakes M=6 ensemble mean linear power over ${numSteps} steps: ${meanLinearPower.toFixed(4)} (E[|h|^2] ≈ 1.0)`);
  assert.ok(
    meanLinearPower >= 0.85 && meanLinearPower <= 1.15,
    `Clarke/Jakes sum-of-sinusoids must conserve power: mean linear power must be in [0.85, 1.15], got ${meanLinearPower}`
  );

  // Determinism Check:
  const tProbe = 1.48;
  const callA = LinkBudgetEngine.computeRicianMultipathFading(nodeId, tProbe, elDeg, diffDb, dopplerHz);
  const callB = LinkBudgetEngine.computeRicianMultipathFading(nodeId, tProbe, elDeg, diffDb, dopplerHz);
  assert.strictEqual(callA.ricianKFactorDb, callB.ricianKFactorDb, 'K-factor must be 100% deterministic');
  assert.strictEqual(callA.fadingGainDb, callB.fadingGainDb, 'Fading gain must be 100% bit-for-bit deterministic');

  // Multi-node spatial diversity check (different nodes have distinct phase offsets):
  const callNode4 = LinkBudgetEngine.computeRicianMultipathFading(4, tProbe, elDeg, diffDb, dopplerHz);
  assert.notStrictEqual(callA.fadingGainDb, callNode4.fadingGainDb, 'Different node IDs must have decorrelated multipath phases');

  console.log('  ✓ Clarke/Jakes Doppler synthesis is power-conserving and strictly deterministic across discrete steps');
}

// =================================================================================================
// [RFC-T3] CQI Feedback Delay Aging & Predictive OLLA Margin Protection in Tac-TAD
// =================================================================================================
console.log('\n[RFC-T3] Verifying CQI Aging Outage & Predictive OLLA Margin Protection...');
{
  const framesToSimulate = 150; // 3.0 seconds simulation
  const seed = 42;

  // Initialize simulation with active Rician fading and 40 ms CQI feedback delay
  const sim = new SimulationWorkerManager(seed);
  sim.isPaused = true;
  sim.handleMessage({
    type: 'SET_SCIENTIFIC_PARAMS',
    trafficLoadMultiplier: 3.5,
    ricianFadingEnabled: true,
    cqiFeedbackDelayMs: 40,
  });

  // Verify worker config state
  assert.strictEqual(sim.envConfig.ricianFadingEnabled, true, 'Worker envConfig must reflect ricianFadingEnabled = true');
  assert.strictEqual(sim.envConfig.cqiFeedbackDelayMs, 40, 'Worker envConfig must reflect cqiFeedbackDelayMs = 40');

  // Step 150 frames through the discrete 50 Hz loop
  for (let f = 0; f < framesToSimulate; f++) {
    sim.tickSimulation();
  }

  const metrics = sim.metrics;
  const staticWaste = metrics.staticWastedBits ?? 0;
  const reactiveWaste = metrics.reactiveWastedBits ?? 0;
  const tacWaste = metrics.tacWastedBits ?? 0;
  const reactiveGoodput = metrics.reactiveGoodputBits ?? 0;
  const tacGoodput = metrics.tacGoodputBits ?? 0;

  console.log(`  Simulation Results (150 frames @ 50 Hz, 40 ms CQI delay):`);
  console.log(`  • Static TDMA Goodput:    ${(metrics.staticGoodputBits / 1e6).toFixed(2)} Mb | Outage Waste: ${(staticWaste / 1e3).toFixed(1)} kbit`);
  console.log(`  • Reactive M-LWDF Goodput:${(reactiveGoodput / 1e6).toFixed(2)} Mb | Outage Waste: ${(reactiveWaste / 1e3).toFixed(1)} kbit`);
  console.log(`  • Tac-TAD (OLLA) Goodput: ${(tacGoodput / 1e6).toFixed(2)} Mb | Outage Waste: ${(tacWaste / 1e3).toFixed(1)} kbit`);

  // Assertions:
  // 1. Reactive baseline suffers CQI-mismatch outage waste because it blindly uses delayed CQI reports
  assert.ok(
    reactiveWaste > 0,
    `Reactive M-LWDF must register CQI-aging outage waste under 40 ms delay (got ${reactiveWaste} bits)`
  );

  // 2. Predictive Tac-TAD with OLLA margin protection suffers significantly fewer wasted bits than Reactive baseline
  assert.ok(
    tacWaste < reactiveWaste,
    `Tac-TAD with OLLA must suffer fewer outage-wasted bits than Reactive baseline (Tac: ${tacWaste}, Reactive: ${reactiveWaste})`
  );

  // 3. Tac-TAD achieves higher delivered goodput than Reactive baseline
  assert.ok(
    tacGoodput > reactiveGoodput,
    `Tac-TAD must achieve higher delivered goodput than Reactive baseline under fading + CQI aging (Tac: ${tacGoodput}, Reactive: ${reactiveGoodput})`
  );

  // 4. Verify telemetry frame exposes Rician and OLLA metrics
  const frame = sim.lastTelemetryFrame;
  assert.ok(frame !== null, 'Telemetry frame must be generated');
  assert.strictEqual(frame.rician_fading_enabled, true, 'Telemetry frame must expose rician_fading_enabled');
  assert.strictEqual(frame.cqi_feedback_delay_ms, 40, 'Telemetry frame must expose cqi_feedback_delay_ms');

  const nodesTel = frame.nodes_telemetry;
  assert.ok(nodesTel && nodesTel.length > 0, 'Nodes telemetry must be present');
  const activeNode = nodesTel.find(n => n.rician_k_db !== undefined);
  assert.ok(activeNode !== undefined, 'Nodes telemetry must contain active node with rician_k_db');
  assert.ok(typeof activeNode.rician_k_db === 'number', 'rician_k_db must be numeric');
  assert.ok(typeof activeNode.rician_fading_db === 'number', 'rician_fading_db must be numeric');
  assert.ok(typeof activeNode.olla_margin_db === 'number', 'olla_margin_db must be numeric');
  assert.ok((activeNode.olla_margin_db ?? 0) > 0, `Node ${activeNode.node_id} must have positive OLLA margin under 40 ms delay`);

  console.log(`  ✓ Node ${activeNode.node_id} Telemetry: K = ${activeNode.rician_k_db.toFixed(1)} dB, Fading = ${activeNode.rician_fading_db.toFixed(1)} dB, OLLA Margin = ${activeNode.olla_margin_db.toFixed(2)} dB`);
  console.log('  ✓ Predictive OLLA margin protects Tac-TAD against CQI aging block decode failures');
}

// =================================================================================================
// [RFC-T4] UI DOM Elements, Telemetry Serialization & Specification Persistence
// =================================================================================================
console.log('\n[RFC-T4] Verifying UI DOM Controls & Specification Persistence...');
{
  const rootDir = resolve(__dirname, '../..');

  // 1. Verify Specification file exists on disk
  const specPath = resolve(rootDir, 'docs/specs/SPEC-3GPP-NTN-RICIAN-FADING-AND-CQI-AGING.md');
  assert.ok(existsSync(specPath), `Specification file must exist at ${specPath}`);
  const specContent = readFileSync(specPath, 'utf-8');
  assert.ok(specContent.length > 2000, 'Specification file must contain full technical content');
  assert.ok(specContent.includes('3GPP TR 38.811'), 'Spec must cite 3GPP TR 38.811');
  assert.ok(specContent.includes('Clarke/Jakes'), 'Spec must cite Clarke/Jakes');
  assert.ok(specContent.includes('OLLA'), 'Spec must define OLLA margin');

  // 2. Verify README.md references the specification
  const readmePath = resolve(rootDir, 'README.md');
  const readmeContent = readFileSync(readmePath, 'utf-8');
  assert.ok(
    readmeContent.includes('SPEC-3GPP-NTN-RICIAN-FADING-AND-CQI-AGING.md'),
    'README.md Section 7 must reference the Rician Fading & CQI Aging specification'
  );

  // 3. Verify index.html contains required controls and telemetry displays
  const htmlPath = resolve(rootDir, 'index.html');
  const htmlContent = readFileSync(htmlPath, 'utf-8');
  assert.ok(htmlContent.includes('id="sci-fading-cqi-select"'), 'index.html must include #sci-fading-cqi-select');
  assert.ok(
    htmlContent.includes('aria-label="3GPP TR 38.811 Rician Multipath Fading and CQI Delay Mode"'),
    '#sci-fading-cqi-select must have required aria-label'
  );
  assert.ok(htmlContent.includes('id="sci-fading-cqi-readout"'), 'index.html must include #sci-fading-cqi-readout');
  assert.ok(htmlContent.includes('id="wf-rician-readout"'), 'index.html must include #wf-rician-readout');
  assert.ok(htmlContent.includes('3GPP TR 38.811'), 'index.html must reference 3GPP TR 38.811 in standards section');

  console.log('  ✓ Specification persisted on disk and linked in README.md');
  console.log('  ✓ index.html controls, accessible labels, and waterfall readouts verified');
}

console.log('\n' + '='.repeat(94));
console.log('   ALL 3GPP TR 38.811 RICIAN FADING & CQI AGING VERIFICATION TESTS PASSED (4/4 SUITES)');
console.log('='.repeat(94));
