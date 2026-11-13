import * as THREE from "../vendor/three/three.module.min.js";
import { ARENA_LIST, getArena } from "./arenas.js";
import { PlayerController, RemotePlayer, makeLaserMesh, aimLaser, setLaserColor, GAME } from "./player.js";
import { Net } from "./net.js";
import { randomName } from "./names.js";
import { initializeAccountUi } from "./auth.js";
import { initStatsUi } from "./stats-ui.js";
import { BotManager, BOT_SKILLS } from "./bots.js";
import { COLORS, PATTERNS, ACCESSORIES, loadLook, saveLook, sanitizeLook } from "./customization.js";
import { MatchState, DEFAULT_SETTINGS as DEFAULT_MATCH_RULES, sanitizeSettings } from "./match.js";
import { iconSvg } from "./icons.js";
import { createLookPreview } from "./look-preview.js";
import { cleanName, cleanRelay, isBotId, isValidArenaId, isValidId, SERVER_ID, SERVER_ONLY } from "./validate.js";
import { GAME_MODES, FEATURED_LOBBY, getMode, isValidModeId } from "./modes.js";
import { radiansPerCount, clampSens, fromOldSensitivity, SENS_SCALE } from "./sensitivity.js";
import { TrainingSession, DRILLS, DRILL_IDS, LEVELS, LEVEL_IDS, DEFAULT_LEVEL, bestKey, loadBests, saveBest, nearConsole, buildTrainingConsole } from "./training.js";

/* =========================================================
   SETTINGS — persisted to localStorage. Sensitivity uses the same
   numeric scale convention as Call of Duty (roughly 1-20, with ~6
   being a typical mouse default) rather than an arbitrary 0-1 slider.
========================================================= */
const SETTINGS_KEY = "capsules-settings";
const DEFAULT_SETTINGS = { sensitivity: 6, sensScale: SENS_SCALE, controllerEnabled: false, controllerSensitivity: 3.0, fov: 90, crosshairSize: 6 };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      // Sensitivity is on Call of Duty's scale (sensitivity.js). One saved on the old, faster scale is converted so it feels the same.
      sensitivity: typeof parsed.sensitivity === "number"
        ? (parsed.sensScale === SENS_SCALE ? clampSens(parsed.sensitivity) : fromOldSensitivity(parsed.sensitivity))
        : DEFAULT_SETTINGS.sensitivity,
      sensScale: SENS_SCALE,
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
  return radiansPerCount(settings.sensitivity);
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
  sensValue.textContent = settings.sensitivity.toFixed(2);
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
  if (!matchActive || match.over || training?.finished) return;
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
  training?.dispose();
  training = null;
  trainingRoom?.dispose();
  trainingRoom = null;
  consolePanelOpen = false;
  crosshair.classList.remove("on-target");
  document.body.classList.remove("training-mode");
  for (const id of ["training-hud", "training-results", "training-console", "training-hint"]) {
    document.getElementById(id).classList.add("hidden");
  }
  pauseMenu.classList.add("hidden");
  settingsModal.classList.add("hidden");
  hideCustomization();
  document.exitPointerLock();
  net.destroy();
  botManager?.dispose();
  botManager = null;
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
  sensValue.textContent = settings.sensitivity.toFixed(2);
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

// Use standard Pointer Lock on <body>, matching the original game's
// browser-managed mouse input. Do not request unadjusted/raw mouse input.
let lockMode = "normal"; // shown in the F9 mouse diagnostics overlay
function lockPointer() {
  try { document.body.requestPointerLock()?.catch?.(() => {}); } catch {}
}

