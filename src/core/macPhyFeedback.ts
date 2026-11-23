/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Core MAC/PHY Feedback Dynamics Engine (Work Package 06)
 *
 * Implements:
 * 1. Delayed CQI Aging & 3GPP Outer-Loop Link Adaptation (OLLA) AMC Evaluator.
 * 2. Pure RTT-Delayed HARQ Process Pool with Chase Combining (CC) and
 *    Incremental Redundancy (IR) coding gain.
 * 3. Range-Coupled Dynamic TDMA Guard Period & RACH Control Overhead Evaluator.
 *
 * Invariant Rules:
 * - 100% pure, functional, deterministic state-in/state-out operations.
 * - Zero module-level mutable state; zero Math.random() calls.
 * - Deterministic 32-bit integer PRNG hashing for stochastic BLER trials.
 * - Sub-microsecond execution profile (< 5 µs/call) protecting the 50 Hz sim loop.
 */

import { MODCOD_TABLE, type ModCodEntry } from './linkBudget';
import { SPEED_OF_LIGHT_M_S } from './rfPropagationMath';

export { SPEED_OF_LIGHT_M_S };

// -----------------------------------------------------------------------------
// 1. Delayed CQI & OLLA AMC Evaluator
// -----------------------------------------------------------------------------

export interface EvaluateDelayedCqiAmcParams {
  readonly reportedSnrDb: number;
  readonly actualSnrDb: number;
  readonly ollaOffsetDb?: number;
  readonly kSlope?: number;
}

export interface DelayedCqiAmcResult {
  readonly selectedModcod: ModCodEntry | null;
  readonly effectiveReportedSnrDb: number;
  readonly snrMarginDb: number;
  readonly bler: number;
  readonly mcsOvershootDb: number;
  readonly isLinkOutage: boolean;
}

/**
 * Computes CQI feedback round-trip aging in integer discrete frames.
 * Returns 0 if explicit genie-aided mode is requested.
 *
 * L_CQI = max(1, ceil((2 * d_slant / c * 1000 + T_proc) / T_frame))
 */
export function computeCqiLagFrames(
  slantRangeM: number,
  frameDurationMs: number,
  processingDelayMs: number = 4.0,
  genieAided: boolean = false
): number {
  if (genieAided) {
    return 0;
  }
  const frameMs = Number.isFinite(frameDurationMs) && frameDurationMs > 0 ? frameDurationMs : 20.0;
  const rangeM = Number.isFinite(slantRangeM) ? Math.max(0, slantRangeM) : 0;
  const procMs = Number.isFinite(processingDelayMs) ? Math.max(0, processingDelayMs) : 4.0;

  const propRttMs = ((2.0 * rangeM) / SPEED_OF_LIGHT_M_S) * 1000.0;
  const totalFeedbackMs = propRttMs + procMs;
  return Math.max(1, Math.ceil(totalFeedbackMs / frameMs));
}

/**
 * Steps the 3GPP Outer-Loop Link Adaptation (OLLA) SNR offset based on ACK/NACK feedback.
 *
 * On ACK:  offset - stepUpDb * (targetBler / (1 - targetBler))
 * On NACK: offset + stepUpDb
 * Clamped strictly to [minOffsetDb, maxOffsetDb].
 */
export function stepOllaOffsetDb(
  currentOffsetDb: number,
  acked: boolean,
  targetBler: number = 0.1,
  stepUpDb: number = 0.25,
  minOffsetDb: number = -3.0,
  maxOffsetDb: number = 12.0
): number {
  let offset = Number.isFinite(currentOffsetDb) ? currentOffsetDb : 0.0;
  const pTarget = Number.isFinite(targetBler) && targetBler > 0 && targetBler < 1 ? targetBler : 0.1;
  const stepUp = Number.isFinite(stepUpDb) && stepUpDb > 0 ? stepUpDb : 0.25;
  const minVal = Number.isFinite(minOffsetDb) ? minOffsetDb : -3.0;
  const maxVal = Number.isFinite(maxOffsetDb) ? maxOffsetDb : 12.0;
  const effectiveMin = Math.min(minVal, maxVal);
  const effectiveMax = Math.max(minVal, maxVal);

  if (acked) {
    const stepDown = stepUp * (pTarget / (1.0 - pTarget));
    offset -= stepDown;
  } else {
    offset += stepUp;
  }

  return Math.max(effectiveMin, Math.min(effectiveMax, offset));
}

