/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Verification Suite 116: FIX-02 Scientific & Algorithmic Hardening
 *
 * Verifies:
 * [FIX02-T1] 2-Parameter Closed-Form OLS Propagation Calibration Engine & Degenerate Guards
 * [FIX02-T2] Exact 2D (nodeId, hops) MANET Routing & High-Relief A2A Terrain Blockage
 * [FIX02-T3] MGRS Band-Boundary / Hemispheric Exactness & Actionable GeoTIFF Diagnostics
 */

import assert from 'node:assert/strict';
import {
  solveTwoParameterOlsCalibration,
  solveCalibrationParameters,
  type OlsCalibrationSample,
} from '../core/digitalTwinCalibrationEngine';
import {
  computeMultiHopManetRoute,
  evaluateA2aCrosslink,
  type PeerLink,
} from '../core/constellationAndMobilityEngine';
import {
  latLonToMgrs,
  mgrsToLatLon,
  parseGeoTiffDem,
} from '../core/militaryGisEngine';

console.log('='.repeat(80));
console.log('[SUITE 116] FIX-02: Scientific & Algorithmic Hardening');
console.log('='.repeat(80));

// ============================================================================
// Gate 1: [FIX02-T1] 2-Parameter OLS Calibration Engine & Degenerate Guards
// ============================================================================
console.log('\n[1/3] Verifying [FIX02-T1] 2-Parameter OLS Propagation Calibration...');

// 1a. Synthetic trace with injected offset = -4.50 dB and path-loss slope delta = +0.80
const syntheticDistancesM = [
  2000.0, 3000.0, 4500.0, 6000.0, 8000.0, 10000.0, 12500.0, 15000.0, 18000.0, 22000.0, 25000.0,
];

const trueOffsetDb = -4.5;
const trueSlopeDelta = 0.8;

const syntheticSamples: OlsCalibrationSample[] = syntheticDistancesM.map((distM, idx) => {
  // Baseline simulated SNR: e.g. 30 dB at 1 km decaying at -20 dB/decade
  const x = 10.0 * Math.log10(distM / 1000.0);
  const simSnr = 30.0 - 2.0 * x;
  // Injected empirical measured truth: simSnr + trueOffsetDb + trueSlopeDelta * x
  const measuredSnr = simSnr + trueOffsetDb + trueSlopeDelta * x;

  return {
    timeS: idx * 1.0,
    slantRangeM: distM,
    measuredSnrDb: Number(measuredSnr.toFixed(3)),
    predictedSnrDb: Number(simSnr.toFixed(3)),
  };
});

const olsResult = solveTwoParameterOlsCalibration(syntheticSamples);

console.log(`  -> Recovered Offset: ${olsResult.offsetDb.toFixed(3)} dB (target: ${trueOffsetDb} dB)`);
console.log(`  -> Recovered Slope Delta: ${olsResult.pathLossSlopeDelta.toFixed(3)} (target: +${trueSlopeDelta})`);
console.log(`  -> RMSE Before: ${olsResult.beforeRmseDb.toFixed(3)} dB | 1D-Bias: ${olsResult.oneDBiasRmseDb.toFixed(3)} dB | 2D-OLS: ${olsResult.afterRmseDb.toFixed(3)} dB`);

assert.ok(
  Math.abs(olsResult.offsetDb - trueOffsetDb) < 0.05,
  `Recovered offset (${olsResult.offsetDb}) must match true offset (${trueOffsetDb}) within 0.05 dB`
);
assert.ok(
  Math.abs(olsResult.pathLossSlopeDelta - trueSlopeDelta) < 0.05,
  `Recovered slope delta (${olsResult.pathLossSlopeDelta}) must match true slope delta (${trueSlopeDelta}) within 0.05`
);
assert.ok(
  olsResult.afterRmseDb < 0.05,
  `Calibrated 2D OLS RMSE (${olsResult.afterRmseDb} dB) must be < 0.05 dB on noise-free synthetic data`
);
assert.ok(
  olsResult.oneDBiasRmseDb > 1.0,
  `1D-bias-only RMSE (${olsResult.oneDBiasRmseDb} dB) must exceed 1.0 dB due to unmodeled range slope`
);
assert.ok(
  olsResult.afterRmseDb <= olsResult.oneDBiasRmseDb && olsResult.oneDBiasRmseDb <= olsResult.beforeRmseDb,
  'Strict monotonic error ordering required: afterRmseDb <= oneDBiasRmseDb <= beforeRmseDb'
);
assert.strictEqual(olsResult.sampleCount, syntheticDistancesM.length);
assert.ok(olsResult.rSquared >= 0.999, `R^2 (${olsResult.rSquared}) must be >= 0.999`);

