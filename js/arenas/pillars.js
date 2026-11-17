// Pillars — a proper large arena with a 3x3-style scattered pillar field
// for real 4-player cover, not just a couple of dodge points.

export default {
  id: "pillars",
  name: "Pillars",
  thumb: "./assets/thumbs/pillars.png",
  floorSize: 40,
  wallHeight: 4,
  bgColor: 0x0a0d14,

  textures: {
    floor: "./assets/textures/floor.png",
    wall: "./assets/textures/pillarwall.png",
    pillar: "./assets/textures/pillarwall.png",
  },
  fallbackColors: {
    floor: 0x1c1c22,
    wall: 0x2e2e38,
    pillar: 0x3a3a46,
  },

  walls: [
    [40, 4, 0.5, 0, 2, -20],
    [40, 4, 0.5, 0, 2, 20],
    [0.5, 4, 40, -20, 2, 0],
    [0.5, 4, 40, 20, 2, 0],
  ],

  // Nine pillars: a ring around the middle plus a bigger central one —
  // enough scattered cover to break sightlines across the whole arena
  // instead of just around one spot.
  props: [
    { type: "pillar", w: 1.5, h: 4, d: 1.5, x: -8, y: 2, z: -8 },
    { type: "pillar", w: 1.5, h: 4, d: 1.5, x: 8, y: 2, z: 8 },
    { type: "pillar", w: 1.5, h: 4, d: 1.5, x: 8, y: 2, z: -8 },
    { type: "pillar", w: 1.5, h: 4, d: 1.5, x: -8, y: 2, z: 8 },
    { type: "pillar", w: 1.5, h: 4, d: 1.5, x: 0, y: 2, z: -12 },
    { type: "pillar", w: 1.5, h: 4, d: 1.5, x: 0, y: 2, z: 12 },
    { type: "pillar", w: 1.5, h: 4, d: 1.5, x: -12, y: 2, z: 0 },
    { type: "pillar", w: 1.5, h: 4, d: 1.5, x: 12, y: 2, z: 0 },
    { type: "pillar", w: 2, h: 4, d: 2, x: 0, y: 2, z: 0 },
  ],

  spawns: [
    { x: -15, y: 1.4, z: -15, yaw: Math.PI / 4 },
    { x: 15, y: 1.4, z: 15, yaw: -3 * Math.PI / 4 },
    { x: -15, y: 1.4, z: 15, yaw: -Math.PI / 4 },
    { x: 15, y: 1.4, z: -15, yaw: 3 * Math.PI / 4 },
  ],
};
