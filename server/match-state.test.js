import test from "node:test";
import assert from "node:assert/strict";
import { MatchState } from "../js/match.js";

test("TDM counts kills by team and ends at the team score limit", () => {
  const match = new MatchState();
  match.start({ timeLimit: 10, scoreLimit: 2, startingHealth: 100, modeId: "tdm" });
  match.ensurePlayer("blue1", "Blue1", 0);
  match.ensurePlayer("blue2", "Blue2", 0);
  match.ensurePlayer("red1", "Red1", 1);
  match.addKill("blue1", "red1");
  match.addKill("blue2", "red1");
  assert.deepEqual(match.teamKills, [2, 0]);
  assert.equal(match.checkEnd(), "score");
  assert.equal(match.winnerTeam(), 0);
  assert.equal(match.winner()?.team, 0);
});

test("TDM ties at time expiry remain a draw", () => {
  const match = new MatchState();
  match.start({ timeLimit: 10, scoreLimit: 50, startingHealth: 100, modeId: "tdm" });
  match.ensurePlayer("blue", "Blue", 0);
  match.ensurePlayer("red", "Red", 1);
  match.addKill("blue", "red");
  match.addKill("red", "blue");
  assert.deepEqual(match.teamKills, [1, 1]);
  assert.equal(match.winnerTeam(), null);
  assert.equal(match.winner(), null);
});

test("1v1 remains an individual first-to-score match", () => {
  const match = new MatchState();
  match.start({ timeLimit: 10, scoreLimit: 2, startingHealth: 100, modeId: "1v1" });
  match.ensurePlayer("a", "A");
  match.ensurePlayer("b", "B");
  match.addKill("a", "b");
  match.addKill("a", "b");
  assert.equal(match.checkEnd(), "score");
  assert.equal(match.winner()?.id, "a");
});
