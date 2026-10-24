// Building blocks shared by the newer arena definitions.
//
// Movement rules these maps are built around (see player.js):
//   - Everything is a solid block that rises from the floor (collision only
//     looks at a block's top height), so "platforms" are solid masses.
//   - You walk up onto anything at most 0.5 above your feet, so stairs use
//     0.48 risers.
//   - A block only stops you sideways when it is well above your feet, so
//     cover is built 2.0+ tall — shorter blocks just feel like ghosts.
//   - A jump clears about 2.0, so 2.0–2.4 high blocks are jump-up ledges.

// A solid block resting on the floor. `top` is its top height.
export function block(type, x, z, w, d, top) {
  return { type, w, d, h: top, x, y: top / 2, z };
}

// A flight of steps. (x, z) is the point where the *top* step meets the
// raised structure; `dir` is which way the stairs run away from it going
// down ("+x" | "-x" | "+z" | "-z"). Top height = rise * steps.
export function stairs(type, { x, z, dir, steps = 5, rise = 0.48, run = 1.2, width = 3 }) {
  const vx = dir === "+x" ? 1 : dir === "-x" ? -1 : 0;
  const vz = dir === "+z" ? 1 : dir === "-z" ? -1 : 0;
  const alongX = vx !== 0;
  const out = [];
  for (let n = 0; n < steps; n++) {
    const top = rise * (steps - n);
    const dist = run * (n + 0.5);
    out.push(block(type, x + vx * dist, z + vz * dist, alongX ? run : width, alongX ? width : run, top));
  }
  return out;
}

// Copies of a prop list mirrored across the X and/or Z axis (skipping
// duplicates for anything sitting on an axis) — keeps maps fair.
export function mirror(list, { x = false, z = false }) {
  const out = [...list];
  const copy = (p, mx, mz) => ({ ...p, x: mx ? -p.x : p.x, z: mz ? -p.z : p.z });
  for (const p of list) {
    if (x && p.x !== 0) out.push(copy(p, true, false));
    if (z && p.z !== 0) out.push(copy(p, false, true));
    if (x && z && p.x !== 0 && p.z !== 0) out.push(copy(p, true, true));
  }
  return out;
}
export const mirror4 = (list) => mirror(list, { x: true, z: true });
export const mirrorX = (list) => mirror(list, { x: true });
export const mirrorZ = (list) => mirror(list, { z: true });

// Four perimeter walls for a square floor.
export function perimeter(size, height, thickness = 0.6) {
  const h = size / 2;
  return [
    [size, height, thickness, 0, height / 2, -h],
    [size, height, thickness, 0, height / 2, h],
    [thickness, height, size, -h, height / 2, 0],
    [thickness, height, size, h, height / 2, 0],
  ];
}

// A spawn point that faces the middle of the map. `surface` is the height
// of whatever you spawn standing on (0 = floor).
export function spawnAt(x, z, surface = 0) {
  return { x, y: surface + 1.4, z, yaw: Math.atan2(x, z) };
}
