/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Verification Suite 108: Military Tactical GIS, Cartographic Overlays,
 * GeoTIFF DEM & Mission Persistence (SPEC-V3-06)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  geodeticToUtm,
  utmToGeodetic,
  geodeticToMgrs,
  mgrsToGeodetic,
  getUtmZoneNumber,
  getUtmLatitudeBandLetter,
  parseGeoTiffDem,
  escapeXml,
  exportMissionToAtakCotXml,
  exportMissionToKml,
  serializeMissionScenarioJson,
  parseMissionScenarioJson,
  type MissionScenarioV3,
  type TacticalMissionSnapshot,
} from '../core/militaryGisEngine';
import { computeNiceScaleBarLengthM } from '../ui/cartographyRenderer';

console.log('='.repeat(80));
console.log('[SUITE 108] Military Tactical GIS, GeoTIFF DEM & Persistence (V3-06)');
console.log('='.repeat(80));

// ============================================================================
// Gate 1: [MGIS-T1] Exact WGS-84 <-> UTM <-> MGRS Reference Benchmarks
// ============================================================================
console.log('\n[1/5] Verifying [MGIS-T1] Exact WGS-84 <-> UTM <-> MGRS Reference Benchmarks & Round-Trip...');

// 1a. Canonical Equator Anchor: (0.0°N, 3.0°E) on Zone 31 Central Meridian
// Expected: Zone 31, Band N, Easting 500,000m, Northing 0m, Square EA, MGRS: 31N EA 00000 00000
const eqUtm = geodeticToUtm(0.0, 3.0);
assert.strictEqual(eqUtm.zoneNumber, 31, 'Equator (0°, 3°E) must be in Zone 31');
assert.strictEqual(eqUtm.zoneLetter, 'N', 'Equator 0°N must be in Band N');
assert.strictEqual(eqUtm.hemisphere, 'N');
assert.ok(Math.abs(eqUtm.eastingM - 500000.0) < 1e-4, 'Central meridian easting must be exactly 500,000 m');
assert.ok(Math.abs(eqUtm.northingM - 0.0) < 1e-4, 'Equator northing must be exactly 0 m');

const eqMgrs = geodeticToMgrs(0.0, 3.0, 5);
assert.strictEqual(eqMgrs, '31N EA 00000 00000', 'Equator MGRS must be exactly 31N EA 00000 00000');
console.log(`  -> Canonical Equator Anchor (0.0°, 3.0°E) = "${eqMgrs}" (exact!).`);

// 1b. Global Sector Reference Points:
// - Leh/Ladakh: (34.1526°N, 77.5771°E) -> Zone 43S
// - Thar Desert: (26.9157°N, 70.9083°E) -> Zone 42R
// - Norway Exception: (60.0°N, 5.0°E) -> Zone 32V (instead of 31)
// - Sydney (Southern Hemisphere): (-33.8688°S, 151.2093°E) -> Zone 56H
const testPoints = [
  { name: 'Leh/Ladakh (Alpine)', lat: 34.1526, lon: 77.5771, expZone: 43, expBand: 'S' },
  { name: 'Thar Desert (Arid)', lat: 26.9157, lon: 70.9083, expZone: 42, expBand: 'R' },
  { name: 'Bergen (Norway 32V Exception)', lat: 60.0, lon: 5.0, expZone: 32, expBand: 'V' },
  { name: 'Sydney (Southern Hemisphere)', lat: -33.8688, lon: 151.2093, expZone: 56, expBand: 'H' },
  { name: 'Amazon (Tropical Jungle)', lat: -3.4653, lon: -62.2159, expZone: 20, expBand: 'M' },
  { name: 'Arabian Gulf (Maritime)', lat: 25.276987, lon: 55.296249, expZone: 40, expBand: 'R' },
];

