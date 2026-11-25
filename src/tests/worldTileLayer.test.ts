import assert from 'node:assert/strict';

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
import {
  DEFAULT_WORLD_RADAR_DEM_TILE_URL,
  DEFAULT_WORLD_SATELLITE_TILE_URL,
  computeVisibleWorldTiles,
  decodeTerrariumElevationM,
  formatSlippyTileUrl,
  geodeticToUnwrappedEnu,
  latDegToTileY,
  lonDegToTileX,
  shadeRadarElevationRgb,
  shadeTerrariumTileRgba,
  tileXToLonDeg,
  tileYToLatDeg,
} from '../ui/worldTileLayer';
import { createRadar2dRenderer } from '../ui/controllers/radar2dRenderer';

describe('WorldTileLayer & MapLibre Geo Transparency', () => {
  it('decodes Terrarium RGB elevation accurately and shades tiles into dark Radar hillshade palette', () => {
    assert.equal(decodeTerrariumElevationM(128, 0, 0), 0);
    assert.equal(decodeTerrariumElevationM(162, 144, 0), 8848);
    assert.ok(decodeTerrariumElevationM(85, 14, 0) < -10000);

    const ocean = shadeRadarElevationRgb(-2000, 0.7);
    const plains = shadeRadarElevationRgb(300, 0.7);
    const alpine = shadeRadarElevationRgb(5200, 0.9);
    // Monotonic luminance from ocean -> plains -> alpine peaks, staying in cool slate-blue tactical ramp (B >= G >= R)
    assert.ok(ocean[2] < plains[2] && plains[2] < alpine[2]);
    assert.ok(alpine[2] >= alpine[1] && alpine[1] >= alpine[0]);

    // Verify 4x4 synthetic Terrarium slope buffer shades cleanly with opaque alpha
    const src = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      const elev = 32768 + (i < 4 ? -500 : 3500 + i * 100);
      src[i * 4] = Math.floor(elev / 256);
      src[i * 4 + 1] = Math.floor(elev % 256);
      src[i * 4 + 2] = 0;
      src[i * 4 + 3] = 255;
    }
    const dst = new Uint8ClampedArray(src.length);
    shadeTerrariumTileRgba(src, dst, 4, 4, 6, 34.5);
    assert.equal(dst[3], 255);
    assert.ok(dst[2] < dst[15 * 4 + 2], 'Higher elevation pixels must shade brighter than ocean pixels');
    assert.ok(DEFAULT_WORLD_RADAR_DEM_TILE_URL.includes('terrarium/{z}/{x}/{y}'));
  });
  it('round-trips slippy tile coordinates accurately at Ladakh (34.5N, 76.5E)', () => {
    const z = 8;
    const tx = lonDegToTileX(76.5, z);
    const ty = latDegToTileY(34.5, z);
    const lonW = tileXToLonDeg(tx, z);
    const lonE = tileXToLonDeg(tx + 1, z);
    const latN = tileYToLatDeg(ty, z);
    const latS = tileYToLatDeg(ty + 1, z);

    assert.ok(lonW <= 76.5 && 76.5 <= lonE, `76.5E must lie inside tile [${lonW}, ${lonE}]`);
    assert.ok(latS <= 34.5 && 34.5 <= latN, `34.5N must lie inside tile [${latS}, ${latN}]`);
  });

  it('geodeticToUnwrappedEnu projects world-wrap longitudes without throwing', () => {
    const center = geodeticToUnwrappedEnu(34.5, 76.5);
    assert.equal(center.xM, 0);
    assert.equal(center.yM, 0);

    const westWrap = geodeticToUnwrappedEnu(0, -210);
    const eastWrap = geodeticToUnwrappedEnu(0, 210);
    assert.ok(Number.isFinite(westWrap.xM) && westWrap.xM < 0);
    assert.ok(Number.isFinite(eastWrap.xM) && eastWrap.xM > 0);
  });

  it('formatSlippyTileUrl substitutes {z}, {x}, {y} in both Esri and standard XYZ order', () => {
    const esri = formatSlippyTileUrl(DEFAULT_WORLD_SATELLITE_TILE_URL, 6, 45, 25);
    assert.ok(esri.endsWith('/tile/6/25/45'), `Expected Esri z/y/x ordering, got ${esri}`);

    const xyz = formatSlippyTileUrl('https://tiles.example.test/{z}/{x}/{y}.png', 6, 45, 25);
    assert.equal(xyz, 'https://tiles.example.test/6/45/25.png');
  });

  it('computeVisibleWorldTiles covers local Ladakh theater and full world when zoomed out', () => {
    const localTiles = computeVisibleWorldTiles({
      width: 900,
      height: 700,
      rangeM: 60000,
      panOffsetX_m: 0,
      panOffsetY_m: 0,
    });
    assert.ok(localTiles.length >= 4 && localTiles.length <= 120);
    assert.ok(localTiles[0].z >= 8, `Expected high zoom at 60km range, got z=${localTiles[0].z}`);

    const worldTiles = computeVisibleWorldTiles({
      width: 900,
      height: 700,
      rangeM: 16000000,
      panOffsetX_m: 0,
      panOffsetY_m: 0,
    });
    assert.ok(worldTiles.length >= 16 && worldTiles.length <= 120);
    const uniqueTx = new Set(worldTiles.map(t => t.tx));
    const n = 1 << worldTiles[0].z;
    assert.equal(uniqueTx.size, n, `Full world view must include all ${n} longitude columns`);
  });

  it('renderRadar keeps canvas transparent in maplibre mode and draws exterior world tiles only when Radar SAT zooms past DEM', () => {
    const calls: string[] = [];
    const clipRules: string[] = [];
    const mockCtx = {
      clearRect: () => calls.push('clearRect'),
      fillRect: () => calls.push('fillRect'),
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: (rule?: string) => clipRules.push(rule || 'nonzero'),
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      closePath: () => {},
      setLineDash: () => {},
      fillText: () => {},
      strokeRect: () => {},
      measureText: () => ({ width: 20 }),
      drawImage: () => calls.push('drawImage'),
    } as unknown as CanvasRenderingContext2D;

    const mockCanvas = {
      width: 800,
      height: 600,
      parentElement: { clientWidth: 800, clientHeight: 600 },
    } as unknown as HTMLCanvasElement;

    const mockHillshade = { width: 512, height: 512 } as unknown as HTMLCanvasElement;
    const ladakhBounds = {
      minX: -91839.98,
      maxX: 91839.98,
      minY: -110931.45,
      maxY: 110931.45,
      terrainMode: 'real',
      isValidCoverage: true,
    };

    let currentMapMode = 'maplibre';
    let currentTerrainMode = 'real';
    let currentRangeM = 60000;
    let worldDrawCalls = 0;
    const mockWorldTileLayer = {
      draw: () => {
        worldDrawCalls++;
        return 12;
      },
    } as any;

    const renderer = createRadar2dRenderer({
      canvas: mockCanvas,
      ctx: mockCtx,
      getRangeM: () => currentRangeM,
      getPanOffset: () => ({ xM: 0, yM: 0 }),
      getStageViewMode: () => '2d',
      getTerrainMapMode: () => currentMapMode,
      getTerrainMode: () => currentTerrainMode,
      getWorldTileLayer: () => mockWorldTileLayer,
      projectEnuToScreen: (xM, yM) => ({ x: 400 + xM * 0.001, y: 300 - yM * 0.001 }),
      getLatestTelemetry: () => ({ acn_telemetry: { pos_x: 0, pos_y: 0 }, nodes_telemetry: [] }),
      getHistoricalSnapshot: () => null,
      getActiveTerrainBounds: () => ladakhBounds,
      getHillshadeCanvas: () => mockHillshade,
      getBackdropCanvas: () => null,
      getBackdropMode: () => 'relief',
      getMapLayerRegistry: () => ({ getEffectiveVisibility: () => true, getLayerOpacity: () => 0.9 }),
      getContextualMapContext: () => ({}),
      getSelectedNodeId: () => null,
      getToolboxState: () => ({}),
      getObstacleEditor: () => ({ draft: [], selectedId: null }),
      isMgrsGridActive: () => false,
    });

    // 1. Geo (MapLibre) mode: must clearRect only and NOT paint opaque void fillRect over MapLibre
    renderer.renderRadar();
    assert.ok(calls.includes('clearRect'));
    assert.equal(calls.includes('fillRect'), false, 'MapLibre mode must not paint opaque fillRect over MapLibre');
    assert.equal(worldDrawCalls, 0);

    // 2. Radar + SAT zoomed IN inside Ladakh DEM (60 km): must keep pure tactical DEM without world tiles
    calls.length = 0;
    currentMapMode = 'radar';
    currentTerrainMode = 'real';
    currentRangeM = 60000;
    renderer.renderRadar();
    assert.ok(calls.includes('fillRect'));
    assert.equal(worldDrawCalls, 0, 'Zoomed-in Radar SAT fully inside Ladakh DEM must not bleed world satellite tiles');

    // 3. Radar + SAT zoomed OUT past Ladakh DEM (200 km / world): must clip exterior evenodd and draw world tiles
    currentRangeM = 200000;
    renderer.renderRadar();
    assert.equal(worldDrawCalls, 1, 'Zoomed-out Radar SAT must render world satellite tile layer outside DEM');
    assert.ok(clipRules.includes('evenodd'), 'Exterior world satellite layer must be clipped outside DEM box');

    // 4. Radar + SYN ('synthetic') mode: must NOT draw world satellite tiles even when zoomed out
    currentTerrainMode = 'synthetic';
    renderer.renderRadar();
    assert.equal(worldDrawCalls, 1, 'Radar SYN mode must not render world satellite tile layer');
  });
});

console.log(`\nℹ tests ${suitePassed + suiteFailed} | pass ${suitePassed} | fail ${suiteFailed}`);
if (suiteFailed > 0) {
  throw new Error(`${suiteFailed} test(s) failed`);
}
