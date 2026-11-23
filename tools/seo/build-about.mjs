// Fills the "Arenas" list in the About section of index.html from the arena files, so search
// engines can read every arena's name. Run it after adding or renaming an arena:
//   node tools/seo/build-about.mjs
import fs from "node:fs";
import { ARENA_LIST } from "../../js/arenas.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const lines = ARENA_LIST.map((a) => {
  const size = (a.tags ?? []).find((t) => /^\d+×\d+$/.test(t));
  return `            <li><strong>${esc(a.name)}</strong>: ${esc(a.tagline ?? "")}${size ? ` (${esc(size.replace("×", " by "))})` : ""}.</li>`;
}).join("\n");

const file = new URL("../../index.html", import.meta.url);
const html = fs.readFileSync(file, "utf8");
const start = "<!-- arenas:start -->";
const end = "<!-- arenas:end -->";
const a = html.indexOf(start), b = html.indexOf(end);
if (a < 0 || b < a) throw new Error("the arenas:start / arenas:end markers are missing from index.html");
fs.writeFileSync(file, `${html.slice(0, a + start.length)}\n${lines}\n${html.slice(b)}`);
console.log(`wrote ${ARENA_LIST.length} arenas into index.html`);
