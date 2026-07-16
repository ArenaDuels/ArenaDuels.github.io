// Mansion — a sprawling 60x60 arena with multiple houses you can enter,
// creating complex cover and vertical gameplay with interior/exterior transitions.

export default {
  id: "mansion",
  name: "Mansion",
  thumb: "./assets/thumbs/mansion.png",
  floorSize: 60,
  wallHeight: 5,
  bgColor: 0x0d0a0f,

  textures: {
    floor: "./assets/textures/floor.png",
    wall: "./assets/textures/wall.png",
    house: "./assets/textures/wall.png",
  },
  fallbackColors: {
    floor: 0x1a1a1f,
    wall: 0x2a2a32,
    house: 0x3a3a45,
  },

  // Outer perimeter walls
  walls: [
    [60, 5, 0.6, 0, 2.5, -30],
    [60, 5, 0.6, 0, 2.5, 30],
    [0.6, 5, 60, -30, 2.5, 0],
    [0.6, 5, 60, 30, 2.5, 0],
  ],

  // Houses with interiors (w, h, d = outer box, interior is hollow)
  // Corner house 1 (top-left)
  props: [
    // House 1: outer walls with open doors/windows for interior access
    { type: "house", w: 10, h: 4, d: 10, x: -18, y: 2, z: -18 },
    { type: "house", w: 8, h: 0.3, d: 8, x: -18, y: 4, z: -18 }, // roof
    
    // House 2 interior dividers (creates maze-like interior)
    { type: "house", w: 0.4, h: 3.5, d: 4, x: -20, y: 2, z: -18 },
    { type: "house", w: 4, h: 3.5, d: 0.4, x: -18, y: 2, z: -20 },

    // House 2: top-right
    { type: "house", w: 10, h: 4, d: 10, x: 18, y: 2, z: -18 },
    { type: "house", w: 8, h: 0.3, d: 8, x: 18, y: 4, z: -18 },
    { type: "house", w: 0.4, h: 3.5, d: 4, x: 20, y: 2, z: -18 },
    { type: "house", w: 4, h: 3.5, d: 0.4, x: 18, y: 2, z: -20 },

    // House 3: bottom-left
    { type: "house", w: 10, h: 4, d: 10, x: -18, y: 2, z: 18 },
    { type: "house", w: 8, h: 0.3, d: 8, x: -18, y: 4, z: 18 },
    { type: "house", w: 0.4, h: 3.5, d: 4, x: -20, y: 2, z: 18 },
    { type: "house", w: 4, h: 3.5, d: 0.4, x: -18, y: 2, z: 20 },

    // House 4: bottom-right
    { type: "house", w: 10, h: 4, d: 10, x: 18, y: 2, z: 18 },
    { type: "house", w: 8, h: 0.3, d: 8, x: 18, y: 4, z: 18 },
    { type: "house", w: 0.4, h: 3.5, d: 4, x: 20, y: 2, z: 18 },
    { type: "house", w: 4, h: 3.5, d: 0.4, x: 18, y: 2, z: 20 },

    // Central garden pillars and walls
    { type: "house", w: 3, h: 4, d: 0.5, x: 0, y: 2, z: -12 },
    { type: "house", w: 3, h: 4, d: 0.5, x: 0, y: 2, z: 12 },
    { type: "house", w: 0.5, h: 4, d: 3, x: -12, y: 2, z: 0 },
    { type: "house", w: 0.5, h: 4, d: 3, x: 12, y: 2, z: 0 },
    
    // Center structure - small tower
    { type: "house", w: 4, h: 5, d: 4, x: 0, y: 2, z: 0 },
  ],

  spawns: [
    { x: -18, y: 1.4, z: -18, yaw: 0 },
    { x: 18, y: 1.4, z: -18, yaw: Math.PI },
    { x: -18, y: 1.4, z: 18, yaw: Math.PI / 2 },
    { x: 18, y: 1.4, z: 18, yaw: -Math.PI / 2 },
  ],
};
