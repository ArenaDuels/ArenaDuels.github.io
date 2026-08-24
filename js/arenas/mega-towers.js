// Mega Towers — two tall outposts facing each other. Each has three levels
// (ground, mezzanine, roof) connected by a dedicated stairwell that never
// overlaps the floor platforms, and windows placed at actual eye-level for
// whichever floor they serve — not just "a gap somewhere in the wall."

const SIZE = 12;
const HALF = SIZE / 2;
const WALL_T = 0.5;

// A standing player's eyes sit ~2.4 units above whatever floor they're on
// (1.4 resting offset + 1.0 camera height) — windows are centered on that,
// not on an arbitrary height, so they're actually usable from the floor
// they're attached to.
const EYE_OFFSET = 2.4;

const GROUND_LOW_H = 1.8;                                  // solid wall below the window
const GROUND_WINDOW_H = 1.2;                                // ground-floor window band
const GROUND_HIGH_H = 0.6;                                  // solid band supporting the mezzanine
const MEZZ_Y = GROUND_LOW_H + GROUND_WINDOW_H + GROUND_HIGH_H; // 3.6 — mezzanine floor height

const MEZZ_LOW_H = 1.8;
const MEZZ_WINDOW_H = 1.2;                                  // mezzanine window band
const MEZZ_HIGH_H = 0.8;                                    // parapet above it
const ROOF_Y = MEZZ_Y + MEZZ_LOW_H + MEZZ_WINDOW_H + MEZZ_HIGH_H; // 7.4 — roof height, noticeably tall

const STRIP_D = 4; // depth of the dedicated stairwell strip (always the north side of the footprint)

