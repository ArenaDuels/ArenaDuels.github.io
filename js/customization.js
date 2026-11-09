// Player customization: the options on offer, saving/loading your choice,
// and building what other players see (body pattern + accessory).
//
// A "look" is { color, pattern, accessory }:
//   color      one of COLORS, or null = "Auto" (the usual assigned color)
//   pattern    id from PATTERNS
//   accessory  id from ACCESSORIES

import * as THREE from "../vendor/three/three.module.min.js";

export const COLORS = [0xffffff, 0xff4d6a, 0x39ff88, 0xffd166, 0x9b5de5, 0x4cc9f0, 0xff8c42];

// Each id doubles as the icon name in icons.js.
export const PATTERNS = [
  { id: "solid", label: "Solid" },
  { id: "stripes", label: "Stripes" },
  { id: "bands", label: "Bands" },
  { id: "dots", label: "Dots" },
  { id: "checker", label: "Checker" },
];

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

export const DEFAULT_LOOK = { color: null, pattern: "solid", accessory: "none" };

/* ---------- saving / loading / validating ---------- */

const KEY = "arenaduels-look";

// Anything that came from outside (localStorage, or another player over the
// network) goes through here so a bad value can never reach the renderer.
export function sanitizeLook(raw) {
  const out = { ...DEFAULT_LOOK };
  if (!raw || typeof raw !== "object") return out;
  if (raw.color === null || COLORS.includes(raw.color)) out.color = raw.color ?? null;
  if (PATTERNS.some((p) => p.id === raw.pattern)) out.pattern = raw.pattern;
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

/* ---------- body pattern ---------- */

const textureCache = new Map();

// Draws the pattern on a canvas in the chosen color (the capsule's UVs run
// around the body horizontally and along its length vertically).
function patternTexture(patternId, color) {
  const key = `${patternId}:${color}`;
  if (textureCache.has(key)) return textureCache.get(key);

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const base = new THREE.Color(color);
  const dark = base.clone().multiplyScalar(0.4);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = `#${dark.getHexString()}`;

  if (patternId === "stripes") {
    for (let i = 1; i < 8; i += 2) ctx.fillRect((i * size) / 8, 0, size / 8, size);
  } else if (patternId === "bands") {
    for (let i = 1; i < 8; i += 2) ctx.fillRect(0, (i * size) / 8, size, size / 8);
  } else if (patternId === "checker") {
    const n = 8;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if ((x + y) % 2) ctx.fillRect((x * size) / n, (y * size) / n, size / n, size / n);
      }
    }
  } else if (patternId === "dots") {
    const n = 4;
    const cell = size / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        ctx.beginPath();
        ctx.arc((x + 0.5 + (y % 2 ? 0.5 : 0)) * cell, (y + 0.5) * cell, cell * 0.26, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  textureCache.set(key, tex);
  return tex;
}

// Applies color + pattern to a capsule body material.
export function applyBodyLook(material, color, patternId) {
  if (patternId === "solid") {
    material.map = null;
    material.color.set(color);
  } else {
    material.map = patternTexture(patternId, color);
    material.color.set(0xffffff); // the texture already carries the color
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
