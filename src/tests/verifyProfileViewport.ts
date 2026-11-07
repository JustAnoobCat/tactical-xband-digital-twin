/**
 * Milestone 3B.2C — Zoomable Canvas Link Profile Verification Suite
 *
 * Validates:
 *  1. Reset-to-fit and viewport bounds calculation from profile geometry.
 *  2. Bounded horizontal and vertical zoom (zoom factor, min/max span clamps).
 *  3. Pan transformations and domain clamping.
 *  4. Pointer-centered zoom (spatial invariance of coordinates under pointer).
 *  5. Degenerate and invalid profile extents (0-distance, empty/invalid samples).
 *  6. Coordinate transformations and roundtrip mapping (world <-> canvas).
 *  7. Distinct terrain LOS and obstacle-blockage indicators in status summary.
 *  8. Obstacle marker intervals and stable ID preservation.
 *  9. Interaction isolation (no leakage to trajectory, obstacles, or sim state).
 * 10. Compatibility with 3B.2B node selection and profile refresh.
 */

import assert from 'node:assert/strict';
import {
  calcNiceStep,
  LinkProfileViewportState,
  summarizeProfileStatus,
  VIEWPORT_LIMITS,
  type ViewportLayout,
} from '../ui/linkProfileViewport';
import { buildLinkProfile, type LinkProfile } from '../core/linkProfile';
import { TerrainEngine } from '../core/terrain';
import { TrajectoryEditorState } from '../ui/trajectoryEditorState';
import { ObstacleEditorState } from '../ui/obstacleEditorState';

const layout: ViewportLayout = {
  width: 800,
  height: 320,
  padL: 60,
  padR: 24,
  padT: 28,
  padB: 34,
};

const mockObstruction = {
  minClearanceM: 35.0,
  fresnelRadiusM: 12.0,
  diffractionLossDb: 0.0,
  isLos: true,
  obstacleBlocked: false,
  obstacleIntersections: [],
};

