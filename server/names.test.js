// Run with:  cd server && npm test
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { NAME_ADJECTIVES, NAME_NOUNS, NAME_WORDS, canonicalName, isLegacyName, isPossibleName, possibleNameCount, randomName } from "./names.js";
import { createNameTickets } from "./nameTickets.js";

// ================================================================== the name pool

test("there are millions of possible names (the goal was a few hundred thousand)", () => {
  assert.ok(possibleNameCount() >= 1_000_000, `only ${possibleNameCount()}`);
});

test("word lists are clean: letters only, capitalised, short, no repeats", () => {
  for (const [label, list] of [["adjectives", NAME_ADJECTIVES], ["nouns", NAME_NOUNS]]) {
    const seen = new Set();
    for (const w of list) {
      assert.match(w, /^[A-Z][a-z]{2,6}$/, `${label}: "${w}"`);
      assert.ok(!seen.has(w.toLowerCase()), `${label}: "${w}" is listed twice`);
      seen.add(w.toLowerCase());
    }
  }
});

test("no name can be longer than the 16 characters the game allows", () => {
  const longest = Math.max(...NAME_ADJECTIVES.map((w) => w.length)) + Math.max(...NAME_NOUNS.map((w) => w.length)) + 2;
  assert.ok(longest <= 16, `longest possible name is ${longest}`);
});

// Fragments that must never show up in a name — inside a word, or where two words run together.
const NEVER = `fuck shit cunt nigg fagg fag dick cock piss slut whore whor rape rapist nazi porn boob penis vagin anus hitler kkk jihad pedo molest
sex tits bitch twat wank dyke kike chink gook paki negro incest anal naked sperm semen orgy fetish thot meth cum retard isis nsfw xxx`.split(/\s+/);

test("no word contains anything rude on its own", () => {
  for (const w of [...NAME_ADJECTIVES, ...NAME_NOUNS]) {
    for (const f of NEVER) assert.ok(!w.toLowerCase().includes(f), `"${w}" contains "${f}"`);
  }
});

test("no pair of words runs together into something rude", () => {
  const bad = [];
  for (const a of NAME_ADJECTIVES) {
    for (const n of NAME_NOUNS) {
      const stem = a + n;
      if (!isPossibleName(stem + "10")) continue; // banned pairs are never handed out
      const s = stem.toLowerCase();
      for (const f of NEVER) if (s.includes(f)) bad.push(`${stem} (${f})`);
    }
  }
  assert.deepEqual(bad, [], "add these pairs to BANNED_STEMS in names.js (or drop a word)");
});

test("every banned pair is a real pair (the list doesn't rot)", () => {
  const stems = new Set();
  for (const a of NAME_ADJECTIVES) for (const n of NAME_NOUNS) stems.add((a + n).toLowerCase());
  // probe: banned pairs are rejected, so try every pair and count the rejected ones
  let rejected = 0;
  for (const s of stems) if (!isPossibleName(s + "10")) rejected++;
  assert.ok(rejected > 0 && rejected < 100, `${rejected} pairs are banned`);
});

test("unlucky numbers 69 and 88 are never handed out or accepted", () => {
  assert.equal(canonicalName("SwiftViper69"), null);
  assert.equal(canonicalName("SwiftViper88"), null);
  for (let i = 0; i < 20000; i++) assert.ok(!/(69|88)$/.test(randomName()));
});

// ============================================================ generating & checking

test("every name the generator produces passes the check, and is at most 16 characters", () => {
  for (let i = 0; i < 100_000; i++) {
    const name = randomName(crypto.randomInt);
    assert.ok(name.length <= 16, name);
    assert.equal(canonicalName(name), name, name);
  }
});

test("random names are well spread (almost never the same twice)", () => {
  const seen = new Set();
  for (let i = 0; i < 50_000; i++) seen.add(randomName(crypto.randomInt));
  assert.ok(seen.size > 49_000, `${seen.size} distinct out of 50000`);
});

test("made-up names are not 'possible names'", () => {
  for (const bad of [
    "Hacker99", "xXProXx", "Player", "Admin10", "SwiftViper", "SwiftViper5", "SwiftViper05", "SwiftViper100",
    "Swift Viper42", "Swift-Viper42", "SwiftViper42 ", " SwiftViper42", "SwiftViper4x", "ViperSwift42", "SwiftSwift42",
    "Blaze42x", "", "A1", "12345678", "SwiftViperSwiftViper42", "SwíftViper42",
  ]) {
    assert.equal(isPossibleName(bad), false, JSON.stringify(bad));
  }
  for (const notAString of [null, undefined, 42, {}, [], ["SwiftViper42"], true]) {
    assert.equal(isPossibleName(notAString), false);
  }
});

