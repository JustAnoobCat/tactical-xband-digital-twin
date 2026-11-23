/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Transport AIMD Congestion Control & Adaptive Video Bitrate Engine (V3-02)
 *
 * Implements:
 * 1. 4-Tier Hysteretic ISR Video ABR Ladder (0.30 Mbps to 6.00 Mbps).
 * 2. Pure Transport Additive Increase / Multiplicative Decrease (AIMD) Congestion Control.
 * 3. True Closed-Loop MAC/PHY Effective Capacity Coupling.
 *
 * Invariant Rules:
 * - 100% pure, functional, deterministic state-in/state-out operations.
 * - Zero module-level mutable state; zero Math.random() calls.
 * - Sub-microsecond execution profile (< 3 µs/call) protecting the 50 Hz sim loop.
 * - Numerical stability: NaN, Infinity, negative, and out-of-range inputs handled safely.
 */

import type { TransportAbrTelemetry } from '../shared/workerProtocol';

// -----------------------------------------------------------------------------
// 1. 4-Tier ISR Video Adaptive Bitrate (ABR) Ladder
// -----------------------------------------------------------------------------

export interface VideoAbrTier {
  readonly tierIndex: number;
  readonly name: string;
  readonly targetBitrateMbps: number;
  readonly minSnrDb: number;
  readonly maxBler: number;
  readonly maxQueueFill: number;
}

export const ISR_VIDEO_ABR_TIERS: readonly VideoAbrTier[] = Object.freeze([
  Object.freeze({
    tierIndex: 0,
    name: '360P_LOW_BW',
    targetBitrateMbps: 0.30,
    minSnrDb: -1.5,
    maxBler: 1.0,
    maxQueueFill: 1.0,
  }),
  Object.freeze({
    tierIndex: 1,
    name: '720P_TAC',
    targetBitrateMbps: 1.00,
    minSnrDb: 4.0,
    maxBler: 0.18,
    maxQueueFill: 0.75,
  }),
  Object.freeze({
    tierIndex: 2,
    name: '1080P_HD',
    targetBitrateMbps: 2.50,
    minSnrDb: 9.0,
    maxBler: 0.10,
    maxQueueFill: 0.55,
  }),
  Object.freeze({
    tierIndex: 3,
    name: '4K_EO_IR',
    targetBitrateMbps: 6.00,
    minSnrDb: 14.0,
    maxBler: 0.05,
    maxQueueFill: 0.35,
  }),
]);

export interface AbrState {
  readonly currentTierIndex: number;
  readonly healthyStreak: number;
}

export interface StepAbrParams {
  readonly snrDb: number;
  readonly bler: number;
  readonly queueFillRatio: number;
  readonly isOutage: boolean;
  readonly upSwitchHoldFrames?: number;
  readonly upSwitchSnrHysteresisDb?: number;
  readonly baselineVideoMbps?: number;
}

export type AbrAction = 'up' | 'down' | 'hold';

export interface StepAbrResult {
  readonly nextState: AbrState;
  readonly tierIndex: number;
  readonly tierName: string;
  readonly targetBitrateMbps: number;
  readonly bitrateScaleFactor: number;
  readonly action: AbrAction;
}

/**
 * Creates an initial clean ABR state (defaults to Tier 2: 1080P_HD).
 */
export function createInitialAbrState(initialTier: number = 2): AbrState {
  const tier = Number.isFinite(initialTier)
    ? Math.max(0, Math.min(ISR_VIDEO_ABR_TIERS.length - 1, Math.floor(initialTier)))
    : 2;
  return Object.freeze({
    currentTierIndex: tier,
    healthyStreak: 0,
  });
}

/**
 * Pure state transition function for the 4-tier tactical video ABR ladder.
 * - Immediate fast step-down on fade, BLER overshoot, queue congestion, or outage.
 * - Conservative hysteretic step-up requiring N consecutive healthy frames.
 */
