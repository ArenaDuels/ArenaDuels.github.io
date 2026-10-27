// Run with:  cd server && npm test
import test from "node:test";
import assert from "node:assert/strict";
import { RoomGuard } from "./anticheat.js";

const FACE_PLUS_X = -Math.PI / 2;  // yaw that looks toward +x
const FACE_MINUS_X = Math.PI / 2;
const Y = 1.4;                     // capsule centre when standing on the floor

const OPEN_ARENA = {
  floorSize: 30,
  walls: [],
  props: [],
  spawns: [{ x: -12, y: Y, z: 0, yaw: FACE_PLUS_X }, { x: 12, y: Y, z: 0, yaw: FACE_MINUS_X }, { x: 0, y: Y, z: 12, yaw: 0 }],
};
// A solid pillar between x=-1 and x=1.
const PILLAR_ARENA = { ...OPEN_ARENA, props: [{ w: 2, h: 8, d: 10, x: 0, y: 4, z: 0 }] };

function setup({ arena = OPEN_ARENA, enforce = true } = {}) {
  const rejects = [];
  const g = new RoomGuard({ arenaId: "classic", hostId: "host", arena, enforce, onReject: (k) => rejects.push(k) });
  g.addMember("host", 0);
  g.addMember("p2", 0);
  const clock = { now: 10_000 }; // well past the join grace period
  g.lastTickAt = clock.now;

  const put = (id, x, z, yaw = 0, extra = {}) => {
    const { y = Y, ...rest } = extra;
    return g.onState(id, { x, y, z, yaw, pitch: 0, hp: 100, firing: false, tp: 0, ...rest }, clock.now);
  };
  // host at x=-10 facing p2 at x=+10
  const duel = ({ hostFiring = false, p2Firing = false } = {}) => {
    put("host", -10, 0, FACE_PLUS_X, { firing: hostFiring });
    put("p2", 10, 0, FACE_MINUS_X, { firing: p2Firing });
  };
  // Run the room clock for `seconds`: tick every 33ms, clients report every 50ms.
  const run = (seconds, { hostFiring = false, p2Firing = false, hostAim = FACE_PLUS_X, after } = {}) => {
    const events = [];
    const end = clock.now + seconds * 1000;
    let lastReport = -Infinity;
    while (clock.now < end) {
      clock.now += 33;
      if (clock.now - lastReport >= 50) {
        lastReport = clock.now;
        const h = g.actors.get("host");
        const p = g.actors.get("p2");
        put("host", h.pos?.x ?? -10, h.pos?.z ?? 0, hostAim, { firing: hostFiring, y: h.pos?.y ?? Y, tp: h.tp });
        put("p2", p.pos?.x ?? 10, p.pos?.z ?? 0, FACE_MINUS_X, { firing: p2Firing, y: p.pos?.y ?? Y, tp: p.tp });
      }
      events.push(...g.tick(clock.now));
      after?.();
    }
    return events;
  };
  const hp = (id) => g.actors.get(id).hp;
  return { g, clock, put, duel, run, hp, rejects };
}

// =============================================================== beam & health

test("holding the trigger on someone does about 40 damage a second", () => {
  const { duel, run, hp } = setup();
  duel();
  run(1, { hostFiring: true });
  assert.ok(hp("p2") > 55 && hp("p2") < 65, `expected ~60, got ${hp("p2").toFixed(1)}`);
  assert.equal(hp("host"), 100);
});

test("not holding the trigger does nothing", () => {
  const { duel, run, hp } = setup();
  duel();
  run(2, { hostFiring: false });
  assert.equal(hp("p2"), 100);
});

test("aiming somewhere else does nothing", () => {
  const { duel, run, hp } = setup();
  duel();
  run(2, { hostFiring: true, hostAim: FACE_MINUS_X });
  assert.equal(hp("p2"), 100);
});

test("walls stop the beam", () => {
  const { duel, run, hp } = setup({ arena: PILLAR_ARENA });
  duel();
  run(2, { hostFiring: true });
  assert.equal(hp("p2"), 100);
});

