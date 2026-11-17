import test from "node:test";
import assert from "node:assert/strict";
import { ACCESSORY_WINS, winsNeeded, accessoryUnlocked, nextAccessory, lookWithUnlockedAccessory } from "./accessory-unlocks.js";
import { ACCESSORIES } from "../js/customization.js";

test("the four earned accessories need 3, 6, 10 and 15 wins; 15 is the hardest", () => {
  assert.deepEqual(ACCESSORY_WINS, { headphones: 3, cowboy: 6, wizard: 10, viking: 15 });
  assert.equal(Math.max(...Object.values(ACCESSORY_WINS)), 15);
});

test("every earned accessory really exists, and the others stay free", () => {
  const ids = ACCESSORIES.map((a) => a.id);
  for (const id of Object.keys(ACCESSORY_WINS)) assert.ok(ids.includes(id), `${id} is not an accessory`);
  for (const id of ["none", "tophat", "crown", "halo", "antenna"]) assert.equal(winsNeeded(id), 0, `${id} should be free`);
  assert.ok(!ids.includes("catears") && !ids.includes("bunny"));
});

test("an accessory is unlocked exactly when your wins reach its number", () => {
  assert.equal(accessoryUnlocked("viking", 14), false);
  assert.equal(accessoryUnlocked("viking", 15), true);
  assert.equal(accessoryUnlocked("viking", 99), true);
  assert.equal(accessoryUnlocked("viking", NaN), false);
  assert.equal(accessoryUnlocked("viking", undefined), false);
  assert.equal(accessoryUnlocked("crown", 0), true);
  assert.equal(accessoryUnlocked("none", undefined), true);
});

test("the next accessory is the nearest one above your wins, and null when you have them all", () => {
  assert.deepEqual(nextAccessory(0), { id: "headphones", wins: 3 });
  assert.deepEqual(nextAccessory(3), { id: "cowboy", wins: 6 });
  assert.deepEqual(nextAccessory(14), { id: "viking", wins: 15 });
  assert.equal(nextAccessory(15), null);
});

test("the relay swaps an accessory you haven't earned for none, and leaves everything else alone", () => {
  const look = { color: 255, pattern: "camo", accessory: "wizard" };
  assert.deepEqual(lookWithUnlockedAccessory(look, 9), { color: 255, pattern: "camo", accessory: "none" });
  assert.equal(lookWithUnlockedAccessory(look, 10), look);
  const free = { accessory: "halo" };
  assert.equal(lookWithUnlockedAccessory(free, 0), free);
  assert.equal(lookWithUnlockedAccessory(null, 0), null);
});
