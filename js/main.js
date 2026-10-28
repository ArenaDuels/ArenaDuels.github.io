import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { ARENA_LIST, getArena } from "./arenas.js";
import { PlayerController, RemotePlayer, makeLaserMesh, aimLaser, setLaserColor, GAME } from "./player.js";
import { Net } from "./net.js";
import { randomName } from "./names.js";
import { initializeAccountUi } from "./auth.js";
import { BotManager, BOT_SKILLS } from "./bots.js";
import { COLORS, PATTERNS, ACCESSORIES, loadLook, saveLook, sanitizeLook } from "./customization.js";
import { MatchState, DEFAULT_SETTINGS as DEFAULT_MATCH_RULES, sanitizeSettings } from "./match.js";
import { iconSvg } from "./icons.js";
import { createLookPreview } from "./look-preview.js";
import { cleanName, cleanRelay, isBotId, isValidArenaId, isValidId, SERVER_ID, SERVER_ONLY } from "./validate.js";

/* =========================================================
   SETTINGS — persisted to localStorage. Sensitivity uses the same
   numeric scale convention as Call of Duty (roughly 1-20, with ~6
   being a typical mouse default) rather than an arbitrary 0-1 slider.
========================================================= */
const SETTINGS_KEY = "capsules-settings";
const DEFAULT_SETTINGS = { sensitivity: 6, controllerEnabled: false, controllerSensitivity: 3.0, fov: 90, crosshairSize: 6 };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      sensitivity: typeof parsed.sensitivity === "number" ? parsed.sensitivity : DEFAULT_SETTINGS.sensitivity,
      controllerEnabled: typeof parsed.controllerEnabled === "boolean" ? parsed.controllerEnabled : DEFAULT_SETTINGS.controllerEnabled,
      controllerSensitivity: typeof parsed.controllerSensitivity === "number" ? parsed.controllerSensitivity : DEFAULT_SETTINGS.controllerSensitivity,
      fov: typeof parsed.fov === "number" ? parsed.fov : DEFAULT_SETTINGS.fov,
      crosshairSize: typeof parsed.crosshairSize === "number" ? parsed.crosshairSize : DEFAULT_SETTINGS.crosshairSize,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

let settings = loadSettings();

function sensitivityMultiplier() {
  return settings.sensitivity * 0.00035;
}

function applyFov() {
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();
}

function applyCrosshairSize() {
  document.documentElement.style.setProperty("--crosshair-size", `${settings.crosshairSize}px`);
}

const settingsModal = document.getElementById("settings-modal");
const customizationModal = document.getElementById("customization-modal");
const sensSlider = document.getElementById("sens-slider");
const sensValue = document.getElementById("sens-value");
const controllerMode = document.getElementById("controller-mode");
const controllerSensSlider = document.getElementById("controller-sens-slider");
const controllerSensValue = document.getElementById("controller-sens-value");
const controllerSensRow = document.getElementById("controller-sens-row");
const controllerStatus = document.getElementById("controller-status");
const fovSlider = document.getElementById("fov-slider");
const fovValue = document.getElementById("fov-value");
const crosshairSlider = document.getElementById("crosshair-slider");
const crosshairValue = document.getElementById("crosshair-value");

function refreshSettingsUI() {
  sensSlider.value = settings.sensitivity;
  sensValue.textContent = settings.sensitivity.toFixed(1);
  controllerMode.value = settings.controllerEnabled ? "controller" : "mouse";
  controllerSensSlider.value = settings.controllerSensitivity;
  controllerSensValue.textContent = settings.controllerSensitivity.toFixed(1);
  controllerSensRow.classList.toggle("hidden", !settings.controllerEnabled);
  sensSlider.closest(".setting-row").classList.toggle("hidden", settings.controllerEnabled);
  fovSlider.value = settings.fov;
  fovValue.textContent = settings.fov;
  crosshairSlider.value = settings.crosshairSize;
  crosshairValue.textContent = settings.crosshairSize;
}

let paused = false;
const pauseMenu = document.getElementById("pause-menu");

// Settings can be reached two ways: from the main menu (no match running,
// "Done" just closes it) or from the pause menu mid-match ("Done" returns
// to the pause menu rather than resuming outright, so the player still has
// to explicitly choose Resume or Leave).
function openSettingsFromMenu() {
  refreshSettingsUI();
  settingsModal.classList.remove("hidden");
}
function closeSettings() {
  settingsModal.classList.add("hidden");
  if (matchActive && paused) {
    pauseMenu.classList.remove("hidden");
  }
}

function openPauseMenu() {
  if (!matchActive || match.over) return;
  paused = true;
  document.exitPointerLock();
  for (const k in keys) keys[k] = false;
  firing = false;
  settingsModal.classList.add("hidden");
  pauseMenu.classList.remove("hidden");
}
function resumeMatch() {
  paused = false;
  pauseMenu.classList.add("hidden");
  settingsModal.classList.add("hidden");
  hideCustomization();
  lockPointer();
}
function leaveMatch() {
  matchActive = false;
  paused = false;
  pauseMenu.classList.add("hidden");
  settingsModal.classList.add("hidden");
  hideCustomization();
  document.exitPointerLock();
  net.destroy();
  botManager?.dispose();
  botManager = null;
  pendingHostStart = null;
  players.forEach((rp) => rp.dispose());
  players.clear();
  resetMatchUi();
  hideRoomCodeBanner();
  clearScorchMarks();
  showScreen("menu");
}

document.getElementById("btn-settings").addEventListener("click", openSettingsFromMenu);
document.getElementById("btn-rematch").addEventListener("click", restartMatchAsHost);
document.getElementById("btn-scoreboard-close").addEventListener("click", leaveMatch);
document.getElementById("btn-settings-close").addEventListener("click", closeSettings);
document.getElementById("btn-resume").addEventListener("click", resumeMatch);
document.getElementById("btn-pause-settings").addEventListener("click", () => {
  pauseMenu.classList.add("hidden");
  refreshSettingsUI();
  settingsModal.classList.remove("hidden");
});
document.getElementById("btn-leave-match").addEventListener("click", leaveMatch);

sensSlider.addEventListener("input", () => {
  settings.sensitivity = parseFloat(sensSlider.value);
  sensValue.textContent = settings.sensitivity.toFixed(1);
  saveSettings();
});
fovSlider.addEventListener("input", () => {
  settings.fov = parseInt(fovSlider.value, 10);
  fovValue.textContent = settings.fov;
  saveSettings();
  applyFov();
});
crosshairSlider.addEventListener("input", () => {
  settings.crosshairSize = parseInt(crosshairSlider.value, 10);
  crosshairValue.textContent = settings.crosshairSize;
  saveSettings();
  applyCrosshairSize();
});

controllerMode.addEventListener("change", () => {
  settings.controllerEnabled = controllerMode.value === "controller";
  refreshSettingsUI();
  saveSettings();
  if (settings.controllerEnabled) {
    document.exitPointerLock();
    controllerStatus.textContent = "Controller mode selected — connect a gamepad and move a stick.";
  } else {
    controllerStatus.textContent = "Mouse and keyboard mode selected.";
  }
});
controllerSensSlider.addEventListener("input", () => {
  settings.controllerSensitivity = parseFloat(controllerSensSlider.value);
  controllerSensValue.textContent = settings.controllerSensitivity.toFixed(1);
  saveSettings();
});

applyCrosshairSize(); // apply saved size immediately, even before a match

// Always lock onto <body> — that's the element the mouse-look handler checks
// for. (Resume/start used to lock the canvas instead, so mouse-look silently
// did nothing until the next click moved the lock.) Also asks for raw mouse
// input where the browser supports it, so OS mouse acceleration can't make
// turning uneven; falls back to a normal lock otherwise.
function lockPointer() {
  const el = document.body;
  const plain = () => {
    try { el.requestPointerLock()?.catch?.(() => {}); } catch {}
  };
  try {
    const p = el.requestPointerLock({ unadjustedMovement: true });
    if (p && typeof p.catch === "function") p.catch(plain);
  } catch {
    plain();
  }
}

