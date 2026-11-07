/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Historical Session Coordinator (Milestone 5)
 *
 * Coordinates the shared pause/resume simulation lifecycle between multiple
 * independent historical inspection timelines (RF Profile History on Tab 3
 * and Scheduler Performance History on Tab 2).
 *
 * Guarantees:
 * 1. Entering historical inspection on any timeline pauses the live worker if it was running.
 * 2. If the user scrubs a second timeline while already inspecting the first, the prior
 *    running state is preserved (not overwritten by the paused state).
 * 3. Returning one timeline to LIVE never resumes the worker while any other timeline
 *    remains in historical inspection mode.
 * 4. Resuming the worker only occurs when all timelines have returned to LIVE AND the
 *    simulation was running before historical inspection began.
 * 5. If the simulation was initially paused, returning all timelines to LIVE leaves it paused.
 */

export class HistoricalSessionCoordinator {
  private wasRunningBeforeSession: boolean = false;

  /**
   * Called when an inspection timeline requests to enter historical mode.
   * Only records the live running state if this is the transition from completely live.
   */
  public onEnterHistorical(options: {
    isCurrentlyRunning: boolean;
    rfInspecting: boolean;
    schedInspecting: boolean;
  }): { shouldPauseWorker: boolean } {
    if (!options.rfInspecting && !options.schedInspecting) {
      this.wasRunningBeforeSession = options.isCurrentlyRunning;
      return { shouldPauseWorker: options.isCurrentlyRunning };
    }
    return { shouldPauseWorker: false };
  }

  /**
   * Called when an inspection timeline exits historical mode.
   * Only permits resuming the worker if NO timeline remains in historical mode
   * and the simulation was running before inspection started.
   */
  public onExitHistorical(options: {
    rfInspecting: boolean;
    schedInspecting: boolean;
  }): { shouldResumeWorker: boolean } {
    if (!options.rfInspecting && !options.schedInspecting) {
      const resume = this.wasRunningBeforeSession;
      this.wasRunningBeforeSession = false;
      return { shouldResumeWorker: resume };
    }
    return { shouldResumeWorker: false };
  }

  public get wasRunningBefore(): boolean {
    return this.wasRunningBeforeSession;
  }

  /**
   * Resets coordinator state when the simulation is reset.
   */
  public reset(): void {
    this.wasRunningBeforeSession = false;
  }
}

