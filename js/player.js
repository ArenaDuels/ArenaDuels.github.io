import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { applyBodyLook, buildAccessory, disposeGroup } from "./customization.js";
import { cleanBody, cleanName } from "./validate.js";

// ===== Movement tuning =====
// Ground movement stays responsive, while jumping preserves the same vertical
// impulse and gravity but reduces horizontal launch speed and air steering.
export const MOVE = {
  GROUND_ACCEL: 14,
  WISH_SPEED: 16,
  AIR_WISH_SPEED: 7.5,
  AIR_ACCEL: 3.0,
  AIR_LAUNCH_MULTIPLIER: 0.72,
  AIR_MAX_SPEED: 10.5,
  MAX_SPEED_SANITY: 45,
  FRICTION: 8,
  GRAVITY: 35,
  JUMP_VEL: 12,
  RADIUS: 0.5,
  // The capsule (CapsuleGeometry(0.5, 1.2, ...)) is 2.2 units tall total
  // and centered on its own position, so its "head" top is 1.1 above
  // center. This puts the camera right around eye level on that head,
  // not floating above it.
  EYE_HEIGHT: 1.0,
};

// Match-wide values the host can change (Match Settings). Health bars and
// respawns read maxHp from here so everyone agrees on what "full" means.
export const GAME = { maxHp: 100 };

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

// A simple low-poly first-person gun viewmodel, parented to the camera so
// it stays fixed in screen space (bottom-right) exactly like a real FPS
// weapon. Returns the group (to attach) and a muzzle Object3D whose real
// WORLD position we use as the laser's true visual origin — genuine
// parallax from an actual point in the scene, not an approximated offset.
// Builds the gun mesh itself — body/barrel/grip/muzzle — without any
// position/rotation applied, so callers can place it differently depending
// on context: as a first-person viewmodel (child of the camera) or as a
// third-person "held gun" visible to other players (child of the capsule).
// ---------------------------------------------------------------------------
// The ARC RIFLE. One model, used first-person (child of the camera) and
// third-person (held by other players' capsules). Forward is -Z.
//
//   receiver + rail + battery pack, a shrouded barrel with three glowing
//   energy coils, an emitter nozzle with a glowing lens, power strips on
//   the sides, a grip, foregrip and sights.
//
// Everything that glows shares the player's colour (so it recolours with
// setGunColor), and animateGun() makes the coils chase along the barrel and
// the lens flare when firing.
// ---------------------------------------------------------------------------
let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

