/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Simulation Timeline Canvas Renderer (DRDO-TAC-XBAND-ARCH-TIMELINE-17)
 *
 * Implements a high-performance, High-DPI Canvas 2D timeline visualizer:
 * - High-DPI canvas backing scaling with automatic devicePixelRatio compensation.
 * - Invertible coordinate projections between simulation time (s) and pixel coordinates (px).
 * - Interactive timeline navigation: smooth zoomAt(), panByPixels(), and seekTo().
 * - Track 1: Simulation-Time Ruler & Status Ribbon with calibrated intervals and sequence gap markers.
 * - Track 2: Dual-Scheduler Communication Track (Static TDMA vs. Tac-TAD) with stacked goodput/outage/drop bars.
 * - Track 3: Spatial Kinematics & Node Inventory sparkline.
 * - Full-height playhead needle with Live (sage) and Historical (amber) states.
 * - Adaptive LOD columnar binning for smooth 60 FPS rendering under dense epoch histories.
 * - Visibly unavailable communication history detection (zero fabricated data).
 * - 100% Canvas 2D with zero DOM element overhead.
 */

import { syncCanvasDpr } from './pathProfileTopView';
import type { SpatialSnapshotBuffer, SpatialDiscontinuityEvent } from './spatialSnapshotBuffer';
import type { SuperframeEpochStore } from './superframeEpochStore';
import type {
  TimelineCommunicationRecord,
  SuperframeEpochRecord,
  SuperframeDiscontinuityRecord,
  EvictionDropFinalizationRecord,
} from '../shared/workerProtocol';
import { HIGHLAND_THEME } from './workbench/chartTheme';
import { scanTimelineEvents, type TimelineEventMarker } from './timelineEventScanner';

export interface SimulationTimelineRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly spatialBuffer: SpatialSnapshotBuffer;
  readonly epochStore: SuperframeEpochStore;
  readonly dpr?: number;
  readonly viewDurationS?: number;
  readonly isLive?: boolean;
  readonly activeSchedulerMode?: 'tac_tad' | 'static';
  readonly onSeek?: (timeS: number, isLive: boolean) => void;
  readonly onHover?: (timeS: number | null) => void;
  readonly width?: number;
  readonly height?: number;
}

export interface TimelineColumnBin {
  pixelX: number;
  staticTxBytes: number;
  staticOutageBytes: number;
  staticDropBytes: number;
  tacTxBytes: number;
  tacOutageBytes: number;
  tacDropBytes: number;
  recordCount: number;
}

export class SimulationTimelineRenderer {
  public readonly canvas: HTMLCanvasElement;
  public readonly spatialBuffer: SpatialSnapshotBuffer;
  public readonly epochStore: SuperframeEpochStore;
  public readonly options: SimulationTimelineRendererOptions;
  public ctx: CanvasRenderingContext2D | null;

  // Viewport State
  public viewStartTimeS: number = 0.0;
  public viewDurationS: number = 20.0; // clamped between 1.0s and 60.0s
  public playheadTimeS: number = 0.0;
  public isLive: boolean = true;
  public activeSchedulerMode: 'tac_tad' | 'static' = 'tac_tad';
  public hoveredTimeS: number | null = null;

  // Canvas Dimensions
  public cssWidth: number = 800;
  public cssHeight: number = 130;
  public dpr: number = 1.0;

  // Interaction State
  private isDragging: boolean = false;
  private boundOnMouseDown: ((e: MouseEvent) => void) | null = null;
  private boundOnMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundOnMouseUp: ((e: MouseEvent) => void) | null = null;
  private boundOnMouseLeave: ((e: MouseEvent) => void) | null = null;
  private boundOnWheel: ((e: WheelEvent) => void) | null = null;

  constructor(options: SimulationTimelineRendererOptions) {
    this.options = options;
    this.canvas = options.canvas;
    this.spatialBuffer = options.spatialBuffer;
    this.epochStore = options.epochStore;
    this.ctx = typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;

    if (typeof options.viewDurationS === 'number' && Number.isFinite(options.viewDurationS)) {
      this.viewDurationS = Math.max(1.0, Math.min(60.0, options.viewDurationS));
    }
    if (typeof options.isLive === 'boolean') {
      this.isLive = options.isLive;
    }
    if (options.activeSchedulerMode) {
      this.activeSchedulerMode = options.activeSchedulerMode;
    }

    this.cssWidth = options.width ?? (this.canvas.clientWidth > 0 ? this.canvas.clientWidth : (this.canvas.width > 0 ? this.canvas.width : 800));
    this.cssHeight = options.height ?? (this.canvas.clientHeight > 0 ? this.canvas.clientHeight : (this.canvas.height > 0 ? this.canvas.height : 130));
    this.dpr = options.dpr ?? (typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1.0);

    this.syncCanvas();
  }

