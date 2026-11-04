// Matchmaking: who gets put in a match together, and which map they play.
//
//   - You search for ONE game mode. Everyone searching the same mode is in the same queue.
//   - There is NO skill-based matchmaking. The queue knows nothing about anyone's kills,
//     rank, wins or account: it is first come, first matched. (enqueue() takes a player
//     and a mode, nothing else, so there is nothing to rank by.)
//   - With two players waiting, the queue holds on a short fill window so more can join
//     (up to four). A fourth player starts it at once.
//   - Then everyone votes on the map: three random maps are offered, the most votes wins,
//     ties and empty ballots are settled at random. The vote ends early once everyone has
//     voted, or when the clock runs out.
//   - The match is handed back to the caller (the relay server), which makes the room.
//     The player who has waited longest is the host.
//
// This file knows nothing about sockets or real time: players are opaque objects, `now` is
// passed in, and every method returns the list of things to do:
//     { to: [players], msg }         send `msg` to those players
//     { action: "match", ... }       a map has been chosen: create the room
// so the whole thing can be tested with a fake clock.

export const MATCHMAKING = Object.freeze({
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,
  MODE_MAX_PLAYERS: { "1v1": 2, tdm: 8 },
  FILL_MS: 10_000,         // with 2+ waiting, wait this long for more before starting
  VOTE_MS: 15_000,         // time to vote on the map
  VOTE_LOCK_MS: 1_500,     // once everyone has voted, keep the result on screen this long
  MAP_OPTIONS: 3,          // maps offered
  MAX_SEARCH_MS: 10 * 60_000, // give up on someone who has searched this long without a match
});

const to = (players, msg) => ({ to: players, msg });

export class Matchmaker {
  /**
   * @param {{ modeIds: string[], arenaIds: string[], random?: (n:number)=>number, config?: object }} opts
   *   `random(n)` returns a whole number from 0 to n-1 (the server passes crypto.randomInt).
   */
  constructor({ modeIds, arenaIds, random = (n) => Math.floor(Math.random() * n), config = {} }) {
    this.cfg = { ...MATCHMAKING, ...config };
    this.modeIds = modeIds;
    this.arenaIds = arenaIds;
    this.random = random;
    this.queues = new Map(modeIds.map((id) => [id, []]));   // modeId -> [{ player, modeId, since }]
    this.fillStart = new Map();                              // modeId -> when the queue reached MIN_PLAYERS
    this.where = new Map();                                  // player -> { phase: "queue"|"vote", modeId, session? }
    this.sessions = new Set();                               // open map votes
  }

  isSearching(player) {
    return this.where.has(player);
  }

  /** Numbers for the server log / health checks. */
  stats() {
    const queued = {};
    for (const [id, q] of this.queues) if (q.length) queued[id] = q.length;
    return { queued, voting: this.sessions.size };
  }

  // ------------------------------------------------------------------ entering and leaving

  /** Start searching for `modeId`. */
  enqueue(player, modeId, now) {
    if (!this.queues.has(modeId)) return [to([player], { t: "search_error", error: "Unknown game mode." })];
    if (this.where.has(player)) return [to([player], { t: "search_error", error: "You're already searching." })];
    this.queues.get(modeId).push({ player, modeId, since: now });
    this.where.set(player, { phase: "queue", modeId });
    return this.#settle(modeId, now);
  }

