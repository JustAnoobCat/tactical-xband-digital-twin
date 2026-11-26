/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Suite 131 (RUST-CORE-01): Shared Rust/WASM Terrain, Viewshed & Hillshade Kernel Parity & Perf
 *
 * Verifies:
 * 1. Compiled `xband_physics_bg.wasm` artifact exists, is < 150 KB, and pure-TS fallback works before init.
 * 2. `wasmKnifeEdgeLossDb(v)` vs TS `computeKnifeEdgeDiffractionLossDb(v)` across 50 values in [-2, 5]: max err < 1e-6 dB.
 * 3. `wasmEvaluateBatchRays(...)` vs TS `TerrainEngine.evaluateTerrainObstruction(...)` on real Ladakh DEM across 64 diverse rays:
 *    diffraction loss max err < 0.05 dB, `minClearanceM` max err < 0.5 m, 100% `isLos` agreement.
 * 4. `wasmGenerateHillshadeRgba(...)` vs TS `HillshadeGenerator` on real Ladakh DEM: RGB MAE < 1.5 / 255 and < 25 ms.
 * 5. `wasmComputePolarViewshed(...)` vs TS `PolarViewshedEngine` fast mode (nominal + rain/jammer): SINR MAE < 0.25 dB.
 * 6. `src/worker/simWorker.ts` < 3,250 lines and seeded `SimulationWorkerManager` determinism preserved.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { EnvironmentConfig, RFConfig } from '../core/config';
import { computeKnifeEdgeDiffractionLossDb } from '../core/rfPropagationMath';
import { REAL_LADAKH_DEM_METADATA, TerrainEngine } from '../core/terrain';
import { NUM_AZIMUTHS, NUM_RANGES, PolarViewshedEngine, TOTAL_VIEWSHED_CELLS } from '../core/viewshedEngine';
import {
  initWasmPhysicsSync,
  isWasmPhysicsReady,
  wasmComputePolarViewshed,
  wasmEvaluateBatchRays,
  wasmGenerateHillshadeRgba,
  wasmKnifeEdgeLossDb,
} from '../core/wasmPhysicsBridge';
import type { Position3D } from '../shared/types';
import { HillshadeGenerator } from '../worker/hillshadeGenerator';
import { SimulationWorkerManager } from '../worker/simWorker';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(currentDir, '../..');

const wasmPath = path.resolve(ROOT_DIR, 'src/wasm/xband_physics/xband_physics_bg.wasm');
const demPath = path.resolve(ROOT_DIR, 'public/terrain/real_ladakh_dem.bin');

assert.ok(fs.existsSync(wasmPath), `Compiled WASM artifact must exist at ${wasmPath}`);
assert.ok(fs.existsSync(demPath), `Real Ladakh DEM binary must exist at ${demPath}`);

const wasmBytes = fs.readFileSync(wasmPath);
const wasmSizeKb = wasmBytes.byteLength / 1024.0;
assert.ok(wasmBytes.byteLength < 150 * 1024, `WASM binary must be < 150 KB, got ${wasmSizeKb.toFixed(1)} KB`);

const demBuf = fs.readFileSync(demPath);
const demGrid = new Float32Array(demBuf.buffer, demBuf.byteOffset, 512 * 512);

const meta = REAL_LADAKH_DEM_METADATA;
const minX = meta.minX ?? -meta.halfWidthM;
const maxX = meta.maxX ?? meta.halfWidthM;
const minY = meta.minY ?? -meta.halfHeightM;
const maxY = meta.maxY ?? meta.halfHeightM;

const rf = new RFConfig();
const env = new EnvironmentConfig();
const envWetJam = new EnvironmentConfig({ rainRateMmH: 25.0, jammerEnabled: true });

// -----------------------------------------------------------------------------
// 1. Pre-WASM Pure-TS Reference Baseline & Fallback Check
// -----------------------------------------------------------------------------
console.log('='.repeat(92));
console.log('  SUITE 131 (RUST-CORE-01): WASM <-> TS PARITY & SPEEDUP BENCHMARK');
console.log('='.repeat(92));

