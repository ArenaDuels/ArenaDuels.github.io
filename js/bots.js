// Bots — AI players simulated on the HOST only.
//
// The host runs every bot with the exact same movement rules as a human
// (same MOVE constants, same ground accelerate/friction, same air control,
// same collision), so bots have no speed advantage. Their state is
// broadcast to everyone else at 20Hz as { t: "bots", bots: [...] } and
// clients render them as ordinary RemotePlayers.
//
// Quake-style combat movement:
//   - circle-strafe the target (move sideways relative to it while keeping
//     the crosshair on it), holding a preferred range
//   - flip strafe direction at random intervals, but only while grounded —
//     once airborne a bot commits to its arc, like a real strafe jump
//   - strafe-jump: hop while strafing so the path is hard to track
//   - if a wall is in the way, flip direction early instead of grinding on it
//
// Bots shoot with the same kind of ray players do (from the eye along their
// actual aim direction), so they only hit if they're really aimed at you.

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { MOVE, dirFromYawPitch } from "./player.js";
import { NAME_WORDS } from "./names.js";

// dps: damage per second while the beam is on target (players do 40).
export const BOT_SKILLS = {
  1: { label: "Easy",   turn: 3.0, aimErr: 0.10, tol: 0.10, reaction: 0.55, dps: 16, range: 12, strafeMin: 0.80, strafeMax: 1.80, jumpMin: 2.5, jumpMax: 5.0 },
  2: { label: "Normal", turn: 5.5, aimErr: 0.05, tol: 0.07, reaction: 0.30, dps: 26, range: 9,  strafeMin: 0.45, strafeMax: 1.30, jumpMin: 1.2, jumpMax: 2.8 },
  3: { label: "Hard",   turn: 9.0, aimErr: 0.02, tol: 0.05, reaction: 0.15, dps: 36, range: 7,  strafeMin: 0.25, strafeMax: 0.90, jumpMin: 0.5, jumpMax: 1.4 },
};

const EYE = MOVE.EYE_HEIGHT;
const RESPAWN_DELAY = 2.5; // seconds
const TWO_PI = Math.PI * 2;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = (a) => a - TWO_PI * Math.round(a / TWO_PI);

// Scratch vectors (everything here is single-threaded and non-reentrant).
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _origin = new THREE.Vector3();

class Bot {
  constructor(id, name, skill) {
    this.id = id;
    this.name = name;
    this.s = BOT_SKILLS[skill] || BOT_SKILLS[2];

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.wish = new THREE.Vector3(); // world-space move direction (y unused)
    this.yaw = 0; // kept unwrapped so remote clients never lerp the long way round
    this.pitch = 0;
    this.prevPos = new THREE.Vector3(); // last physics step, for smooth rendering
    this.prevYaw = 0;
    this.hp = 100;
    this.alive = true;
    this.onGround = true;
    this.firing = false;
    this.kills = 0;
    this.deaths = 0;
    this.respawnAt = 0;

    this.stuckRef = new THREE.Vector3();
    this.resetAI();
  }

  resetAI() {
    const s = this.s;
    this.t = 0;
    this.phase = Math.random() * TWO_PI;
    this.targetId = null;
    this.hasLOS = false;
    this.retargetTimer = 0;
    this.reaction = s.reaction;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = rand(s.strafeMin, s.strafeMax);
    this.jumpTimer = rand(s.jumpMin, s.jumpMax);
    this.aimNoiseTimer = 0;
    this.offYaw = 0;
    this.offPitch = 0;
    this.stuckTimer = 0;
    this.stuckRef.copy(this.pos);
    this.unstickTimer = 0;
    this.unstickAngle = 0;
  }

  netState() {
    return {
      id: this.id,
      name: this.name,
      x: this.pos.x,
      y: this.pos.y,
      z: this.pos.z,
      yaw: this.yaw,
      pitch: this.pitch,
      hp: this.hp,
      firing: this.alive && this.firing,
    };
  }

  /* ---------- physics: same rules as PlayerController ---------- */

