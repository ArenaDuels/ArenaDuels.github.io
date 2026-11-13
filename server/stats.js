// Player stats (kills, deaths, wins, losses) and leaderboards.
//
// Only Find Match games count. Custom matches never create a MatchTally, so nothing from them is
// ever saved. Only signed-in accounts are saved (a guest has no identity to keep stats under), but
// guests still take part in the tally so the winner is worked out from everyone who played.
//
// Nothing here trusts the host's browser for the result. The server counts the kills itself (they
// come from the same anticheat events that run the fight), and when the host says the match is over
// the server checks that it really could be: the score limit was reached, or the time limit ran out.

export const STATS = {
  MIN_MATCH_MS: 30_000,      // a match shorter than this never counts a win or loss
  TIME_GRACE_MS: 15_000,     // the host's clock and the server's may disagree a little
  BOARD_SIZE: 25,
  BOARD_CACHE_MS: 30_000,
};
export const BOARDS = ["kills", "wins"];
export const STATS_COLLECTION = "arenaStats";

export class MatchTally {
  /**
   * @param {{ settings: {scoreLimit?: number, timeLimit?: number}, teamMode?: boolean, now?: number }} opts
   *   `settings` are the mode's own rules, never anything the host sent.
   */
  constructor({ settings, teamMode = false, now = Date.now() }) {
    this.scoreLimit = Number(settings?.scoreLimit) || 0;
    this.timeLimit = Number(settings?.timeLimit) || 0; // minutes, 0 = none
    this.teamMode = teamMode === true;
    this.players = new Map(); // id -> { id, uid, name, team, kills, deaths, left }
    this.teamKills = [0, 0];
    this.startedAt = now;
    this.finished = false;
    this.hostEnded = false; // the host said the game is over (whether or not the server accepted it as a real finish)
  }

  addPlayer(id, { uid = null, name = "Player", team = null } = {}) {
    const existing = this.players.get(id);
    if (existing) {
      existing.left = false;
      if (team === 0 || team === 1) existing.team = team;
      return;
    }
    this.players.set(id, { id, uid, name, team: team === 0 || team === 1 ? team : null, kills: 0, deaths: 0, left: false, saved: false });
  }

  /**
   * Someone left a game that is still going: that is a loss for them, whatever the score was.
   * Returns the rows to save now. If that leaves nobody on the other side (a 1v1, the last player
   * in a free-for-all, one whole team) and the game had really got going, the players still in
   * win and the game is over.
   */
  markLeft(id, now = Date.now()) {
    const p = this.players.get(id);
    if (!p || p.left || this.finished || this.hostEnded) return []; // everyone is on the scoreboard by now: no penalty for leaving it
    p.left = true;
    p.saved = true;
    const rows = [{ uid: p.uid, name: p.name, kills: p.kills, deaths: p.deaths, result: "loss" }];
    const stayers = [...this.players.values()].filter((q) => !q.left);
    const nobodyToFight = this.teamMode
      ? stayers.length > 0 && stayers.every((q) => q.team === stayers[0].team)
      : stayers.length === 1;
    if (nobodyToFight && now - this.startedAt >= STATS.MIN_MATCH_MS) {
      for (const q of stayers) {
        q.saved = true;
        rows.push({ uid: q.uid, name: q.name, kills: q.kills, deaths: q.deaths, result: "win" });
      }
      this.finished = true;
    }
    return rows;
  }

  /** A fresh match in the same room (Play Again): zero the counts, drop anyone who left. */
  restart(now = Date.now()) {
    for (const [id, p] of this.players) {
      if (p.left) this.players.delete(id);
      else { p.kills = 0; p.deaths = 0; }
    }
    this.teamKills = [0, 0];
    this.startedAt = now;
    this.finished = false;
    this.hostEnded = false;
  }

  /** Same rules as the scoreboard: a death for the victim, a kill for the attacker (not for a self-kill). */
  addKill(attackerId, victimId) {
    if (this.finished) return false;
    const victim = this.players.get(victimId);
    const attacker = this.players.get(attackerId);
    if (!victim) return false; // bots and strangers are not part of the tally
    victim.deaths++;
    if (attacker && attackerId !== victimId) {
      attacker.kills++;
      if (this.teamMode && (attacker.team === 0 || attacker.team === 1)) this.teamKills[attacker.team]++;
    }
    return true;
  }

