// Towers — a bigger arena with four raised platforms (one per spawn) and
// a central raised platform connecting them, giving vertical duels and
// air-strafe traversal between towers instead of just isolated ledges.

export default {
  id: "towers",
  name: "Towers",
  thumb: "./assets/thumbs/towers.png",
  floorSize: 36,
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
    [36, 5, 0.5, 0, 2.5, -18],
    [36, 5, 0.5, 0, 2.5, 18],
    [0.5, 5, 36, -18, 2.5, 0],
    [0.5, 5, 36, 18, 2.5, 0],
  ],

  // Four corner platforms (one per spawn) plus a smaller central platform,
  // close enough together that air-strafe jumps between them are viable.
  props: [
    { type: "platform", w: 6, h: 1, d: 6, x: -13, y: 2.2, z: -13 },
    { type: "platform", w: 6, h: 1, d: 6, x: 13, y: 2.2, z: 13 },
    { type: "platform", w: 6, h: 1, d: 6, x: -13, y: 2.2, z: 13 },
    { type: "platform", w: 6, h: 1, d: 6, x: 13, y: 2.2, z: -13 },
    { type: "platform", w: 4, h: 1, d: 4, x: 0, y: 1.6, z: 0 },
  ],

  spawns: [
    { x: -13, y: 3.2, z: -13, yaw: Math.PI / 4 },
    { x: 13, y: 3.2, z: 13, yaw: -3 * Math.PI / 4 },
    { x: -13, y: 3.2, z: 13, yaw: -Math.PI / 4 },
    { x: 13, y: 3.2, z: -13, yaw: 3 * Math.PI / 4 },
  ],
};
