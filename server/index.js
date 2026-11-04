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
import { ARENA_IDS, cleanRelay, HOST_ONLY, isBotId, isValidArenaId, isValidCode, MAX_MESSAGE_BYTES, SERVER_ID, SERVER_ONLY } from "./validate.js";
import { RoomGuard } from "./anticheat.js";
import { canonicalName, isLegacyName, randomName } from "./names.js";
import { createNameTickets } from "./nameTickets.js";
import { Matchmaker, MATCHMAKING } from "./matchmaker.js";
import { MODE_IDS, getMode, isValidModeId } from "./modes.js";

const PORT = process.env.PORT || 8080;
const scrypt = promisify(crypto.scrypt);
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
// Account names come only from the generator in names.js, and only with a ticket the server
// signed when it offered that name (nameTickets.js) — so nobody can register a name of their own.
const authRandomName = () => randomName(crypto.randomInt);
const nameTickets = createNameTickets({ secret: process.env.NAME_TICKET_SECRET });
if (nameTickets.temporary) {
  console.warn("[auth] NAME_TICKET_SECRET is not set: using a temporary key (name offers still open when the server restarts will stop working).");
}
// Rolling for a name is limited so nobody can sit there rolling thousands of times to cherry-pick one.
const NAME_ROLLS_PER_WINDOW = 60;
const NAME_ROLL_WINDOW_MS = 10 * 60_000;
const nameRolls = new Map();
function nameRollAllowed(ip) {
  const now = Date.now();
  const entry = nameRolls.get(ip);
  if (!entry || entry.resetAt <= now) {
    nameRolls.set(ip, { count: 1, resetAt: now + NAME_ROLL_WINDOW_MS });
    return true;
  }
  if (entry.count >= NAME_ROLLS_PER_WINDOW) return false;
  entry.count++;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of nameRolls) if (entry.resetAt <= now) nameRolls.delete(ip);
}, 5 * 60_000).unref();
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
// The account name in its proper capitals if it is a name this game can have: one the generator
// can produce, or (to sign in) an old-style name from before the bigger name list.
function knownAccountName(name, { allowLegacy }) {
  const generated = canonicalName(name);
  if (generated) return generated;
  return allowLegacy && isLegacyName(name) ? name : null;
}
async function passwordHash(password, salt) {
  return (await scrypt(password, salt, 64)).toString("hex");
}
async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) throw Object.assign(new Error("Account verification is not configured on the server."), { statusCode: 503 });
  if (typeof token !== "string" || !token || token.length > 2048) {
    throw Object.assign(new Error("Please complete the human verification first."), { statusCode: 400 });
  }
  const form = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "unknown") form.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("Cloudflare verification service returned HTTP " + response.status);
  const result = await response.json();
  if (!result.success || result.hostname !== "arenaduels.github.io") {
    throw Object.assign(new Error("Human verification failed. Please try again."), { statusCode: 400 });
  }
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
    if (!nameRollAllowed(ip)) return authJson(res, 429, { error: "You've rolled a lot of names. Wait a few minutes and try again." });
    try {
      for (let i = 0; i < 30; i++) {
        const username = authRandomName();
        const doc = await firestore.collection("arenaUsernames").doc(usernameKey(username)).get();
        if (!doc.exists) {
          return authJson(res, 200, { username, nameTicket: nameTickets.issue(username), expiresInSeconds: nameTickets.ttlSeconds });
        }
      }
      return authJson(res, 503, { error: "Could not find an available name. Try again." });
    } catch (err) {
      console.error("[auth] name roll failed:", err.message);
      return authJson(res, 500, { error: "Could not generate a name. Try again later." });
    }
  }
  if (req.method !== "POST") return authJson(res, 405, { error: "Method not allowed." });

  let body;
  try { body = await readJsonBody(req); }
  catch { return authJson(res, 400, { error: "Invalid request body." }); }
  const password = typeof body.password === "string" ? body.password : "";
  const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
  const registering = url.pathname === "/api/auth/register";
  const username = knownAccountName(typeof body.username === "string" ? body.username : "", { allowLegacy: !registering });
  if (!username) {
    return registering
      ? authJson(res, 400, { error: "That isn't a name the game hands out. Use the dice button to roll one." })
      : authJson(res, 401, { error: "Username or password is incorrect." });
  }
  if (password.length < 8 || password.length > 128) return authJson(res, 400, { error: "Password must be 8–128 characters." });

  try {
    const key = usernameKey(username);
    const usernameRef = firestore.collection("arenaUsernames").doc(key);
    if (registering) {
      // The name must be one the server itself offered (and recently): you can't pick your own.
      const offer = nameTickets.verify(typeof body.nameTicket === "string" ? body.nameTicket : "", username);
      if (!offer.ok) {
        return authJson(res, 400, {
          error: offer.reason === "expired"
            ? "That name offer expired. Roll a new name."
            : "That name wasn't offered by the server. Use the dice button to roll a new one.",
        });
      }
      await verifyTurnstile(turnstileToken, ip);
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
const MAX_PLAYERS = 4; // manual/public rooms remain capped at four
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

// The server is the authority on health, hits, deaths and respawns (anticheat.js).
// ANTICHEAT only controls how strict it is about the two things it *checks*:
//   "enforce" (default) — impossible movement is undone (the player is snapped back)
//                         and impossible bot shots are refused
//   "log"               — those are only counted in the log, nothing is undone; use
//                         it to look for false positives on real matches
const ANTICHEAT = process.env.ANTICHEAT === "log" ? "log" : "enforce";
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
  res.end("ArenaDuels relay server is running.\n");
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
  ws.authReady = false;
  ws.authInProgress = false;
  ws.uid = null;
  ws.username = null;
  ws.publicName = null;
  ws.ip = ip;
  ws.tokens = RATE_CAPACITY;
  ws.lastRefill = Date.now();
  ws.strikes = 0;
  ws.alive = true;

  // Someone who connects and never joins/creates a room doesn't get to sit here forever.
  const idleTimer = setTimeout(() => {
    if (!ws.room && ws.listing !== true && !ws.searching) ws.close(1008, "Idle");
  }, NO_ROOM_TIMEOUT_MS);

  ws.on("error", () => {}); // e.g. oversized frame — the socket is closed for us; just don't crash
  ws.on("pong", () => { ws.alive = true; });

  ws.on("message", (raw, isBinary) => {
    try {
      handleMessage(ws, raw, isBinary).catch((err) => {
        console.error("message handler error:", err.message); // async auth/database failures must not crash the relay
      });
    } catch (err) {
      console.error("message handler error:", err.message); // a bad packet must never kill the server
    }
  });

  ws.on("close", () => {
    clearTimeout(idleTimer);
    const n = (connectionsByIp.get(ip) || 1) - 1;
    if (n <= 0) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, n);

    // Matchmaking: leave the queue / map vote, or the match that was waiting for the host to load.
    runMatchmaker(matchmaker.cancel(ws, Date.now()));
    leavePendingMatch(ws);

    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    if (room.pending && room.hostId === ws.id) {
      abandonMatch(ws.room, "The host left before the match started.");
      return;
    }
    room.members.delete(ws.id);
    room.guard.removeMember(ws.id);
    for (const peer of room.members.values()) send(peer, { t: "peer_left", id: ws.id });
    if (room.members.size === 0) rooms.delete(ws.room);
    // If the host left, the match is over for everyone; clients already treat that via peer_left.
  });
});