for (const tp of testPoints) {
  const utm = geodeticToUtm(tp.lat, tp.lon);
  assert.strictEqual(utm.zoneNumber, tp.expZone, `${tp.name} zone mismatch`);
  assert.strictEqual(utm.zoneLetter, tp.expBand, `${tp.name} band mismatch`);

  // UTM <-> Geodetic round-trip accuracy (< 0.01 m)
  const revGeo = utmToGeodetic(utm.zoneNumber, utm.hemisphere, utm.eastingM, utm.northingM);
  const latErrM = Math.abs(revGeo.latDeg - tp.lat) * 111319.5;
  const lonErrM = Math.abs(revGeo.lonDeg - tp.lon) * (111319.5 * Math.cos((tp.lat * Math.PI) / 180.0));
  const utmRoundTripDistM = Math.hypot(latErrM, lonErrM);
  assert.ok(utmRoundTripDistM < 0.01, `${tp.name} UTM round-trip error (${utmRoundTripDistM.toFixed(4)} m) must be < 0.01 m`);

  // MGRS forward & inverse round-trip accuracy (< 2.0 m at precision 5)
  const mgrs5 = geodeticToMgrs(tp.lat, tp.lon, 5);
  const revMgrsGeo = mgrsToGeodetic(mgrs5);
  const mgrsLatErrM = Math.abs(revMgrsGeo.latDeg - tp.lat) * 111319.5;
  const mgrsLonErrM = Math.abs(revMgrsGeo.lonDeg - tp.lon) * (111319.5 * Math.cos((tp.lat * Math.PI) / 180.0));
  const mgrsRoundTripDistM = Math.hypot(mgrsLatErrM, mgrsLonErrM);
  assert.ok(mgrsRoundTripDistM < 2.0, `${tp.name} MGRS round-trip error (${mgrsRoundTripDistM.toFixed(3)} m) must be < 2.0 m`);

  console.log(`  -> ${tp.name}: ${tp.lat.toFixed(4)}°, ${tp.lon.toFixed(4)}° -> ${mgrs5} (Round-trip err: ${mgrsRoundTripDistM.toFixed(3)} m)`);
}

// 1c. MGRS Precision levels (1..5)
const p1 = geodeticToMgrs(34.1526, 77.5771, 1);
const p2 = geodeticToMgrs(34.1526, 77.5771, 2);
const p3 = geodeticToMgrs(34.1526, 77.5771, 3);
const p4 = geodeticToMgrs(34.1526, 77.5771, 4);
const p5 = geodeticToMgrs(34.1526, 77.5771, 5);

assert.strictEqual(p1.replace(/\s+/g, '').length, 7);  // 43SFR 3 8 (3 digits grid + 2 letter square + 2 digit coord)
assert.strictEqual(p2.replace(/\s+/g, '').length, 9);
assert.strictEqual(p3.replace(/\s+/g, '').length, 11);
assert.strictEqual(p4.replace(/\s+/g, '').length, 13);
assert.strictEqual(p5.replace(/\s+/g, '').length, 15);
console.log('  -> MGRS precision levels 1 through 5 validated.');

// ============================================================================
// Gate 2: [MGIS-T2] Synthetic GeoTIFF DEM Parser (Little & Big Endian)
// ============================================================================
console.log('\n[2/5] Verifying [MGIS-T2] Synthetic GeoTIFF DEM Parser (Little & Big Endian)...');

/**
 * Builds a valid, uncompressed baseline GeoTIFF binary in memory.
 */
