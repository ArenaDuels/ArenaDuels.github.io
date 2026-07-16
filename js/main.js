import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { ARENA_LIST, getArena } from "./arenas.js";
import { PlayerController, RemotePlayer, makeLaserMesh, aimLaser } from "./player.js";
import { Net } from "./net.js";
import { randomName } from "./names.js";

/* =========================================================
   SETTINGS — persisted to localStorage. Sensitivity uses the same
   numeric scale convention as Call of Duty (roughly 1-20, with ~6
   being a typical mouse default) rather than an arbitrary 0-1 slider.
========================================================= */
const SETTINGS_KEY = "capsules-settings";
const DEFAULT_SETTINGS = { sensitivity: 6, fov: 90, crosshairSize: 6 };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      sensitivity: typeof parsed.sensitivity === "number" ? parsed.sensitivity : DEFAULT_SETTINGS.sensitivity,
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
const fovSlider = document.getElementById("fov-slider");
const fovValue = document.getElementById("fov-value");
const crosshairSlider = document.getElementById("crosshair-slider");
const crosshairValue = document.getElementById("crosshair-value");

function refreshSettingsUI() {
  sensSlider.value = settings.sensitivity;
  sensValue.textContent = settings.sensitivity.toFixed(1);
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
  canvas.requestPointerLock?.() ?? document.body.requestPointerLock();
}
function leaveMatch() {
  matchActive = false;
  paused = false;
  pauseMenu.classList.add("hidden");
  settingsModal.classList.add("hidden");
  document.exitPointerLock();
  net.destroy();
  players.forEach((rp) => rp.dispose());
  players.clear();
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

applyCrosshairSize(); // apply saved size immediately, even before a match

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

net.onPeerConnected = async (id) => {
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
  net.broadcast({ t: "hello", name: myName });
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
    if (msg.targetId !== myId) return;
    const died = local.takeDamage(msg.damage);
    if (died) {
      myDeaths++;
      updateScoreHud();
      local.spawn(mySpawn);
      net.broadcast({ t: "died", attackerId: msg.attackerId });
    }
    net.broadcast({ t: "state", id: myId, ...local.getNetState() });
  } else if (msg.t === "died") {
    if (msg.attackerId !== myId) return;
    myKills++;
    updateScoreHud();
  }
}

function handleServerLost() {
  if (!matchActive) return;
  matchActive = false;
  document.exitPointerLock();
  alert("Lost connection to the server.");
  net.destroy();
  showScreen("menu");
}

/* ---- HOST FLOW ---- */
async function attemptHost() {
  document.getElementById("btn-retry-host").classList.add("hidden");
  document.getElementById("host-code-display").textContent = "------";
  document.getElementById("host-status").textContent = "Getting a code...";

  try {
    const code = await net.host(selectedArenaId, isPublicLobby);
    hostId = net.hostId;
    myId = net.myId;
    myName = getPlayerName();

    document.getElementById("host-code-display").textContent = code;
    document.getElementById("host-status").textContent = "Waiting for opponents... (share the code above)";
  } catch (err) {
    console.error("Host failed:", err);
    document.getElementById("host-status").textContent =
      `Failed to host: ${err.message || err.type || "unknown error"} (see console for details)`;
    document.getElementById("btn-retry-host").classList.remove("hidden");
  }
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
  showScreen("menu");
});

/* ---- JOIN FLOW (shared by manual code entry and the lobby browser) ---- */
async function doJoin(code, statusEl) {
  if (statusEl) statusEl.textContent = "Connecting...";
  try {
    const result = await net.join(code);
    hostId = result.hostId;
    myId = net.myId;
    myName = getPlayerName();

    await beginMatch(result.arenaId);
    for (const id of result.peers) addOrUpdatePlayer(id, "Player");
    net.broadcast({ t: "hello", name: myName });
  } catch (err) {
    console.error("Join failed:", err);
    if (statusEl) {
      statusEl.textContent = `Couldn't connect: ${err.message || "unknown error"} (see console for details)`;
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
    lobbyListEl.innerHTML = `<p class="status-text">Couldn't load lobbies: ${err.message}</p>`;
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

  if (local) scene.remove(local.mesh);
  local = new PlayerController(scene, camera, colorForId(myId));
  local.spawn(mySpawn);

  if (laser) scene.remove(laser);
  laser = makeLaserMesh(colorForId(myId));
  scene.add(laser);

  myKills = 0;
  myDeaths = 0;
  updateScoreHud();

  matchActive = true;
  showGame();
  canvas.requestPointerLock?.() ?? document.body.requestPointerLock();
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
    document.body.requestPointerLock();
  }
});

// Guards against rare, anomalously large single-event mouse deltas —
// some browser/OS combinations occasionally produce a spike around
// Pointer Lock's cursor-recentering behavior, and it tends to show up
// more on the vertical axis than horizontal. A single huge delta shows
// as a visible snap/stutter; this clamps it to a sane maximum.
const MAX_MOUSE_DELTA = 80;
function sanitizeDelta(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, v));
}

addEventListener("mousemove", (e) => {
  if (!matchActive || paused || document.pointerLockElement !== document.body) return;
  const s = sensitivityMultiplier();
  local.yaw -= sanitizeDelta(e.movementX) * s;
  local.pitch -= sanitizeDelta(e.movementY) * s;
  local.pitch = Math.max(-1.4, Math.min(1.4, local.pitch));
});

/* =========================================================
   MAIN LOOP
========================================================= */
let last = performance.now();

// Fixed timestep for physics — see the comment on PlayerController.updatePhysics
// in player.js for why. Rendering (and mouse-look) still happens every rAF frame.
const FIXED_DT = 1 / 120;
const MAX_PHYSICS_STEPS_PER_FRAME = 16; // avoid a "spiral of death" after a big stall
let physicsAccumulator = 0;

setInterval(() => {
  if (matchActive && local) {
    net.broadcast({ t: "state", id: myId, ...local.getNetState() });
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

  local.applyInput(keys, firing);

  physicsAccumulator += dt;
  let steps = 0;
  while (physicsAccumulator >= FIXED_DT && steps < MAX_PHYSICS_STEPS_PER_FRAME) {
    local.updatePhysics(FIXED_DT, wallBoxes, keys.Space);
    physicsAccumulator -= FIXED_DT;
    steps++;
  }

  local.updateLook(); // After physics collision resolves — keeps aiming smooth without glitches

  for (const rp of players.values()) rp.update(dt, camera);

  const targets = [];
  const targetIds = [];
  for (const [id, rp] of players) {
    if (rp.visible) {
      targets.push(rp.mesh);
      targetIds.push(id);
    }
  }
  const solidObjects = arenaObjects.filter((o) => o !== floorMesh);

  if (firing) {
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
        net.broadcast({ t: "hit", targetId, attackerId: myId, damage: 40 * dt });
      }
    }
  } else {
    laser.visible = false;
  }

  document.getElementById("hud-hp-value").textContent = Math.ceil(local.hp);

  renderer.render(scene, camera);
}

showScreen("menu");
loop();
