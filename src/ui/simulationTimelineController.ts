/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Simulation Timeline Controller (DRDO-TAC-XBAND-ARCH-TIMELINE-17)
 *
 * Coordinates between SpatialSnapshotBuffer, SuperframeEpochStore,
 * SimulationTimelineRenderer, and the persistent map / tactical entities:
 * - Streaming telemetry ingestion into spatial & epoch ring buffers.
 * - Strict run-generation isolation via SuperframeEpochStore coordinator hooks.
 * - Live vs. Historical state management and UI status dispatch.
 * - Bidirectional playhead scrubbing and step controls (backward/forward).
 * - Historical map projection gating (getActiveSpatialSnapshot).
 * - Interaction lockdown enforcement during historical inspection.
 * - Historical animation playback.
 */

import type { SpatialSnapshotBuffer } from './spatialSnapshotBuffer';
import type {
  RunGenerationSyncResult,
  StoreRunTransitionKind,
  SuperframeEpochStore,
} from './superframeEpochStore';
import type { SimulationTimelineRenderer } from './simulationTimelineRenderer';
import type {
  SpatialFrameSnapshot,
  TelemetryFrame,
  TimelineCommunicationRecord,
  WorkerCommandResult,
} from '../shared/workerProtocol';

export interface SimulationTimelineControllerOptions {
  readonly spatialBuffer: SpatialSnapshotBuffer;
  readonly epochStore: SuperframeEpochStore;
  readonly renderer: SimulationTimelineRenderer;
  readonly onMapRedrawNeeded?: () => void;
  readonly onStatusChange?: (isLive: boolean, playheadTimeS: number) => void;
  readonly onReset?: () => void;
  readonly onFirstTaggedActivation?: () => void;
}

export class SimulationTimelineController {
  public readonly spatialBuffer: SpatialSnapshotBuffer;
  public readonly epochStore: SuperframeEpochStore;
  public readonly renderer: SimulationTimelineRenderer;
  public readonly options: SimulationTimelineControllerOptions;

  public isLive: boolean = true;
  public isPlayingHistory: boolean = false;
  public playheadTimeS: number = 0.0;
  public playbackSpeed: number = 1.0;
  public activeSpatialSnapshot: SpatialFrameSnapshot | null = null;
  public isDirty: boolean = false;

  private isInternalSeeking: boolean = false;
  private isSynchronizingTransition: boolean = false;
  private hasSyncedTaggedController: boolean = false;

  constructor(options: SimulationTimelineControllerOptions) {
    this.options = options;
    this.spatialBuffer = options.spatialBuffer;
    this.epochStore = options.epochStore;
    this.renderer = options.renderer;

    // Connect renderer callbacks
    const originalOnSeek = (this.renderer.options as any).onSeek;
    (this.renderer as any).options = {
      ...this.renderer.options,
      onSeek: (timeS: number, isLive: boolean) => {
        if (!this.isInternalSeeking) {
          this.seekTo(timeS, isLive);
        }
        originalOnSeek?.(timeS, isLive);
      },
    };

    // Synchronous coordinator registration + late-registration guard (REV12/REV13)
    this.epochStore.registerCoordinator({
      hasCoordinatedHistory: () =>
        this.spatialBuffer.count > 0 ||
        this.activeSpatialSnapshot !== null ||
        this.spatialBuffer.discontinuities.length > 0,
      onBeforeTaggedTransition: (kind) => {
        this.handleStoreBeforeTaggedTransition(kind);
      },
    });
    if (this.epochStore.isTaggedRunActive()) {
      this.handleStoreBeforeTaggedTransition('FIRST_TAGGED_ACTIVATION');
    }
  }

  public get isHistoricalInspecting(): boolean {
    return !this.isLive;
  }

  public get isInteractionLocked(): boolean {
    return !this.isLive;
  }

  private resetRendererToLiveOrigin(): void {
    this.isInternalSeeking = true;
    try {
      this.renderer.hoveredTimeS = null;
      this.renderer.setLive(true);
      this.renderer.setTimeWindow(0.0, 20.0);
      this.renderer.seekTo(0.0, true);
      this.renderer.render();
    } finally {
      this.isInternalSeeking = false;
    }
  }

  private executeFirstTaggedActivationCleanup(): void {
    this.hasSyncedTaggedController = true;
    this.isPlayingHistory = false;
    this.isLive = true;
    this.playheadTimeS = 0.0;
    this.activeSpatialSnapshot = null;
    this.spatialBuffer.clear();
    this.resetRendererToLiveOrigin();
    this.options.onFirstTaggedActivation?.();
  }

  private executeRunResetCleanup(): void {
    this.hasSyncedTaggedController = true;
    this.isPlayingHistory = false;
    this.isLive = true;
    this.playheadTimeS = 0.0;
    this.activeSpatialSnapshot = null;
    this.spatialBuffer.clear();
    this.resetRendererToLiveOrigin();
    this.options.onReset?.();
    this.options.onMapRedrawNeeded?.();
    this.options.onStatusChange?.(true, 0.0);
  }

