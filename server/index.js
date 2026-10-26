// ArenaDuels relay server.
// Plain WebSocket relay — no WebRTC, no STUN/TURN, no NAT traversal needed.
// Every client just makes one normal outbound WebSocket connection to this
// server, and the server relays game messages between everyone in the same
// room. Deploy this somewhere that stays running — see server/README.md.
//
// Hardening (the server never trusts a client):
//   - hard cap on message size, per-connection rate limit, per-IP connection cap
//   - every message must be a JSON object with a known type; anything else is dropped
//   - relayed messages are rebuilt from validated fields (nothing is forwarded verbatim)
//   - clients can't impersonate each other or send host-only messages
//   - one bad packet can never throw out of a handler and take the process down
//   - hits and kills are checked against the server's own record of positions, health and
//     line of sight (anticheat.js); damage is clamped and kill credit is decided server-side

import { WebSocketServer } from "ws";
import http from "http";
import crypto from "crypto";
import { promisify } from "node:util";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { cleanRelay, HOST_ONLY, isBotId, isValidArenaId, isValidCode, MAX_MESSAGE_BYTES } from "./validate.js";
import { RoomGuard } from "./anticheat.js";

const PORT = process.env.PORT || 8080;
const scrypt = promisify(crypto.scrypt);
const ACCOUNT_NAME_WORDS = [
  "Blaze", "Nova", "Vortex", "Cipher", "Nomad", "Rogue", "Havoc", "Ember",
  "Frost", "Glitch", "Raptor", "Viper", "Comet", "Shadow", "Quartz", "Onyx",
  "Zenith", "Drift", "Static", "Volt", "Surge", "Nebula", "Vector", "Pulse",
  "Falcon", "Talon", "Wraith", "Specter", "Cinder", "Blitz", "Storm", "Tempest",
  "Rift", "Echo", "Vertex", "Prism", "Flux", "Turbo", "Rocket", "Meteor",
  "Aurora", "Eclipse", "Lunar", "Solar", "Photon", "Quantum", "Cobalt", "Chrome",
  "Crimson", "Scarlet", "Amber", "Jade", "Obsidian", "Ivory", "Rebel", "Maverick",
  "Outlaw", "Ranger", "Hunter", "Phantom", "Titan", "Bolt", "Spark", "Fury",
  "Venom", "Reaper", "Rocketeer"
];
let firebaseAuth = null;
let firestore = null;
try {
  initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID || "arenaduels-7dc31" });
  firebaseAuth = getAuth();
  firestore = getFirestore();
  console.log("[auth] Firebase Admin SDK initialized");
} catch (err) {
  console.error("[auth] Firebase Admin SDK unavailable; account endpoints will return 503:", err.message);
}
const authAttempts = new Map();
const authRandomName = () => ACCOUNT_NAME_WORDS[crypto.randomInt(ACCOUNT_NAME_WORDS.length)] + crypto.randomInt(10, 100);
const usernameKey = (name) => name.toLowerCase();
function authRateAllowed(ip) {
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    authAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 12) return false;
  entry.count++;
  return true;
}
function authJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "https://arenaduels.github.io",
    "Vary": "Origin"
  });
  res.end(JSON.stringify(payload));
}
async function readJsonBody(req, maxBytes = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function validAccountUsername(name) {
  return typeof name === "string" && name.length <= 16 &&
    new RegExp("^(?:" + ACCOUNT_NAME_WORDS.join("|") + ")\\d{2}$", "i").test(name);
}
async function passwordHash(password, salt) {
  return (await scrypt(password, salt, 64)).toString("hex");
}
async function handleAuthHttp(req, res, url) {
  const origin = String(req.headers.origin || "").replace(/\/+$/, "").toLowerCase();
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return authJson(res, 403, { error: "Origin not allowed." });
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "https://arenaduels.github.io",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    });
    return res.end();
  }
  if (!url.pathname.startsWith("/api/auth/")) return false;
  if (!firebaseAuth || !firestore) return authJson(res, 503, { error: "Account services are not configured yet." });
  const ip = clientIp(req);
  if (!authRateAllowed(ip)) return authJson(res, 429, { error: "Too many account requests. Try again in a minute." });

  if (req.method === "GET" && url.pathname === "/api/auth/random-name") {
    for (let i = 0; i < 30; i++) {
      const username = authRandomName();
      const doc = await firestore.collection("arenaUsernames").doc(usernameKey(username)).get();
      if (!doc.exists) return authJson(res, 200, { username });
    }
    return authJson(res, 503, { error: "Could not find an available name. Try again." });
  }
  if (req.method !== "POST") return authJson(res, 405, { error: "Method not allowed." });

  let body;
  try { body = await readJsonBody(req); }
  catch { return authJson(res, 400, { error: "Invalid request body." }); }
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!validAccountUsername(username)) return authJson(res, 400, { error: "Choose a generated username using the dice button." });
  if (password.length < 8 || password.length > 128) return authJson(res, 400, { error: "Password must be 8–128 characters." });

  try {
    const key = usernameKey(username);
    const usernameRef = firestore.collection("arenaUsernames").doc(key);
    if (url.pathname === "/api/auth/register") {
      const uid = crypto.randomUUID().replace(/-/g, "");
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = await passwordHash(password, salt);
      await firestore.runTransaction(async (tx) => {
        const existing = await tx.get(usernameRef);
        if (existing.exists) throw Object.assign(new Error("That generated username is taken. Roll a new one."), { statusCode: 409 });
        const accountRef = firestore.collection("arenaAccounts").doc(uid);
        tx.create(usernameRef, { uid, username, salt, passwordHash: hash, createdAt: FieldValue.serverTimestamp() });
        tx.create(accountRef, { uid, username, createdAt: FieldValue.serverTimestamp(), wins: 0, losses: 0, matches: 0 });
      });
      const token = await firebaseAuth.createCustomToken(uid, { username });
      return authJson(res, 201, { token, username });
    }
    if (url.pathname === "/api/auth/login") {
      const snap = await usernameRef.get();
      if (!snap.exists) return authJson(res, 401, { error: "Username or password is incorrect." });
      const record = snap.data();
      const candidate = Buffer.from(await passwordHash(password, record.salt), "hex");
      const actual = Buffer.from(record.passwordHash, "hex");
      if (candidate.length !== actual.length || !crypto.timingSafeEqual(candidate, actual)) {
        return authJson(res, 401, { error: "Username or password is incorrect." });
      }
      const token = await firebaseAuth.createCustomToken(record.uid, { username: record.username });
      return authJson(res, 200, { token, username: record.username });
    }
    return authJson(res, 404, { error: "Unknown account endpoint." });
  } catch (err) {
    if (err.statusCode) return authJson(res, err.statusCode, { error: err.message });
    console.error("[auth] request failed:", err.message);
    return authJson(res, 500, { error: "Account request failed. Try again later." });
  }
}
const MAX_PLAYERS = 4;
const MAX_ROOMS = 500;
const MAX_CONNECTIONS = 1000;
const MAX_CONNECTIONS_PER_IP = 8;
const RATE_CAPACITY = 200;       // burst allowance (messages)
const RATE_PER_SEC = 150;        // sustained allowance (a busy player sends ~100/s)
const RATE_STRIKES_TO_KICK = 300; // dropped messages before the connection is closed
const NO_ROOM_TIMEOUT_MS = 60_000;
const MAX_JOIN_FAILS_PER_MIN = 20;