/* =========================================================
   SCREEN ELEMENTS
========================================================= */
const screens = {
  menu: document.getElementById("screen-menu"),
  hostWait: document.getElementById("screen-host-wait"),
  joining: document.getElementById("screen-joining"),
  browse: document.getElementById("screen-browse"),
};
const hud = document.getElementById("hud");
const hudHpCorner = document.getElementById("hud-hp-corner");
const canvas = document.getElementById("game-canvas");
const crosshair = document.getElementById("crosshair");

function showScreen(name) {
  for (const key in screens) screens[key].classList.toggle("hidden", key !== name);
  canvas.classList.add("hidden");
  hud.classList.add("hidden");
  hudHpCorner.classList.add("hidden");
  crosshair.classList.add("hidden");
  killFeedEl.classList.add("hidden");
  stopLobbyPolling();
}
function showGame() {
  for (const key in screens) screens[key].classList.add("hidden");
  canvas.classList.remove("hidden");
  hud.classList.remove("hidden");
  hudHpCorner.classList.remove("hidden");
  crosshair.classList.remove("hidden");
  killFeedEl.classList.remove("hidden");
  stopLobbyPolling();
}

/* =========================================================
   PLAYER NAME
========================================================= */
const nameInput = document.getElementById("player-name-input");
nameInput.value = randomName(); // Guests can play immediately with a generated name.
initializeAccountUi(nameInput, randomName);

document.getElementById("btn-random-name").addEventListener("click", () => {
  if (nameInput.readOnly && !document.getElementById("btn-account-signout").classList.contains("hidden")) return;
  nameInput.value = randomName();
});

function getPlayerName() {
  return cleanName(nameInput.value, "") || randomName();
}

/* =========================================================
   ARENA PICKER (menu)
========================================================= */
const arenaGrid = document.getElementById("arena-grid");
let selectedArenaId = ARENA_LIST[0].id;

const arenaDetail = document.getElementById("arena-detail");

// The big preview above the card row — shows the highlighted arena.
function renderArenaDetail(arena) {
  arenaDetail.style.backgroundImage = `url('${arena.thumb}')`;
  const badge = document.createElement("span");
  badge.className = "feature-badge";
  badge.textContent = "Selected";
  const body = document.createElement("div");
  body.className = "feature-body";
  const name = document.createElement("h3");
  name.className = "feature-name";
  name.textContent = arena.name;
  const desc = document.createElement("p");
  desc.className = "feature-desc";
  desc.textContent = arena.description ?? arena.tagline ?? "";
  const tags = document.createElement("div");
  tags.className = "feature-tags";
  for (const t of arena.tags ?? []) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = t;
    tags.appendChild(chip);
  }
  body.append(name, desc, tags);
  arenaDetail.replaceChildren(badge, body);
}

for (const arena of ARENA_LIST) {
  const card = document.createElement("button");
  card.className = "arena-card";
  card.dataset.id = arena.id;
  card.innerHTML = `
    <div class="arena-thumb" style="background-image:url('${arena.thumb}')"></div>
    <div class="arena-name">${arena.name}</div>
  `;
  card.addEventListener("click", () => {
    selectedArenaId = arena.id;
    document.querySelectorAll(".arena-card").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    renderArenaDetail(arena);
  });
  arenaGrid.appendChild(card);
}
arenaGrid.firstElementChild.classList.add("selected");
renderArenaDetail(ARENA_LIST[0]);

/* =========================================================
   PUBLIC / PRIVATE TOGGLE
========================================================= */
let isPublicLobby = false;
document.querySelectorAll(".visibility-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".visibility-option").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    isPublicLobby = btn.dataset.public === "true";
  });
});

/* =========================================================
   COLOR / SPAWN ASSIGNMENT — deterministic from peer id.
========================================================= */
const PALETTE_NONHOST = [0xff4d6a, 0x39ff88, 0xffd166, 0x9b5de5, 0x4cc9f0, 0xff8c42];

function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
function colorForId(id) {
  if (id === hostId) return 0xffffff;
  return PALETTE_NONHOST[hashId(id) % PALETTE_NONHOST.length];
}
function spawnForId(id, arena) {
  return arena.spawns[hashId(id) % arena.spawns.length];
}

/* =========================================================
   NET
========================================================= */
const net = new Net();
let hostId = null;
let myId = null;
let myName = "";
let currentArena = null;

net.onData = (msg, fromId) => handleData(msg, fromId);

let matchStarting = false;
let pendingHostStart = null; // { code } while a private host is on the settings screen
let botManager = null;       // host only

net.onPeerConnected = async (id) => {
  // matchActive only flips true *after* the async arena build finishes —
  // if two peers connect close together, both could see matchActive still
  // false and both call beginMatch(), corrupting arenaObjects/wallBoxes
  // with an interleaved double-build (this was the missing-walls bug).
  // matchStarting closes that race by being set synchronously, before any
  // await, so the second caller sees it immediately.
  if (pendingHostStart) {
    // Host was still on the settings screen — start with whatever is set now.
    await startPendingHost();
  } else if (!matchActive && !matchStarting) {
    matchStarting = true;
    await beginMatch(selectedArenaId);
  }
  addOrUpdatePlayer(id, "Player");
  net.broadcast({ t: "hello", name: myName, look: myLook });
  if (net.isHost) net.broadcast({ t: "sync", forId: id, settings: match.settings, snap: match.snapshot() });
  hideRoomCodeBanner();
};

net.onPeerDisconnected = (id) => {
  if (id === null) {
    handleServerLost();
  } else {
    removePlayer(id);
  }
};

const MAX_REMOTE_PLAYERS = 16; // 4 humans + bots, with headroom — stops a flood of fake ids

// Everything that arrives from the network goes through here. cleanRelay()
// rebuilds the message from range-checked fields (or drops it), so the code
// below only ever sees well-formed data.
function handleData(rawMsg, fromId) {
  if (!isValidId(fromId)) return;
  const msg = cleanRelay(rawMsg);
  if (!msg) return;
  const fromHost = fromId === hostId;
  // The relay server is the authority on health, deaths and respawns; its messages come "from" SERVER_ID.
  const fromServer = fromId === SERVER_ID;
  if (SERVER_ONLY.has(msg.t) && !fromServer) return;
  if ((msg.t === "end" || msg.t === "restart" || msg.t === "sync" || msg.t === "clock" || msg.t === "bots") && !fromHost) return;
  if (!fromServer && !players.has(fromId) && players.size >= MAX_REMOTE_PLAYERS) return;

  if (msg.t === "hello") {
    // Older clients send no look — sanitizeLook turns that into the default.
    addOrUpdatePlayer(fromId, msg.name).setLook(sanitizeLook(msg.look), colorForId(fromId));
  } else if (msg.t === "state") {
    addOrUpdatePlayer(fromId).applyNetState(msg);
  } else if (msg.t === "hit") {
    // Players don't report hits any more: the server watches everyone's beam and decides.
    // The one thing it tells us about is a player's beam landing on one of OUR bots (host only).
    if (!fromServer) return;
    if (botManager && botManager.has(msg.targetId)) botManager.damage(msg.targetId, msg.attackerId, msg.damage);
  } else if (msg.t === "kill") {
    // The server announces every player's death; the host announces its bots' deaths.
    if (!fromServer && !(fromHost && isBotId(msg.victimId))) return;
    applyKill(msg.attackerId, msg.victimId);
    if (fromServer && msg.victimId === myId) beginLocalDeath(msg.attackerId);
  } else if (msg.t === "hp") {
    // Our health, as the server has it.
    if (local) local.hp = Math.min(msg.hp, GAME.maxHp);
  } else if (msg.t === "health") {
    // Someone else's health, the moment the server changes it. (Their own state messages can run
    // late — browsers slow the timers of a hidden or covered window to about one a second.)
    players.get(msg.playerId)?.setHealth(msg.hp);
  } else if (msg.t === "respawn") {
    // The server decided when and where we come back.
    if (local && !match.over) respawnLocal({ x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw }, msg.tp);
  } else if (msg.t === "correct") {
    // The server says that position wasn't possible: go back to where it has us.
    if (local) {
      local.tp = msg.tp;
      local.teleportTo(msg.x, msg.y, msg.z);
    }
  } else if (msg.t === "end") {
    if (fromId !== hostId || match.over) return;
    match.load(msg.snap);
    match.finish(msg.reason);
    showResults();
  } else if (msg.t === "restart") {
    if (fromId !== hostId) return;
    applyMatchSettings(sanitizeSettings(msg.settings));
    beginRound();
  } else if (msg.t === "sync") {
    // Host -> the player who just joined: rules, clock and the scores so far.
    if (fromId !== hostId || msg.forId !== myId) return;
    applyMatchSettings(sanitizeSettings(msg.settings));
    match.load(msg.snap);
    if (local && local.hp > 0) local.hp = GAME.maxHp;
    refreshHud(true);
    if (match.over) showResults();
  } else if (msg.t === "clock") {
    if (fromId === hostId && Number.isFinite(msg.remaining)) match.setRemaining(msg.remaining);
  } else if (msg.t === "bots") {
    // Host-simulated bots: show them like any other remote player.
    for (const b of msg.bots) {
      if (!players.has(b.id) && players.size >= MAX_REMOTE_PLAYERS) break;
      const rp = players.get(b.id) || addOrUpdatePlayer(b.id, b.name);
      rp.applyNetState(b);
    }
  }
}