function makeGunModel(color) {
  const group = new THREE.Group();

  // (Metalness is kept modest on purpose: there's no environment map to
  // reflect, so high-metal parts would render nearly black.)
  const gunmetal = new THREE.MeshStandardMaterial({ color: 0x5d6676, roughness: 0.48, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.6, metalness: 0.25 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc2c9d6, roughness: 0.35, metalness: 0.45 });
  const glow = () =>
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.1 });

  const mats = []; // every glowing material, for recolouring/animation
  const accentMat = glow();
  mats.push(accentMat);

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // receiver, top rail, battery pack, rear cap
  add(box(0.11, 0.13, 0.36), gunmetal, 0, 0, -0.02);
  add(box(0.075, 0.03, 0.3), dark, 0, 0.08, -0.02);
  add(box(0.1, 0.115, 0.15), gunmetal, 0, -0.005, 0.2);
  add(box(0.085, 0.09, 0.02), dark, 0, -0.005, 0.285);
  // charge window on top of the receiver
  add(box(0.04, 0.012, 0.13), accentMat, 0, 0.099, -0.03);
  // glowing power strips down both sides
  add(box(0.006, 0.026, 0.2), accentMat, 0.058, 0.012, 0.0);
  add(box(0.006, 0.026, 0.2), accentMat, -0.058, 0.012, 0.0);
  add(box(0.006, 0.05, 0.07), accentMat, 0.052, -0.005, 0.2);
  add(box(0.006, 0.05, 0.07), accentMat, -0.052, -0.005, 0.2);
  // vents
  for (let i = 0; i < 3; i++) {
    add(box(0.114, 0.012, 0.022), dark, 0, 0.02 - i * 0.026, 0.115 - 0.0 + i * 0.0);
  }

  // shrouded barrel
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.46, 12), steel, 0, 0.012, -0.43, Math.PI / 2, 0, 0);
  // open frame (a top and bottom rail) so the coils stay visible
  add(box(0.03, 0.012, 0.3), gunmetal, 0, 0.064, -0.4);
  add(box(0.03, 0.012, 0.3), gunmetal, 0, -0.04, -0.4);
  for (let i = 0; i < 3; i++) {
    add(box(0.016, 0.11, 0.014), dark, 0, 0.012, -0.29 - i * 0.1);
  }

  // three energy coils that light up one after another when firing
  const coils = [];
  for (let i = 0; i < 3; i++) {
    const mat = glow();
    mats.push(mat);
    const coil = add(new THREE.TorusGeometry(0.036, 0.011, 8, 18), mat, 0, 0.012, -0.34 - i * 0.1);
    coil.userData.mat = mat;
    coils.push(coil);
  }

  // emitter nozzle + lens
  add(new THREE.CylinderGeometry(0.015, 0.032, 0.07, 14), steel, 0, 0.012, -0.665, Math.PI / 2, 0, 0);
  const lensMat = glow();
  lensMat.emissiveIntensity = 1.6;
  mats.push(lensMat);
  add(new THREE.SphereGeometry(0.019, 12, 10), lensMat, 0, 0.012, -0.705);

  // grip, trigger guard, foregrip, sights
  add(box(0.07, 0.17, 0.09), dark, 0, -0.135, 0.09, 0.32, 0, 0);
  add(box(0.014, 0.02, 0.07), gunmetal, 0, -0.08, -0.04);
  add(box(0.014, 0.05, 0.014), gunmetal, 0, -0.1, -0.075);
  add(box(0.06, 0.085, 0.11), dark, 0, -0.09, -0.22, -0.12, 0, 0);
  add(box(0.012, 0.03, 0.014), steel, 0, 0.11, -0.2);
  add(box(0.03, 0.026, 0.012), steel, 0, 0.105, 0.1);

  // muzzle point (beam origin) and a flash sprite on it
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -0.74);
  group.add(muzzle);

  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getGlowTexture(), color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    })
  );
  flash.renderOrder = 1001;
  flash.visible = false;
  muzzle.add(flash);

  group.userData.accentMat = accentMat;
  group.userData.fx = { mats, coils, lensMat, accentMat, flash, baseZ: 0, baseRotX: 0, baseY: 0 };
  return { group, muzzle };
}

/** Recolour everything on the gun that glows (and the muzzle flash). */
export function setGunColor(group, color) {
  const fx = group.userData.fx;
  for (const m of fx.mats) {
    m.color.set(color);
    m.emissive.set(color);
  }
  fx.flash.material.color.set(color);
}

/** Per-frame gun animation: idle shimmer, firing pulse, flash and recoil. */
export function animateGun(group, firing, t, viewmodel = false) {
  const fx = group.userData.fx;
  fx.accentMat.emissiveIntensity = firing ? 1.5 + 0.5 * Math.sin(t * 55) : 0.6 + 0.12 * Math.sin(t * 2.2);
  for (let i = 0; i < fx.coils.length; i++) {
    const m = fx.coils[i].userData.mat;
    m.emissiveIntensity = firing
      ? 1.2 + 1.6 * Math.max(0, Math.sin(t * 38 - i * 1.5))
      : 0.3 + 0.12 * Math.sin(t * 2.2 - i * 0.8);
  }
  fx.lensMat.emissiveIntensity = firing ? 2.4 + 0.8 * Math.sin(t * 70) : 1.2;
  fx.flash.visible = firing;
  if (firing) {
    fx.flash.material.opacity = 0.55 + 0.4 * Math.abs(Math.sin(t * 83));
    fx.flash.scale.setScalar(viewmodel ? 0.2 + 0.08 * Math.abs(Math.sin(t * 61)) : 0.35 + 0.12 * Math.abs(Math.sin(t * 61)));
  }
  if (viewmodel) {
    group.position.z = fx.baseZ + (firing ? 0.016 + 0.008 * Math.sin(t * 72) : 0);
    group.position.y = fx.baseY + (firing ? 0.004 * Math.sin(t * 91) : 0);
    group.rotation.x = fx.baseRotX + (firing ? 0.012 + 0.008 * Math.sin(t * 66) : 0);
  }
}