// Only this site may connect from a browser. To allow more (e.g. local testing),
// set ALLOWED_ORIGINS="https://arenaduels.github.io,http://localhost:5500" on the host.
// Note: non-browser clients can fake the Origin header, so this stops other
// websites from using your server, it isn't authentication.
const DEFAULT_ORIGINS = ["https://arenaduels.github.io"];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((s) => s.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean);
if (ALLOWED_ORIGINS.length === 0) ALLOWED_ORIGINS.push(...DEFAULT_ORIGINS);
const TRUST_PROXY = process.env.TRUST_PROXY !== "0"; // Render/Railway/Fly sit behind a proxy

// Hit/kill validation (see anticheat.js):
//   "enforce" (default) — invalid hits and kills are dropped, damage is clamped
//   "log"               — nothing is dropped, rejections are only logged (use this
//                         to check for false positives on real matches)
//   "off"               — no validation
const ANTICHEAT = ["enforce", "log", "off"].includes(process.env.ANTICHEAT) ? process.env.ANTICHEAT : "enforce";
const rejectCounts = new Map(); // reason -> count since the last report

// A tiny HTTP server so hosts like Render have something to health-check.
const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname.startsWith("/api/auth/") || req.method === "OPTIONS") {
    try {
      await handleAuthHttp(req, res, url);
    } catch (err) {
      console.error("[http] request failed:", err.message);
      if (!res.writableEnded) authJson(res, 500, { error: "Server error." });
    }
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" });
  res.end("ArenaDuels relay server is running.\\n");
});

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: MAX_MESSAGE_BYTES, // oversized frames are rejected before being buffered
  perMessageDeflate: false,      // no compression => no decompression bombs
  verifyClient: ({ origin }) => typeof origin === "string" && ALLOWED_ORIGINS.includes(origin.toLowerCase()),
});
wss.on("error", (err) => console.error("wss error:", err.message));

