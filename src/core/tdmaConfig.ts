/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Core TDMA Configuration Model & Waveform Presets (Milestone TDMA-1)
 *
 * Implements variable TDMA frame structure configuration, SI unit getters,
 * strict physical boundary constraint validation (Resolving Audit Finding 2),
 * and standard tactical waveform presets according to specification DRDO-TAC-XBAND-ARCH-TDMA-02.
 */

export type TdmaUplinkPolicy = 'equal_active' | 'dynamic_demand' | 'fixed_slot_count';

export interface ITdmaFrameConfig {
  /** Total superframe duration in milliseconds. Range: [5.0, 100.0] ms. Default: 20.0 ms. */
  readonly frameDurationMs: number;
  /** Network sync and control broadcast subframe in milliseconds. Range: [0.2, 10.0] ms. Default: 1.0 ms. */
  readonly ctrlDurationMs: number;
  /** Minimum baseline downlink subframe in milliseconds. Range: [0.5, 30.0] ms. Default: 3.0 ms. */
  readonly dlMinDurationMs: number;
  /** Maximum dynamic breathing downlink subframe in milliseconds. Range: [0.5, 50.0] ms. Default: 7.0 ms. */
  readonly dlMaxDurationMs: number;
  /** Inter-slot Timing Advance guard interval in microseconds. Range: [1.0, 100.0] us. Default: 12.0 us. */
  readonly guardIntervalUs: number;
  /** Minimum allocatable slot duration in microseconds. Range: [50.0, 2000.0] us. Default: 200.0 us. */
  readonly minSlotDurationUs: number;
  /** Maximum normal slot duration in milliseconds for dynamic scheduling. Range: [1.0, 50.0] ms. Default: 8.0 ms. */
  readonly maxSlotDurationMs: number;
  /** Uplink slotting policy. Default: 'equal_active'. */
  readonly uplinkPolicy?: TdmaUplinkPolicy;
  /** Optional fixed number of slots for static TDMA (e.g. 8, 16, 32, 64). If omitted, equals active terminal count N. */
  readonly fixedSlotCount?: number;
}

export class TdmaFrameConfig implements ITdmaFrameConfig {
  public readonly frameDurationMs: number;
  public readonly ctrlDurationMs: number;
  public readonly dlMinDurationMs: number;
  public readonly dlMaxDurationMs: number;
  public readonly guardIntervalUs: number;
  public readonly minSlotDurationUs: number;
  public readonly maxSlotDurationMs: number;
  public readonly uplinkPolicy: TdmaUplinkPolicy;
  public readonly fixedSlotCount?: number;

  constructor(init?: Partial<ITdmaFrameConfig>) {
    this.frameDurationMs = init?.frameDurationMs ?? 20.0;
    this.ctrlDurationMs = init?.ctrlDurationMs ?? 1.0;
    this.dlMinDurationMs = init?.dlMinDurationMs ?? 3.0;
    this.dlMaxDurationMs = init?.dlMaxDurationMs !== undefined ? init.dlMaxDurationMs : Math.max(this.dlMinDurationMs, 7.0);
    this.guardIntervalUs = init?.guardIntervalUs ?? 12.0;
    this.minSlotDurationUs = init?.minSlotDurationUs ?? 200.0;
    this.maxSlotDurationMs = init?.maxSlotDurationMs ?? 8.0;
    this.uplinkPolicy = init?.uplinkPolicy ?? 'equal_active';
    this.fixedSlotCount = init?.fixedSlotCount;

    this.validate();
  }

  // SI Second unit accessors
  public get frameDurationS(): number {
    return this.frameDurationMs / 1000.0;
  }

  public get ctrlDurationS(): number {
    return this.ctrlDurationMs / 1000.0;
  }

  public get dlMinDurationS(): number {
    return this.dlMinDurationMs / 1000.0;
  }

  public get dlMaxDurationS(): number {
    return this.dlMaxDurationMs / 1000.0;
  }