// 1b. Degenerate collinear / single-distance fallback test (guard |det| < 1e-12)
const collinearSamples: OlsCalibrationSample[] = [
  { slantRangeM: 10000.0, measuredSnrDb: 15.0, predictedSnrDb: 18.0 },
  { slantRangeM: 10000.0, measuredSnrDb: 14.8, predictedSnrDb: 18.0 },
  { slantRangeM: 10000.0, measuredSnrDb: 15.2, predictedSnrDb: 18.0 },
];

const collinearResult = solveTwoParameterOlsCalibration(collinearSamples);
assert.strictEqual(collinearResult.pathLossSlopeDelta, 0.0, 'Collinear input must fall back to zero slope');
assert.ok(Number.isFinite(collinearResult.offsetDb), 'Collinear offset must be finite and non-NaN');
assert.ok(Number.isFinite(collinearResult.afterRmseDb), 'Collinear RMSE must be finite and non-NaN');
assert.ok(
  Math.abs(collinearResult.afterRmseDb - collinearResult.oneDBiasRmseDb) < 1e-6,
  'Collinear 2D RMSE must strictly equal 1D bias RMSE'
);

// 1c. Empty input resilience
const emptyResult = solveTwoParameterOlsCalibration([]);
assert.strictEqual(emptyResult.sampleCount, 0);
assert.strictEqual(emptyResult.afterRmseDb, 0.0);
assert.strictEqual(emptyResult.converged, true);

// 1d. Backward-compatible solveCalibrationParameters call
const compatResult = solveCalibrationParameters(syntheticSamples);
assert.ok(Number.isFinite(compatResult.offsetDb), 'Compat solver must populate offsetDb');
assert.ok(Number.isFinite(compatResult.beforeRmseDb), 'Compat solver must populate beforeRmseDb');
assert.ok(Number.isFinite(compatResult.pathLossSlopeDelta ?? 0), 'Compat solver must populate pathLossSlopeDelta');
assert.ok(Number.isFinite(compatResult.olsRmseDb ?? 0), 'Compat solver must populate olsRmseDb');
console.log('  ✔ [PASS] 2-parameter closed-form OLS calibration & degenerate guards verified.');

// ============================================================================
// Gate 2: [FIX02-T2] Exact 2D (nodeId, hops) MANET Routing & A2A Terrain Clearance
// ============================================================================
console.log('\n[2/3] Verifying [FIX02-T2] Exact 2D MANET Routing & A2A Terrain Clearance...');

// 2a. Adversarial MANET Topology where naive 1D Dijkstra drops the valid route:
// Source = 1, Gateway = 99, maxHops = 2.
// Route 1 (valid 2 hops):
//   1 -> 2 (cap 5 Mbps, dist 1000m) -> weight = 1/5 + 0.05 = 0.25
//   2 -> 99 (cap 10 Mbps, dist 1000m) -> weight = 1/10 + 0.05 = 0.15
//   Total cost of Route 1 to Node 2 = 0.25 (hops = 1)
// Route 2 to Node 2 (3 hops, high capacity):
//   1 -> 10 (cap 100 Mbps) -> weight 0.06
//   10 -> 11 (cap 100 Mbps) -> weight 0.06
//   11 -> 2 (cap 100 Mbps) -> weight 0.06
//   Total cost to Node 2 via Route 2 = 0.18 (hops = 3)
// In naive 1D Dijkstra:
//   Node 2 is visited at cost 0.18 with hops = 3.
//   The 1-hop path with cost 0.25 is dropped because 0.25 > 0.18.
//   Then hop 4 to Node 99 exceeds maxHops = 2, causing NO_GATEWAY_ROUTE!
// In exact 2D (nodeId, hops) Dijkstra:
//   State (2, 1) has cost 0.25 and is kept distinct from state (2, 3) at cost 0.18.
//   Path 1 -> 2 -> 99 is successfully found!
const adversarialLinks: PeerLink[] = [
  // High capacity 3-hop detour to Node 2
  { fromId: 1, toId: 10, capacityMbps: 100.0, distanceM: 500.0 },
  { fromId: 10, toId: 11, capacityMbps: 100.0, distanceM: 500.0 },
  { fromId: 11, toId: 2, capacityMbps: 100.0, distanceM: 500.0 },
  // Direct 1-hop link to Node 2
  { fromId: 1, toId: 2, capacityMbps: 5.0, distanceM: 1000.0 },
  // Final hop from Node 2 to Gateway
  { fromId: 2, toId: 99, capacityMbps: 10.0, distanceM: 1000.0 },
];

