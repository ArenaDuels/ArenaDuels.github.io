import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

// ===== Shared movement tuning =====
export const MOVE = {
  GROUND_ACCEL: 120,
  AIR_ACCEL: 35,
  MAX_SPEED: 16,
  FRICTION: 8,
  GRAVITY: 35,
  JUMP_VEL: 12,
  RADIUS: 0.5,
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
  return mesh;
}

function makeHpBar() {
  const bar = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.15),
    new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide })
  );
  return bar;
}

// A billboard text sprite for a player's name tag, floating above their capsule.
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
    this.camPivot.position.set(0, 1.6, 0);
    this.mesh.add(this.camPivot);
    this.camPivot.add(camera);
    this.camera = camera;

    this.vel = new THREE.Vector3();
    this.wish = new THREE.Vector3();
    this.onGround = true;

    this.yaw = 0;
    this.pitch = 0;

    this.hp = 100;
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

    const wishWorld = this.wish.clone()
      .normalize()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    const accel = this.onGround ? MOVE.GROUND_ACCEL : MOVE.AIR_ACCEL;
    this.vel.x += wishWorld.x * accel * dt;
    this.vel.z += wishWorld.z * accel * dt;

    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (spd > MOVE.MAX_SPEED) {
      this.vel.x *= MOVE.MAX_SPEED / spd;
      this.vel.z *= MOVE.MAX_SPEED / spd;
    }

    if (this.onGround) this.#friction(dt);

    if (this.onGround && jumpPressed) {
      this.vel.y = MOVE.JUMP_VEL;
      this.onGround = false;
    }

    this.vel.y -= MOVE.GRAVITY * dt;
    this.mesh.position.addScaledVector(this.vel, dt);

    if (this.mesh.position.y <= 1.4) {
      this.mesh.position.y = 1.4;
      this.vel.y = 0;
      this.onGround = true;
    }

    this.#resolveWalls(wallBoxes);
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
 * Has an hp bar and name tag, both true world-space billboards (Y-axis
 * rotation only) so they always face the camera without tilting oddly.
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

    this.targetPos = this.mesh.position.clone();
    this.targetYaw = 0;
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
    this.hp = state.hp;
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
  }

  dispose() {
    this.scene.remove(this.mesh, this.hpBar, this.nameSprite);
  }

  update(dt, camera) {
    const t = Math.min(1, dt * 12);
    this.mesh.position.lerp(this.targetPos, t);
    this.mesh.rotation.y += (this.targetYaw - this.mesh.rotation.y) * t;

    if (this.visible && this.hp > 0) {
      this.hpBar.position.copy(this.mesh.position);
      this.hpBar.position.y += 1.5;
      // Billboard on the Y axis only — keeps the bar upright and always
      // facing the camera left/right, without tilting when you look up/down.
      const dx = camera.position.x - this.hpBar.position.x;
      const dz = camera.position.z - this.hpBar.position.z;
      this.hpBar.rotation.y = Math.atan2(dx, dz);
      this.hpBar.scale.x = Math.max(this.hp / 100, 0);

      this.nameSprite.position.copy(this.mesh.position);
      this.nameSprite.position.y += 1.85;
    }
  }
}