// code -> { hostId, arenaId, isPublic, members: Map<id, ws> }
const rooms = new Map();
const connectionsByIp = new Map();
const joinFailsByIp = new Map(); // ip -> { count, resetAt }

const randomCode = () => String(crypto.randomInt(100000, 1000000));
const randomId = () => crypto.randomBytes(6).toString("hex"); // 12 chars, unguessable

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd) return fwd.split(",").pop().trim().slice(0, 64);
  }
  return req.socket.remoteAddress || "unknown";
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function takeToken(ws) {
  const now = Date.now();
  ws.tokens = Math.min(RATE_CAPACITY, ws.tokens + ((now - ws.lastRefill) / 1000) * RATE_PER_SEC);
  ws.lastRefill = now;
  if (ws.tokens < 1) return false;
  ws.tokens -= 1;
  return true;
}

function joinAllowed(ip) {
  const now = Date.now();
  const e = joinFailsByIp.get(ip);
  if (!e || e.resetAt < now) return true;
  return e.count < MAX_JOIN_FAILS_PER_MIN;
}
function noteJoinFail(ip) {
  const now = Date.now();
  const e = joinFailsByIp.get(ip);
  if (!e || e.resetAt < now) joinFailsByIp.set(ip, { count: 1, resetAt: now + 60_000 });
  else e.count++;
}

wss.on("connection", (ws, req) => {
  const ip = clientIp(req);
  const open = connectionsByIp.get(ip) || 0;
  if (wss.clients.size > MAX_CONNECTIONS || open >= MAX_CONNECTIONS_PER_IP) {
    ws.close(1013, "Too many connections");
    return;
  }
  connectionsByIp.set(ip, open + 1);

  ws.id = randomId();
  ws.room = null;
  ws.ip = ip;
  ws.tokens = RATE_CAPACITY;
  ws.lastRefill = Date.now();
  ws.strikes = 0;
  ws.alive = true;

  // Someone who connects and never joins/creates a room doesn't get to sit here forever.
  const idleTimer = setTimeout(() => {
    if (!ws.room && ws.listing !== true) ws.close(1008, "Idle");
  }, NO_ROOM_TIMEOUT_MS);

  ws.on("error", () => {}); // e.g. oversized frame — the socket is closed for us; just don't crash
  ws.on("pong", () => { ws.alive = true; });

  ws.on("message", (raw, isBinary) => {
    try {
      handleMessage(ws, raw, isBinary);
    } catch (err) {
      console.error("message handler error:", err.message); // a bad packet must never kill the server
    }
  });

  ws.on("close", () => {
    clearTimeout(idleTimer);
    const n = (connectionsByIp.get(ip) || 1) - 1;
    if (n <= 0) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, n);

    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    room.members.delete(ws.id);
    room.guard.removeMember(ws.id);
    for (const peer of room.members.values()) send(peer, { t: "peer_left", id: ws.id });
    if (room.members.size === 0) rooms.delete(ws.room);
    // If the host left, the match is over for everyone; clients already treat that via peer_left.
  });
});

