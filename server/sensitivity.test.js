import test from "node:test";
import assert from "node:assert/strict";
import { COD_YAW, radiansPerCount, cmPer360, fromOldSensitivity, clampSens, SENS_MIN, SENS_MAX } from "../js/sensitivity.js";

const degrees = (r) => (r * 180) / Math.PI;

test("one point of sensitivity turns 0.0066 degrees per mouse count, like Modern Warfare, Warzone and Black Ops 6", () => {
  assert.equal(COD_YAW, 0.0066);
  assert.ok(Math.abs(degrees(radiansPerCount(1)) - 0.0066) < 1e-12);
  assert.ok(Math.abs(degrees(radiansPerCount(6)) - 0.0396) < 1e-12);
});

test("the cm per 360 matches the published Call of Duty figures", () => {
  assert.ok(Math.abs(cmPer360(6, 800) - 28.9) < 0.05, "sens 6 at 800 DPI is about 28.9 cm");
  assert.ok(Math.abs(cmPer360(0.4, 800) - 432.95) < 0.5, "sens 0.4 at 800 DPI is about 433 cm");
});

test("an old saved sensitivity is converted so it turns exactly as fast as before", () => {
  for (const old of [1, 3, 6, 6.5, 8]) {
    const before = old * 0.00035; // radians per count on the old scale
    const after = radiansPerCount(fromOldSensitivity(old));
    assert.ok(Math.abs(after - before) / before < 0.002, `old ${old}: ${before} vs ${after}`);
  }
  assert.equal(fromOldSensitivity(6), 18.23);
});

test("sensitivity is kept inside the slider's range and junk falls back to the default", () => {
  assert.equal(clampSens(0), SENS_MIN);
  assert.equal(clampSens(500), SENS_MAX);
  assert.equal(clampSens(NaN), 6);
  assert.equal(clampSens(7.25), 7.25);
  assert.equal(fromOldSensitivity(100), SENS_MAX, "a huge old value can't go past the slider");
});
