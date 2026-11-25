/**
 * src/tests/verifyRemed02MultiBiomeAnd3d.ts
 *
 * REMED-02 Integration Regression Verification Suite:
 * 1. Multi-biome terrain extent, North-up row ordering, geodesy & UI projections
 * 2. Lowland/maritime hillshade contrast & biome-aware TopView summits/legend
 * 3. 3D terrain perimeter skirts (fast128 edge alignment) & dynamic skirt base MSL
 * 4. 3D MCP identity (MCP_ID = 15), >16 dynamic nodes & single-fire raycast picking
 * 5. Dynamic-node ObstacleEditorState.reconcile() (17 & 15 nodes) & AGL eligibility (nodeId = 16)
 * 6. Lowland Edge-AI pathfinder (no < 500 m corruption), bandwidth scaling & soldier Dubins kinematics
 */

import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  TerrainEngine,
  BIOME_DEM_METADATA,
  REAL_LADAKH_DEM_METADATA,
  generateAridDesertElevationGrid,
} from '../core/terrain';
import { THEATER_BIOMES } from '../core/biomePhysics';
import { stitchHgtTiles, computeMetersPerDegLon, type DecodedTile } from '../core/hgtMosaic';
import {
  computeAiRecoveryAdvisory,
  evaluateAiBuddyRelayRescue,
  computeEwDefiladeShieldDb,
  computeAiSkyShepherdUavOffset,
  predictNodeBlackoutCountdown,
  getModcodFromSinr,
} from '../core/tacticalAiPathfinder';
import { RFConfig, EnvironmentConfig } from '../core/config';
import { MCP_ID } from '../shared/constants';
import { HillshadeGenerator } from '../worker/hillshadeGenerator';
import { SimulationWorkerManager } from '../worker/simWorker';
import { computeRadarCursorReadout } from '../ui/radarCursorReadout';
import { drawCartographicOverlays } from '../ui/cartographyRenderer';
import { exportRegionGeoJson } from '../ui/terrainToolboxAnalysis';
import { renderTerrainTopView, TopViewViewportState } from '../ui/pathProfileTopView';
import { buildLinkProfile } from '../core/linkProfile';
import {
  buildTerrainGeometrySet,
  computeDynamicSkirtBaseMslM,
  APPROVED_SKIRT_BASE_MSL_M,
} from '../ui/three/terrainBuilder';
import { TacticalEntityManager } from '../ui/three/tacticalEntityManager';
import { ThreeSceneController } from '../ui/three/threeSceneController';
import { ObstacleEditorState, type ObstructionSnapshot } from '../ui/obstacleEditorState';
import { checkAglEditEligibility } from '../ui/nodeAglController';

