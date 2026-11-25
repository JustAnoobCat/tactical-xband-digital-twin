import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateUuidV4 } from '../core/nodeRegistry';
import { parseMissionScenarioJson } from '../core/militaryGisEngine';
import {
  parseByteRangeHeader,
  MAX_OFFLINE_TILE_CHUNK_BYTES,
} from '../core/offlineTileProtocol';
import {
  computeParametricSensitivityCurve,
  evaluateParametricSensitivity,
} from '../core/parametricSensitivity';
import { FQCoDelQueue, GroundNodeTrafficSubsystem, Packet } from '../core/queues';
import { TerrainAwareDynamicScheduler, ReactiveMlwdfScheduler } from '../core/scheduler';
import { TerrainEngine } from '../core/terrain';
import { ACNTrajectoryEngine, type PredictiveState } from '../core/trajectory';
import { PolarViewshedEngine } from '../core/viewshedEngine';
import { RFConfig, EnvironmentConfig, ACNFlightConfig } from '../core/config';
import type { LinkStatus } from '../core/linkBudget';
import { evaluateAdversaryEsmLpi } from '../core/ewEccmEngine';
import { drawCartographicOverlays } from '../ui/cartographyRenderer';
import { getLatticeCanvasPalette } from '../ui/canvasTheme';
import { createTelemetryDomUpdaters } from '../ui/controllers/telemetryDomUpdaters';
import { createRadar2dRenderer } from '../ui/controllers/radar2dRenderer';
import { createTerrainToolboxController } from '../ui/controllers/terrainToolboxController';
import { createRadarNodeMarkerLayer } from '../ui/radarNodeMarkerLayer';
import { WorldTileLayer, computeVisibleWorldTiles } from '../ui/worldTileLayer';
import { createWorkspaceTilesManager } from '../ui/workspaceTilesManager';

let suitePassed = 0;
let suiteFailed = 0;

function describe(name: string, fn: () => void): void {
  console.log(`\n▶ ${name}`);
  fn();
}

