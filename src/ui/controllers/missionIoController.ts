/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Strictly Typed Mission I/O, Military GIS, AAR & Digital-Twin Calibration Controller (SPEC-V3-09)
 *
 * Extracted from monolithic index.html into a modular, headless-testable,
 * strictly typed controller.
 * Handles:
 * 1. Digital Twin Calibration UI & Oscilloscope Canvas
 * 2. Military GIS (MGRS 10km grid toggle, Scenario JSON Save/Load, KML, ATAK CoT XML)
 * 3. After-Action Review (AAR) Briefing Markdown & Standalone Print HTML Exporters
 * 4. GeoTIFF DEM file ingestion helper
 */

import {
  exportMissionToAtakCotXml,
  exportMissionToKml,
  serializeMissionScenarioJson,
  parseMissionScenarioJson,
  parseGeoTiffDem,
  TacticalMissionSnapshot,
  TacticalSnapshotEntity,
  TacticalSnapshotLink,
  MissionScenarioV3,
  GeoTiffParseResult,
} from '../../core/militaryGisEngine';
import {
  cartesianToGeodetic,
  GEODESY_ORIGIN_LAT_DEG,
  GEODESY_ORIGIN_LON_DEG,
} from '../../core/geodesy';
import {
  parseFlightTestTraceCsv,
  evaluateTwinCalibrationTrace,
  autoCalibrateTwinParameters,
  getReferenceFlightTestTrace,
  formatCalibrationReportMarkdown,
  DEFAULT_CALIBRATION_PARAMS,
  FlightTestTraceSample,
  TwinEvaluationReport,
  TwinCalibrationParameters,
  AutoCalibrationResult,
} from '../../core/digitalTwinCalibrationEngine';
import { drawTwinCalibrationScope, formatCalibrationKpiText } from '../calibrationPanelRenderer';
import {
  generateAarMarkdown,
  generateAarPrintableHtml,
  AarMissionSnapshot,
  AarFleetTerminal,
  AarQosClassSummary,
  AarPhysicsStack,
} from '../../core/aarBriefingGenerator';
import { CANONICAL_5QI_BEARERS, evaluate5QiBearerSlaMetrics, QosNetworkSlaReport } from '../../core/qosSlaEngine';
import { MCP_ID } from '../../core/nodeRegistry';
import { MAX_ACN_WAYPOINTS } from '../../core/config';
import {
  MIN_OBSTACLE_DIMENSION_M,
  MAX_OBSTACLE_DIMENSION_M,
  MAX_OBSTACLE_HEIGHT_M,
  type CuboidObstacle,
} from '../../core/obstacles';
import type {
  BiomeId,
  ConfigUpdateParams,
  TelemetryFrame,
  WorkerInboundCommand,
} from '../../shared/workerProtocol';

// ============================================================================
// Types & Contracts
// ============================================================================

export interface MissionTelemetrySnapshot {
  readonly sim_time_s?: number;
  readonly frame_index?: number;
  readonly acn_telemetry?: {
    readonly pos_x?: number;
    readonly pos_y?: number;
    readonly pos_z?: number;
    readonly altitude_msl_m?: number;
    readonly flight_path?: ReadonlyArray<readonly [number, number]>;
    readonly flight_path_3d?: ReadonlyArray<readonly [number, number, number]>;
  };
  readonly nodes_telemetry?: ReadonlyArray<{
    readonly node_id?: number;
    readonly id?: number;
    readonly name?: string;
    readonly callsign?: string;
    readonly node_type?: string;
    readonly role?: string;
    readonly x_m?: number;
    readonly y_m?: number;
    readonly z_m?: number;
    readonly lat_deg?: number;
    readonly lon_deg?: number;
    readonly elevation_m?: number;
    readonly terrain_elevation_msl_m?: number;
    readonly altitude_msl_m?: number;
    readonly agl_m?: number;
    readonly snr_db?: number;
    readonly sinr_db?: number;
    readonly tactical_priority?: number;
    readonly priority?: number;
    readonly is_transmitting?: boolean;
    readonly active_sector_id?: number;
    readonly sector_id?: number;
    readonly sector?: number;
    readonly modcod_name?: string;
    readonly modcod?: string;
    readonly assigned_modcod?: string;
    readonly link_outage?: boolean;
    readonly status?: string;
    readonly in_outage?: boolean;
  }>;
  readonly active_gantt_allocations?: ReadonlyArray<unknown>;
  readonly jammer_enabled?: boolean;
  readonly jammer_pos_enu?: readonly [number, number, number];
  readonly flight_path?: ReadonlyArray<{ readonly x?: number; readonly y?: number; readonly alt?: number } | readonly [number, number, number] | readonly [number, number]>;
  readonly comparative_kpi_dashboard?: {
    readonly static_goodput_mb?: number;
    readonly tac_goodput_mb?: number;
    readonly gain_multiplier?: number;
    readonly static_waste_pct?: number;
    readonly tac_waste_pct?: number;
    readonly static_drops?: number;
    readonly tac_drops?: number;
  };
  readonly tac_goodput_mbps?: number;
  readonly scheduler_mode?: string;
  readonly biome_em_enabled?: boolean;
  readonly hifi_telemetry?: TelemetryFrame['hifi_telemetry'];
  readonly transport_abr_telemetry?: TelemetryFrame['transport_abr_telemetry'];
  readonly ew_eccm_telemetry?: TelemetryFrame['ew_eccm_telemetry'];
  readonly constellation_mobility_telemetry?: TelemetryFrame['constellation_mobility_telemetry'];
}

export type MissionTelemetryInput = TelemetryFrame | MissionTelemetrySnapshot;

export interface ScenarioApplyResult {
  readonly ok: boolean;
  readonly dispatchedCount: number;
  readonly unsupportedFields: readonly string[];
  readonly warnings: readonly string[];
  readonly error?: string;
  readonly title?: string;
  readonly nodeCount?: number;
  readonly waypointCount?: number;
}

export interface MissionIoControllerDeps {
  readonly getLatestTelemetry?: () => MissionTelemetryInput | null | undefined;
  readonly getActiveBiomeId?: () => string;
  readonly getObstacles?: () => ReadonlyArray<{
    readonly id?: string;
    readonly name?: string;
    readonly type?: string;
    readonly footprint?: ReadonlyArray<unknown>;
    readonly heightM?: number;
  }>;
  readonly onDrawRadar?: () => void;
  readonly onLoadCustomDem?: (elevations: Float32Array, meta: unknown) => void;
  readonly postWorkerCommand?: (cmd: WorkerInboundCommand) => void;
  readonly documentRef?: Document;
}

