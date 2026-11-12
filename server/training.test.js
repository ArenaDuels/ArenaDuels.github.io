import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../vendor/three/three.module.min.js";
import { TrainingSession, DRILLS, DRILL_IDS, LEVELS, LEVEL_IDS, bestKey, loadBests, saveBest, yawToward, nearConsole, CONSOLE } from "../js/training.js";
import { ARENAS, ARENA_LIST } from "../js/arenas.js";

// A stand-in for RemotePlayer that records what the drill does to it.
function fakeRobot() {
  return {
    mesh: { position: new THREE.Vector3(), rotation: { y: 0 }, updateMatrixWorld() {} },
    targetPos: new THREE.Vector3(),
    targetYaw: 0,
    hp: 100,
    bodyMat: { emissive: new THREE.Color(0x101010), emissiveIntensity: 0.2 },
    visible: true,
    setVisible(v) { this.visible = v; },
    update() {},
    dispose() { this.disposed = true; },
  };
}
const player = { pos: new THREE.Vector3(-10, 1.1, 0), yaw: -Math.PI / 2 };
const resetPlayer = () => { player.pos.set(-10, 1.1, 0); player.yaw = -Math.PI / 2; };
// A camera where the player's eyes are, looking the way the player looks (pitch up is positive).
function makeCamera(pitch = 0) {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
  cam.position.set(player.pos.x, player.pos.y + 1, player.pos.z);
  cam.rotation.set(pitch, player.yaw, 0, "YXZ");
  cam.updateMatrixWorld(true);
  return cam;
}
const onScreen = (cam, pos) => {
  const p = new THREE.Vector3(pos.x, pos.y, pos.z).project(cam);
  return p.z < 1 && Math.abs(p.x) <= 0.85 && Math.abs(p.y) <= 0.85;
};

// Plays a whole drill at 60fps. `beam(session)` returns the mesh the beam hits (or null) each frame.
function play(drillId, beam, { firing = true, level } = {}) {
  resetPlayer();
  let result = null;
  const session = new TrainingSession({ camera: makeCamera(), makeTarget: fakeRobot, onFinish: (r) => (result = r) });
  session.start(drillId, player, level);
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 80 && !result; i++) {
    session.update(dt, player);
    session.afterBeam(dt, firing, beam(session), player);
  }
  return { session, result };
}
const firstAlive = (s) => s.targets.find((t) => t.alive)?.rp.mesh ?? null;

test("all three drills last 60 seconds", () => {
  for (const d of Object.values(DRILLS)) assert.equal(d.seconds, 60);
});

test("every drill has a name, a length and a score format", () => {
  assert.deepEqual(DRILL_IDS.sort(), ["cqc", "flick", "tracking"]);
  for (const d of Object.values(DRILLS)) {
    assert.ok(d.name && d.seconds > 0 && d.blurb && d.unit);
    assert.equal(typeof d.format(12.34), "string");
  }
});

