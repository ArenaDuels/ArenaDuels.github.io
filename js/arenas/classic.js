// Classic Box — the simple duel room, rebuilt as a clean training facility.
// A tall pillar in the middle, a ring of barriers around it, and jump-up
// crates on the edges. Everyone starts in a corner facing the centre.

import { block, mirror4, perimeter, spawnAt } from "./helpers.js";

const T = "./assets/textures/classic/";

export default {
  id: "classic",
  name: "Classic Box",
  tagline: "The original duel room",
  description: "A compact training hall: a central pillar, a ring of barriers and four jump-up crates. Quick, readable fights — the best place to learn to strafe.",
  tags: ["28×28", "Compact", "Beginner friendly"],
  thumb: "./assets/thumbs/classic.png",
  modern: true,
  floorSize: 28,
  wallHeight: 6,
  bgColor: 0x0d1118,

  environment: {
    fog: [0x0d1118, 45, 110],
    ambient: [0xe8f4ff, 0.7],
    sun: { color: 0xffffff, intensity: 0.95, position: [18, 34, 14] },
  },

  textures: {
    floor: T + "floor.jpg",
    wall: T + "wall.jpg",
    barrier: T + "barrier.jpg",
    pillar: T + "pillar.jpg",
    crate: T + "crate.jpg",
  },
  bump: {
    floor: T + "floor_h.png",
    wall: T + "wall_h.png",
    pillar: T + "pillar_h.png",
    crate: T + "crate_h.png",
  },
  bumpScale: 1.5,
  tile: { default: 4, floor: 4, wall: 6, barrier: 4, pillar: 4, crate: 2.5 },
  material: {
    floor: { roughness: 0.55, metalness: 0.15 },
    wall: { roughness: 0.6, metalness: 0.2 },
    pillar: { roughness: 0.45, metalness: 0.5 },
  },
  fallbackColors: { floor: 0x9aa0a6, wall: 0xc8ccd0, barrier: 0x8a9096, pillar: 0x6b7480, crate: 0xcfd4d8 },

  walls: perimeter(28, 6),

  props: [
    block("pillar", 0, 0, 4, 4, 5.5),
    // plus-shaped ring of barriers around the pillar
    ...mirror4([block("barrier", 0, 8.5, 8, 1, 4.0), block("barrier", 8.5, 0, 1, 8, 4.0)]),
    // jump-up crates at the edge midpoints
    ...mirror4([block("crate", 0, 11.5, 3, 3, 2.0), block("crate", 11.5, 0, 3, 3, 2.0)]),
  ],

  spawns: [spawnAt(-10.5, -10.5), spawnAt(10.5, 10.5), spawnAt(-10.5, 10.5), spawnAt(10.5, -10.5)],
};
