// WebSocket-based networking. Every client (including whoever created the
// room) makes one plain WebSocket connection to the relay server, which
// forwards gameplay messages to everyone else in the same room. No WebRTC,
// no NAT traversal — this is why it works even behind strict routers/
// firewalls that block WebRTC.

// ⚠️ Set this to your deployed relay server's URL — see server/README.md.
const SERVER_URL = "wss://arenaduels-relay.onrender.com";

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
  host(arenaId) {
    return new Promise((resolve, reject) => {
      const ws = this._connect(reject);
      ws.onopen = () => ws.send(JSON.stringify({ t: "create_room", arenaId }));
      ws.onmessage = (ev) => {
        const msg = this._parse(ev);
        if (!msg) return;
        if (msg.t === "room_created") {
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

  /** Join an existing room by its 6-digit code. */
  join(code) {
    return new Promise((resolve, reject) => {
      const ws = this._connect(reject);
      ws.onopen = () => ws.send(JSON.stringify({ t: "join_room", code }));
      ws.onmessage = (ev) => {
        const msg = this._parse(ev);
        if (!msg) return;
        if (msg.t === "room_joined") {
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
        "Couldn't reach the relay server (timed out). Check the server is " +
        "deployed and awake — free-tier servers can take ~30-60s to wake up " +
        "after being idle."
      ));
    }, CONNECT_TIMEOUT_MS);

    ws.onerror = () => {
      if (this._settled) return;
      this._settled = true;
      clearTimeout(this._timeout);
      reject(new Error("Couldn't reach the relay server. Is SERVER_URL set correctly in net.js?"));
    };

    return ws;
  }

  _parse(ev) {
    try {
      return JSON.parse(ev.data);
    } catch {
      return null;
    }
  }

  // Wires up the live connection after we've successfully joined/created a room.
  _wire() {
    this.ws.onmessage = (ev) => {
      const msg = this._parse(ev);
      if (!msg) return;

      if (msg.t === "peer_joined") {
        if (this.onPeerConnected) this.onPeerConnected(msg.id);
      } else if (msg.t === "peer_left") {
        if (this.onPeerDisconnected) this.onPeerDisconnected(msg.id);
      } else {
        if (this.onData) this.onData(msg, msg.from);
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
