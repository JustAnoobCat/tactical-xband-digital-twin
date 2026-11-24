/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * After-Action Review (AAR) Tactical Mission Briefing Generator (SPEC-V3-08)
 *
 * Implements pure, deterministic Markdown and print-ready standalone HTML briefing generators.
 * Fully air-gapped: zero external CDNs, zero WebGL/DOM dependencies, zero Math.random(),
 * and strict XSS sanitization via `escapeHtml` / `escapeAttr`.
 */

import { escapeHtml, escapeAttr } from '../ui/domSafety';
import { geodeticToMgrs } from './militaryGisEngine';

// ============================================================================
// Types & Contracts
// ============================================================================

export interface AarQosClassSummary {
  readonly name: string;
  readonly fiveQi: number;
  readonly budgetMs: number;
  readonly p95Ms: number;
  readonly pass: boolean;
}

export interface AarFleetTerminal {
  readonly nodeId: number | string;
  readonly callsign: string;
  readonly latDeg?: number;
  readonly lonDeg?: number;
  readonly mgrs?: string;
  readonly sector: number | string;
  readonly modcod: string;
  readonly sinrDb: number;
  readonly status: string;
}

export interface AarAblationKpis {
  readonly tacDeliveredMb: number;
  readonly staticDeliveredMb: number;
  readonly throughputGainX: number;
  readonly tacRateMbps: number;
  readonly tacWastePct: number;
  readonly staticWastePct: number;
  readonly tacDrops: number;
  readonly staticDrops: number;
}

export interface AarPhysicsStack {
  readonly airframeShadowing: boolean;
  readonly correlatedRician: boolean;
  readonly macPhyFeedback: boolean;
  readonly transportAbr: boolean;
  readonly dubinsKinematics: boolean;
  readonly viewshedParity: boolean;
  readonly biomeEm: boolean;
  readonly eccmMode: string;
  readonly mvdrNullSteering: boolean;
  readonly acnCount: number;
  readonly manetRouting: boolean;
}

export interface AarCalibrationSummary {
  readonly verdict: string;
  readonly rmseDb: number;
  readonly pearsonR: number;
}

export interface AarMissionSnapshot {
  readonly missionTitle: string;
  readonly generatedIso: string;
  readonly biomeName: string;
  readonly simTimeS: number;
  readonly frameCount: number;
  readonly schedulerMode: string;
  readonly kpis: AarAblationKpis;
  readonly qosSlaSummary: {
    readonly overallPassPct: number;
    readonly classes: readonly AarQosClassSummary[];
  };
  readonly fleet: readonly AarFleetTerminal[];
  readonly activeModels: AarPhysicsStack;
  readonly calibrationSummary?: AarCalibrationSummary;
}

// ============================================================================
// Coordinate & Utility Helpers
// ============================================================================

/**
 * Resolves MGRS for a fleet terminal.
 * Uses explicitly provided MGRS or computes it via `geodeticToMgrs(lat, lon, 5)`.
 * Falls back to '--' if coordinates are non-finite or outside valid MGRS bounds [-80, +84].
 */
export function resolveTerminalMgrs(terminal: AarFleetTerminal): string {
  if (typeof terminal.mgrs === 'string' && terminal.mgrs.trim().length > 0) {
    return terminal.mgrs.trim();
  }
  const lat = terminal.latDeg;
  const lon = terminal.lonDeg;
  if (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -80 &&
    lat <= 84 &&
    lon >= -180 &&
    lon <= 180
  ) {
    try {
      return geodeticToMgrs(lat, lon, 5);
    } catch {
      return '--';
    }
  }
  return '--';
}

function fmtNum(val: unknown, decimals: number = 2, fallback: string = '0.00'): string {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val.toFixed(decimals);
  }
  return fallback;
}

// ============================================================================
// Markdown Briefing Generator
// ============================================================================

/**
 * Generates an executive After-Action Review (AAR) Tactical Briefing in Markdown format.
 * Pure, deterministic, zero emojis, clean tables.
 */
