/**
 * src/ui/scientificScopesRenderer.ts
 *
 * Dedicated Type-Checked Scientific Canvas Scope Renderers.
 *
 * Scopes:
 * 1. Body-Frame Polar Radiation Scope [ITU-R F.1336] (drawPolarAntennaScope)
 * 2. ITU-R Link Budget Waterfall Analyzer (drawLinkWaterfallCanvas)
 * 3. Empirical CDF Delay Distribution Scope [3GPP 5QI PDB] (drawEcdfDelayScope)
 * 4. Multi-Point Parametric Sensitivity Sweep Scope (drawSensitivitySweepScope)
 * 5. 50 Hz Web Worker Real-Time Execution Jitter 8-Bin Histogram Scope (drawWorkerJitterHistogramScope)
 *
 * Specification: docs/specs/SPEC-SOFTWARE-ENGINEERING-MODULARITY-AND-DRY-REFACTOR.md
 */

import { syncCanvasDpr } from './pathProfileTopView';
import {
  getSensitivityAxisConfig,
  evaluateParametricSensitivity,
} from '../core/parametricSensitivity';
import { safeHtml } from './domSafety';
import { getLatticeCanvasPalette } from './canvasTheme';

export interface ScientificScopeNodeTelemetry {
  readonly node_id: number;
  readonly name?: string;
  readonly node_type?: string;
  readonly body_azimuth_deg?: number;
  readonly pattern_rolloff_db?: number;
  readonly active_sector_id?: number;
  readonly tx_power_dbm?: number;
  readonly slant_range_km?: number;
  readonly diffraction_loss_db?: number;
  readonly crest_radius_m?: number;
  readonly curvature_loss_db?: number;
  readonly sky_noise_db?: number;
  readonly sky_temp_k?: number;
  readonly timing_advance_us?: number;
  readonly doppler_shift_hz?: number;
  readonly doppler_rate_hz_s?: number;
  readonly rician_k_db?: number;
  readonly rician_fading_db?: number;
  readonly olla_margin_db?: number;
}

export interface ScientificScopeFrameTelemetry {
  readonly acn_heading_deg?: number;
  readonly acn_bank_deg?: number;
  readonly total_sector_handovers?: number;
  readonly nodes_telemetry?: readonly ScientificScopeNodeTelemetry[];
  readonly selected_link_budget?: {
    readonly node_id?: number;
    readonly node_type?: string;
    readonly slant_range_km?: number;
    readonly tx_power_dbm?: number;
    readonly tx_gain_dbi?: number;
    readonly rx_gain_dbi?: number;
    readonly fspl_db?: number;
    readonly gas_loss_db?: number;
    readonly rain_loss_db?: number;
    readonly diffraction_loss_db?: number;
    readonly cable_loss_db?: number;
    readonly implementation_margin_db?: number;
    readonly total_loss_db?: number;
    readonly prx_dbm?: number;
    readonly pnoise_dbm?: number;
    readonly snr_db?: number;
    readonly sinr_db?: number;
    readonly sky_noise_increase_db?: number;
    readonly sky_temperature_k?: number;
    readonly crest_radius_m?: number;
    readonly curvature_loss_db?: number;
  };
  readonly static_delay_ecdf_ms?: readonly number[];
  readonly reactive_delay_ecdf_ms?: readonly number[];
  readonly tac_delay_ecdf_ms?: readonly number[];
  readonly traffic_load_multiplier?: number;
  readonly dem_lookahead_error_std_m?: number;
  readonly cqi_feedback_delay_ms?: number;
}

export interface JitterHistogramBin {
  readonly minMs: number;
  readonly maxMs: number;
  readonly count: number;
  readonly fraction: number;
  readonly label: string;
}

export interface WorkerRealTimeProfileReport {
  readonly rfc3550JitterMs: number;
  readonly deadlineOverrunCount: number;
  readonly histogramBins: readonly JitterHistogramBin[];
}

/**
 * Scope 1: Body-Frame Polar Radiation Scope [ITU-R F.1336]
 */
