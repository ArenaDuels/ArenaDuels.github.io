// Body skins: real texture images that go on your player, unlocked by lifetime kills on your account.
//
// "Kills" are the kills saved to your account (Find Match games; custom matches don't count), the same
// number as on the stats screen and the leaderboard. Guests have no account, so they only get the free skins.
//
// The skin id is sent over the network in the look's `pattern` field (that name is kept so older
// clients and the relay keep working). The relay checks every look against the sender's real kills.
//
// This file is shared: js/skins.js (browser) and server/skins.js (relay) must be identical.

export const SKINS = [
  { id: "solid", label: "Solid", kills: 0 }, // no image: just the color you picked
  { id: "checker", label: "Checker", kills: 0 },
  { id: "camo", label: "Camo", kills: 5 },
  { id: "digital", label: "Digital", kills: 15 },
  { id: "carbon", label: "Carbon", kills: 30 },
  { id: "contour", label: "Contour", kills: 50 },
  { id: "smoke", label: "Smoke", kills: 75 },
  { id: "neon", label: "Neon", kills: 100 },
  { id: "ice", label: "Ice", kills: 150 },
  { id: "crown", label: "Crowns", kills: 250 },
  { id: "glitch", label: "Glitch", kills: 350 },
  { id: "fire", label: "Fire", kills: 500 },
  { id: "lava", label: "Lava", kills: 750 },
  { id: "lightning", label: "Lightning", kills: 1000 },
  { id: "galaxy", label: "Galaxy", kills: 2000 },
  { id: "gold", label: "Gold", kills: 3500 },
  { id: "rainbow", label: "Rainbow", kills: 5000 },
];

export const SKIN_IDS = SKINS.map((s) => s.id);
export const DEFAULT_SKIN = "solid";

export const skinById = (id) => SKINS.find((s) => s.id === id) ?? null;

// Where the images live (relative to the page). Solid has none.
export const skinTextureUrl = (id) => `./assets/skins/${id}.png`;
export const skinThumbUrl = (id) => `./assets/skin-thumbs/${id}.jpg`;

export const skinUnlocked = (skin, kills) => !!skin && Number.isFinite(kills) && kills >= skin.kills;

// The first locked skin you will reach next, or null once everything is unlocked.
export function nextSkin(kills) {
  return SKINS.filter((s) => s.kills > (Number.isFinite(kills) ? kills : 0)).sort((a, b) => a.kills - b.kills)[0] ?? null;
}

// The same look, with a skin you haven't unlocked swapped for Solid. Used by the relay on every hello.
export function lookWithUnlockedSkin(look, kills) {
  if (!look || typeof look !== "object") return look;
  const skin = skinById(look.pattern);
  if (!skin || skinUnlocked(skin, kills)) return look;
  return { ...look, pattern: DEFAULT_SKIN };
}
