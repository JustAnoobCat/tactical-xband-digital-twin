/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Strictly Typed Direct-Manipulation Terrain Toolbox Controller (SPEC-V3-10)
 *
 * Extracted from monolithic index.html into a modular, headless-testable,
 * strictly typed controller.
 *
 * Responsibilities:
 * 1. 1-Click auto-arm state transitions (setTbMode) across DEM, Transect, Probe, Region, Obstacle.
 * 2. Strict keyboard shortcut dispatching (V/R/P/A/B/Enter/Esc) with editable input guards.
 * 3. Interactive RF & Geospatial Analyses:
 *    - Tool #1: Geodetic & RF Transect profile evaluation & Fresnel clearance.
 *    - Tool #2: Cursor Signal Probe & candidate node RF link budgets.
 *    - Tool #3: Area of Operations (AO) Swath Coverage & Zonal terrain analysis.
 *    - Tool #4: CAD Precision Obstacle & Link Slicer barrier placement.
 * 4. XSS-safe toolbox drawer DOM rendering and action gates.
 */

import { escapeHtml, escapeAttr } from '../domSafety';
import { cartesianToGeodetic } from '../../core/geodesy';
import {
  evaluateTransect,
  computePolygonAreaKm2,
  analyzeRegionZonal,
  canAddNodeFromToolbox,
  canApplyTransectAsAcnWaypoints,
  exportTransectCsv,
  exportRegionGeoJson,
  computeSiteProbeViewshed,
  computeOrbitPersistence,
  computeAltitudeSweep,
  findJointRelayBridge,
  sampleDemSafe,
  getDemProvenanceSummary,
} from '../terrainToolboxAnalysis';
import {
  renderTransectProfileCanvas,
  renderPolarHorizonChart,
  renderAltitudeSweepChart,
  transectCanvasXToSampleIndex,
} from '../terrainToolboxCharts';
import { computeGeodeticRulerMetrics } from '../../core/geodeticRulerEngine';
import { evaluateCursorRfProbe } from '../../core/cursorProbeEngine';
import { evaluateAoSwathAnalysis } from '../../core/aoSwathScannerEngine';
import { evaluateBarrierLinkIntersections } from '../../core/cadObstacleSlicerEngine';
import {
  computeTransectRfMetrics,
  OBSTACLE_PRESETS,
} from '../terrainAnalysisController';
import { RFConfig, EnvironmentConfig } from '../../core/config';

// ============================================================================
// Types & Contracts
// ============================================================================

export type ToolboxMode = 'dem' | 'transect' | 'probe' | 'region' | 'obstacle';

export type TerrainToolMode =
  | 'idle'
  | 'transect-2pt'
  | 'transect-poly'
  | 'probe'
  | 'region'
  | 'obstacle-place'
  | 'measure'
  | 'bridge-a'
  | 'bridge-b';

export interface ToolboxPoint {
  readonly x: number;
  readonly y: number;
  readonly xM?: number;
  readonly yM?: number;
  readonly lng?: number;
  readonly lat?: number;
}

export interface ToolboxWaypoint {
  readonly xM: number;
  readonly yM: number;
  readonly lng?: number;
  readonly lat?: number;
  readonly label?: string;
  readonly snap?: any;
}

export interface TerrainRegion {
  readonly id: number;
  readonly name?: string;
  readonly color: string;
  readonly visible: boolean;
  readonly points: ReadonlyArray<ToolboxPoint>;
}

export interface TerrainToolboxControllerDeps {
  readonly documentRef?: Document;
  readonly windowRef?: Window;
  readonly getTelemetry: () => any;
  readonly getHistoricalSnapshot: () => any;
  readonly getTerrainEngine: () => any;
  readonly getObstacleEditor: () => any;
  readonly sendCommand: (msg: any) => void;
  readonly markRadarDirty: () => void;
  readonly drawRadar: () => void;
  readonly updateMapLibreToolSources?: () => void;
  readonly updateMapLibreOverlay?: () => void;
  readonly onStatusChange?: (statusText: string) => void;
  readonly onSwitchMainTab?: (tabId: string) => void;
}

// ============================================================================
// Pure Input Guards & Hotkey Resolvers
// ============================================================================

/**
 * Inspects event target to ensure keyboard shortcuts never trigger inside text fields.
 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as { closest?: (selector: string) => any };
  if (typeof el.closest !== 'function') return false;
  return Boolean(
    el.closest('input, select, textarea, [contenteditable="true"], [contenteditable=""]')
  );
}

/**
 * Resolves keyboard shortcut to corresponding toolbox action.
 * Bails on modifiers (Ctrl, Meta, Alt), editable targets, and 3D mode.
 */
export function resolveToolboxHotkeyAction(
  key: string,
  opts: {
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    isEditable?: boolean;
    is3d?: boolean;
  } = {}
): 'cancel' | 'finish' | 'mode_dem' | 'mode_transect' | 'mode_probe' | 'mode_region' | 'mode_obstacle' | null {
  if (opts.ctrlKey || opts.metaKey || opts.altKey) return null;
  if (opts.isEditable) return null;
  if (opts.is3d) return null;

  if (key === 'Escape') return 'cancel';
  if (key === 'Enter') return 'finish';

  const k = key.toLowerCase();
  if (k === 'v') return 'mode_dem';
  if (k === 'r') return 'mode_transect';
  if (k === 'p') return 'mode_probe';
  if (k === 'a') return 'mode_region';
  if (k === 'b') return 'mode_obstacle';

  return null;
}

