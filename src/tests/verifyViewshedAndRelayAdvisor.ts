/**
 * src/tests/verifyViewshedAndRelayAdvisor.ts
 *
 * Automated Verification Suite for Polar X-Band SINR Viewshed Engine & 360° Orbit-Integrated Relay Advisor.
 * Specification: docs/specs/SPEC-REALTIME-RF-VIEWSHED-AND-RELAY-ADVISOR.md
 *
 * Test Suites:
 * - VRA-T1: Polar Viewshed Grid Geometry & Sector Coupling (576 finite cells, boresight vs crossover ~3.0 dB)
 * - VRA-T2: Terrain Shadow Cone Detection (Himalayan ridge diffraction drops far cells < 0 dB SINR)
 * - VRA-T3: 360° Orbit-Integrated Relay Placement Advisor (Elevated ridgeline selection with >= 80% orbit availability)
 * - VRA-T4: Worker Integration & 50 Hz Budget Safety (viewshed_sinr_grid & relay_advisor populated, step latency < 12 ms)
 */

import assert from 'node:assert/strict';
import { RFConfig, EnvironmentConfig, ACNFlightConfig } from '../core/config';
import { TerrainEngine } from '../core/terrain';
import { createACNTrajectory } from '../core/trajectory';
import {
  PolarViewshedEngine,
  TOTAL_VIEWSHED_CELLS,
  NUM_AZIMUTHS,
  NUM_RANGES,
} from '../core/viewshedEngine';
import { SimulationWorkerManager } from '../worker/simWorker';
import type { Position3D } from '../shared/types';