function it(name: string, fn: () => void): void {
  try {
    fn();
    suitePassed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    suiteFailed++;
    console.error(`  ✖ ${name}`);
    console.error(err);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

describe('Audit remediation unit tests', () => {
  it('generateUuidV4 uses deterministic non-Math.random fallback without Math.random calls in nodeRegistry', () => {
    const src = fs.readFileSync(path.join(ROOT_DIR, 'src', 'core', 'nodeRegistry.ts'), 'utf8');
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(codeOnly.includes('Math.random'), false, 'nodeRegistry.ts code must not call Math.random()');
    const id1 = generateUuidV4();
    const id2 = generateUuidV4();
    assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(id1, id2);
  });

  it('parseMissionScenarioJson blocks unicode-escaped prototype pollution keys while allowing benign strings and enforcing array caps', () => {
    const protoAttempt = parseMissionScenarioJson(
      '{"schemaVersion":"xband-dt-scenario-v3","\\u005f\\u005fproto\\u005f\\u005f":{"polluted":true}}',
    );
    assert.equal(protoAttempt.ok, false);
    assert.match(protoAttempt.error || '', /forbidden key/i);

    const valid = parseMissionScenarioJson(
      JSON.stringify({
        schemaVersion: 'xband-dt-scenario-v3',
        title: 'Mountain road constructor convoy',
        nodes: [{ nodeId: 1, name: 'S1', xM: 0, yM: 0, aglM: 2, role: 'soldier' }],
      }),
    );
    assert.equal(valid.ok, true, valid.error);
    assert.equal(valid.scenario?.title, 'Mountain road constructor convoy');
    assert.equal(valid.scenario?.nodes.length, 1);

    const hugeNodes = Array.from({ length: 300 }, (_, i) => ({
      nodeId: i + 1,
      name: `S${i + 1}`,
      xM: i * 10,
      yM: 0,
      aglM: 2,
      role: 'soldier',
    }));
    const capped = parseMissionScenarioJson(
      JSON.stringify({ schemaVersion: 'xband-dt-scenario-v3', nodes: hugeNodes }),
    );
    assert.equal(capped.ok, true);
    assert.ok((capped.scenario?.nodes.length ?? 0) <= 256, 'Node list must be capped at 256');
    assert.ok(capped.warnings.some((w) => /truncat|cap|256/i.test(w)));
  });

  it('parseByteRangeHeader rejects oversized range requests with 413 before allocation', () => {
    const oversized = parseByteRangeHeader('bytes=0-99999999', 100 * 1024 * 1024);
    assert.equal(oversized.ok, false);
    if (!oversized.ok) {
      assert.equal(oversized.status, 413);
    }

    const valid = parseByteRangeHeader('bytes=0-4095', 100 * 1024 * 1024);
    assert.equal(valid.ok, true);
    if (valid.ok) {
      assert.equal(valid.start, 0);
      assert.equal(valid.end, 4095);
      assert.equal(valid.chunkLength, 4096);
      assert.ok(valid.chunkLength <= MAX_OFFLINE_TILE_CHUNK_BYTES);
    }
  });

  it('computeParametricSensitivityCurve is physics-backed and responds to live RF bandwidth and rain rate', () => {
    const clearCurve = computeParametricSensitivityCurve('traffic_load', {
      rfConfig: new RFConfig({ channelBandwidthHz: 10e6 }),
      envConfig: new EnvironmentConfig({ rainRateMmH: 0 }),
    });
    const heavyRainNarrowCurve = computeParametricSensitivityCurve('traffic_load', {
      rfConfig: new RFConfig({ channelBandwidthHz: 2e6 }),
      envConfig: new EnvironmentConfig({ rainRateMmH: 45 }),
    });
    assert.ok(clearCurve.points.length >= 5);
    assert.ok(
      clearCurve.points[clearCurve.points.length - 1].tacGoodputMbps >
        heavyRainNarrowCurve.points[heavyRainNarrowCurve.points.length - 1].tacGoodputMbps,
      'Higher bandwidth and clear weather should yield strictly higher peak goodput',
    );

    const pt = evaluateParametricSensitivity('traffic_load', 3.5);
    assert.ok(pt.tacGoodputMbps >= pt.reactiveGoodputMbps);
    assert.ok(pt.reactiveGoodputMbps >= pt.staticGoodputMbps);
  });

  it('FQCoDelQueue.requeueForHarq retains undecoded packets without inflating totalEnqueued', () => {
    const q = new FQCoDelQueue(400, 120);
    const pkt = new Packet(101, 1, 69, 1200, 0.0, 60.0);
    const [accepted] = q.enqueue(pkt);
    assert.equal(accepted, true);
    assert.equal(q.totalEnqueued, 1);

    const served = q.dequeue(1200, 0.02);
    assert.equal(served.length, 1);
    assert.equal(q.getTotalBacklogBytes(), 0);

    q.requeueForHarq(served);
    assert.equal(q.totalEnqueued, 1, 'totalEnqueued must not double-count HARQ retries');
    assert.equal(q.getTotalBacklogBytes(), 1200, 'Undecoded packet must remain in queue');
  });

  it('TerrainAwareDynamicScheduler applies guardScale and retains packets on CQI decode failure', () => {
    const sched = new TerrainAwareDynamicScheduler();
    const node = new GroundNodeTrafficSubsystem(1, 'soldier', [1000, 1000, 3500], 42);
    node.queue.enqueue(new Packet(1, 1, 65, 160, 0.0, 0.5));

    const link: LinkStatus = {
      nodeId: 1,
      slantRangeM: 12000,
      fsplDb: 132,
      diffractionLossDb: 0,
      gaseousLossDb: 0.2,
      rainLossDb: 0,
      rxPowerDbm: -80,
      noiseFloorDbm: -102,
      snrDb: 12.0,
      modcodName: '16APSK-2/3',
      spectralEfficiencyBpsHz: 2.6,
      dataRateBps: 2.6e6,
      isLos: true,
      isOutage: false,
      terrainBulgeM: 2.0,
      maxFresnelIntrusion: 0,
      inCoverage: true,
    };
    const pred: PredictiveState = {
      nodeId: 1,
      timeToOcclusionS: 10.0,
      occlusionImminent: false,
      horizonClear: true,
    };

    const res = sched.scheduleFrame(
      1,
      0.02,
      [node],
      new Map([[1, link]]),
      new Map([[1, pred]]),
      0,
      {
        nodeGuardScale: new Map([[1, 0.9]]),
        nodeDelayedCqiSnrDb: new Map([[1, 18.0]]),
      },
    );

    assert.equal(res.totalPayloadBitsDequeued, 0, 'CQI decode failure must not count as delivered payload');
    assert.equal(node.queue.getTotalBacklogBytes(), 160, 'Undecoded packet must be retained in queue for HARQ');

    // Verify ReactiveMlwdfScheduler also delivers cleanly in Pass-2 without artificial 4ms cap
    const reactive = new ReactiveMlwdfScheduler();
    const node2 = new GroundNodeTrafficSubsystem(2, 'soldier', [1000, 1000, 3500], 42);
    for (let i = 0; i < 6; i++) {
      node2.queue.enqueue(new Packet(10 + i, 2, 67, 1200, 0.0, 0.5));
    }
    const reactiveRes = reactive.scheduleFrame(
      1,
      0.02,
      [node2],
      new Map([[2, { ...link, nodeId: 2, dataRateBps: 4e6 }]]),
      new Map([[2, { ...pred, nodeId: 2 }]]),
      0,
    );
    assert.ok(reactiveRes.totalUlScheduledS > 0.005, 'Reactive Pass-2 must allow work-conserving airtime beyond 4ms');
  });

  it('PolarViewshedEngine.computeOptimalRelayPlacement uses real thermal noise and reacts to EW jammer', () => {
    const terrain = new TerrainEngine({ terrainMode: 'synthetic' });
    const traj = new ACNTrajectoryEngine(new ACNFlightConfig());
    const viewshed = new PolarViewshedEngine();
    const rf = new RFConfig({ channelBandwidthHz: 5e6 });
    const envClear = new EnvironmentConfig({ jammerEnabled: false });
    const envJammed = new EnvironmentConfig({ jammerEnabled: true, jammerEirpDbm: 78.0 });

    const groundNodes = [
      { nodeId: 1, position: [2000, 1500, terrain.getElevation(2000, 1500) + 2] as [number, number, number] },
      { nodeId: 2, position: [-2500, 1000, terrain.getElevation(-2500, 1000) + 2] as [number, number, number] },
    ];

    const clearRec = viewshed.computeOptimalRelayPlacement(traj, terrain, groundNodes, rf, envClear, 6);
    const jammedRec = viewshed.computeOptimalRelayPlacement(traj, terrain, groundNodes, rf, envJammed, 6);

    assert.equal(Number.isFinite(clearRec.meanSinrToAcnDb), true);
    assert.equal(Number.isFinite(jammedRec.meanSinrToAcnDb), true);
    assert.ok(
      clearRec.meanSinrToAcnDb > jammedRec.meanSinrToAcnDb,
      `Active jammer should degrade relay orbit SINR (clear=${clearRec.meanSinrToAcnDb.toFixed(2)}, jammed=${jammedRec.meanSinrToAcnDb.toFixed(2)})`,
    );
  });

  it('RESCUE-2 Fix 1 & 8: parametricSensitivity removes +0.5 clamps & ewEccmEngine terrain-shields detectionRadiusM', () => {
    const sensSrc = fs.readFileSync(path.join(ROOT_DIR, 'src', 'core', 'parametricSensitivity.ts'), 'utf8');
    assert.equal(sensSrc.includes('reactRes.goodputMbps + 0.5'), false);
    assert.equal(sensSrc.includes('statRes.goodputMbps + 0.5'), false);

    const pt = evaluateParametricSensitivity('traffic_load', 5.0);
    assert.ok(pt.tacDropRatePct >= 0 && pt.tacDropRatePct <= 100);
    assert.ok(pt.reactiveDropRatePct >= 0 && pt.reactiveDropRatePct <= 100);
    assert.ok(pt.staticDropRatePct >= 0 && pt.staticDropRatePct <= 100);

    const unshielded = evaluateAdversaryEsmLpi({ txPowerDbm: 30, esmTerrainShieldDb: 0 });
    const shielded20 = evaluateAdversaryEsmLpi({ txPowerDbm: 30, esmTerrainShieldDb: 20 });
    assert.equal(unshielded.detectionRadiusM, unshielded.freeSpaceDetectionRadiusM);
    assert.equal(shielded20.freeSpaceDetectionRadiusM, unshielded.freeSpaceDetectionRadiusM);
    assert.ok(Math.abs(shielded20.detectionRadiusM / unshielded.detectionRadiusM - 0.1) < 1e-6);
    assert.ok(shielded20.lpiSafetyRatio > unshielded.lpiSafetyRatio * 9.9);
  });

  it('RESCUE-2 Fix 2: OPS Fleet Registry row click triggers selection exactly once', () => {
    const clickListeners: Array<() => void> = [];
    const mockRow: any = {
      style: {},
      classList: { add: () => {} },
      dataset: {},
      innerHTML: '',
      onclick: null,
      addEventListener: (ev: string, fn: () => void) => {
        if (ev === 'click') clickListeners.push(fn);
      },
    };
    const tbody: any = { replaceChildren: () => {} };
    const mockDoc: any = {
      getElementById: (id: string) => (id === 'ops-fleet-tbody' ? tbody : null),
      createElement: () => mockRow,
    };
    let selectCalls = 0;
    const updaters = createTelemetryDomUpdaters({
      documentRef: mockDoc,
      onSelectNode: () => {
        selectCalls++;
      },
    });
    updaters.renderOpsFleetRegistry([{ node_id: 1, name: 'S1', snr_db: 18, link_outage: false }], null);
    assert.equal(mockRow.onclick, null, 'Duplicate tr.onclick handler must not be assigned');
    assert.equal(clickListeners.length, 1);
    clickListeners[0]();
    assert.equal(selectCalls, 1);
  });

  it('RESCUE-2 Fix 3 & 4: cartography scale bar avoids unit collision & radar2dRenderer wires labelPlacer, secondary_acns & CVD palette', () => {
    const drawnTexts: Array<{ text: string; x: number }> = [];
    const fillRects: Array<{ w: number; h: number }> = [];
    const lineDashes: number[][] = [];
    const fontsUsed: string[] = [];
    const mockCtx: any = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      imageSmoothingEnabled: true,
      set font(v: string) {
        fontsUsed.push(v);
      },
      clearRect: () => {},
      fillRect: (_x: number, _y: number, w: number, h: number) => fillRects.push({ w, h }),
      strokeRect: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      closePath: () => {},
      setLineDash: (d: number[]) => lineDashes.push([...d]),
      measureText: (t: string) => ({ width: t.length * 6 }),
      fillText: (text: string, x: number) => drawnTexts.push({ text, x }),
      drawImage: () => {},
      save: () => {},
      restore: () => {},
    };

    drawCartographicOverlays(mockCtx, { width: 800, height: 600, metersPerPixel: 180 });
    assert.ok(drawnTexts.some((d) => d.text === '10'), 'Scale bar half label should omit repeated km suffix');
    assert.ok(drawnTexts.some((d) => d.text === '20 km'));
    assert.ok(fillRects.some((r) => r.h === 5 && r.w >= 55), 'Scale bar segments must reflect >= 110px bar width');

    drawnTexts.length = 0;
    fontsUsed.length = 0;
    const renderer = createRadar2dRenderer({
      canvas: { width: 800, height: 600, parentElement: { clientWidth: 800, clientHeight: 600 } } as any,
      ctx: mockCtx,
      getRangeM: () => 200000,
      getPanOffset: () => ({ xM: 0, yM: 0 }),
      getStageViewMode: () => '2d',
      getTerrainMapMode: () => 'radar',
      getLatestTelemetry: () => ({
        biome_id: 'arid_desert',
        acn_telemetry: { pos_x: 0, pos_y: 0 },
        nodes_telemetry: [{ node_id: 1, x_m: 1000, y_m: 1000, terrain_is_los: true, snr_db: 15 }],
        constellation_mobility_telemetry: {
          secondary_acns: [{ id: 'ACN-2', name: 'ACN-2', pos_x: 15000, pos_y: 12000 }],
        },
      }),
      getHistoricalSnapshot: () => null,
      getActiveTerrainBounds: () => ({ minX: -500, maxX: 500, minY: -500, maxY: 500, terrainMode: 'real', isValidCoverage: true }),
      getHillshadeCanvas: () => ({ width: 512, height: 512 } as any),
      getBackdropCanvas: () => null,
      getBackdropMode: () => 'relief',
      getMapLayerRegistry: () => ({ getEffectiveVisibility: () => true, getLayerOpacity: () => 0.9 }),
      getContextualMapContext: () => ({}),
      getSelectedNodeId: () => null,
      getToolboxState: () => ({}),
      getObstacleEditor: () => ({ draft: [], selectedId: null }),
      isMgrsGridActive: () => false,
    });
    renderer.renderRadar();

    assert.ok((renderer.getActiveLabelPlacer()?.getPlacedCount() ?? 0) >= 3, 'activeLabelPlacer must place ACN-1, ACN-2, and fallback nodes');
    assert.ok(drawnTexts.some((d) => d.text === 'ACN-1'));
    assert.ok(drawnTexts.some((d) => d.text === 'ACN-2'));
    assert.ok(drawnTexts.some((d) => d.text === 'THAR DESERT AO'), 'AO zoom-out label must follow active biome');
    assert.ok(lineDashes.some((d) => d.length === 2 && d[0] === 5 && d[1] === 4), 'Secondary ACN must draw dashed A2A cross-link');
    assert.equal(fontsUsed.some((f) => /\b9px\b/.test(f)), false, 'radar2dRenderer must not use < 10px fonts');
    assert.equal(getLatticeCanvasPalette().accent, '#38bdf8');
  });

  it('RESCUE-2 Fix 5: terrainToolboxController reads mast inputs & checks real DOM 3D attribute', () => {
    let viewRenderer = '3d';
    const els: Record<string, any> = {
      'tb-transect-tx-mast': { value: '45' },
      'tb-transect-rx-mast': { value: '12' },
      'radar-stage': { getAttribute: (name: string) => (name === 'data-map-renderer' ? viewRenderer : null) },
      'terrain-toolbox-status': { textContent: '' },
    };
    const mockDoc: any = {
      getElementById: (id: string) => els[id] ?? null,
      querySelectorAll: () => [],
    };
    const flatTerrain = new TerrainEngine({ terrainMode: 'synthetic', customElevationFn: () => 3500 });
    const ctrl = createTerrainToolboxController({
      documentRef: mockDoc,
      getTelemetry: () => ({ acn_telemetry: { pos_x: 0, pos_y: 0, pos_z: 5000 }, nodes_telemetry: [] }),
      getHistoricalSnapshot: () => null,
      getTerrainEngine: () => flatTerrain,
      getObstacleEditor: () => null,
      sendCommand: () => {},
      markRadarDirty: () => {},
      drawRadar: () => {},
    });

    // Hotkey must bail when #radar-stage data-map-renderer="3d"
    const blocked = ctrl.handleKeydown({ key: 'r', preventDefault: () => {} } as any);
    assert.equal(blocked, false);

    // Switch to 2D radar -> hotkey activates transect
    viewRenderer = 'radar';
    const allowed = ctrl.handleKeydown({ key: 'r', preventDefault: () => {} } as any);
    assert.equal(allowed, true);

    ctrl.handleMapClick({ x: 0, y: 0 });
    ctrl.handleMapClick({ x: 5000, y: 0 });
    const st = ctrl.getState();
    assert.ok(st.rulerMetrics, 'rulerMetrics must be computed');
    // Vertical antenna delta should reflect (12 - 45) = -33 m difference between RX and TX mast on flat terrain
    assert.ok(Math.abs(st.rulerMetrics.antennaElevationDeltaM - (-33)) < 1e-6);
  });

  it('RESCUE-2 Fix 6 & 7: workspaceTilesManager cleans resize listener, worldTileLayer enforces air-gap, radarNodeMarkerLayer.clear cancels WAAPI', () => {
    const cancelled: string[] = [];
    const mkAnim = (tag: string) => ({ cancel: () => cancelled.push(tag) });
    const mkEl = (tag: string): any => {
      const el: any = {
        tagName: tag,
        className: '',
        hidden: false,
        textContent: '',
        style: {},
        attrs: new Map<string, string>(),
        children: [] as any[],
        parent: null as any,
        setAttribute: (k: string, v: string) => el.attrs.set(k, v),
        appendChild: (c: any) => { c.parent = el; el.children.push(c); return c; },
        remove: () => {
          if (el.parent) {
            el.parent.children = el.parent.children.filter((x: any) => x !== el);
            el.parent = null;
          }
        },
        animate: () => mkAnim(el.className),
      };
      return el;
    };
    const container = mkEl('div');
    const markerLayer = createRadarNodeMarkerLayer({
      container,
      documentRef: { createElement: (t: string) => mkEl(t) } as any,
      prefersReducedMotion: () => false,
    });
    markerLayer.sync(
      [{ nodeId: 1, x: 100, y: 100, status: 'connected', selected: true, label: 'S1' }],
      { width: 800, height: 600, rangeM: 60000, panX: 0, panY: 0 },
      true,
    );
    markerLayer.clear();
    assert.ok(cancelled.includes('radar-node-pulse') && cancelled.includes('radar-node-dot') && cancelled.includes('radar-node-reticle'));

    const layer = new WorldTileLayer({ allowExternalTiles: false });
    layer.setOrigin(27.0, 71.5);
    assert.deepEqual(layer.getOrigin(), { latDeg: 27.0, lonDeg: 71.5 });
    const tiles = computeVisibleWorldTiles({ width: 800, height: 600, rangeM: 60000 }, layer.getOrigin());
    assert.ok(tiles.length > 0);
    // Air-gapped WorldTileLayer must not issue Image fetches
    const origImage = (globalThis as any).Image;
    let imageConstructed = 0;
    (globalThis as any).Image = class { constructor() { imageConstructed++; } };
    try {
      layer.draw({ save() {}, restore() {} } as any, { width: 800, height: 600, rangeM: 60000 });
      assert.equal(imageConstructed, 0);
    } finally {
      (globalThis as any).Image = origImage;
    }

    // Verify workspaceTilesManager stores & removes resize listener on destroy() and imports escapeHtml
    const mgrSrc = fs.readFileSync(path.join(ROOT_DIR, 'src', 'ui', 'workspaceTilesManager.ts'), 'utf8');
    assert.ok(mgrSrc.includes("import { escapeHtml } from './domSafety'"));
    assert.ok(mgrSrc.includes("window.removeEventListener('resize', boundOnResize)"));
    assert.ok(createWorkspaceTilesManager);
  });

  it('RESCUE-2 Fix 9: threeSceneController attaches and disposes webglcontextlost/restored handlers', () => {
    const ctrlSrc = fs.readFileSync(path.join(ROOT_DIR, 'src', 'ui', 'three', 'threeSceneController.ts'), 'utf8');
    assert.ok(ctrlSrc.includes("'webglcontextlost'"));
    assert.ok(ctrlSrc.includes("'webglcontextrestored'"));
    assert.ok(ctrlSrc.includes("removeEventListener('webglcontextlost'"));
    assert.ok(ctrlSrc.includes("removeEventListener('webglcontextrestored'"));
  });
});

console.log(`\nℹ tests ${suitePassed + suiteFailed} | pass ${suitePassed} | fail ${suiteFailed}`);
if (suiteFailed > 0) {
  throw new Error(`${suiteFailed} test(s) failed`);
}
