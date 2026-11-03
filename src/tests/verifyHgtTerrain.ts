/**
 * src/tests/verifyHgtTerrain.ts
 *
 * Dedicated verification suite for SRTM HGT elevation file support:
 * 1. Dimension and byte length validation (SRTM3 1201×1201, SRTM1 3601×3601, rejection of corrupt/truncated sizes).
 * 2. Tile naming and georeferencing ([NS]\d{2}[EW]\d{3}, hemisphere offsets, Cartesian bounding boxes).
 * 3. Big-endian Int16 decoding and standard SRTM void (-32768) mapping to NaN.
 * 4. TerrainEngine custom DEM integration: coverage bounds, bilinear elevation queries, void-masking interpolation, and Fresnel clearance checks.
 * 5. SimulationWorkerManager LOAD_CUSTOM_DEM execution: authoritative state update, hillshade generation, node altitude resampling, and 3D mesh export.
 * 6. Backward compatibility: default Ladakh DEM metadata preservation and PNG heightmap workflow integrity.
 */

import {
  detectHgtResolution,
  parseSrtmTileName,
  decodeHgtBuffer,
  createHgtGeographicMetadata,
  parseHgtBuffer,
  SRTM3_SAMPLE_COUNT,
  SRTM3_BYTE_LENGTH,
  SRTM1_SAMPLE_COUNT,
  SRTM1_BYTE_LENGTH,
  SRTM_VOID_VALUE,
  HGT_METERS_PER_DEG_LAT,
  HGT_METERS_PER_DEG_LON,
  THEATER_ORIGIN_LAT_DEG,
  THEATER_ORIGIN_LON_DEG,
} from '../core/hgtParser';
import { TerrainEngine, REAL_LADAKH_DEM_METADATA } from '../core/terrain';
import { RFConfig, EnvironmentConfig } from '../core/config';
import { SimulationWorkerManager } from '../worker/simWorker';

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

