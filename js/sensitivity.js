// Mouse sensitivity conversion and turn-rate helpers.

export const DEGREES_PER_COUNT_PER_SENSITIVITY = 0.0066;
export const SENS_MIN = 0.1;
export const SENS_MAX = 30;
export const SENS_SCALE = 2; // saved settings from before this scale (the old, faster one) are version 1

const OLD_RADIANS_PER_POINT = 0.00035; // previous sensitivity scale, in radians per count
const RADIANS_PER_DEGREE = Math.PI / 180;

// How far the view turns, in radians, for one raw mouse count.
export const radiansPerCount = (sens) => sens * DEGREES_PER_COUNT_PER_SENSITIVITY * RADIANS_PER_DEGREE;

// Centimetres of mouse travel for a full 360 turn.
export const cmPer360 = (sens, dpi) => (360 * 2.54) / (dpi * sens * DEGREES_PER_COUNT_PER_SENSITIVITY);

export const clampSens = (v) => Math.min(SENS_MAX, Math.max(SENS_MIN, Number.isFinite(v) ? v : 6));

// Convert a saved value from the previous scale while preserving its turn rate.
export function fromOldSensitivity(old) {
  return clampSens(Math.round(((old * OLD_RADIANS_PER_POINT) / (DEGREES_PER_COUNT_PER_SENSITIVITY * RADIANS_PER_DEGREE)) * 100) / 100);
}