test("flooding the server with messages doesn't make the beam hit harder", () => {
  const { g, clock, put, duel, hp } = setup();
  duel();
  const end = clock.now + 1000;
  let nextTick = clock.now;
  while (clock.now < end) {
    clock.now += 5; // a state every 5ms instead of every 50
    put("host", -10, 0, FACE_PLUS_X, { firing: true });
    put("p2", 10, 0, FACE_MINUS_X);
    if (clock.now >= nextTick) {
      g.tick(clock.now);
      nextTick += 33;
    }
  }
  assert.ok(hp("p2") > 50 && hp("p2") < 75, `damage should still follow the clock, got ${hp("p2")}`);
});

test("a client can't set its own health", () => {
  const { put, duel, run, hp } = setup();
  duel();
  run(1, { hostFiring: true });
  const before = hp("p2");
  const r = put("p2", 10, 0, FACE_MINUS_X, { hp: 100 }); // lying: "I'm at full health"
  assert.equal(hp("p2"), before);
  assert.equal(r.hp, before); // and what gets relayed to everyone is the server's number
});

test("a player's health reaches them as 'hp' messages, a kill is announced once to everyone", () => {
  const { duel, run, hp } = setup();
  duel();
  const events = run(3, { hostFiring: true });
  assert.equal(hp("p2"), 0);
  const kills = events.filter((e) => e.msg.t === "kill");
  assert.equal(kills.length, 1);
  assert.deepEqual(kills[0], { to: "all", msg: { t: "kill", attackerId: "host", victimId: "p2" } });
  const toVictim = events.filter((e) => e.to === "p2" && e.msg.t === "hp");
  assert.ok(toVictim.length > 5);
  assert.equal(toVictim.at(-1).msg.hp, 0);
  // the 'hp: 0' reaches the victim before the kill does
  assert.ok(events.indexOf(toVictim.at(-1)) < events.indexOf(kills[0]));
});

test("the dead can't be hurt again and can't shoot", () => {
  const { duel, run, hp } = setup();
  duel();
  run(3, { hostFiring: true });
  assert.equal(hp("p2"), 0);
  const events = run(1, { hostFiring: true, p2Firing: true });
  assert.equal(events.filter((e) => e.msg.t === "kill").length, 0);
  assert.equal(hp("host"), 100); // p2 is dead: their trigger does nothing
});

test("after the respawn delay the server puts them back at a spawn point with full health", () => {
  const { g, duel, run, hp } = setup();
  duel();
  run(3, { hostFiring: true });
  const early = run(1, { hostFiring: false });
  assert.equal(early.filter((e) => e.msg.t === "respawn").length, 0, "default delay is 2s");
  const events = run(1.5, { hostFiring: false });
  const resp = events.filter((e) => e.msg.t === "respawn");
  assert.equal(resp.length, 1);
  assert.equal(resp[0].to, "p2");
  assert.ok(OPEN_ARENA.spawns.some((s) => s.x === resp[0].msg.x && s.z === resp[0].msg.z));
  assert.equal(resp[0].msg.tp, 1);
  assert.equal(hp("p2"), 100);
  assert.equal(g.actors.get("p2").alive, true);
});

test("health steal heals the shooter, up to full", () => {
  const { g, duel, run, hp } = setup();
  g.onRestart({ startingHealth: 100, respawnDelay: 2, healthSteal: 50 }, 0);
  duel();
  run(0.5, { p2Firing: true });
  assert.ok(hp("host") < 85, `host should have taken damage, got ${hp("host")}`);
  run(1, { hostFiring: true });
  assert.ok(hp("host") > 99, `host should have healed back, got ${hp("host")}`);
});

test("starting health comes from the match settings", () => {
  const { g, duel, run, hp } = setup();
  g.onRestart({ startingHealth: 300, respawnDelay: 2 }, 0);
  duel();
  run(3, { hostFiring: true });
  assert.ok(hp("p2") > 150, `300hp should survive 3s of beam, got ${hp("p2")}`);
  g.addMember("p3", 0);
  assert.equal(hp("p3"), 300);
});

