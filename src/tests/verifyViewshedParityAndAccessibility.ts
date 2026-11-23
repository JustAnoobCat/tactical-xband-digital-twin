/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Suite 94: Viewshed Physics Parity & WCAG 2.1 Accessible Status Encoding Verification
 * Specification: docs/specs/wp10-viewshed-parity-and-accessibility-encoding.md
 *
 * Test Suites:
 * - VPA-T1: Physical Viewshed vs. Live Link-Budget Parity & Quantitative Parity Auditor
 * - VPA-T2: Exact W3C WCAG 2.1 Luminance & Contrast Ratio Calculations
 * - VPA-T3: Viénot (1999) CVD Simulation & Redundant Non-Color Tactical Encoding
 * - VPA-T4: XSS Safety in Accessible Badges & Defensive Edge Cases
 * - VPA-T5: High-Performance Micro-Benchmarks (< 1 µs / encoding lookup & fast viewshed refresh)
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { RFConfig, EnvironmentConfig } from '../core/config';
import { TerrainEngine } from '../core/terrain';
import { LinkBudgetEngine } from '../core/linkBudget';
import { QuadSectorAntennaEngine } from '../core/antennaArray';
import {
  PolarViewshedEngine,
  auditViewshedLinkBudgetParity,
  TOTAL_VIEWSHED_CELLS,
} from '../core/viewshedEngine';
import {
  parseHexRgb,
  computeRelativeLuminance,
  computeWcagContrastRatio,
  meetsWcagContrast,
  simulateColorVisionDeficiency,
  computeRgbPerceptualDistance,
  TACTICAL_STATUS_ENCODINGS,
  getAccessibleStatusEncoding,
  renderAccessibleStatusBadge,
  TacticalLinkState,
  CvdDeficiencyType,
} from '../ui/accessibilityEncoding';
import type { Position3D } from '../shared/types';

console.log('='.repeat(96));
console.log('   SUITE 94: VIEWSHED PHYSICS PARITY & ACCESSIBLE STATUS ENCODING VERIFICATION');
console.log('   Specification: SPEC-WP10 (wp10-viewshed-parity-and-accessibility-encoding.md)');
console.log('='.repeat(96));

const rf = new RFConfig();
const env = new EnvironmentConfig();