export function stepAdaptiveVideoBitrate(
  state: AbrState,
  params: StepAbrParams
): StepAbrResult {
  const holdFrames = Number.isFinite(params.upSwitchHoldFrames) && (params.upSwitchHoldFrames ?? 0) > 0
    ? Math.floor(params.upSwitchHoldFrames!)
    : 15;
  const snrHysteresisDb = Number.isFinite(params.upSwitchSnrHysteresisDb)
    ? (params.upSwitchSnrHysteresisDb ?? 2.0)
    : 2.0;
  const baselineMbps = Number.isFinite(params.baselineVideoMbps) && (params.baselineVideoMbps ?? 0) > 0
    ? (params.baselineVideoMbps ?? 2.5)
    : 2.5;

  const snr = Number.isFinite(params.snrDb) ? params.snrDb : -100.0;
  const bler = Number.isFinite(params.bler) ? Math.max(0.0, Math.min(1.0, params.bler)) : 1.0;
  const queueFill = Number.isFinite(params.queueFillRatio)
    ? Math.max(0.0, Math.min(1.0, params.queueFillRatio))
    : 0.0;
  const isOutage = Boolean(params.isOutage);

  let currentTier = Number.isFinite(state?.currentTierIndex)
    ? Math.max(0, Math.min(ISR_VIDEO_ABR_TIERS.length - 1, Math.floor(state.currentTierIndex)))
    : 2;
  let healthyStreak = Number.isFinite(state?.healthyStreak)
    ? Math.max(0, Math.floor(state.healthyStreak))
    : 0;

  const currentTierDef = ISR_VIDEO_ABR_TIERS[currentTier];

  // 1. Check for immediate degradation
  const isDegraded = isOutage ||
    snr < currentTierDef.minSnrDb ||
    bler > currentTierDef.maxBler ||
    queueFill > currentTierDef.maxQueueFill;

  if (isDegraded) {
    if (isOutage) {
      currentTier = 0;
    } else {
      // Find highest sustainable tier strictly lower than current tier
      let targetTier = 0;
      for (let t = currentTier - 1; t >= 0; t--) {
        const candidate = ISR_VIDEO_ABR_TIERS[t];
        if (snr >= candidate.minSnrDb && bler <= candidate.maxBler && queueFill <= candidate.maxQueueFill) {
          targetTier = t;
          break;
        }
      }
      currentTier = targetTier;
    }

    const nextTierDef = ISR_VIDEO_ABR_TIERS[currentTier];
    return {
      nextState: Object.freeze({
        currentTierIndex: currentTier,
        healthyStreak: 0,
      }),
      tierIndex: currentTier,
      tierName: nextTierDef.name,
      targetBitrateMbps: nextTierDef.targetBitrateMbps,
      bitrateScaleFactor: nextTierDef.targetBitrateMbps / baselineMbps,
      action: 'down',
    };
  }

  // 2. Check for conservative step-up
  if (currentTier < ISR_VIDEO_ABR_TIERS.length - 1) {
    const nextTierDef = ISR_VIDEO_ABR_TIERS[currentTier + 1];
    const canStepUpCandidate =
      snr >= nextTierDef.minSnrDb + snrHysteresisDb &&
      bler <= nextTierDef.maxBler * 0.7 &&
      queueFill <= nextTierDef.maxQueueFill * 0.8;

    if (canStepUpCandidate) {
      healthyStreak += 1;
      if (healthyStreak >= holdFrames) {
        currentTier += 1;
        const upgradedDef = ISR_VIDEO_ABR_TIERS[currentTier];
        return {
          nextState: Object.freeze({
            currentTierIndex: currentTier,
            healthyStreak: 0,
          }),
          tierIndex: currentTier,
          tierName: upgradedDef.name,
          targetBitrateMbps: upgradedDef.targetBitrateMbps,
          bitrateScaleFactor: upgradedDef.targetBitrateMbps / baselineMbps,
          action: 'up',
        };
      }
      // Holding towards step-up
      return {
        nextState: Object.freeze({
          currentTierIndex: currentTier,
          healthyStreak,
        }),
        tierIndex: currentTier,
        tierName: currentTierDef.name,
        targetBitrateMbps: currentTierDef.targetBitrateMbps,
        bitrateScaleFactor: currentTierDef.targetBitrateMbps / baselineMbps,
        action: 'hold',
      };
    }
  }

  // 3. Steady hold at current tier; reset streak if channel doesn't qualify for next tier
  return {
    nextState: Object.freeze({
      currentTierIndex: currentTier,
      healthyStreak: 0,
    }),
    tierIndex: currentTier,
    tierName: currentTierDef.name,
    targetBitrateMbps: currentTierDef.targetBitrateMbps,
    bitrateScaleFactor: currentTierDef.targetBitrateMbps / baselineMbps,
    action: 'hold',
  };
}

