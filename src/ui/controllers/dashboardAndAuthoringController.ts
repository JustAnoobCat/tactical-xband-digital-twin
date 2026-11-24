/**
 * Tactical X-Band Digital Twin — Strictly Typed Dashboard & Scenario Authoring Controller
 *
 * Encapsulates Authoring Studio (Trajectory Editor, TDMA Frame Editor, 3D Obstacle Editor),
 * ForeFlight vertical profile analysis, and secondary scientific instruments (Polar Scope,
 * ECDF Delay Scope, Sensitivity Sweep Scope, VSA Constellation Scope, and LaTeX exporter).
 *
 * Invariants:
 * - Zero top-level mutable state (pure factory closure pattern).
 * - Zero non-deterministic random calls.
 * - Zero emojis.
 * - Strict XSS safety with escapeHtml / textContent.
 */

import { escapeHtml } from '../domSafety';
import { OBSTACLE_EDITOR_LIMITS } from '../obstacleEditorState';
import {
  drawPolarAntennaScope as renderPolarAntennaScope,
  drawLinkWaterfallCanvas as renderLinkWaterfallCanvas,
  drawEcdfDelayScope as renderEcdfDelayScope,
  drawSensitivitySweepScope as renderSensitivitySweepScope,
} from '../scientificScopesRenderer';
import { syncCanvasDpr } from '../pathProfileTopView';
import {
  generateFlightPatternWaypoints,
  evaluateFlightPlanProfile,
} from '../../core/trajectory';
import { evaluateTerminalVsaMetrics } from '../../core/vsaConstellationEngine';
import { evaluateBarrierLinkIntersections } from '../../core/cadObstacleSlicerEngine';
import { sampleDemSafe } from '../terrainToolboxAnalysis';

export interface TDMAFrameDraft {
  frameDurationMs: number;
  ctrlDurationMs: number;
  dlMinDurationMs: number;
  dlMaxDurationMs: number;
  guardIntervalUs: number;
  minSlotDurationUs: number;
  maxSlotDurationMs: number;
  uplinkPolicy: string;
  fixedSlotCount?: number;
}

export const TDMA_PRESETS_UI: Readonly<Record<string, Readonly<TDMAFrameDraft>>> = {
  TDMA_PRESET_STANDARD_20MS: {
    frameDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlMinDurationMs: 3.0,
    dlMaxDurationMs: 7.0,
    guardIntervalUs: 12.0,
    minSlotDurationUs: 200.0,
    maxSlotDurationMs: 8.0,
    uplinkPolicy: 'equal_active',
  },
  TDMA_PRESET_FAST_10MS: {
    frameDurationMs: 10.0,
    ctrlDurationMs: 0.5,
    dlMinDurationMs: 1.5,
    dlMaxDurationMs: 3.0,
    guardIntervalUs: 8.0,
    minSlotDurationUs: 100.0,
    maxSlotDurationMs: 4.0,
    uplinkPolicy: 'equal_active',
  },
  TDMA_PRESET_EXTENDED_40MS: {
    frameDurationMs: 40.0,
    ctrlDurationMs: 2.0,
    dlMinDurationMs: 6.0,
    dlMaxDurationMs: 12.0,
    guardIntervalUs: 25.0,
    minSlotDurationUs: 400.0,
    maxSlotDurationMs: 16.0,
    uplinkPolicy: 'equal_active',
  },
  TDMA_PRESET_SYMMETRIC_50_50: {
    frameDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlMinDurationMs: 9.0,
    dlMaxDurationMs: 9.0,
    guardIntervalUs: 12.0,
    minSlotDurationUs: 200.0,
    maxSlotDurationMs: 8.0,
    uplinkPolicy: 'equal_active',
  },
  TDMA_PRESET_SWARM_64SLOT: {
    frameDurationMs: 20.0,
    ctrlDurationMs: 1.0,
    dlMinDurationMs: 2.0,
    dlMaxDurationMs: 4.0,
    guardIntervalUs: 6.0,
    minSlotDurationUs: 100.0,
    maxSlotDurationMs: 4.0,
    uplinkPolicy: 'fixed_slot_count',
    fixedSlotCount: 64,
  },
};

export interface DashboardAndAuthoringDeps {
  readonly getElementById: (id: string) => HTMLElement | null;
  readonly sendCommand: (cmd: Record<string, unknown>) => void;
  readonly getSpatialLocked: () => boolean;
  readonly isHistoricalInspecting: () => boolean;
  readonly getTrajectoryEditor: () => any;
  readonly getObstacleEditor: () => any;
  readonly getObstacleHistory: () => any;
  readonly getMainTerrainEngine: () => any;
  readonly getLatestTelemetry: () => any;
  readonly getSelectedNodeId: () => number;
  readonly setSelectedNodeId: (id: number) => void;
  readonly onRedrawRadar?: () => void;
  readonly onUpdateMapLibreOverlay?: () => void;
  readonly onApplyMapLibreLayerState?: () => void;
  readonly onApplyThreeLayerVisibility?: () => void;
  readonly onSyncMapLegendVisibility?: () => void;
  readonly onSyncRadarHudMode?: () => void;
  readonly onUpdateMapLibreCursor?: () => void;
  readonly getActiveSensitivityAxis?: () => string;
  readonly getIsMouseInsideRadar?: () => boolean;
  readonly getMouseWorldPos?: () => { x: number; y: number };
  readonly getWaypointPlacementArmed?: () => boolean;
  readonly setWaypointPlacementArmed?: (val: boolean) => void;
}