test("nothing happens after the match ends, until a restart", () => {
  const { g, duel, run, hp } = setup();
  duel();
  g.onEnd();
  run(2, { hostFiring: true });
  assert.equal(hp("p2"), 100);
  g.onRestart({ startingHealth: 100, respawnDelay: 2 }, 0);
  run(1, { hostFiring: true });
  assert.ok(hp("p2") < 100);
});

test("a restart brings the dead back with full health", () => {
  const { g, duel, run, hp } = setup();
  duel();
  run(3, { hostFiring: true });
  assert.equal(hp("p2"), 0);
  g.onRestart({ startingHealth: 100, respawnDelay: 2 }, 0);
  assert.equal(hp("p2"), 100);
  assert.equal(g.actors.get("p2").alive, true);
});

// ============================================================== movement rules

test("ordinary running is fine", () => {
  const { put, clock } = setup();
  put("host", -10, 0);
  for (let i = 1; i <= 20; i++) {
    clock.now += 50;
    const r = put("host", -10 + i * 0.8, 0); // 16 m/s, the top running speed
    assert.equal(r.correct, null);
    assert.ok(Math.abs(r.x - (-10 + i * 0.8)) < 1e-9);
  }
});

test("speed hacking gets the player snapped back, and held to the top honest speed", () => {
  const { put, clock, rejects } = setup();
  put("host", -10, 0);
  let corrected = null;
  let last;
  for (let i = 1; i <= 12; i++) {
    clock.now += 50;
    last = put("host", -10 + i * 5, 0); // 100 m/s, 60m in 0.6s
    corrected = corrected || last.correct;
  }
  assert.ok(corrected, "should have been corrected");
  assert.equal(corrected.tp, 1);
  // however hard they push, the server's version of them can't have gone further than
  // the saved-up allowance (18m) plus 21 m/s for the 0.6s that passed
  assert.ok(last.x - -10 <= 18 + 21 * 0.6 + 0.01, `server position must not follow the cheat (moved ${(last.x + 10).toFixed(1)}m)`);
  assert.ok(rejects.includes("move:speed"));
});

test("snapping a cheater back doesn't hand them a fresh allowance", () => {
  const { g, put, clock } = setup();
  put("host", -10, 0);
  let tp = 0;
  let dir = 1;
  let travelled = 0;
  for (let i = 0; i < 100; i++) { // 5 seconds of "running" at 100 m/s, back and forth, obeying each snap-back
    clock.now += 50;
    const before = g.actors.get("host").pos.x;
    let claimed = before + dir * 5;
    if (claimed > 14 || claimed < -14) { dir = -dir; claimed = before + dir * 5; }
    const r = put("host", claimed, 0, 0, { tp });
    if (r.correct) tp = r.correct.tp;
    travelled += Math.abs(g.actors.get("host").pos.x - before);
  }
  assert.ok(travelled <= 18 + 21 * 5 + 0.5, `travelled ${travelled.toFixed(1)}m in 5s`);
  assert.ok(travelled > 21 * 4, `the allowance should still let them move at the legal top speed (got ${travelled.toFixed(1)}m)`);
});

test("teleporting across the map is refused", () => {
  const { put, clock } = setup();
  put("host", -10, 0);
  clock.now += 50;
  const r = put("host", 14, 14); // ~34m away, more than any saved-up budget
  assert.ok(r.correct);
  assert.deepEqual([r.x, r.z], [-10, 0]);
});

test("positions outside the arena are refused", () => {
  const { put, clock, rejects } = setup();
  put("host", 0, 0);
  clock.now += 50;
  const r = put("host", 40, 0);
  assert.ok(r.correct);
  assert.ok(rejects.includes("move:bounds"));
});

