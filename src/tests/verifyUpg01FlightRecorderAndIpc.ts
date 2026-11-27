/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Suite 132 (UPG-01): Slice-Only WASM Viewshed, On-Demand Worker IPC,
 * Event-Sourced Flight Recorder (< 50 KB) & Live SystemHealthHud / CSP Audit
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EnvironmentConfig, RFConfig } from '../core/config';
import {
  EventSourcedFlightRecorder,
  computeTelemetryStateDigest,
  parseFlightRecordingJson,
  replayFlightRecordingHeadless,
} from '../core/flightRecorder';
import { REAL_LADAKH_DEM_METADATA, TerrainEngine } from '../core/terrain';
import {
  NUM_AZIMUTHS,
  NUM_RANGES,
  PolarViewshedEngine,
  TOTAL_VIEWSHED_CELLS,
} from '../core/viewshedEngine';
import {
  initWasmPhysicsSync,
  isWasmPhysicsReady,
  wasmComputePolarViewshed,
  wasmComputePolarViewshedSlice,
} from '../core/wasmPhysicsBridge';
import type { Position3D } from '../shared/types';
import type { TelemetryFrame, WorkerInboundCommand, WorkerOutboundMessage } from '../shared/workerProtocol';
import { initMissionIoController } from '../ui/controllers/missionIoController';
import { SystemHealthHud } from '../ui/systemHealthHud';
import { SimulationWorkerManager } from '../worker/simWorker';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(currentDir, '../..');

const wasmPath = path.resolve(ROOT_DIR, 'src/wasm/xband_physics/xband_physics_bg.wasm');
const wasmJsPath = path.resolve(ROOT_DIR, 'src/wasm/xband_physics/xband_physics.js');
const demPath = path.resolve(ROOT_DIR, 'public/terrain/real_ladakh_dem.bin');
const indexHtmlPath = path.resolve(ROOT_DIR, 'index.html');
const simWorkerPath = path.resolve(ROOT_DIR, 'src/worker/simWorker.ts');
const hudPath = path.resolve(ROOT_DIR, 'src/ui/systemHealthHud.ts');

assert.ok(fs.existsSync(wasmPath), `WASM artifact missing at ${wasmPath}`);
assert.ok(fs.existsSync(demPath), `DEM binary missing at ${demPath}`);

const wasmBytes = fs.readFileSync(wasmPath);
const wasmSizeKb = wasmBytes.byteLength / 1024;
assert.ok(wasmBytes.byteLength < 150 * 1024, `WASM binary must be < 150 KB, got ${wasmSizeKb.toFixed(1)} KB`);