  private handleStoreBeforeTaggedTransition(kind: StoreRunTransitionKind): void {
    if (this.isSynchronizingTransition) {
      return;
    }
    this.isSynchronizingTransition = true;
    try {
      if (kind === 'FIRST_TAGGED_ACTIVATION') {
        if (!this.hasSyncedTaggedController) {
          this.executeFirstTaggedActivationCleanup();
        }
      } else {
        this.executeRunResetCleanup();
      }
    } finally {
      this.isSynchronizingTransition = false;
    }
  }

  private applyControllerRunSync(runId: number): RunGenerationSyncResult {
    const sync = this.epochStore.syncSimulationRunId(runId);
    if (sync !== 'REJECTED_STALE' && !this.hasSyncedTaggedController) {
      this.handleStoreBeforeTaggedTransition('FIRST_TAGGED_ACTIVATION');
    }
    return sync;
  }

  /**
   * Synchronizes and gates run-generation before mutating UI state from a live TELEMETRY_FRAME.
   * Returns `false` if the frame belongs to a stale simulation run or is untagged while tagged mode is active.
   */
  public prepareTelemetryRun(liveTelemetryFrame?: TelemetryFrame | null): boolean {
    if (liveTelemetryFrame && typeof liveTelemetryFrame.simulation_run_id === 'number') {
      return this.applyControllerRunSync(liveTelemetryFrame.simulation_run_id) !== 'REJECTED_STALE';
    }
    if (liveTelemetryFrame !== undefined) {
      // Explicit frame object missing `simulation_run_id` or explicit `null` frame:
      // permitted only before tagged mode is locked.
      return !this.epochStore.isTaggedRunActive();
    }
    return true;
  }

  /**
   * Gates worker COMMAND_RESULT messages by `simulation_run_id` and ingests synchronous
   * `eviction_finalizations` from accepted commands (such as NODE_DELETE).
   */
  public ingestCommandResult(msg?: WorkerCommandResult | null): boolean {
    if (!msg || msg.type !== 'COMMAND_RESULT') {
      return false;
    }

    const evItems = Array.isArray(msg.eviction_finalizations) ? msg.eviction_finalizations : [];
    const hasTaggedEviction = evItems.some((item) => Boolean(item) && item.simulationRunId !== undefined);

    if (typeof msg.simulation_run_id === 'number') {
      const sync = this.applyControllerRunSync(msg.simulation_run_id);
      if (sync === 'REJECTED_STALE') {
        return false;
      }
    } else if (this.epochStore.isTaggedRunActive() || hasTaggedEviction) {
      return false;
    }

    if (msg.accepted !== false && evItems.length > 0) {
      const added = this.epochStore.ingestBatch(evItems);
      if (added > 0) {
        this.renderer.render();
        this.options.onStatusChange?.(this.isLive, this.playheadTimeS);
      }
    }
    return true;
  }

  /**
   * Ingests batched telemetry from the simulation worker into spatial and epoch buffers.
   */
  public ingestTelemetry(
    batchSpatial?: readonly SpatialFrameSnapshot[],
    completedSuperframes?: readonly TimelineCommunicationRecord[],
    liveTelemetryFrame?: TelemetryFrame | null
  ): boolean {
    const hasRecords = Array.isArray(completedSuperframes) && completedSuperframes.length > 0;
    const hasAnyTaggedSuperframe =
      hasRecords && completedSuperframes.some((r) => Boolean(r) && r.simulationRunId !== undefined);

    if (liveTelemetryFrame !== undefined) {
      if (!liveTelemetryFrame || typeof liveTelemetryFrame.simulation_run_id !== 'number') {
        if (this.epochStore.isTaggedRunActive() || hasAnyTaggedSuperframe) {
          return false;
        }
      }
    }

    if (!this.prepareTelemetryRun(liveTelemetryFrame)) {
      return false;
    }

    // When 3rd arg is omitted after tagged mode is locked, require valid tagged communication records
    if (liveTelemetryFrame === undefined && this.epochStore.isTaggedRunActive()) {
      if (!hasRecords) {
        return false;
      }
      const appended = this.epochStore.ingestBatch(completedSuperframes!);
      if (appended === 0) {
        return false;
      }
      if (batchSpatial && batchSpatial.length > 0) {
        this.spatialBuffer.ingestBatch(batchSpatial);
      }
    } else {
      if (hasRecords) {
        this.epochStore.ingestBatch(completedSuperframes!);
      }
      if (batchSpatial && batchSpatial.length > 0) {
        this.spatialBuffer.ingestBatch(batchSpatial);
      }
    }

    if (this.isLive) {
      if (this.spatialBuffer.count > 0) {
        this.playheadTimeS = this.spatialBuffer.newestSimulationTimeS;
        this.activeSpatialSnapshot = null;
      }
      this.isDirty = true;
      this.options.onStatusChange?.(this.isLive, this.playheadTimeS);
    }

    return true;
  }

