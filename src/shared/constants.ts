/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Centralized Shared Simulation & Environment Constants
 */

/** Nominal discrete simulation superframe duration (50 Hz = 20 ms). */
export const FRAME_DT = 0.020;

/** Regional theater half-span from origin (+/- 600 km, giving 1,200 x 1,200 km domain). */
export const THEATER_HALF_M = 600000.0;

/** Dedicated numeric node identifier for the Main Command Post. */
export const MCP_ID = 15;

/** Special node identifier for the Aerial Communication Node (e.g. orbit drag translation). */
export const ACN_ID = -1;

/** Standard number of ray-march samples across the propagation path for Fresnel clearance analysis. */
export const FRESNEL_SAMPLES = 80;

/** Minimum antenna height above ground level in metres. */
export const MIN_GROUND_AGL_M = 0.0;

/** Maximum antenna height above ground level in metres. */
export const MAX_GROUND_AGL_M = 1000.0;

/** Default antenna height above ground level in metres for newly created ground nodes. */
export const DEFAULT_ANTENNA_AGL_M = 2.0;

/** Maximum capacity ceiling of active ground nodes in the simulation. */
export const MAX_ACTIVE_GROUND_NODES = 128;

/**
 * Playback frame-request multiplier bounds and UI presets.
 * This controls wall-clock execution cadence only; it does not alter
 * FRAME_DT, aircraft airspeed, or any link/scheduling result.
 */
export const PLAYBACK_SPEED = {
  min: 0.1,
  max: 10.0,
  step: 0.05,
  defaultValue: 1.0,
  presets: [0.5, 1.0, 2.0, 5.0, 10.0],
} as const;