function buildSyntheticGeoTiff(options: {
  width: number;
  height: number;
  littleEndian: boolean;
  format: 'float32' | 'int16';
  pixelScale?: [number, number, number];
  tiePoint?: [number, number, number, number, number, number];
  elevationPattern: (r: number, c: number) => number;
}): ArrayBuffer {
  const { width, height, littleEndian, format, pixelScale, tiePoint, elevationPattern } = options;
  const isFloat = format === 'float32';
  const bytesPerSample = isFloat ? 4 : 2;
  const bitsPerSample = isFloat ? 32 : 16;
  const sampleFormat = isFloat ? 3 : 2;

  const numEntries = (pixelScale && tiePoint) ? 10 : 8;
  const headerSize = 8;
  const ifdSize = 2 + numEntries * 12 + 4;
  const arraysOffset = headerSize + ifdSize + (4 - ((headerSize + ifdSize) % 4)) % 4; // 4-byte align

  let arraysSize = 0;
  let pixelScaleOffset = 0;
  let tiePointOffset = 0;
  if (pixelScale && tiePoint) {
    pixelScaleOffset = arraysOffset;
    tiePointOffset = pixelScaleOffset + 24; // 3 * 8 bytes
    arraysSize = 24 + 48; // 3 doubles + 6 doubles = 72 bytes
  }

  const pixelDataOffset = arraysOffset + arraysSize;
  const pixelDataSize = width * height * bytesPerSample;
  const totalBufferSize = pixelDataOffset + pixelDataSize;

  const buffer = new ArrayBuffer(totalBufferSize);
  const view = new DataView(buffer);

  // 1. Header
  view.setUint8(0, littleEndian ? 0x49 : 0x4D);
  view.setUint8(1, littleEndian ? 0x49 : 0x4D);
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, headerSize, littleEndian); // IFD0 offset = 8

  // 2. IFD0
  let cur = headerSize;
  view.setUint16(cur, numEntries, littleEndian);
  cur += 2;

  const writeEntry = (tag: number, type: number, count: number, val: number) => {
    view.setUint16(cur, tag, littleEndian);
    view.setUint16(cur + 2, type, littleEndian);
    view.setUint32(cur + 4, count, littleEndian);
    if (type === 3) {
      view.setUint16(cur + 8, val, littleEndian);
      view.setUint16(cur + 10, 0, littleEndian);
    } else {
      view.setUint32(cur + 8, val, littleEndian);
    }
    cur += 12;
  };

  writeEntry(256, 4, 1, width); // ImageWidth
  writeEntry(257, 4, 1, height); // ImageLength
  writeEntry(258, 3, 1, bitsPerSample); // BitsPerSample
  writeEntry(259, 3, 1, 1); // Compression (1 = uncompressed)
  writeEntry(273, 4, 1, pixelDataOffset); // StripOffsets
  writeEntry(278, 4, 1, height); // RowsPerStrip
  writeEntry(279, 4, 1, pixelDataSize); // StripByteCounts
  writeEntry(339, 3, 1, sampleFormat); // SampleFormat

  if (pixelScale && tiePoint) {
    writeEntry(33550, 12, 3, pixelScaleOffset); // ModelPixelScaleTag
    writeEntry(33922, 12, 6, tiePointOffset); // ModelTiepointTag

    // Write double arrays
    for (let i = 0; i < 3; i++) {
      view.setFloat64(pixelScaleOffset + i * 8, pixelScale[i], littleEndian);
    }
    for (let i = 0; i < 6; i++) {
      view.setFloat64(tiePointOffset + i * 8, tiePoint[i], littleEndian);
    }
  }

  view.setUint32(cur, 0, littleEndian); // Next IFD = 0

  // 3. Pixel Data
  let pIdx = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const val = elevationPattern(r, c);
      const byteOffset = pixelDataOffset + pIdx * bytesPerSample;
      if (isFloat) {
        view.setFloat32(byteOffset, val, littleEndian);
      } else {
        view.setInt16(byteOffset, Math.round(val), littleEndian);
      }
      pIdx++;
    }
  }

  return buffer;
}

// 2a. Test Little-Endian Float32 GeoTIFF
const tiffLeFloat = buildSyntheticGeoTiff({
  width: 4,
  height: 4,
  littleEndian: true,
  format: 'float32',
  pixelScale: [0.01, 0.01, 0],
  tiePoint: [0, 0, 0, 77.0, 34.0, 0], // Tiepoint at lon 77, lat 34
  elevationPattern: (r, c) => 3000.0 + r * 100.0 + c * 25.0,
});

