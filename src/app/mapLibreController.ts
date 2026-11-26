// @ts-nocheck — MapLibre GL stage controller, GeoJSON/raster overlays, camera sync & map mode switching
import type { AppContext } from './appContext.ts';
import { cartesianToGeodetic, geodeticToCartesian, METERS_PER_DEG_LON } from '../core/geodesy.ts';
import { obstacleContainsPoint, obstacleFootprintPoints } from '../core/obstacles.ts';
import { evaluateCursorRfProbe } from '../core/cursorProbeEngine.ts';
import { classifyAndStyleLink } from '../ui/mapLinkStyles.ts';
import { getMapZoomLodTier } from '../ui/workbench/mapLayerRegistry.ts';
import { computeRfOverlayGeometry, buildRfOverlayGeoJson } from '../ui/workbench/mapRfOverlay.ts';
import { HIGHLAND_THEME } from '../ui/workbench/chartTheme.ts';
import { sampleDemSafe } from '../ui/terrainToolboxAnalysis.ts';
import { TRANSECT_STATUS_COLORS } from '../ui/terrainToolboxCharts.ts';
import {
  DEFAULT_WORLD_SATELLITE_TILE_URL,
  DEFAULT_WORLD_SATELLITE_ATTRIBUTION,
  geodeticToUnwrappedEnu,
  getAirGapOfflineOnly,
  isExternalHttpUrl,
} from '../ui/worldTileLayer.ts';

