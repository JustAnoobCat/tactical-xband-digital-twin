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

