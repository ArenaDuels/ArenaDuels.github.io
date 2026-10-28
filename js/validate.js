// Network-message validation, shared by the relay server and the browser.
//
// NOTE: server/validate.js is an identical copy of this file (the server is
// deployed on its own with "Root Directory: server", so it can't import from
// ../js). If you change one, copy it over the other.
//
// Rule of thumb: nothing that arrives over the network is used until it has
// been through cleanRelay() (gameplay messages) or one of the helpers below.

export const ARENA_IDS = ["classic", "foundry", "ruins", "neon", "mansion"];
export const MAX_NAME_LEN = 16;
export const MAX_BOTS = 8;
export const MAX_SNAP_ENTRIES = 16;
export const MAX_HIT_DAMAGE = 50; // a full second of beam is 40; allow a little slack for lag spikes
export const MAX_MESSAGE_BYTES = 8192;

// Gameplay messages only the host may send.
export const HOST_ONLY = new Set(["end", "restart", "sync", "clock", "bots"]);

// Messages that only the SERVER may send (it is the authority on health, deaths and
// respawns). The relay drops them if a player sends one, and the browser ignores them
// unless they came from SERVER_ID. (Real player ids are random hex, never "server".)
export const SERVER_ID = "server";
export const SERVER_ONLY = new Set(["hp", "health", "respawn", "correct"]);

const ID_RE = /^[A-Za-z0-9_-]{1,16}$/;
const BOT_ID_RE = /^bot-\d{1,2}$/;
const CODE_RE = /^\d{6}$/;
const END_REASONS = new Set(["score", "time"]);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clampNum = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

export const isValidId = (v) => typeof v === "string" && ID_RE.test(v);
export const isBotId = (v) => typeof v === "string" && BOT_ID_RE.test(v);
export const isValidCode = (v) => typeof v === "string" && CODE_RE.test(v);
export const isValidArenaId = (v) => typeof v === "string" && ARENA_IDS.includes(v);

/** Printable, single-line, length-limited name. Never returns HTML-significant surprises
 *  (the game also only ever renders names with textContent / canvas, never innerHTML). */
export function cleanName(v, fallback = "Player") {
  if (typeof v !== "string") return fallback;
  const s = v
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(s).slice(0, MAX_NAME_LEN).join("") || fallback;
}

function cleanLook(v) {
  if (!isObj(v)) return undefined;
  const color = v.color === null || typeof v.color === "number" ? v.color : null;
  const short = (s) => (typeof s === "string" && s.length <= 24 ? s : undefined);
  return { color: color !== null && !Number.isFinite(color) ? null : color, pattern: short(v.pattern), accessory: short(v.accessory) };
}

function cleanSettings(v) {
  if (!isObj(v)) return null;
  const out = {};
  for (const [key, lo, hi] of [
    ["timeLimit", 0, 60],
    ["scoreLimit", 0, 200],
    ["startingHealth", 10, 500],
    ["healthSteal", 0, 100],
    ["respawnDelay", 0, 30],
  ]) {
    const n = clampNum(v[key], lo, hi);
    if (n !== null) out[key] = n; // missing/invalid keys fall back to defaults in sanitizeSettings()
  }
  return out;
}

function cleanSnap(v) {
  if (!isObj(v) || !Array.isArray(v.entries) || v.entries.length > MAX_SNAP_ENTRIES) return null;
  const entries = [];
  for (const e of v.entries) {
    if (!isObj(e) || !isValidId(e.id)) return null;
    entries.push({
      id: e.id,
      name: cleanName(e.name),
      kills: clampNum(e.kills, 0, 100000) ?? 0,
      deaths: clampNum(e.deaths, 0, 100000) ?? 0,
    });
  }
  return {
    entries,
    remaining: clampNum(v.remaining, -1, 86400) ?? -1,
    over: v.over === true,
    reason: END_REASONS.has(v.reason) ? v.reason : null,
  };
}

export function cleanBody(v) {
  if (!isObj(v)) return null;
  const x = clampNum(v.x, -2000, 2000);
  const y = clampNum(v.y, -2000, 2000);
  const z = clampNum(v.z, -2000, 2000);
  const yaw = clampNum(v.yaw, -1e5, 1e5);
  const pitch = v.pitch === undefined ? 0 : clampNum(v.pitch, -1e5, 1e5);
  const hp = clampNum(v.hp, -1000, 1000);
  if (x === null || y === null || z === null || yaw === null || pitch === null || hp === null) return null;
  return { x, y, z, yaw, pitch, hp, firing: v.firing === true };
}