function handleServerLost() {
  if (!matchActive) return;
  matchActive = false;
  document.exitPointerLock();
  alert("Lost connection to the server.");
  net.destroy();
  botManager?.dispose();
  botManager = null;
  pendingHostStart = null;
  resetMatchUi();
  showScreen("menu");
}

/* ---- HOST FLOW ---- */
async function attemptHost() {
  document.getElementById("btn-retry-host").classList.add("hidden");
  document.getElementById("btn-start-host").classList.add("hidden");
  document.getElementById("host-code-display").textContent = "------";
  document.getElementById("host-status").textContent = "Getting a code...";
  pendingHostStart = null;

  // Render's free tier can take 30-60s to wake up from sleep on the first
  // connection in a while — if it's taking more than a few seconds, let
  // the player know what's actually happening instead of leaving them
  // staring at a generic loading message.
  const wakeupTimer = setTimeout(() => {
    document.getElementById("host-status").textContent =
      "Server is waking up — this can take up to a minute on the first connection...";
  }, 3000);

  try {
    const code = await net.host(selectedArenaId, isPublicLobby);
    clearTimeout(wakeupTimer);
    hostId = net.hostId;
    myId = net.myId;
    myName = getPlayerName();

    if (isPublicLobby) {
      // Public lobbies drop straight into the arena — the room code follows
      // as an in-game banner until someone joins.
      matchStarting = true;
      match.scores.clear();
      applyMatchSettings(DEFAULT_MATCH_RULES);
      await beginMatch(selectedArenaId);
      showRoomCodeBanner(code);
    } else {
      // Private matches stop at the settings screen first (bots live there).
      pendingHostStart = { code };
      document.getElementById("host-code-display").textContent = code;
      document.getElementById("host-status").textContent =
        "Open Match Settings to add bots, then start. Friends can join with this code.";
      document.getElementById("btn-start-host").classList.remove("hidden");
    }
  } catch (err) {
    clearTimeout(wakeupTimer);
    document.getElementById("host-status").textContent = "Failed to host match.";
    document.getElementById("btn-retry-host").classList.remove("hidden");
  }
}

const roomCodeBanner = document.getElementById("room-code-banner");
function showRoomCodeBanner(code) {
  document.getElementById("room-code-value").textContent = code;
  roomCodeBanner.classList.remove("hidden");
}
function hideRoomCodeBanner() {
  roomCodeBanner.classList.add("hidden");
}

document.getElementById("btn-host").addEventListener("click", () => {
  showScreen("hostWait");
  attemptHost();
});
document.getElementById("btn-retry-host").addEventListener("click", () => {
  net.destroy();
  attemptHost();
});
document.getElementById("btn-cancel-host").addEventListener("click", () => {
  net.destroy();
  pendingHostStart = null;
  document.getElementById("btn-start-host").classList.add("hidden");
  showScreen("menu");
});

/* ---- PLAYER CUSTOMIZATION ---- */
let myLook = loadLook();
let lookPreview = null;
const colorPicker = document.getElementById("color-picker");
const patternPicker = document.getElementById("pattern-picker");
const accessoryPicker = document.getElementById("accessory-picker");
const colorKey = (c) => (c === null ? "auto" : String(c));

function buildLookPickers() {
  const tile = (cls, text, title, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  };

  for (const c of COLORS) {
    const b = tile("color-option", "", "", () => setMyLook({ color: c }));
    b.dataset.key = colorKey(c);
    b.style.background = "#" + c.toString(16).padStart(6, "0");
    colorPicker.appendChild(b);
  }
  const auto = tile("color-option auto-swatch", "", "Auto — the color you're given in a match", () => setMyLook({ color: null }));
  auto.dataset.key = "auto";
  colorPicker.appendChild(auto);

  for (const p of PATTERNS) {
    const b = tile("pattern-option", "", p.label, () => setMyLook({ pattern: p.id }));
    b.innerHTML = iconSvg(p.id); // static, trusted markup from icons.js
    b.dataset.key = p.id;
    patternPicker.appendChild(b);
  }
  for (const a of ACCESSORIES) {
    const b = tile("accessory-option", "", a.label, () => setMyLook({ accessory: a.id }));
    b.innerHTML = iconSvg(a.id);
    b.dataset.key = a.id;
    accessoryPicker.appendChild(b);
  }
  refreshLookPickers();
}

function refreshLookPickers() {
  const mark = (picker, key) =>
    picker.querySelectorAll("button").forEach((el) => el.classList.toggle("selected", el.dataset.key === key));
  mark(colorPicker, colorKey(myLook.color));
  mark(patternPicker, myLook.pattern);
  mark(accessoryPicker, myLook.accessory);
}

// The color you actually show up as: your pick, or the assigned one for Auto.
function myColor() {
  return myLook.color ?? colorForId(myId);
}

// Your own body is never visible to you, so locally this only recolors the
// gun and beam. Everyone else sees the full look (sent in "hello").
function applyLocalLook() {
  if (!local) return;
  local.setColor(myColor());
  if (laser) setLaserColor(laser, myColor());
}

function updateLookPreview() {
  lookPreview?.setLook(myLook, matchActive && myId ? colorForId(myId) : 0xffffff);
}

function setMyLook(patch) {
  myLook = { ...myLook, ...patch };
  saveLook(myLook);
  refreshLookPickers();
  updateLookPreview();
  applyLocalLook();
  if (matchActive) net.broadcast({ t: "hello", name: myName, look: myLook });
}

function openCustomization() {
  settingsModal.classList.add("hidden");
  customizationModal.classList.remove("hidden");
  if (!lookPreview) {
    try {
      lookPreview = createLookPreview(document.getElementById("look-preview"));
    } catch {
      document.getElementById("look-preview").classList.add("hidden"); // no WebGL — skip the preview
    }
  }
  updateLookPreview();
  lookPreview?.start();
}

// Hides the menu without returning to Settings (used when a match starts/ends).
function hideCustomization() {
  customizationModal.classList.add("hidden");
  lookPreview?.stop();
}

function closeCustomization() {
  hideCustomization();
  refreshSettingsUI();
  settingsModal.classList.remove("hidden");
}

buildLookPickers();
document.getElementById("btn-customization-open").addEventListener("click", openCustomization);
document.getElementById("btn-customization-close").addEventListener("click", closeCustomization);

/* ---- PRIVATE MATCH SETTINGS (bots) ---- */
const matchSettings = { botCount: 0, botSkill: 2, ...DEFAULT_MATCH_RULES };
const matchSettingsModal = document.getElementById("match-settings-modal");
const botCountSlider = document.getElementById("bot-count-slider");
const botCountValue = document.getElementById("bot-count-value");
const botSkillSlider = document.getElementById("bot-skill-slider");
const botSkillValue = document.getElementById("bot-skill-value");

