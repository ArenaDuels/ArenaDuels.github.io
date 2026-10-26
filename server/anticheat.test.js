// Run with:  cd server && npm test
import test from "node:test";
import assert from "node:assert/strict";
import { RoomGuard } from "./anticheat.js";

const FACE_PLUS_X = -Math.PI / 2;  // yaw that looks toward +x
const FACE_MINUS_X = Math.PI / 2;

// A shared fake clock so every test is deterministic.
function setup({ arena, arenaId = "classic" } = {}) {
  const g = new RoomGuard({ arenaId, hostId: "host", arena });
  g.addMember("host", 0);
  g.addMember("p2", 0);
  const clock = { now: 1000 };
  const put = (id, x, z, yaw, extra = {}) =>
    g.onState(id, { x, y: 1.4, z, yaw, pitch: 0, hp: 100, firing: false, ...extra }, clock.now);
  // host at x=-10 looking at p2 at x=+10
  const duel = (hostFiring = true) => {
    put("host", -10, 0, FACE_PLUS_X, { firing: hostFiring });
    put("p2", 10, 0, FACE_MINUS_X);
  };
  const hit = (attackerId, targetId, damage = 0.5, sender = attackerId) =>
    g.checkHit(sender, sender === "host", { t: "hit", attackerId, targetId, damage }, clock.now);
  // Hold the beam on `target` for `seconds` at 60fps, states every 3 frames. Returns total damage dealt.
  const beam = (attacker, target, seconds) => {
    let dealt = 0;
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      clock.now += 1000 / 60;
      if (i % 3 === 0) {
        put("host", -10, 0, FACE_PLUS_X, { firing: attacker === "host" });
        put("p2", 10, 0, FACE_MINUS_X, { firing: attacker === "p2" });
      }
      const r = hit(attacker, target, 40 / 60);
      if (r.ok) dealt += r.damage;
    }
    return dealt;
  };
  return { g, clock, put, duel, hit, beam };
}

test("a normal shot goes through unchanged", () => {
  const { duel, hit } = setup();
  duel();
  const r = hit("host", "p2", 0.6);
  assert.equal(r.ok, true);
  assert.equal(r.damage, 0.6);
});

test("aiming away from the target is rejected", () => {
  const { put, hit } = setup();
  put("host", -10, 0, FACE_MINUS_X, { firing: true }); // looking at the wall behind them
  put("p2", 10, 0, FACE_MINUS_X);
  assert.deepEqual(hit("host", "p2"), { ok: false, reason: "off-target" });
});

test("a target far outside the arena is out of range", () => {
  const { put, hit } = setup();
  put("host", -10, 0, FACE_PLUS_X, { firing: true });
  put("p2", 900, 0, 0);
  assert.equal(hit("host", "p2").reason, "out-of-range");
});