test("an honest jump is accepted", () => {
  const { put, clock } = setup();
  put("host", 0, 0);
  for (let t = 0.05; t < 0.68; t += 0.05) {
    clock.now += 50;
    const y = Y + 12 * t - 17.5 * t * t;
    assert.equal(put("host", 0, 0, 0, { y }).correct, null, `at t=${t.toFixed(2)}`);
  }
  clock.now += 50;
  assert.equal(put("host", 0, 0, 0, { y: Y }).correct, null);
});

test("flying upward past a jump's height is refused", () => {
  const { put, clock, rejects } = setup();
  put("host", 0, 0);
  clock.now += 50;
  const r = put("host", 0, 0, 0, { y: Y + 6 });
  assert.ok(r.correct);
  assert.ok(rejects.includes("move:height"));
});

test("hovering in mid-air for too long is refused", () => {
  const { put, clock, rejects } = setup();
  put("host", 0, 0);
  let corrected = false;
  for (let i = 0; i < 60; i++) {
    clock.now += 50;
    if (put("host", 0, 0, 0, { y: Y + 1.5 }).correct) corrected = true;
  }
  assert.ok(corrected);
  assert.ok(rejects.includes("move:airtime"));
});

test("walking into a wall, or through it, is refused", () => {
  const { put, clock, rejects } = setup({ arena: PILLAR_ARENA });
  put("host", -4, 0);
  clock.now += 50;
  assert.ok(put("host", 0, 0).correct, "inside the pillar");

  const second = setup({ arena: PILLAR_ARENA });
  second.put("host", -1.6, 0);
  second.clock.now += 50;
  const r = second.put("host", 1.6, 0); // both ends are in the open; the straight line is through the pillar
  assert.ok(r.correct, "through the pillar");
  assert.ok(second.rejects.includes("move:wall"));
  assert.ok(rejects.includes("move:wall"));
});

test("standing right next to a wall is fine", () => {
  const { put, clock } = setup({ arena: PILLAR_ARENA });
  put("host", -1.52, 0); // the client rests you 0.51 from the surface
  clock.now += 50;
  assert.equal(put("host", -1.52, 1).correct, null);
});

test("states sent before the player heard about a correction don't count", () => {
  const { put, clock } = setup();
  put("host", -10, 0);
  clock.now += 50;
  const first = put("host", 14, 14);
  assert.equal(first.correct.tp, 1);
  clock.now += 50;
  const stale = put("host", 14, 14, 0, { tp: 0 }); // still believes the cheat position
  assert.equal(stale.correct, null, "no second correction for a state that predates the first");
  assert.deepEqual([stale.x, stale.z], [-10, 0]);
  clock.now += 50;
  const ack = put("host", -10, 0.5, 0, { tp: 1 }); // heard it, now moving normally from the corrected spot
  assert.equal(ack.correct, null);
  assert.equal(ack.z, 0.5);
});

test("with enforcement off, movement problems are only counted", () => {
  const { put, clock, rejects } = setup({ enforce: false });
  put("host", -10, 0);
  clock.now += 50;
  const r = put("host", 14, 14);
  assert.equal(r.correct, null);
  assert.equal(r.x, 14);
  assert.ok(rejects.length > 0);
});

test("joining or restarting gives a short window to appear at a spawn point", () => {
  const { g, put, clock } = setup();
  put("host", -10, 0);
  g.onRestart({ startingHealth: 100, respawnDelay: 2 }, clock.now);
  clock.now += 50;
  assert.equal(put("host", 12, 0).correct, null); // spawned on the far side after the restart
  clock.now += 4000; // the window closes
  assert.ok(put("host", -12, 14).correct);
});

test("a rejected teleport leaves the target at its last server-accepted position", () => {
  const { put, clock, run, hp, g } = setup();
  put("host", -10, 0, FACE_PLUS_X);
  put("p2", 10, 0, FACE_MINUS_X);
  clock.now += 50;
  put("p2", 10, 25); // out of bounds: server rejects it and keeps the accepted position
  assert.equal(g.actors.get("p2").pos.z, 0);
  run(1, { hostFiring: true });
  assert.ok(hp("p2") < 80, `got ${hp("p2")}`);
});

