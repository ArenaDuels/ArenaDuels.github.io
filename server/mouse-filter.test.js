import test from "node:test";
import assert from "node:assert/strict";
import { JumpFilter } from "../js/mouse-filter.js";

// Runs a list of [dx, dy, msSinceStart] movements through a filter and sums what comes out.
function run(events, flushAt) {
  const f = new JumpFilter();
  let x = 0, y = 0;
  const apply = (moves) => { for (const [mx, my] of moves) { x += mx; y += my; } };
  for (const [dx, dy, t] of events) apply(f.push(dx, dy, t));
  if (flushAt !== undefined) apply(f.flush(flushAt));
  return { x, y, ignored: f.ignored, held: f.held };
}

test("ordinary mouse movement passes straight through, untouched", () => {
  const r = run([[3, 1, 0], [-2, 0, 1], [5, 5, 2], [0, -4, 3], [100, 20, 4]]);
  assert.deepEqual([r.x, r.y, r.ignored], [106, 22, 0]);
});

test("a big jump that is immediately undone is thrown away, both halves", () => {
  const r = run([[2, 0, 0], [400, 150, 1], [-398, -151, 2], [3, 0, 3]]);
  assert.deepEqual([r.x, r.y, r.ignored], [5, 0, 1]);
});

test("a fast real flick (a run of big events one way) is kept whole", () => {
  const events = [[150, 0, 0], [180, 0, 2], [200, 0, 4], [160, 0, 6], [120, 0, 8], [40, 0, 10]];
  const r = run(events, 100);
  assert.equal(r.x, 850, "every count of the flick is applied");
  assert.equal(r.ignored, 0);
});

test("a big move that is NOT undone is real: it is applied once the next move arrives", () => {
  const r = run([[500, 0, 0], [10, 0, 1]]);
  assert.deepEqual([r.x, r.ignored], [510, 0]);
});

test("a big move with nothing after it is released a few milliseconds later, not lost", () => {
  const f = new JumpFilter();
  assert.deepEqual(f.push(300, 0, 0), [], "held for the moment");
  assert.deepEqual(f.flush(10), [], "too soon to release");
  assert.deepEqual(f.flush(30), [[300, 0]], "released after 25ms");
  assert.deepEqual(f.flush(60), [], "and only once");
});

test("coming back only partway is not a snap-and-return: nothing is ignored", () => {
  const r = run([[400, 0, 0], [-100, 0, 1]]);
  assert.deepEqual([r.x, r.ignored], [300, 0]);
});

test("two big jumps in a row the same way are both kept", () => {
  const r = run([[300, 0, 0], [300, 0, 1], [1, 0, 2]], 100);
  assert.deepEqual([r.x, r.ignored], [601, 0]);
});

test("repeated snap-and-return pulses (another game recentring over and over) are all ignored", () => {
  const events = [];
  for (let i = 0; i < 20; i++) events.push([350, -120, i * 4], [-349, 121, i * 4 + 1], [2, 0, i * 4 + 2]);
  const r = run(events);
  assert.equal(r.ignored, 20);
  assert.deepEqual([r.x, r.y], [40, 0], "only the real 2-count moves remain");
});
