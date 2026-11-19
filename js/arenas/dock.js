// Dock — a wooden pier out in the open sea, the same size as Foundry (48×48) but completely
// open. There's nowhere to hide and nothing to peek round, so it's all about aim, and the one piece
// of high ground.
//
//   - A long cargo SHED in the middle (3.84 high) with a staircase at each end up to its flat
//     roof: the high ground. A concrete apron is painted round it.
//   - On every side there's only a railing and then the sea, all the way to the horizon. The rail
//     is for show: an invisible wall behind it keeps you on the pier.
//
// The shed is mirrored left-right and top-bottom, so every spawn has the same view.

import { block, stairs, mirrorX, spawnAt } from "./helpers.js";

const T = "./assets/textures/dock/";

const HALF = 24;

// ---- the shed and the stairs at its two ends ----
const shed = [
  block("shed", 0, 0, 14, 8, 3.84),
  ...mirrorX(stairs("quay", { x: 7, z: 0, dir: "+x", steps: 8, rise: 0.48, run: 1.0, width: 3 })),
];

// ---- the edge: an invisible wall to stop you, a quay wall and a railing to look at ----
const e = HALF + 0.3;
const walls = [
  [2 * e, 8, 0.6, 0, 4, -e, "invisible"],
  [2 * e, 8, 0.6, 0, 4, e, "invisible"],
  [0.6, 8, 2 * e, -e, 4, 0, "invisible"],
  [0.6, 8, 2 * e, e, 4, 0, "invisible"],
];

const decor = [];
// the face of the quay going down into the water
for (const s of [-1, 1]) {
  decor.push({ type: "quay", w: 2 * e, h: 3, d: 0.6, x: 0, y: -1.5, z: s * e });
  decor.push({ type: "quay", w: 0.6, h: 3, d: 2 * e, x: s * e, y: -1.5, z: 0 });
}
// railing: a post every 6 m, a top rail and a middle rail along each side
const r = HALF - 0.4;
for (let t = -HALF + 0.4; t <= HALF - 0.4 + 0.01; t += 6.4) {
  for (const s of [-1, 1]) {
    decor.push({ type: "rail", w: 0.16, h: 1.1, d: 0.16, x: t, y: 0.55, z: s * r });
    if (Math.abs(t) < r - 0.1) decor.push({ type: "rail", w: 0.16, h: 1.1, d: 0.16, x: s * r, y: 0.55, z: t });
  }
}
for (const s of [-1, 1]) {
  for (const [y, th] of [[1.08, 0.09], [0.55, 0.06]]) {
    decor.push({ type: "rail", w: 2 * r, h: th, d: th, x: 0, y, z: s * r });
    decor.push({ type: "rail", w: th, h: th, d: 2 * r, x: s * r, y, z: 0 });
  }
}

// ---- visual-only ground: the concrete apron round the shed, with a yellow edge ----
const floors = [
  { type: "apron", x: 0, z: 0, w: 28, d: 18, y: 0.02 },
  { type: "paint_yellow", x: 0, z: 8.7, w: 28, d: 0.25, y: 0.04 },
  { type: "paint_yellow", x: 0, z: -8.7, w: 28, d: 0.25, y: 0.04 },
  { type: "paint_yellow", x: 13.7, z: 0, w: 0.25, d: 18, y: 0.04 },
  { type: "paint_yellow", x: -13.7, z: 0, w: 0.25, d: 18, y: 0.04 },
];

export default {
  id: "dock",
  name: "Dock",
  tagline: "Open pier over the sea",
  description: "A wooden pier in the open sea, the size of Foundry but almost bare. A long cargo shed with a roof you can climb sits in the middle, with a few crates and barriers around it. Hold the roof or fight for the lanes below.",
  tags: ["48×48", "Harbor", "Medium"],
  thumb: "./assets/thumbs/dock.png",
  modern: true,
  floorSize: 48,
  wallHeight: 8,
  bgColor: 0xa9d1ea,

  environment: {
    fog: [0xb4d6ec, 70, 430],
    ambient: [0xdfeeff, 0.8],
    sun: { color: 0xfff0d0, intensity: 1.2, position: [30, 55, -20] },
  },

  // the sea, lying 1.4 below the deck and reaching to the horizon
  ocean: { y: -1.4, size: 2400, tile: 20 },

  textures: {
    floor: T + "floor.jpg", apron: T + "apron.jpg", paint_yellow: T + "paint_yellow.jpg",
    quay: T + "quay.jpg", rail: T + "rail.jpg", shed: T + "shed.jpg", water: T + "water.jpg",
  },
  bump: {
    floor: T + "floor_h.png", apron: T + "apron_h.png", quay: T + "quay_h.png",
    shed: T + "shed_h.png", water: T + "water_h.png",
  },
  bumpScale: 1.5,
  tile: {
    default: 4, floor: 4, apron: 8, paint_yellow: 2, quay: 4, rail: 2, shed: 4, water: 20,
  },
  material: {
    floor: { roughness: 0.92, metalness: 0 },
    apron: { roughness: 0.95, metalness: 0 },
    paint_yellow: { roughness: 0.8, metalness: 0 },
    quay: { roughness: 0.95, metalness: 0 },
    rail: { roughness: 0.5, metalness: 0.6 },
    shed: { roughness: 0.6, metalness: 0.5 },
    water: { roughness: 0.18, metalness: 0.2 },
  },
  fallbackColors: {
    floor: 0x8a6e4e, apron: 0xb0aea8, paint_yellow: 0xe2b622, quay: 0x908e88, rail: 0x2c3036,
    shed: 0x7a8c9a, water: 0x1f7a98, wall: 0x908e88,
  },

  floors,
  walls,
  decor,

  props: shed,

  spawns: [
    spawnAt(21.5, 2.5), spawnAt(21.5, -2.5), spawnAt(-21.5, 2.5), spawnAt(-21.5, -2.5),
    spawnAt(2.5, 21.5), spawnAt(-2.5, 21.5), spawnAt(2.5, -21.5), spawnAt(-2.5, -21.5),
  ],
};
