// Pillars — bigger arena, two center pillars for cover/dodging LG shots.

export default {
  id: "pillars",
  name: "Pillars",
  thumb: "./assets/thumbs/pillars.png",
  floorSize: 24,
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
    [24, 4, 0.5, 0, 2, -12],
    [24, 4, 0.5, 0, 2, 12],
    [0.5, 4, 24, -12, 2, 0],
    [0.5, 4, 24, 12, 2, 0],
  ],

  // Four pillars in a symmetric cross pattern — enough scattered cover for
  // a full 4-player free-for-all, not just a 1v1 dodge point.
  props: [
    { type: "pillar", w: 1.5, h: 4, d: 1.5, x: -4, y: 2, z: -3 },
    { type: "pillar", w: 1.5, h: 4, d: 1.5, x: 4, y: 2, z: 3 },
    { type: "pillar", w: 1.5, h: 4, d: 1.5, x: 4, y: 2, z: -3 },
    { type: "pillar", w: 1.5, h: 4, d: 1.5, x: -4, y: 2, z: 3 },
  ],

  spawns: [
    { x: -9, y: 1.4, z: -9, yaw: Math.PI / 4 },
    { x: 9, y: 1.4, z: 9, yaw: -3 * Math.PI / 4 },
    { x: -9, y: 1.4, z: 9, yaw: -Math.PI / 4 },
    { x: 9, y: 1.4, z: -9, yaw: 3 * Math.PI / 4 },
  ],
};