  /**
   * Synchronizes backing canvas resolution with DPR and CSS dimensions.
   */
  public syncCanvas(): { cssWidth: number; cssHeight: number; dpr: number; isVisible: boolean } {
    const res = syncCanvasDpr(this.canvas, this.ctx, {
      dpr: this.options.dpr ?? (typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1.0),
      cssWidth: this.options.width,
      cssHeight: this.options.height,
    });

    if (res.isVisible) {
      this.cssWidth = res.cssWidth;
      this.cssHeight = res.cssHeight;
      this.dpr = res.dpr;
    }
    return res;
  }

  /**
   * Resizes the backing canvas to its current container and redraws immediately.
   */
  public resize(): void {
    this.syncCanvas();
    this.render();
  }

  // ==========================================================================
  // Coordinate Projections
  // ==========================================================================

  /**
   * Projects simulation time (s) to canvas horizontal pixel coordinate (px).
   */
  public timeToX(timeS: number): number {
    const w = this.cssWidth > 0 ? this.cssWidth : 800;
    return ((timeS - this.viewStartTimeS) / this.viewDurationS) * w;
  }

  /**
   * Inverts canvas horizontal pixel coordinate (px) back to simulation time (s).
   */
  public xToTime(x: number): number {
    const w = this.cssWidth > 0 ? this.cssWidth : 800;
    return this.viewStartTimeS + (x / w) * this.viewDurationS;
  }

  /**
   * Sets the visible time window, clamping duration to [1.0s, 60.0s].
   */
  public setTimeWindow(startS: number, durationS: number): void {
    this.viewDurationS = Math.max(1.0, Math.min(60.0, durationS));
    this.viewStartTimeS = startS;
  }

  /**
   * Zooms timeline centered around focusX pixel position, clamping duration to [1.0s, 60.0s].
   * In LIVE follow mode, always anchors zoom to the center needle position (W_css / 2).
   */
  public zoomAt(focusX: number, zoomFactor: number): void {
    const w = this.cssWidth > 0 ? this.cssWidth : 800;
    const oldDurationS = this.viewDurationS;
    const newDurationS = Math.max(1.0, Math.min(60.0, oldDurationS * zoomFactor));

    if (this.isLive && this.spatialBuffer.count > 0) {
      this.viewDurationS = newDurationS;
      this.viewStartTimeS = this.playheadTimeS - newDurationS / 2;
      return;
    }

    const focusTimeS = this.xToTime(focusX);
    const fraction = Math.max(0, Math.min(1, focusX / w));
    this.viewStartTimeS = focusTimeS - fraction * newDurationS;
    this.viewDurationS = newDurationS;
  }

  /**
   * Pans timeline view by delta horizontal pixels.
   */
  public panByPixels(dxPixels: number): void {
    const w = this.cssWidth > 0 ? this.cssWidth : 800;
    const dt = (-dxPixels / w) * this.viewDurationS;
    this.viewStartTimeS += dt;
  }

  /**
   * Seeks playhead to requested simulation timestamp, clamping to available buffer range.
   */
  public seekTo(timeS: number, isLive: boolean = false): void {
    if (this.spatialBuffer.count > 0) {
      const oldest = this.spatialBuffer.oldestSnapshot;
      const newest = this.spatialBuffer.newestSnapshot;
      if (oldest && newest) {
        timeS = Math.max(oldest.simulationTimeS, Math.min(newest.simulationTimeS, timeS));
      }
    } else {
      timeS = Math.max(0, timeS);
    }

    this.playheadTimeS = timeS;
    this.isLive = isLive;

    if (this.isLive && this.spatialBuffer.count > 0) {
      const newest = this.spatialBuffer.newestSnapshot;
      if (newest) {
        this.playheadTimeS = newest.simulationTimeS;
      }
    }

    if (this.isLive) {
      this.viewStartTimeS = this.playheadTimeS - this.viewDurationS / 2;
    }

    this.options.onSeek?.(this.playheadTimeS, this.isLive);
  }