export interface MissionIoController {
  readonly initDigitalTwinCalibrationUI: () => void;
  readonly renderTwinCalibrationScope: () => void;
  readonly updateTwinCalibrationDOM: (report: TwinEvaluationReport | null) => void;
  readonly getActiveCalibrationReport: () => TwinEvaluationReport | null;
  readonly getActiveCalibrationTrace: () => ReadonlyArray<FlightTestTraceSample> | null;
  readonly getActiveCalibrationParams: () => TwinCalibrationParameters;
  readonly initMilitaryGisUI: () => void;
  readonly applyScenarioJson: (jsonText: string) => ScenarioApplyResult;
  readonly buildTacticalSnapshot: (frameOverride?: MissionTelemetryInput | null) => TacticalMissionSnapshot;
  readonly exportScenarioJson: () => string;
  readonly exportKml: () => string;
  readonly exportCotXml: () => string;
  readonly initAarExporterUI: () => void;
  readonly buildCurrentAarSnapshot: (frameOverride?: MissionTelemetryInput | null) => AarMissionSnapshot;
  readonly exportAarMarkdown: () => string;
  readonly exportAarHtml: () => string;
  readonly isMgrsGridActive: () => boolean;
  readonly setMgrsGridActive: (active: boolean) => void;
  readonly triggerDownload: (content: string, filename: string, mimeType: string) => void;
  readonly handleGeoTiffBuffer: (buffer: ArrayBuffer) => GeoTiffParseResult;
}

// ============================================================================
// Controller Factory
// ============================================================================

export function triggerDownload(
  content: string,
  filename: string,
  mimeType: string,
  doc?: Document
): void {
  const documentRef = doc || (typeof document !== 'undefined' ? document : undefined);
  if (
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function' &&
    documentRef?.body
  ) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = documentRef.createElement('a');
    a.href = url;
    a.download = filename;
    documentRef.body.appendChild(a);
    a.click();
    documentRef.body.removeChild(a);
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Safe ignore
      }
    }, 1000);
  }
}

