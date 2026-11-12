/**
 * Highland Instrument — Level-3 Live Runtime & Lookahead Diagnostics Renderer
 *
 * Strictly observational UI module: reads published TelemetryFrame payloads and
 * buffer occupancies without mutating simulation state or stalling the 50 Hz loop.
 */

import type { TelemetryFrame } from '../../shared/workerProtocol';

export interface BufferCountsSnapshot {
  readonly spatialCount: number;
  readonly spatialCapacity: number;
  readonly epochCount: number;
  readonly epochCapacity: number;
}

export interface DiagnosticsDomIds {
  readonly cadenceId: string;
  readonly jitterId: string;
  readonly pacingId: string;
  readonly lookaheadSummaryId: string;
  readonly buffersId: string;
  readonly revisionId: string;
  readonly jsonId: string;
}

export class DiagnosticsTracker {
  private lastArrivalMs: number | null = null;
  private emaIntervalMs: number | null = null;
  private minIntervalMs = Number.POSITIVE_INFINITY;
  private maxIntervalMs = 0;
  private frameIntervalsObserved = 0;
  private lastDomRenderMs = 0;
  private lastJsonRenderMs = 0;
  private expandRawJson = false;

  public reset(): void {
    this.lastArrivalMs = null;
    this.emaIntervalMs = null;
    this.minIntervalMs = Number.POSITIVE_INFINITY;
    this.maxIntervalMs = 0;
    this.frameIntervalsObserved = 0;
    this.lastDomRenderMs = 0;
    this.lastJsonRenderMs = 0;
  }

  public setExpandRawJson(expand: boolean): void {
    this.expandRawJson = expand;
    this.lastJsonRenderMs = 0;
  }

  public getExpandRawJson(): boolean {
    return this.expandRawJson;
  }

  public observeFrame(nowMs: number): void {
    if (this.lastArrivalMs !== null) {
      const dt = Math.max(0, nowMs - this.lastArrivalMs);
      if (dt < 2000) {
        this.emaIntervalMs = this.emaIntervalMs === null ? dt : this.emaIntervalMs * 0.85 + dt * 0.15;
        if (dt < this.minIntervalMs) this.minIntervalMs = dt;
        if (dt > this.maxIntervalMs) this.maxIntervalMs = dt;
        this.frameIntervalsObserved++;
      }
    }
    this.lastArrivalMs = nowMs;
  }

  public renderIntoDom(
    frame: TelemetryFrame | null | undefined,
    buffers: BufferCountsSnapshot,
    ids: DiagnosticsDomIds,
    options: { readonly force?: boolean; readonly isPanelVisible?: boolean; readonly nowMs?: number } = {}
  ): void {
    if (!options.isPanelVisible && !options.force) return;
    const nowMs = options.nowMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!options.force && nowMs - this.lastDomRenderMs < 150) return;
    this.lastDomRenderMs = nowMs;

    const setEl = (id: string, text: string) => {
      const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
      if (el) el.textContent = text;
    };

    if (!frame) {
      setEl(ids.cadenceId, '--');
      setEl(ids.jitterId, '--');
      setEl(ids.pacingId, '--');
      setEl(ids.lookaheadSummaryId, '--');
      setEl(ids.buffersId, '--');
      setEl(ids.revisionId, '--');
      return;
    }

    const avgMs = this.emaIntervalMs;
    const hzText = avgMs !== null && avgMs > 0.1 ? `${(1000 / avgMs).toFixed(1)} fps` : '--';
    setEl(ids.cadenceId, avgMs !== null ? `${avgMs.toFixed(1)} ms (${hzText})` : 'Sampling…');
    setEl(
      ids.jitterId,
      this.frameIntervalsObserved > 2 && Number.isFinite(this.minIntervalMs)
        ? `${this.minIntervalMs.toFixed(1)}–${this.maxIntervalMs.toFixed(1)} ms (n=${this.frameIntervalsObserved})`
        : 'Sampling…'
    );

    const tgt = Number(frame.target_speed ?? frame.speed ?? 1);
    const ach = Number(frame.achieved_speed ?? tgt);
    const frameMs = Number(frame.tdma_frame_config?.frameDurationMs ?? 20.0);
    setEl(
      ids.pacingId,
      frame.paused
        ? `PAUSED · target ${tgt.toFixed(2)}× · frame ${frameMs.toFixed(1)} ms`
        : `${ach.toFixed(2)}× / ${tgt.toFixed(2)}× · frame ${frameMs.toFixed(1)} ms`
    );

