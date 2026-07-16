// Mega Towers — tall arena with four corner towers and elevated central platform.
// No interiors — clean vertical gameplay with platforms at multiple heights.

export default {
  id: "mega-towers",
  name: "Mega Towers",
  thumb: "./assets/thumbs/mega-towers.png",
  floorSize: 60,
  wallHeight: 8,
  bgColor: 0x0a0d14,

  textures: {
    floor: "./assets/textures/floor.png",
    wall: "./assets/textures/pillarwall.png",
  },
  fallbackColors: {
    floor: 0x1c1c22,
    wall: 0x2e2e38,
  },

  walls: [
    [60, 8, 0.5, 0, 4, -30],
    [60, 8, 0.5, 0, 4, 30],
    [0.5, 8, 60, -30, 4, 0],
    [0.5, 8, 60, 30, 4, 0],
  ],

  props: [
    // TOWER 1: Top-left — tall structure with platform
    { type: "wall", w: 6, h: 7, d: 6, x: -20, y: 3.5, z: -20 },
    { type: "wall", w: 5, h: 0.4, d: 5, x: -20, y: 6.5, z: -20 }, // platform on top

    // TOWER 2: Top-right
    { type: "wall", w: 6, h: 7, d: 6, x: 20, y: 3.5, z: -20 },
    { type: "wall", w: 5, h: 0.4, d: 5, x: 20, y: 6.5, z: -20 },

    // TOWER 3: Bottom-left
    { type: "wall", w: 6, h: 7, d: 6, x: -20, y: 3.5, z: 20 },
    { type: "wall", w: 5, h: 0.4, d: 5, x: -20, y: 6.5, z: 20 },

    // TOWER 4: Bottom-right
    { type: "wall", w: 6, h: 7, d: 6, x: 20, y: 3.5, z: 20 },
    { type: "wall", w: 5, h: 0.4, d: 5, x: 20, y: 6.5, z: 20 },

    // Central rising platforms (mid-map high ground)
    { type: "wall", w: 8, h: 0.4, d: 8, x: 0, y: 2, z: 0 },        // low platform
    { type: "wall", w: 6, h: 0.4, d: 6, x: 0, y: 3.5, z: 0 },      // mid platform
    { type: "wall", w: 4, h: 0.4, d: 4, x: 0, y: 5, z: 0 },        // high platform

    // Connecting walkways between towers
    { type: "wall", w: 35, h: 0.4, d: 1.2, x: 0, y: 2.5, z: 0 },   // horizontal bridge
    { type: "wall", w: 1.2, h: 0.4, d: 35, x: 0, y: 2.5, z: 0 },   // vertical bridge

    // Side walls for mid-map cover
    { type: "wall", w: 0.5, h: 4, d: 20, x: -15, y: 2, z: 0 },
    { type: "wall", w: 0.5, h: 4, d: 20, x: 15, y: 2, z: 0 },
  ],

  spawns: [
    { x: -20, y: 1.4, z: -20, yaw: Math.PI / 4 },
    { x: 20, y: 1.4, z: -20, yaw: -Math.PI / 4 },
    { x: -20, y: 1.4, z: 20, yaw: 3 * Math.PI / 4 },
    { x: 20, y: 1.4, z: 20, yaw: -3 * Math.PI / 4 },
  ],
};
