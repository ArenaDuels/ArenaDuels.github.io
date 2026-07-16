// Mega Towers — a 50x50 arena with four massive towers (8 units tall) that
// have interiors you can climb through with platforms at various heights,
// enabling complex 3D vertical combat and air-strafe sequences.

export default {
  id: "mega-towers",
  name: "Mega Towers",
  thumb: "./assets/thumbs/mega-towers.png",
  floorSize: 50,
  wallHeight: 8,
  bgColor: 0x0a0d14,

  textures: {
    floor: "./assets/textures/floor.png",
    wall: "./assets/textures/pillarwall.png",
    tower: "./assets/textures/wall.png",
    platform: "./assets/textures/pillarwall.png",
  },
  fallbackColors: {
    floor: 0x1c1c22,
    wall: 0x2e2e38,
    tower: 0x353545,
    platform: 0x40405a,
  },

  walls: [
    [50, 8, 0.5, 0, 4, -25],
    [50, 8, 0.5, 0, 4, 25],
    [0.5, 8, 50, -25, 4, 0],
    [0.5, 8, 50, 25, 4, 0],
  ],

  props: [
    // TOWER 1: Top-left — outer shell + interior climbing platforms
    { type: "tower", w: 8, h: 8, d: 8, x: -16, y: 4, z: -16 },
    // Interior platforms for climbing
    { type: "platform", w: 6, h: 0.5, d: 6, x: -16, y: 1.5, z: -16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: -16, y: 3, z: -16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: -16, y: 4.5, z: -16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: -16, y: 6, z: -16 },
    // Interior walls to create maze-like space
    { type: "tower", w: 0.4, h: 3, d: 4, x: -14, y: 2.5, z: -16 },
    { type: "tower", w: 4, h: 3, d: 0.4, x: -16, y: 2.5, z: -14 },

    // TOWER 2: Top-right
    { type: "tower", w: 8, h: 8, d: 8, x: 16, y: 4, z: -16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: 16, y: 1.5, z: -16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: 16, y: 3, z: -16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: 16, y: 4.5, z: -16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: 16, y: 6, z: -16 },
    { type: "tower", w: 0.4, h: 3, d: 4, x: 14, y: 2.5, z: -16 },
    { type: "tower", w: 4, h: 3, d: 0.4, x: 16, y: 2.5, z: -14 },

    // TOWER 3: Bottom-left
    { type: "tower", w: 8, h: 8, d: 8, x: -16, y: 4, z: 16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: -16, y: 1.5, z: 16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: -16, y: 3, z: 16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: -16, y: 4.5, z: 16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: -16, y: 6, z: 16 },
    { type: "tower", w: 0.4, h: 3, d: 4, x: -14, y: 2.5, z: 16 },
    { type: "tower", w: 4, h: 3, d: 0.4, x: -16, y: 2.5, z: 14 },

    // TOWER 4: Bottom-right
    { type: "tower", w: 8, h: 8, d: 8, x: 16, y: 4, z: 16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: 16, y: 1.5, z: 16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: 16, y: 3, z: 16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: 16, y: 4.5, z: 16 },
    { type: "platform", w: 6, h: 0.5, d: 6, x: 16, y: 6, z: 16 },
    { type: "tower", w: 0.4, h: 3, d: 4, x: 14, y: 2.5, z: 16 },
    { type: "tower", w: 4, h: 3, d: 0.4, x: 16, y: 2.5, z: 14 },

    // Central bridge connecting towers (encourages mid-map fights)
    { type: "platform", w: 30, h: 0.4, d: 1, x: 0, y: 3.2, z: 0 },
    { type: "platform", w: 1, h: 0.4, d: 30, x: 0, y: 3.2, z: 0 },

    // Sky platform in center (high risk/reward)
    { type: "platform", w: 4, h: 0.5, d: 4, x: 0, y: 6, z: 0 },
  ],

  spawns: [
    { x: -16, y: 1.4, z: -16, yaw: Math.PI / 4 },
    { x: 16, y: 1.4, z: -16, yaw: -Math.PI / 4 },
    { x: -16, y: 1.4, z: 16, yaw: 3 * Math.PI / 4 },
    { x: 16, y: 1.4, z: 16, yaw: -3 * Math.PI / 4 },
  ],
};
