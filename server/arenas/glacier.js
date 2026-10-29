// Glacier — a research station on a frozen plain, built for three or four players.
// 112×112, more than five times the floor of Foundry. Long sightlines, but never
// far from cover:
//
//   - The STATION in the middle: a walled compound with four wide doorways. Each doorway holds a
//     staircase that climbs to the observation deck (the high ground; the glowing beacon spire
//     rises from its centre), with room beside it to walk into the courtyard.
//   - Four OUTPOSTS on the diagonals: concrete walled compounds with a doorway on every side
//     and a steel keep in the middle. Four of the eight spawn points are inside them.
//   - Four CONTAINER YARDS on the axes: stacked shipping containers and crates to weave through.
//   - Four FROZEN LAKES between the station and the outposts: open ice with a red-and-white
//     radio mast and a few icebergs for cover. Crossing them is a gamble.
//   - ICE RIDGES, 2.4 high: jump-up ledges along the lanes.
//   - Four CAMPS against the walls on the axes: small concrete bays, the other four spawn points.
//
// The whole thing is one wedge copied four times, a quarter turn at a time, so every spawn
// point has exactly the same surroundings (a pinwheel, no mirror image).

import { block, stairs, perimeter, spawnAt } from "./helpers.js";

const T = "./assets/textures/glacier/";

// Quarter turn about the middle of the map: (x, z) -> (-z, x). Blocks are axis-aligned, so
// the width and depth swap.
const turn = (p) => ({ ...p, x: -p.z || 0, z: p.x, w: p.d, d: p.w });
const rotate4 = (list) => {
  const out = [];
  let turned = list;
  for (let i = 0; i < 4; i++) {
    out.push(...turned);
    turned = turned.map(turn);
  }
  return out;
};

// One wedge of the map (the north-east quarter plus the east axis). Rotated into all four.
const wedge = [
  // ---- the station ----
  // walls with an 8-wide doorway in the middle of each side. A 5-wide staircase runs up through
  // each doorway, leaving a gap beside it to walk into the courtyard.
  block("lab", 15, 9.5, 1, 11, 6),
  block("lab", 15, -9.5, 1, 11, 6),
  block("tower", 15, 15, 4, 4, 9),              // corner tower
  block("crate", 9, 9, 2.4, 2.4, 2.0),          // courtyard cover
  ...stairs("deck", { x: 5, z: 0, dir: "+x", steps: 8, width: 5 }), // up to the observation deck

  // ---- the outpost on the diagonal ----
  // walls, 3.2 high, a 6-wide doorway in the middle of each side
  block("bunker", 52, 35.5, 1, 7, 3.2),
  block("bunker", 52, 48.5, 1, 7, 3.2),
  block("bunker", 32, 35.5, 1, 7, 3.2),
  block("bunker", 32, 48.5, 1, 7, 3.2),
  block("bunker", 35.5, 52, 7, 1, 3.2),
  block("bunker", 48.5, 52, 7, 1, 3.2),
  block("bunker", 35.5, 32, 7, 1, 3.2),
  block("bunker", 48.5, 32, 7, 1, 3.2),
  block("tower", 42, 42, 6, 6, 9),              // the keep
  block("crate", 47.5, 36.5, 2.4, 2.4, 2.0),
  block("crate", 36.5, 47.5, 2.4, 2.4, 2.0),

  // ---- the container yard on the axis ----
  block("container_red", 28, 6, 8, 2.6, 2.6),
  block("container_blue", 36, -6, 8, 2.6, 2.6),
  block("container_yellow", 32, 0, 2.6, 9, 5.2), // a double stack
  block("container_blue", 25, -3, 2.6, 6, 2.6),
  block("container_red", 39, 3, 2.6, 6, 2.6),
  block("crate", 30, -8.5, 2.4, 2.4, 2.0),
  block("crate", 34, 8.5, 2.4, 2.4, 2.0),
  block("crate", 28, 3.3, 2.4, 2.4, 2.0),       // a step up onto the red container's roof
  block("crate", 36, -2.8, 2.4, 2.4, 2.0),      // ...and onto the blue one's

  // ---- the frozen lake ----
  block("mast", 24, 24, 1.6, 1.6, 15),
  block("berg", 19.5, 28.5, 3.2, 3.2, 2.4),
  block("berg", 28.5, 19.5, 3.2, 3.2, 2.4),

  // ---- ridges between the station and the lake ----
  block("berg", 20, 8, 3, 14, 2.4),

  // ---- the camp against the east wall ----
  block("bunker", 50.35, 6, 10.7, 1, 3.2),
  block("bunker", 50.35, -6, 10.7, 1, 3.2),
  block("crate", 46, 0, 2.4, 2.4, 2.0),
];