assert.equal(isWasmPhysicsReady(), false, 'WASM must start uninitialized for fallback verification');
assert.equal(wasmKnifeEdgeLossDb(0.5), null, 'Unloaded WASM bridge must return null');

const terrain = new TerrainEngine({ terrainMode: 'real' });
terrain.loadCustomDem(demGrid);

// Capture pure-TS Hillshade baseline
const tsHillshadeGen = new HillshadeGenerator(terrain);
const tsHillshadeRes = tsHillshadeGen.generate(terrain, 512);

// Capture pure-TS Viewshed baselines (nominal & rain+jammer)
const acnPos: Position3D = [0.0, 0.0, 5200.0];
const acnVel: Position3D = [45.0, 40.0, 0.0];
const jammerBySector: readonly [number, number, number, number] = [-98.0, -104.0, -110.0, -95.0];

const tsViewshedNom = new PolarViewshedEngine();
const tsSinrNom = new Float32Array(
  tsViewshedNom.computeFullViewshed(acnPos, acnVel, terrain, rf, env, undefined, undefined, 'fast')
);

const tsViewshedWet = new PolarViewshedEngine();
const tsSinrWet = new Float32Array(
  tsViewshedWet.computeFullViewshed(acnPos, acnVel, terrain, rf, envWetJam, undefined, jammerBySector, 'fast')
);

// Build 64 diverse alpine rays across Ladakh DEM (LOS, grazing, single-ridge, multi-ridge)
const rays: number[] = [];
const tsRayObs: ReturnType<TerrainEngine['evaluateTerrainObstruction']>[] = [];
for (let i = 0; i < 64; i++) {
  const angle = (i * 2.0 * Math.PI) / 64.0;
  const rGround = 2500.0 + ((i * 7919) % 28000);
  const nx = rGround * Math.cos(angle);
  const ny = rGround * Math.sin(angle);
  const gz = terrain.getElevation(nx, ny);
  const nz = (Number.isFinite(gz) ? gz : 3500.0) + 2.0;

  const acnAngle = angle + (i % 3 === 0 ? 0.4 : 2.6);
  const rAcn = 4000.0 + (i % 5) * 3500.0;
  const ax = rAcn * Math.cos(acnAngle);
  const ay = rAcn * Math.sin(acnAngle);
  // Span low-grazing and high-clearance altitudes
  const az = 4200.0 + (i % 8) * 350.0;

  rays.push(nx, ny, nz, ax, ay, az);
  tsRayObs.push(terrain.evaluateTerrainObstruction([nx, ny, nz], [ax, ay, az], rf, env, 100.0, 0.0));
}

const tTsRays0 = performance.now();
for (let rep = 0; rep < 10; rep++) {
  for (let i = 0; i < 64; i++) {
    const b = i * 6;
    terrain.evaluateTerrainObstruction(
      [rays[b], rays[b + 1], rays[b + 2]],
      [rays[b + 3], rays[b + 4], rays[b + 5]],
      rf,
      env,
      100.0,
      0.0
    );
  }
}
const tsRays640Ms = performance.now() - tTsRays0;

// -----------------------------------------------------------------------------
// 2. Initialize Compiled WASM Artifact via initWasmPhysicsSync
// -----------------------------------------------------------------------------
const okInit = initWasmPhysicsSync(wasmBytes);
assert.equal(okInit, true, 'initWasmPhysicsSync must succeed with compiled xband_physics_bg.wasm');
assert.equal(isWasmPhysicsReady(), true, 'isWasmPhysicsReady() must be true after sync init');
console.log(`\n  ✓ Loaded xband_physics_bg.wasm (${wasmSizeKb.toFixed(1)} KB < 150 KB)`);

