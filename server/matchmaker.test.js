// Run with:  cd server && npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Matchmaker, MATCHMAKING as M } from "./matchmaker.js";
import { GAME_MODES, MODE_IDS, getMode, isValidModeId } from "./modes.js";

const ARENAS = ["classic", "foundry", "ruins", "neon", "mansion", "glacier"];
const player = (name) => ({ id: name });

// A matchmaker with a fake clock. `random` can be scripted to force particular choices.
function setup({ random } = {}) {
  const clock = { now: 1_000_000 };
  const mm = new Matchmaker({ modeIds: MODE_IDS, arenaIds: ARENAS, random: random ?? ((n) => Math.floor(Math.random() * n)) });
  const sent = [];                       // everything ever sent: { to: [names], msg }
  const matches = [];
  const run = (outputs) => {
    for (const o of outputs) {
      if (o.action === "match") matches.push(o);
      else sent.push({ to: o.to.map((p) => p.id), msg: o.msg });
    }
    return outputs;
  };
  const last = (name, type) => [...sent].reverse().find((s) => s.to.includes(name) && s.msg.t === type)?.msg;
  return {
    mm, clock, sent, matches, last,
    search: (p, mode = "deathmatch") => run(mm.enqueue(p, mode, clock.now)),
    cancel: (p) => run(mm.cancel(p, clock.now)),
    vote: (p, arena) => run(mm.vote(p, arena, clock.now)),
    tick: (ms = 0) => { clock.now += ms; return run(mm.tick(clock.now)); },
  };
}

// ------------------------------------------------------------------------- forming a group

test("one player on their own just waits", () => {
  const t = setup();
  t.search(player("a"));
  t.tick(M.FILL_MS * 3);
  assert.equal(t.matches.length, 0);
  assert.equal(t.last("a", "queue").players, 1);
  assert.equal(t.last("a", "queue").startsInMs, null);
});

test("with two waiting, it holds a short window for more, then starts", () => {
  const t = setup();
  t.search(player("a"));
  t.search(player("b"));
  assert.equal(t.last("a", "queue").players, 2);
  assert.equal(t.last("a", "queue").startsInMs, M.FILL_MS);
  t.tick(M.FILL_MS - 1);
  assert.equal(t.sent.filter((s) => s.msg.t === "vote_start").length, 0, "not yet");
  t.tick(1);
  assert.equal(t.sent.filter((s) => s.msg.t === "vote_start").length, 1);
  assert.deepEqual(t.sent.find((s) => s.msg.t === "vote_start").to.sort(), ["a", "b"]);
});

test("a third player joining during the window is included, and the window doesn't restart", () => {
  const t = setup();
  t.search(player("a"));
  t.search(player("b"));
  t.tick(6000);
  t.search(player("c"));
  assert.equal(t.last("c", "queue").players, 3);
  assert.equal(t.last("c", "queue").startsInMs, M.FILL_MS - 6000, "the countdown carries on");
  t.tick(M.FILL_MS - 6000);
  assert.deepEqual(t.sent.find((s) => s.msg.t === "vote_start").to.sort(), ["a", "b", "c"]);
});

test("four players start straight away", () => {
  const t = setup();
  for (const n of ["a", "b", "c"]) t.search(player(n));
  assert.equal(t.sent.filter((s) => s.msg.t === "vote_start").length, 0);
  t.search(player("d"));
  const start = t.sent.find((s) => s.msg.t === "vote_start");
  assert.deepEqual(start.to.sort(), ["a", "b", "c", "d"]);
});

test("a fifth player waits for the next match, not this one", () => {
  const t = setup();
  for (const n of ["a", "b", "c", "d", "e"]) t.search(player(n));
  assert.deepEqual(t.sent.find((s) => s.msg.t === "vote_start").to.sort(), ["a", "b", "c", "d"]);
  assert.equal(t.last("e", "queue").players, 1);
});

