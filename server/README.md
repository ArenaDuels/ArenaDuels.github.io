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

## Security settings

The relay treats every client as untrusted. Built in (no setup needed):
message size cap (8 KB), per-connection rate limit, 8 connections per IP,
strict validation of every gameplay message, host-only messages enforced,
no impersonation of other players, brute-force limiting on room codes.

Optional environment variables:

- `ALLOWED_ORIGINS` — comma-separated list of sites allowed to connect.
  Defaults to `https://arenaduels.github.io` only. Connections from any other
  website (or with no Origin header) are refused. Add extra entries here if you
  need local testing, e.g. `https://arenaduels.github.io,http://localhost:5500`.
- `TRUST_PROXY` — set to `0` if the server is NOT behind a proxy
  (Render/Railway/Fly are; leave it alone there).

`server/validate.js` is an identical copy of `js/validate.js`. If you change
the message rules, copy the file to both places.

## Hit and kill checking (anticheat.js)

The browsers still run the game, so the server can't see a shot happen — instead
it keeps its own record of where everyone was, who is alive and how much damage
each player has taken, and refuses messages that don't fit:

- **Hits** need an attacker who is alive and firing, a real living opponent as the
  target, and the target inside the shooter's aim (with some lag allowance),
  within range, with no wall in between. Damage is clamped to the beam's real
  rate (40/s), so nobody can send huge or rapid-fire damage.
- **Kills** are only accepted for a player who has actually taken lethal damage
  from hits the server accepted. The server decides who gets the kill; whatever
  the client claimed is ignored. Dead players can't be hit or shoot until they
  respawn.

What this does *not* stop: a modified client that sends honest-looking positions
and aims perfectly (aimbot), or one that ignores damage on its own screen
(god mode). That needs the server to run movement and health itself.

Environment variable `ANTICHEAT`:

- `enforce` (default) — bad hits/kills are dropped.
- `log` — nothing is dropped; what *would* have been rejected is printed once a
  minute. Use this to check for false positives before enforcing.
- `off` — no checking.

Once a minute the server prints a line like
`[anticheat:enforce] last minute: hit:off-target=12 kill:not-enough-damage=1`
(nothing is printed when nothing was rejected).

`server/arenas.js` and `server/arenas/` are identical copies of `js/arenas.js`
and `js/arenas/`. **If you change an arena's walls or props, copy the files to
both places** — otherwise the server checks line of sight against old walls.

Run the tests with `cd server && npm test`.


## Optional username/password accounts

The game remains playable as a guest. The account system is optional and uses randomly generated names (the register UI allows rerolling); it does not ask for email.

Render setup:
- Secret File: `/etc/secrets/firebase-service-account.json`
- Environment variable: `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/firebase-service-account.json`
- Environment variable: `FIREBASE_PROJECT_ID=arenaduels-7dc31`
- Keep the service-account JSON out of Git and never put it in the browser bundle.
- Firebase Authentication must be enabled for the project; the client signs in with server-created Firebase custom tokens.
- Firestore client rules should remain deny-all. The server uses Admin SDK access.
- The server stores password hashes made with scrypt plus per-account random salts, never plaintext passwords.
- Account creation and login are served from `/api/auth/register` and `/api/auth/login`; `/api/auth/random-name` returns an available generated name.

There is no email-based password recovery in this version. If a password is lost, the account cannot currently be recovered.


### Cloudflare Turnstile for account registration

- The registration form uses the public Turnstile site key configured in `index.html`.
- Add a Render environment variable named `TURNSTILE_SECRET_KEY` with the widget's **secret key**. Never commit the secret key to GitHub or put it in browser code.
- The server validates every registration token against Cloudflare Siteverify and checks that the returned hostname is `arenaduels.github.io`. Login and guest play do not require a challenge.
- If you recreate the Turnstile widget or change hostnames, update the site key and server-side hostname check accordingly.
