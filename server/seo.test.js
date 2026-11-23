// The search-engine basics: nothing here should quietly rot. Run with:  cd server && npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ARENA_LIST } from "../js/arenas.js";

const root = new URL("../", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), "utf8");
const html = read("index.html");
const meta = (attr, name) => (html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`)) ?? [])[1];
const link = (rel) => (html.match(new RegExp(`<link rel="${rel}" href="([^"]*)"`)) ?? [])[1];

test("the title and description are a good length", () => {
  const title = html.match(/<title>([^<]*)<\/title>/)[1];
  assert.ok(title.length >= 20 && title.length <= 65, `title is ${title.length} characters`);
  assert.match(title, /Arena Duels/);
  const d = meta("name", "description");
  assert.ok(d.length >= 70 && d.length <= 165, `description is ${d.length} characters`);
});

test("there is a full address for the page, and the page can be indexed", () => {
  assert.equal(link("canonical"), "https://arenaduels.github.io/");
  assert.match(meta("name", "robots"), /index/);
  assert.doesNotMatch(meta("name", "robots"), /noindex/);
});

test("shared links get a large picture that exists and is the size we say", () => {
  assert.equal(meta("name", "twitter:card"), "summary_large_image");
  const img = meta("property", "og:image");
  assert.equal(img, meta("name", "twitter:image"));
  assert.match(img, /^https:\/\/arenaduels\.github\.io\/og-image\.png$/);
  const png = fs.readFileSync(new URL("og-image.png", root));
  assert.equal(png.readUInt32BE(16), Number(meta("property", "og:image:width")));
  assert.equal(png.readUInt32BE(20), Number(meta("property", "og:image:height")));
  assert.ok(png.length < 400_000, "keep the picture small");
  assert.ok(meta("property", "og:image:alt").length > 10);
  assert.equal(meta("property", "og:url"), "https://arenaduels.github.io/");
});

test("the structured data is valid JSON and describes a free browser game", () => {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  const data = JSON.parse(raw);
  const game = data["@graph"].find((n) => n["@type"] === "VideoGame");
  assert.ok(game, "a VideoGame");
  assert.equal(game.name, "Arena Duels");
  assert.equal(game.isAccessibleForFree, true);
  assert.equal(game.offers.price, "0");
  assert.ok(data["@graph"].some((n) => n["@type"] === "WebSite"));
});

test("the page has exactly one h1, a main, and its name reads as two words", () => {
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.match(html, /<main class="home">/);
  assert.match(html, /<h1 class="logo">ARENA <span>DUELS<\/span><\/h1>/);
});

test("the About text names every arena, so the list can't go out of date", () => {
  const about = html.slice(html.indexOf("<!-- arenas:start -->"), html.indexOf("<!-- arenas:end -->"));
  for (const a of ARENA_LIST) {
    assert.ok(about.includes(`<strong>${a.name}</strong>`), `${a.name} is missing: run node tools/seo/build-about.mjs`);
  }
  assert.equal((about.match(/<li>/g) ?? []).length, ARENA_LIST.length);
});

test("robots.txt lets search engines read the game's pages and scripts, and points to the sitemap", () => {
  const robots = read("robots.txt");
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/arenaduels\.github\.io\/sitemap\.xml$/m);
  for (const path of ["/", "/js/", "/style.css", "/assets/", "/vendor/", "/index.html", "/og-image.png"]) {
    for (const line of robots.split("\n").filter((l) => /^Disallow:/.test(l))) {
      const blocked = line.replace("Disallow:", "").trim();
      assert.ok(!blocked || !path.startsWith(blocked) || blocked.length > path.length, `${path} must not be blocked by ${line}`);
    }
  }
});

test("the sitemap is well formed and lists the front page", () => {
  const xml = read("sitemap.xml");
  assert.match(xml, /<loc>https:\/\/arenaduels\.github\.io\/<\/loc>/);
  assert.match(xml, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.equal((xml.match(/<urlset/g) ?? []).length, 1);
  assert.equal((xml.match(/<url>/g) ?? []).length, (xml.match(/<\/url>/g) ?? []).length);
});

test("the 404 page is not indexed, and every local file the head names exists", () => {
  assert.match(read("404.html"), /<meta name="robots" content="noindex">/);
  for (const rel of ["icon", "apple-touch-icon", "stylesheet", "modulepreload"]) {
    for (const m of html.matchAll(new RegExp(`<link rel="${rel}"[^>]*href="(\\.?/?[^":]*)"`, "g"))) {
      if (/^https?:/.test(m[1])) continue;
      assert.ok(fs.existsSync(new URL(m[1].replace(/^\.\//, ""), root)), `${m[1]} is missing`);
    }
  }
});