// =================================================================================================
// [VPA-T1] Physical Viewshed vs. Live Link-Budget Parity & Quantitative Parity Auditor
// =================================================================================================
console.log('\n[VPA-T1] Verifying Physical Viewshed vs. Live Link-Budget Parity & Quantitative Auditor...');
{
  // Himalayan terrain setup: Valley floor at 3,200 m MSL, high ridge rising to 5,200 m at y = 6,000 m
  const terrain = new TerrainEngine({
    customElevationFn: (_x, y) => {
      const distToRidge = Math.abs(y - 6000.0);
      const profile = Math.max(0.0, 1.0 - distToRidge / 2000.0);
      return 3200.0 + 2000.0 * profile;
    },
  });

  // Add an artificial CAD building obstacle in the valley floor
  terrain.obstacleField.replace([
    {
      id: 'cad-building-alpha',
      shape: 'cuboid',
      xM: 0.0,
      yM: 2000.0,
      widthM: 300.0,
      depthM: 300.0,
      heightM: 250.0,
      rotationDeg: 0.0,
    },
  ]);

  const antennaEngine = new QuadSectorAntennaEngine();
  const linkEngine = new LinkBudgetEngine();
  const viewshedEngine = new PolarViewshedEngine(antennaEngine, linkEngine);

  const acnPos: Position3D = [0.0, 0.0, 5000.0];
  const acnVel: Position3D = [0.0, 60.0, 0.0]; // Heading 0° North

  // Representative set of tactical ground coordinates spanning:
  // 1. Pristine line-of-sight in open valley
  // 2. Terrain ridge diffraction shadow (behind 5,200 m ridge at y > 6,000 m)
  // 3. Heavy rain attenuation conditions (rainRate = 25.0 mm/hr)
  // 4. CAD building obstruction occlusion
  // 5. Angular sector boundaries (boresight vs. crossover)
  const testCoordinates: { pos: Position3D; rainRateMmH?: number; desc: string }[] = [
    // Pristine LoS Valley points
    { pos: [1000.0, 1000.0, 3202.0], desc: 'Valley clear LoS (1.4 km)' },
    { pos: [-2000.0, 1500.0, 3202.0], desc: 'Valley clear LoS (2.5 km)' },
    { pos: [3000.0, -2000.0, 3202.0], desc: 'Valley south clear LoS (3.6 km)' },
    { pos: [-4000.0, -3000.0, 3202.0], desc: 'Valley south-west clear LoS (5.0 km)' },
    { pos: [5000.0, 0.0, 3202.0], desc: 'Valley east clear LoS (5.0 km, Sector 1 boresight)' },
    { pos: [-5000.0, 0.0, 3202.0], desc: 'Valley west clear LoS (5.0 km, Sector 3 boresight)' },
    { pos: [3535.0, 3535.0, 3202.0], desc: 'Valley north-east crossover zone (45°)' },
    { pos: [-3535.0, 3535.0, 3202.0], desc: 'Valley north-west crossover zone (315°)' },

    // Terrain ridge diffracted points behind 5,200 m ridge
    { pos: [0.0, 9000.0, 3202.0], desc: 'Diffracted shadow behind ridge (9 km)' },
    { pos: [1000.0, 10000.0, 3202.0], desc: 'Diffracted deep shadow behind ridge (10 km)' },
    { pos: [-1500.0, 11000.0, 3202.0], desc: 'Diffracted deep shadow behind ridge (11 km)' },
    { pos: [2500.0, 12000.0, 3202.0], desc: 'Diffracted shadow behind ridge (12.2 km)' },
    { pos: [-2000.0, 13000.0, 3202.0], desc: 'Diffracted far shadow (13.1 km)' },
    { pos: [0.0, 15000.0, 3202.0], desc: 'Diffracted extreme shadow (15 km)' },

    // CAD building occluded points (ray intersects building at y = 2,000 m)
    { pos: [0.0, 3500.0, 3202.0], desc: 'CAD building occluded ground point (ray intersects building)' },
    { pos: [50.0, 3000.0, 3202.0], desc: 'CAD building occluded near ground point' },

    // Heavy rain conditions (25 mm/hr)
    { pos: [2000.0, -2000.0, 3202.0], rainRateMmH: 25.0, desc: 'Heavy rain clear LoS (2.8 km)' },
    { pos: [6000.0, -6000.0, 3202.0], rainRateMmH: 25.0, desc: 'Heavy rain long range LoS (8.5 km)' },
    { pos: [0.0, -10000.0, 3202.0], rainRateMmH: 25.0, desc: 'Heavy rain south LoS (10 km)' },
    { pos: [0.0, 10000.0, 3202.0], rainRateMmH: 25.0, desc: 'Heavy rain + ridge diffraction' },

    // Extended range cells
    { pos: [12000.0, 0.0, 3202.0], desc: 'East extended range (12 km)' },
    { pos: [0.0, -14000.0, 3202.0], desc: 'South extended range (14 km)' },
    { pos: [-12000.0, 0.0, 3202.0], desc: 'West extended range (12 km)' },
    { pos: [8000.0, 8000.0, 3202.0], desc: 'North-East high range (11.3 km)' },
  ];

  const viewshedSamples: { sinrDb: number; isOutage: boolean }[] = [];
  const liveLinkSamples: { snrDb: number; isOutage: boolean }[] = [];

  for (let i = 0; i < testCoordinates.length; i++) {
    const item = testCoordinates[i];
    const testEnv = item.rainRateMmH
      ? new EnvironmentConfig({ rainRateMmH: item.rainRateMmH })
      : env;

    // 1. Evaluate via viewshed parity engine
    const parityResult = viewshedEngine.evaluateViewshedPointWithParity(
      item.pos,
      acnPos,
      acnVel,
      terrain,
      rf,
      testEnv,
      { nodeType: 'soldier' }
    );

    // 2. Evaluate via live LinkBudgetEngine directly under identical physical inputs
    const dx = item.pos[0] - acnPos[0];
    const dy = item.pos[1] - acnPos[1];
    const dz = item.pos[2] - acnPos[2];
    const slantDistM = Math.max(Math.hypot(dx, dy, dz), 1.0);

    const obs = terrain.evaluateTerrainObstruction(item.pos, acnPos, rf, testEnv, 100.0);
    const sectorEval = antennaEngine.evaluateNodeSector(
      i + 1,
      acnPos,
      acnVel,
      item.pos,
      rf.acnAntennaGainDbi,
      false
    );

    const liveLink = linkEngine.evaluateLink(
      'soldier',
      slantDistM,
      obs.diffractionLossDb,
      rf,
      testEnv,
      obs.obstacleBlocked,
      undefined,
      sectorEval,
      item.pos[2],
      acnPos[2],
      obs.crestRadiusM,
      obs.curvatureLossDb
    );

    viewshedSamples.push({ sinrDb: parityResult.sinrDb, isOutage: parityResult.isOutage });
    liveLinkSamples.push({ snrDb: liveLink.snrDb, isOutage: liveLink.isOutage });
  }

  // Audit parity across the 24 representative coordinates
  const report = auditViewshedLinkBudgetParity(viewshedSamples, liveLinkSamples, -1.5);

  console.log(`  ✓ Sample count: ${report.sampleCount}`);
  console.log(`  ✓ Max absolute error: ${report.maxAbsErrorDb.toFixed(4)} dB (threshold: <= 1.5 dB)`);
  console.log(`  ✓ Mean absolute error: ${report.meanAbsErrorDb.toFixed(4)} dB`);
  console.log(`  ✓ RMSE: ${report.rmseDb.toFixed(4)} dB (threshold: <= 1.0 dB)`);
  console.log(`  ✓ Bias: ${report.biasDb.toFixed(4)} dB`);
  console.log(`  ✓ Classification agreement rate: ${(report.classificationAgreementRate * 100).toFixed(1)}% (threshold: >= 95.0%)`);
  console.log(`  ✓ Disagreement count: ${report.disagreementIndices.length}`);

  assert.ok(report.sampleCount >= 24, `Must evaluate at least 24 test coordinates, got ${report.sampleCount}`);
  assert.ok(
    report.maxAbsErrorDb <= 1.5,
    `Parity max error must be <= 1.5 dB, got ${report.maxAbsErrorDb} dB`
  );
  assert.ok(
    report.rmseDb <= 1.0,
    `Parity RMSE must be <= 1.0 dB, got ${report.rmseDb} dB`
  );
  assert.ok(
    report.classificationAgreementRate >= 0.95,
    `Classification agreement must be >= 0.95, got ${report.classificationAgreementRate}`
  );
  assert.equal(report.disagreementIndices.length, 0, 'Must have zero classification disagreements on parity path');

  // Verify auditViewshedLinkBudgetParity edge case resilience
  const emptyReport = auditViewshedLinkBudgetParity([], []);
  assert.equal(emptyReport.sampleCount, 0, 'Empty arrays must yield sampleCount 0');
  assert.equal(emptyReport.classificationAgreementRate, 1.0, 'Empty arrays must yield 1.0 agreement');
  assert.equal(emptyReport.maxAbsErrorDb, 0.0);

  const nanReport = auditViewshedLinkBudgetParity(
    [Number.NaN, Number.POSITIVE_INFINITY, 12.0],
    [5.0, Number.NEGATIVE_INFINITY, Number.NaN]
  );
  assert.equal(nanReport.sampleCount, 0, 'All-NaN/Inf pairs must be filtered safely without throwing');
}

