// WebSocket-based networking. Every client (including whoever created the
// room) makes one plain WebSocket connection to the relay server, which
// forwards gameplay messages to everyone else in the same room. No WebRTC,
// no NAT traversal — this is why it works even behind strict routers/
// firewalls that block WebRTC.

// Set this to your deployed relay server's URL — see server/README.md.
const SERVER_URL = "wss://arenaduels-relay.onrender.com";

import { cleanLobbies, isValidArenaId, isValidCode, isValidId, MAX_MESSAGE_BYTES } from "./validate.js";

const CONNECT_TIMEOUT_MS = 12000;

export class Net {
  constructor() {
    this.ws = null;
    this.myId = null;
    this.hostId = null;
    this.isHost = false;

    // Assign these from outside to react to events.
    this.onData = null;             // (data, fromId) => void
    this.onPeerConnected = null;    // (id) => void  — someone new joined the room
    this.onPeerDisconnected = null; // (id|null) => void — null means we lost the server itself
  }

  /** Create a room for the given arena. Resolves with the 6-digit room code. */
  host(arenaId, isPublic) {
    return new Promise((resolve, reject) => {
      const ws = this._connect(reject);
      ws.onopen = () => ws.send(JSON.stringify({ t: "create_room", arenaId, isPublic: !!isPublic }));
      ws.onmessage = (ev) => {
        const msg = this._parse(ev);
        if (!msg) return;
        if (msg.t === "room_created") {
          if (!isValidCode(msg.code) || !isValidId(msg.id)) return;
          this._settled = true;
          clearTimeout(this._timeout);
          this.ws = ws;
          this.myId = msg.id;
          this.hostId = msg.id;
          this.isHost = true;
          this._wire();
          resolve(msg.code);
        }
      };
    });
  }

  /** One-shot fetch of currently open public lobbies. */
  listLobbies() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(SERVER_URL);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out fetching lobby list."));
      }, 8000);
      ws.onopen = () => ws.send(JSON.stringify({ t: "list_lobbies" }));
      ws.onmessage = (ev) => {
        const msg = this._parse(ev);
        if (msg && msg.t === "lobby_list") {
          clearTimeout(timeout);
          ws.close();
          resolve(cleanLobbies(msg.lobbies));
        }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Couldn't reach the relay server."));
      };
    });
  }

  /** Join an existing room by its 6-digit code. */
  join(code) {
    return new Promise((resolve, reject) => {
      if (!isValidCode(code)) {
        reject(new Error("Enter the 6-digit code."));
        return;
      }
      const ws = this._connect(reject);
      ws.onopen = () => ws.send(JSON.stringify({ t: "join_room", code }));
      ws.onmessage = (ev) => {
        const msg = this._parse(ev);
        if (!msg) return;
        if (msg.t === "room_joined") {
          const peers = Array.isArray(msg.peers) ? msg.peers : null;
          if (
            !isValidId(msg.id) || !isValidId(msg.hostId) || !isValidArenaId(msg.arenaId) ||
            !peers || peers.length > 8 || !peers.every(isValidId)
          ) {
            this._settled = true;
            clearTimeout(this._timeout);
            ws.close();
            reject(new Error("Unexpected reply from the server."));
            return;
          }
          this._settled = true;
          clearTimeout(this._timeout);
          this.ws = ws;
          this.myId = msg.id;
          this.hostId = msg.hostId;
          this.isHost = false;
          this._wire();
          resolve({ arenaId: msg.arenaId, peers: msg.peers, hostId: msg.hostId });
        } else if (msg.t === "join_error") {
          this._settled = true;
          clearTimeout(this._timeout);
          reject(new Error(msg.error));
        }
      };
    });
  }

  _connect(reject) {
    this._settled = false;
    const ws = new WebSocket(SERVER_URL);

    this._timeout = setTimeout(() => {
      if (this._settled) return;
      this._settled = true;
      ws.close();
      reject(new Error(
        "Couldn't reach the server in time. It may still be waking up " +
        "from sleep — try again in a moment."
      ));
    }, CONNECT_TIMEOUT_MS);

    ws.onerror = () => {
      if (this._settled) return;
      this._settled = true;
      clearTimeout(this._timeout);
      reject(new Error("Couldn't reach the server. Please try again shortly."));
    };

    return ws;
  }

  // Parse one incoming frame. Anything oversized, non-text, malformed or not a
  // plain JSON object with a string "t" is dropped (returns null).
  _parse(ev) {
    try {
      if (typeof ev.data !== "string" || ev.data.length > MAX_MESSAGE_BYTES) return null;
      const msg = JSON.parse(ev.data);
      if (msg === null || typeof msg !== "object" || Array.isArray(msg) || typeof msg.t !== "string") return null;
      return msg;
    } catch {
      return null;
    }
  }

  // Wires up the live connection after we've successfully joined/created a room.
  _wire() {
    this.ws.onmessage = (ev) => {
      const msg = this._parse(ev);
      if (!msg) return;

      try {
        if (msg.t === "peer_joined" || msg.t === "peer_left") {
          // Genuine join/leave notices come from the server itself and carry no
          // "from". Anything else with these types is a player pretending.
          if (msg.from !== undefined || !isValidId(msg.id)) return;
          if (msg.t === "peer_joined") {
            if (this.onPeerConnected) this.onPeerConnected(msg.id);
          } else if (this.onPeerDisconnected) {
            this.onPeerDisconnected(msg.id);
          }
        } else if (isValidId(msg.from)) {
          if (this.onData) this.onData(msg, msg.from);
        }
      } catch (err) {
        // One bad packet must never take the game down.
        console.warn("Ignored a message that failed to process:", err);
      }
    };

    this.ws.onclose = () => {
      if (this.onPeerDisconnected) this.onPeerDisconnected(null); // lost the server entirely
    };
  }

  /** Send a gameplay message — the server relays it to everyone else in the room. */
  broadcast(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  destroy() {
    if (this.ws) this.ws.close();
    this.ws = null;
  }
}
