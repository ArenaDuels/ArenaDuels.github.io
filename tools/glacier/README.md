# Glacier tools

How the Glacier map's art and layout were made, so you can change them.

- `texgen.py` — draws all 14 textures (a colour image plus a bump map each) as seamless tiles.
  `python3 tools/glacier/texgen.py assets/textures/glacier` (needs `numpy` and `Pillow`).
  Each texture is one function; change the colours or patterns there and re-run.
- `thumb.py` — draws the isometric picture for the map picker from the real arena file and the
  textures: `python3 tools/glacier/thumb.py`.
- `check-arena.mjs` — checks a layout: every spawn point clear and reachable, no walled-off
  pockets, which platforms can be climbed: `node tools/glacier/check-arena.mjs glacier`.
  Run it after moving walls or blocks in `js/arenas/glacier.js`.

After changing the arena file, copy it to `server/arenas/glacier.js` too (the server needs its own
copy to check walls) and run `cd server && npm test`.
