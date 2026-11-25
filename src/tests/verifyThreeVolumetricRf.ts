/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Verification Suite 109: 3D Volumetric RF Visualization & Interactive Raycast Picking
 *
 * Verifies:
 * [VRF-T1] Exact Analytical Fresnel Ellipsoid Geometry & SO(3) Orthonormality (40km, DVB-S2X, B^T*B=I, det=+1)
 * [VRF-T2] 3D Banking Quad-Sector Lobe Attitude Physics (Tait-Bryan right bank tilts starboard down, port up)
 * [VRF-T3] Threat/Weather Volumes, CVD Color Mapping & Deterministic Proximity Picking
 * [VRF-T4] Three.js Layer Lifecycle, Zero-Allocation Micro-Benchmark & UI Contract in index.html
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SPEED_OF_LIGHT_M_S,
  DEFAULT_X_BAND_FREQ_HZ,
  computeFresnelEllipsoidTransform,
  computeQuadSectorLobeTransforms,
  computeThreatAndWeatherVolumes,
  resolveFresnelStatusColor,
  pickNearestEntityFromWorldHit,
  Vector3Tuple,
} from '../ui/three/threeVolumetricRfMath';
import {
  ThreeVolumetricRfLayer,
  MAX_PREALLOCATED_ELLIPSOIDS,
  MAX_PREALLOCATED_WEATHER_CELLS,
} from '../ui/three/threeVolumetricRfLayer';
import type { NodeTelemetryItem, TelemetryFrame } from '../shared/workerProtocol';
import { NodeTerrainState } from '../core/trajectory';
import {
  LATTICE_CANVAS_STANDARD,
  LATTICE_CANVAS_CVD,
} from '../ui/canvasTheme';

// Matrix determinant helper for 3x3 basis [col0, col1, col2]
function det3x3(col0: Vector3Tuple, col1: Vector3Tuple, col2: Vector3Tuple): number {
  return (
    col0[0] * (col1[1] * col2[2] - col1[2] * col2[1]) -
    col0[1] * (col1[0] * col2[2] - col1[2] * col2[0]) +
    col0[2] * (col1[0] * col2[1] - col1[1] * col2[0])
  );
}

// Compute max deviation of B^T * B from Identity 3x3
function maxOrthonormalError(col0: Vector3Tuple, col1: Vector3Tuple, col2: Vector3Tuple): number {
  const cols = [col0, col1, col2];
  let maxErr = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const dot = cols[r][0] * cols[c][0] + cols[r][1] * cols[c][1] + cols[r][2] * cols[c][2];
      const expected = r === c ? 1.0 : 0.0;
      const err = Math.abs(dot - expected);
      if (err > maxErr) maxErr = err;
    }
  }
  return maxErr;
}

let passedTests = 0;
let totalTests = 0;