/**
 * Validate one gameplay message. Returns a brand-new object containing only
 * known, range-checked fields — or null if the message should be dropped.
 * (Identity checks such as "is this sender allowed to claim this attacker?"
 * are done by the caller, who knows who the sender is.)
 */
export function cleanRelay(msg) {
  if (!isObj(msg) || typeof msg.t !== "string") return null;
  switch (msg.t) {
    case "hello": {
      const out = { t: "hello", name: cleanName(msg.name) };
      const look = cleanLook(msg.look);
      if (look) out.look = look;
      return out;
    }
    case "state": {
      const body = cleanBody(msg);
      // tp: the number of the last server-ordered move this player has heard about
      return body && { t: "state", ...body, tp: Math.floor(clampNum(msg.tp, 0, 1e9) ?? 0) };
    }
    // ---- server -> player only (see SERVER_ONLY) ----
    case "hp": {
      const hp = clampNum(msg.hp, 0, 1000);
      return hp === null ? null : { t: "hp", hp };
    }
    case "health": {
      // Someone's health, announced to everybody the moment it changes.
      const hp = clampNum(msg.hp, 0, 1000);
      return hp === null || !isValidId(msg.playerId) ? null : { t: "health", playerId: msg.playerId, hp };
    }
    case "respawn": {
      const x = clampNum(msg.x, -2000, 2000);
      const y = clampNum(msg.y, -2000, 2000);
      const z = clampNum(msg.z, -2000, 2000);
      const yaw = clampNum(msg.yaw, -1e5, 1e5);
      const tp = clampNum(msg.tp, 0, 1e9);
      if (x === null || y === null || z === null || yaw === null || tp === null) return null;
      return { t: "respawn", x, y, z, yaw, tp: Math.floor(tp) };
    }
    case "correct": {
      const x = clampNum(msg.x, -2000, 2000);
      const y = clampNum(msg.y, -2000, 2000);
      const z = clampNum(msg.z, -2000, 2000);
      const tp = clampNum(msg.tp, 0, 1e9);
      if (x === null || y === null || z === null || tp === null) return null;
      return { t: "correct", x, y, z, tp: Math.floor(tp) };
    }
    case "hit": {
      const damage = msg.damage; // out-of-range damage is rejected outright, not clamped
      if (!isValidId(msg.targetId) || !isValidId(msg.attackerId)) return null;
      if (typeof damage !== "number" || !Number.isFinite(damage) || damage <= 0 || damage > MAX_HIT_DAMAGE) return null;
      return { t: "hit", targetId: msg.targetId, attackerId: msg.attackerId, damage };
    }
    case "kill":
      if (!isValidId(msg.attackerId) || !isValidId(msg.victimId)) return null;
      return { t: "kill", attackerId: msg.attackerId, victimId: msg.victimId };
    case "end": {
      const snap = cleanSnap(msg.snap);
      if (!END_REASONS.has(msg.reason) || !snap) return null;
      return { t: "end", reason: msg.reason, snap };
    }
    case "restart": {
      const settings = cleanSettings(msg.settings);
      return settings && { t: "restart", settings };
    }
    case "sync": {
      const settings = cleanSettings(msg.settings);
      const snap = cleanSnap(msg.snap);
      if (!isValidId(msg.forId) || !settings || !snap) return null;
      return { t: "sync", forId: msg.forId, settings, snap };
    }
    case "clock": {
      const remaining = clampNum(msg.remaining, -1, 86400);
      return remaining === null ? null : { t: "clock", remaining };
    }
    case "bots": {
      if (!Array.isArray(msg.bots) || msg.bots.length > MAX_BOTS) return null;
      const bots = [];
      for (const b of msg.bots) {
        const body = cleanBody(b);
        if (!body || !isBotId(b.id)) return null;
        bots.push({ id: b.id, name: cleanName(b.name, "Bot"), ...body });
      }
      return { t: "bots", bots };
    }
    default:
      return null; // unknown type — never relayed, never acted on
  }
}

/** Validate the lobby list the server sends back. Bad rows are skipped. */
export function cleanLobbies(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const l of list.slice(0, 50)) {
    if (!isObj(l) || !isValidCode(l.code) || !isValidArenaId(l.arenaId)) continue;
    const playerCount = clampNum(l.playerCount, 0, 4);
    const maxPlayers = clampNum(l.maxPlayers, 1, 4);
    if (playerCount === null || maxPlayers === null) continue;
    out.push({ code: l.code, arenaId: l.arenaId, playerCount: Math.round(playerCount), maxPlayers: Math.round(maxPlayers) });
  }
  return out;
}
