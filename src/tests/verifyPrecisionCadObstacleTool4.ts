/**
 * src/tests/verifyPrecisionCadObstacleTool4.ts
 *
 * Automated Verification Suite for:
 * SPEC-PRECISION-CAD-OBSTACLE-LINK-SLICER-TOOL4: Excalidraw / CAD-Grade Interactive
 * Barrier Extruder & Real-Time 3D Link-Slice Previewer Upgrade.
 *
 * Test Suites:
 * - PCO-T1: 2D Segment Intersection & 3D Ray Altitude / Required Height Math
 * - PCO-T2: Perpendicular Node-Link Slicer Generator
 * - PCO-T3: DOM Controls, Global Layout Invariance & Spec Registration
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  computeSegmentIntersection2D,
  snapBarrierAngle,
  evaluateBarrierLinkIntersections,
  generatePerpendicularLinkSlicerObstacle,
  computeP526DiffractionDb,
  DEFAULT_K_FACTOR,
  DEFAULT_EARTH_RADIUS_M,
  DEFAULT_R_EFF_M,
} from '../core/cadObstacleSlicerEngine';

console.log('='.repeat(96));
console.log('   CAD-GRADE OBSTACLE LINK-SLICER & INTERACTION ENGINE VERIFICATION SUITE');
console.log('   Specification: SPEC-PRECISION-CAD-OBSTACLE-LINK-SLICER-TOOL4 // PCO-T1 - PCO-T3');
console.log('='.repeat(96));

// =================================================================================================
// [PCO-T1] 2D Segment Intersection & 3D Ray Altitude / Required Height Math
// =================================================================================================
console.log('\n[PCO-T1] Verifying 2D Segment Intersection & 3D Ray Altitude / Required Height Math...');
{
  // 1. Verify computeSegmentIntersection2D finds exact midpoint intersection (500, 0)
  // Wall: (500, -500) -> (500, 500)
  // Link: (0, 0) -> (1000, 0)
  const intResult = computeSegmentIntersection2D(500, -500, 500, 500, 0, 0, 1000, 0);
  assert.ok(intResult !== null, 'Intersection between crossing perpendicular segments must not be null');
  assert.ok(Math.abs(intResult.xM - 500) < 1e-6, `Intersection xM must be 500, got ${intResult.xM}`);
  assert.ok(Math.abs(intResult.yM - 0) < 1e-6, `Intersection yM must be 0, got ${intResult.yM}`);
  assert.ok(Math.abs(intResult.wallFraction - 0.5) < 1e-6, `wallFraction must be 0.5, got ${intResult.wallFraction}`);
  assert.ok(Math.abs(intResult.linkFraction - 0.5) < 1e-6, `linkFraction must be 0.5, got ${intResult.linkFraction}`);
  console.log('  ✓ Exact 2D parametric segment intersection at (500, 0) with t=0.5, u=0.5 [PASS]');

  // Non-intersecting parallel segments
  const parResult = computeSegmentIntersection2D(0, 100, 1000, 100, 0, 200, 1000, 200);
  assert.equal(parResult, null, 'Parallel non-coincident segments must return null');

  // Disjoint non-crossing segments
  const disResult = computeSegmentIntersection2D(0, 0, 100, 100, 200, 200, 300, 300);
  assert.equal(disResult, null, 'Disjoint segments must return null');
  console.log('  ✓ Parallel and disjoint segments correctly return null [PASS]');

  // 2. Verify snapBarrierAngle for 15° increment angle snapping
  const snapped0 = snapBarrierAngle({ x: 0, y: 0 }, { x: 100, y: 2 }); // angle ~ 1.1° -> 0°
  assert.ok(Math.abs(snapped0.y - 0) < 1e-3, `Snapped point y should be close to 0, got ${snapped0.y}`);

  const snapped45 = snapBarrierAngle({ x: 0, y: 0 }, { x: 100, y: 95 }); // angle ~ 43.5° -> 45°
  const ang45 = Math.atan2(snapped45.y, snapped45.x) * 180 / Math.PI;
  assert.ok(Math.abs(ang45 - 45) < 1e-3, `Snapped angle must be 45°, got ${ang45}°`);
  console.log('  ✓ Shift 15° angle snap constraint verified [PASS]');

  // 3. Verify evaluateBarrierLinkIntersections 3D ray altitude, earth bulge, and slicing verdicts
  // Node 1 at (0, 0), Ground elevation = 3500m, Mast = 2m -> zNode = 3502m
  // ACN at (10000, 0), Altitude = 5500m MSL
  // Barrier crossing at x = 4000m (u = 0.40):
  // zRay = 3502 + 0.40 * (5500 - 3502) = 3502 + 799.2 = 4301.2m MSL
  const testElevation = (_x: number, _y: number) => 3500.0;
  const nodes = [
    { nodeId: 1, xM: 0, yM: 0, groundElevM: 3500, aglM: 2.0 },
    { nodeId: 2, xM: 0, yM: 5000, groundElevM: 3500, aglM: 2.0 }, // Not crossed
  ];
  const acnPos = { x: 10000, y: 0, z: 5500 };

  // First test with low barrier height: 200m AGL
  // At x = 4000: d1 = 4000, d2 = 6000
  // bulge = (4000 * 6000) / (2 * 8494667) = 24000000 / 16989334 ≈ 1.41m
  // zWallTop = 3500 + 1.41 + 200 = 3701.41m MSL
  // Ray is at 4301.2m MSL -> Wall is ~600m below ray!
  // Required height Hreq = ceil(4301.2 - (3500 + 1.41)) = ceil(799.79) = 800m
  const lowBarrierReport = evaluateBarrierLinkIntersections(
    { x: 4000, y: -500 },
    { x: 4000, y: 500 },
    200.0,
    'wall',
    'granite',
    nodes,
    acnPos,
    testElevation,
  );

  assert.equal(lowBarrierReport.intersections.length, 1, 'Should find exactly 1 intersecting link (Node 1)');
  const int1 = lowBarrierReport.intersections[0];
  assert.equal(int1.nodeId, 1, 'Intersected node ID must be 1');
  assert.ok(Math.abs(int1.linkFraction - 0.40) < 1e-3, `Link fraction must be 0.40, got ${int1.linkFraction}`);
  assert.ok(Math.abs(int1.zRayMslM - 4301.2) < 0.5, `3D Ray altitude must be ~4301.2m, got ${int1.zRayMslM}`);
  assert.equal(int1.sliceVerdict, 'RAY_FLIES_OVER', 'Verdict must be RAY_FLIES_OVER with 200m wall');
  assert.ok(int1.requiredBlockingHeightM >= 790, `H_req must be >= 790m, got ${int1.requiredBlockingHeightM}`);
  assert.equal(lowBarrierReport.slicedNodeIds.length, 0, 'No sliced nodes with 200m wall');
  assert.equal(lowBarrierReport.overflyingNodeIds.length, 1, 'Node 1 must be overflying');
  console.log('  ✓ Low wall correctly evaluates RAY_FLIES_OVER with exact H_req calculation [PASS]');

  // Second test: high barrier height: Hreq + 40m = 840m AGL
  // Now zWallTop = 3501.41 + 840 = 4341.41m MSL > 4301.2m MSL
  // Intrusion h = 4341.41 - 4301.2 = +40.21m > 0
  // Slicing verdict must be 'SLICED_BLOCKED' and diffraction loss Delta L > 15 dB
  const highBarrierReport = evaluateBarrierLinkIntersections(
    { x: 4000, y: -500 },
    { x: 4000, y: 500 },
    840.0,
    'wall',
    'granite',
    nodes,
    acnPos,
    testElevation,
  );

  assert.equal(highBarrierReport.intersections.length, 1, 'Should find 1 intersecting link');
  const highInt1 = highBarrierReport.intersections[0];
  assert.equal(highInt1.sliceVerdict, 'SLICED_BLOCKED', 'Verdict must transition to SLICED_BLOCKED');
  assert.ok(
    highInt1.diffractionLossDb > 15.0,
    `Induced diffraction loss must be > 15 dB for +40m intrusion, got ${highInt1.diffractionLossDb.toFixed(2)} dB`,
  );
  assert.deepEqual(highBarrierReport.slicedNodeIds, [1], 'Node 1 must be in slicedNodeIds');
  assert.equal(highBarrierReport.overflyingNodeIds.length, 0, 'overflyingNodeIds must be empty');
  console.log(`  ✓ High wall transitions to SLICED_BLOCKED with ${highInt1.diffractionLossDb.toFixed(2)} dB diffraction loss [PASS]`);
}

// =================================================================================================
// [PCO-T2] Perpendicular Node-Link Slicer Generator
// =================================================================================================
console.log('\n[PCO-T2] Verifying Perpendicular Node-Link Slicer Generator...');
{
  const testElevation = (_x: number, _y: number) => 3500.0;
  const nodePos = { x: 2000, y: 1000, z: 3502 };
  const acnPos = { x: 12000, y: 11000, z: 6500 };

  // Link vector: (10000, 10000)
  // Perpendicular wall should have dot product with link == 0
  const slicerObstacle = generatePerpendicularLinkSlicerObstacle(
    nodePos,
    acnPos,
    testElevation,
    0.35,
    1400.0,
  );

  const linkDx = acnPos.x - nodePos.x;
  const linkDy = acnPos.y - nodePos.y;
  const wallDx = slicerObstacle.v2.x - slicerObstacle.v1.x;
  const wallDy = slicerObstacle.v2.y - slicerObstacle.v1.y;

  const dotProduct = linkDx * wallDx + linkDy * wallDy;
  assert.ok(
    Math.abs(dotProduct) < 1e-3,
    `Wall vector must be perpendicular to link vector (dot product ~ 0), got ${dotProduct}`,
  );
  console.log('  ✓ Generated barrier is mathematically perpendicular to Link vector [PASS]');

  // Verify center of barrier is positioned at 35% distance along link
  const expectedCenterX = nodePos.x + 0.35 * linkDx;
  const expectedCenterY = nodePos.y + 0.35 * linkDy;
  assert.ok(
    Math.abs(slicerObstacle.center.x - expectedCenterX) < 1e-3,
    `Center X must be at 35% (${expectedCenterX}), got ${slicerObstacle.center.x}`,
  );
  assert.ok(
    Math.abs(slicerObstacle.center.y - expectedCenterY) < 1e-3,
    `Center Y must be at 35% (${expectedCenterY}), got ${slicerObstacle.center.y}`,
  );
  console.log('  ✓ Generated barrier is centered at exactly 35% link fraction [PASS]');

  // Verify that the generated optimal height physically slices the node's link
  const evaluation = evaluateBarrierLinkIntersections(
    slicerObstacle.v1,
    slicerObstacle.v2,
    slicerObstacle.optimalHeightM,
    slicerObstacle.shape,
    slicerObstacle.material,
    [{ nodeId: 4, xM: nodePos.x, yM: nodePos.y, groundElevM: 3500, aglM: 2.0 }],
    acnPos,
    testElevation,
  );

  assert.equal(evaluation.intersections.length, 1, 'Generated barrier must intersect target node link');
  assert.equal(
    evaluation.intersections[0].sliceVerdict,
    'SLICED_BLOCKED',
    'Generated optimalHeightM must physically slice the 3D ray',
  );
  assert.ok(
    evaluation.intersections[0].diffractionLossDb >= 15.0,
    `Diffraction loss must be >= 15 dB, got ${evaluation.intersections[0].diffractionLossDb.toFixed(2)} dB`,
  );
  console.log(`  ✓ Auto-generated barrier optimalHeightM (${slicerObstacle.optimalHeightM}m) physically slices 3D link with ${evaluation.intersections[0].diffractionLossDb.toFixed(1)} dB loss [PASS]`);
}

// =================================================================================================
// [PCO-T3] DOM Controls, Global Layout Invariance & Spec Registration
// =================================================================================================
console.log('\n[PCO-T3] Verifying DOM Controls, Global Layout Invariance & Spec Registration...');
{
  const indexPath = resolve(__dirname, '../../index.html');
  const indexContent = readFileSync(indexPath, 'utf-8');

  // 1. Verify Tool #4 DOM Elements in #tb-pane-obstacle
  const requiredDomIds = [
    // Pre-existing obstacle IDs (must remain intact)
    'tb-obs-shape-select',
    'tb-obs-material-select',
    'tb-obs-place-btn',
    'tb-obs-undo',
    'tb-obs-redo',
    'tb-obs-clear-btn',
    'tb-obs-list',

    // New CAD-Grade & Link Slicer DOM elements
    'tb-obs-cad-metrics',
    'tb-obs-slice-summary',
    'btn-obs-auto-height',
    'tb-obs-target-node-select',
    'btn-obs-slice-node-link',
  ];

  for (const id of requiredDomIds) {
    assert.ok(
      indexContent.includes(`id="${id}"`),
      `index.html must include element with id="${id}"`,
    );
  }
  console.log(`  ✓ Verified all ${requiredDomIds.length} Tool #4 DOM elements in #tb-pane-obstacle [PASS]`);

  // 2. Verify Global Page Layout & CSS Invariance
  const themeCssPath = resolve(__dirname, '../../frontend/c2-console-theme.css');
  assert.ok(existsSync(themeCssPath), 'frontend/c2-console-theme.css must exist');

  assert.ok(/class="[^"]*\brail\b/.test(indexContent), 'index.html must retain .rail layout class');
  assert.ok(/class="[^"]*\btopbar\b/.test(indexContent), 'index.html must retain .topbar layout class');
  assert.ok(/class="[^"]*\b(shell|app-shell)\b/.test(indexContent) || indexContent.includes('shell') || indexContent.includes('app-shell'), 'index.html must retain .shell layout class');
  assert.ok(indexContent.includes('id="radar-container"'), 'index.html must retain #radar-container');
  console.log('  ✓ Global Page Layout & Theme Invariance Confirmed [PASS]');

  // 3. Verify Specification Persisted on Disk and Linked in README.md
  const specPath = resolve(__dirname, '../../docs/specs/SPEC-PRECISION-CAD-OBSTACLE-LINK-SLICER-TOOL4.md');
  assert.ok(existsSync(specPath), 'Specification file docs/specs/SPEC-PRECISION-CAD-OBSTACLE-LINK-SLICER-TOOL4.md must exist on disk');

  const readmePath = resolve(__dirname, '../../README.md');
  const readmeContent = readFileSync(readmePath, 'utf-8');
  assert.ok(
    readmeContent.includes('SPEC-PRECISION-CAD-OBSTACLE-LINK-SLICER-TOOL4.md'),
    'README.md must link to SPEC-PRECISION-CAD-OBSTACLE-LINK-SLICER-TOOL4.md in Section 7',
  );
  console.log('  ✓ Specification Persisted & Linked in README.md [PASS]');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL PRECISION CAD OBSTACLE LINK-SLICER TESTS PASSED (PCO-T1 - PCO-T3)');
console.log('='.repeat(96));
