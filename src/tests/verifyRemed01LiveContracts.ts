/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Verification Suite: REMED-01 Live Telemetry Contract Integrity, 3D Volumetric RF & Mission I/O Wiring
 *
 * Exercises a real SimulationWorkerManager (zero mock TelemetryFrames) end-to-end across:
 * 1. Live TelemetryFrame generation with jammer, advecting weather cell, and >16 nodes (17th node).
 * 2. ThreeVolumetricRfLayer anchoring to liveFrame.acn_telemetry, >16 node capacity, jammer & weather volumes.
 * 3. missionIoController.buildCurrentAarSnapshot(liveFrame) & buildTacticalSnapshot(liveFrame).
 * 4. missionIoController Scenario JSON load dispatch via spy postWorkerCommand & worker execution.
 * 5. DiagnosticsTracker live NodeTerrainState counts & mapRfOverlay state matching.
 * 6. renderRfFieldProbeOverlay with real SiteProbeViewshedResult (horizonMask: HorizonMaskBin[]).
 * 7. LinkProfileViewport hover crosshair right-boundary guard & DVB-S2X labels.
 */

import assert from 'node:assert/strict';
import { SimulationWorkerManager } from '../worker/simWorker';
import type { TelemetryFrame, TelemetryFrameMessage, WorkerInboundCommand } from '../shared/workerProtocol';
import { ThreeVolumetricRfLayer } from '../ui/three/threeVolumetricRfLayer';
import { simToThreeCoords } from '../ui/three/threeTypes';
import { initMissionIoController } from '../ui/controllers/missionIoController';
import { serializeMissionScenarioJson, type MissionScenarioV3 } from '../core/militaryGisEngine';
import { MCP_ID } from '../core/nodeRegistry';
import { DiagnosticsTracker } from '../ui/workbench/diagnosticsTelemetry';
import { renderRadarSignalQualityRings } from '../ui/workbench/mapRfOverlay';
import { renderRfFieldProbeOverlay, computeRfSinrMeterState } from '../ui/toolboxPrecisionSuite';
import { computeSiteProbeViewshed, type ToolboxSimulationContext } from '../ui/terrainToolboxAnalysis';
import { sampleProbeSignalAtWorldPoint } from '../ui/terrainToolboxCharts';
import { renderLinkProfileViewport, LinkProfileViewportState } from '../ui/linkProfileViewport';
import { buildLinkProfile } from '../core/linkProfile';
import { EnvironmentConfig, RFConfig } from '../core/config';
import { TerrainEngine } from '../core/terrain';
import { THEATER_HALF_M } from '../shared/constants';
import { NodeTerrainState } from '../core/trajectory';

let passed = 0;
let total = 0;

