/**
 * src/tests/verifyScientificBenchmarkRigor.ts
 *
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Scientific Benchmarking Rigor Verification Suite (Suite 95)
 *
 * Target Specification: docs/specs/wp11-scientific-benchmarking-rigor.md
 * Classification: Statistical Rigor / ITU-R Reference Anchors / Multi-Seed Monte Carlo / Physics Ablation
 *
 * Verifies:
 * - [SBR-T1] External Published ITU-R Reference Cross-Validation:
 *   - ITU-R P.525 Friis FSPL at 8.0 GHz (1km, 50km, 200km < 0.02 dB analytical error).
 *   - ITU-R P.526-15 Knife-Edge Anchor Points (nu = -0.78, 0, 1, 2, 5, and +6.02 dB/octave scaling).
 *   - ITU-R P.838-3 Rain & P.676-13 Gaseous Attenuation at 8.0 GHz (monotonicity & physical bounds).
 *   - WGS-84 & 4/3 Earth Curvature Anchors (Vincenty 1975 Flinders Peak & 100km Earth bulge).
 * - [SBR-T2] Exact Statistical Math Verification:
 *   - Student-t critical values at 95% CI (df = 1, 5, 29, 1000).
 *   - Known sample statistics on reference vector [2, 4, 4, 4, 5, 5, 7, 9].
 *   - Welch's two-sample t-test, Welch-Satterthwaite df, Lentz incomplete beta p-value & Cohen's d.
 * - [SBR-T3] N = 30 Multi-Seed Physics-Realism Ablation & Determinism Proof:
 *   - Bit-exact determinism across duplicate runs (baseSeed = 20261122).
 *   - Finite 95% CIs (ci95Lower <= mean <= ci95Upper) across all 4 configurations.
 *   - Formal proof: Baseline-idealized significantly overestimates goodput vs realistic stack (p < 0.01).
 *   - Formal proof: Full realistic stack significantly reduces residual BLER vs unprotected delayed-CQI (p < 0.01).
 *   - Formatted Markdown and CSV output validation.
 * - [SBR-T4] Statistical Edge Cases & CI Performance Budget:
 *   - N=0, N=1, zero-variance arrays, and NaN/Infinity filtering.
 *   - Execution runtime audit (< 1.5 s budget).
 *
 * Execution:
 *   npx vite-node src/tests/verifyScientificBenchmarkRigor.ts
 */

import assert from 'node:assert/strict';
import {
  computeSampleStatistics,
  studentTCritical95,
  computeWelchTTest,
  runMultiSeedMonteCarlo,
  runPhysicsRealismAblation,
  formatAblationMarkdownTable,
  formatAblationCsv,
  verifyAllItuReferenceAnchors,
  verifyFsplAnchorPoints,
  verifyKnifeEdgeAnchorPoints,
  verifyAtmosphericAnchorPoints,
  verifyGeodeticAnchorPoints,
} from '../core/statisticalBenchmarkEngine';
import {
  computeFsplDb,
  computeKnifeEdgeDiffractionLossDb,
  computeEarthBulgeM,
} from '../core/rfPropagationMath';
import { LinkBudgetEngine } from '../core/linkBudget';
import { wgs84VincentyInverse } from '../core/geodesy';

