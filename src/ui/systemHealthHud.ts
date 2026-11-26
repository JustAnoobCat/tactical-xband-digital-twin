/**
 * Read-Only Live System Health / WASM / Air-Gap / State-Hash HUD (UPG-01)
 *
 * Strictly observational UI projection using `textContent` DOM updates only:
 * zero raw HTML injection, zero inline event handlers, zero simulation state mutation.
 */

import type { TelemetryFrame } from '../shared/workerProtocol';
import { computeTelemetryStateDigest } from '../core/flightRecorder';
import { evaluateWorkerRealTimeProfile } from '../core/workerJitterProfiler';
import { getAirGapOfflineOnly, type WorldTileLayer } from './worldTileLayer';

export type RuntimePlatformLabel = 'Tauri v2' | 'Electron' | 'Browser PWA';

export interface SystemHealthSnapshot {
  readonly computeKernel: 'RUST/WASM' | 'TS FALLBACK';
  readonly pacingP50Ms: number;
  readonly pacingP95Ms: number;
  readonly pacingText: string;
  readonly runtimeLabel: RuntimePlatformLabel;
  readonly heapMemoryText: string;
  readonly runtimeAndMemoryText: string;
  readonly airGapLocked: boolean;
  readonly networkPostureText: 'AIR-GAP LOCKED (0 ext)' | 'ONLINE TILES';
  readonly stateDigestHex: string;
  readonly recordedEventsCount: number;
  readonly recorderStatusText: string;
}

export interface SystemHealthHudOptions {
  readonly documentRef?: Document;
  readonly container?: HTMLElement | null;
  readonly getWorldTileLayer?: () => WorldTileLayer | null;
  readonly getAirGapOffline?: () => boolean;
  readonly getRecordedEventCount?: () => number;
}

export interface SystemHealthUpdateInput {
  readonly frame?: TelemetryFrame | null;
  readonly stepMs?: number;
  readonly interFrameDeltaMs?: number;
  readonly rollingStepSamples?: readonly number[];
  readonly rollingInterFrameDeltas?: readonly number[];
  readonly recordedEventsCount?: number;
  readonly airGapLocked?: boolean;
}

const MAX_ROLLING_SAMPLES = 200;

export function detectRuntimePlatformLabel(): RuntimePlatformLabel {
  if (typeof window !== 'undefined' && window !== null) {
    if ('__TAURI__' in window || '__TAURI_INTERNALS__' in window) {
      return 'Tauri v2';
    }
  }
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.userAgent === 'string' &&
    navigator.userAgent.includes('Electron')
  ) {
    return 'Electron';
  }
  return 'Browser PWA';
}