test("walls block shots; open lines of sight don't", () => {
  const arena = {
    floorSize: 30,
    walls: [],
    props: [{ w: 2, h: 8, d: 10, x: 0, y: 4, z: 0 }], // a pillar between the two players
  };
  const { put, hit } = setup({ arena });
  put("host", -10, 0, FACE_PLUS_X, { firing: true });
  put("p2", 10, 0, FACE_MINUS_X);
  assert.equal(hit("host", "p2").reason, "blocked");

  // p2 steps out from behind the pillar (and the host turns to follow)
  const { put: put2, hit: hit2, clock } = setup({ arena });
  clock.now += 3000;
  put2("host", -10, 0, FACE_PLUS_X, { firing: true });
  put2("p2", 10, 12, FACE_MINUS_X);
  // aim at them: direction from (-10,0) to (10,12)
  put2("host", -10, 0, Math.atan2(-20, -12), { firing: true });
  const r = hit2("host", "p2");
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("lag tolerance: a target who just moved out of the line of fire can still be hit", () => {
  const { put, hit, clock } = setup();
  put("host", -10, 0, FACE_PLUS_X, { firing: true });
  put("p2", 10, 0, FACE_MINUS_X);
  clock.now += 50;
  put("p2", 10, 6, FACE_MINUS_X); // moved sideways since
  put("host", -10, 0, FACE_PLUS_X, { firing: true });
  assert.equal(hit("host", "p2").ok, true); // shooter was looking at where p2 *was*
});

test("unknown targets, self hits and impersonation are rejected", () => {
  const { duel, hit } = setup();
  duel();
  assert.equal(hit("host", "nobody").reason, "unknown-target");
  assert.equal(hit("host", "host").reason, "self-hit");
  assert.equal(hit("p2", "host", 0.5, "host").reason, "bad-attacker"); // host claiming p2 shot
  assert.equal(hit("bot-1", "p2", 0.5, "host").reason, "unknown-attacker");
});

test("no hits without a state, or from a dead attacker", () => {
  const { g, put, hit } = setup();
  assert.equal(hit("host", "p2").reason, "attacker-no-state");
  put("host", -10, 0, FACE_PLUS_X, { firing: true });
  assert.equal(hit("host", "p2").reason, "target-no-state");
  put("p2", 10, 0, FACE_MINUS_X);
  put("host", -10, 0, FACE_PLUS_X, { firing: true, hp: 0 });
  assert.equal(hit("host", "p2").reason, "attacker-dead");
  assert.ok(g);
});

test("damage is capped at what the beam can deal", () => {
  const { duel, hit } = setup();
  duel();
  let total = 0;
  // 200 forged hits of 40 damage each, all at the same instant
  for (let i = 0; i < 200; i++) {
    const r = hit("host", "p2", 40);
    if (r.ok) total += r.damage;
  }
  assert.ok(total <= 30.01, `a burst may not exceed the 30-damage allowance, got ${total}`);
  assert.equal(hit("host", "p2", 40).reason, "damage-rate");
});

test("sustained fire does about 40 damage per second, no more", () => {
  const { duel, beam } = setup();
  duel();
  const dealt = beam("host", "p2", 2);
  assert.ok(dealt > 70 && dealt < 90, `expected ~80 for 2s of beam, got ${dealt.toFixed(1)}`);
});

test("a flood of hits faster than the beam is clamped to the beam's rate", () => {
  const { duel, clock, put, hit } = setup();
  duel();
  let dealt = 0;
  for (let i = 0; i < 300; i++) { // 3 seconds, hits every 10ms for 20 damage each
    clock.now += 10;
    if (i % 5 === 0) put("host", -10, 0, FACE_PLUS_X, { firing: true });
    const r = hit("host", "p2", 20);
    if (r.ok) dealt += r.damage;
  }
  assert.ok(dealt < 3 * 44 + 30 + 1, `3s should allow at most ~162, got ${dealt.toFixed(1)}`);
});

test("hits without a 'firing' state only get a tiny allowance", () => {
  const { duel, hit } = setup();
  duel(false);
  let total = 0;
  for (let i = 0; i < 50; i++) {
    const r = hit("host", "p2", 5);
    if (r.ok) total += r.damage;
  }
  assert.ok(total <= 6.01, `got ${total}`);
  assert.equal(hit("host", "p2", 5).reason, "not-firing");
});

test("a kill with no damage behind it is refused", () => {
  const { duel, g, clock } = setup();
  duel();
  const r = g.checkKill("p2", false, { t: "kill", attackerId: "host", victimId: "p2" }, clock.now);
  assert.deepEqual(r, { ok: false, reason: "not-enough-damage" });
});

test("a real kill is accepted once, and the server decides who gets credit", () => {
  const { duel, beam, g, clock } = setup();
  duel();
  beam("host", "p2", 3); // 120 damage worth of beam, 100 hp
  // p2 (the victim) announces their own death but tries to credit themselves / someone else
  const r = g.checkKill("p2", false, { t: "kill", attackerId: "p2", victimId: "p2" }, clock.now);
  assert.equal(r.ok, true);
  assert.equal(r.attackerId, "host");
  assert.equal(g.checkKill("p2", false, { t: "kill", attackerId: "host", victimId: "p2" }, clock.now).reason, "already-dead");
});

test("you can't announce somebody else's death", () => {
  const { duel, beam, g, clock } = setup();
  duel();
  beam("host", "p2", 3);
  assert.equal(g.checkKill("host", true, { t: "kill", attackerId: "host", victimId: "p2" }, clock.now).reason, "bad-victim");
});

test("dead players can't be hit until they respawn", () => {
  const { duel, beam, g, clock, hit, put } = setup();
  duel();
  beam("host", "p2", 3);
  g.checkKill("p2", false, { t: "kill", attackerId: "host", victimId: "p2" }, clock.now);
  put("p2", 10, 0, FACE_MINUS_X, { hp: 0 });
  assert.equal(hit("host", "p2").reason, "target-dead");
  clock.now += 2000; // default respawn delay
  put("p2", 10, 0, FACE_MINUS_X, { hp: 100 });
  put("host", -10, 0, FACE_PLUS_X, { firing: true });
  assert.equal(hit("host", "p2").ok, true);
  // ...and their health really is back: one tap isn't a kill
  assert.equal(g.checkKill("p2", false, { t: "kill", attackerId: "host", victimId: "p2" }, clock.now).reason, "not-enough-damage");
});

test("nothing is accepted after the match has ended, until a restart", () => {
  const { duel, g, hit } = setup();
  duel();
  g.onEnd();
  assert.equal(hit("host", "p2").reason, "match-over");
  g.onRestart({ startingHealth: 100, respawnDelay: 2 });
  assert.equal(hit("host", "p2").ok, true);
});

test("match settings change how much damage counts as lethal", () => {
  const { duel, g, clock, beam } = setup();
  g.onRestart({ startingHealth: 300, respawnDelay: 2 });
  duel();
  beam("host", "p2", 3); // ~120 damage: lethal at 100hp, not at 300
  assert.equal(g.checkKill("p2", false, { t: "kill", attackerId: "host", victimId: "p2" }, clock.now).reason, "not-enough-damage");
});

// ---- bots ----

const bot = (id, x, z, yaw, extra = {}) => ({ id, name: "Bot", x, y: 1.4, z, yaw, pitch: 0, hp: 100, firing: false, ...extra });

test("bots can hit a human only if they're really aimed at them", () => {
  const { g, put, clock } = setup();
  put("p2", 10, 0, FACE_MINUS_X);
  g.onBots([bot("bot-1", -10, 0, FACE_PLUS_X, { firing: true })], clock.now);
  const ok = g.checkHit("host", true, { t: "hit", attackerId: "bot-1", targetId: "p2", damage: 0.4 }, clock.now);
  assert.equal(ok.ok, true);
  clock.now += 500; // longer than the lag-tolerance window, so the old aim no longer counts
  g.onBots([bot("bot-1", -10, 0, FACE_MINUS_X, { firing: true })], clock.now);
  put("p2", 10, 0, FACE_MINUS_X);
  const bad = g.checkHit("host", true, { t: "hit", attackerId: "bot-1", targetId: "p2", damage: 0.4 }, clock.now);
  assert.equal(bad.reason, "off-target");
  // a non-host can't speak for a bot
  assert.equal(g.checkHit("p2", false, { t: "hit", attackerId: "bot-1", targetId: "p2", damage: 0.4 }, clock.now).reason, "bad-attacker");
});

test("bot deaths: host may announce them once per life, remote players need real hits", () => {
  const { g, put, clock } = setup();
  put("host", -10, 0, FACE_PLUS_X);
  put("p2", 10, 0, FACE_MINUS_X, { firing: true });
  g.onBots([bot("bot-1", 0, 0, 0)], clock.now);
  // the host killing it themselves
  const k = { t: "kill", attackerId: "host", victimId: "bot-1" };
  assert.equal(g.checkKill("host", true, k, clock.now).ok, true);
  assert.equal(g.checkKill("host", true, k, clock.now).reason, "already-dead");
  // it respawns, then the host tries to credit p2 who never touched it
  clock.now += 3000;
  g.onBots([bot("bot-1", 0, 0, 0, { hp: 0 })], clock.now);
  g.onBots([bot("bot-1", 0, 0, 0, { hp: 100 })], clock.now + 50);
  clock.now += 50;
  const forged = { t: "kill", attackerId: "p2", victimId: "bot-1" };
  assert.equal(g.checkKill("host", true, forged, clock.now).reason, "no-credit");
  // after p2 really shoots it, the credit is fine
  put("p2", 10, 0, FACE_MINUS_X, { firing: true });
  g.onBots([bot("bot-1", 0, 0, 0)], clock.now);
  assert.equal(g.checkHit("p2", false, { t: "hit", attackerId: "p2", targetId: "bot-1", damage: 0.5 }, clock.now).ok, true);
  assert.equal(g.checkKill("host", true, forged, clock.now).ok, true);
});

test("the host's death to bots (unseen by the relay) is still believed", () => {
  const { g, put, clock } = setup();
  put("host", -10, 0, FACE_PLUS_X);
  g.onBots([bot("bot-1", 10, 0, FACE_MINUS_X)], clock.now);
  const r = g.checkKill("host", true, { t: "kill", attackerId: "bot-1", victimId: "host" }, clock.now);
  assert.deepEqual(r, { ok: true, attackerId: "bot-1" });
});

test("a non-host can't use the bot allowance to fake their own death", () => {
  const { g, put, clock } = setup();
  put("p2", 10, 0, FACE_MINUS_X);
  g.onBots([bot("bot-1", 0, 0, 0)], clock.now);
  const r = g.checkKill("p2", false, { t: "kill", attackerId: "bot-1", victimId: "p2" }, clock.now);
  assert.equal(r.reason, "not-enough-damage");
});

test("real arenas load and have walls that block", () => {
  for (const arenaId of ["classic", "foundry", "ruins", "neon", "mansion"]) {
    const g = new RoomGuard({ arenaId, hostId: "host" });
    assert.ok(g.geo.boxes.length >= 4, arenaId);
    assert.ok(g.geo.maxRange > 30, arenaId);
  }
});