function runTest(name: string, fn: () => void): void {
  total++;
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✔\x1b[0m [PASS] ${name}`);
  } catch (err) {
    console.error(`  \x1b[31m✖\x1b[0m [FAIL] ${name}`);
    throw err;
  }
}

console.log('\n================================================================================');
console.log(' Tactical X-Band Digital Twin — REMED-01 Live Contract Integration Suite');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// 1. Boot real SimulationWorkerManager, enable jammer + weather cell + 17th node
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
};

let liveFrame!: TelemetryFrame;
try {
  const sim = new SimulationWorkerManager(109_001, '16_NODES');
  sim.terrainEngine.setTerrainMode('synthetic');
  sim.isPaused = true;

  const sciRes = sim.handleMessage({
    type: 'SET_SCIENTIFIC_PARAMS',
    jammerEnabled: true,
    jammerEirpDbm: 70.0,
    enableBiomeEmPhysics: true,
    weatherCells: [
      {
        id: 'storm-cell-alpha',
        centerX0M: -6000,
        centerY0M: 4500,
        velocityXMps: 5,
        velocityYMps: -2,
        radiusM: 7000,
        peakRainRateMmH: 28,
      },
    ],
  });
  assert.equal(sciRes.accepted, true, 'SET_SCIENTIFIC_PARAMS with jammer + weatherCells must succeed');

  const addRes = sim.handleMessage({
    type: 'NODE_ADD',
    role: 'soldier',
    x_m: 6500,
    y_m: -4200,
    agl_m: 3.0,
    callsign: 'S16-ALPHA',
  });
  assert.equal(addRes.accepted, true, 'NODE_ADD for 17th node must succeed');
  assert.ok((addRes.node_id ?? -1) >= 16, `17th node ID must be >= 16, got ${addRes.node_id}`);

  sim.tickSimulation(true);
  sim.tickSimulation(true);

  assert.ok(capturedFrames.length >= 1, 'Real worker must emit TELEMETRY_FRAME on tickSimulation(true)');
  liveFrame = capturedFrames[capturedFrames.length - 1].frame;
} finally {
  if (prevSelf === undefined) {
    delete (globalThis as { self?: unknown }).self;
  } else {
    (globalThis as { self?: unknown }).self = prevSelf;
  }
}

runTest('Live TelemetryFrame contains 17 nodes, jammer state, and live weather_cells summary', () => {
  assert.equal(liveFrame.nodes_telemetry.length, 17, 'Expected 17 active ground nodes');
  assert.equal(liveFrame.jammer_enabled, true);
  assert.ok(Array.isArray(liveFrame.jammer_pos_enu) && liveFrame.jammer_pos_enu.length === 3);
  assert.ok(Array.isArray(liveFrame.weather_cells) && liveFrame.weather_cells.length === 1);
  assert.equal(liveFrame.weather_cells![0].id, 'storm-cell-alpha');
  assert.ok(
    Math.hypot(liveFrame.acn_telemetry.pos_x, liveFrame.acn_telemetry.pos_y) > 1000,
    'Live ACN must be on non-origin elliptical orbit'
  );
});

runTest('ThreeVolumetricRfLayer anchors to live ACN, renders >16 nodes, and activates jammer + weather', () => {
  const layer = new ThreeVolumetricRfLayer({
    showFresnel: true,
    showSectorLobes: true,
    showThreatVolumes: true,
  });

  layer.update(liveFrame, { selectedNodeId: liveFrame.selected_node_id });
  const state = layer.getState();

  assert.equal(state.activeEllipsoidCount, 17, 'All 17 nodes must render Fresnel ellipsoids without 16-node cap');
  assert.equal(layer.fresnelGroup.children.length, 17, 'Ellipsoid pool must grow to 17');
  assert.equal(layer.fresnelGroup.children[16].visible, true, '17th ellipsoid mesh must be visible');
  assert.equal(state.activeLobeCount, 4);
  assert.equal(state.activeThreatVolumeCount, 2, 'Jammer dome + 1 weather cell must both be active');

  // Verify Fresnel ellipsoid[0] midpoint anchors to liveFrame.acn_telemetry.pos_x/y/z (NOT (0,0,5000))
  const n0 = liveFrame.nodes_telemetry[0];
  const acnThree = simToThreeCoords(
    liveFrame.acn_telemetry.pos_x,
    liveFrame.acn_telemetry.pos_y,
    liveFrame.acn_telemetry.pos_z
  );
  const n0Three = simToThreeCoords(n0.x_m, n0.y_m, n0.z_m);
  const expectedMidX = (acnThree.x + n0Three.x) * 0.5;
  const expectedMidY = (acnThree.y + n0Three.y) * 0.5;
  const expectedMidZ = (acnThree.z + n0Three.z) * 0.5;

  const actualPos = layer.fresnelGroup.children[0].position;
  assert.ok(Math.abs(actualPos.x - expectedMidX) < 1e-3, `Ellipsoid X anchored to live ACN (${actualPos.x} vs ${expectedMidX})`);
  assert.ok(Math.abs(actualPos.y - expectedMidY) < 1e-3, `Ellipsoid Y anchored to live ACN (${actualPos.y} vs ${expectedMidY})`);
  assert.ok(Math.abs(actualPos.z - expectedMidZ) < 1e-3, `Ellipsoid Z anchored to live ACN (${actualPos.z} vs ${expectedMidZ})`);

  const originMidThree = simToThreeCoords(0, 0, 5000);
  const fakeMidX = (originMidThree.x + n0Three.x) * 0.5;
  assert.ok(Math.abs(actualPos.x - fakeMidX) > 100, 'Ellipsoid must NOT be anchored at fallback (0,0,5000)');

  // Steady-state second update must not grow pool
  layer.update(liveFrame, { selectedNodeId: liveFrame.selected_node_id });
  assert.equal(layer.fresnelGroup.children.length, 17, 'Steady-state update must not allocate extra meshes');

  layer.dispose();
});

runTest('missionIoController AAR snapshot reads live Hi-Fi flags (false when disabled) & canonical 5QI 69/65/67/70', () => {
  const controller = initMissionIoController({
    getLatestTelemetry: () => liveFrame,
    getActiveBiomeId: () => 'alpine_mountain',
  });

  const aar = controller.buildCurrentAarSnapshot(liveFrame);
  assert.equal(aar.activeModels.airframeShadowing, false, 'Disabled airframeShadowing must report false');
  assert.equal(aar.activeModels.correlatedRician, false, 'Disabled correlatedRician must report false');
  assert.equal(aar.activeModels.macPhyFeedback, false, 'Disabled macPhyFeedback must report false');
  assert.equal(aar.activeModels.transportAbr, false, 'Disabled transportAbr must report false');
  assert.equal(aar.activeModels.dubinsKinematics, false, 'Disabled dubinsKinematics must report false');
  assert.equal(aar.activeModels.viewshedParity, false, 'Fast viewshed mode must report viewshedParity=false');
  assert.equal(aar.activeModels.mvdrNullSteering, false, 'Disabled MVDR must report false');
  assert.equal(aar.activeModels.manetRouting, false, 'Disabled MANET must report false');
  assert.equal(
    capturedFrames[capturedFrames.length - 1].biome_em_enabled,
    true,
    'TelemetryFrameMessage must report biome_em_enabled=true'
  );
  assert.equal(
    aar.activeModels.biomeEm,
    Boolean(liveFrame.biome_em_enabled),
    'AAR biomeEm must reflect liveFrame.biome_em_enabled without fabricating true'
  );

  const fiveQis = aar.qosSlaSummary.classes.map((c) => c.fiveQi);
  assert.deepEqual(fiveQis, [69, 65, 67, 70], 'AAR QoS classes must use canonical MCX 5QIs (69, 65, 67, 70)');
  for (const legacyQci of [1, 2, 4, 9]) {
    assert.equal(fiveQis.includes(legacyQci), false, `Civilian LTE 5QI ${legacyQci} must not leak`);
  }

  assert.notEqual(aar.kpis.staticDeliveredMb, 12.31, 'Hardcoded 12.31 must not leak');
  assert.notEqual(aar.kpis.tacDeliveredMb, 20.38, 'Hardcoded 20.38 must not leak');
  assert.notEqual(aar.kpis.throughputGainX, 1.65, 'Hardcoded 1.65 must not leak');
  assert.notEqual(aar.kpis.staticWastePct, 38.4, 'Hardcoded 38.4 must not leak');
  assert.notEqual(aar.kpis.tacWastePct, 11.2, 'Hardcoded 11.2 must not leak');

  // Verify null-frame handling emits 0 / N/A rather than fabricated numbers
  const emptyAar = controller.buildCurrentAarSnapshot(null);
  assert.equal(emptyAar.kpis.staticDeliveredMb, 0);
  assert.equal(emptyAar.kpis.tacDeliveredMb, 0);
  assert.equal(emptyAar.schedulerMode, 'N/A');
  assert.equal(emptyAar.activeModels.eccmMode, 'N/A');
  assert.deepEqual(emptyAar.qosSlaSummary.classes.map((c) => c.fiveQi), [69, 65, 67, 70]);
});

runTest('missionIoController buildTacticalSnapshot tags Node 15 as MCP and Node 1 as SOLDIER', () => {
  const controller = initMissionIoController({
    getLatestTelemetry: () => liveFrame,
  });
  const snap = controller.buildTacticalSnapshot(liveFrame);
  const node15 = snap.entities.find((e) => e.id === MCP_ID);
  const node1 = snap.entities.find((e) => e.id === 1);
  assert.ok(node15, 'Node 15 must exist in tactical snapshot');
  assert.ok(node1, 'Node 1 must exist in tactical snapshot');
  assert.equal(node15!.role, 'MCP', 'Node 15 must be tagged MCP');
  assert.notEqual(node1!.role, 'MCP', 'Node 1 must NOT be tagged MCP');
  assert.equal(node1!.role, 'SOLDIER', 'Node 1 must be tagged SOLDIER');
});

runTest('missionIoController Scenario JSON load dispatches real typed WorkerInboundCommands accepted by worker', () => {
  const dispatched: WorkerInboundCommand[] = [];
  const controller = initMissionIoController({
    getLatestTelemetry: () => liveFrame,
    postWorkerCommand: (cmd) => {
      dispatched.push(cmd);
    },
  });

  const scenario: MissionScenarioV3 = {
    schemaVersion: 'xband-dt-scenario-v3',
    title: 'Ladakh Waypoint & Barrier Test',
    timestamp: '2026-11-25T16:00:00.000Z',
    theater: {
      biomeId: 'arid_desert',
      centerLatDeg: 34.5,
      centerLonDeg: 76.5,
    },
    acn: {
      callsign: 'VIPER-01',
      cruiseAltMslM: 5400,
      cruiseAirspeedMs: 65,
      orbitPattern: 'waypoints',
      waypoints: [
        { xM: -12000, yM: -8000, altM: 5400 },
        { xM: 12000, yM: -8000, altM: 5400 },
        { xM: 0, yM: 14000, altM: 5400 },
      ],
    },
    nodes: [
      { id: 0, callsign: 'S0-UPDATED', xM: -15000, yM: -10000, aglM: 3, tacticalPriority: 2 },
      { id: 15, callsign: 'MCP', xM: 2000, yM: 2000, aglM: 5, tacticalPriority: 5 },
      { id: 99, callsign: 'S99-NEW', xM: 8000, yM: 9000, aglM: 4, tacticalPriority: 1 },
    ],
    obstacles: [
      {
        id: 'ridge-wall-1',
        name: 'Ridge Wall 1',
        type: 'ridge',
        points: [
          { x: 1000, y: 1000 },
          { x: 1400, y: 1500 },
        ],
        heightM: 180,
      },
    ],
    rfConfig: {
      carrier_freq_hz: 8.2e9,
      traffic_scale: 1.5,
    },
  };

  const jsonStr = serializeMissionScenarioJson(scenario);
  const applyRes = controller.applyScenarioJson(jsonStr);
  assert.equal(applyRes.ok, true, 'Scenario JSON apply must succeed');
  assert.ok(dispatched.length >= 6, `Expected >= 6 worker commands, got ${dispatched.length}`);

  const types = dispatched.map((c) => c.type);
  assert.ok(types.includes('SET_BIOME'), 'Must dispatch SET_BIOME');
  assert.ok(types.includes('CONFIG_UPDATE'), 'Must dispatch CONFIG_UPDATE');
  assert.ok(types.includes('SET_SCIENTIFIC_PARAMS'), 'Must dispatch SET_SCIENTIFIC_PARAMS');
  assert.ok(types.includes('OBSTACLES_REPLACE'), 'Must dispatch OBSTACLES_REPLACE');
  assert.ok(types.includes('NODE_DELETE'), 'Must dispatch NODE_DELETE for removed live nodes');
  assert.ok(types.includes('NODE_UPDATE'), 'Must dispatch NODE_UPDATE for existing scenario nodes');
  assert.ok(types.includes('NODE_ADD'), 'Must dispatch NODE_ADD for new scenario node 99');

  // Feed every dispatched command into a real SimulationWorkerManager with matching initial 17-node state
  const verifyWorker = new SimulationWorkerManager(109_002, '16_NODES');
  verifyWorker.terrainEngine.setTerrainMode('synthetic');
  const seedAdd = verifyWorker.handleMessage({
    type: 'NODE_ADD',
    role: 'soldier',
    x_m: 6500,
    y_m: -4200,
    agl_m: 3.0,
    callsign: 'S16-ALPHA',
  });
  assert.equal(seedAdd.accepted, true);
  for (const cmd of dispatched) {
    const res = verifyWorker.handleMessage(cmd);
    assert.equal(res.accepted, true, `Worker rejected dispatched command ${cmd.type}: ${res.reason}`);
  }
});

runTest('DiagnosticsTracker & mapRfOverlay match canonical NodeTerrainState values from live TelemetryFrame', () => {
  const tracker = new DiagnosticsTracker();
  const elements = new Map<string, { textContent: string }>([
    ['diag-cadence', { textContent: '' }],
    ['diag-jitter', { textContent: '' }],
    ['diag-pacing', { textContent: '' }],
    ['diag-lookahead', { textContent: '' }],
    ['diag-buffers', { textContent: '' }],
    ['diag-revision', { textContent: '' }],
    ['diag-json', { textContent: '' }],
  ]);

  const prevDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => elements.get(id) ?? null,
  };

  try {
    tracker.renderIntoDom(
      liveFrame,
      { spatialCount: 1, spatialCapacity: 3000, epochCount: 1, epochCapacity: 3000 },
      {
        cadenceId: 'diag-cadence',
        jitterId: 'diag-jitter',
        pacingId: 'diag-pacing',
        lookaheadSummaryId: 'diag-lookahead',
        buffersId: 'diag-buffers',
        revisionId: 'diag-revision',
        jsonId: 'diag-json',
      },
      { force: true, isPanelVisible: true, nowMs: 1000 }
    );
  } finally {
    if (prevDoc === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  }

  const summary = elements.get('diag-lookahead')!.textContent;
  const m = summary.match(/(\d+) Clear · (\d+) Pre-Occl · (\d+) Shadow · (\d+) Emerg/);
  assert.ok(m, `Unexpected lookahead summary format: "${summary}"`);
  const clear = Number(m![1]);
  const pre = Number(m![2]);
  const shadow = Number(m![3]);
  const emerg = Number(m![4]);
  assert.equal(
    clear + pre + shadow + emerg,
    liveFrame.nodes_telemetry.length,
    `State counts (${clear}+${pre}+${shadow}+${emerg}) must sum to ${liveFrame.nodes_telemetry.length}`
  );
  assert.ok(clear > 0, `Expected >0 Clear (NORMAL_LOS) nodes in live frame, got ${clear}`);

  // Verify renderRadarSignalQualityRings uses ochre for PRE_OCCLUSION_FLUSH & steel-blue for RE_EMERGENCE_BURST
  const strokes: string[] = [];
  const spyCtx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    arc: () => {},
    stroke: () => { strokes.push(String(spyCtx.strokeStyle)); },
    fillText: () => {},
    setLineDash: () => {},
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'top',
  } as unknown as CanvasRenderingContext2D;

  renderRadarSignalQualityRings(
    spyCtx,
    [
      {
        nodeId: 1,
        screenX: 100,
        screenY: 100,
        snrDb: 12,
        stateName: NodeTerrainState.PRE_OCCLUSION_FLUSH,
        isOutage: false,
        isBlocked: false,
        isSelected: false,
        alpha: 1,
      },
      {
        nodeId: 2,
        screenX: 200,
        screenY: 200,
        snrDb: 12,
        stateName: NodeTerrainState.RE_EMERGENCE_BURST,
        isOutage: false,
        isBlocked: false,
        isSelected: false,
        alpha: 1,
      },
    ],
    'monospace',
    false
  );
  // Pre-occlusion outer ring should be ochre (#e9c46a), recovering outer ring should be terrainStrokeLos (#7fa1b8)
  assert.ok(strokes.includes('#e9c46a'), `Expected PRE_OCCLUSION_FLUSH ochre ring, got ${JSON.stringify(strokes)}`);
  assert.ok(strokes.includes('#7fa1b8'), `Expected RE_EMERGENCE_BURST ring, got ${JSON.stringify(strokes)}`);
});

runTest('renderRfFieldProbeOverlay draws 360-deg horizon polygon from real SiteProbeViewshedResult.horizonMask', () => {
  const terrainEngine = new TerrainEngine({ theaterExtentM: THEATER_HALF_M, terrainMode: 'synthetic' });
  const ctxSim: ToolboxSimulationContext = {
    terrainEngine,
    rfConfig: new RFConfig(),
    envConfig: new EnvironmentConfig(),
    acnPositionMslM: [liveFrame.acn_telemetry.pos_x, liveFrame.acn_telemetry.pos_y, liveFrame.acn_telemetry.pos_z],
    trajectoryConfig: liveFrame.trajectory_config,
    groundNodes: [],
    spatialRevision: liveFrame.spatial_revision,
    isHistoricalInspecting: false,
    spatialLocked: false,
  };

  const vsResult = computeSiteProbeViewshed(ctxSim, {
    xM: 0,
    yM: 0,
    observerAglM: 10,
    radiusM: 15000,
    targetMode: 'ground_agl',
    targetAglM: 2,
    includeObstacles: false,
  });

  assert.ok(vsResult.horizonMask.length >= 12, 'Real SiteProbeViewshedResult must contain horizonMask bins');

  let polygonVertexMoves = 0;
  let polygonFills = 0;
  let fillStyleAtPolygon = '';
  const spyCanvasCtx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {
      if (spyCanvasCtx.fillStyle === 'rgba(168, 85, 247, 0.14)') {
        polygonVertexMoves++;
        fillStyleAtPolygon = spyCanvasCtx.fillStyle;
      }
    },
    arc: () => {},
    ellipse: () => {},
    fill: () => {
      if (spyCanvasCtx.fillStyle === 'rgba(168, 85, 247, 0.14)') {
        polygonFills++;
      }
    },
    stroke: () => {},
    roundRect: () => {},
    fillText: () => {},
    setLineDash: () => {},
    measureText: (t: string) => ({ width: String(t).length * 6 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'middle',
  } as unknown as CanvasRenderingContext2D;

  renderRfFieldProbeOverlay(
    spyCanvasCtx,
    800,
    600,
    {
      activeMode: 'probe',
      toolMode: 'probe',
      probeSite: { xM: 0, yM: 0 },
      viewshedResult: vsResult,
      acnPosWorld: { x: liveFrame.acn_telemetry.pos_x, y: liveFrame.acn_telemetry.pos_y },
    },
    { centerXM: 0, centerYM: 0, zoomScale: 1 } as never,
    (xM, yM) => ({ x: 400 + xM * 0.01, y: 300 - yM * 0.01 })
  );

  assert.equal(fillStyleAtPolygon, 'rgba(168, 85, 247, 0.14)', 'Horizon mask polygon style must be applied');
  assert.ok(
    polygonVertexMoves >= vsResult.horizonMask.length - 1,
    `Expected >= ${vsResult.horizonMask.length - 1} polygon vertices drawn, got ${polygonVertexMoves}`
  );
  assert.equal(polygonFills, 1, 'Horizon mask polygon must be filled once');

  // Verify DVB-S2X labels (no 16-QAM / 64-QAM)
  assert.equal(computeRfSinrMeterState(22, true).bandLabel, '64-APSK');
  assert.equal(computeRfSinrMeterState(14, true).bandLabel, '16-APSK');
  assert.equal(computeRfSinrMeterState(9, true).bandLabel, '8-PSK');
  assert.equal(computeRfSinrMeterState(5, true).bandLabel, 'QPSK');
  assert.equal(computeRfSinrMeterState(0, true).bandLabel, 'π/2-BPSK');
  const probeSample = sampleProbeSignalAtWorldPoint(vsResult, 1000, 1000);
  if (probeSample) {
    assert.ok(!probeSample.modcodTier.includes('QAM'), `Expected DVB-S2X label, got ${probeSample.modcodTier}`);
  }
});

runTest('LinkProfileViewport hover crosshair renders up to layout.width - layout.padR even on tall viewports', () => {
  const terrainEngine = new TerrainEngine({ theaterExtentM: THEATER_HALF_M, terrainMode: 'synthetic' });
  const profile = buildLinkProfile({
    selectedGroundNodeId: 0,
    nodeName: 'S0',
    frameIndex: 1,
    simulationTimeS: 0.02,
    groundNodePositionMslM: [0, 0, 3500],
    acnPositionMslM: [20000, 0, 5000],
    wavelengthM: 0.0375,
    effectiveEarthRadiusM: 8494666,
    fresnelFraction: 0.6,
    sampleCount: 16,
    obstruction: {
      minClearanceM: 500,
      fresnelRadiusM: 12,
      diffractionLossDb: 0,
      isLos: true,
      obstacleBlocked: false,
      obstacleIntersections: [],
    },
    getTerrainElevationMslM: (x, y) => terrainEngine.getElevation(x, y),
    computeEarthBulgeM: TerrainEngine.computeEarthBulge,
  });

  const vp = new LinkProfileViewportState();
  vp.syncProfile(profile);

  // Choose a wide/short layout where padL + plotH * 10 (50 + 30*10 = 350) < width - padR (1000 - 20 = 980)
  // so the old bug would fail to draw crosshair at hx = 900.
  const layout = { width: 1000, height: 90, padL: 50, padR: 20, padT: 30, padB: 30 };
  let crosshairHudDrawn = false;
  const spyTarget: Record<string, unknown> = {
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    rect: () => {},
    clip: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    setLineDash: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillText: (text: string) => {
      if (String(text).includes('Elev+Bulge:')) {
        crosshairHudDrawn = true;
      }
    },
    measureText: (t: string) => ({ width: String(t).length * 6 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
  const spyCtx = new Proxy(spyTarget, {
    get(obj, prop) {
      if (prop in obj) return obj[prop as string];
      return () => {};
    },
  }) as unknown as CanvasRenderingContext2D;

  renderLinkProfileViewport(spyCtx, layout, vp, profile, null, {
    hoverInfo: {
      canvasX: 900,
      distKm: 18,
      elevM: 3500,
      bulgeM: 2,
      losM: 4850,
      clearanceM: 1348,
      nu: -5,
    },
  });

  assert.equal(crosshairHudDrawn, true, 'Crosshair HUD must render at hx=900 within [padL, width - padR]');
});

console.log('\n================================================================================');
console.log(` \x1b[32m✔ ALL ${passed} / ${total} TESTS PASSED (REMED-01 Live Contracts)\x1b[0m`);
console.log('================================================================================\n');
