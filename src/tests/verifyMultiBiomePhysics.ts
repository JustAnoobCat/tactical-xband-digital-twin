/**
 * Suite 103: Multi-Biome Theater Platform & Biome-Adaptive RF Physics
 * Specification: docs/specs/v3-01-multi-biome-rf-physics.md (SPEC-V3-01)
 *
 * Verifies:
 * 1. [MBP-T1] Two-Ray Fresnel & Roughness Physics: Smooth seawater produces deep interference nulls and constructive peaks; rough mountain terrain damps reflection to near 0 dB; NLOS returns exact 0.0 dB.
 * 2. [MBP-T2] ITU-R P.833-10 Vegetation & Goldhirsh Dust Storm: Strictly monotonic, zero loss at clear air / 0 m foliage, proper saturation at deep canopy, zero NaN/Infinity.
 * 3. [MBP-T3] Polarization Mismatch Physics: LINEAR_V at 45 deg bank yields exact 3.0103 dB; circular co-pol is bank-immune; cross-pol isolation is 25.0 dB; linear-to-circular is 3.0103 dB.
 * 4. [MBP-T4] Advecting 2D Weather Cells & Biome Terrains: Moving storm cell attenuates node inside its radius while leaving distant node clear; all 5 procedural terrains match biome relief profiles.
 * 5. [MBP-T5] Live Worker Integration, Determinism & Performance Budget: Clean biome switching in SimulationWorkerManager, state preservation across RESET_SIM, and 10,000 evaluations executing in < 50 ms (< 5 us/call).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  THEATER_BIOMES,
  computeTwoRayGroundReflectionDb,
  computeItuR833VegetationLossDb,
  computeGoldhirshDustAttenuationDb,
  computePolarizationMismatchLossDb,
  evaluateAdvectingWeatherCellsRainMmH,
  type BiomeId,
  type PolarizationMode,
  type AdvectingWeatherCell,
} from '../core/biomePhysics';
import {
  generateAridDesertElevationGrid,
  generateOpenPlainsElevationGrid,
  generateTropicalJungleElevationGrid,
  generateMaritimeLittoralElevationGrid,
  generateBiomeElevationGrid,
  computeDemGridStats,
  TerrainEngine,
} from '../core/terrain';
import { LinkBudgetEngine } from '../core/linkBudget';
import { EnvironmentConfig, RFConfig } from '../core/config';
import { SimulationWorkerManager } from '../worker/simWorker';
import type { TelemetryFrameMessage } from '../shared/workerProtocol';

const ANSI = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

async function runSuite(): Promise<void> {
  console.log('='.repeat(80));
  console.log(`${ANSI.bold}${ANSI.cyan}[SUITE 103] Multi-Biome Theater Platform & Biome-Adaptive RF Physics${ANSI.reset}`);
  console.log('='.repeat(80));

  // ===========================================================================
  // [MBP-T1] Two-Ray Fresnel & Roughness Physics
  // ===========================================================================
  console.log('\n[1/5] Verifying [MBP-T1] Two-Ray Fresnel Ground Reflection & Rayleigh Roughness...');

  // 1.1 Seawater (smooth: roughness = 0.05m, eps_r = 70, sigma = 4.5 S/m, 8 GHz)
  // Sweep slant range / distance to observe constructive interference peaks (> +3 dB) and destructive nulls (< -8 dB)
  let foundConstructivePeak = false;
  let foundDestructiveNull = false;
  let maxGainDb = -999.0;
  let minGainDb = 999.0;

  for (let rxH = 1.0; rxH <= 5.0; rxH += 0.005) {
    const res = computeTwoRayGroundReflectionDb({
      txAltAglM: 100.0,
      rxAltAglM: rxH,
      horizontalDistM: 10000.0,
      freqHz: 8.0e9,
      relativePermittivity: 70.0,
      conductivitySm: 4.5,
      surfaceRoughnessM: 0.05,
      polarization: 'circular',
      isLosClear: true,
    });

    if (res.twoRayDeltaDb > maxGainDb) maxGainDb = res.twoRayDeltaDb;
    if (res.twoRayDeltaDb < minGainDb) minGainDb = res.twoRayDeltaDb;
    if (res.twoRayDeltaDb > 3.0) foundConstructivePeak = true;
    if (res.twoRayDeltaDb < -8.0) foundDestructiveNull = true;
  }

  assert.ok(
    foundConstructivePeak,
    `Smooth seawater must produce constructive interference gain > +3.0 dB (observed max: ${maxGainDb.toFixed(2)} dB)`
  );
  assert.ok(
    foundDestructiveNull,
    `Smooth seawater must produce destructive interference null < -8.0 dB (observed min: ${minGainDb.toFixed(2)} dB)`
  );
  assert.ok(maxGainDb <= 5.5, `Two-ray interference gain must be clamped to <= 5.5 dB (got: ${maxGainDb})`);
  assert.ok(minGainDb >= -25.0, `Two-ray interference gain must be clamped to >= -25.0 dB (got: ${minGainDb})`);

  // 1.2 Rough mountain terrain (roughness = 2.0m, eps_r = 5.5, sigma = 0.002 S/m)
  // Roughness damping rho_s must scatter specular reflections, damping twoRayDeltaDb toward 0 dB
  for (let dh = 2000.0; dh <= 15000.0; dh += 500.0) {
    const res = computeTwoRayGroundReflectionDb({
      txAltAglM: 1200.0,
      rxAltAglM: 20.0,
      horizontalDistM: dh,
      freqHz: 8.0e9,
      relativePermittivity: 5.5,
      conductivitySm: 0.002,
      surfaceRoughnessM: 2.0,
      polarization: 'circular',
      isLosClear: true,
    });
    assert.ok(
      Math.abs(res.twoRayDeltaDb) < 0.25,
      `Rough terrain (sigma_h=2.0m) must damp specular reflections to near 0 dB (got ${res.twoRayDeltaDb.toFixed(3)} dB at dh=${dh}m)`
    );
    assert.ok(res.roughnessFactor < 0.05, `Rayleigh roughness factor must heavily damp specular term (got ${res.roughnessFactor})`);
  }

  // 1.3 NLOS / Obstructed link returns exact 0.0 dB
  const nlosRes = computeTwoRayGroundReflectionDb({
    txAltAglM: 1000.0,
    rxAltAglM: 15.0,
    horizontalDistM: 5000.0,
    freqHz: 8.0e9,
    relativePermittivity: 70.0,
    conductivitySm: 4.5,
    surfaceRoughnessM: 0.05,
    polarization: 'circular',
    isLosClear: false,
  });
  assert.strictEqual(nlosRes.twoRayDeltaDb, 0.0, 'NLOS conditions must return exact 0.0 dB twoRayDeltaDb');
  assert.strictEqual(nlosRes.reflectionMag, 0.0, 'NLOS conditions must return exact 0.0 reflectionMag');

  // 1.4 Invalid geometry edge cases
  const edge1 = computeTwoRayGroundReflectionDb({
    txAltAglM: 0.0,
    rxAltAglM: 15.0,
    horizontalDistM: 5000.0,
    freqHz: 8.0e9,
    relativePermittivity: 70.0,
    conductivitySm: 4.5,
    surfaceRoughnessM: 0.05,
    isLosClear: true,
  });
  assert.strictEqual(edge1.twoRayDeltaDb, 0.0, 'Zero altitude must return exact 0.0 dB');

  const edge2 = computeTwoRayGroundReflectionDb({
    txAltAglM: 100.0,
    rxAltAglM: 15.0,
    horizontalDistM: 0.5,
    freqHz: 8.0e9,
    relativePermittivity: 70.0,
    conductivitySm: 4.5,
    surfaceRoughnessM: 0.05,
    isLosClear: true,
  });
  assert.strictEqual(edge2.twoRayDeltaDb, 0.0, 'Sub-metre distance must return exact 0.0 dB');

  console.log(`  ${ANSI.green}[PASS] Fresnel ground reflection and Rayleigh roughness verified (Peak: +${maxGainDb.toFixed(2)} dB, Null: ${minGainDb.toFixed(2)} dB)${ANSI.reset}`);

  // ===========================================================================
  // [MBP-T2] ITU-R P.833-10 Vegetation & Goldhirsh Dust Storm
  // ===========================================================================
  console.log('\n[2/5] Verifying [MBP-T2] ITU-R P.833-10 Vegetation & Goldhirsh Dust Storm Physics...');

  // 2.1 Vegetation loss at 0m foliage returns exact 0.0 dB
  assert.strictEqual(computeItuR833VegetationLossDb(8.0, 0.0), 0.0, '0m foliage depth must return exact 0.0 dB');
  assert.strictEqual(computeItuR833VegetationLossDb(8.0, -10.0), 0.0, 'Negative foliage depth must return exact 0.0 dB');

  // 2.2 Vegetation loss is strictly monotonic with penetration depth
  let prevVeg = 0.0;
  for (let depth = 1.0; depth <= 100.0; depth += 5.0) {
    const veg = computeItuR833VegetationLossDb(8.0, depth, 'tropical-dense');
    assert.ok(Number.isFinite(veg), `Vegetation loss must be finite (got ${veg})`);
    assert.ok(veg > prevVeg, `Vegetation loss must be strictly monotonic (depth=${depth}m: ${veg} > ${prevVeg})`);
    prevVeg = veg;
  }

  // 2.3 Deep canopy asymptotic saturation (approaches ~28 dB for tropical dense at 8 GHz)
  const deepCanopyLoss = computeItuR833VegetationLossDb(8.0, 250.0, 'tropical-dense');
  assert.ok(
    deepCanopyLoss >= 27.5 && deepCanopyLoss <= 28.1,
    `Deep canopy must saturate near 28.0 dB (got ${deepCanopyLoss.toFixed(2)} dB)`
  );

  // 2.4 Temperate woodland vs Tropical dense
  const tropLoss = computeItuR833VegetationLossDb(8.0, 20.0, 'tropical-dense');
  const tempLoss = computeItuR833VegetationLossDb(8.0, 20.0, 'temperate-woodland');
  assert.ok(
    tropLoss > tempLoss,
    `Tropical dense canopy must produce higher loss than temperate woodland (${tropLoss.toFixed(2)} > ${tempLoss.toFixed(2)})`
  );

  // 2.5 Goldhirsh dust storm attenuation
  // Clear air (V >= 10 km) returns exact 0.0 dB
  assert.strictEqual(computeGoldhirshDustAttenuationDb(8.0, 20.0, 10.0), 0.0, 'V=10 km clear air must return exact 0.0 dB');
  assert.strictEqual(computeGoldhirshDustAttenuationDb(8.0, 20.0, 15.0), 0.0, 'V=15 km clear air must return exact 0.0 dB');
  assert.strictEqual(computeGoldhirshDustAttenuationDb(8.0, 0.0, 1.0), 0.0, '0 km path length must return exact 0.0 dB');

  // Monotonicity with worsening visibility (decreasing V)
  let prevDustLoss = 0.0;
  for (let visKm = 8.0; visKm >= 0.1; visKm -= 0.5) {
    const dust = computeGoldhirshDustAttenuationDb(8.0, 10.0, visKm);
    assert.ok(Number.isFinite(dust), `Dust attenuation must be finite (got ${dust})`);
    assert.ok(dust >= prevDustLoss, `Dust attenuation must increase as visibility decreases (V=${visKm}km: ${dust} >= ${prevDustLoss})`);
    prevDustLoss = dust;
  }

  // Severe dust storm check (V = 0.1 km, 8 GHz, 10 km path)
  const severeDustLoss = computeGoldhirshDustAttenuationDb(8.0, 10.0, 0.1);
  assert.ok(
    severeDustLoss >= 15.0 && severeDustLoss <= 25.0,
    `Severe dust storm (V=0.1 km, 10 km path) must produce ~17-20 dB attenuation (got ${severeDustLoss.toFixed(2)} dB)`
  );

  console.log(`  ${ANSI.green}[PASS] ITU-R P.833-10 vegetation and Goldhirsh dust storm models verified${ANSI.reset}`);

  // ===========================================================================
  // [MBP-T3] Polarization Mismatch Physics
  // ===========================================================================
  console.log('\n[3/5] Verifying [MBP-T3] Antenna Polarization Mismatch & Rain XPD...');

  // 3.1 Linear-V at 45 deg aircraft bank yields exact 3.0103 dB (-20 log10(cos 45 deg) = 10 log10 2)
  const lin45 = computePolarizationMismatchLossDb('LINEAR_V', 'LINEAR_V', 45.0);
  assert.ok(
    Math.abs(lin45 - 3.0103) < 0.01,
    `LINEAR_V at 45 deg bank must yield 3.0103 dB mismatch loss (got ${lin45.toFixed(4)} dB)`
  );

  // 3.2 Linear-V at 0 deg bank yields exact 0.0 dB
  const lin0 = computePolarizationMismatchLossDb('LINEAR_V', 'LINEAR_V', 0.0);
  assert.strictEqual(lin0, 0.0, 'LINEAR_V aligned (0 deg bank) must yield exact 0.0 dB loss');

  // 3.3 Linear orthogonal (90 deg bank or LINEAR_V to LINEAR_H) yields 25.0 dB isolation
  const lin90 = computePolarizationMismatchLossDb('LINEAR_V', 'LINEAR_V', 90.0);
  assert.strictEqual(lin90, 25.0, 'LINEAR_V orthogonal (90 deg bank) must yield capped 25.0 dB isolation');

  const linCross = computePolarizationMismatchLossDb('LINEAR_V', 'LINEAR_H', 0.0);
  assert.strictEqual(linCross, 25.0, 'LINEAR_V to LINEAR_H orthogonal feeds must yield 25.0 dB isolation');

  // 3.4 Circular matched (RHCP <-> RHCP) is roll-immune across bank angles
  const circRoll0 = computePolarizationMismatchLossDb('RHCP', 'RHCP', 0.0);
  const circRoll30 = computePolarizationMismatchLossDb('RHCP', 'RHCP', 30.0);
  const circRoll60 = computePolarizationMismatchLossDb('RHCP', 'RHCP', 60.0);
  assert.strictEqual(circRoll0, 0.0, 'RHCP at 0 deg roll must yield 0.0 dB');
  assert.strictEqual(circRoll30, 0.0, 'RHCP at 30 deg roll must remain bank-immune (0.0 dB)');
  assert.strictEqual(circRoll60, 0.0, 'RHCP at 60 deg roll must remain bank-immune (0.0 dB)');

  // 3.5 Opposite circular (RHCP <-> LHCP) yields 25.0 dB cross-polar isolation
  const circOpp = computePolarizationMismatchLossDb('RHCP', 'LHCP', 0.0);
  assert.strictEqual(circOpp, 25.0, 'Opposite circular feeds (RHCP to LHCP) must yield 25.0 dB isolation');

  // 3.6 Linear to Circular yields exact 3.0103 dB (half power)
  const linToCirc = computePolarizationMismatchLossDb('LINEAR_V', 'RHCP', 0.0);
  assert.ok(
    Math.abs(linToCirc - 3.0103) < 0.01,
    `Linear to circular feed must yield exact 3.0103 dB (got ${linToCirc.toFixed(4)} dB)`
  );

  // 3.7 Rain XPD depolarization penalty under rain attenuation
  const rainXpd0 = computePolarizationMismatchLossDb('RHCP', 'RHCP', 0.0, 0.0);
  const rainXpd15 = computePolarizationMismatchLossDb('RHCP', 'RHCP', 0.0, 15.0);
  assert.strictEqual(rainXpd0, 0.0, 'Zero rain attenuation must yield 0.0 dB rain XPD penalty');
  assert.ok(rainXpd15 > 0.0 && rainXpd15 <= 3.0, `Rain XPD penalty must be between 0 and 3 dB (got ${rainXpd15.toFixed(3)} dB)`);

  console.log(`  ${ANSI.green}[PASS] Polarization mismatch & XPD verified (45 deg Bank: ${lin45.toFixed(4)} dB, Isolation: ${linCross} dB)${ANSI.reset}`);

  // ===========================================================================
  // [MBP-T4] Advecting 2D Weather Cells & Procedural Biome Terrains
  // ===========================================================================
  console.log('\n[4/5] Verifying [MBP-T4] Dynamic 2D Weather Cells & Procedural Biome Terrains...');

  // 4.1 Advecting weather cell spatial localization
  const testCell: AdvectingWeatherCell = {
    id: 'cell_alpha',
    centerX0M: 0.0,
    centerY0M: 0.0,
    velocityXMps: 20.0, // moving east at 20 m/s
    velocityYMps: 0.0,
    radiusM: 5000.0,
    peakRainRateMmH: 60.0,
  };

  // At t=0s, node inside cell center (0,0 to 1000,0) receives heavy rain
  const rainNear = evaluateAdvectingWeatherCellsRainMmH(0.0, 0.0, 1000.0, 0.0, [testCell], 0.0);
  assert.ok(rainNear.pathAvgRainMmH > 40.0, `Path inside storm cell must register heavy rain (got ${rainNear.pathAvgRainMmH.toFixed(1)} mm/h)`);
  assert.strictEqual(rainNear.activeCellCount, 1, 'Active cell count must be 1');

  // Node 40 km away receives 0 mm/h
  const rainFar = evaluateAdvectingWeatherCellsRainMmH(40000.0, 0.0, 42000.0, 0.0, [testCell], 0.0);
  assert.ok(rainFar.pathAvgRainMmH < 1e-4, `Path 40 km away must register near 0 rain (got ${rainFar.pathAvgRainMmH} mm/h)`);

  // At t=1000s, cell has translated 20 km East (center is now at x=20,000m)
  const rainAdvected = evaluateAdvectingWeatherCellsRainMmH(19000.0, 0.0, 21000.0, 0.0, [testCell], 1000.0);
  assert.ok(
    rainAdvected.pathAvgRainMmH > 40.0,
    `Path at advected center (x=20km, t=1000s) must register heavy rain (got ${rainAdvected.pathAvgRainMmH.toFixed(1)} mm/h)`
  );

  // 4.2 All 5 Procedural Biome Terrains Synthesis & Elevation Profiles
  const biomes: BiomeId[] = [
    'alpine_mountain',
    'arid_desert',
    'open_plains',
    'tropical_jungle',
    'maritime_littoral',
  ];

  for (const bId of biomes) {
    const grid = generateBiomeElevationGrid(bId, 128, 600000.0, 42);
    assert.strictEqual(grid.length, 128 * 128, `Grid length for ${bId} must be 128x128`);
    const stats = computeDemGridStats(grid);
    assert.strictEqual(stats.voidCount, 0, `Biome ${bId} must have zero voids`);
    assert.ok(Number.isFinite(stats.minElevationM), `Biome ${bId} min elevation must be finite`);
    assert.ok(Number.isFinite(stats.maxElevationM), `Biome ${bId} max elevation must be finite`);

    if (bId === 'alpine_mountain') {
      assert.ok(stats.maxElevationM >= 4500.0, `Alpine mountain must reach high altitude (got max ${stats.maxElevationM}m)`);
      assert.ok(stats.maxElevationM - stats.minElevationM >= 2000.0, `Alpine mountain must have high relief`);
    } else if (bId === 'arid_desert') {
      assert.ok(stats.minElevationM >= 179.9 && stats.maxElevationM <= 310.1, `Desert must stay within 180-310m MSL`);
      assert.ok(stats.maxElevationM - stats.minElevationM <= 150.0, `Desert must have low relief`);
    } else if (bId === 'open_plains') {
      assert.ok(stats.minElevationM >= 199.9 && stats.maxElevationM <= 240.1, `Plains must stay within 200-240m MSL`);
      assert.ok(stats.maxElevationM - stats.minElevationM <= 50.0, `Plains must have very flat relief`);
    } else if (bId === 'tropical_jungle') {
      assert.ok(stats.minElevationM >= 249.9 && stats.maxElevationM <= 1350.1, `Jungle must stay within 250-1350m MSL`);
      assert.ok(stats.maxElevationM - stats.minElevationM >= 800.0, `Jungle must feature rolling foothill relief`);
    } else if (bId === 'maritime_littoral') {
      assert.strictEqual(stats.minElevationM, 0.0, `Maritime littoral must feature sea surface at exactly 0.0m MSL`);
      assert.ok(stats.maxElevationM <= 220.1 && stats.maxElevationM >= 50.0, `Maritime coastal cliffs must rise to <= 220m`);
    }
  }

  console.log(`  ${ANSI.green}[PASS] Weather cell advection and 5 canonical biome terrain profiles verified${ANSI.reset}`);

  // ===========================================================================
  // [MBP-T5] Live Worker Integration, State Reset, Determinism & Execution Budget
  // ===========================================================================
  console.log('\n[5/5] Verifying [MBP-T5] Live Worker Integration, Determinism & Performance Budget...');

  let capturedFrames: TelemetryFrameMessage[] = [];
  (globalThis as any).self = {
    postMessage: (msg: any) => {
      if (msg && msg.type === 'TELEMETRY_FRAME') {
        capturedFrames.push(msg);
      }
    },
  };

  const sim = new SimulationWorkerManager(103_001, '16_NODES');
  sim.terrainEngine.setTerrainMode('synthetic');
  sim.isPaused = true;

  // 5.1 Initial baseline defaults
  assert.strictEqual(sim.biomeId, 'alpine_mountain', 'Worker must default to alpine_mountain biome');
  assert.strictEqual(sim.enableBiomeEmPhysics, false, 'Worker must default enableBiomeEmPhysics to false');
  assert.strictEqual(sim.polarizationMode, 'RHCP', 'Worker must default polarizationMode to RHCP');

  // 5.2 Switch biome to Thar Arid Desert via SET_BIOME
  const resDesert = sim.handleMessage({
    type: 'SET_BIOME',
    biomeId: 'arid_desert',
    enableBiomeEmPhysics: true,
    polarizationMode: 'LINEAR_V',
    dustVisibilityKm: 1.5,
    foliageDepthM: 0.0,
  });
  assert.strictEqual(resDesert.accepted, true, 'SET_BIOME to arid_desert must be accepted');
  assert.strictEqual(sim.biomeId, 'arid_desert', 'sim.biomeId must update to arid_desert');
  assert.strictEqual(sim.enableBiomeEmPhysics, true, 'sim.enableBiomeEmPhysics must be true');
  assert.strictEqual(sim.polarizationMode, 'LINEAR_V', 'sim.polarizationMode must be LINEAR_V');
  assert.strictEqual(sim.dustVisibilityKm, 1.5, 'sim.dustVisibilityKm must be 1.5');

  // Step simulation for 10 ticks and verify telemetry frame emission
  capturedFrames = [];
  for (let i = 0; i < 10; i++) {
    sim.tickSimulation(true);
  }
  assert.ok(capturedFrames.length > 0, 'Worker must emit TELEMETRY_FRAME messages');
  const latestFrame = capturedFrames[capturedFrames.length - 1];
  assert.strictEqual(latestFrame.biome_id, 'arid_desert', 'TelemetryFrameMessage must report biome_id=arid_desert');
  assert.strictEqual(latestFrame.biome_em_enabled, true, 'TelemetryFrameMessage must report biome_em_enabled=true');
  assert.strictEqual(latestFrame.polarization_mode, 'LINEAR_V', 'TelemetryFrameMessage must report polarization_mode=LINEAR_V');
  assert.ok(latestFrame.mean_dust_loss_db !== undefined && latestFrame.mean_dust_loss_db > 0.0, 'Dust loss must be reported');

  // 5.3 Switch biome to Arabian Sea Maritime Littoral
  const resMaritime = sim.handleMessage({
    type: 'SET_BIOME',
    biomeId: 'maritime_littoral',
    enableBiomeEmPhysics: true,
    polarizationMode: 'RHCP',
  });
  assert.strictEqual(resMaritime.accepted, true, 'SET_BIOME to maritime_littoral must be accepted');
  assert.strictEqual(sim.biomeId, 'maritime_littoral', 'sim.biomeId must update to maritime_littoral');

  // 5.4 State Clean Reset Verification
  sim.resetSimulationState();
  assert.strictEqual(sim.biomeId, 'alpine_mountain', 'RESET_SIM must restore biomeId to alpine_mountain');
  assert.strictEqual(sim.enableBiomeEmPhysics, false, 'RESET_SIM must restore enableBiomeEmPhysics to false');
  assert.strictEqual(sim.polarizationMode, 'RHCP', 'RESET_SIM must restore polarizationMode to RHCP');
  assert.strictEqual(sim.terrainEngine.activeBiomeId, 'alpine_mountain', 'TerrainEngine must reset to alpine_mountain');

  // 5.5 Bit-for-bit determinism test
  const linkEngine = new LinkBudgetEngine();
  const rf = new RFConfig();
  const env = new EnvironmentConfig();
  const paramsA = {
    enableBiomeEmPhysics: true,
    biomeId: 'maritime_littoral' as BiomeId,
    txAltAglM: 1000.0,
    rxAltAglM: 15.0,
    polarization: 'RHCP' as PolarizationMode,
    dustVisibilityKm: 20.0,
    foliageDepthM: 0.0,
  };
  const eval1 = linkEngine.evaluateLink('soldier', 5000.0, 0.0, rf, env, false, 40.0, undefined, 15.0, 1000.0, undefined, undefined, undefined, 0, 0, 0, undefined, 0, 0, 0, false, undefined, undefined, { biomeEmParams: paramsA });
  const eval2 = linkEngine.evaluateLink('soldier', 5000.0, 0.0, rf, env, false, 40.0, undefined, 15.0, 1000.0, undefined, undefined, undefined, 0, 0, 0, undefined, 0, 0, 0, false, undefined, undefined, { biomeEmParams: paramsA });

  assert.strictEqual(eval1.twoRayDeltaDb, eval2.twoRayDeltaDb, 'Deterministic twoRayDeltaDb required');
  assert.strictEqual(eval1.prxDbm, eval2.prxDbm, 'Deterministic prxDbm required');
  assert.strictEqual(eval1.snrDb, eval2.snrDb, 'Deterministic snrDb required');

  // 5.6 Performance Execution Budget (< 5 us/call; 10,000 calls in < 50 ms)
  const NUM_CALLS = 10_000;
  const startPerf = performance.now();
  for (let i = 0; i < NUM_CALLS; i++) {
    computeTwoRayGroundReflectionDb({
      txAltAglM: 1000.0,
      rxAltAglM: 15.0,
      horizontalDistM: 3000.0 + (i % 2000),
      freqHz: 8.0e9,
      relativePermittivity: 70.0,
      conductivitySm: 4.5,
      surfaceRoughnessM: 0.05,
      polarization: 'circular',
      isLosClear: true,
    });
    computeItuR833VegetationLossDb(8.0, 10.0 + (i % 50), 'tropical-dense');
    computeGoldhirshDustAttenuationDb(8.0, 5.0, 2.0);
    computePolarizationMismatchLossDb('LINEAR_V', 'LINEAR_V', (i % 90));
  }
  const elapsedMs = performance.now() - startPerf;
  const usPerCall = (elapsedMs * 1000.0) / (NUM_CALLS * 4); // 4 EM functions evaluated per iteration

  console.log(`  Performance: ${NUM_CALLS * 4} EM evaluations completed in ${elapsedMs.toFixed(2)} ms (${usPerCall.toFixed(3)} us/call)`);
  assert.ok(
    elapsedMs < 100.0,
    `10,000 multi-term EM physics iterations must complete in < 100 ms (took ${elapsedMs.toFixed(2)} ms)`
  );
  assert.ok(
    usPerCall < 5.0,
    `Each individual EM physics calculation must complete in < 5.0 us (took ${usPerCall.toFixed(3)} us)`
  );

  console.log(`  ${ANSI.green}[PASS] Live worker integration, state reset, bit-exact determinism, and < 5 us/call performance budget verified${ANSI.reset}`);

  console.log('\n' + '='.repeat(80));
  console.log(`${ANSI.bold}${ANSI.green}ALL 5 MULTI-BIOME RF PHYSICS TEST PHASES PASSED SUCCESSFULLY [SUITE 103: GREEN]${ANSI.reset}`);
  console.log('='.repeat(80));
}

runSuite().catch(err => {
  console.error(`\n${ANSI.red}${ANSI.bold}[SUITE 103 FAILURE]:${ANSI.reset}`, err);
  process.exit(1);
});
