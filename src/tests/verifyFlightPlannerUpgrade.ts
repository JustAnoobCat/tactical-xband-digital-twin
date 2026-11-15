import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generateFlightPatternWaypoints,
  evaluateFlightPlanProfile,
  type FlightPatternType,
} from '../core/trajectory';
import { TerrainEngine } from '../core/terrain';
import { validateClosedWaypointPath } from '../core/waypoints';

function close(actual: number, expected: number, tolerance: number, message: string): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: actual ${actual} vs expected ${expected}`);
}

console.log('--- START VERIFICATION: FLIGHT PLANNER UPGRADE (FPU-T1 to FPU-T3) ---');

// ----------------------------------------------------------------------------
// FPU-T1: Aerospace Pattern Generators
// ----------------------------------------------------------------------------
console.log('\n[FPU-T1] Testing Aerospace Flight Pattern Generators...');

const patterns: FlightPatternType[] = [
  'ellipse_orbit',
  'racetrack_hold',
  'figure8_valley',
  'canyon_transit',
];

for (const pattern of patterns) {
  const wps = generateFlightPatternWaypoints(pattern, { cruiseAltM: 5200 });
  assert.ok(Array.isArray(wps), `${pattern} should return an array`);
  assert.ok(wps.length >= 3, `${pattern} should have at least 3 waypoints`);
  const validated = validateClosedWaypointPath(wps);
  assert.equal(validated.length, wps.length, `${pattern} should pass validateClosedWaypointPath`);
  console.log(`  ✓ ${pattern}: generated ${wps.length} valid 3D waypoints`);
}

// 1. Ellipse Orbit: 8 waypoints, closed, configurable altitude
const wpEllipse = generateFlightPatternWaypoints('ellipse_orbit', {
  cruiseAltM: 5500,
  radiusAM: 16000,
  radiusBM: 9000,
});
assert.equal(wpEllipse.length, 8, 'ellipse_orbit must generate exactly 8 waypoints');
for (const wp of wpEllipse) {
  assert.equal(wp.zM, 5500, 'ellipse_orbit waypoints must carry configured cruise altitude');
}
console.log('  ✓ ellipse_orbit: exactly 8 waypoints with configured MSL altitude');

// 2. Racetrack Hold: 8 waypoints, parallel straight segments
const wpRace = generateFlightPatternWaypoints('racetrack_hold', {
  legLengthM: 20000,
  turnRadiusM: 6000,
  rotationDeg: 0,
  cruiseAltM: 5000,
});
assert.equal(wpRace.length, 8, 'racetrack_hold must generate exactly 8 waypoints');

// WP0 -> WP1 is Eastbound straight leg (v1)
const v1x = wpRace[1].xM - wpRace[0].xM;
const v1y = wpRace[1].yM - wpRace[0].yM;
// WP4 -> WP5 is Westbound straight leg (v2)
const v2x = wpRace[5].xM - wpRace[4].xM;
const v2y = wpRace[5].yM - wpRace[4].yM;

// Parallelism: cross-product must be zero (parallel vectors)
const crossProd = Math.abs(v1x * v2y - v1y * v2x);
assert.ok(crossProd < 1e-3, `Racetrack straight legs must be parallel (cross product ${crossProd})`);
// Anti-parallel: dot product must be negative (opposite directions)
const dotProd = v1x * v2x + v1y * v2y;
assert.ok(dotProd < 0, `Racetrack straight legs must run in opposite directions (dot product ${dotProd})`);
console.log('  ✓ racetrack_hold: 8 waypoints with strictly parallel straight legs');

// 3. Figure-8 Valley: 8 waypoints, crosses origin (0, 0), alternating North/South lobes
const wpFig8 = generateFlightPatternWaypoints('figure8_valley', {
  centerXm: 0,
  centerYm: 0,
  radiusAM: 18000,
  radiusBM: 24000,
  cruiseAltM: 5000,
});
assert.equal(wpFig8.length, 8, 'figure8_valley must generate exactly 8 waypoints');

// Origin crossing check: WP0 and WP4 must be at (0, 0)
close(wpFig8[0].xM, 0, 1e-2, 'figure8_valley WP0 must be at origin X');
close(wpFig8[0].yM, 0, 1e-2, 'figure8_valley WP0 must be at origin Y');
close(wpFig8[4].xM, 0, 1e-2, 'figure8_valley WP4 must cross center origin X');
close(wpFig8[4].yM, 0, 1e-2, 'figure8_valley WP4 must cross center origin Y');

// Alternating lobes: WP1 is North (+Y), WP3 is South (-Y), WP5 is North (+Y), WP7 is South (-Y)
assert.ok(wpFig8[1].yM > 0, 'figure8_valley WP1 must be North lobe (+Y)');
assert.ok(wpFig8[3].yM < 0, 'figure8_valley WP3 must be South lobe (-Y)');
assert.ok(wpFig8[5].yM > 0, 'figure8_valley WP5 must alternate back to North lobe (+Y)');
assert.ok(wpFig8[7].yM < 0, 'figure8_valley WP7 must alternate back to South lobe (-Y)');
console.log('  ✓ figure8_valley: crosses center origin (0,0) with alternating North/South lobes');

// 4. Canyon Transit: 6 waypoints, stepped altitudes 4800m -> 5350m -> 4900m
const wpCanyon = generateFlightPatternWaypoints('canyon_transit', { cruiseAltM: 5000 });
assert.equal(wpCanyon.length, 6, 'canyon_transit must generate exactly 6 waypoints');
assert.equal(wpCanyon[0].zM, 4800, 'canyon_transit WP0 must start at 4800m MSL');
assert.equal(wpCanyon[2].zM, 5350, 'canyon_transit WP2 must step up to 5350m MSL (mountain pass)');
assert.equal(wpCanyon[3].zM, 4900, 'canyon_transit WP3 must step down to 4900m MSL (valley corridor)');
console.log('  ✓ canyon_transit: 6 waypoints with stepped altitudes 4800m -> 5350m -> 4900m MSL');

// ----------------------------------------------------------------------------
// FPU-T2: Coordinated-Turn Aerodynamics & CFIT Detection
// ----------------------------------------------------------------------------
console.log('\n[FPU-T2] Testing Coordinated-Turn Aerodynamics & CFIT Detection...');

const terrain = new TerrainEngine({ terrainMode: 'synthetic' });

// 1. Aerodynamic Bank Angle: circular orbit R = 10,000m, V = 50 m/s
// Expected: phi = arctan(V^2 / (g * R)) = arctan(2500 / 98066.5) = arctan(0.0254929) ~= 1.46 deg
import { ACNFlightConfig } from '../core/config';
import { ACNTrajectoryEngine } from '../core/trajectory';

const configCircle = new ACNFlightConfig({
  trajectoryMode: 'ellipse',
  loiterRadiusAM: 10000,
  loiterRadiusBM: 10000,
  loiterRotationDeg: 0,
  loiterSpeedMps: 50,
  altitudeMslM: 6500,
});
const trajCircle = new ACNTrajectoryEngine(configCircle);
const summaryCircle = evaluateFlightPlanProfile(trajCircle, 50.0, terrain);
assert.ok(summaryCircle.totalDistanceKm > 0, 'totalDistanceKm must be positive');
assert.ok(summaryCircle.orbitPeriodS > 0, 'orbitPeriodS must be positive');
assert.equal(summaryCircle.samples.length, 64, 'profile must contain exactly 64 samples');

// Theoretical bank angle for R = 10,000m at V = 50 m/s
const phiTheoDeg = (180.0 / Math.PI) * Math.atan((50.0 * 50.0) / (9.80665 * 10000.0));
close(summaryCircle.peakBankAngleDeg, phiTheoDeg, 0.5, 'peak bank angle must match coordinated turn physics');
console.log(`  ✓ Coordinated bank angle matches physics: computed ${summaryCircle.peakBankAngleDeg.toFixed(2)}° vs theoretical ${phiTheoDeg.toFixed(2)}°`);

// 2. CFIT Detection:
// Safe high altitude (6500m MSL) in Ladakh terrain -> cfitWarningCount === 0
const wpSafe = generateFlightPatternWaypoints('ellipse_orbit', {
  radiusAM: 15000,
  radiusBM: 8000,
  cruiseAltM: 6500,
});
const summarySafe = evaluateFlightPlanProfile(wpSafe, 50.0, terrain);
assert.equal(summarySafe.cfitWarningCount, 0, 'safe altitude 6500m MSL must produce 0 CFIT warnings');
assert.ok(summarySafe.minClearanceAglM >= 300.0, 'safe altitude min clearance must be >= 300m AGL');
console.log(`  ✓ Safe cruise (6500m MSL): cfitWarningCount = 0, min AGL = ${summarySafe.minClearanceAglM.toFixed(0)}m`);

// Low altitude (3500m MSL) in Ladakh mountain terrain -> cfitWarningCount > 0
const wpLow = generateFlightPatternWaypoints('ellipse_orbit', {
  radiusAM: 15000,
  radiusBM: 8000,
  cruiseAltM: 3500,
});
const summaryLow = evaluateFlightPlanProfile(wpLow, 50.0, terrain);
assert.ok(summaryLow.cfitWarningCount > 0, 'low altitude 3500m MSL must flag CFIT warnings in high relief terrain');
assert.ok(summaryLow.minClearanceAglM < 300.0, 'low altitude min clearance must be < 300m AGL');
console.log(`  ✓ Proximity flight (3500m MSL): cfitWarningCount = ${summaryLow.cfitWarningCount}, min AGL = ${summaryLow.minClearanceAglM.toFixed(0)}m`);

// 3. Predicted LoS Coverage
assert.ok(summarySafe.predictedLoSCoveragePct >= 0 && summarySafe.predictedLoSCoveragePct <= 100,
  'predictedLoSCoveragePct must be in [0, 100]');
console.log(`  ✓ Predicted route LoS coverage: ${summarySafe.predictedLoSCoveragePct.toFixed(1)}%`);

// ----------------------------------------------------------------------------
// FPU-T3: DOM & Global Layout Invariance Check
// ----------------------------------------------------------------------------
console.log('\n[FPU-T3] Testing DOM & Global Layout Invariance...');

const htmlPath = resolve(process.cwd(), 'index.html');
const html = readFileSync(htmlPath, 'utf-8');

// Verify #tab-authoring section exists
const authoringIdx = html.indexOf('id="tab-authoring"');
assert.ok(authoringIdx !== -1, '#tab-authoring must exist in index.html');
const authoringEndIdx = html.indexOf('</section>', authoringIdx);
const authoringHtml = html.slice(authoringIdx, authoringEndIdx);

const requiredIds = [
  'fp-vertical-profile-canvas',
  'fp-pattern-select',
  'fp-cruise-alt-input',
  'fp-cruise-speed-input',
  'btn-fp-apply-pattern',
  'fp-min-agl',
  'fp-los-coverage',
  'fp-dist-km',
  'fp-period-s',
  'fp-peak-bank',
  'fp-min-turn-radius',
];

for (const id of requiredIds) {
  assert.ok(
    authoringHtml.includes(`id="${id}"`),
    `#tab-authoring must contain element id="${id}"`
  );
  console.log(`  ✓ Element id="${id}" exists inside #tab-authoring`);
}

