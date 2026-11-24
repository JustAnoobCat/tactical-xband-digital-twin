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

  // Mock telemetry frame with 16 nodes
  const mockFrame: any = {
    acn: { x: 0, y: 0, z: 5000 },
    acn_heading_deg: 45.0,
    acn_bank_deg: 12.0,
    acn_pitch_deg: -3.0,
    active_sector_id: 1,
    nodes_telemetry: Array.from({ length: 16 }, (_, i) => ({
      node_id: i,
      x_m: (i - 8) * 4000,
      y_m: (i - 8) * 3000,
      z_m: 3500 + i * 50,
      slant_range_m: 20000 + i * 500,
      is_mapped: true,
      link_status: i % 4 === 0 ? 'OUTAGE' : 'CONNECTED',
      fresnel_clearance_ratio: i % 4 === 0 ? 0.2 : 0.85,
    })),
    threats: {
      jammerPosEnu: [15000, 12000, 3500],
    },
    weather_cells: [
      { id: 'w1', posEnu: [-10000, -8000, 3500], radius_m: 6000, rain_rate_mm_h: 15 },
    ],
  };

  // Run 100 consecutive updates
  for (let cycle = 0; cycle < 100; cycle++) {
    mockFrame.acn_heading_deg = (45.0 + cycle * 3.6) % 360.0;
    mockFrame.acn_bank_deg = Math.sin(cycle * 0.1) * 30.0;
    layer.update(mockFrame);
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