/* =========================================================
   SCREEN ELEMENTS
========================================================= */
const screens = {
  menu: document.getElementById("screen-menu"),
  custom: document.getElementById("screen-custom"),
  browse: document.getElementById("screen-browse"),
  matchmaking: document.getElementById("screen-matchmaking"),
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
initStatsUi(nameInput);

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
let currentModeId = "1v1";
let playerTeams = {};
const myTeam = () => playerTeams[myId] ?? null;

net.onData = (msg, fromId) => handleData(msg, fromId);

let matchStarting = false;
let botManager = null;       // host only

net.onPeerConnected = async (id, team = null) => {
  if (team === 0 || team === 1) playerTeams[id] = team;
  // matchActive only flips true *after* the async arena build finishes —
  // if two peers connect close together, both could see matchActive still
  // false and both call beginMatch(), corrupting arenaObjects/wallBoxes
  // with an interleaved double-build (this was the missing-walls bug).
  // matchStarting closes that race by being set synchronously, before any
  // await, so the second caller sees it immediately.
  if (!matchActive && !matchStarting) {
    matchStarting = true;
    await beginMatch(selectedArenaId);
  }
  addOrUpdatePlayer(id, "Player");
  players.get(id)?.setTeam(playerTeams[id], myTeam(), currentModeId === "tdm");
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
  if ((msg.t === "end" || msg.t === "restart" || msg.t === "sync" || msg.t === "clock" || msg.t === "bots") && !fromHost && !(msg.t === "end" && fromServer)) return;
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
    // The relay can end Find Match games when departures leave one player/team.
    // Ordinary score/time endings still come from the host; custom rooms are unaffected.
    if ((fromId !== hostId && !fromServer) || match.over) return;
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
      if (b.team === 0 || b.team === 1) playerTeams[b.id] = b.team;
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
  resetMatchUi();
  showScreen("menu");
}

const roomCodeBanner = document.getElementById("room-code-banner");
function showRoomCodeBanner(code) {
  document.getElementById("room-code-value").textContent = code;
  roomCodeBanner.classList.remove("hidden");
}
function hideRoomCodeBanner() {
  roomCodeBanner.classList.add("hidden");
}

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

/* ---- CUSTOM MATCH ----
   Everything is chosen on this screen (mode, rules, bots, who can join, map). "Create Match"
   then makes the room and puts you straight in; nothing can be changed after that. */
const matchSettings = { botCount: 0, botSkill: 2, botTeam: "auto", ...DEFAULT_MATCH_RULES };
const custom = { modeId: "1v1", isPublic: false, requireCode: true, creating: false };
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
function paintRuleSliders() {
  for (const [base, key, fmt] of RULE_SLIDERS) {
    document.getElementById(`${base}-slider`).value = matchSettings[key];
    document.getElementById(`${base}-value`).textContent = fmt(matchSettings[key]);
  }
}
for (const [base, key, fmt] of RULE_SLIDERS) {
  const slider = document.getElementById(`${base}-slider`);
  const label = document.getElementById(`${base}-value`);
  slider.addEventListener("input", () => {
    matchSettings[key] = parseFloat(slider.value);
    label.textContent = fmt(matchSettings[key]);
  });
}

// Game mode cards. Picking a mode loads its preset rules into the sliders; you can still change them.
const customModeGrid = document.getElementById("custom-mode-grid");
function selectCustomMode(modeId) {
  custom.modeId = modeId;
  const mode = getMode(modeId);
  Object.assign(matchSettings, mode.settings);
  paintRuleSliders();
  for (const c of customModeGrid.children) c.classList.toggle("selected", c.dataset.id === modeId);
  document.getElementById("bot-team-row").classList.toggle("hidden", !mode.teamMode);
}

// Team Deathmatch: which team the bots play on (you are always Blue).
document.querySelectorAll(".bot-team-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    matchSettings.botTeam = btn.dataset.team === "auto" ? "auto" : parseInt(btn.dataset.team, 10);
    document.querySelectorAll(".bot-team-option").forEach((b) => b.classList.toggle("selected", b === btn));
  });
});
for (const mode of GAME_MODES) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "mode-card";
  card.dataset.id = mode.id;
  const name = document.createElement("span");
  name.className = "mode-name";
  name.textContent = mode.name;
  const tag = document.createElement("span");
  tag.className = "mode-tagline";
  tag.textContent = mode.tagline;
  card.append(name, tag);
  card.addEventListener("click", () => selectCustomMode(mode.id));
  customModeGrid.appendChild(card);
}

// Public (listed) or private (not listed); a code can be required for either.
const requireCodeBox = document.getElementById("require-code");
const codeHint = document.getElementById("code-hint");
function paintVisibility() {
  document.querySelectorAll(".visibility-option").forEach((b) => b.classList.toggle("selected", (b.dataset.public === "true") === custom.isPublic));
  requireCodeBox.checked = custom.requireCode;
  requireCodeBox.disabled = !custom.isPublic;
  codeHint.textContent = !custom.isPublic
    ? "Private matches can only be joined with their code."
    : custom.requireCode
      ? "Shown in the lobby list with a lock. Players need your code to get in."
      : "Anyone can join from the lobby list.";
}
document.querySelectorAll(".visibility-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    custom.isPublic = btn.dataset.public === "true";
    custom.requireCode = custom.isPublic ? false : true;
    paintVisibility();
  });
});
requireCodeBox.addEventListener("change", () => {
  custom.requireCode = custom.isPublic ? requireCodeBox.checked : true;
  paintVisibility();
});

selectCustomMode(custom.modeId);
paintVisibility();

const customStatus = document.getElementById("custom-status");
const createBtn = document.getElementById("btn-custom-create");

document.getElementById("btn-custom").addEventListener("click", () => {
  customStatus.textContent = "";
  showScreen("custom");
});
document.getElementById("btn-custom-back").addEventListener("click", () => {
  net.destroy();
  custom.creating = false;
  createBtn.disabled = false;
  showScreen("menu");
});

async function createCustomMatch() {
  if (custom.creating || matchActive || matchStarting) return;
  custom.creating = true;
  createBtn.disabled = true;
  customStatus.textContent = "Creating your match...";
  const wakeupTimer = setTimeout(() => {
    customStatus.textContent = "Server is waking up. This can take up to a minute on the first connection...";
  }, 3000);
  const arenaId = selectedArenaId;
  const modeId = custom.modeId;
  const rules = sanitizeSettings(matchSettings);
  try {
    const code = await net.host(arenaId, { isPublic: custom.isPublic, requireCode: custom.requireCode, modeId, settings: rules });
    clearTimeout(wakeupTimer);
    hostId = net.hostId;
    myId = net.myId;
    myName = getPlayerName();
    playerTeams = { ...(net.roomTeams || {}) };
    matchStarting = true;
    match.scores.clear();
    applyMatchSettings(rules, modeId);
    await beginMatch(arenaId);
    startBots();
    showRoomCodeBanner(code);
    custom.creating = false;
    createBtn.disabled = false;
    customStatus.textContent = "";
  } catch (err) {
    clearTimeout(wakeupTimer);
    net.destroy();
    matchStarting = false;
    custom.creating = false;
    createBtn.disabled = false;
    customStatus.textContent = "Couldn't create the match. Try again.";
  }
}
createBtn.addEventListener("click", createCustomMatch);