botCountSlider.addEventListener("input", () => {
  matchSettings.botCount = parseInt(botCountSlider.value, 10);
  botCountValue.textContent = matchSettings.botCount === 0 ? "Off" : matchSettings.botCount;
});
botSkillSlider.addEventListener("input", () => {
  matchSettings.botSkill = parseInt(botSkillSlider.value, 10);
  botSkillValue.textContent = BOT_SKILLS[matchSettings.botSkill].label;
});

// Time/score limits, health, health steal and respawn delay (0 = "Off"/"Instant" where it makes sense).
const RULE_SLIDERS = [
  ["time-limit", "timeLimit", (v) => (v === 0 ? "Off" : v)],
  ["score-limit", "scoreLimit", (v) => (v === 0 ? "Off" : v)],
  ["starting-health", "startingHealth", (v) => v],
  ["health-steal", "healthSteal", (v) => v],
  ["respawn-delay", "respawnDelay", (v) => (v === 0 ? "Instant" : v)],
];
for (const [base, key, fmt] of RULE_SLIDERS) {
  const slider = document.getElementById(`${base}-slider`);
  const label = document.getElementById(`${base}-value`);
  slider.value = matchSettings[key];
  label.textContent = fmt(matchSettings[key]);
  slider.addEventListener("input", () => {
    matchSettings[key] = parseFloat(slider.value);
    label.textContent = fmt(matchSettings[key]);
  });
}

document.getElementById("btn-match-settings-open").addEventListener("click", () => {
  matchSettingsModal.classList.remove("hidden");
});
document.getElementById("btn-match-settings-close").addEventListener("click", () => {
  matchSettingsModal.classList.add("hidden");
  startPendingHost();
});
document.getElementById("btn-start-host").addEventListener("click", startPendingHost);

async function startPendingHost() {
  if (!pendingHostStart || matchStarting || matchActive) return;
  const { code } = pendingHostStart;
  pendingHostStart = null;
  matchSettingsModal.classList.add("hidden");
  document.getElementById("btn-start-host").classList.add("hidden");
  matchStarting = true;
  match.scores.clear();
  applyMatchSettings(matchSettings);
  await beginMatch(selectedArenaId);
  startBots();
  showRoomCodeBanner(code);
}

function startBots() {
  botManager?.dispose();
  botManager = null;
  if (!net.isHost || matchSettings.botCount <= 0) return;
  botManager = new BotManager({
    scene,
    players,
    getLocal: () => local,
    getMyId: () => myId,
    getArena: () => currentArena,
    getSolids: () => arenaObjects,
    getWallBoxes: () => wallBoxes,
    addPlayer: (id, name) => addOrUpdatePlayer(id, name),
    // A bot hit the host's own player — the server checks it and takes the health off.
    damageLocal: (attackerId, amount) => {
      if (!local || local.hp <= 0 || match.over) return; // already down, or the match is over
      net.broadcast({ t: "hit", targetId: myId, attackerId, damage: amount });
    },
    // A bot hit a remote human — same: the server checks it and takes the health off.
    sendHit: (targetId, attackerId, amount) =>
      net.broadcast({ t: "hit", targetId, attackerId, damage: amount }),
    // A bot died — tell everyone so the scoreboard and kill feed stay in step.
    onBotKilled: (attackerId, victimId) => announceKill(attackerId, victimId),
    getMaxHp: () => GAME.maxHp,
    getHealthSteal: () => match.settings.healthSteal,
    getRespawnDelay: () => match.settings.respawnDelay,
  });
  botManager.spawnBots(matchSettings.botCount, matchSettings.botSkill);
}

/* ---- JOIN FLOW (shared by manual code entry and the lobby browser) ---- */
async function doJoin(code, statusEl) {
  if (statusEl) statusEl.textContent = "Connecting...";

  const wakeupTimer = setTimeout(() => {
    if (statusEl) {
      statusEl.textContent = "Server is waking up — this can take up to a minute on the first connection...";
    }
  }, 3000);

  try {
    const result = await net.join(code);
    clearTimeout(wakeupTimer);
    hostId = result.hostId;
    myId = net.myId;
    myName = getPlayerName();

    match.scores.clear();
    applyMatchSettings(DEFAULT_MATCH_RULES); // replaced by the host's rules a moment later ("sync")
    if (!isValidArenaId(result.arenaId)) throw new Error("Bad arena");
    await beginMatch(result.arenaId);
    for (const id of result.peers) addOrUpdatePlayer(id, "Player");
    net.broadcast({ t: "hello", name: myName, look: myLook });
  } catch (err) {
    clearTimeout(wakeupTimer);
    if (statusEl) {
      statusEl.textContent = "Couldn't connect. Check the code and try again.";
    }
  }
}

document.getElementById("btn-join").addEventListener("click", () => {
  showScreen("joining");
  document.getElementById("join-status").textContent = "";
});
document.getElementById("btn-join-confirm").addEventListener("click", () => {
  const code = document.getElementById("join-code-input").value.trim();
  const statusEl = document.getElementById("join-status");
  if (code.length !== 6) {
    statusEl.textContent = "Enter the 6-digit code.";
    return;
  }
  doJoin(code, statusEl);
});
document.getElementById("btn-cancel-join").addEventListener("click", () => {
  net.destroy();
  showScreen("menu");
});

/* ---- BROWSE PUBLIC LOBBIES ---- */
const lobbyListEl = document.getElementById("lobby-list");
let lobbyPollTimer = null;

function stopLobbyPolling() {
  if (lobbyPollTimer) {
    clearInterval(lobbyPollTimer);
    lobbyPollTimer = null;
  }
}

async function refreshLobbyList() {
  try {
    const lobbies = await net.listLobbies();
    renderLobbyList(lobbies);
  } catch (err) {
    lobbyListEl.innerHTML = `<p class="status-text">Couldn't load lobbies</p>`;
  }
}

function renderLobbyList(lobbies) {
  if (lobbies.length === 0) {
    lobbyListEl.innerHTML = `<p class="status-text">No public lobbies right now — host one!</p>`;
    return;
  }
  lobbyListEl.innerHTML = "";
  for (const lobby of lobbies) {
    const arena = getArena(lobby.arenaId);
    const full = lobby.playerCount >= lobby.maxPlayers;
    const row = document.createElement("div");
    row.className = "lobby-row";
    row.innerHTML = `
      <div class="lobby-thumb" style="background-image:url('${arena.thumb}')"></div>
      <div class="lobby-info">
        <span class="lobby-arena-name">${arena.name}</span>
        <div class="lobby-player-row">
          <span class="lobby-dot ${full ? "full" : ""}"></span>
          <span class="lobby-player-count">${lobby.playerCount}/${lobby.maxPlayers} players</span>
        </div>
      </div>
      <button class="lobby-join-btn" ${full ? "disabled" : ""}>${full ? "Full" : "Join"}</button>
    `;
    if (!full) {
      row.querySelector(".lobby-join-btn").addEventListener("click", () => {
        stopLobbyPolling();
        doJoin(lobby.code, null);
      });
    }
    lobbyListEl.appendChild(row);
  }
}

document.getElementById("btn-browse").addEventListener("click", () => {
  showScreen("browse");
  lobbyListEl.innerHTML = `<p class="status-text">Loading...</p>`;
  refreshLobbyList();
  lobbyPollTimer = setInterval(refreshLobbyList, 3000);
});
document.getElementById("btn-cancel-browse").addEventListener("click", () => {
  net.destroy();
  showScreen("menu");
});

/* =========================================================
   THREE.JS SETUP (created once, reused across matches)
========================================================= */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0d);

const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.left = -20;
dirLight.shadow.camera.right = 20;
dirLight.shadow.camera.top = 20;
dirLight.shadow.camera.bottom = -20;
dirLight.shadow.camera.far = 40;
scene.add(dirLight);

const textureLoader = new THREE.TextureLoader();

