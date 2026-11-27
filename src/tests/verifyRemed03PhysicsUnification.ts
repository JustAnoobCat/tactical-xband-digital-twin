/**
 * src/tests/verifyRemed03PhysicsUnification.ts
 *
 * Regression Verification Suite for REMED-03:
 * Core RF Propagation, Antenna Kinematics, Calibration & Link-Budget Unification.
 */

import assert from 'node:assert/strict';
import { EnvironmentConfig, RFConfig } from '../core/config';
import { TerrainEngine } from '../core/terrain';
import { LinkBudgetEngine } from '../core/linkBudget';
import { THEATER_BIOMES, type AdvectingWeatherCell } from '../core/biomePhysics';
import { computeFsplDb } from '../core/rfPropagationMath';
import { worldLosToBodyFrame } from '../core/antennaArray';
import { PolarViewshedEngine } from '../core/viewshedEngine';
import {
  evaluateTwinCalibrationTrace,
  autoCalibrateTwinParameters,
  DEFAULT_CALIBRATION_PARAMS,
  type FlightTestTraceSample,
} from '../core/digitalTwinCalibrationEngine';
import {
  evaluateConstellationMultiAcn,
  evaluateManetMeshRouting,
  evaluateHighAltAerodynamics,
  type ConstellationAcnState,
  type NodeHandoverState,
} from '../core/constellationAndMobilityEngine';
import { evaluateCursorRfProbe } from '../core/cursorProbeEngine';
import { evaluateAoSwathAnalysis } from '../core/aoSwathScannerEngine';
import { computeTransectRfMetrics, evaluateVirtualTerminalLink } from '../ui/terrainAnalysisController';
import { drawLinkWaterfallCanvas, type ScientificScopeFrameTelemetry } from '../ui/scientificScopesRenderer';
import { createACNTrajectory } from '../core/trajectory';
import { ACNFlightConfig } from '../core/config';
import type { Position3D } from '../shared/types';

function close(actual: number, expected: number, tol = 1e-6, label = 'value'): void {
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tol, `${label}: expected ${expected} ± ${tol}, got ${actual} (diff ${diff})`);
}

console.log('='.repeat(88));
console.log('  REMED-03 VERIFICATION SUITE: RF PROPAGATION, KINEMATICS, CALIBRATION & UNIFICATION');
console.log('='.repeat(88));

