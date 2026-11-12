import classic from "./arenas/classic.js";
import foundry from "./arenas/foundry.js";
import ruins from "./arenas/ruins.js";
import neon from "./arenas/neon.js";
import mansion from "./arenas/mansion.js";
import glacier from "./arenas/glacier.js";
import training from "./arenas/training-room.js";

// `training` is here so getArena("training") works, but it is left out of ARENA_LIST on purpose: it is not a match arena.
export const ARENAS = { classic, foundry, ruins, neon, mansion, glacier, training };
export const ARENA_LIST = [classic, foundry, ruins, neon, mansion, glacier];

export function getArena(id) {
  return Object.hasOwn(ARENAS, id) ? ARENAS[id] : ARENAS.classic;
}
