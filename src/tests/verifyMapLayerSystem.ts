/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Map Layer System, Contextual Focus, Zoom-LOD, RF Overlays & Renderer Safety Suite
 *
 * Verifies:
 * 1. All 17 telemetry-backed layers across 5 categories & default Operational preset.
 * 2. Group master toggles, `indeterminate` calculation, opacity clamping (15%–100%),
 *    presets (`Operational`, `RF Analysis`, `Minimal`, `All`), `resetDefaults()`, and storage round-trip.
 * 3. Read-time contextual focus (`selectedNodeId`, trajectory/obstacle editing) without mutating
 *    user preferences or breaking under 50 Hz telemetry cadences.
 * 4. 3 Zoom-LOD tiers (`> 90 km` distant, `35–90 km` medium, `< 35 km` close).
 * 5. `mapRfOverlay` null-safety (zero fabricated geometry for missing/invalid/incomplete profiles)
 *    plus authentic `0.6 F1` corridor, crest, obstacle hits, and lateral-scale disclaimer badge.
 * 6. `DataCommVisualizer` snapshot ingestion, dual-buffer promotion, and `onSteppedCycleComplete`
 *    invariance when `showVisualOverlay: false`.
 * 7. Three.js `TacticalEntityManager` `labelsVisible` latch surviving `updateLOD()` declutter pass
 *    and `applyLayerVisibility()` group visibility synchronization.
 * 8. Phase 0 DEM coverage badge & dimensionsTag de-confliction geometry (`badge.x >= 10`, `badge.y >= 10`).
 */

import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  MAP_LAYER_CATEGORIES,
  MAP_LAYER_DEFINITIONS,
  MAP_LAYER_STORAGE_KEY,
  MapLayerRegistry,
  type MapLayerId,
  type StorageLike,
  getMapZoomLodTier,
} from '../ui/workbench/mapLayerRegistry';
import {
  buildRfOverlayGeoJson,
  computeRfOverlayGeometry,
} from '../ui/workbench/mapRfOverlay';
import { buildLinkProfile, type LinkProfile } from '../core/linkProfile';
import { DataCommVisualizer, createSuperframeSnapshot } from '../ui/dataCommVisualization';
import { TacticalEntityManager } from '../ui/three/tacticalEntityManager';
import { computeDemBoundaryGeometry } from '../ui/terrainMapRenderer';
import { REAL_LADAKH_DEM_METADATA } from '../core/terrain';

function createMemoryStorage(seed?: Record<string, string>): StorageLike {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem(key: string): string | null {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      map.set(key, value);
    },
    removeItem(key: string): void {
      map.delete(key);
    },
  };
}

function createSpyCanvas2dContext(): { ctx: CanvasRenderingContext2D; drawCalls: number } {
  let drawCalls = 0;
  const noop = () => {};
  const countDraw = () => { drawCalls++; };
  const target: Record<string, unknown> = {
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px monospace',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    rect: noop,
    setLineDash: noop,
    fill: countDraw,
    stroke: countDraw,
    fillRect: countDraw,
    strokeRect: countDraw,
    fillText: countDraw,
    strokeText: countDraw,
    measureText: (t: string) => ({ width: String(t).length * 6 }),
  };
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop as string];
      return noop;
    },
  }) as unknown as CanvasRenderingContext2D;

  return {
    ctx,
    get drawCalls() {
      return drawCalls;
    },
  };
}

