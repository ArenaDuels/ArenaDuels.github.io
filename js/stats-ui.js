// The Profile and Leaderboards screens. They only ever read numbers from the server
// (server/stats.js); nothing here can change a stat.
import { API_BASE, getCurrentFirebaseIdToken } from "./auth.js";

const $ = (id) => document.getElementById(id);

async function getJson(path, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not load that right now.");
  return data;
}

const ratio = (a, b) => (b > 0 ? (a / b).toFixed(2) : a > 0 ? a.toFixed(2) : "0.00");
const percent = (wins, matches) => (matches > 0 ? `${Math.round((wins / matches) * 100)}%` : "0%");

export function initStatsUi(nameInput) {
  const profile = $("profile-modal");
  const board = $("leaderboard-modal");
  let boardName = "kills";
  let loadToken = 0; // a slow answer for an old tab must not overwrite a newer one

  // ---------- profile ----------
  async function openProfile() {
    profile.classList.remove("hidden");
    $("profile-name").textContent = nameInput.value || "Guest";
    const note = $("profile-note");
    const grid = $("profile-grid");
    const ranks = $("profile-ranks");
    note.classList.remove("error");
    grid.classList.add("hidden");
    ranks.classList.add("hidden");
    note.textContent = "Loading…";

    const token = await getCurrentFirebaseIdToken().catch(() => null);
    if (!token) {
      note.textContent = "Sign in or create an account to track your stats.";
      return;
    }
    try {
      const s = await getJson("/api/stats/me", token);
      note.textContent = s.matches > 0 || s.kills > 0 ? "" : "No matches played yet.";
      const tiles = [
        ["Kills", s.kills], ["Deaths", s.deaths], ["K/D", ratio(s.kills, s.deaths)],
        ["Wins", s.wins], ["Losses", s.losses], ["Win rate", percent(s.wins, s.matches)],
      ];
      grid.replaceChildren(...tiles.map(([label, value]) => {
        const tile = document.createElement("div");
        tile.className = "stat-tile";
        const b = document.createElement("b");
        b.textContent = String(value);
        const span = document.createElement("span");
        span.textContent = label;
        tile.append(b, span);
        return tile;
      }));
      grid.classList.remove("hidden");
      const parts = [];
      if (s.rank?.kills) parts.push(`#${s.rank.kills} for kills`);
      if (s.rank?.wins) parts.push(`#${s.rank.wins} for wins`);
      if (parts.length) {
        ranks.textContent = `Leaderboard: ${parts.join(" · ")}`;
        ranks.classList.remove("hidden");
      }
    } catch (err) {
      note.textContent = err.message;
      note.classList.add("error");
    }
  }

  // ---------- leaderboards ----------
  async function showBoard(which) {
    boardName = which;
    const mine = ++loadToken;
    $("lb-tab-kills").className = `btn ${which === "kills" ? "btn-primary" : "btn-secondary"}`;
    $("lb-tab-wins").className = `btn ${which === "wins" ? "btn-primary" : "btn-secondary"}`;
    const note = $("lb-note");
    const list = $("lb-list");
    note.classList.remove("error");
    note.textContent = "Loading…";
    list.replaceChildren();
    try {
      const data = await getJson(`/api/leaderboard?board=${which}`);
      if (mine !== loadToken) return;
      note.textContent = data.entries.length ? "" : "No players on this board yet.";
      const me = nameInput.value;
      list.replaceChildren(...data.entries.map((e) => {
        const row = document.createElement("li");
        row.className = "lb-row" + (e.username === me ? " me" : "");
        const rank = document.createElement("span");
        rank.className = "lb-rank";
        rank.textContent = `#${e.rank}`;
        const name = document.createElement("span");
        name.className = "lb-name";
        name.textContent = e.username;
        const score = document.createElement("span");
        score.className = "lb-score";
        score.textContent = String(which === "wins" ? e.wins : e.kills);
        row.append(rank, name, score);
        return row;
      }));
    } catch (err) {
      if (mine !== loadToken) return;
      note.textContent = err.message;
      note.classList.add("error");
    }
  }

  $("btn-profile").addEventListener("click", openProfile);
  $("btn-profile-close").addEventListener("click", () => profile.classList.add("hidden"));
  profile.addEventListener("click", (e) => { if (e.target === profile) profile.classList.add("hidden"); });

  $("btn-leaderboards").addEventListener("click", () => {
    board.classList.remove("hidden");
    showBoard(boardName);
  });
  $("btn-leaderboard-close").addEventListener("click", () => board.classList.add("hidden"));
  board.addEventListener("click", (e) => { if (e.target === board) board.classList.add("hidden"); });
  $("lb-tab-kills").addEventListener("click", () => showBoard("kills"));
  $("lb-tab-wins").addEventListener("click", () => showBoard("wins"));
}
