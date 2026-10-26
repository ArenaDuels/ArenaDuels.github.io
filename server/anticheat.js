// Server-side hit and kill validation for the ArenaDuels relay.
//
// The game still simulates everything in the browsers (movement, aiming, hp),
// so the relay can't *prove* a shot was real. What it can do is keep its own
// shadow copy of the match — where everybody was recently, who is alive, how
// much damage each player has soaked — and refuse any message that doesn't fit
// that picture:
//
//   Hits  : attacker must be alive and (recently) firing; target must exist, be
//           alive and be someone else; the target must have been inside the
//           attacker's aim cone within the last moments, in range, with no wall
//           in between; damage is clamped to what the beam can actually deal.
//   Kills : only accepted for a victim who has really absorbed lethal damage
//           from validated hits, and the credited killer is the server's own
//           record of who hit them — whatever the client claimed is ignored.
//
// This is a *plausibility* layer, not a full authority: someone running a modified
// client that sends honest-looking positions and aims perfectly (an aimbot), or
// that ignores damage on their own side (god mode), still gets through. Closing
// that needs the server to simulate movement and health itself.
//
// All timing is in milliseconds; every method takes an optional `now` so the
// tests can drive a fake clock.

import { getArena } from "./arenas.js";

export const TUNING = Object.freeze({
  // --- damage ---
  PLAYER_DPS: 40,            // the beam's damage per second (see main.js)
  DPS_SLACK: 1.1,            // tolerate 10% over before clamping
  BUCKET_CAP: 30,            // damage that can arrive in one burst (a lag spike, ~0.75s of beam)
  TAP_CAP: 6,                // small allowance for the first frames of a shot, before a "firing" state arrives
  TAP_REFILL_PER_SEC: 6,
  FIRING_GRACE_MS: 400,      // a "firing" state this recent counts as "is firing"
  // --- geometry ---
  EYE_HEIGHT: 1.0,           // camera is this far above the player's position
  RADIUS: 0.5,               // capsule radius
  HALF_SEGMENT: 0.6,         // capsule = vertical segment of +-0.6 around its centre, plus the radius
  AIM_SLACK: 0.75,           // extra metres of miss we forgive (interpolation, lag)
  AIM_SLACK_PER_M: 0.04,     // ...plus this much per metre of distance
  WALL_SHRINK: 0.12,         // obstacle boxes are shrunk this much per side, so grazing a corner isn't "blocked"
  RANGE_MARGIN: 12,
  // --- history (lag tolerance) ---
  SAMPLE_GAP_MS: 40,         // states arrive at ~20Hz; extra ones just overwrite the newest sample
  HISTORY_MS: 1200,
  ATTACKER_WINDOW_MS: 350,   // which of the shooter's recent states we try
  TARGET_WINDOW_MS: 900,     // which of the target's recent states we try (the shooter sees them delayed)
  MAX_STATE_AGE_MS: 2000,    // no state this recent => can't validate
  // --- kills ---
  KILL_DAMAGE_FRACTION: 0.9, // validated damage needed before a death is believed
  CREDIT_WINDOW_MS: 15000,   // a hit older than this can't earn the kill
  RESPAWN_SLACK_MS: 600,     // treat a victim as alive slightly before their respawn timer ends
  MAX_BOTS: 8,
});

const DEFAULT_MAX_HP = 100;
const DEFAULT_RESPAWN_DELAY = 2;

// ---------------------------------------------------------------- arena boxes

const boxCache = new Map(); // arenaId -> { boxes, maxRange }

function arenaGeometry(arenaId, arenaOverride) {
  if (!arenaOverride && boxCache.has(arenaId)) return boxCache.get(arenaId);
  const arena = arenaOverride || getArena(arenaId);
  const boxes = [];
  const s = TUNING.WALL_SHRINK;
  const add = (w, h, d, x, y, z) => {
    const hx = Math.max(0.02, w / 2 - s);
    const hy = Math.max(0.02, h / 2 - s);
    const hz = Math.max(0.02, d / 2 - s);
    boxes.push({ minX: x - hx, maxX: x + hx, minY: y - hy, maxY: y + hy, minZ: z - hz, maxZ: z + hz });
  };
  for (const [w, h, d, x, y, z] of arena.walls ?? []) add(w, h, d, x, y, z);
  for (const p of arena.props ?? []) add(p.w, p.h, p.d, p.x, p.y, p.z);
  const geo = { boxes, maxRange: (arena.floorSize ?? 60) * Math.SQRT2 + TUNING.RANGE_MARGIN };
  if (!arenaOverride) boxCache.set(arenaId, geo);
  return geo;
}

