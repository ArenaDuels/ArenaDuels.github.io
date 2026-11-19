// Backstreets — a city block at dusk: skyscrapers, a few low houses, narrow alleys and wide
// avenues. 120×120, bigger than Glacier. Mostly close-quarters in the alleys, with long sightlines
// down the avenues that you cross at a run.
//
//   - Two AVENUES (14 wide) cross in the middle at a small plaza, and a RING ROAD runs round the
//     edge. They're left bare: no crates, barriers or lamps, so it's all aim and no peeking.
//   - Twelve SKYSCRAPERS (30–46 high) and four low HOUSES (8) fill the blocks between the roads.
//     You can't get in, and the towers are walls you can't climb. Each block is cut by 5-wide
//     (empty) ALLEYS.
//   - One low house (north-east, on the alley) has a way up: hop on the crate, then the loading
//     dock, then the two fire-escape landings, and step onto the roof. The roof has a taller back
//     wing for cover and looks down the alley and over the street.
//
// The towers and houses are mirrored four ways (a mirror image across each avenue).

import { block, perimeter, spawnAt, mirror4 } from "./helpers.js";

const T = "./assets/textures/alley/";

// Swap x and z (a diagonal mirror). Blocks are axis-aligned, so width and depth swap too.
// ---- the buildings: 18×18 blocks with 5-wide alleys between them (29..34) and 4 of pavement to
// the avenue. Three towers and one low house in each quarter.
const buildings = [
  block("brick", 20, 20, 18, 18, 34),
  block("brownstone", 43, 43, 18, 18, 46),
  block("stucco", 43, 20, 18, 18, 30),
  block("stucco", 20, 43, 18, 18, 8),         // the low house
  block("stucco", 16, 47, 8, 8, 11.5),        // ...with a taller back wing
];

// ---- the way up onto ONE low house (the north-east one), along its alley wall (z = 34):
// ground -> crate (2.0) -> loading dock (3.6) -> landing (5.4) -> landing (7.0) -> roof (8.0)
const roofClimb = [
  block("crate", 27.4, 33.2, 1.6, 1.6, 2.0),
  block("dock", 24, 33.3, 4, 1.4, 3.6),
  block("escape", 20.5, 33.3, 3, 1.4, 5.4),
  block("escape", 17.5, 33.3, 3, 1.4, 7.0),
  block("dumpster", 30.2, 33.1, 2.4, 1.4, 1.6), // junk piled by the crate
];

// ---- visual-only ground: roads, and the paint on them ----
const floors = [
  // plaza + four arms of the avenues
  { type: "road", x: 0, z: 0, w: 14, d: 14, y: 0.02 },
  ...[1, -1].flatMap((s) => [
    { type: "road", x: 0, z: s * 29.5, w: 14, d: 45, y: 0.02 },
    { type: "road", x: s * 29.5, z: 0, w: 45, d: 14, y: 0.02 },
    // ring road
    { type: "road", x: 0, z: s * 56, w: 120, d: 8, y: 0.02 },
    { type: "road", x: s * 56, z: 0, w: 8, d: 104, y: 0.02 },
    // double yellow down the avenues, white line along the ring road
    { type: "paint_yellow", x: 0, z: s * 29.5, w: 0.4, d: 45, y: 0.04 },
    { type: "paint_yellow", x: s * 29.5, z: 0, w: 45, d: 0.4, y: 0.04 },
    { type: "paint_white", x: 0, z: s * 56, w: 120, d: 0.3, y: 0.04 },
    { type: "paint_white", x: s * 56, z: 0, w: 0.3, d: 104, y: 0.04 },
  ]),
];
// zebra crossings where the avenues meet the plaza
for (const s of [1, -1]) {
  for (let i = -5; i <= 5; i++) {
    floors.push({ type: "paint_white", x: i * 1.15, z: s * 9, w: 0.6, d: 3, y: 0.04 });
    floors.push({ type: "paint_white", x: s * 9, z: i * 1.15, w: 3, d: 0.6, y: 0.04 });
  }
}

export default {
  id: "alley",
  name: "Backstreets",
  tagline: "Skyscraper alleys at dusk",
  description: "A big city block at dusk: skyscrapers and a few low houses, narrow alleys between them, and wide empty avenues. Fight close in the alleys, dash the avenues, and climb the junk to one rooftop.",
  tags: ["120×120", "City", "Huge"],
  thumb: "./assets/thumbs/alley.png",
  modern: true,
  floorSize: 120,
  wallHeight: 12,
  bgColor: 0x8d95a3,

  environment: {
    fog: [0x939bab, 80, 260],
    ambient: [0xd6dcf0, 0.7],
    sun: { color: 0xffd9a8, intensity: 1.15, position: [-48, 52, 30] },
  },

  textures: {
    floor: T + "floor.jpg", road: T + "road.jpg",
    paint_yellow: T + "paint_yellow.jpg", paint_white: T + "paint_white.jpg",
    wall: T + "wall.jpg", brick: T + "brick.jpg", stucco: T + "stucco.jpg", brownstone: T + "brownstone.jpg",
    dock: T + "dock.jpg", escape: T + "escape.jpg", pole: T + "pole.jpg",
    crate: T + "crate.jpg", dumpster: T + "dumpster.jpg",
  },
  bump: {
    floor: T + "floor_h.png", road: T + "road_h.png", wall: T + "wall_h.png",
    brick: T + "brick_h.png", stucco: T + "stucco_h.png", brownstone: T + "brownstone_h.png",
    dock: T + "dock_h.png", escape: T + "escape_h.png", crate: T + "crate_h.png", dumpster: T + "dumpster_h.png",
  },
  bumpScale: 1.5,
  tile: {
    default: 4, floor: 8, road: 8, paint_yellow: 2, paint_white: 2,
    wall: 8, brick: 8, stucco: 8, brownstone: 8, dock: 4, escape: 2,
    crate: 2, dumpster: 2,
  },
  material: {
    floor: { roughness: 0.95, metalness: 0 },
    road: { roughness: 0.9, metalness: 0 },
    paint_yellow: { roughness: 0.8, metalness: 0 },
    paint_white: { roughness: 0.8, metalness: 0 },
    wall: { roughness: 0.9, metalness: 0 },
    brick: { roughness: 0.9, metalness: 0 },
    stucco: { roughness: 0.95, metalness: 0 },
    brownstone: { roughness: 0.9, metalness: 0 },
    dock: { roughness: 0.95, metalness: 0 },
    escape: { roughness: 0.55, metalness: 0.6 },
    crate: { roughness: 0.8, metalness: 0.05 },
    dumpster: { roughness: 0.6, metalness: 0.4 },
  },
  fallbackColors: {
    floor: 0xb0aea8, road: 0x44464a, paint_yellow: 0xe2b622, paint_white: 0xe8e8e2,
    wall: 0x7a4e40, brick: 0xa8503a, stucco: 0xe0cfa8, brownstone: 0x7a5f4e,
    dock: 0x908e88, escape: 0x3a3e44, crate: 0x9a6b3a, dumpster: 0x2f6a46,
  },

  floors,

  walls: perimeter(120, 12),

  props: [...mirror4(buildings), ...roofClimb],

  spawns: [
    // on the ring road, between the cars
    spawnAt(56, 31), spawnAt(56, -31), spawnAt(-56, 31), spawnAt(-56, -31),
    spawnAt(31, 56), spawnAt(-31, 56), spawnAt(31, -56), spawnAt(-31, -56),
  ],
};
