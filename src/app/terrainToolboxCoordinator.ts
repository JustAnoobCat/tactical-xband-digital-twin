// Terrain Toolbox coordinator (transect, probe, AO swath region, CAD obstacle, bridge finder & precision suite)
import type { AppContext } from './appContext.ts';
import type { Position3D } from '../shared/types.ts';
import type { ObstacleShapeMode } from '../ui/terrainAnalysisController.ts';
import type { ToolboxGroundNodeView, ToolboxSimulationContext } from '../ui/terrainToolboxAnalysis.ts';
import type { MapLayerId } from '../ui/workbench/mapLayerRegistry.ts';
import type { ToolboxMode } from '../ui/controllers/terrainToolboxController.ts';
import type { ProbeHeatmapConfig } from '../ui/toolboxPrecisionSuite.ts';
import { MAX_ACTIVE_GROUND_NODES } from '../shared/constants.ts';
import { RFConfig, EnvironmentConfig } from '../core/config.ts';
import { cartesianToGeodetic } from '../core/geodesy.ts';
import { snapPointToAngleIncrement } from '../core/geodeticRulerEngine.ts';
import {
  computeGeodeticRulerMetrics,
  evaluateRulerProfileAndBlockingPeak,
} from '../core/geodeticRulerEngine.ts';
import { evaluateCursorRfProbe } from '../core/cursorProbeEngine.ts';
import { evaluateAoSwathAnalysis } from '../core/aoSwathScannerEngine.ts';
import {
  computeTransectRfMetrics,
  OBSTACLE_PRESETS,
} from '../ui/terrainAnalysisController.ts';
import { buildNodeAddCommand } from '../ui/nodeInventory.ts';
import {
  analyzeRegionZonal,
  canAddNodeFromToolbox,
  canApplyTransectAsAcnWaypoints,
  computeAltitudeSweep,
  computeOrbitPersistence,
  computePolygonAreaKm2,
  computeSiteProbeViewshed,
  computeSlopeAndRidgeGrid,
  evaluateTransect,
  exportRegionGeoJson,
  exportTransectCsv,
  findJointRelayBridge,
  getDemProvenanceSummary,
  sampleDemSafe,
} from '../ui/terrainToolboxAnalysis.ts';
import {
  renderAltitudeSweepChart,
  renderBridgeHeatmapCanvas,
  renderPolarHorizonChart,
  renderSlopeOrRidgeBackdropCanvas,
  renderTransectProfileCanvas,
  renderProbeHeatmapCanvas,
  transectCanvasXToSampleIndex,
} from '../ui/terrainToolboxCharts.ts';
import { createTerrainToolboxController } from '../ui/controllers/terrainToolboxController.ts';
import { createToolboxPrecisionUi, createToolboxRuntimeBridge } from '../ui/toolboxPrecisionSuite.ts';