const insideBox = (b, x, y, z) =>
  x > b.minX && x < b.maxX && y > b.minY && y < b.maxY && z > b.minZ && z < b.maxZ;

// Does the segment (ox,oy,oz) -> (px,py,pz) pass through the box? (Slab method.)
// Boxes that contain either end are ignored: a shooter wedged into a stair edge
// shouldn't be unable to hit anyone.
function segmentBlockedBy(b, ox, oy, oz, px, py, pz) {
  if (insideBox(b, ox, oy, oz) || insideBox(b, px, py, pz)) return false;
  let tMin = 0;
  let tMax = 1;
  const dx = px - ox;
  const dy = py - oy;
  const dz = pz - oz;
  const axes = [
    [ox, dx, b.minX, b.maxX],
    [oy, dy, b.minY, b.maxY],
    [oz, dz, b.minZ, b.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return false;
    }
  }
  return true;
}

// Same convention as the client (three.js Euler "YXZ", looking down -Z).
function aimDirection(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

// ---------------------------------------------------------------------- actors

class Actor {
  constructor(id, isBot, now) {
    this.id = id;
    this.isBot = isBot;
    this.hist = [];        // recent { t, x, y, z, yaw, pitch, firing, hp }
    this.seq = 0;          // bumps on every new/updated sample (cache key)
    this.lastAppendT = 0;
    this.lastFiringAt = 0;
    this.bucket = { tokens: TUNING.BUCKET_CAP, at: now };
    this.tap = { tokens: TUNING.TAP_CAP, at: now };
    this.resetLife();
    this.canDie = true;    // bots only: seen alive since their last accepted death
  }

  resetLife() {
    this.damageTaken = 0;
    this.lastHit = null;   // { id, at }
    this.contrib = new Map(); // attackerId -> { dmg, at }
    this.deadUntil = 0;
  }

  last() {
    return this.hist[this.hist.length - 1];
  }

  push(sample) {
    this.seq++;
    if (sample.firing) this.lastFiringAt = sample.t;
    if (this.hist.length && sample.t - this.lastAppendT < TUNING.SAMPLE_GAP_MS) {
      this.hist[this.hist.length - 1] = sample;
    } else {
      this.hist.push(sample);
      this.lastAppendT = sample.t;
    }
    while (this.hist.length && sample.t - this.hist[0].t > TUNING.HISTORY_MS) this.hist.shift();
  }
}

function takeFrom(bucket, now, rate, cap, wanted) {
  bucket.tokens = Math.min(cap, bucket.tokens + ((now - bucket.at) / 1000) * rate);
  bucket.at = now;
  const allowed = Math.min(wanted, bucket.tokens);
  if (allowed < 0.05) return 0;
  bucket.tokens -= allowed;
  return allowed;
}

const reject = (reason) => ({ ok: false, reason });

// ------------------------------------------------------------------ the guard

export class RoomGuard {
  /**
   * @param {{ arenaId: string, hostId: string, arena?: object }} opts
   *   `arena` lets tests pass a hand-made arena instead of a named one.
   */
  constructor({ arenaId, hostId, arena }) {
    this.hostId = hostId;
    this.geo = arenaGeometry(arenaId, arena);
    this.actors = new Map();
    this.maxHp = DEFAULT_MAX_HP;
    this.respawnDelay = DEFAULT_RESPAWN_DELAY;
    this.over = false;
    this.pairCache = new Map();
  }

  // ---- roster / host events ----

  addMember(id, now = Date.now()) {
    if (!this.actors.has(id)) this.actors.set(id, new Actor(id, false, now));
  }

  removeMember(id) {
    this.actors.delete(id);
    this.pairCache.clear();
  }

  #applySettings(s) {
    if (Number.isFinite(s?.startingHealth)) this.maxHp = s.startingHealth;
    if (Number.isFinite(s?.respawnDelay)) this.respawnDelay = s.respawnDelay;
  }

  onRestart(settings) {
    this.#applySettings(settings);
    this.over = false;
    for (const a of this.actors.values()) {
      a.resetLife();
      a.canDie = true;
    }
  }

  onSync(forId, settings) {
    this.#applySettings(settings);
    this.actors.get(forId)?.resetLife(); // a joiner is topped up to full health
  }

  onEnd() {
    this.over = true;
  }

  // ---- position feeds ----

  onState(id, body, now = Date.now()) {
    const a = this.actors.get(id);
    if (!a || a.isBot) return;
    a.push({ t: now, x: body.x, y: body.y, z: body.z, yaw: body.yaw, pitch: body.pitch ?? 0, firing: body.firing === true, hp: body.hp });
  }

  /** The host's bots (already range-checked by cleanRelay). */
  onBots(list, now = Date.now()) {
    for (const b of list) {
      let a = this.actors.get(b.id);
      if (!a) {
        const botCount = [...this.actors.values()].filter((x) => x.isBot).length;
        if (botCount >= TUNING.MAX_BOTS) continue;
        a = new Actor(b.id, true, now);
        this.actors.set(b.id, a);
      }
      a.push({ t: now, x: b.x, y: b.y, z: b.z, yaw: b.yaw, pitch: b.pitch ?? 0, firing: b.firing === true, hp: b.hp });
      if (b.hp > 0) {
        if (a.wasDead) a.resetLife(); // it respawned: fresh life
        a.wasDead = false;
        a.canDie = true;
      } else {
        a.wasDead = true;
      }
    }
  }

  // ---- queries ----

  #isDead(a, now) {
    if (a.deadUntil > now) return true;
    const s = a.last();
    return !!s && s.hp <= 0;
  }

  #hasBots() {
    for (const a of this.actors.values()) if (a.isBot) return true;
    return false;
  }

  // Was `tgt` plausibly under `atk`'s beam recently? Tries the shooter's last few
  // states against the target's last second of states (the shooter was looking at
  // a slightly old picture of the target), and returns on the first match.
  #canHit(atk, tgt, now) {
    const key = `${atk.id}>${tgt.id}`;
    const cached = this.pairCache.get(key);
    if (cached && cached.sa === atk.seq && cached.st === tgt.seq) return cached.res;

    const { boxes, maxRange } = this.geo;
    const T = TUNING;
    let sawRange = false;
    let sawAim = false;
    let res = null;

    search: for (let i = atk.hist.length - 1; i >= 0; i--) {
      const a = atk.hist[i];
      if (now - a.t > T.ATTACKER_WINDOW_MS) break;
      const ox = a.x;
      const oy = a.y + T.EYE_HEIGHT;
      const oz = a.z;
      const [dx, dy, dz] = aimDirection(a.yaw, a.pitch);

      for (let j = tgt.hist.length - 1; j >= 0; j--) {
        const t = tgt.hist[j];
        if (now - t.t > T.TARGET_WINDOW_MS) break;

        const dist = Math.hypot(t.x - ox, t.y - oy, t.z - oz);
        if (dist > maxRange) continue;
        sawRange = true;

        // Closest approach of the aim ray to the capsule's axis (3 sample points).
        let miss = Infinity;
        for (const off of [-T.HALF_SEGMENT, 0, T.HALF_SEGMENT]) {
          const vx = t.x - ox;
          const vy = t.y + off - oy;
          const vz = t.z - oz;
          const along = vx * dx + vy * dy + vz * dz;
          const d2 = along <= 0
            ? vx * vx + vy * vy + vz * vz
            : vx * vx + vy * vy + vz * vz - along * along;
          miss = Math.min(miss, Math.sqrt(Math.max(0, d2)));
        }
        if (miss > T.RADIUS + T.AIM_SLACK + T.AIM_SLACK_PER_M * dist) continue;
        sawAim = true;

        // Line of sight to the centre, head or feet.
        for (const off of [0, T.HALF_SEGMENT, -T.HALF_SEGMENT]) {
          let blocked = false;
          for (const b of boxes) {
            if (segmentBlockedBy(b, ox, oy, oz, t.x, t.y + off, t.z)) {
              blocked = true;
              break;
            }
          }
          if (!blocked) {
            res = { pass: true };
            break search;
          }
        }
      }
    }

    if (!res) res = { pass: false, reason: !sawRange ? "out-of-range" : !sawAim ? "off-target" : "blocked" };
    this.pairCache.set(key, { sa: atk.seq, st: tgt.seq, res });
    return res;
  }

  // ---- the two checks ----

  /**
   * @param {string} senderId  socket id of whoever sent the message
   * @param {boolean} senderIsHost
   * @param {{targetId:string, attackerId:string, damage:number}} hit  (already cleaned)
   * @returns {{ok:true, damage:number} | {ok:false, reason:string}}
   */
  checkHit(senderId, senderIsHost, hit, now = Date.now()) {
    if (this.over) return reject("match-over");
    const atk = this.actors.get(hit.attackerId);
    const tgt = this.actors.get(hit.targetId);
    if (!atk) return reject("unknown-attacker");
    if (!tgt) return reject("unknown-target");
    if (atk === tgt) return reject("self-hit");
    if (atk.isBot ? !senderIsHost : atk.id !== senderId) return reject("bad-attacker");

    const a = atk.last();
    const t = tgt.last();
    if (!a || now - a.t > TUNING.MAX_STATE_AGE_MS) return reject("attacker-no-state");
    if (!t || now - t.t > TUNING.MAX_STATE_AGE_MS) return reject("target-no-state");
    if (this.#isDead(atk, now)) return reject("attacker-dead");
    if (this.#isDead(tgt, now)) return reject("target-dead");

    const geometry = this.#canHit(atk, tgt, now);
    if (!geometry.pass) return reject(geometry.reason);

    // Damage: a player's beam does 40/s, so that's all anyone may deal. Without a
    // recent "firing" state only a sliver is allowed (the first frames of a shot).
    const firing = now - atk.lastFiringAt <= TUNING.FIRING_GRACE_MS;
    const damage = firing
      ? takeFrom(atk.bucket, now, TUNING.PLAYER_DPS * TUNING.DPS_SLACK, TUNING.BUCKET_CAP, hit.damage)
      : takeFrom(atk.tap, now, TUNING.TAP_REFILL_PER_SEC, TUNING.TAP_CAP, hit.damage);
    if (damage <= 0) return reject(firing ? "damage-rate" : "not-firing");

    tgt.damageTaken += damage;
    tgt.lastHit = { id: atk.id, at: now };
    const c = tgt.contrib.get(atk.id) || { dmg: 0, at: now };
    c.dmg += damage;
    c.at = now;
    tgt.contrib.set(atk.id, c);
    return { ok: true, damage };
  }

  /**
   * @returns {{ok:true, attackerId:string} | {ok:false, reason:string}}
   *   `attackerId` is the server's verdict on who gets the elimination.
   */
  checkKill(senderId, senderIsHost, kill, now = Date.now()) {
    if (this.over) return reject("match-over");
    const victim = this.actors.get(kill.victimId);
    if (!victim) return reject("unknown-victim");
    if (victim.isBot ? !senderIsHost : victim.id !== senderId) return reject("bad-victim");
    if (victim.deadUntil > now) return reject("already-dead");

    const claimed = this.actors.get(kill.attackerId);
    const fresh = (c) => c && now - c.at <= TUNING.CREDIT_WINDOW_MS;
    let credit = null;

    if (victim.isBot) {
      // The relay only sees hits from *remote* humans on a bot; the host's own
      // shots and bot-vs-bot fights happen locally. So trust the host's account,
      // but only for a bot that was alive, and never credit a remote human who
      // hasn't actually been seen hitting it.
      if (!victim.canDie) return reject("bot-not-alive");
      if (!claimed || claimed === victim) return reject("unknown-attacker");
      if (!claimed.isBot && claimed.id !== this.hostId && !fresh(victim.contrib.get(claimed.id))) return reject("no-credit");
      credit = claimed.id;
      victim.canDie = false;
    } else {
      const fatal = victim.damageTaken >= this.maxHp * TUNING.KILL_DAMAGE_FRACTION;
      // Bots shooting the host never touch the network, so the relay can't have
      // counted that damage; for the host's own death accept a bot or anyone seen hitting them.
      const hostDeath = victim.id === this.hostId && this.#hasBots();
      if (hostDeath && claimed && (claimed.isBot || fresh(victim.contrib.get(claimed.id)))) {
        credit = claimed.id;
      } else if (fatal && fresh(victim.lastHit)) {
        credit = victim.lastHit.id;
      } else {
        return reject(fatal ? "no-credit" : "not-enough-damage");
      }
    }

    victim.resetLife();
    victim.deadUntil = now + Math.max(0, this.respawnDelay * 1000 - TUNING.RESPAWN_SLACK_MS);
    return { ok: true, attackerId: credit };
  }
}