// First-person viewmodel: fixed in the bottom-right of the screen, no
// shadows (casting a shadow of your own gun onto your own view looks odd),
// not affected by frustum culling so it never disappears at extreme angles.
function makeFirstPersonGun(color) {
  const { group, muzzle } = makeGunModel(color);
  group.renderOrder = 1000;
  group.scale.setScalar(0.74);
  group.position.set(0.23, -0.2, -0.4);
  group.rotation.y = -0.05;
  group.rotation.x = 0.01;
  group.userData.fx.baseZ = group.position.z;
  group.userData.fx.baseY = group.position.y;
  group.userData.fx.baseRotX = group.rotation.x;
  group.traverse((o) => {
    if (o.isMesh || o.isSprite) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.frustumCulled = false;
    }
  });
  return { group, muzzle };
}

// Third-person "held gun" visible to other players — attached to the
// capsule body, positioned like it's held out in front, rotates with
// whichever way the capsule is facing since it's a child of that mesh.
function makeHeldGun(color) {
  const { group } = makeGunModel(color);
  // Capsule radius is 0.5 — the attachment point has to clear that or the
  // gun renders embedded in the body instead of held beside it.
  group.position.set(0.62, 0.05, -0.15);
  group.rotation.y = -0.12;
  group.scale.setScalar(1.25); // reads better at typical view distance
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

// ===== The beam. A hot white core, a coloured glow around it, a soft outer
// haze, a crackling arc that jitters every frame, and a flare where it hits.
// (Built from cylinders because THREE.Line is capped at ~1px on most GPUs.)
// Shared by the local player's beam and every RemotePlayer's beam. =====
const BEAM_SEGMENTS = 18;
const beamGeometry = new THREE.CylinderGeometry(1, 0.18, 1, 10, 1, true); // tapers to a point at the muzzle

function additive(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
}

export function makeLaserMesh(color) {
  const beam = new THREE.Group();
  beam.visible = false;

  const part = (material, radius) => {
    const m = new THREE.Mesh(beamGeometry, material);
    m.userData.radius = radius;
    m.frustumCulled = false;
    beam.add(m);
    return m;
  };
  const core = part(additive(0xffffff, 0.95), 0.02);
  const glow = part(additive(color, 0.5), 0.065);
  const haze = part(additive(color, 0.16), 0.13);

  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((BEAM_SEGMENTS + 1) * 3), 3));
  const arc = new THREE.Line(
    arcGeo,
    new THREE.LineBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  );
  arc.frustumCulled = false;
  beam.add(arc);

  const flare = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getGlowTexture(), color, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    })
  );
  flare.frustumCulled = false;
  beam.add(flare);

  beam.userData = { core, glow, haze, arc, flare, color };
  return beam;
}