test("a robot facing rule matches how players spawn facing the middle", () => {
  assert.ok(Math.abs(yawToward(-12, 0, 0, 0) - -Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(yawToward(0, 12, 0, 0) - 0) < 1e-9);
});

test("tracking: no beam scores 0s, a beam that never leaves the target scores most of the 60s with ~100% accuracy", () => {
  assert.equal(play("tracking", () => null, { firing: false }).result.score, 0);
  const full = play("tracking", firstAlive).result;
  assert.ok(full.score > 44 && full.score <= 60, `got ${full.score}`); // the target is down for a moment after each takedown
  assert.match(full.lines[0], /^Accuracy: (9\d|100)%/);
  assert.match(full.lines[1], /^Takedowns: [1-9]\d*$/);
  assert.equal(full.drillId, "tracking");
});

test("tracking and cqc targets can run as fast as a player (16) but never faster", () => {
  for (const drill of ["tracking", "cqc"]) {
    let top = 0;
    play(drill, (sess) => {
      const t = sess.targets[0];
      if (t) top = Math.max(top, Math.hypot(t.vel.x, t.vel.z));
      return null;
    }, { firing: false });
    assert.ok(top > 13, `${drill}: topped out at only ${top.toFixed(1)}`);
    assert.ok(top <= 16.001, `${drill}: ran at ${top.toFixed(1)}, faster than a player`);
  }
});

// Runs fn with a repeatable Math.random, so the "how often / how fast" checks can't flake.
function seeded(seed, fn) {
  const real = Math.random;
  let x = seed >>> 0;
  Math.random = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  try { return fn(); } finally { Math.random = real; }
}

test("the cqc bot sometimes A-D spams, slowly: now and then a few left-right flips, never frantic", () => {
  seeded(7, () => {
    let time = 0, lastFlip = null, prevTimer = 0, flips = 0, fastest = Infinity, spamFrames = 0, frames = 0;
    play("cqc", (sess) => {
      time += 1 / 60;
      const t = sess.targets[0];
      if (t && t.alive) {
        frames++;
        if (t.spamLeft > 0) spamFrames++;
        if (t.spamTimer > prevTimer + 0.1) { // the spam timer was just reset: that is one spam flip
          flips++;
          if (lastFlip !== null && time - lastFlip < 1) fastest = Math.min(fastest, time - lastFlip);
          lastFlip = time;
        }
        prevTimer = t.spamTimer;
      }
      return null;
    }, { firing: false });
    assert.ok(flips >= 6, `only ${flips} spam flips`);
    assert.ok(fastest >= 0.25, `flipped after only ${fastest.toFixed(2)}s`);
    assert.ok(spamFrames / frames < 0.25, `spamming ${Math.round((100 * spamFrames) / frames)}% of the time`);
  });
});

test("the tracking target spams slowly too, and only now and then", () => {
  seeded(11, () => {
    let spamFrames = 0, frames = 0, bursts = 0, was = false;
    play("tracking", (sess) => {
      const t = sess.targets[0];
      if (t) {
        frames++;
        if (t.spamLeft > 0) { spamFrames++; if (!was) bursts++; }
        was = t.spamLeft > 0;
      }
      return null;
    }, { firing: false });
    assert.ok(bursts >= 1, "it spams at least once in a drill");
    assert.ok(spamFrames / frames < 0.25, `spamming ${Math.round((100 * spamFrames) / frames)}% of the time`);
  });
});

test("tracking: the target wanders and jumps but never leaves the room or stands in the player", () => {
  let jumped = false;
  const { session } = play("tracking", (s) => {
    const t = s.targets[0];
    if (t) {
      assert.ok(Math.abs(t.pos.x) <= 13.0001 && Math.abs(t.pos.z) <= 13.0001, "stayed inside");
      assert.ok(Math.hypot(t.pos.x - player.pos.x, t.pos.z - player.pos.z) >= 3.0, "kept off the player");
      if (t.pos.y > 1.5) jumped = true;
    }
    return null;
  }, { firing: false });
  assert.ok(session.finished);
  assert.ok(jumped, "it jumps now and then");
});

test("flick: tapping each target pops it and the next appears well away from where you look", () => {
  const seen = [];
  const { result } = play("flick", (s) => {
    const t = s.targets[0];
    if (t && !seen.includes(t.bornAt)) {
      seen.push(t.bornAt);
      const dx = t.pos.x - player.pos.x, dz = t.pos.z - player.pos.z;
      const dist = Math.hypot(dx, dz);
      assert.ok(Math.abs(t.pos.x) <= 13.0001 && Math.abs(t.pos.z) <= 13.0001);
      assert.ok(dist >= 2, "not on top of the player");
    }
    return firstAlive(s);
  });
  assert.ok(result.score >= 100 && result.score <= 280, `popped ${result.score}`);
  assert.deepEqual(result.lines, [], "flick shows just the score");
});

test("flick: every target appears somewhere you can see, off to one side of the crosshair", () => {
  resetPlayer();
  const cam = makeCamera();
  const session = new TrainingSession({ camera: cam, makeTarget: fakeRobot });
  session.start("flick", player);
  for (let i = 0; i < 200; i++) session.update(1 / 60, player); // countdown over, first target placed
  const t = session.targets[0];
  let sides = new Set();
  for (let i = 0; i < 200; i++) {
    assert.ok(t.alive, "visible");
    assert.ok(onScreen(cam, t.pos), `spawned off screen at ${t.pos.x.toFixed(1)}, ${t.pos.z.toFixed(1)}`);
    const p = t.pos.clone().project(cam);
    assert.ok(Math.abs(p.x) > 0.02, "not dead centre");
    sides.add(Math.sign(p.x));
    session.afterBeam(1 / 60, true, t.rp.mesh, player); // pop it
    for (let k = 0; k < 20 && session.score === i; k++) session.afterBeam(1 / 60, true, t.rp.mesh, player);
  }
  assert.equal(sides.size, 2, "both sides get used");
});

test("flick: looking at the ceiling there is nowhere to show a target, so it waits until there is", () => {
  resetPlayer();
  let cam = makeCamera(1.35); // looking nearly straight up
  const session = new TrainingSession({ camera: cam, makeTarget: fakeRobot });
  session.start("flick", player);
  for (let i = 0; i < 200; i++) session.update(1 / 60, player);
  assert.equal(session.targets[0].alive, false, "nothing appears while you look at the ceiling");
  session.camera.rotation.set(0, player.yaw, 0, "YXZ"); // look back down at the room
  session.update(1 / 60, player);
  assert.equal(session.targets[0].alive, true);
  assert.ok(onScreen(session.camera, session.targets[0].pos));
});

test("flick: shooting nothing pops nothing", () => {
  const { result } = play("flick", () => null, { firing: false });
  assert.equal(result.score, 0);
  assert.deepEqual(result.lines, []);
});

test("cqc: the bot stays close, strafes both ways, jumps, and never leaves the room", () => {
  let minD = Infinity, maxD = 0, maxY = 0, samples = 0, flips = 0, lastSide = 0, prev = null;
  const { session } = play("cqc", (s) => {
    const t = s.targets[0];
    if (t && t.alive) {
      const d = Math.hypot(t.pos.x - player.pos.x, t.pos.z - player.pos.z);
      minD = Math.min(minD, d); maxD = Math.max(maxD, d); maxY = Math.max(maxY, t.pos.y);
      samples++;
      assert.ok(Math.abs(t.pos.x) <= 13.0001 && Math.abs(t.pos.z) <= 13.0001);
      if (prev) { // which way is it going around us?
        const side = Math.sign((prev.x - player.pos.x) * (t.pos.z - prev.z) - (prev.z - player.pos.z) * (t.pos.x - prev.x));
        if (side && lastSide && side !== lastSide) flips++;
        if (side) lastSide = side;
      }
      prev = t.pos.clone();
    }
    return null;
  }, { firing: false });
  assert.ok(session.finished && samples > 600);
  assert.ok(minD >= 1.0, `got as close as ${minD}`); // robots are 1 wide, so under 1 would be overlapping
  assert.ok(maxD < 12, `strayed to ${maxD}`);
  assert.ok(maxY > 2, "it jumps");
  assert.ok(flips > 10, `only changed strafe direction ${flips} times`);
});

test("cqc: when you rush it, it backs up instead of letting you stand in it", () => {
  let backed = 0, minD = Infinity;
  play("cqc", (s) => {
    const t = s.targets[0];
    if (t && t.alive) {
      // the player charges at the bot at 9 units a second
      const dx = t.pos.x - player.pos.x, dz = t.pos.z - player.pos.z, d = Math.hypot(dx, dz) || 1;
      player.pos.x = Math.max(-13, Math.min(13, player.pos.x + (dx / d) * 9 / 60));
      player.pos.z = Math.max(-13, Math.min(13, player.pos.z + (dz / d) * 9 / 60));
      minD = Math.min(minD, d);
      if (t.retreat > 0) backed++;
    }
    return null;
  }, { firing: false });
  assert.ok(backed > 30, `backed up on only ${backed} frames`);
  assert.ok(minD >= 1.0, `let the player get to ${minD}`);
});

test("cqc: beam time on the bot takes it down and a new one arrives; accuracy is reported", () => {
  const { result } = play("cqc", firstAlive);
  assert.ok(result.score >= 5, `only ${result.score} takedowns`);
  assert.match(result.lines[0], /^Accuracy: \d+%/);
});

test("pausing the loop (no updates) does not use up drill time, and a retry starts clean", () => {
  resetPlayer();
  const session = new TrainingSession({ camera: makeCamera(), makeTarget: fakeRobot });
  session.start("tracking", player);
  assert.equal(session.phase, "ready");
  for (let i = 0; i < 200; i++) session.update(1 / 60, player);
  assert.equal(session.phase, "run");
  session.afterBeam(1 / 60, true, firstAlive(session), player);
  session.start("tracking", player);
  assert.equal(session.phase, "ready");
  assert.equal(session.onTargetTime, 0);
  assert.equal(session.targets.length, 0, "old targets removed");
});

test("personal bests are kept per drill and per speed level, saved only when beaten, and junk in storage is ignored", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(bestKey("flick", "easy"), "flick", "flick has no speed levels");
  assert.equal(bestKey("tracking", "easy"), "tracking.easy");
  assert.equal(bestKey("cqc", "nonsense"), "cqc.hard");
  assert.equal(saveBest("flick", 20), true);
  assert.equal(saveBest("flick", 20), false);
  assert.equal(saveBest("flick", 15), false);
  assert.equal(saveBest("flick", 25), true);
  assert.equal(saveBest("tracking.easy", 30), true);
  assert.equal(saveBest("tracking.hard", 12), true, "each level has its own best");
  assert.equal(saveBest("tracking", 99), false, "a levelled drill needs a level");
  assert.equal(saveBest("nope", 99), false);
  assert.equal(saveBest("cqc.hard", 0), false);
  assert.deepEqual(loadBests(), { flick: 25, "tracking.easy": 30, "tracking.hard": 12 });
  store.set("arenaduels.training.bests.v3", JSON.stringify({ flick: "lots", "cqc.hard": -3, "tracking.medium": 61.5, bogus: 5 }));
  assert.deepEqual(loadBests(), { "tracking.medium": 61.5 });
  store.set("arenaduels.training.bests.v3", "{not json");
  assert.deepEqual(loadBests(), {});
  delete globalThis.localStorage;
});

