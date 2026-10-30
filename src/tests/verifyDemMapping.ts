/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * M6.1 Task 1: DEM Geographic Metadata & Coordinate Transformation Verification Suite
 *
 * Verifies:
 * 1. REAL_LADAKH_DEM_METADATA dimensions, bounds, and WGS-84 metric constants.
 * 2. Axis orientation: +X=East, +Y=North, Row 0=North, Col 0=West.
 * 3. Point-registration (gridline-registered): col 0..511 across 511 metric intervals.
 * 4. Bidirectional world <-> pixel transformations and exact round-tripping.
 * 5. Bidirectional world <-> Lat/Lon conversions and exact round-tripping.
 * 6. Boundary detection via isWithinDemCoverage().
 * 7. Absence of half-pixel shifts and projection scale invariance.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REAL_LADAKH_DEM_METADATA,
  TerrainEngine,
} from '../core/terrain';

function runDemMappingVerification(): void {
  console.log('================================================================================');
  console.log('  M6.1 TASK 1: DEM GEOGRAPHIC METADATA & COORDINATE TRANSFORMATIONS VERIFICATION');
  console.log('================================================================================');

  const meta = REAL_LADAKH_DEM_METADATA;
  const terrain = new TerrainEngine();

  // --------------------------------------------------------------------------
  // 1. Metadata Dimension & Geodetic Constant Checks
  // --------------------------------------------------------------------------
  console.log('\n[1/7] Checking geodetic metadata constants...');
  assert.equal(meta.rasterWidth, 512, 'Raster width must be 512');
  assert.equal(meta.rasterHeight, 512, 'Raster height must be 512');
  assert.equal(meta.centerLatDeg, 34.5, 'Center latitude must be 34.5° N');
  assert.equal(meta.centerLonDeg, 76.5, 'Center longitude must be 76.5° E');
  assert.equal(meta.minLatDeg, 33.5, 'Min latitude must be 33.5° N');
  assert.equal(meta.maxLatDeg, 35.5, 'Max latitude must be 35.5° N');
  assert.equal(meta.minLonDeg, 75.5, 'Min longitude must be 75.5° E');
  assert.equal(meta.maxLonDeg, 77.5, 'Max longitude must be 77.5° E');

  // WGS-84 ellipsoid at 34.5°N verification
  // Meridian radius M = 6,355,903.9 m -> 1° lat = 110,931.4506 m
  // Prime vertical N = 6,384,997.1 m -> 1° lon at 34.5°N = 91,839.9774 m
  assert.ok(Math.abs(meta.halfHeightM - 110931.4506) < 1e-4, 'halfHeightM matches WGS-84 meridian arc');
  assert.ok(Math.abs(meta.halfWidthM - 91839.9774) < 1e-4, 'halfWidthM matches WGS-84 parallel arc at 34.5°N');

  // Ground resolution checks (511 intervals between 512 points)
  const expectedResX = (2.0 * meta.halfWidthM) / 511.0;
  const expectedResY = (2.0 * meta.halfHeightM) / 511.0;
  assert.ok(Math.abs(meta.groundResolutionXM - expectedResX) < 1e-9, 'groundResolutionXM matches interval step');
  assert.ok(Math.abs(meta.groundResolutionYM - expectedResY) < 1e-9, 'groundResolutionYM matches interval step');
  assert.ok(meta.groundResolutionXM > 359.45 && meta.groundResolutionXM < 359.46, 'X pixel size ~359.45 m/px');
  assert.ok(meta.groundResolutionYM > 434.17 && meta.groundResolutionYM < 434.18, 'Y pixel size ~434.17 m/px');

  // Geodetic aspect ratio (H/W) is 221.86 km / 183.68 km = ~1.2079
  const aspectRatio = (2.0 * meta.halfHeightM) / (2.0 * meta.halfWidthM);
  assert.ok(Math.abs(aspectRatio - 1.207877) < 1e-5, 'Geodetic aspect ratio is ~1.2079 (not square 1.0)');
  console.log('  -> PASS: All geodetic metadata constants verified on WGS-84 ellipsoid.');

  // --------------------------------------------------------------------------
  // 2. Point Registration & Raster Orientation Checks
  // --------------------------------------------------------------------------
  console.log('\n[2/7] Checking point registration and axis orientation...');
  // Origin (0, 0) must map exactly to center pixel (255.5, 255.5)
  const centerPixel = terrain.worldToDemPixel(0, 0);
  assert.equal(centerPixel.col, 255.5, 'Center X=0 must be column 255.5');
  assert.equal(centerPixel.row, 255.5, 'Center Y=0 must be row 255.5');
  assert.equal(centerPixel.isInside, true, 'Center must be inside DEM coverage');

  // NW Corner: (-halfWidthM, +halfHeightM) -> (col 0.0, row 0.0)
  const nwPixel = terrain.worldToDemPixel(-meta.halfWidthM, meta.halfHeightM);
  assert.ok(Math.abs(nwPixel.col - 0.0) < 1e-12, 'NW corner must be col 0.0');
  assert.ok(Math.abs(nwPixel.row - 0.0) < 1e-12, 'NW corner must be row 0.0 (North is row 0)');
  assert.equal(nwPixel.isInside, true);

  // NE Corner: (+halfWidthM, +halfHeightM) -> (col 511.0, row 0.0)
  const nePixel = terrain.worldToDemPixel(meta.halfWidthM, meta.halfHeightM);
  assert.ok(Math.abs(nePixel.col - 511.0) < 1e-12, 'NE corner must be col 511.0');
  assert.ok(Math.abs(nePixel.row - 0.0) < 1e-12, 'NE corner must be row 0.0');
  assert.equal(nePixel.isInside, true);

  // SW Corner: (-halfWidthM, -halfHeightM) -> (col 0.0, row 511.0)
  const swPixel = terrain.worldToDemPixel(-meta.halfWidthM, -meta.halfHeightM);
  assert.ok(Math.abs(swPixel.col - 0.0) < 1e-12, 'SW corner must be col 0.0');
  assert.ok(Math.abs(swPixel.row - 511.0) < 1e-12, 'SW corner must be row 511.0 (South is row 511)');
  assert.equal(swPixel.isInside, true);

  // SE Corner: (+halfWidthM, -halfHeightM) -> (col 511.0, row 511.0)
  const sePixel = terrain.worldToDemPixel(meta.halfWidthM, -meta.halfHeightM);
  assert.ok(Math.abs(sePixel.col - 511.0) < 1e-12, 'SE corner must be col 511.0');
  assert.ok(Math.abs(sePixel.row - 511.0) < 1e-12, 'SE corner must be row 511.0');
  assert.equal(sePixel.isInside, true);
  console.log('  -> PASS: Raster orientation verified: +X=East (cols 0->511), +Y=North (rows 511->0).');

  // --------------------------------------------------------------------------
  // 3. DemPixelToWorld Inverse Mapping Checks
  // --------------------------------------------------------------------------
  console.log('\n[3/7] Checking inverse pixel-to-world mapping...');
  const centerWorld = terrain.demPixelToWorld(255.5, 255.5);
  assert.ok(Math.abs(centerWorld.xM - 0.0) < 1e-9, 'Pixel (255.5, 255.5) must map to x=0');
  assert.ok(Math.abs(centerWorld.yM - 0.0) < 1e-9, 'Pixel (255.5, 255.5) must map to y=0');

  const nwWorld = terrain.demPixelToWorld(0, 0);
  assert.ok(Math.abs(nwWorld.xM - (-meta.halfWidthM)) < 1e-9, 'Pixel (0, 0) maps to -halfWidthM');
  assert.ok(Math.abs(nwWorld.yM - meta.halfHeightM) < 1e-9, 'Pixel (0, 0) maps to +halfHeightM');

  const seWorld = terrain.demPixelToWorld(511, 511);
  assert.ok(Math.abs(seWorld.xM - meta.halfWidthM) < 1e-9, 'Pixel (511, 511) maps to +halfWidthM');
  assert.ok(Math.abs(seWorld.yM - (-meta.halfHeightM)) < 1e-9, 'Pixel (511, 511) maps to -halfHeightM');
  console.log('  -> PASS: Pixel-to-world inverse mapping matches exact geodetic bounds.');

  // --------------------------------------------------------------------------
  // 4. World <-> DEM Pixel Exact Round-Trip Invariance
  // --------------------------------------------------------------------------
  console.log('\n[4/7] Checking bidirectional world <-> DEM pixel round-trip precision...');
  const testCoords = [
    [0.0, 0.0],
    [12000.0, 8000.0],    // Node 4 (Recon Patrol)
    [-18000.0, -12000.0], // Node 0
    [-32000.0, -25000.0], // Node 6
    [42000.0, -28000.0],  // Node 10
    [-40000.0, 5000.0],   // Node 11
    [-meta.halfWidthM, meta.halfHeightM],
    [meta.halfWidthM, -meta.halfHeightM],
    [meta.halfWidthM * 0.75, -meta.halfHeightM * 0.33],
  ];

  for (const [x, y] of testCoords) {
    const px = terrain.worldToDemPixel(x, y);
    const recovered = terrain.demPixelToWorld(px.col, px.row);
    assert.ok(Math.abs(recovered.xM - x) < 1e-9, `World->Pixel->World roundtrip X failed at (${x}, ${y})`);
    assert.ok(Math.abs(recovered.yM - y) < 1e-9, `World->Pixel->World roundtrip Y failed at (${x}, ${y})`);
  }

  const testPixels = [
    [0.0, 0.0],
    [511.0, 511.0],
    [255.5, 255.5],
    [128.0, 384.0],
    [42.33, 199.77],
  ];

  for (const [c, r] of testPixels) {
    const w = terrain.demPixelToWorld(c, r);
    const recovered = terrain.worldToDemPixel(w.xM, w.yM);
    assert.ok(Math.abs(recovered.col - c) < 1e-9, `Pixel->World->Pixel roundtrip Col failed at (${c}, ${r})`);
    assert.ok(Math.abs(recovered.row - r) < 1e-9, `Pixel->World->Pixel roundtrip Row failed at (${c}, ${r})`);
  }
  console.log(`  -> PASS: All ${testCoords.length + testPixels.length} round-trips verified to < 1e-9 precision.`);

  // --------------------------------------------------------------------------
  // 5. Geographic Lat/Lon Conversion & Round-Trip Checks
  // --------------------------------------------------------------------------
  console.log('\n[5/7] Checking WGS-84 Local Equirectangular geographic conversions...');
  // Origin (0, 0) -> (34.5° N, 76.5° E)
  const centerGeo = terrain.worldToLatLon(0, 0);
  assert.ok(Math.abs(centerGeo.latDeg - 34.5) < 1e-12, 'Origin lat must be 34.5° N');
  assert.ok(Math.abs(centerGeo.lonDeg - 76.5) < 1e-12, 'Origin lon must be 76.5° E');

  // NW Corner (-halfWidthM, +halfHeightM) -> (35.5° N, 75.5° E)
  const nwGeo = terrain.worldToLatLon(-meta.halfWidthM, meta.halfHeightM);
  assert.ok(Math.abs(nwGeo.latDeg - 35.5) < 1e-12, 'NW lat must be 35.5° N (maxLatDeg)');
  assert.ok(Math.abs(nwGeo.lonDeg - 75.5) < 1e-12, 'NW lon must be 75.5° E (minLonDeg)');

  // SE Corner (+halfWidthM, -halfHeightM) -> (33.5° N, 77.5° E)
  const seGeo = terrain.worldToLatLon(meta.halfWidthM, -meta.halfHeightM);
  assert.ok(Math.abs(seGeo.latDeg - 33.5) < 1e-12, 'SE lat must be 33.5° N (minLatDeg)');
  assert.ok(Math.abs(seGeo.lonDeg - 77.5) < 1e-12, 'SE lon must be 77.5° E (maxLonDeg)');

  // Inverse: latLonToWorld
  const originFromGeo = terrain.latLonToWorld(34.5, 76.5);
  assert.ok(Math.abs(originFromGeo.xM - 0.0) < 1e-9, 'Geo (34.5, 76.5) must map to x=0');
  assert.ok(Math.abs(originFromGeo.yM - 0.0) < 1e-9, 'Geo (34.5, 76.5) must map to y=0');

  // Bidirectional Round Trip
  for (const [x, y] of testCoords) {
    const geo = terrain.worldToLatLon(x, y);
    const recovered = terrain.latLonToWorld(geo.latDeg, geo.lonDeg);
    assert.ok(Math.abs(recovered.xM - x) < 1e-7, `World->Geo->World roundtrip X failed at (${x}, ${y})`);
    assert.ok(Math.abs(recovered.yM - y) < 1e-7, `World->Geo->World roundtrip Y failed at (${x}, ${y})`);
  }
  console.log('  -> PASS: Geographic transformations match exact boundary parallels and round-trip cleanly.');

  // --------------------------------------------------------------------------
  // 6. Coverage Boundary Tests (isWithinDemCoverage)
  // --------------------------------------------------------------------------
  console.log('\n[6/7] Checking boundary detection (isWithinDemCoverage)...');
  // Inside points
  assert.equal(terrain.isWithinDemCoverage(0, 0), true);
  assert.equal(terrain.isWithinDemCoverage(50000, 50000), true);
  assert.equal(terrain.isWithinDemCoverage(-meta.halfWidthM, 0), true);
  assert.equal(terrain.isWithinDemCoverage(meta.halfWidthM, 0), true);
  assert.equal(terrain.isWithinDemCoverage(0, -meta.halfHeightM), true);
  assert.equal(terrain.isWithinDemCoverage(0, meta.halfHeightM), true);

  // Outside points
  assert.equal(terrain.isWithinDemCoverage(meta.halfWidthM + 0.1, 0), false, '+X just beyond boundary');
  assert.equal(terrain.isWithinDemCoverage(-meta.halfWidthM - 0.1, 0), false, '-X just beyond boundary');
  assert.equal(terrain.isWithinDemCoverage(0, meta.halfHeightM + 0.1), false, '+Y just beyond boundary');
  assert.equal(terrain.isWithinDemCoverage(0, -meta.halfHeightM - 0.1), false, '-Y just beyond boundary');
  assert.equal(terrain.isWithinDemCoverage(150000, 0), false, 'Far East 150 km');
  assert.equal(terrain.isWithinDemCoverage(0, 200000), false, 'Far North 200 km');
  assert.equal(terrain.isWithinDemCoverage(600000, 600000), false, 'Old theater boundary (600 km)');

  // Invalid numbers
  assert.equal(terrain.isWithinDemCoverage(Number.NaN, 0), false, 'NaN must be outside');
  assert.equal(terrain.isWithinDemCoverage(0, Number.POSITIVE_INFINITY), false, 'Infinity must be outside');
  console.log('  -> PASS: Boundary checks strictly enforce the genuine DEM extent without extrapolation.');

  // --------------------------------------------------------------------------
  // 7. Scale Invariance (No Stretched Step)
  // --------------------------------------------------------------------------
  console.log('\n[7/7] Checking metric scale invariance...');
  // A step of exactly 10,000 metres East must advance exactly 10,000 / groundResolutionXM columns
  const p0 = terrain.worldToDemPixel(0, 0);
  const pEast10k = terrain.worldToDemPixel(10000.0, 0);
  const colDelta = pEast10k.col - p0.col;
  const expectedColDelta = 10000.0 / meta.groundResolutionXM;
  assert.ok(Math.abs(colDelta - expectedColDelta) < 1e-12, '10 km East step matches exact groundResolutionXM');

  // A step of exactly 10,000 metres North must advance exactly -10,000 / groundResolutionYM rows
  const pNorth10k = terrain.worldToDemPixel(0, 10000.0);
  const rowDelta = pNorth10k.row - p0.row;
  const expectedRowDelta = -10000.0 / meta.groundResolutionYM; // Decreasing row = North
  assert.ok(Math.abs(rowDelta - expectedRowDelta) < 1e-12, '10 km North step matches exact groundResolutionYM');
  console.log(`  -> PASS: 10 km East = ${colDelta.toFixed(4)} cols (${meta.groundResolutionXM.toFixed(2)} m/px).`);
  console.log(`  -> PASS: 10 km North = ${Math.abs(rowDelta).toFixed(4)} rows (${meta.groundResolutionYM.toFixed(2)} m/px).`);

  // ==========================================================================
  // M6.1 TASK 2: REAL DEM INTERPOLATION & OUT-OF-COVERAGE BEHAVIOR
  // ==========================================================================
  console.log('\n================================================================================');
  console.log('  M6.1 TASK 2: REAL DEM INTERPOLATION & COVERAGE VERIFICATION');
  console.log('================================================================================');

  // --------------------------------------------------------------------------
  // 8. Load Authentic Satellite DEM Binary
  // --------------------------------------------------------------------------
  console.log('\n[8/16] Loading authentic satellite DEM binary (Float32Array)...');
  const demPath = path.resolve(process.cwd(), 'public/terrain/real_ladakh_dem.bin');
  assert.ok(fs.existsSync(demPath), `DEM binary must exist at ${demPath}`);
  const demBuffer = fs.readFileSync(demPath);
  const expectedByteLength = 512 * 512 * 4;
  assert.equal(demBuffer.byteLength, expectedByteLength, `DEM binary must be exactly ${expectedByteLength} bytes (1,048,576 B)`);

  const realDemArray = new Float32Array(demBuffer.buffer, demBuffer.byteOffset, 512 * 512);
  terrain.loadCustomDem(realDemArray);
  assert.equal(terrain.hasRealDem, true, 'hasRealDem must be true after loading DEM');
  assert.equal(terrain.terrainMode, 'real', 'terrainMode must be real');
  console.log(`  -> PASS: Loaded 512x512 Float32 matrix (${realDemArray.length} samples, ${(expectedByteLength / 1024).toFixed(0)} KB).`);

  // --------------------------------------------------------------------------
  // 9. Exact Center Elevation Sample Verification
  // --------------------------------------------------------------------------
  console.log('\n[9/16] Checking center elevation sample at origin (0, 0)...');
  // Origin (0, 0) maps to continuous pixel (255.5, 255.5).
  // Bilinear interpolation between [255, 255], [255, 256], [256, 255], [256, 256]:
  // [255, 255] = 3297.34375, [255, 256] = 3386.43115, [256, 255] = 3293.70337, [256, 256] = 3403.71143
  // Expected center = 3345.2974243164062 m MSL
  const centerElev = terrain.getElevation(0, 0);
  const centerDemElev = terrain.getDemElevation(0, 0);
  const expectedCenterElev = 3345.2974243164062;
  assert.ok(Math.abs(centerElev - expectedCenterElev) < 1e-4, `Center getElevation must match bilinear interpolation (${expectedCenterElev} m), got ${centerElev}`);
  assert.ok(Math.abs(centerDemElev - expectedCenterElev) < 1e-4, `Center getDemElevation must match bilinear interpolation, got ${centerDemElev}`);

  // Test world coordinates corresponding to integer pixel (256, 256):
  const w256 = terrain.demPixelToWorld(256.0, 256.0);
  const elev256 = terrain.getElevation(w256.xM, w256.yM);
  const rawPixel256 = realDemArray[256 * 512 + 256];
  assert.ok(Math.abs(elev256 - rawPixel256) < 1e-4, `Pixel [256, 256] elevation must match raw sample (${rawPixel256} m), got ${elev256}`);
  console.log(`  -> PASS: Center (0, 0) -> ${centerElev.toFixed(2)} m MSL; Pixel (256, 256) -> ${elev256.toFixed(2)} m MSL.`);

  // --------------------------------------------------------------------------
  // 10. Four Corner Ground-Truth Elevations Matching Raw Float32 Binary
  // --------------------------------------------------------------------------
  console.log('\n[10/16] Checking 4 corner ground-truth elevations against raw binary Float32...');
  // NW Corner: (-halfWidthM, +halfHeightM) -> Pixel [0, 0] = 4149.1005859375 m MSL
  const rawNW = realDemArray[0 * 512 + 0];
  const nwElev = terrain.getElevation(-meta.halfWidthM, meta.halfHeightM);
  assert.ok(Math.abs(nwElev - rawNW) < 1e-4, `NW corner elevation must match raw DEM (${rawNW} m), got ${nwElev}`);

  // NE Corner: (+halfWidthM, +halfHeightM) -> Pixel [0, 511] = 5364.8603515625 m MSL
  const rawNE = realDemArray[0 * 512 + 511];
  const neElev = terrain.getElevation(meta.halfWidthM, meta.halfHeightM);
  assert.ok(Math.abs(neElev - rawNE) < 1e-4, `NE corner elevation must match raw DEM (${rawNE} m), got ${neElev}`);

  // SW Corner: (-halfWidthM, -halfHeightM) -> Pixel [511, 0] = 3182.5400390625 m MSL
  const rawSW = realDemArray[511 * 512 + 0];
  const swElev = terrain.getElevation(-meta.halfWidthM, -meta.halfHeightM);
  assert.ok(Math.abs(swElev - rawSW) < 1e-4, `SW corner elevation must match raw DEM (${rawSW} m), got ${swElev}`);

  // SE Corner: (+halfWidthM, -halfHeightM) -> Pixel [511, 511] = 4376.32080078125 m MSL
  const rawSE = realDemArray[511 * 512 + 511];
  const seElev = terrain.getElevation(meta.halfWidthM, -meta.halfHeightM);
  assert.ok(Math.abs(seElev - rawSE) < 1e-4, `SE corner elevation must match raw DEM (${rawSE} m), got ${seElev}`);

  console.log(`  -> PASS: NW (-91.8km, +110.9km) = ${nwElev.toFixed(2)} m MSL (raw: ${rawNW.toFixed(2)} m)`);
  console.log(`  -> PASS: NE (+91.8km, +110.9km) = ${neElev.toFixed(2)} m MSL (raw: ${rawNE.toFixed(2)} m)`);
  console.log(`  -> PASS: SW (-91.8km, -110.9km) = ${swElev.toFixed(2)} m MSL (raw: ${rawSW.toFixed(2)} m)`);
  console.log(`  -> PASS: SE (+91.8km, -110.9km) = ${seElev.toFixed(2)} m MSL (raw: ${rawSE.toFixed(2)} m)`);

  // --------------------------------------------------------------------------
  // 11. Fractional Coordinate Bilinear Interpolation
  // --------------------------------------------------------------------------
  console.log('\n[11/16] Checking fractional coordinate bilinear interpolation...');
  // Arbitrary continuous pixel: (col = 100.25, row = 200.75)
  const fracCol = 100.25;
  const fracRow = 200.75;
  const fracWorld = terrain.demPixelToWorld(fracCol, fracRow);

  // Manual bilinear calculation on raw matrix
  const c0 = 100, c1 = 101, fc = 0.25;
  const r0 = 200, r1 = 201, fr = 0.75;
  const v00 = realDemArray[r0 * 512 + c0];
  const v01 = realDemArray[r0 * 512 + c1];
  const v10 = realDemArray[r1 * 512 + c0];
  const v11 = realDemArray[r1 * 512 + c1];
  const manualTop = v00 * (1.0 - fc) + v01 * fc;
  const manualBot = v10 * (1.0 - fc) + v11 * fc;
  const expectedFrac = manualTop * (1.0 - fr) + manualBot * fr;

  const actualFrac = terrain.getElevation(fracWorld.xM, fracWorld.yM);
  assert.ok(Math.abs(actualFrac - expectedFrac) < 1e-5, `Bilinear elevation at (${fracCol}, ${fracRow}) must match manual formula (${expectedFrac} m), got ${actualFrac}`);
  console.log(`  -> PASS: Fractional pixel (100.25, 200.75) -> ${actualFrac.toFixed(3)} m MSL (exact match with manual 4-point bilinear).`);

  // --------------------------------------------------------------------------
  // 12. Out-of-Coverage Non-Fabrication (Strict Number.NaN Return)
  // --------------------------------------------------------------------------
  console.log('\n[12/16] Checking out-of-coverage coordinates return Number.NaN...');
  const outCoords = [
    [150000.0, 0.0, 'Far East (+150 km)'],
    [-150000.0, 0.0, 'Far West (-150 km)'],
    [0.0, 200000.0, 'Far North (+200 km)'],
    [0.0, -200000.0, 'Far South (-200 km)'],
    [600000.0, 600000.0, 'Old theater boundary (+600 km, +600 km)'],
    [-600000.0, -600000.0, 'Old theater boundary (-600 km, -600 km)'],
    [100000.0, 120000.0, 'Outside both X and Y'],
  ];

  for (const [x, y, label] of outCoords) {
    const elev = terrain.getElevation(x as number, y as number);
    const demElev = terrain.getDemElevation(x as number, y as number);
    assert.ok(Number.isNaN(elev), `getElevation at ${label} (${x}, ${y}) must return Number.NaN, got ${elev}`);
    assert.ok(Number.isNaN(demElev), `getDemElevation at ${label} (${x}, ${y}) must return Number.NaN, got ${demElev}`);
    assert.equal(terrain.isWithinDemCoverage(x as number, y as number), false, `isWithinDemCoverage must be false for ${label}`);
  }
  console.log(`  -> PASS: All ${outCoords.length} out-of-coverage queries return Number.NaN without neutral floor substitution or clamping.`);

  // --------------------------------------------------------------------------
  // 13. Exact Boundary vs Just-Outside Boundary Step
  // --------------------------------------------------------------------------
  console.log('\n[13/16] Checking exact boundary vs just-outside boundary step (+/- 0.1 m)...');
  // Exactly on boundary -> Valid finite elevation
  assert.ok(Number.isFinite(terrain.getElevation(meta.halfWidthM, 0.0)), '+X boundary must be finite');
  assert.ok(Number.isFinite(terrain.getElevation(-meta.halfWidthM, 0.0)), '-X boundary must be finite');
  assert.ok(Number.isFinite(terrain.getElevation(0.0, meta.halfHeightM)), '+Y boundary must be finite');
  assert.ok(Number.isFinite(terrain.getElevation(0.0, -meta.halfHeightM)), '-Y boundary must be finite');

  // Exactly 0.1 m outside boundary -> Number.NaN
  assert.ok(Number.isNaN(terrain.getElevation(meta.halfWidthM + 0.1, 0.0)), '+X + 0.1m must return NaN');
  assert.ok(Number.isNaN(terrain.getElevation(-meta.halfWidthM - 0.1, 0.0)), '-X - 0.1m must return NaN');
  assert.ok(Number.isNaN(terrain.getElevation(0.0, meta.halfHeightM + 0.1)), '+Y + 0.1m must return NaN');
  assert.ok(Number.isNaN(terrain.getElevation(0.0, -meta.halfHeightM - 0.1)), '-Y - 0.1m must return NaN');
  console.log('  -> PASS: Sharp transition at +/- 0.1 m boundary verified across all 4 edges.');

  // --------------------------------------------------------------------------
  // 14. Non-Finite Coordinate Handling (NaN, Infinity)
  // --------------------------------------------------------------------------
  console.log('\n[14/16] Checking non-finite coordinate handling (NaN, Infinity)...');
  assert.ok(Number.isNaN(terrain.getElevation(Number.NaN, 0.0)), 'NaN X must return NaN');
  assert.ok(Number.isNaN(terrain.getElevation(0.0, Number.NaN)), 'NaN Y must return NaN');
  assert.ok(Number.isNaN(terrain.getElevation(Number.NaN, Number.NaN)), 'NaN X and Y must return NaN');
  assert.ok(Number.isNaN(terrain.getElevation(Number.POSITIVE_INFINITY, 0.0)), '+Infinity X must return NaN');
  assert.ok(Number.isNaN(terrain.getElevation(0.0, Number.NEGATIVE_INFINITY)), '-Infinity Y must return NaN');
  assert.ok(Number.isNaN(terrain.getElevation(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)), '+/-Infinity must return NaN');

  assert.ok(Number.isNaN(terrain.getDemElevation(Number.NaN, 0.0)), 'getDemElevation NaN X must return NaN');
  assert.ok(Number.isNaN(terrain.getDemElevation(Number.POSITIVE_INFINITY, 0.0)), 'getDemElevation Infinity X must return NaN');
  console.log('  -> PASS: Non-finite inputs handled safely without throwing or propagating unhandled values.');

  // --------------------------------------------------------------------------
  // 15. Scale Invariance in Elevation Space
  // --------------------------------------------------------------------------
  console.log('\n[15/16] Checking 1-pixel step scale invariance in elevation sampling...');
  // Advancing 1 ground resolution step in X should advance exactly 1 column in index space
  const testCol = 150;
  const testRow = 250;
  const w1 = terrain.demPixelToWorld(testCol, testRow);
  const w2 = terrain.demPixelToWorld(testCol + 1, testRow);
  const dx = w2.xM - w1.xM;
  assert.ok(Math.abs(dx - meta.groundResolutionXM) < 1e-9, 'World X step equals groundResolutionXM');

  const elev1 = terrain.getElevation(w1.xM, w1.yM);
  const elev2 = terrain.getElevation(w2.xM, w2.yM);
  const rawSample1 = realDemArray[testRow * 512 + testCol];
  const rawSample2 = realDemArray[testRow * 512 + (testCol + 1)];
  assert.ok(Math.abs(elev1 - rawSample1) < 1e-4, 'Sample 1 matches raw DEM sample');
  assert.ok(Math.abs(elev2 - rawSample2) < 1e-4, 'Sample 2 matches raw DEM sample');
  console.log(`  -> PASS: 1-pixel shift (${dx.toFixed(2)} m) advances exactly 1 column from ${elev1.toFixed(1)} m to ${elev2.toFixed(1)} m MSL.`);

  // --------------------------------------------------------------------------
  // 16. Preservation of Procedural Synthetic Mode Across Full 1,200 km Theater
  // --------------------------------------------------------------------------
  console.log('\n[16/16] Checking procedural synthetic mode preservation across 1,200 km theater...');
  terrain.setTerrainMode('synthetic');
  assert.equal(terrain.terrainMode, 'synthetic', 'terrainMode must be synthetic');

  const synthCoords = [
    [0.0, 0.0, 'Origin'],
    [12000.0, 8000.0, 'Tactical node area (+12km, +8km)'],
    [300000.0, 200000.0, 'Regional outer (+300km, +200km)'],
    [-500000.0, -400000.0, 'Far boundary (-500km, -400km)'],
    [600000.0, 600000.0, 'Theater edge (+600km, +600km)'],
    [-600000.0, -600000.0, 'Theater edge (-600km, -600km)'],
  ];

  for (const [x, y, label] of synthCoords) {
    const sElev = terrain.getElevation(x as number, y as number);
    assert.ok(Number.isFinite(sElev), `Synthetic mode at ${label} (${x}, ${y}) must be finite, got ${sElev}`);
    assert.ok(sElev >= 2800.0 && sElev <= 5900.0, `Synthetic elevation must be within [2800, 5900] m, got ${sElev}`);
  }
  console.log(`  -> PASS: Procedural synthetic mode retains full-bleed coverage across entire 1,200 km domain.`);

  console.log('\n================================================================================');
  console.log('  [SUCCESS] ALL 16 M6.1 TASK 1 & TASK 2 VERIFICATION TESTS PASSED WITH 100% PRECISION.');
  console.log('================================================================================\n');
}

runDemMappingVerification();

