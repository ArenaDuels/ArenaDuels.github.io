// Player customization: the options on offer, saving/loading your choice,
// and building what other players see (body pattern + accessory).
//
// A "look" is { color, pattern, accessory }:
//   color      one of COLORS, or null = "Auto" (the usual assigned color). Only the Solid skin shows it on the body.
//   pattern    the skin: an id from SKINS (skins.js). Real texture images, unlocked by kills on your account.
//   accessory  id from ACCESSORIES

import * as THREE from "../vendor/three/three.module.min.js";
import { DEFAULT_SKIN, skinById, skinTextureUrl } from "./skins.js";

export const COLORS = [0xffffff, 0xff4d6a, 0x39ff88, 0xffd166, 0x9b5de5, 0x4cc9f0, 0xff8c42];

export const ACCESSORIES = [
  { id: "none", label: "None" },
  { id: "tophat", label: "Top hat" },
  { id: "crown", label: "Crown" },
  { id: "halo", label: "Halo" },
  { id: "antenna", label: "Antenna" },
  { id: "horns", label: "Devil horns" },
  { id: "shades", label: "Sunglasses" },
  { id: "party", label: "Party hat" },
  { id: "headphones", label: "Headphones" },
  { id: "wizard", label: "Wizard hat" },
  { id: "viking", label: "Viking helmet" },
  { id: "cowboy", label: "Cowboy hat" },
];

export const DEFAULT_LOOK = { color: null, pattern: DEFAULT_SKIN, accessory: "none" };

/* ---------- saving / loading / validating ---------- */

const KEY = "arenaduels-look";

// Anything that came from outside (localStorage, or another player over the
// network) goes through here so a bad value can never reach the renderer.
export function sanitizeLook(raw) {
  const out = { ...DEFAULT_LOOK };
  if (!raw || typeof raw !== "object") return out;
  if (raw.color === null || COLORS.includes(raw.color)) out.color = raw.color ?? null;
  if (skinById(raw.pattern)) out.pattern = raw.pattern; // old pattern ids (stripes, bands, dots) fall back to Solid
  if (ACCESSORIES.some((a) => a.id === raw.accessory)) out.accessory = raw.accessory;
  return out;
}

export function loadLook() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeLook(JSON.parse(raw)) : { ...DEFAULT_LOOK };
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export function saveLook(look) {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    /* storage unavailable — the choice still applies for this session */
  }
}

/* ---------- body skins ---------- */

// Static PNG skin textures are loaded once and shared by all player materials.
const skinCache = new Map(); // id -> { texture, failed, waiting: Set<material> }

function skinEntry(id) {
  let entry = skinCache.get(id);
  if (entry) return entry;
  entry = { texture: null, failed: false, waiting: new Set() };
  skinCache.set(id, entry);

  const image = new Image();
  image.onload = () => {
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Mirrored tiling hides seams, matching the original PNG skin maps.
    texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
    texture.repeat.set(2, 1);
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    entry.texture = texture;

    for (const material of entry.waiting) {
      if (material.userData.skin === id) {
        material.map = texture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
      }
    }
    entry.waiting.clear();
  };
  image.onerror = () => {
    entry.failed = true;
    entry.waiting.clear();
  };
  image.src = skinTextureUrl(id);
  return entry;
}

// Puts a skin on a capsule body material. Solid shows your color; every other skin shows its own image.
export function applyBodyLook(material, color, skinId) {
  const skin = skinById(skinId);
  const id = skin ? skin.id : DEFAULT_SKIN;
  material.userData.skin = id;
  if (id === DEFAULT_SKIN) {
    material.map = null;
    material.color.set(color);
  } else {
    const entry = skinEntry(id);
    if (entry.texture) {
      material.map = entry.texture;
      material.color.set(0xffffff); // the image carries its own colors
    } else {
      material.map = null;
      material.color.set(color); // plain color until the image arrives
      if (!entry.failed) entry.waiting.add(material);
    }
  }
  material.needsUpdate = true;
}

/* ---------- accessories ---------- */