/**
 * Selects DVB-S2X MODCOD using stale reported SNR backed off by OLLA,
 * then evaluates actual transport block BLER using physical channel SNR.
 */
export function evaluateDelayedCqiAmc(params: EvaluateDelayedCqiAmcParams): DelayedCqiAmcResult {
  const reportedSnr = Number.isFinite(params.reportedSnrDb) ? params.reportedSnrDb : -100.0;
  const actualSnr = Number.isFinite(params.actualSnrDb) ? params.actualSnrDb : -100.0;
  const ollaOffset = Number.isFinite(params.ollaOffsetDb) ? (params.ollaOffsetDb ?? 0.0) : 0.0;
  const kSlope = Number.isFinite(params.kSlope) && (params.kSlope ?? 0) > 0 ? (params.kSlope as number) : 2.2;

  const effectiveReportedSnrDb = reportedSnr - ollaOffset;

  // MODCOD selection: highest operational MODCOD with minSnrDb <= effectiveReportedSnrDb
  let selectedModcod: ModCodEntry | null = null;
  for (let i = 0; i < MODCOD_TABLE.length; i++) {
    const entry = MODCOD_TABLE[i];
    if (effectiveReportedSnrDb >= entry.minSnrDb) {
      selectedModcod = entry;
      break;
    }
  }

  if (!selectedModcod) {
    // Cannot support even lowest operational MODCOD (pi/2-BPSK 1/3 at -1.5 dB)
    const lowestMinSnr = MODCOD_TABLE[MODCOD_TABLE.length - 1]?.minSnrDb ?? -1.5;
    const snrMarginDb = actualSnr - lowestMinSnr;
    return {
      selectedModcod: null,
      effectiveReportedSnrDb,
      snrMarginDb,
      bler: 1.0,
      mcsOvershootDb: Math.max(0, -snrMarginDb),
      isLinkOutage: true,
    };
  }

  const reqSnrDb = selectedModcod.minSnrDb;
  const snrMarginDb = actualSnr - reqSnrDb;
  const mcsOvershootDb = Math.max(0, reqSnrDb - actualSnr);

  // Smooth logistic waterfall BLER curve: BLER = 1 / (1 + exp(kSlope * (gamma_actual - gamma_req)))
  const exponent = kSlope * snrMarginDb;
  // Guard against numeric overflow/underflow in Math.exp
  let bler: number;
  if (exponent > 40.0) {
    bler = 0.0;
  } else if (exponent < -40.0) {
    bler = 1.0;
  } else {
    bler = 1.0 / (1.0 + Math.exp(exponent));
  }

  return {
    selectedModcod,
    effectiveReportedSnrDb,
    snrMarginDb,
    bler,
    mcsOvershootDb,
    isLinkOutage: false,
  };
}

// -----------------------------------------------------------------------------
// 2. Pure RTT-Delayed HARQ Process Pool with CC & IR
// -----------------------------------------------------------------------------

export type HarqCombiningMode = 'chase' | 'ir';
export type HarqProcessState = 'IDLE' | 'WAITING_RTT' | 'COMPLETED';
export type HarqStepEvent = 'IDLE' | 'TX_PENDING_RTT' | 'ACK' | 'NACK_RETRY_SCHEDULED' | 'HARQ_FAILURE';

export interface HarqProcessSlot {
  readonly processId: number;
  readonly state: HarqProcessState;
  readonly txCount: number;
  readonly lastTxTimeMs: number;
  readonly snrHistoryDb: readonly number[];
}

export interface StepHarqParams {
  readonly currentTimeMs: number;
  readonly slantRangeM: number;
  readonly actualSnrDb: number;
  readonly requiredSnrDb: number;
  readonly combiningMode?: HarqCombiningMode;
  readonly maxRetransmissions?: number;
  readonly processingTurnaroundMs?: number;
  readonly frameIndex?: number;
  readonly seed?: number;
  readonly kSlope?: number;
}

export interface StepHarqResult {
  readonly nextSlot: HarqProcessSlot;
  readonly event: HarqStepEvent;
  readonly combinedSnrDb: number;
  readonly bler: number;
  readonly rttWaitMs: number;
}