// ============================================================================
// 1. Calibration Rain Loss & Rain Scale Optimization
// ============================================================================
console.log('\n[1/6] Verifying Digital-Twin Calibration Rain Attenuation & Optimization...');
{
  const rf = new RFConfig();
  const baseParams = { ...DEFAULT_CALIBRATION_PARAMS, rainAttenScale: 1.0 };

  const drySamples: FlightTestTraceSample[] = [
    { timeS: 0, slantRangeM: 12000, txAltM: 4200, rxAltM: 3000, measuredSnrDb: 15.0, rainRateMmH: 0 },
    { timeS: 1, slantRangeM: 15000, txAltM: 4200, rxAltM: 3000, measuredSnrDb: 13.0, rainRateMmH: 0 },
  ];
  const wetSamples: FlightTestTraceSample[] = [
    { timeS: 0, slantRangeM: 12000, txAltM: 4200, rxAltM: 3000, measuredSnrDb: 15.0, rainRateMmH: 25 },
    { timeS: 1, slantRangeM: 15000, txAltM: 4200, rxAltM: 3000, measuredSnrDb: 13.0, rainRateMmH: 25 },
  ];

  const dryReport = evaluateTwinCalibrationTrace(drySamples, baseParams);
  const wetReport = evaluateTwinCalibrationTrace(wetSamples, baseParams);
  const rainDeltaDb = dryReport.points[0].predictedSnrDb - wetReport.points[0].predictedSnrDb;
  assert.ok(rainDeltaDb > 0.5, `25 mm/h rain must reduce predicted SNR by > 0.5 dB, got ${rainDeltaDb.toFixed(3)} dB`);

  // Synthetic trace with 1.6x rain attenuation truth (using diverse rain rates so rainAttenScale is identifiable)
  const truthScale = 1.6;
  const syntheticRainTrace: FlightTestTraceSample[] = [];
  for (let i = 0; i < 20; i++) {
    const rangeM = 12000 + i * 300;
    const txAltM = 4500;
    const rxAltM = 3000;
    const rainRateMmH = i % 2 === 0 ? 0.0 : 40.0;
    const fsplDb = computeFsplDb(rangeM, baseParams.carrierFreqHz);
    const gasDb = LinkBudgetEngine.computeGaseousAttenuationDb(rangeM, rxAltM, txAltM, baseParams.carrierFreqHz);
    const rainDb = rainRateMmH > 0
      ? LinkBudgetEngine.computeRainAttenuationDb(rangeM, new EnvironmentConfig({ rainRateMmH }), rxAltM, txAltM) * truthScale
      : 0.0;
    const measuredSnrDb = baseParams.txEirpDbm + baseParams.rxGainDbi - fsplDb - gasDb - rainDb - baseParams.noiseFloorDbm;
    syntheticRainTrace.push({
      timeS: i,
      slantRangeM: rangeM,
      txAltM,
      rxAltM,
      measuredSnrDb,
      rainRateMmH,
    });
  }

  const calRes = autoCalibrateTwinParameters(syntheticRainTrace, baseParams);
  assert.ok(
    calRes.optimizedParams.rainAttenScale > 1.25 && calRes.optimizedParams.rainAttenScale < 1.85,
    `Coordinate descent must optimize rainAttenScale toward 1.6, got ${calRes.optimizedParams.rainAttenScale.toFixed(3)}`
  );
  assert.ok(calRes.calibratedReport.rmseDb < calRes.initialReport.rmseDb, 'Calibration must reduce RMSE');
  console.log(`  PASS: 25 mm/h rain delta = ${rainDeltaDb.toFixed(2)} dB; calibrated rainAttenScale = ${calRes.optimizedParams.rainAttenScale.toFixed(3)}`);
}