export function drawPolarAntennaScope(
  canvas: HTMLCanvasElement | null,
  ctx: CanvasRenderingContext2D | null,
  frame: ScientificScopeFrameTelemetry | null | undefined,
  selectedNodeId: number = 1,
  setTextFn?: (id: string, text: string) => void
): void {
  try {
    if (!canvas || !ctx) return;
    const sync = syncCanvasDpr(canvas, ctx);
    if (!sync.isVisible) return;
    const w = sync.cssWidth, h = sync.cssHeight;
    if (w <= 0 || h <= 0) return;
    const g = ctx;
    g.clearRect(0, 0, w, h);
    const palette = getLatticeCanvasPalette();

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(cx, cy) - 22; // 22px margin for 10px text labels

    // Dark canvas background
    g.fillStyle = palette.panelBg;
    g.fillRect(0, 0, w, h);

    // Attenuation ring radii: mapped from 0 dB at outer rim (R) to 25 dB at center (0)
    const r0 = R;
    const r3 = R * (1 - 3 / 25.0);
    const r10 = R * (1 - 10 / 25.0);
    const r20 = R * (1 - 20 / 25.0);

    // 0 dB outer rim
    g.strokeStyle = palette.gridMajor;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx, cy, r0, 0, Math.PI * 2);
    g.stroke();

    // -10 dB and -20 dB inner rings
    g.strokeStyle = palette.gridMinor;
    g.lineWidth = 1;
    g.setLineDash([2, 4]);
    g.beginPath();
    g.arc(cx, cy, r10, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, r20, 0, Math.PI * 2);
    g.stroke();

    // -3 dB crossover circle (dashed degraded/amber circle)
    g.strokeStyle = palette.degraded;
    g.lineWidth = 1.5;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.arc(cx, cy, r3, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);

    // Dashed crossover diagonals (45°, 135°, 225°, 315°)
    g.strokeStyle = palette.gridMinor;
    g.lineWidth = 1;
    g.setLineDash([3, 4]);
    const diags = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];
    for (const ang of diags) {
      g.beginPath();
      g.moveTo(cx - R * Math.cos(ang), cy - R * Math.sin(ang));
      g.lineTo(cx + R * Math.cos(ang), cy + R * Math.sin(ang));
      g.stroke();
    }
    g.setLineDash([]);

    // Radial axes at 0° (FWD, top), 90° (STBD, right), 180° (AFT, bottom), 270° (PORT, left)
    g.strokeStyle = palette.axisStroke;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx, cy - R - 6);
    g.lineTo(cx, cy + R + 6);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - R - 6, cy);
    g.lineTo(cx + R + 6, cy);
    g.stroke();

    // Axis labels (10px monospace)
    g.fillStyle = palette.textSecondary;
    g.font = '600 10px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillText('0° FWD', cx, cy - R - 7);
    g.textBaseline = 'top';
    g.fillText('180° AFT', cx, cy + R + 7);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText('90° STBD', cx + R + 7, cy);
    g.textAlign = 'right';
    g.fillText('270° PORT', cx - R - 7, cy);

    // Ring dB labels
    g.fillStyle = palette.textMuted;
    g.font = '10px monospace';
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    g.fillText('0dB', cx + r0 - 2, cy - 2);
    g.fillText('-3dB', cx + r3 - 2, cy - 2);
    g.fillText('-10dB', cx + r10 - 2, cy - 2);

    // 4 continuous parabolic sector gain curves G_k(Δφ) = -12 * (Δφ / 90°)^2 dB
    const sectorColors = [palette.accent, palette.optimal, palette.degraded, palette.relay];
    const boresightsDeg = [0, 90, 180, 270];

    for (let k = 0; k < 4; k++) {
      const phi0 = boresightsDeg[k];
      g.strokeStyle = sectorColors[k];
      g.lineWidth = 1.8;
      g.beginPath();
      let started = false;

      for (let delta = -60; delta <= 60; delta += 2) {
        const thetaDeg = phi0 + delta;
        const thetaRad = (thetaDeg * Math.PI) / 180;
        const rollOffDb = 12 * Math.pow(Math.abs(delta) / 90.0, 2);
        const rVal = R * Math.max(0, 1 - rollOffDb / 25.0);
        const px = cx + rVal * Math.sin(thetaRad);
        const py = cy - rVal * Math.cos(thetaRad);
        if (!started) {
          g.moveTo(px, py);
          started = true;
        } else {
          g.lineTo(px, py);
        }
      }
      g.stroke();
    }

    // Plot ground nodes
    const nodes = frame?.nodes_telemetry || [];
    for (const n of nodes) {
      const azDeg = typeof n.body_azimuth_deg === 'number' ? n.body_azimuth_deg : 0;
      const rollOff = typeof n.pattern_rolloff_db === 'number' ? n.pattern_rolloff_db : 0;
      const rNode = R * Math.max(0.08, 1 - Math.min(25.0, rollOff) / 25.0);
      const azRad = (azDeg * Math.PI) / 180;
      const nx = cx + rNode * Math.sin(azRad);
      const ny = cy - rNode * Math.cos(azRad);

      const secId = (typeof n.active_sector_id === 'number' && n.active_sector_id >= 0 && n.active_sector_id < 4)
        ? n.active_sector_id : 0;
      const col = sectorColors[secId];

      const isSel = n.node_id === selectedNodeId;
      if (isSel) {
        g.strokeStyle = palette.textPrimary;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(nx, ny, 6, 0, Math.PI * 2);
        g.stroke();
      }

      g.fillStyle = col;
      g.beginPath();
      g.arc(nx, ny, isSel ? 4 : 3, 0, Math.PI * 2);
      g.fill();

      // Node callsign
      g.fillStyle = isSel ? palette.textPrimary : col;
      g.font = '600 10px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillText(n.name || `S${n.node_id}`, nx, ny - 4);
    }

    // Update Header Readout if callback provided
    if (setTextFn) {
      const hdg = typeof frame?.acn_heading_deg === 'number' ? frame.acn_heading_deg.toFixed(1) : '--';
      const bank = typeof frame?.acn_bank_deg === 'number' ? frame.acn_bank_deg.toFixed(1) : '--';
      const ho = typeof frame?.total_sector_handovers === 'number' ? frame.total_sector_handovers : 0;
      setTextFn('polar-scope-readout', `HDG: ${hdg}° | BANK: ${bank}° | HO: ${ho}`);
    }
  } catch (err) {
    console.error('drawPolarAntennaScope exception:', err);
  }
}

