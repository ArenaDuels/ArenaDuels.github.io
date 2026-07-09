// Towers — a larger arena with two raised platforms opposite each other,
// forcing vertical duels and jump-timing on top of the usual strafing.

export default {
  id: "towers",
  name: "Towers",
  thumb: "./assets/thumbs/towers.png",
  floorSize: 28,
  wallHeight: 5,
  bgColor: 0x0d0a14,

  textures: {
    floor: "./assets/textures/floor.png",
    wall: "./assets/textures/pillarwall.png",
    platform: "./assets/textures/wall.png",
  },
  fallbackColors: {
    floor: 0x14141a,
    wall: 0x262632,
    platform: 0x40405a,
  },

  walls: [
    [28, 5, 0.5, 0, 2.5, -14],
    [28, 5, 0.5, 0, 2.5, 14],
    [0.5, 5, 28, -14, 2.5, 0],
    [0.5, 5, 28, 14, 2.5, 0],
  ],

  // Four symmetric raised platforms, one per spawn corner, plus a central
  // ground-level cover pillar for anyone who drops down to fight below.
  props: [
    { type: "platform", w: 5, h: 1, d: 5, x: -9, y: 2, z: -9 },
    { type: "platform", w: 5, h: 1, d: 5, x: 9, y: 2, z: 9 },
    { type: "platform", w: 5, h: 1, d: 5, x: -9, y: 2, z: 9 },
    { type: "platform", w: 5, h: 1, d: 5, x: 9, y: 2, z: -9 },
    { type: "wall", w: 2, h: 3, d: 2, x: 0, y: 1.5, z: 0 },
  ],

  spawns: [
    { x: -9, y: 3.0, z: -9, yaw: Math.PI / 4 },
    { x: 9, y: 3.0, z: 9, yaw: -3 * Math.PI / 4 },
    { x: -9, y: 3.0, z: 9, yaw: -Math.PI / 4 },
    { x: 9, y: 3.0, z: -9, yaw: 3 * Math.PI / 4 },
  ],
};
