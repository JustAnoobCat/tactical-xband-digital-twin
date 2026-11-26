import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeWebMercatorZoomLevel } from '../ui/cartographyRenderer';
import {
  DEFAULT_MAX_NATIVE_TILE_ZOOM,
  WorldTileLayer,
  computeOverzoomTilePlan,
  latDegToTileY,
  lonDegToTileX,
  resolveSectorTheaterTarget,
} from '../ui/worldTileLayer';
import {
  MapController,
  buildOfflineSafeMapStyle,
} from '../ui/mapController';
import { computeAcnSectorSweepState } from '../ui/controllers/radar2dRenderer';
import { MapLayerRegistry, MAP_LAYER_PRESETS } from '../ui/workbench/mapLayerRegistry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

describe('MENTOR-01: Web Mercator Zoom, Overzoom, 4-Sector Sweep, Sector Jump & Offline Docs CSP', () => {
  it('computes exact Web Mercator zoom levels at equator and Ladakh anchors', () => {
    const zEq = computeWebMercatorZoomLevel(156543.03392, 0);
    expect(zEq).toBeCloseTo(0.0, 4);

    const z16 = computeWebMercatorZoomLevel(1.966, 34.5);
    expect(z16).toBeCloseTo(16.0, 1);

    const z17 = computeWebMercatorZoomLevel(0.983, 34.5);
    expect(z17).toBeCloseTo(17.0, 1);

    expect(computeWebMercatorZoomLevel(1e-8, 0)).toBe(22);
    expect(computeWebMercatorZoomLevel(1e12, 0)).toBe(0);
  });

  it('maps Z17 tiles cleanly to Z15 parent tile (x>>2, y>>2) and 64x64 sub-rectangle', () => {
    const z = 17;
    const tx = lonDegToTileX(76.5, z);
    const ty = latDegToTileY(34.5, z);
    const plan = computeOverzoomTilePlan(z, tx, ty, DEFAULT_MAX_NATIVE_TILE_ZOOM, 256);

    expect(plan.fetchZ).toBe(15);
    expect(plan.fetchX).toBe(tx >> 2);
    expect(plan.fetchY).toBe(ty >> 2);
    expect(plan.sw).toBe(64);
    expect(plan.sh).toBe(64);
    expect(plan.sx).toBe((tx - ((tx >> 2) << 2)) * 64);
    expect(plan.sy).toBe((ty - ((ty >> 2) << 2)) * 64);
    expect([0, 64, 128, 192]).toContain(plan.sx);
    expect([0, 64, 128, 192]).toContain(plan.sy);

    // Verify WorldTileLayer.draw() crops cached Z15 tile cleanly without fetching Z17 externally
    const origImage = (globalThis as Record<string, unknown>).Image;
    const requestedUrls: string[] = [];
    const drawImageCalls: number[][] = [];
    (globalThis as Record<string, unknown>).Image = class MockImage {
      public src = '';
      public crossOrigin = '';
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      constructor() {
        queueMicrotask(() => {
          if (this.src) requestedUrls.push(this.src);
        });
      }
    };

    try {
      const layer = new WorldTileLayer({
        renderMode: 'raster',
        maxNativeZoom: 15,
        allowExternalTiles: true,
        airGapOfflineOnly: false,
      });
      // Seed Z15 parent tile covering (34.5N, 76.5E)
      const p15x = lonDegToTileX(76.5, 15);
      const p15y = latDegToTileY(34.5, 15);
      const cacheMap = (layer as unknown as { cache: Map<string, unknown> }).cache;
      cacheMap.set(`15/${p15x}/${p15y}`, {
        status: 'loaded',
        source: { width: 256, height: 256 },
        width: 256,
        height: 256,
        lastUsed: 1,
      });

      const mockCtx = {
        save() {},
        restore() {},
        imageSmoothingEnabled: true,
        globalAlpha: 1,
        drawImage(...args: number[]) {
          drawImageCalls.push(args.slice(1));
        },
      } as unknown as CanvasRenderingContext2D;

      const drawn = layer.draw(mockCtx, {
        width: 800,
        height: 600,
        rangeM: 350, // ~Z17
        panOffsetX_m: 0,
        panOffsetY_m: 0,
      });
      expect(drawn).toBeGreaterThan(0);
      expect(drawImageCalls.some((c) => c.length === 8 && c[2] === 64 && c[3] === 64)).toBe(true);

      // setOrigin to another theater must clear stale tiles and increment loadGeneration
      const prevGen = layer.getLoadGeneration();
      layer.setOrigin(26.0, 93.0);
      expect(layer.getLoadGeneration()).toBeGreaterThan(prevGen);
      expect(layer.getLoadedTileCount()).toBe(0);
    } finally {
      (globalThis as Record<string, unknown>).Image = origImage;
    }
  });

  it('configures MapController remote raster maxzoom <= 15 while allowing map maxZoom >= 18', () => {
    const remoteStyle = buildOfflineSafeMapStyle({ airGapOfflineOnly: false });
    const satSource = remoteStyle.sources['maplibre-satellite'];
    expect(satSource).toBeDefined();
    expect(satSource.maxzoom).toBeLessThanOrEqual(15);

    const localHighZoomStyle = buildOfflineSafeMapStyle({
      airGapOfflineOnly: true,
      rasterTiles: ['./offline-tiles/{z}/{x}/{y}.png'],
      maxzoom: 17,
    });
    expect(localHighZoomStyle.sources['maplibre-satellite'].maxzoom).toBe(17);

    const ctrl = new MapController();
    expect(ctrl.getMaxZoom()).toBeGreaterThanOrEqual(18);
    expect(ctrl.getMinZoom()).toBeGreaterThanOrEqual(4);
  });

  it('computes 4-sector ACN wedge geometry and rotating sweep angle cleanly', () => {
    const state = computeAcnSectorSweepState(90, 1.0);
    expect(state.wedges).toHaveLength(4);
    expect(state.wedges.map((w) => w.label)).toEqual(['FWD', 'STBD', 'AFT', 'PORT']);
    // Each wedge spans exactly 90 degrees (pi / 2)
    for (const wedge of state.wedges) {
      expect(wedge.endRad - wedge.startRad).toBeCloseTo(Math.PI / 2, 6);
    }
    expect(state.sweepAngleRad).toBeCloseTo(1.4, 6);
    // At heading=90 (East), FWD (S0) center points East (0 rad in canvas space)
    expect(state.wedges[0].midRad).toBeCloseTo(0, 6);
  });

  it('keeps docs.html strictly CSP-compliant, 100% offline, and registered in vite.config.ts', () => {
    const docsPath = path.join(ROOT_DIR, 'docs.html');
    const docsScriptPath = path.join(ROOT_DIR, 'src', 'docsWindow.ts');
    const vitePath = path.join(ROOT_DIR, 'vite.config.ts');

    expect(fs.existsSync(docsPath)).toBe(true);
    expect(fs.existsSync(docsScriptPath)).toBe(true);

    const docsHtml = fs.readFileSync(docsPath, 'utf8');
    const scripts = [...docsHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0][2].trim()).toBe('');
    expect(scripts[0][1]).toMatch(/src=["']\/src\/docsWindow\.ts["']/);

    // Zero inline on*= handlers
    expect(/\son[a-z]+\s*=/i.test(docsHtml)).toBe(false);
    // Zero external http(s):// URLs
    expect(/https?:\/\//i.test(docsHtml)).toBe(false);

    const viteSrc = fs.readFileSync(vitePath, 'utf8');
    expect(viteSrc).toContain('docs.html');
  });

  it('enables rf.acnSectors by default in mapLayerRegistry.ts and Operational/RF presets', () => {
    const reg = new MapLayerRegistry(null);
    expect(reg.isLayerVisible('rf.acnSectors')).toBe(true);
    expect(MAP_LAYER_PRESETS.operational.visibility['rf.acnSectors']).toBe(true);
    expect(MAP_LAYER_PRESETS.rf_analysis.visibility['rf.acnSectors']).toBe(true);
  });

  it('maps every #dem-sector-select option to its exact regional (centerLatDeg, centerLonDeg)', () => {
    expect(resolveSectorTheaterTarget('ladakh')).toMatchObject({
      biomeId: 'alpine_mountain',
      terrainMode: 'real',
      centerLatDeg: 34.5,
      centerLonDeg: 76.5,
    });
    expect(resolveSectorTheaterTarget('kargil')).toMatchObject({
      biomeId: 'alpine_mountain',
      terrainMode: 'synthetic',
      centerLatDeg: 34.5,
      centerLonDeg: 76.1,
    });
    expect(resolveSectorTheaterTarget('arid_desert')).toMatchObject({
      biomeId: 'arid_desert',
      terrainMode: 'synthetic',
      centerLatDeg: 27.0,
      centerLonDeg: 71.5,
    });
    expect(resolveSectorTheaterTarget('open_plains')).toMatchObject({
      biomeId: 'open_plains',
      terrainMode: 'synthetic',
      centerLatDeg: 28.5,
      centerLonDeg: 77.2,
    });
    expect(resolveSectorTheaterTarget('tropical_jungle')).toMatchObject({
      biomeId: 'tropical_jungle',
      terrainMode: 'synthetic',
      centerLatDeg: 26.0,
      centerLonDeg: 93.0,
    });
    expect(resolveSectorTheaterTarget('maritime_littoral')).toMatchObject({
      biomeId: 'maritime_littoral',
      terrainMode: 'synthetic',
      centerLatDeg: 18.5,
      centerLonDeg: 72.0,
    });
    expect(resolveSectorTheaterTarget('synthetic')).toMatchObject({
      biomeId: 'alpine_mountain',
      terrainMode: 'synthetic',
      centerLatDeg: 34.5,
      centerLonDeg: 76.5,
    });
  });
});