function runVerification(): void {
  console.log('================================================================================');
  console.log('  MAP LAYER SYSTEM & RENDERER INVARIANCE VERIFICATION');
  console.log('================================================================================');

  // --------------------------------------------------------------------------
  // 1. All 17 Layers & Default Operational Preset
  // --------------------------------------------------------------------------
  console.log('\n[1/8] Verifying 17 layers & default Operational preset...');
  assert.equal(MAP_LAYER_CATEGORIES.length, 5, 'Must define exactly 5 categories');
  assert.equal(MAP_LAYER_DEFINITIONS.length, 17, 'Must define exactly 17 map layers');

  const reg = new MapLayerRegistry(createMemoryStorage());
  assert.equal(reg.getTotalCount(), 17);
  assert.equal(reg.getActivePresetId(), 'operational');

  const expectedOffByDefault: readonly MapLayerId[] = [
    'base.contours',
    'base.demBoundary',
    'base.rangeGrid',
    'comm.coverage',
    'rf.losAnalysis',
    'rf.fresnelZone',
    'rf.obstructionPoints',
    'rf.signalQuality',
  ];
  for (const def of MAP_LAYER_DEFINITIONS) {
    const expectedOn = !expectedOffByDefault.includes(def.id);
    assert.equal(reg.isLayerVisible(def.id), expectedOn, `Layer ${def.id} default mismatch`);
  }
  assert.equal(reg.getEnabledCount(), 9, 'Operational default must enable 9 of 17 layers');

  const opacityCapable = MAP_LAYER_DEFINITIONS.filter((d) => d.supportsOpacity);
  assert.equal(opacityCapable.length, 5, 'Exactly 5 layers support user opacity sliders');
  assert.ok(Math.abs(reg.getLayerOpacity('base.terrainDem') - 0.90) < 1e-6);
  assert.ok(Math.abs(reg.getLayerOpacity('comm.links') - 0.85) < 1e-6);
  assert.ok(Math.abs(reg.getLayerOpacity('comm.transmissions') - 0.90) < 1e-6);
  assert.ok(Math.abs(reg.getLayerOpacity('comm.coverage') - 0.35) < 1e-6);
  assert.ok(Math.abs(reg.getLayerOpacity('rf.fresnelZone') - 0.45) < 1e-6);
  console.log('  -> PASS: All 17 layers and defaults verified.');

  // --------------------------------------------------------------------------
  // 2. Category Master Toggles, Indeterminate, Opacity Clamping & Persistence
  // --------------------------------------------------------------------------
  console.log('\n[2/8] Verifying group master toggles, clamping, presets & storage round-trip...');
  const baseState = reg.getCategoryState('base');
  assert.equal(baseState.checked, false);
  assert.equal(baseState.indeterminate, true, 'Base map should be indeterminate (1/4 ON)');
  assert.equal(baseState.enabledCount, 1);
  assert.equal(baseState.totalCount, 4);

  reg.setCategoryVisible('rf', true);
  const rfAllState = reg.getCategoryState('rf');
  assert.equal(rfAllState.checked, true);
  assert.equal(rfAllState.indeterminate, false);
  assert.equal(rfAllState.enabledCount, 4);

  reg.setCategoryVisible('rf', false);
  const rfNoneState = reg.getCategoryState('rf');
  assert.equal(rfNoneState.checked, false);
  assert.equal(rfNoneState.indeterminate, false);

  reg.setLayerOpacity('comm.coverage', 0.02);
  assert.ok(Math.abs(reg.getLayerOpacity('comm.coverage') - 0.15) < 1e-6, 'Opacity must clamp to >= 15%');
  reg.setLayerOpacity('comm.coverage', 2.5);
  assert.ok(Math.abs(reg.getLayerOpacity('comm.coverage') - 1.0) < 1e-6, 'Opacity must clamp to <= 100%');
  reg.setLayerOpacity('comm.coverage', Number.NaN);
  assert.ok(Math.abs(reg.getLayerOpacity('comm.coverage') - 1.0) < 1e-6, 'NaN opacity must be ignored');

  const store = createMemoryStorage();
  const persistedReg = new MapLayerRegistry(store);
  persistedReg.applyPreset('rf_analysis');
  assert.equal(persistedReg.getActivePresetId(), 'rf_analysis');
  assert.equal(persistedReg.isLayerVisible('rf.losAnalysis'), true);
  assert.equal(persistedReg.isLayerVisible('rf.fresnelZone'), true);
  assert.equal(persistedReg.isLayerVisible('rf.obstructionPoints'), true);
  persistedReg.setLayerOpacity('rf.fresnelZone', 0.72);
  persistedReg.setContextualFocusEnabled(false);

  const rehydrated = new MapLayerRegistry(store);
  assert.equal(rehydrated.getActivePresetId(), 'rf_analysis');
  assert.ok(Math.abs(rehydrated.getLayerOpacity('rf.fresnelZone') - 0.72) < 1e-6);
  assert.equal(rehydrated.isContextualFocusEnabled(), false);

  // Corrupt storage must fall back cleanly without throwing
  const corruptReg = new MapLayerRegistry(createMemoryStorage({ [MAP_LAYER_STORAGE_KEY]: '{not-valid-json' }));
  assert.equal(corruptReg.getActivePresetId(), 'operational');

  rehydrated.applyPreset('minimal');
  assert.equal(rehydrated.getActivePresetId(), 'minimal');
  assert.equal(rehydrated.getEnabledCount(), 4);

  rehydrated.applyPreset('all');
  assert.equal(rehydrated.getActivePresetId(), 'all');
  assert.equal(rehydrated.getEnabledCount(), 17);

  rehydrated.resetDefaults();
  assert.equal(rehydrated.getActivePresetId(), 'operational');
  assert.equal(rehydrated.getEnabledCount(), 9);
  assert.equal(rehydrated.isContextualFocusEnabled(), true);
  console.log('  -> PASS: Presets, indeterminate states, opacity clamping & storage round-trip verified.');

  // --------------------------------------------------------------------------
  // 3. Read-Time Contextual Focus & 50 Hz Preference Invariance
  // --------------------------------------------------------------------------
  console.log('\n[3/8] Verifying read-time contextual focus without mutating user preferences...');
  const focusStore = createMemoryStorage();
  const focusReg = new MapLayerRegistry(focusStore);
  focusReg.setLayerVisible('entities.trajectory', false);
  focusReg.setLayerVisible('entities.obstacles', false);
  const rawBeforeCtx = focusStore.getItem(MAP_LAYER_STORAGE_KEY);

  // Selected node context dims unrelated links (0.16) and non-selected markers (0.55)
  const selCtx = { selectedNodeId: 4, isTrajectoryEditing: false, isObstacleEditing: false, contextualFocusEnabled: true };
  assert.ok(Math.abs(focusReg.getEffectiveAlpha('comm.links', selCtx, 2) - 0.85 * 0.16) < 1e-6);
  assert.ok(focusReg.getEffectiveAlpha('comm.links', selCtx, 4) >= 0.95);
  assert.ok(Math.abs(focusReg.getEffectiveAlpha('entities.groundNodes', selCtx, 2) - 0.55) < 1e-6);
  assert.ok(Math.abs(focusReg.getEffectiveAlpha('entities.groundNodes', selCtx, 4) - 1.0) < 1e-6);

  // Edit mode temporarily reveals trajectory / obstacles and subdues links / transmissions (0.22)
  const editCtx = { selectedNodeId: 4, isTrajectoryEditing: true, isObstacleEditing: true, contextualFocusEnabled: true };
  assert.equal(focusReg.getEffectiveVisibility('entities.trajectory', editCtx), true);
  assert.equal(focusReg.getEffectiveVisibility('entities.obstacles', editCtx), true);
  assert.ok(Math.abs(focusReg.getEffectiveAlpha('comm.links', editCtx) - 0.85 * 0.22) < 1e-6);
  assert.ok(Math.abs(focusReg.getEffectiveAlpha('comm.transmissions', editCtx) - 0.90 * 0.22) < 1e-6);

  // Saved user state stays strictly untouched even across 250 simulated 50 Hz evaluations
  for (let frame = 0; frame < 250; frame++) {
    focusReg.getEffectiveVisibility('entities.trajectory', editCtx);
    focusReg.getEffectiveAlpha('comm.links', selCtx, frame % 16);
  }
  assert.equal(focusReg.isLayerVisible('entities.trajectory'), false, 'User trajectory preference must remain unmutated');
  assert.equal(focusReg.isLayerVisible('entities.obstacles'), false, 'User obstacle preference must remain unmutated');
  assert.equal(focusStore.getItem(MAP_LAYER_STORAGE_KEY), rawBeforeCtx, 'Persisted storage must never mutate on read');
  console.log('  -> PASS: Contextual focus and 50 Hz invariance verified.');

  // --------------------------------------------------------------------------
  // 4. Zoom-LOD Tiers (> 90 km, 35–90 km, < 35 km)
  // --------------------------------------------------------------------------
  console.log('\n[4/8] Verifying Zoom-LOD tier boundaries...');
  assert.equal(getMapZoomLodTier(200000), 'distant');
  assert.equal(getMapZoomLodTier(100000), 'distant');
  assert.equal(getMapZoomLodTier(90001), 'distant');
  assert.equal(getMapZoomLodTier(90000), 'medium');
  assert.equal(getMapZoomLodTier(60000), 'medium');
  assert.equal(getMapZoomLodTier(35000), 'medium');
  assert.equal(getMapZoomLodTier(34999), 'close');
  assert.equal(getMapZoomLodTier(30000), 'close');
  console.log('  -> PASS: All 3 Zoom-LOD tiers verified.');

  // --------------------------------------------------------------------------
  // 5. mapRfOverlay Null-Safety & Genuine 0.6 F1 Geometry
  // --------------------------------------------------------------------------
  console.log('\n[5/8] Verifying mapRfOverlay null-safety & authentic Fresnel geometry...');
  assert.equal(computeRfOverlayGeometry(null), null, 'Null profile must return null');
  assert.equal(computeRfOverlayGeometry(undefined), null, 'Undefined profile must return null');

  const validProfile = buildLinkProfile({
    selectedGroundNodeId: 4,
    nodeName: 'S4 Recon',
    frameIndex: 42,
    simulationTimeS: 0.84,
    groundNodePositionMslM: [-10000, -5000, 3400],
    acnPositionMslM: [10000, 5000, 6200],
    wavelengthM: 0.0315,
    effectiveEarthRadiusM: 8494666,
    fresnelFraction: 0.6,
    sampleCount: 33,
    obstruction: {
      isLos: false,
      minClearanceM: -38.5,
      fresnelRadiusM: 13.8,
      diffractionLossDb: 11.2,
      obstacleBlocked: true,
      isCoverageComplete: true,
      obstacleIntersections: [
        {
          obstacleId: 'obs_1',
          entryFraction: 0.35,
          exitFraction: 0.45,
          penetrationM: 22,
        },
      ],
    },
    getTerrainElevationMslM: (xM: number) => {
      // Ridge peak mid-span exceeding straight ray (~4800m MSL)
      const nearMid = Math.abs(xM) < 1500;
      return nearMid ? 4900 : 3200;
    },
    computeEarthBulgeM: () => 4.2,
  });

  const invalidProfile: LinkProfile = { ...validProfile, valid: false, samples: [] };
  const incompleteProfile: LinkProfile = { ...validProfile, isCoverageComplete: false };
  assert.equal(computeRfOverlayGeometry(invalidProfile), null, 'Invalid profile must emit zero geometry');
  assert.equal(computeRfOverlayGeometry(incompleteProfile), null, 'Incomplete coverage must emit zero geometry');
  assert.equal(computeRfOverlayGeometry(validProfile, { expectedNodeId: 9 }), null, 'Mismatched node must emit zero geometry');

  const rfOverlay = computeRfOverlayGeometry(validProfile, { expectedNodeId: 4 });
  assert.ok(rfOverlay !== null, 'Valid profile must build overlay geometry');
  assert.equal(rfOverlay.status, 'blocked');
  assert.ok(rfOverlay.badgeText.includes('EXAGGERATED LATERAL SCALE'), 'Must carry explicit lateral scale disclaimer');
  assert.match(rfOverlay.badgeText, /max r1 = \d+\.\d m/, 'Must display exact max r1 value');
  assert.equal(rfOverlay.obstacleSegments.length, 1);
  assert.ok(rfOverlay.crestPoint !== null);
  assert.ok(rfOverlay.crestPoint.clearanceM < 0, 'Ridge peak sample must report negative clearance');
  assert.ok(rfOverlay.polygonWorld.length >= 67, 'Polygon ring must cover closed left+right sample corridor');

  const rfGeoJson = buildRfOverlayGeoJson(
    rfOverlay,
    (xM, yM) => [76.5 + xM * 1e-5, 34.5 + yM * 1e-5],
    { showLos: true, showFresnel: true, showObstructions: true, fresnelOpacity: 0.45 }
  );
  assert.equal(rfGeoJson.features.length, 4, 'Must emit fresnel + los + crest + obstacle-hit GeoJSON features');
  assert.equal(buildRfOverlayGeoJson(null, (x, y) => [x, y], { showLos: true, showFresnel: true, showObstructions: true, fresnelOpacity: 0.45 }).features.length, 0);
  console.log(`  -> PASS: mapRfOverlay verified ('${rfOverlay.badgeText}').`);

  // --------------------------------------------------------------------------
  // 6. DataCommVisualizer Invariance When showVisualOverlay === false
  // --------------------------------------------------------------------------
  console.log('\n[6/8] Verifying DataCommVisualizer stepped completion invariance when overlay is hidden...');
  const spyCtx = createSpyCanvas2dContext();
  const visualizer = new DataCommVisualizer();
  let completedCalls = 0;
  visualizer.onSteppedCycleComplete = () => { completedCalls++; };

  const reqId = visualizer.requestStep();
  assert.ok(reqId !== null, 'requestStep must succeed');

  const snap1 = createSuperframeSnapshot({
    source: 'live',
    sessionId: visualizer.getSessionId(),
    frameIndex: 100,
    simulationTimeS: 2.0,
    schedulerMode: 'tac_tad',
    stepRequestId: reqId,
    allocations: [{ node_id: 4, start_ms: 4.5, duration_ms: 5.0, capacity_bits: 12000 }],
    nodes: [{
      nodeId: 4,
      screenX: 100,
      screenY: 100,
      isOperational: true,
      isBlocked: false,
      isObstacleBlocked: false,
      isOutage: false,
      isDegraded: false,
      linkStatus: 'CONNECTED',
      isSelected: true,
      isTransmitting: true,
      isWastingAirtime: false,
    }],
  });

  // First render consumes correlated stepped snapshot while drawing suppressed
  visualizer.render(spyCtx.ctx, {
    snapshot: snap1,
    acnScreenPos: { x: 200, y: 150 },
    nodeScreenPositions: { 4: { x: 100, y: 100 } },
    speed: 1.0,
    isPaused: false,
    showVisualOverlay: false,
    opacityMultiplier: 0.9,
  });
  // Advance past end of 1,000 ms visual cycle while showVisualOverlay stays false
  visualizer.advancePlayback(1200, 1.0, false);
  visualizer.render(spyCtx.ctx, {
    snapshot: snap1,
    acnScreenPos: { x: 200, y: 150 },
    nodeScreenPositions: { 4: { x: 100, y: 100 } },
    speed: 1.0,
    isPaused: false,
    showVisualOverlay: false,
  });

  assert.equal(spyCtx.drawCalls, 0, 'Hidden overlay must execute zero canvas draw calls');
  assert.equal(completedCalls, 1, 'Stepped completion callback MUST still fire when showVisualOverlay === false');
  console.log('  -> PASS: DataCommVisualizer ingestion & stepped callback invariance verified.');

  // --------------------------------------------------------------------------
  // 7. Three.js TacticalEntityManager labelsVisible Latch & applyLayerVisibility
  // --------------------------------------------------------------------------
  console.log('\n[7/8] Verifying Three.js labelsVisible latch & applyLayerVisibility()...');
  const manager = new TacticalEntityManager();
  manager.updateFromTelemetry({
    acn_telemetry: {
      pos_x: 0,
      pos_y: 0,
      altitude_msl_m: 5000,
      position_m: [0, 0, 5000],
      heading_rad: 0,
      flight_path: [[0, 0], [10000, 0], [0, 10000]],
    },
    nodes_telemetry: [0, 1, 2, 4].map((id) => ({
      node_id: id,
      name: id === 0 ? 'MCP' : `S${id}`,
      node_type: id === 0 ? 'mcp' : 'soldier',
      x_m: id * 4000,
      y_m: id * 1500,
      z_m: 3505,
      agl_m: 5,
      terrain_elevation_msl_m: 3500,
      is_coverage_complete: true,
      terrain_is_los: true,
      obstacle_blocked: false,
      link_outage: false,
      snr_db: 18,
    })),
  });
  manager.setSelectedNode(4);

  const camera = new THREE.PerspectiveCamera(50, 800 / 600, 10, 500000);
  camera.position.set(0, 45000, 100000);
  camera.lookAt(0, 3500, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  // Confirm labels turn ON during normal declutter
  manager.updateLOD(camera, 800, 600, null);
  assert.equal(manager.getNodeItem(4)?.callsignSprite.visible, true, 'Selected callsign sprite should show when labelsVisible is true');

  // Hide labels via applyLayerVisibility and run multiple updateLOD declutter passes
  manager.applyLayerVisibility({ labels: false, links: false, trajectory: false });
  manager.updateLOD(camera, 800, 600, null);
  manager.updateLOD(camera, 800, 600, null);

  assert.equal(manager.areLabelsVisible(), false);
  assert.equal(manager.getAcnCallsignSprite().visible, false, 'ACN callsign sprite must stay hidden across updateLOD()');
  for (let i = 0; i < 16; i++) {
    assert.equal(manager.getNodeItem(i)?.callsignSprite.visible, false, `Node ${i} label must stay hidden across updateLOD()`);
  }
  assert.equal(manager.linksGroup.visible, false);
  assert.equal(manager.trajectoryGroup.visible, false);

  // Re-enable labels and confirm declutter restores sprites
  manager.applyLayerVisibility({ labels: true, links: true, trajectory: true });
  manager.updateLOD(camera, 800, 600, null);
  assert.equal(manager.getNodeItem(4)?.callsignSprite.visible, true, 'Selected callsign sprite should re-appear when labels re-enabled');
  console.log('  -> PASS: Three.js labelsVisible latch & group visibility verified.');

  // --------------------------------------------------------------------------
  // 8. Phase 0 DEM Coverage Badge & dimensionsTag De-Confliction
  // --------------------------------------------------------------------------
  console.log('\n[8/8] Verifying Phase 0 DEM badge & dimensionsTag de-confliction...');
  const realBounds = {
    minX: -REAL_LADAKH_DEM_METADATA.halfWidthM,
    maxX: REAL_LADAKH_DEM_METADATA.halfWidthM,
    minY: -REAL_LADAKH_DEM_METADATA.halfHeightM,
    maxY: REAL_LADAKH_DEM_METADATA.halfHeightM,
    rasterWidth: 512,
    rasterHeight: 512,
    groundResolutionXM: REAL_LADAKH_DEM_METADATA.groundResolutionXM,
    groundResolutionYM: REAL_LADAKH_DEM_METADATA.groundResolutionYM,
    isValidCoverage: true,
    halfWidthM: REAL_LADAKH_DEM_METADATA.halfWidthM,
    halfHeightM: REAL_LADAKH_DEM_METADATA.halfHeightM,
    terrainMode: 'real' as const,
  };
  const screenBoundsTouchingEdges = {
    tl: { x: 0, y: 0 },
    br: { x: 890, y: 690 },
    width: 890,
    height: 690,
    aspectRatio: 1.2,
    isRealMode: true,
    isValidCoverage: true,
  };
  const wideGeom = computeDemBoundaryGeometry(screenBoundsTouchingEdges, 900, 700, realBounds);
  assert.ok(wideGeom !== null);
  assert.ok(wideGeom.badge.x >= 166, `Wide canvas DEM badge X (${wideGeom.badge.x}) must clear toolbox`);
  assert.ok(wideGeom.badge.y >= 10);
  assert.ok(wideGeom.dimensionsTag !== undefined);
  assert.ok(
    wideGeom.dimensionsTag.y + wideGeom.dimensionsTag.h <= 700 - 48 + 0.01,
    `dimensionsTag bottom (${wideGeom.dimensionsTag.y + wideGeom.dimensionsTag.h}) must clear bottom-right #map-layers-btn`
  );

  const narrowGeom = computeDemBoundaryGeometry(screenBoundsTouchingEdges, 380, 480, realBounds);
  assert.ok(narrowGeom !== null);
  assert.ok(narrowGeom.badge.y >= 74, `Narrow canvas DEM badge Y (${narrowGeom.badge.y}) must fall back below 74`);
  assert.ok(narrowGeom.badge.x >= 10 && narrowGeom.badge.y >= 10);
  console.log('  -> PASS: DEM badge & dimensionsTag de-confliction verified.');

  console.log('\n================================================================================');
  console.log('  ALL 8 MAP LAYER SYSTEM VERIFICATION CHECKS PASSED!');
  console.log('================================================================================');
}

runVerification();