// -----------------------------------------------------------------------------
// 3. Knife-Edge J(v) Parity (50 values in [-2.0, 5.0])
// -----------------------------------------------------------------------------
let maxKnifeEdgeErrDb = 0.0;
for (let i = 0; i < 50; i++) {
  const v = -2.0 + (i / 49.0) * 7.0;
  const tsVal = computeKnifeEdgeDiffractionLossDb(v);
  const wasmVal = wasmKnifeEdgeLossDb(v);
  assert.ok(wasmVal !== null && Number.isFinite(wasmVal));
  const err = Math.abs(wasmVal - tsVal);
  if (err > maxKnifeEdgeErrDb) maxKnifeEdgeErrDb = err;
}
assert.ok(
  maxKnifeEdgeErrDb < 1e-6,
  `Knife-edge J(v) max error must be < 1e-6 dB, got ${maxKnifeEdgeErrDb}`
);
console.log(`  ✓ Knife-edge J(v) parity (50 pts): max error = ${maxKnifeEdgeErrDb.toExponential(3)} dB`);

// -----------------------------------------------------------------------------
// 4. Batch Ray-March Parity (64 diverse alpine rays on real Ladakh DEM)
// -----------------------------------------------------------------------------
const raysF64 = new Float64Array(rays);
// Warmup + timed 10x64 batch
wasmEvaluateBatchRays(demGrid, 512, 512, minX, maxX, minY, maxY, raysF64, rf.wavelengthM, env.effectiveEarthRadiusM, 100.0, 0.0);
const tWasmRays0 = performance.now();
let wasmRayOut: Float64Array | null = null;
for (let rep = 0; rep < 10; rep++) {
  wasmRayOut = wasmEvaluateBatchRays(
    demGrid,
    512,
    512,
    minX,
    maxX,
    minY,
    maxY,
    raysF64,
    rf.wavelengthM,
    env.effectiveEarthRadiusM,
    100.0,
    0.0
  );
}
const wasmRays640Ms = performance.now() - tWasmRays0;

assert.ok(wasmRayOut !== null && wasmRayOut.length === 64 * 4, 'Batch ray output must have 64 * 4 elements');
let maxLossErrDb = 0.0;
let maxClearanceErrM = 0.0;
let losMatches = 0;

for (let i = 0; i < 64; i++) {
  const obase = i * 4;
  const wIsLos = wasmRayOut[obase] > 0.5;
  const wLoss = wasmRayOut[obase + 1];
  const wClear = wasmRayOut[obase + 2];
  const ts = tsRayObs[i];

  assert.equal(wIsLos, ts.isLos, `Ray ${i} isLos mismatch (wasm=${wIsLos}, ts=${ts.isLos})`);
  losMatches++;

  const lossErr = Math.abs(wLoss - ts.diffractionLossDb);
  const clearErr = Math.abs(wClear - ts.minClearanceM);
  if (lossErr > maxLossErrDb) maxLossErrDb = lossErr;
  if (clearErr > maxClearanceErrM) maxClearanceErrM = clearErr;
}
assert.ok(maxLossErrDb < 0.05, `Batch ray diffraction loss max error must be < 0.05 dB, got ${maxLossErrDb}`);
assert.ok(maxClearanceErrM < 0.5, `Batch ray minClearanceM max error must be < 0.5 m, got ${maxClearanceErrM}`);
console.log(
  `  ✓ 64-ray Ladakh DEM parity: los=${losMatches}/64, maxLossErr=${maxLossErrDb.toExponential(3)} dB, maxClearErr=${maxClearanceErrM.toExponential(3)} m`
);
console.log(
  `  ✓ 640-ray throughput: TS=${tsRays640Ms.toFixed(2)} ms vs WASM=${wasmRays640Ms.toFixed(2)} ms (${(tsRays640Ms / Math.max(0.01, wasmRays640Ms)).toFixed(2)}x)`
);

