// Classic Box — the original 20x20 arena, now with texture references.
// Texture files expected at the paths below (see project notes for what to source).

export default {
  id: "classic",
  name: "Classic Box",
  thumb: "./assets/thumbs/classic.png",
  floorSize: 20,
  wallHeight: 4,
  bgColor: 0x0a0a0d,

  textures: {
    floor: "./assets/textures/floor.png",
    wall: "./assets/textures/wall.png",
  },
  // Fallback flat colors used until/if the textures above fail to load.
  fallbackColors: {
    floor: 0x222222,
    wall: 0x333333,
  },

  walls: [
    // [w, h, d, x, y, z]
    [20, 4, 0.5, 0, 2, -10],
    [20, 4, 0.5, 0, 2, 10],
    [0.5, 4, 20, -10, 2, 0],
    [0.5, 4, 20, 10, 2, 0],
  ],

  spawns: [
    { x: -6, y: 1.4, z: 0, yaw: Math.PI / 2 },
    { x: 6, y: 1.4, z: 0, yaw: -Math.PI / 2 },
    { x: 0, y: 1.4, z: -6, yaw: Math.PI },
    { x: 0, y: 1.4, z: 6, yaw: 0 },
  ],
};