function startBots(cfg = matchSettings) {
  botManager?.dispose();
  botManager = null;
  if (!net.isHost || cfg.botCount <= 0) return;
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
    getTeam: (id) => playerTeams[id] ?? null,
    getMaxHp: () => GAME.maxHp,
    getHealthSteal: () => match.settings.healthSteal,
    getRespawnDelay: () => match.settings.respawnDelay,
  });
  // Team Deathmatch: each bot joins the team chosen in Custom Match, or whichever has fewer players on Balanced.
  const teamFor = currentModeId === "tdm" ? (id) => {
    if (cfg.botTeam === 0 || cfg.botTeam === 1) {
      playerTeams[id] = cfg.botTeam;
      return cfg.botTeam;
    }
    const n = [0, 0];
    for (const t of Object.values(playerTeams)) if (t === 0 || t === 1) n[t]++;
    const team = n[1] < n[0] ? 1 : 0;
    playerTeams[id] = team;
    return team;
  } : null;
  botManager.spawnBots(cfg.botCount, cfg.botSkill, teamFor);
}

/* ---- THE ALWAYS-OPEN LOBBY ----
   It is always on the lobby list. The first player to click it opens it and becomes its host, which
   means their browser runs the bots and the clock (see FEATURED_LOBBY in modes.js). Everyone after
   that just joins. Games run their full time and then restart by themselves. */
async function hostFeaturedLobby() {
  if (custom.creating || matchActive || matchStarting) return;
  custom.creating = true;
  stopLobbyPolling();
  joinStatusEl.textContent = "Opening the lobby...";
  const wakeupTimer = setTimeout(() => {
    joinStatusEl.textContent = "Server is waking up. This can take up to a minute on the first connection...";
  }, 3000);
  const preset = FEATURED_LOBBY;
  const rules = sanitizeSettings(preset.rules);
  try {
    const code = await net.host(preset.arenaId, { isPublic: true, requireCode: false, modeId: preset.modeId, settings: rules, featured: true });
    clearTimeout(wakeupTimer);
    hostId = net.hostId;
    myId = net.myId;
    myName = getPlayerName();
    playerTeams = { ...(net.roomTeams || {}) };
    matchStarting = true;
    match.scores.clear();
    applyMatchSettings(rules, preset.modeId);
    await beginMatch(preset.arenaId);
    startBots({ botCount: preset.botCount, botSkill: preset.botSkill, botTeam: "auto" });
    showRoomCodeBanner(code);
    joinStatusEl.textContent = "";
  } catch (err) {
    clearTimeout(wakeupTimer);
    net.destroy();
    matchStarting = false;
    if (err && err.existingCode && !err.full) {
      // Someone opened it a moment before us: just join theirs.
      custom.creating = false;
      joinFromBrowser(err.existingCode);
      return;
    }
    joinStatusEl.textContent = err && err.full ? "That lobby is full right now." : "Couldn't open the lobby. Try again.";
    if (!screens.browse.classList.contains("hidden")) startLobbyPolling();
  } finally {
    custom.creating = false;
  }
}

// When a game in the always-open lobby ends, the host starts the next one after a short pause.
let featuredRestartTimer = null;
function scheduleFeaturedRestart() {
  clearTimeout(featuredRestartTimer);
  featuredRestartTimer = setTimeout(() => {
    featuredRestartTimer = null;
    if (net.isHost && net.featured && match.over) restartMatchAsHost();
  }, FEATURED_LOBBY.restartDelaySec * 1000);
}

/* ---- TRAINING ROOM ----
   The main menu's Training Room button drops you into an empty room with a console at the far end.
   Walk up to the console and it lists the drills; pick one and it starts. Everything is solo and local:
   no network, nothing counts toward the leaderboards. The drills themselves are in training.js. */
let training = null;      // runs the drills; exists while you are in the room
let trainingRoom = null;  // the console model
let trainingDrillId = null;
let trainingHudKey = "";
let consolePanelOpen = false;
const LEVEL_KEY = "arenaduels.training.level";
let trainingLevel = DEFAULT_LEVEL; // how fast the tracking and close-quarters targets go
try {
  const saved = localStorage.getItem(LEVEL_KEY);
  if (LEVELS[saved]) trainingLevel = saved;
} catch { /* storage blocked: stay on the default */ }
const trainingResultsEl = document.getElementById("training-results");
const consolePanelEl = document.getElementById("training-console");
const trainingHintEl = document.getElementById("training-hint");
const trainingHudEl = document.getElementById("training-hud");
const trainingPlayer = () => ({ pos: local.mesh.position, yaw: local.yaw });
const DRILL_SPAWN = { x: 0, y: 1.4, z: 3, yaw: 0 };     // the middle of the room, for the drills
const ROOM_RETURN = { x: 0, y: 1.4, z: -9, yaw: 0 };  // back by the console, after a drill

async function enterTrainingRoom() {
  if (matchActive || matchStarting) return;
  matchStarting = true;
  net.destroy(); // nothing here talks to the server
  hostId = null;
  myId = "training";
  myName = getPlayerName();
  playerTeams = {};
  match.scores.clear();
  applyMatchSettings(DEFAULT_MATCH_RULES, "1v1");
  try {
    await beginMatch("training");
  } catch {
    matchStarting = false;
    showScreen("menu");
    return;
  }
  document.body.classList.add("training-mode");
  trainingRoom = buildTrainingConsole(scene);
  training = new TrainingSession({
    camera,
    makeTarget: (color, name) => new RemotePlayer(scene, color, name),
    onHud: updateTrainingHud,
    onFinish: onTrainingFinished,
  });
  renderConsoleDrills();
  consolePanelOpen = false;
  trainingHintEl.classList.remove("hidden");
}