// -----------------------------------------------------------------------------
// 2. Transport AIMD Congestion Control
// -----------------------------------------------------------------------------

export type AimdPhase = 'slow_start' | 'congestion_avoidance' | 'recovery';

export interface AimdState {
  readonly cwnd: number;
  readonly ssthresh: number;
  readonly phase: AimdPhase;
  readonly pacingRateMbps: number;
  readonly throttleScale: number;
}

export interface StepAimdParams {
  readonly ackedPackets: number;
  readonly lostPackets: number;
  readonly rttMs: number;
  readonly mssBytes?: number;
  readonly minCwnd?: number;
  readonly maxCwnd?: number;
  readonly beta?: number;
}

/**
 * Instantiates an initial AIMD state (default cwnd=4, ssthresh=32).
 */
export function createInitialAimdState(
  initialCwnd: number = 4,
  initialSsthresh: number = 32
): AimdState {
  const cwnd = Number.isFinite(initialCwnd) ? Math.max(1, initialCwnd) : 4;
  const ssthresh = Number.isFinite(initialSsthresh) ? Math.max(1, initialSsthresh) : 32;
  const pacingRateMbps = (cwnd * 1200 * 8) / (20.0 * 1000);
  const throttleScale = Math.max(0.1, Math.min(1.0, cwnd / 128.0));

  return Object.freeze({
    cwnd,
    ssthresh,
    phase: 'slow_start',
    pacingRateMbps,
    throttleScale,
  });
}

/**
 * Pure state transition function for Transport AIMD Congestion Control.
 * - Multiplicative decrease on packet loss: ssthresh = max(minCwnd, cwnd * beta), cwnd = ssthresh.
 * - Additive increase on ACKs: exponential in slow-start, linear in congestion avoidance.
 * - Bounded pacing rate and throttle scale calculation.
 */
export function stepAimdCongestionControl(
  state: AimdState,
  params: StepAimdParams
): AimdState {
  const minCwnd = Number.isFinite(params.minCwnd) && (params.minCwnd ?? 0) >= 1
    ? params.minCwnd!
    : 1;
  const maxCwnd = Number.isFinite(params.maxCwnd) && (params.maxCwnd ?? 0) >= minCwnd
    ? params.maxCwnd!
    : 128;
  const beta = Number.isFinite(params.beta) && (params.beta ?? 0) > 0 && (params.beta ?? 0) < 1
    ? params.beta!
    : 0.5;
  const mssBytes = Number.isFinite(params.mssBytes) && (params.mssBytes ?? 0) > 0
    ? params.mssBytes!
    : 1200;
  const rttMs = Number.isFinite(params.rttMs) && (params.rttMs ?? 0) > 0
    ? Math.max(1.0, params.rttMs)
    : 20.0;

  let cwnd = Number.isFinite(state?.cwnd) ? Math.max(minCwnd, Math.min(maxCwnd, state.cwnd)) : 4;
  let ssthresh = Number.isFinite(state?.ssthresh) ? Math.max(minCwnd, state.ssthresh) : 32;
  let phase: AimdPhase = state?.phase ?? 'slow_start';

  const acked = Number.isFinite(params.ackedPackets) ? Math.max(0, Math.floor(params.ackedPackets)) : 0;
  const lost = Number.isFinite(params.lostPackets) ? Math.max(0, Math.floor(params.lostPackets)) : 0;

  if (lost > 0) {
    ssthresh = Math.max(minCwnd, cwnd * beta);
    cwnd = ssthresh;
    phase = 'recovery';
  } else if (acked > 0) {
    if (cwnd < ssthresh) {
      cwnd = Math.min(maxCwnd, cwnd + acked);
      phase = 'slow_start';
    } else {
      cwnd = Math.min(maxCwnd, cwnd + acked / Math.max(1.0, cwnd));
      phase = 'congestion_avoidance';
    }
  }

  // Ensure strict bounding
  cwnd = Math.max(minCwnd, Math.min(maxCwnd, cwnd));
  ssthresh = Math.max(minCwnd, ssthresh);

  const pacingRateMbps = (cwnd * mssBytes * 8) / (Math.max(1.0, rttMs) * 1000.0);
  const rawThrottle = cwnd / maxCwnd;
  const throttleScale = Math.max(0.1, Math.min(1.0, Number.isFinite(rawThrottle) ? rawThrottle : 0.1));

  return Object.freeze({
    cwnd,
    ssthresh,
    phase,
    pacingRateMbps: Number.isFinite(pacingRateMbps) ? pacingRateMbps : 0.0,
    throttleScale,
  });
}