  physics(dt, wallBoxes, jump) {
    const hasInput = this.wish.lengthSq() > 0.0001;
    if (hasInput) _wish.copy(this.wish).setY(0).normalize();

    if (this.onGround) {
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > 0.001) {
        const newSpeed = Math.max(speed - speed * MOVE.FRICTION * dt, 0);
        this.vel.x *= newSpeed / speed;
        this.vel.z *= newSpeed / speed;
      }
      if (hasInput) {
        const cur = this.vel.x * _wish.x + this.vel.z * _wish.z;
        const add = MOVE.WISH_SPEED - cur;
        if (add > 0) {
          const a = Math.min(MOVE.GROUND_ACCEL * dt * MOVE.WISH_SPEED, add);
          this.vel.x += a * _wish.x;
          this.vel.z += a * _wish.z;
        }
      }
    } else if (hasInput) {
      this.vel.x = _wish.x * MOVE.WISH_SPEED;
      this.vel.z = _wish.z * MOVE.WISH_SPEED;
    }

    if (this.onGround && jump) {
      this.vel.y = MOVE.JUMP_VEL;
      this.onGround = false;
    }
    this.vel.y -= MOVE.GRAVITY * dt;

    const steps = Math.max(1, Math.ceil((this.vel.length() * dt) / 0.2));
    const subDt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, subDt);
      this.collide(wallBoxes);
    }
  }

  // Same box-based floor/step/wall resolution PlayerController uses.
  collide(wallBoxes) {
    const STEP_TOLERANCE = 0.5;
    const STAND_MARGIN = MOVE.RADIUS * 0.6;
    const REST_OFFSET = 1.4;
    const p = this.pos;
    const feetLevel = p.y - REST_OFFSET;

    let surfaceTopY = 0;
    for (const box of wallBoxes) {
      const overX = p.x > box.min.x - STAND_MARGIN && p.x < box.max.x + STAND_MARGIN;
      const overZ = p.z > box.min.z - STAND_MARGIN && p.z < box.max.z + STAND_MARGIN;
      if (overX && overZ && box.max.y <= feetLevel + STEP_TOLERANCE && box.max.y > surfaceTopY) {
        surfaceTopY = box.max.y;
      }
    }
    const restY = surfaceTopY + REST_OFFSET;
    if (p.y <= restY) {
      p.y = restY;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    const pushRadius = MOVE.RADIUS + 0.01;
    for (const box of wallBoxes) {
      if (p.y >= box.max.y - 0.05) continue;
      const cx = Math.max(box.min.x, Math.min(p.x, box.max.x));
      const cz = Math.max(box.min.z, Math.min(p.z, box.max.z));
      let dx = p.x - cx;
      let dz = p.z - cz;
      const dist2 = dx * dx + dz * dz;
      if (dist2 < pushRadius * pushRadius) {
        const dist = Math.sqrt(dist2) || 0.0001;
        const push = pushRadius - dist;
        dx /= dist;
        dz /= dist;
        p.x += dx * push;
        p.z += dz * push;
      }
    }
  }

  /* ---------- AI ---------- */

  pickTarget(mgr, eye) {
    let best = null;
    let bestD = Infinity;
    let bestSeen = false;
    for (const e of mgr.enemies) {
      if (e.id === this.id) continue;
      const d = this.pos.distanceTo(e.pos);
      const seen = d < 60 && !mgr.segmentBlocked(eye, e.pos);
      if ((seen && !bestSeen) || (seen === bestSeen && d < bestD)) {
        best = e;
        bestD = d;
        bestSeen = seen;
      }
    }
    const hadLOS = this.hasLOS;
    const prevId = this.targetId;
    this.targetId = best ? best.id : null;
    this.hasLOS = bestSeen;
    // Fresh sighting -> short human-ish reaction delay before opening fire.
    if (best && (best.id !== prevId || (!hadLOS && bestSeen))) {
      this.reaction = this.s.reaction * rand(0.7, 1.3);
    }
  }

  // If the way we're heading hits a wall within ~1.8 units, react now.
  checkAhead(mgr) {
    if (!this.onGround) return;
    const wl = Math.hypot(this.wish.x, this.wish.z);
    if (wl < 0.1) return;
    _origin.copy(this.pos);
    _dir.set(this.wish.x / wl, 0, this.wish.z / wl);
    if (!mgr.rayBlocked(_origin, _dir, 1.8)) return;

    if (this.hasLOS) {
      this.strafeDir = -this.strafeDir;
      this.strafeTimer = rand(this.s.strafeMin, this.s.strafeMax);
    } else if (this.unstickTimer <= 0) {
      this.unstickTimer = 0.5;
      this.unstickAngle = (Math.random() < 0.5 ? -1 : 1) * rand(0.9, 2.0);
    }
  }

  update(dt, mgr) {
    const s = this.s;
    this.t += dt;
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    _eye.set(this.pos.x, this.pos.y + EYE, this.pos.z);

    this.retargetTimer -= dt;
    if (this.retargetTimer <= 0) {
      this.retargetTimer = rand(0.2, 0.3);
      this.pickTarget(mgr, _eye);
      this.checkAhead(mgr);
    }

    const tgt = this.targetId ? mgr.enemyMap.get(this.targetId) : null;
    if (!tgt) {
      this.targetId = null;
      this.hasLOS = false;
    }

    // ----- decide where to move -----
    let wx = 0, wz = 0, dx = 0, dy = 0, dz = 0, flat = 0, len = 0;
    if (tgt) {
      dx = tgt.pos.x - _eye.x;
      dy = tgt.pos.y - _eye.y;
      dz = tgt.pos.z - _eye.z;
      flat = Math.hypot(dx, dz) || 0.001;
      len = Math.hypot(flat, dy);
      const fx = dx / flat;
      const fz = dz / flat;

      if (this.hasLOS) {
        // Circle-strafe: sideways relative to the target, nudged in/out to
        // hold the preferred range. Direction only flips while grounded.
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0 && this.onGround) {
          this.strafeDir = -this.strafeDir;
          this.strafeTimer = rand(s.strafeMin, s.strafeMax);
        }
        const radial = clamp((flat - s.range) / 4, -1, 1) * 0.8;
        wx = -fz * this.strafeDir + fx * radial;
        wz = fx * this.strafeDir + fz * radial;
      } else {
        // No line of sight: head for the target, weaving side to side.
        const weave = Math.sin(this.t * 3 + this.phase) * 0.6;
        wx = fx - fz * weave;
        wz = fz + fx * weave;
      }
    }

    // Recovering from being stuck: veer off to the side for a moment.
    if (this.unstickTimer > 0) {
      this.unstickTimer -= dt;
      if (wx !== 0 || wz !== 0) {
        const c = Math.cos(this.unstickAngle);
        const sn = Math.sin(this.unstickAngle);
        const rx = wx * c - wz * sn;
        const rz = wx * sn + wz * c;
        wx = rx;
        wz = rz;
      }
    }

    // Stuck detection by actual displacement (collision pushes position
    // out of walls without zeroing velocity, so speed isn't a good signal).
    this.stuckTimer += dt;
    if (this.stuckTimer >= 0.4) {
      const moved = Math.hypot(this.pos.x - this.stuckRef.x, this.pos.z - this.stuckRef.z);
      const wishing = wx * wx + wz * wz > 0.01;
      if (wishing && this.onGround && moved < 0.8 && this.unstickTimer <= 0) {
        this.unstickTimer = 0.6;
        this.unstickAngle = (Math.random() < 0.5 ? -1 : 1) * rand(1.0, 2.2);
        this.strafeDir = -this.strafeDir;
      }
      this.stuckRef.copy(this.pos);
      this.stuckTimer = 0;
    }

    // Strafe-jump while fighting; hop when stuck (clears steps/low cover).
    let jump = false;
    this.jumpTimer -= dt;
    if (this.onGround) {
      if (this.unstickTimer > 0) {
        jump = true;
      } else if (this.hasLOS && this.jumpTimer <= 0) {
        jump = true;
        this.jumpTimer = rand(s.jumpMin, s.jumpMax);
      }
    }

    // ----- aim -----
    let wantYaw = this.yaw;
    let wantPitch = 0;
    let turn = s.turn;
    if (tgt && this.hasLOS) {
      this.aimNoiseTimer -= dt;
      if (this.aimNoiseTimer <= 0) {
        this.aimNoiseTimer = rand(0.2, 0.4);
        this.offYaw = rand(-1, 1) * s.aimErr;
        this.offPitch = rand(-1, 1) * s.aimErr;
      }
      wantYaw = Math.atan2(-dx, -dz) + this.offYaw;
      wantPitch = Math.atan2(dy, flat) + this.offPitch;
    } else if (wx !== 0 || wz !== 0) {
      wantYaw = Math.atan2(-wx, -wz); // look where we're going
      turn = 6;
    }
    const maxStep = turn * dt;
    this.yaw += clamp(wrap(wantYaw - this.yaw), -maxStep, maxStep);
    this.pitch = clamp(this.pitch + clamp(wantPitch - this.pitch, -maxStep, maxStep), -1.4, 1.4);

    // ----- decide to fire (only once actually lined up) -----
    this.firing = false;
    if (tgt && this.hasLOS) {
      this.reaction -= dt;
      if (this.reaction <= 0 && len < 50) {
        dirFromYawPitch(this.yaw, this.pitch, _aim);
        const cos = (_aim.x * dx + _aim.y * dy + _aim.z * dz) / len;
        const err = Math.acos(clamp(cos, -1, 1));
        if (err < Math.max(s.tol, Math.atan(0.7 / len))) this.firing = true;
      }
    } else {
      this.reaction = s.reaction;
    }

    // ----- move -----
    this.wish.set(wx, 0, wz);
    this.physics(dt, mgr.ctx.getWallBoxes(), jump);

    if (this.firing) mgr.shoot(this, dt);
  }
}