// The speed buttons and the drill list on the console panel.
function renderConsoleDrills() {
  const bests = loadBests();
  const levels = document.getElementById("training-levels");
  levels.replaceChildren(el("span", "training-levels-label", "Speed"));
  for (const id of LEVEL_IDS) {
    const btn = el("button", `level-btn${id === trainingLevel ? " active" : ""}`, LEVELS[id].label);
    btn.addEventListener("click", () => setTrainingLevel(id));
    levels.append(btn);
  }
  const list = document.getElementById("training-drills");
  list.replaceChildren();
  DRILL_IDS.forEach((id, i) => {
    const drill = DRILLS[id];
    const card = el("div", "training-card");
    const text = el("div", "training-card-text");
    const best = bests[bestKey(id, trainingLevel)];
    const where = drill.levels ? ` (${LEVELS[trainingLevel].label})` : "";
    text.append(
      el("p", "training-card-title", `${i + 1} \u00b7 ${drill.name} \u00b7 ${drill.seconds}s`),
      el("p", "training-card-blurb", drill.blurb),
      el("p", "training-card-best", best !== undefined ? `Best${where}: ${drill.format(best)} ${drill.unit}` : "No score yet"),
    );
    const btn = el("button", "btn btn-primary", "Start");
    btn.addEventListener("click", () => startDrill(id));
    card.append(text, btn);
    list.append(card);
  });
}

function setTrainingLevel(id) {
  if (!LEVELS[id]) return;
  trainingLevel = id;
  try { localStorage.setItem(LEVEL_KEY, id); } catch { /* ignore */ }
  renderConsoleDrills();
}

function setConsolePanel(open) {
  if (open === consolePanelOpen) return;
  consolePanelOpen = open;
  consolePanelEl.classList.toggle("hidden", !open);
  if (open) renderConsoleDrills(); // fresh personal bests
}

// Once a frame while you are in the room: show the drill list when you are at the console.
function updateTrainingRoom() {
  if (!training) return;
  const idle = training.phase === "idle";
  const near = idle && nearConsole(local.mesh.position.x, local.mesh.position.z);
  setConsolePanel(near);
  trainingHintEl.classList.toggle("hidden", !idle || near);
}

function startDrill(id) {
  if (!training || !DRILLS[id] || training.phase !== "idle") return;
  beginDrill(id);
}

function beginDrill(id) {
  trainingDrillId = id;
  trainingResultsEl.classList.add("hidden");
  setConsolePanel(false);
  trainingHintEl.classList.add("hidden");
  paused = false;
  local.spawn(DRILL_SPAWN);
  trainingHudKey = "";
  trainingHudEl.classList.remove("hidden");
  training.start(id, trainingPlayer(), trainingLevel);
  if (document.pointerLockElement !== document.body) lockPointer();
}

function backToRoom() {
  if (!training) return;
  trainingResultsEl.classList.add("hidden");
  trainingHudEl.classList.add("hidden");
  training.stop();
  crosshair.classList.remove("on-target");
  paused = false;
  local.spawn(ROOM_RETURN);
  lockPointer();
}

function updateTrainingHud(info) {
  const key = `${info.name}|${info.timeText}|${info.scoreText}|${info.banner}`;
  if (key === trainingHudKey) return;
  trainingHudKey = key;
  document.getElementById("training-name").textContent = info.name;
  document.getElementById("training-time").textContent = info.timeText;
  document.getElementById("training-score").textContent = info.scoreText;
  document.getElementById("training-banner").textContent = info.banner;
}

function onTrainingFinished(result) {
  paused = true; // the loop stops simulating; the room keeps rendering behind the results
  firing = false;
  for (const k in keys) keys[k] = false;
  document.exitPointerLock();
  const isBest = saveBest(result.bestKey, result.score);
  const best = loadBests()[result.bestKey];
  document.getElementById("training-results-name").textContent = result.name;
  document.getElementById("training-results-score").textContent = result.scoreText;
  document.getElementById("training-results-unit").textContent = result.unit;
  document.getElementById("training-results-detail").textContent = result.lines.join(" \u00b7 ");
  document.getElementById("training-results-best").textContent = isBest
    ? "New personal best!"
    : best !== undefined ? `Personal best: ${DRILLS[result.drillId].format(best)}` : "";
  trainingResultsEl.classList.remove("hidden");
}

document.getElementById("btn-training").addEventListener("click", enterTrainingRoom);
document.getElementById("btn-training-retry").addEventListener("click", () => {
  if (training) beginDrill(trainingDrillId);
});
document.getElementById("btn-training-drills").addEventListener("click", backToRoom);
document.getElementById("btn-training-menu").addEventListener("click", leaveMatch);

// At the console: 1-4 start a drill; E frees the mouse so you can click the Start buttons (E again to look around).
addEventListener("keydown", (e) => {
  if (!training || training.phase !== "idle" || !consolePanelOpen || e.repeat) return;
  const n = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
  if (n >= 0 && DRILL_IDS[n]) startDrill(DRILL_IDS[n]);
  else if (e.code === "KeyL") setTrainingLevel(LEVEL_IDS[(LEVEL_IDS.indexOf(trainingLevel) + 1) % LEVEL_IDS.length]);
  else if (e.code === "KeyE") {
    if (document.pointerLockElement) document.exitPointerLock();
    else lockPointer();
  }
});

