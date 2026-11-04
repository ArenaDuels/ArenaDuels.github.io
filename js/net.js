// WebSocket-based networking. Every client (including whoever created the
// room) makes one plain WebSocket connection to the relay server, which
// forwards gameplay messages to everyone else in the same room. No WebRTC,
// no NAT traversal — this is why it works even behind strict routers/
// firewalls that block WebRTC.

// Set this to your deployed relay server's URL — see server/README.md.
const SERVER_URL = "wss://arenaduels-relay.onrender.com";

import { cleanLobbies, isValidArenaId, isValidCode, isValidId, MAX_MESSAGE_BYTES } from "./validate.js";
import { isValidModeId } from "./modes.js";
import { getCurrentFirebaseIdToken } from "./auth.js";

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
    this.onMatchCancelled = null;   // (reason) => void — a matchmade game fell through after we were in its room
    this._search = null;            // the matchmaking search in progress, if any
  }

  /** Create a room for the given arena. Resolves with the 6-digit room code. */
  host(arenaId, isPublic) {
    return new Promise((resolve, reject) => {
      const ws = this._connect(reject, () => ws.send(JSON.stringify({ t: "create_room", arenaId, isPublic: !!isPublic })));
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
      let settled = false;
      const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timeout); fn(); };
      const ws = this._connect((err) => finish(() => reject(err)), () => ws.send(JSON.stringify({ t: "list_lobbies" })));
      const timeout = setTimeout(() => {
        try { ws.close(); } catch {}
        finish(() => reject(new Error("Timed out fetching lobby list.")));
      }, 8000);
      ws.onmessage = (ev) => {
        const msg = this._parse(ev);
        if (msg && msg.t === "lobby_list") finish(() => { ws.close(); resolve(cleanLobbies(msg.lobbies)); });
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
      const ws = this._connect(reject, () => ws.send(JSON.stringify({ t: "join_room", code })));
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

  /**
   * Search for a match in a game mode. The server queues you with everyone else searching the
   * same mode (no skill rating involved), runs a map vote, then puts you in a room together.
   * `hooks` are called as things happen — each gets a plain object of checked numbers/ids:
   *   onQueue({ players, max, startsInMs })          still gathering players
   *   onVoteStart({ mode, options, endsInMs, players })
   *   onVoteUpdate({ tally, voted, players })
   *   onVoteResult({ arenaId, tally })
   *   onLoading({ arenaId, mode })                   map chosen; waiting for the host to be ready
   *   onNotice(text)                                 e.g. "A player left, so we're searching again."
   * Resolves once you're in the room: { isHost, arenaId, hostId, peers, mode, settings }.
   * Rejects if the search is cancelled (err.cancelled), times out, or the connection drops.
   */
  findMatch(mode, hooks = {}) {
    return new Promise((resolve, reject) => {
      if (!isValidModeId(mode)) {
        reject(new Error("Unknown game mode."));
        return;
      }
      const ws = this._connect(reject, () => {
        this._settled = true; // authenticated (or explicitly guest); the search can now begin
        clearTimeout(this._timeout);
        ws.send(JSON.stringify({ t: "find_match", mode }));
      });
      let finished = false;
      let found = null; // details from "match_found", once the server has made a match for us
      const finish = (fn) => {
        if (finished) return;
        finished = true;
        this._search = null;
        fn();
      };
      const fail = (err) => finish(() => {
        this._settled = true;
        clearTimeout(this._timeout);
        try { ws.close(); } catch { /* already closed */ }
        reject(err);
      });
      this._search = { ws, cancel: () => fail(Object.assign(new Error("Search cancelled."), { cancelled: true })) };

      const count = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : 0);
      const ms = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(120000, v)) : null);
      const arenaList = (a) => (Array.isArray(a) ? [...new Set(a.filter(isValidArenaId))].slice(0, 6) : []);
      const text = (v) => String(v ?? "").slice(0, 200);
      const adopt = (id, hostId, isHost) => {
        this._settled = true;
        clearTimeout(this._timeout);
        this.ws = ws;
        this.myId = id;
        this.hostId = hostId;
        this.isHost = isHost;
        this._wire();
      };

      ws.onclose = () => fail(new Error("Lost the connection while searching."));
      ws.onmessage = (ev) => {
        const msg = this._parse(ev);
        if (!msg || finished) return;
        try {
          switch (msg.t) {
            case "queue":
              hooks.onQueue?.({ players: count(msg.players, 8), max: count(msg.max, 8), startsInMs: ms(msg.startsInMs) });
              break;
            case "vote_start":
              hooks.onVoteStart?.({ mode: isValidModeId(msg.mode) ? msg.mode : mode, options: arenaList(msg.options), endsInMs: ms(msg.endsInMs) ?? 15000, players: count(msg.players, 8) });
              break;
            case "vote_update": {
              const tally = {};
              if (msg.tally && typeof msg.tally === "object") {
                for (const id of Object.keys(msg.tally)) if (isValidArenaId(id)) tally[id] = count(msg.tally[id], 8);
              }
              hooks.onVoteUpdate?.({ tally, voted: count(msg.voted, 8), players: count(msg.players, 8) });
              break;
            }
            case "vote_result":
              if (isValidArenaId(msg.arenaId)) hooks.onVoteResult?.({ arenaId: msg.arenaId });
              break;
            case "vote_cancelled":
              hooks.onNotice?.(text(msg.reason));
              break;
            case "match_found": {
              if (!isValidArenaId(msg.arenaId) || !isValidModeId(msg.mode)) break;
              if (msg.role === "host") {
                if (!isValidCode(msg.code) || !isValidId(msg.id)) break;
                adopt(msg.id, msg.id, true);
                finish(() => resolve({ isHost: true, arenaId: msg.arenaId, hostId: msg.id, peers: [], mode: msg.mode, settings: msg.settings, code: msg.code }));
              } else {
                found = { arenaId: msg.arenaId, mode: msg.mode };
                hooks.onLoading?.(found);
              }
              break;
            }
            case "room_joined": {
              const peers = Array.isArray(msg.peers) ? msg.peers : null;
              if (!found || !isValidId(msg.id) || !isValidId(msg.hostId) || !isValidArenaId(msg.arenaId) || !peers || peers.length > 8 || !peers.every(isValidId)) break;
              adopt(msg.id, msg.hostId, false);
              finish(() => resolve({ isHost: false, arenaId: msg.arenaId, hostId: msg.hostId, peers, mode: found.mode, settings: null }));
              break;
            }
            case "match_cancelled":
              found = null;
              if (msg.requeued) hooks.onNotice?.(text(msg.reason)); // the server has put us back in line
              else fail(new Error(text(msg.reason) || "The match was cancelled."));
              break;
            case "search_timeout":
              fail(new Error("We couldn't find a match this time. Try again."));
              break;
            case "search_error":
              fail(new Error(text(msg.error) || "Couldn't start the search."));
              break;
          }
        } catch (err) {
          console.warn("Ignored a matchmaking message that failed to process:", err);
        }
      };
    });
  }

  /** Vote for one of the maps on offer. */
  vote(arenaId) {
    if (this._search && isValidArenaId(arenaId) && this._search.ws.readyState === WebSocket.OPEN) {
      this._search.ws.send(JSON.stringify({ t: "vote", arenaId }));
    }
  }

  /** Stop searching (or leave the vote / the match that is loading). */
  cancelSearch() {
    this._search?.cancel();
  }

  _connect(reject, onReady = () => {}) {
    this._settled = false;
    const ws = new WebSocket(SERVER_URL);
    let authReplyReceived = false;

    this._timeout = setTimeout(() => {
      if (this._settled) return;
      this._settled = true;
      try { ws.close(); } catch {}
      reject(new Error(
        "Couldn't reach the server in time. It may still be waking up " +
        "from sleep — try again in a moment."
      ));
    }, CONNECT_TIMEOUT_MS);

    ws.addEventListener("open", async () => {
      try {
        const token = await getCurrentFirebaseIdToken();
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(token
          ? { t: "authenticate", token }
          : { t: "authenticate_guest" }));
      } catch {
        this._settled = true;
        clearTimeout(this._timeout);
        try { ws.close(); } catch {}
        reject(new Error("Couldn't verify your sign-in. Please refresh and try again."));
      }
    });

    ws.addEventListener("message", (ev) => {
      if (authReplyReceived) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "auth_error") {
        authReplyReceived = true;
        this._settled = true;
        clearTimeout(this._timeout);
        reject(new Error(msg.error || "Account verification failed. Please sign in again."));
      } else if (msg.t === "auth_ready") {
        authReplyReceived = true;
        clearTimeout(this._timeout);
        try { onReady(msg); }
        catch (err) { this._settled = true; reject(err); }
      }
    });

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
        } else if (msg.t === "match_cancelled" && msg.from === undefined) {
          if (this.onMatchCancelled) this.onMatchCancelled(String(msg.reason ?? "").slice(0, 200));
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
    this._search?.cancel();
    if (this.ws) this.ws.close();
    this.ws = null;
  }
}
