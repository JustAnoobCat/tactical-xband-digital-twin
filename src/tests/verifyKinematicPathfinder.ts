/**
 * src/tests/verifyKinematicPathfinder.ts
 *
 * Automated Verification Suite for Kinematic Dubins Path Smoothing &
 * 3D Flight Feasibility Engine (Suite 91).
 * Specification: docs/specs/wp07-kinematic-dubins-pathfinder.md
 *
 * Verifies:
 * - KPF-T1: Coordinated Turn Radius Physics & Invariant Guards
 * - KPF-T2: Exact Canonical 6-Family Dubins Solver (LSL, RSR, LSR, RSL, RLR, LRL)
 * - KPF-T3: Sharp 90° & 135° Corner Smoothing & Short-Segment Dubins Fallback
 * - KPF-T4: 3D Climb/Descent Rate Envelope & Terrain Floor Protection
 * - KPF-T5: Obstacle Safety Guard & End-to-End tacticalAiPathfinder Integration
 * - KPF-T6: Edge Cases, Invariant Resilience & 50 Hz Loop Performance Budget
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  GRAVITY_ACCEL_M_S2,
  computeMinTurnRadiusM,
  computeDubinsPath2D,
  smoothWaypointsKinematically,
  enforceClimbDescentConstraints,
  auditPathKinematicFeasibility,
  headingRadToNavDeg,
  navDegToHeadingRad,
  mod2pi,
  type FixedWingKinematicConstraints,
  type Waypoint3D,
  type DubinsPose2D,
  type DubinsFamily,
} from '../core/kinematicPathSmoother';

import {
  computeAiRecoveryAdvisory,
  type AiRecoveryAdvisoryParams,
} from '../core/tacticalAiPathfinder';

function close(actual: number, expected: number, tolerance = 1e-3, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('='.repeat(96));
console.log('   WP-07: KINEMATIC DUBINS PATH SMOOTHER & 3D FLIGHT FEASIBILITY (SUITE 91)');
console.log('   Specification: docs/specs/wp07-kinematic-dubins-pathfinder.md');
console.log('='.repeat(96));

// =============================================================================
// [TEST 1] Coordinated Turn Radius Physics & Invariant Guards (KPF-T1)
// =============================================================================
console.log('\n[KPF-T1] Verifying Coordinated Turn Radius Physics & Invariant Guards...');

// 1. Nominal Ladakh Tactical Aircraft: v = 50 m/s (~180 km/h), max bank phi = 30°
// R_min = 50^2 / (9.80665 * tan(30°)) = 2500 / (9.80665 * 0.577350269) = 441.5137 m
const r30 = computeMinTurnRadiusM(50.0, 30.0);
close(r30, 441.5137, 0.1, 'Turn radius at 50 m/s and 30° bank');
console.log(`  ✓ v=50 m/s, phi=30°: R_min = ${r30.toFixed(2)} m (nominal 441.51 m ± 0.1 m)`);

// 2. High-speed reconnaissance: v = 100 m/s, max bank phi = 45°
// R_min = 100^2 / (9.80665 * 1.0) = 1019.716 m
const r45 = computeMinTurnRadiusM(100.0, 45.0);
close(r45, 1019.716, 0.1, 'Turn radius at 100 m/s and 45° bank');
console.log(`  ✓ v=100 m/s, phi=45°: R_min = ${r45.toFixed(2)} m (nominal 1019.72 m ± 0.1 m)`);

// 3. Guards on zero, negative, and infinite speeds
assert.equal(computeMinTurnRadiusM(0.0, 30.0), 0.0, 'Zero speed must yield R_min = 0');
assert.equal(computeMinTurnRadiusM(-20.0, 30.0), 0.0, 'Negative speed must yield R_min = 0');
assert.equal(computeMinTurnRadiusM(NaN, 30.0), 0.0, 'NaN speed must yield R_min = 0');

// 4. Guards on bank angles
assert.equal(computeMinTurnRadiusM(50.0, 0.0), Infinity, 'Zero bank must yield R_min = Infinity');
assert.equal(computeMinTurnRadiusM(50.0, -10.0), Infinity, 'Negative bank must yield R_min = Infinity');
assert.equal(computeMinTurnRadiusM(50.0, NaN), Infinity, 'NaN bank must yield R_min = Infinity');

// 5. Bank angle clamping: 90° is clamped safely to 85°
const r90 = computeMinTurnRadiusM(50.0, 90.0);
const r85 = computeMinTurnRadiusM(50.0, 85.0);
close(r90, r85, 1e-4, '90° bank angle must be clamped to 85°');
assert.ok(Number.isFinite(r90), 'Clamped bank must produce finite radius');

// 6. Heading coordinate conversions
close(headingRadToNavDeg(0.0), 90.0, 1e-3, 'Cartesian 0 rad (+x) is 90° East');
close(headingRadToNavDeg(Math.PI / 2.0), 0.0, 1e-3, 'Cartesian pi/2 rad (+y) is 0° North');
close(headingRadToNavDeg(Math.PI), 270.0, 1e-3, 'Cartesian pi rad (-x) is 270° West');
close(headingRadToNavDeg(-Math.PI / 2.0), 180.0, 1e-3, 'Cartesian -pi/2 rad (-y) is 180° South');

close(navDegToHeadingRad(0.0), Math.PI / 2.0, 1e-3, 'Nav 0° North is Cartesian pi/2 rad');
close(navDegToHeadingRad(90.0), 0.0, 1e-3, 'Nav 90° East is Cartesian 0 rad');
close(navDegToHeadingRad(180.0), (3.0 * Math.PI) / 2.0, 1e-3, 'Nav 180° South is Cartesian 3pi/2 rad');
close(navDegToHeadingRad(270.0), Math.PI, 1e-3, 'Nav 270° West is Cartesian pi rad');

console.log('  ✓ Invariant guards, clamping, and coordinate conversions verified.');

// =============================================================================
// [TEST 2] Exact Canonical 6-Family Dubins Solver (KPF-T2)
// =============================================================================
console.log('\n[KPF-T2] Verifying Exact Canonical 6-Family Dubins Solver (LSL, RSR, LSR, RSL, RLR, LRL)...');

const testRadiusM = 100.0;
const maxKappaExpected = 1.0 / testRadiusM;

interface DubinsTestCase {
  readonly name: DubinsFamily;
  readonly start: DubinsPose2D;
  readonly end: DubinsPose2D;
}

const canonicalTestCases: DubinsTestCase[] = [
  {
    name: 'LSL',
    start: { x: 0.0, y: 0.0, headingRad: 0.0 },
    end: { x: 400.0, y: 300.0, headingRad: Math.PI / 4.0 },
  },
  {
    name: 'RSR',
    start: { x: 0.0, y: 0.0, headingRad: 0.0 },
    end: { x: 400.0, y: -300.0, headingRad: -Math.PI / 4.0 },
  },
  {
    name: 'LSR',
    start: { x: 0.0, y: 0.0, headingRad: 0.0 },
    end: { x: 600.0, y: 100.0, headingRad: -Math.PI / 2.0 },
  },
  {
    name: 'RSL',
    start: { x: 0.0, y: 0.0, headingRad: 0.0 },
    end: { x: 600.0, y: -100.0, headingRad: Math.PI / 2.0 },
  },
  {
    name: 'RLR',
    start: { x: 0.0, y: 0.0, headingRad: Math.PI / 2.0 },
    end: { x: -10.0, y: 150.0, headingRad: -Math.PI / 2.0 },
  },
  {
    name: 'LRL',
    start: { x: 0.0, y: 0.0, headingRad: -Math.PI / 2.0 },
    end: { x: -10.0, y: -150.0, headingRad: Math.PI / 2.0 },
  },
];

for (const tc of canonicalTestCases) {
  const result = computeDubinsPath2D(tc.start, tc.end, testRadiusM, 10.0);

  // 1. Optimal family matches expected
  assert.equal(result.family, tc.name, `Optimal family for ${tc.name} must match`);

  // 2. Samples presence & bounds
  assert.ok(result.samples.length >= 2, `${tc.name}: samples array must contain multiple points`);

  // 3. Start pose accuracy
  const firstSample = result.samples[0];
  const startPosErr = Math.hypot(firstSample.x - tc.start.x, firstSample.y - tc.start.y);
  assert.ok(startPosErr < 0.1, `${tc.name}: start position error must be < 0.1m, got ${startPosErr}`);
  close(firstSample.headingRad, tc.start.headingRad, 1e-4, `${tc.name}: start heading must match`);

  // 4. End pose accuracy
  const lastSample = result.samples[result.samples.length - 1];
  const endPosErr = Math.hypot(lastSample.x - tc.end.x, lastSample.y - tc.end.y);
  assert.ok(endPosErr < 0.5, `${tc.name}: end position error must be < 0.5m, got ${endPosErr}`);
  const headingDiff = Math.abs(mod2pi(lastSample.headingRad - tc.end.headingRad));
  assert.ok(
    headingDiff < 0.05 || Math.abs(headingDiff - 2 * Math.PI) < 0.05,
    `${tc.name}: end heading error must be < 0.05 rad, got diff ${headingDiff}`
  );

  // 5. Curvature bounds across all samples: |kappa| <= 1/R_min * 1.02
  for (let i = 0; i < result.samples.length; i++) {
    const s = result.samples[i];
    assert.ok(
      Math.abs(s.curvatureInvM) <= maxKappaExpected * 1.02,
      `${tc.name}: sample ${i} curvature ${s.curvatureInvM} exceeds max permitted ${maxKappaExpected}`
    );
  }

  // 6. Segment length summation consistency
  const segSum = result.segments.reduce((acc, seg) => acc + seg.lengthM, 0.0);
  close(segSum, result.totalLengthM, 1e-4, `${tc.name}: segment length sum must equal totalLengthM`);

  console.log(`  ✓ Family ${tc.name}: optimal solve verified (Length = ${result.totalLengthM.toFixed(1)} m, End Pos Err = ${endPosErr.toFixed(4)} m)`);
}

// =============================================================================
// [TEST 3] Sharp 90° & 135° Polyline Smoothing & Dubins Fallback (KPF-T3)
// =============================================================================
console.log('\n[KPF-T3] Verifying Sharp 90° & 135° Corner Smoothing & Short-Segment Dubins Fallback...');

const constraints50: FixedWingKinematicConstraints = {
  speedMs: 50.0,
  maxBankDeg: 30.0,
  maxClimbRateMs: 10.0,
  maxDescentRateMs: 8.0,
  sampleStepM: 20.0,
};

// 1. Raw sharp 90° corner
const rawCorner90: Waypoint3D[] = [
  { x: 0.0, y: 0.0, altM: 1000.0 },
  { x: 1000.0, y: 0.0, altM: 1000.0 },
  { x: 1000.0, y: 1000.0, altM: 1000.0 },
];

// Discretize raw corner into small steps to evaluate raw kinematic feasibility
const rawSampled: Waypoint3D[] = [];
for (let x = 0; x <= 1000; x += 20) rawSampled.push({ x, y: 0, altM: 1000 });
for (let y = 20; y <= 1000; y += 20) rawSampled.push({ x: 1000, y, altM: 1000 });

const rawAudit = auditPathKinematicFeasibility(rawSampled, constraints50);
assert.equal(rawAudit.horizontalFeasible, false, 'Raw 90° sharp corner must fail horizontal feasibility');
assert.ok(rawAudit.maxRequiredBankDeg > 80.0, `Raw corner requires excessive bank angle, got ${rawAudit.maxRequiredBankDeg}°`);
console.log(`  ✓ Raw sharp 90° corner correctly fails kinematic audit (Required Bank = ${rawAudit.maxRequiredBankDeg.toFixed(1)}° > 30°)`);

// Apply smoothing
const smoothed90 = smoothWaypointsKinematically(rawCorner90, constraints50);
assert.equal(smoothed90.isKinematicallyFeasible, true, 'Smoothed 90° path must be certified kinematically feasible');
assert.equal(smoothed90.audit.horizontalFeasible, true, 'Smoothed 90° path must pass horizontal feasibility');
assert.ok(
  smoothed90.maxRequiredBankDeg <= constraints50.maxBankDeg + 1.0,
  `Smoothed path required bank (${smoothed90.maxRequiredBankDeg.toFixed(1)}°) must not exceed maxBankDeg + 1.0°`
);
console.log(`  ✓ Smoothed 90° corner passes kinematic audit (Max Bank = ${smoothed90.maxRequiredBankDeg.toFixed(1)}° <= 30.0°, Effective R_min = ${smoothed90.minEffectiveTurnRadiusM.toFixed(1)} m)`);

// 2. Sharp 135° deflection corner
const rawCorner135: Waypoint3D[] = [
  { x: 0.0, y: 0.0, altM: 1000.0 },
  { x: 1500.0, y: 0.0, altM: 1000.0 },
  { x: 500.0, y: 1000.0, altM: 1000.0 },
];
const smoothed135 = smoothWaypointsKinematically(rawCorner135, constraints50);
assert.equal(smoothed135.isKinematicallyFeasible, true, 'Smoothed 135° path must be kinematically feasible');
assert.ok(smoothed135.maxRequiredBankDeg <= constraints50.maxBankDeg + 1.0, '135° corner bank angle bounded');
console.log(`  ✓ Smoothed 135° corner passes kinematic audit (Max Bank = ${smoothed135.maxRequiredBankDeg.toFixed(1)}°)`);

// 3. Short-segment overlapping fillets test (Dubins fallback)
// Corner 1 at (500, 0) and Corner 2 at (700, 0) — segment length 200m < 2 * T_setback (441m)
const shortSegmentWps: Waypoint3D[] = [
  { x: 0.0, y: 0.0, altM: 1000.0 },
  { x: 500.0, y: 0.0, altM: 1000.0 },
  { x: 700.0, y: 150.0, altM: 1000.0 },
  { x: 1200.0, y: 150.0, altM: 1000.0 },
];
const smoothedShort = smoothWaypointsKinematically(shortSegmentWps, constraints50);
assert.ok(smoothedShort.fallbackCount > 0, 'Short overlapping segment must trigger Dubins fallback');
assert.equal(smoothedShort.isKinematicallyFeasible, true, 'Short overlapping path with Dubins fallback must be feasible');
console.log(`  ✓ Short-segment Dubins fallback seamlessly engaged (Fallbacks = ${smoothedShort.fallbackCount}, Feasible = ${smoothedShort.isKinematicallyFeasible})`);

// =============================================================================
// [TEST 4] 3D Climb/Descent Rate Envelope & Terrain Floor Protection (KPF-T4)
// =============================================================================
console.log('\n[KPF-T4] Verifying 3D Climb/Descent Rate Envelope & Terrain Floor Protection...');

// Create a scenario where a cliff wall forces an elevation rise of +500m over only 200m horizontal:
// Nominal aircraft speed = 50 m/s. Max climb rate = 10.0 m/s.
// Max feasible climb slope = 10 / sqrt(50^2 - 10^2) = 0.20412.
// In 200m horizontal, max climb is ~40.8m. Thus, a +500m jump directly at the cliff is aerodynamically impossible!
const stepM = 40.0;
const totalPts = 30;
const cliffWps: Waypoint3D[] = [];

for (let i = 0; i < totalPts; i++) {
  const x = i * stepM;
  // Floor jumps from 3500m to 4000m at index 20 (x = 800m)
  const floorAlt = i >= 20 ? 4000.0 : 3500.0;
  cliffWps.push({
    x,
    y: 0.0,
    altM: floorAlt,
    minTerrainClearanceAltM: floorAlt,
  });
}

const { smoothedPoints, maxClimbRateObservedMs, maxDescentRateObservedMs, verticalFeasible } =
  enforceClimbDescentConstraints(cliffWps, constraints50);

// 1. Observed vertical climb rate must not exceed maxClimbRateMs (10.0 m/s) + 0.1 tolerance
assert.ok(
  maxClimbRateObservedMs <= 10.1,
  `Observed climb rate (${maxClimbRateObservedMs.toFixed(2)} m/s) must not exceed 10.1 m/s`
);
assert.ok(
  maxDescentRateObservedMs <= 8.1,
  `Observed descent rate (${maxDescentRateObservedMs.toFixed(2)} m/s) must not exceed 8.1 m/s`
);
assert.equal(verticalFeasible, true, 'Vertical climb/descent must be verified feasible');

// 2. Strict Terrain Floor Protection: altM >= minTerrainClearanceAltM everywhere!
let floorViolations = 0;
for (let i = 0; i < smoothedPoints.length; i++) {
  const pt = smoothedPoints[i];
  if (pt.altM < (pt.minTerrainClearanceAltM ?? 0.0) - 1e-3) {
    floorViolations++;
  }
}
assert.equal(floorViolations, 0, 'Zero points may violate minTerrainClearanceAltM floor');

// 3. Backward anticipatory climb verification: aircraft starts climbing before index 20
assert.ok(
  smoothedPoints[15].altM > cliffWps[15].altM,
  'Aircraft must initiate anticipatory climb well before reaching cliff'
);

console.log(`  ✓ Backward elevation envelope ramped smoothly before cliff:`);
console.log(`    - Anticipatory Alt at x=600m (index 15): ${smoothedPoints[15].altM.toFixed(1)} m (Floor: ${cliffWps[15].altM} m)`);
console.log(`    - Cliff Arrival Alt at x=800m (index 20): ${smoothedPoints[20].altM.toFixed(1)} m (Floor: 4000.0 m)`);
console.log(`    - Max Climb Rate Observed: ${maxClimbRateObservedMs.toFixed(2)} m/s (Limit: 10.0 m/s)`);
console.log(`    - Floor Violations: ${floorViolations} (Zero Ground Collisions)`);

// =============================================================================
// [TEST 5] Obstacle Safety Guard & tacticalAiPathfinder Integration (KPF-T5)
// =============================================================================
console.log('\n[KPF-T5] Verifying Obstacle Safety Guard & tacticalAiPathfinder Integration...');

// 1. Define an obstacle box sitting right inside the corner-cutting fillet zone:
// In a 90° turn from (0,0) -> (1000, 0) -> (1000, 1000), the fillet arc passes through ~(700, 150).
const obstacleBox = {
  id: 'FORBIDDEN_ZONE_1',
  shape: 'cuboid' as const,
  xM: 700.0,
  yM: 150.0,
  widthM: 200.0,
  depthM: 200.0,
  heightM: 2000.0,
  rotationDeg: 0.0,
};

const isPointSafeWithBox = (x: number, y: number, altM: number): boolean => {
  // Check if (x,y) penetrates obstacleBox
  if (Math.abs(x - obstacleBox.xM) <= obstacleBox.widthM / 2.0 &&
      Math.abs(y - obstacleBox.yM) <= obstacleBox.depthM / 2.0) {
    return false; // Collision!
  }
  return true;
};

const smoothedWithObstacle = smoothWaypointsKinematically(rawCorner90, constraints50, isPointSafeWithBox);
assert.ok(
  smoothedWithObstacle.obstacleFallbackCount > 0,
  'Obstacle-penetrating fillet must trigger obstacleFallbackCount'
);

// Verify that no point in the final smoothed path penetrates the forbidden box
let obstaclePenetrations = 0;
for (const pt of smoothedWithObstacle.waypoints) {
  if (!isPointSafeWithBox(pt.x, pt.y, pt.altM)) {
    obstaclePenetrations++;
  }
}
assert.equal(obstaclePenetrations, 0, 'Smoothed path must contain zero points inside obstacle');
console.log(`  ✓ Obstacle safety guard prevented corner-cutting through obstacle (Fallback Count = ${smoothedWithObstacle.obstacleFallbackCount}, Penetrations = 0)`);

// 2. End-to-End tacticalAiPathfinder.ts Opt-In Integration
const syntheticFlatElevation = (_x: number, _y: number): number => 3500.0;

const advisoryParamsWithKinematics: AiRecoveryAdvisoryParams = {
  nodeId: 2,
  nodePos: [0.0, 0.0, 3502.0],
  nodeType: 'SOLDIER',
  acnPos: [2000.0, 2000.0, 5500.0],
  currentSinrDb: -5.0, // In outage -> triggers recovery directive
  currentIsOutage: true,
  getElevationAt: syntheticFlatElevation,
  kinematicConstraints: constraints50,
};

const recWithKinematics = computeAiRecoveryAdvisory(advisoryParamsWithKinematics);
assert.equal(recWithKinematics.status, 'RECOVERY_DIRECTIVE_FOUND', 'Recovery directive should be found');
assert.ok(recWithKinematics.kinematicAudit !== undefined, 'kinematicAudit must be attached when kinematicConstraints supplied');
assert.equal(recWithKinematics.kinematicAudit.isFeasible, true, 'Attached kinematicAudit must certify path feasible');
assert.ok(recWithKinematics.smoothedPathEnu !== undefined, 'smoothedPathEnu must be populated');
console.log(`  ✓ computeAiRecoveryAdvisory opt-in integration successful (Kinematic Feasible = ${recWithKinematics.kinematicAudit.isFeasible})`);

// 3. Backward Compatibility: Call without kinematicConstraints
const advisoryParamsStandard: AiRecoveryAdvisoryParams = {
  nodeId: 2,
  nodePos: [0.0, 0.0, 3502.0],
  nodeType: 'SOLDIER',
  acnPos: [2000.0, 2000.0, 5500.0],
  currentSinrDb: -5.0,
  currentIsOutage: true,
  getElevationAt: syntheticFlatElevation,
  // kinematicConstraints intentionally omitted!
};

const recStandard = computeAiRecoveryAdvisory(advisoryParamsStandard);
assert.equal(recStandard.status, 'RECOVERY_DIRECTIVE_FOUND');
assert.equal(recStandard.kinematicAudit, undefined, 'kinematicAudit must remain undefined when omitted (100% backward compatible)');
console.log('  ✓ Backward compatibility preserved: standard call emits no extraneous kinematic metadata.');

// =============================================================================
// [TEST 6] Edge Cases, Invariant Resilience & 50 Hz Performance Budget (KPF-T6)
// =============================================================================
console.log('\n[KPF-T6] Verifying Edge Cases, Invariant Resilience & 50 Hz Performance Budget...');

// 1. Coincident start & end poses
const coincidentRes = computeDubinsPath2D(
  { x: 100.0, y: 100.0, headingRad: 1.0 },
  { x: 100.0, y: 100.0, headingRad: 1.0 },
  testRadiusM
);
assert.equal(coincidentRes.totalLengthM, 0.0, 'Coincident poses must produce totalLengthM = 0');
assert.equal(coincidentRes.samples.length, 1, 'Coincident poses produce 1 sample point');
assert.ok(Number.isFinite(coincidentRes.samples[0].x), 'Zero NaN in coincident sample');

// 2. Collinear 3-waypoint polyline (0° deflection)
const collinearWps: Waypoint3D[] = [
  { x: 0.0, y: 0.0, altM: 1000.0 },
  { x: 500.0, y: 0.0, altM: 1000.0 },
  { x: 1000.0, y: 0.0, altM: 1000.0 },
];
const collinearSmoothed = smoothWaypointsKinematically(collinearWps, constraints50);
assert.equal(collinearSmoothed.isKinematicallyFeasible, true, 'Collinear path must be feasible');
assert.equal(collinearSmoothed.fallbackCount, 0, 'Collinear path requires zero fallbacks');

// 3. Single-waypoint degenerate polyline
const singleWp: Waypoint3D[] = [{ x: 50.0, y: 50.0, altM: 1000.0 }];
const singleSmoothed = smoothWaypointsKinematically(singleWp, constraints50);
assert.equal(singleSmoothed.waypoints.length, 1);
assert.equal(singleSmoothed.isKinematicallyFeasible, true);

// 4. Micro-benchmark: Single Dubins solve budget (< 50 µs)
const N_DUBINS = 1000;
const tDubinsStart = performance.now();
for (let i = 0; i < N_DUBINS; i++) {
  computeDubinsPath2D(
    { x: 0.0, y: 0.0, headingRad: 0.0 },
    { x: 500.0, y: 300.0, headingRad: 1.0 },
    400.0,
    20.0
  );
}
const tDubinsTotalMs = performance.now() - tDubinsStart;
const avgDubinsUs = (tDubinsTotalMs / N_DUBINS) * 1000.0;
assert.ok(
  avgDubinsUs < 50.0,
  `Dubins average solve time (${avgDubinsUs.toFixed(2)} µs) exceeds 50 µs budget`
);
console.log(`  ✓ 1,000 Dubins solves: avg ${avgDubinsUs.toFixed(2)} µs per solve (< 50 µs budget)`);

// 5. Micro-benchmark: 20-waypoint polyline smoothing + climb envelope + Menger audit budget (< 2 ms)
const bench20Wps: Waypoint3D[] = [];
for (let i = 0; i < 20; i++) {
  bench20Wps.push({
    x: i * 1000.0,
    y: (i % 2 === 0 ? 0.0 : 400.0),
    altM: 1000.0 + i * 25.0,
    minTerrainClearanceAltM: 950.0 + i * 20.0,
  });
}

const N_SMOOTH = 100;
const tSmoothStart = performance.now();
for (let i = 0; i < N_SMOOTH; i++) {
  smoothWaypointsKinematically(bench20Wps, constraints50);
}
const tSmoothTotalMs = performance.now() - tSmoothStart;
const avgSmoothMs = tSmoothTotalMs / N_SMOOTH;
assert.ok(
  avgSmoothMs < 2.0,
  `20-waypoint smoothing average time (${avgSmoothMs.toFixed(3)} ms) exceeds 2.0 ms budget`
);
console.log(`  ✓ 100 20-waypoint smoothings + audits: avg ${avgSmoothMs.toFixed(3)} ms (< 2.0 ms budget)`);

console.log('\n' + '='.repeat(96));
console.log('   ALL 6 KPF VERIFICATION SUITES (KPF-T1–T6) PASSED CONVINCINGLY');
console.log('='.repeat(96));
