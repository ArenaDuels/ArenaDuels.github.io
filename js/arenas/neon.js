// Neon Grid — a night-time data arena. A tall core tower stands in the
// middle (stairs up on the east and west), ringed by four satellite pads
// where everyone starts, 2.4 up. Drop down to fight over the floor, or
// race the stairs for the core. Light pylons and walls cut the lanes.

import { block, stairs, mirror4, perimeter, spawnAt } from "./_helpers.js";

const T = "./assets/textures/neon/";

export default {
  id: "neon",
  name: "Neon Grid",
  thumb: "./assets/thumbs/neon.png",
  modern: true,
  floorSize: 44,
  wallHeight: 10,
  bgColor: 0x05060d,

  environment: {
    fog: [0x05060d, 32, 95],
    ambient: [0x8a98ff, 0.4],
    sun: { color: 0x9db8ff, intensity: 0.7, position: [-14, 44, 22] },
  },

  textures: {
    floor: T + "floor.jpg",
    wall: T + "wall.jpg",
    platform: T + "platform.jpg",
    core: T + "core.jpg",
    pylon: T + "pylon.jpg",
  },
  bump: {
    wall: T + "wall_h.png",
  },
  bumpScale: 1.5,
  glow: { floor: 0.85, wall: 0.9, platform: 0.8, core: 1.1, pylon: 1.3 },
  tile: { default: 4, floor: 8, pylon: 2, core: 6 },
  material: {
    floor: { roughness: 0.35, metalness: 0.6 },
    wall: { roughness: 0.5, metalness: 0.5 },
    platform: { roughness: 0.4, metalness: 0.6 },
    core: { roughness: 0.4, metalness: 0.6 },
  },
  fallbackColors: {
    floor: 0x0a0c14, wall: 0x10142a, platform: 0x16161f, core: 0x0a1018, pylon: 0x22d3ee,
  },

  walls: perimeter(44, 10),

  props: [
    // Core tower (top 4.8) with ten-step stairs east and west.
    block("core", 0, 0, 12, 12, 4.8),
    ...stairs("core", { x: 6, z: 0, dir: "+x", steps: 10, run: 1.0, width: 4 }),
    ...stairs("core", { x: -6, z: 0, dir: "-x", steps: 10, run: 1.0, width: 4 }),
    block("pylon", 0, 0, 2, 2, 11),
    ...mirror4([block("pylon", 4, 4, 1.6, 1.6, 6.8)]),

    // Satellite pads — one per spawn — each with two stairways.
    ...mirror4([
      block("platform", 15, 15, 8, 8, 2.4),
      ...stairs("platform", { x: 15, z: 11, dir: "-z", width: 4 }),
      ...stairs("platform", { x: 11, z: 15, dir: "-x", width: 4 }),
      block("platform", 9, 9, 3, 3, 2.0),
    ]),

    // Lane breakers on the axes.
    ...mirror4([
      block("pylon", 0, 11, 2, 2, 6),
      block("wall", 0, 18, 10, 0.6, 5),
      block("wall", 18, 0, 0.6, 10, 5),
    ]),
  ],

  spawns: [
    spawnAt(-15, -15, 2.4), spawnAt(15, 15, 2.4), spawnAt(-15, 15, 2.4), spawnAt(15, -15, 2.4),
  ],
};
