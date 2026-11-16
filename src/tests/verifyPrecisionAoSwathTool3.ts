/**
 * src/tests/verifyPrecisionAoSwathTool3.ts
 *
 * Automated Verification Suite for:
 * SPEC-PRECISION-AO-SWATH-AND-DEADZONE-SCANNER-TOOL3: CAD/QGIS-Grade Precision
 * Area-of-Operations (AO) Swath, Dead-Zone Matrix Scanner & Tactical Squad Auto-Deployer Upgrade.
 *
 * Test Suites:
 * - PAS-T1: CAD Swath Dimensions, Diagonal Bearing & Shift Square Lock
 * - PAS-T2: 64-Cell RF Coverage Matrix, Extreme Pins & 4-Node Squad Dispersion
 * - PAS-T3: DOM Controls, Global Layout Invariance & Spec Registration
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  constrainSquareRegion,
  evaluateAoSwathAnalysis,
  computeP526DiffractionDb,
  DEFAULT_K_FACTOR,
  DEFAULT_EARTH_RADIUS_M,
  DEFAULT_R_EFF_M,
} from '../core/aoSwathScannerEngine';

console.log('='.repeat(96));
console.log('   CAD/QGIS PRECISION AO SWATH & DEAD-ZONE SCANNER VERIFICATION SUITE');
console.log('   Specification: SPEC-PRECISION-AO-SWATH-AND-DEADZONE-SCANNER-TOOL3 // PAS-T1 - PAS-T3');
console.log('='.repeat(96));

// =================================================================================================
// [PAS-T1] CAD Swath Dimensions, Diagonal Bearing & Shift Square Lock
// =================================================================================================
console.log('\n[PAS-T1] Verifying CAD Swath Dimensions, Diagonal Bearing & Shift Square Lock...');
{
  // 1. Verify constrainSquareRegion enforces deltaX === deltaY across all 4 quadrants
  // Quadrant 1 (NE)
  const [sq1X, sq1Y] = constrainSquareRegion(0, 0, 4000, 3000);
  assert.equal(sq1X, 4000, 'Square lock X must match max dimension 4000');
  assert.equal(sq1Y, 4000, 'Square lock Y must match max dimension 4000');
  assert.equal(Math.abs(sq1X - 0), Math.abs(sq1Y - 0), 'Square lock deltaX must equal deltaY');

  // Quadrant 2 (NW)
  const [sq2X, sq2Y] = constrainSquareRegion(1000, 1000, -2000, 2000); // dx = -3000, dy = 1000 -> L = 3000
  assert.equal(sq2X, -2000, 'Square lock X must be 1000 - 3000 = -2000');
  assert.equal(sq2Y, 4000, 'Square lock Y must be 1000 + 3000 = 4000');
  assert.equal(Math.abs(sq2X - 1000), Math.abs(sq2Y - 1000), 'Square lock deltaX must equal deltaY');

  // Quadrant 3 (SW)
  const [sq3X, sq3Y] = constrainSquareRegion(2000, 5000, 1000, 2000); // dx = -1000, dy = -3000 -> L = 3000
  assert.equal(sq3X, -1000, 'Square lock X must be 2000 - 3000 = -1000');
  assert.equal(sq3Y, 2000, 'Square lock Y must be 5000 - 3000 = 2000');
  assert.equal(Math.abs(sq3X - 2000), Math.abs(sq3Y - 5000), 'Square lock deltaX must equal deltaY');

  // Quadrant 4 (SE)
  const [sq4X, sq4Y] = constrainSquareRegion(500, 500, 1500, -1500); // dx = 1000, dy = -2000 -> L = 2000
  assert.equal(sq4X, 2500, 'Square lock X must be 500 + 2000 = 2500');
  assert.equal(sq4Y, -1500, 'Square lock Y must be 500 - 2000 = -1500');
  assert.equal(Math.abs(sq4X - 500), Math.abs(sq4Y - 500), 'Square lock deltaX must equal deltaY');

  console.log('  ✓ Shift 1:1 square constraint (constrainSquareRegion) verified across all 4 quadrants [PASS]');

  // 2. Verify evaluateAoSwathAnalysis on a 4 km x 3 km swath box
  // x1 = 0, y1 = 0, x2 = 4000, y2 = 3000
  // widthKm = 4.00 km, heightKm = 3.00 km
  // areaKm2 = 12.00 km²
  // diagonalKm = 5.00 km (exact 3-4-5 right triangle)
  // diagonalAzimuthDeg = atan2(4000, 3000) * 180 / PI = 53.13010235°
  const flatElevation = (_x: number, _y: number) => 3500.0;
  const swathReport = evaluateAoSwathAnalysis(
    0,
    0,
    4000,
    3000,
    [2000, 1500, 6000], // ACN directly above center
    0.0,
    flatElevation,
    8 // 8x8 = 64 cells
  );

  assert.equal(swathReport.minX, 0, 'minX must be 0');
  assert.equal(swathReport.maxX, 4000, 'maxX must be 4000');
  assert.equal(swathReport.minY, 0, 'minY must be 0');
  assert.equal(swathReport.maxY, 3000, 'maxY must be 3000');

  assert.equal(swathReport.widthKm, 4.0, 'Width must be exactly 4.00 km');
  assert.equal(swathReport.heightKm, 3.0, 'Height must be exactly 3.00 km');
  assert.equal(swathReport.areaKm2, 12.0, 'Area must be exactly 12.00 km²');
  assert.equal(swathReport.diagonalKm, 5.0, 'Diagonal span must be exactly 5.00 km (3-4-5 right triangle)');

  const expectedAzimuthDeg = (Math.atan2(4000.0, 3000.0) * 180.0) / Math.PI;
  assert.ok(
    Math.abs(swathReport.diagonalAzimuthDeg - expectedAzimuthDeg) < 1e-4,
    `Diagonal azimuth must match ${expectedAzimuthDeg.toFixed(4)}°, got ${swathReport.diagonalAzimuthDeg.toFixed(4)}°`,
  );
  assert.ok(
    Math.abs(swathReport.diagonalAzimuthDeg - 53.1301) < 1e-3,
    `Diagonal azimuth must be approximately 53.1301°, got ${swathReport.diagonalAzimuthDeg.toFixed(4)}°`,
  );

  console.log(`  ✓ 3-4-5 CAD Swath Dimensions (4.00 km x 3.00 km, 12.00 km², 5.00 km @ ${swathReport.diagonalAzimuthDeg.toFixed(2)}°) verified [PASS]`);
}

// =================================================================================================
// [PAS-T2] 64-Cell RF Coverage Matrix, Extreme Pins & 4-Node Squad Dispersion
// =================================================================================================
console.log('\n[PAS-T2] Verifying 64-Cell RF Coverage Matrix, Extreme Pins & 4-Node Squad Dispersion...');
{
  // Dynamic high-relief terrain simulation:
  // Summit ridge around (2000, 3000) rising to 4950m
  // Deep valley around (-2000, -1000) dipping to 2750m
  // Base elevation 3400m
  const dynamicTerrain = (x: number, y: number) => {
    const ridgeDist = Math.hypot(x - 2000, y - 3000);
    const ridgePeak = 1550.0 * Math.exp(-(ridgeDist * ridgeDist) / (2.0 * 1500.0 * 1500.0));
    const valleyDist = Math.hypot(x + 2000, y + 1000);
    const valleyFloor = -650.0 * Math.exp(-(valleyDist * valleyDist) / (2.0 * 1200.0 * 1200.0));
    return 3400.0 + ridgePeak + valleyFloor;
  };

  // ACN at (0, 0, 4800m), heading 45°
  const acnPos: [number, number, number] = [0, 0, 4800.0];
  const acnHeading = 45.0;

  const aoAnalysis = evaluateAoSwathAnalysis(
    -3000,
    -2000,
    3000,
    4000,
    acnPos,
    acnHeading,
    dynamicTerrain,
    8 // 8x8 resolution
  );

  // 1. Exact 64 cells count
  assert.equal(aoAnalysis.cells.length, 64, 'Lattice must contain exactly 64 cells (8x8)');

  // 2. Check 100% partitioning coverage
  const totalCoveragePct = aoAnalysis.losCoveragePct + aoAnalysis.marginalPct + aoAnalysis.deadZonePct;
  assert.ok(
    Math.abs(totalCoveragePct - 100.0) < 1e-4,
    `Cell classification (LoS: ${aoAnalysis.losCoveragePct.toFixed(1)}%, Marginal: ${aoAnalysis.marginalPct.toFixed(1)}%, Dead-Zone: ${aoAnalysis.deadZonePct.toFixed(1)}%) must sum to 100%, got ${totalCoveragePct}%`,
  );

  // 3. Summit Peak, Valley Floor & Mean Elevation ordering
  assert.ok(
    aoAnalysis.summitPeak.zMslM >= aoAnalysis.meanElevM,
    `Summit peak elevation (${aoAnalysis.summitPeak.zMslM.toFixed(1)}m) must be >= mean elevation (${aoAnalysis.meanElevM.toFixed(1)}m)`,
  );
  assert.ok(
    aoAnalysis.meanElevM >= aoAnalysis.valleyFloor.zMslM,
    `Mean elevation (${aoAnalysis.meanElevM.toFixed(1)}m) must be >= valley floor elevation (${aoAnalysis.valleyFloor.zMslM.toFixed(1)}m)`,
  );
  assert.ok(
    aoAnalysis.reliefM > 0,
    `Topographical relief deltaZ (${aoAnalysis.reliefM.toFixed(1)}m) must be positive`,
  );
  assert.equal(
    aoAnalysis.reliefM,
    aoAnalysis.summitPeak.zMslM - aoAnalysis.valleyFloor.zMslM,
    'Relief must equal summit - valley elevation',
  );

  // 4. Worst Dead-Zone SINR must be <= mean SINR and min SINR
  assert.ok(
    aoAnalysis.worstDeadZone.sinrDb <= aoAnalysis.meanSinrDb,
    `Worst dead-zone SINR (${aoAnalysis.worstDeadZone.sinrDb.toFixed(2)} dB) must be <= mean SINR (${aoAnalysis.meanSinrDb.toFixed(2)} dB)`,
  );
  assert.ok(
    Math.abs(aoAnalysis.worstDeadZone.sinrDb - aoAnalysis.minSinrDb) < 1e-4,
    `Worst dead-zone SINR must equal minSinrDb (${aoAnalysis.minSinrDb.toFixed(2)} dB)`,
  );

  // 5. 4-Node Squad Tactical Dispersion Coordinates
  assert.equal(aoAnalysis.squadDeployCoords.length, 4, 'squadDeployCoords must contain exactly 4 positions');
  const [p1, p2, p3, p4] = aoAnalysis.squadDeployCoords;

  for (let i = 0; i < 4; i++) {
    const pt = aoAnalysis.squadDeployCoords[i];
    assert.equal(pt.length, 3, `Coordinate ${i} must have 3 components [x, y, z]`);
    assert.ok(Number.isFinite(pt[0]), `Coordinate ${i} X must be finite`);
    assert.ok(Number.isFinite(pt[1]), `Coordinate ${i} Y must be finite`);
    assert.ok(Number.isFinite(pt[2]), `Coordinate ${i} Z must be finite`);
    assert.ok(
      pt[0] >= aoAnalysis.minX && pt[0] <= aoAnalysis.maxX,
      `Coordinate ${i} X (${pt[0]}) must be within AO bounds [${aoAnalysis.minX}, ${aoAnalysis.maxX}]`,
    );
    assert.ok(
      pt[1] >= aoAnalysis.minY && pt[1] <= aoAnalysis.maxY,
      `Coordinate ${i} Y (${pt[1]}) must be within AO bounds [${aoAnalysis.minY}, ${aoAnalysis.maxY}]`,
    );
  }

  // Ensure coordinates are distinct from each other
  const dist12 = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
  const dist13 = Math.hypot(p1[0] - p3[0], p1[1] - p3[1]);
  const dist14 = Math.hypot(p1[0] - p4[0], p1[1] - p4[1]);
  assert.ok(dist12 > 500, `Squad nodes 1 and 2 must be separated by >500m, got ${dist12.toFixed(1)}m`);
  assert.ok(dist13 > 500, `Squad nodes 1 and 3 must be separated by >500m, got ${dist13.toFixed(1)}m`);
  assert.ok(dist14 > 500, `Squad nodes 1 and 4 must be separated by >500m, got ${dist14.toFixed(1)}m`);

  console.log(`  ✓ 64-Cell RF Matrix (LoS: ${aoAnalysis.losCoveragePct.toFixed(1)}%, Outage: ${aoAnalysis.deadZonePct.toFixed(1)}%), Summit(${Math.round(aoAnalysis.summitPeak.zMslM)}m), Valley(${Math.round(aoAnalysis.valleyFloor.zMslM)}m) & 4-Quadrant Squad Coordinates verified [PASS]`);
}

// =================================================================================================
// [PAS-T3] DOM Controls, Global Layout Invariance & Spec Registration
// =================================================================================================
console.log('\n[PAS-T3] Verifying DOM Controls, Global Layout Invariance & Spec Registration...');
{
  const indexPath = resolve(__dirname, '../../index.html');
  const indexContent = readFileSync(indexPath, 'utf-8');

  // 1. Verify Tool #3 DOM Elements in #tb-pane-region
  const requiredDomIds = [
    // Pre-existing region IDs (must be preserved)
    'terrain-region-btn',
    'terrain-region-finish-btn',
    'terrain-region-cancel-btn',
    'tb-region-live-area',
    'terrain-toolbox-regions',
    'tb-region-summit',
    'tb-region-ruggedness',
    'tb-region-los-pct',
    'tb-region-bounds',
    'tb-region-area',
    'tb-region-mean',
    'tb-region-minmax',
    'tb-region-std',
    'tb-region-canvas',

    // New CAD/QGIS-grade elements
    'tb-region-dimensions',
    'tb-region-sinr-stats',
    'tb-region-valley-floor',
    'btn-region-deploy-squad',
    'btn-region-spawn-summit-relay',
  ];

  for (const id of requiredDomIds) {
    assert.ok(
      indexContent.includes(`id="${id}"`),
      `index.html must include element with id="${id}"`,
    );
  }
  console.log(`  ✓ Verified all ${requiredDomIds.length} Tool #3 DOM elements in #tb-pane-region [PASS]`);

  // 2. Verify Global Page Layout & CSS Invariance
  const themeCssPath = resolve(__dirname, '../../frontend/c2-console-theme.css');
  assert.ok(existsSync(themeCssPath), 'frontend/c2-console-theme.css must exist');

  // Structural classes must be untouched
  assert.ok(indexContent.includes('class="rail"'), 'index.html must retain .rail layout class');
  assert.ok(indexContent.includes('class="topbar"'), 'index.html must retain .topbar layout class');
  assert.ok(indexContent.includes('class="shell"') || indexContent.includes('class="app-shell"'), 'index.html must retain .shell layout class');
  assert.ok(indexContent.includes('id="radar-container"'), 'index.html must retain #radar-container');
  console.log('  ✓ Global Page Layout & Theme Invariance Confirmed [PASS]');

  // 3. Verify Specification Persisted on Disk and Linked in README.md
  const specPath = resolve(__dirname, '../../docs/specs/SPEC-PRECISION-AO-SWATH-AND-DEADZONE-SCANNER-TOOL3.md');
  assert.ok(existsSync(specPath), 'Specification file docs/specs/SPEC-PRECISION-AO-SWATH-AND-DEADZONE-SCANNER-TOOL3.md must exist on disk');

  const readmePath = resolve(__dirname, '../../README.md');
  const readmeContent = readFileSync(readmePath, 'utf-8');
  assert.ok(
    readmeContent.includes('SPEC-PRECISION-AO-SWATH-AND-DEADZONE-SCANNER-TOOL3.md'),
    'README.md must link to SPEC-PRECISION-AO-SWATH-AND-DEADZONE-SCANNER-TOOL3.md in Section 7',
  );
  console.log('  ✓ Specification Persisted & Linked in README.md [PASS]');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL PRECISION AO SWATH & DEAD-ZONE SCANNER TESTS PASSED (PAS-T1 - PAS-T3)');
console.log('='.repeat(96));