function loadTextureSafe(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    textureLoader.load(
      url,
      (tex) => {
        // Mirrored (not plain) repeat — makes adjacent tile edges match
        // perfectly even if the source image isn't a truly seamless tile,
        // since a mirrored copy's edge pixels are identical to the
        // original's by construction. Fixes visible seams without needing
        // a different source texture.
        tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
}

function makeMaterial(tex, fallbackColor, repeat = [1, 1]) {
  if (tex) {
    tex.repeat.set(repeat[0], repeat[1]);
    return new THREE.MeshStandardMaterial({ map: tex });
  }
  return new THREE.MeshStandardMaterial({ color: fallbackColor });
}

/* =========================================================
   MATCH STATE
========================================================= */
let local;
let players = new Map();
let wallBoxes = [], floorMesh, arenaObjects = [];
let raycaster = new THREE.Raycaster();
let laser;

// ===== Scorch marks — instead of a stamp per hit, we track the beam's hit
// point over time and connect consecutive points into a continuous scorched
// streak (like dragging a hot wire across the surface) rather than a chain
// of separate dots. A round dot marks the start of each stroke, and thin
// stretched quads connect each subsequent point to the last one. All marks
// fade out and get cleaned up after 5 seconds. =====
function makeScorchDotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(8,6,6,0.95)");
  grad.addColorStop(0.45, "rgba(18,12,10,0.7)");
  grad.addColorStop(0.75, "rgba(40,18,10,0.3)");
  grad.addColorStop(1, "rgba(40,18,10,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
function makeScorchLineTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 32, 0); // fades across the thin width, solid along the length
  grad.addColorStop(0, "rgba(40,18,10,0)");
  grad.addColorStop(0.5, "rgba(12,9,8,0.85)");
  grad.addColorStop(1, "rgba(40,18,10,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 128);
  return new THREE.CanvasTexture(canvas);
}
const scorchDotTexture = makeScorchDotTexture();
const scorchLineTexture = makeScorchLineTexture();
let scorchMarks = []; // { mesh, mat, createdAt }
const SCORCH_LIFETIME_MS = 5000;

// Tracks the in-progress stroke so consecutive frames connect up rather
// than each spawning an independent mark.
let lastScorchPoint = null;
let lastScorchNormal = null;

function makeScorchMaterial(map) {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
}

// Shared geometry + a small set of pre-faded materials: marks used to
// allocate their own geometry and material every frame while sweeping the
// beam (hundreds alive at once, each its own draw call) which hitched the
// frame rate exactly while you were tracking something.
const SCORCH_FADE_STEPS = 8;
const MAX_SCORCH_MARKS = 300;
const SCORCH_MIN_SEGMENT = 0.25; // don't add a segment until the beam has moved this far
const scorchDotGeo = new THREE.CircleGeometry(1, 16);
const scorchLineGeo = new THREE.PlaneGeometry(1, 1);
const scorchDotMats = [];
const scorchLineMats = [];
for (let i = 0; i < SCORCH_FADE_STEPS; i++) {
  const opacity = 0.85 * (1 - (i + 0.5) / SCORCH_FADE_STEPS);
  const dm = makeScorchMaterial(scorchDotTexture);
  dm.opacity = opacity;
  scorchDotMats.push(dm);
  const lm = makeScorchMaterial(scorchLineTexture);
  lm.opacity = opacity;
  scorchLineMats.push(lm);
}

function addScorchMesh(mesh, mats) {
  scene.add(mesh);
  scorchMarks.push({ mesh, mats, createdAt: performance.now() });
  if (scorchMarks.length > MAX_SCORCH_MARKS) scene.remove(scorchMarks.shift().mesh);
}

function spawnScorchDot(point, worldNormal) {
  const size = 0.3 + Math.random() * 0.1;
  const mesh = new THREE.Mesh(scorchDotGeo, scorchDotMats[0]);
  mesh.scale.setScalar(size);
  mesh.position.copy(point).addScaledVector(worldNormal, 0.02);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
  mesh.rotation.z = Math.random() * Math.PI * 2;
  addScorchMesh(mesh, scorchDotMats);
}

function spawnScorchLine(pointA, pointB, worldNormal) {
  const dir = new THREE.Vector3().subVectors(pointB, pointA);
  const length = dir.length();
  if (length < 0.02) return; // aim barely moved — not worth a segment
  dir.normalize();

  // Build an orthonormal basis flush against the surface: right/dir/normal.
  const right = new THREE.Vector3().crossVectors(dir, worldNormal).normalize();
  const trueNormal = new THREE.Vector3().crossVectors(right, dir).normalize();

  const mesh = new THREE.Mesh(scorchLineGeo, scorchLineMats[0]);
  mesh.scale.set(0.28, length, 1);
  const mid = new THREE.Vector3().addVectors(pointA, pointB).multiplyScalar(0.5);
  mesh.position.copy(mid).addScaledVector(trueNormal, 0.02);
  const basis = new THREE.Matrix4().makeBasis(right, dir, trueNormal);
  mesh.quaternion.setFromRotationMatrix(basis);
  addScorchMesh(mesh, scorchLineMats);
}

// Call this whenever the beam lands on a solid surface this frame. Extends
// the current stroke if the new point is a plausible continuation of the
// last one (roughly the same flat surface, not too far away); otherwise
// starts a fresh stroke with a dot.
function updateScorchStroke(point, worldNormal) {
  const sameSurface =
    lastScorchPoint &&
    lastScorchNormal.dot(worldNormal) > 0.9 &&
    point.distanceTo(lastScorchPoint) < 2;

  if (sameSurface) {
    if (point.distanceTo(lastScorchPoint) < SCORCH_MIN_SEGMENT) return; // keep the stroke open, wait for more movement
    spawnScorchLine(lastScorchPoint, point, worldNormal);
  } else {
    spawnScorchDot(point, worldNormal);
  }
  lastScorchPoint = point.clone();
  lastScorchNormal = worldNormal.clone();
}
function endScorchStroke() {
  lastScorchPoint = null;
  lastScorchNormal = null;
}

function updateScorchMarks() {
  const now = performance.now();
  for (let i = scorchMarks.length - 1; i >= 0; i--) {
    const s = scorchMarks[i];
    const age = now - s.createdAt;
    if (age >= SCORCH_LIFETIME_MS) {
      scene.remove(s.mesh);
      scorchMarks.splice(i, 1);
    } else {
      const step = Math.min(SCORCH_FADE_STEPS - 1, Math.floor((age / SCORCH_LIFETIME_MS) * SCORCH_FADE_STEPS));
      s.mesh.material = s.mats[step];
    }
  }
}

function clearScorchMarks() {
  for (const s of scorchMarks) scene.remove(s.mesh);
  scorchMarks = [];
}
let matchActive = false;
let mySpawn;

// Puts lights/fog back to the original look — classic and mansion rely on
// it, and every newer map restyles from this baseline.
function resetEnvironment() {
  scene.fog = null;
  ambientLight.color.set(0xffffff);
  ambientLight.intensity = 0.4;
  dirLight.color.set(0xffffff);
  dirLight.intensity = 0.8;
  dirLight.position.set(5, 10, 5);
  const c = dirLight.shadow.camera;
  c.left = -20; c.right = 20; c.top = 20; c.bottom = -20; c.near = 0.5; c.far = 40;
  c.updateProjectionMatrix();
  if (dirLight.shadow.mapSize.x !== 1024) {
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.map?.dispose();
    dirLight.shadow.map = null;
  }
}

/* ---- "modern" arenas (arena.modern): textures tile by real-world size
   instead of stretching per face, plus per-map lighting/fog, bump maps and
   glowing surfaces. Classic and Mansion keep the original builder below. ---- */
const modernTextureCache = new Map();

function loadModernTexture(url, isColor) {
  if (!url) return Promise.resolve(null);
  const key = url + (isColor ? "#c" : "#d");
  if (modernTextureCache.has(key)) return modernTextureCache.get(key);
  const p = new Promise((resolve) => {
    textureLoader.load(
      url,
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
  modernTextureCache.set(key, p);
  return p;
}

// A box whose UVs follow its real size, so a texture's scale is the same on
// every face of every block (tileSize = world units per texture repeat).
function makeBoxGeometry(w, h, d, tileSize) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 vertices each)
  const faceSize = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * faceSize[f][0]) / tileSize, (uv.getY(k) * faceSize[f][1]) / tileSize);
    }
  }
  uv.needsUpdate = true;
  return g;
}

