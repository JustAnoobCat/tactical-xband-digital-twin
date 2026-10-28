/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Physical Layer Verification Suite (TypeScript Port)
 *
 * Verifies mathematical parity against the Python reference implementation:
 * 1. Closed-Loop Timing Advance at 200 km theater radius (~1.334 ms +/- 0.005 ms).
 * 2. ITU-R P.834 4/3 Earth curvature bulge at 100 km path midpoint (~588.60 m +/- 5 m).
 * 3. Pristine LOS Link Budget at 10 km (SNR >= 17 dB, Bitrate >= 3.7 Mbps).
 * 4. Mountain Occlusion Outage (Diffraction Loss >= 25 dB, Bitrate == 0.0 bps).
 *
 * Execution:
 *   npx ts-node src/tests/verifyPhysics.ts
 *   (or: npx tsx src/tests/verifyPhysics.ts)
 */

import {
  DEFAULT_ENVIRONMENT_CONFIG,
  DEFAULT_RF_CONFIG,
  EnvironmentConfig,
  RFConfig,
} from '../core/config';
import { LinkBudgetEngine } from '../core/linkBudget';
import { Position3D, TerrainEngine } from '../core/terrain';

interface DiagnosticResult {
  readonly testName: string;
  readonly measured: string;
  readonly expected: string;
  readonly passed: boolean;
}

function runDiagnostics(): void {
  const rf = new RFConfig();
  const env = new EnvironmentConfig();
  const terrain = new TerrainEngine();
  const linkEngine = new LinkBudgetEngine();

  const results: DiagnosticResult[] = [];

  // ========================================================================
  // TEST 1: Closed-Loop Timing Advance at 200 km Slant Range
  // ========================================================================
  const groundPos: Position3D = [0.0, 0.0, 3000.0];
  const acnPosFar: Position3D = [200000.0, 0.0, 5000.0];

  const slant = terrain.computeSlantGeometry(groundPos, acnPosFar, env);
  const taMs = slant.timingAdvanceS * 1000.0;
  const expectedTaMs = 1.334;
  const taToleranceMs = 0.005;

  const test1Passed = Math.abs(taMs - expectedTaMs) <= taToleranceMs;
  results.push({
    testName: 'Closed-Loop Timing Advance (200 km)',
    measured: `TA = ${taMs.toFixed(4)} ms`,
    expected: `${expectedTaMs.toFixed(3)} ms (±${taToleranceMs} ms)`,
    passed: test1Passed,
  });

  // ========================================================================
  // TEST 2: ITU-R P.834 4/3 Earth Curvature Bulge at 100 km Midpoint
  // ========================================================================
  const d1M = 100000.0;
  const d2M = 100000.0;
  const bulgeM = TerrainEngine.computeEarthBulge(d1M, d2M, env.effectiveEarthRadiusM);
  const expectedBulgeM = 588.605;
  const bulgeToleranceM = 5.0;

  const test2Passed = Math.abs(bulgeM - expectedBulgeM) <= bulgeToleranceM;
  results.push({
    testName: '4/3 Earth Bulge (d1=d2=100 km)',
    measured: `Δh = ${bulgeM.toFixed(2)} m`,
    expected: `~${expectedBulgeM.toFixed(2)} m (±${bulgeToleranceM} m)`,
    passed: test2Passed,
  });

  // ========================================================================
  // TEST 3: Pristine Line-of-Sight Link Budget at 10 km
  // ========================================================================
  const range10kM = 10000.0;
  const zeroDiffractionDb = 0.0;

  const linkClean = linkEngine.evaluateLink(
    'soldier',
    range10kM,
    zeroDiffractionDb,
    rf,
    env
  );

  const test3Passed =
    !linkClean.isOutage &&
    linkClean.snrDb >= 17.0 &&
    linkClean.bitrateMbps >= 3.7;

  results.push({
    testName: 'Pristine LOS Link (10 km Soldier)',
    measured: `SNR=${linkClean.snrDb.toFixed(1)} dB, Rate=${linkClean.bitrateMbps.toFixed(2)} Mbps (${linkClean.modcodName})`,
    expected: 'SNR >= 17 dB, Rate >= 3.7 Mbps',
    passed: test3Passed,
  });

  // ========================================================================
  // TEST 4: Mountain Occlusion Outage
  // ========================================================================
  // Evaluate link under severe 45 dB diffraction loss (optical LOS severed by ridge)
  const heavyDiffractionDb = 45.0;
  const linkOccluded = linkEngine.evaluateLink(
    'soldier',
    15000.0,
    heavyDiffractionDb,
    rf,
    env
  );

  // Cross-check with ray-march obstruction evaluation on the Kargil barrier ridge
  // Node 4 at [2200, -3300, 3000] to ACN east flank at [15000, 10000, 5000]
  const node4Pos: Position3D = [2200.0, -3300.0, 3000.0];
  const acnEastPos: Position3D = [15000.0, 10000.0, 5000.0];
  const obstruction = terrain.evaluateTerrainObstruction(node4Pos, acnEastPos, rf, env);

  const test4Passed =
    linkOccluded.isOutage &&
    linkOccluded.bitrateBps === 0.0 &&
    linkOccluded.diffractionLossDb >= 25.0 &&
    obstruction.diffractionLossDb >= 25.0 &&
    !obstruction.isLos;

  results.push({
    testName: 'Mountain Occlusion Outage',
    measured: `DiffLoss=${linkOccluded.diffractionLossDb.toFixed(1)} dB, Rate=${linkOccluded.bitrateBps.toFixed(1)} bps (Outage=${linkOccluded.isOutage})`,
    expected: 'DiffLoss >= 25 dB, Rate == 0.0 bps (Outage=true)',
    passed: test4Passed,
  });

  // ========================================================================
  // Diagnostic Output Table
  // ========================================================================
  const bar = '='.repeat(100);
  const subBar = '-'.repeat(100);

  console.log('\n' + bar);
  console.log('       TACTICAL X-BAND DIGITAL TWIN // PURE TYPESCRIPT PHYSICS DIAGNOSTICS');
  console.log(bar);
  console.log(
    ` ${'Test Identifier'.padEnd(38)} | ${'Measured Value'.padEnd(28)} | ${'Tolerance / Target'.padEnd(20)} | Status`
  );
  console.log(subBar);

  let allPassed = true;
  for (const r of results) {
    if (!r.passed) allPassed = false;
    const statusText = r.passed ? 'PASSED' : 'FAILED';
    console.log(
      ` ${r.testName.padEnd(38)} | ${r.measured.padEnd(28)} | ${r.expected.padEnd(20)} | ${statusText}`
    );
  }

  console.log(bar);

  if (allPassed) {
    console.log(' [SUCCESS] All physical propagation and geodesy benchmarks passed with 100% parity.\n');
  } else {
    console.error(' [FAILURE] One or more physics benchmarks failed to achieve required tolerance.\n');
    throw new Error('Physics benchmarks failed.');
  }
}

// Execute diagnostics
runDiagnostics();