// ============================================================================
// 2. LinkBudgetEngine: Typed Options, Weather Cells, Biome Isotherm & Two-Ray AGL
// ============================================================================
console.log('\n[2/6] Verifying LinkBudgetEngine Options, Weather Cells, Isotherm & Two-Ray AGL...');
{
  const rf = new RFConfig();
  const env = new EnvironmentConfig({ rainRateMmH: 20.0 });
  const engine = new LinkBudgetEngine();

  // 2a. Options object matches legacy positional call
  const posRes = engine.evaluateLink('soldier', 10000, 2.5, rf, env, false, 38.0, undefined, 3200, 5000);
  const optRes = engine.evaluateLink({
    nodeType: 'soldier',
    slantRangeM: 10000,
    diffractionLossDb: 2.5,
    rf,
    env,
    obstacleBlocked: false,
    customTxPowerDbm: 38.0,
    nodeAltM: 3200,
    acnAltM: 5000,
  });
  assert.equal(optRes.snrDb, posRes.snrDb, 'Options overload must match positional overload SNR');
  assert.equal(optRes.rainLossDb, posRes.rainLossDb, 'Options overload must match positional rainLossDb');
  assert.equal(optRes.prxDbm, posRes.prxDbm, 'Options overload must match positional prxDbm');

  // 2b. Advecting weather cell spatial localization via true 2D segment endpoints
  const stormCell: AdvectingWeatherCell = {
    id: 'storm-east',
    centerX0M: 5000,
    centerY0M: 0,
    velocityXMps: 0,
    velocityYMps: 0,
    radiusM: 2000,
    peakRainRateMmH: 50,
  };
  const dryEnv = new EnvironmentConfig({ rainRateMmH: 0 });
  const linkThruStorm = engine.evaluateLink({
    nodeType: 'soldier',
    slantRangeM: 10000,
    rf,
    env: dryEnv,
    nodeAltM: 100,
    acnAltM: 1000,
    txX: 0,
    txY: 0,
    rxX: 10000,
    rxY: 0,
    biomeEmParams: {
      enableBiomeEmPhysics: true,
      biomeId: 'open_plains',
      weatherCells: [stormCell],
      simTimeSec: 0,
    },
  });
  const linkClearWest = engine.evaluateLink({
    nodeType: 'soldier',
    slantRangeM: 10000,
    rf,
    env: dryEnv,
    nodeAltM: 100,
    acnAltM: 1000,
    txX: -15000,
    txY: 0,
    rxX: -5000,
    rxY: 0,
    biomeEmParams: {
      enableBiomeEmPhysics: true,
      biomeId: 'open_plains',
      weatherCells: [stormCell],
      simTimeSec: 0,
    },
  });
  assert.ok((linkThruStorm.weatherCellRainMmH ?? 0) > 10.0, 'Link traversing (5000,0) must intersect storm cell');
  assert.ok(linkThruStorm.rainLossDb > 0.5, 'Link traversing (5000,0) must experience rain loss');
  assert.equal(linkClearWest.weatherCellRainMmH, 0.0, 'Link at (-15000,0)->(-5000,0) must have 0 storm rain');
  assert.equal(linkClearWest.rainLossDb, 0.0, 'Link away from storm cell must have 0 rain loss');

  // 2c. Biome-specific freezingIsothermM (Arabian Sea 5500 m vs Ladakh 4800 m at 4800-5400 m band)
  const linkMaritime = engine.evaluateLink({
    nodeType: 'soldier',
    slantRangeM: 10000,
    rf,
    env: new EnvironmentConfig({ rainRateMmH: 30 }),
    nodeAltM: 4800,
    acnAltM: 5400,
    biomeId: 'maritime_littoral',
  });
  const linkLadakh = engine.evaluateLink({
    nodeType: 'soldier',
    slantRangeM: 10000,
    rf,
    env: new EnvironmentConfig({ rainRateMmH: 30 }),
    nodeAltM: 4800,
    acnAltM: 5400,
    biomeId: 'alpine_mountain',
  });
  assert.ok(
    linkMaritime.rainLossDb > linkLadakh.rainLossDb * 5.0,
    `Maritime isotherm (5500 m) rain loss (${linkMaritime.rainLossDb.toFixed(3)} dB) must far exceed Ladakh (4800 m, ${linkLadakh.rainLossDb.toFixed(3)} dB) in 4800-5400 m band`
  );

  // 2d. Two-ray ground reflection omitted AGL fallback defaults to rxAltAglM=2.0m, txAltAglM=max(1.5, acnAlt-nodeAlt)
  const linkOmittedAgl = engine.evaluateLink({
    nodeType: 'soldier',
    slantRangeM: 10000,
    rf,
    env: dryEnv,
    nodeAltM: 3500,
    acnAltM: 5000,
    biomeEmParams: {
      enableBiomeEmPhysics: true,
      biomeId: 'open_plains',
    },
  });
  const linkExplicitAgl = engine.evaluateLink({
    nodeType: 'soldier',
    slantRangeM: 10000,
    rf,
    env: dryEnv,
    nodeAltM: 3500,
    acnAltM: 5000,
    biomeEmParams: {
      enableBiomeEmPhysics: true,
      biomeId: 'open_plains',
      rxAltAglM: 2.0,
      txAltAglM: 1500.0,
    },
  });
  const linkWrongMslAgl = engine.evaluateLink({
    nodeType: 'soldier',
    slantRangeM: 10000,
    rf,
    env: dryEnv,
    nodeAltM: 3500,
    acnAltM: 5000,
    biomeEmParams: {
      enableBiomeEmPhysics: true,
      biomeId: 'open_plains',
      rxAltAglM: 3500.0,
      txAltAglM: 5000.0,
    },
  });
  assert.equal(linkOmittedAgl.twoRayDeltaDb, linkExplicitAgl.twoRayDeltaDb, 'Omitted AGL must match rxAltAgl=2m, txAltAgl=1500m');
  assert.notEqual(linkOmittedAgl.twoRayDeltaDb, linkWrongMslAgl.twoRayDeltaDb, 'Omitted AGL must NOT fall back to 3500 m MSL');
  console.log('  PASS: Typed options, 2D storm cells, biome isotherm, and realistic AGL fallback verified');
}

