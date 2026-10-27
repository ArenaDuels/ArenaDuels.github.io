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

## The server runs the fight (anticheat.js)

The server is now the authority on health, hits, deaths and respawns. Browsers
still simulate their own movement (so it stays smooth) but no longer decide
anything that matters:

- **Hits and damage:** browsers don't report hits at all. They say where they are,
  where they're aiming and whether the trigger is held. About 30 times a second
  the server works out who each beam is on (aim, range, walls in the way, with a
  little lag allowance) and takes 40 damage per second off them. Health steal is
  applied here too.
- **Health, deaths, respawns:** the server keeps everyone's health, announces each
  kill (and who gets it), waits out the respawn delay and puts the player back at a
  spawn point it picks. Other players see the server's health number, not the
  player's own claim.
- **Movement:** every reported position is checked: top speed (21 m/s, honest play
  peaks at ~19.75), saved-up allowance for lag (~1s), arena bounds, walking into or
  through walls, jump height and hovering. A position that can't be real is thrown
  away and the player is snapped back (`correct` message).
- **Bots** run on the host's browser, so the host still owns them. A bot shooting a
  player is checked (aim, line of sight, damage rate) and then applied to that
  player's health by the server. A player's beam on a bot is forwarded to the host.
  The host announces bot deaths, once per life.

What this does *not* stop: an aimbot (perfect aim sent as honest-looking aim), a
modified client that simply plays well within the movement limits (for example
~20% faster than normal running), or the host cheating with their own bots and
score. Aim and the host are the two things a relay has to trust.

Environment variable `ANTICHEAT`:

- `enforce` (default): impossible movement is undone, impossible bot shots refused.
- `log`: movement problems and bot shots are only counted, nothing is undone.
  Use it to look for false positives before enforcing.

(`off` no longer exists: the game depends on the server for health.)

Once a minute the server prints a line like
`[anticheat:enforce] last minute: move:speed=12 bot-hit:off-target=3`
(nothing is printed when nothing was rejected).

The browser and the server must be deployed together: an older cached copy of the
game doesn't understand the server's health and respawn messages.

## Account names (names.js, nameTickets.js)

Every name the game hands out is **Adjective + Noun + two digits**, like `SwiftViper42`
or `GallantCheetah98`: 274 adjectives x 320 nouns x 88 numbers = about **7.7 million**
different names, all at most 16 characters. Guests get one at random in the browser;
account names come from the server.

You can't create an account with a name you made up:

1. The dice button asks the server for a name. The server picks one at random,
   checks it's free, and signs it (a "name ticket", good for 15 minutes).
2. Signing up needs the name **and** its ticket. The server refuses a name that
   isn't one the generator can produce, and a name without a valid ticket for that
   exact name, so a script can't pick `NovaViper99` for itself.
3. Each address can roll 60 names per 10 minutes, so nobody can sit rolling
   thousands of times to cherry-pick one. (Rolling a few times until you like what
   you get is how the dice button is meant to work.)

Old accounts (one word + two digits, like `Blaze42`) keep working at sign-in; that
style just isn't handed out any more. The numbers 69 and 88 are never handed out,
and a few word pairs that run together into something rude are banned. `npm test`
scans **every** pair of words for that, so adding a word that creates a new accident
fails the tests.

Setting: `NAME_TICKET_SECRET` — a long random string (any 30+ characters). Without
it the server makes up a temporary one at start-up: fine for one server, but name
offers still open at a restart stop working (the page just rolls a new name).

`js/names.js` and `server/names.js` are identical copies (a test checks that). To add
words, edit one and copy it over the other.

`server/arenas.js` and `server/arenas/` are identical copies of `js/arenas.js`
and `js/arenas/`. **If you change an arena's walls or props, copy the files to
both places** — otherwise the server checks line of sight against old walls.

Run the tests with `cd server && npm test`. `movement-replay.test.js` replays random
honest play through a port of the browser's physics on every arena and fails if the
movement rules would ever flag it; if you change the movement numbers in
`js/player.js`, update the port at the top of that file and re-run.


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