export function initMissionIoController(deps?: MissionIoControllerDeps): MissionIoController {
  const getDoc = (): Document | undefined => {
    if (deps?.documentRef) return deps.documentRef;
    if (typeof document !== 'undefined') return document;
    return undefined;
  };

  const $ = (id: string): HTMLElement | null => {
    const doc = getDoc();
    return doc ? doc.getElementById(id) : null;
  };

  // State
  let isMgrsGridEnabled = false;
  let activeCalTrace: FlightTestTraceSample[] | null = null;
  let activeCalReport: TwinEvaluationReport | null = null;
  let activeCalAutoResult: AutoCalibrationResult | null = null;
  let activeCalParams: TwinCalibrationParameters = { ...DEFAULT_CALIBRATION_PARAMS };
  let activeCalTraceName = 'Kargil Alpine Ridge';

  function isMgrsGridActive(): boolean {
    return isMgrsGridEnabled;
  }

  function setMgrsGridActive(active: boolean): void {
    isMgrsGridEnabled = active;
    const toggle = $('toggle-mgrs-grid') as HTMLInputElement | null;
    if (toggle) {
      toggle.checked = active;
    }
  }

  function getActiveCalibrationReport(): TwinEvaluationReport | null {
    return activeCalReport;
  }

  function getActiveCalibrationTrace(): ReadonlyArray<FlightTestTraceSample> | null {
    return activeCalTrace;
  }

  function getActiveCalibrationParams(): TwinCalibrationParameters {
    return activeCalParams;
  }

  function renderTwinCalibrationScope(): void {
    const canvas = $('twin-calibration-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    drawTwinCalibrationScope(canvas, activeCalReport);
  }

  function updateTwinCalibrationDOM(report: TwinEvaluationReport | null): void {
    const rmseEl = $('cal-rmse-val');
    const maeEl = $('cal-mae-val');
    const biasEl = $('cal-bias-val');
    const pearsonEl = $('cal-pearson-val');
    const outageAccEl = $('cal-outage-acc-val');
    const trimsEl = $('cal-trims-val');
    const badgeEl = $('cal-verdict-badge');

    const kpis = formatCalibrationKpiText(report);
    if (rmseEl) rmseEl.textContent = kpis.rmse;
    if (maeEl) maeEl.textContent = kpis.mae;
    if (biasEl) biasEl.textContent = kpis.bias;
    if (pearsonEl) pearsonEl.textContent = kpis.pearson;
    if (outageAccEl) outageAccEl.textContent = kpis.outageAcc;
    if (trimsEl) trimsEl.textContent = kpis.trims;

    if (badgeEl) {
      if (!report) {
        badgeEl.textContent = 'STANDBY';
        badgeEl.style.background = 'rgba(100,116,139,0.25)';
        badgeEl.style.color = '#94a3b8';
        badgeEl.style.borderColor = 'rgba(148,163,184,0.3)';
      } else {
        badgeEl.textContent = report.verdict;
        if (report.verdict === 'CERTIFIED_TWIN') {
          badgeEl.style.background = 'rgba(16,185,129,0.25)';
          badgeEl.style.color = '#10b981';
          badgeEl.style.borderColor = 'rgba(16,185,129,0.4)';
        } else if (report.verdict === 'CALIBRATED') {
          badgeEl.style.background = 'rgba(56,189,248,0.25)';
          badgeEl.style.color = '#38bdf8';
          badgeEl.style.borderColor = 'rgba(56,189,248,0.4)';
        } else {
          badgeEl.style.background = 'rgba(239,68,68,0.25)';
          badgeEl.style.color = '#ef4444';
          badgeEl.style.borderColor = 'rgba(239,68,68,0.4)';
        }
      }
    }

    renderTwinCalibrationScope();
  }

  function initDigitalTwinCalibrationUI(): void {
    const presetSelect = $('cal-preset-select') as HTMLSelectElement | null;
    const fileInput = $('cal-csv-file-input') as HTMLInputElement | null;
    const btnEvaluate = $('btn-cal-evaluate');
    const btnAutoSolve = $('btn-cal-auto-solve');
    const btnExport = $('btn-cal-export');
    const statusEl = $('cal-status-readout');
    const copyStatusEl = $('cal-copy-status');

    const loadPresetTrace = (presetKey: string): void => {
      const key =
        presetKey === 'arabian_maritime_multipath'
          ? 'arabian_maritime_multipath'
          : 'kargil_alpine_ridge';
      activeCalTrace = [...getReferenceFlightTestTrace(key)];
      activeCalTraceName =
        key === 'arabian_maritime_multipath'
          ? 'Arabian Maritime Multipath'
          : 'Kargil Alpine Ridge';
      activeCalAutoResult = null;
      activeCalParams = { ...DEFAULT_CALIBRATION_PARAMS };
      activeCalReport = evaluateTwinCalibrationTrace(activeCalTrace, activeCalParams);
      updateTwinCalibrationDOM(activeCalReport);
      if (statusEl) {
        statusEl.textContent = `Loaded ${activeCalTrace.length} samples (${activeCalTraceName}). Raw uncalibrated RMSE: ${activeCalReport.rmseDb.toFixed(
          2
        )} dB [${activeCalReport.verdict}].`;
      }
    };

    if (presetSelect && !presetSelect.dataset.initialized) {
      presetSelect.dataset.initialized = 'true';
      presetSelect.addEventListener('change', () => {
        loadPresetTrace(presetSelect.value);
      });
    }

    if (fileInput && !fileInput.dataset.initialized) {
      fileInput.dataset.initialized = 'true';
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result;
          if (typeof text !== 'string') return;
          const parseRes = parseFlightTestTraceCsv(text);
          if (parseRes.samples.length === 0) {
            if (statusEl) {
              statusEl.textContent = `Failed to parse CSV: ${
                parseRes.errors.join('; ') || 'No valid numeric samples'
              }`;
            }
            return;
          }
          activeCalTrace = [...parseRes.samples];
          activeCalTraceName = file.name || 'Custom CSV Trace';
          activeCalAutoResult = null;
          activeCalParams = { ...DEFAULT_CALIBRATION_PARAMS };
          activeCalReport = evaluateTwinCalibrationTrace(activeCalTrace, activeCalParams);
          updateTwinCalibrationDOM(activeCalReport);
          if (statusEl) {
            statusEl.textContent = `Parsed ${parseRes.samples.length} samples from "${activeCalTraceName}" (${
              parseRes.skippedCount
            } skipped). RMSE: ${activeCalReport.rmseDb.toFixed(2)} dB [${
              activeCalReport.verdict
            }].`;
          }
        };
        reader.readAsText(file);
      });
    }

    if (btnEvaluate && !btnEvaluate.dataset.initialized) {
      btnEvaluate.dataset.initialized = 'true';
      btnEvaluate.addEventListener('click', () => {
        if (!activeCalTrace) {
          loadPresetTrace(presetSelect?.value || 'kargil_alpine_ridge');
          return;
        }
        activeCalReport = evaluateTwinCalibrationTrace(activeCalTrace, activeCalParams);
        updateTwinCalibrationDOM(activeCalReport);
        if (statusEl) {
          statusEl.textContent = `Twin re-evaluated across ${
            activeCalTrace.length
          } samples. RMSE: ${activeCalReport.rmseDb.toFixed(2)} dB | Bias: ${
            activeCalReport.meanBiasDb >= 0 ? '+' : ''
          }${activeCalReport.meanBiasDb.toFixed(2)} dB [${activeCalReport.verdict}].`;
        }
      });
    }

    if (btnAutoSolve && !btnAutoSolve.dataset.initialized) {
      btnAutoSolve.dataset.initialized = 'true';
      btnAutoSolve.addEventListener('click', () => {
        if (!activeCalTrace) {
          loadPresetTrace(presetSelect?.value || 'kargil_alpine_ridge');
        }
        if (!activeCalTrace || activeCalTrace.length === 0) return;

        const autoRes = autoCalibrateTwinParameters(activeCalTrace, activeCalParams);
        activeCalAutoResult = autoRes;
        activeCalParams = autoRes.optimizedParams;
        activeCalReport = autoRes.calibratedReport;
        updateTwinCalibrationDOM(activeCalReport);

        if (statusEl) {
          statusEl.textContent = `Auto-calibrated in ${autoRes.durationMs.toFixed(
            1
          )} ms (${autoRes.iterations} iters, RMSE reduced by ${autoRes.rmseReductionDb.toFixed(
            2
          )} dB). Verdict: ${autoRes.calibratedReport.verdict}.`;
        }
      });
    }

    if (btnExport && !btnExport.dataset.initialized) {
      btnExport.dataset.initialized = 'true';
      btnExport.addEventListener('click', () => {
        if (!activeCalTrace) {
          loadPresetTrace(presetSelect?.value || 'kargil_alpine_ridge');
        }
        if (!activeCalTrace) return;

        let resToExport = activeCalAutoResult;
        if (!resToExport) {
          resToExport = autoCalibrateTwinParameters(activeCalTrace, activeCalParams);
          activeCalAutoResult = resToExport;
          activeCalParams = resToExport.optimizedParams;
          activeCalReport = resToExport.calibratedReport;
          updateTwinCalibrationDOM(activeCalReport);
        }

        const md = formatCalibrationReportMarkdown(resToExport, activeCalTraceName);
        if (
          typeof navigator !== 'undefined' &&
          navigator.clipboard &&
          typeof navigator.clipboard.writeText === 'function'
        ) {
          navigator.clipboard
            .writeText(md)
            .then(() => {
              if (copyStatusEl) {
                copyStatusEl.style.display = 'inline';
                setTimeout(() => {
                  copyStatusEl.style.display = 'none';
                }, 2500);
              }
            })
            .catch(() => {});
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('c2:cvd-mode-change', () => {
        renderTwinCalibrationScope();
      });
    }

    // Initial load with default preset
    loadPresetTrace(presetSelect?.value || 'kargil_alpine_ridge');
  }

  function buildTacticalSnapshot(
    frameOverride?: MissionTelemetryInput | null
  ): TacticalMissionSnapshot {
    const frame =
      (frameOverride !== undefined
        ? frameOverride
        : deps?.getLatestTelemetry
          ? deps.getLatestTelemetry()
          : null) as Partial<TelemetryFrame> | MissionTelemetrySnapshot | null | undefined;
    const entities: TacticalSnapshotEntity[] = [];

    // ACN
    const acn = frame?.acn_telemetry as
      | { readonly pos_x?: number; readonly pos_y?: number; readonly pos_z?: number; readonly altitude_msl_m?: number }
      | undefined;
    const acnGeo = cartesianToGeodetic(acn?.pos_x ?? 0, acn?.pos_y ?? 0);
    const acnAltMsl =
      typeof acn?.altitude_msl_m === 'number' && Number.isFinite(acn.altitude_msl_m)
        ? acn.altitude_msl_m
        : typeof acn?.pos_z === 'number' && Number.isFinite(acn.pos_z)
          ? acn.pos_z
          : 5000;
    entities.push({
      id: 'ACN-1',
      callsign: 'VIPER-01',
      role: 'ACN',
      latDeg: acnGeo.latDeg,
      lonDeg: acnGeo.lonDeg,
      altMslM: acnAltMsl,
      isTransmitting: true,
    });

    // Ground Nodes
    const nodes: readonly MissionSnapshotNode[] = Array.isArray(frame?.nodes_telemetry)
      ? (frame.nodes_telemetry as readonly MissionSnapshotNode[])
      : [];
    for (const n of nodes) {
      const nodeId = n.node_id ?? n.id ?? 1;
      const nGeo = cartesianToGeodetic(n.x_m ?? 0, n.y_m ?? 0);
      const rawRole = (
        typeof n.node_type === 'string' && n.node_type.trim().length > 0
          ? n.node_type
          : typeof n.role === 'string'
            ? n.role
            : ''
      )
        .trim()
        .toLowerCase();

      let role: TacticalSnapshotEntity['role'];
      if (rawRole === 'mcp') {
        role = 'MCP';
      } else if (rawRole === 'convoy') {
        role = 'CONVOY';
      } else if (rawRole === 'soldier') {
        role = 'SOLDIER';
      } else {
        role = nodeId === MCP_ID ? 'MCP' : 'SOLDIER';
      }

      const nodeCallsign = n.name || n.callsign || (nodeId === MCP_ID ? 'MCP' : `NODE-${nodeId}`);
      const altMslM =
        typeof n.altitude_msl_m === 'number' && Number.isFinite(n.altitude_msl_m)
          ? n.altitude_msl_m
          : typeof n.z_m === 'number' && Number.isFinite(n.z_m)
            ? n.z_m
            : (n.terrain_elevation_msl_m ?? n.elevation_m ?? 3000) + (n.agl_m ?? 2.5);

      entities.push({
        id: nodeId,
        callsign: nodeCallsign,
        role,
        latDeg: nGeo.latDeg,
        lonDeg: nGeo.lonDeg,
        altMslM,
        isTransmitting: Boolean(n.is_transmitting),
      });
    }

    // Jammer if enabled
    if (frame?.jammer_enabled && Array.isArray(frame.jammer_pos_enu)) {
      const jGeo = cartesianToGeodetic(frame.jammer_pos_enu[0], frame.jammer_pos_enu[1]);
      entities.push({
        id: 'JAMMER-1',
        callsign: 'ADVERSARY-EW',
        role: 'JAMMER',
        latDeg: jGeo.latDeg,
        lonDeg: jGeo.lonDeg,
        altMslM: frame.jammer_pos_enu[2] ?? 3500,
      });
    }

    // Links
    const links: TacticalSnapshotLink[] = [];
    for (const n of nodes) {
      const nodeId = n.node_id ?? n.id ?? 1;
      const nGeo = cartesianToGeodetic(n.x_m ?? 0, n.y_m ?? 0);
      const snr = typeof n.sinr_db === 'number' && Number.isFinite(n.sinr_db)
        ? n.sinr_db
        : typeof n.snr_db === 'number' && Number.isFinite(n.snr_db)
          ? n.snr_db
          : 0;
      const altMslM =
        typeof n.altitude_msl_m === 'number' && Number.isFinite(n.altitude_msl_m)
          ? n.altitude_msl_m
          : typeof n.z_m === 'number' && Number.isFinite(n.z_m)
            ? n.z_m
            : (n.terrain_elevation_msl_m ?? n.elevation_m ?? 3000) + (n.agl_m ?? 2.5);
      const isOutage = n.link_outage === true || n.in_outage === true || snr < -1.5;

      links.push({
        fromId: 'ACN-1',
        toId: nodeId,
        fromLat: acnGeo.latDeg,
        fromLon: acnGeo.lonDeg,
        fromAlt: acnAltMsl,
        toLat: nGeo.latDeg,
        toLon: nGeo.lonDeg,
        toAlt: altMslM,
        snrDb: snr,
        status: isOutage ? 'OUTAGE' : snr < 5.0 ? 'DEGRADED' : 'ACTIVE',
      });
    }

    return {
      timestampIso: new Date().toISOString(),
      missionTitle: 'Tactical X-Band Air-to-Ground Network',
      entities,
      links,
    };
  }

  type MissionSnapshotNode = NonNullable<MissionTelemetrySnapshot['nodes_telemetry']>[number];

  function exportScenarioJson(): string {
    const frame = (deps?.getLatestTelemetry ? deps.getLatestTelemetry() : null) as
      | Partial<TelemetryFrame>
      | MissionTelemetrySnapshot
      | null
      | undefined;
    const rawNodes: readonly MissionSnapshotNode[] = Array.isArray(frame?.nodes_telemetry)
      ? (frame.nodes_telemetry as readonly MissionSnapshotNode[])
      : [];
    const nodes = rawNodes.map((n, idx) => ({
      id: n.node_id ?? n.id ?? idx + 1,
      callsign: n.name || n.callsign || `NODE-${idx + 1}`,
      xM: n.x_m ?? 0,
      yM: n.y_m ?? 0,
      aglM: n.agl_m ?? 2.5,
      tacticalPriority: n.tactical_priority ?? n.priority ?? 3,
    }));

    const acnPath =
      (frame?.acn_telemetry as { readonly flight_path_3d?: ReadonlyArray<readonly [number, number, number]>; readonly flight_path?: ReadonlyArray<readonly [number, number]> } | undefined)?.flight_path_3d ??
      (frame?.acn_telemetry as { readonly flight_path?: ReadonlyArray<readonly [number, number]> } | undefined)?.flight_path ??
      (frame as MissionTelemetrySnapshot | null | undefined)?.flight_path;

    const waypoints = Array.isArray(acnPath)
      ? acnPath.map((wp) => {
          if (Array.isArray(wp)) {
            return { xM: wp[0] ?? 0, yM: wp[1] ?? 0, altM: wp[2] ?? frame?.acn_telemetry?.altitude_msl_m ?? 5000 };
          }
          const obj = wp as { readonly x?: number; readonly y?: number; readonly alt?: number };
          return { xM: obj.x ?? 0, yM: obj.y ?? 0, altM: obj.alt ?? 5000 };
        })
      : [];

    const obstacles = (deps?.getObstacles ? deps.getObstacles() : []).map((o, idx) => {
      const points = Array.isArray(o.footprint)
        ? o.footprint.map((p: unknown) => {
            if (Array.isArray(p)) {
              return { x: Number(p[0]) || 0, y: Number(p[1]) || 0 };
            }
            const pt = p as { x?: number; y?: number } | undefined;
            return { x: Number(pt?.x) || 0, y: Number(pt?.y) || 0 };
          })
        : [];
      return {
        id: o.id || `obs-${idx}`,
        name: o.name || `Obstacle ${idx + 1}`,
        type: o.type || 'ridge',
        points,
        heightM: o.heightM || 50,
      };
    });

    const patternSelect = $('fp-pattern-select') as HTMLSelectElement | null;
    const scenario: MissionScenarioV3 = {
      schemaVersion: 'xband-dt-scenario-v3',
      title: 'Tactical Ladakh Sector Mission',
      timestamp: new Date().toISOString(),
      theater: {
        biomeId: deps?.getActiveBiomeId ? deps.getActiveBiomeId() : 'alpine_mountain',
        centerLatDeg: GEODESY_ORIGIN_LAT_DEG,
        centerLonDeg: GEODESY_ORIGIN_LON_DEG,
      },
      acn: {
        callsign: 'VIPER-01',
        cruiseAltMslM: frame?.acn_telemetry?.altitude_msl_m ?? 5000,
        cruiseAirspeedMs: 50,
        orbitPattern: patternSelect?.value || 'ellipse_orbit',
        waypoints,
      },
      nodes,
      obstacles,
      rfConfig: {
        carrier_freq_hz: 8.0e9,
        traffic_scale: 1.0,
      },
    };

    return serializeMissionScenarioJson(scenario);
  }

  function exportKml(): string {
    const snap = buildTacticalSnapshot();
    return exportMissionToKml(snap);
  }

  function exportCotXml(): string {
    const snap = buildTacticalSnapshot();
    return exportMissionToAtakCotXml(snap);
  }

  function buildCurrentAarSnapshot(
    frameOverride?: MissionTelemetryInput | null
  ): AarMissionSnapshot {
    const rawFrame =
      frameOverride !== undefined
        ? frameOverride
        : deps?.getLatestTelemetry
          ? deps.getLatestTelemetry()
          : null;
    const frame = rawFrame as Partial<TelemetryFrame> | null | undefined;
    const hasFrame = frame !== null && frame !== undefined;

    const kpi = frame?.comparative_kpi_dashboard;
    const sG =
      typeof kpi?.static_goodput_mb === 'number' && Number.isFinite(kpi.static_goodput_mb)
        ? kpi.static_goodput_mb
        : 0;
    const tG =
      typeof kpi?.tac_goodput_mb === 'number' && Number.isFinite(kpi.tac_goodput_mb)
        ? kpi.tac_goodput_mb
        : 0;
    const gain =
      typeof kpi?.gain_multiplier === 'number' && Number.isFinite(kpi.gain_multiplier)
        ? kpi.gain_multiplier
        : sG > 0
          ? tG / sG
          : 0;
    const sW =
      typeof kpi?.static_waste_pct === 'number' && Number.isFinite(kpi.static_waste_pct)
        ? kpi.static_waste_pct
        : 0;
    const tW =
      typeof kpi?.tac_waste_pct === 'number' && Number.isFinite(kpi.tac_waste_pct)
        ? kpi.tac_waste_pct
        : 0;
    const sD =
      typeof kpi?.static_drops === 'number' && Number.isFinite(kpi.static_drops)
        ? kpi.static_drops
        : 0;
    const tD =
      typeof kpi?.tac_drops === 'number' && Number.isFinite(kpi.tac_drops)
        ? kpi.tac_drops
        : 0;
    const simTimeS =
      typeof frame?.sim_time_s === 'number' && Number.isFinite(frame.sim_time_s)
        ? frame.sim_time_s
        : 0;
    const tacRate =
      typeof frame?.tac_goodput_mbps === 'number' && Number.isFinite(frame.tac_goodput_mbps)
        ? frame.tac_goodput_mbps
        : simTimeS > 0
          ? tG / simTimeS
          : 0;

    const nodes: readonly MissionSnapshotNode[] = Array.isArray(frame?.nodes_telemetry)
      ? (frame.nodes_telemetry as readonly MissionSnapshotNode[])
      : [];
    const allocs = Array.isArray(frame?.active_gantt_allocations)
      ? frame.active_gantt_allocations
      : [];
    let qosReport: QosNetworkSlaReport | null = null;
    if (hasFrame) {
      try {
        qosReport = evaluate5QiBearerSlaMetrics(nodes, allocs);
      } catch {
        qosReport = null;
      }
    }

    const qosClasses: AarQosClassSummary[] = qosReport?.bearers?.length
      ? qosReport.bearers.map((b) => ({
          name: b.name || `Bearer ${b.qos5qi}`,
          fiveQi: b.qos5qi,
          budgetMs: b.pdbMs,
          p95Ms: Number.isFinite(b.estimatedMaxSojournMs) ? b.estimatedMaxSojournMs : 0,
          pass: b.slaVerdict === 'SLA_COMPLIANT',
        }))
      : CANONICAL_5QI_BEARERS.map((b) => ({
          name: b.name,
          fiveQi: b.qos5qi,
          budgetMs: b.pdbMs,
          p95Ms: 0,
          pass: false,
        }));

    const fleet: AarFleetTerminal[] = nodes.map((n) => {
      const nodeId = n.node_id ?? n.id ?? 1;
      const sinrVal = n.sinr_db ?? n.snr_db;
      const sectorVal = n.active_sector_id ?? n.sector_id ?? n.sector;
      const modcodVal = n.modcod_name ?? n.modcod ?? n.assigned_modcod;
      const isOutage = n.link_outage === true || n.in_outage === true;
      return {
        nodeId,
        callsign: n.callsign || n.name || (nodeId === MCP_ID ? 'MCP' : `NODE-${nodeId}`),
        latDeg: n.lat_deg,
        lonDeg: n.lon_deg,
        sector: typeof sectorVal === 'number' && Number.isFinite(sectorVal) ? sectorVal : 'N/A',
        modcod: typeof modcodVal === 'string' && modcodVal.length > 0 ? modcodVal : 'N/A',
        sinrDb: typeof sinrVal === 'number' && Number.isFinite(sinrVal) ? sinrVal : 0,
        status: n.status || (isOutage ? 'OUTAGE' : 'ACTIVE'),
      };
    });

    const activeSector = $('dem-sector-select') as HTMLSelectElement | null;
    const biomeName =
      activeSector?.options[activeSector.selectedIndex]?.text ||
      'Ladakh Alpine Mountain (34.5°N, 76.5°E)';

    const hifiFlags = frame?.hifi_telemetry?.enabled_flags;
    const ewTelemetry = frame?.ew_eccm_telemetry;
    const constellationTelemetry = frame?.constellation_mobility_telemetry;

    const activeModels: AarPhysicsStack = {
      airframeShadowing: Boolean(hifiFlags?.enableAirframeShadowing),
      correlatedRician: Boolean(hifiFlags?.enableCorrelatedRicianFading),
      macPhyFeedback: Boolean(hifiFlags?.enableMacPhyFeedback),
      transportAbr: Boolean(frame?.transport_abr_telemetry?.enabled),
      dubinsKinematics: Boolean(hifiFlags?.enableDubinsKinematics),
      viewshedParity: hifiFlags?.viewshedFidelityMode === 'link-budget-parity',
      biomeEm: Boolean(frame?.biome_em_enabled),
      eccmMode: hasFrame
        ? (ewTelemetry?.eccm_mode ?? (frame?.jammer_enabled ? 'NONE' : 'NONE'))
        : 'N/A',
      mvdrNullSteering: Boolean(ewTelemetry?.mvdr_null_steering_enabled),
      acnCount:
        typeof constellationTelemetry?.acn_count === 'number' &&
        Number.isFinite(constellationTelemetry.acn_count)
          ? constellationTelemetry.acn_count
          : hasFrame
            ? 1
            : 0,
      manetRouting: Boolean(
        constellationTelemetry &&
          Array.isArray(constellationTelemetry.manet_active_routes) &&
          constellationTelemetry.manet_active_routes.length > 0
      ),
    };

    let calibrationSummary = undefined;
    if (activeCalReport && activeCalReport.rmseDb != null) {
      calibrationSummary = {
        verdict: activeCalReport.verdict || 'CALIBRATED',
        rmseDb: activeCalReport.rmseDb,
        pearsonR: activeCalReport.pearsonR ?? 0,
      };
    }

    return {
      missionTitle: `Tactical X-Band AAR — ${biomeName.split(' ')[0]} Sector`,
      generatedIso: new Date().toISOString(),
      biomeName,
      simTimeS,
      frameCount:
        typeof frame?.frame_index === 'number' && Number.isFinite(frame.frame_index)
          ? frame.frame_index
          : 0,
      schedulerMode: hasFrame ? (frame?.scheduler_mode || 'N/A') : 'N/A',
      kpis: {
        tacDeliveredMb: tG,
        staticDeliveredMb: sG,
        throughputGainX: gain,
        tacRateMbps: Number.isFinite(tacRate) ? tacRate : 0,
        tacWastePct: tW,
        staticWastePct: sW,
        tacDrops: tD,
        staticDrops: sD,
      },
      qosSlaSummary: {
        overallPassPct:
          hasFrame && typeof qosReport?.overallSlaCompliancePct === 'number'
            ? qosReport.overallSlaCompliancePct
            : 0,
        classes: qosClasses,
      },
      fleet,
      activeModels,
      calibrationSummary,
    };
  }

  function exportAarMarkdown(): string {
    const snap = buildCurrentAarSnapshot();
    return generateAarMarkdown(snap);
  }

  function exportAarHtml(): string {
    const snap = buildCurrentAarSnapshot();
    return generateAarPrintableHtml(snap);
  }

  function handleGeoTiffBuffer(buffer: ArrayBuffer): GeoTiffParseResult {
    return parseGeoTiffDem(buffer);
  }

  const VALID_BIOME_IDS: readonly BiomeId[] = [
    'alpine_mountain',
    'arid_desert',
    'open_plains',
    'tropical_jungle',
    'maritime_littoral',
  ];

  function applyScenarioJson(jsonText: string): ScenarioApplyResult {
    const res = parseMissionScenarioJson(jsonText);
    if (!res.ok || !res.scenario) {
      return {
        ok: false,
        dispatchedCount: 0,
        unsupportedFields: [],
        warnings: res.warnings,
        error: res.error ?? 'Invalid scenario JSON',
      };
    }

    const scenario = res.scenario;
    const unsupportedFields: string[] = [];
    const commands: WorkerInboundCommand[] = [];

    // 1. Theater / Biome
    if (VALID_BIOME_IDS.includes(scenario.theater.biomeId as BiomeId)) {
      commands.push({
        type: 'SET_BIOME',
        biomeId: scenario.theater.biomeId as BiomeId,
      });
    } else {
      unsupportedFields.push(`theater.biomeId (${scenario.theater.biomeId})`);
    }

    if (
      Math.abs(scenario.theater.centerLatDeg - GEODESY_ORIGIN_LAT_DEG) > 1e-4 ||
      Math.abs(scenario.theater.centerLonDeg - GEODESY_ORIGIN_LON_DEG) > 1e-4
    ) {
      unsupportedFields.push('theater.centerLatDeg/centerLonDeg');
    }

    // 2. ACN & RF Config (CONFIG_UPDATE + SET_SCIENTIFIC_PARAMS)
    if (scenario.acn.callsign && scenario.acn.callsign !== 'VIPER-01') {
      unsupportedFields.push('acn.callsign');
    }

    const orbitNorm = scenario.acn.orbitPattern.trim().toLowerCase();
    const wantsWaypoints = orbitNorm.includes('waypoint');
    const useWaypoints = wantsWaypoints && scenario.acn.waypoints.length >= 3;
    if (wantsWaypoints && scenario.acn.waypoints.length < 3) {
      unsupportedFields.push('acn.waypoints (<3 waypoints)');
    } else if (!wantsWaypoints && scenario.acn.waypoints.length > 0 && orbitNorm !== 'ellipse' && orbitNorm !== 'ellipse_orbit') {
      unsupportedFields.push(`acn.orbitPattern (${scenario.acn.orbitPattern})`);
    }
    if (useWaypoints && scenario.acn.waypoints.length > MAX_ACN_WAYPOINTS) {
      unsupportedFields.push(`acn.waypoints (> ${MAX_ACN_WAYPOINTS} truncated)`);
    }

    const rf = scenario.rfConfig;
    let carrierFreqGhz: number | undefined;
    let channelBandwidthMhz: number | undefined;
    let rainRateMmh: number | undefined;
    let trafficLoadMultiplier: number | undefined;
    let jammerEnabled: boolean | undefined;
    let jammerEirpDbm: number | undefined;
    let ricianFadingEnabled: boolean | undefined;
    let cqiFeedbackDelayMs: number | undefined;
    let earthRadiusFactorK: number | undefined;
    let activeRelayEnabled: boolean | undefined;

    for (const [k, v] of Object.entries(rf)) {
      if (k === 'carrier_freq_hz' && typeof v === 'number' && Number.isFinite(v) && v > 0) {
        carrierFreqGhz = v / 1e9;
      } else if (k === 'carrier_freq_ghz' && typeof v === 'number' && Number.isFinite(v) && v > 0) {
        carrierFreqGhz = v;
      } else if (k === 'channel_bandwidth_hz' && typeof v === 'number' && Number.isFinite(v) && v > 0) {
        channelBandwidthMhz = Math.max(0.1, Math.min(50.0, v / 1e6));
      } else if (k === 'channel_bandwidth_mhz' && typeof v === 'number' && Number.isFinite(v) && v > 0) {
        channelBandwidthMhz = Math.max(0.1, Math.min(50.0, v));
      } else if (k === 'rain_rate_mmh' && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        rainRateMmh = v;
      } else if (
        (k === 'traffic_scale' || k === 'trafficLoadMultiplier' || k === 'traffic_load_multiplier') &&
        typeof v === 'number' &&
        Number.isFinite(v)
      ) {
        trafficLoadMultiplier = v;
      } else if (k === 'jammerEnabled' && typeof v === 'boolean') {
        jammerEnabled = v;
      } else if (k === 'jammerEirpDbm' && typeof v === 'number' && Number.isFinite(v)) {
        jammerEirpDbm = v;
      } else if (k === 'ricianFadingEnabled' && typeof v === 'boolean') {
        ricianFadingEnabled = v;
      } else if (k === 'cqiFeedbackDelayMs' && typeof v === 'number' && Number.isFinite(v)) {
        cqiFeedbackDelayMs = v;
      } else if (k === 'earthRadiusFactorK' && typeof v === 'number' && Number.isFinite(v)) {
        earthRadiusFactorK = v;
      } else if (k === 'activeRelayEnabled' && typeof v === 'boolean') {
        activeRelayEnabled = v;
      } else {
        unsupportedFields.push(`rfConfig.${k}`);
      }
    }

    const configParams: ConfigUpdateParams = {
      acn_altitude_m: scenario.acn.cruiseAltMslM,
      loiter_speed_mps: scenario.acn.cruiseAirspeedMs,
      trajectory_mode: useWaypoints ? 'waypoints' : 'ellipse',
      ...(useWaypoints
        ? {
            waypoints: scenario.acn.waypoints.slice(0, MAX_ACN_WAYPOINTS).map((w) => ({
              x_m: w.xM,
              y_m: w.yM,
              z_m: w.altM,
            })),
          }
        : {}),
      ...(carrierFreqGhz !== undefined ? { carrier_freq_ghz: carrierFreqGhz } : {}),
      ...(channelBandwidthMhz !== undefined ? { channel_bandwidth_mhz: channelBandwidthMhz } : {}),
      ...(rainRateMmh !== undefined ? { rain_rate_mmh: rainRateMmh } : {}),
    };

    commands.push({
      type: 'CONFIG_UPDATE',
      params: configParams,
    });

    if (
      trafficLoadMultiplier !== undefined ||
      jammerEnabled !== undefined ||
      jammerEirpDbm !== undefined ||
      ricianFadingEnabled !== undefined ||
      cqiFeedbackDelayMs !== undefined ||
      earthRadiusFactorK !== undefined ||
      activeRelayEnabled !== undefined
    ) {
      commands.push({
        type: 'SET_SCIENTIFIC_PARAMS',
        ...(trafficLoadMultiplier !== undefined ? { trafficLoadMultiplier } : {}),
        ...(jammerEnabled !== undefined ? { jammerEnabled } : {}),
        ...(jammerEirpDbm !== undefined ? { jammerEirpDbm } : {}),
        ...(ricianFadingEnabled !== undefined ? { ricianFadingEnabled } : {}),
        ...(cqiFeedbackDelayMs !== undefined ? { cqiFeedbackDelayMs } : {}),
        ...(earthRadiusFactorK !== undefined ? { earthRadiusFactorK } : {}),
        ...(activeRelayEnabled !== undefined ? { activeRelayEnabled } : {}),
      });
    }

    // 3. Obstacles replacement
    const convertedObstacles: CuboidObstacle[] = [];
    for (const obs of scenario.obstacles) {
      if (!Array.isArray(obs.points) || obs.points.length < 2) {
        unsupportedFields.push(`obstacle[${obs.id}] (missing footprint points)`);
        continue;
      }
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const pt of obs.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
      const rawW = maxX - minX;
      const rawD = maxY - minY;
      convertedObstacles.push({
        id: obs.id,
        shape: 'cuboid',
        xM: (minX + maxX) * 0.5,
        yM: (minY + maxY) * 0.5,
        widthM: Math.max(MIN_OBSTACLE_DIMENSION_M, Math.min(MAX_OBSTACLE_DIMENSION_M, rawW > 0 ? rawW : 100)),
        depthM: Math.max(MIN_OBSTACLE_DIMENSION_M, Math.min(MAX_OBSTACLE_DIMENSION_M, rawD > 0 ? rawD : 100)),
        heightM: Math.max(MIN_OBSTACLE_DIMENSION_M, Math.min(MAX_OBSTACLE_HEIGHT_M, obs.heightM)),
        rotationDeg: 0,
      });
    }
    if (scenario.obstacles.length === 0 || convertedObstacles.length > 0) {
      commands.push({
        type: 'OBSTACLES_REPLACE',
        obstacles: convertedObstacles,
      });
    }

    // 4. Node reconciliation via NODE_DELETE / NODE_UPDATE / NODE_ADD
    const latestFrame = deps?.getLatestTelemetry ? deps.getLatestTelemetry() : null;
    const liveNodes: readonly MissionSnapshotNode[] = Array.isArray(latestFrame?.nodes_telemetry)
      ? (latestFrame.nodes_telemetry as readonly MissionSnapshotNode[])
      : [];
    const liveIds = new Set<number>();
    for (const ln of liveNodes) {
      const lid = ln.node_id ?? ln.id;
      if (typeof lid === 'number' && Number.isInteger(lid)) {
        liveIds.add(lid);
      }
    }

    const scenarioIds = new Set<number>();
    for (const sn of scenario.nodes) {
      scenarioIds.add(sn.id);
    }

    for (const lid of liveIds) {
      if (!scenarioIds.has(lid)) {
        commands.push({
          type: 'NODE_DELETE',
          node_id: lid,
        });
      }
    }

    for (const sn of scenario.nodes) {
      const clampedPriority = Math.max(0.1, Math.min(5.0, sn.tacticalPriority));
      if (liveIds.has(sn.id)) {
        commands.push({
          type: 'NODE_UPDATE',
          node_id: sn.id,
          x_m: sn.xM,
          y_m: sn.yM,
          agl_m: sn.aglM,
          callsign: sn.callsign,
          tactical_priority: clampedPriority,
        });
      } else {
        const inferredRole =
          sn.id === MCP_ID || sn.callsign.trim().toUpperCase() === 'MCP' ? 'mcp' : 'soldier';
        commands.push({
          type: 'NODE_ADD',
          role: inferredRole,
          x_m: sn.xM,
          y_m: sn.yM,
          agl_m: sn.aglM,
          callsign: sn.callsign,
          tactical_priority: clampedPriority,
        });
      }
    }

    if (!deps?.postWorkerCommand) {
      unsupportedFields.push('worker command dispatcher unavailable');
      return {
        ok: true,
        dispatchedCount: 0,
        unsupportedFields,
        warnings: res.warnings,
        title: scenario.title,
        nodeCount: scenario.nodes.length,
        waypointCount: scenario.acn.waypoints.length,
      };
    }

    for (const cmd of commands) {
      deps.postWorkerCommand(cmd);
    }

    return {
      ok: true,
      dispatchedCount: commands.length,
      unsupportedFields,
      warnings: res.warnings,
      title: scenario.title,
      nodeCount: scenario.nodes.length,
      waypointCount: scenario.acn.waypoints.length,
    };
  }

  function initMilitaryGisUI(): void {
    const toggleMgrs = $('toggle-mgrs-grid') as HTMLInputElement | null;
    const btnSaveJson = $('btn-scenario-save-json');
    const fileInput = $('scenario-json-file-input') as HTMLInputElement | null;
    const btnExportKml = $('btn-export-kml');
    const btnExportCot = $('btn-export-cot-xml');
    const statusEl = $('mission-gis-status');
    const actionStatusEl = $('mission-gis-action-status');

    const flashActionStatus = (text: string): void => {
      if (actionStatusEl) {
        actionStatusEl.textContent = text;
        actionStatusEl.style.display = 'inline';
        setTimeout(() => {
          actionStatusEl.style.display = 'none';
        }, 2500);
      }
    };

    if (toggleMgrs && !toggleMgrs.dataset.initialized) {
      toggleMgrs.dataset.initialized = 'true';
      toggleMgrs.addEventListener('change', () => {
        isMgrsGridEnabled = Boolean(toggleMgrs.checked);
        if (deps?.onDrawRadar) deps.onDrawRadar();
        if (statusEl) {
          statusEl.textContent = isMgrsGridEnabled
            ? 'MGRS 10km Grid Active on 2D Radar · Standard WGS-84'
            : 'MGRS Engine Ready · Standard WGS-84 Ellipsoid (Zone 43S, Ladakh Sector)';
        }
      });
    }

    if (btnSaveJson && !btnSaveJson.dataset.initialized) {
      btnSaveJson.dataset.initialized = 'true';
      btnSaveJson.addEventListener('click', () => {
        const jsonStr = exportScenarioJson();
        triggerDownload(jsonStr, `xband-scenario-${Date.now()}.json`, 'application/json', getDoc());
        flashActionStatus('Scenario Saved!');
        if (statusEl) {
          statusEl.textContent = `Scenario saved to JSON.`;
        }
      });
    }

    if (fileInput && !fileInput.dataset.initialized) {
      fileInput.dataset.initialized = 'true';
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result;
          if (typeof text !== 'string') return;
          const applyRes = applyScenarioJson(text);
          if (!applyRes.ok) {
            if (statusEl) {
              statusEl.textContent = `Scenario Load Failed: ${applyRes.error}`;
              statusEl.style.color = '#ef4444';
            }
            return;
          }

          flashActionStatus(applyRes.dispatchedCount > 0 ? 'Scenario Dispatched!' : 'Scenario Parsed!');
          if (statusEl) {
            const unappliedNote =
              applyRes.unsupportedFields.length > 0
                ? ` Unapplied fields (no worker command): ${applyRes.unsupportedFields.join(', ')}.`
                : '';
            statusEl.textContent =
              `Loaded "${applyRes.title}" (${applyRes.nodeCount} nodes, ${applyRes.waypointCount} WPs; ` +
              `dispatched ${applyRes.dispatchedCount} worker cmd(s)).${unappliedNote}`;
            statusEl.style.color = applyRes.unsupportedFields.length > 0 ? '#f59e0b' : '#38bdf8';
          }
        };
        reader.readAsText(file);
      });
    }

    if (btnExportKml && !btnExportKml.dataset.initialized) {
      btnExportKml.dataset.initialized = 'true';
      btnExportKml.addEventListener('click', () => {
        const kmlStr = exportKml();
        triggerDownload(
          kmlStr,
          `xband-tactical-${Date.now()}.kml`,
          'application/vnd.google-earth.kml+xml',
          getDoc()
        );
        flashActionStatus('KML Exported!');
      });
    }

    if (btnExportCot && !btnExportCot.dataset.initialized) {
      btnExportCot.dataset.initialized = 'true';
      btnExportCot.addEventListener('click', () => {
        const cotStr = exportCotXml();
        triggerDownload(
          cotStr,
          `xband-atak-cot-${Date.now()}.cot.xml`,
          'application/xml',
          getDoc()
        );
        flashActionStatus('CoT XML Exported!');
      });
    }
  }

  function initAarExporterUI(): void {
    const btnMd = $('btn-export-aar-md');
    const btnHtml = $('btn-export-aar-html');
    const statusEl = $('aar-export-status');

    const flashAarStatus = (msg: string): void => {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.style.display = 'inline';
      statusEl.style.color = '#10b981';
      setTimeout(() => {
        statusEl.style.display = 'none';
      }, 4000);
    };

    if (btnMd && !btnMd.dataset.initialized) {
      btnMd.dataset.initialized = 'true';
      btnMd.addEventListener('click', () => {
        const md = exportAarMarkdown();
        triggerDownload(
          md,
          `tactical-aar-${Date.now()}.md`,
          'text/markdown;charset=utf-8',
          getDoc()
        );
        flashAarStatus('AAR Markdown Exported!');
      });
    }

    if (btnHtml && !btnHtml.dataset.initialized) {
      btnHtml.dataset.initialized = 'true';
      btnHtml.addEventListener('click', () => {
        const html = exportAarHtml();
        triggerDownload(
          html,
          `tactical-aar-${Date.now()}.html`,
          'text/html;charset=utf-8',
          getDoc()
        );
        flashAarStatus('AAR HTML Ready!');
      });
    }
  }

  return {
    initDigitalTwinCalibrationUI,
    renderTwinCalibrationScope,
    updateTwinCalibrationDOM,
    getActiveCalibrationReport,
    getActiveCalibrationTrace,
    getActiveCalibrationParams,
    initMilitaryGisUI,
    applyScenarioJson,
    buildTacticalSnapshot,
    exportScenarioJson,
    exportKml,
    exportCotXml,
    initAarExporterUI,
    buildCurrentAarSnapshot,
    exportAarMarkdown,
    exportAarHtml,
    isMgrsGridActive,
    setMgrsGridActive,
    triggerDownload: (content, filename, mimeType) =>
      triggerDownload(content, filename, mimeType, getDoc()),
    handleGeoTiffBuffer,
  };
}