test("the console pops its list up near it and not across the room", () => {
  assert.ok(nearConsole(CONSOLE.x, CONSOLE.z + 4));
  assert.ok(!nearConsole(0, 6), "the spawn point is far from it");
});

test("the Training Room is a real arena but is kept out of the arena pickers", () => {
  const room = ARENAS.training;
  assert.ok(room && room.modern && room.spawns.length >= 1);
  assert.ok(!ARENA_LIST.some((a) => a.id === "training"));
  const spawn = room.spawns[0];
  assert.ok(nearConsole(spawn.x, spawn.z) === false, "you arrive away from the console");
  assert.ok(Math.abs(spawn.yaw) < 1e-9, "and face north, toward it");
});

test("coming back from a drill puts you close enough to the console that its list is already up", () => {
  assert.ok(nearConsole(0, -9));
});

test("speed levels cap how fast the moving targets go: easy 8, medium 12, hard 16", () => {
  assert.deepEqual(LEVEL_IDS, ["easy", "medium", "hard"]);
  for (const drill of ["tracking", "cqc"]) {
    for (const level of LEVEL_IDS) {
      let top = 0;
      play(drill, (sess) => {
        const t = sess.targets[0];
        if (t) top = Math.max(top, Math.hypot(t.vel.x, t.vel.z));
        return null;
      }, { firing: false, level });
      const cap = LEVELS[level].maxSpeed;
      assert.ok(top <= cap + 0.001, `${drill} ${level}: ran at ${top.toFixed(1)}, over ${cap}`);
      assert.ok(top > cap * 0.7, `${drill} ${level}: only reached ${top.toFixed(1)} of ${cap}`);
    }
  }
});

