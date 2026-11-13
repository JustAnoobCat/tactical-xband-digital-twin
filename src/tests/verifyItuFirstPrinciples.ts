/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * First-Principles ITU-R Physics & Terrain Verification Suite
 *
 * Verifies first-principles ITU-R standards compliance:
 * - ITU-T1 (P.526-15 Crest Curvature Monotonicity): Sharp crest (R ≈ 2 m) vs broad crest (R ≈ 300 m)
 * - ITU-T2 (P.526-15 Bullington Multi-Ridge Intersection): Dual-ridge vs single ridge diffraction loss
 * - ITU-T3 (P.676-13 Altitude-Integrated Absorption): Ladakh high-altitude tropospheric scaling vs sea-level
 * - ITU-T4 (P.618-14 Sky-Noise Coupling): Rain atmospheric absorption elevating receiver noise floor
 * - ITU-T5 (Physical Speed-of-Light Timing Advance): Exact propagation delay tau_TA = 2*d / c
 *
 * Execution:
 *   npx vite-node src/tests/verifyItuFirstPrinciples.ts
 */

import {
  DEFAULT_ENVIRONMENT_CONFIG,
  DEFAULT_RF_CONFIG,
  EnvironmentConfig,
  RFConfig,
  SPEED_OF_LIGHT,
} from '../core/config';
import { LinkBudgetEngine } from '../core/linkBudget';
import { Position3D, TerrainEngine } from '../core/terrain';

interface DiagnosticResult {
  readonly testId: string;
  readonly testName: string;
  readonly measured: string;
  readonly expected: string;
  readonly passed: boolean;
}