/* ---- JOIN FLOW (shared by manual code entry and the lobby browser) ---- */
async function doJoin(code, statusEl) {
  if (statusEl) statusEl.textContent = "Connecting...";

  const wakeupTimer = setTimeout(() => {
    if (statusEl) {
      statusEl.textContent = "Server is waking up. This can take up to a minute on the first connection...";
    }
  }, 3000);

  try {
    const result = await net.join(code);
    clearTimeout(wakeupTimer);
    hostId = result.hostId;
    myId = net.myId;
    myName = getPlayerName();

    playerTeams = result.teams || {};
    currentModeId = result.mode || "1v1";
    match.scores.clear();
    applyMatchSettings(DEFAULT_MATCH_RULES, currentModeId); // replaced by the host's rules a moment later ("sync")
    if (!isValidArenaId(result.arenaId)) throw new Error("Bad arena");
    await beginMatch(result.arenaId);
    for (const id of result.peers) addOrUpdatePlayer(id, "Player");
    net.broadcast({ t: "hello", name: myName, look: myLook });
    return true;
  } catch (err) {
    clearTimeout(wakeupTimer);
    net.destroy();
    if (statusEl) {
      const m = err && err.message;
      statusEl.textContent = m && m !== "Bad arena" ? m : "Couldn't connect. Check the code and try again.";
    }
    return false;
  }
}

/* ---- MATCHMAKING ----
   You search for one game mode. The server puts you with whoever else is searching for it (first
   come, first matched: no skill rating of any kind), everyone votes on the map, and the server
   makes a room and picks the host. We take part through net.findMatch(). */
const MODE_STORAGE_KEY = "arenaduels.mode";
const mmEls = {
  select: document.getElementById("mm-stage-select"),
  search: document.getElementById("mm-stage-search"),
  vote: document.getElementById("mm-stage-vote"),
  load: document.getElementById("mm-stage-load"),
};
const mm = {
  modeId: "1v1",
  searching: false,
  startedAt: 0,
  fillEndsAt: null, // when the queue will stop waiting for more players
  voteEndsAt: 0,
  options: [],
  tally: {},
  votedFor: null,
  decided: null,    // the winning map, once the vote is over
  clock: null,
};
try {
  const saved = localStorage.getItem(MODE_STORAGE_KEY);
  if (isValidModeId(saved)) mm.modeId = saved;
} catch { /* storage unavailable: fine */ }

