// Lazy 3D/MapLibre module loaders, WebGL context release, 2D<->3D stage switching & dirty-flag rAF scheduler
import type { AppContext } from './appContext.ts';
import type { TerrainBoundsLike } from './windowBindings.d.ts';
import type { TerrainMeshDataReadyMessage } from '../shared/workerProtocol.ts';
import type { StageViewMode } from '../ui/three/threeTypes.ts';
import { getLatticeCanvasPalette } from '../ui/canvasTheme.ts';
import { BIOME_DEM_METADATA } from '../core/terrain.ts';
import { THEATER_BIOMES } from '../core/biomePhysics.ts';
import {
  DEFAULT_WORLD_SATELLITE_TILE_URL,
  DEFAULT_WORLD_SATELLITE_ATTRIBUTION,
  getAirGapOfflineOnly,
  setAirGapOfflineOnly,
  isExternalHttpUrl,
} from '../ui/worldTileLayer.ts';

export interface MapLibreDependenciesBundle {
  MapLibreMap: typeof import('maplibre-gl').Map;
  setWorkerUrl: typeof import('maplibre-gl').setWorkerUrl;
  mapLibreWorkerUrl: string;
  MapController: typeof import('../ui/mapController.ts').MapController;
  buildOfflineSafeMapStyle: typeof import('../ui/mapController.ts').buildOfflineSafeMapStyle;
}

