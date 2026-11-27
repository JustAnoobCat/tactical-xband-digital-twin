/**
 * Programmatic DOM Event Bindings, Window Compatibility API, Destructive Confirm Guard,
 * Authoring/Simulation/Biome Controls, Map Layers Panel & Tab/Resize Orchestration.
 * Zero inline event handlers / strict Electron CSP compliant.
 */
import type { AppContext } from './appContext.ts';
import { MIN_RADAR_RANGE_M } from './appContext.ts';
import type { MapLayerId } from '../ui/workbench/mapLayerRegistry.ts';
import type { BiomeId, PolarizationMode } from '../shared/workerProtocol.ts';
import { PLAYBACK_SPEED } from '../shared/constants.ts';
import { resolveSectorTheaterTarget } from '../ui/worldTileLayer.ts';
import { BIOME_DEM_METADATA } from '../core/terrain.ts';
import {
  buildNodeAddCommand,
  buildNodeDeleteCommand,
  buildNodeDuplicateCommand,
  buildNodeUpdateCommand,
  validateNodeCoordinates,
  validateNodeAglHeight,
  validateNodeCallsign,
  validateNodeTxPower,
  validateNodeBatteryCapacity,
  validateNodeBatteryLevel,
  validateNodeTacticalPriority,
  validateNodeColorHex,
} from '../ui/nodeInventory.ts';
import {
  validateNodeAgl,
  checkAglEditEligibility,
  buildAglConfigUpdateCommand,
} from '../ui/nodeAglController.ts';
import { syncCanvasDpr } from '../ui/pathProfileTopView.ts';
import { getLatticeCanvasPalette } from '../ui/canvasTheme.ts';
import { MapLayersPanel } from '../ui/workbench/mapLayersPanel.ts';
import {
  collectTeamsFromNodes,
  DEFAULT_TACTICAL_TEAMS,
  nodeMatchesTeam,
  normalizeTeamId,
  parseTeamSelection,
} from '../core/nodeRegistry.ts';
import { shouldDeferSelectMutation } from '../ui/controllers/telemetryDomUpdaters.ts';

const TABS = [
  'tab-overview',
  'tab-scheduler',
  'tab-network',
  'tab-terrain',
  'tab-terminal',
  'tab-authoring',
  'tab-doc',
  'tab-registration',
  'tab-soldier',
];

