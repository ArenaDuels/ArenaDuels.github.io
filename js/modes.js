// Game modes you can search for in matchmaking.
//
// Every mode is a free-for-all deathmatch with its own rules: the same settings the host of
// a private match can change (time limit, kills to win, health, health steal, respawn
// delay), bundled into a preset so a whole queue plays the same game.
//
// This file is used by the browser AND the relay server, and the two copies (js/modes.js and
// server/modes.js) must stay identical. To add a mode, add it to the list; to change what one
// plays like, change its `settings`. Values are clamped by sanitizeSettings in match.js, and a
// test checks they're already inside those limits.

export const GAME_MODES = [
  {
    id: "deathmatch",
    name: "Deathmatch",
    tagline: "First to 20 kills",
    description: "The classic. Ten minutes or twenty kills, whichever comes first.",
    settings: { timeLimit: 10, scoreLimit: 20, startingHealth: 100, healthSteal: 0, respawnDelay: 2 },
  },
  {
    id: "blitz",
    name: "Blitz",
    tagline: "5 minutes, first to 10",
    description: "A fast one. Short clock, quick respawns, straight back into the fight.",
    settings: { timeLimit: 5, scoreLimit: 10, startingHealth: 100, healthSteal: 0, respawnDelay: 1 },
  },
  {
    id: "vampire",
    name: "Vampire",
    tagline: "Your hits heal you",
    description: "Half the damage you deal comes back as health. Stay on target to stay alive.",
    settings: { timeLimit: 10, scoreLimit: 20, startingHealth: 100, healthSteal: 50, respawnDelay: 2 },
  },
  {
    id: "glass-cannon",
    name: "Glass Cannon",
    tagline: "25 health, no mercy",
    description: "Everyone dies in under a second of beam. Win the first shot.",
    settings: { timeLimit: 8, scoreLimit: 25, startingHealth: 25, healthSteal: 0, respawnDelay: 1 },
  },
  {
    id: "titan",
    name: "Titan",
    tagline: "300 health, long fights",
    description: "Triple health. Duels are long, so use the map and the high ground.",
    settings: { timeLimit: 12, scoreLimit: 15, startingHealth: 300, healthSteal: 0, respawnDelay: 3 },
  },
  {
    id: "marathon",
    name: "Marathon",
    tagline: "20 minutes, first to 50",
    description: "A long session on a big scoreboard, for when you've got time.",
    settings: { timeLimit: 20, scoreLimit: 50, startingHealth: 100, healthSteal: 0, respawnDelay: 2 },
  },
];

export const MODE_IDS = GAME_MODES.map((m) => m.id);
export const isValidModeId = (v) => typeof v === "string" && MODE_IDS.includes(v);
export const getMode = (id) => GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0];
