// Match rules + scoreboard state. Pure logic (no DOM, no three.js) so it can
// be shared by the HUD, the network code and the tests.
//
// Who is authoritative:
//   - Kills are announced by whoever detects the death (the victim's own
//     client for humans, the host for bots) and every client applies the
//     same event, so every scoreboard stays in step.
//   - The HOST owns the clock and decides when the match ends; clients just
//     tick a local copy for a smooth display and obey the host's "end".

export const DEFAULT_SETTINGS = Object.freeze({
  timeLimit: 10,      // minutes, 0 = no time limit
  scoreLimit: 20,     // kills to win, 0 = no score limit
  startingHealth: 100,
  healthSteal: 0,     // % of damage dealt that heals the attacker
  respawnDelay: 2,    // seconds
});

// Keep whatever arrives over the network (or from sliders) in sane ranges.
export function sanitizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return s;
  const num = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  s.timeLimit = Math.round(num(raw.timeLimit, 0, 60, s.timeLimit));
  s.scoreLimit = Math.round(num(raw.scoreLimit, 0, 200, s.scoreLimit));
  s.startingHealth = Math.round(num(raw.startingHealth, 10, 500, s.startingHealth));
  s.healthSteal = Math.round(num(raw.healthSteal, 0, 100, s.healthSteal));
  s.respawnDelay = num(raw.respawnDelay, 0, 30, s.respawnDelay);
  return s;
}

export class MatchState {
  constructor() {
    this.scores = new Map(); // id -> { id, name, kills, deaths }
    this.start(DEFAULT_SETTINGS);
  }

  /** (Re)start the clock and zero everyone's kills/deaths. Keeps the roster. */
  start(settings) {
    this.settings = sanitizeSettings(settings);
    this.remaining = this.settings.timeLimit > 0 ? this.settings.timeLimit * 60 : Infinity;
    this.over = false;
    this.reason = null;
    for (const e of this.scores.values()) {
      e.kills = 0;
      e.deaths = 0;
    }
  }

  ensurePlayer(id, name) {
    let e = this.scores.get(id);
    if (!e) {
      e = { id, name: name || "Player", kills: 0, deaths: 0 };
      this.scores.set(id, e);
    } else if (name) {
      e.name = name;
    }
    return e;
  }

  removePlayer(id) {
    this.scores.delete(id);
  }

  nameOf(id) {
    return this.scores.get(id)?.name ?? "Player";
  }

  /** Apply one kill. Returns false if it was ignored (match already over). */
  addKill(attackerId, victimId) {
    if (this.over) return false;
    const victim = this.scores.get(victimId);
    const attacker = this.scores.get(attackerId);
    if (victim) victim.deaths++;
    if (attacker && attackerId !== victimId) attacker.kills++;
    return true;
  }

  tick(dt) {
    if (this.over || !Number.isFinite(this.remaining)) return;
    this.remaining = Math.max(0, this.remaining - dt);
  }

  /** Host clock correction for clients. */
  setRemaining(seconds) {
    if (this.over) return;
    this.remaining = seconds < 0 ? Infinity : seconds;
  }

  /** "score" | "time" | null — whether the match should end right now. */
  checkEnd() {
    if (this.over) return null;
    const limit = this.settings.scoreLimit;
    if (limit > 0) {
      for (const e of this.scores.values()) if (e.kills >= limit) return "score";
    }
    if (Number.isFinite(this.remaining) && this.remaining <= 0) return "time";
    return null;
  }

  finish(reason) {
    this.over = true;
    this.reason = reason;
  }

  /** Best first: most kills, then fewest deaths, then name. */
  ranking() {
    return [...this.scores.values()].sort(
      (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name)
    );
  }

  /** The winner, or null for a tie / empty match. */
  winner() {
    const r = this.ranking();
    if (!r.length) return null;
    if (r.length > 1 && r[0].kills === r[1].kills && r[0].deaths === r[1].deaths) return null;
    return r[0];
  }

  /** "MM:SS", or "∞" when there's no time limit. */
  clockText() {
    if (!Number.isFinite(this.remaining)) return "∞";
    const t = Math.ceil(this.remaining);
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  }

  /** JSON-safe copy (Infinity isn't valid JSON, so "no limit" is -1). */
  snapshot() {
    return {
      entries: [...this.scores.values()].map(({ id, name, kills, deaths }) => ({ id, name, kills, deaths })),
      remaining: Number.isFinite(this.remaining) ? this.remaining : -1,
      over: this.over,
      reason: this.reason,
    };
  }

  /** Adopt the host's view (late joiners, match end). Unknown ids are added. */
  load(snap) {
    if (!snap || !Array.isArray(snap.entries)) return;
    for (const e of snap.entries) {
      if (typeof e?.id !== "string") continue;
      const entry = this.ensurePlayer(e.id, typeof e.name === "string" ? e.name.slice(0, 24) : undefined);
      entry.kills = Number.isFinite(e.kills) ? e.kills : 0;
      entry.deaths = Number.isFinite(e.deaths) ? e.deaths : 0;
    }
    if (Number.isFinite(snap.remaining)) this.remaining = snap.remaining < 0 ? Infinity : snap.remaining;
    this.over = !!snap.over;
    this.reason = snap.reason ?? null;
  }
}