  /** Stop searching (or leave a map vote). Safe to call for anyone, any time. */
  cancel(player, now) {
    const w = this.where.get(player);
    if (!w) return [];
    this.where.delete(player);

    if (w.phase === "queue") {
      const q = this.queues.get(w.modeId);
      const i = q.findIndex((e) => e.player === player);
      if (i !== -1) q.splice(i, 1);
      return this.#settle(w.modeId, now);
    }

    // in a map vote
    const s = w.session;
    s.entries = s.entries.filter((e) => e.player !== player);
    s.votes.delete(player);
    if (s.entries.length < this.cfg.MIN_PLAYERS) {
      // too few left for a match: everyone still here goes back to the front of the queue
      this.sessions.delete(s);
      for (const e of s.entries) this.where.delete(e.player);   // no longer voting
      const out = [to(s.entries.map((e) => e.player), { t: "vote_cancelled", reason: "A player left, so we're searching again." })];
      out.push(...this.requeue(s.entries, s.modeId, now));
      return out;
    }
    if (s.votes.size === s.entries.length && s.closeAt == null) s.closeAt = now + this.cfg.VOTE_LOCK_MS;
    return [to(this.#players(s), this.#voteUpdate(s))];
  }

  /**
   * Put these entries (as handed back in a "match" action) back at the front of the queue, in
   * their original order — for when a match fell through after the vote.
   */
  requeue(entries, modeId, now) {
    const q = this.queues.get(modeId);
    if (!q) return [];
    const fresh = entries.filter((e) => !this.where.has(e.player));
    for (const e of fresh) this.where.set(e.player, { phase: "queue", modeId });
    q.unshift(...fresh.map((e) => ({ player: e.player, modeId, since: e.since })));
    return this.#settle(modeId, now);
  }

  /** Cast (or change) a vote for a map. Ignored unless it's one of the maps on offer. */
  vote(player, arenaId, now) {
    const w = this.where.get(player);
    if (!w || w.phase !== "vote" || !w.session.options.includes(arenaId)) return [];
    const s = w.session;
    s.votes.set(player, arenaId);
    if (s.votes.size === s.entries.length && s.closeAt == null) s.closeAt = now + this.cfg.VOTE_LOCK_MS;
    return [to(this.#players(s), this.#voteUpdate(s))];
  }

  // ------------------------------------------------------------------------- the clock

  /** Call a few times a second: starts matches whose fill window is up, closes votes, drops stale searches. */
  tick(now) {
    const out = [];
    for (const modeId of this.modeIds) {
      const q = this.queues.get(modeId);

      const stale = q.filter((e) => now - e.since > this.cfg.MAX_SEARCH_MS);
      for (const e of stale) {
        q.splice(q.indexOf(e), 1);
        this.where.delete(e.player);
        out.push(to([e.player], { t: "search_timeout" }));
      }
      if (stale.length) out.push(...this.#settle(modeId, now));

      const start = this.fillStart.get(modeId);
      if (q.length >= this.cfg.MIN_PLAYERS && start != null && now - start >= this.cfg.FILL_MS) {
        out.push(...this.#startVote(modeId, now));
        out.push(...this.#settle(modeId, now));
      }
    }
    for (const s of [...this.sessions]) {
      if (now >= s.endsAt || (s.closeAt != null && now >= s.closeAt)) out.push(...this.#resolve(s));
    }
    return out;
  }

  // ------------------------------------------------------------------------- internals

  #maxPlayers(modeId) { return this.cfg.MODE_MAX_PLAYERS?.[modeId] ?? this.cfg.MAX_PLAYERS; }

  #players(s) {
    return s.entries.map((e) => e.player);
  }

  // Decide what a queue should be doing after anyone joined or left it, and tell the players in it.
  #settle(modeId, now) {
    const q = this.queues.get(modeId);
    const out = [];
    while (q.length >= this.#maxPlayers(modeId)) out.push(...this.#startVote(modeId, now));
    if (q.length >= this.cfg.MIN_PLAYERS) {
      if (this.fillStart.get(modeId) == null) this.fillStart.set(modeId, now);
    } else {
      this.fillStart.delete(modeId);
    }
    if (q.length) {
      const start = this.fillStart.get(modeId);
      const startsInMs = start != null ? Math.max(0, start + this.cfg.FILL_MS - now) : null;
      out.push(to(q.map((e) => e.player), { t: "queue", mode: modeId, players: q.length, max: this.#maxPlayers(modeId), startsInMs }));
    }
    return out;
  }

  #startVote(modeId, now) {
    const q = this.queues.get(modeId);
    const entries = q.splice(0, Math.min(this.#maxPlayers(modeId), q.length));
    this.fillStart.delete(modeId);

    // a few distinct maps, chosen at random
    const pool = [...this.arenaIds];
    const options = [];
    while (options.length < this.cfg.MAP_OPTIONS && pool.length) options.push(pool.splice(this.random(pool.length), 1)[0]);

    const s = { modeId, entries, options, votes: new Map(), endsAt: now + this.cfg.VOTE_MS, closeAt: null };
    this.sessions.add(s);
    for (const e of entries) this.where.set(e.player, { phase: "vote", modeId, session: s });
    return [to(this.#players(s), { t: "vote_start", mode: modeId, options, endsInMs: this.cfg.VOTE_MS, players: entries.length })];
  }

  #tally(s) {
    const tally = Object.fromEntries(s.options.map((id) => [id, 0]));
    for (const arenaId of s.votes.values()) tally[arenaId]++;
    return tally;
  }

  #voteUpdate(s) {
    return { t: "vote_update", tally: this.#tally(s), voted: s.votes.size, players: s.entries.length };
  }

  #resolve(s) {
    this.sessions.delete(s);
    const tally = this.#tally(s);
    const top = Math.max(...Object.values(tally));
    // most votes wins; a tie (or nobody voting) is settled at random among the front-runners
    const front = top === 0 ? s.options : s.options.filter((id) => tally[id] === top);
    const arenaId = front[this.random(front.length)];

    const entries = [...s.entries].sort((a, b) => a.since - b.since);   // longest wait first: they host
    for (const e of entries) this.where.delete(e.player);
    return [
      to(entries.map((e) => e.player), { t: "vote_result", arenaId, tally }),
      { action: "match", modeId: s.modeId, arenaId, players: entries.map((e) => e.player), entries },
    ];
  }
}