test("each game mode has its own queue", () => {
  const t = setup();
  t.search(player("a"), "deathmatch");
  t.search(player("b"), "blitz");
  t.search(player("c"), "blitz");
  t.tick(M.FILL_MS);
  const start = t.sent.find((s) => s.msg.t === "vote_start");
  assert.equal(start.msg.mode, "blitz");
  assert.deepEqual(start.to.sort(), ["b", "c"]);
  assert.equal(t.last("a", "queue").players, 1, "the deathmatch player is still waiting alone");
});

test("people who leave the queue drop out, and the window resets if it falls below two", () => {
  const t = setup();
  t.search(player("a"));
  const b = player("b");
  t.search(b);
  t.tick(4000);
  t.cancel(b);
  assert.equal(t.last("a", "queue").players, 1);
  t.tick(M.FILL_MS * 2);
  assert.equal(t.matches.length, 0);
  t.search(player("c"));
  assert.equal(t.last("a", "queue").startsInMs, M.FILL_MS, "a fresh window, not the old one");
});

test("you can't search twice, or for a mode that doesn't exist", () => {
  const t = setup();
  const a = player("a");
  t.search(a);
  assert.match(t.search(a)[0].msg.error, /already/);
  assert.match(t.search(player("x"), "not-a-mode")[0].msg.error, /Unknown/);
});

test("searches that go on for ten minutes are given up", () => {
  const t = setup();
  t.search(player("a"));
  t.tick(M.MAX_SEARCH_MS + 1);
  assert.ok(t.sent.some((s) => s.msg.t === "search_timeout" && s.to.includes("a")));
  assert.equal(t.mm.isSearching(player("a")), false);
});

// ------------------------------------------------------------------- no skill-based matching

test("matching ignores everything but arrival order: first in, first matched", () => {
  const t = setup();
  // players carry plenty of 'skill' information; the matchmaker has nowhere to put it and never looks
  const players = ["pro", "noob", "mid", "other"].map((id, i) => ({ id, kills: [9000, 0, 40, 5][i], rank: [1, 99, 50, 20][i], account: i % 2 === 0 }));
  for (const p of players) t.search(p);
  const start = t.sent.find((s) => s.msg.t === "vote_start");
  assert.deepEqual(start.to, ["pro", "noob", "mid", "other"], "in the order they arrived, whatever their stats");
  assert.equal(Matchmaker.prototype.enqueue.length, 3, "enqueue takes only (player, mode, now)");
});

// ------------------------------------------------------------------------- the map vote

function startedVote(names = ["a", "b"], opts = {}) {
  const t = setup(opts);
  const ps = names.map(player);
  for (const p of ps) t.search(p);
  if (ps.length < M.MAX_PLAYERS) t.tick(M.FILL_MS);
  const start = t.sent.find((s) => s.msg.t === "vote_start").msg;
  return { t, ps, options: start.options };
}

test("three different maps are offered, all real ones", () => {
  const { options } = startedVote();
  assert.equal(options.length, M.MAP_OPTIONS);
  assert.equal(new Set(options).size, M.MAP_OPTIONS);
  for (const o of options) assert.ok(ARENAS.includes(o));
});

test("over many votes every map gets offered (not stuck on a few)", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) startedVote().options.forEach((o) => seen.add(o));
  assert.equal(seen.size, ARENAS.length);
});

test("votes are counted and everyone sees the running tally", () => {
  const { t, ps, options } = startedVote(["a", "b", "c"]);
  t.vote(ps[0], options[1]);
  t.vote(ps[1], options[1]);
  const u = t.last("c", "vote_update");
  assert.deepEqual(u.tally, { [options[0]]: 0, [options[1]]: 2, [options[2]]: 0 });
  assert.equal(u.voted, 2);
  assert.equal(u.players, 3);
});

