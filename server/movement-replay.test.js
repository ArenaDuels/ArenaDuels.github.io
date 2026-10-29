// False-positive check for the movement rules: honest play must never be flagged.
//
// This runs a faithful port of the browser's movement code (js/player.js:
// friction, Quake-style acceleration, air limits, jumping, gravity, stepped wall
// collision) with random "players" — running, strafe-jumping, bunny-hopping,
// spinning the mouse, running into walls — on every real arena, sends their
// position to the server the way the game does (20 times a second, with network
// jitter and the occasional lag spike), and requires that the server never
// objects. If you change the movement numbers in js/player.js, update MOVE below
// and re-run `npm test`: failures here mean real players would be rubber-banded.
import test from "node:test";
import assert from "node:assert/strict";
import { RoomGuard } from "./anticheat.js";
import { getArena } from "./arenas.js";

const MOVE = { GROUND_ACCEL: 14, WISH_SPEED: 16, AIR_WISH_SPEED: 7.5, AIR_ACCEL: 3.0, AIR_LAUNCH_MULTIPLIER: 0.72, AIR_MAX_SPEED: 10.5, MAX_SPEED_SANITY: 45, FRICTION: 8, GRAVITY: 35, JUMP_VEL: 12, RADIUS: 0.5 };

// Small deterministic random numbers so a failure can be reproduced.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function arenaBoxes(arena) {
  const boxes = [];
  const add = (w, h, d, x, y, z) =>
    boxes.push({ min: { x: x - w / 2, y: y - h / 2, z: z - d / 2 }, max: { x: x + w / 2, y: y + h / 2, z: z + d / 2 } });
  for (const [w, h, d, x, y, z] of arena.walls) add(w, h, d, x, y, z);
  for (const p of arena.props ?? []) add(p.w, p.h, p.d, p.x, p.y, p.z);
  return boxes;
}

class Body {
  constructor(spawn) {
    this.p = { x: spawn.x, y: spawn.y, z: spawn.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = spawn.yaw || 0;
    this.onGround = false;
  }

  step(dt, boxes, keys, jumpPressed) {
    let wx = 0;
    let wz = 0;
    if (keys.W) wz -= 1;
    if (keys.S) wz += 1;
    if (keys.A) wx -= 1;
    if (keys.D) wx += 1;
    const has = wx * wx + wz * wz > 0.0001;
    let dx = 0;
    let dz = 0;
    if (has) {
      const len = Math.hypot(wx, wz);
      wx /= len;
      wz /= len;
      dx = wx * Math.cos(this.yaw) + wz * Math.sin(this.yaw);
      dz = -wx * Math.sin(this.yaw) + wz * Math.cos(this.yaw);
    }
    const v = this.vel;
    const accelerate = (wishSpeed, accel) => {
      const cur = v.x * dx + v.z * dz;
      const add = wishSpeed - cur;
      if (add <= 0) return;
      let a = accel * dt * wishSpeed;
      if (a > add) a = add;
      v.x += a * dx;
      v.z += a * dz;
    };
    if (this.onGround) {
      const speed = Math.hypot(v.x, v.z);
      if (speed >= 0.001) {
        const ns = Math.max(speed - speed * MOVE.FRICTION * dt, 0);
        v.x *= ns / speed;
        v.z *= ns / speed;
      }
      if (has) accelerate(MOVE.WISH_SPEED, MOVE.GROUND_ACCEL);
    } else if (has) {
      accelerate(MOVE.AIR_WISH_SPEED, MOVE.AIR_ACCEL);
    }
    if (!this.onGround) {
      const s = Math.hypot(v.x, v.z);
      if (s > MOVE.AIR_MAX_SPEED) {
        v.x *= MOVE.AIR_MAX_SPEED / s;
        v.z *= MOVE.AIR_MAX_SPEED / s;
      }
    }
    const spd = Math.hypot(v.x, v.z);
    if (spd > MOVE.MAX_SPEED_SANITY) {
      v.x *= MOVE.MAX_SPEED_SANITY / spd;
      v.z *= MOVE.MAX_SPEED_SANITY / spd;
    }
    if (this.onGround && jumpPressed) {
      v.x *= MOVE.AIR_LAUNCH_MULTIPLIER;
      v.z *= MOVE.AIR_LAUNCH_MULTIPLIER;
      v.y = MOVE.JUMP_VEL;
      this.onGround = false;
    }
    v.y -= MOVE.GRAVITY * dt;
    const moveDist = Math.hypot(v.x, v.y, v.z) * dt;
    const steps = Math.max(1, Math.ceil(moveDist / 0.2));
    const sub = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.p.x += v.x * sub;
      this.p.y += v.y * sub;
      this.p.z += v.z * sub;
      this.#collide(boxes);
    }
  }

