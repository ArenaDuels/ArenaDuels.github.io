// Ignores the "snap and return" mouse jumps another program can cause.
//
// If a second game keeps pulling the cursor back to the middle of the screen, the browser can report a huge
// movement in one direction followed straight away by about the same movement the other way. A real flick of
// the mouse never does that: a fast move is a run of events in one direction, not a spike that undoes itself.
//
// So a big single movement is held back for a moment. If the very next movement cancels it out, both are
// thrown away. If not, the held one is applied after all (and a held movement is released after a few
// milliseconds even if nothing follows, so aiming never waits long). Everything small passes straight through.

export const JUMP_THRESHOLD = 120; // counts in one event before it is held and checked
export const CANCEL_RATIO = 0.5;   // the pair counts as a snap-and-return if they cancel to under this fraction of the first
export const MAX_HOLD_MS = 25;

export class JumpFilter {
  constructor({ threshold = JUMP_THRESHOLD, cancelRatio = CANCEL_RATIO, maxHoldMs = MAX_HOLD_MS } = {}) {
    this.threshold = threshold;
    this.cancelRatio = cancelRatio;
    this.maxHoldMs = maxHoldMs;
    this.held = null; // { x, y, at }
    this.ignored = 0; // how many jumps have been thrown away (shown in the F9 overlay)
  }

  // One mouse movement in; the movements to apply right now come out (none, one, or two).
  push(dx, dy, now) {
    const out = [];
    if (this.held) {
      const h = this.held;
      this.held = null;
      const hl = Math.hypot(h.x, h.y);
      const undone = Math.hypot(h.x + dx, h.y + dy) < this.cancelRatio * hl && h.x * dx + h.y * dy < 0;
      if (undone) {
        this.ignored += 1; // a jump that came straight back: ignore both halves
        return out;
      }
      out.push([h.x, h.y]); // it was real after all
    }
    if (Math.hypot(dx, dy) > this.threshold) this.held = { x: dx, y: dy, at: now };
    else out.push([dx, dy]);
    return out;
  }

  // Call every frame: a held movement nothing followed is real, so let it go.
  flush(now) {
    if (this.held && now - this.held.at >= this.maxHoldMs) {
      const h = this.held;
      this.held = null;
      return [[h.x, h.y]];
    }
    return [];
  }

  reset() {
    this.held = null;
  }
}
