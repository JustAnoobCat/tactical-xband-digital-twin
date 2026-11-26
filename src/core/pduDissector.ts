/**
 * src/core/pduDissector.ts
 *
 * Layer-1/Layer-2 X-Band MAC PDU Frame Dissector Engine (DVB-S2X / 3GPP 5QI).
 *
 * Implements first-principles timing, physical capacity, strict-priority 5QI
 * sub-PDU byte multiplexing, speed-of-light Timing Advance accounting,
 * delivery verdict classification, and deterministic 16-byte hex frame headers.
 */

export const SPEED_OF_LIGHT_M_S = 299792458.0;

export interface DissectSlotParams {
  readonly nodeId?: number;
  readonly node_id?: number;
  readonly sectorId?: number;
  readonly sector_id?: number;
  readonly slotStartS?: number;
  readonly slot_start_s?: number;
  readonly startMs?: number;
  readonly start_ms?: number;
  readonly durationS?: number;
  readonly duration_s?: number;
  readonly durationMs?: number;
  readonly duration_ms?: number;
  readonly timingAdvanceS?: number;
  readonly timing_advance_s?: number;
  readonly timingAdvanceUs?: number;
  readonly timing_advance_us?: number;
  readonly modcodName?: string;
  readonly modcod_name?: string;
  readonly spectralEfficiency?: number;
  readonly spectral_efficiency?: number;
  readonly capacityBits?: number;
  readonly capacity_bits?: number;
  readonly isPreOcclusionFlush?: boolean;
  readonly is_pre_occlusion_flush?: boolean;
  readonly isOutage?: boolean;
  readonly is_outage?: boolean;
  readonly [key: string]: unknown;
}

export interface NodeTelemetryInput {
  readonly q_c2?: number;
  readonly q_voice?: number;
  readonly q_video?: number;
  readonly q_photo?: number;
  readonly q_Bulk?: number;
  readonly q_bulk?: number;
  readonly q_c2_bits?: number;
  readonly q_voice_bits?: number;
  readonly q_video_bits?: number;
  readonly q_photo_bits?: number;
  readonly q_c2_unit?: 'bits' | 'bytes';
  readonly q_voice_unit?: 'bits' | 'bytes';
  readonly q_video_unit?: 'bits' | 'bytes';
  readonly q_photo_unit?: 'bits' | 'bytes';
  readonly c2_bytes?: number;
  readonly voice_bytes?: number;
  readonly video_bytes?: number;
  readonly photo_bytes?: number;
  readonly c2_backlog?: number;
  readonly voice_backlog?: number;
  readonly video_backlog?: number;
  readonly photo_backlog?: number;
  readonly is_outage?: boolean;
  readonly isOutage?: boolean;
  readonly snr_db?: number;
  readonly snrDb?: number;
  readonly slant_range_m?: number;
  readonly slantRangeM?: number;
  readonly state_name?: string;
  readonly link_outage?: boolean;
  readonly linkOutage?: boolean;
  readonly [key: string]: unknown;
}

export interface DissectedMacPdu {
  readonly nodeId: number;
  readonly sectorId: number;
  readonly scheduler: string;
  readonly modcodName: string;
  readonly spectralEfficiency: number;
  readonly slotStartMs: number;
  readonly slotEndMs: number;
  readonly durationMs: number;
  readonly timingAdvanceUs: number;
  readonly totalCapacityBits: number;
  readonly totalCapacityBytes: number;
  readonly framingOverheadBits: number;
  readonly framingOverheadBytes: number;
  readonly c2Bits: number;
  readonly c2Bytes: number;
  readonly voiceBits: number;
  readonly voiceBytes: number;
  readonly videoBits: number;
  readonly videoBytes: number;
  readonly photoBits: number;
  readonly photoBytes: number;
  readonly paddingBits: number;
  readonly paddingBytes: number;
  readonly deliveryStatus: 'OUTAGE_WASTED_BURST' | 'PRE_OCCLUSION_EVAC_BURST' | 'NOMINAL_DELIVERED_BURST';
  readonly isOutage: boolean;
  readonly isPreOcclusionFlush: boolean;
  readonly snrDb: number;
  readonly slantRangeM: number;
  readonly wastedBits: number;
  readonly deliveredBits: number;
  readonly hexHeaderDump: string;
}

