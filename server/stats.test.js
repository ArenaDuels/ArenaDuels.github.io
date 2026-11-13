import test from "node:test";
import assert from "node:assert/strict";
import { MatchTally, createStatsStore, STATS } from "./stats.js";

const T0 = 1_000_000;
const duel = (extra = {}) => {
  const t = new MatchTally({ settings: { scoreLimit: 3, timeLimit: 10 }, now: T0, ...extra });
  t.addPlayer("a", { uid: "uA", name: "Alpha" });
  t.addPlayer("b", { uid: "uB", name: "Bravo" });
  return t;
};
const kills = (t, who, victim, n) => { for (let i = 0; i < n; i++) t.addKill(who, victim); };

test("kills and deaths follow the scoreboard rules", () => {
  const t = duel();
  t.addKill("a", "b");
  t.addKill("a", "a"); // a self-kill is a death, not a kill
  assert.equal(t.players.get("a").kills, 1);
  assert.equal(t.players.get("a").deaths, 1);
  assert.equal(t.players.get("b").deaths, 1);
});

test("a bot (or anyone not in the match) as the victim changes nothing", () => {
  const t = duel();
  assert.equal(t.addKill("a", "bot-1"), false);
  assert.equal(t.players.get("a").kills, 0);
});

test("score ending: only legit once someone really reached the limit, and not too early", () => {
  const t = duel();
  kills(t, "a", "b", 3);
  assert.equal(t.endIsLegit("score", T0 + 5_000), false, "too short to count");
  assert.equal(t.endIsLegit("score", T0 + STATS.MIN_MATCH_MS), true);
  const u = duel();
  kills(u, "a", "b", 2);
  assert.equal(u.endIsLegit("score", T0 + 60_000), false, "host claims a score win that did not happen");
});

test("time ending: not before the time limit, allowed a little early for clock drift", () => {
  const t = duel();
  assert.equal(t.endIsLegit("time", T0 + 60_000), false, "host ends it after a minute");
  assert.equal(t.endIsLegit("time", T0 + 10 * 60_000 - STATS.TIME_GRACE_MS + 1), true);
  assert.equal(t.endIsLegit("nonsense", T0 + 20 * 60_000), false);
});

test("the winner has the most kills; the other player gets a loss", () => {
  const t = duel();
  kills(t, "a", "b", 3);
  kills(t, "b", "a", 1);
  const rows = Object.fromEntries(t.finish().map((r) => [r.uid, r]));
  assert.equal(rows.uA.result, "win");
  assert.equal(rows.uB.result, "loss");
  assert.deepEqual([rows.uA.kills, rows.uA.deaths, rows.uB.kills, rows.uB.deaths], [3, 1, 1, 3]);
});

test("equal kills: fewer deaths wins; identical records are a draw", () => {
  const t = duel();
  t.addPlayer("c", { uid: "uC", name: "Charlie" });
  kills(t, "a", "b", 2);
  kills(t, "b", "a", 2);
  kills(t, "a", "c", 1);
  kills(t, "c", "a", 1);
  // a: 3 kills 3 deaths, b: 2 kills 2 deaths, c: 1 kill 1 death
  assert.equal(t.finish().find((r) => r.uid === "uA").result, "win");
  const d = duel();
  kills(d, "a", "b", 1);
  kills(d, "b", "a", 1);
  assert.deepEqual(d.finish().map((r) => r.result), ["draw", "draw"]);
});