  /** Could the match really be over for this reason, right now? */
  endIsLegit(reason, now = Date.now()) {
    if (this.finished) return false;
    const elapsed = now - this.startedAt;
    if (elapsed < STATS.MIN_MATCH_MS) return false;
    if (reason === "score") {
      if (!(this.scoreLimit > 0)) return false;
      if (this.teamMode) return Math.max(...this.teamKills) >= this.scoreLimit;
      return [...this.players.values()].some((p) => p.kills >= this.scoreLimit);
    }
    if (reason === "time") {
      return this.timeLimit > 0 && elapsed >= this.timeLimit * 60_000 - STATS.TIME_GRACE_MS;
    }
    return false;
  }

  /** Close the match and say how it went for everyone still in it: [{ uid, name, kills, deaths, result }].
   *  Players who left were already given their loss (markLeft), so they are not counted twice. */
  finish() {
    this.finished = true;
    const all = [...this.players.values()].filter((p) => !p.left);
    let outcome;
    if (this.teamMode) {
      const [a, b] = this.teamKills;
      const winTeam = a === b ? null : a > b ? 0 : 1;
      outcome = (p) => (winTeam === null || (p.team !== 0 && p.team !== 1) ? "draw" : p.team === winTeam ? "win" : "loss");
    } else {
      // Most kills wins, then fewest deaths. An exact tie at the top is a draw.
      const best = [...all].sort((x, y) => y.kills - x.kills || x.deaths - y.deaths)[0];
      outcome = (p) => (!best ? "draw" : p.kills === best.kills && p.deaths === best.deaths
        ? (all.filter((q) => q.kills === best.kills && q.deaths === best.deaths).length > 1 ? "draw" : "win")
        : "loss");
    }
    return all.map((p) => ({ uid: p.uid, name: p.name, kills: p.kills, deaths: p.deaths, result: outcome(p) }));
  }

  /** The match never finished properly (the host left, say): keep kills and deaths, no win or loss. */
  partial() {
    if (this.finished) return [];
    return [...this.players.values()]
      .filter((p) => !p.saved && (p.kills > 0 || p.deaths > 0))
      .map((p) => ({ uid: p.uid, name: p.name, kills: p.kills, deaths: p.deaths, result: null }));
  }
}

const num = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function createStatsStore({ firestore, FieldValue, logger = console, now = () => Date.now() }) {
  const col = () => firestore.collection(STATS_COLLECTION);
  const cache = new Map(); // board -> { at, entries }

  return {
    /** Save a batch of match results. Rows without an account (guests) are skipped. */
    async recordResults(rows) {
      const mine = rows.filter((r) => typeof r.uid === "string" && r.uid);
      if (mine.length === 0) return 0;
      const batch = firestore.batch();
      for (const r of mine) {
        batch.set(col().doc(r.uid), {
          uid: r.uid,
          username: r.name,
          kills: FieldValue.increment(num(r.kills)),
          deaths: FieldValue.increment(num(r.deaths)),
          wins: FieldValue.increment(r.result === "win" ? 1 : 0),
          losses: FieldValue.increment(r.result === "loss" ? 1 : 0),
          matches: FieldValue.increment(r.result ? 1 : 0),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
      return mine.length;
    },

    /** Just a player's lifetime kills (one read): what the skin unlocks are checked against. */
    async getKills(uid) {
      const snap = await col().doc(uid).get();
      return snap.exists ? num(snap.data().kills) : 0;
    },

    /** One player's totals, plus where they stand on each board. */
    async getStats(uid) {
      const snap = await col().doc(uid).get();
      const d = snap.exists ? snap.data() : {};
      const stats = { kills: num(d.kills), deaths: num(d.deaths), wins: num(d.wins), losses: num(d.losses), matches: num(d.matches) };
      const rank = {};
      for (const board of BOARDS) {
        rank[board] = null;
        if (stats[board] > 0) {
          try {
            const higher = await col().where(board, ">", stats[board]).count().get();
            rank[board] = higher.data().count + 1;
          } catch (err) {
            logger.warn?.("[stats] rank lookup failed:", err.message);
          }
        }
      }
      return { ...stats, rank };
    },

    /** The top players for a board ("kills" or "wins"), cached for a short while. */
    async leaderboard(board) {
      if (!BOARDS.includes(board)) throw new Error("unknown board");
      const hit = cache.get(board);
      if (hit && now() - hit.at < STATS.BOARD_CACHE_MS) return hit.entries;
      const snap = await col().where(board, ">", 0).orderBy(board, "desc").limit(STATS.BOARD_SIZE).get();
      const entries = snap.docs.map((doc, i) => {
        const d = doc.data();
        return { rank: i + 1, username: String(d.username ?? "Player"), kills: num(d.kills), deaths: num(d.deaths), wins: num(d.wins), losses: num(d.losses) };
      });
      cache.set(board, { at: now(), entries });
      return entries;
    },
  };
}
