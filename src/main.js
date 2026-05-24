import './style.css';
import { createScene }               from './scene.js';
import { loadFace }                  from './face.js';
import { initMouse, getMouseWorld }  from './mouse.js';
import { setupScroll }               from './scroll.js';

async function main() {
  const { scene, camera, composer, bloom } = createScene();

  const face = await loadFace(scene);

  const loader = document.getElementById('loader');
  if (loader) {
    loader.classList.add('fade-out');
    setTimeout(() => loader.remove(), 1100);
  }

  face.mat.uniforms.uOpacity.value = 1.0;

  initMouse();
  setupScroll({ camera, bloom, face });

  // ── Hover detection — is cursor over the face? ────────────────────────────
  // Face fills most of the viewport; bounding radius in world units ≈ 1.45
  // We read the already-smoothed mouse world position each frame for accuracy.
  const FACE_RADIUS = 1.55;   // slightly generous so edge of face still triggers
  let hoverTarget   = 0;      // 0 = off face, 1 = on face

  window.addEventListener('mouseleave', () => { hoverTarget = 0; });
  window.addEventListener('mouseenter', () => { /* re-evaluated each tick */ });

  let prev = performance.now(), t = 0;
  let targetRotX = 0, targetRotY = 0;

  function tick() {
    requestAnimationFrame(tick);
    const now = performance.now();
    const dt  = Math.min((now - prev) / 1000, 0.05);
    prev = now; t += dt;

    const mouse = getMouseWorld(camera);

    // Detect hover: cursor within face bounding circle
    const distFromCenter = Math.sqrt(mouse.x * mouse.x + mouse.y * mouse.y);
    hoverTarget = distFromCenter < FACE_RADIUS ? 1 : 0;

    // Smooth lerp — quick onset (0.10), lazy release (0.04) for trailing lensing
    const lerpSpeed = hoverTarget > face.mat.uniforms.uHover.value ? 0.10 : 0.04;
    face.mat.uniforms.uHover.value +=
      (hoverTarget - face.mat.uniforms.uHover.value) * lerpSpeed;

    face.mat.uniforms.uTime.value  = t;
    face.mat.uniforms.uMouse.value.copy(mouse);

    // Mouse-driven tilt
    targetRotY =  mouse.x * 0.28;
    targetRotX = -mouse.y * 0.18;
    face.mesh.rotation.y += (targetRotY - face.mesh.rotation.y) * 0.055;
    face.mesh.rotation.x += (targetRotX - face.mesh.rotation.x) * 0.055;

    composer.render();
  }

  tick();
}

main().catch(console.error);
