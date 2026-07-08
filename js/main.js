import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { ARENA_LIST, getArena } from "./arenas.js";
import { PlayerController, RemotePlayer } from "./player.js";
import { Net } from "./net.js";

/* =========================================================
   SCREEN ELEMENTS
========================================================= */
const screens = {
  menu: document.getElementById("screen-menu"),
  hostWait: document.getElementById("screen-host-wait"),
  joining: document.getElementById("screen-joining"),
};
const hud = document.getElementById("hud");
const hudHpCorner = document.getElementById("hud-hp-corner");
const canvas = document.getElementById("game-canvas");

function showScreen(name) {
  for (const key in screens) screens[key].classList.toggle("hidden", key !== name);
  canvas.classList.add("hidden");
  hud.classList.add("hidden");
  hudHpCorner.classList.add("hidden");
}
function showGame() {
  for (const key in screens) screens[key].classList.add("hidden");
  canvas.classList.remove("hidden");
  hud.classList.remove("hidden");
  hudHpCorner.classList.remove("hidden");
}

/* =========================================================
   PLAYER NAME
========================================================= */
function getPlayerName() {
  const raw = document.getElementById("player-name-input").value.trim();
  return raw || `Player${Math.floor(Math.random() * 900 + 100)}`;
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
   COLOR / SPAWN ASSIGNMENT — deterministic from peer id, so every
   client independently computes the same color/spawn for a given
   player without needing anyone to explicitly assign and sync it.
========================================================= */
const PALETTE_NONHOST = [0xff4d6a, 0x39ff88, 0xffd166, 0x9b5de5, 0x4cc9f0, 0xff8c42];

function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
function colorForId(id) {
  if (id === hostId) return 0xffffff; // room creator is always white
  return PALETTE_NONHOST[hashId(id) % PALETTE_NONHOST.length];
}
function spawnForId(id, arena) {
  return arena.spawns[hashId(id) % arena.spawns.length];
}

/* =========================================================
   NET — every client (host or not) uses identical message
   handling now; the relay server takes care of fan-out.
========================================================= */
const net = new Net();
let hostId = null;
let myId = null;
let myName = "";
let currentArena = null;

net.onData = (msg, fromId) => handleData(msg, fromId);

net.onPeerConnected = (id) => {
  // Someone new joined the room. Add them (name catches up once their
  // 'hello' arrives) and make sure they learn who we are too.
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
    // Immediate update — don't wait for the next scheduled sync tick.
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
    const code = await net.host(selectedArenaId);
    hostId = net.hostId;
    myId = net.myId;
    myName = getPlayerName();

    document.getElementById("host-code-display").textContent = code;
    document.getElementById("host-status").textContent = "Waiting for opponents... (share the code above)";

    await beginMatch(selectedArenaId);
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

/* ---- JOIN FLOW ---- */
document.getElementById("btn-join").addEventListener("click", () => {
  showScreen("joining");
  document.getElementById("join-status").textContent = "";
});

document.getElementById("btn-join-confirm").addEventListener("click", async () => {
  const code = document.getElementById("join-code-input").value.trim();
  if (code.length !== 6) {
    document.getElementById("join-status").textContent = "Enter the 6-digit code.";
    return;
  }
  document.getElementById("join-status").textContent = "Connecting...";

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
    document.getElementById("join-status").textContent =
      `Couldn't connect: ${err.message || "unknown error"} (see console for details)`;
  }
});

document.getElementById("btn-cancel-join").addEventListener("click", () => {
  net.destroy();
  showScreen("menu");
});

/* =========================================================
   THREE.JS SETUP (created once, reused across matches)
========================================================= */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0d);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 5);
scene.add(dirLight);

const textureLoader = new THREE.TextureLoader();

function loadTextureSafe(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    textureLoader.load(
      url,
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
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
let local;                      // my PlayerController
let players = new Map();        // id -> RemotePlayer, everyone else
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

  const [floorTex, wallTex] = await Promise.all([
    loadTextureSafe(arena.textures?.floor),
    loadTextureSafe(arena.textures?.wall),
  ]);

  const floorMat = makeMaterial(floorTex, arena.fallbackColors?.floor ?? 0x222222, [4, 4]);
  const wallMat = makeMaterial(wallTex, arena.fallbackColors?.wall ?? 0x333333, [2, 1]);

  floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(arena.floorSize, arena.floorSize), floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  scene.add(floorMesh);
  arenaObjects.push(floorMesh);

  for (const [w, h, d, x, y, z] of arena.walls) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    mesh.position.set(x, y, z);
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
  laser = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: colorForId(myId) })
  );
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

addEventListener("keydown", (e) => (keys[e.code] = true));
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
  if (matchActive && document.pointerLockElement !== document.body) {
    document.body.requestPointerLock();
  }
});

addEventListener("mousemove", (e) => {
  if (!matchActive || document.pointerLockElement !== document.body) return;
  local.yaw -= e.movementX * 0.002;
  local.pitch -= e.movementY * 0.002;
  local.pitch = Math.max(-1.4, Math.min(1.4, local.pitch));
});

/* =========================================================
   MAIN LOOP
========================================================= */
let last = performance.now();

// Runs on setInterval rather than inside the rAF loop below — rAF gets
// throttled hard (often to ~1fps) in backgrounded/unfocused tabs, which
// would otherwise make a player's position and hp appear frozen to
// everyone else whenever their tab isn't in focus.
setInterval(() => {
  if (matchActive && local) {
    net.broadcast({ t: "state", id: myId, ...local.getNetState() });
  }
}, 50); // 20Hz

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (!matchActive) {
    renderer.render(scene, camera);
    return;
  }

  local.applyInput(keys, firing);
  local.update(dt, wallBoxes, keys.Space);
  for (const rp of players.values()) rp.update(dt, camera);

  /* Shooting — raycast against every other visible player + the arena. */
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
    const end = hit ? hit.point : origin.clone().add(dir.multiplyScalar(50));

    laser.geometry.setFromPoints([origin, end]);
    laser.visible = true;

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