// ============================================================================
// 3. Viewshed Fast-vs-Parity & Relay Beamwidth Alignment
// ============================================================================
console.log('\n[3/6] Verifying Viewshed Fast-vs-Parity Agreement & Relay Beamwidth...');
{
  const terrain = new TerrainEngine({ customElevationFn: () => 3200.0 });
  const viewshed = new PolarViewshedEngine();
  const rf = new RFConfig();
  const env = new EnvironmentConfig();
  const acnPos: Position3D = [0, 0, 5000];
  const acnVel: Position3D = [0, 60, 0];

  const bearings = [0, 35, 45, 90, 180, 270];
  for (const b of bearings) {
    const fastSinr = viewshed.computeCellSinr(b, 7500, acnPos, acnVel, terrain, rf, env, { headingDeg: 0, pitchDeg: 5, bankDeg: 18 }, undefined, 'fast');
    const paritySinr = viewshed.computeCellSinr(b, 7500, acnPos, acnVel, terrain, rf, env, { headingDeg: 0, pitchDeg: 5, bankDeg: 18 }, undefined, 'link-budget-parity');
    close(fastSinr, paritySinr, 0.99, `Fast vs parity SINR at bearing ${b}°`);
  }

  // Relay advisor respects QuadSectorAntennaEngine 90° az x 65° el HPBW & 16 dBi peak gain
  const traj = createACNTrajectory(new ACNFlightConfig({ altitudeMslM: 5500 }));
  const groundNodes = [{ nodeId: 1, position: [1000, 1000, 3202] as Position3D }];
  const rfNarrowAz = new RFConfig({ acnSectorHpbwAzDeg: 90.0, acnSectorHpbwElDeg: 65.0, acnAntennaGainDbi: 16.0 });
  const rfWideAz = new RFConfig({ acnSectorHpbwAzDeg: 180.0, acnSectorHpbwElDeg: 65.0, acnAntennaGainDbi: 16.0 });
  const rep1 = viewshed.computeOptimalRelayPlacement(traj, terrain, groundNodes, rfNarrowAz, env, 6);
  const rep2 = viewshed.computeOptimalRelayPlacement(traj, terrain, groundNodes, rfWideAz, env, 6);
  assert.ok(rep2.meanSinrToAcnDb >= rep1.meanSinrToAcnDb, 'Wider az beamwidth increases off-boresight relay SINR');
  console.log('  PASS: Viewshed fast vs parity agrees within < 1.0 dB and relay advisor aligns with 90x65° sector model');
}