const profileA = buildLinkProfile({
  selectedGroundNodeId: 4,
  nodeName: 'S4',
  frameIndex: 10,
  simulationTimeS: 0.2,
  groundNodePositionMslM: [0, 0, 1000],
  acnPositionMslM: [30000, 40000, 5000],
  wavelengthM: 0.03,
  effectiveEarthRadiusM: 8500000,
  fresnelFraction: 0.6,
  sampleCount: 16,
  obstruction: mockObstruction,
  getTerrainElevationMslM: () => 1200,
  computeEarthBulgeM: TerrainEngine.computeEarthBulge,
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Reset-to-fit and viewport bounds from profile geometry
// ─────────────────────────────────────────────────────────────────────────────
{
  const vp = new LinkProfileViewportState();
  assert.equal(vp.isUserModified, false);

  const synced = vp.syncProfile(profileA);
  assert.equal(synced, true);
  assert.equal(vp.isUserModified, false);

  const bounds = vp.bounds;
  assert.equal(bounds.minDKm, 0, 'fit starts at terminal d = 0');
  assert.equal(bounds.maxDKm, 50, 'fit ends at 50 km (hypot(30, 40))');
  assert.ok(bounds.minAltM <= 1000, 'min altitude encloses ground terminal');
  assert.ok(bounds.maxAltM >= 5000, 'max altitude encloses ACN');
  assert.equal(vp.zoomFactor, 1.0, 'initial zoom factor is 1.0x');

  console.log('PASS Test 1 — Reset-to-fit and viewport bounds calculation');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Bounded horizontal and vertical zoom
// ─────────────────────────────────────────────────────────────────────────────
{
  const vp = new LinkProfileViewportState();
  vp.syncProfile(profileA);
  const initialSpanD = vp.bounds.maxDKm - vp.bounds.minDKm;
  const initialSpanAlt = vp.bounds.maxAltM - vp.bounds.minAltM;

  // Zoom in by 2x
  vp.zoom(2.0);
  assert.equal(vp.isUserModified, true);
  const spanD2 = vp.bounds.maxDKm - vp.bounds.minDKm;
  const spanAlt2 = vp.bounds.maxAltM - vp.bounds.minAltM;
  assert.ok(Math.abs(spanD2 - initialSpanD / 2) < 0.001, 'horizontal span halved on 2x zoom');
  assert.ok(Math.abs(spanAlt2 - initialSpanAlt / 2) < 0.001, 'vertical span halved on 2x zoom');
  assert.equal(vp.zoomFactor, 2.0);

  // Zoom in excessively — must clamp to MIN_SPAN_D_KM
  for (let i = 0; i < 20; i++) vp.zoom(2.0);
  const clampedSpanD = vp.bounds.maxDKm - vp.bounds.minDKm;
  assert.ok(clampedSpanD >= VIEWPORT_LIMITS.MIN_SPAN_D_KM, 'zoom in respects minimum span');
  assert.ok(vp.bounds.maxAltM - vp.bounds.minAltM >= VIEWPORT_LIMITS.MIN_SPAN_ALT_M, 'zoom in respects min alt span');

  // Zoom out excessively — must clamp to MAX_SPAN_D_KM
  for (let i = 0; i < 40; i++) vp.zoom(0.5);
  const maxSpanD = vp.bounds.maxDKm - vp.bounds.minDKm;
  assert.ok(maxSpanD <= VIEWPORT_LIMITS.MAX_SPAN_D_KM, 'zoom out respects maximum span');

  // Reset restores initial fit
  vp.resetFit();
  assert.equal(vp.isUserModified, false);
  assert.equal(vp.zoomFactor, 1.0);
  assert.equal(vp.bounds.minDKm, 0);
  assert.equal(vp.bounds.maxDKm, 50);

  console.log('PASS Test 2 — Bounded zoom and span limits');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Pan transformations and domain clamping
// ─────────────────────────────────────────────────────────────────────────────
{
  const vp = new LinkProfileViewportState();
  vp.syncProfile(profileA);

  const initialBounds = vp.bounds;
  const plotW = layout.width - layout.padL - layout.padR;
  const plotH = layout.height - layout.padT - layout.padB;

  // Drag right by 50% of plot width -> should pan view left by 50% of span
  vp.pan(plotW / 2, 0, layout);
  assert.equal(vp.isUserModified, true);
  assert.ok(Math.abs(vp.bounds.minDKm - (initialBounds.minDKm - 25)) < 0.001);
  assert.ok(Math.abs(vp.bounds.maxDKm - (initialBounds.maxDKm - 25)) < 0.001);

  // Drag vertically
  vp.pan(0, plotH / 2, layout);
  assert.ok(vp.bounds.minAltM > initialBounds.minAltM, 'dragging down pans view up');

  // Pan excessively — must clamp within global domain limits
  vp.pan(-100000, 0, layout);
  assert.ok(vp.bounds.maxDKm <= VIEWPORT_LIMITS.MAX_DOMAIN_D_KM, 'pan right respects domain max');
  vp.pan(200000, 0, layout);
  assert.ok(vp.bounds.minDKm >= VIEWPORT_LIMITS.MIN_DOMAIN_D_KM, 'pan left respects domain min');

  console.log('PASS Test 3 — Pan transformations and domain clamping');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Pointer-centered zoom
// ─────────────────────────────────────────────────────────────────────────────
{
  const vp = new LinkProfileViewportState();
  vp.syncProfile(profileA);

  // Point at 30% width, 40% height of plot area
  const px = layout.padL + 0.3 * (layout.width - layout.padL - layout.padR);
  const py = layout.padT + 0.4 * (layout.height - layout.padT - layout.padB);

  const worldXBefore = vp.canvasToX(px, layout);
  const worldYBefore = vp.canvasToY(py, layout);

  // Zoom in centered at (px, py)
  vp.zoomAt(1.5, px, py, layout);

  const worldXAfter = vp.canvasToX(px, layout);
  const worldYAfter = vp.canvasToY(py, layout);

  assert.ok(Math.abs(worldXBefore - worldXAfter) < 1e-4, 'world X under pointer remains invariant');
  assert.ok(Math.abs(worldYBefore - worldYAfter) < 1e-4, 'world Y under pointer remains invariant');

  console.log('PASS Test 4 — Pointer-centered zoom spatial invariance');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Degenerate and invalid profile extents
// ─────────────────────────────────────────────────────────────────────────────
{
  const vp = new LinkProfileViewportState();

  // Null profile
  assert.equal(vp.syncProfile(null), false);
  assert.equal(vp.bounds.maxDKm > vp.bounds.minDKm, true);

  // Degenerate 0-distance profile
  const coincidentProfile = buildLinkProfile({
    selectedGroundNodeId: 4, nodeName: 'S4', frameIndex: 0, simulationTimeS: 0,
    groundNodePositionMslM: [1000, 2000, 300], acnPositionMslM: [1000, 2000, 300],
    wavelengthM: 0.03, effectiveEarthRadiusM: 8500000, sampleCount: 3,
    obstruction: mockObstruction,
    getTerrainElevationMslM: () => 300, computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });
  vp.syncProfile(coincidentProfile);
  assert.ok(vp.bounds.maxDKm > vp.bounds.minDKm, '0-distance link has finite non-zero distance span');
  assert.ok(vp.bounds.maxAltM > vp.bounds.minAltM, 'flat elevation has finite non-zero elevation span');
  assert.ok(Number.isFinite(vp.bounds.minDKm) && Number.isFinite(vp.bounds.maxDKm));
  assert.ok(Number.isFinite(vp.bounds.minAltM) && Number.isFinite(vp.bounds.maxAltM));

  // Invalid profile
  const invalidProfile = buildLinkProfile({
    selectedGroundNodeId: 4, nodeName: 'S4', frameIndex: 0, simulationTimeS: 0,
    groundNodePositionMslM: [0, 0, 0], acnPositionMslM: [100, 0, 0],
    wavelengthM: Number.NaN, effectiveEarthRadiusM: 8500000, sampleCount: 3,
    obstruction: mockObstruction, getTerrainElevationMslM: () => 0, computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });
  assert.equal(vp.syncProfile(invalidProfile), false, 'invalid profile rejected without corrupting state');

  console.log('PASS Test 5 — Degenerate and invalid profile safe handling');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — Coordinate transformations and roundtrip mapping
// ─────────────────────────────────────────────────────────────────────────────
{
  const vp = new LinkProfileViewportState();
  vp.syncProfile(profileA);

  const testDistances = [0, 10, 25, 45, 50];
  const testElevations = [1000, 1500, 3200, 5000];

  for (const d of testDistances) {
    const px = vp.xToCanvas(d, layout);
    const roundtripD = vp.canvasToX(px, layout);
    assert.ok(Math.abs(d - roundtripD) < 1e-6, `xToCanvas/canvasToX roundtrip at d=${d} km`);
  }

  for (const alt of testElevations) {
    const py = vp.yToCanvas(alt, layout);
    const roundtripAlt = vp.canvasToY(py, layout);
    assert.ok(Math.abs(alt - roundtripAlt) < 1e-6, `yToCanvas/canvasToY roundtrip at alt=${alt} m`);
  }

  // Nice step calculations
  assert.equal(calcNiceStep(50, 5), 10);
  assert.equal(calcNiceStep(4500, 5), 1000);
  assert.equal(calcNiceStep(0.2, 4), 0.05);

  console.log('PASS Test 6 — Coordinate transformations and roundtrip mapping');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — Distinct terrain LOS and obstacle blockage indicators
// ─────────────────────────────────────────────────────────────────────────────
{
  // Case A: Pristine LOS and Clear Obstacles
  const sA = summarizeProfileStatus(profileA);
  assert.equal(sA.terrainIsLos, true);
  assert.equal(sA.obstacleBlocked, false);
  assert.match(sA.terrainStatusText, /PRISTINE LINE-OF-SIGHT/);
  assert.equal(sA.terrainBadgeClass, 'kpi-badge badge-emerald');
  assert.equal(sA.obstacleStatusText, 'OBSTACLES: CLEAR');
  assert.equal(sA.obstacleBadgeClass, 'kpi-badge badge-emerald');

  // Case B: Obstacle Blocked, but Terrain is clear LOS
  const profileObsBlocked = buildLinkProfile({
    ...profileA,
    selectedGroundNodeId: 4, nodeName: 'S4', frameIndex: 10, simulationTimeS: 0.2,
    groundNodePositionMslM: [0, 0, 1000], acnPositionMslM: [30000, 40000, 5000],
    wavelengthM: 0.03, effectiveEarthRadiusM: 8500000, sampleCount: 16,
    obstruction: {
      ...mockObstruction,
      obstacleBlocked: true,
      obstacleIntersections: [{ obstacleId: 'tower-alpha', entryFraction: 0.4, exitFraction: 0.45, penetrationM: 5.2 }],
    },
    getTerrainElevationMslM: () => 1200, computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });
  const sB = summarizeProfileStatus(profileObsBlocked);
  assert.equal(sB.terrainIsLos, true, 'terrain LOS remains pristine');
  assert.equal(sB.obstacleBlocked, true, 'obstacle blocked is true');
  assert.equal(sB.primaryBlockedObstacleId, 'tower-alpha');
  assert.match(sB.terrainStatusText, /PRISTINE LINE-OF-SIGHT/);
  assert.equal(sB.terrainBadgeClass, 'kpi-badge badge-emerald', 'terrain badge stays green');
  assert.match(sB.obstacleStatusText, /OBSTACLE: BLOCKED \[tower-alpha\]/);
  assert.equal(sB.obstacleBadgeClass, 'kpi-badge badge-crimson', 'obstacle badge is red');

  // Case C: Terrain Occlusion (Diffraction Outage), Obstacles Clear
  const profileTerrainBlocked = buildLinkProfile({
    ...profileA,
    selectedGroundNodeId: 4, nodeName: 'S4', frameIndex: 10, simulationTimeS: 0.2,
    groundNodePositionMslM: [0, 0, 1000], acnPositionMslM: [30000, 40000, 5000],
    wavelengthM: 0.03, effectiveEarthRadiusM: 8500000, sampleCount: 16,
    obstruction: {
      ...mockObstruction,
      isLos: false,
      minClearanceM: -45.0,
      diffractionLossDb: 38.5,
      obstacleBlocked: false,
      obstacleIntersections: [],
    },
    getTerrainElevationMslM: () => 3500, computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });
  const sC = summarizeProfileStatus(profileTerrainBlocked);
  assert.equal(sC.terrainIsLos, false);
  assert.equal(sC.obstacleBlocked, false);
  assert.match(sC.terrainStatusText, /TERRAIN OCCLUSION \(38\.5 dB OUTAGE\)/);
  assert.equal(sC.terrainBadgeClass, 'kpi-badge badge-crimson');
  assert.equal(sC.obstacleStatusText, 'OBSTACLES: CLEAR');
  assert.equal(sC.obstacleBadgeClass, 'kpi-badge badge-emerald');

  console.log('PASS Test 7 — Distinct terrain LOS and obstacle blockage indicators');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Obstacle marker positions and stable IDs
// ─────────────────────────────────────────────────────────────────────────────
{
  const profileWithObstacle = buildLinkProfile({
    ...profileA,
    selectedGroundNodeId: 4, nodeName: 'S4', frameIndex: 10, simulationTimeS: 0.2,
    groundNodePositionMslM: [0, 0, 1000], acnPositionMslM: [30000, 40000, 5000],
    wavelengthM: 0.03, effectiveEarthRadiusM: 8500000, sampleCount: 16,
    obstruction: {
      ...mockObstruction,
      obstacleBlocked: true,
      obstacleIntersections: [
        { obstacleId: 'bunker-99', entryFraction: 0.2, exitFraction: 0.25, penetrationM: 8.0 },
      ],
    },
    getTerrainElevationMslM: () => 1200, computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });

  assert.equal(profileWithObstacle.obstacleIntervals.length, 1);
  const interval = profileWithObstacle.obstacleIntervals[0];
  assert.equal(interval.obstacleId, 'bunker-99');
  assert.equal(interval.entryHorizontalDistanceM, 0.2 * 50000);
  assert.equal(interval.exitHorizontalDistanceM, 0.25 * 50000);

  const vp = new LinkProfileViewportState();
  vp.syncProfile(profileWithObstacle);

  const xEntryPx = vp.xToCanvas(interval.entryHorizontalDistanceM / 1000, layout);
  const xExitPx = vp.xToCanvas(interval.exitHorizontalDistanceM / 1000, layout);
  assert.ok(xExitPx > xEntryPx, 'exit is right of entry');
  assert.ok(xEntryPx >= layout.padL, 'marker is inside plot area');
  assert.ok(xExitPx <= layout.width - layout.padR);

  console.log('PASS Test 8 — Obstacle marker positions and stable ID mapping');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — Interaction isolation (no leakage to trajectory, obstacles, or sim state)
// ─────────────────────────────────────────────────────────────────────────────
{
  const trajEditor = new TrajectoryEditorState();
  const obsEditor = new ObstacleEditorState();
  const vp = new LinkProfileViewportState();
  vp.syncProfile(profileA);

  const trajBefore = JSON.stringify(trajEditor.preview);
  const obsBefore = JSON.stringify(obsEditor.draft);

  // Zoom and pan profile viewport extensively
  vp.zoom(2.5, 0.3, 0.4);
  vp.pan(120, -80, layout);
  vp.zoom(0.5);
  vp.resetFit();

  assert.equal(JSON.stringify(trajEditor.preview), trajBefore, 'trajectory editor state unchanged by profile viewport');
  assert.equal(JSON.stringify(obsEditor.draft), obsBefore, 'obstacle editor state unchanged by profile viewport');

  console.log('PASS Test 9 — Viewport interaction isolation');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 10 — Compatibility with 3B.2B node selection and profile refresh
// ─────────────────────────────────────────────────────────────────────────────
{
  const vp = new LinkProfileViewportState();
  vp.syncProfile(profileA);
  assert.equal(vp.bounds.maxDKm, 50);

  // User zooms in on Node 4
  vp.zoom(2.0);
  assert.equal(vp.isUserModified, true);
  assert.equal(vp.zoomFactor, 2.0);

  // Case 1: Same node receives refreshed profile (e.g. from 3B.2B obstacle or periodic refresh)
  const profileARefreshed = { ...profileA, frameIndex: 11, simulationTimeS: 0.22 };
  vp.syncProfile(profileARefreshed);
  assert.equal(vp.zoomFactor, 2.0, 'user zoom preserved across same-node profile refresh');
  assert.equal(vp.isUserModified, true);

  // Case 2: User switches to a different ground node (e.g. Node 2 at 20 km distance)
  const profileNode2 = buildLinkProfile({
    selectedGroundNodeId: 2, nodeName: 'S2', frameIndex: 12, simulationTimeS: 0.24,
    groundNodePositionMslM: [12000, 16000, 800], acnPositionMslM: [0, 0, 5000],
    wavelengthM: 0.03, effectiveEarthRadiusM: 8500000, sampleCount: 16,
    obstruction: mockObstruction, getTerrainElevationMslM: () => 800, computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });
  const switched = vp.syncProfile(profileNode2);
  assert.equal(switched, true, 'switching node resets fit');
  assert.equal(vp.bounds.maxDKm, 20, 'bounds adapted to Node 2 path (20 km)');
  assert.equal(vp.zoomFactor, 1.0, 'zoom reset to fit for new node selection');
  assert.equal(vp.isUserModified, false);

  console.log('PASS Test 10 — Compatibility with 3B.2B node selection and profile refreshes');
}

console.log('PASS All Milestone 3B.2C link-profile viewport tests passed successfully.');

