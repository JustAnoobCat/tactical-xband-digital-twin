/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Authoritative Communication Link Status Classifier (Milestone 4 Step 2 & 3)
 *
 * Provides a pure, deterministic, independently testable link-status classifier
 * using authoritative telemetry from the simulation worker, link budget engine,
 * and terrain propagation models.
 *
 * Status Classifications:
 * - CONNECTED: Operational link with nominal line-of-sight, zero diffraction loss, and valid operational MODCOD.
 * - DEGRADED: Operational link with reduced quality grounded in physical/lookahead indicators
 *             (diffraction loss > 0 dB from ITU-R 0.6 F1 Fresnel encroachment, pre-occlusion flush
 *             lookahead warning, or lowest operational MODCOD tier pi/2-BPSK 1/3).
 * - BLOCKED_TERRAIN: Non-operational due to physical terrain occlusion (optical LOS severed: terrain_is_los === false).
 * - BLOCKED_OBSTACLE: Non-operational due to artificial obstacle intersection along line of sight.
 * - OUTAGE_DISCONNECTED: Non-operational due to link-budget exhaustion (SNR below -1.5 dB demodulation threshold)
 *                        without physical terrain or obstacle blockage.
 * - UNKNOWN: Required telemetry fields are missing, malformed, or invalid.
 *
 * Conflict Resolution & Precedence:
 * 1. Invalid or missing essential telemetry (missing booleans, NaN values) -> UNKNOWN
 * 2. Artificial obstacle blockage -> BLOCKED_OBSTACLE
 *    (If terrain LOS is also occluded, BLOCKED_OBSTACLE still applies as the local screening barrier,
 *    and the reason string explicitly records that terrain LOS is also occluded).
 * 3. Physical terrain occlusion (terrain_is_los === false) -> BLOCKED_TERRAIN
 * 4. Propagation outage with clear physical geometry -> OUTAGE_DISCONNECTED
 *    (Contradictory link_outage=false with SNR < -1.5 dB or modcod=LINK_OUTAGE correctly resolves to outage).
 * 5. Operational with quality degradation factors -> DEGRADED
 * 6. Operational nominal LOS -> CONNECTED
 */

import { MODCOD_TABLE } from './linkBudget';
import { NodeTerrainState } from './trajectory';

/**
 * Standard communication link statuses for Tactical X-Band Air-to-Ground links.
 */
export type LinkCommunicationStatus =
  | 'CONNECTED'
  | 'DEGRADED'
  | 'BLOCKED_TERRAIN'
  | 'BLOCKED_OBSTACLE'
  | 'OUTAGE_DISCONNECTED'
  | 'UNKNOWN';

/**
 * Known operational MODCOD scheme names from the DVB-S2X / 3GPP Rel-17 NTN table.
 */
const KNOWN_OPERATIONAL_MODCODS = new Set<string>(MODCOD_TABLE.map((m) => m.name));

/**
 * Lowest operational DVB-S2X modulation tier at the demodulation threshold (-1.5 dB).
 */
export const THRESHOLD_MODCOD_NAME = 'pi/2-BPSK 1/3';

/**
 * Minimum SNR sensitivity threshold for DVB-S2X demodulation in dB.
 * Below this threshold, MODCOD selection drops to LINK_OUTAGE.
 */
export const MIN_OPERATIONAL_SNR_DB = -1.5;

/**
 * Floating-point tolerance for diffraction loss comparison in dB.
 */
export const DIFFRACTION_LOSS_EPSILON_DB = 1e-4;

/**
 * Telemetry input interface accepted by the link status classifier.
 * Compatible with `nodes_telemetry` items, `SelectedLinkBudgetTelemetry`,
 * and worker `obstruction_state` snapshots.
 */
export interface LinkStatusTelemetryInput {
  readonly terrain_is_los?: boolean | null;
  readonly obstacle_blocked?: boolean | null;
  readonly link_outage?: boolean | null;
  readonly is_outage?: boolean | null;
  readonly modcod_name?: string | null;
  readonly diffraction_loss_db?: number | null;
  readonly snr_db?: number | null;
  readonly bitrate_bps?: number | null;
  readonly bitrate_mbps?: number | null;
  readonly state_name?: string | NodeTerrainState | null;
  readonly predicted_state?: string | NodeTerrainState | null;
  readonly fresnel_clearance_m?: number | null;
  readonly time_to_occlusion_s?: number | null;
  readonly [key: string]: unknown;
}

