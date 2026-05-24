import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';

export function createScene() {
  const canvas = document.getElementById('c');
  const W = window.innerWidth, H = window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;   // pulled down — prevents overall overexposure

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, W / H, 0.01, 100);
  camera.position.set(0, 0, 3.5);

  // Cinematic bloom — tight threshold so only genuinely bright pixels bloom
  // Low intensity so face stays defined, not washed out
  const bloom = new BloomEffect({
    luminanceThreshold: 0.28,   // was 0.05 — only very bright pixels bloom
    luminanceSmoothing: 0.55,
    intensity: 1.1,             // was 3.2 — subtle halo, not nuclear explosion
  });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, bloom));

  window.addEventListener('resize', () => {
    const W2 = window.innerWidth, H2 = window.innerHeight;
    camera.aspect = W2 / H2;
    camera.updateProjectionMatrix();
    renderer.setSize(W2, H2);
    composer.setSize(W2, H2);
  });

  return { renderer, scene, camera, composer, bloom };
}
