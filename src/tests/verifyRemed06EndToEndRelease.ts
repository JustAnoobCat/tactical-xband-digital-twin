/**
 * src/tests/verifyRemed06EndToEndRelease.ts
 *
 * REMED-06 Grand Finale E2E Release Verification Suite:
 * 1. Strict Electron CSP static audit on index.html (zero inline <script> bodies,
 *    zero inline on[a-z]+= HTML event handler attributes, external /src/main.ts module).
 * 2. Live postWorkerCommand wiring audit in src/main.ts (getMissionIoController).
 * 3. Full E2E "Career Demo Flow" on a real SimulationWorkerManager:
 *    - Switch biome to arid_desert (Thar Desert) -> geodesy, hillshade, 3D fast128 skirt seal
 *    - Spawn dynamic Node 16 (NODE_ADD) -> tick real worker -> ObstacleEditorState.reconcile,
 *      checkAglEditEligibility(16), TacticalEntityManager + ThreeVolumetricRfLayer +
 *      ThreeSceneManager.getMetrics().entityCount (17 pre-frame -> 18 post-17-node telemetry)
 *    - Apply custom obstacle (OBSTACLES_REPLACE) -> tick within 50 Hz budget
 *    - Export Scenario JSON -> parse & replay via applyScenarioJson with spy dispatcher
 *    - Export AAR Briefing & Tactical Snapshot -> verify Hi-Fi flags false, MCX 5QI 69/65/67/70,
 *      no hardcoded 12.31/20.38, Node 15 = MCP
 * 4. README.md & 128-suite count synchronization audit.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

import { SimulationWorkerManager } from '../worker/simWorker';
import type {
  TelemetryFrame,
  TelemetryFrameMessage,
  WorkerInboundCommand,
} from '../shared/workerProtocol';
import { THEATER_BIOMES } from '../core/biomePhysics';
import { BIOME_DEM_METADATA } from '../core/terrain';
import { MCP_ID } from '../shared/constants';
import { HillshadeGenerator } from '../worker/hillshadeGenerator';
import { buildTerrainGeometrySet } from '../ui/three/terrainBuilder';
import { TacticalEntityManager } from '../ui/three/tacticalEntityManager';
import { ThreeSceneManager } from '../ui/three/sceneManager';
import { ThreeVolumetricRfLayer } from '../ui/three/threeVolumetricRfLayer';
import { ObstacleEditorState, type ObstructionSnapshot } from '../ui/obstacleEditorState';
import { obstacleFootprintPoints } from '../core/obstacles';
import { checkAglEditEligibility } from '../ui/nodeAglController';
import { initMissionIoController } from '../ui/controllers/missionIoController';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

function setupMockThreeDom(): {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  cleanup: () => void;
} {
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const docListeners: Record<string, ((e: any) => void)[]> = {};

  const mockGl: any = new Proxy(
    {
      canvas: null,
      drawingBufferWidth: 800,
      drawingBufferHeight: 600,
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      HIGH_FLOAT: 36338,
      MEDIUM_FLOAT: 36337,
      LOW_FLOAT: 36336,
      HIGH_INT: 36341,
      MEDIUM_INT: 36340,
      LOW_INT: 36339,
      RGBA: 6408,
      UNSIGNED_BYTE: 5121,
      POINTS: 0,
      LINES: 1,
      LINE_LOOP: 2,
      LINE_STRIP: 3,
      TRIANGLES: 4,
      TRIANGLE_STRIP: 5,
      TRIANGLE_FAN: 6,
      VERSION: 7938,
      SHADING_LANGUAGE_VERSION: 35724,
      VENDOR: 7936,
      RENDERER: 7937,
      VIEWPORT: 2978,
      ACTIVE_UNIFORMS: 35718,
      ACTIVE_ATTRIBUTES: 35721,
      LINK_STATUS: 35714,
      COMPILE_STATUS: 35713,
      getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
      getExtension: () => null,
      getParameter: (param: number) => {
        if (param === 7938) return 'WebGL 2.0 (Mock)';
        if (param === 35724) return 'WebGL GLSL ES 3.00';
        if (param === 7936 || param === 7937) return 'Mock';
        if (param === 2978) return new Int32Array([0, 0, 800, 600]);
        return 16;
      },
      getProgramParameter: (_p: any, param: number) =>
        param === 35718 || param === 35721 ? 0 : true,
      getShaderParameter: () => true,
      getProgramInfoLog: () => '',
      getShaderInfoLog: () => '',
      getActiveUniform: () => null,
      getActiveAttrib: () => null,
      getUniformLocation: () => ({}),
      getAttribLocation: () => 0,
      createTexture: () => ({}),
      createBuffer: () => ({}),
      createProgram: () => ({}),
      createShader: () => ({}),
      createFramebuffer: () => ({}),
      createRenderbuffer: () => ({}),
    },
    {
      get: (target, prop: string) => (prop in target ? target[prop] : () => ({})),
    }
  );

  const mockDoc: any = {
    addEventListener: (t: string, cb: (e: any) => void) => {
      (docListeners[t] ??= []).push(cb);
    },
    removeEventListener: (t: string, cb: (e: any) => void) => {
      if (docListeners[t]) docListeners[t] = docListeners[t].filter((h) => h !== cb);
    },
  };

  const mockCanvas: any = {
    addEventListener: (t: string, cb: (e: any) => void) => {
      (listeners[t] ??= []).push(cb);
    },
    removeEventListener: (t: string, cb: (e: any) => void) => {
      if (listeners[t]) listeners[t] = listeners[t].filter((h) => h !== cb);
    },
    dispatchEvent: (e: any) => {
      for (const cb of listeners[e.type] ?? []) cb(e);
      return true;
    },
    getContext: () => {
      mockGl.canvas = mockCanvas;
      return mockGl;
    },
    ownerDocument: mockDoc,
    getRootNode: () => mockDoc,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
    }),
    style: {},
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    parentElement: null,
    remove: () => {},
  };

  const mockContainer: any = {
    clientWidth: 800,
    clientHeight: 600,
    style: {},
    setAttribute: () => {},
    getAttribute: () => null,
    contains: (el: any) => el === mockCanvas,
    appendChild: (el: any) => {
      el.parentElement = mockContainer;
    },
  };
  mockCanvas.parentElement = mockContainer;

  const origRaf = globalThis.requestAnimationFrame;
  const origCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  return {
    container: mockContainer,
    canvas: mockCanvas,
    cleanup: () => {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCaf;
    },
  };
}

let passed = 0;
function runStep(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✔ [PASS] ${label}`);
}

console.log('================================================================================');
console.log('  REMED-06 GRAND FINALE E2E RELEASE & CAREER DEMO VERIFICATION GATE');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// 1. Strict Electron CSP Static Audit on index.html
// -----------------------------------------------------------------------------
runStep('1. Strict Electron CSP static audit on index.html (0 inline <script>, 0 on*= handlers)', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

  // Every <script> tag must have a src="..." attribute and an empty body
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const scripts = [...indexHtml.matchAll(scriptRegex)];
  assert.ok(scripts.length >= 1, 'index.html must declare at least one external <script src="..."> tag');

  for (const m of scripts) {
    const attrs = m[1];
    const body = m[2].trim();
    assert.ok(/\bsrc\s*=\s*["'][^"']+["']/i.test(attrs), `<script> tag must specify src attribute: <script${attrs}>`);
    assert.equal(body, '', `Inline <script> body forbidden under strict Electron CSP (found ${body.length} chars)`);
  }

  assert.ok(
    /<script\s+type=["']module["']\s+src=["']\/src\/main\.ts["']\s*><\/script>/i.test(indexHtml),
    'index.html must load external ES module <script type="module" src="/src/main.ts"></script>'
  );

  // Zero inline on[a-z]+= HTML event handler attributes
  const inlineHandlers = [...indexHtml.matchAll(/\son[a-z]+\s*=/gi)];
  assert.equal(
    inlineHandlers.length,
    0,
    `index.html must contain zero inline on*= attributes (found: ${inlineHandlers.map((m) => m[0].trim()).join(', ')})`
  );
});

// -----------------------------------------------------------------------------
// 2. Live postWorkerCommand Wiring Audit in src/main.ts
// -----------------------------------------------------------------------------
runStep('2. Live postWorkerCommand wiring audit in src/main.ts', () => {
  const mainTsPath = path.join(ROOT_DIR, 'src', 'main.ts');
  assert.equal(fs.existsSync(mainTsPath), true, 'src/main.ts must exist');
  const mainTs = fs.readFileSync(mainTsPath, 'utf8');

  const ioInitIdx = mainTs.indexOf('initMissionIoController({');
  assert.ok(ioInitIdx !== -1, 'src/main.ts must call initMissionIoController({...})');
  const ioSnippet = mainTs.slice(ioInitIdx, ioInitIdx + 600);
  assert.ok(
    ioSnippet.includes('postWorkerCommand:') && ioSnippet.includes('sendCommand('),
    'getMissionIoController() in src/main.ts must wire postWorkerCommand -> sendCommand(cmd)'
  );
  assert.equal(
    /\bonclick\s*=\s*["']/i.test(mainTs),
    false,
    'src/main.ts dynamic HTML templates must contain zero inline onclick="..." attributes'
  );
});

// -----------------------------------------------------------------------------
// 3. Full E2E Multi-Feature "Career Demo Flow" on Real SimulationWorkerManager
// -----------------------------------------------------------------------------
const capturedFrames: TelemetryFrameMessage[] = [];
const prevSelf = (globalThis as { self?: unknown }).self;
(globalThis as { self?: unknown }).self = {
  postMessage: (msg: unknown) => {
    const m = msg as TelemetryFrameMessage | undefined;
    if (m && m.type === 'TELEMETRY_FRAME') {
      capturedFrames.push(m);
    }
  },
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
};

try {
  const sim = new SimulationWorkerManager(2026_06, '16_NODES');
  sim.isPaused = true;

  // Step 3a: Switch biome to arid_desert (Thar Desert)
  let desertFrame!: TelemetryFrame;
  runStep('3a. Thar Desert (arid_desert) biome switch: geodesy, hillshade relief, 3D fast128 skirts', () => {
    const biomeRes = sim.handleMessage({ type: 'SET_BIOME', biomeId: 'arid_desert' });
    assert.equal(biomeRes.accepted, true, 'SET_BIOME arid_desert must be accepted by worker');

    const center = sim.terrainEngine.worldToLatLon(0, 0);
    assert.ok(
      Math.abs(center.latDeg - THEATER_BIOMES.arid_desert.centerLatDeg) < 0.05 &&
        Math.abs(center.lonDeg - THEATER_BIOMES.arid_desert.centerLonDeg) < 0.05,
      `worldToLatLon(0,0) must match Thar Desert (~27°N, 71.5°E), got (${center.latDeg}, ${center.lonDeg})`
    );

    const hg = new HillshadeGenerator();
    const hs = hg.generate(sim.terrainEngine, 512);
    const distinctColors = new Set<number>();
    for (let r = 16; r < 496; r += 8) {
      for (let c = 16; c < 496; c += 8) {
        distinctColors.add(hs.grid[r][c]);
      }
    }
    assert.ok(
      distinctColors.size >= 8,
      `Thar Desert hillshade must produce multi-tone relief (got ${distinctColors.size} colors)`
    );

    const bounds = sim.terrainEngine.getTerrainBoundsTelemetry();
    const minElev = sim.terrainEngine.demMetadata.minElevationM!;
    const maxElev = sim.terrainEngine.demMetadata.maxElevationM!;
    const geoSet = buildTerrainGeometrySet(
      {
        elevations: sim.terrainEngine.realDemGrid!,
        gridSize: 512,
        bounds,
        terrainMode: 'real',
        minElevationM: minElev,
        maxElevationM: maxElev,
      },
      'fast128'
    );
    assert.ok(geoSet.skirtGeometry !== null, 'fast128 terrain skirt geometry must exist');
    const meshPos = geoSet.meshGeometry.getAttribute('position');
    const skirtPos = geoSet.skirtGeometry!.getAttribute('position');
    const skirtNorm = geoSet.skirtGeometry!.getAttribute('normal');

    let minSkirtZ = Number.POSITIVE_INFINITY;
    for (let i = 0; i < skirtPos.count; i++) {
      const z = skirtPos.getZ(i);
      if (z < minSkirtZ) minSkirtZ = z;
    }
    assert.ok(
      minSkirtZ < minElev,
      `3D fast128 skirt base (${minSkirtZ}m) must seal strictly below minElevationM (${minElev}m)`
    );

    // Check East wall edge seal flush (< 1e-3 m)
    for (let r = 0; r < 127; r += 8) {
      const meshY = meshPos.getY(r * 128 + 127);
      const meshZ = meshPos.getZ(r * 128 + 127);
      let matched = false;
      for (let vi = 0; vi < skirtPos.count; vi++) {
        if (
          skirtNorm.getX(vi) === 1 &&
          Math.abs(skirtPos.getY(vi) - meshY) < 1e-2 &&
          Math.abs(skirtPos.getZ(vi) - meshZ) < 1e-3
        ) {
          matched = true;
          break;
        }
      }
      assert.ok(matched, `fast128 East skirt row ${r} must seal flush with mesh edge`);
    }

    sim.tickSimulation(true);
    desertFrame = capturedFrames[capturedFrames.length - 1].frame;
    assert.equal(desertFrame.nodes_telemetry.length, 16);
    assert.ok(
      Math.abs(desertFrame.acn_telemetry.lat_deg - THEATER_BIOMES.arid_desert.centerLatDeg) < 0.25 &&
        Math.abs(desertFrame.acn_telemetry.lon_deg - THEATER_BIOMES.arid_desert.centerLonDeg) < 0.25,
      `arid_desert acn_telemetry must emit Thar Desert coords (~27°N, 71.5°E), got (${desertFrame.acn_telemetry.lat_deg}, ${desertFrame.acn_telemetry.lon_deg})`
    );
    for (const nodeTel of desertFrame.nodes_telemetry) {
      assert.ok(
        Math.abs(nodeTel.lat_deg - THEATER_BIOMES.arid_desert.centerLatDeg) < 0.5 &&
          Math.abs(nodeTel.lon_deg - THEATER_BIOMES.arid_desert.centerLonDeg) < 0.5,
        `arid_desert node ${nodeTel.node_id} must emit Thar Desert coords (~27°N, 71.5°E), got (${nodeTel.lat_deg}, ${nodeTel.lon_deg})`
      );
    }
    assert.ok(
      !desertFrame.plain_english_narrative.includes('FL500'),
      `plain_english_narrative must never report hardcoded FL500, got: ${desertFrame.plain_english_narrative}`
    );
    const expectedFl = Math.round((desertFrame.acn_telemetry.altitude_msl_m * 3.28084) / 100);
    if (desertFrame.plain_english_narrative.includes('NOMINAL PATROL')) {
      assert.ok(
        desertFrame.plain_english_narrative.includes(`FL${expectedFl}`),
        `NOMINAL PATROL narrative must contain dynamic FL${expectedFl}, got: ${desertFrame.plain_english_narrative}`
      );
    }
    const expectedDesertHalfKm = BIOME_DEM_METADATA.arid_desert.halfWidthM / 1000;
    assert.ok(
      Math.abs(desertFrame.terrain_bounds_km - expectedDesertHalfKm) < 1e-4,
      `arid_desert terrain_bounds_km must equal ${expectedDesertHalfKm}, got ${desertFrame.terrain_bounds_km}`
    );
  });

  // Step 3b: Spawn dynamic Node 16 -> tick -> ObstacleEditor, AGL eligibility, 3D managers & entityCount
  let frame17!: TelemetryFrame;
  runStep('3b. Dynamic Node 16 (NODE_ADD) -> 17-node worker tick, ObstacleEditor, AGL, 3D & entityCount', () => {
    const addRes = sim.handleMessage({
      type: 'NODE_ADD',
      role: 'soldier',
      x_m: 4500,
      y_m: -3200,
      agl_m: 2.5,
      callsign: 'S16-THAR',
    });
    assert.equal(addRes.accepted, true, 'NODE_ADD for Node 16 must succeed');
    assert.equal(addRes.node_id, 16, '17th spawned node must receive node_id=16');

    sim.tickSimulation(true);
    frame17 = capturedFrames[capturedFrames.length - 1].frame;
    assert.equal(frame17.nodes_telemetry.length, 17, 'Live telemetry frame must contain 17 nodes');

    // ObstacleEditorState.reconcile() with 17 nodes
    const editor = new ObstacleEditorState();
    editor.beginApply('remed06-req-17');
    const mockSnaps: ObstructionSnapshot[] = frame17.nodes_telemetry.map((n) => ({
      node_id: n.node_id,
      terrain_is_los: true,
      obstacle_blocked: false,
      obstacle_intersections: [],
      link_outage: false,
      bitrate_bps: 5_000_000,
      modcod_name: 'QPSK 1/2',
      predicted_state: 'NORMAL_LOS',
      time_to_occlusion_s: Number.POSITIVE_INFINITY,
      time_to_emergence_s: Number.POSITIVE_INFINITY,
      is_shadowed: false,
    }));
    const reconciled = editor.reconcile({
      type: 'COMMAND_RESULT',
      command_type: 'OBSTACLES_REPLACE',
      request_id: 'remed06-req-17',
      accepted: true,
      spatial_locked: false,
      obstacle_set: [],
      obstruction_state: mockSnaps,
    });
    assert.equal(reconciled, true, 'ObstacleEditorState.reconcile() must accept 17 nodes');

    // checkAglEditEligibility(16)
    const aglCheck = checkAglEditEligibility({
      spatialLocked: false,
      isHistorical: false,
      nodeId: 16,
    });
    assert.equal(aglCheck.canEdit, true, 'checkAglEditEligibility(16) must allow AGL editing');

    // TacticalEntityManager + ThreeVolumetricRfLayer + ThreeSceneManager.getMetrics().entityCount
    const dom = setupMockThreeDom();
    try {
      const sceneMgr = new ThreeSceneManager({
        container: dom.container,
        canvas: dom.canvas,
        maxPixelRatio: 1,
      });
      assert.equal(
        sceneMgr.getMetrics().entityCount,
        17,
        'ThreeSceneManager.getMetrics().entityCount must fall back cleanly to 17 before first frame'
      );

      sceneMgr.tacticalEntityManager.updateFromTelemetry(frame17);
      assert.equal(
        sceneMgr.tacticalEntityManager.getNodeItem(MCP_ID)?.isMcp,
        true,
        'Node 15 must be MCP in TacticalEntityManager'
      );
      assert.ok(sceneMgr.tacticalEntityManager.getNodeItem(16), 'Node 16 must exist in TacticalEntityManager');
      assert.equal(
        sceneMgr.getMetrics().entityCount,
        18,
        'ThreeSceneManager.getMetrics().entityCount must reflect 17 ground nodes + 1 ACN = 18'
      );

      const rfLayer = new ThreeVolumetricRfLayer({
        showFresnel: true,
        showSectorLobes: true,
        showThreatVolumes: true,
      });
      rfLayer.update(frame17, { selectedNodeId: 16 });
      assert.equal(rfLayer.getState().activeEllipsoidCount, 17, 'ThreeVolumetricRfLayer must render 17 ellipsoids');
      rfLayer.dispose();
      sceneMgr.dispose();
    } finally {
      dom.cleanup();
    }
  });

  // Step 3c: Apply custom obstacle (OBSTACLES_REPLACE) & verify 50 Hz tick budget
  runStep('3c. Apply custom obstacle (OBSTACLES_REPLACE) & tick within 50 Hz (< 20 ms) budget', () => {
    const obsRes = sim.handleMessage({
      type: 'OBSTACLES_REPLACE',
      request_id: 'remed06-obs-1',
      obstacles: [
        {
          id: 'obs-thar-berm-1',
          shape: 'cuboid',
          xM: 2000,
          yM: -1250,
          widthM: 1200,
          depthM: 80,
          heightM: 180,
          rotationDeg: 25,
        },
      ],
    });
    assert.equal(obsRes.accepted, true, 'OBSTACLES_REPLACE must succeed');

    // Warm up JIT once, then measure tick latency
    sim.tickSimulation(true);
    const t0 = performance.now();
    sim.tickSimulation(true);
    const dtMs = performance.now() - t0;
    assert.ok(dtMs < 20.0, `Worker tick with obstacle + 17 nodes must finish within 50 Hz budget (got ${dtMs.toFixed(2)} ms)`);
    frame17 = capturedFrames[capturedFrames.length - 1].frame;
  });

  // Step 3d: Scenario JSON export/replay + AAR Briefing & Tactical Snapshot verification
  runStep('3d. Scenario JSON export/replay via postWorkerCommand + AAR & Tactical Snapshot audit', () => {
    const dispatched: WorkerInboundCommand[] = [];
    const io = initMissionIoController({
      getLatestTelemetry: () => frame17,
      getActiveBiomeId: () => 'arid_desert',
      getObstacles: () =>
        sim.terrainEngine.obstacleField.all.map((o) => ({
          id: o.id,
          type: o.shape,
          heightM: o.heightM,
          footprint: obstacleFootprintPoints(o),
        })),
      postWorkerCommand: (cmd) => dispatched.push(cmd),
    });

    const exportedJson = io.exportScenarioJson();
    const parsedScenario = JSON.parse(exportedJson);
    assert.equal(parsedScenario.theater.biomeId, 'arid_desert');
    assert.equal(
      parsedScenario.theater.centerLatDeg,
      BIOME_DEM_METADATA.arid_desert.centerLatDeg,
      'exportScenarioJson must emit Thar Desert centerLatDeg'
    );
    assert.equal(
      parsedScenario.theater.centerLonDeg,
      BIOME_DEM_METADATA.arid_desert.centerLonDeg,
      'exportScenarioJson must emit Thar Desert centerLonDeg'
    );
    assert.equal(parsedScenario.nodes.length, 17);

    const applyRes = io.applyScenarioJson(exportedJson);
    assert.equal(applyRes.ok, true, 'applyScenarioJson must parse exported scenario cleanly');
    assert.equal(
      applyRes.unsupportedFields.includes('theater.centerLatDeg/centerLonDeg'),
      false,
      'arid_desert scenario round-trip must not emit false theater.centerLatDeg/centerLonDeg warning'
    );
    assert.equal(
      applyRes.unsupportedFields.includes('worker command dispatcher unavailable'),
      false,
      'postWorkerCommand must be wired so worker command dispatcher is available'
    );
    assert.ok(applyRes.dispatchedCount >= 2, `Expected >= 2 dispatched commands, got ${applyRes.dispatchedCount}`);
    assert.equal(dispatched.length, applyRes.dispatchedCount);
    assert.ok(dispatched.some((c) => c.type === 'SET_BIOME'), 'Replay must dispatch SET_BIOME');
    assert.ok(dispatched.some((c) => c.type === 'OBSTACLES_REPLACE'), 'Replay must dispatch OBSTACLES_REPLACE');
    assert.ok(dispatched.some((c) => c.type === 'NODE_UPDATE'), 'Replay must dispatch NODE_UPDATE for existing live nodes');

    const aar = io.buildCurrentAarSnapshot(frame17);
    assert.equal(aar.activeModels.airframeShadowing, false, 'Disabled airframeShadowing must report false');
    assert.equal(aar.activeModels.correlatedRician, false, 'Disabled correlatedRician must report false');
    assert.equal(aar.activeModels.macPhyFeedback, false, 'Disabled macPhyFeedback must report false');
    assert.equal(aar.activeModels.dubinsKinematics, false, 'Disabled dubinsKinematics must report false');
    assert.equal(aar.activeModels.viewshedParity, false, 'Disabled viewshedParity must report false');
    assert.equal(aar.activeModels.transportAbr, false, 'Disabled transportAbr must report false');

    const fiveQis = aar.qosSlaSummary.classes.map((c) => c.fiveQi);
    assert.deepEqual(fiveQis, [69, 65, 67, 70], 'AAR must use MCX 5QI classes 69/65/67/70');
    for (const qci of [1, 2, 4, 9]) {
      assert.equal(fiveQis.includes(qci), false, `Civilian 5QI ${qci} must never appear`);
    }
    assert.notEqual(aar.kpis.staticDeliveredMb, 12.31, 'Hardcoded 12.31 must not appear');
    assert.notEqual(aar.kpis.tacDeliveredMb, 20.38, 'Hardcoded 20.38 must not appear');

    const tacSnap = io.buildTacticalSnapshot(frame17);
    const acnEntity = tacSnap.entities.find((e) => e.role === 'ACN');
    const mcpEntity = tacSnap.entities.find((e) => e.id === MCP_ID);
    const soldierEntity = tacSnap.entities.find((e) => e.id === 0);
    assert.ok(acnEntity, 'ACN-1 must be present in TacticalSnapshot');
    assert.ok(
      Math.abs(acnEntity!.latDeg - THEATER_BIOMES.arid_desert.centerLatDeg) < 0.25 &&
        Math.abs(acnEntity!.lonDeg - THEATER_BIOMES.arid_desert.centerLonDeg) < 0.25,
      `TacticalSnapshot ACN must use Thar Desert coords (~27°N, 71.5°E), got (${acnEntity!.latDeg}, ${acnEntity!.lonDeg})`
    );
    assert.ok(mcpEntity, 'Node 15 must be present in TacticalSnapshot');
    assert.ok(
      Math.abs(mcpEntity!.latDeg - THEATER_BIOMES.arid_desert.centerLatDeg) < 0.5 &&
        Math.abs(mcpEntity!.lonDeg - THEATER_BIOMES.arid_desert.centerLonDeg) < 0.5,
      `TacticalSnapshot MCP must use Thar Desert coords (~27°N, 71.5°E), got (${mcpEntity!.latDeg}, ${mcpEntity!.lonDeg})`
    );
    assert.equal(mcpEntity!.role, 'MCP', 'Node 15 must be tagged MCP');
    assert.equal(soldierEntity?.role, 'SOLDIER', 'Node 0 must be tagged SOLDIER');
  });
} finally {
  if (prevSelf === undefined) {
    delete (globalThis as { self?: unknown }).self;
  } else {
    (globalThis as { self?: unknown }).self = prevSelf;
  }
}

// -----------------------------------------------------------------------------
// 4. README.md & 134-Suite Count Sync Audit
// -----------------------------------------------------------------------------
runStep('4. README.md technical reconciliation & 134-suite count sync check', () => {
  const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
  assert.ok(readme.includes('16.0'), 'README.md must document 16.0 dBi quad-sector peak gain');
  assert.ok(readme.includes('90^\\circ') || readme.includes('90°'), 'README.md must document 90 deg azimuth HPBW');
  assert.ok(readme.includes('6.0'), 'README.md must document 6.0 km dry O2 scale height');
  assert.ok(readme.includes('134'), 'README.md must document 134 TypeScript verification suites');
  assert.ok(readme.includes('AWS Terrarium') && readme.includes('.hgt'), 'README.md must document Terrarium DEM + SRTM .hgt');
  assert.ok(
    readme.includes('core/*.py') && readme.includes('server/app.py') && readme.includes('ts_parity_server.ts'),
    'README.md must include legacy Python reference prototype note'
  );
});

console.log('\n================================================================================');
console.log(`  REMED-06 SUMMARY: ${passed}/7 checks passed, 0 failures.`);
console.log('================================================================================\n');
