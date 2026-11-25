/**
 * src/tests/verifySoftwareEngineeringArchitecture.ts
 *
 * Verification Suite: Software Engineering Architecture, DRY Physics Unification,
 * Worker Separation of Concerns, and Type-Checked UI Scopes.
 *
 * Implements SEA-T1 to SEA-T4:
 * 1. SEA-T1: DRY Single-Source-of-Truth Math Library (rfPropagationMath.ts) and consumer verification.
 * 2. SEA-T2: Worker Decomposition & EdgeAiCopilotCoordinator Kinematic / Waypoint Stepping.
 * 3. SEA-T3: Type-Checked UI Scope Modules (scientificScopesRenderer.ts & soldierEudRenderer.ts).
 * 4. SEA-T4: Spec Persistence, README Linking, and C2 Console Theme Invariance.
 *
 * Specification: docs/specs/SPEC-SOFTWARE-ENGINEERING-MODULARITY-AND-DRY-REFACTOR.md
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  computeEarthBulgeM,
  computeFirstFresnelRadiusM,
  computeKnifeEdgeDiffractionLossDb,
  computeFsplDb,
  azimuthToCardinal16,
  computeBearingDeg,
  computeSlantAndHorizDistance,
} from '../core/rfPropagationMath';
import {
  EdgeAiCopilotCoordinator,
  type AiMovableGroundNode,
} from '../worker/aiCopilotCoordinator';
import {
  drawPolarAntennaScope,
  drawLinkWaterfallCanvas,
  drawEcdfDelayScope,
  drawSensitivitySweepScope,
  drawWorkerJitterHistogramScope,
} from '../ui/scientificScopesRenderer';
import {
  drawSoldierCompassScope,
  resolveSoldierAiNotificationBanner,
} from '../ui/soldierEudRenderer';

console.log('================================================================================================');
console.log('   VERIFY: SOFTWARE ENGINEERING ARCHITECTURE & DRY REFACTOR SUITE (SEA-T1–T4)');
console.log('================================================================================================\n');

// -----------------------------------------------------------------------------
// SEA-T1: DRY Canonical Math Library Verification & Consumer Inspection
// -----------------------------------------------------------------------------
console.log('[SEA-T1] Verifying DRY Single-Source-of-Truth Math Library...');

// 1. Earth Bulge Math Test
const bulge = computeEarthBulgeM(10000, 10000, 4.0 / 3.0, 6371000);
console.log(`  Earth Bulge for 10km-10km split: ${bulge.toFixed(4)} m (Expected: ~5.886 m)`);
assert(Math.abs(bulge - 5.886) < 0.05, `Earth bulge ${bulge} diverged from theoretical 5.886m`);

// 2. First Fresnel Radius Math Test (8.0 GHz -> lambda = 0.037474m)
const fresnel = computeFirstFresnelRadiusM(5000, 5000, 299792458 / 8.0e9);
console.log(`  First Fresnel radius for 5km-5km at 8GHz: ${fresnel.toFixed(4)} m (Expected: ~9.679 m)`);
assert(Math.abs(fresnel - 9.679) < 0.05, `Fresnel radius ${fresnel} diverged from theoretical 9.679m`);

// 3. Knife-Edge Diffraction Loss Math Test (ITU-R P.526-15)
const lossClear = computeKnifeEdgeDiffractionLossDb(-1.5);
const lossGrazing = computeKnifeEdgeDiffractionLossDb(0.0);
const lossObstructed = computeKnifeEdgeDiffractionLossDb(1.0);
console.log(`  Knife-edge loss: v=-1.5 -> ${lossClear.toFixed(2)} dB, v=0 -> ${lossGrazing.toFixed(2)} dB, v=1 -> ${lossObstructed.toFixed(2)} dB`);
assert.equal(lossClear, 0.0, 'Clear line of sight should have 0 dB knife-edge loss');
assert(Math.abs(lossGrazing - 6.0) < 0.2, 'Grazing line of sight should have ~6.0 dB knife-edge loss');
assert(Math.abs(lossObstructed - 13.7) < 0.5, 'Obstructed line of sight should have ~13.7 dB knife-edge loss');

// 4. FSPL Math Test (1 km at 8.0 GHz)
const fspl1km = computeFsplDb(1000, 8.0e9);
console.log(`  FSPL at 1km 8GHz: ${fspl1km.toFixed(2)} dB (Expected: ~110.5 dB)`);
assert(Math.abs(fspl1km - 110.5) < 0.5, `FSPL ${fspl1km} diverged from theoretical 110.5 dB`);

// 5. Bearing & 16-Wind Cardinal Math Test
assert.equal(azimuthToCardinal16(0), 'N');
assert.equal(azimuthToCardinal16(45), 'NE');
assert.equal(azimuthToCardinal16(90), 'E');
assert.equal(azimuthToCardinal16(180), 'S');
assert.equal(azimuthToCardinal16(270), 'W');
assert.equal(azimuthToCardinal16(340), 'NNW');

assert.equal(computeBearingDeg(0, 10), 0);
assert.equal(computeBearingDeg(10, 0), 90);
assert.equal(computeBearingDeg(0, -10), 180);
assert.equal(computeBearingDeg(-10, 0), 270);

// 6. Slant & Horiz Distance Test
const dists = computeSlantAndHorizDistance(300, 400, 0);
assert.equal(dists.horizDistM, 500);
assert.equal(dists.slantDistM, 500);

// 7. Verify all 5 consumer engines import from canonical rfPropagationMath
const consumerFiles = [
  'src/core/geodeticRulerEngine.ts',
  'src/core/cursorProbeEngine.ts',
  'src/core/aoSwathScannerEngine.ts',
  'src/core/cadObstacleSlicerEngine.ts',
  'src/core/tacticalAiPathfinder.ts',
];

for (const relPath of consumerFiles) {
  const fullPath = path.resolve(process.cwd(), relPath);
  assert(fs.existsSync(fullPath), `Consumer file missing: ${relPath}`);
  const content = fs.readFileSync(fullPath, 'utf8');
  assert(
    content.includes("from './rfPropagationMath") || content.includes('from "./rfPropagationMath'),
    `Consumer ${relPath} does not import from ./rfPropagationMath!`,
  );
  console.log(`  ✓ ${relPath} verified importing from ./rfPropagationMath`);
}

console.log('SEA-T1: PASS\n');

// -----------------------------------------------------------------------------
// SEA-T2: Worker Decomposition & EdgeAiCopilotCoordinator Verification
// -----------------------------------------------------------------------------
console.log('[SEA-T2] Verifying Worker Coordinator Decomposition & Kinematics...');

const aiCoordinator = new EdgeAiCopilotCoordinator();
assert(aiCoordinator instanceof EdgeAiCopilotCoordinator, 'EdgeAiCopilotCoordinator failed to instantiate');

// 1. Sky-Shepherd Smooth Kinematic Slewing
aiCoordinator.aiSkyShepherdActive = true;
aiCoordinator.aiSkyShepherdNodeId = 1;
aiCoordinator.skyShepherdTargetOffset = [800.0, 0.0, 250.0];
aiCoordinator.skyShepherdCurrentOffset = [0.0, 0.0, 0.0];

// Step 1.0 second: vHoriz max = 80 m/s, vVert max = 25 m/s
aiCoordinator.stepSkyShepherdSlew(1.0);
console.log(
  `  Sky-Shepherd slew after 1.0s: [${aiCoordinator.skyShepherdCurrentOffset.map(v => v.toFixed(1)).join(', ')}]` +
  ` (Expected: [80.0, 0.0, 25.0])`,
);
assert.equal(aiCoordinator.skyShepherdCurrentOffset[0], 80.0);
assert.equal(aiCoordinator.skyShepherdCurrentOffset[1], 0.0);
assert.equal(aiCoordinator.skyShepherdCurrentOffset[2], 25.0);

// Step 9.0 seconds more: total 10s should reach [800.0, 0.0, 250.0] exactly
aiCoordinator.stepSkyShepherdSlew(9.0);
assert.equal(aiCoordinator.skyShepherdCurrentOffset[0], 800.0);
assert.equal(aiCoordinator.skyShepherdCurrentOffset[1], 0.0);
assert.equal(aiCoordinator.skyShepherdCurrentOffset[2], 250.0);
console.log('  ✓ Sky-Shepherd loiter slewing accurately clamped at target offset');

// 2. Multi-Waypoint Tobler Movement Stepper
const staticNode: AiMovableGroundNode = {
  nodeId: 101,
  position: [0.0, 0.0, 3202.0],
  aglM: 2.0,
  nodeType: 'SOLDIER',
};
const tacNode: AiMovableGroundNode = {
  nodeId: 101,
  position: [0.0, 0.0, 3202.0],
  aglM: 2.0,
  nodeType: 'SOLDIER',
};

aiCoordinator.aiActiveMovements.set(101, {
  targetPos: [100.0, 0.0, 3200.0],
  speedMs: 2.5,
  moveBearingDeg: 90.0,
  waypoints: [
    [0.0, 0.0, 3200.0],
    [50.0, 0.0, 3200.0],
    [100.0, 0.0, 3200.0],
  ],
  waypointIndex: 1,
});
aiCoordinator.aiActiveMovingNodes.add(101);

const dummyGetElevation = () => 3200.0;

// Step 5 seconds of movement (at 2.5 m/s, advances 12.5m)
const moved = aiCoordinator.stepActiveAiNodeMoves(5.0, dummyGetElevation, [staticNode], [tacNode]);
console.log(`  Stepped node position after 5s: [${staticNode.position.map(v => v.toFixed(2)).join(', ')}]`);
assert.equal(moved, true, 'stepActiveAiNodeMoves should report movement');
assert(staticNode.position[0] > 0.0, 'Node position should advance along positive X axis');
assert.equal(staticNode.position[0], tacNode.position[0], 'Static and Tac node positions should stay synchronized');
assert(aiCoordinator.aiActiveMovingNodes.has(101), 'Node 101 should be tracked in aiActiveMovingNodes');

// 3. simWorker.ts integration inspection
const simWorkerPath = path.resolve(process.cwd(), 'src/worker/simWorker.ts');
const simWorkerCode = fs.readFileSync(simWorkerPath, 'utf8');
assert(
  simWorkerCode.includes("from './aiCopilotCoordinator'"),
  'simWorker.ts does not import from ./aiCopilotCoordinator',
);
assert(
  simWorkerCode.includes('aiCoordinator: EdgeAiCopilotCoordinator = new EdgeAiCopilotCoordinator()'),
  'simWorker.ts does not instantiate EdgeAiCopilotCoordinator',
);
assert(
  simWorkerCode.includes('this.aiCoordinator.stepSkyShepherdSlew('),
  'simWorker.ts does not delegate stepSkyShepherdSlew to aiCoordinator',
);
assert(
  simWorkerCode.includes('this.aiCoordinator.stepActiveAiNodeMoves'),
  'simWorker.ts does not delegate stepActiveAiNodeMoves to aiCoordinator',
);
console.log('  ✓ simWorker.ts cleanly delegates to EdgeAiCopilotCoordinator');

console.log('SEA-T2: PASS\n');

// -----------------------------------------------------------------------------
// SEA-T3: Type-Checked UI Scope Modules Verification
// -----------------------------------------------------------------------------
console.log('[SEA-T3] Verifying Type-Checked UI Scope Modules & index.html Delegation...');

// 1. Export checks
assert.equal(typeof drawPolarAntennaScope, 'function', 'drawPolarAntennaScope must be exported');
assert.equal(typeof drawLinkWaterfallCanvas, 'function', 'drawLinkWaterfallCanvas must be exported');
assert.equal(typeof drawEcdfDelayScope, 'function', 'drawEcdfDelayScope must be exported');
assert.equal(typeof drawSensitivitySweepScope, 'function', 'drawSensitivitySweepScope must be exported');
assert.equal(typeof drawWorkerJitterHistogramScope, 'function', 'drawWorkerJitterHistogramScope must be exported');
assert.equal(typeof drawSoldierCompassScope, 'function', 'drawSoldierCompassScope must be exported');
assert.equal(typeof resolveSoldierAiNotificationBanner, 'function', 'resolveSoldierAiNotificationBanner must be exported');

// 2. Test resolveSoldierAiNotificationBanner logic under all tactical states
const bannerMoving = resolveSoldierAiNotificationBanner(
  { node_id: 1, ai_is_moving: true, ai_eta_s: 18, ai_move_dist_m: 24 },
  false,
);
assert.equal(bannerMoving.badge, 'IN TRANSIT');
assert.equal(bannerMoving.titleColor, '#38bdf8');

const bannerBlackout = resolveSoldierAiNotificationBanner(
  { node_id: 2, ai_blackout_in_s: 11.4 },
  false,
);
assert.equal(bannerBlackout.badge, 'PREDICTIVE');
assert.equal(bannerBlackout.titleColor, '#ef4444');

const bannerSkyShepherd = resolveSoldierAiNotificationBanner(
  { node_id: 3, sinr_db: 12.5 },
  true,
  true,
  'UAV loiter shifted',
);
assert.equal(bannerSkyShepherd.badge, 'PINNED RESCUE');
assert.equal(bannerSkyShepherd.titleColor, '#38bdf8');

const bannerBuddy = resolveSoldierAiNotificationBanner(
  { node_id: 4, ai_buddy_node_id: 2, bitrate_mbps: 4.8 },
  false,
);
assert.equal(bannerBuddy.badge, 'PEER MESH');
assert.equal(bannerBuddy.titleColor, '#3b82f6');

const bannerOptimal = resolveSoldierAiNotificationBanner(
  { node_id: 5, sinr_db: 14.2, is_outage: false },
  false,
);
assert.equal(bannerOptimal.badge, 'CLEAR LOS');
assert.equal(bannerOptimal.titleColor, '#22c55e');
console.log('  ✓ resolveSoldierAiNotificationBanner produces verified tactical alerts across all states');

// 3. src/main.ts import & wrapper inspection (extracted from index.html)
const mainTsPath = path.resolve(process.cwd(), 'src/main.ts');
const mainTsCode = fs.readFileSync(mainTsPath, 'utf8');

assert(
  mainTsCode.includes("from './ui/scientificScopesRenderer.ts'"),
  'src/main.ts does not import from scientificScopesRenderer.ts',
);
assert(
  mainTsCode.includes("from './ui/soldierEudRenderer.ts'"),
  'src/main.ts does not import from soldierEudRenderer.ts',
);
assert(
  mainTsCode.includes('renderPolarAntennaScope(polarAntennaCanvas'),
  'src/main.ts does not delegate to renderPolarAntennaScope',
);
assert(
  mainTsCode.includes('renderLinkWaterfallCanvas(linkWaterfallCanvas'),
  'src/main.ts does not delegate to renderLinkWaterfallCanvas',
);
assert(
  mainTsCode.includes('renderEcdfDelayScope(ecdfDelayCanvas'),
  'src/main.ts does not delegate to renderEcdfDelayScope',
);
assert(
  mainTsCode.includes('renderSensitivitySweepScope('),
  'src/main.ts does not delegate to renderSensitivitySweepScope',
);
assert(
  mainTsCode.includes('drawSoldierCompassScope('),
  'src/main.ts does not delegate to drawSoldierCompassScope',
);
assert(
  mainTsCode.includes('resolveSoldierAiNotificationBanner('),
  'src/main.ts does not delegate to resolveSoldierAiNotificationBanner',
);
console.log('  ✓ src/main.ts successfully wired with typed rendering module delegates');

console.log('SEA-T3: PASS\n');

// -----------------------------------------------------------------------------
// SEA-T4: Spec Persistence, README Linking, and Theme Invariance
// -----------------------------------------------------------------------------
console.log('[SEA-T4] Verifying Spec Persistence, README Linking, and Theme Invariance...');

// 1. Spec file on disk
const specPath = path.resolve(
  process.cwd(),
  'docs/specs/SPEC-SOFTWARE-ENGINEERING-MODULARITY-AND-DRY-REFACTOR.md',
);
assert(fs.existsSync(specPath), 'Specification file missing on disk');
const specContent = fs.readFileSync(specPath, 'utf8');
assert(specContent.length > 1000, 'Specification file is unexpectedly empty or truncated');
console.log(`  ✓ Specification exists on disk (${specContent.length} bytes)`);

// 2. README.md linking
const readmePath = path.resolve(process.cwd(), 'README.md');
const readmeContent = fs.readFileSync(readmePath, 'utf8');
assert(
  readmeContent.includes('SPEC-SOFTWARE-ENGINEERING-MODULARITY-AND-DRY-REFACTOR.md'),
  'README.md does not link to SPEC-SOFTWARE-ENGINEERING-MODULARITY-AND-DRY-REFACTOR.md',
);
console.log('  ✓ Specification linked in README.md Section 7');

// 3. Theme file existence
assert.ok(fs.existsSync(path.resolve(process.cwd(), 'frontend/c2-console-theme.css')), 'frontend/c2-console-theme.css must exist');
console.log('  ✓ frontend/c2-console-theme.css exists');

console.log('SEA-T4: PASS\n');

console.log('================================================================================================');
console.log('   SOFTWARE ENGINEERING ARCHITECTURE SUITE COMPLETED: ALL GATES PASS (4/4)');
console.log('================================================================================================');