  #collide(boxes) {
    const STEP = 0.5, MARGIN = MOVE.RADIUS * 0.6, REST = 1.4;
    const p = this.p;
    const feetLevel = p.y - REST;
    let top = 0;
    for (const b of boxes) {
      if (p.x > b.min.x - MARGIN && p.x < b.max.x + MARGIN && p.z > b.min.z - MARGIN && p.z < b.max.z + MARGIN) {
        if (b.max.y <= feetLevel + STEP && b.max.y > top) top = b.max.y;
      }
    }
    const restY = top + REST;
    if (p.y <= restY) {
      p.y = restY;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
    const push = MOVE.RADIUS + 0.01;
    for (let pass = 0; pass < 2; pass++) {
      const feet = p.y - REST;
      for (const b of boxes) {
        if (b.max.y <= feet + STEP) continue;
        const cx = Math.max(b.min.x, Math.min(p.x, b.max.x));
        const cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= push * push) continue;
        if (d2 < 1e-8) {
          const l = p.x - b.min.x, r = b.max.x - p.x, f = p.z - b.min.z, k = b.max.z - p.z;
          const m = Math.min(l, r, f, k);
          if (m === l) p.x = b.min.x - push;
          else if (m === r) p.x = b.max.x + push;
          else if (m === f) p.z = b.min.z - push;
          else p.z = b.max.z + push;
        } else {
          const d = Math.sqrt(d2);
          const amount = push - d;
          p.x += (dx / d) * amount;
          p.z += (dz / d) * amount;
        }
      }
    }
  }
}

function playSession({ arenaId, seed, seconds }) {
  const arena = getArena(arenaId);
  const boxes = arenaBoxes(arena);
  const rand = rng(seed);
  const rejects = [];
  const g = new RoomGuard({ arenaId, hostId: "h", onReject: (k) => rejects.push(k) });
  g.addMember("h", 0);
  const spawn = arena.spawns[seed % arena.spawns.length];
  const body = new Body(spawn);

  const DT = 1 / 60;
  let keys = {};
  let jumpHeld = false;
  let turn = 0;
  let nextChange = 0;
  let nextSend = 0;
  let lastArrival = 20_000;
  let corrections = 0;
  let sent = 0;
  let travelled = 0;
  let airTime = 0;
  let maxSpeed = 0;
  const pending = [];

  for (let t = 0; t < seconds; t += DT) {
    if (t >= nextChange) {
      // pick a new "plan" for the next stretch of play
      const plan = rand();
      keys = { W: plan < 0.7, S: plan > 0.93, A: rand() < 0.35, D: rand() < 0.35 };
      jumpHeld = rand() < 0.55;           // holding space = bunny-hopping
      turn = (rand() - 0.5) * (rand() < 0.4 ? 14 : 3); // rad/s: sometimes a wild spin
      nextChange = t + 0.2 + rand() * 1.4;
    }
    body.yaw += turn * DT;
    const before = { ...body.p };
    body.step(DT, boxes, keys, jumpHeld);
    travelled += Math.hypot(body.p.x - before.x, body.p.z - before.z);
    maxSpeed = Math.max(maxSpeed, Math.hypot(body.vel.x, body.vel.z));
    if (!body.onGround) airTime += DT;

    if (t >= nextSend) {
      nextSend += 0.05;
      // network: ~25ms jitter, plus an occasional 150-400ms hiccup where messages bunch up
      let delay = rand() * 0.05;
      if (rand() < 0.02) delay += 0.15 + rand() * 0.25;
      lastArrival = Math.max(lastArrival + 1, 20_000 + (t + delay) * 1000);
      pending.push({ at: lastArrival, s: { ...body.p } });
    }
  }
  for (const m of pending) {
    sent++;
    const r = g.onState("h", { x: m.s.x, y: m.s.y, z: m.s.z, yaw: 0, pitch: 0, hp: 100, firing: false, tp: 0 }, m.at);
    if (r.correct) corrections++;
  }
  return { rejects, corrections, sent, travelled, airTime, maxSpeed };
}

for (const arenaId of ["classic", "foundry", "ruins", "neon", "mansion", "glacier"]) {
  test(`honest play on ${arenaId} is never flagged`, () => {
    let totalSent = 0;
    let fastest = 0;
    const SEEDS = Number(process.env.REPLAY_SEEDS) || 12;
    const SECONDS = Number(process.env.REPLAY_SECONDS) || 90;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = playSession({ arenaId, seed, seconds: SECONDS });
      totalSent += r.sent;
      fastest = Math.max(fastest, r.maxSpeed);
      assert.deepEqual(r.rejects, [], `${arenaId} seed ${seed}: honest movement was flagged (${r.rejects.slice(0, 5)})`);
      assert.ok(r.travelled > 200, `${arenaId} seed ${seed}: the simulated player barely moved (${r.travelled.toFixed(0)}m)`);
    }
    assert.ok(totalSent > 20000);
    assert.ok(fastest < 22, `the physics should never exceed the speed the server allows (${fastest.toFixed(1)} m/s)`);
  });
}
