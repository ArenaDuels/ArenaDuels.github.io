// Mansion — sprawling estate with large open layout, minimal interior dividers,
// and clean sightlines for fair duels with good cover variety.

export default {
  id: "mansion",
  name: "Mansion",
  thumb: "./assets/thumbs/mansion.png",
  floorSize: 70,
  wallHeight: 5,
  bgColor: 0x0d0a0f,

  textures: {
    floor: "./assets/textures/floor.png",
    wall: "./assets/textures/wall.png",
  },
  fallbackColors: {
    floor: 0x1a1a1f,
    wall: 0x2a2a32,
  },

  // Outer perimeter walls
  walls: [
    [70, 5, 0.6, 0, 2.5, -35],
    [70, 5, 0.6, 0, 2.5, 35],
    [0.6, 5, 70, -35, 2.5, 0],
    [0.6, 5, 70, 35, 2.5, 0],
  ],

  // Open courtyard layout with architectural structures
  props: [
    // Corner pavilions (elegant cover structures)
    { type: "wall", w: 8, h: 4, d: 8, x: -25, y: 2, z: -25 },
    { type: "wall", w: 8, h: 4, d: 8, x: 25, y: 2, z: -25 },
    { type: "wall", w: 8, h: 4, d: 8, x: -25, y: 2, z: 25 },
    { type: "wall", w: 8, h: 4, d: 8, x: 25, y: 2, z: 25 },

    // Central garden walls (cross pattern for mid-map tactical cover)
    { type: "wall", w: 12, h: 3.5, d: 0.5, x: 0, y: 1.75, z: 0 },
    { type: "wall", w: 0.5, h: 3.5, d: 12, x: 0, y: 1.75, z: 0 },

    // Strategic wall segments around the map
    { type: "wall", w: 6, h: 3.5, d: 0.5, x: -15, y: 1.75, z: -15 },
    { type: "wall", w: 0.5, h: 3.5, d: 6, x: 15, y: 1.75, z: -15 },
    { type: "wall", w: 6, h: 3.5, d: 0.5, x: -15, y: 1.75, z: 15 },
    { type: "wall", w: 0.5, h: 3.5, d: 6, x: 15, y: 1.75, z: 15 },

    // Scattered small walls for varied gameplay
    { type: "wall", w: 4, h: 3.5, d: 0.5, x: 0, y: 1.75, z: -20 },
    { type: "wall", w: 4, h: 3.5, d: 0.5, x: 0, y: 1.75, z: 20 },
    { type: "wall", w: 0.5, h: 3.5, d: 4, x: -20, y: 1.75, z: 0 },
    { type: "wall", w: 0.5, h: 3.5, d: 4, x: 20, y: 1.75, z: 0 },
  ],

  spawns: [
    { x: -25, y: 1.4, z: -25, yaw: 0 },
    { x: 25, y: 1.4, z: -25, yaw: Math.PI },
    { x: -25, y: 1.4, z: 25, yaw: Math.PI / 2 },
    { x: 25, y: 1.4, z: 25, yaw: -Math.PI / 2 },
  ],
};
