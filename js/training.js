// Aim Training: three solo drills, 60 seconds each, played in the Classic Box (an empty 30x30 room).
//
//   Tracking  keep the beam on a target that wanders and jumps          score: seconds on target (+ accuracy)
//   Flick     targets pop up around you, one at a time; flick and fire  score: targets popped
//   CQC       a bot strafes, jumps, closes in and backs off around you  score: takedowns (+ accuracy)
//
// Nothing here touches the network. Targets are ordinary robots (RemotePlayer) that this file moves
// by hand, and main.js hands us each frame's beam result so we can score it. Nothing hurts the player.

import * as THREE from "../vendor/three/three.module.min.js";
import { CONSOLE_PLINTH } from "./arenas/training-room.js";

// Same numbers as MOVE in player.js, so the CQC bot jumps and falls like a real player.
const GRAVITY = 35;
const JUMP_VEL = 12;
const FLOOR_Y = 1.1;        // height of a capsule's centre when it stands on the floor
const BOUND = 13;           // targets stay this far from the middle (the room is 30 wide, walls at +-15)
const PLAYER_SPEED = 16;    // WISH_SPEED in player.js: how fast a player runs, so targets can move just as fast
const BEAM_DPS = 40;        // what a player's beam does per second
const TARGET_HP = 100;
const READY_SECONDS = 3;
const FLICK_POP_TIME = 0.22; // seconds of beam it takes to pop a flick target
const TARGET_COLOR = 0xff5a4f;
const VIEW_MARGIN = 0.85;   // a flick target must land inside this much of the screen (1 = the very edge)

export const DRILLS = {
  tracking: {
    id: "tracking",
    name: "Tracking",
    seconds: 60,
    blurb: "Hold the beam on a target that strafes, changes direction and jumps. Score is how many seconds you stay on it.",
    unit: "on target",
    format: (v) => `${v.toFixed(1)}s`,
  },
  flick: {
    id: "flick",
    name: "Flick",
    seconds: 60,
    blurb: "A target appears somewhere around you. Snap to it, tap it down, and the next one appears. Score is targets popped.",
    unit: "targets",
    format: (v) => `${Math.round(v)}`,
  },
  cqc: {
    id: "cqc",
    name: "Close Quarters",
    seconds: 60,
    blurb: "A bot stays right on top of you: it strafes, jumps and backs off when you close in. Score is takedowns.",
    unit: "takedowns",
    format: (v) => `${Math.round(v)}`,
  },
};
export const DRILL_IDS = Object.keys(DRILLS);

/* ---------- personal bests (kept in this browser only) ---------- */

const BEST_KEY = "arenaduels.training.bests.v2"; // v2: tracking is now scored in seconds, not percent

export function loadBests() {
  const out = {};
  try {
    const raw = JSON.parse(localStorage.getItem(BEST_KEY) || "{}");
    for (const id of DRILL_IDS) {
      const v = raw?.[id];
      if (Number.isFinite(v) && v >= 0 && v <= 100000) out[id] = v;
    }
  } catch { /* storage blocked or garbled: no bests */ }
  return out;
}

// True when `score` beats the saved best (and saves it).
export function saveBest(drillId, score) {
  if (!DRILLS[drillId] || !Number.isFinite(score) || score <= 0) return false;
  const bests = loadBests();
  if (bests[drillId] !== undefined && score <= bests[drillId]) return false;
  bests[drillId] = score;
  try { localStorage.setItem(BEST_KEY, JSON.stringify(bests)); } catch { /* ignore */ }
  return true;
}

/* ---------- helpers ---------- */

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Yaw that makes a robot at (fromX, fromZ) face (toX, toZ). Forward is (-sin yaw, -cos yaw), as in player.js.
export const yawToward = (fromX, fromZ, toX, toZ) => Math.atan2(-(toX - fromX), -(toZ - fromZ));