export function initViewModeAnd3dController(ctx: AppContext): void {
  const { state, engines, dom, actions } = ctx;
  const { $ } = dom;
  const { mainTerrainEngine, dataCommVisualizer } = engines;

  let threeModulePromise: Promise<typeof import('../ui/three/threeSceneController.ts')> | null = null;
  let threeInitPromise: Promise<void> | null = null;
  let mapLibreDepsPromise: Promise<MapLibreDependenciesBundle> | null = null;
  let threeSelectedThisClick = false;
  let lastSweepWallMs = 0;
  const wiredElements = new WeakSet<HTMLElement>();

  async function loadThreeStageModule(): Promise<typeof import('../ui/three/threeSceneController.ts')> {
    if (!threeModulePromise) {
      threeModulePromise = import('../ui/three/threeSceneController.ts');
    }
    return threeModulePromise;
  }

  async function loadMapLibreDependencies(): Promise<MapLibreDependenciesBundle> {
    if (!mapLibreDepsPromise) {
      mapLibreDepsPromise = Promise.all([
        import('maplibre-gl'),
        import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
        import('maplibre-gl/dist/maplibre-gl.css'),
        import('../ui/mapController.ts'),
      ]).then(([mlMod, workerMod, _cssMod, ctrlMod]) => ({
        MapLibreMap: mlMod.Map,
        setWorkerUrl: mlMod.setWorkerUrl,
        mapLibreWorkerUrl: workerMod.default,
        MapController: ctrlMod.MapController,
        buildOfflineSafeMapStyle: ctrlMod.buildOfflineSafeMapStyle,
      }));
    }
    return mapLibreDepsPromise;
  }

  window.isAirGapOfflineMode = function(): boolean {
    return getAirGapOfflineOnly();
  };

  window.setAirGapOfflineMode = function(enabled: boolean): boolean {
    const next = setAirGapOfflineOnly(Boolean(enabled));
    actions.getRadarWorldTileLayer()?.setAirGapOfflineOnly(next);
    if (state.mapLibreInstance) {
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
        : undefined;
      if (state.mapController && typeof state.mapController.buildMapLibreStyle === 'function') {
        const style = state.mapController.buildMapLibreStyle({
          airGapOfflineOnly: next,
          rasterTiles,
          attribution: rasterAttribution,
          maxzoom: rasterMaxZoom,
        });
        state.mapLibreInitialized = false;
        state.mapLibreInstance.setStyle(style as Parameters<typeof state.mapLibreInstance.setStyle>[0]);
      }
      if (notice) {
        if (next && rasterTiles.every(t => isExternalHttpUrl(t))) {
          notice.textContent = 'Air-gap mode: external map tiles blocked — using offline tactical fallback';
          notice.hidden = false;
        } else if (!next && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
          state.mapLibreErrorShown = false;
          notice.hidden = true;
        }
      }
    }
    markUiDirtyAndWake();
    actions.drawRadar();
    return next;
  };

  window.releaseInactiveWebglContexts = function(): { three: boolean; maplibre: boolean } {
    const released = { three: false, maplibre: false };
    if (state.stageViewMode !== '3d' && state.threeController) {
      try {
        state.threeController.setViewMode('2d');
      } catch (_) {}
      try {
        state.threeController.dispose();
      } catch (_) {}
      state.threeController = null;
      released.three = true;
    }
    if ((state.stageViewMode === '3d' || state.terrainMapMode !== 'maplibre') && state.mapLibreInstance) {
      if (state.boundMapLibreOfflineHandler) {
        window.removeEventListener('offline', state.boundMapLibreOfflineHandler);
        state.boundMapLibreOfflineHandler = null;
      }
      if (state.boundMapLibrePointerUp) {
        window.removeEventListener('pointerup', state.boundMapLibrePointerUp);
        window.removeEventListener('pointercancel', state.boundMapLibrePointerUp);
        state.boundMapLibrePointerUp = null;
      }
      try {
        state.mapLibreInstance.remove();
      } catch (_) {}
      state.mapLibreInstance = null;
      state.mapLibreInitialized = false;
      actions.clearMapLibreSourceHashes?.();
      if (state.mapController) state.mapController.setMapInstance(null);
      released.maplibre = true;
    }
    return released;
  };

  function shouldContinueAnimationLoop(): boolean {
    if (typeof document !== 'undefined' && document.hidden) return false;
    const isPlayingHistory = Boolean(state.simTimelineController?.isPlayingHistory);
    const isSteppedPlaying = Boolean(
      typeof dataCommVisualizer !== 'undefined' &&
        dataCommVisualizer.getPlaybackMode?.() === 'stepped' &&
        dataCommVisualizer.getSteppedLifecycle?.() === 'playing' &&
        !dataCommVisualizer.isVisualPaused?.()
    );
    return (
      !state.isPaused ||
      isPlayingHistory ||
      isSteppedPlaying ||
      state.radarNeedsRender ||
      state.schedulerNeedsRender ||
      state.terrainNeedsRender
    );
  }

  function scheduleAnimationLoop(): void {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (state.animationLoopRafId !== null || typeof requestAnimationFrame !== 'function') return;
    state.animationLoopRafId = requestAnimationFrame(animationLoop);
  }

  function markRadarDirty(): void {
    state.radarNeedsRender = true;
    scheduleAnimationLoop();
  }

  function markUiDirtyAndWake(): void {
    state.radarNeedsRender = true;
    state.schedulerNeedsRender = true;
    state.terrainNeedsRender = true;
    scheduleAnimationLoop();
  }

  function toThreeBounds(b: TerrainBoundsLike): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minElevationM?: number;
    maxElevationM?: number;
  } | null {
    const minX = b.minX ?? (b.halfWidthM !== undefined ? -b.halfWidthM : NaN);
    const maxX = b.maxX ?? (b.halfWidthM !== undefined ? b.halfWidthM : NaN);
    const minY = b.minY ?? (b.halfHeightM !== undefined ? -b.halfHeightM : NaN);
    const maxY = b.maxY ?? (b.halfHeightM !== undefined ? b.halfHeightM : NaN);
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return null;
    }
    const biomeMeta = BIOME_DEM_METADATA[state.activeBiomeId];
    const biomeDef = THEATER_BIOMES[state.activeBiomeId];
    const minElevationM =
      b.minElevationM ??
      state.cachedTerrainMeshData?.minElevationM ??
      biomeMeta?.minElevationM ??
      biomeDef?.baseElevationM;
    const maxElevationM =
      b.maxElevationM ??
      state.cachedTerrainMeshData?.maxElevationM ??
      biomeMeta?.maxElevationM ??
      (biomeDef ? biomeDef.baseElevationM + biomeDef.reliefAmplitudeM : undefined);
    return {
      minX,
      maxX,
      minY,
      maxY,
      minElevationM,
      maxElevationM,
    };
  }

  async function initThreeStage(): Promise<void> {
    const container = $('three-stage-container');
    const canvas = $<HTMLCanvasElement>('three-canvas');
    if (!container || !canvas || state.threeController) return;
    if (threeInitPromise) return threeInitPromise;

    threeInitPromise = (async () => {
      try {
        const { createThreeSceneController } = await loadThreeStageModule();
        // Post-await active-mode check prevents leaked WebGL contexts on rapid 3D<->2D toggles
        if (state.stageViewMode !== '3d' || state.threeController) return;

        state.threeController = createThreeSceneController({
          container,
          canvas,
          antialias: true,
          maxPixelRatio: 2,
          powerPreference: 'high-performance',
          clearColor: 0x080c10,
        });
        state.threeController.setSelectedNode(state.selectedNodeId);
        state.threeController.onNodeSelected((nodeId: number) => {
          threeSelectedThisClick = true;
          actions.handleNodeSelection(nodeId);
        });
        if (typeof state.threeController.onNodePicked === 'function') {
          state.threeController.onNodePicked((nodeId: number) => {
            threeSelectedThisClick = true;
            actions.handleNodeSelection(nodeId);
          });
        }
        syncVolumetricRfHudButtons();
        let threeDownX = 0;
        let threeDownY = 0;
        let threeDownActive = false;
        let threeWheelUsed = false;
        if (!wiredElements.has(canvas)) {
          wiredElements.add(canvas);
          canvas.addEventListener('pointerdown', (e: PointerEvent) => {
            threeDownX = e.clientX;
            threeDownY = e.clientY;
            threeDownActive = e.button === 0;
            threeWheelUsed = false;
            threeSelectedThisClick = false;
          });
          canvas.addEventListener('wheel', () => {
            threeWheelUsed = true;
            requestAnimationFrame(() => actions.syncZoomHudReadout?.());
          }, { passive: true });
          canvas.addEventListener('pointerup', () => {
            requestAnimationFrame(() => actions.syncZoomHudReadout?.());
          });
          canvas.addEventListener('click', (e: MouseEvent) => {
            const wasDown = threeDownActive;
            const wasWheel = threeWheelUsed;
            const wasSelected = threeSelectedThisClick;
            threeDownActive = false;
            threeWheelUsed = false;
            threeSelectedThisClick = false;
            if (state.stageViewMode !== '3d' || !wasDown || wasWheel || wasSelected) return;
            if (Math.hypot(e.clientX - threeDownX, e.clientY - threeDownY) >= 4) return;
            if (actions.isNeutralMapSelectionMode()) {
              actions.dismissNodeInspector();
            }
          });
        }
        actions.applyThreeLayerVisibility();
        if (state.latestTelemetry) {
          state.threeController.updateTelemetry(state.latestTelemetry);
        }
        if (state.cachedTerrainMeshData) {
          state.threeController.loadTerrainMeshData(state.cachedTerrainMeshData);
          if (state.hillshadeCanvas) {
            state.threeController.setHillshadeCanvas(state.hillshadeCanvas);
          }
        }
        if (state.stageViewMode === '3d') {
          state.threeController.setViewMode('3d');
          if (state.hillshadeCanvas) {
            state.threeController.setHillshadeCanvas(state.hillshadeCanvas);
          }
          if (state.activeTerrainBounds) {
            const tb = toThreeBounds(state.activeTerrainBounds);
            if (tb) state.threeController.centerOnBounds(tb);
          }
          state.pendingThreeRecenter = false;
          actions.syncZoomHudReadout?.();
        }
        console.log('[StageController] Three.js 3D subsystem initialized lazily.');
      } catch (err) {
        console.error('[StageController] Failed to initialize Three.js subsystem:', err);
      } finally {
        threeInitPromise = null;
      }
    })();

    return threeInitPromise;
  }

  function syncVolumetricRfHudButtons() {
    const palette = typeof getLatticeCanvasPalette === 'function' ? getLatticeCanvasPalette() : null;
    const btnFresnel = $('btn-3d-fresnel');
    const btnLobes = $('btn-3d-lobes');
    const btnVolumes = $('btn-3d-volumes');

    if (btnFresnel) {
      const active = btnFresnel.getAttribute('aria-pressed') === 'true';
      btnFresnel.style.color = active ? (palette?.accent || '#38bdf8') : (palette?.textMuted || '#78879c');
      btnFresnel.style.borderColor = active ? (palette?.accent || 'rgba(56,189,248,0.5)') : 'rgba(255,255,255,0.15)';
    }
    if (btnLobes) {
      const active = btnLobes.getAttribute('aria-pressed') === 'true';
      btnLobes.style.color = active ? (palette?.degraded || '#f59e0b') : (palette?.textMuted || '#78879c');
      btnLobes.style.borderColor = active ? (palette?.degraded || 'rgba(245,158,11,0.5)') : 'rgba(255,255,255,0.15)';
    }
    if (btnVolumes) {
      const active = btnVolumes.getAttribute('aria-pressed') === 'true';
      btnVolumes.style.color = active ? (palette?.outage || '#ef4444') : (palette?.textMuted || '#78879c');
      btnVolumes.style.borderColor = active ? (palette?.outage || 'rgba(239,68,68,0.5)') : 'rgba(255,255,255,0.15)';
    }
    if (state.threeController && typeof state.threeController.setVolumetricRfOptions === 'function') {
      state.threeController.setVolumetricRfOptions({
        showFresnel: btnFresnel ? btnFresnel.getAttribute('aria-pressed') === 'true' : true,
        showSectorLobes: btnLobes ? btnLobes.getAttribute('aria-pressed') === 'true' : true,
        showThreatVolumes: btnVolumes ? btnVolumes.getAttribute('aria-pressed') === 'true' : true,
      });
    }
  }

  function initVolumetricRfControls(): void {
    const btnFresnel = $('btn-3d-fresnel');
    const btnLobes = $('btn-3d-lobes');
    const btnVolumes = $('btn-3d-volumes');

    if (btnFresnel && !wiredElements.has(btnFresnel)) {
      wiredElements.add(btnFresnel);
      btnFresnel.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        const current = btnFresnel.getAttribute('aria-pressed') === 'true';
        const next = !current;
        btnFresnel.setAttribute('aria-pressed', String(next));
        btnFresnel.classList.toggle('is-active', next);
        if (state.threeController && typeof state.threeController.setVolumetricRfOptions === 'function') {
          state.threeController.setVolumetricRfOptions({ showFresnel: next });
        }
        syncVolumetricRfHudButtons();
      });
    }

    if (btnLobes && !wiredElements.has(btnLobes)) {
      wiredElements.add(btnLobes);
      btnLobes.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        const current = btnLobes.getAttribute('aria-pressed') === 'true';
        const next = !current;
        btnLobes.setAttribute('aria-pressed', String(next));
        btnLobes.classList.toggle('is-active', next);
        if (state.threeController && typeof state.threeController.setVolumetricRfOptions === 'function') {
          state.threeController.setVolumetricRfOptions({ showSectorLobes: next });
        }
        syncVolumetricRfHudButtons();
      });
    }

    if (btnVolumes && !wiredElements.has(btnVolumes)) {
      wiredElements.add(btnVolumes);
      btnVolumes.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        const current = btnVolumes.getAttribute('aria-pressed') === 'true';
        const next = !current;
        btnVolumes.setAttribute('aria-pressed', String(next));
        btnVolumes.classList.toggle('is-active', next);
        if (state.threeController && typeof state.threeController.setVolumetricRfOptions === 'function') {
          state.threeController.setVolumetricRfOptions({ showThreatVolumes: next });
        }
        syncVolumetricRfHudButtons();
      });
    }

    window.addEventListener('c2:cvd-mode-change', () => {
      syncVolumetricRfHudButtons();
    });

    syncVolumetricRfHudButtons();
  }
  initVolumetricRfControls();

  function requestTerrainMeshData(force = false): void {
    const currentMode = state.activeTerrainMode || 'real';
    const cachedBiomeId = (state.cachedTerrainMeshData?.bounds as { biomeId?: string } | undefined)?.biomeId;
    if (
      !force &&
      state.cachedTerrainMeshData &&
      state.cachedTerrainMeshData.terrainMode === currentMode &&
      (!cachedBiomeId || cachedBiomeId === state.activeBiomeId)
    ) {
      return;
    }
    if (
      !force &&
      state.inFlightTerrainMeshRequest &&
      state.inFlightTerrainMeshRequest.terrainMode === currentMode
    ) {
      return;
    }

    const reqId = ++state.terrainMeshRequestId;
    state.inFlightTerrainMeshRequest = { requestId: reqId, terrainMode: currentMode };
    actions.sendCommand({
      type: 'GET_TERRAIN_MESH_DATA',
      request_id: reqId,
    });
  }

  function handleTerrainMeshDataResponse(msg: TerrainMeshDataReadyMessage): void {
    if (state.inFlightTerrainMeshRequest) {
      if (msg.request_id !== undefined && msg.request_id !== state.inFlightTerrainMeshRequest.requestId) {
        console.warn(
          `[ThreeStage] Discarding stale terrain mesh data (req ${msg.request_id} vs active ${state.inFlightTerrainMeshRequest.requestId})`
        );
        return;
      }
      if (msg.terrain_mode !== state.activeTerrainMode) {
        console.warn(
          `[ThreeStage] Discarding superseded terrain mode response (${msg.terrain_mode} vs active ${state.activeTerrainMode})`
        );
        return;
      }
      state.inFlightTerrainMeshRequest = null;
    }

    state.cachedTerrainMeshData = {
      terrainMode: msg.terrain_mode,
      bounds: msg.bounds,
      gridSize: msg.grid_size,
      minElevationM: msg.min_elevation_m,
      maxElevationM: msg.max_elevation_m,
      elevations: msg.elevations,
    };

    // M1: Never overwrite native realDemGrid (e.g. 1201x1201 / 3601x3601 / mosaic) with 512x512 worker mesh
    if (msg.terrain_mode === 'synthetic') {
      mainTerrainEngine.setTerrainMode('synthetic');
    } else if (msg.terrain_mode === 'real' && msg.elevations && !mainTerrainEngine.hasRealDem) {
      mainTerrainEngine.loadCustomDem(msg.elevations);
    }
    actions.invalidateToolboxCache();

    updateTerrainHudBadge();
    if (state.isMouseInsideRadar) {
      actions.updateRadarCursorReadout(state.mouseWorldX, state.mouseWorldY, true);
    }

    if (state.threeController) {
      state.threeController.loadTerrainMeshData(state.cachedTerrainMeshData);
      if (state.hillshadeCanvas) {
        state.threeController.setHillshadeCanvas(state.hillshadeCanvas);
      }
      if (state.pendingThreeRecenter || state.stageViewMode === '3d') {
        const tb = toThreeBounds({
          ...msg.bounds,
          minElevationM: msg.min_elevation_m,
          maxElevationM: msg.max_elevation_m,
        });
        if (tb) state.threeController.centerOnBounds(tb);
        state.pendingThreeRecenter = false;
        actions.syncZoomHudReadout?.();
      }
    }
  }

  function updateTerrainHudBadge(): void {
    const statusEl = $('three-terrain-status-text');
    if (!statusEl) return;
    const modeLabel = state.activeTerrainMode === 'real' ? 'REAL DEM' : 'SYNTHETIC';
    const resLabel =
      state.currentTerrainResolution === 'native512' ? '512×512 (NATIVE)' : '256×256 (REDUCED)';
    statusEl.textContent = `3D TERRAIN — ${modeLabel} · ${resLabel}`;
  }

  window.setTerrainMeshResolution = function(res: string): void {
    if (res !== 'native512' && res !== 'balanced256') return;
    state.currentTerrainResolution = res;
    $('btnRes512')?.classList.toggle('active', res === 'native512');
    $('btnRes256')?.classList.toggle('active', res === 'balanced256');
    updateTerrainHudBadge();
    if (state.threeController) {
      state.threeController.setTerrainResolution(res);
    }
  };

  window.setStageViewMode = function(mode: StageViewMode): void {
    if (mode === state.stageViewMode) return;
    state.stageViewMode = mode;

    const btn2D = $('btnView2D');
    const btn3D = $('btnView3D');
    if (btn2D) btn2D.classList.toggle('active', mode === '2d');
    if (btn3D) btn3D.classList.toggle('active', mode === '3d');

    ['zoom-30', 'zoom-60', 'zoom-100', 'zoom-200'].forEach(id => {
      const b = $<HTMLButtonElement>(id);
      if (b) {
        b.disabled = mode !== '2d' || state.terrainMapMode === 'maplibre';
        b.title = b.disabled ? 'Range zoom — 2D Radar mode only' : 'Range zoom';
      }
    });

    const radarCvs = $('radar-canvas');
    const mapLibreStage = $('maplibre-stage');
    const threeWrap = $('three-stage-container');
    const resSep = $('sep-mesh-res');
    const resLabel = $('label-mesh-res');
    const resToggle = $('mesh-res-toggle');
    const scopeNote3d = $('tb-3d-scope-note');

    if (mode === '3d') {
      actions.updateRadarCursorReadout(0, 0, false);
      const wasToolActive = state.terrainToolMode !== 'idle' || Boolean(window.tbOpen);
      if (state.terrainToolMode !== 'idle') actions.cancelTerrainTool();
      window.setTerrainToolboxExpanded?.(false);
      if (typeof actions.closeTerrainToolbox === 'function') actions.closeTerrainToolbox();
      if (wasToolActive) {
        const banner = $('edit-mode-banner');
        const badge = $('edit-mode-badge');
        const text = $('edit-mode-text');
        if (banner && text) {
          if (badge) badge.textContent = 'NOTICE';
          text.textContent = '2D Terrain Tool closed — switched to 3D Terrain view.';
          banner.hidden = false;
          $('edit-mode-done-btn')?.setAttribute('hidden', 'true');
          $('edit-mode-cancel-btn')?.setAttribute('hidden', 'true');
          setTimeout(() => {
            actions.syncEditModeBanner();
          }, 3500);
        }
      }
      if (scopeNote3d) scopeNote3d.hidden = false;
      if (resSep) resSep.style.display = 'inline-block';
      if (resLabel) resLabel.style.display = 'inline';
      if (resToggle) resToggle.style.display = 'inline-flex';
      if (!state.threeController) {
        void initThreeStage();
      }
      requestTerrainMeshData(false);
      if (radarCvs) {
        radarCvs.style.display = 'none';
        radarCvs.style.pointerEvents = 'auto';
      }
      if (mapLibreStage) mapLibreStage.style.display = 'none';
      if (threeWrap) {
        threeWrap.style.display = 'block';
        threeWrap.setAttribute('aria-hidden', 'false');
      }
      if (state.threeController) {
        state.threeController.setViewMode('3d');
        if (state.hillshadeCanvas) {
          state.threeController.setHillshadeCanvas(state.hillshadeCanvas);
        }
        if (state.activeTerrainBounds) {
          const tb = toThreeBounds(state.activeTerrainBounds);
          if (tb) state.threeController.centerOnBounds(tb);
        } else if (state.pendingThreeRecenter) {
          const meta = BIOME_DEM_METADATA[state.activeBiomeId];
          if (meta) {
            state.threeController.centerOnBounds({
              minX: meta.minX ?? -meta.halfWidthM,
              maxX: meta.maxX ?? meta.halfWidthM,
              minY: meta.minY ?? -meta.halfHeightM,
              maxY: meta.maxY ?? meta.halfHeightM,
              minElevationM: meta.minElevationM,
              maxElevationM: meta.maxElevationM,
            });
          }
        }
        state.pendingThreeRecenter = false;
      }
      actions.syncZoomHudReadout?.();
      scheduleAnimationLoop();
    } else {
      actions.updateRadarCursorReadout(0, 0, false);
      if (scopeNote3d) scopeNote3d.hidden = true;
      if (resSep) resSep.style.display = 'none';
      if (resLabel) resLabel.style.display = 'none';
      if (resToggle) resToggle.style.display = 'none';
      if (state.threeController) {
        state.threeController.setViewMode('2d');
      }
      if (threeWrap) {
        threeWrap.style.display = 'none';
        threeWrap.setAttribute('aria-hidden', 'true');
      }
      if (radarCvs) {
        if (state.terrainMapMode === 'maplibre') {
          void actions.initializeMapLibre().then(() => {
            if (state.terrainMapMode === 'maplibre' && state.stageViewMode === '2d' && state.mapLibreInstance) {
              if (state.mapController) state.mapController.setMapInstance(state.mapLibreInstance);
              state.mapLibreInstance.resize();
              actions.updateMapLibreOverlay();
              actions.syncMapLibreCameraFromRadarState(0);
              actions.drawRadar();
            }
          });
          if (state.mapLibreInstance && state.mapController) state.mapController.setMapInstance(state.mapLibreInstance);
          if (mapLibreStage) mapLibreStage.style.display = 'block';
          radarCvs.style.display = 'block';
          radarCvs.style.pointerEvents = 'none';
          radarCvs.style.background = 'transparent';
          radarCvs.style.zIndex = '4';
          requestAnimationFrame(() => {
            state.mapLibreInstance?.resize();
            actions.updateMapLibreOverlay();
            actions.syncMapLibreCameraFromRadarState(0);
            actions.drawRadar();
          });
        } else {
          if (state.mapLibreInitialized) actions.syncRadarStateFromMapLibreCamera();
          radarCvs.style.display = 'block';
          radarCvs.style.pointerEvents = 'auto';
          radarCvs.style.background = '';
          radarCvs.style.zIndex = '';
          if (mapLibreStage) mapLibreStage.style.display = 'none';
          actions.drawRadar();
        }
      }
      markUiDirtyAndWake();
    }
    actions.syncRadarHudMode();
    actions.syncFloatingOverlayLayout();
    actions.syncZoomHudReadout?.();
  };

  function animationLoop(timestampMs: number): void {
    state.animationLoopRafId = null;
    if (typeof document !== 'undefined' && document.hidden) {
      lastSweepWallMs = 0;
      return;
    }
    try {
      const now = typeof timestampMs === 'number' ? timestampMs : performance.now();
      const simTimelineController = state.simTimelineController;
      const isPlayingHistory = Boolean(simTimelineController?.isPlayingHistory);
      const stageViewMode = state.stageViewMode;
      const is3dMode = stageViewMode === '3d';
      const allowSecondaryRedraw = !is3dMode || now - state.last3dSecondaryCanvasThrottleMs >= 125; // 8 Hz (125 ms) throttling in 3D mode

      if (!state.isPaused && !isPlayingHistory) {
        const dtSweepS = lastSweepWallMs > 0 ? Math.min(0.1, Math.max(0, (now - lastSweepWallMs) / 1000)) : 0;
        state.radarSweepPhaseS += dtSweepS * Math.max(0.2, state.currentSimSpeed || 1);
        lastSweepWallMs = now;
      } else {
        lastSweepWallMs = 0;
      }

      if (simTimelineController) {
        if (state.lastTimelineAnimTimeMs > 0 && isPlayingHistory) {
          const dtS = Math.min((now - state.lastTimelineAnimTimeMs) / 1000, 0.1);
          simTimelineController.advanceHistoricalPlayback(dtS);
        }
        if (allowSecondaryRedraw) {
          simTimelineController.renderIfDirty();
        }
      }
      state.lastTimelineAnimTimeMs = now;
      if (allowSecondaryRedraw && is3dMode) {
        state.last3dSecondaryCanvasThrottleMs = now;
        actions.syncZoomHudReadout?.();
      }

      // 1. Radar canvas is in .persistent-map-panel (left column) - renders when dirty or active playback (skips when in 3D mode)
      if (stageViewMode !== '3d' &&
        (state.radarNeedsRender || isPlayingHistory || !state.isPaused)
      ) {
        actions.drawRadar();
        state.radarNeedsRender = false;
      }

      // 2. Analytical workspace canvases in right-hand column - gated by active tab (throttled to 8 Hz in 3D mode)
      if (allowSecondaryRedraw) {
        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab) {
          if (
            activeTab.id === 'tab-scheduler' &&
            (state.schedulerNeedsRender || isPlayingHistory || !state.isPaused)
          ) {
            actions.drawWaterfall();
            if (state.latestTelemetry) {
              actions.drawPolarAntennaScope(state.latestTelemetry);
              actions.drawEcdfDelayScope(state.latestTelemetry);
              actions.drawSensitivitySweepScope(state.latestTelemetry);
            }
            state.schedulerNeedsRender = false;
          } else if (
            activeTab.id === 'tab-terrain' &&
            (state.terrainNeedsRender || isPlayingHistory || !state.isPaused)
          ) {
            actions.drawFresnel();
            if (state.latestTelemetry) actions.drawLinkWaterfallCanvas(state.latestTelemetry);
            state.terrainNeedsRender = false;
          } else if (
            activeTab.id === 'tab-soldier' &&
            state.latestTelemetry &&
            (state.radarNeedsRender || isPlayingHistory || !state.isPaused)
          ) {
            actions.renderSoldierPhoneWorkspace(state.latestTelemetry);
          }
        }
      }
    } catch (err) {
      console.error('Animation loop exception:', err);
    }
    if (shouldContinueAnimationLoop()) {
      scheduleAnimationLoop();
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        const animationLoopRafId = state.animationLoopRafId;
        if (animationLoopRafId !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(animationLoopRafId);
          state.animationLoopRafId = null;
        }
        if (state.threeController && typeof state.threeController.stopAnimationLoop === 'function') {
          state.threeController.stopAnimationLoop();
        }
      } else {
        state.lastTimelineAnimTimeMs = 0;
        if (
          state.stageViewMode === '3d' &&
          state.threeController &&
          typeof state.threeController.startAnimationLoop === 'function'
        ) {
          state.threeController.startAnimationLoop();
        }
        markUiDirtyAndWake();
      }
    });
  }

  Object.assign(actions, {
    loadThreeStageModule,
    loadMapLibreDependencies,
    shouldContinueAnimationLoop,
    scheduleAnimationLoop,
    markRadarDirty,
    markUiDirtyAndWake,
    initThreeStage,
    syncVolumetricRfHudButtons,
    initVolumetricRfControls,
    requestTerrainMeshData,
    handleTerrainMeshDataResponse,
    updateTerrainHudBadge,
  });
}
