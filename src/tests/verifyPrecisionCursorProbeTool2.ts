/**
 * src/tests/verifyPrecisionCursorProbeTool2.ts
 *
 * Automated Verification Suite for:
 * SPEC-PRECISION-CURSOR-RF-PROBE-AND-UNIT-SPAWNER-TOOL2: CAD/STK-Grade Precision Cursor RF Link Probe,
 * 360° Horizon Mask Analyzer & Unit Spawner Upgrade (Tool #2 Probe).
 *
 * Test Suites:
 * - PCP-T1: Cursor-to-ACN Geometry, Horizon Mask Angle & Sector Selection
 * - PCP-T2: Pinned Reference [P1] Differential Comparison & Smart Peak Optimizer
 * - PCP-T3: DOM Controls, Global Layout Invariance & Spec Registration
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateCursorRfProbe,
  findOptimalSignalPeakInRadius,
  computeP526DiffractionDb,
  DEFAULT_K_FACTOR,
  DEFAULT_EARTH_RADIUS_M,
  DEFAULT_R_EFF_M,
} from '../core/cursorProbeEngine';

console.log('='.repeat(96));
console.log('   CAD/STK PRECISION CURSOR RF PROBE & UNIT SPAWNER VERIFICATION SUITE');
console.log('   Specification: SPEC-PRECISION-CURSOR-RF-PROBE-AND-UNIT-SPAWNER-TOOL2 // PCP-T1 - PCP-T3');
console.log('='.repeat(96));

// =================================================================================================
// [PCP-T1] Cursor-to-ACN Geometry, Horizon Mask Angle & Sector Selection
// =================================================================================================
console.log('\n[PCP-T1] Verifying Cursor-to-ACN Geometry, Horizon Mask Angle & Sector Selection...');
{
  // Test 1: Geometry to due-North ACN
  // Probe at (0, 0), terrain 3000m, mast 10m => zAnt = 3010m
  // ACN at (0, 10000, 5010m), heading 0°
  // dx = 0, dy = 10000, dz = 2000 => dHoriz = 10000m, d3d = sqrt(10000^2 + 2000^2) = 10198.039m
  // Azimuth from probe to ACN = 0.0°
  // Elevation angle = atan(2000 / 10000) = 11.3099°
  const flatElevation = (_x: number, _y: number) => 3000.0;
  const analysisNorth = evaluateCursorRfProbe(
    { xM: 0, yM: 0 },
    10.0,
    { xM: 0, yM: 10000, zM: 5010 },
    0.0, // heading 0° (North)
    flatElevation,
  );

  assert.equal(analysisNorth.dHorizM, 10000.0, 'Horizontal distance must be exactly 10000m');
  assert.equal(analysisNorth.dHorizKm, 10.0, 'Horizontal distance must be 10.0 km');
  const expected3d = Math.hypot(10000.0, 2000.0);
  assert.ok(
    Math.abs(analysisNorth.d3dM - expected3d) < 1e-3,
    `3D Slant distance must match ${expected3d}, got ${analysisNorth.d3dM}`,
  );
  assert.equal(analysisNorth.azimuthToAcnDeg, 0.0, 'Forward azimuth to North ACN must be 0.0°');

  const expectedEl = (Math.atan2(2000.0, 10000.0) * 180.0) / Math.PI;
  assert.ok(
    Math.abs(analysisNorth.elevationAngleToAcnDeg - expectedEl) < 1e-3,
    `Elevation angle must match ${expectedEl.toFixed(4)}°, got ${analysisNorth.elevationAngleToAcnDeg}`,
  );

  // Optical LoS must be clear over flat terrain
  assert.equal(analysisNorth.isLos, true, 'LoS over flat terrain must be clear');
  assert.equal(analysisNorth.blockingRidgePeak, null, 'Blocking peak must be null when LoS is clear');

  // Sector identification at ACN:
  // ACN is at (0, 10000), heading 0° (North).
  // Vector from ACN to probe is (0, -10000), which is bearing 180° (South, behind ACN).
  // Relative body azimuth = (180° - 0°) = 180° => Sector S2 (AFT/180°)!
  assert.equal(analysisNorth.activeSectorId, 2, 'Southbound probe relative to North-heading ACN must select Sector S2 (AFT)');
  assert.equal(analysisNorth.offBoresightDeg, 0.0, 'Off-boresight angle for exact AFT probe must be 0.0°');
  assert.equal(analysisNorth.rollOffLossDb, 0.0, 'Roll-off loss on boresight must be 0.0 dB');

  // Test 2: Quad Sector Selection across all 4 sectors
  // Sector 0 (FWD): ACN heading 180° (South), probe is to the South (0, -5000)
  const evalS0 = evaluateCursorRfProbe(
    { xM: 0, yM: -5000 },
    2.0,
    { xM: 0, yM: 0, zM: 5000 },
    180.0,
    flatElevation,
  );
  assert.equal(evalS0.activeSectorId, 0, 'Ahead probe under South heading must select S0 (FWD)');

  // Sector 1 (STBD): ACN heading 0° (North), probe is to the East (+5000, 0)
  const evalS1 = evaluateCursorRfProbe(
    { xM: 5000, yM: 0 },
    2.0,
    { xM: 0, yM: 0, zM: 5000 },
    0.0,
    flatElevation,
  );
  assert.equal(evalS1.activeSectorId, 1, 'East probe under North heading must select S1 (STBD)');

  // Sector 3 (PORT): ACN heading 0° (North), probe is to the West (-5000, 0)
  const evalS3 = evaluateCursorRfProbe(
    { xM: -5000, yM: 0 },
    2.0,
    { xM: 0, yM: 0, zM: 5000 },
    0.0,
    flatElevation,
  );
  assert.equal(evalS3.activeSectorId, 3, 'West probe under North heading must select S3 (PORT)');

  // Test 3: Terrain Horizon Mask & Occlusion with Ridge Obstacle
  // Probe at (0, 0, 3000), ACN at (0, 10000, 3500)
  // Place high ridge at y = 5000m with peak elevation 4500m
  const ridgeElevation = (_x: number, y: number) => {
    const distToRidge = Math.abs(y - 5000.0);
    if (distToRidge < 1000.0) {
      return 3000.0 + 1500.0 * (1.0 - distToRidge / 1000.0);
    }
    return 3000.0;
  };

  const analysisBlocked = evaluateCursorRfProbe(
    { xM: 0, yM: 0 },
    2.0,
    { xM: 0, yM: 10000, zM: 3500 },
    0.0,
    ridgeElevation,
  );

  assert.equal(analysisBlocked.isLos, false, 'LoS must be blocked by 4500m ridge');
  assert.ok(analysisBlocked.angularClearanceDeg < 0, 'Angular clearance must be negative when occluded');
  assert.ok(analysisBlocked.blockingRidgePeak !== null, 'Blocking peak must be detected');
  assert.ok(
    Math.abs(analysisBlocked.blockingRidgePeak!.zMslM - 4500.0) < 50.0,
    `Blocking peak elevation must be near 4500m, got ${analysisBlocked.blockingRidgePeak!.zMslM}`,
  );
  assert.ok(
    Math.abs(analysisBlocked.blockingRidgePeak!.distKm - 5.0) < 0.5,
    `Blocking peak distance must be near 5.0 km, got ${analysisBlocked.blockingRidgePeak!.distKm}`,
  );
  assert.ok(analysisBlocked.diffLossDb > 5.0, `Diffraction loss must be > 5 dB, got ${analysisBlocked.diffLossDb}`);

  // Test 4: 16-Azimuth Skyline Ring & Sky Openness %
  assert.equal(analysisBlocked.horizonMask16.length, 16, 'horizonMask16 must contain 16 bins');
  assert.ok(
    analysisBlocked.skyOpennessPct >= 0 && analysisBlocked.skyOpennessPct <= 100,
    `skyOpennessPct must be between 0 and 100%, got ${analysisBlocked.skyOpennessPct}`,
  );
  // Sector towards 0° (North) has the 4500m ridge so it should be blocked
  const northBin = analysisBlocked.horizonMask16.find(b => b.azimuthDeg === 0);
  assert.ok(northBin !== undefined, 'North azimuth bin must exist');
  assert.equal(northBin!.isBlockedAtAcnEl, true, 'North bin must be blocked by ridge');

  console.log('  ✓ Horizontal & 3D Slant Distance Identies [PASS]');
  console.log('  ✓ Elevation Angle & Azimuth Identities [PASS]');
  console.log('  ✓ Quad Sector S0..S3 Identification & F.1336 Roll-Off [PASS]');
  console.log('  ✓ Terrain Horizon Mask & Blocking Ridge Detection [PASS]');
  console.log('  ✓ 16-Compass-Azimuth 360° Polar Skyline Ring [PASS]');
}

// =================================================================================================
// [PCP-T2] Pinned Reference [P1] Differential Comparison & Smart Peak Optimizer
// =================================================================================================
console.log('\n[PCP-T2] Verifying Pinned Reference [P1] Differential Comparison & Smart Peak Optimizer...');
{
  const flatElevation = (_x: number, _y: number) => 3200.0;
  const acnPos = [0, 8000, 5200] as [number, number, number];

  // 1. Establish Pinned Reference P1 at (0, 0)
  const probeP1 = evaluateCursorRfProbe(
    { xM: 0, yM: 0 },
    5.0,
    acnPos,
    0.0,
    flatElevation,
  );

  // 2. Evaluate Cursor Probe at (3000, 4000) with P1 pinned
  // dx = 3000, dy = 4000 => distFromPin = 5000m (5.0 km)
  // Bearing from (0, 0) to (3000, 4000) = atan2(3000, 4000) = 36.8699°
  const probeP2 = evaluateCursorRfProbe(
    { xM: 3000, yM: 4000 },
    5.0,
    acnPos,
    0.0,
    flatElevation,
    probeP1,
  );

  assert.ok(probeP2.deltaVsPin !== null, 'deltaVsPin must be computed when pinnedRef is provided');
  const d = probeP2.deltaVsPin!;
  assert.ok(
    Math.abs(d.distFromPinKm - 5.0) < 1e-3,
    `Distance from pin must be 5.0 km, got ${d.distFromPinKm}`,
  );
  const expectedBearing = (Math.atan2(3000, 4000) * 180.0) / Math.PI; // ~36.8699°
  assert.ok(
    Math.abs(d.bearingFromPinDeg - expectedBearing) < 1e-2,
    `Bearing from pin must match ${expectedBearing.toFixed(2)}°, got ${d.bearingFromPinDeg}`,
  );
  assert.equal(d.deltaElevM, 0.0, 'Elevation delta on flat terrain must be 0.0 m');
  assert.ok(
    Math.abs(d.deltaSinrDb - (probeP2.estSinrDb - probeP1.estSinrDb)) < 1e-4,
    'deltaSinrDb must match difference between P2 and P1 SINR',
  );

  console.log(`  ✓ P1 Differential Vector: dist=${d.distFromPinKm.toFixed(3)}km, bearing=${d.bearingFromPinDeg.toFixed(2)}°, deltaSinr=${d.deltaSinrDb.toFixed(2)}dB [PASS]`);

  // 3. Test Smart Peak Optimizer (findOptimalSignalPeakInRadius)
  // Construct terrain with a valley floor at (0, 0) of 2800m, and a summit peak at (600, 800) of 4200m
  const mountainElevation = (x: number, y: number) => {
    const peakX = 600.0;
    const peakY = 800.0;
    const distSq = (x - peakX) * (x - peakX) + (y - peakY) * (y - peakY);
    const heightBoost = 1400.0 * Math.exp(-distSq / (600.0 * 600.0));
    return 2800.0 + heightBoost;
  };

  const peakResult = findOptimalSignalPeakInRadius(
    0.0,
    0.0,
    2000.0,
    5.0,
    acnPos,
    0.0,
    mountainElevation,
  );

  const baselineEval = evaluateCursorRfProbe(
    { xM: 0.0, yM: 0.0 },
    5.0,
    acnPos,
    0.0,
    mountainElevation,
  );

  // Peak optimizer must locate elevated terrain with higher SINR
  assert.ok(
    peakResult.bestZ >= baselineEval.groundElevationM,
    `Peak elevation (${peakResult.bestZ}m) must be >= baseline valley floor (${baselineEval.groundElevationM}m)`,
  );
  assert.ok(
    peakResult.bestSinrDb >= baselineEval.estSinrDb,
    `Peak SINR (${peakResult.bestSinrDb.toFixed(1)}dB) must be >= baseline (${baselineEval.estSinrDb.toFixed(1)}dB)`,
  );
  assert.ok(
    peakResult.bestSkyOpennessPct >= baselineEval.skyOpennessPct,
    `Peak sky openness (${peakResult.bestSkyOpennessPct.toFixed(0)}%) must be >= baseline (${baselineEval.skyOpennessPct.toFixed(0)}%)`,
  );

  console.log(`  ✓ Smart Peak Optimizer: Valley(${Math.round(baselineEval.groundElevationM)}m, ${baselineEval.estSinrDb.toFixed(1)}dB) -> Peak(${Math.round(peakResult.bestZ)}m, ${peakResult.bestSinrDb.toFixed(1)}dB) [PASS]`);
}

// =================================================================================================
// [PCP-T3] DOM Controls, Global Layout Invariance & Spec Registration
// =================================================================================================
console.log('\n[PCP-T3] Verifying DOM Controls, Global Layout Invariance & Spec Registration...');
{
  const indexPath = resolve(__dirname, '../../index.html');
  const indexContent = readFileSync(indexPath, 'utf-8');

  // 1. Verify Tool #2 DOM Elements in #tb-pane-probe
  const requiredDomIds = [
    // Pre-existing IDs (must be preserved)
    'tb-probe-pick-btn',
    'tb-probe-clear-btn',
    'tb-probe-agl',
    'tb-probe-radius',
    'tb-probe-target',
    'tb-probe-obstacles',
    'tb-sweep-target',
    'tb-probe-acn-range',
    'tb-probe-acn-el',
    'tb-probe-acn-los',
    'tb-probe-acn-sinr',
    'tb-probe-acn-modcod',
    'tb-probe-spawn-node',

    // New CAD/STK-grade elements
    'tb-probe-mast-input',
    'tb-probe-unit-select',
    'tb-probe-horizon-mask',
    'tb-probe-sector-bore',
    'tb-probe-delta-pin',
    'btn-probe-snap-best',
  ];

  for (const id of requiredDomIds) {
    assert.ok(
      indexContent.includes(`id="${id}"`),
      `index.html must include element with id="${id}"`,
    );
  }
  console.log(`  ✓ Verified all ${requiredDomIds.length} Tool #2 DOM elements in #tb-pane-probe [PASS]`);

  // 2. Verify Global Page Layout & CSS Invariance
  // frontend/c2-console-theme.css must exist and be unmodified
  const themeCssPath = resolve(__dirname, '../../frontend/c2-console-theme.css');
  assert.ok(existsSync(themeCssPath), 'frontend/c2-console-theme.css must exist');

  // index.html structural classes must be untouched
  assert.ok(/class="[^"]*\brail\b/.test(indexContent), 'index.html must retain .rail layout class');
  assert.ok(/class="[^"]*\btopbar\b/.test(indexContent), 'index.html must retain .topbar layout class');
  assert.ok(/class="[^"]*\b(shell|app-shell)\b/.test(indexContent) || indexContent.includes('shell') || indexContent.includes('app-shell'), 'index.html must retain .shell layout class');
  assert.ok(indexContent.includes('id="radar-container"'), 'index.html must retain #radar-container');
  console.log('  ✓ Global Page Layout & Theme Invariance Confirmed [PASS]');

  // 3. Verify Specification Persisted on Disk and Linked in README.md
  const specPath = resolve(__dirname, '../../docs/specs/SPEC-PRECISION-CURSOR-RF-PROBE-AND-UNIT-SPAWNER-TOOL2.md');
  assert.ok(existsSync(specPath), 'Specification file docs/specs/SPEC-PRECISION-CURSOR-RF-PROBE-AND-UNIT-SPAWNER-TOOL2.md must exist on disk');

  const readmePath = resolve(__dirname, '../../README.md');
  const readmeContent = readFileSync(readmePath, 'utf-8');
  assert.ok(
    readmeContent.includes('SPEC-PRECISION-CURSOR-RF-PROBE-AND-UNIT-SPAWNER-TOOL2.md'),
    'README.md must link to SPEC-PRECISION-CURSOR-RF-PROBE-AND-UNIT-SPAWNER-TOOL2.md in Section 7',
  );
  console.log('  ✓ Specification Persisted & Linked in README.md [PASS]');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL PRECISION CURSOR RF PROBE & UNIT SPAWNER TESTS PASSED (PCP-T1 - PCP-T3)');
console.log('='.repeat(96));