function mmShow(stage) {
  for (const key in mmEls) mmEls[key].classList.toggle("hidden", key !== stage);
}
function mmElement(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
const mmMinutes = (n) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

function modeRuleChips(settings) {
  const chips = [settings.timeLimit > 0 ? `${settings.timeLimit} min` : "No time limit"];
  chips.push(settings.scoreLimit > 0 ? `${settings.scoreLimit} kills` : "No kill limit");
  chips.push(`${settings.startingHealth} HP`);
  if (settings.healthSteal > 0) chips.push(`${settings.healthSteal}% health steal`);
  return chips;
}

function renderModes() {
  const grid = document.getElementById("mode-grid");
  grid.replaceChildren(...GAME_MODES.map((mode) => {
    const card = mmElement("button", "mode-card" + (mode.id === mm.modeId ? " selected" : ""));
    card.type = "button";
    card.append(mmElement("span", "mode-name", mode.name), mmElement("span", "mode-tagline", mode.tagline), mmElement("span", "mode-desc", mode.description));
    const rules = mmElement("span", "mode-rules");
    for (const chip of modeRuleChips(mode.settings)) rules.append(mmElement("span", "tag-chip", chip));
    card.append(rules);
    card.addEventListener("click", () => {
      mm.modeId = mode.id;
      try { localStorage.setItem(MODE_STORAGE_KEY, mode.id); } catch { /* fine */ }
      for (const c of grid.children) c.classList.toggle("selected", c === card);
    });
    return card;
  }));
}

function renderVote() {
  const grid = document.getElementById("vote-grid");
  grid.replaceChildren(...mm.options.map((id) => {
    const arena = getArena(id);
    const card = mmElement("button", "vote-card");
    card.type = "button";
    card.dataset.arena = id;
    const thumb = mmElement("div", "vote-thumb");
    thumb.style.backgroundImage = `url("${arena.thumb}")`;
    const info = mmElement("div", "vote-info");
    info.append(mmElement("span", "vote-name", arena.name), mmElement("span", "vote-tagline", arena.tagline ?? ""));
    const tags = mmElement("div", "vote-tags");
    for (const t of arena.tags ?? []) tags.append(mmElement("span", "tag-chip", t));
    info.append(tags);
    card.append(thumb, info, mmElement("span", "vote-badge", "0"));
    card.addEventListener("click", () => {
      if (mm.decided) return;
      mm.votedFor = id;
      net.vote(id);
      paintVote();
    });
    return card;
  }));
  paintVote();
}

// Vote counts, "your vote", and (once the vote is over) the winner.
function paintVote() {
  for (const card of document.getElementById("vote-grid").children) {
    const id = card.dataset.arena;
    card.querySelector(".vote-badge").textContent = String(mm.tally[id] ?? 0);
    card.classList.toggle("mine", !mm.decided && mm.votedFor === id);
    card.classList.toggle("won", mm.decided === id);
    card.classList.toggle("lost", !!mm.decided && mm.decided !== id);
  }
}

function startMmClock() {
  stopMmClock();
  mm.clock = setInterval(() => {
    const now = performance.now();
    document.getElementById("mm-search-time").textContent = mmMinutes((now - mm.startedAt) / 1000);
    if (mm.fillEndsAt != null) {
      const left = Math.max(0, Math.ceil((mm.fillEndsAt - now) / 1000));
      document.getElementById("mm-search-status").textContent = `Match starts in ${left}s — more players can still join`;
    }
    if (mm.voteEndsAt) {
      const left = Math.max(0, Math.ceil((mm.voteEndsAt - now) / 1000));
      document.getElementById("mm-vote-time").textContent = mm.decided ? "Map chosen" : `${left}s left`;
    }
  }, 250);
}
function stopMmClock() {
  clearInterval(mm.clock);
  mm.clock = null;
}

function mmBackToSearching(notice) {
  mm.options = [];
  mm.tally = {};
  mm.votedFor = null;
  mm.decided = null;
  mm.voteEndsAt = 0;
  mm.fillEndsAt = null;
  mmShow("search");
  document.getElementById("mm-search-status").textContent = notice || "Looking for players…";
}

const matchmakingHooks = {
  onQueue({ players, max, startsInMs }) {
    mmShow("search");
    document.getElementById("mm-count-num").textContent = String(players);
    document.getElementById("mm-count-max").textContent = String(max);
    mm.fillEndsAt = startsInMs != null ? performance.now() + startsInMs : null;
    if (startsInMs == null) {
      document.getElementById("mm-search-status").textContent = players < 2 ? "Looking for players…" : "Waiting for more players…";
    }
  },
  onVoteStart({ mode, options, endsInMs, players }) {
    mm.options = options;
    mm.tally = {};
    mm.votedFor = null;
    mm.decided = null;
    mm.fillEndsAt = null;
    mm.voteEndsAt = performance.now() + endsInMs;
    document.getElementById("mm-vote-mode").textContent = getMode(mode).name;
    document.getElementById("mm-vote-count").textContent = `0 of ${players} voted`;
    document.getElementById("mm-vote-time").textContent = "";
    renderVote();
    mmShow("vote");
  },
  onVoteUpdate({ tally, voted, players }) {
    mm.tally = tally;
    document.getElementById("mm-vote-count").textContent = `${voted} of ${players} voted`;
    paintVote();
  },
  onVoteResult({ arenaId }) {
    mm.decided = arenaId;
    paintVote();
    document.getElementById("mm-load-map").textContent = getArena(arenaId).name;
  },
  onLoading({ arenaId }) {
    document.getElementById("mm-load-map").textContent = getArena(arenaId).name;
    document.getElementById("mm-load-status").textContent = "Waiting for the host to load the match…";
    mmShow("load");
  },
  onNotice(text) {
    mmBackToSearching(text);
  },
};

async function enterMatchmadeGame(found) {
  // Reserve the arena build synchronously before the first await. In TDM, later
  // teammates can be admitted while this client is still loading; the resulting
  // peer_joined event must not start a second build using selectedArenaId (the
  // previously selected/private-room map) over the voted matchmaking arena.
  matchStarting = true;
  hostId = found.hostId;
  myId = net.myId;
  myName = getPlayerName();
  match.scores.clear();
  document.getElementById("mm-load-map").textContent = getArena(found.arenaId).name;
  document.getElementById("mm-load-status").textContent = "Loading the map…";
  mmShow("load");

  playerTeams = found.teams || {};
  currentModeId = found.mode;
  match.scores.clear();
  if (found.isHost) {
    matchStarting = true;
    applyMatchSettings(found.settings, found.mode); // the mode's rules
    await beginMatch(found.arenaId);
    match.ensurePlayer(myId, myName, myTeam());
    for (const id of Object.keys(playerTeams)) { if (id !== myId) { match.ensurePlayer(id, "Player", playerTeams[id]); players.get(id)?.setTeam(playerTeams[id], myTeam(), currentModeId === "tdm"); } }
    net.broadcast({ t: "match_ready" }); // the server lets the other players in now
  } else {
    applyMatchSettings(DEFAULT_MATCH_RULES, found.mode); // replaced by the host's rules a moment later ("sync")
    await beginMatch(found.arenaId);
    match.ensurePlayer(myId, myName, myTeam());
    for (const id of found.peers) addOrUpdatePlayer(id, "Player");
    for (const id of Object.keys(playerTeams)) { match.ensurePlayer(id, "Player", playerTeams[id]); players.get(id)?.setTeam(playerTeams[id], myTeam(), currentModeId === "tdm"); }
    net.broadcast({ t: "hello", name: myName, look: myLook });
  }
}

async function startSearch() {
  if (mm.searching) return;
  mm.searching = true;
  document.getElementById("mm-error").textContent = "";
  document.getElementById("mm-search-mode").textContent = getMode(mm.modeId).name;
  document.getElementById("mm-count-num").textContent = "1";
  document.getElementById("mm-search-time").textContent = "0:00";
  mm.startedAt = performance.now();
  mmBackToSearching("Connecting…");
  startMmClock();
  try {
    const found = await net.findMatch(mm.modeId, matchmakingHooks);
    stopMmClock();
    await enterMatchmadeGame(found);
    mm.searching = false;
  } catch (err) {
    stopMmClock();
    mm.searching = false;
    if (err.cancelled) return; // the player backed out; the screen has already changed
    net.destroy();
    matchStarting = false;
    mmShow("select");
    showScreen("matchmaking");
    document.getElementById("mm-error").textContent = err.message || "Couldn't find a match. Try again.";
  }
}

function cancelSearch() {
  net.cancelSearch();
  mm.searching = false;
  stopMmClock();
  mmShow("select");
}

// A matchmade game that fell through after we'd already built it as host (the others left, or took too long).
net.onMatchCancelled = (reason) => {
  leaveMatch();
  matchStarting = false;
  mmShow("select");
  showScreen("matchmaking");
  document.getElementById("mm-error").textContent = reason || "The match was cancelled.";
};

document.getElementById("btn-find-match").addEventListener("click", () => {
  document.getElementById("mm-error").textContent = "";
  renderModes();
  mmShow("select");
  showScreen("matchmaking");
});
document.getElementById("btn-mm-search").addEventListener("click", startSearch);
document.getElementById("btn-mm-back").addEventListener("click", () => showScreen("menu"));
document.getElementById("btn-mm-cancel").addEventListener("click", cancelSearch);
document.getElementById("btn-mm-leave").addEventListener("click", cancelSearch);

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
    lobbyListEl.innerHTML = `<p class="status-text">No public lobbies right now. Create a custom match!</p>`;
    return;
  }
  lobbyListEl.innerHTML = "";
  const lockSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9.5" rx="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  for (const lobby of lobbies) {
    const arena = getArena(lobby.arenaId);
    const modeName = lobby.mode && isValidModeId(lobby.mode) ? getMode(lobby.mode).name : "Custom";
    const full = lobby.playerCount >= lobby.maxPlayers;
    const row = document.createElement("div");
    row.className = "lobby-row";
    row.innerHTML = `
      <div class="lobby-thumb" style="background-image:url('${arena.thumb}')"></div>
      <div class="lobby-info">
        <span class="lobby-arena-name"></span>
        <div class="lobby-player-row">
          <span class="lobby-dot ${full ? "full" : ""}"></span>
          <span class="lobby-player-count"></span>
        </div>
      </div>
      <button class="lobby-join-btn" ${full ? "disabled" : ""}></button>
    `;
    row.querySelector(".lobby-arena-name").textContent = lobby.featured ? `Always Open · ${modeName} · ${arena.name}` : `${arena.name} · ${modeName}`;
    row.querySelector(".lobby-player-count").textContent = lobby.featured
      ? `${lobby.playerCount}/${lobby.maxPlayers} players · ${FEATURED_LOBBY.botCount} bots`
      : `${lobby.playerCount}/${lobby.maxPlayers} players`;
    const btn = row.querySelector(".lobby-join-btn");
    if (lobby.featured) {
      btn.textContent = full ? "Full" : lobby.code ? "Join" : "Play";
    } else if (lobby.locked) {
      btn.innerHTML = `<span class="lock-icon">${lockSvg}</span>Code`;
      if (full) btn.textContent = "Full";
    } else {
      btn.textContent = full ? "Full" : "Join";
    }
    if (!full) {
      btn.addEventListener("click", () => {
        if (lobby.featured) {
          if (lobby.code) joinFromBrowser(lobby.code);
          else hostFeaturedLobby();
        } else if (lobby.locked) {
          joinStatusEl.textContent = "That lobby needs a code. Ask the host for it.";
          joinCodeInput.focus();
        } else {
          joinFromBrowser(lobby.code);
        }
      });
    }
    lobbyListEl.appendChild(row);
  }
}