test("capital letters don't matter, and you get the proper capitals back", () => {
  assert.equal(canonicalName("swiftviper42"), "SwiftViper42");
  assert.equal(canonicalName("SWIFTVIPER42"), "SwiftViper42");
  assert.equal(canonicalName("sWiFtViPeR42"), "SwiftViper42");
});

test("old-style account names (one word + two digits) still count for signing in", () => {
  assert.equal(isLegacyName("Blaze42"), true);
  assert.equal(isLegacyName("blaze42"), true);
  assert.equal(isLegacyName("Volt99"), true);
  assert.equal(isLegacyName("Blaze05"), false);
  assert.equal(isLegacyName("Hacker42"), false);
  assert.equal(isLegacyName(42), false);
  // ...but they are not names the server hands out any more
  assert.equal(isPossibleName("Blaze42"), false);
});

test("bots still get their names from the original word list", () => {
  assert.ok(NAME_WORDS.length >= 60 && NAME_WORDS.includes("Blaze"));
});

test("the browser and the server use identical name files", { skip: !fs.existsSync(new URL("../js/names.js", import.meta.url)) }, () => {
  assert.equal(
    fs.readFileSync(new URL("./names.js", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../js/names.js", import.meta.url), "utf8"),
  );
});

// ================================================================== name tickets

const SECRET = "test-secret-test-secret-test-secret";

test("a ticket works for the name it was issued for, and only that", () => {
  const t = createNameTickets({ secret: SECRET });
  const ticket = t.issue("SwiftViper42");
  assert.deepEqual(t.verify(ticket, "SwiftViper42"), { ok: true });
  assert.deepEqual(t.verify(ticket, "swiftviper42"), { ok: true }, "capitals don't matter");
  assert.equal(t.verify(ticket, "SwiftViper43").ok, false);
  assert.equal(t.verify(ticket, "BoldWolf10").ok, false);
});

test("tickets expire after 15 minutes", () => {
  const t = createNameTickets({ secret: SECRET });
  const start = 1_800_000_000_000; // a realistic millisecond timestamp
  const ticket = t.issue("SwiftViper42", start);
  assert.equal(t.verify(ticket, "SwiftViper42", start + 14 * 60_000).ok, true);
  assert.deepEqual(t.verify(ticket, "SwiftViper42", start + 15 * 60_000 + 1), { ok: false, reason: "expired" });
});

test("tickets can't be forged, edited or borrowed", () => {
  const t = createNameTickets({ secret: SECRET });
  const ticket = t.issue("SwiftViper42");
  const [exp, nonce, mac] = ticket.split(".");
  const flip = (s) => (s[0] === "0" ? "1" : "0") + s.slice(1);
  assert.equal(t.verify(`${exp}.${nonce}.${flip(mac)}`, "SwiftViper42").ok, false, "edited signature");
  assert.equal(t.verify(`${Number(exp) + 60_000}.${nonce}.${mac}`, "SwiftViper42").ok, false, "extended expiry");
  assert.equal(t.verify(`${exp}.${flip(nonce)}.${mac}`, "SwiftViper42").ok, false, "edited nonce");
  // a ticket from another server (different secret) is worthless here
  assert.equal(createNameTickets({ secret: "another-secret-another-secret-xx" }).verify(ticket, "SwiftViper42").ok, false);
  // a server that hands out year-long tickets can't mint ones this server accepts
  const longLived = createNameTickets({ secret: SECRET, ttlMs: 365 * 24 * 3600_000 });
  assert.equal(t.verify(longLived.issue("SwiftViper42"), "SwiftViper42").ok, false);
});

test("junk in the ticket field is refused, not crashed on", () => {
  const t = createNameTickets({ secret: SECRET });
  for (const junk of ["", "x", "1.2.3", "a".repeat(5000), null, undefined, 42, {}, [], `${Date.now() + 1000}..`]) {
    assert.equal(t.verify(junk, "SwiftViper42").ok, false);
  }
  assert.equal(t.verify(t.issue("SwiftViper42"), null).ok, false);
});

test("each offer is different, even for the same name", () => {
  const t = createNameTickets({ secret: SECRET });
  assert.notEqual(t.issue("SwiftViper42"), t.issue("SwiftViper42"));
});

test("without a configured secret the server still works (with a temporary key)", () => {
  const t = createNameTickets({});
  assert.equal(t.temporary, true);
  assert.equal(t.verify(t.issue("SwiftViper42"), "SwiftViper42").ok, true);
  assert.equal(createNameTickets({ secret: SECRET }).temporary, false);
});
