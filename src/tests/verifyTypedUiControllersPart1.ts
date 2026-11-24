/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Verification Suite 111: De-Monolithizing index.html Part 1 — Strict TypeScript UI Controllers (SPEC-V3-09)
 *
 * Verifies:
 * - [TUC-T1] Telemetry DOM Updaters (HiFi, Biomes, Constellation, 5QI SLAs, Fleet Signature-Diffing & XSS Sanitization)
 * - [TUC-T2] Mission I/O & Calibration Controller (Scenario JSON, KML, ATAK CoT XML, AAR Briefing & GeoTIFF Ingestion)
 * - [TUC-T3] Command Palette Controller (Catalog Binding Verification, Modal Lifecycle & Keyboard Dispatching)
 * - [TUC-T4] Monolith Reduction Audit (>= 700 Net Lines Removed from index.html & Static Contract Preservation)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createTelemetryDomUpdaters,
  TelemetryDomUpdaters,
  FleetTerminalTelemetry,
} from '../ui/controllers/telemetryDomUpdaters';
import {
  initMissionIoController,
  MissionIoController,
  triggerDownload,
} from '../ui/controllers/missionIoController';
import {
  initCommandPaletteController,
  verifyAllPaletteCommandsBound,
  createDefaultDomActionMap,
} from '../ui/controllers/commandPaletteController';
import { DEFAULT_PALETTE_COMMANDS } from '../ui/commandPaletteEngine';
import { parseMissionScenarioJson } from '../core/militaryGisEngine';
import { generateAarMarkdown, generateAarPrintableHtml, fmtInt } from '../core/aarBriefingGenerator';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[FAIL] ${message}`);
  }
  console.log(`  ✔ [PASS] ${message}`);
}

// ============================================================================
// Lightweight Mock DOM Helper
// ============================================================================

interface MockElement {
  id: string;
  tagName: string;
  textContent: string;
  innerHTML: string;
  className: string;
  classList: {
    add: (cls: string) => void;
    remove: (cls: string) => void;
    toggle: (cls: string, force?: boolean) => void;
    contains: (cls: string) => boolean;
  };
  style: Record<string, string>;
  dataset: Record<string, string>;
  children: MockElement[];
  checked?: boolean;
  value?: string;
  hidden?: boolean;
  disabled?: boolean;
  selectedIndex?: number;
  options?: Array<{ text: string; value: string }>;
  onclick?: (() => void) | null;
  replaceChildren: (...newChildren: MockElement[]) => void;
  appendChild: (child: MockElement) => MockElement;
  setAttribute: (name: string, val: string) => void;
  getAttribute: (name: string) => string | null;
  querySelectorAll: (selector: string) => MockElement[];
  querySelector: (selector: string) => MockElement | null;
  addEventListener: (event: string, handler: (e: any) => void) => void;
  removeEventListener: (event: string, handler: (e: any) => void) => void;
  dispatchEvent: (event: { type: string }) => boolean;
  click: () => void;
  focus?: () => void;
  scrollIntoView?: (options?: unknown) => void;
  getContext?: (type: string) => unknown;
}

function createMockElement(id: string = '', tagName: string = 'div'): MockElement {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const children: MockElement[] = [];

  const el: MockElement = {
    id,
    tagName: tagName.toUpperCase(),
    textContent: '',
    innerHTML: '',
    className: '',
    classList: {
      add: (cls) => {
        classes.add(cls);
        el.className = [...classes].join(' ');
      },
      remove: (cls) => {
        classes.delete(cls);
        el.className = [...classes].join(' ');
      },
      toggle: (cls, force) => {
        const has = classes.has(cls);
        const shouldHave = force !== undefined ? force : !has;
        if (shouldHave) classes.add(cls);
        else classes.delete(cls);
        el.className = [...classes].join(' ');
      },
      contains: (cls) => classes.has(cls),
    },
    style: {},
    dataset: {},
    children,
    checked: false,
    value: '',
    hidden: false,
    disabled: false,
    selectedIndex: 0,
    options: [],
    replaceChildren: (...newChildren) => {
      children.length = 0;
      children.push(...newChildren);
    },
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    setAttribute: (name, val) => {
      attributes.set(name.toLowerCase(), val);
    },
    getAttribute: (name) => attributes.get(name.toLowerCase()) || null,
    querySelectorAll: (selector) => {
      const results: MockElement[] = [];
      const match = (item: MockElement) => {
        if (selector.startsWith('.') && item.classList.contains(selector.slice(1))) {
          results.push(item);
        }
        for (const c of item.children) match(c);
      };
      for (const c of children) match(c);
      return results;
    },
    querySelector: (selector) => {
      const all = el.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    },
    addEventListener: (event, handler) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    removeEventListener: (event, handler) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    },
    dispatchEvent: (event) => {
      const handlers = listeners[event.type] || [];
      for (const h of handlers) h(event);
      return true;
    },
    click: () => {
      if (typeof el.onclick === 'function') {
        el.onclick();
      }
      const handlers = listeners['click'] || [];
      for (const h of handlers) h({ type: 'click' });
    },
    focus: () => {},
    scrollIntoView: () => {},
    getContext: () => ({
      fillRect: () => {},
      clearRect: () => {},
      strokeRect: () => {},
      fillText: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      save: () => {},
      restore: () => {},
      setLineDash: () => {},
    }),
  };

  return el;
}

function createMockDocument(): Document {
  const elements = new Map<string, MockElement>();

  const doc = {
    getElementById: (id: string): HTMLElement | null => {
      if (!elements.has(id)) {
        elements.set(id, createMockElement(id));
      }
      return elements.get(id) as unknown as HTMLElement;
    },
    createElement: (tag: string): HTMLElement => {
      return createMockElement('', tag) as unknown as HTMLElement;
    },
    body: createMockElement('body', 'body') as unknown as HTMLElement,
    activeElement: null as HTMLElement | null,
  };

  return doc as unknown as Document;
}

// ============================================================================
// Verification Suite 111
// ============================================================================

async function runSuite111(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log(' Tactical X-Band Digital Twin — Suite 111: Strict TypeScript UI Controllers');
  console.log('='.repeat(80) + '\n');

  // ==========================================================================
  // [TUC-T1] Telemetry DOM Updaters Controller
  // ==========================================================================
  console.log('--- [TUC-T1] Telemetry DOM Updaters Controller ---');

  const mockDoc = createMockDocument();
  let selectedNodeReported: number | string | null = null;

  const updaters: TelemetryDomUpdaters = createTelemetryDomUpdaters({
    documentRef: mockDoc,
    onSelectNode: (nid) => {
      selectedNodeReported = nid;
    },
  });

  // 1. HiFi Physics updates
  updaters.updateHiFiPhysicsUI(
    {
      enabled_flags: {
        enableAirframeShadowing: true,
        enableCorrelatedRicianFading: true,
        enableMacPhyFeedback: true,
        enableDubinsKinematics: true,
        viewshedFidelityMode: 'link-budget-parity',
      },
      uav_roll_deg: 12.5,
      uav_pitch_deg: -3.2,
      mean_airframe_shadow_loss_db: 4.8,
      max_airframe_shadow_loss_db: 14.1,
      mean_correlated_fading_db: 2.1,
      coherence_time_ms: 18.5,
      cqi_lag_frames: 2,
      mean_olla_offset_db: 1.5,
      harq_retransmissions_total: 42,
      harq_combined_gain_db: 3.2,
      dynamic_guard_efficiency: 0.94,
      dubins_min_turn_radius_m: 800,
    },
    {
      enabled: true,
      mean_cwnd_packets: 32.5,
      mean_video_bitrate_mbps: 18.4,
      active_video_tier_label: '1080P_HD',
      abr_step_downs: 1,
      abr_step_ups: 3,
      mean_closed_loop_capacity_scale: 1.05,
    },
    {
      eccm_mode: 'FHSS',
      mvdr_null_steering_enabled: true,
      adversary_esm_enabled: true,
      gnss_spoofing_rate_us_per_sec: 1.2,
      anti_spoof_holdover_active: false,
      gnss_ta_drift_us: 0.8,
      mean_processing_gain_db: 12.0,
      mean_spatial_null_rejection_db: 28.5,
      mean_effective_jammer_power_dbm: -95.0,
      raw_jammer_power_dbm: -60.0,
      jammer_suppressed: true,
      esm_detection_radius_km: 18.2,
      lpi_safety_ratio: 2.1,
      max_intercept_probability: 0.15,
      gnss_spoof_slot_collision: false,
    },
    {
      acn_count: 2,
      secondary_acns: [],
      ground_convoys: [],
      manet_active_routes: [
        {
          route_id: 'r1',
          source_node_id: 1,
          destination_node_id: 4,
          hop_count: 2,
          route_path: [1, 2, 4],
          bottleneck_sinr_db: 14.0,
          end_to_end_delay_ms: 18.2,
          is_active: true,
        },
      ],
      manet_mean_e2e_mbps: 14.5,
      aerodynamics: {
        airspeed_mps: 50,
        groundspeed_mps: 48,
        crosswind_mps: 4.5,
        crab_angle_deg: 5.2,
        endurance_remaining_min: 420,
        fuel_fraction_pct: 88,
        cfit_pull_up_active: false,
      },
    }
  );

  const attCheck = mockDoc.getElementById('toggle-hifi-attitude') as any;
  assert(attCheck?.checked === true, 'updateHiFiPhysicsUI sets #toggle-hifi-attitude to true');

  const ricCheck = mockDoc.getElementById('toggle-hifi-rician') as any;
  assert(ricCheck?.checked === true, 'updateHiFiPhysicsUI sets #toggle-hifi-rician to true');

  const abrReadout = mockDoc.getElementById('hifi-abr-readout');
  assert(
    abrReadout?.textContent.includes('1080P_HD'),
    'updateHiFiPhysicsUI populates ABR tier label in #hifi-abr-readout'
  );

  const cmReadout = mockDoc.getElementById('constellation-mobility-readout');
  assert(
    cmReadout?.textContent.includes('Constellation: 2 ACNs'),
    'updateConstellationMobilityUI renders 2 ACN constellation status'
  );

  // 2. Biome Physics UI update
  updaters.updateBiomePhysicsUI({
    biome_id: 'alpine_mountain',
    biome_em_enabled: true,
    polarization_mode: 'circular',
    mean_two_ray_gain_db: 1.8,
    mean_foliage_loss_db: 0.5,
    mean_dust_loss_db: 0.2,
    mean_pol_loss_db: 0.4,
  });

  const biomeEmCheck = mockDoc.getElementById('toggle-biome-em') as any;
  assert(biomeEmCheck?.checked === true, 'updateBiomePhysicsUI sets #toggle-biome-em to true');

  const emReadout = mockDoc.getElementById('biome-em-readout');
  assert(
    emReadout?.textContent.includes('+1.8 dB'),
    'updateBiomePhysicsUI renders +1.8 dB 2-ray gain'
  );

  // 3. Ops QoS SLA UI update
  updaters.updateOpsQosSlaUI(
    {
      overallSlaCompliancePct: 98.5,
      bearers: [
        {
          qos5qi: 65,
          name: 'Mission Voice',
          shortName: 'Voice',
          fiveQi: 65,
          pdbMs: 75,
          estimatedMaxSojournMs: 22.4,
          pdbHeadroomPct: 70.1,
          slaVerdict: 'SLA_COMPLIANT',
          slaCompliancePct: 100,
          backlogKbits: 12.0,
          allocationCount: 4,
          jainsFairnessIndex: 0.98,
        },
      ],
    },
    [{ node_id: 1 }]
  );

  const overallBadge = mockDoc.getElementById('ops-qos-overall-badge');
  assert(
    overallBadge?.textContent.includes('99% PASS') || overallBadge?.textContent.includes('98% PASS'),
    `updateOpsQosSlaUI displays overall PASS badge (actual: "${overallBadge?.textContent}")`
  );

  const v65 = mockDoc.getElementById('ops-qos-65-val');
  assert(
    v65?.textContent.includes('22.4 ms'),
    `updateOpsQosSlaUI displays 22.4 ms latency for 5QI-65 (actual: "${v65?.textContent}")`
  );

  // 4. Fleet Registry rendering, signature diffing & XSS sanitization
  const testFleet: FleetTerminalTelemetry[] = [
    {
      node_id: 1,
      name: 'HQ-CMD',
      active_sector_id: 1,
      modcod_name: '16APSK 2/3',
      snr_db: 16.5,
      link_outage: false,
    },
    {
      node_id: 2,
      name: '<script>alert("xss")</script>ALPHA',
      active_sector_id: 2,
      modcod_name: 'QPSK 1/2',
      snr_db: 4.2,
      link_outage: false,
    },
  ];

  updaters.renderOpsFleetRegistry(testFleet, 1);
  const sig1 = updaters.getOpsFleetSignature();
  assert(sig1.length > 0, `Fleet registry computed non-empty signature: ${sig1}`);

  const tbody = mockDoc.getElementById('ops-fleet-tbody') as any;
  assert(tbody.children.length === 2, `Fleet table rendered 2 rows (actual: ${tbody.children.length})`);

  // Verify XSS neutralization in row 2
  const row2Html = tbody.children[1].innerHTML;
  assert(
    !row2Html.includes('<script>'),
    'Malicious <script> payload strictly escaped in fleet row innerHTML'
  );
  assert(
    row2Html.includes('&lt;script&gt;'),
    'Escaped &lt;script&gt; entity present in fleet row HTML'
  );

  // Signature-diffing verification: passing identical data must NOT replace children
  const originalRows = [...tbody.children];
  updaters.renderOpsFleetRegistry(testFleet, 1);
  assert(
    tbody.children[0] === originalRows[0] && tbody.children[1] === originalRows[1],
    'Signature-diffing: unchanged fleet telemetry preserved identical DOM row references'
  );

  // Selection click callback
  tbody.children[1].click();
  assert(
    selectedNodeReported === 2,
    `Row click invoked onSelectNode with ID 2 (actual: ${selectedNodeReported})`
  );

  // Topbar aggregate throughput & reset
  updaters.updateTopbarAggregateThroughput(20.384);
  const topThru = mockDoc.getElementById('topbar-agg-thruput');
  assert(
    topThru?.textContent === '20.38 Mbps',
    `updateTopbarAggregateThroughput formatted 20.38 Mbps (actual: "${topThru?.textContent}")`
  );

  updaters.resetTelemetryDomState();
  assert(
    updaters.getOpsFleetSignature() === '',
    'resetTelemetryDomState cleared fleet signature'
  );
  assert(
    topThru?.textContent === '-- Mbps',
    'resetTelemetryDomState reset topbar throughput to "-- Mbps"'
  );

  // ==========================================================================
  // [TUC-T2] Mission I/O & Calibration Controller
  // ==========================================================================
  console.log('\n--- [TUC-T2] Mission I/O & Calibration Controller ---');

  const missionIo: MissionIoController = initMissionIoController({
    documentRef: mockDoc,
    getLatestTelemetry: () => ({
      sim_time_s: 42.0,
      frame_index: 2100,
      acn_telemetry: {
        pos_x: 1000,
        pos_y: 2000,
        altitude_msl_m: 5200,
      },
      nodes_telemetry: [
        {
          node_id: 1,
          name: 'HQ-COMMAND',
          x_m: 0,
          y_m: 0,
          lat_deg: 34.5,
          lon_deg: 76.5,
          elevation_m: 3500,
          agl_m: 2.5,
          snr_db: 18.2,
          is_transmitting: true,
        },
        {
          node_id: 2,
          name: 'PATROL-BRAVO',
          x_m: 5000,
          y_m: 5000,
          lat_deg: 34.55,
          lon_deg: 76.55,
          elevation_m: 3600,
          agl_m: 2.0,
          snr_db: 12.4,
          is_transmitting: true,
        },
      ],
      flight_path: [{ x: 1000, y: 2000, alt: 5200 }],
      comparative_kpi_dashboard: {
        static_goodput_mb: 12.31,
        tac_goodput_mb: 20.38,
        gain_multiplier: 1.65,
        static_waste_pct: 38.4,
        tac_waste_pct: 11.2,
        static_drops: 1478,
        tac_drops: 196,
      },
      scheduler_mode: 'Tac-TAD (Dynamic)',
    }),
    getActiveBiomeId: () => 'alpine_mountain',
  });

  // 1. Tactical Snapshot & Scenario JSON
  const snap = missionIo.buildTacticalSnapshot();
  assert(
    snap.entities.length >= 3,
    `buildTacticalSnapshot created >= 3 entities (ACN + nodes) (actual: ${snap.entities.length})`
  );
  assert(
    snap.links.length === 2,
    `buildTacticalSnapshot created 2 tactical links (actual: ${snap.links.length})`
  );

  const scenarioJson = missionIo.exportScenarioJson();
  const parsedScenario = parseMissionScenarioJson(scenarioJson);
  assert(
    parsedScenario.ok === true && parsedScenario.scenario !== undefined,
    'exportScenarioJson generated valid JSON parseable by parseMissionScenarioJson'
  );
  assert(
    parsedScenario.scenario?.nodes.length === 2,
    `Scenario JSON preserved 2 nodes (actual: ${parsedScenario.scenario?.nodes.length})`
  );

  // 2. KML & ATAK CoT XML
  const kml = missionIo.exportKml();
  assert(kml.includes('<kml') && kml.includes('VIPER-01'), 'exportKml produces valid KML with VIPER-01 ACN');
  assert(kml.includes('<Placemark>'), 'exportKml includes Placemark tags');

  const cot = missionIo.exportCotXml();
  assert(cot.includes('<event') && cot.includes('version="2.0"'), 'exportCotXml produces valid ATAK CoT event document');
  assert(cot.includes('<point'), 'exportCotXml contains geospatial <point> tags');

  // 3. AAR Snapshot & Exports
  const aarSnap = missionIo.buildCurrentAarSnapshot();
  assert(
    Number.isFinite(aarSnap.frameCount) && aarSnap.frameCount === 2100,
    `buildCurrentAarSnapshot captured frameCount = 2100 (actual: ${aarSnap.frameCount})`
  );

  const aarMd = missionIo.exportAarMarkdown();
  assert(!aarMd.includes('NaN'), 'exportAarMarkdown output contains zero NaN occurrences');
  assert(aarMd.includes('+1.65x Gain'), 'exportAarMarkdown includes +1.65x Gain multiplier');

  const aarHtml = missionIo.exportAarHtml();
  assert(!aarHtml.includes('NaN'), 'exportAarHtml output contains zero NaN occurrences');
  assert(aarHtml.includes('<!DOCTYPE html>'), 'exportAarHtml produces valid HTML5 document');

  // 4. MGRS Grid active state
  assert(missionIo.isMgrsGridActive() === false, 'MGRS grid initially inactive');
  missionIo.setMgrsGridActive(true);
  assert(missionIo.isMgrsGridActive() === true, 'setMgrsGridActive(true) toggles state');

  // 5. GeoTIFF buffer handling
  const zeroBuf = new ArrayBuffer(0);
  const geoTiffRes = missionIo.handleGeoTiffBuffer(zeroBuf);
  assert(geoTiffRes.ok === false, 'handleGeoTiffBuffer fails closed on 0-byte buffer');

  // ==========================================================================
  // [TUC-T3] Command Palette Controller
  // ==========================================================================
  console.log('\n--- [TUC-T3] Command Palette Controller ---');

  // 1. Catalog completeness check across default action map
  const defaultActionMap = createDefaultDomActionMap(mockDoc);
  const catalogCheck = verifyAllPaletteCommandsBound(defaultActionMap, DEFAULT_PALETTE_COMMANDS);
  assert(
    catalogCheck.valid,
    `verifyAllPaletteCommandsBound: 100% of ${DEFAULT_PALETTE_COMMANDS.length} commands are bound (missing: ${catalogCheck.missingCommands.join(', ') || 'none'})`
  );

  let executedCmd: string | null = null;
  const palette = initCommandPaletteController({
    documentRef: mockDoc,
    onExecute: (cmdId) => {
      executedCmd = cmdId;
    },
  });

  // 2. Open / Close lifecycle
  assert(palette.isOpen() === false, 'Palette initially closed');
  palette.open();
  assert(palette.isOpen() === true, 'palette.open() sets isOpen() to true');
  const modal = mockDoc.getElementById('c2-cmd-palette-modal') as any;
  assert(modal.hidden === false, 'palette.open() sets modal.hidden to false');

  // 3. Filtering & Ranking
  palette.filter('ruler');
  const ranked = palette.getRankedList();
  assert(ranked.length > 0, 'palette.filter("ruler") returned ranked results');
  assert(
    ranked[0].command.id === 'tools:ruler',
    `Top match for "ruler" is tools:ruler (actual: ${ranked[0].command.id})`
  );

  // 4. Selection & Execution
  palette.selectIndex(0);
  assert(palette.getCurrentIndex() === 0, 'palette.selectIndex(0) sets index 0');

  palette.executeSelected();
  assert(executedCmd === 'tools:ruler', `executeSelected executed "tools:ruler" (actual: ${executedCmd})`);
  assert(palette.isOpen() === false, 'palette automatically closes upon command execution');
  assert(modal.hidden === true, 'modal.hidden set to true upon command execution');

  // 5. Disposal
  palette.dispose();
  assert(true, 'palette.dispose() cleaned up listeners without error');

  // ==========================================================================
  // [TUC-T4] Monolith Line Count & Static Contract Audit
  // ==========================================================================
  console.log('\n--- [TUC-T4] Monolith Line Count & Static Contract Audit ---');

  const indexPath = resolve(process.cwd(), 'index.html');
  const indexHtml = readFileSync(indexPath, 'utf-8');
  const lines = indexHtml.split('\n');
  const lineCount = lines.length;

  console.log(`    index.html line count: ${lineCount} lines (Baseline: 24,306 lines)`);
  const netLinesRemoved = 24306 - lineCount;
  console.log(`    Net lines removed: ${netLinesRemoved} lines (Target: >= 700 lines)`);

  assert(
    netLinesRemoved >= 700,
    `index.html reduced by >= 700 lines (actual reduction: ${netLinesRemoved} lines)`
  );

  // Verify critical DOM IDs preserved
  const requiredIds = [
    'ops-fleet-tbody',
    'ops-fleet-count',
    'topbar-agg-thruput',
    'twin-calibration-canvas',
    'btn-cal-auto-solve',
    'btn-cal-evaluate',
    'toggle-mgrs-grid',
    'btn-scenario-save-json',
    'btn-export-kml',
    'btn-export-cot-xml',
    'btn-command-palette',
    'c2-cmd-palette-modal',
    'c2-cmd-palette-input',
    'c2-cmd-palette-list',
    'btn-export-aar-md',
    'btn-export-aar-html',
    'aar-export-status',
  ];

  for (const reqId of requiredIds) {
    assert(
      indexHtml.includes(`id="${reqId}"`),
      `index.html preserves required DOM element #${reqId}`
    );
  }

  // Verify global window bindings preserved
  const requiredGlobalBindings = [
    'window.updateHiFiPhysicsUI = updateHiFiPhysicsUI',
    'window.updateBiomePhysicsUI = updateBiomePhysicsUI',
    'window.renderOpsFleetRegistry = renderOpsFleetRegistry',
    'window.isMgrsGridActive = isMgrsGridActive',
    'window.initDigitalTwinCalibrationUI = initDigitalTwinCalibrationUI',
    'window.renderTwinCalibrationScope = renderTwinCalibrationScope',
    'window.initMilitaryGisUI = initMilitaryGisUI',
    'window.onBiomeEmToggleChange',
  ];

  for (const binding of requiredGlobalBindings) {
    assert(
      indexHtml.includes(binding),
      `index.html preserves required global binding "${binding}"`
    );
  }

  // Verify fmtInt integer NaN guard in aarBriefingGenerator
  assert(fmtInt(NaN, '0') === '0', 'fmtInt(NaN) returns fallback "0"');
  assert(fmtInt(Infinity, '0') === '0', 'fmtInt(Infinity) returns fallback "0"');
  assert(fmtInt('NaN', '0') === '0', 'fmtInt("NaN") returns fallback "0"');
  assert(fmtInt(42, '0') === '42', 'fmtInt(42) returns "42"');
  assert(fmtInt('ACN-1', '0') === 'ACN-1', 'fmtInt("ACN-1") preserves callsign string');

  console.log('\n' + '='.repeat(80));
  console.log(' ✔ ALL TESTS PASSED (Suite 111: Strict TypeScript UI Controllers Part 1)');
  console.log('='.repeat(80) + '\n');
}

runSuite111().catch((err) => {
  console.error('\n Suite 111 FAILED:', err);
  process.exit(1);
});