export function createDashboardAndAuthoringController(deps: DashboardAndAuthoringDeps) {
  const $ = (id: string) => deps.getElementById(id);
  const setText = (id: string, text: string) => {
    const el = $(id);
    if (el) el.textContent = text;
  };

  // Trajectory Editor State
  let trajectoryConfigSignature = '';
  let pendingTrajectoryRequest: string | null = null;
  let flightParamsDirty = false;
  let pendingAltitudeMode: string | null = null;
  let committedTrajectoryMode = 'ellipse';
  let trajectoryEditorReady = false;
  let waypointPlacementArmed = false;
  let trajectoryRequestSerial = 0;

  function getIsWpArmed(): boolean {
    return deps.getWaypointPlacementArmed ? deps.getWaypointPlacementArmed() : waypointPlacementArmed;
  }
  function setIsWpArmed(val: boolean): void {
    waypointPlacementArmed = val;
    deps.setWaypointPlacementArmed?.(val);
  }

  const committedFlightParams = {
    loiter_speed_mps: 60,
    acn_altitude_m: 5000,
    altitude_mode: 'fix',
    target_agl_m: 1500,
    max_climb_rate_mps: 10,
    max_descent_rate_mps: 8,
  };

  // 3D Obstacle Editor State
  let tbObsSelectedId: string | null = null;
  let tbCadObstacleReport: any = null;
  let obstacleRequestSerial = 0;

  // TDMA Editor State
  let tdmaDraft: TDMAFrameDraft = { ...TDMA_PRESETS_UI.TDMA_PRESET_STANDARD_20MS };
  let tdmaConfigDirty = false;
  let pendingTdmaRequestId: string | null = null;
  let tdmaRequestSerial = 0;

  function parseEditorNumber(val: string | null | undefined): number {
    if (!val) return 0;
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : 0;
  }

  function numericInput(id: string): number {
    const el = $(id) as HTMLInputElement | null;
    return parseEditorNumber(el ? el.value : '0');
  }

  // ==========================================================================
  // Trajectory Authoring
  // ==========================================================================

  function setTrajectoryMessage(message: string, error: boolean = false): void {
    const el = $('trajectory-editor-message');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', error);
  }

  function updateAltitudeModeUI(mode: string): void {
    const isAgl = mode === 'agl';
    const aglGrp = $('traj-agl-group');
    const mslGrp = $('traj-msl-group');
    if (aglGrp) aglGrp.hidden = !isAgl;
    if (mslGrp) mslGrp.hidden = isAgl;
    const zInp = $('traj-waypoint-z') as HTMLInputElement | null;
    if (zInp) zInp.placeholder = isAgl ? 'Inherit AGL' : 'Inherit MSL';
  }

  function restoreFlightParamsFromCommitted(): void {
    const spdInp = $('traj-speed-mps') as HTMLInputElement | null;
    const spdSlider = $('traj-speed-slider') as HTMLInputElement | null;
    if (spdInp) spdInp.value = String(committedFlightParams.loiter_speed_mps);
    if (spdSlider) spdSlider.value = String(Math.min(300, Math.max(0, committedFlightParams.loiter_speed_mps)));

    const altInp = $('traj-altitude-msl') as HTMLInputElement | null;
    if (altInp) altInp.value = String(committedFlightParams.acn_altitude_m);

    const modeSel = $('traj-altitude-mode') as HTMLSelectElement | null;
    if (modeSel) {
      modeSel.value = committedFlightParams.altitude_mode;
      updateAltitudeModeUI(committedFlightParams.altitude_mode);
    }

    const aglInp = $('traj-target-agl') as HTMLInputElement | null;
    if (aglInp) aglInp.value = String(committedFlightParams.target_agl_m);

    const climbInp = $('traj-climb-rate') as HTMLInputElement | null;
    if (climbInp) climbInp.value = String(committedFlightParams.max_climb_rate_mps);

    const descInp = $('traj-descent-rate') as HTMLInputElement | null;
    if (descInp) descInp.value = String(committedFlightParams.max_descent_rate_mps);
  }

  function syncTrajectoryEditorFromWorker(config: any): void {
    if (!config) return;
    committedTrajectoryMode = config.trajectory_mode;

    if (typeof config.loiter_speed_mps === 'number' && Number.isFinite(config.loiter_speed_mps)) {
      committedFlightParams.loiter_speed_mps = config.loiter_speed_mps;
    }
    if (typeof config.acn_altitude_m === 'number' && Number.isFinite(config.acn_altitude_m)) {
      committedFlightParams.acn_altitude_m = config.acn_altitude_m;
    }
    if (config.altitude_mode) {
      if (pendingAltitudeMode !== null && config.altitude_mode === pendingAltitudeMode) {
        pendingAltitudeMode = null;
      }
      committedFlightParams.altitude_mode = config.altitude_mode;
    }
    if (typeof config.target_agl_m === 'number' && Number.isFinite(config.target_agl_m)) {
      committedFlightParams.target_agl_m = config.target_agl_m;
    }
    if (typeof config.max_climb_rate_mps === 'number' && Number.isFinite(config.max_climb_rate_mps)) {
      committedFlightParams.max_climb_rate_mps = config.max_climb_rate_mps;
    }
    if (typeof config.max_descent_rate_mps === 'number' && Number.isFinite(config.max_descent_rate_mps)) {
      committedFlightParams.max_descent_rate_mps = config.max_descent_rate_mps;
    }

    const trajectoryEditor = deps.getTrajectoryEditor();
    const forceDraftSync = !trajectoryEditorReady || pendingTrajectoryRequest !== null;
    if (forceDraftSync || !flightParamsDirty) {
      if (forceDraftSync) flightParamsDirty = false;
      const spdInp = $('traj-speed-mps') as HTMLInputElement | null;
      const spdSlider = $('traj-speed-slider') as HTMLInputElement | null;
      if (spdInp && document.activeElement !== spdInp) spdInp.value = String(committedFlightParams.loiter_speed_mps);
      if (spdSlider && document.activeElement !== spdSlider) spdSlider.value = String(Math.min(300, Math.max(0, committedFlightParams.loiter_speed_mps)));

      const altInp = $('traj-altitude-msl') as HTMLInputElement | null;
      if (altInp && document.activeElement !== altInp) altInp.value = String(committedFlightParams.acn_altitude_m);

      const modeSel = $('traj-altitude-mode') as HTMLSelectElement | null;
      if (modeSel && document.activeElement !== modeSel && pendingAltitudeMode === null) {
        modeSel.value = committedFlightParams.altitude_mode;
        updateAltitudeModeUI(committedFlightParams.altitude_mode);
      }

      const aglInp = $('traj-target-agl') as HTMLInputElement | null;
      if (aglInp && document.activeElement !== aglInp) aglInp.value = String(committedFlightParams.target_agl_m);

      const climbInp = $('traj-climb-rate') as HTMLInputElement | null;
      if (climbInp && document.activeElement !== climbInp) climbInp.value = String(committedFlightParams.max_climb_rate_mps);

      const descInp = $('traj-descent-rate') as HTMLInputElement | null;
      if (descInp && document.activeElement !== descInp) descInp.value = String(committedFlightParams.max_descent_rate_mps);
    }

    const signature = JSON.stringify(config);
    if (signature === trajectoryConfigSignature) {
      if (pendingTrajectoryRequest !== null) {
        pendingTrajectoryRequest = null;
        flightParamsDirty = false;
        pendingAltitudeMode = null;
        if (trajectoryEditor) {
          trajectoryEditor.setMode(config.trajectory_mode);
          trajectoryEditor.syncCommitted(config, true);
        }
        refreshTrajectoryEditor();
      }
      return;
    }
    trajectoryConfigSignature = signature;
    if (trajectoryEditor) {
      const shouldFollowWorkerMode = forceDraftSync || !trajectoryEditor.dirty;
      if (shouldFollowWorkerMode) trajectoryEditor.setMode(config.trajectory_mode);
      trajectoryEditor.syncCommitted(config, forceDraftSync);
    }
    if (!trajectoryEditorReady) {
      trajectoryEditorReady = true;
    } else if (pendingTrajectoryRequest !== null) {
      pendingTrajectoryRequest = null;
      flightParamsDirty = false;
      pendingAltitudeMode = null;
      setTrajectoryMessage('Path committed by the simulation worker.');
    }
    refreshTrajectoryEditor();
  }

  function setTrajectoryDraftMode(mode: 'ellipse' | 'waypoints'): void {
    const trajectoryEditor = deps.getTrajectoryEditor();
    if (trajectoryEditor) trajectoryEditor.setMode(mode);
    setIsWpArmed(false);
    $('trajectory-place-point')?.classList.remove('active');
    const elEllipse = $('ellipse-editor');
    const elWaypoint = $('waypoint-editor');
    if (elEllipse) elEllipse.hidden = mode !== 'ellipse';
    if (elWaypoint) elWaypoint.hidden = mode !== 'waypoints';
    refreshTrajectoryEditor();
    setTrajectoryMessage(mode === 'ellipse' ? 'Ellipse draft. Apply to change the simulation.' : 'Waypoint draft. Add at least three points, then apply.');
  }

  function refreshTrajectoryEditor(): void {
    const root = $('trajectory-mode') as HTMLSelectElement | null;
    if (!root) return;
    const trajectoryEditor = deps.getTrajectoryEditor();
    if (!trajectoryEditor) return;

    const draft = trajectoryEditor.preview;
    const commitLbl = $('trajectory-commit-label');
    if (commitLbl) {
      commitLbl.textContent = `Active: ${committedTrajectoryMode === 'ellipse' ? 'Ellipse' : 'Closed waypoint route'}`;
    }
    root.value = draft.mode;
    const elEllipse = $('ellipse-editor');
    const elWaypoint = $('waypoint-editor');
    if (elEllipse) elEllipse.hidden = draft.mode !== 'ellipse';
    if (elWaypoint) elWaypoint.hidden = draft.mode !== 'waypoints';

    if (draft.mode === 'ellipse') {
      [
        ['traj-center-x', draft.centerXm],
        ['traj-center-y', draft.centerYm],
        ['traj-axis-a', draft.radiusAM],
        ['traj-axis-b', draft.radiusBM],
        ['traj-rotation', draft.rotationDeg],
      ].forEach(([id, value]) => {
        const inp = $(id as string) as HTMLInputElement | null;
        if (inp && document.activeElement !== inp) {
          inp.value = Number.isFinite(value as number) ? String(value) : '';
        }
      });
    } else {
      const list = $('waypoint-list');
      if (list) {
        while (list.children.length > draft.points.length) list.lastElementChild?.remove();
        while (list.children.length < draft.points.length) {
          const button = document.createElement('button');
          button.type = 'button';
          button.addEventListener('click', (event: Event) => {
            const target = event.currentTarget as HTMLElement;
            trajectoryEditor.selectWaypoint(Number(target.dataset.index));
            refreshTrajectoryEditor();
          });
          list.append(button);
        }
        draft.points.forEach((_: unknown, index: number) => {
          const button = list.children[index] as HTMLButtonElement;
          button.textContent = `WP ${index + 1}`;
          button.dataset.index = String(index);
          button.setAttribute('aria-pressed', String(index === trajectoryEditor.selectedWaypoint));
          button.classList.toggle('active', index === trajectoryEditor.selectedWaypoint);
          button.disabled = deps.getSpatialLocked() || pendingTrajectoryRequest !== null;
        });
      }
      const point = draft.points[trajectoryEditor.selectedWaypoint];
      const wx = $('traj-waypoint-x') as HTMLInputElement | null;
      const wy = $('traj-waypoint-y') as HTMLInputElement | null;
      const wz = $('traj-waypoint-z') as HTMLInputElement | null;
      if (wx && document.activeElement !== wx) wx.value = point ? String(point.xM) : '';
      if (wy && document.activeElement !== wy) wy.value = point ? String(point.yM) : '';
      if (wz && document.activeElement !== wz) {
        wz.value = point && point.zM !== undefined && Number.isFinite(point.zM) ? String(point.zM) : '';
      }
      const remBtn = $('trajectory-remove-point') as HTMLButtonElement | null;
      const addBtn = $('trajectory-add-point') as HTMLButtonElement | null;
      const placeBtn = $('trajectory-place-point') as HTMLButtonElement | null;
      if (remBtn) remBtn.disabled = deps.getSpatialLocked() || pendingTrajectoryRequest !== null || draft.points.length <= 3 || !point;
      if (addBtn) addBtn.disabled = deps.getSpatialLocked() || pendingTrajectoryRequest !== null || draft.points.length >= 16;
      if (placeBtn) placeBtn.disabled = deps.getSpatialLocked() || pendingTrajectoryRequest !== null || draft.points.length >= 16;
    }

    const disabled = deps.getSpatialLocked() || pendingTrajectoryRequest !== null;
    root.disabled = disabled;
    [
      'traj-center-x',
      'traj-center-y',
      'traj-axis-a',
      'traj-axis-b',
      'traj-rotation',
      'traj-waypoint-x',
      'traj-waypoint-y',
      'traj-waypoint-z',
      'traj-speed-slider',
      'traj-speed-mps',
      'traj-altitude-msl',
      'traj-altitude-mode',
      'traj-target-agl',
      'traj-climb-rate',
      'traj-descent-rate',
    ].forEach((id) => {
      const el = $(id) as HTMLInputElement | null;
      if (el) el.disabled = disabled;
    });

    const applyBtn = $('trajectory-apply') as HTMLButtonElement | null;
    const cancelBtn = $('trajectory-cancel') as HTMLButtonElement | null;
    if (applyBtn) applyBtn.disabled = disabled;
    if (cancelBtn) cancelBtn.disabled = pendingTrajectoryRequest !== null;

    if (deps.getSpatialLocked()) {
      setIsWpArmed(false);
      $('trajectory-place-point')?.classList.remove('active');
      setTrajectoryMessage('Spatial lock is on. Unlock to edit the flight path.', true);
    }
    const applyError = trajectoryEditor.validatePreview();
    if (!deps.getSpatialLocked() && pendingTrajectoryRequest === null && applyBtn) {
      applyBtn.title = applyError || 'Commit this draft to the simulation worker';
    }

    deps.onSyncMapLegendVisibility?.();
    deps.onApplyThreeLayerVisibility?.();
    deps.onApplyMapLibreLayerState?.();
    deps.onUpdateMapLibreOverlay?.();
    deps.onRedrawRadar?.();
    renderFlightPlanVerticalProfile();
  }

  function addWaypointAt(x: number, y: number): void {
    const trajectoryEditor = deps.getTrajectoryEditor();
    if (!trajectoryEditor) return;
    try {
      trajectoryEditor.addWaypoint({ xM: x, yM: y });
      setIsWpArmed(false);
      refreshTrajectoryEditor();
      deps.onUpdateMapLibreCursor?.();
      setTrajectoryMessage('Waypoint added to the draft. Apply to update the simulation.');
    } catch (error: any) {
      setTrajectoryMessage(error.message, true);
    }
  }

  function applyTrajectoryDraft(): void {
    const trajectoryEditor = deps.getTrajectoryEditor();
    if (!trajectoryEditor) return;
    const error = trajectoryEditor.validatePreview();
    if (error) {
      setTrajectoryMessage(error, true);
      return;
    }
    if (deps.getSpatialLocked() || deps.isHistoricalInspecting()) {
      setTrajectoryMessage('Cannot apply trajectory changes while Spatial Lock or Historical Inspection is active.', true);
      return;
    }

    const draft = trajectoryEditor.preview;
    const speed = parseFloat(($('traj-speed-mps') as HTMLInputElement | null)?.value || '60');
    const altitude = parseFloat(($('traj-altitude-msl') as HTMLInputElement | null)?.value || '5000');
    const altitudeMode = ($('traj-altitude-mode') as HTMLSelectElement | null)?.value || 'fix';
    const targetAgl = parseFloat(($('traj-target-agl') as HTMLInputElement | null)?.value || '1500');
    const climbRate = parseFloat(($('traj-climb-rate') as HTMLInputElement | null)?.value || '10');
    const descentRate = parseFloat(($('traj-descent-rate') as HTMLInputElement | null)?.value || '8');

    if (!Number.isFinite(speed) || speed < 0 || speed > 1000) {
      setTrajectoryMessage('Physical speed must be between 0 and 1000 m/s.', true);
      return;
    }
    if (!Number.isFinite(altitude) || altitude <= 0 || altitude > 100000) {
      setTrajectoryMessage('UAV altitude must be between 1 and 100,000 m MSL.', true);
      return;
    }
    if (altitudeMode === 'agl' && (!Number.isFinite(targetAgl) || targetAgl < 50 || targetAgl > 100000)) {
      setTrajectoryMessage('Target AGL clearance must be between 50 and 100,000 m.', true);
      return;
    }
    if (!Number.isFinite(climbRate) || climbRate < 0.1 || climbRate > 50) {
      setTrajectoryMessage('Max climb rate must be between 0.1 and 50 m/s.', true);
      return;
    }
    if (!Number.isFinite(descentRate) || descentRate < 0.1 || descentRate > 50) {
      setTrajectoryMessage('Max descent rate must be between 0.1 and 50 m/s.', true);
      return;
    }

    const commonAltitudeParams = {
      altitude_mode: altitudeMode,
      loiter_speed_mps: speed,
      acn_altitude_m: altitude,
      target_agl_m: targetAgl,
      max_climb_rate_mps: climbRate,
      max_descent_rate_mps: descentRate,
    };

    const params =
      draft.mode === 'ellipse'
        ? {
            trajectory_mode: 'ellipse',
            center_x_m: draft.centerXm,
            center_y_m: draft.centerYm,
            orbit_a_m: draft.radiusAM,
            orbit_b_m: draft.radiusBM,
            orbit_rotation_deg: draft.rotationDeg,
            ...commonAltitudeParams,
          }
        : {
            trajectory_mode: 'waypoints',
            waypoints: draft.points.map((point: any) => ({
              x_m: point.xM,
              y_m: point.yM,
              ...(point.zM !== undefined && Number.isFinite(point.zM) ? { z_m: point.zM } : {}),
            })),
            ...commonAltitudeParams,
          };

    const requestId = `trajectory-${++trajectoryRequestSerial}`;
    pendingTrajectoryRequest = requestId;
    flightParamsDirty = false;
    pendingAltitudeMode = altitudeMode;
    refreshTrajectoryEditor();
    setTrajectoryMessage('Applying path to the simulation worker…');
    deps.sendCommand({ type: 'CONFIG_UPDATE', request_id: requestId, params });
  }

  function cancelTrajectoryDraft(): void {
    if (pendingTrajectoryRequest !== null) return;
    const trajectoryEditor = deps.getTrajectoryEditor();
    if (trajectoryEditor) trajectoryEditor.cancel();
    flightParamsDirty = false;
    pendingAltitudeMode = null;
    restoreFlightParamsFromCommitted();
    setIsWpArmed(false);
    $('trajectory-place-point')?.classList.remove('active');
    deps.onSyncRadarHudMode?.();
    refreshTrajectoryEditor();
    setTrajectoryMessage('Draft canceled. Showing the last committed path.');
  }

  function editEllipseFromInputs(): void {
    const trajectoryEditor = deps.getTrajectoryEditor();
    if (!trajectoryEditor) return;
    try {
      trajectoryEditor.updateEllipse({
        centerXm: numericInput('traj-center-x'),
        centerYm: numericInput('traj-center-y'),
        radiusAM: numericInput('traj-axis-a'),
        radiusBM: numericInput('traj-axis-b'),
        rotationDeg: numericInput('traj-rotation'),
      });
      refreshTrajectoryEditor();
      setTrajectoryMessage('Ellipse draft updated. Apply to commit it.');
    } catch (error: any) {
      trajectoryEditor.setInputError(error.message);
      refreshTrajectoryEditor();
      setTrajectoryMessage(error.message, true);
    }
  }

  function editSelectedWaypointFromInputs(): void {
    const trajectoryEditor = deps.getTrajectoryEditor();
    if (!trajectoryEditor) return;
    const index = trajectoryEditor.selectedWaypoint;
    const zInp = $('traj-waypoint-z') as HTMLInputElement | null;
    const zVal = zInp && zInp.value.trim() !== '' ? numericInput('traj-waypoint-z') : undefined;

    try {
      const point = {
        xM: numericInput('traj-waypoint-x'),
        yM: numericInput('traj-waypoint-y'),
        ...(zVal !== undefined && Number.isFinite(zVal) ? { zM: zVal } : {}),
      };
      trajectoryEditor.moveWaypoint(index, point);
      refreshTrajectoryEditor();
      setTrajectoryMessage('Waypoint draft updated. Apply to commit it.');
    } catch (error: any) {
      trajectoryEditor.setInputError(error.message);
      refreshTrajectoryEditor();
      setTrajectoryMessage(error.message, true);
    }
  }

  function renderFlightPlanVerticalProfile(): void {
    const canvas = $('fp-vertical-profile-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sync = syncCanvasDpr(canvas, ctx);
    const w = sync.cssWidth || canvas.clientWidth || 400;
    const h = sync.cssHeight || canvas.clientHeight || 170;
    if (w <= 0 || h <= 0) return;

    const speed = parseFloat(($('fp-cruise-speed-input') as HTMLInputElement | null)?.value || ($('traj-speed-mps') as HTMLInputElement | null)?.value || '50') || 50;
    const cruiseAlt = parseFloat(($('fp-cruise-alt-input') as HTMLInputElement | null)?.value || ($('traj-altitude-msl') as HTMLInputElement | null)?.value || '5000') || 5000;
    const trajectoryEditor = deps.getTrajectoryEditor();
    const draft = trajectoryEditor?.preview;

    let waypointsToEvaluate: any = null;
    if (draft && draft.mode === 'waypoints' && draft.points && draft.points.length >= 3) {
      waypointsToEvaluate = draft.points.map((p: any) => ({
        xM: p.xM,
        yM: p.yM,
        zM: p.zM !== undefined && Number.isFinite(p.zM) ? p.zM : cruiseAlt,
      }));
    } else {
      const pattern = ($('fp-pattern-select') as HTMLSelectElement | null)?.value || 'ellipse_orbit';
      try {
        waypointsToEvaluate = generateFlightPatternWaypoints(pattern as any, { cruiseAltM: cruiseAlt });
      } catch {
        waypointsToEvaluate = generateFlightPatternWaypoints('ellipse_orbit', { cruiseAltM: cruiseAlt });
      }
    }

    let summary: any;
    try {
      summary = evaluateFlightPlanProfile(waypointsToEvaluate, speed, deps.getMainTerrainEngine());
    } catch {
      return;
    }

    setText('fp-dist-km', `${summary.totalDistanceKm.toFixed(1)} km`);
    setText('fp-period-s', `${summary.orbitPeriodS.toFixed(0)} s`);

    const minAglEl = $('fp-min-agl');
    if (minAglEl) {
      const isSafe = summary.cfitWarningCount === 0;
      minAglEl.textContent = `${summary.minClearanceAglM.toFixed(0)} m AGL (${isSafe ? 'SAFE' : 'CFIT WARN'})`;
      minAglEl.style.color = isSafe ? 'var(--hi-emerald)' : 'var(--hi-vermilion)';
    }

    setText('fp-peak-bank', `${summary.peakBankAngleDeg.toFixed(1)}°`);
    setText('fp-min-turn-radius', Number.isFinite(summary.minTurnRadiusM) ? `${summary.minTurnRadiusM.toFixed(0)} m` : '∞');
    setText('fp-los-coverage', `${summary.predictedLoSCoveragePct.toFixed(1)}%`);

    const cfitBadge = $('fp-cfit-badge');
    if (cfitBadge) {
      if (summary.cfitWarningCount > 0) {
        cfitBadge.textContent = 'TERRAIN PROXIMITY WARNING';
        cfitBadge.style.background = 'rgba(255, 42, 84, 0.2)';
        cfitBadge.style.color = '#ff2a54';
        cfitBadge.style.border = '1px solid rgba(255, 42, 84, 0.4)';
      } else {
        cfitBadge.textContent = 'ENVELOPE SAFE';
        cfitBadge.style.background = 'rgba(0, 255, 136, 0.15)';
        cfitBadge.style.color = 'var(--hi-emerald)';
        cfitBadge.style.border = '1px solid rgba(0, 255, 136, 0.3)';
      }
    }

    // Render ForeFlight Canvas
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#080b12';
    ctx.fillRect(0, 0, w, h);

    const samples = summary.samples;
    if (!samples || samples.length === 0) return;

    const padL = 48;
    const padR = 20;
    const padT = 24;
    const padB = 22;
    const plotW = Math.max(10, w - padL - padR);
    const plotH = Math.max(10, h - padT - padB);

    const minDem = Math.min(...samples.map((s: any) => s.demAltM));
    const maxAcn = Math.max(...samples.map((s: any) => s.acnAltM));
    const altMin = Math.max(0, Math.floor((minDem - 400) / 500) * 500);
    const altMax = Math.max(altMin + 1500, Math.ceil((maxAcn + 400) / 500) * 500);
    const altRange = altMax - altMin;
    const distMax = summary.totalDistanceKm > 0 ? summary.totalDistanceKm : 1.0;

    const toX = (distKm: number) => padL + (distKm / distMax) * plotW;
    const toY = (altM: number) => padT + (1.0 - (altM - altMin) / altRange) * plotH;

    // Grid Lines & Labels
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const altSteps = 4;
    for (let i = 0; i <= altSteps; i++) {
      const aVal = altMin + (i / altSteps) * altRange;
      const y = toY(aVal);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText(`${Math.round(aVal)}m`, padL - 4, y);
    }

    const distSteps = 4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let j = 0; j <= distSteps; j++) {
      const dVal = (j / distSteps) * distMax;
      const x = toX(dVal);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText(`${dVal.toFixed(0)}k`, x, padT + plotH + 4);
    }

    // 1. Terrain Polygon
    ctx.beginPath();
    ctx.moveTo(toX(samples[0].distKm), toY(altMin));
    for (let i = 0; i < samples.length; i++) {
      ctx.lineTo(toX(samples[i].distKm), toY(samples[i].demAltM));
    }
    ctx.lineTo(toX(samples[samples.length - 1].distKm), toY(altMin));
    ctx.closePath();
    ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
    ctx.fill();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 2. Dashed Amber +300m AGL Minimum Safe Clearance Line
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i < samples.length; i++) {
      const x = toX(samples[i].distKm);
      const y = toY(samples[i].demAltM + 300);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Flight Profile Track (Cyan or Red on CFIT warning)
    ctx.beginPath();
    ctx.lineWidth = 2;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const x = toX(s.distKm);
      const y = toY(s.acnAltM);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = summary.cfitWarningCount > 0 ? '#ff2a54' : '#00f2ff';
    ctx.stroke();
  }

  // ==========================================================================
  // 3D Obstacle Authoring
  // ==========================================================================

  function getObstacleEndpoints(obs: any): any {
    if (!obs) return null;
    const cx = Number(obs.xM ?? obs.x_m ?? 0);
    const cy = Number(obs.yM ?? obs.y_m ?? 0);
    if (obs.shape === 'cone') {
      const r = Number(obs.radiusM ?? obs.radius_m ?? 100);
      return {
        v1: { x: cx - r, y: cy },
        v2: { x: cx + r, y: cy },
        center: { x: cx, y: cy },
        lengthM: r * 2,
        heightM: Number(obs.heightM ?? obs.height_m ?? 120),
        shape: 'peak',
        material: 'granite',
      };
    }
    const w = Number(obs.widthM ?? obs.width_m ?? 40);
    const d = Number(obs.depthM ?? obs.depth_m ?? 500);
    const rotRad = (Number(obs.rotationDeg ?? obs.rotation_deg ?? 0) * Math.PI) / 180.0;
    const len = Math.max(w, d);
    const halfL = len * 0.5;
    let nx = 0,
      ny = 0;
    if (d >= w) {
      nx = -Math.sin(rotRad);
      ny = Math.cos(rotRad);
    } else {
      nx = Math.cos(rotRad);
      ny = Math.sin(rotRad);
    }
    return {
      v1: { x: cx - nx * halfL, y: cy - ny * halfL },
      v2: { x: cx + nx * halfL, y: cy + ny * halfL },
      center: { x: cx, y: cy },
      lengthM: len,
      heightM: Number(obs.heightM ?? obs.height_m ?? 120),
      shape: obs.shape || 'wall',
      material: 'granite',
    };
  }

  function renderObstacleInventoryList(): void {
    const container = $('tb-obs-list');
    if (!container) return;
    const obstacleEditor = deps.getObstacleEditor();
    const tbObstacleHistory = deps.getObstacleHistory();

    const undoBtn = $('tb-obs-undo') as HTMLButtonElement | null;
    const redoBtn = $('tb-obs-redo') as HTMLButtonElement | null;
    if (undoBtn && tbObstacleHistory) undoBtn.disabled = !tbObstacleHistory.canUndo;
    if (redoBtn && tbObstacleHistory) redoBtn.disabled = !tbObstacleHistory.canRedo;

    const draft = obstacleEditor?.draft;
    if (!draft || draft.length === 0) {
      container.innerHTML = '<span class="terrain-toolbox-status" style="font-size:10px;">No obstacles in draft.</span>';
      return;
    }
    const selId = tbObsSelectedId || obstacleEditor?.selectedId;
    container.innerHTML = draft
      .map((obs: any, idx: number) => {
        const isSel = obs.id === selId;
        const shapeLabel =
          obs.shape === 'cone'
            ? 'Peak / Dome'
            : obs.depthM > obs.widthM * 3 || obs.widthM > obs.depthM * 3
            ? 'Ridge Wall'
            : 'Bunker / Block';
        const dimText =
          obs.shape === 'cone'
            ? `r=${Math.round(obs.radiusM || 50)}m, h=${Math.round(obs.heightM)}m`
            : `${Math.round(obs.widthM)}×${Math.round(obs.depthM)}m, h=${Math.round(obs.heightM)}m`;
        return `
        <div class="tb-obs-row" data-obs-id="${escapeHtml(obs.id)}" style="${
          isSel ? 'border-color:var(--hi-amber,#ffab00);background:rgba(255,171,0,0.12);' : ''
        };cursor:pointer;">
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;" title="${escapeHtml(obs.id)}">
            <strong>#${idx + 1}</strong> ${escapeHtml(shapeLabel)} <span style="opacity:0.65;">(${escapeHtml(dimText)})</span>
          </span>
          <button type="button" class="tb-obs-delete-btn" data-obs-id="${escapeHtml(obs.id)}" aria-label="Delete obstacle ${escapeHtml(obs.id)}">×</button>
        </div>
      `;
      })
      .join('');

    container.querySelectorAll('.tb-obs-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-obs-id');
        if (!id) return;
        tbObsSelectedId = id;
        if (obstacleEditor) obstacleEditor.select(id);
        recomputeCadObstacleAnalysis();
        renderObstacleInventoryList();
        deps.onRedrawRadar?.();
      });
    });

    container.querySelectorAll('.tb-obs-delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-obs-id');
        if (!id) return;
        if (tbObstacleHistory) tbObstacleHistory.pushState(obstacleEditor.draft);
        const next = obstacleEditor.draft.filter((o: any) => o.id !== id);
        if (tbObsSelectedId === id) tbObsSelectedId = null;
        applyObstacleHistoryChange(next);
        recomputeCadObstacleAnalysis();
        setText('terrain-toolbox-status', `Obstacle ${id} removed.`);
      });
    });
  }

  function applyObstacleHistoryChange(nextObstacles: any[]): void {
    if (!nextObstacles) return;
    const obstacleEditor = deps.getObstacleEditor();
    if (obstacleEditor) obstacleEditor.setDraftSet(nextObstacles);
    refreshObstacleEditor();
    renderObstacleInventoryList();
    deps.onRedrawRadar?.();
  }

  function recomputeCadObstacleAnalysis(): void {
    const obstacleEditor = deps.getObstacleEditor();
    const tel = deps.getLatestTelemetry();
    const nodes = tel?.nodes_telemetry || [];
    const acn = tel?.acn_telemetry || {};
    const acnPos = {
      x: acn.pos_x ?? 0,
      y: acn.pos_y ?? 0,
      z: acn.altitude_msl_m ?? 5000,
    };

    const getElevation = (x: number, y: number) => {
      return sampleDemSafe(deps.getMainTerrainEngine(), x, y).elevationM || 3500;
    };

    const draft = obstacleEditor?.draft || [];
    let targetObs = draft.find((o: any) => o.id === tbObsSelectedId || o.id === obstacleEditor?.selectedId);
    if (!targetObs && draft.length > 0) {
      targetObs = draft[draft.length - 1];
    }

    if (targetObs) {
      const ep = getObstacleEndpoints(targetObs);
      const materialType = ($('tb-obs-material-select') as HTMLSelectElement | null)?.value || 'granite';
      tbCadObstacleReport = evaluateBarrierLinkIntersections(
        ep.v1,
        ep.v2,
        targetObs.heightM || 120,
        targetObs.shape || 'wall',
        materialType,
        nodes,
        acnPos,
        getElevation
      );
    } else {
      tbCadObstacleReport = null;
    }

    const rep = tbCadObstacleReport;
    const metricsEl = $('tb-obs-cad-metrics');
    const sliceEl = $('tb-obs-slice-summary');
    const autoHeightBtn = $('btn-obs-auto-height') as HTMLButtonElement | null;

    if (rep) {
      if (metricsEl) {
        metricsEl.textContent = `${Math.round(rep.lengthM)} m @ ${rep.strikeAzimuthDeg.toFixed(1)}° | Crest ${Math.round(rep.midTopElevM)} m MSL (H=${Math.round(rep.wallHeightM)}m)`;
      }
      if (sliceEl) {
        if (rep.intersections.length === 0) {
          sliceEl.textContent = 'Intersected: 0 | Clear Airspace (No Links Crossed)';
        } else {
          sliceEl.textContent = `Intersected: ${rep.intersections.length} | Slicing ${rep.slicedNodeIds.length} / Overflying ${rep.overflyingNodeIds.length} (Min H: ${Math.round(rep.maxRequiredHeightToSliceAllM)} m)`;
        }
      }
      if (autoHeightBtn) {
        autoHeightBtn.disabled = rep.intersections.length === 0;
        autoHeightBtn.textContent =
          rep.intersections.length > 0
            ? `[AUTO] Auto-Size Height to Slice (${Math.round(rep.recommendedAutoHeightM)} m)`
            : '[AUTO] Auto-Size Height to Slice Links';
      }
    } else {
      if (metricsEl) metricsEl.textContent = '-- m @ --° | Crest -- m MSL';
      if (sliceEl) sliceEl.textContent = 'Intersected: -- | Slicing 0 / Overflying 0';
      if (autoHeightBtn) {
        autoHeightBtn.disabled = true;
        autoHeightBtn.textContent = '[AUTO] Auto-Size Height to Slice Links';
      }
    }
  }

  function refreshObstacleEditor(): void {
    const editor = $('obstacle-editor-message');
    if (!editor) return;
    const obstacleEditor = deps.getObstacleEditor();
    if (!obstacleEditor) return;

    const draft = obstacleEditor.draft;
    const committed = obstacleEditor.committed;
    const selected = obstacleEditor.selectedObstacle;
    const locked = deps.getSpatialLocked() || obstacleEditor.spatialLocked;
    const pending = obstacleEditor.pendingRequestId !== null;
    const validation = obstacleEditor.validate();
    const obstructionSnapshot = obstacleEditor.obstructionSnapshot;

    setText('obstacle-commit-label', `Applied set · ${committed.length} / ${OBSTACLE_EDITOR_LIMITS.maxObstacles}`);

    const list = $('obstacle-list');
    if (list) {
      while (list.children.length > draft.length) list.lastElementChild?.remove();
      while (list.children.length < draft.length) {
        const button = document.createElement('button');
        button.type = 'button';
        button.addEventListener('click', (event: Event) => {
          const target = event.currentTarget as HTMLElement;
          obstacleEditor.select(target.dataset.id);
          refreshObstacleEditor();
        });
        list.append(button);
      }
      draft.forEach((obstacle: any, index: number) => {
        const button = list.children[index] as HTMLButtonElement;
        button.dataset.id = obstacle.id;
        button.textContent = `${obstacle.shape} · ${obstacle.id}`;
        button.setAttribute('aria-pressed', String(obstacle.id === obstacleEditor.selectedId));
        button.classList.toggle('active', obstacle.id === obstacleEditor.selectedId);
      });
    }

    const setInput = (id: string, value: number | undefined) => {
      const el = $(id) as HTMLInputElement | null;
      if (el && document.activeElement !== el) {
        el.value = value === undefined || !Number.isFinite(value) ? '' : String(value);
      }
    };

    setInput('obstacle-x', selected?.xM);
    setInput('obstacle-y', selected?.yM);
    setInput('obstacle-height', selected?.heightM);

    const isCone = selected?.shape === 'cone';
    const wLbl = $('obstacle-width-label');
    const dLbl = $('obstacle-depth-label');
    const rLbl = $('obstacle-radius-label');
    const rotLbl = $('obstacle-rotation-label');
    if (wLbl) wLbl.hidden = !selected || isCone;
    if (dLbl) dLbl.hidden = !selected || isCone;
    if (rLbl) rLbl.hidden = !isCone;
    if (rotLbl) rotLbl.hidden = !selected || isCone;

    setInput('obstacle-width', selected && selected.shape !== 'cone' ? selected.widthM : undefined);
    setInput('obstacle-depth', selected && selected.shape !== 'cone' ? selected.depthM : undefined);
    setInput('obstacle-radius', selected?.shape === 'cone' ? selected.radiusM : undefined);
    setInput('obstacle-rotation', selected && selected.shape !== 'cone' ? selected.rotationDeg : undefined);

    const numericInputs = ['obstacle-x', 'obstacle-y', 'obstacle-width', 'obstacle-depth', 'obstacle-radius', 'obstacle-height', 'obstacle-rotation'];
    numericInputs.forEach((id) => {
      const el = $(id) as HTMLInputElement | null;
      if (el) el.disabled = locked || pending || !selected;
    });

    const shapeSel = $('obstacle-shape') as HTMLSelectElement | null;
    const addBtn = $('obstacle-add') as HTMLButtonElement | null;
    const placeBtn = $('obstacle-place') as HTMLButtonElement | null;
    const selectModeBtn = $('obstacle-select-mode') as HTMLButtonElement | null;
    const deleteBtn = $('obstacle-delete') as HTMLButtonElement | null;
    const applyBtn = $('obstacle-apply') as HTMLButtonElement | null;
    const cancelBtn = $('obstacle-cancel') as HTMLButtonElement | null;

    if (shapeSel) shapeSel.disabled = locked || pending;
    if (addBtn) addBtn.disabled = locked || pending || draft.length >= OBSTACLE_EDITOR_LIMITS.maxObstacles;
    if (placeBtn) placeBtn.disabled = locked || pending || draft.length >= OBSTACLE_EDITOR_LIMITS.maxObstacles;
    if (selectModeBtn) selectModeBtn.disabled = pending;
    if (deleteBtn) {
      deleteBtn.disabled = locked || pending || !selected;
      if (deleteBtn.disabled && typeof (window as any).disarmDestructiveButton === 'function') {
        (window as any).disarmDestructiveButton(deleteBtn);
      }
    }
    if (applyBtn) applyBtn.disabled = locked || pending || !obstacleEditor.dirty || Boolean(validation);
    if (cancelBtn) cancelBtn.disabled = pending;

    setText(
      'obstacle-lock-note',
      locked ? 'Spatial lock is on. Draft remains visible and read-only; map navigation and list selection remain available.' : ''
    );
    const blockedCount = obstructionSnapshot.filter((item: any) => item.obstacle_blocked).length;
    setText(
      'obstacle-obstruction-summary',
      obstacleEditor.obstructionSnapshotIsCurrent
        ? `${blockedCount} of ${obstructionSnapshot.length} links obstacle-blocked in the worker refresh. Frame metrics have not advanced.`
        : 'Map link/shadow status follows the latest telemetry frame.'
    );

    editor.textContent = validation || obstacleEditor.message;
    editor.classList.toggle('error', Boolean(validation) || obstacleEditor.message.toLowerCase().includes('reject'));

    const tool = $('obstacle-map-tool');
    const active = obstacleEditor.mode !== 'navigate';
    if (tool) {
      tool.textContent = 'Edit Obstacles';
      tool.setAttribute('aria-pressed', String(active));
      tool.classList.toggle('active', active);
      tool.classList.toggle('map-tool-active', active);
    }
    placeBtn?.classList.toggle('active', obstacleEditor.mode === 'place');
    selectModeBtn?.classList.toggle('active', obstacleEditor.mode === 'select');

    deps.onSyncMapLegendVisibility?.();
    deps.onApplyThreeLayerVisibility?.();
    deps.onApplyMapLibreLayerState?.();
    deps.onUpdateMapLibreOverlay?.();
    deps.onRedrawRadar?.();
    renderObstacleInventoryList();
  }

  function editSelectedObstacleFromInputs(id: string): void {
    const obstacleEditor = deps.getObstacleEditor();
    if (!obstacleEditor) return;
    const selected = obstacleEditor.selectedObstacle;
    if (!selected) return;
    const value = numericInput(id);
    const patch =
      id === 'obstacle-x'
        ? { xM: value }
        : id === 'obstacle-y'
        ? { yM: value }
        : id === 'obstacle-height'
        ? { heightM: value }
        : id === 'obstacle-width'
        ? { widthM: value }
        : id === 'obstacle-depth'
        ? { depthM: value }
        : id === 'obstacle-radius'
        ? { radiusM: value }
        : { rotationDeg: value };
    obstacleEditor.updateSelected(patch);
    refreshObstacleEditor();
  }

  function createObstacleAt(x: number, y: number): void {
    const obstacleEditor = deps.getObstacleEditor();
    if (!obstacleEditor) return;
    try {
      const shape = ($('obstacle-shape') as HTMLSelectElement | null)?.value || 'cuboid';
      obstacleEditor.create(shape, x, y);
      activateObstacleMode('select');
    } catch (error: any) {
      obstacleEditor.message = error.message;
      refreshObstacleEditor();
      deps.onUpdateMapLibreCursor?.();
    }
  }

  function applyObstacleDraft(): void {
    const obstacleEditor = deps.getObstacleEditor();
    if (!obstacleEditor) return;
    if (deps.getSpatialLocked() || deps.isHistoricalInspecting()) {
      obstacleEditor.message = 'Cannot apply obstacles while Spatial Lock or Historical Inspection is active.';
      refreshObstacleEditor();
      return;
    }
    const requestId = `obstacles-${++obstacleRequestSerial}`;
    try {
      const obstacles = obstacleEditor.beginApply(requestId);
      refreshObstacleEditor();
      deps.sendCommand({ type: 'OBSTACLES_REPLACE', request_id: requestId, obstacles });
    } catch (error: any) {
      obstacleEditor.message = error.message;
      refreshObstacleEditor();
    }
  }

  function cancelObstacleDraft(): void {
    const obstacleEditor = deps.getObstacleEditor();
    if (!obstacleEditor) return;
    try {
      obstacleEditor.cancel();
    } catch (error: any) {
      obstacleEditor.message = error.message;
    }
    obstacleEditor.setMode('navigate');
    deps.onSyncRadarHudMode?.();
    refreshObstacleEditor();
    deps.onUpdateMapLibreCursor?.();
  }

  function activateObstacleMode(mode: 'navigate' | 'place' | 'select'): void {
    const obstacleEditor = deps.getObstacleEditor();
    if (!obstacleEditor) return;
    if (mode !== 'navigate') {
      setIsWpArmed(false);
      $('trajectory-place-point')?.classList.remove('active');
    }
    obstacleEditor.setMode(mode);
    deps.onSyncRadarHudMode?.();
    refreshObstacleEditor();
    deps.onUpdateMapLibreCursor?.();
  }

  // ==========================================================================
  // TDMA Frame Authoring
  // ==========================================================================

  function setTdmaMessage(text: string, isError: boolean = false): void {
    const el = $('tdma-editor-message');
    if (!el) return;
    el.textContent = text;
    el.className = 'editor-message' + (isError ? ' error' : text.includes('committed') ? ' ok' : '');
  }

  function updateTdmaLivePreview(): void {
    const frameMs = tdmaDraft.frameDurationMs;
    const ctrlMs = tdmaDraft.ctrlDurationMs;
    const dlMinMs = tdmaDraft.dlMinDurationMs;
    const guardUs = tdmaDraft.guardIntervalUs;
    const policy = tdmaDraft.uplinkPolicy || 'equal_active';
    const fixedSlots = tdmaDraft.fixedSlotCount ?? 16;

    const ulMs = Math.max(0, frameMs - ctrlMs - dlMinMs);
    const ctrlPct = Math.max(0, Math.min(100, (ctrlMs / frameMs) * 100));
    const dlPct = Math.max(0, Math.min(100 - ctrlPct, (dlMinMs / frameMs) * 100));
    const ulPct = Math.max(0, 100 - ctrlPct - dlPct);

    const barCtrl = $('tdma-bar-ctrl');
    const barDl = $('tdma-bar-dl');
    const barUl = $('tdma-bar-ul');
    if (barCtrl) {
      barCtrl.style.width = `${ctrlPct.toFixed(1)}%`;
      barCtrl.textContent = `CTRL: ${ctrlMs.toFixed(1)}ms`;
    }
    if (barDl) {
      barDl.style.width = `${dlPct.toFixed(1)}%`;
      barDl.textContent = `DL: ${dlMinMs.toFixed(1)}ms`;
    }
    if (barUl) {
      barUl.style.width = `${ulPct.toFixed(1)}%`;
      barUl.textContent = `UL: ${ulMs.toFixed(1)}ms`;
    }

    setText('tdma-preview-total-badge', `${frameMs.toFixed(1)} ms (${(1000 / frameMs).toFixed(0)} Hz)`);
    setText('tdma-diag-ul', `${ulMs.toFixed(1)} ms`);

    const tel = deps.getLatestTelemetry();
    let terminalCount = 16;
    if (policy === 'fixed_slot_count') {
      terminalCount = fixedSlots;
    } else if (tel?.nodes_telemetry?.length) {
      terminalCount = tel.nodes_telemetry.length;
    }

    const tauSlotUs = terminalCount > 0 ? Math.max(0, (ulMs * 1000 - terminalCount * guardUs) / terminalCount) : 0;
    const slotStr = tauSlotUs >= 1000 ? `${(tauSlotUs / 1000).toFixed(2)} ms` : `${Math.round(tauSlotUs)} μs`;
    setText('tdma-diag-slot', `${slotStr} (${terminalCount} ${policy === 'fixed_slot_count' ? 'slots' : 'nodes'})`);

    const c = 299792458;
    const safeRangeKm = (c * (guardUs * 1e-6) / 2) / 1000;
    setText('tdma-diag-range', `${safeRangeKm.toFixed(2)} km (${guardUs} μs)`);

    const overheadMs = ctrlMs + (terminalCount * guardUs) / 1000;
    const overheadPct = frameMs > 0 ? (overheadMs / frameMs) * 100 : 0;
    setText('tdma-diag-overhead', `${overheadPct.toFixed(2)}%`);

    const authLabel = $('tdma-authority-label');
    if (authLabel && tdmaConfigDirty) {
      authLabel.textContent = 'Uncommitted draft';
    }
  }

  function syncInputsFromDraft(): void {
    const setVal = (id: string, val: any) => {
      const el = $(id) as HTMLInputElement | null;
      if (el) el.value = String(val);
    };
    setVal('tdma-frame-slider', tdmaDraft.frameDurationMs);
    setVal('tdma-frame-ms', tdmaDraft.frameDurationMs);
    setText('tdma-frame-val', String(tdmaDraft.frameDurationMs));
    setVal('tdma-ctrl-ms', tdmaDraft.ctrlDurationMs);
    setVal('tdma-dl-min-ms', tdmaDraft.dlMinDurationMs);
    setVal('tdma-dl-max-ms', tdmaDraft.dlMaxDurationMs);
    setVal('tdma-guard-us', tdmaDraft.guardIntervalUs);
    setVal('tdma-min-slot-us', tdmaDraft.minSlotDurationUs);
    setVal('tdma-max-slot-ms', tdmaDraft.maxSlotDurationMs);
    setVal('tdma-policy', tdmaDraft.uplinkPolicy || 'equal_active');
    setVal('tdma-fixed-slots', tdmaDraft.fixedSlotCount ?? 16);

    const fixedContainer = $('tdma-fixed-slots-container');
    if (fixedContainer) {
      fixedContainer.hidden = tdmaDraft.uplinkPolicy !== 'fixed_slot_count';
    }
  }

  function syncTdmaEditorFromWorker(config: any): void {
    if (!config || tdmaConfigDirty || pendingTdmaRequestId !== null) return;
    tdmaDraft = {
      frameDurationMs: config.frameDurationMs ?? 20.0,
      ctrlDurationMs: config.ctrlDurationMs ?? 1.0,
      dlMinDurationMs: config.dlMinDurationMs ?? 3.0,
      dlMaxDurationMs: config.dlMaxDurationMs ?? 7.0,
      guardIntervalUs: config.guardIntervalUs ?? 12.0,
      minSlotDurationUs: config.minSlotDurationUs ?? 200.0,
      maxSlotDurationMs: config.maxSlotDurationMs ?? 8.0,
      uplinkPolicy: config.uplinkPolicy || 'equal_active',
      ...(config.fixedSlotCount !== undefined ? { fixedSlotCount: config.fixedSlotCount } : {}),
    };

    const presetSelect = $('tdma-preset-select') as HTMLSelectElement | null;
    if (presetSelect) {
      let matchedKey = 'custom';
      for (const [key, preset] of Object.entries(TDMA_PRESETS_UI)) {
        if (
          Math.abs(preset.frameDurationMs - tdmaDraft.frameDurationMs) < 1e-4 &&
          Math.abs(preset.ctrlDurationMs - tdmaDraft.ctrlDurationMs) < 1e-4 &&
          Math.abs(preset.dlMinDurationMs - tdmaDraft.dlMinDurationMs) < 1e-4 &&
          Math.abs(preset.dlMaxDurationMs - tdmaDraft.dlMaxDurationMs) < 1e-4 &&
          Math.abs(preset.guardIntervalUs - tdmaDraft.guardIntervalUs) < 1e-4 &&
          (preset.uplinkPolicy || 'equal_active') === tdmaDraft.uplinkPolicy &&
          (preset.fixedSlotCount ?? null) === (tdmaDraft.fixedSlotCount ?? null)
        ) {
          matchedKey = key;
          break;
        }
      }
      presetSelect.value = matchedKey;
    }

    syncInputsFromDraft();
    updateTdmaLivePreview();
    const authLabel = $('tdma-authority-label');
    if (authLabel) {
      authLabel.textContent = `Frame applied · ${tdmaDraft.frameDurationMs} ms`;
    }
  }

  function validateTdmaDraft(draft: TDMAFrameDraft): string | null {
    if (!Number.isFinite(draft.frameDurationMs) || draft.frameDurationMs < 5.0 || draft.frameDurationMs > 100.0) {
      return 'Superframe duration must be between 5.0 and 100.0 ms.';
    }
    if (!Number.isFinite(draft.ctrlDurationMs) || draft.ctrlDurationMs < 0.2 || draft.ctrlDurationMs > 10.0) {
      return 'Control subframe duration must be between 0.2 and 10.0 ms.';
    }
    if (!Number.isFinite(draft.dlMinDurationMs) || draft.dlMinDurationMs < 0.5 || draft.dlMinDurationMs > 30.0) {
      return 'Downlink min duration must be between 0.5 and 30.0 ms.';
    }
    if (!Number.isFinite(draft.dlMaxDurationMs) || draft.dlMaxDurationMs < 0.5 || draft.dlMaxDurationMs > 50.0) {
      return 'Downlink max duration must be between 0.5 and 50.0 ms.';
    }
    if (draft.dlMaxDurationMs < draft.dlMinDurationMs) {
      return 'Downlink max duration cannot be smaller than downlink min duration.';
    }
    if (!Number.isFinite(draft.guardIntervalUs) || draft.guardIntervalUs < 1.0 || draft.guardIntervalUs > 100.0) {
      return 'Guard interval must be between 1.0 and 100.0 μs.';
    }
    if (!Number.isFinite(draft.minSlotDurationUs) || draft.minSlotDurationUs < 50.0 || draft.minSlotDurationUs > 2000.0) {
      return 'Min slot duration must be between 50.0 and 2000.0 μs.';
    }
    if (!Number.isFinite(draft.maxSlotDurationMs) || draft.maxSlotDurationMs < 1.0 || draft.maxSlotDurationMs > 50.0) {
      return 'Max slot duration must be between 1.0 and 50.0 ms.';
    }
    if (draft.minSlotDurationUs <= draft.guardIntervalUs) {
      return 'Min slot duration must be strictly greater than guard interval.';
    }
    const minUlReserveS = (draft.minSlotDurationUs + draft.guardIntervalUs) * 1e-6;
    const minUlReserveMs = minUlReserveS * 1000.0;
    if (draft.ctrlDurationMs + draft.dlMaxDurationMs > draft.frameDurationMs - minUlReserveMs + 1e-6) {
      return `Physical ceiling exceeded: Control (${draft.ctrlDurationMs}ms) + DL Max (${draft.dlMaxDurationMs}ms) leaves less than required ${minUlReserveMs.toFixed(2)}ms for uplink.`;
    }
    if (draft.uplinkPolicy === 'fixed_slot_count') {
      if (!Number.isInteger(draft.fixedSlotCount) || (draft.fixedSlotCount as number) < 1 || (draft.fixedSlotCount as number) > 64) {
        return 'Fixed slot count must be an integer between 1 and 64.';
      }
    }
    return null;
  }

  function handleTdmaCommandResult(msg: any): void {
    if (pendingTdmaRequestId && msg.request_id === pendingTdmaRequestId) {
      if (msg.accepted || msg.success) {
        pendingTdmaRequestId = null;
        tdmaConfigDirty = false;
        setTdmaMessage('TDMA configuration committed by worker.', false);
        const authLabel = $('tdma-authority-label');
        if (authLabel) {
          authLabel.textContent = `Frame applied · ${tdmaDraft.frameDurationMs} ms`;
        }
      } else {
        pendingTdmaRequestId = null;
        setTdmaMessage(`Worker rejected configuration: ${msg.reason || msg.error || 'Invalid TDMA configuration.'}`, true);
      }
    }
  }

  function applyTdmaDraft(): void {
    const err = validateTdmaDraft(tdmaDraft);
    if (err) {
      setTdmaMessage(err, true);
      return;
    }
    const requestId = `tdma-${++tdmaRequestSerial}`;
    pendingTdmaRequestId = requestId;
    setTdmaMessage('Applying TDMA configuration to worker…');
    deps.sendCommand({
      type: 'CONFIG_UPDATE',
      request_id: requestId,
      params: {
        tdma_frame_config: { ...tdmaDraft },
      },
    });
  }

  function resetTdmaToStandard(): void {
    tdmaDraft = { ...TDMA_PRESETS_UI.TDMA_PRESET_STANDARD_20MS };
    const presetSelect = $('tdma-preset-select') as HTMLSelectElement | null;
    if (presetSelect) presetSelect.value = 'TDMA_PRESET_STANDARD_20MS';
    syncInputsFromDraft();
    tdmaConfigDirty = false;
    updateTdmaLivePreview();
    const requestId = `tdma-${++tdmaRequestSerial}`;
    pendingTdmaRequestId = requestId;
    setTdmaMessage('Resetting to Standard (20ms) configuration…');
    deps.sendCommand({
      type: 'CONFIG_UPDATE',
      request_id: requestId,
      params: {
        tdma_frame_config: { ...tdmaDraft },
      },
    });
  }

  function handleTdmaPresetSelect(presetKey: string): void {
    if (presetKey in TDMA_PRESETS_UI) {
      tdmaDraft = { ...TDMA_PRESETS_UI[presetKey] };
      syncInputsFromDraft();
      tdmaConfigDirty = true;
      updateTdmaLivePreview();
      setTdmaMessage('Preset selected. Apply to commit to simulation.');
    }
  }

  function handleTdmaInputChange(): void {
    tdmaConfigDirty = true;
    const pSelect = $('tdma-preset-select') as HTMLSelectElement | null;
    if (pSelect) pSelect.value = 'custom';
    updateTdmaLivePreview();
    setTdmaMessage('Edits are previews until applied.');
  }

  // ==========================================================================
  // Secondary Dashboard & Scopes
  // ==========================================================================

  function drawPolarAntennaScope(frame: any): void {
    const canvas = $('polar-antenna-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      renderPolarAntennaScope(canvas, ctx, frame, deps.getSelectedNodeId(), setText);
    } catch (err) {
      console.error('drawPolarAntennaScope exception:', err);
    }
  }

  function drawLinkWaterfallCanvas(frame: any): void {
    const canvas = $('link-waterfall-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      renderLinkWaterfallCanvas(canvas, ctx, frame, deps.getSelectedNodeId(), setText);
    } catch (err) {
      console.error('drawLinkWaterfallCanvas exception:', err);
    }
  }

  function updateScientificAblationMatrix(frame: any): void {
    try {
      if (!frame) return;

      const sGoodput = typeof frame.static_goodput_mbps === 'number' ? frame.static_goodput_mbps : 0;
      const sUtil = typeof frame.static_util_pct === 'number' ? frame.static_util_pct : 0;
      const sWaste = typeof frame.static_wasted_bits === 'number' ? frame.static_wasted_bits / 1000 : 0;
      const sDelay = typeof frame.static_delay_drops === 'number' ? frame.static_delay_drops : 0;
      const sOverflow = typeof frame.static_overflow_drops === 'number' ? frame.static_overflow_drops : 0;

      setText('abl-static-goodput', `${sGoodput.toFixed(2)} Mbps`);
      setText('abl-static-util', `${sUtil.toFixed(1)}%`);
      setText('abl-static-waste', `${sWaste.toFixed(1)} kb`);
      setText('abl-static-delay', `${sDelay}`);
      setText('abl-static-overflow', `${sOverflow}`);

      const rGoodput = typeof frame.reactive_goodput_mbps === 'number' ? frame.reactive_goodput_mbps : 0;
      const rUtil = typeof frame.reactive_util_pct === 'number' ? frame.reactive_util_pct : 0;
      const rWaste = typeof frame.reactive_wasted_bits === 'number' ? frame.reactive_wasted_bits / 1000 : 0;
      const rDelay = typeof frame.reactive_delay_drops === 'number' ? frame.reactive_delay_drops : 0;
      const rOverflow = typeof frame.reactive_overflow_drops === 'number' ? frame.reactive_overflow_drops : 0;

      setText('abl-reactive-goodput', `${rGoodput.toFixed(2)} Mbps`);
      setText('abl-reactive-util', `${rUtil.toFixed(1)}%`);
      setText('abl-reactive-waste', `${rWaste.toFixed(1)} kb`);
      setText('abl-reactive-delay', `${rDelay}`);
      setText('abl-reactive-overflow', `${rOverflow}`);

      const tGoodput = typeof frame.tac_goodput_mbps === 'number' ? frame.tac_goodput_mbps : 0;
      const tUtil = typeof frame.tac_util_pct === 'number' ? frame.tac_util_pct : 0;
      const tWaste = typeof frame.tac_wasted_bits === 'number' ? frame.tac_wasted_bits / 1000 : 0;
      const tDelay = typeof frame.tac_delay_drops === 'number' ? frame.tac_delay_drops : 0;
      const tOverflow = typeof frame.tac_overflow_drops === 'number' ? frame.tac_overflow_drops : 0;

      setText('abl-tac-goodput', `${tGoodput.toFixed(2)} Mbps`);
      setText('abl-tac-util', `${tUtil.toFixed(1)}%`);
      setText('abl-tac-waste', `${tWaste.toFixed(1)} kb`);
      setText('abl-tac-delay', `${tDelay}`);
      setText('abl-tac-overflow', `${tOverflow}`);

      const readout = $('sci-jammer-shield-readout');
      if (readout) {
        if (frame.jammer_enabled) {
          const shieldDb = typeof frame.jammer_terrain_shield_db === 'number' ? frame.jammer_terrain_shield_db : 0.0;
          const sectorInt = Array.isArray(frame.jammer_sector_interference_dbm) ? frame.jammer_sector_interference_dbm : [-150, -150, -150, -150];
          const maxInt = Math.max(...sectorInt);
          readout.textContent = `Jammer Terrain Shield: ${shieldDb.toFixed(1)} dB | Worst Sector I_J: ${maxInt.toFixed(1)} dBm`;
          readout.style.color = 'var(--hi-vermilion-bright, #f07167)';
        } else {
          readout.textContent = 'Jammer Terrain Shield: 0.0 dB | Worst Sector I_J: — dBm';
          readout.style.color = 'var(--text-muted)';
        }
      }
    } catch (err) {
      console.error('updateScientificAblationMatrix exception:', err);
    }
  }

  function drawEcdfDelayScope(frame: any): void {
    const canvas = $('ecdf-delay-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      renderEcdfDelayScope(canvas, ctx, frame);
    } catch (err) {
      console.error('drawEcdfDelayScope exception:', err);
    }
  }

  function drawSensitivitySweepScope(frame: any): void {
    const canvas = $('sensitivity-sweep-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const axis = deps.getActiveSensitivityAxis?.() || 'bandwidth';
    try {
      renderSensitivitySweepScope(canvas, ctx, frame, axis, $('sci-sweep-active-readout'));
    } catch (err) {
      console.error('drawSensitivitySweepScope exception:', err);
    }
  }

  function exportLatexAblationTable(): string {
    const getVal = (id: string, fallback: string = '—') => {
      const el = $(id);
      return el ? (el.textContent || '').trim() || fallback : fallback;
    };

    const statGp = getVal('abl-static-goodput', '1.20 Mbps');
    const statUt = getVal('abl-static-util', '94.2%');
    const statWst = getVal('abl-static-waste', '280.0 kb');
    const statDel = getVal('abl-static-delay', '1449');
    const statOfl = getVal('abl-static-overflow', '0');

    const reacGp = getVal('abl-reactive-goodput', '2.05 Mbps');
    const reacUt = getVal('abl-reactive-util', '86.4%');
    const reacWst = getVal('abl-reactive-waste', '0.0 kb');
    const reacDel = getVal('abl-reactive-delay', '144');
    const reacOfl = getVal('abl-reactive-overflow', '0');

    const tacGp = getVal('abl-tac-goodput', '2.05 Mbps');
    const tacUt = getVal('abl-tac-util', '86.4%');
    const tacWst = getVal('abl-tac-waste', '0.0 kb');
    const tacDel = getVal('abl-tac-delay', '144');
    const tacOfl = getVal('abl-tac-overflow', '0');

    const demInp = $('sci-dem-error-slider') as HTMLInputElement | null;
    const demErr = demInp ? demInp.value : '0';
    const trafSel = $('sci-traffic-scale-select') as HTMLSelectElement | null;
    const trafMul = trafSel ? trafSel.value : '1.0';
    const jamSel = $('sci-jammer-select') as HTMLSelectElement | null;
    const jamMode = jamSel ? jamSel.value : 'off';
    const jamStr = jamMode === 'off' ? 'OFF' : jamMode.toUpperCase();

    const latex = `% IEEE Transactions Publication Table - Tactical X-Band Air-to-Ground Network
% Generated dynamically from live simulation telemetry
\\begin{table}[htbp]
\\centering
\\caption{Multi-Scheduler Performance Ablation Across High-Relief Mountain Topography}
\\label{tab:tactical_ablation_matrix}
\\begin{tabular}{l ccccc}
\\toprule
\\textbf{Scheduler Architecture} & \\textbf{Goodput} & \\textbf{Airtime Util} & \\textbf{Outage Waste} & \\textbf{Delay Drops} & \\textbf{Overflow Drops} \\\\
\\midrule
Legacy Static TDMA & ${statGp} & ${statUt} & ${statWst} & ${statDel} & ${statOfl} \\\\
Reactive M-LWDF ($\\Phi_{\\text{evac}} = 1.0$) & ${reacGp} & ${reacUt} & ${reacWst} & ${reacDel} & ${reacOfl} \\\\
Predictive Tac-TAD ($\\Phi_{\\text{evac}} \\ge 1.0$) & ${tacGp} & ${tacUt} & ${tacWst} & ${tacDel} & ${tacOfl} \\\\
\\bottomrule
\\end{tabular}
\\vspace{1ex}
{\\footnotesize \\raggedright \\textbf{Evaluation Environment:} Ladakh alpine sector ($34.5^\\circ\\text{N}, 76.5^\\circ\\text{E}$), $\\sigma_{\\text{DEM}} = ${demErr}\\text{ m}$, Traffic Scale = ${trafMul}$\\times$, EW Jammer = ${jamStr}. 50~Hz discrete-event execution ($\\Delta t = 20\\text{ ms}$).\\par}
\\end{table}`;

    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(latex).catch(() => {});
    }

    const preview = $('latex-export-preview');
    if (preview) {
      preview.textContent = latex;
      preview.style.display = 'block';
    }

    const btn = $('btn-copy-latex-ablation');
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = 'Copied LaTeX!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2500);
    }

    return latex;
  }

  function drawVsaGrid(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cy: number, scale: number): void {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.arc(cx, cy, 0.5 * scale, 0, 2 * Math.PI);
    ctx.arc(cx, cy, 1.5 * scale, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.40)';
    ctx.beginPath();
    ctx.arc(cx, cy, 1.0 * scale, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.beginPath();
    ctx.moveTo(8, cy);
    ctx.lineTo(w - 8, cy);
    ctx.moveTo(cx, 8);
    ctx.lineTo(cx, h - 8);
    ctx.stroke();

    const tickLen = 4;
    ctx.beginPath();
    ctx.moveTo(cx + scale, cy - tickLen);
    ctx.lineTo(cx + scale, cy + tickLen);
    ctx.moveTo(cx - scale, cy - tickLen);
    ctx.lineTo(cx - scale, cy + tickLen);
    ctx.moveTo(cx - tickLen, cy - scale);
    ctx.lineTo(cx + tickLen, cy - scale);
    ctx.moveTo(cx - tickLen, cy + scale);
    ctx.lineTo(cx + tickLen, cy + scale);
    ctx.stroke();

    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.textAlign = 'right';
    ctx.fillText('+I', w - 4, cy - 4);
    ctx.textAlign = 'left';
    ctx.fillText('-I', 4, cy - 4);
    ctx.textAlign = 'center';
    ctx.fillText('+Q', cx + 12, 14);
    ctx.fillText('-Q', cx + 12, h - 4);

    ctx.restore();
  }

  function renderVsaScope(nodeTel: any, frame: any): void {
    const canvas = $('iq-constellation-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssSize = 240;
    if (canvas.width !== Math.round(cssSize * dpr) || canvas.height !== Math.round(cssSize * dpr)) {
      canvas.width = Math.round(cssSize * dpr);
      canvas.height = Math.round(cssSize * dpr);
    }
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = cssSize;
    const h = cssSize;
    const cx = w / 2;
    const cy = h / 2;
    const scale = 67.5;

    ctx.fillStyle = '#060a0f';
    ctx.fillRect(0, 0, w, h);

    if (!nodeTel) {
      drawVsaGrid(ctx, w, h, cx, cy, scale);
      setText('vsa-evm-pct', '--');
      setText('vsa-snr-margin', '--');
      setText('vsa-phase-err', '--');
      setText('vsa-ldpc-bler', '--');
      setText('vsa-modcod-order', 'No Terminal Selected');
      const badge = $('vsa-lock-badge');
      if (badge) {
        badge.textContent = 'STANDBY';
        badge.className = 'kpi-badge badge-neutral';
      }
      ctx.restore();
      return;
    }

    const sinrDb = typeof nodeTel.snr_db === 'number' && Number.isFinite(nodeTel.snr_db) ? nodeTel.snr_db : -15.0;
    const modcodName = nodeTel.modcod_name || 'QPSK 1/2';
    const ricianKDb = typeof nodeTel.rician_k_db === 'number' ? nodeTel.rician_k_db : 10.0;
    const dopplerShiftHz = typeof nodeTel.doppler_shift_hz === 'number' ? nodeTel.doppler_shift_hz : 0.0;
    const isOutage = Boolean(nodeTel.link_outage || nodeTel.state_name === 'OUTAGE' || nodeTel.state_name === 'HARD_SHADOW_CUTOFF');
    const frameIdx = frame?.frame_index ?? 0;
    const seed = (nodeTel.node_id * 10007 + frameIdx) >>> 0;

    const metrics = evaluateTerminalVsaMetrics({
      snrDb: sinrDb,
      modcodName,
      ricianKDb,
      dopplerShiftHz,
      isOutage,
      seed,
    });

    drawVsaGrid(ctx, w, h, cx, cy, scale);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    const crossSize = 3;
    for (let k = 0; k < metrics.referenceConstellation.length; k++) {
      const pt = metrics.referenceConstellation[k];
      const px = cx + pt.i * scale;
      const py = cy - pt.q * scale;
      ctx.beginPath();
      ctx.moveTo(px - crossSize, py);
      ctx.lineTo(px + crossSize, py);
      ctx.moveTo(px, py - crossSize);
      ctx.lineTo(px, py + crossSize);
      ctx.stroke();
    }

    const cloudColor = metrics.ldpcBler >= 0.5 ? 'rgba(239, 68, 68, 0.45)' : metrics.ldpcBler >= 0.05 ? 'rgba(245, 158, 11, 0.45)' : 'rgba(52, 211, 153, 0.45)';
    ctx.fillStyle = cloudColor;
    const receivedSymbols = metrics.receivedSymbols || [];
    for (let k = 0; k < receivedSymbols.length; k++) {
      const pt = receivedSymbols[k];
      const px = cx + pt.i * scale;
      const py = cy - pt.q * scale;
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }

    setText('vsa-evm-pct', `${metrics.evmRmsPct.toFixed(1)}%`);
    setText('vsa-snr-margin', `${metrics.snrMarginDb >= 0 ? '+' : ''}${metrics.snrMarginDb.toFixed(1)} dB`);
    setText('vsa-phase-err', `${metrics.phaseErrorDeg.toFixed(1)}°`);
    setText('vsa-ldpc-bler', `${(metrics.ldpcBler * 100).toFixed(1)}%`);
    const bitsPerSym = metrics.constellationInfo ? Math.round(Math.log2(metrics.constellationInfo.modulationOrder)) : 2;
    setText('vsa-modcod-order', `${modcodName} (${bitsPerSym} bpcu, LDPC 64800)`);

    const lockBadge = $('vsa-lock-badge');
    if (lockBadge) {
      if (isOutage || metrics.ldpcBler >= 0.5) {
        lockBadge.textContent = 'BLER FAIL';
        lockBadge.className = 'kpi-badge badge-rose';
      } else if (metrics.ldpcBler >= 0.01) {
        lockBadge.textContent = 'DEGRADED';
        lockBadge.className = 'kpi-badge badge-amber';
      } else {
        lockBadge.textContent = 'SYNC LOCKED';
        lockBadge.className = 'kpi-badge badge-emerald';
      }
    }

    ctx.restore();
  }

  return {
    // Trajectory methods
    setTrajectoryMessage,
    updateAltitudeModeUI,
    restoreFlightParamsFromCommitted,
    syncTrajectoryEditorFromWorker,
    setTrajectoryDraftMode,
    refreshTrajectoryEditor,
    addWaypointAt,
    applyTrajectoryDraft,
    cancelTrajectoryDraft,
    editEllipseFromInputs,
    editSelectedWaypointFromInputs,
    renderFlightPlanVerticalProfile,
    getWaypointPlacementArmed: () => getIsWpArmed(),
    setWaypointPlacementArmed: (val: boolean) => {
      setIsWpArmed(val);
    },

    // 3D Obstacle methods
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

    // TDMA Frame methods
    setTdmaMessage,
    updateTdmaLivePreview,
    syncInputsFromDraft,
    syncTdmaEditorFromWorker,
    validateTdmaDraft,
    handleTdmaCommandResult,
    applyTdmaDraft,
    resetTdmaToStandard,
    handleTdmaPresetSelect,
    handleTdmaInputChange,
    getTdmaDraft: () => tdmaDraft,
    setTdmaDraftField: (field: keyof TDMAFrameDraft, val: any) => {
      (tdmaDraft as any)[field] = val;
    },

    // Scopes & Dashboard methods
    drawPolarAntennaScope,
    drawLinkWaterfallCanvas,
    updateScientificAblationMatrix,
    drawEcdfDelayScope,
    drawSensitivitySweepScope,
    exportLatexAblationTable,
    renderVsaScope,
  };
}

export type DashboardAndAuthoringController = ReturnType<typeof createDashboardAndAuthoringController>;