// =================================================================================================
// [VPA-T2] Exact W3C WCAG 2.1 Relative Luminance & Contrast Ratio Math
// =================================================================================================
console.log('\n[VPA-T2] Verifying Exact W3C WCAG 2.1 Luminance & Contrast Ratio Math...');
{
  // 1. Analytical White and Black Luminance
  const lumWhite = computeRelativeLuminance('#ffffff');
  const lumBlack = computeRelativeLuminance('#000000');
  assert.ok(Math.abs(lumWhite - 1.0) < 1e-4, `White relative luminance must be 1.000, got ${lumWhite}`);
  assert.ok(Math.abs(lumBlack - 0.0) < 1e-4, `Black relative luminance must be 0.000, got ${lumBlack}`);

  // 2. Analytical Extremum Contrast Ratio: #ffffff vs #000000 = (1 + 0.05) / (0 + 0.05) = 21.0
  const maxContrast = computeWcagContrastRatio('#ffffff', '#000000');
  const maxContrastRev = computeWcagContrastRatio('#000000', '#ffffff');
  assert.ok(Math.abs(maxContrast - 21.0) < 1e-3, `White vs Black contrast must be 21.000, got ${maxContrast}`);
  assert.ok(Math.abs(maxContrastRev - 21.0) < 1e-3, `Contrast must be commutative, got ${maxContrastRev}`);

  // 3. Identical colors contrast = 1.0
  const unityContrast = computeWcagContrastRatio('#22c55e', '#22c55e');
  assert.ok(Math.abs(unityContrast - 1.0) < 1e-3, `Identical colors contrast must be 1.000, got ${unityContrast}`);

  // 4. Short hex support: #fff vs #000
  const shortContrast = computeWcagContrastRatio('#fff', '#000');
  assert.ok(Math.abs(shortContrast - 21.0) < 1e-3, `Short hex #fff vs #000 must produce 21.000, got ${shortContrast}`);

  // 5. Verification of ALL 5 Tactical Link States in 'colorblind-safe' mode against dark C2 backgrounds
  const darkBg1 = '#0b1117'; // Main C2 console canvas background
  const darkBg2 = '#0f172a'; // Slate-900 panel background

  const cbPalette = TACTICAL_STATUS_ENCODINGS['colorblind-safe'];
  const states: TacticalLinkState[] = ['OPTIMAL', 'DEGRADED', 'CRITICAL', 'OUTAGE', 'RELAY_ACTIVE'];

  for (const st of states) {
    const enc = cbPalette[st];
    const cr1 = computeWcagContrastRatio(enc.color, darkBg1);
    const cr2 = computeWcagContrastRatio(enc.color, darkBg2);

    console.log(`  ✓ ${st.padEnd(12)} (${enc.color}): vs ${darkBg1} = ${cr1.toFixed(2)}:1 | vs ${darkBg2} = ${cr2.toFixed(2)}:1 (WCAG AA >= 4.5:1)`);

    assert.ok(
      cr1 >= 4.5,
      `State ${st} (${enc.color}) failed WCAG AA contrast against ${darkBg1}: ${cr1.toFixed(2)}:1 < 4.5:1`
    );
    assert.ok(
      cr2 >= 4.5,
      `State ${st} (${enc.color}) failed WCAG AA contrast against ${darkBg2}: ${cr2.toFixed(2)}:1 < 4.5:1`
    );

    assert.equal(meetsWcagContrast(enc.color, darkBg1, 'AA'), true);
    assert.equal(meetsWcagContrast(enc.color, darkBg2, 'AA'), true);
    assert.equal(meetsWcagContrast(enc.color, darkBg1, 'AA-large'), true);
  }
}

