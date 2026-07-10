// ArenaDuels relay server.
// Plain WebSocket relay — no WebRTC, no STUN/TURN, no NAT traversal needed.
// Every client just makes one normal outbound WebSocket connection to this
// server (identical to any HTTPS request as far as routers/firewalls are
// concerned), and the server relays game messages between everyone in the
// same room. Deploy this somewhere that stays running (Render, Railway,
// Fly.io, a small VPS) — see server/README.md for step-by-step instructions.

import { WebSocketServer } from "ws";
import http from "http";

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 4;

// A tiny HTTP server so hosts like Render have something to health-check.
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ArenaDuels relay server is running.\n");
});

const wss = new WebSocketServer({ server: httpServer });

// code -> { hostId, arenaId, members: Map<id, ws> }
const rooms = new Map();

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  ws.id = randomId();
  ws.room = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.t === "create_room") {
      let code = randomCode();
      let tries = 0;
      while (rooms.has(code) && tries < 10) {
        code = randomCode();
        tries++;
      }
      const members = new Map([[ws.id, ws]]);
      rooms.set(code, {
        hostId: ws.id,
        arenaId: msg.arenaId,
        isPublic: !!msg.isPublic,
        members,
      });
      ws.room = code;
      send(ws, { t: "room_created", code, id: ws.id });
      return;
    }

    if (msg.t === "list_lobbies") {
      const lobbies = [];
      for (const [code, room] of rooms) {
        if (room.isPublic && room.members.size < MAX_PLAYERS) {
          lobbies.push({
            code,
            arenaId: room.arenaId,
            playerCount: room.members.size,
            maxPlayers: MAX_PLAYERS,
          });
        }
      }
      send(ws, { t: "lobby_list", lobbies });
      return;
    }

    if (msg.t === "join_room") {
      const room = rooms.get(msg.code);
      if (!room) {
        send(ws, { t: "join_error", error: "Room not found." });
        return;
      }
      if (room.members.size >= MAX_PLAYERS) {
        send(ws, { t: "join_error", error: "Room is full (4/4)." });
        return;
      }
      const peerIds = [...room.members.keys()];
      room.members.set(ws.id, ws);
      ws.room = msg.code;
      send(ws, {
        t: "room_joined",
        code: msg.code,
        id: ws.id,
        arenaId: room.arenaId,
        hostId: room.hostId,
        peers: peerIds,
      });
      // Tell everyone already in the room that a new player showed up.
      for (const [id, peer] of room.members) {
        if (id !== ws.id) send(peer, { t: "peer_joined", id: ws.id });
      }
      return;
    }

    // Anything else is a gameplay message — relay it to everyone else
    // currently in the same room, tagging it with the sender's id.
    const room = rooms.get(ws.room);
    if (!room) return;
    const out = { ...msg, from: ws.id };
    for (const [id, peer] of room.members) {
      if (id !== ws.id) send(peer, out);
    }
  });

  ws.on("close", () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    room.members.delete(ws.id);
    for (const peer of room.members.values()) {
      send(peer, { t: "peer_left", id: ws.id });
    }
    if (room.members.size === 0) rooms.delete(ws.room);
  });
});

httpServer.listen(PORT, () => {
  console.log(`ArenaDuels relay server listening on port ${PORT}`);
});