// Positions are relative to the capsule's center; its head top is at y = 1.1
// and "forward" is -Z (same as the held gun).
export function buildAccessory(id, color) {
  if (!id || id === "none") return null;

  const g = new THREE.Group();
  const std = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.2, ...extra });
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  // Everything below is in HEAD space (the origin is the neck, the head turns around it):
  // the head is 0.8 wide, 0.58 deep and 0.44 tall, so its flat top is at y = T and the
  // visor on its front is at y = 0.22, z = -0.29. Keep these in step with ROBOT in player.js.
  const T = 0.44;

  switch (id) {
    case "tophat": {
      const black = std(0x15151a, { roughness: 0.35 });
      add(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 24), black, 0, T + 0.02, 0);         // brim
      add(new THREE.CylinderGeometry(0.26, 0.26, 0.4, 24), black, 0, T + 0.24, 0);        // crown
      add(new THREE.CylinderGeometry(0.27, 0.27, 0.08, 24), std(color), 0, T + 0.08, 0); // band
      break;
    }
    case "crown": {
      const gold = std(0xffc83d, { metalness: 0.7, roughness: 0.3 });
      add(new THREE.CylinderGeometry(0.26, 0.28, 0.12, 20), gold, 0, T + 0.05, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.06, 0.2, 8), gold, Math.cos(a) * 0.23, T + 0.2, Math.sin(a) * 0.23);
      }
      break;
    }
    case "halo": {
      const m = add(
        new THREE.TorusGeometry(0.3, 0.032, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0xffe066 }),
        0, T + 0.28, 0
      );
      m.rotation.x = Math.PI / 2;
      m.castShadow = false;
      break;
    }
    case "antenna": {
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 8), std(0x9aa0aa, { metalness: 0.6 }), 0, T + 0.2, 0);
      add(
        new THREE.SphereGeometry(0.065, 12, 12),
        std(color, { emissive: color, emissiveIntensity: 0.8 }),
        0, T + 0.42, 0
      );
      break;
    }
    case "horns": {
      // curved devil horns: a thick base and a thinner, more upright tip
      const red = std(0xc4202c, { roughness: 0.35 });
      const dark = std(0x5a0d14, { roughness: 0.4 });
      for (const side of [-1, 1]) {
        const base = add(new THREE.ConeGeometry(0.075, 0.22, 12), red, side * 0.3, T + 0.1, 0);
        base.rotation.z = -side * 0.75;
        const tip = add(new THREE.ConeGeometry(0.045, 0.2, 12), dark, side * 0.39, T + 0.25, 0);
        tip.rotation.z = -side * 0.3;
      }
      break;
    }
    case "shades": {
      // two glossy lenses with a frame, a bridge and arms that reach the sides of the head
      const frame = std(0x0b0b0f, { roughness: 0.25, metalness: 0.5 });
      const lens = std(0x111118, { roughness: 0.05, metalness: 0.8 });
      const shine = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
      for (const side of [-1, 1]) {
        add(new THREE.BoxGeometry(0.34, 0.2, 0.05), frame, side * 0.2, 0.22, -0.335);
        add(new THREE.BoxGeometry(0.29, 0.15, 0.06), lens, side * 0.2, 0.22, -0.34);
        const glint = add(new THREE.BoxGeometry(0.1, 0.025, 0.065), shine, side * 0.2 - 0.05, 0.27, -0.342);
        glint.castShadow = false;
        add(new THREE.BoxGeometry(0.03, 0.03, 0.3), frame, side * 0.405, 0.24, -0.18);
      }
      add(new THREE.BoxGeometry(0.1, 0.03, 0.05), frame, 0, 0.26, -0.335);
      break;
    }
    case "party": {
      // a striped cone: three white rings sit on it at heights where the cone's radius matches
      const cone = std(color);
      const white = std(0xffffff);
      const H = 0.55, R = 0.25;
      add(new THREE.ConeGeometry(R, H, 20), cone, 0, T + H / 2, 0);
      for (const h of [0.1, 0.24, 0.38]) {
        const ring = add(new THREE.TorusGeometry(R * (1 - h / H) + 0.004, 0.017, 8, 24), white, 0, T + h, 0);
        ring.rotation.x = Math.PI / 2;
      }
      add(new THREE.SphereGeometry(0.075, 12, 12), white, 0, T + H + 0.02, 0);
      break;
    }
    case "headphones": {
      // a band over the top and a cushioned cup on each side with a coloured ring
      const shell = std(0x1c1c22, { roughness: 0.4, metalness: 0.3 });
      const band = add(new THREE.TorusGeometry(0.43, 0.03, 8, 28, Math.PI), shell, 0, 0.22, 0);
      band.scale.y = 0.55;
      band.castShadow = false;
      for (const side of [-1, 1]) {
        const cup = add(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 22), shell, side * 0.45, 0.22, 0);
        cup.rotation.z = Math.PI / 2;
        const ring = add(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 22), std(color, { emissive: color, emissiveIntensity: 0.5 }), side * 0.51, 0.22, 0);
        ring.rotation.z = Math.PI / 2;
      }
      break;
    }
    case "wizard": {
      const robe = std(0x3a2a7c, { roughness: 0.7 });
      const gold = std(0xffc83d, { metalness: 0.6, roughness: 0.35 });
      add(new THREE.CylinderGeometry(0.46, 0.46, 0.03, 28), robe, 0, T + 0.015, 0);       // brim
      add(new THREE.ConeGeometry(0.28, 0.46, 24), robe, 0, T + 0.26, 0);                 // lower cone
      const tip = add(new THREE.ConeGeometry(0.16, 0.38, 20), robe, 0.07, T + 0.62, 0);  // bent tip
      tip.rotation.z = -0.35;
      const band = add(new THREE.CylinderGeometry(0.285, 0.285, 0.06, 24), gold, 0, T + 0.07, 0);
      band.castShadow = false;
      add(new THREE.OctahedronGeometry(0.045), std(color, { emissive: color, emissiveIntensity: 0.6 }), 0, T + 0.4, -0.2); // star gem
      break;
    }
    case "viking": {
      const steel = std(0x9aa3b0, { metalness: 0.8, roughness: 0.35 });
      const bone = std(0xf1e6cf, { roughness: 0.5 });
      add(new THREE.SphereGeometry(0.34, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2), steel, 0, T - 0.02, 0).scale.set(1.12, 0.8, 0.95);
      add(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 24), steel, 0, T + 0.0, 0);          // rim
      const nose = add(new THREE.BoxGeometry(0.06, 0.2, 0.04), steel, 0, 0.3, -0.32);     // nose guard
      nose.castShadow = false;
      for (const side of [-1, 1]) {
        const base = add(new THREE.ConeGeometry(0.075, 0.26, 12), bone, side * 0.416, T + 0.159, 0);
        base.rotation.z = -side * 1.1;
        const tip = add(new THREE.ConeGeometry(0.045, 0.2, 12), bone, side * 0.575, T + 0.308, 0);
        tip.rotation.z = -side * 0.45;
      }
      break;
    }
    case "cowboy": {
      const felt = std(0x8a5a2b, { roughness: 0.85 });
      const dark = std(0x3b2412, { roughness: 0.7 });
      const brim = add(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 30), felt, 0, T + 0.015, 0);
      brim.scale.z = 0.92;
      const crown = add(new THREE.CylinderGeometry(0.2, 0.27, 0.27, 22), felt, 0, T + 0.165, 0);
      crown.scale.z = 0.9;
      add(new THREE.BoxGeometry(0.2, 0.05, 0.1), felt, 0, T + 0.3, 0);                    // the dent on top
      add(new THREE.CylinderGeometry(0.275, 0.275, 0.06, 24), dark, 0, T + 0.07, 0).scale.z = 0.9; // hat band
      for (const side of [-1, 1]) {                                                         // curled-up sides
        const curl = add(new THREE.BoxGeometry(0.1, 0.03, 0.3), felt, side * 0.47, T + 0.05, 0);
        curl.rotation.z = side * 0.35;
        curl.castShadow = false;
      }
      break;
    }
    default:
      return null;
  }
  return g;
}

export function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}
