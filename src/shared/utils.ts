/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Shared Utility Functions
 */

/**
 * Type guard verifying that a value is a finite number (excluding NaN and Infinities).
 */
export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Clamps a numeric value within the inclusive range [min, max].
 */
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
