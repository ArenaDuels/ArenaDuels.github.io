import classic from "./arenas/classic.js";
import foundry from "./arenas/foundry.js";
import ruins from "./arenas/ruins.js";
import neon from "./arenas/neon.js";
import mansion from "./arenas/mansion.js";
import glacier from "./arenas/glacier.js";
import alley from "./arenas/alley.js";
import dock from "./arenas/dock.js";
import cave from "./arenas/cave.js";

export const ARENAS = { classic, foundry, ruins, neon, mansion, glacier, alley, dock, cave };
export const ARENA_LIST = [classic, foundry, ruins, neon, mansion, glacier, alley, dock, cave];

export function getArena(id) {
  return Object.hasOwn(ARENAS, id) ? ARENAS[id] : ARENAS.classic;
}