const wasmJsText = fs.readFileSync(wasmJsPath, 'utf8');
assert.equal(/\beval\s*\(/.test(wasmJsText), false, 'Generated WASM JS glue must contain zero eval()');
assert.equal(/new\s+Function\s*\(/.test(wasmJsText), false, 'Generated WASM JS glue must contain zero new Function()');

const demBuf = fs.readFileSync(demPath);
const demGrid = new Float32Array(demBuf.buffer, demBuf.byteOffset, 512 * 512);
const meta = REAL_LADAKH_DEM_METADATA;
const minX = meta.minX ?? -meta.halfWidthM;
const maxX = meta.maxX ?? meta.halfWidthM;
const minY = meta.minY ?? -meta.halfHeightM;
const maxY = meta.maxY ?? meta.halfHeightM;

const rf = new RFConfig();
const env = new EnvironmentConfig({ rainRateMmH: 15.0, jammerEnabled: true });
const acnPos: Position3D = [200.0, -350.0, 5200.0];
const acnVel: Position3D = [45.0, 40.0, 0.0];
const jammerBySector: readonly [number, number, number, number] = [-96.0, -104.0, -110.0, -94.0];

console.log('='.repeat(92));
console.log('  SUITE 132 (UPG-01): SLICE WASM VIEWSHED, ON-DEMAND IPC, FLIGHT RECORDER & HUD');
console.log('='.repeat(92));

// -----------------------------------------------------------------------------
// [1/4] Slice-Only Rust/WASM Viewshed Parity & TS Fallback
// -----------------------------------------------------------------------------
const terrain = new TerrainEngine({ terrainMode: 'real' });
terrain.loadCustomDem(demGrid);

assert.equal(isWasmPhysicsReady(), false, 'WASM must start unloaded to verify pure-TS fallback');
const preWasmEngine = new PolarViewshedEngine();
for (let s = 0; s < 4; s++) {
  preWasmEngine.computeIncrementalSlice(acnPos, acnVel, terrain, rf, env, 9, undefined, jammerBySector, 'fast');
}
assert.ok(
  preWasmEngine.getSinrGrid().every((v) => Number.isFinite(v)),
  'Pure-TS incremental slice fallback must populate finite SINR cells before WASM init'
);

assert.equal(initWasmPhysicsSync(wasmBytes), true, 'initWasmPhysicsSync must succeed on real WASM bytes');
assert.equal(isWasmPhysicsReady(), true, 'isWasmPhysicsReady must report true after sync init');

const { txPowerDbm: sTx, antennaGainDbi: sGain } = rf.getTransmitterParams('soldier');
const wasmParams = {
  numBearings: NUM_AZIMUTHS,
  numRanges: NUM_RANGES,
  rMinM: 1500.0,
  rStepM: 1500.0,
  acnPos,
  headingDeg: 48.36646066342981,
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
  hpbwAzDeg: rf.acnSectorHpbwAzDeg ?? 90.0,
  hpbwElDeg: rf.acnSectorHpbwElDeg ?? 65.0,
  downtiltDeg: rf.acnSectorDowntiltDeg ?? -15.0,
  rEffM: env.effectiveEarthRadiusM,
  atmosphericTempK: env.atmosphericTemperatureK,
  rainRateMmH: env.rainRateMmH ?? 0.0,
  rainCellLengthKm: env.rainCellLengthKm ?? 10.0,
  freezingIsothermM: 4800.0,
  jammerEnabled: Boolean(env.jammerEnabled),
  jammerBySector,
};

const fullWasm = wasmComputePolarViewshed(demGrid, 512, 512, minX, maxX, minY, maxY, wasmParams);
assert.ok(fullWasm !== null && fullWasm.length === TOTAL_VIEWSHED_CELLS + NUM_AZIMUTHS);

const reconstructed = new Float32Array(TOTAL_VIEWSHED_CELLS);
const reconstructedHorizon = new Float32Array(NUM_AZIMUTHS);
for (let start = 0; start < NUM_AZIMUTHS; start += 9) {
  const sliceOut = wasmComputePolarViewshedSlice(
    demGrid,
    512,
    512,
    minX,
    maxX,
    minY,
    maxY,
    start,
    9,
    wasmParams
  );
  assert.ok(sliceOut !== null && sliceOut.length === 9 * NUM_RANGES + 9, 'Slice output length mismatch');
  reconstructed.set(sliceOut.subarray(0, 9 * NUM_RANGES), start * NUM_RANGES);
  reconstructedHorizon.set(sliceOut.subarray(9 * NUM_RANGES, 9 * NUM_RANGES + 9), start);
}

let maeSum = 0.0;
for (let i = 0; i < TOTAL_VIEWSHED_CELLS; i++) {
  const diff = Math.abs(reconstructed[i] - fullWasm[i]);
  assert.equal(diff, 0.0, `WASM slice cell ${i} diverged from full WASM sweep: ${diff}`);
  maeSum += diff;
}
for (let az = 0; az < NUM_AZIMUTHS; az++) {
  assert.equal(reconstructedHorizon[az], fullWasm[TOTAL_VIEWSHED_CELLS + az], `Horizon mismatch at az=${az}`);
}

// Wrap-around check [30..35, 0..2]
const wrapSlice = wasmComputePolarViewshedSlice(demGrid, 512, 512, minX, maxX, minY, maxY, 30, 9, wasmParams);
assert.ok(wrapSlice !== null && wrapSlice.length === 9 * NUM_RANGES + 9);
for (let k = 0; k < 9; k++) {
  const az = (30 + k) % NUM_AZIMUTHS;
  for (let r = 0; r < NUM_RANGES; r++) {
    assert.equal(wrapSlice[k * NUM_RANGES + r], fullWasm[az * NUM_RANGES + r]);
  }
}

// PolarViewshedEngine.computeIncrementalSlice() parity against full WASM sweep
const sliceEngine = new PolarViewshedEngine();
for (let s = 0; s < 4; s++) {
  sliceEngine.computeIncrementalSlice(acnPos, acnVel, terrain, rf, env, 9, undefined, jammerBySector, 'fast');
}
const engineGrid = sliceEngine.getSinrGrid();
let engineMaeSum = 0.0;
for (let i = 0; i < TOTAL_VIEWSHED_CELLS; i++) {
  const diff = Math.abs(engineGrid[i] - fullWasm[i]);
  assert.equal(diff, 0.0, `PolarViewshedEngine.computeIncrementalSlice cell ${i} mismatch: ${diff}`);
  engineMaeSum += diff;
}
console.log(
  `[1/4] PASS: Slice-only WASM viewshed 4x9 sweep MAE=${(maeSum / TOTAL_VIEWSHED_CELLS).toFixed(5)} dB, ` +
    `engine MAE=${(engineMaeSum / TOTAL_VIEWSHED_CELLS).toFixed(5)} dB, wasm=${wasmSizeKb.toFixed(1)} KB (< 150 KB)`
);

// -----------------------------------------------------------------------------
// [2/4] On-Demand Worker IPC & Decoupled 50 Hz Physics vs 25 Hz UI Publish
// -----------------------------------------------------------------------------
const publishedFramesA: TelemetryFrame[] = [];
const publishedFramesB: TelemetryFrame[] = [];
const prevSelf = (globalThis as { self?: unknown }).self;

try {
  const mgrUnthrottled = new SimulationWorkerManager(17, '16_NODES');
  mgrUnthrottled.terrainEngine.loadCustomDem(demGrid);
  (globalThis as { self?: unknown }).self = {
    postMessage: (msg: WorkerOutboundMessage) => {
      if (msg && msg.type === 'TELEMETRY_FRAME') {
        publishedFramesA.push(msg.frame);
      }
    },
  };
  for (let t = 0; t < 40; t++) {
    mgrUnthrottled.tickSimulation(true);
  }

  const mgrThrottled = new SimulationWorkerManager(17, '16_NODES');
  mgrThrottled.terrainEngine.loadCustomDem(demGrid);
  (globalThis as { self?: unknown }).self = {
    postMessage: (msg: WorkerOutboundMessage) => {
      if (msg && msg.type === 'TELEMETRY_FRAME') {
        publishedFramesB.push(msg.frame);
      }
    },
  };
  const profRes = mgrThrottled.handleMessage({
    type: 'SET_TELEMETRY_PROFILE',
    subscriptions: {
      vsaConstellation: false,
      pduDissector: false,
      linkProfile: false,
    },
    uiPublishIntervalTicks: 2,
  });
  assert.equal(profRes.accepted, true, 'SET_TELEMETRY_PROFILE must be accepted');

  for (let t = 0; t < 40; t++) {
    mgrThrottled.tickSimulation(true);
  }

  assert.equal(publishedFramesA.length, 40, 'Unthrottled run must publish all 40 ticks');
  assert.equal(publishedFramesB.length, 20, 'uiPublishIntervalTicks=2 must skip odd ticks and publish 20 frames');
  for (let i = 0; i < publishedFramesB.length; i++) {
    assert.equal(publishedFramesB[i].frame_index, (i + 1) * 2, 'Published frame must land on even ticks only');
  }

  const fA40 = publishedFramesA[39];
  const fB40 = publishedFramesB[19];
  assert.equal(fB40.frame_index, 40, 'Physics must still advance at exact 50 Hz (40 ticks)');
  assert.equal(fB40.sim_time_s, fA40.sim_time_s, 'sim_time_s at tick 40 must match bit-for-bit');
  assert.equal(fB40.selected_node_fresnel, undefined, 'linkProfile=false must omit selected_node_fresnel');
  assert.equal(fB40.selected_link_budget, undefined, 'linkProfile=false must omit selected_link_budget');
  assert.equal(fB40.active_gantt_allocations, undefined, 'pduDissector=false must omit active_gantt_allocations');
  assert.equal(fB40.static_gantt_allocations, undefined, 'pduDissector=false must omit static_gantt_allocations');
  assert.equal(fB40.tac_gantt_allocations, undefined, 'pduDissector=false must omit tac_gantt_allocations');
  assert.equal(fB40.reactive_gantt_allocations, undefined, 'pduDissector=false must omit reactive_gantt_allocations');
  assert.ok(fB40.nodes_telemetry.length > 0);
  assert.equal(fB40.nodes_telemetry[0].rician_k_db, undefined, 'vsaConstellation=false must omit rician_k_db');
  assert.equal(fB40.nodes_telemetry[0].sector_gains_dbi, undefined, 'vsaConstellation=false must omit sector_gains_dbi');
  assert.equal(fB40.wasm_active, true, 'TelemetryFrame must expose wasm_active=true when WASM loaded');
  assert.ok(typeof fB40.state_digest_hex === 'string' && fB40.state_digest_hex.startsWith('0x'));

  const digestA40 = computeTelemetryStateDigest(fA40);
  const digestB40 = computeTelemetryStateDigest(fB40);
  assert.equal(digestB40, digestA40, 'Tick-40 state digest must match unthrottled run bit-for-bit');
  assert.equal(fB40.state_digest_hex, digestB40, 'TelemetryFrame.state_digest_hex must match computeTelemetryStateDigest');

  console.log(
    `[2/4] PASS: On-demand IPC omitted heavy scopes, skipped odd ticks (20/40 published), ` +
      `50 Hz tick-40 digest=${digestB40} matches unthrottled bit-for-bit`
  );
} finally {
  if (prevSelf === undefined) {
    delete (globalThis as { self?: unknown }).self;
  } else {
    (globalThis as { self?: unknown }).self = prevSelf;
  }
}

// -----------------------------------------------------------------------------
// [3/4] Event-Sourced Flight Recorder (< 50 KB) & Bit-Exact Headless Replay
// -----------------------------------------------------------------------------
const recorder = new EventSourcedFlightRecorder({
  seed: 42,
  initialBiomeId: 'alpine_mountain',
  createdUtcIso: '2026-11-26T00:00:00.000Z',
});
const ioCtrl = initMissionIoController({
  getFlightRecorder: () => recorder,
});

const liveMgr = new SimulationWorkerManager(42, '16_NODES');
const dispatchAndRecord = (cmd: WorkerInboundCommand, tick: number, simTimeS: number): void => {
  recorder.recordCommand(cmd, tick, simTimeS);
  liveMgr.handleMessage(cmd);
};

// Filtered UI-only command must not be stored in recording events
dispatchAndRecord(
  { type: 'SET_TELEMETRY_PROFILE', subscriptions: { linkProfile: true }, uiPublishIntervalTicks: 1 },
  0,
  0
);
assert.equal(recorder.getEventCount(), 0, 'SET_TELEMETRY_PROFILE must be filtered out of flight recording');

for (let tick = 1; tick <= 100; tick++) {
  liveMgr.tickSimulation(true);
  if (liveMgr.lastTelemetryFrame) {
    recorder.observeFrame(liveMgr.lastTelemetryFrame);
  }
  const simT = liveMgr.simTimeS;
  if (tick === 20) {
    dispatchAndRecord(
      { type: 'SET_BIOME', biomeId: 'arid_desert', dustVisibilityKm: 6.5, enableBiomeEmPhysics: true },
      tick,
      simT
    );
  } else if (tick === 45) {
    dispatchAndRecord(
      {
        type: 'NODE_ADD',
        node_type: 'soldier',
        name: 'UPG01-SCOUT',
        x_m: 6200,
        y_m: -4100,
        agl_m: 2.5,
      },
      tick,
      simT
    );
  } else if (tick === 70) {
    dispatchAndRecord(
      { type: 'CONFIG_UPDATE', rain_rate_mmh: 18.0, traffic_load_multiplier: 1.5 },
      tick,
      simT
    );
  }
}

const recJson = ioCtrl.exportFlightRecording(false);
const recBytes = Buffer.byteLength(recJson, 'utf8');
assert.ok(recBytes < 10 * 1024, `100-tick flight recording must be < 10 KB, got ${recBytes} bytes`);

const parsedRec = parseFlightRecordingJson(recJson);
assert.equal(parsedRec.version, 'stratos-flight-rec-v1');
assert.equal(parsedRec.totalTicks, 100);
assert.equal(parsedRec.events.length, 3);
assert.equal(parsedRec.events.some((e) => e.command.type === 'SET_TELEMETRY_PROFILE'), false);

// Prototype-pollution rejection checks
assert.throws(
  () =>
    parseFlightRecordingJson(
      recJson.slice(0, -1) + ',"__proto__":{"polluted":true}}'
    ),
  /prototype pollution/i
);
assert.throws(
  () =>
    parseFlightRecordingJson(
      '{"version":"stratos-flight-rec-v1","\\u005f\\u005fproto\\u005f\\u005f":{"x":1}}'
    ),
  /prototype pollution/i
);

const replayOut = ioCtrl.importAndReplayFlightRecording(
  recJson,
  (rec) => new SimulationWorkerManager(rec.seed, '16_NODES')
);
assert.equal(replayOut.ok, true, `Headless flight replay failed: ${JSON.stringify(replayOut)}`);
assert.equal(replayOut.actualDigest, replayOut.expectedDigest, 'Replay digest must match live run bit-for-bit');

const directReplay = replayFlightRecordingHeadless(
  parsedRec,
  (rec) => new SimulationWorkerManager(rec.seed, '16_NODES')
);
assert.equal(directReplay.ok, true);
assert.equal(directReplay.actualDigest, parsedRec.finalStateDigestHex);

console.log(
  `[3/4] PASS: Flight recording JSON = ${recBytes} bytes (< 10 KB), prototype-pollution blocked, ` +
    `100-tick replay digest=${replayOut.actualDigest} bit-exact`
);

// -----------------------------------------------------------------------------
// [4/4] SystemHealthHud, Zero innerHTML / XSS, CSP & simWorker Line Budget
// -----------------------------------------------------------------------------
const elementsById = new Map<string, { id: string; textContent: string; className: string; children: unknown[]; appendChild: (c: unknown) => void }>();
const makeEl = (tag: string) => {
  const el = {
    tagName: tag.toUpperCase(),
    id: '',
    textContent: '',
    className: '',
    children: [] as unknown[],
    appendChild(child: unknown) {
      this.children.push(child);
      if (child && typeof child === 'object' && 'id' in child && typeof (child as { id: string }).id === 'string' && (child as { id: string }).id) {
        elementsById.set((child as { id: string }).id, child as never);
      }
      return child;
    },
  };
  return el;
};
const mockDoc = {
  getElementById: (id: string) => elementsById.get(id) ?? null,
  createElement: (tag: string) => makeEl(tag),
} as unknown as Document;

for (const id of [
  'syshealth-kernel-badge',
  'syshealth-summary-kernel',
  'syshealth-pacing',
  'syshealth-runtime',
  'syshealth-airgap',
  'syshealth-digest',
  'syshealth-rec-status',
]) {
  elementsById.set(id, { ...makeEl('span'), id });
}

const hud = new SystemHealthHud({
  documentRef: mockDoc,
  getAirGapOffline: () => true,
  getRecordedEventCount: () => recorder.getEventCount(),
});
const snapWasm = hud.update({
  frame: publishedFramesB[19],
  rollingStepSamples: [3.2, 4.0, 5.1, 6.4],
  rollingInterFrameDeltas: [20.0, 20.1, 19.9, 20.0],
});
assert.equal(snapWasm.computeKernel, 'RUST/WASM');
assert.equal(elementsById.get('syshealth-kernel-badge')?.textContent, 'RUST/WASM');
assert.equal(elementsById.get('syshealth-airgap')?.textContent, 'AIR-GAP LOCKED (0 ext)');
assert.equal(elementsById.get('syshealth-digest')?.textContent, publishedFramesB[19].state_digest_hex);
assert.match(elementsById.get('syshealth-pacing')?.textContent ?? '', /\d+\.\d{2} \/ \d+\.\d{2} ms/);
assert.equal(elementsById.get('syshealth-rec-status')?.textContent, 'REC: 3 events');

const snapFallback = hud.update({
  frame: { ...publishedFramesB[19], wasm_active: false },
  airGapLocked: false,
  rollingStepSamples: [3.2, 4.0],
});
assert.equal(snapFallback.computeKernel, 'TS FALLBACK');
assert.equal(elementsById.get('syshealth-kernel-badge')?.textContent, 'TS FALLBACK');
assert.equal(elementsById.get('syshealth-airgap')?.textContent, 'ONLINE TILES');

const hudSource = fs.readFileSync(hudPath, 'utf8');
assert.equal(hudSource.includes('innerHTML'), false, 'systemHealthHud.ts must contain zero innerHTML usage');

const htmlText = fs.readFileSync(indexHtmlPath, 'utf8');
const inlineScripts = [...htmlText.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].filter(
  (m) => m[1].trim().length > 0
);
assert.equal(inlineScripts.length, 0, 'index.html must contain zero inline <script> bodies');
const inlineHandlers = htmlText.match(/\son[a-z]+\s*=/gi) ?? [];
assert.equal(inlineHandlers.length, 0, 'index.html must contain zero inline on*= event attributes');

const simWorkerLines = fs.readFileSync(simWorkerPath, 'utf8').split('\n').length;
assert.ok(simWorkerLines < 3250, `simWorker.ts must stay < 3,250 lines, got ${simWorkerLines}`);

console.log(
  `[4/4] PASS: SystemHealthHud safe DOM updates verified, zero innerHTML/XSS, ` +
    `0 inline scripts/handlers in index.html, simWorker.ts=${simWorkerLines} lines (< 3,250)`
);
console.log('='.repeat(92) + '\n');