class Target {
  constructor(rp) {
    this.rp = rp;
    this.pos = new THREE.Vector3(0, FLOOR_Y, 0);
    this.vel = new THREE.Vector3();
    this.wish = new THREE.Vector3();
    this.vy = 0;
    this.onGround = true;
    this.hp = TARGET_HP;
    this.alive = true;
    this.timer = 0;       // generic countdown (next turn / next strafe flip / respawn)
    this.jumpTimer = 0;
    this.contact = 0;     // flick: beam time so far
    this.bornAt = 0;      // flick: when it appeared
    this.strafeDir = 1;
    this.strafeSpeed = 8;
    this.range = 4;
    this.rangeTimer = 0;
    this.retreat = 0;
  }
  show(v) {
    this.alive = v;
    this.rp.setVisible(v);
  }
  // Pushes our position onto the robot. The robot would otherwise glide toward it, which would
  // make the hitbox lag behind what the player is aiming at.
  place() {
    this.rp.mesh.position.copy(this.pos);
    this.rp.targetPos.copy(this.pos);
    this.rp.hp = this.hp;
    this.rp.mesh.updateMatrixWorld(true);
  }
  face(x, z) {
    const yaw = yawToward(this.pos.x, this.pos.z, x, z);
    this.rp.targetYaw = yaw;
    this.rp.mesh.rotation.y = yaw; // set both, or the robot would spin the long way round at +-pi
  }
  jump(power = 1) {
    if (!this.onGround) return;
    this.vy = JUMP_VEL * power;
    this.onGround = false;
  }
  fall(dt) {
    if (this.onGround) return;
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= FLOOR_Y) {
      this.pos.y = FLOOR_Y;
      this.vy = 0;
      this.onGround = true;
    }
  }
  dispose() {
    this.rp.dispose();
  }
}

/* ---------- the session ---------- */

export class TrainingSession {
  // makeTarget(color, name) -> a RemotePlayer (or anything shaped like one).
  // onHud(info) is called every frame; onFinish(result) once, when the drill ends.
  constructor({ camera, makeTarget, onHud = () => {}, onFinish = () => {} }) {
    this.camera = camera;
    this.makeTarget = makeTarget;
    this.onHud = onHud;
    this.onFinish = onFinish;
    this.targets = [];
    this.drillId = null;
    this.phase = "idle"; // idle | ready | run | done
    this.finished = false;
  }

  get drill() {
    return DRILLS[this.drillId];
  }

  start(drillId, player) {
    if (!DRILLS[drillId]) return;
    this.#clearTargets();
    this.drillId = drillId;
    this.phase = "ready";
    this.finished = false;
    this.readyLeft = READY_SECONDS;
    this.timeLeft = DRILLS[drillId].seconds;
    this.elapsed = 0;
    this.onTargetTime = 0;
    this.firingTime = 0;
    this.score = 0;           // pops (flick) or takedowns (cqc)
    this.popTimes = [];       // flick: ms from appearing to popping
    this.#emitHud();
  }

  // Back to "no drill running" (you are in the room, not in a drill).
  stop() {
    this.#clearTargets();
    this.phase = "idle";
    this.drillId = null;
    this.finished = false;
  }

  dispose() {
    this.stop();
  }

  // The meshes the beam should be tested against.
  hitMeshes() {
    return this.targets.filter((t) => t.alive).map((t) => t.rp.mesh);
  }
  ownsMesh(mesh) {
    return this.targets.some((t) => t.rp.mesh === mesh);
  }

  // Once a frame, before the beam is cast. `player` = { pos: THREE.Vector3 (capsule centre), yaw }.
  update(dt, player) {
    if (this.phase === "ready") {
      this.readyLeft -= dt;
      if (this.readyLeft <= 0) this.#beginRun(player);
    } else if (this.phase === "run") {
      this.elapsed += dt;
      this.timeLeft = Math.max(0, DRILLS[this.drillId].seconds - this.elapsed);
      for (const t of this.targets) {
        if (this.drillId === "tracking") this.#trackingStep(t, dt, player);
        else if (this.drillId === "flick") { if (!t.alive) this.#placeFlickTarget(t, player); }
        else this.#cqcStep(t, dt, player);
      }
    }
    for (const t of this.targets) {
      if (t.alive) t.place();
      t.rp.update(dt, this.camera, null);
    }
    this.#emitHud();
  }

  // Once a frame, after the beam is cast. `hitMesh` = the target mesh the beam reached first, or null.
  afterBeam(dt, firing, hitMesh, player) {
    if (this.phase !== "run") return;
    if (firing) this.firingTime += dt;
    const t = hitMesh ? this.targets.find((x) => x.alive && x.rp.mesh === hitMesh) : null;
    if (this.drillId === "flick") {
      // Time on a flick target builds up toward a pop; once the beam leaves, it drains away again,
      // so a quick sweep across a target doesn't count for long.
      for (const f of this.targets) {
        if (f !== t) f.contact = Math.max(0, f.contact - dt * 0.8);
        f.hp = TARGET_HP * Math.max(0, 1 - f.contact / FLICK_POP_TIME);
      }
    }
    if (t) {
      this.onTargetTime += dt;
      if (this.drillId === "flick") {
        t.contact += dt;
        t.hp = TARGET_HP * Math.max(0, 1 - t.contact / FLICK_POP_TIME);
        if (t.contact >= FLICK_POP_TIME) this.#pop(t, player);
      } else if (this.drillId === "cqc") {
        t.hp -= BEAM_DPS * dt;
        if (t.hp <= 0) this.#takedown(t);
      }
    }
    if (this.timeLeft <= 0) this.#finish();
  }

  /* ----- drills ----- */

  #beginRun(player) {
    this.phase = "run";
    if (this.drillId === "tracking") {
      const t = this.#addTarget("Target");
      t.pos.set(0, FLOOR_Y, 0);
      t.timer = 0;
    } else if (this.drillId === "flick") {
      const t = this.#addTarget("Target");
      this.#placeFlickTarget(t, player);
    } else {
      const t = this.#addTarget("Bot");
      this.#respawnCqc(t, player);
    }
  }

