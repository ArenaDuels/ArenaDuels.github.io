// Client netcode: snapshot interpolation of other players, and the smoothing of server corrections.
// Run with:  cd server && npm test
import test from "node:test";
import assert from "node:assert/strict";

// player.js draws on canvases when it builds a player; give it harmless fakes.
const ctx = new Proxy(function () {}, {
  get: (t, k) => {
    if (k === "createRadialGradient" || k === "createLinearGradient") return () => ({ addColorStop() {} });
    if (k === "measureText") return () => ({ width: 10 });
    return typeof k === "string" ? ctx : undefined;
  },
  apply: () => ctx,
  set: () => true,
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };

const THREE = await import("../vendor/three/three.module.min.js");
const { RemotePlayer, PlayerController, NET } = await import("../js/player.js");
const { TUNING } = await import("./anticheat.js");

// a clock we control
let fakeNow = 1000;
const realNow = performance.now.bind(performance);
performance.now = () => fakeNow;
test.after(() => { performance.now = realNow; });

const state = (x, z, extra = {}) => ({ x, y: 1.4, z, yaw: 0, pitch: 0, hp: 100, firing: false, ...extra });
const freshPlayer = () => new RemotePlayer(new THREE.Scene(), 0xff4444, "P");

test("the client's interpolation delay matches the server's lag compensation", () => {
  assert.equal(NET.INTERP_DELAY_MS, TUNING.INTERP_DELAY_MS);
});

test("a remote player moves smoothly between two snapshots, drawn INTERP_DELAY_MS behind", () => {
  const rp = freshPlayer();
  fakeNow = 1000; rp.applyNetState(state(0, 0));
  fakeNow = 1050; rp.applyNetState(state(5, 0));
  fakeNow = 1100; rp.applyNetState(state(10, 0));
  // 100 ms later we draw the world as it was at 1000+... : render time = now - delay
  fakeNow = 1000 + NET.INTERP_DELAY_MS + 25;   // render time 1025: halfway between the first two
  rp.update(0.016, null, null);
  assert.ok(Math.abs(rp.mesh.position.x - 2.5) < 1e-6, `x ${rp.mesh.position.x}`);
  fakeNow = 1000 + NET.INTERP_DELAY_MS + 75;   // render time 1075: halfway between the 2nd and 3rd
  rp.update(0.016, null, null);
  assert.ok(Math.abs(rp.mesh.position.x - 7.5) < 1e-6, `x ${rp.mesh.position.x}`);
});

test("when updates run late it carries on at the last speed for a moment, then holds still", () => {
  const rp = freshPlayer();
  fakeNow = 1000; rp.applyNetState(state(0, 0));
  fakeNow = 1050; rp.applyNetState(state(5, 0));      // 100 units/second
  fakeNow = 1050 + NET.INTERP_DELAY_MS + 50;           // 50 ms past the newest snapshot
  rp.update(0.016, null, null);
  assert.ok(Math.abs(rp.mesh.position.x - 10) < 1e-6, `extrapolated x ${rp.mesh.position.x}`);
  fakeNow = 1050 + NET.INTERP_DELAY_MS + 5000;         // a long gap: stop, don't fly off
  rp.update(0.016, null, null);
  const cap = 5 + (5 / 50) * NET.MAX_EXTRAPOLATE_MS;
  assert.ok(Math.abs(rp.mesh.position.x - cap) < 1e-6, `held at ${rp.mesh.position.x}`);
});

test("turning is blended the short way round", () => {
  const rp = freshPlayer();
  fakeNow = 1000; rp.applyNetState(state(0, 0, { yaw: 3.0 }));
  fakeNow = 1050; rp.applyNetState(state(0, 0, { yaw: -3.0 })); // really 0.283 rad further round, not 6 back
  fakeNow = 1025 + NET.INTERP_DELAY_MS;
  rp.update(0.016, null, null);
  const diff = Math.abs(Math.atan2(Math.sin(rp.mesh.rotation.y - Math.PI), Math.cos(rp.mesh.rotation.y - Math.PI)));
  assert.ok(diff < 0.2, `halfway should be near pi, got ${rp.mesh.rotation.y}`);
});

test("a respawn or teleport is not smoothed across the map", () => {
  const rp = freshPlayer();
  fakeNow = 1000; rp.applyNetState(state(0, 0));
  fakeNow = 1050; rp.applyNetState(state(30, 0));       // 30 m in 50 ms: not running
  assert.equal(rp.snaps.length, 1);
  assert.equal(rp.mesh.position.x, 30);
  fakeNow = 1050 + NET.INTERP_DELAY_MS;
  rp.update(0.016, null, null);
  assert.equal(rp.mesh.position.x, 30);
});

test("the beam shows from the snapshot that reported it, so it lines up with the drawn position", () => {
  const rp = freshPlayer();
  fakeNow = 1000; rp.applyNetState(state(0, 0, { firing: false }));
  fakeNow = 1050; rp.applyNetState(state(1, 0, { firing: true }));
  fakeNow = 1000 + NET.INTERP_DELAY_MS + 25;            // still before the firing snapshot
  rp.update(0.016, null, null);
  assert.equal(rp.shownFiring, false);
  fakeNow = 1050 + NET.INTERP_DELAY_MS + 1;             // now the firing snapshot is the one being shown
  rp.update(0.016, null, null);
  assert.equal(rp.shownFiring, true);
});

test("a player with no snapshots (a training dummy) still eases toward its target", () => {
  const rp = freshPlayer();
  rp.targetPos.set(10, 1.4, 0);
  for (let i = 0; i < 60; i++) rp.update(0.016, null, null);
  assert.ok(rp.mesh.position.x > 9.9, `x ${rp.mesh.position.x}`);
});

test("a small server correction eases the camera, a big one snaps", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const pc = new PlayerController(scene, camera);
  pc.spawn({ x: 0, y: 1.4, z: 0, yaw: 0 });
  pc.interpolateView(1, 0);
  pc.reconcileTo(1, 1.4, 0);                             // 1 m off
  assert.equal(pc.mesh.position.x, 1, "the real position is the server's straight away");
  pc.interpolateView(1, 0);
  assert.ok(Math.abs(pc.viewRoot.position.x - 0) < 1e-6, "but the camera starts where it was");
  for (let i = 0; i < 20; i++) pc.interpolateView(1, 0.016);
  assert.ok(Math.abs(pc.viewRoot.position.x - 1) < 0.01, `and eases there, now ${pc.viewRoot.position.x}`);
  pc.reconcileTo(20, 1.4, 0);                            // far away: just go
  pc.interpolateView(1, 0);
  assert.equal(pc.viewRoot.position.x, 20);
});
