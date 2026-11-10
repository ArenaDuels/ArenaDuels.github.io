import test from "node:test";
import assert from "node:assert/strict";
import { uidBusyElsewhere, uidInRoom } from "./sessions.js";

const sock = (o = {}) => ({ OPEN: 1, readyState: 1, uid: null, searching: false, room: null, pendingRoom: null, ...o });

test("a second tab of the same account is busy while the first is searching, loading or in a room", () => {
  for (const state of [{ searching: true }, { room: "123456" }, { pendingRoom: "123456" }]) {
    const a = sock({ uid: "u1", ...state });
    const b = sock({ uid: "u1" });
    assert.equal(uidBusyElsewhere([a, b], b), true);
  }
});

test("idle sockets, other accounts, closed sockets and guests are not busy", () => {
  const idle = sock({ uid: "u1" });
  const me = sock({ uid: "u1" });
  assert.equal(uidBusyElsewhere([idle, me], me), false);
  assert.equal(uidBusyElsewhere([sock({ uid: "u2", searching: true }), me], me), false);
  assert.equal(uidBusyElsewhere([sock({ uid: "u1", searching: true, readyState: 3 }), me], me), false);
  const guest = sock();
  assert.equal(uidBusyElsewhere([sock({ searching: true }), guest], guest), false);
  assert.equal(uidBusyElsewhere([me], me), false);
});

test("uidInRoom spots the same account already in a room", () => {
  const a = sock({ uid: "u1" });
  const b = sock({ uid: "u1" });
  const room = { members: new Map([["x", a]]) };
  assert.equal(uidInRoom(room, b), true);
  assert.equal(uidInRoom(room, sock({ uid: "u2" })), false);
  assert.equal(uidInRoom(room, sock()), false);
});
