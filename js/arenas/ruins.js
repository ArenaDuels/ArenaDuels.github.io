// Ruins — a sun-bleached courtyard around a stepped temple. Broken walls
// form L-shaped alcoves, a pillar colonnade runs along each side, and the
// north and south terraces (up the stairs, 2.4 high) look over the whole
// yard from beneath a tall obelisk. Climb the temple for the centre high
// ground — four altar pillars up there give you something to hide behind.

import { block, stairs, mirror4, perimeter, spawnAt } from "./_helpers.js";

const T = "./assets/textures/ruins/";

const quadrant = [
  // L-shaped alcove
  block("wall", 13, 8, 1.2, 8, 4.5),
  block("wall", 19, 13, 8, 1.2, 4.5),
  block("wall", 24, 16, 1.2, 6, 3.0), // broken, lower
  // colonnade
  block("pillar", 9, 20, 1.6, 1.6, 6),
  block("pillar", 13.5, 20, 1.6, 1.6, 6),
  block("pillar", 18, 20, 1.6, 1.6, 6),
  // rubble you can hop onto
  block("rubble", 6, 12, 2.4, 2.4, 2.0),
  block("rubble", 22, 6, 2, 2, 2.0),
  // altar pillars on top of the temple
  block("pillar", 2, 2, 1.2, 1.2, 5.5),
];

export default {
  id: "ruins",
  name: "Ruins",
  thumb: "./assets/thumbs/ruins.png",
  modern: true,
  floorSize: 56,
  wallHeight: 7,
  bgColor: 0xcdb48a,

  environment: {
    fog: [0xcdb48a, 55, 150],
    ambient: [0xfff0d8, 0.65],
    sun: { color: 0xfff1cf, intensity: 1.15, position: [34, 46, 22] },
  },

  textures: {
    floor: T + "floor.jpg",
    wall: T + "wall.jpg",
    rubble: T + "wall.jpg",
    pillar: T + "pillar.jpg",
    temple: T + "temple.jpg",
    obelisk: T + "obelisk.jpg",
  },
  bump: {
    floor: T + "floor_h.png",
    wall: T + "wall_h.png",
    rubble: T + "wall_h.png",
    pillar: T + "pillar_h.png",
    temple: T + "temple_h.png",
  },
  bumpScale: 2.5,
  glow: { obelisk: 0.5 },
  tile: { default: 4, floor: 7, wall: 6, rubble: 6, obelisk: 2.2, pillar: 3 },
  material: {
    floor: { roughness: 0.95, metalness: 0 },
    wall: { roughness: 0.95, metalness: 0 },
    obelisk: { roughness: 0.4, metalness: 0.2 },
  },
  fallbackColors: {
    floor: 0xb99b6d, wall: 0xb89a6a, rubble: 0xb89a6a, pillar: 0xcfc3a6,
    temple: 0x9d9784, obelisk: 0x1c1c22,
  },

  walls: perimeter(56, 7),

  props: [
    // The temple: four tiers, each a 0.48 step up.
    block("temple", 0, 0, 18, 18, 0.48),
    block("temple", 0, 0, 14, 14, 0.96),
    block("temple", 0, 0, 10, 10, 1.44),
    block("temple", 0, 0, 6, 6, 1.92),

    ...mirror4(quadrant),

    // North/south terraces (2.4 up) with stairs at both ends and an obelisk.
    ...mirror4([
      block("temple", 0, 25.5, 16, 4, 2.4),
      ...stairs("temple", { x: 8, z: 25.5, dir: "+x", width: 4 }),
      block("obelisk", 0, 25.5, 2.2, 2.2, 10),
    ]),
  ],

  spawns: [spawnAt(-24, -24), spawnAt(24, 24), spawnAt(-24, 24), spawnAt(24, -24)],
};