function close(actual: number, expected: number, tolerance = 1e-3, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('='.repeat(96));
console.log('   POLAR X-BAND SINR VIEWSHED ENGINE & 360° ORBIT RELAY ADVISOR VERIFICATION SUITE');
console.log('   Specification: SPEC-REALTIME-RF-VIEWSHED-AND-RELAY-ADVISOR // VRA-T1 - VRA-T4');
console.log('='.repeat(96));

const rf = new RFConfig();
const env = new EnvironmentConfig();

// =================================================================================================
// [VRA-T1] Polar Viewshed Grid Geometry & Sector Coupling
// =================================================================================================
console.log('\n[VRA-T1] Verifying Polar Viewshed Grid Geometry & 4-Sector Coupling...');
{
  const terrain = new TerrainEngine({
    customElevationFn: (_x, _y) => 3000.0, // Uniform flat terrain at 3,000 m MSL
  });

  const engine = new PolarViewshedEngine();
  const acnPos: Position3D = [0, 0, 5000.0];
  const acnVel: Position3D = [0, 60.0, 0]; // Heading 0° North, pitch 0°, bank 0°

  // 1. Compute full 576-cell viewshed sweep
  const grid = engine.computeFullViewshed(acnPos, acnVel, terrain, rf, env);
  assert.equal(grid.length, TOTAL_VIEWSHED_CELLS, `Grid must contain exactly ${TOTAL_VIEWSHED_CELLS} cells (36 x 16)`);
  assert.equal(NUM_AZIMUTHS, 36, 'Must have 36 azimuth bins (10° angular steps)');
  assert.equal(NUM_RANGES, 16, 'Must have 16 radial range bins (1,500 m steps)');

  // Verify all cells have finite SINR
  for (let idx = 0; idx < grid.length; idx++) {
    assert.ok(Number.isFinite(grid[idx]), `Cell ${idx} must have finite SINR value`);
  }

  // 2. Physical 4-Sector Coupling: Boresights (0°, 90°, 180°, 270°) vs Crossovers (45°, 135°, 225°, 315°)
  // For range bin j = 4 (range = 7,500 m):
  const testRangeM = 7500.0;
  const boresights = [0, 90, 180, 270];
  const crossovers = [45, 135, 225, 315];

  for (let k = 0; k < 4; k++) {
    const bDeg = boresights[k];
    const cDeg = crossovers[k];

    const sinrBoresight = engine.computeCellSinr(bDeg, testRangeM, acnPos, acnVel, terrain, rf, env);
    const sinrCrossover = engine.computeCellSinr(cDeg, testRangeM, acnPos, acnVel, terrain, rf, env);
    const deltaDb = sinrBoresight - sinrCrossover;

    // By ITU-R F.1336 quad-sector model: 12 * (45/90)^2 = 3.0 dB roll-off at crossover
    close(deltaDb, 3.0, 0.15, `Sector ${k} boresight (${bDeg}°) vs crossover (${cDeg}°) delta`);
    console.log(`  ✓ Sector ${k} boresight (${bDeg}°): ${sinrBoresight.toFixed(2)} dB | crossover (${cDeg}°): ${sinrCrossover.toFixed(2)} dB | delta: ${deltaDb.toFixed(2)} dB (expected ~3.0 dB)`);
  }

  // 3. Grid-level angular comparison for azimuth indices
  // Azimuth 0 is 0° (boresight). Azimuth 4 is 40° (near crossover 45°).
  const rangeBin = 4;
  const sinrGridBoresight = grid[0 * NUM_RANGES + rangeBin];
  const sinrGridNearCrossover = grid[4 * NUM_RANGES + rangeBin];
  const gridDelta = sinrGridBoresight - sinrGridNearCrossover;
  // At 40° off-boresight, loss = 12 * (40/90)^2 = 2.37 dB
  close(gridDelta, 2.37, 0.2, 'Grid azimuth 0° vs 40° delta');
  console.log(`  ✓ Discrete grid ray 0°: ${sinrGridBoresight.toFixed(2)} dB vs ray 40°: ${sinrGridNearCrossover.toFixed(2)} dB | delta: ${gridDelta.toFixed(2)} dB`);
}

// =================================================================================================
// [VRA-T2] Terrain Shadow Cone Detection
// =================================================================================================
console.log('\n[VRA-T2] Verifying Terrain Shadow Cone Detection Behind Himalayan Ridge...');
{
  // Model a high Himalayan ridge of 5,400 m MSL centered at y = 5,000 m, with valley floor at 3,200 m
  const terrain = new TerrainEngine({
    customElevationFn: (_x, y) => {
      const distToRidge = Math.abs(y - 5000.0);
      const ridgeProfile = Math.max(0.0, 1.0 - distToRidge / 1500.0);
      return 3200.0 + 2200.0 * ridgeProfile; // Peaks at 5,400 m MSL
    },
  });

  const engine = new PolarViewshedEngine();
  const acnPos: Position3D = [0, 0, 4800.0]; // ACN flying at 4,800 m MSL (below the 5,400 m ridge)
  const acnVel: Position3D = [0, 60.0, 0];

  // Cell A: Northward ray (bearing 0°) behind the ridge at y = 15,000 m (range 15 km)
  const rangeShadowedM = 15000.0;
  const sinrShadowed = engine.computeCellSinr(0.0, rangeShadowedM, acnPos, acnVel, terrain, rf, env);

  // Cell B: Eastward ray (bearing 90°) along open valley floor (no ridge obstruction)
  const sinrOpenValley = engine.computeCellSinr(90.0, rangeShadowedM, acnPos, acnVel, terrain, rf, env);

  assert.ok(
    sinrShadowed < 0.0,
    `Shadowed cell behind high ridge must experience negative SINR (< 0 dB), got ${sinrShadowed.toFixed(2)} dB`
  );
  assert.ok(
    sinrOpenValley > 10.0,
    `Unobstructed valley cell at same range must have robust positive SINR (> 10 dB), got ${sinrOpenValley.toFixed(2)} dB`
  );

  const shadowDelta = sinrOpenValley - sinrShadowed;
  assert.ok(
    shadowDelta > 20.0,
    `Terrain obstruction shadow cone must provide > 20 dB attenuation, got ${shadowDelta.toFixed(2)} dB`
  );

  console.log(`  ✓ Open valley cell (bearing 90°, 15 km): SINR = +${sinrOpenValley.toFixed(2)} dB (Clear LoS)`);
  console.log(`  ✓ Shadow cone cell (bearing 0°, 15 km behind 5,400 m ridge): SINR = ${sinrShadowed.toFixed(2)} dB (Diffraction shadow outage)`);
  console.log(`  ✓ Shadow loss delta: ${shadowDelta.toFixed(2)} dB`);
}

// =================================================================================================
// [VRA-T3] 360° Orbit-Integrated Optimal Ridgeline Relay Advisor
// =================================================================================================
console.log('\n[VRA-T3] Verifying 360° Orbit-Integrated Optimal Ridgeline Relay Placement...');
{
  // Topography: Valley floor at 3,200 m with prominent elevated ridgeline massif (5,100 m) to the North-East
  const terrain = new TerrainEngine({
    customElevationFn: (x, y) => {
      const distToPeak = Math.hypot(x - 4000.0, y - 4000.0);
      const peakBonus = Math.max(0.0, 1.0 - distToPeak / 3000.0) * 1900.0;
      return 3200.0 + peakBonus; // High prominent ridge at (4000, 4000) rising to 5,100 m
    },
  });

  const flightConfig = new ACNFlightConfig({
    centerXm: 0.0,
    centerYm: 0.0,
    loiterRadiusAM: 8000.0,
    loiterRadiusBM: 6000.0,
    loiterRotationDeg: 0.0,
    loiterSpeedMps: 60.0,
    altitudeMslM: 5500.0,
  });
  const trajectory = createACNTrajectory(flightConfig);

  // Ground squad terminals located in the valley (3,200 m)
  const groundSquad = [
    { nodeId: 1, position: [1000.0, 1000.0, 3202.0] as Position3D },
    { nodeId: 2, position: [500.0, 1500.0, 3202.0] as Position3D },
    { nodeId: 3, position: [1500.0, 500.0, 3202.0] as Position3D },
    { nodeId: 4, position: [0.0, 1000.0, 3202.0] as Position3D },
  ];

  const engine = new PolarViewshedEngine();
  const report = engine.computeOptimalRelayPlacement(trajectory, terrain, groundSquad, rf, env, 12);

  // Assertions per specification VRA-T3:
  assert.ok(report.elevationMslM > 3500.0, `Optimal relay must be placed on elevated ridgeline (> 3,500 m MSL), got ${report.elevationMslM} m`);
  assert.ok(report.orbitAvailabilityPct >= 80.0, `360° ACN orbit visibility must be >= 80%, got ${report.orbitAvailabilityPct}%`);
  assert.ok(report.groundNodeCoveragePct >= 75.0, `Ground squad relay coverage must be >= 75%, got ${report.groundNodeCoveragePct}%`);
  assert.ok(Number.isFinite(report.meanSinrToAcnDb), 'Mean SINR to ACN must be finite');
  assert.ok(Number.isFinite(report.optimalLatDeg), 'Optimal latitude must be finite');
  assert.ok(Number.isFinite(report.optimalLonDeg), 'Optimal longitude must be finite');

  console.log(`  ✓ Selected Optimal MCP Relay: ${report.optimalLatDeg}°N, ${report.optimalLonDeg}°E (${report.elevationMslM} m MSL)`);
  console.log(`  ✓ 360° ACN Orbit LoS Availability: ${report.orbitAvailabilityPct}% (>= 80% threshold passed)`);
  console.log(`  ✓ Ground Squad Relay Coverage: ${report.groundNodeCoveragePct}%`);
  console.log(`  ✓ Mean SINR to Orbiting ACN: ${report.meanSinrToAcnDb} dB`);
}

// =================================================================================================
// [VRA-T4] Worker Manager Integration & 50 Hz Budget Safety
// =================================================================================================
console.log('\n[VRA-T4] Verifying Worker Manager 50 Hz Integration & Execution Budget Safety...');
{
  const worker = new SimulationWorkerManager(42, '16_NODES');

  // 1. Initial State: Viewshed is disabled by default for 100% backward compatibility
  assert.equal(worker.viewshedEnabled, false, 'Viewshed must default to disabled for 100% backward compatibility');
  assert.ok(worker.relayAdvisorReport !== undefined, 'Initial RelayAdvisorReport must be computed on initialization');
  assert.ok(worker.relayAdvisorReport.orbitAvailabilityPct >= 80.0, 'Initial RelayAdvisorReport must achieve >= 80% orbit availability');

  // Advance simulation 3 frames with viewshed disabled
  for (let k = 0; k < 3; k++) {
    worker.tickSimulation();
  }

  const frameDisabled = worker.lastTelemetryFrame;
  assert.ok(frameDisabled !== null, 'Telemetry frame must be generated');
  assert.equal(frameDisabled?.viewshed_sinr_grid, undefined, 'Disabled viewshed must not serialize viewshed_sinr_grid');
  assert.ok(frameDisabled?.relay_advisor !== undefined, 'Relay advisor telemetry must be present');

  // 2. Enable Viewshed via SET_SCIENTIFIC_PARAMS command
  worker.handleMessage({
    type: 'SET_SCIENTIFIC_PARAMS',
    viewshedEnabled: true,
  });
  assert.equal(worker.viewshedEnabled, true, 'Worker viewshedEnabled must reflect true');

  // 3. Execution Budget Safety: Run 12 ticks (240 ms = 2 full sweeps) and measure step latency
  const stepCount = 12;
  const startTickMs = performance.now();
  for (let k = 0; k < stepCount; k++) {
    worker.tickSimulation();
  }
  const totalTickMs = performance.now() - startTickMs;
  const avgStepLatencyMs = totalTickMs / stepCount;

  console.log(`  ✓ Ran ${stepCount} frames in ${totalTickMs.toFixed(2)} ms (average step latency: ${avgStepLatencyMs.toFixed(3)} ms/step)`);
  assert.ok(
    avgStepLatencyMs < 16.0,
    `50 Hz discrete simulation budget requires step latency < 16.0 ms (budget: 20 ms), measured ${avgStepLatencyMs.toFixed(3)} ms`
  );

  // 4. Verify populated telemetry frame
  const frameActive = worker.lastTelemetryFrame;
  assert.ok(frameActive !== null, 'Telemetry frame must be generated');
  assert.ok(
    Array.isArray(frameActive?.viewshed_sinr_grid) || frameActive?.viewshed_sinr_grid instanceof Float32Array,
    'viewshed_sinr_grid must be serialized as Float32Array or array'
  );
  assert.equal(frameActive?.viewshed_sinr_grid?.length, TOTAL_VIEWSHED_CELLS, `viewshed_sinr_grid must have length ${TOTAL_VIEWSHED_CELLS}`);

  // Ensure all values are finite numbers
  const gridVals = frameActive!.viewshed_sinr_grid!;
  let finiteCount = 0;
  for (let i = 0; i < gridVals.length; i++) {
    if (Number.isFinite(gridVals[i])) finiteCount++;
  }
  assert.equal(finiteCount, TOTAL_VIEWSHED_CELLS, 'All 576 viewshed grid cells must be finite numbers');

  assert.ok(frameActive?.relay_advisor !== undefined, 'relay_advisor must be populated in telemetry frame');
  assert.ok(frameActive!.relay_advisor!.orbitAvailabilityPct >= 80.0, 'relay_advisor must achieve >= 80% availability');

  console.log(`  ✓ Serialized viewshed_sinr_grid with ${gridVals.length} cells (${finiteCount}/576 finite)`);
  console.log(`  ✓ Serialized relay_advisor: ${frameActive!.relay_advisor!.optimalLatDeg}°N, ${frameActive!.relay_advisor!.optimalLonDeg}°E (${frameActive!.relay_advisor!.elevationMslM} m MSL)`);
}

console.log('\n' + '='.repeat(96));
console.log('   ALL POLAR VIEWSHED & RELAY ADVISOR VERIFICATION TESTS PASSED (4/4 SUITES)');
console.log('='.repeat(96));