// ---- rooms: shared by "create a room", "join by code" and matchmaking ----

function newRoomCode() {
  if (rooms.size >= MAX_ROOMS) return null;
  let code = randomCode();
  for (let tries = 0; rooms.has(code) && tries < 10; tries++) code = randomCode();
  return rooms.has(code) ? null : code;
}

function makeRoom(code, host, arenaId, isPublic, extra = {}) {
  const room = {
    hostId: host.id,
    arenaId,
    isPublic,
    members: new Map([[host.id, host]]),
    guard: new RoomGuard({ arenaId, hostId: host.id, enforce: ANTICHEAT === "enforce", onReject: noteReject, teams: extra.teams ?? {} }),
    maxPlayers: extra.maxPlayers ?? MAX_PLAYERS,
    teams: extra.teams ?? {},
    ...extra,
  };
  room.guard.addMember(host.id);
  rooms.set(code, room);
  host.room = code;
  return room;
}

function admitToRoom(room, code, ws) {
  const peerIds = [...room.members.keys()];
  room.members.set(ws.id, ws);
  room.guard.addMember(ws.id);
  ws.room = code;
  ws.searching = false;
  ws.pendingRoom = null;
  send(ws, { t: "room_joined", code, id: ws.id, arenaId: room.arenaId, hostId: room.hostId, peers: peerIds, teams: room.teams });
  for (const [id, peer] of room.members) {
    if (id !== ws.id) send(peer, { t: "peer_joined", id: ws.id, team: room.teams[ws.id] ?? null });
  }
}

