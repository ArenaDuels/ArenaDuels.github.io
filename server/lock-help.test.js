import test from "node:test";
import assert from "node:assert/strict";
import { lockFailureReason } from "../js/lock-help.js";

test("an unfocused window is blamed first, and the message points at another program", () => {
  const msg = lockFailureReason({ hasFocus: false, errorName: "NotAllowedError" });
  assert.match(msg, /isn't the active window/);
  assert.match(msg, /Another program/);
});

test("a focused window with a refusal names the browser's error", () => {
  assert.match(lockFailureReason({ hasFocus: true, errorName: "InvalidStateError" }), /\(InvalidStateError\)/);
});

test("with no details it still gives a plain sentence", () => {
  assert.match(lockFailureReason({ hasFocus: true }), /didn't give the game the mouse/);
  assert.match(lockFailureReason(), /didn't give the game the mouse/);
});