export default {
  id: "glacier",
  name: "Glacier",
  tagline: "Frozen research station",
  description: "A vast frozen plain with a walled research station in the middle, four fortified outposts, container yards, icy lakes and long ridges. Room to run, rooms to hold — built for three or four players.",
  tags: ["112×112", "Arctic", "Huge"],
  thumb: "./assets/thumbs/glacier.png",
  modern: true,
  floorSize: 112,
  wallHeight: 10,
  bgColor: 0x9db4c8,

  environment: {
    fog: [0xa9bfd2, 70, 240],
    ambient: [0xdbe7ff, 0.75],
    sun: { color: 0xfff0d2, intensity: 1.1, position: [42, 58, -30] },
  },

  textures: {
    floor: T + "floor.jpg",
    ice: T + "ice.jpg",
    wall: T + "wall.jpg",
    lab: T + "lab.jpg",
    bunker: T + "bunker.jpg",
    tower: T + "tower.jpg",
    deck: T + "deck.jpg",
    crate: T + "crate.jpg",
    berg: T + "berg.jpg",
    mast: T + "mast.jpg",
    beacon: T + "beacon.jpg",
    container_red: T + "container_red.jpg",
    container_blue: T + "container_blue.jpg",
    container_yellow: T + "container_yellow.jpg",
  },
  bump: {
    floor: T + "floor_h.png",
    ice: T + "ice_h.png",
    wall: T + "wall_h.png",
    lab: T + "lab_h.png",
    bunker: T + "bunker_h.png",
    tower: T + "tower_h.png",
    deck: T + "deck_h.png",
    crate: T + "crate_h.png",
    berg: T + "berg_h.png",
    mast: T + "mast_h.png",
    container_red: T + "container_h.png",
    container_blue: T + "container_h.png",
    container_yellow: T + "container_h.png",
  },
  bumpScale: 2.0,
  glow: { beacon: 1.0 },
  tile: {
    default: 4, floor: 8, ice: 8, wall: 10, lab: 6, bunker: 4, tower: 3, deck: 3,
    crate: 2.4, berg: 4, mast: 3, beacon: 4,
    container_red: 4, container_blue: 4, container_yellow: 4,
  },
  material: {
    floor: { roughness: 0.95, metalness: 0 },
    ice: { roughness: 0.18, metalness: 0.1 },
    wall: { roughness: 0.45, metalness: 0.05 },
    lab: { roughness: 0.6, metalness: 0.2 },
    bunker: { roughness: 0.9, metalness: 0 },
    tower: { roughness: 0.55, metalness: 0.5 },
    deck: { roughness: 0.5, metalness: 0.55 },
    crate: { roughness: 0.75, metalness: 0.05 },
    berg: { roughness: 0.3, metalness: 0.05 },
    mast: { roughness: 0.5, metalness: 0.3 },
    beacon: { roughness: 0.4, metalness: 0.4 },
    container_red: { roughness: 0.55, metalness: 0.5 },
    container_blue: { roughness: 0.55, metalness: 0.5 },
    container_yellow: { roughness: 0.55, metalness: 0.5 },
  },
  fallbackColors: {
    floor: 0xdfe8ee, ice: 0x9fc8e0, wall: 0xa9cfe6, lab: 0xe8edf0, bunker: 0x8d9094,
    tower: 0x56616e, deck: 0x4d5560, crate: 0x9a6b3a, berg: 0xbfe0f0, mast: 0xd8453a,
    beacon: 0x20c8d8, container_red: 0xb23a2c, container_blue: 0x2f5f9a, container_yellow: 0xd9a826,
  },

  // visual-only ground patches: the four frozen lakes
  floors: rotate4([{ type: "ice", x: 24, z: 24, w: 16, d: 16, y: 0.02 }]),

  walls: perimeter(112, 10),

  props: [
    // The observation deck in the middle, with the beacon spire rising from it.
    block("deck", 0, 0, 10, 10, 3.84),
    block("beacon", 0, 0, 3, 3, 16),

    ...rotate4(wedge),
  ],

  spawns: [
    // inside the four outposts
    spawnAt(35.5, 35.5), spawnAt(-35.5, 35.5), spawnAt(-35.5, -35.5), spawnAt(35.5, -35.5),
    // in the four camps against the walls
    spawnAt(52, 0), spawnAt(0, 52), spawnAt(-52, 0), spawnAt(0, -52),
  ],
};