// Verify explicit aria-labels on interactive controls
const interactiveIds = [
  'fp-pattern-select',
  'fp-cruise-alt-input',
  'fp-cruise-speed-input',
  'btn-fp-apply-pattern',
  'fp-vertical-profile-canvas',
];

for (const id of interactiveIds) {
  const match = authoringHtml.match(new RegExp(`id="${id}"[^>]*aria-label="([^"]+)"`)) ||
                authoringHtml.match(new RegExp(`aria-label="([^"]+)"[^>]*id="${id}"`));
  assert.ok(match, `Element #${id} must possess explicit aria-label attribute`);
  console.log(`  ✓ Element #${id} has explicit aria-label: "${match[1]}"`);
}

// Verify specification file on disk and linked in README.md
const specRelPath = 'docs/specs/SPEC-FLIGHT-PLANNER-QGROUNDCONTROL-UPGRADE.md';
const specPath = resolve(process.cwd(), specRelPath);
assert.ok(existsSync(specPath), `Specification file must exist on disk: ${specRelPath}`);
console.log(`  ✓ Specification file exists: ${specRelPath}`);

const readmePath = resolve(process.cwd(), 'README.md');
const readme = readFileSync(readmePath, 'utf-8');
assert.ok(
  readme.includes('SPEC-FLIGHT-PLANNER-QGROUNDCONTROL-UPGRADE.md'),
  'README.md Section 7 must link SPEC-FLIGHT-PLANNER-QGROUNDCONTROL-UPGRADE.md'
);
console.log('  ✓ Specification linked in README.md Section 7');

console.log('\n--- ALL FLIGHT PLANNER UPGRADE VERIFICATIONS PASSED (FPU-T1..T3) ---');