  #addTarget(name) {
    const t = new Target(this.makeTarget(TARGET_COLOR, name));
    this.targets.push(t);
    t.show(true);
    return t;
  }

  #trackingStep(t, dt, player) {
    t.timer -= dt;
    if (t.timer <= 0) {
      t.timer = rand(0.5, 1.5);
      const ang = rand(0, Math.PI * 2);
      const speed = rand(6, PLAYER_SPEED);
      t.wish.set(Math.cos(ang) * speed, 0, Math.sin(ang) * speed);
      if (Math.random() < 0.3) t.jump(0.85);
    }
    t.vel.lerp(t.wish, Math.min(1, dt * 6));
    this.#capSpeed(t);
    t.pos.x += t.vel.x * dt;
    t.pos.z += t.vel.z * dt;
    this.#keepInside(t);
    this.#keepOffPlayer(t, player, 3.5);
    t.fall(dt);
    t.face(player.pos.x, player.pos.z);
  }

  #pop(t, player) {
    this.score += 1;
    this.popTimes.push((this.elapsed - t.bornAt) * 1000);
    this.#placeFlickTarget(t, player);
  }

  // Somewhere you can see right now, off to one side of your crosshair so it is a real flick. If there is
  // no such spot (say you are looking at the ceiling), the target stays hidden and appears the moment
  // there is one: it never shows up out of your sight.
  #placeFlickTarget(t, player) {
    this.camera.updateMatrixWorld(true);
    const probe = new THREE.Vector3();
    for (let tries = 0; tries < 40; tries++) {
      const off = (Math.random() < 0.5 ? -1 : 1) * rand(0.1, 0.7); // radians to the side of straight ahead
      const dist = rand(4, 13);
      const yaw = player.yaw + off;
      const x = player.pos.x - Math.sin(yaw) * dist;
      const z = player.pos.z - Math.cos(yaw) * dist;
      if (Math.abs(x) > BOUND || Math.abs(z) > BOUND) continue;
      probe.set(x, FLOOR_Y, z).project(this.camera);
      if (probe.z >= 1 || Math.abs(probe.x) > VIEW_MARGIN || Math.abs(probe.y) > VIEW_MARGIN) continue;
      t.pos.set(x, FLOOR_Y, z);
      t.contact = 0;
      t.hp = TARGET_HP;
      t.bornAt = this.elapsed;
      t.face(player.pos.x, player.pos.z);
      t.show(true);
      return true;
    }
    t.show(false);
    return false;
  }

  // The close-quarters bot: orbits the player, hops, closes in and backs off.
  #cqcStep(t, dt, player) {
    if (!t.alive) {
      t.timer -= dt;
      if (t.timer <= 0) this.#respawnCqc(t, player);
      return;
    }
    let dx = player.pos.x - t.pos.x;
    let dz = player.pos.z - t.pos.z;
    let dist = Math.hypot(dx, dz) || 0.001;
    dx /= dist;
    dz /= dist;

    t.timer -= dt; // when to flip the strafe direction
    if (t.timer <= 0) {
      t.timer = rand(0.35, 1.3);
      t.strafeDir = Math.random() < 0.7 ? -t.strafeDir : t.strafeDir; // usually reverses, sometimes keeps going
      t.strafeSpeed = rand(9, PLAYER_SPEED);
    }
    t.rangeTimer -= dt; // how close it wants to stay
    if (t.rangeTimer <= 0) {
      t.rangeTimer = rand(1.2, 2.8);
      t.range = rand(2.8, 5.5);
    }
    t.jumpTimer -= dt;
    if (t.jumpTimer <= 0 && t.onGround) {
      t.jump(rand(0.8, 1));
      t.jumpTimer = rand(0.7, 2);
    }

    // Too close: back up for a moment (still facing you) instead of standing in your face.
    t.retreat = Math.max(0, t.retreat - dt);
    if (dist < 2.1 && t.retreat <= 0) t.retreat = rand(0.45, 0.9);

    let radial = clamp((dist - t.range) * 3, -PLAYER_SPEED, PLAYER_SPEED); // + = come closer
    if (t.retreat > 0) radial = -PLAYER_SPEED * 0.9;
    const tx = -dz * t.strafeDir; // sideways, around you
    const tz = dx * t.strafeDir;
    t.wish.set(dx * radial + tx * t.strafeSpeed, 0, dz * radial + tz * t.strafeSpeed);
    // Less steering in the air, like a real jump.
    t.vel.lerp(t.wish, Math.min(1, dt * (t.onGround ? 10 : 3)));
    this.#capSpeed(t);
    t.pos.x += t.vel.x * dt;
    t.pos.z += t.vel.z * dt;

    if (this.#keepInside(t)) t.strafeDir = -t.strafeDir; // hit a wall: turn around
    this.#keepOffPlayer(t, player, 1.3);
    t.fall(dt);
    t.face(player.pos.x, player.pos.z);
  }

  #takedown(t) {
    this.score += 1;
    t.show(false);
    t.timer = 0.6; // brief pause before the next one
  }

  #respawnCqc(t, player) {
    let x = 0, z = 0;
    for (let tries = 0; tries < 12; tries++) {
      const ang = rand(0, Math.PI * 2);
      const dist = rand(4, 6.5);
      x = player.pos.x + Math.cos(ang) * dist;
      z = player.pos.z + Math.sin(ang) * dist;
      if (Math.abs(x) <= BOUND && Math.abs(z) <= BOUND) break;
    }
    t.pos.set(clamp(x, -BOUND, BOUND), FLOOR_Y, clamp(z, -BOUND, BOUND));
    t.vel.set(0, 0, 0);
    t.vy = 0;
    t.onGround = true;
    t.hp = TARGET_HP;
    t.timer = rand(0.3, 0.8);
    t.jumpTimer = rand(0.5, 1.2);
    t.rangeTimer = 0;
    t.retreat = 0;
    t.show(true);
  }

  /* ----- shared bits ----- */

  // Nothing runs faster than a player does.
  #capSpeed(t) {
    const sp = Math.hypot(t.vel.x, t.vel.z);
    if (sp > PLAYER_SPEED) {
      t.vel.x *= PLAYER_SPEED / sp;
      t.vel.z *= PLAYER_SPEED / sp;
    }
  }

  // Keeps a target inside the room. True if it had to be pushed back.
  #keepInside(t) {
    let hit = false;
    for (const axis of ["x", "z"]) {
      if (t.pos[axis] > BOUND) { t.pos[axis] = BOUND; t.vel[axis] = -Math.abs(t.vel[axis]); t.wish[axis] = -Math.abs(t.wish[axis]); hit = true; }
      else if (t.pos[axis] < -BOUND) { t.pos[axis] = -BOUND; t.vel[axis] = Math.abs(t.vel[axis]); t.wish[axis] = Math.abs(t.wish[axis]); hit = true; }
    }
    return hit;
  }

  // Never stand inside the player.
  #keepOffPlayer(t, player, minDist) {
    const dx = t.pos.x - player.pos.x;
    const dz = t.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < minDist) {
      const nx = d > 0.001 ? dx / d : 1;
      const nz = d > 0.001 ? dz / d : 0;
      t.pos.x = clamp(player.pos.x + nx * minDist, -BOUND, BOUND);
      t.pos.z = clamp(player.pos.z + nz * minDist, -BOUND, BOUND);
      // Backed into a wall with the player right there: slide out sideways along it instead of sitting inside them.
      if (Math.hypot(t.pos.x - player.pos.x, t.pos.z - player.pos.z) < minDist * 0.9) {
        let best = null, bestD = -1;
        for (const sign of [1, -1]) {
          const x = clamp(player.pos.x + (-nz * sign) * minDist, -BOUND, BOUND);
          const z = clamp(player.pos.z + (nx * sign) * minDist, -BOUND, BOUND);
          const dd = Math.hypot(x - player.pos.x, z - player.pos.z);
          if (dd > bestD) { bestD = dd; best = { x, z }; }
        }
        t.pos.x = best.x;
        t.pos.z = best.z;
        t.strafeDir = -t.strafeDir;
      }
    }
  }

  #finish() {
    if (this.phase === "done") return;
    this.phase = "done";
    this.finished = true;
    const drill = this.drill;
    const total = drill.seconds;
    const onSec = Math.min(this.onTargetTime, total); // the last frame can run a hair past the end
    let score;
    const lines = [];
    if (this.drillId === "tracking") {
      score = Math.round(onSec * 10) / 10;
      lines.push(`Accuracy: ${Math.round((onSec / total) * 100)}% of the time on target`);
    } else if (this.drillId === "flick") {
      score = this.score; // flick shows just the score
    } else {
      score = this.score;
      const acc = this.firingTime > 0 ? Math.round((onSec / this.firingTime) * 100) : 0;
      lines.push(`Accuracy: ${acc}% of your beam time was on the bot`);
    }
    this.onFinish({ drillId: this.drillId, name: drill.name, score, scoreText: drill.format(score), unit: drill.unit, lines });
  }

  #emitHud() {
    const drill = this.drill;
    if (!drill) return;
    let big = "";
    if (this.phase === "ready") big = `Get ready ${Math.max(1, Math.ceil(this.readyLeft))}`;
    let scoreText = "";
    if (this.phase === "run" || this.phase === "done") {
      if (this.drillId === "tracking") {
        scoreText = `${Math.min(this.onTargetTime, DRILLS.tracking.seconds).toFixed(1)}s on target`;
      } else if (this.drillId === "flick") {
        scoreText = `${this.score} popped`;
      } else {
        scoreText = `${this.score} takedowns`;
      }
    }
    this.onHud({
      name: drill.name,
      timeText: String(Math.ceil(this.phase === "ready" ? drill.seconds : this.timeLeft)),
      scoreText,
      banner: big,
    });
  }

  #clearTargets() {
    for (const t of this.targets) t.dispose();
    this.targets = [];
  }
}

