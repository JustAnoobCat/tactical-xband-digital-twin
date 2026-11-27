// 2D Radar renderer integration, MapLibre kinetic overlay, hillshade/cursor readout & pointer interactions
import type { AppContext } from './appContext.ts';
import { MIN_RADAR_RANGE_M } from './appContext.ts';
import type { TerrainBoundsLike } from './windowBindings.d.ts';
import type { NodeTelemetryItem, TelemetryFrame } from '../shared/workerProtocol.ts';
import type { ObstacleShapeMode } from '../ui/terrainAnalysisController.ts';
import type { PlacedLabelBox } from '../ui/canvasLabelPlacer.ts';
import type { RadarNodeMarkerLayer } from '../ui/radarNodeMarkerLayer.ts';
import { cartesianToGeodetic } from '../core/geodesy.ts';
import { obstacleContainsPoint } from '../core/obstacles.ts';
import { resolveSpatialCanvasTarget } from '../ui/obstacleEditorState.ts';
import { snapPointToAngleIncrement } from '../core/geodeticRulerEngine.ts';
import { evaluateCursorRfProbe } from '../core/cursorProbeEngine.ts';
import { constrainSquareRegion } from '../core/aoSwathScannerEngine.ts';
import { snapBarrierAngle } from '../core/cadObstacleSlicerEngine.ts';
import { OBSTACLE_PRESETS } from '../ui/terrainAnalysisController.ts';
import { drawAircraftChevron } from '../ui/pathProfileTopView.ts';
import { processHillshadeImageData } from '../ui/terrainMapRenderer.ts';
import { computeRadarCursorReadout, renderCursorHudHtml } from '../ui/radarCursorReadout.ts';
import { HIGHLAND_THEME } from '../ui/workbench/chartTheme.ts';
import { sampleDemSafe } from '../ui/terrainToolboxAnalysis.ts';
import { geodeticToMgrs } from '../core/militaryGisEngine.ts';
import { createLabelPlacer } from '../ui/canvasLabelPlacer.ts';
import {
  createRadar2dRenderer,
  renderPrecisionCadObstacleOverlay as renderCadObstacleOverlay,
  renderGeodeticRulerOverlay as renderRulerOverlay,
  renderPrecisionCursorProbeOverlay as renderProbeOverlay,
  renderPrecisionAoSwathOverlay as renderAoSwathOverlay,
} from '../ui/controllers/radar2dRenderer.ts';
import {
  WorldTileLayer,
  DEFAULT_WORLD_RADAR_DEM_TILE_URL,
  getAirGapOfflineOnly,
} from '../ui/worldTileLayer.ts';
import { createRadarNodeMarkerLayer } from '../ui/radarNodeMarkerLayer.ts';
import { computeBarrierWallRotationDeg } from '../ui/toolboxPrecisionSuite.ts';
import { computeWebMercatorZoomLevel } from '../ui/cartographyRenderer.ts';

export { computeWebMercatorZoomLevel };

export interface MapNodePopoverPolicyInput {
  readonly hasSelection: boolean;
  readonly dismissed: boolean;
  readonly spatialLocked: boolean;
  readonly isDragging: boolean;
  readonly lockedOnlyMode?: boolean;
}

/**
 * Pure popover visibility policy: never blocks active dragging, and optionally
 * restricts floating entity popovers strictly to Scenario Locked mode.
 */
export function shouldShowMapNodePopover(opts: MapNodePopoverPolicyInput): boolean {
  if (!opts.hasSelection || opts.dismissed || opts.isDragging) return false;
  if (opts.lockedOnlyMode) return Boolean(opts.spatialLocked);
  return true;
}

