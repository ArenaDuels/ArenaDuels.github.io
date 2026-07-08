// Thin wrapper around PeerJS. Host acts as a relay hub: every client only
// connects to the host, and the host forwards messages between them so
// everyone effectively sees everyone (star topology at the transport layer,
// broadcast-based at the app layer).

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

const CONNECT_TIMEOUT_MS = 15000;

export function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export class Net {
  constructor() {
    this.peer = null;
    this.conns = new Map(); // peerId -> DataConnection
    this.isHost = false;
    this.myId = null;

    // Assign these from outside to react to events.
    this.onData = null;             // (data, fromId) => void
    this.onPeerConnected = null;    // (id) => void  (host only)
    this.onPeerDisconnected = null; // (id) => void
  }

  /**
   * Host a match. Tries `code`; if that ID is taken on the PeerJS broker,
   * retries with a fresh random code up to `attempts` times.
   * Resolves with the code that actually got registered (this becomes myId).
   */
  host(code, attempts = 5) {
    return new Promise((resolve, reject) => {
      const tryCode = (c, left) => {
        const peer = new Peer(c, { debug: 1, config: ICE_CONFIG });
        this.isHost = true;

        peer.on("open", (id) => {
          this.peer = peer;
          this.myId = id;
          peer.on("connection", (conn) => this._wireIncoming(conn));
          resolve(id);
        });

        peer.on("error", (err) => {
          if (err.type === "unavailable-id" && left > 0) {
            peer.destroy();
            tryCode(randomCode(), left - 1);
          } else {
            reject(err);
          }
        });
      };
      tryCode(code, attempts);
    });
  }

  /** Join a hosted match by its 6-digit code. */
  join(code) {
    return new Promise((resolve, reject) => {
      this.isHost = false;
      const peer = new Peer({ debug: 1, config: ICE_CONFIG });
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(new Error(
          "Connection timed out. This usually means a firewall or NAT is blocking " +
          "the direct link — try a different network, or double check the code."
        ));
      }, CONNECT_TIMEOUT_MS);

      peer.on("open", (id) => {
        this.peer = peer;
        this.myId = id;
        const conn = peer.connect(code, { reliable: true });

        conn.on("open", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.conns.set(code, conn);
          this._wireConn(code, conn);
          resolve();
        });

        conn.on("error", (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(err);
        });

        // Extra diagnostic: watch the underlying RTCPeerConnection directly,
        // since PeerJS doesn't always surface ICE failures as 'error' events.
        conn.on("iceStateChanged", (state) => {
          if (settled) return;
          if (state === "failed" || state === "disconnected") {
            settled = true;
            clearTimeout(timeout);
            peer.destroy();
            reject(new Error(
              `WebRTC connection ${state}. Likely blocked by a firewall/NAT on one side.`
            ));
          }
        });
      });

      peer.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // Host side: a new incoming connection. We don't know it's really "open"
  // (and shouldn't send anything) until the open event fires.
  _wireIncoming(conn) {
    const id = conn.peer;
    conn.on("open", () => {
      this.conns.set(id, conn);
      this._wireConn(id, conn);
      if (this.onPeerConnected) this.onPeerConnected(id);
    });
  }

  _wireConn(id, conn) {
    conn.on("data", (data) => {
      if (this.onData) this.onData(data, id);
    });
    conn.on("close", () => {
      this.conns.delete(id);
      if (this.onPeerDisconnected) this.onPeerDisconnected(id);
    });
  }

  // Send to every connection we have. For a client this is just "send to
  // host" (their only connection). For the host this reaches every client.
  // excludeId skips one connection (used when relaying — don't echo back
  // to whoever sent the original message).
  broadcast(data, excludeId = null) {
    for (const [id, conn] of this.conns) {
      if (id === excludeId) continue;
      if (conn.open) conn.send(data);
    }
  }

  destroy() {
    for (const conn of this.conns.values()) conn.close();
    this.conns.clear();
    if (this.peer) this.peer.destroy();
    this.peer = null;
  }
}