test("a vote can be changed, and a vote for a map that isn't on offer is ignored", () => {
  const { t, ps, options } = startedVote();
  t.vote(ps[0], options[0]);
  t.vote(ps[0], options[2]);
  assert.equal(t.last("a", "vote_update").tally[options[0]], 0);
  assert.equal(t.last("a", "vote_update").tally[options[2]], 1);
  const before = t.sent.length;
  t.vote(ps[1], ARENAS.find((a) => !options.includes(a)));
  t.vote(ps[1], "not-a-map");
  t.vote(ps[1], undefined);
  assert.equal(t.sent.length, before, "nothing happened");
  assert.equal(t.mm.vote(player("stranger"), options[0], t.clock.now).length, 0, "someone not in the vote can't vote");
});

test("the map with the most votes wins", () => {
  const { t, ps, options } = startedVote(["a", "b", "c"]);
  t.vote(ps[0], options[2]);
  t.vote(ps[1], options[2]);
  t.vote(ps[2], options[0]);
  t.tick(M.VOTE_LOCK_MS);
  assert.equal(t.matches.length, 1);
  assert.equal(t.matches[0].arenaId, options[2]);
  assert.equal(t.last("a", "vote_result").arenaId, options[2]);
});

test("a tie is settled at random between the tied maps only", () => {
  for (const pick of [0, 1]) {
    const { t, ps, options } = startedVote(["a", "b", "c", "d"], { random: (n) => (n === 2 ? pick : 0) });
    t.vote(ps[0], options[0]);
    t.vote(ps[1], options[0]);
    t.vote(ps[2], options[2]);
    t.vote(ps[3], options[2]);
    t.tick(M.VOTE_LOCK_MS);
    assert.equal(t.matches[0].arenaId, [options[0], options[2]][pick], "only the two tied maps are in the draw");
  }
});

test("if nobody votes, one of the offered maps is picked when time runs out", () => {
  const { t, options } = startedVote();
  t.tick(M.VOTE_MS - 1);
  assert.equal(t.matches.length, 0);
  t.tick(1);
  assert.equal(t.matches.length, 1);
  assert.ok(options.includes(t.matches[0].arenaId));
});

test("once everybody has voted the vote ends shortly after, not at the full 15 seconds", () => {
  const { t, ps, options } = startedVote();
  t.tick(2000);
  t.vote(ps[0], options[0]);
  t.vote(ps[1], options[0]);
  t.tick(M.VOTE_LOCK_MS - 1);
  assert.equal(t.matches.length, 0, "a moment to see the result");
  t.tick(1);
  assert.equal(t.matches.length, 1);
});

test("the player who waited longest is the host, and the match carries the mode", () => {
  const t = setup();
  const ps = ["first", "second", "third"].map(player);
  for (const p of ps) { t.search(p, "vampire"); t.clock.now += 500; }
  t.tick(M.FILL_MS);
  t.tick(M.VOTE_MS);
  const m = t.matches[0];
  assert.deepEqual(m.players.map((p) => p.id), ["first", "second", "third"]);
  assert.equal(m.modeId, "vampire");
  assert.equal(m.entries.length, 3);
});

test("once a match is made nobody is left 'searching'", () => {
  const { t, ps } = startedVote();
  t.tick(M.VOTE_MS);
  for (const p of ps) assert.equal(t.mm.isSearching(p), false);
  assert.equal(t.mm.stats().voting, 0);
});

// ---------------------------------------------------------------- people leaving mid-vote

test("someone leaving mid-vote, with still enough players, just updates the vote", () => {
  const { t, ps, options } = startedVote(["a", "b", "c"]);
  t.vote(ps[0], options[0]);
  t.vote(ps[2], options[0]);
  t.cancel(ps[2]);
  const u = t.last("a", "vote_update");
  assert.equal(u.players, 2);
  assert.equal(u.tally[options[0]], 1, "their vote left with them");
  t.vote(ps[1], options[1]);
  t.tick(M.VOTE_LOCK_MS);
  assert.deepEqual(t.matches[0].players.map((p) => p.id), ["a", "b"]);
});