// -----------------------------------------------------------------------------
// 3. Closed-Loop Effective Capacity Coupler
// -----------------------------------------------------------------------------

export interface ClosedLoopCapacityParams {
  readonly dynamicGuardEfficiency: number;
  readonly slotCollisionOutage: boolean;
  readonly delayedCqiBler: number;
  readonly harqActiveRetx: boolean;
  readonly harqCombinedSnrMarginDb?: number;
}

/**
 * Pure evaluator computing the closed-loop effective capacity scaling factor in [0.0, 1.0].
 * Coupler applies:
 * - Total slot collapse (0.0) if timing advance error produces slot collision outage.
 * - Dynamic guard interval efficiency scale from slant-range propagation delay.
 * - 50% airtime deduction if slot is consumed by an active HARQ retransmission.
 * - Residual BLER transport delivery factor (1 - BLER).
 */
export function computeClosedLoopEffectiveCapacityScale(
  params: ClosedLoopCapacityParams
): number {
  if (params.slotCollisionOutage) {
    return 0.0;
  }

  const guardEff = Number.isFinite(params.dynamicGuardEfficiency)
    ? Math.max(0.0, Math.min(1.0, params.dynamicGuardEfficiency))
    : 1.0;

  const retxOverheadFactor = params.harqActiveRetx ? 0.5 : 1.0;

  const residualBler = Number.isFinite(params.delayedCqiBler)
    ? Math.max(0.0, Math.min(1.0, params.delayedCqiBler))
    : 0.0;
  const effectiveDeliveryFactor = Math.max(0.0, Math.min(1.0, 1.0 - residualBler));

  const rawScale = guardEff * retxOverheadFactor * effectiveDeliveryFactor;
  return Number.isFinite(rawScale) ? Math.max(0.0, Math.min(1.0, rawScale)) : 0.0;
}

// -----------------------------------------------------------------------------
// 4. Pure Transport/ABR Telemetry & Node Step Evaluators
// -----------------------------------------------------------------------------

export interface NodeTransportAbrStepParams {
  readonly aimdState: AimdState;
  readonly abrState: AbrState;
  readonly isOutage: boolean;
  readonly snrDb: number;
  readonly effectiveBler: number;
  readonly queueFillRatio: number;
  readonly slantRangeM: number;
  readonly speedOfLight: number;
}

export interface NodeTransportAbrStepResult {
  readonly nextAimd: AimdState;
  readonly nextAbr: AbrState;
  readonly abrAction: 'hold' | 'up' | 'down';
}

/**
 * Pure evaluator for stepping a single node's Transport AIMD and Video ABR.
 */