  /**
   * Enables or disables live tracking mode.
   */
  public setLive(isLive: boolean): void {
    this.isLive = isLive;
    if (isLive && this.spatialBuffer.count > 0) {
      const newest = this.spatialBuffer.newestSnapshot;
      if (newest) {
        this.playheadTimeS = newest.simulationTimeS;
        this.viewStartTimeS = this.playheadTimeS - this.viewDurationS / 2;
      }
    }
    this.options.onSeek?.(this.playheadTimeS, this.isLive);
  }

  // ==========================================================================
  // Adaptive LOD Columnar Binning
  // ==========================================================================

  /**
   * Aggregates dense communication epoch records into pixel-column bins.
   * Guarantees exact byte conservation and bounded rendering time.
   */
  public aggregateEpochsIntoBins(
    records: readonly TimelineCommunicationRecord[],
    width?: number
  ): Map<number, TimelineColumnBin> {
    const bins = new Map<number, TimelineColumnBin>();
    const w = (typeof width === 'number' && width > 0) ? width : (this.cssWidth > 0 ? this.cssWidth : 800);

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (rec.recordType !== 'EPOCH') continue;
      const ep = rec as SuperframeEpochRecord;
      const midT = (ep.startTimeS + ep.endTimeS) * 0.5;
      const px = Math.floor(((midT - this.viewStartTimeS) / this.viewDurationS) * w);
      if (px < 0 || px >= w) continue;

      let bin = bins.get(px);
      if (!bin) {
        bin = {
          pixelX: px,
          staticTxBytes: 0,
          staticOutageBytes: 0,
          staticDropBytes: 0,
          tacTxBytes: 0,
          tacOutageBytes: 0,
          tacDropBytes: 0,
          recordCount: 0,
        };
        bins.set(px, bin);
      }

      bin.staticTxBytes += ep.staticMetrics.transmittedNonOutageBits / 8;
      bin.staticOutageBytes += ep.staticMetrics.outageWastedBits / 8;
      bin.staticDropBytes += ep.staticMetrics.totalDroppedBytes ?? (ep.staticMetrics.totalDroppedPkts * 1500);

      bin.tacTxBytes += ep.tacMetrics.transmittedNonOutageBits / 8;
      bin.tacOutageBytes += ep.tacMetrics.outageWastedBits / 8;
      bin.tacDropBytes += ep.tacMetrics.totalDroppedBytes ?? (ep.tacMetrics.totalDroppedPkts * 1500);

      bin.recordCount++;
    }

