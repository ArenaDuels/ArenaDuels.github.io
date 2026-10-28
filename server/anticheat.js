// Server-authoritative room logic for the ArenaDuels relay.
//
// Who decides what (humans):
//   - HEALTH, DAMAGE, DEATH, RESPAWN : the server. Clients never report hits or
//     deaths; they only say where they are, where they're aiming and whether the
//     trigger is held. The server runs the beam itself (30 times a second), takes
//     health off whoever it actually hits, announces the kill, and later puts the
//     player back at a spawn point it picked.
//   - MOVEMENT : still simulated by each browser (so it stays smooth), but every
//     reported position is checked against what the movement rules allow: top
//     speed, jump height and airtime, arena bounds, walking through walls. A
//     position that can't be real is thrown away and the player is snapped back.
//   - AIM : trusted. The server can't know where a mouse is pointing, so an
//     aimbot that sends perfect aim still works. That's the one thing a relay
//     can't fix.
//
// Bots are simulated by the host's browser, so the host stays in charge of them:
//   - a bot shooting a human is validated here (aim, line of sight, damage rate)
//     and then applied by the server to the human's health;
//   - a human shooting a bot is detected here and forwarded to the host as a hit;
//   - a bot's death is announced by the host and accepted once per life.
//
// All times are milliseconds. Methods take an optional `now` so tests can use a
// fake clock. Outgoing messages are queued with #emit and collected by drain().

import { getArena } from "./arenas.js";

export const TUNING = Object.freeze({
  // --- damage ---
  PLAYER_DPS: 40,            // the beam's damage per second (matches the client)
  DPS_SLACK: 1.1,            // bot hits: tolerate 10% over before clamping
  BUCKET_CAP: 30,            // bot hits: burst allowance (lag spikes)
  TAP_CAP: 6,                // bot hits: tiny allowance before a "firing" state arrives
  TAP_REFILL_PER_SEC: 6,
  FIRING_GRACE_MS: 400,      // bot hits: a "firing" state this recent counts as firing
  FIRING_STALE_MS: 200,      // beam: ignore a firing flag whose state is older than this
  TICK_MAX_DT: 0.1,          // beam: never integrate more than this per tick
  // --- geometry ---
  EYE_HEIGHT: 1.0,
  RADIUS: 0.5,
  HALF_SEGMENT: 0.6,
  AIM_SLACK: 0.75,
  AIM_SLACK_PER_M: 0.04,
  WALL_SHRINK: 0.12,
  RANGE_MARGIN: 12,
  // --- history (lag tolerance) ---
  SAMPLE_GAP_MS: 40,
  HISTORY_MS: 1200,
  ATTACKER_WINDOW_MS: 350,
  TARGET_WINDOW_MS: 900,
  MAX_STATE_AGE_MS: 2000,
  // --- movement rules (see client player.js: ground 16 m/s, air 10.5, jump 12, gravity 35) ---
  H_SPEED: 21,               // metres/second of horizontal travel we allow. Honest play in the replay test peaks at
                             // 19.75 (running is 16; strafing and wall push-outs add a little).
  H_CAP_M: 18,               // distance that can be "saved up" at most: covers about a second of network stall
  NEAR_GROUND: 0.45,         // "touching down": a hopping player is sampled only every 50ms, so even a
                             // bunny-hopper's lowest sample is ~0.3 above the ground; a hoverer never gets this low
  AIR_MAX_MS: 2000,          // longest believable time without touching down (hops dip every ~0.7s, a long fall ~1s)
  SUPPORT_MEMORY_MS: 2000,   // how far back we remember the highest surface you were over
  APEX_MAX: 3.0,             // highest believable rise above the highest surface you've recently been over (jump apex ~2.1, +step-up)
  MIN_Y: 1.3,                // capsule centre can't be lower than standing on the floor (1.4)
  BOUNDS_MARGIN: 0.4,
  PENETRATION_MAX: 0.5,      // the client can leave you overlapping a wall by a bit in tight gaps; the
                             // centre itself must never be inside a wall (that would be > 0.5)
  TUNNEL_MAX_CHORD: 3.5,     // straight-line moves up to this long can't pass through a wall
  TUNNEL_SHRINK: 0.15,
  GRACE_MS: 3000,            // after joining / a restart, positions are free (players pick their own spawn)
  CORRECT_COOLDOWN_MS: 200,
  // --- bots ---
  CREDIT_WINDOW_MS: 15000,
  RESPAWN_SLACK_MS: 600,
  MAX_BOTS: 8,
});