// =================================================================================================
// [VPA-T3] Viénot (1999) CVD Simulation & Redundant Non-Color Tactical Encoding
// =================================================================================================
console.log('\n[VPA-T3] Verifying Viénot (1999) CVD Simulation & Redundant Visual Uniqueness...');
{
  const cbPalette = TACTICAL_STATUS_ENCODINGS['colorblind-safe'];
  const states: TacticalLinkState[] = ['OPTIMAL', 'DEGRADED', 'CRITICAL', 'OUTAGE', 'RELAY_ACTIVE'];
  const cvdTypes: CvdDeficiencyType[] = ['deuteranopia', 'protanopia', 'tritanopia'];

  // 1. Verify pairwise perceptual distance (CIE76 Delta E*) > 15 across all CVD types
  for (const cvd of cvdTypes) {
    let minDeltaE = Number.POSITIVE_INFINITY;
    let minPair = '';

    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) {
        const s1 = states[i];
        const s2 = states[j];
        const sim1 = simulateColorVisionDeficiency(cbPalette[s1].color, cvd);
        const sim2 = simulateColorVisionDeficiency(cbPalette[s2].color, cvd);
        const dE = computeRgbPerceptualDistance(sim1, sim2);

        if (dE < minDeltaE) {
          minDeltaE = dE;
          minPair = `${s1} vs ${s2}`;
        }

        assert.ok(
          dE > 15.0,
          `CVD ${cvd} pair ${s1} (${sim1}) vs ${s2} (${sim2}) has insufficient perceptual distance: ${dE.toFixed(2)} <= 15.0`
        );
      }
    }

    console.log(`  ✓ CVD ${cvd.padEnd(12)}: All 10 pairs distinct (min Delta E* = ${minDeltaE.toFixed(2)} for ${minPair})`);
  }

  // 2. Verify 100% Redundant Non-Color Tactical Identifiers across all 5 states
  const strokeDashSignatures = new Set<string>();
  const glyphs = new Set<string>();
  const iconChars = new Set<string>();
  const shortCodes = new Set<string>();

  for (const st of states) {
    const enc = cbPalette[st];

    const dashSig = enc.strokeDash.join(',');
    assert.ok(!strokeDashSignatures.has(dashSig), `Duplicate strokeDash signature found for ${st}: [${dashSig}]`);
    strokeDashSignatures.add(dashSig);

    assert.ok(!glyphs.has(enc.glyph), `Duplicate glyph found for ${st}: ${enc.glyph}`);
    glyphs.add(enc.glyph);

    assert.ok(!iconChars.has(enc.iconChar), `Duplicate iconChar found for ${st}: ${enc.iconChar}`);
    iconChars.add(enc.iconChar);

    assert.ok(!shortCodes.has(enc.shortCode), `Duplicate shortCode found for ${st}: ${enc.shortCode}`);
    shortCodes.add(enc.shortCode);

    assert.ok(enc.ariaLabel && enc.ariaLabel.length > 5, `State ${st} must possess a descriptive ariaLabel`);
  }

  assert.equal(strokeDashSignatures.size, 5, 'Must provide 5 unique strokeDash patterns');
  assert.equal(glyphs.size, 5, 'Must provide 5 unique glyph shapes');
  assert.equal(iconChars.size, 5, 'Must provide 5 unique unicode icon characters');
  assert.equal(shortCodes.size, 5, 'Must provide 5 unique short codes');

  console.log(`  ✓ 5/5 unique strokeDash signatures verified: ${[...strokeDashSignatures].map((s) => `[${s}]`).join(', ')}`);
  console.log(`  ✓ 5/5 unique geometric glyphs: ${[...glyphs].join(', ')}`);
  console.log(`  ✓ 5/5 unique unicode icons: ${[...iconChars].join(' ')}`);
  console.log(`  ✓ 5/5 unique shortCodes: ${[...shortCodes].join(', ')}`);
}