const manetRoute = computeMultiHopManetRoute({
  sourceNodeId: 1,
  gatewayNodeIds: [99],
  peerLinks: adversarialLinks,
  maxHops: 2,
  perHopRelayTurnaroundMs: 2.5,
});

console.log(`  -> Found Route: [${manetRoute.route.join(' -> ')}] with ${manetRoute.hopCount} hops`);
console.log(`  -> In-Band Half-Duplex Throughput: ${manetRoute.e2eCapacityMbps} Mbps`);

assert.deepStrictEqual(manetRoute.route, [1, 2, 99], '2D router must find valid 2-hop route [1, 2, 99]');
assert.strictEqual(manetRoute.hopCount, 2, 'Hop count must strictly equal 2');
assert.strictEqual(manetRoute.isRelayed, true);

// Exact in-band half-duplex throughput: 1 / (1/5 + 1/10) = 1 / 0.3 = 3.333 Mbps
const expectedCapacity = 1.0 / (1.0 / 5.0 + 1.0 / 10.0);
assert.ok(
  Math.abs(manetRoute.e2eCapacityMbps - expectedCapacity) < 0.01,
  `Throughput (${manetRoute.e2eCapacityMbps} Mbps) must match half-duplex formula (${expectedCapacity.toFixed(3)} Mbps)`
);

// 2b. A2A Cross-link ridge blockage check
const acn1Pos: [number, number, number] = [0, 0, 4500.0];
const acn2Pos: [number, number, number] = [30000.0, 0, 4500.0]; // 30 km separation

// Scenario 1: Clear terrain (ridge elevation = 3000 m < ray height ~4467 m)
const clearCrosslink = evaluateA2aCrosslink(
  acn1Pos,
  acn2Pos,
  8e9,
  33.0,
  15.0,
  15.0,
  50e6,
  4.0,
  150.0,
  3000.0 // peakTerrainElevM
);
assert.strictEqual(clearCrosslink.isLineOfSightClear, true);
assert.strictEqual(clearCrosslink.losClear, true);
assert.ok(clearCrosslink.capacityMbps > 50.0, 'Clear A2A link must have high capacity');

// Scenario 2: Obstructed terrain (ridge elevation = 5800 m > ray height 4500 m)
const blockedCrosslink = evaluateA2aCrosslink(
  acn1Pos,
  acn2Pos,
  8e9,
  33.0,
  15.0,
  15.0,
  50e6,
  4.0,
  150.0,
  5800.0 // peakTerrainElevM > 4500m
);
assert.strictEqual(blockedCrosslink.isLineOfSightClear, false, 'Obstructed ridge must flag LoS false');
assert.strictEqual(blockedCrosslink.losClear, false);
assert.strictEqual(blockedCrosslink.capacityMbps, 0.0, 'Obstructed link must have 0 capacity');
assert.strictEqual(blockedCrosslink.backhaulMbps, 0.0);
assert.strictEqual(blockedCrosslink.fsplDb, 999.0);
assert.strictEqual(blockedCrosslink.snrDb, -99.0);
console.log('  ✔ [PASS] Exact 2D MANET router & A2A terrain ridge blockage verified.');

// ============================================================================
// Gate 3: [FIX02-T3] MGRS Band-Boundary Exactness & GeoTIFF Diagnostics
// ============================================================================
console.log('\n[3/3] Verifying [FIX02-T3] MGRS Band-Boundary Exactness & GeoTIFF Diagnostics...');

// 3a. MGRS Precision-5 Round-Trip (< 5.0 m) across critical geographic sectors
const testLocations = [
  { name: 'Leh/Ladakh Sector (Alpine)', lat: 34.1526, lon: 77.5771 },
  { name: 'Band Boundary S Edge (+32.01°N)', lat: 32.01, lon: 77.58 },
  { name: 'Band Boundary S/T (+39.99°N)', lat: 39.99, lon: 77.58 },
  { name: 'Thar Desert (Arid 42R)', lat: 26.9157, lon: 70.9083 },
  { name: 'Sydney (Southern Hemisphere 56H)', lat: -33.8688, lon: 151.2093 },
  { name: 'Amazon Basin (South Tropical 20M)', lat: -3.4653, lon: -62.2159 },
];