test("the tracking target strafes across your view: sideways to the line between you, not toward or away", () => {
  seeded(3, () => {
    let sideways = 0, along = 0;
    play("tracking", (sess) => {
      const t = sess.targets[0];
      if (t && t.alive) {
        const dx = player.pos.x - t.pos.x, dz = player.pos.z - t.pos.z, d = Math.hypot(dx, dz) || 1;
        const radial = (t.vel.x * dx + t.vel.z * dz) / d;           // toward/away from you
        const lateral = (-t.vel.x * dz + t.vel.z * dx) / d;        // across your view
        sideways += Math.abs(lateral);
        along += Math.abs(radial);
      }
      return null;
    }, { firing: false });
    assert.ok(sideways > along * 2.5, `sideways ${sideways.toFixed(0)} vs toward/away ${along.toFixed(0)}`);
  });
});

test("tracking: holding the beam on the target takes it down, and another appears in view", () => {
  resetPlayer();
  const cam = makeCamera();
  const session = new TrainingSession({ camera: cam, makeTarget: fakeRobot });
  session.start("tracking", player);
  for (let i = 0; i < 200; i++) session.update(1 / 60, player);
  const t = session.targets[0];
  assert.ok(t.alive && onScreen(cam, t.pos), "first target is in view");
  let frames = 0;
  while (session.score === 0 && frames++ < 600) {
    session.update(1 / 60, player);
    session.afterBeam(1 / 60, true, t.alive ? t.rp.mesh : null, player);
  }
  assert.equal(session.score, 1);
  assert.ok(frames > 120 && frames < 200, `took ${frames} frames (about 2.5s of beam)`);
  assert.equal(t.alive, false, "down");
  for (let i = 0; i < 40; i++) session.update(1 / 60, player);
  assert.ok(t.alive && onScreen(cam, t.pos) && t.hp === 100, "back with full health, in view");
});

test("the beam lighting up a target is reported, and the glow is put back afterwards", () => {
  resetPlayer();
  const session = new TrainingSession({ camera: makeCamera(), makeTarget: fakeRobot });
  session.start("tracking", player);
  for (let i = 0; i < 200; i++) session.update(1 / 60, player);
  const t = session.targets[0];
  const mat = t.rp.bodyMat;
  const before = mat.emissive.getHex();
  session.afterBeam(1 / 60, true, t.rp.mesh, player);
  assert.equal(session.onTarget, true);
  assert.equal(mat.emissive.getHex(), 0xff2a2a);
  session.afterBeam(1 / 60, true, null, player);
  assert.equal(session.onTarget, false);
  assert.equal(mat.emissive.getHex(), before);
  assert.equal(mat.emissiveIntensity, 0.2);
});

test("the results name the speed level for tracking and cqc, and file the score under that level", () => {
  const r = play("tracking", () => null, { firing: false, level: "easy" }).result;
  assert.equal(r.name, "Tracking \u00b7 Easy");
  assert.equal(r.bestKey, "tracking.easy");
  const f = play("flick", () => null, { firing: false }).result;
  assert.equal(f.name, "Flick");
  assert.equal(f.bestKey, "flick");
});
