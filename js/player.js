import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

// ===== Movement tuning — Quake-style accelerate() model =====
// Unlike a simple "add force, clamp to max speed" model, this doesn't hard
// cap your speed after movement. Ground friction keeps normal running feeling
// controlled, but air acceleration lets you gain extra speed by strafing
// (holding A/D or diagonal movement) while turning the mouse in the air —
// classic Quake/CPMA-style air strafing / bunny hopping.
export const MOVE = {
  GROUND_ACCEL: 14,
  AIR_ACCEL: 8,
  WISH_SPEED: 16,     // target ground speed the accelerate() model chases
  MAX_SPEED_SANITY: 45, // hard safety cap only, not a normal gameplay limit
  FRICTION: 8,
  GRAVITY: 35,
  JUMP_VEL: 12,
  RADIUS: 0.5,
  EYE_HEIGHT: 1.6,
};

// Builds a glossy "Tic Tac" capsule mesh in the given color.
export function makeCapsuleMesh(color) {
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.15,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.2, 8, 16), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeHpBar() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#39ff88";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(1.2, 0.15, 1);
  sprite.renderOrder = 998;
  return sprite;
}

function makeNameSprite(name) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");

  function draw(text) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "600 34px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    const w = ctx.measureText(text).width;
    ctx.fillRect(canvas.width / 2 - w / 2 - 14, canvas.height / 2 - 22, w + 28, 44);
    ctx.fillStyle = "#e8fff4";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  draw(name || "Player");

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(1.4, 0.35, 1);
  sprite.renderOrder = 999;
  sprite.userData.setText = (text) => {
    draw(text);
    texture.needsUpdate = true;
  };
  return sprite;
}

// ===== LG beam — a thin glowing cylinder mesh (not a THREE.Line, which
// is capped at ~1px on most GPUs regardless of width settings). Shared by
// both the local player's own beam and every RemotePlayer's beam. =====
export function makeLaserMesh(color) {
  const geo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: false,
    opacity: 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  return mesh;
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);
export function aimLaser(mesh, origin, end) {
  const dir = new THREE.Vector3().subVectors(end, origin);
  const len = dir.length();
  if (len < 0.001) {
    mesh.visible = false;
    return;
  }
  dir.normalize();
  mesh.position.copy(origin).addScaledVector(dir, len / 2);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(UP_AXIS, dir);
  mesh.visible = true;
}

// Reconstructs a look direction from yaw/pitch alone — used to draw a
// remote player's beam from their broadcasted state, since they don't have
// a real camera object on our end. 'YXZ' matches our own camera hierarchy
// (mesh yaw as the outer/parent rotation, pitch as the inner/child one).
const _scratchEuler = new THREE.Euler(0, 0, 0, "YXZ");
export function dirFromYawPitch(yaw, pitch, out = new THREE.Vector3()) {
  _scratchEuler.set(pitch, yaw, 0, "YXZ");
  return out.set(0, 0, -1).applyEuler(_scratchEuler);
}

/**
 * The local, input-driven player. Owns the camera. No hp bar / name tag —
 * those only make sense floating above OTHER players; your own hp lives
 * in the HUD instead.
 */
export class PlayerController {
  constructor(scene, camera, color = 0xffffff) {
    this.scene = scene;
    this.mesh = makeCapsuleMesh(color);
    this.mesh.visible = false; // hide own body from own camera
    scene.add(this.mesh);

    this.camPivot = new THREE.Object3D();
    this.camPivot.position.set(0, MOVE.EYE_HEIGHT, 0);
    this.mesh.add(this.camPivot);
    this.camPivot.add(camera);
    this.camera = camera;

    this.vel = new THREE.Vector3();
    this.wish = new THREE.Vector3();
    this.onGround = true;

    this.yaw = 0;
    this.pitch = 0;

    this.hp = 100;
    this.firing = false;
  }

  spawn(spawnPoint) {
    this.mesh.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    this.yaw = spawnPoint.yaw || 0;
    this.pitch = 0;
    this.vel.set(0, 0, 0);
    this.hp = 100;
  }

