// Foundry — an abandoned steel works. A stepped furnace sits in the middle
// (glowing top, the high ground of the floor), smelter columns break up the
// diagonals, cargo crates give jump-up cover, and long gantries on the east
// and west sides give a raised firing lane (reach them by the stairs at
// either end). Point-symmetric, so no spawn has an edge.

import { block, stairs, mirror4, mirrorX, perimeter, spawnAt } from "./helpers.js";

const T = "./assets/textures/foundry/";

// One quadrant of the map, mirrored into all four.
const quadrant = [
  block("column", 11, 11, 4, 4, 8),
  block("crate", 6, 16, 3, 3, 2.0),
  block("crate", 9.5, 18.5, 2, 2, 4.0),
  block("crate", 16, 6.5, 3, 3, 2.0),
];

export default {
  id: "foundry",
  name: "Foundry",
  thumb: "./assets/thumbs/foundry.png",
  modern: true,
  floorSize: 48,
  wallHeight: 8,
  bgColor: 0x140e0a,

  environment: {
    fog: [0x1a120d, 50, 130],
    ambient: [0xffdcc0, 0.55],
    sun: { color: 0xffc78f, intensity: 1.0, position: [26, 40, 14] },
  },

  textures: {
    floor: T + "floor.jpg",
    deck: T + "floor.jpg",
    wall: T + "wall.jpg",
    crate: T + "crate.jpg",
    column: T + "column.jpg",
    plinth: T + "plinth.jpg",
    barrier: T + "barrier.jpg",
    furnace: T + "furnace.jpg",
  },
  bump: {
    floor: T + "floor_h.png",
    deck: T + "floor_h.png",
    wall: T + "wall_h.png",
    crate: T + "crate_h.png",
    column: T + "column_h.png",
    plinth: T + "plinth_h.png",
  },
  bumpScale: 2.0,
  glow: { furnace: 1.15 },
  tile: { default: 4, floor: 6, deck: 6, crate: 3, barrier: 4.5 },
  material: {
    floor: { roughness: 0.6, metalness: 0.5 },
    deck: { roughness: 0.6, metalness: 0.5 },
    wall: { roughness: 0.7, metalness: 0.4 },
    column: { roughness: 0.55, metalness: 0.55 },
    crate: { roughness: 0.7, metalness: 0.3 },
  },
  fallbackColors: {
    floor: 0x2a2a2e, deck: 0x2a2a2e, wall: 0x3a3a3c, crate: 0xb86a1c,
    column: 0x4a4e55, plinth: 0x5a5a58, barrier: 0x777770, furnace: 0xff6a1a,
  },

  walls: perimeter(48, 8),

  props: [
    // The furnace: four tiers, each a 0.48 step up, glowing core on top.
    block("plinth", 0, 0, 16, 16, 0.48),
    block("plinth", 0, 0, 12, 12, 0.96),
    block("plinth", 0, 0, 8, 8, 1.44),
    block("furnace", 0, 0, 4, 4, 1.92),

    ...mirror4(quadrant),

    // Barriers that break the long north/south lanes.
    block("barrier", 0, -17, 8, 1, 4.5),
    block("barrier", 0, 17, 8, 1, 4.5),

    // East/west gantries (2.4 up) with stairs at both ends.
    ...mirrorX([
      block("deck", 21.5, 0, 3, 24, 2.4),
      ...stairs("deck", { x: 21.5, z: 12, dir: "+z", width: 3 }),
      ...stairs("deck", { x: 21.5, z: -12, dir: "-z", width: 3 }),
    ]),
  ],

  spawns: [spawnAt(-17, -17), spawnAt(17, 17), spawnAt(-17, 17), spawnAt(17, -17)],
};