const resLe = parseGeoTiffDem(tiffLeFloat);
assert.strictEqual(resLe.ok, true, 'Little-endian float32 parse must succeed');
assert.strictEqual(resLe.width, 4);
assert.strictEqual(resLe.height, 4);
assert.strictEqual(resLe.bitsPerSample, 32);
assert.strictEqual(resLe.sampleFormat, 3);
assert.strictEqual(resLe.elevationsM?.length, 16);
assert.strictEqual(resLe.minElevationM, 3000.0);
assert.strictEqual(resLe.maxElevationM, 3000.0 + 3 * 100.0 + 3 * 25.0);
assert.ok(resLe.geoBounds !== undefined, 'GeoBounds must be computed from tags');
assert.strictEqual(resLe.geoBounds?.minLonDeg, 77.0);
assert.strictEqual(resLe.geoBounds?.maxLonDeg, 77.04);
console.log('  -> Little-Endian Float32 GeoTIFF parsed with exact elevations & geoBounds.');

// 2b. Test Big-Endian Int16 GeoTIFF
const tiffBeInt = buildSyntheticGeoTiff({
  width: 3,
  height: 3,
  littleEndian: false,
  format: 'int16',
  elevationPattern: (r, c) => 4000 + r * 50 - c * 10,
});

const resBe = parseGeoTiffDem(tiffBeInt);
assert.strictEqual(resBe.ok, true, 'Big-endian int16 parse must succeed');
assert.strictEqual(resBe.width, 3);
assert.strictEqual(resBe.height, 3);
assert.strictEqual(resBe.bitsPerSample, 16);
assert.strictEqual(resBe.elevationsM?.[0], 4000);
console.log('  -> Big-Endian Int16 GeoTIFF parsed successfully.');

// 2c. Corrupted, truncated, and compressed input handling (must return { ok: false } without throwing)
assert.strictEqual(parseGeoTiffDem(new ArrayBuffer(4)).ok, false);
assert.strictEqual(parseGeoTiffDem(new ArrayBuffer(0)).ok, false);

// Invalid magic number
const corruptMagic = new ArrayBuffer(16);
new DataView(corruptMagic).setUint16(0, 0x4949);
new DataView(corruptMagic).setUint16(2, 99); // bad magic
assert.strictEqual(parseGeoTiffDem(corruptMagic).ok, false);

console.log('  -> Malformed & truncated GeoTIFFs safely rejected without throwing.');

// ============================================================================
// Gate 3: [MGIS-T3] Tactical KML 2.2, ATAK CoT XML & Scenario JSON Security
// ============================================================================
console.log('\n[3/5] Verifying [MGIS-T3] Tactical KML 2.2, ATAK CoT XML & Scenario JSON Security...');

// 3a. XML Entity Escaping & Injection Neutralization
const maliciousCallsign = '<script>alert("XSS")</script>&VIPER\'"';
const snapshot: TacticalMissionSnapshot = {
  timestampIso: '2026-11-24T00:00:00.000Z',
  missionTitle: 'Ladakh Sector Air-to-Ground <Shield>',
  entities: [
    {
      id: 'ACN-1',
      callsign: maliciousCallsign,
      role: 'ACN',
      latDeg: 34.1526,
      lonDeg: 77.5771,
      altMslM: 5000.0,
    },
    {
      id: 2,
      callsign: 'SOLDIER-02',
      role: 'SOLDIER',
      latDeg: 34.1200,
      lonDeg: 77.5500,
      altMslM: 3200.0,
    },
  ],
  links: [
    {
      fromId: 'ACN-1',
      toId: 2,
      fromLat: 34.1526,
      fromLon: 77.5771,
      fromAlt: 5000.0,
      toLat: 34.1200,
      toLon: 77.5500,
      toAlt: 3200.0,
      snrDb: 18.2,
      status: 'ACTIVE',
    },
  ],
};

const cotXml = exportMissionToAtakCotXml(snapshot);
assert.ok(cotXml.includes('version="2.0"'), 'CoT must declare version 2.0');
assert.ok(cotXml.includes('type="a-f-A-M-F-Q"'), 'ACN must map to a-f-A-M-F-Q');
assert.ok(cotXml.includes('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;&amp;VIPER&apos;&quot;'), 'Injected script must be fully XML-escaped');
assert.strictEqual(cotXml.includes('<script>'), false, 'Raw script tags must not exist in CoT XML');

