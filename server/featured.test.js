import test from "node:test";
import assert from "node:assert/strict";
import { FEATURED_LOBBY, getMode, isValidModeId } from "./modes.js";
import { cleanLobbies, isValidArenaId, cleanRelay } from "./validate.js";

test("the always-open lobby preset is valid and fits its mode", () => {
  assert.ok(isValidModeId(FEATURED_LOBBY.modeId));
  assert.ok(isValidArenaId(FEATURED_LOBBY.arenaId));
  assert.equal(getMode(FEATURED_LOBBY.modeId).maxPlayers, 5);
  assert.equal(FEATURED_LOBBY.botCount, 3);
  assert.equal(FEATURED_LOBBY.rules.timeLimit, 10);
  assert.equal(FEATURED_LOBBY.rules.scoreLimit, 0, "the 10 minute clock, not a score limit, ends each game");
  const rules = cleanRelay({ t: "restart", settings: FEATURED_LOBBY.rules });
  assert.equal(rules.settings.timeLimit, 10);
  assert.equal(rules.settings.scoreLimit, 0);
});

test("the lobby list keeps the always-open slot even when nobody has opened it", () => {
  const out = cleanLobbies([
    { featured: true, code: null, locked: false, mode: "ffa", arenaId: FEATURED_LOBBY.arenaId, playerCount: 0, maxPlayers: 5 },
    { featured: true, code: "123456", locked: false, mode: "ffa", arenaId: FEATURED_LOBBY.arenaId, playerCount: 2, maxPlayers: 5 },
    { code: null, locked: false, mode: "ffa", arenaId: FEATURED_LOBBY.arenaId, playerCount: 1, maxPlayers: 5 }, // not featured, no code: dropped
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].featured, out[0].code], [true, null]);
  assert.deepEqual([out[1].featured, out[1].code, out[1].playerCount], [true, "123456", 2]);
});

test("a junk code on the always-open slot is ignored, not trusted", () => {
  const [row] = cleanLobbies([{ featured: true, code: "<script>", locked: false, mode: "ffa", arenaId: FEATURED_LOBBY.arenaId, playerCount: 0, maxPlayers: 5 }]);
  assert.equal(row.code, null);
});