function setupMockThreeDom(): {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  cleanup: () => void;
} {
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const docListeners: Record<string, ((e: any) => void)[]> = {};

  const mockGl: any = new Proxy({
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
    getProgramParameter: (_p: any, param: number) => (param === 35718 || param === 35721 ? 0 : true),
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
  }, {
    get: (target, prop: string) => (prop in target ? target[prop] : () => ({})),
  });

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
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
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

function makeSyntheticDecodedTile(tileName: string, minLat: number, minLon: number, sampleCount = 61): DecodedTile {
  const elevations = new Float32Array(sampleCount * sampleCount).fill(150);
  return {
    tileName,
    minLatDeg: minLat,
    maxLatDeg: minLat + 1.0,
    minLonDeg: minLon,
    maxLonDeg: minLon + 1.0,
    sampleCount,
    elevations,
    minElevationM: 150,
    maxElevationM: 150,
    voidCount: 0,
  };
}

async function runTests(): Promise<void> {
  console.log('================================================================================');
  console.log('  REMED-02 INTEGRATION REGRESSION SUITE (MULTI-BIOME, 3D, DYNAMIC NODES & AI)');
  console.log('================================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. Multi-biome terrain extent, North-up ordering, geodesy & UI projections
  // ---------------------------------------------------------------------------
  console.log('[1/6] Verifying multi-biome terrain extent, North-up ordering & geodesy...');
  {
    const te = new TerrainEngine({ terrainMode: 'real' });

    // Thar Desert
    te.setBiome('arid_desert');
    const desertCenter = te.worldToLatLon(0, 0);
    assert.ok(
      Math.abs(desertCenter.latDeg - THEATER_BIOMES.arid_desert.centerLatDeg) < 0.05 &&
      Math.abs(desertCenter.lonDeg - THEATER_BIOMES.arid_desert.centerLonDeg) < 0.05,
      `arid_desert origin must match Thar (${THEATER_BIOMES.arid_desert.centerLatDeg}, ${THEATER_BIOMES.arid_desert.centerLonDeg}), got (${desertCenter.latDeg}, ${desertCenter.lonDeg})`
    );
    assert.ok(Math.abs(desertCenter.latDeg - 34.5) > 5.0, 'arid_desert must not emit Ladakh 34.5°N');

    const roundTrip = te.latLonToWorld(desertCenter.latDeg, desertCenter.lonDeg);
    assert.ok(Math.hypot(roundTrip.xM, roundTrip.yM) < 1e-3, 'latLonToWorld must invert worldToLatLon');

    // Verify North-up orientation & exact BIOME_DEM_METADATA bounds (zero 6x squash / N-S flip)
    const desertMeta = BIOME_DEM_METADATA.arid_desert;
    const directGrid = generateAridDesertElevationGrid(512);
    const northRowElev = directGrid[0 * 512 + 0]; // row 0, col 0 = (minX, maxY) North-West corner
    const southRowElev = directGrid[511 * 512 + 0]; // row 511, col 0 = (minX, minY) South-West corner
    const sampledNorth = te.getElevation(desertMeta.minX!, desertMeta.maxY!);
    const sampledSouth = te.getElevation(desertMeta.minX!, desertMeta.minY!);
    assert.ok(
      Math.abs(sampledNorth - northRowElev) < 1e-3,
      `North edge elevation (${sampledNorth}) must match row 0 (${northRowElev})`
    );
    assert.ok(
      Math.abs(sampledSouth - southRowElev) < 1e-3,
      `South edge elevation (${sampledSouth}) must match row 511 (${southRowElev})`
    );

    // Verify Arabian Sea Littoral
    te.setBiome('maritime_littoral');
    const seaCenter = te.worldToLatLon(0, 0);
    assert.ok(
      Math.abs(seaCenter.latDeg - THEATER_BIOMES.maritime_littoral.centerLatDeg) < 0.05 &&
      Math.abs(seaCenter.lonDeg - THEATER_BIOMES.maritime_littoral.centerLonDeg) < 0.05,
      `maritime_littoral origin must match Arabian Sea (${THEATER_BIOMES.maritime_littoral.centerLatDeg}, ${THEATER_BIOMES.maritime_littoral.centerLonDeg})`
    );
    assert.strictEqual(te.getElevation(-80000, 0), 0.0, 'Western maritime sea must be 0.0m MSL');
    assert.ok(te.getElevation(80000, 0) > 50.0, 'Eastern maritime coastline must rise above 50m MSL');

    // Verify hgtMosaic longitude scaling varies with tile latitude
    const ladakhMosaic = stitchHgtTiles([makeSyntheticDecodedTile('N34E076', 34, 76)]);
    const mumbaiMosaic = stitchHgtTiles([makeSyntheticDecodedTile('N18E072', 18, 72)]);
    const ladakhWidthM = ladakhMosaic.metadata.maxX! - ladakhMosaic.metadata.minX!;
    const mumbaiWidthM = mumbaiMosaic.metadata.maxX! - mumbaiMosaic.metadata.minX!;
    assert.ok(
      mumbaiWidthM > ladakhWidthM * 1.10,
      `18.5°N tile width (${mumbaiWidthM.toFixed(0)}m) must exceed 34.5°N tile width (${ladakhWidthM.toFixed(0)}m)`
    );
    assert.ok(
      Math.abs(computeMetersPerDegLon(18.5) / computeMetersPerDegLon(34.5) - Math.cos(18.5 * Math.PI / 180) / Math.cos(34.5 * Math.PI / 180)) < 1e-6,
      'computeMetersPerDegLon must scale exactly as cos(lat)'
    );

    // Verify UI readouts/exports emit non-Ladakh coordinates when biomeId is supplied
    const cursorDesert = computeRadarCursorReadout({
      xM: 0,
      yM: 0,
      isInsideRadar: true,
      biomeId: 'arid_desert',
      getElevation: () => 220,
    });
    assert.ok(Math.abs(cursorDesert.latDeg - 27.0) < 1e-4, 'RadarCursorReadout must report Thar latitude');
    assert.ok(Math.abs(cursorDesert.lonDeg - 71.5) < 1e-4, 'RadarCursorReadout must report Thar longitude');

    const drawnMgrs: string[] = [];
    const mockCtx: any = {
      save: () => {}, restore: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
      stroke: () => {}, fill: () => {}, arc: () => {}, closePath: () => {}, setLineDash: () => {},
      fillRect: () => {}, strokeRect: () => {},
      fillText: (txt: string) => { drawnMgrs.push(txt); },
    };
    drawCartographicOverlays(mockCtx, {
      width: 600,
      height: 600,
      metersPerPixel: 100,
      showMgrsGrid: true,
      biomeId: 'arid_desert',
      screenToWorld: (sx, sy) => ({ x: (sx - 300) * 100, y: (300 - sy) * 100 }),
      worldToScreen: (wx, wy) => ({ x: 300 + wx / 100, y: 300 - wy / 100 }),
    });
    assert.ok(
      drawnMgrs.some((t) => t.startsWith('42R')),
      `MGRS grid for Thar Desert must emit 42R grid labels (got ${drawnMgrs.slice(0, 4).join(', ')})`
    );
    assert.ok(!drawnMgrs.some((t) => t.startsWith('43S')), 'MGRS grid for Thar Desert must not emit Ladakh 43S');

    te.setBiome('arid_desert');
    const geoJson = JSON.parse(
      exportRegionGeoJson(
        { id: 1, color: '#fff', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }] },
        {
          regionId: 1, areaKm2: 0.5, totalInteriorSamples: 1, validDemSamples: 1,
          coverageCompletenessPct: 100, minElevationM: 200, meanElevationM: 210, maxElevationM: 220,
          stdElevationM: 5, meanSlopeDeg: 1, p95SlopeDeg: 2, losCoveragePct: 100,
          medianDiffractionLossDb: 0, enclosedNodeCount: 0, enclosedNodeIds: [], enclosedMeanSnrDb: null,
          bestRelayCoord: null,
        },
        te,
      )
    );
    const firstCoord = geoJson.features[0].geometry.coordinates[0][0];
    assert.ok(Math.abs(firstCoord[0] - 71.5) < 0.05 && Math.abs(firstCoord[1] - 27.0) < 0.05, 'GeoJSON export must use Thar coordinates');
    console.log('  -> PASS: Multi-biome extent, North-up row order, HGT cosine scale & UI geodesy verified.\n');
  }

  // ---------------------------------------------------------------------------
  // 2. Lowland hillshade contrast & biome-aware TopView summits/legend
  // ---------------------------------------------------------------------------
  console.log('[2/6] Verifying lowland hillshade contrast & biome-aware TopView...');
  {
    const te = new TerrainEngine({ terrainMode: 'real' });
    te.setBiome('arid_desert');
    const hg = new HillshadeGenerator();
    const res = hg.generate(te, 512);
    const distinctColors = new Set<number>();
    for (let r = 16; r < 496; r += 8) {
      for (let c = 16; c < 496; c += 8) {
        distinctColors.add(res.grid[r][c]);
      }
    }
    assert.ok(
      distinctColors.size >= 8,
      `Desert hillshade (180-310m) must show non-trivial hypsometric/slope contrast (got ${distinctColors.size} distinct colors)`
    );

    // TopView legend & summit gating for Thar Desert
    const topTexts: string[] = [];
    const topCtx: any = {
      save: () => {}, restore: () => {}, beginPath: () => {}, rect: () => {}, clip: () => {},
      moveTo: () => {}, lineTo: () => {}, closePath: () => {}, stroke: () => {}, fill: () => {},
      fillRect: () => {}, strokeRect: () => {}, arc: () => {}, roundRect: () => {}, setLineDash: () => {},
      drawImage: () => {}, measureText: (s: string) => ({ width: s.length * 6 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fillText: (s: string) => { topTexts.push(s); },
    };
    const desertProfile = buildLinkProfile({
      selectedGroundNodeId: 1,
      nodeName: 'S1',
      frameIndex: 1,
      simulationTimeS: 1,
      groundNodePositionMslM: [0, 0, 210],
      acnPositionMslM: [4000, 4000, 3200],
      wavelengthM: 0.0375,
      effectiveEarthRadiusM: 8494666,
      fresnelFraction: 0.6,
      sampleCount: 32,
      obstruction: {
        isLos: true,
        minClearanceM: 500,
        criticalFresnelRadiusM: 10,
        diffractionLossDb: 0,
        obstacleBlocked: false,
        obstacleIntervals: [],
      },
      getTerrainElevationMslM: (x, y) => te.getElevation(x, y),
      computeEarthBulgeM: TerrainEngine.computeEarthBulge,
    });
    const vp = new TopViewViewportState();
    vp.syncLink([0, 0, 210], [4000, 4000, 3200], { layout: { width: 640, height: 360, padL: 40, padR: 20, padT: 24, padB: 28 }, selectedNodeId: 1 });
    renderTerrainTopView(
      topCtx,
      { width: 640, height: 360, padL: 40, padR: 20, padT: 24, padB: 28 },
      vp,
      desertProfile,
      { biomeId: 'arid_desert', activeTerrainBounds: te.getTerrainBoundsTelemetry(), showElevationLegend: true }
    );
    assert.ok(!topTexts.some((t) => t.includes('KARGIL') || t.includes('ZANSKAR') || t.includes('NUN-KUN')), 'Ladakh summit pins must NOT render in Thar Desert');
    assert.ok(!topTexts.some((t) => t === '2.8k' || t === '5.8k m'), 'Elevation legend must reflect active biome range instead of hardcoded 2.8k - 5.8k m');
    console.log(`  -> PASS: Lowland hillshade (${distinctColors.size} colors) & biome-aware TopView verified.\n`);
  }

  // ---------------------------------------------------------------------------
  // 3. 3D terrain perimeter skirts & dynamic base elevation
  // ---------------------------------------------------------------------------
  console.log('[3/6] Verifying 3D fast128 perimeter skirts & dynamic base elevation...');
  {
    const te = new TerrainEngine({ terrainMode: 'real' });
    te.setBiome('alpine_mountain');
    // Construct deterministic Ladakh elevation grid (>2800m)
    const ladakhElev = new Float32Array(512 * 512);
    for (let i = 0; i < ladakhElev.length; i++) ladakhElev[i] = 2900 + (i % 512) * 2.5;
    const ladakhSet = buildTerrainGeometrySet({
      elevations: ladakhElev,
      gridSize: 512,
      bounds: REAL_LADAKH_DEM_METADATA as any,
      terrainMode: 'real',
      minElevationM: 2900,
      maxElevationM: 4180,
    }, 'fast128');
    assert.ok(ladakhSet.skirtGeometry !== null, 'Ladakh skirt must exist');
    assert.strictEqual(computeDynamicSkirtBaseMslM(2900), APPROVED_SKIRT_BASE_MSL_M, 'Ladakh skirt base must preserve 1700 m');

    te.setBiome('arid_desert');
    const desertBounds = te.getTerrainBoundsTelemetry();
    const desertStatsMin = te.demMetadata.minElevationM!;
    const desertSet = buildTerrainGeometrySet({
      elevations: te.realDemGrid!,
      gridSize: 512,
      bounds: desertBounds,
      terrainMode: 'real',
      minElevationM: desertStatsMin,
      maxElevationM: te.demMetadata.maxElevationM!,
    }, 'fast128');
    assert.ok(desertSet.skirtGeometry !== null, 'Desert skirt must exist');

    const meshPos = desertSet.meshGeometry.getAttribute('position');
    const skirtPos = desertSet.skirtGeometry!.getAttribute('position');
    const skirtNorm = desertSet.skirtGeometry!.getAttribute('normal');

    // Verify all skirt base vertices are strictly below desertStatsMin (never 1700m)
    let minSkirtBaseZ = Number.POSITIVE_INFINITY;
    for (let i = 0; i < skirtPos.count; i++) {
      const z = skirtPos.getZ(i);
      if (z < minSkirtBaseZ) minSkirtBaseZ = z;
    }
    assert.ok(minSkirtBaseZ < desertStatsMin, `Desert skirt base (${minSkirtBaseZ}m) must be strictly below minElevationM (${desertStatsMin}m)`);

    // Verify East wall (normal.x === 1) top vertices seal flush with mesh East edge (c = 127)
    for (let r = 0; r < 127; r++) {
      const meshZ = meshPos.getZ(r * 128 + 127);
      // Find matching East wall TL vertex in skirtPos
      const meshY = meshPos.getY(r * 128 + 127);
      let matched = false;
      for (let vi = 0; vi < skirtPos.count; vi++) {
        if (skirtNorm.getX(vi) === 1 && Math.abs(skirtPos.getY(vi) - meshY) < 1e-2 && Math.abs(skirtPos.getZ(vi) - meshZ) < 1e-3) {
          matched = true;
          break;
        }
      }
      assert.ok(matched, `fast128 East skirt vertex row ${r} must seal within < 1e-3 m of mesh edge`);
    }

    // Verify South wall (normal.y === -1) top vertices seal flush with mesh South edge (r = 127)
    for (let c = 0; c < 127; c++) {
      const meshX = meshPos.getX(127 * 128 + c);
      const meshZ = meshPos.getZ(127 * 128 + c);
      let matched = false;
      for (let vi = 0; vi < skirtPos.count; vi++) {
        if (skirtNorm.getY(vi) === -1 && Math.abs(skirtPos.getX(vi) - meshX) < 1e-2 && Math.abs(skirtPos.getZ(vi) - meshZ) < 1e-3) {
          matched = true;
          break;
        }
      }
      assert.ok(matched, `fast128 South skirt vertex col ${c} must seal within < 1e-3 m of mesh edge`);
    }
    console.log(`  -> PASS: fast128 perimeter skirts seal < 1e-3 m; Thar skirt base = ${minSkirtBaseZ}m.\n`);
  }

  // ---------------------------------------------------------------------------
  // 4. 3D MCP identity, dynamic >16 nodes & single picking
  // ---------------------------------------------------------------------------
  console.log('[4/6] Verifying 3D MCP_ID=15 identity, 18 dynamic nodes & single picking...');
  {
    const dom = setupMockThreeDom();
    const origSelf = (globalThis as any).self;
    let latestFrame: any = null;
    (globalThis as any).self = {
      postMessage: (msg: any) => {
        if (msg?.type === 'TELEMETRY_FRAME') latestFrame = msg.frame ?? msg;
      },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
    };

    try {
      const sim = new SimulationWorkerManager(202_001, '16_NODES');
      sim.terrainEngine.setTerrainMode('synthetic');
      sim.isPaused = true;

      // Add 2 dynamic nodes -> 18 total (including nodeId 16 and 17)
      const add16 = sim.handleMessage({ type: 'NODE_ADD', x_m: 1000, y_m: 1000, agl_m: 3, callsign: 'S16' });
      const add17 = sim.handleMessage({ type: 'NODE_ADD', x_m: 2000, y_m: 1500, agl_m: 3, callsign: 'S17' });
      assert.strictEqual(add16.accepted, true, 'NODE_ADD 16 must succeed');
      assert.strictEqual(add17.accepted, true, 'NODE_ADD 17 must succeed');

      sim.tickSimulation(true);
      assert.ok(latestFrame && latestFrame.nodes_telemetry.length === 18, 'Telemetry frame must contain 18 ground nodes');

      const em = new TacticalEntityManager();
      assert.strictEqual(em.getNodeItem(MCP_ID)?.isMcp, true, 'Node 15 (MCP_ID) must have MCP visuals');
      assert.strictEqual(em.getNodeItem(0)?.isMcp, false, 'Node 0 must have Soldier visuals');

      em.updateFromTelemetry(latestFrame);
      assert.ok(em.getNodeItem(16), 'TacticalEntityManager must create Node 16');
      assert.ok(em.getNodeItem(17), 'TacticalEntityManager must create Node 17');

      const controller = new ThreeSceneController({ container: dom.container, canvas: dom.canvas, maxPixelRatio: 1 });
      controller.setViewMode('3d');
      controller.updateTelemetry(latestFrame);
      assert.strictEqual(controller.tacticalEntityManager.getNodeItem(MCP_ID)?.isMcp, true);
      assert.strictEqual(controller.tacticalEntityManager.getNodeItem(0)?.isMcp, false);
      assert.ok(controller.tacticalEntityManager.getNodeItem(16), 'Controller must hold dynamic node 16');

      // Position camera looking straight at Node 16's markerSprite and click ONCE
      controller.camera.position.set(1000, 45000, 100000);
      controller.camera.lookAt(1000, 3000, -1000);
      controller.camera.updateMatrixWorld();
      controller.camera.updateProjectionMatrix();
      controller.tacticalEntityManager.updateLOD(controller.camera, 800, 600);

      const sprite16 = controller.tacticalEntityManager.getNodeItem(16)!.markerSprite;
      sprite16.updateWorldMatrix(true, false);
      const wp16 = new THREE.Vector3();
      sprite16.getWorldPosition(wp16);
      const ndc16 = wp16.clone().project(controller.camera);
      const clientX16 = (ndc16.x * 0.5 + 0.5) * 800;
      const clientY16 = (-ndc16.y * 0.5 + 0.5) * 600;

      const selectedEvents: number[] = [];
      controller.onNodeSelected((nid) => selectedEvents.push(nid));

      dom.canvas.dispatchEvent({ type: 'pointerdown', button: 0, clientX: clientX16, clientY: clientY16 });
      dom.canvas.dispatchEvent({ type: 'pointerup', button: 0, clientX: clientX16, clientY: clientY16 });
      dom.canvas.dispatchEvent({ type: 'click', button: 0, clientX: clientX16, clientY: clientY16 });

      assert.deepStrictEqual(selectedEvents, [16], `Single click on node 16 must fire callback exactly ONCE with [16], got [${selectedEvents.join(', ')}]`);

      controller.dispose();
      em.dispose();
    } finally {
      (globalThis as any).self = origSelf;
      dom.cleanup();
    }
    console.log('  -> PASS: MCP_ID=15 visuals, 18 dynamic nodes, single-fire picking & node 16 selection verified.\n');
  }

  // ---------------------------------------------------------------------------
  // 5. Dynamic-node Obstacle Editor & AGL Controller
  // ---------------------------------------------------------------------------
  console.log('[5/6] Verifying dynamic-node ObstacleEditorState & AGL Controller...');
  {
    const makeSnap = (count: number): ObstructionSnapshot[] =>
      Array.from({ length: count }, (_, node_id) => ({
        node_id,
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

    const ed17 = new ObstacleEditorState();
    ed17.beginApply('req-17');
    const ok17 = ed17.reconcile({
      type: 'COMMAND_RESULT',
      command_type: 'OBSTACLES_REPLACE',
      request_id: 'req-17',
      accepted: true,
      spatial_locked: false,
      obstacle_set: [],
      obstruction_state: makeSnap(17),
    });
    assert.strictEqual(ok17, true, 'ObstacleEditorState.reconcile must succeed with 17 nodes');

    const ed15 = new ObstacleEditorState();
    ed15.beginApply('req-15');
    const ok15 = ed15.reconcile({
      type: 'COMMAND_RESULT',
      command_type: 'OBSTACLES_REPLACE',
      request_id: 'req-15',
      accepted: true,
      spatial_locked: false,
      obstacle_set: [],
      obstruction_state: makeSnap(15),
    });
    assert.strictEqual(ok15, true, 'ObstacleEditorState.reconcile must succeed with 15 nodes');

    const agl16 = checkAglEditEligibility({ spatialLocked: false, isHistorical: false, nodeId: 16 });
    assert.strictEqual(agl16.canEdit, true, 'checkAglEditEligibility(16) must return eligible');
    console.log('  -> PASS: ObstacleEditorState (17 & 15 nodes) and AGL Controller (nodeId=16) verified.\n');
  }

  // ---------------------------------------------------------------------------
  // 6. Lowland Edge-AI & Soldier Dubins Kinematics
  // ---------------------------------------------------------------------------
  console.log('[6/6] Verifying lowland Edge-AI pathfinder, bandwidth scaling & soldier Dubins...');
  {
    const lowlandElev = (_x: number, _y: number) => 200.0;
    // Place soldier at 225 m MSL (25 m mast) — must NOT be overwritten to 202 m by <500 heuristic
    const defiladeClear = computeEwDefiladeShieldDb(
      [0, 0, 225.0],
      [1500, 0, 215.0],
      (x, _y) => (x > 600 && x < 900 ? 210.0 : 200.0) // 210m berm: blocks 202->215 ray (208.5m), clears 225->215 ray (220m)!
    );
    assert.strictEqual(defiladeClear.isShielded, false, 'Lowland 225m mast must clear 210m berm without <500 corruption to 202m');

    const buddy = evaluateAiBuddyRelayRescue(
      { nodeId: 1, position: [0, 0, 202], isOutage: true, directBitrateMbps: 0 },
      [{ nodeId: 2, position: [800, 0, 212], isOutage: false, directBitrateMbps: 10.0 }],
      lowlandElev
    );
    assert.strictEqual(buddy.isBuddyRescueActive, true, 'Buddy relay must activate cleanly at 200m MSL');

    const shepherd = computeAiSkyShepherdUavOffset([0, 0, 202], [1500, 1500, 1800], lowlandElev);
    assert.strictEqual(shepherd.isShepherdFeasible, true, 'Sky-Shepherd must operate cleanly on 200m MSL terrain');

    const blackout = predictNodeBlackoutCountdown(
      [0, 0, 202],
      18.0,
      false,
      () => [1000, 1000, 2500],
      lowlandElev,
      0
    );
    assert.strictEqual(blackout.blackoutImminent, false, 'Blackout forecaster must operate cleanly on 200m MSL terrain');

    // Bandwidth scaling: 5 MHz vs 1 MHz
    const mc5 = getModcodFromSinr(20.0, 5.0e6);
    const mc1 = getModcodFromSinr(20.0, 1.0e6);
    const mcDefault = getModcodFromSinr(20.0);
    assert.strictEqual(mcDefault.bitrateMbps, mc5.bitrateMbps, 'Default getModcodFromSinr bandwidth must be 5.0 MHz');
    assert.ok(Math.abs(mc5.bitrateMbps - mc1.bitrateMbps * 5.0) < 1e-6, 'Throughput must scale linearly with channelBandwidthHz');

    // Soldier Dubins smoothing with explicit maxClimbRateMs < speedMs
    const rf5 = new RFConfig({ channelBandwidthHz: 5.0e6 });
    const env = new EnvironmentConfig();
    const rec = computeAiRecoveryAdvisory({
      nodeId: 4,
      nodePos: [0, 0, 202],
      nodeType: 'SOLDIER',
      acnPos: [0, 12000, 2800],
      currentSinrDb: -10,
      currentIsOutage: true,
      getElevationAt: (x, y) => 200 + 8 * Math.sin(x / 300) + 6 * Math.cos(y / 300),
      rfConfig: rf5,
      envConfig: env,
      kinematicConstraints: {
        speedMs: 1.4,
        maxBankDeg: 0.0,
        minTurnRadiusOverrideM: 3.0,
        maxClimbRateMs: Math.min(0.6, 1.4 * 0.45),
        maxDescentRateMs: Math.min(0.6, 1.4 * 0.45),
      },
    });
    assert.strictEqual(rec.status, 'RECOVERY_DIRECTIVE_FOUND', 'Soldier recovery directive must succeed on lowland terrain');
    assert.ok(rec.kinematicAudit !== undefined, 'Kinematic audit must be produced');
    assert.ok(rec.kinematicAudit!.maxClimbRateMs <= 0.75, `Soldier Dubins maxClimbRateMs (${rec.kinematicAudit!.maxClimbRateMs}) must not clamp to 89.9 deg vertical climb`);

    // Worker-level soldier Dubins verification
    const origSelf = (globalThis as any).self;
    (globalThis as any).self = { postMessage: () => {} };
    try {
      const sim = new SimulationWorkerManager(303_001, '16_NODES');
      sim.handleMessage({ type: 'SET_BIOME', biomeId: 'arid_desert' });
      sim.enableDubinsKinematics = true;
      sim.isPaused = false;
      for (let t = 0; t < 55; t++) sim.tickSimulation(false);
      for (const n of sim.nodesStatic) {
        assert.ok(Number.isFinite(n.position[2]), `Node ${n.nodeId} altitude must remain finite during Dubins ticks`);
      }
    } finally {
      (globalThis as any).self = origSelf;
    }

    console.log('  -> PASS: Lowland Edge-AI, 5 MHz vs 1 MHz scaling & soldier Dubins kinematics verified.\n');
  }

  console.log('================================================================================');
  console.log('  ALL REMED-02 INTEGRATION REGRESSION CHECKS PASSED CLEANLY!');
  console.log('================================================================================');
}

runTests().catch((err) => {
  console.error('\nREMED-02 verification failed:', err);
  process.exit(1);
});