test("team deathmatch: the team with more kills wins, ties are draws", () => {
  const t = new MatchTally({ settings: { scoreLimit: 2, timeLimit: 10 }, teamMode: true, now: T0 });
  t.addPlayer("a", { uid: "uA", name: "A", team: 0 });
  t.addPlayer("b", { uid: "uB", name: "B", team: 0 });
  t.addPlayer("c", { uid: "uC", name: "C", team: 1 });
  kills(t, "a", "c", 1);
  kills(t, "b", "c", 1);
  assert.equal(t.endIsLegit("score", T0 + 60_000), true);
  const rows = Object.fromEntries(t.finish().map((r) => [r.uid, r.result]));
  assert.deepEqual(rows, { uA: "win", uB: "win", uC: "loss" });
  const u = new MatchTally({ settings: { scoreLimit: 5, timeLimit: 10 }, teamMode: true, now: T0 });
  u.addPlayer("a", { uid: "uA", name: "A", team: 0 });
  u.addPlayer("c", { uid: "uC", name: "C", team: 1 });
  assert.deepEqual(u.finish().map((r) => r.result), ["draw", "draw"]);
});

test("a finished match ignores further kills and cannot be finished twice", () => {
  const t = duel();
  kills(t, "a", "b", 3);
  t.finish();
  assert.equal(t.addKill("b", "a"), false);
  assert.equal(t.endIsLegit("score", T0 + 120_000), false);
});

test("leaving a game that is still going is a loss, even when you were winning", () => {
  const t = new MatchTally({ settings: { scoreLimit: 30, timeLimit: 10 }, now: T0 });
  t.addPlayer("a", { uid: "uA", name: "Alpha" });
  t.addPlayer("b", { uid: "uB", name: "Bravo" });
  t.addPlayer("c", { uid: "uC", name: "Charlie" });
  kills(t, "a", "b", 5); // a is well ahead
  const rows = t.markLeft("a", T0 + 10_000);
  assert.deepEqual(rows, [{ uid: "uA", name: "Alpha", kills: 5, deaths: 0, result: "loss" }]);
  assert.deepEqual(t.markLeft("a", T0 + 11_000), [], "only once");
  kills(t, "b", "c", 2);
  // the finish counts only the players still in, so the leaver can't also "win" or lose twice
  const end = Object.fromEntries(t.finish().map((r) => [r.uid, r.result]));
  assert.deepEqual(end, { uB: "win", uC: "loss" });
});

test("1v1: when one player leaves, the other wins (once the game had got going)", () => {
  const t = duel();
  kills(t, "a", "b", 1);
  const rows = Object.fromEntries(t.markLeft("b", T0 + 60_000).map((r) => [r.uid, r.result]));
  assert.deepEqual(rows, { uB: "loss", uA: "win" });
  assert.equal(t.finished, true);
  assert.deepEqual(t.partial(), []);
});

test("1v1: leaving in the first seconds is still a loss, but the other player is not handed a win", () => {
  const t = duel();
  const rows = t.markLeft("b", T0 + 5_000);
  assert.deepEqual(rows.map((r) => [r.uid, r.result]), [["uB", "loss"]]);
  assert.equal(t.finished, false);
});

test("team game: a whole team leaving gives the other team the win", () => {
  const t = new MatchTally({ settings: { scoreLimit: 50, timeLimit: 10 }, teamMode: true, now: T0 });
  t.addPlayer("a", { uid: "uA", name: "A", team: 0 });
  t.addPlayer("b", { uid: "uB", name: "B", team: 0 });
  t.addPlayer("c", { uid: "uC", name: "C", team: 1 });
  assert.deepEqual(t.markLeft("a", T0 + 60_000).map((r) => r.result), ["loss"]);
  const last = Object.fromEntries(t.markLeft("b", T0 + 61_000).map((r) => [r.uid, r.result]));
  assert.deepEqual(last, { uB: "loss", uC: "win" });
});

test("leaving after the game is over is not a loss", () => {
  const t = duel();
  kills(t, "a", "b", 3);
  t.finish();
  assert.deepEqual(t.markLeft("b", T0 + 90_000), []);
});

test("once the host has ended the game, leaving the scoreboard is not a loss", () => {
  const t = duel();
  t.hostEnded = true; // e.g. the server did not accept it as a real finish, but everyone sees the scoreboard
  assert.deepEqual(t.markLeft("b", T0 + 90_000), []);
  t.restart(T0 + 100_000);
  assert.equal(t.hostEnded, false);
});