/**
 * Computes combined effective SNR after multiple HARQ transmissions.
 *
 * Chase Combining:
 *   gamma_CC = 10 * log10( sum(10^(gamma_j / 10)) )
 *
 * Incremental Redundancy:
 *   gamma_IR = gamma_CC + Delta_IR(k)
 *   where Delta_IR(0) = 0 dB, Delta_IR(1) = 1.0 dB, Delta_IR(>=2) = 1.5 dB.
 */
export function computeHarqCombinedSnrDb(
  snrHistoryDb: readonly number[],
  combiningMode: HarqCombiningMode = 'chase'
): number {
  if (!snrHistoryDb || snrHistoryDb.length === 0) {
    return -Infinity;
  }

  let linearPowerSum = 0.0;
  for (let i = 0; i < snrHistoryDb.length; i++) {
    const snr = snrHistoryDb[i];
    if (Number.isFinite(snr)) {
      linearPowerSum += Math.pow(10.0, snr / 10.0);
    }
  }

  if (linearPowerSum <= 0.0 || !Number.isFinite(linearPowerSum)) {
    return -Infinity;
  }

  const chaseSnrDb = 10.0 * Math.log10(linearPowerSum);

  if (combiningMode === 'ir') {
    const retransmissions = snrHistoryDb.length - 1;
    let irGainDb = 0.0;
    if (retransmissions === 1) {
      irGainDb = 1.0;
    } else if (retransmissions >= 2) {
      irGainDb = 1.5;
    }
    return chaseSnrDb + irGainDb;
  }

  return chaseSnrDb;
}

/**
 * Pure 32-bit Murmur-style integer hash PRNG mapping 4 integer seeds into [0, 1).
 * Completely deterministic and free of mutable runtime state or Math.random().
 */
export function hashUnitInterval(
  seed: number,
  frameIndex: number,
  processId: number,
  txCount: number
): number {
  const s = (Number.isFinite(seed) ? Math.floor(seed) : 1337) >>> 0;
  const f = (Number.isFinite(frameIndex) ? Math.floor(frameIndex) : 0) >>> 0;
  const p = (Number.isFinite(processId) ? Math.floor(processId) : 0) >>> 0;
  const t = (Number.isFinite(txCount) ? Math.floor(txCount) : 0) >>> 0;

  let h = (Math.imul(s ^ 0xdeadbeef, 0x85ebca6b) ^
           Math.imul(f, 0xc2b2ae35) ^
           Math.imul(p, 0x27d4eb2f) ^
           Math.imul(t, 0x165667b1)) >>> 0;

  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;

  return (h >>> 0) / 4294967296.0;
}

/**
 * Instantiates an idle, clean HARQ process slot.
 */
export function createHarqProcessSlot(processId: number): HarqProcessSlot {
  return {
    processId: Number.isFinite(processId) ? Math.floor(processId) : 0,
    state: 'IDLE',
    txCount: 0,
    lastTxTimeMs: 0.0,
    snrHistoryDb: Object.freeze([]),
  };
}

/**
 * Minimum number of parallel HARQ processes required to saturate long-RTT links:
 * N_HARQ >= ceil((RTT + 2 * T_proc) / T_slot)
 */
export function computeMinimumHarqProcesses(
  slantRangeM: number,
  slotDurationMs: number,
  processingTurnaroundMs: number = 2.0
): number {
  const rangeM = Number.isFinite(slantRangeM) ? Math.max(0, slantRangeM) : 0.0;
  const slotMs = Number.isFinite(slotDurationMs) && slotDurationMs > 0 ? slotDurationMs : 1.0;
  const procMs = Number.isFinite(processingTurnaroundMs) ? Math.max(0, processingTurnaroundMs) : 2.0;

  const rttMs = ((2.0 * rangeM) / SPEED_OF_LIGHT_M_S) * 1000.0;
  const loopMs = rttMs + 2.0 * procMs;
  return Math.max(1, Math.ceil(loopMs / slotMs));
}

/**
 * Pure transition function for a single HARQ process slot.
 * Enforces the physical RTT turnaround barrier and evaluates combined-SNR BLER.
 */
