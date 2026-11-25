/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Strictly Typed Telemetry DOM Updaters Controller (SPEC-V3-09)
 *
 * Extracted from monolithic index.html into a modular, headless-testable,
 * strictly typed controller.
 * Operates at 50 Hz discrete-event updates with signature diffing,
 * zero per-frame DOM thrashing, and strict XSS sanitization via escapeHtml.
 */

import { escapeHtml } from '../domSafety';
import {
  HiFiPhysicsTelemetry,
  TransportAbrTelemetry,
  EwEccmTelemetry,
  ConstellationMobilityTelemetry,
} from '../../shared/workerProtocol';
import { QosNetworkSlaReport } from '../../core/qosSlaEngine';
import { classifyLinkCommunicationStatus, LinkStatusTelemetryInput } from '../../core/linkStatusClassifier';

// ============================================================================
// Types & Contracts
// ============================================================================

export interface BiomeTelemetryState {
  readonly biome_id?: string;
  readonly terrain_mode?: string;
  readonly frame?: { readonly terrain_mode?: string; readonly biome_id?: string };
  readonly biome_em_enabled?: boolean;
  readonly polarization_mode?: string;
  readonly mean_two_ray_gain_db?: number;
  readonly mean_foliage_loss_db?: number;
  readonly mean_dust_loss_db?: number;
  readonly mean_pol_loss_db?: number;
}

export interface FleetTerminalTelemetry extends LinkStatusTelemetryInput {
  readonly node_id: number;
  readonly name?: string;
  readonly active_sector_id?: number;
  readonly sector_id?: number;
  readonly modcod_name?: string;
  readonly modcod?: string;
  readonly two_hop_active?: boolean;
  readonly peer_relay_active?: boolean;
  readonly is_relay?: boolean;
  readonly node_type?: string;
  readonly link_outage?: boolean;
}

export interface TelemetryDomUpdatersDeps {
  readonly onSelectNode?: (nodeId: number | string) => void;
  readonly documentRef?: Document;
}

export interface TelemetryDomUpdaters {
  readonly updateHiFiPhysicsUI: (
    hifi?: HiFiPhysicsTelemetry | null,
    transportAbr?: TransportAbrTelemetry | null,
    ewEccm?: EwEccmTelemetry | null,
    constellationMobility?: ConstellationMobilityTelemetry | null
  ) => void;
  readonly updateBiomePhysicsUI: (msg?: BiomeTelemetryState | null) => void;
  readonly updateConstellationMobilityUI: (
    constellationMobility?: ConstellationMobilityTelemetry | null
  ) => void;
  readonly updateOpsQosSlaUI: (
    report?: Partial<QosNetworkSlaReport> | null,
    nodes?: readonly unknown[] | null
  ) => void;
  readonly renderOpsFleetRegistry: (
    nodes: readonly FleetTerminalTelemetry[],
    selectedNodeId?: number | string | null
  ) => void;
  readonly updateTopbarAggregateThroughput: (rxGoodputMbps: number | string) => void;
  readonly resetTelemetryDomState: () => void;
  readonly getOpsFleetSignature: () => string;
}

// ============================================================================
// Controller Factory
// ============================================================================