const joinCodeInput = document.getElementById("join-code-input");
const joinStatusEl = document.getElementById("join-status");

async function joinFromBrowser(code) {
  stopLobbyPolling();
  const ok = await doJoin(code, joinStatusEl);
  if (!ok && !screens.browse.classList.contains("hidden")) startLobbyPolling();
}

function startLobbyPolling() {
  stopLobbyPolling();
  lobbyPollTimer = setInterval(refreshLobbyList, 3000);
}

document.getElementById("btn-browse").addEventListener("click", () => {
  showScreen("browse");
  joinStatusEl.textContent = "";
  joinCodeInput.value = "";
  lobbyListEl.innerHTML = `<p class="status-text">Loading...</p>`;
  refreshLobbyList();
  startLobbyPolling();
});
document.getElementById("btn-join-confirm").addEventListener("click", () => {
  const code = joinCodeInput.value.trim();
  if (code.length !== 6) {
    joinStatusEl.textContent = "Enter the 6-digit code.";
    return;
  }
  joinFromBrowser(code);
});
joinCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-join-confirm").click();
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

  match.ensurePlayer(myId, myName, myTeam());
  refreshHud(true);

  matchActive = true;
  matchStarting = false;
  showGame();
  lockPointer();
}

function addOrUpdatePlayer(id, name) {
  match.ensurePlayer(id, name, playerTeams[id]);
  if (players.has(id)) {
    if (name) players.get(id).setName(name);
    return players.get(id);
  }
  const rp = new RemotePlayer(scene, colorForId(id), name || "Player");
  rp.setTeam(playerTeams[id], myTeam(), currentModeId === "tdm");
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
function applyMatchSettings(raw, modeId = currentModeId) {
  currentModeId = modeId;
  match.start({ ...raw, modeId });
  GAME.maxHp = match.settings.startingHealth;
}

function resetMatchUi() {
  match.scores.clear();
  playerTeams = {};
  currentModeId = "1v1";
  applyMatchSettings(DEFAULT_MATCH_RULES, "1v1");
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
  const shownLimit = currentModeId === "tdm" ? `Team first to ${limit}` : limitText;
  if (hudLimitEl.textContent !== shownLimit) hudLimitEl.textContent = shownLimit;

  const ranking = match.ranking();
  const key = ranking.map((e) => `${e.id}:${e.name}:${e.kills}`).join("|") + "#" + myId;
  if (force || key !== hudKey) {
    hudKey = key;
    hudPlayersEl.replaceChildren(...ranking.slice(0, 8).map((e, i) => playerChip(e, i === 0 && e.kills > 0)));
    const me = match.scores.get(myId);
    hudScoreEl.textContent = me ? (currentModeId === "tdm" ? `Team ${me.team === 0 ? "Blue" : "Red"}: ${match.teamKills[me.team] ?? 0} · ${me.kills} kills` : `${me.kills} kills · ${me.deaths} deaths`) : "";
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
  if (net.featured) scheduleFeaturedRestart();
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
  document.getElementById("results-winner").textContent = currentModeId === "tdm"
    ? (match.winnerTeam() == null ? "It's a draw" : match.winnerTeam() === myTeam() ? "Your team wins!" : `Team ${match.winnerTeam() === 0 ? "Blue" : "Red"} wins!`)
    : winner ? winner.id === myId ? "You win!" : `${winner.name} wins!` : "It's a draw";
  document.getElementById("results-reason").textContent =
    match.reason === "score" ? "SCORE LIMIT REACHED" : match.reason === "time" ? "TIME'S UP" : match.reason === "last-standing" ? "LAST PLAYER / TEAM REMAINING" : "";
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
  if (e.code === "Escape" && matchActive && !match.over && !training?.finished) {
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
   MOUSE DIAGNOSTICS — press F9 to show or hide.
   Shows whether raw mouse input is active, the frame rate, and the
   biggest single mouse jump each second. Nothing here changes aiming.
========================================================= */
const mouseDbg = { el: null, on: false, events: 0, max: 0, shownMax: 0, shownEvents: 0, frames: 0, fps: 0, last: 0 };
addEventListener("mousemove", (e) => {
  if (!mouseDbg.on || document.pointerLockElement !== document.body) return;
  mouseDbg.events++;
  mouseDbg.max = Math.max(mouseDbg.max, Math.hypot(sanitizeDelta(e.movementX), sanitizeDelta(e.movementY)));
});
function mouseDbgTick(now) {
  if (!mouseDbg.on) return;
  mouseDbg.frames++;
  if (now - mouseDbg.last >= 1000) {
    mouseDbg.fps = Math.round((mouseDbg.frames * 1000) / (now - mouseDbg.last));
    mouseDbg.shownMax = Math.round(mouseDbg.max);
    mouseDbg.shownEvents = mouseDbg.events;
    mouseDbg.frames = 0; mouseDbg.events = 0; mouseDbg.max = 0; mouseDbg.last = now;
    mouseDbg.el.textContent =
      `mouse lock: ${lockMode}\nfps: ${mouseDbg.fps}\nmouse events/s: ${mouseDbg.shownEvents}\nbiggest jump: ${mouseDbg.shownMax}`;
  }
  requestAnimationFrame(mouseDbgTick);
}
addEventListener("keydown", (e) => {
  if (e.code !== "F9") return;
  e.preventDefault();
  mouseDbg.on = !mouseDbg.on;
  if (!mouseDbg.el) {
    mouseDbg.el = document.createElement("pre");
    mouseDbg.el.style.cssText =
      "position:fixed;left:8px;bottom:8px;margin:0;padding:6px 8px;background:rgba(0,0,0,.65);color:#fff;font:12px monospace;z-index:9999;pointer-events:none;";
    document.body.appendChild(mouseDbg.el);
  }
  mouseDbg.el.style.display = mouseDbg.on ? "block" : "none";
  if (mouseDbg.on) { mouseDbg.last = performance.now(); requestAnimationFrame(mouseDbgTick); }
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
    for (const rp of players.values()) rp.update(dt, camera, arenaObjects);
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

  for (const rp of players.values()) rp.update(dt, camera, arenaObjects);
  if (training) {
    training.update(dt, trainingPlayer());
    updateTrainingRoom();
  }

  const targets = [];
  const targetIds = [];
  for (const [id, rp] of players) {
    if (rp.visible) {
      targets.push(rp.mesh);
      targetIds.push(id);
    }
  }
  if (training) for (const m of training.hitMeshes()) targets.push(m);
  const solidObjects = arenaObjects; // includes the floor now, so floor shots register too

  let beamHitMesh = null; // which training target the beam reached first, if any
  if (activeFiring) {
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir).normalize();
    raycaster.set(origin, dir);

    const hits = raycaster.intersectObjects([...targets, ...solidObjects], false);
    const hit = hits[0];
    if (hit && training && training.ownsMesh(hit.object)) beamHitMesh = hit.object;
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

  if (training) {
    training.afterBeam(dt, activeFiring, beamHitMesh, trainingPlayer());
    crosshair.classList.toggle("on-target", training.onTarget);
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