export function initMapLibreController(ctx: AppContext) {
  const { state, engines, dom, actions } = ctx;
  const { $, TRANSPARENT_1X1_PNG } = dom;
  const {
    trajectoryEditor,
    obstacleEditor,
    mapLayerRegistry,
    historyController,
  } = engines;

  let mapLibreInitPromise = null;
  let mapSyncSeq = 0;
  let activeMapSyncToken = 0;
  let activeMapSyncTimer = null;
  const mapLibreSourceHashes = new Map();

  function clearMapLibreSourceHashes() {
    mapLibreSourceHashes.clear();
  }

  function isMapLibreDynamicSourceBusy() {
    if (!state.mapLibreInstance || !state.mapLibreInitialized) return false;
    const ids = [
      'maplibre-acn',
      'maplibre-acn-vector',
      'maplibre-acn-sectors',
      'maplibre-nodes',
      'maplibre-links',
      'maplibre-transmissions',
      'maplibre-travelled',
    ];
    return ids.some(id => {
      const src = state.mapLibreInstance.getSource(id);
      const q = src?._workerUpdates;
      return Boolean(q && (q._sending || (typeof q.isIdle === 'function' && !q.isIdle())));
    });
  }

  function setMapLibreSourceData(id, data, onlyWhenChanged = false) {
    if (!state.mapLibreInstance) return;
    const source = state.mapLibreInstance.getSource(id);
    if (!source || typeof source.setData !== 'function') return;
    if (onlyWhenChanged) {
      const hash = JSON.stringify(data);
      if (mapLibreSourceHashes.get(id) === hash) return;
      mapLibreSourceHashes.set(id, hash);
    }
    source.setData(data);
  }

  function beginMapLibreCameraSync(durationMs = 0) {
    if (activeMapSyncTimer !== null) {
      clearTimeout(activeMapSyncTimer);
      activeMapSyncTimer = null;
    }
    const token = ++mapSyncSeq;
    activeMapSyncToken = token;
    if (durationMs > 0) {
      activeMapSyncTimer = setTimeout(() => {
        if (activeMapSyncToken === token) activeMapSyncToken = 0;
        activeMapSyncTimer = null;
      }, durationMs + 80);
    }
    return token;
  }

  function endMapLibreCameraSync(token) {
    if (activeMapSyncTimer !== null && activeMapSyncToken === token) {
      clearTimeout(activeMapSyncTimer);
      activeMapSyncTimer = null;
    }
    if (activeMapSyncToken === token) {
      activeMapSyncToken = 0;
    }
  }

  function syncRangeButtonHighlights(rangeM) {
    const presets = [
      ['zoom-30', 30000],
      ['zoom-60', 60000],
      ['zoom-100', 100000],
      ['zoom-200', 200000],
    ];
    presets.forEach(([id, presetM]) => {
      const el = $(id);
      if (!el) return;
      const match = Math.abs(rangeM - presetM) / presetM <= 0.06;
      el.classList.toggle('active', match);
    });
  }

  function getMaxRadarRangeM() {
    return state.activeTerrainMode === 'real' || state.terrainMapMode === 'maplibre' ? 16000000 : 300000;
  }

  function syncMapLibreCameraFromRadarState(duration = 0, resetOrientation = false) {
    if (!state.mapLibreInstance || !state.mapLibreInitialized) return;
    const container = state.mapLibreInstance.getContainer();
    const cw = Math.max(100, container?.clientWidth || 600);
    const ch = Math.max(100, container?.clientHeight || 500);
    const limitingSpan = Math.min(cw, ch) * 0.94;
    const token = beginMapLibreCameraSync(duration);
    const centerGeo = cartesianToGeodetic(state.panOffsetX_m, state.panOffsetY_m);
    const clampedCenter = [
      Math.max(-180, Math.min(180, (((centerGeo.lonDeg + 180) % 360) + 360) % 360 - 180)),
      Math.max(-80, Math.min(80, centerGeo.latDeg)),
    ];
    if (state.currentRadarRangeM >= 2500000) {
      const scale = (limitingSpan * 0.5) / state.currentRadarRangeM;
      const spanLonDeg = Math.max(1, cw / scale / METERS_PER_DEG_LON);
      const zoom = Math.max(0.4, Math.min(14, Math.log2((360 * cw) / (512 * spanLonDeg))));
      const camOpts = {
        center: clampedCenter,
        zoom,
        duration,
        ...(resetOrientation ? { bearing: 0, pitch: 0 } : {}),
      };
      if (duration <= 0) {
        try {
          state.mapLibreInstance.jumpTo(camOpts);
        } finally {
          endMapLibreCameraSync(token);
        }
      } else {
        state.mapLibreInstance.easeTo(camOpts);
      }
      return;
    }
    const padH = Math.max(8, (cw - limitingSpan) / 2);
    const padV = Math.max(8, (ch - limitingSpan) / 2);
    const swRaw = mapLibreCoordinate(
      state.panOffsetX_m - state.currentRadarRangeM,
      state.panOffsetY_m - state.currentRadarRangeM
    );
    const neRaw = mapLibreCoordinate(
      state.panOffsetX_m + state.currentRadarRangeM,
      state.panOffsetY_m + state.currentRadarRangeM
    );
    const sw = [Math.max(-179.5, Math.min(179.5, swRaw[0])), Math.max(-84, Math.min(84, swRaw[1]))];
    const ne = [Math.max(-179.5, Math.min(179.5, neRaw[0])), Math.max(-84, Math.min(84, neRaw[1]))];
    const fitOpts = {
      padding: { top: padV, bottom: padV, left: padH, right: padH },
      duration,
      maxZoom: 14,
      ...(resetOrientation ? { bearing: 0, pitch: 0 } : {}),
    };
    if (duration <= 0) {
      try {
        state.mapLibreInstance.fitBounds([sw, ne], fitOpts);
      } finally {
        endMapLibreCameraSync(token);
      }
    } else {
      state.mapLibreInstance.fitBounds([sw, ne], fitOpts);
    }
  }

  function easeMapLibreToLocalCenter(xM, yM, duration = 250, resetOrientation = false) {
    if (!state.mapLibreInstance || !state.mapLibreInitialized || !Number.isFinite(xM) || !Number.isFinite(yM)) return;
    const token = beginMapLibreCameraSync(duration);
    const easeOpts = {
      center: mapLibreCoordinate(xM, yM),
      duration,
      ...(resetOrientation ? { bearing: 0, pitch: 0 } : {}),
    };
    if (duration <= 0) {
      try {
        state.mapLibreInstance.easeTo(easeOpts);
      } finally {
        endMapLibreCameraSync(token);
      }
    } else {
      state.mapLibreInstance.easeTo(easeOpts);
    }
  }

  function syncRadarStateFromMapLibreCamera() {
    if (!state.mapLibreInstance || !state.mapLibreInitialized) return;
    const center = state.mapLibreInstance.getCenter();
    const wrappedLng = (((center.lng + 180) % 360) + 360) % 360 - 180;
    const clampedLat = Math.max(-85, Math.min(85, center.lat));
    const localCenter = geodeticToUnwrappedEnu(clampedLat, wrappedLng);
    if (Number.isFinite(localCenter.xM) && Number.isFinite(localCenter.yM)) {
      state.panOffsetX_m = localCenter.xM;
      state.panOffsetY_m = localCenter.yM;
    }
    const container = state.mapLibreInstance.getContainer();
    const cw = container?.clientWidth || 600;
    const ch = container?.clientHeight || 500;
    const halfSpanPx = Math.min(cw, ch) * 0.47;
    if (cw >= 100 && ch >= 100 && halfSpanPx > 10) {
      const leftGeo = state.mapLibreInstance.unproject([cw / 2 - halfSpanPx, ch / 2]);
      const rightGeo = state.mapLibreInstance.unproject([cw / 2 + halfSpanPx, ch / 2]);
      const deltaLon = Math.abs(rightGeo.lng - leftGeo.lng);
      const estRangeM = (deltaLon * METERS_PER_DEG_LON) / 2;
      if (Number.isFinite(estRangeM) && estRangeM > 0) {
        state.currentRadarRangeM = Math.max(15000, Math.min(getMaxRadarRangeM(), estRangeM));
        syncRangeButtonHighlights(state.currentRadarRangeM);
        applyMapLibreLayerState();
      }
    }
  }

  function mapLibreCoordinate(xM, yM) {
    if (state.mapController && typeof state.mapController.projectEnuToGeodetic === 'function') {
      const geo = state.mapController.projectEnuToGeodetic(xM, yM);
      return [geo.lonDeg, geo.latDeg];
    }
    const coordinate = cartesianToGeodetic(xM, yM);
    return [coordinate.lonDeg, coordinate.latDeg];
  }

  function emptyFeatureCollection() {
    return { type: 'FeatureCollection', features: [] };
  }

  function mapLibrePointToLocal(coordinate) {
    const longitude = Number(coordinate?.[0]);
    const latitude = Number(coordinate?.[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    const local = geodeticToCartesian(latitude, longitude);
    return { lng: longitude, lat: latitude, x: local.xM, y: local.yM };
  }

  function geographicDistanceM(a, b) {
    const earthRadiusM = 6371008.8;
    const lat1 = (Number(a.lat) * Math.PI) / 180;
    const lat2 = (Number(b.lat) * Math.PI) / 180;
    const dLat = lat2 - lat1;
    const dLon = ((Number(b.lng) - Number(a.lng)) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function mapLibreToolPoint(featureOrCoordinate) {
    const coordinate = Array.isArray(featureOrCoordinate)
      ? featureOrCoordinate
      : featureOrCoordinate?.geometry?.coordinates;
    return mapLibrePointToLocal(coordinate);
  }

  function updateMapLibreToolSources() {
    if (!state.mapLibreInstance || !state.mapLibreInitialized) return;
    const draftCoordinates = state.terrainRegionDraft.map(point => [point.lng, point.lat]);
    setMapLibreSourceData(
      'maplibre-measurement',
      state.terrainMeasurement
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [state.terrainMeasurement.start.lng, state.terrainMeasurement.start.lat],
                    [state.terrainMeasurement.end.lng, state.terrainMeasurement.end.lat],
                  ],
                },
                properties: {},
              },
            ],
          }
        : emptyFeatureCollection(),
      true
    );
    setMapLibreSourceData(
      'maplibre-region-draft',
      draftCoordinates.length
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: draftCoordinates },
                properties: {},
              },
            ],
          }
        : emptyFeatureCollection(),
      true
    );

    // Mode 2 Segmented Transect
    const segFeatures = [];
    const markerFeatures = [];
    if (state.tbTransectResult && state.tbTransectResult.samples.length >= 2) {
      let curStatus = state.tbTransectResult.samples[0].status;
      let runCoords = [[state.tbTransectResult.samples[0].lonDeg, state.tbTransectResult.samples[0].latDeg]];
      for (let i = 1; i < state.tbTransectResult.samples.length; i++) {
        const s = state.tbTransectResult.samples[i];
        runCoords.push([s.lonDeg, s.latDeg]);
        if (s.status !== curStatus || i === state.tbTransectResult.samples.length - 1) {
          segFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: runCoords },
            properties: { color: TRANSECT_STATUS_COLORS[curStatus] || HIGHLAND_THEME.signal.sage },
          });
          curStatus = s.status;
          runCoords = [[s.lonDeg, s.latDeg]];
        }
      }
    } else if (state.tbTransectWaypoints.length >= 2) {
      segFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: state.tbTransectWaypoints.map(p => mapLibreCoordinate(p.xM, p.yM)),
        },
        properties: { color: HIGHLAND_THEME.signal.amber },
      });
    }
    if (
      (state.terrainToolMode === 'transect-2pt' || state.terrainToolMode === 'transect-poly') &&
      state.tbTransectWaypoints.length >= 1 &&
      state.tbRubberBandPoint
    ) {
      const lastWp = state.tbTransectWaypoints[state.tbTransectWaypoints.length - 1];
      segFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            mapLibreCoordinate(lastWp.xM, lastWp.yM),
            mapLibreCoordinate(state.tbRubberBandPoint.x, state.tbRubberBandPoint.y),
          ],
        },
        properties: { color: HIGHLAND_THEME.signal.ochre },
      });
    }
    state.tbTransectWaypoints.forEach((wp, idx) => {
      markerFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: mapLibreCoordinate(wp.xM, wp.yM) },
        properties: { kind: 'vertex', color: HIGHLAND_THEME.signal.amberBright, label: `T${idx + 1}` },
      });
    });
    if (state.tbTransectResult?.dominantCrest) {
      const c = state.tbTransectResult.dominantCrest;
      markerFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lonDeg, c.latDeg] },
        properties: {
          kind: 'crest',
          color: c.clearanceM < 0 ? HIGHLAND_THEME.signal.vermilion : HIGHLAND_THEME.signal.ochre,
          label: 'Crest',
        },
      });
    }
    if (state.tbTransectResult?.worstSpecular) {
      const sp = state.tbTransectResult.worstSpecular;
      markerFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [sp.lonDeg, sp.latDeg] },
        properties: { kind: 'specular', color: HIGHLAND_THEME.signal.amberBright, label: 'Spec' },
      });
    }
    if (state.tbHoveredSampleIdx !== null && state.tbTransectResult?.samples[state.tbHoveredSampleIdx]) {
      const hs = state.tbTransectResult.samples[state.tbHoveredSampleIdx];
      markerFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [hs.lonDeg, hs.latDeg] },
        properties: { kind: 'hover', color: '#ffffff', label: '' },
      });
    }
    if (state.tbProbeSite) {
      markerFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: mapLibreCoordinate(state.tbProbeSite.xM, state.tbProbeSite.yM) },
        properties: { kind: 'probe', color: HIGHLAND_THEME.signal.amberBright, label: 'Probe' },
      });
    }
    if (state.tbBridgeA) {
      markerFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: mapLibreCoordinate(state.tbBridgeA.xM, state.tbBridgeA.yM) },
        properties: { kind: 'bridge-a', color: HIGHLAND_THEME.signal.sage, label: 'A' },
      });
    }
    if (state.tbBridgeB) {
      markerFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: mapLibreCoordinate(state.tbBridgeB.xM, state.tbBridgeB.yM) },
        properties: { kind: 'bridge-b', color: HIGHLAND_THEME.signal.sage, label: 'B' },
      });
    }
    if (state.tbBridgeResult?.optimalBridge) {
      const ob = state.tbBridgeResult.optimalBridge;
      const obCoord = [ob.lonDeg, ob.latDeg];
      markerFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: obCoord },
        properties: { kind: 'bridge-star', color: HIGHLAND_THEME.signal.amberBright, label: '[RELAY]' },
      });
      if (state.tbBridgeA && state.tbBridgeB) {
        markerFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              mapLibreCoordinate(state.tbBridgeA.xM, state.tbBridgeA.yM),
              obCoord,
              mapLibreCoordinate(state.tbBridgeB.xM, state.tbBridgeB.yM),
            ],
          },
          properties: { kind: 'bridge-leg', color: HIGHLAND_THEME.signal.amberBright, label: '' },
        });
      }
    }
    setMapLibreSourceData(
      'maplibre-transect-segments',
      { type: 'FeatureCollection', features: segFeatures },
      true
    );
    setMapLibreSourceData(
      'maplibre-transect-markers',
      { type: 'FeatureCollection', features: markerFeatures },
      false
    );

    // M4: Image raster overlays for Viewshed & Bridge Heatmap
    const vsSrc = state.mapLibreInstance.getSource('maplibre-probe-viewshed');
    if (vsSrc && typeof vsSrc.updateImage === 'function' && state.tbViewshedNeedsMapLibreSync) {
      state.tbViewshedNeedsMapLibreSync = false;
      if (state.tbViewshedResult?.isSiteWithinCoverage && state.tbViewshedCanvas) {
        const r = state.tbViewshedResult.radiusM;
        const sx = state.tbViewshedResult.siteXM;
        const sy = state.tbViewshedResult.siteYM;
        const nw = mapLibreCoordinate(sx - r, sy + r);
        const ne = mapLibreCoordinate(sx + r, sy + r);
        const se = mapLibreCoordinate(sx + r, sy - r);
        const sw = mapLibreCoordinate(sx - r, sy - r);
        vsSrc.updateImage({ url: state.tbViewshedCanvas.toDataURL('image/png'), coordinates: [nw, ne, se, sw] });
      }
    }
    const brSrc = state.mapLibreInstance.getSource('maplibre-bridge-heatmap');
    if (brSrc && typeof brSrc.updateImage === 'function' && state.tbBridgeNeedsMapLibreSync) {
      state.tbBridgeNeedsMapLibreSync = false;
      if (state.tbBridgeResult?.valid && state.tbBridgeCanvas) {
        const b = state.tbBridgeResult.bounds;
        const nw = mapLibreCoordinate(b.minX, b.maxY);
        const ne = mapLibreCoordinate(b.maxX, b.maxY);
        const se = mapLibreCoordinate(b.maxX, b.minY);
        const sw = mapLibreCoordinate(b.minX, b.minY);
        brSrc.updateImage({ url: state.tbBridgeCanvas.toDataURL('image/png'), coordinates: [nw, ne, se, sw] });
      }
    }
  }

  function mapLibreToolClick(event) {
    if (!state.mapLibreInstance) return;
    if (state.terrainToolMode === 'idle' && state.tbActiveMode !== 'probe') return;
    const point = mapLibreToolPoint(event.lngLat ? [event.lngLat.lng, event.lngLat.lat] : null);
    if (!point) return;
    if (state.tbActiveMode === 'probe' && state.terrainToolMode === 'idle') {
      state.tbProbeSite = { xM: point.x, yM: point.y, lng: point.lng, lat: point.lat };
      actions.recomputeProbeAnalysis();
      if (state.tbCursorProbeLive) {
        state.tbProbePinnedP1 = state.tbCursorProbeLive;
      }
      actions.setTerrainToolStatus(`Probe set & [P1] pinned at ${point.lat.toFixed(4)}°, ${point.lng.toFixed(4)}°.`);
      actions.refreshTerrainToolbox();
      updateMapLibreToolSources();
      updateMapLibreOverlay();
      return;
    }
    actions.handleToolboxMapClick(point);
  }

  function findMapLibreObstacleIdAtPoint(point, padPx = 12) {
    if (!state.mapLibreInstance || !state.mapLibreInitialized || !point) return null;
    const mapCtx = actions.getContextualMapContext();
    if (!mapLayerRegistry.getEffectiveVisibility('entities.obstacles', mapCtx)) return null;
    const layers = ['maplibre-obstacles-fill', 'maplibre-obstacles-line'].filter(id =>
      state.mapLibreInstance.getLayer(id)
    );
    if (layers.length) {
      const renderedHits = state.mapLibreInstance.queryRenderedFeatures(
        [
          [point.x - padPx, point.y - padPx],
          [point.x + padPx, point.y + padPx],
        ],
        { layers }
      );
      const renderedId = renderedHits[0]?.properties?.obstacleId;
      if (typeof renderedId === 'string' && renderedId) return renderedId;
    }
    const coordinate = state.mapLibreInstance.unproject(point);
    const local = geodeticToCartesian(coordinate.lat, coordinate.lng);
    if (!Number.isFinite(local.xM) || !Number.isFinite(local.yM)) return null;
    const edgeGeo = state.mapLibreInstance.unproject([point.x + padPx, point.y]);
    const edgeLocal = geodeticToCartesian(edgeGeo.lat, edgeGeo.lng);
    const toleranceM =
      Number.isFinite(edgeLocal.xM) && Number.isFinite(edgeLocal.yM)
        ? Math.max(100, Math.hypot(edgeLocal.xM - local.xM, edgeLocal.yM - local.yM))
        : 500;
    const obsList =
      obstacleEditor.draft && obstacleEditor.draft.length > 0 ? obstacleEditor.draft : obstacleEditor.committed;
    let bestId = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const obs of obsList) {
      if (!obstacleContainsPoint(obs, local.xM, local.yM, toleranceM)) continue;
      const dist = Math.hypot(local.xM - obs.xM, local.yM - obs.yM);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = obs.id;
      }
    }
    return bestId;
  }

  function updateMapLibreCursor(point) {
    if (!state.mapLibreInstance) return;
    const canvas = state.mapLibreInstance.getCanvas();
    const isHistBlocked = Boolean(
      historyController.isInspecting ||
        (state.simTimelineController && state.simTimelineController.isHistoricalInspecting)
    );
    if (state.mapLibreNodeDrag || state.mapLibreObstacleDrag) {
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (state.terrainToolMode !== 'idle') {
      canvas.style.cursor = 'crosshair';
      return;
    }
    if (!state.spatialLocked && trajectoryEditor.activeMode === 'waypoints' && state.waypointPlacementArmed) {
      canvas.style.cursor = isHistBlocked ? 'not-allowed' : 'crosshair';
      return;
    }
    if (obstacleEditor.mode === 'place' && !state.spatialLocked) {
      canvas.style.cursor = isHistBlocked ? 'not-allowed' : 'crosshair';
      return;
    }
    if (point && state.mapLibreInitialized) {
      const mapCtx = actions.getContextualMapContext();
      if (obstacleEditor.mode === 'select') {
        if (findMapLibreObstacleIdAtPoint(point, 12)) {
          canvas.style.cursor = state.spatialLocked || isHistBlocked ? 'pointer' : 'grab';
          return;
        }
      } else if (obstacleEditor.mode === 'navigate' && trajectoryEditor.activeMode !== 'waypoints') {
        const queryLayers = [];
        if (mapLayerRegistry.getEffectiveVisibility('entities.groundNodes', mapCtx)) {
          if (state.mapLibreInstance.getLayer('maplibre-nodes-circle')) queryLayers.push('maplibre-nodes-circle');
          if (state.mapLibreInstance.getLayer('maplibre-nodes-mcp')) queryLayers.push('maplibre-nodes-mcp');
        }
        if (mapLayerRegistry.getEffectiveVisibility('entities.acn', mapCtx)) {
          if (state.mapLibreInstance.getLayer('maplibre-acn-marker')) queryLayers.push('maplibre-acn-marker');
          else if (state.mapLibreInstance.getLayer('maplibre-acn-circle')) queryLayers.push('maplibre-acn-circle');
        }
        if (mapLayerRegistry.getEffectiveVisibility('comm.links', mapCtx)) {
          [
            'maplibre-links-line',
            'maplibre-links-degraded',
            'maplibre-links-terrain-blocked',
            'maplibre-links-obstacle-blocked',
            'maplibre-links-outage',
            'maplibre-links-unknown',
          ].forEach(id => {
            if (state.mapLibreInstance.getLayer(id)) queryLayers.push(id);
          });
        }
        if (queryLayers.length && state.mapLibreInstance.queryRenderedFeatures(point, { layers: queryLayers }).length > 0) {
          canvas.style.cursor = 'pointer';
          return;
        }
      }
    }
    canvas.style.cursor = '';
  }

  function terrainRamp(value, minElevation, maxElevation) {
    const span = Math.max(1, maxElevation - minElevation);
    const t = Math.max(0, Math.min(1, (value - minElevation) / span));
    const stops = [
      [0.0, [26, 78, 121]],
      [0.2, [44, 129, 116]],
      [0.42, [117, 166, 90]],
      [0.62, [194, 179, 105]],
      [0.82, [151, 105, 72]],
      [1.0, [239, 239, 239]],
    ];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [a, b] = [stops[i - 1], stops[i]];
        const f = (t - a[0]) / (b[0] - a[0]);
        return [0, 1, 2].map(channel => Math.round(a[1][channel] + (b[1][channel] - a[1][channel]) * f));
      }
    }
    return stops[stops.length - 1][1];
  }

  function renderMapLibreTerrainRaster() {
    if (!state.mapLibreTerrainRaster) return;
    const { elevations, width, height, metadata } = state.mapLibreTerrainRaster;
    const maxDimension = 1024;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const outputWidth = Math.max(2, Math.round(width * scale));
    const outputHeight = Math.max(2, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(outputWidth, outputHeight);
    const minElevation = Number(metadata.minElevationM);
    const maxElevation = Number(metadata.maxElevationM);
    const sample = (row, column) => {
      const r = Math.max(0, Math.min(height - 1, row));
      const c = Math.max(0, Math.min(width - 1, column));
      return elevations[r * width + c];
    };
    for (let y = 0; y < outputHeight; y++) {
      const sourceRow = Math.round((y / (outputHeight - 1)) * (height - 1));
      for (let x = 0; x < outputWidth; x++) {
        const sourceColumn = Math.round((x / (outputWidth - 1)) * (width - 1));
        const elevation = sample(sourceRow, sourceColumn);
        const pixel = (y * outputWidth + x) * 4;
        if (!Number.isFinite(elevation)) {
          image.data[pixel + 3] = 0;
          continue;
        }
        let color = terrainRamp(elevation, minElevation, maxElevation);
        if (state.mapLibreTerrainMode === 'hillshade') {
          const left = sample(sourceRow, sourceColumn - 1);
          const right = sample(sourceRow, sourceColumn + 1);
          const north = sample(sourceRow - 1, sourceColumn);
          const south = sample(sourceRow + 1, sourceColumn);
          const dx = Number.isFinite(left) && Number.isFinite(right) ? right - left : 0;
          const dy = Number.isFinite(north) && Number.isFinite(south) ? south - north : 0;
          const shade = Math.max(
            0.35,
            Math.min(1.25, 0.78 - ((dx + dy) / Math.max(1, maxElevation - minElevation)) * 5)
          );
          color = color.map(channel => Math.round(Math.max(0, Math.min(255, channel * shade))));
        }
        image.data[pixel] = color[0];
        image.data[pixel + 1] = color[1];
        image.data[pixel + 2] = color[2];
        image.data[pixel + 3] = 235;
      }
    }
    context.putImageData(image, 0, 0);
    state.mapLibreTerrainRaster.dataUrl = canvas.toDataURL('image/png');
    state.mapLibreTerrainRaster.coordinates = [
      [Number(metadata.minLonDeg), Number(metadata.maxLatDeg)],
      [Number(metadata.maxLonDeg), Number(metadata.maxLatDeg)],
      [Number(metadata.maxLonDeg), Number(metadata.minLatDeg)],
      [Number(metadata.minLonDeg), Number(metadata.minLatDeg)],
    ];
    applyMapLibreTerrainRaster();
  }

  function applyMapLibreTerrainRaster() {
    if (!state.mapLibreInstance || !state.mapLibreInitialized) return;
    const source = state.mapLibreInstance.getSource('maplibre-hgt');
    if (!source) return;
    if (state.tbBackdropMode !== 'relief' && state.tbBackdropCanvas && state.tbSlopeRidgeGrid) {
      const b = state.tbSlopeRidgeGrid.bounds;
      const nw = mapLibreCoordinate(b.minX, b.maxY);
      const ne = mapLibreCoordinate(b.maxX, b.maxY);
      const se = mapLibreCoordinate(b.maxX, b.minY);
      const sw = mapLibreCoordinate(b.minX, b.minY);
      if (typeof source.updateImage === 'function') {
        source.updateImage({
          url: state.tbBackdropCanvas.toDataURL('image/png'),
          coordinates: [nw, ne, se, sw],
        });
      }
    } else if (state.mapLibreTerrainRaster && typeof source.updateImage === 'function') {
      source.updateImage({
        url: state.mapLibreTerrainRaster.dataUrl,
        coordinates: state.mapLibreTerrainRaster.coordinates,
      });
    }
    if (state.mapLibreInstance.getLayer('maplibre-hgt-layer')) {
      const visTerrain = mapLayerRegistry.getEffectiveVisibility(
        'base.terrainDem',
        actions.getContextualMapContext()
      );
      const opTerrain = mapLayerRegistry.getLayerOpacity('base.terrainDem');
      state.mapLibreTerrainVisible = visTerrain;
      state.mapLibreTerrainOpacity = opTerrain;
      state.mapLibreInstance.setPaintProperty('maplibre-hgt-layer', 'raster-opacity', visTerrain ? opTerrain : 0);
      state.mapLibreInstance.setLayoutProperty(
        'maplibre-hgt-layer',
        'visibility',
        visTerrain ? 'visible' : 'none'
      );
    }
  }

  function ensureMapLibreTerrainLayer() {
    if (!state.mapLibreInstance || !state.mapLibreInitialized || !state.mapLibreTerrainRaster) return;
    if (!state.mapLibreInstance.getSource('maplibre-hgt')) {
      state.mapLibreInstance.addSource('maplibre-hgt', {
        type: 'image',
        url: state.mapLibreTerrainRaster.dataUrl,
        coordinates: state.mapLibreTerrainRaster.coordinates,
      });
    }
    if (!state.mapLibreInstance.getLayer('maplibre-hgt-layer')) {
      state.mapLibreInstance.addLayer({
        id: 'maplibre-hgt-layer',
        type: 'raster',
        source: 'maplibre-hgt',
        paint: {
          'raster-opacity': state.mapLibreTerrainVisible ? state.mapLibreTerrainOpacity : 0,
        },
      });
    }
    applyMapLibreTerrainRaster();
  }

  function setMapLibreTerrainRaster(elevations, metadata) {
    if (!(elevations instanceof Float32Array) || !metadata) return;
    const width = Number(metadata.rasterWidth);
    const height = Number(metadata.rasterHeight);
    if (!Number.isInteger(width) || !Number.isInteger(height) || elevations.length < width * height) return;
    state.mapLibreTerrainRaster = { elevations, width, height, metadata, dataUrl: '', coordinates: [] };
    renderMapLibreTerrainRaster();
    ensureMapLibreTerrainLayer();
  }

  function setMapLibreLayerVisibility(layerId, visible) {
    if (!state.mapLibreInstance || !state.mapLibreInitialized) return;
    if (!state.mapLibreInstance.getLayer(layerId)) return;
    state.mapLibreInstance.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  }

  function setMapLibreLayerOpacity(layerId, prop, value) {
    if (!state.mapLibreInstance || !state.mapLibreInitialized) return;
    if (!state.mapLibreInstance.getLayer(layerId)) return;
    state.mapLibreInstance.setPaintProperty(layerId, prop, value);
  }

  function applyMapLibreLayerState() {
    if (!state.mapLibreInstance || !state.mapLibreInitialized) return;
    const mapCtx = actions.getContextualMapContext();

    const visTerrain = mapLayerRegistry.getEffectiveVisibility('base.terrainDem', mapCtx);
    const opTerrain = mapLayerRegistry.getLayerOpacity('base.terrainDem');
    state.mapLibreTerrainVisible = visTerrain;
    state.mapLibreTerrainOpacity = opTerrain;
    setMapLibreLayerVisibility('maplibre-hgt-layer', visTerrain);
    setMapLibreLayerOpacity('maplibre-hgt-layer', 'raster-opacity', visTerrain ? Math.min(opTerrain, 0.72) : 0);
    setMapLibreLayerVisibility('maplibre-satellite-layer', true);

    const visAcn = mapLayerRegistry.getEffectiveVisibility('entities.acn', mapCtx);
    const visNodes = mapLayerRegistry.getEffectiveVisibility('entities.groundNodes', mapCtx);
    const visLabels = mapLayerRegistry.getEffectiveVisibility('entities.labels', mapCtx);
    const visTrajectory = mapLayerRegistry.getEffectiveVisibility('entities.trajectory', mapCtx);
    const visObstacles = mapLayerRegistry.getEffectiveVisibility('entities.obstacles', mapCtx);
    const visLinks = mapLayerRegistry.getEffectiveVisibility('comm.links', mapCtx);
    const opLinks = mapLayerRegistry.getEffectiveAlpha('comm.links', mapCtx);
    const visCoverage = mapLayerRegistry.getEffectiveVisibility('comm.coverage', mapCtx);
    const opCoverage = mapLayerRegistry.getLayerOpacity('comm.coverage');
    const visRfLos = mapLayerRegistry.getEffectiveVisibility('rf.losAnalysis', mapCtx);
    const visRfFresnel = mapLayerRegistry.getEffectiveVisibility('rf.fresnelZone', mapCtx);
    const opRfFresnel = mapLayerRegistry.getLayerOpacity('rf.fresnelZone');
    const visRfObstructions = mapLayerRegistry.getEffectiveVisibility('rf.obstructionPoints', mapCtx);
    const visMeas = mapLayerRegistry.getEffectiveVisibility('eng.measurements', mapCtx);

    setMapLibreLayerVisibility('maplibre-acn-marker', visAcn);
    setMapLibreLayerVisibility('maplibre-acn-vector-line', visAcn);
    setMapLibreLayerVisibility('maplibre-acn-vector-tag', visAcn);
    setMapLibreLayerVisibility('maplibre-acn-label', visAcn && visLabels);
    setMapLibreLayerVisibility('maplibre-acn-sectors-crossover', visAcn);
    setMapLibreLayerVisibility('maplibre-acn-sectors-boresight', visAcn);
    setMapLibreLayerVisibility('maplibre-acn-sectors-label', visAcn);
    setMapLibreLayerVisibility('maplibre-acn-circle', false);
    setMapLibreLayerVisibility('maplibre-acn-heading', false);

    setMapLibreLayerVisibility('maplibre-nodes-circle', visNodes);
    setMapLibreLayerVisibility('maplibre-nodes-mcp', visNodes);
    setMapLibreLayerVisibility('maplibre-nodes-selection-inner', visNodes);
    setMapLibreLayerVisibility('maplibre-nodes-selection-outer', visNodes);
    setMapLibreLayerVisibility('maplibre-nodes-hover-reticle', visNodes);
    setMapLibreLayerVisibility('maplibre-labels', visNodes && visLabels);
    setMapLibreLayerVisibility('maplibre-labels-active', visNodes && visLabels);

    setMapLibreLayerVisibility('maplibre-planned-casing', visTrajectory);
    setMapLibreLayerVisibility('maplibre-planned-line', visTrajectory);
    setMapLibreLayerVisibility('maplibre-travelled-casing', visTrajectory);
    setMapLibreLayerVisibility('maplibre-travelled-line', visTrajectory);
    setMapLibreLayerVisibility('maplibre-waypoints-outer', visTrajectory);
    setMapLibreLayerVisibility('maplibre-waypoints-dot', visTrajectory);
    setMapLibreLayerVisibility('maplibre-waypoints-selected', visTrajectory);
    setMapLibreLayerVisibility('maplibre-waypoints-label', visTrajectory && visLabels);

    setMapLibreLayerVisibility('maplibre-obstacles-fill', visObstacles);
    setMapLibreLayerVisibility('maplibre-obstacles-line', visObstacles);

    const linkLayers = [
      'maplibre-links-selected-casing',
      'maplibre-links-line',
      'maplibre-links-degraded',
      'maplibre-links-terrain-blocked',
      'maplibre-links-obstacle-blocked',
      'maplibre-links-outage',
      'maplibre-links-unknown',
    ];
    const focusOn = mapLayerRegistry.isContextualFocusEnabled() && mapCtx.selectedNodeId !== null;
    const unselLinkOp = Math.max(0.05, Math.min(1, opLinks * (focusOn ? 0.16 : 0.75)));
    const selLinkOp = Math.max(
      0.15,
      Math.min(1, Math.max(opLinks, 0.95) * (mapCtx.isTrajectoryEditing || mapCtx.isObstacleEditing ? 0.22 : 1))
    );
    linkLayers.forEach((id) => {
      setMapLibreLayerVisibility(id, visLinks);
      setMapLibreLayerOpacity(id, 'line-opacity', [
        'case',
        ['==', ['get', 'selected'], 1],
        selLinkOp,
        ['==', ['get', 'hovered'], 1],
        Math.min(1, unselLinkOp + 0.15),
        unselLinkOp,
      ]);
    });

    const visTransmissions = mapLayerRegistry.getEffectiveVisibility('comm.transmissions', mapCtx);
    const txAlpha = mapLayerRegistry.getEffectiveAlpha('comm.transmissions', mapCtx);
    setMapLibreLayerVisibility('maplibre-transmissions-glow', visTransmissions);
    setMapLibreLayerVisibility('maplibre-transmissions-core', visTransmissions);
    setMapLibreLayerOpacity('maplibre-transmissions-glow', 'circle-opacity', txAlpha * 0.7);
    setMapLibreLayerOpacity('maplibre-transmissions-core', 'circle-opacity', txAlpha);

    setMapLibreLayerVisibility('maplibre-coverage-fill', visCoverage);
    setMapLibreLayerVisibility('maplibre-coverage-line', visCoverage);
    setMapLibreLayerOpacity('maplibre-coverage-fill', 'fill-opacity', Math.max(0.03, opCoverage * 0.25));
    setMapLibreLayerOpacity('maplibre-coverage-line', 'line-opacity', opCoverage);

    setMapLibreLayerVisibility('maplibre-rf-fresnel-fill', visRfFresnel);
    setMapLibreLayerVisibility('maplibre-rf-fresnel-line', visRfFresnel);
    setMapLibreLayerOpacity(
      'maplibre-rf-fresnel-fill',
      'fill-opacity',
      Math.max(0.08, Math.min(0.65, opRfFresnel * 0.45))
    );
    setMapLibreLayerOpacity(
      'maplibre-rf-fresnel-line',
      'line-opacity',
      Math.max(0.2, Math.min(0.95, opRfFresnel))
    );
    setMapLibreLayerVisibility('maplibre-rf-los-line', visRfLos);
    setMapLibreLayerVisibility('maplibre-rf-obstacle-hits', visRfObstructions);
    setMapLibreLayerVisibility('maplibre-rf-crest-point', visRfObstructions);

    [
      'maplibre-regions-fill',
      'maplibre-regions-line',
      'maplibre-measurement-line',
      'maplibre-region-draft-line',
      'maplibre-transect-segments-line',
      'maplibre-transect-bridge-legs',
      'maplibre-transect-markers-circle',
      'maplibre-transect-markers-label',
    ].forEach((id) => setMapLibreLayerVisibility(id, visMeas));
    const showProbeLayer =
      visMeas &&
      Boolean(state.tbViewshedResult?.isSiteWithinCoverage) &&
      Boolean(state.tbProbeHeatmapConfig.enabled) &&
      (state.tbActiveMode === 'probe' || state.tbActiveMode === 'dem' || state.terrainToolMode === 'probe');
    setMapLibreLayerVisibility('maplibre-probe-viewshed-layer', showProbeLayer);
    if (state.mapLibreInstance?.getLayer('maplibre-probe-viewshed-layer')) {
      state.mapLibreInstance.setPaintProperty(
        'maplibre-probe-viewshed-layer',
        'raster-opacity',
        state.tbProbeHeatmapConfig.opacity
      );
    }
    setMapLibreLayerVisibility('maplibre-bridge-heatmap-layer', visMeas && Boolean(state.tbBridgeResult?.valid));
  }

  function buildGeoCircleRing(centerXM, centerYM, radiusM, segments = 64) {
    const ring = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (2 * Math.PI * i) / segments;
      ring.push(mapLibreCoordinate(centerXM + Math.cos(theta) * radiusM, centerYM + Math.sin(theta) * radiusM));
    }
    return ring;
  }

  function updateMapLibreOverlay() {
    if (!state.mapLibreInstance || !state.mapLibreInitialized || !state.latestTelemetry) return;
    const mapCtx = actions.getContextualMapContext();
    const simTimelineController = state.simTimelineController;
    const isHist = Boolean(simTimelineController && simTimelineController.isHistoricalInspecting);
    const histSnap = isHist ? simTimelineController.getActiveSpatialSnapshot() : null;

    const liveAcn = state.latestTelemetry.acn_telemetry || {};
    const acnX = Number(histSnap ? histSnap.acn.posX : liveAcn.pos_x ?? 0);
    const acnY = Number(histSnap ? histSnap.acn.posY : liveAcn.pos_y ?? 0);
    const acnCoordinate = mapLibreCoordinate(acnX, acnY);
    const headingRad = Number(histSnap ? histSnap.acn.headingRad : liveAcn.heading_rad);
    const covKm = Number(histSnap ? histSnap.acn.coverageRadiusKm : liveAcn.coverage_radius_km);

    // Freeze live travelled path mutations during historical inspection
    if (
      !isHist &&
      (!state.mapLibreTravelledPath.length ||
        state.mapLibreTravelledPath[state.mapLibreTravelledPath.length - 1][0] !== acnCoordinate[0] ||
        state.mapLibreTravelledPath[state.mapLibreTravelledPath.length - 1][1] !== acnCoordinate[1])
    ) {
      state.mapLibreTravelledPath.push(acnCoordinate);
      if (state.mapLibreTravelledPath.length > 512) state.mapLibreTravelledPath.shift();
    }

    const liveNodesById = new Map((state.latestTelemetry.nodes_telemetry || []).map(n => [n.node_id, n]));
    const rawNodes = histSnap
      ? histSnap.nodes.map(hNode => {
          const liveNode = liveNodesById.get(hNode.nodeId);
          return {
            node_id: hNode.nodeId,
            name: liveNode?.name,
            color_hex: liveNode?.color_hex,
            x_m: hNode.posX,
            y_m: hNode.posY,
            lat_deg: liveNode?.lat_deg,
            lon_deg: liveNode?.lon_deg,
            agl_m: liveNode?.agl_m,
            battery_level_pct: liveNode?.battery_level_pct,
            tx_power_dbm: liveNode?.tx_power_dbm,
            tactical_priority: liveNode?.tactical_priority,
            terrain_is_los: hNode.isLos,
            obstacle_blocked: hNode.isObstacleBlocked,
            link_outage: hNode.isOutage,
            snr_db: hNode.snrDb,
            state_name: hNode.currentState,
            registration_state: liveNode?.registration_state,
            is_transmitting: false,
          };
        })
      : isHist
        ? []
        : state.latestTelemetry.nodes_telemetry || [];

    const zoomLod = getMapZoomLodTier(state.currentRadarRangeM);
    const vx = Number(histSnap ? histSnap.acn.velX : liveAcn.velocity?.[0] ?? liveAcn.vel_x ?? 0);
    const vy = Number(histSnap ? histSnap.acn.velY : liveAcn.velocity?.[1] ?? liveAcn.vel_y ?? 0);
    const vz = Number(histSnap ? histSnap.acn.velZ : liveAcn.vel_z ?? 0);
    const acnAltM = Number(histSnap ? histSnap.acn.altitudeMslM : liveAcn.altitude_msl_m ?? 5000);
    const acnAglM = Number(histSnap ? histSnap.acn.altitudeAglM : liveAcn.altitude_agl_m);
    const headingDeg = Number.isFinite(headingRad) ? (((headingRad * 180) / Math.PI) % 360 + 360) % 360 : 0;
    const isClamped = Boolean(histSnap ? histSnap.acn.isTerrainClamped : liveAcn.is_terrain_clamped);

    let acnText = 'ACN-1';
    if (zoomLod === 'medium') {
      acnText = Number.isFinite(acnAltM) && acnAltM > 0 ? `ACN-1 · ${Math.round(acnAltM)}m` : 'ACN-1';
    } else if (zoomLod === 'close') {
      const acnParts = [];
      if (Number.isFinite(acnAltM) && acnAltM > 0) acnParts.push(`${Math.round(acnAltM)}m MSL`);
      if (Number.isFinite(acnAglM) && acnAglM > 0) acnParts.push(`${Math.round(acnAglM)}m AGL`);
      if (Math.abs(vz) >= 0.1) acnParts.push(`${vz >= 0 ? '▲' : '▼'}${Math.abs(vz).toFixed(1)}m/s`);
      if (isClamped) acnParts.push('CLAMPED');
      const acnMetrics = acnParts.length > 0 ? ` [${acnParts.join(' · ')}]` : '';
      acnText = `ACN-1${acnMetrics} · HDG ${Math.round(headingDeg)}°`;
    }

    const nodeFeatures = rawNodes.flatMap(node => {
      const preview = !isHist && state.mapLibreNodeDrag?.nodeId === node.node_id ? state.mapLibreNodeDrag.local : null;
      const x = Number(preview?.xM ?? node.x_m ?? node.position?.[0]);
      const y = Number(preview?.yM ?? node.y_m ?? node.position?.[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      const coord = mapLibreCoordinate(x, y);
      const liveNode = liveNodesById.get(node.node_id);
      const isMCP = liveNode?.node_type === 'mcp' || node.node_type === 'mcp' || node.nodeType === 'mcp';
      const { classification, style } = classifyAndStyleLink(node);
      return [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coord },
          properties: {
            label: node.name || (isMCP ? 'MCP' : `S${node.node_id}`),
            color: node.color_hex || (isMCP ? HIGHLAND_THEME.signal.amber : style.nodeColor),
            nodeId: node.node_id,
            isMCP: isMCP ? 1 : 0,
            nodeType: isMCP ? 'mcp' : 'soldier',
            callsign: node.name || node.callsign || `S${node.node_id}`,
            lat: Number.isFinite(Number(node.lat_deg)) ? Number(node.lat_deg) : coord[1],
            lon: Number.isFinite(Number(node.lon_deg)) ? Number(node.lon_deg) : coord[0],
            agl: Number(node.agl_m),
            battery: Number(node.battery_level_pct),
            txPower: Number(node.tx_power_dbm),
            priority: Number(node.tactical_priority),
            linkStatus: classification.status,
            status: node.state_name || node.modcod_name || 'UNKNOWN',
            registrationState: node.registration_state || 'UNREGISTERED',
            rfOutage: node.link_outage ? 1 : 0,
            selected: node.node_id === state.selectedNodeId ? 1 : 0,
            selectedColor: style.selectedStrokeColor || HIGHLAND_THEME.signal.amberBright,
            hovered: node.node_id === state.hoveredNodeId ? 1 : 0,
          },
        },
      ];
    });
    const acnFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: acnCoordinate },
      properties: {
        label: 'ACN RELAY',
        badgeText: acnText,
        color: HIGHLAND_THEME.signal.amber,
        headingDeg,
        lat: acnCoordinate[1],
        lon: acnCoordinate[0],
      },
    };
    const targetX = acnX + vx * 30.0;
    const targetY = acnY + vy * 30.0;
    const targetCoord = mapLibreCoordinate(targetX, targetY);
    const showVectorTape = zoomLod !== 'distant' && (Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1);
    const acnVectorFeatures = showVectorTape
      ? [
          {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [acnCoordinate, targetCoord] },
            properties: {},
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: targetCoord },
            properties: { label: '+30s' },
          },
        ]
      : [];

    const acnHdg =
      histSnap && histSnap.acn_heading_deg !== undefined
        ? histSnap.acn_heading_deg
        : state.latestTelemetry && state.latestTelemetry.acn_heading_deg !== undefined
          ? state.latestTelemetry.acn_heading_deg
          : headingDeg;

    const acnSectorFeatures = [];
    const rayLenM = 8000;
    const boreLenM = 5000;
    const lblLenM = 5600;

    // 4 dashed -3 dB sector boundary rays at true bearings acnHdg + 45°, 135°, 225°, 315°
    const crossoverAngles = [45, 135, 225, 315];
    for (const offset of crossoverAngles) {
      const bearing = (acnHdg + offset) % 360;
      const rad = (bearing * Math.PI) / 180;
      const dx = rayLenM * Math.sin(rad);
      const dy = rayLenM * Math.cos(rad);
      const endCoord = mapLibreCoordinate(acnX + dx, acnY + dy);
      acnSectorFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [acnCoordinate, endCoord] },
        properties: { type: 'boundary' },
      });
    }

    // 4 boresight vectors and labels: 0° (FWD), 90° (STBD), 180° (AFT), 270° (PORT)
    const sectorConfigs = [
      { label: 'S0', offset: 0 },
      { label: 'S1', offset: 90 },
      { label: 'S2', offset: 180 },
      { label: 'S3', offset: 270 },
    ];
    for (const sec of sectorConfigs) {
      const bearing = (acnHdg + sec.offset) % 360;
      const rad = (bearing * Math.PI) / 180;
      const dxBore = boreLenM * Math.sin(rad);
      const dyBore = boreLenM * Math.cos(rad);
      const boreCoord = mapLibreCoordinate(acnX + dxBore, acnY + dyBore);
      acnSectorFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [acnCoordinate, boreCoord] },
        properties: { type: 'boresight' },
      });

      const dxLbl = lblLenM * Math.sin(rad);
      const dyLbl = lblLenM * Math.cos(rad);
      const lblCoord = mapLibreCoordinate(acnX + dxLbl, acnY + dyLbl);
      acnSectorFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: lblCoord },
        properties: { type: 'label', label: sec.label },
      });
    }
    const transmissionFeatures = [];
    const nowMs = performance.now();
    rawNodes.forEach(node => {
      if (!node.is_transmitting && !node.is_wasting_airtime) return;
      const preview = !isHist && state.mapLibreNodeDrag?.nodeId === node.node_id ? state.mapLibreNodeDrag.local : null;
      const x = Number(preview?.xM ?? node.x_m ?? node.position?.[0]);
      const y = Number(preview?.yM ?? node.y_m ?? node.position?.[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const nodeCoord = mapLibreCoordinate(x, y);
      const phase = (nowMs / 600 + node.node_id * 0.25) % 1.0;
      const pktLng = acnCoordinate[0] + (nodeCoord[0] - acnCoordinate[0]) * phase;
      const pktLat = acnCoordinate[1] + (nodeCoord[1] - acnCoordinate[1]) * phase;
      transmissionFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pktLng, pktLat] },
        properties: {
          nodeId: node.node_id,
          color: node.link_outage
            ? HIGHLAND_THEME.signal.vermilion
            : node.obstacle_blocked
              ? HIGHLAND_THEME.signal.copper
              : HIGHLAND_THEME.signal.amber,
        },
      });
    });
    const linkFeatures = rawNodes.flatMap(node => {
      const preview = !isHist && state.mapLibreNodeDrag?.nodeId === node.node_id ? state.mapLibreNodeDrag.local : null;
      const x = Number(preview?.xM ?? node.x_m ?? node.position?.[0]);
      const y = Number(preview?.yM ?? node.y_m ?? node.position?.[1]);
      const hasLinkTelemetry =
        isHist ||
        typeof node.link_outage === 'boolean' ||
        Number.isFinite(Number(node.bitrate_bps)) ||
        typeof node.modcod_name === 'string';
      if (!Number.isFinite(x) || !Number.isFinite(y) || !hasLinkTelemetry) return [];
      const { classification, style } = classifyAndStyleLink(node);
      return [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [acnCoordinate, mapLibreCoordinate(x, y)] },
          properties: {
            nodeId: node.node_id,
            source: 'ACN-1',
            destination: node.name || `Node ${node.node_id}`,
            selected: node.node_id === state.selectedNodeId ? 1 : 0,
            hovered: node.node_id === state.hoveredLinkNodeId ? 1 : 0,
            color: style.strokeColor,
            selectedColor: style.selectedStrokeColor,
            status: classification.status,
            statusLabel: style.statusLabel,
          },
        },
      ];
    });
    const flightPath = Array.isArray(liveAcn.flight_path)
      ? liveAcn.flight_path
          .filter(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
          .map(point => mapLibreCoordinate(point[0], point[1]))
      : [];
    const pathDraft = trajectoryEditor.preview;
    const usingDraftWaypoints = !isHist && trajectoryEditor.activeMode === 'waypoints';
    const activeWaypoints = usingDraftWaypoints
      ? (trajectoryEditor.dirty
          ? pathDraft.points
          : trajectoryEditor.committedActive.points?.length
            ? trajectoryEditor.committedActive.points
            : pathDraft.points
        ).map(pt => ({ x_m: pt.xM, y_m: pt.yM }))
      : state.latestTelemetry.trajectory_config?.waypoints || [];
    const waypointPath = activeWaypoints
      .filter(point => Number.isFinite(point.x_m) && Number.isFinite(point.y_m))
      .map(point => mapLibreCoordinate(point.x_m, point.y_m));
    if (usingDraftWaypoints && trajectoryEditor.dirty && waypointPath.length >= 2) {
      waypointPath.push(waypointPath[0]);
    }
    const plannedCoordinates =
      usingDraftWaypoints && trajectoryEditor.dirty
        ? waypointPath
        : flightPath.length >= 2
          ? flightPath
          : waypointPath;
    const waypointFeatures = activeWaypoints
      .filter(point => Number.isFinite(point.x_m) && Number.isFinite(point.y_m))
      .map((point, index) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: mapLibreCoordinate(point.x_m, point.y_m) },
        properties: {
          label: `WP${index + 1}`,
          selected: index === trajectoryEditor.selectedWaypoint ? 1 : 0,
        },
      }));
    const regionFeatures = state.terrainRegions
      .map(region => {
        const coordinates = region.points.map(point =>
          point.lng !== undefined && point.lat !== undefined
            ? [point.lng, point.lat]
            : mapLibreCoordinate(point.x, point.y)
        );
        if (coordinates.length < 3) return null;
        coordinates.push(coordinates[0]);
        return {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [coordinates] },
          properties: { color: region.color, visible: region.visible ? 1 : 0 },
        };
      })
      .filter(Boolean);

    const committedObstacles = obstacleEditor.committed || [];
    const draftObstacles = obstacleEditor.draft || [];
    const committedById = new Map(committedObstacles.map(item => [item.id, item]));
    const obsList = draftObstacles.length > 0 ? draftObstacles : committedObstacles;
    const obstacleFeatures = obsList.flatMap(obs => {
      if (![obs.xM, obs.yM].every(Number.isFinite)) return [];
      const ring = obstacleFootprintPoints(obs, 36).map(pt => mapLibreCoordinate(pt[0], pt[1]));
      if (ring.length < 3) return [];
      ring.push(ring[0]);
      const committedVer = committedById.get(obs.id);
      const changed = !committedVer || JSON.stringify(committedVer) !== JSON.stringify(obs);
      return [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: {
            obstacleId: obs.id,
            selected: obs.id === obstacleEditor.selectedId ? 1 : 0,
            isDraftChanged: changed ? 1 : 0,
          },
        },
      ];
    });

    const coverageFeatures =
      Number.isFinite(covKm) && covKm > 0
        ? [
            {
              type: 'Feature',
              geometry: { type: 'Polygon', coordinates: [buildGeoCircleRing(acnX, acnY, covKm * 1000, 64)] },
              properties: { covKm },
            },
          ]
        : [];

    const visRfLos = mapLayerRegistry.getEffectiveVisibility('rf.losAnalysis', mapCtx);
    const visRfFresnel = mapLayerRegistry.getEffectiveVisibility('rf.fresnelZone', mapCtx);
    const visRfObstructions = mapLayerRegistry.getEffectiveVisibility('rf.obstructionPoints', mapCtx);
    const rfProfileSource = isHist
      ? state.bridgeHistRfRec?.profile ?? null
      : state.latestTelemetry.selected_node_fresnel?.profile ?? null;
    const rfOverlay =
      visRfLos || visRfFresnel || visRfObstructions
        ? computeRfOverlayGeometry(rfProfileSource, {
            expectedNodeId: state.selectedNodeId >= 0 ? state.selectedNodeId : null,
          })
        : null;
    const rfGeoJson = buildRfOverlayGeoJson(rfOverlay, mapLibreCoordinate, {
      showLos: visRfLos,
      showFresnel: visRfFresnel,
      showObstructions: visRfObstructions,
      fresnelOpacity: mapLayerRegistry.getLayerOpacity('rf.fresnelZone'),
    });

    setMapLibreSourceData('maplibre-acn', { type: 'FeatureCollection', features: [acnFeature] }, false);
    setMapLibreSourceData(
      'maplibre-acn-vector',
      { type: 'FeatureCollection', features: acnVectorFeatures },
      false
    );
    setMapLibreSourceData(
      'maplibre-acn-sectors',
      { type: 'FeatureCollection', features: acnSectorFeatures },
      false
    );
    setMapLibreSourceData('maplibre-nodes', { type: 'FeatureCollection', features: nodeFeatures }, false);
    setMapLibreSourceData('maplibre-links', { type: 'FeatureCollection', features: linkFeatures }, false);
    setMapLibreSourceData(
      'maplibre-transmissions',
      { type: 'FeatureCollection', features: transmissionFeatures },
      false
    );
    setMapLibreSourceData(
      'maplibre-planned',
      plannedCoordinates.length >= 2
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: plannedCoordinates }, properties: {} }],
          }
        : emptyFeatureCollection(),
      true
    );
    setMapLibreSourceData(
      'maplibre-travelled',
      state.mapLibreTravelledPath.length >= 2
        ? {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', geometry: { type: 'LineString', coordinates: state.mapLibreTravelledPath }, properties: {} },
            ],
          }
        : emptyFeatureCollection(),
      false
    );
    setMapLibreSourceData(
      'maplibre-waypoints',
      { type: 'FeatureCollection', features: waypointFeatures },
      true
    );
    setMapLibreSourceData('maplibre-regions', { type: 'FeatureCollection', features: regionFeatures }, true);
    setMapLibreSourceData(
      'maplibre-obstacles',
      { type: 'FeatureCollection', features: obstacleFeatures },
      true
    );
    setMapLibreSourceData(
      'maplibre-coverage',
      { type: 'FeatureCollection', features: coverageFeatures },
      true
    );
    setMapLibreSourceData('maplibre-rf-analysis', rfGeoJson, true);
    updateMapLibreToolSources();
    applyMapLibreLayerState();
  }

  function fitMapLibreToTerrain() {
    if (state.activeTerrainBounds) window.centerMapOnTerrain(state.activeTerrainBounds);
  }

  function registerTacticalMapLibreImages(map) {
    if (!map) return;

    // 1. ACN Tactical Chevron Marker (size 11, outer keyline 3px, amber body, center dot, registration ring, heading arrow)
    if (!map.hasImage('acn-tactical-marker')) {
      const acnCvs = document.createElement('canvas');
      acnCvs.width = 64;
      acnCvs.height = 64;
      const ctxAcn = acnCvs.getContext('2d');
      if (ctxAcn) {
        const cx = 32,
          cy = 32,
          size = 11;

        ctxAcn.beginPath();
        ctxAcn.arc(cx, cy, size + 5, 0, Math.PI * 2);
        ctxAcn.strokeStyle = 'rgba(224, 159, 62, 0.55)';
        ctxAcn.lineWidth = 1;
        ctxAcn.setLineDash([2, 3]);
        ctxAcn.stroke();
        ctxAcn.setLineDash([]);

        const noseY = cy - size * 0.9;
        const tipY = noseY - 13;
        ctxAcn.beginPath();
        ctxAcn.moveTo(cx, noseY);
        ctxAcn.lineTo(cx, tipY);
        ctxAcn.strokeStyle = HIGHLAND_THEME.cartography.routeKeyline;
        ctxAcn.lineWidth = 3;
        ctxAcn.stroke();

        ctxAcn.beginPath();
        ctxAcn.moveTo(cx, noseY);
        ctxAcn.lineTo(cx, tipY);
        ctxAcn.strokeStyle = HIGHLAND_THEME.signal.amberBright;
        ctxAcn.lineWidth = 1;
        ctxAcn.stroke();

        ctxAcn.beginPath();
        ctxAcn.moveTo(cx - 3, tipY + 4);
        ctxAcn.lineTo(cx, tipY);
        ctxAcn.lineTo(cx + 3, tipY + 4);
        ctxAcn.strokeStyle = HIGHLAND_THEME.signal.amberBright;
        ctxAcn.lineWidth = 1.2;
        ctxAcn.stroke();

        const drawDelta = (scale = 1.0) => {
          const s = size * scale;
          ctxAcn.beginPath();
          ctxAcn.moveTo(cx, cy - s);
          ctxAcn.lineTo(cx - s * 0.62, cy + s * 0.72);
          ctxAcn.lineTo(cx - s * 0.16, cy + s * 0.36);
          ctxAcn.lineTo(cx, cy + s * 0.62);
          ctxAcn.lineTo(cx + s * 0.16, cy + s * 0.36);
          ctxAcn.lineTo(cx + s * 0.62, cy + s * 0.72);
          ctxAcn.closePath();
        };

        drawDelta(1.08);
        ctxAcn.strokeStyle = HIGHLAND_THEME.cartography.routeKeyline;
        ctxAcn.lineWidth = 3;
        ctxAcn.stroke();

        drawDelta(1.0);
        ctxAcn.fillStyle = HIGHLAND_THEME.signal.amber;
        ctxAcn.fill();
        ctxAcn.strokeStyle = HIGHLAND_THEME.substrate.void;
        ctxAcn.lineWidth = 1;
        ctxAcn.stroke();

        ctxAcn.beginPath();
        ctxAcn.arc(cx, cy - size * 0.15, 1.2, 0, Math.PI * 2);
        ctxAcn.fillStyle = HIGHLAND_THEME.signal.amberBright;
        ctxAcn.fill();

        map.addImage('acn-tactical-marker', ctxAcn.getImageData(0, 0, 64, 64));
      }
    }

    // 2. MCP Square SDF icon (Command Post terminal, 10x10 square)
    if (!map.hasImage('marker-mcp')) {
      const mcpCvs = document.createElement('canvas');
      mcpCvs.width = 24;
      mcpCvs.height = 24;
      const ctxMcp = mcpCvs.getContext('2d');
      if (ctxMcp) {
        ctxMcp.fillStyle = '#ffffff';
        ctxMcp.fillRect(7, 7, 10, 10);
        map.addImage('marker-mcp', ctxMcp.getImageData(0, 0, 24, 24), { sdf: true });
      }
    }

    // 3. Selection Dashed Ring (circular dashed ring, radius 12.5)
    if (!map.hasImage('selection-ring-dashed')) {
      const selCvs = document.createElement('canvas');
      selCvs.width = 36;
      selCvs.height = 36;
      const ctxSel = selCvs.getContext('2d');
      if (ctxSel) {
        ctxSel.beginPath();
        ctxSel.arc(18, 18, 12.5, 0, Math.PI * 2);
        ctxSel.strokeStyle = 'rgba(242, 239, 233, 0.65)';
        ctxSel.lineWidth = 1.0;
        ctxSel.setLineDash([2, 3]);
        ctxSel.stroke();
        map.addImage('selection-ring-dashed', ctxSel.getImageData(0, 0, 36, 36));
      }
    }

    // 4. Hover Corner Reticles (bs = 9.5, bl = 4.0, stroke #f2efe9)
    if (!map.hasImage('node-hover-reticle')) {
      const retCvs = document.createElement('canvas');
      retCvs.width = 36;
      retCvs.height = 36;
      const ctxRet = retCvs.getContext('2d');
      if (ctxRet) {
        const rx = 18,
          ry = 18,
          bs = 9.5,
          bl = 4.0;
        ctxRet.strokeStyle = HIGHLAND_THEME.text.primary;
        ctxRet.lineWidth = 1.4;

        ctxRet.beginPath();
        ctxRet.moveTo(rx - bs, ry - bs + bl);
        ctxRet.lineTo(rx - bs, ry - bs);
        ctxRet.lineTo(rx - bs + bl, ry - bs);
        ctxRet.stroke();

        ctxRet.beginPath();
        ctxRet.moveTo(rx + bs - bl, ry - bs);
        ctxRet.lineTo(rx + bs, ry - bs);
        ctxRet.lineTo(rx + bs, ry - bs + bl);
        ctxRet.stroke();

        ctxRet.beginPath();
        ctxRet.moveTo(rx - bs, ry + bs - bl);
        ctxRet.lineTo(rx - bs, ry + bs);
        ctxRet.lineTo(rx - bs + bl, ry + bs);
        ctxRet.stroke();

        ctxRet.beginPath();
        ctxRet.moveTo(rx + bs - bl, ry + bs);
        ctxRet.lineTo(rx + bs, ry + bs);
        ctxRet.lineTo(rx + bs, ry + bs - bl);
        ctxRet.stroke();

        map.addImage('node-hover-reticle', ctxRet.getImageData(0, 0, 36, 36));
      }
    }
  }

  async function initializeMapLibre() {
    if (state.mapLibreInstance) return;
    if (mapLibreInitPromise) return mapLibreInitPromise;

    mapLibreInitPromise = (async () => {
      try {
        const {
          MapLibreMap,
          setWorkerUrl,
          mapLibreWorkerUrl,
          MapController,
          buildOfflineSafeMapStyle,
        } = await actions.loadMapLibreDependencies();

        // Post-await guard: do not create WebGL map if user switched back to Radar or 3D
        if (state.terrainMapMode !== 'maplibre' || state.stageViewMode !== '2d' || state.mapLibreInstance) {
          return;
        }

        if (!state.mapController) {
          state.mapController = new MapController(null, state.activeBiomeId);
          window.mapController = state.mapController;
        } else {
          state.mapController.setBiome(state.activeBiomeId);
        }

        const notice = $('map-renderer-notice');
        const rasterConfig = window.__xbandMapLibreRaster || {};
        const configuredTiles =
          rasterConfig.tiles || window.__xbandMapLibreRasterTileUrl || DEFAULT_WORLD_SATELLITE_TILE_URL;
        const rasterTiles = Array.isArray(configuredTiles) ? configuredTiles : [configuredTiles];
        const rasterAttribution =
          rasterConfig.attribution ||
          window.__xbandMapLibreRasterAttribution ||
          DEFAULT_WORLD_SATELLITE_ATTRIBUTION;
        const rasterMaxZoom = Number.isFinite(Number(rasterConfig.maxzoom))
          ? Number(rasterConfig.maxzoom)
          : 19;
        const airGap = getAirGapOfflineOnly();
        const mapStyle = buildOfflineSafeMapStyle({
          airGapOfflineOnly: airGap,
          rasterTiles,
          attribution: rasterAttribution,
          maxzoom: rasterMaxZoom,
        });
        const originGeo = state.mapController.getOrigin();

        setWorkerUrl(mapLibreWorkerUrl);
        state.mapLibreInstance = new MapLibreMap({
          container: 'maplibre-map',
          style: mapStyle,
          center: [originGeo.lonDeg, originGeo.latDeg],
          zoom: 6,
          minZoom: 0,
          attributionControl: { compact: true },
          cooperativeGestures: false,
        });
        state.mapController.setMapInstance(state.mapLibreInstance);
        requestAnimationFrame(() => {
          const attribEl = document.querySelector('#maplibre-map .maplibregl-ctrl-attrib');
          if (attribEl) {
            attribEl.classList.add('maplibregl-compact');
            attribEl.classList.remove('maplibregl-compact-show');
          }
        });
        const showOfflineMapLibreNotice = () => {
          state.mapLibreErrorShown = true;
          if (notice) {
            notice.textContent = airGap
              ? 'Air-gap mode: external map tiles blocked — using offline tactical fallback & local SRTM DEM'
              : 'Offline / tile fetch blocked — using local SRTM DEM fallback';
            notice.hidden = false;
          }
        };
        if (
          (airGap && rasterTiles.every(t => isExternalHttpUrl(t))) ||
          (typeof navigator !== 'undefined' && navigator.onLine === false)
        ) {
          showOfflineMapLibreNotice();
        }
        if (state.boundMapLibreOfflineHandler) {
          window.removeEventListener('offline', state.boundMapLibreOfflineHandler);
        }
        state.boundMapLibreOfflineHandler = showOfflineMapLibreNotice;
        window.addEventListener('offline', state.boundMapLibreOfflineHandler);
        state.mapLibreInstance.on('error', event => {
          if (state.mapLibreErrorShown) return;
          showOfflineMapLibreNotice();
          console.error('MapLibre map error', event.error || event);
        });
        state.mapLibreInstance.on('move', () => {
          if (state.terrainMapMode === 'maplibre') actions.drawRadar();
        });
        state.mapLibreInstance.on('moveend', event => {
          if (event?.originalEvent) {
            activeMapSyncToken = 0;
            if (activeMapSyncTimer !== null) {
              clearTimeout(activeMapSyncTimer);
              activeMapSyncTimer = null;
            }
            syncRadarStateFromMapLibreCamera();
            return;
          }
          if (activeMapSyncToken !== 0) {
            if (!state.mapLibreInstance.isMoving()) {
              activeMapSyncToken = 0;
              if (activeMapSyncTimer !== null) {
                clearTimeout(activeMapSyncTimer);
                activeMapSyncTimer = null;
              }
            }
            return;
          }
          syncRadarStateFromMapLibreCamera();
        });
        state.mapLibreInstance.on('style.load', () => {
          if (state.mapLibreInitialized) return;
          state.mapLibreInitialized = true;
          mapLibreSourceHashes.clear();
          if (notice && !state.mapLibreErrorShown) {
            notice.hidden = true;
            notice.textContent = '';
          }
          ensureMapLibreTerrainLayer();
          const sourceDefinitions = {
            'maplibre-acn': emptyFeatureCollection(),
            'maplibre-acn-vector': emptyFeatureCollection(),
            'maplibre-acn-sectors': emptyFeatureCollection(),
            'maplibre-nodes': emptyFeatureCollection(),
            'maplibre-links': emptyFeatureCollection(),
            'maplibre-transmissions': emptyFeatureCollection(),
            'maplibre-planned': emptyFeatureCollection(),
            'maplibre-travelled': emptyFeatureCollection(),
            'maplibre-waypoints': emptyFeatureCollection(),
            'maplibre-regions': emptyFeatureCollection(),
            'maplibre-measurement': emptyFeatureCollection(),
            'maplibre-region-draft': emptyFeatureCollection(),
            'maplibre-obstacles': emptyFeatureCollection(),
            'maplibre-coverage': emptyFeatureCollection(),
            'maplibre-rf-analysis': emptyFeatureCollection(),
            'maplibre-transect-segments': emptyFeatureCollection(),
            'maplibre-transect-markers': emptyFeatureCollection(),
          };
          Object.entries(sourceDefinitions).forEach(([id, data]) =>
            state.mapLibreInstance.addSource(id, { type: 'geojson', data })
          );
          state.mapLibreInstance.addSource('maplibre-probe-viewshed', {
            type: 'image',
            url: TRANSPARENT_1X1_PNG,
            coordinates: [
              [76.0, 35.0],
              [77.0, 35.0],
              [77.0, 34.0],
              [76.0, 34.0],
            ],
          });
          state.mapLibreInstance.addSource('maplibre-bridge-heatmap', {
            type: 'image',
            url: TRANSPARENT_1X1_PNG,
            coordinates: [
              [76.0, 35.0],
              [77.0, 35.0],
              [77.0, 34.0],
              [76.0, 34.0],
            ],
          });

          // Register tactical procedural canvas images on MapLibre
          registerTacticalMapLibreImages(state.mapLibreInstance);

          // 1. Engineering Overlays
          state.mapLibreInstance.addLayer({
            id: 'maplibre-probe-viewshed-layer',
            type: 'raster',
            source: 'maplibre-probe-viewshed',
            layout: { visibility: 'none' },
            paint: { 'raster-opacity': 0.72, 'raster-resampling': 'linear' },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-bridge-heatmap-layer',
            type: 'raster',
            source: 'maplibre-bridge-heatmap',
            layout: { visibility: 'none' },
            paint: { 'raster-opacity': 0.85, 'raster-resampling': 'nearest' },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-coverage-fill',
            type: 'fill',
            source: 'maplibre-coverage',
            paint: { 'fill-color': HIGHLAND_THEME.signal.amber, 'fill-opacity': 0.08 },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-coverage-line',
            type: 'line',
            source: 'maplibre-coverage',
            paint: {
              'line-color': HIGHLAND_THEME.signal.amber,
              'line-width': 1.5,
              'line-dasharray': [4, 4],
              'line-opacity': 0.45,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-obstacles-fill',
            type: 'fill',
            source: 'maplibre-obstacles',
            paint: {
              'fill-color': [
                'case',
                ['==', ['get', 'selected'], 1],
                'rgba(233, 196, 106, 0.22)',
                ['==', ['get', 'isDraftChanged'], 1],
                'rgba(233, 196, 106, 0.10)',
                'rgba(217, 119, 54, 0.18)',
              ],
              'fill-opacity': 0.9,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-obstacles-line',
            type: 'line',
            source: 'maplibre-obstacles',
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'selected'], 1],
                HIGHLAND_THEME.signal.ochre,
                ['==', ['get', 'isDraftChanged'], 1],
                HIGHLAND_THEME.signal.ochreStrokeSoft,
                HIGHLAND_THEME.signal.copper,
              ],
              'line-width': [
                'case',
                ['==', ['get', 'selected'], 1],
                2.4,
                ['==', ['get', 'isDraftChanged'], 1],
                1.6,
                1.2,
              ],
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-rf-fresnel-fill',
            type: 'fill',
            source: 'maplibre-rf-analysis',
            filter: ['==', ['get', 'layerKind'], 'fresnel'],
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-rf-fresnel-line',
            type: 'line',
            source: 'maplibre-rf-analysis',
            filter: ['==', ['get', 'layerKind'], 'fresnel'],
            paint: {
              'line-color': ['get', 'color'],
              'line-width': 1.4,
              'line-dasharray': [4, 3],
              'line-opacity': 0.7,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-rf-los-line',
            type: 'line',
            source: 'maplibre-rf-analysis',
            filter: ['==', ['get', 'layerKind'], 'los'],
            paint: { 'line-color': ['get', 'color'], 'line-width': 2.6, 'line-opacity': 0.95 },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-rf-obstacle-hits',
            type: 'line',
            source: 'maplibre-rf-analysis',
            filter: ['==', ['get', 'layerKind'], 'obstacle-hit'],
            paint: { 'line-color': HIGHLAND_THEME.signal.copper, 'line-width': 4.2, 'line-opacity': 0.95 },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-rf-crest-point',
            type: 'circle',
            source: 'maplibre-rf-analysis',
            filter: ['==', ['get', 'layerKind'], 'crest'],
            paint: {
              'circle-radius': 6,
              'circle-color': ['get', 'color'],
              'circle-stroke-color': HIGHLAND_THEME.substrate.void,
              'circle-stroke-width': 2,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-regions-fill',
            type: 'fill',
            source: 'maplibre-regions',
            paint: {
              'fill-color': ['get', 'color'],
              'fill-opacity': ['case', ['==', ['get', 'visible'], 1], 0.18, 0],
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-regions-line',
            type: 'line',
            source: 'maplibre-regions',
            paint: {
              'line-color': ['get', 'color'],
              'line-width': 2,
              'line-opacity': ['case', ['==', ['get', 'visible'], 1], 1, 0],
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-measurement-line',
            type: 'line',
            source: 'maplibre-measurement',
            paint: { 'line-color': HIGHLAND_THEME.text.primary, 'line-width': 3, 'line-dasharray': [1, 1] },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-region-draft-line',
            type: 'line',
            source: 'maplibre-region-draft',
            paint: { 'line-color': HIGHLAND_THEME.signal.ochre, 'line-width': 2, 'line-dasharray': [1, 1] },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-transect-segments-line',
            type: 'line',
            source: 'maplibre-transect-segments',
            paint: { 'line-color': ['get', 'color'], 'line-width': 3.0, 'line-opacity': 0.95 },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-transect-bridge-legs',
            type: 'line',
            source: 'maplibre-transect-markers',
            filter: ['==', ['get', 'kind'], 'bridge-leg'],
            paint: {
              'line-color': HIGHLAND_THEME.signal.amberBright,
              'line-width': 2.2,
              'line-dasharray': [4, 3],
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-transect-markers-circle',
            type: 'circle',
            source: 'maplibre-transect-markers',
            filter: ['!=', ['get', 'kind'], 'bridge-leg'],
            paint: {
              'circle-radius': ['case', ['==', ['get', 'kind'], 'hover'], 6, 5],
              'circle-color': ['get', 'color'],
              'circle-stroke-color': HIGHLAND_THEME.substrate.void,
              'circle-stroke-width': 1.5,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-transect-markers-label',
            type: 'symbol',
            source: 'maplibre-transect-markers',
            filter: ['!=', ['get', 'kind'], 'bridge-leg'],
            layout: {
              'text-field': ['get', 'label'],
              'text-size': 9.5,
              'text-offset': [0, -1.2],
              'text-anchor': 'bottom',
              'text-allow-overlap': true,
            },
            paint: {
              'text-color': HIGHLAND_THEME.text.primary,
              'text-halo-color': HIGHLAND_THEME.substrate.void,
              'text-halo-width': 1.8,
            },
          });

          // 2. Trajectory & Waypoints
          state.mapLibreInstance.addLayer({
            id: 'maplibre-planned-casing',
            type: 'line',
            source: 'maplibre-planned',
            paint: { 'line-color': HIGHLAND_THEME.cartography.routeKeyline, 'line-width': 3.5, 'line-opacity': 0.95 },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-planned-line',
            type: 'line',
            source: 'maplibre-planned',
            paint: { 'line-color': HIGHLAND_THEME.cartography.routeCore, 'line-width': 1.8, 'line-opacity': 0.95 },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-travelled-casing',
            type: 'line',
            source: 'maplibre-travelled',
            paint: { 'line-color': HIGHLAND_THEME.cartography.routeKeyline, 'line-width': 4.0, 'line-opacity': 0.8 },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-travelled-line',
            type: 'line',
            source: 'maplibre-travelled',
            paint: { 'line-color': HIGHLAND_THEME.cartography.routeCore, 'line-width': 2.2, 'line-opacity': 0.95 },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-waypoints-outer',
            type: 'circle',
            source: 'maplibre-waypoints',
            paint: {
              'circle-radius': 5.5,
              'circle-color': HIGHLAND_THEME.substrate.void,
              'circle-stroke-color': HIGHLAND_THEME.signal.amber,
              'circle-stroke-width': 1.2,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-waypoints-dot',
            type: 'circle',
            source: 'maplibre-waypoints',
            paint: { 'circle-radius': 1.8, 'circle-color': HIGHLAND_THEME.signal.amberBright },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-waypoints-selected',
            type: 'circle',
            source: 'maplibre-waypoints',
            filter: ['==', ['get', 'selected'], 1],
            paint: {
              'circle-radius': 9.5,
              'circle-color': 'transparent',
              'circle-stroke-color': HIGHLAND_THEME.signal.amberBright,
              'circle-stroke-width': 1.2,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-waypoints-label',
            type: 'symbol',
            source: 'maplibre-waypoints',
            layout: { 'text-field': ['get', 'label'], 'text-size': 9.5, 'text-offset': [0.9, -0.6], 'text-anchor': 'left' },
            paint: {
              'text-color': HIGHLAND_THEME.signal.amberBright,
              'text-halo-color': 'rgba(17, 19, 22, 0.95)',
              'text-halo-width': 2,
            },
          });

          // 3. Communication Links
          const linkPaint = {
            'line-color': [
              'case',
              ['==', ['get', 'hovered'], 1],
              HIGHLAND_THEME.text.primary,
              ['==', ['get', 'selected'], 1],
              ['get', 'selectedColor'],
              ['get', 'color'],
            ],
            'line-width': ['case', ['==', ['get', 'selected'], 1], 3.5, ['==', ['get', 'hovered'], 1], 3.2, 2.0],
            'line-opacity': ['case', ['==', ['get', 'selected'], 1], 0.95, ['==', ['get', 'hovered'], 1], 0.9, 0.75],
          };
          const selectableLinkLayers = [
            'maplibre-links-line',
            'maplibre-links-degraded',
            'maplibre-links-terrain-blocked',
            'maplibre-links-obstacle-blocked',
            'maplibre-links-outage',
            'maplibre-links-unknown',
          ];
          state.mapLibreInstance.addLayer({
            id: 'maplibre-links-selected-casing',
            type: 'line',
            source: 'maplibre-links',
            filter: ['==', ['get', 'selected'], 1],
            paint: { 'line-color': HIGHLAND_THEME.substrate.void, 'line-width': 5.5, 'line-opacity': 0.85 },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-links-line',
            type: 'line',
            source: 'maplibre-links',
            filter: ['==', ['get', 'status'], 'CONNECTED'],
            paint: linkPaint,
          });
          [
            ['maplibre-links-degraded', 'DEGRADED', [7, 3]],
            ['maplibre-links-terrain-blocked', 'BLOCKED_TERRAIN', [4, 4]],
            ['maplibre-links-obstacle-blocked', 'BLOCKED_OBSTACLE', [2, 3]],
            ['maplibre-links-outage', 'OUTAGE_DISCONNECTED', [3, 6]],
            ['maplibre-links-unknown', 'UNKNOWN', [1, 5]],
          ].forEach(([id, status, dash]) =>
            state.mapLibreInstance.addLayer({
              id,
              type: 'line',
              source: 'maplibre-links',
              filter: ['==', ['get', 'status'], status],
              paint: { ...linkPaint, 'line-dasharray': dash },
            })
          );

          // 4. Dynamic TDMA In-Flight Transmission Bursts / Packets
          state.mapLibreInstance.addLayer({
            id: 'maplibre-transmissions-glow',
            type: 'circle',
            source: 'maplibre-transmissions',
            paint: { 'circle-radius': 4.5, 'circle-color': ['get', 'color'], 'circle-blur': 0.4, 'circle-opacity': 0.7 },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-transmissions-core',
            type: 'circle',
            source: 'maplibre-transmissions',
            paint: { 'circle-radius': 2.5, 'circle-color': '#ffffff', 'circle-opacity': 0.95 },
          });

          // 5. Ground Terminals
          const nodeStrokeColor = [
            'case',
            ['==', ['get', 'selected'], 1],
            '#ffffff',
            ['==', ['get', 'hovered'], 1],
            HIGHLAND_THEME.text.primary,
            ['==', ['get', 'rfOutage'], 1],
            HIGHLAND_THEME.signal.vermilion,
            ['any', ['==', ['get', 'registrationState'], 'LOST'], ['==', ['get', 'registrationState'], 'REJECTED']],
            HIGHLAND_THEME.signal.ochre,
            ['==', ['get', 'registrationState'], 'REGISTERED'],
            HIGHLAND_THEME.signal.sage,
            HIGHLAND_THEME.substrate.void,
          ];
          const nodeStrokeWidth = ['case', ['==', ['get', 'selected'], 1], 2.2, ['==', ['get', 'hovered'], 1], 1.8, 1.3];

          state.mapLibreInstance.addLayer({
            id: 'maplibre-nodes-selection-inner',
            type: 'circle',
            source: 'maplibre-nodes',
            filter: ['==', ['get', 'selected'], 1],
            paint: {
              'circle-radius': 9,
              'circle-color': 'transparent',
              'circle-stroke-color': ['get', 'selectedColor'],
              'circle-stroke-width': 1.4,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-nodes-selection-outer',
            type: 'symbol',
            source: 'maplibre-nodes',
            filter: ['==', ['get', 'selected'], 1],
            layout: { 'icon-image': 'selection-ring-dashed', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-nodes-hover-reticle',
            type: 'symbol',
            source: 'maplibre-nodes',
            filter: ['==', ['get', 'hovered'], 1],
            layout: { 'icon-image': 'node-hover-reticle', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-nodes-circle',
            type: 'circle',
            source: 'maplibre-nodes',
            filter: ['!=', ['get', 'isMCP'], 1],
            paint: {
              'circle-radius': 4.5,
              'circle-color': ['get', 'color'],
              'circle-stroke-color': nodeStrokeColor,
              'circle-stroke-width': nodeStrokeWidth,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-nodes-mcp',
            type: 'symbol',
            source: 'maplibre-nodes',
            filter: ['==', ['get', 'isMCP'], 1],
            layout: { 'icon-image': 'marker-mcp', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
            paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': nodeStrokeColor, 'icon-halo-width': nodeStrokeWidth },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-labels',
            type: 'symbol',
            source: 'maplibre-nodes',
            filter: ['all', ['!=', ['get', 'selected'], 1], ['!=', ['get', 'hovered'], 1]],
            layout: {
              'text-field': ['get', 'label'],
              'text-size': 9.5,
              'text-offset': [0, 1.3],
              'text-anchor': 'top',
              'text-allow-overlap': false,
            },
            paint: {
              'text-color': 'rgba(242, 239, 233, 0.90)',
              'text-halo-color': 'rgba(17, 19, 22, 0.95)',
              'text-halo-width': 2.0,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-labels-active',
            type: 'symbol',
            source: 'maplibre-nodes',
            filter: ['any', ['==', ['get', 'selected'], 1], ['==', ['get', 'hovered'], 1]],
            layout: {
              'text-field': ['get', 'label'],
              'text-size': 9.5,
              'text-offset': [0, 1.3],
              'text-anchor': 'top',
              'text-allow-overlap': true,
            },
            paint: {
              'text-color': [
                'case',
                ['==', ['get', 'selected'], 1],
                HIGHLAND_THEME.signal.amberBright,
                HIGHLAND_THEME.text.primary,
              ],
              'text-halo-color': 'rgba(17, 19, 22, 0.95)',
              'text-halo-width': 2.0,
            },
          });

          // 6. ACN Airborne Relay
          state.mapLibreInstance.addLayer({
            id: 'maplibre-acn-vector-line',
            type: 'line',
            source: 'maplibre-acn-vector',
            paint: {
              'line-color': HIGHLAND_THEME.signal.amberStrokeSoft,
              'line-width': 1.2,
              'line-dasharray': [4, 4],
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-acn-vector-tag',
            type: 'symbol',
            source: 'maplibre-acn-vector',
            layout: { 'text-field': '+30s', 'text-size': 9, 'text-anchor': 'left', 'text-offset': [0.6, 0] },
            paint: {
              'text-color': HIGHLAND_THEME.signal.amber,
              'text-halo-color': HIGHLAND_THEME.substrate.void,
              'text-halo-width': 1,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-acn-sectors-crossover',
            type: 'line',
            source: 'maplibre-acn-sectors',
            filter: ['==', ['get', 'type'], 'boundary'],
            paint: { 'line-color': 'rgba(224, 159, 62, 0.35)', 'line-width': 1.2, 'line-dasharray': [3, 3] },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-acn-sectors-boresight',
            type: 'line',
            source: 'maplibre-acn-sectors',
            filter: ['==', ['get', 'type'], 'boresight'],
            paint: { 'line-color': 'rgba(224, 159, 62, 0.65)', 'line-width': 1.5 },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-acn-sectors-label',
            type: 'symbol',
            source: 'maplibre-acn-sectors',
            filter: ['==', ['get', 'type'], 'label'],
            layout: { 'text-field': ['get', 'label'], 'text-size': 10, 'text-allow-overlap': true },
            paint: {
              'text-color': HIGHLAND_THEME.signal.amberBright,
              'text-halo-color': 'rgba(17, 19, 22, 0.95)',
              'text-halo-width': 2.0,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-acn-marker',
            type: 'symbol',
            source: 'maplibre-acn',
            layout: {
              'icon-image': 'acn-tactical-marker',
              'icon-rotate': ['get', 'headingDeg'],
              'icon-rotation-alignment': 'map',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
          });
          state.mapLibreInstance.addLayer({
            id: 'maplibre-acn-label',
            type: 'symbol',
            source: 'maplibre-acn',
            layout: {
              'text-field': ['get', 'badgeText'],
              'text-size': 9.5,
              'text-offset': [0, 2.0],
              'text-anchor': 'top',
            },
            paint: {
              'text-color': HIGHLAND_THEME.signal.amberBright,
              'text-halo-color': 'rgba(17, 19, 22, 0.95)',
              'text-halo-width': 2.5,
            },
          });

          const interactiveNodeLayers = ['maplibre-nodes-circle', 'maplibre-nodes-mcp'];
          interactiveNodeLayers.forEach(layerId => {
            state.mapLibreInstance.on('mousedown', layerId, event => {
              const feature = event.features?.[0];
              const nodeId = Number(feature?.properties?.nodeId);
              if (!Number.isInteger(nodeId)) return;
              if (
                historyController.isInspecting ||
                state.terrainToolMode !== 'idle' ||
                obstacleEditor.mode !== 'navigate' ||
                trajectoryEditor.activeMode === 'waypoints'
              )
                return;
              actions.handleNodeSelection(nodeId);
              if (
                state.spatialLocked ||
                (state.simTimelineController && state.simTimelineController.isHistoricalInspecting)
              )
                return;
              event.preventDefault();
              const dragPanWasEnabled = state.mapLibreInstance.dragPan.isEnabled();
              if (dragPanWasEnabled) state.mapLibreInstance.dragPan.disable();
              state.mapLibreNodeDrag = {
                nodeId,
                startPoint: { x: event.point.x, y: event.point.y },
                local: null,
                dragPanWasEnabled,
                lastSentAt: 0,
                moved: false,
              };
              updateMapLibreCursor(event.point);
            });
            state.mapLibreInstance.on('mousemove', layerId, event => {
              if (state.mapLibreNodeDrag || state.mapLibreObstacleDrag) return;
              const id = Number(event.features?.[0]?.properties?.nodeId);
              if (Number.isInteger(id))
                actions.setSharedMapHover('maplibre', 'node', id, { x: event.point.x, y: event.point.y });
            });
            state.mapLibreInstance.on('mouseleave', layerId, () => {
              if (state.activeMapHoverRenderer === 'maplibre' && state.hoveredNodeId !== null) {
                state.hoveredNodeId = null;
                state.mapHoverPoint = null;
                state.activeMapHoverRenderer = null;
                const tip = $('map-node-tooltip');
                if (tip) tip.style.display = 'none';
                updateMapLibreOverlay();
              }
            });
          });

          state.mapLibreInstance.on('mousedown', event => {
            if (
              state.terrainToolMode === 'idle' &&
              state.tbActiveMode === 'transect' &&
              state.tbTransectWaypoints.length > 0 &&
              mapLayerRegistry.getEffectiveVisibility('eng.measurements', actions.getContextualMapContext())
            ) {
              let bestIdx = -1;
              let bestPx = 12;
              state.tbTransectWaypoints.forEach((wp, idx) => {
                const proj = state.mapLibreInstance.project(mapLibreCoordinate(wp.xM, wp.yM));
                const d = Math.hypot(event.point.x - proj.x, event.point.y - proj.y);
                if (d <= bestPx) {
                  bestPx = d;
                  bestIdx = idx;
                }
              });
              if (bestIdx >= 0) {
                event.preventDefault();
                const dragPanWasEnabled = state.mapLibreInstance.dragPan.isEnabled();
                if (dragPanWasEnabled) state.mapLibreInstance.dragPan.disable();
                state.mapLibreToolboxVertexDrag = { index: bestIdx, dragPanWasEnabled, moved: false };
                state.mapLibreInstance.getCanvas().style.cursor = 'grabbing';
                return;
              }
            }
            if (state.terrainToolMode !== 'idle' || obstacleEditor.mode !== 'select' || state.mapLibreNodeDrag) return;
            if (
              state.spatialLocked ||
              historyController.isInspecting ||
              (state.simTimelineController && state.simTimelineController.isHistoricalInspecting)
            )
              return;
            const obsId = findMapLibreObstacleIdAtPoint(event.point, 12);
            if (typeof obsId !== 'string' || !obsId) return;
            event.preventDefault();
            obstacleEditor.select(obsId);
            actions.refreshObstacleEditor();
            const dragPanWasEnabled = state.mapLibreInstance.dragPan.isEnabled();
            if (dragPanWasEnabled) state.mapLibreInstance.dragPan.disable();
            state.mapLibreObstacleDrag = {
              obstacleId: obsId,
              startPoint: { x: event.point.x, y: event.point.y },
              dragPanWasEnabled,
              moved: false,
            };
            updateMapLibreCursor(event.point);
          });

          state.mapLibreInstance.on('mousemove', event => {
            const coordinate = state.mapLibreInstance.unproject(event.point);
            const local = geodeticToCartesian(coordinate.lat, coordinate.lng);
            actions.updateRadarCursorReadout(local.xM, local.yM, true);
            if (state.mapLibreToolboxVertexDrag) {
              state.mapLibreToolboxVertexDrag.moved = true;
              state.tbTransectWaypoints[state.mapLibreToolboxVertexDrag.index] = {
                xM: local.xM,
                yM: local.yM,
                lng: coordinate.lng,
                lat: coordinate.lat,
              };
              actions.recomputeTransect(true);
              updateMapLibreToolSources();
              return;
            }
            if (
              (state.terrainToolMode === 'transect-2pt' || state.terrainToolMode === 'transect-poly') &&
              state.tbTransectWaypoints.length >= 1
            ) {
              state.tbRubberBandPoint = { x: local.xM, y: local.yM, lng: coordinate.lng, lat: coordinate.lat };
              actions.recomputeRubberBandPreview(state.tbRubberBandPoint);
              updateMapLibreToolSources();
            } else if (
              state.terrainToolMode === 'idle' &&
              state.tbActiveMode === 'transect' &&
              state.tbTransectResult?.samples.length
            ) {
              const nearestIdx = actions.findNearestTransectSampleIndex(
                local.xM,
                local.yM,
                state.currentRadarRangeM * 0.03
              );
              if (nearestIdx !== state.tbHoveredSampleIdx) {
                state.tbHoveredSampleIdx = nearestIdx;
                actions.updateToolboxTransectHoverUi();
                updateMapLibreToolSources();
              }
            } else if (state.terrainToolMode === 'probe' || (state.tbActiveMode === 'probe' && !state.tbProbeSite)) {
              const mastM = Math.max(
                1,
                Math.min(200, parseFloat($('tb-probe-mast-input')?.value || $('tb-probe-agl')?.value || '2') || 2)
              );
              const simCtx = actions.buildToolboxSimContext();
              const acnPos = simCtx.acnPositionMslM || [0, 0, 5000];
              const acnHeading = Number.isFinite(state.latestTelemetry?.acn_heading_deg)
                ? state.latestTelemetry.acn_heading_deg
                : Number.isFinite(state.latestTelemetry?.acn_telemetry?.heading_rad)
                  ? (((state.latestTelemetry.acn_telemetry.heading_rad * 180) / Math.PI) % 360 + 360) % 360
                  : 0;

              state.tbCursorProbeLive = evaluateCursorRfProbe(
                { xM: local.xM, yM: local.yM },
                mastM,
                acnPos,
                acnHeading,
                (x, y) => sampleDemSafe(simCtx.terrainEngine, x, y).elevationM || 3500,
                state.tbProbePinnedP1
              );
              actions.updateProbeUiReadouts(state.tbCursorProbeLive);
              updateMapLibreOverlay();
            }
            if (state.mapLibreNodeDrag) {
              if (
                !state.mapLibreNodeDrag.moved &&
                Math.hypot(
                  event.point.x - state.mapLibreNodeDrag.startPoint.x,
                  event.point.y - state.mapLibreNodeDrag.startPoint.y
                ) >= 3
              ) {
                state.mapLibreNodeDrag.moved = true;
              }
              if (state.mapLibreNodeDrag.moved) {
                state.mapLibreNodeDrag.local = { xM: local.xM, yM: local.yM };
                updateMapLibreOverlay();
                const now = performance.now();
                if (now - state.mapLibreNodeDrag.lastSentAt >= 40) {
                  actions.sendCommand({
                    type: 'NODE_MOVE',
                    node_id: state.mapLibreNodeDrag.nodeId,
                    x_m: local.xM,
                    y_m: local.yM,
                  });
                  state.mapLibreNodeDrag.lastSentAt = now;
                }
              }
              updateMapLibreCursor(event.point);
              return;
            }
            if (state.mapLibreObstacleDrag) {
              if (
                !state.mapLibreObstacleDrag.moved &&
                Math.hypot(
                  event.point.x - state.mapLibreObstacleDrag.startPoint.x,
                  event.point.y - state.mapLibreObstacleDrag.startPoint.y
                ) >= 3
              ) {
                state.mapLibreObstacleDrag.moved = true;
              }
              if (state.mapLibreObstacleDrag.moved) {
                try {
                  obstacleEditor.move(state.mapLibreObstacleDrag.obstacleId, local.xM, local.yM);
                  actions.refreshObstacleEditor();
                } catch (error) {
                  obstacleEditor.message = error.message;
                  actions.refreshObstacleEditor();
                }
              }
              updateMapLibreCursor(event.point);
              return;
            }
            updateMapLibreCursor(event.point);
          });

          state.mapLibreInstance.on('mouseout', () => {
            actions.updateRadarCursorReadout(0, 0, false);
          });

          const finishMapLibreDrag = () => {
            if (state.mapLibreToolboxVertexDrag) {
              const tvDrag = state.mapLibreToolboxVertexDrag;
              state.mapLibreToolboxVertexDrag = null;
              if (tvDrag.dragPanWasEnabled) state.mapLibreInstance?.dragPan.enable();
              if (tvDrag.moved) {
                state.suppressNextMapLibreClick = true;
                setTimeout(() => {
                  state.suppressNextMapLibreClick = false;
                }, 0);
                actions.recomputeTransect(false);
                updateMapLibreToolSources();
              }
              updateMapLibreCursor();
            }
            if (state.mapLibreNodeDrag) {
              const drag = state.mapLibreNodeDrag;
              if (
                drag.moved &&
                drag.local &&
                !state.spatialLocked &&
                (!state.simTimelineController || !state.simTimelineController.isHistoricalInspecting)
              ) {
                actions.sendCommand({
                  type: 'NODE_MOVE',
                  node_id: drag.nodeId,
                  x_m: drag.local.xM,
                  y_m: drag.local.yM,
                });
              }
              if (drag.moved) {
                state.suppressNextMapLibreClick = true;
                setTimeout(() => {
                  state.suppressNextMapLibreClick = false;
                }, 0);
              }
              state.mapLibreNodeDrag = null;
              if (drag.dragPanWasEnabled) state.mapLibreInstance?.dragPan.enable();
              updateMapLibreCursor();
              updateMapLibreOverlay();
            }
            if (state.mapLibreObstacleDrag) {
              const obsDrag = state.mapLibreObstacleDrag;
              if (obsDrag.moved) {
                state.suppressNextMapLibreClick = true;
                setTimeout(() => {
                  state.suppressNextMapLibreClick = false;
                }, 0);
              }
              state.mapLibreObstacleDrag = null;
              if (obsDrag.dragPanWasEnabled) state.mapLibreInstance?.dragPan.enable();
              updateMapLibreCursor();
              updateMapLibreOverlay();
            }
          };
          state.mapLibreInstance.on('mouseup', finishMapLibreDrag);
          if (state.boundMapLibrePointerUp) {
            window.removeEventListener('pointerup', state.boundMapLibrePointerUp);
            window.removeEventListener('pointercancel', state.boundMapLibrePointerUp);
          }
          state.boundMapLibrePointerUp = finishMapLibreDrag;
          window.addEventListener('pointerup', state.boundMapLibrePointerUp);
          window.addEventListener('pointercancel', state.boundMapLibrePointerUp);

          state.mapLibreInstance.on('mousemove', selectableLinkLayers, event => {
            if (state.mapLibreNodeDrag || state.mapLibreObstacleDrag) return;
            if (
              state.mapLibreInstance.getLayer('maplibre-acn-marker') &&
              state.mapLibreInstance.queryRenderedFeatures(
                [
                  [event.point.x - 12, event.point.y - 12],
                  [event.point.x + 12, event.point.y + 12],
                ],
                { layers: ['maplibre-acn-marker'] }
              ).length > 0
            )
              return;
            const id = Number(event.features?.[0]?.properties?.nodeId);
            if (Number.isInteger(id))
              actions.setSharedMapHover('maplibre', 'link', id, { x: event.point.x, y: event.point.y });
          });
          state.mapLibreInstance.on('mouseleave', selectableLinkLayers, () => {
            if (state.activeMapHoverRenderer === 'maplibre' && state.hoveredLinkNodeId !== null) {
              state.hoveredLinkNodeId = null;
              state.mapHoverPoint = null;
              state.activeMapHoverRenderer = null;
              const tip = $('map-node-tooltip');
              if (tip) tip.style.display = 'none';
              updateMapLibreOverlay();
            }
          });

          state.mapLibreInstance.on('click', event => {
            if (state.suppressNextMapLibreClick) {
              state.suppressNextMapLibreClick = false;
              return;
            }
            if (state.terrainToolMode !== 'idle') {
              mapLibreToolClick(event);
              return;
            }
            const isHistEditBlocked = Boolean(
              historyController.isInspecting ||
                (state.simTimelineController && state.simTimelineController.isHistoricalInspecting)
            );
            const coordinate = state.mapLibreInstance.unproject(event.point);
            const local = geodeticToCartesian(coordinate.lat, coordinate.lng);
            if (!Number.isFinite(local.xM) || !Number.isFinite(local.yM)) return;

            if (!state.spatialLocked && trajectoryEditor.activeMode === 'waypoints' && state.waypointPlacementArmed) {
              if (isHistEditBlocked) {
                state.mapLibreInstance.getCanvas().style.cursor = 'not-allowed';
                actions.setTrajectoryMessage('Waypoint placement is disabled during historical playback.', true);
                return;
              }
              actions.addWaypointAt(local.xM, local.yM);
              $('trajectory-place-point')?.classList.remove('active');
              actions.syncRadarHudMode();
              updateMapLibreOverlay();
              return;
            }
            if (obstacleEditor.mode === 'place' && !state.spatialLocked) {
              if (isHistEditBlocked) {
                state.mapLibreInstance.getCanvas().style.cursor = 'not-allowed';
                obstacleEditor.message = 'Obstacle creation is disabled during historical playback.';
                actions.refreshObstacleEditor();
                return;
              }
              actions.createObstacleAt(local.xM, local.yM);
              updateMapLibreOverlay();
              return;
            }
            const mapCtx = actions.getContextualMapContext();
            if (obstacleEditor.mode === 'select') {
              const obsId = findMapLibreObstacleIdAtPoint(event.point, 12);
              if (typeof obsId === 'string' && obsId) {
                obstacleEditor.select(obsId);
                actions.refreshObstacleEditor();
                updateMapLibreOverlay();
              }
              return;
            }
            if (obstacleEditor.mode === 'navigate' && trajectoryEditor.activeMode !== 'waypoints') {
              if (mapLayerRegistry.getEffectiveVisibility('entities.groundNodes', mapCtx)) {
                const activeNodeLayers = ['maplibre-nodes-circle', 'maplibre-nodes-mcp'].filter(id =>
                  state.mapLibreInstance.getLayer(id)
                );
                if (activeNodeLayers.length) {
                  const nodeHits = state.mapLibreInstance.queryRenderedFeatures(event.point, {
                    layers: activeNodeLayers,
                  });
                  const nodeId = Number(nodeHits[0]?.properties?.nodeId);
                  if (Number.isInteger(nodeId)) {
                    actions.handleNodeSelection(nodeId);
                    return;
                  }
                }
              }
              if (mapLayerRegistry.getEffectiveVisibility('entities.acn', mapCtx)) {
                const activeAcnLayers = ['maplibre-acn-marker', 'maplibre-acn-circle'].filter(id =>
                  state.mapLibreInstance.getLayer(id)
                );
                if (activeAcnLayers.length) {
                  const acnHits = state.mapLibreInstance.queryRenderedFeatures(
                    [
                      [event.point.x - 12, event.point.y - 12],
                      [event.point.x + 12, event.point.y + 12],
                    ],
                    { layers: activeAcnLayers }
                  );
                  if (acnHits.length > 0) {
                    actions.handleAcnSelection();
                    return;
                  }
                }
              }
              const activeLinkLayers = selectableLinkLayers.filter(id => state.mapLibreInstance.getLayer(id));
              if (mapLayerRegistry.getEffectiveVisibility('comm.links', mapCtx) && activeLinkLayers.length) {
                const linkHits = state.mapLibreInstance.queryRenderedFeatures(event.point, {
                  layers: activeLinkLayers,
                });
                const id = Number(linkHits[0]?.properties?.nodeId);
                if (Number.isInteger(id)) {
                  actions.handleNodeSelection(id);
                  return;
                }
              }
              if (actions.isNeutralMapSelectionMode()) {
                actions.dismissNodeInspector();
              }
            }
          });

          state.mapLibreInstance.on('dblclick', event => {
            if (state.terrainToolMode === 'transect-poly' && state.tbTransectWaypoints.length >= 2) {
              event.preventDefault();
              actions.finishTransectPolyline();
            } else if (state.terrainToolMode === 'region' && state.terrainRegionDraft.length >= 3) {
              event.preventDefault();
              actions.finishTerrainRegion();
            }
          });

          updateMapLibreOverlay();
          syncMapLibreCameraFromRadarState(0, true);
          requestAnimationFrame(() => {
            const attribEl = document.querySelector('#maplibre-map .maplibregl-ctrl-attrib');
            if (attribEl) {
              attribEl.classList.add('maplibregl-compact');
              attribEl.classList.remove('maplibregl-compact-show');
            }
          });
        });
      } catch (err) {
        console.error('[MapLibre] Failed to initialize lazily:', err);
      } finally {
        mapLibreInitPromise = null;
      }
    })();

    return mapLibreInitPromise;
  }

  function setMapMode(mode) {
    const nextMode = mode === 'maplibre' ? 'maplibre' : 'radar';
    if (state.activeMapHoverRenderer && state.activeMapHoverRenderer !== nextMode) {
      state.hoveredNodeId = null;
      state.hoveredLinkNodeId = null;
      state.activeMapHoverRenderer = null;
      state.mapHoverPoint = null;
      const tip = $('map-node-tooltip');
      if (tip) tip.style.display = 'none';
    }
    state.terrainMapMode = nextMode;
    actions.updateRadarCursorReadout(0, 0, false);
    const radar = $('radar-canvas');
    const map = $('maplibre-stage');
    $('btnMapRadar')?.classList.toggle('active', state.terrainMapMode === 'radar');
    $('btnMapLibre')?.classList.toggle('active', state.terrainMapMode === 'maplibre');
    const backdropSel = $('tb-backdrop-mode');
    if (backdropSel) {
      const isMl = state.terrainMapMode === 'maplibre';
      backdropSel.disabled = isMl;
      backdropSel.title = isMl ? 'Radar only — MapLibre uses geographic basemap' : 'Radar terrain backdrop mode';
    }
    ['zoom-30', 'zoom-60', 'zoom-100', 'zoom-200'].forEach(id => {
      const b = $(id);
      if (b) {
        b.disabled = state.stageViewMode !== '2d' || state.terrainMapMode === 'maplibre';
        b.title = b.disabled ? 'Range zoom — 2D Radar mode only' : 'Range zoom';
      }
    });
    if (state.stageViewMode !== '2d') {
      window.setStageViewMode('2d');
      return;
    }
    actions.syncRadarHudMode();
    actions.syncFloatingOverlayLayout();
    if (state.terrainMapMode === 'maplibre') {
      void initializeMapLibre().then(() => {
        if (state.terrainMapMode === 'maplibre' && state.stageViewMode === '2d' && state.mapLibreInstance) {
          if (state.mapController) state.mapController.setMapInstance(state.mapLibreInstance);
          state.mapLibreInstance.resize();
          updateMapLibreOverlay();
          applyMapLibreLayerState();
          syncMapLibreCameraFromRadarState(0);
          actions.drawRadar();
        }
      });
      if (state.mapLibreInstance && state.mapController) state.mapController.setMapInstance(state.mapLibreInstance);
      if (getAirGapOfflineOnly() || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        const notice = $('map-renderer-notice');
        if (notice) {
          notice.textContent = 'Air-gap mode: external map tiles blocked/offline — switch to Radar / SRTM DEM';
          notice.hidden = false;
        }
      }
      if (map) map.style.display = 'block';
      if (radar) {
        radar.style.display = 'block';
        radar.style.pointerEvents = 'none';
        radar.style.background = 'transparent';
        radar.style.zIndex = '4';
      }
      requestAnimationFrame(() => {
        state.mapLibreInstance?.resize();
        updateMapLibreOverlay();
        applyMapLibreLayerState();
        syncMapLibreCameraFromRadarState(0);
        actions.drawRadar();
      });
      actions.markUiDirtyAndWake();
    } else {
      if (state.mapLibreInitialized) syncRadarStateFromMapLibreCamera();
      if (map) map.style.display = 'none';
      if (radar) {
        radar.style.display = 'block';
        radar.style.pointerEvents = 'auto';
        radar.style.background = '';
        radar.style.zIndex = '';
      }
      actions.markUiDirtyAndWake();
      actions.drawRadar();
    }
  }

  $('btnMapRadar')?.addEventListener('click', () => setMapMode('radar'));
  $('btnMapLibre')?.addEventListener('click', () => setMapMode('maplibre'));
  window.setMapMode = setMapMode;

  Object.assign(actions, {
    clearMapLibreSourceHashes,
    isMapLibreDynamicSourceBusy,
    setMapLibreSourceData,
    beginMapLibreCameraSync,
    endMapLibreCameraSync,
    syncRangeButtonHighlights,
    getMaxRadarRangeM,
    syncMapLibreCameraFromRadarState,
    easeMapLibreToLocalCenter,
    syncRadarStateFromMapLibreCamera,
    mapLibreCoordinate,
    geographicDistanceM,
    updateMapLibreToolSources,
    updateMapLibreCursor,
    renderMapLibreTerrainRaster,
    applyMapLibreTerrainRaster,
    ensureMapLibreTerrainLayer,
    setMapLibreTerrainRaster,
    applyMapLibreLayerState,
    updateMapLibreOverlay,
    fitMapLibreToTerrain,
    initializeMapLibre,
    setMapMode,
  });
}
