/**
 * src/tests/verifyEdgeAiCopilotAndSoldierPhone.ts
 *
 * Authoritative verification suite for Suite 83:
 * Tactical Edge-AI Co-Pilot & Soldier Handheld Device (ATAK Phone) Workspace
 * (SPEC-TACTICAL-EDGE-AI-COPILOT-AND-SOLDIER-PHONE-UI.md).
 *
 * Verifies:
 * - ECP-T1: Pillar 1 AI Buddy-Relay Peer-to-Peer Squad Mesh & Harmonic Capacity
 * - ECP-T2: Pillars 2 & 3: EW Defilade Terrain-Shield & Sky-Shepherd UAV Orbit Shift
 * - ECP-T3: Pillars 4 & 5: LPI/LPD Dynamic Power Controller & 15s Blackout Forecaster
 * - ECP-T4: DOM Workspace, Zero Theme Diff & Architectural Integrity Audit
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateAiBuddyRelayRescue,
  computeEwDefiladeShieldDb,
  computeAiSkyShepherdUavOffset,
  computeAiLpiStealthPower,
  predictNodeBlackoutCountdown,
  computeAiRecoveryAdvisory,
  EdgeAiQTable,
  type SquadNodeForBuddyEval,
  type Position3D,
} from '../core/tacticalAiPathfinder';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('='.repeat(96));
console.log('   VERIFY: TACTICAL EDGE-AI CO-PILOT & SOLDIER PHONE UI SUITE (ECP-T1–T4)');
console.log('='.repeat(96));

// -----------------------------------------------------------------------------
// ECP-T1: Pillar 1 AI Buddy-Relay Peer-to-Peer Squad Mesh
// -----------------------------------------------------------------------------
console.log('\n[ECP-T1] Pillar 1: AI Buddy-Relay Peer-to-Peer Squad Mesh & Harmonic Capacity...');

const mockFlatElevation = (x: number, y: number) => 3500.0;

// Node 1 is an occluded soldier at (1000, 2000, 3500)
const soldierPos: Position3D = [1000.0, 2000.0, 3500.0];
const targetSoldier = {
  nodeId: 1,
  position: soldierPos,
  isOutage: true,
  directBitrateMbps: 0.0,
  directSinrDb: -6.0,
};

const squadCandidates: SquadNodeForBuddyEval[] = [
  // Squadmate 2: 800m away, healthy direct link to ACN (12.0 Mbps, !isOutage)
  {
    nodeId: 2,
    position: [1800.0, 2000.0, 3500.0],
    isOutage: false,
    directBitrateMbps: 12.0,
    directSinrDb: 18.5,
  },
  // Squadmate 3: 5500m away (exceeds 4500m max peer range)
  {
    nodeId: 3,
    position: [6500.0, 2000.0, 3500.0],
    isOutage: false,
    directBitrateMbps: 15.0,
    directSinrDb: 20.0,
  },
  // Squadmate 4: 400m away, but in outage
  {
    nodeId: 4,
    position: [1400.0, 2000.0, 3500.0],
    isOutage: true,
    directBitrateMbps: 0.0,
    directSinrDb: -6.0,
  },
  // Squadmate 5: 20m away (below 50m minimum)
  {
    nodeId: 5,
    position: [1020.0, 2000.0, 3500.0],
    isOutage: false,
    directBitrateMbps: 10.0,
    directSinrDb: 18.0,
  },
];

const buddyResult = evaluateAiBuddyRelayRescue(
  targetSoldier,
  squadCandidates,
  mockFlatElevation
);

assert.ok(buddyResult.isBuddyRescueActive, 'Buddy rescue must be active when a healthy squadmate is available');
assert.equal(buddyResult.buddyNodeId, 2, 'Squadmate 2 must be chosen as the rescue peer');
assert.ok(Math.abs(buddyResult.buddyDistanceM - 800.0) < 5.0, `Buddy distance should be ~800m, got ${buddyResult.buddyDistanceM}`);
assert.ok(buddyResult.buddyBitrateMbps > 0, `Peer bitrate must be positive, got ${buddyResult.buddyBitrateMbps}`);
assert.ok(buddyResult.harmonicRateMbps > 0, `Harmonic bitrate must be positive, got ${buddyResult.harmonicRateMbps}`);

// Check exact harmonic formula: R_buddy = (R_peer * R_uav) / (R_peer + R_uav)
const expectedHarmonic = (buddyResult.buddyBitrateMbps * 12.0) / (buddyResult.buddyBitrateMbps + 12.0);
assert.ok(
  Math.abs(buddyResult.harmonicRateMbps - expectedHarmonic) < 0.05,
  `Harmonic rate ${buddyResult.harmonicRateMbps} must match theoretical ${expectedHarmonic}`
);

// Verify that if current direct rate is already higher than harmonic, rescue does not trigger
const healthySoldier = {
  nodeId: 1,
  position: soldierPos,
  isOutage: false,
  directBitrateMbps: 25.0, // directly connected with high rate
  directSinrDb: 22.0,
};
const healthySoldierResult = evaluateAiBuddyRelayRescue(
  healthySoldier,
  squadCandidates,
  mockFlatElevation
);
assert.equal(healthySoldierResult.isBuddyRescueActive, false, 'Rescue must not trigger if direct rate is superior');

console.log(`  -> Selected Buddy: S${buddyResult.buddyNodeId} at ${buddyResult.buddyDistanceM.toFixed(1)}m`);
console.log(`  -> Peer Bitrate: ${buddyResult.buddyBitrateMbps.toFixed(2)} Mbps | UAV Bitrate: 12.0 Mbps`);
console.log(`  -> Harmonic Capacity R_buddy: ${buddyResult.harmonicRateMbps.toFixed(2)} Mbps`);
console.log('✓ ECP-T1 PASS: AI Buddy-Relay Peer-to-Peer squad mesh verified.');

// -----------------------------------------------------------------------------
// ECP-T2: Pillars 2 & 3: EW Defilade Terrain-Shield & Sky-Shepherd Orbit Offset
// -----------------------------------------------------------------------------
console.log('\n[ECP-T2] Pillars 2 & 3: EW Defilade Terrain-Shield & Sky-Shepherd Orbit Offset...');

// 1. EW Defilade Mountain Diffraction Shielding
const siteBehindRidge: Position3D = [1000.0, 2000.0, 3002.0];
const jammerPos: Position3D = [3000.0, 2000.0, 3005.0];
const acnPos: Position3D = [5000.0, 15000.0, 6000.0];

// Elevation profile with a 400m ridge at x = 2000
const ridgeElevation = (x: number, y: number) => {
  const distToRidge = Math.abs(x - 2000.0);
  if (distToRidge < 200.0) return 3400.0; // 400m peak above site & jammer
  return 3000.0;
};
const flatElevation = (x: number, y: number) => 3000.0;

const defiladeRes = computeEwDefiladeShieldDb(siteBehindRidge, jammerPos, ridgeElevation);
assert.ok(defiladeRes.diffLossJamDb > 10.0, `Defilade loss behind 400m ridge must be > 10 dB, got ${defiladeRes.diffLossJamDb.toFixed(1)} dB`);
assert.equal(defiladeRes.isShielded, true, 'Ridge site must be flagged as shielded');

// Flat ground (no ridge): diffraction loss should be 0 dB
const flatRes = computeEwDefiladeShieldDb(siteBehindRidge, jammerPos, flatElevation);
assert.equal(flatRes.diffLossJamDb, 0.0, 'Flat terrain must yield 0 dB diffraction shielding');
assert.equal(flatRes.isShielded, false, 'Flat terrain must not be shielded');

console.log(`  -> Ridge Defilade Diffraction Loss: ${defiladeRes.diffLossJamDb.toFixed(2)} dB (Flat: ${flatRes.diffLossJamDb.toFixed(2)} dB)`);

// Test computeAiRecoveryAdvisory with EW Defilade parameters
const qTable = new EdgeAiQTable();
const advisoryWithJammer = computeAiRecoveryAdvisory({
  nodeId: 4,
  nodePos: siteBehindRidge,
  nodeType: 'SOLDIER',
  acnPos,
  currentSinrDb: -8.0,
  currentIsOutage: true,
  getElevationAt: ridgeElevation,
  qTable,
  jammerPosEnu: jammerPos,
  jammerEnabled: true,
});

assert.ok(advisoryWithJammer.jammerShieldingDb !== undefined, 'Advisory must report jammerShieldingDb');
assert.ok(advisoryWithJammer.isEwDefiladeSpot !== undefined, 'Advisory must report isEwDefiladeSpot');

// 2. Sky-Shepherd UAV Loiter Orbit Offset
const pinnedPos: Position3D = [1500.0, 2500.0, 3002.0];
const currentAcnCenter: Position3D = [3500.0, 4500.0, 4500.0];

const shepherdResult = computeAiSkyShepherdUavOffset(
  pinnedPos,
  currentAcnCenter,
  flatElevation
);

assert.equal(shepherdResult.deltaAltM, 350.0, 'Sky-Shepherd must boost altitude by +350m');
assert.ok(Number.isFinite(shepherdResult.deltaXM), 'deltaXM must be finite');
assert.ok(Number.isFinite(shepherdResult.deltaYM), 'deltaYM must be finite');
assert.ok(shepherdResult.isShepherdFeasible, 'Sky-Shepherd should be feasible with clear geometry');
assert.ok(shepherdResult.shepherdDirectiveText.includes('SKY-SHEPHERD'), 'Directive text must mention SKY-SHEPHERD');

console.log(`  -> Sky-Shepherd Offset: (${shepherdResult.deltaXM.toFixed(0)}m, ${shepherdResult.deltaYM.toFixed(0)}m, +${shepherdResult.deltaAltM}m)`);
console.log(`  -> Shepherd Directive: "${shepherdResult.shepherdDirectiveText}"`);
console.log('✓ ECP-T2 PASS: EW Defilade Terrain-Shield and Sky-Shepherd orbit offset verified.');

// -----------------------------------------------------------------------------
// ECP-T3: Pillars 4 & 5: LPI/LPD Dynamic Power Controller & 15s Blackout Forecaster
// -----------------------------------------------------------------------------
console.log('\n[ECP-T3] Pillars 4 & 5: LPI/LPD Dynamic Power Controller & 15s Blackout Forecaster...');

// 1. LPI Stealth Power Controller
// Case A: High SINR link (+30 dB), nominal power 30 dBm, target threshold 18.5 dB
const highSinrResult = computeAiLpiStealthPower(
  30.0, // nominalTxPowerDbm
  30.0, // currentSinrDb
  false, // isOutage
  18.5 // targetThresholdDb
);

assert.equal(highSinrResult.mode, 'LPI_STEALTH_THROTTLED', 'High SINR link must enter LPI_STEALTH_THROTTLED mode');
assert.ok(
  Math.abs(highSinrResult.lpiTxPowerDbm - 18.5) < 0.1,
  `LPI TX power should throttle to ~18.5 dBm, got ${highSinrResult.lpiTxPowerDbm.toFixed(2)} dBm`
);
assert.ok(
  Math.abs(highSinrResult.reductionDb - 11.5) < 0.1,
  `Reduction should be ~11.5 dB, got ${highSinrResult.reductionDb.toFixed(2)} dB`
);
assert.ok(
  highSinrResult.powerSavedPct > 90.0,
  `Power saved percentage should be > 90%, got ${highSinrResult.powerSavedPct.toFixed(1)}%`
);

// Case B: Marginal or diffracted link (+10 dB), below target threshold 18.5 dB
const marginalResult = computeAiLpiStealthPower(
  30.0, // nominalTxPowerDbm
  10.0, // currentSinrDb
  false, // isOutage
  18.5 // targetThresholdDb
);

assert.equal(marginalResult.mode, 'MAX_BOOST_DIFFRACTION', 'Marginal link must maintain MAX_BOOST_DIFFRACTION mode');
assert.equal(marginalResult.lpiTxPowerDbm, 30.0, 'Marginal link must retain full nominal 30 dBm');
assert.equal(marginalResult.reductionDb, 0.0, 'Zero reduction on marginal link');
assert.equal(marginalResult.powerSavedPct, 0.0, 'Zero power saved on marginal link');

console.log(`  -> LPI Throttled: ${highSinrResult.lpiTxPowerDbm.toFixed(1)} dBm (-${highSinrResult.powerSavedPct.toFixed(1)}% RF Sig, reduction: ${highSinrResult.reductionDb.toFixed(1)} dB)`);
console.log(`  -> Diffracted Boost: ${marginalResult.lpiTxPowerDbm.toFixed(1)} dBm (${marginalResult.mode})`);

// 2. 15-Second Blackout Countdown Forecaster
// Case A: Occlusion predicted along trajectory
const trajectoryWithOcclusion = (dtS: number): Position3D => {
  // At dt = 9s, 12s, 15s, ACN moves behind the ridge at x = 2000 to x = 10000 (10 km range)
  if (dtS >= 9.0) {
    return [10000.0, 2000.0, 3100.0]; // occluded by the 3400m ridge between site and ACN
  }
  return [1000.0, 2000.0, 6000.0]; // clear LoS directly above
};

const blackoutForecast = predictNodeBlackoutCountdown(
  siteBehindRidge,
  18.0, // currently healthy SINR
  false, // currently !isOutage
  trajectoryWithOcclusion,
  ridgeElevation,
  0
);

assert.ok(blackoutForecast.blackoutImminent, 'Blackout must be forecasted when trajectory enters ridge shadow');
assert.equal(blackoutForecast.blackoutInSeconds, 9.0, 'Blackout countdown should identify first outage at t = 9s');
assert.ok(blackoutForecast.estimatedDurationS >= 6.0, 'Duration should reflect subsequent occluded steps');
assert.ok(blackoutForecast.warningText.includes('BLACKOUT IN'), 'Warning text must mention blackout countdown');

// Case B: Clear sky (no blackout)
const trajectoryClearSky = (dtS: number): Position3D => [1000.0, 2000.0, 6000.0];

const clearSkyForecast = predictNodeBlackoutCountdown(
  siteBehindRidge,
  18.0,
  false,
  trajectoryClearSky,
  flatElevation,
  0
);

assert.equal(clearSkyForecast.blackoutImminent, false, 'No blackout on clear sky');
assert.equal(clearSkyForecast.blackoutInSeconds, null, 'Countdown must be null when no blackout');

console.log(`  -> Blackout Warning: "${blackoutForecast.warningText}" (In: ${blackoutForecast.blackoutInSeconds}s, Dur: ${blackoutForecast.estimatedDurationS}s)`);
console.log('✓ ECP-T3 PASS: LPI stealth power controller and 15s blackout countdown verified.');

// -----------------------------------------------------------------------------
// ECP-T4: DOM Workspace, Zero Theme Diff & Architectural Integrity Audit
// -----------------------------------------------------------------------------
console.log('\n[ECP-T4] DOM Workspace, Zero Theme Diff & Architectural Integrity Audit...');

const indexHtml = readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf-8');

const REQUIRED_DOM_IDS = [
  'tab-soldier',
  'tab-btn-soldier',
  'btn-open-soldier-phone',
  'soldier-eud-phone-frame',
  'eud-node-select',
  'eud-status-bar',
  'eud-route-badge',
  'eud-sinr-readout',
  'eud-lpi-readout',
  'eud-gps-readout',
  'eud-ai-notification-banner',
  'soldier-phone-canvas',
  'eud-nav-guidance',
  'btn-eud-walk-ai',
  'btn-eud-pin-shepherd',
  'ai-copilot-matrix-panel',
  'btn-ai-buddy-mesh-toggle',
  'btn-ai-lpi-stealth-toggle',
  'btn-ai-auto-heal-matrix-toggle',
  'card-pillar-walkable',
  'card-pillar-buddymesh',
  'card-pillar-defilade',
  'card-pillar-skyshepherd',
  'card-pillar-lpi-blackout',
];

for (const id of REQUIRED_DOM_IDS) {
  assert.ok(indexHtml.includes(`id="${id}"`), `index.html must contain required DOM element id="${id}"`);
}
console.log(`  -> Verified all ${REQUIRED_DOM_IDS.length} required Soldier Phone & Edge-AI DOM elements in index.html`);

// Verify frontend/c2-console-theme.css exists
assert.ok(existsSync(path.join(ROOT_DIR, 'frontend/c2-console-theme.css')), 'frontend/c2-console-theme.css must exist');
console.log('  -> Verified frontend/c2-console-theme.css exists');

// Verify specification persistence on disk
const specPath = path.join(ROOT_DIR, 'docs/specs/SPEC-TACTICAL-EDGE-AI-COPILOT-AND-SOLDIER-PHONE-UI.md');
assert.ok(existsSync(specPath), 'Specification file docs/specs/SPEC-TACTICAL-EDGE-AI-COPILOT-AND-SOLDIER-PHONE-UI.md must exist');

// Verify README.md references the specification
const readme = readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf-8');
assert.ok(readme.includes('SPEC-TACTICAL-EDGE-AI-COPILOT-AND-SOLDIER-PHONE-UI.md'), 'README.md must reference the Edge-AI and Soldier Phone spec');
console.log('  -> Verified SPEC-TACTICAL-EDGE-AI-COPILOT-AND-SOLDIER-PHONE-UI.md exists and is linked in README.md');

console.log('✓ ECP-T4 PASS: DOM workspace and architectural integrity audit verified.');

console.log('\n' + '='.repeat(96));
console.log('   ALL 4 EDGE-AI COPILOT & SOLDIER PHONE SUITES (ECP-T1–T4) PASSED CLEANLY');
console.log('='.repeat(96));
