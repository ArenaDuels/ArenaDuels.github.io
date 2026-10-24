import classic from "./arenas/classic.js";
import mansion from "./arenas/mansion.js";
import forestTemple from "./arenas/forest-temple.js";
import desertRuins from "./arenas/desert-ruins.js";
import spaceStation from "./arenas/space-station.js";
import snowFortress from "./arenas/snow-fortress.js";
import dockyard from "./arenas/dockyard.js";

export const ARENAS = { classic, mansion, "forest-temple": forestTemple, "desert-ruins": desertRuins, "space-station": spaceStation, "snow-fortress": snowFortress, dockyard };
export const ARENA_LIST = [classic, mansion, forestTemple, desertRuins, spaceStation, snowFortress, dockyard];
export function getArena(id) { return ARENAS[id] || ARENAS.classic; }