  applyInput(keys, mouseFiring) {
    this.wish.set(0, 0, 0);
    if (keys.KeyW) this.wish.z -= 1;
    if (keys.KeyS) this.wish.z += 1;
    if (keys.KeyA) this.wish.x -= 1;
    if (keys.KeyD) this.wish.x += 1;
    this.firing = !!mouseFiring;
  }

  #friction(dt) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < 0.001) return;
    const drop = speed * MOVE.FRICTION * dt;
    const newSpeed = Math.max(speed - drop, 0);
    this.vel.x *= newSpeed / speed;
    this.vel.z *= newSpeed / speed;
  }

  // Classic Quake accelerate(): adds speed toward wishDir, but only up to
  // wishSpeed *relative to your current speed along that specific
  // direction* — not your total speed. That distinction is what makes air
  // strafing work: turning the mouse while holding a strafe key keeps
  // presenting a "new" wish direction relative to your velocity, so you
  // keep gaining speed instead of hitting a hard cap.
  #accelerate(wishDir, wishSpeed, accel, dt) {
    const currentSpeed = this.vel.x * wishDir.x + this.vel.z * wishDir.z;
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed <= 0) return;
    let accelSpeed = accel * dt * wishSpeed;
    if (accelSpeed > addSpeed) accelSpeed = addSpeed;
    this.vel.x += accelSpeed * wishDir.x;
    this.vel.z += accelSpeed * wishDir.z;
  }

  #resolveWalls(wallBoxes) {
    for (const box of wallBoxes) {
      const cx = Math.max(box.min.x, Math.min(this.mesh.position.x, box.max.x));
      const cz = Math.max(box.min.z, Math.min(this.mesh.position.z, box.max.z));
      let dx = this.mesh.position.x - cx;
      let dz = this.mesh.position.z - cz;
      const dist2 = dx * dx + dz * dz;
      if (dist2 < MOVE.RADIUS * MOVE.RADIUS) {
        const dist = Math.sqrt(dist2) || 0.0001;
        const push = MOVE.RADIUS - dist;
        dx /= dist;
        dz /= dist;
        this.mesh.position.x += dx * push;
        this.mesh.position.z += dz * push;
      }
    }
  }

  update(dt, wallBoxes, jumpPressed) {
    this.mesh.rotation.y = this.yaw;
    this.camPivot.rotation.x = this.pitch;

    const wishDir = this.wish.clone();
    const hasInput = wishDir.lengthSq() > 0.0001;
    if (hasInput) {
      wishDir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    }

    if (this.onGround) {
      this.#friction(dt);
      if (hasInput) this.#accelerate(wishDir, MOVE.WISH_SPEED, MOVE.GROUND_ACCEL, dt);
    } else if (hasInput) {
      this.#accelerate(wishDir, MOVE.WISH_SPEED, MOVE.AIR_ACCEL, dt);
    }

    // Safety cap only — not meant to be reachable in normal play, just
    // guards against runaway numbers rather than limiting strafe-jump gain.
    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (spd > MOVE.MAX_SPEED_SANITY) {
      this.vel.x *= MOVE.MAX_SPEED_SANITY / spd;
      this.vel.z *= MOVE.MAX_SPEED_SANITY / spd;
    }

    if (this.onGround && jumpPressed) {
      this.vel.y = MOVE.JUMP_VEL;
      this.onGround = false;
    }

    this.vel.y -= MOVE.GRAVITY * dt;

    // Move in small substeps rather than one big jump, and resolve wall
    // collision after each substep. At the higher speeds air-strafing can
    // legitimately reach, a single full-dt move can cover more distance
    // than a wall's thickness in one step — collision never "sees" you
    // cross it, and you phase straight through. Substepping keeps each
    // individual move shorter than the thinnest wall so that can't happen.
    const moveDist = this.vel.length() * dt;
    const MAX_STEP = 0.2;
    const steps = Math.max(1, Math.ceil(moveDist / MAX_STEP));
    const subDt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.mesh.position.addScaledVector(this.vel, subDt);
      this.#resolveWalls(wallBoxes);
    }

    if (this.mesh.position.y <= 1.4) {
      this.mesh.position.y = 1.4;
      this.vel.y = 0;
      this.onGround = true;
    }
  }

  // What we broadcast over the network each tick.
  getNetState() {
    return {
      x: this.mesh.position.x,
      y: this.mesh.position.y,
      z: this.mesh.position.z,
      yaw: this.yaw,
      pitch: this.pitch,
      hp: this.hp,
      firing: !!this.firing,
    };
  }

  // Returns true if this hit was the killing blow.
  takeDamage(amount) {
    const wasAlive = this.hp > 0;
    this.hp = Math.max(0, this.hp - amount);
    return wasAlive && this.hp <= 0;
  }
}