test("a target that moves out of the beam is not hit at an old historical position", () => {
  const { put, run, hp } = setup();
  put("host", -10, 0, FACE_PLUS_X);
  put("p2", 10, 0, FACE_MINUS_X);
  put("p2", 10, 5); // accepted sidestep, outside the beam's path
  run(1, { hostFiring: true });
  assert.equal(hp("p2"), 100);
});

// ===================================================================== bots

const bot = (id, x, z, yaw, extra = {}) => ({ id, name: "Bot", x, y: Y, z, yaw, pitch: 0, hp: 100, firing: false, ...extra });

test("a player's beam on a bot is forwarded to the host as a hit", () => {
  const { g, put, clock, run } = setup();
  put("host", -10, 5, 0);
  put("p2", 10, 0, FACE_MINUS_X);
  g.onBots([bot("bot-1", -10, 0, FACE_PLUS_X)], clock.now);
  const events = run(1, { p2Firing: true, after: () => g.onBots([bot("bot-1", -10, 0, FACE_PLUS_X)], clock.now) });
  const hits = events.filter((e) => e.msg.t === "hit");
  assert.ok(hits.length > 20);
  assert.ok(hits.every((e) => e.to === "host" && e.msg.targetId === "bot-1" && e.msg.attackerId === "p2"));
  const total = hits.reduce((s, e) => s + e.msg.damage, 0);
  assert.ok(total > 35 && total < 45, `about 40 damage in a second, got ${total.toFixed(1)}`);
});

test("bots shooting a human: aim and line of sight are checked, damage is capped, and the server applies it", () => {
  const { g, put, clock, hp } = setup();
  put("host", -10, 5, 0);
  put("p2", 10, 0, FACE_MINUS_X);
  g.onBots([bot("bot-1", -10, 0, FACE_PLUS_X, { firing: true })], clock.now);
  const v = g.checkHit("host", true, { t: "hit", attackerId: "bot-1", targetId: "p2", damage: 0.4 }, clock.now);
  assert.deepEqual(v, { ok: true, damage: 0.4 });
  g.hurt("p2", "bot-1", v.damage, clock.now);
  assert.equal(hp("p2"), 99.6);

  // a burst far above what a bot can do is clamped
  let total = 0;
  for (let i = 0; i < 100; i++) {
    const r = g.checkHit("host", true, { t: "hit", attackerId: "bot-1", targetId: "p2", damage: 40 }, clock.now);
    if (r.ok) total += r.damage;
  }
  assert.ok(total <= 30.01, `got ${total}`);

  // pointing the wrong way
  clock.now += 500;
  g.onBots([bot("bot-1", -10, 0, FACE_MINUS_X, { firing: true })], clock.now);
  put("p2", 10, 0, FACE_MINUS_X);
  assert.equal(g.checkHit("host", true, { t: "hit", attackerId: "bot-1", targetId: "p2", damage: 0.4 }, clock.now).reason, "off-target");
});

test("only the host can speak for bots, and a bot can only be a shooter, never a target", () => {
  const { g, put, clock } = setup();
  put("host", -10, 0, FACE_PLUS_X);
  put("p2", 10, 0, FACE_MINUS_X);
  g.onBots([bot("bot-1", -10, 0, FACE_PLUS_X, { firing: true })], clock.now);
  const hit = { t: "hit", attackerId: "bot-1", targetId: "p2", damage: 0.4 };
  assert.equal(g.checkHit("p2", false, hit, clock.now).reason, "bad-attacker");
  assert.equal(g.checkHit("host", true, { ...hit, targetId: "bot-1", attackerId: "host" }, clock.now).reason, "bad-target");
  assert.equal(g.checkHit("host", true, { ...hit, targetId: "nobody" }, clock.now).reason, "unknown-target");
  assert.equal(g.checkHit("host", true, { ...hit, attackerId: "bot-9" }, clock.now).reason, "unknown-attacker");
});

