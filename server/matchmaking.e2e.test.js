// Starts the real relay server and plays through matchmaking with simulated players.
// Run with:  cd server && npm test      (takes about 20 seconds: the server needs a few to start)
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { WebSocket } from "ws";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server;
let port;

before(async () => {
  port = await new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  server = spawn(process.execPath, ["index.js"], {
    cwd: new URL(".", import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), MATCH_FILL_SECONDS: "1", MATCH_VOTE_SECONDS: "4", MATCH_READY_TIMEOUT_SECONDS: "2" },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try { await fetch(`http://localhost:${port}/`); return; } catch { await sleep(250); }
  }
  throw new Error("the server didn't start");
});
after(() => server?.kill());

let nextAddress = 1;
function player(name) {
  // each simulated player comes from their own address, like real people (the server limits connections per address)
  const n = nextAddress++;
  const ws = new WebSocket(`ws://localhost:${port}`, { headers: { Origin: "https://arenaduels.github.io", "X-Forwarded-For": `10.77.${n >> 8}.${n & 255}` } });
  const p = { name, ws, got: [], id: null };
  let readyResolve;
  p.open = new Promise((r) => { readyResolve = r; });
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    p.got.push(m);
    if (m.t === "match_found" && m.role === "host") p.id = m.id;
    if (m.t === "room_joined") p.id = m.id;
    if (m.t === "auth_ready") readyResolve();
  });
  ws.on("open", () => ws.send(JSON.stringify({ t: "authenticate_guest" })));
  p.send = (o) => ws.send(JSON.stringify(o));
  p.of = (t) => p.got.filter((m) => m.t === t);
  p.last = (t) => p.of(t).at(-1);
  p.waitFor = async (t, ms = 6000) => {
    for (let waited = 0; waited < ms; waited += 25) { const m = p.of(t); if (m.length) return m.at(-1); await sleep(25); }
    throw new Error(`${name} never got "${t}" (got: ${p.got.map((m) => m.t).join(", ")})`);
  };
  return p;
}
async function search(names, mode) {
  const ps = names.map(player);
  for (const p of ps) {
    await p.open;
    p.send({ t: "find_match", mode });
    await sleep(60);        // arrive in a known order
  }
  return ps;
}
const closeAll = async (ps) => {
  await Promise.all(ps.map((p) => new Promise((resolve) => {
    if (p.ws.readyState === WebSocket.CLOSED) return resolve();
    p.ws.once("close", resolve);
    p.ws.close();
  })));
  await sleep(150);      // let the server notice, so the next test starts from an empty queue
};


test("the relay requires an explicit guest or Firebase authentication handshake before room actions", async () => {
  const ws = new WebSocket(`ws://localhost:${port}`, { headers: { Origin: "https://arenaduels.github.io" } });
  const received = [];
  ws.on("message", (raw) => received.push(JSON.parse(raw)));
  await new Promise((resolve) => ws.once("open", resolve));
  ws.send(JSON.stringify({ t: "create_room", arenaId: "classic", isPublic: false }));
  await sleep(100);
  assert.equal(received.some((m) => m.t === "room_created"), false);
  ws.send(JSON.stringify({ t: "authenticate_guest" }));
  for (let i = 0; i < 40 && !received.some((m) => m.t === "auth_ready"); i++) await sleep(25);
  assert.equal(received.some((m) => m.t === "auth_ready" && m.authenticated === false), true);
  ws.send(JSON.stringify({ t: "create_room", arenaId: "classic", isPublic: false }));
  for (let i = 0; i < 40 && !received.some((m) => m.t === "room_created"); i++) await sleep(25);
  assert.equal(received.some((m) => m.t === "room_created"), true);
  ws.close();
});