// ============================================================================
// 4. Antenna NED->FRD Passive DCM Orthogonality & Roll Sign
// ============================================================================
console.log('\n[4/6] Verifying worldLosToBodyFrame DCM Orthogonality & Roll Sign...');
{
  const yaws = [0, 37, 90, 145, 215, 310];
  const pitches = [-25, 0, 18];
  const rolls = [-40, -15, 0, 30, 45];

  for (const yawDeg of yaws) {
    for (const pitchDeg of pitches) {
      for (const rollDeg of rolls) {
        const att = { yawDeg, pitchDeg, rollDeg };
        // Transform NED basis vectors (e_N: east=0,north=1,up=0; e_E: 1,0,0; e_D: 0,0,-1)
        const c0 = worldLosToBodyFrame(0, 1, 0, att);
        const c1 = worldLosToBodyFrame(1, 0, 0, att);
        const c2 = worldLosToBodyFrame(0, 0, -1, att);
        const R = [
          [c0.bodyForward, c1.bodyForward, c2.bodyForward],
          [c0.bodyRight, c1.bodyRight, c2.bodyRight],
          [c0.bodyDown, c1.bodyDown, c2.bodyDown],
        ];
        // Verify R^T R = I
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const dot = R[0][i] * R[0][j] + R[1][i] * R[1][j] + R[2][i] * R[2][j];
            close(dot, i === j ? 1.0 : 0.0, 1e-12, `R^T R [${i},${j}]`);
          }
        }
        // Verify det(R) = +1
        const det =
          R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) -
          R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) +
          R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
        close(det, 1.0, 1e-12, 'det(R)');
      }
    }
  }

  // Level-North roll +30° on nadir vector [N=0, E=0, D=+1] -> losUp = -1
  const nadirRoll30 = worldLosToBodyFrame(0, 0, -1, { yawDeg: 0, pitchDeg: 0, rollDeg: 30 });
  close(nadirRoll30.bodyForward, 0.0, 1e-12, 'nadir bodyForward at +30° roll');
  close(nadirRoll30.bodyRight, 0.5, 1e-12, 'nadir bodyRight at +30° roll must be +sin(30°)=+0.5');
  close(nadirRoll30.bodyDown, Math.cos(Math.PI / 6), 1e-12, 'nadir bodyDown at +30° roll must be +cos(30°)');
  console.log('  PASS: Exact DCM orthogonality (R^T R=I, det=+1) & right-wing-down roll sign verified');
}