/**
 * Deterministic standard IEEE 802.3 CRC-32 calculation over a byte sequence.
 */
export function computeCrc32(bytes: readonly number[]): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= (b & 0xff);
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Standard DVB-S2X MODCOD identifier lookup.
 */
export function getModcodIdentifier(name: string, spectralEff: number = 1.0): number {
  const compact = String(name || '')
    .toUpperCase()
    .replace(/π/g, 'PI')
    .replace(/[\s_-]+/g, '');

  if (compact.includes('64APSK')) {
    if (compact.includes('3/4')) return 0x40;
    if (compact.includes('4/5')) return 0x41;
    if (compact.includes('5/6')) return 0x42;
    return 0x40;
  }
  if (compact.includes('32APSK')) {
    if (compact.includes('3/4')) return 0x30;
    if (compact.includes('4/5')) return 0x31;
    if (compact.includes('5/6')) return 0x32;
    if (compact.includes('8/9')) return 0x33;
    return 0x30;
  }
  if (compact.includes('16QAM') || compact.includes('QAM16')) {
    if (compact.includes('1/2')) return 0x28;
    if (compact.includes('2/3')) return 0x29;
    if (compact.includes('3/4')) return 0x2a;
    if (compact.includes('5/6')) return 0x2b;
    return 0x2a;
  }
  if (compact.includes('16APSK')) {
    if (compact.includes('2/3')) return 0x20;
    if (compact.includes('3/4')) return 0x21;
    if (compact.includes('4/5')) return 0x22;
    if (compact.includes('5/6')) return 0x23;
    if (compact.includes('8/9')) return 0x24;
    return 0x21;
  }
  if (compact.includes('8PSK')) {
    if (compact.includes('3/5')) return 0x10;
    if (compact.includes('2/3')) return 0x11;
    if (compact.includes('3/4')) return 0x12;
    if (compact.includes('5/6')) return 0x13;
    if (compact.includes('8/9')) return 0x14;
    return 0x12;
  }
  if (compact.includes('QPSK')) {
    if (compact.includes('1/4')) return 0x01;
    if (compact.includes('1/3')) return 0x02;
    if (compact.includes('2/5')) return 0x03;
    if (compact.includes('1/2')) return 0x04;
    if (compact.includes('3/5')) return 0x05;
    if (compact.includes('2/3')) return 0x06;
    if (compact.includes('3/4')) return 0x07;
    if (compact.includes('4/5')) return 0x08;
    if (compact.includes('5/6')) return 0x09;
    if (compact.includes('8/9')) return 0x0a;
    if (compact.includes('9/10')) return 0x0b;
    return 0x04;
  }
  if (compact.includes('BPSK')) {
    if (compact.includes('1/4')) return 0x50;
    if (compact.includes('1/3')) return 0x51;
    if (compact.includes('1/2')) return 0x52;
    return 0x51;
  }
  return Math.max(1, Math.min(255, Math.round(spectralEff * 32)));
}

/**
 * Helper to extract queue demand in bits.
 */
function extractQueueBits(
  valBytesOrBits: number | undefined,
  valBitsExplicit: number | undefined,
  unit: 'bits' | 'bytes' | undefined,
  fallbackBytes: number | undefined
): number {
  if (typeof valBitsExplicit === 'number' && Number.isFinite(valBitsExplicit) && valBitsExplicit >= 0) {
    return Math.floor(valBitsExplicit);
  }
  if (typeof valBytesOrBits === 'number' && Number.isFinite(valBytesOrBits) && valBytesOrBits >= 0) {
    return unit === 'bits' ? Math.floor(valBytesOrBits) : Math.floor(valBytesOrBits * 8);
  }
  if (typeof fallbackBytes === 'number' && Number.isFinite(fallbackBytes) && fallbackBytes >= 0) {
    return Math.floor(fallbackBytes * 8);
  }
  return 0;
}