// -----------------------------------------------------------------------------
// 5. 512x512 Hillshade RGBA Parity & Speed
// -----------------------------------------------------------------------------
// Warmup
wasmGenerateHillshadeRgba(demGrid, 512, 512, 512, minX, maxX, minY, maxY, meta.minElevationM ?? 0);
const tHs0 = performance.now();
const wasmHsRgba = wasmGenerateHillshadeRgba(demGrid, 512, 512, 512, minX, maxX, minY, maxY, meta.minElevationM ?? 0);
const wasmHsMs = performance.now() - tHs0;

assert.ok(wasmHsRgba !== null && wasmHsRgba.length === 512 * 512 * 4, 'Hillshade RGBA buffer must be 512*512*4 bytes');
let rgbAbsErrSum = 0.0;
let rgbCount = 0;
for (let r = 0; r < 512; r++) {
  for (let c = 0; c < 512; c++) {
    const packed = tsHillshadeRes.grid[r][c];
    const tsR = (packed >> 16) & 255;
    const tsG = (packed >> 8) & 255;
    const tsB = packed & 255;
    const p = (r * 512 + c) * 4;
    rgbAbsErrSum += Math.abs(wasmHsRgba[p] - tsR) + Math.abs(wasmHsRgba[p + 1] - tsG) + Math.abs(wasmHsRgba[p + 2] - tsB);
    rgbCount += 3;
  }
}
const hillshadeMae = rgbAbsErrSum / rgbCount;
assert.ok(hillshadeMae < 1.5, `Hillshade RGB MAE must be < 1.5 / 255, got ${hillshadeMae.toFixed(4)}`);
assert.ok(wasmHsMs < 25.0, `WASM 512x512 hillshade must run in < 25 ms, got ${wasmHsMs.toFixed(2)} ms`);

// Verify HillshadeGenerator delegates cleanly to WASM when ready
const wasmGen = new HillshadeGenerator(terrain);
const wasmGenRes = wasmGen.generate(terrain, 512);
assert.equal(wasmGenRes.grid.length, 512);
assert.equal(wasmGenRes.grid[256][256], tsHillshadeRes.grid[256][256]);
console.log(`  ✓ 512x512 Hillshade parity: RGB MAE = ${hillshadeMae.toFixed(5)} / 255, WASM time = ${wasmHsMs.toFixed(2)} ms`);

// -----------------------------------------------------------------------------
// 6. Polar Viewshed Parity & Speed (Nominal + Rain/Jammer)
// -----------------------------------------------------------------------------
const wasmViewshedEngine = new PolarViewshedEngine();
const tVs0 = performance.now();
const wasmSinrNom = wasmViewshedEngine.computeFullViewshed(acnPos, acnVel, terrain, rf, env, undefined, undefined, 'fast');
const wasmVsMs = performance.now() - tVs0;

let sinrErrSumNom = 0.0;
let maxSinrErrNom = 0.0;
for (let i = 0; i < TOTAL_VIEWSHED_CELLS; i++) {
  const err = Math.abs(wasmSinrNom[i] - tsSinrNom[i]);
  sinrErrSumNom += err;
  if (err > maxSinrErrNom) maxSinrErrNom = err;
}
const viewshedMaeNom = sinrErrSumNom / TOTAL_VIEWSHED_CELLS;
assert.ok(viewshedMaeNom < 0.25, `Viewshed nominal SINR MAE must be < 0.25 dB, got ${viewshedMaeNom.toFixed(4)} dB`);

const wasmSinrWet = wasmViewshedEngine.computeFullViewshed(acnPos, acnVel, terrain, rf, envWetJam, undefined, jammerBySector, 'fast');
let sinrErrSumWet = 0.0;
for (let i = 0; i < TOTAL_VIEWSHED_CELLS; i++) {
  sinrErrSumWet += Math.abs(wasmSinrWet[i] - tsSinrWet[i]);
}
const viewshedMaeWet = sinrErrSumWet / TOTAL_VIEWSHED_CELLS;
assert.ok(viewshedMaeWet < 0.25, `Viewshed rain+jammer SINR MAE must be < 0.25 dB, got ${viewshedMaeWet.toFixed(4)} dB`);

