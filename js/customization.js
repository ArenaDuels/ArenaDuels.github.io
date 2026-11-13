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
  { id: "horns", label: "Horns" },
  { id: "antenna", label: "Antenna" },
  { id: "shades", label: "Shades" },
  { id: "party", label: "Party hat" },
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

// One entry per skin image, made the first time someone wears it. The image loads in the background;
// until it arrives the body shows the plain color, and every material waiting on it is updated.
const skinCache = new Map(); // id -> { texture, failed, waiting: Set<material> }
const loader = new THREE.TextureLoader();

function skinEntry(id) {
  let entry = skinCache.get(id);
  if (entry) return entry;
  entry = { texture: null, failed: false, waiting: new Set() };
  skinCache.set(id, entry);
  loader.load(
    skinTextureUrl(id),
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      // Mirrored tiling hides the seams (these images aren't built to tile). Twice around the body is an
      // even count, so the seam at the back of the body is continuous too. Once along it: the body is
      // about as tall as one tile is wide.
      tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
      tex.repeat.set(2, 1);
      tex.anisotropy = 4;
      entry.texture = tex;
      for (const m of entry.waiting) {
        if (m.userData.skin === id) {
          m.map = tex;
          m.color.set(0xffffff);
          m.needsUpdate = true;
        }
      }
      entry.waiting.clear();
    },
    undefined,
    () => {
      entry.failed = true; // keep showing the plain color
      entry.waiting.clear();
    }
  );
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
    case "horns": {
      const red = std(0xd0222d, { roughness: 0.4 });
      const l = add(new THREE.ConeGeometry(0.08, 0.34, 10), red, -0.27, T + 0.13, 0);
      l.rotation.z = 0.45;
      const r = add(new THREE.ConeGeometry(0.08, 0.34, 10), red, 0.27, T + 0.13, 0);
      r.rotation.z = -0.45;
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
    case "shades": {
      // a bar across the visor, just in front of the eyes
      add(
        new THREE.BoxGeometry(0.72, 0.16, 0.08),
        std(0x0b0b0f, { roughness: 0.1, metalness: 0.5 }),
        0, 0.22, -0.35
      );
      break;
    }
    case "party": {
      add(new THREE.ConeGeometry(0.25, 0.55, 18), std(color), 0, T + 0.27, 0);
      add(new THREE.SphereGeometry(0.07, 10, 10), std(0xffffff), 0, T + 0.57, 0);
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