export function createTelemetryDomUpdaters(deps?: TelemetryDomUpdatersDeps): TelemetryDomUpdaters {
  const getDoc = (): Document | undefined => {
    if (deps?.documentRef) return deps.documentRef;
    if (typeof document !== 'undefined') return document;
    return undefined;
  };

  const $ = (id: string): HTMLElement | null => {
    const doc = getDoc();
    return doc ? doc.getElementById(id) : null;
  };

  let lastOpsFleetSignature = '';

  function resetTelemetryDomState(): void {
    lastOpsFleetSignature = '';
    const topThru = $('topbar-agg-thruput');
    if (topThru) {
      topThru.textContent = '-- Mbps';
    }
  }

  function getOpsFleetSignature(): string {
    return lastOpsFleetSignature;
  }

  function updateTopbarAggregateThroughput(rxGoodputMbps: number | string): void {
    const topThru = $('topbar-agg-thruput');
    if (!topThru) return;

    if (typeof rxGoodputMbps === 'number') {
      topThru.textContent = Number.isFinite(rxGoodputMbps)
        ? `${rxGoodputMbps.toFixed(2)} Mbps`
        : '-- Mbps';
    } else if (typeof rxGoodputMbps === 'string' && rxGoodputMbps.trim().length > 0) {
      topThru.textContent = rxGoodputMbps;
    } else {
      topThru.textContent = '-- Mbps';
    }
  }

  function updateHiFiPhysicsUI(
    hifi?: HiFiPhysicsTelemetry | null,
    transportAbr?: TransportAbrTelemetry | null,
    ewEccm?: EwEccmTelemetry | null,
    constellationMobility?: ConstellationMobilityTelemetry | null
  ): void {
    const doc = getDoc();
    if (!doc) return;
    if (!hifi && !transportAbr && !ewEccm && !constellationMobility) return;
    const flags = hifi?.enabled_flags;

    const attBox = $('toggle-hifi-attitude') as HTMLInputElement | null;
    if (attBox && doc.activeElement !== attBox) {
      attBox.checked = Boolean(flags?.enableAirframeShadowing);
    }

    const ricBox = $('toggle-hifi-rician') as HTMLInputElement | null;
    if (ricBox && doc.activeElement !== ricBox) {
      ricBox.checked = Boolean(flags?.enableCorrelatedRicianFading);
    }

    const harqBox = $('toggle-hifi-harq') as HTMLInputElement | null;
    if (harqBox && doc.activeElement !== harqBox) {
      harqBox.checked = Boolean(flags?.enableMacPhyFeedback);
    }

    const dubBox = $('toggle-hifi-dubins') as HTMLInputElement | null;
    if (dubBox && doc.activeElement !== dubBox) {
      dubBox.checked = Boolean(flags?.enableDubinsKinematics);
    }

    const viewBox = $('toggle-hifi-viewshed-parity') as HTMLInputElement | null;
    if (viewBox && doc.activeElement !== viewBox) {
      viewBox.checked = flags?.viewshedFidelityMode === 'link-budget-parity';
    }

    const abrBox = $('toggle-hifi-abr') as HTMLInputElement | null;
    const abrActive = transportAbr?.enabled ?? false;
    if (abrBox && doc.activeElement !== abrBox) {
      abrBox.checked = Boolean(abrActive);
    }

    const allOn = Boolean(
      flags?.enableAirframeShadowing &&
        flags?.enableCorrelatedRicianFading &&
        flags?.enableMacPhyFeedback &&
        flags?.enableDubinsKinematics &&
        flags?.viewshedFidelityMode === 'link-budget-parity' &&
        abrActive
    );
    const btn = $('btn-hifi-all-toggle');
    if (btn) {
      btn.textContent = allOn ? 'Baseline Mode' : 'Enable All Models';
    }

    const attReadout = $('hifi-attitude-readout');
    if (attReadout) {
      if (flags?.enableAirframeShadowing) {
        const roll = (hifi?.uav_roll_deg ?? 0).toFixed(1);
        const pitch = (hifi?.uav_pitch_deg ?? 0).toFixed(1);
        const meanLoss = (hifi?.mean_airframe_shadow_loss_db ?? 0).toFixed(1);
        const maxLoss = (hifi?.max_airframe_shadow_loss_db ?? 0).toFixed(1);
        attReadout.textContent = `R:${roll} deg P:${pitch} deg | Loss:${meanLoss} dB (max ${maxLoss} dB)`;
        attReadout.style.color = 'var(--lo-accent, #38bdf8)';
      } else {
        attReadout.textContent = 'Off (0.0 dB)';
        attReadout.style.color = 'var(--lo-text-muted, #8b949e)';
      }
    }

    const ricReadout = $('hifi-rician-readout');
    if (ricReadout) {
      if (flags?.enableCorrelatedRicianFading) {
        const fading = (hifi?.mean_correlated_fading_db ?? 0).toFixed(1);
        const coh = (hifi?.coherence_time_ms ?? 0).toFixed(1);
        ricReadout.textContent = `Fading: ${fading} dB | Tc: ${coh} ms`;
        ricReadout.style.color = 'var(--lo-accent, #38bdf8)';
      } else {
        ricReadout.textContent = 'Off (AWGN)';
        ricReadout.style.color = 'var(--lo-text-muted, #8b949e)';
      }
    }

    const harqReadout = $('hifi-harq-readout');
    if (harqReadout) {
      if (flags?.enableMacPhyFeedback) {
        const lag = hifi?.cqi_lag_frames ?? 0;
        const olla = (hifi?.mean_olla_offset_db ?? 0).toFixed(1);
        const retx = hifi?.harq_retransmissions_total ?? 0;
        const guardEff = ((hifi?.dynamic_guard_efficiency ?? 1) * 100).toFixed(1);
        harqReadout.textContent = `Lag:${lag}f | OLLA:${olla} dB | Retx:${retx} | Guard:${guardEff}%`;
        harqReadout.style.color = 'var(--lo-accent, #38bdf8)';
      } else {
        harqReadout.textContent = 'Off (Static Guard)';
        harqReadout.style.color = 'var(--lo-text-muted, #8b949e)';
      }
    }

    const dubReadout = $('hifi-dubins-readout');
    if (dubReadout) {
      if (flags?.enableDubinsKinematics) {
        const rMin = (hifi?.dubins_min_turn_radius_m ?? 0).toFixed(0);
        dubReadout.textContent = `R_min: ${rMin} m | Kinematics Active`;
        dubReadout.style.color = 'var(--lo-accent, #38bdf8)';
      } else {
        dubReadout.textContent = 'Off (Unconstrained)';
        dubReadout.style.color = 'var(--lo-text-muted, #8b949e)';
      }
    }

    const viewReadout = $('hifi-viewshed-readout');
    if (viewReadout) {
      if (flags?.viewshedFidelityMode === 'link-budget-parity') {
        viewReadout.textContent = 'Mode: LINK-BUDGET-PARITY (Ray Marching)';
        viewReadout.style.color = 'var(--lo-accent, #38bdf8)';
      } else {
        viewReadout.textContent = 'Mode: FAST (Amortized)';
        viewReadout.style.color = 'var(--lo-text-muted, #8b949e)';
      }
    }

    const abrReadout = $('hifi-abr-readout');
    if (abrReadout) {
      if (abrActive) {
        const cwnd = (transportAbr?.mean_cwnd_packets ?? 0).toFixed(1);
        const rate = (transportAbr?.mean_video_bitrate_mbps ?? 0).toFixed(2);
        const tier = transportAbr?.active_video_tier_label ?? '1080P_HD';
        const scale = (transportAbr?.mean_closed_loop_capacity_scale ?? 1.0).toFixed(2);
        abrReadout.textContent = `${tier} (${rate} Mbps) | Cwnd:${cwnd} | Scale:${scale}`;
        abrReadout.style.color = 'var(--lo-accent, #38bdf8)';
      } else {
        abrReadout.textContent = 'Off (Fixed Bitrate)';
        abrReadout.style.color = 'var(--lo-text-muted, #8b949e)';
      }
    }

    // EW / ECCM & GNSS Spoofing Controls (V3-03)
    const eccmSelect = $('ew-eccm-mode-select') as HTMLSelectElement | null;
    if (eccmSelect && ewEccm?.eccm_mode && doc.activeElement !== eccmSelect) {
      eccmSelect.value = ewEccm.eccm_mode;
    }
    const mvdrBox = $('toggle-ew-mvdr') as HTMLInputElement | null;
    if (mvdrBox && ewEccm && doc.activeElement !== mvdrBox) {
      mvdrBox.checked = Boolean(ewEccm.mvdr_null_steering_enabled);
    }
    const esmBox = $('toggle-ew-esm') as HTMLInputElement | null;
    if (esmBox && ewEccm && doc.activeElement !== esmBox) {
      esmBox.checked = Boolean(ewEccm.adversary_esm_enabled);
    }
    const spoofInput = $('ew-gnss-spoof-input') as HTMLInputElement | null;
    if (spoofInput && ewEccm && doc.activeElement !== spoofInput) {
      spoofInput.value = String(ewEccm.gnss_spoofing_rate_us_per_sec ?? 0);
    }

    const mvdrReadout = $('hifi-mvdr-readout');
    if (mvdrReadout) {
      if (ewEccm?.mvdr_null_steering_enabled) {
        const nullRej = (ewEccm.mean_spatial_null_rejection_db ?? 0).toFixed(1);
        mvdrReadout.textContent = `Active (${nullRej} dB null)`;
        mvdrReadout.style.color = 'var(--lo-accent, #38bdf8)';
      } else {
        mvdrReadout.textContent = 'Off (Omni)';
        mvdrReadout.style.color = 'var(--lo-text-muted, #8b949e)';
      }
    }

    const esmReadout = $('hifi-esm-readout');
    if (esmReadout) {
      if (ewEccm?.adversary_esm_enabled) {
        const rdet = (ewEccm.esm_detection_radius_km ?? 0).toFixed(1);
        const pInt = ((ewEccm.max_intercept_probability ?? 0) * 100).toFixed(0);
        esmReadout.textContent = `R_det: ${rdet} km | P_int: ${pInt}%`;
        esmReadout.style.color = 'var(--lo-accent, #38bdf8)';
      } else {
        esmReadout.textContent = 'Off (No Intercept)';
        esmReadout.style.color = 'var(--lo-text-muted, #8b949e)';
      }
    }

    const ewReadout = $('ew-eccm-readout');
    if (ewReadout) {
      if (ewEccm) {
        const mode = ewEccm.eccm_mode || 'NONE';
        const gp = (ewEccm.mean_processing_gain_db ?? 0).toFixed(1);
        const nullRej = (ewEccm.mean_spatial_null_rejection_db ?? 0).toFixed(1);
        const jeff = (ewEccm.mean_effective_jammer_power_dbm ?? -150).toFixed(1);
        const rdet = (ewEccm.esm_detection_radius_km ?? 0).toFixed(1);
        const taDrift = (ewEccm.gnss_ta_drift_us ?? 0).toFixed(1);
        const suppressed = ewEccm.jammer_suppressed ? ' [SUPPRESSED]' : '';
        const collision = ewEccm.gnss_spoof_slot_collision ? ' [SLOT COLLISION]' : '';
        ewReadout.textContent = `ECCM: ${mode} (+${gp} dB) | MVDR: ${nullRej} dB${suppressed} | J_eff: ${jeff} dBm | ESM R_det: ${rdet} km | TA Drift: ${taDrift} \u03bcs${collision}`;
      } else {
        ewReadout.textContent =
          'ECCM: NONE (0.0 dB) | MVDR Null: 0.0 dB | J_eff: -- dBm | ESM R_det: -- km | TA Drift: 0.0 \u03bcs';
      }
    }

    updateConstellationMobilityUI(constellationMobility);
  }

  function updateConstellationMobilityUI(
    constellationMobility?: ConstellationMobilityTelemetry | null
  ): void {
    const cmReadout = $('constellation-mobility-readout');
    if (!cmReadout) return;

    if (constellationMobility) {
      const acnCount = constellationMobility.acn_count ?? 1;
      const manetActive = (constellationMobility.manet_active_routes?.length ?? 0) > 0;
      const convoyCount = constellationMobility.ground_convoys?.length ?? 0;
      const aero = constellationMobility.aerodynamics;
      const windSpeed =
        aero?.crosswind_mps !== undefined ? Math.abs(aero.crosswind_mps).toFixed(1) : '0.0';
      const crab =
        aero?.crab_angle_deg !== undefined ? aero.crab_angle_deg.toFixed(1) : '0.0';
      const endurance =
        aero?.endurance_remaining_min !== undefined
          ? Math.round(aero.endurance_remaining_min)
          : 480;
      const cfitStatus = aero?.cfit_pull_up_active ? 'PULL-UP ACTIVE' : 'SAFE';
      cmReadout.textContent = `Constellation: ${acnCount} ACN${
        acnCount > 1 ? 's' : ''
      } | MANET: ${
        manetActive
          ? `${constellationMobility.manet_active_routes.length} routes (${constellationMobility.manet_mean_e2e_mbps} Mbps)`
          : 'OFF'
      } | Convoy: ${convoyCount > 0 ? `${convoyCount} units` : 'OFF'} | Wind: ${windSpeed} m/s (Crab ${crab}°) | Endurance: ${endurance} min | CFIT: ${cfitStatus}`;
    } else {
      cmReadout.textContent =
        'Constellation: 1 ACN | MANET: OFF | Convoy: OFF | Wind: 0 m/s (Crab 0.0°) | Endurance: 480 min | CFIT: SAFE';
    }
  }

  function updateBiomePhysicsUI(msg?: BiomeTelemetryState | null): void {
    const doc = getDoc();
    if (!doc || !msg) return;

    const sectorSelect = $('dem-sector-select') as HTMLSelectElement | null;
    if (sectorSelect && doc.activeElement !== sectorSelect) {
      const curBiome = msg.biome_id || msg.frame?.biome_id || 'alpine_mountain';
      const curTerrainMode = msg.terrain_mode || msg.frame?.terrain_mode;
      if (curBiome === 'alpine_mountain') {
        if (curTerrainMode === 'synthetic') {
          if (sectorSelect.value !== 'kargil' && sectorSelect.value !== 'synthetic') {
            sectorSelect.value = 'kargil';
          }
        } else if (curTerrainMode === 'real' || !curTerrainMode) {
          if (sectorSelect.value !== 'ladakh' && sectorSelect.value !== 'alpine_mountain') {
            sectorSelect.value = 'ladakh';
          }
        }
      } else {
        if (sectorSelect.value !== curBiome) {
          sectorSelect.value = curBiome;
        }
      }
      const normPreset = sectorSelect.value === 'alpine_mountain' ? 'ladakh' : sectorSelect.value;
      doc.querySelectorAll('#tb-dem-quick-switch .tb-dem-preset-btn[data-dem-preset]').forEach((btn) => {
        const active = btn.getAttribute('data-dem-preset') === normPreset;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
    }

    const toggleEm = $('toggle-biome-em') as HTMLInputElement | null;
    if (toggleEm && doc.activeElement !== toggleEm) {
      toggleEm.checked = Boolean(msg.biome_em_enabled);
    }

    const polSel = $('biome-pol-select') as HTMLSelectElement | null;
    if (polSel && doc.activeElement !== polSel && msg.polarization_mode) {
      polSel.value = msg.polarization_mode;
    }

    const emReadout = $('biome-em-readout');
    if (emReadout) {
      if (msg.biome_em_enabled) {
        const twoRayVal = msg.mean_two_ray_gain_db ?? 0;
        const twoRay = (twoRayVal >= 0 ? '+' : '') + twoRayVal.toFixed(1);
        const veg = (msg.mean_foliage_loss_db ?? 0).toFixed(1);
        const dust = (msg.mean_dust_loss_db ?? 0).toFixed(1);
        const pol = (msg.mean_pol_loss_db ?? 0).toFixed(1);
        emReadout.textContent = `2-Ray: ${twoRay} dB | Veg: ${veg} dB | Dust: ${dust} dB | Pol: ${pol} dB`;
        emReadout.style.color = 'var(--lo-accent, #38bdf8)';
      } else {
        emReadout.textContent = 'Off (Baseline FSPL)';
        emReadout.style.color = 'var(--lo-text-muted, #8b949e)';
      }
    }
  }

  function updateOpsQosSlaUI(
    report?: Partial<QosNetworkSlaReport> | null,
    nodes?: readonly unknown[] | null
  ): void {
    const opsOverallBadge = $('ops-qos-overall-badge');
    const nodeList = Array.isArray(nodes) ? nodes : [];

    if (nodeList.length === 0 || !report) {
      if (opsOverallBadge) {
        opsOverallBadge.textContent = 'STANDBY';
        opsOverallBadge.className = 'kpi-badge badge-neutral';
      }
      for (const qosId of [69, 65, 67, 70]) {
        const vEl = $(`ops-qos-${qosId}-val`);
        const bEl = $(`ops-qos-${qosId}-bar`);
        if (vEl) {
          vEl.textContent = '-- ms · --';
          vEl.className = 'c2-qos-val';
          vEl.style.color = '';
        }
        if (bEl) {
          bEl.style.width = '0%';
          bEl.className = 'c2-bar-fill is-accent';
          bEl.style.backgroundColor = '';
        }
      }
      return;
    }

    if (opsOverallBadge && typeof report.overallSlaCompliancePct === 'number') {
      const overallPct = report.overallSlaCompliancePct;
      if (overallPct >= 95.0) {
        opsOverallBadge.textContent = `${overallPct.toFixed(0)}% PASS`;
        opsOverallBadge.className = 'kpi-badge badge-emerald';
      } else if (overallPct >= 75.0) {
        opsOverallBadge.textContent = `${overallPct.toFixed(0)}% WARN`;
        opsOverallBadge.className = 'kpi-badge badge-amber';
      } else {
        opsOverallBadge.textContent = `${overallPct.toFixed(0)}% BREACH`;
        opsOverallBadge.className = 'kpi-badge badge-danger';
      }
    }

    for (const b of report.bearers || []) {
      const vEl = $(`ops-qos-${b.qos5qi}-val`);
      const bEl = $(`ops-qos-${b.qos5qi}-bar`);
      if (!vEl && !bEl) continue;

      const sojournMs = Number.isFinite(b.estimatedMaxSojournMs) ? b.estimatedMaxSojournMs : 0;
      const pdbMs = b.pdbMs || 1;
      const pct = Math.max(0, (sojournMs / pdbMs) * 100);
      const headroomVal = Math.round(b.pdbHeadroomPct);
      const headroomText = headroomVal > 0 ? `+${headroomVal}%` : `${headroomVal}%`;

      if (vEl) {
        vEl.textContent = `${sojournMs.toFixed(1)} ms · ${headroomText}`;
        if (pct > 100) {
          vEl.className = 'c2-qos-val c-bad';
          vEl.style.color = 'var(--lo-err, #ef4444)';
        } else if (pct > 75) {
          vEl.className = 'c2-qos-val is-warn';
          vEl.style.color = '';
        } else {
          vEl.className = 'c2-qos-val';
          vEl.style.color = '';
        }
      }

      if (bEl) {
        bEl.style.width = `${Math.min(100, Math.round(pct))}%`;
        if (pct > 100) {
          bEl.className = 'c2-bar-fill';
          bEl.style.backgroundColor = 'var(--lo-err, #ef4444)';
        } else if (pct > 75) {
          bEl.className = 'c2-bar-fill is-warn';
          bEl.style.backgroundColor = '';
        } else {
          bEl.className = 'c2-bar-fill is-accent';
          bEl.style.backgroundColor = '';
        }
      }
    }
  }

  function renderOpsFleetRegistry(
    nodes: readonly FleetTerminalTelemetry[],
    selectedNodeId?: number | string | null
  ): void {
    const doc = getDoc();
    const tbody = $('ops-fleet-tbody');
    const countBadge = $('ops-fleet-count');
    if (!tbody || !doc) return;

    const nodeList = Array.isArray(nodes) ? nodes : [];
    if (countBadge) {
      countBadge.textContent = `${nodeList.length} ACTIVE`;
    }

    if (nodeList.length === 0) {
      if (lastOpsFleetSignature !== '__EMPTY__') {
        lastOpsFleetSignature = '__EMPTY__';
        tbody.innerHTML =
          '<tr><td colspan="5" class="muted" style="text-align:center;padding:12px 6px;">No active ground terminals</td></tr>';
      }
      return;
    }

    const rowsData: Array<{
      nodeId: number;
      isSelected: boolean;
      nidStr: string;
      callsign: string;
      secStr: string;
      modcodStr: string;
      statusText: string;
      statusClass: string;
    }> = [];
    const sigParts = [String(selectedNodeId ?? '')];

    for (let i = 0; i < nodeList.length; i++) {
      const n = nodeList[i];
      const isSelected = n.node_id === selectedNodeId;
      const nidStr = 'N-' + String(n.node_id).padStart(2, '0');
      const callsign = n.name || 'Terminal ' + n.node_id;
      const secStr =
        typeof n.active_sector_id === 'number'
          ? 'S' + n.active_sector_id
          : typeof n.sector_id === 'number'
          ? 'S' + n.sector_id
          : '--';
      const modcodRaw = n.modcod_name || n.modcod || '--';
      const modcodStr = modcodRaw && modcodRaw !== 'LINK_OUTAGE' ? modcodRaw : '--';

      let statusText = 'LOS CLEAR';
      let statusClass = 'c-ok';
      const isRelay = Boolean(
        n.two_hop_active || n.peer_relay_active || n.is_relay || n.node_type === 'relay'
      );

      if (isRelay) {
        statusText = 'RELAY';
        statusClass = 'c-acc';
      } else {
        const classification = classifyLinkCommunicationStatus(n);
        switch (classification.status) {
          case 'CONNECTED':
            statusText = 'LOS CLEAR';
            statusClass = 'c-ok';
            break;
          case 'DEGRADED':
            statusText = 'DEGRADED';
            statusClass = 'c-warn';
            break;
          case 'BLOCKED_TERRAIN':
          case 'BLOCKED_OBSTACLE':
            statusText = 'BLOCKED';
            statusClass = 'c-bad';
            break;
          case 'OUTAGE_DISCONNECTED':
            statusText = 'OUTAGE';
            statusClass = 'c-bad';
            break;
          default:
            if (n.link_outage) {
              statusText = 'OUTAGE';
              statusClass = 'c-bad';
            } else {
              statusText = 'LOS CLEAR';
              statusClass = 'c-ok';
            }
            break;
        }
      }

      sigParts.push(
        `${n.node_id}:${callsign}:${secStr}:${modcodStr}:${statusText}:${isSelected}`
      );
      rowsData.push({
        nodeId: n.node_id,
        isSelected,
        nidStr,
        callsign,
        secStr,
        modcodStr,
        statusText,
        statusClass,
      });
    }

    const currentSig = sigParts.join('|');
    if (currentSig === lastOpsFleetSignature) {
      return;
    }
    lastOpsFleetSignature = currentSig;

    const trElements = rowsData.map((r) => {
      const tr = doc.createElement('tr');
      tr.style.cursor = 'pointer';
      if (r.isSelected) tr.classList.add('is-selected');
      tr.dataset.nodeId = String(r.nodeId);
      const onRowClick = () => {
        if (deps?.onSelectNode) {
          deps.onSelectNode(r.nodeId);
        } else if (
          typeof window !== 'undefined' &&
          typeof (window as unknown as { onTargetNodeChange?: (id: number) => void })
            .onTargetNodeChange === 'function'
        ) {
          (window as unknown as { onTargetNodeChange: (id: number) => void }).onTargetNodeChange(
            r.nodeId
          );
        }
      };
      tr.onclick = onRowClick;
      tr.addEventListener('click', onRowClick);
      tr.innerHTML = `
        <td class="c-acc">${escapeHtml(r.nidStr)}</td>
        <td>${escapeHtml(r.callsign)}</td>
        <td>${escapeHtml(r.secStr)}</td>
        <td>${escapeHtml(r.modcodStr)}</td>
        <td class="${escapeHtml(r.statusClass)}">${escapeHtml(r.statusText)}</td>
      `;
      return tr;
    });

    tbody.replaceChildren(...trElements);
  }

  return {
    updateHiFiPhysicsUI,
    updateBiomePhysicsUI,
    updateConstellationMobilityUI,
    updateOpsQosSlaUI,
    renderOpsFleetRegistry,
    updateTopbarAggregateThroughput,
    resetTelemetryDomState,
    getOpsFleetSignature,
  };
}
