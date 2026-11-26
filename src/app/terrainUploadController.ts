// @ts-nocheck — Terrain DEM upload (HGT/GeoTIFF/Heightmap), folder catalog mosaic & offline mission pack store
import type { AppContext } from './appContext.ts';
import { parseHgtBuffer, decodeHgtBuffer } from '../core/hgtParser.ts';
import {
  buildTileCatalog,
  clusterNeighbouringTiles,
  selectActivePatch,
  decodeAndStitchPatchAsync,
} from '../core/hgtMosaic.ts';
import { inferPackKind } from '../core/offlineMissionPackStore.ts';
import { REAL_LADAKH_DEM_METADATA } from '../core/terrain.ts';
import { parseGeoTiffDem } from '../core/militaryGisEngine.ts';

export function initTerrainUploadController(ctx: AppContext) {
  const { state, engines, canvases, dom, actions } = ctx;
  const { $, setText } = dom;
  const { mainTerrainEngine, terrainTopViewport, tileCache, offlinePackStore } = engines;
  const { radarCanvas, terrainCanvas } = canvases;

  let currentCatalog = [];
  let currentClusters = [];
  let activePatchSelection = null;
  let activeHgtAbortController = null;

  function setCustomDemControlsState({ loading = false, loaded = false } = {}) {
    const btnCancel = $('btn-cancel-hgt-load');
    const btnUnload = $('btn-unload-custom-dem');
    if (btnCancel) btnCancel.hidden = !loading;
    if (btnUnload) btnUnload.hidden = !loaded;
  }

  function sendCustomDemZeroCopy(elevations, metadata) {
    const transferable = new Float32Array(elevations);
    actions.sendCommand(
      {
        type: 'LOAD_CUSTOM_DEM',
        elevations: transferable,
        metadata,
      },
      [transferable.buffer]
    );
    setCustomDemControlsState({ loading: false, loaded: true });
  }

  function resetTerrainFileInputs() {
    const fileEl = $('terrainFileInput');
    const folderEl = $('terrainFolderInput');
    if (fileEl) fileEl.value = '';
    if (folderEl) folderEl.value = '';
  }

  function invokeTauriOfflineIpc(cmd, args) {
    const tauriInvoke = window?.__TAURI_INTERNALS__?.invoke;
    if (typeof tauriInvoke === 'function') {
      return tauriInvoke(cmd, args);
    }
    return null;
  }

  async function persistOfflinePack(name, kind, bufferOrBytes) {
    try {
      const bytes = bufferOrBytes instanceof Uint8Array ? bufferOrBytes : new Uint8Array(bufferOrBytes);
      if (bytes.byteLength <= 64 * 1024 * 1024) {
        await offlinePackStore.savePack(name, kind, bytes);
        const tauriPromise = invokeTauriOfflineIpc('save_offline_tile', { name, bytes: Array.from(bytes) });
        if (tauriPromise) {
          await tauriPromise.catch(() => {});
        }
        await refreshOfflinePackList();
      }
    } catch {
      // Non-fatal if storage quota or filename is unsupported
    }
  }

  async function refreshOfflinePackList() {
    const summaryEl = $('offline-pack-summary');
    const listEl = $('offline-pack-list');
    if (!summaryEl && !listEl) return;

    try {
      const packs = await offlinePackStore.listPacks();
      if (summaryEl) {
        const totalKb = packs.reduce((acc, p) => acc + p.sizeBytes, 0) / 1024;
        summaryEl.textContent =
          packs.length === 0
            ? '0 cached'
            : `${packs.length} cached (${totalKb >= 1024 ? `${(totalKb / 1024).toFixed(1)} MB` : `${totalKb.toFixed(0)} KB`})`;
      }
      if (listEl) {
        listEl.replaceChildren();
        if (packs.length === 0) {
          const emptyMsg = document.createElement('div');
          emptyMsg.textContent = 'No cached offline terrain or scenario packs.';
          listEl.appendChild(emptyMsg);
          return;
        }
        for (const pack of packs) {
          const row = document.createElement('div');
          row.style.cssText =
            'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-top:1px solid rgba(255,255,255,0.06)';
          const label = document.createElement('span');
          const kb = pack.sizeBytes / 1024;
          const sizeStr = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
          label.textContent = `${pack.name} [${pack.kind}] (${sizeStr})`;
          label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

          const actionsWrap = document.createElement('div');
          actionsWrap.style.cssText = 'display:flex;gap:6px;flex-shrink:0';

          const btnLoad = document.createElement('button');
          btnLoad.type = 'button';
          btnLoad.className = 'btn-sm';
          btnLoad.textContent = 'Load';
          btnLoad.addEventListener('click', async () => {
            const loaded = await offlinePackStore.loadPack(pack.name);
            if (!loaded) return;
            if (inferPackKind(loaded.name) === 'scenario') {
              actions.getMissionIoController().applyScenarioJson(new TextDecoder().decode(loaded.bytes));
            } else {
              const fileBlob = new File([loaded.bytes], loaded.name);
              window.onFileSelected?.(fileBlob);
            }
          });

          const btnDel = document.createElement('button');
          btnDel.type = 'button';
          btnDel.className = 'btn-sm';
          btnDel.textContent = 'Delete';
          btnDel.addEventListener('click', async () => {
            await offlinePackStore.deletePack(pack.name);
            const tauriPromise = invokeTauriOfflineIpc('delete_offline_tile', { name: pack.name });
            if (tauriPromise) {
              await tauriPromise.catch(() => {});
            }
            await refreshOfflinePackList();
          });

          actionsWrap.appendChild(btnLoad);
          actionsWrap.appendChild(btnDel);
          row.appendChild(label);
          row.appendChild(actionsWrap);
          listEl.appendChild(row);
        }
      }
    } catch {
      if (summaryEl) summaryEl.textContent = 'Unavailable';
    }
  }

  function getTerrainLayout() {
    const cvs = terrainCanvas ? terrainCanvas : $('terrain-canvas');
    const w = cvs && cvs.parentElement ? cvs.parentElement.clientWidth : cvs ? cvs.width : 800;
    const h = cvs && cvs.parentElement ? cvs.parentElement.clientHeight : cvs ? cvs.height : 320;
    return { width: Math.max(10, w), height: Math.max(10, h), padL: 60, padR: 24, padT: 28, padB: 34 };
  }
  window.getTerrainLayout = getTerrainLayout;

  window.centerMapOnTerrain = function(bounds) {
    if (!bounds) return;
    const minX = bounds.minX !== undefined ? bounds.minX : -bounds.halfWidthM;
    const maxX = bounds.maxX !== undefined ? bounds.maxX : bounds.halfWidthM;
    const minY = bounds.minY !== undefined ? bounds.minY : -bounds.halfHeightM;
    const maxY = bounds.maxY !== undefined ? bounds.maxY : bounds.halfHeightM;

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const spanX = Math.max(1000, maxX - minX);
    const spanY = Math.max(1000, maxY - minY);

    // 1. Center 2D Radar Canvas with container dimension & aspect ratio awareness
    const rCvs = radarCanvas ? radarCanvas : $('radar-canvas');
    const rw = rCvs && rCvs.parentElement ? rCvs.parentElement.clientWidth : rCvs ? rCvs.width : 800;
    const rh = rCvs && rCvs.parentElement ? rCvs.parentElement.clientHeight : rCvs ? rCvs.height : 600;
    const rcx = rw / 2;
    const rcy = rh / 2;
    const minHalfDim = Math.min(rcx, rcy);
    const halfSpanX = spanX / 2;
    const halfSpanY = spanY / 2;
    // Ensure both width and height fit inside visible radar area with comfortable padding (~20% margin)
    const fitRangeX = (halfSpanX * (minHalfDim / Math.max(1, rcx))) / 0.80;
    const fitRangeY = (halfSpanY * (minHalfDim / Math.max(1, rcy))) / 0.80;
    state.currentRadarRangeM = Math.max(15000, Math.min(300000, Math.max(fitRangeX, fitRangeY)));

    state.panOffsetX_m = cx;
    state.panOffsetY_m = cy;
    actions.setRadarRange(state.currentRadarRangeM, { duration: 0, resetOrientation: true });
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();

    // 2. Center 3D Three.js View
    if (state.threeController && typeof state.threeController.centerOnBounds === 'function') {
      state.threeController.centerOnBounds({
        minX,
        maxX,
        minY,
        maxY,
        minElevationM: bounds.minElevationM,
        maxElevationM: bounds.maxElevationM,
      });
    }

    // 3. Center Top View with actual layout aspect ratio and padding
    if (terrainTopViewport && typeof terrainTopViewport.fitToBounds === 'function') {
      terrainTopViewport.fitToBounds({ minX, maxX, minY, maxY }, getTerrainLayout(), 0.08);
      if (typeof actions.drawFresnel === 'function') {
        actions.drawFresnel();
      }
    }
  };

  window.setTerrainMode = function(mode) {
    if (state.spatialLocked) {
      setText('worker-label', 'Spatial lock is enabled; terrain mode cannot be changed.');
      return;
    }
    state.activeTerrainMode = mode;
    if (mode === 'synthetic') {
      state.activeTerrainBounds = null;
      state.pendingTerrainCenteringBounds = null;
      if (terrainTopViewport && typeof terrainTopViewport.clearPinnedBounds === 'function') {
        terrainTopViewport.clearPinnedBounds();
      }
    }
    mainTerrainEngine.setTerrainMode(mode);
    state.cachedTerrainMeshData = null;
    actions.invalidateToolboxCache();
    actions.updateTerrainHudBadge();
    $('btnRealTerrain').classList.toggle('active', mode === 'real');
    $('btnSynthTerrain').classList.toggle('active', mode === 'synthetic');
    if (mode === 'synthetic' && state.currentRadarRangeM > 300000) {
      state.currentRadarRangeM = 300000;
    }
    actions.sendCommand({ type: 'SET_TERRAIN_MODE', mode: mode });
    actions.sendCommand({ type: 'CONFIG_UPDATE', params: { terrain_mode: mode } });
    actions.requestTerrainMeshData(true);
    actions.markRadarDirty();
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
    if (state.isMouseInsideRadar) {
      actions.updateRadarCursorReadout(state.mouseWorldX, state.mouseWorldY, true);
    }
  };

  function openUploadModal() {
    const modal = $('upload-modal');
    if (modal) modal.removeAttribute('hidden');
    const statusBox = $('upload-status');
    if (statusBox) statusBox.style.display = 'none';
    void refreshOfflinePackList();
  }
  window.openUploadModal = openUploadModal;

  function closeUploadModal() {
    const modal = $('upload-modal');
    if (modal) modal.setAttribute('hidden', '');
  }
  window.closeUploadModal = closeUploadModal;

  function onDragOver(e) {
    e.preventDefault();
    const dz = $('dropzone');
    if (dz) dz.classList.add('dragover');
  }
  window.onDragOver = onDragOver;

  function onDragLeave(e) {
    e.preventDefault();
    const dz = $('dropzone');
    if (dz) dz.classList.remove('dragover');
  }
  window.onDragLeave = onDragLeave;

  function onDropFile(e) {
    e.preventDefault();
    const dz = $('dropzone');
    if (dz) dz.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      if (e.dataTransfer.files.length > 1) {
        window.onFolderSelected(e.dataTransfer.files);
      } else {
        window.onFileSelected(e.dataTransfer.files[0]);
      }
    }
  }
  window.onDropFile = onDropFile;

  window.onFileSelected = function(file) {
    if (!file) return;
    const statusBox = $('upload-status');
    const patchCtrl = $('folder-patch-controls');
    if (patchCtrl) patchCtrl.style.display = 'none';
    statusBox.style.display = 'block';
    statusBox.className = 'upload-status-box status-loading';
    statusBox.textContent = `Parsing ${file.name} directly in browser...`;

    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith('.hgt')) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const buffer = evt.target.result;
          const parseResult = parseHgtBuffer(file.name, buffer);
          if (!parseResult.success) {
            statusBox.className = 'upload-status-box status-error';
            statusBox.textContent = `[ERR] Error: ${parseResult.error}`;
            return;
          }

          // Update local active terrain bounds & native main-thread DEM grid (M1)
          mainTerrainEngine.loadCustomDem(parseResult.elevations, parseResult.metadata);
          state.activeTerrainBounds = parseResult.metadata;
          state.pendingTerrainCenteringBounds = parseResult.metadata;
          actions.setMapLibreTerrainRaster(parseResult.elevations, parseResult.metadata);
          actions.invalidateToolboxCache();

          // Send custom DEM to worker zero-copy
          sendCustomDemZeroCopy(parseResult.elevations, parseResult.metadata);
          actions.sendCommand({ type: 'SET_TERRAIN_MODE', mode: 'real' });
          actions.sendCommand({ type: 'CONFIG_UPDATE', params: { terrain_mode: 'real' } });
          actions.requestTerrainMeshData(true);
          void persistOfflinePack(file.name, 'hgt', buffer);

          // Center cameras without altering authentic coordinates
          window.centerMapOnTerrain(parseResult.metadata);

          const meta = parseResult.metadata;
          statusBox.className = 'upload-status-box status-success';
          statusBox.textContent = `[OK] Loaded ${meta.tileName} (${parseResult.resolution} ${parseResult.sampleCount}×${parseResult.sampleCount}, Elev: ${parseResult.minElevationM?.toFixed(0)}m–${parseResult.maxElevationM?.toFixed(0)}m MSL, Voids: ${parseResult.voidCount}) · View Centered`;
          setTimeout(() => window.closeUploadModal && window.closeUploadModal(), 1500);
        } catch (err) {
          statusBox.className = 'upload-status-box status-error';
          statusBox.textContent = `[ERR] Failed to process HGT: ${err?.message || err}`;
        }
      };
      reader.onerror = () => {
        statusBox.className = 'upload-status-box status-error';
        statusBox.textContent = `[ERR] Failed to read file: ${file.name}`;
      };
      reader.readAsArrayBuffer(file);
    } else if (lowerName.endsWith('.tif') || lowerName.endsWith('.tiff')) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const buffer = evt.target.result;
          const parseResult = parseGeoTiffDem(buffer);
          if (!parseResult.ok || !parseResult.elevationsM || !parseResult.width || !parseResult.height) {
            statusBox.className = 'upload-status-box status-error';
            statusBox.textContent = `[ERR] Error: ${parseResult.error || 'Failed to parse GeoTIFF DEM'}`;
            return;
          }

          const minLat = parseResult.geoBounds?.minLatDeg ?? 33.5;
          const maxLat = parseResult.geoBounds?.maxLatDeg ?? 35.5;
          const minLon = parseResult.geoBounds?.minLonDeg ?? 75.5;
          const maxLon = parseResult.geoBounds?.maxLonDeg ?? 77.5;
          const meta = {
            tileName: file.name,
            minLatDeg: minLat,
            maxLatDeg: maxLat,
            minLonDeg: minLon,
            maxLonDeg: maxLon,
            centerLatDeg: (minLat + maxLat) / 2.0,
            centerLonDeg: (minLon + maxLon) / 2.0,
            halfWidthM: 91839.9774,
            halfHeightM: 110931.4506,
            sampleCount: parseResult.width,
          };

          mainTerrainEngine.loadCustomDem(parseResult.elevationsM, meta);
          state.activeTerrainBounds = meta;
          state.pendingTerrainCenteringBounds = meta;
          actions.setMapLibreTerrainRaster(parseResult.elevationsM, meta);
          actions.invalidateToolboxCache();

          sendCustomDemZeroCopy(parseResult.elevationsM, meta);
          actions.sendCommand({ type: 'SET_TERRAIN_MODE', mode: 'real' });
          actions.sendCommand({ type: 'CONFIG_UPDATE', params: { terrain_mode: 'real' } });
          actions.requestTerrainMeshData(true);
          void persistOfflinePack(file.name, 'geotiff', buffer);

          window.centerMapOnTerrain(meta);

          statusBox.className = 'upload-status-box status-success';
          statusBox.textContent = `[OK] Loaded GeoTIFF ${file.name} (${parseResult.width}×${parseResult.height}, Elev: ${parseResult.minElevationM?.toFixed(0)}m–${parseResult.maxElevationM?.toFixed(0)}m MSL) · View Centered`;
          setTimeout(() => window.closeUploadModal && window.closeUploadModal(), 1500);
        } catch (err) {
          statusBox.className = 'upload-status-box status-error';
          statusBox.textContent = `[ERR] Failed to process GeoTIFF: ${err?.message || err}`;
        }
      };
      reader.onerror = () => {
        statusBox.className = 'upload-status-box status-error';
        statusBox.textContent = `[ERR] Failed to read file: ${file.name}`;
      };
      reader.readAsArrayBuffer(file);
    } else if (lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
          const offCanvas = document.createElement('canvas');
          offCanvas.width = 512;
          offCanvas.height = 512;
          const offCtx = offCanvas.getContext('2d');
          offCtx.drawImage(img, 0, 0, 512, 512);
          const pData = offCtx.getImageData(0, 0, 512, 512).data;
          const packedGrid = [];
          const floatElevations = new Float32Array(512 * 512);
          const minMsl = 2500;
          const maxMsl = 6000;
          for (let r = 0; r < 512; r++) {
            const row = [];
            for (let c = 0; c < 512; c++) {
              const idx = (r * 512 + c) * 4;
              const gray = pData[idx];
              const packed = (gray << 16) | (gray << 8) | gray;
              row.push(packed);
              floatElevations[r * 512 + c] = minMsl + (gray / 255.0) * (maxMsl - minMsl);
            }
            packedGrid.push(row);
          }
          actions.renderHillshadeFromWorker(packedGrid, 512, 300, 'real');

          // Forward elevations to worker so simulation uses this custom DEM!
          const meta = {
            ...REAL_LADAKH_DEM_METADATA,
            tileName: file.name.replace(/\.[^/.]+$/, '').toUpperCase(),
            minElevationM: minMsl,
            maxElevationM: maxMsl,
          };
          mainTerrainEngine.loadCustomDem(floatElevations, meta);
          state.activeTerrainBounds = meta;
          state.pendingTerrainCenteringBounds = meta;
          actions.setMapLibreTerrainRaster(floatElevations, meta);
          actions.invalidateToolboxCache();
          sendCustomDemZeroCopy(floatElevations, meta);
          actions.sendCommand({ type: 'SET_TERRAIN_MODE', mode: 'real' });
          actions.sendCommand({ type: 'CONFIG_UPDATE', params: { terrain_mode: 'real' } });
          actions.requestTerrainMeshData(true);

          window.centerMapOnTerrain(meta);

          statusBox.className = 'upload-status-box status-success';
          statusBox.textContent = `[OK] Custom Heightmap Processed (${file.name})`;
          setTimeout(() => window.closeUploadModal && window.closeUploadModal(), 1200);
        };
        img.onerror = () => {
          statusBox.className = 'upload-status-box status-error';
          statusBox.textContent = `[ERR] Failed to decode heightmap image: ${file.name}`;
        };
        img.src = evt.target.result;
      };
      reader.onerror = () => {
        statusBox.className = 'upload-status-box status-error';
        statusBox.textContent = `[ERR] Failed to read heightmap file: ${file.name}`;
      };
      reader.readAsDataURL(file);
    } else {
      statusBox.className = 'upload-status-box status-error';
      statusBox.textContent = 'Please provide an SRTM elevation file (.hgt) or image heightmap (.png, .jpg).';
    }
  };

  async function decodeTileFile(catalogTile) {
    const cached = tileCache.get(catalogTile.tileName);
    if (cached) return cached;

    const buffer = await catalogTile.file.arrayBuffer();
    const decode = decodeHgtBuffer(buffer, catalogTile.sampleCount);
    const decoded = {
      tileName: catalogTile.tileName,
      minLatDeg: catalogTile.minLatDeg,
      maxLatDeg: catalogTile.maxLatDeg,
      minLonDeg: catalogTile.minLonDeg,
      maxLonDeg: catalogTile.maxLonDeg,
      sampleCount: catalogTile.sampleCount,
      elevations: decode.elevations,
      minElevationM: decode.minElevationM,
      maxElevationM: decode.maxElevationM,
      voidCount: decode.voidCount,
    };
    tileCache.set(catalogTile.tileName, decoded);
    return decoded;
  }

  window.cancelHgtLoad = function() {
    if (activeHgtAbortController) {
      activeHgtAbortController.abort();
      activeHgtAbortController = null;
    }
    tileCache.clear();
    currentCatalog = [];
    currentClusters = [];
    activePatchSelection = null;
    resetTerrainFileInputs();
    setCustomDemControlsState({ loading: false, loaded: Boolean(state.activeTerrainBounds) });
    const statusBox = $('upload-status');
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.className = 'upload-status-box status-error';
      statusBox.textContent = '[CANCELLED] HGT load cancelled; buffers released.';
    }
  };

  window.unloadCustomTerrain = function() {
    if (activeHgtAbortController) {
      activeHgtAbortController.abort();
      activeHgtAbortController = null;
    }
    tileCache.clear();
    currentCatalog = [];
    currentClusters = [];
    activePatchSelection = null;
    resetTerrainFileInputs();

    mainTerrainEngine.hasRealDem = false;
    mainTerrainEngine.realDemGrid = null;
    if (typeof state.activeBiomeId === 'string' && state.activeBiomeId !== 'alpine_mountain') {
      mainTerrainEngine.setBiome(state.activeBiomeId);
    }
    state.activeTerrainBounds = null;
    state.pendingTerrainCenteringBounds = null;
    if (terrainTopViewport && typeof terrainTopViewport.clearPinnedBounds === 'function') {
      terrainTopViewport.clearPinnedBounds();
    }
    state.mapLibreTerrainRaster = null;

    actions.sendCommand({ type: 'UNLOAD_CUSTOM_TERRAIN' });
    actions.invalidateToolboxCache();
    actions.markRadarDirty();
    setCustomDemControlsState({ loading: false, loaded: false });

    const patchCtrl = $('folder-patch-controls');
    if (patchCtrl) patchCtrl.style.display = 'none';
    const statusBox = $('upload-status');
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.className = 'upload-status-box status-success';
      statusBox.textContent = '[OK] Custom DEM unloaded; built-in biome DEM restored and RAM freed.';
    }
  };

  window.loadActivePatch = async function(options) {
    const statusBox = $('upload-status');
    const patchCtrl = $('folder-patch-controls');
    statusBox.style.display = 'block';
    statusBox.className = 'upload-status-box status-loading';
    statusBox.textContent = `Selecting and stitching terrain patch...`;

    if (activeHgtAbortController) {
      activeHgtAbortController.abort();
    }
    const abortController = new AbortController();
    activeHgtAbortController = abortController;
    setCustomDemControlsState({ loading: true, loaded: Boolean(state.activeTerrainBounds) });

    try {
      const patch = selectActivePatch(options);
      if (!patch || patch.tiles.length === 0) {
        statusBox.className = 'upload-status-box status-error';
        statusBox.textContent = `[ERR] Could not select a valid terrain patch from catalog.`;
        setCustomDemControlsState({ loading: false, loaded: Boolean(state.activeTerrainBounds) });
        return;
      }
      activePatchSelection = patch;

      statusBox.textContent = `Decoding ${patch.tiles.length} active patch tile(s) [${patch.tiles.map(t => t.tileName).join(', ')}]...`;
      const mosaic = await decodeAndStitchPatchAsync(patch, {
        signal: abortController.signal,
        cache: tileCache,
        onProgress: (loaded, total, phase) => {
          if (abortController.signal.aborted) return;
          statusBox.textContent = `HGT ${phase}: ${loaded}/${total} tile(s) [${patch.tiles.map(t => t.tileName).join(', ')}]...`;
        },
      });
      if (abortController.signal.aborted) return;

      mainTerrainEngine.loadCustomDem(mosaic.elevations, mosaic.metadata);
      state.activeTerrainBounds = mosaic.metadata;
      state.pendingTerrainCenteringBounds = mosaic.metadata;
      actions.setMapLibreTerrainRaster(mosaic.elevations, mosaic.metadata);
      actions.invalidateToolboxCache();

      // Send LOAD_CUSTOM_DEM zero-copy to worker
      sendCustomDemZeroCopy(mosaic.elevations, mosaic.metadata);
      actions.sendCommand({ type: 'SET_TERRAIN_MODE', mode: 'real' });
      actions.sendCommand({ type: 'CONFIG_UPDATE', params: { terrain_mode: 'real' } });
      actions.requestTerrainMeshData(true);

      // Center views on the stitched mosaic bounds
      window.centerMapOnTerrain(mosaic.metadata);

      statusBox.className = 'upload-status-box status-success';
      const tileCountStr = `${patch.tiles.length} tile${patch.tiles.length > 1 ? 's' : ''}`;
      statusBox.textContent = `[OK] Stitched & Loaded ${tileCountStr}: ${mosaic.metadata.tileName} (${mosaic.rasterWidth}×${mosaic.rasterHeight}, Elev: ${mosaic.minElevationM.toFixed(0)}m–${mosaic.maxElevationM.toFixed(0)}m MSL, Voids: ${mosaic.voidCount}) · View Centered`;

      if (patchCtrl) {
        renderFolderPatchControls(patchCtrl, patch, currentCatalog, currentClusters, mosaic);
      }
    } catch (err) {
      if (err?.name === 'AbortError' || abortController.signal.aborted) {
        statusBox.className = 'upload-status-box status-error';
        statusBox.textContent = '[CANCELLED] HGT load cancelled; buffers released.';
      } else {
        statusBox.className = 'upload-status-box status-error';
        statusBox.textContent = `[ERR] Failed to stitch patch: ${err?.message || err}`;
      }
      setCustomDemControlsState({ loading: false, loaded: Boolean(state.activeTerrainBounds) });
    } finally {
      if (activeHgtAbortController === abortController) {
        activeHgtAbortController = null;
      }
    }
  };

  window.shiftTerrainPatch = async function(dLat, dLon) {
    if (!activePatchSelection || currentCatalog.length === 0) return;
    const currentAnchor = currentCatalog.find(t => t.tileName === activePatchSelection.anchorTileName);
    if (!currentAnchor) return;

    const targetLat = currentAnchor.minLatDeg + dLat + 0.5;
    const targetLon = currentAnchor.minLonDeg + dLon + 0.5;

    await window.loadActivePatch({
      catalog: currentCatalog,
      targetLatDeg: targetLat,
      targetLonDeg: targetLon,
      maxTiles: 4,
    });
  };

  function renderFolderPatchControls(container, patch, catalog, clusters, mosaic) {
    container.style.display = 'block';
    const totalTiles = catalog.length;
    const activeCount = patch.tiles.length;
    const missingCount = patch.missingNeighbourNames.length;

    let clusterSummary = '';
    if (clusters.length > 1) {
      clusterSummary = `<div style="color:#b3afa7;margin-bottom:6px">Discovered <b>${totalTiles}</b> valid HGT tiles across <b>${clusters.length}</b> separate geographic clusters.</div>`;
    } else {
      clusterSummary = `<div style="color:#b3afa7;margin-bottom:6px">Discovered <b>${totalTiles}</b> valid contiguous HGT tiles in folder.</div>`;
    }

    let patchInfo = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:600;color:#e09f3e">Active Patch (${patch.rows}×${patch.cols} deg, ${activeCount} tiles loaded):</span>
        <span style="color:#96928a;font-family:monospace">${mosaic.rasterWidth}×${mosaic.rasterHeight} px</span>
      </div>
      <div style="font-family:monospace;font-size:11px;background:#111316;padding:6px 8px;border-radius:4px;border:1px solid #2e3440;margin-bottom:8px;word-break:break-all">
        ${patch.tiles.map(t => `<span style="color:#52b788;display:inline-block;margin-right:6px">[OK] ${t.tileName}</span>`).join('')}
      </div>
    `;

    if (missingCount > 0) {
      patchInfo += `
        <div style="color:#e9c46a;font-size:11px;margin-bottom:8px">
          [WARN] Missing in bounding patch: ${patch.missingNeighbourNames.join(', ')} (unmapped void filled with NaN)
        </div>
      `;
    }

    let navButtons = '';
    if (totalTiles > 4) {
      navButtons = `
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid #2e3440">
          <div style="font-size:11px;color:#b3afa7;margin-bottom:6px">Shift Active Patch across folder:</div>
          <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">
            <button type="button" class="btn-sm" data-shift-lat="1" data-shift-lon="0" title="Shift patch North by 1°">▲ North (+1°)</button>
            <button type="button" class="btn-sm" data-shift-lat="-1" data-shift-lon="0" title="Shift patch South by 1°">▼ South (-1°)</button>
            <button type="button" class="btn-sm" data-shift-lat="0" data-shift-lon="-1" title="Shift patch West by 1°">◄ West (-1°)</button>
            <button type="button" class="btn-sm" data-shift-lat="0" data-shift-lon="1" title="Shift patch East by 1°">► East (+1°)</button>
          </div>
        </div>
      `;
    }

    const closeBtn = `<button type="button" class="btn-sm" data-action="close-upload-modal" style="margin-top:10px;width:100%;background:#252a33;color:#f2efe9;border:1px solid #3d4554;padding:6px;border-radius:4px;cursor:pointer">Done / Close Modal</button>`;

    container.innerHTML = clusterSummary + patchInfo + navButtons + closeBtn;
    container.querySelectorAll('[data-shift-lat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dLat = Number(btn.getAttribute('data-shift-lat'));
        const dLon = Number(btn.getAttribute('data-shift-lon'));
        window.shiftTerrainPatch?.(dLat, dLon);
      });
    });
    container.querySelector('[data-action="close-upload-modal"]')?.addEventListener('click', () => {
      window.closeUploadModal?.();
    });
  }

  window.onFolderSelected = async function(fileList) {
    if (!fileList || fileList.length === 0) return;
    const statusBox = $('upload-status');
    const patchCtrl = $('folder-patch-controls');
    statusBox.style.display = 'block';
    statusBox.className = 'upload-status-box status-loading';
    statusBox.textContent = `Scanning folder for SRTM .hgt elevation files...`;

    try {
      currentCatalog = buildTileCatalog(fileList);
      if (currentCatalog.length === 0) {
        statusBox.className = 'upload-status-box status-error';
        statusBox.textContent = `[ERR] No valid SRTM .hgt files found in selected folder. Expected naming [NS]XX[EW]YYY.hgt.`;
        if (patchCtrl) patchCtrl.style.display = 'none';
        return;
      }

      currentClusters = clusterNeighbouringTiles(currentCatalog);

      // If only 1 file in catalog, load as single tile
      if (currentCatalog.length === 1) {
        window.onFileSelected(currentCatalog[0].file);
        return;
      }

      // Select initial active patch around theater center (34.5°N, 76.5°E) or first tile
      await window.loadActivePatch({ catalog: currentCatalog, maxTiles: 4 });
    } catch (err) {
      statusBox.className = 'upload-status-box status-error';
      statusBox.textContent = `[ERR] Folder processing error: ${err?.message || err}`;
    }
  };

  Object.assign(actions, {
    setCustomDemControlsState,
    sendCustomDemZeroCopy,
    resetTerrainFileInputs,
    invokeTauriOfflineIpc,
    persistOfflinePack,
    refreshOfflinePackList,
    getTerrainLayout,
    openUploadModal,
    closeUploadModal,
    onDragOver,
    onDragLeave,
    onDropFile,
    decodeTileFile,
  });
}
