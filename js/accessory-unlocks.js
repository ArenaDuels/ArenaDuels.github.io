// Accessories that have to be earned with wins on your account. Every accessory not listed here is free.
//
// "Wins" are the wins saved to your account (Find Match games; custom matches don't count), the same
// number as on the stats screen and the leaderboard. Guests have no account, so they only get the free ones.
// The relay checks every look against the sender's real wins before showing it to anyone.
//
// This file is shared: js/accessory-unlocks.js (browser) and server/accessory-unlocks.js (relay) must be identical.

export const ACCESSORY_WINS = {
  headphones: 3,
  cowboy: 6,
  wizard: 10,
  viking: 15, // the hardest one to get
};

export const winsNeeded = (id) => ACCESSORY_WINS[id] ?? 0;

export const accessoryUnlocked = (id, wins) =>
  winsNeeded(id) === 0 || (Number.isFinite(wins) && wins >= winsNeeded(id));

// The nearest locked accessory above your wins as { id, wins }, or null once you have them all.
export function nextAccessory(wins) {
  const have = Number.isFinite(wins) ? wins : 0;
  const locked = Object.entries(ACCESSORY_WINS)
    .filter(([, need]) => need > have)
    .sort((a, b) => a[1] - b[1])[0];
  return locked ? { id: locked[0], wins: locked[1] } : null;
}

// The same look, with an accessory you haven't earned swapped for none. Used by the relay on every hello.
export function lookWithUnlockedAccessory(look, wins) {
  if (!look || typeof look !== "object") return look;
  if (accessoryUnlocked(look.accessory, wins)) return look;
  return { ...look, accessory: "none" };
}