// ============================================================================
// 5. Constellation/MANET Terrain Awareness & Wind Triangle
// ============================================================================
console.log('\n[5/6] Verifying Terrain-Aware Constellation/MANET & Exact Wind Triangle...');
{
  // 5a. Mountain ridge blocks ACN-1 (at y=+10km), while ACN-2 (at y=-10km) has clear LOS
  const ridgeTerrain = new TerrainEngine({
    customElevationFn: (_x, y) => {
      if (y > 2000 && y < 6000) {
        return 3200 + 2500 * (1.0 - Math.abs(y - 4000) / 2000); // 5,700 m ridge at y = 4 km
      }
      return 3200;
    },
  });

  const acnStates: ConstellationAcnState[] = [
    { id: 'ACN-1', name: 'ACN-1 (Primary)', position: [0, 10000, 4800], headingDeg: 0 },
    { id: 'ACN-2', name: 'ACN-2 (Phased)', position: [0, -10000, 4800], headingDeg: 180 },
  ];
  const nodePositions = new Map<number, [number, number, number]>([[1, [0, 0, 3202]]]);
  const nodeDirectSnrMap = new Map<number, number>([[1, -25.0]]); // ACN-1 occluded by 5,700 m ridge
  const hoMap = new Map<number, NodeHandoverState>();

  const constRes = evaluateConstellationMultiAcn(
    {
      acnStates,
      primaryAcnPos: acnStates[0].position,
      nodePositions,
      nodeDirectSnrMap,
      nodeHandoverStates: hoMap,
      handoverEventsTotal: 0,
    },
    ridgeTerrain
  );
  assert.ok(constRes.acnSnrByNode[1]['ACN-2'] > 10.0, `Clear-LOS ACN-2 must achieve > 10 dB SNR, got ${constRes.acnSnrByNode[1]['ACN-2']}`);
  assert.equal(constRes.activeServingAcns[1], 'ACN-2', 'Node blocked on ACN-1 must hand over to clear-LOS ACN-2');

  // 5b. MANET routing rejects ridge-blocked peer (node 1 at (0,0) <-> node 2 at (0,8000)) while clear peer (node 3 at (3000,0)) succeeds
  const manetPositions = new Map<number, [number, number, number]>([
    [1, [0, 0, 3202]],       // Blocked from ACN
    [2, [0, 8000, 3202]],    // Gateway behind 5,700 m ridge (ridge at y=4km blocks 1<->2!)
    [3, [3000, 0, 3202]],    // Clear-LOS gateway in same valley
  ]);
  const manetSnr = new Map<number, number>([
    [1, -20.0],
    [2, 18.0],
    [3, 18.0],
  ]);
  const manetBlockedOnly = evaluateManetMeshRouting(
    {
      nodePositions: new Map([[1, [0, 0, 3202]], [2, [0, 8000, 3202]]]),
      nodeDirectSnrMap: new Map([[1, -20.0], [2, 18.0]]),
    },
    ridgeTerrain
  );
  assert.equal(manetBlockedOnly.peerLinks.length, 0, 'Ridge-blocked ground peer link must be rejected');
  assert.equal(manetBlockedOnly.manetRoutes.length, 0, 'MANET route must NOT tunnel through blocking mountain ridge');

  const manetWithClearPeer = evaluateManetMeshRouting(
    {
      nodePositions: manetPositions,
      nodeDirectSnrMap: manetSnr,
    },
    ridgeTerrain
  );
  assert.equal(manetWithClearPeer.manetRoutes.length, 1, 'Clear-LOS flanking peer must form valid MANET route');
  assert.deepEqual(manetWithClearPeer.manetRoutes[0].hops, [1, 3]);

  // 5c. Exact wind triangle: V_g = V_tas * cos(crab) + tailwind within 1e-6 m/s
  const windCases = [
    { tas: 60, track: 90, wind: 20, wdir: 0 },
    { tas: 65, track: 35, wind: 18, wdir: 120 },
    { tas: 55, track: 220, wind: 15, wdir: 40 },
    { tas: 70, track: 0, wind: 25, wdir: 180 }, // pure tailwind
  ];
  for (const wc of windCases) {
    const aero = evaluateHighAltAerodynamics({
      altitudeMslM: 5000,
      trueAirspeedMps: wc.tas,
      trackHeadingDeg: wc.track,
      windSpeedMs: wc.wind,
      windDirectionDeg: wc.wdir,
    });
    const crabRad = (aero.crabAngleDeg * Math.PI) / 180.0;
    const relWindRad = ((wc.wdir - wc.track) * Math.PI) / 180.0;
    const tailwind = -wc.wind * Math.cos(relWindRad);
    const expectedVg = wc.tas * Math.cos(crabRad) + tailwind;
    close(aero.groundSpeedMps, expectedVg, 1e-6, `Wind triangle groundspeed (track=${wc.track}, wdir=${wc.wdir})`);
  }
  console.log('  PASS: Terrain-aware constellation/MANET & exact wind triangle (< 1e-6 m/s) verified');
}