async function buildModernArena(arena) {
  const tileFor = (type) => arena.tile?.[type] ?? arena.tile?.default ?? 4;

  // lighting + fog
  const env = arena.environment ?? {};
  if (env.fog) scene.fog = new THREE.Fog(env.fog[0], env.fog[1], env.fog[2]);
  if (env.ambient) {
    ambientLight.color.set(env.ambient[0]);
    ambientLight.intensity = env.ambient[1];
  }
  if (env.sun) {
    dirLight.color.set(env.sun.color);
    dirLight.intensity = env.sun.intensity;
    dirLight.position.set(...env.sun.position);
  }
  // Fit the shadow box to the map (the default only covers a 40x40 area).
  const half = arena.floorSize / 2 + 2;
  const sc = dirLight.shadow.camera;
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 220;
  sc.updateProjectionMatrix();
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.map?.dispose();
  dirLight.shadow.map = null;

  // one material per surface type, shared by every block of that type
  const types = new Set([
    "floor", "wall",
    ...(arena.props ?? []).map((p) => p.type),
    ...(arena.floors ?? []).map((f) => f.type),
  ]);
  const materials = {};
  await Promise.all(
    [...types].map(async (type) => {
      const [albedo, bump] = await Promise.all([
        loadModernTexture(arena.textures?.[type], true),
        loadModernTexture(arena.bump?.[type], false),
      ]);
      const opts = arena.material?.[type] ?? {};
      const mat = new THREE.MeshStandardMaterial({
        map: albedo,
        color: albedo ? 0xffffff : arena.fallbackColors?.[type] ?? 0x444444,
        bumpMap: bump,
        bumpScale: arena.bumpScale ?? 1,
        roughness: opts.roughness ?? 0.85,
        metalness: opts.metalness ?? 0.1,
      });
      const glow = arena.glow?.[type];
      if (glow && albedo) {
        mat.emissive = new THREE.Color(0xffffff);
        mat.emissiveMap = albedo;
        mat.emissiveIntensity = glow;
      }
      materials[type] = mat;
    })
  );

  const addBox = (type, w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(makeBoxGeometry(w, h, d, tileFor(type)), materials[type]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    arenaObjects.push(mesh);
    wallBoxes.push(new THREE.Box3().setFromObject(mesh));
  };

  const floorGeo = new THREE.PlaneGeometry(arena.floorSize, arena.floorSize);
  const floorUv = floorGeo.attributes.uv;
  const floorTiles = arena.floorSize / tileFor("floor");
  for (let i = 0; i < floorUv.count; i++) floorUv.setXY(i, floorUv.getX(i) * floorTiles, floorUv.getY(i) * floorTiles);
  floorMesh = new THREE.Mesh(floorGeo, materials.floor);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);
  arenaObjects.push(floorMesh);

  // Flat surface patches laid over the base floor (marble inside a house,
  // lawns, carpet runners...). Purely visual — they have no collision.
  for (const f of arena.floors ?? []) {
    const tile = tileFor(f.type);
    const geo = new THREE.PlaneGeometry(f.w, f.d);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * f.w) / tile, (uv.getY(i) * f.d) / tile);
    const mat = materials[f.type];
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
    const patch = new THREE.Mesh(geo, mat);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(f.x, f.y ?? 0.02, f.z);
    patch.receiveShadow = true;
    scene.add(patch);
    arenaObjects.push(patch);
  }

  for (const [w, h, d, x, y, z] of arena.walls) addBox("wall", w, h, d, x, y, z);
  for (const p of arena.props ?? []) addBox(p.type, p.w, p.h, p.d, p.x, p.y, p.z);
}

async function buildArena(arena) {
  for (const obj of arenaObjects) {
    scene.remove(obj);
    obj.geometry?.dispose(); // modern arenas build per-block geometry
  }
  arenaObjects = [];
  wallBoxes = [];

  resetEnvironment();
  scene.background = new THREE.Color(arena.bgColor ?? 0x0a0a0d);
  if (arena.modern) return buildModernArena(arena);

  const [floorTex, wallTex] = await Promise.all([
    loadTextureSafe(arena.textures?.floor),
    loadTextureSafe(arena.textures?.wall),
  ]);

  // Scale tile repeat to the arena's actual floor size (~5 units per tile)
  // rather than a fixed repeat count — otherwise a bigger arena stretches
  // the same texture across fewer, larger tiles than a smaller one, making
  // tiling density inconsistent between arenas.
  const TILE_UNIT = 10;
  const floorRepeat = Math.max(1, Math.round(arena.floorSize / TILE_UNIT));
  const floorMat = makeMaterial(floorTex, arena.fallbackColors?.floor ?? 0x222222, [floorRepeat, floorRepeat]);
  const wallMat = makeMaterial(wallTex, arena.fallbackColors?.wall ?? 0x333333, [2, 1]);

  floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(arena.floorSize, arena.floorSize), floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);
  arenaObjects.push(floorMesh);

  for (const [w, h, d, x, y, z] of arena.walls) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    arenaObjects.push(mesh);
    wallBoxes.push(new THREE.Box3().setFromObject(mesh));
  }

  if (arena.props) {
    const propTexCache = {};
    for (const prop of arena.props) {
      if (!(prop.type in propTexCache)) {
        propTexCache[prop.type] = await loadTextureSafe(arena.textures?.[prop.type]);
      }
      const mat = makeMaterial(
        propTexCache[prop.type],
        arena.fallbackColors?.[prop.type] ?? 0x444444,
        [1, 1]
      );
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(prop.w, prop.h, prop.d), mat);
      mesh.position.set(prop.x, prop.y, prop.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      arenaObjects.push(mesh);
      wallBoxes.push(new THREE.Box3().setFromObject(mesh));
    }
  }
}

async function beginMatch(arenaId) {
  currentArena = getArena(arenaId);
  await buildArena(currentArena);

  mySpawn = spawnForId(myId, currentArena);

  if (local) {
    scene.remove(local.mesh, local.viewRoot);
    camera.remove(local.gunGroup); // otherwise every new match stacks another gun on the camera
  }
  local = new PlayerController(scene, camera, colorForId(myId));
  local.spawn(mySpawn);

  if (laser) scene.remove(laser);
  laser = makeLaserMesh(colorForId(myId));
  scene.add(laser);
  applyLocalLook();

  match.ensurePlayer(myId, myName);
  refreshHud(true);

  matchActive = true;
  matchStarting = false;
  showGame();
  lockPointer();
}

function addOrUpdatePlayer(id, name) {
  match.ensurePlayer(id, name);
  if (players.has(id)) {
    if (name) players.get(id).setName(name);
    return players.get(id);
  }
  const rp = new RemotePlayer(scene, colorForId(id), name || "Player");
  rp.spawn(spawnForId(id, currentArena));
  players.set(id, rp);
  return rp;
}

function removePlayer(id) {
  const rp = players.get(id);
  if (rp) {
    rp.dispose();
    players.delete(id);
  }
  match.removePlayer(id);
  hudKey = "";
}

/* =========================================================
   MATCH FLOW — rules, scoreboard, HUD, kill feed, respawns
========================================================= */
const match = new MatchState();
const NO_KEYS = {};

const hudTimerEl = document.getElementById("hud-timer");
const hudLimitEl = document.getElementById("hud-limit");
const hudPlayersEl = document.getElementById("hud-players");
const hudScoreEl = document.getElementById("hud-score");
const killFeedEl = document.getElementById("kill-feed");
const respawnOverlay = document.getElementById("respawn-overlay");
const respawnCountEl = document.getElementById("respawn-count");
const tabBoard = document.getElementById("tab-scoreboard");
const tabBoardContent = document.getElementById("tab-scoreboard-content");
const resultsOverlay = document.getElementById("scoreboard-overlay");

const cssColor = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0");
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // textContent only — names come from other players
  return e;
}

function playerColor(id) {
  if (id === myId) return myColor();
  return players.get(id)?.displayColor ?? colorForId(id);
}

