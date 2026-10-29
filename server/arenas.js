import classic from "./arenas/classic.js";
import foundry from "./arenas/foundry.js";
import ruins from "./arenas/ruins.js";
import neon from "./arenas/neon.js";
import mansion from "./arenas/mansion.js";
import glacier from "./arenas/glacier.js";

export const ARENAS = { classic, foundry, ruins, neon, mansion, glacier };
export const ARENA_LIST = [classic, foundry, ruins, neon, mansion, glacier];

export function getArena(id) {
  return Object.hasOwn(ARENAS, id) ? ARENAS[id] : ARENAS.classic;
}
