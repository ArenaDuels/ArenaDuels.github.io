// Where does a request really come from? Every per-IP limit in the relay (connection cap,
// login limit, name rolls, room-code guesses, stats) depends on the answer.
//
// The CF-Connecting-IP header is only trustworthy when the request really came through
// Cloudflare, which overwrites it. On a host that is NOT behind Cloudflare a client can send
// any value it likes, and trusting it would turn every per-IP limit into a suggestion.
//
// So the header is trusted only when:
//   - TRUST_PROXY=1 is set explicitly, or
//   - TRUST_PROXY is unset and we are running on Render (Render sets RENDER=true itself).
// TRUST_PROXY=0 always turns it off. Anywhere else the real TCP peer address is used.
import { isIP } from "node:net";

export function resolveTrustProxy(env = process.env) {
  if (env.TRUST_PROXY === "0") return false;
  if (env.TRUST_PROXY === "1") return true;
  return env.RENDER === "true";
}

export function clientIpFrom(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers["cf-connecting-ip"];
    if (typeof forwarded === "string") {
      const candidate = forwarded.trim();
      if (candidate.length <= 64 && isIP(candidate)) return candidate;
    }
  }
  const remote = req.socket?.remoteAddress;
  return typeof remote === "string" && remote.length <= 64 ? remote : "unknown";
}