function runTest(name: string, fn: () => void): void {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  \x1b[32m✔\x1b[0m [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  \x1b[31m✖\x1b[0m [FAIL] ${name}`);
    console.error(`    ${err.message || err}`);
    throw err;
  }
}

console.log('\n================================================================================');
console.log(' Tactical X-Band Digital Twin — Suite 109: 3D Volumetric RF & Picking');
console.log('================================================================================\n');

/* ========================================================================== */
/* [VRF-T1] Exact Analytical Fresnel Ellipsoid Geometry & SO(3) Orthonormality*/
/* ========================================================================== */
console.log('\x1b[36m--- [VRF-T1] Analytical Fresnel Ellipsoid Geometry & SO(3) Orthonormality ---\x1b[0m');

runTest('Exact midpoint Fresnel radius and 0.6 F1 clearance at D = 40,000 m, f = 8.0 GHz', () => {
  const D = 40000.0;
  const f = DEFAULT_X_BAND_FREQ_HZ; // 8.0e9 Hz
  const wavelength = SPEED_OF_LIGHT_M_S / f; // ~0.037474057 m

  // Theoretical exact values:
  // r_{1, max} = 0.5 * sqrt(lambda * D) = 0.5 * sqrt(0.037474057 * 40000) = 19.3582 m
  // r_{0.6 F1} = 0.6 * r_{1, max} = 11.6149 m
  const expectedR1Max = 0.5 * Math.sqrt(wavelength * D);
  const expected06F1 = 0.6 * expectedR1Max;

  assert.ok(
    Math.abs(expectedR1Max - 19.358) < 0.02,
    `r_{1, max} should be ~19.358 m, got ${expectedR1Max}`
  );
  assert.ok(
    Math.abs(expected06F1 - 11.615) < 0.02,
    `0.6 F1 should be ~11.615 m, got ${expected06F1}`
  );

  const transform = computeFresnelEllipsoidTransform({
    txWorld: [0, 5000, 0],
    rxWorld: [40000, 1000, 0],
    slantRangeM: D,
    freqHz: f,
    clearanceFraction: 0.6,
  });

  assert.strictEqual(transform.isValid, true);
  assert.ok(
    Math.abs(transform.physicalMidpointRadiusM - expectedR1Max) < 1e-9,
    `Midpoint radius matches: ${transform.physicalMidpointRadiusM} vs ${expectedR1Max}`
  );
  assert.ok(
    Math.abs(transform.clearanceRadiusM - expected06F1) < 1e-9,
    `Clearance radius matches: ${transform.clearanceRadiusM} vs ${expected06F1}`
  );
  assert.ok(
    Math.abs(transform.centerWorld[0] - 20000) < 1e-6 &&
    Math.abs(transform.centerWorld[1] - 3000) < 1e-6 &&
    Math.abs(transform.centerWorld[2] - 0) < 1e-6,
    `Center world correctly located at chord midpoint: ${transform.centerWorld}`
  );
});

runTest('SO(3) Orthonormality and positive determinant (|B^T*B - I| < 10^-12, det = +1)', () => {
  const testChords: Array<{ name: string; tx: Vector3Tuple; rx: Vector3Tuple }> = [
    { name: 'Horizontal along X', tx: [0, 0, 0], rx: [40000, 0, 0] },
    { name: 'Horizontal along Z', tx: [0, 0, 0], rx: [0, 0, 40000] },
    { name: 'Slanted 3D Chord', tx: [-15000, 4500, 20000], rx: [25000, 1200, -35000] },
    { name: 'Exact Vertical Chord (+Y Up)', tx: [0, 0, 0], rx: [0, 10000, 0] },
    { name: 'Exact Vertical Chord (-Y Down)', tx: [0, 10000, 0], rx: [0, 0, 0] },
    { name: 'Diagonal Negative Vector', tx: [1000, 2000, 3000], rx: [-4000, -5000, -6000] },
  ];

  for (const tc of testChords) {
    const res = computeFresnelEllipsoidTransform({
      txWorld: tc.tx,
      rxWorld: tc.rx,
      slantRangeM: 40000,
    });

    assert.strictEqual(res.isValid, true, `Chord ${tc.name} must be valid`);

    const { axisX, axisY, axisZ } = res.basis;

    // 1. axisY must be collinear with unit chord tx -> rx
    const dx = tc.rx[0] - tc.tx[0];
    const dy = tc.rx[1] - tc.tx[1];
    const dz = tc.rx[2] - tc.tx[2];
    const len = Math.hypot(dx, dy, dz);
    const unitChord: Vector3Tuple = [dx / len, dy / len, dz / len];
    const dotChord = axisY[0] * unitChord[0] + axisY[1] * unitChord[1] + axisY[2] * unitChord[2];
    assert.ok(
      Math.abs(dotChord - 1.0) < 1e-12,
      `axisY must point along unit chord for ${tc.name}, dot = ${dotChord}`
    );

    // 2. Basis must be strictly orthonormal: B^T * B = I
    const orthErr = maxOrthonormalError(axisX, axisY, axisZ);
    assert.ok(
      orthErr < 1e-12,
      `Orthonormal error must be < 10^-12 for ${tc.name}, got ${orthErr}`
    );

    // 3. Right-handed determinant must be +1
    const det = det3x3(axisX, axisY, axisZ);
    assert.ok(
      Math.abs(det - 1.0) < 1e-12,
      `Determinant must be +1 for ${tc.name}, got ${det}`
    );
  }
});

runTest('Graceful handling of zero range, negative distance, and non-finite inputs', () => {
  const zeroRes = computeFresnelEllipsoidTransform({
    txWorld: [100, 100, 100],
    rxWorld: [100, 100, 100],
    slantRangeM: 0,
  });
  assert.strictEqual(zeroRes.isValid, false);
  assert.strictEqual(zeroRes.physicalMidpointRadiusM, 0);
  assert.strictEqual(zeroRes.clearanceRadiusM, 0);

  const nanRes = computeFresnelEllipsoidTransform({
    txWorld: [NaN, 0, 0],
    rxWorld: [100, 0, 0],
    slantRangeM: -500,
  });
  assert.strictEqual(nanRes.isValid, false);
  assert.strictEqual(nanRes.clearanceRadiusM, 0);
});

/* ========================================================================== */
/* [VRF-T2] 3D Banking Quad-Sector Lobe Attitude Physics                      */
/* ========================================================================== */
console.log('\n\x1b[36m--- [VRF-T2] 3D Banking Quad-Sector Lobe Attitude Physics ---\x1b[0m');

runTest('Level flight: All 4 sector lobes have identical depression tilt along -Y', () => {
  const res = computeQuadSectorLobeTransforms({
    acnWorld: [0, 5000, 0],
    yawDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    activeSectorIndex: 0,
    depressionTiltDeg: 15.0,
  });

  assert.strictEqual(res.lobes.length, 4);

  // In level flight, all 4 lobes point downward by exactly -sin(15°) in Three.js world Y
  const expectedDirY = -Math.sin((15.0 * Math.PI) / 180.0); // ~ -0.258819

  for (let s = 0; s < 4; s++) {
    const lobe = res.lobes[s];
    assert.ok(
      Math.abs(lobe.directionWorld[1] - expectedDirY) < 1e-6,
      `Sector ${s} (${lobe.name}) dirY should be ${expectedDirY}, got ${lobe.directionWorld[1]}`
    );

    // Each lobe direction vector must be a unit vector
    const len = Math.hypot(...lobe.directionWorld);
    assert.ok(Math.abs(len - 1.0) < 1e-9, `Lobe ${s} must be unit vector`);
  }

  // Active sector index honored
  assert.strictEqual(res.lobes[0].isActive, true);
  assert.strictEqual(res.lobes[1].isActive, false);
});

runTest('Right bank (+35°): Starboard lobe S1 tilts DOWN, Port lobe S3 tilts UP', () => {
  const levelRes = computeQuadSectorLobeTransforms({
    acnWorld: [0, 5000, 0],
    yawDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    depressionTiltDeg: 15.0,
  });
  const dirY_level = levelRes.lobes[1].directionWorld[1]; // ~ -0.258819

  const bankRes = computeQuadSectorLobeTransforms({
    acnWorld: [0, 5000, 0],
    yawDeg: 0,
    pitchDeg: 0,
    rollDeg: 35.0, // Right bank +35°
    depressionTiltDeg: 15.0,
  });

  const dirY_S1 = bankRes.lobes[1].directionWorld[1]; // Starboard
  const dirY_S3 = bankRes.lobes[3].directionWorld[1]; // Port

  // Theoretical physics:
  // Starboard lobe Y component tilts down: -sin(15° + 35°) = -sin(50°) ≈ -0.766044
  // Port lobe Y component tilts up: sin(35° - 15°) = sin(20°) ≈ +0.342020
  const expectedDirY_S1 = -Math.sin((50.0 * Math.PI) / 180.0);
  const expectedDirY_S3 = Math.sin((20.0 * Math.PI) / 180.0);

  assert.ok(
    Math.abs(dirY_S1 - expectedDirY_S1) < 1e-5,
    `S1 (Starboard) dirY matches analytical bank physics: got ${dirY_S1}, expected ${expectedDirY_S1}`
  );
  assert.ok(
    Math.abs(dirY_S3 - expectedDirY_S3) < 1e-5,
    `S3 (Port) dirY matches analytical bank physics: got ${dirY_S3}, expected ${expectedDirY_S3}`
  );

  // Strict physical proof of downward starboard tilt and upward port tilt
  assert.ok(
    dirY_S1 < dirY_level,
    `Starboard lobe S1 tilts strictly DOWNWARD during right bank (dirY_S1 ${dirY_S1} < dirY_level ${dirY_level})`
  );
  assert.ok(
    dirY_S3 > dirY_level,
    `Port lobe S3 tilts strictly UPWARD during right bank (dirY_S3 ${dirY_S3} > dirY_level ${dirY_level})`
  );
});

runTest('Pitch attitude: Nose-up (+20°) tilts Forward S0 UP and Aft S2 DOWN', () => {
  const levelRes = computeQuadSectorLobeTransforms({
    acnWorld: [0, 5000, 0],
    yawDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    depressionTiltDeg: 15.0,
  });
  const dirY_level = levelRes.lobes[0].directionWorld[1];

  const pitchRes = computeQuadSectorLobeTransforms({
    acnWorld: [0, 5000, 0],
    yawDeg: 0,
    pitchDeg: 20.0, // 20° nose up
    rollDeg: 0,
    depressionTiltDeg: 15.0,
  });

  const dirY_S0 = pitchRes.lobes[0].directionWorld[1]; // Forward
  const dirY_S2 = pitchRes.lobes[2].directionWorld[1]; // Aft

  assert.ok(
    dirY_S0 > dirY_level,
    `Forward lobe S0 tilts UP when pitching up: ${dirY_S0} > ${dirY_level}`
  );
  assert.ok(
    dirY_S2 < dirY_level,
    `Aft lobe S2 tilts DOWN when pitching up: ${dirY_S2} < ${dirY_level}`
  );
});

/* ========================================================================== */
/* [VRF-T3] Threat/Weather Volumes, CVD Color Mapping & Proximity Picking     */
/* ========================================================================== */
console.log('\n\x1b[36m--- [VRF-T3] Threat/Weather Volumes, CVD Color Mapping & Picking ---\x1b[0m');

runTest('EW Threat dome & convective weather cell cylinder computation', () => {
  const res = computeThreatAndWeatherVolumes({
    jammer: {
      active: true,
      centerWorld: [10000, 3500, -20000],
      rangeM: 18000,
      heightM: 9000,
    },
    weatherCells: [
      { id: 1, centerWorld: [-5000, 4000, 15000], radiusM: 7500, rainRateMmH: 25.0, active: true },
      { id: 2, centerWorld: [20000, 4200, -10000], radiusM: 4000, rainRateMmH: 5.0, active: false },
    ],
    metersToWorldScale: 1.0,
  });

  assert.ok(res.jammerDome !== null);
  assert.strictEqual(res.jammerDome!.type, 'jammer_dome');
  assert.strictEqual(res.jammerDome!.radiusWorld, 18000);
  assert.strictEqual(res.jammerDome!.heightWorld, 9000);
  assert.strictEqual(res.jammerDome!.active, true);
  assert.ok(res.jammerDome!.opacity > 0.15);

  assert.strictEqual(res.weatherCells.length, 2);
  assert.strictEqual(res.weatherCells[0].radiusWorld, 7500);
  assert.strictEqual(res.weatherCells[0].active, true);
  assert.ok(res.weatherCells[0].opacity > res.weatherCells[1].opacity);
});

runTest('CVD-compliant link status color mapping via canvasTheme.ts', () => {
  // Standard mode
  const stdOptimal = resolveFresnelStatusColor(false, 0.95, false, 'standard');
  const stdDegraded = resolveFresnelStatusColor(false, 0.45, false, 'standard');
  const stdOutage = resolveFresnelStatusColor(true, 0.0, false, 'standard');
  const stdSelected = resolveFresnelStatusColor(false, 0.95, true, 'standard');

  assert.strictEqual(stdOptimal.css, LATTICE_CANVAS_STANDARD.optimal);
  assert.strictEqual(stdDegraded.css, LATTICE_CANVAS_STANDARD.degraded);
  assert.strictEqual(stdOutage.css, LATTICE_CANVAS_STANDARD.outage);
  assert.strictEqual(stdSelected.css, LATTICE_CANVAS_STANDARD.accent);

  // Colorblind-safe mode
  const cvdOptimal = resolveFresnelStatusColor(false, 0.95, false, 'colorblind-safe');
  const cvdDegraded = resolveFresnelStatusColor(false, 0.45, false, 'colorblind-safe');
  const cvdOutage = resolveFresnelStatusColor(true, 0.0, false, 'colorblind-safe');
  const cvdSelected = resolveFresnelStatusColor(false, 0.95, true, 'colorblind-safe');

  assert.strictEqual(cvdOptimal.css, LATTICE_CANVAS_CVD.optimal);
  assert.strictEqual(cvdDegraded.css, LATTICE_CANVAS_CVD.degraded);
  assert.strictEqual(cvdOutage.css, LATTICE_CANVAS_CVD.outage);
  assert.strictEqual(cvdSelected.css, LATTICE_CANVAS_CVD.accent);

  // Zero hex drift: hex number must match parseInt(css)
  assert.strictEqual(stdOptimal.hex, parseInt(LATTICE_CANVAS_STANDARD.optimal.replace('#', '0x'), 16));
  assert.strictEqual(cvdOptimal.hex, parseInt(LATTICE_CANVAS_CVD.optimal.replace('#', '0x'), 16));
});

runTest('Deterministic proximity picking from world-hit point (hit / miss / bounds)', () => {
  const entities = [
    { id: 0, positionWorld: [1000, 3000, 1000] },
    { id: 1, positionWorld: [10000, 3500, 10000] },
    { id: 2, positionWorld: [25000, 4000, 25000] },
  ];

  // Hit close to Node 1 (distance ~ 500 m)
  const hitNear1 = pickNearestEntityFromWorldHit([10300, 3500, 10400], entities, 5000.0);
  assert.strictEqual(hitNear1, 1, 'Picks nearest entity ID 1');

  // Hit too far from all nodes (> 5000 m)
  const hitFar = pickNearestEntityFromWorldHit([50000, 5000, 50000], entities, 5000.0);
  assert.strictEqual(hitFar, null, 'Returns null when exceeding maxPickRadiusWorld');

  // Non-finite input protection
  const hitNan = pickNearestEntityFromWorldHit([NaN, 0, 0], entities, 5000.0);
  assert.strictEqual(hitNan, null, 'Returns null for NaN input');

  // Empty entities list
  const hitEmpty = pickNearestEntityFromWorldHit([1000, 3000, 1000], [], 5000.0);
  assert.strictEqual(hitEmpty, null, 'Returns null for empty entity list');
});

/* ========================================================================== */
/* [VRF-T4] Layer Lifecycle, Zero-Allocation Micro-Benchmark & UI Contract    */
/* ========================================================================== */
console.log('\n\x1b[36m--- [VRF-T4] Three.js Layer Lifecycle, Benchmark & UI Contract ---\x1b[0m');

runTest('ThreeVolumetricRfLayer maintains constant object pool across 100 updates', () => {
  const layer = new ThreeVolumetricRfLayer({
    showFresnel: true,
    showSectorLobes: true,
    showThreatVolumes: true,
  });

  assert.strictEqual(layer.fresnelGroup.children.length, MAX_PREALLOCATED_ELLIPSOIDS);
  assert.strictEqual(layer.sectorLobeGroup.children.length, 4);
  assert.strictEqual(layer.volumeGroup.children.length, 1 + MAX_PREALLOCATED_WEATHER_CELLS);

  // Canonical TelemetryFrame fixture with 16 nodes (zero legacy invented fields)
  const nodesTelemetry: NodeTelemetryItem[] = Array.from({ length: 16 }, (_, i) => {
    const isOutage = i % 4 === 0;
    const slantKm = 20 + i * 0.5;
    return {
      node_id: i,
      name: i === 15 ? 'MCP' : `S${i}`,
      node_type: i === 15 ? 'mcp' : 'soldier',
      x_m: (i - 8) * 4000,
      y_m: (i - 8) * 3000,
      z_m: 3500 + i * 50,
      lat_deg: 34.5,
      lon_deg: 76.5,
      coordinate_reference: 'local Cartesian; x/y metres; z absolute altitude MSL metres',
      terrain_elevation_msl_m: 3498 + i * 50,
      agl_m: 2.0,
      altitude_msl_m: 3500 + i * 50,
      slant_range_km: slantKm,
      snr_db: isOutage ? -5.0 : 18.0,
      sinr_db: isOutage ? -5.0 : 18.0,
      modcod_name: isOutage ? 'LINK_OUTAGE' : '16-APSK 4/5',
      link_outage: isOutage,
      bitrate_bps: isOutage ? 0 : 3_160_000,
      bitrate_mbps: isOutage ? 0 : 3.16,
      terrain_is_los: !isOutage,
      diffraction_loss_db: isOutage ? 18.0 : 0.0,
      state_name: isOutage ? NodeTerrainState.HARD_SHADOW_CUTOFF : NodeTerrainState.NORMAL_LOS,
      time_to_occlusion_s: -1,
      time_to_emergence_s: -1,
      fresnel_clearance_m: isOutage ? -10.0 : 15.0,
      obstacle_blocked: false,
      is_coverage_complete: true,
      c2_backlog: 0,
      voice_backlog: 0,
      video_backlog: 0,
      photo_backlog: 0,
      c2_bytes: 0,
      voice_bytes: 0,
      video_bytes: 0,
      photo_bytes: 0,
      total_backlog_bytes: 0,
      is_transmitting: !isOutage,
      is_wasting_airtime: false,
      allocated_slot_ms: 1.0,
      allocated_capacity_bits: 3160,
      transfer_state: null,
      color_hex: '#38bdf8',
      tx_power_dbm: i === 15 ? 43.0 : 36.0,
      battery_capacity_mah: i === 15 ? 20000 : 5000,
      battery_level_pct: 100,
      tactical_priority: 1,
      is_depleted: false,
      registration_state: 'REGISTERED',
      registration_start_time_s: 0,
      registration_completion_time_s: 0.1,
      registration_elapsed_s: 1.0,
      communication_eligible: true,
      active_sector_id: 1,
    };
  });

  const baseLinkBudget = {
    node_id: 0,
    node_type: 'soldier',
    slant_range_m: 20000,
    slant_range_km: 20,
    fspl_db: 136.5,
    diffraction_loss_db: 0,
    gas_loss_db: 0.2,
    rain_loss_db: 0,
    cable_loss_db: 1.5,
    implementation_margin_db: 2.5,
    total_loss_db: 140.7,
    tx_power_dbm: 36,
    tx_gain_dbi: 3,
    rx_gain_dbi: 16,
    prx_dbm: -85.7,
    pnoise_dbm: -108.9,
    snr_db: 18.0,
    modcod_name: '16-APSK 4/5',
    spectral_efficiency_bps_hz: 3.16,
    bitrate_bps: 3_160_000,
    bitrate_mbps: 3.16,
    is_outage: false,
    obstacle_blocked: false,
    terrain_is_los: true,
    earth_bulge_m: 5.0,
  };

  let acnHeadingDeg = 45.0;
  let acnBankDeg = 12.0;

  const buildMockFrame = (headingDeg: number, bankDeg: number): TelemetryFrame => ({
    frame_index: 1,
    sim_time_s: 0.02,
    speed: 1.0,
    target_speed: 1.0,
    achieved_speed: 1.0,
    paused: false,
    spatial_locked: false,
    spatial_revision: 1,
    trajectory_config: {
      trajectory_mode: 'ellipse',
      center_x_m: 0,
      center_y_m: 0,
      orbit_a_m: 20000,
      orbit_b_m: 10000,
      orbit_rotation_deg: 35,
      waypoints: [],
    },
    scheduler_mode: 'tac_tad',
    selected_node_id: 0,
    plain_english_narrative: 'Nominal',
    acn_telemetry: {
      pos_x: 1200,
      pos_y: -800,
      pos_z: 5100,
      lat_deg: 34.5,
      lon_deg: 76.5,
      vel_x: 40,
      vel_y: 40,
      pitch_deg: -3.0,
      bank_deg: bankDeg,
      heading_deg: headingDeg,
      heading_rad: Math.atan2(40, 40),
      current_speed_mps: 60,
      target_speed_mps: 60,
      coverage_radius_m: 35000,
      coverage_radius_km: 35,
      flight_path: [[0, 0]],
    },
    acn_heading_deg: headingDeg,
    acn_bank_deg: bankDeg,
    nodes_telemetry: nodesTelemetry,
    registration_telemetry: { nodes: [], events: [] },
    active_gantt_allocations: [],
    static_gantt_allocations: [],
    tac_gantt_allocations: [],
    comparative_kpi_dashboard: {
      static_goodput_mb: 1.0,
      tac_goodput_mb: 1.5,
      gain_multiplier: 1.5,
      static_waste_pct: 10,
      tac_waste_pct: 2,
      static_drops: 0,
      static_drop_pct: 0,
      tac_drops: 0,
      tac_drop_pct: 0,
      ul_utilization_pct: 50,
      node4_pre_shadow_backlog_kb: 0,
      static_node4_pre_shadow_backlog_kb: 0,
      node4_evac_status: 'NOMINAL',
      static_selected_backlog_kb: 0,
      tac_selected_backlog_kb: 0,
      static_goodput_frame_bits: 0,
      tac_goodput_frame_bits: 0,
      active_goodput_frame_bits: 0,
      static_wasted_frame_bits: 0,
      tac_wasted_frame_bits: 0,
      active_wasted_frame_bits: 0,
      static_drop_delay_frame_pkts: 0,
      static_drop_overflow_frame_pkts: 0,
      static_drop_frame_pkts: 0,
      tac_drop_delay_frame_pkts: 0,
      tac_drop_overflow_frame_pkts: 0,
      tac_drop_frame_pkts: 0,
      active_drop_delay_frame_pkts: 0,
      active_drop_overflow_frame_pkts: 0,
      active_drop_frame_pkts: 0,
      static_utilization_pct: 0,
      tac_utilization_pct: 0,
      static_p50_bps: null,
      static_p95_bps: null,
      tac_p50_bps: null,
      tac_p95_bps: null,
      rolling_window_sample_count: 0,
      rolling_window_capacity: 200,
    },
    static_p50_bps: null,
    static_p95_bps: null,
    tac_p50_bps: null,
    tac_p95_bps: null,
    selected_node_fresnel: {
      profile: {
        valid: false,
        frameIndex: 1,
        simulationTimeS: 0.02,
        selectedGroundNodeId: 0,
        nodeName: 'S0',
        groundNodePositionMslM: [0, 0, 3500],
        acnPositionMslM: [1200, -800, 5100],
        horizontalGroundDistanceM: 1442,
        slantDistanceM: 2154,
        wavelengthM: 0.0375,
        effectiveEarthRadiusM: 8494666,
        fresnelFraction: 0.6,
        terrainIsLos: true,
        obstacleBlocked: false,
        terrainMinimumClearanceM: 100,
        terrainCriticalFresnelRadiusM: 4,
        diffractionLossDb: 0,
        obstacleIntervals: [],
        samples: [],
        isCoverageComplete: true,
      },
      node_id: 0,
      node_name: 'S0',
      distance_km: 2.15,
      clearance_m: 100,
      status: 'CLEAR',
      obstructed: false,
      diffraction_loss_db: 0,
      terrain_is_los: true,
      obstacle_blocked: false,
      obstacle_intersections: [],
      link_budget: baseLinkBudget,
      profile_points: [],
    },
    selected_link_budget: baseLinkBudget,
    transfer_telemetry: {
      node_id: 0,
      status: 'IDLE',
      status_message: '',
      active_type: null,
      total_bytes: 0,
      delivered_bytes: 0,
      dropped_bytes: 0,
      dropped_packets: 0,
      progress_pct: 0,
      start_time_s: -1,
      ack_time_s: -1,
      current_rate_bps: 0,
      current_rate_mbps: 0,
      eta_s: null,
      eta_status: 'STANDBY',
    },
    active_transfers: [],
    downlink_telemetry: {
      is_control_broadcast: true,
      ctrl_duration_ms: 1.0,
      dl_duration_ms: 1.0,
      broadcast_active: true,
    },
    terrain_mode: 'synthetic',
    terrain_bounds_km: 600,
    terrain_bounds: {
      terrainMode: 'synthetic',
      tileName: 'SYNTHETIC',
      minX: -600000,
      maxX: 600000,
      minY: -600000,
      maxY: 600000,
      rasterWidth: 512,
      rasterHeight: 512,
      groundResolutionXM: 2343,
      groundResolutionYM: 2343,
      isValidCoverage: true,
    },
    jammer_enabled: true,
    jammer_eirp_dbm: 65.0,
    jammer_pos_enu: [15000, 12000, 3500],
    weather_cells: [
      { id: 'w1', center_x_m: -10000, center_y_m: -8000, radius_m: 6000, peak_rain_mmh: 15 },
    ],
  });

  // Run 100 consecutive updates
  for (let cycle = 0; cycle < 100; cycle++) {
    acnHeadingDeg = (45.0 + cycle * 3.6) % 360.0;
    acnBankDeg = Math.sin(cycle * 0.1) * 30.0;
    layer.update(buildMockFrame(acnHeadingDeg, acnBankDeg));
  }

  // Verify pool sizes did NOT grow (Zero geometry leaks!)
  assert.strictEqual(layer.fresnelGroup.children.length, MAX_PREALLOCATED_ELLIPSOIDS);
  assert.strictEqual(layer.sectorLobeGroup.children.length, 4);
  assert.strictEqual(layer.volumeGroup.children.length, 1 + MAX_PREALLOCATED_WEATHER_CELLS);

  const state = layer.getState();
  assert.strictEqual(state.showFresnel, true);
  assert.strictEqual(state.showSectorLobes, true);
  assert.strictEqual(state.showThreatVolumes, true);
  assert.strictEqual(state.activeEllipsoidCount, 16);
  assert.strictEqual(state.activeLobeCount, 4);
  assert.strictEqual(state.activeThreatVolumeCount, 2); // 1 jammer + 1 weather cell

  // Clean disposal without errors
  layer.dispose();
  assert.strictEqual(layer.fresnelGroup.children.length, 0);
  assert.strictEqual(layer.sectorLobeGroup.children.length, 0);
  assert.strictEqual(layer.volumeGroup.children.length, 0);
});

runTest('Micro-benchmark: 1,000 full 16-link + 4-lobe math updates complete in < 30 ms', () => {
  const iterations = 1000;

  // JIT warm-up pass
  for (let w = 0; w < 50; w++) {
    for (let i = 0; i < 16; i++) {
      computeFresnelEllipsoidTransform({
        txWorld: [0, 5000, 0],
        rxWorld: [i * 2000, 3500, i * 1500],
        slantRangeM: 25000,
      });
    }
    computeQuadSectorLobeTransforms({
      acnWorld: [0, 5000, 0],
      yawDeg: 45,
      pitchDeg: 5,
      rollDeg: 25,
      activeSectorIndex: 1,
    });
    computeThreatAndWeatherVolumes({
      jammer: { active: true, centerWorld: [10000, 3500, 10000] },
      weatherCells: [{ id: 1, centerWorld: [0, 3500, 0], radiusM: 5000 }],
    });
  }

  // Best of 3 runs to insulate against OS thread preemption under parallel worker load
  let minElapsedMs = Infinity;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < 16; i++) {
        computeFresnelEllipsoidTransform({
          txWorld: [0, 5000, 0],
          rxWorld: [i * 2000, 3500, i * 1500],
          slantRangeM: 25000,
        });
      }
      computeQuadSectorLobeTransforms({
        acnWorld: [0, 5000, 0],
        yawDeg: (it * 0.5) % 360,
        pitchDeg: 5,
        rollDeg: 25,
        activeSectorIndex: it % 4,
      });
      computeThreatAndWeatherVolumes({
        jammer: { active: true, centerWorld: [10000, 3500, 10000] },
        weatherCells: [{ id: 1, centerWorld: [0, 3500, 0], radiusM: 5000 }],
      });
    }
    const elapsed = performance.now() - start;
    if (elapsed < minElapsedMs) minElapsedMs = elapsed;
  }

  const usPerFrame = (minElapsedMs / iterations) * 1000.0;
  console.log(`    Benchmark result (best-of-3): ${iterations} updates in ${minElapsedMs.toFixed(2)} ms (${usPerFrame.toFixed(2)} µs/frame)`);

  assert.ok(
    minElapsedMs < 30.0,
    `1,000 updates must complete in < 30 ms (budget: 30 µs/frame), took ${minElapsedMs.toFixed(2)} ms`
  );
});

runTest('index.html DOM & Accessibility Contract: #btn-3d-fresnel, #btn-3d-lobes, #btn-3d-volumes', () => {
  const htmlPath = path.resolve(process.cwd(), 'index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  // 1. Presence of all 3 HUD buttons inside .three-hud-overlay
  assert.ok(htmlContent.includes('id="btn-3d-fresnel"'), 'Must contain #btn-3d-fresnel');
  assert.ok(htmlContent.includes('id="btn-3d-lobes"'), 'Must contain #btn-3d-lobes');
  assert.ok(htmlContent.includes('id="btn-3d-volumes"'), 'Must contain #btn-3d-volumes');

  // 2. ARIA accessibility contracts
  assert.ok(htmlContent.includes('aria-label="Toggle 3D Fresnel Ellipsoids"'), 'Fresnel button has aria-label');
  assert.ok(htmlContent.includes('aria-label="Toggle 3D Banking Sector Lobes"'), 'Lobes button has aria-label');
  assert.ok(htmlContent.includes('aria-label="Toggle 3D EW and Storm Volumes"'), 'Volumes button has aria-label');
  assert.ok(htmlContent.includes('aria-pressed="true"'), 'Buttons define aria-pressed state');

  // 3. Zero emojis in button markup
  const hudMatch = htmlContent.match(/<div class="three-volumetric-rf-toggles"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(hudMatch, 'three-volumetric-rf-toggles container exists');
  const hudHtml = hudMatch[1];
  const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.strictEqual(emojiRegex.test(hudHtml), false, 'Zero emojis in HUD buttons');

  // 4. Zero duplicate IDs for the new buttons
  const countMatches = (id: string) => (htmlContent.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length;
  assert.strictEqual(countMatches('btn-3d-fresnel'), 1, '#btn-3d-fresnel must appear exactly once');
  assert.strictEqual(countMatches('btn-3d-lobes'), 1, '#btn-3d-lobes must appear exactly once');
  assert.strictEqual(countMatches('btn-3d-volumes'), 1, '#btn-3d-volumes must appear exactly once');
});

console.log('\n================================================================================');
console.log(` \x1b[32m✔ ALL ${passedTests} / ${totalTests} TESTS PASSED (Suite 109: 3D Volumetric RF & Picking)\x1b[0m`);
console.log('================================================================================\n');