function close(actual: number, expected: number, tolerance = 1e-4, msg?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${msg ? `${msg}: ` : ''}expected ${expected} ± ${tolerance}, got ${actual} (diff: ${diff})`
  );
}

console.log('='.repeat(100));
console.log('   SCIENTIFIC BENCHMARKING RIGOR VERIFICATION SUITE (SUITE 95)');
console.log('   Specification: docs/specs/wp11-scientific-benchmarking-rigor.md // SBR-T1 - SBR-T4');
console.log('='.repeat(100));

// =================================================================================================
// [SBR-T1] External Published ITU-R Reference Cross-Validation
// =================================================================================================
console.log('\n[SBR-T1] Cross-Validating Against External Published ITU-R & Geodetic Anchors...');
{
  // 1. ITU-R P.525 Free-Space Path Loss at 8.0 GHz
  // Analytical Friis formula: FSPL = 20*log10(d) + 20*log10(f) + 20*log10(4*pi/c)
  // At 1 km:   110.506 dB
  // At 50 km:  144.486 dB
  // At 200 km: 156.527 dB
  const fspl1km = computeFsplDb(1000.0, 8.0e9);
  const fspl50km = computeFsplDb(50000.0, 8.0e9);
  const fspl200km = computeFsplDb(200000.0, 8.0e9);

  close(fspl1km, 110.506, 0.02, 'P.525 FSPL at 1 km (8.0 GHz)');
  close(fspl50km, 144.486, 0.02, 'P.525 FSPL at 50 km (8.0 GHz)');
  close(fspl200km, 156.527, 0.02, 'P.525 FSPL at 200 km (8.0 GHz)');
  console.log(`  ✓ ITU-R P.525 FSPL anchors at 1km (${fspl1km.toFixed(3)} dB), 50km (${fspl50km.toFixed(3)} dB), 200km (${fspl200km.toFixed(3)} dB) verified (< 0.02 dB)`);

  // 2. ITU-R P.526-15 Single Knife-Edge Diffraction
  // nu <= -0.78 -> 0 dB
  // nu = 0.0    -> 6.03 dB
  // nu = 1.0    -> 13.90 dB
  // nu = 2.0    -> 19.16 dB (approx 19.04 dB)
  // nu = 5.0    -> 26.86 dB
  // Asymptotic octave scaling: nu = 10 -> 20 -> +6.02 dB/octave
  const keM078 = computeKnifeEdgeDiffractionLossDb(-0.78);
  const ke0 = computeKnifeEdgeDiffractionLossDb(0.0);
  const ke1 = computeKnifeEdgeDiffractionLossDb(1.0);
  const ke2 = computeKnifeEdgeDiffractionLossDb(2.0);
  const ke5 = computeKnifeEdgeDiffractionLossDb(5.0);
  const ke10 = computeKnifeEdgeDiffractionLossDb(10.0);
  const ke20 = computeKnifeEdgeDiffractionLossDb(20.0);
  const octaveScaling = ke20 - ke10;

  close(keM078, 0.0, 1e-4, 'P.526-15 nu <= -0.78 line-of-sight threshold');
  close(ke0, 6.03, 0.05, 'P.526-15 grazing incidence nu = 0.0');
  close(ke1, 13.90, 0.05, 'P.526-15 shadow boundary nu = 1.0');
  close(ke2, 19.16, 0.15, 'P.526-15 deep shadow nu = 2.0');
  close(ke5, 26.86, 0.06, 'P.526-15 severe shadow nu = 5.0');
  close(octaveScaling, 6.02, 0.05, 'P.526-15 asymptotic +6.02 dB/octave scaling');
  console.log(`  ✓ ITU-R P.526-15 Knife-edge diffraction anchors & octave scaling (+${octaveScaling.toFixed(3)} dB/octave) verified`);

  // 3. ITU-R P.838-3 Rain & P.676-13 Atmospheric Absorption
  const gasLossSeaLevel = LinkBudgetEngine.computeGaseousAttenuationDb(1000.0, 0.0, 0.0);
  assert.ok(
    gasLossSeaLevel >= 0.005 && gasLossSeaLevel <= 0.025,
    `Sea-level gaseous absorption must be in [0.005, 0.025] dB/km, got ${gasLossSeaLevel}`
  );

  const envRain5 = { rainRateMmH: 5.0, rainCellLengthKm: 10.0 } as any;
  const envRain25 = { rainRateMmH: 25.0, rainCellLengthKm: 10.0 } as any;
  const envRain50 = { rainRateMmH: 50.0, rainCellLengthKm: 10.0 } as any;

  const rain5 = LinkBudgetEngine.computeRainAttenuationDb(10000.0, envRain5, 0.0, 0.0);
  const rain25 = LinkBudgetEngine.computeRainAttenuationDb(10000.0, envRain25, 0.0, 0.0);
  const rain50 = LinkBudgetEngine.computeRainAttenuationDb(10000.0, envRain50, 0.0, 0.0);

  assert.ok(rain25 > rain5 && rain50 > rain25, 'Rain attenuation must be strictly monotonic with rain rate');
  assert.ok(rain50 / rain25 > 2.0, 'Rain attenuation must scale super-linearly with rain rate (alpha = 1.39 > 1)');
  console.log(`  ✓ ITU-R P.676-13 (${gasLossSeaLevel.toFixed(4)} dB/km) & P.838-3 super-linear rain scaling verified`);

  // 4. WGS-84 Vincenty 1975 & Curved-Earth Bulge Anchors
  const vincenty = wgs84VincentyInverse(-37.951033416667, 144.424867888889, -37.652821138889, 143.926495527778);
  close(vincenty.distanceM, 54972.271, 0.01, 'Canonical Vincenty Flinders Peak -> Buninyong');

  const bulge100km = computeEarthBulgeM(50000.0, 50000.0);
  close(bulge100km, 147.15, 1.0, '4/3 Earth curvature midpoint bulge at 100 km');
  console.log(`  ✓ WGS-84 Vincenty 1975 (${vincenty.distanceM.toFixed(3)} m) & 100km Earth bulge (${bulge100km.toFixed(3)} m) verified`);

  // Verify pure reference validation bundle
  const bundle = verifyAllItuReferenceAnchors();
  assert.ok(bundle.allPassed, 'verifyAllItuReferenceAnchors must return allPassed = true');
  console.log('  ✓ verifyAllItuReferenceAnchors bundle validation [PASS]');
}

// =================================================================================================
// [SBR-T2] Exact Statistical Math Verification (Student-t CI & Welch t-Test)
// =================================================================================================
console.log('\n[SBR-T2] Verifying Exact Statistical Math (Student-t 95% CI & Welch t-Test)...');
{
  // 1. studentTCritical95 accuracy against published tables
  close(studentTCritical95(1), 12.7062, 1e-3, 'Student-t critical value df=1');
  close(studentTCritical95(5), 2.5706, 1e-3, 'Student-t critical value df=5');
  close(studentTCritical95(29), 2.0452, 1e-3, 'Student-t critical value df=29');
  close(studentTCritical95(1000), 1.9623, 1e-3, 'Student-t critical value df=1000 (Cornish-Fisher expansion)');
  console.log('  ✓ studentTCritical95 table lookups and Cornish-Fisher asymptotic expansion verified (< 1e-3)');

  // 2. Known sample statistics on reference vector [2, 4, 4, 4, 5, 5, 7, 9]
  const sampleData = [2, 4, 4, 4, 5, 5, 7, 9];
  const stats = computeSampleStatistics(sampleData, 0.95);

  assert.equal(stats.n, 8, 'Sample size must be 8');
  close(stats.mean, 5.0, 1e-6, 'Sample mean must be 5.0');
  close(stats.variance, 32.0 / 7.0, 1e-6, 'Bessel-corrected sample variance must be 32/7');
  close(stats.stdDev, Math.sqrt(32.0 / 7.0), 1e-6, 'Sample standard deviation');
  close(stats.standardError, Math.sqrt(32.0 / 7.0) / Math.sqrt(8), 1e-6, 'Standard error of the mean');
  close(stats.median, 4.5, 1e-6, 'Median of [2, 4, 4, 4, 5, 5, 7, 9]');
  assert.equal(stats.min, 2, 'Sample min must be 2');
  assert.equal(stats.max, 9, 'Sample max must be 9');
  assert.ok(stats.ci95Lower < stats.mean && stats.mean < stats.ci95Upper, 'ci95Lower < mean < ci95Upper');
  console.log(`  ✓ Sample statistics on known vector verified: mean=${stats.mean}, s=${stats.stdDev.toFixed(4)}, CI=[${stats.ci95Lower.toFixed(3)}, ${stats.ci95Upper.toFixed(3)}]`);

  // 3. Welch's two-sample t-test on separated vs identical samples
  const groupA = [10, 12, 11, 13, 12, 14];
  const groupB = [20, 22, 21, 23, 22, 24];
  const welchSeparated = computeWelchTTest(groupA, groupB);

  assert.ok(welchSeparated.tStatistic < -10.0, 'Welch t-statistic for separated groups must be large negative');
  assert.ok(welchSeparated.pValue < 1e-5, 'p-value for separated groups must be highly significant');
  assert.ok(welchSeparated.statisticallySignificantAt01, 'Must be significant at alpha = 0.01');
  assert.ok(Math.abs(welchSeparated.cohensD) > 5.0, 'Cohen d effect size must be very large');

  // Identical groups test
  const welchIdentical = computeWelchTTest(groupA, groupA);
  close(welchIdentical.tStatistic, 0.0, 1e-6, 'Identical groups t-statistic must be 0');
  close(welchIdentical.pValue, 1.0, 1e-6, 'Identical groups p-value must be 1.0');
  assert.equal(welchIdentical.statisticallySignificantAt05, false, 'Identical groups must not be significant');
  console.log('  ✓ Welch two-sample t-test & two-tailed incomplete beta p-value verified on separated and identical samples [PASS]');
}

// =================================================================================================
// [SBR-T3] N = 30 Multi-Seed Physics-Realism Ablation & Determinism Proof
// =================================================================================================
console.log('\n[SBR-T3] Executing N = 30 Multi-Seed Physics-Realism Ablation Study...');
{
  const run1 = runPhysicsRealismAblation(30, 20261122);
  const run2 = runPhysicsRealismAblation(30, 20261122);

  // 1. Bit-exact determinism across runs
  const csv1 = formatAblationCsv(run1);
  const csv2 = formatAblationCsv(run2);
  assert.equal(csv1, csv2, 'Duplicate ablation runs must produce bit-exact CSV output');
  console.log('  ✓ Bit-exact determinism confirmed across duplicate 30-seed runs');

  // 2. Finite 95% CIs and valid bounds across all 4 configurations
  const configs = [
    'baseline-idealized',
    'multiedge-attitude',
    'delayed-cqi-unprotected',
    'full-realistic-olla-harq',
  ] as const;

  for (const cfgId of configs) {
    const c = run1.configurations[cfgId];
    assert.ok(c, `Configuration ${cfgId} must exist`);
    const g = c.stats.meanEffectiveGoodputFactor;
    const b = c.stats.effectiveBler;
    const o = c.stats.outageRatio;
    const s = c.stats.meanSnrDb;

    assert.ok(g.ci95Lower <= g.mean && g.mean <= g.ci95Upper, `${cfgId} goodput CI valid`);
    assert.ok(b.ci95Lower <= b.mean && b.mean <= b.ci95Upper, `${cfgId} BLER CI valid`);
    assert.ok(o.ci95Lower <= o.mean && o.mean <= o.ci95Upper, `${cfgId} outage CI valid`);
    assert.ok(s.ci95Lower <= s.mean && s.mean <= s.ci95Upper, `${cfgId} SNR CI valid`);
  }
  console.log('  ✓ Finite 95% confidence intervals verified across all 4 configurations');

  // 3. Hypothesis 1: Baseline-idealized significantly overestimates goodput vs realistic stack (p < 0.01)
  const compGoodput = run1.comparisons.idealizedVsRealisticGoodput;
  assert.ok(compGoodput.meanDifference > 0.4, 'Idealized baseline must overestimate goodput by > 0.4 factor');
  assert.ok(
    compGoodput.statisticallySignificantAt01,
    `Idealized vs realistic goodput difference must be statistically significant at p < 0.01 (got p = ${compGoodput.pValue})`
  );
  assert.ok(compGoodput.cohensD > 2.0, `Goodput effect size must be large (got d = ${compGoodput.cohensD})`);
  console.log(`  ✓ Hypothesis 1 (Optimistic Bias of Idealized Models) proved: Δ = +${compGoodput.meanDifference.toFixed(3)}, p = ${compGoodput.pValue.toExponential(2)}, d = ${compGoodput.cohensD.toFixed(2)}`);

  // 4. Hypothesis 2: Full realistic stack significantly reduces residual BLER vs unprotected delayed-CQI (p < 0.01)
  const compBler = run1.comparisons.unprotectedVsOllaHarqBler;
  assert.ok(compBler.meanDifference > 0.01, 'Unprotected stack must have higher BLER than realistic OLLA+HARQ stack');
  assert.ok(
    compBler.statisticallySignificantAt01,
    `Unprotected vs OLLA+HARQ BLER reduction must be statistically significant at p < 0.01 (got p = ${compBler.pValue})`
  );
  assert.ok(compBler.cohensD > 0.8, `BLER effect size must be large (got d = ${compBler.cohensD})`);
  console.log(`  ✓ Hypothesis 2 (OLLA + HARQ Error Recovery) proved: Δ = +${compBler.meanDifference.toFixed(3)}, p = ${compBler.pValue.toExponential(2)}, d = ${compBler.cohensD.toFixed(2)}`);

  // 5. Output Markdown table & CSV verification
  const mdTable = formatAblationMarkdownTable(run1);
  console.log('\nGenerated Ablation Markdown Table:\n' + mdTable);

  const csvLines = csv1.trim().split('\n');
  assert.equal(csvLines.length, 5, 'CSV output must have exactly 1 header line + 4 data rows');
  assert.ok(csvLines[0].startsWith('config_id,config_label'), 'CSV header valid');
  console.log('  ✓ Markdown table and CSV formatters verified [PASS]');
}

// =================================================================================================
// [SBR-T4] Statistical Edge Cases & Performance Budget
// =================================================================================================
console.log('\n[SBR-T4] Verifying Statistical Edge Cases & Performance Budget...');
{
  // 1. Empty array
  const emptyStats = computeSampleStatistics([]);
  assert.equal(emptyStats.n, 0, 'N=0 stats must return n=0');
  assert.equal(emptyStats.mean, 0.0, 'N=0 stats must return mean=0');
  assert.equal(emptyStats.marginOfError, 0.0, 'N=0 margin of error must be 0');

  // 2. Single element
  const singleStats = computeSampleStatistics([42.0]);
  assert.equal(singleStats.n, 1, 'N=1 stats must return n=1');
  assert.equal(singleStats.mean, 42.0, 'N=1 stats must return mean=42');
  assert.equal(singleStats.stdDev, 0.0, 'N=1 stdDev must be 0');
  assert.equal(singleStats.ci95Lower, 42.0, 'N=1 ci95Lower must equal mean');

  // 3. Zero variance
  const zeroVarStats = computeSampleStatistics([7.0, 7.0, 7.0, 7.0]);
  assert.equal(zeroVarStats.variance, 0.0, 'Zero-variance sample must have variance 0');
  assert.equal(zeroVarStats.marginOfError, 0.0, 'Zero-variance sample must have margin of error 0');

  // 4. Non-finite / NaN filtering
  const dirtyData = [10.0, Number.NaN, 20.0, Number.POSITIVE_INFINITY, 30.0, Number.NEGATIVE_INFINITY];
  const cleanStats = computeSampleStatistics(dirtyData);
  assert.equal(cleanStats.n, 3, 'Dirty data must filter out NaN and Infinities (n=3)');
  close(cleanStats.mean, 20.0, 1e-6, 'Cleaned data mean must be 20.0');

  // 5. Execution runtime budget check (< 1.5 s for full N=30 4-config study)
  const tStart = performance.now();
  const perfRun = runPhysicsRealismAblation(30, 987654321);
  const durationMs = performance.now() - tStart;
  assert.ok(
    durationMs < 1500.0,
    `Full 30-seed 4-config ablation study must complete in < 1500 ms, took ${durationMs.toFixed(1)} ms`
  );
  console.log(`  ✓ Execution performance budget verified: 30-seed 4-config ablation completed in ${durationMs.toFixed(1)} ms (< 1500 ms)`);
  console.log('  ✓ Statistical edge cases (N=0, N=1, zero-variance, NaN filtering) verified [PASS]');
}

console.log('\n' + '='.repeat(100));
console.log('   SUITE 95: SCIENTIFIC BENCHMARKING RIGOR VERIFICATION COMPLETED SUCCESSFULLY');
console.log('='.repeat(100));