    return bins;
  }

  /**
   * Aggregates retained point eviction finalizations into isolated pixel-column slices.
   * Never mutates or merges into epoch bins.
   */
  public aggregateEvictionsIntoBins(
    evictions: readonly EvictionDropFinalizationRecord[],
    width?: number
  ): { pixelX: number; schedulerId: 'STATIC_TDMA' | 'TAC_TAD'; totalDroppedBytes: number; count: number }[] {
    const w = (typeof width === 'number' && width > 0) ? width : (this.cssWidth > 0 ? this.cssWidth : 800);
    const byKey = new Map<string, { pixelX: number; schedulerId: 'STATIC_TDMA' | 'TAC_TAD'; totalDroppedBytes: number; count: number }>();

    for (let i = 0; i < evictions.length; i++) {
      const ev = evictions[i];
      const px = Math.floor(((ev.timestampS - this.viewStartTimeS) / this.viewDurationS) * w);
      if (px < 0 || px >= w) continue;
      const key = `${px}:${ev.schedulerId}`;
      let bin = byKey.get(key);
      if (!bin) {
        bin = {
          pixelX: px,
          schedulerId: ev.schedulerId,
          totalDroppedBytes: 0,
          count: 0,
        };
        byKey.set(key, bin);
      }
      bin.totalDroppedBytes += ev.totalDroppedBytes;
      bin.count++;
    }

    return Array.from(byKey.values());
  }

  // ==========================================================================
  // Canvas 2D Rendering
  // ==========================================================================

  public render(): void {
    const syncRes = this.syncCanvas();
    if (!syncRes.isVisible) return;
    const ctx = this.ctx ?? this.canvas.getContext('2d');
    if (!ctx) return;

    const w = this.cssWidth;
    const h = this.cssHeight;

    // Clear canvas
    ctx.clearRect(0, 0, w, h);

    // Background fill
    ctx.fillStyle = HIGHLAND_THEME.substrate.void;
    ctx.fillRect(0, 0, w, h);

    // If live, follow newest time
    if (this.isLive && this.spatialBuffer.count > 0) {
      this.playheadTimeS = this.spatialBuffer.newestSimulationTimeS;
      this.viewStartTimeS = this.playheadTimeS - this.viewDurationS / 2;
    }

    // Partition layout heights dynamically across timeline resize bounds
    const rulerH = h >= 72 ? 24 : Math.max(18, Math.floor(h * 0.34));
    const sparkH = h >= 72 ? Math.min(20, Math.max(16, Math.round(h * 0.14))) : Math.max(14, Math.floor(h * 0.24));
    const commH = Math.max(18, h - rulerH - sparkH);

    // 1. Render Track 1: Time Ruler & Status Ribbon
    this.renderRuler(ctx, 0, 0, w, rulerH);

    // 1.5 Render Physical Event Markers
    this.renderEventMarkers(ctx, 0, 0, w, rulerH);

    // 2. Render Track 2: Dual-Scheduler Communication Track
    this.renderCommunicationTrack(ctx, 0, rulerH, w, commH);

    // 3. Render Track 3: Spatial Kinematics & Node Inventory
    if (sparkH >= 12) {
      this.renderSpatialRibbon(ctx, 0, rulerH + commH, w, sparkH);
    }

    // 3.5 Render Future Lookahead Grid (t > t_newest)
    const tNewest = this.spatialBuffer.count > 0 ? this.spatialBuffer.newestSimulationTimeS : this.playheadTimeS;
    if (this.isLive || tNewest < this.viewStartTimeS + this.viewDurationS) {
      const xFuture = this.timeToX(tNewest);
      if (xFuture < w) {
        this.renderFutureLookahead(ctx, Math.max(0, xFuture), 0, w - Math.max(0, xFuture), h, rulerH);
      }
    }

    // 4. Render Playhead Needle Overlay
    this.renderPlayhead(ctx, w, h);
  }

  private renderFutureLookahead(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    w: number,
    h: number,
    rulerH: number
  ): void {
    if (w <= 0 || h <= 0) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(x0, y0, w, h);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    if (typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([3, 3]);
    }
    const step = 40;
    const startX = Math.ceil(x0 / step) * step;
    ctx.beginPath();
    for (let x = startX; x < x0 + w; x += step) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + h);
    }
    ctx.stroke();
    if (typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([]);
    }

    if (w >= 110 && h >= rulerH + 26) {
      const totalW = x0 + w;
      const px = this.timeToX(this.playheadTimeS);
      const collidesRightBadge = px >= totalW - 84;
      const shiftOrSkip = collidesRightBadge || px >= totalW - 120;
      const labelY = y0 + rulerH + (shiftOrSkip ? 30 : 10);
      if (labelY + 10 <= y0 + h) {
        ctx.fillStyle = 'rgba(173, 181, 189, 0.40)';
        ctx.font = `8px ${HIGHLAND_THEME.font.mono}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('LOOKAHEAD HORIZON', x0 + w - 8, labelY);
      }
    }
    ctx.restore();
  }

  private renderRuler(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
    ctx.save();
    ctx.fillStyle = HIGHLAND_THEME.substrate.surface;
    ctx.fillRect(x0, y0, w, h);

    // Bottom border line
    ctx.strokeStyle = HIGHLAND_THEME.line.frame;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + h - 0.5);
    ctx.lineTo(x0 + w, y0 + h - 0.5);
    ctx.stroke();

    // Select nice tick intervals
    let majorInterval = 1.0;
    let minorInterval = 0.2;
    if (this.viewDurationS <= 2.0) {
      majorInterval = 0.5;
      minorInterval = 0.1;
    } else if (this.viewDurationS <= 5.0) {
      majorInterval = 1.0;
      minorInterval = 0.2;
    } else if (this.viewDurationS <= 10.0) {
      majorInterval = 2.0;
      minorInterval = 0.5;
    } else if (this.viewDurationS <= 25.0) {
      majorInterval = 5.0;
      minorInterval = 1.0;
    } else {
      majorInterval = 10.0;
      minorInterval = 2.0;
    }

    const tStart = this.viewStartTimeS;
    const tEnd = this.viewStartTimeS + this.viewDurationS;

    const firstMinor = Math.floor(tStart / minorInterval) * minorInterval;
    ctx.fillStyle = HIGHLAND_THEME.text.muted;
    ctx.font = `10px ${HIGHLAND_THEME.font.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Draw ticks
    for (let t = firstMinor; t <= tEnd + minorInterval; t += minorInterval) {
      const px = this.timeToX(t);
      if (px < x0 || px > x0 + w) continue;

      const isMajor = Math.abs(t / majorInterval - Math.round(t / majorInterval)) < 1e-4;
      const tickH = isMajor ? 8 : 4;

      ctx.strokeStyle = isMajor ? HIGHLAND_THEME.text.faint : HIGHLAND_THEME.line.rulerTick;
      ctx.beginPath();
      ctx.moveTo(px, y0 + h - tickH);
      ctx.lineTo(px, y0 + h);
      ctx.stroke();

      if (isMajor && px > x0 + 30 && px < x0 + w - 90) {
        ctx.fillText(`${t.toFixed(1)}s`, px, y0 + 3);
      }
    }

    // Sequence gap bands
    if (this.spatialBuffer.discontinuities.length > 0) {
      for (const d of this.spatialBuffer.discontinuities) {
        const gapStartT = d.missingStartFrame * 0.020;
        const gapEndT = (d.missingEndFrame + 1) * 0.020;
        const gx1 = Math.max(0, this.timeToX(gapStartT));
        const gx2 = Math.min(w, this.timeToX(gapEndT));
        const gw = Math.max(2, gx2 - gx1);

        if (gx2 > 0 && gx1 < w) {
          ctx.fillStyle = HIGHLAND_THEME.signal.ochreSoft;
          ctx.fillRect(gx1, y0, gw, h);
          ctx.strokeStyle = HIGHLAND_THEME.signal.ochre;
          ctx.strokeRect(gx1, y0, gw, h);
        }
      }
    }

    // Status Badge (LIVE vs HISTORICAL)
    const badgeW = 74;
    const badgeH = Math.min(16, Math.max(12, h - 2));
    const badgeX = x0 + w - badgeW - 6;
    const badgeY = y0 + Math.max(1, Math.floor((h - badgeH) / 2));

    ctx.fillStyle = this.isLive ? HIGHLAND_THEME.signal.sageSoft : HIGHLAND_THEME.signal.ochreSoft;
    ctx.strokeStyle = this.isLive ? HIGHLAND_THEME.signal.sage : HIGHLAND_THEME.signal.ochre;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect?.(badgeX, badgeY, badgeW, badgeH, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = this.isLive ? HIGHLAND_THEME.signal.sageBright : HIGHLAND_THEME.signal.ochre;
    ctx.font = `bold 9px ${HIGHLAND_THEME.font.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.isLive ? '● LIVE' : 'HISTORICAL', badgeX + badgeW / 2, badgeY + badgeH / 2);

    ctx.restore();
  }

  private renderEventMarkers(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
    if (!this.spatialBuffer || !this.epochStore) return;
    const events = scanTimelineEvents({
      spatialBuffer: this.spatialBuffer,
      epochStore: this.epochStore,
    });
    if (events.length === 0) return;

    ctx.save();
    const yMarker = y0 + h - 5;
    const tStart = this.viewStartTimeS;
    const tEnd = tStart + this.viewDurationS;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.timestampS < tStart || ev.timestampS > tEnd) continue;

      const px = this.timeToX(ev.timestampS);
      if (px < x0 - 5 || px > x0 + w + 5) continue;

      ctx.fillStyle = ev.color;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;

      // Draw diamond for spatial events, upward triangle for comm events
      ctx.beginPath();
      if (
        ev.eventType === 'QUEUE_OVERFLOW_DROP' ||
        ev.eventType === 'SIGNIFICANT_DROP_SPIKE' ||
        ev.eventType === 'RECONFIGURATION_RESET'
      ) {
        // Triangle
        ctx.moveTo(px, yMarker - 4);
        ctx.lineTo(px + 3.5, yMarker + 2);
        ctx.lineTo(px - 3.5, yMarker + 2);
        ctx.closePath();
      } else {
        // Diamond
        ctx.moveTo(px, yMarker - 3.5);
        ctx.lineTo(px + 3.5, yMarker);
        ctx.lineTo(px, yMarker + 3.5);
        ctx.lineTo(px - 3.5, yMarker);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();

      // Multi-node cluster indicator (+N)
      if (ev.nodeIds && ev.nodeIds.length > 1) {
        ctx.fillStyle = ev.color;
        ctx.font = '7px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${ev.nodeIds.length}`, px, yMarker - 4);
      }
    }
    ctx.restore();
  }

  private renderCommunicationTrack(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
    ctx.save();

    const laneH = (h - 6) / 2;
    const staticY = y0 + 2;
    const tacY = y0 + 4 + laneH;

    // Lane backgrounds
    ctx.fillStyle = HIGHLAND_THEME.substrate.void;
    ctx.fillRect(x0, staticY, w, laneH);
    ctx.fillRect(x0, tacY, w, laneH);

    // Divider line
    ctx.strokeStyle = HIGHLAND_THEME.line.frame;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + laneH + 3);
    ctx.lineTo(x0 + w, y0 + laneH + 3);
    ctx.stroke();

    const tStart = this.viewStartTimeS;
    const tEnd = this.viewStartTimeS + this.viewDurationS;

    // Check for visibly evicted communication history
    const oldestEpoch = this.epochStore.oldestRecord;
    if (oldestEpoch && this.viewStartTimeS < oldestEpoch.startTimeS) {
      const evictX1 = Math.max(0, this.timeToX(this.viewStartTimeS));
      const evictX2 = Math.min(w, this.timeToX(oldestEpoch.startTimeS));
      if (evictX2 > evictX1) {
        ctx.fillStyle = 'rgba(23, 26, 31, 0.78)';
        ctx.fillRect(evictX1, y0, evictX2 - evictX1, h);

        ctx.strokeStyle = HIGHLAND_THEME.line.frame;
        ctx.strokeRect(evictX1, y0, evictX2 - evictX1, h);

        ctx.fillStyle = HIGHLAND_THEME.text.faint;
        ctx.font = `10px ${HIGHLAND_THEME.font.sans}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Comm history evicted', (evictX1 + evictX2) / 2, y0 + h / 2);
      }
    }

    // Retrieve records in range
    const records = this.epochStore.getRecordsInRange(tStart, tEnd);

    // Adaptive LOD: If dense (> w / 2 records), aggregate into column bins
    const useBinning = records.length > Math.max(50, w / 2);

    if (useBinning) {
      const bins = this.aggregateEpochsIntoBins(records, w);
      for (const bin of bins.values()) {
        const bx = bin.pixelX;
        const bw = 1;

        // Static lane stacked bar
        this.renderStackedBar(ctx, bx, staticY, bw, laneH, bin.staticTxBytes, bin.staticOutageBytes, bin.staticDropBytes);
        // Tac-TAD lane stacked bar
        this.renderStackedBar(ctx, bx, tacY, bw, laneH, bin.tacTxBytes, bin.tacOutageBytes, bin.tacDropBytes);
      }
    } else {
      // Direct per-record rendering
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];

        if (rec.recordType === 'DISCONTINUITY') {
          const disc = rec as SuperframeDiscontinuityRecord;
          const x1 = Math.max(0, this.timeToX(disc.startTimeS));
          const x2 = Math.min(w, this.timeToX(disc.endTimeS));
          const dw = Math.max(3, x2 - x1);

          ctx.fillStyle = 'rgba(233, 196, 106, 0.55)';
          ctx.fillRect(x1, y0, dw, h);
          ctx.strokeStyle = HIGHLAND_THEME.signal.ochre;
          ctx.strokeRect(x1, y0, dw, h);
          continue;
        }

        const ep = rec as SuperframeEpochRecord;
        const x1 = this.timeToX(ep.startTimeS);
        const x2 = this.timeToX(ep.endTimeS);
        const bw = Math.max(1, x2 - x1);

        if (x2 < 0 || x1 > w) continue;

        const staticTx = ep.staticMetrics.transmittedNonOutageBits / 8;
        const staticOutage = ep.staticMetrics.outageWastedBits / 8;
        const staticDrop = ep.staticMetrics.totalDroppedBytes ?? (ep.staticMetrics.totalDroppedPkts * 1500);

        const tacTx = ep.tacMetrics.transmittedNonOutageBits / 8;
        const tacOutage = ep.tacMetrics.outageWastedBits / 8;
        const tacDrop = ep.tacMetrics.totalDroppedBytes ?? (ep.tacMetrics.totalDroppedPkts * 1500);

        // Static lane
        this.renderStackedBar(ctx, x1, staticY, bw, laneH, staticTx, staticOutage, staticDrop);
        // Tac-TAD lane
        this.renderStackedBar(ctx, x1, tacY, bw, laneH, tacTx, tacOutage, tacDrop);

        // Boundary line
        ctx.strokeStyle = HIGHLAND_THEME.line.frame;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x2, y0);
        ctx.lineTo(x2, y0 + h);
        ctx.stroke();
      }
    }

    // Isolated Point Eviction Finalization Slices (3 px vermilion #e05347 per lane)
    const evictions = typeof this.epochStore.getEvictionFinalizationsInWindow === 'function'
      ? this.epochStore.getEvictionFinalizationsInWindow(tStart, tEnd, true)
      : [];
    if (evictions.length > 0) {
      ctx.fillStyle = HIGHLAND_THEME.signal.vermilion;
      if (useBinning) {
        const evBins = this.aggregateEvictionsIntoBins(evictions, w);
        for (let i = 0; i < evBins.length; i++) {
          const bin = evBins[i];
          const laneY = bin.schedulerId === 'STATIC_TDMA' ? staticY : tacY;
          const drawX = Math.max(x0, Math.min(x0 + w - 3, x0 + bin.pixelX - 1.5));
          ctx.fillRect(drawX, laneY, 3, laneH);
        }
      } else {
        for (let i = 0; i < evictions.length; i++) {
          const ev = evictions[i];
          const px = this.timeToX(ev.timestampS);
          if (px < x0 - 3 || px > x0 + w + 3) continue;
          const laneY = ev.schedulerId === 'STATIC_TDMA' ? staticY : tacY;
          const drawX = Math.max(x0, Math.min(x0 + w - 3, px - 1.5));
          ctx.fillRect(drawX, laneY, 3, laneH);
        }
      }
    }

    // Lane labels with protective backdrop
    if (laneH >= 14) {
      this.renderLaneLabel(ctx, 6, staticY + 4, 'STATIC TDMA');
      this.renderLaneLabel(ctx, 6, tacY + 4, 'TAC-TAD');
    }

    // Active in-flight right boundary indicator when live
    if (this.isLive) {
      const activeX = this.timeToX(this.playheadTimeS);
      if (activeX >= 0 && activeX <= w) {
        ctx.strokeStyle = HIGHLAND_THEME.signal.sage;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(activeX, y0);
        ctx.lineTo(activeX, y0 + h);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private renderStackedBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    txBytes: number,
    outageBytes: number,
    dropBytes: number
  ): void {
    const total = txBytes + outageBytes + dropBytes;
    if (total <= 0) {
      // Idle slot
      ctx.fillStyle = HIGHLAND_THEME.substrate.raised;
      ctx.fillRect(x, y + h - 2, w, 2);
      return;
    }

    const hTx = (txBytes / total) * (h - 2);
    const hOutage = (outageBytes / total) * (h - 2);
    const hDrop = (dropBytes / total) * (h - 2);

    let currY = y + h - 1;

    // Delivered Goodput (Alpine Sage #52b788)
    if (hTx > 0) {
      currY -= hTx;
      ctx.fillStyle = HIGHLAND_THEME.signal.sage;
      ctx.fillRect(x, currY, w, hTx);
    }

    // Outage Waste (Titanium Amber #e09f3e)
    if (hOutage > 0) {
      currY -= hOutage;
      ctx.fillStyle = HIGHLAND_THEME.signal.amber;
      ctx.fillRect(x, currY, w, hOutage);
    }

    // Queue Drops (Alert Vermilion #e05347)
    if (hDrop > 0) {
      currY -= hDrop;
      ctx.fillStyle = HIGHLAND_THEME.signal.vermilion;
      ctx.fillRect(x, currY, w, hDrop);
    }
  }

  private renderLaneLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
    ctx.save();
    ctx.font = `bold 9px ${HIGHLAND_THEME.font.mono}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const textW = ctx.measureText(text).width;
    ctx.fillStyle = HIGHLAND_THEME.substrate.hudFillSoft;
    ctx.fillRect(x - 2, y - 1, textW + 6, 12);
    ctx.fillStyle = HIGHLAND_THEME.text.muted;
    ctx.fillText(text, x + 1, y + 1);
    ctx.restore();
  }

  private renderSpatialRibbon(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
    if (h < 12) return;
    ctx.save();
    ctx.fillStyle = HIGHLAND_THEME.substrate.bg;
    ctx.fillRect(x0, y0, w, h);

    // Border line
    ctx.strokeStyle = HIGHLAND_THEME.line.frame;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + w, y0);
    ctx.stroke();

    // Node count and ACN altitude text readout
    const snap = this.spatialBuffer.findClosestSnapshot(this.playheadTimeS);
    if (snap) {
      ctx.fillStyle = HIGHLAND_THEME.text.faint;
      ctx.font = `9px ${HIGHLAND_THEME.font.mono}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const nodeCount = snap.nodes ? snap.nodes.length : 0;
      const altM = Math.round(snap.acn.altitudeMslM);
      const spdKmh = Math.round(Math.hypot(snap.acn.velX, snap.acn.velY) * 3.6);
      ctx.fillText(`ACN ALT: ${altM}m | SPD: ${spdKmh}km/h | NODES: ${nodeCount}`, x0 + 8, y0 + h / 2);
    }

    ctx.restore();
  }

  private renderPlayhead(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const px = this.timeToX(this.playheadTimeS);
    if (px < 0 || px > w) return;

    ctx.save();
    const needleColor = this.isLive ? HIGHLAND_THEME.signal.sage : HIGHLAND_THEME.signal.ochre;

    // Vertical Needle Line
    ctx.strokeStyle = needleColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();

    // Triangular head marker at top
    ctx.fillStyle = needleColor;
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fill();

    // Suppress/shift timestamp pill away from right-edge LIVE badge and tick marks
    const timeText = `${this.playheadTimeS.toFixed(2)}s`;
    ctx.font = `bold 9px ${HIGHLAND_THEME.font.mono}`;
    const pillW = ctx.measureText(timeText).width + 8;
    const pillH = 14;
    const collidesRightBadge = px >= w - 84;
    const pillX = collidesRightBadge
      ? Math.max(2, Math.min(w - pillW - 6, px - pillW / 2))
      : Math.max(2, Math.min(w - 86 - pillW, px - pillW / 2));
    const pillY = collidesRightBadge ? 26 : 18;

    ctx.fillStyle = HIGHLAND_THEME.substrate.hudFill;
    ctx.strokeStyle = needleColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect?.(pillX, pillY, pillW, pillH, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = needleColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timeText, pillX + pillW / 2, pillY + pillH / 2);

    ctx.restore();
  }

  // ==========================================================================
  // Interactive Event Handlers
  // ==========================================================================

  public attachEventListeners(): void {
    if (typeof this.canvas.addEventListener !== 'function') return;

    this.boundOnMouseDown = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const clickedT = this.xToTime(x);

      this.isDragging = true;
      this.seekTo(clickedT, false);
      this.render();
    };

    this.boundOnMouseMove = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const t = this.xToTime(x);

      this.hoveredTimeS = t;
      this.options.onHover?.(t);

      if (this.isDragging) {
        this.seekTo(t, false);
      }
      this.render();
    };

    this.boundOnMouseUp = () => {
      this.isDragging = false;
    };

    this.boundOnMouseLeave = () => {
      this.isDragging = false;
      this.hoveredTimeS = null;
      this.options.onHover?.(null);
      this.render();
    };

    this.boundOnWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;
      this.zoomAt(x, zoomFactor);
      this.render();
    };

    this.canvas.addEventListener('mousedown', this.boundOnMouseDown);
    this.canvas.addEventListener('mousemove', this.boundOnMouseMove);
    this.canvas.addEventListener('mouseup', this.boundOnMouseUp);
    this.canvas.addEventListener('mouseleave', this.boundOnMouseLeave);
    this.canvas.addEventListener('wheel', this.boundOnWheel, { passive: false });
  }

  public detachEventListeners(): void {
    if (typeof this.canvas.removeEventListener !== 'function') return;

    if (this.boundOnMouseDown) {
      this.canvas.removeEventListener('mousedown', this.boundOnMouseDown);
      this.boundOnMouseDown = null;
    }
    if (this.boundOnMouseMove) {
      this.canvas.removeEventListener('mousemove', this.boundOnMouseMove);
      this.boundOnMouseMove = null;
    }
    if (this.boundOnMouseUp) {
      this.canvas.removeEventListener('mouseup', this.boundOnMouseUp);
      this.boundOnMouseUp = null;
    }
    if (this.boundOnMouseLeave) {
      this.canvas.removeEventListener('mouseleave', this.boundOnMouseLeave);
      this.boundOnMouseLeave = null;
    }
    if (this.boundOnWheel) {
      this.canvas.removeEventListener('wheel', this.boundOnWheel);
      this.boundOnWheel = null;
    }
  }
}