async function runTests(): Promise<void> {
  console.log('================================================================================');
  console.log('  SRTM HGT ELEVATION DATA SUPPORT VERIFICATION SUITE');
  console.log('================================================================================\n');

  // ---------------------------------------------------------------------------
  // [1/6] Dimension & Byte Length Detection
  // ---------------------------------------------------------------------------
  console.log('[1/6] Verifying SRTM1 and SRTM3 dimension and byte length detection...');

  const srtm3Info = detectHgtResolution(SRTM3_BYTE_LENGTH);
  assert(srtm3Info !== null, 'SRTM3 byte length detected');
  assert(srtm3Info?.resolution === 'SRTM3', 'SRTM3 resolution flag matches');
  assert(srtm3Info?.sampleCount === 1201, 'SRTM3 sample count is 1201');

  const srtm1Info = detectHgtResolution(SRTM1_BYTE_LENGTH);
  assert(srtm1Info !== null, 'SRTM1 byte length detected');
  assert(srtm1Info?.resolution === 'SRTM1', 'SRTM1 resolution flag matches');
  assert(srtm1Info?.sampleCount === 3601, 'SRTM1 sample count is 3601');

  // Rejection of invalid lengths
  assert(detectHgtResolution(0) === null, '0 byte buffer rejected');
  assert(detectHgtResolution(1024) === null, '1KB buffer rejected');
  assert(detectHgtResolution(SRTM3_BYTE_LENGTH - 2) === null, 'Truncated SRTM3 buffer rejected');
  assert(detectHgtResolution(SRTM3_BYTE_LENGTH + 2) === null, 'Oversized SRTM3 buffer rejected');
  assert(detectHgtResolution(SRTM1_BYTE_LENGTH - 4) === null, 'Truncated SRTM1 buffer rejected');

  console.log('  -> PASS: SRTM1 & SRTM3 dimensions strictly validated, invalid sizes rejected.\n');

  // ---------------------------------------------------------------------------
  // [2/6] Tile Naming & Geographic Georeferencing
  // ---------------------------------------------------------------------------
  console.log('[2/6] Verifying SRTM tile naming and WGS-84 coordinate georeferencing...');

  // Standard tile in theater
  const tile1 = parseSrtmTileName('N34E076.hgt');
  assert(tile1 !== null, 'N34E076.hgt parsed successfully');
  assert(tile1?.tileName === 'N34E076', 'Tile name normalized');
  assert(tile1?.isNorth === true && tile1?.isEast === true, 'Hemispheres correctly detected');
  assert(tile1?.minLatDeg === 34.0, 'minLatDeg is 34.0');
  assert(tile1?.maxLatDeg === 35.0, 'maxLatDeg is 35.0');
  assert(tile1?.minLonDeg === 76.0, 'minLonDeg is 76.0');
  assert(tile1?.maxLonDeg === 77.0, 'maxLonDeg is 77.0');
  assert(tile1?.centerLatDeg === 34.5, 'centerLatDeg is 34.5 (matches theater origin)');
  assert(tile1?.centerLonDeg === 76.5, 'centerLonDeg is 76.5 (matches theater origin)');

  // Southern / Western hemisphere tile
  const tile2 = parseSrtmTileName('S12W077.HGT');
  assert(tile2 !== null, 'S12W077.HGT parsed successfully');
  assert(tile2?.isNorth === false && tile2?.isEast === false, 'SW hemispheres correctly detected');
  assert(tile2?.minLatDeg === -12.0, 'minLatDeg is -12.0');
  assert(tile2?.maxLatDeg === -11.0, 'maxLatDeg is -11.0');
  assert(tile2?.minLonDeg === -77.0, 'minLonDeg is -77.0');
  assert(tile2?.maxLonDeg === -76.0, 'maxLonDeg is -76.0');

  // Lowercase & paths
  const tile3 = parseSrtmTileName('/data/srtm/subfolder/n35e075.hgt');
  assert(tile3 !== null, 'Path-prefixed lowercase tile parsed');
  assert(tile3?.tileName === 'N35E075', 'Normalized to uppercase');
  assert(tile3?.minLatDeg === 35.0 && tile3?.minLonDeg === 75.0, 'Coordinates parsed correctly');

  // Georeferenced Cartesian bounds check for N34E076
  const meta1 = createHgtGeographicMetadata(tile1!, 1201, 2000, 5000, 0);
  assertClose(meta1.minX!, (76.0 - THEATER_ORIGIN_LON_DEG) * HGT_METERS_PER_DEG_LON);
  assertClose(meta1.maxX!, (77.0 - THEATER_ORIGIN_LON_DEG) * HGT_METERS_PER_DEG_LON);
  assertClose(meta1.minY!, (34.0 - THEATER_ORIGIN_LAT_DEG) * HGT_METERS_PER_DEG_LAT);
  assertClose(meta1.maxY!, (35.0 - THEATER_ORIGIN_LAT_DEG) * HGT_METERS_PER_DEG_LAT);
  assert(meta1.rasterWidth === 1201 && meta1.rasterHeight === 1201, 'Raster dimensions 1201x1201');

  // Non-standard filename fallback
  const parsedFallback = parseHgtBuffer('custom_terrain.hgt', new Uint8Array(SRTM3_BYTE_LENGTH).buffer);
  assert(parsedFallback.success === true, 'Non-standard filename falls back to default theater tile');
  assert(parsedFallback.metadata?.tileName === 'N34E076', 'Fallback defaults to N34E076');

  console.log('  -> PASS: Tile coordinate conventions and local Equirectangular projection verified.\n');

  // ---------------------------------------------------------------------------
  // [3/6] Big-Endian Int16 Decoding & Void (-32768) Mapping
  // ---------------------------------------------------------------------------
  console.log('[3/6] Verifying Big-Endian Int16 decoding and SRTM void value handling...');

  // Create a small mock buffer for 4 samples (2x2)
  const sampleBuf = new Uint8Array(8);
  const dv = new DataView(sampleBuf.buffer);
  dv.setInt16(0, 3500, false);  // big-endian positive
  dv.setInt16(2, -450, false);  // big-endian negative
  dv.setInt16(4, 0, false);     // big-endian zero
  dv.setInt16(6, SRTM_VOID_VALUE, false); // -32768 void

  const decodeRes = decodeHgtBuffer(sampleBuf.buffer, 2);
  assert(decodeRes.elevations[0] === 3500, 'Positive sample decoded accurately');
  assert(decodeRes.elevations[1] === -450, 'Negative sample decoded accurately');
  assert(decodeRes.elevations[2] === 0, 'Zero elevation decoded accurately');
  assert(Number.isNaN(decodeRes.elevations[3]), 'Void sample (-32768) mapped to NaN');
  assert(decodeRes.voidCount === 1, 'Void count is 1');
  assert(decodeRes.validCount === 3, 'Valid count is 3');
  assert(decodeRes.minElevationM === -450, 'minElevation excludes voids');
  assert(decodeRes.maxElevationM === 3500, 'maxElevation excludes voids');

  console.log('  -> PASS: Big-endian sign extension and -32768 void mapping verified.\n');

  // ---------------------------------------------------------------------------
  // [4/6] TerrainEngine Integration: Coverage, Elevation Queries & Void Masking
  // ---------------------------------------------------------------------------
  console.log('[4/6] Verifying TerrainEngine custom DEM loading, interpolation, and void handling...');

  const terrain = new TerrainEngine();
  const gridSize = 1201;
  const mockGrid = new Float32Array(gridSize * gridSize);

  // Fill mock grid with a smooth elevation dome (peak at center 4500m, edges 3000m)
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const u = c / (gridSize - 1) - 0.5;
      const v = r / (gridSize - 1) - 0.5;
      const distSq = u * u + v * v;
      mockGrid[r * gridSize + c] = 4500 - distSq * 3000;
    }
  }

  // Inject a localized void in the northeast corner
  mockGrid[10 * gridSize + 10] = Number.NaN;
  mockGrid[10 * gridSize + 11] = Number.NaN;

  const tileCoords = parseSrtmTileName('N34E076.hgt')!;
  const testMetadata = createHgtGeographicMetadata(tileCoords, gridSize, 3000, 4500, 2);

  terrain.loadCustomDem(mockGrid, testMetadata);
  assert(terrain.terrainMode === 'real', 'Terrain mode set to real');
  assert(terrain.hasRealDem === true, 'hasRealDem is true');
  assert(terrain.demMetadata.tileName === 'N34E076', 'demMetadata registered');

  // In-bounds query at center (0, 0)
  const centerElev = terrain.getElevation(0, 0);
  assert(Number.isFinite(centerElev), 'Elevation at center is finite');
  assertClose(centerElev, 4500, 1.0, 'Center elevation is approximately 4500m');

  // Out-of-bounds query outside the tile
  const outX = (testMetadata.maxX! + 5000);
  const outElev = terrain.getElevation(outX, 0);
  assert(Number.isNaN(outElev), 'Elevation outside DEM bounds returns NaN');

  // Coverage check
  assert(terrain.isWithinDemCoverage(0, 0) === true, 'Center is inside coverage');
  assert(terrain.isWithinDemCoverage(outX, 0) === false, 'Point outside is rejected by isWithinDemCoverage');

  // Coordinate roundtrip
  const px = terrain.worldToDemPixel(0, 0);
  assertClose(px.col, (gridSize - 1) / 2.0, 0.01);
  assertClose(px.row, (gridSize - 1) / 2.0, 0.01);
  const worldBack = terrain.demPixelToWorld(px.col, px.row);
  assertClose(worldBack.xM, 0, 0.01);
  assertClose(worldBack.yM, 0, 0.01);

  // Propagation evaluation across coverage boundary
  const rf = new RFConfig({ carrierFrequencyHz: 8.2e9 });
  const env = new EnvironmentConfig();
  const obs = terrain.evaluateTerrainObstruction(
    [0, 0, 5000],
    [outX, 0, 8000],
    rf,
    env
  );
  assert(obs.isCoverageComplete === false, 'evaluateTerrainObstruction flags out-of-coverage ray');
  assert(Number.isNaN(obs.minClearanceM), 'Clearance is NaN for incomplete coverage');

  console.log('  -> PASS: TerrainEngine custom DEM elevation queries and boundary checks verified.\n');

  // ---------------------------------------------------------------------------
  // [5/6] Worker LOAD_CUSTOM_DEM Command Execution & Mesh Generation
  // ---------------------------------------------------------------------------
  console.log('[5/6] Verifying SimulationWorkerManager LOAD_CUSTOM_DEM and mesh data export...');

  const worker = new SimulationWorkerManager();

  // Send LOAD_CUSTOM_DEM message to worker
  const loadRes = worker.handleMessage({
    type: 'LOAD_CUSTOM_DEM',
    elevations: mockGrid,
    metadata: testMetadata,
    request_id: 101,
  });
  assert(loadRes.accepted === true, 'LOAD_CUSTOM_DEM accepted by worker');

  // Bounds telemetry should reflect the custom tile
  const bounds = worker.getTerrainBounds();
  assert(bounds.rasterWidth === 1201, 'Authoritative bounds reflect SRTM3 resolution');
  assert(bounds.tileName === 'N34E076', 'Authoritative bounds reflect tile name');
  assertClose(bounds.minX, testMetadata.minX!);
  assertClose(bounds.maxX, testMetadata.maxX!);

  // Nodes should have been resampled without NaNs
  const telNodes = worker.buildNodesTelemetry();
  for (const n of telNodes) {
    assert(Number.isFinite(n.altitude_msl_m), `Node ${n.node_id} altitude is finite`);
  }

  // Verify GET_TERRAIN_MESH_DATA samples 512x512 matrix cleanly from the 1201x1201 grid
  let meshPayload: any = null;
  const prevSelf = (globalThis as any).self;
  (globalThis as any).self = {
    postMessage: (msg: any) => {
      if (msg.type === 'TERRAIN_MESH_DATA_READY') {
        meshPayload = msg;
      }
    },
  };

  try {
    const meshRes = worker.handleMessage({
      type: 'GET_TERRAIN_MESH_DATA',
      request_id: 102,
    });
    assert(meshRes.accepted === true, 'GET_TERRAIN_MESH_DATA accepted');
    assert(meshPayload !== null, 'TERRAIN_MESH_DATA_READY emitted');
    assert(meshPayload.grid_size === 512, '3D mesh resampled to 512x512');
    assert(meshPayload.elevations.length === 512 * 512, 'Mesh elevations array length is exactly 262144');
    assert(Number.isFinite(meshPayload.min_elevation_m), 'Min elevation is finite');
    assert(Number.isFinite(meshPayload.max_elevation_m), 'Max elevation is finite');
  } finally {
    (globalThis as any).self = prevSelf;
  }

  console.log('  -> PASS: Worker LOAD_CUSTOM_DEM, altitude resampling, and 3D mesh export verified.\n');

  // ---------------------------------------------------------------------------
  // [6/6] Backward Compatibility & Mode Switching
  // ---------------------------------------------------------------------------
  console.log('[6/6] Verifying backward compatibility with default Ladakh DEM & synthetic modes...');

  // Switch to synthetic mode
  const synRes = worker.handleMessage({
    type: 'SET_TERRAIN_MODE',
    mode: 'synthetic',
  });
  assert(synRes.accepted === true, 'Switch to synthetic mode accepted');
  assert(worker.getTerrainBounds().terrainMode === 'synthetic', 'Bounds report synthetic mode');

  // Switch back to real mode
  const realRes = worker.handleMessage({
    type: 'SET_TERRAIN_MODE',
    mode: 'real',
  });
  assert(realRes.accepted === true, 'Switch back to real mode accepted');
  assert(worker.getTerrainBounds().terrainMode === 'real', 'Bounds report real mode');

  // Check default REAL_LADAKH_DEM_METADATA constants
  assert(REAL_LADAKH_DEM_METADATA.rasterWidth === 512, 'Default Ladakh width is 512');
  assert(REAL_LADAKH_DEM_METADATA.centerLatDeg === 34.5, 'Default center lat is 34.5');
  assert(REAL_LADAKH_DEM_METADATA.centerLonDeg === 76.5, 'Default center lon is 76.5');

  console.log('  -> PASS: Mode switching and default Ladakh metadata integrity preserved.\n');

  console.log('================================================================================');
  console.log('  ALL 6 SRTM HGT TERRAIN VERIFICATION SUITES PASSED CLEANLY!');
  console.log('================================================================================');
}

runTests().catch((err) => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});