export function setLaserColor(beam, color) {
  const u = beam.userData;
  u.glow.material.color.set(color);
  u.haze.material.color.set(color);
  u.flare.material.color.set(color);
  u.color = color;
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
/**
 * Stretch the beam from `origin` to `end`. `hit` = it ends on something
 * solid (so draw the impact flare); `t` is the time in seconds for the
 * flicker.
 */
export function aimLaser(beam, origin, end, hit = true, t = performance.now() / 1000) {
  _dir.subVectors(end, origin);
  const len = _dir.length();
  if (len < 0.001) {
    beam.visible = false;
    return;
  }
  _dir.divideScalar(len);
  beam.position.copy(origin);
  beam.quaternion.setFromUnitVectors(UP_AXIS, _dir);

  const u = beam.userData;
  const pulse = 1 + 0.16 * Math.sin(t * 70) + 0.09 * Math.sin(t * 113.7);
  for (const m of [u.core, u.glow, u.haze]) {
    const r = m.userData.radius * pulse;
    m.scale.set(r, len, r);
    m.position.set(0, len / 2, 0);
  }

  // jittering arc: pinned at both ends, wobbling in between
  const pos = u.arc.geometry.attributes.position;
  const amp = Math.min(0.14, 0.03 + len * 0.004);
  for (let i = 0; i <= BEAM_SEGMENTS; i++) {
    const s = i / BEAM_SEGMENTS;
    const edge = Math.sin(Math.PI * s);
    pos.setXYZ(i, (Math.random() - 0.5) * amp * edge, s * len, (Math.random() - 0.5) * amp * edge);
  }
  pos.needsUpdate = true;

  u.flare.visible = hit;
  if (hit) {
    u.flare.position.set(0, Math.max(0, len - 0.1), 0);
    u.flare.scale.setScalar(0.55 + 0.25 * Math.abs(Math.sin(t * 57)));
  }
  beam.visible = true;
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

    // The camera lives under its own root, separate from the physics body
    // (this.mesh). Physics moves in fixed timesteps that don't line up
    // perfectly with however often the display actually renders — without
    // this separation, the camera would inherit that fixed-step motion
    // directly and visibly stutter/judder on displays whose refresh rate
    // doesn't evenly divide the physics rate (i.e. almost all of them).
    // Instead we interpolate viewRoot's position between the last two
    // physics states each render frame (see interpolateView below), so
    // motion looks perfectly smooth regardless of display Hz.
    this.viewRoot = new THREE.Object3D();
    scene.add(this.viewRoot);

    this.camPivot = new THREE.Object3D();
    this.camPivot.position.set(0, MOVE.EYE_HEIGHT, 0);
    this.viewRoot.add(this.camPivot);
    this.camPivot.add(camera);
    this.camera = camera;

    const { group: gunGroup, muzzle } = makeFirstPersonGun(color);
    camera.add(gunGroup);
    this.gunGroup = gunGroup;
    this.gunAccent = gunGroup.userData.accentMat;
    this.gunMuzzle = muzzle;

    this.vel = new THREE.Vector3();
    this.wish = new THREE.Vector3();
    this.onGround = true;

    this.yaw = 0;
    this.pitch = 0;

    this.hp = GAME.maxHp;
    this.firing = false;

    this.prevPos = this.mesh.position.clone();
  }

  spawn(spawnPoint) {
    this.mesh.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    this.viewRoot.position.copy(this.mesh.position);
    this.prevPos.copy(this.mesh.position);
    this.yaw = spawnPoint.yaw || 0;
    this.pitch = 0;
    this.vel.set(0, 0, 0);
    this.hp = GAME.maxHp;
  }

  // Recolors the first-person gun's glowing parts (your own body is never
  // visible to you, so the gun is the only thing that shows your color).
  setColor(color) {
    setGunColor(this.gunGroup, color);
  }

  // Idle shimmer / firing pulse / muzzle flash / recoil on the viewmodel.
  updateGunFx(firing, seconds) {
    animateGun(this.gunGroup, firing, seconds, true);
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

  // Proper 3D collision: finds the highest surface (a box-top, or the
  // world floor) below the player that they're over, and rests them on
  // it — not just the single hardcoded ground height like before. This is
  // what makes stairs and multi-level platforms actually work: each step
  // is just a slightly higher box, and walking into its footprint lets you
  // step up onto it. Side-collision (getting blocked by a wall/step from
  // the side) only applies to boxes whose top is still above you — once
  // you're standing at or above a box's top, its footprint stops blocking
  // you sideways, so you can walk across its surface and off the edge.
  #resolveCollision(wallBoxes) {
    const STEP_TOLERANCE = 0.5; // how much higher than your current feet a surface can be and still auto step-up
    const STAND_MARGIN = MOVE.RADIUS * 0.6; // lets your capsule center be slightly past a box's edge and still count as "on" it
    const REST_OFFSET = 1.4; // established convention: capsule center sits this far above whatever it's resting on
    const feetLevel = this.mesh.position.y - REST_OFFSET;

    let surfaceTopY = 0; // world floor
    for (const box of wallBoxes) {
      const overX = this.mesh.position.x > box.min.x - STAND_MARGIN && this.mesh.position.x < box.max.x + STAND_MARGIN;
      const overZ = this.mesh.position.z > box.min.z - STAND_MARGIN && this.mesh.position.z < box.max.z + STAND_MARGIN;
      if (overX && overZ) {
        if (box.max.y <= feetLevel + STEP_TOLERANCE && box.max.y > surfaceTopY) {
          surfaceTopY = box.max.y;
        }
      }
    }
    const restY = surfaceTopY + REST_OFFSET;

    if (this.mesh.position.y <= restY) {
      this.mesh.position.y = restY;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // Small margin beyond the exact radius — without it, a resting position
    // exactly tangent to a wall is a floating-point-unstable boundary that
    // can flicker between "colliding" and "not colliding" frame to frame,
    // which reads as camera stutter since the camera is attached to it.
    // A block stops you sideways whenever its top is more than a step above
    // your FEET. (This used to compare against the capsule centre, which sits
    // 1.4 higher — so jumping at the side or corner of a block let the lower
    // half of your body pass straight through it.) Run twice so being pushed
    // out of one block can't leave you inside the neighbouring one.
    const pushRadius = MOVE.RADIUS + 0.01;
    const p = this.mesh.position;
    for (let pass = 0; pass < 2; pass++) {
      const feet = p.y - REST_OFFSET;
      for (const box of wallBoxes) {
        if (box.max.y <= feet + STEP_TOLERANCE) continue; // low enough to step/land on — not a wall right now
        const cx = Math.max(box.min.x, Math.min(p.x, box.max.x));
        const cz = Math.max(box.min.z, Math.min(p.z, box.max.z));
        let dx = p.x - cx;
        let dz = p.z - cz;
        const dist2 = dx * dx + dz * dz;
        if (dist2 >= pushRadius * pushRadius) continue;
        if (dist2 < 1e-8) {
          // The centre is inside the block (no direction to push along) — leave through the nearest side.
          const left = p.x - box.min.x, right = box.max.x - p.x;
          const front = p.z - box.min.z, back = box.max.z - p.z;
          const m = Math.min(left, right, front, back);
          if (m === left) p.x = box.min.x - pushRadius;
          else if (m === right) p.x = box.max.x + pushRadius;
          else if (m === front) p.z = box.min.z - pushRadius;
          else p.z = box.max.z + pushRadius;
        } else {
          const dist = Math.sqrt(dist2);
          const push = pushRadius - dist;
          p.x += (dx / dist) * push;
          p.z += (dz / dist) * push;
        }
      }
    }
  }

  // Applies mouse-look rotation. Called every render frame (not tied to
  // the fixed physics step below) so aiming stays maximally smooth at
  // whatever refresh rate the display actually runs at.
  updateLook() {
    this.viewRoot.rotation.y = this.yaw;
    this.camPivot.rotation.x = this.pitch;
  }

  // Smoothly places viewRoot somewhere between the physics body's previous
  // and current position, based on how far into the *next* (not yet run)
  // physics step we currently are. Called once per render frame, after
  // any physics steps for that frame have run. This is what actually
  // eliminates the stutter — physics stepping alone only makes each
  // individual step consistent, it doesn't make the steps line up with
  // however often the screen redraws.
  interpolateView(alpha) {
    this.viewRoot.position.lerpVectors(this.prevPos, this.mesh.position, alpha);
  }

  // Physics/movement — called with a FIXED dt from a timestep accumulator
  // in main.js, not the raw variable render-frame time. Real frame timing
  // is never perfectly steady (a frame that runs a hair long or short
  // makes that single frame's movement visibly bigger/smaller than its
  // neighbors), which is what caused the intermittent stutter. A fixed
  // timestep makes every physics step identical regardless of actual
  // frame timing, eliminating that as a source of jitter.
  updatePhysics(dt, wallBoxes, jumpPressed) {
    this.prevPos.copy(this.mesh.position);

    const wishDir = this.wish.clone();
    const hasInput = wishDir.lengthSq() > 0.0001;
    if (hasInput) {
      wishDir.normalize().applyAxisAngle(UP_AXIS, this.yaw);
    }

    if (this.onGround) {
      this.#friction(dt);
      if (hasInput) this.#accelerate(wishDir, MOVE.WISH_SPEED, MOVE.GROUND_ACCEL, dt);
    } else if (hasInput) {
      // Limited air acceleration: steering changes momentum gradually rather
      // than snapping the player to a new direction every frame.
      this.#accelerate(wishDir, MOVE.AIR_WISH_SPEED, MOVE.AIR_ACCEL, dt);
    }

    // Keep the airborne horizontal speed below normal running speed. This
    // reduces jump distance and prevents repeated air-strafing speed gain.
    if (!this.onGround) {
      const airSpeed = Math.hypot(this.vel.x, this.vel.z);
      if (airSpeed > MOVE.AIR_MAX_SPEED) {
        this.vel.x *= MOVE.AIR_MAX_SPEED / airSpeed;
        this.vel.z *= MOVE.AIR_MAX_SPEED / airSpeed;
      }
    }

    // Safety cap for invalid/extreme values.
    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (spd > MOVE.MAX_SPEED_SANITY) {
      this.vel.x *= MOVE.MAX_SPEED_SANITY / spd;
      this.vel.z *= MOVE.MAX_SPEED_SANITY / spd;
    }

    if (this.onGround && jumpPressed) {
      // Reduce horizontal launch speed only. JUMP_VEL and GRAVITY stay
      // unchanged, so the jump reaches the same height as before.
      this.vel.x *= MOVE.AIR_LAUNCH_MULTIPLIER;
      this.vel.z *= MOVE.AIR_LAUNCH_MULTIPLIER;
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
      this.#resolveCollision(wallBoxes);
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
      tp: this.tp || 0, // the last server-ordered move we've heard about (see "correct"/"respawn")
    };
  }

  // The server moved us (it didn't accept where we said we were): go there and stop.
  teleportTo(x, y, z) {
    this.mesh.position.set(x, y, z);
    this.prevPos.copy(this.mesh.position);
    this.viewRoot.position.copy(this.mesh.position);
    this.vel.set(0, 0, 0);
  }

  // Returns true if this hit was the killing blow.
  takeDamage(amount) {
    const wasAlive = this.hp > 0;
    this.hp = Math.max(0, this.hp - amount);
    return wasAlive && this.hp <= 0;
  }

  heal(amount) {
    if (this.hp > 0) this.hp = Math.min(GAME.maxHp, this.hp + amount);
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

    // Visible to everyone else, unlike the local player's own first-person
    // viewmodel — attached to the capsule body so it turns with them.
    this.heldGun = makeHeldGun(color);
    this.mesh.add(this.heldGun);

    this.name = name;
    this.hp = GAME.maxHp;
    this.displayHp = GAME.maxHp; // visual-only health value, eased toward authoritative health
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

    this.accessory = null;
    this.accessoryKey = "";
    this.displayColor = color;
  }

  // Apply a player's chosen look (color / body pattern / accessory).
  // `look.color` of null means "Auto" — use the color they were assigned.
  setLook(look, defaultColor) {
    const color = look.color ?? defaultColor;
    this.displayColor = color;

    applyBodyLook(this.mesh.material, color, look.pattern);

    setGunColor(this.heldGun, color);
    setLaserColor(this.laser, color);

    const key = `${look.accessory}:${color}`;
    if (key !== this.accessoryKey) {
      if (this.accessory) {
        this.mesh.remove(this.accessory);
        disposeGroup(this.accessory);
        this.accessory = null;
      }
      this.accessory = buildAccessory(look.accessory, color);
      if (this.accessory) this.mesh.add(this.accessory);
      this.accessoryKey = key;
    }
  }

  setName(name) {
    this.name = cleanName(name);
    this.nameSprite.userData.setText(this.name); // drawn on a canvas — never parsed as HTML
  }

  spawn(spawnPoint) {
    this.mesh.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    this.targetPos.copy(this.mesh.position);
    this.targetYaw = spawnPoint.yaw || 0;
    this.hp = GAME.maxHp;
    this.setVisible(true);
  }

  // Call this whenever a network snapshot arrives.
  applyNetState(raw) {
    const state = cleanBody(raw); // finite, range-checked numbers only
    if (!state) return;
    this.targetPos.set(state.x, state.y, state.z);
    this.targetYaw = state.yaw;
    this.targetPitch = state.pitch;
    this.hp = state.hp; // authoritative health; never use a visual value for gameplay
    // Apply each network health snapshot immediately. This avoids a separate
    // client-side easing value lagging behind or appearing to freeze/catch up.
    this.displayHp = state.hp;
    this.hpBar.scale.x = 1.2 * Math.min(1, Math.max(state.hp / GAME.maxHp, 0));
    this.firing = state.firing;
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
    if (this.accessory) {
      this.mesh.remove(this.accessory);
      disposeGroup(this.accessory);
      this.accessory = null;
    }
  }

  update(dt, camera) {
    const t = Math.min(1, dt * 12);
    this.mesh.position.lerp(this.targetPos, t);
    this.mesh.rotation.y += (this.targetYaw - this.mesh.rotation.y) * t;

    if (this.visible && this.hp > 0) {
      this.hpBar.position.copy(this.mesh.position);
      this.hpBar.position.y += 1.5;
      // Keep the bar tied directly to the latest authoritative snapshot.
      this.hpBar.scale.x = 1.2 * Math.min(1, Math.max(this.hp / GAME.maxHp, 0));

      this.nameSprite.position.copy(this.mesh.position);
      this.nameSprite.position.y += 1.85;

      if (this.firing) {
        const origin = this.mesh.position.clone();
        origin.y += MOVE.EYE_HEIGHT - 1.4; // mesh position is feet-ish; eye is higher
        const dir = dirFromYawPitch(this.targetYaw, this.targetPitch);
        const end = origin.clone().addScaledVector(dir, 50);
        aimLaser(this.laser, origin, end, false);
      } else {
        this.laser.visible = false;
      }
      animateGun(this.heldGun, this.firing, performance.now() / 1000);
    }
  }
}
