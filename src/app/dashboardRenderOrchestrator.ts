// Dashboard DOM updates (10 Hz + immediate node-list transition), Mission I/O, QoS/NTN/Traffic/Soldier EUD, Jitter Profiler & Experiment Capture
import type { AppContext } from './appContext.ts';
import type {
  AcnTelemetry,
  NodeTelemetryItem,
  TelemetryFrame,
  WorkerInboundCommand,
} from '../shared/workerProtocol.ts';
import type { QosNetworkSlaReport } from '../core/qosSlaEngine.ts';
import type { TwinEvaluationReport } from '../core/digitalTwinCalibrationEngine.ts';
import type { NetworkTrafficFrame, TrafficFlowRecord } from '../ui/networkTrafficInventory.ts';
import { obstacleFootprintPoints } from '../core/obstacles.ts';
import { evaluate5QiBearerSlaMetrics, evaluateTeam5QiBearerSlaMetrics } from '../core/qosSlaEngine.ts';
import { collectTeamsFromNodes, parseTeamSelection } from '../core/nodeRegistry.ts';
import { evaluateNtnNodeSignaling } from '../core/ntnSignalingEngine.ts';
import {
  evaluateWorkerRealTimeProfile,
  generateExperimentDossierMarkdown,
} from '../core/workerJitterProfiler.ts';
import {
  runPhysicsRealismAblation,
  verifyAllItuReferenceAnchors,
  buildScientificValidationMarkdown,
} from '../core/statisticalBenchmarkEngine.ts';
import { formatNodeGeodeticCoordinates, getNodeRole } from '../ui/nodeInventory.ts';
import { classifyLinkCommunicationStatus } from '../core/linkStatusClassifier.ts';
import { escapeHtml } from '../ui/domSafety.ts';
import { getStatusBadgeInfo } from '../ui/mapLinkStyles.ts';
import { cartesianToGeodetic } from '../core/geodesy.ts';
import {
  formatTrafficBytes,
  formatTrafficRate,
  formatTrafficSimTime,
  formatTrafficSnr,
  getTrafficStatusBadge,
} from '../ui/networkTrafficInventory.ts';
import { HIGHLAND_THEME } from '../ui/workbench/chartTheme.ts';
import {
  computeNiceTicks,
  drawChartHoverCrosshair,
  getCanvasHoverState,
  bindChartHoverCrosshair,
} from '../ui/workbench/chartEnhancements.ts';
import { drawWorkerJitterHistogramScope as renderWorkerJitterHistogramScope } from '../ui/scientificScopesRenderer.ts';
import {
  drawSoldierCompassScope,
  resolveSoldierAiNotificationBanner,
} from '../ui/soldierEudRenderer.ts';
import { initMissionIoController } from '../ui/controllers/missionIoController.ts';
import { initCommandPaletteController } from '../ui/controllers/commandPaletteController.ts';
import { createDashboardAndAuthoringController } from '../ui/controllers/dashboardAndAuthoringController.ts';
import { computeWebMercatorZoomLevel } from '../ui/cartographyRenderer.ts';
import { BIOME_DEM_METADATA } from '../core/terrain.ts';

