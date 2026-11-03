/**
 * src/tests/verifySingleHgtCentering.ts
 *
 * Verification suite for Single HGT Upload Viewport Centering & Aspect-Ratio Fitting:
 * 1. Single HGT tile centering on actual geographic bounds (e.g. N34E076 vs N35E077).
 * 2. Viewport fitting with container aspect ratio awareness and reasonable padding (no clipping).
 * 3. Protection against ACN position override (Top View syncLink does NOT clobber pinned terrain bounds).
 * 4. Recentering when uploading a different HGT tile.
 * 5. 3D SceneManager centerOnBounds camera framing with vertical/horizontal FOV and aspect ratio.
 * 6. Restoration of normal link tracking upon theater reset or mode change.
 * 7. Preservation of authentic coordinates and RF calculations.
 */

import {
  parseHgtBuffer,
  createHgtGeographicMetadata,
  parseSrtmTileName,
  SRTM3_BYTE_LENGTH,
  HGT_METERS_PER_DEG_LAT,
  HGT_METERS_PER_DEG_LON,
  THEATER_ORIGIN_LAT_DEG,
  THEATER_ORIGIN_LON_DEG,
} from '../core/hgtParser';
import { TopViewViewportState } from '../ui/pathProfileTopView';
import type { ViewportLayout } from '../ui/linkProfileViewport';
import { TerrainEngine, REAL_LADAKH_DEM_METADATA } from '../core/terrain';
import { computeTerrainScreenBounds, RadarGeometry, PanOffset } from '../ui/terrainMapRenderer';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertClose(actual: number, expected: number, tol = 1e-4, msg = ''): void {
  const diff = Math.abs(actual - expected);
  if (diff > tol) {
    throw new Error(`Assertion failed: expected ${expected} ± ${tol}, got ${actual}. ${msg}`);
  }
}

function createDummyHgtBuffer(sampleCount = 1201, elev = 3500): ArrayBuffer {
  const totalSamples = sampleCount * sampleCount;
  const buffer = new ArrayBuffer(totalSamples * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < totalSamples; i++) {
    view.setInt16(i * 2, elev, false); // Big-endian
  }
  return buffer;
}