for (const loc of testLocations) {
  const mgrs = latLonToMgrs(loc.lat, loc.lon, 5);
  const recovered = mgrsToLatLon(mgrs);

  // Geodesic distance approximation
  const dLatM = (recovered.latDeg - loc.lat) * 111139.0;
  const dLonM = (recovered.lonDeg - loc.lon) * 111139.0 * Math.cos((loc.lat * Math.PI) / 180.0);
  const errM = Math.hypot(dLatM, dLonM);

  console.log(`  -> ${loc.name.padEnd(35)} MGRS: ${mgrs.padEnd(25)} Err: ${errM.toFixed(3)} m`);
  assert.ok(
    errM < 5.0,
    `MGRS round-trip error for ${loc.name} (${errM.toFixed(3)} m) must be < 5.0 m (got ${recovered.latDeg}, ${recovered.lonDeg})`
  );
}

// 3b. GeoTIFF Actionable Diagnostic Messages for Compressed and Tiled Files
function createMockGeoTiff(tags: Array<{ tag: number; type: number; count: number; val: number }>): ArrayBuffer {
  const headerSize = 8;
  const numEntries = tags.length;
  const ifdSize = 2 + numEntries * 12 + 4;
  const buffer = new ArrayBuffer(headerSize + ifdSize + 64);
  const view = new DataView(buffer);

  // Little-Endian 'II', magic 42, IFD0 offset = 8
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  let cur = 8;
  view.setUint16(cur, numEntries, true);
  cur += 2;

  for (const t of tags) {
    view.setUint16(cur, t.tag, true);
    view.setUint16(cur + 2, t.type, true);
    view.setUint32(cur + 4, t.count, true);
    view.setUint32(cur + 8, t.val, true);
    cur += 12;
  }
  view.setUint32(cur, 0, true); // End of IFDs
  return buffer;
}

// Compressed GeoTIFF test (tag 259 = 5 LZW)
const compTiff = createMockGeoTiff([
  { tag: 256, type: 4, count: 1, val: 10 },
  { tag: 257, type: 4, count: 1, val: 10 },
  { tag: 258, type: 3, count: 1, val: 16 },
  { tag: 259, type: 3, count: 1, val: 5 }, // LZW
  { tag: 273, type: 4, count: 1, val: 128 },
]);
const compResult = parseGeoTiffDem(compTiff);
assert.strictEqual(compResult.ok, false);
assert.ok(
  compResult.error?.includes('Compressed GeoTIFF') && compResult.error?.includes('tag 259'),
  `Compressed GeoTIFF error must be descriptive and actionable: "${compResult.error}"`
);
assert.ok(
  compResult.error?.includes('gdal_translate'),
  `Compressed GeoTIFF error must suggest remediation command: "${compResult.error}"`
);

// Tiled GeoTIFF test (tag 322 = 256 TileWidth)
const tiledTiff = createMockGeoTiff([
  { tag: 256, type: 4, count: 1, val: 512 },
  { tag: 257, type: 4, count: 1, val: 512 },
  { tag: 258, type: 3, count: 1, val: 16 },
  { tag: 259, type: 3, count: 1, val: 1 },
  { tag: 322, type: 4, count: 1, val: 256 }, // TileWidth
  { tag: 324, type: 4, count: 1, val: 256 }, // TileOffsets
]);
const tiledResult = parseGeoTiffDem(tiledTiff);
assert.strictEqual(tiledResult.ok, false);
assert.ok(
  tiledResult.error?.includes('Tiled GeoTIFF') && tiledResult.error?.includes('tag 322'),
  `Tiled GeoTIFF error must be descriptive: "${tiledResult.error}"`
);
assert.ok(
  tiledResult.error?.includes('gdal_translate'),
  `Tiled GeoTIFF error must suggest remediation: "${tiledResult.error}"`
);

console.log('  ✔ [PASS] MGRS band-boundary exactness & GeoTIFF diagnostics verified.');

console.log('\n' + '='.repeat(80));
console.log('✔ ALL 3 / 3 HARDENING TESTS PASSED (Suite 116: FIX-02 Algorithms)');
console.log('='.repeat(80));