  /**
   * Renders the timeline canvas if marked dirty by incoming telemetry.
   */
  public renderIfDirty(): boolean {
    if (this.isDirty) {
      this.isDirty = false;
      this.renderer.render();
      return true;
    }
    return false;
  }

  /**
   * Seeks playhead to requested simulation timestamp.
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

    if (!this.isLive) {
      this.activeSpatialSnapshot = this.spatialBuffer.findClosestSnapshot(timeS);
    } else {
      const newest = this.spatialBuffer.newestSnapshot;
      this.activeSpatialSnapshot = newest ?? null;
      if (newest) {
        this.playheadTimeS = newest.simulationTimeS;
      }
    }

    this.isInternalSeeking = true;
    try {
      this.renderer.seekTo(this.playheadTimeS, this.isLive);
      this.renderer.render();
      this.isDirty = false;
    } finally {
      this.isInternalSeeking = false;
    }

    this.options.onMapRedrawNeeded?.();
    this.options.onStatusChange?.(this.isLive, this.playheadTimeS);
  }

  /**
   * Steps playhead backward by 1 tick (default 0.020s), switching to historical inspection.
   */
  public stepBackward(stepS: number = 0.020): void {
    this.isPlayingHistory = false;
    this.seekTo(this.playheadTimeS - stepS, false);
  }

  /**
   * Steps playhead forward by 1 tick (default 0.020s).
   */
  public stepForward(stepS: number = 0.020): void {
    this.isPlayingHistory = false;
    this.seekTo(this.playheadTimeS + stepS, false);
  }

  /**
   * Immediately resumes following live worker telemetry.
   */
  public jumpToLive(): void {
    this.isPlayingHistory = false;
    this.isLive = true;

    if (this.spatialBuffer.count > 0) {
      this.playheadTimeS = this.spatialBuffer.newestSimulationTimeS;
      this.activeSpatialSnapshot = null;
    }

    this.isInternalSeeking = true;
    try {
      this.renderer.setLive(true);
      this.renderer.render();
      this.isDirty = false;
    } finally {
      this.isInternalSeeking = false;
    }

    this.options.onMapRedrawNeeded?.();
    this.options.onStatusChange?.(true, this.playheadTimeS);
  }

  /**
   * Resets simulation timeline state and clears spatial and epoch stores via coordinator protocol.
   */
  public reset(nextRunId?: number): boolean {
    const accepted = this.epochStore.notifySimulationReset(nextRunId);
    if (!accepted && nextRunId === undefined && !this.epochStore.hasAnyStoredData()) {
      this.isPlayingHistory = false;
      this.isLive = true;
      this.playheadTimeS = 0.0;
      this.activeSpatialSnapshot = null;
      this.resetRendererToLiveOrigin();
    }
    return accepted;
  }

  /**
   * Toggles play / pause state.
   * If currently live, transitions to historical mode paused at current playhead.
   * If in historical mode, toggles isPlayingHistory.
   */
  public togglePlayPause(): void {
    if (this.isLive) {
      this.isPlayingHistory = false;
      this.seekTo(this.playheadTimeS, false);
    } else {
      this.isPlayingHistory = !this.isPlayingHistory;
      this.options.onStatusChange?.(this.isLive, this.playheadTimeS);
    }
  }

  /**
   * Zooms in timeline centered at current view width.
   */
  public zoomIn(): void {
    this.renderer.zoomAt(this.renderer.cssWidth / 2, 0.8);
    this.renderer.render();
    this.isDirty = false;
  }

  /**
   * Zooms out timeline centered at current view width.
   */
  public zoomOut(): void {
    this.renderer.zoomAt(this.renderer.cssWidth / 2, 1.25);
    this.renderer.render();
    this.isDirty = false;
  }

  /**
   * Fits view window to maximum 60.0s retention horizon.
   */
  public fitHorizon(): void {
    this.renderer.setTimeWindow(this.renderer.viewStartTimeS, 60.0);
    this.renderer.render();
    this.isDirty = false;
  }

  /**
   * Returns active spatial snapshot for map projection.
   * Returns null when in live mode (direct worker telemetry is used).
   */
  public getActiveSpatialSnapshot(): SpatialFrameSnapshot | null {
    return this.isLive ? null : this.activeSpatialSnapshot;
  }

  /**
   * Resizes the timeline renderer canvas and triggers a redraw.
   */
  public resize(): void {
    this.renderer.resize();
  }

  /**
   * Advances historical playback by delta wall time.
   */
  public advanceHistoricalPlayback(dtS: number): void {
    if (!this.isPlayingHistory || this.isLive) return;

    const newTime = this.playheadTimeS + dtS * this.playbackSpeed;

    if (this.spatialBuffer.count > 0) {
      const newest = this.spatialBuffer.newestSnapshot;
      if (newest && newTime >= newest.simulationTimeS) {
        this.isPlayingHistory = false;
        this.seekTo(newest.simulationTimeS, false);
        return;
      }
    }

    this.seekTo(newTime, false);
  }
}
