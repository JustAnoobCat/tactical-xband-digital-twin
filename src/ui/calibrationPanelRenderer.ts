/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Digital-Twin Calibration Panel & HiDPI Dual-Trace Scope Renderer (V3-05)
 *
 * Renders high-fidelity Sim-vs-Measured dual-trace scope using getLatticeCanvasPalette()
 * for CVD-safe tactical styling, shaded residual discrepancy fill, and accessible readouts.
 */

import { getLatticeCanvasPalette, type CanvasCvdMode } from './canvasTheme';
import { escapeHtml, sanitizeLabel } from './domSafety';
import type { TwinEvaluationReport, CalibrationPointSeries } from '../core/digitalTwinCalibrationEngine';

const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

/**
 * Draws the high-DPI dual-trace calibration scope comparing Measured empirical SNR vs
 * Digital-Twin predicted SNR with shaded residual disparity.
 */
export function drawTwinCalibrationScope(
  canvas: HTMLCanvasElement,
  report: TwinEvaluationReport | null,
  cvdMode?: CanvasCvdMode
): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 190;

  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  const palette = getLatticeCanvasPalette(cvdMode);

  // Background
  ctx.fillStyle = palette.voidBg;
  ctx.fillRect(0, 0, w, h);

  const padLeft = 45;
  const padRight = 16;
  const padTop = 24;
  const padBottom = 26;

  const plotW = Math.max(10, w - padLeft - padRight);
  const plotH = Math.max(10, h - padTop - padBottom);

  if (!report || report.points.length === 0) {
    ctx.fillStyle = palette.gridMajor;
    ctx.strokeRect(padLeft, padTop, plotW, plotH);

    ctx.font = `500 11px ${MONO_FONT}`;
    ctx.fillStyle = palette.textMuted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NO FLIGHT-TEST TRACE LOADED · SELECT PRESET OR UPLOAD CSV', padLeft + plotW / 2, padTop + plotH / 2);
    ctx.restore();
    return;
  }

  const pts = report.points;

  // Determine Y-axis range (SNR dB)
  let minSnr = -10.0;
  let maxSnr = 30.0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (Number.isFinite(p.measuredSnrDb)) {
      minSnr = Math.min(minSnr, p.measuredSnrDb);
      maxSnr = Math.max(maxSnr, p.measuredSnrDb);
    }
    if (Number.isFinite(p.predictedSnrDb)) {
      minSnr = Math.min(minSnr, p.predictedSnrDb);
      maxSnr = Math.max(maxSnr, p.predictedSnrDb);
    }
  }

  // Round Y range to 5 dB increments
  minSnr = Math.floor((minSnr - 2) / 5) * 5;
  maxSnr = Math.ceil((maxSnr + 2) / 5) * 5;
  if (maxSnr - minSnr < 15) maxSnr = minSnr + 20;

  const minT = pts[0].timeS;
  const maxT = Math.max(minT + 1, pts[pts.length - 1].timeS);

  const toX = (t: number) => padLeft + ((t - minT) / (maxT - minT)) * plotW;
  const toY = (snr: number) => padTop + plotH - ((snr - minSnr) / (maxSnr - minSnr)) * plotH;

  // Grid lines
  ctx.lineWidth = 1;
  ctx.font = `500 10px ${MONO_FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const yStep = (maxSnr - minSnr) > 35 ? 10 : 5;
  for (let s = minSnr; s <= maxSnr; s += yStep) {
    const y = toY(s);
    ctx.strokeStyle = palette.gridMinor;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();

    ctx.fillStyle = palette.textMuted;
    ctx.fillText(`${s} dB`, padLeft - 6, y);
  }

  // Outage threshold line at -1.5 dB
  if (minSnr <= -1.5 && maxSnr >= -1.5) {
    const outageY = toY(-1.5);
    ctx.strokeStyle = palette.outage;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(padLeft, outageY);
    ctx.lineTo(padLeft + plotW, outageY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = palette.outage;
    ctx.font = `600 10px ${MONO_FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText('-1.5 dB OUTAGE', padLeft + plotW - 4, outageY - 6);
  }

  // Time X-axis ticks
  ctx.font = `500 10px ${MONO_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = palette.textMuted;

  const tStep = Math.max(1, Math.round((maxT - minT) / 5));
  for (let t = Math.ceil(minT); t <= maxT; t += tStep) {
    const x = toX(t);
    ctx.strokeStyle = palette.gridMinor;
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, padTop + plotH);
    ctx.stroke();
    ctx.fillText(`${t}s`, x, padTop + plotH + 5);
  }

  // 1. Shaded residual disparity polygon between Measured and Predicted curves
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = toX(pts[i].timeS);
    const y = toY(pts[i].measuredSnrDb);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const x = toX(pts[i].timeS);
    const y = toY(pts[i].predictedSnrDb);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(239, 68, 68, 0.12)'; // Subtle disparity fill
  ctx.fill();

  // 2. Measured empirical SNR trace (amber / degraded solid polyline)
  ctx.strokeStyle = palette.degraded;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = toX(pts[i].timeS);
    const y = toY(pts[i].measuredSnrDb);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 3. Digital-Twin predicted SNR trace (cyan / accent solid polyline)
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = toX(pts[i].timeS);
    const y = toY(pts[i].predictedSnrDb);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Plot border
  ctx.strokeStyle = palette.gridMajor;
  ctx.lineWidth = 1;
  ctx.strokeRect(padLeft, padTop, plotW, plotH);

  // Top legend strip
  const legY = 12;
  ctx.font = `700 10px ${MONO_FONT}`;
  ctx.textBaseline = 'middle';

  // Measured marker
  ctx.fillStyle = palette.degraded;
  ctx.fillRect(padLeft, legY - 3, 12, 6);
  ctx.fillStyle = palette.textPrimary;
  ctx.textAlign = 'left';
  ctx.fillText('MEASURED TRACE', padLeft + 16, legY);

  // Twin Predicted marker
  const offTwin = padLeft + 125;
  ctx.fillStyle = palette.accent;
  ctx.fillRect(offTwin, legY - 3, 12, 6);
  ctx.fillStyle = palette.textPrimary;
  ctx.fillText('TWIN PREDICTED', offTwin + 16, legY);

  // RMSE & Verdict marker
  const offRmse = offTwin + 130;
  const isCertified = report.verdict === 'CERTIFIED_TWIN';
  ctx.fillStyle = isCertified ? palette.optimal : (report.verdict === 'CALIBRATED' ? palette.accent : palette.outage);
  ctx.textAlign = 'left';
  ctx.fillText(`RMSE: ${report.rmseDb.toFixed(2)} dB | BIAS: ${report.meanBiasDb >= 0 ? '+' : ''}${report.meanBiasDb.toFixed(2)} dB | [${report.verdict}]`, offRmse, legY);

  ctx.restore();
}

/**
 * Generates formatted text snippets for the DOM metric tiles.
 */
export function formatCalibrationKpiText(report: TwinEvaluationReport | null): {
  rmse: string;
  mae: string;
  bias: string;
  pearson: string;
  outageAcc: string;
  trims: string;
} {
  if (!report) {
    return {
      rmse: '-- dB',
      mae: '-- dB',
      bias: '-- dB',
      pearson: '--',
      outageAcc: '--%',
      trims: 'Trim: 0.0 dB · Diff: 1.0x',
    };
  }

  const p = report.params;
  const trimStr = `${p.systemLossTrimDb >= 0 ? '+' : ''}${p.systemLossTrimDb.toFixed(1)} dB`;
  const diffStr = `${p.diffractionScale.toFixed(2)}x`;

  return {
    rmse: `${report.rmseDb.toFixed(2)} dB`,
    mae: `${report.maeDb.toFixed(2)} dB`,
    bias: `${report.meanBiasDb >= 0 ? '+' : ''}${report.meanBiasDb.toFixed(2)} dB`,
    pearson: `r = ${report.pearsonR.toFixed(3)} (R2: ${report.rSquared.toFixed(3)})`,
    outageAcc: `${(report.outageMatrix.accuracy * 100).toFixed(1)}% (F1: ${report.outageMatrix.f1Score.toFixed(3)})`,
    trims: `Trim: ${trimStr} · Diff: ${diffStr}`,
  };
}