export function generateAarMarkdown(snapshot: AarMissionSnapshot): string {
  const kpi = snapshot.kpis;
  const qos = snapshot.qosSlaSummary;
  const models = snapshot.activeModels;
  const fleet = snapshot.fleet || [];

  const lines: string[] = [];

  lines.push(`# AFTER-ACTION REVIEW (AAR): ${snapshot.missionTitle}`);
  lines.push('');
  lines.push(`> Tactical X-Band Air-to-Ground Network Digital Twin (8.0 GHz)`);
  lines.push(`> Classification: UNCLASSIFIED // SIMULATION TELEMETRY BRIEFING`);
  lines.push('');

  // 1. Mission Metadata
  lines.push('## 1. Mission Metadata');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| :--- | :--- |');
  lines.push(`| **Mission Title** | ${snapshot.missionTitle} |`);
  lines.push(`| **Timestamp (UTC)** | ${snapshot.generatedIso} |`);
  lines.push(`| **Active Biome** | ${snapshot.biomeName} |`);
  lines.push(`| **Elapsed Sim Time** | ${fmtNum(snapshot.simTimeS, 2)} s |`);
  lines.push(`| **Processed Frames (50 Hz)** | ${Math.max(0, Math.floor(snapshot.frameCount || 0))} |`);
  lines.push(`| **Scheduler Mode** | ${snapshot.schedulerMode} |`);
  lines.push('');

  // 2. Scheduler Ablation KPIs
  const wasteSaved = Math.max(0, (kpi.staticWastePct || 0) - (kpi.tacWastePct || 0));
  const dropReduction =
    kpi.staticDrops > 0 ? Math.max(0, ((kpi.staticDrops - kpi.tacDrops) / kpi.staticDrops) * 100) : 0;

  lines.push('## 2. Scheduler Ablation KPIs (Tac-TAD vs. Static TDMA)');
  lines.push('');
  lines.push('| Metric | Tac-TAD (Dynamic) | Static TDMA (Baseline) | Comparative Delta |');
  lines.push('| :--- | :--- | :--- | :--- |');
  lines.push(
    `| **Delivered Goodput** | ${fmtNum(kpi.tacDeliveredMb, 2)} Mb | ${fmtNum(kpi.staticDeliveredMb, 2)} Mb | **+${fmtNum(kpi.throughputGainX, 2)}x Gain** |`
  );
  lines.push(`| **Effective Data Rate** | ${fmtNum(kpi.tacRateMbps, 2)} Mbps | -- | Primary Link Speed |`);
  lines.push(
    `| **Slot Waste Rate** | ${fmtNum(kpi.tacWastePct, 1)}% | ${fmtNum(kpi.staticWastePct, 1)}% | **-${fmtNum(wasteSaved, 1)}% Reclaimed** |`
  );
  lines.push(
    `| **Total Packet Drops** | ${kpi.tacDrops} packets | ${kpi.staticDrops} packets | **-${fmtNum(dropReduction, 1)}% Drops** |`
  );
  lines.push('');

  // 3. 3GPP 5QI QoS SLA Verification
  lines.push('## 3. 3GPP 5QI QoS SLA Verification');
  lines.push('');
  lines.push(`- **Overall SLA Compliance:** **${fmtNum(qos.overallPassPct, 1)}%**`);
  lines.push('');
  lines.push('| Traffic Class | 3GPP 5QI | Delay Budget | P95 Latency | SLA Status |');
  lines.push('| :--- | :--- | :--- | :--- | :--- |');
  for (const c of qos.classes) {
    const verdict = c.pass ? 'PASS' : 'FAIL';
    lines.push(
      `| ${c.name} | ${c.fiveQi} | ${fmtNum(c.budgetMs, 0)} ms | ${fmtNum(c.p95Ms, 2)} ms | **${verdict}** |`
    );
  }
  lines.push('');

  // 4. Active High-Fidelity Physics & EW Stack
  lines.push('## 4. Active High-Fidelity Physics & EW Stack');
  lines.push('');
  lines.push(`- **Airframe Shadowing (Tait-Bryan Bank/Pitch):** ${models.airframeShadowing ? '[ENABLED]' : '[DISABLED]'}`);
  lines.push(`- **Correlated Rician Fading ($K=12\\text{ dB}$):** ${models.correlatedRician ? '[ENABLED]' : '[DISABLED]'}`);
  lines.push(`- **MAC/PHY CSI Feedback Loop:** ${models.macPhyFeedback ? '[ENABLED]' : '[DISABLED]'}`);
  lines.push(`- **Transport-Layer Adaptive Bitrate (ABR):** ${models.transportAbr ? '[ENABLED]' : '[DISABLED]'}`);
  lines.push(`- **Dubins Aerodynamic Kinematics ($R_{\\min}=800\\text{ m}$):** ${models.dubinsKinematics ? '[ENABLED]' : '[DISABLED]'}`);
  lines.push(`- **Viewshed Terrain Masking (SRTM HGT 512x512):** ${models.viewshedParity ? '[ENABLED]' : '[DISABLED]'}`);
  lines.push(`- **Biome EM Ground Reflection:** ${models.biomeEm ? '[ENABLED]' : '[DISABLED]'}`);
  lines.push(`- **Electronic Protection / ECCM:** ${models.eccmMode || 'STANDBY'}`);
  lines.push(`- **MVDR Null-Steering Array:** ${models.mvdrNullSteering ? '[ENABLED]' : '[DISABLED]'}`);
  lines.push(`- **Airborne Relay Constellation:** ${models.acnCount} active ACN(s)`);
  lines.push(`- **MANET Multi-Hop Routing:** ${models.manetRouting ? '[ENABLED]' : '[DISABLED]'}`);
  lines.push('');

  // 5. Ground Fleet Registry & Positions
  lines.push('## 5. Ground Fleet Registry & Tactical Positions');
  lines.push('');
  lines.push('| Node ID | Callsign | Sector | MGRS Coordinates | MODCOD | SINR (dB) | Link State |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const t of fleet) {
    const mgrs = resolveTerminalMgrs(t);
    lines.push(
      `| ${t.nodeId} | ${t.callsign} | ${t.sector} | \`${mgrs}\` | ${t.modcod} | ${fmtNum(t.sinrDb, 1)} dB | ${t.status} |`
    );
  }
  lines.push('');

  // 6. Optional Digital Twin Calibration Certification
  if (snapshot.calibrationSummary) {
    const cal = snapshot.calibrationSummary;
    lines.push('## 6. Digital-Twin Calibration Certification');
    lines.push('');
    lines.push(`- **Calibration Verdict:** **${cal.verdict}**`);
    lines.push(`- **Residual RMSE:** ${fmtNum(cal.rmseDb, 2)} dB`);
    lines.push(`- **Pearson Correlation (r):** ${fmtNum(cal.pearsonR, 4)}`);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated by Tactical X-Band Digital Twin v1.2 — Authoritative Discrete-Event Runtime*`);

  return lines.join('\n');
}

// ============================================================================
// Standalone Air-Gap Printable HTML Generator
// ============================================================================

/**
 * Generates an executive After-Action Review (AAR) printable HTML document.
 * 100% self-contained, zero external CDN links/scripts, print-optimized,
 * with strict XSS escaping across all dynamic fields.
 */
export function generateAarPrintableHtml(snapshot: AarMissionSnapshot): string {
  const titleSafe = escapeHtml(snapshot.missionTitle);
  const isoSafe = escapeHtml(snapshot.generatedIso);
  const biomeSafe = escapeHtml(snapshot.biomeName);
  const schedSafe = escapeHtml(snapshot.schedulerMode);
  const simTimeSafe = fmtNum(snapshot.simTimeS, 2);
  const framesSafe = String(Math.max(0, Math.floor(snapshot.frameCount || 0)));

  const kpi = snapshot.kpis;
  const qos = snapshot.qosSlaSummary;
  const models = snapshot.activeModels;
  const fleet = snapshot.fleet || [];

  const wasteSaved = Math.max(0, (kpi.staticWastePct || 0) - (kpi.tacWastePct || 0));
  const dropReduction =
    kpi.staticDrops > 0 ? Math.max(0, ((kpi.staticDrops - kpi.tacDrops) / kpi.staticDrops) * 100) : 0;

  // Build 5QI QoS rows
  const qosRows = qos.classes
    .map((c) => {
      const passBadge = c.pass
        ? '<span class="badge badge-pass">PASS</span>'
        : '<span class="badge badge-fail">FAIL</span>';
      return `<tr>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td><code>5QI-${c.fiveQi}</code></td>
        <td>${fmtNum(c.budgetMs, 0)} ms</td>
        <td>${fmtNum(c.p95Ms, 2)} ms</td>
        <td>${passBadge}</td>
      </tr>`;
    })
    .join('\n');

  // Build Fleet table rows
  const fleetRows = fleet
    .map((t) => {
      const mgrsSafe = escapeHtml(resolveTerminalMgrs(t));
      const statusClass =
        t.status.toUpperCase() === 'ACTIVE' || t.status.toUpperCase() === 'OPTIMAL'
          ? 'status-optimal'
          : t.status.toUpperCase() === 'DEGRADED'
          ? 'status-degraded'
          : 'status-outage';
      return `<tr>
        <td><code>#${escapeHtml(t.nodeId)}</code></td>
        <td><strong>${escapeHtml(t.callsign)}</strong></td>
        <td>${escapeHtml(t.sector)}</td>
        <td><code class="mgrs-code">${mgrsSafe}</code></td>
        <td>${escapeHtml(t.modcod)}</td>
        <td>${fmtNum(t.sinrDb, 1)} dB</td>
        <td><span class="status-pill ${statusClass}">${escapeHtml(t.status)}</span></td>
      </tr>`;
    })
    .join('\n');

  // Calibration section HTML (if present)
  let calSectionHtml = '';
  if (snapshot.calibrationSummary) {
    const cal = snapshot.calibrationSummary;
    calSectionHtml = `
      <section class="aar-section">
        <h2>6. Digital-Twin Calibration Certification</h2>
        <div class="kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">VALIDATION VERDICT</span>
            <span class="kpi-val text-optimal">${escapeHtml(cal.verdict)}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">RESIDUAL RMSE</span>
            <span class="kpi-val">${fmtNum(cal.rmseDb, 2)} dB</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">PEARSON CORRELATION (r)</span>
            <span class="kpi-val">${fmtNum(cal.pearsonR, 4)}</span>
          </div>
        </div>
      </section>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AAR: ${titleSafe} — Tactical X-Band Digital Twin</title>
  <style>
    /* Pure, self-contained Lattice Obsidian print-optimized stylesheet (zero external CDN) */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background: #080a0d;
      color: #dce4ee;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      padding: 24px;
      max-width: 1040px;
      margin: 0 auto;
    }
    header.aar-header {
      border-bottom: 2px solid #37455a;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .aar-pre-title {
      font-size: 10.5px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #38bdf8;
      font-weight: 700;
      margin-bottom: 4px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.01em;
      margin-bottom: 6px;
    }
    .aar-subtitle {
      font-size: 11px;
      color: #9aa7b8;
    }
    .aar-section {
      margin-bottom: 28px;
    }
    h2 {
      font-size: 14px;
      font-weight: 700;
      color: #f0f4f8;
      border-bottom: 1px solid #232c3a;
      padding-bottom: 6px;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .kpi-card {
      background: #0f131a;
      border: 1px solid #232c3a;
      border-radius: 4px;
      padding: 10px 14px;
    }
    .kpi-label {
      display: block;
      font-size: 10px;
      color: #78879b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
      font-weight: 600;
    }
    .kpi-val {
      font-size: 18px;
      font-weight: 700;
      color: #ffffff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .kpi-sub {
      display: block;
      font-size: 10px;
      color: #9aa7b8;
      margin-top: 2px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
      font-size: 11.5px;
      background: #0f131a;
      border: 1px solid #232c3a;
      border-radius: 4px;
      overflow: hidden;
    }
    th, td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid #19202b;
    }
    th {
      background: #171d27;
      color: #9aa7b8;
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 600;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      background: rgba(255, 255, 255, 0.06);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .mgrs-code {
      color: #38bdf8;
    }
    .badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
      letter-spacing: 0.04em;
    }
    .badge-pass {
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
      border: 1px solid rgba(34, 197, 94, 0.4);
    }
    .badge-fail {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.4);
    }
    .status-pill {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
    }
    .status-optimal {
      color: #4ade80;
      background: rgba(34, 197, 94, 0.12);
    }
    .status-degraded {
      color: #facc15;
      background: rgba(234, 179, 8, 0.12);
    }
    .status-outage {
      color: #f87171;
      background: rgba(239, 68, 68, 0.12);
    }
    .text-optimal {
      color: #4ade80;
    }
    .model-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 6px 16px;
      background: #0f131a;
      border: 1px solid #232c3a;
      border-radius: 4px;
      padding: 12px 16px;
      list-style: none;
    }
    .model-list li {
      font-size: 11px;
      color: #dce4ee;
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
      border-bottom: 1px solid #19202b;
    }
    .print-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-bottom: 20px;
    }
    .btn-print {
      background: #38bdf8;
      color: #080a0d;
      font-weight: 700;
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
    }
    footer {
      border-top: 1px solid #232c3a;
      padding-top: 12px;
      font-size: 10px;
      color: #78879b;
      display: flex;
      justify-content: space-between;
      margin-top: 40px;
    }

    /* Print media optimization */
    @media print {
      body {
        background: #ffffff;
        color: #111827;
        padding: 0;
        max-width: 100%;
        font-size: 10pt;
      }
      .print-actions {
        display: none !important;
      }
      header.aar-header {
        border-bottom: 2pt solid #111827;
      }
      h1 {
        color: #111827;
        font-size: 16pt;
      }
      h2 {
        color: #111827;
        border-bottom: 1pt solid #9ca3af;
        font-size: 11pt;
      }
      .kpi-card, table, .model-list {
        background: #ffffff;
        border: 1pt solid #d1d5db;
      }
      .kpi-label {
        color: #4b5563;
      }
      .kpi-val {
        color: #111827;
      }
      th {
        background: #f3f4f6;
        color: #374151;
      }
      th, td {
        border-bottom: 0.5pt solid #e5e7eb;
      }
      .mgrs-code {
        color: #111827;
      }
      .badge-pass, .status-optimal {
        color: #15803d;
        background: #dcfce7;
      }
      .badge-fail, .status-outage {
        color: #b91c1c;
        background: #fee2e2;
      }
      .status-degraded {
        color: #a16207;
        background: #fef9c3;
      }
      .aar-section {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="print-actions">
    <button class="btn-print" onclick="window.print()" type="button">Print / Save as PDF</button>
  </div>

  <header class="aar-header">
    <div class="aar-pre-title">TACTICAL X-BAND AIR-TO-GROUND NETWORK DIGITAL TWIN</div>
    <h1>${titleSafe}</h1>
    <div class="aar-subtitle">Classification: UNCLASSIFIED // Simulation Telemetry After-Action Review (AAR) Briefing</div>
  </header>

  <section class="aar-section">
    <h2>1. Mission Metadata</h2>
    <table>
      <tbody>
        <tr><th style="width:25%;">Mission Title</th><td>${titleSafe}</td></tr>
        <tr><th>Timestamp (UTC)</th><td>${isoSafe}</td></tr>
        <tr><th>Active Biome</th><td>${biomeSafe}</td></tr>
        <tr><th>Elapsed Sim Time</th><td>${simTimeSafe} s</td></tr>
        <tr><th>Processed Frames (50 Hz)</th><td>${framesSafe}</td></tr>
        <tr><th>Scheduler Mode</th><td>${schedSafe}</td></tr>
      </tbody>
    </table>
  </section>

  <section class="aar-section">
    <h2>2. Scheduler Ablation KPIs (Tac-TAD vs. Static TDMA)</h2>
    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">TAC DELIVERED GOODPUT</span>
        <span class="kpi-val">${fmtNum(kpi.tacDeliveredMb, 2)} Mb</span>
        <span class="kpi-sub">+${fmtNum(kpi.throughputGainX, 2)}x vs. Static (${fmtNum(kpi.staticDeliveredMb, 2)} Mb)</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">EFFECTIVE DATA RATE</span>
        <span class="kpi-val">${fmtNum(kpi.tacRateMbps, 2)} Mbps</span>
        <span class="kpi-sub">50 Hz discrete-event pipeline</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">SLOT WASTE RECLAIMED</span>
        <span class="kpi-val text-optimal">-${fmtNum(wasteSaved, 1)}%</span>
        <span class="kpi-sub">Tac: ${fmtNum(kpi.tacWastePct, 1)}% vs. Static: ${fmtNum(kpi.staticWastePct, 1)}%</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">PACKET DROP REDUCTION</span>
        <span class="kpi-val text-optimal">-${fmtNum(dropReduction, 1)}%</span>
        <span class="kpi-sub">Tac: ${kpi.tacDrops} vs. Static: ${kpi.staticDrops} drops</span>
      </div>
    </div>
  </section>

  <section class="aar-section">
    <h2>3. 3GPP 5QI QoS SLA Verification</h2>
    <div style="margin-bottom:10px;">
      <strong>Overall SLA Pass Rate:</strong> <span class="badge badge-pass">${fmtNum(qos.overallPassPct, 1)}%</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Traffic Class</th>
          <th>3GPP 5QI</th>
          <th>Delay Budget</th>
          <th>P95 Latency</th>
          <th>SLA Status</th>
        </tr>
      </thead>
      <tbody>
        ${qosRows}
      </tbody>
    </table>
  </section>

  <section class="aar-section">
    <h2>4. Active High-Fidelity Physics & EW Stack</h2>
    <ul class="model-list">
      <li><span>Airframe Shadowing (Tait-Bryan)</span><strong>${models.airframeShadowing ? 'ENABLED' : 'DISABLED'}</strong></li>
      <li><span>Correlated Rician Fading (K=12 dB)</span><strong>${models.correlatedRician ? 'ENABLED' : 'DISABLED'}</strong></li>
      <li><span>MAC/PHY CSI Feedback Loop</span><strong>${models.macPhyFeedback ? 'ENABLED' : 'DISABLED'}</strong></li>
      <li><span>Transport-Layer Adaptive Bitrate</span><strong>${models.transportAbr ? 'ENABLED' : 'DISABLED'}</strong></li>
      <li><span>Dubins Aerodynamics (Rmin=800m)</span><strong>${models.dubinsKinematics ? 'ENABLED' : 'DISABLED'}</strong></li>
      <li><span>Viewshed Terrain Masking (SRTM 512x512)</span><strong>${models.viewshedParity ? 'ENABLED' : 'DISABLED'}</strong></li>
      <li><span>Biome EM Ground Reflection</span><strong>${models.biomeEm ? 'ENABLED' : 'DISABLED'}</strong></li>
      <li><span>Electronic Protection / ECCM</span><strong>${escapeHtml(models.eccmMode || 'STANDBY')}</strong></li>
      <li><span>MVDR Null-Steering Array</span><strong>${models.mvdrNullSteering ? 'ENABLED' : 'DISABLED'}</strong></li>
      <li><span>Airborne Relay Constellation</span><strong>${models.acnCount} ACN(s)</strong></li>
      <li><span>MANET Multi-Hop Routing</span><strong>${models.manetRouting ? 'ENABLED' : 'DISABLED'}</strong></li>
    </ul>
  </section>

  <section class="aar-section">
    <h2>5. Ground Fleet Registry & Tactical Positions</h2>
    <table>
      <thead>
        <tr>
          <th>Node ID</th>
          <th>Callsign</th>
          <th>Sector</th>
          <th>MGRS Coordinates</th>
          <th>MODCOD</th>
          <th>SINR</th>
          <th>Link State</th>
        </tr>
      </thead>
      <tbody>
        ${fleetRows}
      </tbody>
    </table>
  </section>

  ${calSectionHtml}

  <footer>
    <span>Generated by Tactical X-Band Digital Twin v1.2 — Authoritative Discrete-Event Runtime</span>
    <span>Classification: UNCLASSIFIED</span>
  </footer>
</body>
</html>`;
}
