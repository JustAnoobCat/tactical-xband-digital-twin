/**
 * Highland Instrument — Engineering Graph Polish & Calibration Utilities
 *
 * Provides calibrated axis ticks with explicit units, DVB-S2X / Fresnel threshold
 * reference lines, and non-destructive interactive hover crosshairs.
 */

import { HIGHLAND_THEME } from './chartTheme';

export interface PlotBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface HoverRow {
  readonly label: string;
  readonly valueText: string;
  readonly color: string;
}

export interface ChartHoverState {
  readonly active: boolean;
  readonly cssX: number;
  readonly cssY: number;
}

export function niceAxisStep(span: number, targetTicks = 5): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(1, targetTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  if (norm < 1.5) return 1 * mag;
  if (norm < 3) return 2 * mag;
  if (norm < 7) return 5 * mag;
  return 10 * mag;
}

export function computeNiceTicks(minVal: number, maxVal: number, targetTicks = 4): number[] {
  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal) || maxVal <= minVal) {
    return [minVal];
  }
  const step = niceAxisStep(maxVal - minVal, targetTicks);
  const start = Math.ceil((minVal - 1e-9) / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= maxVal + step * 1e-4; v += step) {
    const clean = Math.abs(v) < step * 1e-6 ? 0 : Number(v.toFixed(6));
    ticks.push(clean);
    if (ticks.length > 16) break;
  }
  if (ticks.length < 2) {
    return [minVal, (minVal + maxVal) / 2, maxVal];
  }
  return ticks;
}

export function drawThresholdLine(
  ctx: CanvasRenderingContext2D,
  box: PlotBox,
  y: number,
  label: string,
  color: string,
  dash: readonly number[] = [4, 4]
): void {
  if (!Number.isFinite(y) || y < box.top + 2 || y > box.bottom - 2) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = 1;
  ctx.setLineDash([...dash]);
  ctx.beginPath();
  ctx.moveTo(box.left, Math.round(y) + 0.5);
  ctx.lineTo(box.right, Math.round(y) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 1.0;
  ctx.font = `600 9px ${HIGHLAND_THEME.font.mono}`;
  const tw = ctx.measureText(label).width;
  const pillW = tw + 8;
  const pillH = 13;
  const pillX = Math.max(box.left + 4, box.right - pillW - 4);
  const pillY = Math.max(box.top + 2, y - pillH - 2);

  ctx.fillStyle = HIGHLAND_THEME.substrate.hudFill;
  ctx.fillRect(pillX, pillY, pillW, pillH);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.strokeRect(pillX, pillY, pillW, pillH);

  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, pillX + 4, pillY + pillH / 2 + 0.5);
  ctx.restore();
}

export function drawChartHoverCrosshair(
  ctx: CanvasRenderingContext2D,
  box: PlotBox,
  hoverX: number,
  headerText: string,
  rows: readonly HoverRow[]
): void {
  if (!Number.isFinite(hoverX) || hoverX < box.left || hoverX > box.right) return;
  if (rows.length === 0) return;

  ctx.save();
  const xPx = Math.round(hoverX) + 0.5;
  ctx.strokeStyle = HIGHLAND_THEME.signal.amber;
  ctx.globalAlpha = 0.78;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(xPx, box.top);
  ctx.lineTo(xPx, box.bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 1;
  ctx.font = `600 9.5px ${HIGHLAND_THEME.font.mono}`;
  let maxTextW = ctx.measureText(headerText).width;
  for (const r of rows) {
    const lineW = ctx.measureText(`${r.label}: ${r.valueText}`).width + 12;
    if (lineW > maxTextW) maxTextW = lineW;
  }

  const lineH = 14;
  const padX = 8;
  const padY = 6;
  const cardW = Math.min(box.right - box.left - 8, maxTextW + padX * 2);
  const cardH = padY * 2 + (1 + rows.length) * lineH;

  let cardX = hoverX + 10;
  if (cardX + cardW > box.right - 4) {
    cardX = hoverX - cardW - 10;
  }
  cardX = Math.max(box.left + 4, Math.min(box.right - cardW - 4, cardX));
  const cardY = box.top + 4;

  ctx.fillStyle = HIGHLAND_THEME.substrate.hudFill;
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.strokeStyle = HIGHLAND_THEME.line.strong;
  ctx.lineWidth = 1;
  ctx.strokeRect(cardX, cardY, cardW, cardH);

  ctx.fillStyle = HIGHLAND_THEME.text.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(headerText, cardX + padX, cardY + padY + lineH * 0.5);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ry = cardY + padY + (i + 1.5) * lineH;
    ctx.fillStyle = row.color;
    ctx.fillRect(cardX + padX, ry - 3, 6, 6);
    ctx.fillStyle = HIGHLAND_THEME.text.primary;
    ctx.font = `10px ${HIGHLAND_THEME.font.mono}`;
    ctx.fillText(`${row.label}: ${row.valueText}`, cardX + padX + 10, ry);
  }

  ctx.restore();
}

const HOVER_STATE_MAP = new WeakMap<HTMLCanvasElement, ChartHoverState>();

export function getCanvasHoverState(canvas: HTMLCanvasElement | null | undefined): ChartHoverState {
  if (!canvas) return { active: false, cssX: -1, cssY: -1 };
  return HOVER_STATE_MAP.get(canvas) ?? { active: false, cssX: -1, cssY: -1 };
}

export function bindChartHoverCrosshair(
  canvas: HTMLCanvasElement | null | undefined,
  onHoverChange: () => void
): void {
  if (!canvas || canvas.dataset.hiHoverBound === '1') return;
  canvas.dataset.hiHoverBound = '1';

  canvas.addEventListener('mousemove', (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    HOVER_STATE_MAP.set(canvas, {
      active: true,
      cssX: event.clientX - rect.left,
      cssY: event.clientY - rect.top,
    });
    onHoverChange();
  });

  canvas.addEventListener('mouseleave', () => {
    HOVER_STATE_MAP.set(canvas, { active: false, cssX: -1, cssY: -1 });
    onHoverChange();
  });
}