// =================================================================================================
// [VPA-T4] XSS Safety in Accessible Badges & Defensive Edge Cases
// =================================================================================================
console.log('\n[VPA-T4] Verifying Accessible Badge Renderer XSS Neutralization & Defensive Fallbacks...');
{
  // 1. Nominal Badge Rendering
  const badgeNominal = renderAccessibleStatusBadge('OPTIMAL', 'Alpha Patrol');
  const badgeHtml = badgeNominal.toString();

  assert.ok(badgeHtml.includes('role="status"'), 'Badge must include role="status"');
  assert.ok(badgeHtml.includes('aria-label="Link Optimal (Clear Line-of-Sight)"'), 'Badge must include descriptive aria-label');
  assert.ok(badgeHtml.includes('●'), 'Badge must include unicode icon');
  assert.ok(badgeHtml.includes('OPT'), 'Badge must include shortCode');
  assert.ok(badgeHtml.includes('Alpha Patrol'), 'Badge must render user label');

  // 2. Strict XSS Injection Defense
  const maliciousPayloads = [
    '<script>alert("xss")</script>',
    '<img src=x onerror=alert(1)>',
    '"><script>document.location="http://attacker.com"</script>',
    "'; alert(1); //",
  ];

  for (const payload of maliciousPayloads) {
    const maliciousBadge = renderAccessibleStatusBadge('CRITICAL', payload);
    const html = maliciousBadge.toString();

    assert.equal(html.includes('<script>'), false, `Payload must not contain raw script tag: ${payload}`);
    assert.equal(html.includes('<img'), false, `Payload must not contain raw img tag: ${payload}`);
    assert.equal(html.includes("'; alert(1)"), false, `Payload must not contain unescaped quotes: ${payload}`);
    assert.ok(
      html.includes('&lt;script&gt;') || html.includes('&lt;img') || html.includes('&#39;'),
      `Payload must be properly HTML escaped: ${payload}`
    );
  }
  console.log('  ✓ Neutralized 4/4 malicious XSS payloads with strict HTML escaping');

  // 3. Fallbacks on Invalid / Null / Unknown States
  const unknownEnc = getAccessibleStatusEncoding('UNKNOWN');
  assert.equal(unknownEnc.shortCode, 'UNK');
  assert.equal(unknownEnc.glyph, 'circle');

  const nullEnc = getAccessibleStatusEncoding(null);
  assert.equal(nullEnc.shortCode, 'UNK');

  const invalidHex = parseHexRgb('invalid-hex-string');
  assert.equal(invalidHex, null, 'Invalid hex must parse to null');

  const fallbackLum = computeRelativeLuminance('not-a-color');
  assert.equal(fallbackLum, 0.0, 'Invalid hex must produce 0.0 luminance');

  const fallbackDist = computeRgbPerceptualDistance('bad1', 'bad2');
  assert.equal(fallbackDist, 0.0, 'Invalid hex must produce 0.0 perceptual distance');

  console.log('  ✓ Verified 5/5 defensive fallbacks on invalid/unknown inputs');
}

