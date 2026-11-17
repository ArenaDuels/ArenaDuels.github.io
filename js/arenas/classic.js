// Classic Box — just a box. Four walls, a floor, nothing in the way: pure
// aim and strafing. Everyone starts at the middle of a side facing the centre.

import { perimeter, spawnAt } from "./helpers.js";

const T = "./assets/textures/classic/";

export default {
  id: "classic",
  name: "Classic Box",
  tagline: "Just a box",
  description: "An empty room with no cover and no tricks. Nothing to hide behind, so every fight comes down to aim and strafing.",
  tags: ["30×30", "No cover", "Pure duel"],
  thumb: "./assets/thumbs/classic.png",
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
  props: [],

  spawns: [spawnAt(-12, 0), spawnAt(12, 0), spawnAt(0, -12), spawnAt(0, 12)],
};