// ---- matchmaking ----
// Players search for a game mode, vote on a map, and are put in a room together (matchmaker.js
// has the rules; there is no skill-based matching). The first player in line becomes the host.
// Everyone else is let in only once the host's browser has built the map ("match_ready"), so
// nobody joins a half-loaded game.

// Timings can be changed in the host's settings: MATCH_FILL_SECONDS (how long to wait for more players
// once two are searching, default 10), MATCH_VOTE_SECONDS (map vote, default 15) and
// MATCH_READY_TIMEOUT_SECONDS (how long the host has to load the map, default 30).
const envMs = (name, fallbackMs) => {
  const seconds = Number(process.env[name]);
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 300 ? seconds * 1000 : fallbackMs;
};
const matchmaker = new Matchmaker({
  modeIds: MODE_IDS,
  arenaIds: ARENA_IDS,
  random: (n) => crypto.randomInt(n),
  config: { FILL_MS: envMs("MATCH_FILL_SECONDS", MATCHMAKING.FILL_MS), VOTE_MS: envMs("MATCH_VOTE_SECONDS", MATCHMAKING.VOTE_MS) },
});
const MATCH_READY_TIMEOUT_MS = envMs("MATCH_READY_TIMEOUT_SECONDS", 30_000);

function runMatchmaker(outputs) {
  for (const o of outputs) {
    if (o.action === "match") startMatchRoom(o);
    else for (const p of o.to) send(p, o.msg);
  }
}

function startMatchRoom({ modeId, arenaId, players, entries }) {
  const now = Date.now();
  const here = players.filter((p) => p.readyState === p.OPEN);
  const code = newRoomCode();
  if (here.length < MATCHMAKING.MIN_PLAYERS || !code) {
    // Someone dropped between the vote and now (or the server is full): back in line for the rest.
    runMatchmaker(matchmaker.requeue(entries.filter((e) => e.player.readyState === e.player.OPEN), modeId, now));
    return;
  }
  const mode = getMode(modeId);
  const [host, ...joiners] = here;
  const teams = mode.teamMode ? Object.fromEntries([...here].sort((a, b) => a.id.localeCompare(b.id)).map((p, i) => [p.id, i % 2])) : {};
  const room = makeRoom(code, host, arenaId, false, {
    modeId, maxPlayers: mode.maxPlayers, teams,
    pending: { joiners, entries: entries.filter((e) => here.includes(e.player)), deadline: now + MATCH_READY_TIMEOUT_MS },
  });
  room.guard.onRestart(mode.settings, now); // the room's rules (health etc.) are known from the start
  host.searching = false;
  console.log(`[matchmaking] ${here.length} players, ${mode.id} on ${arenaId}`);
  send(host, { t: "match_found", role: "host", code, id: host.id, arenaId, mode: modeId, settings: mode.settings, players: here.length, teams });
  for (const j of joiners) {
    j.pendingRoom = code;
    send(j, { t: "match_found", role: "player", arenaId, mode: modeId, players: here.length, teams });
  }
}

// A matchmade room that never got going (the host left or never finished loading): close it and
// put everyone who was waiting for it back in line, ahead of anyone who started searching since.
function abandonMatch(code, reason) {
  const room = rooms.get(code);
  if (!room || !room.pending) return;
  const { joiners, entries } = room.pending;
  room.pending = null;
  rooms.delete(code);
  const host = room.members.get(room.hostId);
  if (host) {
    host.room = null;
    send(host, { t: "match_cancelled", reason });
  }
  const waiting = joiners.filter((j) => j.readyState === j.OPEN);
  for (const j of waiting) {
    j.pendingRoom = null;
    send(j, { t: "match_cancelled", reason: `${reason} Searching again…`, requeued: true });
  }
  runMatchmaker(matchmaker.requeue(entries.filter((e) => waiting.includes(e.player)), room.modeId, Date.now()));
}

// A player walking away from a match that is waiting for its host.
function leavePendingMatch(ws) {
  if (!ws.pendingRoom) return;
  const room = rooms.get(ws.pendingRoom);
  ws.pendingRoom = null;
  if (!room?.pending) return;
  room.pending.joiners = room.pending.joiners.filter((j) => j !== ws);
  room.pending.entries = room.pending.entries.filter((e) => e.player !== ws);
}

setInterval(() => {
  const now = Date.now();
  try {
    runMatchmaker(matchmaker.tick(now));
    for (const [code, room] of rooms) {
      if (room.pending && now > room.pending.deadline) abandonMatch(code, "The host took too long to load the match.");
    }
  } catch (err) {
    console.error("[matchmaking] tick failed:", err.message);
  }
}, 250).unref();

