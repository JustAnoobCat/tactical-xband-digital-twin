// Web Worker IPC lifecycle, telemetry subscription profile & inbound message router
import type { AppContext } from './appContext.ts';
import type { DemGeographicMetadata } from '../core/terrain.ts';
import type {
  TrajectoryConfigTelemetry,
  WorkerInboundCommand,
  WorkerOutboundMessage,
} from '../shared/workerProtocol.ts';
import type { ObstacleCommandResult } from '../ui/obstacleEditorState.ts';
import { routeCommandResult } from '../ui/commandResultRouter.ts';
import { SystemHealthHud } from '../ui/systemHealthHud.ts';

export function initWorkerBridgeController(ctx: AppContext): void {
  const { worker, state, engines, dom, actions } = ctx;
  const { $, setText } = dom;
  const {
    mapLayerRegistry,
    obstacleEditor,
    trajectoryEditor,
    historyController,
    simSpatialBuffer,
    simEpochStore,
    diagnosticsTracker,
    flightRecorder,
  } = engines;

  let systemHealthHudInstance: SystemHealthHud | null = null;
  function getSystemHealthHud(): SystemHealthHud {
    if (!systemHealthHudInstance) {
      systemHealthHudInstance = new SystemHealthHud({
        getWorldTileLayer: () => actions.getRadarWorldTileLayer(),
        getRecordedEventCount: () => flightRecorder.getEventCount(),
      });
    }
    return systemHealthHudInstance;
  }

  /**
   * Authoritative typed helper for dispatching worker commands from the main UI thread.
   * Ensures consistent transfer list handling and command typing.
   */
  function sendCommand(msg: WorkerInboundCommand, transferList?: Transferable[]): void {
    flightRecorder.recordCommand(
      msg,
      Number(state.latestTelemetry?.frame_index ?? 0),
      Number(state.latestTelemetry?.sim_time_s ?? 0)
    );
    if (worker) {
      if (transferList && transferList.length > 0) {
        worker.postMessage(msg, transferList);
      } else {
        worker.postMessage(msg);
      }
    }
  }

  function syncTelemetrySubscriptionProfile(activeTabId: string): void {
    const linkProfile =
      activeTabId === 'tab-terrain' ||
      Boolean(mapLayerRegistry?.isLayerVisible?.('rf.fresnelZone'));
    const vsaConstellation = activeTabId === 'tab-terminal';
    const pduDissector = activeTabId === 'tab-scheduler';
    sendCommand({
      type: 'SET_TELEMETRY_PROFILE',
      subscriptions: {
        linkProfile,
        vsaConstellation,
        pduDissector,
        viewshed: true,
      },
    });
  }

  worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>): void => {
    const msg = event.data;
    if (!msg) return;
    const simTimelineController = state.simTimelineController;

    if (msg.type === 'TELEMETRY_FRAME') {
      state.radarNeedsRender = true;
      state.schedulerNeedsRender = true;
      state.terrainNeedsRender = true;
      actions.scheduleAnimationLoop();
      if (simTimelineController && !simTimelineController.prepareTelemetryRun(msg.frame)) {
        return;
      }
      diagnosticsTracker.observeFrame(performance.now());
      if (typeof msg.frame.spatial_revision === 'number') {
        state.currentSpatialRevision = msg.frame.spatial_revision;
        if (state.currentSpatialRevision !== state.lastMirroredObstacleRev) {
          actions.syncObstacleFieldMirror();
        }
      }
      obstacleEditor.markSimulationFrameAdvanced();
      state.latestTelemetry = msg.frame;
      flightRecorder.observeFrame(msg.frame);
      const currentNodeIds = new Set((msg.frame.nodes_telemetry || []).map(node => node.node_id));
      const priorSelectedNodeId = state.selectedNodeId;
      if (!currentNodeIds.has(state.selectedNodeId)) {
        state.selectedNodeId =
          Number.isInteger(msg.frame.selected_node_id) && currentNodeIds.has(msg.frame.selected_node_id)
            ? msg.frame.selected_node_id
            : -1;
      }
      if (priorSelectedNodeId !== state.selectedNodeId) actions.syncNodeDropdowns(state.selectedNodeId);
      if (
        (state.hoveredNodeId !== null && !currentNodeIds.has(state.hoveredNodeId)) ||
        (state.hoveredLinkNodeId !== null && !currentNodeIds.has(state.hoveredLinkNodeId))
      ) {
        state.hoveredNodeId = null;
        state.hoveredLinkNodeId = null;
        state.activeMapHoverRenderer = null;
        state.mapHoverPoint = null;
        const tip = $('map-node-tooltip');
        if (tip) tip.style.display = 'none';
      }
      actions.renderSelectedNodeDetails();
      const dashboardSelect = $<HTMLSelectElement>('network-node-select');
      const dashboardOption = Array.from(dashboardSelect?.options || []).find(
        option => Number(option.value) === state.selectedNodeId
      );
      if (dashboardOption && !dashboardOption.selected) {
        dashboardOption.selected = true;
        actions.drawNetworkCharts();
      }
      const hoverNodeId = state.hoveredLinkNodeId ?? state.hoveredNodeId;
      if (state.activeMapHoverRenderer && state.mapHoverPoint && hoverNodeId !== null) {
        actions.renderNodeHoverTooltip(
          hoverNodeId,
          state.mapHoverPoint,
          state.hoveredLinkNodeId !== null ? 'link' : 'node'
        );
      }
      actions.ingestNetworkPerformance(msg.frame);
      const activeTabId = document.querySelector('.tab-content.active')?.id;
      if (activeTabId === 'tab-registration') {
        actions.renderRegistration(msg.frame);
      }
      if (msg.frame && msg.frame.terrain_bounds) {
        state.activeTerrainBounds = msg.frame.terrain_bounds;
      }
      actions.recordHistoricalFrame(msg.frame);
      actions.recordSchedulerHistoricalFrame(msg.frame);
      if (simTimelineController) {
        simTimelineController.ingestTelemetry(
          msg.frame.batch_spatial_snapshots,
          msg.frame.completed_superframes,
          msg.frame
        );
      }
      if (typeof msg.frame.spatial_locked === 'boolean') actions.updateSpatialLockControl(msg.frame.spatial_locked);
      actions.syncTrajectoryEditorFromWorker(msg.frame.trajectory_config);
      actions.syncTdmaEditorFromWorker(msg.frame.tdma_frame_config);
      actions.updateDashboardDOM(msg.frame);
      actions.updateHiFiPhysicsUI(
        msg.frame.hifi_telemetry,
        msg.frame.transport_abr_telemetry,
        msg.frame.ew_eccm_telemetry,
        msg.frame.constellation_mobility_telemetry
      ); // updateHiFiPhysicsUI(msg.frame.hifi_telemetry)
      actions.updateBiomePhysicsUI(msg);
      if (state.terrainMapMode === 'maplibre' && state.stageViewMode === '2d' && state.mapLibreInitialized) {
        const nowMs = performance.now();
        if (nowMs - state.lastMapLibreOverlaySyncMs >= 150 && !actions.isMapLibreDynamicSourceBusy()) {
          state.lastMapLibreOverlaySyncMs = nowMs;
          actions.updateMapLibreOverlay();
        }
      }
      if (state.threeController && state.stageViewMode === '3d' && !(simTimelineController?.isHistoricalInspecting)) {
        state.threeController.updateTelemetry(msg.frame);
      }
      diagnosticsTracker.renderIntoDom(
        msg.frame,
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
        { isPanelVisible: actions.isDiagnosticsPanelVisible() }
      );
      actions.observeTelemetryTiming(msg.frame);
      if (actions.isDiagnosticsPanelVisible()) {
        actions.renderWorkerJitterProfiler(msg.frame);
        getSystemHealthHud().update({
          frame: msg.frame,
          rollingStepSamples: state.rollingWorkerStepSamples,
          rollingInterFrameDeltas: state.rollingWorkerInterFrameDeltas,
          recordedEventsCount: flightRecorder.getEventCount(),
        });
      }
    } else if (msg.type === 'PROFILE_FRAME') {
      // Stale-response protection: discard if the serial is not strictly newer than the
      // last accepted profile, or if the profile is for a different node than the one
      // currently selected by the UI. Neither condition can be guaranteed by timing alone.
      const serial = typeof msg.profileSerial === 'number' ? msg.profileSerial : -1;
      const nodeId = typeof msg.selectedNodeId === 'number' ? msg.selectedNodeId : -1;
      if (serial <= state.latestProfileSerial) return;
      if (nodeId !== state.selectedNodeId) return;
      if (!msg.fresnel || typeof msg.fresnel !== 'object') return;
      state.latestProfileSerial = serial;
      state.latestProfileNodeId = nodeId;
      if (typeof msg.spatial_revision === 'number') {
        state.currentSpatialRevision = msg.spatial_revision;
      }
      // Splice the refreshed profile data into the telemetry snapshot so the Canvas
      // renderer picks it up on its next animation frame without any other change.
      state.latestTelemetry = state.latestTelemetry
        ? {
            ...state.latestTelemetry,
            selected_node_fresnel: msg.fresnel,
            ...(msg.selected_link_budget ? { selected_link_budget: msg.selected_link_budget } : {}),
            ...(msg.nodes_telemetry ? { nodes_telemetry: msg.nodes_telemetry } : {}),
          }
        : null;
      state.terrainNeedsRender = true;
      actions.scheduleAnimationLoop();
      if (state.isPaused && !historyController.isInspecting && state.latestTelemetry) {
        actions.updateDashboardDOM(state.latestTelemetry, true);
        actions.drawFresnel();
      }
    } else if (msg.type === 'CUSTOM_DEM_LOADED') {
      if (msg.bounds) {
        state.activeTerrainBounds = msg.bounds;
        const geoBounds = msg.bounds as typeof msg.bounds & Partial<DemGeographicMetadata>;
        if (
          state.mapController &&
          Number.isFinite(geoBounds.centerLatDeg) &&
          Number.isFinite(geoBounds.centerLonDeg)
        ) {
          state.mapController.setOrigin(geoBounds.centerLatDeg!, geoBounds.centerLonDeg!);
        }
        window.centerMapOnTerrain?.(msg.bounds);
        state.pendingTerrainCenteringBounds = null;
      }
      actions.markUiDirtyAndWake();
    } else if (msg.type === 'HILLSHADE_READY') {
      actions.renderHillshadeFromWorker(
        msg.data as number[][],
        msg.grid_size || 512,
        msg.bounds_km || 300,
        msg.terrain_mode,
        msg.bounds
      );
      actions.requestTerrainMeshData(false);
      if (state.threeController && state.hillshadeCanvas) {
        state.threeController.setHillshadeCanvas(state.hillshadeCanvas);
      }
      if (msg.bounds) {
        state.activeTerrainBounds = msg.bounds;
        if (state.pendingTerrainCenteringBounds) {
          window.centerMapOnTerrain?.(msg.bounds);
          state.pendingTerrainCenteringBounds = null;
        }
      }
      actions.markUiDirtyAndWake();
    } else if (msg.type === 'TERRAIN_MESH_DATA_READY') {
      actions.handleTerrainMeshDataResponse(msg);
      if (msg.bounds) {
        state.activeTerrainBounds = msg.bounds;
        if (state.pendingTerrainCenteringBounds) {
          window.centerMapOnTerrain?.(msg.bounds);
          state.pendingTerrainCenteringBounds = null;
        }
      }
    } else if (msg.type === 'TERRAIN_BOUNDS_READY') {
      if (msg.bounds) {
        state.activeTerrainBounds = msg.bounds;
        if (state.pendingTerrainCenteringBounds) {
          window.centerMapOnTerrain?.(msg.bounds);
          state.pendingTerrainCenteringBounds = null;
        }
      }
    } else if (msg.type === 'COMMAND_RESULT') {
      if (simTimelineController && !simTimelineController.ingestCommandResult(msg)) {
        return;
      }
      routeCommandResult(msg, {
        pendingObstacleRequestId: obstacleEditor.pendingRequestId,
        pendingTrajectoryRequestId: state.pendingTrajectoryRequest,
        reconcileObstacle: result => {
          const reconciled = obstacleEditor.reconcile(result as ObstacleCommandResult);
          if (reconciled) {
            actions.syncObstacleFieldMirror(true);
            actions.refreshObstacleEditor();
          }
          return reconciled;
        },
        reconcileTrajectory: result => {
          if (!result.accepted) {
            state.pendingTrajectoryRequest = null;
            state.pendingAltitudeMode = null;
            state.flightParamsDirty = false;
            actions.restoreFlightParamsFromCommitted();
            trajectoryEditor.cancel();
            state.waypointPlacementArmed = false;
            actions.refreshTrajectoryEditor();
            actions.setTrajectoryMessage(`Worker rejected the path: ${result.reason || 'Invalid trajectory.'}`, true);
          } else {
            state.pendingTrajectoryRequest = null;
            state.pendingAltitudeMode = null;
            state.flightParamsDirty = false;
            actions.syncTrajectoryEditorFromWorker(result.trajectory_config as TrajectoryConfigTelemetry);
            actions.setTrajectoryMessage('Path committed by the simulation worker.');
          }
        },
        updateSpatialLock: actions.updateSpatialLockControl,
        setWorkerLabel: label => setText('worker-label', label),
      });
      actions.handleAglCommandResult(msg);
      actions.handleNodeCommandResult(msg);
      actions.handleTdmaCommandResult(msg);
    }
  };

  Object.assign(actions, {
    sendCommand,
    getSystemHealthHud,
    syncTelemetrySubscriptionProfile,
  });
}