/**
 * A network-driven player (anyone that isn't "me"). No input handling, no
 * physics — just smoothly interpolates toward the last received snapshot.
 * Has an hp bar, name tag (both real Sprites — Three.js guarantees these
 * always fully face the camera), and its own LG beam that lights up
 * whenever their broadcasted state says they're firing.
 */
export class RemotePlayer {
  constructor(scene, color = 0xff4444, name = "Player") {
    this.scene = scene;
    this.mesh = makeCapsuleMesh(color);
    scene.add(this.mesh);

    this.hp = 100;
    this.hpBar = makeHpBar();
    scene.add(this.hpBar);

    this.nameSprite = makeNameSprite(name);
    scene.add(this.nameSprite);

    this.laser = makeLaserMesh(color);
    scene.add(this.laser);

    this.targetPos = this.mesh.position.clone();
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.firing = false;
    this.visible = true;
  }

  setName(name) {
    this.nameSprite.userData.setText(name);
  }

  spawn(spawnPoint) {
    this.mesh.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    this.targetPos.copy(this.mesh.position);
    this.targetYaw = spawnPoint.yaw || 0;
    this.hp = 100;
    this.setVisible(true);
  }

  // Call this whenever a network snapshot arrives.
  applyNetState(state) {
    this.targetPos.set(state.x, state.y, state.z);
    this.targetYaw = state.yaw;
    this.targetPitch = state.pitch || 0;
    this.hp = state.hp;
    this.firing = !!state.firing;
    if (state.hp <= 0) {
      this.setVisible(false);
    } else if (!this.visible) {
      // Respawned — snap straight there instead of lerping across the map.
      this.mesh.position.copy(this.targetPos);
      this.setVisible(true);
    }
  }

  setVisible(v) {
    this.visible = v;
    this.mesh.visible = v;
    this.hpBar.visible = v && this.hp > 0;
    this.nameSprite.visible = v && this.hp > 0;
    if (!v) this.laser.visible = false;
  }

  dispose() {
    this.scene.remove(this.mesh, this.hpBar, this.nameSprite, this.laser);
  }

  update(dt, camera) {
    const t = Math.min(1, dt * 12);
    this.mesh.position.lerp(this.targetPos, t);
    this.mesh.rotation.y += (this.targetYaw - this.mesh.rotation.y) * t;

    if (this.visible && this.hp > 0) {
      this.hpBar.position.copy(this.mesh.position);
      this.hpBar.position.y += 1.5;
      this.hpBar.scale.x = 1.2 * Math.max(this.hp / 100, 0);

      this.nameSprite.position.copy(this.mesh.position);
      this.nameSprite.position.y += 1.85;

      if (this.firing) {
        const origin = this.mesh.position.clone();
        origin.y += MOVE.EYE_HEIGHT - 1.4; // mesh position is feet-ish; eye is higher
        const dir = dirFromYawPitch(this.targetYaw, this.targetPitch);
        const end = origin.clone().addScaledVector(dir, 50);
        aimLaser(this.laser, origin, end);
      } else {
        this.laser.visible = false;
      }
    }
  }
}
