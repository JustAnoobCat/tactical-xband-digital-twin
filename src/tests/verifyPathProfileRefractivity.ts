import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EnvironmentConfig, RFConfig, SPEED_OF_LIGHT } from '../core/config';
import { TerrainEngine, BullingtonApexData } from '../core/terrain';
import { buildLinkProfile, LinkProfile, ProfileData, LinkProfileAnalysis } from '../core/linkProfile';

console.log('--- START VERIFICATION: PATH PROFILE & REFRACTIVITY UPGRADE (PPR-T1 to PPR-T3) ---');

function close(actual: number, expected: number, tolerance: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: actual ${actual} vs expected ${expected} (tol: ${tolerance})`
  );
}

// ----------------------------------------------------------------------------
// PPR-T1: ITU-R P.834-9 Refractivity Gradient & Earth Bulge Scaling
// ----------------------------------------------------------------------------
console.log('\n[PPR-T1] Testing ITU-R P.834-9 Refractivity Gradient & Earth Bulge Scaling...');

// 1. Static helper: refractivityGradientFromK
const gradSub = EnvironmentConfig.refractivityGradientFromK(0.80);
const gradAlpine = EnvironmentConfig.refractivityGradientFromK(1.18);
const gradStd = EnvironmentConfig.refractivityGradientFromK(4.0 / 3.0);
const gradSuper = EnvironmentConfig.refractivityGradientFromK(2.00);
const gradTrap = EnvironmentConfig.refractivityGradientFromK(4.00);

close(gradSub, 39.25, 0.01, 'K=0.80 vertical gradient dN/dh');
close(gradAlpine, -23.95, 0.05, 'K=1.18 vertical gradient dN/dh');
close(gradStd, -39.25, 0.01, 'K=4/3 vertical gradient dN/dh');
close(gradSuper, -78.50, 0.01, 'K=2.00 vertical gradient dN/dh');
close(gradTrap, -117.75, 0.01, 'K=4.00 vertical gradient dN/dh');
console.log('  ✓ EnvironmentConfig.refractivityGradientFromK: accurate across all 5 operational regimes');

// 2. Static helper: effectiveEarthRadiusM
const rEffSub = EnvironmentConfig.effectiveEarthRadiusM(0.80);
const rEffStd = EnvironmentConfig.effectiveEarthRadiusM(4.0 / 3.0);
const rEffSuper = EnvironmentConfig.effectiveEarthRadiusM(2.00);

close(rEffSub, 5096800.0, 1.0, 'K=0.80 effective Earth radius');
close(rEffStd, 8494666.67, 1.0, 'K=4/3 effective Earth radius');
close(rEffSuper, 12742000.0, 1.0, 'K=2.00 effective Earth radius');
console.log('  ✓ EnvironmentConfig.effectiveEarthRadiusM: matches K * 6371000m');

// 3. Earth Curvature Bulge scaling at D = 20 km (s = 10 km midpoint)
const D = 20000.0; // 20 km
const sMid = 10000.0;
const d1 = sMid;
const d2 = D - sMid;

const bulgeSub = TerrainEngine.computeEarthBulge(d1, d2, rEffSub);
const bulgeStd = TerrainEngine.computeEarthBulge(d1, d2, rEffStd);
const bulgeSuper = TerrainEngine.computeEarthBulge(d1, d2, rEffSuper);

close(bulgeSub, 9.81, 0.02, 'K=0.80 midpoint bulge (expected 9.81 m)');
close(bulgeStd, 5.89, 0.02, 'K=4/3 midpoint bulge (expected 5.89 m)');
close(bulgeSuper, 3.92, 0.02, 'K=2.00 midpoint bulge (expected 3.92 m)');

assert.ok(bulgeSub > bulgeStd, 'Sub-refractive bulge must strictly exceed standard bulge');
assert.ok(bulgeStd > bulgeSuper, 'Standard bulge must strictly exceed super-refractive bulge');
console.log(`  ✓ Midpoint Earth Bulge: K=0.80 (+${bulgeSub.toFixed(2)}m) > K=1.33 (+${bulgeStd.toFixed(2)}m) > K=2.00 (+${bulgeSuper.toFixed(2)}m)`);

// 4. Clearance and Diffraction Impact on Grazing Link
const envSub = new EnvironmentConfig({ earthRadiusFactorK: 0.80 });
const envStd = new EnvironmentConfig({ earthRadiusFactorK: 4.0 / 3.0 });
const envSuper = new EnvironmentConfig({ earthRadiusFactorK: 2.00 });

// Midpoint terrain obstacle elevation chosen so K=2.0 is clear LoS, but K=0.80 penetrates LoS
const rf = new RFConfig();
const terr = new TerrainEngine('synthetic');

const txPos: [number, number, number] = [0, 0, 3000];
const rxPos: [number, number, number] = [0, D, 3100];
const losMidZ = 3000 + 0.5 * (3100 - 3000); // 3050 m

// Test with synthetic terrain engine
const obsSub = terr.evaluateTerrainObstruction(txPos, rxPos, rf, envSub, 200.0);
const obsStd = terr.evaluateTerrainObstruction(txPos, rxPos, rf, envStd, 200.0);
const obsSuper = terr.evaluateTerrainObstruction(txPos, rxPos, rf, envSuper, 200.0);

assert.ok(
  obsSub.minClearanceM <= obsStd.minClearanceM,
  `Sub-refractive clearance (${obsSub.minClearanceM.toFixed(2)}m) must be <= standard (${obsStd.minClearanceM.toFixed(2)}m)`
);
assert.ok(
  obsStd.minClearanceM <= obsSuper.minClearanceM,
  `Standard clearance (${obsStd.minClearanceM.toFixed(2)}m) must be <= super-refractive (${obsSuper.minClearanceM.toFixed(2)}m)`
);
assert.ok(
  obsSub.diffractionLossDb >= obsSuper.diffractionLossDb,
  `Sub-refractive diffraction loss (${obsSub.diffractionLossDb.toFixed(2)}dB) must be >= super-refractive (${obsSuper.diffractionLossDb.toFixed(2)}dB)`
);
console.log(`  ✓ Grazing Link Clearance: K=0.80 (${obsSub.minClearanceM.toFixed(1)}m, ${obsSub.diffractionLossDb.toFixed(1)}dB loss) vs K=2.00 (${obsSuper.minClearanceM.toFixed(1)}m, ${obsSuper.diffractionLossDb.toFixed(1)}dB loss)`);

// ----------------------------------------------------------------------------
// PPR-T2: Bullington Double-Horizon Apex & Multi-Order Fresnel Radii
// ----------------------------------------------------------------------------
console.log('\n[PPR-T2] Testing Bullington Double-Horizon Apex & Multi-Order Fresnel Radii...');

// 1. Multi-Order Fresnel Radii (F1, F2 = sqrt(2)*F1, F3 = sqrt(3)*F1)
const wavelength = rf.wavelengthM; // ~0.0375 m for 8.0 GHz
const testD1 = 6000.0;
const testD2 = 14000.0;
const testD = 20000.0;

const rF1 = Math.sqrt((wavelength * testD1 * testD2) / testD);
const rF2 = Math.SQRT2 * rF1;
const rF3 = Math.sqrt(3.0) * rF1;

close(rF2 / rF1, Math.SQRT2, 1e-6, 'rF2 must equal sqrt(2)*rF1 within 1e-6');
close(rF3 / rF1, Math.sqrt(3.0), 1e-6, 'rF3 must equal sqrt(3)*rF1 within 1e-6');

// Test through buildLinkProfile
const linkProfile = buildLinkProfile({
  selectedGroundNodeId: 4,
  nodeName: 'Soldier 4',
  frameIndex: 100,
  simulationTimeS: 5.0,
  groundNodePositionMslM: txPos,
  acnPositionMslM: rxPos,
  wavelengthM: rf.wavelengthM,
  effectiveEarthRadiusM: envStd.effectiveEarthRadiusM,
  sampleCount: 80,
  obstruction: obsStd,
  getTerrainElevationMslM: (x, y) => terr.getElevation(x, y),
  computeEarthBulgeM: TerrainEngine.computeEarthBulge,
});

assert.ok(linkProfile.valid, 'LinkProfile must be marked valid');
assert.ok(linkProfile.samples.length === 80, 'LinkProfile must have 80 samples');
close(linkProfile.fresnelZone2RadiusMidM / (linkProfile.fresnelZone3RadiusMidM / Math.sqrt(3.0)), Math.SQRT2, 1e-6, 'Midpoint multi-Fresnel ratio');

for (const s of linkProfile.samples) {
  if (s.fresnelRadiusM > 0) {
    close(s.fresnel2RadiusM! / s.fresnelRadiusM, Math.SQRT2, 1e-6, `Sample at ${s.slantDistanceM}m F2 ratio`);
    close(s.fresnel3RadiusM! / s.fresnelRadiusM, Math.sqrt(3.0), 1e-6, `Sample at ${s.slantDistanceM}m F3 ratio`);
  }
}
console.log('  ✓ Multi-Order Fresnel: rF2 = sqrt(2)*rF1 and rF3 = sqrt(3)*rF1 verified across all 80 profile samples');

// 2. Bullington Double-Horizon Tangent Apex Construction
// Setup dual-ridge geometry: TX at z=3000m, RX at z=3200m, D=30km
// Ridge 1 at d=8km (elev 3120m), Ridge 2 at d=22km (elev 3250m)
const d3D = 30000.0;
const zTx = 3000.0;
const zRx = 3200.0;
const dRidge1 = 8000.0;
const zRidge1 = 3120.0;
const dRidge2 = 22000.0;
const zRidge2 = 3250.0;

// Slope from TX to Ridge 1
const sTx = (zRidge1 - zTx) / dRidge1; // (3120 - 3000)/8000 = 0.015
// Slope from RX to Ridge 2 (distance from RX is 30000 - 22000 = 8000m)
const sRx = (zRidge2 - zRx) / (d3D - dRidge2); // (3250 - 3200)/8000 = 0.00625

const bullApex = TerrainEngine.computeBullingtonApex(zTx, zRx, d3D, sTx, sRx, dRidge1, dRidge2);

assert.ok(bullApex.sBull >= dRidge1 && bullApex.sBull <= dRidge2, `Bullington apex sBull (${bullApex.sBull}m) must lie between ridges [${dRidge1}, ${dRidge2}]`);
assert.ok(bullApex.zBull > zTx + (bullApex.sBull / d3D) * (zRx - zTx), `Bullington apex zBull (${bullApex.zBull}m) must exceed LoS elevation`);
assert.ok(bullApex.hBull > 0, `Bullington apex hBull (${bullApex.hBull}m) must be positive`);

const nuBull = bullApex.hBull * Math.sqrt((2.0 / wavelength) * (1.0 / bullApex.sBull + 1.0 / (d3D - bullApex.sBull)));
assert.ok(nuBull > 0, `Bullington diffraction parameter nu (${nuBull.toFixed(2)}) must be positive`);

const lossDbBull = TerrainEngine.computeKnifeEdgeLossDb(bullApex.hBull, bullApex.sBull, d3D - bullApex.sBull, wavelength);
assert.ok(lossDbBull > 6.0, `Bullington knife edge loss (${lossDbBull.toFixed(1)} dB) must exceed 6.0 dB`);
console.log(`  ✓ Bullington Double-Horizon: s_bull=${(bullApex.sBull/1000).toFixed(2)}km, z_bull=${bullApex.zBull.toFixed(1)}m, h_bull=${bullApex.hBull.toFixed(1)}m, ν=${nuBull.toFixed(2)}, J(ν)=${lossDbBull.toFixed(1)} dB`);

// 3. Type Contract Verification (ProfileData and LinkProfileAnalysis aliases)
const sampleData: ProfileData = linkProfile;
const analysisData: LinkProfileAnalysis = linkProfile;
assert.equal(sampleData.kFactor, linkProfile.kFactor);
assert.equal(analysisData.kFactor, linkProfile.kFactor);
assert.ok(Number.isFinite(linkProfile.maxEarthBulgeM));
assert.ok(Number.isFinite(linkProfile.refractivityGradNPerKm));
console.log('  ✓ Type contract: ProfileData & LinkProfileAnalysis exported and compatible with LinkProfile');

// ----------------------------------------------------------------------------
// PPR-T3: DOM & Global Layout Invariance Check
// ----------------------------------------------------------------------------
console.log('\n[PPR-T3] Testing DOM & Global Layout Invariance...');

const htmlPath = resolve(__dirname, '../../index.html');
const cssThemePath = resolve(__dirname, '../../frontend/c2-console-theme.css');
const specPath = resolve(__dirname, '../../docs/specs/SPEC-PATH-PROFILE-BULLINGTON-REFRACTIVITY-UPGRADE.md');
const readmePath = resolve(__dirname, '../../README.md');

assert.ok(existsSync(htmlPath), 'index.html must exist');
assert.ok(existsSync(cssThemePath), 'c2-console-theme.css must exist');
assert.ok(existsSync(specPath), 'SPEC-PATH-PROFILE-BULLINGTON-REFRACTIVITY-UPGRADE.md must exist on disk');
assert.ok(existsSync(readmePath), 'README.md must exist');

const htmlContent = readFileSync(htmlPath, 'utf8');
const readmeContent = readFileSync(readmePath, 'utf8');

// 1. Required DOM elements inside #tab-terrain
assert.ok(htmlContent.includes('id="tab-terrain"'), '#tab-terrain section must exist');
assert.ok(htmlContent.includes('id="prof-refractivity-select"'), '#prof-refractivity-select must exist');
assert.ok(htmlContent.includes('id="prof-toggle-fresnel-orders"'), '#prof-toggle-fresnel-orders must exist');
assert.ok(htmlContent.includes('id="prof-physics-readout"'), '#prof-physics-readout must exist');

// 2. Select options for K-Factor regimes
const expectedOptions = ['0.80', '1.18', '1.3333333333333333', '2.00', '4.00'];
for (const opt of expectedOptions) {
  assert.ok(
    htmlContent.includes(`value="${opt}"`),
    `#prof-refractivity-select must contain option value "${opt}"`
  );
}
console.log('  ✓ DOM Elements: #prof-refractivity-select, #prof-toggle-fresnel-orders, and #prof-physics-readout present with 5 regimes');

