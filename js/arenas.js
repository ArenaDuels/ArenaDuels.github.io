import classic from "./arenas/classic.js";
import foundry from "./arenas/foundry.js";
import ruins from "./arenas/ruins.js";
import neon from "./arenas/neon.js";
import mansion from "./arenas/mansion.js";

export const ARENAS = { classic, foundry, ruins, neon, mansion };
export const ARENA_LIST = [classic, foundry, ruins, neon, mansion];

export function getArena(id) {
  return ARENAS[id] || ARENAS.classic;
}