const DEFAULT_MAX_HP = 100;
const DEFAULT_RESPAWN_DELAY = 2;
const STEP = 0.5;          // client: surfaces up to this much above your feet are stepped onto
const STAND_MARGIN = 0.3;  // client: how far past a box edge still counts as standing on it
const REST = 1.4;          // client: capsule centre height above whatever it rests on

// ---------------------------------------------------------------- arena boxes

const geoCache = new Map();

function arenaGeometry(arenaId, arenaOverride) {
  if (!arenaOverride && geoCache.has(arenaId)) return geoCache.get(arenaId);
  const arena = arenaOverride || getArena(arenaId);
  const solids = []; // true size: used for movement rules
  const boxes = [];  // slightly shrunk: used for line of sight
  const s = TUNING.WALL_SHRINK;
  const add = (w, h, d, x, y, z) => {
    solids.push({ minX: x - w / 2, maxX: x + w / 2, minY: y - h / 2, maxY: y + h / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    const hx = Math.max(0.02, w / 2 - s);
    const hy = Math.max(0.02, h / 2 - s);
    const hz = Math.max(0.02, d / 2 - s);
    boxes.push({ minX: x - hx, maxX: x + hx, minY: y - hy, maxY: y + hy, minZ: z - hz, maxZ: z + hz });
  };
  for (const [w, h, d, x, y, z] of arena.walls ?? []) add(w, h, d, x, y, z);
  for (const p of arena.props ?? []) add(p.w, p.h, p.d, p.x, p.y, p.z);
  const geo = {
    arena,
    solids,
    boxes,
    half: (arena.floorSize ?? 60) / 2,
    maxRange: (arena.floorSize ?? 60) * Math.SQRT2 + TUNING.RANGE_MARGIN,
  };
  if (!arenaOverride) geoCache.set(arenaId, geo);
  return geo;
}

const insideBox = (b, x, y, z) =>
  x > b.minX && x < b.maxX && y > b.minY && y < b.maxY && z > b.minZ && z < b.maxZ;

// Does the segment O -> P pass through the box? (Slab method.) Boxes that contain
// either end are ignored so a shooter wedged against a stair edge isn't blinded.
function segmentBlockedBy(b, ox, oy, oz, px, py, pz) {
  if (insideBox(b, ox, oy, oz) || insideBox(b, px, py, pz)) return false;
  let tMin = 0;
  let tMax = 1;
  const axes = [
    [ox, px - ox, b.minX, b.maxX],
    [oy, py - oy, b.minY, b.maxY],
    [oz, pz - oz, b.minZ, b.maxZ],
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

// Same rules as the client's collision (player.js): the highest surface under you
// that you could step onto, or the floor.
function supportTop(solids, x, z, y, margin = STAND_MARGIN) {
  const feet = y - REST;
  let top = 0;
  for (const b of solids) {
    if (x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin) {
      if (b.maxY <= feet + STEP && b.maxY > top) top = b.maxY;
    }
  }
  return top;
}

// How far (horizontally) the capsule overlaps the nearest wall-like block.
function wallPenetration(solids, x, z, y) {
  const feet = y - REST;
  let depth = -Infinity;
  for (const b of solids) {
    if (b.maxY <= feet + STEP) continue; // low enough to stand on, not a wall right now
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const outside = Math.hypot(x - cx, z - cz);
    if (outside > 0 || x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) {
      depth = Math.max(depth, TUNING.RADIUS - outside);
    } else {
      // The centre itself is inside the block: depth is the radius plus how far in.
      const inward = Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
      depth = Math.max(depth, TUNING.RADIUS + inward);
    }
  }
  return depth;
}

// Does the flat (x/z) move from A to B cut through a wall-like block?
function moveCutsWall(solids, ax, az, ay, bx, bz, by) {
  const feet = Math.min(ay, by) - REST;
  const s = TUNING.TUNNEL_SHRINK;
  for (const b of solids) {
    if (b.maxY <= feet + STEP) continue;
    const minX = b.minX + s, maxX = b.maxX - s, minZ = b.minZ + s, maxZ = b.maxZ - s;
    if (minX >= maxX || minZ >= maxZ) continue;
    if (ax > minX && ax < maxX && az > minZ && az < maxZ) continue; // penetration check handles these
    if (bx > minX && bx < maxX && bz > minZ && bz < maxZ) continue;
    let tMin = 0;
    let tMax = 1;
    let hit = true;
    for (const [o, d, lo, hi] of [[ax, bx - ax, minX, maxX], [az, bz - az, minZ, maxZ]]) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { hit = false; break; }
      } else {
        let t1 = (lo - o) / d;
        let t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) { hit = false; break; }
      }
    }
    if (hit) return true;
  }
  return false;
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
    this.hist = [];           // recent { t, x, y, z, yaw, pitch, firing, hp }
    this.seq = 0;
    this.lastAppendT = 0;
    this.lastFiringAt = 0;
    this.bucket = { tokens: TUNING.BUCKET_CAP, at: now }; // bot hits only
    this.tap = { tokens: TUNING.TAP_CAP, at: now };
    // bots
    this.canDie = true;       // seen alive since its last accepted death
    this.wasDead = false;
    this.deadUntil = 0;
    this.contrib = new Map(); // attackerId -> { at }: who has been seen hitting it
    // humans
    this.hp = 0;
    this.alive = true;
    this.hpDirty = false;
    this.respawnAt = 0;
    this.pos = null;          // last accepted position { x, y, z }
    this.tp = 0;              // teleport counter: bumps on every server-ordered move
    this.graceUntil = 0;
    this.lastMoveAt = now;
    this.hBudget = TUNING.H_CAP_M;
    this.lastNearGroundAt = now;
    this.supports = [];       // recent { t, top }: the surfaces we've been over lately
    this.safe = null;         // last accepted position that was near the ground
    this.lastCorrectAt = 0;
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

// ------------------------------------------------------------------ the room

export class RoomGuard {
  /**
   * @param {{ arenaId: string, hostId: string, arena?: object, enforce?: boolean, onReject?: (key:string)=>void }} opts
   *   `arena` lets tests pass a hand-made arena. With `enforce: false` nothing is
   *   corrected or refused for movement/bot hits; it is only reported via onReject.
   */
  constructor({ arenaId, hostId, arena, enforce = true, onReject = () => {} }) {
    this.hostId = hostId;
    this.geo = arenaGeometry(arenaId, arena);
    this.enforce = enforce;
    this.report = onReject;
    this.actors = new Map();
    this.maxHp = DEFAULT_MAX_HP;
    this.respawnDelay = DEFAULT_RESPAWN_DELAY;
    this.healthSteal = 0;
    this.over = false;
    this.lastTickAt = Date.now();
    this.out = [];
  }

  // ---- outgoing messages ----

  #emit(to, msg, except) {
    this.out.push(except ? { to, msg, except } : { to, msg });
  }

  // A player's health changed: tell them, and tell everyone else straight away. (Other players
  // used to learn it only from that player's own "state" messages, which arrive late whenever
  // their browser slows its timers — e.g. when their window is covered by another.)
  #announceHealth(a) {
    this.#emit(a.id, { t: "hp", hp: a.hp });
    this.#emit("all", { t: "health", playerId: a.id, hp: a.hp }, a.id);
  }

  /** Collect (and clear) queued messages: [{ to: "all" | playerId, msg, except? }]. */
  drain() {
    const o = this.out;
    this.out = [];
    return o;
  }

  // ---- roster / host events ----

  addMember(id, now = Date.now()) {
    if (this.actors.has(id)) return;
    const a = new Actor(id, false, now);
    a.hp = this.maxHp;
    a.graceUntil = now + TUNING.GRACE_MS;
    this.actors.set(id, a);
  }

  removeMember(id) {
    this.actors.delete(id);
  }

  #applySettings(s) {
    if (Number.isFinite(s?.startingHealth)) this.maxHp = s.startingHealth;
    if (Number.isFinite(s?.respawnDelay)) this.respawnDelay = s.respawnDelay;
    if (Number.isFinite(s?.healthSteal)) this.healthSteal = s.healthSteal;
  }

  #freshLife(a, now) {
    a.hp = this.maxHp;
    a.alive = true;
    a.hpDirty = false;
    a.respawnAt = 0;
    a.graceUntil = now + TUNING.GRACE_MS;
    a.lastNearGroundAt = now;
    a.supports.length = 0;
  }

  onRestart(settings, now = Date.now()) {
    this.#applySettings(settings);
    this.over = false;
    for (const a of this.actors.values()) {
      if (a.isBot) {
        a.canDie = true;
        a.deadUntil = 0;
        a.contrib.clear();
      } else {
        this.#freshLife(a, now);
        this.#emit("all", { t: "health", playerId: a.id, hp: a.hp });
      }
    }
  }

  onSync(forId, settings, now = Date.now()) {
    this.#applySettings(settings);
    const a = this.actors.get(forId);
    if (a && !a.isBot) this.#freshLife(a, now); // a joiner is topped up to full health
  }

  onEnd() {
    this.over = true;
  }

  // ---- human positions ----

  #inBounds(x, z, y) {
    const lim = this.geo.half + TUNING.BOUNDS_MARGIN;
    return Math.abs(x) <= lim && Math.abs(z) <= lim && y >= TUNING.MIN_Y && y < 200;
  }

  // Is this position/jump plausible, given where the player last was? Returns a reason or null.
  #moveViolation(a, b, now) {
    if (!this.#inBounds(b.x, b.z, b.y)) return "bounds";
    if (now < a.graceUntil) {
      a.hBudget = TUNING.H_CAP_M;
      a.lastNearGroundAt = now;
      a.supports.length = 0;
      a.safe = { x: b.x, y: b.y, z: b.z };
      a.lastMoveAt = now;
      return null;
    }
    const elapsed = Math.min(1, Math.max(0, (now - a.lastMoveAt) / 1000));
    a.lastMoveAt = now;
    a.hBudget = Math.min(TUNING.H_CAP_M, a.hBudget + elapsed * TUNING.H_SPEED);

    const dh = Math.hypot(b.x - a.pos.x, b.z - a.pos.z);
    if (dh > a.hBudget) return "speed";

    const solids = this.geo.solids;
    if (wallPenetration(solids, b.x, b.z, b.y) > TUNING.PENETRATION_MAX) return "wall";
    if (dh <= TUNING.TUNNEL_MAX_CHORD && moveCutsWall(solids, a.pos.x, a.pos.z, a.pos.y, b.x, b.z, b.y)) return "wall";

    // Vertical. The browser moves 60 times a second but we only see 20 of those, so we can't
    // watch someone land — we judge by what the samples allow instead:
    //   height  : can't be higher than a jump above the highest surface lately underfoot
    //   airtime : must come back near the ground now and then (every hop of a bunny-hopper does)
    const top = supportTop(solids, b.x, b.z, b.y);
    // The client works out what you're standing on before it pushes you out of a wall, so hugging
    // a wall beside a low crate can briefly count the crate as ground. Allow for that when
    // judging how high you may be (but not when judging whether you're touching down).
    const reach = supportTop(solids, b.x, b.z, b.y, STAND_MARGIN + TUNING.RADIUS + 0.05);
    let ceilTop = Math.max(top, reach);
    for (const sup of a.supports) if (sup.top > ceilTop) ceilTop = sup.top;
    if (b.y > ceilTop + REST + TUNING.APEX_MAX) return "height";
    const airHeight = b.y - (top + REST);
    if (airHeight <= TUNING.NEAR_GROUND) {
      a.lastNearGroundAt = now;
      a.safe = { x: b.x, y: b.y, z: b.z };
    } else if (now - a.lastNearGroundAt > TUNING.AIR_MAX_MS) {
      return "airtime";
    }

    a.supports.push({ t: now, top: Math.max(top, reach) });
    while (a.supports.length && now - a.supports[0].t > TUNING.SUPPORT_MEMORY_MS) a.supports.shift();
    a.hBudget -= dh;
    return null;
  }

  /**
   * A human's state message. Returns what to relay to everyone else, plus an
   * optional `correct` to send back to the sender, or null if the sender is unknown.
   */
  onState(id, body, now = Date.now()) {
    const a = this.actors.get(id);
    if (!a || a.isBot) return null;
    let correct = null;

    if (!a.pos) {
      if (this.#inBounds(body.x, body.z, body.y)) {
        a.pos = { x: body.x, y: body.y, z: body.z };
        a.safe = { ...a.pos };
        a.lastMoveAt = now;
        a.lastNearGroundAt = now;
      } else {
        const sp = this.geo.arena.spawns?.[0] ?? { x: 0, y: REST, z: 0 };
        a.pos = { x: sp.x, y: sp.y, z: sp.z };
        this.report("move:bounds");
        correct = this.#teleport(a, a.pos, now);
      }
    } else if ((body.tp | 0) === a.tp) {
      // (A state tagged with an old teleport number was sent before the client heard about the move; ignore its position.)
      const why = this.#moveViolation(a, body, now);
      if (!why) {
        a.pos.x = body.x;
        a.pos.y = body.y;
        a.pos.z = body.z;
      } else {
        this.report("move:" + why);
        if (this.enforce) {
          // Speed/wall: back to where they last were. Height/airtime: somewhere they could really stand.
          const to = (why === "airtime" || why === "height") && a.safe ? a.safe : a.pos;
          if (now - a.lastCorrectAt >= TUNING.CORRECT_COOLDOWN_MS) correct = this.#teleport(a, to, now);
        } else {
          a.pos.x = body.x;
          a.pos.y = body.y;
          a.pos.z = body.z;
        }
      }
    }

    const firing = body.firing === true && a.alive;
    a.push({ t: now, x: a.pos.x, y: a.pos.y, z: a.pos.z, yaw: body.yaw, pitch: body.pitch ?? 0, firing, hp: a.hp });
    return { x: a.pos.x, y: a.pos.y, z: a.pos.z, hp: a.hp, firing, correct };
  }

  #teleport(a, p, now) {
    a.tp++;
    a.lastCorrectAt = now;
    a.pos = { x: p.x, y: p.y, z: p.z };
    a.lastNearGroundAt = now; // (the movement budget is deliberately NOT refilled here)
    a.supports.length = 0;
    a.safe = { x: p.x, y: p.y, z: p.z };
    a.hist.length = 0; // old positions must not be hittable
    return { x: p.x, y: p.y, z: p.z, tp: a.tp };
  }

  // ---- bots (positions come from the host) ----

  onBots(list, now = Date.now()) {
    for (const b of list) {
      let a = this.actors.get(b.id);
      if (!a) {
        let n = 0;
        for (const x of this.actors.values()) if (x.isBot) n++;
        if (n >= TUNING.MAX_BOTS) continue;
        a = new Actor(b.id, true, now);
        this.actors.set(b.id, a);
      }
      a.push({ t: now, x: b.x, y: b.y, z: b.z, yaw: b.yaw, pitch: b.pitch ?? 0, firing: b.firing === true, hp: b.hp });
      if (b.hp > 0) {
        if (a.wasDead) {
          a.contrib.clear(); // it respawned: fresh life
          a.deadUntil = 0;
        }
        a.wasDead = false;
        a.canDie = true;
      } else {
        a.wasDead = true;
      }
    }
  }

  #botAlive(a, now) {
    const s = a.last();
    return !!s && s.hp > 0 && a.deadUntil <= now;
  }

  // ---- the beam ----

  // Can a ray from (ox,oy,oz) along d reach `tgt` — near one of its recent positions, with a clear line?
  #rayVsTarget(ox, oy, oz, dx, dy, dz, tgt, now) {
    const T = TUNING;
    const { boxes, maxRange } = this.geo;
    let sawRange = false;
    let sawAim = false;

    for (let j = tgt.hist.length - 1; j >= 0; j--) {
      const t = tgt.hist[j];
      if (now - t.t > T.TARGET_WINDOW_MS) break;

      const dist = Math.hypot(t.x - ox, t.y - oy, t.z - oz);
      if (dist > maxRange) continue;
      sawRange = true;

      let miss = Infinity;
      for (const off of [-T.HALF_SEGMENT, 0, T.HALF_SEGMENT]) {
        const vx = t.x - ox;
        const vy = t.y + off - oy;
        const vz = t.z - oz;
        const along = vx * dx + vy * dy + vz * dz;
        const d2 = along <= 0 ? vx * vx + vy * vy + vz * vz : vx * vx + vy * vy + vz * vz - along * along;
        miss = Math.min(miss, Math.sqrt(Math.max(0, d2)));
      }
      if (miss > T.RADIUS + T.AIM_SLACK + T.AIM_SLACK_PER_M * dist) continue;
      sawAim = true;

      for (const off of [0, T.HALF_SEGMENT, -T.HALF_SEGMENT]) {
        let blocked = false;
        for (const b of boxes) {
          if (segmentBlockedBy(b, ox, oy, oz, t.x, t.y + off, t.z)) {
            blocked = true;
            break;
          }
        }
        if (!blocked) return { pass: true, dist };
      }
    }
    return { pass: false, reason: !sawRange ? "out-of-range" : !sawAim ? "off-target" : "blocked" };
  }

  // Whoever the shooter's beam is on right now: the nearest living opponent that passes the ray test.
  #beamTarget(shooter, s, now) {
    const ox = s.x;
    const oy = s.y + TUNING.EYE_HEIGHT;
    const oz = s.z;
    const [dx, dy, dz] = aimDirection(s.yaw, s.pitch);
    let best = null;
    let bestDist = Infinity;
    for (const c of this.actors.values()) {
      if (c === shooter) continue;
      if (c.isBot ? !this.#botAlive(c, now) : !c.alive) continue;
      const r = this.#rayVsTarget(ox, oy, oz, dx, dy, dz, c, now);
      if (r.pass && r.dist < bestDist) {
        best = c;
        bestDist = r.dist;
      }
    }
    return best;
  }

  // ---- damage, death, respawn ----

  /** Take health off a human. Handles death and the kill announcement. */
  applyDamage(victim, attackerId, damage, now = Date.now()) {
    if (this.over || victim.isBot || !victim.alive || !(damage > 0)) return;
    victim.hp = Math.max(0, victim.hp - damage);
    victim.hpDirty = true;
    if (victim.hp > 0) return;

    victim.alive = false;
    victim.hpDirty = false;
    victim.respawnAt = now + this.respawnDelay * 1000;
    this.#announceHealth(victim);
    this.#emit("all", { t: "kill", attackerId, victimId: victim.id });
  }

  #heal(a, amount) {
    if (!a.alive || !(amount > 0)) return;
    const hp = Math.min(this.maxHp, a.hp + amount);
    if (hp !== a.hp) {
      a.hp = hp;
      a.hpDirty = true;
    }
  }

  #respawn(a, now) {
    // The spawn point farthest from everyone still standing (with a little randomness).
    let best = this.geo.arena.spawns[0];
    let bestScore = -Infinity;
    for (const sp of this.geo.arena.spawns) {
      let minD = Infinity;
      for (const o of this.actors.values()) {
        if (o === a) continue;
        const pos = o.isBot ? o.last() : o.alive ? o.pos : null;
        if (!pos || (o.isBot && !this.#botAlive(o, now))) continue;
        minD = Math.min(minD, Math.hypot(pos.x - sp.x, pos.z - sp.z));
      }
      const score = (minD === Infinity ? 0 : minD) + Math.random() * 4;
      if (score > bestScore) {
        bestScore = score;
        best = sp;
      }
    }
    a.hp = this.maxHp;
    a.alive = true;
    a.hpDirty = false;
    a.respawnAt = 0;
    const tp = this.#teleport(a, best, now);
    a.hBudget = TUNING.H_CAP_M;
    a.lastMoveAt = now;
    this.#emit(a.id, { t: "respawn", x: best.x, y: best.y, z: best.z, yaw: best.yaw || 0, tp: tp.tp });
    this.#announceHealth(a);
  }

  /**
   * Run one step of the simulation (the relay calls this ~30 times a second):
   * respawns, beam damage, health updates. Returns the messages to send.
   */
  tick(now = Date.now()) {
    const dt = Math.min(TUNING.TICK_MAX_DT, Math.max(0, (now - this.lastTickAt) / 1000));
    this.lastTickAt = now;

    if (!this.over) {
      for (const a of this.actors.values()) {
        if (!a.isBot && !a.alive && now >= a.respawnAt) this.#respawn(a, now);
      }
      const damage = TUNING.PLAYER_DPS * dt;
      if (damage > 0) {
        for (const shooter of this.actors.values()) {
          if (shooter.isBot || !shooter.alive) continue;
          const s = shooter.last();
          if (!s || !s.firing || now - s.t > TUNING.FIRING_STALE_MS) continue;
          const target = this.#beamTarget(shooter, s, now);
          if (!target) continue;
          if (target.isBot) {
            target.contrib.set(shooter.id, { at: now });
            this.#emit(this.hostId, { t: "hit", targetId: target.id, attackerId: shooter.id, damage });
          } else {
            this.applyDamage(target, shooter.id, damage, now);
          }
          this.#heal(shooter, (damage * this.healthSteal) / 100);
        }
      }
    }

    for (const a of this.actors.values()) {
      if (!a.isBot && a.hpDirty) {
        a.hpDirty = false;
        this.#announceHealth(a);
      }
    }
    return this.drain();
  }

  // ---- bots shooting humans / bot deaths ----

  // Can a bot's shot (relayed by the host) really have landed? Aim + line of sight over the
  // last moments, and a damage rate bots can't exceed. (Human shots never come through
  // here — the server detects those itself in tick().)
  #canHit(atk, tgt, now) {
    const T = TUNING;
    let saw = { range: false, aim: false };
    for (let i = atk.hist.length - 1; i >= 0; i--) {
      const a = atk.hist[i];
      if (now - a.t > T.ATTACKER_WINDOW_MS) break;
      const [dx, dy, dz] = aimDirection(a.yaw, a.pitch);
      const r = this.#rayVsTarget(a.x, a.y + T.EYE_HEIGHT, a.z, dx, dy, dz, tgt, now);
      if (r.pass) return { pass: true };
      if (r.reason !== "out-of-range") saw.range = true;
      if (r.reason === "blocked") saw.aim = true;
    }
    return { pass: false, reason: !saw.range ? "out-of-range" : !saw.aim ? "off-target" : "blocked" };
  }

  /**
   * Validate one `hit` message from the host about a bot's shot.
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
    if (tgt.isBot) return reject("bad-target"); // a bot's health lives on the host

    const a = atk.last();
    const t = tgt.last();
    if (!a || now - a.t > TUNING.MAX_STATE_AGE_MS) return reject("attacker-no-state");
    if (!t && !tgt.pos) return reject("target-no-state");
    if (atk.isBot ? !this.#botAlive(atk, now) : !atk.alive) return reject("attacker-dead");
    if (!tgt.alive) return reject("target-dead");
    if (t && now - t.t > TUNING.MAX_STATE_AGE_MS) return reject("target-no-state");

    const geometry = this.#canHit(atk, tgt, now);
    if (!geometry.pass) return reject(geometry.reason);

    const firing = now - atk.lastFiringAt <= TUNING.FIRING_GRACE_MS;
    const damage = firing
      ? takeFrom(atk.bucket, now, TUNING.PLAYER_DPS * TUNING.DPS_SLACK, TUNING.BUCKET_CAP, hit.damage)
      : takeFrom(atk.tap, now, TUNING.TAP_REFILL_PER_SEC, TUNING.TAP_CAP, hit.damage);
    if (damage <= 0) return reject(firing ? "damage-rate" : "not-firing");
    return { ok: true, damage };
  }

  /** Apply a validated bot hit to a human's health. */
  hurt(targetId, attackerId, damage, now = Date.now()) {
    const v = this.actors.get(targetId);
    if (v && !v.isBot) this.applyDamage(v, attackerId, damage, now);
  }

  /**
   * The host announcing that one of its bots died. Humans' deaths are never
   * announced by clients — the server announces those itself.
   * @returns {{ok:true, attackerId:string} | {ok:false, reason:string}}
   */
  checkKill(senderId, senderIsHost, kill, now = Date.now()) {
    if (this.over) return reject("match-over");
    const victim = this.actors.get(kill.victimId);
    if (!victim) return reject("unknown-victim");
    if (!victim.isBot) return reject("server-decides");
    if (!senderIsHost) return reject("bad-victim");
    if (!victim.canDie) return reject("bot-not-alive");

    const claimed = this.actors.get(kill.attackerId);
    if (!claimed || claimed === victim) return reject("unknown-attacker");
    // The host's own shots and bot-vs-bot fights are invisible to the relay, so the host's
    // word is enough for those. A remote player only gets credit if seen shooting it.
    if (!claimed.isBot && claimed.id !== this.hostId) {
      const c = victim.contrib.get(claimed.id);
      if (!c || now - c.at > TUNING.CREDIT_WINDOW_MS) return reject("no-credit");
    }
    victim.canDie = false;
    victim.contrib.clear();
    victim.deadUntil = now + Math.max(0, this.respawnDelay * 1000 - TUNING.RESPAWN_SLACK_MS);
    return { ok: true, attackerId: claimed.id };
  }
}