const kml = exportMissionToKml(snapshot);
assert.ok(kml.includes('<kml xmlns="http://www.opengis.net/kml/2.2">'));
assert.ok(kml.includes('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'));
assert.strictEqual(kml.includes('<script>'), false, 'Raw script tags must not exist in KML');
console.log('  -> ATAK CoT XML & OGC KML 2.2 verified with strict XML injection protection.');

// 3b. Mission Scenario JSON v3 Round-Trip & Prototype Pollution Protection
const sampleScenario: MissionScenarioV3 = {
  schemaVersion: 'xband-dt-scenario-v3',
  title: 'Kargil Mountain Pass Transit',
  timestamp: '2026-11-24T00:00:00.000Z',
  theater: {
    biomeId: 'alpine_mountain',
    centerLatDeg: 34.5,
    centerLonDeg: 76.5,
  },
  acn: {
    callsign: 'VIPER-01',
    cruiseAltMslM: 5200.0,
    cruiseAirspeedMs: 55.0,
    orbitPattern: 'ellipse_orbit',
    waypoints: [
      { xM: 0, yM: 0, altM: 5200 },
      { xM: 5000, yM: 2000, altM: 5200 },
    ],
  },
  nodes: [
    { id: 1, callsign: 'MCP-HQ', xM: 1000, yM: -500, aglM: 5.0, tacticalPriority: 1 },
    { id: 2, callsign: 'ALPHA-LEAD', xM: 3500, yM: 1200, aglM: 2.5, tacticalPriority: 2 },
  ],
  obstacles: [
    { id: 'obs-1', name: 'Ridge Alpha', type: 'ridge', points: [{ x: 100, y: 100 }, { x: 200, y: 200 }], heightM: 80.0 },
  ],
  rfConfig: {
    carrier_freq_hz: 8.0e9,
    tx_power_dbm: 43.0,
  },
};

const jsonStr = serializeMissionScenarioJson(sampleScenario);
const parseRes = parseMissionScenarioJson(jsonStr);
assert.strictEqual(parseRes.ok, true, 'Valid scenario JSON must parse successfully');
assert.strictEqual(parseRes.scenario?.schemaVersion, 'xband-dt-scenario-v3');
assert.strictEqual(parseRes.scenario?.nodes.length, 2);
assert.strictEqual(parseRes.scenario?.acn.waypoints.length, 2);
assert.strictEqual(parseRes.scenario?.obstacles.length, 1);

// Prototype pollution attack payload
const maliciousJson = '{"schemaVersion":"xband-dt-scenario-v3","__proto__":{"polluted":true},"title":"Hack"}';
const polRes = parseMissionScenarioJson(maliciousJson);
assert.strictEqual(polRes.ok, false, 'Prototype pollution payload must be rejected');
assert.ok(polRes.error?.includes('prototype pollution'), 'Error message must cite prototype pollution');

// Unsupported schema version
const badVerJson = '{"schemaVersion":"xband-dt-scenario-v1","title":"Old"}';
assert.strictEqual(parseMissionScenarioJson(badVerJson).ok, false);
console.log('  -> Mission Scenario JSON v3 validated with prototype pollution neutralization.');

// ============================================================================
// Gate 4: [MGIS-T4] Cartographic Scale Steps & Micro-Benchmark (< 3 µs/call)
// ============================================================================
console.log('\n[4/5] Verifying [MGIS-T4] Cartographic Scale Steps & Micro-Benchmark (< 3 µs/call)...');

// 4a. 1-2-5 scale step selection
const s1 = computeNiceScaleBarLengthM(10.0, 120); // 1200m target -> 1000m (1 km)
assert.strictEqual(s1.stepM, 1000);
assert.strictEqual(s1.labelFull, '1 km');
assert.strictEqual(s1.labelHalf, '500 m');

const s2 = computeNiceScaleBarLengthM(50.0, 120); // 6000m target -> 5000m (5 km)
assert.strictEqual(s2.stepM, 5000);
assert.strictEqual(s2.labelFull, '5 km');

const s3 = computeNiceScaleBarLengthM(1.0, 120); // 120m target -> 100m
assert.strictEqual(s3.stepM, 100);
assert.strictEqual(s3.labelFull, '100 m');
assert.strictEqual(s3.labelHalf, '50 m');
console.log('  -> Dynamic 1-2-5 metric scale bar steps computed correctly.');