// Builds one tower centered at (cx, cz). doorSide is which outer wall has
// the entry gap ('east' | 'west' | 'north' | 'south'); the stairwell is
// always on the north side of the footprint regardless, so both towers
// share the same internal layout even with doors facing opposite ways.
function buildTower(cx, cz, doorSide) {
  const props = [];
  const doorW = 2.6;

  function wallBand(axis, fixedCoord, yStart, h, hasDoorGap) {
    const y = yStart + h / 2;
    if (axis === "x") {
      if (hasDoorGap) {
        const sideW = (SIZE - doorW) / 2;
        props.push({ type: "wall", w: sideW, h, d: WALL_T, x: cx - SIZE / 2 + sideW / 2, y, z: fixedCoord });
        props.push({ type: "wall", w: sideW, h, d: WALL_T, x: cx + SIZE / 2 - sideW / 2, y, z: fixedCoord });
      } else {
        props.push({ type: "wall", w: SIZE, h, d: WALL_T, x: cx, y, z: fixedCoord });
      }
    } else {
      if (hasDoorGap) {
        const sideW = (SIZE - doorW) / 2;
        props.push({ type: "wall", w: WALL_T, h, d: sideW, x: fixedCoord, y, z: cz - SIZE / 2 + sideW / 2 });
        props.push({ type: "wall", w: WALL_T, h, d: sideW, x: fixedCoord, y, z: cz + SIZE / 2 - sideW / 2 });
      } else {
        props.push({ type: "wall", w: WALL_T, h, d: SIZE, x: fixedCoord, y, z: cz });
      }
    }
  }

  function buildSide(axis, fixedCoord, hasDoor) {
    wallBand(axis, fixedCoord, 0, GROUND_LOW_H, hasDoor);
    wallBand(axis, fixedCoord, GROUND_LOW_H + GROUND_WINDOW_H, GROUND_HIGH_H, false);
    wallBand(axis, fixedCoord, MEZZ_Y, MEZZ_LOW_H, false);
    wallBand(axis, fixedCoord, MEZZ_Y + MEZZ_LOW_H + MEZZ_WINDOW_H, MEZZ_HIGH_H, false);
  }

  buildSide("x", cz - HALF, doorSide === "north");
  buildSide("x", cz + HALF, doorSide === "south");
  buildSide("z", cx - HALF, doorSide === "west");
  buildSide("z", cx + HALF, doorSide === "east");

  // Stairwell: always the north strip of the footprint, entirely separate
  // from the floor platforms below (south portion) — the two can never
  // visually or physically overlap since they occupy different Z ranges.
  const stairZ = cz - HALF + STRIP_D / 2;

  // Flight 1 (west half of the strip): ground -> mezzanine.
  const f1xStart = cx - HALF + 1;
  const f1xEnd = cx - 0.5;
  const F1_STEPS = 10;
  for (let i = 0; i < F1_STEPS; i++) {
    const topY = (MEZZ_Y * (i + 1)) / F1_STEPS;
    const x = f1xStart + ((f1xEnd - f1xStart) * (i + 0.5)) / F1_STEPS;
    const boxH = 0.22;
    props.push({
      type: "wall", w: (f1xEnd - f1xStart) / F1_STEPS + 0.05, h: boxH, d: STRIP_D - 0.6,
      x, y: topY - boxH / 2, z: stairZ,
    });
  }

  // Flight 2 (east half of the strip): mezzanine -> roof.
  const f2xStart = cx + 0.5;
  const f2xEnd = cx + HALF - 1;
  const F2_STEPS = 10;
  for (let i = 0; i < F2_STEPS; i++) {
    const topY = MEZZ_Y + ((ROOF_Y - MEZZ_Y) * (i + 1)) / F2_STEPS;
    const x = f2xStart + ((f2xEnd - f2xStart) * (i + 0.5)) / F2_STEPS;
    const boxH = 0.22;
    props.push({
      type: "wall", w: (f2xEnd - f2xStart) / F2_STEPS + 0.05, h: boxH, d: STRIP_D - 0.6,
      x, y: topY - boxH / 2, z: stairZ,
    });
  }

  // Mezzanine + roof platforms — the south portion of the footprint, well
  // clear of the stairwell strip. Same XZ footprint, stacked at two
  // different heights, so climbing the stairwell and stepping south onto
  // the floor works identically at both levels.
  const platZStart = cz - HALF + STRIP_D;
  const platZEnd = cz + HALF;
  const platDepth = platZEnd - platZStart - 0.3;
  const platCenterZ = (platZStart + platZEnd) / 2;
  const platWidth = SIZE - 0.6;

  props.push({ type: "wall", w: platWidth, h: 0.3, d: platDepth, x: cx, y: MEZZ_Y - 0.15, z: platCenterZ });
  props.push({ type: "wall", w: platWidth, h: 0.3, d: platDepth, x: cx, y: ROOF_Y - 0.15, z: platCenterZ });

  return props;
}

const TOWER_A = { x: -18, z: 0 };
const TOWER_B = { x: 18, z: 0 };

export default {
  id: "mega-towers",
  name: "Mega Towers",
  thumb: "./assets/thumbs/mega-towers.png",
  floorSize: 55,
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
    [55, 8, 0.5, 0, 4, -27.5],
    [55, 8, 0.5, 0, 4, 27.5],
    [0.5, 8, 55, -27.5, 4, 0],
    [0.5, 8, 55, 27.5, 4, 0],
  ],

  // Towers face each other — A's door faces east (toward B), B's faces west.
  props: [
    ...buildTower(TOWER_A.x, TOWER_A.z, "east"),
    ...buildTower(TOWER_B.x, TOWER_B.z, "west"),
  ],

  // One ground spawn and one roof spawn per tower — a 4-player match starts
  // split between both towers, at both the bottom and the very top.
  spawns: [
    { x: TOWER_A.x, y: 1.4, z: TOWER_A.z + 3, yaw: Math.PI / 2 },
    { x: TOWER_A.x, y: ROOF_Y + 1.4, z: TOWER_A.z + 3, yaw: Math.PI / 2 },
    { x: TOWER_B.x, y: 1.4, z: TOWER_B.z + 3, yaw: -Math.PI / 2 },
    { x: TOWER_B.x, y: ROOF_Y + 1.4, z: TOWER_B.z + 3, yaw: -Math.PI / 2 },
  ],
};