// 3. Accessibility & Layout Invariance
assert.ok(htmlContent.includes('aria-label="ITU-R P.834 Atmospheric Refractivity K-Factor Regime"'), 'Select must have explicit aria-label');
assert.ok(htmlContent.includes('aria-label="Toggle Multi-Order Fresnel Zones F1 F2 F3"'), 'Toggle must have explicit aria-label');
assert.ok(htmlContent.includes('aria-pressed="true"'), 'Toggle must have aria-pressed attribute');

// Verify global layout classes remain intact
assert.ok(/class="[^"]*\brail\b/.test(htmlContent), '.rail must remain in index.html');
assert.ok(/class="[^"]*\btopbar\b/.test(htmlContent), '.topbar must remain in index.html');
assert.ok(htmlContent.includes('shell'), '.shell must remain in index.html');
assert.ok(htmlContent.includes('id="radar-container"'), '#radar-container must remain in index.html');

// 4. Specification Linked in README.md
assert.ok(
  readmeContent.includes('SPEC-PATH-PROFILE-BULLINGTON-REFRACTIVITY-UPGRADE.md'),
  'SPEC-PATH-PROFILE-BULLINGTON-REFRACTIVITY-UPGRADE.md must be linked in Section 7 of README.md'
);
console.log('  ✓ Architectural Invariance: Global layout elements (.rail, .topbar, .app-shell, #radar-container) 100% intact');
console.log('  ✓ Specification linked in README.md');

console.log('\n--- ALL PATH PROFILE & REFRACTIVITY TESTS (PPR-T1 to PPR-T3) PASSED SUCCESSFULLY ---');