test("eight players: TDM search, vote, host loads the map, everyone is let in", async () => {
  const ps = await search(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"], "tdm");
  await Promise.all(ps.map((p) => p.waitFor("vote_start")));
  const { options } = ps[0].last("vote_start");
  assert.equal(options.length, 3);

  // everybody votes for the same map; the live tally reaches everyone
  for (const p of ps) p.send({ t: "vote", arenaId: options[1] });
  const found = await Promise.all(ps.map((p) => p.waitFor("match_found")));
  assert.equal(ps[7].last("vote_update").tally[options[1]], 8);
  assert.ok(found.every((f) => f.arenaId === options[1] && f.mode === "tdm"));

  // exactly one host: whoever searched first, and they get the room code and the mode's rules
  assert.deepEqual(found.map((f) => f.role), ["host", ...Array(7).fill("player")]);
  assert.match(found[0].code, /^\d{6}$/);
  assert.equal(found[0].settings.timeLimit, 10);
  assert.equal(found[0].settings.scoreLimit, 50);
  assert.equal(Object.keys(found[0].teams).length, 8);
  assert.equal(Object.values(found[0].teams).filter((team) => team === 0).length, 4);
  assert.equal(Object.values(found[0].teams).filter((team) => team === 1).length, 4);

  // nobody else is let in until the host says the map is built
  await sleep(300);
  assert.equal(ps[1].of("room_joined").length, 0);
  ps[0].send({ t: "match_ready" });
  const joined = await Promise.all(ps.slice(1).map((p) => p.waitFor("room_joined")));
  assert.ok(joined.every((j) => j.code === found[0].code && j.hostId === ps[0].id && j.arenaId === options[1]));
  assert.ok(joined.every((j) => JSON.stringify(j.teams) === JSON.stringify(found[0].teams)));
  assert.equal(ps[0].of("peer_joined").length, 7);

  // and it's a normal room from here: gameplay messages are relayed
  ps[0].send({ t: "state", x: 0, y: 1.4, z: 0, yaw: 0, pitch: 0, hp: 100, firing: false, tp: 0 });
  const relayed = await ps[2].waitFor("state");
  assert.equal(relayed.from, ps[0].id);
  await closeAll(ps);
});

test("custom match: Free For All holds five, a locked lobby hides its code, private is never listed", async () => {
  const host = player("host");
  await host.open;
  host.send({ t: "create_room", arenaId: "classic", isPublic: true, requireCode: true, modeId: "ffa", settings: { timeLimit: 5, scoreLimit: 10, startingHealth: 100, healthSteal: 0, respawnDelay: 2 } });
  const created = await host.waitFor("room_created");
  assert.equal(created.mode, "ffa");

  const hidden = player("hidden");
  await hidden.open;
  hidden.send({ t: "create_room", arenaId: "neon", isPublic: false, modeId: "1v1" });
  await hidden.waitFor("room_created");

  const watcher = player("watcher");
  await watcher.open;
  watcher.send({ t: "list_lobbies" });
  const list = (await watcher.waitFor("lobby_list")).lobbies.filter((l) => !l.featured); // the always-open slot is covered by its own test
  assert.equal(list.length, 1, "the private match isn't listed");
  assert.equal(list[0].locked, true);
  assert.equal(list[0].code, null, "a locked lobby's code isn't shared");
  assert.equal(list[0].mode, "ffa");
  assert.equal(list[0].maxPlayers, 5);

  const joiners = [];
  for (let i = 0; i < 4; i++) { const p = player(`j${i}`); await p.open; p.send({ t: "join_room", code: created.code }); await p.waitFor("room_joined"); joiners.push(p); }
  assert.equal(joiners[0].last("room_joined").mode, "ffa");
  const sixth = player("sixth");
  await sixth.open;
  sixth.send({ t: "join_room", code: created.code });
  assert.match((await sixth.waitFor("join_error")).error, /full/i);
  await closeAll([host, hidden, watcher, sixth, ...joiners]);
});

test("custom match: Team Deathmatch rooms balance late joiners across teams", async () => {
  const host = player("thost");
  await host.open;
  host.send({ t: "create_room", arenaId: "classic", isPublic: true, requireCode: false, modeId: "tdm" });
  const created = await host.waitFor("room_created");
  assert.deepEqual(Object.values(created.teams), [0]);
  const joiners = [];
  for (let i = 0; i < 3; i++) { const p = player(`t${i}`); await p.open; p.send({ t: "join_room", code: created.code }); await p.waitFor("room_joined"); joiners.push(p); }
  const teams = joiners.at(-1).last("room_joined").teams;
  assert.equal(Object.values(teams).filter((x) => x === 0).length, 2);
  assert.equal(Object.values(teams).filter((x) => x === 1).length, 2);
  const watcher = player("w2");
  await watcher.open;
  watcher.send({ t: "list_lobbies" });
  const lobby = (await watcher.waitFor("lobby_list")).lobbies.find((l) => !l.featured);
  assert.equal(lobby.locked, false);
  assert.equal(lobby.code, created.code);
  await closeAll([host, watcher, ...joiners]);
});

test("always-open lobby: first click opens it, later clicks join it, it reopens when its host leaves", async () => {
  const host = player("fhost");
  const other = player("fother");
  const third = player("fthird");
  await Promise.all([host.open, other.open, third.open]);
  // waitFor() hands back the newest message of a type, so count first to be sure the reply is a fresh one
  const slot = async (p) => {
    const before = p.of("lobby_list").length;
    p.send({ t: "list_lobbies" });
    for (let waited = 0; p.of("lobby_list").length === before; waited += 25) {
      if (waited > 3000) throw new Error("no lobby_list reply");
      await sleep(25);
    }
    return p.last("lobby_list").lobbies[0];
  };

  const empty = await slot(other);
  assert.deepEqual([empty.featured, empty.code, empty.playerCount, empty.maxPlayers, empty.mode], [true, null, 0, 5, "ffa"]);

  host.send({ t: "create_room", featured: true, arenaId: "classic", isPublic: false });
  const created = await host.waitFor("room_created");

  const live = await slot(other);
  assert.deepEqual([live.featured, live.code, live.playerCount], [true, created.code, 1]);

  third.send({ t: "create_room", featured: true });
  assert.equal((await third.waitFor("featured_exists")).code, created.code, "a second opener is sent to the live lobby");

  other.send({ t: "join_room", code: created.code });
  const joined = await other.waitFor("room_joined");
  assert.deepEqual([joined.arenaId, joined.mode, joined.hostId], ["foundry", "ffa", created.id], "the room comes from the preset, not the client");

  host.ws.close();
  await other.waitFor("peer_left", 3000);
  await new Promise((r) => setTimeout(r, 150));
  const reopened = await slot(third);
  assert.deepEqual([reopened.featured, reopened.code, reopened.playerCount], [true, null, 0]);
  await closeAll([host, other, third]);
});

test("different game modes are matched separately", async () => {
  const dm = await search(["a", "b"], "1v1");
  const vamp = await search(["c", "d"], "tdm");
  await Promise.all([...dm, ...vamp].map((p) => p.waitFor("vote_start", 8000)));
  assert.equal(dm[0].last("vote_start").mode, "1v1");
  assert.equal(vamp[0].last("vote_start").mode, "tdm");
  assert.equal(dm[0].last("vote_start").players, 2);
  await closeAll([...dm, ...vamp]);
});

test("two players start after the fill window, and nobody voting still picks a map", async () => {
  const ps = await search(["a", "b"], "1v1");
  const found = await Promise.all(ps.map((p) => p.waitFor("match_found", 12000)));
  const options = ps[0].last("vote_start").options;
  assert.ok(options.includes(found[0].arenaId));
  assert.equal(found[0].settings.startingHealth, 100);
  await closeAll(ps);
});

test("a host who never loads the map: the others go back to searching", async () => {
  const ps = await search(["host", "x", "y"], "tdm");
  await Promise.all(ps.map((p) => p.waitFor("match_found", 12000)));
  // the host never sends match_ready; after the timeout (2s here) everyone is told
  const cancelled = await Promise.all(ps.slice(1).map((p) => p.waitFor("match_cancelled", 6000)));
  assert.ok(cancelled.every((c) => c.requeued === true && /too long/.test(c.reason)));
  await ps[0].waitFor("match_cancelled");
  // x and y are searching again, together
  await sleep(300);
  assert.equal(ps[1].last("queue").players, 2);
  await closeAll(ps);
});

test("a host who leaves while the map loads: the others are put back in line at once", async () => {
  const ps = await search(["host", "x", "y"], "tdm");
  await Promise.all(ps.map((p) => p.waitFor("match_found", 12000)));
  ps[0].ws.close();
  const cancelled = await ps[1].waitFor("match_cancelled", 3000);
  assert.equal(cancelled.requeued, true);
  assert.match(cancelled.reason, /host left/);
  await sleep(300);
  assert.equal(ps[2].last("queue").players, 2);
  await closeAll(ps);
});

test("cancelling a search takes you out of the queue", async () => {
  const ps = await search(["a", "b", "c"], "tdm");
  await sleep(100);
  assert.equal(ps[0].last("queue").players, 3);
  ps[2].send({ t: "cancel_search" });
  await sleep(200);
  assert.equal(ps[0].last("queue").players, 2);
  await closeAll(ps);
});

test("bad requests do nothing: unknown mode, searching twice, voting when not voting", async () => {
  const [p] = [player("p")];
  await p.open;
  p.send({ t: "find_match", mode: "not-a-mode" });
  assert.match((await p.waitFor("search_error")).error, /Unknown/);
  p.send({ t: "vote", arenaId: "classic" });         // not in a vote: ignored
  p.send({ t: "find_match", mode: "tdm" });
  await p.waitFor("queue");
  p.send({ t: "find_match", mode: "tdm" });         // already searching: ignored
  p.send({ t: "find_match", mode: "1v1" });
  await sleep(300);
  assert.equal(p.of("queue").length, 1);
  await closeAll([p]);
});

test("a player who is searching isn't thrown out as idle, and nothing they send can start a game", async () => {
  const p = player("p");
  await p.open;
  p.send({ t: "find_match", mode: "tdm" });
  await p.waitFor("queue");
  p.send({ t: "create_room", arenaId: "classic", isPublic: true });   // ignored: they aren't in a room
  p.send({ t: "match_ready" });                                       // ignored: not a host
  await sleep(300);
  assert.equal(p.of("room_created").length, 0);
  assert.equal(p.ws.readyState, WebSocket.OPEN);
  await closeAll([p]);
});