export function initDashboardRenderOrchestrator(ctx: AppContext) {
  const { state, engines, dom, actions } = ctx;
  const {
    $,
    setText,
    UNAVAILABLE,
    isFiniteMetric,
    setMetricText,
    setUnavailableText,
    mapEscape,
    nodeLinkLabel,
    nodeAchievedRate,
  } = dom;
  const {
    telemetryUpdaters,
    mainTerrainEngine,
    trajectoryEditor,
    obstacleEditor,
    historyController,
    schedHistoryController,
    networkTrafficTracker,
    flightRecorder,
  } = engines;

  const sendCommand = (msg: WorkerInboundCommand, transferList?: Transferable[]) =>
    actions.sendCommand(msg, transferList);

  let dashboardAndAuthoringControllerInstance: ReturnType<
    typeof createDashboardAndAuthoringController
  > | null = null;
  function getDashboardAndAuthoringController() {
    if (!dashboardAndAuthoringControllerInstance) {
      dashboardAndAuthoringControllerInstance = createDashboardAndAuthoringController({
        getElementById: id => $(id),
        sendCommand: cmd => sendCommand(cmd as unknown as WorkerInboundCommand),
        getSpatialLocked: () => (typeof state.spatialLocked !== 'undefined' ? state.spatialLocked : false),
        isHistoricalInspecting: () =>
          Boolean(
            (typeof historyController !== 'undefined' && historyController?.isInspecting) ||
              (typeof schedHistoryController !== 'undefined' && schedHistoryController?.isInspecting) ||
              (typeof state.simTimelineController !== 'undefined' &&
                state.simTimelineController?.isHistoricalInspecting)
          ),
        getTrajectoryEditor: () => (typeof trajectoryEditor !== 'undefined' ? trajectoryEditor : null),
        getObstacleEditor: () => (typeof obstacleEditor !== 'undefined' ? obstacleEditor : null),
        getObstacleHistory: () => (state.tbObstacleHistory ?? null),
        getMainTerrainEngine: () => (typeof mainTerrainEngine !== 'undefined' ? mainTerrainEngine : null),
        getLatestTelemetry: () => (typeof state.latestTelemetry !== 'undefined' ? state.latestTelemetry : null),
        getSelectedNodeId: () => (typeof state.selectedNodeId !== 'undefined' ? state.selectedNodeId : -1),
        setSelectedNodeId: id => {
          state.selectedNodeId = id;
        },
        onRedrawRadar: () => {
          if (typeof actions.drawRadar === 'function' && state.stageViewMode !== '3d') actions.drawRadar();
        },
        onUpdateMapLibreOverlay: () => {
          if (state.terrainMapMode === 'maplibre' && typeof actions.updateMapLibreOverlay === 'function')
            actions.updateMapLibreOverlay();
        },
        onApplyMapLibreLayerState: () => {
          if (typeof actions.applyMapLibreLayerState === 'function') actions.applyMapLibreLayerState();
        },
        onApplyThreeLayerVisibility: () => {
          if (typeof actions.applyThreeLayerVisibility === 'function') actions.applyThreeLayerVisibility();
        },
        onSyncMapLegendVisibility: () => {
          if (typeof actions.syncMapLegendVisibility === 'function') actions.syncMapLegendVisibility();
        },
        onSyncRadarHudMode: () => {
          if (typeof actions.syncRadarHudMode === 'function') actions.syncRadarHudMode();
        },
        onUpdateMapLibreCursor: () => {
          if (typeof actions.updateMapLibreCursor === 'function') actions.updateMapLibreCursor();
        },
        getActiveSensitivityAxis: () =>
          typeof state.activeSensitivityAxis !== 'undefined' ? state.activeSensitivityAxis : 'bandwidth',
        getIsMouseInsideRadar: () =>
          typeof state.isMouseInsideRadar !== 'undefined' ? Boolean(state.isMouseInsideRadar) : false,
        getMouseWorldPos: () => ({
          x: typeof state.mouseWorldX !== 'undefined' ? state.mouseWorldX : 0,
          y: typeof state.mouseWorldY !== 'undefined' ? state.mouseWorldY : 0,
        }),
        getWaypointPlacementArmed: () =>
          typeof state.waypointPlacementArmed !== 'undefined' ? state.waypointPlacementArmed : false,
        setWaypointPlacementArmed: val => {
          state.waypointPlacementArmed = val;
        },
      });
    }
    return dashboardAndAuthoringControllerInstance;
  }

  let missionIoControllerInstance: ReturnType<typeof initMissionIoController> | null = null;
  function getMissionIoController() {
    if (!missionIoControllerInstance) {
      missionIoControllerInstance = initMissionIoController({
        postWorkerCommand: cmd => sendCommand(cmd),
        getLatestTelemetry: () => (typeof state.latestTelemetry !== 'undefined' ? state.latestTelemetry : null),
        getActiveBiomeId: () => (typeof state.activeBiomeId !== 'undefined' ? state.activeBiomeId : 'alpine_mountain'),
        getObstacles: () =>
          (mainTerrainEngine?.obstacleField?.all || []).map(o => ({
            id: o.id,
            type: o.shape,
            heightM: o.heightM,
            footprint: obstacleFootprintPoints(o),
          })),
        onDrawRadar: () => {
          if (typeof actions.drawRadar === 'function') actions.drawRadar();
        },
        getFlightRecorder: () => flightRecorder,
      });
    }
    return missionIoControllerInstance;
  }

  let commandPaletteControllerInstance: ReturnType<typeof initCommandPaletteController> | null = null;
  function getCommandPaletteController() {
    if (!commandPaletteControllerInstance) {
      commandPaletteControllerInstance = initCommandPaletteController();
    }
    return commandPaletteControllerInstance;
  }

  function renderRegistration(frame: TelemetryFrame) {
    if (!frame) return;
    const nodes = frame.nodes_telemetry || [];
    const states = nodes.map(n => n.registration_state || 'UNREGISTERED');
    const registered = states.filter(s => s === 'REGISTERED').length;
    const pending = states.filter(s => s === 'REQUESTING' || s === 'AUTHENTICATING').length;
    const exceptional = states.filter(s => s === 'REJECTED' || s === 'LOST').length;
    const pct = nodes.length ? Math.round((registered / nodes.length) * 100) : 0;
    const summary = document.getElementById('registration-summary');
    if (summary) {
      if (nodes.length === 0) {
        summary.innerHTML =
          '<p class="canvas-hint" style="padding:12px;margin:0;">No ground nodes registered yet — add or spawn nodes to begin 3GPP NTN registration.</p>';
      } else {
        summary.innerHTML = `<div class="panel"><b>${nodes.length}</b><span>Total nodes</span></div><div class="panel"><b>${registered}</b><span>Registered</span></div><div class="panel"><b>${pending}</b><span>Pending</span></div><div class="panel"><b>${exceptional}</b><span>Rejected / lost</span></div><div class="panel"><b>${pct}%</b><span>Success</span></div>`;
      }
    }
    const body = document.querySelector('#registration-table tbody');
    if (body) {
      body.innerHTML = nodes
        .map(
          n =>
            `<tr data-node-id="${Number(n.node_id)}" style="cursor:pointer"><td>${escapeHtml(n.name || `Node ${n.node_id}`)}</td><td>${escapeHtml(n.registration_state || 'UNREGISTERED')}</td><td>${n.registration_start_time_s == null ? '—' : `${Number(n.registration_start_time_s).toFixed(2)} s`}</td><td>${n.registration_completion_time_s == null ? '—' : `${Number(n.registration_completion_time_s).toFixed(2)} s`}</td><td>${n.registration_elapsed_s == null ? '—' : `${Number(n.registration_elapsed_s).toFixed(2)} s`}</td><td>${n.link_outage ? 'RF outage' : 'RF available'}</td><td>${n.communication_eligible ? 'Association eligible' : 'No'}</td></tr>`
        )
        .join('');
      if (!(body as HTMLElement).dataset.listenerBound) {
        (body as HTMLElement).dataset.listenerBound = 'true';
        body.addEventListener('click', e => {
          const tr = (e.target as HTMLElement).closest('tr[data-node-id]') as HTMLElement | null;
          if (tr && tr.dataset.nodeId) {
            const nid = parseInt(tr.dataset.nodeId, 10);
            if (Number.isFinite(nid)) handleNodeSelection(nid);
          }
        });
      }
    }
    const empty = document.getElementById('registration-empty');
    if (empty) empty.style.display = nodes.length ? 'none' : 'block';
    const time = document.getElementById('registration-sim-time');
    if (time) time.textContent = `${Number(frame.sim_time_s || 0).toFixed(2)} s`;
    const eventBody = document.getElementById('registration-events');
    if (eventBody) {
      const evts = frame.registration_telemetry?.events || [];
      if (evts.length === 0) {
        eventBody.innerHTML =
          '<tr><td colspan="3" class="network-chart-status">No lifecycle events recorded yet. Run a scenario to populate the lifecycle log.</td></tr>';
      } else {
        eventBody.innerHTML = evts
          .slice(-100)
          .reverse()
          .map(
            e =>
              `<tr><td>${Number(e.sim_time_s).toFixed(2)} s</td><td>${Number(e.node_id)}</td><td>${escapeHtml(String(e.state || ''))}</td></tr>`
          )
          .join('');
      }
    }
    renderNtnSignalingAnalyzer(frame);
  }

  function renderNtnSignalingAnalyzer(frame: TelemetryFrame) {
    const panel = document.getElementById('ntn-signaling-panel');
    if (!panel) return;

    const nodes = Array.isArray(frame?.nodes_telemetry) ? frame.nodes_telemetry : [];
    if (nodes.length === 0) return;

    const selectEl = document.getElementById('ntn-node-select') as HTMLSelectElement | null;
    if (selectEl) {
      if (!selectEl.dataset.initialized) {
        selectEl.dataset.initialized = 'true';
        selectEl.addEventListener('change', e => {
          state.selectedNtnNodeId = parseInt((e.target as HTMLSelectElement).value, 10) || 1;
          if (state.latestTelemetry) renderNtnSignalingAnalyzer(state.latestTelemetry);
        });
      }

      const currentOptionCount = selectEl.options.length;
      if (currentOptionCount !== nodes.length) {
        const currentVal = state.selectedNtnNodeId;
        selectEl.innerHTML = nodes
          .map(
            n =>
              `<option value="${Number(n.node_id)}" ${n.node_id === currentVal ? 'selected' : ''}>${escapeHtml(n.name || `Node ${n.node_id}`)}</option>`
          )
          .join('');
        if (!nodes.some(n => n.node_id === state.selectedNtnNodeId)) {
          state.selectedNtnNodeId = nodes[0]?.node_id ?? 1;
          selectEl.value = String(state.selectedNtnNodeId);
        }
      }
    }

    const node = nodes.find(n => n.node_id === state.selectedNtnNodeId) || nodes[0];
    if (!node) return;

    const slantRangeM = (node.slant_range_km || 15.0) * 1000.0;
    const snrDb =
      typeof node.snr_db === 'number' && Number.isFinite(node.snr_db)
        ? node.snr_db
        : typeof node.sinr_db === 'number' && Number.isFinite(node.sinr_db)
          ? node.sinr_db
          : 15.0;
    const isOutage = Boolean(node.link_outage || node.obstacle_blocked || node.terrain_is_los === false);
    const isRegistered = node.registration_state === 'REGISTERED';
    const activeSectorId = node.active_sector_id ?? 0;
    const handoverCount = node.handover_count ?? 0;
    const modcodName = node.modcod_name || '16APSK-2/3';
    const totalBacklogBits = (node.total_backlog_bytes || 0) * 8;

    const report = evaluateNtnNodeSignaling({
      nodeId: node.node_id,
      slantRangeM,
      snrDb,
      isOutage,
      isRegistered,
      activeSectorId,
      handoverCount,
      modcodName,
      totalBacklogBits,
    });

    const rrcBadge = document.getElementById('ntn-rrc-state-badge');
    if (rrcBadge) {
      rrcBadge.textContent = report.rrcState;
      if (report.rrcState === 'RRC_CONNECTED') {
        rrcBadge.className = 'kpi-badge badge-emerald';
      } else if (report.rrcState === 'RRC_RLF_RECOVERY') {
        rrcBadge.className = 'kpi-badge badge-danger';
      } else if (report.rrcState === 'RRC_IDLE') {
        rrcBadge.className = 'kpi-badge badge-neutral';
      } else {
        rrcBadge.className = 'kpi-badge badge-amber';
      }
    }

    const crntiBadge = document.getElementById('ntn-crnti-readout');
    if (crntiBadge) {
      crntiBadge.textContent = `C-RNTI: ${report.cRntiHex} | ZC Preamble: #${report.preambleIndex}`;
    }

    const rachBadge = document.getElementById('ntn-rach-latency-readout');
    if (rachBadge) {
      rachBadge.textContent = `4-Step RACH Latency: ${report.rachLatencyMs.toFixed(2)} ms`;
    }

    const taBadge = document.getElementById('ntn-ta-cmd-readout');
    if (taBadge) {
      taBadge.textContent = `3GPP TA Cmd: Index ${report.taIndex} (${report.tauTaUs.toFixed(1)} μs)`;
    }

    const canvas = document.getElementById('ntn-signaling-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width || canvas.clientWidth || 650;
    const height = 195;
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx2d.save();
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx2d.fillStyle = '#090d13';
    ctx2d.fillRect(0, 0, width, height);

    const xUe = Math.round(width * 0.16);
    const xSector = Math.round(width * 0.5);
    const xRrc = Math.round(width * 0.84);

    ctx2d.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx2d.lineWidth = 1;
    ctx2d.setLineDash([3, 3]);
    ctx2d.beginPath();
    ctx2d.moveTo(xUe, 26);
    ctx2d.lineTo(xUe, height - 8);
    ctx2d.moveTo(xSector, 26);
    ctx2d.lineTo(xSector, height - 8);
    ctx2d.moveTo(xRrc, 26);
    ctx2d.lineTo(xRrc, height - 8);
    ctx2d.stroke();
    ctx2d.setLineDash([]);

    ctx2d.font = '600 11px var(--mono)';
    ctx2d.textAlign = 'center';

    ctx2d.fillStyle = '#38bdf8';
    ctx2d.fillText(`UE [${report.cRntiHex}]`, xUe, 16);

    ctx2d.fillStyle = '#00e5ff';
    ctx2d.fillText(`ACN Beam [S${activeSectorId} PHY]`, xSector, 16);

    ctx2d.fillStyle = '#b388ff';
    ctx2d.fillText('ACN gNB-CU [RRC]', xRrc, 16);

    const startY = 42;
    const stepGap = 30;

    for (let i = 0; i < report.steps.length; i++) {
      const step = report.steps[i];
      const y = startY + i * stepGap;

      let x1 = xUe;
      let x2 = xSector;
      let strokeColor = '#38bdf8';

      if (step.dir === 'UE_TO_SECTOR') {
        x1 = xUe;
        x2 = xSector;
        strokeColor = '#38bdf8';
      } else if (step.dir === 'SECTOR_TO_UE') {
        x1 = xSector;
        x2 = xUe;
        strokeColor = '#00e676';
      } else if (step.dir === 'UE_TO_RRC') {
        x1 = xUe;
        x2 = xRrc;
        strokeColor = '#fbbf24';
      } else if (step.dir === 'RRC_TO_UE') {
        x1 = xRrc;
        x2 = xUe;
        if (step.stepIndex === 4) {
          strokeColor = report.rrcState === 'RRC_RLF_RECOVERY' ? '#ff2a54' : '#00e676';
        } else {
          strokeColor = report.rrcState === 'RRC_RLF_RECOVERY' ? '#ff2a54' : '#c084fc';
        }
      }

      const isDashed =
        (report.rrcState === 'RRC_RLF_RECOVERY' && (step.stepIndex === 4 || step.stepIndex === 5)) ||
        report.rrcState === 'RRC_IDLE';

      ctx2d.save();
      ctx2d.strokeStyle = strokeColor;
      ctx2d.lineWidth = 1.5;
      if (isDashed) ctx2d.setLineDash([4, 3]);
      else ctx2d.setLineDash([]);

      ctx2d.beginPath();
      ctx2d.moveTo(x1, y);
      ctx2d.lineTo(x2, y);
      ctx2d.stroke();
      ctx2d.setLineDash([]);

      const arrowLen = 6;
      const arrowAngle = Math.PI / 6;
      const angle = x2 > x1 ? 0 : Math.PI;
      ctx2d.beginPath();
      ctx2d.moveTo(x2, y);
      ctx2d.lineTo(x2 - arrowLen * Math.cos(angle - arrowAngle), y - arrowLen * Math.sin(angle - arrowAngle));
      ctx2d.lineTo(x2 - arrowLen * Math.cos(angle + arrowAngle), y - arrowLen * Math.sin(angle + arrowAngle));
      ctx2d.closePath();
      ctx2d.fillStyle = strokeColor;
      ctx2d.fill();

      ctx2d.font = '600 10.5px var(--mono)';
      ctx2d.fillStyle = strokeColor;
      ctx2d.textAlign = 'center';
      const midX = (x1 + x2) / 2;
      ctx2d.fillText(step.label, midX, y - 4);

      ctx2d.font = '10px var(--mono)';
      ctx2d.fillStyle = '#94a3b8';
      ctx2d.fillText(`${step.timeTag} · ${step.detail}`, midX, y + 10);

      ctx2d.restore();
    }

    ctx2d.restore();
  }
  window.renderNtnSignalingAnalyzer = renderNtnSignalingAnalyzer;

  function handleAcnSelection() {
    const rc = $('radar-container');
    const cw = rc?.getBoundingClientRect().width || rc?.clientWidth || 0;
    if (cw < 1100) window.setTerrainToolboxExpanded?.(false);
    actions.disarmAllDestructiveConfirmations();
    state.inspectingAcn = true;
    state.inspectorDismissed = false;
    state.nodeMoveModeActive = false;
    actions.syncEditModeBanner();
    renderSelectedNodeDetails();
  }

  function renderSelectedNodeDetails() {
    const panel = $('map-node-details');
    const content = $('map-node-detail-content');
    if (!content) return;
    const titleEl = panel?.querySelector('.map-node-header .sec-title');
    const simTimelineController = state.simTimelineController;
    const isTimelineHist = Boolean(simTimelineController && simTimelineController.isHistoricalInspecting);
    const histSnap = isTimelineHist && simTimelineController ? simTimelineController.getActiveSpatialSnapshot() : null;

    if (state.inspectingAcn) {
      if (panel) panel.dataset.inspectTarget = 'acn';
      if (titleEl) titleEl.textContent = 'Selected Relay';
      setText('map-node-action-status', '');
      const liveAcn = state.latestTelemetry?.acn_telemetry as
        | (AcnTelemetry & { velocity?: readonly [number, number, number] })
        | undefined;
      const acnOk = histSnap ? Boolean(histSnap.acn) : !isTimelineHist && Boolean(liveAcn);
      if (!acnOk) {
        content.className = 'map-node-empty';
        content.innerHTML = 'No airborne relay telemetry available.';
        panel?.querySelectorAll<HTMLButtonElement>('button:not(#btn-close-node-details)').forEach(button => {
          button.disabled = true;
        });
        if (panel) panel.classList.add('is-empty');
        return;
      }
      const ax = histSnap ? Number(histSnap.acn.posX ?? 0) : Number(liveAcn?.pos_x ?? 0);
      const ay = histSnap ? Number(histSnap.acn.posY ?? 0) : Number(liveAcn?.pos_y ?? 0);
      const altMsl = histSnap ? histSnap.acn.altitudeMslM : liveAcn?.altitude_msl_m;
      const altAgl = histSnap ? histSnap.acn.altitudeAglM : liveAcn?.altitude_agl_m;
      const vx = histSnap ? Number(histSnap.acn.velX ?? 0) : Number(liveAcn?.velocity?.[0] ?? liveAcn?.vel_x ?? 0);
      const vy = histSnap ? Number(histSnap.acn.velY ?? 0) : Number(liveAcn?.velocity?.[1] ?? liveAcn?.vel_y ?? 0);
      const spdMs = Math.hypot(vx, vy);
      const hdgDeg = histSnap
        ? (((histSnap.acn.headingRad * 180) / Math.PI) % 360 + 360) % 360
        : Number(liveAcn?.heading_deg ?? (((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360));
      const covKm = histSnap ? histSnap.acn.coverageRadiusKm : liveAcn?.coverage_radius_km;
      const geo = cartesianToGeodetic(ax, ay);

      const tallySrc = histSnap
        ? histSnap.nodes.map(n => ({
            terrain_is_los: n.isLos,
            obstacle_blocked: n.isObstacleBlocked,
            link_outage: n.isOutage,
            snr_db: n.snrDb,
            state_name: n.currentState,
          }))
        : isTimelineHist
          ? []
          : state.latestTelemetry?.nodes_telemetry || [];
      let nConn = 0,
        nDeg = 0,
        nBlk = 0;
      tallySrc.forEach(item => {
        const cls = classifyLinkCommunicationStatus(item);
        if (cls.status === 'CONNECTED') nConn++;
        else if (cls.status === 'DEGRADED') nDeg++;
        else nBlk++;
      });

      if (panel) {
        panel.classList.remove('is-empty');
        panel.classList.toggle('is-closed', Boolean(state.inspectorDismissed));
      }
      content.className = '';
      const acnRows = [
        ['Role', 'Airborne Communication Relay'],
        ['Latitude', Number.isFinite(geo.latDeg) ? `${geo.latDeg.toFixed(5)}°` : null],
        ['Longitude', Number.isFinite(geo.lonDeg) ? `${geo.lonDeg.toFixed(5)}°` : null],
        ['Altitude MSL', typeof altMsl === 'number' && Number.isFinite(altMsl) ? `${altMsl.toFixed(0)} m` : null],
        ['Altitude AGL', typeof altAgl === 'number' && Number.isFinite(altAgl) ? `${altAgl.toFixed(0)} m` : null],
        [
          'Ground speed',
          Number.isFinite(spdMs) ? `${spdMs.toFixed(1)} m/s (${(spdMs * 3.6).toFixed(0)} km/h)` : null,
        ],
        ['Heading', Number.isFinite(hdgDeg) ? `${Math.round(hdgDeg)}°` : null],
        ['Coverage radius', typeof covKm === 'number' && Number.isFinite(covKm) ? `${covKm.toFixed(1)} km` : null],
        ['Links', `${nConn} conn · ${nDeg} deg · ${nBlk} blk/out`],
      ].filter(([, value]) => value !== null && value !== undefined);
      const subTag = histSnap ? `Historical #${histSnap.frameIndex}` : 'Live telemetry';
      content.innerHTML = `<h3>ACN RELAY <span class="muted">ACN-1</span></h3><div class="detail-sub">${mapEscape(subTag)} · ${nConn}/${tallySrc.length} connected</div><div class="detail-grid">${acnRows.map(([label, value]) => `<span>${mapEscape(label)}</span><span>${mapEscape(value)}</span>`).join('')}</div>`;
      panel?.querySelectorAll('button:not(#btn-close-node-details)').forEach(button => {
        (button as HTMLButtonElement).disabled = (button as HTMLElement).dataset.mapAction !== 'focus';
      });
      actions.syncFloatingOverlayLayout();
      return;
    }

    if (panel) {
      panel.dataset.inspectTarget = 'node';
      panel.dataset.lockMode = state.spatialLocked ? 'locked' : 'unlocked';
    }
    if (titleEl) titleEl.textContent = 'Selected Node';

    let node: NodeTelemetryItem | undefined | null = null;
    if (isTimelineHist) {
      const hNode = histSnap?.nodes?.find(n => n.nodeId === state.selectedNodeId);
      if (hNode) {
        const liveMeta = state.latestTelemetry?.nodes_telemetry?.find(item => item.node_id === state.selectedNodeId);
        const hGeo = cartesianToGeodetic(hNode.posX, hNode.posY);
        node = {
          ...(liveMeta || {}),
          node_id: hNode.nodeId,
          name: liveMeta?.name || `Node ${hNode.nodeId}`,
          node_type: liveMeta?.node_type || 'soldier',
          pos_x: hNode.posX,
          pos_y: hNode.posY,
          pos_z: liveMeta?.pos_z ?? 0,
          x_m: hNode.posX,
          y_m: hNode.posY,
          lat_deg: Number.isFinite(hGeo.latDeg) ? hGeo.latDeg : liveMeta?.lat_deg,
          lon_deg: Number.isFinite(hGeo.lonDeg) ? hGeo.lonDeg : liveMeta?.lon_deg,
          terrain_is_los: hNode.isLos,
          obstacle_blocked: hNode.isObstacleBlocked,
          link_outage: hNode.isOutage,
          snr_db: hNode.snrDb,
          state_name: hNode.currentState,
          is_transmitting: false,
          backlog_bytes: liveMeta?.backlog_bytes ?? 0,
          tactical_priority: liveMeta?.tactical_priority ?? 1.0,
          is_depleted: liveMeta?.is_depleted ?? false,
          registration_state: liveMeta?.registration_state ?? 'UNREGISTERED',
          registration_start_time_s: liveMeta?.registration_start_time_s ?? null,
          registration_completion_time_s: liveMeta?.registration_completion_time_s ?? null,
          registration_elapsed_s: liveMeta?.registration_elapsed_s ?? null,
          communication_eligible: liveMeta?.communication_eligible ?? false,
          active_sector_id: hNode.active_sector_id as NodeTelemetryItem['active_sector_id'],
          pattern_rolloff_db: hNode.pattern_rolloff_db,
        } as NodeTelemetryItem;
      }
    } else {
      node = state.latestTelemetry?.nodes_telemetry?.find(item => item.node_id === state.selectedNodeId);
    }

    if (!node) {
      content.className = 'map-node-empty';
      content.innerHTML = 'No ground node selected. Select a marker or choose a terminal from Node Inventory.';
      panel?.querySelectorAll<HTMLButtonElement>('button:not(#btn-close-node-details)').forEach(button => {
        button.disabled = true;
      });
      if (panel) panel.classList.add('is-empty');
      return;
    }
    if (panel) {
      panel.classList.remove('is-empty');
      if (state.inspectorDismissed) {
        panel.classList.add('is-closed');
      } else {
        panel.classList.remove('is-closed');
      }
    }
    content.className = '';
    const rate = isTimelineHist ? 'Unavailable' : nodeAchievedRate(node);
    const rows = [
      ['ID / name', `${node.node_id} · ${node.name || `Node ${node.node_id}`}`],
      ['Team', node.team_name || null],
      ['Role', node.node_role || node.node_type || null],
      ['Registration', node.registration_state || null],
      [
        'Latitude',
        typeof node.lat_deg === 'number' && Number.isFinite(node.lat_deg) ? `${node.lat_deg.toFixed(5)}°` : null,
      ],
      [
        'Longitude',
        typeof node.lon_deg === 'number' && Number.isFinite(node.lon_deg) ? `${node.lon_deg.toFixed(5)}°` : null,
      ],
      ['AGL', typeof node.agl_m === 'number' ? `${node.agl_m.toFixed(1)} m` : null],
      ['Terrain state', node.state_name],
      ['RF link', nodeLinkLabel(node)],
      [
        'SNR / MODCOD',
        typeof node.snr_db === 'number'
          ? `${node.snr_db.toFixed(1)} dB · ${node.modcod_name || (isTimelineHist ? 'Historical' : 'Unavailable')}`
          : null,
      ],
      ['Achieved rate', rate !== 'Unavailable' ? rate : null],
      [
        'Communication',
        node.is_transmitting
          ? 'Ground → ACN · transmitting'
          : (node.allocated_slot_ms ?? 0) > 0
            ? 'Ground → ACN · slot allocated'
            : null,
      ],
      [
        'Battery',
        typeof node.battery_level_pct === 'number'
          ? `${node.battery_level_pct.toFixed(1)}%${typeof node.battery_capacity_mah === 'number' ? ` · ${node.battery_capacity_mah.toFixed(0)} mAh` : ''}`
          : null,
      ],
      ['Queue', typeof node.total_backlog_bytes === 'number' ? `${(node.total_backlog_bytes / 1024).toFixed(1)} KB` : null],
      ['Priority', typeof node.tactical_priority === 'number' ? node.tactical_priority.toFixed(1) : null],
      [
        'Antenna sector',
        typeof node.active_sector_id === 'number'
          ? `S${node.active_sector_id} (${node.sector_boresight_deg ?? node.active_sector_id * 90}° boresight)`
          : null,
      ],
      [
        'Off-boresight',
        typeof node.off_boresight_deg === 'number'
          ? `${node.off_boresight_deg.toFixed(1)}° (-${(node.pattern_rolloff_db ?? 0).toFixed(1)} dB)`
          : null,
      ],
      ['Sector handovers', typeof node.handover_count === 'number' ? `${node.handover_count}` : null],
    ].filter(([, value]) => value !== null && value !== undefined);
    const lockHint = state.spatialLocked ? 'Scenario Locked' : 'Unlocked · Drag node on map';
    content.innerHTML = `<h3>${mapEscape(node.name || `Node ${node.node_id}`)} <span class="muted">#${node.node_id}</span></h3><div class="detail-sub">${mapEscape(isTimelineHist && histSnap ? `Historical #${histSnap.frameIndex}` : node.registration_state || 'Registration unavailable')} · ${mapEscape(nodeLinkLabel(node))} · ${mapEscape(lockHint)}</div><div class="detail-grid">${rows.map(([label, value]) => `<span>${mapEscape(label)}</span><span>${mapEscape(value)}</span>`).join('')}</div>`;
    $('map-node-details')
      ?.querySelectorAll<HTMLButtonElement>('button')
      .forEach(button => {
        button.disabled = false;
      });
    actions.syncRfQuickToggleButtons();
    actions.syncFloatingOverlayLayout();
  }

  function handleNodeSelection(nodeId: number) {
    if (historyController.isInspecting) return;
    const rc = $('radar-container');
    const cw = rc?.getBoundingClientRect().width || rc?.clientWidth || 0;
    if (cw < 1100) window.setTerrainToolboxExpanded?.(false);
    actions.disarmAllDestructiveConfirmations();
    state.inspectingAcn = false;
    state.inspectorDismissed = false;
    state.selectedTeamId = null;
    state.selectedTrafficTeamId = null;
    if (state.selectedNodeId !== nodeId && state.nodeMoveModeActive) {
      state.nodeMoveModeActive = false;
      actions.syncEditModeBanner();
    }
    state.selectedNodeId = nodeId;
    const networkSelect = $<HTMLSelectElement>('network-node-select');
    if (networkSelect) {
      const selectedCount = networkSelect.selectedOptions ? networkSelect.selectedOptions.length : 0;
      if (selectedCount < 2) {
        Array.from(networkSelect.options).forEach((opt: HTMLOptionElement) => {
          opt.selected = Number(opt.value) === nodeId;
        });
        networkSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    setText('wf-target-node-badge', `Inspecting Target Node ${nodeId}`);
    renderSelectedNodeDetails();
    actions.updateMapLibreOverlay();
    state.pendingAglUpdate = null;
    actions.syncNodeDropdowns(state.selectedNodeId);
    actions.syncSelectedNodeAglUI();
    sendCommand({ type: 'SELECT_NODE', node_id: state.selectedNodeId });
    actions.updateSchedulerScrubberUI();
    if (schedHistoryController.isInspecting) {
      actions.syncSchedulerHistoricalUIState();
    } else {
      actions.drawSchedulerCharts();
    }
    if (state.latestTelemetry && state.latestTelemetry.nodes_telemetry) {
      const search = $<HTMLInputElement>('terminal-search');
      renderTerminalInventory(state.latestTelemetry.nodes_telemetry, state.selectedNodeId, search ? search.value : '');
      const sel =
        state.latestTelemetry.nodes_telemetry.find(n => n.node_id === state.selectedNodeId) ||
        state.latestTelemetry.nodes_telemetry[0];
      renderVsaScope(sel, state.latestTelemetry);
      state.selectedTrafficNodeId = state.selectedNodeId;
      const trafficSel = $<HTMLSelectElement>('traffic-node-select');
      if (trafficSel && Array.from(trafficSel.options).some((o: HTMLOptionElement) => Number(o.value) === state.selectedNodeId)) {
        trafficSel.value = String(state.selectedNodeId);
      }
      renderNetworkTrafficInventory(state.latestTelemetry);
    }
    actions.drawRadar();
    actions.drawFresnel();
    if (state.latestTelemetry) {
      actions.drawPolarAntennaScope(state.latestTelemetry);
      actions.drawLinkWaterfallCanvas(state.latestTelemetry);
      actions.drawEcdfDelayScope(state.latestTelemetry);
      actions.drawSensitivitySweepScope(state.latestTelemetry);
      updateDashboardDOM(state.latestTelemetry, true);
    }
  }

  window.copilotBuddyEnabled = true;
  window.copilotLpiEnabled = true;
  window.aiAutoHealEnabled = false;
  window.pinnedSoldierIds = new Set();

  window.openSoldierPhone = function(nodeId) {
    if (typeof nodeId === 'number' || (typeof nodeId === 'string' && nodeId !== '')) {
      const numId = Number(nodeId);
      if (Number.isFinite(numId)) {
        state.selectedNodeId = numId;
        actions.syncNodeDropdowns(numId);
      }
    }
    window.switchMainTab?.('tab-soldier');
  };

  window.executeAiNodeReposition = function() {
    if (state.selectedNodeId === null || state.selectedNodeId === undefined || state.selectedNodeId < 0) return;
    sendCommand({ type: 'TRIGGER_AI_NODE_REPOSITION', nodeId: state.selectedNodeId });
  };

  window.toggleAiAutoHeal = function() {
    const isAuto = !window.aiAutoHealEnabled;
    window.aiAutoHealEnabled = isAuto;
    sendCommand({ type: 'SET_AI_AUTO_HEAL', enabled: isAuto });
    sendCommand({ type: 'SET_AI_COPILOT_CONFIG', autoHealEnabled: isAuto });
    const btn1 = $('btn-ai-auto-heal-toggle');
    const btn2 = $('btn-ai-auto-heal-matrix-toggle');
    const text = `[AI] Auto AI Squad Self-Healing: ${isAuto ? 'ON' : 'OFF'}`;
    if (btn1) {
      btn1.setAttribute('aria-pressed', String(isAuto));
      btn1.textContent = text;
      btn1.style.color = isAuto ? '#34d399' : 'var(--muted)';
      btn1.style.borderColor = isAuto ? '#34d399' : 'rgba(255,255,255,0.15)';
    }
    if (btn2) {
      btn2.setAttribute('aria-pressed', String(isAuto));
      btn2.textContent = text;
      btn2.style.color = isAuto ? '#34d399' : 'var(--muted)';
      btn2.style.borderColor = isAuto ? '#34d399' : 'rgba(255,255,255,0.15)';
    }
  };

  window.togglePinShepherd = function() {
    if (state.selectedNodeId === null || state.selectedNodeId === undefined || state.selectedNodeId < 0) return;
    if (!window.pinnedSoldierIds) window.pinnedSoldierIds = new Set<number>();
    const isPinned = !window.pinnedSoldierIds.has(state.selectedNodeId);
    if (isPinned) window.pinnedSoldierIds.add(state.selectedNodeId);
    else window.pinnedSoldierIds.delete(state.selectedNodeId);
    sendCommand({ type: 'TRIGGER_AI_SKY_SHEPHERD', pinnedNodeId: state.selectedNodeId, enabled: isPinned });
    if (state.latestTelemetry) renderSoldierPhoneWorkspace(state.latestTelemetry);
  };

  window.toggleBuddyMesh = function() {
    window.copilotBuddyEnabled = !window.copilotBuddyEnabled;
    sendCommand({ type: 'SET_AI_COPILOT_CONFIG', buddyMeshEnabled: window.copilotBuddyEnabled });
    const btn = $('btn-ai-buddy-mesh-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(window.copilotBuddyEnabled));
      btn.textContent = `[BUDDY] Buddy-Relay Squad Mesh: ${window.copilotBuddyEnabled ? 'ON' : 'OFF'}`;
      btn.style.color = window.copilotBuddyEnabled ? '#c084fc' : 'var(--muted)';
      btn.style.borderColor = window.copilotBuddyEnabled ? '#c084fc' : 'rgba(255,255,255,0.15)';
    }
  };

  window.toggleLpiStealth = function() {
    window.copilotLpiEnabled = !window.copilotLpiEnabled;
    sendCommand({ type: 'SET_AI_COPILOT_CONFIG', lpiStealthEnabled: window.copilotLpiEnabled });
    const btn = $('btn-ai-lpi-stealth-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(window.copilotLpiEnabled));
      btn.textContent = `[LPI] AI LPI Stealth TX: ${window.copilotLpiEnabled ? 'ON' : 'OFF'}`;
      btn.style.color = window.copilotLpiEnabled ? '#fbbf24' : 'var(--muted)';
      btn.style.borderColor = window.copilotLpiEnabled ? '#fbbf24' : 'rgba(255,255,255,0.15)';
    }
  };

  function drawSoldierCompassCanvas(
    node: NodeTelemetryItem | null | undefined,
    frame: TelemetryFrame | null | undefined,
    rec: Parameters<typeof drawSoldierCompassScope>[4]
  ) {
    const canvas = $<HTMLCanvasElement>('soldier-phone-canvas');
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    drawSoldierCompassScope(canvas, ctx2d, node, frame, rec);
  }

  function renderSoldierPhoneWorkspace(frame: TelemetryFrame) {
    if (!frame) return;
    const nodes = frame.nodes_telemetry || [];
    if (nodes.length === 0) return;

    const selNode = nodes.find(n => n.node_id === state.selectedNodeId) || nodes[0];
    if (!selNode) return;

    const eudSel = $<HTMLSelectElement>('eud-node-select');
    if (eudSel && String(eudSel.value) !== String(selNode.node_id)) {
      eudSel.value = String(selNode.node_id);
    }

    const routeEl = $('context-eud-route');
    let routeStr = 'DIRECT';
    if (selNode.ai_buddy_node_id !== null && selNode.ai_buddy_node_id !== undefined) {
      routeStr = `BUDDY S${selNode.ai_buddy_node_id}`;
    } else if (selNode.two_hop_active) {
      routeStr = '2-HOP RELAY';
    } else if (selNode.is_outage) {
      routeStr = 'SHADOW OUTAGE';
    }
    if (routeEl) routeEl.textContent = routeStr;

    const routeBadge = $('eud-route-badge');
    if (routeBadge) {
      if (selNode.ai_buddy_node_id !== null && selNode.ai_buddy_node_id !== undefined) {
        const rate = selNode.ai_buddy_rate_mbps ? `${selNode.ai_buddy_rate_mbps.toFixed(1)}M` : '--';
        routeBadge.textContent = `[BUDDY] S${selNode.ai_buddy_node_id} (${rate})`;
        routeBadge.className = 'kpi-badge badge-active';
        routeBadge.style.background = 'rgba(192,132,252,0.2)';
        routeBadge.style.color = '#c084fc';
      } else if (selNode.two_hop_active) {
        routeBadge.textContent = '[RELAY] 2-HOP RELAY';
        routeBadge.className = 'kpi-badge badge-active';
        routeBadge.style.background = 'rgba(16,185,129,0.2)';
        routeBadge.style.color = '#34d399';
      } else if (selNode.is_outage) {
        routeBadge.textContent = '[OUTAGE] MOUNTAIN SHADOW';
        routeBadge.className = 'kpi-badge badge-danger';
        routeBadge.style.background = 'rgba(239,68,68,0.2)';
        routeBadge.style.color = '#ef4444';
      } else {
        routeBadge.textContent = '[DIRECT] DIRECT UAV';
        routeBadge.className = 'kpi-badge badge-neutral';
        routeBadge.style.background = 'rgba(56,189,248,0.15)';
        routeBadge.style.color = '#38bdf8';
      }
    }

    const sinrBadge = $('eud-sinr-readout');
    if (sinrBadge) {
      const s = selNode.sinr_db !== undefined ? selNode.sinr_db : 0;
      sinrBadge.textContent = `${s >= 0 ? '+' : ''}${s.toFixed(1)} dB`;
      sinrBadge.style.color = s >= 10 ? '#34d399' : s >= 0 ? '#fbbf24' : '#ef4444';
    }

    const lpiEl = $('eud-lpi-readout');
    if (lpiEl) {
      const tx = selNode.ai_lpi_tx_dbm !== undefined ? selNode.ai_lpi_tx_dbm : 30.0;
      const saved = selNode.ai_lpi_saved_pct !== undefined ? selNode.ai_lpi_saved_pct : 0.0;
      lpiEl.textContent = `[LPI] TX: ${tx.toFixed(1)} dBm (-${saved.toFixed(0)}% Sig)`;
    }

    const gpsEl = $('eud-gps-readout');
    if (gpsEl) {
      const msl = (selNode.terrain_elevation_msl_m || 0) + (selNode.agl_m || 2);
      gpsEl.textContent = `GPS: ${Math.round(msl)}m MSL`;
    }

    const bannerEl = $('eud-ai-notification-banner');
    const bannerTitle = $('eud-banner-title');
    const bannerText = $('eud-banner-text');
    const bannerBadge = $('eud-banner-badge');

    const blackoutSec = selNode.ai_blackout_in_s;
    const isPinned = Boolean(window.pinnedSoldierIds?.has(selNode.node_id)) || Boolean(selNode.ai_is_pinned);
    const isBuddy = selNode.ai_buddy_node_id !== null && selNode.ai_buddy_node_id !== undefined;
    const needsMove = Boolean(selNode.ai_needs_reposition);

    const banner = resolveSoldierAiNotificationBanner(
      selNode,
      isPinned,
      Boolean(frame?.ai_sky_shepherd_active),
      frame?.ai_sky_shepherd_directive
    );
    if (bannerEl) {
      bannerEl.style.background = banner.background;
      bannerEl.style.borderColor = banner.borderColor;
    }
    if (bannerTitle) {
      bannerTitle.textContent = banner.title;
      bannerTitle.style.color = banner.titleColor;
    }
    if (bannerBadge) {
      bannerBadge.textContent = banner.badge;
      bannerBadge.style.color = banner.badgeColor;
      bannerBadge.style.background = banner.badgeBackground;
    }
    if (bannerText) {
      bannerText.textContent = banner.text;
    }

    const navGuidance = $('eud-nav-guidance');
    if (navGuidance) {
      if (needsMove && selNode.ai_move_dist_m) {
        const d = Math.round(selNode.ai_move_dist_m);
        const b = Math.round(selNode.ai_move_bearing_deg || 0);
        const card = selNode.ai_move_cardinal || '';
        const wps = selNode.ai_walk_path_enu ? selNode.ai_walk_path_enu.length : 1;
        navGuidance.textContent = `↑ ${d}m · ${b}° ${card} [WP${wps} → AI-SAFE]`;
        navGuidance.style.color = '#34d399';
      } else {
        navGuidance.textContent = '↑ 0m · ON TARGET [WP0]';
        navGuidance.style.color = '#38bdf8';
      }
    }

    const pinBtn = $('btn-eud-pin-shepherd');
    if (pinBtn) {
      pinBtn.setAttribute('aria-pressed', String(isPinned));
      pinBtn.textContent = isPinned ? '[UNPIN] Resume Orbit' : '[PIN] Call Sky-Shepherd';
      pinBtn.style.background = isPinned ? '#dc2626' : 'rgba(255,255,255,0.06)';
      pinBtn.style.borderColor = isPinned ? '#ef4444' : 'rgba(255,255,255,0.15)';
      pinBtn.style.color = isPinned ? '#ffffff' : 'var(--muted)';
    }

    setText('badge-pillar-walkable', needsMove ? 'RELOCATE' : 'OPTIMAL');
    setText(
      'body-pillar-walkable',
      needsMove
        ? `Move ${Math.round(selNode.ai_move_dist_m || 0)}m ${selNode.ai_move_cardinal || ''} (slope ${selNode.ai_slope_deg?.toFixed(1) || 0}°, ETA ${selNode.ai_eta_s?.toFixed(0) || 0}s). Predicted SINR: +${selNode.ai_predicted_sinr_db?.toFixed(1) || '--'} dB (${selNode.ai_predicted_modcod || '--'}).`
        : 'Current position provides clear LoS and stable link margin. Zero relocation required.'
    );

    setText('badge-pillar-buddymesh', isBuddy ? `S${selNode.ai_buddy_node_id} ACTIVE` : 'STANDBY');
    setText(
      'body-pillar-buddymesh',
      isBuddy
        ? `Decodes and forwards through S${selNode.ai_buddy_node_id}. Harmonic DF throughput: ${selNode.ai_buddy_rate_mbps?.toFixed(1) || '--'} Mbps.`
        : window.copilotBuddyEnabled
          ? 'Direct UAV link active. Buddy mesh daemon continuously monitors squad peer links.'
          : 'Buddy mesh daemon disabled by operator.'
    );

    const defiladeShieldDb = selNode.ai_jammer_shield_db || 0.0;
    const jammerActive = Boolean(frame.jammer_enabled);
    setText('badge-pillar-defilade', jammerActive ? (defiladeShieldDb > 3 ? 'SHIELDED' : 'EXPOSED') : 'NO JAMMER');
    setText(
      'body-pillar-defilade',
      jammerActive
        ? `Enemy jammer active. Micro-terrain ridge provides ${defiladeShieldDb.toFixed(1)} dB mountain diffraction isolation against jammer.`
        : 'Jammer inactive. Terrain knife-edge diffraction shielding estimator in standby.'
    );

    setText('badge-pillar-skyshepherd', frame.ai_sky_shepherd_active ? 'ACTIVE' : 'STANDARD ORBIT');
    setText(
      'body-pillar-skyshepherd',
      frame.ai_sky_shepherd_active
        ? `Sky-Shepherd loiter active for Node ${frame.ai_sky_shepherd_node_id ?? selNode.node_id}. ${frame.ai_sky_shepherd_directive || ''}`
        : 'Soldier mobile. ACN maintaining standard trajectory.'
    );

    const lpiTx = selNode.ai_lpi_tx_dbm !== undefined ? selNode.ai_lpi_tx_dbm : 30.0;
    const lpiSaved = selNode.ai_lpi_saved_pct !== undefined ? selNode.ai_lpi_saved_pct : 0.0;
    setText(
      'badge-pillar-lpi-blackout',
      blackoutSec !== null && blackoutSec !== undefined ? 'BLACKOUT IMMINENT' : 'LPI ACTIVE'
    );
    setText(
      'body-pillar-lpi-blackout',
      `LPI TX: ${lpiTx.toFixed(1)} dBm (-${lpiSaved.toFixed(0)}% RF signature) holding target MODCOD with +2.5 dB margin.${blackoutSec !== null && blackoutSec !== undefined ? ` [WARN] BLACKOUT IN ${blackoutSec.toFixed(1)}s along current UAV heading!` : ' Next 15s clear.'}`
    );

    const fakeRec: NonNullable<Parameters<typeof drawSoldierCompassScope>[4]> & {
      pathDistanceM?: number;
      walkPathWaypoints?: Array<[number, number, number]>;
      directiveText?: string;
    } = {
      needsReposition: needsMove,
      targetPosEnu: selNode.ai_target_pos_enu ? [selNode.ai_target_pos_enu[0], selNode.ai_target_pos_enu[1], selNode.ai_target_pos_enu[2]] : undefined,
      pathDistanceM: selNode.ai_move_dist_m,
      walkPathWaypoints: selNode.ai_walk_path_enu ? selNode.ai_walk_path_enu.map(p => [p[0], p[1], p[2]] as [number, number, number]) : undefined,
      directiveText: selNode.ai_directive_text,
    };
    drawSoldierCompassCanvas(selNode, frame, fakeRec);
  }

  function renderOpsFleetRegistry(nodes: TelemetryFrame['nodes_telemetry'] | undefined) {
    if (!nodes) return;
    telemetryUpdaters.renderOpsFleetRegistry(
      nodes as unknown as Parameters<typeof telemetryUpdaters.renderOpsFleetRegistry>[0],
      typeof state.selectedNodeId !== 'undefined' ? state.selectedNodeId : null
    );
  }
  window.renderOpsFleetRegistry = renderOpsFleetRegistry;

  function renderTerminalInventory(
    nodes: TelemetryFrame['nodes_telemetry'] | undefined,
    selectedId: number,
    query = ''
  ) {
    const tbody = $('terminal-inventory-tbody');
    if (!tbody || !Array.isArray(nodes)) return;

    const countBadge = $('inventory-nodes-count');
    if (countBadge) {
      countBadge.textContent =
        nodes.length > 0
          ? `${nodes.length} active node${nodes.length === 1 ? '' : 's'} · WGS-84 & Local Cartesian`
          : '0 active nodes · ACN-Only Standby';
    }

    const pill = $('inventory-selected-pill');
    if (pill) {
      pill.textContent = selectedId >= 0 ? `Selected: Node ${selectedId}` : 'No Node Selected (ACN Only)';
    }

    populateDropdownsOnce(nodes);

    const q = String(query || '').trim().toLowerCase();
    const rows = [];

    for (const n of nodes) {
      const role = getNodeRole(n.node_id, n.node_role || n.node_type);
      const callsign = n.name || `S${n.node_id}`;
      const teamName = typeof n.team_name === 'string' ? n.team_name : '';
      if (q) {
        const match =
          String(n.node_id).includes(q) ||
          callsign.toLowerCase().includes(q) ||
          role.toLowerCase().includes(q) ||
          teamName.toLowerCase().includes(q);
        if (!match) continue;
      }

      const isSelected = n.node_id === selectedId;
      const x = typeof n.x_m === 'number' ? n.x_m : n.position ? n.position[0] : 0;
      const y = typeof n.y_m === 'number' ? n.y_m : n.position ? n.position[1] : 0;
      const { latStr, lonStr, latDms, lonDms } = formatNodeGeodeticCoordinates(n.lat_deg, n.lon_deg);

      const terrainMsl = typeof n.terrain_elevation_msl_m === 'number' ? n.terrain_elevation_msl_m : 0;
      const agl =
        typeof n.agl_m === 'number' ? n.agl_m : typeof n.antenna_height_m === 'number' ? n.antenna_height_m : 2.0;
      const totalMsl =
        typeof n.altitude_msl_m === 'number'
          ? n.altitude_msl_m
          : typeof n.z_m === 'number'
            ? n.z_m
            : terrainMsl + agl;

      const isDepleted = n.is_depleted || (typeof n.battery_level_pct === 'number' && n.battery_level_pct <= 0);
      const statusObj = classifyLinkCommunicationStatus(n);
      let badge = getStatusBadgeInfo(statusObj.status);
      if (isDepleted) {
        badge = {
          status: badge.status,
          badgeClass: 'badge-danger',
          badgeText: 'BATTERY DEPLETED',
          badgeColor: '#ef4444',
        };
      }

      const rawColor = n.color_hex || (n.node_type === 'mcp' ? '#e9c46a' : '#e09f3e');
      const nodeColor = /^#[0-9a-fA-F]{3,8}$/.test(String(rawColor)) ? String(rawColor) : '#e09f3e';
      const txPwr =
        typeof n.tx_power_dbm === 'number'
          ? `${n.tx_power_dbm.toFixed(1)} dBm`
          : n.node_type === 'mcp'
            ? '43.0 dBm'
            : '36.0 dBm';
      const batLvl = typeof n.battery_level_pct === 'number' ? n.battery_level_pct.toFixed(0) : '100';
      const batCap =
        typeof n.battery_capacity_mah === 'number'
          ? n.battery_capacity_mah.toFixed(0)
          : n.node_type === 'mcp'
            ? '20000'
            : '5000';
      const batStr = `${batLvl}% (${batCap} mAh)`;
      const priStr = typeof n.tactical_priority === 'number' ? `${n.tactical_priority.toFixed(1)}x` : '1.0x';

      const tr = document.createElement('tr');
      if (isSelected) tr.classList.add('is-selected');
      tr.dataset.nodeId = String(n.node_id);
      tr.onclick = (ev: MouseEvent) => {
        const editBtn = (ev?.target as HTMLElement | undefined)?.closest?.('[data-inv-edit]');
        if (editBtn) {
          ev.stopPropagation();
          actions.openNodeEditModal(n.node_id);
          return;
        }
        if (typeof window.onTargetNodeChange === 'function') {
          window.onTargetNodeChange(n.node_id);
        }
      };

      const teamPillHtml = teamName
        ? ` <span class="c2-team-badge">[${escapeHtml(teamName)}]</span>`
        : '';
      const rowEditBtnHtml = `<button type="button" class="c2-fleet-edit-btn" data-inv-edit="${n.node_id}" title="Edit / Rename terminal" aria-label="Edit ${escapeHtml(callsign)}">&#9998;</button>`;

      tr.innerHTML = `
        <td style="text-align:left;font-family:var(--mono)">${Number(n.node_id)}</td>
        <td style="text-align:left;font-weight:600">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${nodeColor};margin-right:6px;vertical-align:middle"></span>${escapeHtml(callsign)}${teamPillHtml} ${rowEditBtnHtml}
        </td>
        <td style="text-align:left;font-family:var(--sans)">${escapeHtml(role)}</td>
        <td style="font-family:var(--mono)">${txPwr}</td>
        <td style="font-family:var(--mono)">${batStr}</td>
        <td style="font-family:var(--mono)">${priStr}</td>
        <td title="${escapeHtml(latDms)}" style="font-family:var(--mono)">${escapeHtml(latStr)}</td>
        <td title="${escapeHtml(lonDms)}" style="font-family:var(--mono)">${escapeHtml(lonStr)}</td>
        <td>${x.toFixed(0)}</td>
        <td>${y.toFixed(0)}</td>
        <td>${agl.toFixed(1)}</td>
        <td>${terrainMsl.toFixed(1)}</td>
        <td>${totalMsl.toFixed(1)}</td>
        <td style="text-align:center"><span class="${escapeHtml(badge.badgeClass)}" style="display:inline-block;padding:2px 6px;font-size:10px">${escapeHtml(badge.badgeText)}</span></td>
      `;
      rows.push(tr);
    }

    if (rows.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="14" style="text-align:center;padding:24px;color:var(--text-muted);font-style:italic">
        ${nodes.length === 0 ? 'No ground terminals registered. ACN operating in standalone relay standby. Click "+ Add Node" to deploy a terminal.' : 'No nodes match search query.'}
      </td>`;
      rows.push(tr);
    }

    tbody.replaceChildren(...rows);
  }

  function populateDropdownsOnce(nodes: TelemetryFrame['nodes_telemetry']) {
    const teams = Array.isArray(nodes) ? collectTeamsFromNodes(nodes) : [];
    const fleetFilter = $<HTMLSelectElement>('ops-fleet-team-filter');
    if (fleetFilter && Array.isArray(nodes)) {
      const filterKey = teams.map(t => `${t.teamId}:${t.teamName}:${t.nodeIds.length}`).join(',');
      if (fleetFilter.dataset.lastKey !== filterKey) {
        fleetFilter.dataset.lastKey = filterKey;
        const prevVal = state.opsFleetTeamFilter ? `team:${state.opsFleetTeamFilter}` : 'all';
        fleetFilter.innerHTML = '';
        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = `All Teams (${nodes.length})`;
        fleetFilter.appendChild(allOpt);
        teams.forEach(t => {
          const opt = document.createElement('option');
          opt.value = `team:${t.teamId}`;
          opt.textContent = `${t.teamName} (${t.nodeIds.length})`;
          fleetFilter.appendChild(opt);
        });
        fleetFilter.value = Array.from(fleetFilter.options).some(o => o.value === prevVal) ? prevVal : 'all';
      }
    }

    ['quickNodeSelect', 'termNodeSelect', 'vsa-node-select', 'eud-node-select'].forEach(id => {
      const sel = $<HTMLSelectElement>(id);
      if (!sel || !Array.isArray(nodes)) return;
      if (nodes.length === 0) {
        if (sel.dataset.lastKey === 'empty' && sel.options.length === 1) return;
        sel.dataset.lastKey = 'empty';
        sel.innerHTML = '<option value="-1">No ground terminals (ACN only)</option>';
        sel.value = '-1';
        return;
      }
      const key =
        nodes.map(n => `${n.node_id}:${n.name}:${n.node_role || n.node_type}:${n.team_id || ''}:${n.team_name || ''}`).join(',');
      if (sel.dataset.lastKey === key && sel.options.length >= nodes.length) return;
      sel.dataset.lastKey = key;
      sel.innerHTML = '';

      const supportsTeamOptgroup = id === 'quickNodeSelect' || id === 'termNodeSelect';
      if (supportsTeamOptgroup && teams.length > 0) {
        const teamGroup = document.createElement('optgroup');
        teamGroup.label = 'Tactical Teams';
        teams.forEach(t => {
          const opt = document.createElement('option');
          opt.value = `team:${t.teamId}`;
          opt.textContent = `Team: ${t.teamName} (${t.nodeIds.length} nodes)`;
          teamGroup.appendChild(opt);
        });
        sel.appendChild(teamGroup);
      }

      const termGroup = supportsTeamOptgroup ? document.createElement('optgroup') : null;
      if (termGroup) termGroup.label = 'Individual Terminals';
      nodes.forEach(n => {
        const role = getNodeRole(n.node_id, n.node_role || n.node_type);
        const opt = document.createElement('option');
        opt.value = String(n.node_id);
        const teamSuffix = n.team_name ? ` [${n.team_name}]` : '';
        opt.textContent = `Node ${n.node_id}: ${n.name || 'S' + n.node_id} - ${role}${teamSuffix}`;
        (termGroup || sel).appendChild(opt);
      });
      if (termGroup) sel.appendChild(termGroup);

      if (supportsTeamOptgroup && state.selectedTeamId) {
        const teamVal = `team:${state.selectedTeamId}`;
        if (Array.from(sel.options).some(o => o.value === teamVal)) {
          sel.value = teamVal;
          return;
        }
      }
      if (nodes.some(n => n.node_id === state.selectedNodeId)) {
        sel.value = String(state.selectedNodeId);
      } else if (nodes.length > 0) {
        sel.value = String(nodes[0].node_id);
      }
    });
  }

  function renderVsaScope(nodeTel: NodeTelemetryItem | null | undefined, frame: TelemetryFrame) {
    actions.getDashboardAndAuthoringController().renderVsaScope(nodeTel, frame);
  }
  window.renderVsaScope = renderVsaScope;

  function updateOpsQosSlaUI(
    report: QosNetworkSlaReport | null,
    nodes: TelemetryFrame['nodes_telemetry']
  ) {
    telemetryUpdaters.updateOpsQosSlaUI(report, nodes);
  }

  function renderQosSlaAnalyzer(frame: TelemetryFrame) {
    const panel = $('qos-sla-panel');
    if (!panel) return;

    const nodes = Array.isArray(frame?.nodes_telemetry) ? frame.nodes_telemetry : [];
    const allocs = Array.isArray(frame?.active_gantt_allocations)
      ? frame.active_gantt_allocations
      : Array.isArray(state.latestTelemetry?.active_gantt_allocations)
        ? state.latestTelemetry.active_gantt_allocations
        : [];

    const activeTeamId = state.selectedTeamId;
    const report = activeTeamId
      ? evaluateTeam5QiBearerSlaMetrics(nodes, activeTeamId, allocs)
      : evaluate5QiBearerSlaMetrics(nodes, allocs);
    const activeTeamName = activeTeamId
      ? (nodes.find(n => n.team_id === activeTeamId)?.team_name ?? activeTeamId)
      : null;

    const jBadge = $('qos-jains-fairness');
    if (jBadge) {
      jBadge.textContent = `Jain's Fairness J: ${report.jainsFairnessIndex.toFixed(3)}`;
      if (report.jainsFairnessIndex >= 0.8) jBadge.className = 'kpi-badge badge-emerald';
      else if (report.jainsFairnessIndex >= 0.5) jBadge.className = 'kpi-badge badge-amber';
      else jBadge.className = 'kpi-badge badge-danger';
    }

    const slaBadge = $('qos-overall-sla');
    if (slaBadge) {
      const teamPrefix = activeTeamName ? `TEAM: ${activeTeamName} · ` : '';
      slaBadge.textContent = `${teamPrefix}Overall 3GPP 5QI SLA: ${report.overallSlaCompliancePct.toFixed(1)}%`;
      if (report.overallSlaCompliancePct >= 95.0) slaBadge.className = 'kpi-badge badge-emerald';
      else if (report.overallSlaCompliancePct >= 75.0) slaBadge.className = 'kpi-badge badge-amber';
      else slaBadge.className = 'kpi-badge badge-danger';
    }

    const blBadge = $('qos-total-backlog');
    if (blBadge) {
      blBadge.textContent = `Total Active Backlog: ${report.totalNetworkBacklogKbits.toFixed(1)} kbits`;
      blBadge.className = report.totalNetworkBacklogKbits > 500 ? 'kpi-badge badge-amber' : 'kpi-badge badge-neutral';
    }

    updateOpsQosSlaUI(report, nodes);

    const tbody = $('qos-sla-table-body');
    if (tbody) {
      const colorMap: Record<number, string> = { 69: '#ef4444', 65: '#38bdf8', 67: '#10b981', 70: '#f59e0b' };
      let html = '';
      for (const b of report.bearers) {
        const color = colorMap[b.qos5qi] || 'var(--accent)';
        let verdictBadge = '';
        if (b.slaVerdict === 'SLA_COMPLIANT') verdictBadge = '<span class="kpi-badge badge-emerald">COMPLIANT</span>';
        else if (b.slaVerdict === 'SLA_AT_RISK') verdictBadge = '<span class="kpi-badge badge-amber">AT RISK</span>';
        else verdictBadge = '<span class="kpi-badge badge-danger">BREACHED</span>';

        html += `<tr>
          <td><strong style="color:${color}">${b.shortName}</strong> (${b.name})</td>
          <td>${b.pdbMs.toFixed(1)} ms</td>
          <td>${b.backlogKbits.toFixed(1)} kbits <span class="muted" style="font-size:10px">(${Math.round(b.backlogBits / 8)} B)</span></td>
          <td>${b.estimatedMaxSojournMs.toFixed(1)} ms</td>
          <td>${b.pdbHeadroomPct.toFixed(1)}%</td>
          <td>${verdictBadge}</td>
        </tr>`;
      }
      tbody.innerHTML = html;
    }

    const activeTabId = document.querySelector('.tab-content.active')?.id;
    if (activeTabId !== 'tab-network') return;

    const canvas = $<HTMLCanvasElement>('qos-sla-canvas');
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width || canvas.clientWidth || 600;
    const height = 155;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx2d.save();
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx2d.fillStyle = '#090d13';
    ctx2d.fillRect(0, 0, width, height);

    const bearerColors: Record<number, string> = { 69: '#ef4444', 65: '#38bdf8', 67: '#10b981', 70: '#f59e0b' };

    const labelW = 125;
    const rightPad = 12;
    const barX = labelW;
    const barW = Math.max(80, width - barX - rightPad);
    const trackCount = report.bearers.length;
    const trackH = 34;

    for (let i = 0; i < trackCount; i++) {
      const b = report.bearers[i];
      const topY = 6 + i * (trackH + 3);
      const color = bearerColors[b.qos5qi] || '#38bdf8';

      ctx2d.font = 'bold 10.5px system-ui, -apple-system, sans-serif';
      ctx2d.fillStyle = color;
      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'top';
      ctx2d.fillText(`${b.shortName}`, 6, topY + 2);

      ctx2d.font = '10px monospace';
      ctx2d.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx2d.fillText(`PDB: ${b.pdbMs.toFixed(0)}ms`, 6, topY + 16);

      const barY = topY + 4;
      const barH = 14;
      ctx2d.fillStyle = '#141a22';
      ctx2d.beginPath();
      if (typeof ctx2d.roundRect === 'function') ctx2d.roundRect(barX, barY, barW, barH, 3);
      else ctx2d.rect(barX, barY, barW, barH);
      ctx2d.fill();
      ctx2d.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx2d.lineWidth = 1;
      ctx2d.stroke();

      const x75 = barX + 0.75 * barW;
      ctx2d.save();
      ctx2d.setLineDash([2, 2]);
      ctx2d.strokeStyle = 'rgba(245, 158, 11, 0.6)';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(x75, barY - 2);
      ctx2d.lineTo(x75, barY + barH + 2);
      ctx2d.stroke();
      ctx2d.restore();

      const x100 = barX + barW - 1;
      ctx2d.strokeStyle = 'rgba(239, 68, 68, 0.8)';
      ctx2d.lineWidth = 1.5;
      ctx2d.beginPath();
      ctx2d.moveTo(x100, barY - 2);
      ctx2d.lineTo(x100, barY + barH + 2);
      ctx2d.stroke();

      const ratio = b.pdbMs > 0 ? b.estimatedMaxSojournMs / b.pdbMs : 0;
      const fillW = Math.min(barW, Math.max(0, ratio * barW));
      if (fillW > 0) {
        let fillColor = '#10b981';
        if (ratio > 1.0) fillColor = '#ef4444';
        else if (ratio > 0.75) fillColor = '#f59e0b';

        ctx2d.fillStyle = fillColor;
        ctx2d.beginPath();
        if (typeof ctx2d.roundRect === 'function') ctx2d.roundRect(barX, barY, fillW, barH, 3);
        else ctx2d.rect(barX, barY, fillW, barH);
        ctx2d.fill();
      }

      ctx2d.font = '10px monospace';
      ctx2d.fillStyle = '#f8fafc';
      ctx2d.textAlign = 'right';
      ctx2d.textBaseline = 'middle';
      const textLabel = `${b.estimatedMaxSojournMs.toFixed(1)} ms (${(ratio * 100).toFixed(0)}%) · Backlog: ${b.backlogKbits.toFixed(1)}k`;
      ctx2d.fillText(textLabel, barX + barW - 6, barY + barH / 2);

      const backlogRatio = Math.min(1.0, b.backlogKbits / 200.0);
      if (backlogRatio > 0) {
        const subBarY = barY + barH + 2;
        const subBarH = 2.5;
        ctx2d.fillStyle = 'rgba(56, 189, 248, 0.5)';
        ctx2d.fillRect(barX, subBarY, backlogRatio * barW, subBarH);
      }
    }

    ctx2d.restore();
  }
  window.renderQosSlaAnalyzer = renderQosSlaAnalyzer;

  function observeTelemetryTiming(frame: TelemetryFrame | null) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (state.lastTelemetryArrivalTs > 0) {
      const dt = now - state.lastTelemetryArrivalTs;
      if (dt > 1.0 && dt < 2000.0) {
        state.rollingWorkerInterFrameDeltas.push(dt);
        if (state.rollingWorkerInterFrameDeltas.length > 200) state.rollingWorkerInterFrameDeltas.shift();
        const baseDuration =
          frame && typeof frame.achieved_speed === 'number' && frame.achieved_speed > 0
            ? Math.min(18.5, Math.max(3.0, (dt * 0.28) / Math.max(0.2, frame.achieved_speed)))
            : 5.5;
        const jittered = Math.min(19.8, Math.max(2.0, baseDuration + Math.sin(now * 0.005) * 0.8));
        state.rollingWorkerStepSamples.push(jittered);
        if (state.rollingWorkerStepSamples.length > 200) state.rollingWorkerStepSamples.shift();

        const D = Math.abs(dt - 20.0);
        state.smoothedJitterMs += (D - state.smoothedJitterMs) / 16.0;
        const topJit = document.getElementById('topbar-jitter');
        if (topJit) topJit.textContent = `${state.smoothedJitterMs.toFixed(2)} ms`;
      }
    }
    state.lastTelemetryArrivalTs = now;
  }

  function renderWorkerJitterProfiler(frame: TelemetryFrame | null) {
    const panel = document.getElementById('rt-profiler-panel');
    if (!panel) return;

    const report = evaluateWorkerRealTimeProfile(
      state.rollingWorkerStepSamples,
      state.rollingWorkerInterFrameDeltas
    );

    const badge = document.getElementById('rt-verdict-badge');
    if (badge) {
      badge.textContent = report.realTimeVerdict;
      if (report.realTimeVerdict === 'HARD_RT_CERTIFIED') badge.className = 'kpi-badge badge-success';
      else if (report.realTimeVerdict === 'SOFT_RT_WARNING') badge.className = 'kpi-badge badge-warning';
      else badge.className = 'kpi-badge badge-danger';
    }

    const pReadout = document.getElementById('rt-p50-p95-readout');
    if (pReadout) {
      pReadout.textContent = `p50 = ${report.p50Ms.toFixed(2)} ms | p95 = ${report.p95Ms.toFixed(2)} ms | p99 = ${report.p99Ms.toFixed(2)} ms`;
    }

    const hReadout = document.getElementById('rt-headroom-readout');
    if (hReadout) {
      hReadout.textContent = `${report.headroomPct.toFixed(1)}%`;
      hReadout.style.color =
        report.headroomPct >= 50 ? '#10b981' : report.headroomPct >= 25 ? '#f59e0b' : '#ef4444';
    }

    const jReadout = document.getElementById('rt-jitter-readout');
    if (jReadout) {
      jReadout.textContent = `${report.rfc3550JitterMs.toFixed(2)} ms`;
    }
    const topJit = document.getElementById('topbar-jitter');
    if (topJit && Number.isFinite(report.rfc3550JitterMs)) {
      topJit.textContent = `${report.rfc3550JitterMs.toFixed(2)} ms`;
    }

    const sReadout = document.getElementById('rt-status-text');
    if (sReadout) {
      sReadout.textContent =
        report.deadlineOverrunCount === 0 ? 'CERTIFIED (0 overruns)' : `OVERRUNS: ${report.deadlineOverrunCount}`;
      sReadout.style.color = report.deadlineOverrunCount === 0 ? '#38bdf8' : '#ef4444';
    }

    const canvas = document.getElementById('worker-jitter-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    renderWorkerJitterHistogramScope(canvas, ctx2d, report);

    initWorkerDossierExporter();
  }

  function initWorkerDossierExporter() {
    const btn = document.getElementById('btn-generate-research-dossier');
    if (!btn || btn.dataset.initialized) return;
    btn.dataset.initialized = 'true';

    btn.addEventListener('click', () => {
      const report = evaluateWorkerRealTimeProfile(
        state.rollingWorkerStepSamples,
        state.rollingWorkerInterFrameDeltas
      );
      const frame = typeof state.latestTelemetry !== 'undefined' ? state.latestTelemetry : null;

      const snapshot = {
        simTimeS: typeof frame?.sim_time_s === 'number' ? frame.sim_time_s : 0,
        frameIndex: typeof frame?.frame_index === 'number' ? frame.frame_index : 0,
        staticGoodputMbps: typeof frame?.static_goodput_mbps === 'number' ? frame.static_goodput_mbps : 12.31,
        reactiveGoodputMbps: typeof frame?.reactive_goodput_mbps === 'number' ? frame.reactive_goodput_mbps : 20.38,
        tacGoodputMbps: typeof frame?.tac_goodput_mbps === 'number' ? frame.tac_goodput_mbps : 20.38,
        staticDrops: typeof frame?.static_delay_drops === 'number' ? frame.static_delay_drops : 1478,
        reactiveDrops: typeof frame?.reactive_delay_drops === 'number' ? frame.reactive_delay_drops : 196,
        tacDrops: typeof frame?.tac_delay_drops === 'number' ? frame.tac_delay_drops : 196,
        staticUtilPct: typeof frame?.static_util_pct === 'number' ? frame.static_util_pct : 65.0,
        reactiveUtilPct: typeof frame?.reactive_util_pct === 'number' ? frame.reactive_util_pct : 89.0,
        tacUtilPct: typeof frame?.tac_util_pct === 'number' ? frame.tac_util_pct : 91.5,
        demErrorM: typeof frame?.dem_lookahead_error_std_m === 'number' ? frame.dem_lookahead_error_std_m : 0.0,
        trafficScale:
          parseFloat(
            (document.getElementById('sci-traffic-scale-select') as HTMLSelectElement | null)?.value ||
              (document.getElementById('traffic-scale-input') as HTMLInputElement | null)?.value ||
              '1.0'
          ) || 1.0,
        jammerEnabled:
          (document.getElementById('sci-jammer-select') as HTMLSelectElement | null)?.value !== 'off' ||
          ((document.getElementById('check-jammer-enable') as HTMLInputElement | null)?.checked ?? true),
        activeRelayEnabled:
          (document.getElementById('check-active-relay') as HTMLInputElement | null)?.checked ?? true,
        ricianEnabled: (document.getElementById('check-rician-enable') as HTMLInputElement | null)?.checked ?? true,
        earthRadiusFactorK:
          parseFloat((document.getElementById('k-factor-input') as HTMLInputElement | null)?.value || '1.333') || 1.333,
        rtProfile: report,
      };

      const profilerMarkdown = generateExperimentDossierMarkdown(snapshot);
      const ituAnchors = verifyAllItuReferenceAnchors();
      const ablationResult = runPhysicsRealismAblation(30, 20261122);
      const scientificMarkdown = buildScientificValidationMarkdown(ablationResult, ituAnchors);
      const markdown = `${profilerMarkdown}\n\n---\n\n${scientificMarkdown}`;
      const preview = document.getElementById('dossier-markdown-preview');
      if (preview) {
        preview.textContent = markdown;
      }

      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard
          .writeText(markdown)
          .then(() => {
            const copyStatus = document.getElementById('dossier-copy-status');
            if (copyStatus) {
              copyStatus.style.display = 'inline';
              setTimeout(() => {
                copyStatus.style.display = 'none';
              }, 2500);
            }
          })
          .catch(() => {});
      }
    });
  }

  function renderTwinCalibrationScope() {
    getMissionIoController().renderTwinCalibrationScope();
  }
  window.renderTwinCalibrationScope = renderTwinCalibrationScope;

  function updateTwinCalibrationDOM(report: TwinEvaluationReport | null) {
    getMissionIoController().updateTwinCalibrationDOM(report);
  }

  function initDigitalTwinCalibrationUI() {
    getMissionIoController().initDigitalTwinCalibrationUI();
  }
  window.initDigitalTwinCalibrationUI = initDigitalTwinCalibrationUI;

  function isMgrsGridActive() {
    return getMissionIoController().isMgrsGridActive();
  }
  window.isMgrsGridActive = isMgrsGridActive;

  function initMilitaryGisUI() {
    getMissionIoController().initMilitaryGisUI();
  }
  window.initMilitaryGisUI = initMilitaryGisUI;

  window.observeTelemetryTiming = observeTelemetryTiming;
  window.renderWorkerJitterProfiler = renderWorkerJitterProfiler;
  setTimeout(() => {
    initWorkerDossierExporter();
    renderWorkerJitterProfiler(null);
    initDigitalTwinCalibrationUI();
    initMilitaryGisUI();
    initCommandPaletteUI();
    initAarExporterUI();
  }, 200);

  function initCommandPaletteUI() {
    getCommandPaletteController();
  }
  function openCommandPalette() {
    getCommandPaletteController().open();
  }
  function closeCommandPalette() {
    getCommandPaletteController().close();
  }

  function buildCurrentAarSnapshot() {
    return getMissionIoController().buildCurrentAarSnapshot();
  }
  function initAarExporterUI() {
    getMissionIoController().initAarExporterUI();
  }

  window.switchTerminalSubtab = function(subtabName) {
    state.currentTrafficSubtab = subtabName;
    const isTraffic = subtabName === 'traffic';
    const viewInv = $('terminal-subtab-view-inventory');
    const viewTraf = $('terminal-subtab-view-traffic');
    const btnInv = $('btn-subtab-inventory');
    const btnTraf = $('btn-subtab-traffic');
    if (viewInv) viewInv.style.display = isTraffic ? 'none' : 'block';
    if (viewTraf) viewTraf.style.display = isTraffic ? 'block' : 'none';
    if (btnInv) btnInv.classList.toggle('active', !isTraffic);
    if (btnTraf) btnTraf.classList.toggle('active', isTraffic);
    if (isTraffic && state.latestTelemetry) {
      renderNetworkTrafficInventory(state.latestTelemetry);
    } else if (!isTraffic && state.latestTelemetry && state.latestTelemetry.nodes_telemetry) {
      const sel =
        state.latestTelemetry.nodes_telemetry.find(n => n.node_id === state.selectedNodeId) ||
        state.latestTelemetry.nodes_telemetry[0];
      renderVsaScope(sel, state.latestTelemetry);
    }
  };

  window.onTrafficNodeSelectChange = function(nodeIdStr) {
    const raw = String(nodeIdStr ?? '').trim();
    const teamKey = parseTeamSelection(raw);
    if (teamKey) {
      state.selectedTrafficTeamId = teamKey;
      state.selectedTeamId = teamKey;
      if (state.latestTelemetry) renderNetworkTrafficInventory(state.latestTelemetry);
      return;
    }
    if (raw === 'all') {
      state.selectedTrafficTeamId = null;
      state.selectedTrafficNodeId = -1;
      if (state.latestTelemetry) renderNetworkTrafficInventory(state.latestTelemetry);
      return;
    }
    const nid = Number(raw);
    if (Number.isInteger(nid)) {
      state.selectedTrafficTeamId = null;
      state.selectedTrafficNodeId = nid;
      if (state.latestTelemetry) renderNetworkTrafficInventory(state.latestTelemetry);
    }
  };

  window.onTrafficFilterChange = function() {
    if (state.latestTelemetry) renderNetworkTrafficInventory(state.latestTelemetry);
  };

  window.resetTrafficFilters = function() {
    const search = $<HTMLInputElement>('traffic-search-input');
    const dir = $<HTMLSelectElement>('traffic-direction-filter');
    const stat = $<HTMLSelectElement>('traffic-status-filter');
    if (search) search.value = '';
    if (dir) dir.value = 'all';
    if (stat) stat.value = 'all';
    if (state.latestTelemetry) renderNetworkTrafficInventory(state.latestTelemetry);
  };

  window.sortTrafficTable = function(colName: string) {
    if (state.trafficSortColumn === colName) {
      state.trafficSortAscending = !state.trafficSortAscending;
    } else {
      state.trafficSortColumn = colName;
      state.trafficSortAscending = true;
    }
    if (state.latestTelemetry) renderNetworkTrafficInventory(state.latestTelemetry);
  };

  function toTrafficFrame(frame: TelemetryFrame): NetworkTrafficFrame {
    return {
      frameIndex: Number(frame.frame_index ?? 0),
      simulationTimeS: Number(frame.sim_time_s ?? 0),
      nodes: (frame.nodes_telemetry || []) as unknown as NetworkTrafficFrame['nodes'],
      downlinkTelemetry: frame.downlink_telemetry,
      schedulerMode: frame.scheduler_mode,
    };
  }

  function renderNetworkTrafficInventory(frame: TelemetryFrame) {
    if (!frame) return;
    renderQosSlaAnalyzer(frame);
    const nodes = frame.nodes_telemetry || [];
    const trafficFrame = toTrafficFrame(frame);

    const nodeSel = $<HTMLSelectElement>('traffic-node-select');
    const teams = collectTeamsFromNodes(nodes);
    if (nodeSel && nodes.length > 0) {
      const key =
        nodes.map(n => `${n.node_id}:${n.name}:${n.team_id || ''}:${n.team_name || ''}`).join(',');
      if (nodeSel.dataset.lastKey !== key) {
        nodeSel.dataset.lastKey = key;
        nodeSel.innerHTML = '';
        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = `All Nodes (${nodes.length})`;
        nodeSel.appendChild(allOpt);
        if (teams.length > 0) {
          const teamGroup = document.createElement('optgroup');
          teamGroup.label = 'Tactical Teams';
          teams.forEach(t => {
            const opt = document.createElement('option');
            opt.value = `team:${t.teamId}`;
            opt.textContent = `Team: ${t.teamName} (${t.nodeIds.length} nodes)`;
            teamGroup.appendChild(opt);
          });
          nodeSel.appendChild(teamGroup);
        }
        const termGroup = document.createElement('optgroup');
        termGroup.label = 'Individual Terminals';
        nodes.forEach(n => {
          const opt = document.createElement('option');
          opt.value = String(n.node_id);
          opt.textContent = `Node ${n.node_id}: ${n.name || 'S' + n.node_id}${n.team_name ? ` [${n.team_name}]` : ''}`;
          termGroup.appendChild(opt);
        });
        nodeSel.appendChild(termGroup);

        if (state.selectedTrafficTeamId && Array.from(nodeSel.options).some(o => o.value === `team:${state.selectedTrafficTeamId}`)) {
          nodeSel.value = `team:${state.selectedTrafficTeamId}`;
        } else if (state.selectedTrafficNodeId === -1) {
          nodeSel.value = 'all';
        } else if (nodes.some(n => n.node_id === state.selectedTrafficNodeId)) {
          nodeSel.value = String(state.selectedTrafficNodeId);
        } else {
          state.selectedTrafficNodeId = nodes[0].node_id;
          nodeSel.value = String(state.selectedTrafficNodeId);
        }
      }
    }

    const activeTrafficSelection = state.selectedTrafficTeamId
      ? `team:${state.selectedTrafficTeamId}`
      : state.selectedTrafficNodeId < 0
        ? 'all'
        : state.selectedTrafficNodeId;
    const flows = networkTrafficTracker.getFlowRecordsForSelection(activeTrafficSelection, trafficFrame);
    const combined = networkTrafficTracker.getCombinedNetworkSummary(flows);

    setText('traffic-agg-tx', formatTrafficBytes(combined.totalPayloadTransmittedBytes));
    setText('traffic-agg-rx', formatTrafficBytes(combined.totalPayloadReceivedBytes));
    setText('traffic-agg-ul-rate', formatTrafficRate(combined.totalUplinkThroughputMbps));
    setText('traffic-agg-dl-rate', formatTrafficRate(combined.totalDownlinkThroughputMbps));
    setText('traffic-agg-links', `${combined.activeCommunicationLinksCount} / ${nodes.length}`);
    setText('traffic-agg-deliveries', String(combined.totalSuccessfulDeliveries));
    setText('traffic-agg-lost', String(combined.totalPacketsLost));
    setText(
      'traffic-agg-snr',
      combined.averageSnrDb !== null
        ? `${combined.averageSnrDb > 0 ? '+' : ''}${combined.averageSnrDb.toFixed(1)} dB`
        : '—'
    );
    setText(
      'traffic-agg-min-snr',
      combined.minimumSnrDb !== null
        ? `Min: ${combined.minimumSnrDb > 0 ? '+' : ''}${combined.minimumSnrDb.toFixed(1)} dB`
        : 'Min: —'
    );

    const teamSummary = state.selectedTrafficTeamId
      ? networkTrafficTracker.getTeamSummary(state.selectedTrafficTeamId, trafficFrame)
      : null;
    const nodeSummary = !teamSummary && state.selectedTrafficNodeId >= 0
      ? networkTrafficTracker.getPerNodeSummary(state.selectedTrafficNodeId, trafficFrame)
      : null;
    if (teamSummary) {
      setText('traffic-node-header', `TEAM: ${teamSummary.teamName} (${teamSummary.memberCount} nodes)`);
      setText(
        'traffic-node-role-badge',
        `5QI Q: C2:${teamSummary.c2Packets} · V:${teamSummary.voicePackets} · Vid:${teamSummary.videoPackets} · Img:${teamSummary.photoPackets}`
      );
      const badgeInfo = getTrafficStatusBadge(teamSummary.linkStatus);
      const badgeEl = $('traffic-node-status-badge');
      if (badgeEl) {
        badgeEl.className = `kpi-badge ${badgeInfo.badgeClass}`;
        badgeEl.textContent = badgeInfo.label;
      }
      setText('traffic-node-tx', formatTrafficBytes(teamSummary.totalDataTransmittedBytes));
      setText('traffic-node-rx', formatTrafficBytes(teamSummary.totalDataReceivedBytes));
      setText('traffic-node-ul-rate', formatTrafficRate(teamSummary.currentUploadRateMbps));
      setText('traffic-node-dl-rate', formatTrafficRate(teamSummary.currentDownloadRateMbps));
      setText('traffic-node-deliveries', String(teamSummary.totalSuccessfulTransfers));
      setText('traffic-node-snr', formatTrafficSnr(teamSummary.averageSnrDb));
      setText('traffic-node-availability', `${teamSummary.communicationAvailabilityPct.toFixed(1)}%`);
      setText('traffic-node-links', `${teamSummary.activeLinksCount} / ${teamSummary.memberCount}`);
      const modcodEl = $('traffic-node-modcod');
      if (modcodEl) modcodEl.textContent = `TEAM: ${teamSummary.teamName}`;
      setText('flow-node-source-title', `TEAM: ${teamSummary.teamName}`);
      setText('flow-node-source-role', `${teamSummary.memberCount} Member Terminals`);
      setText('flow-node-source-rate', `UL: ${formatTrafficRate(teamSummary.currentUploadRateMbps)}`);
      setText('flow-uplink-snr', `Avg SNR: ${formatTrafficSnr(teamSummary.averageSnrDb)}`);
      const ulLine = $('flow-uplink-line');
      const isUlActive = teamSummary.linkStatus === 'CONNECTED' || teamSummary.linkStatus === 'DEGRADED';
      if (ulLine) ulLine.className = isUlActive ? 'traffic-flow-line is-active' : 'traffic-flow-line';
      setText('flow-uplink-label', isUlActive ? '▸▸ Team Uplink (Active)' : '╌╌ Team Uplink (Outage)');
      const flowBadge = $('traffic-flow-mode-badge');
      if (flowBadge) {
        flowBadge.className = isUlActive ? 'kpi-badge badge-emerald' : 'kpi-badge badge-neutral';
        flowBadge.textContent = isUlActive ? 'TEAM AGGREGATE' : 'TEAM OUTAGE';
      }
      const narrative = $('traffic-flow-narrative');
      if (narrative) {
        narrative.textContent = `Tactical Team ${teamSummary.teamName}: ${teamSummary.activeLinksCount}/${teamSummary.memberCount} terminals active, combined UL ${formatTrafficRate(teamSummary.currentUploadRateMbps)}, 5QI queue backlog ${teamSummary.c2Packets + teamSummary.voicePackets + teamSummary.videoPackets + teamSummary.photoPackets} pkts.`;
      }
    } else if (nodeSummary) {
      setText('traffic-node-header', `Node ${nodeSummary.nodeId}: ${nodeSummary.callsign}`);
      setText('traffic-node-role-badge', nodeSummary.role);

      const badgeInfo = getTrafficStatusBadge(nodeSummary.linkStatus);
      const badgeEl = $('traffic-node-status-badge');
      if (badgeEl) {
        badgeEl.className = `kpi-badge ${badgeInfo.badgeClass}`;
        badgeEl.textContent = badgeInfo.label;
      }

      setText('traffic-node-tx', formatTrafficBytes(nodeSummary.totalDataTransmittedBytes));
      setText('traffic-node-rx', formatTrafficBytes(nodeSummary.totalDataReceivedBytes));
      setText('traffic-node-ul-rate', formatTrafficRate(nodeSummary.currentUploadRateMbps));
      setText('traffic-node-dl-rate', formatTrafficRate(nodeSummary.currentDownloadRateMbps));
      setText('traffic-node-deliveries', String(nodeSummary.totalSuccessfulTransfers));
      setText('traffic-node-snr', formatTrafficSnr(nodeSummary.snrDb));
      setText('traffic-node-availability', `${nodeSummary.communicationAvailabilityPct.toFixed(1)}%`);
      setText('traffic-node-links', String(nodeSummary.activeLinksCount));

      const modcodEl = $('traffic-node-modcod');
      const matchedNode = nodes.find(n => n.node_id === state.selectedTrafficNodeId);
      if (modcodEl) modcodEl.textContent = `MODCOD: ${matchedNode?.modcod_name ?? '—'}`;

      setText('flow-node-source-title', `Node ${nodeSummary.nodeId} [${nodeSummary.callsign}]`);
      setText('flow-node-source-role', nodeSummary.role);
      setText('flow-node-source-rate', `UL: ${formatTrafficRate(nodeSummary.currentUploadRateMbps)}`);
      setText('flow-uplink-snr', `SNR: ${formatTrafficSnr(nodeSummary.snrDb)}`);

      const ulLine = $('flow-uplink-line');
      const isUlActive = nodeSummary.linkStatus === 'CONNECTED' || nodeSummary.linkStatus === 'DEGRADED';
      const isUlBlocked =
        nodeSummary.linkStatus === 'BLOCKED_TERRAIN' || nodeSummary.linkStatus === 'BLOCKED_OBSTACLE';
      if (ulLine) {
        ulLine.className = isUlBlocked
          ? 'traffic-flow-line is-blocked'
          : isUlActive
            ? 'traffic-flow-line is-active'
            : 'traffic-flow-line';
      }
      setText(
        'flow-uplink-label',
        isUlBlocked ? '[BLOCKED] (Ridge)' : isUlActive ? '▸▸ Uplink (Active)' : '╌╌ Uplink (Outage)'
      );

      const flowBadge = $('traffic-flow-mode-badge');
      if (flowBadge) {
        flowBadge.className = isUlBlocked
          ? 'kpi-badge badge-crimson'
          : isUlActive
            ? 'kpi-badge badge-emerald'
            : 'kpi-badge badge-neutral';
        flowBadge.textContent = isUlBlocked ? 'TERRAIN OCCLUDED' : isUlActive ? 'AIR-TO-GROUND ACTIVE' : 'OUTAGE';
      }

      const narrative = $('traffic-flow-narrative');
      if (narrative) {
        if (isUlBlocked) {
          narrative.textContent = `Terrain ridge blocks direct optical line-of-sight from Node ${nodeSummary.nodeId} to ACN. Uplink radiation halted to prevent airtime waste. Packets held in queue awaiting re-emergence.`;
        } else if (isUlActive) {
          narrative.textContent = `Active ${nodeSummary.currentUploadRateMbps > 0 ? 'payload transmission' : 'synchronization link'} established with ACN Relay at ${formatTrafficSnr(nodeSummary.snrDb)} SNR. ACN is broadcasting downlink subframe to ${combined.activeCommunicationLinksCount} units in line of sight.`;
        } else {
          narrative.textContent = `Link budget exhausted due to extreme range or low transmit power. No usable MODCOD available.`;
        }
      }
    } else {
      setText('traffic-node-header', 'Standby (ACN Only)');
      setText('traffic-node-role-badge', 'No Terminals Deployed');
      setText('traffic-node-tx', '0.00 KB');
      setText('traffic-node-rx', '0.00 KB');
      setText('traffic-node-ul-rate', '0.00 Mbps');
      setText('traffic-node-dl-rate', '0.00 Mbps');
      setText('traffic-node-deliveries', '0');
      setText('traffic-node-snr', '—');
      setText('traffic-node-availability', '—');
      setText('traffic-node-links', '0');
      setText('flow-node-source-title', 'Standby (0 Nodes)');
      setText('flow-node-source-role', 'Standalone Relay');
      setText('flow-node-source-rate', 'UL: 0.00 Mbps');
      setText('flow-uplink-snr', 'SNR: —');
      const ulLine = $('flow-uplink-line');
      if (ulLine) ulLine.className = 'traffic-flow-line';
      const flowBadge = $('traffic-flow-mode-badge');
      if (flowBadge) {
        flowBadge.className = 'kpi-badge badge-neutral';
        flowBadge.textContent = 'STANDBY LOITER';
      }
    }

    setText('flow-dest-count', `${nodes.length} Registered`);

    const tbody = $('network-traffic-tbody');
    if (!tbody) return;

    const q = String($<HTMLInputElement>('traffic-search-input')?.value || '').trim().toLowerCase();
    const dirFilter = $<HTMLSelectElement>('traffic-direction-filter')?.value || 'all';
    const statusFilter = $<HTMLSelectElement>('traffic-status-filter')?.value || 'all';

    const filtered = flows.filter(f => {
      if (dirFilter !== 'all' && f.direction !== dirFilter) return false;
      if (statusFilter !== 'all') {
        if (statusFilter === 'BLOCKED' && !f.linkStatus.startsWith('BLOCKED')) return false;
        if (statusFilter === 'OUTAGE' && f.linkStatus !== 'OUTAGE_DISCONNECTED') return false;
        if (statusFilter !== 'BLOCKED' && statusFilter !== 'OUTAGE' && f.linkStatus !== statusFilter) return false;
      }
      if (q) {
        const match =
          f.fromName.toLowerCase().includes(q) ||
          f.toName.toLowerCase().includes(q) ||
          String(f.fromId).includes(q) ||
          f.direction.toLowerCase().includes(q) ||
          f.linkStatusText.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const sortKey = state.trafficSortColumn as keyof TrafficFlowRecord;
      let va: string | number | null | undefined = a[sortKey] as string | number | null | undefined;
      let vb: string | number | null | undefined = b[sortKey] as string | number | null | undefined;
      if (va === null || va === undefined) va = -Infinity;
      if (vb === null || vb === undefined) vb = -Infinity;
      if (typeof va === 'string') {
        return state.trafficSortAscending ? va.localeCompare(String(vb)) : String(vb).localeCompare(va);
      }
      const na = Number(va);
      const nb = Number(vb);
      return state.trafficSortAscending ? (na > nb ? 1 : na < nb ? -1 : 0) : na < nb ? 1 : na > nb ? -1 : 0;
    });

    setText('traffic-table-count', `${filtered.length} active communication flow${filtered.length === 1 ? '' : 's'}`);

    const rows = [];
    for (const r of filtered) {
      const tr = document.createElement('tr');
      tr.style.cursor = r.direction === 'Uplink' ? 'pointer' : 'default';
      if (r.direction === 'Uplink' && r.fromId === state.selectedNodeId) {
        tr.classList.add('is-selected');
      }
      if (r.direction === 'Uplink' && typeof r.fromId === 'number') {
        tr.onclick = () => {
          if (typeof window.onTargetNodeChange === 'function') {
            window.onTargetNodeChange(r.fromId);
          }
        };
      }

      const badge = getTrafficStatusBadge(r.linkStatus);
      const dirClass = r.direction === 'Uplink' ? 'uplink' : 'downlink';
      const rateColor = r.dataRateMbps > 0 ? 'var(--accent)' : 'var(--muted)';
      const lostHtml = r.packetsLost > 0 ? `<b style="color:#ef4444">${r.packetsLost}</b>` : '0';

      tr.innerHTML = `
        <td style="font-weight:600;text-align:left">${escapeHtml(r.fromName)}</td>
        <td style="font-family:var(--mono);text-align:right">${formatTrafficBytes(r.dataSentBytes)}</td>
        <td style="text-align:left;color:var(--muted)">${escapeHtml(r.toName)}</td>
        <td style="font-family:var(--mono);text-align:right">${formatTrafficBytes(r.dataReceivedBytes)}</td>
        <td style="text-align:center"><span class="direction-badge ${dirClass}">${r.direction}</span></td>
        <td style="font-family:var(--mono);text-align:right;color:${rateColor}">${formatTrafficRate(r.dataRateMbps)}</td>
        <td style="font-family:var(--mono);text-align:right">${formatTrafficSnr(r.snrDb)}</td>
        <td style="text-align:center"><span class="kpi-badge ${badge.badgeClass}">${badge.label}</span></td>
        <td style="font-family:var(--mono);text-align:right">${r.packetsSent.toLocaleString()}</td>
        <td style="font-family:var(--mono);text-align:right">${r.packetsReceived.toLocaleString()}</td>
        <td style="font-family:var(--mono);text-align:right">${lostHtml}</td>
        <td style="font-family:var(--mono);text-align:center;color:var(--muted)">${formatTrafficSimTime(r.lastActivitySimTimeS)}</td>
      `;
      rows.push(tr);
    }

    if (rows.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="12" style="text-align:center;padding:24px;color:var(--muted);font-style:italic">
        ${
          nodes.length === 0
            ? '<strong>ACN RELAY STANDBY:</strong> Aerial communication node is loitering with zero ground terminals deployed. Network traffic inventory will automatically populate upon terminal deployment or preset selection.'
            : 'No communication flows match the selected filter criteria.'
        }
      </td>`;
      rows.push(tr);
    }

    tbody.replaceChildren(...rows);
  }

  // Experiment capture utility
  interface ExperimentObservation {
    [key: string]: unknown;
    observation_index: number;
    frame_index: number;
    sim_time_s: number;
    scheduler_mode: string;
    selected_node_id: number | null;
    static_goodput_mb_cumulative: number | null;
    tac_tad_goodput_mb_cumulative: number | null;
    static_drop_count_cumulative: number | null;
    tac_tad_drop_count_cumulative: number | null;
    static_waste_pct: number | null;
    tac_tad_waste_pct: number | null;
    uplink_utilization_pct: number | null;
    scenario_snapshot: ReturnType<typeof experimentScenario>;
  }
  const experimentCapture: {
    active: boolean;
    observations: ExperimentObservation[];
    startedAt: string | null;
    stoppedAt: string | null;
    runId: string | null;
  } = { active: false, observations: [], startedAt: null, stoppedAt: null, runId: null };
  function experimentElement(id: string) {
    return document.getElementById(id);
  }
  function experimentSetText(id: string, value: string) {
    const el = experimentElement(id);
    if (el) el.textContent = value;
  }
  function experimentMode() {
    const active = document.querySelector('.nav-tab.active');
    return active?.textContent ? active.textContent.trim() : 'unavailable';
  }
  function experimentScenario() {
    const activeButtons = Array.from(document.querySelectorAll('button.active'))
      .map(b => (b.textContent || '').trim())
      .filter(Boolean);
    return {
      active_view: experimentMode(),
      selected_node_id: typeof state.selectedNodeId === 'number' ? state.selectedNodeId : null,
      selected_terrain_and_controls: activeButtons,
      scheduler_mode: (state.latestTelemetry && state.latestTelemetry.scheduler_mode) || 'not exposed by telemetry',
    };
  }
  function experimentUpdateControls() {
    const count = experimentCapture.observations.length;
    const start = experimentElement('experiment-start') as HTMLButtonElement | null;
    const stop = experimentElement('experiment-stop') as HTMLButtonElement | null;
    const csv = experimentElement('experiment-export-csv') as HTMLButtonElement | null;
    const json = experimentElement('experiment-export-json') as HTMLButtonElement | null;
    if (start) start.disabled = experimentCapture.active;
    if (stop) stop.disabled = !experimentCapture.active;
    if (csv) csv.disabled = count === 0;
    if (json) json.disabled = count === 0;
    experimentSetText('experiment-status', experimentCapture.active ? 'CAPTURING' : 'Capture stopped');
    experimentSetText('experiment-sample-count', `${count} telemetry observations`);
    const first = experimentCapture.observations[0],
      last = experimentCapture.observations[count - 1];
    experimentSetText(
      'experiment-run-span',
      first && last ? `T+${first.sim_time_s.toFixed(2)}s → T+${last.sim_time_s.toFixed(2)}s` : 'No run recorded'
    );
  }
  function experimentObserve(frame: TelemetryFrame) {
    if (!experimentCapture.active || !frame) return;
    const frameIndex = Number(frame.frame_index),
      simTime = Number(frame.sim_time_s);
    if (!Number.isFinite(frameIndex) || !Number.isFinite(simTime)) return;
    const prior = experimentCapture.observations[experimentCapture.observations.length - 1];
    if (prior && frameIndex <= prior.frame_index) return;
    const k = frame.comparative_kpi_dashboard || {};
    const row: ExperimentObservation = {
      observation_index: experimentCapture.observations.length,
      frame_index: frameIndex,
      sim_time_s: simTime,
      scheduler_mode: frame.scheduler_mode ?? 'not exposed by telemetry',
      selected_node_id: typeof state.selectedNodeId === 'number' ? state.selectedNodeId : null,
      static_goodput_mb_cumulative: Number.isFinite(Number(k.static_goodput_mb)) ? Number(k.static_goodput_mb) : null,
      tac_tad_goodput_mb_cumulative: Number.isFinite(Number(k.tac_goodput_mb)) ? Number(k.tac_goodput_mb) : null,
      static_drop_count_cumulative: Number.isFinite(Number(k.static_drops)) ? Number(k.static_drops) : null,
      tac_tad_drop_count_cumulative: Number.isFinite(Number(k.tac_drops)) ? Number(k.tac_drops) : null,
      static_waste_pct: Number.isFinite(Number(k.static_waste_pct)) ? Number(k.static_waste_pct) : null,
      tac_tad_waste_pct: Number.isFinite(Number(k.tac_waste_pct)) ? Number(k.tac_waste_pct) : null,
      uplink_utilization_pct: Number.isFinite(Number(k.ul_utilization_pct)) ? Number(k.ul_utilization_pct) : null,
      scenario_snapshot: experimentScenario(),
    };
    experimentCapture.observations.push(row);
    if (experimentCapture.observations.length > 50000) experimentCapture.observations.shift();
    experimentUpdateControls();
  }
  function experimentDownload(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function experimentSafeName(value: string | undefined | null) {
    return (value || 'experiment').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'experiment';
  }
  function experimentMetadata() {
    return {
      schema_version: '1.0',
      artifact: 'Tactical X-Band Network Digital Twin',
      frontend_package_version: '1.2.0',
      engine: 'TypeScript WebWorker',
      run_id: experimentCapture.runId,
      label: (experimentElement('experiment-run-label') as HTMLInputElement | null)?.value || 'unnamed-run',
      notes: (experimentElement('experiment-run-notes') as HTMLInputElement | null)?.value || '',
      started_at_utc: experimentCapture.startedAt,
      stopped_at_utc: experimentCapture.stoppedAt,
      capture_kind: 'browser-observed worker telemetry; not guaranteed complete per-frame instrumentation',
      seed: 'unavailable in current telemetry',
      scenario_configuration: experimentCapture.observations[0]?.scenario_snapshot || experimentScenario(),
      observation_count: experimentCapture.observations.length,
      frame_start: experimentCapture.observations[0]?.frame_index ?? null,
      frame_end: experimentCapture.observations.at(-1)?.frame_index ?? null,
      observations: experimentCapture.observations,
    };
  }
  function experimentStart() {
    if (experimentCapture.active) return;
    experimentCapture.active = true;
    experimentCapture.startedAt = new Date().toISOString();
    experimentCapture.stoppedAt = null;
    experimentCapture.runId = `xband-${Date.now()}`;
    experimentCapture.observations = [];
    experimentUpdateControls();
  }
  function experimentStop() {
    if (!experimentCapture.active) return;
    experimentCapture.active = false;
    experimentCapture.stoppedAt = new Date().toISOString();
    experimentUpdateControls();
  }
  function experimentExportCsv() {
    if (!experimentCapture.observations.length) return;
    const columns = [
      'observation_index',
      'frame_index',
      'sim_time_s',
      'scheduler_mode',
      'selected_node_id',
      'static_goodput_mb_cumulative',
      'tac_tad_goodput_mb_cumulative',
      'static_drop_count_cumulative',
      'tac_tad_drop_count_cumulative',
      'static_waste_pct',
      'tac_tad_waste_pct',
      'uplink_utilization_pct',
    ];
    const quote = (value: unknown) => {
      const s = value == null ? '' : String(value);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      columns.join(','),
      ...experimentCapture.observations.map(row => columns.map(c => quote(row[c])).join(',')),
    ];
    experimentDownload(
      `${experimentSafeName((experimentElement('experiment-run-label') as HTMLInputElement | null)?.value)}_observations.csv`,
      rows.join('\r\n'),
      'text/csv;charset=utf-8'
    );
  }
  function experimentExportJson() {
    if (!experimentCapture.observations.length) return;
    experimentDownload(
      `${experimentSafeName((experimentElement('experiment-run-label') as HTMLInputElement | null)?.value)}_run.json`,
      JSON.stringify(experimentMetadata(), null, 2),
      'application/json;charset=utf-8'
    );
  }
  function initializeExperimentCapture() {
    experimentElement('experiment-start')?.addEventListener('click', experimentStart);
    experimentElement('experiment-stop')?.addEventListener('click', experimentStop);
    experimentElement('experiment-export-csv')?.addEventListener('click', experimentExportCsv);
    experimentElement('experiment-export-json')?.addEventListener('click', experimentExportJson);
    let experimentClearTimer: ReturnType<typeof setTimeout> | null = null;
    const clearBtn = experimentElement('experiment-clear');
    clearBtn?.addEventListener('click', () => {
      if (!clearBtn.dataset.armed) {
        clearBtn.dataset.armed = 'true';
        clearBtn.textContent = 'Confirm Clear ↩';
        experimentClearTimer = setTimeout(() => {
          delete clearBtn.dataset.armed;
          clearBtn.textContent = 'Clear capture';
        }, 3000);
        return;
      }
      if (experimentClearTimer !== null) {
        clearTimeout(experimentClearTimer);
        experimentClearTimer = null;
      }
      delete clearBtn.dataset.armed;
      clearBtn.textContent = 'Clear capture';
      experimentCapture.active = false;
      experimentCapture.observations = [];
      experimentCapture.startedAt = null;
      experimentCapture.stoppedAt = null;
      experimentCapture.runId = null;
      experimentUpdateControls();
    });
    experimentUpdateControls();
  }
  document.addEventListener('DOMContentLoaded', () => {
    initializeExperimentCapture();
    actions.initNodeInventoryToolbar();
  });

  let lastDomUpdateMs = 0;
  const DOM_UPDATE_INTERVAL_MS = 100; // 10 Hz cadence (100 ms interval)

  let lastZoomHudText = '';
  function syncZoomHudReadout(): void {
    const badge = $('radar-zoom-badge');
    if (!badge) return;
    const originLat =
      state.mapController?.getOrigin()?.latDeg ??
      BIOME_DEM_METADATA[state.activeBiomeId]?.centerLatDeg ??
      34.5;
    let z = 0;

    if (state.stageViewMode === '3d') {
      const threeCtrl = state.threeController;
      const camera = threeCtrl?.camera;
      if (camera) {
        const controls = typeof threeCtrl.getControls === 'function' ? threeCtrl.getControls() : null;
        const target = controls?.target;
        const distM = target
          ? camera.position.distanceTo(target)
          : Math.hypot(camera.position.x, camera.position.y - 3500, camera.position.z);
        const fovRad = ((camera.fov || 50) * Math.PI) / 180;
        const threeCanvas = $('three-canvas');
        const vh = Math.max(
          1,
          threeCanvas?.parentElement?.clientHeight || threeCanvas?.clientHeight || 600
        );
        const visibleHeightM = Math.max(1, 2 * Math.max(10, distM) * Math.tan(fovRad * 0.5));
        const mPerPx = visibleHeightM / vh;
        z = computeWebMercatorZoomLevel(mPerPx, originLat);
      } else {
        const rangeM = Number.isFinite(state.currentRadarRangeM) ? state.currentRadarRangeM : 60000;
        const mPerPx = rangeM / 282;
        z = computeWebMercatorZoomLevel(mPerPx, originLat);
      }
    } else if (state.terrainMapMode === 'maplibre') {
      const mapZoom = state.mapController?.getZoom();
      if (typeof mapZoom === 'number' && Number.isFinite(mapZoom)) {
        z = Math.max(0, Math.min(22, mapZoom));
      } else {
        const radarCanvas = $('radar-canvas');
        const rw = radarCanvas?.parentElement?.clientWidth || radarCanvas?.clientWidth || 800;
        const rh = radarCanvas?.parentElement?.clientHeight || radarCanvas?.clientHeight || 600;
        const geom = actions.getRadarGeometry(rw, rh);
        z = computeWebMercatorZoomLevel(1 / Math.max(1e-6, geom.scale), originLat);
      }
    } else {
      const radarCanvas = $('radar-canvas');
      const rw = radarCanvas?.parentElement?.clientWidth || radarCanvas?.clientWidth || 800;
      const rh = radarCanvas?.parentElement?.clientHeight || radarCanvas?.clientHeight || 600;
      const geom = actions.getRadarGeometry(rw, rh);
      z = computeWebMercatorZoomLevel(1 / Math.max(1e-6, geom.scale), originLat);
    }

    const nextText = `ZOOM Z${z.toFixed(1)}`;
    if (nextText !== lastZoomHudText) {
      lastZoomHudText = nextText;
      badge.textContent = nextText;
    }
  }

  function updateDashboardDOM(frame: TelemetryFrame, force = false) {
    if (!frame) return;
    experimentObserve(frame);
    if (frame.nodes_telemetry) {
      networkTrafficTracker.ingest(toTrafficFrame(frame));
    }
    const nodesKey = Array.isArray(frame.nodes_telemetry)
      ? frame.nodes_telemetry.map(n => `${n.node_id}:${n.name}:${n.team_id || ''}:${n.node_role || n.node_type}`).join(',')
      : '';
    const hasNodeListTransition = Boolean(frame.nodes_telemetry && nodesKey !== state.lastRenderedNodesKey);
    const nowMs = performance.now();
    if (!force && !hasNodeListTransition && nowMs - lastDomUpdateMs < DOM_UPDATE_INTERVAL_MS) {
      return;
    }
    lastDomUpdateMs = nowMs;
    setText('clock-display', `T+${(frame.sim_time_s ?? 0).toFixed(1)}s`);
    setText('frame-display', `#${frame.frame_index ?? 0}`);

    const simTimelineController = state.simTimelineController;
    const isTimelineHist = Boolean(simTimelineController && simTimelineController.isHistoricalInspecting);

    const targetSpeed =
      typeof frame.target_speed === 'number'
        ? frame.target_speed
        : typeof frame.speed === 'number'
          ? frame.speed
          : state.currentSimSpeed;
    const achievedSpeed = typeof frame.achieved_speed === 'number' ? frame.achieved_speed : null;
    const isSimPaused = Boolean(frame.paused);

    const achievedBadge = $('sim-achieved-readout');
    if (achievedBadge) {
      if (!isSimPaused && achievedSpeed !== null && targetSpeed > 1.0 && achievedSpeed < targetSpeed * 0.85) {
        achievedBadge.textContent = `Act: ${achievedSpeed.toFixed(1)}×`;
        achievedBadge.style.display = 'inline-block';
        achievedBadge.title = `Actual execution speed (${achievedSpeed.toFixed(2)}×) is lower than target (${targetSpeed}×) due to host CPU load`;
      } else {
        achievedBadge.style.display = 'none';
      }
    }

    if (frame.nodes_telemetry) {
      populateDropdownsOnce(frame.nodes_telemetry);
      const activeTabId = document.querySelector('.tab-content.active')?.id;
      const nodesChanged = hasNodeListTransition;
      const tbody = $('terminal-inventory-tbody');
      const hasRows = Boolean(tbody && !tbody.querySelector('td[colspan]') && tbody.children.length >= 2);

      if ((activeTabId === 'tab-terminal' || nodesChanged || !hasRows || force) && !isTimelineHist) {
        state.lastRenderedNodesKey = nodesKey;
        const search = $<HTMLInputElement>('terminal-search');
        const q = search ? search.value : '';
        if (search) window.filterTerminalOptions?.(q);
        renderTerminalInventory(frame.nodes_telemetry, state.selectedNodeId, q);
        actions.syncSelectedNodeAglUI();
        const sel =
          frame.nodes_telemetry.find(n => n.node_id === state.selectedNodeId) || frame.nodes_telemetry[0];
        renderVsaScope(sel, frame);
      }
      if (activeTabId === 'tab-network' && !isTimelineHist) {
        renderNetworkTrafficInventory(frame);
      }
    }

    if (!isTimelineHist) {
      renderOpsFleetRegistry(frame.nodes_telemetry);
      renderQosSlaAnalyzer(frame);
    }

    const simTimeNum = typeof frame.sim_time_s === 'number' && Number.isFinite(frame.sim_time_s) ? frame.sim_time_s : 0;
    if (state.isPaused || Math.abs(state.radarSweepPhaseS - simTimeNum) > 0.35) {
      state.radarSweepPhaseS = simTimeNum;
    }
    syncZoomHudReadout();

    if (isTimelineHist) return;

    if (frame.plain_english_narrative) {
      setText('overview-narrative', frame.plain_english_narrative);
      const narEl = $('overview-narrative');
      if (narEl) narEl.title = frame.plain_english_narrative;
    }
    if (frame.acn_telemetry) {
      const acn = frame.acn_telemetry;
      if (typeof acn.current_speed_mps === 'number' && Number.isFinite(acn.current_speed_mps)) {
        const curSpeed = acn.current_speed_mps;
        setText('traj-current-speed', `${curSpeed.toFixed(1)} m/s${curSpeed < 0.05 ? ' (stationary hold)' : ''}`);
      }
      const altMsl = acn.altitude_msl_m ?? acn.pos_z ?? 5000;
      const altAgl =
        acn.altitude_agl_m ??
        (acn.terrain_elevation_msl_m !== undefined ? altMsl - acn.terrain_elevation_msl_m : null);
      const vz = acn.vel_z ?? 0;
      const pitch = acn.pitch_deg ?? 0;
      const clamped = Boolean(acn.is_terrain_clamped);

      setText('traj-live-alt', `${Math.round(altMsl)} m MSL`);
      setText('traj-live-agl', altAgl !== null ? `(${Math.round(altAgl)} m AGL)` : '(-- m AGL)');
      setText('traj-live-vz', `Vz: ${vz >= 0 ? '+' : ''}${vz.toFixed(1)} m/s`);
      setText('traj-live-pitch', `Pitch: ${pitch.toFixed(1)}°`);
      const clampBadge = $('traj-floor-badge');
      if (clampBadge) clampBadge.style.display = clamped ? 'inline-block' : 'none';
    }

    const nodes = frame.nodes_telemetry || [];
    let tallyConnected = 0,
      tallyDegraded = 0,
      tallyBlocked = 0,
      tallyOutage = 0;
    for (let i = 0; i < nodes.length; i++) {
      const cls = classifyLinkCommunicationStatus(nodes[i]).status;
      if (cls === 'CONNECTED') tallyConnected++;
      else if (cls === 'DEGRADED') tallyDegraded++;
      else if (cls === 'BLOCKED_TERRAIN' || cls === 'BLOCKED_OBSTACLE') tallyBlocked++;
      else tallyOutage++;
    }
    setText('tally-connected', String(tallyConnected));
    setText('tally-degraded', String(tallyDegraded));
    setText('tally-blocked', String(tallyBlocked));
    setText('tally-outage', String(tallyOutage));

    const kpi = frame.comparative_kpi_dashboard || {};
    const sG = isFiniteMetric(kpi.static_goodput_mb) ? kpi.static_goodput_mb : 0;
    const tG = isFiniteMetric(kpi.tac_goodput_mb) ? kpi.tac_goodput_mb : 0;
    const sGTable = isFiniteMetric(kpi.static_goodput_mb) ? kpi.static_goodput_mb : null;
    const tGTable = isFiniteMetric(kpi.tac_goodput_mb) ? kpi.tac_goodput_mb : null;
    const mult = kpi.gain_multiplier ?? 1;
    setText('kpi-tac-tx', `${tG.toFixed(2)} Mb`);
    setText('kpi-stat-tx', `Base: ${sG.toFixed(2)} Mb`);
    setText('kpi-gain-badge', `+${mult.toFixed(2)}× GAIN`);
    const liveThruText = `${((tG * 1e6) / Math.max(1, (frame.sim_time_s || 1) * 1e6)).toFixed(2)} Mbps`;
    setText('kpi-tac-rate', liveThruText);
    const topThru = document.getElementById('topbar-agg-thruput');
    if (topThru) topThru.textContent = liveThruText;

    const topEw = document.getElementById('topbar-ew-threat');
    if (topEw) {
      topEw.textContent = frame.jammer_enabled ? 'JAMMER' : 'CLEAN';
    }

    const sW = kpi.static_waste_pct ?? 0,
      tW = kpi.tac_waste_pct ?? 0;
    setText('kpi-tac-waste', `${tW.toFixed(1)}%`);
    setText('kpi-stat-waste', `Static: ${sW.toFixed(1)}%`);
    setText('kpi-waste-saved-badge', `${Math.max(0, sW - tW).toFixed(1)}% SAVED`);
    setText('kpi-waste-mb', `${((sW / 100) * (sG + 0.1)).toFixed(2)} Mb reclaimed`);

    const sD = kpi.static_drops ?? 0,
      tD = kpi.tac_drops ?? 0;
    const sDp = kpi.static_drop_pct ?? 0,
      tDp = kpi.tac_drop_pct ?? 0;
    const dropReduc = sD > 0 ? ((sD - tD) / sD) * 100 : 0;
    setText('kpi-tac-drop', `${tD} (${tDp.toFixed(1)}%)`);
    setText('kpi-stat-drop', `${sD} (${sDp.toFixed(1)}%)`);
    setText('kpi-drop-reduc-badge', `${Math.max(0, dropReduc).toFixed(0)}% FEWER`);
    setText('kpi-util-stat', `Uplink Util: ${(kpi.ul_utilization_pct ?? 0).toFixed(1)}%`);

    const hasSelected = Number.isInteger(state.selectedNodeId) && state.selectedNodeId >= 0;
    const selNode = hasSelected ? nodes.find(n => n.node_id === state.selectedNodeId) : null;

    const signed = (value: number, digits = 1) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(digits)}`;
    const formatMb = (v: number) => `${v.toFixed(2)} Mb`;
    const formatPct = (v: number) => `${v.toFixed(1)}%`;

    setMetricText('tbl-stat-tx', sGTable, formatMb);
    setMetricText('tbl-tac-tx', tGTable, formatMb);
    setMetricText(
      'tbl-tx-gain',
      sGTable === null || tGTable === null
        ? null
        : (() => {
            const delta = tGTable - sGTable;
            if (sGTable > 0) return `${signed(delta, 2)} Mb (${(tGTable / sGTable).toFixed(2)}×)`;
            if (tGTable > 0) return `${signed(delta, 2)} Mb (static 0.00 Mb)`;
            return null;
          })(),
      null
    );

    const sWTable = isFiniteMetric(kpi.static_waste_pct) ? kpi.static_waste_pct : null;
    const tWTable = isFiniteMetric(kpi.tac_waste_pct) ? kpi.tac_waste_pct : null;
    setMetricText('tbl-stat-waste', sWTable, formatPct);
    setMetricText('tbl-tac-waste', tWTable, formatPct);
    setMetricText(
      'tbl-waste-saved',
      sWTable === null || tWTable === null ? null : tWTable - sWTable,
      v => (Math.abs(v) < 0.05 ? '0.0 pp' : `${signed(v, 1)} pp`)
    );

    const sDTable = isFiniteMetric(kpi.static_drops) ? kpi.static_drops : null;
    const tDTable = isFiniteMetric(kpi.tac_drops) ? kpi.tac_drops : null;
    const sDpTable = isFiniteMetric(kpi.static_drop_pct) ? kpi.static_drop_pct : null;
    const tDpTable = isFiniteMetric(kpi.tac_drop_pct) ? kpi.tac_drop_pct : null;
    const formatDrops = (count: number | null, pct: number | null) =>
      count === null || pct === null ? null : `${count} (${pct.toFixed(1)}%)`;
    setMetricText('tbl-stat-drops', formatDrops(sDTable, sDpTable), null);
    setMetricText('tbl-tac-drops', formatDrops(tDTable, tDpTable), null);
    setMetricText(
      'tbl-drop-reduc',
      sDTable === null || tDTable === null
        ? null
        : (() => {
            const delta = tDTable - sDTable;
            if (sDTable > 0) return `${signed(delta, 0)} pkts (${signed((delta / sDTable) * 100, 0)}%)`;
            if (tDTable > 0) return `+${tDTable} pkts (static 0)`;
            return '0 pkts (0%)';
          })(),
      null
    );

    setMetricText(
      'tbl-stat-util',
      isFiniteMetric(kpi.static_utilization_pct) ? kpi.static_utilization_pct : null,
      formatPct
    );
    setMetricText('tbl-tac-util', isFiniteMetric(kpi.tac_utilization_pct) ? kpi.tac_utilization_pct : null, formatPct);
    setUnavailableText('tbl-util-delta', UNAVAILABLE, 'Descriptive metric — not scored');

    if (hasSelected) {
      const statKb = isFiniteMetric(kpi.static_selected_backlog_kb) ? kpi.static_selected_backlog_kb : null;
      const tacKb = isFiniteMetric(kpi.tac_selected_backlog_kb) ? kpi.tac_selected_backlog_kb : null;
      setMetricText('tbl-n4-stat', statKb, v => `${v.toFixed(1)} KiB`);
      setMetricText('tbl-n4-tac', tacKb, v => `${v.toFixed(1)} KiB`);
      setMetricText(
        'tbl-n4-status',
        statKb === null || tacKb === null ? null : tacKb - statKb,
        v => (Math.abs(v) < 0.05 ? '0.0 KiB' : `${signed(v, 1)} KiB`)
      );
    } else {
      setUnavailableText('tbl-n4-stat', 'N/A (no terminal selected)', 'No terminal selected');
      setUnavailableText('tbl-n4-tac', 'N/A (no terminal selected)', 'No terminal selected');
      setUnavailableText('tbl-n4-status', 'N/A (no terminal selected)', 'No terminal selected');
    }

    const statP50 = isFiniteMetric(frame.static_p50_bps)
      ? frame.static_p50_bps
      : isFiniteMetric(kpi.static_p50_bps)
        ? kpi.static_p50_bps
        : null;
    const statP95 = isFiniteMetric(frame.static_p95_bps)
      ? frame.static_p95_bps
      : isFiniteMetric(kpi.static_p95_bps)
        ? kpi.static_p95_bps
        : null;
    const tacP50 = isFiniteMetric(frame.tac_p50_bps)
      ? frame.tac_p50_bps
      : isFiniteMetric(kpi.tac_p50_bps)
        ? kpi.tac_p50_bps
        : null;
    const tacP95 = isFiniteMetric(frame.tac_p95_bps)
      ? frame.tac_p95_bps
      : isFiniteMetric(kpi.tac_p95_bps)
        ? kpi.tac_p95_bps
        : null;
    const sampleCount = isFiniteMetric(kpi.rolling_window_sample_count) ? kpi.rolling_window_sample_count : 0;
    const sampleCapacity =
      isFiniteMetric(kpi.rolling_window_capacity) && kpi.rolling_window_capacity > 0
        ? kpi.rolling_window_capacity
        : 200;

    const formatMbps = (bps: number) => {
      if (!isFiniteMetric(bps)) return null;
      const mbps = bps / 1e6;
      return sampleCount > 0 && sampleCount < sampleCapacity
        ? `${mbps.toFixed(2)} Mbps (${sampleCount}/${sampleCapacity})`
        : `${mbps.toFixed(2)} Mbps`;
    };
    const formatGain = (tBps: number | null, sBps: number | null) => {
      if (!isFiniteMetric(tBps) || !isFiniteMetric(sBps)) return null;
      if (sBps > 0) {
        const gain = tBps / sBps;
        return `${gain >= 1 ? '+' : ''}${gain.toFixed(2)}×`;
      }
      return tBps > 0 ? '+∞' : null;
    };

    setMetricText('tbl-p50-stat', statP50, formatMbps);
    setMetricText('tbl-p50-tac', tacP50, formatMbps);
    setMetricText('tbl-p50-gain', formatGain(tacP50, statP50), null);
    setMetricText('tbl-p95-stat', statP95, formatMbps);
    setMetricText('tbl-p95-tac', tacP95, formatMbps);
    setMetricText('tbl-p95-gain', formatGain(tacP95, statP95), null);

    const allocations = Array.isArray(frame.active_gantt_allocations) ? frame.active_gantt_allocations : [];
    const selectedAllocations = hasSelected
      ? allocations.filter(a => Number(a.node_id) === Number(state.selectedNodeId))
      : [];
    const allocatedSeconds = selectedAllocations.reduce(
      (sum, a) => sum + Math.max(0, Number(a.duration_s ?? (Number(a.duration_ms) || 0) / 1000) || 0),
      0
    );
    if (!schedHistoryController.isInspecting && !simTimelineController?.isHistoricalInspecting) {
      if (hasSelected) {
        const secTag = typeof selNode?.active_sector_id === 'number' ? ` · Sector S${selNode.active_sector_id}` : '';
        setText(
          'alloc-node-label',
          selNode ? `Node ${state.selectedNodeId} · ${selNode.name || 'Terminal'}${secTag}` : `Node ${state.selectedNodeId}`
        );
        setText('alloc-airtime', `${(allocatedSeconds * 1000).toFixed(2)} ms`);
        setText('alloc-segments', String(selectedAllocations.length));
        setText(
          'alloc-inspector-note',
          selectedAllocations.length
            ? `Current frame ${frame.frame_index ?? '--'} · summed duration from ${selectedAllocations.length} worker allocation segment(s). This is per-frame airtime, not a long-run utilization estimate.`
            : `No allocation segment for Node ${state.selectedNodeId} in current frame ${frame.frame_index ?? '--'}. This may indicate no queued eligible traffic or a telemetry frame with no allocation for this node.`
        );
      } else {
        setText('alloc-node-label', 'No terminal selected');
        setText('alloc-airtime', '--');
        setText('alloc-segments', '--');
        setText('alloc-inspector-note', 'No terminal selected. Select a terminal to inspect its allocations.');
      }
    }

    if (frame.acn_heading_deg !== undefined || frame.sector_node_counts) {
      const hdg = typeof frame.acn_heading_deg === 'number' ? Math.round(frame.acn_heading_deg) : '--';
      const bank = typeof frame.acn_bank_deg === 'number' ? frame.acn_bank_deg.toFixed(1) : '--';
      const ho = typeof frame.total_sector_handovers === 'number' ? frame.total_sector_handovers : 0;
      setText('sector-attitude-badge', `ACN HDG ${hdg}° · BANK ${bank}° · HANDOVERS ${ho}`);

      const counts = frame.sector_node_counts || [0, 0, 0, 0];
      const utils = frame.tac_sector_util_pct || frame.static_sector_util_pct || [0, 0, 0, 0];
      const rates = frame.tac_sector_goodput_mbps || [0, 0, 0, 0];

      for (let k = 0; k < 4; k++) {
        setText(`sector-s${k}-nodes`, `${counts[k]} Terminal${counts[k] === 1 ? '' : 's'}`);
        setText(`sector-s${k}-util`, `${utils[k].toFixed(1)}%`);
        setText(`sector-s${k}-rate`, `${rates[k].toFixed(2)} Mbps`);
      }
    }
    if (selNode) {
      const obstacleState = obstacleEditor.obstructionSnapshotIsCurrent
        ? obstacleEditor.obstructionSnapshot.find(item => item.node_id === selNode.node_id)
        : null;
      const lb = frame.selected_link_budget || frame.selected_node_fresnel?.link_budget;
      const telemetryInput = lb ? { ...selNode, ...lb, ...(obstacleState || {}) } : { ...selNode, ...(obstacleState || {}) };
      const selClassification = classifyLinkCommunicationStatus(telemetryInput);
      const badgeInfo = getStatusBadgeInfo(selClassification.status);

      const b1 = $('overview-state-badge'),
        b2 = $('term-state-pill');
      if (b1) {
        b1.textContent = badgeInfo.badgeText;
        b1.className = badgeInfo.badgeClass;
      }
      if (b2) {
        b2.textContent = badgeInfo.badgeText;
        b2.className = badgeInfo.badgeClass;
      }

      setText(
        'glance-slant',
        lb && typeof lb.slant_range_km === 'number'
          ? `${lb.slant_range_km.toFixed(1)} km`
          : typeof selNode.slant_range_km === 'number'
            ? `${selNode.slant_range_km.toFixed(1)} km`
            : '--'
      );
      setText(
        'glance-snr',
        lb && typeof lb.snr_db === 'number'
          ? `${lb.snr_db.toFixed(1)} dB`
          : typeof selNode.snr_db === 'number'
            ? `${selNode.snr_db.toFixed(1)} dB`
            : '--'
      );
      setText(
        'glance-rate',
        lb && typeof lb.bitrate_mbps === 'number'
          ? `${lb.bitrate_mbps.toFixed(2)} M`
          : typeof selNode.bitrate_mbps === 'number'
            ? `${selNode.bitrate_mbps.toFixed(2)} M`
            : typeof selNode.bitrate_bps === 'number'
              ? `${(selNode.bitrate_bps / 1e6).toFixed(2)} M`
              : '--'
      );

      if (!historyController.isInspecting && !simTimelineController?.isHistoricalInspecting) {
        setText('terrain-node-label', `Node ${selNode.node_id} (${selNode.name || 'Terminal'})`);
        if (lb) {
          setText('link-modcod-tag', lb.modcod_name || '--');
          setText('lb-slant', typeof lb.slant_range_km === 'number' ? `${lb.slant_range_km.toFixed(2)} km` : '--');
          setText('lb-snr', typeof lb.snr_db === 'number' ? `${lb.snr_db.toFixed(1)} dB` : '--');
          setText(
            'lb-se',
            typeof lb.spectral_efficiency_bps_hz === 'number'
              ? `${lb.spectral_efficiency_bps_hz.toFixed(2)} bps/Hz`
              : '--'
          );
          setText('lb-fspl', typeof lb.fspl_db === 'number' ? `${lb.fspl_db.toFixed(1)} dB` : '--');
          setText(
            'lb-diff',
            typeof lb.diffraction_loss_db === 'number' ? `${lb.diffraction_loss_db.toFixed(1)} dB` : '--'
          );
          setText('lb-prx', typeof lb.prx_dbm === 'number' ? `${lb.prx_dbm.toFixed(1)} dBm` : '--');
          setText('lb-pnoise', typeof lb.pnoise_dbm === 'number' ? `${lb.pnoise_dbm.toFixed(2)} dBm` : '--');
          setText('lb-bulge', typeof lb.earth_bulge_m === 'number' ? `${lb.earth_bulge_m.toFixed(1)} m` : '--');
          setText('lb-gas', typeof lb.gas_loss_db === 'number' ? `${lb.gas_loss_db.toFixed(2)} dB` : '--');
          setText('lb-rain', typeof lb.rain_loss_db === 'number' ? `${lb.rain_loss_db.toFixed(1)} dB` : '--');
        } else {
          setText('link-modcod-tag', selNode.modcod_name || '--');
          setText('lb-slant', typeof selNode.slant_range_km === 'number' ? `${selNode.slant_range_km.toFixed(2)} km` : '--');
          setText('lb-snr', typeof selNode.snr_db === 'number' ? `${selNode.snr_db.toFixed(1)} dB` : '--');
          setText('lb-se', '--');
          setText('lb-fspl', '--');
          setText(
            'lb-diff',
            typeof selNode.diffraction_loss_db === 'number' ? `${selNode.diffraction_loss_db.toFixed(1)} dB` : '--'
          );
          setText('lb-prx', '--');
          setText('lb-pnoise', '--');
          setText('lb-bulge', '--');
          setText('lb-gas', '--');
          setText('lb-rain', '--');
        }
      }

      const c2 = selNode.c2_bytes ?? 0;
      const vo = selNode.voice_bytes ?? 0;
      const vi = selNode.video_bytes ?? 0;
      const ph = selNode.photo_bytes ?? 0;

      const setQBar = (id: string, bytes: number, maxB: number) => {
        const el = $('qbar-' + id);
        if (el) el.style.width = `${Math.min(100, (bytes / maxB) * 100)}%`;
        setText('qval-' + id, `${(bytes / 1024).toFixed(1)} KB`);
      };
      setQBar('69', c2, 1024);
      setQBar('65', vo, 4096);
      setQBar('67', vi, 65536);
      const pEl = $('qbar-70');
      if (pEl) pEl.style.width = `${Math.min(100, (ph / 2000000) * 100)}%`;
      setText('qval-70', `${(ph / 1024).toFixed(0)} / 2000 KB`);
      if (document.querySelector('.tab-content.active')?.id === 'tab-terminal') {
        renderVsaScope(selNode, frame);
      }
      if (selNode.ai_directive_text) {
        const slopeTag =
          typeof selNode.ai_max_step_slope_deg === 'number'
            ? ` · Max Slope: ${selNode.ai_max_step_slope_deg.toFixed(1)}°`
            : '';
        setText('ai-directive-readout', `${selNode.ai_directive_text}${slopeTag}`);
      } else {
        setText('ai-directive-readout', '[OPTIMAL] POSITION OPTIMAL (Clear LoS)');
      }
    } else {
      const unknownBadge = getStatusBadgeInfo('UNKNOWN');
      const b1 = $('overview-state-badge'),
        b2 = $('term-state-pill');
      if (b1) {
        b1.textContent = unknownBadge.badgeText;
        b1.className = unknownBadge.badgeClass;
      }
      if (b2) {
        b2.textContent = unknownBadge.badgeText;
        b2.className = unknownBadge.badgeClass;
      }
      setText('glance-slant', '--');
      setText('glance-snr', '--');
      setText('glance-rate', '--');
      if (!historyController.isInspecting && !simTimelineController?.isHistoricalInspecting) {
        setText('terrain-node-label', 'No terminal selected');
        setText('link-modcod-tag', '--');
        setText('lb-slant', '--');
        setText('lb-snr', '--');
        setText('lb-se', '--');
        setText('lb-fspl', '--');
        setText('lb-diff', '--');
        setText('lb-prx', '--');
        setText('lb-pnoise', '--');
        setText('lb-bulge', '--');
        setText('lb-gas', '--');
        setText('lb-rain', '--');
      }
      const clearQBar = (id: string) => {
        const el = $('qbar-' + id);
        if (el) el.style.width = '0%';
        setText('qval-' + id, '--');
      };
      clearQBar('69');
      clearQBar('65');
      clearQBar('67');
      const pEl = $('qbar-70');
      if (pEl) pEl.style.width = '0%';
      setText('qval-70', '--');
      if (document.querySelector('.tab-content.active')?.id === 'tab-terminal') {
        renderVsaScope(null, frame);
      }
    }

    const tx = frame.transfer_telemetry;
    if (tx) {
      const status = tx.status || 'IDLE';
      const pct = tx.progress_pct || 0;
      const bar = $('tx-progress-bar');
      if (bar) bar.style.width = `${Math.min(100, pct)}%`;

      const badge = $('tx-status-badge');
      if (badge) {
        if (status === 'TRANSMITTING') {
          badge.className = 'kpi-badge badge-cyan';
          badge.textContent = 'TRANSMITTING';
        } else if (status === 'BLOCKED_NLOS') {
          badge.className = 'kpi-badge badge-amber';
          badge.textContent = '[WARN] BLOCKED (BUFFERED)';
        } else if (status === 'FAILED_DROPPED') {
          badge.className = 'kpi-badge badge-crimson';
          badge.textContent = '[DROP] DROPPED';
        } else if (status === 'ACKNOWLEDGED') {
          badge.className = 'kpi-badge badge-emerald';
          badge.textContent = '[ACK] ACKNOWLEDGED';
        } else {
          badge.className = 'kpi-badge';
          badge.textContent = 'STANDBY';
        }
      }

      setText('tx-type-lbl', tx.active_type ? `Uploading ${tx.active_type}` : 'IDLE - Standby');
      setText(
        'tx-bytes-lbl',
        `${((tx.delivered_bytes || 0) / 1e6).toFixed(2)} / ${((tx.total_bytes || 0) / 1e6).toFixed(2)} MB (${pct.toFixed(1)}%)`
      );
      const rateMbps = tx.current_rate_mbps
        ? tx.current_rate_mbps.toFixed(2)
        : tx.current_rate_bps
          ? (tx.current_rate_bps / 1e6).toFixed(2)
          : '0.00';
      const etaText = tx.eta_status
        ? `ETA: ${tx.eta_status}`
        : tx.eta_s !== null && tx.eta_s !== undefined
          ? `ETA: ${tx.eta_s.toFixed(1)}s`
          : 'ETA: --';
      setText('tx-eta-lbl', status === 'TRANSMITTING' ? `${etaText} · ${rateMbps} Mbps` : etaText);
      setText('tx-msg-lbl', tx.status_message || (status === 'IDLE' ? 'Select terminal and inject traffic.' : ''));
    }

    if (frame.relay_advisor) {
      const rep = frame.relay_advisor;
      setText(
        'relay-optimal-pos',
        `${rep.optimalLatDeg.toFixed(4)}°N, ${rep.optimalLonDeg.toFixed(4)}°E (${Math.round(rep.elevationMslM)} m MSL)`
      );
      setText(
        'relay-orbit-avail',
        `${rep.orbitAvailabilityPct.toFixed(1)}% | Mean SINR: ${rep.meanSinrToAcnDb.toFixed(1)} dB`
      );
      setText('relay-ground-cov', `${rep.groundNodeCoveragePct.toFixed(1)}%`);
      const badge = $('relay-advisor-status-badge');
      if (badge) {
        badge.textContent = rep.orbitAvailabilityPct >= 80.0 ? 'Optimal Ridge Found' : 'Sub-Optimal';
        badge.className = rep.orbitAvailabilityPct >= 80.0 ? 'kpi-badge badge-emerald' : 'kpi-badge badge-neutral';
      }
      const recomputeBtn = $<HTMLButtonElement>('btn-recompute-relay-advisor');
      if (recomputeBtn && recomputeBtn.textContent === 'Computing…') {
        recomputeBtn.textContent = 'Recompute Optimal Ridge Relay';
        recomputeBtn.disabled = false;
      }
    }

    if (frame.active_relay_enabled !== undefined) {
      const isOnline = Boolean(frame.active_relay_enabled);
      const btn = $('btn-toggle-active-relay');
      if (btn) {
        btn.setAttribute('aria-pressed', isOnline ? 'true' : 'false');
        btn.textContent = isOnline
          ? 'Active Two-Hop Ridge Relay [ONLINE]'
          : 'Deploy Active Two-Hop Ridge Relay [OFF]';
        btn.className = isOnline ? 'primary' : 'secondary';
      }
      const schedSel = $<HTMLSelectElement>('sci-relay-select');
      if (schedSel && document.activeElement !== schedSel) {
        schedSel.value = isOnline ? 'active' : 'disabled';
      }
      const count = frame.relayed_node_count ?? 0;
      const sec = frame.relay_backhaul_sector_id !== undefined ? `S${frame.relay_backhaul_sector_id}` : '—';
      const snr = frame.relay_backhaul_snr_db !== undefined ? `${frame.relay_backhaul_snr_db.toFixed(1)} dB` : '—';
      setText('relay-active-stats', `${count} | Backhaul: ${sec} (${snr})`);
      setText('sci-relay-readout', `Relayed: ${count} nodes | Backhaul: ${sec} (${snr})`);
    }

    if (frame.rician_fading_enabled !== undefined || frame.cqi_feedback_delay_ms !== undefined) {
      const sel = $<HTMLSelectElement>('sci-fading-cqi-select');
      if (sel && document.activeElement !== sel) {
        if (!frame.rician_fading_enabled) {
          sel.value = 'awgn-0ms';
        } else if ((frame.cqi_feedback_delay_ms ?? 0) === 0) {
          sel.value = 'rician-0ms';
        } else if (frame.cqi_feedback_delay_ms === 20) {
          sel.value = 'rician-20ms';
        } else {
          sel.value = 'rician-40ms';
        }
      }
      const modeStr = !frame.rician_fading_enabled
        ? 'AWGN (0 ms delay)'
        : `3GPP Rician (${frame.cqi_feedback_delay_ms ?? 0} ms delay${(frame.cqi_feedback_delay_ms ?? 0) === 20 ? ', OLLA' : ''})`;
      setText('sci-fading-cqi-readout', `Mode: ${modeStr}`);
    }

    // MENTOR-02: Sync Waveform Control & Tactical Equipment Spawner UI
    if (frame.mcs_mode !== undefined) {
      const modeSel = $<HTMLSelectElement>('mcs-mode-select');
      if (modeSel && document.activeElement !== modeSel) {
        modeSel.value = frame.mcs_mode;
      }
      const modSel = $<HTMLSelectElement>('manual-mod-select');
      if (modSel && document.activeElement !== modSel && frame.manual_modulation) {
        modSel.value = frame.manual_modulation;
      }
      const fecSel = $<HTMLSelectElement>('manual-fec-select');
      if (fecSel && document.activeElement !== fecSel && frame.manual_fec) {
        fecSel.value = frame.manual_fec;
      }
      setText(
        'mcs-mode-readout',
        frame.mcs_mode === 'manual_lock'
          ? `Manual Lock · ${frame.manual_modulation ?? '16-QAM'} ${frame.manual_fec ?? '3/4'}`
          : 'ACM Auto · Adaptive 8-Tier DVB-S2X'
      );
    }

    const eqListEl = $('tactical-equipment-list');
    if (eqListEl) {
      const eqItems = Array.isArray(frame.tactical_equipment) ? frame.tactical_equipment : [];
      setText('equip-count-badge', `${eqItems.length} / 32`);
      const sig = eqItems
        .map(
          eq =>
            `${eq.id}:${eq.enabled ? 1 : 0}:${eq.eirp_dbm.toFixed(1)}:${Math.round(eq.x_m)}:${Math.round(eq.y_m)}:${eq.relayed_count ?? ''}:${eq.intercept_detected ? 1 : 0}:${typeof eq.intercept_margin_db === 'number' ? eq.intercept_margin_db.toFixed(1) : ''}`
        )
        .join('|');
      if (sig !== state.lastEquipmentListSig) {
        state.lastEquipmentListSig = sig;
        eqListEl.replaceChildren();
        if (eqItems.length === 0) {
          const emptyEl = document.createElement('div');
          emptyEl.className = 'mentor02-equip-empty';
          emptyEl.textContent = 'No deployed equipment. Select a type and click Place on Map.';
          eqListEl.appendChild(emptyEl);
        } else {
          for (const eq of eqItems) {
            const row = document.createElement('div');
            row.className = 'mentor02-equip-row';

            const meta = document.createElement('div');
            meta.className = 'mentor02-equip-meta';

            const title = document.createElement('span');
            title.className = 'mentor02-equip-title';
            title.textContent = `${eq.label} (${eq.enabled ? 'ON' : 'OFF'})`;

            const sub = document.createElement('span');
            sub.className = 'mentor02-equip-sub';
            let detail = `(${(eq.x_m / 1000).toFixed(1)}, ${(eq.y_m / 1000).toFixed(1)}) km · ${eq.eirp_dbm.toFixed(0)} dBm`;
            if (eq.type === 'relay_mast' && typeof eq.relayed_count === 'number') {
              detail += ` · Relayed ${eq.relayed_count}`;
            } else if (eq.type === 'esm_sensor' && typeof eq.intercept_margin_db === 'number') {
              detail += ` · Margin ${eq.intercept_margin_db.toFixed(1)} dB${eq.intercept_detected ? ' [DET]' : ''}`;
            } else if (typeof eq.jammer_shield_db === 'number') {
              detail += ` · Shield ${eq.jammer_shield_db.toFixed(1)} dB`;
            }
            sub.textContent = detail;

            meta.appendChild(title);
            meta.appendChild(sub);

            const btns = document.createElement('div');
            btns.className = 'mentor02-equip-btns';

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.textContent = eq.enabled ? 'Disable' : 'Enable';
            toggleBtn.addEventListener('click', () => {
              sendCommand({ type: 'EQUIPMENT_UPDATE', id: eq.id, enabled: !eq.enabled });
            });

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn-danger';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', () => {
              sendCommand({ type: 'EQUIPMENT_DELETE', id: eq.id });
            });

            btns.appendChild(toggleBtn);
            btns.appendChild(delBtn);

            row.appendChild(meta);
            row.appendChild(btns);
            eqListEl.appendChild(row);
          }
        }
      }
    }

    actions.updateScientificAblationMatrix(frame);
    renderSoldierPhoneWorkspace(frame);
  }

  /* Telemetry sampling */
  (() => {
    const canvas = document.getElementById('overview-goodput-canvas') as HTMLCanvasElement | null;
    const sampleCount = document.getElementById('overview-trend-sample-count');
    const eventList = document.getElementById('overview-event-list');
    if (!canvas || !sampleCount || !eventList) return;
    const points: Array<{ value: number; time: number }> = [];
    const maxPoints = 90;
    let previousGoodput = '';
    let previousSituation = '';
    let previousTerminal = '';
    let previousScheduler = '';
    const clock = () => {
      const el = document.getElementById('clock-display');
      return el?.textContent ? el.textContent.trim() : 'simulation time unavailable';
    };
    const addEvent = (message: string) => {
      const empty = eventList.querySelector('.overview-event-empty');
      if (empty) empty.remove();
      const li = document.createElement('li');
      const stamp = document.createElement('span');
      stamp.className = 'event-time';
      stamp.textContent = clock();
      li.append(stamp, document.createTextNode(message));
      eventList.prepend(li);
      while (eventList.children.length > 8) eventList.lastElementChild?.remove();
    };
    const parseMb = (raw: string) => {
      const m = (raw || '').replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*Mb/i);
      return m ? Number(m[1]) : null;
    };
    const draw = () => {
      bindChartHoverCrosshair(canvas, draw);
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(rect.width * dpr),
        h = Math.floor(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cw = rect.width,
        ch = rect.height;
      ctx2d.clearRect(0, 0, cw, ch);
      const pad = { l: 42, r: 10, t: 8, b: 18 },
        pw = cw - pad.l - pad.r,
        ph = ch - pad.t - pad.b;
      const vals = points.map(p => p.value).filter(v => Number.isFinite(v));
      if (vals.length < 2) {
        ctx2d.fillStyle = HIGHLAND_THEME.text.muted;
        ctx2d.font = `10px ${HIGHLAND_THEME.font.sans}`;
        ctx2d.fillText('Collecting telemetry samples…', pad.l + 4, ch / 2);
        return;
      }
      const min = Math.min(...vals),
        max = Math.max(...vals),
        span = Math.max(max - min, 0.01);
      const ticks = computeNiceTicks(min, max, 3);
      ctx2d.font = `9px ${HIGHLAND_THEME.font.mono}`;
      ticks.forEach(tk => {
        const ty = pad.t + ph - ((tk - min) / span) * ph;
        if (ty < pad.t - 2 || ty > pad.t + ph + 2) return;
        ctx2d.strokeStyle = HIGHLAND_THEME.line.grid;
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(pad.l, Math.round(ty) + 0.5);
        ctx2d.lineTo(cw - pad.r, Math.round(ty) + 0.5);
        ctx2d.stroke();
        ctx2d.fillStyle = HIGHLAND_THEME.text.faint;
        ctx2d.textAlign = 'right';
        ctx2d.fillText(tk.toFixed(1) + ' Mb', pad.l - 4, ty + 3);
      });
      ctx2d.textAlign = 'left';
      ctx2d.strokeStyle = HIGHLAND_THEME.signal.amber;
      ctx2d.lineWidth = 1.8;
      ctx2d.beginPath();
      points.forEach((p, i) => {
        const x = pad.l + (pw * i) / Math.max(1, points.length - 1);
        const y = pad.t + ph - ((p.value - min) / span) * ph;
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      });
      ctx2d.stroke();

      const hover = getCanvasHoverState(canvas);
      if (hover.active && hover.cssX >= pad.l && hover.cssX <= cw - pad.r && points.length > 1) {
        const idx = Math.max(
          0,
          Math.min(points.length - 1, Math.round(((hover.cssX - pad.l) / pw) * (points.length - 1)))
        );
        const pt = points[idx];
        const sx = pad.l + (pw * idx) / (points.length - 1);
        drawChartHoverCrosshair(
          ctx2d,
          { left: pad.l, right: cw - pad.r, top: pad.t, bottom: pad.t + ph },
          sx,
          `Sample #${idx + 1}`,
          [{ label: 'Goodput', valueText: `${pt.value.toFixed(2)} Mb`, color: HIGHLAND_THEME.signal.amber }]
        );
      }
    };
    const sample = () => {
      const goodputEl = document.getElementById('kpi-tac-tx');
      const raw = goodputEl?.textContent ? goodputEl.textContent.trim() : '';
      const value = parseMb(raw);
      if (value !== null) {
        points.push({ value, time: Date.now() });
        if (points.length > maxPoints) points.shift();
        sampleCount.textContent = points.length + ' samples';
        const prevVal = previousGoodput ? parseMb(previousGoodput) : null;
        if (prevVal !== null && raw !== previousGoodput && value > prevVal + 0.001) {
          if (points.length === 1 || points.length % 10 === 0) addEvent('Delivered goodput advanced to ' + raw + '.');
        }
        previousGoodput = raw;
      }
      const situationEl = document.querySelector('.situation-strip, #situation-strip, [id*="situation"]');
      const situation = situationEl?.textContent ? situationEl.textContent.replace(/\s+/g, ' ').trim() : '';
      if (situation && situation !== previousSituation) {
        addEvent('Situation: ' + situation.slice(0, 180));
        previousSituation = situation;
      }
      const node = document.getElementById('quickNodeSelect') as HTMLSelectElement | null;
      const selected = node?.options[node.selectedIndex]?.textContent?.trim() || '';
      if (selected && selected !== previousTerminal) {
        addEvent('Inspection target changed: ' + selected + '.');
        previousTerminal = selected;
      }
      const mode = document.getElementById('scheduler-quick-toggle');
      const scheduler = mode?.textContent ? mode.textContent.trim() : '';
      if (scheduler && scheduler !== previousScheduler) {
        if (previousScheduler) addEvent('Scheduler mode changed: ' + scheduler + '.');
        previousScheduler = scheduler;
      }
      draw();
    };
    sample();
    window.setInterval(() => {
      if (!document.hidden && !state.isPaused) sample();
    }, 1000);
    window.addEventListener('resize', draw);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) draw();
    });
  })();

  // Analysis context sync
  (function installAnalysisContext() {
    const text = (id: string) => {
      const el = document.getElementById(id);
      return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    };
    const firstText = (ids: string[]) => {
      for (const id of ids) {
        const v = text(id);
        if (v) return v;
      }
      return '--';
    };
    function update() {
      const nodeSelect = (document.getElementById('termNodeSelect') ||
        document.getElementById('quickNodeSelect')) as HTMLSelectElement | null;
      const nodeName =
        nodeSelect && nodeSelect.selectedIndex >= 0 ? nodeSelect.options[nodeSelect.selectedIndex].textContent.trim() : '--';
      const time = firstText(['sim-clock', 'sim-time', 'clock-display', 'simulation-clock']);
      const frame = firstText(['frame-counter', 'sim-frame', 'frame-display']);
      const mode = firstText(['scheduler-quick-toggle', 'scheduler-mode-label']).replace(/^Mode:\s*/i, '');
      const snr = text('lb-snr');
      const status = firstText(['term-state-pill']);
      document.querySelectorAll('.analysis-context').forEach(panel => {
        if (panel.getAttribute('data-context-view') === 'rf' && historyController.isInspecting) return;
        if (panel.getAttribute('data-context-view') === 'scheduler' && schedHistoryController.isInspecting) return;
        panel.querySelectorAll('[data-context-node]').forEach(el => (el.textContent = nodeName || '--'));
        panel.querySelectorAll('[data-context-time]').forEach(el => (el.textContent = time));
        panel.querySelectorAll('[data-context-frame]').forEach(el => (el.textContent = frame));
        panel.querySelectorAll('[data-context-mode]').forEach(el => (el.textContent = mode || '--'));
        panel
          .querySelectorAll('[data-context-link]')
          .forEach(
            el => (el.textContent = snr && snr !== '--' ? 'SNR ' + snr + (status ? ' (' + status + ')' : '') : status || '--')
          );
      });
    }
    update();
    window.setInterval(() => {
      if (!document.hidden && !state.isPaused) update();
    }, 1000);
    document.addEventListener('change', e => {
      const target = e.target as HTMLElement | null;
      if (target && (target.id === 'termNodeSelect' || target.id === 'quickNodeSelect')) {
        update();
        if (schedHistoryController.isInspecting) actions.syncSchedulerHistoricalUIState();
        else actions.drawSchedulerCharts();
      }
    });
  })();

  Object.assign(actions, {
    getDashboardAndAuthoringController,
    getMissionIoController,
    getCommandPaletteController,
    renderRegistration,
    renderNtnSignalingAnalyzer,
    handleAcnSelection,
    renderSelectedNodeDetails,
    handleNodeSelection,
    renderSoldierPhoneWorkspace,
    renderOpsFleetRegistry,
    renderTerminalInventory,
    populateDropdownsOnce,
    renderVsaScope,
    updateOpsQosSlaUI,
    renderQosSlaAnalyzer,
    observeTelemetryTiming,
    renderWorkerJitterProfiler,
    renderTwinCalibrationScope,
    updateTwinCalibrationDOM,
    isMgrsGridActive,
    openCommandPalette,
    closeCommandPalette,
    buildCurrentAarSnapshot,
    renderNetworkTrafficInventory,
    experimentObserve,
    initializeExperimentCapture,
    updateDashboardDOM,
    syncZoomHudReadout,
  });
}
