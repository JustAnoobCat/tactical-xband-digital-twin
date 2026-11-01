/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Authoritative Transfer Metrics & ETA Calculations (Feature 1)
 *
 * Provides pure, deterministic functions for computing payload transfer rate
 * and estimated time to completion (ETA) strictly using simulation-time differences.
 */

export interface ActiveTransferTelemetry {
  readonly node_id: number;
  readonly status: 'IDLE' | 'TRANSMITTING' | 'BLOCKED_NLOS' | 'FAILED_DROPPED' | 'ACKNOWLEDGED';
  readonly status_message: string;
  readonly active_type: string | null;
  readonly total_bytes: number;
  readonly delivered_bytes: number;
  readonly dropped_bytes: number;
  readonly dropped_packets: number;
  readonly progress_pct: number;
  readonly start_time_s: number;
  readonly ack_time_s: number;
  readonly current_rate_bps: number;
  readonly current_rate_mbps: number;
  readonly eta_s: number | null;
  readonly eta_status: string;
}

/**
 * Calculates payload transfer rate in bits per second using simulation-time differences.
 * Strictly avoids wall-clock/performance.now() to ensure deterministic simulation-time accounting.
 *
 * @param deliveredBytesDelta Delta of delivered payload bytes between simulation steps
 * @param simTimeDeltaS Simulation time difference in seconds
 * @returns Rate in bits per second (bps)
 */
export function calculateTransferRateBps(
  deliveredBytesDelta: number,
  simTimeDeltaS: number
): number {
  if (simTimeDeltaS <= 0 || !Number.isFinite(simTimeDeltaS)) {
    return 0;
  }
  if (deliveredBytesDelta <= 0 || !Number.isFinite(deliveredBytesDelta)) {
    return 0;
  }
  return (deliveredBytesDelta * 8) / simTimeDeltaS;
}

/**
 * Computes an exponentially smoothed rate given previous rate, instantaneous rate, and smoothing alpha.
 */
export function smoothTransferRateBps(
  prevRateBps: number,
  instantRateBps: number,
  alpha: number = 0.3
): number {
  if (prevRateBps <= 0 || !Number.isFinite(prevRateBps)) {
    return Math.max(0, instantRateBps);
  }
  if (instantRateBps <= 0 || !Number.isFinite(instantRateBps)) {
    // Graceful decay when no bytes transferred in this frame
    return Math.max(0, prevRateBps * (1 - alpha));
  }
  return Math.max(0, prevRateBps * (1 - alpha) + instantRateBps * alpha);
}

/**
 * Calculates estimated remaining time in seconds and human-readable status text.
 * Strictly handles:
 * - Completed transfers (0.0s / COMPLETE)
 * - Blocked transfers (null / BLOCKED (PAUSED))
 * - Paused simulation (null / SIM PAUSED)
 * - Dropped payload (null / DROPPED)
 * - Zero rate or calculating state (null / CALCULATING)
 * - Standby/idle states
 */
export function calculateTransferEtaSeconds(
  remainingBytes: number,
  rateBps: number,
  status: string,
  isPaused: boolean
): { etaS: number | null; etaStatus: string } {
  if (status === 'IDLE' || !status) {
    return { etaS: null, etaStatus: 'STANDBY' };
  }
  if (status === 'ACKNOWLEDGED' || remainingBytes <= 0) {
    return { etaS: 0, etaStatus: 'COMPLETE' };
  }
  if (status === 'BLOCKED_NLOS') {
    return { etaS: null, etaStatus: 'BLOCKED (PAUSED)' };
  }
  if (status === 'FAILED_DROPPED') {
    return { etaS: null, etaStatus: 'DROPPED' };
  }
  if (status === 'IDLE' || !status) {
    return { etaS: null, etaStatus: 'STANDBY' };
  }
  if (isPaused) {
    return { etaS: null, etaStatus: 'SIM PAUSED' };
  }
  if (status !== 'TRANSMITTING') {
    return { etaS: null, etaStatus: status };
  }
  if (rateBps <= 0 || !Number.isFinite(rateBps)) {
    return { etaS: null, etaStatus: 'CALCULATING' };
  }

  const remainingBits = remainingBytes * 8;
  const etaS = remainingBits / rateBps;

  if (!Number.isFinite(etaS) || etaS < 0) {
    return { etaS: null, etaStatus: '--' };
  }

  const etaStatus = etaS < 60
    ? `${etaS.toFixed(1)}s`
    : `${Math.floor(etaS / 60)}m ${(etaS % 60).toFixed(0)}s`;

  return { etaS, etaStatus };
}
