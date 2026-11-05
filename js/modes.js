// Matchmaking modes shared by the browser and relay server.
export const GAME_MODES = [
  {
    id: "1v1",
    name: "1v1",
    tagline: "First to 30 kills · 10 minutes",
    description: "A standard duel. 100 health, first to 30 kills, or the highest score when time expires.",
    maxPlayers: 2,
    settings: { timeLimit: 10, scoreLimit: 30, startingHealth: 100, healthSteal: 0, respawnDelay: 2 },
  },
  {
    id: "ffa",
    name: "Free For All",
    tagline: "Up to 5 players · First to 20 · 10 minutes",
    description: "Everyone for themselves. Up to five players, 100 health, first to 20 kills, or the highest score when time expires.",
    maxPlayers: 5,
    settings: { timeLimit: 10, scoreLimit: 20, startingHealth: 100, healthSteal: 0, respawnDelay: 2 },
  },
  {
    id: "tdm",
    name: "Team Deathmatch",
    tagline: "4v4 · First team to 50 · 10 minutes",
    description: "Two teams of up to four. 100 health, full health restored on every kill, and teammate outlines.",
    maxPlayers: 8,
    teamMode: true,
    settings: { timeLimit: 10, scoreLimit: 50, startingHealth: 100, healthSteal: 0, respawnDelay: 2 },
  },
];
export const MODE_IDS = GAME_MODES.map((m) => m.id);
export const isValidModeId = (v) => typeof v === "string" && MODE_IDS.includes(v);
export const getMode = (id) => GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0];