  public get guardIntervalS(): number {
    return this.guardIntervalUs / 1e6;
  }

  public get minSlotDurationS(): number {
    return this.minSlotDurationUs / 1e6;
  }

  public get maxSlotDurationS(): number {
    return this.maxSlotDurationMs / 1000.0;
  }

  public get nominalUlAvailableS(): number {
    return Math.max(0, this.frameDurationS - this.ctrlDurationS - this.dlMinDurationS);
  }

  /**
   * Validates configuration against physical invariants and boundary constraints.
   * Throws an Error if any constraint is violated.
   */
  public validate(): void {
    if (!Number.isFinite(this.frameDurationMs) || this.frameDurationMs < 5.0 || this.frameDurationMs > 100.0) {
      throw new Error(`frameDurationMs must be in [5.0, 100.0] ms, got ${this.frameDurationMs}`);
    }
    if (!Number.isFinite(this.ctrlDurationMs) || this.ctrlDurationMs < 0.1 || this.ctrlDurationMs >= this.frameDurationMs) {
      throw new Error(`ctrlDurationMs must be in [0.1, ${this.frameDurationMs}) ms, got ${this.ctrlDurationMs}`);
    }
    if (!Number.isFinite(this.dlMinDurationMs) || this.dlMinDurationMs < 0.1) {
      throw new Error(`dlMinDurationMs must be >= 0.1 ms, got ${this.dlMinDurationMs}`);
    }
    if (!Number.isFinite(this.dlMaxDurationMs) || this.dlMaxDurationMs < this.dlMinDurationMs) {
      throw new Error(`dlMaxDurationMs (${this.dlMaxDurationMs}ms) cannot be less than dlMinDurationMs (${this.dlMinDurationMs}ms)`);
    }
    if (!Number.isFinite(this.guardIntervalUs) || this.guardIntervalUs <= 0) {
      throw new Error(`guardIntervalUs must be a positive finite number, got ${this.guardIntervalUs}`);
    }
    if (!Number.isFinite(this.minSlotDurationUs) || this.minSlotDurationUs <= 0) {
      throw new Error(`minSlotDurationUs must be a positive finite number, got ${this.minSlotDurationUs}`);
    }
    if (!Number.isFinite(this.maxSlotDurationMs) || this.maxSlotDurationMs <= 0) {
      throw new Error(`maxSlotDurationMs must be a positive finite number, got ${this.maxSlotDurationMs}`);
    }
    if (this.uplinkPolicy !== 'equal_active' && this.uplinkPolicy !== 'dynamic_demand' && this.uplinkPolicy !== 'fixed_slot_count') {
      throw new Error(`uplinkPolicy must be 'equal_active', 'dynamic_demand', or 'fixed_slot_count', got ${this.uplinkPolicy}`);
    }

    // Resolving Audit Finding 2: Strict upper-bound physical boundary constraint
    const minUlReserveS = this.minSlotDurationS + this.guardIntervalS;
    const minUlReserveMs = minUlReserveS * 1000.0;
    if (this.ctrlDurationMs + this.dlMaxDurationMs > this.frameDurationMs - (minUlReserveS * 1000.0) + 1e-6) {
      throw new Error(
        `Sum of ctrl (${this.ctrlDurationMs}ms) and dlMax (${this.dlMaxDurationMs}ms) exceeds allowed ceiling ` +
        `(${this.frameDurationMs - minUlReserveMs}ms). Minimum uplink reserve (${minUlReserveMs.toFixed(3)}ms) violated.`
      );
    }
    if (this.minSlotDurationS <= this.guardIntervalS) {
      throw new Error(`minSlotDurationUs (${this.minSlotDurationUs}us) must be strictly greater than guardIntervalUs (${this.guardIntervalUs}us)`);
    }
    if (this.fixedSlotCount !== undefined && (!Number.isInteger(this.fixedSlotCount) || this.fixedSlotCount < 1 || this.fixedSlotCount > 64)) {
      throw new Error(`fixedSlotCount must be an integer in [1, 64], got ${this.fixedSlotCount}`);
    }
  }