/**
 * Scope 2: ITU-R Link Budget Waterfall Analyzer
 */
export function drawLinkWaterfallCanvas(
  canvas: HTMLCanvasElement | null,
  ctx: CanvasRenderingContext2D | null,
  frame: ScientificScopeFrameTelemetry | null | undefined,
  selectedNodeId: number = 1,
  setTextFn?: (id: string, text: string) => void
): void {
  try {
    if (!canvas || !ctx) return;
    const sync = syncCanvasDpr(canvas, ctx);
    if (!sync.isVisible) return;
    const w = sync.cssWidth, h = sync.cssHeight;
    if (w <= 0 || h <= 0) return;
    const g = ctx;
    g.clearRect(0, 0, w, h);
    const palette = getLatticeCanvasPalette();

    // Identify inspected node
    const nodes = frame?.nodes_telemetry || [];
    let node = nodes.find(n => n.node_id === selectedNodeId);
    if (!node) node = nodes.find(n => n.node_id === 1) || nodes[0];

    // Background
    g.fillStyle = palette.panelBg;
    g.fillRect(0, 0, w, h);

    const rawLb = frame?.selected_link_budget;
    const lb = rawLb && (rawLb.node_id === undefined || !node || rawLb.node_id === node.node_id)
      ? rawLb
      : undefined;

    if (!node && !lb) {
      g.fillStyle = palette.textMuted;
      g.font = '11px monospace';
      g.textAlign = 'center';
      g.fillText('Waiting for node RF link telemetry...', w / 2, h / 2);
      return;
    }

    // Authoritative RF Link Budget values from frame.selected_link_budget (canonical fallback when absent)
    const ptx = typeof lb?.tx_power_dbm === 'number'
      ? lb.tx_power_dbm
      : (typeof node?.tx_power_dbm === 'number' ? node.tx_power_dbm : 36.0);
    const gtx = typeof lb?.tx_gain_dbi === 'number'
      ? lb.tx_gain_dbi
      : (node?.node_type === 'mcp' || lb?.node_type === 'mcp' ? 20.0 : 3.0);
    const eirp = ptx + gtx;
    const slantKm = typeof lb?.slant_range_km === 'number' && lb.slant_range_km > 0
      ? lb.slant_range_km
      : (typeof node?.slant_range_km === 'number' && node.slant_range_km > 0 ? node.slant_range_km : 25.0);
    const fspl = typeof lb?.fspl_db === 'number'
      ? lb.fspl_db
      : (20 * Math.log10(slantKm * 1000) + 20 * Math.log10(8e9) - 147.55);
    const agas = typeof lb?.gas_loss_db === 'number' ? lb.gas_loss_db : (0.012 * slantKm);
    const arain = typeof lb?.rain_loss_db === 'number' ? lb.rain_loss_db : 0.0;
    const ldiff = typeof lb?.diffraction_loss_db === 'number'
      ? lb.diffraction_loss_db
      : (typeof node?.diffraction_loss_db === 'number' ? node.diffraction_loss_db : 0.0);
    const lcableMargin =
      typeof lb?.cable_loss_db === 'number' && typeof lb?.implementation_margin_db === 'number'
        ? lb.cable_loss_db + lb.implementation_margin_db
        : 4.0;
    const rCrest = typeof lb?.crest_radius_m === 'number'
      ? lb.crest_radius_m
      : (typeof node?.crest_radius_m === 'number' ? node.crest_radius_m : 2000.0);
    const tCrest = typeof lb?.curvature_loss_db === 'number'
      ? lb.curvature_loss_db
      : (typeof node?.curvature_loss_db === 'number' ? node.curvature_loss_db : 0.0);
    const rollOff = typeof node?.pattern_rolloff_db === 'number' ? node.pattern_rolloff_db : 0.0;
    const gacnNet = typeof lb?.rx_gain_dbi === 'number' ? lb.rx_gain_dbi : Math.max(0, 16.0 - rollOff);
    const prx = typeof lb?.prx_dbm === 'number'
      ? lb.prx_dbm
      : (eirp - fspl - agas - arain - ldiff - lcableMargin + gacnNet);
    const dnsky = typeof lb?.sky_noise_increase_db === 'number'
      ? lb.sky_noise_increase_db
      : (typeof node?.sky_noise_db === 'number' ? node.sky_noise_db : 0.0);
    const tsky = typeof lb?.sky_temperature_k === 'number'
      ? lb.sky_temperature_k
      : (typeof node?.sky_temp_k === 'number' ? node.sky_temp_k : 0.0);
    const pnoise = typeof lb?.pnoise_dbm === 'number'
      ? lb.pnoise_dbm
      : (-108.975 + dnsky);
    const tauTa = typeof node?.timing_advance_us === 'number'
      ? node.timing_advance_us
      : ((2.0 * slantKm * 1000 / 299792458.0) * 1e6);

    // Update Tabular Readout if callback provided
    if (setTextFn) {
      const targetNodeId = node?.node_id ?? lb?.node_id ?? selectedNodeId;
      const targetName = node?.name || 'Terminal';
      setTextFn('wf-target-node-badge', `Node ${targetNodeId} (${targetName})`);
      setTextFn('wf-eirp-readout', `${eirp.toFixed(1)} dBm`);
      setTextFn('wf-fspl-readout', `-${fspl.toFixed(1)} dB`);
      setTextFn('wf-atm-readout', `-${(agas + arain).toFixed(2)} dB`);
      setTextFn('wf-diff-readout', `-${ldiff.toFixed(1)} dB`);
      setTextFn('wf-crest-sub', `R_crest: ${rCrest.toFixed(0)} m · T_crest: ${tCrest.toFixed(1)} dB`);
      setTextFn('wf-prx-readout', `${prx.toFixed(1)} dBm`);
      setTextFn('wf-pnoise-readout', `${pnoise.toFixed(1)} dBm`);
      setTextFn('wf-sky-sub', `T_sky: ${tsky.toFixed(1)} K · +ΔN_sky: ${dnsky.toFixed(2)} dB`);
      setTextFn('wf-ta-readout', `${tauTa.toFixed(1)} μs`);
      const fd = typeof node?.doppler_shift_hz === 'number' ? node.doppler_shift_hz : 0.0;
      const fddot = typeof node?.doppler_rate_hz_s === 'number' ? node.doppler_rate_hz_s : 0.0;
      setTextFn('wf-doppler-readout', `${fd >= 0 ? '+' : ''}${fd.toFixed(1)} Hz`);
      setTextFn('wf-doppler-sub', `(${fddot >= 0 ? '+' : ''}${fddot.toFixed(2)} Hz/s)`);
      const ricianK = typeof node?.rician_k_db === 'number' ? `${node.rician_k_db.toFixed(1)} dB` : '— dB';
      const ricianFading = typeof node?.rician_fading_db === 'number' ? `${node.rician_fading_db >= 0 ? '+' : ''}${node.rician_fading_db.toFixed(1)} dB` : '— dB';
      const ollaMargin = typeof node?.olla_margin_db === 'number' ? `${node.olla_margin_db.toFixed(1)} dB` : '0.0 dB';
      setTextFn('wf-rician-readout', `3GPP Rician K-Factor: ${ricianK} (Fading: ${ricianFading} | OLLA: ${ollaMargin})`);
    }

    // Draw Waterfall Steps
    const stages = [
      { label: 'P_tx', delta: ptx, cum: ptx, col: palette.optimal },
      { label: '+G_tx', delta: gtx, cum: eirp, col: palette.optimal },
      { label: '-FSPL', delta: -fspl, cum: eirp - fspl, col: palette.outage },
      { label: '-A_gas', delta: -agas, cum: eirp - fspl - agas, col: palette.degraded },
      { label: '-A_rain', delta: -arain, cum: eirp - fspl - agas - arain, col: palette.relay },
      { label: '-L_diff', delta: -ldiff, cum: eirp - fspl - agas - arain - ldiff, col: palette.outage },
      { label: '-L_sys', delta: -lcableMargin, cum: eirp - fspl - agas - arain - ldiff - lcableMargin, col: palette.degraded },
      { label: '+G_acn', delta: gacnNet, cum: prx, col: palette.accent },
      { label: 'P_rx', delta: prx, cum: prx, col: prx >= pnoise ? palette.optimal : palette.outage }
    ];

    const paddingX = 40;
    const paddingY = 24;
    const plotW = w - paddingX * 2;
    const plotH = h - paddingY * 2;
    const numSteps = stages.length;
    const colW = plotW / numSteps;

    // Y mapping: +60 dBm at top to -140 dBm at bottom
    const yMax = 60;
    const yMin = -140;
    const yToPx = (val: number) => paddingY + plotH * (1 - (val - yMin) / (yMax - yMin));

    // Grid lines
    g.strokeStyle = palette.gridMinor;
    g.lineWidth = 1;
    g.setLineDash([3, 4]);
    const gridVals = [40, 20, 0, -20, -40, -60, -80, -100, -120];
    for (const gv of gridVals) {
      const gy = yToPx(gv);
      g.beginPath();
      g.moveTo(paddingX, gy);
      g.lineTo(w - paddingX, gy);
      g.stroke();

      g.fillStyle = palette.textMuted;
      g.font = '10px monospace';
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.fillText(`${gv}`, paddingX - 4, gy);
    }
    g.setLineDash([]);

    // Dashed noise floor line across canvas
    const pNoiseY = yToPx(pnoise);
    g.strokeStyle = palette.outage;
    g.lineWidth = 1.2;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(paddingX, pNoiseY);
    g.lineTo(w - paddingX, pNoiseY);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = palette.outage;
    g.font = '600 10px monospace';
    g.textAlign = 'left';
    g.fillText(`P_noise (${pnoise.toFixed(0)} dBm)`, paddingX + 6, pNoiseY - 4);

    // Draw Waterfall Bars
    let prevY = yToPx(0);
    for (let i = 0; i < numSteps; i++) {
      const st = stages[i];
      const bx = paddingX + i * colW + colW * 0.15;
      const bw = colW * 0.7;
      const currY = yToPx(st.cum);

      // Connecting dash from previous bar
      if (i > 0) {
        g.strokeStyle = palette.gridMajor;
        g.lineWidth = 1;
        g.setLineDash([2, 2]);
        g.beginPath();
        g.moveTo(bx - colW * 0.3, prevY);
        g.lineTo(bx, prevY);
        g.stroke();
        g.setLineDash([]);
      }

      // Bar
      const startY = i === 0 || i === numSteps - 1 ? yToPx(yMin) : prevY;
      const topY = Math.min(startY, currY);
      const barH = Math.max(3, Math.abs(currY - startY));

      g.fillStyle = st.col;
      g.fillRect(bx, topY, bw, barH);
      g.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      g.lineWidth = 1;
      g.strokeRect(bx, topY, bw, barH);

      // Label below bar
      g.fillStyle = palette.textSecondary;
      g.font = '600 10px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText(st.label, bx + bw / 2, h - paddingY + 6);

      // Value above or below bar
      g.fillStyle = palette.textPrimary;
      g.font = '10px monospace';
      g.textBaseline = currY < startY ? 'bottom' : 'top';
      const valText = i === 0 || i === numSteps - 1 ? `${st.cum.toFixed(0)}` : `${st.delta >= 0 ? '+' : ''}${st.delta.toFixed(0)}`;
      g.fillText(valText, bx + bw / 2, currY + (currY < startY ? -2 : 2));

      prevY = currY;
    }
  } catch (err) {
    console.error('drawLinkWaterfallCanvas exception:', err);
  }
}