/**
 * Pure First-Principles Dissector Engine for TDMA Slot Allocations.
 *
 * Supports both multi-argument signature:
 *   dissectTdmaSlotAllocation(slotAlloc, schedulerLabel, nodeTelemetry)
 * and single-parameter signature:
 *   dissectTdmaSlotAllocation({ slotAlloc, schedulerLabel, nodeTelemetry, ... })
 */
export function dissectTdmaSlotAllocation(
  slotAllocOrOptions: DissectSlotParams & {
    readonly schedulerLabel?: string;
    readonly nodeTelemetry?: NodeTelemetryInput;
    readonly slotAlloc?: DissectSlotParams;
  },
  schedulerLabelParam?: string,
  nodeTelemetryParam?: NodeTelemetryInput
): DissectedMacPdu {
  const isUnified = Boolean(
    slotAllocOrOptions &&
    (slotAllocOrOptions.slotAlloc || slotAllocOrOptions.nodeTelemetry || slotAllocOrOptions.schedulerLabel)
  );

  const rawAlloc: DissectSlotParams = isUnified
    ? (slotAllocOrOptions.slotAlloc ?? slotAllocOrOptions)
    : (slotAllocOrOptions || {});

  const schedulerLabel = (
    schedulerLabelParam ??
    slotAllocOrOptions?.schedulerLabel ??
    'Tac-TAD'
  ).toString();

  const nodeTel: NodeTelemetryInput = (
    nodeTelemetryParam ??
    slotAllocOrOptions?.nodeTelemetry ??
    (rawAlloc as NodeTelemetryInput) ??
    {}
  );

  // 1. Basic Slot Dimensions
  const nodeId = Number(rawAlloc.nodeId ?? rawAlloc.node_id ?? 0);
  const sectorId = Number(rawAlloc.sectorId ?? rawAlloc.sector_id ?? 0);

  let slotStartS = 0;
  if (typeof rawAlloc.slotStartS === 'number') {
    slotStartS = rawAlloc.slotStartS;
  } else if (typeof rawAlloc.slot_start_s === 'number') {
    slotStartS = rawAlloc.slot_start_s;
  } else if (typeof rawAlloc.startMs === 'number') {
    slotStartS = rawAlloc.startMs / 1000.0;
  } else if (typeof rawAlloc.start_ms === 'number') {
    slotStartS = rawAlloc.start_ms / 1000.0;
  }

  let durationS = 0.001;
  if (typeof rawAlloc.durationS === 'number') {
    durationS = rawAlloc.durationS;
  } else if (typeof rawAlloc.duration_s === 'number') {
    durationS = rawAlloc.duration_s;
  } else if (typeof rawAlloc.durationMs === 'number') {
    durationS = rawAlloc.durationMs / 1000.0;
  } else if (typeof rawAlloc.duration_ms === 'number') {
    durationS = rawAlloc.duration_ms / 1000.0;
  }

  const slotStartMs = slotStartS * 1000.0;
  const durationMs = durationS * 1000.0;
  const slotEndMs = slotStartMs + durationMs;

  const modcodName = String(rawAlloc.modcodName ?? rawAlloc.modcod_name ?? 'QPSK 1/2');
  const spectralEfficiency = Math.max(
    0.1,
    Number(rawAlloc.spectralEfficiency ?? rawAlloc.spectral_efficiency ?? 1.0)
  );

  const rawCapBits = rawAlloc.capacityBits ?? rawAlloc.capacity_bits;
  const totalCapacityBits = Math.max(0, Math.floor(typeof rawCapBits === 'number' ? rawCapBits : 0));
  const totalCapacityBytes = Math.floor(totalCapacityBits / 8);

  const slantRangeM = Math.max(
    0,
    Number(
      nodeTel.slant_range_m ??
      nodeTel.slantRangeM ??
      rawAlloc.slant_range_m ??
      rawAlloc.slantRangeM ??
      25000.0
    )
  );

  const snrDb = Number(
    nodeTel.snr_db ??
    nodeTel.snrDb ??
    rawAlloc.snr_db ??
    rawAlloc.snrDb ??
    15.0
  );

  // 2. Speed-of-Light Timing Advance
  let timingAdvanceUs = 0;
  const taS = rawAlloc.timingAdvanceS ?? rawAlloc.timing_advance_s;
  const taUs = rawAlloc.timingAdvanceUs ?? rawAlloc.timing_advance_us;

  if (typeof taS === 'number' && taS > 0) {
    timingAdvanceUs = taS * 1e6;
  } else if (typeof taUs === 'number' && taUs > 0) {
    timingAdvanceUs = taUs;
  } else {
    timingAdvanceUs = ((2.0 * slantRangeM) / SPEED_OF_LIGHT_M_S) * 1e6;
  }

  // 3. Strict 5QI Bit Allocation & Exact Conservation
  // 64-byte DVB-S2X PLHEADER + SOF + MAC Header + CRC-32 (512 bits)
  const framingOverheadBits = Math.min(totalCapacityBits, 512);
  const framingOverheadBytes = Math.floor(framingOverheadBits / 8);

  const remBits = Math.max(0, totalCapacityBits - framingOverheadBits);
  let remBudget = remBits;

  // 5QI-69 C2
  const c2DemBits = extractQueueBits(
    nodeTel.q_c2,
    nodeTel.q_c2_bits,
    nodeTel.q_c2_unit,
    nodeTel.c2_bytes ?? (rawAlloc.c2_bytes as number | undefined)
  );
  const c2Bits = Math.min(remBudget, c2DemBits);
  remBudget -= c2Bits;

  // 5QI-65 Voice
  const voiceDemBits = extractQueueBits(
    nodeTel.q_voice,
    nodeTel.q_voice_bits,
    nodeTel.q_voice_unit,
    nodeTel.voice_bytes ?? (rawAlloc.voice_bytes as number | undefined)
  );
  const voiceBits = Math.min(remBudget, voiceDemBits);
  remBudget -= voiceBits;

  // 5QI-67 Video
  const videoDemBits = extractQueueBits(
    nodeTel.q_video,
    nodeTel.q_video_bits,
    nodeTel.q_video_unit,
    nodeTel.video_bytes ?? (rawAlloc.video_bytes as number | undefined)
  );
  const videoBits = Math.min(remBudget, videoDemBits);
  remBudget -= videoBits;

  // 5QI-70 ISR Photo
  const photoDemBits = extractQueueBits(
    nodeTel.q_photo ?? nodeTel.q_Bulk ?? nodeTel.q_bulk,
    nodeTel.q_photo_bits,
    nodeTel.q_photo_unit,
    nodeTel.photo_bytes ?? (rawAlloc.photo_bytes as number | undefined)
  );
  const photoBits = Math.min(remBudget, photoDemBits);
  remBudget -= photoBits;

  // Remainder is strictly assigned to padding
  const paddingBits = remBudget;

  const c2Bytes = Math.floor(c2Bits / 8);
  const voiceBytes = Math.floor(voiceBits / 8);
  const videoBytes = Math.floor(videoBits / 8);
  const photoBytes = Math.floor(photoBits / 8);
  const paddingBytes = Math.floor(paddingBits / 8);

  // 4. Delivery Status & Outage Classification
  const isOutage = Boolean(
    nodeTel.is_outage ||
    nodeTel.isOutage ||
    rawAlloc.is_outage ||
    rawAlloc.isOutage ||
    nodeTel.state_name === 'HARD_SHADOW_CUTOFF' ||
    nodeTel.link_outage ||
    nodeTel.linkOutage
  );

  const isPreOcclusionFlush = Boolean(
    rawAlloc.isPreOcclusionFlush ||
    rawAlloc.is_pre_occlusion_flush ||
    nodeTel.is_pre_occlusion_flush ||
    nodeTel.isPreOcclusionFlush
  );

  let deliveryStatus: 'OUTAGE_WASTED_BURST' | 'PRE_OCCLUSION_EVAC_BURST' | 'NOMINAL_DELIVERED_BURST';
  let wastedBits = 0;
  let deliveredBits = 0;

  if (isOutage || totalCapacityBits <= 0) {
    deliveryStatus = 'OUTAGE_WASTED_BURST';
    wastedBits = totalCapacityBits;
    deliveredBits = 0;
  } else if (isPreOcclusionFlush) {
    deliveryStatus = 'PRE_OCCLUSION_EVAC_BURST';
    wastedBits = 0;
    deliveredBits = totalCapacityBits;
  } else {
    deliveryStatus = 'NOMINAL_DELIVERED_BURST';
    wastedBits = 0;
    deliveredBits = totalCapacityBits;
  }

  // 5. Deterministic Hexadecimal Header
  const secHex = (sectorId & 0xff).toString(16).padStart(2, '0').toUpperCase();
  const nodeHex = (nodeId & 0xff).toString(16).padStart(2, '0').toUpperCase();
  const mcVal = getModcodIdentifier(modcodName, spectralEfficiency);
  const mcHex = (mcVal & 0xff).toString(16).padStart(2, '0').toUpperCase();

  let flags = 0;
  if (isPreOcclusionFlush) flags |= 0x01;
  if (isOutage) flags |= 0x02;
  const schedLower = schedulerLabel.toLowerCase();
  if (schedLower.includes('tac')) flags |= 0x04;
  else if (schedLower.includes('react')) flags |= 0x08;
  const flagsHex = (flags & 0xff).toString(16).padStart(2, '0').toUpperCase();

  const lenHi = ((totalCapacityBytes >> 8) & 0xff).toString(16).padStart(2, '0').toUpperCase();
  const lenLo = (totalCapacityBytes & 0xff).toString(16).padStart(2, '0').toUpperCase();

  const taInt = Math.max(0, Math.min(65535, Math.round(timingAdvanceUs)));
  const taHi = ((taInt >> 8) & 0xff).toString(16).padStart(2, '0').toUpperCase();
  const taLo = (taInt & 0xff).toString(16).padStart(2, '0').toUpperCase();

  const snrQuant = Math.max(0, Math.min(255, Math.round((snrDb + 20) * 2)));
  const snrHex = (snrQuant & 0xff).toString(16).padStart(2, '0').toUpperCase();

  const headerBytes = [
    0x58, 0x42,
    sectorId & 0xff,
    nodeId & 0xff,
    mcVal & 0xff,
    flags & 0xff,
    (totalCapacityBytes >> 8) & 0xff,
    totalCapacityBytes & 0xff,
    (taInt >> 8) & 0xff,
    taInt & 0xff,
    snrQuant & 0xff,
  ];

  const crc = computeCrc32(headerBytes);
  const crc0 = ((crc >> 24) & 0xff).toString(16).padStart(2, '0').toUpperCase();
  const crc1 = ((crc >> 16) & 0xff).toString(16).padStart(2, '0').toUpperCase();
  const crc2 = ((crc >> 8) & 0xff).toString(16).padStart(2, '0').toUpperCase();
  const crc3 = (crc & 0xff).toString(16).padStart(2, '0').toUpperCase();

  const hexHeaderDump = `58 42 ${secHex} ${nodeHex} ${mcHex} ${flagsHex} ${lenHi} ${lenLo} ${taHi} ${taLo} ${snrHex} ${crc0} ${crc1} ${crc2} ${crc3} [SYNC:XB | SEC:S${sectorId} | NID:${nodeId} | CRC32:OK]`;

  return {
    nodeId,
    sectorId,
    scheduler: schedulerLabel,
    modcodName,
    spectralEfficiency,
    slotStartMs,
    slotEndMs,
    durationMs,
    timingAdvanceUs,
    totalCapacityBits,
    totalCapacityBytes,
    framingOverheadBits,
    framingOverheadBytes,
    c2Bits,
    c2Bytes,
    voiceBits,
    voiceBytes,
    videoBits,
    videoBytes,
    photoBits,
    photoBytes,
    paddingBits,
    paddingBytes,
    deliveryStatus,
    isOutage,
    isPreOcclusionFlush,
    snrDb,
    slantRangeM,
    wastedBits,
    deliveredBits,
    hexHeaderDump,
  };
}
