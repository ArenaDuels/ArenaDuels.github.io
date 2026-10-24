import classic from "./arenas/classic.js";
import pillars from "./arenas/pillars.js";
import towers from "./arenas/towers.js";
import mansion from "./arenas/mansion.js";
import megaTowers from "./arenas/mega-towers.js";

export const ARENAS = { classic, pillars, towers, mansion, "mega-towers": megaTowers };
export const ARENA_LIST = [classic, pillars, towers, mansion, megaTowers];

export function getArena(id) {
  return ARENAS[id] || ARENAS.classic;
}
