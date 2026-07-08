import classic from "./arenas/classic.js";
import pillars from "./arenas/pillars.js";
import towers from "./arenas/towers.js";

export const ARENAS = { classic, pillars, towers };
export const ARENA_LIST = [classic, pillars, towers];

export function getArena(id) {
  return ARENAS[id] || ARENAS.classic;
}
