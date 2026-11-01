/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * M7.1: Geodetic Coordinate Mapping Verification Suite
 *
 * Verifies:
 * 1. Geographic origin mapping (0, 0) <-> (34.5°N, 76.5°E).
 * 2. Cardinal offset scaling (North, South, East, West) along WGS-84 ellipsoid arcs.
 * 3. Exact DEM corners and center mapping against REAL_LADAKH_DEM_METADATA.
 * 4. Boundary detection, out-of-coverage handling, and absence of silent clamping.
 * 5. High-precision forward/inverse bidirectional round-trips (< 1e-7 metres).
 * 6. Robust input validation (rejection of non-finite and out-of-range coordinates).
 * 7. Absolute consistency with existing TerrainEngine.worldToLatLon/latLonToWorld projection.
 * 8. Geodetic formatting utilities (decimal degrees and DMS).
 * 9. Worker telemetry ingestion: lat_deg and lon_deg present on all 16 ground nodes and ACN.
 */

import assert from 'node:assert/strict';
import {
  cartesianToGeodetic,
  DEM_COVERAGE_HALF_HEIGHT_M,
  DEM_COVERAGE_HALF_WIDTH_M,
  DEM_MAX_LAT_DEG,
  DEM_MAX_LON_DEG,
  DEM_MIN_LAT_DEG,
  DEM_MIN_LON_DEG,
  formatGeodeticDecimal,
  formatGeodeticDms,
  geodeticToCartesian,
  GEODESY_ORIGIN_LAT_DEG,
  GEODESY_ORIGIN_LON_DEG,
  METERS_PER_DEG_LAT,
  METERS_PER_DEG_LON,
} from '../core/geodesy';
import { REAL_LADAKH_DEM_METADATA, TerrainEngine } from '../core/terrain';
import { SimulationWorkerManager } from '../worker/simWorker';