async function handleMessage(ws, raw, isBinary) {
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

  // Every socket must explicitly authenticate or identify as a guest before it can
  // list, create, join, search, or send gameplay messages.
  if (msg.t === "authenticate_guest") {
    if (ws.authReady || ws.authInProgress) return;
    ws.authInProgress = true;
    ws.authReady = true;
    ws.authInProgress = false;
    send(ws, { t: "auth_ready", authenticated: false });
    return;
  }
  if (msg.t === "authenticate") {
    if (ws.authReady || ws.authInProgress) return;
    ws.authInProgress = true;
    if (typeof msg.token !== "string" || msg.token.length < 20 || msg.token.length > 6000 || !firebaseAuth || !firestore) {
      send(ws, { t: "auth_error", error: "Account verification is unavailable. Please sign in again." });
      ws.close(1008, "Authentication failed");
      return;
    }
    try {
      const decoded = await firebaseAuth.verifyIdToken(msg.token, true);
      if (ws.readyState !== ws.OPEN) return;
      const accountSnap = await firestore.collection("arenaAccounts").doc(decoded.uid).get();
      if (ws.readyState !== ws.OPEN) return;
      if (!accountSnap.exists || accountSnap.data()?.uid !== decoded.uid || typeof accountSnap.data()?.username !== "string") {
        throw new Error("Account record not found");
      }
      const accountUsername = cleanRelay({ t: "hello", name: accountSnap.data().username })?.name;
      if (!accountUsername) throw new Error("Invalid account username");
      ws.uid = decoded.uid;
      ws.username = accountUsername;
      ws.authReady = true;
      ws.authInProgress = false;
      send(ws, { t: "auth_ready", authenticated: true, username: accountUsername });
    } catch (err) {
      console.warn("[auth] WebSocket identity rejected:", err.message);
      send(ws, { t: "auth_error", error: "Your sign-in could not be verified. Please sign in again." });
      ws.close(1008, "Authentication failed");
    }
    return;
  }
  if (!ws.authReady) return;

  switch (msg.t) {
    case "create_room": {
      if (ws.room || ws.searching || rooms.size >= MAX_ROOMS || !isValidArenaId(msg.arenaId)) return;
      const code = newRoomCode();
      if (!code) return;
      makeRoom(code, ws, msg.arenaId, msg.isPublic === true);
      send(ws, { t: "room_created", code, id: ws.id });
      return;
    }

    case "list_lobbies": {
      ws.listing = true;
      const lobbies = [];
      for (const [code, room] of rooms) {
        if (room.isPublic && room.members.size < room.maxPlayers) {
          lobbies.push({ code, arenaId: room.arenaId, playerCount: room.members.size, maxPlayers: room.maxPlayers });
          if (lobbies.length >= 50) break;
        }
      }
      send(ws, { t: "lobby_list", lobbies });
      return;
    }

    case "join_room": {
      if (ws.room || ws.searching) return; // (someone searching for a match can't also be elsewhere)
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
      if (room.members.size >= room.maxPlayers) {
        send(ws, { t: "join_error", error: `Room is full (${room.maxPlayers}/${room.maxPlayers}).` });
        return;
      }
      admitToRoom(room, msg.code, ws);
      return;
    }

    // ---- matchmaking ----
    case "find_match": {
      if (ws.room || matchmaker.isSearching(ws)) return;
      if (!isValidModeId(msg.mode)) {
        send(ws, { t: "search_error", error: "Unknown game mode." });
        return;
      }
      ws.searching = true;
      runMatchmaker(matchmaker.enqueue(ws, msg.mode, Date.now()));
      return;
    }

    case "cancel_search": {
      runMatchmaker(matchmaker.cancel(ws, Date.now()));
      leavePendingMatch(ws);
      ws.searching = false;
      return;
    }

    case "vote": {
      runMatchmaker(matchmaker.vote(ws, msg.arenaId, Date.now()));
      return;
    }

    // The host's browser has built the map: let the other players in.
    case "match_ready": {
      const room = ws.room && rooms.get(ws.room);
      if (!room || room.hostId !== ws.id || !room.pending) return;
      const { joiners } = room.pending;
      room.pending = null;
      let admitted = 0;
      for (const j of joiners) {
        if (j.readyState !== j.OPEN || j.room || room.members.size >= room.maxPlayers) continue;
        admitToRoom(room, ws.room, j);
        admitted++;
      }
      if (admitted === 0) send(ws, { t: "match_cancelled", reason: "The other players left before the match started." });
      return;
    }

    default: {
      // Gameplay message — only relayed for someone who is in a room.
      const room = ws.room && rooms.get(ws.room);
      if (!room) return;

      // Rebuild the message from validated fields; unknown types come back null.
      const clean = cleanRelay(msg);
      if (!clean) return;

      if (clean.t === "hello") {
        if (ws.uid) {
          // Authenticated identity is derived only from the verified Firebase UID + Firestore.
          clean.name = ws.username;
        } else if (ws.publicName) {
          clean.name = ws.publicName;
        } else {
          // Guests may choose an unreserved display name, but cannot claim a registered one.
          const claimed = clean.name;
          let reserved = null;
          try {
            reserved = firestore
              ? await firestore.collection("arenaUsernames").doc(usernameKey(claimed)).get()
              : null;
          } catch {
            // If the reservation store is unavailable, don't risk allowing a registered-name claim.
            reserved = { exists: true };
          }
          if (reserved?.exists) clean.name = `Guest-${ws.id.slice(0, 4)}`;
          ws.publicName = clean.name;
        }
      }

      // Health, respawns and corrections are the server's to announce — never a player's.
      if (SERVER_ONLY.has(clean.t)) return;

      const isHost = ws.id === room.hostId;
      if (HOST_ONLY.has(clean.t) && !isHost) return;

      // Players don't report hits or deaths: the server watches the beam and decides.
      // Only the host reports, and only about its own bots.
      if (clean.t === "hit" && !(isHost && isBotId(clean.attackerId))) return;
      if (clean.t === "kill" && !(isHost && isBotId(clean.victimId))) return;

      const relay = screen(room, ws, isHost, clean);
      deliver(room, room.guard.drain());
      if (!relay) return;

      // "from" is stamped by the server and always wins; clients can't set it.
      const out = JSON.stringify({ ...clean, from: ws.id });
      for (const [id, peer] of room.members) {
        if (id !== ws.id && peer.readyState === peer.OPEN) peer.send(out);
      }
    }
  }
}

