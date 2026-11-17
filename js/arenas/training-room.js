// Training Room - the empty 30x30 room you land in from the main menu's Training Room button. It is
// the Classic Box with a solid plinth against the north wall; the training console (see
// buildTrainingConsole in training.js) stands on it. It is NOT in ARENA_LIST, so it never shows up in
// the arena pickers, and the relay doesn't know it (nothing in the room goes over the network).

import { perimeter, spawnAt, block } from "./helpers.js";

const T = "./assets/textures/classic/";

// Where the console's plinth is. training.js reads these to put the console model on top of it.
export const CONSOLE_PLINTH = { x: 0, z: -14.1, w: 3.6, d: 1.2, h: 1.1 };

export default {
  id: "training",
  name: "Training Room",
  tagline: "Aim drills",
  description: "An empty room with a console at the far end. Walk up to it to pick a drill.",
  tags: ["30\u00d730", "Solo"],
  modern: true,
  floorSize: 30,
  wallHeight: 6,
  bgColor: 0x0d1118,

  environment: {
    fog: [0x0d1118, 50, 120],
    ambient: [0xe8f4ff, 0.7],
    sun: { color: 0xffffff, intensity: 0.95, position: [18, 34, 14] },
  },

  textures: { floor: T + "floor.jpg", wall: T + "wall.jpg" },
  bump: { floor: T + "floor_h.png", wall: T + "wall_h.png" },
  bumpScale: 1.5,
  tile: { default: 4, floor: 4, wall: 6 },
  material: {
    floor: { roughness: 0.55, metalness: 0.15 },
    wall: { roughness: 0.6, metalness: 0.2 },
  },
  fallbackColors: { floor: 0x9aa0a6, wall: 0xc8ccd0 },

  walls: perimeter(30, 6),
  props: [block("wall", CONSOLE_PLINTH.x, CONSOLE_PLINTH.z, CONSOLE_PLINTH.w, CONSOLE_PLINTH.d, CONSOLE_PLINTH.h)],

  // You come in facing north, toward the console.
  spawns: [spawnAt(0, 6)],
};