export function stepHarqProcess(slot: HarqProcessSlot, params: StepHarqParams): StepHarqResult {
  const nowMs = Number.isFinite(params.currentTimeMs) ? params.currentTimeMs : 0.0;
  const slantM = Number.isFinite(params.slantRangeM) ? Math.max(0, params.slantRangeM) : 0.0;
  const actualSnr = Number.isFinite(params.actualSnrDb) ? params.actualSnrDb : -100.0;
  const reqSnr = Number.isFinite(params.requiredSnrDb) ? params.requiredSnrDb : 0.0;
  const mode: HarqCombiningMode = params.combiningMode === 'ir' ? 'ir' : 'chase';
  const maxRetries = Number.isFinite(params.maxRetransmissions) ? Math.max(0, Math.floor(params.maxRetransmissions!)) : 3;
  const procTurnaroundMs = Number.isFinite(params.processingTurnaroundMs) ? Math.max(0, params.processingTurnaroundMs!) : 2.0;
  const frameIdx = Number.isFinite(params.frameIndex) ? Math.floor(params.frameIndex!) : 0;
  const seed = Number.isFinite(params.seed) ? params.seed! : 1337;
  const kSlope = Number.isFinite(params.kSlope) && params.kSlope! > 0 ? params.kSlope! : 2.2;

  const rttMs = ((2.0 * slantM) / SPEED_OF_LIGHT_M_S) * 1000.0;
  const turnaroundWaitTotalMs = rttMs + procTurnaroundMs;

  // 1. Check if process is waiting for physical RTT + decoding turnaround
  if (slot.state === 'WAITING_RTT') {
    const elapsedSinceTxMs = nowMs - slot.lastTxTimeMs;
    if (elapsedSinceTxMs < turnaroundWaitTotalMs - 1e-6) {
      // Turnaround barrier in effect; cannot retransmit yet
      const combinedSnr = computeHarqCombinedSnrDb(slot.snrHistoryDb, mode);
      const margin = combinedSnr - reqSnr;
      const bler = 1.0 / (1.0 + Math.exp(kSlope * margin));
      const remainingWaitMs = Math.max(0.0, turnaroundWaitTotalMs - elapsedSinceTxMs);
      return {
        nextSlot: slot,
        event: 'TX_PENDING_RTT',
        combinedSnrDb: combinedSnr,
        bler: Math.max(0, Math.min(1, bler)),
        rttWaitMs: remainingWaitMs,
      };
    }
  }

  // 2. Perform transmission (either attempt 1 from IDLE or retransmission after RTT elapsed)
  const newTxCount = slot.txCount + 1;
  const newSnrHistory = Object.freeze([...slot.snrHistoryDb, actualSnr]);
  const combinedSnrDb = computeHarqCombinedSnrDb(newSnrHistory, mode);
  const marginDb = combinedSnrDb - reqSnr;

  const exponent = kSlope * marginDb;
  let bler: number;
  if (exponent > 40.0) {
    bler = 0.0;
  } else if (exponent < -40.0) {
    bler = 1.0;
  } else {
    bler = 1.0 / (1.0 + Math.exp(exponent));
  }
  bler = Math.max(0, Math.min(1, bler));

  // Deterministic stochastic outcome
  const u = hashUnitInterval(seed, frameIdx, slot.processId, newTxCount);
  const isAck = u >= bler;

  if (isAck) {
    // Successfully decoded; release slot back to IDLE
    const nextSlot: HarqProcessSlot = {
      processId: slot.processId,
      state: 'IDLE',
      txCount: 0,
      lastTxTimeMs: nowMs,
      snrHistoryDb: Object.freeze([]),
    };
    return {
      nextSlot,
      event: 'ACK',
      combinedSnrDb,
      bler,
      rttWaitMs: 0.0,
    };
  }

  // NACK occurred: check if maxRetransmissions exhausted
  const retransmissionsAttempted = newTxCount - 1;
  if (retransmissionsAttempted >= maxRetries) {
    // HARQ Failure; release slot back to IDLE
    const nextSlot: HarqProcessSlot = {
      processId: slot.processId,
      state: 'IDLE',
      txCount: 0,
      lastTxTimeMs: nowMs,
      snrHistoryDb: Object.freeze([]),
    };
    return {
      nextSlot,
      event: 'HARQ_FAILURE',
      combinedSnrDb,
      bler,
      rttWaitMs: 0.0,
    };
  }

  // Schedule retransmission after RTT turnaround
  const nextSlot: HarqProcessSlot = {
    processId: slot.processId,
    state: 'WAITING_RTT',
    txCount: newTxCount,
    lastTxTimeMs: nowMs,
    snrHistoryDb: newSnrHistory,
  };
  return {
    nextSlot,
    event: 'NACK_RETRY_SCHEDULED',
    combinedSnrDb,
    bler,
    rttWaitMs: turnaroundWaitTotalMs,
  };
}