export function readJsHeapMemoryText(): string {
  if (typeof performance === 'undefined' || performance === null) {
    return 'N/A';
  }
  const perfWithMem = performance as unknown as {
    memory?: { readonly usedJSHeapSize?: number };
  };
  const usedBytes = perfWithMem.memory?.usedJSHeapSize;
  if (typeof usedBytes === 'number' && Number.isFinite(usedBytes) && usedBytes > 0) {
    return `${(usedBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return 'N/A';
}

export class SystemHealthHud {
  private readonly doc: Document | undefined;
  private readonly getWorldTileLayer?: () => WorldTileLayer | null;
  private readonly getAirGapOffline?: () => boolean;
  private readonly getRecordedEventCount?: () => number;
  private readonly stepSamples: number[] = [];
  private readonly interFrameDeltas: number[] = [];
  private lastSnapshot: SystemHealthSnapshot | null = null;
  private lastObserveNowMs: number = 0;

  constructor(options: SystemHealthHudOptions = {}) {
    this.doc = options.documentRef ?? (typeof document !== 'undefined' ? document : undefined);
    this.getWorldTileLayer = options.getWorldTileLayer;
    this.getAirGapOffline = options.getAirGapOffline;
    this.getRecordedEventCount = options.getRecordedEventCount;
    if (options.container && this.doc) {
      this.ensureChildNodes(options.container, this.doc);
    }
  }

  private ensureChildNodes(container: HTMLElement, doc: Document): void {
    if (doc.getElementById('syshealth-kernel-badge')) {
      return;
    }
    const grid = doc.createElement('div');
    grid.className = 'diag-live-grid';

    const makeCard = (labelText: string, valueId: string, initialValue: string): void => {
      const card = doc.createElement('div');
      card.className = 'diag-card';
      const span = doc.createElement('span');
      span.textContent = labelText;
      const strong = doc.createElement('strong');
      strong.id = valueId;
      strong.textContent = initialValue;
      card.appendChild(span);
      card.appendChild(strong);
      grid.appendChild(card);
    };

    makeCard('Compute Kernel', 'syshealth-kernel-badge', 'TS FALLBACK');
    makeCard('Worker Pacing (p50 / p95)', 'syshealth-pacing', '-- / -- ms');
    makeCard('Runtime & JS Heap', 'syshealth-runtime', 'Browser PWA · N/A');
    makeCard('Network Posture', 'syshealth-airgap', 'AIR-GAP LOCKED (0 ext)');
    makeCard('Determinism State Hash', 'syshealth-digest', '0x0000000000000000');
    makeCard('Flight Recorder', 'syshealth-rec-status', 'REC: 0 events');

    container.appendChild(grid);
  }

  public computeSnapshot(input: SystemHealthUpdateInput = {}): SystemHealthSnapshot {
    const frame = input.frame ?? null;
    const rawFrameMeta = frame as (TelemetryFrame & {
      readonly step_ms?: number;
      readonly worker_step_ms?: number;
    }) | null;

    const explicitStepMs =
      typeof input.stepMs === 'number' && Number.isFinite(input.stepMs)
        ? input.stepMs
        : typeof rawFrameMeta?.worker_step_ms === 'number' && Number.isFinite(rawFrameMeta.worker_step_ms)
          ? rawFrameMeta.worker_step_ms
          : typeof rawFrameMeta?.step_ms === 'number' && Number.isFinite(rawFrameMeta.step_ms)
            ? rawFrameMeta.step_ms
            : undefined;

    if (explicitStepMs !== undefined) {
      this.stepSamples.push(Math.max(0, explicitStepMs));
      if (this.stepSamples.length > MAX_ROLLING_SAMPLES) this.stepSamples.shift();
    }

    if (typeof input.interFrameDeltaMs === 'number' && Number.isFinite(input.interFrameDeltaMs)) {
      this.interFrameDeltas.push(Math.max(0, input.interFrameDeltaMs));
      if (this.interFrameDeltas.length > MAX_ROLLING_SAMPLES) this.interFrameDeltas.shift();
    } else if (frame && typeof performance !== 'undefined') {
      const now = performance.now();
      if (this.lastObserveNowMs > 0) {
        const dt = now - this.lastObserveNowMs;
        if (dt > 0.5 && dt < 2000) {
          this.interFrameDeltas.push(dt);
          if (this.interFrameDeltas.length > MAX_ROLLING_SAMPLES) this.interFrameDeltas.shift();
        }
      }
      this.lastObserveNowMs = now;
    }

    const activeStepSamples =
      input.rollingStepSamples && input.rollingStepSamples.length > 0
        ? input.rollingStepSamples
        : this.stepSamples;
    const activeDeltas =
      input.rollingInterFrameDeltas && input.rollingInterFrameDeltas.length > 0
        ? input.rollingInterFrameDeltas
        : this.interFrameDeltas;

    const rtReport = evaluateWorkerRealTimeProfile(activeStepSamples, activeDeltas);
    const computeKernel: 'RUST/WASM' | 'TS FALLBACK' = frame?.wasm_active ? 'RUST/WASM' : 'TS FALLBACK';

    const runtimeLabel = detectRuntimePlatformLabel();
    const heapMemoryText = readJsHeapMemoryText();
    const runtimeAndMemoryText = `${runtimeLabel} · Heap ${heapMemoryText}`;

    const worldLayer = this.getWorldTileLayer?.() ?? null;
    const airGapLocked =
      typeof input.airGapLocked === 'boolean'
        ? input.airGapLocked
        : this.getAirGapOffline
          ? this.getAirGapOffline()
          : worldLayer
            ? worldLayer.isAirGapOfflineOnly()
            : getAirGapOfflineOnly();

    const networkPostureText: 'AIR-GAP LOCKED (0 ext)' | 'ONLINE TILES' = airGapLocked
      ? 'AIR-GAP LOCKED (0 ext)'
      : 'ONLINE TILES';

    const stateDigestHex =
      frame?.state_digest_hex ?? (frame ? computeTelemetryStateDigest(frame) : '0x0000000000000000');

    const recordedEventsCount =
      typeof input.recordedEventsCount === 'number' && Number.isFinite(input.recordedEventsCount)
        ? Math.max(0, Math.trunc(input.recordedEventsCount))
        : (this.getRecordedEventCount?.() ?? 0);

    const pacingText =
      activeStepSamples.length > 0
        ? `${rtReport.p50Ms.toFixed(2)} / ${rtReport.p95Ms.toFixed(2)} ms`
        : '-- / -- ms';

    const snapshot: SystemHealthSnapshot = {
      computeKernel,
      pacingP50Ms: rtReport.p50Ms,
      pacingP95Ms: rtReport.p95Ms,
      pacingText,
      runtimeLabel,
      heapMemoryText,
      runtimeAndMemoryText,
      airGapLocked,
      networkPostureText,
      stateDigestHex,
      recordedEventsCount,
      recorderStatusText: `REC: ${recordedEventsCount} event${recordedEventsCount === 1 ? '' : 's'}`,
    };
    this.lastSnapshot = snapshot;
    return snapshot;
  }

  public update(input: SystemHealthUpdateInput = {}): SystemHealthSnapshot {
    const snap = this.computeSnapshot(input);
    const doc = this.doc;
    if (!doc) return snap;

    const setText = (id: string, value: string): void => {
      const el = doc.getElementById(id);
      if (el) el.textContent = value;
    };

    const kernelEl = doc.getElementById('syshealth-kernel-badge');
    if (kernelEl) {
      kernelEl.textContent = snap.computeKernel;
      kernelEl.className =
        snap.computeKernel === 'RUST/WASM'
          ? 'kpi-badge badge-emerald'
          : 'kpi-badge badge-neutral';
    }
    setText('syshealth-summary-kernel', snap.computeKernel);
    setText('syshealth-pacing', snap.pacingText);
    setText('syshealth-runtime', snap.runtimeAndMemoryText);

    const airGapEl = doc.getElementById('syshealth-airgap');
    if (airGapEl) {
      airGapEl.textContent = snap.networkPostureText;
    }

    setText('syshealth-digest', snap.stateDigestHex);
    setText('syshealth-rec-status', snap.recorderStatusText);

    return snap;
  }

  public getLastSnapshot(): SystemHealthSnapshot | null {
    return this.lastSnapshot;
  }
}