/**
 * Scope 3: Empirical CDF Delay Distribution Scope [3GPP 5QI PDB]
 */
export function drawEcdfDelayScope(
  canvas: HTMLCanvasElement | null,
  ctx: CanvasRenderingContext2D | null,
  frame: ScientificScopeFrameTelemetry | null | undefined
): void {
  try {
    if (!canvas || !ctx) return;
    const sync = syncCanvasDpr(canvas, ctx);
    if (!sync.isVisible) return;
    const w = sync.cssWidth, h = sync.cssHeight;
    if (w <= 0 || h <= 0) return;
    const g = ctx;
    g.clearRect(0, 0, w, h);
    const palette = getLatticeCanvasPalette();

    // Dark canvas background
    g.fillStyle = palette.panelBg;
    g.fillRect(0, 0, w, h);

    const padL = 46;
    const padR = 20;
    const padT = 24;
    const padB = 26;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    if (plotW <= 10 || plotH <= 10) return;

    const maxDelayMs = 320.0;
    const toX = (dMs: number) => padL + Math.min(1.0, Math.max(0.0, dMs / maxDelayMs)) * plotW;
    const toY = (prob: number) => padT + (1.0 - Math.min(1.0, Math.max(0.0, prob))) * plotH;

    // Horizontal probability grid lines (0.00, 0.25, 0.50, 0.75, 1.00)
    g.strokeStyle = palette.gridMinor;
    g.lineWidth = 1;
    g.fillStyle = palette.textMuted;
    g.font = '10px var(--hi-mono, monospace)';
    g.textAlign = 'right';
    g.textBaseline = 'middle';

    const pSteps = [0.0, 0.25, 0.5, 0.75, 1.0];
    for (const p of pSteps) {
      const y = toY(p);
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(padL + plotW, y);
      g.stroke();
      g.fillText(p.toFixed(2), padL - 6, y);
    }

    // 3GPP TS 23.501 5QI Packet Delay Budget (PDB) Vertical Markers
    const pdbs = [
      { dMs: 60, label: '60ms [C2]', color: palette.accent },
      { dMs: 100, label: '100ms [Voice]', color: palette.optimal },
      { dMs: 150, label: '150ms [Video]', color: palette.degraded },
      { dMs: 300, label: '300ms [Photo]', color: palette.relay },
    ];

    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.font = '10px var(--hi-mono, monospace)';

    for (const pdb of pdbs) {
      const x = toX(pdb.dMs);
      g.save();
      g.strokeStyle = pdb.color;
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(x, padT);
      g.lineTo(x, padT + plotH);
      g.stroke();
      g.fillStyle = pdb.color;
      g.fillText(pdb.label, x, padT - 3);
      g.restore();
    }

    // X-Axis Baseline & Ticks
    g.strokeStyle = palette.axisStroke;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(padL, padT + plotH);
    g.lineTo(padL + plotW, padT + plotH);
    g.stroke();

    g.fillStyle = palette.textMuted;
    g.textBaseline = 'top';
    g.textAlign = 'center';
    const xTicks = [0, 50, 100, 150, 200, 250, 300];
    for (const xt of xTicks) {
      const x = toX(xt);
      g.fillText(`${xt}`, x, padT + plotH + 4);
    }
    // Axis Label
    g.fillStyle = palette.textSecondary;
    g.fillText('Delay τ (ms)', padL + plotW / 2, padT + plotH + 15);

    // Y-Axis Baseline
    g.beginPath();
    g.moveTo(padL, padT);
    g.lineTo(padL, padT + plotH);
    g.stroke();

    // Plot ECDF Curves for 3 Schedulers
    const quantiles = [0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99];
    const curves = [
      {
        id: 'static',
        name: 'Legacy Static TDMA',
        color: palette.outage,
        dash: [4, 4],
        width: 1.8,
        data: frame?.static_delay_ecdf_ms,
      },
      {
        id: 'reactive',
        name: 'Reactive M-LWDF',
        color: palette.degraded,
        dash: [] as number[],
        width: 1.8,
        data: frame?.reactive_delay_ecdf_ms,
      },
      {
        id: 'tac',
        name: 'Predictive Tac-TAD',
        color: palette.optimal,
        dash: [] as number[],
        width: 2.4,
        data: frame?.tac_delay_ecdf_ms,
      },
    ];

    for (const c of curves) {
      const vals = Array.isArray(c.data) && c.data.length === 7 ? c.data : null;
      g.save();
      g.strokeStyle = c.color;
      g.lineWidth = c.width;
      if (c.dash.length > 0) g.setLineDash(c.dash);
      g.beginPath();

      if (vals) {
        let currX = toX(0);
        let currY = toY(0);
        g.moveTo(currX, currY);

        for (let idx = 0; idx < 7; idx++) {
          const nextX = toX(vals[idx]);
          const nextY = toY(quantiles[idx]);
          g.lineTo(nextX, currY);
          g.lineTo(nextX, nextY);
          currX = nextX;
          currY = nextY;
        }
        g.lineTo(padL + plotW, toY(1.0));
      } else {
        // Fallback smooth curve before first telemetry
        g.moveTo(toX(0), toY(0));
        g.lineTo(toX(20), toY(0.5));
        g.lineTo(padL + plotW, toY(1.0));
      }
      g.stroke();
      g.restore();
    }
  } catch (err) {
    console.error('drawEcdfDelayScope exception:', err);
  }
}