/**
 * Detailed breakdown of input telemetry and identified degradation factors.
 */
export interface LinkStatusDetails {
  readonly terrainIsLos: boolean | null;
  readonly obstacleBlocked: boolean | null;
  readonly isOutage: boolean | null;
  readonly diffractionLossDb: number | null;
  readonly snrDb: number | null;
  readonly modcodName: string | null;
  readonly stateName: string | null;
  readonly degradationFactors: readonly string[];
}

/**
 * Authoritative classification result for a communication link.
 */
export interface LinkStatusClassification {
  readonly status: LinkCommunicationStatus;
  /** True only if communication link is active and transmitting data (CONNECTED or DEGRADED). */
  readonly isOperational: boolean;
  /** True if link is severed by a physical obstruction (BLOCKED_TERRAIN or BLOCKED_OBSTACLE). */
  readonly isBlocked: boolean;
  /** True if link is in an outage or blocked state (BLOCKED_TERRAIN, BLOCKED_OBSTACLE, or OUTAGE_DISCONNECTED). */
  readonly isOutage: boolean;
  /** Explicit, human-readable scientific rationale describing why this classification was chosen. */
  readonly reason: string;
  /** Normalized input telemetry fields and identified degradation factors. */
  readonly details: LinkStatusDetails;
}

/**
 * Returns true if the status represents an operational link carrying traffic.
 */
export function isLinkOperational(status: LinkCommunicationStatus): boolean {
  return status === 'CONNECTED' || status === 'DEGRADED';
}

/**
 * Returns true if the status represents a physical blockage (terrain or artificial obstacle).
 */
export function isLinkBlocked(status: LinkCommunicationStatus): boolean {
  return status === 'BLOCKED_TERRAIN' || status === 'BLOCKED_OBSTACLE';
}

/**
 * Pure, deterministic classifier function for Tactical X-Band Air-to-Ground links.
 * Evaluates authoritative telemetry against physical and lookahead propagation rules.
 */