test("a bot killing the host, or anyone, kills them through the server", () => {
  const { g, put, clock } = setup();
  put("host", -10, 0, FACE_PLUS_X);
  put("p2", 10, 0, FACE_MINUS_X);
  g.onBots([bot("bot-1", 10, 5, FACE_MINUS_X)], clock.now);
  g.hurt("host", "bot-1", 150, clock.now);
  const events = g.drain();
  assert.deepEqual(events.filter((e) => e.msg.t === "kill").map((e) => e.msg), [{ t: "kill", attackerId: "bot-1", victimId: "host" }]);
});

test("bot deaths: the host announces them, once per life; players get credit only if seen shooting", () => {
  const { g, put, clock } = setup();
  put("host", -10, 5, 0);
  put("p2", 10, 0, FACE_MINUS_X, { firing: true });
  g.onBots([bot("bot-1", 0, 0, 0)], clock.now);
  const k = { t: "kill", attackerId: "host", victimId: "bot-1" };
  assert.equal(g.checkKill("host", true, k, clock.now).ok, true);
  assert.equal(g.checkKill("host", true, k, clock.now).reason, "bot-not-alive");

  clock.now += 3000;
  g.onBots([bot("bot-1", 0, 0, 0, { hp: 0 })], clock.now);
  g.onBots([bot("bot-1", 0, 0, 0)], clock.now + 50);
  clock.now += 50;
  const forged = { t: "kill", attackerId: "p2", victimId: "bot-1" };
  assert.equal(g.checkKill("host", true, forged, clock.now).reason, "no-credit"); // p2 never touched it

  g.onBots([bot("bot-1", -10, 0, FACE_PLUS_X)], clock.now); // now p2 shoots it for real
  g.lastTickAt = clock.now;
  clock.now += 33;
  put("p2", 10, 0, FACE_MINUS_X, { firing: true });
  put("host", -10, 5, 0);
  const events = g.tick(clock.now);
  assert.ok(events.some((e) => e.msg.t === "hit" && e.msg.targetId === "bot-1"));
  assert.equal(g.checkKill("host", true, forged, clock.now).ok, true);
});

test("players can't announce deaths — theirs or anyone's", () => {
  const { g, put, clock } = setup();
  put("host", -10, 0, FACE_PLUS_X);
  put("p2", 10, 0, FACE_MINUS_X);
  assert.equal(g.checkKill("p2", false, { t: "kill", attackerId: "host", victimId: "p2" }, clock.now).reason, "server-decides");
  assert.equal(g.checkKill("host", true, { t: "kill", attackerId: "host", victimId: "p2" }, clock.now).reason, "server-decides");
});

// ================================================================== arenas

test("real arenas load, with walls the movement rules know about", () => {
  for (const arenaId of ["classic", "foundry", "ruins", "neon", "mansion"]) {
    const g = new RoomGuard({ arenaId, hostId: "host" });
    assert.ok(g.geo.solids.length >= 4, arenaId);
    assert.ok(g.geo.arena.spawns.length >= 2, arenaId);
    // every spawn point has to be a legal place to stand
    g.geo.arena.spawns.forEach((sp, i) => {
      g.addMember("a" + i, 0); // a fresh player each time: their first state is accepted where they stand
      const r = g.onState("a" + i, { x: sp.x, y: sp.y, z: sp.z, yaw: 0, pitch: 0, hp: 100, firing: false, tp: 0 }, 5000);
      assert.equal(r.correct, null, `${arenaId} spawn ${JSON.stringify(sp)}`);
      // ...and standing there must also stay legal a moment later (not inside a wall, not "floating")
      const again = g.onState("a" + i, { x: sp.x, y: sp.y, z: sp.z, yaw: 1, pitch: 0, hp: 100, firing: false, tp: 0 }, 9000);
      assert.equal(again.correct, null, `${arenaId} spawn ${JSON.stringify(sp)} (standing)`);
    });
  }
});