export function initDomEventBindings(ctx: AppContext): { finalizeDomSetup: () => void } {
  const { state, engines, canvases, dom, actions } = ctx;
  const { $, setText, resolveBundledAssetUrl } = dom;
  const {
    telemetryUpdaters,
    trajectoryEditor,
    obstacleEditor,
    mapLayerRegistry,
    historyController,
    schedHistoryController,
    sessionCoordinator,
    simSpatialBuffer,
    simEpochStore,
    dataCommVisualizer,
    networkTrafficTracker,
    diagnosticsTracker,
    flightRecorder,
    terrainTopViewport,
    offlinePackStore,
  } = engines;
  const {
    radarCanvas,
    waterfallCanvas,
    terrainCanvas,
    polarAntennaCanvas,
    linkWaterfallCanvas,
  } = canvases;

  (window as any).resolveBundledDemUrl = () => resolveBundledAssetUrl('terrain/real_ladakh_dem.bin');

  function isDiagnosticsPanelVisible() {
    return Boolean($('tab-doc')?.classList.contains('active') && state.currentDocSubview === 'diag');
  }

  (window as any).switchOverviewSubview = function (subview: string) {
    state.currentOverviewSubview = subview === 'authoring' ? 'authoring' : 'ops';
    (window as any).switchMainTab?.(
      state.currentOverviewSubview === 'authoring' ? 'tab-authoring' : 'tab-overview'
    );
  };

  (window as any).switchAuthoringPane = function (pane: string) {
    state.currentAuthoringPane = pane === 'tdma' || pane === 'obs' ? pane : 'traj';
    ['traj', 'tdma', 'obs'].forEach((key) => {
      const active = key === state.currentAuthoringPane;
      const el = $(`authoring-pane-${key}`);
      const btn = $(`btn-author-tab-${key}`);
      if (el) el.classList.toggle('active', active);
      if (btn) {
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
      }
    });
  };

  (window as any).switchDocSubview = function (subview: string) {
    state.currentDocSubview = subview === 'ref' ? 'ref' : 'diag';
    const isDiag = state.currentDocSubview === 'diag';
    const diagPane = $('doc-subview-diag');
    const refPane = $('doc-subview-ref');
    const btnDiag = $('btn-doc-subview-diag');
    const btnRef = $('btn-doc-subview-ref');
    if (diagPane) diagPane.hidden = !isDiag;
    if (refPane) refPane.hidden = isDiag;
    if (btnDiag) {
      btnDiag.classList.toggle('active', isDiag);
      btnDiag.setAttribute('aria-selected', String(isDiag));
    }
    if (btnRef) {
      btnRef.classList.toggle('active', !isDiag);
      btnRef.setAttribute('aria-selected', String(!isDiag));
    }
    if (isDiag) {
      if (typeof state.latestTelemetry !== 'undefined' && state.latestTelemetry) {
        diagnosticsTracker.renderIntoDom(
          state.latestTelemetry,
          {
            spatialCount: simSpatialBuffer.count,
            spatialCapacity: simSpatialBuffer.capacity,
            epochCount: simEpochStore.count,
            epochCapacity: simEpochStore.capacity,
          },
          {
            cadenceId: 'diag-ipc-cadence',
            jitterId: 'diag-ipc-jitter',
            pacingId: 'diag-worker-pacing',
            lookaheadSummaryId: 'diag-lookahead-state',
            buffersId: 'diag-history-buffers',
            revisionId: 'diag-revision-meta',
            jsonId: 'diag-raw-json-pre',
          },
          { force: true, isPanelVisible: true }
        );
      }
      (window as any).renderWorkerJitterProfiler?.(
        typeof state.latestTelemetry !== 'undefined' ? state.latestTelemetry : null
      );
      (window as any).renderTwinCalibrationScope?.();
      actions.getSystemHealthHud().update({
        frame: typeof state.latestTelemetry !== 'undefined' ? state.latestTelemetry : null,
        rollingStepSamples: state.rollingWorkerStepSamples,
        rollingInterFrameDeltas: state.rollingWorkerInterFrameDeltas,
        recordedEventsCount: flightRecorder.getEventCount(),
      });
    }
  };

  (window as any).toggleDiagJsonExpand = function () {
    const next = !diagnosticsTracker.getExpandRawJson();
    diagnosticsTracker.setExpandRawJson(next);
    const btn = $('btn-diag-json-expand');
    if (btn) btn.textContent = next ? 'Summary View' : 'Expand Full Payload';
    if (typeof state.latestTelemetry !== 'undefined' && state.latestTelemetry) {
      diagnosticsTracker.renderIntoDom(
        state.latestTelemetry,
        {
          spatialCount: simSpatialBuffer.count,
          spatialCapacity: simSpatialBuffer.capacity,
          epochCount: simEpochStore.count,
          epochCapacity: simEpochStore.capacity,
        },
        {
          cadenceId: 'diag-ipc-cadence',
          jitterId: 'diag-ipc-jitter',
          pacingId: 'diag-worker-pacing',
          lookaheadSummaryId: 'diag-lookahead-state',
          buffersId: 'diag-history-buffers',
          revisionId: 'diag-revision-meta',
          jsonId: 'diag-raw-json-pre',
        },
        { force: true, isPanelVisible: true }
      );
      actions.getSystemHealthHud().update({
        frame: state.latestTelemetry,
        rollingStepSamples: state.rollingWorkerStepSamples,
        rollingInterFrameDeltas: state.rollingWorkerInterFrameDeltas,
        recordedEventsCount: flightRecorder.getEventCount(),
      });
    }
  };

  function isNeutralMapSelectionMode() {
    return (
      state.terrainToolMode === 'idle' &&
      obstacleEditor.mode === 'navigate' &&
      !state.waypointPlacementArmed &&
      trajectoryEditor.activeMode !== 'waypoints'
    );
  }

  function dismissNodeInspector() {
    state.inspectingAcn = false;
    state.inspectorDismissed = true;
    state.nodeMoveModeActive = false;
    $('map-node-details')?.classList.add('is-closed');
    disarmAllDestructiveConfirmations?.();
    syncEditModeBanner();
    syncFloatingOverlayLayout();
  }
  (window as any).dismissNodeInspector = dismissNodeInspector;

  const armedConfirmRegistry = new Map<
    HTMLElement,
    { timerId: any; originalLabel: string; armedAtMs: number }
  >();
  let destructiveConfirmListenersInstalled = false;

  function disarmDestructiveButton(buttonEl: HTMLElement) {
    const entry = armedConfirmRegistry.get(buttonEl);
    if (!entry) return;
    clearTimeout(entry.timerId);
    armedConfirmRegistry.delete(buttonEl);
    buttonEl.removeAttribute('data-confirm-armed');
    buttonEl.classList.remove('is-confirm-armed');
    if (entry.originalLabel !== undefined) {
      buttonEl.textContent = entry.originalLabel;
    }
  }
  (window as any).disarmDestructiveButton = disarmDestructiveButton;

  function disarmAllDestructiveConfirmations(exceptEl: HTMLElement | null = null) {
    for (const btn of Array.from(armedConfirmRegistry.keys())) {
      if (btn !== exceptEl) disarmDestructiveButton(btn);
    }
  }

  const armedConfirmAttached = new WeakSet<HTMLElement>();

  function armDestructiveConfirm(
    buttonEl: HTMLElement | null,
    {
      armedLabel = 'Confirm?',
      timeoutMs = 4000,
      canArm = () => true,
      onBlocked = null,
      onConfirm,
    }: {
      armedLabel?: string;
      timeoutMs?: number;
      canArm?: () => boolean;
      onBlocked?: (() => void) | null;
      onConfirm: () => void;
    }
  ) {
    if (!buttonEl || typeof onConfirm !== 'function' || armedConfirmAttached.has(buttonEl)) return;
    armedConfirmAttached.add(buttonEl);
    if (!destructiveConfirmListenersInstalled) {
      destructiveConfirmListenersInstalled = true;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') disarmAllDestructiveConfirmations();
      });
      document.addEventListener(
        'pointerdown',
        (e) => {
          if (armedConfirmRegistry.size === 0) return;
          const target = e.target as Node | null;
          for (const btn of Array.from(armedConfirmRegistry.keys())) {
            if (!target || (btn !== target && !btn.contains(target))) {
              disarmDestructiveButton(btn);
            }
          }
        },
        true
      );
      document.addEventListener(
        'focusin',
        (e) => {
          if (armedConfirmRegistry.size === 0) return;
          const target = e.target as Node | null;
          if (!target || target === (document as any) || target === (window as any)) return;
          const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          for (const [btn, entry] of Array.from(armedConfirmRegistry.entries())) {
            if (nowMs - entry.armedAtMs < 50) continue;
            if (btn !== target && !btn.contains(target)) {
              disarmDestructiveButton(btn);
            }
          }
        },
        true
      );
    }

    buttonEl.addEventListener('click', (e) => {
      e?.stopPropagation?.();
      if (!canArm()) {
        disarmDestructiveButton(buttonEl);
        onBlocked?.();
        return;
      }
      if (buttonEl.getAttribute('data-confirm-armed') === 'true') {
        disarmDestructiveButton(buttonEl);
        if (!canArm()) {
          onBlocked?.();
          return;
        }
        onConfirm();
        return;
      }
      disarmAllDestructiveConfirmations(buttonEl);
      const originalLabel = buttonEl.textContent ?? '';
      const armedAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const timerId = setTimeout(() => {
        disarmDestructiveButton(buttonEl);
      }, timeoutMs);
      armedConfirmRegistry.set(buttonEl, { timerId, originalLabel, armedAtMs });
      buttonEl.setAttribute('data-confirm-armed', 'true');
      buttonEl.classList.add('is-confirm-armed');
      buttonEl.textContent = armedLabel;
    });
  }

  function syncFloatingOverlayLayout() {
    const container = $('radar-container');
    const inspector = $('map-node-details');
    const legend = document.querySelector('.map-legend') as HTMLElement | null;
    const legendBtn = $('btn-legend-toggle');
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const cw = containerRect.width || container.clientWidth || 0;
    const ch = containerRect.height || container.clientHeight || 0;
    const layersOpen = container.getAttribute('data-layers-open') === 'true';
    let anchor = 'bottom-right';
    if (layersOpen) {
      anchor = cw >= 580 ? 'offset-left' : 'top-right';
    }

    let legendVisible = Boolean(
      legend &&
        !legend.classList.contains('is-collapsed') &&
        getComputedStyle(legend).display !== 'none'
    );
    let legendBottom = legendVisible
      ? Math.max(0, Math.ceil(legend!.getBoundingClientRect().bottom - containerRect.top))
      : 0;
    let clearanceTop = legendVisible ? legendBottom + 8 : 10;

    const inspectorVisible = Boolean(
      inspector &&
        !inspector.classList.contains('is-empty') &&
        !inspector.classList.contains('is-closed') &&
        getComputedStyle(inspector).display !== 'none'
    );

    if (layersOpen && anchor === 'top-right' && inspectorVisible) {
      const testAvail = ch - clearanceTop - 56;
      if (
        !legend?.classList.contains('is-user-expanded') &&
        (cw < 360 || ch < 320 || testAvail * 0.44 < 120 || testAvail * 0.5 < 120)
      ) {
        if (legendVisible && legend) {
          legend.classList.add('is-collapsed');
          legend.classList.remove('is-user-expanded');
          legendBtn?.classList.remove('active');
          legendBtn?.setAttribute('aria-pressed', 'false');
          legendVisible = false;
          legendBottom = 0;
          clearanceTop = 10;
        }
      }
    }

    container.style.setProperty('--legend-bottom-clearance', `${clearanceTop}px`);

    let layersMaxH = Math.max(120, Math.min(460, ch - clearanceTop - 56));
    let layersTopClearance = clearanceTop;

    if (inspector) {
      inspector.setAttribute('data-inspector-anchor', anchor);
      let maxInspH;
      if (layersOpen && anchor === 'top-right' && inspectorVisible) {
        const availableH = Math.max(240, ch - clearanceTop - 56);
        maxInspH = Math.max(120, Math.floor(availableH * 0.44));
        layersMaxH = Math.max(120, Math.floor(availableH * 0.5));
      } else {
        maxInspH =
          anchor === 'top-right'
            ? Math.max(120, Math.min(200, Math.floor((ch - 64 - clearanceTop) * 0.45)))
            : Math.max(140, Math.min(360, ch - 48 - clearanceTop));
      }
      inspector.style.setProperty('--inspector-max-height', `${maxInspH}px`);
    }

    if (layersOpen && anchor === 'top-right' && inspectorVisible && inspector) {
      const inspRect = inspector.getBoundingClientRect();
      layersTopClearance = Math.max(
        clearanceTop,
        Math.ceil(inspRect.bottom - containerRect.top + 8)
      );
    }
    container.style.setProperty('--layers-top-clearance', `${layersTopClearance}px`);
    container.style.setProperty('--layers-max-height', `${layersMaxH}px`);
  }

  function syncEditModeBanner() {
    const stage = $('radar-stage');
    const banner = $('edit-mode-banner');
    const badge = $('edit-mode-badge');
    const text = $('edit-mode-text');
    const doneBtn = $('edit-mode-done-btn');
    const cancelBtn = $('edit-mode-cancel-btn');
    if (!stage || !banner) return;

    const obsActive = typeof obstacleEditor !== 'undefined' && obstacleEditor?.mode !== 'navigate';
    const wpActive = Boolean(
      typeof state.waypointPlacementArmed !== 'undefined' && state.waypointPlacementArmed
    );
    const eqActive = Boolean(
      typeof state.equipmentPlacementArmed !== 'undefined' && state.equipmentPlacementArmed
    );
    const moveActive = Boolean(
      typeof state.nodeMoveModeActive !== 'undefined' && state.nodeMoveModeActive
    );
    const active = obsActive || wpActive || eqActive || moveActive;

    stage.setAttribute('data-edit-mode', active ? 'active' : 'idle');
    banner.hidden = !active;
    if (!active) return;

    if (eqActive) {
      const eqType = ($<HTMLSelectElement>('equip-type-select')?.value || 'barrage_jammer').replace(/_/g, ' ');
      if (badge) badge.textContent = 'DEPLOY EQUIPMENT';
      if (text) text.textContent = `Click 2D Radar to place ${eqType} (Esc to cancel)`;
      if (doneBtn) doneBtn.textContent = 'Done';
      if (cancelBtn) cancelBtn.hidden = false;
    } else if (moveActive) {
      if (badge) badge.textContent = 'MOVE NODE';
      if (text) text.textContent = 'Drag highlighted terminal marker on map to reposition';
      if (doneBtn) doneBtn.textContent = 'Done';
      if (cancelBtn) cancelBtn.hidden = true;
    } else if (wpActive) {
      if (badge) badge.textContent = 'TRAJECTORY EDIT';
      if (text) text.textContent = 'Click map to place draft waypoint';
      if (doneBtn) doneBtn.textContent = 'Done';
      if (cancelBtn) cancelBtn.hidden = false;
    } else if (obsActive) {
      if (badge) badge.textContent = `OBSTACLE EDIT · ${obstacleEditor.mode.toUpperCase()}`;
      if (text)
        text.textContent =
          obstacleEditor.mode === 'place'
            ? 'Click map to place obstacle footprint'
            : 'Click or drag obstacle footprints on map';
      if (doneBtn) doneBtn.textContent = 'Done';
      if (cancelBtn) cancelBtn.hidden = false;
    }
  }

  function syncRadarHudMode() {
    const stage = $('radar-stage');
    if (!stage) return;
    const is3d = typeof state.stageViewMode !== 'undefined' && state.stageViewMode === '3d';
    const isMapLibre =
      !is3d &&
      typeof state.terrainMapMode !== 'undefined' &&
      state.terrainMapMode === 'maplibre';
    stage.setAttribute('data-map-renderer', is3d ? '3d' : isMapLibre ? 'maplibre' : 'radar');
    syncEditModeBanner();
    if (is3d) {
      stage.setAttribute('data-hud-mode', '3d');
      return;
    }
    const locked = Boolean(typeof state.spatialLocked !== 'undefined' && state.spatialLocked);
    const placingWp = Boolean(
      typeof state.waypointPlacementArmed !== 'undefined' && state.waypointPlacementArmed
    );
    const placingEq = Boolean(
      typeof state.equipmentPlacementArmed !== 'undefined' && state.equipmentPlacementArmed
    );
    const obsActive = Boolean(
      typeof obstacleEditor !== 'undefined' && obstacleEditor?.mode !== 'navigate'
    );
    if (locked || placingWp || placingEq || obsActive) {
      stage.setAttribute('data-hud-mode', 'locked');
      const pill = $('radar-hud-locked-pill');
      if (pill) {
        if (placingEq) pill.textContent = 'EQUIPMENT PLACEMENT ARMED · Click map (Esc cancels)';
        else if (placingWp) pill.textContent = 'WAYPOINT PLACEMENT ARMED · Click map';
        else if (obsActive)
          pill.textContent = `OBSTACLE TOOL (${obstacleEditor.mode.toUpperCase()}) · Active`;
        else pill.textContent = 'SPATIAL LOCK ACTIVE · Edits suspended';
      }
    } else {
      stage.setAttribute('data-hud-mode', 'cursor');
    }
  }

  const sharedContextualMapCtx = {
    selectedNodeId: null as number | null,
    isTrajectoryEditing: false,
    isObstacleEditing: false,
    zoomRangeM: 60000,
  };

  function getContextualMapContext() {
    sharedContextualMapCtx.selectedNodeId = state.selectedNodeId >= 0 ? state.selectedNodeId : null;
    sharedContextualMapCtx.isTrajectoryEditing =
      trajectoryEditor.activeMode === 'waypoints' || trajectoryEditor.dirty;
    sharedContextualMapCtx.isObstacleEditing = obstacleEditor.mode !== 'navigate';
    sharedContextualMapCtx.zoomRangeM = Number.isFinite(state.currentRadarRangeM)
      ? state.currentRadarRangeM
      : 60000;
    return sharedContextualMapCtx;
  }

  function syncMapLegendVisibility() {
    const legend = document.querySelector('.map-legend');
    if (!legend) return;
    const mctx = getContextualMapContext();
    const spans = legend.querySelectorAll('span[data-legend-layer]');
    spans.forEach((span) => {
      const layerId = span.getAttribute('data-legend-layer') as MapLayerId | null;
      const vis = layerId ? mapLayerRegistry.getEffectiveVisibility(layerId, mctx) : true;
      span.classList.toggle('is-legend-hidden', !vis);
    });
  }

  function syncRfQuickToggleButtons() {
    const losBtn = $('btn-node-quick-los');
    const fresnelBtn = $('btn-node-quick-fresnel');
    const losActive = mapLayerRegistry.isLayerVisible('rf.losAnalysis');
    const fresnelActive = mapLayerRegistry.isLayerVisible('rf.fresnelZone');
    if (losBtn) {
      losBtn.classList.toggle('active', losActive);
      losBtn.setAttribute('aria-pressed', losActive ? 'true' : 'false');
    }
    if (fresnelBtn) {
      fresnelBtn.classList.toggle('active', fresnelActive);
      fresnelBtn.setAttribute('aria-pressed', fresnelActive ? 'true' : 'false');
    }
  }

  function applyThreeLayerVisibility() {
    if (!state.threeController) return;
    const mctx = getContextualMapContext();
    state.threeController.applyLayerVisibility({
      baseTerrain: mapLayerRegistry.getEffectiveVisibility('base.terrainDem', mctx),
      datumGrid: mapLayerRegistry.getEffectiveVisibility('base.rangeGrid', mctx),
      acn: mapLayerRegistry.getEffectiveVisibility('entities.acn', mctx),
      groundNodes: mapLayerRegistry.getEffectiveVisibility('entities.groundNodes', mctx),
      labels: mapLayerRegistry.getEffectiveVisibility('entities.labels', mctx),
      trajectory: mapLayerRegistry.getEffectiveVisibility('entities.trajectory', mctx),
      links: mapLayerRegistry.getEffectiveVisibility('comm.links', mctx),
      transmissions: mapLayerRegistry.getEffectiveVisibility('comm.transmissions', mctx),
    });
  }

  function applyMapLayersToAllRenderers() {
    syncMapLegendVisibility();
    syncRfQuickToggleButtons();
    applyThreeLayerVisibility();
    actions.markRadarDirty();
    state.mapLibreTerrainVisible = mapLayerRegistry.isLayerVisible('base.terrainDem');
    state.mapLibreTerrainOpacity = mapLayerRegistry.getLayerOpacity('base.terrainDem');
    const demCb = $<HTMLInputElement>('tb-toggle-dem-layer');
    if (demCb) demCb.checked = state.mapLibreTerrainVisible;
    const contCb = $<HTMLInputElement>('tb-toggle-contours-layer');
    if (contCb) contCb.checked = mapLayerRegistry.isLayerVisible('base.contours');
    actions.applyMapLibreLayerState();
    if (state.terrainMapMode === 'maplibre') {
      actions.updateMapLibreOverlay();
    }
    if (state.stageViewMode !== '3d') {
      actions.drawRadar();
    }
  }

  function restoreFlightParamsFromCommitted() {
    const spdInp = $<HTMLInputElement>('traj-speed-mps');
    const spdSlider = $<HTMLInputElement>('traj-speed-slider');
    if (spdInp) spdInp.value = String(state.committedFlightParams.loiter_speed_mps);
    if (spdSlider)
      spdSlider.value = String(
        Math.min(300, Math.max(0, state.committedFlightParams.loiter_speed_mps))
      );

    const altInp = $<HTMLInputElement>('traj-altitude-msl');
    if (altInp) altInp.value = String(state.committedFlightParams.acn_altitude_m);

    const modeSel = $<HTMLSelectElement>('traj-altitude-mode');
    if (modeSel) {
      modeSel.value = state.committedFlightParams.altitude_mode;
      updateAltitudeModeUI(state.committedFlightParams.altitude_mode);
    }

    const aglInp = $<HTMLInputElement>('traj-target-agl');
    if (aglInp) aglInp.value = String(state.committedFlightParams.target_agl_m);

    const climbInp = $<HTMLInputElement>('traj-climb-rate');
    if (climbInp) climbInp.value = String(state.committedFlightParams.max_climb_rate_mps);

    const descInp = $<HTMLInputElement>('traj-descent-rate');
    if (descInp) descInp.value = String(state.committedFlightParams.max_descent_rate_mps);
  }

  const disarmEquipmentPlacement = (statusText?: string) => {
    if (!state.equipmentPlacementArmed) return;
    state.equipmentPlacementArmed = false;
    const btn = $('btn-equip-place-map');
    if (btn) {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = 'Place on Map';
    }
    if (statusText !== undefined) setText('equip-placement-status', statusText);
    const rc = $('radar-canvas');
    if (rc) rc.style.cursor = 'crosshair';
    syncRadarHudMode();
    actions.updateMapLibreCursor();
  };

  function syncMapNodeDragVisibility(isDragging: boolean) {
    const details = $('map-node-details');
    if (details) {
      details.classList.toggle('is-dragging-hidden', Boolean(isDragging));
    }
  }

  function updateSpatialLockControl(locked: boolean) {
    if (state.spatialLockControlSynced && locked === state.spatialLocked) return;
    state.spatialLockControlSynced = true;
    state.spatialLocked = locked;

    const details = $('map-node-details');
    if (details) {
      details.dataset.lockMode = locked ? 'locked' : 'unlocked';
    }
    if (locked) {
      state.nodeMoveModeActive = false;
      disarmEquipmentPlacement('Spatial lock active — equipment placement canceled.');
    }
    obstacleEditor.setSpatialLock(locked);
    const button = $('btn-spatial-lock');
    if (button) {
      button.textContent = locked ? 'Scenario Locked' : 'Lock Scenario';
      button.setAttribute('aria-pressed', String(locked));
      button.classList.toggle('active', locked);
    }
    syncRadarHudMode();
    refreshTrajectoryEditor();
    refreshObstacleEditor();
    syncSelectedNodeAglUI();
    actions.renderSelectedNodeDetails();
  }

  // Thin authoring delegation wrappers
  function setTrajectoryMessage(message: string, error = false) {
    actions.getDashboardAndAuthoringController().setTrajectoryMessage(message, error);
  }
  function updateAltitudeModeUI(mode: string) {
    actions.getDashboardAndAuthoringController().updateAltitudeModeUI(mode);
  }
  function syncTrajectoryEditorFromWorker(config: any) {
    actions.getDashboardAndAuthoringController().syncTrajectoryEditorFromWorker(config);
  }
  function setTrajectoryDraftMode(mode: 'ellipse' | 'waypoints') {
    actions.getDashboardAndAuthoringController().setTrajectoryDraftMode(mode);
  }
  function refreshTrajectoryEditor() {
    actions.getDashboardAndAuthoringController().refreshTrajectoryEditor();
  }
  function addWaypointAt(x: number, y: number) {
    actions.getDashboardAndAuthoringController().addWaypointAt(x, y);
  }
  function applyTrajectoryDraft() {
    actions.getDashboardAndAuthoringController().applyTrajectoryDraft();
  }
  function cancelTrajectoryDraft() {
    actions.getDashboardAndAuthoringController().cancelTrajectoryDraft();
  }
  function editEllipseFromInputs() {
    actions.getDashboardAndAuthoringController().editEllipseFromInputs();
  }
  function editSelectedWaypointFromInputs() {
    actions.getDashboardAndAuthoringController().editSelectedWaypointFromInputs();
  }
  function renderFlightPlanVerticalProfile() {
    actions.getDashboardAndAuthoringController().renderFlightPlanVerticalProfile();
  }
  function getObstacleEndpoints(obs: any) {
    return actions.getDashboardAndAuthoringController().getObstacleEndpoints(obs);
  }
  function renderObstacleInventoryList() {
    actions.getDashboardAndAuthoringController().renderObstacleInventoryList();
  }
  function applyObstacleHistoryChange(nextObstacles: any[]) {
    actions.getDashboardAndAuthoringController().applyObstacleHistoryChange(nextObstacles);
  }
  function recomputeCadObstacleAnalysis() {
    actions.getDashboardAndAuthoringController().recomputeCadObstacleAnalysis();
  }
  function refreshObstacleEditor() {
    actions.getDashboardAndAuthoringController().refreshObstacleEditor();
  }
  function editSelectedObstacleFromInputs(id: string) {
    actions.getDashboardAndAuthoringController().editSelectedObstacleFromInputs(id);
  }
  function createObstacleAt(x: number, y: number) {
    actions.getDashboardAndAuthoringController().createObstacleAt(x, y);
  }
  function applyObstacleDraft() {
    actions.getDashboardAndAuthoringController().applyObstacleDraft();
  }
  function cancelObstacleDraft() {
    actions.getDashboardAndAuthoringController().cancelObstacleDraft();
  }
  function activateObstacleMode(mode: 'select' | 'navigate' | 'place') {
    actions.getDashboardAndAuthoringController().activateObstacleMode(mode);
  }
  function setTdmaMessage(text: string, isError = false) {
    actions.getDashboardAndAuthoringController().setTdmaMessage(text, isError);
  }
  function updateTdmaLivePreview() {
    actions.getDashboardAndAuthoringController().updateTdmaLivePreview();
  }
  function syncInputsFromDraft() {
    actions.getDashboardAndAuthoringController().syncInputsFromDraft();
  }
  function syncTdmaEditorFromWorker(config: any) {
    actions.getDashboardAndAuthoringController().syncTdmaEditorFromWorker(config);
  }
  function validateTdmaDraft(draft: any) {
    return actions.getDashboardAndAuthoringController().validateTdmaDraft(draft);
  }
  function handleTdmaCommandResult(msg: any) {
    actions.getDashboardAndAuthoringController().handleTdmaCommandResult(msg);
  }
  function applyTdmaDraft() {
    actions.getDashboardAndAuthoringController().applyTdmaDraft();
  }
  function resetTdmaToStandard() {
    actions.getDashboardAndAuthoringController().resetTdmaToStandard();
  }

  /* ---------- UI Controls ---------- */
  (window as any).togglePause = function () {
    if (historyController.isInspecting) {
      (window as any).returnToLive();
      return;
    }
    if (schedHistoryController.isInspecting) {
      (window as any).returnSchedulerToLive();
      return;
    }

    const pbMode = dataCommVisualizer.getPlaybackMode();
    const stepState = dataCommVisualizer.getSteppedLifecycle();

    if (pbMode === 'stepped') {
      if (stepState === 'playing') {
        const currentlyVisualPaused = dataCommVisualizer.isVisualPaused();
        dataCommVisualizer.setVisualPaused(!currentlyVisualPaused);
        actions.updatePauseButtonUI();
        return;
      } else if (stepState === 'complete') {
        state.isPaused = false;
        dataCommVisualizer.resumeContinuous();
        actions.updateStepControlUI(true);
        actions.sendCommand({ type: 'SIM_CONTROL', action: 'resume' });
        actions.updatePauseButtonUI();
        return;
      }
    }

    state.isPaused = !state.isPaused;
    if (!state.isPaused) {
      dataCommVisualizer.resumeContinuous();
      actions.updateStepControlUI(true);
      actions.sendCommand({ type: 'SIM_CONTROL', action: 'resume' });
      actions.markUiDirtyAndWake();
    } else {
      dataCommVisualizer.setVisualPaused(true);
      actions.sendCommand({ type: 'SIM_CONTROL', action: 'pause' });
      if (state.terrainMapMode === 'maplibre' && state.stageViewMode === '2d') {
        actions.updateMapLibreOverlay();
      }
      actions.markUiDirtyAndWake();
    }
    actions.updatePauseButtonUI();
    if (state.latestTelemetry) actions.updateDashboardDOM(state.latestTelemetry, true);
  };

  (window as any).toggleSpatialLock = function () {
    actions.sendCommand({ type: 'SET_SPATIAL_LOCK', locked: !state.spatialLocked });
  };

  (window as any).toggleViewshedHeatmap = function () {
    state.viewshedHeatmapEnabled = !state.viewshedHeatmapEnabled;
    const btn = $('toggle-viewshed-heatmap');
    if (btn) {
      btn.setAttribute('aria-pressed', String(state.viewshedHeatmapEnabled));
      btn.classList.toggle('active', state.viewshedHeatmapEnabled);
      btn.title = state.viewshedHeatmapEnabled
        ? 'Toggle Real-Time Polar X-Band SINR Viewshed Heatmap (Active)'
        : 'Toggle Real-Time Polar X-Band SINR Viewshed Heatmap (Inactive)';
    }
    actions.sendCommand({
      type: 'SET_SCIENTIFIC_PARAMS',
      viewshedEnabled: state.viewshedHeatmapEnabled,
    });
    state.radarNeedsRender = true;
  };

  (window as any).recomputeRelayAdvisor = function () {
    const btn = $<HTMLButtonElement>('btn-recompute-relay-advisor');
    if (btn) {
      btn.textContent = 'Computing…';
      btn.disabled = true;
    }
    actions.sendCommand({
      type: 'SET_SCIENTIFIC_PARAMS',
      recomputeRelayAdvisor: true,
    });
  };

  (window as any).stepSim = function () {
    if (!dataCommVisualizer.canStep()) {
      console.warn('[Simulation] STEP rejected: cycle playing or awaiting telemetry.');
      return;
    }
    if (historyController.isInspecting) {
      historyController.exitHistorical();
      actions.syncLiveUIState();
    }
    if (schedHistoryController.isInspecting) {
      schedHistoryController.exitHistorical();
      actions.syncSchedulerLiveUIState();
    }
    const reqId = dataCommVisualizer.requestStep();
    if (reqId === null) return;

    state.isPaused = true;
    actions.updateStepControlUI(false);
    actions.updatePauseButtonUI();
    if (state.latestTelemetry) actions.updateDashboardDOM(state.latestTelemetry, true);
    actions.sendCommand({ type: 'SIM_CONTROL', action: 'step', step_request_id: reqId });
    actions.markUiDirtyAndWake();
  };

  const formatPlaybackSpeed = (value: number) =>
    `${value % 1 === 0 ? value.toFixed(1) : value}×`;
  const formatPresetLabel = (value: number) => `${value % 1 === 0 ? value.toFixed(0) : value}×`;

  (window as any).setSpeed = function (spd: any) {
    if (historyController.isInspecting) {
      historyController.exitHistorical();
      actions.syncLiveUIState();
    }
    if (schedHistoryController.isInspecting) {
      schedHistoryController.exitHistorical();
      actions.syncSchedulerLiveUIState();
    }

    let num = typeof spd === 'number' ? spd : parseFloat(spd);
    if (!Number.isFinite(num)) num = PLAYBACK_SPEED.defaultValue;
    num = Math.max(PLAYBACK_SPEED.min, Math.min(PLAYBACK_SPEED.max, Math.round(num * 100) / 100));

    state.currentSimSpeed = num;

    const slider = $<HTMLInputElement>('sim-speed-slider');
    if (slider && Math.abs(parseFloat(slider.value) - num) > 0.001) {
      slider.value = String(num);
    }

    const input = $<HTMLInputElement>('sim-speed-input');
    if (input && Math.abs(parseFloat(input.value) - num) > 0.001) {
      input.value = num % 1 === 0 ? num.toFixed(1) : String(num);
    }

    const readout = $('sim-speed-readout');
    if (readout) readout.textContent = formatPlaybackSpeed(num);

    document.querySelectorAll('.sim-speed-presets .spd-preset-btn').forEach((btn: any) => {
      const btnSpeed = Number(btn.dataset.speed);
      btn.classList.toggle('active', Number.isFinite(btnSpeed) && Math.abs(num - btnSpeed) < 0.01);
    });

    actions.sendCommand({ type: 'SET_SPEED', speed: num });
  };

  (window as any).onSpeedSliderInput = function (val: string) {
    const num = parseFloat(val);
    if (Number.isFinite(num)) {
      (window as any).setSpeed(num);
    }
  };

  (window as any).onSpeedNumInput = function (val: string) {
    const num = parseFloat(val);
    if (Number.isFinite(num)) {
      (window as any).setSpeed(num);
    }
  };

  (window as any).resetSim = function () {
    state.inspectingAcn = false;
    state.pendingAltitudeMode = null;
    state.flightParamsDirty = false;
    if (historyController.isInspecting) {
      historyController.exitHistorical();
      actions.syncLiveUIState();
    }
    if (schedHistoryController.isInspecting) {
      schedHistoryController.exitHistorical();
      actions.syncSchedulerLiveUIState();
    }
    sessionCoordinator.reset();
    state.currentSpatialRevision = 0;
    historyController.reset();
    schedHistoryController.reset();
    if (state.simTimelineController) {
      state.simTimelineController.reset();
    } else {
      simSpatialBuffer.clear();
      simEpochStore.notifySimulationReset();
      state.handleTimelineInspectorReset();
    }
    dataCommVisualizer.reset();
    networkTrafficTracker.clear();
    state.lastRenderedNodesKey = '';
    state.lastOpsFleetSignature = '';
    telemetryUpdaters.resetTelemetryDomState();
    (window as any).setSpeed(PLAYBACK_SPEED.defaultValue);
    actions.updateStepControlUI(true);
    actions.updatePauseButtonUI();
    actions.updateScrubberUI();
    actions.updateSchedulerScrubberUI();
    if (terrainTopViewport && typeof terrainTopViewport.clearPinnedBounds === 'function') {
      terrainTopViewport.clearPinnedBounds();
    }
    const topThru = document.getElementById('topbar-agg-thruput');
    if (topThru) topThru.textContent = '-- Mbps';
    if (state.latestTelemetry) actions.updateDashboardDOM(state.latestTelemetry, true);
    actions.sendCommand({ type: 'SIM_CONTROL', action: 'reset' });
  };

  (window as any).loadPreset = function (id: string) {
    state.inspectingAcn = false;
    state.pendingAltitudeMode = null;
    state.flightParamsDirty = false;
    state.lastRenderedNodesKey = '';
    state.lastOpsFleetSignature = '';
    telemetryUpdaters.resetTelemetryDomState();
    if (id === 'PRESET_RESET' || id === 'PRESET_ACN_ONLY' || id === 'PRESET_16_NODES') {
      if (historyController.isInspecting) {
        historyController.exitHistorical();
        actions.syncLiveUIState();
      }
      if (schedHistoryController.isInspecting) {
        schedHistoryController.exitHistorical();
        actions.syncSchedulerLiveUIState();
      }
      sessionCoordinator.reset();
      state.currentSpatialRevision = 0;
      historyController.reset();
      schedHistoryController.reset();
      if (state.simTimelineController) {
        state.simTimelineController.reset();
      } else {
        simSpatialBuffer.clear();
        simEpochStore.notifySimulationReset();
        state.handleTimelineInspectorReset();
      }
      dataCommVisualizer.reset();
      networkTrafficTracker.clear();
      actions.updateStepControlUI(true);
      actions.updatePauseButtonUI();
      actions.updateScrubberUI();
      actions.updateSchedulerScrubberUI();
      if (
        id === 'PRESET_RESET' &&
        terrainTopViewport &&
        typeof terrainTopViewport.clearPinnedBounds === 'function'
      ) {
        terrainTopViewport.clearPinnedBounds();
      }
      if (id === 'PRESET_ACN_ONLY') {
        state.selectedNodeId = -1;
        syncNodeDropdowns(-1);
      } else if (id === 'PRESET_16_NODES') {
        state.selectedNodeId = 4;
        syncNodeDropdowns(4);
      }
    }
    if (id === 'PRESET_MONSOON') {
      const rainInp = $<HTMLInputElement>('param-rain');
      if (rainInp) rainInp.value = '35';
      setText('lbl-rain', '35.0 mm/h');
    } else if (id === 'PRESET_AMBUSH') {
      const rainInp = $<HTMLInputElement>('param-rain');
      if (rainInp) rainInp.value = '0';
      setText('lbl-rain', '0.0 mm/h');
    }
    actions.invalidateToolboxCache();
    actions.sendCommand({ type: 'LOAD_PRESET', preset_id: id });
  };

  (window as any).runKargilScenario = function () {
    const btn = document.getElementById('btn-run-kargil-scenario') as HTMLButtonElement | null;
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Starting…';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = orig;
        btn.disabled = false;
      }, 600);
    }
    state.inspectingAcn = false;
    state.inspectorDismissed = true;
    state.selectedNodeId = 4;
    state.lastRenderedNodesKey = '';
    syncNodeDropdowns(4);
    actions.renderSelectedNodeDetails();
    (window as any).setSpeed(0.5);
    (window as any).loadPreset('PRESET_OCCLUSION');
  };

  (window as any).toggleActiveScheduler = function () {
    const next = state.activeSchedulerMode === 'tac_tad' ? 'static' : 'tac_tad';
    state.activeSchedulerMode = next;
    setText('scheduler-quick-toggle', `Mode: ${next === 'tac_tad' ? 'Tac-TAD' : 'Static'}`);
    actions.sendCommand({ type: 'SET_SCHEDULER', mode: next });
  };

  function setRadarRange(rangeM: number, options: any = { duration: 200 }) {
    state.currentRadarRangeM = Math.max(
      MIN_RADAR_RANGE_M,
      Math.min(actions.getMaxRadarRangeM(), Number.isFinite(rangeM) ? rangeM : 60000)
    );
    actions.syncRangeButtonHighlights(state.currentRadarRangeM);
    const spanKm = (state.currentRadarRangeM * 2) / 1000;
    setText(
      'tb-span-readout',
      spanKm >= 1000
        ? `Span: ${Math.round(spanKm).toLocaleString()} km`
        : `Span: ${spanKm.toFixed(1)} km`
    );
    actions.markRadarDirty();
    if (state.terrainMapMode === 'maplibre' && state.mapLibreInitialized) {
      actions.syncMapLibreCameraFromRadarState(
        options?.duration ?? 200,
        Boolean(options?.resetOrientation)
      );
    } else {
      actions.drawRadar();
    }
    actions.syncZoomHudReadout?.();
  }
  (window as any).setRadarRange = setRadarRange;

  (window as any).centerMapOnACN = function () {
    const isTimelineHist = Boolean(
      state.simTimelineController && state.simTimelineController.isHistoricalInspecting
    );
    const histSnap =
      isTimelineHist && state.simTimelineController
        ? state.simTimelineController.getActiveSpatialSnapshot()
        : null;
    const acnX = Number(
      histSnap ? histSnap.acn.posX : state.latestTelemetry?.acn_telemetry?.pos_x ?? 0
    );
    const acnY = Number(
      histSnap ? histSnap.acn.posY : state.latestTelemetry?.acn_telemetry?.pos_y ?? 0
    );
    state.panOffsetX_m = Number.isFinite(acnX) ? acnX : 0;
    state.panOffsetY_m = Number.isFinite(acnY) ? acnY : 0;
    if (state.threeController && state.threeController.getViewMode() === '3d') {
      state.threeController.resetCamera();
    }
    if (state.stageViewMode === '2d') {
      if (state.terrainMapMode === 'maplibre' && state.mapLibreInitialized) {
        actions.easeMapLibreToLocalCenter(state.panOffsetX_m, state.panOffsetY_m, 250, true);
      } else {
        actions.drawRadar();
      }
    }
  };

  (window as any).onParamChange = function () {
    const freq = parseFloat($<HTMLInputElement>('param-freq')?.value || '0');
    const rain = parseFloat($<HTMLInputElement>('param-rain')?.value || '0');
    const alt = parseFloat($<HTMLInputElement>('param-alt')?.value || '0');
    setText('lbl-freq', `${freq.toFixed(1)} GHz`);
    setText('lbl-rain', `${rain.toFixed(1)} mm/h`);
    setText('lbl-alt', `${alt.toFixed(0)} m`);
    actions.sendCommand({
      type: 'CONFIG_UPDATE',
      params: { carrier_freq_ghz: freq, rain_rate_mmh: rain, acn_altitude_m: alt },
    });
    actions.invalidateToolboxCache();
  };

  (window as any).onCoverageParamChange = function () {
    const km = parseFloat($<HTMLInputElement>('param-cov')?.value || '0');
    setText('lbl-cov', `${km.toFixed(0)} km`);
    actions.sendCommand({ type: 'CONFIG_UPDATE', params: { coverage_radius_km: km } });
  };

  (window as any).onBandwidthParamChange = function () {
    const bw = parseFloat($<HTMLInputElement>('param-bw')?.value || '0');
    if (!Number.isFinite(bw) || bw < 0.1 || bw > 50.0) return;
    setText('lbl-bw', `${bw.toFixed(1)} MHz`);
    actions.sendCommand({ type: 'CONFIG_UPDATE', params: { channel_bandwidth_mhz: bw } });
    actions.invalidateToolboxCache();
  };

  (window as any).onScientificParamChange = function () {
    const demSlider = $<HTMLInputElement>('sci-dem-error-slider');
    const trafficSelect = $<HTMLSelectElement>('sci-traffic-scale-select');
    const jammerSelect = $<HTMLSelectElement>('sci-jammer-select');
    const demVal = demSlider ? parseFloat(demSlider.value) : 0;
    const trafficVal = trafficSelect ? parseFloat(trafficSelect.value) : 1.0;
    const demLabel = $('sci-dem-error-val');
    if (demLabel) demLabel.textContent = `${demVal.toFixed(0)} m`;

    let jammerEnabled = false;
    let jammerEirpDbm = 65.0;
    if (jammerSelect) {
      if (jammerSelect.value === 'tactical') {
        jammerEnabled = true;
        jammerEirpDbm = 55.0;
      } else if (jammerSelect.value === 'barrage') {
        jammerEnabled = true;
        jammerEirpDbm = 70.0;
      }
    }

    const relaySelect = $<HTMLSelectElement>('sci-relay-select');
    const activeRelayEnabled = relaySelect
      ? relaySelect.value === 'active'
      : state.latestTelemetry?.active_relay_enabled ?? false;

    const fadingCqiSelect = $<HTMLSelectElement>('sci-fading-cqi-select');
    let ricianFadingEnabled = false;
    let cqiFeedbackDelayMs = 0;
    if (fadingCqiSelect) {
      if (fadingCqiSelect.value === 'rician-0ms') {
        ricianFadingEnabled = true;
        cqiFeedbackDelayMs = 0;
      } else if (fadingCqiSelect.value === 'rician-20ms') {
        ricianFadingEnabled = true;
        cqiFeedbackDelayMs = 20;
      } else if (fadingCqiSelect.value === 'rician-40ms') {
        ricianFadingEnabled = true;
        cqiFeedbackDelayMs = 40;
      }
    }

    actions.sendCommand({
      type: 'SET_SCIENTIFIC_PARAMS',
      demLookaheadErrorStdM: demVal,
      trafficLoadMultiplier: trafficVal,
      jammerEnabled,
      jammerEirpDbm,
      activeRelayEnabled,
      ricianFadingEnabled,
      cqiFeedbackDelayMs,
    });
  };

  (window as any).toggleActiveRelay = function () {
    const current = Boolean(state.latestTelemetry?.active_relay_enabled);
    const next = !current;
    actions.sendCommand({
      type: 'SET_SCIENTIFIC_PARAMS',
      activeRelayEnabled: next,
    });
    const btn = $('btn-toggle-active-relay');
    if (btn) {
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
      btn.textContent = next
        ? 'Active Two-Hop Ridge Relay [ONLINE]'
        : 'Deploy Active Two-Hop Ridge Relay [OFF]';
      btn.className = next ? 'primary' : 'secondary';
    }
    const schedSel = $<HTMLSelectElement>('sci-relay-select');
    if (schedSel) {
      schedSel.value = next ? 'active' : 'disabled';
    }
    state.radarNeedsRender = true;
  };

  window.onHiFiToggleChange = function(modelKey, enabled) {
    const params: any = {};
    if (modelKey === 'viewshedFidelityMode') {
      params.viewshedFidelityMode = enabled ? 'link-budget-parity' : 'fast';
    } else {
      params[modelKey] = Boolean(enabled);
    }
    actions.sendCommand({ type: 'CONFIG_UPDATE', params });
    state.radarNeedsRender = true;
  };

  window.toggleAllHiFiPhysics = function() {
    const att = $<HTMLInputElement>('toggle-hifi-attitude');
    const ric = $<HTMLInputElement>('toggle-hifi-rician');
    const harq = $<HTMLInputElement>('toggle-hifi-harq');
    const dub = $<HTMLInputElement>('toggle-hifi-dubins');
    const view = $<HTMLInputElement>('toggle-hifi-viewshed-parity');
    const abr = $<HTMLInputElement>('toggle-hifi-abr');

    const allOn = Boolean(
      att?.checked && ric?.checked && harq?.checked && dub?.checked && view?.checked && abr?.checked
    );
    const next = !allOn;

    if (att) att.checked = next;
    if (ric) ric.checked = next;
    if (harq) harq.checked = next;
    if (dub) dub.checked = next;
    if (view) view.checked = next;
    if (abr) abr.checked = next;

    const btn = $('btn-hifi-all-toggle');
    if (btn) {
      btn.textContent = next ? 'Baseline Mode' : 'Enable All Models';
    }

    actions.sendCommand({
      type: 'CONFIG_UPDATE',
      params: {
        enableAirframeShadowing: next,
        enableCorrelatedRicianFading: next,
        enableMacPhyFeedback: next,
        enableDubinsKinematics: next,
        viewshedFidelityMode: next ? 'link-budget-parity' : 'fast',
        enableTransportAbr: next,
      },
    });
    state.radarNeedsRender = true;
  };

  function updateHiFiPhysicsUI(hifi: any, transportAbr: any, ewEccm: any, constellationMobility: any) {
    telemetryUpdaters.updateHiFiPhysicsUI(hifi, transportAbr, ewEccm, constellationMobility);
  }
  window.updateHiFiPhysicsUI = updateHiFiPhysicsUI;

  (window as any).onEwConfigChange = function (key: string, val: any) {
    actions.sendCommand({
      type: 'UPDATE_CONFIG',
      [key]: val,
    });
  };

  (window as any).onConstellationConfigChange = function (key: string, val: any) {
    actions.sendCommand({
      type: 'UPDATE_CONFIG',
      [key]: val,
    });
  };

  (window as any).syncDemQuickPresetButtons = function (sectorVal: string) {
    const norm = sectorVal === 'alpine_mountain' ? 'ladakh' : sectorVal;
    document
      .querySelectorAll('#tb-dem-quick-switch .tb-dem-preset-btn[data-dem-preset]')
      .forEach((btn) => {
        const active = btn.getAttribute('data-dem-preset') === norm;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
  };

  (window as any).applyDemQuickPreset = function (presetId: string) {
    const sel = $<HTMLSelectElement>('dem-sector-select');
    if (sel) sel.value = presetId;
    (window as any).onDemSectorChange(presetId);
    const labels: Record<string, string> = {
      ladakh: 'Ladakh Alpine',
      kargil: 'Kargil Corridor',
      arid_desert: 'Thar Desert',
    };
    actions.setTerrainToolStatus(`Active DEM switched to ${labels[presetId] || presetId}.`);
  };

  (window as any).onDemSectorChange = function (sectorVal: string) {
    const target = resolveSectorTheaterTarget(sectorVal);
    state.activeBiomeId = target.biomeId;
    state.activeTerrainMode = target.terrainMode;

    const btnReal = $('btnRealTerrain');
    const btnSynth = $('btnSynthTerrain');
    if (btnReal) btnReal.classList.toggle('active', target.terrainMode === 'real');
    if (btnSynth) btnSynth.classList.toggle('active', target.terrainMode === 'synthetic');

    engines.mainTerrainEngine.setBiome(target.biomeId);

    // 1. 2D Radar WorldTileLayer + pan reset onto new theater origin
    actions.getRadarWorldTileLayer()?.setOrigin(target.centerLatDeg, target.centerLonDeg);
    state.panOffsetX_m = 0;
    state.panOffsetY_m = 0;

    // 2. MapController origin & MapLibre Geo camera jump
    if (state.mapController) {
      state.mapController.setBiome(target.biomeId);
      if (target.isCustomOrigin) {
        state.mapController.setOrigin(target.centerLatDeg, target.centerLonDeg);
      }
    }
    state.mapLibreTravelledPath = [];
    actions.clearMapLibreSourceHashes?.();

    if (state.mapLibreInstance && state.mapLibreInitialized) {
      actions.updateMapLibreOverlay();
      actions.syncMapLibreCameraFromRadarState(300, true);
    }

    // 3. 3D terrain mesh refresh & OrbitControls camera recenter
    state.cachedTerrainMeshData = null;
    state.pendingThreeRecenter = true;
    if (state.threeController && state.stageViewMode === '3d') {
      const meta = BIOME_DEM_METADATA[target.biomeId];
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

    // 4. Authoritative worker biome & terrain mode commands
    actions.sendCommand({ type: 'SET_BIOME', biomeId: target.biomeId });
    actions.sendCommand({ type: 'SET_TERRAIN_MODE', mode: target.terrainMode });
    actions.requestTerrainMeshData(true);

    (window as any).syncDemQuickPresetButtons?.(sectorVal);
    actions.updateTerrainHudBadge?.();
    actions.syncZoomHudReadout?.();
    actions.drawRadar();
    actions.markRadarDirty();
  };

  window.onBiomeEmToggleChange = function (enabled: boolean) {
    actions.sendCommand({
      type: 'CONFIG_UPDATE',
      params: { enableBiomeEmPhysics: Boolean(enabled) },
    });
    state.radarNeedsRender = true;
  };
  window.onBiomePolChange = function (pol: string) {
    actions.sendCommand({
      type: 'CONFIG_UPDATE',
      params: { polarizationMode: pol as PolarizationMode },
    });
    state.radarNeedsRender = true;
  };
  window.onBiomeDustVisChange = function (visKm: string) {
    const val = parseFloat(visKm);
    if (Number.isFinite(val)) {
      actions.sendCommand({
        type: 'CONFIG_UPDATE',
        params: { dustVisibilityKm: Math.max(0.02, Math.min(50.0, val)) },
      });
      state.radarNeedsRender = true;
    }
  };
  window.onBiomeFoliageDepthChange = function (depthM: string) {
    const val = parseFloat(depthM);
    if (Number.isFinite(val)) {
      actions.sendCommand({
        type: 'CONFIG_UPDATE',
        params: {
          foliageDepthM: Math.max(0.0, Math.min(500.0, val)),
        },
      });
      state.radarNeedsRender = true;
    }
  };

  function updateBiomePhysicsUI(msg: any) {
    const nextBiome = msg?.biome_id || msg?.frame?.biome_id;
    if (typeof nextBiome === 'string' && nextBiome) {
      const biomeVal = nextBiome as BiomeId;
      state.activeBiomeId = biomeVal;
      if (state.mapController && state.mapController.getBiome() !== biomeVal) {
        state.mapController.setBiome(biomeVal);
      }
    }
    telemetryUpdaters.updateBiomePhysicsUI(msg);
  }
  window.updateBiomePhysicsUI = updateBiomePhysicsUI;

  function setAglFeedback(msg: string, isError = false) {
    ['node-agl-feedback', 'quick-node-agl-feedback', 'terrain-node-agl-feedback'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.textContent = msg;
      el.style.color = isError
        ? 'var(--hi-vermilion-bright, #f07167)'
        : 'var(--hi-text-muted, #b3afa7)';
    });
    if (state.aglFeedbackTimeout) clearTimeout(state.aglFeedbackTimeout);
    if (!isError && msg) {
      state.aglFeedbackTimeout = setTimeout(() => {
        ['node-agl-feedback', 'quick-node-agl-feedback', 'terrain-node-agl-feedback'].forEach(
          (id) => {
            const el = $(id);
            if (el && el.textContent === msg) el.textContent = '';
          }
        );
      }, 2500);
    }
  }

  function syncSelectedNodeAglUI() {
    if (typeof (window as any).refreshToolboxActionGates === 'function')
      (window as any).refreshToolboxActionGates();
    const isHistorical = Boolean(
      historyController?.isInspecting ||
        schedHistoryController?.isInspecting ||
        state.simTimelineController?.isHistoricalInspecting
    );
    const eligibility = checkAglEditEligibility({
      spatialLocked: Boolean(state.spatialLocked),
      isHistorical,
      nodeId: state.selectedNodeId,
    });
    const disabled = !eligibility.canEdit;

    let currentAgl = 2.0;
    if (isHistorical) {
      const rec = historyController?.getActiveHistoricalRecord();
      if (rec && typeof rec.groundNodeAglM === 'number') {
        currentAgl = rec.groundNodeAglM;
      } else if (state.latestTelemetry?.nodes_telemetry) {
        const node = state.latestTelemetry.nodes_telemetry.find(
          (n: any) => n.node_id === state.selectedNodeId
        );
        if (node && typeof node.agl_m === 'number') currentAgl = node.agl_m;
      }
    } else if (state.latestTelemetry?.nodes_telemetry) {
      const node = state.latestTelemetry.nodes_telemetry.find(
        (n: any) => n.node_id === state.selectedNodeId
      );
      if (node && typeof node.agl_m === 'number') {
        currentAgl = node.agl_m;
      }
    }

    const aglFormatted = currentAgl.toFixed(1);
    setText('lbl-terrain-node-agl', `${aglFormatted} m`);

    const inputIds = ['node-agl-input', 'quick-node-agl-input', 'terrain-node-agl-input'];
    inputIds.forEach((id) => {
      const inp = $<HTMLInputElement>(id);
      if (!inp) return;
      inp.disabled = disabled;
      inp.title =
        eligibility.reason || 'Antenna height above ground level (0.0 to 1000.0 m, step 0.5 m)';

      if (document.activeElement !== inp) {
        inp.value = aglFormatted;
      }
    });
  }
  (window as any).syncSelectedNodeAglUI = syncSelectedNodeAglUI;

  (window as any).onNodeAglChange = function (val: any) {
    let authAgl = 2.0;
    if (state.latestTelemetry?.nodes_telemetry) {
      const node = state.latestTelemetry.nodes_telemetry.find(
        (n: any) => n.node_id === state.selectedNodeId
      );
      if (node && typeof node.agl_m === 'number') authAgl = node.agl_m;
    }

    const revertInputs = () => {
      ['node-agl-input', 'quick-node-agl-input', 'terrain-node-agl-input'].forEach((id) => {
        const inp = $<HTMLInputElement>(id);
        if (inp) inp.value = authAgl.toFixed(1);
      });
    };

    const eligibility = checkAglEditEligibility({
      spatialLocked: Boolean(state.spatialLocked),
      isHistorical: Boolean(
        historyController?.isInspecting ||
          schedHistoryController?.isInspecting ||
          state.simTimelineController?.isHistoricalInspecting
      ),
      nodeId: state.selectedNodeId,
    });
    if (!eligibility.canEdit) {
      setAglFeedback(eligibility.reason || 'Editing not permitted', true);
      revertInputs();
      syncSelectedNodeAglUI();
      return;
    }

    const validation = validateNodeAgl(val);
    if (!validation.valid || typeof validation.value !== 'number') {
      setAglFeedback(validation.reason || 'Invalid AGL value', true);
      revertInputs();
      syncSelectedNodeAglUI();
      return;
    }

    const num = validation.value;
    const reqId = 'agl_' + Date.now();
    state.pendingAglUpdate = { nodeId: state.selectedNodeId, agl: num, reqId };
    setAglFeedback('Updating AGL…', false);
    actions.sendCommand(buildAglConfigUpdateCommand(state.selectedNodeId, num, reqId));
  };

  function handleAglCommandResult(msg: any) {
    if (!msg || msg.command_type !== 'CONFIG_UPDATE') return;
    if (!state.pendingAglUpdate) return;
    if (msg.request_id && msg.request_id !== state.pendingAglUpdate.reqId) return;

    if (msg.accepted === false) {
      setAglFeedback(`Worker rejected: ${msg.reason || 'Invalid AGL'}`, true);
      state.pendingAglUpdate = null;
      let authAgl = 2.0;
      if (state.latestTelemetry?.nodes_telemetry) {
        const node = state.latestTelemetry.nodes_telemetry.find(
          (n: any) => n.node_id === state.selectedNodeId
        );
        if (node && typeof node.agl_m === 'number') authAgl = node.agl_m;
      }
      ['node-agl-input', 'quick-node-agl-input', 'terrain-node-agl-input'].forEach((id) => {
        const inp = $<HTMLInputElement>(id);
        if (inp) inp.value = authAgl.toFixed(1);
      });
      syncSelectedNodeAglUI();
    } else if (msg.accepted === true) {
      setAglFeedback(`AGL updated: ${state.pendingAglUpdate.agl.toFixed(1)} m`, false);
      ['node-agl-input', 'quick-node-agl-input', 'terrain-node-agl-input'].forEach((id) => {
        const inp = $<HTMLInputElement>(id);
        if (inp && state.pendingAglUpdate) inp.value = state.pendingAglUpdate.agl.toFixed(1);
      });
      state.pendingAglUpdate = null;
      syncSelectedNodeAglUI();
    }
  }
  (window as any).handleAglCommandResult = handleAglCommandResult;

  function showNodeFeedback(text: string, isError = false) {
    const el = $('node-inventory-feedback');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
    el.style.background = isError ? 'rgba(207, 106, 85, 0.15)' : 'rgba(143, 168, 120, 0.15)';
    el.style.border = isError ? '1px solid var(--bad)' : '1px solid var(--ok)';
    el.style.color = isError ? 'var(--bad)' : 'var(--ok)';
    setTimeout(() => {
      if (el) el.style.display = 'none';
    }, 5000);
  }

  function handleNodeCommandResult(msg: any) {
    if (!msg || typeof msg !== 'object') return;
    const types = ['NODE_ADD', 'NODE_DELETE', 'NODE_DUPLICATE', 'NODE_UPDATE'];
    if (!types.includes(msg.command_type)) return;

    if (msg.accepted) {
      const act = msg.command_type.replace('NODE_', '').toLowerCase();
      const id = msg.node_id ?? msg.deleted_node_id;
      showNodeFeedback(`Terminal ${id} successfully ${act}ed.`);
      const form = $('node-editor-form');
      if (form) form.style.display = 'none';

      if (msg.command_type === 'NODE_ADD') {
        if (
          typeof msg.node_id === 'number' &&
          (state.selectedNodeId < 0 || state.selectedNodeId === undefined)
        ) {
          state.selectedNodeId = msg.node_id;
          syncNodeDropdowns(state.selectedNodeId);
        }
      } else if (msg.command_type === 'NODE_DELETE') {
        actions.updateMapLibreOverlay();
        if (state.hoveredNodeId === id || state.hoveredLinkNodeId === id) {
          state.hoveredNodeId = null;
          state.hoveredLinkNodeId = null;
          state.activeMapHoverRenderer = null;
          state.mapHoverPoint = null;
          const tip = $('map-node-tooltip');
          if (tip) tip.style.display = 'none';
        }
        if (state.selectedNodeId === id) {
          const replacement = state.latestTelemetry?.nodes_telemetry?.find(
            (node: any) => node.node_id !== id
          );
          if (replacement) actions.handleNodeSelection(replacement.node_id);
          else {
            state.selectedNodeId = -1;
            syncNodeDropdowns(-1);
            actions.renderSelectedNodeDetails();
            actions.updateMapLibreOverlay();
            actions.drawRadar();
          }
        }
      }
    } else {
      showNodeFeedback(`Operation failed: ${msg.reason || 'Worker rejected the command.'}`, true);
    }
  }
  (window as any).handleNodeCommandResult = handleNodeCommandResult;

  function closeNodeEditModal() {
    const overlay = $('node-modal-overlay');
    if (overlay) {
      overlay.hidden = true;
      overlay.style.display = 'none';
    }
    const fb = $('node-modal-feedback');
    if (fb) {
      fb.textContent = '';
      fb.classList.remove('is-error');
    }
  }

  function openNodeEditModal(targetNodeId?: number) {
    const resolvedId =
      typeof targetNodeId === 'number' && Number.isInteger(targetNodeId) && targetNodeId >= 0
        ? targetNodeId
        : state.selectedNodeId;
    if (state.simTimelineController && state.simTimelineController.isHistoricalInspecting) {
      showNodeFeedback('Cannot edit nodes while Historical Inspection is active.', true);
      return;
    }
    if (typeof resolvedId !== 'number' || resolvedId < 0) {
      showNodeFeedback('No terminal currently selected to edit.', true);
      return;
    }
    const nodes = state.latestTelemetry?.nodes_telemetry || [];
    const node = nodes.find((n: any) => n.node_id === resolvedId);
    if (!node) {
      showNodeFeedback('Selected terminal not found in telemetry.', true);
      return;
    }

    state.nodeModalTargetId = resolvedId;
    const title = $('node-modal-title');
    if (title) title.textContent = `Edit / Rename Terminal #${resolvedId}`;

    const callsignInput = $<HTMLInputElement>('node-modal-callsign');
    if (callsignInput) callsignInput.value = node.name || `S${resolvedId}`;

    const roleSel = $<HTMLSelectElement>('node-modal-role');
    if (roleSel) {
      const r = String(node.node_role || node.node_type || 'soldier').toLowerCase();
      roleSel.value = r === 'mcp' ? 'mcp' : r === 'convoy' ? 'convoy' : 'soldier';
    }

    const teamSel = $<HTMLSelectElement>('node-modal-team');
    const customTeamInput = $<HTMLInputElement>('node-modal-team-custom');
    if (teamSel && !shouldDeferSelectMutation(teamSel)) {
      const mergedTeams = new Map<string, string>();
      for (const t of DEFAULT_TACTICAL_TEAMS) mergedTeams.set(t.teamId, t.teamName);
      for (const t of collectTeamsFromNodes(nodes)) mergedTeams.set(t.teamId, t.teamName);
      const teamOptSig = Array.from(mergedTeams.entries()).map(([tid, tname]) => `${tid}:${tname}`).join('|');
      if (teamSel.dataset.optSig !== teamOptSig) {
        teamSel.dataset.optSig = teamOptSig;
        const optEls: HTMLOptionElement[] = [];
        for (const [tid, tname] of mergedTeams.entries()) {
          const opt = document.createElement('option');
          opt.value = tid;
          opt.textContent = tname;
          optEls.push(opt);
        }
        const customOpt = document.createElement('option');
        customOpt.value = '__custom__';
        customOpt.textContent = '+ Create Custom Team…';
        optEls.push(customOpt);
        teamSel.replaceChildren(...optEls);
      }

      const nodeTeamId = node.team_id ? normalizeTeamId(node.team_id) : (node.team_name ? normalizeTeamId(node.team_name) : 'alpha');
      if (mergedTeams.has(nodeTeamId)) {
        teamSel.value = nodeTeamId;
      } else {
        teamSel.value = '__custom__';
      }
    }
    if (customTeamInput) {
      customTeamInput.value = '';
    }

    const txInput = $<HTMLInputElement>('node-modal-tx-power');
    if (txInput) {
      txInput.value = String(node.tx_power_dbm ?? (node.node_type === 'mcp' ? 43.0 : 36.0));
    }

    const aglInput = $<HTMLInputElement>('node-modal-agl');
    if (aglInput) {
      aglInput.value = String(node.agl_m ?? 2.0);
      aglInput.disabled = Boolean(state.spatialLocked);
      aglInput.title = state.spatialLocked ? 'Unlock scenario to modify antenna AGL' : '';
    }

    const fb = $('node-modal-feedback');
    if (fb) {
      fb.textContent = state.spatialLocked
        ? 'Scenario Locked: Rename, Role, Team & TX Power allowed; AGL locked.'
        : '';
      fb.classList.remove('is-error');
    }

    const overlay = $('node-modal-overlay');
    if (overlay) {
      overlay.hidden = false;
      overlay.style.display = 'flex';
    }
    callsignInput?.focus();
  }
  (window as any).openNodeEditModal = openNodeEditModal;
  (window as any).closeNodeEditModal = closeNodeEditModal;

  function initNodeInventoryToolbar() {
    const btnAdd = $('btn-node-add');
    const btnDup = $('btn-node-duplicate');
    const btnDel = $('btn-node-delete');
    const btnEdit = $('btn-node-edit');
    const form = $('node-editor-form');
    const btnSubmit = $('btn-node-submit');
    const btnCancel = $('btn-node-cancel');

    if (btnAdd) {
      btnAdd.onclick = () => {
        if (
          state.spatialLocked ||
          (state.simTimelineController && state.simTimelineController.isHistoricalInspecting)
        ) {
          showNodeFeedback(
            'Cannot add nodes while Spatial Lock or Historical Inspection is active.',
            true
          );
          return;
        }
        state.nodeEditorMode = 'add';
        state.nodeEditorTargetId = -1;
        const title = $('node-editor-title');
        if (title) title.textContent = 'Add New Ground Terminal';
        const inputCallsign = $<HTMLInputElement>('node-input-callsign');
        if (inputCallsign) inputCallsign.value = '';
        const inputRole = $<HTMLSelectElement>('node-input-role');
        if (inputRole) inputRole.value = 'soldier';
        const inputX = $<HTMLInputElement>('node-input-x');
        if (inputX) inputX.value = '0';
        const inputY = $<HTMLInputElement>('node-input-y');
        if (inputY) inputY.value = '0';
        const inputAgl = $<HTMLInputElement>('node-input-agl');
        if (inputAgl) inputAgl.value = '2.0';
        const inputTx = $<HTMLInputElement>('node-input-tx-power');
        if (inputTx) inputTx.value = '36.0';
        const inputBatCap = $<HTMLInputElement>('node-input-battery-capacity');
        if (inputBatCap) inputBatCap.value = '5000';
        const inputBatLvl = $<HTMLInputElement>('node-input-battery-level');
        if (inputBatLvl) inputBatLvl.value = '100';
        const inputPri = $<HTMLInputElement>('node-input-priority');
        if (inputPri) inputPri.value = '1.0';
        const inputCol = $<HTMLInputElement>('node-input-color');
        if (inputCol) inputCol.value = '#e09f3e';
        if (form) form.style.display = 'block';
      };
    }

    if (btnDup) {
      btnDup.onclick = () => {
        if (
          state.spatialLocked ||
          (state.simTimelineController && state.simTimelineController.isHistoricalInspecting)
        ) {
          showNodeFeedback(
            'Cannot duplicate nodes while Spatial Lock or Historical Inspection is active.',
            true
          );
          return;
        }
        if (typeof state.selectedNodeId !== 'number' || state.selectedNodeId < 0) {
          showNodeFeedback('No terminal currently selected to duplicate.', true);
          return;
        }
        actions.sendCommand(buildNodeDuplicateCommand(state.selectedNodeId));
      };
    }

    function canDeleteSelectedNode() {
      if (
        state.spatialLocked ||
        (state.simTimelineController && state.simTimelineController.isHistoricalInspecting)
      ) {
        return false;
      }
      return typeof state.selectedNodeId === 'number' && state.selectedNodeId >= 0;
    }

    function getDeleteSelectedNodeBlockedReason() {
      if (
        state.spatialLocked ||
        (state.simTimelineController && state.simTimelineController.isHistoricalInspecting)
      ) {
        return 'Cannot delete nodes while Spatial Lock or Historical Inspection is active.';
      }
      if (typeof state.selectedNodeId !== 'number' || state.selectedNodeId < 0) {
        return 'No terminal currently selected to delete.';
      }
      return '';
    }

    function executeDeleteSelectedNode() {
      const blockedReason = getDeleteSelectedNodeBlockedReason();
      if (blockedReason) {
        showNodeFeedback(blockedReason, true);
        return;
      }
      actions.sendCommand(buildNodeDeleteCommand(state.selectedNodeId));
    }

    if (btnDel) {
      armDestructiveConfirm(btnDel, {
        armedLabel: 'Confirm Delete?',
        canArm: canDeleteSelectedNode,
        onBlocked: executeDeleteSelectedNode,
        onConfirm: executeDeleteSelectedNode,
      });
    }

    const inspectorDelBtn = $('map-node-details')?.querySelector<HTMLElement>('[data-map-action="delete"]');
    if (inspectorDelBtn) {
      armDestructiveConfirm(inspectorDelBtn, {
        armedLabel: 'Confirm Delete?',
        canArm: canDeleteSelectedNode,
        onBlocked: () => {
          const blockedReason = getDeleteSelectedNodeBlockedReason() || 'Delete unavailable.';
          setText('map-node-action-status', blockedReason);
          showNodeFeedback(blockedReason, true);
        },
        onConfirm: executeDeleteSelectedNode,
      });
    }

    armDestructiveConfirm($('btn-sim-reset'), {
      armedLabel: 'Confirm Reset?',
      onConfirm: () => (window as any).resetSim(),
    });

    armDestructiveConfirm($('btn-reset-theater'), {
      armedLabel: 'Confirm Reset?',
      onConfirm: () => (window as any).loadPreset('PRESET_RESET'),
    });

    if (btnEdit) {
      btnEdit.onclick = () => openNodeEditModal(state.selectedNodeId);
    }

    const modalOverlay = $('node-modal-overlay');
    const modalSaveBtn = $('node-modal-save');
    const modalCancelBtn = $('node-modal-cancel');
    const modalCloseBtn = $('node-modal-close');
    if (modalCancelBtn) modalCancelBtn.onclick = closeNodeEditModal;
    if (modalCloseBtn) modalCloseBtn.onclick = closeNodeEditModal;
    modalOverlay?.addEventListener('click', (ev: any) => {
      if (ev.target === modalOverlay) closeNodeEditModal();
    });
    if (modalSaveBtn) {
      modalSaveBtn.onclick = () => {
        const nid = state.nodeModalTargetId;
        if (!Number.isInteger(nid) || nid < 0) return;
        const fb = $('node-modal-feedback');
        const setModalErr = (msg: string) => {
          if (fb) {
            fb.textContent = msg;
            fb.classList.add('is-error');
          }
        };

        const callsign = $<HTMLInputElement>('node-modal-callsign')?.value?.trim() || '';
        const csVal = validateNodeCallsign(callsign);
        if (!callsign || !csVal.valid) {
          setModalErr(csVal.error || 'Callsign must be a non-empty string.');
          return;
        }

        const rawRole = $<HTMLSelectElement>('node-modal-role')?.value || 'soldier';
        const role: 'soldier' | 'mcp' | 'convoy' =
          rawRole === 'mcp' ? 'mcp' : rawRole === 'convoy' ? 'convoy' : 'soldier';

        const teamSel = $<HTMLSelectElement>('node-modal-team');
        const customTeam = $<HTMLInputElement>('node-modal-team-custom')?.value?.trim() || '';
        let teamName = customTeam;
        let teamId = customTeam ? normalizeTeamId(customTeam) : '';
        if (!teamName) {
          const selVal = teamSel?.value || 'alpha';
          if (selVal === '__custom__') {
            setModalErr('Enter a custom team name or choose an existing team.');
            return;
          }
          const selText = teamSel?.selectedOptions?.[0]?.textContent?.trim() || selVal;
          teamId = normalizeTeamId(selVal);
          teamName = selText;
        }

        const txPowerDbm = Number($<HTMLInputElement>('node-modal-tx-power')?.value);
        const txVal = validateNodeTxPower(txPowerDbm);
        if (!txVal.valid) {
          setModalErr(txVal.error || 'Invalid TX power.');
          return;
        }

        const aglInput = $<HTMLInputElement>('node-modal-agl');
        const aglM = Number(aglInput?.value);
        const includeAgl = !state.spatialLocked && aglInput && !aglInput.disabled;
        if (includeAgl) {
          const aglVal = validateNodeAglHeight(aglM);
          if (!aglVal.valid) {
            setModalErr(aglVal.error || 'Invalid AGL height.');
            return;
          }
        }

        actions.sendCommand({
          type: 'NODE_UPDATE',
          node_id: nid,
          callsign,
          role,
          team_id: teamId,
          team_name: teamName,
          tx_power_dbm: txPowerDbm,
          ...(includeAgl ? { agl_m: aglM } : {}),
        });

        // Optimistic immediate UI projection so labels/tables/selectors reflect update cleanly
        state.networkNodeNames.set(nid, callsign);
        state.networkNodeOptionsSignature = '';
        state.lastRenderedNodesKey = '';
        state.lastOpsFleetSignature = '';
        ['quickNodeSelect', 'termNodeSelect', 'vsa-node-select', 'eud-node-select', 'traffic-node-select', 'ops-fleet-team-filter'].forEach((id) => {
          const el = $(id);
          if (el) delete el.dataset.lastKey;
        });
        const liveNodes = state.latestTelemetry?.nodes_telemetry as any[] | undefined;
        const targetNode = liveNodes?.find((n: any) => n.node_id === nid);
        if (targetNode) {
          targetNode.name = callsign;
          targetNode.label = callsign;
          targetNode.node_role = role;
          targetNode.node_type = role;
          targetNode.team_id = teamId;
          targetNode.team_name = teamName;
          targetNode.tx_power_dbm = txPowerDbm;
          if (includeAgl) targetNode.agl_m = aglM;
        }
        if (state.latestTelemetry) {
          actions.updateDashboardDOM(state.latestTelemetry, true);
          actions.renderSelectedNodeDetails();
          actions.drawRadar();
        }
        closeNodeEditModal();
      };
    }

    const fleetFilter = $<HTMLSelectElement>('ops-fleet-team-filter');
    fleetFilter?.addEventListener('change', () => {
      const teamKey = parseTeamSelection(fleetFilter.value);
      state.opsFleetTeamFilter = teamKey;
      state.lastOpsFleetSignature = '';
      if (state.latestTelemetry?.nodes_telemetry) {
        actions.renderOpsFleetRegistry(state.latestTelemetry.nodes_telemetry);
      }
    });

    $('btn-ops-team-assign')?.addEventListener('click', () => {
      const rawName = $<HTMLInputElement>('ops-team-name-input')?.value?.trim() || '';
      const filterVal = $<HTMLSelectElement>('ops-fleet-team-filter')?.value || '';
      const fallbackTeam = parseTeamSelection(filterVal);
      const teamName = rawName || (fallbackTeam ? fallbackTeam : '');
      if (!teamName) {
        setText('ops-team-status', 'Enter a team name first.');
        return;
      }
      const checked = Array.from(state.checkedFleetNodeIds);
      const nodeIds = checked.length > 0 ? checked : (state.selectedNodeId >= 0 ? [state.selectedNodeId] : []);
      if (nodeIds.length === 0) {
        setText('ops-team-status', 'Check nodes or select a terminal first.');
        return;
      }
      const teamId = normalizeTeamId(teamName);
      actions.sendCommand({
        type: 'TEAM_ASSIGN',
        node_ids: nodeIds,
        team_id: teamId,
        team_name: teamName,
      });
      state.checkedFleetNodeIds.clear();
      state.networkNodeOptionsSignature = '';
      state.lastRenderedNodesKey = '';
      state.lastOpsFleetSignature = '';
      ['quickNodeSelect', 'termNodeSelect', 'vsa-node-select', 'eud-node-select', 'traffic-node-select', 'ops-fleet-team-filter'].forEach((id) => {
        const el = $(id);
        if (el) delete el.dataset.lastKey;
      });
      const liveNodes = state.latestTelemetry?.nodes_telemetry as any[] | undefined;
      if (liveNodes) {
        for (const n of liveNodes) {
          if (nodeIds.includes(n.node_id)) {
            n.team_id = teamId;
            n.team_name = teamName;
          }
        }
        actions.updateDashboardDOM(state.latestTelemetry!, true);
        actions.renderSelectedNodeDetails();
        actions.drawRadar();
      }
      setText('ops-team-status', `Grouped ${nodeIds.length} node(s) into "${teamName}".`);
    });

    if (btnCancel) {
      btnCancel.onclick = () => {
        if (form) form.style.display = 'none';
      };
    }

    if (btnSubmit) {
      btnSubmit.onclick = () => {
        if (
          state.spatialLocked ||
          (state.simTimelineController && state.simTimelineController.isHistoricalInspecting)
        ) {
          showNodeFeedback(
            'Cannot save node changes while Spatial Lock or Historical Inspection is active.',
            true
          );
          return;
        }
        const callsign = $<HTMLInputElement>('node-input-callsign')?.value?.trim();
        const rawRole = $<HTMLSelectElement>('node-input-role')?.value || 'soldier';
        const role: 'soldier' | 'mcp' | 'convoy' =
          rawRole === 'mcp' ? 'mcp' : rawRole === 'convoy' ? 'convoy' : 'soldier';
        const teamName = $<HTMLInputElement>('node-input-team')?.value?.trim() || (role === 'mcp' ? 'HQ Command' : 'Alpha Squad');
        const teamId = normalizeTeamId(teamName);
        const xM = Number($<HTMLInputElement>('node-input-x')?.value);
        const yM = Number($<HTMLInputElement>('node-input-y')?.value);
        const aglM = Number($<HTMLInputElement>('node-input-agl')?.value);
        const txPowerDbm = Number($<HTMLInputElement>('node-input-tx-power')?.value);
        const batteryCapacityMah = Number($<HTMLInputElement>('node-input-battery-capacity')?.value);
        const batteryLevelPct = Number($<HTMLInputElement>('node-input-battery-level')?.value);
        const tacticalPriority = Number($<HTMLInputElement>('node-input-priority')?.value);
        const colorHex = $<HTMLInputElement>('node-input-color')?.value?.trim();

        const coordVal = validateNodeCoordinates(xM, yM);
        if (!coordVal.valid) {
          showNodeFeedback(coordVal.error || 'Invalid coordinates.', true);
          return;
        }
        const aglVal = validateNodeAglHeight(aglM);
        if (!aglVal.valid) {
          showNodeFeedback(aglVal.error || 'Invalid AGL.', true);
          return;
        }
        if (callsign) {
          const csVal = validateNodeCallsign(callsign);
          if (!csVal.valid) {
            showNodeFeedback(csVal.error || 'Invalid callsign.', true);
            return;
          }
        }
        const txVal = validateNodeTxPower(txPowerDbm);
        if (!txVal.valid) {
          showNodeFeedback(txVal.error || 'Invalid transmit power.', true);
          return;
        }
        const batCapVal = validateNodeBatteryCapacity(batteryCapacityMah);
        if (!batCapVal.valid) {
          showNodeFeedback(batCapVal.error || 'Invalid battery capacity.', true);
          return;
        }
        const batLvlVal = validateNodeBatteryLevel(batteryLevelPct);
        if (!batLvlVal.valid) {
          showNodeFeedback(batLvlVal.error || 'Invalid battery level.', true);
          return;
        }
        const priVal = validateNodeTacticalPriority(tacticalPriority);
        if (!priVal.valid) {
          showNodeFeedback(priVal.error || 'Invalid tactical priority.', true);
          return;
        }
        if (colorHex) {
          const colVal = validateNodeColorHex(colorHex);
          if (!colVal.valid) {
            showNodeFeedback(colVal.error || 'Invalid color hex.', true);
            return;
          }
        }

        if (state.nodeEditorMode === 'add') {
          actions.sendCommand({
            ...buildNodeAddCommand({
              xM,
              yM,
              aglM,
              callsign: callsign || undefined,
              role: role === 'mcp' ? 'mcp' : 'soldier',
              colorHex,
              txPowerDbm,
              batteryCapacityMah,
              batteryLevelPct,
              tacticalPriority,
            }),
            role,
            team_id: teamId,
            team_name: teamName,
          });
        } else {
          actions.sendCommand({
            ...buildNodeUpdateCommand(state.nodeEditorTargetId, {
              xM,
              yM,
              aglM,
              callsign: callsign || undefined,
              role: role === 'mcp' ? 'mcp' : 'soldier',
              colorHex,
              txPowerDbm,
              batteryCapacityMah,
              batteryLevelPct,
              tacticalPriority,
            }),
            role,
            team_id: teamId,
            team_name: teamName,
          });
        }
      };
    }
  }
  (window as any).initNodeInventoryToolbar = initNodeInventoryToolbar;

  function syncNodeDropdowns(nid: number) {
    ['quickNodeSelect', 'termNodeSelect', 'vsa-node-select', 'ntn-node-select', 'eud-node-select'].forEach(
      (id) => {
        const sel = $<HTMLSelectElement>(id);
        if (!sel) return;
        if (shouldDeferSelectMutation(sel)) {
          sel.dataset.pendingOptSync = '1';
          return;
        }
        const nextVal = String(nid);
        if (sel.value !== nextVal) sel.value = nextVal;
      }
    );
    state.selectedNtnNodeId = Number(nid);
    if (
      typeof state.latestTelemetry !== 'undefined' &&
      state.latestTelemetry &&
      typeof actions.renderNtnSignalingAnalyzer === 'function'
    ) {
      actions.renderNtnSignalingAnalyzer(state.latestTelemetry);
    }
    if (state.threeController) {
      state.threeController.setSelectedNode(nid);
    }
  }

  (window as any).onTargetNodeChange = function (val: any) {
    if (historyController.isInspecting) return;
    const rc = $('radar-container');
    const cw = rc?.getBoundingClientRect().width || rc?.clientWidth || 0;
    if (cw < 1100) (window as any).setTerrainToolboxExpanded?.(false);
    disarmAllDestructiveConfirmations();
    state.inspectingAcn = false;
    state.inspectorDismissed = false;

    const teamKey = parseTeamSelection(String(val ?? ''));
    if (teamKey) {
      state.selectedTeamId = teamKey;
      state.selectedTrafficTeamId = teamKey;
      const allNodes = state.latestTelemetry?.nodes_telemetry || [];
      const members = allNodes.filter((n: any) => nodeMatchesTeam(n, teamKey));
      if (members.length > 0) {
        const worst = [...members].sort((a: any, b: any) => {
          const aOut = a.link_outage ? -999 : (a.snr_db ?? 999);
          const bOut = b.link_outage ? -999 : (b.snr_db ?? 999);
          return aOut - bOut;
        })[0];
        state.selectedNodeId = worst.node_id;
        syncNodeDropdowns(state.selectedNodeId);
        ['quickNodeSelect', 'termNodeSelect'].forEach((id) => {
          const sel = $<HTMLSelectElement>(id);
          if (sel && !shouldDeferSelectMutation(sel)) sel.value = `team:${teamKey}`;
        });
        const teamDisplayName = members[0].team_name || teamKey;
        setText('wf-target-node-badge', `TEAM: ${teamDisplayName} · Focus Node ${worst.node_id}`);
        actions.sendCommand({ type: 'SELECT_NODE', node_id: state.selectedNodeId });
      }
      if (state.latestTelemetry) {
        actions.renderQosSlaAnalyzer(state.latestTelemetry);
        actions.renderNetworkTrafficInventory(state.latestTelemetry);
        actions.renderSelectedNodeDetails();
        actions.drawRadar();
        actions.drawFresnel();
        actions.updateDashboardDOM(state.latestTelemetry, true);
      }
      return;
    }

    state.selectedTeamId = null;
    state.selectedTrafficTeamId = null;
    state.selectedNodeId = parseInt(val, 10);
    setText('wf-target-node-badge', `Inspecting Target Node ${state.selectedNodeId}`);
    state.pendingAglUpdate = null;
    syncNodeDropdowns(state.selectedNodeId);
    syncSelectedNodeAglUI();
    actions.sendCommand({ type: 'SELECT_NODE', node_id: state.selectedNodeId });
    actions.updateSchedulerScrubberUI();
    if (state.latestTelemetry && state.latestTelemetry.nodes_telemetry) {
      const search = $<HTMLInputElement>('terminal-search');
      actions.renderTerminalInventory(
        state.latestTelemetry.nodes_telemetry,
        state.selectedNodeId,
        search ? search.value : ''
      );
      const sel =
        state.latestTelemetry.nodes_telemetry.find(
          (n: any) => n.node_id === state.selectedNodeId
        ) || state.latestTelemetry.nodes_telemetry[0];
      actions.getDashboardAndAuthoringController().renderVsaScope(sel, state.latestTelemetry);
      state.selectedTrafficNodeId = state.selectedNodeId;
      const trafficSel = $<HTMLSelectElement>('traffic-node-select');
      if (
        trafficSel &&
        !shouldDeferSelectMutation(trafficSel) &&
        Array.from(trafficSel.options).some((o: HTMLOptionElement) => Number(o.value) === state.selectedNodeId)
      ) {
        trafficSel.value = String(state.selectedNodeId);
      }
      actions.renderNetworkTrafficInventory(state.latestTelemetry);
    }
    actions.renderSelectedNodeDetails();
    actions.drawRadar();
    if (schedHistoryController.isInspecting) {
      actions.syncSchedulerHistoricalUIState();
    } else {
      actions.drawSchedulerCharts();
      if (state.latestTelemetry) actions.updateDashboardDOM(state.latestTelemetry, true);
    }
  };

  window.filterTerminalOptions = function(query) {
    const sel = $<HTMLSelectElement>('termNodeSelect');
    if (!sel) return;
    const q = String(query || '')
      .trim()
      .toLowerCase();
    let visible = 0;
    Array.from(sel.options).forEach((option: HTMLOptionElement) => {
      const match = !q || (option.textContent || '').toLowerCase().includes(q);
      option.hidden = !match;
      if (match) visible++;
    });
    const selected = sel.selectedOptions[0];
    setText(
      'terminal-search-status',
      `${visible} matching terminal${visible === 1 ? '' : 's'}${selected && selected.hidden ? ' · current selection is outside this filter' : ''}`
    );

    if (state.latestTelemetry && state.latestTelemetry.nodes_telemetry) {
      actions.renderTerminalInventory(
        state.latestTelemetry.nodes_telemetry,
        state.selectedNodeId,
        q
      );
    }
  };

  (window as any).injectTraffic = function (type: string) {
    actions.sendCommand({
      type: 'INJECT_TRAFFIC',
      node_id: state.selectedNodeId,
      traffic_type: type,
    });
    const eventTarget = (window as any).event?.target;
    if (eventTarget && eventTarget.tagName === 'BUTTON') {
      const origText = eventTarget.textContent;
      eventTarget.textContent = '[OK] Injected!';
      eventTarget.disabled = true;
      setTimeout(() => {
        eventTarget.textContent = origText;
        eventTarget.disabled = false;
      }, 450);
    }
  };

  (window as any).clearTransfer = function () {
    actions.sendCommand({ type: 'CLEAR_TRANSFER', node_id: state.selectedNodeId });
  };

  (window as any).switchMainTab = function (targetTabId: string) {
    if (targetTabId === 'tab-diagnostics') {
      targetTabId = 'tab-doc';
      (window as any).switchDocSubview?.('diag');
    }
    if (state.tbOpen) {
      actions.closeTerrainToolbox();
    }
    actions.syncTelemetrySubscriptionProfile(targetTabId);
    document.querySelectorAll('.detail-viewport > .tab-content').forEach((el: any) => {
      el.style.display = '';
    });
    TABS.forEach((tid) => {
      const pane = $(tid);
      const btn = $(`tab-btn-${tid.replace('tab-', '')}`);
      const isActive = tid === targetTabId;
      if (pane) pane.classList.toggle('active', isActive);
      if (btn) {
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
        btn.tabIndex = isActive ? 0 : -1;
      }
    });
    if (state.latestTelemetry) {
      actions.updateDashboardDOM(state.latestTelemetry, true);
      if (targetTabId === 'tab-terminal') {
        if (state.currentTrafficSubtab === 'traffic') {
          actions.renderNetworkTrafficInventory(state.latestTelemetry);
        } else if (state.latestTelemetry.nodes_telemetry) {
          const search = $<HTMLInputElement>('terminal-search');
          actions.renderTerminalInventory(
            state.latestTelemetry.nodes_telemetry,
            state.selectedNodeId,
            search ? search.value : ''
          );
          const sel =
            state.latestTelemetry.nodes_telemetry.find(
              (n: any) => n.node_id === state.selectedNodeId
            ) || state.latestTelemetry.nodes_telemetry[0];
          actions.getDashboardAndAuthoringController().renderVsaScope(sel, state.latestTelemetry);
        }
      } else if (targetTabId === 'tab-network') {
        actions.renderNetworkTrafficInventory(state.latestTelemetry);
        actions.renderQosSlaAnalyzer(state.latestTelemetry);
      } else if (targetTabId === 'tab-registration') {
        actions.renderRegistration(state.latestTelemetry);
      } else if (targetTabId === 'tab-soldier') {
        actions.renderSoldierPhoneWorkspace(state.latestTelemetry);
      }
    }
    if (targetTabId === 'tab-doc' && state.currentDocSubview === 'diag' && state.latestTelemetry) {
      diagnosticsTracker.renderIntoDom(
        state.latestTelemetry,
        {
          spatialCount: simSpatialBuffer.count,
          spatialCapacity: simSpatialBuffer.capacity,
          epochCount: simEpochStore.count,
          epochCapacity: simEpochStore.capacity,
        },
        {
          cadenceId: 'diag-ipc-cadence',
          jitterId: 'diag-ipc-jitter',
          pacingId: 'diag-worker-pacing',
          lookaheadSummaryId: 'diag-lookahead-state',
          buffersId: 'diag-history-buffers',
          revisionId: 'diag-revision-meta',
          jsonId: 'diag-raw-json-pre',
        },
        { force: true, isPanelVisible: true }
      );
      actions.getSystemHealthHud().update({
        frame: state.latestTelemetry,
        rollingStepSamples: state.rollingWorkerStepSamples,
        rollingInterFrameDeltas: state.rollingWorkerInterFrameDeltas,
        recordedEventsCount: flightRecorder.getEventCount(),
      });
    }
    scheduleResizeCanvases();
    actions.markUiDirtyAndWake();
  };

  let resizeCanvasesRafId: number | null = null;
  function scheduleResizeCanvases() {
    if (resizeCanvasesRafId !== null) return;
    resizeCanvasesRafId = requestAnimationFrame(() => {
      resizeCanvasesRafId = null;
      resizeCanvases();
    });
  }

  function resizeCanvases() {
    const activeTabId = document.querySelector('.tab-content.active')?.id || 'tab-overview';
    if (state.terrainMapMode === 'maplibre') {
      state.mapLibreInstance?.resize();
    } else if ((state.terrainMapMode as string) === '3d') {
      state.threeController?.handleResize();
    } else if (radarCanvas) {
      syncCanvasDpr(radarCanvas);
      actions.drawRadar();
    }
    if (state.simTimelineRenderer) {
      state.simTimelineRenderer.syncCanvas();
      state.simTimelineRenderer.render();
    }
    if (activeTabId === 'tab-scheduler') {
      [
        waterfallCanvas,
        $<HTMLCanvasElement>('sched-chart-utilization'),
        $<HTMLCanvasElement>('sched-chart-backlog'),
      ].forEach((c) => c && syncCanvasDpr(c));
      actions.drawWaterfall();
      actions.drawSchedulerCharts();
      if (state.latestTelemetry) {
        actions.drawEcdfDelayScope(state.latestTelemetry);
        actions.drawSensitivitySweepScope(state.latestTelemetry);
      }
    } else if (activeTabId === 'tab-terrain') {
      [terrainCanvas, polarAntennaCanvas, linkWaterfallCanvas].forEach(
        (c) => c && syncCanvasDpr(c)
      );
      if (
        state.activeTerrainBounds &&
        typeof state.activeTerrainBounds.minX === 'number' &&
        typeof state.activeTerrainBounds.maxX === 'number' &&
        typeof state.activeTerrainBounds.minY === 'number' &&
        typeof state.activeTerrainBounds.maxY === 'number' &&
        terrainTopViewport?.fitToBounds
      )
        terrainTopViewport.fitToBounds(
          {
            minX: state.activeTerrainBounds.minX,
            maxX: state.activeTerrainBounds.maxX,
            minY: state.activeTerrainBounds.minY,
            maxY: state.activeTerrainBounds.maxY,
          },
          actions.getTerrainLayout(),
          0.08
        );
      actions.drawFresnel();
      if (state.latestTelemetry) {
        actions.drawPolarAntennaScope(state.latestTelemetry);
        actions.drawLinkWaterfallCanvas(state.latestTelemetry);
      }
    } else if (activeTabId === 'tab-network') {
      actions.drawNetworkCharts();
      if (state.latestTelemetry) actions.renderQosSlaAnalyzer(state.latestTelemetry);
    } else if (activeTabId === 'tab-authoring') {
      const fpCanvas = $<HTMLCanvasElement>('fp-vertical-profile-canvas');
      if (fpCanvas) syncCanvasDpr(fpCanvas);
      renderFlightPlanVerticalProfile();
    } else if (activeTabId === 'tab-doc' && isDiagnosticsPanelVisible()) {
      [$<HTMLCanvasElement>('worker-jitter-canvas'), $<HTMLCanvasElement>('twin-calibration-canvas')].forEach(
        (c) => c && syncCanvasDpr(c)
      );
      actions.renderWorkerJitterProfiler(
        typeof state.latestTelemetry !== 'undefined' ? state.latestTelemetry : null
      );
      (window as any).renderTwinCalibrationScope?.();
    } else if (activeTabId === 'tab-soldier') {
      const sc = $<HTMLCanvasElement>('soldier-phone-canvas');
      if (sc) syncCanvasDpr(sc);
    }
    syncFloatingOverlayLayout();
  }

  function syncTabWithLocationHash() {
    const hash = window.location.hash || '';
    if (/^#report-/.test(hash)) {
      (window as any).switchMainTab('tab-doc');
      (window as any).switchDocSubview?.('ref');
      const targetEl = document.getElementById(hash.slice(1));
      if (targetEl)
        requestAnimationFrame(() => targetEl.scrollIntoView({ behavior: 'auto', block: 'start' }));
    } else if (hash) {
      const rawTab = hash.split('?')[0].replace(/^#/, '');
      if (TABS.includes(rawTab)) {
        (window as any).switchMainTab(rawTab);
      }
    }
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('preset')) {
      setTimeout(() => (window as any).loadPreset(urlParams.get('preset')), 100);
    }
    if (urlParams.has('node')) {
      const nid = Number(urlParams.get('node'));
      if (Number.isFinite(nid)) setTimeout(() => actions.handleNodeSelection(nid), 300);
    }
    if (urlParams.has('mapMode')) {
      const mm = urlParams.get('mapMode');
      if (mm === 'radar' || mm === 'maplibre') {
        (window as any).setMapMode(mm);
      }
    }
    if (urlParams.has('scenario')) {
      const sc = urlParams.get('scenario');
      if (sc === 'kargil') {
        setTimeout(() => (window as any).runKargilScenario?.(), 150);
      }
    }
    if (urlParams.has('view')) {
      const v = urlParams.get('view');
      const select = $<HTMLSelectElement>('network-view-mode');
      if (select && (v === 'individual' || v === 'aggregate')) {
        select.value = v;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  function bindUxAndOverlayListeners() {
    const welcome = $('welcome');
    const KEY = 'xband-tour-dismissed';
    if (welcome) welcome.hidden = true;
    $('welcome-dismiss')?.addEventListener('click', () => {
      if (welcome) welcome.hidden = true;
      try {
        localStorage.setItem(KEY, '1');
      } catch (_) {}
    });
    $('btn-help')?.addEventListener('click', () => {
      if (!welcome) return;
      if (!welcome.hidden) {
        welcome.hidden = true;
      } else {
        (window as any).switchMainTab('tab-overview');
        (window as any).switchOverviewSubview?.('ops');
        welcome.hidden = false;
        welcome.scrollIntoView({ block: 'nearest' });
      }
    });
    const ex = $('btn-expert');
    ex?.addEventListener('click', () => {
      const on = !ex.classList.contains('active');
      ex.classList.toggle('active', on);
      ex.setAttribute('aria-pressed', String(on));
      document.querySelectorAll('details[data-adv]').forEach((d: any) => (d.open = on));
    });
    document.querySelectorAll('details[data-adv]').forEach((d) => {
      d.addEventListener('toggle', () => {
        const all = document.querySelectorAll('details[data-adv]');
        const open = document.querySelectorAll('details[data-adv][open]');
        const allOpen = all.length > 0 && all.length === open.length;
        ex?.classList.toggle('active', allOpen);
        ex?.setAttribute('aria-pressed', String(allOpen));
      });
    });

    document.querySelectorAll('.health-chip').forEach((chip) => {
      const jumpToTerminals = () => {
        (window as any).switchMainTab?.('tab-terminal');
        const table = document.getElementById('terminal-inventory-table');
        table?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      chip.addEventListener('click', jumpToTerminals);
      chip.addEventListener('keydown', (e: any) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          jumpToTerminals();
        }
      });
    });

    const tabs = [
      'overview',
      'scheduler',
      'network',
      'terrain',
      'terminal',
      'authoring',
      'doc',
      'registration',
      'soldier',
    ];
    document.addEventListener('keydown', (e: any) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (state.equipmentPlacementArmed) {
          disarmEquipmentPlacement('Equipment placement canceled.');
          return;
        }
        const nodeEditModal = $('node-modal-overlay');
        if (nodeEditModal && !nodeEditModal.hidden) {
          closeNodeEditModal();
          return;
        }
        const modal = $('upload-modal');
        if (modal && !modal.hidden)
          return (window as any).closeUploadModal && (window as any).closeUploadModal();
        const radarContainer = $('radar-container');
        if (radarContainer && radarContainer.getAttribute('data-layers-open') === 'true') return;
        const details = $('map-node-details');
        if (
          details &&
          !details.classList.contains('is-empty') &&
          !details.classList.contains('is-closed')
        ) {
          (window as any).dismissNodeInspector?.();
        }
        return;
      }
      if (e.target.closest && e.target.closest('input,select,textarea,button,[contenteditable]'))
        return;
      if (/^[1-9]$/.test(e.key))
        (window as any).switchMainTab('tab-' + tabs[Number(e.key) - 1]);
      else if (e.key === ' ') {
        e.preventDefault();
        (window as any).togglePause();
      } else if (e.key === '.') (window as any).stepSim();
      else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        if (typeof (window as any).toggleTerrainToolbox === 'function')
          (window as any).toggleTerrainToolbox();
        else (window as any).setTerrainToolboxExpanded?.(!(window as any).tbOpen);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        document.getElementById('radar-canvas')?.focus?.();
        document
          .getElementById('radar-container')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (e.key === '?') {
        e.preventDefault();
        if (welcome) welcome.hidden = !welcome.hidden;
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') state.isShiftKeyDown = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') state.isShiftKeyDown = false;
    });
    window.addEventListener('blur', () => {
      state.isShiftKeyDown = false;
    });

    $('btn-legend-toggle')?.addEventListener('click', () => {
      const legend = document.querySelector('.map-legend') as HTMLElement | null;
      const btn = $('btn-legend-toggle');
      if (!legend || !btn) return;
      const currentlyHidden =
        getComputedStyle(legend).display === 'none' || legend.classList.contains('is-collapsed');
      if (currentlyHidden) {
        const rc = $('radar-container');
        const cw = rc?.getBoundingClientRect().width || rc?.clientWidth || 0;
        if (cw < 900) {
          (window as any).setTerrainToolboxExpanded?.(false);
        }
        legend.classList.remove('is-collapsed');
        legend.classList.add('is-user-expanded');
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        legend.classList.add('is-collapsed');
        legend.classList.remove('is-user-expanded');
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      }
      if (state.stageViewMode !== '3d') {
        actions.drawRadar();
      }
      syncFloatingOverlayLayout();
    });

    $('btn-narrative-expand')?.addEventListener('click', () => {
      const nar = $('overview-narrative');
      const btn = $('btn-narrative-expand');
      if (!nar || !btn) return;
      const expanded = nar.classList.toggle('is-expanded');
      btn.setAttribute('aria-expanded', String(expanded));
    });

    $('btn-banner-return-live')?.addEventListener('click', () => {
      state.simTimelineController?.jumpToLive();
    });

    $('map-node-details')?.addEventListener('click', (event: any) => {
      const rfToggle = event.target?.closest?.('[data-rf-toggle]')?.dataset.rfToggle;
      if (rfToggle === 'los') {
        mapLayerRegistry.toggleLayer('rf.losAnalysis');
        return;
      }
      if (rfToggle === 'fresnel') {
        mapLayerRegistry.toggleLayer('rf.fresnelZone');
        const activeTabId = document.querySelector('.tab-content.active')?.id || 'tab-overview';
        actions.syncTelemetrySubscriptionProfile(activeTabId);
        return;
      }
      const action = event.target?.closest?.('[data-map-action]')?.dataset.mapAction;
      if (!action) return;
      if (action === 'edit') openNodeEditModal(state.selectedNodeId);
      else if (action === 'delete') return;
      else if (action === 'performance') (window as any).switchMainTab?.('tab-terrain');
      else if (action === 'soldier-phone') (window as any).openSoldierPhone?.();
      else if (action === 'focus') {
        if (state.inspectingAcn) {
          (window as any).centerMapOnACN();
          return;
        }
        const isTimelineHist = Boolean(
          state.simTimelineController && state.simTimelineController.isHistoricalInspecting
        );
        const histSnap =
          isTimelineHist && state.simTimelineController
            ? state.simTimelineController.getActiveSpatialSnapshot()
            : null;
        let targetXM = Number.NaN,
          targetYM = Number.NaN;
        if (histSnap) {
          const hNode = histSnap.nodes.find((n: any) => n.nodeId === state.selectedNodeId);
          if (hNode) {
            targetXM = hNode.posX;
            targetYM = hNode.posY;
          }
        } else if (!isTimelineHist) {
          const node = state.latestTelemetry?.nodes_telemetry?.find(
            (item: any) => item.node_id === state.selectedNodeId
          );
          if (node) {
            targetXM =
              node.x_m !== undefined
                ? node.x_m
                : node.position
                  ? node.position[0]
                  : Number.NaN;
            targetYM =
              node.y_m !== undefined
                ? node.y_m
                : node.position
                  ? node.position[1]
                  : Number.NaN;
          }
        }
        if (!Number.isFinite(targetXM) || !Number.isFinite(targetYM)) return;
        state.panOffsetX_m = targetXM;
        state.panOffsetY_m = targetYM;
        if (state.terrainMapMode === 'maplibre' && state.mapLibreInitialized) {
          actions.easeMapLibreToLocalCenter(targetXM, targetYM, 300);
        } else {
          actions.drawRadar();
        }
      }
    });

    $('btn-close-node-details')?.addEventListener('click', (e: any) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      dismissNodeInspector();
    });

    $('edit-mode-done-btn')?.addEventListener('click', () => {
      if (state.nodeMoveModeActive) {
        state.nodeMoveModeActive = false;
        setText('map-node-action-status', '');
        syncEditModeBanner();
        syncRadarHudMode();
      }
      if (state.waypointPlacementArmed) {
        state.waypointPlacementArmed = false;
        $('trajectory-place-point')?.classList.remove('active');
        syncEditModeBanner();
        syncRadarHudMode();
        actions.updateMapLibreCursor();
        setTrajectoryMessage('Waypoint placement finished.');
      }
      if (obstacleEditor.mode !== 'navigate') {
        activateObstacleMode('navigate');
      }
      if (state.equipmentPlacementArmed) {
        disarmEquipmentPlacement('Equipment placement finished.');
      }
    });

    $('edit-mode-cancel-btn')?.addEventListener('click', () => {
      if (state.equipmentPlacementArmed) {
        disarmEquipmentPlacement('Equipment placement canceled.');
      }
      if (state.nodeMoveModeActive) {
        state.nodeMoveModeActive = false;
        setText('map-node-action-status', '');
        syncEditModeBanner();
        syncRadarHudMode();
      }
      if (state.waypointPlacementArmed) {
        cancelTrajectoryDraft();
        syncEditModeBanner();
        syncRadarHudMode();
        actions.updateMapLibreCursor();
      }
      if (obstacleEditor.mode !== 'navigate') {
        cancelObstacleDraft();
        activateObstacleMode('navigate');
      }
    });

    $('trajectory-mode')?.addEventListener('change', (event: any) =>
      setTrajectoryDraftMode(event.target.value)
    );
    ['traj-center-x', 'traj-center-y', 'traj-axis-a', 'traj-axis-b', 'traj-rotation'].forEach(
      (id) => $(id)?.addEventListener('input', editEllipseFromInputs)
    );
    ['traj-waypoint-x', 'traj-waypoint-y', 'traj-waypoint-z'].forEach((id) =>
      $(id)?.addEventListener('input', editSelectedWaypointFromInputs)
    );
    $('traj-speed-slider')?.addEventListener('input', (e: any) => {
      const v = e.target.value;
      const spdMps = $<HTMLInputElement>('traj-speed-mps');
      if (spdMps) spdMps.value = v;
      setTrajectoryMessage(`Draft speed: ${Number(v).toFixed(1)} m/s. Apply to commit.`);
    });
    $('traj-speed-mps')?.addEventListener('input', (e: any) => {
      const v = parseFloat(e.target.value);
      const spdSlider = $<HTMLInputElement>('traj-speed-slider');
      if (Number.isFinite(v) && spdSlider)
        spdSlider.value = String(Math.min(300, Math.max(0, v)));
      setTrajectoryMessage(
        `Draft speed: ${Number.isFinite(v) ? v.toFixed(1) : '--'} m/s. Apply to commit.`
      );
    });
    $('traj-altitude-msl')?.addEventListener('input', (e: any) => {
      const v = parseFloat(e.target.value);
      setTrajectoryMessage(
        `Draft altitude: ${Number.isFinite(v) ? v.toFixed(0) : '--'} m MSL. Apply to commit.`
      );
    });
    $('traj-altitude-mode')?.addEventListener('change', (e: any) => {
      const newMode = e.target.value;
      if (state.spatialLocked) {
        setTrajectoryMessage('Spatial lock is on. Unlock before changing altitude mode.', true);
        e.target.value = 'fix';
        updateAltitudeModeUI('fix');
        return;
      }
      updateAltitudeModeUI(newMode);
      const targetAgl = parseFloat($<HTMLInputElement>('traj-target-agl')?.value || '1500');
      actions.sendCommand({
        type: 'CONFIG_UPDATE',
        params: {
          altitude_mode: newMode,
          ...(newMode === 'agl' && Number.isFinite(targetAgl) ? { target_agl_m: targetAgl } : {}),
        },
      });
      setTrajectoryMessage(
        `Altitude mode switched to ${newMode.toUpperCase()}. Live in simulation.`
      );
    });
    $('traj-target-agl')?.addEventListener('input', (e: any) => {
      const v = parseFloat(e.target.value);
      setTrajectoryMessage(
        `Draft target AGL: ${Number.isFinite(v) ? v.toFixed(0) : '--'} m. Apply to commit.`
      );
    });
    $('traj-climb-rate')?.addEventListener('input', (e: any) => {
      const v = parseFloat(e.target.value);
      setTrajectoryMessage(
        `Draft climb ceiling: ${Number.isFinite(v) ? v.toFixed(1) : '--'} m/s. Apply to commit.`
      );
    });
    $('traj-descent-rate')?.addEventListener('input', (e: any) => {
      const v = parseFloat(e.target.value);
      setTrajectoryMessage(
        `Draft descent ceiling: ${Number.isFinite(v) ? v.toFixed(1) : '--'} m/s. Apply to commit.`
      );
    });
    $('trajectory-add-point')?.addEventListener('click', () => {
      const draft = trajectoryEditor.preview;
      const count = draft.mode === 'waypoints' ? draft.points.length : 0;
      const acn = state.latestTelemetry?.acn_telemetry;
      addWaypointAt(
        state.isMouseInsideRadar ? state.mouseWorldX : (acn?.pos_x || 0) + count * 1000,
        state.isMouseInsideRadar ? state.mouseWorldY : acn?.pos_y || 0
      );
    });
    $('trajectory-place-point')?.addEventListener('click', () => {
      state.waypointPlacementArmed = !state.waypointPlacementArmed;
      actions.getDashboardAndAuthoringController().setWaypointPlacementArmed(
        state.waypointPlacementArmed
      );
      if (state.waypointPlacementArmed) {
        state.nodeMoveModeActive = false;
        if (obstacleEditor.mode !== 'navigate') {
          obstacleEditor.setMode('navigate');
          refreshObstacleEditor();
        }
      }
      $('trajectory-place-point')?.classList.toggle('active', state.waypointPlacementArmed);
      syncRadarHudMode();
      actions.updateMapLibreCursor();
      setTrajectoryMessage(
        state.waypointPlacementArmed
          ? 'Click the map to place a draft waypoint.'
          : 'Map placement canceled.'
      );
    });
    $('trajectory-remove-point')?.addEventListener('click', () => {
      try {
        trajectoryEditor.removeSelectedWaypoint();
        refreshTrajectoryEditor();
        setTrajectoryMessage('Waypoint removed from the draft.');
      } catch (error: any) {
        setTrajectoryMessage(error.message, true);
      }
    });
    $('trajectory-apply')?.addEventListener('click', applyTrajectoryDraft);
    $('trajectory-cancel')?.addEventListener('click', cancelTrajectoryDraft);

    [
      'obstacle-x',
      'obstacle-y',
      'obstacle-width',
      'obstacle-depth',
      'obstacle-radius',
      'obstacle-height',
      'obstacle-rotation',
    ].forEach((id) => {
      $(id)?.addEventListener('input', () => editSelectedObstacleFromInputs(id));
    });
    $('obstacle-shape')?.addEventListener('change', (event: any) =>
      obstacleEditor.setPlacementShape(event.target.value)
    );
    $('obstacle-add')?.addEventListener('click', () =>
      createObstacleAt(state.panOffsetX_m, state.panOffsetY_m)
    );
    $('obstacle-place')?.addEventListener('click', () =>
      activateObstacleMode(obstacleEditor.mode === 'place' ? 'navigate' : 'place')
    );
    $('obstacle-select-mode')?.addEventListener('click', () =>
      activateObstacleMode(obstacleEditor.mode === 'select' ? 'navigate' : 'select')
    );
    $('obstacle-map-tool')?.addEventListener('click', () => {
      if (typeof (window as any).openTerrainToolbox === 'function') {
        (window as any).openTerrainToolbox('obstacle');
      } else {
        activateObstacleMode(obstacleEditor.mode === 'navigate' ? 'select' : 'navigate');
      }
    });
    armDestructiveConfirm($('obstacle-delete'), {
      armedLabel: 'Confirm Delete?',
      canArm: () =>
        !(
          state.spatialLocked ||
          obstacleEditor.spatialLocked ||
          state.simTimelineController?.isHistoricalInspecting
        ) &&
        obstacleEditor.pendingRequestId === null &&
        Boolean(obstacleEditor.selectedObstacle),
      onConfirm: () => {
        try {
          obstacleEditor.deleteSelected();
        } catch (error: any) {
          obstacleEditor.message = error.message;
        }
        refreshObstacleEditor();
      },
    });
    $('obstacle-apply')?.addEventListener('click', applyObstacleDraft);
    $('obstacle-cancel')?.addEventListener('click', cancelObstacleDraft);

    $('tdma-preset-select')?.addEventListener('change', (e: any) => {
      actions.getDashboardAndAuthoringController().handleTdmaPresetSelect(e.target.value);
    });
    [
      'tdma-frame-slider',
      'tdma-frame-ms',
      'tdma-ctrl-ms',
      'tdma-dl-min-ms',
      'tdma-dl-max-ms',
      'tdma-guard-us',
      'tdma-min-slot-us',
      'tdma-max-slot-ms',
      'tdma-fixed-slots',
    ].forEach((id) => {
      $(id)?.addEventListener('input', () =>
        actions.getDashboardAndAuthoringController().handleTdmaInputChange()
      );
    });
    $('tdma-policy')?.addEventListener('change', () =>
      actions.getDashboardAndAuthoringController().handleTdmaInputChange()
    );
    $('tdma-apply-btn')?.addEventListener('click', applyTdmaDraft);
    $('tdma-reset-btn')?.addEventListener('click', resetTdmaToStandard);

    $('terrain-zoom-out-btn')?.addEventListener('click', () => {
      if (state.terrainMapMode === 'maplibre' && state.mapLibreInstance)
        state.mapLibreInstance.zoomOut({ duration: 200 });
      else setRadarRange(state.currentRadarRangeM * 1.6);
    });
    $('terrain-zoom-in-btn')?.addEventListener('click', () => {
      if (state.terrainMapMode === 'maplibre' && state.mapLibreInstance)
        state.mapLibreInstance.zoomIn({ duration: 200 });
      else setRadarRange(state.currentRadarRangeM / 1.6);
    });

    const workspaceRail = document.querySelector('.rail[role="tablist"]');
    if (workspaceRail) {
      workspaceRail.addEventListener('keydown', (event: any) => {
        if (
          !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)
        )
          return;
        const tabs = Array.from(workspaceRail.querySelectorAll('[role="tab"]')) as HTMLElement[];
        const index = tabs.indexOf(document.activeElement as HTMLElement);
        if (index < 0) return;
        event.preventDefault();
        let next = index;
        if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
          next = (index + 1) % tabs.length;
        else next = (index - 1 + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      });
    }

    window.addEventListener('hashchange', syncTabWithLocationHash);
    window.addEventListener('resize', scheduleResizeCanvases);
    setTimeout(scheduleResizeCanvases, 30);
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver((entries) => {
        if (
          entries.some(
            (e) => e.contentRect && e.contentRect.width > 0 && e.contentRect.height > 0
          )
        )
          scheduleResizeCanvases();
      });
      [
        radarCanvas,
        waterfallCanvas,
        terrainCanvas,
        polarAntennaCanvas,
        linkWaterfallCanvas,
        $('sched-chart-utilization'),
        $('sched-chart-backlog'),
        $('network-individual-chart'),
        $('network-aggregate-chart'),
        $('qos-sla-canvas'),
      ].forEach((c) => c?.parentElement && ro.observe(c.parentElement));
    }
  }

  function initPlaybackSpeedControls() {
    const slider = $<HTMLInputElement>('sim-speed-slider');
    const input = $<HTMLInputElement>('sim-speed-input');
    for (const el of [slider, input]) {
      if (!el) continue;
      el.min = String(PLAYBACK_SPEED.min);
      el.max = String(PLAYBACK_SPEED.max);
      el.step = String(PLAYBACK_SPEED.step);
      el.value = String(PLAYBACK_SPEED.defaultValue);
    }

    const readout = $('sim-speed-readout');
    if (readout) readout.textContent = formatPlaybackSpeed(PLAYBACK_SPEED.defaultValue);

    const presets = document.querySelector('.sim-speed-presets');
    if (!presets) return;
    presets.textContent = '';
    for (const preset of PLAYBACK_SPEED.presets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'spd-preset-btn' + (preset === PLAYBACK_SPEED.defaultValue ? ' active' : '');
      btn.dataset.speed = String(preset);
      btn.textContent = formatPresetLabel(preset);
      btn.title = preset === 1 ? '1× speed (real-time)' : `${preset}× speed`;
      btn.addEventListener('click', () => (window as any).setSpeed(preset));
      presets.appendChild(btn);
    }
  }

  function bindExtractedDomListeners() {
    const byId = (id: string) => document.getElementById(id) as any;

    byId('dem-sector-select')?.addEventListener('change', (e: any) =>
      (window as any).onDemSectorChange?.(e.currentTarget.value)
    );
    byId('btn-pause')?.addEventListener('click', () => (window as any).togglePause?.());
    byId('btn-step')?.addEventListener('click', () => (window as any).stepSim?.());
    byId('sim-speed-slider')?.addEventListener('input', (e: any) =>
      (window as any).onSpeedSliderInput?.(e.currentTarget.value)
    );
    const speedInput = byId('sim-speed-input');
    speedInput?.addEventListener('change', (e: any) =>
      (window as any).onSpeedNumInput?.(e.currentTarget.value)
    );
    speedInput?.addEventListener('input', (e: any) =>
      (window as any).onSpeedNumInput?.(e.currentTarget.value)
    );

    document.querySelectorAll('.nav-tab[aria-controls]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('aria-controls');
        if (targetTab) (window as any).switchMainTab?.(targetTab);
      });
    });

    document.querySelectorAll('.tb-dem-preset-btn[data-dem-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-dem-preset');
        if (preset) (window as any).applyDemQuickPreset?.(preset);
      });
    });

    byId('btnView2D')?.addEventListener('click', () => (window as any).setStageViewMode?.('2d'));
    byId('btnView3D')?.addEventListener('click', () => (window as any).setStageViewMode?.('3d'));
    byId('btnRealTerrain')?.addEventListener('click', () =>
      (window as any).setTerrainMode?.('real')
    );
    byId('btnSynthTerrain')?.addEventListener('click', () =>
      (window as any).setTerrainMode?.('synthetic')
    );
    byId('btnUploadTerrain')?.addEventListener('click', () => (window as any).openUploadModal?.());
    byId('btnRes512')?.addEventListener('click', () =>
      (window as any).setTerrainMeshResolution?.('native512')
    );
    byId('btnRes256')?.addEventListener('click', () =>
      (window as any).setTerrainMeshResolution?.('balanced256')
    );

    document.querySelectorAll('[data-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rangeVal = Number(btn.getAttribute('data-range'));
        if (Number.isFinite(rangeVal)) (window as any).setRadarRange?.(rangeVal);
      });
    });

    byId('btn-center')?.addEventListener('click', () => (window as any).centerMapOnACN?.());
    byId('toggle-viewshed-heatmap')?.addEventListener('click', () =>
      (window as any).toggleViewshedHeatmap?.()
    );
    byId('btn-spatial-lock')?.addEventListener('click', () =>
      (window as any).toggleSpatialLock?.()
    );
    byId('btn-run-kargil-scenario')?.addEventListener('click', () =>
      (window as any).runKargilScenario?.()
    );
    byId('scheduler-quick-toggle')?.addEventListener('click', () =>
      (window as any).toggleActiveScheduler?.()
    );

    document.querySelectorAll('[data-preset-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const presetId = btn.getAttribute('data-preset-id');
        if (presetId) (window as any).loadPreset?.(presetId);
      });
    });

    byId('quickNodeSelect')?.addEventListener('change', (e: any) =>
      (window as any).onTargetNodeChange?.(e.currentTarget.value)
    );
    byId('quick-node-agl-input')?.addEventListener('change', (e: any) =>
      (window as any).onNodeAglChange?.(e.currentTarget.value)
    );
    byId('terrain-node-agl-input')?.addEventListener('change', (e: any) =>
      (window as any).onNodeAglChange?.(e.currentTarget.value)
    );
    byId('termNodeSelect')?.addEventListener('change', (e: any) =>
      (window as any).onTargetNodeChange?.(e.currentTarget.value)
    );
    byId('node-agl-input')?.addEventListener('change', (e: any) =>
      (window as any).onNodeAglChange?.(e.currentTarget.value)
    );
    byId('vsa-node-select')?.addEventListener('change', (e: any) =>
      (window as any).onTargetNodeChange?.(e.currentTarget.value)
    );
    byId('eud-node-select')?.addEventListener('change', (e: any) =>
      (window as any).onTargetNodeChange?.(e.currentTarget.value)
    );

    document.querySelectorAll('[data-switch-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-switch-tab');
        if (tabId) (window as any).switchMainTab?.(tabId);
      });
    });

    byId('btn-copy-latex-ablation')?.addEventListener('click', () =>
      (window as any).exportLatexAblationTable?.()
    );
    byId('sci-dem-error-slider')?.addEventListener('input', () =>
      (window as any).onScientificParamChange?.()
    );
    [
      'sci-traffic-scale-select',
      'sci-jammer-select',
      'sci-relay-select',
      'sci-fading-cqi-select',
    ].forEach((id) => {
      byId(id)?.addEventListener('change', () => (window as any).onScientificParamChange?.());
    });

    byId('prof-refractivity-select')?.addEventListener('change', (e: any) =>
      (window as any).onRefractivityChange?.(e.currentTarget.value)
    );
    byId('prof-toggle-fresnel-orders')?.addEventListener('click', () =>
      (window as any).toggleMultiOrderFresnel?.()
    );
    byId('btn-toggle-active-relay')?.addEventListener('click', () =>
      (window as any).toggleActiveRelay?.()
    );
    byId('btn-recompute-relay-advisor')?.addEventListener('click', () =>
      (window as any).recomputeRelayAdvisor?.()
    );

    byId('param-freq')?.addEventListener('input', () => (window as any).onParamChange?.());
    byId('param-bw')?.addEventListener('input', () => (window as any).onBandwidthParamChange?.());
    byId('param-rain')?.addEventListener('input', () => (window as any).onParamChange?.());
    byId('param-alt')?.addEventListener('input', () => (window as any).onParamChange?.());
    byId('param-cov')?.addEventListener('input', () =>
      (window as any).onCoverageParamChange?.()
    );

    const sendWaveformLockUpdate = () => {
      const modeVal = ($<HTMLSelectElement>('mcs-mode-select')?.value || 'acm_auto') as 'acm_auto' | 'manual_lock';
      const modVal = ($<HTMLSelectElement>('manual-mod-select')?.value || '16-QAM') as any;
      const fecVal = ($<HTMLSelectElement>('manual-fec-select')?.value || '3/4') as any;
      actions.sendCommand({
        type: 'CONFIG_UPDATE',
        params: {
          mcs_mode: modeVal,
          manual_modulation: modVal,
          manual_fec: fecVal,
        },
      });
      setText(
        'mcs-mode-readout',
        modeVal === 'manual_lock'
          ? `Manual Lock · ${modVal} ${fecVal}`
          : 'ACM Auto · Adaptive 8-Tier DVB-S2X'
      );
    };
    byId('mcs-mode-select')?.addEventListener('change', sendWaveformLockUpdate);
    byId('manual-mod-select')?.addEventListener('change', sendWaveformLockUpdate);
    byId('manual-fec-select')?.addEventListener('change', sendWaveformLockUpdate);

    byId('equip-type-select')?.addEventListener('change', (e: any) => {
      const eirpInput = $<HTMLInputElement>('equip-eirp-input');
      if (!eirpInput) return;
      const t = String(e.currentTarget.value);
      eirpInput.value = t === 'spot_jammer' ? '72' : t === 'relay_mast' ? '43' : t === 'esm_sensor' ? '20' : '65';
    });

    byId('btn-equip-place-map')?.addEventListener('click', () => {
      if (state.spatialLocked) {
        setText('equip-placement-status', 'Spatial lock active — unlock before placing equipment.');
        return;
      }
      state.equipmentPlacementArmed = !state.equipmentPlacementArmed;
      const btn = byId('btn-equip-place-map');
      if (btn) {
        btn.classList.toggle('active', state.equipmentPlacementArmed);
        btn.setAttribute('aria-pressed', state.equipmentPlacementArmed ? 'true' : 'false');
        btn.textContent = state.equipmentPlacementArmed ? 'Armed (Click Map)…' : 'Place on Map';
      }
      if (state.equipmentPlacementArmed) {
        state.nodeMoveModeActive = false;
        state.waypointPlacementArmed = false;
        const eqType = ($<HTMLSelectElement>('equip-type-select')?.value || 'barrage_jammer').replace(/_/g, ' ');
        setText('equip-placement-status', `Armed: click 2D Radar to place ${eqType} (Esc cancels).`);
        const rc = $('radar-canvas');
        if (rc) rc.style.cursor = 'crosshair';
        const overviewTab = $('tab-overview');
        if (overviewTab && !overviewTab.classList.contains('active')) {
          (window as any).switchMainTab?.('tab-overview');
        }
      } else {
        setText('equip-placement-status', 'Equipment placement canceled.');
      }
      syncRadarHudMode();
      actions.updateMapLibreCursor();
    });

    byId('btn-equip-clear-all')?.addEventListener('click', () => {
      if (state.spatialLocked) {
        setText('equip-placement-status', 'Spatial lock active — unlock before clearing equipment.');
        return;
      }
      state.equipmentPlacementArmed = false;
      const btn = byId('btn-equip-place-map');
      if (btn) {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
        btn.textContent = 'Place on Map';
      }
      actions.sendCommand({ type: 'EQUIPMENT_CLEAR' });
      setText('equip-placement-status', 'Cleared all deployed tactical equipment.');
      syncRadarHudMode();
    });

    byId('btn-hifi-all-toggle')?.addEventListener('click', () =>
      (window as any).toggleAllHiFiPhysics?.()
    );
    const hifiBindings: Array<[string, string]> = [
      ['toggle-hifi-attitude', 'enableAirframeShadowing'],
      ['toggle-hifi-rician', 'enableCorrelatedRicianFading'],
      ['toggle-hifi-harq', 'enableMacPhyFeedback'],
      ['toggle-hifi-dubins', 'enableDubinsKinematics'],
      ['toggle-hifi-viewshed-parity', 'viewshedFidelityMode'],
      ['toggle-hifi-abr', 'enableTransportAbr'],
    ];
    hifiBindings.forEach(([id, key]) => {
      byId(id)?.addEventListener('change', (e: any) =>
        (window as any).onHiFiToggleChange?.(key, e.currentTarget.checked)
      );
    });

    byId('ew-eccm-mode-select')?.addEventListener('change', (e: any) =>
      (window as any).onEwConfigChange?.('eccmMode', e.currentTarget.value)
    );
    byId('toggle-ew-mvdr')?.addEventListener('change', (e: any) =>
      (window as any).onEwConfigChange?.('enableMvdrNullSteering', e.currentTarget.checked)
    );
    byId('toggle-ew-esm')?.addEventListener('change', (e: any) =>
      (window as any).onEwConfigChange?.('enableAdversaryEsmModel', e.currentTarget.checked)
    );
    byId('ew-gnss-spoof-input')?.addEventListener('change', (e: any) =>
      (window as any).onEwConfigChange?.(
        'gnssSpoofingRateUsPerSec',
        parseFloat(e.currentTarget.value) || 0
      )
    );

    byId('toggle-biome-em')?.addEventListener('change', (e: any) =>
      (window as any).onBiomeEmToggleChange?.(e.currentTarget.checked)
    );
    byId('biome-pol-select')?.addEventListener('change', (e: any) =>
      (window as any).onBiomePolChange?.(e.currentTarget.value)
    );
    byId('biome-dust-vis')?.addEventListener('change', (e: any) =>
      (window as any).onBiomeDustVisChange?.(e.currentTarget.value)
    );
    byId('biome-foliage-depth')?.addEventListener('change', (e: any) =>
      (window as any).onBiomeFoliageDepthChange?.(e.currentTarget.value)
    );

    byId('btn-subtab-inventory')?.addEventListener('click', () =>
      (window as any).switchTerminalSubtab?.('inventory')
    );
    byId('btn-subtab-traffic')?.addEventListener('click', () =>
      (window as any).switchTerminalSubtab?.('traffic')
    );
    byId('terminal-search')?.addEventListener('input', (e: any) =>
      (window as any).filterTerminalOptions?.(e.currentTarget.value)
    );

    document.querySelectorAll('[data-inject-traffic]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kind = btn.getAttribute('data-inject-traffic');
        if (kind) (window as any).injectTraffic?.(kind);
      });
    });

    byId('btn-ai-reposition-node')?.addEventListener('click', () =>
      (window as any).executeAiNodeReposition?.()
    );
    byId('btn-eud-walk-ai')?.addEventListener('click', () =>
      (window as any).executeAiNodeReposition?.()
    );
    byId('btn-open-soldier-phone')?.addEventListener('click', () =>
      (window as any).openSoldierPhone?.()
    );
    byId('btn-ai-auto-heal-toggle')?.addEventListener('click', () =>
      (window as any).toggleAiAutoHeal?.()
    );
    byId('btn-ai-auto-heal-matrix-toggle')?.addEventListener('click', () =>
      (window as any).toggleAiAutoHeal?.()
    );
    byId('btn-eud-pin-shepherd')?.addEventListener('click', () =>
      (window as any).togglePinShepherd?.()
    );
    byId('btn-ai-buddy-mesh-toggle')?.addEventListener('click', () =>
      (window as any).toggleBuddyMesh?.()
    );
    byId('btn-ai-lpi-stealth-toggle')?.addEventListener('click', () =>
      (window as any).toggleLpiStealth?.()
    );
    byId('btn-clear-transfer')?.addEventListener('click', () => (window as any).clearTransfer?.());

    byId('traffic-node-select')?.addEventListener('change', (e: any) =>
      (window as any).onTrafficNodeSelectChange?.(e.currentTarget.value)
    );
    byId('traffic-search-input')?.addEventListener('input', () =>
      (window as any).onTrafficFilterChange?.()
    );
    byId('traffic-direction-filter')?.addEventListener('change', () =>
      (window as any).onTrafficFilterChange?.()
    );
    byId('traffic-status-filter')?.addEventListener('change', () =>
      (window as any).onTrafficFilterChange?.()
    );
    byId('btn-traffic-reset-filters')?.addEventListener('click', () =>
      (window as any).resetTrafficFilters?.()
    );

    document.querySelectorAll('[data-sort-col]').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort-col');
        if (col) (window as any).sortTrafficTable?.(col);
      });
    });

    let docsPopupRef: Window | null = null;
    const openResearchDocsWindow = () => {
      const tauriInvoke = window?.__TAURI_INTERNALS__?.invoke;
      if (typeof tauriInvoke === 'function') {
        void tauriInvoke('open_research_docs_window').catch((err) => {
          console.warn('[DocsWindow] Failed to open native Tauri Research Docs window:', err);
        });
        return;
      }
      if (docsPopupRef && !docsPopupRef.closed) {
        docsPopupRef.focus();
        return;
      }
      const docsUrl = resolveBundledAssetUrl('docs.html');
      const popup = window.open(
        docsUrl,
        'stratos-research-docs',
        'popup=yes,width=1100,height=820,resizable=yes,scrollbars=yes,menubar=no,toolbar=no,location=no,status=no'
      );
      if (popup) {
        docsPopupRef = popup;
        popup.focus();
      } else {
        actions.setTerrainToolStatus(
          'Pop-up window blocked by browser — allow pop-ups for this site to open Research Docs in a separate window.'
        );
      }
    };
    actions.openResearchDocsWindow = openResearchDocsWindow;

    byId('btn-open-docs-window')?.addEventListener('click', openResearchDocsWindow);
    document.querySelectorAll('[data-open-docs-window]').forEach((btn) => {
      btn.addEventListener('click', openResearchDocsWindow);
    });

    byId('btn-doc-subview-diag')?.addEventListener('click', () =>
      (window as any).switchDocSubview?.('diag')
    );
    byId('btn-doc-subview-ref')?.addEventListener('click', () =>
      (window as any).switchDocSubview?.('ref')
    );
    byId('btn-diag-json-expand')?.addEventListener('click', () =>
      (window as any).toggleDiagJsonExpand?.()
    );
    byId('btn-syshealth-export-rec')?.addEventListener('click', () => {
      const ioCtrl = actions.getMissionIoController();
      const json = ioCtrl.exportFlightRecording();
      ioCtrl.triggerDownload(json, `xband-flight-${Date.now()}.stratos.json`, 'application/json');
    });
    actions.syncTelemetrySubscriptionProfile(
      document.querySelector('.tab-content.active')?.id || 'tab-overview'
    );
    actions.getSystemHealthHud().update({
      frame: state.latestTelemetry,
      rollingStepSamples: state.rollingWorkerStepSamples,
      rollingInterFrameDeltas: state.rollingWorkerInterFrameDeltas,
      recordedEventsCount: flightRecorder.getEventCount(),
    });

    byId('btn-author-tab-traj')?.addEventListener('click', () =>
      (window as any).switchAuthoringPane?.('traj')
    );
    byId('btn-author-tab-tdma')?.addEventListener('click', () =>
      (window as any).switchAuthoringPane?.('tdma')
    );
    byId('btn-author-tab-obs')?.addEventListener('click', () =>
      (window as any).switchAuthoringPane?.('obs')
    );

    byId('constellation-acn-count')?.addEventListener('change', (e: any) =>
      (window as any).onConstellationConfigChange?.(
        'acnConstellationCount',
        parseInt(e.currentTarget.value, 10)
      )
    );
    byId('wind-speed-input')?.addEventListener('change', (e: any) =>
      (window as any).onConstellationConfigChange?.('windSpeedMs', parseFloat(e.currentTarget.value))
    );
    byId('toggle-manet-routing')?.addEventListener('change', (e: any) =>
      (window as any).onConstellationConfigChange?.('enableMultiHopManet', e.currentTarget.checked)
    );
    byId('toggle-ground-convoy')?.addEventListener('change', (e: any) =>
      (window as any).onConstellationConfigChange?.(
        'enableGroundConvoyMobility',
        e.currentTarget.checked
      )
    );
    byId('toggle-auto-cfit')?.addEventListener('change', (e: any) =>
      (window as any).onConstellationConfigChange?.('enableAutoCfitPullUp', e.currentTarget.checked)
    );

    byId('btn-upload-modal-close')?.addEventListener('click', () =>
      (window as any).closeUploadModal?.()
    );
    const dropzone = byId('dropzone');
    dropzone?.addEventListener('dragover', (e: any) => (window as any).onDragOver?.(e));
    dropzone?.addEventListener('dragleave', (e: any) => (window as any).onDragLeave?.(e));
    dropzone?.addEventListener('drop', (e: any) => (window as any).onDropFile?.(e));
    byId('terrainFileInput')?.addEventListener('change', (e: any) => {
      const file = e.currentTarget.files?.[0];
      e.currentTarget.value = '';
      if (file) (window as any).onFileSelected?.(file);
    });
    byId('terrainFolderInput')?.addEventListener('change', (e: any) => {
      const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : [];
      e.currentTarget.value = '';
      if (files.length > 0) (window as any).onFolderSelected?.(files);
    });
    byId('btn-browse-terrain-file')?.addEventListener('click', () =>
      byId('terrainFileInput')?.click()
    );
    byId('btn-browse-terrain-folder')?.addEventListener('click', () =>
      byId('terrainFolderInput')?.click()
    );
    byId('btn-cancel-hgt-load')?.addEventListener('click', () =>
      (window as any).cancelHgtLoad?.()
    );
    byId('btn-unload-custom-dem')?.addEventListener('click', () =>
      (window as any).unloadCustomTerrain?.()
    );
    byId('btn-clear-offline-packs')?.addEventListener('click', async () => {
      await offlinePackStore.clearAll();
      const tauriList = actions.invokeTauriOfflineIpc('list_offline_tiles');
      if (tauriList) {
        try {
          const items = await tauriList;
          if (Array.isArray(items)) {
            for (const it of items) {
              if (it?.name) {
                await actions.invokeTauriOfflineIpc('delete_offline_tile', { name: it.name })?.catch?.(
                  () => {}
                );
              }
            }
          }
        } catch {
          // Safe ignore outside Tauri
        }
      }
      await actions.refreshOfflinePackList();
    });
  }

  Object.assign(actions, {
    isDiagnosticsPanelVisible,
    isNeutralMapSelectionMode,
    dismissNodeInspector,
    disarmDestructiveButton,
    disarmAllDestructiveConfirmations,
    armDestructiveConfirm,
    syncFloatingOverlayLayout,
    syncEditModeBanner,
    syncRadarHudMode,
    getContextualMapContext,
    syncMapLegendVisibility,
    syncRfQuickToggleButtons,
    applyThreeLayerVisibility,
    applyMapLayersToAllRenderers,
    restoreFlightParamsFromCommitted,
    updateSpatialLockControl,
    setTrajectoryMessage,
    updateAltitudeModeUI,
    syncTrajectoryEditorFromWorker,
    setTrajectoryDraftMode,
    refreshTrajectoryEditor,
    addWaypointAt,
    applyTrajectoryDraft,
    cancelTrajectoryDraft,
    editEllipseFromInputs,
    editSelectedWaypointFromInputs,
    renderFlightPlanVerticalProfile,
    getObstacleEndpoints,
    renderObstacleInventoryList,
    applyObstacleHistoryChange,
    recomputeCadObstacleAnalysis,
    refreshObstacleEditor,
    editSelectedObstacleFromInputs,
    createObstacleAt,
    applyObstacleDraft,
    cancelObstacleDraft,
    activateObstacleMode,
    setTdmaMessage,
    updateTdmaLivePreview,
    syncInputsFromDraft,
    syncTdmaEditorFromWorker,
    validateTdmaDraft,
    handleTdmaCommandResult,
    applyTdmaDraft,
    resetTdmaToStandard,
    setRadarRange,
    updateHiFiPhysicsUI,
    updateBiomePhysicsUI,
    syncSelectedNodeAglUI,
    handleAglCommandResult,
    handleNodeCommandResult,
    initNodeInventoryToolbar,
    openNodeEditModal,
    closeNodeEditModal,
    syncMapNodeDragVisibility,
    syncNodeDropdowns,
    resizeCanvases,
    scheduleResizeCanvases,
  });

  let selectPriorityBound = false;
  function flushDeferredSelectSync(sel: HTMLSelectElement): void {
    if (!state.latestTelemetry) return;
    const nodes = state.latestTelemetry.nodes_telemetry;
    const id = sel.id;
    if (
      id === 'quickNodeSelect' ||
      id === 'termNodeSelect' ||
      id === 'vsa-node-select' ||
      id === 'eud-node-select' ||
      id === 'ops-fleet-team-filter'
    ) {
      if (nodes) actions.populateDropdownsOnce(nodes);
      if (
        state.selectedNodeId >= 0 &&
        (id === 'quickNodeSelect' ||
          id === 'termNodeSelect' ||
          id === 'vsa-node-select' ||
          id === 'eud-node-select')
      ) {
        syncNodeDropdowns(state.selectedNodeId);
      }
    } else if (id === 'ntn-node-select') {
      actions.renderNtnSignalingAnalyzer(state.latestTelemetry);
    } else if (id === 'traffic-node-select') {
      actions.renderNetworkTrafficInventory(state.latestTelemetry);
    } else if (id === 'network-node-select') {
      if (nodes) actions.updateNetworkNodeOptions(nodes);
    } else if (id === 'tb-obs-target-node-select') {
      actions.getDashboardAndAuthoringController().recomputeCadObstacleAnalysis();
    } else {
      actions.updateDashboardDOM(state.latestTelemetry, true);
    }
  }

  function initSelectInteractionPriorityGuards(): void {
    if (selectPriorityBound || typeof document === 'undefined') return;
    selectPriorityBound = true;

    const markSelectActive = (sel: HTMLSelectElement): void => {
      if (state.activeSelectElement && state.activeSelectElement !== sel) {
        delete state.activeSelectElement.dataset.selectInteracting;
      }
      sel.dataset.selectInteracting = 'true';
      state.activeSelectElement = sel;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      state.selectInteractionUntilMs = now + 250;
    };

    const clearSelectActive = (sel: HTMLSelectElement): void => {
      delete sel.dataset.selectInteracting;
      if (state.activeSelectElement === sel) state.activeSelectElement = null;
      state.selectInteractionUntilMs = 0;
      if (sel.dataset.pendingOptSync === '1') {
        delete sel.dataset.pendingOptSync;
        queueMicrotask(() => flushDeferredSelectSync(sel));
      }
      actions.markUiDirtyAndWake?.();
    };

    document.addEventListener(
      'pointerdown',
      (e: Event) => {
        const sel = (e.target as HTMLElement | null)?.closest?.('select') as HTMLSelectElement | null;
        if (sel) {
          markSelectActive(sel);
        } else if (state.activeSelectElement && document.activeElement !== state.activeSelectElement) {
          delete state.activeSelectElement.dataset.selectInteracting;
          state.activeSelectElement = null;
          state.selectInteractionUntilMs = 0;
        }
      },
      true
    );

    document.addEventListener(
      'focusin',
      (e: Event) => {
        const sel = (e.target as HTMLElement | null)?.closest?.('select') as HTMLSelectElement | null;
        if (sel) markSelectActive(sel);
      },
      true
    );

    document.addEventListener(
      'change',
      (e: Event) => {
        const sel = (e.target as HTMLElement | null)?.closest?.('select') as HTMLSelectElement | null;
        if (sel) clearSelectActive(sel);
      },
      true
    );

    document.addEventListener(
      'blur',
      (e: Event) => {
        const sel = (e.target as HTMLElement | null)?.closest?.('select') as HTMLSelectElement | null;
        if (sel) clearSelectActive(sel);
      },
      true
    );
  }

  function finalizeDomSetup() {
    const radarContainer = $('radar-container');
    state.mapLayersPanel = radarContainer
      ? new MapLayersPanel({
          container: radarContainer,
          registry: mapLayerRegistry,
          onChanged: applyMapLayersToAllRenderers,
          onOpenChange: (open: boolean) => {
            if (open) (window as any).setTerrainToolboxExpanded?.(false);
            syncFloatingOverlayLayout();
          },
        })
      : null;
    syncMapLegendVisibility();
    syncRfQuickToggleButtons();

    initSelectInteractionPriorityGuards();
    bindUxAndOverlayListeners();
    refreshTrajectoryEditor();
    refreshObstacleEditor();
    syncInputsFromDraft();
    updateTdmaLivePreview();
    initPlaybackSpeedControls();
    initNodeInventoryToolbar();
    syncTabWithLocationHash();
    bindExtractedDomListeners();
    actions.syncZoomHudReadout?.();
  }

  return { finalizeDomSetup };
}