// Verify raw wasmComputePolarViewshed horizon elevations are finite and physically bounded
const { txPowerDbm: sTx, antennaGainDbi: sGain } = rf.getTransmitterParams('soldier');
const rawVs = wasmComputePolarViewshed(demGrid, 512, 512, minX, maxX, minY, maxY, {
  numBearings: NUM_AZIMUTHS,
  numRanges: NUM_RANGES,
  rMinM: 1500.0,
  rStepM: 1500.0,
  acnPos,
  headingDeg: 48.366,
  pitchDeg: 0.0,
  bankDeg: 0.0,
  carrierFreqHz: rf.carrierFrequencyHz,
  speedOfLight: rf.speedOfLight,
  channelBandwidthHz: rf.channelBandwidthHz,
  acnAntennaGainDbi: rf.acnAntennaGainDbi,
  acnNoiseFigureDb: rf.acnNoiseFigureDb,
  soldierTxPowerDbm: sTx,
  soldierAntennaGainDbi: sGain,
  cableLossDb: rf.cableLossDb,
  implementationMarginDb: rf.implementationMarginDb,
  boltzmannConstant: rf.boltzmannConstant,
  hpbwAzDeg: rf.acnSectorHpbwAzDeg,
  hpbwElDeg: rf.acnSectorHpbwElDeg,
  downtiltDeg: rf.acnSectorDowntiltDeg,
  rEffM: env.effectiveEarthRadiusM,
  atmosphericTempK: env.atmosphericTemperatureK,
  rainRateMmH: 0.0,
  rainCellLengthKm: env.rainCellLengthKm,
  freezingIsothermM: 4200.0,
  jammerEnabled: false,
});
assert.ok(rawVs !== null && rawVs.length === TOTAL_VIEWSHED_CELLS + NUM_AZIMUTHS);
for (let az = 0; az < NUM_AZIMUTHS; az++) {
  const hDeg = rawVs[TOTAL_VIEWSHED_CELLS + az];
  assert.ok(Number.isFinite(hDeg) && hDeg >= -90 && hDeg <= 90, `Invalid horizon angle ${hDeg}`);
}
console.log(
  `  ✓ 576-cell Polar Viewshed parity: nomMAE=${viewshedMaeNom.toFixed(5)} dB (max=${maxSinrErrNom.toFixed(5)} dB), wetJamMAE=${viewshedMaeWet.toFixed(5)} dB, WASM=${wasmVsMs.toFixed(2)} ms`
);

// -----------------------------------------------------------------------------
// 7. simWorker.ts Line Count & Seeded Determinism Check
// -----------------------------------------------------------------------------
const simWorkerPath = path.resolve(ROOT_DIR, 'src/worker/simWorker.ts');
const simWorkerLines = fs.readFileSync(simWorkerPath, 'utf8').split('\n').length;
assert.ok(simWorkerLines < 3250, `simWorker.ts must be < 3,250 lines, got ${simWorkerLines}`);

const mgrA = new SimulationWorkerManager(42, '16_NODES');
const mgrB = new SimulationWorkerManager(42, '16_NODES');
mgrA.terrainEngine.loadCustomDem(demGrid);
mgrB.terrainEngine.loadCustomDem(demGrid);
for (let k = 0; k < 20; k++) {
  mgrA.tickSimulation(false);
  mgrB.tickSimulation(false);
}
assert.deepEqual(mgrA.metrics, mgrB.metrics, 'Seeded SimulationWorkerManager metrics must remain bit-identical');
console.log(`  ✓ simWorker.ts line count = ${simWorkerLines} (< 3,250) and 20-tick seeded determinism verified`);

console.log('\n' + '='.repeat(92));
console.log('  SUITE 131 (RUST-CORE-01) PASSED: ALL WASM <-> TS PARITY & ARCHITECTURE CHECKS GREEN');
console.log('='.repeat(92) + '\n');
