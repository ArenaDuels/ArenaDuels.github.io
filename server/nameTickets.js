// Name tickets: proof that the SERVER offered a particular account name.
//
// When someone asks for a name (the dice button), the server picks one at random and
// signs it: ticket = expiry . nonce . HMAC(name | expiry | nonce). To create an account
// you have to send the name AND its ticket back, so you can't register a name you
// chose yourself — only one the server gave you, within 15 minutes of giving it.
// (Tickets are checked, not stored: once a name is registered it is taken, so the
// same ticket can't be used to register it again.)
import crypto from "node:crypto";

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const TICKET_RE = /^(\d{10,15})\.([0-9a-f]{16})\.([0-9a-f]{64})$/;

/**
 * @param {{ secret?: string, ttlMs?: number }} [opts]
 *   `secret` should be a long random string (the NAME_TICKET_SECRET setting). Without
 *   one a temporary key is made up at start-up, which is fine except that offers still
 *   open when the server restarts stop working.
 */
export function createNameTickets({ secret, ttlMs = DEFAULT_TTL_MS } = {}) {
  const key = secret
    ? crypto.createHash("sha256").update(String(secret)).digest()
    : crypto.randomBytes(32);
  const sign = (name, expires, nonce) =>
    crypto.createHmac("sha256", key).update(`${name.toLowerCase()}|${expires}|${nonce}`).digest("hex");

  return {
    temporary: !secret,
    ttlSeconds: Math.round(ttlMs / 1000),

    /** A ticket for `name`, good for the next 15 minutes. */
    issue(name, now = Date.now()) {
      const expires = now + ttlMs;
      const nonce = crypto.randomBytes(8).toString("hex");
      return `${expires}.${nonce}.${sign(name, expires, nonce)}`;
    },

    /** @returns {{ok: true} | {ok: false, reason: "missing"|"malformed"|"expired"|"invalid"}} */
    verify(ticket, name, now = Date.now()) {
      if (typeof ticket !== "string" || ticket === "") return { ok: false, reason: "missing" };
      const match = ticket.length <= 128 ? TICKET_RE.exec(ticket) : null;
      if (!match || typeof name !== "string") return { ok: false, reason: "malformed" };
      const [, expiresText, nonce, mac] = match;
      const expected = Buffer.from(sign(name, expiresText, nonce), "hex");
      const given = Buffer.from(mac, "hex");
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: "invalid" };
      const expires = Number(expiresText);
      if (expires < now) return { ok: false, reason: "expired" };
      if (expires > now + ttlMs + 60_000) return { ok: false, reason: "invalid" };
      return { ok: true };
    },
  };
}
