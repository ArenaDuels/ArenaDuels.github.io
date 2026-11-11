import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../vendor/three/three.module.min.js";
import { TrainingSession, DRILLS, DRILL_IDS, loadBests, saveBest, yawToward } from "../js/training.js";

// A stand-in for RemotePlayer that records what the drill does to it.
function fakeRobot() {
  return {
    mesh: { position: new THREE.Vector3(), rotation: { y: 0 }, updateMatrixWorld() {} },
    targetPos: new THREE.Vector3(),
    targetYaw: 0,
    hp: 100,
    visible: true,
    setVisible(v) { this.visible = v; },
    update() {},
    dispose() { this.disposed = true; },
  };
}
const player = { pos: new THREE.Vector3(-10, 1.1, 0), yaw: -Math.PI / 2 };
const resetPlayer = () => { player.pos.set(-10, 1.1, 0); player.yaw = -Math.PI / 2; };

// Plays a whole drill at 60fps. `beam(session)` returns the mesh the beam hits (or null) each frame.
function play(drillId, beam, { firing = true } = {}) {
  resetPlayer();
  let result = null;
  const session = new TrainingSession({ camera: {}, makeTarget: fakeRobot, onFinish: (r) => (result = r) });
  session.start(drillId, player);
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

test("tracking: no beam scores 0s, a beam that never leaves the target scores ~60s with ~100% accuracy", () => {
  assert.equal(play("tracking", () => null, { firing: false }).result.score, 0);
  const full = play("tracking", firstAlive).result;
  assert.ok(full.score > 54 && full.score <= 60, `got ${full.score}`);
  assert.match(full.lines[0], /^Accuracy: (9\d|100)%/);
  assert.equal(full.drillId, "tracking");
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
  const session = new TrainingSession({ camera: {}, makeTarget: fakeRobot });
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

test("personal bests are saved only when beaten, and junk in storage is ignored", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(saveBest("flick", 20), true);
  assert.equal(saveBest("flick", 20), false);
  assert.equal(saveBest("flick", 15), false);
  assert.equal(saveBest("flick", 25), true);
  assert.equal(saveBest("nope", 99), false);
  assert.equal(saveBest("cqc", 0), false);
  assert.deepEqual(loadBests(), { flick: 25 });
  store.set("arenaduels.training.bests.v2", JSON.stringify({ flick: "lots", cqc: -3, tracking: 61.5 }));
  assert.deepEqual(loadBests(), { tracking: 61.5 });
  store.set("arenaduels.training.bests.v2", "{not json");
  assert.deepEqual(loadBests(), {});
  delete globalThis.localStorage;
});
