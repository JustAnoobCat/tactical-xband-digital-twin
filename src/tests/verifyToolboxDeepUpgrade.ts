/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Automated Verification Suite: 3D MapLibre Fix & Deep Scientific Terrain Toolbox Upgrade
 * Specification: docs/specs/SPEC-3D-MAPLIBRE-FIX-AND-TOOLBOX-DEEP-UPGRADE.md
 *
 * Test Suites:
 * - TBU-T1: 3D Zero-Lag Optimization (fast128 Mesh Decimation, Unlit BasicMaterial, Zero computeLineDistances, 8Hz Canvas Throttling)
 * - TBU-T2: Scheduler-Synchronized MapLibre Kinetic Overlay & Static Outage Badging (Active Gantt, 5QI Color-Coding, WASTED TX Flash)
 * - TBU-T3: CloudRF Transect Fresnel Ellipse, 4/3 Bulge & STK Probe Readouts (Bulge, Fresnel, P.526, Transect RF, Virtual Link)
 * - TBU-T4: QGIS Region Summit Pinpointer, LoS % & Excalidraw Obstacle Authoring (Summit, TRI, Undo/Redo, Presets, Spec Integrity)
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { buildFastDemGeometry, buildPerimeterSkirtGeometry } from '../ui/three/terrainBuilder';
import { createFastTerrainMaterial, createFastSkirtMaterial } from '../ui/three/terrainRenderer';
import {
  computeEarthBulgeM,
  computeFresnelRadiusM,
  computeP526DiffractionLossDb,
  computeTransectRfMetrics,
  evaluateVirtualTerminalLink,
  computeZonalSummitAndRuggedness,
  ObstacleHistoryManager,
  OBSTACLE_PRESETS,
  MATERIAL_PROFILES,
} from '../ui/terrainAnalysisController';
import type { Obstacle } from '../core/obstacles';

