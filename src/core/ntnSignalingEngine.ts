/**
 * src/core/ntnSignalingEngine.ts
 *
 * First-Principles 3GPP Rel-17 NTN RACH, Timing Advance & Mobility Signaling Engine.
 *
 * Implements 3GPP Rel-17 Non-Terrestrial Network (NTN) protocol procedures:
 * 1. 3GPP TS 38.213 §4.2 / §4.3: Timing Advance (TA) acquisition and 12-bit command indexing
 *    with SCS 30 kHz granularity (0.26 μs step size) over airborne propagation distances.
 * 2. 3GPP TS 38.321 / TS 38.300: 4-Step Contention-Based Random Access (CBRA) procedure:
 *    - Msg1: PRACH Preamble with deterministic Zadoff-Chu sequence index selection
 *    - Msg2: Random Access Response (RAR) with Timing Advance Command and TC-RNTI
 *    - Msg3: RRCSetupRequest with 5QI Bearer Buffer Status Report (BSR) multiplexing
 *    - Msg4: Contention Resolution & RRC State verification
 * 3. 3GPP TS 38.331: RRC State Machine (CONNECTED, SYNCHRONIZING, RLF_RECOVERY, IDLE)
 *    and Event A3 (Neighbour becomes offset better than SpCell) Inter-Sector Handover Call Flows.
 */

export const SPEED_OF_LIGHT_M_S = 299792458.0;

/** 3GPP TS 38.213: 30 kHz SCS timing advance step size in microseconds (16 * 64 * Tc = 0.2604 μs -> 0.26 μs nominal) */
export const TA_STEP_US = 0.26;

/** Maximum 12-bit Timing Advance Command index in 3GPP Rel-17 NTN (2^12 - 250 = 3846) */
export const MAX_TA_INDEX = 3846;
export const MIN_TA_INDEX = 0;

/** Base C-RNTI allocation offset (0x4E00) for deterministic UE terminal identification */
export const BASE_CRNTI_OFFSET = 0x4E00;

export type NtnRrcState =
  | 'RRC_CONNECTED'
  | 'RRC_SYNCHRONIZING'
  | 'RRC_RLF_RECOVERY'
  | 'RRC_IDLE';

export type NtnLadderDirection =
  | 'UE_TO_SECTOR'
  | 'SECTOR_TO_UE'
  | 'UE_TO_RRC'
  | 'RRC_TO_UE';

export interface NtnLadderStep {
  readonly stepIndex: number; // 1 to 5
  readonly dir: NtnLadderDirection;
  readonly label: string;
  readonly detail: string;
  readonly timeTag: string;
  readonly status: 'SUCCESS' | 'FAILED' | 'PENDING';
  readonly source: 'UE' | 'SECTOR' | 'RRC';
  readonly target: 'UE' | 'SECTOR' | 'RRC';
}

export type NtnLadderMessage = NtnLadderStep;

export interface NtnSignalingInput {
  readonly nodeId: number;
  readonly slantRangeM: number;
  readonly snrDb?: number;
  readonly isOutage?: boolean;
  readonly isRegistered?: boolean;
  readonly activeSectorId?: number;
  readonly handoverCount?: number;
  readonly modcodName?: string;
  readonly totalBacklogBits?: number;
}

export interface NtnSignalingReport {
  readonly nodeId: number;
  readonly cRntiHex: string;
  readonly preambleIndex: number;
  readonly tauPropUs: number;
  readonly tauTaUs: number;
  readonly taIndex: number;
  readonly rachLatencyMs: number;
  readonly rrcState: NtnRrcState;
  readonly steps: readonly NtnLadderStep[];
}

/**
 * Deterministically computes C-RNTI hex string for a given terminal node ID.
 * Example: nodeId 1 -> '0x4E01', nodeId 16 -> '0x4E10'.
 */
export function computeDeterministicCRnti(nodeId: number): string {
  return '0x' + (BASE_CRNTI_OFFSET + (nodeId & 0xFFFF)).toString(16).toUpperCase();
}

/**
 * Computes deterministic Zadoff-Chu PRACH Preamble Index in [0, 63].
 * Preamble = (nodeId * 7 + 13) % 64.
 */
export function computePrachPreambleIndex(nodeId: number): number {
  return ((nodeId * 7 + 13) % 64 + 64) % 64;
}

/**
 * Computes one-way speed-of-light propagation delay in microseconds.
 */
export function computePropagationDelayUs(slantRangeM: number): number {
  return (Math.max(0, slantRangeM) / SPEED_OF_LIGHT_M_S) * 1e6;
}

/**
 * Computes 3GPP TS 38.213 12-bit Timing Advance Command index.
 * Step size = 0.26 μs (30 kHz SCS). Clamped to [0, 3846].
 */
export function computeTimingAdvanceIndex(tauTaUs: number): number {
  const raw = Math.round(tauTaUs / TA_STEP_US);
  return Math.max(MIN_TA_INDEX, Math.min(MAX_TA_INDEX, raw));
}

/**
 * Computes total 4-Step RACH acquisition latency in milliseconds.
 * T_RACH = 5.0 ms (2.0 ms gNB RAR processing + 3.0 ms RRC processing) + 4 * tau_prop (2 round trips).
 */
export function computeRachAcquisitionLatencyMs(tauPropUs: number): number {
  return 5.0 + (4.0 * tauPropUs) / 1000.0;
}

/**
 * Evaluates 3GPP Rel-17 NTN Node Signaling, Timing Advance, RRC State, and 5-step call-flow sequence.
 */
