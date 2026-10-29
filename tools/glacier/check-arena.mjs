// Geometry check for an arena: spawns clear, everything reachable, nothing floating or trapped.
// Run:  node tools/glacier/check-arena.mjs glacier     (works for any arena id)
const id = process.argv[2] || "glacier";
const root = new URL("../../js/arenas/", import.meta.url).href;
const arena = (await import(root + id + ".js")).default;
const R = 0.5, STEP = 0.5, JUMP_UP = 2.5, RES = 0.5;
const boxes = [];
for (const [w, h, d, x, y, z] of arena.walls) boxes.push({ type: "wall", minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y + h / 2 });
for (const p of arena.props) boxes.push({ type: p.type, minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2, top: p.y + p.h / 2 });
const half = arena.floorSize / 2;
console.log(`${arena.name}: floor ${arena.floorSize}x${arena.floorSize} (${(arena.floorSize ** 2 / 48 ** 2).toFixed(2)}x Foundry's area), ${boxes.length} solid blocks, ${arena.spawns.length} spawns`);

// extents
for (const b of boxes) if (b.type !== "wall" && (b.minX < -half || b.maxX > half || b.minZ < -half || b.maxZ > half)) console.log("  OUT OF BOUNDS:", b);
// exact duplicates / overlapping same-height blocks (z-fighting)
const key = (b) => [b.minX, b.maxX, b.minZ, b.maxZ, b.top].map((v) => v.toFixed(3)).join(",");
const seen = new Map();
for (const b of boxes) { const k = key(b); if (seen.has(k)) console.log("  DUPLICATE block", b.type, k); seen.set(k, b); }

const N = Math.round(arena.floorSize / RES);
const cx = (i) => -half + (i + 0.5) * RES;
const surface = (x, z) => { let t = 0; for (const b of boxes) if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.top > t) t = b.top; return t; };
// a cell is blocked for a body standing at feet level `f` if a taller-than-a-step block is within radius
const blockedAt = (x, z, f) => { for (const b of boxes) { if (b.top <= f + STEP) continue; const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ); if (dx * dx + dz * dz < (R - 0.02) ** 2) return true; } return false; };

const H = new Float32Array(N * N), open = new Uint8Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = cx(i), z = cx(j); H[j * N + i] = surface(x, z); open[j * N + i] = blockedAt(x, z, H[j * N + i]) ? 0 : 1; }

// spawns
const cellOf = (x, z) => [Math.floor((x + half) / RES), Math.floor((z + half) / RES)];
for (const s of arena.spawns) {
  const [i, j] = cellOf(s.x, s.z);
  const clear = open[j * N + i] && !boxes.some((b) => { const dx = Math.max(b.minX - s.x, 0, s.x - b.maxX), dz = Math.max(b.minZ - s.z, 0, s.z - b.maxZ); return dx * dx + dz * dz < 0.75 ** 2; });
  if (!clear || Math.abs(s.y - (H[j * N + i] + 1.4)) > 0.01) console.log("  BAD SPAWN", s);
}

// flood fill from spawn 0
const seenCell = new Uint8Array(N * N);
const [si, sj] = cellOf(arena.spawns[0].x, arena.spawns[0].z);
const queue = [[si, sj]]; seenCell[sj * N + si] = 1;
while (queue.length) {
  const [i, j] = queue.pop(); const h = H[j * N + i];
  for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) {
    if (!di && !dj) continue;
    const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue;
    const k = b * N + a; if (seenCell[k] || !open[k]) continue;
    const up = H[k] - h;
    const far = Math.max(Math.abs(di), Math.abs(dj)) > 1;
    // walking: neighbouring cells, climbing at most a step. Jumping up (to JUMP_UP) or dropping down: up to 1.5m away.
    if (!far && up > JUMP_UP) continue;
    if (far && Math.abs(up) <= STEP) continue;       // no long walks through gaps: only jumps and drops
    if (far && up > JUMP_UP) continue;
    if (!far && di && dj && (!open[j * N + a] || !open[b * N + i]) && Math.abs(up) <= STEP) continue; // no cutting corners
    seenCell[k] = 1; queue.push([a, b]);
  }
}
let openCells = 0, reached = 0; for (let k = 0; k < N * N; k++) { if (open[k]) openCells++; if (seenCell[k]) reached++; }
console.log(`  walkable cells reachable from spawn 0: ${reached} of ${openCells} (${(100 * reached / openCells).toFixed(1)}%)`);
for (const s of arena.spawns) { const [i, j] = cellOf(s.x, s.z); if (!seenCell[j * N + i]) console.log("  SPAWN CANNOT BE REACHED FROM SPAWN 0:", s); }

// unreachable pockets of open ground / platforms (group by block)
const lost = new Map();
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i; if (open[k] && !seenCell[k]) { const key = `top ${H[k].toFixed(2)}`; lost.set(key, (lost.get(key) || 0) + 1); } }
for (const [k, n] of [...lost].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  unreachable area at ${k}: ${(n * RES * RES).toFixed(1)} m²`);
// which block tops can be stood on?
const tops = new Map();
for (const b of boxes) if (b.type !== "wall" && b.top >= 0.5) { let got = 0, total = 0; for (let j = Math.max(0, Math.floor((b.minZ + half) / RES)); j <= Math.min(N - 1, Math.floor((b.maxZ + half) / RES)); j++) for (let i = Math.max(0, Math.floor((b.minX + half) / RES)); i <= Math.min(N - 1, Math.floor((b.maxX + half) / RES)); i++) { const k = j * N + i; if (Math.abs(H[k] - b.top) < 1e-6 && open[k]) { total++; if (seenCell[k]) got++; } } tops.set(`${b.type} top ${b.top}`, [(tops.get(`${b.type} top ${b.top}`)?.[0] || 0) + got, (tops.get(`${b.type} top ${b.top}`)?.[1] || 0) + total]); }
console.log("  can you stand on top of each kind of block? (reachable cells / standable cells)");
for (const [k, [g, t]] of [...tops].sort()) console.log(`    ${k.padEnd(28)} ${g}/${t}`);

// where are the unreachable pockets?
const comp = new Int32Array(N * N); let nc = 0; const comps = [];
for (let j0 = 0; j0 < N; j0++) for (let i0 = 0; i0 < N; i0++) {
  const k0 = j0 * N + i0; if (!open[k0] || seenCell[k0] || comp[k0]) continue;
  nc++; const st = [[i0, j0]]; comp[k0] = nc; let n = 0, sx = 0, sz = 0, minI = 1e9, maxI = -1, minJ = 1e9, maxJ = -1, top = H[k0];
  while (st.length) { const [i, j] = st.pop(); n++; sx += i; sz += j; minI = Math.min(minI, i); maxI = Math.max(maxI, i); minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
    for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue; const k = b * N + a; if (!open[k] || seenCell[k] || comp[k] || Math.abs(H[k] - top) > 1e-6) continue; comp[k] = nc; st.push([a, b]); } }
  comps.push({ area: n * RES * RES, top, x: [cx(minI).toFixed(1), cx(maxI).toFixed(1)], z: [cx(minJ).toFixed(1), cx(maxJ).toFixed(1)] });
}
console.log("  largest unreachable pockets (flat areas you can't walk or jump to):");
for (const c of comps.sort((a, b) => b.area - a.area).slice(0, 10)) console.log(`    ${c.area.toFixed(1).padStart(6)} m2 at height ${c.top.toFixed(2)}, x ${c.x[0]}..${c.x[1]}, z ${c.z[0]}..${c.z[1]}`);