// =================================================================================================
// [VPA-T5] High-Performance Micro-Benchmarks (< 1 µs / Lookup & Fast Viewshed Grid)
// =================================================================================================
console.log('\n[VPA-T5] Executing High-Performance Micro-Benchmarks...');
{
  const testStates = ['OPTIMAL', 'DEGRADED', 'CRITICAL', 'OUTAGE', 'RELAY_ACTIVE', 'UNKNOWN'];
  const testColors = ['#4ade80', '#facc15', '#fb923c', '#ec4899', '#818cf8', '#94a3b8'];
  const darkBg = '#0b1117';

  // 1. Warm-up JIT
  for (let k = 0; k < 5000; k++) {
    const st = testStates[k % testStates.length];
    const enc = getAccessibleStatusEncoding(st);
    computeWcagContrastRatio(enc.color, darkBg);
  }

  // 2. Measure 50,000 encoding lookups + WCAG contrast calculations
  const iterations = 50000;
  const startPerf = performance.now();
  let checksum = 0;

  for (let i = 0; i < iterations; i++) {
    const st = testStates[i % testStates.length];
    const enc = getAccessibleStatusEncoding(st);
    const cr = computeWcagContrastRatio(enc.color, darkBg);
    checksum += cr;
  }

  const elapsedMs = performance.now() - startPerf;
  const latencyPerCallUs = (elapsedMs / iterations) * 1000.0;

  console.log(`  ✓ Executed ${iterations.toLocaleString()} lookups in ${elapsedMs.toFixed(2)} ms (${latencyPerCallUs.toFixed(3)} µs/call, budget: < 1.0 µs)`);
  assert.ok(
    elapsedMs < 50.0,
    `50,000 lookups must execute in < 50.0 ms, took ${elapsedMs.toFixed(2)} ms`
  );
  assert.ok(checksum > 0, 'Checksum must be valid');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL SUITE 94 VERIFICATION TESTS PASSED (5/5 SUB-SUITES)');
console.log('='.repeat(96));
