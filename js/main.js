import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { ARENA_LIST, getArena } from "./arenas.js";
import { PlayerController, RemotePlayer, makeLaserMesh, aimLaser } from "./player.js";
import { Net } from "./net.js";
import { randomName } from "./names.js";
import { BotManager, BOT_SKILLS } from "./bots.js";

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
  if (!matchActive) return;
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
  lockPointer();
}
function leaveMatch() {
  matchActive = false;
  paused = false;
  pauseMenu.classList.add("hidden");
  settingsModal.classList.add("hidden");
  document.exitPointerLock();
  net.destroy();
  botManager?.dispose();
  botManager = null;
  pendingHostStart = null;
  players.forEach((rp) => rp.dispose());
  players.clear();
  hideRoomCodeBanner();
  clearScorchMarks();
  showScreen("menu");
}

document.getElementById("btn-settings").addEventListener("click", openSettingsFromMenu);
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
  stopLobbyPolling();
}
function showGame() {
  for (const key in screens) screens[key].classList.add("hidden");
  canvas.classList.remove("hidden");
  hud.classList.remove("hidden");
  hudHpCorner.classList.remove("hidden");
  crosshair.classList.remove("hidden");
  stopLobbyPolling();
}

/* =========================================================
   PLAYER NAME
========================================================= */
const nameInput = document.getElementById("player-name-input");
nameInput.value = randomName(); // pre-filled, but fully editable

document.getElementById("btn-random-name").addEventListener("click", () => {
  nameInput.value = randomName();
});

function getPlayerName() {
  const raw = nameInput.value.trim();
  return raw || randomName();
}

/* =========================================================
   ARENA PICKER (menu)
========================================================= */
const arenaGrid = document.getElementById("arena-grid");
let selectedArenaId = ARENA_LIST[0].id;

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
  });
  arenaGrid.appendChild(card);
}
arenaGrid.firstElementChild.classList.add("selected");

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
  net.broadcast({ t: "hello", name: myName });
  hideRoomCodeBanner();
};

net.onPeerDisconnected = (id) => {
  if (id === null) {
    handleServerLost();
  } else {
    removePlayer(id);
  }
};

function handleData(msg, fromId) {
  if (msg.t === "hello") {
    addOrUpdatePlayer(fromId, msg.name);
  } else if (msg.t === "state") {
    addOrUpdatePlayer(fromId).applyNetState(msg);
  } else if (msg.t === "hit") {
    // Host only: a remote player shot one of the bots.
    if (botManager && botManager.has(msg.targetId)) {
      botManager.damage(msg.targetId, msg.attackerId, msg.damage);
      return;
    }
    if (msg.targetId !== myId) return;
    applyDamageToLocal(msg.attackerId, msg.damage);
  } else if (msg.t === "died") {
    if (botManager) botManager.creditKill(msg.attackerId); // a bot killed a remote player
    if (msg.attackerId !== myId) return;
    myKills++;
    updateScoreHud();
  } else if (msg.t === "bots") {
    // Host-simulated bots: show them like any other remote player.
    for (const b of msg.bots) {
      const rp = players.get(b.id) || addOrUpdatePlayer(b.id, b.name);
      rp.applyNetState(b);
    }
  }
}

function applyDamageToLocal(attackerId, damage, echoState = true) {
  const died = local.takeDamage(damage);
  if (died) {
    myDeaths++;
    updateScoreHud();
    local.spawn(mySpawn);
    net.broadcast({ t: "died", attackerId });
    if (botManager) botManager.creditKill(attackerId);
  }
  if (echoState || died) net.broadcast({ t: "state", id: myId, ...local.getNetState() });
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

/* ---- PRIVATE MATCH SETTINGS (bots) ---- */
const matchSettings = { botCount: 0, botSkill: 2 };
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
    // A bot hit the host's own player.
    damageLocal: (attackerId, amount) => applyDamageToLocal(attackerId, amount, false),
    // A bot hit a remote human — they apply it on their end like any other hit.
    sendHit: (targetId, attackerId, amount) =>
      net.broadcast({ t: "hit", targetId, attackerId, damage: amount }),
    // A bot died; credit whoever killed it (a remote human credits themselves).
    onBotKilled: (attackerId) => {
      if (attackerId === myId) {
        myKills++;
        updateScoreHud();
      } else {
        net.broadcast({ t: "died", attackerId });
      }
    },
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

    await beginMatch(result.arenaId);
    for (const id of result.peers) addOrUpdatePlayer(id, "Player");
    net.broadcast({ t: "hello", name: myName });
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

scene.add(new THREE.AmbientLight(0xffffff, 0.4));
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
let myKills = 0, myDeaths = 0;

async function buildArena(arena) {
  for (const obj of arenaObjects) scene.remove(obj);
  arenaObjects = [];
  wallBoxes = [];

  scene.background = new THREE.Color(arena.bgColor ?? 0x0a0a0d);

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

  if (local) scene.remove(local.mesh, local.viewRoot);
  local = new PlayerController(scene, camera, colorForId(myId));
  local.spawn(mySpawn);

  if (laser) scene.remove(laser);
  laser = makeLaserMesh(colorForId(myId));
  scene.add(laser);

  myKills = 0;
  myDeaths = 0;
  updateScoreHud();

  matchActive = true;
  matchStarting = false;
  showGame();
  lockPointer();
}

function addOrUpdatePlayer(id, name) {
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
}

function updateScoreHud() {
  document.getElementById("hud-score").textContent = `Kills ${myKills} · Deaths ${myDeaths}`;
}

/* =========================================================
   INPUT
========================================================= */
const keys = {};
let firing = false;

addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "Escape" && matchActive) {
    if (paused) resumeMatch();
    else openPauseMenu();
  }
});
addEventListener("keyup", (e) => (keys[e.code] = false));
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
  if (!matchActive || paused || document.pointerLockElement !== document.body) return;
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
  if (!settings.controllerEnabled || !matchActive || paused) return;
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
  local.yaw -= rx * lookSpeed;
  local.pitch += ry * lookSpeed;
  local.pitch = Math.max(-1.4, Math.min(1.4, local.pitch));
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

setInterval(() => {
  if (matchActive && local) {
    net.broadcast({ t: "state", id: myId, ...local.getNetState() });
    if (botManager) net.broadcast({ t: "bots", bots: botManager.getStates() });
  }
}, 50); // 20Hz

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;

  if (!matchActive || paused) {
    renderer.render(scene, camera);
    return;
  }

  pollController(dt);
  const activeKeys = settings.controllerEnabled ? controllerKeys : keys;
  const activeFiring = settings.controllerEnabled ? controllerFiring : firing;
  local.applyInput(activeKeys, activeFiring);

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
    aimLaser(laser, muzzlePos, end);

    if (hit) {
      const idx = targets.indexOf(hit.object);
      if (idx !== -1) {
        const targetId = targetIds[idx];
        if (botManager && botManager.has(targetId)) {
          botManager.damage(targetId, myId, 40 * dt);
        } else {
          net.broadcast({ t: "hit", targetId, attackerId: myId, damage: 40 * dt });
        }
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