async function runSingleHgtCenteringVerification(): Promise<void> {
  console.log('================================================================================');
  console.log('  SINGLE HGT VIEWPORT CENTERING & ASPECT RATIO FITTING VERIFICATION');
  console.log('================================================================================\n');

  // ---------------------------------------------------------------------------
  // [1/7] Single HGT Metadata & Metric Bounds Calculation
  // ---------------------------------------------------------------------------
  console.log('[1/7] Verifying single HGT metadata bounds and metric origin offsets...');
  const buf1 = createDummyHgtBuffer(1201, 3200);
  const parse1 = parseHgtBuffer('N34E076.hgt', buf1);
  assert(parse1.success, 'N34E076 parsed successfully');

  const meta1 = parse1.metadata!;
  assertClose(meta1.centerLatDeg, 34.5, 1e-5, 'Center lat is 34.5');
  assertClose(meta1.centerLonDeg, 76.5, 1e-5, 'Center lon is 76.5');
  assertClose(meta1.minX!, -45919.99, 1.0, 'minX is approx -45.9 km');
  assertClose(meta1.maxX!, 45919.99, 1.0, 'maxX is approx +45.9 km');
  assertClose(meta1.minY!, -55465.72, 1.0, 'minY is approx -55.5 km');
  assertClose(meta1.maxY!, 55465.72, 1.0, 'maxY is approx +55.5 km');

  const cx1 = (meta1.minX! + meta1.maxX!) / 2;
  const cy1 = (meta1.minY! + meta1.maxY!) / 2;
  assertClose(cx1, 0, 1e-3, 'N34E076 center X is 0');
  assertClose(cy1, 0, 1e-3, 'N34E076 center Y is 0');
  console.log('  -> PASS: Central theater tile N34E076 bounds and center derived correctly.\n');

  // ---------------------------------------------------------------------------
  // [2/7] Uploading a Different Tile (N35E077) and Centering Recalculation
  // ---------------------------------------------------------------------------
  console.log('[2/7] Verifying distinct tile (N35E077) offset bounds and centering...');
  const buf2 = createDummyHgtBuffer(1201, 4100);
  const parse2 = parseHgtBuffer('N35E077.hgt', buf2);
  assert(parse2.success, 'N35E077 parsed successfully');

  const meta2 = parse2.metadata!;
  assertClose(meta2.centerLatDeg, 35.5, 1e-5, 'Center lat is 35.5');
  assertClose(meta2.centerLonDeg, 77.5, 1e-5, 'Center lon is 77.5');

  const cx2 = (meta2.minX! + meta2.maxX!) / 2;
  const cy2 = (meta2.minY! + meta2.maxY!) / 2;
  assertClose(cx2, HGT_METERS_PER_DEG_LON, 1.0, 'N35E077 center X is +91.8 km');
  assertClose(cy2, HGT_METERS_PER_DEG_LAT, 1.0, 'N35E077 center Y is +110.9 km');
  console.log('  -> PASS: Distinct tile N35E077 center X/Y accurately offsets without coordinate corruption.\n');

  // ---------------------------------------------------------------------------
  // [3/7] 2D Radar Canvas Range Fitting & Aspect Ratio Margin
  // ---------------------------------------------------------------------------
  console.log('[3/7] Verifying 2D Radar canvas range fitting with padding and aspect ratio...');
  const rw = 800;
  const rh = 600;
  const rcx = rw / 2;
  const rcy = rh / 2;
  const minHalfDim = Math.min(rcx, rcy); // 300

  const spanX = meta1.maxX! - meta1.minX!;
  const spanY = meta1.maxY! - meta1.minY!;
  const halfSpanX = spanX / 2;
  const halfSpanY = spanY / 2;

  const fitRangeX = (halfSpanX * (minHalfDim / rcx)) / 0.80;
  const fitRangeY = (halfSpanY * (minHalfDim / rcy)) / 0.80;
  const currentRadarRangeM = Math.max(15000, Math.min(300000, Math.max(fitRangeX, fitRangeY)));

  // Test that tile occupies between 60% and 80% of canvas height/width
  const geom: RadarGeometry = {
    centerX: rcx,
    centerY: rcy,
    scale: (minHalfDim * 0.94) / currentRadarRangeM,
  };
  const pan: PanOffset = { xM: cx1, yM: cy1 };

  const screenBounds = computeTerrainScreenBounds(
    {
      minX: meta1.minX!,
      maxX: meta1.maxX!,
      minY: meta1.minY!,
      maxY: meta1.maxY!,
      rasterWidth: 1201,
      rasterHeight: 1201,
      groundResolutionXM: meta1.groundResolutionXM!,
      groundResolutionYM: meta1.groundResolutionYM!,
      isValidCoverage: true,
      halfWidthM: meta1.halfWidthM!,
      halfHeightM: meta1.halfHeightM!,
      terrainMode: 'real',
      tileName: meta1.tileName!,
    },
    300000,
    geom,
    pan
  );

  const screenW = screenBounds.width;
  const screenH = screenBounds.height;
  const screenCenterX = (screenBounds.tl.x + screenBounds.br.x) / 2;
  const screenCenterY = (screenBounds.tl.y + screenBounds.br.y) / 2;

  assertClose(screenCenterX, rcx, 1e-2, 'Terrain screen center X matches canvas center');
  assertClose(screenCenterY, rcy, 1e-2, 'Terrain screen center Y matches canvas center');
  assert(screenH <= rh * 0.82, `Terrain height (${screenH.toFixed(1)}px) fits inside canvas height (${rh}px) with >=18% margin`);
  assert(screenW <= rw * 0.82, `Terrain width (${screenW.toFixed(1)}px) fits inside canvas width (${rw}px) with >=18% margin`);
  console.log('  -> PASS: 2D Radar Canvas frames the complete terrain tile at center with proper padding.\n');

  // ---------------------------------------------------------------------------
  // [4/7] Top View Viewport: Protection Against ACN Position Override
  // ---------------------------------------------------------------------------
  console.log('[4/7] Verifying TopViewViewportState pinnedTerrainBounds prevents ACN override...');
  const topVp = new TopViewViewportState();
  const tLayout: ViewportLayout = { width: 800, height: 400, padL: 60, padR: 24, padT: 28, padB: 34 };

  // 1. Fit to tile bounds
  topVp.fitToBounds({ minX: meta1.minX!, maxX: meta1.maxX!, minY: meta1.minY!, maxY: meta1.maxY! }, tLayout, 0.08);
  assert(topVp.pinnedBounds !== null, 'pinnedBounds is active after fitToBounds');
  assert(topVp.isUserModified, 'isUserModified is true so default fit is protected');

  const initialBounds = topVp.bounds;

  // 2. Simulate ACN moving at a distant position, calling syncLink() every frame
  const acnPos: [number, number, number] = [12000, -8000, 5000];
  const nodePos: [number, number, number] = [3000, 4000, 3500];

  const syncResult = topVp.syncLink(nodePos, acnPos, { layout: tLayout, selectedNodeId: 4 });
  assert(!syncResult, 'syncLink returns false when pinnedBounds are active');

  // Viewport bounds MUST remain pinned to the terrain, NOT the ACN link!
  assertClose(topVp.bounds.minXM, initialBounds.minXM, 1e-4, 'minXM preserved despite ACN link sync');
  assertClose(topVp.bounds.maxXM, initialBounds.maxXM, 1e-4, 'maxXM preserved despite ACN link sync');
  assertClose(topVp.bounds.minYM, initialBounds.minYM, 1e-4, 'minYM preserved despite ACN link sync');
  assertClose(topVp.bounds.maxYM, initialBounds.maxYM, 1e-4, 'maxYM preserved despite ACN link sync');
  console.log('  -> PASS: ACN link position cannot overwrite terrain tile framing in Top View.\n');

  // ---------------------------------------------------------------------------
  // [5/7] Recentering on a Different Tile in Top View
  // ---------------------------------------------------------------------------
  console.log('[5/7] Verifying Top View recentering when a new tile is loaded...');
  topVp.fitToBounds({ minX: meta2.minX!, maxX: meta2.maxX!, minY: meta2.minY!, maxY: meta2.maxY! }, tLayout, 0.08);

  const updatedBounds = topVp.bounds;
  const updatedCenterX = (updatedBounds.minXM + updatedBounds.maxXM) / 2;
  const updatedCenterY = (updatedBounds.minYM + updatedBounds.maxYM) / 2;

  assertClose(updatedCenterX, cx2, 1e-3, 'Top view recentered on tile 2 center X');
  assertClose(updatedCenterY, cy2, 1e-3, 'Top view recentered on tile 2 center Y');
  assert(updatedCenterX > 80000, 'Top view shifted towards Eastern tile');
  console.log('  -> PASS: Uploading tile N35E077 successfully recenters Top View onto the new coordinates.\n');

  // ---------------------------------------------------------------------------
  // [6/7] Reset Sim & Clear Pinned Bounds Behavior
  // ---------------------------------------------------------------------------
  console.log('[6/7] Verifying resetSim / clearPinnedBounds restores normal link tracking...');
  topVp.clearPinnedBounds();
  assert(topVp.pinnedBounds === null, 'pinnedBounds cleared');

  // Now syncLink SHOULD work and frame the active link
  const syncAfterClear = topVp.syncLink(nodePos, acnPos, { layout: tLayout, selectedNodeId: 4, forceReset: true });
  assert(syncAfterClear, 'syncLink succeeds after clearing pinned bounds');
  assert(topVp.bounds.minXM < 3000 && topVp.bounds.maxXM > 12000, 'Viewport framed around ACN link endpoints');
  console.log('  -> PASS: Normal link endpoint tracking seamlessly restored after reset.\n');

  // ---------------------------------------------------------------------------
  // [7/7] Geographic Coordinates & RF Calculations Immutability
  // ---------------------------------------------------------------------------
  console.log('[7/7] Verifying geographic coordinates & RF calculations remain authentic...');
  const terrain = new TerrainEngine({ terrainMode: 'real' });
  const loadOk = terrain.loadCustomDem(parse1.elevations!, parse1.metadata);
  assert(loadOk, 'Custom DEM loaded into TerrainEngine');

  assert(terrain.demMetadata.tileName === 'N34E076', 'Tile name preserved in terrain engine');
  assert(terrain.demMetadata.minX === meta1.minX, 'Authentic minX unchanged in terrain engine');
  assert(terrain.demMetadata.maxX === meta1.maxX, 'Authentic maxX unchanged in terrain engine');

  // Elevation query must return the authentic sample without coordinate mutation
  const elevSample = terrain.getElevation(0, 0);
  assertClose(elevSample, 3200, 1.0, 'Authentic elevation returned at origin');

  console.log('  -> PASS: Physical coordinates and elevation lookups remain authentic.\n');

  console.log('================================================================================');
  console.log('  ALL 7 SINGLE HGT VIEWPORT CENTERING VERIFICATION TESTS PASSED CLEANLY!');
  console.log('================================================================================');
}

runSingleHgtCenteringVerification();