// New settings take effect for everyone: rules, clock, and what "full health" means.
function applyMatchSettings(raw) {
  match.start(raw);
  GAME.maxHp = match.settings.startingHealth;
}

function resetMatchUi() {
  match.scores.clear();
  applyMatchSettings(DEFAULT_MATCH_RULES);
  deadUntil = 0;
  respawnOverlay.classList.add("hidden");
  tabBoard.classList.add("hidden");
  resultsOverlay.classList.add("hidden");
  killFeedEl.replaceChildren();
  hudKey = "";
}

/* ---- HUD: timer + every player's name and kill count ---- */
let hudKey = "";

function playerChip(e, leader) {
  const chip = el("div", "player-chip" + (e.id === myId ? " me" : "") + (leader ? " leader" : ""));
  chip.style.setProperty("--chip-color", cssColor(playerColor(e.id)));
  chip.append(el("span", "chip-dot"), el("span", "chip-name", e.name), el("span", "chip-kills", String(e.kills)));
  return chip;
}

// Rows for the Tab board and the end-of-match results.
function renderBoard(container, ranking, winnerId = null) {
  const head = el("div", "scoreboard-head");
  head.append(el("span", "", "Player"), el("span", "", "Kills · Deaths"));
  const rows = ranking.map((e, i) => {
    const row = el(
      "div",
      "scoreboard-row" + (e.id === myId ? " me" : "") + (e.id === winnerId ? " scoreboard-winner" : "")
    );
    const stats = el("div", "scoreboard-stats");
    const k = el("span", "");
    k.append(el("b", "", String(e.kills)), document.createTextNode(" K"));
    const d = el("span", "");
    d.append(el("b", "", String(e.deaths)), document.createTextNode(" D"));
    stats.append(k, d);
    row.append(el("span", "scoreboard-rank", `#${i + 1}`), el("span", "scoreboard-player-name", e.name), stats);
    return row;
  });
  container.replaceChildren(head, ...rows);
}

function refreshHud(force = false) {
  const clock = match.clockText();
  if (hudTimerEl.textContent !== clock) hudTimerEl.textContent = clock;
  hudTimerEl.classList.toggle("low", Number.isFinite(match.remaining) && match.remaining <= 30 && !match.over);
  const limit = match.settings.scoreLimit;
  const limitText = limit > 0 ? `First to ${limit}` : "No score limit";
  if (hudLimitEl.textContent !== limitText) hudLimitEl.textContent = limitText;

  const ranking = match.ranking();
  const key = ranking.map((e) => `${e.id}:${e.name}:${e.kills}`).join("|") + "#" + myId;
  if (force || key !== hudKey) {
    hudKey = key;
    hudPlayersEl.replaceChildren(...ranking.slice(0, 8).map((e, i) => playerChip(e, i === 0 && e.kills > 0)));
    const me = match.scores.get(myId);
    hudScoreEl.textContent = me ? `${me.kills} kills · ${me.deaths} deaths` : "";
  }
  if (!tabBoard.classList.contains("hidden")) renderBoard(tabBoardContent, ranking);
}

function showTabBoard(show) {
  if (show && !matchActive) return;
  tabBoard.classList.toggle("hidden", !show);
  if (show) renderBoard(tabBoardContent, match.ranking());
}

/* ---- kill feed ---- */
function addKillFeed(attackerId, victimId) {
  const entry = el("div", "kill-feed-entry");
  entry.append(
    el("span", "kill-feed-killer", match.nameOf(attackerId)),
    el("span", "kill-arrow"),
    el("span", "kill-feed-eliminated", match.nameOf(victimId))
  );
  killFeedEl.append(entry);
  while (killFeedEl.children.length > 5) killFeedEl.firstElementChild.remove();
  setTimeout(() => {
    entry.classList.add("fade-out");
    setTimeout(() => entry.remove(), 500);
  }, 4500);
}

/* ---- kills ----
   The server announces every player's death (the host announces its bots');
   everyone applies it — so all scoreboards agree. Only the host decides
   when that adds up to the end of the match. */
function applyKill(attackerId, victimId) {
  if (!match.addKill(attackerId, victimId)) return;
  addKillFeed(attackerId, victimId);
  refreshHud(true);
  if (net.isHost) {
    const reason = match.checkEnd();
    if (reason) endMatchAsHost(reason);
  }
}
function announceKill(attackerId, victimId) {
  net.broadcast({ t: "kill", attackerId, victimId });
  applyKill(attackerId, victimId);
}

/* ---- end of match ---- */
function endMatchAsHost(reason) {
  if (match.over) return;
  match.finish(reason);
  net.broadcast({ t: "end", reason, snap: match.snapshot() });
  showResults();
}

function showResults() {
  document.exitPointerLock();
  for (const k in keys) keys[k] = false;
  firing = false;
  paused = false;
  pauseMenu.classList.add("hidden");
  settingsModal.classList.add("hidden");
  respawnOverlay.classList.add("hidden");
  tabBoard.classList.add("hidden");
  refreshHud(true);

  const winner = match.winner();
  document.getElementById("results-winner").textContent = winner
    ? winner.id === myId ? "You win!" : `${winner.name} wins!`
    : "It's a draw";
  document.getElementById("results-reason").textContent =
    match.reason === "score" ? "SCORE LIMIT REACHED" : match.reason === "time" ? "TIME'S UP" : "";
  renderBoard(document.getElementById("scoreboard-content"), match.ranking(), winner?.id ?? null);
  document.getElementById("btn-rematch").classList.toggle("hidden", !net.isHost);
  document.getElementById("results-wait").classList.toggle("hidden", net.isHost);
  resultsOverlay.classList.remove("hidden");
}

// A fresh round on the same map: everyone back to full health at a spawn.
function beginRound() {
  resultsOverlay.classList.add("hidden");
  killFeedEl.replaceChildren();
  clearScorchMarks();
  respawnLocal();
  botManager?.reset();
  refreshHud(true);
  lockPointer();
}
function restartMatchAsHost() {
  applyMatchSettings(match.settings);
  net.broadcast({ t: "restart", settings: match.settings });
  beginRound();
}

/* ---- respawning ---- */
let deadUntil = 0; // performance.now() ms when you come back; 0 = alive

// The spawn point farthest from everyone else (a little random so it isn't predictable).
function pickSpawn() {
  let best = mySpawn;
  let bestScore = -Infinity;
  for (const sp of currentArena.spawns) {
    let minD = Infinity;
    for (const rp of players.values()) {
      if (rp.visible && rp.hp > 0) minD = Math.min(minD, Math.hypot(rp.mesh.position.x - sp.x, rp.mesh.position.z - sp.z));
    }
    const score = (minD === Infinity ? 0 : minD) + Math.random() * 4;
    if (score > bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  return best;
}

// Back in the game at `spawnPoint`. After a death the server picks it (and numbers the move, `tp`);
// for a new round we pick our own.
function respawnLocal(spawnPoint = pickSpawn(), tp) {
  deadUntil = 0;
  respawnOverlay.classList.add("hidden");
  if (tp !== undefined) local.tp = tp;
  local.spawn(spawnPoint);
  net.broadcast({ t: "state", id: myId, ...local.getNetState() });
}

// The server said we died. It also decides when we come back (a "respawn" message), so all we do
// here is show the countdown.
function beginLocalDeath(attackerId) {
  if (match.over || !local) return;
  local.hp = 0;
  const delay = match.settings.respawnDelay;
  if (delay <= 0) return;
  deadUntil = performance.now() + delay * 1000;
  document.getElementById("respawn-by").textContent = attackerId === myId ? "" : `by ${match.nameOf(attackerId)}`;
  respawnCountEl.textContent = Math.ceil(delay);
  respawnOverlay.classList.remove("hidden");
}


/* =========================================================
   INPUT
========================================================= */
const keys = {};
let firing = false;

addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "Tab" && matchActive) {
    e.preventDefault(); // hold Tab for the live scoreboard instead of tabbing around the page
    showTabBoard(true);
  }
  if (e.code === "Escape" && matchActive && !match.over) {
    if (paused) resumeMatch();
    else openPauseMenu();
  }
});
addEventListener("keyup", (e) => {
  keys[e.code] = false;
  if (e.code === "Tab") showTabBoard(false);
});
addEventListener("blur", () => showTabBoard(false));
addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  firing = true;
});
addEventListener("mouseup", (e) => {
  if (e.button !== 0) return;
  firing = false;
});
canvas.addEventListener("click", () => {
  if (matchActive && !paused && document.pointerLockElement !== document.body) {
    lockPointer();
  }
});