function handleMessage(ws, raw, isBinary) {
  if (isBinary) return;

  if (!takeToken(ws)) {
    if (++ws.strikes >= RATE_STRIKES_TO_KICK) ws.close(1008, "Rate limit");
    return;
  }

  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  // JSON.parse("null") / "5" / "[]" are valid JSON — they must not reach msg.t below.
  if (msg === null || typeof msg !== "object" || Array.isArray(msg) || typeof msg.t !== "string") return;

  switch (msg.t) {
    case "create_room": {
      if (ws.room || rooms.size >= MAX_ROOMS || !isValidArenaId(msg.arenaId)) return;
      let code = randomCode();
      for (let tries = 0; rooms.has(code) && tries < 10; tries++) code = randomCode();
      if (rooms.has(code)) return;
      rooms.set(code, {
        hostId: ws.id,
        arenaId: msg.arenaId,
        isPublic: msg.isPublic === true,
        members: new Map([[ws.id, ws]]),
        guard: new RoomGuard({ arenaId: msg.arenaId, hostId: ws.id }),
      });
      rooms.get(code).guard.addMember(ws.id);
      ws.room = code;
      send(ws, { t: "room_created", code, id: ws.id });
      return;
    }

    case "list_lobbies": {
      ws.listing = true;
      const lobbies = [];
      for (const [code, room] of rooms) {
        if (room.isPublic && room.members.size < MAX_PLAYERS) {
          lobbies.push({ code, arenaId: room.arenaId, playerCount: room.members.size, maxPlayers: MAX_PLAYERS });
          if (lobbies.length >= 50) break;
        }
      }
      send(ws, { t: "lobby_list", lobbies });
      return;
    }

    case "join_room": {
      if (ws.room) return;
      if (!joinAllowed(ws.ip)) {
        send(ws, { t: "join_error", error: "Too many attempts. Wait a minute and try again." });
        return;
      }
      const room = isValidCode(msg.code) ? rooms.get(msg.code) : undefined;
      if (!room) {
        noteJoinFail(ws.ip);
        send(ws, { t: "join_error", error: "Room not found." });
        return;
      }
      if (room.members.size >= MAX_PLAYERS) {
        send(ws, { t: "join_error", error: "Room is full (4/4)." });
        return;
      }
      const peerIds = [...room.members.keys()];
      room.members.set(ws.id, ws);
      room.guard.addMember(ws.id);
      ws.room = msg.code;
      send(ws, {
        t: "room_joined",
        code: msg.code,
        id: ws.id,
        arenaId: room.arenaId,
        hostId: room.hostId,
        peers: peerIds,
      });
      for (const [id, peer] of room.members) {
        if (id !== ws.id) send(peer, { t: "peer_joined", id: ws.id });
      }
      return;
    }

    default: {
      // Gameplay message — only relayed for someone who is in a room.
      const room = ws.room && rooms.get(ws.room);
      if (!room) return;

      // Rebuild the message from validated fields; unknown types come back null.
      const clean = cleanRelay(msg);
      if (!clean) return;

      const isHost = ws.id === room.hostId;
      if (HOST_ONLY.has(clean.t) && !isHost) return;

      // Nobody gets to claim to be someone else.
      if (clean.t === "hit") {
        const asBot = isHost && isBotId(clean.attackerId);
        if (clean.attackerId !== ws.id && !asBot) return;
      } else if (clean.t === "kill") {
        const asBot = isHost && isBotId(clean.victimId) ;
        if (clean.victimId !== ws.id && !asBot) return;
      }

      // Plausibility checks against the server's own picture of the match.
      if (!screen(room.guard, ws, isHost, clean)) return;

      // "from" is stamped by the server and always wins; clients can't set it.
      const out = JSON.stringify({ ...clean, from: ws.id });
      for (const [id, peer] of room.members) {
        if (id !== ws.id && peer.readyState === peer.OPEN) peer.send(out);
      }
    }
  }
}

// Feeds the room's guard and decides whether a gameplay message may be relayed.
// May rewrite `clean` in place (hit damage is clamped, kill credit is the server's).
function screen(guard, ws, isHost, clean) {
  if (ANTICHEAT === "off") return true;
  const now = Date.now();
  switch (clean.t) {
    case "state": guard.onState(ws.id, clean, now); return true;
    case "bots": guard.onBots(clean.bots, now); return true;
    case "restart": guard.onRestart(clean.settings); return true;
    case "sync": guard.onSync(clean.forId, clean.settings); return true;
    case "end": guard.onEnd(); return true;
    case "hit": {
      const v = guard.checkHit(ws.id, isHost, clean, now);
      if (v.ok) {
        if (ANTICHEAT === "enforce") clean.damage = v.damage;
        return true;
      }
      noteReject("hit:" + v.reason);
      return ANTICHEAT !== "enforce";
    }
    case "kill": {
      const v = guard.checkKill(ws.id, isHost, clean, now);
      if (v.ok) {
        if (ANTICHEAT === "enforce") clean.attackerId = v.attackerId;
        return true;
      }
      noteReject("kill:" + v.reason);
      return ANTICHEAT !== "enforce";
    }
    default: return true;
  }
}

function noteReject(key) {
  rejectCounts.set(key, (rejectCounts.get(key) || 0) + 1);
}

// Once a minute, say what the validation turned away (silent when nothing happened).
setInterval(() => {
  if (rejectCounts.size === 0) return;
  const parts = [...rejectCounts].map(([k, n]) => `${k}=${n}`).join(" ");
  console.log(`[anticheat:${ANTICHEAT}] last minute: ${parts}`);
  rejectCounts.clear();
}, 60_000).unref();

// Drop connections that stopped answering pings (half-open sockets pile up otherwise).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [ip, e] of joinFailsByIp) if (e.resetAt < now) joinFailsByIp.delete(ip);
  for (const [ip, e] of authAttempts) if (e.resetAt < now) authAttempts.delete(ip);
}, 30_000).unref();

httpServer.listen(PORT, () => {
  console.log(`ArenaDuels relay server listening on port ${PORT}`);
});
