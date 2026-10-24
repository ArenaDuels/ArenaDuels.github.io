// A small spinning preview of your player in the Customize menu — in first
// person you never see your own body, so this is the only way to check it.

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { RemotePlayer } from "./player.js";

export function createLookPreview(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(320, 320, false); // CSS controls the on-screen size
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(0, 0.5, 6.4);
  camera.lookAt(0, 0.25, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 5, 4);
  scene.add(key);

  const rp = new RemotePlayer(scene, 0xffffff, "");
  rp.hpBar.visible = false;
  rp.nameSprite.visible = false;

  let running = false;
  let raf = 0;
  function frame(t) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    rp.mesh.rotation.y = (t / 1000) * 0.9;
    renderer.render(scene, camera);
  }

  return {
    setLook(look, defaultColor) {
      rp.setLook(look, defaultColor);
    },
    start() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
