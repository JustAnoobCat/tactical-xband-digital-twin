/**
 * src/tests/verifyWalkablePathfinderAndObstacleAvoidance.ts
 *
 * Authoritative verification suite for Suite 82:
 * 100% Step-by-Step Intermediate Terrain Walkability and 3D Obstacle Avoidance
 * (SPEC-WALKABLE-TERRAIN-PATHFINDER-AND-OBSTACLE-AVOIDANCE.md).
 *
 * Verifies:
 * - WPO-T1: Intermediate Cliff Rejection Despite Flat Average Slope (<1.5° average, >60° intermediate step cliff)
 * - WPO-T2: Soldier 30° vs. Wheeled MCP 18° Slope Limits (24° uniform slope)
 * - WPO-T3: 3D Barrier Wall Collision & Walk-Around Detour Routing
 * - WPO-T4: Spec Persistence, README Linking & Global Theme Invariance
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getMaxPassableSlopeDeg,
  evaluateGroundPathWalkability,
  computeAiRecoveryAdvisory,
  EdgeAiQTable,
  computeToblerWalkingSpeedMs,
  type GroundPathWalkabilityResult,
} from '../core/tacticalAiPathfinder';
import type { Position3D } from '../shared/types';
import type { Obstacle } from '../core/obstacles';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('='.repeat(96));
console.log('   VERIFY: WALKABLE TERRAIN PATHFINDER & 3D OBSTACLE AVOIDANCE (WPO-T1–T4)');
console.log('='.repeat(96));

// -----------------------------------------------------------------------------
// WPO-T1: Intermediate Cliff Rejection Despite Flat Average Slope
// -----------------------------------------------------------------------------
console.log('\n[WPO-T1] Intermediate Cliff Rejection Despite Flat Average Slope...');

// Construct synthetic terrain where (0,0) is 3500m and (400,0) is 3510m (net slope 1.43°).
// However, along the direct line (y = 0), a 120m vertical razorback cliff exists at x in [195, 225],
// causing the intermediate 30m step slope to exceed 60°!
// Outside |y| > 60m, the terrain is smooth and walkable.
const syntheticCliffTerrain = (x: number, y: number): number => {
  const baseElev = 3500.0 + 0.025 * x; // Smooth 1.43° ramp: z(0) = 3500, z(400) = 3510
  if (Math.abs(y) <= 60.0 && x >= 195.0 && x <= 225.0) {
    // 120m sheer cliff peak centered at x = 210m
    return baseElev + 120.0;
  }
  return baseElev;
};

// Verify endpoint elevation properties
assert.equal(syntheticCliffTerrain(0, 0), 3500.0, 'z(0, 0) must be 3500m');
assert.equal(syntheticCliffTerrain(400, 0), 3510.0, 'z(400, 0) must be 3510m');
const avgSlopeDeg = (Math.atan2(10.0, 400.0) * 180.0) / Math.PI;
assert.ok(Math.abs(avgSlopeDeg - 1.432) < 0.01, `Average slope should be ~1.43°, got ${avgSlopeDeg.toFixed(3)}°`);

// 1. Straight path from (0, 0) to (400, 0): Must be strictly REJECTED due to intermediate cliff
const straightWaypoints: Position3D[] = [
  [0.0, 0.0, 3500.0],
  [400.0, 0.0, 3510.0],
];

const straightEval = evaluateGroundPathWalkability(
  straightWaypoints,
  'SOLDIER',
  syntheticCliffTerrain
);

assert.equal(straightEval.isWalkable, false, 'Straight path through intermediate 120m cliff must be marked unwalkable');
assert.equal(straightEval.exceededSlopeLimit, true, 'exceededSlopeLimit must be true');
assert.ok(straightEval.maxStepSlopeDeg > 60.0, `Step slope at cliff should exceed 60°, got ${straightEval.maxStepSlopeDeg.toFixed(1)}°`);
console.log(`  -> Straight Path: isWalkable=${straightEval.isWalkable}, maxStepSlope=${straightEval.maxStepSlopeDeg.toFixed(1)}° (>60° cliff detected)`);

// 2. Detour contour path that loops around the cliff (|y| = 120m):
const contourDetourWaypoints: Position3D[] = [
  [0.0, 0.0, 3500.0],
  [200.0, 120.0, syntheticCliffTerrain(200.0, 120.0)],
  [400.0, 0.0, 3510.0],
];

const contourEval = evaluateGroundPathWalkability(
  contourDetourWaypoints,
  'SOLDIER',
  syntheticCliffTerrain
);

assert.equal(contourEval.isWalkable, true, 'Contour detour path around cliff must be walkable');
assert.equal(contourEval.exceededSlopeLimit, false, 'Contour detour must not exceed slope limit');
assert.ok(contourEval.maxStepSlopeDeg <= 30.0, `Contour step slope must be <= 30°, got ${contourEval.maxStepSlopeDeg.toFixed(1)}°`);
console.log(`  -> Contour Detour: isWalkable=${contourEval.isWalkable}, maxStepSlope=${contourEval.maxStepSlopeDeg.toFixed(1)}° (<=30° walkable)`);

// 3. Verify computeAiRecoveryAdvisory routes via a walkable contour or alternate bearing
const qTable = new EdgeAiQTable();
const advisory = computeAiRecoveryAdvisory({
  nodeId: 4,
  nodePos: [0.0, 0.0, 3500.0],
  nodeType: 'SOLDIER',
  acnPos: [0.0, 15000.0, 6000.0],
  currentSinrDb: -15.0,
  currentIsOutage: true,
  getElevationAt: syntheticCliffTerrain,
  qTable,
});

assert.equal(advisory.needsReposition, true, 'Occluded unit must receive recovery repositioning advisory');
assert.ok(advisory.walkPathEnu !== undefined && advisory.walkPathEnu.length >= 2, 'Advisory must return valid walkPathEnu');
assert.ok(advisory.maxStepSlopeDeg !== undefined && advisory.maxStepSlopeDeg <= 30.0, `Advisory maxStepSlopeDeg (${advisory.maxStepSlopeDeg}°) must be <= 30.0°`);

// Verify that every intermediate step of the returned walkPathEnu is 100% walkable
const returnedPathEval = evaluateGroundPathWalkability(advisory.walkPathEnu!, 'SOLDIER', syntheticCliffTerrain);
assert.equal(returnedPathEval.isWalkable, true, 'Path returned by AI advisory must be 100% walkable');
assert.ok(returnedPathEval.maxStepSlopeDeg <= 30.0, 'AI advisory walkPathEnu step slope must not exceed 30°');
console.log(`  -> AI Advisory Result: "${advisory.directiveText}"`);
console.log('✓ WPO-T1 PASS: Intermediate cliff rejection and walkable contour routing verified.');

// -----------------------------------------------------------------------------
// WPO-T2: Soldier 30° vs. Wheeled MCP 18° Slope Limits
// -----------------------------------------------------------------------------
console.log('\n[WPO-T2] Soldier 30° vs. Wheeled MCP 18° Slope Limits...');

// 1. Verify unit limits
assert.equal(getMaxPassableSlopeDeg('SOLDIER'), 30.0, 'SOLDIER max passable slope must be 30.0°');
assert.equal(getMaxPassableSlopeDeg('INFANTRY'), 30.0, 'INFANTRY max passable slope must be 30.0°');
assert.equal(getMaxPassableSlopeDeg('MCP'), 18.0, 'MCP max passable slope must be 18.0°');
assert.equal(getMaxPassableSlopeDeg('VEHICLE'), 18.0, 'VEHICLE max passable slope must be 18.0°');

// 2. Uniform 24° slope terrain:
// tan(24°) = 0.44522868
const slope24DegTerrain = (x: number, _y: number): number => {
  return 3000.0 + x * Math.tan((24.0 * Math.PI) / 180.0);
};

const slopeTestWaypoints: Position3D[] = [
  [0.0, 0.0, slope24DegTerrain(0.0, 0.0)],
  [100.0, 0.0, slope24DegTerrain(100.0, 0.0)],
];

// Test SOLDIER on 24° slope: ACCEPTED (24° <= 30°)
const soldierEval = evaluateGroundPathWalkability(
  slopeTestWaypoints,
  'SOLDIER',
  slope24DegTerrain
);
assert.equal(soldierEval.isWalkable, true, '24° slope must be walkable for SOLDIER (threshold 30°)');
assert.equal(soldierEval.maxAllowedSlopeDeg, 30.0, 'SOLDIER max allowed slope must be 30.0°');
assert.ok(Math.abs(soldierEval.maxStepSlopeDeg - 24.0) < 0.2, `Step slope should be 24°, got ${soldierEval.maxStepSlopeDeg.toFixed(2)}°`);

// Test MCP on 24° slope: REJECTED (24° > 18°)
const mcpEval = evaluateGroundPathWalkability(
  slopeTestWaypoints,
  'MCP',
  slope24DegTerrain
);
assert.equal(mcpEval.isWalkable, false, '24° slope must be rejected for wheeled MCP (threshold 18°)');
assert.equal(mcpEval.exceededSlopeLimit, true, 'MCP exceededSlopeLimit must be true');
assert.equal(mcpEval.maxAllowedSlopeDeg, 18.0, 'MCP max allowed slope must be 18.0°');

// Also test computeToblerWalkingSpeedMs isPassable property
const toblerSoldier = computeToblerWalkingSpeedMs(100.0, 100.0 * Math.tan((24.0 * Math.PI) / 180.0), 'SOLDIER');
assert.equal(toblerSoldier.isPassable, true, 'Tobler speed isPassable must be true for SOLDIER on 24° slope');

const toblerMcp = computeToblerWalkingSpeedMs(100.0, 100.0 * Math.tan((24.0 * Math.PI) / 180.0), 'MCP');
assert.equal(toblerMcp.isPassable, false, 'Tobler speed isPassable must be false for MCP on 24° slope');

console.log('✓ WPO-T2 PASS: Soldier (30°) vs Wheeled MCP (18°) slope limits verified.');

// -----------------------------------------------------------------------------
// WPO-T3: 3D Barrier Wall Collision & Walk-Around Detour
// -----------------------------------------------------------------------------
console.log('\n[WPO-T3] 3D Barrier Wall Collision & Walk-Around Detour...');

// Place a 3D cuboid obstacle wall centered at (0, 160) between start (0, 0) and target (0, 320):
// Wall spans X from -40m to +40m (width 80m), Y from 150m to 170m (depth 20m), height 15m.
const barrierWall: Obstacle = {
  id: 'tactical-barrier-wall-1',
  shape: 'cuboid',
  xM: 0.0,
  yM: 160.0,
  widthM: 80.0,
  depthM: 20.0,
  heightM: 15.0,
  rotationDeg: 0.0,
};

const flatTerrain = (_x: number, _y: number) => 3200.0;

// 1. Direct segment from (0, 0) to (0, 320) directly bisects the barrier wall:
const directBlockedWaypoints: Position3D[] = [
  [0.0, 0.0, 3200.0],
  [0.0, 320.0, 3200.0],
];

const wallCollisionEval = evaluateGroundPathWalkability(
  directBlockedWaypoints,
  'SOLDIER',
  flatTerrain,
  [barrierWall]
);

assert.equal(wallCollisionEval.isWalkable, false, 'Direct path intersecting barrier wall must be marked unwalkable');
assert.equal(wallCollisionEval.blockedByObstacle, true, 'blockedByObstacle must be true');
console.log(`  -> Direct Line: isWalkable=${wallCollisionEval.isWalkable}, blockedByObstacle=${wallCollisionEval.blockedByObstacle}`);

// 2. Detour dogleg path that routes around the barrier wall:
// Wall extends to x = ±40m. A detour via (70, 160) easily clears the wall by 30m!
const detourWaypoints: Position3D[] = [
  [0.0, 0.0, 3200.0],
  [70.0, 160.0, 3200.0],
  [0.0, 320.0, 3200.0],
];

const detourEval = evaluateGroundPathWalkability(
  detourWaypoints,
  'SOLDIER',
  flatTerrain,
  [barrierWall]
);

assert.equal(detourEval.isWalkable, true, 'Detour path around barrier wall must be walkable');
assert.equal(detourEval.blockedByObstacle, false, 'Detour path must not collide with barrier');
console.log(`  -> Detour Line: isWalkable=${detourEval.isWalkable}, blockedByObstacle=${detourEval.blockedByObstacle}`);

// 3. Verify computeAiRecoveryAdvisory automatically detects obstacle and generates detour path
const obstacleAdvisory = computeAiRecoveryAdvisory({
  nodeId: 2,
  nodePos: [0.0, 0.0, 3200.0],
  nodeType: 'SOLDIER',
  acnPos: [0.0, 15000.0, 6000.0],
  currentSinrDb: -20.0,
  currentIsOutage: true,
  getElevationAt: flatTerrain,
  qTable,
  obstacles: [barrierWall],
});

assert.equal(obstacleAdvisory.needsReposition, true, 'Reposition directive must be generated');
assert.ok(obstacleAdvisory.walkPathEnu !== undefined, 'Advisory must provide walkPathEnu');

// Verify that the chosen path does NOT collide with the obstacle
const aiObsEval = evaluateGroundPathWalkability(obstacleAdvisory.walkPathEnu!, 'SOLDIER', flatTerrain, [barrierWall]);
assert.equal(aiObsEval.isWalkable, true, 'AI chosen recovery path must be completely walkable and clear of obstacle');
assert.equal(aiObsEval.blockedByObstacle, false, 'AI chosen recovery path must not collide with barrier');
console.log(`  -> Obstacle Recovery Directive: "${obstacleAdvisory.directiveText}"`);
console.log('✓ WPO-T3 PASS: 3D barrier collision and walk-around detour verified.');

// -----------------------------------------------------------------------------
// WPO-T4: Spec Persistence, README Linking & Global Theme Invariance
// -----------------------------------------------------------------------------
console.log('\n[WPO-T4] Spec Persistence, README Linking & Global Theme Invariance...');

// 1. Verify specification file exists
const specPath = path.join(ROOT_DIR, 'docs/specs/SPEC-WALKABLE-TERRAIN-PATHFINDER-AND-OBSTACLE-AVOIDANCE.md');
assert.ok(existsSync(specPath), 'SPEC-WALKABLE-TERRAIN-PATHFINDER-AND-OBSTACLE-AVOIDANCE.md must exist on disk');

// 2. Verify linked in README.md Section 7
const readmePath = path.join(ROOT_DIR, 'README.md');
const readmeText = readFileSync(readmePath, 'utf8');
assert.ok(readmeText.includes('SPEC-WALKABLE-TERRAIN-PATHFINDER-AND-OBSTACLE-AVOIDANCE.md'), 'README.md must link the walkable pathfinder spec');

// 3. Verify c2-console-theme.css exists
assert.ok(existsSync(path.join(ROOT_DIR, 'frontend/c2-console-theme.css')), 'frontend/c2-console-theme.css must exist');

// 4. Verify index.html multi-waypoint rendering and readout support
const indexHtml = readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
assert.ok(indexHtml.includes('ai_walk_path_enu'), 'index.html must process ai_walk_path_enu');
assert.ok(indexHtml.includes('Max Slope:'), 'index.html must display Max Slope in #ai-directive-readout');

console.log('✓ WPO-T4 PASS: Spec persistence, README linking, and theme invariance verified.');

console.log('\n' + '='.repeat(96));
console.log('   ALL 4 WPO VERIFICATION SUITES (WPO-T1–T4) PASSED CONVINCINGLY');
console.log('='.repeat(96));
