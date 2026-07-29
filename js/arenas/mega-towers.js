// Mega Towers — two hollow "outpost" towers facing each other across an
// open field. Each has a solid ground floor with a doorway, a window band
// you can shoot through, an interior staircase leading up to a mezzanine
// platform (sitting right at window height, so the climb is worth it),
// and a parapet above. Built with a small generator function below rather
// than hand-listing every wall segment.

const SIZE = 10;      // tower footprint (square)
const HALF = SIZE / 2;
const WALL_T = 0.5;

const BOTTOM_H = 2.2;                 // solid ground-floor wall band
const WINDOW_H = 1.2;                 // gap you can shoot through
const TOP_Y0 = BOTTOM_H + WINDOW_H;   // where the upper solid band starts
const TOP_H = 2.6;                    // parapet above the window band
const TOWER_HEIGHT = TOP_Y0 + TOP_H;  // ~6.0 total

const MEZZ_Y = BOTTOM_H + WINDOW_H / 2; // platform sits mid-window-height

// Builds one tower's walls/stairs/platform, centered at (cx, cz).
// doorSide: 'north' | 'south' | 'east' | 'west' — which wall has the entry gap.
function buildTower(cx, cz, doorSide) {
  const props = [];

  function addWallRun(axis, fixedCoord, hasDoor) {
    const doorW = 2.6;
    const sideW = (SIZE - doorW) / 2;
    if (axis === "x") {
      if (hasDoor) {
        props.push({ type: "wall", w: sideW, h: BOTTOM_H, d: WALL_T, x: cx - SIZE / 2 + sideW / 2, y: BOTTOM_H / 2, z: fixedCoord });
        props.push({ type: "wall", w: sideW, h: BOTTOM_H, d: WALL_T, x: cx + SIZE / 2 - sideW / 2, y: BOTTOM_H / 2, z: fixedCoord });
      } else {
        props.push({ type: "wall", w: SIZE, h: BOTTOM_H, d: WALL_T, x: cx, y: BOTTOM_H / 2, z: fixedCoord });
      }
      props.push({ type: "wall", w: SIZE, h: TOP_H, d: WALL_T, x: cx, y: TOP_Y0 + TOP_H / 2, z: fixedCoord });
    } else {
      if (hasDoor) {
        props.push({ type: "wall", w: WALL_T, h: BOTTOM_H, d: sideW, x: fixedCoord, y: BOTTOM_H / 2, z: cz - SIZE / 2 + sideW / 2 });
        props.push({ type: "wall", w: WALL_T, h: BOTTOM_H, d: sideW, x: fixedCoord, y: BOTTOM_H / 2, z: cz + SIZE / 2 - sideW / 2 });
      } else {
        props.push({ type: "wall", w: WALL_T, h: BOTTOM_H, d: SIZE, x: fixedCoord, y: BOTTOM_H / 2, z: cz });
      }
      props.push({ type: "wall", w: WALL_T, h: TOP_H, d: SIZE, x: fixedCoord, y: TOP_Y0 + TOP_H / 2, z: cz });
    }
  }

  addWallRun("x", cz - HALF, doorSide === "north");
  addWallRun("x", cz + HALF, doorSide === "south");
  addWallRun("z", cx - HALF, doorSide === "west");
  addWallRun("z", cx + HALF, doorSide === "east");

  // Staircase along the interior west wall, climbing to the mezzanine.
  const STEP_COUNT = 10;
  const stairX = cx - HALF + 1.3;
  const runStart = cz - HALF + 1;
  const runLength = SIZE - 2;
  for (let i = 0; i < STEP_COUNT; i++) {
    const topY = (MEZZ_Y * (i + 1)) / STEP_COUNT;
    const stepZ = runStart + (runLength * (i + 0.5)) / STEP_COUNT;
    const boxH = 0.22;
    props.push({
      type: "wall", w: 1.8, h: boxH,
      d: runLength / STEP_COUNT + 0.05,
      x: stairX, y: topY - boxH / 2, z: stepZ,
    });
  }

  // Mezzanine platform — the eastern half of the footprint, leaving the
  // western half (the stairwell) open so you can walk up into it.
  props.push({
    type: "wall",
    w: SIZE / 2 - 0.4, h: 0.3, d: SIZE - 1,
    x: cx + SIZE / 4, y: MEZZ_Y - 0.15, z: cz,
  });

  return props;
}

const TOWER_A = { x: -16, z: 0 };
const TOWER_B = { x: 16, z: 0 };

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
  },
  fallbackColors: {
    floor: 0x1c1c22,
    wall: 0x2e2e38,
  },

  walls: [
    [50, 8, 0.5, 0, 4, -25],
    [50, 8, 0.5, 0, 4, 25],
    [0.5, 8, 50, -25, 4, 0],
    [0.5, 8, 50, 25, 4, 0],
  ],

  // Towers face each other — A's door faces east (toward B), B's faces west.
  props: [
    ...buildTower(TOWER_A.x, TOWER_A.z, "east"),
    ...buildTower(TOWER_B.x, TOWER_B.z, "west"),
  ],

  // Two spawns per tower: one on the mezzanine, one at ground level, so
  // a 4-player match splits evenly and each tower has both an interior
  // and elevated presence from the start.
  spawns: [
    { x: TOWER_A.x + SIZE / 4, y: MEZZ_Y + 1.4, z: TOWER_A.z, yaw: Math.PI / 2 },
    { x: TOWER_A.x, y: 1.4, z: TOWER_A.z - 2, yaw: Math.PI / 2 },
    { x: TOWER_B.x - SIZE / 4, y: MEZZ_Y + 1.4, z: TOWER_B.z, yaw: -Math.PI / 2 },
    { x: TOWER_B.x, y: 1.4, z: TOWER_B.z - 2, yaw: -Math.PI / 2 },
  ],
};