// ============================================================================
// Factory: createTerrainToolboxController
// ============================================================================

export function createTerrainToolboxController(deps: TerrainToolboxControllerDeps) {
  const doc = deps.documentRef || (typeof document !== 'undefined' ? document : null);
  const win = deps.windowRef || (typeof window !== 'undefined' ? window : null);

  const $ = (id: string): HTMLElement | null => doc?.getElementById(id) || null;

  const setText = (id: string, text: string) => {
    const el = $(id);
    if (el) el.textContent = text;
  };

  const setStatus = (text: string) => {
    setText('terrain-toolbox-status', text);
    if (deps.onStatusChange) deps.onStatusChange(text);
  };

  // State Container
  let activeMode: ToolboxMode = 'dem';
  let toolMode: TerrainToolMode = 'idle';
  let isExpanded = false;

  let transectWaypoints: ToolboxWaypoint[] = [];
  let transectPolyDone = false;
  let transectResult: any = null;
  let hoveredSampleIdx: number | null = null;
  let rubberBandPoint: ToolboxPoint | null = null;
  let rulerMetrics: any = null;
  let rulerEvaluation: any = null;

  let probeSite: { xM: number; yM: number; lng: number; lat: number } | null = null;
  let probePinnedP1: any = null;
  let cursorProbeLive: any = null;
  let viewshedResult: any = null;
  let viewshedCanvas: HTMLCanvasElement | null = null;
  let orbitResult: any = null;
  let sweepResult: any = null;

  let aoSwathBox: { x1: number; y1: number; x2: number; y2: number } | null = {
    x1: -4000,
    y1: -3000,
    x2: 4000,
    y2: 3000,
  };
  let aoSwathReport: any = null;
  let zonalStats: any = null;
  let regionSummitResult: any = null;

  let terrainRegionDraft: ToolboxPoint[] = [];
  let terrainRegions: TerrainRegion[] = [];
  let nextRegionId = 1;
  let selectedRegionId: number | null = null;

  let bridgeA: ToolboxPoint | null = null;
  let bridgeB: ToolboxPoint | null = null;
  let bridgeResult: any = null;
  let bridgeCanvas: HTMLCanvasElement | null = null;

  let obsDrawingAnchor: ToolboxPoint | null = null;
  let obsRubberBandPoint: ToolboxPoint | null = null;
  let obsSelectedId: string | null = null;
  let cadObstacleReport: any = null;

  // --------------------------------------------------------------------------
  // Simulation Context Builder
  // --------------------------------------------------------------------------
  const buildSimContext = () => {
    const freqGhz = parseFloat(($('param-freq') as HTMLInputElement)?.value ?? '8.0');
    const bwMhz = parseFloat(($('param-bw') as HTMLInputElement)?.value ?? '1.0');
    const rainMmH = parseFloat(($('param-rain') as HTMLInputElement)?.value ?? '0.0');

    const rfConfig = new RFConfig({
      carrierFrequencyHz: (Number.isFinite(freqGhz) ? freqGhz : 8.0) * 1e9,
      channelBandwidthHz: Math.max(0.1, Math.min(50, Number.isFinite(bwMhz) ? bwMhz : 1.0)) * 1e6,
    });
    const envConfig = new EnvironmentConfig({
      rainRateMmH: Number.isFinite(rainMmH) ? rainMmH : 0.0,
    });

    const histSnap = deps.getHistoricalSnapshot();
    const isHist = Boolean(histSnap);
    const liveTelemetry = deps.getTelemetry();
    const liveAcn = liveTelemetry?.acn_telemetry || {};

    const acnX = Number(histSnap ? histSnap.acn.posX : liveAcn.pos_x);
    const acnY = Number(histSnap ? histSnap.acn.posY : liveAcn.pos_y);
    const acnZ = Number(histSnap ? histSnap.acn.altitudeMslM : (liveAcn.altitude_msl_m ?? liveAcn.pos_z ?? 5000));
    const acnPositionMslM: [number, number, number] | null = [acnX, acnY, acnZ].every(Number.isFinite)
      ? [acnX, acnY, acnZ] as [number, number, number]
      : null;

    const liveNodes = liveTelemetry?.nodes_telemetry || [];
    const liveById = new Map(liveNodes.map((n: any) => [n.node_id, n]));

    const groundNodes = histSnap
      ? histSnap.nodes.map((hn: any) => {
          const ln: any = liveById.get(hn.nodeId);
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
      : liveNodes.map((n: any) => ({
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
      terrainEngine: deps.getTerrainEngine(),
      rfConfig,
      envConfig,
      acnPositionMslM,
      trajectoryConfig: liveTelemetry?.trajectory_config ?? null,
      groundNodes,
      spatialRevision: 0,
      isHistoricalInspecting: isHist,
      spatialLocked: false,
    };
  };

  // --------------------------------------------------------------------------
  // Step Guide Banner Updater
  // --------------------------------------------------------------------------
  const updateStepGuideBanner = () => {
    const banner = $('tb-step-guide-banner');
    if (!banner) return;
    if (activeMode === 'transect') {
      if (transectWaypoints.length === 0) {
        banner.textContent = 'Click A → B on map to measure distance and Line-of-Sight.';
      } else if (transectWaypoints.length === 1) {
        banner.textContent = 'Point A placed · Click Point B to lock measurement.';
      } else {
        banner.textContent = 'Measurement locked · Drag A or B on map to adjust.';
      }
    } else if (activeMode === 'probe') {
      banner.textContent = 'Click any spot to probe 8 GHz signal quality to aircraft.';
    } else if (activeMode === 'region') {
      banner.textContent = 'Pick a quick scan size below, or Click corners · Dbl-click to finish.';
    } else if (activeMode === 'obstacle') {
      banner.textContent = 'Click map to drop barrier, or select a ground node to block its link.';
    } else {
      banner.textContent = 'Switch terrain presets, change map shading, or pan and zoom freely.';
    }
  };

  // --------------------------------------------------------------------------
  // Mode Management & 1-Click Auto-Arming
  // --------------------------------------------------------------------------
  const setTbMode = (mode: ToolboxMode, autoArm = true) => {
    activeMode = mode;
    const toolTitles: Record<ToolboxMode, string> = {
      transect: 'Measure Line & LoS',
      probe: 'Signal Probe & Spawn',
      region: 'Area Coverage Scan',
      obstacle: 'Build 3D Barrier',
      dem: 'DEM & Terrain Navigation',
    };

    const titleEl = $('tb-active-tool-title');
    if (titleEl) titleEl.textContent = toolTitles[mode] || 'Terrain Toolbox';

    doc?.querySelectorAll('.map-tool-pill-btn[data-map-tool]').forEach((b: any) => {
      b.classList.toggle('active', b.dataset.mapTool === mode);
    });
    doc?.querySelectorAll('.tb-mode-tab[data-tb-mode]').forEach((btn: any) => {
      const active = btn.dataset.tbMode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    doc?.querySelectorAll('.tb-rail-btn[data-tb-rail-mode]').forEach((btn: any) => {
      const active = btn.dataset.tbRailMode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    doc?.querySelectorAll('.tb-mode-pane[data-tb-pane]').forEach((pane: any) => {
      pane.hidden = pane.dataset.tbPane !== mode;
    });

    if (mode === 'dem') {
      toolMode = 'idle';
      rubberBandPoint = null;
      setStatus('Pointer in Navigate mode.');
    } else if (autoArm) {
      if (mode === 'transect') {
        toolMode = 'transect-2pt';
        transectWaypoints = [];
        transectResult = null;
        rubberBandPoint = null;
        setStatus('Ruler active: Click Point A on map.');
      } else if (mode === 'probe') {
        toolMode = 'probe';
        setStatus('Probe active: Click terrain to inspect.');
      } else if (mode === 'region') {
        toolMode = 'region';
        terrainRegionDraft = [];
        if (!aoSwathBox) {
          aoSwathBox = { x1: -4000, y1: -3000, x2: 4000, y2: 3000 };
        }
        recomputeRegionZonal();
        setStatus('Area active: Click corners · Dbl-click to finish.');
      } else if (mode === 'obstacle') {
        toolMode = 'obstacle-place';
        setStatus('Barrier active: Click map to place barrier.');
      }
    }

    updateStepGuideBanner();
    renderToolboxDrawer();
    refreshTerrainToolbox();
    if (deps.updateMapLibreToolSources) deps.updateMapLibreToolSources();
    deps.drawRadar();
  };

  // --------------------------------------------------------------------------
  // Interactive Calculations
  // --------------------------------------------------------------------------
  const recomputeTransect = (isPreview = false) => {
    if (transectWaypoints.length < 2) {
      transectResult = null;
      hoveredSampleIdx = null;
      rulerMetrics = null;
      rulerEvaluation = null;
      setText('tb-transect-fresnel', '-- m (100%)');
      setText('tb-transect-diffraction', '0.0 dB');
      setText('tb-transect-snr', '-- dB / --');
      renderToolboxDrawer();
      return;
    }

    const ctx = buildSimContext();
    const kFactor = parseFloat(($('tb-transect-k') as HTMLInputElement)?.value || String(4 / 3));
    const nodeType = ($('tb-transect-node-type') as HTMLInputElement)?.value === 'mcp' ? 'mcp' : 'soldier';
    const includeObstacles = isPreview ? false : Boolean(($('tb-transect-obstacles') as HTMLInputElement)?.checked ?? true);
    const rawTxMast = parseFloat(($('tb-transect-tx-mast') as HTMLInputElement)?.value ?? '');
    const rawRxMast = parseFloat(($('tb-transect-rx-mast') as HTMLInputElement)?.value ?? '');
    const txMastM = Number.isFinite(rawTxMast) && rawTxMast >= 0 ? Math.min(2000, rawTxMast) : 10;
    const rxMastM = Number.isFinite(rawRxMast) && rawRxMast >= 0 ? Math.min(2000, rawRxMast) : 2;

    const inputs = transectWaypoints.map((wp, idx) => ({
      xM: wp.xM,
      yM: wp.yM,
      aglM: idx === 0 ? txMastM : rxMastM,
      heightMode: 'ground_agl' as const,
    }));

    transectResult = evaluateTransect(ctx, inputs, {
      kFactor: Number.isFinite(kFactor) ? kFactor : 4 / 3,
      includeObstacles,
      nodeType,
      ...(isPreview ? { sampleCount: 64 } : {}),
    });

    if (transectResult && transectResult.samples && transectResult.samples.length >= 2) {
      const elevs = transectResult.samples.map((s: any) => s.terrainMslM);
      const rf = computeTransectRfMetrics(elevs, transectResult.totalHorizontalM, txMastM, rxMastM);
      setText('tb-transect-fresnel', `${rf.minF1ClearanceM.toFixed(1)} m (${Math.round(rf.minF1ClearancePct)}%)`);
      setText('tb-transect-diffraction', `${rf.p526DiffractionLossDb.toFixed(1)} dB`);
      setText('tb-transect-snr', `${rf.estSnrDb.toFixed(1)} dB / ${rf.estModcod}`);

      const safeElev = (x: number, y: number): number => {
        const e = sampleDemSafe(ctx.terrainEngine, x, y).elevationM;
        return Number.isFinite(e) ? e : 0;
      };
      const wpA = transectWaypoints[0];
      const wpB = transectWaypoints[1];
      const demA = safeElev(wpA.xM, wpA.yM);
      const demB = safeElev(wpB.xM, wpB.yM);

      rulerMetrics = computeGeodeticRulerMetrics(
        { xM: wpA.xM, yM: wpA.yM, groundElevationM: demA, mastHeightM: txMastM },
        { xM: wpB.xM, yM: wpB.yM, groundElevationM: demB, mastHeightM: rxMastM }
      );
    }
    renderToolboxDrawer();
  };

  const recomputeProbeAnalysis = () => {
    if (!probeSite) return;
    const ctx = buildSimContext();
    const acnPos = ctx.acnPositionMslM || [0, 0, 5000];
    const liveTelemetry = deps.getTelemetry();
    const acnHeading = Number.isFinite(liveTelemetry?.acn_heading_deg)
      ? liveTelemetry.acn_heading_deg
      : (Number.isFinite(liveTelemetry?.acn_telemetry?.heading_rad)
          ? ((liveTelemetry.acn_telemetry.heading_rad * 180 / Math.PI) % 360 + 360) % 360
          : 0);

    const aglRaw = parseFloat(($('tb-probe-agl') as HTMLInputElement)?.value ?? '');
    const aglM = Number.isFinite(aglRaw) && aglRaw >= 0 ? Math.min(500, aglRaw) : 2;
    const radiusRaw = parseFloat(($('tb-probe-radius') as HTMLInputElement)?.value ?? '');
    const radiusKm = Number.isFinite(radiusRaw) && radiusRaw >= 5 ? Math.min(60, radiusRaw) : 24;
    const targetMode = ($('tb-probe-target') as HTMLInputElement)?.value === 'acn_alt' ? 'acn_alt' : 'ground_agl';
    const includeObstacles = Boolean(($('tb-probe-obstacles') as HTMLInputElement)?.checked ?? true);
    const nodeType = ($('tb-transect-node-type') as HTMLInputElement)?.value === 'mcp' ? 'mcp' : 'soldier';
    const unitKind = ($('tb-probe-unit-select') as HTMLInputElement)?.value === 'mcp' ? 'mcp' : 'soldier';

    if (ctx.terrainEngine) {
      viewshedResult = computeSiteProbeViewshed(ctx, {
        xM: probeSite.xM,
        yM: probeSite.yM,
        observerAglM: aglM,
        radiusM: radiusKm * 1000,
        targetMode,
        targetAglM: 2.0,
        includeObstacles,
        txPowerDbm: unitKind === 'mcp' ? 40 : 30,
      });
      orbitResult = computeOrbitPersistence(ctx, probeSite.xM, probeSite.yM, aglM, includeObstacles, nodeType);
      sweepResult = computeAltitudeSweep(
        ctx,
        { kind: 'probe', xM: probeSite.xM, yM: probeSite.yM, aglM },
        { includeObstacles, nodeType }
      );
    }

    cursorProbeLive = evaluateCursorRfProbe(
      { xM: probeSite.xM, yM: probeSite.yM },
      aglM,
      acnPos,
      acnHeading,
      (x, y) => {
        const e = sampleDemSafe(ctx.terrainEngine, x, y).elevationM;
        return Number.isFinite(e) ? e : 0;
      },
      probePinnedP1
    );
    probePinnedP1 = cursorProbeLive;
    renderToolboxDrawer();
  };

  const recomputeRegionZonal = () => {
    if (!aoSwathBox) return;
    const ctx = buildSimContext();
    const minX = Math.min(aoSwathBox.x1, aoSwathBox.x2);
    const maxX = Math.max(aoSwathBox.x1, aoSwathBox.x2);
    const minY = Math.min(aoSwathBox.y1, aoSwathBox.y2);
    const maxY = Math.max(aoSwathBox.y1, aoSwathBox.y2);

    const acnPos = ctx.acnPositionMslM || [0, 0, 5000];
    const liveTelemetry = deps.getTelemetry();
    const acnHeading = Number.isFinite(liveTelemetry?.acn_heading_deg)
      ? liveTelemetry.acn_heading_deg
      : (Number.isFinite(liveTelemetry?.acn_telemetry?.heading_rad)
          ? ((liveTelemetry.acn_telemetry.heading_rad * 180 / Math.PI) % 360 + 360) % 360
          : 0);

    aoSwathReport = evaluateAoSwathAnalysis(
      minX, minY, maxX, maxY,
      acnPos,
      acnHeading,
      (x, y) => {
        const e = sampleDemSafe(ctx.terrainEngine, x, y).elevationM;
        return Number.isFinite(e) ? e : 0;
      },
      8
    );
    const rep = aoSwathReport;
    regionSummitResult = {
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

    const activeRegion = terrainRegions.find(r => r.id === selectedRegionId) || null;
    if (activeRegion) {
      zonalStats = analyzeRegionZonal(ctx, activeRegion, { includeObstacles: true, nodeType: 'soldier' });
    }
    renderToolboxDrawer();
  };

  const setBridgePoint = (slot: 'A' | 'B', pt: ToolboxPoint | null) => {
    if (slot === 'A') bridgeA = pt;
    else bridgeB = pt;
  };

  const runBridgeFinder = () => {
    const ptSourceA = bridgeA;
    const ptSourceB = bridgeB;
    if (!ptSourceA || !ptSourceB) return;
    const ctx = buildSimContext();
    const ptA = { xM: ptSourceA.xM ?? ptSourceA.x, yM: ptSourceA.yM ?? ptSourceA.y, aglM: 2, label: 'A' };
    const ptB = { xM: ptSourceB.xM ?? ptSourceB.x, yM: ptSourceB.yM ?? ptSourceB.y, aglM: 2, label: 'B' };
    const activeReg = terrainRegions.find(r => r.id === selectedRegionId) || null;
    bridgeResult = findJointRelayBridge(
      ctx,
      ptA,
      ptB,
      activeReg,
      { relayAglM: 15, includeObstacles: true, nodeType: 'soldier' }
    );
    renderToolboxDrawer();
  };

  // --------------------------------------------------------------------------
  // Drawer DOM Rendering (Strict XSS Safety)
  // --------------------------------------------------------------------------
  const renderToolboxDrawer = () => {
    const drawer = $('terrain-toolbox-drawer');
    const content = $('tb-drawer-content');
    if (!drawer || !content) return;

    if (!isExpanded) {
      drawer.classList.add('is-collapsed');
      return;
    }

    let hasBody = false;

    if (activeMode === 'transect' && transectResult && transectResult.valid) {
      hasBody = true;
      const res = transectResult;
      const link = res.worstLinkStatus;
      const crest = res.dominantCrest;

      content.innerHTML = `
        <div class="tb-section-title">Transect RF Profile (${res.segments.length} seg · ${(res.totalHorizontalM / 1000).toFixed(2)} km)</div>
        <div class="tb-canvas-box"><canvas id="tb-transect-canvas" width="280" height="135" style="height:135px"></canvas></div>
        <div class="tb-kv-grid">
          <span>Worst Link</span><span>${link ? `${escapeHtml(link.modcodName)} · ${link.snrDb.toFixed(1)} dB (${link.bitrateMbps.toFixed(2)} Mbps)` : 'Unavailable'}</span>
          <span>Losses (FSPL/Diff/Rain)</span><span>${link ? `${link.fsplDb.toFixed(1)} / ${link.diffractionLossDb.toFixed(1)} / ${link.rainLossDb.toFixed(1)} dB` : '--'}</span>
          <span>Dominant Crest</span><span>${crest ? `${crest.latDeg.toFixed(4)}°, ${crest.lonDeg.toFixed(4)}° · ${crest.terrainMslM.toFixed(0)} m` : 'Clear'}</span>
        </div>
        <div class="terrain-toolbox-row" style="margin-top:6px;">
          <button id="tb-open-terrain-rf-btn" type="button">Open in Terrain &amp; RF</button>
          <button id="tb-apply-acn-waypoints-btn" type="button">Apply as ACN Waypoints</button>
          <button id="tb-export-csv-btn" type="button">Export CSV</button>
        </div>`;

      const cvs = $('tb-transect-canvas') as HTMLCanvasElement;
      if (cvs) {
        renderTransectProfileCanvas(cvs, res, hoveredSampleIdx);
      }
      $('tb-open-terrain-rf-btn')?.addEventListener('click', () => {
        if (deps.onSwitchMainTab) deps.onSwitchMainTab('tab-terrain');
      });
      $('tb-apply-acn-waypoints-btn')?.addEventListener('click', applyTransectAsAcnWaypoints);
      $('tb-export-csv-btn')?.addEventListener('click', () => {
        if (transectResult && (win as any)?.downloadTextBlob) {
          (win as any).downloadTextBlob('transect-rf-profile.csv', exportTransectCsv(transectResult), 'text/csv;charset=utf-8');
        }
      });
    } else if (activeMode === 'probe') {
      hasBody = true;
      const p = cursorProbeLive;
      content.innerHTML = `
        <div class="tb-section-title">Site Probe &amp; Altitude Sweep</div>
        <div class="tb-canvas-box"><canvas id="tb-polar-canvas" width="280" height="148" style="height:148px"></canvas></div>
        <div class="tb-canvas-box"><canvas id="tb-sweep-canvas" width="280" height="130" style="height:130px"></canvas></div>
        <div class="tb-kv-grid">
          <span>Coordinates</span><span>${p?.latDeg?.toFixed(4) ?? '--'}°, ${p?.lonDeg?.toFixed(4) ?? '--'}°</span>
          <span>Elevation MSL</span><span>${p?.terrainMslM?.toFixed(0) ?? '--'} m</span>
          <span>ACN Direct Link</span><span>${p?.acnLink ? `${escapeHtml(p.acnLink.modcod)} · ${p.acnLink.snrDb.toFixed(1)} dB` : 'Out of Reach'}</span>
        </div>`;
      const polarCvs = $('tb-polar-canvas') as HTMLCanvasElement | null;
      if (polarCvs && viewshedResult) {
        renderPolarHorizonChart(polarCvs, viewshedResult);
      }
      const sweepCvs = $('tb-sweep-canvas') as HTMLCanvasElement | null;
      if (sweepCvs && sweepResult) {
        renderAltitudeSweepChart(sweepCvs, sweepResult);
      }
    } else if (activeMode === 'region') {
      hasBody = true;
      const z = zonalStats;
      content.innerHTML = `
        <div class="tb-section-title">AO Swath Zonal Stats (${z ? `${z.areaKm2.toFixed(2)} km²` : 'Region'})</div>
        <div class="tb-kv-grid">
          <span>Elevation (Min/Mean/Max)</span><span>${z?.minElevationM?.toFixed(0) ?? '--'} / ${z?.meanElevationM?.toFixed(0) ?? '--'} / ${z?.maxElevationM?.toFixed(0) ?? '--'} m</span>
          <span>Mean Slope</span><span>${z?.meanSlopeDeg?.toFixed(1) ?? '--'}°</span>
          <span>ACN Coverage</span><span>${z?.losCoveragePct?.toFixed(1) ?? '--'}%</span>
        </div>
        <div class="terrain-toolbox-row" style="margin-top:6px;">
          <button id="tb-export-geojson-btn" type="button">Export GeoJSON</button>
        </div>`;
      $('tb-export-geojson-btn')?.addEventListener('click', () => {
        const activeRegion = terrainRegions.find(r => r.id === selectedRegionId) || terrainRegions[terrainRegions.length - 1] || null;
        if (!activeRegion || !zonalStats) return;
        const te = deps.getTerrainEngine();
        const geoOrigin = te ?? deps.getTelemetry()?.biome_id;
        const payload = exportRegionGeoJson(activeRegion, zonalStats, geoOrigin);
        if ((win as any)?.downloadTextBlob) {
          (win as any).downloadTextBlob('terrain-region-zonal.geojson', payload, 'application/geo+json;charset=utf-8');
        } else if (doc) {
          const blob = new Blob([payload], { type: 'application/geo+json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = doc.createElement('a');
          a.href = url;
          a.download = 'terrain-region-zonal.geojson';
          a.click();
          URL.revokeObjectURL(url);
        }
      });
    }

    drawer.classList.toggle('is-collapsed', !hasBody);
  };

  const applyTransectAsAcnWaypoints = () => {
    const ctx = buildSimContext();
    if (!canApplyTransectAsAcnWaypoints(transectWaypoints.length, ctx.spatialLocked, ctx.isHistoricalInspecting)) {
      setStatus(`Need 3–16 transect points (and unlocked live simulation).`);
      return;
    }
    const pts = transectWaypoints.map(p => ({ x_m: p.xM, y_m: p.yM }));
    deps.sendCommand({
      type: 'CONFIG_UPDATE',
      params: {
        trajectory_mode: 'waypoints',
        waypoints: pts,
      },
    });
    setStatus(`Applied ${pts.length} transect vertices as ACN waypoints.`);
  };

  const cancelTerrainTool = () => {
    toolMode = 'idle';
    terrainRegionDraft = [];
    rubberBandPoint = null;
    setStatus('Tool cancelled · Pointer in Navigate mode.');
    refreshTerrainToolbox();
    deps.drawRadar();
  };

  const finishTerrainRegion = () => {
    if (terrainRegionDraft.length < 3) {
      if (aoSwathBox) {
        setStatus('AO Swath locked.');
        toolMode = 'idle';
        refreshTerrainToolbox();
        recomputeRegionZonal();
        deps.drawRadar();
        return;
      }
      setStatus('A region needs at least three points.');
      return;
    }
    const newRegion: TerrainRegion = {
      id: nextRegionId++,
      points: terrainRegionDraft.map(p => ({ ...p })),
      color: '#f59e0b',
      visible: true,
    };
    terrainRegions.push(newRegion);
    selectedRegionId = newRegion.id;
    terrainRegionDraft = [];
    toolMode = 'idle';
    setStatus(`Region R${newRegion.id} saved.`);
    recomputeRegionZonal();
    refreshTerrainToolbox();
    deps.drawRadar();
  };

  const finishTransectPolyline = () => {
    if (transectWaypoints.length < 2) {
      setStatus('Polyline transect needs at least 2 points.');
      return;
    }
    toolMode = 'idle';
    transectPolyDone = true;
    rubberBandPoint = null;
    recomputeTransect(false);
    setStatus(`Polyline transect ready (${transectWaypoints.length} vertices).`);
    refreshTerrainToolbox();
    deps.drawRadar();
  };

  const clearTerrainMeasurement = () => {
    transectWaypoints = [];
    transectResult = null;
    hoveredSampleIdx = null;
    rubberBandPoint = null;
    rulerMetrics = null;
    rulerEvaluation = null;
    toolMode = 'idle';
    setStatus('Measurements cleared.');
    renderToolboxDrawer();
    refreshTerrainToolbox();
    deps.drawRadar();
  };

  const refreshTerrainToolbox = () => {
    const authoritativeMode =
      win && typeof (win as any).terrainToolMode === 'string'
        ? ((win as any).terrainToolMode as TerrainToolMode)
        : toolMode;
    toolMode = authoritativeMode;
    const isPicking = authoritativeMode !== 'idle';
    const tbStack = $('terrain-toolbox-stack');
    const container = $('radar-container');
    const terrainToolbox = $('terrain-toolbox');
    const pickingBar = $('tb-picking-bar');

    tbStack?.setAttribute('data-tb-picking', isPicking ? 'true' : 'false');
    container?.setAttribute('data-tb-picking', isPicking ? 'true' : 'false');
    terrainToolbox?.setAttribute('data-tb-picking', isPicking ? 'true' : 'false');
    if (pickingBar) (pickingBar as HTMLElement).hidden = !isPicking;

    const twoPtBtn = $('terrain-measure-btn');
    const regionBtn = $('terrain-region-btn');
    const probeBtn = $('tb-probe-pick-btn');
    const obsBtn = $('tb-obs-place-btn');

    if (twoPtBtn) twoPtBtn.classList.toggle('active', authoritativeMode === 'transect-2pt' || authoritativeMode === 'measure');
    if (regionBtn) regionBtn.classList.toggle('active', authoritativeMode === 'region');
    if (probeBtn) probeBtn.classList.toggle('active', authoritativeMode === 'probe');
    if (obsBtn) obsBtn.classList.toggle('active', authoritativeMode === 'obstacle-place');
  };

  const setExpanded = (expanded: boolean) => {
    isExpanded = expanded;
    const panel = $('terrain-toolbox-panel');
    const drawer = $('terrain-toolbox-drawer');
    if (panel) panel.classList.toggle('is-collapsed', !expanded);
    if (drawer) drawer.classList.toggle('is-collapsed', !expanded);
    renderToolboxDrawer();
  };

  const handleKeydown = (e: KeyboardEvent): boolean => {
    const is3d = $('radar-stage')?.getAttribute('data-map-renderer') === '3d';
    const action = resolveToolboxHotkeyAction(e.key, {
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      isEditable: isEditableKeyboardTarget(e.target),
      is3d,
    });

    if (!action) return false;

    if (action === 'cancel') {
      if (toolMode !== 'idle') {
        e.preventDefault();
        if (win && typeof (win as any).cancelTerrainTool === 'function') (win as any).cancelTerrainTool();
        else cancelTerrainTool();
        if (win && typeof (win as any).setTbMode === 'function') (win as any).setTbMode('dem', false);
        else setTbMode('dem', false);
      } else if (isExpanded) {
        e.preventDefault();
        if (win && typeof (win as any).closeTerrainToolbox === 'function') (win as any).closeTerrainToolbox();
        else setExpanded(false);
      }
      return true;
    }

    if (action === 'finish') {
      if (toolMode === 'region' && terrainRegionDraft.length >= 3) {
        e.preventDefault();
        if (win && typeof (win as any).finishTerrainRegion === 'function') (win as any).finishTerrainRegion();
        else finishTerrainRegion();
        return true;
      }
      if (toolMode === 'transect-poly' && transectWaypoints.length >= 2) {
        e.preventDefault();
        if (win && typeof (win as any).finishTransectPolyline === 'function') (win as any).finishTransectPolyline();
        else finishTransectPolyline();
        return true;
      }
      return false;
    }

    if (action === 'mode_dem') {
      e.preventDefault();
      if (win && typeof (win as any).cancelTerrainTool === 'function') (win as any).cancelTerrainTool();
      else cancelTerrainTool();
      if (win && typeof (win as any).setTbMode === 'function') (win as any).setTbMode('dem', false);
      else setTbMode('dem', false);
      return true;
    }

    if (action === 'mode_transect') {
      e.preventDefault();
      if (win && typeof (win as any).setTerrainToolboxExpanded === 'function') (win as any).setTerrainToolboxExpanded(true);
      else setExpanded(true);
      if (win && typeof (win as any).setTbMode === 'function') (win as any).setTbMode('transect', true);
      else setTbMode('transect', true);
      return true;
    }

    if (action === 'mode_probe') {
      e.preventDefault();
      if (win && typeof (win as any).setTerrainToolboxExpanded === 'function') (win as any).setTerrainToolboxExpanded(true);
      else setExpanded(true);
      if (win && typeof (win as any).setTbMode === 'function') (win as any).setTbMode('probe', true);
      else setTbMode('probe', true);
      return true;
    }

    if (action === 'mode_region') {
      e.preventDefault();
      if (win && typeof (win as any).setTerrainToolboxExpanded === 'function') (win as any).setTerrainToolboxExpanded(true);
      else setExpanded(true);
      if (win && typeof (win as any).setTbMode === 'function') (win as any).setTbMode('region', true);
      else setTbMode('region', true);
      return true;
    }

    if (action === 'mode_obstacle') {
      e.preventDefault();
      if (win && typeof (win as any).setTerrainToolboxExpanded === 'function') (win as any).setTerrainToolboxExpanded(true);
      else setExpanded(true);
      if (win && typeof (win as any).setTbMode === 'function') (win as any).setTbMode('obstacle', true);
      else setTbMode('obstacle', true);
      return true;
    }

    return false;
  };

  const handleMapClick = (pt: ToolboxPoint) => {
    if (toolMode === 'transect-2pt' || toolMode === 'measure') {
      if (transectWaypoints.length >= 2 || transectWaypoints.length === 0) {
        transectWaypoints = [{ xM: pt.x, yM: pt.y, lng: pt.lng, lat: pt.lat }];
        transectResult = null;
        rubberBandPoint = pt;
        setStatus('Point A set. Click Point B on map.');
      } else {
        transectWaypoints.push({ xM: pt.x, yM: pt.y, lng: pt.lng, lat: pt.lat });
        rubberBandPoint = null;
        toolMode = 'idle';
        recomputeTransect(false);
        setStatus(`Transect A->B locked.`);
      }
      refreshTerrainToolbox();
      deps.drawRadar();
      return;
    }

    if (toolMode === 'probe') {
      const te = deps.getTerrainEngine();
      const geo = typeof te?.worldToLatLon === 'function'
        ? te.worldToLatLon(pt.x, pt.y)
        : cartesianToGeodetic(pt.x, pt.y);
      probeSite = { xM: pt.x, yM: pt.y, lng: geo.lonDeg, lat: geo.latDeg };
      toolMode = 'idle';
      recomputeProbeAnalysis();
      setStatus(`Probe set at ${geo.latDeg.toFixed(4)}°, ${geo.lonDeg.toFixed(4)}°.`);
      refreshTerrainToolbox();
      deps.drawRadar();
      return;
    }

    if (toolMode === 'region') {
      terrainRegionDraft.push(pt);
      if (terrainRegionDraft.length >= 2) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of terrainRegionDraft) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        aoSwathBox = { x1: minX, y1: minY, x2: maxX, y2: maxY };
        recomputeRegionZonal();
      }
      setStatus(`${terrainRegionDraft.length} point(s) in region. Double-click or Enter to finish.`);
      refreshTerrainToolbox();
      deps.drawRadar();
      return;
    }

    if (toolMode === 'bridge-a') {
      bridgeA = pt;
      toolMode = 'idle';
      setStatus('Bridge endpoint A set. Pick B or run Bridge Finder.');
      if (bridgeA && bridgeB) runBridgeFinder();
      refreshTerrainToolbox();
      deps.drawRadar();
      return;
    }

    if (toolMode === 'bridge-b') {
      bridgeB = pt;
      toolMode = 'idle';
      setStatus('Bridge endpoint B set. Computing joint relay bridge.');
      if (bridgeA && bridgeB) runBridgeFinder();
      refreshTerrainToolbox();
      deps.drawRadar();
      return;
    }

    if (toolMode === 'obstacle-place') {
      const editor = deps.getObstacleEditor();
      if (editor) {
        try {
          editor.create('wall', pt.x, pt.y);
          setStatus(`Obstacle barrier placed at (${Math.round(pt.x)}, ${Math.round(pt.y)}) m.`);
        } catch (err: any) {
          setStatus(`Could not place obstacle: ${err?.message || err}`);
        }
      }
      toolMode = 'idle';
      refreshTerrainToolbox();
      deps.drawRadar();
      return;
    }
  };

  const initDom = () => {
    // Mode tabs
    doc?.querySelectorAll('.tb-mode-tab[data-tb-mode]').forEach((btn: any) => {
      btn.addEventListener('click', () => {
        const targetMode = btn.dataset.tbMode as ToolboxMode;
        setTbMode(targetMode, targetMode !== 'dem');
      });
    });

    // Icon rail buttons
    doc?.querySelectorAll('.tb-rail-btn[data-tb-rail-mode]').forEach((btn: any) => {
      btn.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const targetMode = btn.dataset.tbRailMode as ToolboxMode;
        if (targetMode === 'dem') {
          cancelTerrainTool();
          setTbMode('dem', false);
          return;
        }
        setExpanded(true);
        setTbMode(targetMode, true);
      });
    });

    // Global Keydown
    win?.addEventListener('keydown', handleKeydown);
  };

  return {
    setTbMode,
    getTbMode: () => activeMode,
    getTerrainToolMode: () => toolMode,
    getState: () => ({
      activeMode,
      toolMode,
      isExpanded,
      transectWaypoints,
      transectResult,
      rulerMetrics,
      rulerEvaluation,
      probeSite,
      probePinnedP1,
      cursorProbeLive,
      aoSwathBox,
      aoSwathReport,
      zonalStats,
      regionSummitResult,
      terrainRegions,
      terrainRegionDraft,
      selectedRegionId,
      rubberBandPoint,
      cadObstacleReport,
      obsDrawingAnchor,
      obsRubberBandPoint,
      obsSelectedId,
    }),
    handleKeydown,
    handleMapClick,
    recomputeTransect,
    recomputeProbeAnalysis,
    recomputeRegionZonal,
    setBridgePoint,
    runBridgeFinder,
    renderToolboxDrawer,
    cancelTerrainTool,
    finishTerrainRegion,
    finishTransectPolyline,
    clearTerrainMeasurement,
    refreshTerrainToolbox,
    updateStepGuideBanner,
    setExpanded,
    isExpanded: () => isExpanded,
    initDom,
  };
}