test("Play Again starts clean without the players who left", () => {
  const t = duel();
  t.markLeft("b", T0 + 5_000);
  t.restart(T0 + 200_000);
  assert.equal(t.players.size, 1);
  assert.equal(t.players.get("a").kills, 0);
  assert.equal(t.finished, false);
});

test("an unfinished match keeps kills and deaths but gives no win or loss", () => {
  const t = duel();
  kills(t, "a", "b", 2);
  const rows = t.partial();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.result === null));
  t.finish();
  assert.deepEqual(t.partial(), []);
});

// ---- the Firestore side, against a tiny fake ----
function fakeFirestore() {
  const writes = [];
  const docs = new Map();
  let queries = 0;
  return {
    writes, get queries() { return queries; },
    batch: () => ({
      set: (ref, data, opts) => writes.push({ id: ref.id, data, opts }),
      commit: async () => {},
    }),
    collection: () => ({
      doc: (id) => ({ id, get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }) }),
      where: () => ({
        orderBy: () => ({ limit: () => ({ get: async () => { queries++; return { docs: [{ data: () => ({ username: "Top", kills: 9, wins: 2 }) }] }; } }) }),
        count: () => ({ get: async () => ({ data: () => ({ count: 4 }) }) }),
      }),
    }),
    docs,
  };
}
const FieldValue = { increment: (n) => ({ inc: n }), serverTimestamp: () => "ts" };

test("recordResults saves accounts only, as increments, in one batch", async () => {
  const fs = fakeFirestore();
  const store = createStatsStore({ firestore: fs, FieldValue });
  const n = await store.recordResults([
    { uid: "uA", name: "Alpha", kills: 3, deaths: 1, result: "win" },
    { uid: null, name: "Guest", kills: 5, deaths: 0, result: "win" },
    { uid: "uB", name: "Bravo", kills: 1, deaths: 3, result: "loss" },
    { uid: "uC", name: "Cee", kills: 2, deaths: 2, result: null },
  ]);
  assert.equal(n, 3);
  assert.equal(fs.writes.length, 3);
  const a = fs.writes.find((w) => w.id === "uA").data;
  assert.deepEqual([a.kills, a.deaths, a.wins, a.losses, a.matches], [{ inc: 3 }, { inc: 1 }, { inc: 1 }, { inc: 0 }, { inc: 1 }]);
  const c = fs.writes.find((w) => w.id === "uC").data;
  assert.deepEqual([c.wins, c.losses, c.matches], [{ inc: 0 }, { inc: 0 }, { inc: 0 }], "no result = kills and deaths only");
  assert.ok(fs.writes.every((w) => w.opts.merge === true));
});

test("getStats returns zeros for a new account and a rank for one with kills", async () => {
  const fs = fakeFirestore();
  const store = createStatsStore({ firestore: fs, FieldValue });
  assert.deepEqual(await store.getStats("new"), { kills: 0, deaths: 0, wins: 0, losses: 0, matches: 0, rank: { kills: null, wins: null } });
  fs.docs.set("uA", { kills: 7, deaths: 2, wins: 1, losses: 0, matches: 1 });
  const s = await store.getStats("uA");
  assert.equal(s.kills, 7);
  assert.equal(s.rank.kills, 5);
});

test("the leaderboard is cached briefly and rejects unknown boards", async () => {
  const fs = fakeFirestore();
  let t = 0;
  const store = createStatsStore({ firestore: fs, FieldValue, now: () => t });
  const first = await store.leaderboard("kills");
  assert.equal(first[0].rank, 1);
  await store.leaderboard("kills");
  assert.equal(fs.queries, 1, "second call came from the cache");
  t = STATS.BOARD_CACHE_MS + 1;
  await store.leaderboard("kills");
  assert.equal(fs.queries, 2);
  await assert.rejects(() => store.leaderboard("deaths; drop table"));
});