test("if everyone left still has voted when someone leaves, the vote can close", () => {
  const { t, ps, options } = startedVote(["a", "b", "c"]);
  t.vote(ps[0], options[0]);
  t.vote(ps[1], options[0]);
  t.cancel(ps[2]); // the only one who hadn't voted
  t.tick(M.VOTE_LOCK_MS);
  assert.equal(t.matches.length, 1);
});

test("if too few remain, the vote is called off and they go back to searching, ahead of newcomers", () => {
  const { t, ps } = startedVote(["a", "b"]);
  const newcomer = player("z");
  t.search(newcomer);
  t.cancel(ps[1]);
  assert.ok(t.sent.some((s) => s.msg.t === "vote_cancelled" && s.to.includes("a")));
  assert.equal(t.mm.isSearching(ps[0]), true);
  assert.equal(t.last("a", "queue").players, 2, "a and the newcomer");
  t.tick(M.FILL_MS);
  const start = t.sent.filter((s) => s.msg.t === "vote_start").at(-1);
  assert.deepEqual(start.to, ["a", "z"], "the player who'd waited longest is still first");
});

test("requeue puts a match that fell through back at the front, ahead of anyone who joined since", () => {
  const { t, ps } = startedVote(["a", "b", "c"]);
  t.tick(M.VOTE_MS);                       // the vote ends: a match is made
  t.search(player("late"));                // someone new starts searching meanwhile
  const match = t.matches[0];
  const out = t.mm.requeue(match.entries, match.modeId, t.clock.now);   // ...but the host never loaded, so the match falls through
  const start = out.find((o) => o.msg?.t === "vote_start");
  assert.deepEqual(start.to.map((p) => p.id), ["a", "b", "c", "late"], "the original players first");
  assert.ok(ps);
});

test("someone disconnecting while searching, or never searching, is harmless", () => {
  const t = setup();
  assert.deepEqual(t.mm.cancel(player("never-searched"), t.clock.now), []);
  const a = player("a");
  t.search(a);
  t.cancel(a);
  t.cancel(a);
  assert.deepEqual(t.mm.stats(), { queued: {}, voting: 0 });
});

// ------------------------------------------------------------------------------ the modes

test("every game mode is well formed and its rules are inside the game's limits", () => {
  assert.ok(GAME_MODES.length >= 4);
  assert.equal(new Set(MODE_IDS).size, MODE_IDS.length, "ids are unique");
  const limits = { timeLimit: [0, 60], scoreLimit: [0, 200], startingHealth: [10, 500], healthSteal: [0, 100], respawnDelay: [0, 10] };
  for (const m of GAME_MODES) {
    assert.match(m.id, /^[a-z-]+$/);
    assert.ok(m.name && m.tagline && m.description, m.id);
    assert.deepEqual(Object.keys(m.settings).sort(), Object.keys(limits).sort(), m.id);
    for (const [k, [lo, hi]] of Object.entries(limits)) assert.ok(m.settings[k] >= lo && m.settings[k] <= hi, `${m.id}.${k}=${m.settings[k]}`);
    assert.ok(m.settings.timeLimit > 0 || m.settings.scoreLimit > 0, `${m.id} has to be able to end`);
  }
  assert.equal(isValidModeId("deathmatch"), true);
  assert.equal(isValidModeId("nope"), false);
  assert.equal(isValidModeId({}), false);
  assert.equal(getMode("nope").id, GAME_MODES[0].id);
});

test("the game's own settings checker leaves every mode unchanged", { skip: !fs.existsSync(new URL("../js/match.js", import.meta.url)) }, async () => {
  const { sanitizeSettings } = await import("../js/match.js");
  for (const m of GAME_MODES) assert.deepEqual({ ...sanitizeSettings(m.settings) }, { ...sanitizeSettings(m.settings), ...m.settings }, m.id);
});

test("the browser and the server use identical mode files", { skip: !fs.existsSync(new URL("../js/modes.js", import.meta.url)) }, () => {
  assert.equal(fs.readFileSync(new URL("./modes.js", import.meta.url), "utf8"), fs.readFileSync(new URL("../js/modes.js", import.meta.url), "utf8"));
});