function readMainAndAppSource(): string {
  const appDir = resolve(process.cwd(), 'src/app');
  const appSources = existsSync(appDir)
    ? readdirSync(appDir).filter((f) => f.endsWith('.ts')).sort().map((f) => readFileSync(resolve(appDir, f), 'utf-8'))
    : [];
  return [readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf-8'), ...appSources].join('\n');
}

console.log('='.repeat(96));
console.log('   3D MAPLIBRE FIX & DEEP TOOLBOX UPGRADE VERIFICATION SUITE');
console.log('   Specification: docs/specs/SPEC-3D-MAPLIBRE-FIX-AND-TOOLBOX-DEEP-UPGRADE.md');
console.log('='.repeat(96));

// =================================================================================================
// [TBU-T1] 3D Zero-Lag Optimization (fast128 Mesh Decimation & Zero computeLineDistances)
// =================================================================================================
console.log('\n[TBU-T1] Verifying 3D Zero-Lag Optimization (fast128 Decimation & Zero computeLineDistances)...');
{
  // 1. Verify buildFastDemGeometry creates an efficient 128x128 mesh (16,384 vertices, 32,258 triangles)
  const dummyDem = new Float32Array(512 * 512).fill(3500);
  const payload = {
    terrainMode: 'real' as const,
    bounds: { minX: -60000, maxX: 60000, minY: -60000, maxY: 60000 },
    gridSize: 512,
    minElevationM: 3000,
    maxElevationM: 6000,
    elevations: dummyDem,
  };
  const fastGeom = buildFastDemGeometry(payload);
  assert.ok(fastGeom instanceof THREE.BufferGeometry, 'buildFastDemGeometry must return a THREE.BufferGeometry');

  const posAttr = fastGeom.getAttribute('position');
  assert.ok(posAttr, 'Geometry must contain position attribute');
  assert.equal(posAttr.count, 128 * 128, 'fast128 geometry must have exactly 128 * 128 = 16,384 vertices');

  const indexAttr = fastGeom.getIndex();
  assert.ok(indexAttr, 'fast128 geometry must have index attribute');
  assert.equal(indexAttr.count, 127 * 127 * 6, 'fast128 geometry must have exactly 127 * 127 * 6 = 96,774 indices (32,258 triangles)');
  assert.ok(indexAttr.array instanceof Uint16Array, '128x128 mesh must use memory-efficient Uint16Array indices');

  // Skirt geometry with fast128
  const skirtGeom = buildPerimeterSkirtGeometry(payload, 'fast128', 1000);
  assert.ok(skirtGeom instanceof THREE.BufferGeometry, 'Skirt geometry must build cleanly with fast128 resolution');

  // 2. Verify unlit MeshBasicMaterial for fast terrain and skirt
  const dummyTexture = new THREE.Texture();
  const terrainMat = createFastTerrainMaterial(dummyTexture);
  assert.ok(terrainMat instanceof THREE.MeshBasicMaterial, 'createFastTerrainMaterial must return THREE.MeshBasicMaterial');
  const skirtMat = createFastSkirtMaterial();
  assert.ok(skirtMat instanceof THREE.MeshBasicMaterial, 'createFastSkirtMaterial must return THREE.MeshBasicMaterial');

  // 3. Verify sceneManager.ts defaults to fast128
  const sceneMgrCode = readFileSync(resolve(process.cwd(), 'src/ui/three/sceneManager.ts'), 'utf-8');
  assert.ok(sceneMgrCode.includes("terrainResolution: TerrainMeshResolution = 'fast128'") || sceneMgrCode.includes("terrainResolution = 'fast128'"), "sceneManager.ts must default terrainResolution to 'fast128'");

  // 4. Verify ZERO .computeLineDistances() in src/ui/three/tacticalEntityManager.ts
  const entityMgrCode = readFileSync(resolve(process.cwd(), 'src/ui/three/tacticalEntityManager.ts'), 'utf-8');
  const computeCalls = (entityMgrCode.match(/\.computeLineDistances\(\)/g) || []).length;
  assert.equal(computeCalls, 0, 'tacticalEntityManager.ts must have ZERO .computeLineDistances() calls to eliminate CPU-to-GPU overhead');

  // 5. Verify src/main.ts + src/app/*.ts throttles secondary canvases (including timeline) to 125ms (8Hz) in 3D mode
  const mainTs = readMainAndAppSource();
  assert.ok(mainTs.includes("stageViewMode === '3d'"), "src/main.ts must check stageViewMode === '3d'");
  assert.ok(mainTs.includes('last3dSecondaryCanvasThrottleMs') && mainTs.includes('125'), "src/main.ts must throttle timeline and secondary canvases to 125ms (8Hz) in 3D mode");

  console.log('  ✓ buildFastDemGeometry produces 16,384-vertex, 32,258-triangle mesh with Uint16Array indices');
  console.log('  ✓ MeshBasicMaterial verified for unlit rendering');
  console.log('  ✓ sceneManager defaults to fast128');
  console.log('  ✓ Zero .computeLineDistances() verified in tacticalEntityManager.ts');
  console.log('  ✓ 8 Hz canvas throttling verified in 3D mode');
}

// =================================================================================================
// [TBU-T2] Scheduler-Synchronized MapLibre Kinetic Overlay & Static Outage Badging
// =================================================================================================
console.log('\n[TBU-T2] Verifying Scheduler-Synchronized MapLibre Kinetic Overlay & Static Outage Badging...');
{
  const mainTs = readMainAndAppSource();

  // 1. Verify scheduler mode and active Gantt extraction
  assert.ok(mainTs.includes('frame.scheduler_mode'), 'renderMapLibreKineticOverlay must inspect frame.scheduler_mode');
  assert.ok(mainTs.includes('frame.tac_gantt') && mainTs.includes('frame.static_gantt'), 'renderMapLibreKineticOverlay must select between frame.tac_gantt and frame.static_gantt');
  assert.ok(mainTs.includes('scheduledAllocByNodeId'), 'renderMapLibreKineticOverlay must build scheduledAllocByNodeId map');

  // 2. Verify pulse train animation gating on isScheduled && !isOutage
  assert.ok(mainTs.includes('isScheduled && !isOutage'), 'Packet pulse trains must only animate when isScheduled && !isOutage');

  // 3. Verify color coding by active 5QI classes
  assert.ok(mainTs.includes('#ff2a54') && mainTs.includes('#00e5ff') && mainTs.includes('#00e676') && mainTs.includes('#ffab00') && mainTs.includes('#b388ff'),
    'renderMapLibreKineticOverlay must support 5QI class colors (Crimson 69, Cyan 65, Emerald 67, Amber 70, Violet flush)');

  // 4. Verify [TX] and FLUSHING [Φ_evac] badge rendering
  assert.ok(mainTs.includes('[TX]'), 'renderMapLibreKineticOverlay must render [TX] badges next to scheduled nodes');
  assert.ok(mainTs.includes('FLUSHING [Φ_evac]') || mainTs.includes('FLUSHING'), 'renderMapLibreKineticOverlay must support pre-occlusion flush badge');

  // 5. Verify [WASTED TX] static outage flash
  assert.ok(mainTs.includes('[WASTED TX]'), 'renderMapLibreKineticOverlay must render [WASTED TX] flash when static schedule encounters an outage');

  console.log('  ✓ Active Gantt selection (tac_gantt vs static_gantt) verified');
  console.log('  ✓ Packet pulse trains gated strictly on isScheduled && !isOutage');
  console.log('  ✓ 5QI class color pulses (69, 65, 67, 70, flush) verified');
  console.log('  ✓ [TX] duration/modcod badge verified');
  console.log('  ✓ [WASTED TX] static outage flash badge verified');
}

// =================================================================================================
// [TBU-T3] CloudRF Transect Fresnel Ellipse, 4/3 Bulge & STK Probe Readouts
// =================================================================================================
console.log('\n[TBU-T3] Verifying CloudRF Transect Fresnel Ellipse, 4/3 Bulge & STK Probe Readouts...');
{
  const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');

  // 1. DOM element presence in #tb-pane-transect
  const transectDomIds = [
    'tb-transect-tx-mast',
    'tb-transect-rx-mast',
    'tb-transect-fresnel',
    'tb-transect-diffraction',
    'tb-transect-snr',
  ];
  for (const id of transectDomIds) {
    assert.ok(indexHtml.includes(`id="${id}"`), `index.html must define DOM element #${id}`);
  }

  // 2. DOM element presence in #tb-pane-probe
  const probeDomIds = [
    'tb-probe-acn-range',
    'tb-probe-acn-el',
    'tb-probe-acn-los',
    'tb-probe-acn-sinr',
    'tb-probe-acn-modcod',
    'tb-probe-spawn-node',
  ];
  for (const id of probeDomIds) {
    assert.ok(indexHtml.includes(`id="${id}"`), `index.html must define DOM element #${id}`);
  }

  // 3. Test computeEarthBulgeM: midpoint curvature of 4/3 Earth
  // Formula: Delta h(s) = s * (D - s) / (2 * R_eff)
  // At midpoint of 20 km link: (10,000 * 10,000) / (2 * 8,494,667) = 100,000,000 / 16,989,333 ~= 5.886 m
  const bulgeMid = computeEarthBulgeM(10000, 20000);
  assert.ok(Math.abs(bulgeMid - 5.886) < 0.05, `Earth bulge at midpoint of 20km must be ~5.89m (got ${bulgeMid.toFixed(3)})`);
  assert.equal(computeEarthBulgeM(0, 20000), 0, 'Earth bulge at transmitter (s=0) must be 0');
  assert.equal(computeEarthBulgeM(20000, 20000), 0, 'Earth bulge at receiver (s=D) must be 0');

  // 4. Test computeFresnelRadiusM at 8.0 GHz
  // Lambda = ~0.03747 m (~0.0375 m)
  // At midpoint of 10 km: r_F1 = sqrt(lambda * s * (D - s) / D) = sqrt(0.037474 * 5000 * 5000 / 10000) = sqrt(93.685) ~= 9.68 m
  const f1Mid = computeFresnelRadiusM(5000, 10000);
  assert.ok(Math.abs(f1Mid - 9.68) < 0.1, `8 GHz F1 radius at midpoint of 10km must be ~9.68m (got ${f1Mid.toFixed(2)})`);

  // 5. Test computeP526DiffractionLossDb
  assert.equal(computeP526DiffractionLossDb(-1.0), 0, 'Clear line of sight (nu <= -0.7) must produce 0 dB diff loss');
  const grazingLoss = computeP526DiffractionLossDb(0.0);
  assert.ok(Math.abs(grazingLoss - 6.0) < 0.2, `Grazing diffraction loss (nu=0) must be ~6 dB (got ${grazingLoss.toFixed(2)})`);
  const deepLoss = computeP526DiffractionLossDb(1.0);
  assert.ok(Math.abs(deepLoss - 13.7) < 0.5, `Diffraction loss at nu=1 must be ~13.7 dB (got ${deepLoss.toFixed(2)})`);

  // 6. Test computeTransectRfMetrics with flat terrain
  const flatElevations = [3500, 3500, 3500, 3500, 3500];
  const flatRf = computeTransectRfMetrics(flatElevations, 10000, 10, 2);
  assert.ok(flatRf.minF1ClearanceM > 0, 'Clear flat link with 10m/2m masts must have positive F1 clearance');
  assert.ok(flatRf.estSnrDb > 0, 'Flat link must have positive SNR');
  assert.notEqual(flatRf.estModcod, 'OUTAGE', 'Flat 10km link must not be in outage');

  // Test with mountain ridge in the center
  const ridgeElevations = [3500, 3600, 3800, 3600, 3500];
  const blockedRf = computeTransectRfMetrics(ridgeElevations, 10000, 10, 2);
  assert.ok(blockedRf.minF1ClearanceM < 0, '300m ridge must intrude into F1 zone (negative clearance)');
  assert.ok(blockedRf.p526DiffractionLossDb > 10, '300m ridge must produce significant diffraction loss');

  // 7. Test evaluateVirtualTerminalLink
  const mockDem = (x: number, y: number) => 3500;
  const acnPos: [number, number, number] = [0, 0, 7500]; // 4000m AGL above 3500m MSL
  const linkClear = evaluateVirtualTerminalLink(5000, 0, 3500, 2.0, acnPos, mockDem);
  assert.ok(linkClear.isLos, 'Direct line of sight to ACN must be clear');
  assert.ok(linkClear.slantRangeKm > 5 && linkClear.slantRangeKm < 7, 'Slant range must be hypot(5000, 4000) ~ 6.4 km');
  assert.ok(linkClear.elevationDeg > 30 && linkClear.elevationDeg < 45, 'Elevation angle must be ~38 degrees');
  assert.ok(linkClear.sinrDb > 10, 'Clear terminal link must have high SNR');
  assert.notEqual(linkClear.modcod, 'OUTAGE', 'Clear terminal link must have valid MODCOD');

  console.log('  ✓ Transect mast inputs and RF readouts verified in DOM');
  console.log('  ✓ STK probe readouts and spawn button verified in DOM');
  console.log('  ✓ 4/3 Earth bulge formula verified (~5.89m at 20km midpoint)');
  console.log('  ✓ 8.0 GHz Fresnel radius formula verified (~9.68m at 10km midpoint)');
  console.log('  ✓ ITU-R P.526 knife-edge diffraction loss curve verified');
  console.log('  ✓ Virtual Terminal link evaluation (range, elevation, LoS, SNR, MODCOD) verified');
}

// =================================================================================================
// [TBU-T4] QGIS Region Summit Pinpointer, LoS % & Excalidraw Obstacle Authoring
// =================================================================================================
console.log('\n[TBU-T4] Verifying QGIS Region Summit Pinpointer, LoS % & Excalidraw Obstacle Authoring...');
{
  const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');

  // 1. DOM element presence in #tb-pane-region
  const regionDomIds = [
    'tb-region-summit',
    'tb-region-ruggedness',
    'tb-region-los-pct',
  ];
  for (const id of regionDomIds) {
    assert.ok(indexHtml.includes(`id="${id}"`), `index.html must define DOM element #${id}`);
  }

  // 2. DOM element presence in #tb-pane-obstacle
  const obsDomIds = [
    'tb-obs-shape-select',
    'tb-obs-material-select',
    'tb-obs-place-btn',
    'tb-obs-undo',
    'tb-obs-redo',
    'tb-obs-clear-btn',
    'tb-obs-list',
  ];
  for (const id of obsDomIds) {
    assert.ok(indexHtml.includes(`id="${id}"`), `index.html must define DOM element #${id}`);
  }

  // 3. Test computeZonalSummitAndRuggedness
  const mockDem = (x: number, y: number) => {
    // Peak at (2000, 3000) with height 4850m
    const distToPeak = Math.hypot(x - 2000, y - 3000);
    return Math.max(3000, 4850 - distToPeak * 0.5);
  };
  const bounds = { minX: 0, maxX: 4000, minY: 1000, maxY: 5000 };
  const acnPos: [number, number, number] = [2000, 3000, 8000];
  const zonal = computeZonalSummitAndRuggedness(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, mockDem, acnPos);

  assert.ok(Math.abs(zonal.summitElevationM - 4850) < 50, `Summit elevation must be close to 4850m (got ${zonal.summitElevationM.toFixed(1)}m)`);
  assert.ok(Math.abs(zonal.summitX - 2000) <= 200, 'Summit X coordinate must be near 2000');
  assert.ok(Math.abs(zonal.summitY - 3000) <= 200, 'Summit Y coordinate must be near 3000');
  assert.ok(zonal.terrainRuggednessIndexM > 0, 'Terrain Ruggedness Index must be positive in high relief');
  assert.ok(zonal.losCoveragePct >= 0 && zonal.losCoveragePct <= 100, 'LoS coverage % must be within [0, 100]');

  // 4. Test ObstacleHistoryManager (Undo/Redo stack)
  const initialObs: Obstacle[] = [
    { id: 'obs-1', shape: 'cuboid', xM: 100, yM: 100, widthM: 50, depthM: 50, heightM: 30, rotationDeg: 0 },
  ];
  const history = new ObstacleHistoryManager(initialObs);
  assert.equal(history.obstacles.length, 1);
  assert.equal(history.canUndo, false, 'Fresh history must not be able to undo');
  assert.equal(history.canRedo, false, 'Fresh history must not be able to redo');

  // Add an obstacle
  const state2: Obstacle[] = [
    ...initialObs,
    { id: 'obs-2', shape: 'cone', xM: 500, yM: 500, radiusM: 40, heightM: 60 },
  ];
  history.pushState(state2);
  assert.equal(history.obstacles.length, 2);
  assert.equal(history.canUndo, true, 'Can undo after pushState');
  assert.equal(history.canRedo, false, 'Cannot redo after pushState');

  // Undo
  const undone = history.undo();
  assert.ok(undone, 'Undo must return state');
  assert.equal(undone.length, 1);
  assert.equal(undone[0].id, 'obs-1');
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);

  // Redo
  const redone = history.redo();
  assert.ok(redone, 'Redo must return state');
  assert.equal(redone.length, 2);
  assert.equal(redone[1].id, 'obs-2');
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);

  // Verify presets and material profiles
  assert.ok(OBSTACLE_PRESETS.wall && OBSTACLE_PRESETS.block && OBSTACLE_PRESETS.peak, 'Must support wall, block, peak presets');
  assert.ok(MATERIAL_PROFILES.granite && MATERIAL_PROFILES.concrete && MATERIAL_PROFILES.foliage, 'Must support granite, concrete, foliage materials');

  // 5. Verify Specification Document & README Link
  const specPath = resolve(process.cwd(), 'docs/specs/SPEC-3D-MAPLIBRE-FIX-AND-TOOLBOX-DEEP-UPGRADE.md');
  assert.ok(existsSync(specPath), 'SPEC-3D-MAPLIBRE-FIX-AND-TOOLBOX-DEEP-UPGRADE.md must exist on disk');
  const readmeText = readFileSync(resolve(process.cwd(), 'README.md'), 'utf-8');
  assert.ok(readmeText.includes('SPEC-3D-MAPLIBRE-FIX-AND-TOOLBOX-DEEP-UPGRADE.md'), 'README.md must link to the new specification');

  console.log('  ✓ QGIS Region summit & ruggedness readouts verified in DOM');
  console.log('  ✓ Excalidraw obstacle authoring controls verified in DOM');
  console.log('  ✓ Zonal statistics & local summit pinpointer algorithms verified');
  console.log('  ✓ ObstacleHistoryManager Undo/Redo stack lifecycle verified');
  console.log('  ✓ Preset and material profile catalogs verified');
  console.log('  ✓ Specification document and README link verified');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL 4 TOOLBOX DEEP UPGRADE & 3D FIX SUITES (TBU-T1–T4) PASSED CLEANLY');
console.log('='.repeat(96));