// Feeds the room's guard with a gameplay message and decides whether it may be relayed.
// May rewrite `clean` in place (a state message gets the server's version of the
// player's position and health).
function screen(room, ws, isHost, clean) {
  const guard = room.guard;
  const now = Date.now();
  switch (clean.t) {
    case "state": {
      const r = guard.onState(ws.id, clean, now);
      if (!r) return false;
      if (r.correct) send(ws, { t: "correct", ...r.correct, from: SERVER_ID }); // snap them back
      clean.x = r.x;
      clean.y = r.y;
      clean.z = r.z;
      clean.hp = r.hp;
      clean.firing = r.firing;
      delete clean.tp;
      return true;
    }
    case "bots": guard.onBots(clean.bots, now); return true;
    case "restart": guard.onRestart(clean.settings, now); return true;
    case "sync": guard.onSync(clean.forId, clean.settings, now); return true;
    case "end": guard.onEnd(); return true;
    case "hit": {
      // The host says one of its bots shot a player. Check it, then apply it to
      // that player's health ourselves; the hit itself is never relayed.
      const v = guard.checkHit(ws.id, isHost, clean, now);
      if (v.ok) guard.hurt(clean.targetId, clean.attackerId, v.damage, now);
      else {
        noteReject("bot-hit:" + v.reason);
        if (ANTICHEAT === "log") guard.hurt(clean.targetId, clean.attackerId, clean.damage, now);
      }
      return false;
    }
    case "kill": {
      // The host says one of its bots died.
      const v = guard.checkKill(ws.id, isHost, clean, now);
      if (v.ok) {
        clean.attackerId = v.attackerId;
        return true;
      }
      noteReject("bot-kill:" + v.reason);
      return ANTICHEAT === "log";
    }
    default: return true;
  }
}

// Send what the guard queued (health updates, kills, respawns, hits on bots) as "from the server".
function deliver(room, events) {
  for (const { to, msg, except } of events) {
    const out = JSON.stringify({ ...msg, from: SERVER_ID });
    if (to === "all") {
      for (const [id, peer] of room.members) if (id !== except && peer.readyState === peer.OPEN) peer.send(out);
    } else {
      const peer = room.members.get(to);
      if (peer && peer.readyState === peer.OPEN) peer.send(out);
    }
  }
}

// The server's own clock: ~30 times a second every room advances (beam damage, respawns).
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    try {
      deliver(room, room.guard.tick(now));
    } catch (err) {
      console.error("[tick] room update failed:", err.message);
    }
  }
}, 33).unref();

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