export function runItuFirstPrinciplesVerification(): boolean {
  const rf = new RFConfig();
  const env = new EnvironmentConfig();
  const terrain = new TerrainEngine();
  const linkEngine = new LinkBudgetEngine();

  const results: DiagnosticResult[] = [];

  // ========================================================================
  // ITU-T1: ITU-R P.526-15 §4.2 Rounded-Crest Curvature Monotonicity
  // ========================================================================
  const d1M = 1000.0;
  const d2M = 1000.0;
  const hObsM = 10.0;
  const wavelengthM = rf.wavelengthM;

  const radii = [2.0, 10.0, 50.0, 100.0, 200.0, 300.0];
  const curvatureLosses = radii.map((r) =>
    TerrainEngine.computeCrestCurvatureLossDb(r, d1M, d2M, hObsM, wavelengthM)
  );

  const tCrestSharp = curvatureLosses[0]; // R = 2 m
  const tCrestBroad = curvatureLosses[curvatureLosses.length - 1]; // R = 300 m

  let isMonotonic = true;
  for (let i = 1; i < curvatureLosses.length; i++) {
    if (curvatureLosses[i] <= curvatureLosses[i - 1]) {
      isMonotonic = false;
      break;
    }
  }

  const t1Passed = tCrestSharp < 2.0 && tCrestBroad > 8.0 && isMonotonic;
  results.push({
    testId: 'ITU-T1',
    testName: 'P.526-15 Crest Curvature Monotonicity',
    measured: `R=2m: ${tCrestSharp.toFixed(2)} dB, R=300m: ${tCrestBroad.toFixed(2)} dB (Monotonic: ${isMonotonic})`,
    expected: 'T(R=2)<2.0 dB, T(R=300)>8.0 dB, strictly monotonic',
    passed: t1Passed,
  });

  // ========================================================================
  // ITU-T2: ITU-R P.526-15 §4.5.1 Bullington Multi-Ridge Intersection
  // ========================================================================
  const baselineD3D = 10000.0;
  const ridge1Dist = 3000.0;
  const ridge2Dist = 7000.0;
  const ridgeHeight = 200.0;

  // Single ridge losses
  const lossRidge1 = TerrainEngine.computeKnifeEdgeLossDb(ridgeHeight, ridge1Dist, baselineD3D - ridge1Dist, wavelengthM);
  const lossRidge2 = TerrainEngine.computeKnifeEdgeLossDb(ridgeHeight, ridge2Dist, baselineD3D - ridge2Dist, wavelengthM);

  // Bullington equivalent horizon tangents
  const sTxMax = ridgeHeight / ridge1Dist; // Horizon from TX is ridge 1
  const sRxMax = ridgeHeight / (baselineD3D - ridge2Dist); // Horizon from RX is ridge 2

  const bullApex = TerrainEngine.computeBullingtonApex(
    0.0,
    0.0,
    baselineD3D,
    sTxMax,
    sRxMax,
    ridge1Dist,
    ridge2Dist
  );

  const lossBullington = TerrainEngine.computeKnifeEdgeLossDb(
    bullApex.hBull,
    bullApex.sBull,
    baselineD3D - bullApex.sBull,
    wavelengthM
  );

  const apexBetweenPeaks = bullApex.sBull > ridge1Dist && bullApex.sBull < ridge2Dist;
  const bullExceedsSingles = lossBullington > lossRidge1 && lossBullington > lossRidge2;
  const t2Passed = apexBetweenPeaks && bullExceedsSingles;

  results.push({
    testId: 'ITU-T2',
    testName: 'P.526-15 Bullington Multi-Ridge Apex',
    measured: `s_bull=${bullApex.sBull.toFixed(0)}m, J_bull=${lossBullington.toFixed(2)} dB (J1=${lossRidge1.toFixed(2)}, J2=${lossRidge2.toFixed(2)})`,
    expected: 's_bull in (3000, 7000)m, J_bull > max(J1, J2)',
    passed: t2Passed,
  });

  // ========================================================================
  // ITU-T3: ITU-R P.676-13 Altitude-Integrated Gaseous Absorption
  // ========================================================================
  const linkRangeM = 20000.0; // 20 km
  const seaLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(linkRangeM, 0.0, 500.0);
  const ladakhLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(linkRangeM, 3500.0, 5500.0);
  const gasReductionFraction = (seaLossDb - ladakhLossDb) / seaLossDb;
  const gasReductionPct = gasReductionFraction * 100.0;

  const t3Passed = ladakhLossDb < seaLossDb && gasReductionFraction > 0.40;
  results.push({
    testId: 'ITU-T3',
    testName: 'P.676-13 Altitude-Integrated Gaseous Loss',
    measured: `Sea=${seaLossDb.toFixed(3)} dB, Ladakh=${ladakhLossDb.toFixed(3)} dB (-${gasReductionPct.toFixed(1)}%)`,
    expected: 'Ladakh < Sea, reduction > 40.0%',
    passed: t3Passed,
  });

  // ========================================================================
  // ITU-T4: ITU-R P.618-14 Sky-Noise Coupling under Rain
  // ========================================================================
  const heavyRainEnv = new EnvironmentConfig({
    rainRateMmH: 25.0,
    rainCellLengthKm: 10.0,
  });
  const clearEnv = new EnvironmentConfig({
    rainRateMmH: 0.0,
  });

  const nodeAltM = 3500.0;
  const acnAltM = 5500.0;

  const linkRain = linkEngine.evaluateLink(
    'soldier',
    linkRangeM,
    0.0,
    rf,
    heavyRainEnv,
    false,
    undefined,
    undefined,
    nodeAltM,
    acnAltM
  );

  const linkClear = linkEngine.evaluateLink(
    'soldier',
    linkRangeM,
    0.0,
    rf,
    clearEnv,
    false,
    undefined,
    undefined,
    nodeAltM,
    acnAltM
  );

  // Exact fallback check: omission of altitudes should not compute sky-noise coupling
  const linkLegacy = linkEngine.evaluateLink(
    'soldier',
    linkRangeM,
    0.0,
    rf,
    heavyRainEnv,
    false
  );

  const skyNoiseIncreaseDb = linkRain.skyNoiseIncreaseDb ?? 0.0;
  const skyTemperatureK = linkRain.skyTemperatureK ?? 0.0;
  const noiseFloorDeltaDb = linkRain.pNoiseDbm - linkClear.pNoiseDbm;
  const legacyDeltaNoise = linkLegacy.skyNoiseIncreaseDb ?? 0.0;

  const t4Passed =
    skyTemperatureK > 0.0 &&
    skyNoiseIncreaseDb >= 0.5 &&
    noiseFloorDeltaDb >= 0.5 &&
    legacyDeltaNoise === 0.0;

  results.push({
    testId: 'ITU-T4',
    testName: 'P.618-14 Sky-Noise Coupling',
    measured: `T_sky=${skyTemperatureK.toFixed(1)}K, ΔN_sky=${skyNoiseIncreaseDb.toFixed(2)} dB, LegacyΔN=${legacyDeltaNoise.toFixed(1)} dB`,
    expected: 'T_sky > 0 K, ΔN_sky >= 0.5 dB, LegacyΔN == 0.0 dB',
    passed: t4Passed,
  });

  // ========================================================================
  // ITU-T5: Physical Speed-of-Light Timing Advance
  // ========================================================================
  const targetDistanceM = 14989.6229;
  const slantTarget = terrain.computeSlantGeometry(
    [0.0, 0.0, 0.0],
    [targetDistanceM, 0.0, 0.0],
    env
  );

  const measuredTaS = slantTarget.timingAdvanceS;
  const expectedTaS = 1.0e-4; // 100.0 microseconds
  const taDiffS = Math.abs(measuredTaS - expectedTaS);

  const linkStatusTarget = linkEngine.evaluateLink(
    'soldier',
    targetDistanceM,
    0.0,
    rf,
    env,
    false,
    undefined,
    undefined,
    0.0,
    0.0
  );
  const linkTaDiffS = Math.abs((linkStatusTarget.timingAdvanceS ?? 0.0) - expectedTaS);

  const t5Passed = taDiffS <= 1.0e-9 && linkTaDiffS <= 1.0e-9;
  results.push({
    testId: 'ITU-T5',
    testName: 'Physical Timing Advance (2 * d / c)',
    measured: `tau_TA = ${(measuredTaS * 1e6).toFixed(4)} us (Error: ${taDiffS.toExponential(2)} s)`,
    expected: 'tau_TA = 100.0000 us (Error <= 1e-9 s)',
    passed: t5Passed,
  });

  // ========================================================================
  // Diagnostic Output Table
  // ========================================================================
  const bar = '='.repeat(105);
  const subBar = '-'.repeat(105);

  console.log('\n' + bar);
  console.log('       FIRST-PRINCIPLES ITU-R PROPAGATION & SCHEDULING VERIFICATION (SPEC-ITU-01)');
  console.log(bar);
  console.log(
    ` ${'ID'.padEnd(8)} | ${'Test Name'.padEnd(38)} | ${'Measured'.padEnd(32)} | Status`
  );
  console.log(subBar);

  let allPassed = true;
  for (const r of results) {
    if (!r.passed) allPassed = false;
    const statusText = r.passed ? 'PASSED' : 'FAILED';
    console.log(
      ` ${r.testId.padEnd(8)} | ${r.testName.padEnd(38)} | ${r.measured.padEnd(32)} | ${statusText}`
    );
  }

  console.log(bar);

  if (allPassed) {
    console.log(' [SUCCESS] All 5 first-principles ITU-R verification benchmarks passed with 100% compliance.\n');
  } else {
    console.error(' [FAILURE] One or more ITU-R verification benchmarks failed.\n');
    throw new Error('ITU-R first-principles verification failed.');
  }

  return allPassed;
}

// Execute diagnostics when invoked directly
runItuFirstPrinciplesVerification();
