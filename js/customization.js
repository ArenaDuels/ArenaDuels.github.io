// Player customization: the options on offer, saving/loading your choice,
// and building what other players see (body pattern + accessory).
//
// A "look" is { color, pattern, accessory }:
//   color      one of COLORS, or null = "Auto" (the usual assigned color)
//   pattern    id from PATTERNS
//   accessory  id from ACCESSORIES

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

export const COLORS = [0xffffff, 0xff4d6a, 0x39ff88, 0xffd166, 0x9b5de5, 0x4cc9f0, 0xff8c42];

// Each id doubles as the icon name in icons.js.
export const PATTERNS = [
  { id: "solid", label: "Solid" },
  { id: "neon", label: "Neon" },
  { id: "galaxy", label: "Galaxy" },
  { id: "fire", label: "Fire" },
  { id: "ice", label: "Ice" },
  { id: "camo", label: "Camo" },
  { id: "digital", label: "Digital" },
  { id: "lava", label: "Lava" },
  { id: "rainbow", label: "Rainbow" },
  { id: "gold", label: "Gold" },
  { id: "glitch", label: "Glitch" },
  { id: "carbon", label: "Carbon" },
  // Keep older saved choices valid for existing players.
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

/* ---------- full-surface character skins ---------- */

// Every non-solid skin is a self-coloured albedo texture. The selected player
// colour is deliberately NOT multiplied into these maps, so a skin fully
// replaces the body colour instead of merely tinting it.
const textureCache = new Map();
function patternTexture(patternId) {
  if (textureCache.has(patternId)) return textureCache.get(patternId);

  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = (stops, x0=0, y0=0, x1=size, y1=size) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [at, color] of stops) g.addColorStop(at, color);
    return g;
  };
  const seeded = (seed) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const rand = seeded(patternId.split("").reduce((a,c)=>a+c.charCodeAt(0), 17));

  if (patternId === "neon") {
    ctx.fillStyle = "#080d20"; ctx.fillRect(0,0,size,size);
    ctx.strokeStyle = "#00eaff"; ctx.lineWidth = 8; ctx.shadowColor = "#00cfff"; ctx.shadowBlur = 18;
    for (let x=24; x<size; x+=96) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,120); ctx.lineTo(x+28,150); ctx.lineTo(x+28,340); ctx.lineTo(x+58,370); ctx.lineTo(x+58,size); ctx.stroke(); }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(190,250,255,.65)"; ctx.lineWidth=2;
    for(let y=36;y<size;y+=64){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(size,y);ctx.stroke();}
  } else if (patternId === "galaxy") {
    ctx.fillStyle = grad([[0,"#090b2c"],[.45,"#38106b"],[.7,"#071b4a"],[1,"#08091c"]],0,0,size,size); ctx.fillRect(0,0,size,size);
    for(let i=0;i<16;i++){ctx.fillStyle=`rgba(${80+Math.floor(rand()*150)},${30+Math.floor(rand()*100)},255,${.04+rand()*.12})`;ctx.beginPath();ctx.ellipse(rand()*size,rand()*size,30+rand()*110,8+rand()*40,rand()*3.14,0,Math.PI*2);ctx.fill();}
    for(let i=0;i<360;i++){const x=rand()*size,y=rand()*size,r=rand()*2.4+.3;ctx.fillStyle=rand()>.8?"#ffdcff":rand()>.5?"#8feaff":"#ffffff";ctx.globalAlpha=.35+rand()*.65;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();} ctx.globalAlpha=1;
  } else if (patternId === "fire" || patternId === "lava") {
    ctx.fillStyle = patternId==="fire"?"#17080b":"#171316";ctx.fillRect(0,0,size,size);
    for(let i=0;i<70;i++){const x=rand()*size,y=rand()*size,r=18+rand()*70;ctx.fillStyle=patternId==="fire"?`rgba(255,${35+Math.floor(rand()*130)},${Math.floor(rand()*18)},${.16+rand()*.28})`:`rgba(255,${35+Math.floor(rand()*70)},${Math.floor(rand()*12)},${.12+rand()*.2})`;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
    ctx.lineWidth=2;
    for(let i=0;i<34;i++){let x=rand()*size,y=rand()*size;ctx.beginPath();ctx.moveTo(x,y);for(let j=0;j<5;j++){x+=(rand()-.5)*65;y+=12+rand()*35;ctx.lineTo(x,y);}ctx.strokeStyle=patternId==="fire"?"#ff7a13":"#ff3b12";ctx.shadowColor="#ff3900";ctx.shadowBlur=10;ctx.stroke();}
    ctx.shadowBlur=0;
  } else if (patternId === "ice") {
    ctx.fillStyle=grad([[0,"#efffff"],[.35,"#69d9ff"],[.7,"#2186ce"],[1,"#d8f8ff"]],0,0,size,size);ctx.fillRect(0,0,size,size);
    for(let i=0;i<75;i++){let x=rand()*size,y=rand()*size,r=14+rand()*55;ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x+r*.65,y-r*.25);ctx.lineTo(x+r*.5,y+r*.7);ctx.lineTo(x-r*.45,y+r*.8);ctx.lineTo(x-r*.8,y);ctx.closePath();ctx.fillStyle=`rgba(255,255,255,${.12+rand()*.45})`;ctx.fill();ctx.strokeStyle="rgba(10,100,180,.45)";ctx.lineWidth=2;ctx.stroke();}
  } else if (patternId === "camo") {
    ctx.fillStyle="#77795a";ctx.fillRect(0,0,size,size);
    const colors=["#303c2c","#48543b","#a3a078","#202a27","#6b7048"];
    for(let i=0;i<170;i++){ctx.fillStyle=colors[Math.floor(rand()*colors.length)];ctx.beginPath();let x=rand()*size,y=rand()*size;ctx.ellipse(x,y,10+rand()*35,5+rand()*23,rand()*Math.PI,0,Math.PI*2);ctx.fill();}
  } else if (patternId === "digital") {
    ctx.fillStyle="#242c32";ctx.fillRect(0,0,size,size);
    const colors=["#151b21","#4d5961","#78858b","#303b43","#b5bec0"];
    for(let y=0;y<size;y+=16)for(let x=0;x<size;x+=16){if(rand()>.37){ctx.fillStyle=colors[Math.floor(rand()*colors.length)];ctx.fillRect(x,y,8+Math.floor(rand()*2)*8,8+Math.floor(rand()*2)*8);}}
  } else if (patternId === "rainbow") {
    ctx.fillStyle=grad([[0,"#ff426d"],[.17,"#ffb83d"],[.34,"#f8f65b"],[.5,"#47f3a2"],[.67,"#43caff"],[.84,"#806bff"],[1,"#ff55c8"]],0,0,size,size);ctx.fillRect(0,0,size,size);
    for(let i=0;i<12;i++){ctx.beginPath();ctx.moveTo(-50,i*52);ctx.bezierCurveTo(140,i*52-100,300,i*52+100,560,i*52-40);ctx.strokeStyle="rgba(255,255,255,.2)";ctx.lineWidth=18;ctx.stroke();}
  } else if (patternId === "gold") {
    ctx.fillStyle=grad([[0,"#70420b"],[.18,"#ffe99a"],[.34,"#b87912"],[.52,"#fff0a8"],[.72,"#c48b19"],[1,"#583008"]],0,0,size,size);ctx.fillRect(0,0,size,size);
    for(let y=0;y<size;y+=48){ctx.fillStyle="rgba(255,255,255,.13)";ctx.fillRect(0,y,size,3);}
    for(let i=0;i<90;i++){ctx.fillStyle=`rgba(255,255,220,${rand()*.45})`;ctx.fillRect(rand()*size,rand()*size,1+rand()*3,1+rand()*3);}
  } else if (patternId === "glitch") {
    ctx.fillStyle="#090b12";ctx.fillRect(0,0,size,size);
    for(let i=0;i<180;i++){const y=rand()*size,h=1+rand()*14;ctx.fillStyle=["#00f0ff","#ff2e8a","#7c4dff","#e7faff"][Math.floor(rand()*4)];ctx.globalAlpha=.2+rand()*.7;ctx.fillRect(rand()*size,y,20+rand()*220,h);}ctx.globalAlpha=1;
    for(let i=0;i<30;i++){ctx.strokeStyle=rand()>.5?"#00d9ff":"#ff2b82";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(rand()*size,0);ctx.lineTo(rand()*size,size);ctx.stroke();}
  } else if (patternId === "carbon") {
    ctx.fillStyle="#171b22";ctx.fillRect(0,0,size,size);
    for(let y=0;y<size;y+=16)for(let x=0;x<size;x+=16){ctx.fillStyle=((x/16+y/16)%2)?"#303743":"#101319";ctx.fillRect(x,y,16,16);ctx.fillStyle="rgba(255,255,255,.08)";ctx.fillRect(x,y,16,2);}
    ctx.strokeStyle="rgba(0,220,255,.35)";ctx.lineWidth=3;ctx.strokeRect(8,8,size-16,size-16);
  } else if (patternId === "stripes" || patternId === "bands") {
    ctx.fillStyle="#f2f5fb";ctx.fillRect(0,0,size,size);ctx.fillStyle="#18243a";
    for(let i=0;i<8;i++) if(i%2===1) { if(patternId==="stripes")ctx.fillRect(i*size/8,0,size/8,size);else ctx.fillRect(0,i*size/8,size,size/8); }
    ctx.fillStyle="#27e5ff";for(let i=0;i<8;i+=4){if(patternId==="stripes")ctx.fillRect(i*size/8,0,5,size);else ctx.fillRect(0,i*size/8,size,5);}
  } else if (patternId === "dots") {
    ctx.fillStyle="#12223b";ctx.fillRect(0,0,size,size);ctx.fillStyle="#ff4d9d";
    for(let y=24;y<size;y+=64)for(let x=24;x<size;x+=64){ctx.beginPath();ctx.arc(x,y,17,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#ffd5e7";ctx.lineWidth=3;ctx.stroke();}
  } else if (patternId === "checker") {
    const n=8;for(let y=0;y<n;y++)for(let x=0;x<n;x++){ctx.fillStyle=(x+y)%2?"#111827":"#f3f6ff";ctx.fillRect(x*size/n,y*size/n,size/n,size/n);}
    ctx.strokeStyle="#21d4fd";ctx.lineWidth=4;ctx.strokeRect(2,2,size-4,size-4);
  }

  // Add a subtle baked-in highlight and micro-detail so the maps read as
  // finished game skins under the capsule's glossy lighting.
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = grad([[0,"rgba(255,255,255,.2)"],[.5,"rgba(255,255,255,0)"],[1,"rgba(0,0,0,.28)"]],0,0,size,size);
  ctx.fillRect(0,0,size,size);
  ctx.globalCompositeOperation = "source-over";

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  textureCache.set(patternId, tex);
  return tex;
}

// Apply a complete skin map to the capsule. Textured skins use white material
// tint so the chosen color cannot wash out or recolour their pixels.
export function applyBodyLook(material, color, patternId) {
  if (!patternId || patternId === "solid") {
    material.map = null;
    material.color.set(color);
  } else {
    material.map = patternTexture(patternId);
    material.color.set(0xffffff);
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

  switch (id) {
    case "tophat": {
      const black = std(0x15151a, { roughness: 0.35 });
      add(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 24), black, 0, 0.98, 0);
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.46, 24), black, 0, 1.2, 0);
      add(new THREE.CylinderGeometry(0.31, 0.31, 0.09, 24), std(color), 0, 1.04, 0);
      break;
    }
    case "crown": {
      const gold = std(0xffc83d, { metalness: 0.7, roughness: 0.3 });
      add(new THREE.CylinderGeometry(0.3, 0.32, 0.14, 20), gold, 0, 1.06, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.07, 0.22, 8), gold, Math.cos(a) * 0.27, 1.22, Math.sin(a) * 0.27);
      }
      break;
    }
    case "halo": {
      const m = add(
        new THREE.TorusGeometry(0.32, 0.035, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0xffe066 }),
        0, 1.45, 0
      );
      m.rotation.x = Math.PI / 2;
      m.castShadow = false;
      break;
    }
    case "horns": {
      const red = std(0xd0222d, { roughness: 0.4 });
      const l = add(new THREE.ConeGeometry(0.08, 0.36, 10), red, -0.28, 1.0, 0);
      l.rotation.z = 0.5;
      const r = add(new THREE.ConeGeometry(0.08, 0.36, 10), red, 0.28, 1.0, 0);
      r.rotation.z = -0.5;
      break;
    }
    case "antenna": {
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 8), std(0x9aa0aa, { metalness: 0.6 }), 0, 1.3, 0);
      add(
        new THREE.SphereGeometry(0.065, 12, 12),
        std(color, { emissive: color, emissiveIntensity: 0.8 }),
        0, 1.54, 0
      );
      break;
    }
    case "shades": {
      add(
        new THREE.BoxGeometry(0.62, 0.13, 0.12),
        std(0x0b0b0f, { roughness: 0.1, metalness: 0.5 }),
        0, 0.68, -0.46
      );
      break;
    }
    case "party": {
      add(new THREE.ConeGeometry(0.27, 0.6, 18), std(color), 0, 1.35, 0);
      add(new THREE.SphereGeometry(0.07, 10, 10), std(0xffffff), 0, 1.68, 0);
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