export function initRadar2dAndInteractionController(ctx: AppContext) {
  const { state, engines, canvases, dom, actions } = ctx;
  const { $, setText, MONO, mapField, mapEscape, nodeLinkLabel, nodeAchievedRate } = dom;
  const {
    mainTerrainEngine,
    trajectoryEditor,
    obstacleEditor,
    mapLayerRegistry,
    historyController,
  } = engines;
  const { radarCanvas, radarCtx } = canvases;

  let radarWorldTileLayer: WorldTileLayer | null = null;
  function getRadarWorldTileLayer(): WorldTileLayer {
    if (!radarWorldTileLayer) {
      const customDem = window.__xbandRadarDemTileUrl || DEFAULT_WORLD_RADAR_DEM_TILE_URL;
      radarWorldTileLayer = new WorldTileLayer({
        tileUrlTemplate: customDem,
        renderMode: 'radar-terrarium',
        airGapOfflineOnly: getAirGapOfflineOnly(),
      });
    }
    return radarWorldTileLayer;
  }

  let radarNodeMarkerLayer: RadarNodeMarkerLayer | null = null;
  function getRadarNodeMarkerLayer(): RadarNodeMarkerLayer | null {
    if (!radarNodeMarkerLayer) {
      const markerRoot = $('radar-node-markers');
      if (markerRoot) {
        radarNodeMarkerLayer = createRadarNodeMarkerLayer({ container: markerRoot });
      }
    }
    return radarNodeMarkerLayer;
  }

  let radar2dRendererInstance: ReturnType<typeof createRadar2dRenderer> | null = null;
  function getRadar2dRenderer(): ReturnType<typeof createRadar2dRenderer> {
    if (!radar2dRendererInstance) {
      radar2dRendererInstance = createRadar2dRenderer({
        canvas: radarCanvas,
        ctx: radarCtx,
        getRangeM: () => state.currentRadarRangeM,
        getPanOffset: () => ({ xM: state.panOffsetX_m, yM: state.panOffsetY_m }),
        getStageViewMode: () => state.stageViewMode,
        getTerrainMapMode: () => state.terrainMapMode,
        getTerrainMode: () => state.activeTerrainMode,
        getWorldTileLayer: () => getRadarWorldTileLayer(),
        getNodeMarkerLayer: () => getRadarNodeMarkerLayer(),
        getSweepTimeS: () => state.radarSweepPhaseS,
        projectEnuToScreen: (xM, yM) => state.mapController?.projectEnuToContainerPoint(xM, yM) ?? null,
        getLatestTelemetry: () => state.latestTelemetry,
        getHistoricalSnapshot: () =>
          state.simTimelineController && state.simTimelineController.isHistoricalInspecting
            ? state.simTimelineController.getActiveSpatialSnapshot()
            : null,
        getActiveTerrainBounds: () => state.activeTerrainBounds,
        getHillshadeCanvas: () => state.hillshadeCanvas,
        getBackdropCanvas: () => state.tbBackdropCanvas,
        getBackdropMode: () => state.tbBackdropMode,
        getMapLayerRegistry: () => mapLayerRegistry,
        getContextualMapContext: () => actions.getContextualMapContext(),
        getSelectedNodeId: () => state.selectedNodeId,
        getToolboxState: () => ({
          ...actions.getTerrainToolboxController().getState(),
          activeMode: state.tbActiveMode,
          toolMode: state.terrainToolMode,
          transectWaypoints: state.tbTransectWaypoints,
          transectResult: state.tbTransectResult,
          hoveredSampleIdx: state.tbHoveredSampleIdx,
          rubberBandPoint: state.tbRubberBandPoint,
          rulerMetrics: state.tbRulerMetrics,
          rulerEvaluation: state.tbRulerEvaluation,
          rulerPreviewMetrics: state.tbRulerPreviewMetrics,
          rulerPreviewEval: state.tbRulerPreviewEval,
          showRulerTicks: state.tbShowRulerTicks,
          activeSnap: state.tbActiveSnap,
          probeSite: state.tbProbeSite,
          cursorProbeLive: state.tbCursorProbeLive,
          probePinnedP1: state.tbProbePinnedP1,
          viewshedResult: state.tbViewshedResult,
          viewshedCanvas: state.tbViewshedCanvas,
          probeHeatmapConfig: state.tbProbeHeatmapConfig,
          cursorWorldPos: state.isMouseInsideRadar ? { xM: state.mouseWorldX, yM: state.mouseWorldY } : null,
          aoSwathBox: state.tbAoSwathBox,
          aoSwathReport: state.tbAoSwathReport,
          bridgeResult: state.tbBridgeResult,
          terrainRegions: state.terrainRegions,
          terrainRegionDraft: state.terrainRegionDraft,
          selectedRegionId: state.tbSelectedRegionId,
          obsDrawingAnchor: state.tbObsDrawingAnchor,
          obsRubberBandPoint: state.tbObsRubberBandPoint,
          obsSelectedId: state.tbObsSelectedId,
          cadObstacleReport:
            actions.getDashboardAndAuthoringController().getCadObstacleReport() ?? state.tbCadObstacleReport,
          obstacles: obstacleEditor?.draft || [],
        }),
        getObstacleEditor: () => obstacleEditor,
        isMgrsGridActive: () => actions.isMgrsGridActive(),
        onSelectNode: id => actions.handleNodeSelection(id),
        onDismissInspector: () => actions.dismissNodeInspector(),
        markDirty: () => {
          actions.markRadarDirty();
        },
        setRangeM: r => actions.setRadarRange(r),
        setPanOffset: (x, y) => {
          state.panOffsetX_m = x;
          state.panOffsetY_m = y;
        },
      });
    }
    return radar2dRendererInstance;
  }

  function drawLabelLeaderTick(ctx2d: CanvasRenderingContext2D, placed: PlacedLabelBox | null | undefined): void {
    if (!placed || !placed.displaced || placed.displacementPx <= 8) return;
    const edgeX = Math.max(placed.x, Math.min(placed.x + placed.width, placed.anchorX));
    const edgeY = Math.max(placed.y, Math.min(placed.y + placed.height, placed.anchorY));
    ctx2d.save();
    ctx2d.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx2d.lineWidth = 1;
    ctx2d.setLineDash([]);
    ctx2d.beginPath();
    ctx2d.moveTo(placed.anchorX, placed.anchorY);
    ctx2d.lineTo(edgeX, edgeY);
    ctx2d.stroke();
    ctx2d.restore();
  }

  function invalidateToolboxCache(): void {
    state.toolboxCacheVersion++;
    if (typeof window.__onToolboxCacheInvalidated === 'function') {
      window.__onToolboxCacheInvalidated();
    }
  }

  function syncObstacleFieldMirror(force = false): void {
    const committed = obstacleEditor.committed || [];
    const sig = committed.length === 0 ? '' : JSON.stringify(committed);
    if (!force && sig === state.lastMirroredObstacleJson && state.currentSpatialRevision === state.lastMirroredObstacleRev) {
      return;
    }
    if (sig !== state.lastMirroredObstacleJson) {
      mainTerrainEngine.obstacleField.replace(committed);
      state.lastMirroredObstacleJson = sig;
    }
    state.lastMirroredObstacleRev = state.currentSpatialRevision;
    invalidateToolboxCache();
  }

  let lastReadoutX = Number.NaN;
  let lastReadoutY = Number.NaN;
  let lastInsideRadar = false;
  function updateRadarCursorReadout(xM: number, yM: number, isInside: boolean): void {
    const hudEl = $('radar-cursor-hud');
    if (!hudEl) return;

    if (!isInside) {
      hudEl.classList.add('is-idle');
      if (!lastInsideRadar) return;
      lastInsideRadar = false;
      hudEl.innerHTML = renderCursorHudHtml(computeRadarCursorReadout({ xM: 0, yM: 0, isInsideRadar: false }));
      hudEl.title = 'Move pointer over radar map to inspect coordinates';
      return;
    }

    hudEl.classList.remove('is-idle');

    if (lastInsideRadar && Math.abs(xM - lastReadoutX) < 1 && Math.abs(yM - lastReadoutY) < 1) {
      return;
    }

    lastReadoutX = xM;
    lastReadoutY = yM;
    lastInsideRadar = true;

    const readout = computeRadarCursorReadout({
      xM,
      yM,
      isInsideRadar: true,
      terrainMode: state.activeTerrainMode,
      getElevation: (x, y) => {
        if (state.activeTerrainMode === 'real') {
          return mainTerrainEngine.getDemElevation(x, y);
        }
        return mainTerrainEngine.getElevation(x, y);
      },
      isWithinCoverage: (x, y) => mainTerrainEngine.isWithinDemCoverage(x, y),
    });

    const baseHtml = renderCursorHudHtml(readout);
    let mgrsHtml = '';
    let mgrsTooltip = '';
    try {
      const mgrs = geodeticToMgrs(readout.latDeg, readout.lonDeg, 5);
      mgrsHtml = ` <span style="color:var(--hi-line-strong, #2e3440);user-select:none;">|</span> <span style="display:inline-flex;align-items:center;gap:4px;"><span style="color:${HIGHLAND_THEME.text.muted};font-size:10px;">MGRS:</span><strong style="color:#38bdf8;font-size:10px;font-family:ui-monospace, monospace;">${mgrs}</strong></span>`;
      mgrsTooltip = `\nMGRS: ${mgrs}`;
    } catch (_) {}

    hudEl.innerHTML = baseHtml + mgrsHtml;
    hudEl.title = readout.tooltipText + mgrsTooltip;
  }

  function renderNodeHoverTooltip(
    nodeId: number | null,
    point: { x: number; y: number } | null,
    kind: 'node' | 'link' = 'node'
  ): void {
    const tooltip = $('map-node-tooltip');
    const node = state.latestTelemetry?.nodes_telemetry?.find(item => item.node_id === nodeId);
    if (!tooltip || !node || !point) {
      if (tooltip) tooltip.style.display = 'none';
      return;
    }
    const name = node.name || `Node ${node.node_id}`;
    const latLon =
      typeof node.lat_deg === 'number' &&
      Number.isFinite(node.lat_deg) &&
      typeof node.lon_deg === 'number' &&
      Number.isFinite(node.lon_deg)
        ? `${node.lat_deg.toFixed(5)}°, ${node.lon_deg.toFixed(5)}°`
        : 'Unavailable';
    const queue =
      typeof node.total_backlog_bytes === 'number' && Number.isFinite(node.total_backlog_bytes)
        ? `${(node.total_backlog_bytes / 1024).toFixed(1)} KB queued`
        : 'Unavailable';
    const link = nodeLinkLabel(node);
    const teamTag = node.team_name ? ` [${node.team_name}]` : '';
    const title =
      kind === 'link'
        ? `ACN → ${name}${teamTag} · Communication link`
        : `${name}${teamTag} · Node ${node.node_id}`;
    const regState = (node as NodeTelemetryItem & { registration_state?: string }).registration_state;
    tooltip.innerHTML = `<div class="tip-title">${mapEscape(title)}</div><div class="tip-row">${kind === 'node' ? `Position <b>${mapEscape(latLon)}</b> · AGL <b>${mapEscape(mapField(node.agl_m, 1, ' m'))}</b>` : `State <b>${mapEscape(link)}</b> · SNR <b>${mapEscape(mapField(node.snr_db, 1, ' dB'))}</b>`}</div><div class="tip-row">Registration <b>${mapEscape(regState || 'Unavailable')}</b> · RF <b>${mapEscape(link)}</b></div><div class="tip-row">SNR <b>${mapEscape(mapField(node.snr_db, 1, ' dB'))}</b> · Achieved rate <b>${mapEscape(nodeAchievedRate(node))}</b></div><div class="tip-row">Queue <b>${mapEscape(queue)}</b>${typeof node.battery_level_pct === 'number' && Number.isFinite(node.battery_level_pct) ? ` · Battery <b>${mapEscape(mapField(node.battery_level_pct, 1, '%'))}</b>` : ''}</div>`;
    tooltip.style.display = 'block';
    const parent = $('radar-container');
    if (!parent) return;
    const bounds = parent.getBoundingClientRect();
    let left = point.x + 18;
    if (left + tooltip.offsetWidth > bounds.width - 8) left = point.x - tooltip.offsetWidth - 18;
    left = Math.max(8, Math.min(bounds.width - tooltip.offsetWidth - 8, left));
    let top = point.y - tooltip.offsetHeight - 16;
    if (top < 8) top = point.y + 18;
    top = Math.max(8, Math.min(bounds.height - tooltip.offsetHeight - 8, top));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function setSharedMapHover(
    renderer: string | null,
    kind: 'node' | 'link',
    nodeId: number | null,
    point: { x: number; y: number } | null
  ): void {
    const nextNodeId = kind === 'node' ? nodeId : null;
    const nextLinkId = kind === 'link' ? nodeId : null;
    const changed =
      state.activeMapHoverRenderer !== renderer ||
      state.hoveredNodeId !== nextNodeId ||
      state.hoveredLinkNodeId !== nextLinkId;
    state.activeMapHoverRenderer = renderer;
    state.hoveredNodeId = nextNodeId;
    state.hoveredLinkNodeId = nextLinkId;
    state.mapHoverPoint = point;
    renderNodeHoverTooltip(nodeId, point, kind);
    if (changed) {
      if (renderer === 'radar') drawRadar();
      else actions.updateMapLibreOverlay();
    }
  }

  function renderHillshadeFromWorker(
    data: readonly (readonly number[])[] | number[][],
    _size: number,
    boundsKm: number,
    terrainMode?: string,
    bounds?: TerrainBoundsLike | null
  ): void {
    if (!data || !data.length) return;
    const numRows = data.length;
    const numCols = data[0].length;
    const hCanvas = document.createElement('canvas');
    hCanvas.width = numCols;
    hCanvas.height = numRows;
    const hCtx = hCanvas.getContext('2d');
    if (!hCtx) return;
    const img = hCtx.createImageData(numCols, numRows);

    processHillshadeImageData(data as number[][], img.data);

    hCtx.putImageData(img, 0, 0);
    state.hillshadeCanvas = hCanvas;

    if (bounds && typeof bounds === 'object') {
      state.activeTerrainBounds = bounds;
    }
    if (boundsKm) {
      state.THEATER_RADIUS_M = boundsKm * 1000;
    }
    if (terrainMode === 'real' || terrainMode === 'synthetic') {
      state.activeTerrainMode = terrainMode;
      const btnReal = $('btnRealTerrain');
      const btnSynth = $('btnSynthTerrain');
      if (btnReal) btnReal.classList.toggle('active', state.activeTerrainMode === 'real');
      if (btnSynth) btnSynth.classList.toggle('active', state.activeTerrainMode === 'synthetic');
    }
    invalidateToolboxCache();
  }

  function getRadarGeometry(w: number, h: number): { centerX: number; centerY: number; scale: number } {
    const centerX = w / 2,
      centerY = h / 2;
    const scale = (Math.min(centerX, centerY) * 0.94) / state.currentRadarRangeM;
    return { centerX, centerY, scale };
  }
  function worldToScreen(x: number, y: number, w: number, h: number): { x: number; y: number } {
    const g = getRadarGeometry(w, h);
    return {
      x: g.centerX + (x - state.panOffsetX_m) * g.scale,
      y: g.centerY - (y - state.panOffsetY_m) * g.scale,
    };
  }
  function screenToWorld(px: number, py: number, w: number, h: number): { x: number; y: number } {
    const g = getRadarGeometry(w, h);
    return {
      x: (px - g.centerX) / g.scale + state.panOffsetX_m,
      y: (g.centerY - py) / g.scale + state.panOffsetY_m,
    };
  }

  function renderMapLibreKineticOverlay(ctx2d: CanvasRenderingContext2D, w: number, h: number, frame: TelemetryFrame): void {
    ctx2d.clearRect(0, 0, w, h);
    if (!frame || !state.mapController) return;

    state.activeRadarLabelPlacer = createLabelPlacer(w, h, 4, 3);
    state.activeRadarLabelPlacer.reserveRect(0, 0, 48, h);
    state.activeRadarLabelPlacer.reserveRect(Math.max(0, w - 122), Math.max(0, h - 42), 114, 34);
    state.activeRadarLabelPlacer.reserveRect(8, Math.max(0, h - 38), 256, 30);

    const acn = frame.acn_telemetry;
    const acnPosX = acn?.pos_x ?? 0;
    const acnPosY = acn?.pos_y ?? 0;
    const acnPt = state.mapController.projectEnuToContainerPoint(acnPosX, acnPosY);
    if (!acnPt) return;

    const now = performance.now();
    const headingDeg: number =
      typeof frame.acn_heading_deg === 'number' && Number.isFinite(frame.acn_heading_deg)
        ? frame.acn_heading_deg
        : acn && typeof acn.heading_rad === 'number' && Number.isFinite(acn.heading_rad)
          ? (acn.heading_rad * 180.0) / Math.PI
          : 0;

    const advisor = frame.relay_advisor;
    const isRelayActive = Boolean(frame.active_relay_enabled);
    const relayPt =
      advisor && Array.isArray(advisor.optimalPosEnu) && advisor.optimalPosEnu.length >= 2
        ? state.mapController.projectEnuToContainerPoint(advisor.optimalPosEnu[0], advisor.optimalPosEnu[1])
        : null;

    // 1. Rotating Radar Sweep Line around ACN (60 FPS)
    ctx2d.save();
    const sweepAngle = (now * 0.002) % (Math.PI * 2);
    const sweepRadius = 150;
    const sweepEnd = {
      x: acnPt.x + Math.cos(sweepAngle) * sweepRadius,
      y: acnPt.y + Math.sin(sweepAngle) * sweepRadius,
    };
    const sweepGrad = ctx2d.createRadialGradient(acnPt.x, acnPt.y, 0, acnPt.x, acnPt.y, sweepRadius);
    sweepGrad.addColorStop(0, 'rgba(0, 229, 255, 0.35)');
    sweepGrad.addColorStop(0.8, 'rgba(0, 229, 255, 0.10)');
    sweepGrad.addColorStop(1, 'rgba(0, 229, 255, 0)');

    ctx2d.beginPath();
    ctx2d.moveTo(acnPt.x, acnPt.y);
    ctx2d.arc(acnPt.x, acnPt.y, sweepRadius, sweepAngle - 0.35, sweepAngle);
    ctx2d.closePath();
    ctx2d.fillStyle = sweepGrad;
    ctx2d.fill();

    ctx2d.beginPath();
    ctx2d.moveTo(acnPt.x, acnPt.y);
    ctx2d.lineTo(sweepEnd.x, sweepEnd.y);
    ctx2d.strokeStyle = '#00e5ff';
    ctx2d.lineWidth = 1.5;
    ctx2d.stroke();
    ctx2d.restore();

    // 2. Rotating 4-Sector Lobes (S0..S3) centered at ACN
    ctx2d.save();
    const rayLen = 90;
    const crossoverAngles = [45, 135, 225, 315];
    ctx2d.strokeStyle = 'rgba(255, 171, 0, 0.35)';
    ctx2d.lineWidth = 1;
    ctx2d.setLineDash([3, 3]);
    for (const offset of crossoverAngles) {
      const worldAngle = (headingDeg + offset) % 360;
      const rad = ((worldAngle - 90) * Math.PI) / 180;
      ctx2d.beginPath();
      ctx2d.moveTo(acnPt.x, acnPt.y);
      ctx2d.lineTo(acnPt.x + Math.cos(rad) * rayLen, acnPt.y + Math.sin(rad) * rayLen);
      ctx2d.stroke();
    }
    ctx2d.setLineDash([]);

    const sectors = [
      { id: 'S0', offset: 0, label: 'S0', color: '#00e5ff' },
      { id: 'S1', offset: 90, label: 'S1', color: '#00e676' },
      { id: 'S2', offset: 180, label: 'S2', color: '#ffab00' },
      { id: 'S3', offset: 270, label: 'S3', color: '#b388ff' },
    ];
    ctx2d.font = `600 10px ${MONO}`;
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    for (const sec of sectors) {
      const worldAngle = (headingDeg + sec.offset) % 360;
      const rad = ((worldAngle - 90) * Math.PI) / 180;
      ctx2d.strokeStyle = sec.color;
      ctx2d.lineWidth = 1.8;
      ctx2d.beginPath();
      ctx2d.moveTo(acnPt.x + Math.cos(rad) * 40, acnPt.y + Math.sin(rad) * 40);
      ctx2d.lineTo(acnPt.x + Math.cos(rad) * 58, acnPt.y + Math.sin(rad) * 58);
      ctx2d.stroke();

      const lx = acnPt.x + Math.cos(rad) * 72;
      const ly = acnPt.y + Math.sin(rad) * 72;
      ctx2d.fillStyle = sec.color;
      ctx2d.fillText(sec.label, lx, ly);
    }
    ctx2d.restore();

    drawAircraftChevron(ctx2d, acnPt.x, acnPt.y, headingDeg);

    // 3. Project Nodes & Draw Scheduler-Synchronized Animated Packet Flow Pulses
    const nodes = frame.nodes_telemetry || [];
    const schedMode = frame.scheduler_mode || 'tac_tad';
    const isStaticSched = schedMode === 'static';
    const legacyFrame = frame as TelemetryFrame & {
      static_gantt?: TelemetryFrame['static_gantt_allocations'];
      tac_gantt?: TelemetryFrame['tac_gantt_allocations'];
    };
    const activeGantt =
      (isStaticSched
        ? legacyFrame.static_gantt || frame.static_gantt_allocations
        : legacyFrame.tac_gantt || frame.tac_gantt_allocations) ||
      frame.active_gantt_allocations ||
      legacyFrame.tac_gantt ||
      legacyFrame.static_gantt ||
      [];

    const scheduledAllocByNodeId = new Map();
    if (Array.isArray(activeGantt)) {
      for (const alloc of activeGantt) {
        const nid = alloc.node_id ?? alloc.nodeId;
        if (nid !== undefined && nid !== null) {
          scheduledAllocByNodeId.set(Number(nid), alloc);
        }
      }
    }

    ctx2d.save();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const nPt = state.mapController.projectEnuToContainerPoint(node.x_m, node.y_m);
      if (!nPt) continue;

      const alloc = scheduledAllocByNodeId.get(node.node_id);
      const isScheduled = Boolean(alloc);
      const isOutage = Boolean(
        node.link_outage || node.state_name === 'OUTAGE' || node.state_name === 'HARD_SHADOW_CUTOFF'
      );
      const isPreOcclusion = Boolean(
        node.registration_state === 'PRE_OCCLUSION_FLUSH' || alloc?.is_pre_occlusion_flush
      );
      const isRelayed = isRelayActive && Boolean(node.is_relayed) && Boolean(relayPt);

      let pulseColor = '#00e5ff'; // Default Cyan (5QI 65)
      if (isPreOcclusion) {
        pulseColor = '#b388ff'; // Violet
      } else if ((alloc && (alloc.c2_bytes ?? alloc.c2Bytes ?? 0) > 0) || (node.c2_bytes ?? node.c2_backlog ?? 0) > 0) {
        pulseColor = '#ff2a54'; // Crimson 5QI 69
      } else if (
        (alloc && (alloc.voice_bytes ?? alloc.voiceBytes ?? 0) > 0) ||
        (node.voice_bytes ?? node.voice_backlog ?? 0) > 0
      ) {
        pulseColor = '#00e5ff'; // Cyan 5QI 65
      } else if (
        (alloc && (alloc.video_bytes ?? alloc.videoBytes ?? 0) > 0) ||
        (node.video_bytes ?? node.video_backlog ?? 0) > 0
      ) {
        pulseColor = '#00e676'; // Emerald 5QI 67
      } else if (
        (alloc && (alloc.photo_bytes ?? alloc.photoBytes ?? 0) > 0) ||
        (node.photo_bytes ?? node.photo_backlog ?? 0) > 0
      ) {
        pulseColor = '#ffab00'; // Amber 5QI 70
      } else if (isRelayed) {
        pulseColor = '#00e676';
      }

      // Only animate uplink packet pulse trains on links where isScheduled && !isOutage
      if (isScheduled && !isOutage) {
        const t = (now * 0.0016 + i * 0.17) % 1.0;
        let px, py;
        if (isRelayed && relayPt) {
          if (t < 0.5) {
            const segT = t * 2.0;
            px = nPt.x + (relayPt.x - nPt.x) * segT;
            py = nPt.y + (relayPt.y - nPt.y) * segT;
          } else {
            const segT = (t - 0.5) * 2.0;
            px = relayPt.x + (acnPt.x - relayPt.x) * segT;
            py = relayPt.y + (acnPt.y - relayPt.y) * segT;
          }
        } else {
          px = nPt.x + (acnPt.x - nPt.x) * t;
          py = nPt.y + (acnPt.y - nPt.y) * t;
        }

        ctx2d.beginPath();
        ctx2d.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx2d.fillStyle = pulseColor;
        ctx2d.shadowColor = pulseColor;
        ctx2d.shadowBlur = 8;
        ctx2d.fill();

        ctx2d.beginPath();
        ctx2d.arc(px, py, 2.0, 0, Math.PI * 2);
        ctx2d.fillStyle = '#ffffff';
        ctx2d.fill();
        ctx2d.shadowBlur = 0;

        const durationMs =
          alloc.duration_ms ?? alloc.durationMs ?? (typeof alloc.duration_s === 'number' ? alloc.duration_s * 1000 : 5);
        const modcod = alloc.modcod_name ?? alloc.modcodName ?? node.modcod_name ?? 'QPSK 1/2';
        const txBadgeText = isPreOcclusion ? 'FLUSHING [Φ_evac]' : `[TX] ${Math.round(durationMs)}ms · ${modcod}`;

        ctx2d.save();
        ctx2d.font = `700 9.5px ${MONO}`;
        ctx2d.textAlign = 'left';
        ctx2d.textBaseline = 'middle';
        const textX = nPt.x + 12;
        const textY = nPt.y - 10;
        const metrics = ctx2d.measureText(txBadgeText);
        ctx2d.fillStyle = 'rgba(11, 15, 23, 0.85)';
        ctx2d.fillRect(textX - 2, textY - 6, metrics.width + 4, 12);
        ctx2d.strokeStyle = pulseColor;
        ctx2d.lineWidth = 1;
        ctx2d.strokeRect(textX - 2, textY - 6, metrics.width + 4, 12);
        ctx2d.fillStyle = pulseColor;
        ctx2d.fillText(txBadgeText, textX, textY);
        ctx2d.restore();
      }

      if (isStaticSched && isOutage && isScheduled) {
        const flashPeriod = (now % 600) < 300;
        if (flashPeriod) {
          ctx2d.save();
          ctx2d.strokeStyle = '#ff2a54';
          ctx2d.lineWidth = 2.0;
          ctx2d.setLineDash([6, 4]);
          ctx2d.beginPath();
          ctx2d.moveTo(nPt.x, nPt.y);
          ctx2d.lineTo(acnPt.x, acnPt.y);
          ctx2d.stroke();
          ctx2d.setLineDash([]);

          const midX = (nPt.x + acnPt.x) * 0.5;
          const midY = (nPt.y + acnPt.y) * 0.5;
          const wastedText = '[WASTED TX]';
          ctx2d.font = `700 10px ${MONO}`;
          ctx2d.textAlign = 'center';
          ctx2d.textBaseline = 'middle';
          const wMet = ctx2d.measureText(wastedText);
          ctx2d.fillStyle = 'rgba(255, 42, 84, 0.9)';
          ctx2d.fillRect(midX - wMet.width * 0.5 - 4, midY - 7, wMet.width + 8, 14);
          ctx2d.strokeStyle = '#ffffff';
          ctx2d.lineWidth = 1.2;
          ctx2d.strokeRect(midX - wMet.width * 0.5 - 4, midY - 7, wMet.width + 8, 14);
          ctx2d.fillStyle = '#ffffff';
          ctx2d.fillText(wastedText, midX, midY);
          ctx2d.restore();
        }
      }

      if (state.selectedNodeId === node.node_id) {
        ctx2d.strokeStyle = '#00e5ff';
        ctx2d.lineWidth = 1.5;
        const bSize = 10;
        ctx2d.beginPath();
        ctx2d.moveTo(nPt.x - bSize, nPt.y - bSize + 4);
        ctx2d.lineTo(nPt.x - bSize, nPt.y - bSize);
        ctx2d.lineTo(nPt.x - bSize + 4, nPt.y - bSize);
        ctx2d.moveTo(nPt.x + bSize - 4, nPt.y - bSize);
        ctx2d.lineTo(nPt.x + bSize, nPt.y - bSize);
        ctx2d.lineTo(nPt.x + bSize, nPt.y - bSize + 4);
        ctx2d.moveTo(nPt.x + bSize, nPt.y + bSize - 4);
        ctx2d.lineTo(nPt.x + bSize, nPt.y + bSize);
        ctx2d.lineTo(nPt.x + bSize - 4, nPt.y + bSize);
        ctx2d.moveTo(nPt.x - bSize + 4, nPt.y + bSize);
        ctx2d.lineTo(nPt.x - bSize, nPt.y + bSize);
        ctx2d.lineTo(nPt.x - bSize, nPt.y + bSize - 4);
        ctx2d.stroke();
      }
    }
    ctx2d.restore();

    // 4. Pulsing EW Jammer Rings & Emitter
    if (frame.jammer_enabled) {
      const jPos = frame.jammer_pos_enu || [3200, -2800, 0];
      const jPt = state.mapController.projectEnuToContainerPoint(jPos[0], jPos[1]);
      if (jPt) {
        ctx2d.save();
        for (let rIdx = 0; rIdx < 3; rIdx++) {
          const ringProgress = (now * 0.04 + rIdx * 20) % 60;
          const ringAlpha = Math.max(0, 1.0 - ringProgress / 60);
          ctx2d.beginPath();
          ctx2d.arc(jPt.x, jPt.y, ringProgress, 0, Math.PI * 2);
          ctx2d.strokeStyle = `rgba(255, 42, 84, ${ringAlpha * 0.75})`;
          ctx2d.lineWidth = 1.5;
          ctx2d.stroke();
        }

        ctx2d.strokeStyle = 'rgba(255, 42, 84, 0.65)';
        ctx2d.lineWidth = 1.5;
        ctx2d.setLineDash([4, 4]);
        ctx2d.beginPath();
        ctx2d.moveTo(jPt.x, jPt.y);
        ctx2d.lineTo(acnPt.x, acnPt.y);
        ctx2d.stroke();
        ctx2d.setLineDash([]);

        const dSize = 7;
        ctx2d.fillStyle = '#ff2a54';
        ctx2d.strokeStyle = '#ffffff';
        ctx2d.lineWidth = 1.5;
        ctx2d.beginPath();
        ctx2d.moveTo(jPt.x, jPt.y - dSize);
        ctx2d.lineTo(jPt.x + dSize, jPt.y);
        ctx2d.lineTo(jPt.x, jPt.y + dSize);
        ctx2d.lineTo(jPt.x - dSize, jPt.y);
        ctx2d.closePath();
        ctx2d.fill();
        ctx2d.stroke();

        ctx2d.font = `700 10px ${MONO}`;
        ctx2d.fillStyle = '#ff2a54';
        ctx2d.textAlign = 'center';
        ctx2d.textBaseline = 'bottom';
        ctx2d.fillText('[EW-JAM]', jPt.x, jPt.y - dSize - 2);
        ctx2d.restore();
      }
    }

    // 5. Optimal Relay Mast Beacon [MCP-OPT]
    if (isRelayActive && relayPt) {
      ctx2d.save();
      ctx2d.fillStyle = '#00e5ff';
      ctx2d.strokeStyle = '#ffffff';
      ctx2d.lineWidth = 1.5;
      ctx2d.fillRect(relayPt.x - 5, relayPt.y - 5, 10, 10);
      ctx2d.strokeRect(relayPt.x - 5, relayPt.y - 5, 10, 10);

      ctx2d.strokeStyle = '#00e5ff';
      ctx2d.lineWidth = 2.0;
      ctx2d.setLineDash([5, 4]);
      ctx2d.beginPath();
      ctx2d.moveTo(relayPt.x, relayPt.y);
      ctx2d.lineTo(acnPt.x, acnPt.y);
      ctx2d.stroke();
      ctx2d.setLineDash([]);

      ctx2d.font = `700 10px ${MONO}`;
      ctx2d.fillStyle = '#00e5ff';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'bottom';
      ctx2d.fillText('[MCP-OPT]', relayPt.x, relayPt.y - 7);
      ctx2d.restore();
    }

    renderGeodeticRulerOverlay(ctx2d, w, h);
    renderPrecisionCursorProbeOverlay(ctx2d, w, h);
    renderPrecisionAoSwathOverlay(ctx2d, w, h);
    renderPrecisionCadObstacleOverlay(ctx2d, w, h);
  }

  function findCadObstacleHandleHit(px: number, py: number, _w: number, _h: number) {
    return getRadar2dRenderer().findCadObstacleHandleHit(px, py);
  }

  function buildOverlayVpAndProject(w: number, h: number) {
    const tbState = actions.getTerrainToolboxController().getState();
    const vp = {
      width: w,
      height: h,
      rangeM: state.currentRadarRangeM,
      panOffsetX_m: state.panOffsetX_m,
      panOffsetY_m: state.panOffsetY_m,
    };
    const projectFn = (xM: number, yM: number) => {
      if (
        state.terrainMapMode === 'maplibre' &&
        state.mapController &&
        typeof state.mapController.projectEnuToContainerPoint === 'function'
      ) {
        const pt = state.mapController.projectEnuToContainerPoint(xM, yM);
        if (pt) return pt;
      }
      return worldToScreen(xM, yM, w, h);
    };
    return { tbState, vp, projectFn };
  }

  function renderPrecisionCadObstacleOverlay(ctx2d: CanvasRenderingContext2D, w: number, h: number): void {
    const { tbState, vp, projectFn } = buildOverlayVpAndProject(w, h);
    renderCadObstacleOverlay(ctx2d, w, h, tbState, vp, projectFn);
  }

  function renderGeodeticRulerOverlay(ctx2d: CanvasRenderingContext2D, w: number, h: number): void {
    const { tbState, vp, projectFn } = buildOverlayVpAndProject(w, h);
    renderRulerOverlay(ctx2d, w, h, tbState, vp, projectFn);
  }

  function renderPrecisionCursorProbeOverlay(ctx2d: CanvasRenderingContext2D, w: number, h: number): void {
    const { tbState, vp, projectFn } = buildOverlayVpAndProject(w, h);
    renderProbeOverlay(ctx2d, w, h, tbState, vp, projectFn);
  }

  function findAoSwathCornerHit(px: number, py: number, _w: number, _h: number, thresholdPx = 14) {
    return getRadar2dRenderer().findAoSwathCornerHit(px, py, thresholdPx);
  }

  function renderPrecisionAoSwathOverlay(ctx2d: CanvasRenderingContext2D, w: number, h: number): void {
    const { tbState, vp, projectFn } = buildOverlayVpAndProject(w, h);
    renderAoSwathOverlay(ctx2d, w, h, tbState, vp, projectFn);
  }

  function drawRadar(): void {
    const cvs = radarCanvas;
    const stageViewMode = state.stageViewMode;
    if (stageViewMode === '3d') getRadarNodeMarkerLayer()?.hide();
    if (!cvs || stageViewMode === '3d') return;
    if (typeof document !== 'undefined' && document.hidden) {
      state.radarNeedsRender = true;
      return;
    }
    getRadar2dRenderer().renderRadar();
    actions.syncZoomHudReadout?.();
  }

  function radarLinkHit(px: number, py: number, _w: number, _h: number, radiusPx = 6): number | null {
    return getRadar2dRenderer().radarLinkHit(px, py, radiusPx);
  }

  radarCanvas.addEventListener('mousedown', (e: MouseEvent) => {
    const rect = radarCanvas.getBoundingClientRect();
    const px = e.clientX - rect.left,
      py = e.clientY - rect.top;
    const w = radarCanvas.parentElement?.clientWidth ?? rect.width,
      h = radarCanvas.parentElement?.clientHeight ?? rect.height;
    const simTimelineController = state.simTimelineController;
    if (e.button === 0) {
      const world = screenToWorld(px, py, w, h);
      if (state.terrainToolMode === 'obstacle-place' || state.tbActiveMode === 'obstacle') {
        const handleHit = findCadObstacleHandleHit(px, py, w, h);
        if (handleHit) {
          state.tbObsDraggedHandle = handleHit.handle;
          state.tbObsDragOrigin = { ...world };
          radarCanvas.style.cursor = 'grabbing';
          return;
        }
        const draft = obstacleEditor?.draft || [];
        const geometry = getRadarGeometry(w, h);
        const tolM = 16 / geometry.scale;
        const clickedObs = draft.find(o => obstacleContainsPoint(o, world.x, world.y, tolM));
        if (clickedObs) {
          state.tbObsSelectedId = clickedObs.id;
          obstacleEditor.select(clickedObs.id);
          actions.recomputeCadObstacleAnalysis();
          actions.renderObstacleInventoryList();
          drawRadar();
          return;
        }
        if (state.terrainToolMode === 'obstacle-place') {
          state.tbObsDrawingAnchor = { x: world.x, y: world.y };
          state.tbObsRubberBandPoint = { x: world.x, y: world.y };
          radarCanvas.style.cursor = 'crosshair';
          return;
        }
      }
      if (state.terrainToolMode !== 'idle') {
        if (state.terrainToolMode === 'region') {
          const cornerHit = findAoSwathCornerHit(px, py, w, h);
          if (cornerHit) {
            state.tbDraggedAoCorner = cornerHit;
            radarCanvas.style.cursor = cornerHit === 'NW' || cornerHit === 'SE' ? 'nwse-resize' : 'nesw-resize';
            return;
          }
        }
        const geo = mainTerrainEngine.worldToLatLon(world.x, world.y);
        actions.handleToolboxMapClick({ x: world.x, y: world.y, lng: geo.lonDeg, lat: geo.latDeg });
        return;
      }
      if (state.tbActiveMode === 'region') {
        const cornerHit = findAoSwathCornerHit(px, py, w, h);
        if (cornerHit) {
          state.tbDraggedAoCorner = cornerHit;
          radarCanvas.style.cursor = cornerHit === 'NW' || cornerHit === 'SE' ? 'nwse-resize' : 'nesw-resize';
          return;
        }
      }
      if (state.tbActiveMode === 'probe') {
        const geo = mainTerrainEngine.worldToLatLon(world.x, world.y);
        state.tbProbeSite = { xM: world.x, yM: world.y, lng: geo.lonDeg, lat: geo.latDeg };
        actions.recomputeProbeAnalysis();
        if (state.tbCursorProbeLive) {
          state.tbProbePinnedP1 = state.tbCursorProbeLive;
        }
        actions.setTerrainToolStatus(
          `Probe set & [P1] pinned at ${geo.latDeg.toFixed(4)}°, ${geo.lonDeg.toFixed(4)}°.`
        );
        actions.refreshTerrainToolbox();
        actions.updateMapLibreToolSources();
        drawRadar();
        return;
      }
      if (
        state.tbActiveMode === 'transect' &&
        state.tbTransectWaypoints.length > 0 &&
        mapLayerRegistry.getEffectiveVisibility('eng.measurements', actions.getContextualMapContext())
      ) {
        let bestIdx = -1;
        let bestPx = 12;
        state.tbTransectWaypoints.forEach((wp, idx) => {
          const sp = worldToScreen(wp.xM, wp.yM, w, h);
          const d = Math.hypot(px - sp.x, py - sp.y);
          if (d <= bestPx) {
            bestPx = d;
            bestIdx = idx;
          }
        });
        if (bestIdx >= 0) {
          state.draggedToolboxVertex = { index: bestIdx };
          radarCanvas.style.cursor = 'grabbing';
          return;
        }
      }
      if (state.equipmentPlacementArmed) {
        if (state.spatialLocked || (simTimelineController && simTimelineController.isHistoricalInspecting)) {
          radarCanvas.style.cursor = 'not-allowed';
          return;
        }
        const typeEl = $('equip-type-select') as HTMLSelectElement | null;
        const eirpEl = $('equip-eirp-input') as HTMLInputElement | null;
        const eqType = (typeEl?.value || 'barrage_jammer') as
          | 'barrage_jammer'
          | 'spot_jammer'
          | 'relay_mast'
          | 'esm_sensor';
        const rawEirp = eirpEl ? parseFloat(eirpEl.value) : 65;
        const eirpDbm = Number.isFinite(rawEirp) ? Math.max(10, Math.min(90, rawEirp)) : 65;
        actions.sendCommand({
          type: 'EQUIPMENT_ADD',
          equipment_type: eqType,
          x_m: world.x,
          y_m: world.y,
          eirp_dbm: eirpDbm,
        });
        state.equipmentPlacementArmed = false;
        const placeBtn = $('btn-equip-place-map');
        if (placeBtn) {
          placeBtn.classList.remove('active');
          placeBtn.setAttribute('aria-pressed', 'false');
          placeBtn.textContent = 'Place on Map';
        }
        setText(
          'equip-placement-status',
          `Deployed ${eqType.replace(/_/g, ' ')} at (${(world.x / 1000).toFixed(1)}, ${(world.y / 1000).toFixed(1)}) km.`
        );
        radarCanvas.style.cursor = 'crosshair';
        actions.syncRadarHudMode();
        drawRadar();
        return;
      }
      if ((window.tbOpen && state.tbActiveMode !== 'dem') || state.terrainToolMode !== 'idle') {
        return;
      }
      if (!state.spatialLocked && trajectoryEditor.activeMode === 'waypoints' && state.waypointPlacementArmed) {
        if (simTimelineController && simTimelineController.isHistoricalInspecting) {
          radarCanvas.style.cursor = 'not-allowed';
          return;
        }
        actions.addWaypointAt(world.x, world.y);
        $('trajectory-place-point')?.classList.remove('active');
        actions.syncRadarHudMode();
        return;
      }
      if (obstacleEditor.mode === 'place' && !state.spatialLocked) {
        if (simTimelineController && simTimelineController.isHistoricalInspecting) {
          radarCanvas.style.cursor = 'not-allowed';
          return;
        }
        actions.createObstacleAt(world.x, world.y);
        return;
      }
      const hitCtx = actions.getContextualMapContext();
      let nodeHit: { node_id: number; x_m?: number; y_m?: number; position?: readonly [number, number, number] } | null = null;
      let nodeHitDistance = Number.POSITIVE_INFINITY;
      if (mapLayerRegistry.getEffectiveVisibility('entities.groundNodes', hitCtx)) {
        const currentNodes: Array<{ node_id: number; x_m?: number; y_m?: number; position?: readonly [number, number, number] }> =
          simTimelineController && simTimelineController.isHistoricalInspecting
            ? simTimelineController.getActiveSpatialSnapshot()?.nodes.map(n => ({
                node_id: n.nodeId,
                x_m: n.posX,
                y_m: n.posY,
              })) || []
            : [...(state.latestTelemetry?.nodes_telemetry || [])];
        for (const node of currentNodes) {
          const nx = node.x_m !== undefined ? node.x_m : node.position ? node.position[0] : 0;
          const ny = node.y_m !== undefined ? node.y_m : node.position ? node.position[1] : 0;
          const p = worldToScreen(nx, ny, w, h);
          const distance = Math.hypot(px - p.x, py - p.y);
          if (distance < nodeHitDistance) {
            nodeHitDistance = distance;
            nodeHit = node;
          }
        }
      }
      let waypointHitIndex = -1,
        waypointHitDistance = Number.POSITIVE_INFINITY;
      if (
        mapLayerRegistry.getEffectiveVisibility('entities.trajectory', hitCtx) &&
        obstacleEditor.mode === 'navigate' &&
        !state.spatialLocked &&
        trajectoryEditor.activeMode === 'waypoints'
      ) {
        const draft = trajectoryEditor.preview;
        if (draft.mode === 'waypoints') {
          draft.points.forEach((point, index) => {
            const screen = worldToScreen(point.xM, point.yM, w, h);
            const distance = Math.hypot(px - screen.x, py - screen.y);
            if (distance < waypointHitDistance) {
              waypointHitDistance = distance;
              waypointHitIndex = index;
            }
          });
        }
      }
      let obstacleHitId = null,
        obstacleHitDistance = Number.POSITIVE_INFINITY;
      if (mapLayerRegistry.getEffectiveVisibility('entities.obstacles', hitCtx) && obstacleEditor.mode !== 'navigate') {
        const geometry = getRadarGeometry(w, h),
          toleranceM = 12 / geometry.scale;
        obstacleEditor.draft.forEach(obstacle => {
          if (!obstacleContainsPoint(obstacle, world.x, world.y, toleranceM)) return;
          const center = worldToScreen(obstacle.xM, obstacle.yM, w, h);
          const distance = Math.hypot(px - center.x, py - center.y);
          if (distance < obstacleHitDistance) {
            obstacleHitDistance = distance;
            obstacleHitId = obstacle.id;
          }
        });
      }
      const pointerTarget = resolveSpatialCanvasTarget(
        nodeHitDistance,
        waypointHitDistance,
        obstacleHitDistance,
        obstacleEditor.mode,
        trajectoryEditor.activeMode === 'waypoints' && !state.spatialLocked
      );
      if (
        pointerTarget === 'node' &&
        nodeHit &&
        obstacleEditor.mode === 'navigate' &&
        trajectoryEditor.activeMode !== 'waypoints'
      ) {
        if (simTimelineController && simTimelineController.isHistoricalInspecting) {
          state.draggedEntity = null;
          radarCanvas.style.cursor = 'not-allowed';
          setText(
            'map-node-action-status',
            'Interaction locked: Ground node editing is disabled during historical playback.'
          );
          console.warn('Interaction locked: Ground node editing is disabled during historical playback.');
          actions.handleNodeSelection(nodeHit.node_id);
          return;
        }
        if (historyController.isInspecting) {
          radarCanvas.style.cursor = 'not-allowed';
          return;
        }
        actions.handleNodeSelection(nodeHit.node_id);
        if (state.spatialLocked) {
          radarCanvas.style.cursor = 'pointer';
          return;
        }
        if ((obstacleEditor.mode as string) !== 'navigate' || (trajectoryEditor.activeMode as string) === 'waypoints') {
          radarCanvas.style.cursor = 'pointer';
          return;
        }
        state.draggedEntity = { type: 'node', id: nodeHit.node_id };
        actions.syncMapNodeDragVisibility?.(true);
        radarCanvas.style.cursor = 'grabbing';
        return;
      }
      if (pointerTarget === 'obstacle' && obstacleHitId) {
        if (simTimelineController && simTimelineController.isHistoricalInspecting) {
          state.draggedEntity = null;
          radarCanvas.style.cursor = 'not-allowed';
          console.warn('Interaction locked: Obstacle editing is disabled during historical playback.');
          return;
        }
        obstacleEditor.select(obstacleHitId);
        if (!state.spatialLocked && obstacleEditor.mode === 'select')
          state.draggedEntity = { type: 'obstacle', id: obstacleHitId };
        radarCanvas.style.cursor = state.spatialLocked ? 'pointer' : 'grabbing';
        actions.refreshObstacleEditor();
        return;
      }
      if (pointerTarget === 'waypoint' && waypointHitIndex >= 0) {
        if (simTimelineController && simTimelineController.isHistoricalInspecting) {
          state.draggedEntity = null;
          radarCanvas.style.cursor = 'not-allowed';
          console.warn('Interaction locked: Waypoint editing is disabled during historical playback.');
          return;
        }
        trajectoryEditor.selectWaypoint(waypointHitIndex);
        state.draggedEntity = { type: 'waypoint', id: waypointHitIndex };
        radarCanvas.style.cursor = 'grabbing';
        actions.refreshTrajectoryEditor();
        return;
      }
      if (obstacleEditor.mode === 'navigate' && trajectoryEditor.activeMode !== 'waypoints') {
        if (mapLayerRegistry.getEffectiveVisibility('entities.acn', hitCtx)) {
          const isHistAcn = Boolean(simTimelineController && simTimelineController.isHistoricalInspecting);
          const histAcnSnap = isHistAcn && simTimelineController ? simTimelineController.getActiveSpatialSnapshot() : null;
          const acnX = histAcnSnap ? histAcnSnap.acn.posX : state.latestTelemetry?.acn_telemetry?.pos_x;
          const acnY = histAcnSnap ? histAcnSnap.acn.posY : state.latestTelemetry?.acn_telemetry?.pos_y;
          if (typeof acnX === 'number' && Number.isFinite(acnX) && typeof acnY === 'number' && Number.isFinite(acnY)) {
            const acnScreen = worldToScreen(acnX, acnY, w, h);
            if (Math.hypot(px - acnScreen.x, py - acnScreen.y) <= 16) {
              actions.handleAcnSelection();
              drawRadar();
              return;
            }
          }
        }
        const linkNodeId = radarLinkHit(px, py, w, h);
        if (linkNodeId !== null) {
          actions.handleNodeSelection(linkNodeId);
          return;
        }
      }
    }
    state.isPanning = true;
    state.panStartX = e.clientX;
    state.panStartY = e.clientY;
    state.panOriginX = e.clientX;
    state.panOriginY = e.clientY;
    radarCanvas.style.cursor = 'move';
  });

  radarCanvas.addEventListener('dblclick', (e) => {
    if (state.terrainToolMode === 'transect-poly' && state.tbTransectWaypoints.length >= 2) {
      e.preventDefault();
      actions.finishTransectPolyline();
    } else if (state.terrainToolMode === 'region' && state.terrainRegionDraft.length >= 3) {
      e.preventDefault();
      actions.finishTerrainRegion();
    }
  });

  radarCanvas.addEventListener('mouseenter', () => {
    state.isMouseInsideRadar = true;
  });
  radarCanvas.addEventListener('mouseleave', () => {
    state.isMouseInsideRadar = false;
    if (state.activeMapHoverRenderer === 'radar') {
      state.hoveredNodeId = null;
      state.hoveredLinkNodeId = null;
      state.activeMapHoverRenderer = null;
      state.mapHoverPoint = null;
      const tip = $('map-node-tooltip');
      if (tip) tip.style.display = 'none';
    }
    updateRadarCursorReadout(0, 0, false);
    if (state.tbProbeSite && state.tbProbePinnedP1 && state.terrainToolMode === 'probe') {
      state.tbCursorProbeLive = state.tbProbePinnedP1;
      actions.updateProbeUiReadouts(state.tbProbePinnedP1);
    }
    if (state.tbActiveMode === 'probe' && state.tbProbeSite && state.tbViewshedResult) drawRadar();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
      state.isShiftKeyDown = true;
      if (state.terrainToolMode === 'transect-2pt' && state.tbTransectWaypoints.length === 1) {
        const wpA = state.tbTransectWaypoints[0];
        const [snapX, snapY] = snapPointToAngleIncrement(wpA.xM, wpA.yM, state.mouseWorldX, state.mouseWorldY, 15);
        const geo = mainTerrainEngine.worldToLatLon(snapX, snapY);
        state.tbRubberBandPoint = { x: snapX, y: snapY, lng: geo.lonDeg, lat: geo.latDeg, isAngleSnapped: true };
        state.tbActiveSnap = null;
        actions.recomputeRubberBandPreview(state.tbRubberBandPoint);
        drawRadar();
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      state.isShiftKeyDown = false;
      if (state.terrainToolMode === 'transect-2pt' && state.tbTransectWaypoints.length === 1) {
        const geo = mainTerrainEngine.worldToLatLon(state.mouseWorldX, state.mouseWorldY);
        state.tbRubberBandPoint = { x: state.mouseWorldX, y: state.mouseWorldY, lng: geo.lonDeg, lat: geo.latDeg };
        actions.recomputeRubberBandPreview(state.tbRubberBandPoint);
        drawRadar();
      }
    }
  });

  window.addEventListener('mousemove', (e) => {
    state.isShiftKeyDown = Boolean(e.shiftKey);
    if (
      !state.draggedEntity &&
      !state.draggedToolboxVertex &&
      !state.tbDraggedAoCorner &&
      !state.tbAoSwathAnchor &&
      !state.isPanning &&
      (state.terrainMapMode !== 'radar' || state.stageViewMode !== '2d')
    ) {
      return;
    }
    const rect = radarCanvas.getBoundingClientRect();
    const w = radarCanvas.parentElement?.clientWidth ?? rect.width,
      h = radarCanvas.parentElement?.clientHeight ?? rect.height;
    const insideRadar =
      e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    const simTimelineController = state.simTimelineController;

    if (insideRadar) {
      const px = e.clientX - rect.left,
        py = e.clientY - rect.top;
      state.mouseScreenX = px;
      state.mouseScreenY = py;
      state.isMouseInsideRadar = true;
      const world = screenToWorld(px, py, w, h);
      state.mouseWorldX = world.x;
      state.mouseWorldY = world.y;
      updateRadarCursorReadout(state.mouseWorldX, state.mouseWorldY, true);
    } else {
      state.isMouseInsideRadar = false;
      updateRadarCursorReadout(0, 0, false);
    }

    if (state.tbDraggedAoCorner && insideRadar && state.tbAoSwathBox) {
      const minX = Math.min(state.tbAoSwathBox.x1, state.tbAoSwathBox.x2);
      const maxX = Math.max(state.tbAoSwathBox.x1, state.tbAoSwathBox.x2);
      const minY = Math.min(state.tbAoSwathBox.y1, state.tbAoSwathBox.y2);
      const maxY = Math.max(state.tbAoSwathBox.y1, state.tbAoSwathBox.y2);

      let targetX = state.mouseWorldX;
      let targetY = state.mouseWorldY;

      if (state.tbDraggedAoCorner === 'NW') {
        if (state.isShiftKeyDown) [targetX, targetY] = constrainSquareRegion(maxX, minY, targetX, targetY);
        state.tbAoSwathBox = { x1: targetX, y1: targetY, x2: maxX, y2: minY };
      } else if (state.tbDraggedAoCorner === 'NE') {
        if (state.isShiftKeyDown) [targetX, targetY] = constrainSquareRegion(minX, minY, targetX, targetY);
        state.tbAoSwathBox = { x1: minX, y1: minY, x2: targetX, y2: targetY };
      } else if (state.tbDraggedAoCorner === 'SE') {
        if (state.isShiftKeyDown) [targetX, targetY] = constrainSquareRegion(minX, maxY, targetX, targetY);
        state.tbAoSwathBox = { x1: minX, y1: maxY, x2: targetX, y2: targetY };
      } else if (state.tbDraggedAoCorner === 'SW') {
        if (state.isShiftKeyDown) [targetX, targetY] = constrainSquareRegion(maxX, maxY, targetX, targetY);
        state.tbAoSwathBox = { x1: targetX, y1: maxY, x2: maxX, y2: targetY };
      }
      actions.recomputeRegionZonal();
      drawRadar();
      return;
    }

    if (state.tbAoSwathAnchor && insideRadar) {
      let curX = state.mouseWorldX;
      let curY = state.mouseWorldY;
      if (state.isShiftKeyDown) {
        [curX, curY] = constrainSquareRegion(state.tbAoSwathAnchor.x, state.tbAoSwathAnchor.y, curX, curY);
      }
      state.tbAoSwathBox = { x1: state.tbAoSwathAnchor.x, y1: state.tbAoSwathAnchor.y, x2: curX, y2: curY };
      actions.recomputeRegionZonal();
      drawRadar();
      return;
    }

    if (state.draggedToolboxVertex && insideRadar) {
      let targetX = state.mouseWorldX;
      let targetY = state.mouseWorldY;
      if (state.isShiftKeyDown && state.tbTransectWaypoints.length >= 2) {
        const otherIdx = state.draggedToolboxVertex.index === 0 ? 1 : 0;
        const other = state.tbTransectWaypoints[otherIdx];
        const [sX, sY] = snapPointToAngleIncrement(other.xM, other.yM, state.mouseWorldX, state.mouseWorldY, 15);
        targetX = sX;
        targetY = sY;
      }
      const geo = mainTerrainEngine.worldToLatLon(targetX, targetY);
      state.tbTransectWaypoints[state.draggedToolboxVertex.index] = {
        xM: targetX,
        yM: targetY,
        lng: geo.lonDeg,
        lat: geo.latDeg,
      };
      actions.recomputeTransect(true);
      drawRadar();
      return;
    }

    if (state.tbObsDraggedHandle && insideRadar) {
      const draft = obstacleEditor?.draft || [];
      const targetObs = draft.find(o => o.id === state.tbObsSelectedId || o.id === obstacleEditor?.selectedId);
      const mutableObs = targetObs as {
        xM: number;
        yM: number;
        radiusM?: number;
        depthM?: number;
        rotationDeg?: number;
      };
      if (targetObs) {
        if (state.tbObsDraggedHandle === 'CENTER' && state.tbObsDragOrigin) {
          const dx = state.mouseWorldX - state.tbObsDragOrigin.x;
          const dy = state.mouseWorldY - state.tbObsDragOrigin.y;
          mutableObs.xM += dx;
          mutableObs.yM += dy;
          state.tbObsDragOrigin = { x: state.mouseWorldX, y: state.mouseWorldY };
        } else if (state.tbObsDraggedHandle === 'V1' || state.tbObsDraggedHandle === 'V2') {
          const ep = actions.getObstacleEndpoints(targetObs);
          const fixedPt = state.tbObsDraggedHandle === 'V1' ? ep.v2 : ep.v1;
          let movingPt = { x: state.mouseWorldX, y: state.mouseWorldY };
          if (state.isShiftKeyDown) {
            movingPt = snapBarrierAngle(fixedPt, movingPt, 15);
          }
          const newCx = (fixedPt.x + movingPt.x) * 0.5;
          const newCy = (fixedPt.y + movingPt.y) * 0.5;
          const newLen = Math.max(20, Math.hypot(movingPt.x - fixedPt.x, movingPt.y - fixedPt.y));
          const newRotDeg = computeBarrierWallRotationDeg(fixedPt, movingPt);

          mutableObs.xM = newCx;
          mutableObs.yM = newCy;
          if (targetObs.shape === 'cone') {
            mutableObs.radiusM = newLen * 0.5;
          } else {
            mutableObs.depthM = newLen;
            mutableObs.rotationDeg = newRotDeg;
          }
        }
        syncObstacleFieldMirror(true);
        actions.recomputeCadObstacleAnalysis();
        drawRadar();
        return;
      }
    }

    if (state.tbObsDrawingAnchor && insideRadar) {
      let curPt = { x: state.mouseWorldX, y: state.mouseWorldY };
      if (state.isShiftKeyDown) {
        curPt = snapBarrierAngle(state.tbObsDrawingAnchor, curPt, 15);
      }
      state.tbObsRubberBandPoint = curPt;
      actions.recomputeCadObstacleAnalysis();
      drawRadar();
      return;
    }

    if (!state.draggedEntity && !state.isPanning && insideRadar) {
      const px = e.clientX - rect.left,
        py = e.clientY - rect.top;

      if (
        (state.tbActiveMode === 'obstacle' || state.terrainToolMode === 'obstacle-place') &&
        !state.tbObsDraggedHandle &&
        !state.tbObsDrawingAnchor
      ) {
        const handleHit = findCadObstacleHandleHit(px, py, w, h);
        if (handleHit) {
          radarCanvas.style.cursor = handleHit.handle === 'CENTER' ? 'move' : 'crosshair';
          return;
        }
      }

      if (
        (state.terrainToolMode === 'transect-2pt' || state.terrainToolMode === 'measure') &&
        state.tbTransectWaypoints.length === 0
      ) {
        state.tbActiveSnap = actions.findMagneticSnapTarget(px, py, w, h, 15);
        drawRadar();
      } else if (
        (state.terrainToolMode === 'transect-2pt' || state.terrainToolMode === 'measure') &&
        state.tbTransectWaypoints.length === 1
      ) {
        const wpA = state.tbTransectWaypoints[0];
        if (state.isShiftKeyDown) {
          const [snapX, snapY] = snapPointToAngleIncrement(wpA.xM, wpA.yM, state.mouseWorldX, state.mouseWorldY, 15);
          const geo = mainTerrainEngine.worldToLatLon(snapX, snapY);
          state.tbRubberBandPoint = { x: snapX, y: snapY, lng: geo.lonDeg, lat: geo.latDeg, isAngleSnapped: true };
          state.tbActiveSnap = null;
        } else {
          const snap = actions.findMagneticSnapTarget(px, py, w, h, 15);
          state.tbActiveSnap = snap;
          if (snap) {
            const geo = mainTerrainEngine.worldToLatLon(snap.xM, snap.yM);
            state.tbRubberBandPoint = { x: snap.xM, y: snap.yM, lng: geo.lonDeg, lat: geo.latDeg, snapLabel: snap.label };
          } else {
            const geo = mainTerrainEngine.worldToLatLon(state.mouseWorldX, state.mouseWorldY);
            state.tbRubberBandPoint = { x: state.mouseWorldX, y: state.mouseWorldY, lng: geo.lonDeg, lat: geo.latDeg };
          }
        }
        actions.recomputeRubberBandPreview(state.tbRubberBandPoint);
        drawRadar();
      } else if (state.terrainToolMode === 'transect-poly' && state.tbTransectWaypoints.length >= 1) {
        const geo = mainTerrainEngine.worldToLatLon(state.mouseWorldX, state.mouseWorldY);
        state.tbRubberBandPoint = { x: state.mouseWorldX, y: state.mouseWorldY, lng: geo.lonDeg, lat: geo.latDeg };
        actions.recomputeRubberBandPreview(state.tbRubberBandPoint);
        drawRadar();
      } else if (
        state.terrainToolMode === 'idle' &&
        state.tbActiveMode === 'transect' &&
        state.tbTransectWaypoints.length >= 2
      ) {
        const pA = worldToScreen(state.tbTransectWaypoints[0].xM, state.tbTransectWaypoints[0].yM, w, h);
        const pB = worldToScreen(state.tbTransectWaypoints[1].xM, state.tbTransectWaypoints[1].yM, w, h);
        const segDx = pB.x - pA.x;
        const segDy = pB.y - pA.y;
        const segLenSq = segDx * segDx + segDy * segDy;
        if (segLenSq > 0) {
          const t = Math.max(0, Math.min(1, ((px - pA.x) * segDx + (py - pA.y) * segDy) / segLenSq));
          const projX = pA.x + t * segDx;
          const projY = pA.y + t * segDy;
          const distPerp = Math.hypot(px - projX, py - projY);
          if (distPerp <= 18) {
            const totalDist = Math.hypot(
              state.tbTransectWaypoints[1].xM - state.tbTransectWaypoints[0].xM,
              state.tbTransectWaypoints[1].yM - state.tbTransectWaypoints[0].yM
            );
            state.tbLineHover = {
              t,
              screenX: projX,
              screenY: projY,
              sM: t * totalDist,
            };
            if (state.tbTransectResult && state.tbTransectResult.samples.length > 0) {
              const sampleIdx = Math.max(
                0,
                Math.min(
                  state.tbTransectResult.samples.length - 1,
                  Math.round(t * (state.tbTransectResult.samples.length - 1))
                )
              );
              if (sampleIdx !== state.tbHoveredSampleIdx) {
                state.tbHoveredSampleIdx = sampleIdx;
                actions.updateToolboxTransectHoverUi();
              }
            }
            drawRadar();
          } else if (state.tbLineHover) {
            state.tbLineHover = null;
            drawRadar();
          }
        }
      } else if (
        state.terrainToolMode === 'idle' &&
        state.tbActiveMode === 'transect' &&
        state.tbTransectResult?.samples.length
      ) {
        const nearestIdx = actions.findNearestTransectSampleIndex(
          state.mouseWorldX,
          state.mouseWorldY,
          state.currentRadarRangeM * 0.03
        );
        if (nearestIdx !== state.tbHoveredSampleIdx) {
          state.tbHoveredSampleIdx = nearestIdx;
          actions.updateToolboxTransectHoverUi();
        }
      } else if (state.terrainToolMode === 'probe' || (state.tbActiveMode === 'probe' && !state.tbProbeSite)) {
        const mastM = Math.max(
          1,
          Math.min(
            200,
            parseFloat(
              $<HTMLInputElement>('tb-probe-mast-input')?.value ||
                $<HTMLInputElement>('tb-probe-agl')?.value ||
                '2'
            ) || 2
          )
        );
        const simCtx = actions.buildToolboxSimContext();
        const acnPos = simCtx.acnPositionMslM || [0, 0, 5000];
        const acnHeadingRaw = state.latestTelemetry?.acn_heading_deg;
        const acnHeadingRad = state.latestTelemetry?.acn_telemetry?.heading_rad;
        const acnHeading =
          typeof acnHeadingRaw === 'number' && Number.isFinite(acnHeadingRaw)
            ? acnHeadingRaw
            : typeof acnHeadingRad === 'number' && Number.isFinite(acnHeadingRad)
              ? (((acnHeadingRad * 180) / Math.PI) % 360 + 360) % 360
              : 0;

        state.tbCursorProbeLive = evaluateCursorRfProbe(
          { xM: state.mouseWorldX, yM: state.mouseWorldY },
          mastM,
          acnPos,
          acnHeading,
          (x, y) => {
            const e = sampleDemSafe(mainTerrainEngine, x, y).elevationM;
            return Number.isFinite(e) ? e : 0;
          },
          state.tbProbePinnedP1
        );
        actions.updateProbeUiReadouts(state.tbCursorProbeLive);
        drawRadar();
      } else if (
        state.tbActiveMode === 'probe' &&
        state.tbProbeSite &&
        state.tbViewshedResult?.isSiteWithinCoverage &&
        state.tbProbeHeatmapConfig.enabled
      ) {
        drawRadar();
      } else if (state.tbActiveMode === 'region' || state.terrainToolMode === 'region') {
        const cornerHit = findAoSwathCornerHit(px, py, w, h);
        if (cornerHit) {
          radarCanvas.style.cursor = cornerHit === 'NW' || cornerHit === 'SE' ? 'nwse-resize' : 'nesw-resize';
        } else if (state.terrainToolMode === 'region') {
          radarCanvas.style.cursor = 'crosshair';
        } else {
          radarCanvas.style.cursor = 'default';
        }

        if (state.tbAoSwathReport && state.tbAoSwathReport.cells) {
          let hover = null;
          for (const c of state.tbAoSwathReport.cells) {
            if (
              state.mouseWorldX >= c.minX &&
              state.mouseWorldX <= c.maxX &&
              state.mouseWorldY >= c.minY &&
              state.mouseWorldY <= c.maxY
            ) {
              hover = c;
              break;
            }
          }
          if (hover !== state.tbAoHoverCell) {
            state.tbAoHoverCell = hover;
            drawRadar();
          }
        }
      }
      const hoverCtx = actions.getContextualMapContext();
      let hit: number | null = null,
        best = 14;
      if (mapLayerRegistry.getEffectiveVisibility('entities.groundNodes', hoverCtx)) {
        const hoverNodes: Array<{ node_id: number; x_m?: number; y_m?: number; position?: readonly [number, number, number] }> =
          simTimelineController && simTimelineController.isHistoricalInspecting
            ? simTimelineController.getActiveSpatialSnapshot()?.nodes.map(n => ({
                node_id: n.nodeId,
                x_m: n.posX,
                y_m: n.posY,
              })) || []
            : [...(state.latestTelemetry?.nodes_telemetry || [])];
        for (const node of hoverNodes) {
          const nx = node.x_m !== undefined ? node.x_m : node.position ? node.position[0] : 0;
          const ny = node.y_m !== undefined ? node.y_m : node.position ? node.position[1] : 0;
          const pos = worldToScreen(nx, ny, w, h);
          const distance = Math.hypot(px - pos.x, py - pos.y);
          if (distance <= best) {
            best = distance;
            hit = node.node_id;
          }
        }
      }
      let acnHover = false;
      if (
        hit === null &&
        state.terrainToolMode === 'idle' &&
        obstacleEditor.mode === 'navigate' &&
        trajectoryEditor.activeMode !== 'waypoints' &&
        mapLayerRegistry.getEffectiveVisibility('entities.acn', hoverCtx)
      ) {
        const isHistHover = Boolean(simTimelineController && simTimelineController.isHistoricalInspecting);
        const histHoverSnap = isHistHover && simTimelineController ? simTimelineController.getActiveSpatialSnapshot() : null;
        const acnX = histHoverSnap ? histHoverSnap.acn.posX : state.latestTelemetry?.acn_telemetry?.pos_x;
        const acnY = histHoverSnap ? histHoverSnap.acn.posY : state.latestTelemetry?.acn_telemetry?.pos_y;
        if (typeof acnX === 'number' && Number.isFinite(acnX) && typeof acnY === 'number' && Number.isFinite(acnY)) {
          const acnScreen = worldToScreen(acnX, acnY, w, h);
          acnHover = Math.hypot(px - acnScreen.x, py - acnScreen.y) <= 16;
        }
      }
      const linkHit =
        hit === null &&
        !acnHover &&
        state.terrainToolMode === 'idle' &&
        obstacleEditor.mode === 'navigate' &&
        trajectoryEditor.activeMode !== 'waypoints'
          ? radarLinkHit(px, py, w, h)
          : null;
      if (hit !== null) setSharedMapHover('radar', 'node', hit, { x: px, y: py });
      else if (linkHit !== null) setSharedMapHover('radar', 'link', linkHit, { x: px, y: py });
      else if (state.activeMapHoverRenderer === 'radar') {
        const changed = state.hoveredNodeId !== null || state.hoveredLinkNodeId !== null;
        state.hoveredNodeId = null;
        state.hoveredLinkNodeId = null;
        state.activeMapHoverRenderer = null;
        state.mapHoverPoint = null;
        const tip = $('map-node-tooltip');
        if (tip) tip.style.display = 'none';
        if (changed) drawRadar();
      }
      let obstacleHover = false;
      if (hit === null && obstacleEditor.mode !== 'navigate') {
        const world = screenToWorld(px, py, w, h),
          toleranceM = 12 / getRadarGeometry(w, h).scale;
        obstacleHover = obstacleEditor.draft.some(obstacle => obstacleContainsPoint(obstacle, world.x, world.y, toleranceM));
      }
      let handleHover = false;
      if (state.tbActiveMode === 'transect' && state.tbTransectWaypoints.length >= 2) {
        const pA = worldToScreen(state.tbTransectWaypoints[0].xM, state.tbTransectWaypoints[0].yM, w, h);
        const pB = worldToScreen(state.tbTransectWaypoints[1].xM, state.tbTransectWaypoints[1].yM, w, h);
        if (Math.hypot(px - pA.x, py - pA.y) <= 12 || Math.hypot(px - pB.x, py - pB.y) <= 12) {
          handleHover = true;
        }
      }
      if (simTimelineController && simTimelineController.isHistoricalInspecting && hit !== null) {
        radarCanvas.style.cursor = 'not-allowed';
      } else {
        radarCanvas.style.cursor = handleHover
          ? 'grab'
          : state.terrainToolMode !== 'idle'
            ? 'crosshair'
            : hit !== null || linkHit !== null || acnHover
              ? 'pointer'
              : obstacleEditor.mode === 'place' && !state.spatialLocked
                ? 'crosshair'
                : obstacleHover
                  ? state.spatialLocked
                    ? 'pointer'
                    : 'grab'
                  : 'grab';
      }
    } else if (!insideRadar && !state.draggedEntity && !state.isPanning) {
      if (state.activeMapHoverRenderer === 'radar') {
        state.hoveredNodeId = null;
        state.hoveredLinkNodeId = null;
        state.activeMapHoverRenderer = null;
        state.mapHoverPoint = null;
        const tip = $('map-node-tooltip');
        if (tip) tip.style.display = 'none';
        drawRadar();
      }
      radarCanvas.style.cursor = 'grab';
    }

    if (state.draggedEntity) {
      if (simTimelineController && simTimelineController.isHistoricalInspecting) {
        state.draggedEntity = null;
        radarCanvas.style.cursor = 'not-allowed';
        return;
      }
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, w, h);
      if (state.draggedEntity.type === 'waypoint') {
        try {
          trajectoryEditor.moveWaypoint(state.draggedEntity.id, { xM: world.x, yM: world.y });
          actions.refreshTrajectoryEditor();
        } catch (error) {
          actions.setTrajectoryMessage(error instanceof Error ? error.message : String(error), true);
        }
      } else if (state.draggedEntity.type === 'obstacle') {
        if (!state.spatialLocked) {
          try {
            obstacleEditor.move(state.draggedEntity.id, world.x, world.y);
            actions.refreshObstacleEditor();
          } catch (error) {
            obstacleEditor.message = error instanceof Error ? error.message : String(error);
            actions.refreshObstacleEditor();
          }
        }
      } else {
        actions.syncMapNodeDragVisibility?.(true);
        state.draggedEntity.lastPosition = { xM: world.x, yM: world.y };
        const now = performance.now();
        if (now - state.lastMoveSendTime > 40) {
          actions.sendCommand({ type: 'NODE_MOVE', node_id: state.draggedEntity.id, x_m: world.x, y_m: world.y });
          state.lastMoveSendTime = now;
        }
      }
    } else if (state.isPanning) {
      if (Math.hypot(e.clientX - state.panOriginX, e.clientY - state.panOriginY) >= 4) {
        actions.syncMapNodeDragVisibility?.(true);
      }
      const { scale } = getRadarGeometry(w, h);
      state.panOffsetX_m -= (e.clientX - state.panStartX) / scale;
      state.panOffsetY_m += (e.clientY - state.panStartY) / scale;
      state.panStartX = e.clientX;
      state.panStartY = e.clientY;
      actions.markRadarDirty();
    }
  });

  const finishRadarDrag = (e: MouseEvent | PointerEvent): void => {
    const wasPanning = state.isPanning;
    const simTimelineController = state.simTimelineController;
    if (state.tbDraggedAoCorner) {
      state.tbDraggedAoCorner = null;
      actions.recomputeRegionZonal();
      drawRadar();
    }
    if (state.tbAoSwathAnchor) {
      state.tbAoSwathAnchor = null;
      state.terrainToolMode = 'idle';
      actions.refreshTerrainToolbox();
      actions.setTerrainToolStatus('AO Swath locked. Drag corner handles to resize, or deploy squad/relay.');
      actions.recomputeRegionZonal();
      drawRadar();
    }
    if (state.tbObsDraggedHandle) {
      if (state.tbObstacleHistory) {
        state.tbObstacleHistory.pushState(obstacleEditor.draft);
      }
      state.tbObsDraggedHandle = null;
      state.tbObsDragOrigin = null;
      actions.setTerrainToolStatus('Obstacle barrier updated.');
      actions.recomputeCadObstacleAnalysis();
      actions.renderObstacleInventoryList();
      drawRadar();
    }
    if (state.tbObsDrawingAnchor) {
      const pA = state.tbObsDrawingAnchor;
      let pB = state.tbObsRubberBandPoint || { x: state.mouseWorldX, y: state.mouseWorldY };
      if (state.isShiftKeyDown) {
        pB = snapBarrierAngle(pA, pB, 15);
      }
      const dist = Math.hypot(pB.x - pA.x, pB.y - pA.y);
      const shapeMode = ($<HTMLSelectElement>('tb-obs-shape-select')?.value || 'wall') as ObstacleShapeMode;
      const preset = OBSTACLE_PRESETS[shapeMode] || OBSTACLE_PRESETS.wall;

      if (state.tbObstacleHistory) {
        state.tbObstacleHistory.pushState(obstacleEditor.draft);
      }

      if (dist >= 30.0) {
        const cx = (pA.x + pB.x) * 0.5;
        const cy = (pA.y + pB.y) * 0.5;
        const rotDeg = computeBarrierWallRotationDeg(pA, pB);
        obstacleEditor.create('cuboid', cx, cy);
        obstacleEditor.updateSelected({
          widthM: shapeMode === 'block' ? 100 : 35,
          depthM: dist,
          heightM: preset.defaultHeightM || 120,
          rotationDeg: rotDeg,
        });
        state.tbObsSelectedId = obstacleEditor.selectedId;
        actions.setTerrainToolStatus(`CAD barrier (L=${Math.round(dist)}m @ ${rotDeg.toFixed(1)}°) extruded.`);
      } else {
        obstacleEditor.create(preset.shapeType, pA.x, pA.y);
        if (preset.shapeType === 'cone') {
          obstacleEditor.updateSelected({
            radiusM: preset.defaultWidthM / 2,
            heightM: preset.defaultHeightM,
          });
        } else {
          obstacleEditor.updateSelected({
            widthM: preset.defaultWidthM,
            depthM: preset.defaultDepthM,
            heightM: preset.defaultHeightM,
            rotationDeg: 0,
          });
        }
        state.tbObsSelectedId = obstacleEditor.selectedId;
        actions.setTerrainToolStatus(`Obstacle [${preset.label}] placed at (${Math.round(pA.x)}, ${Math.round(pA.y)}) m.`);
      }
      state.tbObsDrawingAnchor = null;
      state.tbObsRubberBandPoint = null;
      state.terrainToolMode = 'idle';
      syncObstacleFieldMirror(true);
      actions.refreshObstacleEditor();
      actions.renderObstacleInventoryList();
      actions.recomputeCadObstacleAnalysis();
      actions.refreshTerrainToolbox();

      drawRadar();
    }
    if (state.draggedToolboxVertex) {
      state.draggedToolboxVertex = null;
      actions.recomputeTransect(false);
      drawRadar();
    }
    if (
      state.draggedEntity?.type === 'node' &&
      state.draggedEntity.lastPosition &&
      !state.spatialLocked &&
      (!simTimelineController || !simTimelineController.isHistoricalInspecting)
    ) {
      actions.sendCommand({
        type: 'NODE_MOVE',
        node_id: state.draggedEntity.id,
        x_m: state.draggedEntity.lastPosition.xM,
        y_m: state.draggedEntity.lastPosition.yM,
      });
    }
    actions.markRadarDirty();
    actions.syncMapNodeDragVisibility?.(false);
    state.draggedEntity = null;
    state.isPanning = false;
    radarCanvas.style.cursor = 'grab';
    if (
      wasPanning &&
      e &&
      (e.type === 'mouseup' || e.type === 'pointerup') &&
      e.button === 0 &&
      e.target === radarCanvas &&
      Math.hypot(e.clientX - state.panOriginX, e.clientY - state.panOriginY) < 4 &&
      actions.isNeutralMapSelectionMode()
    ) {
      actions.dismissNodeInspector();
    }
  };
  window.addEventListener('mouseup', finishRadarDrag);
  window.addEventListener('pointerup', finishRadarDrag);
  window.addEventListener('pointercancel', finishRadarDrag);
  radarCanvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      state.currentRadarRangeM = Math.max(
        MIN_RADAR_RANGE_M,
        Math.min(actions.getMaxRadarRangeM(), state.currentRadarRangeM * (e.deltaY < 0 ? 0.82 : 1.22))
      );
      actions.setRadarRange(state.currentRadarRangeM);
    },
    { passive: false }
  );

  Object.assign(actions, {
    getRadarWorldTileLayer,
    getRadarNodeMarkerLayer,
    getRadar2dRenderer,
    drawLabelLeaderTick,
    invalidateToolboxCache,
    syncObstacleFieldMirror,
    updateRadarCursorReadout,
    renderNodeHoverTooltip,
    setSharedMapHover,
    renderHillshadeFromWorker,
    getRadarGeometry,
    worldToScreen,
    screenToWorld,
    renderMapLibreKineticOverlay,
    drawRadar,
    radarLinkHit,
  });
}