/* ---------- the console in the Training Room ---------- */

export const CONSOLE = { x: CONSOLE_PLINTH.x, z: CONSOLE_PLINTH.z, nearRadius: 5.5 };

// True when (x, z) is close enough to the console for its drill list to pop up.
export function nearConsole(x, z) {
  return Math.hypot(x - CONSOLE.x, z - CONSOLE.z) <= CONSOLE.nearRadius;
}

// The console model: a slab and a tilted, glowing screen on top of the plinth. Looks only; the plinth
// underneath is the solid part (it is a block in the Training Room arena). Returns { group, dispose }.
export function buildTrainingConsole(scene) {
  const group = new THREE.Group();
  const top = CONSOLE_PLINTH.h;
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.45, metalness: 0.6 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x4fd8ff });

  const slab = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.35, 1.0), metal);
  slab.position.set(CONSOLE.x, top + 0.175, CONSOLE.z);
  group.add(slab);

  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.6, 0.14), metal);
  frame.position.set(CONSOLE.x, top + 1.15, CONSOLE.z - 0.2);
  frame.rotation.x = -0.25; // leans back, away from you
  group.add(frame);

  let screenMat;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#0b2a3f");
    grad.addColorStop(1, "#06121d");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = "#4fd8ff";
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 244);
    ctx.fillStyle = "#4fd8ff";
    ctx.textAlign = "center";
    ctx.font = "bold 40px sans-serif";
    ctx.fillText("TRAINING CONSOLE", 256, 66);
    ctx.fillStyle = "#cfefff";
    ctx.font = "30px sans-serif";
    DRILL_IDS.forEach((id, i) => ctx.fillText(`${i + 1}   ${DRILLS[id].name}`, 256, 120 + i * 38));
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    screenMat = new THREE.MeshBasicMaterial({ map: tex });
  } else {
    screenMat = glow;
  }
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.3), screenMat);
  screen.position.z = 0.075; // just in front of the frame, so it leans with it
  frame.add(screen);

  for (const dx of [-0.8, 0, 0.8]) {
    const key = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.25), glow);
    key.position.set(CONSOLE.x + dx, top + 0.38, CONSOLE.z + 0.28);
    group.add(key);
  }

  const light = new THREE.PointLight(0x4fd8ff, 1.2, 9);
  light.position.set(CONSOLE.x, top + 1.6, CONSOLE.z + 1.2);
  group.add(light);

  scene.add(group);
  return {
    group,
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        o.geometry?.dispose?.();
        for (const m of [].concat(o.material ?? [])) {
          m.map?.dispose?.();
          m.dispose?.();
        }
      });
    },
  };
}
