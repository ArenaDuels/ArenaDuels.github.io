# ArenaDuels relay server

A tiny WebSocket relay. No WebRTC, no STUN/TURN, no NAT traversal —
just plain WebSocket over TCP (port 443 once deployed with HTTPS), which
passes through essentially any router or firewall without special
configuration, since it looks identical to normal web traffic.

## Deploy it (free) — Render.com

1. Push this whole project (including this `server/` folder) to GitHub —
   you're already doing that.
2. Go to [render.com](https://render.com) → sign in with GitHub.
3. **New +** → **Web Service** → pick your repo.
4. Settings:
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Click **Deploy**. Render will give you a URL like
   `https://capsules-relay.onrender.com`.
6. Your WebSocket URL is the same thing with `wss://` instead of `https://`:
   `wss://capsules-relay.onrender.com`

Open `js/net.js` in the client project and set:
```js
const SERVER_URL = "wss://capsules-relay.onrender.com";
```

## Heads up: free tier sleeps

Render's free tier spins the server down after ~15 minutes of no traffic,
and takes 30-60 seconds to wake back up on the next connection. That means
the *first* Host/Join after a while idle might time out or feel slow —
just try again once it's woken up. Fine for a hobby project; if this
becomes a real problem, either upgrade to a paid instance or ping the
server periodically to keep it warm (e.g. an external uptime-monitor
service hitting the URL every 10 minutes).

## Alternatives

Railway and Fly.io both work the same way (Node + `ws`, no special
WebSocket config needed) if you'd rather not use Render. A $5/mo VPS
(DigitalOcean, etc.) also works and doesn't sleep, if you outgrow the
free tier.

## Running it locally to test

```
cd server
npm install
npm start
```
Then in `js/net.js`, temporarily set:
```js
const SERVER_URL = "ws://localhost:8080";
```
(No `s` in `ws://` for local plain HTTP — switch back to `wss://` once
you point at your real deployed HTTPS server.)