    // M1 Lookahead Engine State Breakdown from authoritative node telemetry
    const nodes = Array.isArray(frame.nodes_telemetry) ? frame.nodes_telemetry : [];
    let clear = 0;
    let pre = 0;
    let shadow = 0;
    let rec = 0;
    for (let i = 0; i < nodes.length; i++) {
      const st = nodes[i].state_name;
      if (st === 'CLEAR_LOS') clear++;
      else if (st === 'PRE_OCCLUSION_WARNING') pre++;
      else if (st === 'HARD_SHADOW_CUTOFF') shadow++;
      else if (st === 'RECOVERING_EMERGENCE') rec++;
    }
    setEl(
      ids.lookaheadSummaryId,
      `10 Hz worker cache · ${clear} Clear · ${pre} Pre-Occl · ${shadow} Shadow · ${rec} Emerg`
    );

    const batchLen = Array.isArray(frame.batch_spatial_snapshots) ? frame.batch_spatial_snapshots.length : 0;
    const epochBatchLen = Array.isArray(frame.completed_superframes) ? frame.completed_superframes.length : 0;
    setEl(
      ids.buffersId,
      `Spatial ${buffers.spatialCount}/${buffers.spatialCapacity} · Epochs ${buffers.epochCount}/${buffers.epochCapacity} (batch +${batchLen}/+${epochBatchLen})`
    );

    setEl(
      ids.revisionId,
      `Frame #${frame.frame_index} · T+${Number(frame.sim_time_s ?? 0).toFixed(2)}s · Spatial rev ${frame.spatial_revision} · ${frame.scheduler_mode}`
    );

    if (options.force || nowMs - this.lastJsonRenderMs >= 250) {
      this.lastJsonRenderMs = nowMs;
      setEl(ids.jsonId, formatTelemetryInspectorJson(frame, this.expandRawJson));
    }
  }
}

export function formatTelemetryInspectorJson(frame: TelemetryFrame, expandFull: boolean): string {
  if (expandFull) {
    try {
      return JSON.stringify(frame, null, 2);
    } catch {
      return '// Unable to serialize full TelemetryFrame';
    }
  }
  const summary = {
    frame_index: frame.frame_index,
    sim_time_s: Number((frame.sim_time_s ?? 0).toFixed(3)),
    scheduler_mode: frame.scheduler_mode,
    selected_node_id: frame.selected_node_id,
    paused: frame.paused,
    target_speed: frame.target_speed,
    achieved_speed: frame.achieved_speed,
    spatial_locked: frame.spatial_locked,
    spatial_revision: frame.spatial_revision,
    acn_telemetry: {
      pos_x: frame.acn_telemetry?.pos_x,
      pos_y: frame.acn_telemetry?.pos_y,
      altitude_msl_m: frame.acn_telemetry?.altitude_msl_m,
      altitude_agl_m: frame.acn_telemetry?.altitude_agl_m,
      current_speed_mps: frame.acn_telemetry?.current_speed_mps,
    },
    tdma_frame_config: frame.tdma_frame_config,
    comparative_kpi_dashboard: frame.comparative_kpi_dashboard,
    array_counts: {
      nodes_telemetry: Array.isArray(frame.nodes_telemetry) ? frame.nodes_telemetry.length : 0,
      active_gantt_allocations: Array.isArray(frame.active_gantt_allocations) ? frame.active_gantt_allocations.length : 0,
      static_gantt_allocations: Array.isArray(frame.static_gantt_allocations) ? frame.static_gantt_allocations.length : 0,
      tac_gantt_allocations: Array.isArray(frame.tac_gantt_allocations) ? frame.tac_gantt_allocations.length : 0,
      batch_spatial_snapshots: Array.isArray(frame.batch_spatial_snapshots) ? frame.batch_spatial_snapshots.length : 0,
      completed_superframes: Array.isArray(frame.completed_superframes) ? frame.completed_superframes.length : 0,
    },
  };
  return JSON.stringify(summary, null, 2);
}