// ============================================================================
// 6. Link-Budget Unification Across Waterfall Scope & Terrain Tools
// ============================================================================
console.log('\n[6/6] Verifying Link-Budget Unification Across Waterfall Scope & Terrain Tools...');
{
  // 6a. drawLinkWaterfallCanvas reads authoritative frame.selected_link_budget directly
  const readouts = new Map<string, string>();
  const mockCtx = {
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    stroke: () => {},
    fill: () => {},
    fillText: () => {},
    setLineDash: () => {},
    scale: () => {},
    setTransform: () => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;
  const mockCanvas = {
    width: 600,
    height: 260,
    clientWidth: 600,
    clientHeight: 260,
    getBoundingClientRect: () => ({ width: 600, height: 260 }),
  } as unknown as HTMLCanvasElement;

  const mockFrame: ScientificScopeFrameTelemetry = {
    nodes_telemetry: [{ node_id: 1, name: 'S1', node_type: 'soldier', tx_power_dbm: 36, slant_range_km: 10 }],
    selected_link_budget: {
      node_id: 1,
      node_type: 'soldier',
      slant_range_km: 10.0,
      tx_power_dbm: 36.0,
      tx_gain_dbi: 3.0,
      rx_gain_dbi: 16.0,
      fspl_db: 130.51,
      gas_loss_db: 0.06,
      rain_loss_db: 1.25,
      diffraction_loss_db: 4.5,
      cable_loss_db: 1.5,
      implementation_margin_db: 2.5,
      prx_dbm: -85.32,
      pnoise_dbm: -108.5,
      sky_noise_increase_db: 0.48,
      sky_temperature_k: 72.1,
      crest_radius_m: 1200,
      curvature_loss_db: 1.1,
    },
  };
  drawLinkWaterfallCanvas(mockCanvas, mockCtx, mockFrame, 1, (id, txt) => readouts.set(id, txt));
  assert.equal(readouts.get('wf-eirp-readout'), '39.0 dBm', 'Waterfall EIRP must match selected_link_budget (36+3=39 dBm)');
  assert.equal(readouts.get('wf-fspl-readout'), '-130.5 dB', 'Waterfall FSPL must match selected_link_budget');
  assert.equal(readouts.get('wf-atm-readout'), '-1.31 dB', 'Waterfall atm loss must match selected_link_budget gas+rain');
  assert.equal(readouts.get('wf-diff-readout'), '-4.5 dB', 'Waterfall diffraction must match selected_link_budget');
  assert.equal(readouts.get('wf-prx-readout'), '-85.3 dBm', 'Waterfall Prx must match selected_link_budget directly');
  assert.equal(readouts.get('wf-pnoise-readout'), '-108.5 dBm', 'Waterfall Pnoise must match selected_link_budget directly');

  // 6b. Cursor probe, AO swath & terrain analysis match canonical LinkBudgetEngine uplink SNR (< 1.0 dB)
  const rf = new RFConfig();
  const env = new EnvironmentConfig();
  const linkEngine = new LinkBudgetEngine();
  const flatElev = () => 3500.0;
  const acnPos: [number, number, number] = [0, 10000, 5500];

  // Probe at (0, 0), mast 2 m -> zAnt = 3502 m; ACN at (0, 10000, 5500), heading 0° (probe is AFT 180°, 0° off-boresight)
  const probe = evaluateCursorRfProbe({ xM: 0, yM: 0 }, 2.0, acnPos, 0.0, flatElev);
  const ao = evaluateAoSwathAnalysis(-100, -100, 100, 100, acnPos, 0.0, flatElev, 2);
  const vtl = evaluateVirtualTerminalLink(0, 0, 3500.0, 2.0, acnPos, flatElev);
  const slantM = Math.hypot(10000, 5500 - 3502);
  const transect = computeTransectRfMetrics([3500, 3500, 3500, 3500, 3500], 10000, 2.0, 5500 - 3500);
  const canonical = linkEngine.evaluateLink({
    nodeType: 'soldier',
    slantRangeM: slantM,
    diffractionLossDb: 0.0,
    rf,
    env,
    nodeAltM: 3502,
    acnAltM: 5500,
  });

  close(probe.estSinrDb, canonical.snrDb, 0.5, 'Cursor probe SNR vs LinkBudgetEngine');
  close(ao.meanSinrDb, canonical.snrDb, 0.5, 'AO swath mean SNR vs LinkBudgetEngine');
  close(vtl.sinrDb, canonical.snrDb, 0.5, 'Virtual terminal probe SNR vs LinkBudgetEngine');
  close(transect.estSnrDb, canonical.snrDb, 0.5, 'Transect RF metrics SNR vs LinkBudgetEngine');
  console.log(`  PASS: All instruments unified within < 0.5 dB of canonical LinkBudgetEngine (${canonical.snrDb.toFixed(2)} dB)`);
}

console.log('\n' + '='.repeat(88));
console.log('  ALL REMED-03 VERIFICATION GATES PASSED (6/6 SUITES)');
console.log('='.repeat(88));
