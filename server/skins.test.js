import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKINS, SKIN_IDS, DEFAULT_SKIN, skinById, skinUnlocked, nextSkin, lookWithUnlockedSkin, skinTextureUrl, skinThumbUrl } from "./skins.js";
import { cleanRelay } from "./validate.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("the browser and relay copies of the shared files are identical", () => {
  assert.equal(read("js/skins.js"), read("server/skins.js"));
  assert.equal(read("js/validate.js"), read("server/validate.js"));
});

test("the skin list: Solid is the default and free, ids are unique, kills only go up", () => {
  assert.equal(DEFAULT_SKIN, "solid");
  assert.equal(skinById("solid").kills, 0);
  assert.equal(new Set(SKIN_IDS).size, SKINS.length);
  assert.equal(SKINS.filter((s) => s.kills === 0).length, 2, "two free skins: Solid and one more");
  for (let i = 1; i < SKINS.length; i++) assert.ok(SKINS[i].kills >= SKINS[i - 1].kills, `${SKINS[i].id} is out of order`);
  assert.ok(SKINS.length >= 15);
});

test("every skin has its texture and thumbnail files, and they are real images", () => {
  for (const s of SKINS) {
    if (s.id === "solid") continue;
    for (const url of [skinTextureUrl(s.id), skinThumbUrl(s.id)]) {
      const file = path.join(root, url.replace("./", ""));
      assert.ok(fs.existsSync(file), `${s.id}: missing ${url}`);
      const head = fs.readFileSync(file).subarray(0, 4);
      const isPng = head[0] === 0x89 && head[1] === 0x50;
      const isJpg = head[0] === 0xff && head[1] === 0xd8;
      assert.ok(isPng || isJpg, `${s.id}: ${url} is not a PNG or JPEG`);
    }
  }
});

test("a skin is unlocked exactly when your kills reach its number", () => {
  const camo = skinById("camo");
  assert.equal(camo.kills, 5);
  assert.equal(skinUnlocked(camo, 4), false);
  assert.equal(skinUnlocked(camo, 5), true);
  assert.equal(skinUnlocked(camo, 500), true);
  assert.equal(skinUnlocked(camo, NaN), false);
  assert.equal(skinUnlocked(camo, undefined), false);
  assert.equal(skinUnlocked(null, 99), false);
  assert.equal(skinUnlocked(skinById("solid"), 0), true);
});

test("the next skin to unlock is the nearest one above your kills, and null when you have them all", () => {
  assert.equal(nextSkin(0).id, "camo");
  assert.equal(nextSkin(5).id, "digital");
  assert.equal(nextSkin(99).id, "neon");
  assert.equal(nextSkin(100).id, "ice");
  assert.equal(nextSkin(5000), null);
  assert.equal(nextSkin(1e9), null);
});

test("the relay swaps a skin you haven't unlocked for Solid and leaves everything else alone", () => {
  const look = { color: 1234, pattern: "gold", accessory: "crown" };
  assert.deepEqual(lookWithUnlockedSkin(look, 0), { color: 1234, pattern: "solid", accessory: "crown" });
  assert.deepEqual(lookWithUnlockedSkin(look, 3499), { color: 1234, pattern: "solid", accessory: "crown" });
  assert.equal(lookWithUnlockedSkin(look, 3500), look, "unlocked: the very same look comes back");
  const free = { pattern: "checker" };
  assert.equal(lookWithUnlockedSkin(free, 0), free);
  assert.equal(lookWithUnlockedSkin(look, NaN).pattern, "solid", "unknown kills counts as none");
  assert.equal(lookWithUnlockedSkin(null, 0), null);
  assert.ok(look.pattern === "gold", "the original is not changed");
});

test("only known skin ids get through the relay's look check (old pattern names are dropped)", () => {
  const hello = (pattern) => cleanRelay({ t: "hello", name: "Abc", look: { color: 5, pattern, accessory: "none" } });
  assert.equal(hello("gold").look.pattern, "gold");
  assert.equal(hello("checker").look.pattern, "checker");
  for (const bad of ["stripes", "bands", "dots", "../../etc/passwd", "<script>", "", 7, null]) {
    assert.equal(hello(bad).look.pattern, undefined, `${String(bad)} should not pass`);
  }
});