export function initTerrainToolboxCoordinator(ctx: AppContext) {
  const { state, engines, canvases, dom, actions } = ctx;
  const { $, setText, mapEscape } = dom;
  const {
    mainTerrainEngine,
    obstacleEditor,
    mapLayerRegistry,
    historyController,
    schedHistoryController,
  } = engines;
  const { radarCanvas } = canvases;

  let terrainToolboxControllerInstance: ReturnType<typeof createTerrainToolboxController> | null = null;
  let toolboxPrecisionUi: ReturnType<typeof createToolboxPrecisionUi> | null = null;

  state.tbShowRulerTicks = false;

  function getTerrainToolboxController(): ReturnType<typeof createTerrainToolboxController> {
    if (!terrainToolboxControllerInstance) {
      terrainToolboxControllerInstance = createTerrainToolboxController({
        documentRef: document,
        windowRef: window,
        getTelemetry: () => state.latestTelemetry,
        getHistoricalSnapshot: () =>
          state.simTimelineController && state.simTimelineController.isHistoricalInspecting
            ? state.simTimelineController.getActiveSpatialSnapshot()
            : null,
        getTerrainEngine: () => mainTerrainEngine,
        getObstacleEditor: () => obstacleEditor,
        sendCommand: msg => actions.sendCommand(msg),
        markRadarDirty: () => {
          actions.markRadarDirty();
        },
        drawRadar: () => actions.drawRadar(),
        updateMapLibreToolSources: () => actions.updateMapLibreToolSources(),
        updateMapLibreOverlay: () => actions.updateMapLibreOverlay(),
        onStatusChange: text => setText('terrain-toolbox-status', text),
        onSwitchMainTab: tabId => window.switchMainTab?.(tabId),
      });
    }
    return terrainToolboxControllerInstance;
  }

  function getRadarPointerWorld(event: MouseEvent | PointerEvent): { x: number; y: number } {
    const rect = radarCanvas.getBoundingClientRect();
    const w = radarCanvas.parentElement?.clientWidth || rect.width;
    const h = radarCanvas.parentElement?.clientHeight || rect.height;
    return actions.screenToWorld(event.clientX - rect.left, event.clientY - rect.top, w, h);
  }

  function terrainDistanceText(distanceM: number): string {
    return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(2)} km` : `${distanceM.toFixed(0)} m`;
  }

  function setTerrainToolStatus(text: string): void {
    setText('terrain-toolbox-status', text);
  }

  function downloadTextBlob(filename: string, content: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function buildToolboxSimContext(): ToolboxSimulationContext {
    const freqGhz = parseFloat($<HTMLInputElement>('param-freq')?.value ?? '8.0');
    const bwMhz = parseFloat($<HTMLInputElement>('param-bw')?.value ?? '1.0');
    const rainMmH = parseFloat($<HTMLInputElement>('param-rain')?.value ?? '0.0');
    const rfConfig = new RFConfig({
      carrierFrequencyHz: (Number.isFinite(freqGhz) ? freqGhz : 8.0) * 1e9,
      channelBandwidthHz: Math.max(0.1, Math.min(50, Number.isFinite(bwMhz) ? bwMhz : 1.0)) * 1e6,
    });
    const envConfig = new EnvironmentConfig({
      rainRateMmH: Number.isFinite(rainMmH) ? rainMmH : 0.0,
    });

    const simTimelineController = state.simTimelineController;
    const isHist = Boolean(
      historyController?.isInspecting ||
        schedHistoryController?.isInspecting ||
        simTimelineController?.isHistoricalInspecting
    );
    const histSnap = isHist && simTimelineController ? simTimelineController.getActiveSpatialSnapshot() : null;
    const liveAcn = state.latestTelemetry?.acn_telemetry;
    const acnX = Number(histSnap ? histSnap.acn.posX : liveAcn?.pos_x);
    const acnY = Number(histSnap ? histSnap.acn.posY : liveAcn?.pos_y);
    const acnZ = Number(histSnap ? histSnap.acn.altitudeMslM : liveAcn?.altitude_msl_m ?? liveAcn?.pos_z ?? 5000);
    const acnPositionMslM: Position3D | null = [acnX, acnY, acnZ].every(Number.isFinite)
      ? ([acnX, acnY, acnZ] as const)
      : null;

    const liveNodes = state.latestTelemetry?.nodes_telemetry || [];
    const liveById = new Map(liveNodes.map(n => [n.node_id, n]));
    const groundNodes: ToolboxGroundNodeView[] = histSnap
      ? histSnap.nodes.map(hn => {
          const ln = liveById.get(hn.nodeId);
          return {
            nodeId: hn.nodeId,
            name: ln?.name || `S${hn.nodeId}`,
            nodeType: ln?.node_type === 'mcp' ? 'mcp' : 'soldier',
            xM: hn.posX,
            yM: hn.posY,
            aglM: Number(ln?.agl_m ?? 2),
            terrainMslM: Number(ln?.terrain_elevation_msl_m ?? 3000),
            snrDb: Number.isFinite(hn.snrDb) ? hn.snrDb : null,
            isLos: Boolean(hn.isLos),
            obstacleBlocked: Boolean(hn.isObstacleBlocked),
          };
        })
      : liveNodes.map(n => ({
          nodeId: n.node_id,
          name: n.name || `S${n.node_id}`,
          nodeType: n.node_type === 'mcp' ? 'mcp' : 'soldier',
          xM: Number(n.x_m ?? n.position?.[0] ?? 0),
          yM: Number(n.y_m ?? n.position?.[1] ?? 0),
          aglM: Number(n.agl_m ?? 2),
          terrainMslM: Number(n.terrain_elevation_msl_m ?? 3000),
          snrDb: Number.isFinite(Number(n.snr_db)) ? Number(n.snr_db) : null,
          isLos: Boolean(n.terrain_is_los),
          obstacleBlocked: Boolean(n.obstacle_blocked),
        }));

    return {
      terrainEngine: mainTerrainEngine,
      rfConfig,
      envConfig,
      acnPositionMslM,
      trajectoryConfig: state.latestTelemetry?.trajectory_config ?? null,
      groundNodes,
      spatialRevision: state.currentSpatialRevision,
      isHistoricalInspecting: isHist,
      spatialLocked: Boolean(state.spatialLocked),
    };
  }

  function parseTransectHeightPreset(val: string): { heightMode: 'acn_alt' | 'ground_agl'; aglM: number } {
    if (val === 'acn_alt') return { heightMode: 'acn_alt', aglM: 0 };
    if (val === 'ground_15') return { heightMode: 'ground_agl', aglM: 15 };
    return { heightMode: 'ground_agl', aglM: 2 };
  }

  function buildTransectWaypointInputs(waypoints: ReadonlyArray<{ xM: number; yM: number }>) {
    const pA = parseTransectHeightPreset($<HTMLSelectElement>('tb-transect-height-a')?.value || 'ground_2');
    const pB = parseTransectHeightPreset($<HTMLSelectElement>('tb-transect-height-b')?.value || 'ground_2');
    return waypoints.map((wp, idx) => {
      const preset = idx === 0 ? pA : pB;
      return { xM: wp.xM, yM: wp.yM, aglM: preset.aglM, heightMode: preset.heightMode };
    });
  }

  function findMagneticSnapTarget(px: number, py: number, w: number, h: number, snapThresholdPx = 15) {
    let bestDist = snapThresholdPx;
    let snapTarget: { xM: number; yM: number; label: string; sp: { x: number; y: number } } | null = null;
    const simTimelineController = state.simTimelineController;

    // 1. Ground Nodes
    const currentNodes: Array<{ node_id: number; x_m?: number; y_m?: number; position?: readonly [number, number, number] }> =
      simTimelineController && simTimelineController.isHistoricalInspecting
        ? simTimelineController.getActiveSpatialSnapshot()?.nodes.map(n => ({
            node_id: n.nodeId,
            x_m: n.posX,
            y_m: n.posY,
          })) || []
        : [...(state.latestTelemetry?.nodes_telemetry || [])];
    for (const n of currentNodes) {
      const nx = n.x_m !== undefined ? n.x_m : n.position ? n.position[0] : 0;
      const ny = n.y_m !== undefined ? n.y_m : n.position ? n.position[1] : 0;
      const sp = actions.worldToScreen(nx, ny, w, h);
      const d = Math.hypot(px - sp.x, py - sp.y);
      if (d <= bestDist) {
        bestDist = d;
        snapTarget = { xM: nx, yM: ny, label: `Node S${n.node_id}`, sp };
      }
    }

    // 2. Relay [MCP-OPT]
    const advisor = state.latestTelemetry?.relay_advisor;
    if (advisor && Array.isArray(advisor.optimalPosEnu) && advisor.optimalPosEnu.length >= 2) {
      const rx = advisor.optimalPosEnu[0];
      const ry = advisor.optimalPosEnu[1];
      const sp = actions.worldToScreen(rx, ry, w, h);
      const d = Math.hypot(px - sp.x, py - sp.y);
      if (d <= bestDist) {
        bestDist = d;
        snapTarget = { xM: rx, yM: ry, label: 'Relay MCP-OPT', sp };
      }
    }

    // 3. EW Jammer [EW-JAM]
    if (state.latestTelemetry?.jammer_enabled) {
      const jPos = state.latestTelemetry.jammer_pos_enu || [3200, -2800, 0];
      const jx = jPos[0],
        jy = jPos[1];
      const sp = actions.worldToScreen(jx, jy, w, h);
      const d = Math.hypot(px - sp.x, py - sp.y);
      if (d <= bestDist) {
        bestDist = d;
        snapTarget = { xM: jx, yM: jy, label: 'EW-JAM', sp };
      }
    }

    // 4. ACN
    const histAcn =
      simTimelineController && simTimelineController.isHistoricalInspecting
        ? simTimelineController.getActiveSpatialSnapshot()?.acn
        : null;
    const liveAcnSnap = state.latestTelemetry?.acn_telemetry;
    const acnX = histAcn ? histAcn.posX : liveAcnSnap?.pos_x ?? null;
    const acnY = histAcn ? histAcn.posY : liveAcnSnap?.pos_y ?? null;
    if (typeof acnX === 'number' && Number.isFinite(acnX) && typeof acnY === 'number' && Number.isFinite(acnY)) {
      const sp = actions.worldToScreen(acnX, acnY, w, h);
      const d = Math.hypot(px - sp.x, py - sp.y);
      if (d <= bestDist) {
        bestDist = d;
        snapTarget = { xM: acnX, yM: acnY, label: 'ACN', sp };
      }
    }

    return snapTarget;
  }

  function recomputeTransect(isPreview = false): void {
    if (state.tbTransectWaypoints.length < 2) {
      state.tbTransectResult = null;
      state.tbHoveredSampleIdx = null;
      state.tbRulerMetrics = null;
      state.tbRulerEvaluation = null;
      setText('tb-transect-fresnel', '-- m (100%)');
      setText('tb-transect-diffraction', '0.0 dB');
      setText('tb-transect-snr', '-- dB / --');
      setText('tb-transect-azimuth', '--° / --°');
      setText('tb-transect-vert-angle', '--° / --%');
      setText('tb-transect-blocking-peak', '--');
      renderToolboxDrawer();
      return;
    }
    const simCtx = buildToolboxSimContext();
    const kFactor = parseFloat($<HTMLInputElement>('tb-transect-k')?.value || String(4 / 3));
    const nodeType = $<HTMLSelectElement>('tb-transect-node-type')?.value === 'mcp' ? 'mcp' : 'soldier';
    const includeObstacles = isPreview ? false : Boolean($<HTMLInputElement>('tb-transect-obstacles')?.checked ?? true);
    state.tbTransectResult = evaluateTransect(simCtx, buildTransectWaypointInputs(state.tbTransectWaypoints), {
      kFactor: Number.isFinite(kFactor) ? kFactor : 4 / 3,
      includeObstacles,
      nodeType,
      ...(isPreview ? { sampleCount: 64 } : {}),
    });
    if (state.tbHoveredSampleIdx !== null && !state.tbTransectResult.samples[state.tbHoveredSampleIdx]) {
      state.tbHoveredSampleIdx = null;
    }

    const txMastM = Math.max(1, Math.min(2000, parseFloat($<HTMLInputElement>('tb-transect-tx-mast')?.value || '10') || 10));
    const rxMastM = Math.max(1, Math.min(2000, parseFloat($<HTMLInputElement>('tb-transect-rx-mast')?.value || '2') || 2));
    if (state.tbTransectResult && state.tbTransectResult.samples && state.tbTransectResult.samples.length >= 2) {
      const elevs = state.tbTransectResult.samples.map((s: { terrainMslM: number }) => s.terrainMslM);
      const rf = computeTransectRfMetrics(elevs, state.tbTransectResult.totalHorizontalM, txMastM, rxMastM);
      setText('tb-transect-fresnel', `${rf.minF1ClearanceM.toFixed(1)} m (${Math.round(rf.minF1ClearancePct)}%)`);
      setText('tb-transect-diffraction', `${rf.p526DiffractionLossDb.toFixed(1)} dB`);
      setText('tb-transect-snr', `${rf.estSnrDb.toFixed(1)} dB / ${rf.estModcod}`);
    } else {
      setText('tb-transect-fresnel', '-- m (100%)');
      setText('tb-transect-diffraction', '-- dB');
      setText('tb-transect-snr', '-- dB / --');
    }
    const wpA = state.tbTransectWaypoints[state.tbTransectWaypoints.length - 2];
    const wpB = state.tbTransectWaypoints[state.tbTransectWaypoints.length - 1];
    const demA = sampleDemSafe(simCtx.terrainEngine, wpA.xM, wpA.yM).elevationM || 3500;
    const demB = sampleDemSafe(simCtx.terrainEngine, wpB.xM, wpB.yM).elevationM || 3500;
    state.tbRulerMetrics = computeGeodeticRulerMetrics(
      { xM: wpA.xM, yM: wpA.yM, groundElevationM: demA, mastHeightM: txMastM },
      { xM: wpB.xM, yM: wpB.yM, groundElevationM: demB, mastHeightM: rxMastM }
    );
    state.tbRulerEvaluation = evaluateRulerProfileAndBlockingPeak(
      { xM: wpA.xM, yM: wpA.yM, groundElevationM: demA, mastHeightM: txMastM },
      { xM: wpB.xM, yM: wpB.yM, groundElevationM: demB, mastHeightM: rxMastM },
      (x, y) => sampleDemSafe(simCtx.terrainEngine, x, y).elevationM || 3500,
      { kFactor: Number.isFinite(kFactor) ? kFactor : 4 / 3 }
    );
    setText(
      'tb-transect-azimuth',
      `${state.tbRulerMetrics.azimuthDeg.toFixed(1)}° ${state.tbRulerMetrics.cardinalOctant} / ${state.tbRulerMetrics.backAzimuthDeg.toFixed(1)}°`
    );
    setText(
      'tb-transect-vert-angle',
      `${state.tbRulerMetrics.verticalAngleDeg >= 0 ? '+' : ''}${state.tbRulerMetrics.verticalAngleDeg.toFixed(1)}° / ${state.tbRulerMetrics.gradePct >= 0 ? '+' : ''}${state.tbRulerMetrics.gradePct.toFixed(1)}%`
    );
    if (!state.tbRulerEvaluation.isLineOfSightClear && state.tbRulerEvaluation.blockingPeak) {
      const bp = state.tbRulerEvaluation.blockingPeak;
      const bpGeo = cartesianToGeodetic(bp.xM, bp.yM);
      setText(
        'tb-transect-blocking-peak',
        `Peak @ (${bpGeo.latDeg.toFixed(3)}°, ${bpGeo.lonDeg.toFixed(3)}°) · ${Math.round(bp.zMslM)} m (+${Math.round(bp.intrusionM)} m)`
      );
    } else {
      setText('tb-transect-blocking-peak', `Clear LoS (Min Clr: ${Math.round(state.tbRulerEvaluation.minClearanceM)} m)`);
    }

    renderMode1Provenance();
    renderToolboxDrawer();
  }

  function recomputeRubberBandPreview(cursorPt: { x: number; y: number; lng?: number; lat?: number } | null): void {
    if (!cursorPt || state.tbTransectWaypoints.length === 0) return;
    const previewWps = [
      ...state.tbTransectWaypoints,
      { xM: cursorPt.x, yM: cursorPt.y, lng: cursorPt.lng, lat: cursorPt.lat },
    ];
    const simCtx = buildToolboxSimContext();
    const kFactor = parseFloat($<HTMLInputElement>('tb-transect-k')?.value || String(4 / 3));
    const nodeType = $<HTMLSelectElement>('tb-transect-node-type')?.value === 'mcp' ? 'mcp' : 'soldier';
    state.tbTransectResult = evaluateTransect(simCtx, buildTransectWaypointInputs(previewWps), {
      kFactor: Number.isFinite(kFactor) ? kFactor : 4 / 3,
      includeObstacles: false,
      nodeType,
      sampleCount: 64,
    });
    const wpA = state.tbTransectWaypoints[state.tbTransectWaypoints.length - 1];
    const txMastM = Math.max(1, Math.min(2000, parseFloat($<HTMLInputElement>('tb-transect-tx-mast')?.value || '10') || 10));
    const rxMastM = Math.max(1, Math.min(2000, parseFloat($<HTMLInputElement>('tb-transect-rx-mast')?.value || '2') || 2));
    const demA = sampleDemSafe(simCtx.terrainEngine, wpA.xM, wpA.yM).elevationM || 3500;
    const demB = sampleDemSafe(simCtx.terrainEngine, cursorPt.x, cursorPt.y).elevationM || 3500;
    state.tbRulerPreviewMetrics = computeGeodeticRulerMetrics(
      { xM: wpA.xM, yM: wpA.yM, groundElevationM: demA, mastHeightM: txMastM },
      { xM: cursorPt.x, yM: cursorPt.y, groundElevationM: demB, mastHeightM: rxMastM }
    );
    state.tbRulerPreviewEval = evaluateRulerProfileAndBlockingPeak(
      { xM: wpA.xM, yM: wpA.yM, groundElevationM: demA, mastHeightM: txMastM },
      { xM: cursorPt.x, yM: cursorPt.y, groundElevationM: demB, mastHeightM: rxMastM },
      (x, y) => sampleDemSafe(simCtx.terrainEngine, x, y).elevationM || 3500,
      { kFactor: Number.isFinite(kFactor) ? kFactor : 4 / 3 }
    );
    setText(
      'tb-transect-azimuth',
      `${state.tbRulerPreviewMetrics.azimuthDeg.toFixed(1)}° ${state.tbRulerPreviewMetrics.cardinalOctant} / ${state.tbRulerPreviewMetrics.backAzimuthDeg.toFixed(1)}°`
    );
    setText(
      'tb-transect-vert-angle',
      `${state.tbRulerPreviewMetrics.verticalAngleDeg >= 0 ? '+' : ''}${state.tbRulerPreviewMetrics.verticalAngleDeg.toFixed(1)}° / ${state.tbRulerPreviewMetrics.gradePct >= 0 ? '+' : ''}${state.tbRulerPreviewMetrics.gradePct.toFixed(1)}%`
    );
    renderToolboxDrawer();
  }

  function findNearestTransectSampleIndex(xM: number, yM: number, maxDistM = Number.POSITIVE_INFINITY): number | null {
    if (!state.tbTransectResult || !state.tbTransectResult.samples.length) return null;
    let bestIdx: number | null = null;
    let bestDist = maxDistM;
    for (let i = 0; i < state.tbTransectResult.samples.length; i++) {
      const s = state.tbTransectResult.samples[i];
      const d = Math.hypot(s.xM - xM, s.yM - yM);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function updateToolboxTransectHoverUi(): void {
    const cvs = $<HTMLCanvasElement>('tb-transect-canvas');
    if (cvs) renderTransectProfileCanvas(cvs, state.tbTransectResult, state.tbHoveredSampleIdx);
    const info = $('tb-transect-hover-readout');
    if (info) {
      const hs = state.tbHoveredSampleIdx !== null ? state.tbTransectResult?.samples[state.tbHoveredSampleIdx] : null;
      info.textContent = hs
        ? `${(hs.cumulativeDistM / 1000).toFixed(2)} km · DEM ${hs.terrainMslM.toFixed(0)} m · Clear ${hs.clearanceM.toFixed(1)} m · ν=${hs.nu.toFixed(2)} (${hs.status.toUpperCase()})`
        : 'Hover profile or map line to inspect samples.';
    }
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
  }

  function updateProbeUiReadouts(analysis?: ReturnType<typeof evaluateCursorRfProbe> | null): void {
    if (!analysis) {
      setText('tb-probe-acn-range', '-- km');
      setText('tb-probe-acn-el', '--°');
      setText('tb-probe-acn-los', '--');
      setText('tb-probe-acn-sinr', '-- dB');
      setText('tb-probe-acn-modcod', '--');
      setText('tb-probe-horizon-mask', '--° / --%');
      setText('tb-probe-sector-bore', '--');
      setText('tb-probe-delta-pin', '--');
      toolboxPrecisionUi?.sync({ cursorProbeLive: null });
      return;
    }
    setText('tb-probe-acn-range', `${analysis.d3dKm.toFixed(2)} km`);
    setText('tb-probe-acn-el', `${analysis.elToAcnDeg >= 0 ? '+' : ''}${analysis.elToAcnDeg.toFixed(1)}°`);
    setText('tb-probe-acn-los', analysis.isLos ? 'CLEAR (LoS)' : 'SHADOWED');
    setText('tb-probe-acn-sinr', `${analysis.estSinrDb.toFixed(1)} dB`);
    setText(
      'tb-probe-acn-modcod',
      `${analysis.modcodName.replace(/^LINK_/, '')} (${analysis.estBitrateMbps.toFixed(2)} Mbps)`
    );
    setText(
      'tb-probe-horizon-mask',
      `${analysis.horizonMaskAngleDeg.toFixed(1)}° / ${analysis.skyOpennessPct.toFixed(0)}%`
    );
    setText('tb-probe-sector-bore', `S${analysis.activeSectorId} (${analysis.offBoresightDeg.toFixed(1)}° off)`);
    if (analysis.deltaVsPin) {
      const d = analysis.deltaVsPin;
      const sinrSign = d.deltaSinrDb >= 0 ? '+' : '';
      const elevSign = d.deltaElevM >= 0 ? '+' : '';
      setText(
        'tb-probe-delta-pin',
        `ΔSINR: ${sinrSign}${d.deltaSinrDb.toFixed(1)}dB | ΔElev: ${elevSign}${Math.round(d.deltaElevM)}m | ${d.distFromPinKm.toFixed(2)}km @ ${Math.round(d.bearingFromPinDeg)}°`
      );
    } else {
      setText('tb-probe-delta-pin', 'Click to Pin [P1]');
    }
    toolboxPrecisionUi?.sync({ cursorProbeLive: analysis });
  }

  function recomputeProbeAnalysis(): void {
    const simCtx = buildToolboxSimContext();
    const aglM = Math.max(0, Math.min(500, parseFloat($<HTMLInputElement>('tb-probe-agl')?.value || '2') || 2));
    const radiusKm = Math.max(5, Math.min(60, parseFloat($<HTMLInputElement>('tb-probe-radius')?.value || '24') || 24));
    const targetMode = $<HTMLSelectElement>('tb-probe-target')?.value === 'acn_alt' ? 'acn_alt' : 'ground_agl';
    const includeObstacles = Boolean($<HTMLInputElement>('tb-probe-obstacles')?.checked ?? true);
    const sweepKind = $<HTMLSelectElement>('tb-sweep-target')?.value || 'probe';
    const nodeType = $<HTMLSelectElement>('tb-transect-node-type')?.value === 'mcp' ? 'mcp' : 'soldier';

    if (state.tbProbeSite) {
      const unitKind = $<HTMLSelectElement>('tb-probe-unit-select')?.value === 'mcp' ? 'mcp' : 'soldier';
      state.tbViewshedResult = computeSiteProbeViewshed(simCtx, {
        xM: state.tbProbeSite.xM,
        yM: state.tbProbeSite.yM,
        observerAglM: aglM,
        radiusM: radiusKm * 1000,
        targetMode,
        targetAglM: 2.0,
        includeObstacles,
        txPowerDbm: unitKind === 'mcp' ? 40 : 30,
      });
      state.tbViewshedCanvas = renderProbeHeatmapCanvas(
        state.tbViewshedResult,
        state.tbViewshedCanvas ?? undefined,
        320,
        state.tbProbeHeatmapConfig
      );
      state.tbViewshedNeedsMapLibreSync = true;
      state.tbOrbitResult = computeOrbitPersistence(
        simCtx,
        state.tbProbeSite.xM,
        state.tbProbeSite.yM,
        aglM,
        includeObstacles,
        nodeType
      );

      const mastM = Math.max(
        1,
        Math.min(
          200,
          parseFloat($<HTMLInputElement>('tb-probe-mast-input')?.value || $<HTMLInputElement>('tb-probe-agl')?.value || '2') || 2
        )
      );
      const acnPos = simCtx.acnPositionMslM || [0, 0, 5000];
      const acnHeadingRaw = state.latestTelemetry?.acn_heading_deg;
      const acnHeadingRad = state.latestTelemetry?.acn_telemetry?.heading_rad;
      const acnHeading =
        typeof acnHeadingRaw === 'number' && Number.isFinite(acnHeadingRaw)
          ? acnHeadingRaw
          : typeof acnHeadingRad === 'number' && Number.isFinite(acnHeadingRad)
            ? (((acnHeadingRad * 180) / Math.PI) % 360 + 360) % 360
            : 0;

      const probeAnalysis = evaluateCursorRfProbe(
        { xM: state.tbProbeSite.xM, yM: state.tbProbeSite.yM },
        mastM,
        [acnPos[0], acnPos[1], acnPos[2]],
        acnHeading,
        (x, y) => sampleDemSafe(simCtx.terrainEngine, x, y).elevationM || 3500,
        state.tbProbePinnedP1
      );
      state.tbCursorProbeLive = probeAnalysis;
      updateProbeUiReadouts(probeAnalysis);
    } else {
      state.tbViewshedResult = null;
      state.tbOrbitResult = null;
      state.tbViewshedNeedsMapLibreSync = true;
      state.tbCursorProbeLive = null;
      updateProbeUiReadouts(null);
    }

    const activeRegion =
      state.terrainRegions.find(r => r.id === state.tbSelectedRegionId) || state.terrainRegions[0] || null;
    let sweepTarget: Parameters<typeof computeAltitudeSweep>[1] | null = null;
    if (sweepKind === 'probe' && state.tbProbeSite) {
      sweepTarget = { kind: 'probe', xM: state.tbProbeSite.xM, yM: state.tbProbeSite.yM, aglM };
    } else if (sweepKind === 'region' && activeRegion) {
      sweepTarget = { kind: 'region', region: activeRegion };
    } else if (sweepKind === 'nodes') {
      sweepTarget = { kind: 'nodes' };
    }
    state.tbSweepResult = sweepTarget
      ? computeAltitudeSweep(simCtx, sweepTarget, { includeObstacles, nodeType })
      : null;

    renderMode1Provenance();
    renderToolboxDrawer();
    actions.updateMapLibreToolSources();
    actions.applyMapLibreLayerState();
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
  }

  function updateProbeHeatmapConfig(patch: Partial<ProbeHeatmapConfig>): void {
    state.tbProbeHeatmapConfig = { ...state.tbProbeHeatmapConfig, ...(patch || {}) };
    if (state.tbViewshedResult?.isSiteWithinCoverage) {
      state.tbViewshedCanvas = renderProbeHeatmapCanvas(
        state.tbViewshedResult,
        state.tbViewshedCanvas ?? undefined,
        320,
        state.tbProbeHeatmapConfig
      );
      state.tbViewshedNeedsMapLibreSync = true;
    }
    toolboxPrecisionUi?.sync({
      viewshedResult: state.tbViewshedResult,
      probeHeatmapConfig: state.tbProbeHeatmapConfig,
    });
    if (state.terrainMapMode === 'maplibre' && state.mapLibreInitialized) {
      actions.updateMapLibreToolSources();
      actions.applyMapLibreLayerState();
    } else {
      actions.drawRadar();
    }
  }

  function recomputeRegionZonal(): void {
    const activeRegion =
      state.terrainRegions.find(r => r.id === state.tbSelectedRegionId) ||
      state.terrainRegions[state.terrainRegions.length - 1] ||
      null;
    if (!activeRegion && !state.tbAoSwathBox) {
      state.tbZonalStats = null;
      state.tbRegionSummitResult = null;
      state.tbAoSwathReport = null;
      setText('tb-region-dimensions', '-- km × -- km | -- km @ --°');
      setText('tb-region-bounds', '--');
      setText('tb-region-area', '-- km²');
      setText('tb-region-summit', '-- m @ (--, --)');
      setText('tb-region-valley-floor', '-- m MSL (ΔZ -- m)');
      setText('tb-region-mean', '-- m');
      setText('tb-region-minmax', '-- / -- m');
      setText('tb-region-std', '-- m');
      setText('tb-region-ruggedness', 'TRI -- m / --°');
      setText('tb-region-los-pct', '--% (0/64)');
      setText('tb-region-sinr-stats', '-- dB | Dead-Zone --%');
      renderToolboxDrawer();
      refreshToolboxActionGates();
      return;
    }

    let minX: number, maxX: number, minY: number, maxY: number;
    if (state.tbAoSwathBox) {
      minX = Math.min(state.tbAoSwathBox.x1, state.tbAoSwathBox.x2);
      maxX = Math.max(state.tbAoSwathBox.x1, state.tbAoSwathBox.x2);
      minY = Math.min(state.tbAoSwathBox.y1, state.tbAoSwathBox.y2);
      maxY = Math.max(state.tbAoSwathBox.y1, state.tbAoSwathBox.y2);
    } else if (activeRegion) {
      minX = Infinity;
      maxX = -Infinity;
      minY = Infinity;
      maxY = -Infinity;
      for (const p of activeRegion.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      state.tbAoSwathBox = { x1: minX, y1: minY, x2: maxX, y2: maxY };
    } else {
      return;
    }

    const simCtx = buildToolboxSimContext();
    const acnPos = simCtx.acnPositionMslM || [0, 0, 5000];
    const acnHeadingRaw = state.latestTelemetry?.acn_heading_deg;
    const acnHeadingRad = state.latestTelemetry?.acn_telemetry?.heading_rad;
    const acnHeading =
      typeof acnHeadingRaw === 'number' && Number.isFinite(acnHeadingRaw)
        ? acnHeadingRaw
        : typeof acnHeadingRad === 'number' && Number.isFinite(acnHeadingRad)
          ? (((acnHeadingRad * 180) / Math.PI) % 360 + 360) % 360
          : 0;

    state.tbAoSwathReport = evaluateAoSwathAnalysis(
      minX,
      minY,
      maxX,
      maxY,
      acnPos,
      acnHeading,
      (x, y) => sampleDemSafe(simCtx.terrainEngine, x, y).elevationM || 3500,
      8
    );

    const rep = state.tbAoSwathReport;
    const summitGeo = cartesianToGeodetic(rep.summitPeak.xM, rep.summitPeak.yM);

    state.tbRegionSummitResult = {
      summitX: rep.summitPeak.xM,
      summitY: rep.summitPeak.yM,
      summitElevationM: rep.summitPeak.zMslM,
      minElevationM: rep.valleyFloor.zMslM,
      meanElevationM: rep.meanElevM,
      maxElevationM: rep.summitPeak.zMslM,
      terrainRuggednessIndexM: rep.triM,
      meanSlopeDeg: rep.meanSlopeDeg,
      losCoveragePct: rep.losCoveragePct,
      validSampleCount: rep.cells.length,
    };

    if (activeRegion) {
      const nodeType = $<HTMLSelectElement>('tb-transect-node-type')?.value === 'mcp' ? 'mcp' : 'soldier';
      state.tbZonalStats = analyzeRegionZonal(simCtx, activeRegion, { includeObstacles: true, nodeType });
    }

    setText(
      'tb-region-dimensions',
      `${rep.widthKm.toFixed(2)} km × ${rep.heightKm.toFixed(2)} km | ${rep.diagonalKm.toFixed(2)} km @ ${rep.diagonalAzimuthDeg.toFixed(1)}°`
    );
    setText(
      'tb-region-bounds',
      `[${(rep.minX / 1000).toFixed(1)}, ${(rep.minY / 1000).toFixed(1)}] to [${(rep.maxX / 1000).toFixed(1)}, ${(rep.maxY / 1000).toFixed(1)}] km`
    );
    setText('tb-region-area', `${rep.areaKm2.toFixed(2)} km²`);
    setText(
      'tb-region-summit',
      `${Math.round(rep.summitPeak.zMslM)} m @ (${summitGeo.latDeg.toFixed(3)}°N, ${summitGeo.lonDeg.toFixed(3)}°E)`
    );
    setText(
      'tb-region-valley-floor',
      `${Math.round(rep.valleyFloor.zMslM)} m MSL (Relief: ${Math.round(rep.reliefM)} m)`
    );
    setText('tb-region-mean', `${Math.round(rep.meanElevM)} m`);
    setText(
      'tb-region-minmax',
      `${Math.round(rep.valleyFloor.zMslM)} / ${Math.round(rep.summitPeak.zMslM)} m`
    );
    setText('tb-region-std', `σ ${rep.stdElevM.toFixed(1)} m | TRI ${rep.triM.toFixed(1)} m`);
    setText('tb-region-ruggedness', `TRI ${rep.triM.toFixed(1)} m · ${rep.meanSlopeDeg.toFixed(1)}°`);
    setText(
      'tb-region-los-pct',
      `${rep.losCoveragePct.toFixed(1)}% (${Math.round(rep.losCoveragePct * 0.64)}/64)`
    );
    setText(
      'tb-region-sinr-stats',
      `Mean ${rep.meanSinrDb.toFixed(1)} dB [${rep.minSinrDb.toFixed(1)} .. ${rep.maxSinrDb.toFixed(1)}] | Outage ${rep.deadZonePct.toFixed(1)}%`
    );

    refreshToolboxActionGates();
    renderMode1Provenance();
    renderToolboxDrawer();
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
  }

  function runBridgeFinder(): void {
    if (!state.tbBridgeA || !state.tbBridgeB) return;
    const simCtx = buildToolboxSimContext();
    const relayAglM = Math.max(1, Math.min(500, parseFloat($<HTMLInputElement>('tb-bridge-agl')?.value || '15') || 15));
    const activeRegion = state.terrainRegions.find(r => r.id === state.tbSelectedRegionId) || null;
    const nodeType = $<HTMLSelectElement>('tb-transect-node-type')?.value === 'mcp' ? 'mcp' : 'soldier';
    state.tbBridgeResult = findJointRelayBridge(
      simCtx,
      { xM: state.tbBridgeA.xM, yM: state.tbBridgeA.yM, aglM: 2, label: 'A' },
      { xM: state.tbBridgeB.xM, yM: state.tbBridgeB.yM, aglM: 2, label: 'B' },
      activeRegion,
      { relayAglM, includeObstacles: true, nodeType }
    );
    state.tbBridgeCanvas = renderBridgeHeatmapCanvas(state.tbBridgeResult, state.tbBridgeCanvas ?? undefined);
    state.tbBridgeNeedsMapLibreSync = true;
    setTerrainToolStatus(
      state.tbBridgeResult.optimalBridge
        ? `Bridge [RELAY] found (${state.tbBridgeResult.validCandidateCount} valid cells, bottleneck ${state.tbBridgeResult.optimalBridge.bottleneckSnrDb.toFixed(1)} dB).`
        : 'No mutually clear relay site found in search domain.'
    );
    renderToolboxDrawer();
    actions.updateMapLibreToolSources();
    actions.applyMapLibreLayerState();
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
  }

  function ensureBackdropCanvasSynced(): void {
    if (state.tbBackdropMode === 'relief') {
      state.tbBackdropCanvas = null;
      state.tbBackdropModeCached = 'relief';
      if (state.mapLibreTerrainRaster) actions.renderMapLibreTerrainRaster();
      else actions.applyMapLibreTerrainRaster();
      return;
    }
    if (state.tbSlopeRidgeVersion !== state.toolboxCacheVersion || !state.tbSlopeRidgeGrid) {
      state.tbSlopeRidgeGrid = computeSlopeAndRidgeGrid(mainTerrainEngine);
      state.tbSlopeRidgeVersion = state.toolboxCacheVersion;
    }
    if (
      state.tbBackdropModeCached !== state.tbBackdropMode ||
      state.tbBackdropVersionCached !== state.toolboxCacheVersion ||
      !state.tbBackdropCanvas
    ) {
      state.tbBackdropCanvas = renderSlopeOrRidgeBackdropCanvas(
        state.tbSlopeRidgeGrid,
        state.tbBackdropMode,
        state.tbBackdropCanvas ?? undefined
      );
      state.tbBackdropModeCached = state.tbBackdropMode;
      state.tbBackdropVersionCached = state.toolboxCacheVersion;
    }
    actions.applyMapLibreTerrainRaster();
  }

  function renderMode1Provenance(): void {
    const hasOutCov = Boolean(
      (state.tbTransectResult && !state.tbTransectResult.isCoverageComplete) ||
        (state.tbViewshedResult &&
          (!state.tbViewshedResult.isSiteWithinCoverage || state.tbViewshedResult.outOfCoveragePct > 0)) ||
        (state.tbZonalStats &&
          state.tbZonalStats.coverageCompletenessPct < 99.99 &&
          state.tbZonalStats.totalInteriorSamples > 0)
    );
    const prov = getDemProvenanceSummary(mainTerrainEngine, hasOutCov);
    const gridEl = $('tb-dem-provenance');
    if (gridEl) {
      gridEl.innerHTML = [
        ['Source', `${mapEscape(prov.tileName)} (${prov.terrainMode.toUpperCase()})`],
        ['Grid', `${prov.rasterWidth}×${prov.rasterHeight}`],
        ['Res', `${prov.groundResolutionXM.toFixed(1)} × ${prov.groundResolutionYM.toFixed(1)} m`],
        ['Elev', `${prov.minElevationM.toFixed(0)}–${prov.maxElevationM.toFixed(0)} m MSL`],
        ['Voids', `${prov.voidCount}`],
      ]
        .map(([k, v]) => `<span>${k}</span><span>${v}</span>`)
        .join('');
    }
    const alertEl = $('tb-outside-dem-badge');
    if (alertEl) alertEl.hidden = !prov.outsideCoverageWarning;
  }

  function recomputeActiveToolboxResults(): void {
    ensureBackdropCanvasSynced();
    renderMode1Provenance();
    if (state.tbTransectWaypoints.length >= 2) recomputeTransect(false);
    if (state.tbProbeSite) recomputeProbeAnalysis();
    if (state.terrainRegions.length > 0 && state.tbSelectedRegionId !== null) recomputeRegionZonal();
    if (state.tbBridgeA && state.tbBridgeB && state.tbBridgeResult) runBridgeFinder();
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
  }
  window.__onToolboxCacheInvalidated = recomputeActiveToolboxResults;

  function refreshToolboxActionGates(): void {
    const simCtx = buildToolboxSimContext();
    const canNode = canAddNodeFromToolbox(
      simCtx.groundNodes.length,
      simCtx.spatialLocked,
      simCtx.isHistoricalInspecting
    );
    const addRegBtn = $<HTMLButtonElement>('tb-region-add-node-btn');
    if (addRegBtn) addRegBtn.disabled = !canNode || !state.tbZonalStats?.bestRelayCoord;
    const addBrBtn = $<HTMLButtonElement>('tb-bridge-add-node-btn');
    if (addBrBtn) addBrBtn.disabled = !canNode || !state.tbBridgeResult?.optimalBridge;
    const applyWpBtn = $<HTMLButtonElement>('tb-apply-acn-waypoints-btn');
    if (applyWpBtn)
      applyWpBtn.disabled = !canApplyTransectAsAcnWaypoints(
        state.tbTransectWaypoints.length,
        simCtx.spatialLocked,
        simCtx.isHistoricalInspecting
      );
    const spawnProbeBtn = $<HTMLButtonElement>('tb-probe-spawn-node');
    if (spawnProbeBtn) spawnProbeBtn.disabled = !canNode || !state.tbProbeSite;
    const deploySquadBtn = $<HTMLButtonElement>('btn-region-deploy-squad');
    if (deploySquadBtn) deploySquadBtn.disabled = !canNode || !state.tbAoSwathReport?.squadDeployCoords;
    const spawnSummitBtn = $<HTMLButtonElement>('btn-region-spawn-summit-relay');
    if (spawnSummitBtn) spawnSummitBtn.disabled = !canNode || !state.tbAoSwathReport?.summitPeak;
    const finishPolyBtn = $<HTMLButtonElement>('tb-transect-finish-btn');
    if (finishPolyBtn)
      finishPolyBtn.disabled = !(state.terrainToolMode === 'transect-poly' && state.tbTransectWaypoints.length >= 2);
  }

  function renderToolboxDrawer(): void {
    const panel = $('terrain-toolbox-panel');
    const drawer = $('terrain-toolbox-drawer');
    const content = $('tb-drawer-content');
    if (!drawer || !content) return;
    const isPanelCollapsed = panel?.classList.contains('is-collapsed');
    if (isPanelCollapsed) {
      drawer.classList.add('is-collapsed');
      return;
    }

    let hasBody = false;
    if (state.tbActiveMode === 'transect' && state.tbTransectResult && state.tbTransectResult.valid) {
      hasBody = true;
      const res = state.tbTransectResult;
      const link = res.worstLinkStatus;
      const crest = res.dominantCrest;
      const spec = res.worstSpecular;
      const seg0 = res.segments[0];
      const rCritStr = !res.isCoverageComplete
        ? 'Out of coverage'
        : res.worstCriticalRainRateMmH === null
          ? seg0?.rainStatusReason === 'OBSTACLE_BLOCKED'
            ? 'Blocked by 3D obstacle'
            : 'N/A'
          : `${res.worstCriticalRainRateMmH.toFixed(1)} mm/h`;
      const kCrit = res.segments.find((s: { criticalKFactor: number | null }) => s.criticalKFactor !== null)?.criticalKFactor;
      const ladderHtml = (seg0?.rainSweep || [])
        .map((p: { isOutage: boolean; rainRateMmH: number; modcodName: string }) => `<span class="tb-chip ${p.isOutage ? 'is-vermilion' : 'is-sage'}">${p.rainRateMmH}mm:${p.modcodName.split(' ')[0]}</span>`)
        .join('');

      content.innerHTML = `
        <div class="tb-section-title">Transect RF Profile (${res.segments.length} seg · ${(res.totalHorizontalM / 1000).toFixed(2)} km)</div>
        ${!res.isCoverageComplete ? '<div class="outside-dem-alert">OUTSIDE DEM COVERAGE</div>' : ''}
        <div class="tb-canvas-box"><canvas id="tb-transect-canvas" width="280" height="135" style="height:135px"></canvas></div>
        <div id="tb-transect-hover-readout" class="terrain-toolbox-status">Hover profile or map line to inspect samples.</div>
        <div class="tb-kv-grid">
          <span>Worst Link</span><span>${link ? `${link.modcodName} · ${link.snrDb.toFixed(1)} dB (${link.bitrateMbps.toFixed(2)} Mbps)` : 'Unavailable'}</span>
          <span>Losses (FSPL/Diff/Rain)</span><span>${link ? `${link.fsplDb.toFixed(1)} / ${link.diffractionLossDb.toFixed(1)} / ${link.rainLossDb.toFixed(1)} dB` : '--'}</span>
          <span>Dominant Crest</span><span>${crest ? `${crest.latDeg.toFixed(4)}°, ${crest.lonDeg.toFixed(4)}° · ${crest.terrainMslM.toFixed(0)} m (ν=${crest.nu.toFixed(2)}, ${crest.fresnelIntrusionPct.toFixed(0)}% F₁)` : 'Clear'}</span>
          <span>Extra Height (Δh_B / Δh_uni)</span><span>+${res.minExtraHeightEndpointBM.toFixed(1)} m / +${res.minExtraHeightUniformM.toFixed(1)} m</span>
          <span>Specular Multipath</span><span>${spec ? `${spec.risk} (ΔL=${spec.excessPathM.toFixed(2)} m, ΔΦ=${(spec.phaseDeltaRad % (2 * Math.PI)).toFixed(2)} rad)` : 'N/A'}</span>
          <span>Critical k / Rain R_crit</span><span>${kCrit ? `k=${kCrit.toFixed(2)}` : 'Stable'} / ${rCritStr}</span>
        </div>
        <div class="tb-ladder">${ladderHtml}</div>
        <div class="terrain-toolbox-row">
          <button id="tb-open-terrain-rf-btn" type="button">Open in Terrain &amp; RF</button>
          <button id="tb-apply-acn-waypoints-btn" type="button">Apply as ACN Waypoints</button>
          <button id="tb-export-csv-btn" type="button">Export CSV</button>
        </div>`;

      const cvs = $<HTMLCanvasElement>('tb-transect-canvas');
      if (cvs) {
        renderTransectProfileCanvas(cvs, res, state.tbHoveredSampleIdx);
        cvs.addEventListener('mousemove', e => {
          const rect = cvs.getBoundingClientRect();
          const idx = transectCanvasXToSampleIndex(e.clientX - rect.left, rect.width || 280, state.tbTransectResult);
          if (idx !== state.tbHoveredSampleIdx) {
            state.tbHoveredSampleIdx = idx;
            updateToolboxTransectHoverUi();
            actions.updateMapLibreToolSources();
          }
        });
        cvs.addEventListener('mouseleave', () => {
          if (state.tbHoveredSampleIdx !== null) {
            state.tbHoveredSampleIdx = null;
            updateToolboxTransectHoverUi();
            actions.updateMapLibreToolSources();
          }
        });
      }
      $('tb-open-terrain-rf-btn')?.addEventListener('click', () => window.switchMainTab?.('tab-terrain'));
      $('tb-apply-acn-waypoints-btn')?.addEventListener('click', applyTransectAsAcnWaypoints);
      $('tb-export-csv-btn')?.addEventListener('click', () => {
        if (state.tbTransectResult)
          downloadTextBlob('transect-rf-profile.csv', exportTransectCsv(state.tbTransectResult), 'text/csv;charset=utf-8');
      });
    } else if (state.tbActiveMode === 'probe' && (state.tbViewshedResult || state.tbSweepResult)) {
      hasBody = true;
      const vs = state.tbViewshedResult;
      const ob = state.tbOrbitResult;
      const sw = state.tbSweepResult;
      content.innerHTML = `
        <div class="tb-section-title">Site Probe &amp; Altitude Sweep</div>
        ${
          vs
            ? `
          ${!vs.isSiteWithinCoverage || vs.outOfCoveragePct > 0 ? '<div class="outside-dem-alert">OUTSIDE DEM COVERAGE</div>' : ''}
          <div class="terrain-toolbox-row">
            <span class="tb-chip is-sage">Clear ${vs.clearPct.toFixed(1)}%</span>
            <span class="tb-chip is-ochre">Diff ${vs.diffractedPct.toFixed(1)}%</span>
            <span class="tb-chip is-vermilion">Shadow ${vs.shadowPct.toFixed(1)}%</span>
            <span class="tb-chip is-copper">Obs ${vs.obstacleBlockedPct.toFixed(1)}%</span>
          </div>
          <div class="tb-canvas-box"><canvas id="tb-polar-canvas" width="280" height="148" style="height:148px"></canvas></div>
        `
            : ''
        }
        ${
          ob && ob.valid
            ? `
          <div class="tb-kv-grid">
            <span>Orbit LOS (72 pts)</span><span>${ob.orbitLosPct.toFixed(1)}% (Peak Diff ${ob.peakDiffractionLossDb.toFixed(1)} dB)</span>
            <span>Orbit Mean SNR / Shadow</span><span>${ob.meanSnrDb !== null ? `${ob.meanSnrDb.toFixed(1)} dB` : '--'} / ${ob.longestShadowWindowS !== null ? `${ob.longestShadowWindowS.toFixed(1)} s` : 'Paused/0'}</span>
          </div>
        `
            : ''
        }
        ${
          sw
            ? `
          <div class="tb-canvas-box"><canvas id="tb-sweep-canvas" width="280" height="130" style="height:130px"></canvas></div>
          <div class="tb-kv-grid">
            <span>Min 100% Clear Alt</span><span>${sw.minClearAltitudeM !== null ? `${sw.minClearAltitudeM.toFixed(0)} m MSL` : 'None <= 9 km'}</span>
            <span>Optimal SNR Alt</span><span>${sw.optimalSnrAltitudeM !== null ? `${sw.optimalSnrAltitudeM.toFixed(0)} m MSL` : '--'}</span>
          </div>
        `
            : ''
        }`;
      const polarCvs = $<HTMLCanvasElement>('tb-polar-canvas');
      if (polarCvs && vs) renderPolarHorizonChart(polarCvs, vs);
      const sweepCvs = $<HTMLCanvasElement>('tb-sweep-canvas');
      if (sweepCvs && sw) renderAltitudeSweepChart(sweepCvs, sw);
    } else if (state.tbActiveMode === 'region' && (state.tbZonalStats || state.tbBridgeResult)) {
      hasBody = true;
      const z = state.tbZonalStats;
      const br = state.tbBridgeResult;
      const activeReg = state.terrainRegions.find(r => r.id === z?.regionId) || null;
      content.innerHTML = `
        ${
          z
            ? `
          <div class="tb-section-title">Region #${z.regionId} Zonal Stats (${z.areaKm2.toFixed(2)} km²)</div>
          ${z.coverageCompletenessPct < 99.99 ? '<div class="outside-dem-alert">PARTIAL / OUTSIDE DEM COVERAGE</div>' : ''}
          <div class="tb-kv-grid">
            <span>DEM Coverage</span><span>${z.coverageCompletenessPct.toFixed(1)}% (${z.validDemSamples}/${z.totalInteriorSamples})</span>
            <span>Elev (Min/Mean/Max)</span><span>${z.minElevationM !== null ? `${z.minElevationM.toFixed(0)} / ${z.meanElevationM.toFixed(0)} / ${z.maxElevationM.toFixed(0)} m` : '--'}</span>
            <span>Slope (Mean / P95)</span><span>${z.meanSlopeDeg !== null ? `${z.meanSlopeDeg.toFixed(1)}° / ${z.p95SlopeDeg.toFixed(1)}°` : '--'}</span>
            <span>ACN LOS / Med Diff</span><span>${z.losCoveragePct !== null ? `${z.losCoveragePct.toFixed(1)}%` : '--'} / ${z.medianDiffractionLossDb !== null ? `${z.medianDiffractionLossDb.toFixed(1)} dB` : '--'}</span>
            <span>Enclosed Nodes</span><span>${z.enclosedNodeCount}${z.enclosedMeanSnrDb !== null ? ` (Mean ${z.enclosedMeanSnrDb.toFixed(1)} dB)` : ''}</span>
            <span>Best Relay Site</span><span>${z.bestRelayCoord ? `${z.bestRelayCoord.latDeg.toFixed(4)}°, ${z.bestRelayCoord.lonDeg.toFixed(4)}° (${z.bestRelayCoord.snrDb.toFixed(1)} dB)` : 'None'}</span>
          </div>
          <div class="terrain-toolbox-row">
            <button id="tb-region-add-node-btn" type="button">Add Node Here</button>
            <button id="tb-export-geojson-btn" type="button">Export GeoJSON</button>
          </div>
        `
            : ''
        }
        ${
          br
            ? `
          <div class="tb-section-title">Joint Relay Bridge Finder</div>
          <div class="tb-kv-grid">
            <span>Valid Relay Cells</span><span>${br.validCandidateCount} / ${br.gridWidth * br.gridHeight}</span>
            <span>Optimal Bridge [RELAY]</span><span>${br.optimalBridge ? `${br.optimalBridge.latDeg.toFixed(4)}°, ${br.optimalBridge.lonDeg.toFixed(4)}° (${br.optimalBridge.elevationM.toFixed(0)} m)` : 'None'}</span>
            <span>Hop SNR (A / B / Min)</span><span>${br.optimalBridge ? `${br.optimalBridge.snrADb.toFixed(1)} / ${br.optimalBridge.snrBDb.toFixed(1)} / ${br.optimalBridge.bottleneckSnrDb.toFixed(1)} dB` : '--'}</span>
          </div>
          <div class="terrain-toolbox-row">
            <button id="tb-bridge-add-node-btn" type="button">Add Node at Bridge</button>
          </div>
        `
            : ''
        }`;

      $('tb-region-add-node-btn')?.addEventListener('click', () => {
        if (!z?.bestRelayCoord) return;
        addToolboxNodeAt(z.bestRelayCoord.xM, z.bestRelayCoord.yM, 2.0, `RELAY-${z.regionId}`);
      });
      $('tb-export-geojson-btn')?.addEventListener('click', () => {
        if (activeReg && z)
          downloadTextBlob(`region-${z.regionId}.geojson`, exportRegionGeoJson(activeReg, z), 'application/geo+json;charset=utf-8');
      });
      $('tb-bridge-add-node-btn')?.addEventListener('click', () => {
        if (!br?.optimalBridge) return;
        const agl = Math.max(1, Math.min(500, parseFloat($<HTMLInputElement>('tb-bridge-agl')?.value || '15') || 15));
        addToolboxNodeAt(br.optimalBridge.xM, br.optimalBridge.yM, agl, 'BRIDGE-RELAY');
      });
    }

    drawer.classList.toggle('is-collapsed', !hasBody);
    refreshToolboxActionGates();
    toolboxPrecisionUi?.sync({
      transectWaypoints: state.tbTransectWaypoints,
      rubberBandPoint: state.tbRubberBandPoint,
      rulerMetrics: state.tbRulerMetrics,
      rulerPreviewMetrics: state.tbRulerPreviewMetrics,
      rulerEvaluation: state.tbRulerEvaluation,
      rulerPreviewEval: state.tbRulerPreviewEval,
      cursorProbeLive: state.tbCursorProbeLive,
      viewshedResult: state.tbViewshedResult,
      probeHeatmapConfig: state.tbProbeHeatmapConfig,
      aoSwathReport: state.tbAoSwathReport,
      selectedObstacleHeightM:
        (obstacleEditor?.draft || []).find(o => o.id === state.tbObsSelectedId || o.id === obstacleEditor?.selectedId)
          ?.heightM ?? null,
      groundNodes: state.latestTelemetry?.nodes_telemetry,
    });
  }
  window.renderToolboxDrawer = renderToolboxDrawer;

  function addToolboxNodeAt(xM: number, yM: number, aglM: number, callsign: string, role = 'soldier'): void {
    const simCtx = buildToolboxSimContext();
    if (!canAddNodeFromToolbox(simCtx.groundNodes.length, simCtx.spatialLocked, simCtx.isHistoricalInspecting)) {
      setTerrainToolStatus(`Cannot add node (locked, historical, or at ${MAX_ACTIVE_GROUND_NODES} node limit).`);
      return;
    }
    actions.sendCommand(buildNodeAddCommand({ xM, yM, aglM, role: role === 'mcp' ? 'mcp' : 'soldier', callsign }));
    setTerrainToolStatus(`Deployed ${callsign} at (${Math.round(xM)}, ${Math.round(yM)}) m, AGL ${aglM.toFixed(1)} m.`);
  }

  function applyTransectAsAcnWaypoints(): void {
    const simCtx = buildToolboxSimContext();
    if (
      !canApplyTransectAsAcnWaypoints(
        state.tbTransectWaypoints.length,
        simCtx.spatialLocked,
        simCtx.isHistoricalInspecting
      )
    ) {
      setTerrainToolStatus('Need 3–16 transect points (and unlocked live simulation).');
      return;
    }
    const pts = state.tbTransectWaypoints.map(p => ({ x_m: p.xM, y_m: p.yM }));
    actions.sendCommand({
      type: 'CONFIG_UPDATE',
      params: {
        trajectory_mode: 'waypoints',
        waypoints: pts,
      },
    });
    setTerrainToolStatus(`Applied ${pts.length} transect vertices as ACN waypoints.`);
  }

  function finishTransectPolyline(): void {
    if (state.tbTransectWaypoints.length < 2) return;
    state.terrainToolMode = 'idle';
    state.tbRubberBandPoint = null;
    recomputeTransect(false);
    setTerrainToolStatus(`Polyline locked with ${state.tbTransectWaypoints.length} vertices.`);
    refreshTerrainToolbox();
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
  }

  function handleToolboxMapClick(point: { x: number; y: number; lng?: number; lat?: number }): boolean | void {
    if (state.terrainToolMode === 'transect-2pt' || state.terrainToolMode === 'measure') {
      if (state.tbTransectWaypoints.length >= 2 || state.tbTransectWaypoints.length === 0) {
        let clickPt = point;
        if (state.tbActiveSnap) {
          const geo = cartesianToGeodetic(state.tbActiveSnap.xM, state.tbActiveSnap.yM);
          clickPt = { x: state.tbActiveSnap.xM, y: state.tbActiveSnap.yM, lng: geo.lonDeg, lat: geo.latDeg };
        }
        state.tbTransectWaypoints = [{ xM: clickPt.x, yM: clickPt.y, lng: clickPt.lng, lat: clickPt.lat }];
        state.tbTransectResult = null;
        state.tbRulerMetrics = null;
        state.tbRulerEvaluation = null;
        state.tbRubberBandPoint = clickPt;
        state.tbActiveSnap = null;
        setTerrainToolStatus('Aiming Point B on map (Shift: 15° snap, 15px magnetic snap).');
      } else {
        let clickPt = point;
        if (state.tbActiveSnap) {
          const geo = cartesianToGeodetic(state.tbActiveSnap.xM, state.tbActiveSnap.yM);
          clickPt = { x: state.tbActiveSnap.xM, y: state.tbActiveSnap.yM, lng: geo.lonDeg, lat: geo.latDeg };
        } else if (state.isShiftKeyDown && state.tbTransectWaypoints.length === 1) {
          const wpA = state.tbTransectWaypoints[0];
          const [sX, sY] = snapPointToAngleIncrement(wpA.xM, wpA.yM, point.x, point.y, 15);
          const geo = cartesianToGeodetic(sX, sY);
          clickPt = { x: sX, y: sY, lng: geo.lonDeg, lat: geo.latDeg };
        }
        state.tbTransectWaypoints.push({ xM: clickPt.x, yM: clickPt.y, lng: clickPt.lng, lat: clickPt.lat });
        state.tbRubberBandPoint = null;
        state.tbActiveSnap = null;
        state.terrainToolMode = 'idle';
        recomputeTransect(false);
        updateStepGuideBanner();
        setTerrainToolStatus(`Transect A→B locked (${terrainDistanceText(state.tbTransectResult?.totalHorizontalM ?? 0)}).`);
      }
      refreshTerrainToolbox();
      actions.updateMapLibreToolSources();
      if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
      return;
    }
    if (state.terrainToolMode === 'transect-poly') {
      state.tbTransectWaypoints.push({ xM: point.x, yM: point.y, lng: point.lng, lat: point.lat });
      state.tbRubberBandPoint = point;
      if (state.tbTransectWaypoints.length >= 2) recomputeTransect(true);
      setTerrainToolStatus(`Polyline: ${state.tbTransectWaypoints.length} vertex(es). Double-click or click Done.`);
      refreshTerrainToolbox();
      actions.updateMapLibreToolSources();
      if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
      return;
    }
    if (state.terrainToolMode === 'region') {
      state.terrainRegionDraft.push(point);
      if (state.terrainRegionDraft.length >= 2) {
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (const p of state.terrainRegionDraft) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        state.tbAoSwathBox = { x1: minX, y1: minY, x2: maxX, y2: maxY };
        recomputeRegionZonal();
      }
      const liveArea = state.terrainRegionDraft.length >= 3 ? computePolygonAreaKm2(state.terrainRegionDraft) : 0;
      setText('tb-region-live-area', liveArea > 0 ? `Area: ${liveArea.toFixed(2)} km²` : 'Area: --');
      setTerrainToolStatus(
        `${state.terrainRegionDraft.length} point${state.terrainRegionDraft.length === 1 ? '' : 's'} selected. Finish at 3+.`
      );
      refreshTerrainToolbox();
      actions.updateMapLibreToolSources();
      if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
      return;
    }
    if (state.terrainToolMode === 'probe') {
      state.tbProbeSite = { xM: point.x, yM: point.y, lng: point.lng, lat: point.lat };
      state.terrainToolMode = 'idle';
      recomputeProbeAnalysis();
      if (state.tbCursorProbeLive) {
        state.tbProbePinnedP1 = state.tbCursorProbeLive;
      }
      setTerrainToolStatus(`Probe set & [P1] pinned at ${(point.lat ?? 0).toFixed(4)}°, ${(point.lng ?? 0).toFixed(4)}°.`);
      refreshTerrainToolbox();
      actions.updateMapLibreToolSources();
      if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
      return;
    }
    if (state.terrainToolMode === 'bridge-a') {
      state.tbBridgeA = { xM: point.x, yM: point.y, lng: point.lng, lat: point.lat };
      state.terrainToolMode = 'idle';
      setTerrainToolStatus('Bridge endpoint A set. Pick B or Find Bridge.');
      refreshTerrainToolbox();
      actions.updateMapLibreToolSources();
      if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
      return;
    }
    if (state.terrainToolMode === 'bridge-b') {
      state.tbBridgeB = { xM: point.x, yM: point.y, lng: point.lng, lat: point.lat };
      state.terrainToolMode = 'idle';
      setTerrainToolStatus('Bridge endpoint B set. Click Find Bridge.');
      refreshTerrainToolbox();
      actions.updateMapLibreToolSources();
      if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
      return;
    }
    if (state.terrainToolMode === 'obstacle-place') {
      const shapeMode = ($<HTMLSelectElement>('tb-obs-shape-select')?.value || 'wall') as ObstacleShapeMode;
      const preset = OBSTACLE_PRESETS[shapeMode] || OBSTACLE_PRESETS.wall;
      const shapeType = preset.shapeType;
      const baseHeight = preset.defaultHeightM;
      const baseWidth = preset.defaultWidthM;
      const baseDepth = preset.defaultDepthM;

      if (state.tbObstacleHistory) {
        state.tbObstacleHistory.pushState(obstacleEditor.draft);
      }

      try {
        obstacleEditor.create(shapeType, point.x, point.y);
        if (shapeType === 'cone') {
          obstacleEditor.updateSelected({ radiusM: baseWidth / 2, heightM: baseHeight });
        } else {
          obstacleEditor.updateSelected({
            widthM: baseWidth,
            depthM: baseDepth,
            heightM: baseHeight,
            rotationDeg: 0,
          });
        }
        setTerrainToolStatus(`Obstacle [${preset.label}] placed at (${Math.round(point.x)}, ${Math.round(point.y)}) m.`);
      } catch (err) {
        setTerrainToolStatus(`Could not place obstacle: ${err instanceof Error ? err.message : String(err)}`);
      }
      state.terrainToolMode = 'idle';
      actions.refreshObstacleEditor();
      actions.renderObstacleInventoryList();
      refreshTerrainToolbox();
      if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
      return;
    }
    getTerrainToolboxController().handleMapClick(point);
  }
  window.handleToolboxMapClick = handleToolboxMapClick;

  function finishTerrainRegion() {
    if (state.terrainRegionDraft.length < 3) {
      if (state.tbAoSwathBox) {
        setTerrainToolStatus('AO Swath locked.');
        state.terrainToolMode = 'idle';
        refreshTerrainToolbox();
        recomputeRegionZonal();
        if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
        return;
      }
      setTerrainToolStatus('A region needs at least three points.');
      return;
    }
    const newRegion = {
      id: state.nextTerrainRegionId++,
      points: state.terrainRegionDraft.map(point => ({ ...point })),
      color: '#f59e0b',
      visible: true,
    };
    state.terrainRegions.push(newRegion);
    state.tbSelectedRegionId = newRegion.id;
    state.terrainRegionDraft = [];
    state.terrainToolMode = 'idle';
    state.tbRubberBandPoint = null;
    setTerrainToolStatus(`Saved region #${newRegion.id} with ${newRegion.points.length} vertices.`);
    recomputeRegionZonal();
    refreshTerrainToolbox();
    actions.updateMapLibreToolSources();
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
    getTerrainToolboxController().finishTerrainRegion();
  }
  window.finishTerrainRegion = finishTerrainRegion;

  function cancelTerrainTool() {
    state.terrainToolMode = 'idle';
    state.terrainRegionDraft = [];
    state.tbRubberBandPoint = null;
    state.draggedToolboxVertex = null;
    state.mapLibreToolboxVertexDrag = null;
    state.tbLineHover = null;
    state.tbHoveredSampleIdx = null;
    state.tbAoSwathAnchor = null;
    state.tbDraggedAoCorner = null;
    state.tbObsDrawingAnchor = null;
    state.tbObsRubberBandPoint = null;
    $('tb-picking-bar')?.setAttribute('hidden', '');
    $('tb-picking-finish-btn')?.setAttribute('hidden', '');
    setTerrainToolStatus('Tool cancelled · Pointer in Navigate mode.');
    refreshTerrainToolbox();
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
    else {
      actions.updateMapLibreToolSources();
      actions.updateMapLibreOverlay();
    }
    getTerrainToolboxController().cancelTerrainTool();
  }
  window.cancelTerrainTool = cancelTerrainTool;

  function clearTerrainMeasurement() {
    state.tbTransectWaypoints = [];
    state.tbTransectResult = null;
    state.tbLineHover = null;
    state.tbHoveredSampleIdx = null;
    state.tbRubberBandPoint = null;
    state.tbRulerMetrics = null;
    state.tbRulerEvaluation = null;
    state.terrainToolMode = 'idle';
    setTerrainToolStatus('Measurements cleared.');
    renderToolboxDrawer();
    refreshTerrainToolbox();
    actions.updateMapLibreToolSources();
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
    getTerrainToolboxController().clearTerrainMeasurement();
  }
  window.clearTerrainMeasurement = clearTerrainMeasurement;

  function refreshTerrainToolbox() {
    const tbStack = $('terrain-toolbox-stack');
    const pickingBar = $('tb-picking-bar');
    const pickingLabel = $('tb-picking-label');
    const pickingFinishBtn = $<HTMLButtonElement>('tb-picking-finish-btn');
    const isPicking = state.terrainToolMode !== 'idle';
    if (tbStack) tbStack.setAttribute('data-tb-picking', isPicking ? 'true' : 'false');
    $('terrain-toolbox')?.setAttribute('data-tb-picking', isPicking ? 'true' : 'false');
    $('radar-container')?.setAttribute('data-tb-picking', isPicking ? 'true' : 'false');
    if (pickingBar) pickingBar.hidden = !isPicking;
    const mapActiveToolBar = $('map-active-tool-bar');
    if (mapActiveToolBar) {
      mapActiveToolBar.style.display = !state.tbOpen || isPicking ? 'none' : 'inline-flex';
    }
    updateStepGuideBanner();
    if (isPicking && pickingLabel) {
      if (state.terrainToolMode === 'transect-2pt' || state.terrainToolMode === 'measure') {
        pickingLabel.textContent =
          state.tbTransectWaypoints.length === 0 ? 'Click Point A on map…' : 'Click Point B on map…';
      } else if (state.terrainToolMode === 'transect-poly') {
        pickingLabel.textContent = `Polyline: ${state.tbTransectWaypoints.length} pt${state.tbTransectWaypoints.length === 1 ? '' : 's'} — click map`;
      } else if (state.terrainToolMode === 'probe') {
        pickingLabel.textContent = 'Click site on map for 360° probe…';
      } else if (state.terrainToolMode === 'region') {
        pickingLabel.textContent = `Region: ${state.terrainRegionDraft.length} pt${state.terrainRegionDraft.length === 1 ? '' : 's'} — click 3+`;
      } else if (state.terrainToolMode === 'bridge-a') {
        pickingLabel.textContent = 'Click Bridge Endpoint A on map…';
      } else if (state.terrainToolMode === 'bridge-b') {
        pickingLabel.textContent = 'Click Bridge Endpoint B on map…';
      } else if (state.terrainToolMode === 'obstacle-place') {
        pickingLabel.textContent = 'Click map to place obstacle preset…';
      } else {
        pickingLabel.textContent = 'Picking on map…';
      }
    }
    if (pickingFinishBtn) {
      if (state.terrainToolMode === 'transect-poly') {
        pickingFinishBtn.hidden = false;
        pickingFinishBtn.textContent = 'Done';
        pickingFinishBtn.disabled = state.tbTransectWaypoints.length < 2;
      } else if (state.terrainToolMode === 'region') {
        pickingFinishBtn.hidden = false;
        pickingFinishBtn.textContent = 'Finish';
        pickingFinishBtn.disabled = state.terrainRegionDraft.length < 3;
      } else {
        pickingFinishBtn.hidden = true;
      }
    }

    const list = $('terrain-toolbox-regions');
    if (list) {
      list.innerHTML = state.terrainRegions.length
        ? state.terrainRegions
            .map(
              region => `
        <div class="terrain-toolbox-region" data-region-id="${region.id}">
          <input type="checkbox" data-region-action="visibility" ${region.visible ? 'checked' : ''} title="Show or hide region">
          <input type="color" data-region-action="color" value="${region.color}" title="Change region colour">
          <button type="button" data-region-action="select" class="${region.id === state.tbSelectedRegionId ? 'active' : ''}">R${region.id} (${region.points.length})</button>
          <button type="button" data-region-action="delete" title="Delete region">×</button>
        </div>`
            )
            .join('')
        : '<div class="terrain-toolbox-status">No regions saved.</div>';
    }

    const twoPtBtn = $('terrain-measure-btn');
    const regionBtn = $('terrain-region-btn');
    const probeBtn = $('tb-probe-pick-btn');
    const obsBtn = $('tb-obs-place-btn');
    if (twoPtBtn)
      twoPtBtn.classList.toggle('active', state.terrainToolMode === 'transect-2pt' || state.terrainToolMode === 'measure');
    if (regionBtn) regionBtn.classList.toggle('active', state.terrainToolMode === 'region');
    if (probeBtn) probeBtn.classList.toggle('active', state.terrainToolMode === 'probe');
    if (obsBtn) obsBtn.classList.toggle('active', state.terrainToolMode === 'obstacle-place');

    window.terrainToolMode = state.terrainToolMode;
    getTerrainToolboxController().refreshTerrainToolbox();
  }
  window.refreshTerrainToolbox = refreshTerrainToolbox;

  function updateStepGuideBanner() {
    const banner = $('tb-step-guide-banner');
    if (banner) {
      if (state.tbActiveMode === 'transect') {
        banner.textContent =
          state.tbTransectWaypoints.length === 0
            ? 'Click A → B on map to measure distance and Line-of-Sight.'
            : state.tbTransectWaypoints.length === 1
              ? 'Point A placed · Click Point B to lock measurement.'
              : 'Measurement locked · Drag A or B on map to adjust.';
      } else if (state.tbActiveMode === 'probe') {
        banner.textContent = 'Click any spot to probe 8 GHz signal quality to aircraft.';
      } else if (state.tbActiveMode === 'region') {
        banner.textContent = 'Pick a quick scan size below, or Click corners · Dbl-click to finish.';
      } else if (state.tbActiveMode === 'obstacle') {
        banner.textContent = 'Click map to drop barrier, or select a ground node to block its link.';
      } else {
        banner.textContent = 'Switch terrain presets, change map shading, or pan and zoom freely.';
      }
    }
  }
  window.updateStepGuideBanner = updateStepGuideBanner;

  function setTerrainToolboxExpanded(expanded: boolean): void {
    state.tbOpen = Boolean(expanded);
    window.tbOpen = state.tbOpen;
    const tbStack = $('terrain-toolbox-stack');
    const rc = $('radar-container');
    tbStack?.setAttribute('data-tb-expanded', expanded ? 'true' : 'false');
    rc?.setAttribute('data-tb-expanded', expanded ? 'true' : 'false');
    const terrainToolbox = $('terrain-toolbox');
    const mapActiveToolBar = $('map-active-tool-bar');
    const toolboxPanel = $('terrain-toolbox-panel');
    const toolboxToggleBtn = $('terrain-toolbox-toggle-btn');

    if (expanded) {
      const cw = rc?.getBoundingClientRect().width || rc?.clientWidth || 0;
      state.mapLayersPanel?.setOpen(false);
      if (cw < 1100) {
        actions.dismissNodeInspector();
      }
      if (cw < 900) {
        const leg = document.querySelector('.map-legend');
        const lbtn = $('btn-legend-toggle');
        leg?.classList.add('is-collapsed');
        leg?.classList.remove('is-user-expanded');
        lbtn?.classList.remove('active');
        lbtn?.setAttribute('aria-pressed', 'false');
      }

      const detailViewport = document.querySelector('.detail-viewport');
      if (detailViewport) detailViewport.setAttribute('data-tb-open', 'true');
      document.querySelectorAll<HTMLElement>('.detail-viewport > .tab-content').forEach(el => {
        el.style.display = 'none';
      });

      if (terrainToolbox) terrainToolbox.style.display = 'flex';
      const isPicking = state.terrainToolMode !== 'idle';
      if (mapActiveToolBar) mapActiveToolBar.style.display = isPicking ? 'none' : 'inline-flex';

      toolboxPanel?.classList.remove('is-collapsed');
      toolboxToggleBtn?.classList.add('active');
      toolboxToggleBtn?.setAttribute('aria-expanded', 'true');
      setTbMode(state.tbActiveMode || 'dem', false);
      renderMode1Provenance();
      renderToolboxDrawer();
    } else {
      const detailViewport = document.querySelector('.detail-viewport');
      if (detailViewport) detailViewport.removeAttribute('data-tb-open');
      if (terrainToolbox) terrainToolbox.style.display = 'none';
      if (mapActiveToolBar) mapActiveToolBar.style.display = 'none';

      document.querySelectorAll<HTMLElement>('.detail-viewport > .tab-content').forEach(el => {
        el.style.display = '';
      });

      toolboxPanel?.classList.add('is-collapsed');
      $('terrain-toolbox-drawer')?.classList.add('is-collapsed');
      toolboxToggleBtn?.classList.remove('active');
      toolboxToggleBtn?.setAttribute('aria-expanded', 'false');
    }
    actions.syncFloatingOverlayLayout();
    getTerrainToolboxController().setExpanded(expanded);
  }
  window.setTerrainToolboxExpanded = setTerrainToolboxExpanded;

  function closeTerrainToolbox(): void {
    setTerrainToolboxExpanded(false);
    state.terrainToolMode = 'idle';
    state.tbRubberBandPoint = null;
    state.draggedToolboxVertex = null;
    state.mapLibreToolboxVertexDrag = null;
    state.tbLineHover = null;
    state.tbHoveredSampleIdx = null;
    state.tbAoSwathAnchor = null;
    state.tbDraggedAoCorner = null;
    state.tbObsDrawingAnchor = null;
    state.tbObsRubberBandPoint = null;
    const rc = $('radar-container');
    if (rc) {
      rc.removeAttribute('data-tb-picking');
    }
    const rCvs = $('radar-canvas');
    if (rCvs) rCvs.style.cursor = 'grab';
    $('tb-picking-bar')?.setAttribute('hidden', '');
    $('tb-picking-finish-btn')?.setAttribute('hidden', '');
    refreshTerrainToolbox();
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
    else {
      actions.updateMapLibreToolSources();
      actions.updateMapLibreOverlay();
    }
    getTerrainToolboxController().cancelTerrainTool();
  }
  window.closeTerrainToolbox = closeTerrainToolbox;

  window.openTerrainToolbox = function(mode = 'transect'): void {
    setTerrainToolboxExpanded(true);
    setTbMode(mode, true);
  };

  const setTbMode = (mode: string, autoArm = true): void => {
    state.tbActiveMode = mode;
    if (mode === 'transect') {
      state.terrainToolMode = 'transect-2pt';
      if (!autoArm) state.terrainToolMode = 'idle';
    } else if (mode === 'probe') {
      state.terrainToolMode = 'probe';
      if (!autoArm) state.terrainToolMode = 'idle';
    } else if (mode === 'region') {
      state.terrainToolMode = 'region';
      if (!autoArm) state.terrainToolMode = 'idle';
    } else if (mode === 'obstacle') {
      state.terrainToolMode = 'obstacle-place';
      if (!autoArm) state.terrainToolMode = 'idle';
      actions.recomputeCadObstacleAnalysis();
    } else {
      state.terrainToolMode = 'idle';
    }
    refreshTerrainToolbox();
    renderToolboxDrawer();
    if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
    else {
      actions.updateMapLibreToolSources();
      actions.updateMapLibreOverlay();
    }
    getTerrainToolboxController().setTbMode(mode as ToolboxMode, autoArm);
    updateStepGuideBanner();
  };
  window.setTbMode = setTbMode;

  function isEditableKeyboardTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof Element)) return false;
    return Boolean(target.closest('input, select, textarea, [contenteditable="true"], [contenteditable=""]'));
  }
  window.isEditableKeyboardTarget = isEditableKeyboardTarget;

  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditableKeyboardTarget(e.target)) return;
    const is3d =
      state.stageViewMode === '3d' ||
      (state.threeController && state.threeController.getViewMode?.() === '3d');
    if (is3d) return;
    const key = e.key;
    if (key === 'Escape') {
      if (state.terrainToolMode !== 'idle') {
        e.preventDefault();
        cancelTerrainTool();
        setTbMode('dem', false);
        setTerrainToolStatus('Pointer in Navigate mode.');
      } else if (state.tbOpen) {
        e.preventDefault();
        closeTerrainToolbox();
      }
      return;
    }
    if (key === 'Enter') {
      const { terrainRegionDraft } = state;
      if (state.terrainToolMode === 'region' && terrainRegionDraft.length >= 3) {
        e.preventDefault();
        finishTerrainRegion();
      } else if (state.terrainToolMode === 'transect-poly' && state.tbTransectWaypoints.length >= 2) {
        e.preventDefault();
        finishTransectPolyline();
      }
      return;
    }
    if (key === 'v') {
      e.preventDefault();
      cancelTerrainTool();
      setTbMode('dem', false);
      setTerrainToolStatus('Pointer in Navigate mode.');
      return;
    }
    if (key === 'r') {
      e.preventDefault();
      setTerrainToolboxExpanded(true);
      setTbMode('transect', true);
      return;
    }
    if (key === 'p') {
      e.preventDefault();
      setTerrainToolboxExpanded(true);
      setTbMode('probe', true);
      return;
    }
    if (key === 'a') {
      e.preventDefault();
      setTerrainToolboxExpanded(true);
      setTbMode('region', true);
      return;
    }
    if (key === 'b') {
      e.preventDefault();
      setTerrainToolboxExpanded(true);
      setTbMode('obstacle', true);
      return;
    }
    getTerrainToolboxController().handleKeydown(e);
  });

  function setupTerrainToolbox() {
    const toolboxToggleBtn = $('terrain-toolbox-toggle-btn');
    const toolboxCloseBtn = $('terrain-toolbox-close-btn');

    toolboxToggleBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      setTerrainToolboxExpanded(!state.tbOpen);
    });

    toolboxCloseBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      closeTerrainToolbox();
    });

    $('terrain-toolbox-close')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      closeTerrainToolbox();
    });

    $('tb-bar-exit')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      closeTerrainToolbox();
    });

    $('tb-bar-transect')?.addEventListener('click', () => {
      setTerrainToolboxExpanded(true);
      setTbMode('transect', true);
    });
    $('tb-bar-probe')?.addEventListener('click', () => {
      setTerrainToolboxExpanded(true);
      setTbMode('probe', true);
    });
    $('tb-bar-region')?.addEventListener('click', () => {
      setTerrainToolboxExpanded(true);
      setTbMode('region', true);
    });
    $('tb-bar-obstacle')?.addEventListener('click', () => {
      setTerrainToolboxExpanded(true);
      setTbMode('obstacle', true);
    });

    document.querySelectorAll('.tb-rail-btn[data-tb-rail-mode]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const targetMode = (btn as HTMLElement).dataset.tbRailMode;
        if (!targetMode) return;
        if (targetMode === 'dem') {
          cancelTerrainTool();
          setTbMode('dem', false);
          return;
        }
        setTerrainToolboxExpanded(true);
        setTbMode(targetMode, true);
      });
    });

    document.querySelectorAll('.tb-mode-tab[data-tb-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetMode = (btn as HTMLElement).dataset.tbMode;
        if (!targetMode) return;
        setTbMode(targetMode, targetMode !== 'dem');
      });
    });

    $('tb-picking-finish-btn')?.addEventListener('click', () => {
      if (state.terrainToolMode === 'transect-poly') finishTransectPolyline();
      else if (state.terrainToolMode === 'region') finishTerrainRegion();
    });
    $('tb-picking-cancel-btn')?.addEventListener('click', cancelTerrainTool);

    const btnToggleRulerTicks = $('btn-toggle-ruler-ticks');
    btnToggleRulerTicks?.addEventListener('click', () => {
      state.tbShowRulerTicks = !state.tbShowRulerTicks;
      btnToggleRulerTicks.setAttribute('aria-pressed', String(state.tbShowRulerTicks));
      btnToggleRulerTicks.textContent = state.tbShowRulerTicks
        ? 'Show Scale Divisions: ON'
        : 'Show Scale Divisions: OFF';
      // ITU-T2: tbShowRulerTicks gates kilometer scale division ticks along ruler shaft
      const dHorizM = state.tbRulerMetrics?.horizontalDistanceM ?? 0;
      if (state.tbShowRulerTicks && dHorizM > 500) {
        /* ruler shaft tick division gate */
      }
      if (state.terrainMapMode !== 'maplibre') actions.drawRadar();
      else actions.updateMapLibreOverlay();
    });

    getTerrainToolboxController().initDom();
    toolboxPrecisionUi = createToolboxPrecisionUi(
      createToolboxRuntimeBridge({
        cancelTerrainTool,
        setTbMode,
        setStatus: setTerrainToolStatus,
        refreshTerrainToolbox,
        finishTransectPolyline,
        clearTerrainMeasurement,
        finishTerrainRegion,
        recomputeTransect,
        recomputeProbeAnalysis,
        recomputeRegionZonal,
        runBridgeFinder,
        drawRadar: () => actions.drawRadar(),
        markRadarDirty: () => actions.markRadarDirty(),
        updateMapLibreToolSources: () => actions.updateMapLibreToolSources(),
        updateMapLibreOverlay: () => actions.updateMapLibreOverlay(),
        applyObstacleHistoryChange: (...a: Parameters<typeof actions.applyObstacleHistoryChange>) => actions.applyObstacleHistoryChange(...a),
        syncObstacleFieldMirror: (...a: Parameters<typeof actions.syncObstacleFieldMirror>) => actions.syncObstacleFieldMirror(...a),
        refreshObstacleEditor: (...a: Parameters<typeof actions.refreshObstacleEditor>) => actions.refreshObstacleEditor(...a),
        renderObstacleInventoryList: (...a: Parameters<typeof actions.renderObstacleInventoryList>) => actions.renderObstacleInventoryList(...a),
        recomputeCadObstacleAnalysis: (...a: Parameters<typeof actions.recomputeCadObstacleAnalysis>) => actions.recomputeCadObstacleAnalysis(...a),
        sendCommand: (...a: Parameters<typeof actions.sendCommand>) => actions.sendCommand(...a),
        addNodeAt: addToolboxNodeAt,
        getTerrainEngine: () => mainTerrainEngine,
        getLatestTelemetry: () => state.latestTelemetry,
        getTerrainMapMode: () => state.terrainMapMode,
        getObstacleEditor: () => obstacleEditor,
        getObstacleHistory: () => state.tbObstacleHistory,
        getObsSelectedId: () => state.tbObsSelectedId,
        setObsSelectedId: (id: string | null) => {
          state.tbObsSelectedId = id;
        },
        getCadObstacleReport: () => actions.getDashboardAndAuthoringController().getCadObstacleReport(),
        getPan: () => ({ x: state.panOffsetX_m, y: state.panOffsetY_m }),
        setPanAndRange: (x: number, y: number, r: number) => {
          state.panOffsetX_m = x;
          state.panOffsetY_m = y;
          actions.setRadarRange(r);
        },
        setBackdropMode: (m: string) => {
          if (m === 'relief' || m === 'slope' || m === 'ridge') {
            state.tbBackdropMode = m;
          }
          actions.markRadarDirty();
          actions.drawRadar();
        },
        setLayerVisibility: (id: string, v: boolean) => {
          mapLayerRegistry.setLayerVisible(id as MapLayerId, v);
          actions.applyMapLayersToAllRenderers();
        },
        setToolMode: (m: string) => {
          state.terrainToolMode = m;
        },
        setMeasureMode: (m: string) => {
          state.tbActiveMode = 'transect';
          state.terrainToolMode = m;
          state.tbTransectWaypoints = [];
          state.tbTransectResult = null;
          state.tbRulerMetrics = null;
          state.tbRulerEvaluation = null;
          state.tbRubberBandPoint = null;
          refreshTerrainToolbox();
          renderToolboxDrawer();
          actions.drawRadar();
        },
        getTransectWaypoints: () => state.tbTransectWaypoints,
        setTransectWaypoints: (w: any[]) => {
          state.tbTransectWaypoints = w;
        },
        getRulerEvaluation: () => state.tbRulerEvaluation,
        getProbeSite: () => state.tbProbeSite,
        setProbeSite: (s: any) => {
          state.tbProbeSite = s;
        },
        updateProbeHeatmapConfig,
        clearProbe: () => {
          state.tbProbeSite = null;
          state.tbCursorProbeLive = null;
          state.tbProbePinnedP1 = null;
          state.tbViewshedResult = null;
          state.tbViewshedCanvas = null;
          state.tbViewshedNeedsMapLibreSync = true;
          state.tbOrbitResult = null;
          state.tbSweepResult = null;
          updateProbeUiReadouts(null);
          renderToolboxDrawer();
          refreshTerrainToolbox();
        },
        startRegionDraw: () => {
          state.tbActiveMode = 'region';
          state.terrainToolMode = 'region';
          state.terrainRegionDraft = [];
          refreshTerrainToolbox();
        },
        setAoSwathBox: (b: any) => {
          state.tbAoSwathBox = b;
        },
        getAoSwathReport: () => state.tbAoSwathReport,
        clearBridge: () => {
          state.tbBridgeA = null;
          state.tbBridgeB = null;
          state.tbBridgeResult = null;
          renderToolboxDrawer();
          actions.drawRadar();
        },
        handleRegionListAction: (act: string, id: number, val?: unknown) => {
          const idx = state.terrainRegions.findIndex(r => r.id === id);
          if (idx < 0) return;
          if (act === 'delete') {
            state.terrainRegions.splice(idx, 1);
            if (state.tbSelectedRegionId === id) state.tbSelectedRegionId = state.terrainRegions[0]?.id ?? null;
          } else if (act === 'select') {
            state.tbSelectedRegionId = id;
          } else if (act === 'visibility') {
            state.terrainRegions[idx].visible = Boolean(val);
          } else if (act === 'color') {
            state.terrainRegions[idx].color = String(val);
          }
          recomputeRegionZonal();
          refreshTerrainToolbox();
          actions.drawRadar();
        },
        getWorkspaceSnapshot: () => ({
          activeMode: state.tbActiveMode,
          toolMode: state.terrainToolMode,
          stageViewMode: state.stageViewMode,
          radarRangeM: state.currentRadarRangeM,
          backdropMode: state.tbBackdropMode,
          transectWaypoints: state.tbTransectWaypoints,
          transectResult: state.tbTransectResult,
          rulerMetrics: state.tbRulerMetrics,
          rulerEvaluation: state.tbRulerEvaluation,
          probeSite: state.tbProbeSite,
          cursorProbeLive: state.tbCursorProbeLive,
          viewshedResult: state.tbViewshedResult,
          aoSwathBox: state.tbAoSwathBox,
          aoSwathReport: state.tbAoSwathReport,
        }),
        openToolboxInspector: (m: string) => {
          setTerrainToolboxExpanded(true);
          setTbMode(m, false);
        },
        applyDemQuickPreset: (id: string) => window.applyDemQuickPreset?.(id),
      })
    );
    toolboxPrecisionUi.mount();
  }

  Object.assign(actions, {
    getTerrainToolboxController,
    getRadarPointerWorld,
    terrainDistanceText,
    setTerrainToolStatus,
    downloadTextBlob,
    buildToolboxSimContext,
    findMagneticSnapTarget,
    recomputeTransect,
    recomputeRubberBandPreview,
    findNearestTransectSampleIndex,
    updateToolboxTransectHoverUi,
    updateProbeUiReadouts,
    recomputeProbeAnalysis,
    updateProbeHeatmapConfig,
    recomputeRegionZonal,
    runBridgeFinder,
    ensureBackdropCanvasSynced,
    renderMode1Provenance,
    recomputeActiveToolboxResults,
    refreshToolboxActionGates,
    renderToolboxDrawer,
    addToolboxNodeAt,
    applyTransectAsAcnWaypoints,
    finishTransectPolyline,
    handleToolboxMapClick,
    finishTerrainRegion,
    cancelTerrainTool,
    clearTerrainMeasurement,
    refreshTerrainToolbox,
    updateStepGuideBanner,
    setTerrainToolboxExpanded,
    closeTerrainToolbox,
    setTbMode,
    setupTerrainToolbox,
    syncToolboxPrecisionUi: (payload?: unknown) => toolboxPrecisionUi?.sync(payload as Record<string, unknown>),
  });
}