/**
 * Owns every bot. main.js creates one on the host and calls update() from
 * its fixed-timestep physics loop.
 *
 * ctx = {
 *   scene, players (Map id -> RemotePlayer), getLocal(), getMyId(), getArena(),
 *   getSolids(), getWallBoxes(),
 *   addPlayer(id, name) -> RemotePlayer,
 *   damageLocal(attackerId, amount), sendHit(targetId, attackerId, amount),
 *   onBotKilled(attackerId),
 * }
 */
export class BotManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.bots = new Map();
    this.clock = 0;
    this.ray = new THREE.Raycaster();

    this.enemies = [];
    this.enemyMap = new Map();
    this.meshToEnemy = new Map();
  }

  has(id) {
    return this.bots.has(id);
  }

  creditKill(attackerId) {
    const b = this.bots.get(attackerId);
    if (b) b.kills++;
  }

  spawnBots(count, skill) {
    this.ctx.scene.updateMatrixWorld(true); // arena was just built; make sure rays see it
    const pool = NAME_WORDS.filter((w) => w.length <= 6);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < count; i++) {
      const id = `bot-${i + 1}`;
      const name = `Bot ${pool[i % pool.length]}`;
      const bot = new Bot(id, name, skill);
      this.bots.set(id, bot);
      this.ctx.addPlayer(id, name);
      this.refreshEnemies();
      this.respawn(bot);
      this.syncVisual(bot);
    }
  }

  dispose() {
    this.bots.clear();
    this.enemies = [];
    this.enemyMap.clear();
    this.meshToEnemy.clear();
  }

  /* ---------- world queries ---------- */

  // Everything a bot can shoot at: the host's own player, remote humans, bots.
  refreshEnemies() {
    this.enemies = [];
    this.enemyMap.clear();
    this.meshToEnemy.clear();
    const add = (e) => {
      this.enemies.push(e);
      this.enemyMap.set(e.id, e);
      this.meshToEnemy.set(e.mesh, e);
    };
    const local = this.ctx.getLocal();
    if (local && local.hp > 0) {
      local.mesh.updateMatrixWorld();
      add({ id: this.ctx.getMyId(), pos: local.mesh.position, mesh: local.mesh });
    }
    for (const [id, rp] of this.ctx.players) {
      if (rp.visible && rp.hp > 0) {
        const b = this.bots.get(id);
        add({ id, pos: b ? b.pos : rp.mesh.position, mesh: rp.mesh });
      }
    }
  }

  segmentBlocked(from, to) {
    _dir.subVectors(to, from);
    const d = _dir.length();
    if (d < 0.01) return false;
    _dir.divideScalar(d);
    return this.rayBlocked(from, _dir, d - 0.3);
  }

  rayBlocked(origin, dir, dist) {
    this.ray.set(origin, dir);
    this.ray.near = 0;
    this.ray.far = Math.max(dist, 0.01);
    return this.ray.intersectObjects(this.ctx.getSolids(), false).length > 0;
  }

  /* ---------- combat ---------- */

  shoot(bot, dt) {
    _eye.set(bot.pos.x, bot.pos.y + EYE, bot.pos.z);
    dirFromYawPitch(bot.yaw, bot.pitch, _aim);
    this.ray.set(_eye, _aim);
    this.ray.near = 0;
    this.ray.far = 80;

    const objs = [];
    for (const e of this.enemies) if (e.id !== bot.id) objs.push(e.mesh);
    for (const o of this.ctx.getSolids()) objs.push(o);

    const hit = this.ray.intersectObjects(objs, false)[0];
    if (!hit) return;
    const e = this.meshToEnemy.get(hit.object);
    if (e) this.damage(e.id, bot.id, bot.s.dps * dt);
  }

  // Single entry point for "something took damage" — routes to a bot, the
  // host's own player, or a remote human over the network.
  damage(targetId, attackerId, amount) {
    const bot = this.bots.get(targetId);
    if (bot) {
      this.damageBot(bot, attackerId, amount);
    } else if (targetId === this.ctx.getMyId()) {
      this.ctx.damageLocal(attackerId, amount);
    } else {
      this.ctx.sendHit(targetId, attackerId, amount);
    }
  }

  damageBot(bot, attackerId, amount) {
    if (!bot.alive) return;
    bot.hp = Math.max(0, bot.hp - amount);
    if (bot.hp > 0) return;

    bot.alive = false;
    bot.firing = false;
    bot.deaths++;
    bot.respawnAt = this.clock + RESPAWN_DELAY;

    const killer = this.bots.get(attackerId);
    if (killer) killer.kills++;
    else this.ctx.onBotKilled(attackerId);

    this.syncVisual(bot);
  }

  respawn(bot) {
    const spawns = this.ctx.getArena().spawns;
    // Pick the spawn farthest from everyone still alive (with a little
    // randomness so it isn't perfectly predictable).
    let bestSpawn = spawns[0];
    let bestScore = -Infinity;
    for (const sp of spawns) {
      let minD = Infinity;
      for (const e of this.enemies) {
        if (e.id === bot.id) continue;
        minD = Math.min(minD, Math.hypot(e.pos.x - sp.x, e.pos.z - sp.z));
      }
      const score = (minD === Infinity ? 0 : minD) + Math.random() * 3;
      if (score > bestScore) {
        bestScore = score;
        bestSpawn = sp;
      }
    }
    bot.pos.set(bestSpawn.x, bestSpawn.y, bestSpawn.z);
    bot.vel.set(0, 0, 0);
    bot.yaw = bestSpawn.yaw || 0;
    bot.pitch = 0;
    bot.prevPos.copy(bot.pos);
    bot.prevYaw = bot.yaw;
    bot.hp = 100;
    bot.alive = true;
    bot.onGround = true;
    bot.resetAI();
  }

  /* ---------- per-step update + network sync ---------- */

  update(dt) {
    this.clock += dt;
    this.refreshEnemies();
    for (const bot of this.bots.values()) {
      if (!bot.alive) {
        if (this.clock >= bot.respawnAt) {
          this.respawn(bot);
          this.syncVisual(bot);
        }
        continue;
      }
      bot.update(dt, this);
      this.syncVisual(bot);
    }
  }

  // Push the bot's true state into its RemotePlayer so it renders, shows an
  // hp bar / name tag / beam, and is shootable — then snap the mesh to the
  // exact position (the host doesn't need the smoothing remote clients get).
  syncVisual(bot) {
    const rp = this.ctx.players.get(bot.id);
    if (!rp) return;
    rp.applyNetState(bot.netState());
    if (bot.alive) {
      rp.mesh.position.copy(bot.pos);
      rp.mesh.rotation.y = bot.yaw;
      rp.mesh.updateMatrixWorld();
    }
  }

  // Called once per render frame (not per physics step), like the local
  // player's camera: draws each bot between its last two physics states so
  // it moves smoothly on any refresh rate instead of in 60Hz jumps.
  interpolate(alpha) {
    for (const bot of this.bots.values()) {
      if (!bot.alive) continue;
      const rp = this.ctx.players.get(bot.id);
      if (!rp) continue;
      const yaw = bot.prevYaw + (bot.yaw - bot.prevYaw) * alpha;
      rp.mesh.position.lerpVectors(bot.prevPos, bot.pos, alpha);
      rp.mesh.rotation.y = yaw;
      // RemotePlayer.update() eases toward these every frame — keep them
      // equal to what we just drew so it doesn't drag the bot ahead.
      rp.targetPos.copy(rp.mesh.position);
      rp.targetYaw = yaw;
      rp.mesh.updateMatrixWorld();
    }
  }

  getStates() {
    return [...this.bots.values()].map((b) => b.netState());
  }
}
