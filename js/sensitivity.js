// Mouse sensitivity on Call of Duty's scale.
//
// Warzone, Modern Warfare II/III, Black Ops 6 and 7 turn 0.0066 degrees per mouse count for each point of
// sensitivity, and Modern Warfare 4 is reported to use the same scale. Using the same number here means the same sensitivity setting and the same mouse DPI
// give the same distance of mouse travel for a full turn (cm/360) as in those games.
// (Black Ops Cold War is the odd one out: it turns about 1.32x faster for the same number.)

export const COD_YAW = 0.0066;
export const SENS_MIN = 0.1;
export const SENS_MAX = 30;
export const SENS_SCALE = 2; // saved settings from before this scale (the old, faster one) are version 1

const OLD_RADIANS_PER_POINT = 0.00035; // what one point of sensitivity used to be, in radians per count
const RADIANS_PER_DEGREE = Math.PI / 180;

// How far the view turns, in radians, for one raw mouse count.
export const radiansPerCount = (sens) => sens * COD_YAW * RADIANS_PER_DEGREE;

// Centimetres of mouse travel for a full 360 turn.
export const cmPer360 = (sens, dpi) => (360 * 2.54) / (dpi * sens * COD_YAW);

export const clampSens = (v) => Math.min(SENS_MAX, Math.max(SENS_MIN, Number.isFinite(v) ? v : 6));

// A sensitivity saved on the old scale, converted so the aim feels exactly the same on the new one.
export function fromOldSensitivity(old) {
  return clampSens(Math.round(((old * OLD_RADIANS_PER_POINT) / (COD_YAW * RADIANS_PER_DEGREE)) * 100) / 100);
}
