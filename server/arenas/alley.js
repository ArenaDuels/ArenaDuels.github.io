// Backstreets — a city block at dusk: skyscrapers, a few low houses, narrow alleys and wide
// avenues. 120×120, bigger than Glacier. Mostly close-quarters in the alleys, with long sightlines
// down the avenues that you cross at a run.
//
//   - Two AVENUES (14 wide) cross in the middle at a small plaza, and a RING ROAD runs round the
//     edge. Crates, dumpsters and low barriers are left on them for cover.
//   - Twelve SKYSCRAPERS (30–46 high) and four low HOUSES (8) fill the blocks between the roads.
//     You can't get in, and the towers are walls you can't climb. Each block is cut by 5-wide
//     ALLEYS with dumpsters and crates.
//   - One low house (north-east, on the alley) has a way up: hop on the crate, then the loading
//     dock, then the two fire-escape landings, and step onto the roof. The roof has a taller back
//     wing for cover and looks down the alley and over the street.
//   - Street lamps along the pavements are thin cover.
//
// The towers and houses are mirrored four ways (a mirror image across each avenue). The street
// and alley clutter is also the same when you swap x and z.

import { block, perimeter, spawnAt, mirror4 } from "./helpers.js";

const T = "./assets/textures/alley/";

// Swap x and z (a diagonal mirror). Blocks are axis-aligned, so width and depth swap too.
const swap = (p) => ({ ...p, x: p.z, z: p.x, w: p.d, d: p.w });
// Mirror a north-east quarter four ways and across the diagonal. Things on the diagonal are
// not doubled.
const sym8 = (list) => mirror4(list.flatMap((p) => (p.x === p.z ? [p] : [p, swap(p)])));

const lamp = (x, z) => block("pole", x, z, 0.5, 0.5, 7);

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

// ---- cover in the alleys and streets; the north-east quarter, mirrored and swapped ----
const clutter = [
  // alleys (the one along x, z 29..34; swapping gives the one along z)
  block("dumpster", 14.5, 30.2, 2.4, 1.4, 1.6),
  block("crate", 22, 29.8, 1.6, 1.6, 2.0),
  block("dumpster", 38.5, 32.7, 2.4, 1.4, 1.6),
  block("crate", 46, 30.3, 1.6, 1.6, 2.0),
  block("crate", 47.7, 30.3, 1.6, 1.6, 2.0),
  block("crate", 31.5, 31.5, 1.8, 1.8, 2.0),  // the alley crossing

  // the avenue along z (x 0..7)
  block("dock", 3.0, 20, 1.0, 3.2, 1.1),      // low barrier
  block("crate", 4.6, 34, 1.8, 1.8, 2.0),
  block("dumpster", 2.6, 46, 1.4, 2.4, 1.6),
  lamp(8.6, 16),
  lamp(8.6, 38),

  // the ring road (x 52..60)
  block("dock", 54.5, 18, 1.0, 3.2, 1.1),
  block("dumpster", 57.5, 36, 1.4, 2.4, 1.6),
  block("crate", 55, 46, 1.8, 1.8, 2.0),
  block("crate", 57, 57, 2, 2, 2.0),          // the corner
  block("dock", 54.2, 56.5, 3, 1.2, 1.1),
];

// the fountain in the plaza
const centre = [block("dock", 0, 0, 4, 4, 1.2)];

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
    wall: 8, brick: 8, stucco: 8, brownstone: 8, dock: 4, escape: 2, pole: 2,
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
    pole: { roughness: 0.5, metalness: 0.6 },
    crate: { roughness: 0.8, metalness: 0.05 },
    dumpster: { roughness: 0.6, metalness: 0.4 },
  },
  fallbackColors: {
    floor: 0xb0aea8, road: 0x44464a, paint_yellow: 0xe2b622, paint_white: 0xe8e8e2,
    wall: 0x7a4e40, brick: 0xa8503a, stucco: 0xe0cfa8, brownstone: 0x7a5f4e,
    dock: 0x908e88, escape: 0x3a3e44, pole: 0x2c3036, crate: 0x9a6b3a, dumpster: 0x2f6a46,
  },

  floors,

  walls: perimeter(120, 12),

  props: [...centre, ...mirror4(buildings), ...roofClimb, ...sym8(clutter)],

  spawns: [
    // on the ring road, between the cars
    spawnAt(56, 31), spawnAt(56, -31), spawnAt(-56, 31), spawnAt(-56, -31),
    spawnAt(31, 56), spawnAt(-31, 56), spawnAt(31, -56), spawnAt(-31, -56),
  ],
};