// -----------------------------------------------------------------------------
// 3. Dynamic Range-Coupled TDMA Guard Period & RACH Overhead Evaluator
// -----------------------------------------------------------------------------

export interface DynamicTdmaOverheadParams {
  readonly slotDurationMs: number;
  readonly slotsPerFrame: number;
  readonly slantRangeM: number;
  readonly timingAdvanceActive: boolean;
  readonly taResidualErrorM?: number;
  readonly rfSwitchGuardUs?: number;
  readonly preambleUs?: number;
  readonly rachControlSlotsPerFrame?: number;
}

export interface DynamicTdmaOverheadResult {
  readonly requiredGuardUs: number;
  readonly propagationRttUs: number;
  readonly usableSlotUs: number;
  readonly slotCollisionOutage: boolean;
  readonly dataSlotsPerFrame: number;
  readonly controlSlotsPerFrame: number;
  readonly slotEfficiency: number;
  readonly frameDataEfficiency: number;
}

/**
 * Computes dynamic TDMA guard time, slot usability, collision outage,
 * and net frame data-plane efficiency coupled to slant range, Timing Advance (TA)
 * lock status, and RACH control slot reservation.
 */
export function computeDynamicTdmaOverhead(params: DynamicTdmaOverheadParams): DynamicTdmaOverheadResult {
  const slotDurationMs = Number.isFinite(params.slotDurationMs) ? Math.max(0.0, params.slotDurationMs) : 0.0;
  const slotsPerFrame = Number.isFinite(params.slotsPerFrame) ? Math.max(1, Math.floor(params.slotsPerFrame)) : 1;
  const slantRangeM = Number.isFinite(params.slantRangeM) ? Math.max(0.0, params.slantRangeM) : 0.0;
  const taActive = params.timingAdvanceActive === true;
  const taResidualErrorM = Number.isFinite(params.taResidualErrorM) ? Math.max(0.0, params.taResidualErrorM!) : 50.0;
  const rfSwitchGuardUs = Number.isFinite(params.rfSwitchGuardUs) ? Math.max(0.0, params.rfSwitchGuardUs!) : 20.0;
  const preambleUs = Number.isFinite(params.preambleUs) ? Math.max(0.0, params.preambleUs!) : 0.0;
  const rachSlots = Number.isFinite(params.rachControlSlotsPerFrame) ? Math.max(0, Math.floor(params.rachControlSlotsPerFrame!)) : 0;

  const propagationRttUs = ((2.0 * slantRangeM) / SPEED_OF_LIGHT_M_S) * 1e6;

  let requiredGuardUs: number;
  if (taActive) {
    const taResidualRttUs = ((2.0 * taResidualErrorM) / SPEED_OF_LIGHT_M_S) * 1e6;
    requiredGuardUs = Math.max(rfSwitchGuardUs, taResidualRttUs + rfSwitchGuardUs);
  } else {
    // Open-loop / TA lost: guard must cover full two-way propagation RTT
    requiredGuardUs = propagationRttUs + rfSwitchGuardUs;
  }

  const slotDurationUs = slotDurationMs * 1000.0;
  const totalOverheadUs = requiredGuardUs + preambleUs;
  const usableSlotUs = Math.max(0.0, slotDurationUs - totalOverheadUs);
  const slotCollisionOutage = slotDurationUs <= 0.0 || totalOverheadUs >= slotDurationUs;

  const controlSlotsPerFrame = Math.min(slotsPerFrame, rachSlots);
  const dataSlotsPerFrame = Math.max(0, slotsPerFrame - controlSlotsPerFrame);

  const slotEfficiency = (!slotCollisionOutage && slotDurationUs > 0.0)
    ? (usableSlotUs / slotDurationUs)
    : 0.0;

  const frameDataEfficiency = (!slotCollisionOutage && slotsPerFrame > 0)
    ? slotEfficiency * (dataSlotsPerFrame / slotsPerFrame)
    : 0.0;

  return {
    requiredGuardUs,
    propagationRttUs,
    usableSlotUs,
    slotCollisionOutage,
    dataSlotsPerFrame,
    controlSlotsPerFrame,
    slotEfficiency,
    frameDataEfficiency,
  };
}