// Do not clamp mouse deltas: Pointer Lock reports movement accumulated since
// the previous mouse event, and a hard per-event limit makes fast flicks feel
// capped. Only reject invalid values; sensitivity is the intended speed control.
function sanitizeDelta(v) {
  return Number.isFinite(v) ? v : 0;
}

addEventListener("mousemove", (e) => {
  if (!matchActive || paused || match.over || local.hp <= 0 || document.pointerLockElement !== document.body) return;
  const s = sensitivityMultiplier();
  local.yaw -= sanitizeDelta(e.movementX) * s;
  local.pitch -= sanitizeDelta(e.movementY) * s;
  local.pitch = Math.max(-1.4, Math.min(1.4, local.pitch));
});

/* =========================================================
   CONTROLLER SUPPORT — standard browser Gamepad API
========================================================= */
const controllerKeys = {};
let controllerFiring = false;
let controllerStartWasDown = false;
function deadzone(value, threshold = 0.16) {
  if (Math.abs(value) < threshold) return 0;
  return Math.sign(value) * (Math.abs(value) - threshold) / (1 - threshold);
}
function pollController(dt) {
  for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "Space"]) controllerKeys[code] = false;
  controllerFiring = false;
  if (!settings.controllerEnabled || !matchActive || paused || match.over) return;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = Array.from(pads).find(p => p && p.connected);
  if (!pad) {
    controllerStatus.textContent = "Controller mode selected — no controller detected. Connect one and press a button.";
    return;
  }
  controllerStatus.textContent = `Controller connected: ${pad.id}`;
  const lx = deadzone(pad.axes[0] || 0), ly = deadzone(pad.axes[1] || 0);
  controllerKeys.KeyW = ly < -0.12;
  controllerKeys.KeyS = ly > 0.12;
  controllerKeys.KeyA = lx < -0.12;
  controllerKeys.KeyD = lx > 0.12;
  controllerKeys.Space = !!(pad.buttons[0] && pad.buttons[0].pressed); // A / Cross
  controllerFiring = !!((pad.buttons[7] && pad.buttons[7].value > 0.25) || (pad.buttons[5] && pad.buttons[5].pressed)); // RT or RB
  const rx = deadzone(pad.axes[2] || 0), ry = deadzone(pad.axes[3] || 0);
  const lookSpeed = settings.controllerSensitivity * 2.2 * dt;
  if (local.hp > 0) {
    local.yaw -= rx * lookSpeed;
    local.pitch -= ry * lookSpeed; // stick up (negative) = look up, same as moving the mouse up
    local.pitch = Math.max(-1.4, Math.min(1.4, local.pitch));
  }
  const startDown = !!(pad.buttons[9] && pad.buttons[9].pressed);
  if (startDown && !controllerStartWasDown) openPauseMenu();
  controllerStartWasDown = startDown;
}

/* =========================================================
   MAIN LOOP
========================================================= */
let last = performance.now();
const hudHpValue = document.getElementById("hud-hp-value");
let lastHpText = "";

// Fixed timestep for physics — see the comment on PlayerController.updatePhysics
// in player.js for why. Rendering (and mouse-look) still happens every rAF frame.
const FIXED_DT = 1 / 60;
const MAX_PHYSICS_STEPS_PER_FRAME = 8; // avoid a "spiral of death" after a big stall
let physicsAccumulator = 0;

let clockBeat = 0;
setInterval(() => {
  if (matchActive && local) {
    net.broadcast({ t: "state", id: myId, ...local.getNetState() });
    if (botManager) net.broadcast({ t: "bots", bots: botManager.getStates() });
    // once a second the host tells everyone the true time left
    if (net.isHost && ++clockBeat % 20 === 0) {
      net.broadcast({ t: "clock", remaining: Number.isFinite(match.remaining) ? match.remaining : -1 });
    }
  }
}, 50); // 20Hz

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;

  // The match clock runs even while you're paused — the game goes on without you.
  if (matchActive) {
    match.tick(dt);
    if (net.isHost && !match.over) {
      const reason = match.checkEnd();
      if (reason) endMatchAsHost(reason);
    }
    refreshHud();
  }

  if (!matchActive || paused) {
    renderer.render(scene, camera);
    return;
  }

  if (match.over) {
    // Frozen after the final whistle; the arena keeps rendering behind the results.
    for (const rp of players.values()) rp.update(dt, camera);
    renderer.render(scene, camera);
    return;
  }

  const dead = local.hp <= 0;
  if (dead && deadUntil) {
    // Just the countdown: the server sends the "respawn" when it's time.
    respawnCountEl.textContent = Math.max(0, Math.ceil((deadUntil - now) / 1000));
  }

  pollController(dt);
  const activeKeys = dead ? NO_KEYS : settings.controllerEnabled ? controllerKeys : keys;
  const activeFiring = dead ? false : settings.controllerEnabled ? controllerFiring : firing;
  local.applyInput(activeKeys, activeFiring);
  local.updateGunFx(activeFiring, now / 1000);

  physicsAccumulator += dt;
  let steps = 0;
  while (physicsAccumulator >= FIXED_DT && steps < MAX_PHYSICS_STEPS_PER_FRAME) {
    local.updatePhysics(FIXED_DT, wallBoxes, activeKeys.Space);
    if (botManager) botManager.update(FIXED_DT);
    physicsAccumulator -= FIXED_DT;
    steps++;
  }

  // After a long stall we hit the step cap and still owe time. Drop that
  // backlog — otherwise alpha goes above 1 and the camera is thrown ahead of
  // the player, then snaps back.
  if (physicsAccumulator > FIXED_DT) physicsAccumulator = 0;
  const alpha = physicsAccumulator / FIXED_DT;

  local.updateLook();
  local.interpolateView(alpha);
  if (botManager) botManager.interpolate(alpha);

  for (const rp of players.values()) rp.update(dt, camera);

  const targets = [];
  const targetIds = [];
  for (const [id, rp] of players) {
    if (rp.visible) {
      targets.push(rp.mesh);
      targetIds.push(id);
    }
  }
  const solidObjects = arenaObjects; // includes the floor now, so floor shots register too

  if (activeFiring) {
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir).normalize();
    raycaster.set(origin, dir);

    const hits = raycaster.intersectObjects([...targets, ...solidObjects], false);
    const hit = hits[0];
    const end = hit ? hit.point : origin.clone().addScaledVector(dir, 50);

    // Visual beam starts from the gun's actual muzzle — a real object in
    // the scene, not an approximated offset — so it has genuine parallax
    // and you can actually see it, while hit detection above always uses
    // the true eye position/direction regardless.
    const muzzlePos = new THREE.Vector3();
    local.gunMuzzle.getWorldPosition(muzzlePos);
    aimLaser(laser, muzzlePos, end, !!hit, now / 1000);

    if (hit) {
      const idx = targets.indexOf(hit.object);
      if (idx !== -1) {
        // The beam is only drawn here. The server sees the same trigger and aim in our state
        // messages, works out who it hits, takes their health off (and heals us, with health
        // steal on), so there's nothing to report.
        endScorchStroke(); // hit a player, not environment — don't connect scorch marks across this
      } else if (hit.face) {
        const worldNormal = hit.face.normal
          .clone()
          .transformDirection(hit.object.matrixWorld)
          .normalize();
        updateScorchStroke(hit.point, worldNormal);
      }
    } else {
      endScorchStroke();
    }
  } else {
    laser.visible = false;
    endScorchStroke();
  }

  updateScorchMarks();

  const hpText = String(Math.ceil(local.hp));
  if (hpText !== lastHpText) {
    lastHpText = hpText;
    hudHpValue.textContent = hpText;
  }

  renderer.render(scene, camera);
}

showScreen("menu");
loop();