export function classifyLinkCommunicationStatus(
  input: LinkStatusTelemetryInput | null | undefined
): LinkStatusClassification {
  // ── Step 0: Input validation & missing telemetry detection ────────────────
  if (!input || typeof input !== 'object') {
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: 'Input telemetry is missing or not a valid object.',
      details: {
        terrainIsLos: null,
        obstacleBlocked: null,
        isOutage: null,
        diffractionLossDb: null,
        snrDb: null,
        modcodName: null,
        stateName: null,
        degradationFactors: [],
      },
    };
  }

  // Essential boolean flags must be strictly boolean
  if (typeof input.obstacle_blocked !== 'boolean') {
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: "Required telemetry field 'obstacle_blocked' is missing or not a boolean.",
      details: {
        terrainIsLos: typeof input.terrain_is_los === 'boolean' ? input.terrain_is_los : null,
        obstacleBlocked: null,
        isOutage: null,
        diffractionLossDb: null,
        snrDb: null,
        modcodName: null,
        stateName: null,
        degradationFactors: [],
      },
    };
  }

  if (typeof input.terrain_is_los !== 'boolean') {
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: "Required telemetry field 'terrain_is_los' is missing or not a boolean.",
      details: {
        terrainIsLos: null,
        obstacleBlocked: input.obstacle_blocked,
        isOutage: null,
        diffractionLossDb: null,
        snrDb: null,
        modcodName: null,
        stateName: null,
        degradationFactors: [],
      },
    };
  }

  // Authoritative outage indicator must be provided as a boolean in either link_outage or is_outage
  const hasOutageBoolean =
    typeof input.link_outage === 'boolean' || typeof input.is_outage === 'boolean';
  if (!hasOutageBoolean) {
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: "Required telemetry field 'link_outage' or 'is_outage' is missing or not a boolean.",
      details: {
        terrainIsLos: input.terrain_is_los,
        obstacleBlocked: input.obstacle_blocked,
        isOutage: null,
        diffractionLossDb: null,
        snrDb: null,
        modcodName: typeof input.modcod_name === 'string' ? input.modcod_name : null,
        stateName: null,
        degradationFactors: [],
      },
    };
  }

  // Validate numeric fields when provided
  if (
    input.diffraction_loss_db !== undefined &&
    input.diffraction_loss_db !== null &&
    (typeof input.diffraction_loss_db !== 'number' || !Number.isFinite(input.diffraction_loss_db))
  ) {
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: "Telemetry field 'diffraction_loss_db' is provided but is not a finite number.",
      details: {
        terrainIsLos: input.terrain_is_los,
        obstacleBlocked: input.obstacle_blocked,
        isOutage: null,
        diffractionLossDb: null,
        snrDb: null,
        modcodName: typeof input.modcod_name === 'string' ? input.modcod_name : null,
        stateName: null,
        degradationFactors: [],
      },
    };
  }

  if (
    input.snr_db !== undefined &&
    input.snr_db !== null &&
    (typeof input.snr_db !== 'number' || !Number.isFinite(input.snr_db))
  ) {
    return {
      status: 'UNKNOWN',
      isOperational: false,
      isBlocked: false,
      isOutage: false,
      reason: "Telemetry field 'snr_db' is provided but is not a finite number.",
      details: {
        terrainIsLos: input.terrain_is_los,
        obstacleBlocked: input.obstacle_blocked,
        isOutage: null,
        diffractionLossDb: typeof input.diffraction_loss_db === 'number' ? input.diffraction_loss_db : null,
        snrDb: null,
        modcodName: typeof input.modcod_name === 'string' ? input.modcod_name : null,
        stateName: null,
        degradationFactors: [],
      },
    };
  }

  // Normalized values
  const obstacleBlocked = input.obstacle_blocked;
  const terrainIsLos = input.terrain_is_los;
  const diffractionLossDb =
    typeof input.diffraction_loss_db === 'number' && Number.isFinite(input.diffraction_loss_db)
      ? input.diffraction_loss_db
      : null;
  const snrDb =
    typeof input.snr_db === 'number' && Number.isFinite(input.snr_db) ? input.snr_db : null;
  const modcodName = typeof input.modcod_name === 'string' ? input.modcod_name : null;
  const rawState = input.state_name ?? input.predicted_state;
  const stateName = typeof rawState === 'string' ? rawState : null;

  // Resolve outage with conflict-safety:
  // If SNR is below DVB-S2X threshold (-1.5 dB) or modcod indicates outage, outage takes precedence
  // over any contradictory false flag, preventing unverified healthy classifications.
  const rawOutageBool =
    typeof input.link_outage === 'boolean' ? input.link_outage : (input.is_outage as boolean);
  const isBelowSnrCutoff = snrDb !== null && snrDb < MIN_OPERATIONAL_SNR_DB;
  const isOutageModcod = modcodName === 'LINK_OUTAGE' || modcodName === 'OBSTACLE_BLOCKED';
  const derivedOutage = rawOutageBool || isBelowSnrCutoff || isOutageModcod;

  // ── Step 1: Precedence Rule 1 — Artificial Obstacle Blockage ─────────────
  if (obstacleBlocked) {
    const terrainNote = !terrainIsLos
      ? ' (terrain optical line-of-sight is also occluded)'
      : ' (terrain line-of-sight is clear)';
    return {
      status: 'BLOCKED_OBSTACLE',
      isOperational: false,
      isBlocked: true,
      isOutage: true,
      reason: `Blocked by artificial obstacle along line-of-sight${terrainNote}.`,
      details: {
        terrainIsLos,
        obstacleBlocked: true,
        isOutage: true,
        diffractionLossDb,
        snrDb,
        modcodName,
        stateName,
        degradationFactors: [],
      },
    };
  }

  // ── Step 2: Precedence Rule 2 — Physical Terrain Occlusion ────────────────
  // Strictly governed by physical line-of-sight (terrain_is_los === false).
  // Note: HARD_SHADOW_CUTOFF is a lookahead prediction from PredictiveLookAheadEngine;
  // physical occlusion is authoritatively established when optical LOS is severed.
  if (!terrainIsLos) {
    const diffText =
      diffractionLossDb !== null ? `; diffraction loss: ${diffractionLossDb.toFixed(1)} dB` : '';
    const stateSuffix = stateName ? ` [lookahead: ${stateName}]` : '';
    return {
      status: 'BLOCKED_TERRAIN',
      isOperational: false,
      isBlocked: true,
      isOutage: true,
      reason: `Blocked by terrain obstruction (optical line-of-sight severed${diffText})${stateSuffix}.`,
      details: {
        terrainIsLos: false,
        obstacleBlocked: false,
        isOutage: true,
        diffractionLossDb,
        snrDb,
        modcodName,
        stateName,
        degradationFactors: [],
      },
    };
  }

  // ── Step 3: Precedence Rule 3 — RF Link Budget Propagation Outage ─────────
  // Physical geometry is unobstructed by both obstacles and terrain (terrain_is_los === true),
  // but link budget cannot close (SNR below -1.5 dB sensitivity threshold or link_outage flag set).
  if (derivedOutage === true || modcodName === 'LINK_OUTAGE') {
    const snrText = snrDb !== null ? ` (SNR: ${snrDb.toFixed(1)} dB < -1.5 dB threshold)` : '';
    return {
      status: 'OUTAGE_DISCONNECTED',
      isOperational: false,
      isBlocked: false,
      isOutage: true,
      reason: `Disconnected due to link-budget outage (insufficient SNR for demodulation; terrain and obstacles are clear${snrText}).`,
      details: {
        terrainIsLos: true,
        obstacleBlocked: false,
        isOutage: true,
        diffractionLossDb,
        snrDb,
        modcodName: modcodName ?? 'LINK_OUTAGE',
        stateName,
        degradationFactors: [],
      },
    };
  }

  // ── Step 4: Precedence Rule 4 — Operational Link Degradation Analysis ────
  // Link is operational (not in outage, not blocked). Evaluate defensible indicators:
  const degradationFactors: string[] = [];
  const factorDescriptions: string[] = [];

  // A. Knife-edge Fresnel encroachment (diffraction loss > 0 dB while in optical LOS)
  // Rationale: In TerrainEngine (ITU-R P.526), when 0.0 < minClearanceRatio < 0.6,
  // knife-edge diffraction loss is 6.0 * (1.0 - ratio / 0.6) dB > 0.0 dB.
  if (diffractionLossDb !== null && diffractionLossDb > DIFFRACTION_LOSS_EPSILON_DB) {
    degradationFactors.push('fresnel_diffraction_encroachment');
    factorDescriptions.push(
      `terrain knife-edge diffraction loss ${diffractionLossDb.toFixed(1)} dB (0.6 F1 Fresnel encroachment)`
    );
  }

  // B. Predictive lookahead pre-occlusion flush state
  // Rationale: Lookahead engine calculates terminal will enter terrain shadow within lookahead horizon (<= 3.0s).
  if (stateName === NodeTerrainState.PRE_OCCLUSION_FLUSH) {
    degradationFactors.push('pre_occlusion_lookahead_warning');
    const timeToOcc =
      typeof input.time_to_occlusion_s === 'number' && input.time_to_occlusion_s >= 0
        ? ` in ${input.time_to_occlusion_s.toFixed(1)}s`
        : '';
    factorDescriptions.push(
      `predictive lookahead pre-occlusion flush active (terrain shadow imminent${timeToOcc})`
    );
  }

  // C. Lowest operational DVB-S2X modulation tier
  // Rationale: pi/2-BPSK 1/3 operates at the absolute threshold (-1.5 dB). Any additional loss triggers complete outage.
  if (modcodName === THRESHOLD_MODCOD_NAME) {
    degradationFactors.push('threshold_modcod_tier');
    const snrSuffix = snrDb !== null ? ` at SNR ${snrDb.toFixed(1)} dB` : '';
    factorDescriptions.push(
      `lowest operational modulation tier (${THRESHOLD_MODCOD_NAME}${snrSuffix})`
    );
  }

  if (degradationFactors.length > 0) {
    return {
      status: 'DEGRADED',
      isOperational: true,
      isBlocked: false,
      isOutage: false,
      reason: `Operational with degraded link quality: ${factorDescriptions.join('; ')}.`,
      details: {
        terrainIsLos: true,
        obstacleBlocked: false,
        isOutage: false,
        diffractionLossDb,
        snrDb,
        modcodName,
        stateName,
        degradationFactors,
      },
    };
  }

  // ── Step 5: Precedence Rule 5 — Nominal Line-of-Sight Connected ──────────
  const modcodDesc = modcodName ? `MODCOD: ${modcodName}` : 'MODCOD operational';
  const snrDesc = snrDb !== null ? `, SNR: ${snrDb.toFixed(1)} dB` : '';
  const diffDesc = diffractionLossDb !== null ? `, ${diffractionLossDb.toFixed(1)} dB diffraction` : '';

  return {
    status: 'CONNECTED',
    isOperational: true,
    isBlocked: false,
    isOutage: false,
    reason: `Nominal operational line-of-sight link connected (${modcodDesc}${snrDesc}${diffDesc}).`,
    details: {
      terrainIsLos: true,
      obstacleBlocked: false,
      isOutage: false,
      diffractionLossDb,
      snrDb,
      modcodName,
      stateName,
      degradationFactors: [],
    },
  };
}