// 4b. 10,000 MGRS conversion micro-benchmark (< 3 µs/call budget = < 30 ms total)
const benchIterations = 10000;
const tStart = performance.now();
for (let i = 0; i < benchIterations; i++) {
  // Vary coordinates across sector
  const lat = 34.0 + (i % 100) * 0.01;
  const lon = 76.0 + (i % 100) * 0.01;
  geodeticToMgrs(lat, lon, 5);
}
const elapsedMs = performance.now() - tStart;
const usPerCall = (elapsedMs * 1000.0) / benchIterations;
console.log(`  -> 10,000 geodeticToMgrs executions completed in ${elapsedMs.toFixed(2)} ms (${usPerCall.toFixed(3)} µs/call, Budget: < 3.0 µs/call)`);
assert.ok(usPerCall < 3.0, `geodeticToMgrs execution time (${usPerCall.toFixed(3)} µs/call) must be < 3.0 µs/call`);

// ============================================================================
// Gate 5: [MGIS-T5] UI DOM Elements, Accessibility & Zero-Emoji Audit
// ============================================================================
console.log('\n[5/5] Verifying [MGIS-T5] UI DOM Elements, Accessibility & Zero-Emoji Audit...');

const indexPath = path.resolve(process.cwd(), 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf-8');

const requiredIds = [
  'mission-gis-panel',
  'gis-status-badge',
  'toggle-mgrs-grid',
  'btn-scenario-save-json',
  'scenario-json-file-input',
  'btn-export-kml',
  'btn-export-cot-xml',
  'mission-gis-status',
  'mission-gis-action-status',
];

for (const id of requiredIds) {
  assert.ok(indexHtml.includes(`id="${id}"`), `index.html must contain element with id="${id}"`);
}
console.log(`  -> All ${requiredIds.length} required UI element IDs present in index.html.`);

// Accessibility checks
assert.ok(indexHtml.includes('<label for="toggle-mgrs-grid"'), 'toggle-mgrs-grid must have paired label');
assert.ok(indexHtml.includes('<label for="scenario-json-file-input"'), 'scenario-json-file-input must have paired label');
assert.ok(indexHtml.includes('aria-label="Toggle MGRS 10km grid overlay on 2D tactical radar"'));
assert.ok(indexHtml.includes('aria-label="Load mission scenario JSON file"'));
assert.ok(indexHtml.includes('accept=".hgt,.png,.jpg,.jpeg,.bin,.tif,.tiff"'), 'Terrain upload must support .tif and .tiff');

// Check mission-gis-panel section for zero emojis
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
const panelStart = indexHtml.indexOf('id="mission-gis-panel"');
assert.ok(panelStart > 0);
const panelSection = indexHtml.substring(panelStart - 100, panelStart + 3500);
assert.strictEqual(emojiRegex.test(panelSection), false, 'mission-gis-panel must contain zero emojis');

// Check source files for zero emojis
const gisSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/core/militaryGisEngine.ts'), 'utf-8');
const cartSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/cartographyRenderer.ts'), 'utf-8');
assert.strictEqual(emojiRegex.test(gisSrc), false, 'militaryGisEngine.ts must contain zero emojis');
assert.strictEqual(emojiRegex.test(cartSrc), false, 'cartographyRenderer.ts must contain zero emojis');

// Check no font < 10px
const fontSub10Regex = /font:\s*[^;]*\b[0-9](\.[0-9]+)?px\b/i;
const fontSizeSub10Regex = /font-size:\s*[0-9](\.[0-9]+)?px\b/i;
assert.strictEqual(fontSub10Regex.test(panelSection), false);
assert.strictEqual(fontSizeSub10Regex.test(panelSection), false);
assert.strictEqual(fontSub10Regex.test(cartSrc), false);

console.log('  -> Zero-emoji, accessibility, and font >= 10px compliance verified.');

console.log('\n' + '='.repeat(80));
console.log('SUITE 108 PASSED: Military Tactical GIS & Mission Persistence Fully Verified');
console.log('='.repeat(80));