export function evaluateNtnNodeSignaling(
  inputOrNodeId: NtnSignalingInput | number,
  slantRangeMArg?: number,
  snrDbArg?: number,
  isOutageArg?: boolean,
  isRegisteredArg?: boolean,
  activeSectorIdArg?: number,
  handoverCountArg?: number,
  modcodNameArg?: string,
  totalBacklogBitsArg?: number,
): NtnSignalingReport {
  let nodeId: number;
  let slantRangeM: number;
  let snrDb: number;
  let isOutage: boolean;
  let isRegistered: boolean;
  let activeSectorId: number;
  let handoverCount: number;
  let modcodName: string;
  let totalBacklogBits: number;

  if (typeof inputOrNodeId === 'object' && inputOrNodeId !== null) {
    nodeId = inputOrNodeId.nodeId;
    slantRangeM = inputOrNodeId.slantRangeM;
    snrDb = inputOrNodeId.snrDb ?? 15.0;
    isOutage = Boolean(inputOrNodeId.isOutage);
    isRegistered = inputOrNodeId.isRegistered ?? true;
    activeSectorId = inputOrNodeId.activeSectorId ?? 0;
    handoverCount = inputOrNodeId.handoverCount ?? 0;
    modcodName = inputOrNodeId.modcodName ?? '16APSK-2/3';
    totalBacklogBits = inputOrNodeId.totalBacklogBits ?? 0;
  } else {
    nodeId = Number(inputOrNodeId);
    slantRangeM = slantRangeMArg ?? 15000.0;
    snrDb = snrDbArg ?? 15.0;
    isOutage = Boolean(isOutageArg);
    isRegistered = isRegisteredArg ?? true;
    activeSectorId = activeSectorIdArg ?? 0;
    handoverCount = handoverCountArg ?? 0;
    modcodName = modcodNameArg ?? '16APSK-2/3';
    totalBacklogBits = totalBacklogBitsArg ?? 0;
  }

  // 1. Terminal Identity & Timing Parameters
  const cRntiHex = computeDeterministicCRnti(nodeId);
  const preambleIndex = computePrachPreambleIndex(nodeId);
  const tauPropUs = computePropagationDelayUs(slantRangeM);
  const tauTaUs = 2.0 * tauPropUs;
  const taIndex = computeTimingAdvanceIndex(tauTaUs);
  const rachLatencyMs = computeRachAcquisitionLatencyMs(tauPropUs);

  // 2. RRC State Machine
  let rrcState: NtnRrcState;
  if (!isRegistered) {
    rrcState = 'RRC_IDLE';
  } else if (isOutage) {
    rrcState = 'RRC_RLF_RECOVERY';
  } else {
    rrcState = 'RRC_CONNECTED';
  }

  // 3. 5-Step Call-Flow Ladder Sequence
  const backlogBytes = Math.ceil(Math.max(0, totalBacklogBits) / 8);

  const steps: readonly NtnLadderStep[] = [
    {
      stepIndex: 1,
      dir: 'UE_TO_SECTOR',
      label: `Msg1: PRACH (ZC #${preambleIndex})`,
      detail: `τ_prop=${tauPropUs.toFixed(1)}μs`,
      timeTag: '+0.0 ms',
      status: !isRegistered ? 'PENDING' : 'SUCCESS',
      source: 'UE',
      target: 'SECTOR',
    },
    {
      stepIndex: 2,
      dir: 'SECTOR_TO_UE',
      label: `Msg2: RAR (T_A=${taIndex}, TC-RNTI=${cRntiHex})`,
      detail: `τ_TA=${tauTaUs.toFixed(1)}μs`,
      timeTag: `+${(tauPropUs / 1000.0).toFixed(2)} ms`,
      status: !isRegistered ? 'PENDING' : 'SUCCESS',
      source: 'SECTOR',
      target: 'UE',
    },
    {
      stepIndex: 3,
      dir: 'UE_TO_RRC',
      label: `Msg3: RRCSetupRequest + 5QI BSR (${backlogBytes} B)`,
      detail: modcodName,
      timeTag: `+${(2.0 + (2.0 * tauPropUs) / 1000.0).toFixed(2)} ms`,
      status: !isRegistered ? 'PENDING' : 'SUCCESS',
      source: 'UE',
      target: 'RRC',
    },
    {
      stepIndex: 4,
      dir: 'RRC_TO_UE',
      label: `Msg4: ContentionResolution [${rrcState}]`,
      detail: `SINR=${snrDb.toFixed(1)}dB`,
      timeTag: `+${(5.0 + (3.0 * tauPropUs) / 1000.0).toFixed(2)} ms`,
      status: rrcState === 'RRC_RLF_RECOVERY' ? 'FAILED' : (!isRegistered ? 'PENDING' : 'SUCCESS'),
      source: 'RRC',
      target: 'UE',
    },
    {
      stepIndex: 5,
      dir: 'RRC_TO_UE',
      label: `A3 MeasReport / Beam Lock [Sector S${activeSectorId}]`,
      detail: `HO Count=${handoverCount} (H=1.5dB)`,
      timeTag: `+${(rachLatencyMs + 5.0).toFixed(2)} ms`,
      status: rrcState === 'RRC_RLF_RECOVERY' ? 'FAILED' : (!isRegistered ? 'PENDING' : 'SUCCESS'),
      source: 'RRC',
      target: 'UE',
    },
  ];

  return {
    nodeId,
    cRntiHex,
    preambleIndex,
    tauPropUs,
    tauTaUs,
    taIndex,
    rachLatencyMs,
    rrcState,
    steps,
  };
}