  public toObject(): ITdmaFrameConfig {
    return {
      frameDurationMs: this.frameDurationMs,
      ctrlDurationMs: this.ctrlDurationMs,
      dlMinDurationMs: this.dlMinDurationMs,
      dlMaxDurationMs: this.dlMaxDurationMs,
      guardIntervalUs: this.guardIntervalUs,
      minSlotDurationUs: this.minSlotDurationUs,
      maxSlotDurationMs: this.maxSlotDurationMs,
      uplinkPolicy: this.uplinkPolicy,
      ...(this.fixedSlotCount !== undefined ? { fixedSlotCount: this.fixedSlotCount } : {}),
    };
  }
}

// -----------------------------------------------------------------------------
// Pre-defined Tactical Waveform Presets
// -----------------------------------------------------------------------------

export const TDMA_PRESET_STANDARD_20MS: Readonly<ITdmaFrameConfig> = Object.freeze({
  frameDurationMs: 20.0,
  ctrlDurationMs: 1.0,
  dlMinDurationMs: 3.0,
  dlMaxDurationMs: 7.0,
  guardIntervalUs: 12.0,
  minSlotDurationUs: 200.0,
  maxSlotDurationMs: 8.0,
  uplinkPolicy: 'equal_active',
});

export const TDMA_PRESET_FAST_10MS: Readonly<ITdmaFrameConfig> = Object.freeze({
  frameDurationMs: 10.0,
  ctrlDurationMs: 0.5,
  dlMinDurationMs: 1.5,
  dlMaxDurationMs: 3.0,
  guardIntervalUs: 8.0,
  minSlotDurationUs: 100.0,
  maxSlotDurationMs: 4.0,
  uplinkPolicy: 'equal_active',
});

export const TDMA_PRESET_EXTENDED_40MS: Readonly<ITdmaFrameConfig> = Object.freeze({
  frameDurationMs: 40.0,
  ctrlDurationMs: 2.0,
  dlMinDurationMs: 6.0,
  dlMaxDurationMs: 12.0,
  guardIntervalUs: 25.0,
  minSlotDurationUs: 400.0,
  maxSlotDurationMs: 16.0,
  uplinkPolicy: 'equal_active',
});

export const TDMA_PRESET_SYMMETRIC_50_50: Readonly<ITdmaFrameConfig> = Object.freeze({
  frameDurationMs: 20.0,
  ctrlDurationMs: 1.0,
  dlMinDurationMs: 9.0,
  dlMaxDurationMs: 9.0,
  guardIntervalUs: 12.0,
  minSlotDurationUs: 200.0,
  maxSlotDurationMs: 8.0,
  uplinkPolicy: 'equal_active',
});

export const TDMA_PRESET_SWARM_64SLOT: Readonly<ITdmaFrameConfig> = Object.freeze({
  frameDurationMs: 20.0,
  ctrlDurationMs: 1.0,
  dlMinDurationMs: 2.0,
  dlMaxDurationMs: 4.0,
  guardIntervalUs: 6.0,
  minSlotDurationUs: 100.0,
  maxSlotDurationMs: 4.0,
  uplinkPolicy: 'fixed_slot_count',
  fixedSlotCount: 64,
});

export const TDMA_PRESETS: Readonly<Record<string, Readonly<ITdmaFrameConfig>>> = Object.freeze({
  TDMA_PRESET_STANDARD_20MS,
  TDMA_PRESET_FAST_10MS,
  TDMA_PRESET_EXTENDED_40MS,
  TDMA_PRESET_SYMMETRIC_50_50,
  TDMA_PRESET_SWARM_64SLOT,
});

export const DEFAULT_TDMA_FRAME_CONFIG = new TdmaFrameConfig();