/**
 * Scope 4: Multi-Point Parametric Sensitivity Sweep Scope
 */
export function drawSensitivitySweepScope(
  canvas: HTMLCanvasElement | null,
  ctx: CanvasRenderingContext2D | null,
  frame: ScientificScopeFrameTelemetry | null | undefined,
  activeSensitivityAxis: string = 'traffic_load',
  readoutElement?: HTMLElement | null
): void {
  try {
    if (!canvas || !ctx) return;
    const sync = syncCanvasDpr(canvas, ctx);
    if (!sync.isVisible) return;
    const w = sync.cssWidth, h = sync.cssHeight;
    if (w <= 0 || h <= 0) return;
    const g = ctx;
    g.clearRect(0, 0, w, h);
    const palette = getLatticeCanvasPalette();

    // Dark canvas background
    g.fillStyle = palette.panelBg;
    g.fillRect(0, 0, w, h);

    const padL = 50;
    const padR = 24;
    const padT = 28;
    const padB = 30;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    if (plotW <= 10 || plotH <= 10) return;

    const axisCfg = getSensitivityAxisConfig(activeSensitivityAxis as any);
    const xMin = axisCfg.xMin;
    const xMax = axisCfg.xMax;
    const maxGoodput = 110.0; // 0 - 110 Mbps Y-axis span

    const toX = (val: number) => padL + Math.min(1.0, Math.max(0.0, (val - xMin) / (xMax - xMin))) * plotW;
    const toY = (gpMbps: number) => padT + (1.0 - Math.min(1.0, Math.max(0.0, gpMbps / maxGoodput))) * plotH;

    // Horizontal grid lines (0, 25, 50, 75, 100 Mbps)
    g.strokeStyle = palette.gridMinor;
    g.lineWidth = 1;
    g.fillStyle = palette.textMuted;
    g.font = '10px var(--hi-mono, monospace)';
    g.textAlign = 'right';
    g.textBaseline = 'middle';

    const yLevels = [0, 25, 50, 75, 100];
    for (const lvl of yLevels) {
      const y = toY(lvl);
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(padL + plotW, y);
      g.stroke();
      g.fillText(`${lvl}M`, padL - 6, y);
    }

    // Y-Axis Label
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.fillStyle = palette.textSecondary;
    g.font = '10px var(--hi-mono, monospace)';
    g.fillText('Goodput (Mbps)', padL, padT - 8);

    // Domain X ticks & grid lines
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (const pt of axisCfg.points) {
      const x = toX(pt.x);
      g.beginPath();
      g.strokeStyle = palette.gridMinor;
      g.moveTo(x, padT);
      g.lineTo(x, padT + plotH);
      g.stroke();

      g.fillStyle = palette.textMuted;
      g.fillText(`${pt.x}${axisCfg.unit}`, x, padT + plotH + 5);
    }

    // X-Axis Baseline
    g.strokeStyle = palette.axisStroke;
    g.beginPath();
    g.moveTo(padL, padT + plotH);
    g.lineTo(padL + plotW, padT + plotH);
    g.stroke();

    // X-Axis Title
    g.fillStyle = palette.textSecondary;
    g.fillText(axisCfg.xLabel, padL + plotW / 2, padT + plotH + 18);

    // Plot 3 Curves across the 5 domain points
    const curves = [
      {
        name: 'Legacy Static TDMA',
        color: palette.outage,
        dash: [4, 4],
        width: 1.8,
        getVal: (p: any) => p.staticGoodputMbps,
      },
      {
        name: 'Reactive M-LWDF',
        color: palette.degraded,
        dash: [] as number[],
        width: 1.8,
        getVal: (p: any) => p.reactiveGoodputMbps,
      },
      {
        name: 'Predictive Tac-TAD',
        color: palette.optimal,
        dash: [] as number[],
        width: 2.5,
        getVal: (p: any) => p.tacGoodputMbps,
      },
    ];

    for (const c of curves) {
      g.save();
      g.strokeStyle = c.color;
      g.fillStyle = c.color;
      g.lineWidth = c.width;
      if (c.dash.length > 0) g.setLineDash(c.dash);
      g.beginPath();

      for (let idx = 0; idx < axisCfg.points.length; idx++) {
        const pt = axisCfg.points[idx];
        const cx = toX(pt.x);
        const cy = toY(c.getVal(pt));
        if (idx === 0) g.moveTo(cx, cy);
        else g.lineTo(cx, cy);
      }
      g.stroke();
      g.setLineDash([]);

      // Point dots
      for (const pt of axisCfg.points) {
        const cx = toX(pt.x);
        const cy = toY(c.getVal(pt));
        g.beginPath();
        g.arc(cx, cy, 3, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }

    // Determine current active operating point from telemetry
    let activeVal = 1.0;
    if (activeSensitivityAxis === 'traffic_load') {
      activeVal = Number.isFinite(frame?.traffic_load_multiplier) ? (frame!.traffic_load_multiplier as number) : 1.0;
    } else if (activeSensitivityAxis === 'dem_error') {
      activeVal = Number.isFinite(frame?.dem_lookahead_error_std_m) ? (frame!.dem_lookahead_error_std_m as number) : 0.0;
    } else if (activeSensitivityAxis === 'cqi_delay') {
      activeVal = Number.isFinite(frame?.cqi_feedback_delay_ms) ? (frame!.cqi_feedback_delay_ms as number) : 0.0;
    }

    const clampedActive = Math.max(xMin, Math.min(xMax, activeVal));
    const cursorX = toX(clampedActive);
    const evalActive = evaluateParametricSensitivity(activeSensitivityAxis as any, clampedActive);

    // Vertical cursor line at active operating point
    g.save();
    g.strokeStyle = palette.accent;
    g.lineWidth = 1.5;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(cursorX, padT);
    g.lineTo(cursorX, padT + plotH);
    g.stroke();

    // Intersection dots at active operating point
    const activeDots = [
      { y: toY(evalActive.staticGoodputMbps), color: palette.outage },
      { y: toY(evalActive.reactiveGoodputMbps), color: palette.degraded },
      { y: toY(evalActive.tacGoodputMbps), color: palette.optimal },
    ];
    for (const d of activeDots) {
      g.beginPath();
      g.fillStyle = d.color;
      g.arc(cursorX, d.y, 4.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = palette.textPrimary;
      g.lineWidth = 1.2;
      g.setLineDash([]);
      g.stroke();
    }

    // Cursor tag
    g.fillStyle = palette.accent;
    g.font = '10px var(--hi-mono, monospace)';
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillText(`LIVE: ${activeVal.toFixed(1)}${axisCfg.unit}`, cursorX, padT - 6);
    g.restore();

    // Update Live Telemetry Overlay in DOM if readout element provided
    if (readoutElement) {
      const advX = (evalActive.tacGoodputMbps / Math.max(0.1, evalActive.staticGoodputMbps)).toFixed(1);
      const dropDelta = (evalActive.staticDropRatePct - evalActive.tacDropRatePct).toFixed(1);
      readoutElement.innerHTML = safeHtml`Axis: <b>${axisCfg.xLabel}</b><br>Active: <b style="color:#38bdf8">${activeVal.toFixed(1)} ${axisCfg.unit}</b><br>Tac: <span style="color:#10b981">${evalActive.tacGoodputMbps.toFixed(1)}M (${evalActive.tacDropRatePct.toFixed(1)}% drp)</span><br>Static: <span style="color:#ef4444">${evalActive.staticGoodputMbps.toFixed(1)}M (${evalActive.staticDropRatePct.toFixed(1)}% drp)</span><br>Advantage: <b style="color:var(--hi-amber)">+${advX}x Goodput (-${dropDelta}% drops)</b>`.toString();
    }
  } catch (err) {
    console.error('drawSensitivitySweepScope exception:', err);
  }
}

/**
 * Scope 5: 50 Hz Web Worker Real-Time Execution Jitter 8-Bin Histogram Scope
 */
export function drawWorkerJitterHistogramScope(
  canvas: HTMLCanvasElement | null,
  ctx: CanvasRenderingContext2D | null,
  report: WorkerRealTimeProfileReport | null | undefined,
  dprOverride?: number
): void {
  if (!canvas || !ctx || !report) return;

  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.clientWidth || 550;
  const height = 150;
  const dpr = dprOverride ?? (typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1);

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const palette = getLatticeCanvasPalette();

  // Dark Canvas Background
  ctx.fillStyle = palette.panelBg;
  ctx.fillRect(0, 0, width, height);

  const padL = 45;
  const padR = 25;
  const padT = 20;
  const padB = 26;
  const plotW = Math.max(80, width - padL - padR);
  const plotH = Math.max(40, height - padT - padB);

  // Maximum fraction for scaling
  const maxFrac = Math.max(0.25, ...report.histogramBins.map(b => b.fraction));

  // Horizontal Grid Lines
  ctx.strokeStyle = palette.gridMinor;
  ctx.lineWidth = 1;
  ctx.fillStyle = palette.textMuted;
  ctx.font = '10px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const gridSteps = 3;
  for (let i = 0; i <= gridSteps; i++) {
    const f = (maxFrac * i) / gridSteps;
    const y = padT + plotH - (f / maxFrac) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(`${(f * 100).toFixed(0)}%`, padL - 6, y);
  }

  // Draw 8 Bars
  const nBins = report.histogramBins.length;
  const slotW = plotW / Math.max(1, nBins);
  const barW = Math.max(10, slotW * 0.72);

  report.histogramBins.forEach((bin, idx) => {
    const x = padL + idx * slotW + (slotW - barW) / 2;
    const barH = (bin.fraction / maxFrac) * plotH;
    const y = padT + plotH - barH;

    // Color coding: optimal (< 10ms), accent (10–14ms), degraded (14–18ms), outage (>= 18ms)
    let barColor = palette.optimal;
    if (bin.minMs >= 18) barColor = palette.outage;
    else if (bin.minMs >= 14) barColor = palette.degraded;
    else if (bin.minMs >= 10) barColor = palette.accent;

    // Bar rectangle
    ctx.fillStyle = barColor;
    ctx.fillRect(x, y, barW, barH);

    // Top border highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(x, y, barW, Math.min(2, barH));

    // Percentage text above bar
    if (bin.count > 0) {
      ctx.fillStyle = palette.textPrimary;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = '10px monospace';
      ctx.fillText(`${(bin.fraction * 100).toFixed(0)}%`, x + barW / 2, Math.max(padT + 10, y - 2));
    }

    // Label under bar
    ctx.fillStyle = palette.textSecondary;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '10px monospace';
    ctx.fillText(bin.label, x + barW / 2, padT + plotH + 5);
  });

  // Vertical dashed crimson 20.0 ms HARD RT CEILING marker
  const ceilingX = padL + plotW - 6;
  ctx.save();
  ctx.strokeStyle = palette.outage;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(ceilingX, padT - 6);
  ctx.lineTo(ceilingX, padT + plotH);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = palette.outage;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = '10px monospace';
  ctx.fillText('20.0 ms HARD RT CEILING', ceilingX - 4, padT - 6);

  ctx.restore();
}