function runGeodesyVerification(): void {
  console.log('================================================================================');
  console.log('  M7.1: AUTHENTIC GEODETIC COORDINATE MAPPING VERIFICATION SUITE');
  console.log('================================================================================');

  const meta = REAL_LADAKH_DEM_METADATA;
  const terrain = new TerrainEngine();

  // --------------------------------------------------------------------------
  // [1/9] Origin Conversion Checks
  // --------------------------------------------------------------------------
  console.log('\n[1/9] Verifying origin conversion: (0, 0) <-> (34.5°N, 76.5°E)...');
  const originGeo = cartesianToGeodetic(0, 0);
  assert.equal(originGeo.latDeg, 34.5, 'Origin latitude must be 34.5°N');
  assert.equal(originGeo.lonDeg, 76.5, 'Origin longitude must be 76.5°E');
  assert.equal(originGeo.isWithinCoverage, true, 'Origin must be within DEM coverage');

  const originCart = geodeticToCartesian(34.5, 76.5);
  assert.equal(originCart.xM, 0, 'Origin Cartesian X must be 0 m');
  assert.equal(originCart.yM, 0, 'Origin Cartesian Y must be 0 m');
  assert.equal(originCart.isWithinCoverage, true, 'Origin Cartesian must be within coverage');
  console.log('  -> PASS: Local Cartesian (0, 0) strictly maps to WGS-84 (34.5°N, 76.5°E).');

  // --------------------------------------------------------------------------
  // [2/9] Cardinal Offset Scaling
  // --------------------------------------------------------------------------
  console.log('\n[2/9] Verifying cardinal offsets (North, South, East, West)...');
  const offsetM = 50000.0;

  // North: +Y
  const northGeo = cartesianToGeodetic(0, offsetM);
  assert.equal(northGeo.lonDeg, 76.5, 'Pure north movement must keep longitude constant');
  const expectedNorthLat = 34.5 + offsetM / METERS_PER_DEG_LAT;
  assert.ok(Math.abs(northGeo.latDeg - expectedNorthLat) < 1e-12, 'North latitude offset matches scale');
  assert.equal(northGeo.isWithinCoverage, true);

  // South: -Y
  const southGeo = cartesianToGeodetic(0, -offsetM);
  assert.equal(southGeo.lonDeg, 76.5, 'Pure south movement must keep longitude constant');
  const expectedSouthLat = 34.5 - offsetM / METERS_PER_DEG_LAT;
  assert.ok(Math.abs(southGeo.latDeg - expectedSouthLat) < 1e-12, 'South latitude offset matches scale');
  assert.equal(southGeo.isWithinCoverage, true);

  // East: +X
  const eastGeo = cartesianToGeodetic(offsetM, 0);
  assert.equal(eastGeo.latDeg, 34.5, 'Pure east movement must keep latitude constant');
  const expectedEastLon = 76.5 + offsetM / METERS_PER_DEG_LON;
  assert.ok(Math.abs(eastGeo.lonDeg - expectedEastLon) < 1e-12, 'East longitude offset matches scale');
  assert.equal(eastGeo.isWithinCoverage, true);

  // West: -X
  const westGeo = cartesianToGeodetic(-offsetM, 0);
  assert.equal(westGeo.latDeg, 34.5, 'Pure west movement must keep latitude constant');
  const expectedWestLon = 76.5 - offsetM / METERS_PER_DEG_LON;
  assert.ok(Math.abs(westGeo.lonDeg - expectedWestLon) < 1e-12, 'West longitude offset matches scale');
  assert.equal(westGeo.isWithinCoverage, true);
  console.log('  -> PASS: Cardinal axes scale linearly according to WGS-84 metric constants.');

  // --------------------------------------------------------------------------
  // [3/9] DEM Corners & Center Mapping
  // --------------------------------------------------------------------------
  console.log('\n[3/9] Verifying DEM corner coordinates and bounds fidelity...');
  // NW Corner: (-halfWidth, +halfHeight) -> (35.5°N, 75.5°E)
  const nwGeo = cartesianToGeodetic(-DEM_COVERAGE_HALF_WIDTH_M, DEM_COVERAGE_HALF_HEIGHT_M);
  assert.ok(Math.abs(nwGeo.latDeg - DEM_MAX_LAT_DEG) < 1e-12, 'NW lat matches maxLatDeg (35.5°N)');
  assert.ok(Math.abs(nwGeo.lonDeg - DEM_MIN_LON_DEG) < 1e-12, 'NW lon matches minLonDeg (75.5°E)');
  assert.equal(nwGeo.isWithinCoverage, true);

  // NE Corner: (+halfWidth, +halfHeight) -> (35.5°N, 77.5°E)
  const neGeo = cartesianToGeodetic(DEM_COVERAGE_HALF_WIDTH_M, DEM_COVERAGE_HALF_HEIGHT_M);
  assert.ok(Math.abs(neGeo.latDeg - DEM_MAX_LAT_DEG) < 1e-12, 'NE lat matches maxLatDeg (35.5°N)');
  assert.ok(Math.abs(neGeo.lonDeg - DEM_MAX_LON_DEG) < 1e-12, 'NE lon matches maxLonDeg (77.5°E)');
  assert.equal(neGeo.isWithinCoverage, true);

  // SW Corner: (-halfWidth, -halfHeight) -> (33.5°N, 75.5°E)
  const swGeo = cartesianToGeodetic(-DEM_COVERAGE_HALF_WIDTH_M, -DEM_COVERAGE_HALF_HEIGHT_M);
  assert.ok(Math.abs(swGeo.latDeg - DEM_MIN_LAT_DEG) < 1e-12, 'SW lat matches minLatDeg (33.5°N)');
  assert.ok(Math.abs(swGeo.lonDeg - DEM_MIN_LON_DEG) < 1e-12, 'SW lon matches minLonDeg (75.5°E)');
  assert.equal(swGeo.isWithinCoverage, true);

  // SE Corner: (+halfWidth, -halfHeight) -> (33.5°N, 77.5°E)
  const seGeo = cartesianToGeodetic(DEM_COVERAGE_HALF_WIDTH_M, -DEM_COVERAGE_HALF_HEIGHT_M);
  assert.ok(Math.abs(seGeo.latDeg - DEM_MIN_LAT_DEG) < 1e-12, 'SE lat matches minLatDeg (33.5°N)');
  assert.ok(Math.abs(seGeo.lonDeg - DEM_MAX_LON_DEG) < 1e-12, 'SE lon matches maxLonDeg (77.5°E)');
  assert.equal(seGeo.isWithinCoverage, true);
  console.log('  -> PASS: All four DEM corner coordinates match exact metadata endpoints.');

  // --------------------------------------------------------------------------
  // [4/9] Boundary Detection & Out-of-Coverage Behavior (No Silent Clamping)
  // --------------------------------------------------------------------------
  console.log('\n[4/9] Verifying boundary detection and out-of-coverage unprojected handling...');
  // Just inside bounds
  const insideEast = cartesianToGeodetic(DEM_COVERAGE_HALF_WIDTH_M - 0.5, 0);
  assert.equal(insideEast.isWithinCoverage, true);

  // Just outside bounds
  const outsideEast = cartesianToGeodetic(DEM_COVERAGE_HALF_WIDTH_M + 0.5, 0);
  assert.equal(outsideEast.isWithinCoverage, false);
  assert.ok(outsideEast.lonDeg > 77.5, 'Outside east point must calculate true unprojected longitude > 77.5°E');

  // Distant out-of-coverage point (e.g. 200 km East, 150 km North)
  const distant = cartesianToGeodetic(200000.0, 150000.0);
  assert.equal(distant.isWithinCoverage, false);
  const expectedDistantLat = 34.5 + 150000.0 / METERS_PER_DEG_LAT;
  const expectedDistantLon = 76.5 + 200000.0 / METERS_PER_DEG_LON;
  assert.ok(Math.abs(distant.latDeg - expectedDistantLat) < 1e-12, 'Distant latitude must NOT be clamped');
  assert.ok(Math.abs(distant.lonDeg - expectedDistantLon) < 1e-12, 'Distant longitude must NOT be clamped');

  // Inverse outside coverage
  const distantCart = geodeticToCartesian(36.0, 78.0);
  assert.equal(distantCart.isWithinCoverage, false);
  assert.ok(distantCart.xM > DEM_COVERAGE_HALF_WIDTH_M);
  assert.ok(distantCart.yM > DEM_COVERAGE_HALF_HEIGHT_M);
  console.log('  -> PASS: Out-of-coverage coordinates unproject faithfully with zero silent clamping.');

  // --------------------------------------------------------------------------
  // [5/9] Forward and Inverse Bidirectional Round-Trip Invariance
  // --------------------------------------------------------------------------
  console.log('\n[5/9] Verifying bidirectional round-trip numerical precision...');
  const testPoints = [
    [0.0, 0.0],
    [12000.0, 8000.0],     // Node 4 (Recon Patrol)
    [-18000.0, -12000.0],  // Node 0
    [-32000.0, -25000.0],  // Node 6
    [42000.0, -28000.0],   // Node 10
    [-40000.0, 5000.0],    // Node 11
    [75000.0, 95000.0],
    [-85000.0, -105000.0],
    [DEM_COVERAGE_HALF_WIDTH_M, DEM_COVERAGE_HALF_HEIGHT_M],
    [-DEM_COVERAGE_HALF_WIDTH_M, -DEM_COVERAGE_HALF_HEIGHT_M],
    [250000.0, -180000.0], // Out of coverage
  ];

  for (const [x, y] of testPoints) {
    const geo = cartesianToGeodetic(x, y);
    const recovered = geodeticToCartesian(geo.latDeg, geo.lonDeg);
    const errX = Math.abs(recovered.xM - x);
    const errY = Math.abs(recovered.yM - y);
    assert.ok(errX < 1e-7, `Cartesian->Geodetic->Cartesian X error ${errX} m exceeds 1e-7 at (${x}, ${y})`);
    assert.ok(errY < 1e-7, `Cartesian->Geodetic->Cartesian Y error ${errY} m exceeds 1e-7 at (${x}, ${y})`);
    assert.equal(recovered.isWithinCoverage, geo.isWithinCoverage);
  }

  const testGeodetic = [
    [34.5, 76.5],
    [35.0, 77.0],
    [33.7, 75.8],
    [35.45, 77.45],
    [33.5, 75.5],
    [35.5, 77.5],
    [36.2, 78.1], // Out of coverage
  ];

  for (const [lat, lon] of testGeodetic) {
    const cart = geodeticToCartesian(lat, lon);
    const recovered = cartesianToGeodetic(cart.xM, cart.yM);
    const errLat = Math.abs(recovered.latDeg - lat);
    const errLon = Math.abs(recovered.lonDeg - lon);
    assert.ok(errLat < 1e-12, `Geodetic->Cartesian->Geodetic Lat error ${errLat}° exceeds 1e-12 at (${lat}, ${lon})`);
    assert.ok(errLon < 1e-12, `Geodetic->Cartesian->Geodetic Lon error ${errLon}° exceeds 1e-12 at (${lat}, ${lon})`);
  }
  console.log(`  -> PASS: All ${testPoints.length + testGeodetic.length} round-trips verified to < 1e-7 metres precision.`);

  // --------------------------------------------------------------------------
  // [6/9] Input Validation & Exception Handling
  // --------------------------------------------------------------------------
  console.log('\n[6/9] Verifying input validation and error throwing...');
  assert.throws(() => cartesianToGeodetic(NaN, 0), TypeError, 'Cartesian NaN X must throw TypeError');
  assert.throws(() => cartesianToGeodetic(0, Infinity), TypeError, 'Cartesian Infinity Y must throw TypeError');
  assert.throws(() => geodeticToCartesian(NaN, 76.5), TypeError, 'Geodetic NaN Lat must throw TypeError');
  assert.throws(() => geodeticToCartesian(34.5, -Infinity), TypeError, 'Geodetic Infinity Lon must throw TypeError');

  assert.throws(() => geodeticToCartesian(90.1, 76.5), RangeError, 'Lat > 90 must throw RangeError');
  assert.throws(() => geodeticToCartesian(-90.1, 76.5), RangeError, 'Lat < -90 must throw RangeError');
  assert.throws(() => geodeticToCartesian(34.5, 180.1), RangeError, 'Lon > 180 must throw RangeError');
  assert.throws(() => geodeticToCartesian(34.5, -180.1), RangeError, 'Lon < -180 must throw RangeError');
  console.log('  -> PASS: Invalid coordinates reliably throw appropriate TypeError and RangeError.');

  // --------------------------------------------------------------------------
  // [7/9] Consistency with Existing TerrainEngine Projection
  // --------------------------------------------------------------------------
  console.log('\n[7/9] Verifying absolute consistency with existing TerrainEngine projection...');
  for (const [x, y] of testPoints) {
    const geoModule = cartesianToGeodetic(x, y);
    const geoEngine = terrain.worldToLatLon(x, y);
    assert.ok(Math.abs(geoModule.latDeg - geoEngine.latDeg) < 1e-12, `Lat divergence between module and engine at (${x}, ${y})`);
    assert.ok(Math.abs(geoModule.lonDeg - geoEngine.lonDeg) < 1e-12, `Lon divergence between module and engine at (${x}, ${y})`);

    const cartModule = geodeticToCartesian(geoModule.latDeg, geoModule.lonDeg);
    const cartEngine = terrain.latLonToWorld(geoEngine.latDeg, geoEngine.lonDeg);
    assert.ok(Math.abs(cartModule.xM - cartEngine.xM) < 1e-7, `X divergence between module and engine`);
    assert.ok(Math.abs(cartModule.yM - cartEngine.yM) < 1e-7, `Y divergence between module and engine`);
  }
  console.log('  -> PASS: Zero discrepancy between geodesy module and TerrainEngine projection.');

  // --------------------------------------------------------------------------
  // [8/9] Formatting Utilities (Decimal & DMS)
  // --------------------------------------------------------------------------
  console.log('\n[8/9] Verifying human-readable geodetic formatters...');
  const originDms = formatGeodeticDms(34.5, 76.5);
  assert.equal(originDms, '34°30\'00.0"N, 76°30\'00.0"E', 'Origin DMS formatted correctly');

  const originDec = formatGeodeticDecimal(34.5, 76.5, 5);
  assert.equal(originDec, '34.50000°N, 76.50000°E', 'Origin decimal formatted correctly');

  const southWestDms = formatGeodeticDms(-33.25, -71.5);
  assert.equal(southWestDms, '33°15\'00.0"S, 71°30\'00.0"W', 'Southern/Western hemispheres formatted correctly');
  console.log('  -> PASS: Formatters produce accurate, standard decimal and DMS representations.');

  // --------------------------------------------------------------------------
  // [9/9] Worker Telemetry Integration (Ground Nodes and ACN)
  // --------------------------------------------------------------------------
  console.log('\n[9/9] Verifying worker telemetry ingestion of lat_deg and lon_deg...');
  const worker = new SimulationWorkerManager();
  const nodes = worker.buildNodesTelemetry();
  assert.equal(nodes.length, 16, 'Exactly 16 terminals in nodes_telemetry');

  for (const node of nodes) {
    assert(Number.isFinite(node.lat_deg), `Node ${node.node_id} lat_deg must be finite`);
    assert(Number.isFinite(node.lon_deg), `Node ${node.node_id} lon_deg must be finite`);

    // Verify consistency with cartesian coordinates
    const expectedGeo = cartesianToGeodetic(node.x_m, node.y_m);
    assert.ok(Math.abs(node.lat_deg - expectedGeo.latDeg) < 1e-12, `Node ${node.node_id} lat_deg matches expected`);
    assert.ok(Math.abs(node.lon_deg - expectedGeo.lonDeg) < 1e-12, `Node ${node.node_id} lon_deg matches expected`);
    assert.ok(node.lat_deg >= 33.0 && node.lat_deg <= 36.0, `Node ${node.node_id} latitude in plausible sector range`);
    assert.ok(node.lon_deg >= 75.0 && node.lon_deg <= 78.0, `Node ${node.node_id} longitude in plausible sector range`);
  }

  // Verify ACN telemetry
  worker.tickSimulation();
  const acnPos = worker.trajectoryEngine.getAcnPosition(worker.simTimeS);
  const frame = (worker as any).buildTelemetryFrame(acnPos);
  const acnTel = frame.acn_telemetry;
  assert(acnTel, 'acn_telemetry must exist in telemetry frame');
  assert(Number.isFinite(acnTel.lat_deg), 'ACN lat_deg must be finite');
  assert(Number.isFinite(acnTel.lon_deg), 'ACN lon_deg must be finite');

  const expectedAcnGeo = cartesianToGeodetic(acnTel.pos_x, acnTel.pos_y);
  assert.ok(Math.abs(acnTel.lat_deg - expectedAcnGeo.latDeg) < 1e-12, 'ACN lat_deg matches expected');
  assert.ok(Math.abs(acnTel.lon_deg - expectedAcnGeo.lonDeg) < 1e-12, 'ACN lon_deg matches expected');
  console.log('  -> PASS: All 16 ground nodes and ACN emit verified WGS-84 lat_deg and lon_deg.');

  console.log('\n================================================================================');
  console.log('  ALL 9 GEODETIC COORDINATE MAPPING VERIFICATION SUITES PASSED CLEANLY!');
  console.log('================================================================================');
}

runGeodesyVerification();
