// Cave — a dark cavern, 80×80 under a rock ceiling 16 up. There's almost no daylight: you see by the
// glow of crystals and by amber lamps in the corner hideouts, so the dark between the lights
// is where you hide (and where you get ambushed).
//
//   - The CENTRE: a worn stone plateau (1.92 high, a stair on each side) around a tall glowing
//     crystal spire. The high ground, and the brightest place on the map.
//   - Four LOBES (east, west, north, south) of open cavern, each with a glowing pool, a crystal,
//     and a few boulders (2.0, with a taller 4.0 one beside it to climb).
//   - Four CORNER HIDEOUTS: rock walls (floor to ceiling) with a doorway at each end, an amber lamp
//     and a crystal inside, and two spawn points. Eight spawns in all.
//   - Floor-to-ceiling PILLARS on the diagonals to break up the long sightlines.
//   - Stalactites hang from the ceiling for looks; the ceiling and stalactites aren't solid.
//
// One quarter is drawn, then mirrored four ways and across the diagonal, so all eight spawns
// look the same.

import { block, stairs, perimeter, spawnAt, mirror4 } from "./helpers.js";

const T = "./assets/textures/cave/";
const H = 16;   // roof height

const swap = (p) => ({ ...p, x: p.z, z: p.x, w: p.d, d: p.w });
const sym8 = (list) => mirror4(list.flatMap((p) => (p.x === p.z ? [p] : [p, swap(p)])));

const quarter = [
  // ---- the central plateau's four stairs (the plateau itself is below) ----
  ...stairs("slab", { x: 7, z: 0, dir: "+x", steps: 4, rise: 0.48, run: 1.0, width: 3 }),

  // ---- a pillar on the diagonal, floor to ceiling ----
  block("rock", 15, 15, 6, 6, H),

  // ---- corner hideout: walls with a doorway at each end ----
  block("rock", 30.5, 24, 10, 3, H),          // 25.5..35.5; the gap beyond it to the outer wall is the doorway
  block("crystal", 31, 31, 1.8, 1.8, 2.4),    // inside the hideout

  // ---- a lobe (the east one, x 22.5..40); the same is made for the other three by swapping ----
  block("crystal", 30, 0, 2, 2, 3.2),
  block("rock", 31, 10, 3, 3, 2.0),
  block("rock", 33.7, 10, 2.4, 2.4, 4.0),     // a taller one right beside it: hop up
  block("rock", 27, 15.5, 3, 3, 2.0),
  block("rock", 36, 17, 2.4, 2.4, 2.0),
];

// ---- stalactites: not solid, just hanging from the ceiling ----
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const decor = [];
for (let i = 0; i < 44; i++) {
  const x = (rnd() - 0.5) * 76, z = (rnd() - 0.5) * 76;
  const w = 1.0 + rnd() * 1.6, len = 2.5 + rnd() * 4.5;
  decor.push({ type: "rock", w, h: len, d: w, x, y: H - len / 2, z });                 // the thick top
  decor.push({ type: "rock", w: w * 0.45, h: len * 0.7, d: w * 0.45, x, y: H - len - (len * 0.7) / 2, z }); // the point
}

export default {
  id: "cave",
  name: "Cave",
  tagline: "Dark cavern, crystal light",
  description: "A dark cave under a rock ceiling, lit only by glowing crystals and amber lamps. Hold the bright plateau in the middle, or hide in the dark and ambush from the corner hideouts and the cavern lobes.",
  tags: ["80×80", "Cave", "Dark"],
  thumb: "./assets/thumbs/cave.png",
  modern: true,
  floorSize: 80,
  wallHeight: H,
  bgColor: 0x03050a,

  environment: {
    fog: [0x04070c, 8, 90],
    ambient: [0x4a5a80, 0.5],
    sun: { color: 0x000000, intensity: 0, position: [0, 60, 0] },   // no sun underground
  },

  ceiling: { y: H },

  // a few real lights: every one costs on every surface, so keep it to about nine
  lights: [
    { x: 0, y: 6, z: 0, color: 0x66e8ff, intensity: 220, distance: 46, decay: 1.7 },        // the spire
    { x: 30, y: 3, z: 0, color: 0x66e8ff, intensity: 150, distance: 34, decay: 1.7 },       // lobe crystals
    { x: -30, y: 3, z: 0, color: 0x66e8ff, intensity: 150, distance: 34, decay: 1.7 },
    { x: 0, y: 3, z: 30, color: 0x66e8ff, intensity: 150, distance: 34, decay: 1.7 },
    { x: 0, y: 3, z: -30, color: 0x66e8ff, intensity: 150, distance: 34, decay: 1.7 },
    { x: 32, y: 4, z: 32, color: 0xffb060, intensity: 150, distance: 30, decay: 1.7 },      // corner lamps
    { x: -32, y: 4, z: 32, color: 0xffb060, intensity: 150, distance: 30, decay: 1.7 },
    { x: 32, y: 4, z: -32, color: 0xffb060, intensity: 150, distance: 30, decay: 1.7 },
    { x: -32, y: 4, z: -32, color: 0xffb060, intensity: 150, distance: 30, decay: 1.7 },
  ],

  textures: {
    floor: T + "floor.jpg", wall: T + "wall.jpg", rock: T + "rock.jpg", ceiling: T + "ceiling.jpg",
    slab: T + "slab.jpg", crystal: T + "crystal.jpg", pool: T + "pool.jpg",
  },
  bump: {
    floor: T + "floor_h.png", wall: T + "wall_h.png", rock: T + "rock_h.png", ceiling: T + "ceiling_h.png",
    slab: T + "slab_h.png", crystal: T + "crystal_h.png",
  },
  bumpScale: 1.5,
  glow: { crystal: 1.3, pool: 0.55 },
  tile: { default: 4, floor: 6, wall: 8, rock: 4, ceiling: 10, slab: 4, crystal: 2, pool: 4 },
  material: {
    floor: { roughness: 0.95, metalness: 0 },
    wall: { roughness: 0.95, metalness: 0 },
    rock: { roughness: 0.9, metalness: 0 },
    ceiling: { roughness: 0.95, metalness: 0 },
    slab: { roughness: 0.9, metalness: 0 },
    crystal: { roughness: 0.2, metalness: 0.1 },
    pool: { roughness: 0.2, metalness: 0.1 },
  },
  fallbackColors: {
    floor: 0x4a4440, wall: 0x453f3d, rock: 0x7a726a, ceiling: 0x1e1c20, slab: 0x7a7870,
    crystal: 0x60d8f0, pool: 0x2a9aa8,
  },

  // visual-only: a glowing pool in the middle of each lobe (you can wade through it)
  floors: [
    { type: "pool", x: 36, z: 0, w: 6, d: 11, y: 0.02 },
    { type: "pool", x: -36, z: 0, w: 6, d: 11, y: 0.02 },
    { type: "pool", x: 0, z: 36, w: 11, d: 6, y: 0.02 },
    { type: "pool", x: 0, z: -36, w: 11, d: 6, y: 0.02 },
  ],

  walls: perimeter(80, H),

  props: [
    block("slab", 0, 0, 14, 14, 1.92),         // the plateau
    block("crystal", 0, 0, 3, 3, 6),           // the spire
    ...sym8(quarter),
  ],

  decor,

  // two in each corner hideout
  spawns: [
    spawnAt(35, 29), spawnAt(29, 35), spawnAt(-35, 29), spawnAt(-29, 35),
    spawnAt(35, -29), spawnAt(29, -35), spawnAt(-35, -29), spawnAt(-29, -35),
  ],
};
