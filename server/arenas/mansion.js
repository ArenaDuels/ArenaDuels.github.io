// Mansion — a manor at dusk with a formal garden out front. The house has a
// great hall (pillars, red carpet, a raised dais at the back) flanked by two
// side rooms; doorways everywhere, so fights flow through the building.
// Outside: a fountain, hedge rows, garden walls and two pavilion roofs you
// can climb for a view of the whole estate.

import { block, stairs, mirrorX, perimeter, spawnAt } from "./helpers.js";

const T = "./assets/textures/mansion/";
const WALL_H = 6.5;

// Wall pieces along the front (z = -8): doors at x ±13 (4 wide) and 0 (6 wide).
const frontWalls = [
  block("wall", -16.5, -8, 3, 1, WALL_H),
  block("wall", -7, -8, 8, 1, WALL_H),
  block("wall", 7, -8, 8, 1, WALL_H),
  block("wall", 16.5, -8, 3, 1, WALL_H),
];

// Everything on the east half; mirrored to the west.
const eastHalf = [
  // outer wall with a side door at z -23..-19
  block("wall", 18, -29.25, 1, 12.5, WALL_H),
  block("wall", 18, -13.5, 1, 11, WALL_H),
  // wall between the great hall and the side room, doors at z -30..-26 and -16..-12
  block("wall", 8, -32.75, 0.8, 5.5, WALL_H),
  block("wall", 8, -21, 0.8, 10, WALL_H),
  block("wall", 8, -10, 0.8, 4, WALL_H),
  // great-hall pillars
  // (kept clear of the doorways in the wall beside them, which sit at z -28 and -14)
  block("column", 4, -10, 1.2, 1.2, 6),
  block("column", 4, -21, 1.2, 1.2, 6),
  block("column", 4, -32, 1.2, 1.2, 6),
  // furniture in the side room
  block("wood", 13, -21, 3, 5, 2.0),
  block("wood", 13, -33.5, 8, 1.5, 3.0),
  // porch colonnade
  block("column", 6.5, -4.5, 1.4, 1.4, WALL_H),
  block("column", 10, -4.5, 1.4, 1.4, WALL_H),
  block("column", 16.5, -4.5, 1.4, 1.4, WALL_H),
  // garden
  block("hedge", 15, 6, 1.6, 12, 3.2),
  block("hedge", 8, 24, 10, 1.6, 3.2),
  block("hedge", 20, 18, 1.6, 8, 3.2),
  block("stone", 26, 2, 1.2, 10, 4.5),
  // pavilion roof (2.4 up) reached by stairs from the garden side
  block("stone", 28, 28, 8, 8, 2.4),
  ...stairs("stone", { x: 24, z: 28, dir: "-x", width: 4 }),
];

export default {
  id: "mansion",
  name: "Mansion",
  tagline: "Dusk at the manor",
  description: "A grand house with a pillared great hall and side rooms, opening onto a formal garden with a fountain, hedge rows and climbable pavilions. Big, varied fights.",
  tags: ["72×72", "Indoor + outdoor", "Large"],
  thumb: "./assets/thumbs/mansion.png",
  modern: true,
  floorSize: 72,
  wallHeight: 7,
  bgColor: 0x241b34,

  environment: {
    fog: [0x2a2038, 70, 190],
    ambient: [0xffe3cf, 0.6],
    sun: { color: 0xffae6b, intensity: 1.0, position: [-34, 30, 26] },
  },

  textures: {
    floor: T + "floor.jpg",
    marble: T + "marble.jpg",
    carpet: T + "carpet.jpg",
    grass: T + "grass.jpg",
    wall: T + "wall.jpg",
    hedge: T + "hedge.jpg",
    column: T + "column.jpg",
    wood: T + "wood.jpg",
    stone: T + "stone.jpg",
  },
  bump: {
    floor: T + "floor_h.png",
    marble: T + "marble_h.png",
    grass: T + "grass_h.png",
    wall: T + "wall_h.png",
    hedge: T + "hedge_h.png",
    column: T + "column_h.png",
    wood: T + "wood_h.png",
    stone: T + "stone_h.png",
  },
  bumpScale: 2.0,
  glow: {},
  tile: { default: 4, floor: 6, marble: 6, carpet: 6, grass: 5, wall: WALL_H, hedge: 3.2, column: 3, wood: 3 },
  material: {
    floor: { roughness: 0.9, metalness: 0 },
    marble: { roughness: 0.25, metalness: 0.1 },
    carpet: { roughness: 1, metalness: 0 },
    grass: { roughness: 1, metalness: 0 },
    wall: { roughness: 0.85, metalness: 0 },
    hedge: { roughness: 1, metalness: 0 },
    column: { roughness: 0.3, metalness: 0.05 },
    wood: { roughness: 0.55, metalness: 0.05 },
    stone: { roughness: 0.9, metalness: 0 },
  },
  fallbackColors: {
    floor: 0x8a8174, marble: 0xdddddd, carpet: 0x7a1020, grass: 0x2e6b24, wall: 0xe6dcc8,
    hedge: 0x1f4a1c, column: 0xf0ece4, wood: 0x4a2f1c, stone: 0xb0aca0,
  },

  // visual-only ground patches over the cobblestone courtyard
  floors: [
    { type: "marble", x: 0, z: -21.75, w: 36, d: 27.5, y: 0.02 },     // inside the house
    { type: "carpet", x: 0, z: -19.5, w: 6, d: 23, y: 0.04 },         // hall runner
    { type: "grass", x: -19, z: 17, w: 26, d: 36, y: 0.02 },          // west lawn
    { type: "grass", x: 19, z: 17, w: 26, d: 36, y: 0.02 },           // east lawn
  ],

  walls: perimeter(72, 7),

  props: [
    ...frontWalls,
    ...mirrorX(eastHalf),

    // great-hall dais (2.4 up) with a grand staircase
    block("stone", 0, -33, 15, 4, 2.4),
    ...stairs("stone", { x: 0, z: -31, dir: "+z", width: 6 }),

    // fountain
    block("stone", 0, 12, 8, 8, 2.0),
    block("stone", 0, 12, 2, 2, 5),
  ],

  spawns: [
    spawnAt(-16, 31), spawnAt(16, 31),   // garden
    spawnAt(-13, -28), spawnAt(13, -28), // side rooms
  ],
};