export function evaluateNodeTransportAbr(params: NodeTransportAbrStepParams): NodeTransportAbrStepResult {
  const abrRes = stepAdaptiveVideoBitrate(params.abrState, {
    snrDb: params.snrDb,
    bler: params.effectiveBler,
    queueFillRatio: params.queueFillRatio,
    isOutage: params.isOutage,
  });

  const rttMs = Math.max(1.0, ((2.0 * Math.max(0, params.slantRangeM)) / params.speedOfLight) * 1000.0);
  const hasLoss = params.isOutage || params.effectiveBler > 0.4 || params.queueFillRatio > 0.8;
  const acked = hasLoss ? 0 : 1;
  const lost = hasLoss ? 1 : 0;

  const nextAimd = stepAimdCongestionControl(params.aimdState, {
    ackedPackets: acked,
    lostPackets: lost,
    rttMs,
  });

  return {
    nextAimd,
    nextAbr: abrRes.nextState,
    abrAction: abrRes.action,
  };
}

export interface ComputeTransportAbrTelemetryParams {
  readonly enabled: boolean;
  readonly nodeIds: readonly number[];
  readonly aimdStateByNode: ReadonlyMap<number, AimdState>;
  readonly abrStateByNode: ReadonlyMap<number, AbrState>;
  readonly closedLoopCapacityScaleByNode: ReadonlyMap<number, number>;
  readonly selectedNodeId?: number | null;
  readonly abrStepDownsTotal: number;
  readonly abrStepUpsTotal: number;
}

/**
 * Pure helper constructing the TransportAbrTelemetry block for TelemetryFrame.
 */
export function computeTransportAbrTelemetry(params: ComputeTransportAbrTelemetryParams): TransportAbrTelemetry {
  const n = params.nodeIds.length;
  if (n === 0) {
    return {
      enabled: params.enabled,
      mean_cwnd_packets: 0,
      mean_video_bitrate_mbps: 0,
      active_video_tier_label: '1080P_HD',
      abr_step_downs: params.abrStepDownsTotal,
      abr_step_ups: params.abrStepUpsTotal,
      mean_closed_loop_capacity_scale: 1.0,
    };
  }

  let sumScale = 0;
  for (let i = 0; i < n; i++) {
    sumScale += params.closedLoopCapacityScaleByNode.get(params.nodeIds[i]) ?? 1.0;
  }
  const meanClosedLoopScale = sumScale / n;

  if (!params.enabled) {
    return {
      enabled: false,
      mean_cwnd_packets: 0,
      mean_video_bitrate_mbps: 0,
      active_video_tier_label: '1080P_HD',
      abr_step_downs: params.abrStepDownsTotal,
      abr_step_ups: params.abrStepUpsTotal,
      mean_closed_loop_capacity_scale: meanClosedLoopScale,
    };
  }

  let sumCwnd = 0;
  let sumBitrate = 0;
  let activeTier = '1080P_HD';

  for (let i = 0; i < n; i++) {
    const nid = params.nodeIds[i];
    const aimd = params.aimdStateByNode.get(nid);
    const abr = params.abrStateByNode.get(nid);
    sumCwnd += aimd ? aimd.cwnd : 4;
    const tierIdx = abr ? abr.currentTierIndex : 2;
    const tierDef = ISR_VIDEO_ABR_TIERS[tierIdx] ?? ISR_VIDEO_ABR_TIERS[2];
    sumBitrate += tierDef.targetBitrateMbps;
    if (i === 0) activeTier = tierDef.name;
  }

  if (params.selectedNodeId !== undefined && params.selectedNodeId !== null) {
    const selAbr = params.abrStateByNode.get(params.selectedNodeId);
    if (selAbr) {
      activeTier = ISR_VIDEO_ABR_TIERS[selAbr.currentTierIndex]?.name ?? activeTier;
    }
  }

  return {
    enabled: true,
    mean_cwnd_packets: sumCwnd / n,
    mean_video_bitrate_mbps: sumBitrate / n,
    active_video_tier_label: activeTier,
    abr_step_downs: params.abrStepDownsTotal,
    abr_step_ups: params.abrStepUpsTotal,
    mean_closed_loop_capacity_scale: meanClosedLoopScale,
  };
}
